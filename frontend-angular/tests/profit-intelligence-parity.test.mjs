import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const page = readFileSync('src/app/pages/reports/reports-page.component.ts', 'utf8');
const template = readFileSync('src/app/pages/reports/reports-page.component.html', 'utf8');
const appRoutes = readFileSync('src/app/app.routes.ts', 'utf8');
const routes = readFileSync('../backend-rust/src/routes/reports.rs', 'utf8');
const service = readFileSync('../backend-rust/src/services/analytics_service.rs', 'utf8');
const repository = readFileSync('../backend-rust/src/repositories/analytics_repository.rs', 'utf8');
const governance = readFileSync('../backend-rust/src/services/profit_governance_service.rs', 'utf8');
const authRoutes = readFileSync('../backend-rust/src/routes/auth.rs', 'utf8');
const english = readFileSync('src/app/core/i18n/catalogs/en-in.ts', 'utf8');
const hindi = readFileSync('src/app/core/i18n/catalogs/hi-in.ts', 'utf8');
const dailyRollupMigration = readFileSync('../backend-rust/migrations/0281_micro_profit_daily_rollup.sql', 'utf8');

test('old Profit Intelligence capabilities stay inside the existing Reports workspace', () => {
  assert.match(appRoutes, /path: 'reports\/profit-intelligence'/);
  assert.match(page, /navigateByUrl\('\/reports\/profit-intelligence'\)/);
  for (const tab of ['executive', 'category', 'booking', 'liability', 'scenario', 'guard']) {
    assert.match(page, new RegExp(`id: '${tab}'`));
  }
  for (const label of [
    'Executive profit intelligence',
    'Customer profit score',
    'Profit-ranked booking windows',
    'Membership and package liability risk',
    'Profit Digital Twin',
    'POS negative-margin guard',
    'Overhead allocation rules',
  ]) {
    assert.ok(template.includes(label), `${label} is not visible in Reports`);
  }
});

test('ported insights use real Micro P&L, appointment, deferred revenue and governance sources', () => {
  for (const field of [
    'category_profit',
    'booking_recommendations',
    'liability_risks',
    'executive_kpis',
    'customer_profit_scores',
    'enterprise_analytics',
    'profit_digital_twin',
    'board_report',
  ]) {
    assert.ok(service.includes(field), `${field} is missing from the advanced contract`);
  }
  assert.match(repository, /FROM appointments appointment/);
  assert.match(repository, /accounting_deferred_revenue_schedules/);
  assert.match(repository, /micro_profit_events/);
  assert.match(routes, /profit-intelligence\/pos-margin-check/);
  assert.match(page, /profit-intelligence\/allocation-rules/);
  assert.match(template, /Create version/);
  assert.match(routes, /post\(evaluate_profit_discount\)/);
  assert.match(governance, /action_type: "membership_liability_risk"/);
  assert.match(governance, /action_type: "high_expense"/);
  assert.doesNotMatch(template, /Sample POS invoice|dummy|mock/i);
});

test('local real-data scope resolves database IDs and empty periods cannot close', () => {
  assert.match(authRoutes, /SELECT id(?:::TEXT)? FROM tenants WHERE id(?:::TEXT)?='tenant_aura'/);
  assert.match(authRoutes, /SELECT id(?:::TEXT)? FROM branches WHERE tenant_id=\$1/);
  assert.match(service, /let reconciled = row\.reportable_line_count > 0/);
  assert.doesNotMatch(service, /let allocation_ready = row\.reportable_line_count == 0/);
});

test('optional Profit Intelligence panels cannot blank the core report', () => {
  assert.match(page, /get\('\/api\/v1\/reports\/custom'\)\.catch\(\(\) => null\)/);
  assert.match(page, /comparePrevious \? get\(`\/api\/v1\/profit-intelligence\/advanced\?\$\{previousQuery\}`\)\.catch\(\(\) => null\)/);
  assert.match(page, /await this\.loadProfitTabData\(\)/);
  assert.match(page, /if \(this\.profitTab === 'actions'\)[\s\S]*await this\.loadActions\(\)/);
  assert.match(page, /this\.actions = this\.data<ProfitAction\[\]>\(response\) \?\? \[\]/);
  assert.match(page, /if \(\['rules', 'approvals', 'audit'\]\.includes\(this\.profitTab\)\) this\.governanceError = message/);
});

test('Profit Intelligence mutations and headline numbers stay trustworthy', () => {
  for (const handler of ['repair_missing_invoice_journals', 'create_micro_profit_allocation_rule']) {
    const body = routes.match(new RegExp(`async fn ${handler}\\([\\s\\S]*?\\n}`))?.[0] ?? '';
    assert.match(body, /ensure_profit_governance_approver\(&claims\)\?/);
  }
  assert.doesNotMatch(page, /profit-intelligence\/summary\?\$\{query\}/);
  assert.match(page, /'Revenue \(INR\)'/);
  assert.match(page, /row\.revenuePaise \/ 100/);
  assert.match(template, /profitCostsComplete \? money\(microOverview\.profit\) : '—'/);
  assert.match(template, /Complete lines/);
  assert.match(template, /Cost source coverage/);
});

test('Profit Intelligence rejects inverted date ranges before API work', () => {
  assert.match(page, /private validateProfitDateRange\(\): boolean \{[\s\S]*this\.fromDate <= this\.toDate[\s\S]*From date must be on or before To date/);
  for (const handler of ['loadProfitWorkspace', 'repairInvoiceJournals', 'markLeakReviewed', 'openProfitDrill']) {
    const body = page.match(new RegExp(`async ${handler}\\([^)]*\\): Promise<void> \\{[\\s\\S]*?\\n  }`))?.[0] ?? '';
    assert.match(body, /validateProfitDateRange\(\)/, `${handler} can bypass date validation`);
  }
});

test('Profit Intelligence closes the remaining audit gaps without a parallel module', () => {
  assert.match(dailyRollupMigration, /CREATE TABLE IF NOT EXISTS micro_profit_daily_rollup/);
  assert.match(dailyRollupMigration, /refresh_micro_profit_daily_rollup/);
  assert.match(dailyRollupMigration, /micro_profit_rollup_dirty_days/);
  assert.match(repository, /FROM micro_profit_daily_rollup/);
  assert.match(service, /ensure_micro_profit_daily_rollup/);
  assert.match(page, /takeUntil\(this\.profitReload\$\)/);
  assert.match(page, /view: this\.profitTab/);
  assert.match(routes, /advanced_profit_intelligence_for_view/);
  assert.match(service, /needs_recipe[\s\S]*needs_booking[\s\S]*needs_liability[\s\S]*needs_daily/);
  assert.match(template, /enterpriseAnalytics\.alerts/);
  assert.match(template, /trendPoints\('revenuePaise'\)/);
  assert.match(page, /private profitExportRecords/);
  assert.doesNotMatch(template, />Export P&amp;L</);
  assert.match(page, /profitView: \{ tab: this\.profitTab/);
  assert.doesNotMatch(page, /window\.prompt/);
  assert.doesNotMatch(template, /\(paise\)/i);
  assert.match(template, /role="tablist"/);
  assert.match(template, /role="button" tabindex="0"[\s\S]*keydown\.space/);
  assert.match(template, /role="dialog" aria-modal="true"/);
  assert.match(template, /\[attr\.inert\]/);
  assert.match(template, /loadMoreProfitDrill/);
  assert.match(template, /openPeriodClose/);
  assert.match(template, /governanceError/);
  assert.match(template, /profit\.title' \| translate/);
  for (const key of ['profit.title', 'profit.group.dimensions', 'profit.tab.reconciliation', 'profit.action.addExpense', 'profit.dialog.closeReason']) {
    assert.ok(english.includes(`'${key}'`), `${key} is missing from English`);
    assert.ok(hindi.includes(`'${key}'`), `${key} is missing from Hindi`);
  }
});

test('Profit Intelligence command actions stay wired to real destinations', () => {
  for (const key of [
    'profit.action.addExpense',
    'profit.action.addCogs',
    'profit.action.addAdjustment',
    'profit.action.createLeak',
    'profit.action.markReviewed',
    'profit.openReconciliation',
  ]) {
    assert.ok(template.includes(key), `${key} command is missing`);
  }
  assert.match(page, /navigateByUrl\('\/finance\/outgoing-funds'\)/);
  assert.match(page, /navigateByUrl\('\/purchase-orders'\)/);
  assert.match(page, /actionType: 'manual_profit_adjustment'/);
  assert.match(page, /actionType: 'profit_leak_review'/);
  assert.match(page, /selectProfitTab\('reconciliation'\)/);
  assert.match(page, /profit-intelligence\/actions\/\$\{action\.id\}\/dismiss/);
  assert.match(template, /exportProfit\('csv'\)[^\n]*>CSV</);
});
