import { CommonModule } from '@angular/common';
import { Component, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ApiService } from '../../../shared/services/api.service';
import { downloadInvoiceDocument, printInvoiceDocument } from '../../../shared/utils/safe-invoice-print';

interface InvoiceRow {
  id: string;
  invoiceNumber: string;
  clientName: string;
  clientPhone: string;
  staffName: string;
  businessDate: string;
  status: string;
  paymentMode: string;
  totalPaise: number;
  paidPaise: number;
  balancePaise: number;
}

interface InvoiceTotals {
  totalRows: number;
  totalPaise: number;
  paidPaise: number;
  receivedDuePaise: number;
  balancePaise: number;
  walletPaise: number;
}

interface InvoiceAction { id: string; action: string; recipient: string; createdAt: string; }
interface LedgerVerification { valid: boolean; events: number; headHash: string; failedAt: number | null; }
interface PaymentLink { id: string; provider: string; amountPaise: number; status: string; url: string; expiresAt?: string; }
interface PaymentReconciliation { paymentLinkId: string; providerStatus: string; providerAmountPaidPaise: number; requiresSignedWebhook: boolean; }

interface InvoiceLine {
  id: string;
  lineType: string;
  itemName: string;
  quantity: number;
  lineTotalPaise: number;
  staffId?: string;
}

interface InvoiceClientKpi {
  membershipName: string;
  membershipExpiresAt?: string;
  membershipCredits: Array<{ id: string; membershipName: string; serviceName: string; pendingQty: number }>;
  packageCredits: Array<{ id: string; packageName: string; serviceName: string; pendingQty: number }>;
}

interface ReturnLine extends InvoiceLine {
  returnQuantity: number | null;
}

@Component({
  selector: 'app-pos-invoices-page',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './pos-invoices-page.component.html',
  styleUrls: ['./pos-invoices-page.component.css'],
})
export class PosInvoicesPageComponent implements OnInit {
  invoices: InvoiceRow[] = [];
  totals: InvoiceTotals = this.emptyTotals();
  selected: InvoiceRow | null = null;
  history: InvoiceAction[] = [];
  invoiceLines: InvoiceLine[] = [];
  clientKpi: InvoiceClientKpi | null = null;
  detailsLoading = false;
  returnLines: ReturnLine[] = [];
  recipient = '';
  returnDrawerOpen = false;
  returnReason = '';
  restockProducts = false;
  returnIdempotencyKey = '';
  returnLoading = false;
  voidDrawerOpen = false;
  voidReason = '';
  voidIdempotencyKey = '';
  voidLoading = false;
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
  paymentLinkIdempotencyKey = '';
  paymentLinkLoading = false;
  reconcilingPaymentLinkId = '';
  paymentReconciliation: PaymentReconciliation | null = null;
  error = '';
  message = '';

  constructor(private readonly api: ApiService) {}
  ngOnInit(): void { this.load(); }

  load(afterLoad?: () => void): void {
    this.error = '';
    this.api.get<any>('/api/v1/pos/sales-register?page=1&pageSize=100').subscribe({
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

  select(invoice: InvoiceRow): void {
    this.selected = invoice;
    this.recipient = '';
    this.history = [];
    this.invoiceLines = [];
    this.clientKpi = null;
    this.detailsLoading = true;
    this.closeReturnDrawer();
    this.closeVoidDrawer();
    this.closeCreditNoteDrawer();
    this.ledgerVerification = null;
    this.paymentLinks = [];
    this.paymentReconciliation = null;
    this.loadPaymentLinks(invoice.id);
    this.api.get<any>(`/api/v1/pos/invoices/${invoice.id}`).subscribe({
      next: (res) => {
        const data = res?.data ?? res;
        this.invoiceLines = this.rows(data?.lines).map((line) => ({
          id: String(line.id ?? ''), lineType: String(line.lineType ?? line.line_type ?? ''), itemName: String(line.itemName ?? line.item_name ?? ''),
          quantity: this.firstNumber(line, ['quantity']), lineTotalPaise: this.firstMoney(line, ['lineTotalPaise', 'line_total_paise']), staffId: String(line.staffId ?? line.staff_id ?? ''),
        }));
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
    this.api.get<any>(`/api/v1/pos/invoices/${invoice.id}/history`).subscribe({
      next: (res) => this.history = this.rows(res).map((row) => ({ id: String(row.id), action: String(row.action), recipient: String(row.recipient ?? ''), createdAt: String(row.createdAt ?? row.created_at ?? '') })),
      error: (err: any) => this.error = this.messageFor(err),
    });
  }

  print(): void { this.withAction('print', () => this.api.get<any>(`/api/v1/pos/invoices/${this.selected!.id}/print`).subscribe({ next: (res) => { if (!printInvoiceDocument(res?.data ?? res)) this.error = 'Print not available'; }, error: (err: any) => this.error = this.messageFor(err) })); }
  download(): void { this.withAction('download', () => this.api.get<any>(`/api/v1/pos/invoices/${this.selected!.id}/basic`).subscribe({ next: (res) => downloadInvoiceDocument(res?.data ?? res, this.selected?.invoiceNumber || this.selected?.id || 'invoice'), error: (err: any) => this.error = this.messageFor(err) })); }
  requestResend(): void { if (!this.recipient.trim()) { this.error = 'Recipient is required'; return; } this.withAction('resend', () => this.message = 'Resend request recorded'); }

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

  openReturnDrawer(): void {
    if (!this.selected || !this.canReturn(this.selected)) return;
    this.error = '';
    this.returnLoading = true;
    this.api.get<any>(`/api/v1/pos/invoices/${this.selected.id}`).subscribe({
      next: (res) => {
        const data = res?.data ?? res;
        this.returnLines = this.rows(data?.lines).map((line) => ({
          id: String(line.id ?? ''),
          lineType: String(line.lineType ?? line.line_type ?? ''),
          itemName: String(line.itemName ?? line.item_name ?? ''),
          quantity: this.firstNumber(line, ['quantity']),
          lineTotalPaise: this.firstMoney(line, ['lineTotalPaise', 'line_total_paise']),
          returnQuantity: null,
        })).filter((line) => line.id && line.quantity > 0);
        this.returnReason = '';
        this.restockProducts = false;
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
    this.restockProducts = false;
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
      .map((line) => ({ saleLineId: line.id, quantity: Number(line.returnQuantity) }));
    if (!reason) { this.error = 'Return reason is required'; return; }
    if (!lines.length) { this.error = 'Select at least one item to return'; return; }
    if (lines.some((line) => !Number.isInteger(line.quantity) || line.quantity < 1)) { this.error = 'Return quantity must be a whole number'; return; }
    if (this.returnLines.some((line) => (Number(line.returnQuantity) || 0) > line.quantity)) { this.error = 'Return quantity cannot exceed sold quantity'; return; }

    this.error = '';
    this.returnLoading = true;
    this.api.post<any>(`/api/v1/pos/invoices/${this.selected.id}/refund`, {
      reason,
      idempotencyKey: this.returnIdempotencyKey || this.newIdempotencyKey(),
      restock: this.restockProducts,
      lines,
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

  formatDate(value: string): string {
    const v = String(value ?? '').slice(0, 10);
    const p = v.split('-');
    return p.length === 3 ? `${p[2]}/${p[1]}/${p[0]}` : '-';
  }

  money(value: number): string { return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format((value || 0) / 100); }
  paymentSummary(row: InvoiceRow): string { return row.paymentMode ? row.paymentMode : row.paidPaise > 0 ? 'Paid' : 'Unpaid'; }
  trackByInvoice(_: number, row: InvoiceRow): string { return row.id; }
  trackByHistory(_: number, row: InvoiceAction): string { return row.id; }
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
      clientName: String(row.clientName ?? row.client_name ?? 'Walk-in client'),
      clientPhone: String(row.clientPhone ?? row.client_phone ?? row.phone ?? ''),
      staffName: String(row.staffName ?? row.staff_name ?? row.staff ?? ''),
      businessDate: String(row.businessDate ?? row.business_date ?? row.createdAt ?? row.created_at ?? ''),
      status: String(row.status ?? 'finalized'),
      paymentMode: String(row.paymentMode ?? row.payment_mode ?? row.method ?? ''),
      totalPaise: this.firstMoney(row, ['totalPaise', 'total_paise', 'total']),
      paidPaise: this.firstMoney(row, ['paidPaise', 'paid_paise', 'paid']),
      balancePaise: this.firstMoney(row, ['balancePaise', 'balance_paise', 'balanceDuePaise', 'balance_due_paise', 'duePaise', 'due_paise']),
    };
  }

  private loadPaymentLinks(invoiceId: string): void {
    this.api.get<any>(`/api/v1/pos/invoices/${invoiceId}/payment-links`).subscribe({
      next: (res) => this.paymentLinks = this.rows(res).map((row) => this.paymentLink(row)),
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
      receivedDuePaise: this.firstMoney(raw, ['receivedDuePaise', 'received_due_paise', 'dueReceivedPaise', 'due_received_paise']) || paidPaise,
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
  private firstMoney(obj: any, keys: string[]): number { for (const key of keys) if (obj?.[key] !== undefined && obj?.[key] !== null && obj?.[key] !== '') return Math.round(Number(obj[key]) || 0); return 0; }
  private firstNumber(obj: any, keys: string[]): number { for (const key of keys) if (obj?.[key] !== undefined && obj?.[key] !== null && obj?.[key] !== '') return Number(obj[key]) || 0; return 0; }
}
