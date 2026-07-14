import { CommonModule } from '@angular/common';
import { Component, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { AuthSessionService } from '../core/auth-session.service';
import { grantsAllow, staticGrantsForRole } from '../core/permission.guard';
import { routePermissionForPath } from '../core/access-rules';
import { AppStateService } from '../core/state/app-state.service';
import { ApiRecord, ApiService } from '../core/api.service';
import { StateComponent } from '../shared/ui/state/state.component';
import { AuraMoneyPipe } from '../shared/pipes/aura-money.pipe';
import { AuraDatePipe } from '../shared/pipes/aura-date.pipe';

type CompletedPackagesReport = {
  summary: ApiRecord;
  rows: ApiRecord[];
  total: number;
  limit: number;
  offset: number;
};

@Component({
  selector: 'app-completed-packages-report',
  standalone: true,
  imports: [AuraDatePipe, AuraMoneyPipe, CommonModule, FormsModule, RouterLink, StateComponent],
  template: `
    <section class="page-stack completed-packages-page inner-page-shell">
      <div class="module-hero report-hero inner-page-header">
        <div>
          <h2>Completed Packages</h2>
        </div>
        <div class="hero-actions inner-action-bar">
          <button class="ghost-button" type="button" (click)="goBack()">Back</button>
          <a class="ghost-button" routerLink="/reports">Reports</a>
          <button class="ghost-button" type="button" (click)="exportCsv()" [disabled]="!rows().length">Download CSV</button>
          <button class="primary-button" type="button" (click)="runReport()">Run Report</button>
        </div>
      </div>

      <section class="panel filter-panel">
        <label class="field">
          <span>From</span>
          <input type="date" [(ngModel)]="from" />
        </label>
        <label class="field">
          <span>To</span>
          <input type="date" [(ngModel)]="to" />
        </label>
        <label class="field search-field">
          <span>Search</span>
          <input [(ngModel)]="search" placeholder="Client, contact, package, service" (keydown.enter)="runReport()" />
        </label>
        <label class="field page-size-field">
          <span>Show</span>
          <select [(ngModel)]="limit" (ngModelChange)="runReport()">
            <option [ngValue]="10">10</option>
            <option [ngValue]="25">25</option>
            <option [ngValue]="50">50</option>
            <option [ngValue]="100">100</option>
          </select>
        </label>
        <button class="primary-button" type="button" (click)="runReport()">Run Report</button>
      </section>

      <app-state [loading]="loading()" [error]="error()"></app-state>

      <ng-container *ngIf="report() as data">
        <section class="metrics-grid report-kpis inner-stats-grid">
          <article class="metric-card">
            <span>Total completed services</span>
            <strong>{{ numberValue(data.summary.totalCompletedServices) }}</strong>
          </article>
          <article class="metric-card">
            <span>Total service amount</span>
            <strong>{{ data.summary.totalServiceAmount || 0 | auraMoney:'1.0-0' }}</strong>
          </article>
          <article class="metric-card">
            <span>Completed package count</span>
            <strong>{{ data.summary.completedPackageCount || 0 }}</strong>
          </article>
          <article class="metric-card">
            <span>Redeemed quantity</span>
            <strong>{{ numberValue(data.summary.redeemedQty) }}</strong>
          </article>
        </section>

        <section class="panel report-table-panel">
          <div class="table-meta">
            <span>Showing {{ showingFrom() }} to {{ showingTo() }} of {{ total() }} Entries</span>
            <span>Search: customer, contact, service, package, or invoice.</span>
          </div>
          <div class="completed-table-wrap">
            <table class="completed-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Contact</th>
                  <th>Package</th>
                  <th>Service Name</th>
                  <th>Price</th>
                  <th>Total Qty</th>
                  <th>Redeemed Qty</th>
                  <th>Pending Qty</th>
                  <th>Date</th>
                  <th>Expired On</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                <tr *ngFor="let row of rows()">
                  <td><strong>{{ row.clientName || 'Walk-in Client' }}</strong></td>
                  <td>{{ row.contact || '-' }}</td>
                  <td>{{ row.packageName || '-' }}</td>
                  <td>{{ row.serviceName || '-' }}</td>
                  <td>{{ row.price || 0 | auraMoney:'1.0-0' }}</td>
                  <td>{{ numberValue(row.totalQty) }}</td>
                  <td><span class="completed-pill">{{ numberValue(row.redeemedQty) }}</span></td>
                  <td>{{ numberValue(row.pendingQty) }}</td>
                  <td>{{ row.date ? (row.date | auraDate:'date') : '-' }}</td>
                  <td><span [class.expired]="row.status === 'expired'">{{ row.expiredOn ? (row.expiredOn | auraDate:'date') : '-' }}</span></td>
                  <td class="actions-cell">
                    <a class="ghost-button mini" *ngIf="row.clientId" [routerLink]="['/clients', row.clientId]">Client</a>
                    <ng-container *ngIf="canAccessPath('/pos/invoices')">
                      <a class="ghost-button mini" *ngIf="row.invoiceId" routerLink="/pos/invoices" [queryParams]="{ q: row.invoiceId }">Invoice</a>
                    </ng-container>
                  </td>
                </tr>
                <tr *ngIf="!rows().length">
                  <td colspan="11" class="empty-state">
                    <strong>No data found</strong>
                    <span>Selected range me completed package services nahi mile.</span>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <footer class="pager">
            <button class="ghost-button" type="button" (click)="previousPage()" [disabled]="offset <= 0">Previous</button>
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
      overflow-x: hidden;
    }

    .completed-packages-page {
      width: 100%;
      max-width: 100%;
      min-width: 0;
      box-sizing: border-box;
      overflow-x: hidden;
    }

    .report-hero {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: 16px;
      align-items: center;
    }

    .report-hero p {
      max-width: 780px;
      margin: 6px 0 0;
      color: var(--muted);
      font-weight: 650;
    }

    .hero-actions {
      display: flex;
      justify-content: flex-end;
      flex-wrap: wrap;
      gap: 10px;
    }

    .filter-panel {
      display: flex;
      align-items: end;
      flex-wrap: wrap;
      gap: 12px;
      overflow: visible;
    }

    .filter-panel .field {
      flex: 1 1 180px;
      min-width: 0;
    }

    .filter-panel .search-field {
      flex: 2 1 320px;
    }

    .filter-panel .page-size-field {
      flex: 0 1 120px;
    }

    .report-kpis {
      grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
      gap: 12px;
    }

    .report-kpis .metric-card {
      min-height: 116px;
      border-top: 4px solid color-mix(in srgb, var(--teal) 52%, var(--line));
    }

    .report-table-panel {
      overflow: hidden;
    }

    .table-meta {
      display: flex;
      justify-content: space-between;
      gap: 12px;
      flex-wrap: wrap;
      margin-bottom: 12px;
      color: var(--muted);
      font-weight: 750;
    }

    .completed-table-wrap {
      width: 100%;
      max-width: 100%;
      overflow: auto;
      border: 1px solid var(--line);
      border-radius: var(--radius-md);
      background: var(--surface);
      overscroll-behavior: contain;
    }

    .completed-table {
      min-width: 1260px;
      width: 100%;
      border-collapse: collapse;
    }

    .completed-table th,
    .completed-table td {
      border-bottom: 1px solid var(--line);
      padding: 13px 14px;
      text-align: left;
      vertical-align: middle;
      white-space: nowrap;
    }

    .completed-table th {
      position: sticky;
      top: 0;
      z-index: 1;
      background: color-mix(in srgb, var(--surface-2) 90%, white);
      color: var(--muted);
      font-size: 12px;
      text-transform: uppercase;
    }

    .completed-pill {
      display: inline-flex;
      min-width: 34px;
      justify-content: center;
      border-radius: 999px;
      padding: 4px 10px;
      background: color-mix(in srgb, var(--teal) 12%, white);
      color: var(--teal);
      font-weight: 900;
    }

    .expired {
      color: #b91c1c;
      font-weight: 900;
    }

    .actions-cell {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
    }

    .empty-state {
      height: 240px;
      text-align: center;
      color: var(--muted);
    }

    .empty-state strong,
    .empty-state span {
      display: block;
      margin: 6px 0;
    }

    .empty-state strong {
      color: var(--ink);
      font-size: 22px;
    }

    .pager {
      display: flex;
      justify-content: center;
      gap: 10px;
      padding-top: 16px;
    }

    @media (max-width: 860px) {
      .report-hero {
        grid-template-columns: 1fr;
      }

      .hero-actions {
        justify-content: flex-start;
      }
    }
  `]
})
export class CompletedPackagesReportComponent implements OnInit {
  readonly loading = signal(false);
  readonly error = signal('');
  readonly report = signal<CompletedPackagesReport | null>(null);

  from = '';
  to = '';
  search = '';
  limit = 25;
  offset = 0;

  constructor(
    private readonly api: ApiService,
    private readonly state: AppStateService,
    private readonly session: AuthSessionService
  ) {}

  canAccessPath(path: string): boolean {
    const permission = routePermissionForPath(path);
    if (!permission || (Array.isArray(permission) && !permission.length)) return true;
    const permissions = Array.isArray(permission) ? permission : [permission];
    const dynamicGrants = this.session.currentUser()?.permissions || [];
    const grants = Array.from(new Set([...staticGrantsForRole(this.state.userRole()), ...dynamicGrants]));
    return permissions.some((item) => grantsAllow(grants, item));
  }

  ngOnInit(): void {
    this.runReport();
  }

  rows(): ApiRecord[] {
    return this.report()?.rows || [];
  }

  total(): number {
    return Number(this.report()?.total || 0);
  }

  runReport(resetPage = true): void {
    if (resetPage) this.offset = 0;
    this.loading.set(true);
    this.error.set('');
    this.api.report<CompletedPackagesReport>('completed-packages', {
      from: this.from,
      to: this.to,
      search: this.search,
      limit: this.limit,
      offset: this.offset
    }).subscribe({
      next: (report) => {
        this.report.set(report || { summary: {}, rows: [], total: 0, limit: this.limit, offset: this.offset });
        this.loading.set(false);
      },
      error: (error) => {
        this.error.set(this.api.errorText(error, 'Unable to load completed packages'));
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

  exportCsv(): void {
    const headers = ['Name', 'Contact', 'Package', 'Service Name', 'Price', 'Total Qty', 'Redeemed Qty', 'Pending Qty', 'Date', 'Expired On'];
    const lines = this.rows().map((row) => [
      row.clientName,
      row.contact,
      row.packageName,
      row.serviceName,
      row.price,
      row.totalQty,
      row.redeemedQty,
      row.pendingQty,
      row.date,
      row.expiredOn
    ].map((value) => `"${String(value ?? '').replace(/"/g, '""')}"`).join(','));
    const csv = [headers.join(','), ...lines].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'completed-packages-report.csv';
    link.click();
    URL.revokeObjectURL(url);
  }

  goBack(): void {
    window.history.length > 1 ? window.history.back() : (window.location.href = '/reports');
  }
}
