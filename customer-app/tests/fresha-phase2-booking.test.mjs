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
