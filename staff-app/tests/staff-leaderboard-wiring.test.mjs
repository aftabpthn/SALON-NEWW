import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "vitest";

const page = readFileSync("src/app/features/staff/staff-leaderboard.page.ts", "utf8");
const appService = readFileSync("../backend-rust/src/services/staff_app_service.rs", "utf8");
const route = readFileSync("../backend-rust/src/routes/staff_enterprise.rs", "utf8");
const performanceRepository = readFileSync("../backend-rust/src/repositories/staff_advanced_repository.rs", "utf8");

test("leaderboard is branch-scoped, range-aware, real-data ranked, and revenue protected", () => {
  assert.match(page, /periodDays = signal\(30\)/);
  assert.match(page, /enterpriseOs\(\{ from: businessDateOffset\(1 - this\.periodDays\(\), to\), to \}\)/);
  assert.match(page, /data\.gamification\.activeDays/);
  assert.match(appService, /staff_advanced_service::performance\(db, tenant_id, branch_id, from, to, ""\)/);
  assert.match(appService, /right[\s\S]{0,180}score[\s\S]{0,180}performance_points/);
  assert.match(appService, /"leaderboard":leaderboard/);
  assert.match(appService, /"badges":badges/);
  assert.match(route, /os\["leaderboard"\]\.as_array_mut\(\)[\s\S]{0,120}row\["revenue"\] = json!\(null\)/);
  assert.match(performanceRepository, /review_metrics[\s\S]{0,320}staff_performance_reviews/);
});
