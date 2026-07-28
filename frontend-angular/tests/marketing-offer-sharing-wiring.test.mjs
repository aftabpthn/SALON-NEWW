import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const root = new URL('../', import.meta.url);
const backend = readFileSync(new URL('../backend-rust/src/routes/marketing_leads.rs', root), 'utf8');
const booking = readFileSync(new URL('../backend-rust/src/routes/customer_portal.rs', root), 'utf8');
const component = readFileSync(new URL('src/app/pages/marketing/marketing-leads-page.component.ts', root), 'utf8');

test('share pack is approval gated and consent aware', () => {
  assert.match(backend, /\/marketing\/offers\/:id\/share-pack/);
  assert.match(backend, /approval_status='approved'/);
  assert.match(backend, /show_in_customer_app=TRUE/);
  assert.match(backend, /whatsapp_opt_in IS TRUE/);
  assert.match(backend, /frequency_cap_days/);
});

test('social links carry an offer and channel source into booking', () => {
  assert.match(backend, /source=marketing_offer:\{}:\{\}/);
  assert.match(booking, /offer\.target_service_ids && \$4/);
  assert.match(component, /downloadOfferCreative/);
  assert.match(component, /https:\/\/wa\.me\/\?text=/);
  assert.match(component, /https:\/\/www\.instagram\.com\//);
});
