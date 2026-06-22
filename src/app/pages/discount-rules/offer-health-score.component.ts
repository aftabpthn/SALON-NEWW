import { CommonModule } from '@angular/common';
import { Component, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { forkJoin } from 'rxjs';
import { ApiRecord, ApiService } from '../../core/api.service';

type OfferHealthRow = ApiRecord & {
  offerKey: string;
  title: string;
  offerType: string;
  status: string;
  lifecycleStage: string;
  applications: number;
  netRevenuePaise: number;
  totalDiscountPaise: number;
  returnOnDiscountPercent: number;
  marginPercent: number;
  returnRatePercent: number;
  budgetBlockedCount: number;
  marginBlockedCount: number;
  autoSunsetAction: string;
  healthScore: number;
  healthStatus: string;
  recommendation: string;
  components: ApiRecord;
};

@Component({
  selector: 'app-offer-health-score',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './offer-health-score.component.html',
  styleUrls: ['./offer-health-score.component.css']
})
export class OfferHealthScoreComponent implements OnInit {
  readonly loading = signal(false);
  readonly error = signal('');
  readonly summary = signal<ApiRecord | null>(null);
  readonly offers = signal<OfferHealthRow[]>([]);
  readonly healthy = signal<OfferHealthRow[]>([]);
  readonly watchlist = signal<OfferHealthRow[]>([]);
  readonly inactive = signal<OfferHealthRow[]>([]);

  filters = {
    from: '',
    to: '',
    healthStatus: '',
    offerType: '',
    returnWindowDays: 30
  };

  readonly statuses = [
    { value: '', label: 'All health' },
    { value: 'healthy', label: 'Healthy' },
    { value: 'monitor', label: 'Monitor' },
    { value: 'at_risk', label: 'At risk' },
    { value: 'inactive', label: 'Inactive' },
    { value: 'no_data', label: 'No data' }
  ];

  readonly offerTypes = [
    { value: '', label: 'All offers' },
    { value: 'rule', label: 'Rules' },
    { value: 'coupon', label: 'Coupons' },
    { value: 'unattributed', label: 'Unattributed' }
  ];

  constructor(private readonly api: ApiService) {}

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.error.set('');
    const params = this.params();
    forkJoin({
      summary: this.api.list<ApiRecord>('happy-hours-offer-health/summary', params),
      offers: this.api.list<{ rows: OfferHealthRow[] }>('happy-hours-offer-health/offers', params)
    }).subscribe({
      next: (result) => {
        this.summary.set(result.summary.summary || {});
        this.healthy.set(result.summary.healthy || []);
        this.watchlist.set(result.summary.watchlist || []);
        this.inactive.set(result.summary.inactive || []);
        this.offers.set(result.offers.rows || []);
        this.loading.set(false);
      },
      error: (error) => {
        this.error.set(this.api.errorText(error, 'Unable to load Offer Health Score'));
        this.loading.set(false);
      }
    });
  }

  exportCsv(): void {
    const headers = [
      'offerKey',
      'title',
      'offerType',
      'healthScore',
      'healthStatus',
      'applications',
      'netRevenuePaise',
      'totalDiscountPaise',
      'returnOnDiscountPercent',
      'marginPercent',
      'returnRatePercent',
      'budgetBlockedCount',
      'marginBlockedCount',
      'autoSunsetAction',
      'recommendation'
    ];
    const lines = [
      headers.join(','),
      ...this.offers().map((row) => headers.map((key) => this.csvValue(row, key)).join(','))
    ];
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'happy-hours-offer-health-score.csv';
    link.click();
    URL.revokeObjectURL(url);
  }

  formatMoney(value: unknown): string {
    return `Rs ${(Math.round(Number(value || 0)) / 100).toLocaleString('en-IN')}`;
  }

  pct(value: unknown): string {
    return `${Number(value || 0).toFixed(1)}%`;
  }

  label(value: unknown): string {
    return String(value || '').replace(/_/g, ' ');
  }

  healthClass(value: unknown): string {
    return `health-pill health-${String(value || 'no_data').replace(/[^a-z0-9_-]/gi, '_').toLowerCase()}`;
  }

  componentWidth(value: unknown): string {
    return `${Math.max(0, Math.min(25, Number(value || 0))) * 4}%`;
  }

  private params(): ApiRecord {
    return {
      from: this.filters.from,
      to: this.filters.to,
      healthStatus: this.filters.healthStatus,
      offerType: this.filters.offerType,
      returnWindowDays: this.filters.returnWindowDays
    };
  }

  private csvValue(row: OfferHealthRow, key: string): string {
    return `"${String(row[key] ?? '').replace(/"/g, '""')}"`;
  }
}
