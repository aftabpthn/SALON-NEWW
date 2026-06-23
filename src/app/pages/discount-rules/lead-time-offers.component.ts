import { CommonModule } from '@angular/common';
import { Component, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { forkJoin } from 'rxjs';
import { ApiRecord, ApiService } from '../../core/api.service';

@Component({
  selector: 'app-lead-time-offers',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './lead-time-offers.component.html',
  styleUrls: ['./lead-time-offers.component.css']
})
export class LeadTimeOffersComponent implements OnInit {
  readonly loading = signal(false);
  readonly saving = signal(false);
  readonly error = signal('');
  readonly evaluation = signal<ApiRecord | null>(null);
  readonly suggestions = signal<ApiRecord[]>([]);

  filters = {
    serviceCategory: 'default',
    signalDate: '',
    hourSlot: '',
    requestedStartAt: '',
    bookingLeadMinutes: '',
    servicePricePaise: 250000,
    baseDiscountPercent: 5,
    lookbackDays: 90
  };

  constructor(private readonly api: ApiService) {}

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.error.set('');
    forkJoin({
      evaluation: this.api.list<ApiRecord>('happy-hours-lead-time/evaluate', this.params()),
      suggestions: this.api.list<{ rows: ApiRecord[] }>('happy-hours-lead-time/suggestions', { limit: 25 })
    }).subscribe({
      next: (result) => {
        this.evaluation.set(result.evaluation || {});
        this.suggestions.set(result.suggestions.rows || []);
        this.loading.set(false);
      },
      error: (error) => {
        this.error.set(this.api.errorText(error, 'Unable to load lead-time offers'));
        this.loading.set(false);
      }
    });
  }

  saveSuggestion(): void {
    this.saving.set(true);
    this.error.set('');
    this.api.post<{ suggestion: ApiRecord }>('happy-hours-lead-time/suggestions', this.params()).subscribe({
      next: () => {
        this.saving.set(false);
        this.load();
      },
      error: (error) => {
        this.error.set(this.api.errorText(error, 'Unable to save lead-time suggestion'));
        this.saving.set(false);
      }
    });
  }

  updateStatus(row: ApiRecord, status: string): void {
    this.api.patch<{ suggestion: ApiRecord }>(`happy-hours-lead-time/suggestions/${row.id}/status`, { status }).subscribe({
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

  formatMoney(value: unknown): string {
    return `Rs ${(Math.round(Number(value || 0)) / 100).toLocaleString('en-IN')}`;
  }

  label(value: unknown): string {
    return String(value || '').replace(/_/g, ' ');
  }

  minutes(value: unknown): string {
    const total = Math.max(0, Number(value || 0));
    const days = Math.floor(total / 1440);
    const hours = Math.floor((total % 1440) / 60);
    if (days) return `${days}d ${hours}h`;
    return `${hours}h ${Math.round(total % 60)}m`;
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
      servicePricePaise: this.filters.servicePricePaise,
      baseDiscountPercent: this.filters.baseDiscountPercent,
      lookbackDays: this.filters.lookbackDays
    };
    if (this.filters.signalDate) params.signalDate = this.filters.signalDate;
    if (this.filters.hourSlot !== '') params.hourSlot = this.filters.hourSlot;
    if (this.filters.requestedStartAt) params.requestedStartAt = this.filters.requestedStartAt;
    if (this.filters.bookingLeadMinutes !== '') params.bookingLeadMinutes = this.filters.bookingLeadMinutes;
    return params;
  }
}
