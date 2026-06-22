import { CommonModule } from '@angular/common';
import { Component, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { forkJoin } from 'rxjs';
import { ApiRecord, ApiService } from '../../core/api.service';

type RoiOffer = ApiRecord & {
  offerKey: string;
  title: string;
  offerType: string;
  applications: number;
  grossRevenuePaise: number;
  netRevenuePaise: number;
  totalDiscountPaise: number;
  returnOnDiscountPercent: number;
  marginPercent: number;
  repeatRatePercent: number;
  budgetBlockedCount: number;
  marginBlockedCount: number;
  campaignDrafts: number;
  roiScore: ApiRecord & {
    score: number;
    grade: string;
    recommendation: string;
    components: ApiRecord;
  };
};

@Component({
  selector: 'app-offer-roi-score',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './offer-roi-score.component.html',
  styleUrls: ['./offer-roi-score.component.css']
})
export class OfferRoiScoreComponent implements OnInit {
  readonly loading = signal(false);
  readonly error = signal('');
  readonly summary = signal<ApiRecord | null>(null);
  readonly offers = signal<RoiOffer[]>([]);
  readonly topOffers = signal<RoiOffer[]>([]);
  readonly watchlist = signal<RoiOffer[]>([]);
  readonly noData = signal<RoiOffer[]>([]);

  filters = {
    from: '',
    to: '',
    grade: '',
    offerType: ''
  };

  readonly grades = [
    { value: '', label: 'All grades' },
    { value: 'excellent', label: 'Excellent' },
    { value: 'good', label: 'Good' },
    { value: 'watch', label: 'Watch' },
    { value: 'poor', label: 'Poor' },
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
      summary: this.api.list<ApiRecord>('happy-hours-roi-score/summary', params),
      offers: this.api.list<{ rows: RoiOffer[] }>('happy-hours-roi-score/offers', params)
    }).subscribe({
      next: (result) => {
        this.summary.set(result.summary.summary || {});
        this.topOffers.set(result.summary.topOffers || []);
        this.watchlist.set(result.summary.watchlist || []);
        this.noData.set(result.summary.noData || []);
        this.offers.set(result.offers.rows || []);
        this.loading.set(false);
      },
      error: (error) => {
        this.error.set(this.errorText(error, 'Unable to load Offer ROI Score'));
        this.loading.set(false);
      }
    });
  }

  exportCsv(): void {
    const headers = [
      'offerKey',
      'title',
      'offerType',
      'score',
      'grade',
      'applications',
      'grossRevenuePaise',
      'netRevenuePaise',
      'totalDiscountPaise',
      'returnOnDiscountPercent',
      'marginPercent',
      'repeatRatePercent',
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
    link.download = 'happy-hours-offer-roi-score.csv';
    link.click();
    URL.revokeObjectURL(url);
  }

  formatMoney(value: unknown): string {
    return `Rs ${(Math.round(Number(value || 0)) / 100).toLocaleString('en-IN')}`;
  }

  pct(value: unknown): string {
    return `${Number(value || 0).toFixed(1)}%`;
  }

  gradeLabel(value: unknown): string {
    return String(value || 'no_data').replace(/_/g, ' ');
  }

  scoreClass(value: unknown): string {
    const grade = String(value || '').toLowerCase();
    if (grade === 'excellent') return 'score-excellent';
    if (grade === 'good') return 'score-good';
    if (grade === 'watch') return 'score-watch';
    if (grade === 'poor') return 'score-poor';
    return 'score-no-data';
  }

  private params(): ApiRecord {
    return {
      from: this.filters.from,
      to: this.filters.to,
      grade: this.filters.grade,
      offerType: this.filters.offerType
    };
  }

  private csvValue(row: RoiOffer, key: string): string {
    const value = key === 'score'
      ? row.roiScore?.score
      : key === 'grade'
        ? row.roiScore?.grade
        : key === 'recommendation'
          ? row.roiScore?.recommendation
          : row[key];
    return `"${String(value ?? '').replace(/"/g, '""')}"`;
  }

  private errorText(error: unknown, fallback: string): string {
    const err = error as { error?: { error?: string; message?: string }; message?: string };
    return err?.error?.error || err?.error?.message || err?.message || fallback;
  }
}
