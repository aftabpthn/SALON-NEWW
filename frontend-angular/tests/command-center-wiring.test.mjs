import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const routes = readFileSync('src/app/app.routes.ts', 'utf8');
const sidebar = readFileSync('src/app/layout/app-sidebar.component.ts', 'utf8');
const page = readFileSync('src/app/pages/dashboard/command-center/command-center-page.component.ts', 'utf8');
const template = readFileSync('src/app/pages/dashboard/command-center/command-center-page.component.html', 'utf8');
const settings = readFileSync('src/app/pages/settings/settings-page.component.ts', 'utf8');

test('Command Center uses the same full-access roles in route and sidebar', () => {
  assert.match(routes, /roles: \['owner', 'admin', 'superadmin', 'super-admin'\], deniedRedirect: '\/dashboard'/);
  assert.match(sidebar, /hasRole\('owner', 'admin', 'superadmin', 'super-admin'\)/);
});

test('Command Center loads real branch APIs without a redundant health request', () => {
  for (const endpoint of [
    '/api/v1/reports/dashboard',
    '/api/v1/profit-intelligence/summary',
    '/api/v1/staff-enterprise/command-center',
    '/api/v1/inventory/reorder-suggestions',
    '/api/v1/security/summary',
    '/api/v1/reports/payment-modes',
    '/api/v1/pos/fraud-summary',
    '/api/v1/settings/franchise-controls',
    '/api/v1/membership-enterprise/settings',
    '/api/v1/settings/multi-branch/command-center',
  ]) {
    assert.ok(page.includes(endpoint), `${endpoint} is not wired`);
  }
  assert.doesNotMatch(page, /this\.api\.health\(/);
});

test('Command Center uses real multi-branch controls without source demo records', () => {
  for (const label of ['Multi-Branch Command Center', 'Sharing governance', 'Approval queue', 'Conflicts', 'Revenue (30d)']) {
    assert.ok(template.includes(label), `${label} is not rendered`);
  }
  assert.match(page, /settings\/multi-branch\/approvals/);
  assert.doesNotMatch(`${page}\n${template}`, /Aura Franchise|revenueRiskCount|manpowerGapCount|healthScore|createFranchise/);
});

test('Settings reuses membership settings and reloads the complete saved payload', () => {
  assert.match(settings, /api\.patch\('\/api\/v1\/membership-enterprise\/settings'/);
  assert.match(settings, /await this\.loadSharingPolicy\(\);/);
  assert.match(settings, /this\.membershipSettings = body/);
});

test('Command Center keeps every implemented workspace linked', () => {
  for (const workspace of [
    'Profit Intelligence',
    'Staff Control',
    'Inventory Autopilot',
    'Payment Intelligence',
    'Security Center',
    'Operational Dashboard',
  ]) {
    assert.ok(template.includes(workspace), `${workspace} is not linked`);
  }
});
