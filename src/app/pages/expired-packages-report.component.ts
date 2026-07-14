import { CommonModule } from '@angular/common';
import { Component, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ApiRecord, ApiService } from '../core/api.service';
import { StateComponent } from '../shared/ui/state/state.component';
import { AuraMoneyPipe } from '../shared/pipes/aura-money.pipe';
import { AuraDatePipe } from '../shared/pipes/aura-date.pipe';

type ExpiredPackagesReport = {
  summary: ApiRecord;
  rows: ApiRecord[];
  total: number;
  limit: number;
  offset: number;
};

@Component({
  selector: 'app-expired-packages-report',
  standalone: true,
  imports: [AuraDatePipe, AuraMoneyPipe, CommonModule, FormsModule, RouterLink, StateComponent],
  template: `
    <section class="page-stack expired-packages-page inner-page-shell">
      <div class="module-hero report-hero inner-page-header">
        <div>
          <h2>Expired Packages</h2>
        </div>
        <div class="hero-actions inner-action-bar">
          <button class="ghost-button" type="button" (click)="goBack()">Back</button>
          <a class="ghost-button" routerLink="/reports">Reports</a>
          <button class="ghost-button" type="button" (click)="exportCsv()" [disabled]="!rows().length">Download</button>
          <button class="primary-button" type="button" (click)="runReport()">Run Report</button>
        </div>
      </div>

      <section class="panel report-filter-panel">
        <label class="field">
          <span>From</span>
          <input type="date" [(ngModel)]="from" />
        </label>
        <label class="field">
          <span>To</span>
          <input type="date" [(ngModel)]="to" />
        </label>
        <div class="branch-context-card">
          <span>Header branch</span>
          <strong>{{ branchLabel() }}</strong>
        </div>
        <button class="primary-button" type="button" (click)="runReport()">Run Report</button>
      </section>

      <app-state [loading]="loading()" [error]="error()"></app-state>

      <ng-container *ngIf="report() as data">
        <section class="metrics-grid report-kpis inner-stats-grid">
          <article class="metric-card">
            <span>Total Packages</span>
            <strong>{{ data.summary.totalPackages || 0 }}</strong>
          </article>
          <article class="metric-card">
            <span>Packages Amount</span>
            <strong>{{ data.summary.packagesAmount || 0 | auraMoney:'1.0-0' }}</strong>
          </article>
          <article class="metric-card">
            <span>Total Services</span>
            <strong>{{ numberValue(data.summary.totalServices) }}</strong>
          </article>
          <article class="metric-card">
            <span>Pending Services</span>
            <strong>{{ numberValue(data.summary.pendingServices) }}</strong>
          </article>
        </section>

        <section class="panel report-table-panel">
          <div class="table-controls">
            <label class="field page-size-field">
              <span>Show</span>
              <select [(ngModel)]="limit" (ngModelChange)="runReport()">
                <option [ngValue]="10">10</option>
                <option [ngValue]="25">25</option>
                <option [ngValue]="50">50</option>
                <option [ngValue]="100">100</option>
              </select>
            </label>
            <label class="field search-field">
              <span>Search</span>
              <input [(ngModel)]="search" placeholder="Customer, contact, package" (keydown.enter)="runReport()" />
            </label>
            <button class="ghost-button" type="button" (click)="runReport()">Go</button>
          </div>

          <div class="table-meta">
            <span>Search: 4+ characters for customer, contact, or package name.</span>
            <span>Showing {{ showingFrom() }} to {{ showingTo() }} of {{ total() }} Entries</span>
          </div>

          <div class="expired-table-wrap">
            <table class="expired-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Contact</th>
                  <th>Package</th>
                  <th>Price</th>
                  <th>Total Services</th>
                  <th>No. of Pending Services</th>
                  <th>Date</th>
                  <th>Expired On</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                <tr *ngFor="let row of rows()">
                  <td><strong>{{ row.clientName || 'Walk-in Client' }}</strong></td>
                  <td>{{ row.contact || '-' }}</td>
                  <td>{{ row.packageName || '-' }}</td>
                  <td>{{ row.price || 0 | auraMoney:'1.0-0' }}</td>
                  <td>{{ numberValue(row.totalServices) }}</td>
                  <td><span class="pending-pill">{{ numberValue(row.pendingServices) }}</span></td>
                  <td>{{ row.date ? (row.date | auraDate:'date') : '-' }}</td>
                  <td><span class="expired-date">{{ row.expiredOn ? (row.expiredOn | auraDate:'date') : '-' }}</span></td>
                  <td><a class="ghost-button mini" [href]="clientHref(row)">Open</a></td>
                </tr>
                <tr *ngIf="!rows().length">
                  <td colspan="9" class="empty-state">
                    <strong>No data found</strong>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <footer class="pager">
            <button class="ghost-button" type="button" (click)="previousPage()" [disabled]="offset <= 0">Previous</button>
            <span>Showing {{ showingFrom() }} to {{ showingTo() }} of {{ total() }} Entries</span>
            <button class="ghost-button" type="button" (click)="nextPage()" [disabled]="showingTo() >= total()">Next</button>
          </footer>
        </section>
      </ng-container>
    </section>
  `,
  styles: [`
    :host {
      display: block;
      width: 100%;
      min-width: 0;
      color: var(--ink);
    }

    .expired-packages-page {
      display: grid;
      gap: 12px;
      width: 100%;
      max-width: 100%;
      min-width: 0;
      overflow-x: hidden;
    }

    .report-hero {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: 16px;
      align-items: center;
    }

    .report-hero p {
      max-width: 760px;
      margin: 6px 0 0;
      color: var(--muted);
      font-weight: 650;
    }

    .hero-actions,
    .table-controls,
    .pager {
      display: flex;
      align-items: center;
      gap: 10px;
      flex-wrap: wrap;
    }

    .hero-actions {
      justify-content: flex-end;
    }

    .report-filter-panel {
      display: grid;
      grid-template-columns: repeat(2, minmax(170px, 1fr)) minmax(220px, 1fr) auto;
      align-items: end;
      gap: 12px;
    }

    .field {
      display: grid;
      gap: 5px;
    }

    .field span,
    .branch-context-card span {
      color: var(--muted);
      font-size: 12px;
      font-weight: 900;
      text-transform: uppercase;
    }

    input,
    select {
      min-height: 44px;
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 0 12px;
      color: var(--ink);
      background: var(--surface);
      font: inherit;
    }

    .branch-context-card {
      display: grid;
      gap: 4px;
      min-height: 64px;
      padding: 10px 12px;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: var(--surface-2);
    }

    .branch-context-card small {
      color: var(--muted);
    }

    .report-kpis {
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 12px;
    }

    .report-kpis .metric-card {
      min-height: 106px;
      border-top: 4px solid color-mix(in srgb, var(--teal) 58%, var(--line));
    }

    .report-table-panel {
      display: grid;
      gap: 12px;
      overflow: hidden;
    }

    .table-controls {
      justify-content: flex-end;
    }

    .page-size-field {
      width: 112px;
    }

    .search-field {
      width: min(100%, 320px);
    }

    .table-meta {
      display: flex;
      justify-content: space-between;
      gap: 12px;
      flex-wrap: wrap;
      color: var(--muted);
      font-weight: 800;
    }

    .expired-table-wrap {
      width: 100%;
      overflow-x: auto;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: var(--surface);
    }

    .expired-table {
      width: 100%;
      min-width: 1120px;
      border-collapse: collapse;
    }

    .expired-table th,
    .expired-table td {
      padding: 12px 13px;
      border-bottom: 1px solid var(--line);
      text-align: left;
      vertical-align: middle;
      white-space: nowrap;
    }

    .expired-table th {
      position: sticky;
      top: 0;
      z-index: 1;
      color: var(--muted);
      background: var(--surface-2);
      font-size: 12px;
      font-weight: 900;
      text-transform: uppercase;
    }

    .pending-pill {
      display: inline-flex;
      min-width: 34px;
      justify-content: center;
      border-radius: 999px;
      padding: 4px 10px;
      color: var(--teal);
      background: color-mix(in srgb, var(--teal) 12%, white);
      font-weight: 900;
    }

    .expired-date {
      color: #b91c1c;
      font-weight: 900;
    }

    .empty-state {
      height: 220px;
      text-align: center;
      color: var(--muted);
    }

    .empty-state strong {
      color: var(--ink);
      font-size: 22px;
    }

    .pager {
      justify-content: center;
      color: var(--muted);
      font-weight: 800;
    }

    .mini {
      min-height: 30px;
      padding: 0 10px;
      border-radius: 6px;
    }

    @media (max-width: 900px) {
      .report-hero,
      .report-filter-panel,
      .report-kpis {
        grid-template-columns: 1fr;
      }

      .hero-actions,
      .table-controls {
        justify-content: flex-start;
      }

      .page-size-field,
      .search-field {
        width: 100%;
      }
    }
  `]
})
export class ExpiredPackagesReportComponent implements OnInit {
  readonly loading = signal(false);
  readonly error = signal('');
  readonly report = signal<ExpiredPackagesReport | null>(null);

  from = this.dateKey(this.addDays(new Date(), -7));
  to = this.dateKey(new Date());
  search = '';
  limit = 25;
  offset = 0;

  constructor(private readonly api: ApiService) {}

  ngOnInit(): void {
    this.runReport();
  }

  rows(): ApiRecord[] {
    return this.report()?.rows || [];
  }

  total(): number {
    return Number(this.report()?.total || 0);
  }

  branchLabel(): string {
    return this.api.selectedBranchId() || 'All branches';
  }

  runReport(resetPage = true): void {
    if (resetPage) this.offset = 0;
    this.loading.set(true);
    this.error.set('');
    this.api.report<ExpiredPackagesReport>('expired-packages', {
      from: this.from,
      to: this.to,
      search: this.search.trim().length >= 4 ? this.search.trim() : '',
      limit: this.limit,
      offset: this.offset
    }).subscribe({
      next: (report) => {
        this.report.set(report || { summary: {}, rows: [], total: 0, limit: this.limit, offset: this.offset });
        this.loading.set(false);
      },
      error: (error) => {
        this.error.set(this.api.errorText(error, 'Unable to load expired packages'));
        this.report.set({ summary: {}, rows: [], total: 0, limit: this.limit, offset: this.offset });
        this.loading.set(false);
      }
    });
  }

  previousPage(): void {
    if (this.offset <= 0) return;
    this.offset = Math.max(0, this.offset - this.limit);
    this.runReport(false);
  }

  nextPage(): void {
    if (this.showingTo() >= this.total()) return;
    this.offset += this.limit;
    this.runReport(false);
  }

  showingFrom(): number {
    return this.total() ? this.offset + 1 : 0;
  }

  showingTo(): number {
    return Math.min(this.total(), this.offset + this.rows().length);
  }

  numberValue(value: unknown): string {
    const number = Number(value || 0);
    return Number.isInteger(number) ? String(number) : number.toFixed(2);
  }

  clientHref(row: ApiRecord): string {
    return row.clientId ? `/clients/${encodeURIComponent(String(row.clientId))}` : '/clients';
  }

  exportCsv(): void {
    const headers = ['Name', 'Contact', 'Package', 'Price', 'Total Services', 'No. Of Pending Services', 'Date', 'Expired On'];
    const lines = this.rows().map((row) => [
      row.clientName,
      row.contact,
      row.packageName,
      row.price,
      row.totalServices,
      row.pendingServices,
      row.date,
      row.expiredOn
    ].map((value) => `"${String(value ?? '').replace(/"/g, '""')}"`).join(','));
    const csv = [headers.join(','), ...lines].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'expired-packages-report.csv';
    link.click();
    URL.revokeObjectURL(url);
  }

  goBack(): void {
    window.history.length > 1 ? window.history.back() : (window.location.href = '/reports');
  }

  private addDays(date: Date, days: number): Date {
    const copy = new Date(date);
    copy.setDate(copy.getDate() + days);
    return copy;
  }

  private dateKey(date: Date): string {
    const local = new Date(date.getTime() - (date.getTimezoneOffset() * 60000));
    return local.toISOString().slice(0, 10);
  }
}
