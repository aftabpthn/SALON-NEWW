import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(path, "utf8");
const escaped = (value) => new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));

test("location sharing backend wrapper is schema-backed and mounted", () => {
  const app = read("server/app.js");
  const route = read("server/routes/location-sharing.routes.js");
  const schema = read("server/services/location-sharing-schema.service.js");
  const service = read("server/services/location-sharing.service.js");

  assert.match(app, /ensureLocationSharingSchema/, "app should bootstrap location sharing schema");
  assert.match(app, /locationSharingRouter/, "app should import location sharing router");
  assert.match(app, /app\.use\("\/api\/v1",\s*locationSharingRouter\)/, "v1 API should mount location sharing router");
  assert.match(app, /app\.use\("\/api",\s*locationSharingRouter\)/, "legacy API should mount location sharing router");

  for (const endpoint of [
    "/location-sharing/overview",
    "/location-sharing/settings",
    "/location-sharing/rules",
    "/location-sharing/conflicts",
    "/location-sharing/conflicts/:id/resolve",
    "/location-sharing/approvals",
    "/location-sharing/approvals/:id/approve",
    "/location-sharing/approvals/:id/reject",
    "/location-sharing/events",
    "/location-sharing/reports"
  ]) {
    assert.match(route, escaped(endpoint), `route should expose ${endpoint}`);
  }

  for (const table of [
    "locationSharingSettings",
    "locationSharingRules",
    "locationSharingEvents",
    "locationSharingConflicts",
    "locationSharingApprovals"
  ]) {
    assert.match(schema, escaped(`CREATE TABLE IF NOT EXISTS ${table}`), `schema should create ${table}`);
    assert.match(schema, /tenantId TEXT NOT NULL/, "tables should be tenant scoped");
    assert.match(schema, /branchId TEXT DEFAULT ''/, "tables should carry branchId");
  }

  assert.match(service, /MODULES = \[/, "service should define supported modules");
  for (const module of ["customer", "package", "membership", "product", "service", "vendor", "staff"]) {
    assert.match(service, escaped(`key: "${module}"`), `service should support ${module}`);
  }
  for (const mode of ["viewOnly", "syncMasterData", "allowRedemption", "allowEdit", "ownerApprovalRequired"]) {
    assert.match(service, escaped(mode), `service should support ${mode}`);
  }
  assert.match(service, /createApproval/, "risky changes should create approvals");
  assert.match(service, /insertEvent/, "changes should create audit events");
  assert.match(service, /duplicate_customer/, "customer duplicate conflict should be detected");
  assert.match(service, /service_price_mismatch/, "service price mismatch conflict should be detected");
  assert.match(service, /product_catalog_mismatch/, "product mismatch conflict should be detected");
  assert.match(service, /vendor_duplicate_or_mismatch/, "vendor mismatch conflict should be detected");
});

test("location sharing frontend page exposes command center tabs and controls", () => {
  const routes = read("src/app/app.routes.ts");
  const appComponent = read("src/app/app.component.ts");
  const page = read("src/app/pages/location-sharing-command-center.component.ts");

  assert.match(routes, /locations\/sharing/, "Angular route should exist");
  assert.match(appComponent, /Location Sharing/, "admin search/menu should link the page");
  assert.match(page, /location-sharing\/overview/, "page should load overview API");
  assert.match(page, /location-sharing\/settings/, "page should save settings API");
  assert.match(page, /location-sharing\/rules/, "page should save matrix rule API");
  assert.match(page, /location-sharing\/conflicts/, "page should load and resolve conflicts");
  assert.match(page, /location-sharing\/approvals/, "page should manage approvals");
  assert.match(page, /location-sharing\/events/, "page should load audit events");
  assert.match(page, /location-sharing\/reports/, "page should load reports");

  for (const label of [
    "Location Sharing Command Center",
    "Sharing Settings",
    "Branch Matrix",
    "Conflict Center",
    "Approval Queue",
    "Sync Logs",
    "Audit Trail",
    "Reports",
    "View only",
    "Sync master data",
    "Allow redemption",
    "Allow edit",
    "Owner approval"
  ]) {
    assert.match(page, escaped(label), `page should show ${label}`);
  }
  for (const module of ["customer", "package", "membership", "product", "service", "vendor", "staff"]) {
    assert.match(page, escaped(`${module}:`), `page should define ${module} toggle detail`);
  }
});
