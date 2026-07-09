import { CommonModule } from '@angular/common';
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ApiRecord, ApiService } from '../core/api.service';
import { PosPaymentMode, PosSettingsService } from '../core/pos-settings.service';
import { DATE_RANGE_PRESETS, DateRangePreset, rangeForPreset, todayKey } from '../shared/date-range-presets';

type PaymentModeSummary = {
  mode: string;
  amount: number;
  count: number;
  invoiceCount: number;
};

type PaymentModeReportRow = {
  paymentId: string;
  invoiceId: string;
  invoiceNo: string;
  clientId: string;
  staffId: string;
  mode: string;
  amount: number;
  paidAt: string;
  referenceNo: string;
  notes: string;
  status: string;
  invoiceTotal: number;
  invoicePaid: number;
  invoiceDue: number;
  invoiceStatus: string;
  paymentStatus: string;
};

type PaymentModeReport = {
  from: string;
  to: string;
  total: number;
  summary: PaymentModeSummary[];
  rows: PaymentModeReportRow[];
};

@Component({
  selector: 'app-payment-mode-report',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  template: `
    <section class="page-stack payment-mode-report inner-page-shell">
      <div class="module-hero inner-page-header">
        <div>
          <span class="eyebrow">Accounts report</span>
          <h2>Payment mode collection</h2>
          <p>Cash, UPI, card, wallet aur custom payment modes ka daily collection report.</p>
        </div>
        <div class="hero-actions inner-action-bar">
          <a class="ghost-button" routerLink="/pos/payment-modes">Payment modes</a>
          <a class="ghost-button" routerLink="/pos">Back to POS</a>
        </div>
      </div>

      <section class="panel report-filter-panel inner-page-card">
        <label class="field" *ngIf="datePreset !== 'all'">
          <span>From</span>
          <input type="date" [ngModel]="fromDate" (ngModelChange)="updateCustomDate('from', $event)" />
        </label>
        <label class="field" *ngIf="datePreset !== 'today' && datePreset !== 'all'">
          <span>To</span>
          <input type="date" [ngModel]="toDate" (ngModelChange)="updateCustomDate('to', $event)" />
        </label>
        <div class="date-preset-actions">
          <button
            class="ghost-button mini"
            type="button"
            *ngFor="let preset of datePresets"
            [class.active-filter-card]="datePreset === preset.value"
            (click)="applyDatePreset(preset.value)"
          >
            {{ preset.label }}
          </button>
        </div>
        <button class="primary-button" type="button" (click)="load()">Apply</button>
      </section>

      <section class="payment-kpi-grid">
        <button class="metric-card teal" type="button" [class.active-filter-card]="!selectedMode()" (click)="selectMode('')">
          <span>Total collection</span>
          <strong>{{ money(report().total) }}</strong>
          <small>{{ report().rows.length }} payment row(s)</small>
        </button>
        <button
          class="metric-card"
          type="button"
          *ngFor="let card of modeCards()"
          [class.active-filter-card]="selectedMode() === card.id"
          (click)="selectMode(card.id)"
        >
          <span>{{ card.label }}</span>
          <strong>{{ money(card.amount) }}</strong>
          <small>{{ card.count }} payment · {{ card.invoiceCount }} invoice</small>
        </button>
      </section>

      <section class="panel">
        <div class="section-title">
          <div>
            <span class="eyebrow">{{ selectedMode() ? modeLabel(selectedMode()) : 'All modes' }}</span>
            <h2>Payment details</h2>
          </div>
          <span class="report-total">{{ money(selectedTotal()) }}</span>
        </div>
        <p class="inline-hint danger" *ngIf="error()">{{ error() }}</p>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Time</th>
                <th>Mode</th>
                <th>Invoice</th>
                <th>Client</th>
                <th>Amount</th>
                <th>Reference</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              <tr *ngFor="let row of selectedRows()">
                <td>{{ shortDateTime(row.paidAt) }}</td>
                <td>{{ modeLabel(row.mode) }}</td>
                <td>
                  <strong>{{ row.invoiceNo || row.invoiceId }}</strong>
                  <small>{{ money(row.invoiceTotal) }} bill · due {{ money(row.invoiceDue) }}</small>
                </td>
                <td>{{ row.clientId || '-' }}</td>
                <td><strong>{{ money(row.amount) }}</strong></td>
                <td>{{ row.referenceNo || row.notes || '-' }}</td>
                <td>{{ label(row.paymentStatus || row.status) }}</td>
              </tr>
              <tr *ngIf="!loading() && !selectedRows().length">
                <td colspan="7">Selected date range me payment collection nahi mila.</td>
              </tr>
              <tr *ngIf="loading()">
                <td colspan="7">Loading payment mode report...</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </section>
  `,
  styles: [`
    :host .report-filter-panel {
      display: grid;
      grid-template-columns: 180px 180px minmax(260px, 1fr) auto;
      gap: 12px;
      align-items: end;
    }

    :host .date-preset-actions {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
    }

    :host .payment-kpi-grid {
      display: grid;
      grid-template-columns: repeat(5, minmax(0, 1fr));
      gap: 12px;
    }

    :host .payment-kpi-grid .metric-card {
      cursor: pointer;
      text-align: left;
    }

    :host .report-total {
      color: #0f172a;
      font-size: 22px;
      font-weight: 800;
    }

    :host td small {
      display: block;
      color: #64748b;
      font-size: 12px;
      font-weight: 700;
      margin-top: 3px;
    }

    @media (max-width: 1100px) {
      :host .payment-kpi-grid {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }
    }

    @media (max-width: 720px) {
      :host .report-filter-panel,
      :host .payment-kpi-grid {
        grid-template-columns: 1fr;
      }
    }
  `]
})
export class PaymentModeReportComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly settings = inject(PosSettingsService);

  readonly modes = signal<PosPaymentMode[]>([]);
  readonly report = signal<PaymentModeReport>({ from: '', to: '', total: 0, summary: [], rows: [] });
  readonly selectedMode = signal('');
  readonly loading = signal(false);
  readonly error = signal('');

  readonly datePresets = DATE_RANGE_PRESETS;
  datePreset: DateRangePreset = 'today';
  fromDate = todayKey();
  toDate = todayKey();

  readonly summaryByMode = computed(() => new Map(this.report().summary.map((row) => [row.mode, row])));
  readonly modeCards = computed(() => {
    const cards = this.modes()
      .filter((mode) => mode.active)
      .map((mode) => {
        const summary = this.summaryByMode().get(mode.id);
        return {
          id: mode.id,
          label: mode.label,
          amount: Number(summary?.amount || 0),
          count: Number(summary?.count || 0),
          invoiceCount: Number(summary?.invoiceCount || 0)
        };
      });
    const configured = new Set(cards.map((card) => card.id));
    for (const row of this.report().summary) {
      if (configured.has(row.mode)) continue;
      cards.push({
        id: row.mode,
        label: this.label(row.mode),
        amount: Number(row.amount || 0),
        count: Number(row.count || 0),
        invoiceCount: Number(row.invoiceCount || 0)
      });
    }
    return cards.sort((left, right) => right.amount - left.amount || left.label.localeCompare(right.label));
  });
  readonly selectedRows = computed(() => {
    const mode = this.selectedMode();
    return mode ? this.report().rows.filter((row) => row.mode === mode) : this.report().rows;
  });
  readonly selectedTotal = computed(() => this.selectedRows().reduce((sum, row) => sum + Number(row.amount || 0), 0));

  ngOnInit(): void {
    this.modes.set(this.settings.loadPaymentModes());
    this.settings.loadPaymentModesRemote().subscribe((modes) => this.modes.set(modes));
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.error.set('');
    const params = this.datePreset === 'all'
      ? { from: '1970-01-01', to: todayKey() }
      : { from: this.fromDate, to: this.toDate };
    this.api.list<PaymentModeReport>('billing-analytics/payment-mode-report', params).subscribe({
      next: (report) => {
        this.report.set({
          from: report?.from || this.fromDate,
          to: report?.to || this.toDate,
          total: Number(report?.total || 0),
          summary: Array.isArray(report?.summary) ? report.summary : [],
          rows: Array.isArray(report?.rows) ? report.rows : []
        });
        this.loading.set(false);
      },
      error: (error) => {
        this.error.set(this.api.errorText(error, 'Payment mode report load nahi ho paya.'));
        this.loading.set(false);
      }
    });
  }

  selectMode(mode: string): void {
    this.selectedMode.set(mode);
  }

  applyDatePreset(preset: DateRangePreset): void {
    this.datePreset = preset;
    const range = rangeForPreset(preset, { from: this.fromDate, to: this.toDate });
    this.fromDate = range.from;
    this.toDate = range.to;
    this.load();
  }

  updateCustomDate(side: 'from' | 'to', value: string): void {
    this.datePreset = 'custom';
    if (side === 'from') this.fromDate = value;
    else this.toDate = value;
    if (!this.toDate) this.toDate = this.fromDate;
  }

  modeLabel(modeId: string): string {
    return this.modes().find((mode) => mode.id === modeId)?.label || this.label(modeId || 'mode');
  }

  money(value: unknown): string {
    return `₹${Number(value || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
  }

  label(value: string): string {
    return String(value || '').replace(/[-_]/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase());
  }

  shortDateTime(value: string): string {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '-';
    return date.toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: 'numeric', minute: '2-digit' });
  }

}
