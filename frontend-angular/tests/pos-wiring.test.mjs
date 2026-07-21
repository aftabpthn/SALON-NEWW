import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const routes = readFileSync('src/app/app.routes.ts', 'utf8');
const sidebar = readFileSync('src/app/layout/app-sidebar.component.ts', 'utf8');
const checkout = readFileSync('src/app/pages/pos/pos-page.component.ts', 'utf8');
const checkoutTemplate = readFileSync('src/app/pages/pos/pos-page.component.html', 'utf8');
const enterprise = readFileSync('src/app/pages/pos/enterprise/pos-enterprise-page.component.ts', 'utf8');
const enterpriseTemplate = readFileSync('src/app/pages/pos/enterprise/pos-enterprise-page.component.html', 'utf8');
const backendRoutes = readFileSync('../backend-rust/src/routes/mod.rs', 'utf8');
const posBackend = readFileSync('../backend-rust/src/routes/pos.rs', 'utf8');
const enterpriseBackend = readFileSync('../backend-rust/src/routes/pos_enterprise.rs', 'utf8');
const reportsBackend = readFileSync('../backend-rust/src/routes/reports.rs', 'utf8');
const invoiceReports = readFileSync('src/app/pages/reports/invoices/invoice-reports-page.component.ts', 'utf8');
const invoiceReportsTemplate = readFileSync('src/app/pages/reports/invoices/invoice-reports-page.component.html', 'utf8');
const invoices = readFileSync('src/app/pages/pos/invoices/pos-invoices-page.component.ts', 'utf8');
const invoicesTemplate = readFileSync('src/app/pages/pos/invoices/pos-invoices-page.component.html', 'utf8');
const paidAtMigration = readFileSync('../backend-rust/migrations/0213_pos_payment_paid_at.sql', 'utf8');
const bookingAdvanceMigration = readFileSync('../backend-rust/migrations/0221_booking_deposit_pos_allocations.sql', 'utf8');

test('POS pages, navigation and backend routers stay connected', () => {
  for (const path of ['pos', 'pos/payment-modes', 'pos/invoices', 'pos/holds', 'pos/tips', 'pos/cash-drawer', 'pos/enterprise']) {
    assert.match(routes, new RegExp(`path: '${path.replace('/', '\\/')}'`));
  }
  for (const path of ['/pos', '/pos/invoices', '/pos/cash-drawer', '/pos/enterprise']) {
    assert.ok(sidebar.includes(`route: '${path}'`));
  }
  for (const path of ['/pos/holds', '/pos/tips', '/pos/payment-modes']) {
    assert.ok(checkoutTemplate.includes(`routerLink="${path}"`));
  }
  for (const router of ['pos::router()', 'pos_enterprise::router()', 'pos_legacy_completion::router()', 'cash_drawer::router()']) {
    assert.ok(backendRoutes.includes(router));
  }
  assert.match(routes, /path: 'pos\/sales', redirectTo: 'pos\/invoices'/);
  assert.doesNotMatch(sidebar, /route: '\/pos\/sales'/);
});

test('held invoices restore their real client and line items', () => {
  assert.match(checkout, /this\.selectedClientId = \(sale\.clientId \?\? sale\.client_id \?\? null\)/);
  assert.match(checkout, /this\.saleLines = restoredLines[\s\S]*\.map\(\(line: any\) => this\.restoreLine\(line\)\)/);
  assert.match(posBackend, /"\/pos\/invoices\/:id\/resume"/);
});

test('terminal sales are connected from Rust to the enterprise POS screen', () => {
  assert.match(enterpriseBackend, /"\/pos\/terminals\/:id\/sales"/);
  assert.match(enterprise, /\/api\/v1\/pos\/terminals\/\$\{terminalId\}\/sales\?from=/);
  assert.match(enterpriseTemplate, /\(click\)="loadTerminalSales\(row\.id\)"/);
  assert.match(enterpriseTemplate, /sales\.invoiceCount/);
  assert.match(enterpriseTemplate, /sales\.totalPaise - sales\.paidPaise/);
});

test('POS dashboard money aggregates decode as Rust i64 values', () => {
  assert.equal((posBackend.match(/COALESCE\(SUM\((?:total|paid)_paise\),0\)::BIGINT/g) ?? []).length >= 3, true);
});

test('POS dashboard recent sales query matches PosSaleRow fields', () => {
  const dashboard = posBackend.slice(posBackend.indexOf('async fn pos_dashboard'));

  assert.match(dashboard, /status, source, reference_id, package_redemptions, invoice_type/);
});

test('payment paidAt and recovered invoice days stay connected', () => {
  assert.match(paidAtMigration, /ADD COLUMN IF NOT EXISTS paid_at TIMESTAMPTZ/);
  assert.match(posBackend, /pub paid_at: DateTime<Utc>/);
  assert.match(reportsBackend, /MAX\(paid_at\) AS last_payment_at/);
  assert.match(reportsBackend, /AS recovery_days/);
  assert.match(invoiceReports, /recoveryDays\?: number \| null/);
  assert.match(invoiceReportsTemplate, /Recovery days/);
});

test('unpaid invoices collect configured direct and split payments', () => {
  assert.match(invoices, /this\.api\.get<any>\('\/pos\/payment-methods'\)/);
  assert.match(invoices, /\/api\/v1\/pos\/invoices\/\$\{invoiceId\}\/payments/);
  assert.match(invoices, /Payment total cannot exceed balance due/);
  assert.match(invoices, /referenceRequired && !payment\.reference/);
  assert.match(invoicesTemplate, />Receive payment</);
  assert.match(invoicesTemplate, /\*ngFor="let mode of paymentMethods"/);
  assert.match(posBackend, /"\/pos\/invoices\/:id\/payments", post\(add_pos_payment\)/);
});

test('invoice amount KPIs filter rows using real due and wallet contributions', () => {
  assert.match(posBackend, /received_due_paise/);
  assert.match(posBackend, /pp\.paid_at > (?:sale|fs)\.finalized_at/);
  assert.match(invoices, /activeKpiFilter: InvoiceKpiFilter \| null/);
  assert.match(invoices, /invoice\.receivedDuePaise > 0/);
  assert.match(invoices, /invoice\.balancePaise > 0/);
  assert.match(invoices, /invoice\.walletPaise > 0/);
  assert.match(invoicesTemplate, /toggleKpiFilter\('received-due'\)/);
  assert.match(invoicesTemplate, /\*ngFor="let invoice of visibleInvoices/);
});

test('POS checkout preserves paise and sends wallet credit once', () => {
  assert.match(checkout, /fillPayment\(method: PaymentMode\): void \{ if \(this\.balanceDuePaise > 0\) this\.paymentInputs\[method\.code\] = this\.paiseToInput\(this\.balanceDuePaise\); \}/);
  assert.equal((checkout.match(/walletCreditPaise: this\.walletCreditPaise/g) ?? []).length, 1);
  assert.doesNotMatch(checkout, /wallet_credit_paise: this\.walletCreditPaise/);
  assert.match(checkoutTemplate, /currency:'INR':'symbol':'1\.0-2'/);
  assert.match(posBackend, /fn percent_of_paise\(value_paise: i64, percent: i32\) -> i64/);
  assert.equal((posBackend.match(/percent_of_paise\((?:taxable_paise|line\.taxable_paise), line\.tax_percent\)/g) ?? []).length, 2);
});

test('partial POS payment can stay due or become an exact service discount', () => {
  assert.match(checkoutTemplate, /selectBalanceSettlement\('unpaid'\)/);
  assert.match(checkoutTemplate, /selectBalanceSettlement\('round_off'\)/);
  assert.match(checkout, /buildSettlementDiscountPlan\(\)/);
  assert.match(checkout, /roundToNearestRupee: this\.roundTotal/);
  assert.doesNotMatch(checkout, /roundTotal: this\.roundTotal/);
  assert.match(posBackend, /alias = "roundTotal", alias = "round_total"/);
});

test('POS client cards show the real membership activation state', () => {
  assert.equal((checkoutTemplate.match(/clientKpi\.hasActiveMembership \? 'Active membership' : 'No active membership'/g) ?? []).length, 2);
  assert.match(checkout, /hasActiveMembership: Boolean\(data\?\.hasActiveMembership \?\? data\?\.has_active_membership\)/);
  assert.match(posBackend, /has_active_membership: row\.membership_assigned_at\.is_some\(\)/);
  assert.match(checkout, /res\?\.data\?\.kpi \?\? res\?\.data \?\? res\?\.kpi \?\? res/);
});

test('final invoice without collection requires confirmation and stays unpaid', () => {
  assert.match(checkout, /if \(this\.paidNowPaise === 0\)/);
  assert.match(checkout, /window\.confirm\('No payment collected\. Save invoice as unpaid\?'\)/);
  assert.match(checkout, /this\.clearPayments\(\)/);
  assert.match(checkout, /this\.balanceSettlement = 'unpaid'/);
});

test('POS checkout keeps advances, responses, timeline and automatic delivery connected', () => {
  assert.match(checkout, /get walletCreditPaise\(\): number[\s\S]*this\.paidNowPaise/);
  assert.match(checkout, /const data = res\?\.data \?\? res/);
  assert.match(checkout, /\/api\/v1\/pos\/appointments\/\$\{appointmentId\}\/deposit/);
  assert.match(posBackend, /"\/pos\/appointments\/:id\/deposit"/);
  assert.match(bookingAdvanceMigration, /CREATE TABLE IF NOT EXISTS appointment_payment_allocations/);
  assert.match(posBackend, /queue_automatic_invoice_delivery/);
  assert.match(posBackend, /invoice\.delivery_auto_queued/);
  assert.match(invoices, /paymentTimeline: InvoicePayment\[\]/);
  assert.match(invoicesTemplate, /Payment timeline/);
});