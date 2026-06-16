import { CommonModule } from '@angular/common';
import { Component, OnInit, computed, signal } from '@angular/core';
import { FormsModule, ReactiveFormsModule, UntypedFormBuilder, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { forkJoin } from 'rxjs';
import { ApiRecord, ApiService } from '../core/api.service';
import { StateComponent } from '../shared/ui/state/state.component';

type LedgerAccount = ApiRecord & {
  id: string;
  accountName: string;
  groupName?: string;
  status?: string;
  isHidden?: boolean;
};

type OutgoingLineItem = {
  sno: number;
  type: string;
  accountId: string;
  accountName: string;
  amount: number;
  salaryMonthYear: string;
  remarks: string;
};

type LineDialogDraft = {
  open: boolean;
  type: string;
  accountId: string;
  amountText: string;
  salaryMonthYear: string;
  remarks: string;
};

type OutgoingFundEntry = ApiRecord & {
  id: string;
  entryNo: string;
  entryDate: string;
  expenseBranchName?: string;
  paidFromAccountId: string;
  paidFromAccountName: string;
  amount: number;
  paymentMode: string;
  chequeDate?: string;
  chequeNo?: string;
  transactionType?: string;
  lineItems?: OutgoingLineItem[];
  remarks?: string;
  status: 'draft' | 'posted' | 'cancelled' | 'deleted';
  balanceSheetLink?: {
    status: string;
    eventKey?: string;
    journalEntryId?: string;
    lastError?: string;
  };
};

@Component({
  selector: 'app-outgoing-funds-entry',
  standalone: true,
  imports: [CommonModule, FormsModule, ReactiveFormsModule, RouterLink, StateComponent],
  template: `
    <section class="outgoing-page">
      <header class="module-hero">
        <div>
          <span class="eyebrow">Transactions / Funds</span>
          <h2>Outgoing Funds Entry</h2>
          <p>Enter cash, bank, expense, salary, advance, loan and purchase payment vouchers with editable line items.</p>
        </div>
        <div class="hero-actions">
          <a class="ghost-button" routerLink="/transactions/outgoing-funds-report">Saved Page</a>
          <a class="ghost-button" routerLink="/balance-sheet">Open Balance Sheet</a>
          <button class="ghost-button" type="button" (click)="processGlOutbox()" [disabled]="saving()">Process GL</button>
          <button class="ghost-button" type="button" (click)="load()">Refresh</button>
          <button class="primary-button" type="button" (click)="startNew()">Add</button>
        </div>
      </header>

      <app-state [loading]="loading()" [error]="error()"></app-state>
      <p class="state success" *ngIf="success()">{{ success() }}</p>

      <section class="metric-grid" *ngIf="!loading() && !error()">
        <article><span>Total outgoing</span><strong>{{ money(totalOutgoing()) }}</strong><small>Visible transaction entries</small></article>
        <article><span>Draft entries</span><strong>{{ draftCount() }}</strong><small>Not posted yet</small></article>
        <article><span>Posted entries</span><strong>{{ postedCount() }}</strong><small>Ready for ledger review</small></article>
        <article><span>Balance Sheet link</span><strong>{{ linkedCount() }}/{{ postableCount() }}</strong><small>Queued or posted to GL outbox</small></article>
      </section>

      <div class="outgoing-layout" *ngIf="!loading() && !error()">
        <aside class="entry-register">
          <div class="panel-title">
            <div>
              <span class="eyebrow">Find</span>
              <h3>Saved vouchers</h3>
            </div>
            <button class="ghost-button mini" type="button" (click)="startNew()">Add</button>
          </div>
          <label class="search-row">
            <span>Search</span>
            <input [ngModel]="query()" (ngModelChange)="query.set($event)" placeholder="OG no, cash/bank, type, remarks" />
          </label>
          <div class="entry-list">
            <button
              type="button"
              class="saved-entry"
              *ngFor="let entry of filteredEntries()"
              [class.selected]="selected()?.id === entry.id"
              (click)="selectEntry(entry)"
            >
              <span>
                <strong>{{ entry.entryNo || '-' }}</strong>
                <small>{{ entry.entryDate }} · {{ entry.transactionType || 'Outgoing' }}</small>
              </span>
              <span>
                <strong>{{ money(entry.amount) }}</strong>
                <small>{{ balanceSheetLabel(entry) }}</small>
              </span>
            </button>
            <div class="empty-state" *ngIf="!filteredEntries().length">
              <strong>No voucher found</strong>
              <span>Use Add and Save to create the first outgoing voucher.</span>
            </div>
          </div>
        </aside>

        <section class="voucher-window">
          <div class="window-titlebar">
            <h3>Outgoing Funds Entry</h3>
            <strong>{{ currentBalanceSheetLabel() }}</strong>
          </div>

          <form [formGroup]="entryForm" (ngSubmit)="saveEntry()" class="voucher-form">
            <div class="voucher-head">
              <label><span>Date :</span><span class="picker-field"><input #entryDateInput type="date" formControlName="entryDate" /><button type="button" (click)="openPicker(entryDateInput)">▣</button></span></label>
              <label><span>OG No :</span><input formControlName="entryNo" placeholder="Auto" /></label>
              <label><span>Exp. Branch :</span><input formControlName="expenseBranchName" /></label>
              <label class="wide"><span>Cash / Bank :</span>
                <select formControlName="paidFromAccountId" (change)="syncCashBank()">
                  <option value="">Select cash / bank</option>
                  <option *ngFor="let account of cashBankAccounts()" [value]="account.id">{{ account.accountName }}</option>
                </select>
              </label>
              <label><span>Cheque Date :</span><span class="picker-field"><input #chequeDateInput type="date" formControlName="chequeDate" /><button type="button" (click)="openPicker(chequeDateInput)">▣</button></span></label>
              <label><span>Cheque No :</span><input formControlName="chequeNo" /></label>
            </div>

            <div class="line-grid">
              <div class="line-head">
                <span>Sno</span>
                <span>Date</span>
                <span>Type</span>
                <span>Account / Particular</span>
                <span>Amount</span>
                <span>Salary Month / Year</span>
                <span>Remarks</span>
                <span></span>
              </div>

              <div class="line-row" *ngFor="let item of lineItems(); let i = index">
                <span class="sno">{{ i + 1 }}</span>
                <span>{{ entryForm.value.entryDate || '-' }}</span>
                <select [ngModel]="item.type" [ngModelOptions]="{ standalone: true }" (ngModelChange)="updateLine(i, { type: $event })">
                  <option *ngFor="let type of transactionTypes" [value]="type">{{ type }}</option>
                </select>
                <select [ngModel]="item.accountId" [ngModelOptions]="{ standalone: true }" (ngModelChange)="setLineAccount(i, $event)">
                  <option value="">Select account</option>
                  <option *ngFor="let account of accounts()" [value]="account.id">{{ account.accountName }}{{ account.groupName ? ' - ' + account.groupName : '' }}</option>
                </select>
                <input type="text" inputmode="decimal" [value]="amountInput(item.amount)" (input)="updateLineAmount(i, $any($event.target).value)" />
                <input type="month" [ngModel]="item.salaryMonthYear" [ngModelOptions]="{ standalone: true }" (ngModelChange)="updateLine(i, { salaryMonthYear: $event })" />
                <input [ngModel]="item.remarks" [ngModelOptions]="{ standalone: true }" (ngModelChange)="updateLine(i, { remarks: $event })" />
                <button class="icon-button danger" type="button" (click)="removeLine(i)">×</button>
              </div>
            </div>

            <div class="category-strip">
              <button type="button" *ngFor="let type of transactionTypes" [class.active]="activeType() === type" (click)="openLineDialog(type)">{{ type }}</button>
              <button class="utility" type="button" (click)="openLineDialog(activeType())">Add Row</button>
              <button class="utility danger" type="button" (click)="removeLastLine()" [disabled]="!lineItems().length">Delete Row</button>
            </div>

            <div class="dialog-backdrop" *ngIf="lineDialog().open">
              <div class="entry-dialog">
                <div class="dialog-title">
                  <h3>{{ dialogTitle(lineDialog().type) }}</h3>
                  <button type="button" (click)="closeLineDialog()">Exit</button>
                </div>
                <label><span>Name :</span>
                  <select [ngModel]="lineDialog().accountId" [ngModelOptions]="{ standalone: true }" (ngModelChange)="patchLineDialog({ accountId: $event })">
                    <option value="">Select name</option>
                    <option *ngFor="let account of dialogAccounts(lineDialog().type)" [value]="account.id">{{ account.accountName }}{{ account.groupName ? ' - ' + account.groupName : '' }}</option>
                  </select>
                </label>
                <label><span>Amount :</span><input type="text" inputmode="decimal" [ngModel]="lineDialog().amountText" [ngModelOptions]="{ standalone: true }" (ngModelChange)="patchLineDialog({ amountText: $event })" /></label>
                <label *ngIf="lineDialog().type === 'Salary'"><span>Salary Month :</span><input type="month" [ngModel]="lineDialog().salaryMonthYear" [ngModelOptions]="{ standalone: true }" (ngModelChange)="patchLineDialog({ salaryMonthYear: $event })" /></label>
                <label><span>Remarks :</span><textarea rows="3" [ngModel]="lineDialog().remarks" [ngModelOptions]="{ standalone: true }" (ngModelChange)="patchLineDialog({ remarks: $event })"></textarea></label>
                <button class="dialog-ok" type="button" (click)="commitLineDialog()">Ok</button>
              </div>
            </div>

            <div class="remarks-footer">
              <label>
                <span>Remarks :</span>
                <textarea formControlName="remarks" rows="3"></textarea>
              </label>
              <div class="voucher-total">
                <span>Total Amount</span>
                <strong>{{ money(lineTotal()) }}</strong>
              </div>
            </div>

            <div class="bottom-toolbar">
              <button class="tool-button" type="button" (click)="printVoucher()">Print</button>
              <button class="tool-button primary-tool" type="submit" [disabled]="entryForm.invalid || !lineTotal() || saving()">{{ saving() ? 'Saving' : 'Save' }}</button>
              <a class="tool-button" routerLink="/transactions/outgoing-funds-report">Saved Page</a>
              <a class="tool-button" routerLink="/balance-sheet">Balance Sheet</a>
              <button class="tool-button" type="button" (click)="focusFind()">Find</button>
              <button class="tool-button danger-tool" type="button" (click)="deleteSelected()" [disabled]="!editingId() || saving()">Delete</button>
              <button class="tool-button" type="button" (click)="cancelEdit()">Cancel</button>
            </div>
          </form>
        </section>
      </div>
    </section>
  `,
  styles: [`
    .outgoing-page { display: grid; gap: 18px; color: #0f172a; }
    .module-hero, .entry-register, .voucher-window, .metric-grid article {
      background: #fff;
      border: 1px solid #d8e2e8;
      border-radius: 8px;
      box-shadow: 0 16px 34px rgba(15, 23, 42, .06);
    }
    .module-hero { display: flex; align-items: center; justify-content: space-between; gap: 18px; padding: 22px 24px; }
    .module-hero h2 { margin: 4px 0 8px; font-size: 34px; letter-spacing: 0; }
    .module-hero p { margin: 0; color: #53657d; max-width: 790px; line-height: 1.5; }
    .hero-actions, .bottom-toolbar { display: flex; gap: 10px; flex-wrap: wrap; justify-content: flex-end; }
    .eyebrow { text-transform: uppercase; font-size: 12px; font-weight: 900; color: #5b6f85; letter-spacing: 0; }
    .metric-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; }
    .metric-grid article { padding: 16px; border-top: 4px solid #0f8f79; }
    .metric-grid span, .metric-grid small { display: block; color: #53657d; font-weight: 800; }
    .metric-grid strong { display: block; margin: 8px 0 5px; font-size: 30px; line-height: 1; }
    .outgoing-layout { display: grid; grid-template-columns: 360px minmax(0, 1fr); gap: 16px; align-items: start; }
    .entry-register { padding: 14px; }
    .panel-title { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 12px; }
    .panel-title h3 { margin: 3px 0 0; letter-spacing: 0; }
    .search-row { display: grid; grid-template-columns: 58px 1fr; align-items: center; gap: 8px; font-weight: 900; color: #334155; margin-bottom: 10px; }
    .search-row input, .voucher-head input, .voucher-head select, .line-row input, .line-row select, .remarks-footer textarea {
      width: 100%;
      border: 1px solid #9fb2b8;
      border-radius: 3px;
      padding: 8px 9px;
      font: inherit;
      background: #fff;
      color: #0f172a;
    }
    .picker-field { display: grid; grid-template-columns: 1fr 36px; gap: 4px; }
    .picker-field button {
      border: 1px solid #9fb2b8;
      border-radius: 3px;
      background: #fff;
      color: #0f172a;
      font-weight: 900;
      cursor: pointer;
    }
    .entry-list { display: grid; max-height: 690px; overflow: auto; border: 1px solid #d8e2e8; border-radius: 6px; }
    .saved-entry { display: grid; grid-template-columns: 1fr 112px; gap: 10px; width: 100%; border: 0; border-bottom: 1px solid #edf2f5; background: #fff; color: #0f172a; text-align: left; padding: 10px; cursor: pointer; }
    .saved-entry:hover, .saved-entry.selected { background: #eefaf6; }
    .saved-entry.selected { box-shadow: inset 4px 0 0 #0f8f79; }
    .saved-entry strong, .saved-entry small { display: block; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .saved-entry small { margin-top: 3px; color: #53657d; font-size: 12px; }
    .saved-entry span:last-child { text-align: right; }
    .voucher-window { overflow: hidden; background: #cfe6e2; }
    .window-titlebar { display: flex; align-items: center; justify-content: space-between; gap: 12px; background: #5a999b; color: #fff; padding: 9px 12px; }
    .window-titlebar h3 { margin: 0; font-size: 22px; letter-spacing: 0; }
    .window-titlebar strong { font-size: 20px; }
    .voucher-form { display: grid; gap: 10px; padding: 10px; }
    .voucher-head { display: grid; grid-template-columns: 170px 150px 210px 280px 190px 180px; gap: 9px 12px; align-items: end; }
    .voucher-head label, .remarks-footer label { display: grid; gap: 5px; color: #26364b; font-weight: 900; }
    .voucher-head span, .remarks-footer span { font-size: 13px; }
    .line-grid { border: 1px solid #8ea4aa; background: #fff; min-height: 390px; overflow: auto; }
    .line-head, .line-row { display: grid; grid-template-columns: 48px 120px 130px minmax(220px, 1fr) 120px 160px minmax(180px, .8fr) 46px; align-items: stretch; }
    .line-head { position: sticky; top: 0; z-index: 1; background: #eef3f6; color: #26364b; font-size: 12px; font-weight: 950; }
    .line-head span, .line-row > span, .line-row input, .line-row select { border-right: 1px solid #d1dce1; border-bottom: 1px solid #e2e8ec; border-radius: 0; }
    .line-head span, .line-row > span { padding: 8px; }
    .line-row input, .line-row select { border-left: 0; border-top: 0; }
    .sno { display: grid; place-items: center; font-weight: 900; color: #53657d; }
    .category-strip { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
    .category-strip button, .tool-button, .ghost-button, .primary-button, .icon-button {
      border: 1px solid #9fb2b8;
      border-radius: 4px;
      background: #fff;
      color: #0f172a;
      padding: 8px 11px;
      font-weight: 900;
      cursor: pointer;
      text-decoration: none;
    }
    .category-strip button.active { background: #0f8f79; border-color: #0f8f79; color: #fff; }
    .category-strip .utility { margin-left: 6px; }
    .category-strip .danger, .danger-tool, .icon-button.danger { color: #b91c1c; }
    .dialog-backdrop { position: fixed; inset: 0; z-index: 20; display: grid; place-items: center; background: rgba(15, 23, 42, .16); }
    .entry-dialog { width: min(430px, calc(100vw - 28px)); border: 3px solid #5a999b; background: #cfe6e2; box-shadow: 0 18px 42px rgba(15, 23, 42, .25); }
    .dialog-title { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 6px 8px; background: #5a999b; color: #fff; }
    .dialog-title h3 { margin: 0; font-size: 20px; }
    .dialog-title button { border: 1px solid #d8e2e8; background: #fff; color: #0f172a; font-weight: 900; cursor: pointer; }
    .entry-dialog label { display: grid; grid-template-columns: 90px 1fr; gap: 10px; align-items: center; padding: 10px 22px 0; color: #26364b; font-weight: 900; }
    .entry-dialog input, .entry-dialog select, .entry-dialog textarea { width: 100%; border: 1px solid #8ea4aa; border-radius: 2px; padding: 7px 8px; font: inherit; background: #fff; color: #0f172a; }
    .entry-dialog textarea { resize: vertical; }
    .dialog-ok { display: block; min-width: 64px; margin: 16px auto 18px; border: 1px solid #8ea4aa; background: #fff; color: #0f172a; padding: 7px 14px; font-weight: 900; cursor: pointer; }
    .remarks-footer { display: grid; grid-template-columns: minmax(280px, 1fr) 220px; gap: 14px; align-items: end; justify-content: end; }
    .voucher-total { display: grid; gap: 4px; justify-items: end; color: #53657d; font-weight: 850; }
    .voucher-total strong { font-size: 28px; color: #0f172a; }
    .bottom-toolbar { border-top: 1px solid #9fb2b8; padding-top: 8px; }
    .primary-button, .primary-tool { background: #0f8f79; color: #fff; border-color: #0f8f79; }
    button:disabled { opacity: .55; cursor: not-allowed; }
    .ghost-button.mini { padding: 7px 9px; font-size: 12px; }
    .empty-state { padding: 32px 16px; display: grid; gap: 6px; text-align: center; color: #53657d; }
    .empty-state strong { color: #0f172a; }
    @media (max-width: 1340px) {
      .outgoing-layout { grid-template-columns: 1fr; }
      .entry-list { max-height: 300px; }
      .voucher-head { grid-template-columns: repeat(3, minmax(0, 1fr)); }
    }
    @media (max-width: 820px) {
      .module-hero { align-items: stretch; flex-direction: column; }
      .metric-grid, .voucher-head, .remarks-footer { grid-template-columns: 1fr; }
      .line-head, .line-row { grid-template-columns: 42px 110px 120px 220px 110px 140px 180px 42px; min-width: 964px; }
      .bottom-toolbar { justify-content: stretch; }
      .tool-button { flex: 1 1 120px; }
    }
  `]
})
export class OutgoingFundsEntryComponent implements OnInit {
  readonly accounts = signal<LedgerAccount[]>([]);
  readonly entries = signal<OutgoingFundEntry[]>([]);
  readonly lineItems = signal<OutgoingLineItem[]>([]);
  readonly selected = signal<OutgoingFundEntry | null>(null);
  readonly loading = signal(true);
  readonly saving = signal(false);
  readonly error = signal('');
  readonly success = signal('');
  readonly editingId = signal('');
  readonly query = signal('');
  readonly activeType = signal('Daily Exp.');
  readonly lineDialog = signal<LineDialogDraft>(blankDialog('Daily Exp.'));

  readonly transactionTypes = ['Daily Exp.', 'Bank Depo.', 'Purch. Pymt', 'Misc. Pymt', 'Other Out.', 'Salary', 'Advance', 'Loan', 'Daily Inc.'];
  readonly paymentModes = ['Cash', 'Bank Transfer', 'UPI', 'Card', 'Cheque', 'NEFT', 'RTGS', 'IMPS', 'Wallet', 'Other'];

  readonly cashBankAccounts = computed(() => {
    const matches = this.accounts().filter((account) => {
      const haystack = `${account.accountName} ${account.groupName || ''}`.toLowerCase();
      return haystack.includes('cash') || haystack.includes('bank') || haystack.includes('pay') || haystack.includes('upi') || haystack.includes('wallet');
    });
    return matches.length ? matches : this.accounts();
  });

  readonly filteredEntries = computed(() => {
    const term = this.query().trim().toLowerCase();
    const usable = this.entries().filter((entry) => entry.status !== 'deleted');
    if (!term) return usable;
    return usable.filter((entry) =>
      [
        entry.entryNo,
        entry.entryDate,
        entry.expenseBranchName,
        entry.paidFromAccountName,
        entry.paymentMode,
        entry.chequeNo,
        entry.transactionType,
        entry.remarks,
        entry.status
      ].some((value) => stringValue(value).toLowerCase().includes(term))
    );
  });
  readonly lineTotal = computed(() => this.lineItems().reduce((sum, item) => sum + moneyValue(item.amount), 0));
  readonly totalOutgoing = computed(() => this.entries().filter((entry) => entry.status !== 'deleted').reduce((sum, entry) => sum + moneyValue(entry.amount), 0));
  readonly draftCount = computed(() => this.entries().filter((entry) => entry.status === 'draft').length);
  readonly postedCount = computed(() => this.entries().filter((entry) => entry.status === 'posted').length);
  readonly postableCount = computed(() => this.entries().filter((entry) => !['cancelled', 'deleted'].includes(entry.status)).length);
  readonly linkedCount = computed(() => this.entries().filter((entry) => ['pending', 'posted', 'failed'].includes(entry.balanceSheetLink?.status || '')).length);

  readonly entryForm = this.fb.group({
    entryNo: [''],
    entryDate: [new Date().toISOString().slice(0, 10), Validators.required],
    expenseBranchName: [this.api.selectedBranchId() || 'HO'],
    paidFromAccountId: ['', Validators.required],
    paidFromAccountName: [''],
    paymentMode: ['Cash', Validators.required],
    chequeDate: [''],
    chequeNo: [''],
    remarks: [''],
    status: ['draft', Validators.required]
  });

  constructor(private readonly api: ApiService, private readonly fb: UntypedFormBuilder) {}

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.error.set('');
    forkJoin({
      accounts: this.api.list<LedgerAccount[]>('account-master/accounts', { branchId: this.api.selectedBranchId(), includeHidden: true, limit: 1000 }),
      entries: this.api.list<OutgoingFundEntry[]>('transactions/outgoing-funds', { branchId: this.api.selectedBranchId(), limit: 250 })
    }).subscribe({
      next: ({ accounts, entries }) => {
        this.accounts.set((accounts || []).filter((account) => account.status !== 'deleted' && !account.isHidden));
        this.entries.set(entries || []);
        this.loading.set(false);
        const current = this.selected();
        const nextSelected = current ? entries.find((entry) => entry.id === current.id) || null : null;
        if (nextSelected) this.selectEntry(nextSelected);
      },
      error: (error) => {
        this.error.set(error?.error?.error || error?.message || 'Unable to load outgoing funds');
        this.loading.set(false);
      }
    });
  }

  startNew(): void {
    this.editingId.set('');
    this.selected.set(null);
    this.success.set('');
    this.activeType.set('Daily Exp.');
    this.lineItems.set([]);
    this.entryForm.reset(defaultEntryForm(this.api.selectedBranchId()));
  }

  selectEntry(entry: OutgoingFundEntry): void {
    const lineItems = Array.isArray(entry.lineItems) && entry.lineItems.length ? entry.lineItems : [legacyLine(entry)];
    this.selected.set(entry);
    this.editingId.set(entry.id);
    this.activeType.set(lineItems[0]?.type || entry.transactionType || 'Daily Exp.');
    this.lineItems.set(lineItems.map((item, index) => ({ ...blankLine(item.type || 'Daily Exp.'), ...item, sno: index + 1 })));
    this.entryForm.reset({ ...defaultEntryForm(this.api.selectedBranchId()), ...entry });
  }

  cancelEdit(): void {
    const entry = this.selected();
    if (entry) {
      this.selectEntry(entry);
    } else {
      this.startNew();
    }
  }

  syncCashBank(): void {
    const account = this.accounts().find((item) => item.id === this.entryForm.value.paidFromAccountId);
    this.entryForm.patchValue({ paidFromAccountName: account?.accountName || '' });
    const name = stringValue(account?.accountName).toLowerCase();
    if (name.includes('google') || name.includes('paytm') || name.includes('upi')) this.entryForm.patchValue({ paymentMode: 'UPI' });
    if (name.includes('bank')) this.entryForm.patchValue({ paymentMode: 'Bank Transfer' });
    if (name.includes('cash')) this.entryForm.patchValue({ paymentMode: 'Cash' });
  }

  openLineDialog(type: string): void {
    this.activeType.set(type);
    this.lineDialog.set(blankDialog(type, true));
  }

  closeLineDialog(): void {
    this.lineDialog.set({ ...this.lineDialog(), open: false });
  }

  patchLineDialog(patch: Partial<LineDialogDraft>): void {
    this.lineDialog.set({ ...this.lineDialog(), ...patch });
  }

  commitLineDialog(): void {
    const draft = this.lineDialog();
    const account = this.accounts().find((item) => item.id === draft.accountId);
    const amount = moneyValue(draft.amountText.replace(/,/g, ''));
    if (!account || amount <= 0) {
      this.error.set('Name aur amount required hai.');
      return;
    }
    this.error.set('');
    const items = [...this.lineItems()];
    const blankIndex = items.findIndex((item) => !item.accountId && !item.accountName && !moneyValue(item.amount) && !item.remarks);
    const line = {
      ...blankLine(draft.type),
      accountId: account.id,
      accountName: account.accountName,
      amount,
      salaryMonthYear: draft.salaryMonthYear,
      remarks: draft.remarks
    };
    if (blankIndex >= 0) {
      items[blankIndex] = { ...items[blankIndex], ...line };
      this.lineItems.set(this.renumber(items));
    } else {
      this.lineItems.set(this.renumber([...items, line]));
    }
    this.closeLineDialog();
  }

  addLine(type = this.activeType()): void {
    this.lineItems.set(this.renumber([...this.lineItems(), blankLine(type)]));
  }

  removeLine(index: number): void {
    const items = this.lineItems().filter((_, itemIndex) => itemIndex !== index);
    this.lineItems.set(this.renumber(items));
  }

  removeLastLine(): void {
    if (!this.lineItems().length) return;
    this.removeLine(this.lineItems().length - 1);
  }

  updateLine(index: number, patch: Partial<OutgoingLineItem>): void {
    const items = [...this.lineItems()];
    items[index] = { ...items[index], ...patch };
    if (patch.type) this.activeType.set(patch.type);
    this.lineItems.set(this.renumber(items));
  }

  setLineAccount(index: number, accountId: string): void {
    const account = this.accounts().find((item) => item.id === accountId);
    this.updateLine(index, { accountId, accountName: account?.accountName || '' });
  }

  saveEntry(): void {
    if (this.entryForm.invalid) {
      this.entryForm.markAllAsTouched();
      return;
    }
    const lineItems = this.lineItems().filter((item) => moneyValue(item.amount) > 0 || item.accountName || item.remarks);
    if (!lineItems.length || !this.lineTotal()) {
      this.error.set('At least one transaction row with amount is required');
      return;
    }
    this.syncCashBank();
    this.saving.set(true);
    this.error.set('');
    this.success.set('');
    const firstLine = lineItems[0] || blankLine(this.activeType());
    const payload = {
      ...this.entryForm.getRawValue(),
      branchId: this.api.selectedBranchId(),
      expenseBranchId: this.api.selectedBranchId(),
      transactionType: firstLine.type || this.activeType(),
      salaryMonthYear: firstLine.salaryMonthYear,
      paidToAccountId: firstLine.accountId,
      paidToAccountName: firstLine.accountName,
      payeeName: firstLine.accountName,
      amount: this.lineTotal(),
      lineItems: this.renumber(lineItems)
    };
    const request = this.editingId()
      ? this.api.update<OutgoingFundEntry>('transactions/outgoing-funds', this.editingId(), payload)
      : this.api.create<OutgoingFundEntry>('transactions/outgoing-funds', payload);
    request.subscribe({
      next: (entry) => {
        this.saving.set(false);
        this.success.set(this.editingId() ? 'Outgoing voucher updated and linked to Balance Sheet.' : 'Outgoing voucher saved and linked to Balance Sheet.');
        this.editingId.set('');
        this.selected.set(null);
        this.activeType.set('Daily Exp.');
        this.lineItems.set([]);
        this.entryForm.reset(defaultEntryForm(this.api.selectedBranchId()));
        this.load();
      },
      error: (error) => {
        this.error.set(error?.error?.error || error?.message || 'Unable to save outgoing voucher');
        this.saving.set(false);
      }
    });
  }

  processGlOutbox(): void {
    this.saving.set(true);
    this.error.set('');
    this.success.set('');
    this.api.post<ApiRecord>('balance-sheet/outbox/process', { limit: 50 }).subscribe({
      next: (result) => {
        const posted = Number(result?.['posted'] || 0);
        const failed = Number(result?.['failed'] || 0);
        this.success.set(`Balance Sheet GL processed. Posted ${posted}, failed ${failed}.`);
        this.saving.set(false);
        this.load();
      },
      error: (error) => {
        this.error.set(error?.error?.error || error?.message || 'Unable to process Balance Sheet GL outbox');
        this.saving.set(false);
      }
    });
  }

  deleteSelected(): void {
    if (!this.editingId()) return;
    this.saving.set(true);
    this.error.set('');
    this.api.delete('transactions/outgoing-funds', this.editingId()).subscribe({
      next: () => {
        this.saving.set(false);
        this.success.set('Outgoing voucher deleted from register.');
        this.startNew();
        this.load();
      },
      error: (error) => {
        this.error.set(error?.error?.error || error?.message || 'Unable to delete outgoing voucher');
        this.saving.set(false);
      }
    });
  }

  focusFind(): void {
    this.query.set('');
    const input = document.querySelector<HTMLInputElement>('.entry-register .search-row input');
    input?.focus();
  }

  printVoucher(): void {
    globalThis.print();
  }

  numberValue(value: unknown): number {
    return moneyValue(value);
  }

  dialogTitle(type: string): string {
    return ({
      'Daily Exp.': 'Daily Expenses',
      'Bank Depo.': 'Bank Deposit',
      'Purch. Pymt': 'Payment To Vendors',
      'Misc. Pymt': 'Misc. Purchase',
      'Other Out.': 'Other Outgoing',
      Salary: 'Salary',
      Advance: 'Advance',
      Loan: 'Loan',
      'Daily Inc.': 'Daily Income'
    } as Record<string, string>)[type] || type;
  }

  dialogAccounts(type: string): LedgerAccount[] {
    if (type === 'Bank Depo.') return this.cashBankAccounts();
    return this.accounts();
  }

  amountInput(value: unknown): string {
    const amount = moneyValue(value);
    return amount ? String(amount) : '';
  }

  updateLineAmount(index: number, value: string): void {
    this.updateLine(index, { amount: moneyValue(value.replace(/,/g, '')) });
  }

  openPicker(input: HTMLInputElement): void {
    const picker = (input as HTMLInputElement & { showPicker?: () => void }).showPicker;
    if (typeof picker === 'function') picker.call(input);
    else input.focus();
  }

  money(value: unknown): string {
    return moneyValue(value).toLocaleString('en-IN', { maximumFractionDigits: 2, minimumFractionDigits: 2 });
  }

  balanceSheetLabel(entry: OutgoingFundEntry): string {
    const status = entry.balanceSheetLink?.status || 'not-linked';
    if (status === 'posted') return 'Balance Sheet posted';
    if (status === 'pending') return 'Balance Sheet queued';
    if (status === 'failed') return 'Balance Sheet failed';
    return entry.paidFromAccountName || entry.paymentMode || 'Not linked';
  }

  currentBalanceSheetLabel(): string {
    const entry = this.selected();
    return entry ? this.balanceSheetLabel(entry) : 'Add';
  }

  private renumber(items: OutgoingLineItem[]): OutgoingLineItem[] {
    return items.map((item, index) => ({ ...item, sno: index + 1 }));
  }
}

function blankLine(type: string): OutgoingLineItem {
  return {
    sno: 1,
    type,
    accountId: '',
    accountName: '',
    amount: 0,
    salaryMonthYear: '',
    remarks: ''
  };
}

function blankDialog(type: string, open = false): LineDialogDraft {
  return {
    open,
    type,
    accountId: '',
    amountText: '',
    salaryMonthYear: '',
    remarks: ''
  };
}

function legacyLine(entry: OutgoingFundEntry): OutgoingLineItem {
  return {
    sno: 1,
    type: entry.transactionType || 'Daily Exp.',
    accountId: entry.paidToAccountId || '',
    accountName: entry.paidToAccountName || entry.payeeName || '',
    amount: moneyValue(entry.amount),
    salaryMonthYear: entry.salaryMonthYear || '',
    remarks: entry.remarks || ''
  };
}

function defaultEntryForm(branchId = ''): ApiRecord {
  return {
    entryNo: '',
    entryDate: new Date().toISOString().slice(0, 10),
    expenseBranchName: branchId || 'HO',
    paidFromAccountId: '',
    paidFromAccountName: '',
    paymentMode: 'Cash',
    chequeDate: '',
    chequeNo: '',
    remarks: '',
    status: 'draft'
  };
}

function moneyValue(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? Math.round(parsed * 100) / 100 : 0;
}

function stringValue(value: unknown): string {
  return value === undefined || value === null ? '' : String(value);
}
