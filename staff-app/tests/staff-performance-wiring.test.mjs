import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "vitest";

const page = readFileSync("src/app/features/staff/staff-performance.page.ts", "utf8");
const client = readFileSync("src/app/core/staff-app.service.ts", "utf8");
const service = readFileSync("../backend-rust/src/services/staff_app_service.rs", "utf8");
const route = readFileSync("../backend-rust/src/routes/staff_enterprise.rs", "utf8");
const middleware = readFileSync("../backend-rust/src/middleware/tenant.rs", "utf8");
const migration = readFileSync("../backend-rust/migrations/0384_staff_performance_metrics.sql", "utf8");

test("phase 9 performance is self-scoped, explainable, configurable and source-backed", () => {
  for (const key of [
    "product_service_percent", "repeat_guests_retained", "new_guests_retained", "requested_count",
    "service_sales", "rebook_count", "rebook_rate", "new_service_guests",
    "service_invoices_with_product_percent", "average_feedback", "guest_count", "average_invoice_value",
    "service_revenue", "free_service_revenue", "product_revenue", "membership_revenue", "package_revenue",
    "utilization", "attendance", "tips", "commissions"
  ]) assert.match(service, new RegExp(`"${key}"`));

  assert.match(route, /staff-self\/performance/);
  assert.match(route, /staff\.app\.performance\.read/);
  assert.match(middleware, /path == "\/staff-self\/performance"[\s\S]*staff\.app\.performance\.read/);
  assert.match(service, /self_staff_id\(db, tenant_id, branch_id, user_id\)/);
  assert.match(service, /performance basis must be sale_date or close_date/);
  assert.match(service, /sourceMetricKey/);
  assert.match(service, /numerator.*denominator/);
  assert.match(service, /excludedFromScore/);
  assert.match(service, /GENERATE_SERIES[\s\S]*serviceRevenuePaise[\s\S]*"trends":trends/);
  assert.match(service, /lms\["courses"\] = json!\(\[\]\)/);
  assert.match(migration, /PRIMARY KEY \(tenant_id, branch_id\)/);
  assert.match(client, /get<StaffPerformanceDashboard>\("\/staff-self\/performance"/);
  assert.match(page, /"day".*"week".*"month".*"pay_period".*"custom"/s);
  assert.match(page, /How this score is calculated/);
  assert.match(page, /Daily performance trends/);
  assert.match(page, /aura-staff-date-picker/);
});
