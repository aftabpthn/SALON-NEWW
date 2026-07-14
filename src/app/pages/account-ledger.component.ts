import { CommonModule } from '@angular/common';
import { Component, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ApiRecord, ApiService } from '../core/api.service';
import { StateComponent } from '../shared/ui/state/state.component';
import { AuraDatePipe } from '../shared/pipes/aura-date.pipe';

type LedgerAccount = ApiRecord & {
  id: string;
  accountName: string;
  groupName: string;
  openingBalance: number;
  openingBalanceType: string;
};

type LedgerEntry = {
  id: string;
  branch: string;
  docDate: string;
  type: string;
  prefix: string;
  docNo: string;
  sno: string;
  billNumber: string;
  billDate: string;
  particular: string;
  debit: number;
  credit: number;
  balance: number;
  paymode: string;
  chqNo: string;
  remarks: string;
};

type LedgerResponse = {
  dateRange: { from: string; to: string };
  accounts: LedgerAccount[];
  selectedAccount: LedgerAccount | null;
  openingBalance: { amount: number; type: string; signedAmount: number; display: string };
  entries: LedgerEntry[];
  totals: { debit: number; credit: number; balance: number };
};

@Component({
  selector: 'app-account-ledger',
  standalone: true,
  imports: [AuraDatePipe, CommonModule, FormsModule, RouterLink, StateComponent],
  template: `
    <section class="ledger-shell inner-page-shell">
      <div class="ledger-titlebar inner-page-header">
        <div>
          <h2>Account Ledger</h2>
        </div>
        <a class="close-link" routerLink="/reports" aria-label="Back to reports">×</a>
      </div>
      <div class="ledger-toolbar inner-action-bar">
        <label class="date-chip">
          <span>From</span>
          <input type="date" [ngModel]="fromDate()" (ngModelChange)="fromDate.set($event)" />
        </label>
        <label class="date-chip">
          <span>To</span>
          <input type="date" [ngModel]="toDate()" (ngModelChange)="toDate.set($event)" />
        </label>
        <label class="account-picker">
          <span>Account Name :</span>
          <select [ngModel]="selectedAccountId()" (ngModelChange)="selectAccount($event)">
            <option value="">Select account</option>
            <option *ngFor="let account of accounts()" [value]="account.id">{{ account.accountName }}</option>
          </select>
        </label>
        <button class="refresh-button" type="button" (click)="load()">Refresh</button>
      </div>

      <app-state [loading]="loading()" [error]="error()"></app-state>

      <ng-container *ngIf="ledger() as data">
        <section class="opening-strip">
          <div>
            <span>Opng. Balance :</span>
            <strong>{{ data.openingBalance.display }}</strong>
          </div>
          <div *ngIf="data.selectedAccount">
            <span>Group :</span>
            <strong>{{ data.selectedAccount.groupName || 'Ungrouped' }}</strong>
          </div>
          <button class="excel-button" type="button" (click)="exportCsv()">Excel</button>
        </section>

        <div class="ledger-table-wrap">
          <table class="ledger-table">
            <thead>
              <tr class="group-head">
                <th colspan="2"></th>
                <th colspan="5">Document</th>
                <th colspan="4">Account</th>
                <th colspan="3">Others</th>
              </tr>
              <tr>
                <th>Branch</th>
                <th>Doc Date</th>
                <th>Type</th>
                <th>Prefix</th>
                <th>Doc No</th>
                <th>Sno</th>
                <th>Bill Number</th>
                <th>Bill Date</th>
                <th>Particular</th>
                <th class="num">Debit</th>
                <th class="num">Credit</th>
                <th class="num">Balance</th>
                <th>Paymode</th>
                <th>Chq No</th>
                <th>Remarks</th>
              </tr>
            </thead>
            <tbody>
              <tr *ngFor="let row of data.entries">
                <td>{{ row.branch || 'HO' }}</td>
                <td>{{ row.docDate | auraDate:'date' }}</td>
                <td>{{ row.type }}</td>
                <td>{{ row.prefix }}</td>
                <td>{{ row.docNo }}</td>
                <td>{{ row.sno }}</td>
                <td>{{ row.billNumber }}</td>
                <td>{{ row.billDate ? (row.billDate | auraDate:'date') : '' }}</td>
                <td>{{ row.particular }}</td>
                <td class="num">{{ row.debit | number:'1.2-2' }}</td>
                <td class="num">{{ row.credit | number:'1.2-2' }}</td>
                <td class="num">{{ row.balance | number:'1.2-2' }}</td>
                <td>{{ row.paymode }}</td>
                <td>{{ row.chqNo }}</td>
                <td>{{ row.remarks }}</td>
              </tr>
              <tr *ngIf="!data.entries.length" class="empty-row">
                <td colspan="15">
                  <strong>No ledger transactions yet</strong>

                </td>
              </tr>
            </tbody>
            <tfoot>
              <tr>
                <td colspan="9" class="total-label">Total :</td>
                <td class="num total-value">{{ data.totals.debit | number:'1.2-2' }}</td>
                <td class="num total-value">{{ data.totals.credit | number:'1.2-2' }}</td>
                <td class="num total-value">{{ data.totals.balance | number:'1.2-2' }}</td>
                <td colspan="3"></td>
              </tr>
            </tfoot>
          </table>
        </div>
      </ng-container>
    </section>
  `,
  styles: [`
    .ledger-shell {
      min-height: calc(100vh - 172px);
      border: 1px solid #E7DDD6;
      background: #F8EEF4;
      box-shadow: 0 16px 40px rgba(15, 23, 42, 0.12);
    }
    .ledger-titlebar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 10px 14px;
      background: #4B1238;
      color: #fff;
    }
    .ledger-titlebar .eyebrow {
      display: block;
      color: rgba(255, 255, 255, 0.78);
      font-size: 0.72rem;
      font-weight: 800;
      letter-spacing: 0;
      text-transform: uppercase;
    }
    .ledger-titlebar h2 {
      margin: 0;
      font-size: 1.35rem;
    }
    .close-link {
      display: grid;
      width: 34px;
      height: 34px;
      place-items: center;
      border-radius: 999px;
      background: #fff;
      color: #dc2626;
      font-size: 1.9rem;
      font-weight: 900;
      line-height: 1;
      text-decoration: none;
    }
    .ledger-toolbar {
      display: flex;
      flex-wrap: wrap;
      align-items: end;
      gap: 14px;
      padding: 12px 14px 8px;
    }
    .date-chip,
    .account-picker {
      display: flex;
      align-items: center;
      gap: 8px;
      color: #0f172a;
      font-weight: 800;
    }
    .date-chip input,
    .account-picker select {
      height: 36px;
      border: 1px solid #E7DDD6;
      background: #fff;
      padding: 0 10px;
      font: inherit;
    }
    .account-picker select {
      min-width: 320px;
    }
    .refresh-button,
    .excel-button {
      border: 1px solid #64748b;
      background: #fff;
      color: #0f172a;
      padding: 9px 14px;
      font-weight: 900;
      cursor: pointer;
    }
    .refresh-button:hover,
    .excel-button:hover {
      background: #FAF8F6;
    }
    .opening-strip {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 20px;
      padding: 8px 14px 14px;
      color: #0f172a;
    }
    .opening-strip div {
      display: grid;
      gap: 5px;
      text-align: center;
    }
    .opening-strip span {
      font-weight: 800;
    }
    .opening-strip strong {
      font-size: 1.05rem;
    }
    .excel-button {
      margin-left: auto;
    }
    .ledger-table-wrap {
      overflow: auto;
      margin: 0 10px 10px;
      border: 1px solid #E7DDD6;
      background: #fff;
      max-height: calc(100vh - 340px);
    }
    .ledger-table {
      width: 100%;
      min-width: 1520px;
      border-collapse: collapse;
      font-size: 0.82rem;
      color: #0f172a;
    }
    .ledger-table th,
    .ledger-table td {
      border: 1px solid #E7DDD6;
      padding: 7px 6px;
      white-space: nowrap;
      vertical-align: top;
    }
    .ledger-table th {
      background: #FAF8F6;
      font-weight: 800;
      text-align: left;
    }
    .ledger-table .group-head th {
      text-align: center;
      background: #F8EEF4;
      color: #334155;
    }
    .num {
      text-align: right;
    }
    .empty-row td {
      padding: 24px 12px;
      text-align: center;
      color: #475569;
    }
    .empty-row strong,
    .empty-row span {
      display: block;
    }
    .empty-row span {
      margin-top: 8px;
    }
    tfoot td {
      background: #fff;
      font-weight: 900;
    }
    .total-label,
    .total-value {
      color: #ef4444;
    }
    @media (max-width: 900px) {
      .account-picker,
      .date-chip {
        width: 100%;
        align-items: stretch;
        flex-direction: column;
      }
      .account-picker select,
      .date-chip input {
        min-width: 0;
        width: 100%;
      }
      .opening-strip {
        align-items: stretch;
        flex-direction: column;
      }
      .excel-button {
        margin-left: 0;
      }
    }
  `]
})
export class AccountLedgerComponent implements OnInit {
  readonly accounts = signal<LedgerAccount[]>([]);
  readonly ledger = signal<LedgerResponse | null>(null);
  readonly loading = signal(true);
  readonly error = signal('');
  readonly selectedAccountId = signal('');
  readonly fromDate = signal(this.defaultFromDate());
  readonly toDate = signal(new Date().toISOString().slice(0, 10));

  constructor(private readonly api: ApiService) {}

  ngOnInit(): void {
    this.load();
  }

  selectAccount(accountId: string): void {
    this.selectedAccountId.set(accountId);
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.error.set('');
    this.api.list<LedgerResponse>('account-master/ledger', {
      accountId: this.selectedAccountId(),
      from: this.fromDate(),
      to: this.toDate(),
      branchId: this.api.selectedBranchId() || ''
    }).subscribe({
      next: (ledger) => {
        this.ledger.set(ledger);
        this.accounts.set(ledger.accounts || []);
        if (!this.selectedAccountId() && ledger.selectedAccount?.id) {
          this.selectedAccountId.set(ledger.selectedAccount.id);
        }
        this.loading.set(false);
      },
      error: (error) => {
        this.error.set(error?.error?.error || error?.message || 'Unable to load account ledger');
        this.loading.set(false);
      }
    });
  }

  exportCsv(): void {
    const data = this.ledger();
    if (!data) return;
    const headers = ['Branch', 'Doc Date', 'Type', 'Prefix', 'Doc No', 'Sno', 'Bill Number', 'Bill Date', 'Particular', 'Debit', 'Credit', 'Balance', 'Paymode', 'Chq No', 'Remarks'];
    const rows = data.entries.map((entry) => [
      entry.branch,
      entry.docDate,
      entry.type,
      entry.prefix,
      entry.docNo,
      entry.sno,
      entry.billNumber,
      entry.billDate,
      entry.particular,
      entry.debit,
      entry.credit,
      entry.balance,
      entry.paymode,
      entry.chqNo,
      entry.remarks
    ]);
    rows.push(['', '', '', '', '', '', '', '', 'Total', data.totals.debit, data.totals.credit, data.totals.balance, '', '', '']);
    const csv = [headers, ...rows].map((row) => row.map((cell) => `"${String(cell ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `account-ledger-${data.selectedAccount?.accountName || 'account'}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  private defaultFromDate(): string {
    const today = new Date();
    const year = today.getMonth() >= 3 ? today.getFullYear() : today.getFullYear() - 1;
    return `${year}-04-01`;
  }
}
