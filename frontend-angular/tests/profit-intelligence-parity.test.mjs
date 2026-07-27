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
  assert.match(authRoutes, /SELECT id FROM tenants WHERE id='tenant_aura'/);
  assert.match(authRoutes, /SELECT id FROM branches WHERE tenant_id=\$1/);
  assert.match(service, /let reconciled = row\.reportable_line_count > 0/);
  assert.doesNotMatch(service, /let allocation_ready = row\.reportable_line_count == 0/);
});

test('optional Profit Intelligence panels cannot blank the core report', () => {
  for (const optionalPath of [
    'profit-intelligence/actions',
    'profit-intelligence/governance/summary',
    'profit-intelligence/governance/rules',
    'reports/custom',
  ]) {
    assert.match(page, new RegExp(`${optionalPath.replaceAll('/', '\\/')}(?:[^\\n]*)\\.catch\\(\\(\\) => null\\)`));
  }
  assert.match(page, /comparePrevious \? firstValueFrom\(this\.api\.get<any>\(`\/api\/v1\/profit-intelligence\/advanced\?\$\{previousQuery\}`\)\)\.catch\(\(\) => null\)/);
  assert.match(page, /this\.actions = actions \? this\.data<ProfitAction\[\]>\(actions\) \?\? \[\] : \[\]/);
});

test('Profit Intelligence command actions stay wired to real destinations', () => {
  for (const label of [
    'Add expense',
    'Add cost of goods',
    'Add adjustment',
    'Create profit leak action',
    'Mark reviewed',
    'Export P&amp;L',
    'Open reconciliation',
  ]) {
    assert.ok(template.includes(label), `${label} command is missing`);
  }
  assert.match(page, /navigateByUrl\('\/finance\/outgoing-funds'\)/);
  assert.match(page, /navigateByUrl\('\/purchase-orders'\)/);
  assert.match(page, /actionType: 'manual_profit_adjustment'/);
  assert.match(page, /actionType: 'profit_leak_review'/);
  assert.match(page, /profitTab = 'reconciliation'/);
  assert.match(page, /profit-intelligence\/actions\/\$\{action\.id\}\/dismiss/);
  assert.match(template, /exportProfit\('csv'\)[\s\S]*Export P&amp;L/);
});
