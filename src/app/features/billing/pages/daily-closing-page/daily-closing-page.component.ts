import { CommonModule } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { catchError, firstValueFrom, forkJoin, of, Observable } from 'rxjs';
import { ApiRecord, ApiService } from '../../../../core/api.service';
import { AppStateService } from '../../../../core/state/app-state.service';

@Component({
  selector: 'app-daily-closing-page',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  styles: [`
    .close-shell { display: grid; gap: 16px; padding: 16px; color: #172033; }
    .hero, .panel, .metric, .step-row, .action-panel { border: 1px solid #dbe5e8; border-radius: 8px; background: #fff; }
    .hero { display: flex; justify-content: space-between; gap: 16px; align-items: flex-start; padding: 18px; background: linear-gradient(135deg, #f8fffd, #fff 60%, #f4f7eb); }
    .hero-copy, .panel, .action-panel, .stack { display: grid; gap: 12px; }
    .eyebrow { color: #526174; font-size: .75rem; font-weight: 800; letter-spacing: 0; text-transform: uppercase; }
    h1, h2, h3, p { margin: 0; }
    h1 { font-size: clamp(1.55rem, 3vw, 2.25rem); line-height: 1.12; }
    h2 { font-size: 1.05rem; }
    .muted { color: #617086; }
    .hero-actions, .toolbar, .button-row, .form-row { display: flex; gap: 10px; flex-wrap: wrap; align-items: center; }
    .metric-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; }
    .metric { padding: 14px; min-height: 92px; display: grid; gap: 4px; }
    .metric strong { font-size: 1.5rem; }
    .grid { display: grid; grid-template-columns: minmax(0, .95fr) minmax(0, 1.05fr); gap: 16px; align-items: start; }
    button, .button, input, textarea { min-height: 40px; border-radius: 8px; border: 1px solid #cfdde2; padding: 0 12px; font: inherit; }
    textarea { min-height: 78px; padding: 10px 12px; resize: vertical; }
    button, .button { display: inline-flex; justify-content: center; align-items: center; gap: 8px; font-weight: 800; text-decoration: none; cursor: pointer; }
    button.primary, .button.primary { background: #5A153F; border-color: #5A153F; color: #fff; }
    button.ghost, .button.ghost { background: #fff; color: #172033; }
    button.danger { background: #b42318; border-color: #b42318; color: #fff; }
    button:disabled { opacity: .55; cursor: not-allowed; }
    .field { display: grid; gap: 6px; flex: 1 1 160px; }
    .field span { font-size: .82rem; color: #526174; font-weight: 800; }
    .step-list { display: grid; gap: 10px; }
    .step-row { padding: 14px; display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 12px; align-items: center; }
    .pill { border-radius: 999px; padding: 5px 9px; font-size: .78rem; font-weight: 800; background: #eef4f6; color: #526174; }
    .pill.ok { background: #FBF0E8; color: #7A4A28; }
    .pill.warn { background: #fff5db; color: #925400; }
    .pill.bad { background: #fff0ed; color: #b42318; }
    .action-panel { padding: 14px; background: #fbfdfc; }
    .error, .empty { padding: 14px; border-radius: 8px; background: #fff0ed; color: #b42318; }
    .empty { background: #f8faf9; color: #617086; }
    @media (max-width: 900px) {
      .hero, .grid { display: grid; grid-template-columns: 1fr; }
      .metric-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .step-row { grid-template-columns: 1fr; }
    }
    @media (max-width: 560px) {
      .metric-grid { grid-template-columns: 1fr; }
      .close-shell { padding: 12px; }
    }
  `],
  template: `
    <section class="close-shell inner-page-shell">
      <header class="hero inner-page-header">
        <div class="hero-copy">
          <h1>Cash, card, UPI and bank day close</h1>
        </div>
        <div class="hero-actions">
          <button class="ghost" type="button" [disabled]="loading()" (click)="load()">Refresh</button>
          <a class="button ghost" routerLink="/pos/cash-drawer-eod">Cash drawer</a>
          <a class="button primary" routerLink="/billing/core-money-flow">Core Money Flow</a>
        </div>
      </header>

      <section class="metric-grid inner-stats-grid">
        <article class="metric"><strong>{{ lockStatusText() }}</strong><small class="muted">{{ branchId() }} · {{ businessDate() }}</small></article>
        <article class="metric"><strong>{{ money(expectedCash()) }}</strong></article>
        <article class="metric"><strong>{{ money(cashVariance()) }}</strong></article>
        <article class="metric"><strong>{{ money(expectedBankNet()) }}</strong></article>
      </section>

      <section class="grid">
        <aside class="action-panel inner-page-card">
          <div>
            <h2>Cashier close form</h2>
          </div>
          <div class="form-row inner-form-grid">
            <label class="field">
              <span>Branch ID</span>
              <input [ngModel]="branchId()" (ngModelChange)="branchId.set($event); load()" />
            </label>
            <label class="field">
              <span>Business date</span>
              <input type="date" [ngModel]="businessDate()" (ngModelChange)="businessDate.set($event); load()" />
            </label>
          </div>
          <div class="form-row inner-form-grid">
            <label class="field">
              <span>Opening cash</span>
              <input type="number" [ngModel]="openingCash()" (ngModelChange)="openingCash.set(numberValue($event))" />
            </label>
            <label class="field">
              <span>Closing cash counted</span>
              <input type="number" [ngModel]="closingCash()" (ngModelChange)="closingCash.set(numberValue($event))" />
            </label>
          </div>
          <label class="field">
            <span>Reopen reason</span>
            <textarea [ngModel]="reopenReason()" (ngModelChange)="reopenReason.set($event)" placeholder="Required only when reopening a locked day"></textarea>
          </label>
          <div class="button-row inner-action-bar">
            <button class="ghost" type="button" [disabled]="busy()" (click)="generateZReport()">Generate Z-report</button>
            <button class="ghost" type="button" [disabled]="busy()" (click)="ownerDailyClose()">Owner daily close</button>
            <button class="primary" type="button" [disabled]="busy() || isLocked()" (click)="lockDay()">Lock day</button>
            <button class="danger" type="button" [disabled]="busy() || !isLocked()" (click)="reopenDay()">Reopen</button>
          </div>
          <p class="muted" *ngIf="notice()">{{ notice() }}</p>
          <p class="error" *ngIf="error()">{{ error() }}</p>
        </aside>

        <main class="panel inner-page-card">
          <div class="toolbar inner-action-bar">
            <div>
              <h2>Cash/card/UPI/bank variance</h2>
            </div>
            <button class="ghost" type="button" [disabled]="busy()" (click)="processOutbox()">Process GL outbox</button>
          </div>

          <div class="step-list">
            <article class="step-row" *ngFor="let step of closeSteps()">
              <div>
                <h3>{{ step.label }}</h3>
                <p class="muted">{{ step.detail }}</p>
              </div>
              <span class="pill" [class.ok]="step.state === 'ok'" [class.warn]="step.state === 'warn'" [class.bad]="step.state === 'bad'">{{ step.value }}</span>
            </article>
          </div>
        </main>
      </section>

      <section class="panel inner-page-card">
        <div class="toolbar inner-action-bar">
          <div>
            <h2>{{ zReport()?.['report_no'] || 'No report generated yet' }}</h2>
          </div>
          <a class="button ghost" [routerLink]="['/balance-sheet']">Balance sheet</a>
        </div>
        <div class="metric-grid" *ngIf="zReport(); else noReport">
          <article class="metric"><strong>{{ money(zReport()?.['sales_total']) }}</strong><small class="muted">{{ zReport()?.['invoice_count'] || 0 }} invoices</small></article>
          <article class="metric"><strong>{{ money(zReport()?.['refund_total']) }}</strong><small class="muted">{{ zReport()?.['refund_count'] || 0 }} refunds</small></article>
          <article class="metric"><strong>{{ money(zReport()?.['cash_total']) }}</strong><small class="muted">Diff {{ money(zReport()?.['cash_difference']) }}</small></article>
          <article class="metric"><strong>{{ money(numberValue(zReport()?.['upi_total']) + numberValue(zReport()?.['card_total'])) }}</strong><small class="muted">Wallet {{ money(zReport()?.['wallet_total']) }}</small></article>
        </div>
        <ng-template #noReport><div class="empty">Generate Z-report to freeze the day summary before locking.</div></ng-template>
      </section>
    </section>
  `
})
export class DailyClosingPageComponent {
  private readonly api = inject(ApiService);
  private readonly appState = inject(AppStateService);

  readonly branchId = signal(this.appState.selectedBranchId() || 'branch_hyd');
  readonly businessDate = signal(new Date().toISOString().slice(0, 10));
  readonly openingCash = signal(0);
  readonly closingCash = signal(0);
  readonly reopenReason = signal('');
  readonly dailyOps = signal<ApiRecord | null>(null);
  readonly lockStatus = signal<ApiRecord | null>(null);
  readonly zReport = signal<ApiRecord | null>(null);
  readonly ownerClose = signal<ApiRecord | null>(null);
  readonly loading = signal(false);
  readonly busy = signal(false);
  readonly error = signal('');
  readonly notice = signal('');

  readonly expectedCash = computed(() => this.numberValue(this.dailyOps()?.['cashBankReconciliation']?.['expectedCash']));
  readonly expectedBankNet = computed(() => this.numberValue(this.dailyOps()?.['cashBankReconciliation']?.['expectedBankNet']));
  readonly cashVariance = computed(() => this.numberValue(this.closingCash()) - this.expectedCash());
  readonly isLocked = computed(() => String(this.lockStatus()?.['status'] || '').toLowerCase() === 'locked');
  readonly closeSteps = computed(() => {
    const daily = this.dailyOps();
    const cashRecon = daily?.['cashBankReconciliation'] || {};
    const livePos = daily?.['livePosToGl'] || {};
    const owner = daily?.['ownerDailyClose'] || {};
    const variance = this.cashVariance();
    return [
      {
        label: 'Cash counted and variance checked',
        detail: `Expected cash ${this.money(cashRecon['expectedCash'])}, counted cash ${this.money(this.closingCash())}.`,
        value: this.money(variance),
        state: Math.abs(variance) <= 1 ? 'ok' : Math.abs(variance) <= 100 ? 'warn' : 'bad'
      },
      {
        label: 'UPI/card/bank settlement checked',
        detail: `Bank collection ${this.money(cashRecon['bankCollection'])}, bank outgoing ${this.money(cashRecon['bankOutgoing'])}.`,
        value: this.money(cashRecon['expectedBankNet']),
        state: this.expectedBankNet() >= 0 ? 'ok' : 'warn'
      },
      {
        label: 'POS sales posted to GL',
        detail: `POS sales ${this.money(livePos['posSales'])}, GL revenue ${this.money(livePos['glRevenue'])}.`,
        value: `Diff ${this.money(livePos['difference'])}`,
        state: Math.abs(this.numberValue(livePos['difference'])) <= 1 ? 'ok' : 'bad'
      },
      {
        label: 'GL outbox clear',
        detail: `${livePos['outboxPending'] || 0} pending, ${livePos['outboxFailed'] || 0} failed, ${livePos['outboxPosted'] || 0} posted.`,
        value: `${livePos['outboxFailed'] || 0} failed`,
        state: Number(livePos['outboxFailed'] || 0) > 0 ? 'bad' : Number(livePos['outboxPending'] || 0) > 0 ? 'warn' : 'ok'
      },
      {
        label: 'Owner daily close ready',
        detail: `${owner['warnings'] || 0} warning(s) from finance controls.`,
        value: owner['ready'] ? 'Ready' : 'Check',
        state: owner['ready'] ? 'ok' : 'warn'
      },
      {
        label: 'Day lock status',
        detail: 'Locked day prevents back-dated cashier changes.',
        value: this.lockStatusText(),
        state: this.isLocked() ? 'ok' : 'warn'
      }
    ];
  });

  ngOnInit(): void {
    this.load();
  }

  async load(): Promise<void> {
    if (!this.branchId()) return;
    this.loading.set(true);
    this.error.set('');
    try {
      const result = await firstValueFrom(forkJoin({
        dailyOps: this.safe(this.api.list<ApiRecord | null>('balance-sheet/daily-operations', { branchId: this.branchId(), asOfDate: this.businessDate() }), null),
        lockStatus: this.safe(this.api.list<ApiRecord | null>(`day-close/${this.branchId()}/${this.businessDate()}/status`), null),
        zReport: this.safe(this.api.list<ApiRecord | null>(`z-reports/${this.branchId()}/${this.businessDate()}`), null)
      }));
      this.dailyOps.set(result.dailyOps || null);
      this.lockStatus.set(result.lockStatus || { status: 'open' });
      this.zReport.set(result.zReport || null);
      if (!this.closingCash()) this.closingCash.set(Math.max(0, this.expectedCash()));
    } catch (error) {
      this.error.set(this.api.errorText(error, 'Unable to load daily close'));
    } finally {
      this.loading.set(false);
    }
  }

  async generateZReport(): Promise<void> {
    await this.runAction(
      () => this.api.post<ApiRecord>('z-reports/generate', {
        branchId: this.branchId(),
        businessDate: this.businessDate(),
        openingCash: this.openingCash(),
        closingCash: this.closingCash()
      }),
      'Z-report generated.'
    );
  }

  async ownerDailyClose(): Promise<void> {
    await this.runAction(
      () => this.api.post<ApiRecord>('balance-sheet/owner-daily-close', { branchId: this.branchId(), asOfDate: this.businessDate() }),
      'Owner daily close completed.'
    );
  }

  async processOutbox(): Promise<void> {
    await this.runAction(() => this.api.post<ApiRecord>('balance-sheet/outbox/process', { branchId: this.branchId(), limit: 100 }), 'GL outbox processed.');
  }

  async lockDay(): Promise<void> {
    await this.runAction(
      () => this.api.post<ApiRecord>(`day-close/${this.branchId()}/${this.businessDate()}/lock`, {
        closingCash: this.closingCash(),
        cashVariance: this.cashVariance()
      }),
      'Day locked.'
    );
  }

  async reopenDay(): Promise<void> {
    if (!this.reopenReason().trim()) {
      this.error.set('Reopen reason required.');
      return;
    }
    await this.runAction(
      () => this.api.post<ApiRecord>(`day-close/${this.branchId()}/${this.businessDate()}/reopen`, { reason: this.reopenReason().trim() }),
      'Day reopened.'
    );
  }

  lockStatusText(): string {
    return String(this.lockStatus()?.['status'] || 'open');
  }

  money(value: unknown): string {
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(this.numberValue(value));
  }

  numberValue(value: unknown): number {
    const amount = Number(value || 0);
    return Number.isFinite(amount) ? amount : 0;
  }

  private async runAction(action: () => Observable<ApiRecord>, message: string): Promise<void> {
    this.busy.set(true);
    this.error.set('');
    this.notice.set('');
    try {
      const result = await firstValueFrom(action());
      if (message.startsWith('Owner')) this.ownerClose.set(result);
      this.notice.set(message);
      await this.load();
    } catch (error) {
      this.error.set(this.api.errorText(error, message.replace(/\.$/, '') + ' failed'));
    } finally {
      this.busy.set(false);
    }
  }

  private safe<T>(source: Observable<T>, fallback: T): Observable<T> {
    return source.pipe(catchError(() => of(fallback)));
  }
}
