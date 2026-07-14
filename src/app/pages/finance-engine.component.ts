import { CommonModule } from '@angular/common';
import { Component, OnInit, signal } from '@angular/core';
import { ReactiveFormsModule, UntypedFormBuilder, Validators } from '@angular/forms';
import { ApiRecord, ApiService } from '../core/api.service';
import { StateComponent } from '../shared/ui/state/state.component';
import { AuraMoneyPipe } from '../shared/pipes/aura-money.pipe';
import { AuraDatePipe } from '../shared/pipes/aura-date.pipe';

@Component({
  selector: 'app-finance-engine',
  standalone: true,
  imports: [AuraDatePipe, AuraMoneyPipe, CommonModule, ReactiveFormsModule, StateComponent],
  template: `
    <section class="finance-workspace">
      <section class="page-title">
        <div>
          <h1>Finance</h1>
        </div>
        <strong>Live finance engine</strong>
      </section>

      <app-state [loading]="loading()" [error]="error()"></app-state>

      <section class="metrics-grid" *ngIf="summary()?.metrics as metrics">
        <article><span>Revenue</span><strong>{{ metrics.revenue | auraMoney:'1.0-0' }}</strong></article>
        <article><span>Cash</span><strong>{{ metrics.cash | auraMoney:'1.0-0' }}</strong></article>
        <article><span>UPI</span><strong>{{ metrics.upi | auraMoney:'1.0-0' }}</strong></article>
        <article><span>Expenses</span><strong>{{ metrics.expenses | auraMoney:'1.0-0' }}</strong></article>
        <article><span>Outstanding</span><strong>{{ metrics.outstanding | auraMoney:'1.0-0' }}</strong></article>
        <article><span>P/L</span><strong>{{ metrics.profitLoss | auraMoney:'1.0-0' }}</strong></article>
      </section>

      <section class="workdesk">
        <header class="desk-heading">
          <div>
            <h2>Single compact work desk</h2>
          </div>
        </header>

        <div class="workdesk-grid">
          <form [formGroup]="drawerForm">
            <h3>Cash drawer</h3>
            <label class="field"><span>Branch</span><select formControlName="branchId"><option *ngFor="let branch of branches()" [value]="branch.id">{{ branch.name }}</option></select></label>
            <label class="field"><span>Opening float</span><input type="number" formControlName="openingFloat" /></label>
            <label class="field"><span>Counted cash</span><input type="number" formControlName="countedCash" /></label>
            <div class="form-actions">
              <button class="ghost-button" type="button" (click)="openDrawer()" [disabled]="Boolean(summary()?.drawer)">Open drawer</button>
              <button class="primary-button" type="button" (click)="closeDrawer()" [disabled]="!summary()?.drawer">Close drawer</button>
            </div>
          </form>

          <form [formGroup]="expenseForm" (ngSubmit)="addExpense()">
            <h3>Expense tracking</h3>
            <label class="field"><span>Category</span><input formControlName="category" /></label>
            <label class="field"><span>Amount</span><input type="number" formControlName="amount" /></label>
            <label class="field"><span>Vendor</span><input formControlName="vendor" /></label>
            <label class="field"><span>Mode</span><select formControlName="paymentMode"><option value="cash">Cash</option><option value="upi">UPI</option><option value="card">Card</option></select></label>
            <div class="form-actions"><button class="primary-button" type="submit" [disabled]="expenseForm.invalid">Add expense</button></div>
          </form>

          <form [formGroup]="closingForm" (ngSubmit)="dailyClosing()">
            <h3>Daily closing</h3>
            <label class="field"><span>Business date</span><input type="date" formControlName="businessDate" /></label>
            <label class="field"><span>Notes</span><input formControlName="notes" /></label>
            <div class="form-actions"><button class="primary-button" type="submit">Close day</button></div>
          </form>

          <form [formGroup]="invoiceForm">
            <h3>Partial payment and refund</h3>
            <label class="field full"><span>Invoice</span><select formControlName="invoiceId"><option *ngFor="let invoice of invoices()" [value]="invoice.id">{{ invoice.invoiceNumber }} · {{ invoice.status }} · {{ invoice.balance | auraMoney:'1.0-0' }}</option></select></label>
            <label class="field"><span>Amount</span><input type="number" formControlName="amount" /></label>
            <label class="field"><span>Mode</span><select formControlName="mode"><option value="upi">UPI</option><option value="cash">Cash</option><option value="card">Card</option></select></label>
            <label class="field full"><span>Reason/reference</span><input formControlName="reason" /></label>
            <div class="form-actions">
              <button class="ghost-button" type="button" (click)="partialPayment()" [disabled]="!invoiceForm.value.invoiceId">Add partial payment</button>
              <button class="primary-button" type="button" (click)="refund()" [disabled]="!invoiceForm.value.invoiceId">Refund</button>
            </div>
          </form>

          <form [formGroup]="payoutForm" (ngSubmit)="staffPayout()">
            <h3>Staff payout</h3>
            <label class="field full"><span>Staff</span><select formControlName="staffId"><option *ngFor="let person of staff()" [value]="person.id">{{ person.name }}</option></select></label>
            <label class="field"><span>Period start</span><input type="date" formControlName="periodStart" /></label>
            <label class="field"><span>Period end</span><input type="date" formControlName="periodEnd" /></label>
            <label class="field"><span>Incentive</span><input type="number" formControlName="incentiveAmount" /></label>
            <label class="field"><span>Deductions</span><input type="number" formControlName="deductions" /></label>
            <div class="form-actions"><button class="primary-button" type="submit" [disabled]="!payoutForm.value.staffId">Calculate payout</button></div>
          </form>
        </div>
      </section>

      <section class="register-panel">
        <div class="register-heading">
          <div>
            <h2>Open invoice register</h2>
          </div>
          <span>{{ (summary()?.outstanding || []).length }} invoices</span>
        </div>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Invoice</th><th>Status</th><th>Total</th><th>Paid</th><th>Balance</th></tr></thead>
            <tbody>
              <tr *ngFor="let invoice of summary()?.outstanding || []">
                <td>{{ invoice.invoiceNumber }}</td>
                <td><span class="badge">{{ invoice.status }}</span></td>
                <td>{{ invoice.total | auraMoney:'1.0-0' }}</td>
                <td>{{ invoice.paid | auraMoney:'1.0-0' }}</td>
                <td>{{ invoice.balance | auraMoney:'1.0-0' }}</td>
              </tr>
              <tr *ngIf="!(summary()?.outstanding || []).length"><td colspan="5"><div class="empty-state"><strong>No outstanding invoices</strong><span>All visible invoices are settled.</span></div></td></tr>
            </tbody>
          </table>
        </div>
      </section>

      <section class="register-panel two-registers">
        <div>
          <div class="register-heading">
            <div>
              <h2>Expenses and refunds</h2>
            </div>
          </div>
          <div class="rank-list">
            <article *ngFor="let item of summary()?.expenses || []"><div><strong>{{ item.category }}</strong><span>{{ item.vendor || item.paymentMode }}</span></div><strong>{{ item.amount | auraMoney:'1.0-0' }}</strong></article>
            <article *ngFor="let item of summary()?.refunds || []"><div><strong>Refund</strong><span>{{ item.reason || item.invoiceId }}</span></div><strong>{{ item.amount | auraMoney:'1.0-0' }}</strong></article>
          </div>
        </div>
        <div>
          <div class="register-heading">
            <div>
              <h2>Closing history</h2>
            </div>
          </div>
          <div class="rank-list">
            <article *ngFor="let closing of summary()?.closings || []"><div><strong>{{ closing.businessDate }}</strong><span>{{ closing.status }} · variance {{ closing.variance | auraMoney:'1.0-0' }}</span></div><small>{{ closing.createdAt | auraDate:'date' }}</small></article>
          </div>
        </div>
      </section>

      <pre class="result-json" *ngIf="result()">{{ result() | json }}</pre>
    </section>
  `,
  styles: [`
    .finance-workspace { display: grid; gap: 8px; padding: 8px; color: #1d2430; background: #f0f2f5; min-height: calc(100vh - 20px); }
    .command-bar { min-height: 58px; background: #111827; color: #f8fafc; display: flex; align-items: center; gap: 12px; padding: 10px 18px; border-bottom: 1px solid #d4dee8; }
    .brand-mark { width: 34px; height: 34px; border-radius: 8px; background: #6654d9; display: grid; place-items: center; font-weight: 900; }
    .command-bar p { margin: 0; color: #7f8da3; font-size: 10px; font-weight: 900; text-transform: uppercase; }
    .command-bar strong { display: block; font-size: 16px; }
    .top-actions { margin-left: auto; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
    .top-actions button, .quick-buttons button { min-height: 30px; border: 1px solid #c6d7ea; background: #fff; color: #0963a6; border-radius: 3px; padding: 6px 12px; font-weight: 900; cursor: pointer; }
    .top-actions span { color: #9aa8bd; font-size: 12px; }
    .quick-actions { display: grid; grid-template-columns: 1fr auto; gap: 10px; padding: 18px 14px 10px; background: #fff; border: 1px solid #d9e1ea; }
    .branch-label { grid-row: span 2; align-self: center; font-weight: 900; text-transform: lowercase; }
    .quick-buttons { display: flex; gap: 8px; justify-content: flex-end; flex-wrap: wrap; }
    .quick-actions > select { grid-column: 2; min-width: min(620px, 100%); }
    .page-title { display: flex; align-items: end; justify-content: space-between; gap: 16px; padding: 14px; background: #fff; border: 1px solid #d9e1ea; }
    .page-title h1, .desk-heading h2, .register-heading h2 { margin: 0; letter-spacing: 0; }
    .page-title p { margin: 6px 0 0; color: #38506d; font-size: 13px; }
    .page-title strong, .register-heading > span { color: #5d6f87; font-size: 12px; font-weight: 800; }
    app-state { display: block; margin: 12px 14px 0; }
    .metrics-grid { display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)); gap: 0; padding: 0 14px 12px; background: #fff; border-left: 1px solid #d9e1ea; border-right: 1px solid #d9e1ea; border-bottom: 1px solid #d9e1ea; }
    .metrics-grid article { display: grid; gap: 3px; min-height: 74px; padding: 12px 14px; border: 1px solid #d9e1ea; border-left: 0; border-top: 3px solid #0a78b6; }
    .metrics-grid article:first-child { border-left: 1px solid #d9e1ea; }
    .metrics-grid span, .metrics-grid small { color: #64748b; font-size: 12px; font-weight: 800; }
    .metrics-grid strong { font-size: 20px; line-height: 1; white-space: nowrap; }
    .workdesk, .register-panel { background: #fff; border: 1px solid #d9e1ea; padding: 12px 14px; display: grid; gap: 10px; }
    .desk-heading, .register-heading { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
    .eyebrow { margin: 0 0 3px; color: #5d6f87; font-size: 11px; font-weight: 900; text-transform: uppercase; }
    .workdesk-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; }
    form { border: 1px solid #d9e1ea; padding: 10px; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; align-content: start; }
    form h3 { grid-column: 1 / -1; margin: 0 0 4px; font-size: 15px; }
    .field { display: grid; gap: 5px; color: #5d6f87; font-size: 11px; font-weight: 900; }
    .field.full { grid-column: 1 / -1; }
    input, select { border: 1px solid #bdcfe2; border-radius: 3px; min-height: 34px; padding: 7px 10px; font: inherit; color: #1d2430; background: #fff; min-width: 0; }
    .form-actions { grid-column: 1 / -1; display: flex; justify-content: flex-end; gap: 8px; flex-wrap: wrap; }
    .ghost-button, .primary-button { min-height: 32px; border: 1px solid #c6d7ea; border-radius: 3px; padding: 7px 12px; font-weight: 900; cursor: pointer; }
    .ghost-button { background: #fff; color: #0963a6; }
    .primary-button { background: #55173D; color: #fff; border-color: #55173D; }
    button:disabled { opacity: .55; cursor: not-allowed; }
    .table-wrap { overflow: auto; border: 1px solid #d9e1ea; }
    table { width: 100%; min-width: 760px; border-collapse: collapse; font-size: 13px; }
    th { background: #f1f5f9; color: #4b5f78; text-align: left; font-size: 11px; text-transform: uppercase; padding: 10px 12px; border-bottom: 1px solid #d9e1ea; }
    td { padding: 12px; border-bottom: 1px solid #d9e1ea; }
    tbody tr:hover { background: #f5fbff; }
    .badge { display: inline-flex; border-radius: 3px; background: #dff7e8; color: #087443; font-size: 12px; font-weight: 900; padding: 5px 9px; }
    .empty-state { color: #64748b; display: grid; gap: 4px; padding: 12px; text-align: center; }
    .two-registers { grid-template-columns: repeat(2, minmax(0, 1fr)); align-items: start; }
    .rank-list { display: grid; border: 1px solid #d9e1ea; }
    .rank-list article { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 12px; border-bottom: 1px solid #d9e1ea; }
    .rank-list article:last-child { border-bottom: 0; }
    .rank-list span, .rank-list small { color: #64748b; font-size: 12px; }
    .result-json { margin: 12px 14px; background: #111827; color: #f8fafc; border-radius: 3px; padding: 12px; overflow: auto; }

    :host .finance-engine,
    :host .page-stack { background: var(--bg); }
    :host .module-hero,
    :host .metrics-grid,
    :host .metrics-grid article,
    :host .panel,
    :host .workdesk-card,
    :host .table-wrap {
      border-color: rgba(118, 85, 76, 0.13) !important;
      border-radius: 14px !important;
      background: #fff !important;
      background-image: none !important;
      box-shadow: 0 1px 2px rgba(41, 31, 28, 0.03), 0 10px 26px rgba(73, 51, 43, 0.045) !important;
    }
    :host .metrics-grid { gap: 12px; padding: 12px; }
    :host .metrics-grid article { border-left: 3px solid rgba(154, 106, 96, 0.68) !important; border-top: 1px solid rgba(118, 85, 76, 0.13) !important; }
    :host h1, :host h2, :host h3, :host .metrics-grid strong { color: #302522 !important; font-weight: 630 !important; }
    :host .metrics-grid span, :host .metrics-grid small, :host th { color: #766763 !important; font-weight: 540 !important; }
    :host th { background: #faf7f4 !important; }
    :host tbody tr:hover td { background: #fffaf7 !important; }
    @media (max-width: 1100px) {
      .metrics-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); }
      .workdesk-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    }
    @media (max-width: 800px) {
      .command-bar, .page-title, .desk-heading, .register-heading { align-items: flex-start; flex-direction: column; }
      .top-actions { margin-left: 0; }
      .quick-actions, .metrics-grid, .workdesk-grid, .two-registers { grid-template-columns: 1fr; }
      .quick-actions > select { grid-column: auto; min-width: 0; }
      .quick-buttons { justify-content: flex-start; }
      .metrics-grid article, .metrics-grid article:first-child { border-left: 1px solid #d9e1ea; }
      form { grid-template-columns: 1fr; }
    }
  `]
})
export class FinanceEngineComponent implements OnInit {
  readonly summary = signal<ApiRecord | null>(null);
  readonly branches = signal<ApiRecord[]>([]);
  readonly invoices = signal<ApiRecord[]>([]);
  readonly staff = signal<ApiRecord[]>([]);
  readonly result = signal<ApiRecord | null>(null);
  readonly loading = signal(false);
  readonly error = signal('');

  readonly drawerForm = this.fb.group({ branchId: ['', Validators.required], openingFloat: [5000], countedCash: [5000] });
  readonly expenseForm = this.fb.group({ category: ['Supplies', Validators.required], amount: [500, Validators.required], vendor: ['Local supplier'], paymentMode: ['cash'] });
  readonly closingForm = this.fb.group({ businessDate: [new Date().toISOString().slice(0, 10)], notes: [''] });
  readonly invoiceForm = this.fb.group({ invoiceId: [''], amount: [100], mode: ['upi'], reason: ['Finance console action'] });
  readonly payoutForm = this.fb.group({ staffId: [''], periodStart: [new Date().toISOString().slice(0, 8) + '01'], periodEnd: [new Date().toISOString().slice(0, 10)], incentiveAmount: [0], deductions: [0] });

  constructor(private readonly api: ApiService, private readonly fb: UntypedFormBuilder) {}

  ngOnInit(): void {
    this.loadLists();
    this.load();
  }

  loadLists(): void {
    this.api.list<ApiRecord[]>('branches').subscribe((rows) => {
      this.branches.set(rows);
      if (rows[0]) this.drawerForm.patchValue({ branchId: rows[0].id });
    }, (error) => this.error.set(this.api.errorText(error, 'Unable to load finance lists')));
    this.api.list<ApiRecord[]>('invoices').subscribe((rows) => {
      this.invoices.set(rows);
      if (rows[0]) this.invoiceForm.patchValue({ invoiceId: rows[0].id, amount: Math.max(1, Number(rows[0].balance || rows[0].paid || 100)) });
    }, (error) => this.error.set(this.api.errorText(error, 'Unable to load finance lists')));
    this.api.list<ApiRecord[]>('staff').subscribe((rows) => {
      this.staff.set(rows);
      if (rows[0]) this.payoutForm.patchValue({ staffId: rows[0].id });
    }, (error) => this.error.set(this.api.errorText(error, 'Unable to load finance lists')));
  }

  load(): void {
    this.loading.set(true);
    this.error.set('');
    this.api.list<ApiRecord>('finance/summary').subscribe({
      next: (summary) => {
        this.summary.set(summary);
        this.loading.set(false);
      },
      error: (error) => {
        this.error.set(this.api.errorText(error, 'Unable to load finance engine'));
        this.loading.set(false);
      }
    });
  }

  openDrawer(): void {
    this.api.post<ApiRecord>('finance/cash-drawers/open', this.drawerForm.value).subscribe({
      next: (response) => this.afterAction(response),
      error: (error) => this.error.set(this.api.errorText(error, 'Unable to open cash drawer'))
    });
  }

  closeDrawer(): void {
    this.api.patch<ApiRecord>('finance/cash-drawers/close', this.drawerForm.value).subscribe({
      next: (response) => this.afterAction(response),
      error: (error) => this.error.set(this.api.errorText(error, 'Unable to close cash drawer'))
    });
  }

  addExpense(): void {
    this.api.post<ApiRecord>('finance/expenses', { ...this.expenseForm.value, branchId: this.drawerForm.value.branchId }).subscribe({
      next: (response) => this.afterAction(response),
      error: (error) => this.error.set(this.api.errorText(error, 'Unable to add expense'))
    });
  }

  dailyClosing(): void {
    this.api.post<ApiRecord>('finance/daily-closing', { ...this.closingForm.value, branchId: this.drawerForm.value.branchId }).subscribe({
      next: (response) => this.afterAction(response),
      error: (error) => this.error.set(this.api.errorText(error, 'Unable to close day'))
    });
  }

  partialPayment(): void {
    this.api.post<ApiRecord>(`finance/invoices/${this.invoiceForm.value.invoiceId}/partial-payment`, this.invoiceForm.value).subscribe({
      next: (response) => this.afterAction(response),
      error: (error) => this.error.set(this.api.errorText(error, 'Unable to add invoice payment'))
    });
  }

  refund(): void {
    this.api.post<ApiRecord>('finance/refunds', { ...this.invoiceForm.value, invoiceId: this.invoiceForm.value.invoiceId }).subscribe({
      next: (response) => this.afterAction(response),
      error: (error) => this.error.set(this.api.errorText(error, 'Unable to refund invoice'))
    });
  }

  staffPayout(): void {
    this.api.post<ApiRecord>('finance/staff-payouts', this.payoutForm.value).subscribe({
      next: (response) => this.afterAction(response),
      error: (error) => this.error.set(this.api.errorText(error, 'Unable to calculate staff payout'))
    });
  }

  afterAction(response: ApiRecord): void {
    this.error.set('');
    this.result.set(response);
    this.loadLists();
    this.load();
  }

  protected readonly Boolean = Boolean;
}
