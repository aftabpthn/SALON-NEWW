import { CommonModule } from '@angular/common';
import { Component, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { forkJoin } from 'rxjs';
import { DatePickerComponent } from '../../../shared/date-picker/date-picker.component';
import { ApiService } from '../../../shared/services/api.service';

type ReportTab = 'invoice-360' | 'receivable-recovery' | 'payment-wallet' | 'staff-service-360' | 'finance-control' | 'detailed-invoice' | 'due-recovery' | 'recovery-history' | 'wallet-ledger' | 'payment-collection' | 'staff-service-discount' | 'payment-modes';
type SourceReportTab = 'detailed-invoice' | 'invoice-activity' | 'due-recovery' | 'recovery-history' | 'wallet-ledger' | 'payment-collection' | 'staff-service-discount' | 'payment-modes' | 'service-trends' | 'service-clients' | 'product-sales' | 'product-movements' | 'balance-sheet' | 'working-capital';
interface FilterOption { id: string; name: string; }
interface PaymentMode { code: string; name: string; }
interface InvoiceReportRow { id: string; invoiceNumber: string; branchId: string; clientName: string; staffName: string; businessDate: string; status: string; totalPaise: number; paidPaise: number; balancePaise: number; ageingDays: number; followUpRequired: boolean; }
interface InvoiceActivityRow { invoiceId: string; invoiceNumber: string; activityType: string; channel: string; recipient: string; status: string; createdAt: string; }
interface DueRecoveryRow { invoiceId: string; invoiceNumber: string; businessDate: string; unpaidAt: string; clientName: string; clientPhone: string; serviceNames: string; staffNames: string; totalPaise: number; paidPaise: number; originalDuePaise: number; receivedDuePaise: number; balancePaise: number; ageingDays: number; ageingBucket: string; recoveryDays?: number | null; recovered: boolean; fullPaidAt?: string; paymentModes: string; paymentReferences: string; receivedBy: string; recoveryPaymentHistory: Array<{ paymentId: string; paidAt: string; amountPaise: number; paymentMode: string; reference: string; receivedBy: string }>; fifoAllocations: Array<{ receiptId: string; paidAt: string; paymentMode: string; reference: string; receivedBy: string; balanceBeforePaise: number; receivedPaise: number; balanceAfterPaise: number }>; followUpCount: number; lastFollowUpAt?: string; lastPaymentAt?: string; recoveryManagerId: string; recoveryManagerName: string; }
interface CurrentUnpaidSummary { invoiceCount: number; originalDuePaise: number; receivedDuePaise: number; remainingDuePaise: number; overdue31Count: number; }
interface RecoveryHistorySummary { invoiceCount: number; recoveredPaise: number; averageRecoveryDays: number; partialPaymentCount: number; fifoAllocationCount: number; }
interface WalletLedgerRow { transactionId: string; clientId: string; clientName: string; clientPhone: string; createdAt: string; transactionType: string; direction: string; creditPaise: number; debitPaise: number; deltaPaise: number; openingBalancePaise: number; closingBalancePaise: number; referenceType: string; referenceId: string; invoiceNumber: string; notes: string; }
interface WalletLedgerSummary { transactionCount: number; clientCount: number; creditPaise: number; debitPaise: number; netMovementPaise: number; openingBalancePaise: number; closingBalancePaise: number; currentLiabilityPaise: number; clientsWithBalance: number; }
interface PaymentCollectionRow { paymentId: string; invoiceId: string; invoiceNumber: string; businessDate: string; clientId: string; clientName: string; clientPhone: string; paymentMethod: string; methodGroup: string; amountPaise: number; methodReference: string; label: string; notes: string; paidAt: string; collectionTiming: string; receivedBy: string; splitPaymentCount: number; splitMethods: string; invoiceTotalPaise: number; invoicePaidPaise: number; invoiceDuePaise: number; }
interface PaymentCollectionSummary { paymentCount: number; invoiceCount: number; totalPaise: number; invoiceTimePaise: number; dueReceiptPaise: number; cashPaise: number; upiPaise: number; cardPaise: number; walletPaise: number; giftCardPaise: number; onlinePaise: number; otherPaise: number; splitInvoiceCount: number; referenceMissingCount: number; receivedByMissingCount: number; }
interface PaymentModesSummary { paymentCount: number; amountPaise: number; invoiceCount: number; }
interface PaymentModeReportRow { method: string; paymentCount: number; amountPaise: number; invoiceCount: number; }
interface StaffServiceDiscountRow { invoiceId: string; invoiceNumber: string; businessDate: string; clientId: string; clientName: string; serviceId: string; serviceName: string; staffId: string; staffName: string; splitPercent: number; quantity: number; grossPaise: number; finalSalePaise: number; manualDiscountPaise: number; couponDiscountPaise: number; membershipDiscountPaise: number; totalDiscountPaise: number; discountBps: number; approvalStatus: string; }
interface StaffServiceDiscountSummary { rowCount: number; staffCount: number; serviceCount: number; quantity: number; grossPaise: number; finalSalePaise: number; manualDiscountPaise: number; couponDiscountPaise: number; membershipDiscountPaise: number; totalDiscountPaise: number; averageDiscountBps: number; pendingApprovalCount: number; approvedCount: number; rejectedCount: number; }
interface ServiceTrendSummary { totalServicesSold: number; totalServiceRevenuePaise: number; averageServicePricePaise: number; topService: string; highestMarginService: string; lowestMarginService: string; discountLeakagePaise: number; serviceGstCollectedPaise: number; }
interface ServiceTrendRow { serviceId: string; serviceName: string; serviceGroup: string; staffName: string; quantitySold: number; grossSalePaise: number; discountPaise: number; netSalePaise: number; gstPaise: number; productCostPaise: number; grossMarginPaise: number; marginBps: number; clientCount: number; repeatClientCount: number; invoiceCount: number; peakSellingHour: string; lastSoldAt: string; }
interface ServiceClientSummary { totalClients: number; totalServiceRevenuePaise: number; totalServiceRows: number; appointmentRows: number; quickSaleRows: number; }
interface ServiceClientRow { soldAt: string; businessDate: string; serviceGroup: string; serviceName: string; clientName: string; clientPhone: string; servicePricePaise: number; saleType: string; staffName: string; invoiceId: string; invoiceNumber: string; }
interface ProductSalesSummary { totalProductsSold: number; totalProductRevenuePaise: number; averageProductPricePaise: number; topProduct: string; discountPaise: number; gstCollectedPaise: number; }
interface ProductSalesRow { productId: string; productName: string; category: string; sku: string; quantitySold: number; netSalePaise: number; discountPaise: number; gstPaise: number; productCostPaise: number; marginBps: number; clientCount: number; invoiceCount: number; lastSoldAt: string; }
interface ProductMovementRow { productId: string; productName: string; category: string; sku: string; currentStock: number; soldQuantity: number; returnedQuantity: number; purchasedQuantity: number; transferOutQuantity: number; transferInQuantity: number; adjustmentQuantity: number; consumedQuantity: number; currentStockValuePaise: number; lastMovementAt?: string; }
interface DetailedInvoiceRow { invoiceId: string; invoiceNumber: string; businessDate: string; clientId: string; clientName: string; clientPhone: string; lineId: string; lineType: string; itemId: string; itemName: string; staffName: string; quantity: number; unitPricePaise: number; grossPaise: number; discountPaise: number; discountType: string; taxablePaise: number; gstPaise: number; cgstPaise: number; sgstPaise: number; igstPaise: number; lineTotalPaise: number; invoiceSubtotalPaise: number; billDiscountPaise: number; couponCode: string; couponDiscountPaise: number; invoiceDiscountPaise: number; invoiceTaxPaise: number; tipPaise: number; roundOffPaise: number; invoiceTotalPaise: number; paidPaise: number; duePaise: number; paymentModes: string; paymentStatus: string; invoiceStatus: string; source: string; }
interface DetailedInvoiceSummary { invoiceCount: number; lineCount: number; grossPaise: number; discountPaise: number; gstPaise: number; paidPaise: number; duePaise: number; walletPaise: number; }
interface BalanceSheetReport { asOfDate: string; branchCount: number; balanced: boolean; totals: { assetsPaise: number; liabilitiesPaise: number; equityPaise: number; accountingEquationDifferencePaise: number }; }
interface WorkingCapitalReport { asOfDate: string; branchCount: number; currentAssetsPaise: number; currentLiabilitiesPaise: number; workingCapitalPaise: number; }

@Component({
    selector: 'app-invoice-reports-page',
    imports: [CommonModule, FormsModule, RouterLink, DatePickerComponent],
    templateUrl: './invoice-reports-page.component.html',
    styleUrls: ['./invoice-reports-page.component.css']
})
export class InvoiceReportsPageComponent implements OnInit {
  activeTab: ReportTab = 'invoice-360';
  detailedRows: DetailedInvoiceRow[] = [];
  detailedSummary: DetailedInvoiceSummary | null = null;
  expandedInvoiceId = '';
  activityRows: InvoiceActivityRow[] = [];
  dueRows: DueRecoveryRow[] = [];
  recoveryRows: DueRecoveryRow[] = [];
  walletRows: WalletLedgerRow[] = [];
  paymentRows: PaymentCollectionRow[] = [];
paymentModeRows: PaymentModeReportRow[] = [];
  paymentModeSummary: PaymentModesSummary = { paymentCount: 0, amountPaise: 0, invoiceCount: 0 };
  staffDiscountRows: StaffServiceDiscountRow[] = [];
  currentUnpaidSummary: CurrentUnpaidSummary = { invoiceCount: 0, originalDuePaise: 0, receivedDuePaise: 0, remainingDuePaise: 0, overdue31Count: 0 };
  recoverySummary: RecoveryHistorySummary = { invoiceCount: 0, recoveredPaise: 0, averageRecoveryDays: 0, partialPaymentCount: 0, fifoAllocationCount: 0 };
  walletSummary: WalletLedgerSummary | null = null;
  paymentSummary: PaymentCollectionSummary | null = null;
  staffDiscountSummary: StaffServiceDiscountSummary | null = null;
  trendRows: ServiceTrendRow[] = [];
  clientRows: ServiceClientRow[] = [];
  productSalesRows: ProductSalesRow[] = [];
  productMovementRows: ProductMovementRow[] = [];
  trendSummary: ServiceTrendSummary | null = null;
  clientSummary: ServiceClientSummary | null = null;
  productSalesSummary: ProductSalesSummary | null = null;
  balanceSheet: BalanceSheetReport | null = null;
  workingCapital: WorkingCapitalReport | null = null;
  clients: FilterOption[] = [];
  staff: FilterOption[] = [];
  services: FilterOption[] = [];
  products: FilterOption[] = [];
  modes: PaymentMode[] = [];
  filters = this.emptyFilters();
  branchName = localStorage.getItem('aurashine_branch_name') ?? localStorage.getItem('selectedBranchName') ?? localStorage.getItem('branchName') ?? 'Current branch';
  loading = false;
  followUpLoadingId = '';
  followUpNotes: Record<string, string> = {};
  recoveryManagers: Record<string, string> = {};
  reminderLoading = false;
  message = '';
  error = '';

  constructor(private readonly api: ApiService, private readonly route: ActivatedRoute) {}

  ngOnInit(): void {
    const report = this.route.snapshot.queryParamMap.get('report');
    this.activeTab = this.consolidatedTab(report);
    this.loadOptions();
    this.load();
  }

  selectTab(tab: ReportTab): void { this.activeTab = tab; this.load(); }

  load(): void {
    this.loading = true;
    this.error = '';
    this.resetReportState();
    const requests = this.sourceTabsForActive().map((tab) => ({ tab, url: `${this.pathFor(tab)}?${this.query(tab)}` }));
    forkJoin(requests.map((request) => this.api.get<any>(request.url))).subscribe({
      next: (responses) => {
        responses.forEach((response, index) => this.assignReport(requests[index].tab, response));
        this.loading = false;
      },
      error: (error: any) => {
        this.error = error?.error?.error?.message ?? error?.error?.message ?? error?.message ?? 'Unable to load report';
        this.loading = false;
      },
    });
  }

  clear(): void { this.filters = this.emptyFilters(); this.load(); }
  toggleInvoice(invoiceId: string): void { this.expandedInvoiceId = this.expandedInvoiceId === invoiceId ? '' : invoiceId; }
  showInvoiceAmounts(index: number, row: DetailedInvoiceRow): boolean { return index === 0 || this.detailedRows[index - 1]?.invoiceId !== row.invoiceId; }
  label(value: string): string { return String(value || '—').replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase()); }
  exportDetailedCsv(): void {
    if (!this.detailedRows.length) return;
    if (Number(this.detailedSummary?.lineCount ?? 0) > this.detailedRows.length) {
      this.error = 'Narrow the filters before export so every matching line is included';
      return;
    }
    const headers = ['Invoice', 'Date', 'Client', 'Phone', 'Type', 'Service / Product', 'Staff split', 'Qty', 'Unit price', 'Original price', 'All discounts', 'Discount source', 'Taxable', 'GST', 'CGST', 'SGST', 'IGST', 'Line total', 'Bill discount', 'Coupon code', 'Coupon discount', 'Invoice total', 'Paid', 'Due', 'Payment mode', 'Status', 'Source'];
    const rows = this.detailedRows.map((row, index) => {
      const invoiceValues = this.showInvoiceAmounts(index, row);
      return [row.invoiceNumber, this.formatDate(row.businessDate), row.clientName, row.clientPhone, this.label(row.lineType), row.itemName, row.staffName, row.quantity, row.unitPricePaise / 100, row.grossPaise / 100, row.discountPaise / 100, this.label(row.discountType), row.taxablePaise / 100, row.gstPaise / 100, row.cgstPaise / 100, row.sgstPaise / 100, row.igstPaise / 100, row.lineTotalPaise / 100, invoiceValues ? row.billDiscountPaise / 100 : '', invoiceValues ? row.couponCode : '', invoiceValues ? row.couponDiscountPaise / 100 : '', invoiceValues ? row.invoiceTotalPaise / 100 : '', invoiceValues ? row.paidPaise / 100 : '', invoiceValues ? row.duePaise / 100 : '', invoiceValues ? row.paymentModes : '', row.paymentStatus, row.source];
    });
    const csv = [headers, ...rows].map((row) => row.map((value) => `"${String(value).replaceAll('"', '""')}"`).join(',')).join('\r\n');
    const url = URL.createObjectURL(new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `detailed-invoice-register-${this.filters.dateFrom || 'all'}-${this.filters.dateTo || 'all'}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  }
  exportDetailedPdf(): void {
    if (!this.detailedRows.length) return;
    if (Number(this.detailedSummary?.lineCount ?? 0) > this.detailedRows.length) {
      this.error = 'Narrow the filters before export so every matching line is included';
      return;
    }
    window.print();
  }
  exportCurrentUnpaidCsv(): void {
    if (!this.dueRows.length) return;
    const headers = ['Invoice', 'Date', 'Client', 'Phone', 'Services', 'Staff', 'Original due', 'Received due', 'Remaining due', 'Aging bucket', 'Aging days', 'Last payment', 'Follow-ups', 'Recovery manager', 'Last follow-up'];
    const rows = this.dueRows.map((row) => [row.invoiceNumber, this.formatDate(row.businessDate), row.clientName, row.clientPhone, row.serviceNames, row.staffNames, row.originalDuePaise / 100, row.receivedDuePaise / 100, row.balancePaise / 100, row.ageingBucket, row.ageingDays, row.lastPaymentAt ? this.formatDate(row.lastPaymentAt) : '', row.followUpCount, row.recoveryManagerName, row.lastFollowUpAt ? this.formatDate(row.lastFollowUpAt) : '']);
    const csv = [headers, ...rows].map((row) => row.map((value) => `"${String(value).replaceAll('"', '""')}"`).join(',')).join('\r\n');
    const url = URL.createObjectURL(new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `current-unpaid-${this.filters.dateFrom || 'all'}-${this.filters.dateTo || 'all'}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  }
  exportCurrentUnpaidPdf(): void { if (this.dueRows.length) window.print(); }
  exportRecoveryHistoryCsv(): void {
    if (!this.recoveryRows.length) return;
    const headers = ['Invoice', 'Invoice date', 'Client', 'Phone', 'Services', 'Staff', 'Lifecycle status', 'Original due', 'Recovered', 'Unpaid at', 'Paid at', 'Recovery days', 'Payment modes', 'References', 'Received by', 'Partial payments', 'FIFO allocations'];
    const rows = this.recoveryRows.map((row) => [row.invoiceNumber, this.formatDate(row.businessDate), row.clientName, row.clientPhone, row.serviceNames, row.staffNames, row.recovered ? 'Unpaid to paid' : 'Unpaid', row.originalDuePaise / 100, row.receivedDuePaise / 100, this.formatDateTime(row.unpaidAt), row.fullPaidAt ? this.formatDateTime(row.fullPaidAt) : '', row.recoveryDays ?? '', row.paymentModes, row.paymentReferences, row.receivedBy, (row.recoveryPaymentHistory || []).map((payment) => `${this.formatDateTime(payment.paidAt)} ${payment.paymentMode} ${payment.amountPaise / 100}`).join(' | '), (row.fifoAllocations || []).map((allocation) => `${allocation.receivedPaise / 100} (${allocation.balanceBeforePaise / 100}->${allocation.balanceAfterPaise / 100})`).join(' | ')]);
    const csv = [headers, ...rows].map((row) => row.map((value) => `"${String(value).replaceAll('"', '""')}"`).join(',')).join('\r\n');
    const url = URL.createObjectURL(new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `recovery-history-${this.filters.dateFrom || 'all'}-${this.filters.dateTo || 'all'}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  }
  exportRecoveryHistoryPdf(): void { if (this.recoveryRows.length) window.print(); }
  exportWalletLedgerCsv(): void {
    if (!this.walletRows.length) return;
    const headers = ['Date', 'Client', 'Phone', 'Type', 'Credit', 'Debit', 'Opening balance', 'Closing balance', 'Reference type', 'Invoice / reference', 'Notes'];
    const rows = this.walletRows.map((row) => [this.formatDate(row.createdAt), row.clientName, row.clientPhone, this.label(row.transactionType), row.creditPaise / 100, row.debitPaise / 100, row.openingBalancePaise / 100, row.closingBalancePaise / 100, this.label(row.referenceType), row.invoiceNumber || row.referenceId, row.notes]);
    const csv = [headers, ...rows].map((row) => row.map((value) => `"${String(value).replaceAll('"', '""')}"`).join(',')).join('\r\n');
    const url = URL.createObjectURL(new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `wallet-ledger-${this.filters.dateFrom || 'all'}-${this.filters.dateTo || 'all'}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  }
  exportWalletLedgerPdf(): void { if (this.walletRows.length) window.print(); }
  exportPaymentCollectionCsv(): void {
    if (!this.paymentRows.length) return;
    const headers = ['Paid date', 'Invoice', 'Invoice date', 'Client', 'Phone', 'Mode', 'Group', 'Amount', 'Collection timing', 'Split count', 'Split modes', 'Reference', 'Received by', 'Invoice total', 'Invoice paid', 'Invoice due', 'Notes'];
    const rows = this.paymentRows.map((row) => [this.formatDate(row.paidAt), row.invoiceNumber, this.formatDate(row.businessDate), row.clientName, row.clientPhone, this.label(row.paymentMethod), this.label(row.methodGroup), row.amountPaise / 100, this.label(row.collectionTiming), row.splitPaymentCount, row.splitMethods, row.methodReference, row.receivedBy, row.invoiceTotalPaise / 100, row.invoicePaidPaise / 100, row.invoiceDuePaise / 100, row.notes]);
    const csv = [headers, ...rows].map((row) => row.map((value) => `"${String(value).replaceAll('"', '""')}"`).join(',')).join('\r\n');
    const url = URL.createObjectURL(new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `payment-collection-${this.filters.dateFrom || 'all'}-${this.filters.dateTo || 'all'}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  }
  exportPaymentCollectionPdf(): void { if (this.paymentRows.length) window.print(); }
  exportPaymentModesCsv(): void {
    if (!this.paymentModeRows.length) return;
    const headers = ['Payment method', 'Payments', 'Amount', 'Invoices'];
    const rows = this.paymentModeRows.map((row) => [row.method, row.paymentCount, row.amountPaise / 100, row.invoiceCount]);
    const csv = [headers, ...rows].map((row) => row.map((value) => `"${String(value).replaceAll('"', '""')}"`).join(',')).join('\r\n');
    const url = URL.createObjectURL(new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `payment-modes-${this.filters.dateFrom || 'all'}-${this.filters.dateTo || 'all'}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  }
  exportPaymentModesPdf(): void { if (this.paymentModeRows.length) window.print(); }
  exportStaffServiceDiscountCsv(): void {
    if (!this.staffDiscountRows.length) return;
    const headers = ['Invoice', 'Date', 'Client', 'Staff', 'Service', 'Split %', 'Quantity', 'Gross', 'Final sale', 'Manual discount', 'Coupon discount', 'Membership discount', 'Total discount', 'Discount %', 'Approval status'];
    const rows = this.staffDiscountRows.map((row) => [row.invoiceNumber, this.formatDate(row.businessDate), row.clientName, row.staffName, row.serviceName, row.splitPercent, row.quantity, row.grossPaise / 100, row.finalSalePaise / 100, row.manualDiscountPaise / 100, row.couponDiscountPaise / 100, row.membershipDiscountPaise / 100, row.totalDiscountPaise / 100, row.discountBps / 100, row.approvalStatus]);
    const csv = [headers, ...rows].map((row) => row.map((value) => `"${String(value).replaceAll('"', '""')}"`).join(',')).join('\r\n');
    const url = URL.createObjectURL(new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `staff-service-discount-${this.filters.dateFrom || 'all'}-${this.filters.dateTo || 'all'}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  }
  exportStaffServiceDiscountPdf(): void { if (this.staffDiscountRows.length) window.print(); }
  recordFollowUp(row: DueRecoveryRow, action: 'follow_up' | 'call_done' | 'assign_manager'): void {
    const note = (this.followUpNotes[row.invoiceId] ?? '').trim();
    if (action === 'follow_up' && !note) { this.error = 'Follow-up note is required'; return; }
    const assignedManagerId = this.recoveryManagers[row.invoiceId] ?? row.recoveryManagerId ?? '';
    if (action === 'assign_manager' && !assignedManagerId) { this.error = 'Recovery manager is required'; return; }
    this.followUpLoadingId = row.invoiceId;
    this.error = '';
    const actionNote = action === 'call_done' ? 'Call completed' : action === 'assign_manager' ? 'Recovery manager assigned' : note;
    const payload = action === 'assign_manager' ? { action, note: actionNote, assignedManagerId } : { action, note: actionNote };
    this.api.post(`/api/v1/reports/invoices/${row.invoiceId}/follow-ups`, payload).subscribe({
      next: () => { this.followUpLoadingId = ''; delete this.followUpNotes[row.invoiceId]; delete this.recoveryManagers[row.invoiceId]; this.message = 'Follow-up saved'; this.load(); },
      error: (error: any) => { this.followUpLoadingId = ''; this.error = error?.error?.error?.message ?? error?.error?.message ?? error?.message ?? 'Unable to save follow-up'; },
    });
  }

  queueDueReminders(): void {
    this.reminderLoading = true;
    this.error = '';
    this.api.post<any>('/api/v1/pos/invoice-outbox/schedule-due-reminders', {}).subscribe({
      next: (response) => { this.reminderLoading = false; this.message = `${Number(this.data(response).queued ?? 0)} due reminder(s) queued`; this.load(); },
      error: (error: any) => { this.reminderLoading = false; this.error = error?.error?.error?.message ?? error?.error?.message ?? error?.message ?? 'Unable to queue due reminders'; },
    });
  }
  formatDate(value: string): string { const date = value.slice(0, 10).split('-'); return date.length === 3 ? `${date[2]}/${date[1]}/${date[0]}` : '-'; }
  formatDateTime(value: string): string { const date = new Date(value); return Number.isNaN(date.getTime()) ? '—' : new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(date).replace(',', ''); }
  percent(bps: number): string { return `${(Number(bps || 0) / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 })}%`; }

  private loadOptions(): void {
    this.api.get<any>('/api/clients').subscribe({ next: (res) => this.clients = this.list(res).map((item) => ({ id: String(item.id), name: this.name(item) })) });
    this.api.get<any>('/api/staff').subscribe({ next: (res) => this.staff = this.list(res).map((item) => ({ id: String(item.id), name: this.name(item) })) });
    this.api.get<any>('/api/services?pageSize=500').subscribe({ next: (res) => this.services = this.list(res).map((item) => ({ id: String(item.id), name: String(item.name) })) });
    this.api.get<any>('/api/v1/products?pageSize=500').subscribe({ next: (res) => this.products = this.list(res).map((item) => ({ id: String(item.id), name: String(item.name) })) });
    this.api.get<any>('/api/pos/payment-methods').subscribe({ next: (res) => this.modes = this.list(res).map((item) => ({ code: String(item.code ?? item.id), name: String(item.name ?? item.label) })) });
  }

  private emptyFilters() { return { clientId: '', staffId: '', serviceId: '', productId: '', paymentMethod: '', status: '', recovery: '', ageingDays: null as number | null, ageingBucket: '', transactionType: '', collectionTiming: '', followUp: false, dateFrom: '', dateTo: '', q: '' }; }
  private consolidatedTab(report: string | null): ReportTab {
    if (report === 'detailed-invoice' || report === 'due-recovery' || report === 'recovery-history' || report === 'wallet-ledger' || report === 'payment-collection' || report === 'staff-service-discount' || report === 'payment-modes') return report;
    if (report === 'service-trends' || report === 'service-clients') return 'staff-service-360';
    if (report === 'product-sales' || report === 'product-movements') return 'finance-control';
    return 'invoice-360';
  }

  private sourceTabsForActive(): SourceReportTab[] {
    if (this.activeTab === 'detailed-invoice') return ['detailed-invoice'];
    if (this.activeTab === 'due-recovery') return ['due-recovery'];
    if (this.activeTab === 'recovery-history') return ['recovery-history'];
    if (this.activeTab === 'wallet-ledger') return ['wallet-ledger'];
    if (this.activeTab === 'payment-collection') return ['payment-collection'];
    if (this.activeTab === 'staff-service-discount') return ['staff-service-discount'];
    if (this.activeTab === 'payment-modes') return ['payment-modes'];
    if (this.activeTab === 'receivable-recovery') return ['due-recovery', 'recovery-history'];
    if (this.activeTab === 'payment-wallet') return ['payment-collection', 'wallet-ledger'];
    if (this.activeTab === 'staff-service-360') return ['staff-service-discount', 'service-trends', 'service-clients'];
    if (this.activeTab === 'finance-control') return ['product-sales', 'product-movements', 'balance-sheet', 'working-capital'];
    return ['detailed-invoice', 'invoice-activity'];
  }

  private pathFor(tab: SourceReportTab): string {
    if (tab === 'detailed-invoice') return '/api/v1/reports/invoices/detailed';
        if (tab === 'invoice-activity') return '/api/v1/reports/invoice-activity';
    if (tab === 'due-recovery' || tab === 'recovery-history') return '/api/v1/reports/due-recovery';
    if (tab === 'wallet-ledger') return '/api/v1/reports/wallet-ledger';
    if (tab === 'payment-collection') return '/api/v1/reports/payment-collection';
    if (tab === 'staff-service-discount') return '/api/v1/reports/invoices/staff-service-discount';
    if (tab === 'payment-modes') return '/api/v1/reports/payment-modes';
    if (tab === 'service-trends') return '/api/v1/reports/invoices/service-trends';
    if (tab === 'service-clients') return '/api/v1/reports/invoices/service-clients';
    if (tab === 'product-sales') return '/api/v1/reports/products/sales';
    if (tab === 'product-movements') return '/api/v1/reports/products/movements';
    if (tab === 'balance-sheet') return '/balance-sheet/live';
    return '/balance-sheet/working-capital';
  }

  private query(tab: SourceReportTab): string {
    if (tab === 'balance-sheet' || tab === 'working-capital') {
      return new URLSearchParams({ asOfDate: this.filters.dateTo || this.today() }).toString();
    }
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(this.filters)) {
      if (value === '' || value === null || value === false) continue;
      if (key === 'serviceId' && !['detailed-invoice', 'staff-service-discount', 'service-trends', 'service-clients'].includes(tab)) continue;
      if (key === 'productId' && tab !== 'detailed-invoice' && tab !== 'product-sales' && tab !== 'product-movements') continue;
      if (key === 'staffId' && !['detailed-invoice', 'due-recovery', 'recovery-history', 'staff-service-discount', 'service-trends', 'service-clients'].includes(tab)) continue;
      if (key === 'status' && !['detailed-invoice'].includes(tab)) continue;
      if (!['due-recovery', 'recovery-history'].includes(tab) && key === 'recovery') continue;
      if (!['due-recovery', 'recovery-history'].includes(tab) && key === 'ageingDays') continue;
      if (key === 'paymentMethod' && !['detailed-invoice', 'recovery-history', 'payment-collection', 'payment-modes'].includes(tab)) continue;
      if (key === 'ageingBucket' && !['due-recovery', 'recovery-history'].includes(tab)) continue;
      if (key === 'transactionType' && tab !== 'wallet-ledger') continue;
      if (key === 'collectionTiming' && tab !== 'payment-collection') continue;
      params.set(['invoice-activity', 'due-recovery', 'recovery-history'].includes(tab) && key === 'dateFrom' ? 'startDate' : ['invoice-activity', 'due-recovery', 'recovery-history'].includes(tab) && key === 'dateTo' ? 'endDate' : key, String(value));
    }
    if (tab === 'detailed-invoice') params.set('limit', '5000');
    if (tab === 'due-recovery') params.set('recovery', 'due');
    if (tab === 'recovery-history') params.set('recovery', 'recovered');
    return params.toString();
  }

  private assignReport(tab: SourceReportTab, response: any): void {
    if (tab === 'detailed-invoice') {
      const data = this.data(response);
      this.detailedSummary = data.summary ?? null;
      this.detailedRows = Array.isArray(data.rows) ? data.rows : [];
    }
        if (tab === 'invoice-activity') this.activityRows = this.list(response);
    if (tab === 'due-recovery') {
      this.dueRows = this.list(response);
      this.currentUnpaidSummary = this.dueRows.reduce((summary, row) => ({
        invoiceCount: summary.invoiceCount + 1,
        originalDuePaise: summary.originalDuePaise + Number(row.originalDuePaise || 0),
        receivedDuePaise: summary.receivedDuePaise + Number(row.receivedDuePaise || 0),
        remainingDuePaise: summary.remainingDuePaise + Number(row.balancePaise || 0),
        overdue31Count: summary.overdue31Count + (row.ageingDays > 30 ? 1 : 0),
      }), { invoiceCount: 0, originalDuePaise: 0, receivedDuePaise: 0, remainingDuePaise: 0, overdue31Count: 0 });
    }
    if (tab === 'recovery-history') {
      this.recoveryRows = this.list(response);
      const totalDays = this.recoveryRows.reduce((sum, row) => sum + Number(row.recoveryDays || 0), 0);
      this.recoverySummary = this.recoveryRows.reduce((summary, row) => ({
        invoiceCount: summary.invoiceCount + 1,
        recoveredPaise: summary.recoveredPaise + Number(row.receivedDuePaise || 0),
        averageRecoveryDays: 0,
        partialPaymentCount: summary.partialPaymentCount + Number(row.recoveryPaymentHistory?.length || 0),
        fifoAllocationCount: summary.fifoAllocationCount + Number(row.fifoAllocations?.length || 0),
      }), { invoiceCount: 0, recoveredPaise: 0, averageRecoveryDays: 0, partialPaymentCount: 0, fifoAllocationCount: 0 });
      this.recoverySummary.averageRecoveryDays = this.recoveryRows.length ? Math.round(totalDays / this.recoveryRows.length) : 0;
    }
    if (tab === 'wallet-ledger') {
      const data = this.data(response);
      this.walletSummary = data.summary ?? null;
      this.walletRows = Array.isArray(data.rows) ? data.rows : [];
    }
    if (tab === 'payment-collection') {
      const data = this.data(response);
      this.paymentSummary = data.summary ?? null;
      this.paymentRows = Array.isArray(data.rows) ? data.rows : [];
    }
    if (tab === 'payment-modes') {
      this.paymentModeRows = this.list(response) as PaymentModeReportRow[];
      this.paymentModeSummary = this.paymentModeRows.reduce((summary, row) => ({
        paymentCount: summary.paymentCount + Number(row.paymentCount || 0),
        amountPaise: summary.amountPaise + Number(row.amountPaise || 0),
        invoiceCount: summary.invoiceCount + Number(row.invoiceCount || 0),
      }), { paymentCount: 0, amountPaise: 0, invoiceCount: 0 });
    }
    if (tab === 'staff-service-discount') {
      const data = this.data(response);
      this.staffDiscountSummary = data.summary ?? null;
      this.staffDiscountRows = Array.isArray(data.rows) ? data.rows : [];
    }
    if (tab === 'service-trends') {
      const data = this.data(response);
      this.trendSummary = data.summary ?? null;
      this.trendRows = Array.isArray(data.rows) ? data.rows : [];
    }
    if (tab === 'service-clients') {
      const data = this.data(response);
      this.clientSummary = data.summary ?? null;
      this.clientRows = Array.isArray(data.rows) ? data.rows : [];
    }
    if (tab === 'product-sales') {
      const data = this.data(response);
      this.productSalesSummary = data.summary ?? null;
      this.productSalesRows = Array.isArray(data.rows) ? data.rows : [];
    }
    if (tab === 'product-movements') this.productMovementRows = this.list(response);
    if (tab === 'balance-sheet') this.balanceSheet = this.data(response) as BalanceSheetReport;
    if (tab === 'working-capital') this.workingCapital = this.data(response) as WorkingCapitalReport;
  }

  private resetReportState(): void {
    this.detailedRows = [];
    this.detailedSummary = null;
    this.activityRows = [];
    this.dueRows = [];
    this.recoveryRows = [];
    this.walletRows = [];
    this.paymentRows = [];
    this.paymentModeRows = [];
    this.paymentModeSummary = { paymentCount: 0, amountPaise: 0, invoiceCount: 0 };
    this.staffDiscountRows = [];
    this.trendRows = [];
    this.clientRows = [];
    this.productSalesRows = [];
    this.productMovementRows = [];
    this.currentUnpaidSummary = { invoiceCount: 0, originalDuePaise: 0, receivedDuePaise: 0, remainingDuePaise: 0, overdue31Count: 0 };
    this.recoverySummary = { invoiceCount: 0, recoveredPaise: 0, averageRecoveryDays: 0, partialPaymentCount: 0, fifoAllocationCount: 0 };
    this.walletSummary = null;
    this.paymentSummary = null;
    this.staffDiscountSummary = null;
    this.trendSummary = null;
    this.clientSummary = null;
    this.productSalesSummary = null;
    this.balanceSheet = null;
    this.workingCapital = null;
  }

  private today(): string { return new Date().toISOString().slice(0, 10); }
  private data(response: any): any { return response?.data ?? response ?? {}; }
  private list(response: any): any[] { const data = this.data(response); return Array.isArray(data) ? data : Array.isArray(data.rows) ? data.rows : []; }
  private name(item: any): string { return String(item.name ?? item.fullName ?? [item.firstName ?? item.first_name, item.lastName ?? item.last_name].filter(Boolean).join(' ') ?? item.id); }
}




