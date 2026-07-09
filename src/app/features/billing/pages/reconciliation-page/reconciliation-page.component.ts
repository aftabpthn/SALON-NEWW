import { CommonModule } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { catchError, firstValueFrom, forkJoin, of, Observable } from 'rxjs';
import { ApiRecord, ApiService } from '../../../../core/api.service';
import { AuthSessionService } from '../../../../core/auth-session.service';
import { grantsAllow, staticGrantsForRole } from '../../../../core/permission.guard';
import { routePermissionForPath } from '../../../../core/access-rules';
import { AppStateService } from '../../../../core/state/app-state.service';

type ProviderKey = 'razorpay' | 'upi' | 'card' | 'bank';
type InvoiceResponse = { rows?: ApiRecord[]; total?: number } | ApiRecord[];

const PROVIDER_MODES: Record<ProviderKey, string[]> = {
  razorpay: ['razorpay'],
  upi: ['upi', 'gpay', 'googlepay', 'paytm', 'phonepe'],
  card: ['card', 'credit_card', 'debit_card', 'credit', 'debit'],
  bank: ['bank', 'bank_transfer', 'neft', 'rtgs', 'imps']
};

@Component({
  selector: 'app-reconciliation-page',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  styles: [`
    .recon-shell { display: grid; gap: 16px; padding: 16px; color: #172033; }
    .hero, .panel, .metric, .settlement-card, .row-card { border: 1px solid #dbe5e8; border-radius: 8px; background: #fff; }
    .hero { display: flex; justify-content: space-between; gap: 16px; align-items: flex-start; padding: 18px; background: linear-gradient(135deg, #f8fffd, #fff 60%, #eef6fb); }
    .hero-copy, .panel, .settlement-card, .stack { display: grid; gap: 12px; }
    .eyebrow { color: #526174; font-size: .75rem; font-weight: 800; letter-spacing: 0; text-transform: uppercase; }
    h1, h2, h3, p { margin: 0; }
    h1 { font-size: clamp(1.55rem, 3vw, 2.25rem); line-height: 1.12; }
    h2 { font-size: 1.05rem; }
    .muted { color: #617086; }
    .hero-actions, .toolbar, .button-row, .form-row { display: flex; gap: 10px; flex-wrap: wrap; align-items: center; }
    .metric-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; }
    .metric { padding: 14px; min-height: 92px; display: grid; gap: 4px; }
    .metric strong { font-size: 1.5rem; }
    .grid { display: grid; grid-template-columns: minmax(0, .9fr) minmax(0, 1.1fr); gap: 16px; align-items: start; }
    button, .button, input, select { min-height: 40px; border-radius: 8px; border: 1px solid #cfdde2; padding: 0 12px; font: inherit; }
    button, .button { display: inline-flex; align-items: center; justify-content: center; gap: 8px; font-weight: 800; text-decoration: none; cursor: pointer; }
    button.primary, .button.primary { background: #5A153F; border-color: #5A153F; color: #fff; }
    button.ghost, .button.ghost { background: #fff; color: #172033; }
    button:disabled { opacity: .55; cursor: not-allowed; }
    .field { display: grid; gap: 6px; flex: 1 1 150px; }
    .field span { font-size: .82rem; color: #526174; font-weight: 800; }
    .settlement-card { padding: 14px; background: #fbfdfc; }
    .calc-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
    .calc-grid article { padding: 10px; border-radius: 8px; background: #f6faf9; display: grid; gap: 3px; }
    .row-list { display: grid; gap: 10px; }
    .row-card { padding: 14px; display: grid; gap: 8px; }
    .pill { border-radius: 999px; padding: 5px 9px; font-size: .78rem; font-weight: 800; background: #eef4f6; color: #526174; }
    .pill.ok { background: #FBF0E8; color: #7A4A28; }
    .pill.warn { background: #fff5db; color: #925400; }
    .pill.bad { background: #fff0ed; color: #b42318; }
    .empty, .error { padding: 14px; border-radius: 8px; background: #f8faf9; color: #617086; }
    .error { background: #fff0ed; color: #b42318; }
    @media (max-width: 900px) {
      .hero, .grid { display: grid; grid-template-columns: 1fr; }
      .metric-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    }
    @media (max-width: 560px) {
      .metric-grid, .calc-grid { grid-template-columns: 1fr; }
      .recon-shell { padding: 12px; }
    }
  `],
  template: `
    <section class="recon-shell inner-page-shell">
      <header class="hero inner-page-header">
        <div class="hero-copy">
          <h1>Settlement matching for Razorpay, UPI, card and bank</h1>
        </div>
        <div class="hero-actions">
          <button class="ghost" type="button" [disabled]="loading()" (click)="load()">Refresh</button>
          <a class="button ghost" routerLink="/pos/invoices" *ngIf="canAccessPath('/pos/invoices')">Invoice payments</a>
          <a class="button primary" routerLink="/billing/core-money-flow">Core Money Flow</a>
        </div>
      </header>

      <section class="metric-grid inner-stats-grid">
        <article class="metric"><strong>{{ money(providerSummary().captured) }}</strong><small class="muted">{{ providerLabel() }} collection</small></article>
        <article class="metric"><strong>{{ money(providerSummary().expected) }}</strong></article>
        <article class="metric"><strong>{{ money(providerSummary().difference) }}</strong><small class="muted">{{ providerSummary().status }}</small></article>
        <article class="metric"><strong>{{ storedRows().length }}</strong><small class="muted">{{ mismatchRows().length }} mismatch</small></article>
      </section>

      <section class="grid">
        <aside class="settlement-card inner-page-card">
          <div>
            <h2>{{ providerLabel() }}</h2>
          </div>
          <div class="form-row inner-form-grid">
            <label class="field">
              <span>Provider</span>
              <select [ngModel]="provider()" (ngModelChange)="setProvider($event)">
                <option value="razorpay">Razorpay</option>
                <option value="upi">UPI</option>
                <option value="card">Card</option>
                <option value="bank">Bank transfer</option>
              </select>
            </label>
            <label class="field">
              <span>Settlement date</span>
              <input type="date" [ngModel]="settlementDate()" (ngModelChange)="settlementDate.set($event); load()" />
            </label>
          </div>
          <div class="form-row inner-form-grid">
            <label class="field">
              <span>Settled amount</span>
              <input type="number" [ngModel]="settledAmount()" (ngModelChange)="settledAmount.set(numberValue($event))" />
            </label>
            <label class="field">
              <span>Adjustment</span>
              <input type="number" [ngModel]="adjustmentAmount()" (ngModelChange)="adjustmentAmount.set(numberValue($event))" />
            </label>
          </div>
          <div class="form-row inner-form-grid">
            <label class="field">
              <span>Fee %</span>
              <input type="number" [ngModel]="feePercent()" (ngModelChange)="feePercent.set(numberValue($event))" />
            </label>
            <label class="field">
              <span>GST on fee %</span>
              <input type="number" [ngModel]="taxPercent()" (ngModelChange)="taxPercent.set(numberValue($event))" />
            </label>
          </div>

          <div class="calc-grid">
            <article><strong>{{ money(providerSummary().captured) }}</strong></article>
            <article><strong>{{ money(providerSummary().fees) }}</strong></article>
            <article><strong>{{ money(providerSummary().taxOnFees) }}</strong></article>
            <article><strong>{{ money(providerSummary().refunds) }}</strong></article>
            <article><strong>{{ money(providerSummary().expected) }}</strong></article>
            <article><strong>{{ money(providerSummary().difference) }}</strong></article>
          </div>

          <button class="primary" type="button" [disabled]="busy()" (click)="runProviderMatch()">Run settlement match</button>
          <p class="muted" *ngIf="notice()">{{ notice() }}</p>
          <p class="error" *ngIf="error()">{{ error() }}</p>
        </aside>

        <main class="panel inner-page-card">
          <div class="toolbar inner-action-bar">
            <div>
              <h2>Mismatch review queue</h2>
            </div>
            <select [ngModel]="statusFilter()" (ngModelChange)="statusFilter.set($event); load()">
              <option value="">All statuses</option>
              <option value="matched">Matched</option>
              <option value="mismatch">Mismatch</option>
              <option value="reviewed">Reviewed</option>
              <option value="resolved">Resolved</option>
            </select>
          </div>

          <div class="row-list" *ngIf="storedRows().length; else noRows">
            <article class="row-card" *ngFor="let row of storedRows()">
              <div class="toolbar">
                <h3>{{ row['provider'] || 'provider' }} · {{ row['settlement_date'] }}</h3>
                <span class="pill" [class.ok]="row['status'] === 'matched' || row['status'] === 'resolved'" [class.warn]="row['status'] === 'reviewed'" [class.bad]="row['status'] === 'mismatch'">{{ row['status'] }}</span>
              </div>
              <p class="muted">Settlement {{ row['provider_settlement_id'] || row['id'] }}</p>
              <strong>Expected {{ money(row['expected_amount']) }} · Settled {{ money(row['settled_amount']) }} · Difference {{ money(row['difference']) }}</strong>
              <p class="muted">Fees {{ money(row['fees']) }} · GST on fees {{ money(row['tax_on_fees']) }} · Refunds {{ money(row['refunds']) }}</p>
              <div class="button-row">
                <button class="ghost" type="button" [disabled]="busy()" (click)="markReviewed(row, 'reviewed')">Mark reviewed</button>
                <button class="primary" type="button" [disabled]="busy()" (click)="markReviewed(row, 'resolved')">Resolve</button>
              </div>
            </article>
          </div>
          <ng-template #noRows><div class="empty">No reconciliation row yet. Run settlement match for the selected date.</div></ng-template>
        </main>
      </section>
    </section>
  `
})
export class ReconciliationPageComponent {
  private readonly api = inject(ApiService);
  private readonly state = inject(AppStateService);
  private readonly session = inject(AuthSessionService);

  canAccessPath(path: string): boolean {
    const permission = routePermissionForPath(path);
    if (!permission || (Array.isArray(permission) && !permission.length)) return true;
    const permissions = Array.isArray(permission) ? permission : [permission];
    const dynamicGrants = this.session.currentUser()?.permissions || [];
    const grants = Array.from(new Set([...staticGrantsForRole(this.state.userRole()), ...dynamicGrants]));
    return permissions.some((item) => grantsAllow(grants, item));
  }

  readonly provider = signal<ProviderKey>('razorpay');
  readonly settlementDate = signal(new Date().toISOString().slice(0, 10));
  readonly fromDate = signal(new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10));
  readonly settledAmount = signal(0);
  readonly adjustmentAmount = signal(0);
  readonly feePercent = signal(2);
  readonly taxPercent = signal(18);
  readonly statusFilter = signal('');
  readonly storedRows = signal<ApiRecord[]>([]);
  readonly invoices = signal<ApiRecord[]>([]);
  readonly payments = signal<ApiRecord[]>([]);
  readonly dailyOps = signal<ApiRecord | null>(null);
  readonly loading = signal(false);
  readonly busy = signal(false);
  readonly error = signal('');
  readonly notice = signal('');

  readonly mismatchRows = computed(() => this.storedRows().filter((row) => String(row['status'] || '') === 'mismatch'));
  readonly providerSummary = computed(() => {
    const captured = this.collectionForProvider(this.provider());
    const refunds = this.refundsForDate();
    const fees = this.round(captured * (this.feePercent() / 100));
    const taxOnFees = this.round(fees * (this.taxPercent() / 100));
    const expected = this.round(captured - fees - taxOnFees - refunds + this.adjustmentAmount());
    const settled = this.settledAmount() || expected;
    const difference = this.round(settled - expected);
    return {
      captured,
      fees,
      taxOnFees,
      refunds,
      expected,
      settled,
      difference,
      status: Math.abs(difference) <= 1 ? 'matched' : 'mismatch'
    };
  });

  ngOnInit(): void {
    this.load();
  }

  async load(): Promise<void> {
    this.loading.set(true);
    this.error.set('');
    try {
      const result = await firstValueFrom(forkJoin({
        reconciliations: this.safe(this.api.list<ApiRecord[]>('reconciliation', { from: this.fromDate(), to: this.settlementDate(), status: this.statusFilter() }), []),
        invoices: this.safe(this.api.list<InvoiceResponse>('billing/invoices', { from: this.settlementDate(), to: this.settlementDate(), limit: 500 }), { rows: [] }),
        payments: this.safe(this.api.list<ApiRecord[]>('payments', { limit: 1000 }), []),
        dailyOps: this.safe(this.api.list<ApiRecord | null>('balance-sheet/daily-operations', { asOfDate: this.settlementDate() }), null)
      }));
      this.storedRows.set(Array.isArray(result.reconciliations) ? result.reconciliations : []);
      this.invoices.set(this.invoiceRows(result.invoices));
      this.payments.set(Array.isArray(result.payments) ? result.payments : []);
      this.dailyOps.set(result.dailyOps || null);
      if (!this.settledAmount()) this.syncSettledAmount();
    } catch (error) {
      this.error.set(this.api.errorText(error, 'Unable to load reconciliation workspace'));
    } finally {
      this.loading.set(false);
    }
  }

  syncSettledAmount(): void {
    this.settledAmount.set(this.providerSummary().expected);
  }

  setProvider(value: string): void {
    const next = ['upi', 'card', 'bank'].includes(value) ? (value as ProviderKey) : 'razorpay';
    this.provider.set(next);
    this.syncSettledAmount();
  }

  async runProviderMatch(): Promise<void> {
    this.busy.set(true);
    this.error.set('');
    this.notice.set('');
    try {
      await firstValueFrom(this.api.post<ApiRecord>(`reconciliation/${this.provider()}/match`, {
        date: this.settlementDate(),
        settledAmount: this.settledAmount(),
        adjustmentAmount: this.adjustmentAmount(),
        feePercent: this.feePercent(),
        taxPercent: this.taxPercent()
      }));
      const summary = this.providerSummary();
      this.notice.set(`${this.providerLabel()} settlement stored: expected ${this.money(summary.expected)}, settled ${this.money(summary.settled)}, difference ${this.money(summary.difference)}.`);
      await this.load();
    } catch (error) {
      this.error.set(this.api.errorText(error, 'Settlement match failed'));
    } finally {
      this.busy.set(false);
    }
  }

  async markReviewed(row: ApiRecord, status: 'reviewed' | 'resolved'): Promise<void> {
    this.busy.set(true);
    this.error.set('');
    try {
      await firstValueFrom(this.api.post<ApiRecord>(`reconciliation/${row['id']}/mark-reviewed`, { status }));
      this.notice.set(`Reconciliation marked ${status}.`);
      await this.load();
    } catch (error) {
      this.error.set(this.api.errorText(error, 'Unable to update reconciliation row'));
    } finally {
      this.busy.set(false);
    }
  }

  providerLabel(): string {
    const labels: Record<ProviderKey, string> = { razorpay: 'Razorpay', upi: 'UPI', card: 'Card', bank: 'Bank transfer' };
    return labels[this.provider()];
  }

  money(value: unknown): string {
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(this.numberValue(value));
  }

  numberValue(value: unknown): number {
    const amount = Number(value || 0);
    return Number.isFinite(amount) ? amount : 0;
  }

  private collectionForProvider(provider: ProviderKey): number {
    const modes = PROVIDER_MODES[provider];
    const fromPayments = this.payments()
      .filter((payment) => modes.some((mode) => this.modeText(payment).includes(mode)))
      .reduce((sum, payment) => sum + this.numberValue(payment['amount'] ?? payment['paid_amount']), 0);
    if (fromPayments > 0) return this.round(fromPayments);
    const daily = this.dailyOps();
    if (provider === 'upi') return this.numberValue(daily?.['cashBankReconciliation']?.['bankCollection']);
    if (provider === 'card' || provider === 'bank') return this.numberValue(daily?.['cashBankReconciliation']?.['expectedBankNet']);
    return this.invoices().reduce((sum, invoice) => sum + this.numberValue(invoice['paid_amount']), 0);
  }

  private refundsForDate(): number {
    return this.invoices().reduce((sum, invoice) => sum + this.numberValue(invoice['refund_amount']), 0);
  }

  private modeText(payment: ApiRecord): string {
    return String(payment['payment_mode'] || payment['mode'] || payment['provider'] || '').toLowerCase().replace(/\s+/g, '_');
  }

  private invoiceRows(response: InvoiceResponse): ApiRecord[] {
    if (Array.isArray(response)) return response;
    return Array.isArray(response?.rows) ? response.rows : [];
  }

  private round(value: number): number {
    return Math.round((Number(value) || 0) * 100) / 100;
  }

  private safe<T>(source: Observable<T>, fallback: T): Observable<T> {
    return source.pipe(catchError(() => of(fallback)));
  }
}
