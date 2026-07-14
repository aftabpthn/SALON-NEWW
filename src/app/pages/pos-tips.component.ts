import { CommonModule } from '@angular/common';
import { Component, OnInit, computed, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ApiRecord, ApiService } from '../core/api.service';
import { PosPaymentMode, PosSettingsService } from '../core/pos-settings.service';
import { DATE_RANGE_PRESETS, DateRangePreset, rangeForPreset, todayKey } from '../shared/date-range-presets';
import { StateComponent } from '../shared/ui/state/state.component';
import { AuraMoneyPipe } from '../shared/pipes/aura-money.pipe';

type TipLedgerRow = {
  id: string;
  tipId: string;
  date: string;
  time: string;
  invoiceId: string;
  invoiceNumber: string;
  saleType: string;
  clientId: string;
  clientPhone: string;
  saleId: string;
  clientName: string;
  staffId: string;
  staffName: string;
  staffPhone: string;
  receiverStaff: string;
  paymentMode: string;
  tipPaymentMode: string;
  collectedBy: string;
  settlementPaymentId: string;
  paymentReference: string;
  branchName: string;
  branchId: string;
  amount: number;
  tipAmount: number;
  createdAt: string;
  invoiceStatus: string;
  invoiceTotal: number;
  paidAmount: number;
  dueAmount: number;
  tipStatus: string;
  payoutDate: string;
  payoutReference: string;
  source: string;
};
type StaffTipSummaryRow = {
  staffId: string;
  staffName: string;
  tipCount: number;
  totalTips: number;
  cashTips: number;
  digitalTips: number;
  pendingPayout: number;
  paidOut: number;
  averageTip: number;
  serviceRevenue: number;
  tipToSalePercent: number;
  clients: number;
};
type TipAlert = {
  alertType: string;
  invoiceNumber: string;
  clientName: string;
  staffName: string;
  amount: number;
  riskLevel: string;
  suggestedAction: string;
};
type TipsReport = {
  summary: ApiRecord;
  rows: TipLedgerRow[];
  staffSummary: StaffTipSummaryRow[];
  alerts: TipAlert[];
};

@Component({
  selector: 'app-pos-tips',
  standalone: true,
  imports: [AuraMoneyPipe, CommonModule, FormsModule, RouterLink, StateComponent],
  template: `
    <section class="page-stack inner-page-shell">
      <div class="module-hero inner-page-header">
        <div>
          <h2>Staff Tips / Tip Payout Register</h2>
        </div>
        <div class="hero-actions">
          <a class="ghost-button" routerLink="/pos">Back to POS</a>
          <a class="ghost-button" routerLink="/reports/staff-sales">Staff Sales</a>
          <a class="ghost-button" routerLink="/reports/financial-summary">Financial Summary</a>
          <button class="ghost-button" type="button" (click)="exportCsv()" [disabled]="!rows().length">Ledger CSV</button>
          <button class="ghost-button" type="button" (click)="exportPayoutPdf()" [disabled]="!rows().length">Payout PDF</button>
          <button class="primary-button" type="button" (click)="load()">Refresh</button>
        </div>
      </div>

      <section class="panel filter-panel tip-filter-panel inner-page-card">
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
        <label class="field">
          <span>From</span>
          <input type="date" [ngModel]="from" (ngModelChange)="updateCustomDate('from', $event)" />
        </label>
        <label class="field">
          <span>To</span>
          <input type="date" [ngModel]="to" (ngModelChange)="updateCustomDate('to', $event)" />
        </label>
        <label class="field">
          <span>Staff</span>
          <input [(ngModel)]="staffId" placeholder="Staff ID" />
        </label>
        <label class="field">
          <span>Client</span>
          <input [(ngModel)]="client" placeholder="Client name or phone" />
        </label>
        <label class="field">
          <span>Invoice no</span>
          <input [(ngModel)]="invoice" placeholder="Invoice no" />
        </label>
        <label class="field">
          <span>Payment mode</span>
          <select [(ngModel)]="paymentMode">
            <option value="">All modes</option>
            <option *ngFor="let mode of paymentModes()" [value]="mode.id">{{ mode.label }}</option>
          </select>
        </label>
        <label class="field">
          <span>Tip status</span>
          <select [(ngModel)]="tipStatus">
            <option value="">All statuses</option>
            <option value="pending_payout">Pending payout</option>
            <option value="paid_out">Paid out</option>
            <option value="reversed">Reversed</option>
          </select>
        </label>
        <label class="field">
          <span>Sale type</span>
          <select [(ngModel)]="saleType">
            <option value="">All sale types</option>
            <option value="quick_sale">Quick Sale</option>
            <option value="appointment">Appointment</option>
          </select>
        </label>
        <label class="field">
          <span>Cashier / collected by</span>
          <input [(ngModel)]="cashier" placeholder="Cashier or user" />
        </label>
        <label class="field">
          <span>Branch</span>
          <input [(ngModel)]="branchId" placeholder="Branch ID" />
        </label>
        <label class="field search-field">
          <span>Search</span>
          <input [(ngModel)]="query" placeholder="Invoice, client, phone, staff" />
        </label>
        <button class="primary-button" type="button" (click)="load()">Apply filters</button>
      </section>

      <app-state [loading]="loading()" [error]="error()"></app-state>

      <ng-container *ngIf="!loading()">
        <div class="metrics-grid">
          <article class="metric-card"><span>Total tips</span><strong>{{ (summary().totalTips || 0) | auraMoney:'1.0-0' }}</strong><small>{{ summary().tipCount || 0 }} tips</small></article>
          <article class="metric-card"><span>Cash tips</span><strong>{{ (summary().cashTips || 0) | auraMoney:'1.0-0' }}</strong></article>
          <article class="metric-card"><span>Digital tips</span><strong>{{ (summary().digitalTips || 0) | auraMoney:'1.0-0' }}</strong></article>
          <article class="metric-card"><span>Pending payout</span><strong>{{ (summary().pendingPayout || 0) | auraMoney:'1.0-0' }}</strong></article>
          <article class="metric-card"><span>Paid out tips</span><strong>{{ (summary().paidOutTips || 0) | auraMoney:'1.0-0' }}</strong></article>
          <article class="metric-card"><span>Reversed tips</span><strong>{{ (summary().reversedTips || 0) | auraMoney:'1.0-0' }}</strong></article>
          <article class="metric-card"><span>Top tipped staff</span><strong>{{ summary().topTippedStaff || '-' }}</strong><small>{{ (summary().topTippedStaffAmount || 0) | auraMoney:'1.0-0' }}</small></article>
          <article class="metric-card"><span>Avg tip / invoice</span><strong>{{ (summary().averageTipPerInvoice || 0) | auraMoney:'1.0-0' }}</strong></article>
          <article class="metric-card"><span>Tip % of service revenue</span><strong>{{ summary().tipPercentOfServiceRevenue || 0 }}%</strong></article>
          <article class="metric-card"><span>Audit alerts</span><strong>{{ summary().alerts || 0 }}</strong></article>
        </div>

        <section class="panel" *ngIf="alerts().length">
          <div class="section-title">
            <div>
              <h2>Tip payout alerts</h2>
            </div>
          </div>
          <div class="alert-grid">
            <article class="alert-card" *ngFor="let alert of alerts()">
              <strong>{{ alert.alertType }}</strong>
              <span>{{ alert.clientName }} · {{ alert.staffName }} · {{ alert.amount | auraMoney:'1.0-0' }}</span>
              <small>{{ alert.riskLevel }} risk · {{ alert.suggestedAction }}</small>
            </article>
          </div>
        </section>

        <section class="panel">
          <div class="section-title">
            <div>
              <h2>Invoice tip payout queue</h2>
            </div>
            <div class="section-actions">
              <input [(ngModel)]="payoutReference" placeholder="Payout reference" />
              <input [(ngModel)]="payoutNote" placeholder="Payout note" />
              <button class="primary-button mini" type="button" (click)="markSelectedPaidOut()" [disabled]="!selectedTipIds().size">Mark payout</button>
            </div>
          </div>

          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th><input type="checkbox" [checked]="allSelected()" (change)="toggleAll($event)" /></th>
                  <th>Date</th>
                  <th>Time</th>
                  <th>Invoice no</th>
                  <th>Sale type</th>
                  <th>Client</th>
                  <th>Phone</th>
                  <th>Staff</th>
                  <th>Staff ID</th>
                  <th class="right">Tip amount</th>
                  <th>Mode</th>
                  <th>Collected by</th>
                  <th>Receiver staff</th>
                  <th>Payment ID</th>
                  <th class="right">Invoice total</th>
                  <th class="right">Paid</th>
                  <th class="right">Due</th>
                  <th>Status</th>
                  <th>Payout</th>
                  <th>Branch</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                <tr *ngFor="let row of rows()" (click)="selected.set(row)" class="click-row">
                  <td><input type="checkbox" [checked]="isSelected(row.tipId)" (click)="$event.stopPropagation()" (change)="toggleTip(row.tipId)" /></td>
                  <td>{{ row.date }}</td>
                  <td>{{ row.time }}</td>
                  <td><a routerLink="/pos/invoices" [queryParams]="{ q: row.invoiceNumber }">{{ row.invoiceNumber }}</a></td>
                  <td>{{ row.saleType }}</td>
                  <td><strong>{{ row.clientName }}</strong></td>
                  <td>{{ row.clientPhone }}</td>
                  <td>{{ row.staffName }}</td>
                  <td>{{ row.staffId || '-' }}</td>
                  <td class="right"><strong>{{ row.amount | auraMoney:'1.0-0' }}</strong></td>
                  <td><span class="badge">{{ modeLabel(row.paymentMode) }}</span></td>
                  <td>{{ row.collectedBy }}</td>
                  <td>{{ row.receiverStaff }}</td>
                  <td>{{ row.settlementPaymentId }}</td>
                  <td class="right">{{ row.invoiceTotal | auraMoney:'1.0-0' }}</td>
                  <td class="right">{{ row.paidAmount | auraMoney:'1.0-0' }}</td>
                  <td class="right">{{ row.dueAmount | auraMoney:'1.0-0' }}</td>
                  <td><span class="badge" [class.warn]="row.tipStatus === 'pending_payout'" [class.danger]="row.tipStatus === 'reversed'">{{ statusLabel(row.tipStatus) }}</span></td>
                  <td>{{ row.payoutDate || '-' }} <span *ngIf="row.payoutReference">· {{ row.payoutReference }}</span></td>
                  <td>{{ row.branchName }}</td>
                  <td class="action-cell">
                    <a class="ghost-button mini" routerLink="/pos/invoices" [queryParams]="{ q: row.invoiceNumber }">Invoice</a>
                    <a class="ghost-button mini" routerLink="/clients" [queryParams]="{ q: row.clientPhone || row.clientName }">Client</a>
                    <a class="ghost-button mini" routerLink="/staff-os/staff-profile" [queryParams]="{ staffId: row.staffId }">Staff</a>
                    <button class="ghost-button mini" type="button" (click)="markPaidOut(row); $event.stopPropagation()" [disabled]="row.tipStatus === 'paid_out'">Payout</button>
                    <button class="ghost-button mini danger-text" type="button" (click)="markReversed(row); $event.stopPropagation()" [disabled]="row.tipStatus === 'reversed'">Reverse</button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <p class="inline-hint" *ngIf="!rows().length">No tips recorded. Add tips from POS checkout.</p>
        </section>

        <section class="panel" *ngIf="selected() as row">
          <div class="section-title">
            <div>
              <h2>{{ row.clientName }} paid {{ row.amount | auraMoney:'1.0-0' }}</h2>
            </div>
            <a class="ghost-button mini" routerLink="/pos/invoices" [queryParams]="{ q: row.invoiceNumber }">Open invoice</a>
          </div>
          <div class="info-grid">
            <div><span>Invoice</span><strong>{{ row.invoiceNumber }}</strong></div>
            <div><span>Staff</span><strong>{{ row.staffName }}</strong></div>
            <div><span>Payment mode</span><strong>{{ modeLabel(row.paymentMode) }}</strong></div>
            <div><span>Status</span><strong>{{ statusLabel(row.tipStatus) }}</strong></div>
            <div><span>Branch</span><strong>{{ row.branchName }}</strong></div>
          </div>
        </section>

        <section class="panel">
          <div class="section-title">
            <div>
              <h2>Staff payout summary</h2>
            </div>
          </div>
          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Staff name</th>
                  <th>Tip count</th>
                  <th class="right">Total tips</th>
                  <th class="right">Cash tips</th>
                  <th class="right">Digital tips</th>
                  <th class="right">Pending payout</th>
                  <th class="right">Paid out</th>
                  <th class="right">Average tip</th>
                  <th class="right">Service revenue</th>
                  <th class="right">Tip-to-sale %</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                <tr *ngFor="let staff of staffSummary()">
                  <td><strong>{{ staff.staffName }}</strong><small>{{ staff.staffId }}</small></td>
                  <td>{{ staff.tipCount }}</td>
                  <td class="right">{{ staff.totalTips | auraMoney:'1.0-0' }}</td>
                  <td class="right">{{ staff.cashTips | auraMoney:'1.0-0' }}</td>
                  <td class="right">{{ staff.digitalTips | auraMoney:'1.0-0' }}</td>
                  <td class="right">{{ staff.pendingPayout | auraMoney:'1.0-0' }}</td>
                  <td class="right">{{ staff.paidOut | auraMoney:'1.0-0' }}</td>
                  <td class="right">{{ staff.averageTip | auraMoney:'1.0-0' }}</td>
                  <td class="right">{{ staff.serviceRevenue | auraMoney:'1.0-0' }}</td>
                  <td class="right">{{ staff.tipToSalePercent }}%</td>
                  <td><a class="ghost-button mini" routerLink="/staff-os/staff-profile" [queryParams]="{ staffId: staff.staffId }">Staff 360</a></td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
      </ng-container>
    </section>
  `,
  styles: [`
    :host .tip-filter-panel {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 12px 14px;
      align-items: end;
    }

    :host .tip-filter-panel .field {
      min-width: 0;
    }

    :host .tip-filter-panel .search-field {
      grid-column: span 2;
    }

    :host .tip-filter-panel .primary-button {
      min-height: 48px;
      align-self: end;
    }

    @media (max-width: 1100px) {
      :host .tip-filter-panel {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }
    }

    @media (max-width: 720px) {
      :host .tip-filter-panel {
        grid-template-columns: 1fr;
      }

      :host .tip-filter-panel .search-field {
        grid-column: auto;
      }
    }
  `]
})
export class PosTipsComponent implements OnInit {
  readonly rows = signal<TipLedgerRow[]>([]);
  readonly staffSummary = signal<StaffTipSummaryRow[]>([]);
  readonly alerts = signal<TipAlert[]>([]);
  readonly summary = signal<ApiRecord>({});
  readonly paymentModes = signal<PosPaymentMode[]>([]);
  readonly selected = signal<TipLedgerRow | null>(null);
  readonly selectedTipIds = signal<Set<string>>(new Set());
  readonly loading = signal(true);
  readonly error = signal('');
  readonly hasSelection = computed(() => this.selectedTipIds().size > 0);
  readonly datePresets = DATE_RANGE_PRESETS;
  datePreset: DateRangePreset = 'today';
  from = todayKey();
  to = todayKey();
  staffId = '';
  client = '';
  invoice = '';
  paymentMode = '';
  tipStatus = '';
  saleType = '';
  cashier = '';
  branchId = '';
  query = '';
  payoutReference = '';
  payoutNote = '';

  constructor(private readonly api: ApiService, private readonly settings: PosSettingsService) {}

  ngOnInit(): void {
    this.paymentModes.set(this.settings.loadPaymentModes());
    this.settings.loadPaymentModesRemote().subscribe((modes) => this.paymentModes.set(modes));
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.error.set('');
    this.api.list<TipsReport>('tips/report', this.params()).subscribe({
      next: (report) => {
        this.summary.set(report.summary || {});
        this.rows.set(report.rows || []);
        this.staffSummary.set(report.staffSummary || []);
        this.alerts.set(report.alerts || []);
        this.selectedTipIds.set(new Set());
        this.selected.set(this.rows()[0] || null);
        this.loading.set(false);
      },
      error: (error) => {
        this.error.set(this.api.errorText(error, 'Unable to load tip register'));
        this.loading.set(false);
      }
    });
  }

  params(): ApiRecord {
    const scopedRange = this.datePreset === 'all' ? { from: '', to: '' } : { from: this.from, to: this.to || this.from };
    return {
      ...scopedRange,
      staffId: this.staffId,
      client: this.client,
      invoice: this.invoice,
      paymentMode: this.paymentMode,
      tipStatus: this.tipStatus,
      saleType: this.saleType,
      cashier: this.cashier,
      branchId: this.branchId,
      q: this.query,
      limit: this.datePreset === 'all' ? 1000 : 100
    };
  }

  applyDatePreset(preset: DateRangePreset): void {
    const range = rangeForPreset(preset, { preset: this.datePreset, from: this.from, to: this.to });
    this.datePreset = range.preset;
    this.from = range.from;
    this.to = range.to;
    this.load();
  }

  updateCustomDate(field: 'from' | 'to', value: string): void {
    this.datePreset = 'custom';
    if (field === 'from') this.from = value;
    else this.to = value;
  }

  toggleTip(tipId: string): void {
    const next = new Set(this.selectedTipIds());
    next.has(tipId) ? next.delete(tipId) : next.add(tipId);
    this.selectedTipIds.set(next);
  }

  toggleAll(event: Event): void {
    const checked = (event.target as HTMLInputElement).checked;
    this.selectedTipIds.set(checked ? new Set(this.rows().map((row) => row.tipId)) : new Set());
  }

  allSelected(): boolean {
    return Boolean(this.rows().length) && this.selectedTipIds().size === this.rows().length;
  }

  isSelected(tipId: string): boolean {
    return this.selectedTipIds().has(tipId);
  }

  markSelectedPaidOut(): void {
    this.sendPayout([...this.selectedTipIds()]);
  }

  markPaidOut(row: TipLedgerRow): void {
    this.sendPayout([row.tipId]);
  }

  markReversed(row: TipLedgerRow): void {
    this.api.post(`tips/${row.tipId}/mark-reversed`, { note: this.payoutNote || 'Manual reverse from Tip Register' }).subscribe({
      next: () => this.load(),
      error: (error) => this.error.set(this.api.errorText(error, 'Unable to reverse tip'))
    });
  }

  sendPayout(tipIds: string[]): void {
    if (!tipIds.length) return;
    this.api.post('tips/payout', { tipIds, payoutReference: this.payoutReference, note: this.payoutNote }).subscribe({
      next: () => {
        this.payoutReference = '';
        this.payoutNote = '';
        this.load();
      },
      error: (error) => this.error.set(this.api.errorText(error, 'Unable to mark payout'))
    });
  }

  modeLabel(modeId: string): string {
    return this.paymentModes().find((mode) => mode.id === modeId)?.label || modeId;
  }

  statusLabel(status: string): string {
    return String(status || 'collected').replace(/_/g, ' ');
  }

  exportCsv(): void {
    const headers = ['Date', 'Time', 'Invoice no', 'Sale type', 'Client', 'Phone', 'Staff', 'Staff ID', 'Tip amount', 'Payment mode', 'Cashier', 'Payment ID', 'Invoice total', 'Paid', 'Due', 'Status', 'Payout date', 'Payout reference', 'Branch'];
    const rows = this.rows().map((row) => [
      row.date, row.time, row.invoiceNumber, row.saleType, row.clientName, row.clientPhone, row.staffName, row.staffId,
      row.amount, row.paymentMode, row.collectedBy, row.settlementPaymentId, row.invoiceTotal, row.paidAmount, row.dueAmount,
      row.tipStatus, row.payoutDate, row.payoutReference, row.branchName
    ]);
    this.downloadFile('tips-ledger.csv', [headers, ...rows].map((row) => row.map((value) => `"${String(value ?? '').replace(/"/g, '""')}"`).join(',')).join('\n'), 'text/csv;charset=utf-8');
  }

  exportPayoutPdf(): void {
    const summary = this.summary();
    const lines = [
      'Staff Tips Payout Summary',
      `Total tips: ${this.money(summary.totalTips || 0)}`,
      `Pending payout: ${this.money(summary.pendingPayout || 0)}`,
      `Paid out tips: ${this.money(summary.paidOutTips || 0)}`,
      `Reversed tips: ${this.money(summary.reversedTips || 0)}`,
      `Alerts: ${summary.alerts || 0}`,
      '',
      'Top staff',
      ...this.staffSummary().slice(0, 10).map((staff) => `${staff.staffName}: ${staff.totalTips} (${staff.tipCount} tips)`)
    ];
    this.downloadFile('tip-payout-summary.pdf', lines.join('\n'), 'application/pdf');
  }

  private downloadFile(filename: string, content: string, type: string): void {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  private money(value: number | string): number {
    return Math.round((Number(value) || 0) * 100) / 100;
  }
}
