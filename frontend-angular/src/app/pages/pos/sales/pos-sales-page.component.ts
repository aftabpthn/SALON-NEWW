import { CommonModule } from '@angular/common';
import { Component, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { ApiService } from '../../../shared/services/api.service';
import { printInvoiceDocument } from '../../../shared/utils/safe-invoice-print';

interface PaymentMode { code: string; label: string; }
interface SaleRow {
  id: string;
  invoiceNumber: string;
  clientName: string;
  clientPhone: string;
  status: string;
  businessDate: string;
  lineCount: number;
  subtotalPaise: number;
  discountPaise: number;
  gstPaise: number;
  totalPaise: number;
  paidPaise: number;
  balancePaise: number;
  cashPaise: number;
  upiPaise: number;
  cardPaise: number;
  walletPaise: number;
  giftCardPaise: number;
  storeCreditPaise: number;
}
interface RegisterTotals extends Omit<SaleRow, 'id' | 'invoiceNumber' | 'clientName' | 'clientPhone' | 'status' | 'businessDate' | 'lineCount'> { totalRows: number; }

@Component({
  selector: 'app-pos-sales-page',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './pos-sales-page.component.html',
  styleUrls: ['./pos-sales-page.component.css'],
})
export class PosSalesPageComponent implements OnInit {
  sales: SaleRow[] = [];
  selectedSale: any | null = null;
  paymentMethods: PaymentMode[] = [];
  totals: RegisterTotals = this.emptyTotals();
  filters = { q: '', status: '', paymentMethod: '', dateFrom: '', dateTo: '' };
  page = 1;
  pageSize = 25;
  loading = false;
  error = '';
  paymentAmount = '';
  paymentMethod = '';

  constructor(private readonly api: ApiService, private readonly router: Router, private readonly route: ActivatedRoute) {}

  ngOnInit(): void {
    this.filters.status = this.route.snapshot.queryParamMap.get('status') ?? '';
    this.loadPaymentMethods();
    this.loadSales();
  }

  get totalPages(): number { return Math.max(1, Math.ceil((this.totals.totalRows || this.sales.length) / this.pageSize)); }
  get canPrev(): boolean { return this.page > 1; }
  get canNext(): boolean { return this.page < this.totalPages; }

  loadSales(): void {
    this.loading = true;
    this.error = '';
    this.api.get<any>(`/api/v1/pos/sales-register?${this.queryString()}`).subscribe({
      next: (res: any) => {
        this.sales = this.list(res?.rows ?? res).map((row) => this.normalizeRow(row));
        this.totals = this.normalizeTotals(res?.totals ?? {}, this.sales.length);
        this.page = Number(res?.page ?? this.page) || this.page;
        this.pageSize = Number(res?.pageSize ?? res?.page_size ?? this.pageSize) || this.pageSize;
        this.loading = false;
      },
      error: (err: any) => {
        this.error = err?.error?.message ?? err?.message ?? 'Unable to load sales';
        this.sales = [];
        this.totals = this.emptyTotals();
        this.loading = false;
      },
    });
  }

  loadPaymentMethods(): void {
    this.api.get<any>('/api/v1/pos/payment-methods').subscribe({
      next: (res: any) => {
        const modes = this.list(res).map((m) => this.paymentMode(m)).filter(Boolean) as PaymentMode[];
        this.paymentMethods = modes;
        if (!this.paymentMethods.some((m) => m.code === this.paymentMethod)) this.paymentMethod = this.paymentMethods[0]?.code ?? '';
      },
      error: () => { this.paymentMethods = []; this.paymentMethod = ''; },
    });
  }

  applyFilters(): void { this.page = 1; this.loadSales(); }
  clearFilters(): void { this.filters = { q: '', status: '', paymentMethod: '', dateFrom: '', dateTo: '' }; this.page = 1; this.loadSales(); }
  prevPage(): void { if (this.canPrev) { this.page -= 1; this.loadSales(); } }
  nextPage(): void { if (this.canNext) { this.page += 1; this.loadSales(); } }

  openSale(row: SaleRow): void {
    this.api.get<any>(`/api/v1/pos/sales/${row.id}`).subscribe({
      next: (res: any) => (this.selectedSale = this.normalizeDetail(res?.sale ?? res)),
      error: () => (this.selectedSale = { ...row }),
    });
  }

  collectPayment(): void {
    const id = this.selectedSale?.id ?? this.selectedSale?.saleId ?? this.selectedSale?.sale_id;
    const amountPaise = this.toPaise(this.num(this.paymentAmount));
    if (!id || amountPaise <= 0 || !this.paymentMethod) return;
    this.api.post<any>(`/api/v1/pos/sales/${id}/payments`, { method: this.paymentMethod, amountPaise, amount_paise: amountPaise }).subscribe({
      next: () => {
        this.paymentAmount = '';
        this.loadSales();
        this.api.get<any>(`/api/v1/pos/sales/${id}`).subscribe({ next: (res: any) => (this.selectedSale = this.normalizeDetail(res?.sale ?? res)) });
      },
      error: (err: any) => (this.error = err?.error?.message ?? err?.message ?? 'Unable to collect payment'),
    });
  }

  printSale(row: SaleRow): void {
    this.api.get<any>(`/api/v1/pos/invoices/${row.id}/print`).subscribe({
      next: (res: any) => { if (!printInvoiceDocument(res?.data ?? res)) this.error = 'Print not available'; },
      error: () => (this.error = 'Print not available'),
    });
  }

  printSelectedSale(): void {
    const id = this.selectedSale?.id ?? this.selectedSale?.saleId ?? this.selectedSale?.sale_id;
    if (id) this.printSale({ ...this.emptyRow(), id });
  }

  resumeDraft(row: SaleRow): void { if (row.status === 'draft') this.router.navigate(['/pos'], { queryParams: { draft: row.id } }); }

  formatDate(value: string | null | undefined): string {
    const v = String(value ?? '').slice(0, 10);
    const p = v.split('-');
    return p.length === 3 ? `${p[2]}/${p[1]}/${p[0]}` : '-';
  }

  trackBySale(_: number, row: SaleRow): string { return row.id; }
  trackByPayment(_: number, method: PaymentMode): string { return method.code; }

  private queryString(): string {
    const p = new URLSearchParams();
    p.set('page', String(this.page));
    p.set('pageSize', String(this.pageSize));
    if (this.filters.q.trim()) p.set('q', this.filters.q.trim());
    if (this.filters.status) p.set('status', this.filters.status);
    if (this.filters.paymentMethod) p.set('paymentMethod', this.filters.paymentMethod);
    if (this.filters.dateFrom.trim()) p.set('dateFrom', this.displayDateToIso(this.filters.dateFrom));
    if (this.filters.dateTo.trim()) p.set('dateTo', this.displayDateToIso(this.filters.dateTo));
    return p.toString();
  }

  private normalizeRow(row: any): SaleRow {
    return {
      id: String(row?.id ?? row?.saleId ?? row?.sale_id ?? ''),
      invoiceNumber: String(row?.invoiceNumber ?? row?.invoice_number ?? row?.invoiceNo ?? row?.invoice_no ?? ''),
      clientName: String(row?.clientName ?? row?.client_name ?? 'Walk-in client'),
      clientPhone: String(row?.clientPhone ?? row?.client_phone ?? ''),
      status: String(row?.status ?? 'finalized'),
      businessDate: String(row?.businessDate ?? row?.business_date ?? row?.createdAt ?? row?.created_at ?? ''),
      lineCount: this.firstNumber(row, ['lineCount', 'line_count']),
      subtotalPaise: this.firstMoney(row, ['subtotalPaise', 'subtotal_paise']),
      discountPaise: this.firstMoney(row, ['discountPaise', 'discount_paise', 'billDiscountPaise', 'bill_discount_paise']),
      gstPaise: this.firstMoney(row, ['gstPaise', 'gst_paise', 'taxPaise', 'tax_paise']),
      totalPaise: this.firstMoney(row, ['totalPaise', 'total_paise', 'total']),
      paidPaise: this.firstMoney(row, ['paidPaise', 'paid_paise', 'paid']),
      balancePaise: this.firstMoney(row, ['balancePaise', 'balance_paise', 'balanceDuePaise', 'balance_due_paise']),
      cashPaise: this.firstMoney(row, ['cashPaise', 'cash_paise']),
      upiPaise: this.firstMoney(row, ['upiPaise', 'upi_paise']),
      cardPaise: this.firstMoney(row, ['cardPaise', 'card_paise']),
      walletPaise: this.firstMoney(row, ['walletPaise', 'wallet_paise']),
      giftCardPaise: this.firstMoney(row, ['giftCardPaise', 'gift_card_paise']),
      storeCreditPaise: this.firstMoney(row, ['storeCreditPaise', 'store_credit_paise']),
    };
  }

  private normalizeTotals(t: any, fallbackRows: number): RegisterTotals {
    return {
      totalRows: this.firstNumber(t, ['totalRows', 'total_rows', 'count']) || fallbackRows,
      subtotalPaise: this.firstMoney(t, ['subtotalPaise', 'subtotal_paise']),
      discountPaise: this.firstMoney(t, ['discountPaise', 'discount_paise']),
      gstPaise: this.firstMoney(t, ['gstPaise', 'gst_paise']),
      totalPaise: this.firstMoney(t, ['totalPaise', 'total_paise']),
      paidPaise: this.firstMoney(t, ['paidPaise', 'paid_paise']),
      balancePaise: this.firstMoney(t, ['balancePaise', 'balance_paise']),
      cashPaise: this.firstMoney(t, ['cashPaise', 'cash_paise']),
      upiPaise: this.firstMoney(t, ['upiPaise', 'upi_paise']),
      cardPaise: this.firstMoney(t, ['cardPaise', 'card_paise']),
      walletPaise: this.firstMoney(t, ['walletPaise', 'wallet_paise']),
      giftCardPaise: this.firstMoney(t, ['giftCardPaise', 'gift_card_paise']),
      storeCreditPaise: this.firstMoney(t, ['storeCreditPaise', 'store_credit_paise']),
    };
  }

  private normalizeDetail(s: any): any {
    return {
      ...s,
      id: this.firstNumber(s, ['id', 'saleId', 'sale_id']),
      invoiceNumber: s?.invoiceNumber ?? s?.invoice_number ?? '',
      clientName: s?.clientName ?? s?.client_name ?? '',
      totalPaise: this.firstMoney(s, ['totalPaise', 'total_paise']),
      paidPaise: this.firstMoney(s, ['paidPaise', 'paid_paise']),
      balancePaise: this.firstMoney(s, ['balancePaise', 'balance_paise']),
      lines: s?.lines ?? [],
      payments: s?.payments ?? s?.paymentSplit ?? s?.payment_split ?? [],
    };
  }

  private paymentMode(mode: any): PaymentMode | null {
    const raw = String(mode?.code ?? mode?.method ?? mode?.key ?? mode?.name ?? '').trim();
    if (!raw) return null;
    const code = raw.replace(/([a-z])([A-Z])/g, '$1_$2').toLowerCase().replace(/\s+/g, '_');
    return { code, label: String(mode?.label ?? mode?.name ?? this.labelFor(code)) };
  }

  private emptyTotals(): RegisterTotals { return { totalRows: 0, subtotalPaise: 0, discountPaise: 0, gstPaise: 0, totalPaise: 0, paidPaise: 0, balancePaise: 0, cashPaise: 0, upiPaise: 0, cardPaise: 0, walletPaise: 0, giftCardPaise: 0, storeCreditPaise: 0 }; }
  private emptyRow(): SaleRow { return { id: '', invoiceNumber: '', clientName: '', clientPhone: '', status: '', businessDate: '', lineCount: 0, subtotalPaise: 0, discountPaise: 0, gstPaise: 0, totalPaise: 0, paidPaise: 0, balancePaise: 0, cashPaise: 0, upiPaise: 0, cardPaise: 0, walletPaise: 0, giftCardPaise: 0, storeCreditPaise: 0 }; }
  private list(res: any): any[] { if (Array.isArray(res)) return res; for (const key of ['rows', 'items', 'data', 'paymentMethods', 'payment_methods']) if (Array.isArray(res?.[key])) return res[key]; return []; }
  private labelFor(code: string): string { return code.split('_').map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join(' '); }
  private displayDateToIso(value: string): string { const p = value.trim().split('/'); return p.length === 3 ? `${p[2]}-${p[1].padStart(2, '0')}-${p[0].padStart(2, '0')}` : value.trim(); }
  private firstMoney(obj: any, keys: string[]): number { for (const k of keys) if (obj?.[k] !== undefined && obj?.[k] !== null && obj?.[k] !== '') return Math.round(Number(obj[k]) || 0); return 0; }
  private firstNumber(obj: any, keys: string[]): number { for (const k of keys) if (obj?.[k] !== undefined && obj?.[k] !== null && obj?.[k] !== '') return Number(obj[k]) || 0; return 0; }
  private num(value: unknown): number { return value === null || value === undefined || value === '' ? 0 : Number(value) || 0; }
  private toPaise(value: number): number { return Math.round((Number(value) || 0) * 100); }
}
