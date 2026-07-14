import { CommonModule, DecimalPipe } from '@angular/common';
import { Component, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { ApiRecord, ApiService } from '../core/api.service';
import { StateComponent } from '../shared/ui/state/state.component';
import { AuraMoneyPipe } from '../shared/pipes/aura-money.pipe';
import { AuraDatePipe } from '../shared/pipes/aura-date.pipe';

type StaffSection = 'directory' | 'performance' | 'incentives' | 'payroll' | 'schedule' | 'attendance';

@Component({
  selector: 'app-staff-section',
  standalone: true,
  imports: [AuraDatePipe, AuraMoneyPipe, CommonModule, FormsModule, RouterLink, DecimalPipe, StateComponent],
  template: `
    <section class="page-stack">
      <div class="module-hero compact-hero">
        <div>
          <h2>{{ pageTitle() }}</h2>
          <p>{{ pageSubtitle() }}</p>
        </div>
        <div class="hero-actions">
          <button class="ghost-button" type="button" *ngIf="section() === 'schedule'" (click)="moveScheduleWeek(-7)">Previous week</button>
          <button class="ghost-button" type="button" *ngIf="section() === 'schedule'" (click)="setCurrentWeek()">Current week</button>
          <button class="ghost-button" type="button" *ngIf="section() === 'schedule'" (click)="moveScheduleWeek(7)">Next week</button>
          <button class="ghost-button" type="button" (click)="load()" [disabled]="loading()">Refresh</button>
          <button class="primary-button" type="button" *ngIf="section() === 'incentives'" (click)="runCommission()" [disabled]="saving()">Run commission</button>
          <button class="primary-button" type="button" *ngIf="section() === 'payroll'" (click)="exportPayroll()" [disabled]="saving()">Export payroll</button>
          <a class="primary-button" *ngIf="section() === 'schedule'" routerLink="/staff-os/staff-list">Plan shift</a>
          <a class="ghost-button" routerLink="/staff-os/staff-list">Back to staff</a>
        </div>
      </div>

      <app-state [loading]="loading()" [error]="error()"></app-state>

      <section class="form-panel section-filter-panel">
        <h3>Scope</h3>
        <form class="section-filters" (ngSubmit)="load()">
          <label class="field"><span>Period start</span><input type="date" name="periodStart" [(ngModel)]="periodStart" /></label>
          <label class="field"><span>Period end</span><input type="date" name="periodEnd" [(ngModel)]="periodEnd" /></label>
          <label class="field">
            <span>Branch</span>
            <select name="branchId" [(ngModel)]="branchId">
              <option value="">All branches</option>
              <option *ngFor="let branch of branches()" [value]="branch.id">{{ branch.name }}</option>
            </select>
          </label>
          <div class="form-actions"><button class="primary-button" type="submit">Apply</button></div>
        </form>
      </section>

      <div class="metrics-grid" *ngIf="summary() as data">
        <article class="metric-card teal">
          <span>Staff count</span>
          <strong>{{ data.metrics?.staffCount || staff().length }}</strong>
        </article>
        <article class="metric-card amber">
          <span>Revenue</span>
          <strong>{{ (data.metrics?.totalRevenue || 0) | auraMoney:'1.0-0' }}</strong>
        </article>
        <article class="metric-card green">
          <span>Commission</span>
          <strong>{{ (data.metrics?.totalCommission || 0) | auraMoney:'1.0-0' }}</strong>
          <small>{{ data.commission?.entries?.length || 0 }} lines</small>
        </article>
        <article class="metric-card blue">
          <span>Average score</span>
          <strong>{{ (data.metrics?.averageScore || 0) | number: '1.0-1' }}</strong>
        </article>
      </div>

      <ng-container [ngSwitch]="section()">
        <section class="panel" *ngSwitchCase="'directory'">
          <div class="section-title">
            <div><h2>Staff directory full page</h2></div>
            <a class="primary-button" routerLink="/staff-os/staff-list">+ Add staff</a>
          </div>
          <div class="section-toolbar">
            <label class="field compact-field">
              <span>Search</span>
              <input name="directorySearch" [(ngModel)]="directorySearch" placeholder="Name, phone, email, code" />
            </label>
            <label class="field compact-field">
              <span>Role</span>
              <select name="directoryRoleFilter" [(ngModel)]="directoryRoleFilter">
                <option value="">All roles</option>
                <option *ngFor="let role of roleOptions()" [value]="role">{{ role }}</option>
              </select>
            </label>
            <label class="field compact-field">
              <span>Status</span>
              <select name="directoryStatusFilter" [(ngModel)]="directoryStatusFilter">
                <option value="">All status</option>
                <option value="active">Active</option>
                <option value="on-leave">On leave</option>
                <option value="inactive">Inactive</option>
              </select>
            </label>
            <button class="ghost-button" type="button" (click)="resetDirectoryFilters()" [disabled]="!directorySearch && !directoryRoleFilter && !directoryStatusFilter">Reset</button>
          </div>
          <div class="ai-factor-grid">
            <article>
              <span>Best staff</span>
              <strong>{{ aiRecommendedCount() }}</strong>
            </article>
            <article>
              <span>Burnout warnings</span>
              <strong>{{ aiBurnoutCount() }}</strong>
            </article>
            <article>
              <span>Absent recovery</span>
              <strong>{{ aiRecoveryCount() }}</strong>
            </article>
            <article>
              <span>Workload balance</span>
              <strong>{{ aiBalancedCount() }}</strong>
            </article>
            <article>
              <span>Target recovery</span>
              <strong>{{ aiTargetGapTotal() | auraMoney:'1.0-0' }}</strong>
            </article>
            <article>
              <span>Low utilization</span>
              <strong>{{ aiLowUtilizationCount() }}</strong>
            </article>
          </div>
          <div class="table-wrap tall-table">
            <table>
              <thead>
                <tr><th>Code</th><th>Name</th><th>Role</th><th>Branch</th><th>Status</th><th>Services</th><th>Target</th><th>Score</th><th>AI fit</th><th>Burnout</th><th>Recovery</th><th>Commission</th><th>Actions</th></tr>
              </thead>
              <tbody>
                <tr *ngFor="let person of filteredDirectoryStaff()">
                  <td>{{ person.employeeCode || person.id }}</td>
                  <td><strong>{{ person.name }}</strong><small>{{ person.phone || 'No phone' }} · {{ person.email || 'No email' }}</small></td>
                  <td>{{ person.designation || person.role }}<small>{{ person.department || 'Service' }}</small></td>
                  <td>{{ branchNamesForStaff(person) }}</td>
                  <td><span class="badge" [class.warning]="person.status === 'on-leave'" [class.danger]="person.status === 'inactive'">{{ person.status || 'active' }}</span></td>
                  <td>{{ assignedServiceNames(person).slice(0, 3).join(', ') || 'Any service' }}<small>{{ assignedServiceNames(person).length }} assigned</small></td>
                  <td>{{ targetProgress(person) }}%<small>{{ targetLabel(person) }}</small></td>
                  <td>{{ rankingRow(person)?.performanceScore || 0 | number: '1.0-1' }}</td>
                  <td>
                    <span class="badge" [class.warning]="staffAiFactors(person).bestForBooking === 'conditional'" [class.danger]="staffAiFactors(person).bestForBooking === 'unavailable'">{{ staffAiFactors(person).bestForBooking }}</span>
                    <small>{{ staffAiFactors(person).recommendation }}</small>
                  </td>
                  <td>
                    <span class="badge" [class.warning]="staffAiFactors(person).burnoutRisk === 'medium'" [class.danger]="staffAiFactors(person).burnoutRisk === 'high'">{{ staffAiFactors(person).burnoutRisk }}</span>
                    <small>{{ staffAiFactors(person).workloadBalance }}</small>
                  </td>
                  <td>{{ staffAiFactors(person).absentRecoveryPlan }}<small>{{ staffAiFactors(person).lowUtilizationPlan }}</small></td>
                  <td>{{ commissionLabel(person.commissionRule) }}</td>
                  <td><a class="ghost-button mini" [routerLink]="['/staff', person.id]">Open 360</a></td>
                </tr>
              </tbody>
            </table>
            <p class="empty-row" *ngIf="!filteredDirectoryStaff().length">No staff found for this scope.</p>
          </div>
        </section>

        <section class="panel" *ngSwitchCase="'performance'">
          <div class="section-title"><div><h2>Performance ranking full page</h2></div></div>
          <div class="table-wrap tall-table">
            <table>
              <thead><tr><th>Rank</th><th>Staff</th><th>Score</th><th>Revenue</th><th>Bookings</th><th>Efficiency</th><th>Attendance</th><th>Open</th></tr></thead>
              <tbody>
                <tr *ngFor="let person of rankingRows(); let i = index">
                  <td><strong>#{{ i + 1 }}</strong></td>
                  <td><strong>{{ person.name }}</strong><small>{{ person.role }}</small></td>
                  <td>{{ person.performanceScore | number: '1.0-1' }}</td>
                  <td>{{ person.revenue | auraMoney:'1.0-0' }}</td>
                  <td>{{ person.bookings }}</td>
                  <td>{{ person.serviceEfficiency | number: '1.0-1' }}%</td>
                  <td>{{ person.attendanceScore | number: '1.0-1' }}%</td>
                  <td><a class="ghost-button mini" [routerLink]="['/staff', person.staffId || person.id]">360</a></td>
                </tr>
              </tbody>
            </table>
            <p class="empty-row" *ngIf="!rankingRows().length">No performance ranking available.</p>
          </div>
        </section>

        <section class="panel" *ngSwitchCase="'incentives'">
          <div class="section-title">
            <div><h2>Incentive calculation full page</h2></div>
            <button class="primary-button" type="button" (click)="runCommission()" [disabled]="saving()">Run commission</button>
          </div>
          <div class="rank-list wide-rank-list">
            <article *ngFor="let row of incentiveRows()">
              <div>
                <strong>{{ row.name }}</strong>
                <span>{{ row.reason }}</span>
              </div>
              <div class="right">
                <strong>{{ row.incentive | auraMoney:'1.0-0' }}</strong>
                <small>{{ row.commission | auraMoney:'1.0-0' }} commission</small>
              </div>
            </article>
            <article *ngIf="!incentiveRows().length"><strong>No incentive rows</strong><span>Run staff performance for this period.</span></article>
          </div>
        </section>

        <section class="panel" *ngSwitchCase="'payroll'">
          <div class="section-title"><div><h2>Payroll preview full page</h2></div></div>
          <div class="section-tabs">
            <button type="button" [class.active]="payrollMode === 'employee'" (click)="payrollMode = 'employee'">Employee wise</button>
            <button type="button" [class.active]="payrollMode === 'invoice'" (click)="payrollMode = 'invoice'">Invoice wise</button>
            <button type="button" [class.active]="payrollMode === 'task'" (click)="payrollMode = 'task'">Task wise</button>
          </div>
          <div class="table-wrap tall-table" [ngSwitch]="payrollMode">
            <table *ngSwitchCase="'employee'">
              <thead><tr><th>Staff</th><th>Present</th><th>Minutes</th><th>Revenue</th><th>Commission</th><th>Incentive</th><th>Gross payout</th><th>Open</th></tr></thead>
              <tbody>
                <tr *ngFor="let row of payrollRows()">
                  <td><strong>{{ row.name }}</strong><small>{{ row.role }}</small></td>
                  <td>{{ row.presentDays }}</td>
                  <td>{{ row.minutesWorked }}</td>
                  <td>{{ row.revenue | auraMoney:'1.0-0' }}</td>
                  <td>{{ row.commission | auraMoney:'1.0-0' }}</td>
                  <td>{{ row.incentive | auraMoney:'1.0-0' }}</td>
                  <td><strong>{{ row.grossPayout | auraMoney:'1.0-0' }}</strong></td>
                  <td><a class="ghost-button mini" [routerLink]="['/staff', row.staffId || row.id]">360</a></td>
                </tr>
              </tbody>
            </table>
            <table *ngSwitchCase="'invoice'">
              <thead><tr><th>Invoice / Sale</th><th>Staff</th><th>Item</th><th>Type</th><th>Line amount</th><th>Percent</th><th>Commission</th><th>Date</th></tr></thead>
              <tbody>
                <tr *ngFor="let row of commissionEntries()">
                  <td>{{ row.saleId || row.invoiceId || '—' }}</td>
                  <td><strong>{{ row.staffName || staffName(row.staffId) }}</strong></td>
                  <td>{{ row.itemName || 'Service line' }}</td>
                  <td>{{ row.itemType || 'service' }}</td>
                  <td>{{ row.lineAmount | auraMoney:'1.0-0' }}</td>
                  <td>{{ row.percent || 0 }}%</td>
                  <td><strong>{{ row.commission | auraMoney:'1.0-0' }}</strong></td>
                  <td>{{ row.createdAt | auraDate:'date' }}</td>
                </tr>
              </tbody>
            </table>
            <table *ngSwitchCase="'task'">
              <thead><tr><th>Task type</th><th>Lines</th><th>Revenue</th><th>Commission</th><th>Top staff</th></tr></thead>
              <tbody>
                <tr *ngFor="let row of payrollTaskRows()">
                  <td><strong>{{ row.type }}</strong></td>
                  <td>{{ row.lines }}</td>
                  <td>{{ row.revenue | auraMoney:'1.0-0' }}</td>
                  <td><strong>{{ row.commission | auraMoney:'1.0-0' }}</strong></td>
                  <td>{{ row.topStaff || '—' }}</td>
                </tr>
              </tbody>
            </table>
            <p class="empty-row" *ngIf="payrollMode === 'employee' && !payrollRows().length">No payroll preview available.</p>
            <p class="empty-row" *ngIf="payrollMode === 'invoice' && !commissionEntries().length">No invoice-wise commission lines available.</p>
            <p class="empty-row" *ngIf="payrollMode === 'task' && !payrollTaskRows().length">No task-wise payroll lines available.</p>
          </div>
          <pre class="export-preview" *ngIf="payrollCsv()">{{ payrollCsv() }}</pre>
        </section>

        <section class="panel" *ngSwitchCase="'schedule'">
          <div class="section-title">
            <div>
              <h2>Employee schedule week view</h2>
            </div>
            <a class="ghost-button" routerLink="/staff-os/staff-list">Open shift planner</a>
          </div>
          <div class="schedule-board">
            <div class="schedule-row schedule-head">
              <strong>Employees</strong>
              <strong *ngFor="let day of weekDays()">{{ day.label }}<small>{{ day.date }}</small></strong>
            </div>
            <div class="schedule-row" *ngFor="let person of staff()">
              <div class="employee-cell">
                <strong>{{ person.name }}</strong>
                <small>{{ person.role }} · {{ branchNamesForStaff(person) }}</small>
              </div>
              <div class="shift-cell" *ngFor="let day of weekDays()" [class.off]="!shiftFor(person, day.date)" [class.weekly-off]="!shiftFor(person, day.date) && isWeeklyOff(person, day.date)">
                <ng-container *ngIf="shiftFor(person, day.date) as shift; else noShift">
                  <strong>{{ shift.startTime }} - {{ shift.endTime }}</strong>
                  <small>{{ branchName(shift.branchId) }} · {{ shift.chair || 'No chair' }}</small>
                </ng-container>
                <ng-template #noShift>
                  <strong>{{ isWeeklyOff(person, day.date) ? 'Weekly off' : 'Not scheduled' }}</strong>
                  <small>{{ isWeeklyOff(person, day.date) ? 'Roster protected' : 'Planner required' }}</small>
                </ng-template>
              </div>
            </div>
            <p class="empty-row" *ngIf="!staff().length">No staff found for schedule view.</p>
          </div>
        </section>

        <section class="panel" *ngSwitchCase="'attendance'">
          <div class="section-title">
            <div>
              <h2>Employee attendance summary</h2>
            </div>
            <a class="ghost-button" routerLink="/staff-os/staff-list">Open attendance form</a>
          </div>
          <div class="table-wrap tall-table">
            <table>
              <thead>
                <tr>
                  <th>Name</th><th>Code</th><th>Working days</th><th>Present days</th><th>Leave balance</th><th>Weekly off</th><th>Late</th><th>Penalty</th><th>Revised balance</th><th>Comments</th>
                </tr>
              </thead>
              <tbody>
                <tr *ngFor="let person of staff()">
                  <td><strong>{{ person.name }}</strong><small>{{ person.role }}</small></td>
                  <td>{{ person.employeeCode || person.id }}</td>
                  <td>{{ workingDaysFor(person) }}</td>
                  <td>{{ presentDaysFor(person) }}</td>
                  <td>{{ leaveBalanceFor(person) }}</td>
                  <td>{{ weeklyOffs(person).length || 0 }}</td>
                  <td>{{ lateDaysFor(person) }}</td>
                  <td>{{ penaltyFor(person) | auraMoney:'1.0-0' }}</td>
                  <td>{{ revisedLeaveBalanceFor(person) }}</td>
                  <td>{{ attendanceComment(person) }}</td>
                </tr>
              </tbody>
            </table>
            <p class="empty-row" *ngIf="!staff().length">No staff found for attendance summary.</p>
          </div>
        </section>
      </ng-container>
    </section>
  `,
  styles: [`
    .compact-hero { align-items: center; }
    .section-filters {
      display: grid;
      grid-template-columns: repeat(3, minmax(170px, 1fr)) auto;
      gap: 12px;
      align-items: end;
    }
    .tall-table { max-height: 68vh; overflow: auto; }
    .wide-rank-list { max-height: 68vh; overflow: auto; }
    .section-toolbar {
      display: grid;
      grid-template-columns: minmax(220px, 1fr) minmax(160px, 220px) minmax(160px, 220px) auto;
      gap: 12px;
      align-items: end;
      margin-bottom: 14px;
    }
    .ai-factor-grid {
      display: grid;
      grid-template-columns: repeat(6, minmax(130px, 1fr));
      gap: 10px;
      margin-bottom: 14px;
    }
    .ai-factor-grid article {
      min-height: 82px;
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 10px 12px;
      background: var(--surface);
    }
    .ai-factor-grid span {
      display: block;
      color: var(--muted);
      font-size: 0.72rem;
      font-weight: 900;
      letter-spacing: 0.06em;
      text-transform: uppercase;
    }
    .ai-factor-grid strong {
      display: block;
      margin-top: 4px;
      color: var(--ink);
      font-size: 1.35rem;
      line-height: 1.1;
    }
    .ai-factor-grid small {
      display: block;
      margin-top: 4px;
      color: var(--muted);
      line-height: 1.3;
    }
    .compact-field { margin: 0; }
    .section-tabs {
      display: inline-flex;
      gap: 8px;
      padding: 6px;
      margin-bottom: 14px;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: var(--surface-2);
    }
    .section-tabs button {
      min-height: 34px;
      border: 0;
      border-radius: 7px;
      padding: 0 14px;
      background: transparent;
      color: var(--muted);
      font-weight: 700;
      cursor: pointer;
    }
    .section-tabs button.active {
      background: var(--surface);
      color: var(--ink);
      box-shadow: var(--shadow-soft);
    }
    .schedule-board {
      min-width: 980px;
      overflow: auto;
      border: 1px solid var(--line);
      border-radius: 8px;
    }
    .schedule-row {
      display: grid;
      grid-template-columns: 190px repeat(7, minmax(118px, 1fr));
      border-bottom: 1px solid var(--line);
    }
    .schedule-row:last-child { border-bottom: 0; }
    .schedule-head {
      position: sticky;
      top: 0;
      z-index: 1;
      background: var(--surface-2);
      text-transform: uppercase;
      font-size: 0.76rem;
      letter-spacing: 0.04em;
    }
    .schedule-head strong,
    .employee-cell,
    .shift-cell {
      min-height: 72px;
      padding: 10px;
      border-right: 1px solid var(--line);
    }
    .schedule-head strong:last-child,
    .shift-cell:last-child { border-right: 0; }
    .schedule-head small,
    .employee-cell small,
    .shift-cell small {
      display: block;
      margin-top: 4px;
      color: var(--muted);
      text-transform: none;
      letter-spacing: 0;
    }
    .shift-cell {
      background: #d9f8ce;
      color: #164e24;
    }
    .shift-cell.off {
      background: #F4EDF1;
      color: var(--muted);
    }
    .shift-cell.weekly-off {
      background: #f4ecff;
      color: #5b21b6;
    }
    .mini { min-height: 34px; padding: 0 12px; }
    .empty-row { padding: 16px; opacity: 0.72; }
    @media (max-width: 900px) {
      .section-filters { grid-template-columns: 1fr; }
      .section-toolbar { grid-template-columns: 1fr; }
      .ai-factor-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    }
  `]
})
export class StaffSectionComponent implements OnInit {
  readonly loading = signal(true);
  readonly saving = signal(false);
  readonly error = signal('');
  readonly staff = signal<ApiRecord[]>([]);
  readonly branches = signal<ApiRecord[]>([]);
  readonly services = signal<ApiRecord[]>([]);
  readonly summary = signal<ApiRecord | null>(null);
  readonly payrollCsv = signal('');
  readonly section = signal<StaffSection>('directory');

  periodStart = this.defaultStart();
  periodEnd = new Date().toISOString().slice(0, 10);
  branchId = '';
  directorySearch = '';
  directoryRoleFilter = '';
  directoryStatusFilter = '';
  payrollMode: 'employee' | 'invoice' | 'task' = 'employee';

  constructor(private readonly api: ApiService, private readonly route: ActivatedRoute) {}

  ngOnInit(): void {
    this.section.set((this.route.snapshot.data['section'] as StaffSection) || 'directory');
    this.branchId = this.api.selectedBranchId() || '';
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.error.set('');
    const filters = this.filters();
    Promise.all([
      firstValueFrom(this.api.list<ApiRecord[]>('staff', { branchId: filters.branchId || '', includeInactive: true, noCache: true })),
      firstValueFrom(this.api.list<ApiRecord[]>('branches', { noCache: true })),
      firstValueFrom(this.api.list<ApiRecord[]>('services', { noCache: true })),
      firstValueFrom(this.api.list<ApiRecord>('staff-management/summary', filters))
    ])
      .then(([staff, branches, services, summary]) => {
        this.staff.set(this.asArray(staff));
        this.branches.set(this.asArray(branches));
        this.services.set(this.asArray(services));
        this.summary.set(summary || null);
        this.loading.set(false);
      })
      .catch((error) => {
        this.error.set(error?.error?.error || 'Unable to load staff workspace');
        this.loading.set(false);
      });
  }

  exportPayroll(): void {
    this.saving.set(true);
    this.api.post<ApiRecord>('staff-management/payroll/export', this.filters()).subscribe({
      next: (result) => {
        this.payrollCsv.set(result.csv || '');
        this.saving.set(false);
        this.load();
      },
      error: (error) => {
        this.error.set(error?.error?.error || 'Unable to export payroll');
        this.saving.set(false);
      }
    });
  }

  runCommission(): void {
    this.saving.set(true);
    this.error.set('');
    this.api.post<ApiRecord>('staff-management/commissions/run', this.filters()).subscribe({
      next: () => {
        this.saving.set(false);
        this.load();
      },
      error: (error) => {
        this.error.set(error?.error?.error || 'Unable to run commission engine');
        this.saving.set(false);
      }
    });
  }

  pageTitle(): string {
    const labels: Record<StaffSection, string> = {
      directory: 'Staff directory',
      performance: 'Performance ranking',
      incentives: 'Incentive calculation',
      payroll: 'Payroll preview',
      schedule: 'Employee schedule',
      attendance: 'Attendance summary'
    };
    return labels[this.section()];
  }

  pageSubtitle(): string {
    const labels: Record<StaffSection, string> = {
      directory: 'Full team list with branch, role, service assignment, target and profile links.',
      performance: 'Expanded productivity ranking from saved sales, attendance and bookings.',
      incentives: 'Staff incentive engine with commission context and payout reasons.',
      payroll: 'Attendance, revenue, commission, incentive and gross payout preview.',
      schedule: 'Week roster with shift cells, branch context, weekly offs and planning gaps.',
      attendance: 'Monthly attendance rollup with present days, leave balance, late marks and payroll penalties.'
    };
    return labels[this.section()];
  }

  rankingRows(): ApiRecord[] {
    return this.asArray<ApiRecord>(this.summary()?.ranking);
  }

  incentiveRows(): ApiRecord[] {
    return this.asArray<ApiRecord>(this.summary()?.incentives?.rows);
  }

  payrollRows(): ApiRecord[] {
    return this.asArray<ApiRecord>(this.summary()?.payrollPreview);
  }

  commissionEntries(): ApiRecord[] {
    return this.asArray<ApiRecord>(this.summary()?.commission?.entries);
  }

  payrollTaskRows(): ApiRecord[] {
    const groups = new Map<string, ApiRecord>();
    for (const entry of this.commissionEntries()) {
      const type = String(entry.itemType || entry.type || 'service');
      const current = groups.get(type) || { type, lines: 0, revenue: 0, commission: 0, staffCounts: {} as Record<string, number> };
      current.lines = Number(current.lines || 0) + 1;
      current.revenue = Number(current.revenue || 0) + Number(entry.lineAmount || 0);
      current.commission = Number(current.commission || 0) + Number(entry.commission || 0);
      const staffName = String(entry.staffName || this.staffName(entry.staffId) || 'Unassigned');
      current.staffCounts[staffName] = Number(current.staffCounts[staffName] || 0) + 1;
      groups.set(type, current);
    }
    return [...groups.values()].map((row) => {
      const staffCounts = (row.staffCounts || {}) as Record<string, number>;
      const topStaff = Object.entries(staffCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || '';
      return { ...row, topStaff };
    });
  }

  filteredDirectoryStaff(): ApiRecord[] {
    const q = this.directorySearch.trim().toLowerCase();
    return this.staff().filter((person) => {
      const role = String(person.designation || person.role || '');
      const status = String(person.status || 'active');
      const haystack = [
        person.id,
        person.employeeCode,
        person.name,
        person.phone,
        person.email,
        role,
        this.branchNamesForStaff(person)
      ].join(' ').toLowerCase();
      return (!q || haystack.includes(q))
        && (!this.directoryRoleFilter || role === this.directoryRoleFilter)
        && (!this.directoryStatusFilter || status === this.directoryStatusFilter);
    });
  }

  roleOptions(): string[] {
    return [...new Set(this.staff().map((person) => String(person.designation || person.role || '').trim()).filter(Boolean))].sort();
  }

  resetDirectoryFilters(): void {
    this.directorySearch = '';
    this.directoryRoleFilter = '';
    this.directoryStatusFilter = '';
  }

  directoryAiRows(): ApiRecord[] {
    return this.filteredDirectoryStaff().map((person) => this.staffAiFactors(person));
  }

  staffAiFactors(person: ApiRecord): ApiRecord {
    const ranking = this.rankingRow(person) || {};
    const score = Number(ranking.performanceScore || 0);
    const bookings = Number(ranking.bookings || 0);
    const revenue = Number(ranking.revenue || 0);
    const attendanceScore = Number(ranking.attendanceScore || 0);
    const serviceEfficiency = Number(ranking.serviceEfficiency || 0);
    const status = String(person.status || 'active');
    const target = Number(this.asObject(person.targetMetrics).revenue || 0);
    const targetRecovery = Math.max(0, target - revenue);
    const absent = this.attendanceRowsFor(person).filter((row) => row.status === 'absent').length;
    const late = this.lateDaysFor(person);
    const workloadRisk = bookings >= 6 || serviceEfficiency >= 95 && attendanceScore < 70 ? 'high' : bookings >= 3 || late + absent > 0 ? 'medium' : 'low';
    const lowUtilization = bookings <= 1 && revenue < 1000;
    const bestForBooking = status === 'inactive'
      ? 'unavailable'
      : score >= 80 && workloadRisk !== 'high'
        ? 'recommended'
        : lowUtilization
          ? 'fill-plan'
          : 'conditional';
    const recommendation = bestForBooking === 'recommended'
      ? 'Prioritize for VIP/high-value bookings'
      : bestForBooking === 'fill-plan'
        ? 'Send walk-ins, rebooking and add-ons'
        : bestForBooking === 'unavailable'
          ? 'Do not assign new bookings'
          : 'Use after workload and attendance check';
    const absentRecoveryPlan = absent || status === 'on-leave' || status === 'inactive'
      ? 'Prepare backup staff'
      : 'No backup needed';
    const lowUtilizationPlan = lowUtilization
      ? 'Fill idle slots with rebooking leads'
      : targetRecovery > 0
        ? `Recover ${this.money(targetRecovery)} target gap`
        : 'Balanced';

    return {
      staffId: person.id,
      name: person.name,
      score,
      bookings,
      revenue,
      bestForBooking,
      burnoutRisk: workloadRisk,
      workloadBalance: `${bookings} bookings · ${this.money(revenue)}`,
      absentRecoveryPlan,
      targetRecovery,
      lowUtilization,
      lowUtilizationPlan,
      recommendation
    };
  }

  aiRecommendedCount(): number {
    return this.directoryAiRows().filter((row) => row.bestForBooking === 'recommended').length;
  }

  aiBurnoutCount(): number {
    return this.directoryAiRows().filter((row) => ['high', 'medium'].includes(String(row.burnoutRisk))).length;
  }

  aiRecoveryCount(): number {
    return this.directoryAiRows().filter((row) => row.absentRecoveryPlan === 'Prepare backup staff').length;
  }

  aiBalancedCount(): number {
    return this.directoryAiRows().filter((row) => row.lowUtilizationPlan === 'Balanced' && row.burnoutRisk === 'low').length;
  }

  aiTargetGapTotal(): number {
    return this.directoryAiRows().reduce((total, row) => total + Number(row.targetRecovery || 0), 0);
  }

  aiLowUtilizationCount(): number {
    return this.directoryAiRows().filter((row) => row.lowUtilization).length;
  }

  moveScheduleWeek(days: number): void {
    const start = new Date(this.periodStart || new Date());
    if (Number.isNaN(start.getTime())) start.setTime(Date.now());
    start.setDate(start.getDate() + days);
    this.setWeekFromDate(start);
    this.load();
  }

  setCurrentWeek(): void {
    this.setWeekFromDate(new Date());
    this.load();
  }

  weekDays(): { label: string; date: string }[] {
    const start = new Date(this.periodStart || new Date());
    if (Number.isNaN(start.getTime())) start.setTime(Date.now());
    return Array.from({ length: 7 }, (_, index) => {
      const date = new Date(start);
      date.setDate(start.getDate() + index);
      return {
        label: date.toLocaleDateString('en-IN', { weekday: 'short' }),
        date: this.dateKey(date)
      };
    });
  }

  shiftFor(person: ApiRecord, date: string): ApiRecord | null {
    return this.asArray<ApiRecord>(this.summary()?.shifts).find((shift) => shift.staffId === person.id && shift.date === date) || null;
  }

  isWeeklyOff(person: ApiRecord, date: string): boolean {
    const day = new Date(date).toLocaleDateString('en-IN', { weekday: 'long' }).toLowerCase();
    return this.weeklyOffs(person).map((item) => item.toLowerCase()).includes(day);
  }

  weeklyOffs(person: ApiRecord): string[] {
    return this.asArray<string>(person.weeklyOffs);
  }

  attendanceRowsFor(person: ApiRecord): ApiRecord[] {
    return this.asArray<ApiRecord>(this.summary()?.attendance?.records).filter((row) => row.staffId === person.id);
  }

  workingDaysFor(person: ApiRecord): number {
    const days = new Set([
      ...this.asArray<ApiRecord>(this.summary()?.shifts).filter((row) => row.staffId === person.id).map((row) => row.date),
      ...this.attendanceRowsFor(person).map((row) => row.date)
    ]);
    return days.size;
  }

  presentDaysFor(person: ApiRecord): number {
    return this.attendanceRowsFor(person).filter((row) => ['present', 'late', 'half-day'].includes(row.status)).length;
  }

  lateDaysFor(person: ApiRecord): number {
    return this.attendanceRowsFor(person).filter((row) => row.status === 'late').length;
  }

  leaveBalanceFor(person: ApiRecord): number {
    const leave = this.asObject(person.leaveBalance);
    return Number(leave.paid || leave.casual || leave.sick || 0);
  }

  penaltyFor(person: ApiRecord): number {
    return this.lateDaysFor(person) * 100;
  }

  revisedLeaveBalanceFor(person: ApiRecord): number {
    const absent = this.attendanceRowsFor(person).filter((row) => row.status === 'absent').length;
    return Math.max(0, this.leaveBalanceFor(person) - absent);
  }

  attendanceComment(person: ApiRecord): string {
    const late = this.lateDaysFor(person);
    const absent = this.attendanceRowsFor(person).filter((row) => row.status === 'absent').length;
    if (late || absent) return `${late} late · ${absent} absent`;
    if (!this.workingDaysFor(person)) return 'No records in scope';
    return 'Balanced';
  }

  rankingRow(person: ApiRecord): ApiRecord | undefined {
    return this.rankingRows().find((row) => row.staffId === person.id || row.id === person.id);
  }

  staffName(staffId: string): string {
    return this.staff().find((person) => person.id === staffId)?.name || staffId || 'Unassigned';
  }

  branchNamesForStaff(person: ApiRecord): string {
    const ids = this.asArray<string>(person.multiBranchIds).length ? this.asArray<string>(person.multiBranchIds) : [person.branchId].filter(Boolean);
    return ids.map((id) => this.branchName(id)).join(', ') || 'All branches';
  }

  assignedServiceNames(person: ApiRecord): string[] {
    return this.asArray<string>(person.assignedServices)
      .map((id) => this.services().find((service) => service.id === id)?.name || id)
      .filter(Boolean);
  }

  targetProgress(person: ApiRecord): number {
    const target = this.asObject(person.targetMetrics);
    const revenueTarget = Number(target.revenue || 0);
    if (!revenueTarget) return 0;
    const revenue = Number(this.rankingRow(person)?.revenue || 0);
    return Math.min(999, Math.round((revenue / revenueTarget) * 100));
  }

  targetLabel(person: ApiRecord): string {
    const target = this.asObject(person.targetMetrics);
    return target.revenue ? `${this.money(Number(target.revenue))} target` : 'No target';
  }

  commissionLabel(rule: any): string {
    const data = this.asObject(rule);
    const value = Number(data.value ?? data.servicePercent ?? data.flatAmount ?? 0);
    if (!value) return '—';
    return data.type === 'flat' || data.flatAmount ? `₹${value}/booking` : `${value}%`;
  }

  private filters(): ApiRecord {
    return {
      periodStart: this.periodStart,
      periodEnd: this.periodEnd,
      branchId: this.branchId || ''
    };
  }

  branchName(id: string): string {
    return this.branches().find((branch) => branch.id === id)?.name || id || '';
  }

  private dateKey(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  private setWeekFromDate(value: Date): void {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) date.setTime(Date.now());
    const day = date.getDay();
    date.setDate(date.getDate() - day);
    this.periodStart = this.dateKey(date);
    const end = new Date(date);
    end.setDate(date.getDate() + 6);
    this.periodEnd = this.dateKey(end);
  }

  private defaultStart(): string {
    const date = new Date();
    date.setDate(1);
    return date.toISOString().slice(0, 10);
  }

  private money(value: number): string {
    return `₹${Number(value || 0).toLocaleString('en-IN')}`;
  }

  private asArray<T = ApiRecord>(value: T[] | string | null | undefined): T[] {
    if (Array.isArray(value)) return value;
    if (!value || typeof value !== 'string') return [];
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  private asObject(value: any): ApiRecord {
    if (!value) return {};
    if (typeof value === 'object') return value;
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  }
}
