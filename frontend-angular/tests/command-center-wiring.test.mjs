import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const routes = readFileSync('src/app/app.routes.ts', 'utf8');
const sidebar = readFileSync('src/app/layout/app-sidebar.component.ts', 'utf8');
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

test('Command Center preserves management access in route and sidebar', () => {
  assert.match(routes, /roles: \['owner', 'admin', 'super-admin', 'manager', 'analyst'\], permissions: \['reports\.read'\], deniedRedirect: '\/dashboard'/);
  assert.match(sidebar, /hasRole\('owner', 'admin', 'super-admin', 'manager', 'analyst'\)/);
  assert.match(sidebar, /hasPermission\('reports\.read'\)/);
});

test('Command Center gates restricted data and actions with current claims', () => {
  for (const gate of ['canReadStaff', 'canReadInventory', 'canReadPaymentControls', 'canReadSecurity', 'canReadLocations', 'canManageLocations']) {
    assert.ok(page.includes(`get ${gate}()`), `${gate} is not defined`);
    assert.ok(template.includes(gate), `${gate} is not rendered`);
  }
  assert.match(template, /Access restricted/);
});

test('Command Center loads real branch APIs without a redundant health request', () => {
  for (const endpoint of [
    '/api/v1/reports/dashboard',
    '/api/v1/profit-intelligence/summary',
    '/api/v1/staff-enterprise/command-center',
    '/api/v1/inventory/command-center',
    '/api/v1/security/summary',
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
    'Staff Control',
    'Inventory Autopilot',
    'Payment Intelligence',
    'Security Center',
    'Operational Dashboard',
  ]) {
    assert.ok(template.includes(workspace), `${workspace} is not linked`);
  }
});
