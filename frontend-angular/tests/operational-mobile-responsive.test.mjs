import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const appointments = read('../src/app/pages/appointments/appointments-page.component.css');
const pos = read('../src/app/pages/pos/pos-page.component.css');
const clients = read('../src/app/pages/clients/clients-page.component.css');
const inventory = read('../src/app/pages/inventory/inventory-page.component.css');
const reports = read('../src/app/pages/reports/reports-page.component.css');
const invoiceReports = read('../src/app/pages/reports/invoices/invoice-reports-page.component.css');

assert.match(appointments, /\.appointment-detail-drawer,[\s\S]*\.booking-flyout,[\s\S]*\.command-flyout[\s\S]*width: 100vw/);
assert.match(appointments, /\.status-board-mode,[\s\S]*\.capacity-view-mode[\s\S]*grid-template-columns: 1fr/);
assert.match(pos, /\.items-head,[\s\S]*\.item-row[\s\S]*min-width: 820px/);
assert.match(pos, /\.client-drawer[\s\S]*width: 100vw/);
assert.match(clients, /\.client-drawer,[\s\S]*\.gift-register-drawer[\s\S]*width: 100vw/);
assert.match(inventory, /\.entry-line\.transfer-line,[\s\S]*\.entry-line\.kit-line[\s\S]*grid-template-columns: 1fr/);
assert.match(inventory, /\.drawer[\s\S]*width: 100vw/);
assert.match(reports, /\.action-drawer,[\s\S]*\.drill-drawer[\s\S]*width: 100vw/);
assert.match(invoiceReports, /\.mobile-register\{display:grid/);

for (const source of [appointments, pos, clients, inventory, reports]) {
  assert.match(source, /min-height: 44px/, 'Missing mobile touch target');
}

console.log('Operational mobile responsive checks passed');
