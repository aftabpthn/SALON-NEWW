import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

test('target incentives uses connected incentive and performance APIs', () => {
  const models = read('../src/app/features/staff-os/domain/staff-os.models.ts');
  const store = read('../src/app/features/staff-os/application/staff-os.store.ts');
  const routes = read('../../backend-rust/src/routes/staff_advanced.rs');
  const setup = read('../src/app/pages/staff/payroll/staff-payroll-setup.component.ts');

  assert.match(models, /'target-incentive': \{[\s\S]+path: '\/staff\/incentive-rules'/);
  // PerformanceQuery is rename_all = "camelCase", so the wire names are dateFrom/dateTo.
  assert.match(models, /'target-incentive': \{[\s\S]+path: '\/staff\/performance\?dateFrom=\{periodStart\}&dateTo=\{periodEnd\}'/);
  assert.match(models, /Add incentive rule[\s\S]+route: '\/staff\/payroll\?tab=setup&section=incentives'/);
  assert.match(models, /leaderboard: \{[\s\S]+path: '\/staff\/performance\?dateFrom=\{periodStart\}&dateTo=\{periodEnd\}'/);

  assert.match(store, /\.replace\('\{periodStart\}', periodStart\)/);
  assert.match(store, /\.replace\('\{periodEnd\}', periodEnd\)/);
  assert.match(routes, /#\[serde\(rename_all = "camelCase"\)\]\s*struct PerformanceQuery \{[\s\S]+date_from: NaiveDate,[\s\S]+date_to: NaiveDate/);
  assert.match(routes, /route\("\/staff\/performance", get\(get_performance\)\)/);
  assert.match(setup, /if \(section === 'incentives'\) this\.incentives = await this\.get<IncentiveRule\[]>\('\/staff\/incentive-rules'\)/);
  assert.match(setup, /this\.api\.post\('\/staff\/incentive-rules'/);
});
