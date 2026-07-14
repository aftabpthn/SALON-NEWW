import test from "node:test";
import assert from "node:assert/strict";
import { staffSelfResponsePresenterService } from "../server/services/staff-self-response-presenter.service.js";

const financialAccess = { role: "owner", permissions: [] };

test("staff dashboard presents legacy rupee sales as canonical integer paise", () => {
  const result = staffSelfResponsePresenterService.dashboard({
    summary: { revenue: 2596, appointmentValue: 2200, salesCount: 1 },
    sales: [{ id: "sale-1", total: 2596, commissionTotal: 259.6 }]
  }, financialAccess);

  assert.deepEqual(result.summary, { revenue: 259600, appointmentValue: 220000, salesCount: 1 });
  assert.deepEqual(result.sales, [{ id: "sale-1", total: 259600, commissionTotal: 25960 }]);
});

test("staff enterprise money fields use the same paise contract", () => {
  const result = staffSelfResponsePresenterService.enterprise({
    home: { expectedRevenue: 2596, targetProgress: { targetValue: 5000, achievedValue: 2596, remaining: 2404 } },
    performance: { revenue: 2596 },
    leaderboard: [{ staffId: "staff-1", revenue: 2596 }],
    reports: { daily: { revenue: 2596, services: 1 } }
  }, financialAccess);

  assert.equal(result.home.expectedRevenue, 259600);
  assert.deepEqual(result.home.targetProgress, { targetValue: 500000, achievedValue: 259600, remaining: 240400 });
  assert.equal(result.performance.revenue, 259600);
  assert.equal(result.leaderboard[0].revenue, 259600);
  assert.deepEqual(result.reports.daily, { revenue: 259600, services: 1 });
});
