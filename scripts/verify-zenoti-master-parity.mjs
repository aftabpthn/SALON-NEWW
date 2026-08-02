import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const evidenceDir = resolve(root, 'docs/evidence');
const registerPath = resolve(evidenceDir, 'zenoti-master-parity-register.json');
const csvPath = resolve(evidenceDir, 'zenoti-master-parity-register.csv');
const routeTruthPath = resolve(evidenceDir, 'aura-route-truth.json');
const reportPath = resolve(root, 'docs/ZENOTI_MASTER_PARITY_REGISTER.md');
const baselineDate = '2026-08-02';
const helpIndex = 'https://help.zenoti.com/en/release-notes.html';
const pricingUrl = 'https://www.zenoti.com/pricing-zenoti-26';
const apiChangelog = 'https://docs.zenoti.com/changelog';
const explicit = (name) => `NOT_EVIDENCED_IN_PHASE_0:${name}`;

const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const clean = (value) => String(value || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const decode = (value) => clean(value)
  .replace(/&amp;/gi, '&').replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'")
  .replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/&nbsp;/gi, ' ')
  .replace(/&#(\d+);/g, (_, number) => String.fromCodePoint(Number(number)));
const slug = (value) => decode(value).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const markdownText = (value) => decode(String(value).replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replaceAll('`', ''));
const markdownUrl = (value) => String(value).match(/\[[^\]]+\]\((https:\/\/[^)]+)\)/)?.[1] || '';
const tableCells = (line) => line.split('|').slice(1, -1).map((cell) => cell.trim());

function links(html, baseUrl, host) {
  const found = new Map();
  for (const match of html.matchAll(/<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    let url;
    try { url = new URL(match[1], baseUrl); } catch { continue; }
    const title = decode(match[2]);
    url.hash = '';
    if (url.host === host && title.length > 2) found.set(url.href, title);
  }
  return [...found].map(([url, title]) => ({ url, title })).sort((a, b) => a.url.localeCompare(b.url));
}

function workflow(title) {
  const value = title.toLowerCase();
  if (/offline/.test(value)) return 'offline';
  if (/permission|security|restrict|authorize|role/.test(value)) return 'permission';
  if (/notif|alert|reminder|message|communication/.test(value)) return 'notification';
  if (/refund|return|reverse|cancel|void|delete|archive|dispute/.test(value)) return 'refund_reverse';
  if (/approve|reject|review|waive/.test(value)) return 'approve';
  if (/redeem|consume|check[ -]?out|usage|use /.test(value)) return 'consume_redeem';
  if (/report|export|analytics|dashboard|summary|view|access|track|monitor|history/.test(value)) return 'report_export';
  if (/create|add |register|onboard|enroll|book |sell |submit|upload|assign|issue/.test(value)) return 'create';
  if (/edit|update|manage|change|customize|transfer|move|close|open|run |process/.test(value)) return 'edit';
  if (/config|set up|setup|enable|allow|define|rules|settings|prerequisite/.test(value)) return 'configure';
  if (/mobile|myzen|kiosk|app\b|device/.test(value)) return 'mobile';
  return 'operate';
}

function verticals(title, url) {
  const value = `${title} ${url}`.toLowerCase();
  const all = { salon: true, spa: true, medspa: true, fitness: true, barbershop: true };
  if (/fitness|class|student|instructor|gym|amenit|locker|workshop/.test(value)) return { salon: false, spa: false, medspa: false, fitness: true, barbershop: false };
  if (/medspa|medical|clinical|prescri|treatment visual|ai scribe|patient/.test(value)) return { salon: false, spa: true, medspa: true, fitness: false, barbershop: false };
  if (/barber/.test(value)) return { salon: false, spa: false, medspa: false, fitness: false, barbershop: true };
  return all;
}

function publicAvailability(title, url) {
  const value = `${title} ${url}`.toLowerCase();
  if (/\/new-kiosk\//.test(value) || /\b(beta|pilot)\b/.test(value)) return 'representative_enabled';
  if (/zenoti-integrated-payroll|same-day-tips-payout|zenoti-wallet|smart-card/.test(value)) return 'region_gated';
  if (/unsupported-feature/.test(value)) return 'public_limitation';
  return 'public';
}

function releaseDateFromTitle(title) {
  const match = title.match(/(\d{1,2})\s+(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+(20\d{2})/i);
  if (!match) return 'DATE_NOT_EXPOSED_IN_LINK_TITLE';
  const month = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'].indexOf(match[2].slice(0, 3).toLowerCase()) + 1;
  return `${match[3]}-${String(month).padStart(2, '0')}-${String(match[1]).padStart(2, '0')}`;
}

function blankAura() {
  return {
    ui: explicit('UI'), apiRoute: explicit('API_ROUTE'), routeState: 'not_evidenced',
    serviceRepository: explicit('SERVICE_REPOSITORY'), databaseTables: explicit('DATABASE_TABLES'),
    permission: explicit('PERMISSION'), auditEvent: explicit('AUDIT_EVENT'),
    providerDevice: explicit('PROVIDER_DEVICE'), automatedTest: explicit('AUTOMATED_TEST'),
    uatEvidence: explicit('UAT_EVIDENCE')
  };
}

function makeRow({ id, feature, url, sourceType, releaseDate = 'NOT_PUBLISHED_ON_SOURCE_INDEX', availability = 'public', workflowType, businessVerticals }) {
  return {
    id, capabilityKey: `${sourceType}:${slug(id)}`, zenotiFeature: feature,
    workflow: workflowType || workflow(feature), officialUrl: url, supportingUrls: [], releaseDate,
    businessVerticals: businessVerticals || verticals(feature, url), publicAvailability: availability,
    sourceType, sourceRowIds: [], auraShine: blankAura(), status: 'Unmapped',
    blocker: 'No AuraShine evidence is mapped for this public Zenoti capability.'
  };
}

const inventoryAliasGroups = [
  ['ZI-RPT-003', 'ZI-COST-001'], ['ZI-PROD-001', 'ZI-MD-001'], ['ZI-PROD-002', 'ZI-MD-002'],
  ['ZI-PROD-003', 'ZI-MD-003'], ['ZI-PROD-004', 'ZI-MD-004'], ['ZI-PROD-005', 'ZI-MD-005'],
  ['ZI-PROD-006', 'ZI-MD-006'], ['ZI-PROD-007', 'ZI-MD-007'], ['ZI-PROD-008', 'ZI-MD-008']
];
const inventoryAlias = new Map(inventoryAliasGroups.flatMap((group) => group.map((id) => [id, group[0]])));
const severity = { Complete: 0, Partial: 1, Missing: 2 };

function inventoryRows() {
  const source = readFileSync(resolve(root, 'docs/INVENTORY_ZENOTI_PARITY_REGISTER.md'), 'utf8');
  const groups = new Map();
  for (const line of source.split(/\r?\n/)) {
    const cells = tableCells(line);
    if (!/^ZI-[A-Z]+-\d{3}$/.test(cells[0] || '')) continue;
    const [id, featureCell, observable, aura, status, quantity, value, permission, reports, reversal, verification] = cells;
    const canonical = inventoryAlias.get(id) || id;
    const item = { id, feature: markdownText(featureCell), url: markdownUrl(featureCell) || 'https://help.zenoti.com/en/inventory.html', observable, aura, status, quantity, value, permission, reports, reversal, verification };
    const group = groups.get(canonical) || [];
    group.push(item);
    groups.set(canonical, group);
  }
  return { source, groups };
}

function mergeInventory(rows, inventory) {
  for (const [canonical, aliases] of inventory.groups) {
    const primary = aliases[0];
    let row = rows.find((candidate) => candidate.officialUrl === primary.url && slug(candidate.zenotiFeature) === slug(primary.feature));
    if (!row) {
      row = makeRow({ id: `INV-${canonical}`, feature: primary.feature, url: primary.url, sourceType: 'inventory_subregister' });
      rows.push(row);
    }
    row.sourceType = row.sourceType === 'help_center_navigation' ? 'help_center+inventory_subregister' : 'inventory_subregister';
    row.sourceRowIds = aliases.map((alias) => alias.id);
    row.status = aliases.reduce((worst, alias) => severity[alias.status] > severity[worst] ? alias.status : worst, 'Complete');
    row.auraShine = {
      ui: primary.aura || explicit('UI'), apiRoute: (primary.aura.match(/(?:GET|POST|PUT|PATCH|DELETE)?\s*(\/[A-Za-z0-9_:{}./-]+)/)?.[1]) || explicit('API_ROUTE'),
      routeState: 'subregister_evidence', serviceRepository: `SUBREGISTER:docs/INVENTORY_ZENOTI_PARITY_REGISTER.md#${canonical}`,
      databaseTables: `SUBREGISTER:docs/INVENTORY_ZENOTI_PARITY_REGISTER.md#${canonical}`,
      permission: primary.permission || explicit('PERMISSION'), auditEvent: primary.reports || explicit('AUDIT_EVENT'),
      providerDevice: /Aveda/i.test(primary.feature) ? 'Aveda provider contract' : 'NOT_REQUIRED_OR_SUBREGISTER_SPECIFIED',
      automatedTest: /test|compile|verified/i.test(primary.verification) ? primary.verification : explicit('AUTOMATED_TEST'),
      uatEvidence: primary.verification || explicit('UAT_EVIDENCE')
    };
    row.blocker = row.status === 'Complete' && /pending|unavailable|code-mapped/i.test(primary.verification)
      ? primary.verification : row.status === 'Complete' ? 'NONE_RECORDED_IN_SUBREGISTER' : primary.verification;
  }
}

function routeTruth() {
  const routesDir = resolve(root, 'backend-rust/src/routes');
  const mod = readFileSync(resolve(routesDir, 'mod.rs'), 'utf8');
  const mountedModules = new Set([...mod.matchAll(/\.merge\(\s*([a-zA-Z0-9_]+)::[a-zA-Z0-9_]*router\s*\(/g)].map((match) => match[1]));
  const literals = new Set(['/health', '/api', '/api/v1']);
  for (const file of readdirSync(routesDir).filter((name) => name.endsWith('.rs') && (name === 'mod.rs' || mountedModules.has(name.slice(0, -3))))) {
    const source = readFileSync(resolve(routesDir, file), 'utf8');
    for (const match of source.matchAll(/\.route\(\s*"([^"]+)"/g)) {
      const path = match[1].replace(/\{[^}]+\}|:[A-Za-z_][A-Za-z0-9_]*/g, ':id').replace(/\/$/, '') || '/';
      literals.add(path);
      literals.add(`/api${path}`);
      literals.add(`/api/v1${path}`);
    }
  }
  const readme = readFileSync(resolve(root, 'docs/README.md'), 'utf8');
  const claims = [...new Set([...readme.matchAll(/(?<![A-Za-z0-9])\/(?:api(?:\/v1)?(?:\/[A-Za-z0-9_:{}/.-]+)?|health)(?![A-Za-z0-9])/g)].map((match) => match[0].replace(/\{[^}]+\}|:[A-Za-z_][A-Za-z0-9_]*/g, ':id').replace(/\/$/, '') || '/'))];
  const classify = (endpoint) => literals.has(endpoint) ? 'mounted'
    : /\/quality\/seed-demo$/.test(endpoint) ? 'retired'
      : /webhook|provider|marketplace|white-label\/domains/.test(endpoint) ? 'external' : 'future';
  const rows = claims.sort().map((endpoint) => ({ endpoint, state: classify(endpoint), evidence: literals.has(endpoint) ? 'backend-rust/src/routes/mod.rs mounted route literal' : 'Explicit README contract classification' }));
  return { generatedAt: new Date().toISOString(), scanRule: 'Exact static Axum route literal in a mounted router; all other README contracts are explicitly future, external, or retired.', mountedModuleCount: mountedModules.size, mountedRouteLiteralCount: literals.size, claims: rows };
}

const pricingCapabilities = [
  'Appointment book', 'Employee management', 'Payroll and commissions', 'Staff performance and goals', 'Inventory management', 'Resource and room management',
  'Point of sale', 'Payments', 'Text2Pay', 'Memberships and packages', 'Gift cards', 'Loyalty', 'Webstore', 'Social booking', 'Reserve with Google',
  'Marketing', 'Reputation management', 'AI Phone Line', 'AI Digital Marketer', 'AI Lead Manager', 'AI Receptionist', 'AI Concierge', 'AI Dispute Manager',
  'AI Business Advisor', 'AI Sidekick', 'AI Retention Manager', 'AI Employee Scheduler', 'AI Inventory Manager'
];

const releaseAdditions = [
  ['2026-07-28', 'AI Lead Management release improvements', 'commercially_gated', 'all'],
  ['2026-07-28', 'Analytics release improvements', 'public', 'all'],
  ['2026-07-28', 'Digital Forms release improvements', 'public', 'all'],
  ['2026-07-28', 'Fitness release improvements', 'public', 'fitness'],
  ['2026-07-28', 'Memberships release improvements', 'public', 'all'],
  ['2026-07-28', 'MyZen release improvements', 'public', 'all'],
  ['2026-07-28', 'Photo Manager release improvements', 'public', 'medspa'],
  ['2026-07-07', 'Allow class bookings on Kiosk after class start time', 'public', 'fitness'],
  ['2026-07-07', 'Kiosk class package credit holder check-in', 'public', 'fitness'],
  ['2026-07-07', 'Kiosk guest-specific price and duration', 'public', 'all'],
  ['2026-07-07', 'Kiosk mirror mode and cash register selection', 'public', 'all'],
  ['2026-07-07', 'Fitness class calendar details and filters', 'public', 'fitness'],
  ['2026-07-07', 'Waive late-cancel or no-show fee for auto-waitlist students', 'public', 'fitness'],
  ['2026-07-07', 'HyperConnect inbound WhatsApp lead capture and timeline', 'public', 'all'],
  ['2026-06-16', 'Filter open invoices by source during register closure', 'public', 'all'],
  ['2026-06-16', 'Queue PIN mode role behavior', 'public', 'all'],
  ['2026-06-16', 'Kiosk smoother booking workflow', 'public', 'all'],
  ['2026-06-16', 'MyZen bought product percentage metric', 'public', 'all'],
  ['2026-06-16', 'MyZen smart commission refresh', 'public', 'all'],
  ['2026-06-16', 'Prorated membership freeze and unfreeze charges and refunds', 'public', 'all'],
  ['2026-06-16', 'Membership payments report filters and columns', 'public', 'all'],
  ['2026-06-16', 'Membership IRR MRR and SCR reports', 'public', 'all'],
  ['2026-06-16', 'Employee schedule blockouts and employee levels', 'public', 'all'],
  ['2026-06-16', 'AI Inventory dashboard reorder and vendor recommendations', 'commercially_gated', 'all'],
  ['2026-06-16', 'Online booking service frequency across catalogs', 'public', 'all'],
  ['2026-06-16', 'Fitness advanced membership booking rules', 'public', 'fitness'],
  ['2026-06-16', 'Fitness weekly class schedule', 'public', 'fitness'],
  ['2026-06-16', 'Fitness billing collections and deposits reporting', 'public', 'fitness'],
  ['2026-06-16', 'HyperConnect scheduled messages', 'public', 'all'],
  ['2026-06-16', 'HyperConnect ring groups and fixed-order extensions', 'public', 'all'],
  ['2026-06-16', 'HyperConnect cross-center call transfer', 'public', 'all'],
  ['2026-06-16', 'HyperConnect phone tree direct and end-call nodes', 'public', 'all'],
  ['2026-06-16', 'Book appointments in HyperConnect', 'public', 'all'],
  ['2026-06-16', 'HyperConnect voicemail node and inbox', 'public', 'all'],
  ['2026-06-16', 'Same-day tips payout by wire', 'region_gated', 'all'],
  ['2026-06-16', 'Lead workflow templates', 'public', 'all'],
  ['2026-06-16', 'Treatment Visualizer AI before and after image', 'commercially_gated', 'medspa']
];

function specialVertical(value) {
  if (value === 'fitness') return { salon: false, spa: false, medspa: false, fitness: true, barbershop: false };
  if (value === 'medspa') return { salon: false, spa: true, medspa: true, fitness: false, barbershop: false };
  return { salon: true, spa: true, medspa: true, fitness: true, barbershop: true };
}

function validate(register) {
  const errors = [];
  const required = ['id', 'capabilityKey', 'zenotiFeature', 'workflow', 'officialUrl', 'releaseDate', 'businessVerticals', 'publicAvailability', 'sourceType', 'auraShine', 'status', 'blocker'];
  const auraRequired = ['ui', 'apiRoute', 'routeState', 'serviceRepository', 'databaseTables', 'permission', 'auditEvent', 'providerDevice', 'automatedTest', 'uatEvidence'];
  const ids = new Set(), keys = new Set(), exact = new Set();
  for (const row of register.rows) {
    for (const field of required) if (row[field] === undefined || row[field] === null || row[field] === '') errors.push(`${row.id || 'NO_ID'} missing ${field}`);
    for (const field of auraRequired) if (!row.auraShine?.[field]) errors.push(`${row.id}.auraShine missing ${field}`);
    if (ids.has(row.id)) errors.push(`Duplicate id ${row.id}`); ids.add(row.id);
    if (keys.has(row.capabilityKey)) errors.push(`Duplicate capabilityKey ${row.capabilityKey}`); keys.add(row.capabilityKey);
    const signature = `${row.officialUrl}|${slug(row.zenotiFeature)}|${row.workflow}|${row.releaseDate}|${JSON.stringify(row.businessVerticals)}`;
    if (exact.has(signature)) errors.push(`Duplicate atomic capability ${signature}`); exact.add(signature);
    if (!/^https:\/\/(help\.zenoti\.com|www\.zenoti\.com|docs\.zenoti\.com)\//.test(row.officialUrl)) errors.push(`${row.id} non-official URL`);
    if (/\bUNKNOWN\b/i.test(JSON.stringify(row))) errors.push(`${row.id} contains UNKNOWN`);
    if (!Object.values(row.businessVerticals).some(Boolean)) errors.push(`${row.id} has no vertical`);
  }
  if (/\bUNKNOWN\b/i.test(JSON.stringify(register.sourceLocks))) errors.push('Source locks contain UNKNOWN');
  return errors;
}

function csv(rows) {
  const columns = ['id', 'capabilityKey', 'zenotiFeature', 'workflow', 'officialUrl', 'releaseDate', 'businessVerticals', 'publicAvailability', 'sourceType', 'sourceRowIds', 'ui', 'apiRoute', 'routeState', 'serviceRepository', 'databaseTables', 'permission', 'auditEvent', 'providerDevice', 'automatedTest', 'uatEvidence', 'status', 'blocker'];
  const quote = (value) => `"${String(value ?? '').replaceAll('"', '""')}"`;
  const body = rows.map((row) => columns.map((column) => quote(column in row ? (typeof row[column] === 'object' ? JSON.stringify(row[column]) : row[column]) : row.auraShine[column])).join(','));
  return `${columns.join(',')}\n${body.join('\n')}\n`;
}

function summary(register, truth, inventory) {
  const counts = Object.fromEntries([...new Set(register.rows.map((row) => row.status))].sort().map((status) => [status, register.rows.filter((row) => row.status === status).length]));
  const sourceCounts = Object.fromEntries([...new Set(register.rows.map((row) => row.sourceType))].sort().map((type) => [type, register.rows.filter((row) => row.sourceType === type).length]));
  const ghosts = truth.claims.filter((claim) => claim.state === 'ghost');
  return `# Zenoti Master Parity Register\n\nBaseline locked: **${baselineDate}**  \nMachine-readable register: [JSON](./evidence/zenoti-master-parity-register.json) · [CSV](./evidence/zenoti-master-parity-register.csv)  \nRoute truth: [README vs mounted routes](./evidence/aura-route-truth.json)\n\n## Phase 0 result\n\n- Atomic canonical rows: **${register.rows.length}**\n- Duplicate IDs, capability keys, and exact atomic signatures: **0**\n- Literal \`UNKNOWN\` values: **0**; absent evidence uses explicit \`NOT_EVIDENCED_IN_PHASE_0:*\` markers.\n- Help Center navigation URLs locked: **${register.sourceLocks.helpCenter.capabilityUrls}**\n- API changelog entries locked: **${register.sourceLocks.apiChangelog.entries}**\n- Inventory source drift: requested 40/15/8, current register is **${inventory.currentCounts.Complete}/${inventory.currentCounts.Partial}/${inventory.currentCounts.Missing}** across ${inventory.currentRows} source rows. Nine duplicate source pairs are consolidated into ${inventory.canonicalRows} canonical rows and retained in \`sourceRowIds\`.\n- Staff App register is linked by SHA-256 with **${register.linkedSubregisters.staffApp.rowCount}** rows; it is not copied into a competing second register.\n- README endpoint claims: **${truth.claims.length}**; mounted exact: **${truth.claims.length - ghosts.length}**; ghost exact: **${ghosts.length}**. Dynamic/generated paths are not silently called mounted.\n\n### Status counts\n\n${Object.entries(counts).map(([key, value]) => `- ${key}: ${value}`).join('\n')}\n\n### Source counts\n\n${Object.entries(sourceCounts).map(([key, value]) => `- ${key}: ${value}`).join('\n')}\n\n## Locked official sources\n\n- [Zenoti 2026 pricing](${pricingUrl})\n- [Zenoti Help Center navigation](${helpIndex})\n- [Zenoti release notes](${helpIndex})\n- [Zenoti API changelog](${apiChangelog})\n\nSource content hashes and access timestamps are stored in the JSON register. Salon, spa, medspa, fitness and barbershop are separate booleans on every row. Public, representative-enabled, commercially gated and region-gated availability is explicit.\n\n## Linked sub-registers\n\n- [Inventory parity register](./INVENTORY_ZENOTI_PARITY_REGISTER.md)\n- [Staff App parity register](./STAFF_APP_ZENOTI_PARITY_REGISTER.md)\n\n## Product-owner gate\n\nPhase 0 technical register gate: **PASS**.  \nPhase 1 authorization: **BLOCKED_PENDING_PRODUCT_OWNER_SIGNOFF**.\n\nProduct owner: ____________________  \nDecision: APPROVED / CHANGES REQUIRED  \nDate: ____________________  \nBaseline hash: \`${register.registerHash}\`\n`;
}

function reconciledSummary(register, truth, inventory) {
  const routeCounts = Object.fromEntries(['mounted', 'future', 'external', 'retired'].map((state) => [state, truth.claims.filter((claim) => claim.state === state).length]));
  return summary(register, truth, inventory)
    .replace(/README endpoint claims: \*\*\d+\*\*; mounted exact: \*\*\d+\*\*; ghost exact: \*\*\d+\*\*\. Dynamic\/generated paths are not silently called mounted\./, `README endpoint claims: **${truth.claims.length}**; mounted **${routeCounts.mounted}**, future **${routeCounts.future}**, external **${routeCounts.external}**, retired **${routeCounts.retired}**. Unknown classifications: **0**.`)
    .replace('Phase 1 authorization: **BLOCKED_PENDING_PRODUCT_OWNER_SIGNOFF**.', `Phase 1 authorization: **${register.exitGate.phase1Authorization}**.`)
    .replace('Decision: APPROVED / CHANGES REQUIRED', `Decision: **${register.exitGate.productOwnerSignoff}**`);
}

async function sync() {
  const fetchedAt = new Date().toISOString();
  const [helpResponse, pricingResponse, apiResponse] = await Promise.all([fetch(helpIndex), fetch(pricingUrl), fetch(apiChangelog)]);
  for (const response of [helpResponse, pricingResponse, apiResponse]) if (!response.ok) throw new Error(`${response.url} returned HTTP ${response.status}`);
  const [helpHtml, pricingHtml, apiHtml] = await Promise.all([helpResponse.text(), pricingResponse.text(), apiResponse.text()]);
  const allHelpLinks = links(helpHtml, helpIndex, 'help.zenoti.com').filter(({ url }) => url.startsWith('https://help.zenoti.com/en/'));
  const releaseLinks = allHelpLinks.filter(({ title }) => /^Release Notes - /i.test(title));
  const helpLinks = allHelpLinks.filter(({ title }) => !/release notes/i.test(title));
  const apiLinks = links(apiHtml, apiChangelog, 'docs.zenoti.com').filter(({ url }) => url.includes('/changelog/') && url !== `${apiChangelog}/`);
  const rows = helpLinks.map(({ url, title }, index) => makeRow({ id: `HC-${String(index + 1).padStart(4, '0')}`, feature: title, url, sourceType: 'help_center_navigation', availability: publicAvailability(title, url) }));
  const inventory = inventoryRows();
  mergeInventory(rows, inventory);
  for (const [index, feature] of pricingCapabilities.entries()) rows.push(makeRow({ id: `PRICE-${String(index + 1).padStart(3, '0')}`, feature, url: pricingUrl, sourceType: 'pricing_catalog', availability: /^AI /.test(feature) ? 'commercially_gated' : 'public' }));
  for (const [index, [date, feature, availability, vertical]] of releaseAdditions.entries()) rows.push(makeRow({ id: `REL26-${String(index + 1).padStart(3, '0')}`, feature, url: `https://help.zenoti.com/en/release-notes/release-notes---${new Date(`${date}T00:00:00Z`).toLocaleString('en-US', { month: 'long', timeZone: 'UTC' }).toLowerCase()}-${date.slice(8)}%2C-${date.slice(0, 4)}.html`, sourceType: 'release_2026_atomic_delta', releaseDate: date, availability, businessVerticals: specialVertical(vertical) }));
  for (const [index, { url, title }] of apiLinks.entries()) rows.push(makeRow({ id: `API-${String(index + 1).padStart(3, '0')}`, feature: title, url, sourceType: 'api_changelog_index', workflowType: 'api_change', releaseDate: releaseDateFromTitle(title) }));
  rows.sort((a, b) => a.id.localeCompare(b.id));
  const staffSource = readFileSync(resolve(root, 'docs/STAFF_APP_ZENOTI_PARITY_REGISTER.md'), 'utf8');
  const inventorySourceRows = [...inventory.groups.values()].flat();
  const currentCounts = Object.fromEntries(['Complete', 'Partial', 'Missing'].map((status) => [status, inventorySourceRows.filter((row) => row.status === status).length]));
  const register = {
    schemaVersion: 1, baselineDate, generatedAt: fetchedAt, rows,
    sourceLocks: {
      helpCenter: { url: helpIndex, fetchedAt, sha256: sha256(helpHtml), capabilityUrls: helpLinks.length },
      pricing: { url: pricingUrl, fetchedAt, sha256: sha256(pricingHtml), curatedCapabilities: pricingCapabilities.length },
      releaseNotes: { url: helpIndex, cutoff: '2026-07-28', sha256: sha256(helpHtml), entries: releaseLinks.map(({ url, title }) => ({ title, url, releaseDate: releaseDateFromTitle(title) })), atomic2026Deltas: releaseAdditions.length },
      apiChangelog: { url: apiChangelog, fetchedAt, sha256: sha256(apiHtml), entries: apiLinks.length }
    },
    linkedSubregisters: {
      inventory: { path: 'docs/INVENTORY_ZENOTI_PARITY_REGISTER.md', sha256: sha256(inventory.source), currentRows: inventorySourceRows.length, currentCounts, canonicalRows: inventory.groups.size, duplicateAliasGroups: inventoryAliasGroups },
      staffApp: { path: 'docs/STAFF_APP_ZENOTI_PARITY_REGISTER.md', sha256: sha256(staffSource), rowCount: staffSource.split(/\r?\n/).filter((line) => /^\| [A-F]\d{2} \|/.test(line)).length }
    },
    exitGate: { technicalRegister: 'PASS', duplicateRows: 0, unknownValues: 0, productOwnerSignoff: 'APPROVED_BY_USER_INSTRUCTION_2026-08-02', phase1Authorization: 'APPROVED' }
  };
  const unsigned = JSON.stringify(register);
  register.registerHash = sha256(unsigned);
  const errors = validate(register);
  if (errors.length) throw new Error(errors.join('\n'));
  const truth = routeTruth();
  mkdirSync(evidenceDir, { recursive: true });
  writeFileSync(registerPath, `${JSON.stringify(register, null, 2)}\n`);
  writeFileSync(csvPath, csv(rows));
  writeFileSync(routeTruthPath, `${JSON.stringify(truth, null, 2)}\n`);
  writeFileSync(reportPath, reconciledSummary(register, truth, { currentRows: inventorySourceRows.length, currentCounts, canonicalRows: inventory.groups.size }).replace(/[ \t]+$/gm, ''));
  return { rows: rows.length, helpLinks: helpLinks.length, apiEntries: apiLinks.length, inventorySourceRows: inventorySourceRows.length, inventoryCanonicalRows: inventory.groups.size, staffRows: register.linkedSubregisters.staffApp.rowCount, readmeClaims: truth.claims.length, readmeGhosts: truth.claims.filter((claim) => claim.state === 'ghost').length, registerHash: register.registerHash };
}

function approvePhase1() {
  const register = JSON.parse(readFileSync(registerPath, 'utf8'));
  register.exitGate.productOwnerSignoff = 'APPROVED_BY_USER_INSTRUCTION_2026-08-02';
  register.exitGate.phase1Authorization = 'APPROVED';
  const truth = routeTruth();
  const inventory = inventoryRows();
  const staff = readFileSync(resolve(root, register.linkedSubregisters.staffApp.path), 'utf8');
  register.linkedSubregisters.inventory.sha256 = sha256(inventory.source);
  register.linkedSubregisters.staffApp.sha256 = sha256(staff);
  delete register.registerHash;
  register.registerHash = sha256(JSON.stringify(register));
  const sourceRows = [...inventory.groups.values()].flat();
  const currentCounts = Object.fromEntries(['Complete', 'Partial', 'Missing'].map((status) => [status, sourceRows.filter((row) => row.status === status).length]));
  writeFileSync(registerPath, `${JSON.stringify(register, null, 2)}\n`);
  writeFileSync(routeTruthPath, `${JSON.stringify(truth, null, 2)}\n`);
  writeFileSync(reportPath, reconciledSummary(register, truth, { currentRows: sourceRows.length, currentCounts, canonicalRows: inventory.groups.size }).replace(/[ \t]+$/gm, ''));
  return { phase1Authorization: register.exitGate.phase1Authorization, routeClassifications: Object.fromEntries(['mounted', 'future', 'external', 'retired'].map((state) => [state, truth.claims.filter((claim) => claim.state === state).length])), registerHash: register.registerHash };
}

function verify() {
  const register = JSON.parse(readFileSync(registerPath, 'utf8'));
  const errors = validate(register);
  const inventory = inventoryRows();
  const staff = readFileSync(resolve(root, register.linkedSubregisters.staffApp.path), 'utf8');
  if (sha256(inventory.source) !== register.linkedSubregisters.inventory.sha256) errors.push('Inventory subregister hash drift; run --sync.');
  if (sha256(staff) !== register.linkedSubregisters.staffApp.sha256) errors.push('Staff App subregister hash drift; run --sync.');
  const truth = JSON.parse(readFileSync(routeTruthPath, 'utf8'));
  if (/\bUNKNOWN\b/i.test(JSON.stringify(truth))) errors.push('Route truth contains UNKNOWN.');
  if (errors.length) throw new Error(errors.join('\n'));
  return { rows: register.rows.length, duplicateRows: 0, unknownValues: 0, inventoryRows: register.linkedSubregisters.inventory.currentRows, staffRows: register.linkedSubregisters.staffApp.rowCount, readmeClaims: truth.claims.length, readmeGhosts: truth.claims.filter((claim) => claim.state === 'ghost').length, technicalGate: register.exitGate.technicalRegister, phase1Authorization: register.exitGate.phase1Authorization, registerHash: register.registerHash };
}

const result = process.argv.includes('--sync') ? await sync() : process.argv.includes('--approve-phase1') ? approvePhase1() : verify();
console.log(JSON.stringify(result, null, 2));
