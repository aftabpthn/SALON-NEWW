import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "vitest";

const page = readFileSync("src/app/features/staff/staff-performance.page.ts", "utf8");
const appService = readFileSync("../backend-rust/src/services/staff_app_service.rs", "utf8");
const performanceService = readFileSync("../backend-rust/src/services/staff_advanced_service.rs", "utf8");
const performanceRepository = readFileSync("../backend-rust/src/repositories/staff_advanced_repository.rs", "utf8");

test("self performance uses the selected real-data range and shared scoring source", () => {
  assert.match(page, /periodDays = signal\(30\)/);
  assert.match(page, /enterpriseOs\(\{ from: businessDateOffset\(1 - this\.periodDays\(\), to\), to \}\)/);
  assert.match(page, /Last \{\{ days \}\} days/);
  assert.match(appService, /staff_advanced_service::performance\(db, tenant_id, branch_id, from, to, ""\)/);
  assert.match(appService, /\.find\(\|row\| row\.staff_id == staff_id\)/);
  assert.match(appService, /"revenue":performance\.revenue_paise/);
  assert.match(appService, /"strengths":performance\.strengths,"opportunities":performance\.opportunities/);
  assert.match(performanceService, /performance_signals_use_persisted_metrics/);
  assert.match(performanceRepository, /LOWER\(status\) IN \('completed','billed','paid','closed'\)/);
  assert.match(performanceRepository, /start_at AT TIME ZONE 'Asia\/Kolkata'/);
});
