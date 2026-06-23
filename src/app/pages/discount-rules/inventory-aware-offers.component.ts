import { CommonModule } from '@angular/common';
import { Component, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { forkJoin } from 'rxjs';
import { ApiRecord, ApiService } from '../../core/api.service';

@Component({
  selector: 'app-inventory-aware-offers',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './inventory-aware-offers.component.html',
  styleUrls: ['./inventory-aware-offers.component.css']
})
export class InventoryAwareOffersComponent implements OnInit {
  readonly loading = signal(false);
  readonly saving = signal(false);
  readonly error = signal('');
  readonly evaluation = signal<ApiRecord | null>(null);
  readonly suggestions = signal<ApiRecord[]>([]);

  filters = {
    productId: '',
    serviceCategory: 'default',
    signalDate: '',
    servicePricePaise: 250000,
    productPricePaise: 0,
    overstockThreshold: 20,
    lowStockThreshold: 3,
    expiryWindowDays: 30
  };

  constructor(private readonly api: ApiService) {}

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.error.set('');
    forkJoin({
      evaluation: this.api.list<ApiRecord>('happy-hours-inventory-aware/evaluate', this.params()),
      suggestions: this.api.list<{ rows: ApiRecord[] }>('happy-hours-inventory-aware/suggestions', { limit: 25 })
    }).subscribe({
      next: (result) => {
        this.evaluation.set(result.evaluation || {});
        this.suggestions.set(result.suggestions.rows || []);
        this.loading.set(false);
      },
      error: (error) => {
        this.error.set(this.api.errorText(error, 'Unable to load inventory-aware offers'));
        this.loading.set(false);
      }
    });
  }

  saveSuggestion(): void {
    this.saving.set(true);
    this.error.set('');
    this.api.post<{ suggestion: ApiRecord }>('happy-hours-inventory-aware/suggestions', this.params()).subscribe({
      next: () => {
        this.saving.set(false);
        this.load();
      },
      error: (error) => {
        this.error.set(this.api.errorText(error, 'Unable to save inventory-aware suggestion'));
        this.saving.set(false);
      }
    });
  }

  updateStatus(row: ApiRecord, status: string): void {
    this.api.patch<{ suggestion: ApiRecord }>(`happy-hours-inventory-aware/suggestions/${row.id}/status`, { status }).subscribe({
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

  expiryLabel(row: ApiRecord): string {
    const days = Number(row.daysToExpiry ?? 9999);
    if (!row.expiryDate || days >= 9999) return 'No expiry signal';
    if (days < 0) return `${Math.abs(days)} day(s) expired`;
    return `${days} day(s) left`;
  }

  private params(): ApiRecord {
    const params: ApiRecord = {
      serviceCategory: this.filters.serviceCategory || 'default',
      servicePricePaise: this.filters.servicePricePaise,
      productPricePaise: this.filters.productPricePaise,
      overstockThreshold: this.filters.overstockThreshold,
      lowStockThreshold: this.filters.lowStockThreshold,
      expiryWindowDays: this.filters.expiryWindowDays
    };
    if (this.filters.productId) params.productId = this.filters.productId;
    if (this.filters.signalDate) params.signalDate = this.filters.signalDate;
    return params;
  }
}
