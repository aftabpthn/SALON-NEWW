import { CommonModule } from '@angular/common';
import { Component, OnInit, computed, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { forkJoin } from 'rxjs';
import { ApiRecord, ApiService } from '../../core/api.service';

type ClientReturnRow = ApiRecord & {
  clientId: string;
  clientName: string;
  offerTitle: string;
  offerType: string;
  usedAt: number;
  amountPaise: number;
  discountPaise: number;
  status: string;
  returned: boolean;
  returnAt?: number;
  returnAmountPaise: number;
  daysToReturn?: number;
  recommendation: string;
};

type OfferReturnRow = ApiRecord & {
  offerTitle: string;
  offerType: string;
  offerUses: number;
  returnedCount: number;
  atRiskCount: number;
  returnRatePercent: number;
  avgDaysToReturn: number;
  returnRevenuePaise: number;
};

@Component({
  selector: 'app-client-return-tracker',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './client-return-tracker.component.html',
  styleUrls: ['./client-return-tracker.component.css']
})
export class ClientReturnTrackerComponent implements OnInit {
  readonly loading = signal(false);
  readonly error = signal('');
  readonly summary = signal<ApiRecord | null>(null);
  readonly clients = signal<ClientReturnRow[]>([]);
  readonly offers = signal<OfferReturnRow[]>([]);
  readonly atRiskClients = signal<ClientReturnRow[]>([]);
  readonly pendingClients = signal<ClientReturnRow[]>([]);
  readonly topOffers = computed(() => this.offers().slice(0, 5));
  readonly topAtRiskClients = computed(() => this.atRiskClients().slice(0, 5));

  filters = {
    from: '',
    to: '',
    status: '',
    offerType: '',
    returnWindowDays: 30
  };

  readonly statuses = [
    { value: '', label: 'All clients' },
    { value: 'returned', label: 'Returned' },
    { value: 'pending', label: 'Pending window' },
    { value: 'at_risk', label: 'At risk' },
    { value: 'unknown_client', label: 'Missing client ID' }
  ];

  readonly offerTypes = [
    { value: '', label: 'All offers' },
    { value: 'rule', label: 'Rules' },
    { value: 'coupon', label: 'Coupons' },
    { value: 'unattributed', label: 'Unattributed' }
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
      summary: this.api.list<ApiRecord>('happy-hours-client-returns/summary', params),
      clients: this.api.list<{ rows: ClientReturnRow[] }>('happy-hours-client-returns/clients', params),
      offers: this.api.list<{ rows: OfferReturnRow[] }>('happy-hours-client-returns/offers', params)
    }).subscribe({
      next: (result) => {
        this.summary.set(result.summary.summary || {});
        this.atRiskClients.set(result.summary.atRiskClients || []);
        this.pendingClients.set(result.summary.pendingClients || []);
        this.clients.set(result.clients.rows || []);
        this.offers.set(result.offers.rows || []);
        this.loading.set(false);
      },
      error: (error) => {
        this.error.set(this.api.errorText(error, 'Unable to load Client Return Tracker'));
        this.loading.set(false);
      }
    });
  }

  exportCsv(): void {
    const headers = [
      'clientId',
      'clientName',
      'offerTitle',
      'offerType',
      'status',
      'usedAt',
      'discountPaise',
      'returnAt',
      'daysToReturn',
      'returnAmountPaise',
      'recommendation'
    ];
    const lines = [
      headers.join(','),
      ...this.clients().map((row) => headers.map((key) => this.csvValue(row, key)).join(','))
    ];
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'happy-hours-client-return-tracker.csv';
    link.click();
    URL.revokeObjectURL(url);
  }

  formatMoney(value: unknown): string {
    return `Rs ${(Math.round(Number(value || 0)) / 100).toLocaleString('en-IN')}`;
  }

  pct(value: unknown): string {
    return `${Number(value || 0).toFixed(1)}%`;
  }

  formatDate(value: unknown): string {
    const seconds = Number(value || 0);
    return seconds ? new Date(seconds * 1000).toLocaleDateString() : '-';
  }

  label(value: unknown): string {
    return String(value || '').replace(/_/g, ' ');
  }

  statusClass(value: unknown): string {
    return `status-pill status-${String(value || 'pending').replace(/[^a-z0-9_-]/gi, '_').toLowerCase()}`;
  }

  private params(): ApiRecord {
    return {
      from: this.filters.from,
      to: this.filters.to,
      status: this.filters.status,
      offerType: this.filters.offerType,
      returnWindowDays: this.filters.returnWindowDays
    };
  }

  private csvValue(row: ClientReturnRow, key: string): string {
    const value = key === 'usedAt' || key === 'returnAt' ? this.formatDate(row[key]) : row[key];
    return `"${String(value ?? '').replace(/"/g, '""')}"`;
  }
}
