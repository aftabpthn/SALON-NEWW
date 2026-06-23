import { CommonModule } from '@angular/common';
import { Component, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { forkJoin } from 'rxjs';
import { ApiRecord, ApiService } from '../../core/api.service';

@Component({
  selector: 'app-bundle-aware-offers',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './bundle-aware-offers.component.html',
  styleUrls: ['./bundle-aware-offers.component.css']
})
export class BundleAwareOffersComponent implements OnInit {
  readonly loading = signal(false);
  readonly saving = signal(false);
  readonly error = signal('');
  readonly evaluation = signal<ApiRecord | null>(null);
  readonly suggestions = signal<ApiRecord[]>([]);

  filters = {
    serviceCategory: 'default',
    primaryServiceId: '',
    signalDate: '',
    hourSlot: '',
    selectedServiceCount: 1,
    cartTotalPaise: 250000,
    baseDiscountPercent: 5,
    bundleMarginPercent: 45,
    addOnAttachRatePercent: 0,
    targetTicketLiftPaise: 75000,
    packageEligible: false,
    packagePricePaise: 0
  };

  constructor(private readonly api: ApiService) {}

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.error.set('');
    forkJoin({
      evaluation: this.api.list<ApiRecord>('happy-hours-bundle-aware/evaluate', this.params()),
      suggestions: this.api.list<{ rows: ApiRecord[] }>('happy-hours-bundle-aware/suggestions', { limit: 25 })
    }).subscribe({
      next: (result) => {
        this.evaluation.set(result.evaluation || {});
        this.suggestions.set(result.suggestions.rows || []);
        this.loading.set(false);
      },
      error: (error) => {
        this.error.set(this.api.errorText(error, 'Unable to load bundle-aware offers'));
        this.loading.set(false);
      }
    });
  }

  saveSuggestion(): void {
    this.saving.set(true);
    this.error.set('');
    this.api.post<{ suggestion: ApiRecord }>('happy-hours-bundle-aware/suggestions', this.params()).subscribe({
      next: () => {
        this.saving.set(false);
        this.load();
      },
      error: (error) => {
        this.error.set(this.api.errorText(error, 'Unable to save bundle-aware suggestion'));
        this.saving.set(false);
      }
    });
  }

  updateStatus(row: ApiRecord, status: string): void {
    this.api.patch<{ suggestion: ApiRecord }>(`happy-hours-bundle-aware/suggestions/${row.id}/status`, { status }).subscribe({
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

  pct(value: unknown): string {
    return `${Number(value || 0).toFixed(1)}%`;
  }

  private params(): ApiRecord {
    const params: ApiRecord = {
      serviceCategory: this.filters.serviceCategory || 'default',
      primaryServiceId: this.filters.primaryServiceId,
      selectedServiceCount: this.filters.selectedServiceCount,
      cartTotalPaise: this.filters.cartTotalPaise,
      baseDiscountPercent: this.filters.baseDiscountPercent,
      bundleMarginPercent: this.filters.bundleMarginPercent,
      addOnAttachRatePercent: this.filters.addOnAttachRatePercent,
      targetTicketLiftPaise: this.filters.targetTicketLiftPaise,
      packageEligible: this.filters.packageEligible,
      packagePricePaise: this.filters.packagePricePaise
    };
    if (this.filters.signalDate) params.signalDate = this.filters.signalDate;
    if (this.filters.hourSlot !== '') params.hourSlot = this.filters.hourSlot;
    return params;
  }
}
