import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const routes = readFileSync('src/app/app.routes.ts', 'utf8');
const sidebar = readFileSync('src/app/layout/app-sidebar.component.ts', 'utf8');
const checkout = readFileSync('src/app/pages/pos/pos-page.component.ts', 'utf8');
const appointments = readFileSync('src/app/pages/appointments/appointments-page.component.ts', 'utf8');
const appointmentsTemplate = readFileSync('src/app/pages/appointments/appointments-page.component.html', 'utf8');
const checkoutTemplate = readFileSync('src/app/pages/pos/pos-page.component.html', 'utf8');
const enterprise = readFileSync('src/app/pages/pos/enterprise/pos-enterprise-page.component.ts', 'utf8');
const enterpriseTemplate = readFileSync('src/app/pages/pos/enterprise/pos-enterprise-page.component.html', 'utf8');
const backendRoutes = readFileSync('../backend-rust/src/routes/mod.rs', 'utf8');
const posBackend = readFileSync('../backend-rust/src/routes/pos.rs', 'utf8');
const inventoryAdjustments = readFileSync('../backend-rust/src/services/inventory_adjustment_service.rs', 'utf8');
const enterpriseBackend = readFileSync('../backend-rust/src/routes/pos_enterprise.rs', 'utf8');
const reportsBackend = readFileSync('../backend-rust/src/routes/reports.rs', 'utf8');
const invoiceReports = readFileSync('src/app/pages/reports/invoices/invoice-reports-page.component.ts', 'utf8');
const invoiceReportsTemplate = readFileSync('src/app/pages/reports/invoices/invoice-reports-page.component.html', 'utf8');
const invoices = readFileSync('src/app/pages/pos/invoices/pos-invoices-page.component.ts', 'utf8');
const invoicesTemplate = readFileSync('src/app/pages/pos/invoices/pos-invoices-page.component.html', 'utf8');
const invoicesCss = readFileSync('src/app/pages/pos/invoices/pos-invoices-page.component.css', 'utf8');
const holds = readFileSync('src/app/pages/pos/holds/pos-holds-page.component.ts', 'utf8');
const holdsTemplate = readFileSync('src/app/pages/pos/holds/pos-holds-page.component.html', 'utf8');
const paidAtMigration = readFileSync('../backend-rust/migrations/0213_pos_payment_paid_at.sql', 'utf8');
const bookingAdvanceMigration = readFileSync('../backend-rust/migrations/0231_booking_deposit_pos_allocations.sql', 'utf8');
const clientDueReceiptMigration = readFileSync('../backend-rust/migrations/0233_pos_client_due_receipts.sql', 'utf8');
const invoiceCorrectionMigration = readFileSync('../backend-rust/migrations/0234_pos_invoice_correction_approvals.sql', 'utf8');
const dueReceiptReceivedByMigration = readFileSync('../backend-rust/migrations/0237_pos_due_receipt_received_by.sql', 'utf8');

test('POS pages, navigation and backend routers stay connected', () => {
  for (const path of ['pos', 'pos/payment-modes', 'pos/invoices', 'pos/holds', 'pos/tips', 'pos/cash-drawer', 'pos/enterprise']) {
    assert.match(routes, new RegExp(`path: '${path.replace('/', '\\/')}'`));
  }
  assert.match(routes, /path: 'pos\/enterprise'[\s\S]*roles: \['owner', 'admin', 'manager'\]/);
  assert.match(enterpriseTemplate, /management view of the same branch drawer/i);
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

test('POS inventory uses the shared service and enforces saved recipe policy', () => {
  assert.match(posBackend, /inventory_adjustment_service::consume_pos_sale/);
  assert.match(posBackend, /inventory_adjustment_service::restock_pos_product_return/);
  assert.doesNotMatch(posBackend, /async fn consume_inventory_for_sale/);
  assert.doesNotMatch(posBackend, /async fn restock_returned_product/);
  assert.match(inventoryAdjustments, /requireRecipeForService/);
  assert.match(inventoryAdjustments, /service recipe is required by Service Settings before POS checkout/);
  assert.match(inventoryAdjustments, /allocate_fefo_batches/);
  assert.match(inventoryAdjustments, /restore_sale_batches/);
});

test('appointment completion opens its own POS draft without generic held resume', () => {
  assert.match(appointments, /queryParams: \{ appointmentId: targetId, appointmentDraftId: saleId \}/);
  assert.doesNotMatch(appointments, /queryParams: \{ draft: saleId \}/);
  assert.match(checkout, /const appointmentDraftId = this\.route\.snapshot\.queryParamMap\.get\('appointmentDraftId'\)/);
  assert.match(checkout, /this\.appointmentIdFromRoute = appointmentDraftId \? '' : this\.route\.snapshot\.queryParamMap\.get\('appointmentId'\) \|\| ''/);
  assert.match(checkout, /if \(!draftId && !this\.appointmentIdFromRoute && !appointmentDraftId\) this\.restoreWorkingDraft\(\)/);
  assert.match(checkout, /if \(appointmentDraftId\) \{[\s\S]*this\.restoreAppointmentDraft\(appointmentDraftId\)/);
  assert.match(checkout, /Appointment POS can only open appointment-linked draft invoices/);
});

test('appointment booking shows the selected client membership dates from the POS KPI', () => {
  assert.match(appointments, /membershipAssignDate: kpi\?\.membershipAssignDate \?\? kpi\?\.membershipAssignedAt/);
  assert.match(appointments, /membershipExpireDate: kpi\?\.membershipExpireDate \?\? kpi\?\.membershipExpiresAt/);
  assert.match(appointmentsTemplate, /kpi\.membershipAssignDate \| date:'dd\/MM\/yyyy'/);
  assert.match(appointmentsTemplate, /kpi\.membershipExpireDate \| date:'dd\/MM\/yyyy'/);
});

test('appointment completion auto-holds an active POS checkout', () => {
  assert.match(appointments, /this\.requestPosAutoHold\(targetId\);[\s\S]*queryParams: \{ appointmentId: targetId, appointmentDraftId: saleId \}/);
  assert.match(appointments, /sessionStorage\.getItem\(this\.posStorageKey\('working_draft'\)\)[\s\S]*sessionStorage\.setItem\(this\.posStorageKey\('auto_hold_pending'\)/);
  assert.match(appointments, /localStorage\.setItem\(this\.posStorageKey\('auto_hold'\)/);
  assert.match(checkout, /@HostListener\('window:storage', \['\$event'\]\)/);
  assert.match(checkout, /event\.key !== this\.posAutoHoldStorageKey\(\)[\s\S]*this\.holdInvoice\(\)/);
  assert.match(checkout, /autoHoldWorkingDraft && this\.restoreWorkingDraft\(\)[\s\S]*this\.holdInvoice\(\(\) => \{[\s\S]*this\.draftId = null;[\s\S]*this\.restoreAppointmentDraft\(appointmentDraftId\)/);
  assert.match(checkout, /holdInvoice\(afterHold\?: \(\) => void\): void \{ this\.saveSale\('draft', \{\}, afterHold\); \}/);
  assert.match(holds, /status=draft/);
});

test('held invoices restore their real client and line items', () => {
  assert.match(checkout, /this\.selectedClientId = \(sale\.clientId \?\? sale\.client_id \?\? null\)/);
  assert.match(checkout, /this\.saleLines = restoredLines[\s\S]*\.map\(\(line: any\) => this\.restoreLine\(line\)\)/);
  assert.match(posBackend, /"\/pos\/invoices\/:id\/resume"/);
});

test('held invoice register keeps actions in the full-width table without duplicate details', () => {
  assert.doesNotMatch(holdsTemplate, /Hold details|Selected total|ledger-detail/);
  assert.doesNotMatch(holds, /selected: HeldInvoice|select\(hold: HeldInvoice\)/);
  assert.match(holdsTemplate, /class="hold-actions"/);
});

test('held invoices can be cancelled through the audited draft lifecycle', () => {
  assert.match(holds, /\/api\/v1\/pos\/invoices\/\$\{hold\.id\}\/void/);
  assert.match(holds, /reason: 'Held invoice discarded'/);
  assert.match(holdsTemplate, /\(click\)="cancel\(hold, \$event\)"/);
  assert.match(posBackend, /only unpaid draft or open invoices can be voided/);
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
  assert.match(reportsBackend, /MAX\((?:payment\.)?paid_at\) AS last_payment_at/);
  assert.match(reportsBackend, /AS recovery_days/);
  assert.match(invoiceReports, /recoveryDays\?: number \| null/);
  assert.match(invoiceReportsTemplate, />Aging</);
});

test('unpaid invoices collect configured direct and split payments', () => {
  assert.match(invoices, /this\.api\.get<any>\('\/pos\/payment-methods'\)/);
  assert.match(invoices, /\/api\/v1\/pos\/invoices\/\$\{invoiceId\}\/payments/);
  assert.match(invoices, /Payment total cannot exceed balance due/);
  assert.match(invoices, /referenceRequired && !payment\.reference/);
  assert.match(invoicesTemplate, />Receive payment</);
  assert.match(invoicesTemplate, /(\*ngFor="let mode of paymentMethods"|@for \(mode of paymentMethods; track mode\))/);
  assert.match(posBackend, /"\/pos\/invoices\/:id\/payments", post\(add_pos_payment\)/);
});

test('POS receives a client total due atomically against oldest invoices with wallet support', () => {
  assert.match(checkout, /\/api\/v1\/pos\/clients\/\$\{this\.selectedClientId\}\/unpaid-payments/);
  assert.match(checkout, /method\.code === 'wallet' && amountPaise > this\.clientKpi\.walletPaise/);
  assert.match(checkoutTemplate, /Receive unpaid/);
  assert.match(checkoutTemplate, /unpaidReceiveMethod === 'wallet'/);
  assert.match(posBackend, /"\/pos\/clients\/:id\/unpaid-payments"/);
  assert.match(posBackend, /ORDER BY COALESCE\(finalized_at, created_at\), created_at, id FOR UPDATE/);
  assert.match(posBackend, /allocate_client_due_fifo/);
  assert.match(posBackend, /settle_pos_internal_payment/);
  assert.match(clientDueReceiptMigration, /UNIQUE INDEX IF NOT EXISTS idx_pos_client_due_receipts_idempotency/);
});

test('invoice amount KPIs filter rows using real due and wallet contributions', () => {
  assert.match(posBackend, /received_due_paise/);
  assert.match(posBackend, /pp\.paid_at > (?:sale|fs)\.finalized_at/);
  assert.match(invoices, /activeKpiFilter: InvoiceKpiFilter \| null/);
  assert.match(invoices, /invoice\.receivedDuePaise > 0/);
  assert.match(invoices, /invoice\.balancePaise > 0/);
  assert.match(invoices, /invoice\.walletPaise > 0/);
  assert.match(invoicesTemplate, /toggleKpiFilter\('received-due'\)/);
  assert.match(invoicesTemplate, /(\*ngFor="let invoice of visibleInvoices|@for \(invoice of visibleInvoices; track trackByInvoice)/);
});

test('invoice register uses API filters and keeps zero-value invoices honest', () => {
  assert.match(invoices, /new URLSearchParams\(\{ page: '1', pageSize: '100' \}\)/);
  assert.match(invoices, /params\.set\('q', this\.searchText\.trim\(\)\.toLowerCase\(\)\)/);
  assert.match(invoices, /params\.set\('status', this\.statusFilter\)/);
  assert.match(invoices, /params\.set\('payment_method', this\.paymentMethodFilter\)/);
  assert.match(invoices, /return 'No charge'/);
  assert.match(invoices, /row\.totalPaise === 0 \? 'No charge'/);
  assert.match(invoicesTemplate, /name="invoiceSearch"/);
  assert.match(invoicesTemplate, /name="invoiceStatus"/);
  assert.match(invoicesTemplate, /name="paymentMethod"/);
});

test('POS checkout preserves paise and sends wallet credit once', () => {
  assert.match(checkout, /fillPayment\(method: PaymentMode\): void/);
  assert.equal((checkout.match(/walletCreditPaise: options\.forceUnpaid \? 0 : paymentSplit\.length \? this\.walletCreditPaise : 0/g) ?? []).length, 1);
  assert.doesNotMatch(checkout, /wallet_credit_paise: this\.walletCreditPaise/);
  assert.match(checkoutTemplate, /currency:'INR':'symbol':'1\.0-2'/);
  assert.match(posBackend, /fn percent_of_paise\(value_paise: i64, percent: i32\) -> i64/);
  assert.equal((posBackend.match(/percent_of_paise\((?:taxable_paise|line\.taxable_paise), line\.tax_percent\)/g) ?? []).length, 2);
});

test('POS checkout applies coupons before payment and supports partial wallet overpay', () => {
  assert.match(checkout, /get walletCreditPaise\(\): number \{[\s\S]*return this\.toPaise\(this\.num\(this\.walletCreditAmount\)\)/);
  assert.match(checkout, /this\.api\.post<any>\('\/api\/v1\/pos\/coupons\/preview'/);
  assert.match(checkout, /Apply coupon before saving/);
  assert.match(checkoutTemplate, /\(click\)="applyCoupon\(\)"/);
  assert.match(posBackend, /"\/pos\/coupons\/preview", post\(preview_pos_coupon\)/);
  assert.match(posBackend, /resolve_coupon_discount\(&state, &tenant_id, &branch_id, &mut payload\)\.await\?/);
  assert.match(posBackend, /target_service_ids, target_service_categories, target_package_ids/);
  assert.match(posBackend, /SELECT DISTINCT package_id FROM client_package_credits WHERE tenant_id=\$1 AND branch_id=\$2 AND client_id=\$3 AND id=ANY\(\$4\)/);
  assert.match(posBackend, /if !id_match && !category_match && !package_match/);
});

test('wallet payment is capped to the selected client balance', () => {
  assert.match(checkout, /item\.code !== method\.code/);
  assert.match(checkout, /remainingPaise = Math\.max\(0, this\.totalPaise - this\.bookingAdvanceAppliedPaise - paidByOtherModes\)/);
  assert.match(checkout, /method\.code === 'wallet'\) return Math\.min\(remainingPaise, this\.clientKpi\.walletPaise\)/);
  assert.match(checkout, /amountPaise > this\.clientKpi\.walletPaise/);
  assert.match(checkoutTemplate, /paymentFillPaise\(method\)/);
  assert.match(checkoutTemplate, /walletRedemptionError\(\)/);
  assert.doesNotMatch(checkoutTemplate, /isOnline \? 'Online' : 'Offline'/);
});

test('unsaved POS bill survives route navigation and refresh until committed or cleared', () => {
  assert.match(checkout, /ngOnDestroy\(\): void \{[\s\S]*this\.persistWorkingDraft\(\)/);
  assert.match(checkout, /@HostListener\('window:beforeunload'\)/);
  assert.match(checkout, /sessionStorage\.setItem\(this\.workingDraftStorageKey\(\)/);
  assert.match(checkout, /if \(!draftId && !this\.appointmentIdFromRoute && !appointmentDraftId\) this\.restoreWorkingDraft\(\)/);
  assert.match(checkout, /this\.message = 'Unsaved bill restored'/);
  assert.match(checkout, /this\.workingDraftCommitted = true;[\s\S]*this\.clearWorkingDraft\(\)/);
  assert.match(checkout, /clearSaleLines\(\): void \{[\s\S]*this\.clearWorkingDraft\(\)/);
});

test('client search starts blank and shows Walk-in only after its action', () => {
  assert.match(checkout, /clientSearchText = '';/);
  assert.match(checkout, /walkInClient\(\): void \{ this\.clientSearchText = 'Walk-in client'/);
  assert.match(checkoutTemplate, /\(click\)="walkInClient\(\)"/);
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
  assert.match(checkout, /this\.saveSale\('finalized', \{ forceUnpaid: true \}\)/);
});

test('package-only redemption can save a zero-value invoice and reaches the backend', () => {
  assert.match(checkout, /this\.saleLines\.some\(\(line\) => this\.isLineReady\(line\)\) \|\| this\.membershipRedeemCount\(\) > 0 \|\| this\.packageRedeemCount\(\) > 0/);
  assert.match(checkout, /lineType: 'package_redeem', line_type: 'package_redeem'/);
  assert.match(checkout, /const packageRedemptions = this\.packageRedemptionPayload\(\);[\s\S]*lines\.push\(\.\.\.packageRedemptions\.map/);
  assert.match(posBackend, /"package_redeem" \| "package-redeem" => "package_redeem"/);
  assert.match(posBackend, /consume_package_redemptions\([\s\S]*&package_redemptions/);
});

test('saved invoice corrections require maker-checker approval and a balanced ledger delta', () => {
  assert.match(invoicesTemplate, />Edit invoice</);
  assert.match(invoices, /\/api\/v1\/pos\/invoices\/\$\{selectedId\}\/correction-requests/);
  assert.match(invoices, /\/api\/v1\/pos\/invoice-correction-requests\/\$\{requestId\}\/decision/);
  assert.match(posBackend, /requester cannot approve or reject their own invoice correction/);
  assert.match(posBackend, /fn sale_is_line_editable\(status: &str\) -> bool \{\s*status == "draft"\s*\}/);
  assert.match(posBackend, /post_invoice_correction/);
  assert.match(invoiceCorrectionMigration, /uq_pos_invoice_correction_pending/);
});

test('detailed invoice register keeps line money, invoice totals, exports and drill-down connected', () => {
  assert.match(reportsBackend, /"\/reports\/invoices\/detailed"/);
  assert.match(reportsBackend, /sale\.is_deleted=FALSE/);
  assert.match(reportsBackend, /COUNT\(DISTINCT invoice_id\)::BIGINT AS invoice_count/);
  assert.match(reportsBackend, /SELECT DISTINCT invoice_id,paid_paise,due_paise,wallet_paise FROM filtered_lines/);
  assert.match(reportsBackend, /line\.gross_paise, line\.discount_paise/);
  assert.match(reportsBackend, /line\.cgst_paise, line\.sgst_paise, line\.igst_paise/);
  assert.match(invoiceReports, /activeTab: ReportTab = 'invoice-360'/);
  assert.match(invoiceReports, /exportDetailedCsv\(\)/);
  assert.match(invoiceReports, /exportDetailedPdf\(\)/);
  assert.match(invoiceReportsTemplate, /Detailed Invoice Register/);
  assert.match(invoiceReportsTemplate, /\[queryParams\]="\{ invoiceId: row\.invoiceId \}"/);
});

test('invoice register links invoice, client, staff and payment mode to their real destinations', () => {
  assert.match(posBackend, /pub struct PosSalesRegisterRow \{[\s\S]*?pub staff_name: String/);
  assert.match(posBackend, /LEFT JOIN staff s[\s\S]*?s\.id = ps\.staff_id/);
  assert.match(invoices, /registerPaymentModes\(row\)/);
  assert.match(invoicesTemplate, /\(click\)="select\(invoice\)"/);
  assert.match(invoicesTemplate, /\[routerLink\]="\['\/clients', invoice\.clientId\]"/);
  assert.match(invoicesTemplate, /\[routerLink\]="\['\/staff', invoice\.staffId\]"/);
  assert.match(invoicesTemplate, /routerLink="\/pos\/payment-modes"/);
  assert.match(invoicesTemplate, /<span>Payment status<\/span>/);
  assert.match(invoicesTemplate, /class="payment-status"><em class="status-badge" \[ngClass\]="statusTone\(lifecycleLabel\(invoice\)\)">\{\{ lifecycleLabel\(invoice\) \}\}<\/em>/);
  assert.match(invoicesTemplate, /<span>Invoice status<\/span>/);
  assert.match(invoicesTemplate, /class="invoice-status"><em class="status-badge" \[ngClass\]="statusTone\(invoice\.status\)">\{\{ invoice\.status \|\| '-' \}\}<\/em>/);
  assert.doesNotMatch(invoicesTemplate, /<button[^>]*class="invoice-row"/);
});

test('invoice reports consolidate old report logic into five connected workspaces', () => {
  assert.match(invoiceReports, /type ReportTab = 'invoice-360' \| 'receivable-recovery' \| 'payment-wallet' \| 'staff-service-360' \| 'finance-control'[\s\S]*'detailed-invoice'[\s\S]*'payment-collection'[\s\S]*'staff-service-discount'/);
  assert.match(invoiceReports, /forkJoin\(requests\.map/);
  assert.match(invoiceReports, /sourceTabsForActive\(\)[\s\S]*'due-recovery', 'recovery-history'/);
  assert.match(invoiceReports, /sourceTabsForActive\(\)[\s\S]*'payment-collection', 'wallet-ledger'/);
  assert.match(invoiceReports, /sourceTabsForActive\(\)[\s\S]*'product-sales', 'product-movements', 'balance-sheet', 'working-capital'/);
  assert.match(invoiceReports, /return '\/balance-sheet\/live'/);
  assert.match(invoiceReports, /return '\/api\/v1\/reports\/invoices\/service-trends'/);
  assert.match(invoiceReports, /return '\/api\/v1\/reports\/invoices\/service-clients'/);
  assert.match(invoiceReports, /return '\/balance-sheet\/working-capital'/);
  assert.match(invoiceReportsTemplate, />Invoice 360</);
  assert.match(invoiceReportsTemplate, />Receivable & Recovery</);
  assert.match(invoiceReportsTemplate, />Payment & Wallet</);
  assert.match(invoiceReportsTemplate, />Finance Control</);
  assert.match(invoiceReportsTemplate, />Detailed Invoice</);
  assert.match(invoiceReportsTemplate, />Current Unpaid</);
  assert.match(invoiceReportsTemplate, />Recovery History</);
  assert.match(invoiceReportsTemplate, />Wallet Ledger</);
  assert.match(invoiceReportsTemplate, />Payment Collection</);
  assert.match(invoiceReportsTemplate, />Staff-Service-Discount</);
  assert.match(invoiceReportsTemplate, />Open ledger</);
});

test('current unpaid report keeps due history, aging and recovery actions connected', () => {
  assert.match(reportsBackend, /payment\.paid_at > sale\.finalized_at THEN payment\.amount_paise/);
  assert.match(reportsBackend, /GREATEST\(ps\.total_paise - ps\.paid_paise, 0\) \+ COALESCE\(payment\.received_due_paise,0\) AS original_due_paise/);
  assert.match(reportsBackend, /WHEN ageing_days<=7 THEN '0-7'[\s\S]*WHEN ageing_days<=60 THEN '31-60'[\s\S]*ELSE '61\+'/);
  assert.match(reportsBackend, /COALESCE\(lines\.service_names,'No service'\) AS service_names/);
  assert.match(invoiceReports, /params\.set\('recovery', 'due'\)/);
  assert.match(invoiceReports, /exportCurrentUnpaidCsv\(\)/);
  assert.match(invoiceReports, /exportCurrentUnpaidPdf\(\)/);
  assert.match(invoiceReportsTemplate, />Current Unpaid</);
  assert.match(invoiceReportsTemplate, />Original due</);
  assert.match(invoiceReportsTemplate, />Received due</);
  assert.match(invoiceReportsTemplate, />Remaining due</);
  assert.match(invoiceReportsTemplate, /queueDueReminders\(\)/);
  assert.match(invoiceReportsTemplate, /recordFollowUp\(row, 'call_done'\)/);
});

test('recovery history shows recovered dues, payment history and FIFO allocations', () => {
  assert.match(dueReceiptReceivedByMigration, /received_by_user_id TEXT NOT NULL DEFAULT ''/);
  assert.match(posBackend, /Extension\(claims\): Extension<AuthClaims>[\s\S]*received_by_user_id/);
  assert.match(reportsBackend, /\$5='recovered' AND ps\.paid_paise >= ps\.total_paise AND COALESCE\(payment\.received_due_paise,0\)>0/);
  assert.match(reportsBackend, /JSONB_AGG\(JSONB_BUILD_OBJECT\([\s\S]*'paymentMode', payment\.method[\s\S]*'receivedBy', COALESCE\(receipt\.received_by_user_id,''\)/);
  assert.match(reportsBackend, /fifo_allocation_summary AS[\s\S]*JSONB_ARRAY_ELEMENTS\(receipt\.allocations_json\)/);
  assert.match(reportsBackend, /'balanceBeforePaise'[\s\S]*'balanceAfterPaise'/);
  assert.match(invoiceReports, /'recovery-history'/);
  assert.match(invoiceReports, /params\.set\('recovery', 'recovered'\)/);
  assert.match(invoiceReports, /exportRecoveryHistoryCsv\(\)/);
  assert.match(invoiceReportsTemplate, />Recovery History</);
  assert.match(invoiceReportsTemplate, />Full-paid date</);
  assert.match(invoiceReportsTemplate, />Partial-payment history</);
  assert.match(invoiceReportsTemplate, />FIFO allocation</);
});

test('wallet ledger reports client balances, references and liability', () => {
  assert.match(reportsBackend, /"\/reports\/wallet-ledger"/);
  assert.match(reportsBackend, /pub struct WalletLedgerRow/);
  assert.match(reportsBackend, /wt\.balance_after_paise-wt\.delta_paise\)::BIGINT AS opening_balance_paise/);
  assert.match(reportsBackend, /wt\.balance_after_paise AS closing_balance_paise/);
  assert.match(reportsBackend, /current_liability_paise/);
  assert.match(reportsBackend, /LEFT JOIN pos_sales invoice ON invoice\.id=wt\.reference_id/);
  assert.match(invoiceReports, /'wallet-ledger'/);
  assert.match(invoiceReports, /\/api\/v1\/reports\/wallet-ledger/);
  assert.match(invoiceReports, /exportWalletLedgerCsv\(\)/);
  assert.match(invoiceReportsTemplate, />Wallet Ledger</);
  assert.match(invoiceReportsTemplate, />Wallet liability</);
  assert.match(invoiceReportsTemplate, />Opening</);
  assert.match(invoiceReportsTemplate, />Closing</);
  assert.match(invoiceReportsTemplate, /row\.invoiceNumber/);
});

test('payment collection report reconciles split methods and due receipts', () => {
  assert.match(reportsBackend, /"\/reports\/payment-collection"/);
  assert.match(reportsBackend, /pub struct PaymentCollectionRow/);
  assert.match(reportsBackend, /pub struct PaymentCollectionSummary/);
  assert.match(reportsBackend, /due_receipt_map AS[\s\S]*JSONB_ARRAY_ELEMENTS\(receipt\.allocations_json\)/);
  assert.match(reportsBackend, /WHEN LOWER\(payment\.method\)='cash' THEN 'cash'/);
  assert.match(reportsBackend, /WHEN LOWER\(payment\.method\) IN \('online','bank_transfer','razorpay','payment_link','qr'\) THEN 'online'/);
  assert.match(reportsBackend, /split_payment_count/);
  assert.match(reportsBackend, /invoice_time_paise/);
  assert.match(reportsBackend, /due_receipt_paise/);
  assert.match(invoiceReports, /'payment-collection'/);
  assert.match(invoiceReports, /\/api\/v1\/reports\/payment-collection/);
  assert.match(invoiceReports, /exportPaymentCollectionCsv\(\)/);
  assert.match(invoiceReportsTemplate, />Payment Collection</);
  assert.match(invoiceReportsTemplate, />Later due receipt</);
  assert.match(invoiceReportsTemplate, />Split detail</);
  assert.match(invoiceReportsTemplate, /row\.receivedBy/);
});

test('staff service discount report attributes services, splits and approvals', () => {
  assert.match(reportsBackend, /"\/reports\/invoices\/staff-service-discount"/);
  assert.match(reportsBackend, /pub struct StaffServiceDiscountRow/);
  assert.match(reportsBackend, /STAFF_SERVICE_DISCOUNT_BASE_SQL/);
  assert.match(reportsBackend, /line\.line_type='service'/);
  assert.match(reportsBackend, /JSONB_ARRAY_ELEMENTS/);
  assert.match(reportsBackend, /manual_discount_paise/);
  assert.match(reportsBackend, /coupon_discount_paise/);
  assert.match(reportsBackend, /membership_discount_paise/);
  assert.match(reportsBackend, /pos_discount_approval_requests/);
  assert.match(invoiceReports, /'staff-service-discount'/);
  assert.match(invoiceReports, /\/api\/v1\/reports\/invoices\/staff-service-discount/);
  assert.match(invoiceReports, /exportStaffServiceDiscountCsv\(\)/);
  assert.match(invoiceReportsTemplate, />Staff-Service-Discount</);
  assert.match(invoiceReportsTemplate, />Manual discount</);
  assert.match(invoiceReportsTemplate, />Membership</);
  assert.match(invoiceReportsTemplate, /row\.splitPercent/);
  assert.match(invoiceReportsTemplate, /row\.approvalStatus/);
});

test('POS checkout keeps advances, responses, timeline and automatic delivery connected', () => {
  assert.match(checkout, /get unappliedOverpayPaise\(\): number[\s\S]*this\.paidNowPaise/);
  assert.match(checkout, /const data = res\?\.data \?\? res/);
  assert.match(checkout, /\/api\/v1\/pos\/appointments\/\$\{appointmentId\}\/deposit/);
  assert.match(posBackend, /"\/pos\/appointments\/:id\/deposit"/);
  assert.match(bookingAdvanceMigration, /CREATE TABLE IF NOT EXISTS appointment_payment_allocations/);
  assert.match(posBackend, /queue_automatic_invoice_delivery/);
  assert.match(posBackend, /invoice\.delivery_auto_queued/);
  assert.match(invoices, /paymentTimeline: InvoicePayment\[\]/);
  assert.match(invoicesTemplate, /Payment timeline/);
});

test('full invoice detail stays compact with focused sections', () => {
  assert.match(invoices, /activeDetailTab: 'overview' \| 'items' \| 'payments' \| 'activity'/);
  assert.match(invoicesTemplate, /Invoice detail sections/);
  assert.match(invoicesTemplate, /activeDetailTab === 'items'[\s\S]*Invoice items/);
  assert.match(invoicesTemplate, /activeDetailTab === 'payments'[\s\S]*Payment timeline/);
  assert.match(invoicesTemplate, /activeDetailTab === 'activity'[\s\S]*Action history/);
  assert.match(invoices, /statusTone\(value: string\)/);
  assert.match(invoicesTemplate, /Payment and invoice status/);
  for (const tone of ['paid', 'unpaid', 'partial', 'recovered', 'pending', 'danger']) {
    assert.match(invoicesCss, new RegExp(`status-${tone}`));
  }
});
