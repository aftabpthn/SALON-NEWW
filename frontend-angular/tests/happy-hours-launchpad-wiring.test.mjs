import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const page = readFileSync('src/app/pages/pos/happy-hours/happy-hours-page.component.ts', 'utf8');
const template = readFileSync('src/app/pages/pos/happy-hours/happy-hours-page.component.html', 'utf8');
const backend = readFileSync('../backend-rust/src/routes/pos.rs', 'utf8');
const service = readFileSync('../backend-rust/src/services/happy_hours_service.rs', 'utf8');

test('Happy Hours launchpad is backed by existing offer intelligence APIs', () => {
  assert.match(page, /offerLaunchpad\(\): OfferPreset\[\]/);
  assert.match(page, /this\.controlTower\?\.summary\.collectingRules/);
  assert.match(page, /this\.clientReturnTracker\?\.summary\.atRiskCount/);
  assert.match(page, /this\.marketSuggestions\.length/);
  assert.match(page, /this\.contextOfferSuggestions\.length/);
  assert.match(template, /aria-label="Offer launchpad"/);
  assert.match(backend, /get_happy_hours_control_tower/);
  assert.match(backend, /get_happy_hour_client_returns/);
  assert.match(service, /client_return_tracker/);
});

test('Happy Hours launchpad presets open real API-backed workflows without creating data', () => {
  const launchPreset = page.slice(page.indexOf('launchPreset('), page.indexOf('openEdit('));
  assert.match(page, /launchPreset\(key: OfferPreset\['key'\]\)/);
  assert.match(page, /Demand Fill Happy Hour/);
  assert.match(page, /Win Back Happy Hours/);
  assert.match(page, /FIRST-VISIT/);
  assert.match(page, /this\.tab = 'marketAware'/);
  assert.match(page, /this\.tab = 'contextAware'/);
  assert.match(template, /\(click\)="launchPreset\(card\.key\)"/);
  assert.doesNotMatch(launchPreset, /api\.post/);
});
