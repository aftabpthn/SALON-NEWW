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
  categoryLabel?: string;
  categoryBucket?: string;
  balanceSheetImpact?: string;
  operating?: boolean;
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
  paidToAccountId?: string;
  paidToAccountName?: string;
  payeeName?: string;
  amount: number;
  gstAmount?: number;
  netAmount?: number;
  paymentMode: string;
  chequeDate?: string;
  chequeNo?: string;
  transactionType?: string;
  salaryMonthYear?: string;
  lineItems?: OutgoingLineItem[];
  billUrl?: string;
  impactType?: string;
  linkedPartyType?: string;
  linkedPartyId?: string;
  linkedPartyName?: string;
  approvalStatus?: 'pending' | 'approved' | 'rejected' | 'not_required';
  approvedBy?: string;
  approvedAt?: string;
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
        <article><span>Total outgoing</span><strong>{{ money(totalOutgoing()) }}</strong></article>
        <article><span>Draft entries</span><strong>{{ draftCount() }}</strong></article>
        <article><span>Posted entries</span><strong>{{ postedCount() }}</strong></article>
        <article><span>Balance Sheet link</span><strong>{{ linkedCount() }}/{{ postableCount() }}</strong></article>
        <article><span>Salon categories</span><strong>{{ categoryCount() }}</strong></article>
        <article><span>Operating outgoing</span><strong>{{ money(operatingOutgoing()) }}</strong></article>
        <article><span>Balance Sheet only</span><strong>{{ money(balanceSheetOnlyOutgoing()) }}</strong></article>
        <article><span>Review rows</span><strong>{{ reviewLineCount() }}</strong></article>
      </section>

      <div class="outgoing-layout" *ngIf="!loading() && !error()">
        <section class="register-bar">
          <header class="register-header">
            <div>
              <span class="eyebrow">Register</span>
              <h3>Saved vouchers</h3>
            </div>
            <button class="ghost-button mini" type="button" (click)="startNew()">Add</button>
          </header>
          <div class="register-body">
            <label class="search-row">
              <span>Search</span>
              <input [ngModel]="query()" (ngModelChange)="query.set($event)" placeholder="OG no, cash/bank, type, remarks" />
            </label>
            <div class="entry-strip">
              <button
                type="button"
                class="saved-entry"
                *ngFor="let entry of filteredEntries()"
                [class.selected]="selected()?.id === entry.id"
                (click)="selectEntry(entry)"
              >
                <span>
                  <strong>{{ entry.entryNo || '-' }}</strong>
                  <small>{{ entry.entryDate }} · {{ entryCategoryLabel(entry) }}</small>
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
          </div>
        </section>

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

            <div class="connection-grid">
              <label><span>GST Amount :</span><input type="number" min="0" step="0.01" formControlName="gstAmount" /></label>
              <label><span>Bill / Invoice :</span><input formControlName="billUrl" placeholder="Upload URL / file path" /></label>
              <label><span>BS Impact :</span>
                <select formControlName="impactType">
                  <option *ngFor="let option of impactTypes" [value]="option.value">{{ option.label }}</option>
                </select>
              </label>
              <label><span>Link Type :</span>
                <select formControlName="linkedPartyType">
                  <option *ngFor="let option of partyTypes" [value]="option.value">{{ option.label }}</option>
                </select>
              </label>
              <label><span>Linked ID :</span><input formControlName="linkedPartyId" placeholder="staff/vendor/customer id" /></label>
              <label><span>Linked Name :</span><input formControlName="linkedPartyName" placeholder="staff/vendor/customer name" /></label>
              <label><span>Approval :</span>
                <select formControlName="approvalStatus">
                  <option *ngFor="let option of approvalStatuses" [value]="option.value">{{ option.label }}</option>
                </select>
              </label>
            </div>

            <div class="line-grid">
              <div class="line-head">
                <span>Sno</span>
                <span>Date</span>
                <span>Type</span>
                <span>Account / Particular</span>
                <span>Amount</span>
                <span>Salon Category</span>
                <span>BS Impact</span>
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
                <span class="category-cell">{{ lineCategoryLabel(item) }}</span>
                <span class="impact-cell">{{ lineImpact(item) }}</span>
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
                <label *ngIf="isSalaryType(lineDialog().type)"><span>Salary Month :</span><input type="month" [ngModel]="lineDialog().salaryMonthYear" [ngModelOptions]="{ standalone: true }" (ngModelChange)="patchLineDialog({ salaryMonthYear: $event })" /></label>
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
                <small>GST {{ money(entryGstAmount()) }} · Net {{ money(entryNetAmount()) }}</small>
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
    .outgoing-page { display: grid; gap: 18px; color: var(--ink); max-width: 1320px; margin: 0 auto; width: 100%; padding: 0 6px; }
    .module-hero, .voucher-window, .metric-grid article {
      background: var(--surface);
      border: 1px solid var(--line);
      border-radius: 10px;
    }
    .module-hero { display: flex; align-items: center; justify-content: space-between; gap: 18px; padding: 20px 22px; }
    .module-hero h2 { margin: 4px 0 6px; font-size: 28px; letter-spacing: -.02em; }
    .module-hero p { margin: 0; color: var(--muted); max-width: 800px; line-height: 1.45; font-size: 14px; }
    .hero-actions, .bottom-toolbar { display: flex; gap: 8px; flex-wrap: wrap; justify-content: flex-end; }
    .eyebrow { text-transform: uppercase; font-size: 11px; font-weight: 900; color: var(--muted); letter-spacing: .06em; }
    .metric-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; }
    .metric-grid article { padding: 14px; border-top: 4px solid var(--color-primary); transition: border-color .15s; }
    .metric-grid article:hover { border-color: var(--color-primary-strong); }
    .metric-grid span, .metric-grid small { display: block; color: var(--muted); font-weight: 700; font-size: 12px; }
    .metric-grid strong { display: block; margin: 6px 0 4px; font-size: 24px; line-height: 1; color: var(--color-primary); }
    .outgoing-layout { display: grid; grid-template-columns: 280px minmax(0, 1fr); gap: 14px; align-items: start; }
    .register-bar { background: var(--surface); border: 1px solid var(--line); border-radius: 10px; overflow: hidden; }
    .register-header { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 12px 14px; border-bottom: 1px solid var(--line); }
    .register-header h3 { margin: 2px 0 0; font-size: 16px; }
    .register-body { padding: 10px 14px 12px; display: grid; gap: 8px; }
    .register-body .search-row { display: flex; align-items: center; gap: 8px; font-weight: 700; color: var(--muted); font-size: 12px; }
    .register-body .search-row span { flex-shrink: 0; }
    .register-body .search-row input { flex: 1; max-width: 100%; padding: 7px 8px; font-size: 13px; }
    .search-row input, .voucher-head input, .voucher-head select, .connection-grid input, .connection-grid select, .line-row input, .line-row select, .remarks-footer textarea {
      border: 1px solid var(--line);
      border-radius: 6px;
      padding: 7px 9px;
      font: inherit;
      font-size: 13px;
      background: var(--surface);
      color: var(--ink);
      transition: border-color .15s;
    }
    .search-row input:focus, .voucher-head input:focus, .voucher-head select:focus, .connection-grid input:focus, .connection-grid select:focus, .line-row input:focus, .line-row select:focus, .remarks-footer textarea:focus {
      outline: none;
      border-color: var(--color-primary);
      box-shadow: var(--ring-brand);
    }
    .picker-field { display: grid; grid-template-columns: 1fr 30px; gap: 3px; }
    .picker-field button {
      border: 1px solid var(--line);
      border-radius: 6px;
      background: var(--surface);
      color: var(--ink);
      font-weight: 900;
      cursor: pointer;
      padding: 4px;
    }
    .entry-strip { display: grid; gap: 6px; max-height: 460px; overflow-y: auto; padding: 2px 0; }
    .saved-entry { border: 1px solid var(--line); border-radius: 8px; background: var(--surface); color: var(--ink); text-align: left; padding: 8px 10px; cursor: pointer; transition: all .15s; display: grid; gap: 3px; }
    .saved-entry:hover { border-color: var(--color-primary); }
    .saved-entry.selected { border-color: var(--color-primary); background: var(--color-primary-soft); box-shadow: inset 0 0 0 1px var(--color-primary); }
    .saved-entry strong { display: block; font-size: 13px; }
    .saved-entry small { display: block; color: var(--muted); font-size: 11px; margin-top: 1px; }
    .saved-entry span:last-child { text-align: right; }
    .voucher-window { overflow: hidden; border-color: var(--color-primary-ring); }
    .window-titlebar { display: flex; align-items: center; justify-content: center; gap: 14px; background: var(--color-primary); color: var(--surface); padding: 8px 14px; text-align: center; }
    .window-titlebar h3 { margin: 0; font-size: 18px; letter-spacing: 0; }
    .window-titlebar strong { font-size: 16px; font-weight: 700; opacity: .9; }
    .voucher-form { display: grid; gap: 8px; padding: 10px 12px; }
    .voucher-head { display: grid; grid-template-columns: 160px 140px 180px 1fr 170px 170px; gap: 8px; align-items: end; }
    .connection-grid { display: grid; grid-template-columns: 130px 1fr 140px 140px 160px 200px 130px; gap: 8px; align-items: end; border: 1px solid var(--line); background: var(--color-primary-soft); padding: 8px 10px; border-radius: 6px; }
    .voucher-head label, .connection-grid label, .remarks-footer label { display: grid; gap: 4px; color: var(--ink); font-weight: 700; }
    .voucher-head span, .connection-grid span, .remarks-footer span { font-size: 12px; color: var(--muted); }
    .line-grid { border: 1px solid var(--line); background: var(--surface); min-height: 320px; overflow: auto; border-radius: 6px; }
    .line-head, .line-row { display: grid; grid-template-columns: 40px 100px 160px minmax(200px, 1fr) 110px 160px 200px 140px minmax(150px, 0.7fr) 40px; align-items: stretch; }
    .line-head { position: sticky; top: 0; z-index: 1; background: var(--surface-2); color: var(--ink); font-size: 11px; font-weight: 800; }
    .line-head span, .line-row > span, .line-row input, .line-row select { border-right: 1px solid var(--line); border-bottom: 1px solid var(--line); border-radius: 0; }
    .line-head span, .line-row > span { padding: 6px; }
    .category-cell { font-weight: 900; color: var(--color-primary); background: var(--color-primary-soft); font-size: 12px; }
    .impact-cell { color: var(--muted); font-size: 11px; line-height: 1.2; }
    .sno { display: grid; place-items: center; font-weight: 900; color: var(--muted); font-size: 12px; }
    .category-strip { display: flex; flex-wrap: wrap; gap: 5px; align-items: center; }
    .category-strip button, .tool-button, .ghost-button, .primary-button, .icon-button {
      border: 1px solid var(--line);
      border-radius: 6px;
      background: var(--surface);
      color: var(--ink);
      padding: 7px 10px;
      font-weight: 700;
      font-size: 13px;
      cursor: pointer;
      text-decoration: none;
      transition: all .15s;
    }
    .category-strip button:hover, .tool-button:hover, .ghost-button:hover { border-color: var(--color-primary); color: var(--color-primary); }
    .category-strip button.active { background: var(--color-primary); border-color: var(--color-primary); color: var(--surface); }
    .category-strip .utility { margin-left: 4px; }
    .category-strip .danger, .danger-tool, .icon-button.danger { color: var(--red); }
    .icon-button.danger:hover, .danger-tool:hover { background: #fef2f2; border-color: var(--red); color: var(--red); }
    .dialog-backdrop { position: fixed; inset: 0; z-index: 20; display: grid; place-items: center; background: rgba(15, 23, 42, .2); }
    .entry-dialog { width: min(430px, calc(100vw - 28px)); border: 0; background: var(--surface); border-radius: 12px; box-shadow: 0 20px 48px rgba(15, 23, 42, .25); overflow: hidden; }
    .dialog-title { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 10px 16px; background: var(--color-primary); color: var(--surface); }
    .dialog-title h3 { margin: 0; font-size: 18px; letter-spacing: 0; }
    .dialog-title button { border: 1px solid rgba(255,255,255,.3); border-radius: 6px; background: transparent; color: var(--surface); font-weight: 700; padding: 6px 12px; cursor: pointer; }
    .dialog-title button:hover { background: rgba(255,255,255,.1); }
    .entry-dialog label { display: grid; grid-template-columns: 90px 1fr; gap: 10px; align-items: center; padding: 12px 16px 0; color: var(--ink); font-weight: 700; }
    .entry-dialog input, .entry-dialog select, .entry-dialog textarea { width: 100%; border: 1px solid var(--line); border-radius: 6px; padding: 8px 10px; font: inherit; background: var(--surface); color: var(--ink); }
    .entry-dialog textarea { resize: vertical; }
    .entry-dialog input:focus, .entry-dialog select:focus, .entry-dialog textarea:focus { outline: none; border-color: var(--color-primary); box-shadow: var(--ring-brand); }
    .dialog-ok { display: block; min-width: 72px; margin: 14px auto 16px; border: 0; border-radius: 8px; background: var(--color-primary); color: var(--surface); padding: 10px 20px; font-weight: 700; cursor: pointer; transition: background .15s; }
    .dialog-ok:hover { background: var(--color-primary-strong); }
    .remarks-footer { display: grid; grid-template-columns: minmax(240px, 1fr) 200px; gap: 12px; align-items: end; justify-content: end; }
    .voucher-total { display: grid; gap: 3px; justify-items: end; color: var(--muted); font-weight: 700; }
    .voucher-total strong { font-size: 24px; color: var(--color-primary); }
    .voucher-total small { font-size: 12px; }
    .bottom-toolbar { border-top: 1px solid var(--line); padding-top: 8px; }
    .primary-button, .primary-tool { background: var(--color-primary); color: var(--surface); border-color: var(--color-primary); }
    .primary-button:hover, .primary-tool:hover { background: var(--color-primary-strong); border-color: var(--color-primary-strong); color: var(--surface); }
    button:disabled { opacity: .5; cursor: not-allowed; }
    .ghost-button.mini { padding: 6px 8px; font-size: 12px; }
    .empty-state { padding: 24px 14px; display: grid; gap: 6px; text-align: center; color: var(--muted); font-size: 13px; }
    .empty-state strong { color: var(--ink); }
    @media (max-width: 1200px) {
      .outgoing-layout { grid-template-columns: 1fr; }
      .register-body .search-row input { max-width: 100%; }
      .voucher-head { grid-template-columns: repeat(3, 1fr); }
      .connection-grid { grid-template-columns: repeat(3, 1fr); }
    }
    @media (max-width: 820px) {
      .module-hero { align-items: stretch; flex-direction: column; padding: 16px; }
      .module-hero h2 { font-size: 22px; }
      .metric-grid { grid-template-columns: repeat(2, 1fr); }
      .voucher-head, .connection-grid, .remarks-footer { grid-template-columns: 1fr; }
      .line-head, .line-row { grid-template-columns: 36px 95px 150px 180px 100px 150px 180px 130px 150px 36px; min-width: 1200px; }
      .bottom-toolbar { justify-content: stretch; }
      .tool-button { flex: 1 1 100px; }
    }
    @media (max-width: 500px) {
      .metric-grid { grid-template-columns: 1fr; }
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

  readonly transactionTypes = [
    'Daily Exp.',
    'Rent',
    'Utilities',
    'Marketing Ads',
    'Software / SMS',
    'Repair / Maintenance',
    'Cleaning / Laundry',
    'Bank / Payment Charges',
    'Legal / License',
    'Product Purchase',
    'Product Consumable',
    'Wastage / Damage',
    'Fixed Asset Purchase',
    'Staff Salary',
    'Staff Commission',
    'Client Refreshment',
    'Uniform / Grooming',
    'Stationery / Printing',
    'Training / Education',
    'Travel / Conveyance',
    'Security Deposit',
    'Prepaid Expense',
    'GST Payment',
    'Statutory Payment',
    'Interest / Finance Cost',
    'Petty Cash Transfer',
    'Owner Drawing',
    'Bank Depo.',
    'Purch. Pymt',
    'Misc. Pymt',
    'Other Out.',
    'Salary',
    'Advance',
    'Loan',
    'Daily Inc.'
  ];
  readonly paymentModes = ['Cash', 'Bank Transfer', 'UPI', 'Card', 'Cheque', 'NEFT', 'RTGS', 'IMPS', 'Wallet', 'Other'];
  readonly impactTypes = [
    { value: '', label: 'Auto' },
    { value: 'expense', label: 'Expense' },
    { value: 'inventory', label: 'Inventory' },
    { value: 'fixed_asset', label: 'Fixed Asset' },
    { value: 'tax', label: 'Tax / GST' },
    { value: 'advance', label: 'Advance / Prepaid' },
    { value: 'loan', label: 'Loan' },
    { value: 'owner', label: 'Owner Drawing' },
    { value: 'transfer', label: 'Cash / Bank Transfer' },
    { value: 'other', label: 'Other' }
  ];
  readonly partyTypes = [
    { value: 'none', label: 'None' },
    { value: 'vendor', label: 'Vendor' },
    { value: 'staff', label: 'Staff' },
    { value: 'customer', label: 'Customer' },
    { value: 'asset', label: 'Asset' },
    { value: 'loan', label: 'Loan' },
    { value: 'owner', label: 'Owner' },
    { value: 'other', label: 'Other' }
  ];
  readonly approvalStatuses = [
    { value: 'pending', label: 'Pending' },
    { value: 'approved', label: 'Approved' },
    { value: 'rejected', label: 'Rejected' },
    { value: 'not_required', label: 'Not required' }
  ];

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
  readonly visibleLines = computed(() => this.entries().filter((entry) => entry.status !== 'deleted').flatMap((entry) => entryLines(entry)));
  readonly categoryCount = computed(() => new Set(this.visibleLines().map((line) => lineCategory(line).key)).size);
  readonly operatingOutgoing = computed(() => this.visibleLines().filter((line) => lineCategory(line).operating).reduce((sum, line) => sum + moneyValue(line.amount), 0));
  readonly balanceSheetOnlyOutgoing = computed(() => this.visibleLines().filter((line) => !lineCategory(line).operating).reduce((sum, line) => sum + moneyValue(line.amount), 0));
  readonly reviewLineCount = computed(() => this.visibleLines().filter((line) => lineCategory(line).key === 'other').length);

  readonly entryForm = this.fb.group({
    entryNo: [''],
    entryDate: [new Date().toISOString().slice(0, 10), Validators.required],
    expenseBranchName: [this.api.selectedBranchId() || 'HO'],
    paidFromAccountId: ['', Validators.required],
    paidFromAccountName: [''],
    paymentMode: ['Cash', Validators.required],
    chequeDate: [''],
    chequeNo: [''],
    gstAmount: [0],
    billUrl: [''],
    impactType: [''],
    linkedPartyType: ['none'],
    linkedPartyId: [''],
    linkedPartyName: [''],
    approvalStatus: ['pending'],
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
    const formValue = this.entryForm.getRawValue();
    const payload = {
      ...formValue,
      branchId: this.api.selectedBranchId(),
      expenseBranchId: this.api.selectedBranchId(),
      transactionType: firstLine.type || this.activeType(),
      salaryMonthYear: firstLine.salaryMonthYear,
      paidToAccountId: firstLine.accountId,
      paidToAccountName: firstLine.accountName,
      payeeName: firstLine.accountName,
      amount: this.lineTotal(),
      gstAmount: Math.min(this.lineTotal(), Math.max(0, moneyValue(formValue.gstAmount))),
      lineItems: this.renumber(lineItems).map((line) => ({ ...line, ...lineCategoryPayload(line) }))
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
      Rent: 'Rent / Lease',
      Utilities: 'Electricity / Water / Internet',
      'Marketing Ads': 'Marketing / Ads',
      'Software / SMS': 'Software / SMS / WhatsApp',
      'Repair / Maintenance': 'Repair / Maintenance',
      'Cleaning / Laundry': 'Cleaning / Laundry',
      'Bank / Payment Charges': 'Bank / Payment Charges',
      'Legal / License': 'Professional / Legal / License',
      'Product Purchase': 'Inventory Product Purchase',
      'Product Consumable': 'Product Consumable Expense',
      'Wastage / Damage': 'Wastage / Expiry / Damage',
      'Fixed Asset Purchase': 'Fixed Asset Purchase',
      'Staff Salary': 'Staff Salary',
      'Staff Commission': 'Staff Commission',
      'Client Refreshment': 'Client Refreshment',
      'Uniform / Grooming': 'Uniform / Grooming',
      'Stationery / Printing': 'Stationery / Printing',
      'Training / Education': 'Training / Education',
      'Travel / Conveyance': 'Travel / Conveyance',
      'Security Deposit': 'Security Deposit',
      'Prepaid Expense': 'Prepaid Expense',
      'GST Payment': 'GST / Tax Payment',
      'Statutory Payment': 'PF / ESI / PT / TDS Payment',
      'Interest / Finance Cost': 'Interest / Finance Cost',
      'Petty Cash Transfer': 'Petty Cash Transfer',
      'Owner Drawing': 'Owner Drawing',
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

  isSalaryType(type: string): boolean {
    return ['Salary', 'Staff Salary'].includes(type);
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

  entryGstAmount(): number {
    return Math.min(this.lineTotal(), Math.max(0, moneyValue(this.entryForm.value.gstAmount)));
  }

  entryNetAmount(): number {
    return Math.max(0, this.lineTotal() - this.entryGstAmount());
  }

  lineCategoryLabel(line: Partial<OutgoingLineItem>): string {
    return stringValue(line.categoryLabel) || lineCategory(line).label;
  }

  lineImpact(line: Partial<OutgoingLineItem>): string {
    return stringValue(line.balanceSheetImpact) || lineCategory(line).impact;
  }

  entryCategoryLabel(entry: OutgoingFundEntry): string {
    const line = entryLines(entry)[0];
    return line ? this.lineCategoryLabel(line) : entry.transactionType || 'Outgoing';
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

function entryLines(entry: OutgoingFundEntry): OutgoingLineItem[] {
  return Array.isArray(entry.lineItems) && entry.lineItems.length ? entry.lineItems : [legacyLine(entry)];
}

function lineCategory(line: Partial<OutgoingLineItem>): { key: string; label: string; bucket: string; impact: string; operating: boolean } {
  const text = `${line.type || ''} ${line.accountName || ''} ${line.remarks || ''}`.toLowerCase();
  const match = SALON_CATEGORY_RULES.find((rule) => rule.patterns.some((pattern) => text.includes(pattern))) || SALON_CATEGORY_RULES[SALON_CATEGORY_RULES.length - 1];
  return match;
}

function lineCategoryPayload(line: Partial<OutgoingLineItem>): ApiRecord {
  const category = lineCategory(line);
  return {
    category: category.key,
    categoryLabel: category.label,
    categoryBucket: category.bucket,
    balanceSheetImpact: category.impact,
    operating: category.operating
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
    gstAmount: 0,
    billUrl: '',
    impactType: '',
    linkedPartyType: 'none',
    linkedPartyId: '',
    linkedPartyName: '',
    approvalStatus: 'pending',
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

const SALON_CATEGORY_RULES = [
  { key: 'salary', label: 'Staff Salary', bucket: 'staff', impact: 'Expense reduces profit/equity', operating: true, patterns: ['staff salary', 'salary', 'payroll', 'wage', 'overtime'] },
  { key: 'staff_commission', label: 'Staff Commission / Incentive', bucket: 'staff', impact: 'Expense reduces profit/equity', operating: true, patterns: ['staff commission', 'commission', 'incentive'] },
  { key: 'advance', label: 'Staff / Client Advance', bucket: 'advance_asset', impact: 'Advance asset increases', operating: false, patterns: ['staff advance', 'client advance', 'advance'] },
  { key: 'rent', label: 'Rent / Lease', bucket: 'operations', impact: 'Expense reduces profit/equity', operating: true, patterns: ['rent', 'lease', 'kiraya'] },
  { key: 'utilities', label: 'Electricity / Water / Internet', bucket: 'operations', impact: 'Expense reduces profit/equity', operating: true, patterns: ['utility', 'electricity', 'water', 'internet', 'wifi', 'phone'] },
  { key: 'inventory_purchase', label: 'Product Purchase / Inventory', bucket: 'inventory', impact: 'Inventory asset or vendor payable', operating: false, patterns: ['product purchase', 'inventory purchase', 'stock purchase', 'purch. pymt', 'vendor payment'] },
  { key: 'product_consumable', label: 'Product Consumable / COGS', bucket: 'inventory', impact: 'COGS/product expense', operating: true, patterns: ['product consumable', 'consume', 'consumable', 'cogs'] },
  { key: 'wastage_damage', label: 'Wastage / Expiry / Damage', bucket: 'inventory', impact: 'Inventory loss impact', operating: true, patterns: ['wastage', 'waste', 'expiry', 'damage', 'shortage'] },
  { key: 'fixed_asset_purchase', label: 'Fixed Asset Purchase', bucket: 'fixed_asset', impact: 'Fixed asset increases', operating: false, patterns: ['fixed asset', 'chair', 'mirror', 'machine', 'dryer', 'steamer', 'printer', 'computer', 'cctv', 'interior', 'furniture', 'equipment'] },
  { key: 'repair_maintenance', label: 'Repair / Maintenance', bucket: 'operations', impact: 'Expense reduces profit/equity', operating: true, patterns: ['repair', 'maintenance', 'ac service', 'plumbing', 'amc'] },
  { key: 'cleaning_housekeeping', label: 'Cleaning / Laundry / Housekeeping', bucket: 'operations', impact: 'Expense reduces profit/equity', operating: true, patterns: ['cleaning', 'laundry', 'towel', 'housekeeping', 'sanitize', 'pest'] },
  { key: 'client_refreshment', label: 'Client Refreshment', bucket: 'operations', impact: 'Expense reduces profit/equity', operating: true, patterns: ['tea', 'coffee', 'refreshment', 'snack', 'water bottle'] },
  { key: 'uniform', label: 'Uniform / Grooming', bucket: 'operations', impact: 'Expense reduces profit/equity', operating: true, patterns: ['uniform', 'apron', 'staff dress', 'grooming'] },
  { key: 'stationery', label: 'Stationery / Printing', bucket: 'admin', impact: 'Expense reduces profit/equity', operating: true, patterns: ['stationery', 'printing', 'paper', 'bill book'] },
  { key: 'marketing', label: 'Marketing / Ads / Referral', bucket: 'sales_marketing', impact: 'Expense reduces profit/equity', operating: true, patterns: ['marketing', 'ads', 'instagram', 'facebook', 'google', 'campaign', 'lead', 'influencer', 'referral', 'banner', 'brochure', 'signage'] },
  { key: 'software_subscription', label: 'Software / SMS / WhatsApp', bucket: 'admin', impact: 'Expense reduces profit/equity', operating: true, patterns: ['software', 'subscription', 'sms', 'whatsapp', 'crm', 'pos', 'saas', 'domain', 'hosting'] },
  { key: 'bank_charges', label: 'Bank / Payment Gateway Charges', bucket: 'finance_cost', impact: 'Expense reduces profit/equity', operating: true, patterns: ['bank charges', 'payment charge', 'gateway', 'mdr', 'card charge', 'upi charge', 'fee'] },
  { key: 'professional_legal', label: 'CA / Legal / License', bucket: 'admin', impact: 'Expense reduces profit/equity', operating: true, patterns: ['legal', 'license', 'licence', 'professional', 'ca', 'audit', 'gst filing', 'compliance'] },
  { key: 'gst_payment', label: 'GST / Tax Payment', bucket: 'tax', impact: 'Tax payable/credit adjusts', operating: false, patterns: ['gst payment', 'gst paid', 'tax payment', 'gst challan', 'tax challan'] },
  { key: 'statutory_payment', label: 'PF / ESI / PT / TDS Payment', bucket: 'tax', impact: 'Statutory liability reduces', operating: false, patterns: ['pf', 'esi', 'tds', 'professional tax', 'statutory'] },
  { key: 'security_deposit', label: 'Security Deposit', bucket: 'deposit_asset', impact: 'Deposit asset increases', operating: false, patterns: ['security deposit', 'deposit', 'rent deposit'] },
  { key: 'prepaid_expense', label: 'Prepaid Expense', bucket: 'prepaid_asset', impact: 'Prepaid asset increases', operating: false, patterns: ['prepaid', 'advance rent', 'annual subscription', 'yearly subscription'] },
  { key: 'loan', label: 'Loan / EMI Principal', bucket: 'loan', impact: 'Loan liability reduces', operating: false, patterns: ['loan', 'emi', 'principal'] },
  { key: 'interest', label: 'Interest / Finance Cost', bucket: 'finance_cost', impact: 'Expense reduces profit/equity', operating: true, patterns: ['interest', 'finance cost'] },
  { key: 'owner_drawing', label: 'Owner Drawing', bucket: 'owner', impact: 'Owner equity/drawing adjusts', operating: false, patterns: ['owner drawing', 'drawing', 'withdrawal', 'personal'] },
  { key: 'bank_deposit', label: 'Bank Deposit / Cash Transfer', bucket: 'cash_transfer', impact: 'Cash/bank movement only', operating: false, patterns: ['bank depo', 'bank deposit', 'cash deposit', 'cash transfer', 'petty cash transfer'] },
  { key: 'travel', label: 'Travel / Conveyance', bucket: 'operations', impact: 'Expense reduces profit/equity', operating: true, patterns: ['travel', 'travelling', 'conveyance', 'cab', 'auto', 'fuel'] },
  { key: 'training', label: 'Training / Education', bucket: 'staff', impact: 'Expense reduces profit/equity', operating: true, patterns: ['training', 'course', 'education', 'academy'] },
  { key: 'other', label: 'Other Salon Outgoing', bucket: 'review', impact: 'Review required', operating: true, patterns: ['other out', 'misc', 'daily exp', 'expense'] }
];
