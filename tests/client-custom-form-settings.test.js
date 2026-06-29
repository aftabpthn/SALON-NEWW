import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(path, "utf8");

test("client custom form settings backend is wired without db schema changes", () => {
  const app = read("server/app.js");
  const route = read("server/routes/client-custom-form-settings.routes.js");
  const service = read("server/services/client-custom-form-settings.service.js");

  assert.match(route, /"\/settings\/clients\/custom-form"/, "settings route should exist");
  assert.match(route, /requirePermission\("read",\s*\(\) => "settings"\)/, "read route should require settings permission");
  assert.match(route, /requirePermission\("write",\s*\(\) => "settings"\)/, "write route should require settings permission");
  assert.match(app, /clientCustomFormSettingsRouter/, "app should import client custom form settings router");
  assert.match(app, /app\.use\("\/api\/v1",\s*clientCustomFormSettingsRouter\)/, "v1 API should mount client custom form settings");
  assert.match(app, /app\.use\("\/api",\s*clientCustomFormSettingsRouter\)/, "legacy API should mount client custom form settings");

  assert.match(service, /FROM settings WHERE tenantId = @tenantId AND key = @key/, "service should read existing settings table");
  assert.match(service, /INSERT INTO settings/, "service should save to existing settings table");
  assert.match(service, /ON CONFLICT\(tenantId, key\)/, "service should upsert tenant setting");
  assert.match(service, /tenantService\.assertBranchAccess/, "branch access should be preserved");
  assert.match(service, /lockedDefault:\s*true/, "core fields should support locked default");
  assert.match(service, /lockedMandatory:\s*true/, "core fields should support locked mandatory");
});

test("client custom form settings frontend exposes Salonist-style field controls", () => {
  const routes = read("src/app/app.routes.ts");
  const page = read("src/app/pages/client-custom-form-settings.component.ts");
  const calendar = read("src/app/pages/calendar-settings.component.ts");

  assert.match(routes, /settings\/clients\/custom-form/, "Angular route should exist");
  assert.match(calendar, /routerLink="\/settings\/clients\/custom-form"/, "calendar settings sidebar should link to custom form");

  for (const label of [
    "Clients - Custom Form",
    "Field Name",
    "Default",
    "Mandatory",
    "Display on Book Now",
    "Name",
    "Contact",
    "Email",
    "Date Of Birth",
    "Date Of Anniversary",
    "Gender",
    "Address",
    "GST Number",
    "Parent Name",
    "Parent Contact",
    "Child Age",
    "Card Number",
    "Client Discount Percentage",
    "Client Picture"
  ]) {
    assert.match(page, new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), `missing UI label ${label}`);
  }

  assert.match(page, /settings\/clients\/custom-form/, "page should call custom form settings API");
  assert.match(page, /\[disabled\]="field\.lockedDefault"/, "default lock should disable protected default toggle");
  assert.match(page, /\[disabled\]="field\.lockedMandatory"/, "mandatory lock should disable protected mandatory toggle");
  assert.match(page, /overflow-x:\s*auto/, "table overflow should stay contained");
});
