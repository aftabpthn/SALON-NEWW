import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const root = new URL("../", import.meta.url);
const route = readFileSync(new URL("../backend-rust/src/routes/customer_portal.rs", root), "utf8");
const repository = readFileSync(new URL("../backend-rust/src/repositories/customer_portal_repository.rs", root), "utf8");
const page = readFileSync(new URL("src/app/features/offers/offers.page.ts", root), "utf8");
const appRoutes = readFileSync(new URL("src/app/app.routes.ts", root), "utf8");
const bookingFlow = readFileSync(new URL("src/app/features/booking/booking-flow.page.ts", root), "utf8");
const apiTypes = readFileSync(new URL("src/app/core/api.types.ts", root), "utf8");
const api = readFileSync(new URL("src/app/core/customer-api.service.ts", root), "utf8");

test("customer offers expose only live customer-visible CRM offers", () => {
  assert.match(route, /\/marketplace\/offers/);
  assert.match(repository, /approval_status='approved'/);
  assert.match(repository, /show_in_customer_app=TRUE/);
  assert.match(repository, /offer\.target_client_id IS NULL OR \(\$2<>'' AND EXISTS/);
  assert.match(route, /repo::marketplace_offers\(&state\.db, branch_id, ""\)/);
  assert.match(route, /record_marketing_offer_click\(&state, &body, ""\)/);
  assert.match(repository, /starts_at IS NULL OR offer\.starts_at<=NOW\(\)/);
  assert.match(repository, /ends_at IS NULL OR offer\.ends_at>=NOW\(\)/);
  assert.doesNotMatch(repository.match(/pub async fn marketplace_offers[\s\S]*?pub async fn marketplace_offer_creative/)?.[0] ?? "", /staffInstructions|approvalStatus|uploadedBy|createdBy/);
});

test("customer offers use one authenticated app route", () => {
  assert.equal(appRoutes.match(/path: "offers"/g)?.length, 1);
  assert.match(appRoutes, /path: "offers",\s*canActivate: \[customerAuthGuard\],\s*loadComponent: \(\) => import\("\.\/features\/offers\/offers\.page"\)/);
});

test("offer booking reuses the branch booking flow with eligible services", () => {
  assert.match(page, /\['\/business', offer\.businessSlug, 'book'\]/);
  assert.match(page, /serviceIds: offer\.targetServiceIds\.join\(","\)/);
  assert.match(page, /offer: offer\.code/);
  assert.match(page, /marketing_offer:\$\{offer\.id\}:customer_app/);
  assert.match(bookingFlow, /offerCode: this\.route\.snapshot\.queryParamMap\.get\("offer"\)/);
  assert.match(apiTypes, /offerCode\?: string/);
  assert.match(route, /UPPER\(offer\.code\)=UPPER\(\$5\)/);
  assert.match(route, /link\.account_id=\$6/);
  assert.match(route, /link\.client_id=offer\.target_client_id/);
  assert.match(route, /offer\.target_service_ids && \$4/);
  assert.match(page, /listMarketingOffers/);
});

test("personal offers require the logged-in account mapping for details and creative", () => {
  assert.match(route, /\/customer\/marketing-offers/);
  assert.match(route, /active_customer_claims\(&state, &headers\)/);
  assert.match(repository, /customer_account_clients link/);
  assert.match(repository, /'personal',offer\.target_client_id IS NOT NULL/);
  assert.match(api, /marketingOfferCreative/);
  assert.match(api, /responseType: "blob"/);
  assert.match(page, /offer\.personal \? 'Personal offer'/);
  assert.match(route, /CACHE_CONTROL, "private, no-store"/);
});
