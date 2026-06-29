import { CommonModule, CurrencyPipe, DatePipe } from '@angular/common';
import { Component, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ApiRecord, ApiService } from '../core/api.service';
import { StateComponent } from '../shared/ui/state/state.component';

type AppointmentDetailReport = {
  summary: ApiRecord;
  rows: ApiRecord[];
  total: number;
  limit: number;
  offset: number;
};

@Component({
  selector: 'app-appointment-detail-list-report',
  standalone: true,
  imports: [CommonModule, CurrencyPipe, DatePipe, FormsModule, RouterLink, StateComponent],
  template: `
    <section class="page-stack appointment-report-page">
      <div class="module-hero report-hero">
        <div>
          <span class="eyebrow">Reports / Appointments</span>
          <h2>Detail Appointment List</h2>
          <p>Salonist-style appointment register with mode, service, staff, status and price in one report.</p>
        </div>
        <div class="hero-actions">
          <button class="ghost-button" type="button" (click)="goBack()">Back</button>
          <a class="ghost-button" routerLink="/reports">Reports</a>
          <button class="ghost-button" type="button" (click)="exportCsv()" [disabled]="!rows().length">Download</button>
          <button class="primary-button" type="button" (click)="runReport()">Run Report</button>
        </div>
      </div>

      <section class="panel filter-panel">
        <label class="field">
          <span>Type</span>
          <select [(ngModel)]="type">
            <option value="all">All Appointments</option>
            <option value="confirmed">Confirmed</option>
            <option value="arrived">Arrived</option>
            <option value="started">Start</option>
            <option value="completed">Completed</option>
            <option value="cancelled">Cancel</option>
            <option value="not_came">Not Came</option>
            <option value="not_confirmed">Not Confirmed</option>
          </select>
        </label>
        <label class="field">
          <span>Mode</span>
          <select [(ngModel)]="mode">
            <option value="all">All Modes</option>
            <option value="manual">Manual</option>
            <option value="online">Online</option>
            <option value="import">Import</option>
          </select>
        </label>
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
          <small>Change branch from top header.</small>
        </div>
        <button class="primary-button" type="button" (click)="runReport()">Run Report</button>
      </section>

      <app-state [loading]="loading()" [error]="error()"></app-state>

      <ng-container *ngIf="report() as data">
        <section class="status-strip">
          <article *ngFor="let card of statusCards" class="status-card" [ngClass]="card.tone">
            <strong>{{ numberValue(data.summary?.[card.key]) }}</strong>
            <span>{{ card.label }}</span>
          </article>
        </section>

        <section class="panel table-panel">
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
              <input [(ngModel)]="search" placeholder="Customer name or contact" (keydown.enter)="runReport()" />
            </label>
            <button class="ghost-button" type="button" (click)="runReport()">Go</button>
          </div>

          <div class="table-meta">
            <span>{{ dateLabel() }} · {{ total() }} appointment row(s)</span>
            <span>Total price {{ data.summary?.appointmentPrice || 0 | currency: 'INR':'symbol':'1.0-0' }}</span>
          </div>

          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Mode</th>
                  <th>Name</th>
                  <th>Contact</th>
                  <th>Notes</th>
                  <th>Services</th>
                  <th>Staff</th>
                  <th>Status</th>
                  <th>Appointment Date</th>
                  <th>Appointment Time</th>
                  <th>Price</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                <tr *ngFor="let row of rows()">
                  <td><strong>{{ row.mode || '-' }}</strong></td>
                  <td>
                    <span class="avatar">{{ initials(row.name) }}</span>
                    <strong>{{ row.name || 'Walk-In' }}</strong>
                  </td>
                  <td>{{ row.contact || '-' }}</td>
                  <td>{{ row.notes || '-' }}</td>
                  <td>{{ row.serviceNames || '-' }}</td>
                  <td>{{ row.staffName || 'Unassigned' }}</td>
                  <td><span class="status-pill" [ngClass]="row.statusGroup">{{ row.status || '-' }}</span></td>
                  <td>{{ row.appointmentDate ? (row.appointmentDate | date: 'dd-MM-yyyy') : '-' }}</td>
                  <td>{{ row.appointmentTime || '-' }}</td>
                  <td>{{ row.price || 0 | currency: 'INR':'symbol':'1.0-0' }}</td>
                  <td><a class="ghost-button mini" [href]="appointmentHref(row)">Open</a></td>
                </tr>
                <tr *ngIf="!rows().length">
                  <td colspan="11" class="empty-state"><strong>No data found</strong></td>
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
    :host { display: block; width: 100%; min-width: 0; color: var(--ink); }
    .appointment-report-page { display: grid; gap: 12px; width: 100%; max-width: 100%; min-width: 0; overflow-x: hidden; }
    .report-hero { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 16px; align-items: center; }
    .report-hero p { max-width: 780px; margin: 6px 0 0; color: var(--muted); font-weight: 650; }
    .hero-actions, .table-controls, .pager { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
    .hero-actions { justify-content: flex-end; }
    .filter-panel { display: grid; grid-template-columns: repeat(4, minmax(150px, 1fr)) minmax(220px, 1fr) auto; align-items: end; gap: 12px; }
    .field { display: grid; gap: 5px; }
    .field span, .branch-context-card span { color: var(--muted); font-size: 12px; font-weight: 900; text-transform: uppercase; }
    input, select { min-height: 44px; border: 1px solid var(--line); border-radius: 8px; padding: 0 12px; color: var(--ink); background: var(--surface); font: inherit; }
    .branch-context-card { display: grid; gap: 4px; min-height: 64px; padding: 10px 12px; border: 1px solid var(--line); border-radius: 8px; background: var(--surface-2); }
    .branch-context-card small { color: var(--muted); }
    .status-strip { display: grid; grid-template-columns: repeat(8, minmax(130px, 1fr)); gap: 8px; overflow-x: auto; padding-bottom: 2px; }
    .status-card { min-height: 86px; border: 1px solid var(--line); border-radius: 8px; padding: 14px; background: var(--surface); display: grid; align-content: center; gap: 8px; }
    .status-card strong { font-size: 20px; }
    .status-card span { color: var(--muted); font-weight: 900; font-size: 12px; text-transform: uppercase; }
    .confirmed { background: #dff8ed; } .arrived { background: #e0f2fe; } .started { background: #fff4d6; } .completed { background: #e8e9ff; } .cancelled { background: #ffe3e6; } .not-came { background: #e1f7df; } .not-confirmed { background: #eef1ff; }
    .table-panel { display: grid; gap: 12px; overflow: hidden; }
    .table-controls { justify-content: flex-end; }
    .page-size-field { width: 112px; }
    .search-field { min-width: min(320px, 100%); }
    .table-meta { display: flex; justify-content: space-between; gap: 12px; flex-wrap: wrap; color: var(--muted); font-weight: 700; }
    .table-wrap { width: 100%; overflow: auto; border: 1px solid var(--line); border-radius: 8px; }
    table { width: 100%; min-width: 1180px; border-collapse: collapse; background: var(--surface); }
    th, td { padding: 14px 12px; border-bottom: 1px solid var(--line); text-align: left; vertical-align: top; }
    th { color: var(--muted); font-size: 12px; text-transform: uppercase; background: var(--surface-2); }
    td { font-weight: 650; }
    .avatar { display: inline-grid; place-items: center; width: 34px; height: 34px; margin-right: 8px; border-radius: 999px; background: var(--ink); color: var(--surface); font-size: 12px; font-weight: 900; }
    .status-pill { display: inline-flex; min-width: 90px; justify-content: center; border-radius: 999px; padding: 6px 10px; color: var(--ink); background: var(--surface-2); font-weight: 900; }
    .status-pill.completed { background: #e8e9ff; } .status-pill.cancelled { background: #ffe3e6; } .status-pill.not_came { background: #e1f7df; } .status-pill.confirmed { background: #dff8ed; } .status-pill.arrived { background: #e0f2fe; } .status-pill.started { background: #fff4d6; }
    .empty-state { padding: 34px 12px; text-align: center; color: var(--muted); }
    .pager { justify-content: space-between; color: var(--muted); font-weight: 800; }
    .mini { min-height: 32px; padding: 0 10px; font-size: 12px; }
    @media (max-width: 1100px) { .report-hero, .filter-panel { grid-template-columns: 1fr; } .hero-actions { justify-content: flex-start; } .status-strip { grid-template-columns: repeat(4, minmax(130px, 1fr)); } }
  `]
})
export class AppointmentDetailListReportComponent implements OnInit {
  readonly loading = signal(false);
  readonly error = signal('');
  readonly report = signal<AppointmentDetailReport | null>(null);

  readonly statusCards = [
    { key: 'total', label: 'Total', tone: '' },
    { key: 'confirmed', label: 'Confirmed', tone: 'confirmed' },
    { key: 'arrived', label: 'Arrived', tone: 'arrived' },
    { key: 'started', label: 'Start', tone: 'started' },
    { key: 'completed', label: 'Completed', tone: 'completed' },
    { key: 'cancelled', label: 'Cancel', tone: 'cancelled' },
    { key: 'notCame', label: 'Not Came', tone: 'not-came' },
    { key: 'notConfirmed', label: 'Not Confirmed', tone: 'not-confirmed' }
  ];

  from = this.daysAgo(7);
  to = this.today();
  type = 'all';
  mode = 'all';
  search = '';
  limit = 25;
  offset = 0;
  branchId = '';

  constructor(private readonly api: ApiService) {}

  ngOnInit(): void {
    this.runReport();
  }

  runReport(): void {
    this.loading.set(true);
    this.error.set('');
    this.branchId = this.api.selectedBranchId();
    this.api.report<AppointmentDetailReport>('appointment-detail-list', {
      from: this.from,
      to: this.to,
      type: this.type,
      mode: this.mode,
      search: this.search,
      limit: this.limit,
      offset: this.offset,
      branchId: this.branchId
    }).subscribe({
      next: (report) => {
        this.report.set(report);
        this.loading.set(false);
      },
      error: (error) => {
        this.error.set(this.api.errorText(error, 'Unable to load appointment detail report'));
        this.loading.set(false);
      }
    });
  }

  rows(): ApiRecord[] {
    return this.report()?.rows || [];
  }

  total(): number {
    return Number(this.report()?.total || 0);
  }

  showingFrom(): number {
    return this.total() ? this.offset + 1 : 0;
  }

  showingTo(): number {
    return Math.min(this.offset + this.limit, this.total());
  }

  previousPage(): void {
    this.offset = Math.max(0, this.offset - this.limit);
    this.runReport();
  }

  nextPage(): void {
    if (this.showingTo() >= this.total()) return;
    this.offset += this.limit;
    this.runReport();
  }

  exportCsv(): void {
    const headers = ['Mode', 'Name', 'Contact', 'Notes', 'Services', 'Staff', 'Status', 'Appointment Date', 'Appointment Time', 'Price', 'Invoice No'];
    const rows = this.rows().map((row) => [row.mode, row.name, row.contact, row.notes, row.serviceNames, row.staffName, row.status, row.appointmentDate, row.appointmentTime, row.price, row.invoiceNumber]);
    this.downloadCsv('appointment-detail-list-report.csv', [headers, ...rows]);
  }

  appointmentHref(row: ApiRecord): string {
    return row.appointmentId ? `/appointments?appointmentId=${encodeURIComponent(row.appointmentId)}` : '/appointments';
  }

  branchLabel(): string {
    return this.branchId || 'All allowed branches';
  }

  dateLabel(): string {
    return `${this.from} to ${this.to}`;
  }

  numberValue(value: unknown): number {
    return Number(value || 0);
  }

  initials(value = ''): string {
    const parts = String(value || 'W').trim().split(/\s+/).filter(Boolean);
    return ((parts[0]?.[0] || 'W') + (parts.length > 1 ? parts.at(-1)?.[0] || '' : '')).toUpperCase();
  }

  goBack(): void {
    if (window.history.length > 1) window.history.back();
  }

  private today(): string {
    return new Date().toISOString().slice(0, 10);
  }

  private daysAgo(days: number): string {
    const date = new Date();
    date.setDate(date.getDate() - days);
    return date.toISOString().slice(0, 10);
  }

  private downloadCsv(filename: string, rows: unknown[][]): void {
    const csv = rows.map((row) => row.map((cell) => `"${String(cell ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
  }
}
