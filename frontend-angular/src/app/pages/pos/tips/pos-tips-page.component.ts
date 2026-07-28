
import { Component, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { forkJoin, of } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { ApiService } from '../../../shared/services/api.service';

interface TipRow {
  id: string;
  invoiceNumber: string;
  clientName: string;
  clientPhone: string;
  staffName: string;
  businessDate: string;
  tipPaise: number;
  cashTipPaise: number;
  digitalTipPaise: number;
  paymentMode: string;
  paymentBreakdown: string;
  payoutStatus: 'paid' | 'pending';
  payoutId: string;
  status: string;
}

@Component({
    selector: 'app-pos-tips-page',
    imports: [FormsModule, RouterLink],
    templateUrl: './pos-tips-page.component.html',
    styleUrls: ['./pos-tips-page.component.css']
})
export class PosTipsPageComponent implements OnInit {
  tips: TipRow[] = [];
  selected: TipRow | null = null;
  search = '';
  paymentMode = '';
  payoutStatus = '';
  error = '';

  constructor(private readonly api: ApiService) {}
  ngOnInit(): void { this.load(); }

  get modes(): string[] { return [...new Set(this.tips.map((tip) => tip.paymentMode).filter(Boolean))]; }
  get filtered(): TipRow[] {
    const term = this.search.trim().toLowerCase();
    return this.tips.filter((tip) => (!this.paymentMode || tip.paymentMode === this.paymentMode) && (!this.payoutStatus || tip.payoutStatus === this.payoutStatus) && (!term || `${tip.clientName} ${tip.clientPhone} ${tip.staffName} ${tip.invoiceNumber}`.toLowerCase().includes(term)));
  }
  get totalPaise(): number { return this.filtered.reduce((sum, tip) => sum + tip.tipPaise, 0); }
  get paidPaise(): number { return this.filtered.filter((tip) => tip.payoutStatus === 'paid').reduce((sum, tip) => sum + tip.tipPaise, 0); }
  get cashPaise(): number { return this.filtered.reduce((sum, tip) => sum + tip.cashTipPaise, 0); }
  get digitalPaise(): number { return this.filtered.reduce((sum, tip) => sum + tip.digitalTipPaise, 0); }

  load(): void {
    this.error = '';
    forkJoin({
      register: this.api.get<any>('/api/v1/pos/sales-register?page=1&pageSize=100'),
      payouts: this.api.get<any>('/api/v1/staff/tips?periodStart=1970-01-01&periodEnd=2999-12-31').pipe(catchError(() => of({ data: [] }))),
    }).subscribe({
      next: ({ register, payouts }) => {
        const payoutBySale = new Map(this.rows(payouts).map((row) => [String(row.saleId ?? row.sale_id ?? ''), String(row.payoutId ?? row.payout_id ?? '')]));
        this.tips = this.rows(register).map((row) => this.mapTip(row, payoutBySale.get(String(row.id ?? row.saleId ?? row.sale_id ?? '')) ?? '')).filter((tip) => tip.tipPaise > 0);
        this.selected = this.tips.find((tip) => tip.id === this.selected?.id) ?? this.tips[0] ?? null;
      },
      error: (error: any) => this.error = error?.error?.message ?? 'Unable to load tips',
    });
  }

  select(tip: TipRow): void { this.selected = tip; }
  money(value: number): string { return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(value / 100); }
  dateTime(value: string): string { const date = new Date(value); return Number.isNaN(date.getTime()) ? '-' : new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(date); }
  paymentClass(tip: TipRow): string { return tip.paymentMode.toLowerCase().replace(/[^a-z]+/g, '') || 'other'; }
  trackById(_: number, tip: TipRow): string { return tip.id; }

  private rows(response: any): any[] { return Array.isArray(response) ? response : response?.rows ?? response?.data?.rows ?? response?.data ?? []; }
  private mapTip(row: any, payoutId: string): TipRow {
    const split = this.paymentSplit(row);
    return {
      id: String(row.id ?? row.saleId ?? row.sale_id ?? ''),
      invoiceNumber: String(row.invoiceNumber ?? row.invoice_number ?? row.id ?? ''),
      clientName: String(row.clientName ?? row.client_name ?? 'Walk-in client'),
      clientPhone: String(row.clientPhone ?? row.client_phone ?? row.phone ?? ''),
      staffName: String(row.staffName ?? row.staff_name ?? row.staff ?? ''),
      businessDate: String(row.businessDate ?? row.business_date ?? row.finalizedAt ?? row.finalized_at ?? row.createdAt ?? row.created_at ?? ''),
      tipPaise: Number(row.tipPaise ?? row.tip_paise ?? row.tip ?? 0),
      cashTipPaise: this.allocateTip(Number(row.tipPaise ?? row.tip_paise ?? row.tip ?? 0), split.cash, split.total),
      digitalTipPaise: this.allocateTip(Number(row.tipPaise ?? row.tip_paise ?? row.tip ?? 0), split.digital, split.total),
      paymentMode: String(row.paymentMode ?? row.payment_mode ?? row.method ?? '').trim() || split.label || 'Unspecified',
      paymentBreakdown: split.detail || 'No payment split',
      payoutStatus: payoutId ? 'paid' : 'pending',
      payoutId,
      status: String(row.status ?? 'finalized'),
    };
  }

  private paymentSplit(row: any): { cash: number; digital: number; total: number; label: string; detail: string } {
    const parts = [
      ['Cash', this.firstMoney(row, ['cashPaise', 'cash_paise'])],
      ['UPI', this.firstMoney(row, ['upiPaise', 'upi_paise'])],
      ['Card', this.firstMoney(row, ['cardPaise', 'card_paise'])],
      ['Wallet', this.firstMoney(row, ['walletPaise', 'wallet_paise'])],
      ['Gift card', this.firstMoney(row, ['giftCardPaise', 'gift_card_paise'])],
      ['Store credit', this.firstMoney(row, ['storeCreditPaise', 'store_credit_paise'])],
      ['Other', this.firstMoney(row, ['otherPaise', 'other_paise'])],
    ].filter(([, amount]) => Number(amount) > 0) as [string, number][];
    const cash = parts.filter(([label]) => label === 'Cash').reduce((sum, [, amount]) => sum + amount, 0);
    const total = parts.reduce((sum, [, amount]) => sum + amount, 0);
    return { cash, digital: total - cash, total, label: parts.map(([label]) => label).join(' + '), detail: parts.map(([label, amount]) => `${label} ${this.money(amount)}`).join(', ') };
  }

  private allocateTip(tip: number, amount: number, total: number): number { return total > 0 ? Math.round((tip * amount) / total) : 0; }
  private firstMoney(row: any, keys: string[]): number {
    for (const key of keys) {
      const value = Number(row?.[key]);
      if (Number.isFinite(value)) return value;
    }
    return 0;
  }
}
