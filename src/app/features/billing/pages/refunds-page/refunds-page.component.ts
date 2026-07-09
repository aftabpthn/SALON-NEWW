import { CommonModule } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { catchError, firstValueFrom, of, Observable } from 'rxjs';
import { ApiRecord, ApiService } from '../../../../core/api.service';
import { AuthSessionService } from '../../../../core/auth-session.service';
import { grantsAllow, staticGrantsForRole } from '../../../../core/permission.guard';
import { routePermissionForPath } from '../../../../core/access-rules';
import { AppStateService } from '../../../../core/state/app-state.service';

type ActionKind = 'refund' | 'void' | 'credit-note';
type InvoiceListResponse = { rows?: ApiRecord[]; total?: number } | ApiRecord[];

@Component({
  selector: 'app-refunds-page',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  styles: [`
    .refund-shell { display: grid; gap: 16px; padding: 16px; color: #172033; }
    .hero, .panel, .metric-card, .queue-row, .action-box { background: #fff; border: 1px solid #dbe5e8; border-radius: 8px; }
    .hero { display: flex; justify-content: space-between; gap: 16px; align-items: flex-start; padding: 18px; background: linear-gradient(135deg, #f8fffd, #fff 60%, #f6f3e8); }
    .hero-copy, .stack, .action-box, .panel { display: grid; gap: 12px; }
    .eyebrow { color: #526174; font-size: .75rem; font-weight: 800; letter-spacing: 0; text-transform: uppercase; }
    h1, h2, h3, p { margin: 0; }
    h1 { font-size: clamp(1.55rem, 3vw, 2.25rem); line-height: 1.12; }
    h2 { font-size: 1.05rem; }
    .muted { color: #617086; }
    .hero-actions, .toolbar, .button-row, .inline-fields { display: flex; gap: 10px; flex-wrap: wrap; align-items: center; }
    .metric-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; }
    .metric-card { padding: 14px; min-height: 92px; display: grid; gap: 4px; }
    .metric-card strong { font-size: 1.5rem; }
    button, .button, input, select, textarea { min-height: 40px; border-radius: 8px; border: 1px solid #cfdde2; padding: 0 12px; font: inherit; }
    textarea { min-height: 82px; padding: 10px 12px; resize: vertical; }
    button, .button { display: inline-flex; justify-content: center; align-items: center; gap: 8px; font-weight: 800; text-decoration: none; cursor: pointer; }
    button.primary, .button.primary { background: #5A153F; border-color: #5A153F; color: #fff; }
    button.ghost, .button.ghost { background: #fff; color: #172033; }
    button.danger { background: #b42318; border-color: #b42318; color: #fff; }
    button:disabled { opacity: .55; cursor: not-allowed; }
    .grid { display: grid; grid-template-columns: minmax(0, 1.4fr) minmax(320px, .8fr); gap: 16px; align-items: start; }
    .queue-list { display: grid; gap: 10px; }
    .queue-row { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 14px; padding: 14px; align-items: center; }
    .queue-main { display: grid; gap: 6px; }
    .pill { border-radius: 999px; padding: 5px 9px; font-size: .78rem; font-weight: 800; background: #eef4f6; color: #526174; }
    .pill.warn { background: #fff5db; color: #925400; }
    .pill.bad { background: #fff0ed; color: #b42318; }
    .pill.ok { background: #FBF0E8; color: #7A4A28; }
    .action-box { padding: 14px; background: #fbfdfc; }
    .field { display: grid; gap: 6px; }
    .field span { font-size: .82rem; color: #526174; font-weight: 800; }
    .inline-fields { align-items: end; }
    .inline-fields .field { flex: 1 1 160px; }
    .empty, .error { padding: 14px; border-radius: 8px; background: #f8faf9; color: #617086; }
    .error { background: #fff0ed; color: #b42318; }
    @media (max-width: 900px) {
      .hero, .grid { display: grid; grid-template-columns: 1fr; }
      .metric-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .queue-row { grid-template-columns: 1fr; }
    }
    @media (max-width: 560px) {
      .metric-grid { grid-template-columns: 1fr; }
      .refund-shell { padding: 12px; }
    }
  `],
  template: `
    <section class="refund-shell inner-page-shell">
      <header class="hero inner-page-header">
        <div class="hero-copy">
          <h1>Refund, void and credit note approval queue</h1>
        </div>
        <div class="hero-actions">
          <button class="ghost" type="button" [disabled]="loading()" (click)="load()">Refresh</button>
          <a class="button ghost" routerLink="/pos/invoices" *ngIf="canAccessPath('/pos/invoices')">Open POS invoices</a>
          <a class="button primary" routerLink="/billing/core-money-flow">Core Money Flow</a>
        </div>
      </header>

      <section class="metric-grid inner-stats-grid">
        <article class="metric-card"><strong>{{ money(refundableTotal()) }}</strong><small class="muted">{{ refundableRows().length }} invoices</small></article>
        <article class="metric-card"><strong>{{ refundedRows().length }}</strong><small class="muted">{{ money(refundedTotal()) }} processed</small></article>
        <article class="metric-card"><strong>{{ voidCandidateRows().length }}</strong></article>
        <article class="metric-card"><strong>{{ creditNoteRows().length }}</strong></article>
      </section>

      <section class="grid">
        <div class="panel inner-page-card">
          <div class="toolbar inner-action-bar">
            <div class="field">
              <span>Search invoice/client</span>
              <input [ngModel]="search()" (ngModelChange)="search.set($event)" placeholder="Invoice no, customer, status" />
            </div>
            <div class="field">
              <span>Queue filter</span>
              <select [ngModel]="filter()" (ngModelChange)="setFilter($event)">
                <option value="all">All actionable</option>
                <option value="refund">Refundable only</option>
                <option value="void">Void candidates</option>
                <option value="credit">Credit note ready</option>
              </select>
            </div>
          </div>

          <div class="queue-list" *ngIf="filteredRows().length; else emptyQueue">
            <article class="queue-row" *ngFor="let invoice of filteredRows()">
              <div class="queue-main">
                <div class="toolbar">
                  <h3>{{ invoiceLabel(invoice) }}</h3>
                  <span class="pill" [class.ok]="paymentStatus(invoice) === 'paid'" [class.warn]="refundableAmount(invoice) > 0" [class.bad]="status(invoice) === 'voided'">{{ status(invoice) || 'open' }}</span>
                  <span class="pill">{{ paymentStatus(invoice) || 'payment open' }}</span>
                </div>
                <p class="muted">Paid {{ money(invoice['paid_amount']) }} / Due {{ money(invoice['due_amount']) }} / Refunded {{ money(invoice['refund_amount']) }}</p>
                <strong>Refundable {{ money(refundableAmount(invoice)) }} · Total {{ money(invoice['grand_total']) }}</strong>
              </div>
              <div class="button-row">
                <button class="ghost" type="button" (click)="select(invoice, 'refund')" [disabled]="refundableAmount(invoice) <= 0">Refund</button>
                <button class="ghost" type="button" (click)="select(invoice, 'credit-note')">Credit note</button>
                <button class="danger" type="button" (click)="select(invoice, 'void')" [disabled]="!canVoid(invoice)">Void</button>
              </div>
            </article>
          </div>
          <ng-template #emptyQueue><div class="empty">No actionable invoice found for this filter.</div></ng-template>
        </div>

        <aside class="action-box inner-page-card">
          <div>
            <h2>{{ actionTitle() }}</h2>
            <p class="muted" *ngIf="selectedInvoice(); else noSelection">{{ invoiceLabel(selectedInvoice()) }} selected hai.</p>
            <ng-template #noSelection></ng-template>
          </div>

          <div class="inline-fields inner-form-grid">
            <label class="field">
              <span>Action</span>
              <select [ngModel]="actionKind()" (ngModelChange)="setActionKind($event)">
                <option value="refund">Refund</option>
                <option value="credit-note">Credit note</option>
                <option value="void">Void</option>
              </select>
            </label>
            <label class="field" *ngIf="actionKind() !== 'void'">
              <span>Amount</span>
              <input type="number" [ngModel]="amount()" (ngModelChange)="amount.set(numberValue($event))" />
            </label>
            <label class="field" *ngIf="actionKind() === 'refund'">
              <span>Refund type</span>
              <select [ngModel]="refundType()" (ngModelChange)="refundType.set($event)">
                <option value="original_payment">Original payment</option>
                <option value="wallet">Wallet credit</option>
                <option value="credit_note">Credit note</option>
              </select>
            </label>
          </div>

          <label class="field">
            <span>Approval reason</span>
            <textarea [ngModel]="reason()" (ngModelChange)="reason.set($event)" placeholder="Client complaint, duplicate payment, wrong bill, service issue..."></textarea>
          </label>

          <label class="field" *ngIf="actionKind() === 'refund'">
            <span>Provider refund/reference ID</span>
            <input [ngModel]="providerRefundId()" (ngModelChange)="providerRefundId.set($event)" placeholder="Optional gateway refund id" />
          </label>

          <label class="field" *ngIf="actionKind() === 'credit-note'">
            <span>Tax rate for credit note</span>
            <input type="number" [ngModel]="creditTaxRate()" (ngModelChange)="creditTaxRate.set(numberValue($event))" />
          </label>

          <button class="primary" type="button" [disabled]="busy() || !canSubmit()" (click)="submitAction()">Approve and post</button>
          <p class="muted" *ngIf="notice()">{{ notice() }}</p>
          <p class="error" *ngIf="error()">{{ error() }}</p>
        </aside>
      </section>
    </section>
  `
})
export class RefundsPageComponent {
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

  readonly invoices = signal<ApiRecord[]>([]);
  readonly loading = signal(false);
  readonly busy = signal(false);
  readonly error = signal('');
  readonly notice = signal('');
  readonly search = signal('');
  readonly filter = signal<'all' | 'refund' | 'void' | 'credit'>('all');
  readonly selectedInvoiceId = signal('');
  readonly actionKind = signal<ActionKind>('refund');
  readonly amount = signal(0);
  readonly reason = signal('');
  readonly refundType = signal('original_payment');
  readonly providerRefundId = signal('');
  readonly creditTaxRate = signal(0);

  readonly selectedInvoice = computed(() => this.invoices().find((invoice) => invoice['id'] === this.selectedInvoiceId()) || null);
  readonly refundableRows = computed(() => this.invoices().filter((invoice) => this.refundableAmount(invoice) > 0));
  readonly refundedRows = computed(() => this.invoices().filter((invoice) => this.moneyValue(invoice['refund_amount']) > 0 || this.status(invoice).includes('refund')));
  readonly voidCandidateRows = computed(() => this.invoices().filter((invoice) => this.canVoid(invoice)));
  readonly creditNoteRows = computed(() => this.invoices().filter((invoice) => String(invoice['invoice_type'] || invoice['source'] || '').toLowerCase().includes('credit_note')));
  readonly refundableTotal = computed(() => this.refundableRows().reduce((sum, invoice) => sum + this.refundableAmount(invoice), 0));
  readonly refundedTotal = computed(() => this.refundedRows().reduce((sum, invoice) => sum + this.moneyValue(invoice['refund_amount']), 0));
  readonly filteredRows = computed(() => {
    const text = this.search().trim().toLowerCase();
    return this.invoices()
      .filter((invoice) => {
        if (this.filter() === 'refund') return this.refundableAmount(invoice) > 0;
        if (this.filter() === 'void') return this.canVoid(invoice);
        if (this.filter() === 'credit') return !this.status(invoice).includes('draft');
        return this.refundableAmount(invoice) > 0 || this.canVoid(invoice) || !this.status(invoice).includes('draft');
      })
      .filter((invoice) => !text || `${this.invoiceLabel(invoice)} ${this.status(invoice)} ${this.paymentStatus(invoice)}`.toLowerCase().includes(text))
      .slice(0, 80);
  });
  readonly actionTitle = computed(() => {
    if (this.actionKind() === 'void') return 'Void approval';
    if (this.actionKind() === 'credit-note') return 'Credit note approval';
    return 'Refund approval';
  });

  ngOnInit(): void {
    this.load();
  }

  async load(): Promise<void> {
    this.loading.set(true);
    this.error.set('');
    try {
      const response = await firstValueFrom(this.safe(this.api.list<InvoiceListResponse>('billing/invoices', { limit: 500 }), { rows: [] }));
      this.invoices.set(this.invoiceRows(response));
    } catch (error) {
      this.error.set(this.api.errorText(error, 'Unable to load refund queue'));
    } finally {
      this.loading.set(false);
    }
  }

  select(invoice: ApiRecord, action: ActionKind): void {
    this.selectedInvoiceId.set(String(invoice['id'] || ''));
    this.actionKind.set(action);
    this.reason.set('');
    this.providerRefundId.set('');
    this.creditTaxRate.set(0);
    this.amount.set(action === 'void' ? 0 : Math.max(0, action === 'refund' ? this.refundableAmount(invoice) : this.moneyValue(invoice['grand_total'])));
  }

  setFilter(value: string): void {
    const next = ['refund', 'void', 'credit'].includes(value) ? (value as 'refund' | 'void' | 'credit') : 'all';
    this.filter.set(next);
  }

  setActionKind(value: string): void {
    this.actionKind.set(value === 'void' || value === 'credit-note' ? value : 'refund');
  }

  canSubmit(): boolean {
    const invoice = this.selectedInvoice();
    if (!invoice || !this.reason().trim()) return false;
    if (this.actionKind() === 'void') return this.canVoid(invoice);
    return this.amount() > 0;
  }

  async submitAction(): Promise<void> {
    const invoice = this.selectedInvoice();
    if (!invoice || !this.canSubmit()) return;
    this.busy.set(true);
    this.error.set('');
    this.notice.set('');
    try {
      if (this.actionKind() === 'refund') {
        await firstValueFrom(this.api.postWithHeaders(`billing/invoices/${invoice['id']}/refund`, {
          amount: this.amount(),
          reason: this.reason().trim(),
          refundType: this.refundType(),
          refund_type: this.refundType(),
          providerRefundId: this.providerRefundId().trim(),
          provider_refund_id: this.providerRefundId().trim(),
          paymentMode: this.refundType() === 'wallet' ? 'wallet' : 'bank'
        }, { 'Idempotency-Key': `refund-${invoice['id']}-${Date.now()}` }));
      } else if (this.actionKind() === 'void') {
        await firstValueFrom(this.api.post(`billing/invoices/${invoice['id']}/void`, { reason: this.reason().trim() }));
      } else {
        await firstValueFrom(this.api.post(`billing/invoices/${invoice['id']}/credit-note`, {
          amount: this.amount(),
          reason: this.reason().trim(),
          tax_rate: this.creditTaxRate()
        }));
      }
      this.notice.set(`${this.actionTitle()} posted for ${this.invoiceLabel(invoice)}.`);
      await this.load();
    } catch (error) {
      this.error.set(this.api.errorText(error, `${this.actionTitle()} failed`));
    } finally {
      this.busy.set(false);
    }
  }

  canVoid(invoice: ApiRecord | null): boolean {
    if (!invoice) return false;
    const state = this.status(invoice);
    if (state === 'voided' || state === 'cancelled') return false;
    return state === 'draft' || String(invoice['created_at'] || '').slice(0, 10) === new Date().toISOString().slice(0, 10);
  }

  refundableAmount(invoice: ApiRecord | null): number {
    if (!invoice) return 0;
    return Math.max(0, this.moneyValue(invoice['paid_amount']) - this.moneyValue(invoice['refund_amount']));
  }

  invoiceLabel(invoice: ApiRecord | null): string {
    if (!invoice) return 'No invoice';
    return String(invoice['invoice_no'] || invoice['invoiceNo'] || invoice['id'] || 'Invoice');
  }

  status(invoice: ApiRecord | null): string {
    return String(invoice?.['status'] || '').trim().toLowerCase();
  }

  paymentStatus(invoice: ApiRecord | null): string {
    return String(invoice?.['payment_status'] || invoice?.['paymentStatus'] || '').trim().toLowerCase();
  }

  money(value: unknown): string {
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(this.moneyValue(value));
  }

  numberValue(value: unknown): number {
    const amount = Number(value || 0);
    return Number.isFinite(amount) ? amount : 0;
  }

  private moneyValue(value: unknown): number {
    return this.numberValue(value);
  }

  private invoiceRows(response: InvoiceListResponse): ApiRecord[] {
    if (Array.isArray(response)) return response;
    return Array.isArray(response?.rows) ? response.rows : [];
  }

  private safe<T>(source: Observable<T>, fallback: T): Observable<T> {
    return source.pipe(catchError(() => of(fallback)));
  }
}
