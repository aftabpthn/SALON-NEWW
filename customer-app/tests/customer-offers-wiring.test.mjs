import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const root = new URL("../", import.meta.url);
const route = readFileSync(new URL("../backend-rust/src/routes/customer_portal.rs", root), "utf8");
const repository = readFileSync(new URL("../backend-rust/src/repositories/customer_portal_repository.rs", root), "utf8");
const page = readFileSync(new URL("src/app/features/offers/offers.page.ts", root), "utf8");

test("customer offers expose only live customer-visible CRM offers", () => {
  assert.match(route, /\/marketplace\/offers/);
  assert.match(repository, /approval_status='approved'/);
  assert.match(repository, /show_in_customer_app=TRUE/);
  assert.match(repository, /starts_at IS NULL OR offer\.starts_at<=NOW\(\)/);
  assert.match(repository, /ends_at IS NULL OR offer\.ends_at>=NOW\(\)/);
  assert.doesNotMatch(repository.match(/pub async fn marketplace_offers[\s\S]*?pub async fn marketplace_offer_creative/)?.[0] ?? "", /staffInstructions|approvalStatus|uploadedBy|createdBy/);
});

test("offer booking reuses the branch booking flow with eligible services", () => {
  assert.match(page, /\['\/business', offer\.businessSlug, 'book'\]/);
  assert.match(page, /serviceIds: offer\.targetServiceIds\.join\(","\)/);
  assert.match(page, /listPublicOffers/);
});
