import { CommonModule } from '@angular/common';
import { Component, OnInit, computed, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ApiRecord, ApiService } from '../core/api.service';
import { StateComponent } from '../shared/ui/state/state.component';

type OutgoingLineItem = {
  sno: number;
  type: string;
  accountName: string;
  amount: number;
  salaryMonthYear?: string;
  remarks?: string;
};

type OutgoingFundEntry = ApiRecord & {
  id: string;
  entryNo: string;
  entryDate: string;
  createdAt?: string;
  updatedAt?: string;
  paidFromAccountName?: string;
  amount: number;
  transactionType?: string;
  lineItems?: OutgoingLineItem[];
  remarks?: string;
  status: string;
};

type ReportRow = {
  id: string;
  entryNo: string;
  entryDate: string;
  savedTime: string;
  type: string;
  accountName: string;
  amount: number;
  salaryMonthYear: string;
  remarks: string;
};

@Component({
  selector: 'app-outgoing-funds-report',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, StateComponent],
  template: `
    <section class="report-page">
      <header class="report-hero">
        <div>
          <span class="eyebrow">Transactions / Funds</span>
          <h2>Outgoing Funds Saved Entries</h2>
          <p>Save ke baad vouchers yahan date-wise aur row-wise dikhte hain.</p>
        </div>
        <div class="actions">
          <a class="button primary" routerLink="/transactions/outgoing-funds">New Entry</a>
          <button class="button" type="button" (click)="load()">Refresh</button>
        </div>
      </header>

      <div class="filters">
        <label><span>From</span><input type="date" [ngModel]="fromDate()" (ngModelChange)="fromDate.set($event)" /></label>
        <label><span>To</span><input type="date" [ngModel]="toDate()" (ngModelChange)="toDate.set($event)" /></label>
        <label><span>Search</span><input [ngModel]="query()" (ngModelChange)="query.set($event)" placeholder="OG no, name, type, remarks" /></label>
      </div>

      <app-state [loading]="loading()" [error]="error()"></app-state>

      <section class="summary" *ngIf="!loading() && !error()">
        <article><span>Saved rows</span><strong>{{ rows().length }}</strong></article>
        <article><span>Total amount</span><strong>{{ money(total()) }}</strong></article>
        <article><span>Vouchers</span><strong>{{ entries().length }}</strong></article>
      </section>

      <section class="panel" *ngIf="!loading() && !error()">
        <div class="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Saved Time</th>
                <th>OG No</th>
                <th>Type</th>
                <th>Name</th>
                <th class="r">Amount</th>
                <th>Salary Month</th>
                <th>Remarks</th>
              </tr>
            </thead>
            <tbody>
              <tr *ngFor="let row of filteredRows()">
                <td>{{ row.entryDate }}</td>
                <td>{{ row.savedTime || '-' }}</td>
                <td>{{ row.entryNo || '-' }}</td>
                <td>{{ row.type }}</td>
                <td>{{ row.accountName }}</td>
                <td class="r">{{ money(row.amount) }}</td>
                <td>{{ row.salaryMonthYear || '-' }}</td>
                <td>{{ row.remarks || '-' }}</td>
              </tr>
              <tr *ngIf="!filteredRows().length">
                <td colspan="8" class="empty">No saved outgoing entry found.</td>
              </tr>
            </tbody>
            <tfoot *ngIf="filteredRows().length">
              <tr>
                <td colspan="5">Grand Total</td>
                <td class="r">{{ money(filteredTotal()) }}</td>
                <td colspan="2"></td>
              </tr>
            </tfoot>
          </table>
        </div>
      </section>
    </section>
  `,
  styles: [`
    .report-page { display: grid; gap: 16px; color: #0f172a; }
    .report-hero, .filters, .panel, .summary article { background: #fff; border: 1px solid #d8e2e8; border-radius: 8px; box-shadow: 0 16px 34px rgba(15, 23, 42, .06); }
    .report-hero { display: flex; justify-content: space-between; gap: 16px; align-items: center; padding: 22px 24px; }
    .report-hero h2 { margin: 4px 0 8px; font-size: 32px; letter-spacing: 0; }
    .report-hero p { margin: 0; color: #53657d; }
    .eyebrow { text-transform: uppercase; font-size: 12px; font-weight: 900; color: #5b6f85; }
    .actions { display: flex; gap: 10px; flex-wrap: wrap; }
    .button { min-height: 40px; display: inline-flex; align-items: center; border: 1px solid #9fb2b8; border-radius: 4px; padding: 0 14px; background: #fff; color: #0f172a; font-weight: 900; text-decoration: none; cursor: pointer; }
    .button.primary { background: #0f8f79; border-color: #0f8f79; color: #fff; }
    .filters { display: grid; grid-template-columns: 180px 180px minmax(220px, 1fr); gap: 12px; padding: 14px; }
    label { display: grid; gap: 5px; color: #26364b; font-weight: 900; }
    label span { font-size: 13px; }
    input { min-height: 40px; border: 1px solid #9fb2b8; border-radius: 4px; padding: 0 10px; font: inherit; }
    .summary { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; }
    .summary article { padding: 16px; border-top: 4px solid #0f8f79; }
    .summary span { display: block; color: #53657d; font-weight: 800; }
    .summary strong { display: block; margin-top: 8px; font-size: 28px; }
    .panel { overflow: hidden; }
    .table-scroll { overflow: auto; }
    table { width: 100%; border-collapse: collapse; min-width: 940px; }
    th, td { padding: 10px 12px; border-bottom: 1px solid #d8e2e8; text-align: left; }
    th { background: #eef3f6; color: #26364b; font-size: 12px; text-transform: uppercase; }
    .r { text-align: right; font-variant-numeric: tabular-nums; }
    tfoot td { font-weight: 900; color: #0f8f79; }
    .empty { text-align: center; color: #53657d; padding: 30px; }
    @media (max-width: 820px) { .report-hero { flex-direction: column; align-items: stretch; } .filters, .summary { grid-template-columns: 1fr; } }
  `]
})
export class OutgoingFundsReportComponent implements OnInit {
  readonly entries = signal<OutgoingFundEntry[]>([]);
  readonly loading = signal(true);
  readonly error = signal('');
  readonly query = signal('');
  readonly fromDate = signal('');
  readonly toDate = signal('');

  readonly rows = computed<ReportRow[]>(() => this.entries().flatMap((entry) => {
    const lines = Array.isArray(entry.lineItems) && entry.lineItems.length ? entry.lineItems : [{
      sno: 1,
      type: entry.transactionType || 'Outgoing',
      accountName: String(entry['paidToAccountName'] || entry['payeeName'] || ''),
      amount: moneyValue(entry.amount),
      salaryMonthYear: String(entry['salaryMonthYear'] || ''),
      remarks: entry.remarks || ''
    }];
    return lines.map((line, index) => ({
      id: `${entry.id}:${index}`,
      entryNo: entry.entryNo,
      entryDate: entry.entryDate,
      savedTime: this.savedTime(entry),
      type: line.type || entry.transactionType || 'Outgoing',
      accountName: line.accountName || String(entry['paidToAccountName'] || entry['payeeName'] || ''),
      amount: moneyValue(line.amount),
      salaryMonthYear: line.salaryMonthYear || '',
      remarks: line.remarks || entry.remarks || ''
    }));
  }));

  readonly filteredRows = computed(() => {
    const term = this.query().trim().toLowerCase();
    const from = this.fromDate();
    const to = this.toDate();
    return this.rows().filter((row) => {
      const inRange = (!from || row.entryDate >= from) && (!to || row.entryDate <= to);
      if (!inRange) return false;
      if (!term) return true;
      return [row.entryNo, row.entryDate, row.savedTime, row.type, row.accountName, row.salaryMonthYear, row.remarks]
        .some((value) => String(value || '').toLowerCase().includes(term));
    });
  });

  readonly total = computed(() => this.rows().reduce((sum, row) => sum + moneyValue(row.amount), 0));
  readonly filteredTotal = computed(() => this.filteredRows().reduce((sum, row) => sum + moneyValue(row.amount), 0));

  constructor(private readonly api: ApiService) {}

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.error.set('');
    this.api.list<OutgoingFundEntry[]>('transactions/outgoing-funds', { branchId: this.api.selectedBranchId(), limit: 500 }).subscribe({
      next: (entries) => {
        this.entries.set((entries || []).filter((entry) => entry.status !== 'deleted'));
        this.loading.set(false);
      },
      error: (error) => {
        this.error.set(error?.error?.error || error?.message || 'Unable to load saved outgoing entries');
        this.loading.set(false);
      }
    });
  }

  money(value: unknown): string {
    return moneyValue(value).toLocaleString('en-IN', { maximumFractionDigits: 2, minimumFractionDigits: 2 });
  }

  private savedTime(entry: OutgoingFundEntry): string {
    const raw = entry.createdAt || entry.updatedAt || '';
    if (!raw) return '';
    const date = new Date(raw);
    if (Number.isNaN(date.getTime())) return raw;
    return date.toLocaleString('en-IN', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true
    });
  }
}

function moneyValue(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? Math.round(parsed * 100) / 100 : 0;
}
