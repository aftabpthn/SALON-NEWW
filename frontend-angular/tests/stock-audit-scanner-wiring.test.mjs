import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const audit = read('../src/app/pages/inventory/stock-audit/stock-audit-page.component.ts');
const scanner = read('../src/app/pages/inventory/scanner/inventory-scanner-page.component.ts');
const routes = read('../src/app/app.routes.ts');

for (const path of [
  '/inventory/stock-audits',
  '/counts',
  '/counts',
  '/findings',
  '/findings',
]) assert.ok(audit.includes(path), `stock audit must call ${path}`);

assert.ok(scanner.includes('/inventory/scanner-events'));
assert.ok(scanner.includes('OFFLINE_QUEUE_KEY'));
assert.ok(scanner.includes('/inventory/stock-audits/${this.auditSessionId}/counts'));
assert.ok(audit.includes('this.sessions[0]?.id'), 'stock audit must select the first available session on initial load');
assert.ok(audit.includes("queryParams: { auditSessionId: this.selected.session.id }"), 'stock audit must hand the selected session to the scanner');
assert.ok(scanner.includes("queryParamMap.get('auditSessionId')"), 'scanner must accept a stock audit session handoff');
assert.ok(routes.includes("path: 'inventory/stock-audit'"));
