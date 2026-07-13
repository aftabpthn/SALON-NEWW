#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { existsSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';

const args = new Map();
for (let index = 2; index < process.argv.length; index += 1) {
  const key = process.argv[index];
  if (!key.startsWith('--')) continue;
  const next = process.argv[index + 1];
  if (next && !next.startsWith('--')) { args.set(key, next); index += 1; } else args.set(key, true);
}

const sqlitePath = String(args.get('--sqlite') || '');
const sourceTenant = String(args.get('--source-tenant') || '');
const sourceBranch = String(args.get('--source-branch') || '');
const targetTenant = String(args.get('--target-tenant') || sourceTenant);
const targetBranch = String(args.get('--target-branch') || sourceBranch);
const outputPath = args.get('--output') ? String(args.get('--output')) : '';
const apply = args.has('--apply');

if (!sqlitePath || !sourceTenant || !sourceBranch || !targetTenant || !targetBranch) {
  console.error('Usage: node scripts/migrate_legacy_memberships_packages.mjs --sqlite <file> --source-tenant <id> --source-branch <id> --target-tenant <id> --target-branch <id> [--output <sql>] [--apply]');
  process.exit(2);
}
if (!existsSync(sqlitePath)) { console.error(`SQLite file not found: ${sqlitePath}`); process.exit(2); }
if (apply && !process.env.DATABASE_URL) { console.error('DATABASE_URL is required with --apply'); process.exit(2); }

const db = new DatabaseSync(sqlitePath, { readOnly: true });
const all = (sql, ...params) => db.prepare(sql).all(...params);
const one = (sql, ...params) => db.prepare(sql).get(...params);
const parseJson = (value, fallback) => { try { return value ? JSON.parse(value) : fallback; } catch { return fallback; } };
const id = (kind, value) => `legacy_${kind}_${createHash('sha256').update(`${sourceTenant}|${sourceBranch}|${value}`).digest('hex').slice(0, 24)}`;
const sqlValue = (value) => value === null || value === undefined || value === '' ? 'NULL' : `'${String(value).replaceAll("'", "''")}'`;
const sqlText = (value) => `'${String(value ?? '').replaceAll("'", "''")}'`;
const sqlJson = (value) => `${sqlText(JSON.stringify(value))}::jsonb`;
const paise = (value) => Math.max(0, Math.round(Number(value || 0) * 100));
const integer = (value) => Math.max(0, Math.round(Number(value || 0)));
const active = (status) => !['inactive', 'expired', 'cancelled', 'deleted', 'disabled'].includes(String(status || 'active').toLowerCase());
const validDate = (value) => value && !Number.isNaN(Date.parse(value)) ? value : null;

const legacyMemberships = all('SELECT * FROM memberships WHERE tenantId=? AND branchId=? ORDER BY createdAt,id', sourceTenant, sourceBranch);
const packagePurchases = legacyMemberships.filter((row) => String(row.planName || '').startsWith('Package:'));
const memberRows = legacyMemberships.filter((row) => !String(row.planName || '').startsWith('Package:'));
const packageRows = all('SELECT * FROM packages WHERE tenantId=? AND branchId=? ORDER BY createdAt,id', sourceTenant, sourceBranch);
const ledgerRows = all('SELECT * FROM client_membership_ledger WHERE tenant_id=? AND branch_id=? ORDER BY created_at,id', sourceTenant, sourceBranch);
const reminderRows = all('SELECT * FROM membership_whatsapp_reminders WHERE tenant_id=? AND branch_id=? ORDER BY created_at,id', sourceTenant, sourceBranch);
const familyRows = all('SELECT * FROM membership_family_members WHERE tenant_id=? AND branch_id=? ORDER BY created_at,id', sourceTenant, sourceBranch);

const clientIds = new Set(memberRows.map((row) => row.clientId).filter(Boolean));
for (const row of packagePurchases) if (row.clientId) clientIds.add(row.clientId);
for (const row of familyRows) { if (row.primary_client_id) clientIds.add(row.primary_client_id); if (row.member_client_id) clientIds.add(row.member_client_id); }
const clientLookup = db.prepare('SELECT * FROM clients WHERE tenantId=? AND id=?');
const clients = [...clientIds].map((clientId) => clientLookup.get(sourceTenant, clientId)).filter(Boolean);

const packageServiceIds = new Set();
for (const row of packageRows) for (const serviceId of parseJson(row.serviceIds, [])) if (serviceId) packageServiceIds.add(serviceId);
for (const row of packagePurchases) for (const credit of parseJson(row.serviceCredits, [])) if (credit?.serviceId) packageServiceIds.add(credit.serviceId);
const serviceLookup = db.prepare('SELECT * FROM services WHERE tenantId=? AND id=?');
const services = [...packageServiceIds].map((serviceId) => serviceLookup.get(sourceTenant, serviceId)).filter(Boolean);

const planMap = new Map();
for (const row of memberRows) {
  const name = String(row.planName || '').trim();
  if (!name) continue;
  const current = planMap.get(name) || { name, pricePaise: 0, validityDays: 0, discountPercent: 0, maxCredits: 0, serviceIds: new Set() };
  current.pricePaise = Math.max(current.pricePaise, paise(row.price));
  current.maxCredits = Math.max(current.maxCredits, integer(row.planCredits));
  const match = name.match(/(\d+(?:\.\d+)?)\s*%/); current.discountPercent = Math.max(current.discountPercent, match ? Math.min(100, Math.round(Number(match[1]))) : 0);
  if (validDate(row.createdAt) && validDate(row.validityDate)) current.validityDays = Math.max(current.validityDays, Math.max(0, Math.round((Date.parse(row.validityDate) - Date.parse(row.createdAt)) / 86400000)));
  for (const credit of parseJson(row.serviceCredits, [])) if (credit?.serviceId) current.serviceIds.add(credit.serviceId);
  planMap.set(name, current);
}

const warnings = [];
const skippedMemberships = memberRows.filter((row) => !row.clientId || !String(row.planName || '').trim() || !validDate(row.createdAt));
if (skippedMemberships.length) warnings.push(`${skippedMemberships.length} memberships lack client, plan, or assigned date and will be skipped.`);
const ambiguousPackageCredits = packagePurchases.filter((row) => {
  const credits = parseJson(row.serviceCredits, []);
  const total = credits.reduce((sum, credit) => sum + integer(credit?.credits), 0);
  return !credits.length || total !== integer(row.planCredits) || integer(row.creditsRemaining) !== total;
});
if (ambiguousPackageCredits.length) warnings.push(`${ambiguousPackageCredits.length} package purchases have ambiguous per-service balances and their credits will be skipped.`);
const unsupportedReminders = reminderRows.filter((row) => !['renewal', 'reward_expiry'].includes(row.reminder_type));
if (unsupportedReminders.length) warnings.push(`${unsupportedReminders.length} unsupported legacy reminder types will be skipped.`);
const importedMembershipIds = new Set(memberRows.filter((row) => !skippedMemberships.includes(row)).map((row) => row.id));
const mappableReminders = reminderRows.filter((row) => ['renewal', 'reward_expiry'].includes(row.reminder_type) && importedMembershipIds.has(row.membership_id) && validDate(row.due_on));
const domainSplitReminders = reminderRows.filter((row) => ['renewal', 'reward_expiry'].includes(row.reminder_type) && !importedMembershipIds.has(row.membership_id));
if (domainSplitReminders.length) warnings.push(`${domainSplitReminders.length} reminders point to legacy package-membership rows and will be skipped after the package-credit domain split.`);
const unmappedFamily = familyRows.filter((row) => !row.membership_id);
if (unmappedFamily.length) warnings.push(`${unmappedFamily.length} family links have no source membership id and will be skipped.`);

const summary = {
  source: { sqlitePath, tenantId: sourceTenant, branchId: sourceBranch }, target: { tenantId: targetTenant, branchId: targetBranch },
  clients: clients.length, services: services.length, membershipPlans: planMap.size,
  clientMemberships: memberRows.length - skippedMemberships.length, packages: packageRows.length,
  packagePurchases: packagePurchases.length - ambiguousPackageCredits.length,
  lifecycleEvents: ledgerRows.filter((row) => ['sold', 'assigned', 'renewed', 'cancelled'].includes(String(row.action).toLowerCase())).length,
  reminders: mappableReminders.length, familyLinks: familyRows.length - unmappedFamily.length, warnings,
};

if (!outputPath && !apply) { console.log(JSON.stringify(summary, null, 2)); db.close(); process.exit(0); }

const sql = ['BEGIN;', "CREATE TEMP TABLE legacy_client_map(old_id TEXT PRIMARY KEY,new_id TEXT NOT NULL) ON COMMIT DROP;", "CREATE TEMP TABLE legacy_service_map(old_id TEXT PRIMARY KEY,new_id TEXT NOT NULL) ON COMMIT DROP;"];
for (const row of clients) {
  const targetId = id('client', row.id); const phone = String(row.phone || '').trim();
  sql.push(`INSERT INTO clients(id,tenant_id,branch_id,first_name,last_name,phone,email,last_visit_at,membership_label,categories_json,active,created_at,updated_at) VALUES (${sqlText(targetId)},${sqlText(targetTenant)},${sqlText(targetBranch)},${sqlText(String(row.name || '').trim())},'',${sqlText(phone)},${sqlText(String(row.email || '').trim())},${sqlValue(validDate(row.lastVisitAt))},'',${sqlJson(parseJson(row.tags, []))},${row.deletedAt ? 'FALSE' : 'TRUE'},COALESCE(${sqlValue(validDate(row.createdAt))},NOW()),${sqlValue(validDate(row.updatedAt))}) ON CONFLICT DO NOTHING;`);
  const phoneLookup = phone ? `(SELECT id FROM clients WHERE tenant_id=${sqlText(targetTenant)} AND phone=${sqlText(phone)} LIMIT 1)` : 'NULL';
  sql.push(`INSERT INTO legacy_client_map(old_id,new_id) SELECT ${sqlText(row.id)},COALESCE((SELECT id FROM clients WHERE id=${sqlText(targetId)}),${phoneLookup}) WHERE COALESCE((SELECT id FROM clients WHERE id=${sqlText(targetId)}),${phoneLookup}) IS NOT NULL ON CONFLICT(old_id) DO UPDATE SET new_id=EXCLUDED.new_id;`);
}
for (const row of services) {
  const targetId = id('service', row.id);
  sql.push(`INSERT INTO services(id,tenant_id,branch_id,name,category,duration_minutes,price_paise,active,created_at,updated_at) VALUES (${sqlText(targetId)},${sqlText(targetTenant)},${sqlText(targetBranch)},${sqlText(row.name)},${sqlText(row.category)},${integer(row.durationMinutes)},${paise(row.price)},${active(row.status) ? 'TRUE' : 'FALSE'},COALESCE(${sqlValue(validDate(row.createdAt))},NOW()),${sqlValue(validDate(row.updatedAt))}) ON CONFLICT(id) DO NOTHING;`);
  sql.push(`INSERT INTO legacy_service_map(old_id,new_id) VALUES (${sqlText(row.id)},${sqlText(targetId)}) ON CONFLICT(old_id) DO UPDATE SET new_id=EXCLUDED.new_id;`);
}

for (const plan of planMap.values()) {
  const planId = id('plan', plan.name); const planType = plan.discountPercent > 0 ? 'discount' : plan.maxCredits > 0 ? 'service_credit' : 'prepaid_credit';
  const mappedServices = [...plan.serviceIds].map((serviceId) => id('service', serviceId));
  const benefits = { legacySource: { tenantId: sourceTenant, branchId: sourceBranch }, creditAmount: plan.maxCredits };
  sql.push(`INSERT INTO memberships(id,tenant_id,branch_id,name,code,plan_type,price_paise,points_required,discount_percent,validity_days,notes,service_ids_json,benefit_rules,active) VALUES (${sqlText(planId)},${sqlText(targetTenant)},${sqlText(targetBranch)},${sqlText(plan.name)},'',${sqlText(planType)},${plan.pricePaise},0,${plan.discountPercent},${plan.validityDays},'',${sqlJson(mappedServices)},${sqlJson(benefits)},TRUE) ON CONFLICT(id) DO UPDATE SET name=EXCLUDED.name,plan_type=EXCLUDED.plan_type,price_paise=EXCLUDED.price_paise,discount_percent=EXCLUDED.discount_percent,validity_days=EXCLUDED.validity_days,service_ids_json=EXCLUDED.service_ids_json,benefit_rules=EXCLUDED.benefit_rules,updated_at=NOW();`);
}

for (const row of memberRows) {
  if (skippedMemberships.includes(row)) continue;
  const clientMembershipId = id('client_membership', row.id); const planId = id('plan', String(row.planName).trim());
  const history = parseJson(row.redeemHistory, []); const sourceSaleId = String(history.find((entry) => entry?.saleId)?.saleId || '');
  sql.push(`INSERT INTO client_memberships(id,tenant_id,branch_id,client_id,membership_id,source_sale_id,assigned_at,expires_at,active,auto_renew_enabled,auto_renew_status,created_at,updated_at) SELECT ${sqlText(clientMembershipId)},${sqlText(targetTenant)},${sqlText(targetBranch)},m.new_id,${sqlText(planId)},${sqlText(sourceSaleId)},${sqlValue(row.createdAt)},${sqlValue(validDate(row.validityDate))},${active(row.status) ? 'TRUE' : 'FALSE'},${row.autoRenew ? 'TRUE' : 'FALSE'},${row.autoRenew ? "'active'" : "'disabled'"},${sqlValue(row.createdAt)},${sqlValue(validDate(row.updatedAt))} FROM legacy_client_map m WHERE m.old_id=${sqlText(row.clientId)} ON CONFLICT(id) DO NOTHING;`);
  const credits = parseJson(row.serviceCredits, []).filter((credit) => credit?.serviceId && integer(credit.credits) > 0);
  for (const credit of credits) {
    const total = integer(credit.credits); const remaining = Math.min(total, integer(row.creditsRemaining || total));
    sql.push(`INSERT INTO client_membership_credits(id,tenant_id,branch_id,client_id,membership_id,membership_name,service_id,service_name,total_qty,remaining_qty,expires_at,source_sale_id,active,created_at) SELECT ${sqlText(id('membership_credit', `${row.id}|${credit.serviceId}`))},${sqlText(targetTenant)},${sqlText(targetBranch)},c.new_id,${sqlText(planId)},${sqlText(row.planName)},COALESCE(s.new_id,${sqlText(id('service', credit.serviceId))}),COALESCE((SELECT name FROM services WHERE id=COALESCE(s.new_id,${sqlText(id('service', credit.serviceId))})),''),${total},${remaining},${sqlValue(validDate(row.validityDate))},${sqlText(sourceSaleId)},${active(row.status) ? 'TRUE' : 'FALSE'},${sqlValue(row.createdAt)} FROM legacy_client_map c LEFT JOIN legacy_service_map s ON s.old_id=${sqlText(credit.serviceId)} WHERE c.old_id=${sqlText(row.clientId)} ON CONFLICT(id) DO NOTHING;`);
  }
  sql.push(`INSERT INTO membership_lifecycle_ledger(id,tenant_id,branch_id,client_membership_id,event_type,source_sale_id,reason,created_at) VALUES (${sqlText(id('membership_event', `${row.id}|assigned`))},${sqlText(targetTenant)},${sqlText(targetBranch)},${sqlText(clientMembershipId)},'assigned',${sqlText(sourceSaleId)},'Legacy migration',${sqlValue(row.createdAt)}) ON CONFLICT DO NOTHING;`);
}

for (const row of packageRows) {
  const packageId = id('package', row.id); const credits = parseJson(row.packageCredits, []);
  const serviceRows = credits.map((credit) => ({ serviceId: id('service', credit.serviceId), serviceName: services.find((service) => service.id === credit.serviceId)?.name || '', quantity: integer(credit.credits), unitPricePaise: paise(services.find((service) => service.id === credit.serviceId)?.price || 0) }));
  const cost = serviceRows.reduce((sum, item) => sum + item.quantity * item.unitPricePaise, 0);
  sql.push(`INSERT INTO packages(id,tenant_id,branch_id,name,description,price_paise,discount_percent,validity_days,service_ids_json,paid_sessions,free_sessions,cost_price_paise,service_rows_json,rules_json,show_mobile_app,show_online_booking,active,created_at,updated_at) VALUES (${sqlText(packageId)},${sqlText(targetTenant)},${sqlText(targetBranch)},${sqlText(row.name)},${sqlText(row.description)},${paise(row.price)},0,${integer(row.validityDays)},${sqlJson(serviceRows.map((item) => item.serviceId))},1,0,${cost},${sqlJson(serviceRows)},${sqlJson(parseJson(row.rules, {}))},FALSE,TRUE,${active(row.status) ? 'TRUE' : 'FALSE'},COALESCE(${sqlValue(validDate(row.createdAt))},NOW()),${sqlValue(validDate(row.updatedAt))}) ON CONFLICT(id) DO UPDATE SET name=EXCLUDED.name,description=EXCLUDED.description,price_paise=EXCLUDED.price_paise,validity_days=EXCLUDED.validity_days,service_ids_json=EXCLUDED.service_ids_json,cost_price_paise=EXCLUDED.cost_price_paise,service_rows_json=EXCLUDED.service_rows_json,rules_json=EXCLUDED.rules_json,active=EXCLUDED.active,updated_at=NOW();`);
}

for (const row of packagePurchases) {
  if (ambiguousPackageCredits.includes(row)) continue;
  const packageName = String(row.planName).replace(/^Package:\s*/, ''); const packageRow = packageRows.find((item) => item.name === packageName); if (!packageRow) continue;
  const packageId = id('package', packageRow.id); const sourceSaleId = String(parseJson(row.redeemHistory, []).find((entry) => entry?.saleId)?.saleId || '');
  for (const credit of parseJson(row.serviceCredits, [])) {
    const total = integer(credit.credits); const serviceId = id('service', credit.serviceId); const serviceName = services.find((service) => service.id === credit.serviceId)?.name || '';
    sql.push(`INSERT INTO client_package_credits(id,tenant_id,branch_id,client_id,package_id,package_name,service_id,service_name,total_qty,remaining_qty,expires_at,source_sale_id,active,unit_value_paise,issued_value_paise,created_at) SELECT ${sqlText(id('package_credit', `${row.id}|${credit.serviceId}`))},${sqlText(targetTenant)},${sqlText(targetBranch)},m.new_id,${sqlText(packageId)},${sqlText(packageName)},${sqlText(serviceId)},${sqlText(serviceName)},${total},${total},${sqlValue(validDate(row.validityDate))},${sqlText(sourceSaleId)},${active(row.status) ? 'TRUE' : 'FALSE'},${total ? Math.floor(paise(row.price) / integer(row.planCredits || total)) : 0},${total ? Math.floor(paise(row.price) / integer(row.planCredits || total)) * total : 0},${sqlValue(row.createdAt)} FROM legacy_client_map m WHERE m.old_id=${sqlText(row.clientId)} ON CONFLICT(id) DO NOTHING;`);
  }
}

for (const row of ledgerRows) {
  const eventType = ({ sold: 'assigned', assigned: 'assigned', renewed: 'renewed', cancelled: 'cancelled' })[String(row.action).toLowerCase()]; if (!eventType) continue;
  const clientMembershipId = id('client_membership', row.membership_id);
  sql.push(`INSERT INTO membership_lifecycle_ledger(id,tenant_id,branch_id,client_membership_id,event_type,source_sale_id,reason,created_at) SELECT ${sqlText(id('ledger', row.id))},${sqlText(targetTenant)},${sqlText(targetBranch)},${sqlText(clientMembershipId)},${sqlText(eventType)},${sqlText(row.sale_id)},${sqlText(row.note)},${sqlValue(validDate(row.created_at))} WHERE EXISTS(SELECT 1 FROM client_memberships WHERE id=${sqlText(clientMembershipId)}) ON CONFLICT DO NOTHING;`);
}
for (const row of reminderRows) {
  if (!['renewal', 'reward_expiry'].includes(row.reminder_type) || !validDate(row.due_on)) continue;
  const clientMembershipId = id('client_membership', row.membership_id); const status = ['queued', 'approved', 'sent', 'dismissed'].includes(row.status) ? row.status : 'queued';
  sql.push(`INSERT INTO membership_reminders(id,tenant_id,branch_id,client_membership_id,client_id,reminder_type,due_on,days_before,status,message,approved_by,created_at,updated_at) SELECT ${sqlText(id('reminder', row.id))},${sqlText(targetTenant)},${sqlText(targetBranch)},${sqlText(clientMembershipId)},c.new_id,${sqlText(row.reminder_type)},${sqlValue(row.due_on)},${integer(row.days_before)},${sqlText(status)},${sqlText(row.message)},${sqlText(row.approved_by)},COALESCE(${sqlValue(validDate(row.created_at))},NOW()),${sqlValue(validDate(row.updated_at))} FROM legacy_client_map c WHERE c.old_id=${sqlText(row.client_id)} AND EXISTS(SELECT 1 FROM client_memberships WHERE id=${sqlText(clientMembershipId)}) ON CONFLICT DO NOTHING;`);
}
for (const row of familyRows) {
  if (!row.membership_id) continue; const clientMembershipId = id('client_membership', row.membership_id);
  sql.push(`INSERT INTO membership_family_members(id,tenant_id,branch_id,client_membership_id,owner_client_id,member_client_id,relationship,active,created_at,updated_at) SELECT ${sqlText(id('family', row.id))},${sqlText(targetTenant)},${sqlText(targetBranch)},${sqlText(clientMembershipId)},owner.new_id,member.new_id,${sqlText(row.relationship)},${active(row.status) ? 'TRUE' : 'FALSE'},COALESCE(${sqlValue(validDate(row.created_at))},NOW()),${sqlValue(validDate(row.updated_at))} FROM legacy_client_map owner JOIN legacy_client_map member ON member.old_id=${sqlText(row.member_client_id)} WHERE owner.old_id=${sqlText(row.primary_client_id)} AND EXISTS(SELECT 1 FROM client_memberships WHERE id=${sqlText(clientMembershipId)}) ON CONFLICT DO NOTHING;`);
}
sql.push('COMMIT;');
const generatedSql = `${sql.join('\n')}\n`;
const destination = outputPath || 'legacy-memberships-packages.sql'; writeFileSync(destination, generatedSql, 'utf8');
console.log(JSON.stringify({ ...summary, sqlFile: destination, statements: sql.length, applied: false }, null, 2));
db.close();

if (apply) {
  const result = spawnSync('psql', [process.env.DATABASE_URL, '-v', 'ON_ERROR_STOP=1', '-f', destination], { stdio: 'inherit', shell: process.platform === 'win32' });
  if (result.error) { console.error(`psql failed: ${result.error.message}`); process.exit(1); }
  process.exit(result.status || 0);
}
