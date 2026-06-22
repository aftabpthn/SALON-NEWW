import { CommonModule } from '@angular/common';
import { Component, OnInit, computed, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { forkJoin } from 'rxjs';
import { ApiRecord, ApiService } from '../../core/api.service';

type Summary = ApiRecord & {
  branchCount: number;
  grossRevenuePaise: number;
  netRevenuePaise: number;
  totalDiscountPaise: number;
  discountRatePercent: number;
  budgetExceededCount: number;
  marginBlockedCount: number;
  activeRules: number;
};

type BranchRow = ApiRecord & {
  branchId: string;
  branchName: string;
  regionId: string;
  regionName: string;
  discountEvents: number;
  grossRevenuePaise: number;
  netRevenuePaise: number;
  totalDiscountPaise: number;
  discountRatePercent: number;
  budgetExceededCount: number;
  marginBlockedCount: number;
  activeRules: number;
};

type RuleRow = ApiRecord & {
  ruleId: number | null;
  ruleName: string;
  applications: number;
  branches: number;
  netRevenuePaise: number;
  totalDiscountPaise: number;
  discountRatePercent: number;
};

@Component({
  selector: 'app-cross-branch-analytics',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './cross-branch-analytics.component.html',
  styleUrls: ['./cross-branch-analytics.component.css']
})
export class CrossBranchAnalyticsComponent implements OnInit {
  readonly summary = signal<Summary | null>(null);
  readonly branches = signal<BranchRow[]>([]);
  readonly rules = signal<RuleRow[]>([]);
  readonly margin = signal<ApiRecord | null>(null);
  readonly loading = signal(false);
  readonly error = signal('');
  readonly regionOptions = computed(() => {
    const map = new Map<string, string>();
    for (const branch of this.branches()) {
      if (branch.regionId) map.set(branch.regionId, branch.regionName || branch.regionId);
    }
    return [...map.entries()].map(([id, name]) => ({ id, name })).sort((left, right) => left.name.localeCompare(right.name));
  });
  readonly marginRows = computed(() => this.margin()?.rows || []);

  filters = {
    from: '',
    to: '',
    regionId: ''
  };

  constructor(private readonly api: ApiService) {}

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.error.set('');
    const params = this.params();
    forkJoin({
      summary: this.api.list<Summary>('cross-branch-analytics/summary', params),
      branches: this.api.list<{ rows: BranchRow[] }>('cross-branch-analytics/branches', params),
      rules: this.api.list<{ rows: RuleRow[] }>('cross-branch-analytics/rules', { ...params, limit: 20 }),
      margin: this.api.list<ApiRecord>('cross-branch-analytics/margin-impact', params)
    }).subscribe({
      next: (result) => {
        this.summary.set(result.summary);
        this.branches.set(result.branches.rows || []);
        this.rules.set(result.rules.rows || []);
        this.margin.set(result.margin);
        this.loading.set(false);
      },
      error: (error) => {
        this.error.set(this.errorText(error, 'Unable to load cross-branch analytics'));
        this.loading.set(false);
      }
    });
  }

  exportCsv(): void {
    const headers = ['branchId', 'branchName', 'regionName', 'discountEvents', 'grossRevenuePaise', 'netRevenuePaise', 'totalDiscountPaise', 'discountRatePercent', 'budgetExceededCount', 'marginBlockedCount', 'activeRules'];
    const lines = [
      headers.join(','),
      ...this.branches().map((row) => headers.map((key) => this.csvCell(String(row[key] ?? ''))).join(','))
    ];
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'cross-branch-discount-analytics.csv';
    link.click();
    URL.revokeObjectURL(url);
  }

  formatMoney(value: unknown): string {
    return `Rs ${Math.round(Number(value || 0)) / 100}`;
  }

  pct(value: unknown): string {
    return `${Number(value || 0).toFixed(2)}%`;
  }

  private params(): ApiRecord {
    return {
      includeAllBranches: true,
      from: this.filters.from,
      to: this.filters.to,
      regionId: this.filters.regionId
    };
  }

  private csvCell(value: string): string {
    return `"${String(value).replace(/"/g, '""')}"`;
  }

  private errorText(error: unknown, fallback: string): string {
    const err = error as { error?: { error?: string; message?: string }; message?: string };
    return err?.error?.error || err?.error?.message || err?.message || fallback;
  }
}
