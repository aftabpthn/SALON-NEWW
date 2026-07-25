import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const frontendRoot = process.cwd().endsWith('frontend-angular')
  ? process.cwd()
  : resolve(process.cwd(), 'frontend-angular');
const read = (path) => readFileSync(resolve(frontendRoot, path), 'utf8');
const staff = read('src/app/pages/staff/staff-page.component.css');
const services = read('src/app/pages/services/services-page.component.css');
const settings = read('src/app/pages/settings/settings-page.component.css');
const memberships = read('src/app/pages/memberships/memberships-page.component.css');
const packages = read('src/app/pages/packages/packages-page.component.css');

assert.match(staff, /\.staff-drawer:not\(\.page-mode\),\.masters-drawer,\.bulk-drawer \{ width:100vw; \}/);
assert.match(services, /\.service-flyout \{[\s\S]*?width: 100vw;[\s\S]*?\.field-row \{[\s\S]*?grid-template-columns: 1fr;/);
assert.match(settings, /\.color-table \{[\s\S]*?overflow-x: auto;[\s\S]*?\.color-head,[\s\S]*?min-width: 650px;/);
assert.match(memberships, /\.membership-drawer, \.sell-drawer, \.member360-drawer \{ width: 100vw; \}/);
assert.match(memberships, /\.tier-setting \{ grid-template-columns: 1fr; \}/);
assert.match(packages, /\.package-drawer \{ width: 100vw; \}/);
assert.match(packages, /\.service-add, \.service-row, \.validity-control \{ grid-template-columns: 1fr; \}/);

for (const source of [staff, services, settings, memberships, packages]) {
  assert.match(source, /min-height:\s*44px/, 'Missing mobile touch target');
}

console.log('Secondary mobile responsive checks passed');
