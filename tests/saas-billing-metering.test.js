import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const tenantService = readFileSync("server/services/tenant.service.js", "utf8");
const saasRoutes = readFileSync("server/routes/saas.routes.js", "utf8");
const saasPage = readFileSync("src/app/pages/saas-onboarding.component.ts", "utf8");
const superAdminService = readFileSync("server/services/super-admin.service.js", "utf8");
const superAdminPage = readFileSync("src/app/pages/super-admin.component.ts", "utf8");

test("SaaS tenant context exposes subscription billing, metering and feature access", () => {
  assert.match(tenantService, /billingPreview\(tenantId,\s*periodStart = now\(\)\.slice\(0,\s*7\)\)/, "tenant billing preview should be computed per billing period");
  assert.match(tenantService, /usageEventsSummary\(tenantId,\s*periodStart/, "usage events should be aggregated by period");
  assert.match(tenantService, /featureAccess\(tenantId\)/, "feature flags should resolve tenant access");
  assert.match(tenantService, /tenantHealth\(tenantId\)/, "tenant health should be computed");
  assert.match(tenantService, /subscriptionLimits\(tenantId\)/, "subscription limits should be computed");
  assert.match(tenantService, /usageBasedBilling\(tenantId,\s*periodStart/, "usage-based billing should be forecast per period");
  assert.match(tenantService, /whiteLabelReadiness\(tenantId\)/, "white-label readiness should be computed");
  assert.match(tenantService, /meteredUsageCatalog/, "metered billing catalogue should exist");
  assert.match(tenantService, /usageAmount/, "billing preview should include usage amount");
  assert.match(tenantService, /totalAmount/, "billing preview should include total amount");
  assert.match(tenantService, /nextInvoiceEstimate/, "usage-based billing should include next invoice estimate");
  assert.match(tenantService, /overageRiskRows/, "usage-based billing should expose overage risk rows");
  assert.match(tenantService, /reason:\s*allowed \? "Included for this tenant plan"/, "feature access should explain allowed or locked state");
});

test("SaaS routes expose billing preview and feature access endpoints", () => {
  for (const endpoint of ["/saas/billing-preview", "/saas/features", "/saas/usage", "/saas/tenant-health", "/saas/subscription-limits", "/saas/usage-based-billing", "/saas/white-label-readiness"]) {
    assert.ok(saasRoutes.includes(endpoint), `${endpoint} should be routed`);
  }
  assert.match(saasRoutes, /tenantService\.billingPreview\(req\.access\.tenantId,\s*req\.query\.periodStart\)/, "billing preview should use tenant access context");
  assert.match(saasRoutes, /tenantService\.featureAccess\(req\.access\.tenantId\)/, "feature access should use tenant access context");
  assert.match(saasRoutes, /tenantService\.tenantHealth\(req\.access\.tenantId\)/, "tenant health should use tenant access context");
  assert.match(saasRoutes, /tenantService\.usageBasedBilling\(req\.access\.tenantId,\s*req\.query\.periodStart\)/, "usage billing should use tenant access context");
  assert.match(saasRoutes, /requirePermission\("read",\s*\(\) => "tenants"\)/, "SaaS read endpoints should stay permission guarded");
});

test("SaaS UI shows billing preview, usage metering and plan feature flags", () => {
  assert.match(saasPage, /Billing preview/, "billing preview KPI should be visible");
  assert.match(saasPage, /Current period metering/, "metering panel should be visible");
  assert.match(saasPage, /Plan feature flags/, "feature flag panel should be visible");
  assert.match(saasPage, /Tenant health/, "tenant health KPI should be visible");
  assert.match(saasPage, /Advanced SaaS health/, "advanced health panel should be visible");
  assert.match(saasPage, /Next invoice estimate/, "usage-based billing forecast should be visible");
  assert.match(saasPage, /White-label readiness/, "white-label readiness panel should be visible");
  assert.match(saasPage, /context\.subscriptionLimits\.rows/, "UI should render subscription limits rows");
  assert.match(saasPage, /context\.usageBasedBilling\?\.nextInvoiceEstimate/, "UI should render next invoice estimate");
  assert.match(saasPage, /context\.whiteLabelReadiness\?\.checks/, "UI should render white-label readiness checks");
  assert.match(saasPage, /context\.billingPreview\?\.usageRows/, "UI should render live billing usage rows");
  assert.match(saasPage, /context\.featureAccess/, "UI should render resolved feature access rows");
});

test("Super admin overview includes metered usage revenue", () => {
  assert.match(superAdminService, /tenantService\.billingPreview\(tenant\.id\)/, "super admin should reuse tenant billing preview");
  assert.match(superAdminService, /meteredUsageRevenue/, "overview should include metered usage revenue");
  assert.match(superAdminService, /totalPlatformBilling/, "overview metrics should include total platform billing");
  assert.match(superAdminPage, /metered usage/, "super-admin UI should show metered usage revenue");
  assert.match(superAdminPage, /tenant\.totalBillingAmount/, "tenant table should show total billing amount");
});
