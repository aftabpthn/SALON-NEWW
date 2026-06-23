import { CommonModule } from '@angular/common';
import { Component, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { forkJoin } from 'rxjs';
import { ApiRecord, ApiService } from '../../core/api.service';

@Component({
  selector: 'app-market-aware-offers',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './market-aware-offers.component.html',
  styleUrls: ['./market-aware-offers.component.css']
})
export class MarketAwareOffersComponent implements OnInit {
  readonly loading = signal(false);
  readonly saving = signal(false);
  readonly error = signal('');
  readonly evaluation = signal<ApiRecord | null>(null);
  readonly suggestions = signal<ApiRecord[]>([]);

  filters = {
    serviceCategory: 'hair',
    signalDate: '',
    dayOfWeek: '',
    hourSlot: '',
    ourPricePaise: 250000,
    baseDiscountPercent: 5,
    maxDiscountPercent: 30
  };

  constructor(private readonly api: ApiService) {}

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.error.set('');
    forkJoin({
      evaluation: this.api.list<ApiRecord>('happy-hours-market-aware/evaluate', this.params()),
      suggestions: this.api.list<{ rows: ApiRecord[] }>('happy-hours-market-aware/suggestions', { limit: 25 })
    }).subscribe({
      next: (result) => {
        this.evaluation.set(result.evaluation || {});
        this.suggestions.set(result.suggestions.rows || []);
        this.loading.set(false);
      },
      error: (error) => {
        this.error.set(this.api.errorText(error, 'Unable to load market-aware offers'));
        this.loading.set(false);
      }
    });
  }

  saveSuggestion(): void {
    this.saving.set(true);
    this.error.set('');
    this.api.post<{ suggestion: ApiRecord }>('happy-hours-market-aware/suggestions', this.params()).subscribe({
      next: () => {
        this.saving.set(false);
        this.load();
      },
      error: (error) => {
        this.error.set(this.api.errorText(error, 'Unable to save market-aware suggestion'));
        this.saving.set(false);
      }
    });
  }

  updateStatus(row: ApiRecord, status: string): void {
    this.api.patch<{ suggestion: ApiRecord }>(`happy-hours-market-aware/suggestions/${row.id}/status`, { status }).subscribe({
      next: () => this.load(),
      error: (error) => this.error.set(this.api.errorText(error, 'Unable to update suggestion'))
    });
  }

  rows(): ApiRecord[] {
    return this.evaluation()?.rows || [];
  }

  best(): ApiRecord {
    return this.evaluation()?.best || {};
  }

  summary(): ApiRecord {
    return this.evaluation()?.summary || {};
  }

  formatMoney(value: unknown): string {
    return `Rs ${(Math.round(Number(value || 0)) / 100).toLocaleString('en-IN')}`;
  }

  label(value: unknown): string {
    return String(value || '').replace(/_/g, ' ');
  }

  pct(value: unknown): string {
    return `${Number(value || 0).toFixed(1)}%`;
  }

  occupancy(value: unknown): string {
    return `${(Number(value || 0) * 100).toFixed(0)}%`;
  }

  private params(): ApiRecord {
    const params: ApiRecord = {
      serviceCategory: this.filters.serviceCategory || 'default',
      ourPricePaise: this.filters.ourPricePaise,
      baseDiscountPercent: this.filters.baseDiscountPercent,
      maxDiscountPercent: this.filters.maxDiscountPercent
    };
    if (this.filters.signalDate) params.signalDate = this.filters.signalDate;
    if (this.filters.dayOfWeek) params.dayOfWeek = this.filters.dayOfWeek;
    if (this.filters.hourSlot !== '') params.hourSlot = this.filters.hourSlot;
    return params;
  }
}
