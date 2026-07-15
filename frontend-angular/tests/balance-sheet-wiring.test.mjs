import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const routes = readFileSync('src/app/app.routes.ts', 'utf8');
const sidebar = readFileSync('src/app/layout/app-sidebar.component.ts', 'utf8');
const page = readFileSync('src/app/pages/finance/balance-sheet/balance-sheet-page.component.ts', 'utf8');

test('Balance Sheet route and sidebar open the finance page', () => {
  assert.match(routes, /path: 'finance',[\s\S]*balance-sheet-page\.component/);
  assert.match(routes, /path: 'finance\/fixed-assets',[\s\S]*financeTab: 'fixedAssets'/);
  assert.match(sidebar, /label: 'Balance Sheet',[^\n]*route: '\/finance'/);
});

test('Balance Sheet loads every live finance data source', () => {
  for (const endpoint of [
    '/balance-sheet/accounts',
    '/balance-sheet/live?',
    '/balance-sheet/working-capital?',
    '/balance-sheet/ledger?',
    '/balance-sheet/fixed-assets',
    '/balance-sheet/deferred-revenue',
    '/balance-sheet/periods',
    '/balance-sheet/cost-centers',
    '/balance-sheet/hardening-status?',
  ]) {
    assert.ok(page.includes(endpoint), `${endpoint} is not wired`);
  }
});

test('Balance Sheet writes automatically reload affected API data', () => {
  for (const wiring of [
    ["this.api.post('/balance-sheet/journals'", 'this.loadOverview(), this.loadHardening()'],
    ["this.api.post('/balance-sheet/fixed-assets'", 'this.loadFixedAssets(), this.loadOverview(), this.loadHardening()'],
    ['/depreciation`', 'this.loadFixedAssets(), this.loadOverview(), this.loadHardening()'],
    ['/recognize`', 'this.loadDeferredRevenue(), this.loadOverview(), this.loadHardening()'],
    ["this.api.post('/balance-sheet/periods/close'", 'this.loadPeriods(), this.loadOverview(), this.loadHardening()'],
    ['/reopen`', 'this.loadPeriods(), this.loadOverview(), this.loadHardening()'],
    ['/cost-center`', 'this.loadLedger(this.ledgerPage)'],
    ["this.api.post('/balance-sheet/snapshots'", 'this.loadOverview(), this.loadHardening()'],
  ]) {
    const [action, reload] = wiring;
    const actionIndex = page.indexOf(action);
    assert.notEqual(actionIndex, -1, `${action} is not wired`);
    assert.ok(page.slice(actionIndex, actionIndex + 900).includes(reload), `${action} does not reload affected data`);
  }
});
