import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");

test("Phase 2 availability carries all services, chosen staff, duration and seven dates", () => {
  const flow = read("src/app/features/booking/booking-flow.page.ts");
  const api = read("src/app/core/customer-api.service.ts");
  const route = read("../backend-rust/src/routes/customer_portal.rs");
  const slots = read("../backend-rust/src/routes/booking_portal_v2.rs");

  assert.match(flow, /serviceIds: services\.map\(\(service\) => service\.id\)/);
  assert.match(flow, /staffId: this\.selectedStaffId\(\) \|\| undefined/);
  assert.match(flow, /days: 7/);
  assert.match(flow, /durationMinutes: this\.bookingDurationMinutes\(\)/);
  assert.match(api, /serviceIds: params\.serviceIds\?\.join\(","\)/);
  assert.match(api, /staffId: params\.staffId/);
  assert.match(route, /service_ids: Option<String>/);
  assert.match(route, /staff_id: Option<String>/);
  assert.match(flow, /participants: this\.groupBookingAvailable\(\) \? this\.participantCount\(\) : 1/);
  assert.match(slots, /available_staff\.len\(\) < required_staff_count as usize/);
  assert.match(slots, /available_staff\.iter\(\)\.any\(\|id\| id == requested_staff\)/);
});

test("Phase 2 confirmation restores intent, revalidates the slot and assigns any available professional", () => {
  const flow = read("src/app/features/booking/booking-flow.page.ts");

  assert.match(flow, /paymentMode\?: "pay_at_venue" \| "online"/);
  assert.match(flow, /paymentMode: this\.paymentMode\(\)/);
  assert.match(flow, /if \(!await this\.reloadAvailability\(\)\) return false/);
  assert.match(flow, /staffId: this\.selectedStaffId\(\) \|\| this\.selectedSlot\(\)\?\.staffId \|\| undefined/);
  assert.match(flow, /if \(!booking\) return/);
  assert.match(flow, /Choose one service to add family profiles/);
});

test("approved Phase 2 booking surface uses the existing CRM blue tokens", () => {
  const flow = read("src/app/features/booking/booking-flow.page.ts");

  assert.match(flow, /linear-gradient\(135deg, var\(--primary\), var\(--accent\)\)/);
  assert.match(flow, /background: var\(--accent-2\)/);
  assert.doesNotMatch(flow, /#F4D58D|#D6A94A|#9B6B22|rgba\(214, 169, 74/);
});

test("Phase 2 marketplace filters and cards use persisted location, hours, reviews and offers", () => {
  const route = read("../backend-rust/src/routes/customer_portal.rs");
  const repository = read("../backend-rust/src/repositories/customer_portal_repository.rs");
  const search = read("src/app/features/search/search.page.ts");

  for (const field of ["radius_km", "open_now", "top_rated", "offers", "available_today", "min_price_paise", "max_price_paise", "staff_gender", "sort"]) {
    assert.match(route, new RegExp(`${field}: Option`));
  }
  assert.match(repository, /branch_operating_hours/);
  assert.match(repository, /customer_booking_reviews/);
  assert.match(repository, /client_review_links/);
  assert.match(repository, /show_in_customer_app=TRUE/);
  assert.match(repository, /distance_km/);
  assert.match(search, /openNow: filters\.includes\("open"\)/);
  assert.match(search, /availableToday: filters\.includes\("today"\)/);
});

test("customer booking writes canonical tenant and branch ids", () => {
  const route = read("../backend-rust/src/routes/customer_portal.rs");

  assert.match(route, /let booking_tenant_id = public_tenant_id;/);
  assert.match(route, /let booking_branch_id = public_branch_id;/);
  assert.match(route, /headers\.insert\(\s*"x-tenant-id"/);
  assert.match(route, /headers\.insert\(\s*"x-branch-id"/);
});

test("booking history formats persisted timestamps for customers", () => {
  const list = read("src/app/features/bookings/bookings.page.ts");
  const detail = read("src/app/features/bookings/booking-detail.page.ts");

  assert.match(list, /bookingDateTime\(booking\)/);
  assert.match(list, /month: "2-digit", year: "numeric"/);
  assert.match(detail, /dateTimeLabel\(booking\.displayStartAt/);
});
