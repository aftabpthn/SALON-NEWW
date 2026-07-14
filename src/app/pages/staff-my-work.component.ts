import { CommonModule } from '@angular/common';
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { finalize } from 'rxjs';
import { ApiRecord, ApiService } from '../core/api.service';
import { AuthSessionService } from '../core/auth-session.service';
import { AppStateService } from '../core/state/app-state.service';
import { AuraMoneyPipe } from '../shared/pipes/aura-money.pipe';
import { AuraDatePipe } from '../shared/pipes/aura-date.pipe';

type StaffSelfDashboard = {
  staff: ApiRecord;
  identityIds: string[];
  range: { from: string; to: string; date: string };
  summary: ApiRecord;
  liveAppointments: ApiRecord[];
  todayAppointments: ApiRecord[];
  workReport: ApiRecord[];
  appointments: ApiRecord[];
  sales: ApiRecord[];
};

@Component({
  selector: 'app-staff-my-work',
  standalone: true,
  imports: [AuraDatePipe, AuraMoneyPipe, CommonModule, FormsModule],
  template: `
    <section class="staff-workspace">
      <section class="page-title">
        <div>
          <h1>My Work</h1>
        </div>
        <strong>{{ staffName() }}</strong>
      </section>

      <section class="filters" aria-label="Staff report filters">
        <label>
          <span>Report from</span>
          <input type="date" [ngModel]="fromDate()" (ngModelChange)="fromDate.set($event); load()" />
        </label>
        <label>
          <span>Report to</span>
          <input type="date" [ngModel]="toDate()" (ngModelChange)="toDate.set($event); load()" />
        </label>
        <label>
          <span>Live date</span>
          <input type="date" [ngModel]="liveDate()" (ngModelChange)="liveDate.set($event); load()" />
        </label>
        <label *ngIf="canSelectStaff()">
          <span>View staff</span>
          <select [ngModel]="selectedStaffId()" (ngModelChange)="selectedStaffId.set($event); load()">
            <option value="">Auto select staff</option>
            <option *ngFor="let staff of staffOptions()" [value]="staff.id">{{ staffLabel(staff) }}</option>
          </select>
        </label>
        <span class="identity">Linked IDs: {{ linkedIds() }}</span>
      </section>

      <div class="state error" *ngIf="error()">{{ error() }}</div>
      <div class="state" *ngIf="loading()">Loading your staff report...</div>

      <ng-container *ngIf="dashboard() as data">
        <section class="metrics">
          <article><span>Live now</span><strong>{{ data.summary.liveAppointments || 0 }}</strong></article>
          <article><span>Today</span><strong>{{ data.summary.todayAppointments || 0 }}</strong></article>
          <article><span>Completed</span><strong>{{ data.summary.completedAppointments || 0 }}</strong></article>
          <article><span>Sales</span><strong>{{ data.summary.revenue || 0 | auraMoney:'1.0-0' }}</strong><small>{{ data.summary.salesCount || 0 }} bills</small></article>
        </section>

        <section class="register-panel">
          <header class="register-heading">
            <div>
              <h2>Assigned appointments</h2>
            </div>
            <span>{{ data.range.from | auraDate:'date' }} - {{ data.range.to | auraDate:'date' }}</span>
          </header>
          <div class="register-scroll" *ngIf="data.appointments.length; else noLive">
            <table>
              <thead>
                <tr><th>Date</th><th>Client</th><th>Service</th><th>Chair</th><th>Status</th></tr>
              </thead>
              <tbody>
                <tr *ngFor="let booking of data.appointments">
                  <td><strong>{{ booking.startAt | auraDate:'date' }}</strong></td>
                  <td>{{ booking.clientName }}</td>
                  <td>{{ serviceText(booking) }}</td>
                  <td>{{ booking.chair || 'No chair' }}</td>
                  <td><span class="badge">{{ booking.status }}</span></td>
                </tr>
              </tbody>
            </table>
          </div>
          <ng-template #noLive><div class="empty">No appointment for this staff in selected range.</div></ng-template>
        </section>

        <section class="register-panel">
          <header class="register-heading">
            <div>
              <h2>Completed work</h2>
            </div>
            <span>{{ data.workReport.length }} rows</span>
          </header>
          <div class="register-scroll" *ngIf="data.workReport.length; else noWork">
            <table>
              <thead>
                <tr><th>Time</th><th>Client</th><th>Services</th><th>Status</th></tr>
              </thead>
              <tbody>
                <tr *ngFor="let booking of data.workReport">
                  <td>{{ booking.startAt | auraDate:'date' }} {{ booking.startAt | auraDate:'time' }}</td>
                  <td><strong>{{ booking.clientName }}</strong></td>
                  <td>{{ serviceText(booking) }}</td>
                  <td><span class="badge">{{ booking.status }}</span></td>
                </tr>
              </tbody>
            </table>
          </div>
          <ng-template #noWork><div class="empty">No completed work found in selected range.</div></ng-template>
        </section>

        <section class="register-panel">
          <header class="register-heading">
            <div>
              <h2>Staff-only booking history</h2>
            </div>
            <span>{{ data.appointments.length }} bookings</span>
          </header>
          <div class="register-scroll" *ngIf="data.appointments.length; else noAppointments">
            <table>
              <thead>
                <tr><th>Date</th><th>Client</th><th>Service</th><th>Status</th></tr>
              </thead>
              <tbody>
                <tr *ngFor="let booking of data.appointments">
                  <td>{{ booking.startAt | auraDate:'date' }}</td>
                  <td><strong>{{ booking.clientName }}</strong></td>
                  <td>{{ serviceText(booking) }}</td>
                  <td><span class="badge">{{ booking.status }}</span></td>
                </tr>
              </tbody>
            </table>
          </div>
          <ng-template #noAppointments><div class="empty">No appointment data for this staff in selected range.</div></ng-template>
          <footer class="register-footer">
            <span>{{ data.appointments.length ? 1 : 0 }} to {{ data.appointments.length }} of {{ data.appointments.length }}</span>
            <span>Page 1 of 1</span>
          </footer>
        </section>
      </ng-container>
    </section>
  `,
  styles: [`
    .staff-workspace { display: grid; gap: 8px; padding: 8px; color: #1d2430; background: #f0f2f5; min-height: calc(100vh - 20px); }
    .command-bar { min-height: 58px; background: #111827; color: #f8fafc; display: flex; align-items: center; gap: 12px; padding: 10px 18px; border-bottom: 1px solid #d4dee8; }
    .brand-mark { width: 34px; height: 34px; border-radius: 8px; background: #6654d9; display: grid; place-items: center; font-weight: 900; }
    .command-bar p { margin: 0; color: #7f8da3; font-size: 10px; font-weight: 900; text-transform: uppercase; }
    .command-bar strong { display: block; font-size: 16px; }
    .top-actions { margin-left: auto; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
    .top-actions a, .top-actions button, .quick-buttons a, .quick-buttons button { min-height: 30px; border: 1px solid #c6d7ea; background: #fff; color: #0963a6; border-radius: 3px; padding: 6px 12px; font-weight: 900; text-decoration: none; cursor: pointer; }
    .top-actions span { color: #9aa8bd; font-size: 12px; }
    .quick-actions { display: grid; grid-template-columns: 1fr auto; gap: 10px; padding: 18px 14px 10px; background: #fff; border: 1px solid #d9e1ea; }
    .branch-label { grid-row: span 2; align-self: center; font-weight: 900; text-transform: lowercase; }
    .quick-buttons { display: flex; gap: 8px; justify-content: flex-end; flex-wrap: wrap; }
    .quick-actions > select { grid-column: 2; min-width: min(620px, 100%); }
    .page-title { display: flex; align-items: end; justify-content: space-between; gap: 16px; padding: 14px; background: #fff; border: 1px solid #d9e1ea; }
    .page-title h1, .register-heading h2 { margin: 0; letter-spacing: 0; }
    .page-title p { margin: 6px 0 0; color: #38506d; font-size: 13px; }
    .page-title strong { color: #38506d; text-align: right; }
    .filters { display: grid; grid-template-columns: repeat(4, minmax(150px, 1fr)) minmax(180px, 1.2fr); gap: 8px; align-items: end; padding: 12px 14px; background: #fff; border: 1px solid #d9e1ea; }
    label { display: grid; gap: 5px; color: #5d6f87; font-size: 11px; font-weight: 900; }
    input, select { border: 1px solid #bdcfe2; border-radius: 3px; min-height: 34px; padding: 7px 10px; font: inherit; color: #1d2430; background: #fff; min-width: 0; }
    .identity { align-self: end; color: #4c5f78; font-size: 12px; overflow-wrap: anywhere; }
    .state { margin: 12px 14px 0; border: 1px solid #cbd5e1; background: #fff; color: #4c5f78; padding: 12px; }
    .error { color: #b42318; border-color: #f1b5aa; background: #fff6f4; }
    .metrics { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 0; padding: 0 14px 12px; background: #fff; border-left: 1px solid #d9e1ea; border-right: 1px solid #d9e1ea; border-bottom: 1px solid #d9e1ea; }
    .metrics article { display: grid; gap: 3px; min-height: 74px; padding: 12px 14px; border: 1px solid #d9e1ea; border-left: 0; border-top: 3px solid #0a78b6; }
    .metrics article:first-child { border-left: 1px solid #d9e1ea; }
    .metrics span, .metrics small { color: #64748b; font-weight: 800; font-size: 12px; }
    .metrics strong { font-size: 22px; line-height: 1; }
    .register-panel { background: #fff; border: 1px solid #d9e1ea; padding: 12px 14px; display: grid; gap: 10px; }
    .register-heading { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
    .eyebrow { margin: 0 0 3px; color: #5d6f87; font-size: 11px; font-weight: 900; text-transform: uppercase; }
    .register-heading > span { color: #5d6f87; font-weight: 800; font-size: 12px; }
    .register-scroll { overflow: auto; border: 1px solid #d9e1ea; }
    table { width: 100%; min-width: 860px; border-collapse: collapse; font-size: 13px; }
    th { background: #f1f5f9; color: #4b5f78; text-align: left; font-size: 11px; text-transform: uppercase; padding: 10px 12px; border-bottom: 1px solid #d9e1ea; }
    td { padding: 12px; border-bottom: 1px solid #d9e1ea; vertical-align: top; }
    tbody tr:hover { background: #f5fbff; }
    .badge { display: inline-flex; border-radius: 3px; background: #dff7e8; color: #087443; font-size: 12px; font-weight: 900; padding: 5px 9px; }
    .empty { border: 1px dashed #cbd5e1; color: #64748b; padding: 18px; text-align: center; }
    .register-footer { display: flex; justify-content: flex-end; gap: 18px; color: #64748b; font-size: 12px; }
    @media (max-width: 900px) {
      .command-bar, .page-title, .register-heading { align-items: flex-start; flex-direction: column; }
      .top-actions { margin-left: 0; }
      .quick-actions, .filters, .metrics { grid-template-columns: 1fr; }
      .quick-actions > select { grid-column: auto; min-width: 0; }
      .quick-buttons { justify-content: flex-start; }
      .metrics article, .metrics article:first-child { border-left: 1px solid #d9e1ea; }
    }
  `]
})
export class StaffMyWorkComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly session = inject(AuthSessionService);
  private readonly appState = inject(AppStateService);
  private readonly route = inject(ActivatedRoute);

  readonly dashboard = signal<StaffSelfDashboard | null>(null);
  readonly staffOptions = signal<ApiRecord[]>([]);
  readonly selectedStaffId = signal('');
  readonly loading = signal(false);
  readonly error = signal('');
  readonly liveDate = signal(this.today());
  readonly fromDate = signal(this.shiftDate(-30));
  readonly toDate = signal(this.shiftDate(30));

  readonly staffName = computed(() => {
    const data = this.dashboard();
    return String(data?.staff?.fullName || this.session.currentUser()?.name || 'Staff');
  });
  readonly linkedIds = computed(() => this.dashboard()?.identityIds?.join(', ') || this.session.currentUser()?.staffId || 'Not linked');
  readonly canSelectStaff = computed(() => ['superAdmin', 'owner', 'admin', 'manager'].includes(this.userRole()));

  ngOnInit(): void {
    this.selectedStaffId.set(this.route.snapshot.queryParamMap.get('staffId') || this.session.currentUser()?.staffId || '');
    if (this.canSelectStaff()) {
      this.loadStaffOptions();
      return;
    }
    this.load();
  }

  loadStaffOptions(): void {
    this.api.list<ApiRecord[]>('staff-os/staff', {
      branchId: this.appState.selectedBranchId(),
      status: 'active',
      limit: 200
    }).subscribe({
      next: (staff) => {
        this.staffOptions.set(staff || []);
        if (!this.selectedStaffId() && staff?.[0]?.id) {
          this.selectedStaffId.set(String(staff[0].id));
        }
        this.load();
      },
      error: () => this.load()
    });
  }

  load(): void {
    this.loading.set(true);
    this.error.set('');
    this.api.list<StaffSelfDashboard>('staff-self/dashboard', {
      staffId: this.selectedStaffId() || '',
      from: this.fromDate(),
      to: this.toDate(),
      date: this.liveDate()
    }).pipe(finalize(() => this.loading.set(false))).subscribe({
      next: (data) => this.dashboard.set(data),
      error: (error) => this.error.set(this.api.errorText(error, 'Unable to load staff work report'))
    });
  }

  staffLabel(staff: ApiRecord): string {
    return String(staff.fullName || staff.name || staff.firstName || staff.id || 'Staff');
  }

  serviceText(booking: ApiRecord): string {
    const names = Array.isArray(booking.serviceNames) ? booking.serviceNames.filter(Boolean) : [];
    return names.length ? names.join(', ') : 'Service not mapped';
  }

  private today(): string {
    return new Date().toISOString().slice(0, 10);
  }

  private shiftDate(days: number): string {
    const date = new Date();
    date.setDate(date.getDate() + days);
    return date.toISOString().slice(0, 10);
  }

  private userRole(): string {
    return String(this.session.currentUser()?.role || this.appState.userRole() || '').trim();
  }
}
