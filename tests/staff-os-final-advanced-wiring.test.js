import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(path, "utf8");

test("Staff OS API wrappers expose payroll compliance, staff risk and mobile sync surfaces", () => {
  const api = read("src/app/features/staff-os/data/staff-os.api.ts");

  assert.match(api, /payrollComplianceSummary/);
  assert.match(api, /staff-os\/payroll-compliance\/summary/);
  assert.match(api, /burnoutRisk/);
  assert.match(api, /staff-os\/intelligence\/burnout-risk/);
  assert.match(api, /churnRisk/);
  assert.match(api, /staff-os\/intelligence\/churn-risk/);
  assert.match(api, /mobileConflicts/);
  assert.match(api, /staff-os\/mobile\/conflicts/);
  assert.match(api, /mobileDashboard/);
  assert.match(api, /staff-os\/mobile\/dashboard/);
});

test("Staff salary workspace shows final advanced readiness cards", () => {
  const page = read("src/app/features/staff-os/pages/staff-salary-workspace.page.ts");

  assert.match(page, /Payroll compliance/);
  assert.match(page, /Staff risk/);
  assert.match(page, /Offline staff sync/);
  assert.match(page, /payrollComplianceSummary/);
  assert.match(page, /burnoutRisk/);
  assert.match(page, /mobileConflicts/);
  assert.match(page, /advancedReadiness/);
  assert.match(page, /routerLink="\/staff-os\/salary-generate"/);
  assert.match(page, /routerLink="\/staff-os\/performance-dashboard"/);
  assert.match(page, /routerLink="\/staff-os\/mobile-preview"/);
});

test("Staff mobile preview connects live staff dashboard plus offline conflict status", () => {
  const page = read("src/app/features/staff-os/pages/mobile-staff-dashboard-preview.page.ts");

  assert.match(page, /Live staff mobile view/);
  assert.match(page, /staff-os\/mobile\/dashboard/);
  assert.match(page, /staff-os\/mobile\/conflicts/);
  assert.match(page, /offline\/device-sync-status/);
  assert.match(page, /routerLink="\/staff-os\/face-punch"/);
  assert.match(page, /Open conflict center/);
});

test("Staff OS backend composes compliance, intelligence and mobile sync routers", () => {
  const staffOsRouter = read("server/routes/staff-os.routes.js");
  const complianceRoutes = read("server/routes/staff-payroll-compliance.routes.js");
  const intelligenceRoutes = read("server/routes/staff-intelligence.routes.js");
  const mobileSyncRoutes = read("server/routes/staff-mobile-sync.routes.js");

  assert.match(staffOsRouter, /staffPayrollComplianceRouter/);
  assert.match(staffOsRouter, /staffIntelligenceRouter/);
  assert.match(staffOsRouter, /staffMobileSyncRouter/);
  assert.match(complianceRoutes, /\/staff-os\/payroll-compliance\/summary/);
  assert.match(intelligenceRoutes, /\/staff-os\/intelligence\/burnout-risk/);
  assert.match(intelligenceRoutes, /\/staff-os\/intelligence\/churn-risk/);
  assert.match(mobileSyncRoutes, /\/staff-os\/mobile\/sync/);
  assert.match(mobileSyncRoutes, /\/staff-os\/mobile\/conflicts/);
});
