import { CommonModule } from '@angular/common';
import { Component, OnDestroy, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { ApiService } from '../../../shared/services/api.service';
import { PosRealtimeService } from '../../../core/services/pos-realtime.service';
import { AuthService } from '../../../core/services/auth.service';
import { downloadInvoiceDocument, printInvoiceDocument } from '../../../shared/utils/safe-invoice-print';
import { Subscription } from 'rxjs';

interface InvoiceRow {
  id: string;
  invoiceNumber: string;
  clientId: string;
  clientName: string;
  clientPhone: string;
  staffId: string;
  staffName: string;
  businessDate: string;
  status: string;
  paymentMode: string;
  totalPaise: number;
  paidPaise: number;
  balancePaise: number;
  receivedDuePaise: number;
  walletPaise: number;
  finalizedAt: string;
  createdAt: string;
  lastPaymentAt: string;
}

type InvoiceKpiFilter = 'received-due' | 'due' | 'wallet';

interface InvoiceTotals {
  totalRows: number;
  totalPaise: number;
  paidPaise: number;
  receivedDuePaise: number;
  balancePaise: number;
  walletPaise: number;
}

interface InvoiceAction { id: string; action: string; recipient: string; createdAt: string; }
interface InvoicePayment { id: string; method: string; label: string; amountPaise: number; reference: string; paidAt: string; }
interface RefundTill { id: string; tillCode: string; tillName: string; status: string; }
interface InvoiceDelivery { id: string; channel: string; recipient: string; status: string; attempts: number; lastError: string; deliveredAt: string | null; createdAt: string; }
interface LedgerVerification { valid: boolean; events: number; headHash: string; failedAt: number | null; }
interface PaymentLink { id: string; provider: string; amountPaise: number; status: string; url: string; expiresAt?: string; }
interface PaymentReconciliation { paymentLinkId: string; providerStatus: string; providerAmountPaidPaise: number; requiresSignedWebhook: boolean; }
interface PaymentInstrument { id: string; provider: string; methodType: string; brand: string; last4: string; recurringEnabled: boolean; status: string; }
interface PaymentDispute { id: string; provider: string; providerDisputeId: string; amountPaise: number; currency: string; reason: string; status: string; evidenceDueAt?: string; openedAt: string; }
interface PaymentMode { code: string; label: string; referenceRequired: boolean; }
interface PendingPayment extends PaymentMode { amountPaise: number; reference: string; idempotencyKey: string; }
interface InvoiceDeleteRequest { id: string; saleId: string; invoiceNumber: string; reason: string; status: string; requestedByUserId: string; decidedByUserId: string; decisionNote: string; requestedAt: string; decidedAt?: string; appliedAt?: string; }
interface InvoiceCorrectionRequest { id: string; saleId: string; invoiceNumber: string; reason: string; status: string; requestedByUserId: string; decidedByUserId: string; decisionNote: string; requestedAt: string; decidedAt?: string; appliedAt?: string; }

interface InvoiceLine {
  id: string;
  lineType: string;
  itemName: string;
  quantity: number;
  lineTotalPaise: number;
  staffId?: string;
  unitPricePaise?: number;
  discountType?: string;
  discountValuePaise?: number;
  discountBps?: number;
  grossPaise?: number;
  taxablePaise?: number;
  discountPaise?: number;
  taxPercent?: number;
  gstPaise?: number;
  hsnSacCode?: string;
  cgstPaise?: number;
  sgstPaise?: number;
  igstPaise?: number;
}

interface InvoiceDetail {
  subtotalPaise: number;
  billDiscountPaise: number;
  couponCode: string;
  couponDiscountPaise: number;
  discountPaise: number;
  taxPaise: number;
  tipPaise: number;
  roundOffPaise: number;
  totalPaise: number;
  paidPaise: number;
  balanceDuePaise: number;
  invoiceType: string;
  source: string;
  referenceId: string;
  packageRedemptions: any[];
}

interface InvoiceCorrectionLine extends InvoiceLine {
  editedUnitPrice: string;
  editedDiscountType: 'none' | 'amount' | 'percent';
  editedDiscountValue: string;
}

interface InvoiceClientKpi {
  membershipName: string;
  membershipExpiresAt?: string;
  membershipCredits: Array<{ id: string; membershipName: string; serviceName: string; pendingQty: number }>;
  packageCredits: Array<{ id: string; packageName: string; serviceName: string; pendingQty: number }>;
}

interface ReturnLine extends InvoiceLine {
  returnQuantity: number | null;
  restockQuantity: number | null;
  discardQuantity: number | null;
}

@Component({
    selector: 'app-pos-invoices-page',
    imports: [CommonModule, FormsModule, RouterLink],
    templateUrl: './pos-invoices-page.component.html',
    styleUrls: ['./pos-invoices-page.component.css']
})
export class PosInvoicesPageComponent implements OnInit, OnDestroy {
  invoices: InvoiceRow[] = [];
  totals: InvoiceTotals = this.emptyTotals();
  selected: InvoiceRow | null = null;
  history: InvoiceAction[] = [];
  paymentTimeline: InvoicePayment[] = [];
  invoiceLines: InvoiceLine[] = [];
  invoiceDetail: InvoiceDetail | null = null;
  clientKpi: InvoiceClientKpi | null = null;
  detailsLoading = false;
  fullView = false;
  activeDetailTab: 'overview' | 'items' | 'payments' | 'activity' = 'overview';
  returnLines: ReturnLine[] = [];
  recipient = '';
  deliveryChannel: 'email' | 'sms' | 'whatsapp' = 'email';
  deliveries: InvoiceDelivery[] = [];
  reminderLoading = false;
  returnDrawerOpen = false;
  returnReason = '';
  returnMfaCode = '';
  returnEvidenceReference = '';
  refundMethod = '';
  refundMethods: string[] = [];
  refundTills: RefundTill[] = [];
  refundTillId = '';
  returnIdempotencyKey = '';
  returnLoading = false;
  voidDrawerOpen = false;
  voidReason = '';
  voidIdempotencyKey = '';
  voidLoading = false;
  deleteRequest: InvoiceDeleteRequest | null = null;
  deleteDrawerOpen = false;
  deleteReason = '';
  deleteDecisionNote = '';
  deleteLoading = false;
  deleteDecisionLoading = false;
  correctionRequest: InvoiceCorrectionRequest | null = null;
  correctionDrawerOpen = false;
  correctionReason = '';
  correctionLines: InvoiceCorrectionLine[] = [];
  correctionDecisionNote = '';
  correctionLoading = false;
  correctionDecisionLoading = false;
  creditNoteDrawerOpen = false;
  creditNoteReason = '';
  creditNoteNotes = '';
  creditNoteAmount = '';
  creditNoteIdempotencyKey = '';
  creditNoteLoading = false;
  ledgerVerification: LedgerVerification | null = null;
  ledgerLoading = false;
  paymentLinks: PaymentLink[] = [];
  paymentLinkDrawerOpen = false;
  paymentLinkAmount = '';
  paymentLinkProvider = 'razorpay';
  paymentLinkIdempotencyKey = '';
  paymentLinkLoading = false;
  reconcilingPaymentLinkId = '';
  paymentReconciliation: PaymentReconciliation | null = null;
  paymentInstruments: PaymentInstrument[] = [];
  paymentDisputes: PaymentDispute[] = [];
  revokingInstrumentId = '';
  paymentMethods: PaymentMode[] = [];
  receivePaymentDrawerOpen = false;
  receivePaymentInputs: Record<string, string> = {};
  receivePaymentReferences: Record<string, string> = {};
  receivePaymentIdempotencyKeys: Record<string, string> = {};
  receivePaymentNotes = '';
  receivePaymentLoading = false;
  paymentMethodsLoading = false;
  activeKpiFilter: InvoiceKpiFilter | null = null;
  searchText = '';
  statusFilter = '';
  paymentMethodFilter = '';
  error = '';
  message = '';
  private liveUpdates?: Subscription;

  constructor(
    private readonly api: ApiService,
    private readonly realtime: PosRealtimeService,
    private readonly route: ActivatedRoute,
    private readonly router: Router,
    private readonly auth: AuthService,
  ) {}
  ngOnInit(): void {
    const invoiceId = this.route.snapshot.queryParamMap.get('invoiceId')?.trim();
    this.fullView = this.route.snapshot.queryParamMap.get('view') === 'full';
    this.loadPaymentMethods();
    this.load(invoiceId ? () => this.selectInvoiceById(invoiceId) : undefined);
    this.liveUpdates = this.realtime.events().subscribe((event) => {
      if (event.entityType === 'invoice') this.load();
    });
  }

  private selectInvoiceById(invoiceId: string): void {
    const listed = this.invoices.find((invoice) => invoice.id === invoiceId);
    if (listed) { this.select(listed); return; }
    this.api.get<any>(`/api/v1/pos/invoices/${invoiceId}`).subscribe({
      next: (response) => {
        const data = response?.data ?? response;
        const invoice = this.invoice(data?.invoice ?? data?.sale ?? data);
        if (!invoice.id) { this.error = 'Invoice was not found'; return; }
        this.invoices = [invoice, ...this.invoices];
        this.select(invoice);
      },
      error: (error: any) => this.error = this.messageFor(error),
    });
  }
  ngOnDestroy(): void { this.liveUpdates?.unsubscribe(); }

  load(afterLoad?: () => void): void {
    this.error = '';
    this.api.get<any>(`/api/v1/pos/sales-register?${this.registerQuery()}`).subscribe({
      next: (res) => {
        const data = res?.data ?? res;
        this.invoices = this.rows(data?.rows ?? data).map((row) => this.invoice(row));
        this.totals = this.normalizeTotals(data?.totals ?? {}, this.invoices);
        if (this.selected) this.selected = this.invoices.find((row) => row.id === this.selected?.id) ?? this.selected;
        afterLoad?.();
      },
      error: (err: any) => this.error = this.messageFor(err),
    });
  }

  applyFilters(): void {
    this.selected = null;
    this.load();
  }

  resetFilters(): void {
    this.searchText = '';
    this.statusFilter = '';
    this.paymentMethodFilter = '';
    this.activeKpiFilter = null;
    this.applyFilters();
  }

  get visibleInvoices(): InvoiceRow[] {
    if (this.activeKpiFilter === 'received-due') return this.invoices.filter((invoice) => invoice.receivedDuePaise > 0);
    if (this.activeKpiFilter === 'due') return this.invoices.filter((invoice) => invoice.balancePaise > 0);
    if (this.activeKpiFilter === 'wallet') return this.invoices.filter((invoice) => invoice.walletPaise > 0);
    return this.invoices;
  }

  toggleKpiFilter(filter: InvoiceKpiFilter): void {
    this.activeKpiFilter = this.activeKpiFilter === filter ? null : filter;
    if (this.selected && !this.visibleInvoices.some((invoice) => invoice.id === this.selected?.id)) {
      this.selected = null;
      this.closeReturnDrawer();
      this.closeVoidDrawer();
      this.closeDeleteDrawer();
      this.closeCorrectionDrawer();
      this.closeCreditNoteDrawer();
      this.closeReceivePaymentDrawer();
      this.closePaymentLinkDrawer();
    }
  }

  closeDetails(): void {
    this.selected = null;
    this.fullView = false;
    this.activeDetailTab = 'overview';
    this.invoiceDetail = null;
    this.invoiceLines = [];
    this.paymentTimeline = [];
    this.history = [];
    this.deliveries = [];
    this.clientKpi = null;
    this.closeReturnDrawer();
    this.closeVoidDrawer();
    this.closeDeleteDrawer();
    this.closeCorrectionDrawer();
    this.closeCreditNoteDrawer();
    this.closeReceivePaymentDrawer();
    this.closePaymentLinkDrawer();
    void this.router.navigate([], { relativeTo: this.route, queryParams: { invoiceId: null, view: null }, queryParamsHandling: 'merge', replaceUrl: true });
  }

  openFullView(): void {
    if (!this.selected) return;
    this.fullView = true;
    this.activeDetailTab = 'overview';
    void this.router.navigate([], { relativeTo: this.route, queryParams: { invoiceId: this.selected.id, view: 'full' }, queryParamsHandling: 'merge', replaceUrl: true });
  }

  exitFullView(): void {
    this.fullView = false;
    void this.router.navigate([], { relativeTo: this.route, queryParams: { view: null }, queryParamsHandling: 'merge', replaceUrl: true });
  }

  paidColumnLabel(): string {
    if (this.activeKpiFilter === 'received-due') return 'Received due';
    if (this.activeKpiFilter === 'wallet') return 'Wallet used';
    return 'Paid';
  }

  displayedPaidPaise(invoice: InvoiceRow): number {
    if (this.activeKpiFilter === 'received-due') return invoice.receivedDuePaise;
    if (this.activeKpiFilter === 'wallet') return invoice.walletPaise;
    return invoice.paidPaise;
  }

  select(invoice: InvoiceRow): void {
    this.selected = invoice;
    this.activeDetailTab = 'overview';
    this.recipient = invoice.clientPhone || '';
    this.history = [];
    this.paymentTimeline = [];
    this.deliveries = [];
    this.invoiceLines = [];
    this.invoiceDetail = null;
    this.clientKpi = null;
    this.detailsLoading = true;
    this.closeReturnDrawer();
    this.closeVoidDrawer();
    this.closeDeleteDrawer();
    this.closeCorrectionDrawer();
    this.closeCreditNoteDrawer();
    this.closeReceivePaymentDrawer();
    this.ledgerVerification = null;
    this.paymentLinks = [];
    this.paymentInstruments = [];
    this.paymentDisputes = [];
    this.paymentReconciliation = null;
    this.deleteRequest = null;
    this.deleteDecisionNote = '';
    if (this.canAccessDeleteRequests()) this.loadDeleteRequest(invoice.id);
    this.correctionRequest = null;
    this.correctionDecisionNote = '';
    if (this.canAccessCorrectionRequests()) this.loadCorrectionRequests(invoice.id);
    this.loadPaymentLinks(invoice.id);
    this.loadPaymentCompliance(invoice.id);
    this.loadDeliveries(invoice.id);
    this.api.get<any>(`/api/v1/pos/invoices/${invoice.id}`).subscribe({
      next: (res) => {
        const data = res?.data ?? res;
        const detail = data?.invoice ?? data?.sale ?? {};
        this.invoiceDetail = {
          subtotalPaise: this.firstMoney(detail, ['subtotalPaise', 'subtotal_paise']),
          billDiscountPaise: this.firstMoney(detail, ['billDiscountPaise', 'bill_discount_paise']),
          couponCode: String(detail.couponCode ?? detail.coupon_code ?? ''),
          couponDiscountPaise: this.firstMoney(detail, ['couponDiscountPaise', 'coupon_discount_paise']),
          discountPaise: this.firstMoney(detail, ['discountPaise', 'discount_paise']),
          taxPaise: this.firstMoney(detail, ['taxPaise', 'tax_paise']),
          tipPaise: this.firstMoney(detail, ['tipPaise', 'tip_paise']),
          roundOffPaise: this.firstMoney(detail, ['roundOffPaise', 'round_off_paise']),
          totalPaise: this.firstMoney(detail, ['totalPaise', 'total_paise']),
          paidPaise: this.firstMoney(detail, ['paidPaise', 'paid_paise']),
          balanceDuePaise: this.firstMoney(detail, ['balanceDuePaise', 'balance_due_paise']),
          invoiceType: String(detail.invoiceType ?? detail.invoice_type ?? ''),
          source: String(detail.source ?? ''),
          referenceId: String(detail.referenceId ?? detail.reference_id ?? ''),
          packageRedemptions: this.rows(detail.packageRedemptions ?? detail.package_redemptions),
        };
        this.invoiceLines = this.rows(data?.lines).map((line) => ({
          id: String(line.id ?? ''), lineType: String(line.lineType ?? line.line_type ?? ''), itemName: String(line.itemName ?? line.item_name ?? ''),
          quantity: this.firstNumber(line, ['quantity']), lineTotalPaise: this.firstMoney(line, ['lineTotalPaise', 'line_total_paise']), staffId: String(line.staffId ?? line.staff_id ?? ''),
          unitPricePaise: this.firstMoney(line, ['unitPricePaise', 'unit_price_paise']), discountType: String(line.discountType ?? line.discount_type ?? 'none'),
          discountValuePaise: this.firstMoney(line, ['discountValuePaise', 'discount_value_paise']), discountBps: this.firstNumber(line, ['discountBps', 'discount_bps']),
          grossPaise: this.firstMoney(line, ['grossPaise', 'gross_paise']), taxablePaise: this.firstMoney(line, ['taxablePaise', 'taxable_paise']),
          discountPaise: this.firstMoney(line, ['discountPaise', 'discount_paise']), taxPercent: this.firstNumber(line, ['taxPercent', 'tax_percent']),
          gstPaise: this.firstMoney(line, ['gstPaise', 'gst_paise']), hsnSacCode: String(line.hsnSacCode ?? line.hsn_sac_code ?? ''),
          cgstPaise: this.firstMoney(line, ['cgstPaise', 'cgst_paise']), sgstPaise: this.firstMoney(line, ['sgstPaise', 'sgst_paise']), igstPaise: this.firstMoney(line, ['igstPaise', 'igst_paise']),
        }));
        this.paymentTimeline = this.rows(data?.payments).map((payment) => ({
          id: String(payment.id ?? ''), method: String(payment.method ?? ''), label: String(payment.label ?? payment.method ?? 'Payment'),
          amountPaise: this.firstMoney(payment, ['amountPaise', 'amount_paise']), reference: String(payment.methodReference ?? payment.method_reference ?? ''),
          paidAt: String(payment.paidAt ?? payment.paid_at ?? payment.createdAt ?? payment.created_at ?? ''),
        }));
        if (this.selected) {
          const finalizedAt = String(detail.finalizedAt ?? detail.finalized_at ?? this.selected.finalizedAt ?? '');
          const createdAt = String(detail.createdAt ?? detail.created_at ?? this.selected.createdAt ?? '');
          const lastPaymentAt = this.paymentTimeline[this.paymentTimeline.length - 1]?.paidAt ?? this.selected.lastPaymentAt;
          const finalizedMs = Date.parse(finalizedAt);
          const recoveredPaise = Number.isFinite(finalizedMs)
            ? this.paymentTimeline.filter((payment) => Date.parse(payment.paidAt) > finalizedMs).reduce((sum, payment) => sum + payment.amountPaise, 0)
            : this.selected.receivedDuePaise;
          this.selected = { ...this.selected, finalizedAt, createdAt, lastPaymentAt, receivedDuePaise: Math.max(this.selected.receivedDuePaise, recoveredPaise) };
        }
        const kpi = data?.clientKpi ?? data?.client_kpi;
        this.clientKpi = kpi ? {
          membershipName: String(kpi.membershipName ?? kpi.membership_name ?? ''),
          membershipExpiresAt: kpi.membershipExpiresAt ?? kpi.membership_expires_at,
          membershipCredits: this.rows(kpi.membershipCredits ?? kpi.membership_credits),
          packageCredits: this.rows(kpi.packageCredits ?? kpi.package_credits),
        } : null;
        this.detailsLoading = false;
      },
      error: (err: any) => { this.detailsLoading = false; this.error = this.messageFor(err); },
    });
    this.loadHistory(invoice);
  }

  print(): void { this.withAction('print', () => this.api.get<any>(`/api/v1/pos/invoices/${this.selected!.id}/print`).subscribe({ next: (res) => { if (!printInvoiceDocument(res?.data ?? res)) this.error = 'Print not available'; }, error: (err: any) => this.error = this.messageFor(err) })); }
  download(): void { this.withAction('download', () => this.api.get<any>(`/api/v1/pos/invoices/${this.selected!.id}/basic`).subscribe({ next: (res) => downloadInvoiceDocument(res?.data ?? res, this.selected?.invoiceNumber || this.selected?.id || 'invoice'), error: (err: any) => this.error = this.messageFor(err) })); }
  requestResend(): void {
    if (!this.selected || !this.recipient.trim()) { this.error = 'Recipient is required'; return; }
    this.error = '';
    this.api.post<any>(`/api/v1/pos/invoices/${this.selected.id}/actions`, {
      action: 'resend', channel: this.deliveryChannel, recipient: this.recipient.trim(),
      idempotencyKey: this.newIdempotencyKey(), templateVersion: 'invoice-v1',
    }).subscribe({
      next: () => { this.message = 'Invoice delivery queued'; this.loadDeliveries(this.selected!.id); this.loadHistory(this.selected!); },
      error: (err: any) => this.error = this.messageFor(err),
    });
  }

  scheduleDueReminders(): void {
    if (this.reminderLoading || !confirm('Queue reminders for eligible overdue invoices?')) return;
    this.reminderLoading = true; this.error = '';
    this.api.post<any>('/api/v1/pos/invoice-outbox/schedule-due-reminders', {}).subscribe({
      next: (response) => { const data = response?.data ?? response; this.message = `${Number(data?.queued) || 0} due reminder(s) queued`; this.reminderLoading = false; if (this.selected) this.loadDeliveries(this.selected.id); },
      error: (err: any) => { this.error = this.messageFor(err); this.reminderLoading = false; },
    });
  }

  canReturn(invoice: InvoiceRow): boolean {
    return invoice.paidPaise > 0 && !['draft', 'voided', 'cancelled', 'refunded'].includes(invoice.status.toLowerCase());
  }

  canVoid(invoice: InvoiceRow): boolean {
    return invoice.paidPaise === 0 && ['draft', 'open'].includes(invoice.status.toLowerCase());
  }

  openVoidDrawer(): void {
    if (!this.selected || !this.canVoid(this.selected)) return;
    this.error = '';
    this.voidReason = '';
    this.voidIdempotencyKey = this.newIdempotencyKey();
    this.voidDrawerOpen = true;
  }

  closeVoidDrawer(): void {
    this.voidDrawerOpen = false;
    this.voidReason = '';
    this.voidIdempotencyKey = '';
    this.voidLoading = false;
  }

  submitVoid(): void {
    if (!this.selected || this.voidLoading) return;
    const reason = this.voidReason.trim();
    if (!reason) { this.error = 'Void reason is required'; return; }
    const selectedId = this.selected.id;
    this.error = '';
    this.voidLoading = true;
    this.api.post<any>(`/api/v1/pos/invoices/${selectedId}/void`, {
      reason,
      idempotencyKey: this.voidIdempotencyKey || this.newIdempotencyKey(),
    }).subscribe({
      next: () => {
        this.closeVoidDrawer();
        this.message = 'Invoice voided';
        this.load(() => {
          const updated = this.invoices.find((invoice) => invoice.id === selectedId);
          if (updated) this.select(updated);
        });
      },
      error: (err: any) => { this.voidLoading = false; this.error = this.messageFor(err); },
    });
  }

  canAccessDeleteRequests(): boolean {
    return this.auth.hasRole('owner', 'admin', 'super_admin', 'platform_admin') || this.auth.hasPermission('pos.manage');
  }

  canRequestDelete(invoice: InvoiceRow): boolean {
    return this.canAccessDeleteRequests() && this.canVoid(invoice) && this.deleteRequest?.status !== 'pending';
  }

  canDecideDeleteRequest(): boolean {
    if (!this.deleteRequest || this.deleteRequest.status !== 'pending') return false;
    if (this.deleteRequest.requestedByUserId === this.auth.userId) return false;
    return this.auth.hasRole('owner', 'admin', 'manager', 'super_admin', 'platform_admin') || this.auth.hasPermission('pos.void');
  }

  openDeleteDrawer(): void {
    if (!this.selected || !this.canRequestDelete(this.selected)) return;
    this.error = '';
    this.deleteReason = '';
    this.deleteDrawerOpen = true;
  }

  closeDeleteDrawer(): void {
    this.deleteDrawerOpen = false;
    this.deleteReason = '';
    this.deleteLoading = false;
  }

  submitDeleteRequest(): void {
    if (!this.selected || this.deleteLoading) return;
    const reason = this.deleteReason.trim();
    if (reason.length < 3) { this.error = 'Delete reason must contain at least 3 characters'; return; }
    const selectedId = this.selected.id;
    this.error = '';
    this.deleteLoading = true;
    this.api.post<any>(`/api/v1/pos/invoices/${selectedId}/delete-request`, { reason }).subscribe({
      next: (response) => {
        this.deleteRequest = this.invoiceDeleteRequest(response?.data ?? response);
        this.closeDeleteDrawer();
        this.message = 'Invoice delete request sent for approval';
        this.loadHistory(this.selected!);
      },
      error: (error: any) => { this.deleteLoading = false; this.error = this.messageFor(error); },
    });
  }

  decideDeleteRequest(status: 'approved' | 'rejected'): void {
    if (!this.selected || !this.deleteRequest || !this.canDecideDeleteRequest() || this.deleteDecisionLoading) return;
    const decisionNote = this.deleteDecisionNote.trim();
    if (status === 'rejected' && decisionNote.length < 3) { this.error = 'Rejection reason must contain at least 3 characters'; return; }
    const requestId = this.deleteRequest.id;
    const selectedId = this.selected.id;
    this.error = '';
    this.deleteDecisionLoading = true;
    this.api.post<any>(`/api/v1/pos/invoice-delete-requests/${requestId}/decision`, { status, decisionNote }).subscribe({
      next: (response) => {
        this.deleteRequest = this.invoiceDeleteRequest(response?.data ?? response);
        this.deleteDecisionLoading = false;
        this.deleteDecisionNote = '';
        this.message = status === 'approved' ? 'Invoice soft-deleted' : 'Invoice delete request rejected';
        if (status === 'approved') {
          this.selected = null;
          this.load();
        } else {
          this.loadHistory(this.selected!);
          this.loadDeleteRequest(selectedId);
        }
      },
      error: (error: any) => { this.deleteDecisionLoading = false; this.error = this.messageFor(error); },
    });
  }

  canAccessCorrectionRequests(): boolean { return this.canAccessDeleteRequests(); }

  canRequestCorrection(invoice: InvoiceRow): boolean {
    return this.canAccessCorrectionRequests()
      && invoice.paidPaise === 0
      && invoice.status.toLowerCase() === 'open'
      && this.correctionRequest?.status !== 'pending';
  }

  canDecideCorrectionRequest(): boolean {
    if (!this.correctionRequest || this.correctionRequest.status !== 'pending') return false;
    if (this.correctionRequest.requestedByUserId === this.auth.userId) return false;
    return this.auth.hasRole('owner', 'admin', 'manager', 'super_admin', 'platform_admin') || this.auth.hasPermission('pos.void');
  }

  openCorrectionDrawer(): void {
    if (!this.selected || !this.canRequestCorrection(this.selected) || !this.invoiceLines.length) return;
    this.error = '';
    this.correctionReason = '';
    this.correctionLines = this.invoiceLines.map((line) => {
      const discountType = (line.discountType === 'amount' || line.discountType === 'percent') ? line.discountType : 'none';
      const discountValue = discountType === 'percent' ? (line.discountBps || 0) / 100 : (line.discountValuePaise || 0) / 100;
      return {
        ...line,
        editedUnitPrice: String((line.unitPricePaise || 0) / 100),
        editedDiscountType: discountType,
        editedDiscountValue: discountType === 'none' ? '' : String(discountValue),
      };
    });
    this.correctionDrawerOpen = true;
  }

  closeCorrectionDrawer(): void {
    this.correctionDrawerOpen = false;
    this.correctionReason = '';
    this.correctionLines = [];
    this.correctionLoading = false;
  }

  submitCorrectionRequest(): void {
    if (!this.selected || this.correctionLoading) return;
    const reason = this.correctionReason.trim();
    if (reason.length < 3) { this.error = 'Correction reason must contain at least 3 characters'; return; }
    const lines = this.correctionLines.map((line) => {
      const unitPricePaise = Math.round(Number(line.editedUnitPrice) * 100);
      const discount = Number(line.editedDiscountValue || 0);
      return {
        id: line.id,
        unitPricePaise,
        discountType: line.editedDiscountType,
        discountValuePaise: line.editedDiscountType === 'amount' ? Math.round(discount * 100) : 0,
        discountBps: line.editedDiscountType === 'percent' ? Math.round(discount * 100) : 0,
      };
    });
    if (lines.some((line) => !Number.isFinite(line.unitPricePaise) || line.unitPricePaise < 0 || line.discountValuePaise < 0 || line.discountBps < 0 || line.discountBps > 10_000)) {
      this.error = 'Correction price or discount is invalid';
      return;
    }
    const selectedId = this.selected.id;
    this.error = '';
    this.correctionLoading = true;
    this.api.post<any>(`/api/v1/pos/invoices/${selectedId}/correction-requests`, { reason, lines }).subscribe({
      next: (response) => {
        this.correctionRequest = this.invoiceCorrectionRequest(response?.data ?? response);
        this.closeCorrectionDrawer();
        this.message = 'Invoice correction sent for approval';
        this.loadHistory(this.selected!);
      },
      error: (error: any) => { this.correctionLoading = false; this.error = this.messageFor(error); },
    });
  }

  decideCorrectionRequest(status: 'approved' | 'rejected'): void {
    if (!this.selected || !this.correctionRequest || !this.canDecideCorrectionRequest() || this.correctionDecisionLoading) return;
    const decisionNote = this.correctionDecisionNote.trim();
    if (status === 'rejected' && decisionNote.length < 3) { this.error = 'Rejection reason must contain at least 3 characters'; return; }
    const requestId = this.correctionRequest.id;
    const selectedId = this.selected.id;
    this.error = '';
    this.correctionDecisionLoading = true;
    this.api.post<any>(`/api/v1/pos/invoice-correction-requests/${requestId}/decision`, { status, decisionNote }).subscribe({
      next: (response) => {
        this.correctionRequest = this.invoiceCorrectionRequest(response?.data ?? response);
        this.correctionDecisionLoading = false;
        this.correctionDecisionNote = '';
        this.message = status === 'approved' ? 'Invoice correction applied' : 'Invoice correction rejected';
        this.load(() => this.selectInvoiceById(selectedId));
      },
      error: (error: any) => { this.correctionDecisionLoading = false; this.error = this.messageFor(error); },
    });
  }

  canCreditNote(invoice: InvoiceRow): boolean {
    return invoice.totalPaise > 0 && !['draft', 'voided', 'cancelled'].includes(invoice.status.toLowerCase());
  }

  openCreditNoteDrawer(): void {
    if (!this.selected || !this.canCreditNote(this.selected)) return;
    this.error = '';
    this.creditNoteReason = '';
    this.creditNoteNotes = '';
    this.creditNoteAmount = '';
    this.creditNoteIdempotencyKey = this.newIdempotencyKey();
    this.creditNoteDrawerOpen = true;
  }

  closeCreditNoteDrawer(): void {
    this.creditNoteDrawerOpen = false;
    this.creditNoteReason = '';
    this.creditNoteNotes = '';
    this.creditNoteAmount = '';
    this.creditNoteIdempotencyKey = '';
    this.creditNoteLoading = false;
  }

  submitCreditNote(): void {
    if (!this.selected || this.creditNoteLoading) return;
    const reason = this.creditNoteReason.trim();
    const amountPaise = Math.round(Number(this.creditNoteAmount) * 100);
    if (!reason) { this.error = 'Credit note reason is required'; return; }
    if (!Number.isFinite(amountPaise) || amountPaise <= 0) { this.error = 'Credit note amount must be greater than zero'; return; }
    if (amountPaise > this.selected.totalPaise) { this.error = 'Credit note amount cannot exceed invoice total'; return; }
    const selectedId = this.selected.id;
    this.error = '';
    this.creditNoteLoading = true;
    this.api.post<any>(`/api/v1/pos/invoices/${selectedId}/credit-note`, {
      amountPaise,
      reason,
      notes: this.creditNoteNotes.trim(),
      idempotencyKey: this.creditNoteIdempotencyKey || this.newIdempotencyKey(),
    }).subscribe({
      next: () => {
        this.closeCreditNoteDrawer();
        this.message = 'Credit note created';
        this.load(() => {
          const updated = this.invoices.find((invoice) => invoice.id === selectedId);
          if (updated) this.select(updated);
        });
      },
      error: (err: any) => { this.creditNoteLoading = false; this.error = this.messageFor(err); },
    });
  }

  verifyLedger(): void {
    if (!this.selected || this.ledgerLoading) return;
    this.error = '';
    this.ledgerLoading = true;
    this.api.get<any>(`/api/v1/pos/invoices/${this.selected.id}/ledger/verify`).subscribe({
      next: (res) => {
        const data = res?.data ?? res;
        this.ledgerVerification = {
          valid: data?.valid === true,
          events: Number(data?.events) || 0,
          headHash: String(data?.headHash ?? ''),
          failedAt: Number.isInteger(data?.failedAt) ? Number(data.failedAt) : null,
        };
        this.ledgerLoading = false;
      },
      error: (err: any) => { this.ledgerLoading = false; this.error = this.messageFor(err); },
    });
  }

  canCreatePaymentLink(invoice: InvoiceRow): boolean {
    return invoice.balancePaise > 0 && !['draft', 'paid', 'voided', 'cancelled'].includes(invoice.status.toLowerCase());
  }

  canReceivePayment(invoice: InvoiceRow): boolean {
    return invoice.balancePaise > 0 && !['draft', 'paid', 'voided', 'cancelled', 'refunded'].includes(invoice.status.toLowerCase());
  }

  get receivePaymentTotalPaise(): number {
    return this.paymentMethods.reduce((total, mode) => total + this.inputPaise(this.receivePaymentInputs[mode.code]), 0);
  }

  openReceivePaymentDrawer(): void {
    if (!this.selected || !this.canReceivePayment(this.selected) || this.paymentMethodsLoading) return;
    if (!this.paymentMethods.length) { this.error = 'No active payment modes are configured'; return; }
    this.error = '';
    this.receivePaymentInputs = Object.fromEntries(this.paymentMethods.map((mode) => [mode.code, '']));
    this.receivePaymentReferences = Object.fromEntries(this.paymentMethods.map((mode) => [mode.code, '']));
    this.receivePaymentIdempotencyKeys = {};
    this.receivePaymentNotes = '';
    this.receivePaymentDrawerOpen = true;
  }

  closeReceivePaymentDrawer(): void {
    this.receivePaymentDrawerOpen = false;
    this.receivePaymentInputs = {};
    this.receivePaymentReferences = {};
    this.receivePaymentIdempotencyKeys = {};
    this.receivePaymentNotes = '';
    this.receivePaymentLoading = false;
  }

  fillReceivePayment(mode: PaymentMode): void {
    if (!this.selected) return;
    const otherPayments = this.paymentMethods
      .filter((item) => item.code !== mode.code)
      .reduce((total, item) => total + this.inputPaise(this.receivePaymentInputs[item.code]), 0);
    this.receivePaymentInputs[mode.code] = this.moneyInput(Math.max(this.selected.balancePaise - otherPayments, 0));
  }

  submitReceivePayment(): void {
    if (!this.selected || this.receivePaymentLoading) return;
    const payments = this.paymentMethods.map((mode) => ({
      ...mode,
      amountPaise: this.inputPaise(this.receivePaymentInputs[mode.code]),
      reference: String(this.receivePaymentReferences[mode.code] ?? '').trim(),
      idempotencyKey: this.receivePaymentIdempotencyKeys[mode.code] ||= this.newIdempotencyKey(),
    })).filter((payment) => payment.amountPaise > 0);

    if (!payments.length) { this.error = 'Enter at least one payment amount'; return; }
    if (payments.reduce((total, payment) => total + payment.amountPaise, 0) > this.selected.balancePaise) { this.error = 'Payment total cannot exceed balance due'; return; }
    const missingReference = payments.find((payment) => payment.referenceRequired && !payment.reference);
    if (missingReference) { this.error = `${missingReference.label} reference is required`; return; }

    this.error = '';
    this.receivePaymentLoading = true;
    this.savePendingPayments(this.selected.id, payments, 0);
  }

  openPaymentLinkDrawer(): void {
    if (!this.selected || !this.canCreatePaymentLink(this.selected)) return;
    this.error = '';
    this.paymentLinkAmount = this.moneyInput(this.selected.balancePaise);
    this.paymentLinkIdempotencyKey = this.newIdempotencyKey();
    this.paymentLinkDrawerOpen = true;
  }

  closePaymentLinkDrawer(): void {
    this.paymentLinkDrawerOpen = false;
    this.paymentLinkAmount = '';
    this.paymentLinkProvider = 'razorpay';
    this.paymentLinkIdempotencyKey = '';
    this.paymentLinkLoading = false;
  }

  createPaymentLink(): void {
    if (!this.selected || this.paymentLinkLoading) return;
    const amountPaise = Math.round(Number(this.paymentLinkAmount) * 100);
    if (!Number.isFinite(amountPaise) || amountPaise <= 0) { this.error = 'Payment link amount must be greater than zero'; return; }
    if (amountPaise > this.selected.balancePaise) { this.error = 'Payment link amount cannot exceed balance due'; return; }
    const selectedId = this.selected.id;
    this.error = '';
    this.paymentLinkLoading = true;
    this.api.post<any>(`/api/v1/pos/invoices/${selectedId}/payment-links`, {
      provider: this.paymentLinkProvider,
      amountPaise,
      idempotencyKey: this.paymentLinkIdempotencyKey || this.newIdempotencyKey(),
    }).subscribe({
      next: (res) => {
        const link = this.paymentLink(res?.data ?? res);
        this.closePaymentLinkDrawer();
        this.message = 'Payment link created';
        this.paymentLinks = [link, ...this.paymentLinks.filter((item) => item.id !== link.id)];
      },
      error: (err: any) => { this.paymentLinkLoading = false; this.error = this.messageFor(err); },
    });
  }

  reconcilePaymentLink(link: PaymentLink): void {
    if (!this.selected || this.reconcilingPaymentLinkId) return;
    this.error = '';
    this.reconcilingPaymentLinkId = link.id;
    this.api.post<any>(`/api/v1/pos/invoices/${this.selected.id}/payment-links/${link.id}/reconcile`, {}).subscribe({
      next: (res) => {
        const data = (res?.data ?? res)?.result ?? res?.data ?? res;
        this.paymentReconciliation = {
          paymentLinkId: String(data?.paymentLinkId ?? link.id),
          providerStatus: String(data?.providerStatus ?? ''),
          providerAmountPaidPaise: Number(data?.providerAmountPaidPaise) || 0,
          requiresSignedWebhook: data?.requiresSignedWebhook === true,
        };
        this.reconcilingPaymentLinkId = '';
        this.loadPaymentLinks(this.selected!.id);
      },
      error: (err: any) => { this.reconcilingPaymentLinkId = ''; this.error = this.messageFor(err); },
    });
  }

  copyPaymentLink(link: PaymentLink): void {
    if (!link.url) return;
    navigator.clipboard.writeText(link.url).then(() => this.message = 'Payment link copied').catch(() => this.error = 'Unable to copy payment link');
  }

  revokePaymentInstrument(instrument: PaymentInstrument): void {
    if (!this.selected || this.revokingInstrumentId || instrument.status === 'revoked') return;
    this.revokingInstrumentId = instrument.id;
    this.error = '';
    this.api.post<any>(`/api/v1/pos/payment-instruments/${instrument.id}/revoke`, {}).subscribe({
      next: () => {
        this.revokingInstrumentId = '';
        this.message = 'Saved payment instrument revoked';
        this.loadPaymentCompliance(this.selected!.id);
      },
      error: (err: any) => { this.revokingInstrumentId = ''; this.error = this.messageFor(err); },
    });
  }

  openReturnDrawer(): void {
    if (!this.selected || !this.canReturn(this.selected)) return;
    this.error = '';
    this.returnLoading = true;
    this.api.get<any>(`/api/v1/pos/invoices/${this.selected.id}`).subscribe({
      next: (res) => {
        const data = res?.data ?? res;
        this.refundMethods = Array.from(new Set(this.rows(data?.payments)
          .map((payment) => String(payment.method ?? '').trim().toLowerCase())
          .filter(Boolean)));
        this.refundMethod = this.refundMethods.length === 1 ? this.refundMethods[0] : '';
        this.loadRefundTills();
        this.returnLines = this.rows(data?.lines).map((line) => ({
          id: String(line.id ?? ''),
          lineType: String(line.lineType ?? line.line_type ?? ''),
          itemName: String(line.itemName ?? line.item_name ?? ''),
          quantity: this.firstNumber(line, ['quantity']),
          lineTotalPaise: this.firstMoney(line, ['lineTotalPaise', 'line_total_paise']),
          returnQuantity: null,
          restockQuantity: null,
          discardQuantity: null,
        })).filter((line) => line.id && line.quantity > 0);
        this.returnReason = '';
        this.returnMfaCode = '';
        this.returnEvidenceReference = '';
        this.returnIdempotencyKey = this.newIdempotencyKey();
        this.returnDrawerOpen = true;
        this.returnLoading = false;
      },
      error: (err: any) => { this.returnLoading = false; this.error = this.messageFor(err); },
    });
  }

  closeReturnDrawer(): void {
    this.returnDrawerOpen = false;
    this.returnLoading = false;
    this.returnLines = [];
    this.returnReason = '';
    this.returnMfaCode = '';
    this.returnEvidenceReference = '';
    this.refundMethod = '';
    this.refundMethods = [];
    this.refundTills = [];
    this.refundTillId = '';
    this.returnIdempotencyKey = '';
  }

  returnLineAmount(line: ReturnLine): number {
    const quantity = Number(line.returnQuantity) || 0;
    return quantity > 0 && line.quantity > 0 ? Math.floor(line.lineTotalPaise * quantity / line.quantity) : 0;
  }

  selectedReturnCount(): number { return this.returnLines.filter((line) => (Number(line.returnQuantity) || 0) > 0).length; }
  selectedReturnAmount(): number { return this.returnLines.reduce((sum, line) => sum + this.returnLineAmount(line), 0); }

  submitReturn(): void {
    if (!this.selected || this.returnLoading) return;
    const reason = this.returnReason.trim();
    const lines = this.returnLines
      .filter((line) => (Number(line.returnQuantity) || 0) > 0)
      .map((line) => ({
        saleLineId: line.id,
        quantity: Number(line.returnQuantity),
        restockQuantity: line.lineType === 'product' ? Number(line.restockQuantity || 0) : 0,
        discardQuantity: line.lineType === 'product' ? Number(line.discardQuantity || 0) : Number(line.returnQuantity),
      }));
    if (!reason) { this.error = 'Return reason is required'; return; }
    if (!this.returnMfaCode.trim()) { this.error = 'Authenticator or recovery code is required'; return; }
    if (!this.returnEvidenceReference.trim()) { this.error = 'Evidence reference is required'; return; }
    if (!lines.length) { this.error = 'Select at least one item to return'; return; }
    if (lines.some((line) => !Number.isInteger(line.quantity) || line.quantity < 1)) { this.error = 'Return quantity must be a whole number'; return; }
    if (this.returnLines.some((line) => (Number(line.returnQuantity) || 0) > line.quantity)) { this.error = 'Return quantity cannot exceed sold quantity'; return; }
    if (lines.some((line) => !Number.isInteger(line.restockQuantity) || !Number.isInteger(line.discardQuantity)
      || line.restockQuantity < 0 || line.discardQuantity < 0
      || line.restockQuantity + line.discardQuantity !== line.quantity)) {
      this.error = 'Every product return must be fully split between restock and discard'; return;
    }

    this.error = '';
    this.returnLoading = true;
    this.api.post<any>(`/api/v1/pos/invoices/${this.selected.id}/refund`, {
      reason,
      idempotencyKey: this.returnIdempotencyKey || this.newIdempotencyKey(),
      evidenceReference: this.returnEvidenceReference.trim(),
      lines,
      mfaCode: this.returnMfaCode.trim(),
      refundMethod: this.refundMethod || null,
      cashDrawerTillId: this.refundMethod === 'cash' ? (this.refundTillId || null) : null,
    }).subscribe({
      next: () => {
        const selectedId = this.selected?.id;
        this.closeReturnDrawer();
        this.message = 'Item return recorded';
        this.load(() => {
          const updated = this.invoices.find((invoice) => invoice.id === selectedId);
          if (updated) this.select(updated);
        });
      },
      error: (err: any) => { this.returnLoading = false; this.error = this.messageFor(err); },
    });
  }

  private loadRefundTills(): void {
    const date = this.istBusinessDate();
    this.api.get<any>(`/api/v1/pos/cash-drawer/current?businessDate=${date}`).subscribe({
      next: (response) => {
        const session = response?.data ?? null;
        if (!session?.id || session.status !== 'open') { this.refundTills = []; this.refundTillId = ''; return; }
        this.api.get<any>(`/api/v1/pos/cash-drawer/${session.id}/tills`).subscribe({
          next: (tillResponse) => {
            const value = tillResponse?.data ?? tillResponse;
            this.refundTills = (Array.isArray(value) ? value : []).filter((till: RefundTill) => till.status === 'open');
            this.refundTillId = this.refundTills.length === 1 ? this.refundTills[0].id : '';
          },
          error: () => { this.refundTills = []; this.refundTillId = ''; },
        });
      },
      error: () => { this.refundTills = []; this.refundTillId = ''; },
    });
  }

  private istBusinessDate(): string {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit',
    }).formatToParts(new Date());
    const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    return `${value['year']}-${value['month']}-${value['day']}`;
  }

  formatDate(value: string): string {
    const v = String(value ?? '').slice(0, 10);
    const p = v.split('-');
    return p.length === 3 ? `${p[2]}/${p[1]}/${p[0]}` : '-';
  }

  formatDateTime(value: string): string {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '-';
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Kolkata', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
    }).format(date).replace(',', '');
  }

  lifecycleLabel(invoice: InvoiceRow): string {
    if (invoice.totalPaise === 0 && invoice.paidPaise === 0 && invoice.balancePaise === 0) return 'No charge';
    if (invoice.receivedDuePaise > 0 && invoice.balancePaise === 0) return 'Unpaid → Paid';
    if (invoice.receivedDuePaise > 0) return 'Partially recovered';
    if (invoice.balancePaise > 0 && invoice.paidPaise === 0) return 'Unpaid';
    if (invoice.balancePaise > 0) return 'Partially paid';
    return invoice.paidPaise > 0 ? 'Paid at invoice' : 'No payment';
  }

  statusTone(value: string): string {
    const status = String(value || '').trim().toLowerCase().replace(/[_-]+/g, ' ');
    if ((status.includes('unpaid') && status.includes('paid')) || status.includes('recover')) return 'status-recovered';
    if (status.includes('partial')) return 'status-partial';
    if (status.includes('void') || status.includes('cancel') || status.includes('delete') || status.includes('fail') || status.includes('revoke')) return 'status-danger';
    if (status.includes('unpaid') || status.includes('due') || status === 'open') return 'status-unpaid';
    if (status.includes('paid') || status.includes('complete') || status.includes('finalized') || status.includes('success') || status.includes('deliver')) return 'status-paid';
    if (status.includes('pending') || status.includes('hold') || status.includes('draft')) return 'status-pending';
    return 'status-neutral';
  }

  originalUnpaidPaise(invoice: InvoiceRow): number { return invoice.receivedDuePaise + invoice.balancePaise; }
  unpaidAt(invoice: InvoiceRow): string { return invoice.finalizedAt || invoice.createdAt; }
  recoveryDays(invoice: InvoiceRow): number | null {
    if (!invoice.lastPaymentAt || invoice.receivedDuePaise <= 0 || invoice.balancePaise > 0) return null;
    const start = Date.parse(this.unpaidAt(invoice));
    const end = Date.parse(invoice.lastPaymentAt);
    return Number.isFinite(start) && Number.isFinite(end) ? Math.max(Math.floor((end - start) / 86_400_000), 0) : null;
  }

  lineTypeCount(type: string): number { return this.invoiceLines.filter((line) => line.lineType === type).length; }
  lineTypeTotal(type: string): number { return this.invoiceLines.filter((line) => line.lineType === type).reduce((sum, line) => sum + line.lineTotalPaise, 0); }

  money(value: number): string { return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format((value || 0) / 100); }
  paymentSummary(row: InvoiceRow): string { return row.paymentMode ? row.paymentMode : row.totalPaise === 0 ? 'No charge' : row.paidPaise > 0 ? 'Paid' : 'Unpaid'; }
  trackByInvoice(_: number, row: InvoiceRow): string { return row.id; }
  trackByHistory(_: number, row: InvoiceAction): string { return row.id; }
  trackByPaymentTimeline(_: number, row: InvoicePayment): string { return row.id; }
  trackByDelivery(_: number, row: InvoiceDelivery): string { return row.id; }
  trackByLine(_: number, row: InvoiceLine): string { return row.id; }
  lineTypeLabel(value: string): string { return value.replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase()); }

  private withAction(action: string, done: () => void): void {
    if (!this.selected) return;
    this.error = '';
    this.api.post<any>(`/api/v1/pos/invoices/${this.selected.id}/actions`, { action, recipient: action === 'resend' ? this.recipient.trim() : '' }).subscribe({ next: () => { done(); this.select(this.selected!); }, error: (err: any) => this.error = this.messageFor(err) });
  }

  private invoice(row: any): InvoiceRow {
    return {
      id: String(row.id ?? row.saleId ?? row.sale_id ?? ''),
      invoiceNumber: String(row.invoiceNumber ?? row.invoice_number ?? row.invoiceNo ?? row.invoice_no ?? row.id ?? ''),
      clientId: String(row.clientId ?? row.client_id ?? ''),
      clientName: String(row.clientName ?? row.client_name ?? 'Walk-in client'),
      clientPhone: String(row.clientPhone ?? row.client_phone ?? row.phone ?? ''),
      staffId: String(row.staffId ?? row.staff_id ?? ''),
      staffName: String(row.staffName ?? row.staff_name ?? row.staff ?? ''),
      businessDate: String(row.businessDate ?? row.business_date ?? row.createdAt ?? row.created_at ?? ''),
      status: String(row.status ?? 'finalized'),
      paymentMode: String(row.paymentMode ?? row.payment_mode ?? row.method ?? '').trim() || this.registerPaymentModes(row),
      totalPaise: this.firstMoney(row, ['totalPaise', 'total_paise', 'total']),
      paidPaise: this.firstMoney(row, ['paidPaise', 'paid_paise', 'paid']),
      balancePaise: this.firstMoney(row, ['balancePaise', 'balance_paise', 'balanceDuePaise', 'balance_due_paise', 'duePaise', 'due_paise']),
      receivedDuePaise: this.firstMoney(row, ['receivedDuePaise', 'received_due_paise']),
      walletPaise: this.firstMoney(row, ['walletPaise', 'wallet_paise']),
      finalizedAt: String(row.finalizedAt ?? row.finalized_at ?? ''),
      createdAt: String(row.createdAt ?? row.created_at ?? ''),
      lastPaymentAt: String(row.lastPaymentAt ?? row.last_payment_at ?? ''),
    };
  }

  private registerQuery(): string {
    const params = new URLSearchParams({ page: '1', pageSize: '100' });
    if (this.searchText.trim()) params.set('q', this.searchText.trim().toLowerCase());
    if (this.statusFilter) params.set('status', this.statusFilter);
    if (this.paymentMethodFilter) params.set('payment_method', this.paymentMethodFilter);
    return params.toString();
  }

  private registerPaymentModes(row: any): string {
    return [
      ['Cash', 'cashPaise', 'cash_paise'],
      ['UPI', 'upiPaise', 'upi_paise'],
      ['Card', 'cardPaise', 'card_paise'],
      ['Wallet', 'walletPaise', 'wallet_paise'],
      ['Gift card', 'giftCardPaise', 'gift_card_paise'],
      ['Store credit', 'storeCreditPaise', 'store_credit_paise'],
      ['Other', 'otherPaise', 'other_paise'],
    ].filter(([, camel, snake]) => this.firstMoney(row, [camel, snake]) > 0)
      .map(([label]) => label)
      .join(' + ');
  }

  private loadDeleteRequest(invoiceId: string): void {
    this.api.get<any>(`/api/v1/pos/invoice-delete-requests?status=all&saleId=${encodeURIComponent(invoiceId)}`).subscribe({
      next: (response) => {
        const latest = this.rows(response)[0];
        this.deleteRequest = latest ? this.invoiceDeleteRequest(latest) : null;
      },
      error: (error: any) => this.error = this.messageFor(error),
    });
  }

  private invoiceDeleteRequest(row: any): InvoiceDeleteRequest {
    return {
      id: String(row?.id ?? ''), saleId: String(row?.saleId ?? row?.sale_id ?? ''), invoiceNumber: String(row?.invoiceNumber ?? row?.invoice_number ?? ''),
      reason: String(row?.reason ?? ''), status: String(row?.status ?? ''), requestedByUserId: String(row?.requestedByUserId ?? row?.requested_by_user_id ?? ''),
      decidedByUserId: String(row?.decidedByUserId ?? row?.decided_by_user_id ?? ''), decisionNote: String(row?.decisionNote ?? row?.decision_note ?? ''),
      requestedAt: String(row?.requestedAt ?? row?.requested_at ?? ''), decidedAt: row?.decidedAt ?? row?.decided_at, appliedAt: row?.appliedAt ?? row?.applied_at,
    };
  }

  private loadCorrectionRequests(invoiceId: string): void {
    this.api.get<any>(`/api/v1/pos/invoices/${invoiceId}/correction-requests`).subscribe({
      next: (response) => {
        const latest = this.rows(response)[0];
        this.correctionRequest = latest ? this.invoiceCorrectionRequest(latest) : null;
      },
      error: (error: any) => this.error = this.messageFor(error),
    });
  }

  private invoiceCorrectionRequest(row: any): InvoiceCorrectionRequest {
    return {
      id: String(row?.id ?? ''), saleId: String(row?.saleId ?? row?.sale_id ?? ''), invoiceNumber: String(row?.invoiceNumber ?? row?.invoice_number ?? ''),
      reason: String(row?.reason ?? ''), status: String(row?.status ?? ''), requestedByUserId: String(row?.requestedByUserId ?? row?.requested_by_user_id ?? ''),
      decidedByUserId: String(row?.decidedByUserId ?? row?.decided_by_user_id ?? ''), decisionNote: String(row?.decisionNote ?? row?.decision_note ?? ''),
      requestedAt: String(row?.requestedAt ?? row?.requested_at ?? ''), decidedAt: row?.decidedAt ?? row?.decided_at, appliedAt: row?.appliedAt ?? row?.applied_at,
    };
  }

  private loadPaymentLinks(invoiceId: string): void {
    this.api.get<any>(`/api/v1/pos/invoices/${invoiceId}/payment-links`).subscribe({
      next: (res) => this.paymentLinks = this.rows(res).map((row) => this.paymentLink(row)),
      error: (err: any) => this.error = this.messageFor(err),
    });
  }

  private loadPaymentMethods(): void {
    this.paymentMethodsLoading = true;
    this.api.get<any>('/pos/payment-methods').subscribe({
      next: (response) => {
        this.paymentMethods = this.rows(response).map((row) => ({
          code: String(row.code ?? '').trim(),
          label: String(row.name ?? row.label ?? row.code ?? '').trim(),
          referenceRequired: row.referenceRequired === true || row.reference_required === true,
        })).filter((mode) => mode.code && mode.label);
        this.paymentMethodsLoading = false;
      },
      error: (error: any) => { this.paymentMethodsLoading = false; this.error = this.messageFor(error); },
    });
  }

  private savePendingPayments(invoiceId: string, payments: PendingPayment[], index: number): void {
    if (index >= payments.length) {
      this.closeReceivePaymentDrawer();
      this.message = payments.length > 1 ? 'Split payment recorded' : 'Payment recorded';
      this.load(() => {
        const updated = this.invoices.find((invoice) => invoice.id === invoiceId);
        if (updated) this.select(updated);
      });
      return;
    }

    const payment = payments[index];
    this.api.post<any>(`/api/v1/pos/invoices/${invoiceId}/payments`, {
      method: payment.code,
      amountPaise: payment.amountPaise,
      methodReference: payment.reference,
      notes: this.receivePaymentNotes.trim(),
      idempotencyKey: payment.idempotencyKey,
    }).subscribe({
      next: () => {
        this.receivePaymentInputs[payment.code] = '';
        this.savePendingPayments(invoiceId, payments, index + 1);
      },
      error: (error: any) => {
        this.receivePaymentLoading = false;
        this.error = index > 0 ? `Some payments were recorded. ${this.messageFor(error)}` : this.messageFor(error);
        this.load();
      },
    });
  }

  private loadPaymentCompliance(invoiceId: string): void {
    this.api.get<any>(`/api/v1/pos/invoices/${invoiceId}/payment-instruments`).subscribe({
      next: (response) => this.paymentInstruments = this.rows(response).map((row) => ({
        id: String(row.id ?? ''), provider: String(row.provider ?? ''), methodType: String(row.methodType ?? ''),
        brand: String(row.brand ?? ''), last4: String(row.last4 ?? ''), recurringEnabled: row.recurringEnabled === true,
        status: String(row.status ?? ''),
      })),
      error: (err: any) => this.error = this.messageFor(err),
    });
    this.api.get<any>(`/api/v1/pos/invoices/${invoiceId}/disputes`).subscribe({
      next: (response) => this.paymentDisputes = this.rows(response).map((row) => ({
        id: String(row.id ?? ''), provider: String(row.provider ?? ''), providerDisputeId: String(row.providerDisputeId ?? ''),
        amountPaise: Number(row.amountPaise) || 0, currency: String(row.currency ?? 'INR'), reason: String(row.reason ?? ''),
        status: String(row.status ?? ''), evidenceDueAt: row.evidenceDueAt, openedAt: String(row.openedAt ?? ''),
      })),
      error: (err: any) => this.error = this.messageFor(err),
    });
  }

  private loadDeliveries(invoiceId: string): void {
    this.api.get<any>(`/api/v1/pos/invoices/${invoiceId}/deliveries`).subscribe({
      next: (response) => this.deliveries = this.rows(response).map((row) => ({
        id: String(row.id), channel: String(row.channel), recipient: String(row.recipient), status: String(row.status),
        attempts: Number(row.attempts) || 0, lastError: String(row.lastError ?? ''), deliveredAt: row.deliveredAt ?? null, createdAt: String(row.createdAt ?? ''),
      })),
      error: (err: any) => this.error = this.messageFor(err),
    });
  }

  private loadHistory(invoice: InvoiceRow): void {
    this.api.get<any>(`/api/v1/pos/invoices/${invoice.id}/history`).subscribe({
      next: (res) => this.history = this.rows(res).map((row) => ({ id: String(row.id), action: String(row.action), recipient: String(row.recipient ?? ''), createdAt: String(row.createdAt ?? row.created_at ?? '') })),
      error: (err: any) => this.error = this.messageFor(err),
    });
  }

  private paymentLink(row: any): PaymentLink {
    return {
      id: String(row?.id ?? ''),
      provider: String(row?.provider ?? ''),
      amountPaise: this.firstMoney(row, ['amountPaise', 'amount_paise']),
      status: String(row?.status ?? ''),
      url: String(row?.url ?? row?.linkUrl ?? row?.link_url ?? ''),
      expiresAt: row?.expiresAt ?? row?.expires_at,
    };
  }

  private normalizeTotals(raw: any, rows: InvoiceRow[]): InvoiceTotals {
    const totalRows = this.firstNumber(raw, ['totalRows', 'total_rows', 'count']) || rows.length;
    const totalPaise = this.firstMoney(raw, ['totalPaise', 'total_paise', 'billedPaise', 'billed_paise']) || rows.reduce((sum, row) => sum + row.totalPaise, 0);
    const paidPaise = this.firstMoney(raw, ['paidPaise', 'paid_paise', 'collectedPaise', 'collected_paise']) || rows.reduce((sum, row) => sum + row.paidPaise, 0);
    return {
      totalRows,
      totalPaise,
      paidPaise,
      receivedDuePaise: this.firstMoney(raw, ['receivedDuePaise', 'received_due_paise', 'dueReceivedPaise', 'due_received_paise']),
      balancePaise: this.firstMoney(raw, ['balancePaise', 'balance_paise', 'duePaise', 'due_paise']) || rows.reduce((sum, row) => sum + row.balancePaise, 0),
      walletPaise: this.firstMoney(raw, ['walletPaise', 'wallet_paise']),
    };
  }

  private emptyTotals(): InvoiceTotals { return { totalRows: 0, totalPaise: 0, paidPaise: 0, receivedDuePaise: 0, balancePaise: 0, walletPaise: 0 }; }
  private rows(response: any): any[] {
    const value = response?.data ?? response;
    if (Array.isArray(value)) return value;
    if (Array.isArray(value?.items)) return value.items;
    if (Array.isArray(value?.rows)) return value.rows;
    return [];
  }
  private messageFor(error: any): string { return error?.error?.message ?? error?.message ?? 'Unable to load invoice'; }
  private newIdempotencyKey(): string { return typeof globalThis.crypto?.randomUUID === 'function' ? globalThis.crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`; }
  private moneyInput(valuePaise: number): string { return valuePaise > 0 ? (valuePaise / 100).toFixed(2).replace(/\.00$/, '') : ''; }
  private inputPaise(value: string | undefined): number { const amount = Number(value); return Number.isFinite(amount) && amount > 0 ? Math.round(amount * 100) : 0; }
  private firstMoney(obj: any, keys: string[]): number { for (const key of keys) if (obj?.[key] !== undefined && obj?.[key] !== null && obj?.[key] !== '') return Math.round(Number(obj[key]) || 0); return 0; }
  private firstNumber(obj: any, keys: string[]): number { for (const key of keys) if (obj?.[key] !== undefined && obj?.[key] !== null && obj?.[key] !== '') return Number(obj[key]) || 0; return 0; }
}
