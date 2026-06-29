import { CommonModule, CurrencyPipe } from '@angular/common';
import { Component, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ApiRecord, ApiService } from '../core/api.service';
import { StateComponent } from '../shared/ui/state/state.component';

type StaffAppointmentsReport = {
  summary: ApiRecord;
  rows: ApiRecord[];
  total: number;
  limit: number;
  offset: number;
};

@Component({
  selector: 'app-staff-appointments-report',
  standalone: true,
  imports: [CommonModule, CurrencyPipe, FormsModule, RouterLink, StateComponent],
  template: `
    <section class="page-stack staff-appointments-page">
      <div class="module-hero report-hero">
        <div>
          <span class="eyebrow">Reports / Appointments</span>
          <h2>Appointment Booked By Staff</h2>
          <p>Staff-wise appointment count, appointment price and completion quality for the selected date range.</p>
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
        <section class="metrics-grid report-kpis">
          <article class="metric-card">
            <span>Staff</span>
            <strong>{{ numberValue(data.summary?.staffCount) }}</strong>
            <small>All staff in branch</small>
          </article>
          <article class="metric-card">
            <span>Appointment Count</span>
            <strong>{{ numberValue(data.summary?.totalAppointments) }}</strong>
            <small>Booked appointments</small>
          </article>
          <article class="metric-card">
            <span>Appointment Price</span>
            <strong>{{ data.summary?.appointmentPrice || 0 | currency: 'INR':'symbol':'1.0-0' }}</strong>
            <small>Sale or service-price total</small>
          </article>
          <article class="metric-card">
            <span>Active Staff</span>
            <strong>{{ numberValue(data.summary?.activeStaff) }}</strong>
            <small>{{ numberValue(data.summary?.zeroAppointmentStaff) }} with zero bookings</small>
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
              <input [(ngModel)]="search" placeholder="Staff name" (keydown.enter)="runReport()" />
            </label>
            <button class="ghost-button" type="button" (click)="runReport()">Go</button>
          </div>

          <div class="table-meta">
            <span>{{ from }} to {{ to }} · {{ total() }} staff row(s)</span>
            <span>Showing {{ showingFrom() }} to {{ showingTo() }} of {{ total() }} Entries</span>
          </div>

          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Type</th>
                  <th>Appointment Count</th>
                  <th>Appointment Price</th>
                  <th>Completed</th>
                  <th>Cancel</th>
                  <th>Not Came</th>
                  <th>Avg Value</th>
                </tr>
              </thead>
              <tbody>
                <tr *ngFor="let row of rows()">
                  <td>
                    <span class="avatar">{{ row.initials || initials(row.name) }}</span>
                    <strong>{{ row.name || 'Unassigned' }}</strong>
                  </td>
                  <td>{{ row.type || 'Employee' }}</td>
                  <td>{{ numberValue(row.appointmentCount) }}</td>
                  <td>{{ row.appointmentPrice || 0 | currency: 'INR':'symbol':'1.0-0' }}</td>
                  <td>{{ numberValue(row.completed) }}</td>
                  <td>{{ numberValue(row.cancelled) }}</td>
                  <td>{{ numberValue(row.notCame) }}</td>
                  <td>{{ row.averagePrice || 0 | currency: 'INR':'symbol':'1.0-0' }}</td>
                </tr>
                <tr *ngIf="!rows().length">
                  <td colspan="8" class="empty-state"><strong>No data found</strong></td>
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
    .staff-appointments-page { display: grid; gap: 12px; width: 100%; max-width: 100%; min-width: 0; overflow-x: hidden; }
    .report-hero { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 16px; align-items: center; }
    .report-hero p { max-width: 760px; margin: 6px 0 0; color: var(--muted); font-weight: 650; }
    .hero-actions, .table-controls, .pager { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
    .hero-actions { justify-content: flex-end; }
    .filter-panel { display: grid; grid-template-columns: repeat(2, minmax(170px, 1fr)) minmax(220px, 1fr) auto; align-items: end; gap: 12px; }
    .field { display: grid; gap: 5px; }
    .field span, .branch-context-card span { color: var(--muted); font-size: 12px; font-weight: 900; text-transform: uppercase; }
    input, select { min-height: 44px; border: 1px solid var(--line); border-radius: 8px; padding: 0 12px; color: var(--ink); background: var(--surface); font: inherit; }
    .branch-context-card { display: grid; gap: 4px; min-height: 64px; padding: 10px 12px; border: 1px solid var(--line); border-radius: 8px; background: var(--surface-2); }
    .branch-context-card small { color: var(--muted); }
    .report-kpis { grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; }
    .report-kpis .metric-card { min-height: 104px; border-top: 4px solid color-mix(in srgb, var(--teal) 58%, var(--line)); }
    .table-panel { display: grid; gap: 12px; overflow: hidden; }
    .table-controls { justify-content: flex-end; }
    .page-size-field { width: 112px; }
    .search-field { min-width: min(320px, 100%); }
    .table-meta { display: flex; justify-content: space-between; gap: 12px; flex-wrap: wrap; color: var(--muted); font-weight: 700; }
    .table-wrap { width: 100%; overflow: auto; border: 1px solid var(--line); border-radius: 8px; }
    table { width: 100%; min-width: 940px; border-collapse: collapse; background: var(--surface); }
    th, td { padding: 16px 12px; border-bottom: 1px solid var(--line); text-align: left; vertical-align: middle; }
    th { color: var(--muted); font-size: 12px; text-transform: uppercase; background: var(--surface-2); }
    td { font-weight: 650; }
    .avatar { display: inline-grid; place-items: center; width: 34px; height: 34px; margin-right: 10px; border-radius: 999px; background: var(--ink); color: var(--surface); font-size: 12px; font-weight: 900; }
    .empty-state { padding: 34px 12px; text-align: center; color: var(--muted); }
    .pager { justify-content: space-between; color: var(--muted); font-weight: 800; }
    @media (max-width: 960px) { .report-hero, .filter-panel { grid-template-columns: 1fr; } .hero-actions { justify-content: flex-start; } .report-kpis { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
  `]
})
export class StaffAppointmentsReportComponent implements OnInit {
  readonly loading = signal(false);
  readonly error = signal('');
  readonly report = signal<StaffAppointmentsReport | null>(null);

  from = this.daysAgo(7);
  to = this.today();
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
    this.api.report<StaffAppointmentsReport>('staff-appointments', {
      from: this.from,
      to: this.to,
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
        this.error.set(this.api.errorText(error, 'Unable to load staff appointment report'));
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
    const headers = ['Name', 'Type', 'Appointment Count', 'Appointment Price', 'Completed', 'Cancel', 'Not Came', 'Avg Value'];
    const rows = this.rows().map((row) => [row.name, row.type, row.appointmentCount, row.appointmentPrice, row.completed, row.cancelled, row.notCame, row.averagePrice]);
    this.downloadCsv('staff-appointments-report.csv', [headers, ...rows]);
  }

  branchLabel(): string {
    return this.branchId || 'All allowed branches';
  }

  numberValue(value: unknown): number {
    return Number(value || 0);
  }

  initials(value = ''): string {
    const parts = String(value || 'S').trim().split(/\s+/).filter(Boolean);
    return ((parts[0]?.[0] || 'S') + (parts.length > 1 ? parts.at(-1)?.[0] || '' : '')).toUpperCase();
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
