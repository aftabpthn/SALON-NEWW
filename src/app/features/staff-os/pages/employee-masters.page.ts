import { CommonModule } from '@angular/common';
import { Component, OnInit, computed, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { forkJoin } from 'rxjs';
import { StaffOsApi } from '../data/staff-os.api';

type MasterTile = {
  label: string;
  section: string;
  path?: string;
  status: 'live' | 'ready' | 'next';
  accent: 'people' | 'time' | 'money' | 'services' | 'payroll';
};

const masterTiles: MasterTile[] = [
  { label: 'Employee Category', section: 'Core', path: '/staff-os/staff-categories', status: 'live', accent: 'people' },
  { label: 'Employee Master', section: 'Core', path: '/staff-os/staff-list', status: 'live', accent: 'people' },
  { label: 'Attendance Master', section: 'Attendance', path: '/staff-os/attendance-master', status: 'live', accent: 'time' },
  { label: 'Leave Master', section: 'Attendance', path: '/staff-os/leave-master', status: 'live', accent: 'time' },
  { label: 'Shift Master', section: 'Attendance', path: '/staff-os/shift-master', status: 'live', accent: 'time' },
  { label: 'Attendance Category', section: 'Attendance Rules', path: '/staff-os/attendance-category', status: 'live', accent: 'time' },
  { label: 'Target Incentives [Service]', section: 'Incentives', path: '/staff-os/target-incentives/service', status: 'live', accent: 'money' },
  { label: 'Target Incentives [Product]', section: 'Incentives', path: '/staff-os/target-incentives/product', status: 'live', accent: 'money' },
  { label: 'Target Incentives [Membership]', section: 'Incentives', path: '/staff-os/target-incentives/membership', status: 'live', accent: 'money' },
  { label: 'Target Incentives [Branch-Admin]', section: 'Incentives', path: '/staff-os/target-incentives/branch-admin', status: 'live', accent: 'money' },
  { label: 'Target Incentives [Admin]', section: 'Incentives', path: '/staff-os/target-incentives/admin', status: 'live', accent: 'money' },
  { label: 'Target Incentives [All Tr.]', section: 'Incentives', path: '/staff-os/target-incentives/all-transaction', status: 'live', accent: 'money' },
  { label: 'Employee - Service Setup', section: 'Services', path: '/staff-os/service-assignment', status: 'live', accent: 'services' },
  { label: 'Fines / Penalty Master', section: 'Payroll', path: '/staff-os/fines-penalties', status: 'live', accent: 'payroll' },
  { label: 'Allowance / Deduction Master', section: 'Payroll', path: '/staff-os/allowance-deduction', status: 'live', accent: 'payroll' },
  { label: 'Payroll Rules', section: 'Payroll', path: '/staff-os/payroll-rules', status: 'live', accent: 'payroll' },
  { label: 'Advanced Payroll Setup', section: 'Payroll', path: '/staff-os/payroll-salary-structure', status: 'live', accent: 'payroll' },
  { label: 'Bulk Master Update [Employee]', section: 'Bulk Operations', path: '/staff-os/bulk-employee-update', status: 'live', accent: 'people' },
  { label: 'Staff Command Center', section: 'Staff Command', path: '/staff-enterprise', status: 'live', accent: 'people' },
  { label: 'Smart Staff Management', section: 'Staff Command', path: '/staff', status: 'live', accent: 'people' },
  { label: 'My Work', section: 'Staff Command', path: '/staff/my-work', status: 'live', accent: 'people' },
  { label: 'Connected Modules', section: 'Staff Command', path: '/staff/connected-modules', status: 'live', accent: 'services' },
  { label: 'Attendance Dashboard', section: 'Attendance Live', path: '/staff-os/attendance-dashboard', status: 'live', accent: 'time' },
  { label: 'Face Punch', section: 'Attendance Live', path: '/staff-os/face-punch', status: 'live', accent: 'time' },
  { label: 'Roster Calendar', section: 'Attendance Live', path: '/staff-os/roster-calendar', status: 'live', accent: 'time' },
  { label: 'Leave Management', section: 'Attendance Live', path: '/staff-os/leave-management', status: 'live', accent: 'time' },
  { label: 'Payroll Dashboard', section: 'Payroll', path: '/staff-os/payroll-dashboard', status: 'live', accent: 'payroll' },
  { label: 'Salary Generate', section: 'Payroll', path: '/staff-os/salary-generate', status: 'live', accent: 'payroll' },
  { label: 'Commissions', section: 'Commission', path: '/commissions', status: 'live', accent: 'money' },
  { label: 'Commission Dashboard', section: 'Commission', path: '/staff-os/commission-dashboard', status: 'live', accent: 'money' },
  { label: 'Performance Dashboard', section: 'Performance', path: '/staff-os/performance-dashboard', status: 'live', accent: 'services' },
  { label: 'Staff Sales Report', section: 'Reports', path: '/reports/staff-sales', status: 'live', accent: 'services' },
  { label: 'Invoice Reports', section: 'Reports', path: '/reports/invoices', status: 'live', accent: 'services' }
];

const payrollFlow = [
  { label: 'Staff Setup', path: '/staff-os/staff-list', note: 'Staff profile, category and salary basics.' },
  { label: 'Attendance Rules', path: '/staff-os/attendance-dashboard', note: 'Attendance, leave, shift and roster data.' },
  { label: 'Payroll Setup', path: '/staff-os/payroll-rules', note: 'Rules, fines, deductions and salary structure.' },
  { label: 'Salary Generate', path: '/staff-os/salary-generate', note: 'Preview, validate and generate net salary.' }
];

@Component({
  standalone: true,
  imports: [CommonModule, RouterLink],
  template: `
    <section class="masters-page">
      <header class="topbar">
        <div>
          <p class="eyebrow">Staff Operating System</p>
          <h1>Employee Masters</h1>
        </div>
        <div class="topbar-actions">
          <a class="primary" routerLink="/staff-os/staff-list" [queryParams]="{ add: 1 }">Add Employee</a>
          <button type="button" class="refresh" (click)="load()">Refresh</button>
        </div>
      </header>

      <div class="metrics" aria-label="Employee master metrics">
        <article>
          <span>Employees</span>
          <strong>{{ counts().employees }}</strong>
        </article>
        <article>
          <span>Categories</span>
          <strong>{{ counts().categories }}</strong>
        </article>
        <article>
          <span>Attendance Codes</span>
          <strong>{{ counts().attendance }}</strong>
        </article>
        <article>
          <span>Leave Types</span>
          <strong>{{ counts().leave }}</strong>
        </article>
        <article>
          <span>Shift Templates</span>
          <strong>{{ counts().shifts }}</strong>
        </article>
        <article>
          <span>Target Slabs</span>
          <strong>{{ counts().targets }}</strong>
        </article>
        <article>
          <span>Service Assign</span>
          <strong>{{ counts().serviceAssignments }}</strong>
        </article>
        <article>
          <span>Payroll Rules</span>
          <strong>{{ counts().payrollRules }}</strong>
        </article>
      </div>

      <div *ngIf="loading()" class="state">Loading employee masters...</div>
      <div *ngIf="error()" class="state error">{{ error() }}</div>

      <section class="primary-band">
        <a class="primary-tile people" routerLink="/staff-os/staff-list">
          <span>EM</span>
          <strong>Employee Master</strong>
          <small>{{ counts().employees }} records</small>
        </a>
        <a class="primary-tile time" routerLink="/staff-os/attendance-master">
          <span>AT</span>
          <strong>Attendance Master</strong>
          <small>{{ counts().attendance }} status codes</small>
        </a>
        <a class="primary-tile time" routerLink="/staff-os/leave-master">
          <span>LV</span>
          <strong>Leave Master</strong>
          <small>{{ counts().leave }} leave types</small>
        </a>
        <a class="primary-tile time" routerLink="/staff-os/shift-master">
          <span>SH</span>
          <strong>Shift Master</strong>
          <small>{{ counts().shifts }} templates</small>
        </a>
        <a class="primary-tile money" routerLink="/staff-os/attendance-category">
          <span>AC</span>
          <strong>Attendance Category</strong>
          <small>{{ counts().attendanceCategories }} rule sets</small>
        </a>
        <a class="primary-tile payroll" routerLink="/staff-os/salary-generate">
          <span>SG</span>
          <strong>Salary Generate</strong>
          <small>{{ counts().payrollRules }} payroll rules</small>
        </a>
      </section>

      <section class="payroll-flow" *ngIf="activeSection() === 'All' || activeSection() === 'Payroll'">
        <div class="flow-head">
          <div>
            <p class="eyebrow">Payroll setup merged</p>
            <h2>Salary workspace flow</h2>
          </div>
          <a routerLink="/staff-os/salary-generate">Open Salary Generate</a>
        </div>
        <div class="flow-grid">
          <a *ngFor="let item of payrollFlow" [routerLink]="item.path">
            <strong>{{ item.label }}</strong>
            <small>{{ item.note }}</small>
          </a>
        </div>
      </section>

      <div class="group-tabs" aria-label="Employee master sections">
        <button
          type="button"
          *ngFor="let section of sections()"
          [class.active]="activeSection() === section"
          (click)="activeSection.set(section)"
        >
          {{ section }}
        </button>
      </div>

      <section class="tile-grid">
        <ng-container *ngFor="let tile of filteredTiles()">
          <a *ngIf="tile.path; else queuedTile" class="tile" [class]="tile.accent" [routerLink]="tile.path">
            <span class="tile-icon">{{ initials(tile.label) }}</span>
            <strong>{{ tile.label }}</strong>
            <small [class]="tile.status">{{ statusLabel(tile.status) }}</small>
          </a>
          <ng-template #queuedTile>
            <button type="button" class="tile disabled" [class]="tile.accent" disabled>
              <span class="tile-icon">{{ initials(tile.label) }}</span>
              <strong>{{ tile.label }}</strong>
              <small [class]="tile.status">{{ statusLabel(tile.status) }}</small>
            </button>
          </ng-template>
        </ng-container>
      </section>
    </section>
  `,
  styles: [`
    .masters-page { display: grid; gap: 18px; padding: 24px; color: #10201a; }
    .topbar { align-items: flex-start; display: flex; justify-content: space-between; gap: 14px; }
    .topbar-actions { display: flex; gap: 10px; flex-wrap: wrap; align-items: center; }
    .eyebrow { margin: 0 0 5px; color: #547066; font-size: 12px; font-weight: 850; letter-spacing: .08em; text-transform: uppercase; }
    h1 { margin: 0; font-size: 30px; letter-spacing: 0; }
    .primary, .refresh { align-items: center; border: 1px solid #cbd8d2; border-radius: 6px; display: inline-flex; font-weight: 850; min-height: 38px; padding: 9px 12px; text-decoration: none; }
    .primary { background: #0f766e; border-color: #0f766e; color: #fff; }
    .refresh { background: #fff; color: #34483f; cursor: pointer; }
    .metrics { display: grid; grid-template-columns: repeat(8, minmax(120px, 1fr)); gap: 12px; }
    .metrics article, .state { border: 1px solid #d9e5de; border-radius: 8px; background: #fff; padding: 14px; }
    .metrics span { color: #60766d; font-size: 12px; font-weight: 850; text-transform: uppercase; }
    .metrics strong { display: block; margin-top: 6px; font-size: 24px; letter-spacing: 0; }
    .state { color: #61746c; }
    .state.error { color: #a52828; border-color: #e7b1b1; }
    .primary-band { display: grid; grid-template-columns: repeat(6, minmax(150px, 1fr)); gap: 12px; }
    .primary-tile, .tile { border: 1px solid #d9e5de; border-radius: 8px; background: #fff; color: #10201a; display: grid; gap: 7px; min-height: 118px; padding: 16px; text-align: left; text-decoration: none; }
    .primary-tile { min-height: 138px; align-content: space-between; }
    .primary-tile span, .tile-icon { align-items: center; border-radius: 8px; display: inline-flex; font-size: 12px; font-weight: 900; height: 34px; justify-content: center; width: 42px; }
    .primary-tile strong, .tile strong { font-size: 16px; letter-spacing: 0; }
    .primary-tile small, .tile small { color: #60766d; font-weight: 750; }
    .people .tile-icon, .primary-tile.people span { background: #eef6f1; color: #286345; }
    .time .tile-icon, .primary-tile.time span { background: #eaf4f8; color: #1f6172; }
    .money .tile-icon, .primary-tile.money span { background: #fff4e4; color: #8a5a00; }
    .services .tile-icon { background: #f4efff; color: #5f4aa3; }
    .payroll .tile-icon, .primary-tile.payroll span { background: #f3f5f7; color: #445261; }
    .payroll-flow { background: #f8fbf9; border: 1px solid #d9e5de; border-radius: 8px; display: grid; gap: 12px; padding: 16px; }
    .flow-head { align-items: center; display: flex; justify-content: space-between; gap: 12px; }
    .flow-head h2 { font-size: 20px; letter-spacing: 0; margin: 0; }
    .flow-head a { background: #10201a; border-radius: 6px; color: #fff; font-weight: 850; padding: 9px 12px; text-decoration: none; white-space: nowrap; }
    .flow-grid { display: grid; gap: 10px; grid-template-columns: repeat(4, minmax(0, 1fr)); }
    .flow-grid a { background: #fff; border: 1px solid #d9e5de; border-radius: 8px; color: #10201a; display: grid; gap: 6px; min-height: 86px; padding: 13px; text-decoration: none; }
    .flow-grid strong { font-size: 15px; letter-spacing: 0; }
    .flow-grid small { color: #60766d; line-height: 1.35; }
    .group-tabs { display: flex; gap: 6px; overflow-x: auto; padding: 8px; border: 1px solid #d9e5de; border-radius: 8px; background: #f8fbf9; }
    .group-tabs button { background: #fff; border: 1px solid #cbd8d2; border-radius: 6px; color: #34483f; cursor: pointer; font-weight: 850; min-height: 36px; padding: 8px 11px; white-space: nowrap; }
    .group-tabs button.active { background: #10201a; border-color: #10201a; color: #fff; }
    .tile-grid { display: grid; grid-template-columns: repeat(4, minmax(170px, 1fr)); gap: 12px; }
    .tile { cursor: pointer; }
    button.tile { font: inherit; }
    .tile.disabled { cursor: default; opacity: .72; }
    .tile small.live { color: #286345; }
    .tile small.ready { color: #1f6172; }
    .tile small.next { color: #8a5a00; }
    @media (max-width: 1100px) { .metrics, .primary-band, .tile-grid, .flow-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
    @media (max-width: 680px) {
      .masters-page { padding: 16px; }
      .topbar { display: grid; }
      .flow-head { align-items: flex-start; display: grid; }
      .metrics, .primary-band, .tile-grid, .flow-grid { grid-template-columns: 1fr; }
    }
  `]
})
export class EmployeeMastersPage implements OnInit {
  readonly tiles = masterTiles;
  readonly payrollFlow = payrollFlow;
  readonly activeSection = signal('All');
  readonly loading = signal(false);
  readonly error = signal('');
  readonly counts = signal({
    employees: 0,
    categories: 0,
    attendance: 0,
    leave: 0,
    shifts: 0,
    attendanceCategories: 0,
    targets: 0,
    serviceAssignments: 0,
    payrollRules: 0
  });
  readonly sections = computed(() => ['All', ...Array.from(new Set(this.tiles.map((tile) => tile.section)))]);
  readonly filteredTiles = computed(() => {
    const section = this.activeSection();
    return section === 'All' ? this.tiles : this.tiles.filter((tile) => tile.section === section);
  });

  constructor(private readonly api: StaffOsApi, private readonly route: ActivatedRoute) {}

  ngOnInit(): void {
    this.route.queryParamMap.subscribe((params) => {
      const section = params.get('section');
      if (section && this.sections().includes(section)) {
        this.activeSection.set(section);
      }
    });
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.error.set('');
    forkJoin({
      staff: this.api.staff({ includeArchived: 'true', limit: 1000 }),
      categories: this.api.staffCategories({ includeArchived: 'true', limit: 1000 }),
      attendance: this.api.attendanceMasters({ includeArchived: 'true', limit: 1000 }),
      leave: this.api.leaveMasters({ includeArchived: 'true', limit: 1000 }),
      shifts: this.api.shiftMasters({ includeArchived: 'true', limit: 1000 }),
      attendanceCategories: this.api.attendanceCategories({ includeArchived: 'true', limit: 1000 }),
      targets: this.api.targetIncentives({ includeArchived: 'true', limit: 1000 }),
      serviceAssignments: this.api.serviceAssignments({ includeArchived: 'true', limit: 1000 }),
      fines: this.api.finePenalties({ includeArchived: 'true', limit: 1000 }),
      allowances: this.api.allowanceDeductions({ includeArchived: 'true', limit: 1000 }),
      payrollStructures: this.api.payrollStructures({ includeArchived: 'true', limit: 1000 })
    }).subscribe({
      next: (result) => {
        this.counts.set({
          employees: result.staff.length,
          categories: result.categories.length,
          attendance: result.attendance.length,
          leave: result.leave.length,
          shifts: result.shifts.length,
          attendanceCategories: result.attendanceCategories.length,
          targets: result.targets.length,
          serviceAssignments: result.serviceAssignments.length,
          payrollRules: result.fines.length + result.allowances.length + result.payrollStructures.length
        });
        this.loading.set(false);
      },
      error: (error: { error?: { error?: string; message?: string }; message?: string }) => {
        this.error.set(error?.error?.error || error?.error?.message || error?.message || 'Unable to load employee masters');
        this.loading.set(false);
      }
    });
  }

  initials(label: string): string {
    const cleaned = label.replace(/\[[^\]]+\]/g, '').replace(/[^A-Za-z ]/g, ' ').trim();
    const parts = cleaned.split(/\s+/).filter(Boolean);
    return (parts[0]?.[0] || 'M') + (parts[1]?.[0] || '');
  }

  statusLabel(status: MasterTile['status']): string {
    if (status === 'live') return 'Live';
    if (status === 'ready') return 'Foundation';
    return 'Queued';
  }
}
