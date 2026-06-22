import { CommonModule } from '@angular/common';
import { Component, OnInit, computed, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { forkJoin } from 'rxjs';
import { ApiRecord, ApiService } from '../../core/api.service';

type BranchLeaderboardRow = ApiRecord & {
  rank: number;
  branchId: string;
  branchName: string;
  regionId: string;
  regionName: string;
  applications: number;
  uniqueClients: number;
  repeatClients: number;
  netRevenuePaise: number;
  totalDiscountPaise: number;
  grossMarginPaise: number;
  returnOnDiscountPercent: number;
  discountRatePercent: number;
  marginPercent: number;
  repeatRatePercent: number;
  activeOffers: number;
  guardrailHits: number;
  leaderboardScore: number;
  leaderboardGrade: string;
  topOffer: ApiRecord;
  recommendation: string;
};

@Component({
  selector: 'app-branch-offer-leaderboard',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './branch-offer-leaderboard.component.html',
  styleUrls: ['./branch-offer-leaderboard.component.css']
})
export class BranchOfferLeaderboardComponent implements OnInit {
  readonly loading = signal(false);
  readonly error = signal('');
  readonly summary = signal<ApiRecord | null>(null);
  readonly rows = signal<BranchLeaderboardRow[]>([]);
  readonly topBranches = signal<BranchLeaderboardRow[]>([]);
  readonly watchlist = signal<BranchLeaderboardRow[]>([]);
  readonly noData = signal<BranchLeaderboardRow[]>([]);
  readonly regionOptions = computed(() => {
    const map = new Map<string, string>();
    for (const row of this.rows()) {
      if (row.regionId) map.set(row.regionId, row.regionName || row.regionId);
    }
    return [...map.entries()].map(([id, name]) => ({ id, name })).sort((left, right) => left.name.localeCompare(right.name));
  });

  filters = {
    from: '',
    to: '',
    regionId: '',
    sort: 'score'
  };

  readonly sortOptions = [
    { value: 'score', label: 'Score' },
    { value: 'revenue', label: 'Revenue' },
    { value: 'margin', label: 'Margin' },
    { value: 'repeat', label: 'Repeat' },
    { value: 'guardrails', label: 'Lowest guardrails' }
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
      summary: this.api.list<ApiRecord>('happy-hours-branch-leaderboard/summary', params),
      leaderboard: this.api.list<{ rows: BranchLeaderboardRow[] }>('happy-hours-branch-leaderboard', params)
    }).subscribe({
      next: (result) => {
        this.summary.set(result.summary.summary || {});
        this.topBranches.set(result.summary.topBranches || []);
        this.watchlist.set(result.summary.watchlist || []);
        this.noData.set(result.summary.noData || []);
        this.rows.set(result.leaderboard.rows || []);
        this.loading.set(false);
      },
      error: (error) => {
        this.error.set(this.api.errorText(error, 'Unable to load Branch Offer Leaderboard'));
        this.loading.set(false);
      }
    });
  }

  exportCsv(): void {
    const headers = [
      'rank',
      'branchId',
      'branchName',
      'regionName',
      'leaderboardScore',
      'leaderboardGrade',
      'applications',
      'uniqueClients',
      'netRevenuePaise',
      'totalDiscountPaise',
      'returnOnDiscountPercent',
      'marginPercent',
      'repeatRatePercent',
      'activeOffers',
      'guardrailHits',
      'topOffer',
      'recommendation'
    ];
    const lines = [
      headers.join(','),
      ...this.rows().map((row) => headers.map((key) => this.csvValue(row, key)).join(','))
    ];
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'happy-hours-branch-offer-leaderboard.csv';
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
      includeAllBranches: true,
      from: this.filters.from,
      to: this.filters.to,
      regionId: this.filters.regionId,
      sort: this.filters.sort
    };
  }

  private csvValue(row: BranchLeaderboardRow, key: string): string {
    const value = key === 'topOffer' ? row.topOffer?.title : row[key];
    return `"${String(value ?? '').replace(/"/g, '""')}"`;
  }
}
