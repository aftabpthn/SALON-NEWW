import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = (file) => readFileSync(new URL(`../src/app/features/${file}`, import.meta.url), 'utf8');

test('home exposes treatment, location, time and filter discovery controls', () => {
  const home = source('home/home.page.ts');
  assert.match(home, /Search services or salons/);
  assert.match(home, /Search near your current area/);
  assert.match(home, /Choose appointment time/);
  assert.match(home, /More search filters/);
});

test('search quick chips apply real filter state and report the active sort', () => {
  const search = source('search/search.page.ts');
  assert.match(search, /\(click\)="applyQuickFilter\(chip\)"/);
  assert.match(search, /quickChipSelected\(chip: string\)/);
  assert.match(search, /\{\{ sortButtonLabel\(\) \}\}/);
  assert.match(search, /\{\{ showMap\(\) \? "List View" : "Map View" \}\}/);
});

test('business profile keeps team, reviews and about visible on mobile', () => {
  const profile = source('business/business-profile.page.ts');
  for (const section of ['Photos', 'Services', 'Team', 'Reviews', 'About']) {
    assert.match(profile, new RegExp(`scrollToSection\\('profile-[^']+'\\)\">${section}<`));
  }
  const mobile = profile.slice(profile.indexOf('@media (max-width: 599px)'), profile.indexOf('@media (min-width: 768px)'));
  assert.doesNotMatch(mobile, /\.staff-section|\.review-section|\.info-grid/);
});
