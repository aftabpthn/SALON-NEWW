import { CommonModule } from '@angular/common';
import { Component, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { forkJoin } from 'rxjs';
import { ApiRecord, ApiService } from '../../core/api.service';

type CandidateRow = ApiRecord & {
  discountPct: number;
  sampleCount: number;
  elasticity: number;
  expectedBookings: number;
  expectedRevenuePaise: number;
  expectedProfitPaise: number;
  marginPercent: number;
  marginSafe: boolean;
  demandLiftPercent: number;
};

@Component({
  selector: 'app-elasticity-profit-pricing',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './elasticity-profit-pricing.component.html',
  styleUrls: ['./elasticity-profit-pricing.component.css']
})
export class ElasticityProfitPricingComponent implements OnInit {
  readonly loading = signal(false);
  readonly saving = signal(false);
  readonly error = signal('');
  readonly summary = signal<ApiRecord | null>(null);
  readonly recommendation = signal<ApiRecord | null>(null);
  readonly preview = signal<ApiRecord | null>(null);
  readonly assumptions = signal<ApiRecord[]>([]);

  filters = {
    dayOfWeek: '',
    hourSlot: '',
    serviceCategory: 'default',
    servicePricePaise: 250000,
    discountPct: 10,
    from: '',
    to: ''
  };

  assumptionForm = {
    serviceCategory: 'default',
    baseCostPaise: 0,
    variableCostPercent: 0,
    staffCommissionPercent: 0,
    paymentFeePercent: 0,
    gstPercent: 18,
    minMarginPercent: 30
  };

  readonly days = [
    { value: '', label: 'All days' },
    { value: 'mon', label: 'Monday' },
    { value: 'tue', label: 'Tuesday' },
    { value: 'wed', label: 'Wednesday' },
    { value: 'thu', label: 'Thursday' },
    { value: 'fri', label: 'Friday' },
    { value: 'sat', label: 'Saturday' },
    { value: 'sun', label: 'Sunday' }
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
      summary: this.api.list<ApiRecord>('happy-hours-elasticity/summary', params),
      recommendation: this.api.list<ApiRecord>('happy-hours-elasticity/recommend', params),
      preview: this.api.list<ApiRecord>('happy-hours-elasticity/profit-preview', params),
      assumptions: this.api.list<{ rows: ApiRecord[] }>('happy-hours-elasticity/assumptions')
    }).subscribe({
      next: (result) => {
        this.summary.set(result.summary || {});
        this.recommendation.set(result.recommendation || {});
        this.preview.set(result.preview || {});
        this.assumptions.set(result.assumptions.rows || []);
        this.loading.set(false);
      },
      error: (error) => {
        this.error.set(this.api.errorText(error, 'Unable to load elasticity pricing'));
        this.loading.set(false);
      }
    });
  }

  saveAssumption(): void {
    this.saving.set(true);
    this.error.set('');
    this.api.post<{ assumption: ApiRecord }>('happy-hours-elasticity/assumptions', this.assumptionForm).subscribe({
      next: () => {
        this.saving.set(false);
        this.filters.serviceCategory = this.assumptionForm.serviceCategory || 'default';
        this.load();
      },
      error: (error) => {
        this.error.set(this.api.errorText(error, 'Unable to save profit assumptions'));
        this.saving.set(false);
      }
    });
  }

  candidates(): CandidateRow[] {
    return (this.recommendation()?.candidates || []) as CandidateRow[];
  }

  bands(): ApiRecord[] {
    return this.summary()?.bands || [];
  }

  formatMoney(value: unknown): string {
    return `Rs ${(Math.round(Number(value || 0)) / 100).toLocaleString('en-IN')}`;
  }

  pct(value: unknown): string {
    return `${Number(value || 0).toFixed(1)}%`;
  }

  private params(): ApiRecord {
    const params: ApiRecord = {
      serviceCategory: this.filters.serviceCategory || 'default',
      servicePricePaise: this.filters.servicePricePaise,
      discountPct: this.filters.discountPct
    };
    if (this.filters.dayOfWeek) params.dayOfWeek = this.filters.dayOfWeek;
    if (this.filters.hourSlot !== '') params.hourSlot = this.filters.hourSlot;
    if (this.filters.from) params.from = this.filters.from;
    if (this.filters.to) params.to = this.filters.to;
    return params;
  }
}
