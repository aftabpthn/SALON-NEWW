import { CommonModule } from '@angular/common';
import { Component, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ApiService } from '../../../shared/services/api.service';

interface TipRow {
  id: string;
  invoiceNumber: string;
  clientName: string;
  clientPhone: string;
  staffName: string;
  businessDate: string;
  tipPaise: number;
  paymentMode: string;
  status: string;
}

@Component({
  selector: 'app-pos-tips-page',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './pos-tips-page.component.html',
  styleUrls: ['./pos-tips-page.component.css'],
})
export class PosTipsPageComponent implements OnInit {
  tips: TipRow[] = [];
  selected: TipRow | null = null;
  search = '';
  paymentMode = '';
  error = '';

  constructor(private readonly api: ApiService) {}
  ngOnInit(): void { this.load(); }

  get modes(): string[] { return [...new Set(this.tips.map((tip) => tip.paymentMode).filter(Boolean))]; }
  get filtered(): TipRow[] {
    const term = this.search.trim().toLowerCase();
    return this.tips.filter((tip) => (!this.paymentMode || tip.paymentMode === this.paymentMode) && (!term || `${tip.clientName} ${tip.clientPhone} ${tip.staffName} ${tip.invoiceNumber}`.toLowerCase().includes(term)));
  }
  get totalPaise(): number { return this.filtered.reduce((sum, tip) => sum + tip.tipPaise, 0); }
  get cashPaise(): number { return this.filtered.filter((tip) => tip.paymentMode.toLowerCase() === 'cash').reduce((sum, tip) => sum + tip.tipPaise, 0); }
  get digitalPaise(): number { return this.totalPaise - this.cashPaise; }
  get staffPaid(): number { return new Set(this.filtered.map((tip) => tip.staffName).filter(Boolean)).size; }

  load(): void {
    this.error = '';
    this.api.get<any>('/api/v1/pos/sales-register?page=1&pageSize=100').subscribe({
      next: (response) => {
        this.tips = this.rows(response).map((row) => this.mapTip(row)).filter((tip) => tip.tipPaise > 0);
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
  private mapTip(row: any): TipRow {
    return {
      id: String(row.id ?? row.saleId ?? row.sale_id ?? ''),
      invoiceNumber: String(row.invoiceNumber ?? row.invoice_number ?? row.id ?? ''),
      clientName: String(row.clientName ?? row.client_name ?? 'Walk-in client'),
      clientPhone: String(row.clientPhone ?? row.client_phone ?? row.phone ?? ''),
      staffName: String(row.staffName ?? row.staff_name ?? row.staff ?? ''),
      businessDate: String(row.businessDate ?? row.business_date ?? row.finalizedAt ?? row.finalized_at ?? row.createdAt ?? row.created_at ?? ''),
      tipPaise: Number(row.tipPaise ?? row.tip_paise ?? row.tip ?? 0),
      paymentMode: String(row.paymentMode ?? row.payment_mode ?? row.method ?? 'Unspecified'),
      status: String(row.status ?? 'finalized'),
    };
  }
}
