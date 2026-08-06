import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const settingsTs = readFileSync(new URL('../src/app/pages/settings/settings-page.component.ts', import.meta.url), 'utf8');
const settingsHtml = readFileSync(new URL('../src/app/pages/settings/settings-page.component.html', import.meta.url), 'utf8');
const publicTs = readFileSync(new URL('../src/app/pages/booking/public-booking-page.component.ts', import.meta.url), 'utf8');
const publicHtml = readFileSync(new URL('../src/app/pages/booking/public-booking-page.component.html', import.meta.url), 'utf8');
const organizationRoute = readFileSync(new URL('../../backend-rust/src/routes/organization.rs', import.meta.url), 'utf8');
const bookingRoute = readFileSync(new URL('../../backend-rust/src/routes/booking_portal_v2.rs', import.meta.url), 'utf8');

test('website builder saves drafts, publishes explicitly and renders only public configuration', () => {
  assert.match(settingsTs, /\/settings\/organization\/website\/draft/);
  assert.match(settingsTs, /\/settings\/organization\/website\/publish/);
  assert.match(settingsHtml, /draggable="true"/);
  assert.match(settingsHtml, />Save draft</);
  assert.match(settingsHtml, />Publish</);
  assert.match(organizationRoute, /organization_service::save_website_draft/);
  assert.match(organizationRoute, /organization_service::publish_website/);
  assert.match(bookingRoute, /organization_service::public_website/);
  assert.match(publicTs, /result\.website/);
  assert.match(publicHtml, /websiteSections/);
  assert.match(publicHtml, /showBookingWorkspace/);
});
