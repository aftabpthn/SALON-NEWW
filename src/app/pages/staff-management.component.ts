import { CommonModule, DecimalPipe } from '@angular/common';
import { Component, OnInit, computed, signal } from '@angular/core';
import { FormsModule, ReactiveFormsModule, UntypedFormBuilder, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { ApiRecord, ApiService } from '../core/api.service';
import { StateComponent } from '../shared/ui/state/state.component';
import { AuraKpiCardComponent } from '../shared/ui/aura-kpi-card/aura-kpi-card.component';
import { AuraMoneyPipe } from '../shared/pipes/aura-money.pipe';

type StaffWorkspacePanel = 'overview' | 'directory' | 'actions' | 'payroll' | 'runs';

type StaffQuickLink = {
  label: string;
  path: string;
  description: string;
  badge?: string;
  queryParams?: ApiRecord;
};

type StaffDirectoryRow = ApiRecord & {
  id: string;
  name: string;
  role: string;
  branchId: string;
  status: string;
  assignedServices: number;
  quickLinks: StaffQuickLink[];
  searchText: string;
};

@Component({
  selector: 'app-staff-management',
  standalone: true,
  imports: [AuraMoneyPipe, CommonModule, FormsModule, ReactiveFormsModule, RouterLink, DecimalPipe, StateComponent, AuraKpiCardComponent],
  template: `
    <section class="page-stack staff-page">
      <section class="staff-command-center">
        <div class="staff-title-block">
          <h2>Commission, attendance, shifts, performance, incentives and payroll</h2>
        </div>

        <form class="staff-filter-bar" [formGroup]="filterForm" (ngSubmit)="load()">
          <label class="field"><span>Start</span><input type="date" formControlName="periodStart" /></label>
          <label class="field"><span>End</span><input type="date" formControlName="periodEnd" /></label>
          <label class="field">
            <span>Branch</span>
            <select formControlName="branchId">
              <option value="">All branches</option>
              <option *ngFor="let branch of branches()" [value]="branch.id">{{ branch.name }}</option>
            </select>
          </label>
          <button class="primary-button" type="submit">Refresh</button>
        </form>

        <div class="hero-actions staff-command-actions">
          <a class="primary-button" routerLink="/staff-os/staff-list" [queryParams]="{ add: '1' }">Add staff</a>
          <button class="ghost-button" type="button" (click)="runCommission()">Run commission</button>
          <button class="primary-button" type="button" (click)="exportPayroll()">Export payroll</button>
        </div>
      </section>

      <app-state [loading]="loading()" [error]="error()"></app-state>

      <ng-container *ngIf="summary() as summary">
        <section class="staff-bridge-strip" aria-label="Staff connected business flows">
          <a class="staff-bridge-card" *ngFor="let item of bridgeLinks" [routerLink]="item.path">
            <span>{{ item.label }}</span>
            <strong>{{ item.badge }}</strong>
            <small>{{ item.description }}</small>
          </a>
        </section>

        <div class="metrics-grid staff-metrics-grid">
          <aura-kpi-card tone="neutral" target="/kpi-details/staff/total-revenue">
            <span>Total revenue</span>
            <strong>{{ summary.metrics.totalRevenue | auraMoney:'1.0-0' }}</strong>
            <small>{{ summary.metrics.staffCount }} active staff</small>
          </aura-kpi-card>
          <aura-kpi-card tone="neutral" target="/kpi-details/staff/commission">
            <span>Commission</span>
            <strong>{{ summary.metrics.totalCommission | auraMoney:'1.0-0' }}</strong>
            <small>{{ summary.commission.entries.length }} commission lines</small>
          </aura-kpi-card>
          <aura-kpi-card tone="neutral" target="/kpi-details/staff/incentives">
            <span>Incentives</span>
            <strong>{{ summary.metrics.totalIncentives | auraMoney:'1.0-0' }}</strong>
          </aura-kpi-card>
          <aura-kpi-card tone="neutral" target="/kpi-details/staff/average-score">
            <span>Average score</span>
            <strong>{{ summary.metrics.averageScore | number: '1.0-1' }}</strong>
          </aura-kpi-card>
          <aura-kpi-card tone="neutral" target="/kpi-details/staff/present-days">
            <span>Present days</span>
            <strong>{{ summary.attendance.presentDays }}</strong>
            <small>{{ summary.attendance.overtimeMinutes }} overtime minutes</small>
          </aura-kpi-card>
          <aura-kpi-card tone="neutral" target="/kpi-details/staff/planned-shifts">
            <span>Planned shifts</span>
            <strong>{{ summary.metrics.scheduledShifts }}</strong>
          </aura-kpi-card>
        </div>

        <section class="staff-workspace-card">
          <div class="staff-workspace-tabs" role="tablist" aria-label="Staff workspace sections">
            <button type="button" [class.active]="activePanel() === 'overview'" (click)="activePanel.set('overview')">Overview</button>
            <button type="button" [class.active]="activePanel() === 'directory'" (click)="activePanel.set('directory')">Staff Directory</button>
            <button type="button" [class.active]="activePanel() === 'actions'" (click)="activePanel.set('actions')">Attendance & shifts</button>
            <button type="button" [class.active]="activePanel() === 'payroll'" (click)="activePanel.set('payroll')">Payroll</button>
            <button type="button" [class.active]="activePanel() === 'runs'" (click)="activePanel.set('runs')">Recent runs</button>
          </div>

          <div class="staff-workspace-body" [ngSwitch]="activePanel()">
            <div class="staff-overview-grid" *ngSwitchCase="'overview'">
              <section class="panel compact-panel">
                <div class="section-title compact-title">
                  <div>
                    <h2>Recommendations</h2>
                  </div>
                </div>
                <div class="staff-insight-list">
                  <article *ngFor="let insight of summary.insights">
                    <strong>{{ insight }}</strong>
                    <span>Generated from saved operational data</span>
                  </article>
                </div>
              </section>

              <section class="panel compact-panel">
                <div class="section-title compact-title"><h2>Performance ranking</h2></div>
                <div class="table-wrap compact-scroll">
                  <table>
                    <thead>
                      <tr><th>Staff</th><th>Score</th><th>Revenue</th><th>Bookings</th><th>Efficiency</th><th>Attendance</th></tr>
                    </thead>
                    <tbody>
                      <tr *ngFor="let person of summary.ranking">
                        <td><strong>{{ person.name }}</strong><small>{{ person.role }}</small></td>
                        <td>{{ person.performanceScore | number: '1.0-1' }}</td>
                        <td>{{ person.revenue | auraMoney:'1.0-0' }}</td>
                        <td>{{ person.bookings }}</td>
                        <td>{{ person.serviceEfficiency | number: '1.0-1' }}%</td>
                        <td>{{ person.attendanceScore | number: '1.0-1' }}%</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </section>

              <section class="panel compact-panel">
                <div class="section-title compact-title"><h2>Incentive calculation</h2></div>
                <div class="rank-list compact-scroll">
                  <article *ngFor="let row of summary.incentives.rows">
                    <div>
                      <strong>{{ row.name }}</strong>
                      <span>{{ row.reason }}</span>
                    </div>
                    <div class="right">
                      <strong>{{ row.incentive | auraMoney:'1.0-0' }}</strong>
                      <small>{{ row.commission | auraMoney:'1.0-0' }} commission</small>
                    </div>
                  </article>
                </div>
              </section>
            </div>

            <div class="staff-directory-grid" *ngSwitchCase="'directory'">
              <section class="panel compact-panel staff-directory-panel">
                <div class="section-title compact-title staff-directory-title">
                  <div>
                    <h2>Search and act on staff</h2>
                  </div>
                  <div class="staff-directory-controls">
                    <label class="staff-search-field">
                      <span>Search</span>
                      <input [ngModel]="staffQuery()" (ngModelChange)="staffQuery.set($event)" placeholder="Name, role, branch, phone" />
                    </label>
                    <a class="primary-button compact-link-button" routerLink="/staff/connected-modules">Connected modules</a>
                  </div>
                </div>
                <div class="table-wrap compact-scroll staff-directory-scroll">
                  <table>
                    <thead>
                      <tr><th>Staff</th><th>Branch</th><th>Performance</th><th>Sales</th><th>Payroll</th></tr>
                    </thead>
                    <tbody>
                      <tr *ngFor="let person of filteredStaffRows(); trackBy: trackStaffRow">
                        <td>
                          <strong>{{ person.name }}</strong>
                          <small>{{ person.role }} · {{ person.status }}</small>
                          <div class="quick-action-list">
                            <a *ngFor="let link of person.quickLinks; trackBy: trackQuickLink" [routerLink]="link.path" [queryParams]="link.queryParams">{{ link.label }}</a>
                          </div>
                        </td>
                        <td>{{ person.branchId || 'All' }}</td>
                        <td>
                          <strong>{{ person.performanceScore | number: '1.0-1' }}</strong>
                          <small>{{ person.assignedServices }} services</small>
                        </td>
                        <td>
                          <strong>{{ person.revenue | auraMoney:'1.0-0' }}</strong>
                          <small>{{ person.bookings || 0 }} bookings</small>
                        </td>
                        <td>
                          <strong>{{ person.commission + person.incentive | auraMoney:'1.0-0' }}</strong>
                          <small>{{ person.presentDays }} present days</small>
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </section>
            </div>

            <div class="dashboard-grid staff-action-grid" *ngSwitchCase="'actions'">
              <section class="form-panel compact-form-panel">
                <h3>Attendance tracking</h3>
                <form [formGroup]="attendanceForm" (ngSubmit)="saveAttendance()">
                  <label class="field">
                    <span>Staff</span>
                    <select formControlName="staffId">
                      <option value="">Select staff</option>
                      <option *ngFor="let person of staff()" [value]="person.id">{{ person.name }}</option>
                    </select>
                  </label>
                  <label class="field"><span>Date</span><input type="date" formControlName="date" /></label>
                  <label class="field">
                    <span>Status</span>
                    <select formControlName="status">
                      <option value="present">Present</option>
                      <option value="late">Late</option>
                      <option value="absent">Absent</option>
                      <option value="half-day">Half day</option>
                    </select>
                  </label>
                  <label class="field"><span>Clock in</span><input type="time" formControlName="clockIn" /></label>
                  <label class="field"><span>Clock out</span><input type="time" formControlName="clockOut" /></label>
                  <label class="field full"><span>Notes</span><textarea formControlName="notes"></textarea></label>
                  <div class="form-actions">
                    <button class="primary-button" type="submit" [disabled]="attendanceForm.invalid || saving()">Save attendance</button>
                  </div>
                </form>
              </section>

              <section class="form-panel compact-form-panel">
                <h3>Shift planner</h3>
                <form [formGroup]="shiftForm" (ngSubmit)="saveShift()">
                  <label class="field">
                    <span>Staff</span>
                    <select formControlName="staffId">
                      <option value="">Select staff</option>
                      <option *ngFor="let person of staff()" [value]="person.id">{{ person.name }}</option>
                    </select>
                  </label>
                  <label class="field">
                    <span>Branch</span>
                    <select formControlName="branchId">
                      <option value="">Select branch</option>
                      <option *ngFor="let branch of branches()" [value]="branch.id">{{ branch.name }}</option>
                    </select>
                  </label>
                  <label class="field"><span>Date</span><input type="date" formControlName="date" /></label>
                  <label class="field"><span>Start</span><input type="time" formControlName="startTime" /></label>
                  <label class="field"><span>End</span><input type="time" formControlName="endTime" /></label>
                  <label class="field"><span>Chair / room</span><input formControlName="chair" /></label>
                  <div class="form-actions">
                    <button class="primary-button" type="submit" [disabled]="shiftForm.invalid || saving()">Plan shift</button>
                  </div>
                </form>
              </section>
            </div>

            <section class="panel compact-panel" *ngSwitchCase="'payroll'">
              <div class="section-title compact-title"><h2>Payroll preview</h2></div>
              <div class="table-wrap compact-scroll payroll-scroll">
                <table>
                  <thead>
                    <tr><th>Staff</th><th>Present</th><th>Minutes</th><th>Revenue</th><th>Commission</th><th>Incentive</th><th>Gross payout</th></tr>
                  </thead>
                  <tbody>
                    <tr *ngFor="let row of summary.payrollPreview">
                      <td><strong>{{ row.name }}</strong><small>{{ row.role }}</small></td>
                      <td>{{ row.presentDays }}</td>
                      <td>{{ row.minutesWorked }}</td>
                      <td>{{ row.revenue | auraMoney:'1.0-0' }}</td>
                      <td>{{ row.commission | auraMoney:'1.0-0' }}</td>
                      <td>{{ row.incentive | auraMoney:'1.0-0' }}</td>
                      <td>{{ row.grossPayout | auraMoney:'1.0-0' }}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <pre class="export-preview compact-export" *ngIf="payrollCsv()">{{ payrollCsv() }}</pre>
            </section>

            <section class="panel compact-panel" *ngSwitchCase="'runs'">
              <div class="section-title compact-title"><h2>Recent commission and payroll runs</h2></div>
              <div class="activity-list compact-scroll">
                <article *ngFor="let run of commissionRuns()">
                  <strong>{{ run.id }} · {{ run.periodStart }} to {{ run.periodEnd }}</strong>
                  <span>{{ run.summary?.totalCommission | auraMoney:'1.0-0' }} commission · {{ run.status }}</span>
                </article>
                <article *ngFor="let item of payrollRuns()">
                  <strong>{{ item.id }} · {{ item.periodStart }} to {{ item.periodEnd }}</strong>
                  <span>{{ item.totals?.grossPayout | auraMoney:'1.0-0' }} payout · {{ item.status }}</span>
                </article>
              </div>
            </section>
          </div>
        </section>
      </ng-container>
    </section>
  `,
  styles: [`
    .staff-page {
      gap: 12px;
    }

    .staff-command-center {
      display: grid;
      grid-template-columns: minmax(260px, 1fr) minmax(420px, 1.15fr) auto;
      gap: 14px;
      align-items: end;
      padding: 14px;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: var(--surface);
      box-shadow: var(--shadow);
    }

    .staff-title-block h2,
    .staff-title-block p {
      margin: 0;
    }

    .staff-title-block p {
      max-width: 720px;
      margin-top: 5px;
      color: var(--muted);
      line-height: 1.35;
    }

    .staff-filter-bar {
      display: grid;
      grid-template-columns: repeat(3, minmax(120px, 1fr)) auto;
      gap: 10px;
      align-items: end;
    }

    .staff-command-actions {
      align-items: end;
    }

    .staff-bridge-strip {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 8px;
    }

    .staff-bridge-card {
      display: grid;
      gap: 3px;
      min-height: 82px;
      padding: 12px;
      border: 1px solid var(--line);
      border-left: 4px solid var(--teal);
      border-radius: 8px;
      background: #fff;
      color: inherit;
      text-decoration: none;
      box-shadow: var(--shadow);
    }

    .staff-bridge-card span,
    .staff-bridge-card small {
      color: var(--muted);
    }

    .staff-bridge-card strong {
      color: var(--ink);
      font-size: 1.2rem;
    }

    .staff-metrics-grid {
      grid-template-columns: repeat(6, minmax(145px, 1fr));
      gap: 8px;
    }

    .staff-workspace-card {
      display: grid;
      overflow: hidden;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: var(--surface);
      box-shadow: var(--shadow);
    }

    .staff-workspace-tabs {
      display: flex;
      gap: 6px;
      align-items: center;
      overflow-x: auto;
      padding: 10px;
      border-bottom: 1px solid var(--line);
      background: #f8fbfb;
    }

    .staff-workspace-tabs button {
      min-height: 34px;
      padding: 0 12px;
      border: 1px solid var(--line);
      border-radius: 999px;
      background: #fff;
      color: var(--muted);
      font-weight: 850;
      white-space: nowrap;
    }

    .staff-workspace-tabs button.active {
      border-color: rgba(75, 18, 56, 0.45);
      background: var(--teal);
      color: #fff;
    }

    .staff-workspace-body {
      padding: 12px;
    }

    .staff-overview-grid {
      display: grid;
      grid-template-columns: minmax(240px, 0.72fr) minmax(430px, 1.18fr) minmax(280px, 0.84fr);
      gap: 12px;
      align-items: stretch;
    }

    .compact-panel,
    .compact-form-panel {
      padding: 12px;
      box-shadow: none;
    }

    .compact-title {
      margin-bottom: 9px;
    }

    .staff-insight-list {
      display: grid;
      gap: 8px;
      max-height: 280px;
      overflow: auto;
    }

    .staff-insight-list article {
      display: grid;
      gap: 3px;
      padding: 10px;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: #fff;
    }

    .staff-insight-list span {
      color: var(--muted);
      font-size: 0.78rem;
    }

    .compact-scroll {
      max-height: 280px;
      overflow: auto;
    }

    .payroll-scroll {
      max-height: 360px;
    }

    .compact-export {
      max-height: 130px;
      margin-top: 10px;
    }

    .staff-action-grid {
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 12px;
    }

    .staff-directory-grid {
      display: block;
    }

    .staff-directory-title {
      display: flex;
      justify-content: space-between;
      gap: 12px;
      align-items: end;
    }

    .staff-directory-controls {
      display: flex;
      gap: 10px;
      align-items: end;
      flex-wrap: wrap;
      justify-content: flex-end;
    }

    .compact-link-button {
      min-height: 40px;
      align-items: center;
      white-space: nowrap;
    }

    .staff-search-field {
      display: grid;
      gap: 4px;
      min-width: 260px;
      color: var(--muted);
      font-weight: 800;
      font-size: 0.74rem;
      text-transform: uppercase;
    }

    .staff-search-field input {
      min-height: 40px;
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 0 12px;
      background: #fff;
      color: var(--ink);
      font-size: 0.92rem;
      text-transform: none;
      font-weight: 650;
    }

    .staff-directory-scroll {
      max-height: min(680px, 70vh);
    }

    .quick-action-list {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      min-width: 0;
      margin-top: 8px;
    }

    .quick-action-list a {
      display: inline-flex;
      align-items: center;
      min-height: 28px;
      padding: 0 8px;
      border: 1px solid rgba(75, 18, 56, 0.22);
      border-radius: 999px;
      background: #F5EEF2;
      color: var(--teal);
      font-size: 0.74rem;
      font-weight: 850;
      text-decoration: none;
    }

    .compact-form-panel form {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 10px;
    }

    .compact-form-panel .form-actions,
    .compact-form-panel .field.full {
      grid-column: 1 / -1;
    }

    .compact-form-panel textarea {
      min-height: 58px;
    }

    @media (max-width: 1280px) {
      .staff-command-center,
      .staff-overview-grid,
      .staff-directory-grid {
        grid-template-columns: 1fr;
      }

      .staff-metrics-grid,
      .staff-bridge-strip {
        grid-template-columns: repeat(3, minmax(0, 1fr));
      }
    }

    @media (max-width: 820px) {
      .staff-filter-bar,
      .staff-action-grid,
      .staff-directory-title,
      .staff-directory-controls,
      .compact-form-panel form {
        grid-template-columns: 1fr;
      }

      .staff-directory-title {
        display: grid;
      }

      .staff-search-field {
        min-width: 0;
      }

      .staff-directory-controls {
        display: grid;
        justify-content: stretch;
      }

      .staff-metrics-grid,
      .staff-bridge-strip {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }
    }

    @media (max-width: 560px) {
      .staff-metrics-grid,
      .staff-bridge-strip {
        grid-template-columns: 1fr;
      }
    }
  `]
})
export class StaffManagementComponent implements OnInit {
  readonly summary = signal<ApiRecord | null>(null);
  readonly staff = signal<ApiRecord[]>([]);
  readonly branches = signal<ApiRecord[]>([]);
  readonly commissionRuns = signal<ApiRecord[]>([]);
  readonly payrollRuns = signal<ApiRecord[]>([]);
  readonly payrollCsv = signal('');
  readonly loading = signal(true);
  readonly saving = signal(false);
  readonly error = signal('');
  readonly activePanel = signal<StaffWorkspacePanel>('overview');
  readonly staffQuery = signal('');

  readonly bridgeLinks: StaffQuickLink[] = [
    { label: 'Appointments', path: '/appointments', badge: 'Calendar', description: 'Book staff-wise slots and availability' },
    { label: 'POS', path: '/pos', badge: 'Billing', description: 'Attach staff to sales and tips' },
    { label: 'Reports', path: '/reports/staff-sales', badge: 'Sales', description: 'Review staff revenue and productivity' },
    { label: 'Dashboard', path: '/dashboard', badge: 'KPI', description: 'Track staff KPIs in command views' }
  ];

  readonly staffDirectoryRows = computed<StaffDirectoryRow[]>(() => {
    const summaryDirectory = (this.summary()?.['directory'] || []) as ApiRecord[];
    const source = summaryDirectory.length ? summaryDirectory : this.staff();
    return source.map((person) => this.toStaffDirectoryRow(person));
  });

  readonly filteredStaffRows = computed<StaffDirectoryRow[]>(() => {
    const term = this.staffQuery().trim().toLowerCase();
    const rows = this.staffDirectoryRows();
    if (!term) return rows;
    return rows.filter((row) => row.searchText.includes(term));
  });

  readonly filterForm = this.fb.group({
    periodStart: [this.defaultStart()],
    periodEnd: [new Date().toISOString().slice(0, 10)],
    branchId: ['']
  });

  readonly attendanceForm = this.fb.group({
    staffId: ['', Validators.required],
    date: [new Date().toISOString().slice(0, 10), Validators.required],
    status: ['present', Validators.required],
    clockIn: ['10:00'],
    clockOut: ['19:00'],
    notes: ['']
  });

  readonly shiftForm = this.fb.group({
    staffId: ['', Validators.required],
    branchId: ['', Validators.required],
    date: [this.tomorrow(), Validators.required],
    startTime: ['10:00', Validators.required],
    endTime: ['19:00', Validators.required],
    chair: ['']
  });

  constructor(private readonly api: ApiService, private readonly fb: UntypedFormBuilder) {}

  ngOnInit(): void {
    this.filterForm.patchValue({ branchId: this.api.selectedBranchId() });
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.error.set('');
    const filters = this.filterForm.value;
    Promise.all([
      firstValueFrom(this.api.list<ApiRecord[]>('staff', { branchId: filters.branchId || this.api.selectedBranchId() })),
      firstValueFrom(this.api.list<ApiRecord[]>('branches')),
      firstValueFrom(this.api.list<ApiRecord>('staff-management/summary', filters)),
      firstValueFrom(this.api.list<ApiRecord>('staff-management/runs', { limit: 5 }))
    ])
      .then(([staff, branches, summary, runs]) => {
        this.staff.set(this.activeStaff(staff || []));
        this.branches.set(branches || []);
        this.summary.set(summary || null);
        this.commissionRuns.set(runs?.commissionRuns || []);
        this.payrollRuns.set(runs?.payrollExports || []);
        this.loading.set(false);
      })
      .catch((error) => {
        this.error.set(this.api.errorText(error, 'Unable to load smart staff management'));
        this.loading.set(false);
      });
  }

  saveAttendance(): void {
    if (this.attendanceForm.invalid) return;
    this.saving.set(true);
    this.api.post('staff-management/attendance', this.attendanceForm.value).subscribe({
      next: () => {
        this.saving.set(false);
        this.load();
      },
      error: (error) => {
        this.error.set(this.api.errorText(error, 'Unable to save attendance'));
        this.saving.set(false);
      }
    });
  }

  saveShift(): void {
    if (this.shiftForm.invalid) return;
    this.saving.set(true);
    this.api.post('staff-management/shifts', this.shiftForm.value).subscribe({
      next: () => {
        this.saving.set(false);
        this.load();
      },
      error: (error) => {
        this.error.set(this.api.errorText(error, 'Unable to plan shift'));
        this.saving.set(false);
      }
    });
  }

  runCommission(): void {
    this.saving.set(true);
    this.api.post('staff-management/commissions/run', this.filterForm.value).subscribe({
      next: () => {
        this.saving.set(false);
        this.load();
      },
      error: (error) => {
        this.error.set(this.api.errorText(error, 'Unable to run commission engine'));
        this.saving.set(false);
      }
    });
  }

  exportPayroll(): void {
    this.saving.set(true);
    this.api.post<ApiRecord>('staff-management/payroll/export', this.filterForm.value).subscribe({
      next: (result) => {
        this.payrollCsv.set(result.csv || '');
        this.saving.set(false);
        this.load();
      },
      error: (error) => {
        this.error.set(this.api.errorText(error, 'Unable to export payroll'));
        this.saving.set(false);
      }
    });
  }

  trackStaffRow(_index: number, person: StaffDirectoryRow): string {
    return person.id;
  }

  trackQuickLink(_index: number, link: StaffQuickLink): string {
    return `${link.path}:${link.label}`;
  }

  private toStaffDirectoryRow(person: ApiRecord): StaffDirectoryRow {
    const id = String(person.id || person.staffId || '');
    const name = String(person.name || person.staffName || 'Unnamed staff');
    const role = String(person.role || person.designation || person.category || 'Staff');
    const branchId = String(person.branchId || '');
    const status = String(person.status || 'active');
    const assignedServices = Array.isArray(person.assignedServices) ? person.assignedServices.length : Number(person.assignedServices || 0);
    const queryParams = { staffId: id, branchId };
    const quickLinks: StaffQuickLink[] = [
      { label: 'Profile', path: '/staff-os/staff-profile', description: 'Open profile', queryParams },
      { label: 'My Work', path: '/staff/my-work', description: 'Open staff-only report', queryParams },
      { label: 'Book', path: '/appointments', description: 'Open calendar', queryParams },
      { label: 'POS', path: '/pos', description: 'Open billing', queryParams },
      { label: 'Roster', path: '/staff-os/roster-calendar', description: 'Open roster', queryParams },
      { label: 'Sales', path: '/reports/staff-sales', description: 'Open report', queryParams },
      { label: 'Payroll', path: '/staff-os/payroll-dashboard', description: 'Open payroll', queryParams }
    ];
    const searchText = [
      id,
      name,
      role,
      branchId,
      status,
      person.shortName,
      person.category,
      person.designation,
      person.phone,
      person.email
    ].filter(Boolean).join(' ').toLowerCase();
    return {
      ...person,
      id,
      name,
      role,
      branchId,
      status,
      assignedServices,
      revenue: Number(person.revenue || 0),
      commission: Number(person.commission || 0),
      incentive: Number(person.incentive || 0),
      presentDays: Number(person.presentDays || 0),
      performanceScore: Number(person.performanceScore || 0),
      quickLinks,
      searchText
    };
  }

  private defaultStart(): string {
    const date = new Date();
    date.setDate(date.getDate() - 29);
    return date.toISOString().slice(0, 10);
  }

  private tomorrow(): string {
    const date = new Date();
    date.setDate(date.getDate() + 1);
    return date.toISOString().slice(0, 10);
  }

  private activeStaff(staff: ApiRecord[]): ApiRecord[] {
    const inactiveStatuses = new Set(['archived', 'blocked', 'deleted', 'inactive', 'suspended', 'terminated']);
    return staff.filter((person) => !inactiveStatuses.has(String(person.status || 'active').trim().toLowerCase()));
  }
}
