import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "vitest";

const page = readFileSync("src/app/features/staff/staff-offers.page.ts", "utf8");
const service = readFileSync("src/app/core/staff-app.service.ts", "utf8");
const layout = readFileSync("src/app/features/staff/staff-layout.page.ts", "utf8");
const appRoutes = readFileSync("src/app/app.routes.ts", "utf8");
const backend = readFileSync("../backend-rust/src/routes/staff_enterprise.rs", "utf8");
const marketing = readFileSync("../backend-rust/src/routes/marketing_leads.rs", "utf8");

test("published branch offers refresh with authenticated creatives", () => {
  assert.match(appRoutes, /path: "offers"[\s\S]{0,160}permissions: "staff\.app\.offers\.read"/);
  assert.match(backend, /\/staff-self\/offers\/:id\/creative/);
  assert.match(backend, /require_app\([\s\S]{0,160}"staff\.app\.offers\.read"/);
  assert.match(backend, /WHERE tenant_id=\$1 AND branch_id=\$2 AND active=TRUE AND approval_status='approved' AND show_in_staff_app=TRUE/);
  assert.match(backend, /starts_at IS NULL OR starts_at<=NOW\(\)/);
  assert.match(backend, /ends_at IS NULL OR ends_at>=NOW\(\)/);
  assert.match(backend, /offer\.approval_status='approved' AND offer\.show_in_staff_app=TRUE/);
  assert.match(backend, /applicableServices/);
  assert.match(backend, /applicablePackages/);
  assert.match(backend, /'personalOffer',target_client_id IS NOT NULL/);
  assert.match(service, /async offers\(\): Promise<StaffOffer\[]>/);
  assert.match(service, /async offerCreative\(id: string\): Promise<Blob>/);
  assert.match(page, /window:aura:offers-updated/);
  assert.match(page, /offer\.applicableServices/);
  assert.match(page, /offer\.personalOffer/);
  assert.match(layout, /frame\.entityType === "offer"/);
  assert.match(marketing, /"offer",[\s\S]*"marketing\.offer\.approved"/);
});
