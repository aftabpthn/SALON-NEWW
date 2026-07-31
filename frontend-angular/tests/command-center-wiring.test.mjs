import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const routes = readFileSync('src/app/app.routes.ts', 'utf8');
const sidebar = readFileSync('src/app/layout/app-sidebar.component.ts', 'utf8');
const header = readFileSync('src/app/layout/app-header.component.ts', 'utf8');
const page = readFileSync('src/app/pages/dashboard/command-center/command-center-page.component.ts', 'utf8');
const template = readFileSync('src/app/pages/dashboard/command-center/command-center-page.component.html', 'utf8');
const settings = readFileSync('src/app/pages/settings/settings-page.component.ts', 'utf8');
const branchRoutes = readFileSync('../backend-rust/src/routes/branches.rs', 'utf8');
const approvalMigration = readFileSync('../backend-rust/migrations/0215_multi_branch_approval_separation.sql', 'utf8');
const enterpriseMigration = readFileSync('../backend-rust/migrations/0216_multi_branch_enterprise_completion.sql', 'utf8');
const settlementMigration = readFileSync('../backend-rust/migrations/0222_multi_branch_settlement_ledger.sql', 'utf8');
const branchRepository = readFileSync('../backend-rust/src/repositories/branch_repository.rs', 'utf8');
const branchService = readFileSync('../backend-rust/src/services/branch_service.rs', 'utf8');
const walletService = readFileSync('../backend-rust/src/services/wallet_service.rs', 'utf8');
const analyticsService = readFileSync('../backend-rust/src/services/analytics_service.rs', 'utf8');
const analyticsRepository = readFileSync('../backend-rust/src/repositories/analytics_repository.rs', 'utf8');
const reportRoutes = readFileSync('../backend-rust/src/routes/reports.rs', 'utf8');
const governanceRepository = readFileSync('../backend-rust/src/repositories/profit_governance_repository.rs', 'utf8');
const governanceService = readFileSync('../backend-rust/src/services/profit_governance_service.rs', 'utf8');
const briefingService = readFileSync('../backend-rust/src/services/ai_briefing_service.rs', 'utf8');
const backendMain = readFileSync('../backend-rust/src/main.rs', 'utf8');
const rollbackMigration = readFileSync('../backend-rust/migrations/0339_profit_action_rollback.sql', 'utf8');

test('Command Center preserves management access in route and sidebar', () => {
  assert.match(routes, /roles: \['owner', 'admin', 'super-admin', 'manager', 'analyst'\], permissions: \['reports\.read'\], deniedRedirect: '\/dashboard'/);
  assert.match(sidebar, /filter\(\(group\) => this\.canNavigate\(group\.route\)\)/);
  assert.match(sidebar, /this\.auth\.hasAccess\(access\.roles, access\.permissions\)/);
});

test('Command Center gates restricted data and actions with current claims', () => {
  for (const gate of ['canReadInventory', 'canReadPaymentControls', 'canReadLocations', 'canManageLocations']) {
    assert.ok(page.includes(`get ${gate}()`), `${gate} is not defined`);
    assert.ok(template.includes(gate), `${gate} is not rendered`);
  }
  assert.match(template, /Access restricted/);
});

test('Header notifications open their related CRM screen', () => {
  assert.match(header, /navigateByUrl\(this\.notificationLink\(notification\)\)/);
  assert.match(header, /metadata\?\.sections[\s\S]*openReportLink/);
  for (const target of [
    '/staff/control-center?tab=governance',
    '/staff/leave-management',
    '/staff/control-center?tab=content',
    '/appointments',
    '/inventory',
    '/pos/invoices',
    '/marketing',
    '/sms-center',
  ]) assert.ok(header.includes(`'${target}'`), `${target} notification target is missing`);
  assert.match(header, /!link\.startsWith\('\/'\) \|\| link\.startsWith\('\/\/'\)/);
});

test('Command Center loads real branch APIs without a redundant health request', () => {
  for (const endpoint of [
    '/api/v1/reports/dashboard',
    '/api/v1/profit-intelligence/summary',
    '/api/v1/reports/appointments',
    '/api/v1/inventory/command-center',
    '/api/v1/reports/payment-modes',
    '/api/v1/pos/fraud-summary',
    '/api/v1/settings/franchise-controls',
    '/api/v1/membership-enterprise/settings',
    '/api/v1/settings/multi-branch/command-center',
    '/api/v1/settings/multi-branch/drilldown',
    '/api/v1/settings/multi-branch/export.${format}',
  ]) {
    assert.ok(page.includes(endpoint), `${endpoint} is not wired`);
  }
  assert.doesNotMatch(page, /this\.api\.health\(/);
});

test('Command Center explains its purpose and reports API state at the top', () => {
  assert.match(template, /Kahan risk hai, kyun hai aur kya action lena hai/);
  assert.match(template, /\{\{ liveStateLabel \}\}/);
  for (const status of ['Checking APIs', 'All APIs connected', 'APIs unavailable']) {
    assert.ok(page.includes(status), `${status} is missing`);
  }
  assert.match(page, /`\$\{this\.errors\.size\} APIs unavailable`/);
});

test('API drill-down tracks each live source and action queue uses real risk data', () => {
  assert.match(template, /\(click\)="apiStatusOpen = !apiStatusOpen"/);
  assert.match(template, /@for \(api of apiStatusRows; track api\.source\)/);
  assert.match(page, /sourceUpdatedAt\.set\(source, new Date\(\)\)/);
  assert.match(page, /this\.errors\.delete\(source\)/);
  for (const source of ['this.actions.map', 'this.inventoryCommand?.signals', 'this.paymentRisk?.openCount', 'this.locationConflicts.map', 'this.growth?.revenueLeaks']) {
    assert.ok(page.includes(source), `${source} is missing from the priority queue`);
  }
  assert.match(page, /priority\(right\.priority\) - priority\(left\.priority\)/);
  assert.match(template, /\[routerLink\]="action\.route"/);
  assert.match(template, /<span>Priority actions<\/span>[\s\S]*prioritizedActions\.length/);
});

test('Command Center connects all four saved forecasts, explanations, and branch anomalies', () => {
  for (const kind of ['revenue_forecast', 'inventory_reorder_risk', 'service_demand', 'no_show_risk']) {
    assert.ok(page.includes(`/api/v1/ai/predictions/${kind}/latest`), `${kind} latest forecast is not loaded`);
    assert.ok(page.includes(`/api/v1/ai/predictions/${kind}`), `${kind} cannot be refreshed`);
  }
  assert.match(page, /\/api\/v1\/ai\/briefing\/daily/);
  assert.match(page, /\/api\/v1\/ai\/briefing\/compare\/\$\{encodeURIComponent\(this\.branchSignal\)\}/);
  assert.match(template, /AI Forecasts &amp; Escalation/);
  assert.match(template, /Why: \{\{ action\.message \}\} · Expected: \{\{ action\.expectedImpact \}\}/);
  assert.match(template, /Auto escalation active[\s\S]*scanIntervalMinutes/);
});

test('Priority actions expose owner, deadline, SLA and approval-first transitions', () => {
  assert.match(page, /\/api\/v1\/profit-intelligence\/actions\?status=all&limit=200/);
  assert.match(page, /\/api\/v1\/profit-intelligence\/governance\/audit\?limit=100/);
  assert.match(page, /actions\/\$\{encodeURIComponent\(action\.managedActionId\)\}\/\$\{transition\}/);
  assert.match(template, /action\.ownerName \|\| 'Owner pending'/);
  assert.match(template, /SLA overdue/);
  for (const transition of ['approve', 'complete', 'dismiss', 'rollback']) {
    assert.ok(template.includes(`transitionGovernedAction(action, '${transition}')`), `${transition} action is not rendered`);
  }
  assert.match(page, /createdByUserId !== this\.auth\.userId/);
});

test('Action rollback is scoped, audited and reopens linked governance state', () => {
  assert.match(reportRoutes, /\/profit-intelligence\/actions\/:id\/rollback[\s\S]*post\(rollback_profit_action\)/);
  assert.match(reportRoutes, /rollback_profit_action[\s\S]*ensure_profit_governance_approver/);
  assert.match(governanceService, /rollback note must be 1 to 500 characters/);
  assert.match(governanceRepository, /WHERE action\.tenant_id=\$1 AND action\.branch_id=\$2 AND action\.id=\$3[\s\S]*FOR UPDATE OF action/);
  assert.match(governanceRepository, /UPDATE profit_action_queue[\s\S]*status='pending'/);
  assert.match(governanceRepository, /UPDATE profit_governance_approvals SET status='pending'/);
  assert.match(governanceRepository, /UPDATE profit_governance_decisions SET status='pending'/);
  assert.match(governanceRepository, /"action_rolled_back"/);
  assert.match(rollbackMigration, /'action_rolled_back'/);
});

test('Briefing advertises the same cadence used by its automatic worker', () => {
  assert.match(briefingService, /BRIEFING_WORKER_INTERVAL_SECONDS: u64 = 21_600/);
  assert.match(briefingService, /automation_active: true/);
  assert.match(briefingService, /scan_interval_minutes: BRIEFING_WORKER_INTERVAL_SECONDS \/ 60/);
  assert.match(backendMain, /BRIEFING_WORKER_INTERVAL_SECONDS[\s\S]{0,300}run_daily_briefing_worker/);
});

test('Executive Overview uses matching today and 30-day real-data columns', () => {
  assert.match(template, /<span>Today<\/span><span>30 days<\/span>/);
  assert.match(template, /appointmentCount30Days/);
  assert.match(page, /get appointmentCount30Days\(\)/);
  assert.match(page, /reports\/appointments\?startDate=\$\{this\.dateOffset\(-29\)\}&endDate=\$\{this\.dateOffset\(0\)\}&pageSize=500/);
  assert.doesNotMatch(template, /Current <strong>30 days<\/strong>/);
});

test('Command Center uses real multi-branch controls without source demo records', () => {
  for (const label of ['Multi-Branch Command Center', 'Sharing governance', 'Approval queue', 'Conflicts', 'Average ticket', 'Member liability']) {
    assert.ok(template.includes(label), `${label} is not rendered`);
  }
  assert.match(page, /settings\/multi-branch\/approvals/);
  assert.match(page, /startDate: this\.locationStartDate/);
  assert.match(page, /query\.set\('branchId'/);
  assert.match(template, /Branch report date range/);
  assert.doesNotMatch(`${page}\n${template}`, /Aura Franchise|revenueRiskCount|manpowerGapCount|healthScore|createFranchise|demoBranch|mockBranch/);
});

test('Multi-branch reporting exposes real operational metrics and drilldowns', () => {
  for (const metric of ['refundPaise', 'tipPaise', 'cashVariancePaise', 'transferCount', 'shortageCount', 'crossLocationRedeemedPaise', 'giftCardLiabilityPaise', 'sharedCustomerCount']) {
    assert.ok(page.includes(metric), `${metric} is not wired`);
    assert.ok(branchRepository.includes(metric.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`)), `${metric} is not API-backed`);
  }
  for (const kind of ['sales', 'appointments', 'refunds', 'transfers', 'membershipRedemptions', 'registerClosings', 'conflicts', 'interBranchSettlements']) {
    assert.ok(page.includes(`'${kind}'`), `${kind} drilldown is not wired`);
  }
});

test('Inter-branch settlement is tenant-safe, journaled, atomic and reloadable', () => {
  assert.match(settlementMigration, /UNIQUE \(tenant_id, redemption_id\)/);
  assert.match(settlementMigration, /source_accrual_journal_id/);
  assert.match(settlementMigration, /target_payment_journal_id/);
  assert.match(branchRepository, /FOR UPDATE OF redemption/);
  assert.match(branchRepository, /multi_branch_settlements WHERE tenant_id=\$1 AND redemption_id=\$2 FOR UPDATE/);
  assert.match(branchService, /post_control_journal\([\s\S]*inter_branch_accrual/);
  assert.match(branchService, /post_control_journal\([\s\S]*inter_branch_payment/);
  assert.match(branchService, /tx\.commit\(\)/);
  assert.match(page, /settleInterBranchRedemption/);
  assert.match(page, /this\.loadLocations\(\)/);
});

test('Command Center exports genuine XLSX and PDF with field conflict snapshots', () => {
  assert.match(branchRoutes, /ZipWriter/);
  assert.match(branchRoutes, /render_text_report\("Multi-Branch Command Center"/);
  assert.match(branchRoutes, /application\/vnd\.openxmlformats-officedocument\.spreadsheetml\.sheet/);
  assert.match(branchRepository, /'centralValue',diff\.central_value/);
  assert.match(branchRepository, /'branchValue',diff\.branch_value/);
  assert.match(branchRepository, /'overridden',diff\.overridden/);
  for (const field of ['pricePaise', 'sacCode', 'waitTimeMinutes', 'cleanupTimeMinutes', 'bufferTimeMinutes', 'hsnCode', 'barcode', 'batchTracked']) {
    assert.ok(branchRepository.includes(`('${field}'`), `${field} conflict snapshot is missing`);
  }
  for (const format of ['csv', 'xlsx', 'pdf']) assert.ok(template.includes(`exportLocation('${format}')`));
});

test('Sharing remains explicit and POS enforcement uses verified linked identities', () => {
  for (const field of ['allowGiftCards', 'allowLoyaltyPoints']) {
    assert.ok(settings.includes(field), `${field} is not configurable`);
    assert.ok(enterpriseMigration.includes(field), `${field} is not enforced`);
  }
  assert.match(enterpriseMigration, /customer_account_clients source_link/);
  assert.match(walletService, /membership_cross_location_allowed\([\s\S]*'gift_card'/);
});

test('Assigned branch scope and product overrides are enforced server-side', () => {
  assert.match(branchRepository, /user_branch_roles access/);
  assert.match(branchRepository, /franchise_override_fields/);
  assert.match(enterpriseMigration, /ALTER TABLE inventory_items[\s\S]*franchise_override_fields/);
});

test('Organization reports reuse the saved report scheduler with owner-only dataset access', () => {
  assert.match(analyticsService, /"id":"multiBranch"/);
  assert.match(analyticsService, /process_due_custom_reports/);
  assert.match(analyticsService, /purpose":"custom_bi_report"/);
  assert.match(analyticsRepository, /dataset == "multiBranch"/);
});

test('Settings reuses membership settings and reloads the complete saved payload', () => {
  assert.match(settings, /api\.patch\('\/api\/v1\/membership-enterprise\/settings'/);
  assert.match(settings, /await this\.loadSharingPolicy\(\);/);
  assert.match(settings, /this\.membershipSettings = body/);
  assert.match(settings, /settings\/multi-branch\/approvals/);
  assert.doesNotMatch(settings, /franchise-controls\/publish/);
});

test('Central master publication cannot bypass approval separation', () => {
  assert.match(branchRoutes, /request_multi_branch_approval/);
  assert.doesNotMatch(branchRoutes, /branch_service::publish_central_masters/);
  assert.match(approvalMigration, /decided_by <> requested_by/);
});

test('Command Center keeps every implemented workspace linked', () => {
  for (const workspace of [
    'Profit Intelligence',
    'Inventory Autopilot',
    'Payment Intelligence',
    'Operational Dashboard',
  ]) {
    assert.ok(template.includes(workspace), `${workspace} is not linked`);
  }
  assert.doesNotMatch(template, /Staff Control/);
  assert.doesNotMatch(template, /routerLink="\/staff\/control-center"/);
  assert.doesNotMatch(sidebar.match(/label: 'Command Center'[\s\S]*?\] \}/)?.[0] ?? '', /Staff Control|\/staff\/control-center/);
  assert.match(sidebar.match(/label: 'Staff'[\s\S]*?\] \}/)?.[0] ?? '', /route: '\/staff\/control-center'/);
  assert.doesNotMatch(sidebar.match(/label: 'Command Center'[\s\S]*?\] \}/)?.[0] ?? '', /Profit Intelligence|Inventory Autopilot|\/reports\/profit-intelligence|\/inventory\/advanced-controls/);
  assert.doesNotMatch(template, /Security Center/);
  assert.doesNotMatch(template, /routerLink="\/security"/);
  assert.doesNotMatch(sidebar.match(/label: 'Command Center'[\s\S]*?\] \}/)?.[0] ?? '', /Security Center|\/security/);
  assert.match(sidebar.match(/label: 'Security'[\s\S]*?\] \}/)?.[0] ?? '', /route: '\/security'/);
  assert.match(template, /routerLink="\/reports\/profit-intelligence"/);
});
