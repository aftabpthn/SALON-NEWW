import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const routes = readFileSync('src/app/app.routes.ts', 'utf8');
const sidebar = readFileSync('src/app/layout/app-sidebar.component.ts', 'utf8');
const page = readFileSync('src/app/pages/finance/balance-sheet/balance-sheet-page.component.ts', 'utf8');
const template = readFileSync('src/app/pages/finance/balance-sheet/balance-sheet-page.component.html', 'utf8');
const styles = readFileSync('src/app/pages/finance/balance-sheet/balance-sheet-page.component.css', 'utf8');
const backendRoute = readFileSync('../backend-rust/src/routes/balance_sheet.rs', 'utf8');
const backendRepository = readFileSync('../backend-rust/src/repositories/balance_sheet_repository.rs', 'utf8');

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

test('Phase 7 reuses live balances for comparison, evidence and native exports', () => {
  assert.match(page, /currentPaise - comparisonPaise/);
  assert.match(page, /new Blob\(\[`\\uFEFF\$\{csv\}`\]/);
  assert.match(page, /window\.print\(\)/);
  assert.match(template, /Comparative Balance Sheet/);
  assert.match(template, /toggleLedgerEvidence\(row\)/);
  assert.match(template, /Audit CSV/);
  assert.match(styles, /@media print/);
});

test('Phase 7 tenant scope is role-gated and aggregates only authorized branches', () => {
  assert.match(template, /All authorized branches/);
  assert.match(page, /scope: this\.comparisonScope/);
  assert.match(backendRoute, /multi-branch Balance Sheet access requires owner, admin, manager, or analyst role/);
  assert.match(backendRoute, /auth_repository::list_branch_access/);
  assert.match(backendRepository, /entry\.branch_id=ANY\(\$2\)/);
});
