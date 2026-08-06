import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const page = readFileSync(new URL('../src/app/pages/data-migration/integrations-data-page.component.ts', import.meta.url), 'utf8');
const template = readFileSync(new URL('../src/app/pages/data-migration/integrations-data-page.component.html', import.meta.url), 'utf8');
const backend = readFileSync(new URL('../../backend-rust/src/routes/actions_center.rs', import.meta.url), 'utf8');
const migration = readFileSync(new URL('../../backend-rust/migrations/0427_actions_center_booking.sql', import.meta.url), 'utf8');

test('Reserve with Google uses persisted merchant mapping and complete v3 booking routes', () => {
  assert.match(page, /settings\/integrations\/reserve-with-google/);
  assert.match(template, /Reserve with Google/);
  for (const method of ['HealthCheck', 'BatchAvailabilityLookup', 'CheckAvailability', 'CreateBooking', 'UpdateBooking', 'GetBookingStatus', 'ListBookings', 'SetMarketingPreference']) {
    assert.match(backend, new RegExp(`actions-center/v3/${method}`));
  }
  assert.match(backend, /constant_time_eq/);
  assert.match(backend, /exact_booking_availability/);
  assert.match(migration, /PRIMARY KEY \(merchant_id, idempotency_token\)/);
});
