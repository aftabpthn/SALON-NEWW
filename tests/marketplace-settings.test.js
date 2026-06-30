import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(path, "utf8");

test("marketplace settings backend is wired through existing settings table", () => {
  const app = read("server/app.js");
  const route = read("server/routes/marketplace-settings.routes.js");
  const service = read("server/services/marketplace-settings.service.js");

  assert.match(route, /"\/settings\/marketplace"/, "marketplace settings route should exist");
  assert.match(route, /requirePermission\("read",\s*\(\) => "settings"\)/, "read route should require settings permission");
  assert.match(route, /requirePermission\("write",\s*\(\) => "settings"\)/, "write route should require settings permission");
  assert.match(app, /marketplaceSettingsRouter/, "app should import marketplace settings router");
  assert.match(app, /app\.use\("\/api\/v1",\s*marketplaceSettingsRouter\)/, "v1 API should mount marketplace settings");
  assert.match(app, /app\.use\("\/api",\s*marketplaceSettingsRouter\)/, "legacy API should mount marketplace settings");

  assert.match(service, /FROM settings WHERE tenantId = @tenantId AND key = @key/, "service should read existing settings table");
  assert.match(service, /INSERT INTO settings/, "service should save to existing settings table");
  assert.match(service, /ON CONFLICT\(tenantId, key\)/, "service should upsert tenant setting");
  assert.match(service, /tenantService\.assertBranchAccess/, "branch access should be preserved");
  assert.match(service, /internalReviews/, "internal review setting should be stored");
  assert.match(service, /marketplaceReviews/, "marketplace review setting should be stored");
  assert.match(service, /googleReviews/, "google review setting should be stored");
  assert.doesNotMatch(service, /CREATE TABLE|ALTER TABLE|server\/db\.js/, "service should not require db schema changes");
});

test("marketplace settings frontend exposes reputation control UI", () => {
  const routes = read("src/app/app.routes.ts");
  const page = read("src/app/pages/marketplace-settings.component.ts");
  const calendar = read("src/app/pages/calendar-settings.component.ts");
  const clients = read("src/app/pages/client-custom-form-settings.component.ts");
  const tax = read("src/app/pages/tax-settings.component.ts");

  assert.match(routes, /settings\/marketplace/, "Angular route should exist");
  assert.match(calendar, /routerLink="\/settings\/marketplace"/, "calendar settings sidebar should link to marketplace settings");
  assert.match(clients, /routerLink="\/settings\/marketplace"/, "client settings sidebar should link to marketplace settings");
  assert.match(tax, /routerLink="\/settings\/marketplace"/, "tax settings sidebar should link to marketplace settings");

  for (const label of [
    "Review & Marketplace Reputation Control",
    "Review Channels",
    "Auto Review Request",
    "Rating Rules",
    "Tracking & Alerts",
    "Marketplace Visibility",
    "Reply Templates",
    "Reputation Dashboard",
    "Internal Reviews",
    "Marketplace Reviews",
    "Google Reviews",
    "Show reviews on online booking/profile",
    "SMS",
    "WhatsApp",
    "Email",
    "Immediately",
    "2 hours later",
    "Next day",
    "4-5 star destination",
    "1-3 star destination",
    "Negative Review Alert",
    "Staff Review Tracking",
    "Service Review Tracking",
    "Good review reply",
    "Bad review reply",
    "Complaint recovery reply",
    "Total Reviews",
    "Average Rating",
    "Pending Requests",
    "Low Rating Alerts",
    "Google Redirects",
    "Internal Complaints",
    "Save"
  ]) {
    assert.match(page, new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), `missing UI label ${label}`);
  }

  assert.match(page, /v1\/settings\/marketplace/, "page should call v1 marketplace settings API");
  assert.match(page, /autoRequestEnabled/, "auto request setting should be present");
  assert.match(page, /requestTiming/, "timing option should be present");
  assert.match(page, /highRatingDestination/, "rating destination rule should be present");
  assert.match(page, /Next phase will connect appointment-complete triggers/, "next phase note should be visible");
});
