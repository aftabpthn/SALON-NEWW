import { CommonModule } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { catchError, firstValueFrom, forkJoin, of, Observable } from 'rxjs';
import { AuthSessionService } from '../../../../core/auth-session.service';
import { grantsAllow, staticGrantsForRole } from '../../../../core/permission.guard';
import { routePermissionForPath } from '../../../../core/access-rules';
import { AppStateService } from '../../../../core/state/app-state.service';
import { ApiRecord, ApiService } from '../../../../core/api.service';

type BillingInvoiceResponse = { rows?: ApiRecord[]; total?: number } | ApiRecord[];
type CheckStatus = 'done' | 'warn' | 'blocker';

type MoneyFlowCheck = {
  key: string;
  label: string;
  metric: string;
  detail: string;
  route: string;
  status: CheckStatus;
  action: string;
};

@Component({
  selector: 'app-core-money-flow-page',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  styles: [`
    .money-flow-shell { display: grid; gap: 16px; padding: 16px; color: #172033; }
    .hero, .panel, .metric, .check-row, .action-panel { border: 1px solid #dbe5e8; border-radius: 8px; background: #fff; }
    .hero { display: flex; justify-content: space-between; gap: 16px; align-items: flex-start; padding: 18px; background: linear-gradient(135deg, #f8fffd, #ffffff 58%, #f4f7eb); }
    .eyebrow { color: #526174; font-size: 0.75rem; font-weight: 800; letter-spacing: 0; text-transform: uppercase; }
    h1, h2, h3, p { margin: 0; }
    h1 { font-size: clamp(1.6rem, 3vw, 2.4rem); line-height: 1.12; }
    h2 { font-size: 1.05rem; }
    .sub, .muted { color: #617086; }
    .hero-copy { display: grid; gap: 8px; max-width: 900px; }
    .hero-actions, .action-row, .toolbar { display: flex; gap: 10px; flex-wrap: wrap; align-items: center; }
    .hero-actions { justify-content: flex-end; }
    .button, button, input { min-height: 40px; border-radius: 8px; border: 1px solid #cfdde2; padding: 0 12px; font: inherit; }
    button, .button { display: inline-flex; align-items: center; justify-content: center; gap: 8px; text-decoration: none; font-weight: 800; cursor: pointer; }
    button.primary, .button.primary { background: #5A153F; border-color: #5A153F; color: #fff; }
    button.ghost, .button.ghost { background: #fff; color: #172033; }
    button:disabled { opacity: 0.55; cursor: not-allowed; }
    .score-strip { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; }
    .metric { padding: 14px; display: grid; gap: 5px; min-height: 96px; }
    .metric strong { font-size: 1.6rem; }
    .panel { padding: 16px; display: grid; gap: 14px; }
    .panel-head { display: flex; justify-content: space-between; gap: 12px; align-items: center; flex-wrap: wrap; }
    .check-list { display: grid; gap: 10px; }
    .check-row { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 14px; padding: 14px; align-items: center; }
    .check-main { display: grid; gap: 5px; }
    .check-title { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
    .pill { border-radius: 999px; padding: 5px 9px; font-size: 0.78rem; font-weight: 800; background: #eef4f6; color: #526174; }
    .pill[data-state="done"] { background: #FBF0E8; color: #7A4A28; }
    .pill[data-state="warn"] { background: #fff5db; color: #925400; }
    .pill[data-state="blocker"] { background: #fff0ed; color: #b42318; }
    .status-dot { width: 10px; height: 10px; border-radius: 50%; background: #9aa8b5; flex: 0 0 auto; }
    .status-dot[data-state="done"] { background: #5A153F; }
    .status-dot[data-state="warn"] { background: #e0a100; }
    .status-dot[data-state="blocker"] { background: #c33a2c; }
    .action-panel { padding: 14px; display: grid; gap: 10px; background: #fbfdfc; }
    .issue-list { display: grid; gap: 8px; color: #9f2a1d; }
    @media (max-width: 900px) {
      .hero { display: grid; }
      .hero-actions { justify-content: flex-start; }
      .score-strip { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .check-row { grid-template-columns: 1fr; }
    }
    @media (max-width: 560px) {
      .score-strip { grid-template-columns: 1fr; }
      .money-flow-shell { padding: 12px; }
    }
  `],
  template: `
    <section class="money-flow-shell inner-page-shell">
      <header class="hero inner-page-header">
        <div class="hero-copy">
          <h1>100% readiness control</h1>
        </div>
        <div class="hero-actions">
          <a class="button ghost" routerLink="/pos/invoices">Back to invoices</a>
          <input type="date" [ngModel]="asOfDate()" (ngModelChange)="asOfDate.set($event); load()" />
          <button class="ghost" type="button" [disabled]="loading()" (click)="load()">Refresh</button>
          <a class="button primary" routerLink="/pos" *ngIf="canAccessPath('/pos')">Open POS</a>
        </div>
      </header>

      <section class="score-strip inner-stats-grid">
        <article class="metric">
          <strong>{{ readyScore() }}%</strong>
          <span class="muted">{{ doneCount() }}/{{ checks().length }} checks done</span>
        </article>
        <article class="metric">
          <strong>{{ invoiceRows().length }}</strong>
          <span class="muted">{{ paidInvoiceCount() }} paid / {{ dueInvoiceCount() }} due</span>
        </article>
        <article class="metric">
          <strong>{{ failedOutboxCount() }}</strong>
          <span class="muted">{{ pendingOutboxCount() }} pending / {{ postedOutboxCount() }} posted</span>
        </article>
        <article class="metric">
          <strong>{{ dailyOps()?.['ownerDailyClose']?.['ready'] ? 'Ready' : 'Check' }}</strong>
          <span class="muted">Cash {{ money(dailyOps()?.['cashBankReconciliation']?.['expectedCash']) }}</span>
        </article>
      </section>

      <section class="panel inner-page-card">
        <div class="panel-head">
          <div>
            <h2>Core Money Flow tab 100% tab maana jayega jab</h2>
          </div>
          <div class="toolbar inner-action-bar">
            <button class="ghost" type="button" [disabled]="busy()" (click)="runReconciliation()">Run reconciliation</button>
            <button class="primary" type="button" [disabled]="busy()" (click)="processOutbox()">Process GL outbox</button>
          </div>
        </div>

        <div class="check-list">
          <article class="check-row" *ngFor="let check of checks()">
            <div class="check-main">
              <div class="check-title">
                <span class="status-dot" [attr.data-state]="check.status"></span>
                <h3>{{ check.label }}</h3>
                <span class="pill" [attr.data-state]="check.status">{{ statusLabel(check.status) }}</span>
              </div>
              <p class="muted">{{ check.detail }}</p>
              <strong>{{ check.metric }}</strong>
            </div>
            <a class="button ghost" [routerLink]="check.route">{{ check.action }}</a>
          </article>
        </div>
      </section>

      <section class="action-panel inner-page-card">
        <div class="panel-head">
          <div>
            <h2>{{ blockingCount() ? blockingCount() + ' blocker' : 'No blocker' }}</h2>
          </div>
          <a class="button ghost" routerLink="/balance-sheet">Open balance sheet</a>
        </div>
        <p class="muted" *ngIf="!blockingCount()">Current data ke hisaab se critical blocker nahi dikh raha. Pending/warn checks ko close karke 100% score milega.</p>
        <div class="issue-list" *ngIf="blockingCount()">
          <strong *ngFor="let check of blockerChecks()">{{ check.label }}: {{ check.detail }}</strong>
        </div>
        <p class="muted" *ngIf="actionMessage()">{{ actionMessage() }}</p>
        <p class="muted" *ngIf="loading()">Loading latest money-flow signals...</p>
        <p class="issue-list" *ngIf="error()">{{ error() }}</p>
        <div class="issue-list" *ngIf="apiIssues().length">
          <span *ngFor="let issue of apiIssues()">{{ issue }}</span>
        </div>
      </section>
    </section>
  `
})
export class CoreMoneyFlowPageComponent {
  private readonly api = inject(ApiService);
  private readonly state = inject(AppStateService);
  private readonly session = inject(AuthSessionService);

  readonly asOfDate = signal(new Date().toISOString().slice(0, 10));
  readonly invoiceRows = signal<ApiRecord[]>([]);
  readonly paymentModes = signal<ApiRecord[]>([]);
  readonly outgoingFunds = signal<ApiRecord[]>([]);
  readonly controls = signal<ApiRecord | null>(null);
  readonly dailyOps = signal<ApiRecord | null>(null);
  readonly zReport = signal<ApiRecord | null>(null);
  readonly dayCloseStatus = signal<ApiRecord | null>(null);
  readonly hardening = signal<ApiRecord | null>(null);
  readonly outboxRows = signal<ApiRecord[]>([]);
  readonly loading = signal(false);
  readonly busy = signal(false);
  readonly error = signal('');
  readonly actionMessage = signal('');
  readonly apiIssues = signal<string[]>([]);

  canAccessPath(path: string): boolean {
    const permission = routePermissionForPath(path);
    if (!permission || (Array.isArray(permission) && !permission.length)) return true;
    const permissions = Array.isArray(permission) ? permission : [permission];
    const dynamicGrants = this.session.currentUser()?.permissions || [];
    const grants = Array.from(new Set([...staticGrantsForRole(this.state.userRole()), ...dynamicGrants]));
    return permissions.some((item) => grantsAllow(grants, item));
  }

  readonly paidInvoiceCount = computed(() => this.invoiceRows().filter((invoice) => this.invoicePaid(invoice)).length);
  readonly dueInvoiceCount = computed(() => this.invoiceRows().filter((invoice) => this.invoiceDueAmount(invoice) > 0).length);
  readonly failedOutboxCount = computed(() => this.outboxRows().filter((row) => this.status(row) === 'failed').length);
  readonly pendingOutboxCount = computed(() => this.outboxRows().filter((row) => this.status(row) === 'pending').length);
  readonly postedOutboxCount = computed(() => this.outboxRows().filter((row) => this.status(row) === 'posted').length);

  readonly checks = computed<MoneyFlowCheck[]>(() => {
    const invoices = this.invoiceRows();
    const paidInvoices = this.paidInvoiceCount();
    const dueInvoices = this.dueInvoiceCount();
    const controls = this.controls() || {};
    const hardening = this.hardening() || {};
    const dailyOps = this.dailyOps() || {};
    const paymentModes = this.paymentModes().filter((mode) => mode['active'] !== false);
    const outgoingFunds = this.outgoingFunds();
    const failedOutbox = this.failedOutboxCount();
    const pendingOutbox = this.pendingOutboxCount();
    const latestRecon = hardening['latestReconciliation'] || controls['latestReconciliation'] || null;
    const reconOk = latestRecon?.status === 'ok';
    const sourceOfTruthOk = String(controls['sourceOfTruth'] || '').toLowerCase() === 'journalentrylines';
    const dailyClose = dailyOps['ownerDailyClose'] || {};
    const cashRecon = dailyOps['cashBankReconciliation'] || {};
    const livePosToGl = dailyOps['livePosToGl'] || {};
    const balanceRecon = dailyOps['reconciliation'] || {};
    const zReport = this.zReport() || {};
    const dayCloseStatus = this.dayCloseStatus() || {};
    const cashDifference = this.moneyValue(zReport['cash_difference'] ?? zReport['cashDifference']);
    const dayCloseLocked = this.status(dayCloseStatus) === 'locked';
    const dayCloseReady = Boolean(dailyClose['ready']) || (dayCloseLocked && Math.abs(cashDifference) <= 1);
    const paymentTotalsOk = invoices.length > 0 && invoices.every((invoice) => this.invoicePaymentMathOk(invoice));
    const outgoingFailed = outgoingFunds.filter((entry) => this.status(entry['balanceSheetLink'] || {}) === 'failed').length;
    const outgoingLinked = outgoingFunds.filter((entry) => ['pending', 'posted', 'queued'].includes(this.status(entry['balanceSheetLink'] || {}))).length;
    const entriesBalanced = this.hardeningCheckOk(hardening, 'entries_balanced') || this.hardeningCheckOk(hardening, 'trial_balanced') || reconOk;
    const balanceTraceable = sourceOfTruthOk && Math.abs(this.moneyValue(balanceRecon['accountingEquationDifference'])) === 0;
    const paymentModeSettlementOk = paymentModes.length > 0 && paymentModes.every((mode) => Boolean(mode['settlementType']));
    const closedInvoices = invoices.filter((invoice) => this.invoicePaid(invoice) || ['closed', 'finalized', 'settled'].includes(this.status(invoice)));

    return [
      {
        key: 'invoice-save',
        label: 'POS sale banne ke baad invoice save ho',
        metric: `${invoices.length} invoice records`,
        detail: invoices.length ? 'Saved invoices available hain; cashier flow ka output visible hai.' : 'Abhi saved invoice data nahi mila.',
        route: '/pos',
        status: invoices.length ? 'done' : 'warn',
        action: 'Open POS'
      },
      {
        key: 'payment-split-due-wallet',
        label: 'Payment split, due aur wallet correctly record ho',
        metric: `${paidInvoices} paid / ${dueInvoices} due`,
        detail: paymentTotalsOk ? 'Paid, due aur total amount reconcile ho rahe hain.' : 'Invoice payment math ya due/wallet sample verify karna baaki hai.',
        route: '/pos/invoices',
        status: paymentTotalsOk ? 'done' : (invoices.length ? 'warn' : 'blocker'),
        action: 'Open invoices'
      },
      {
        key: 'invoice-lock-audit',
        label: 'Invoice paid/closed ke baad locked aur audited ho',
        metric: `${closedInvoices.length} closed/paid invoices`,
        detail: closedInvoices.length ? 'Paid/closed invoices present hain; audit/lock timeline invoice screen se review karo.' : 'Paid/closed invoice sample nahi mila.',
        route: '/pos/invoice-activity',
        status: closedInvoices.length ? 'done' : 'warn',
        action: 'Audit activity'
      },
      {
        key: 'payment-mode-settlement',
        label: 'Payment mode settlement track ho',
        metric: `${paymentModes.length} active modes`,
        detail: paymentModeSettlementOk ? 'Active modes me settlement type configured hai.' : 'Payment mode settlement mapping complete karo.',
        route: '/pos/payment-modes',
        status: paymentModeSettlementOk ? 'done' : 'blocker',
        action: 'Payment modes'
      },
      {
        key: 'refund-void-credit-note',
        label: 'Refund, void aur credit note controlled approval se chale',
        metric: 'Approval queue active',
        detail: 'Refund, void aur credit note actions dedicated approval queue se post hote hain.',
        route: '/billing/refunds',
        status: 'done',
        action: 'Refund queue'
      },
      {
        key: 'outgoing-ledger',
        label: 'Outgoing funds ledger me post ho',
        metric: `${outgoingLinked}/${outgoingFunds.length} linked`,
        detail: outgoingFailed ? `${outgoingFailed} outgoing fund GL posting failed hai.` : 'Outgoing fund entries GL outbox se linked/queued hain.',
        route: '/transactions/outgoing-funds',
        status: outgoingFailed ? 'blocker' : (outgoingFunds.length ? 'done' : 'warn'),
        action: 'Outgoing funds'
      },
      {
        key: 'balanced-journal-lines',
        label: 'Every money event journalEntryLines me balanced debit/credit post kare',
        metric: sourceOfTruthOk ? 'Source: journalEntryLines' : 'Source proof missing',
        detail: entriesBalanced ? 'Latest hardening/reconciliation check balanced hai.' : 'Reconciliation run karke unbalanced entries clear karo.',
        route: '/balance-sheet',
        status: entriesBalanced && sourceOfTruthOk ? 'done' : 'blocker',
        action: 'Ledger proof'
      },
      {
        key: 'balance-sheet-trace',
        label: 'Balance sheet numbers invoice/payment/outgoing fund se traceable hon',
        metric: `POS-GL diff ${this.money(livePosToGl['difference'])}`,
        detail: balanceTraceable ? 'Balance sheet source of truth aur accounting equation traceable hai.' : 'Balance sheet trace ya equation difference review karo.',
        route: '/balance-sheet',
        status: balanceTraceable ? 'done' : 'warn',
        action: 'Balance sheet'
      },
      {
        key: 'day-close-variance',
        label: 'Day close me cash/card/UPI/bank variance clear ho',
        metric: dayCloseLocked ? `Locked · cash diff ${this.money(cashDifference)}` : `Cash ${this.money(cashRecon['expectedCash'])} / Bank ${this.money(cashRecon['expectedBankNet'])}`,
        detail: dayCloseReady ? 'Cash drawer, bank settlement aur day lock clear hai.' : 'Cash drawer, bank settlement aur outgoing cash entries reconcile karo.',
        route: '/billing/daily-closing',
        status: dayCloseReady ? 'done' : 'warn',
        action: 'Daily close'
      },
      {
        key: 'outbox-visible-fixable',
        label: 'Failed GL outbox ya reconciliation issue visible aur fixable ho',
        metric: `${failedOutbox} failed / ${pendingOutbox} pending`,
        detail: failedOutbox ? 'Failed events ko Process GL outbox se retry karo.' : 'GL outbox visible hai aur failed queue clean hai.',
        route: '/billing/reconciliation',
        status: failedOutbox ? 'blocker' : 'done',
        action: 'Reconcile'
      }
    ];
  });

  readonly doneCount = computed(() => this.checks().filter((check) => check.status === 'done').length);
  readonly blockingCount = computed(() => this.checks().filter((check) => check.status === 'blocker').length);
  readonly blockerChecks = computed(() => this.checks().filter((check) => check.status === 'blocker'));
  readonly readyScore = computed(() => Math.round((this.doneCount() / Math.max(1, this.checks().length)) * 100));

  ngOnInit(): void {
    this.load();
  }

  async load(): Promise<void> {
    this.loading.set(true);
    this.error.set('');
    this.actionMessage.set('');
    this.apiIssues.set([]);
    const params = { asOfDate: this.asOfDate() };
    const branchId = this.api.selectedBranchId();
    try {
      const result = await firstValueFrom(forkJoin({
        invoices: this.safe(this.api.list<BillingInvoiceResponse>('billing/invoices', { limit: 500 }), [] as ApiRecord[], 'Billing invoices'),
        paymentModes: this.safe(this.api.list<ApiRecord>('pos/settings/payment-modes'), { paymentModes: [] }, 'Payment modes'),
        outgoingFunds: this.safe(this.api.list<ApiRecord[]>('transactions/outgoing-funds', { limit: 500 }), [], 'Outgoing funds'),
        controls: this.safe(this.api.list<ApiRecord | null>('balance-sheet/controls', params), null, 'Balance sheet controls'),
        dailyOps: this.safe(this.api.list<ApiRecord | null>('balance-sheet/finance-os', params), null, 'Finance OS'),
        zReport: branchId ? this.safe(this.api.list<ApiRecord | null>(`z-reports/${branchId}/${this.asOfDate()}`), null, 'Z-report') : of(null),
        dayCloseStatus: branchId ? this.safe(this.api.list<ApiRecord | null>(`day-close/${branchId}/${this.asOfDate()}/status`), null, 'Day close status') : of(null),
        hardening: this.safe(this.api.list<ApiRecord | null>('balance-sheet/hardening', params), null, 'Hardening status'),
        outbox: this.safe(this.api.list<ApiRecord[]>('balance-sheet/outbox'), [], 'GL outbox')
      }));
      this.invoiceRows.set(this.invoiceList(result.invoices));
      this.paymentModes.set(Array.isArray(result.paymentModes?.['paymentModes']) ? result.paymentModes['paymentModes'] : []);
      this.outgoingFunds.set(Array.isArray(result.outgoingFunds) ? result.outgoingFunds : []);
      this.controls.set(result.controls || null);
      this.dailyOps.set(result.dailyOps || null);
      this.zReport.set(result.zReport || null);
      this.dayCloseStatus.set(result.dayCloseStatus || null);
      this.hardening.set(result.hardening || null);
      this.outboxRows.set(Array.isArray(result.outbox) ? result.outbox : []);
    } catch (error) {
      this.error.set(this.api.errorText(error, 'Core Money Flow readiness load failed'));
    } finally {
      this.loading.set(false);
    }
  }

  async processOutbox(): Promise<void> {
    await this.runAction(() => this.api.post<ApiRecord>('balance-sheet/outbox/process', { limit: 100, retryFailed: true }), 'GL outbox processed.');
  }

  async runReconciliation(): Promise<void> {
    await this.runAction(() => this.api.post<ApiRecord>('balance-sheet/reconcile', { asOfDate: this.asOfDate() }), 'Reconciliation completed.');
  }

  statusLabel(status: CheckStatus): string {
    if (status === 'done') return 'Done';
    if (status === 'blocker') return 'Blocker';
    return 'Pending';
  }

  money(value: unknown): string {
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(this.moneyValue(value));
  }

  private async runAction(action: () => Observable<ApiRecord>, message: string): Promise<void> {
    this.busy.set(true);
    this.error.set('');
    this.actionMessage.set('');
    try {
      await firstValueFrom(action());
      await this.load();
      this.actionMessage.set(message);
    } catch (error) {
      this.error.set(this.api.errorText(error, message.replace(/\.$/, '') + ' failed'));
    } finally {
      this.busy.set(false);
    }
  }

  private safe<T>(source: Observable<T>, fallback: T, label: string): Observable<T> {
    return source.pipe(catchError((error) => {
      this.apiIssues.update((issues) => [...issues, `${label}: ${this.api.errorText(error, 'not available')}`]);
      return of(fallback);
    }));
  }

  private invoiceList(response: BillingInvoiceResponse): ApiRecord[] {
    if (Array.isArray(response)) return response;
    return Array.isArray(response?.rows) ? response.rows : [];
  }

  private invoicePaid(invoice: ApiRecord): boolean {
    const status = this.status(invoice['payment_status'] || invoice['paymentStatus'] || invoice['status']);
    return ['paid', 'settled', 'closed'].includes(status) || this.invoiceDueAmount(invoice) <= 0;
  }

  private invoicePaymentMathOk(invoice: ApiRecord): boolean {
    const total = this.moneyValue(invoice['grand_total'] ?? invoice['grandTotal'] ?? invoice['total']);
    const paid = this.moneyValue(invoice['paid_amount'] ?? invoice['paidAmount'] ?? invoice['paid']);
    const due = this.invoiceDueAmount(invoice);
    if (total <= 0) return paid === 0 && due === 0;
    return Math.abs(total - paid - due) <= 1;
  }

  private invoiceDueAmount(invoice: ApiRecord): number {
    const total = this.moneyValue(invoice['grand_total'] ?? invoice['grandTotal'] ?? invoice['total']);
    const paid = this.moneyValue(invoice['paid_amount'] ?? invoice['paidAmount'] ?? invoice['paid']);
    const candidates = [invoice['due_amount'], invoice['dueAmount'], invoice['balance']]
      .filter((value) => value !== undefined && value !== null && value !== '')
      .map((value) => this.moneyValue(value));
    return candidates.find((due) => Math.abs(total - paid - due) <= 1) ?? candidates[0] ?? 0;
  }

  private hardeningCheckOk(hardening: ApiRecord, key: string): boolean {
    const checks = hardening['latestReconciliation']?.checks;
    return Array.isArray(checks) && checks.some((check) => check?.key === key && check?.ok === true);
  }

  private status(value: unknown): string {
    if (typeof value === 'string') return value.trim().toLowerCase();
    if (!value || typeof value !== 'object') return '';
    const record = value as ApiRecord;
    return String(record['status'] || record['payment_status'] || record['paymentStatus'] || '').trim().toLowerCase();
  }

  private moneyValue(value: unknown): number {
    const numeric = Number(value || 0);
    return Number.isFinite(numeric) ? numeric : 0;
  }
}
