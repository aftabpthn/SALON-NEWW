import { CommonModule } from '@angular/common';
import { Component, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { forkJoin } from 'rxjs';
import { ApiRecord, ApiService } from '../../core/api.service';

@Component({
  selector: 'app-staff-aware-offers',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './staff-aware-offers.component.html',
  styleUrls: ['./staff-aware-offers.component.css']
})
export class StaffAwareOffersComponent implements OnInit {
  readonly loading = signal(false);
  readonly saving = signal(false);
  readonly error = signal('');
  readonly evaluation = signal<ApiRecord | null>(null);
  readonly suggestions = signal<ApiRecord[]>([]);

  filters = {
    staffId: '',
    signalDate: '',
    dayOfWeek: '',
    hourSlot: '',
    serviceCategory: 'default',
    servicePricePaise: 250000,
    capacityPerHour: 3
  };

  readonly days = [
    { value: '', label: 'Auto day' },
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
    forkJoin({
      evaluation: this.api.list<ApiRecord>('happy-hours-staff-aware/evaluate', this.params()),
      suggestions: this.api.list<{ rows: ApiRecord[] }>('happy-hours-staff-aware/suggestions', { limit: 25 })
    }).subscribe({
      next: (result) => {
        this.evaluation.set(result.evaluation || {});
        this.suggestions.set(result.suggestions.rows || []);
        this.loading.set(false);
      },
      error: (error) => {
        this.error.set(this.api.errorText(error, 'Unable to load staff-aware offers'));
        this.loading.set(false);
      }
    });
  }

  saveSuggestion(): void {
    this.saving.set(true);
    this.error.set('');
    this.api.post<{ suggestion: ApiRecord }>('happy-hours-staff-aware/suggestions', this.params()).subscribe({
      next: () => {
        this.saving.set(false);
        this.load();
      },
      error: (error) => {
        this.error.set(this.api.errorText(error, 'Unable to save staff-aware suggestion'));
        this.saving.set(false);
      }
    });
  }

  updateStatus(row: ApiRecord, status: string): void {
    this.api.patch<{ suggestion: ApiRecord }>(`happy-hours-staff-aware/suggestions/${row.id}/status`, { status }).subscribe({
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

  pct(value: unknown): string {
    return `${Number(value || 0).toFixed(1)}%`;
  }

  label(value: unknown): string {
    return String(value || '').replace(/_/g, ' ');
  }

  private params(): ApiRecord {
    const params: ApiRecord = {
      serviceCategory: this.filters.serviceCategory || 'default',
      servicePricePaise: this.filters.servicePricePaise,
      capacityPerHour: this.filters.capacityPerHour
    };
    if (this.filters.staffId) params.staffId = this.filters.staffId;
    if (this.filters.signalDate) params.signalDate = this.filters.signalDate;
    if (this.filters.dayOfWeek) params.dayOfWeek = this.filters.dayOfWeek;
    if (this.filters.hourSlot !== '') params.hourSlot = this.filters.hourSlot;
    return params;
  }
}
