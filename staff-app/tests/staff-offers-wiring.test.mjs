import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "vitest";

const page = readFileSync("src/app/features/staff/staff-offers.page.ts", "utf8");
const service = readFileSync("src/app/core/staff-app.service.ts", "utf8");
const layout = readFileSync("src/app/features/staff/staff-layout.page.ts", "utf8");
const backend = readFileSync("../backend-rust/src/routes/staff_enterprise.rs", "utf8");
const marketing = readFileSync("../backend-rust/src/routes/marketing_leads.rs", "utf8");

test("published branch offers refresh with authenticated creatives", () => {
  assert.match(backend, /\/staff-self\/offers\/:id\/creative/);
  assert.match(backend, /offer\.approval_status='approved' AND offer\.show_in_staff_app=TRUE/);
  assert.match(backend, /applicableServices/);
  assert.match(backend, /applicablePackages/);
  assert.match(service, /async offerCreative\(id: string\): Promise<Blob>/);
  assert.match(page, /window:aura:offers-updated/);
  assert.match(page, /offer\.applicableServices/);
  assert.match(layout, /frame\.entityType === "offer"/);
  assert.match(marketing, /"offer",[\s\S]*"marketing\.offer\.approved"/);
});
