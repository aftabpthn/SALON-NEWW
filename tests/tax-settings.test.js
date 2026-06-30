import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(path, "utf8");

test("country based tax settings backend is wired through existing settings table", () => {
  const app = read("server/app.js");
  const route = read("server/routes/tax-settings.routes.js");
  const service = read("server/services/tax-settings.service.js");

  assert.match(route, /"\/settings\/taxes"/, "tax settings route should exist");
  assert.match(route, /requirePermission\("read",\s*\(\) => "settings"\)/, "read route should require settings permission");
  assert.match(route, /requirePermission\("write",\s*\(\) => "settings"\)/, "write route should require settings permission");
  assert.match(app, /taxSettingsRouter/, "app should import tax settings router");
  assert.match(app, /app\.use\("\/api\/v1",\s*taxSettingsRouter\)/, "v1 API should mount tax settings");
  assert.match(app, /app\.use\("\/api",\s*taxSettingsRouter\)/, "legacy API should mount tax settings");

  assert.match(service, /FROM settings WHERE tenantId = @tenantId AND key = @key/, "service should read existing settings table");
  assert.match(service, /INSERT INTO settings/, "service should save to existing settings table");
  assert.match(service, /ON CONFLICT\(tenantId, key\)/, "service should upsert tenant setting");
  assert.match(service, /tenantService\.assertBranchAccess/, "branch access should be preserved");
  assert.match(service, /IN:[\s\S]*taxType: "GST"[\s\S]*registrationLabel: "GSTIN"[\s\S]*serviceTaxRate: 18/, "India GST preset should exist");
  assert.match(service, /AE:[\s\S]*taxType: "VAT"[\s\S]*registrationLabel: "TRN"[\s\S]*serviceTaxRate: 5/, "UAE VAT preset should exist");
  assert.match(service, /US:[\s\S]*taxType: "Sales Tax"[\s\S]*registrationLabel: "Tax ID \/ EIN"/, "US Sales Tax preset should exist");
  assert.match(service, /UK:[\s\S]*taxType: "VAT"[\s\S]*registrationLabel: "VAT No"/, "UK VAT preset should exist");
});

test("tax settings frontend exposes editable country presets and settings UI", () => {
  const routes = read("src/app/app.routes.ts");
  const page = read("src/app/pages/tax-settings.component.ts");
  const calendar = read("src/app/pages/calendar-settings.component.ts");
  const clients = read("src/app/pages/client-custom-form-settings.component.ts");

  assert.match(routes, /settings\/taxes/, "Angular route should exist");
  assert.match(calendar, /routerLink="\/settings\/taxes"/, "calendar settings sidebar should link to tax settings");
  assert.match(clients, /routerLink="\/settings\/taxes"/, "client custom form sidebar should link to tax settings");

  for (const label of [
    "Tax Settings",
    "Country & Tax Profile",
    "Service Tax",
    "Product Tax",
    "Bill Settings",
    "Debit / Credit Fees",
    "Invoice Preview",
    "Apply Defaults",
    "Tax rates can vary by state/category. Verify before applying.",
    "Tax Type",
    "Registration Label",
    "Registration Number",
    "Service Tax %",
    "Product Tax %",
    "Tax editable on POS",
    "Product tax applicable",
    "Use for new services/products",
    "Apply to existing services/products later"
  ]) {
    assert.match(page, new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), `missing UI label ${label}`);
  }

  assert.match(page, /settings\/taxes/, "page should call tax settings API");
  assert.match(page, /onCountryChange/, "country change should apply preset");
  assert.match(page, /TAX_PRESETS/, "frontend should include country presets");
  assert.match(page, /save\(\)/, "page should save manual edits");
});
