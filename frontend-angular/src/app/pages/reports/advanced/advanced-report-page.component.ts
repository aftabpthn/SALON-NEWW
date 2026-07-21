import { CommonModule, CurrencyPipe } from '@angular/common';
import { Component, OnInit, inject } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { DatePickerComponent } from '../../../shared/date-picker/date-picker.component';
import { ApiService } from '../../../shared/services/api.service';

type Summary = Record<string, number>;
@Component({ selector: 'app-advanced-report', standalone: true, imports: [CommonModule, CurrencyPipe, RouterLink, DatePickerComponent], templateUrl: './advanced-report-page.component.html', styleUrls: ['./advanced-report-page.component.css'] })
export class AdvancedReportPageComponent implements OnInit {
  private readonly api = inject(ApiService); private readonly route = inject(ActivatedRoute); fromDate = this.date(-29); toDate = this.date(0); summary: Summary | null = null; loading = false; error = ''; report = '';
  ngOnInit(): void { this.report = this.route.snapshot.queryParamMap.get('report') ?? ''; this.load(); }
  get title(): string { return ({ 'financial-summary': 'Financial Summary', 'daily-revenue': 'Daily Revenue', 'daily-sheet': 'Daily Sheet', 'deleted-invoices': 'Deleted Invoices', 'gst-summary': 'GST Summary', 'discount-summary': 'Sales Discount', 'staff-sales': 'Staff Sales', 'wallet-ledger': 'Wallet Ledger', 'rewards-loyalty': 'Rewards & Loyalty', 'membership-sales': 'Membership Sales', 'package-sales': 'Package Sales', 'tips-payout': 'Tips & Payout', 'message-history': 'Message History' } as Record<string, string>)[this.report] ?? 'Advanced Business Report'; }
  load(): void { this.loading = true; this.error = ''; this.api.get<any>(`/api/v1/reports/advanced-summary?startDate=${this.fromDate}&endDate=${this.toDate}`).subscribe({ next: r => { this.summary = r?.data ?? r; this.loading = false; }, error: e => { this.error = e?.error?.error?.message ?? 'Unable to load report'; this.loading = false; } }); }
  money(key: string): number { return Number(this.summary?.[key] ?? 0) / 100; }
  private date(offset: number): string { const d = new Date(); d.setDate(d.getDate() + offset); return d.toISOString().slice(0, 10); }
}
