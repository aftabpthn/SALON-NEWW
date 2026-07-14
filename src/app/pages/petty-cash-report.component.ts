import { CommonModule } from '@angular/common';
import { Component, OnInit, computed, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { forkJoin } from 'rxjs';
import { ApiRecord, ApiService } from '../core/api.service';
import { StateComponent } from '../shared/ui/state/state.component';
import { AuraMoneyPipe } from '../shared/pipes/aura-money.pipe';
import { AuraDatePipe } from '../shared/pipes/aura-date.pipe';

type PettyCashRow = ApiRecord & {
  debit: number;
  credit: number;
  balance: number;
};

@Component({
  selector: 'app-petty-cash-report',
  standalone: true,
  imports: [AuraDatePipe, AuraMoneyPipe, CommonModule, FormsModule, RouterLink, StateComponent],
  template: `
    <section class="petty-report-page inner-page-shell">
      <header class="titlebar inner-page-header">
        <div>
          <span class="eyebrow">Finance Report</span>
          <h2>Petty Cash Report</h2>
        </div>
        <div class="title-actions inner-action-bar">
          <a class="ghost-button" routerLink="/transactions/petty-cash">New Entry</a>
          <button class="ghost-button" type="button" (click)="printPage()">Print</button>
          <button class="ghost-button" type="button" (click)="exportCsv()">Export</button>
          <a class="ghost-button" routerLink="/finance">Exit</a>
        </div>
      </header>

      <section class="summary-row inner-stats-grid">
        <article><span>Rows</span><strong>{{ rows().length }}</strong></article>
        <article><span>Total IN</span><strong>{{ totalDebit() | auraMoney:'1.0-0' }}</strong></article>
        <article><span>Total OUT</span><strong>{{ totalCredit() | auraMoney:'1.0-0' }}</strong></article>
        <article><span>Balance</span><strong>{{ closingBalance() | auraMoney:'1.0-0' }}</strong></article>
      </section>

      <section class="report-panel inner-page-card">
        <div class="filters">
          <label><span>From</span><input type="date" [ngModel]="dateFrom()" (ngModelChange)="dateFrom.set($event)" /></label>
          <label><span>To</span><input type="date" [ngModel]="dateTo()" (ngModelChange)="dateTo.set($event)" /></label>
          <label>
            <span>Branch</span>
            <select [ngModel]="branchId()" (ngModelChange)="branchId.set($event)">
              <option value="">Current branch</option>
              <option *ngFor="let branch of branches()" [value]="branch.id">{{ branch.name }}</option>
            </select>
          </label>
          <label>
            <span>Type</span>
            <select [ngModel]="typeFilter()" (ngModelChange)="typeFilter.set($event)">
              <option value="">All</option>
              <option value="IN">IN</option>
              <option value="OUT">OUT</option>
            </select>
          </label>
          <label>
            <span>Category</span>
            <select [ngModel]="categoryFilter()" (ngModelChange)="categoryFilter.set($event)">
              <option value="">All</option>
              <option value="opening_balance">Opening Balance</option>
              <option value="bank_withdrawal">Bank Withdrawal</option>
              <option value="owner_cash">Owner Cash</option>
              <option value="repair">Repair</option>
              <option value="tea">Tea</option>
              <option value="cleaning">Cleaning</option>
              <option value="laundry">Laundry</option>
              <option value="transport">Transport</option>
              <option value="other_expense">Other Expense</option>
            </select>
          </label>
          <label class="search"><span>Search</span><input [ngModel]="query()" (ngModelChange)="query.set($event)" placeholder="Particular, doc no, remarks" /></label>
          <button class="ghost-button" type="button" (click)="load()">Refresh</button>
        </div>

        <app-state [loading]="loading()" [error]="error()"></app-state>

        <div class="table-shell" *ngIf="!loading() && !error()">
          <table>
            <thead>
              <tr>
                <th>Branch</th>
                <th>Doc Date</th>
                <th>Type</th>
                <th>Prefix</th>
                <th>Doc No</th>
                <th>Particular</th>
                <th>Category</th>
                <th class="right">Debit</th>
                <th class="right">Credit</th>
                <th class="right">Balance</th>
                <th>Paymode</th>
                <th>Chq No</th>
                <th>Staff</th>
                <th>Approval</th>
                <th>Ledger</th>
                <th>Remarks</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              <tr *ngFor="let row of rows()">
                <td>{{ row.branchName || row.branchId }}</td>
                <td>{{ row.docDate | auraDate:'date' }}</td>
                <td>{{ row.type }}</td>
                <td>{{ row.prefix }}</td>
                <td>{{ row.docNo }}</td>
                <td>{{ row.particular }}</td>
                <td>{{ categoryLabel(row.category) }}</td>
                <td class="right">{{ row.debit | auraMoney:'1.0-0' }}</td>
                <td class="right">{{ row.credit | auraMoney:'1.0-0' }}</td>
                <td class="right">{{ row.balance | auraMoney:'1.0-0' }}</td>
                <td>{{ row.paymode || '-' }}</td>
                <td>{{ row.chequeNo || '-' }}</td>
                <td>{{ row.staffName || '-' }}</td>
                <td>{{ row.approvalStatus || '-' }}</td>
                <td>{{ row.ledgerStatus || '-' }}</td>
                <td>{{ row.remarks || '-' }}</td>
                <td><a class="mini-button" [routerLink]="['/transactions/petty-cash']" [queryParams]="{ edit: row.id }">Edit</a></td>
              </tr>
              <tr *ngIf="!rows().length">
                <td colspan="17" class="empty">Petty cash entry nahi mili.</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </section>
  `,
  styles: [`
    :host { display: block; }
    .petty-report-page { display: grid; gap: 14px; padding: 18px; background: #eef8f5; color: #0f172a; }
    .titlebar, .report-panel, .summary-row article { border: 1px solid #9eb2b7; background: #d8ebe7; box-shadow: inset 0 0 0 1px rgba(255,255,255,.6); }
    .titlebar { display: flex; justify-content: space-between; align-items: center; padding: 10px 12px; background: #5b9998; color: #fff; }
    .titlebar h2 { margin: 0; letter-spacing: 0; }
    .title-actions { display: flex; gap: 8px; flex-wrap: wrap; }
    .eyebrow { display: block; color: inherit; opacity: .78; font-size: 11px; font-weight: 900; text-transform: uppercase; }
    .ghost-button, .mini-button { border: 1px solid #8da1a7; background: #fff; color: #0f172a; border-radius: 2px; padding: 8px 13px; font-weight: 900; cursor: pointer; text-decoration: none; }
    .mini-button { display: inline-flex; padding: 5px 9px; }
    .summary-row { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; }
    .summary-row article { padding: 14px; background: #fff; }
    .summary-row span { display: block; color: #526477; font-size: 12px; font-weight: 900; text-transform: uppercase; }
    .summary-row strong { display: block; margin-top: 5px; font-size: 24px; }
    .report-panel { display: grid; gap: 12px; padding: 12px; }
    .filters { display: grid; grid-template-columns: repeat(4, minmax(130px, 180px)) minmax(220px, 1fr) auto; gap: 10px; align-items: end; }
    label { display: grid; gap: 5px; font-weight: 900; }
    label span { color: #475569; font-size: 13px; }
    input, select { min-height: 36px; border: 1px solid #8da1a7; background: #fff; padding: 6px 8px; font: inherit; }
    .table-shell { overflow: auto; background: #fff; border: 1px solid #9eb2b7; }
    table { width: 100%; min-width: 1580px; border-collapse: collapse; font-size: 13px; }
    th, td { border: 1px solid #c7d6d8; padding: 8px; text-align: left; }
    th { background: #edf3f2; font-weight: 950; }
    .right { text-align: right; font-variant-numeric: tabular-nums; }
    .empty { padding: 26px; color: #64748b; text-align: center; }
    @media (max-width: 1000px) {
      .titlebar { align-items: stretch; flex-direction: column; }
      .summary-row, .filters { grid-template-columns: 1fr; }
    }
    @media print {
      .title-actions, .filters, .mini-button { display: none !important; }
      .petty-report-page { padding: 0; background: #fff; }
    }
  `]
})
export class PettyCashReportComponent implements OnInit {
  readonly loading = signal(false);
  readonly error = signal('');
  readonly entries = signal<ApiRecord[]>([]);
  readonly branches = signal<ApiRecord[]>([]);
  readonly dateFrom = signal('');
  readonly dateTo = signal('');
  readonly branchId = signal('');
  readonly typeFilter = signal('');
  readonly categoryFilter = signal('');
  readonly query = signal('');

  readonly rows = computed<PettyCashRow[]>(() => {
    const search = this.query().trim().toLowerCase();
    const from = this.dateFrom();
    const to = this.dateTo();
    const branchId = this.branchId();
    const type = this.typeFilter();
    const category = this.categoryFilter();
    let balance = 0;
    return this.entries()
      .filter((entry) => {
        if (from && entry.docDate < from) return false;
        if (to && entry.docDate > to) return false;
        if (branchId && entry.branchId !== branchId) return false;
        if (type && entry.type !== type) return false;
        if (category && entry.category !== category) return false;
        if (!search) return true;
        const text = `${entry.docNo || ''} ${entry.prefix || ''} ${entry.billNumber || ''} ${entry.particular || ''} ${entry.paymode || ''} ${entry.chequeNo || ''} ${entry.remarks || ''}`.toLowerCase();
        return text.includes(search);
      })
      .sort((a, b) => `${a.docDate || ''}${a.createdAt || ''}`.localeCompare(`${b.docDate || ''}${b.createdAt || ''}`))
      .map((entry) => {
        const debit = Number(entry.debit || 0);
        const credit = Number(entry.credit || 0);
        balance = Math.round((balance + debit - credit) * 100) / 100;
        return { ...entry, debit, credit, balance } as PettyCashRow;
      });
  });

  readonly totalDebit = computed(() => this.sum('debit'));
  readonly totalCredit = computed(() => this.sum('credit'));
  readonly closingBalance = computed(() => {
    const rows = this.rows();
    return rows.length ? rows[rows.length - 1].balance : 0;
  });

  constructor(private readonly api: ApiService) {}

  ngOnInit(): void {
    this.branchId.set(this.api.selectedBranchId());
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.error.set('');
    forkJoin({
      branches: this.api.list<ApiRecord[]>('branches'),
      entries: this.api.list<ApiRecord[]>('transactions/petty-cash', { branchId: this.branchId() || this.api.selectedBranchId(), limit: 5000 })
    }).subscribe({
      next: ({ branches, entries }) => {
        this.branches.set(branches || []);
        this.entries.set(entries || []);
        this.loading.set(false);
      },
      error: (error) => {
        this.error.set(this.api.errorText(error, 'Unable to load petty cash report'));
        this.loading.set(false);
      }
    });
  }

  printPage(): void {
    window.print();
  }

  exportCsv(): void {
    const headers = ['Branch', 'Doc Date', 'Type', 'Prefix', 'Doc No', 'Particular', 'Category', 'Debit', 'Credit', 'Balance', 'Paymode', 'Chq No', 'Staff', 'Approval', 'Ledger', 'Remarks'];
    const lines = this.rows().map((row) => [
      row.branchName || row.branchId,
      row.docDate,
      row.type,
      row.prefix,
      row.docNo,
      row.particular,
      this.categoryLabel(row.category),
      row.debit,
      row.credit,
      row.balance,
      row.paymode || '',
      row.chequeNo || '',
      row.staffName || '',
      row.approvalStatus || '',
      row.ledgerStatus || '',
      row.remarks || ''
    ].map(csvCell).join(','));
    const blob = new Blob([[headers.join(','), ...lines].join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `petty-cash-report-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  private sum(key: 'debit' | 'credit'): number {
    return Math.round(this.rows().reduce((total, row) => total + Number(row[key] || 0), 0) * 100) / 100;
  }

  categoryLabel(value: unknown): string {
    const labels: Record<string, string> = {
      opening_balance: 'Opening Balance',
      bank_withdrawal: 'Bank Withdrawal',
      owner_cash: 'Owner Cash',
      repair: 'Repair',
      tea: 'Tea',
      cleaning: 'Cleaning',
      laundry: 'Laundry',
      transport: 'Transport',
      other_expense: 'Other Expense'
    };
    return labels[String(value || '')] || String(value || '-');
  }
}

function csvCell(value: unknown): string {
  const text = String(value ?? '');
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}
