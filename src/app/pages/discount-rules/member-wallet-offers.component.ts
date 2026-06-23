import { CommonModule } from '@angular/common';
import { Component, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { forkJoin } from 'rxjs';
import { ApiRecord, ApiService } from '../../core/api.service';

@Component({
  selector: 'app-member-wallet-offers',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './member-wallet-offers.component.html',
  styleUrls: ['./member-wallet-offers.component.css']
})
export class MemberWalletOffersComponent implements OnInit {
  readonly loading = signal(false);
  readonly saving = signal(false);
  readonly error = signal('');
  readonly evaluation = signal<ApiRecord | null>(null);
  readonly suggestions = signal<ApiRecord[]>([]);

  filters = {
    clientId: '',
    membershipId: '',
    membershipStatus: 'none',
    signalDate: '',
    hourSlot: '',
    cartTotalPaise: 250000,
    baseDiscountPercent: 5,
    walletBalancePaise: 0,
    loyaltyPoints: 0,
    creditsRemaining: 0,
    visitCount: 0,
    totalSpendPaise: 0,
    validityDate: ''
  };

  constructor(private readonly api: ApiService) {}

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.error.set('');
    forkJoin({
      evaluation: this.api.list<ApiRecord>('happy-hours-member-wallet/evaluate', this.params()),
      suggestions: this.api.list<{ rows: ApiRecord[] }>('happy-hours-member-wallet/suggestions', { limit: 25 })
    }).subscribe({
      next: (result) => {
        this.evaluation.set(result.evaluation || {});
        this.suggestions.set(result.suggestions.rows || []);
        this.loading.set(false);
      },
      error: (error) => {
        this.error.set(this.api.errorText(error, 'Unable to load member wallet offers'));
        this.loading.set(false);
      }
    });
  }

  saveSuggestion(): void {
    this.saving.set(true);
    this.error.set('');
    this.api.post<{ suggestion: ApiRecord }>('happy-hours-member-wallet/suggestions', this.params()).subscribe({
      next: () => {
        this.saving.set(false);
        this.load();
      },
      error: (error) => {
        this.error.set(this.api.errorText(error, 'Unable to save member wallet suggestion'));
        this.saving.set(false);
      }
    });
  }

  updateStatus(row: ApiRecord, status: string): void {
    this.api.patch<{ suggestion: ApiRecord }>(`happy-hours-member-wallet/suggestions/${row.id}/status`, { status }).subscribe({
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
      clientId: this.filters.clientId,
      membershipId: this.filters.membershipId,
      membershipStatus: this.filters.membershipStatus,
      cartTotalPaise: this.filters.cartTotalPaise,
      baseDiscountPercent: this.filters.baseDiscountPercent,
      walletBalancePaise: this.filters.walletBalancePaise,
      loyaltyPoints: this.filters.loyaltyPoints,
      creditsRemaining: this.filters.creditsRemaining,
      visitCount: this.filters.visitCount,
      totalSpendPaise: this.filters.totalSpendPaise,
      validityDate: this.filters.validityDate
    };
    if (this.filters.signalDate) params.signalDate = this.filters.signalDate;
    if (this.filters.hourSlot !== '') params.hourSlot = this.filters.hourSlot;
    return params;
  }
}
