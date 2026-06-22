import { CommonModule } from '@angular/common';
import { Component, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { forkJoin } from 'rxjs';
import { ApiRecord, ApiService } from '../../core/api.service';

type FraudCase = ApiRecord & {
  id: number;
  guardType: string;
  entityType: string;
  entityId: string;
  riskScore: number;
  severity: string;
  status: string;
  title: string;
  description: string;
  evidence?: ApiRecord;
  recommendedAction?: ApiRecord;
  detectedAt: number;
  reviewNote?: string;
};

@Component({
  selector: 'app-happy-hours-fraud-guard',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './fraud-guard.component.html',
  styleUrls: ['./fraud-guard.component.css']
})
export class HappyHoursFraudGuardComponent implements OnInit {
  readonly summary = signal<ApiRecord | null>(null);
  readonly cases = signal<FraudCase[]>([]);
  readonly scanResult = signal<ApiRecord | null>(null);
  readonly assessment = signal<ApiRecord | null>(null);
  readonly expandedId = signal<number | null>(null);
  readonly loading = signal(false);
  readonly scanning = signal(false);
  readonly saving = signal(false);
  readonly error = signal('');

  filters = {
    status: 'open',
    severity: '',
    guardType: '',
    from: '',
    to: ''
  };

  assessForm: ApiRecord = {
    clientId: '',
    staffId: '',
    couponCode: '',
    ruleId: '',
    cartTotalPaise: 250000,
    discountPaise: 50000
  };

  readonly statuses = ['', 'open', 'investigating', 'escalated', 'blocked', 'resolved', 'dismissed'];
  readonly severities = ['', 'low', 'medium', 'high', 'critical'];
  readonly guardTypes = [
    '',
    'repeat_client_discount_use',
    'staff_manual_override_spike',
    'suspicious_manual_discount',
    'coupon_limit_breach',
    'coupon_reuse_pattern',
    'approval_bypass_attempt',
    'guardrail_pressure',
    'anomaly_escalation'
  ];

  constructor(private readonly api: ApiService) {}

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.error.set('');
    forkJoin({
      summary: this.api.list<ApiRecord>('happy-hours-fraud-guard/summary'),
      cases: this.api.list<{ rows: FraudCase[] }>('happy-hours-fraud-guard/cases', {
        status: this.filters.status,
        severity: this.filters.severity,
        guardType: this.filters.guardType
      })
    }).subscribe({
      next: (result) => {
        this.summary.set(result.summary);
        this.cases.set(result.cases.rows || []);
        this.loading.set(false);
      },
      error: (error) => {
        this.error.set(this.errorText(error, 'Unable to load fraud guard'));
        this.loading.set(false);
      }
    });
  }

  scan(): void {
    this.scanning.set(true);
    this.error.set('');
    this.api.post<ApiRecord>('happy-hours-fraud-guard/scan', {
      from: this.filters.from,
      to: this.filters.to
    }).subscribe({
      next: (result) => {
        this.scanResult.set(result);
        this.scanning.set(false);
        this.load();
      },
      error: (error) => {
        this.error.set(this.errorText(error, 'Unable to run fraud scan'));
        this.scanning.set(false);
      }
    });
  }

  assess(): void {
    this.saving.set(true);
    this.error.set('');
    this.api.post<ApiRecord>('happy-hours-fraud-guard/assess', this.assessForm).subscribe({
      next: (result) => {
        this.assessment.set(result);
        this.saving.set(false);
      },
      error: (error) => {
        this.error.set(this.errorText(error, 'Unable to assess discount context'));
        this.saving.set(false);
      }
    });
  }

  review(row: FraudCase, status: string): void {
    this.saving.set(true);
    this.error.set('');
    this.api.patch<FraudCase>(`happy-hours-fraud-guard/cases/${row.id}/review`, {
      status,
      reviewNote: row.reviewNote || ''
    }).subscribe({
      next: () => {
        this.saving.set(false);
        this.load();
      },
      error: (error) => {
        this.error.set(this.errorText(error, 'Unable to update fraud case'));
        this.saving.set(false);
      }
    });
  }

  toggle(row: FraudCase): void {
    this.expandedId.set(this.expandedId() === row.id ? null : row.id);
  }

  formatMoney(value: unknown): string {
    return `Rs ${Math.round(Number(value || 0)) / 100}`;
  }

  formatDate(value: unknown): string {
    const seconds = Number(value || 0);
    return seconds ? new Date(seconds * 1000).toLocaleString() : '-';
  }

  label(value: unknown): string {
    return String(value || '').replace(/_/g, ' ');
  }

  riskClass(rowOrScore: FraudCase | number | undefined): string {
    const score = typeof rowOrScore === 'number' ? rowOrScore : Number(rowOrScore?.riskScore || 0);
    if (score >= 85) return 'risk critical';
    if (score >= 70) return 'risk high';
    if (score >= 45) return 'risk medium';
    return 'risk low';
  }

  statusClass(value: unknown): string {
    return `status-badge status-${String(value || 'open').replace(/[^a-z0-9_-]/gi, '_').toLowerCase()}`;
  }

  evidenceText(row: FraudCase): string {
    return JSON.stringify({
      evidence: row.evidence || {},
      recommendedAction: row.recommendedAction || {},
      source: row.source || {}
    }, null, 2);
  }

  private errorText(error: unknown, fallback: string): string {
    const err = error as { error?: { error?: string; message?: string }; message?: string };
    return err?.error?.error || err?.error?.message || err?.message || fallback;
  }
}
