import { CommonModule } from '@angular/common';
import { Component, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { forkJoin } from 'rxjs';
import { ApiRecord, ApiService } from '../../core/api.service';

type AutoSunsetDecision = ApiRecord & {
  id: number;
  offerType: string;
  offerId: string;
  offerName: string;
  action: string;
  reason: string;
  severity: string;
  status: string;
  evidence?: ApiRecord;
  decidedAt: number;
  appliedAt?: number;
};

@Component({
  selector: 'app-offer-auto-sunset',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './offer-auto-sunset.component.html',
  styleUrls: ['./offer-auto-sunset.component.css']
})
export class OfferAutoSunsetComponent implements OnInit {
  readonly policy = signal<ApiRecord>({
    expirePastEndDate: true,
    pauseCouponsAtUsageLimit: true,
    reviewNoEndDateAfterDays: 30,
    autoApplyExpired: true,
    autoApplyUsageLimit: true,
    autoApplyStale: false,
    status: 'active'
  });
  readonly decisions = signal<AutoSunsetDecision[]>([]);
  readonly scanResult = signal<ApiRecord | null>(null);
  readonly loading = signal(false);
  readonly saving = signal(false);
  readonly scanning = signal(false);
  readonly applyingId = signal<number | null>(null);
  readonly error = signal('');
  readonly filters = {
    status: '',
    severity: ''
  };

  constructor(private readonly api: ApiService) {}

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.error.set('');
    forkJoin({
      policy: this.api.list<ApiRecord>('happy-hours-auto-sunset/policy'),
      decisions: this.api.list<{ rows: AutoSunsetDecision[] }>('happy-hours-auto-sunset/decisions', this.filters)
    }).subscribe({
      next: (result) => {
        this.policy.set({ ...this.policy(), ...result.policy });
        this.decisions.set(result.decisions.rows || []);
        this.loading.set(false);
      },
      error: (error) => {
        this.error.set(this.api.errorText(error, 'Unable to load Offer Auto-Sunset'));
        this.loading.set(false);
      }
    });
  }

  savePolicy(): void {
    this.saving.set(true);
    this.error.set('');
    this.api.post<ApiRecord>('happy-hours-auto-sunset/policy', this.policy()).subscribe({
      next: (policy) => {
        this.policy.set({ ...this.policy(), ...policy });
        this.saving.set(false);
      },
      error: (error) => {
        this.error.set(this.api.errorText(error, 'Unable to save policy'));
        this.saving.set(false);
      }
    });
  }

  scan(apply = false): void {
    this.scanning.set(true);
    this.error.set('');
    this.api.post<ApiRecord>('happy-hours-auto-sunset/scan', { apply }).subscribe({
      next: (result) => {
        this.scanResult.set(result);
        this.scanning.set(false);
        this.load();
      },
      error: (error) => {
        this.error.set(this.api.errorText(error, 'Unable to scan offers'));
        this.scanning.set(false);
      }
    });
  }

  apply(row: AutoSunsetDecision): void {
    this.applyingId.set(row.id);
    this.error.set('');
    this.api.post<AutoSunsetDecision>(`happy-hours-auto-sunset/decisions/${row.id}/apply`, {}).subscribe({
      next: () => {
        this.applyingId.set(null);
        this.load();
      },
      error: (error) => {
        this.error.set(this.api.errorText(error, 'Unable to apply auto-sunset decision'));
        this.applyingId.set(null);
      }
    });
  }

  updatePolicy(key: string, value: unknown): void {
    this.policy.set({ ...this.policy(), [key]: value });
  }

  summary(key: 'total' | 'suggested' | 'applied' | 'risk'): number {
    const rows = this.decisions();
    if (key === 'total') return rows.length;
    if (key === 'suggested') return rows.filter((row) => row.status === 'suggested').length;
    if (key === 'applied') return rows.filter((row) => row.status === 'applied').length;
    return rows.filter((row) => ['high', 'critical'].includes(row.severity)).length;
  }

  canApply(row: AutoSunsetDecision): boolean {
    return row.status === 'suggested';
  }

  label(value: unknown): string {
    return String(value || '').replace(/_/g, ' ');
  }

  formatDate(value: unknown): string {
    const seconds = Number(value || 0);
    return seconds ? new Date(seconds * 1000).toLocaleString() : '-';
  }

  statusClass(value: unknown): string {
    return `status-badge status-${String(value || 'suggested').replace(/[^a-z0-9_-]/gi, '_').toLowerCase()}`;
  }

  severityClass(value: unknown): string {
    return `severity severity-${String(value || 'medium').replace(/[^a-z0-9_-]/gi, '_').toLowerCase()}`;
  }

  evidenceText(row: AutoSunsetDecision): string {
    return JSON.stringify(row.evidence || {}, null, 2);
  }
}
