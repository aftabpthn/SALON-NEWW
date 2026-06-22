import { CommonModule } from '@angular/common';
import { Component, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ApiRecord, ApiService } from '../../core/api.service';

type DiscountAnomaly = ApiRecord & {
  id: number;
  anomalyType: string;
  severity: string;
  status: string;
  title: string;
  description: string;
  evidence?: ApiRecord;
  detectedAt: number;
  reviewNote?: string;
};

@Component({
  selector: 'app-discount-anomaly-inbox',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './anomaly-inbox.component.html',
  styleUrls: ['./anomaly-inbox.component.css']
})
export class DiscountAnomalyInboxComponent implements OnInit {
  readonly rows = signal<DiscountAnomaly[]>([]);
  readonly loading = signal(false);
  readonly scanning = signal(false);
  readonly error = signal('');
  readonly scanSummary = signal<ApiRecord | null>(null);
  readonly expandedId = signal<number | null>(null);

  filters = {
    status: 'open',
    severity: '',
    anomalyType: '',
    from: '',
    to: ''
  };

  readonly severities = ['', 'low', 'medium', 'high', 'critical'];
  readonly statuses = ['', 'open', 'reviewed', 'dismissed'];
  readonly anomalyTypes = [
    '',
    'unusual_discount_usage',
    'budget_spike',
    'margin_risk_outlier',
    'approval_bypass_pattern'
  ];

  constructor(private readonly api: ApiService) {}

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.error.set('');
    this.api.list<{ rows: DiscountAnomaly[] }>('discount-anomalies', {
      status: this.filters.status,
      severity: this.filters.severity,
      anomalyType: this.filters.anomalyType
    }).subscribe({
      next: (result) => {
        this.rows.set(result.rows || []);
        this.loading.set(false);
      },
      error: (error) => {
        this.error.set(this.errorText(error, 'Unable to load anomalies'));
        this.loading.set(false);
      }
    });
  }

  scan(): void {
    this.scanning.set(true);
    this.error.set('');
    this.api.post<ApiRecord>('discount-anomalies/scan', {
      from: this.filters.from,
      to: this.filters.to
    }).subscribe({
      next: (summary) => {
        this.scanSummary.set(summary);
        this.scanning.set(false);
        this.load();
      },
      error: (error) => {
        this.error.set(this.errorText(error, 'Unable to scan anomalies'));
        this.scanning.set(false);
      }
    });
  }

  mark(row: DiscountAnomaly, status: 'reviewed' | 'dismissed'): void {
    this.api.patch(`discount-anomalies/${row.id}/review`, {
      status,
      reviewNote: row.reviewNote || ''
    }).subscribe({
      next: () => this.load(),
      error: (error) => this.error.set(this.errorText(error, 'Unable to update anomaly'))
    });
  }

  toggle(row: DiscountAnomaly): void {
    this.expandedId.set(this.expandedId() === row.id ? null : row.id);
  }

  formatDate(value: unknown): string {
    const seconds = Number(value || 0);
    return seconds ? new Date(seconds * 1000).toLocaleString() : '-';
  }

  label(value: string): string {
    return String(value || '').replace(/_/g, ' ');
  }

  evidenceText(row: DiscountAnomaly): string {
    return JSON.stringify(row.evidence || {}, null, 2);
  }

  severityClass(severity: string): string {
    return `severity ${severity || 'medium'}`;
  }

  private errorText(error: unknown, fallback: string): string {
    const err = error as { error?: { error?: string; message?: string }; message?: string };
    return err?.error?.error || err?.error?.message || err?.message || fallback;
  }
}
