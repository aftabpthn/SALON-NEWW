import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = (file) => readFileSync(new URL(`../src/app/features/${file}`, import.meta.url), 'utf8');
const appRoutes = () => readFileSync(new URL('../src/app/app.routes.ts', import.meta.url), 'utf8');

test('public entry opens discovery and keeps help available before login', () => {
  const routes = appRoutes();
  assert.match(routes, /path: "", redirectTo: "tabs\/home"/);
  const helpRoute = routes.slice(routes.indexOf('path: "help"'), routes.indexOf('{ path: "**"'));
  assert.doesNotMatch(helpRoute, /customerAuthGuard/);
});

test('public shell exposes the approved customer and business actions', () => {
  const tabs = source('tabs/tabs.page.ts');
  for (const label of ['Log in', 'List your business', 'Download app', 'Help', 'Customer app', 'English (IN)', 'For business']) {
    assert.ok(tabs.includes(label), `missing public action: ${label}`);
  }
  assert.match(tabs, /environment\.businessAppUrl/);
});

test('home exposes the approved treatment, location and time discovery controls', () => {
  const home = source('home/home.page.ts');
  assert.match(home, /Book local self-care services/);
  assert.match(home, /All treatments/);
  assert.match(home, /Search near your current area/);
  assert.match(home, /Choose appointment time/);
  assert.match(home, /Search Aura Shine/);
  assert.match(home, /marketplace\.isAuthenticated\(\)/);
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
