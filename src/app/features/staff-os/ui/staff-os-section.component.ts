import { CommonModule } from '@angular/common';
import { Component, ElementRef, Input, OnDestroy, OnInit, ViewChild, computed, effect, signal } from '@angular/core';
import { FormsModule, ReactiveFormsModule, UntypedFormBuilder, Validators } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { finalize, switchMap } from 'rxjs';
import { ApiRecord } from '../../../core/api.service';
import { AppStateService } from '../../../core/state/app-state.service';
import { StaffOsStore } from '../application/staff-os.store';
import { StaffOsBranch, StaffOsLeaveMaster, StaffOsRiskScore, StaffOsShiftMaster, StaffOsStaff, StaffOsStaffCategory, StaffOsTask } from '../domain/staff-os.models';

type StaffDetailTab = 'core' | 'contact' | 'emergency' | 'native' | 'incentive' | 'attendance' | 'remarks';
type StaffIntegrationLink = { label: string; to: string };
type StaffShellLink = { label: string; to: string; group: string; icon: string };
type StaffControlCard = { label: string; value: string | number; hint: string; to: string; tone: string };
type StaffControlTab = { label: string; to: string; count: string | number };
type StaffWorkspaceKey = 'overview' | 'directory' | 'attendance' | 'salary' | 'commission' | 'roster' | 'profile' | 'tasks';
type StaffWorkspaceCategory = { key: StaffWorkspaceKey; label: string; source: string };
type EmployeeLiveCard = { label: string; value: string | number; hint: string; tone: string };
type EmployeeCatalogCard = { label: string; value: string | number };
type AttendanceDashboardCard = { label: string; value: string | number; hint: string; tone: string };
type AttendanceExceptionItem = { title: unknown; meta: unknown; staff: string; impact: unknown; status: unknown; tone: string };
type IncentiveRuleType = 'service_category' | 'service' | 'product' | 'membership' | 'package';
type IncentiveCalcMode = 'percent' | 'fixed';
type IncentiveOption = { id: string; name: string; meta?: string };
type IncentiveRuleDraft = {
  id: string;
  type: IncentiveRuleType;
  targetId: string;
  targetName: string;
  calcMode: IncentiveCalcMode;
  value: number;
  minAmount: number;
  notes: string;
  active: boolean;
};
type IncentiveSlabDraft = {
  id: string;
  fromAmount: number;
  toAmount: number;
  incentivePercent: number;
  incentiveAmount: number;
};
type AttendancePunchType = 'clock_in' | 'clock_out' | 'full_day';

@Component({
  selector: 'app-staff-os-section',
  standalone: true,
  imports: [CommonModule, FormsModule, ReactiveFormsModule, RouterLink],
  template: `
    <section
      class="staff-os"
      [class.staff-list-mode]="section === 'staff-list' || section === 'staff-profile' || section === 'training-center'"
      [class.staff-attendance-mode]="section === 'attendance-dashboard'"
      [class.staff-roster-mode]="section === 'roster-calendar'"
      [class.staff-payroll-mode]="section === 'payroll-dashboard'"
    >
      <header class="topbar" *ngIf="section !== 'staff-profile'">
        <div>
          <p class="eyebrow">Staff Operating System</p>
          <h1>{{ title }}</h1>
        </div>
        <div class="topbar-actions">
          <button type="button" class="primary" *ngIf="section === 'workspace' || section === 'staff-list' || section === 'staff-profile'" (click)="openAddStaff()">Add Staff</button>
          <a class="refresh" routerLink="/staff-os/employee-masters">Employee Masters</a>
          <a class="refresh" *ngIf="section === 'staff-list'" routerLink="/staff-os/staff-categories">Staff Categories</a>
          <button type="button" class="refresh" (click)="store.load()">Refresh</button>
        </div>
      </header>

      <nav class="staff-shell-nav" *ngIf="section !== 'workspace'" aria-label="Staff OS command links">
        <a *ngFor="let link of staffShellLinks" [routerLink]="link.to" [class.active]="isShellLinkActive(link)">
          <span>{{ link.icon }}</span>
          <strong>{{ link.label }}</strong>
          <small>{{ link.group }}</small>
        </a>
      </nav>

      <section class="staff-control-room" *ngIf="section !== 'workspace'" aria-label="Staff owner control room">
        <div class="control-heading">
          <div>
            <p class="eyebrow">Owner control room</p>
            <h2>Attendance, payroll, commission and risk in one place</h2>
          </div>
          <div class="control-filters">
            <label>
              <span>Work date</span>
              <input type="date" [ngModel]="attendanceDate()" (ngModelChange)="attendanceDate.set($event); refreshAttendanceCenter()" />
            </label>
            <a class="refresh" routerLink="/staff-enterprise" [queryParams]="staffContextParams()">Open staff hub</a>
          </div>
        </div>
        <div class="control-cards">
          <a *ngFor="let card of staffControlCards()" [routerLink]="card.to" [queryParams]="staffContextParams()" class="control-card" [ngClass]="card.tone">
            <span>{{ card.label }}</span>
            <strong>{{ card.value }}</strong>
            <small>{{ card.hint }}</small>
          </a>
        </div>
        <nav class="control-tabs" aria-label="Staff grouped sections">
          <a *ngFor="let tab of staffControlTabs()" [routerLink]="tab.to" [queryParams]="staffContextParams()" [class.active]="isControlTabActive(tab)">
            <span>{{ tab.label }}</span>
            <strong>{{ tab.count }}</strong>
          </a>
        </nav>
      </section>

      <div class="metrics" *ngIf="section !== 'workspace'" aria-label="Staff OS metrics">
        <article *ngFor="let metric of store.metrics()" class="metric" [class]="metric.tone">
          <span>{{ metric.label }}</span>
          <strong>{{ metric.value }}</strong>
        </article>
      </div>

      <div *ngIf="store.loading()" class="state">Loading staff operations...</div>
      <div *ngIf="store.error()" class="state error">{{ store.error() }}</div>

      <section class="panel staff-workspace-panel" *ngIf="section === 'workspace'">
        <div class="panel-heading workspace-heading">
          <div>
            <h2>Staff Workspace</h2>
            <span>Live directory, attendance, salary, commission and roster in one page</span>
          </div>
          <div class="attendance-controls">
            <input type="date" [value]="attendanceDate()" (change)="setAttendanceDate($any($event.target).value)" />
            <button type="button" class="refresh" (click)="refreshAttendanceCenter()">Refresh live data</button>
          </div>
        </div>

        <div class="staff-workspace-shell">
          <aside class="staff-category-rail" aria-label="Staff workspace categories">
            <button
              *ngFor="let category of staffWorkspaceCategories"
              type="button"
              class="staff-category-tile"
              [class.active]="staffWorkspaceCategory() === category.key"
              [attr.data-state]="staffWorkspaceState(category.key)"
              (click)="staffWorkspaceCategory.set(category.key)"
            >
              <span>{{ category.label }}</span>
              <strong>{{ staffWorkspaceValue(category.key) }}</strong>
              <small>{{ staffWorkspaceNote(category.key) }}</small>
            </button>
          </aside>

          <section class="staff-workspace-detail" [ngSwitch]="staffWorkspaceCategory()">
            <header class="workspace-detail-head" *ngIf="selectedStaffWorkspaceCategory() as active">
              <div>
                <span class="eyebrow">Selected staff category</span>
                <h2>{{ active.label }}</h2>
                <p>{{ active.source }}</p>
              </div>
              <span class="badge" [class.warn]="staffWorkspaceState(active.key) === 'warn'" [class.bad]="staffWorkspaceState(active.key) === 'bad'">{{ staffWorkspaceStatus(active.key) }}</span>
            </header>

            <article *ngSwitchCase="'overview'" class="workspace-detail-body">
              <section class="workspace-kpi-grid">
                <article><span>Total staff</span><strong>{{ staffDirectoryRows().length }}</strong><small>{{ activeStaffForAttendance().length }} active for attendance</small></article>
                <article><span>Present today</span><strong>{{ attendanceRows().length }}</strong><small>{{ attendanceDate() }}</small></article>
                <article><span>Salary rows</span><strong>{{ store.attendancePayrollPreview().length }}</strong><small>{{ store.payrollStructures().length }} salary structures</small></article>
                <article><span>Commission rows</span><strong>{{ store.performance().rows.length }}</strong><small>from staff performance</small></article>
              </section>
              <div class="workspace-actions">
                <a routerLink="/staff-os/employee-masters">Employee Masters</a>
                <a routerLink="/staff-os/attendance-dashboard" [queryParams]="staffContextParams()">Attendance</a>
                <a routerLink="/staff-os/salary-generate" [queryParams]="staffContextParams()">Salary Generate</a>
                <a routerLink="/staff-os/commission-dashboard" [queryParams]="staffContextParams()">Commission</a>
                <a routerLink="/staff-os/roster-calendar" [queryParams]="staffContextParams()">Roster</a>
              </div>
              <div class="table compact workspace-table">
                <div class="row header"><span>Category</span><span>Scope</span><span>Default</span><span>Status</span></div>
                <div class="row" *ngFor="let category of store.staffCategories()">
                  <span><strong>{{ category.name }}</strong><small>{{ category.department || 'Department not set' }}</small></span>
                  <span>{{ categoryScopeLabel(category.scope) }}</span>
                  <span>{{ category.defaultDesignation || category.defaultEmploymentType || 'Not set' }}</span>
                  <span class="badge">{{ category.status }}</span>
                </div>
                <div *ngIf="!store.staffCategories().length && !store.loading()" class="empty action-empty"><strong>No staff categories yet.</strong><a class="refresh" routerLink="/staff-os/staff-categories">Create category</a></div>
              </div>
            </article>

            <article *ngSwitchCase="'directory'" class="workspace-detail-body">
              <div class="workspace-actions">
                <button type="button" class="primary" (click)="openAddStaff()">Add Staff</button>
                <a routerLink="/staff-os/staff-list">Open full list</a>
                <a routerLink="/staff-os/staff-categories">Staff categories</a>
              </div>
              <div class="table workspace-directory-table">
                <div class="row header"><span>Name</span><span>Branch</span><span>Category</span><span>Live data</span><span>Status</span><span>Links</span><span>Action</span></div>
                <div class="row" *ngFor="let staff of staffDirectoryRows()">
                  <span><strong>{{ staff.fullName }}</strong><small>{{ staff.employeeCode || staff.employeeDetails?.shortName || 'No code' }}</small></span>
                  <span>{{ staff.branchId }}</span>
                  <span>{{ staff.staffCategoryName || staff.designation || staff.department || 'Staff' }}</span>
                  <span class="live-badges"><span class="mini-badge" *ngFor="let badge of staffLiveBadges(staff)">{{ badge }}</span></span>
                  <span class="badge">{{ staff.status }}</span>
                  <span class="row-links">
                    <a routerLink="/staff-os/staff-profile" [queryParams]="{ staffId: staff.id }">Profile</a>
                    <a routerLink="/staff-os/attendance-dashboard" [queryParams]="{ staffId: staff.id }">Attendance</a>
                    <a routerLink="/staff-os/salary-generate" [queryParams]="{ staffId: staff.id }">Salary</a>
                  </span>
                  <span><button type="button" class="row-action" [disabled]="statusChanging() === staff.id" (click)="toggleStaffStatus(staff)">{{ statusChanging() === staff.id ? 'Saving...' : statusActionLabel(staff) }}</button></span>
                </div>
                <div *ngIf="!staffDirectoryRows().length && !store.loading()" class="empty action-empty"><strong>No staff records found.</strong><button type="button" class="primary" (click)="openAddStaff()">Add staff</button></div>
              </div>
            </article>

            <article *ngSwitchCase="'attendance'" class="workspace-detail-body">
              <section class="attendance-stats">
                <article><span>Attendance</span><strong>{{ attendanceSummary()['attendanceEvents'] || attendanceRows().length || 0 }}</strong><small>{{ attendanceDate() }}</small></article>
                <article><span>Devices</span><strong>{{ attendanceSummary()['activeDevices'] || 0 }}/{{ attendanceSummary()['devices'] || 0 }}</strong><small>active / total</small></article>
                <article><span>Queue</span><strong>{{ attendanceSummary()['queuedEvents'] || 0 }}</strong><small>{{ attendanceSummary()['failedEvents'] || 0 }} failed</small></article>
                <article><span>Suspicious</span><strong>{{ attendanceSummary()['suspiciousEvents'] || 0 }}</strong><small>review required</small></article>
              </section>
              <form class="staff-form camera-form manual-form workspace-manual-form" [formGroup]="manualAttendanceForm" (ngSubmit)="submitManualAttendance()">
                <label class="field">
                  <span>Branch</span>
                  <select formControlName="branchId" (change)="refreshAttendanceCenter()">
                    <option value="">Select branch</option>
                    <option *ngFor="let branch of branchOptions()" [value]="branch.id">{{ branch.name || branch.id }}</option>
                  </select>
                </label>
                <label class="field">
                  <span>Staff</span>
                  <select formControlName="staffId">
                    <option value="">Select staff</option>
                    <option *ngFor="let staff of activeStaffForAttendance()" [value]="staff.id">{{ staff.fullName }} {{ staff.employeeCode ? '(' + staff.employeeCode + ')' : '' }}</option>
                  </select>
                </label>
                <label class="field">
                  <span>Entry type</span>
                  <select formControlName="punchType">
                    <option value="full_day">Full day present</option>
                    <option value="clock_in">Clock in only</option>
                    <option value="clock_out">Clock out only</option>
                  </select>
                </label>
                <label class="field"><span>In time</span><input type="time" formControlName="clockInTime" /></label>
                <label class="field"><span>Out time</span><input type="time" formControlName="clockOutTime" /></label>
                <label class="field"><span>OT minutes</span><input type="number" min="0" step="1" formControlName="overtimeMinutes" /></label>
                <label class="field full"><span>Notes</span><input formControlName="notes" placeholder="Physical register, manager entry, missed punch" /></label>
                <div class="drawer-actions">
                  <button type="submit" class="primary" [disabled]="manualAttendanceForm.invalid || manualAttendanceSaving()">{{ manualAttendanceSaving() ? 'Saving...' : 'Save physical attendance' }}</button>
                  <a class="refresh" routerLink="/staff-os/attendance-master" [queryParams]="staffContextParams()">Attendance Master</a>
                  <a class="refresh" routerLink="/staff-os/face-punch" [queryParams]="staffContextParams()">Face Punch</a>
                </div>
              </form>
              <div class="state error" *ngIf="attendanceError()">{{ attendanceError() }}</div>
              <div class="state success" *ngIf="attendanceMessage()">{{ attendanceMessage() }}</div>
              <div class="table compact evidence-table">
                <div class="row header"><span>Staff</span><span>Source</span><span>Clock</span><span>Status</span></div>
                <div class="row" *ngFor="let row of attendanceRows()">
                  <span><strong>{{ displayStaffName(row) }}</strong><small>{{ row['businessDate'] || row['business_date'] }}</small></span>
                  <span>{{ row['source'] || 'manual' }}</span>
                  <span>{{ timeOnly(row['clockInAt'] || row['clock_in_at']) }} - {{ timeOnly(row['clockOutAt'] || row['clock_out_at']) || 'open' }}</span>
                  <span class="badge">{{ row['status'] }}</span>
                </div>
                <div *ngIf="!attendanceRows().length && !store.loading()" class="empty action-empty"><strong>No attendance events for selected date.</strong><span>Physical attendance entry se live attendance create kar sakte ho.</span></div>
              </div>
            </article>

            <article *ngSwitchCase="'salary'" class="workspace-detail-body">
              <section class="workspace-kpi-grid">
                <article><span>Salary profiles</span><strong>{{ salaryProfileCount() }}</strong><small>staff profile attendance & salary tab</small></article>
                <article><span>Structures</span><strong>{{ store.payrollStructures().length }}</strong><small>payroll salary structure</small></article>
                <article><span>Preview rows</span><strong>{{ store.attendancePayrollPreview().length }}</strong><small>attendance payroll preview</small></article>
                <article><span>Risks</span><strong>{{ store.attendanceRisks().length }}</strong><small>salary hold signals</small></article>
              </section>
              <div class="workspace-actions">
                <a routerLink="/staff-os/payroll-salary-structure">Salary Structure</a>
                <a routerLink="/staff-os/salary-generate" [queryParams]="staffContextParams()">Salary Generate</a>
                <a routerLink="/staff-os/payroll-dashboard" [queryParams]="staffContextParams()">Payroll Dashboard</a>
              </div>
              <section class="salary-editor-card" *ngIf="salaryEditorStaff() as activeStaff">
                <div class="panel-heading">
                  <div>
                    <h2>Set Staff Salary</h2>
                    <span>{{ activeStaff.fullName }} · {{ activeStaff.employeeCode || activeStaff.designation || 'Staff' }}</span>
                  </div>
                  <button type="button" class="refresh" (click)="closeSalaryEditor()">Close</button>
                </div>
                <form class="salary-editor-form" [formGroup]="salaryEditorForm" (ngSubmit)="saveStaffSalary()">
                  <label class="field">
                    <span>Basic salary</span>
                    <input formControlName="basicSalary" type="number" min="0" step="1" />
                  </label>
                  <label class="field">
                    <span>Salary structure</span>
                    <select formControlName="salaryStructureId">
                      <option value="">Default salary structure</option>
                      <option *ngFor="let structure of store.payrollStructures()" [value]="structure.id">{{ structure.name }}</option>
                    </select>
                  </label>
                  <label class="field">
                    <span>Salary cycle</span>
                    <select formControlName="salaryCycle">
                      <option value="monthly">Monthly</option>
                      <option value="weekly">Weekly</option>
                      <option value="daily">Daily</option>
                    </select>
                  </label>
                  <label class="field">
                    <span>Effective from</span>
                    <input formControlName="salaryEffectiveFrom" type="date" />
                  </label>
                  <label class="field">
                    <span>Payment mode</span>
                    <select formControlName="paymentMode">
                      <option value="">Not set</option>
                      <option value="cash">Cash</option>
                      <option value="cheque">Cheque</option>
                      <option value="bank_transfer">Bank transfer</option>
                    </select>
                  </label>
                  <label class="field"><span>Bank name</span><input formControlName="bankName" /></label>
                  <label class="field"><span>Account number</span><input formControlName="accountNumber" /></label>
                  <label class="check-field">
                    <input type="checkbox" formControlName="supportAttendancePayroll" />
                    <span>Use this salary in attendance/payroll</span>
                  </label>
                  <div class="state error" *ngIf="salaryEditorError()">{{ salaryEditorError() }}</div>
                  <div class="state success" *ngIf="salaryEditorMessage()">{{ salaryEditorMessage() }}</div>
                  <div class="drawer-actions">
                    <button type="button" class="refresh" (click)="closeSalaryEditor()">Cancel</button>
                    <button type="submit" class="primary" [disabled]="salaryEditorForm.invalid || salaryEditorSaving()">{{ salaryEditorSaving() ? 'Saving...' : 'Save staff salary' }}</button>
                  </div>
                </form>
              </section>
              <div class="table compact salary-workspace-table">
                <div class="row header"><span>Staff</span><span>Basic salary</span><span>Payment</span><span>Payroll</span><span>Action</span></div>
                <div class="row" *ngFor="let staff of staffDirectoryRows()">
                  <span><strong>{{ staff.fullName }}</strong><small>{{ staff.designation || staff.staffCategoryName || 'Staff' }}</small></span>
                  <span>{{ salaryAmount(staff) | currency:'INR':'symbol-narrow':'1.0-0' }}</span>
                  <span>{{ salaryProfile(staff)['paymentMode'] || 'Not set' }}</span>
                  <span class="badge">{{ salaryProfile(staff)['supportAttendancePayroll'] ? 'Attendance sync' : 'Manual review' }}</span>
                  <span><button type="button" class="row-action" (click)="openSalaryEditor(staff)">{{ salaryAmount(staff) > 0 ? 'Edit Salary' : 'Set Salary' }}</button></span>
                </div>
              </div>
              <div class="table compact risk-table" *ngIf="store.attendancePayrollPreview().length || store.attendanceRisks().length">
                <div class="row header"><span>Risk / Payroll</span><span>Score</span><span>Amount</span><span>Status</span></div>
                <div class="row" *ngFor="let row of store.attendancePayrollPreview()">
                  <span><strong>{{ displayStaffName(row) }}</strong><small>{{ row['presentDays'] || 0 }} present · {{ row['lateCount'] || 0 }} late</small></span>
                  <span>{{ row['absentDays'] || 0 }} absent</span>
                  <span>₹{{ row['netPreview'] || 0 }}</span>
                  <span class="badge">{{ row['incentiveHold'] ? 'hold' : 'draft' }}</span>
                </div>
              </div>
            </article>

            <article *ngSwitchCase="'commission'" class="workspace-detail-body">
              <section class="workspace-kpi-grid">
                <article><span>Incentive rules</span><strong>{{ commissionRuleCount() }}</strong><small>service/product/membership</small></article>
                <article><span>Performance rows</span><strong>{{ store.performance().rows.length }}</strong><small>commission source</small></article>
                <article><span>Tracked revenue</span><strong>{{ store.performance().summary.revenue | currency:'INR':'symbol-narrow':'1.0-0' }}</strong><small>staff assigned sales</small></article>
                <article><span>Avg score</span><strong>{{ store.performance().summary.avgScore | number:'1.0-0' }}</strong><small>productivity score</small></article>
              </section>
              <div class="workspace-actions">
                <a routerLink="/staff-os/commission-dashboard">Commission Dashboard</a>
                <a routerLink="/staff-os/target-incentives/service">Target Incentives</a>
                <a routerLink="/reports/staff-sales">Staff Sales</a>
              </div>
              <div class="table compact">
                <div class="row header"><span>Staff</span><span>Score</span><span>Revenue</span><span>Utilization</span></div>
                <div class="row" *ngFor="let row of store.performance().rows">
                  <span>{{ row.staffId }}</span>
                  <span>{{ row.productivityScore | number:'1.0-0' }}</span>
                  <span>{{ row.revenueGenerated | currency:'INR':'symbol-narrow':'1.0-0' }}</span>
                  <span>{{ row.utilizationPct | number:'1.0-0' }}%</span>
                </div>
                <div *ngIf="!store.performance().rows.length && !store.loading()" class="empty action-empty"><strong>No performance rows yet.</strong><a class="refresh" routerLink="/reports/staff-sales">Open staff sales</a></div>
              </div>
            </article>

            <article *ngSwitchCase="'roster'" class="workspace-detail-body">
              <div class="workspace-actions">
                <a routerLink="/staff-os/roster-calendar" [queryParams]="staffContextParams()">Roster Calendar</a>
                <a routerLink="/staff-os/shift-master">Shift Master</a>
                <a routerLink="/staff-os/leave-management">Leave Management</a>
              </div>
              <div class="heatmap" aria-label="Roster heatmap">
                <span *ngFor="let cell of heatmapCells; let index = index" [style.opacity]="opacity(index)"></span>
              </div>
              <div class="table compact">
                <div class="row header"><span>Date</span><span>Staff</span><span>Timing</span><span>Status</span></div>
                <div class="row" *ngFor="let shift of store.schedules()">
                  <span>{{ shift.scheduleDate }}</span>
                  <span>{{ shift.staffId }}</span>
                  <span>{{ shift.startTime }} - {{ shift.endTime }}</span>
                  <span class="badge">{{ shift.status }}</span>
                </div>
                <div *ngIf="!store.schedules().length && !store.loading()" class="empty action-empty"><strong>No roster data for selected branch.</strong><a class="refresh" routerLink="/staff-os/shift-master">Create shift setup</a></div>
              </div>
            </article>

            <article *ngSwitchCase="'profile'" class="workspace-detail-body">
              <div class="workspace-actions">
                <button type="button" class="primary" (click)="openAddStaff()">Add Staff With Salary</button>
                <a routerLink="/staff-os/staff-profile">Staff Profile</a>
                <a routerLink="/staff/my-work">Staff My Work</a>
              </div>
              <div class="table workspace-directory-table">
                <div class="row header"><span>Name</span><span>Login</span><span>Salary</span><span>Contact</span><span>Status</span><span>Links</span><span>Action</span></div>
                <div class="row" *ngFor="let staff of staffDirectoryRows()">
                  <span><strong>{{ staff.fullName }}</strong><small>{{ staff.designation || staff.staffCategoryName || 'Staff' }}</small></span>
                  <span>{{ staff.loginId || staff.loginEmail || (staff.loginUserId ? 'Login linked' : 'No login') }}</span>
                  <span>{{ salaryAmount(staff) | currency:'INR':'symbol-narrow':'1.0-0' }}</span>
                  <span>{{ staff.mobile || staff.email || 'No contact' }}</span>
                  <span class="badge">{{ staff.status }}</span>
                  <span class="row-links">
                    <a routerLink="/staff-os/staff-profile" [queryParams]="{ staffId: staff.id }">Profile</a>
                    <a routerLink="/staff-os/salary-generate" [queryParams]="{ staffId: staff.id }">Salary</a>
                  </span>
                  <span><button type="button" class="row-action" (click)="openAddStaff()">New</button></span>
                </div>
              </div>
            </article>

            <article *ngSwitchCase="'tasks'" class="workspace-detail-body">
              <section class="workspace-kpi-grid">
                <article><span>Tasks</span><strong>{{ store.tasks().length }}</strong><small>open staff actions</small></article>
                <article><span>Risks</span><strong>{{ actionableRisks().length }}</strong><small>medium/high staff score</small></article>
                <article><span>Attendance risks</span><strong>{{ store.attendanceRisks().length }}</strong><small>payroll/attendance review</small></article>
                <article><span>Training</span><strong>{{ store.performance().rows.length }}</strong><small>performance rows</small></article>
              </section>
              <div class="workspace-actions">
                <a routerLink="/staff-os/task-board">Task Board</a>
                <a routerLink="/staff-os/training-center">Training Center</a>
                <a routerLink="/staff-enterprise">Staff Command</a>
              </div>
              <div class="task-grid">
                <article *ngFor="let task of store.tasks()"><strong>{{ task.title }}</strong><span>{{ task.priority }} · {{ task.status }}</span></article>
                <article *ngFor="let risk of actionableRisks()">
                  <strong>{{ staffNameById(risk.staffId) }}</strong>
                  <span>{{ risk.level }} · {{ risk.score }} score</span>
                  <small>{{ risk.reasons.join(', ') }}</small>
                </article>
                <div *ngIf="!store.tasks().length && !actionableRisks().length && !store.loading()" class="empty action-empty"><strong>No staff tasks or open staff risks.</strong><span>Normal low-risk staff scores ko pending nahi maana jayega.</span></div>
              </div>
            </article>
          </section>
        </div>
      </section>

      <section class="panel" [class.staff-register-panel]="section === 'staff-list' || section === 'staff-profile' || section === 'training-center'" *ngIf="section === 'staff-list' || section === 'staff-profile' || section === 'training-center'">
        <div class="panel-heading staff-register-heading">
          <div>
            <p class="eyebrow">{{ section === 'training-center' ? 'Training register' : section === 'staff-profile' ? 'Staff profile register' : 'Staff directory' }}</p>
            <h2>{{ section === 'training-center' ? 'Training Center' : section === 'staff-profile' ? 'Employee profiles' : 'Manage employees' }}</h2>
          </div>
          <div class="staff-register-actions">
            <span>{{ staffDirectoryRows().length }} records</span>
            <button type="button" class="refresh" (click)="store.load()">Refresh</button>
            <button type="button" class="primary" (click)="openAddStaff()">Add staff</button>
          </div>
        </div>

        <div class="staff-register-kpis" *ngIf="section === 'staff-list' || section === 'staff-profile' || section === 'training-center'">
          <article><span>Total staff</span><strong>{{ staffDirectoryRows().length }}</strong><small>employee master records</small></article>
          <article><span>Active</span><strong>{{ activeStaffForAttendance().length }}</strong><small>attendance ready</small></article>
          <article><span>Inactive</span><strong>{{ inactiveStaffCount() }}</strong><small>paused / archived</small></article>
          <article><span>Login linked</span><strong>{{ loginLinkedCount() }}</strong><small>staff app access</small></article>
        </div>

        <div class="staff-register-scroll">
          <table class="staff-register-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Branch</th>
                <th>Category</th>
                <th>Live data</th>
                <th>Status</th>
                <th>Links</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              <tr *ngFor="let staff of staffDirectoryRows()">
                <td>
                  <strong>{{ staff.fullName }}</strong>
                  <small *ngIf="staff.employeeDetails?.shortName || staff.employeeCode">
                    {{ staff.employeeDetails?.shortName || 'No short name' }} · {{ staff.employeeCode || 'No code' }}
                  </small>
                </td>
                <td>{{ staff.branchId }}</td>
                <td>{{ staff.staffCategoryName || staff.designation || staff.department || 'Staff' }}</td>
                <td>
                  <span class="live-badges">
                    <span class="mini-badge" *ngFor="let badge of staffLiveBadges(staff)">{{ badge }}</span>
                  </span>
                </td>
                <td><span class="badge">{{ staff.status }}</span></td>
                <td>
                  <span class="row-links">
                    <a routerLink="/staff-os/staff-profile" [queryParams]="{ staffId: staff.id }">Profile</a>
                    <a routerLink="/staff/my-work" [queryParams]="{ staffId: staff.id }">My Work</a>
                    <a routerLink="/staff-os/attendance-dashboard" [queryParams]="{ staffId: staff.id }">Attendance</a>
                    <a routerLink="/staff-os/payroll-dashboard" [queryParams]="{ staffId: staff.id }">Payroll</a>
                    <a routerLink="/staff-os/salary-generate" [queryParams]="{ staffId: staff.id }">Salary</a>
                  </span>
                </td>
                <td>
                  <button
                    type="button"
                    class="row-action"
                    [disabled]="statusChanging() === staff.id"
                    (click)="toggleStaffStatus(staff)"
                  >
                    {{ statusChanging() === staff.id ? 'Saving...' : statusActionLabel(staff) }}
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
          <div *ngIf="!staffDirectoryRows().length && !store.loading()" class="empty action-empty">
            <strong>No staff records found.</strong>
            <span>Add staff first to unlock attendance, payroll and commission reports.</span>
            <button type="button" class="primary" (click)="openAddStaff()">Add staff</button>
          </div>
        </div>
        <div class="staff-register-footer" *ngIf="section === 'staff-list' || section === 'staff-profile' || section === 'training-center'">
          <span>{{ staffDirectoryRows().length ? 1 : 0 }} to {{ staffDirectoryRows().length }} of {{ staffDirectoryRows().length }}</span>
          <span>Page 1 of 1</span>
        </div>
        <div class="state error" *ngIf="staffActionError()">{{ staffActionError() }}</div>
      </section>

      <div class="drawer-shell" *ngIf="addStaffOpen()" role="dialog" aria-modal="true" aria-label="Add staff">
        <div class="drawer-scrim" (click)="closeAddStaff()"></div>
        <aside class="drawer">
          <header class="drawer-header">
            <div>
              <p class="editor-breadcrumb">Employee &gt; Manage Employees &gt; New employee</p>
              <div class="editor-title-row">
                <h2>Add Employee</h2>
                <span class="status-pill">Active</span>
              </div>
              <span>Creates a real employee master record with branch scope, staff category and audit trail.</span>
            </div>
            <button type="button" class="icon-button" (click)="closeAddStaff()" aria-label="Close add staff">×</button>
          </header>

          <nav class="detail-tabs" aria-label="Employee master sections">
            <button
              type="button"
              *ngFor="let tab of detailTabs"
              [class.active]="detailTab() === tab.id"
              (click)="detailTab.set(tab.id)"
            >
              {{ tab.label }}
            </button>
          </nav>

          <section class="live-context" aria-label="Live staff interconnections">
            <article>
              <span>Branch</span>
              <strong>{{ selectedBranchName() }}</strong>
            </article>
            <article>
              <span>Category</span>
              <strong>{{ selectedCategory()?.name || 'Not selected' }}</strong>
            </article>
            <article>
              <span>Defaults</span>
              <strong>{{ selectedCategoryDefaultsText() }}</strong>
            </article>
            <div class="context-links">
              <a *ngFor="let link of activeIntegrationLinks()" [routerLink]="link.to">{{ link.label }}</a>
            </div>
          </section>

          <form class="staff-form" [formGroup]="staffForm" (ngSubmit)="saveStaff()">
            <ng-container *ngIf="detailTab() === 'core'">
              <label class="field full">
                <span>Branch</span>
                <select formControlName="branchId">
                  <option value="">Select branch</option>
                  <option *ngFor="let branch of branchOptions()" [value]="branch.id">{{ branch.name || branch.id }}</option>
                </select>
                <small *ngIf="fieldInvalid('branchId')">Branch is required.</small>
              </label>

              <label class="field">
                <span>First name</span>
                <input formControlName="firstName" autocomplete="given-name" />
                <small *ngIf="fieldInvalid('firstName')">First name is required.</small>
              </label>

              <label class="field">
                <span>Last name</span>
                <input formControlName="lastName" autocomplete="family-name" />
              </label>

              <label class="field">
                <span>Short name</span>
                <input formControlName="shortName" placeholder="AMITA" />
              </label>

              <label class="field">
                <span>Staff ID code</span>
                <input formControlName="employeeCode" placeholder="1" />
              </label>

              <label class="field">
                <span>Mobile</span>
                <input formControlName="mobile" autocomplete="tel" />
                <small *ngIf="fieldInvalid('mobile')">Enter a valid mobile number.</small>
              </label>

              <label class="field">
                <span>Email</span>
                <input formControlName="email" type="email" autocomplete="email" />
                <small *ngIf="fieldInvalid('email')">Enter a valid email.</small>
              </label>

              <section class="login-provision full">
                <div>
                  <span class="eyebrow">Staff app login</span>
                  <strong>Give this staff their own login ID and password.</strong>
                </div>
                <label class="check-field">
                  <input type="checkbox" formControlName="enableStaffLogin" />
                  <span>Create login for live appointments and own-work report</span>
                </label>
                <label class="field">
                  <span>Login ID</span>
                  <input formControlName="loginId" autocomplete="username" placeholder="aftab01 or mobile/email" />
                </label>
                <label class="field">
                  <span>Password</span>
                  <input formControlName="loginPassword" type="password" autocomplete="new-password" />
                  <small *ngIf="fieldInvalid('loginPassword')">Use at least 6 characters.</small>
                </label>
                <label class="field">
                  <span>Login role</span>
                  <select formControlName="loginRole">
                    <option value="staff">Staff</option>
                    <option value="frontDesk">Front desk</option>
                    <option value="cashier">Cashier</option>
                    <option value="manager">Manager</option>
                  </select>
                </label>
              </section>

              <label class="field">
                <span>Role</span>
                <select formControlName="roleId">
                  <option value="staff">Staff</option>
                  <option value="cashier">Cashier</option>
                  <option value="manager">Manager</option>
                  <option value="frontDesk">Front desk</option>
                  <option value="trainer">Trainer</option>
                </select>
              </label>

              <label class="field">
                <span>Staff Category</span>
                <select formControlName="staffCategoryId" (change)="applySelectedCategoryDefaults()">
                  <option value="">Select category</option>
                  <option *ngFor="let category of activeCategoriesForSelectedBranch()" [value]="category.id">
                    {{ category.name }} · {{ categoryScopeLabel(category.scope) }}
                  </option>
                </select>
                <small *ngIf="!activeCategoriesForSelectedBranch().length">
                  <a routerLink="/staff-os/staff-categories">Create Staff Category</a>
                </small>
              </label>

              <section class="salary-quick-panel full" aria-label="Salary setup shortcut">
                <div>
                  <span class="eyebrow">Salary setup</span>
                  <strong>{{ staffForm.get('basicSalary')?.value || 0 | currency:'INR':'symbol-narrow':'1.0-0' }} basic salary</strong>
                  <small>Salary Add Employee ke andar hi set hogi. Save Employee ke saath payroll profile save hota hai.</small>
                </div>
                <div class="salary-quick-meta">
                  <article>
                    <span>Payment</span>
                    <strong>{{ staffForm.get('paymentMode')?.value || 'Not set' }}</strong>
                  </article>
                  <article>
                    <span>Payroll</span>
                    <strong>{{ staffForm.get('supportAttendancePayroll')?.value ? 'Enabled' : 'Off' }}</strong>
                  </article>
                </div>
                <div class="salary-quick-actions">
                  <button type="button" class="primary" (click)="detailTab.set('attendance')">Open Salary Setup</button>
                  <a class="refresh" routerLink="/staff-os/salary-workspace" [queryParams]="staffContextParams()">Salary Workspace</a>
                </div>
              </section>

              <label class="field">
                <span>Employment type</span>
                <select formControlName="employmentType">
                  <option value="full_time">Full time</option>
                  <option value="part_time">Part time</option>
                  <option value="contract">Contract</option>
                  <option value="freelance">Freelance</option>
                  <option value="intern">Intern</option>
                </select>
              </label>

              <label class="field">
                <span>Department</span>
                <input formControlName="department" placeholder="Hair, Skin, Nail, Front desk" />
              </label>

              <label class="field">
                <span>Designation</span>
                <input formControlName="designation" placeholder="Senior stylist, Therapist" />
                <small *ngIf="fieldInvalid('designation')">Designation is required.</small>
              </label>

              <label class="field">
                <span>Joined on</span>
                <input formControlName="joiningDate" type="date" />
              </label>

              <label class="field">
                <span>Last working date</span>
                <input formControlName="lastWorkingDate" type="date" />
              </label>

              <label class="field">
                <span>Birth date</span>
                <input formControlName="birthDate" type="date" />
              </label>

              <label class="field">
                <span>Anniversary date</span>
                <input formControlName="anniversaryDate" type="date" />
              </label>

              <label class="field">
                <span>Gender</span>
                <select formControlName="gender">
                  <option value="">Not set</option>
                  <option value="male">Male</option>
                  <option value="female">Female</option>
                  <option value="other">Other</option>
                </select>
              </label>

              <label class="field">
                <span>Entry PIN</span>
                <input formControlName="entryPin" type="password" autocomplete="new-password" />
              </label>

              <label class="check-field">
                <input type="checkbox" formControlName="hideFromRoster" />
                <span>Hide / archive from roster</span>
              </label>

              <label class="check-field">
                <input type="checkbox" formControlName="allowSkipOtp" />
                <span>Allow to skip OTP</span>
              </label>

              <label class="field full">
                <span>Skills &amp; certifications</span>
                <textarea formControlName="skillLicenseNotes" rows="3" placeholder="Example: Hair color certified, bridal makeup training pending"></textarea>
              </label>
            </ng-container>

            <ng-container *ngIf="detailTab() === 'contact'">
              <label class="field">
                <span>Contact person</span>
                <input formControlName="contactPerson" />
              </label>
              <label class="field">
                <span>Mobile</span>
                <input formControlName="contactMobile" />
              </label>
              <label class="field full">
                <span>Address</span>
                <input formControlName="address" />
              </label>
              <label class="field full">
                <span>Address line 2</span>
                <input formControlName="addressLine2" />
              </label>
              <label class="field">
                <span>Landmark</span>
                <input formControlName="landmark" />
              </label>
              <label class="field">
                <span>Phone</span>
                <input formControlName="phone" />
              </label>
              <label class="field">
                <span>City</span>
                <input formControlName="city" />
              </label>
              <label class="field">
                <span>Pin</span>
                <input formControlName="pincode" />
              </label>
              <label class="field">
                <span>State</span>
                <input formControlName="state" />
              </label>
              <label class="field">
                <span>Country</span>
                <input formControlName="country" />
              </label>
              <label class="field">
                <span>Area</span>
                <input formControlName="area" />
              </label>
              <label class="field">
                <span>Fax</span>
                <input formControlName="fax" />
              </label>
              <label class="field">
                <span>Contact email</span>
                <input formControlName="contactEmail" type="email" />
              </label>
              <label class="field">
                <span>Web</span>
                <input formControlName="web" />
              </label>
            </ng-container>

            <ng-container *ngIf="detailTab() === 'emergency'">
              <label class="field">
                <span>Emergency contact person</span>
                <input formControlName="emergencyContactName" />
              </label>
              <label class="field">
                <span>Emergency mobile</span>
                <input formControlName="emergencyContactMobile" />
              </label>
              <label class="field">
                <span>Emergency phone</span>
                <input formControlName="emergencyContactPhone" />
              </label>
              <label class="field">
                <span>Relation</span>
                <input formControlName="emergencyRelation" />
              </label>
              <label class="field full">
                <span>Emergency address</span>
                <textarea formControlName="emergencyAddress" rows="3"></textarea>
              </label>
              <label class="field">
                <span>City</span>
                <input formControlName="emergencyCity" />
              </label>
              <label class="field">
                <span>State</span>
                <input formControlName="emergencyState" />
              </label>
              <label class="field">
                <span>Country</span>
                <input formControlName="emergencyCountry" />
              </label>
            </ng-container>

            <ng-container *ngIf="detailTab() === 'native'">
              <label class="field">
                <span>Native contact person</span>
                <input formControlName="nativeContactName" />
              </label>
              <label class="field">
                <span>Native mobile</span>
                <input formControlName="nativeContactMobile" />
              </label>
              <label class="field">
                <span>Native phone</span>
                <input formControlName="nativeContactPhone" />
              </label>
              <label class="field full">
                <span>Native address</span>
                <textarea formControlName="nativeAddress" rows="3"></textarea>
              </label>
              <label class="field">
                <span>City</span>
                <input formControlName="nativeCity" />
              </label>
              <label class="field">
                <span>State</span>
                <input formControlName="nativeState" />
              </label>
              <label class="field">
                <span>Country</span>
                <input formControlName="nativeCountry" />
              </label>
            </ng-container>

            <ng-container *ngIf="detailTab() === 'incentive'">
              <section class="incentive-command full">
                <div>
                  <span class="eyebrow">Incentive engine</span>
                  <strong>Compact staff payout profile</strong>
                  <small>{{ incentiveSummaryText() }}</small>
                </div>
                <button type="button" class="primary" (click)="advancedIncentiveOpen.set(true)">Advanced Incentive Rules</button>
              </section>

              <section class="incentive-summary full" aria-label="Incentive rule summary">
                <article>
                  <span>Fixed</span>
                  <strong>{{ staffForm.get('fixedIncentivePercent')?.value || 0 }}% / {{ (staffForm.get('fixedIncentiveAmount')?.value || 0) | currency:'INR':'symbol-narrow':'1.0-0' }}</strong>
                </article>
                <article>
                  <span>Rule builder</span>
                  <strong>{{ incentiveRules().length }} rules</strong>
                </article>
                <article>
                  <span>Target slabs</span>
                  <strong>{{ incentiveSlabs().length }} slabs</strong>
                </article>
                <article>
                  <span>Payroll</span>
                  <strong>{{ staffForm.get('incentivePayrollSync')?.value ? 'Auto add' : 'Manual review' }}</strong>
                </article>
              </section>

              <label class="field">
                <span>Fixed incentive %</span>
                <input formControlName="fixedIncentivePercent" type="number" min="0" step="0.01" />
              </label>
              <label class="field">
                <span>Fixed incentive amount</span>
                <input formControlName="fixedIncentiveAmount" type="number" min="0" step="1" />
              </label>
              <label class="field full">
                <span>Service category incentive rules</span>
                <textarea formControlName="serviceIncentiveRules" rows="4" placeholder="Example: Hair color 8%, Bridal makeup 10%"></textarea>
              </label>
              <label class="field full">
                <span>Incentive notes</span>
                <textarea formControlName="incentiveNotes" rows="3"></textarea>
              </label>

              <div class="subdrawer-shell" *ngIf="advancedIncentiveOpen()" role="dialog" aria-modal="true" aria-label="Advanced incentive rules">
                <div class="subdrawer-scrim" (click)="advancedIncentiveOpen.set(false)"></div>
                <aside class="subdrawer">
                  <header class="drawer-header">
                    <div>
                      <p class="eyebrow">Advanced incentive rules</p>
                      <h2>Commission, target slabs and payroll handoff</h2>
                      <span>Rules save into this staff employee master profile for payroll and commission preview.</span>
                    </div>
                    <button type="button" class="icon-button" (click)="advancedIncentiveOpen.set(false)" aria-label="Close advanced incentive rules">×</button>
                  </header>

                  <section class="advanced-grid">
                    <label class="field">
                      <span>Payout cycle</span>
                      <select formControlName="incentiveCycle">
                        <option value="monthly">Monthly</option>
                        <option value="weekly">Weekly</option>
                        <option value="daily">Daily</option>
                        <option value="custom">Custom</option>
                      </select>
                    </label>
                    <label class="field">
                      <span>Valid from</span>
                      <input formControlName="incentiveStartDate" type="date" />
                    </label>
                    <label class="field">
                      <span>Valid to</span>
                      <input formControlName="incentiveEndDate" type="date" />
                    </label>
                    <label class="field">
                      <span>Monthly cap amount</span>
                      <input formControlName="incentiveCapAmount" type="number" min="0" step="1" />
                    </label>
                    <label class="check-field">
                      <input type="checkbox" formControlName="incentivePayrollSync" />
                      <span>Auto-add approved incentive into payroll</span>
                    </label>
                    <label class="check-field">
                      <input type="checkbox" formControlName="incentiveRequiresApproval" />
                      <span>Owner/manager approval required before payout</span>
                    </label>
                    <label class="field">
                      <span>Approval role</span>
                      <select formControlName="incentiveApprovalRole">
                        <option value="manager">Manager</option>
                        <option value="owner">Owner</option>
                        <option value="admin">Admin</option>
                      </select>
                    </label>
                  </section>

                  <section class="rule-card">
                    <div class="rule-heading">
                      <div>
                        <h2>Service, product and membership rules</h2>
                        <span>Use real service/product/membership/package targets from the database.</span>
                      </div>
                      <div class="rule-actions">
                        <button type="button" class="refresh" (click)="addIncentiveRule('service_category')">+ Service category</button>
                        <button type="button" class="refresh" (click)="addIncentiveRule('product')">+ Product</button>
                        <button type="button" class="refresh" (click)="addIncentiveRule('membership')">+ Membership</button>
                      </div>
                    </div>
                    <div class="rule-table">
                      <div class="rule-row header">
                        <span>Type</span><span>Target</span><span>Mode</span><span>Value</span><span>Min bill</span><span>Action</span>
                      </div>
                      <div class="rule-row" *ngFor="let rule of incentiveRules(); trackBy: trackById">
                        <select [value]="rule.type" (change)="setIncentiveRuleType(rule.id, $any($event.target).value)">
                          <option value="service_category">Service category</option>
                          <option value="service">Service</option>
                          <option value="product">Product</option>
                          <option value="membership">Membership</option>
                          <option value="package">Package</option>
                        </select>
                        <select *ngIf="targetOptionsFor(rule.type).length; else manualTarget" [value]="rule.targetId" (change)="setIncentiveRuleTarget(rule.id, rule.type, $any($event.target).value)">
                          <option value="">Select target</option>
                          <option *ngFor="let option of targetOptionsFor(rule.type)" [value]="option.id">{{ option.name }}{{ option.meta ? ' · ' + option.meta : '' }}</option>
                        </select>
                        <ng-template #manualTarget>
                          <input [value]="rule.targetName" (input)="updateIncentiveRule(rule.id, 'targetName', $any($event.target).value)" placeholder="Enter target name" />
                        </ng-template>
                        <select [value]="rule.calcMode" (change)="updateIncentiveRule(rule.id, 'calcMode', $any($event.target).value)">
                          <option value="percent">Percent</option>
                          <option value="fixed">Fixed amount</option>
                        </select>
                        <input [value]="rule.value" type="number" min="0" step="0.01" (input)="updateIncentiveRule(rule.id, 'value', $any($event.target).value)" />
                        <input [value]="rule.minAmount" type="number" min="0" step="1" (input)="updateIncentiveRule(rule.id, 'minAmount', $any($event.target).value)" />
                        <button type="button" class="row-action danger" (click)="removeIncentiveRule(rule.id)" [disabled]="incentiveRules().length === 1">Remove</button>
                      </div>
                    </div>
                  </section>

                  <section class="rule-card">
                    <div class="rule-heading">
                      <div>
                        <h2>Target slab incentive</h2>
                        <span>Flexi-style revenue slabs for monthly/weekly target calculation.</span>
                      </div>
                      <button type="button" class="refresh" (click)="addIncentiveSlab()">+ Add slab</button>
                    </div>
                    <div class="slab-table">
                      <div class="slab-row header"><span>From amount</span><span>To amount</span><span>Ince. %</span><span>Or amount</span><span></span></div>
                      <div class="slab-row" *ngFor="let slab of incentiveSlabs(); trackBy: trackById">
                        <input [value]="slab.fromAmount" type="number" min="0" step="1" (input)="updateIncentiveSlab(slab.id, 'fromAmount', $any($event.target).value)" />
                        <input [value]="slab.toAmount" type="number" min="0" step="1" (input)="updateIncentiveSlab(slab.id, 'toAmount', $any($event.target).value)" />
                        <input [value]="slab.incentivePercent" type="number" min="0" step="0.01" (input)="updateIncentiveSlab(slab.id, 'incentivePercent', $any($event.target).value)" />
                        <input [value]="slab.incentiveAmount" type="number" min="0" step="1" (input)="updateIncentiveSlab(slab.id, 'incentiveAmount', $any($event.target).value)" />
                        <button type="button" class="row-action danger" (click)="removeIncentiveSlab(slab.id)" [disabled]="incentiveSlabs().length === 1">Remove</button>
                      </div>
                    </div>
                  </section>

                  <section class="rule-card">
                    <div class="rule-heading">
                      <div>
                        <h2>Attendance guard and payout approval</h2>
                        <span>Control late/absent impact before incentive reaches payroll.</span>
                      </div>
                    </div>
                    <div class="advanced-grid">
                      <label class="field">
                        <span>Hold after absent days</span>
                        <input formControlName="incentiveHoldOnAbsentDays" type="number" min="0" step="1" />
                      </label>
                      <label class="field">
                        <span>Reduce after late count</span>
                        <input formControlName="incentiveReduceOnLateCount" type="number" min="0" step="1" />
                      </label>
                      <label class="field">
                        <span>Reduction %</span>
                        <input formControlName="incentiveReducePercent" type="number" min="0" step="0.01" />
                      </label>
                      <label class="field">
                        <span>Payout status</span>
                        <select formControlName="incentivePayoutStatus">
                          <option value="draft">Draft until payroll run</option>
                          <option value="ready">Ready for approval</option>
                          <option value="approved">Pre-approved</option>
                        </select>
                      </label>
                    </div>
                  </section>

                  <footer class="drawer-actions">
                    <button type="button" class="refresh" (click)="advancedIncentiveOpen.set(false)">Done</button>
                  </footer>
                </aside>
              </div>
            </ng-container>

            <ng-container *ngIf="detailTab() === 'attendance'">
              <section class="salary-command full">
                <div>
                  <span class="eyebrow">Attendance & salary</span>
                  <strong>Salary yahin employee profile ke saath save hoti hai.</strong>
                  <small>Basic salary, payment mode, statutory numbers and attendance payroll flags payroll generate mein use honge.</small>
                </div>
                <a class="refresh" routerLink="/staff-os/payroll-salary-structure">Salary Structure</a>
              </section>

              <section class="salary-summary full" aria-label="Salary profile summary">
                <article>
                  <span>Basic Salary</span>
                  <strong>{{ (staffForm.get('basicSalary')?.value || 0) | currency:'INR':'symbol-narrow':'1.0-0' }}</strong>
                </article>
                <article>
                  <span>Payment</span>
                  <strong>{{ staffForm.get('paymentMode')?.value || 'Not set' }}</strong>
                </article>
                <article>
                  <span>Structure</span>
                  <strong>{{ selectedSalaryStructureName() }}</strong>
                </article>
                <article>
                  <span>Payroll Sync</span>
                  <strong>{{ staffForm.get('supportAttendancePayroll')?.value ? 'Enabled' : 'Off' }}</strong>
                </article>
              </section>

              <label class="field">
                <span>Weekly off</span>
                <select formControlName="weeklyOff">
                  <option value="">Select weekly off</option>
                  <option value="monday">Monday</option>
                  <option value="tuesday">Tuesday</option>
                  <option value="wednesday">Wednesday</option>
                  <option value="thursday">Thursday</option>
                  <option value="friday">Friday</option>
                  <option value="saturday">Saturday</option>
                  <option value="sunday">Sunday</option>
                </select>
              </label>
              <label class="field">
                <span>Employee code in device</span>
                <input formControlName="empCodeInDevice" />
              </label>
              <label class="field">
                <span>RFID card no.</span>
                <input formControlName="rfidCardNo" />
              </label>
              <label class="field">
                <span>Attendance category</span>
                <input formControlName="attendanceCategory" placeholder="11 TO 08" />
              </label>
              <label class="field">
                <span>Default shift</span>
                <input formControlName="defaultShift" />
              </label>
              <label class="field">
                <span>Device privilege</span>
                <select formControlName="devicePrivilege">
                  <option value="user">User</option>
                  <option value="admin">Admin</option>
                </select>
              </label>
              <label class="field">
                <span>Salary structure</span>
                <select formControlName="salaryStructureId">
                  <option value="">Default salary structure</option>
                  <option *ngFor="let structure of store.payrollStructures()" [value]="structure.id">{{ structure.name }}</option>
                </select>
              </label>
              <label class="field">
                <span>Salary cycle</span>
                <select formControlName="salaryCycle">
                  <option value="monthly">Monthly</option>
                  <option value="weekly">Weekly</option>
                  <option value="daily">Daily</option>
                </select>
              </label>
              <label class="field">
                <span>Salary effective from</span>
                <input formControlName="salaryEffectiveFrom" type="date" />
              </label>
              <label class="field">
                <span>Basic salary</span>
                <input formControlName="basicSalary" type="number" min="0" step="1" />
              </label>
              <label class="field">
                <span>Payment mode</span>
                <select formControlName="paymentMode">
                  <option value="">Not set</option>
                  <option value="cash">Cash</option>
                  <option value="cheque">Cheque</option>
                  <option value="bank_transfer">Bank transfer</option>
                </select>
              </label>
              <label class="field">
                <span>Bank name</span>
                <input formControlName="bankName" />
              </label>
              <label class="field">
                <span>Account number</span>
                <input formControlName="accountNumber" />
              </label>
              <label class="field">
                <span>Loan installment</span>
                <input formControlName="loanInstallment" type="number" min="0" step="1" />
              </label>
              <label class="field">
                <span>Loan balance</span>
                <input formControlName="loanBalance" type="number" min="0" step="1" />
              </label>
              <label class="field">
                <span>OT extra rate</span>
                <input formControlName="otExtraRate" type="number" min="0" step="1" />
              </label>
              <label class="field">
                <span>Less work penalty</span>
                <input formControlName="lessWorkPenalty" type="number" min="0" step="1" />
              </label>
              <label class="check-field">
                <input type="checkbox" formControlName="supportAttendancePayroll" />
                <span>Support in attendance / payroll</span>
              </label>
              <label class="check-field">
                <input type="checkbox" formControlName="weeklyOffOvertime" />
                <span>Weekly off present as overtime</span>
              </label>
              <label class="check-field">
                <input type="checkbox" formControlName="pfApplicable" />
                <span>PF applicable</span>
              </label>
              <label class="field">
                <span>PF no.</span>
                <input formControlName="pfNo" />
              </label>
              <label class="check-field">
                <input type="checkbox" formControlName="ptApplicable" />
                <span>PT applicable</span>
              </label>
              <label class="field">
                <span>PT no.</span>
                <input formControlName="ptNo" />
              </label>
              <label class="check-field">
                <input type="checkbox" formControlName="esicApplicable" />
                <span>ESIC applicable</span>
              </label>
              <label class="field">
                <span>ESIC no.</span>
                <input formControlName="esicNo" />
              </label>
              <label class="check-field">
                <input type="checkbox" formControlName="tdsApplicable" />
                <span>TDS applicable</span>
              </label>
              <label class="field">
                <span>PAN no.</span>
                <input formControlName="panNo" />
              </label>
              <label class="field">
                <span>Aadhaar no.</span>
                <input formControlName="aadhaarNo" />
              </label>
            </ng-container>

            <ng-container *ngIf="detailTab() === 'remarks'">
              <label class="field full">
                <span>Remarks</span>
                <textarea formControlName="remarks" rows="8"></textarea>
              </label>
              <label class="field">
                <span>IMEI no.</span>
                <input formControlName="imeiNo" />
              </label>
            </ng-container>

            <div class="state error" *ngIf="addStaffError()">{{ addStaffError() }}</div>

            <footer class="drawer-actions" aria-label="Employee actions">
              <section class="live-employee-panel" aria-label="Connected live employee data">
                <div class="live-panel-title">
                  <span>Live Data</span>
                  <strong>{{ selectedBranchName() }}</strong>
                </div>
                <article *ngFor="let card of employeeLiveCards()" [ngClass]="card.tone">
                  <span>{{ card.label }}</span>
                  <strong>{{ card.value }}</strong>
                  <small>{{ card.hint }}</small>
                </article>
                <div class="catalog-mini-grid">
                  <article *ngFor="let card of employeeCatalogCards()">
                    <span>{{ card.label }}</span>
                    <strong>{{ card.value }}</strong>
                  </article>
                </div>
                <nav class="live-panel-links" aria-label="Employee connected modules">
                  <a *ngFor="let link of activeIntegrationLinks()" [routerLink]="link.to" [queryParams]="staffContextParams()">{{ link.label }}</a>
                </nav>
              </section>
              <div class="drawer-action-buttons">
                <button type="button" class="refresh" (click)="closeAddStaff()">Back To Search</button>
                <button type="submit" class="primary" [disabled]="staffForm.invalid || addStaffSaving()">
                  {{ addStaffSaving() ? 'Saving...' : 'Save Employee' }}
                </button>
              </div>
            </footer>
          </form>
        </aside>
      </div>

      <section class="panel attendance-command" *ngIf="section === 'attendance-dashboard'">
        <div class="panel-heading">
          <div>
            <h2>Advanced Attendance Control</h2>
            <span>Physical entry, biometric devices, camera punch and payroll attendance</span>
          </div>
          <div class="attendance-controls">
            <select [ngModel]="attendanceBranchId()" (ngModelChange)="setAttendanceBranch($event)" aria-label="Attendance branch">
              <option value="">Select branch</option>
              <option *ngFor="let branch of branchOptions()" [value]="branch.id">{{ branch.name || branch.id }}</option>
            </select>
            <input type="date" [value]="attendanceDate()" (change)="setAttendanceDate($any($event.target).value)" />
            <button type="button" class="refresh" (click)="refreshAttendanceCenter()">Refresh</button>
            <button type="button" class="primary" [disabled]="queueProcessing()" (click)="processBiometricQueue()">
              {{ queueProcessing() ? 'Processing...' : 'Process biometric queue' }}
            </button>
          </div>
        </div>
        <div class="attendance-stats">
          <article><span>Devices</span><strong>{{ attendanceSummary()['activeDevices'] || 0 }}/{{ attendanceSummary()['devices'] || 0 }}</strong><small>active / total</small></article>
          <article><span>Gateway</span><strong>{{ attendanceSummary()['onlineGateways'] || 0 }}/{{ attendanceSummary()['gateways'] || 0 }}</strong><small>Windows sync agents</small></article>
          <article><span>Attendance</span><strong>{{ attendanceSummary()['attendanceEvents'] || 0 }}</strong><small>{{ attendanceDate() }}</small></article>
          <article><span>Camera</span><strong>{{ attendanceSummary()['cameraCaptures'] || 0 }}</strong><small>verified captures</small></article>
          <article><span>Consent</span><strong>{{ attendanceSummary()['consentGranted'] || 0 }}</strong><small>{{ attendanceSummary()['consentPending'] || 0 }} pending</small></article>
          <article><span>Queue</span><strong>{{ attendanceSummary()['queuedEvents'] || 0 }}</strong><small>{{ attendanceSummary()['failedEvents'] || 0 }} failed</small></article>
          <article><span>Suspicious</span><strong>{{ attendanceSummary()['suspiciousEvents'] || 0 }}</strong><small>review required</small></article>
          <article><span>Payroll</span><strong>{{ attendanceSummary()['payrollPreviewRows'] || 0 }}</strong><small>{{ attendanceSummary()['ownerAlerts'] || 0 }} owner alerts</small></article>
        </div>
        <div class="attendance-live-strip">
          <article>
            <span>Branch</span>
            <strong>{{ attendanceBranchLabel() }}</strong>
            <small>{{ activeStaffForAttendance().length }} active staff</small>
          </article>
          <article>
            <span>Coverage</span>
            <strong>{{ attendanceCoveragePct() }}%</strong>
            <small>{{ uniqueAttendanceStaffCount() }} of {{ activeStaffForAttendance().length }} punched</small>
          </article>
          <article>
            <span>Open risks</span>
            <strong>{{ openAttendanceRiskCount() }}</strong>
            <small>{{ payrollHoldCount() }} payroll hold</small>
          </article>
          <article>
            <span>Last sync</span>
            <strong>{{ attendanceLastSyncLabel() }}</strong>
            <small>{{ gatewayStatusLabel() }}</small>
          </article>
        </div>
        <div class="state error" *ngIf="attendanceError()">{{ attendanceError() }}</div>
        <div class="state success" *ngIf="attendanceMessage()">{{ attendanceMessage() }}</div>
      </section>

      <section class="attendance-ops-grid" *ngIf="section === 'attendance-dashboard'">
        <article class="attendance-op-card" *ngFor="let card of attendanceOpsCards()" [ngClass]="card.tone">
          <span>{{ card.label }}</span>
          <strong>{{ card.value }}</strong>
          <small>{{ card.hint }}</small>
        </article>
      </section>

      <section class="panel attendance-exception-panel" *ngIf="section === 'attendance-dashboard'">
        <div class="panel-heading">
          <div>
            <p class="eyebrow">Owner queue</p>
            <h2>Attendance Exceptions</h2>
          </div>
          <div class="attendance-controls">
            <button type="button" class="refresh" [disabled]="fraudScanning()" (click)="runFraudScan()">{{ fraudScanning() ? 'Checking...' : 'Run risk check' }}</button>
            <button type="button" class="primary" [disabled]="payrollPreviewForm.invalid || payrollPreviewSaving()" (click)="generatePayrollPreview()">{{ payrollPreviewSaving() ? 'Generating...' : 'Generate payroll preview' }}</button>
          </div>
        </div>
        <div class="table compact exception-table">
          <div class="row header"><span>Signal</span><span>Staff</span><span>Impact</span><span>Status</span></div>
          <div class="row" *ngFor="let item of attendanceExceptionRows()">
            <span><strong>{{ item['title'] }}</strong><small>{{ item['meta'] }}</small></span>
            <span>{{ item['staff'] }}</span>
            <span>{{ item['impact'] }}</span>
            <span><span class="badge" [ngClass]="item['tone']">{{ item['status'] }}</span></span>
          </div>
          <div *ngIf="!attendanceExceptionRows().length && !store.loading()" class="empty action-empty"><strong>No attendance exceptions.</strong><span>{{ attendanceDate() }} looks clean for payroll preview.</span></div>
        </div>
      </section>

      <section class="attendance-workspace" *ngIf="section === 'attendance-dashboard'">
        <article class="panel physical-panel">
          <div class="panel-heading">
            <div>
              <h2>Physical Attendance Entry</h2>
              <span>Manual register entry writes into the same live attendance log.</span>
            </div>
            <span class="badge">Physical</span>
          </div>
          <form class="staff-form camera-form manual-form" [formGroup]="manualAttendanceForm" (ngSubmit)="submitManualAttendance()">
            <label class="field">
              <span>Branch</span>
              <select formControlName="branchId" (change)="refreshAttendanceCenter()">
                <option value="">Select branch</option>
                <option *ngFor="let branch of branchOptions()" [value]="branch.id">{{ branch.name || branch.id }}</option>
              </select>
            </label>
            <label class="field">
              <span>Staff</span>
              <select formControlName="staffId">
                <option value="">Select staff</option>
                <option *ngFor="let staff of activeStaffForAttendance()" [value]="staff.id">{{ staff.fullName }} {{ staff.employeeCode ? '(' + staff.employeeCode + ')' : '' }}</option>
              </select>
            </label>
            <label class="field">
              <span>Entry type</span>
              <select formControlName="punchType">
                <option value="full_day">Full day present</option>
                <option value="clock_in">Clock in only</option>
                <option value="clock_out">Clock out only</option>
              </select>
            </label>
            <label class="field">
              <span>In time</span>
              <input type="time" formControlName="clockInTime" />
            </label>
            <label class="field">
              <span>Out time</span>
              <input type="time" formControlName="clockOutTime" />
            </label>
            <label class="field">
              <span>OT minutes</span>
              <input type="number" min="0" step="1" formControlName="overtimeMinutes" />
            </label>
            <label class="field full">
              <span>Notes</span>
              <input formControlName="notes" placeholder="Physical register, manager entry, missed punch" />
            </label>
            <div class="drawer-actions">
              <button type="submit" class="primary" [disabled]="manualAttendanceForm.invalid || manualAttendanceSaving()">
                {{ manualAttendanceSaving() ? 'Saving...' : 'Save physical attendance' }}
              </button>
              <a class="refresh" routerLink="/staff-os/attendance-master" [queryParams]="staffContextParams()">Attendance Master</a>
              <a class="refresh" routerLink="/staff-os/salary-generate" [queryParams]="staffContextParams()">Salary Generate</a>
            </div>
          </form>
        </article>

        <article class="panel camera-panel">
          <div class="panel-heading">
            <h2>Camera Punch</h2>
            <span>{{ cameraActive() ? 'Camera active' : 'Camera off' }}</span>
          </div>
          <div class="camera-stage">
            <video #attendanceVideo autoplay muted playsinline [class.hidden]="!cameraActive()"></video>
            <div class="camera-placeholder" *ngIf="!cameraActive()">Camera preview</div>
          </div>
          <form class="staff-form camera-form" [formGroup]="cameraForm" (ngSubmit)="submitCameraPunch()">
            <label class="field">
              <span>Branch</span>
              <select formControlName="branchId" (change)="refreshAttendanceCenter()">
                <option value="">Select branch</option>
                <option *ngFor="let branch of branchOptions()" [value]="branch.id">{{ branch.name || branch.id }}</option>
              </select>
            </label>
            <label class="field">
              <span>Staff</span>
              <select formControlName="staffId">
                <option value="">Select staff</option>
                <option *ngFor="let staff of activeStaffForAttendance()" [value]="staff.id">{{ staff.fullName }} {{ staff.employeeCode ? '(' + staff.employeeCode + ')' : '' }}</option>
              </select>
            </label>
            <label class="field">
              <span>Punch</span>
              <select formControlName="punchType">
                <option value="clock_in">Clock in</option>
                <option value="clock_out">Clock out</option>
              </select>
            </label>
            <label class="field">
              <span>Liveness</span>
              <input type="number" min="0" max="1" step="0.01" formControlName="livenessScore" />
            </label>
            <label class="field">
              <span>Face match</span>
              <input type="number" min="0" max="1" step="0.01" formControlName="matchScore" />
            </label>
            <label class="field full">
              <span>Notes</span>
              <input formControlName="notes" placeholder="Gate, reception, mobile punch" />
            </label>
            <div class="drawer-actions">
              <button type="button" class="refresh" [disabled]="cameraStarting()" (click)="startCamera()">{{ cameraStarting() ? 'Opening...' : 'Start camera' }}</button>
              <button type="button" class="refresh" (click)="stopCamera()">Stop</button>
              <button type="submit" class="primary" [disabled]="cameraForm.invalid || cameraSaving() || !cameraActive()">
                {{ cameraSaving() ? 'Saving...' : 'Save camera punch' }}
              </button>
            </div>
          </form>
        </article>

        <article class="panel">
          <div class="panel-heading">
            <h2>Biometric Device Hub</h2>
            <span>{{ store.biometricDevices().length }} devices</span>
          </div>
          <form class="device-form" [formGroup]="deviceForm" (ngSubmit)="registerBiometricDevice()">
            <label class="field">
              <span>Branch</span>
              <select formControlName="branchId">
                <option value="">Select branch</option>
                <option *ngFor="let branch of branchOptions()" [value]="branch.id">{{ branch.name || branch.id }}</option>
              </select>
            </label>
            <label class="field">
              <span>Provider</span>
              <select formControlName="provider">
                <option value="zkteco">ZKTeco</option>
                <option value="essl">eSSL</option>
                <option value="mantra">Mantra</option>
                <option value="suprema">Suprema</option>
                <option value="realtime_biometrics">Realtime Biometrics</option>
                <option value="camera">Camera</option>
                <option value="manual">Manual</option>
              </select>
            </label>
            <label class="field"><span>Device code</span><input formControlName="deviceCode" /></label>
            <label class="field"><span>Name</span><input formControlName="deviceName" /></label>
            <label class="field"><span>Location</span><input formControlName="locationLabel" /></label>
            <label class="field">
              <span>Mode</span>
              <select formControlName="connectionMode">
                <option value="offline_sync">Offline sync</option>
                <option value="api">API</option>
                <option value="webhook">Webhook</option>
                <option value="browser_camera">Browser camera</option>
              </select>
            </label>
            <button type="submit" class="primary" [disabled]="deviceForm.invalid || deviceSaving()">{{ deviceSaving() ? 'Saving...' : 'Add device' }}</button>
          </form>
          <div class="table compact device-table">
            <div class="row header"><span>Device</span><span>Provider</span><span>Mode</span><span>Status</span></div>
            <div class="row" *ngFor="let device of store.biometricDevices()">
              <span><strong>{{ device['deviceName'] || device['deviceCode'] }}</strong><small>{{ device['locationLabel'] || device['deviceCode'] }}</small></span>
              <span>{{ device['provider'] }}</span>
              <span>{{ device['connectionMode'] }}</span>
              <span class="badge">{{ device['lastHealthStatus'] || device['status'] }}</span>
            </div>
            <div *ngIf="!store.biometricDevices().length && !store.loading()" class="empty action-empty"><strong>No biometric devices registered.</strong><span>Add a device or use camera punch for mobile-first attendance.</span></div>
          </div>
        </article>
      </section>

      <section class="attendance-workspace attendance-wide" *ngIf="section === 'attendance-dashboard'">
        <article class="panel">
          <div class="panel-heading">
            <div>
              <h2>Real Biometric Gateway</h2>
              <span>ZKTeco, eSSL, Mantra, Suprema, RFID, QR, NFC and beacon punch sync</span>
            </div>
            <span class="badge">{{ gatewayRows().length }} agents</span>
          </div>
          <form class="device-form gateway-form" [formGroup]="gatewayForm" (ngSubmit)="registerGateway()">
            <label class="field">
              <span>Branch</span>
              <select formControlName="branchId">
                <option value="">Select branch</option>
                <option *ngFor="let branch of branchOptions()" [value]="branch.id">{{ branch.name || branch.id }}</option>
              </select>
            </label>
            <label class="field"><span>Gateway code</span><input formControlName="gatewayCode" placeholder="FRONT-DESK-PC-01" /></label>
            <label class="field"><span>Name</span><input formControlName="displayName" placeholder="Front desk gateway" /></label>
            <label class="field"><span>Machine</span><input formControlName="machineName" /></label>
            <label class="field"><span>Version</span><input formControlName="versionLabel" placeholder="1.0.0" /></label>
            <label class="field"><span>Providers</span><input formControlName="providers" /></label>
            <button type="submit" class="primary" [disabled]="gatewayForm.invalid || gatewaySaving()">{{ gatewaySaving() ? 'Saving...' : 'Register gateway' }}</button>
          </form>
          <div class="table compact device-table">
            <div class="row header"><span>Gateway</span><span>Machine</span><span>Status</span><span>Last seen</span></div>
            <div class="row" *ngFor="let gateway of gatewayRows()">
              <span><strong>{{ gateway['displayName'] || gateway['gatewayCode'] }}</strong><small>{{ gateway['gatewayCode'] }}</small></span>
              <span>{{ gateway['machineName'] || 'Windows gateway' }}</span>
              <span class="badge">{{ gateway['healthStatus'] }}</span>
              <span>{{ timeOnly(gateway['lastSeenAt']) || 'not seen' }}</span>
            </div>
            <div *ngIf="!gatewayRows().length && !store.loading()" class="empty action-empty"><strong>No gateway registered for selected branch.</strong><span>Register a gateway to sync real biometric attendance.</span></div>
          </div>
        </article>

        <article class="panel">
          <div class="panel-heading">
            <div>
              <h2>Staff Mapping UI</h2>
              <span>Map biometric external user IDs to real staff records</span>
            </div>
            <span class="badge">{{ store.biometricMappings().length }} mappings</span>
          </div>
          <form class="device-form mapping-form" [formGroup]="mappingForm" (ngSubmit)="createBiometricMapping()">
            <label class="field">
              <span>Device</span>
              <select formControlName="deviceId">
                <option value="">Select device</option>
                <option *ngFor="let device of store.biometricDevices()" [value]="device['id']">{{ device['deviceName'] || device['deviceCode'] }}</option>
              </select>
            </label>
            <label class="field">
              <span>Staff</span>
              <select formControlName="staffId">
                <option value="">Select staff</option>
                <option *ngFor="let staff of activeStaffForAttendance()" [value]="staff.id">{{ staff.fullName }}</option>
              </select>
            </label>
            <label class="field"><span>External user ID</span><input formControlName="externalUserId" placeholder="Device user id" /></label>
            <label class="field"><span>Notes</span><input formControlName="notes" /></label>
            <button type="submit" class="primary" [disabled]="mappingForm.invalid || mappingSaving()">{{ mappingSaving() ? 'Saving...' : 'Map staff' }}</button>
          </form>
          <div class="table compact mapping-table">
            <div class="row header"><span>Staff</span><span>Device</span><span>External ID</span><span>Status</span><span>Action</span></div>
            <div class="row" *ngFor="let mapping of store.biometricMappings()">
              <span>{{ mapping['staffName'] || mapping['staffId'] }}</span>
              <span>{{ mapping['deviceLabel'] || mapping['deviceId'] }}</span>
              <span>{{ mapping['externalUserId'] }}</span>
              <span class="badge">{{ mapping['status'] }}</span>
              <span>
                <button type="button" class="refresh mini" *ngIf="mapping['status'] !== 'approved'" (click)="approveBiometricMapping(mapping)">Approve</button>
              </span>
            </div>
            <div *ngIf="!store.biometricMappings().length && !store.loading()" class="empty action-empty"><strong>No staff biometric mappings yet.</strong><span>Map staff with device user IDs to connect attendance and salary.</span></div>
          </div>
        </article>
      </section>

      <section class="attendance-workspace attendance-wide" *ngIf="section === 'attendance-dashboard'">
        <article class="panel">
          <div class="panel-heading">
            <div>
              <h2>Privacy And Consent Center</h2>
              <span>Biometric consent, retention and delete request controls</span>
            </div>
            <span class="badge">{{ store.biometricConsents().length }} records</span>
          </div>
          <form class="device-form consent-form" [formGroup]="consentForm" (ngSubmit)="saveBiometricConsent()">
            <label class="field">
              <span>Staff</span>
              <select formControlName="staffId">
                <option value="">Select staff</option>
                <option *ngFor="let staff of activeStaffForAttendance()" [value]="staff.id">{{ staff.fullName }}</option>
              </select>
            </label>
            <label class="field">
              <span>Status</span>
              <select formControlName="consentStatus">
                <option value="granted">Granted</option>
                <option value="pending">Pending</option>
                <option value="revoked">Revoked</option>
              </select>
            </label>
            <label class="field">
              <span>Channel</span>
              <select formControlName="consentChannel">
                <option value="paper">Paper</option>
                <option value="digital">Digital</option>
                <option value="manager_verified">Manager verified</option>
              </select>
            </label>
            <label class="field"><span>Retention days</span><input type="number" min="30" formControlName="retentionDays" /></label>
            <label class="field full"><span>Consent text</span><input formControlName="consentText" /></label>
            <button type="submit" class="primary" [disabled]="consentForm.invalid || consentSaving()">{{ consentSaving() ? 'Saving...' : 'Save consent' }}</button>
          </form>
          <div class="table compact mapping-table">
            <div class="row header"><span>Staff</span><span>Status</span><span>Retention</span><span>Delete</span><span>Action</span></div>
            <div class="row" *ngFor="let consent of store.biometricConsents()">
              <span>{{ consent['staffName'] || consent['staffId'] }}</span>
              <span class="badge">{{ consent['consentStatus'] }}</span>
              <span>{{ consent['retentionDays'] }} days</span>
              <span>{{ consent['deleteRequested'] ? 'requested' : 'no' }}</span>
              <span><button type="button" class="refresh mini" (click)="requestConsentDeletion(consent)">Delete request</button></span>
            </div>
            <div *ngIf="!store.biometricConsents().length && !store.loading()" class="empty action-empty"><strong>No biometric consent captured yet.</strong><span>Capture consent before biometric attendance goes live.</span></div>
          </div>
        </article>

        <article class="panel">
          <div class="panel-heading">
            <div>
              <h2>Payroll Risk Review</h2>
              <span>Risk scan, owner alerts and attendance deduction preview from real punches</span>
            </div>
            <button type="button" class="refresh" [disabled]="fraudScanning()" (click)="runFraudScan()">{{ fraudScanning() ? 'Checking...' : 'Run risk check' }}</button>
          </div>
          <form class="device-form payroll-form" [formGroup]="payrollPreviewForm" (ngSubmit)="generatePayrollPreview()">
            <label class="field"><span>From</span><input type="date" formControlName="periodStart" /></label>
            <label class="field"><span>To</span><input type="date" formControlName="periodEnd" /></label>
            <label class="field"><span>Shift start</span><input type="time" formControlName="defaultShiftStart" /></label>
            <label class="field"><span>Late grace</span><input type="number" min="0" formControlName="lateGraceMinutes" /></label>
            <label class="field"><span>Hold absent days</span><input type="number" min="0" formControlName="incentiveHoldAbsentDays" /></label>
            <label class="field"><span>Default gross</span><input type="number" min="0" formControlName="defaultGrossAmount" /></label>
            <button type="submit" class="primary" [disabled]="payrollPreviewForm.invalid || payrollPreviewSaving()">{{ payrollPreviewSaving() ? 'Generating...' : 'Payroll preview' }}</button>
          </form>
          <div class="table compact risk-table">
            <div class="row header"><span>Risk / Payroll</span><span>Score</span><span>Amount</span><span>Status</span></div>
            <div class="row" *ngFor="let risk of store.attendanceRisks()">
              <span><strong>{{ risk['riskType'] }}</strong><small>{{ risk['reason'] }}</small></span>
              <span>{{ risk['riskScore'] }}</span>
              <span>{{ risk['severity'] }}</span>
              <span class="badge">{{ risk['status'] }}</span>
            </div>
            <div class="row" *ngFor="let row of store.attendancePayrollPreview()">
              <span><strong>{{ displayStaffName(row) }}</strong><small>{{ row['presentDays'] || 0 }} present · {{ row['lateCount'] || 0 }} late</small></span>
              <span>{{ row['absentDays'] || 0 }} absent</span>
              <span>₹{{ row['netPreview'] || 0 }}</span>
              <span class="badge">{{ row['incentiveHold'] ? 'hold' : 'draft' }}</span>
            </div>
            <div *ngIf="!store.attendanceRisks().length && !store.attendancePayrollPreview().length && !store.loading()" class="empty action-empty"><strong>No payroll risk output yet.</strong><span>Run risk check or payroll preview to view results.</span></div>
          </div>
        </article>
      </section>

      <section class="panel attendance-register-panel" *ngIf="section === 'attendance-dashboard'">
        <div class="panel-heading attendance-register-heading">
          <div>
            <p class="eyebrow">Attendance register</p>
            <h2>Live Attendance Evidence</h2>
          </div>
          <span>{{ attendanceRows().length }} attendance rows</span>
        </div>
        <div class="attendance-register-scroll">
          <table class="attendance-register-table">
            <thead>
              <tr>
                <th>Staff</th>
                <th>Business date</th>
                <th>Source</th>
                <th>Clock in</th>
                <th>Clock out</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              <tr *ngFor="let row of attendanceRows()">
                <td><strong>{{ displayStaffName(row) }}</strong></td>
                <td>{{ row['businessDate'] || row['business_date'] }}</td>
                <td>{{ row['source'] || 'manual' }}</td>
                <td>{{ timeOnly(row['clockInAt'] || row['clock_in_at']) || '-' }}</td>
                <td>{{ timeOnly(row['clockOutAt'] || row['clock_out_at']) || 'open' }}</td>
                <td><span class="badge">{{ row['status'] }}</span></td>
              </tr>
            </tbody>
          </table>
          <div *ngIf="!attendanceRows().length && !store.loading()" class="empty action-empty">
            <strong>No attendance events for selected date.</strong>
            <span>Use physical entry, camera punch or biometric queue to create live attendance.</span>
            <a class="refresh" routerLink="/staff-os/attendance-master" [queryParams]="staffContextParams()">Attendance master</a>
          </div>
        </div>
        <div class="staff-register-footer">
          <span>{{ attendanceRows().length ? 1 : 0 }} to {{ attendanceRows().length }} of {{ attendanceRows().length }}</span>
          <span>Page 1 of 1</span>
        </div>
      </section>

      <section class="panel roster-register-panel" *ngIf="section === 'roster-calendar'">
        <div class="panel-heading roster-register-heading">
          <div>
            <p class="eyebrow">Roster register</p>
            <h2>Roster And Attendance</h2>
          </div>
          <div class="staff-register-actions">
            <span>{{ store.schedules().length }} shifts</span>
            <a class="refresh" routerLink="/staff-os/shift-master" [queryParams]="staffContextParams()">Shift Master</a>
            <button type="button" class="refresh" (click)="store.load()">Refresh</button>
          </div>
        </div>

        <div class="roster-kpi-strip">
          <article><span>Roster shifts</span><strong>{{ store.schedules().length }}</strong><small>live schedule rows</small></article>
          <article><span>Available staff</span><strong>{{ activeStaffForRoster().length }}</strong><small>not hidden from roster</small></article>
          <article><span>Shift templates</span><strong>{{ rosterShiftOptions().length }}</strong><small>branch setup</small></article>
          <article><span>Today attendance</span><strong>{{ attendanceRows().length }}</strong><small>{{ attendanceDate() }}</small></article>
        </div>

        <form class="staff-form camera-form task-create-form roster-assign-form" [formGroup]="rosterForm" (ngSubmit)="assignRosterShift()">
          <label class="field">
            <span>Branch</span>
            <select formControlName="branchId">
              <option *ngFor="let branch of branchOptions()" [value]="branch.id">{{ branch.name || branch.id }}</option>
            </select>
          </label>
          <label class="field">
            <span>Staff</span>
            <select formControlName="staffId">
              <option value="">Select staff</option>
              <option *ngFor="let staff of activeStaffForRoster()" [value]="staff.id">{{ staff.fullName }}</option>
            </select>
          </label>
          <label class="field">
            <span>Date</span>
            <input formControlName="scheduleDate" type="date" />
          </label>
          <label class="field">
            <span>Shift</span>
            <select formControlName="shiftTemplateId">
              <option value="">Select shift</option>
              <option *ngFor="let shift of rosterShiftOptions()" [value]="shift.id">{{ shift.name }} · {{ shift.startTime }} - {{ shift.endTime }}</option>
            </select>
          </label>
          <label class="field full">
            <span>Notes</span>
            <input formControlName="notes" placeholder="Optional roster note" />
          </label>
          <div class="drawer-actions">
            <button type="submit" class="primary" [disabled]="rosterForm.invalid || rosterSaving()">{{ rosterSaving() ? 'Saving...' : 'Assign Shift' }}</button>
            <span class="form-message" *ngIf="rosterMessage()">{{ rosterMessage() }}</span>
            <span class="error-message" *ngIf="rosterError()">{{ rosterError() }}</span>
          </div>
        </form>
        <div class="heatmap roster-heatmap" aria-label="Roster heatmap">
          <span *ngFor="let cell of heatmapCells; let index = index" [style.opacity]="opacity(index)"></span>
        </div>
        <div class="roster-register-scroll">
          <table class="roster-register-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Staff</th>
                <th>Timing</th>
                <th>Branch</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              <tr *ngFor="let shift of store.schedules()">
                <td>{{ shift.scheduleDate }}</td>
                <td>{{ staffNameById(shift.staffId) }}</td>
                <td>{{ shift.startTime }} - {{ shift.endTime }}</td>
                <td>{{ shift.branchId }}</td>
                <td><span class="badge">{{ shift.status }}</span></td>
              </tr>
            </tbody>
          </table>
          <div *ngIf="!store.schedules().length && !store.loading()" class="empty action-empty">
            <strong>No roster data for the selected branch.</strong>
            <span>Create shift master or roster entries to see staff availability.</span>
            <a class="refresh" routerLink="/staff-os/shift-master" [queryParams]="staffContextParams()">Create shift setup</a>
          </div>
        </div>
        <div class="staff-register-footer">
          <span>{{ store.schedules().length ? 1 : 0 }} to {{ store.schedules().length }} of {{ store.schedules().length }}</span>
          <span>Page 1 of 1</span>
        </div>
      </section>

      <section class="panel" *ngIf="section === 'leave-management'">
        <div class="panel-heading">
          <h2>Leave Request And Approval</h2>
          <span>{{ store.leaves().length }} live leave rows</span>
        </div>
        <form class="staff-form camera-form task-create-form" [formGroup]="leaveForm" (ngSubmit)="submitLeaveRequest()">
          <label class="field">
            <span>Branch</span>
            <select formControlName="branchId" (change)="refreshLeaveManagement()">
              <option *ngFor="let branch of branchOptions()" [value]="branch.id">{{ branch.name || branch.id }}</option>
            </select>
          </label>
          <label class="field">
            <span>Staff</span>
            <select formControlName="staffId">
              <option value="">Select staff</option>
              <option *ngFor="let staff of activeStaffForLeave()" [value]="staff.id">{{ staff.fullName }}</option>
            </select>
          </label>
          <label class="field">
            <span>Leave type</span>
            <select formControlName="leaveType">
              <option value="">Select leave type</option>
              <option *ngFor="let leave of leaveTypeOptions()" [value]="leave.code">{{ leave.name }} · {{ leave.code }}</option>
            </select>
          </label>
          <label class="field">
            <span>Start date</span>
            <input formControlName="startDate" type="date" />
          </label>
          <label class="field">
            <span>End date</span>
            <input formControlName="endDate" type="date" />
          </label>
          <label class="field full">
            <span>Reason</span>
            <input formControlName="reason" placeholder="Leave reason" />
          </label>
          <div class="drawer-actions">
            <button type="submit" class="primary" [disabled]="leaveForm.invalid || leaveSaving()">{{ leaveSaving() ? 'Saving...' : 'Request leave' }}</button>
            <button type="button" class="refresh" (click)="refreshLeaveManagement()">Refresh leaves</button>
            <span class="form-message" *ngIf="leaveMessage()">{{ leaveMessage() }}</span>
            <span class="error-message" *ngIf="leaveError()">{{ leaveError() }}</span>
          </div>
        </form>
        <div class="table compact">
          <div class="row header"><span>Date</span><span>Staff</span><span>Leave</span><span>Status</span></div>
          <div class="row" *ngFor="let leave of leaveRows()">
            <span>{{ leaveDateRange(leave) }}<small>{{ leave['branchId'] || leave['branch_id'] }}</small></span>
            <span><strong>{{ displayStaffName(leave) }}</strong><small>{{ leave['staffId'] || leave['staff_id'] }}</small></span>
            <span>{{ leaveTypeName(leave) }}<small>{{ leave['reason'] || 'No reason' }}</small></span>
            <span class="leave-actions">
              <span class="badge" [class.warn]="leave['status'] === 'pending'">{{ leave['status'] || 'pending' }}</span>
              <button type="button" class="refresh" *ngIf="leave['status'] === 'pending'" [disabled]="leaveDecisionChanging() === leave['id']" (click)="decideLeave(leave, 'approved')">Approve</button>
              <button type="button" class="refresh danger" *ngIf="leave['status'] === 'pending'" [disabled]="leaveDecisionChanging() === leave['id']" (click)="decideLeave(leave, 'rejected')">Reject</button>
            </span>
          </div>
          <div *ngIf="!store.leaves().length && !store.loading()" class="empty action-empty">
            <strong>No leave entries yet.</strong>
            <span>Leave request save karo; approve hone ke baad heatmap, payroll aur leave balance me live dikhega.</span>
            <a class="refresh" routerLink="/staff-os/heatmaps/leave-calendar" [queryParams]="staffContextParams()">Open leave heatmap</a>
          </div>
        </div>
      </section>

      <section class="panel" *ngIf="section === 'performance-dashboard' || section === 'leaderboard' || section === 'commission-dashboard'">
        <div class="panel-heading">
          <h2>Performance Intelligence</h2>
          <span>Avg score {{ store.performance().summary.avgScore | number:'1.0-0' }}</span>
        </div>
        <section class="commission-setup" *ngIf="section === 'commission-dashboard'">
          <div>
            <span class="eyebrow">Add commission</span>
            <strong>Commission dashboard report ke liye hai. Commission rule yahan se add karo.</strong>
          </div>
          <div class="commission-actions">
            <a routerLink="/staff-os/target-incentives/service">Service commission</a>
            <a routerLink="/staff-os/target-incentives/product">Product commission</a>
            <a routerLink="/staff-os/target-incentives/membership">Membership commission</a>
            <a routerLink="/staff-os/payroll-rules">Default % rules</a>
          </div>
        </section>
        <div class="split">
          <article>
            <strong>{{ store.performance().summary.revenue | currency:'INR':'symbol-narrow':'1.0-0' }}</strong>
            <span>Tracked revenue</span>
          </article>
          <article>
            <strong>{{ store.performance().summary.avgUtilization | number:'1.0-0' }}%</strong>
            <span>Avg utilization</span>
          </article>
        </div>
        <div class="table compact">
          <div class="row header"><span>Staff</span><span>Score</span><span>Revenue</span><span>Utilization</span></div>
          <div class="row" *ngFor="let row of store.performance().rows">
            <span>{{ row.staffId }}</span>
            <span>{{ row.productivityScore | number:'1.0-0' }}</span>
            <span>{{ row.revenueGenerated | currency:'INR':'symbol-narrow':'1.0-0' }}</span>
            <span>{{ row.utilizationPct | number:'1.0-0' }}%</span>
          </div>
          <div *ngIf="!store.performance().rows.length && !store.loading()" class="empty action-empty">
            <strong>No performance rows yet.</strong>
            <span>Connect invoices and staff assignment to generate seller ranking.</span>
            <a class="refresh" routerLink="/reports/staff-sales" [queryParams]="staffContextParams()">Open staff sales</a>
          </div>
        </div>
      </section>

      <section class="panel payroll-register-panel" *ngIf="section === 'payroll-dashboard'">
        <div class="panel-heading payroll-register-heading">
          <div>
            <p class="eyebrow">Payroll register</p>
            <h2>Salary And Payroll Control</h2>
          </div>
          <div class="staff-register-actions">
            <span>{{ staffDirectoryRows().length }} staff</span>
            <a class="refresh" routerLink="/staff-os/payroll-history" [queryParams]="staffContextParams()">Payroll History</a>
            <a class="refresh" routerLink="/staff-os/salary-generate" [queryParams]="staffContextParams()">Salary Generate</a>
            <a class="refresh" routerLink="/staff-os/payroll-salary-structure">Salary Structure</a>
            <button type="button" class="refresh" (click)="store.load()">Refresh</button>
          </div>
        </div>

        <div class="payroll-kpi-strip">
          <article><span>Salary profiles</span><strong>{{ salaryProfileCount() }}</strong><small>staff salary setup</small></article>
          <article><span>Structures</span><strong>{{ store.payrollStructures().length }}</strong><small>payroll rules</small></article>
          <article><span>Preview rows</span><strong>{{ store.attendancePayrollPreview().length }}</strong><small>attendance payroll</small></article>
          <article><span>Risk signals</span><strong>{{ store.attendanceRisks().length }}</strong><small>hold / mismatch</small></article>
        </div>

        <div class="payroll-register-scroll">
          <table class="payroll-register-table">
            <thead>
              <tr>
                <th>Staff</th>
                <th>Basic salary</th>
                <th>Payment</th>
                <th>Payroll sync</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              <tr *ngFor="let staff of staffDirectoryRows()">
                <td>
                  <strong>{{ staff.fullName }}</strong>
                  <small>{{ staff.employeeCode || staff.designation || staff.department || staff.id }}</small>
                </td>
                <td>{{ salaryAmount(staff) | currency:'INR':'symbol-narrow':'1.0-0' }}</td>
                <td>{{ salaryProfile(staff)['paymentMode'] || 'Not set' }}</td>
                <td>{{ salaryProfile(staff)['supportAttendancePayroll'] ? 'Attendance sync' : 'Manual review' }}</td>
                <td><span class="badge">{{ staff.status }}</span></td>
              </tr>
            </tbody>
          </table>
          <div *ngIf="!staffDirectoryRows().length && !store.loading()" class="empty action-empty">
            <strong>No payroll staff found.</strong>
            <span>Add employee salary details to start payroll preview.</span>
            <a class="refresh" routerLink="/staff-os/staff-list" [queryParams]="{ add: 1 }">Add staff</a>
          </div>
        </div>

        <div class="payroll-risk-strip" *ngIf="store.attendancePayrollPreview().length || store.attendanceRisks().length">
          <article *ngFor="let row of store.attendancePayrollPreview().slice(0, 4)">
            <strong>{{ displayStaffName(row) }}</strong>
            <span>{{ row['presentDays'] || 0 }} present · {{ row['lateCount'] || 0 }} late · ₹{{ row['netPreview'] || 0 }}</span>
          </article>
          <article *ngFor="let risk of store.attendanceRisks().slice(0, 4)">
            <strong>{{ risk['riskType'] || 'Risk' }}</strong>
            <span>{{ risk['severity'] || 'review' }} · {{ risk['reason'] || 'Payroll check' }}</span>
          </article>
        </div>

        <div class="staff-register-footer">
          <span>{{ staffDirectoryRows().length ? 1 : 0 }} to {{ staffDirectoryRows().length }} of {{ staffDirectoryRows().length }}</span>
          <span>Page 1 of 1</span>
        </div>
      </section>

      <section class="panel" *ngIf="section === 'task-board' || section === 'mobile-staff-dashboard-preview'">
        <div class="panel-heading">
          <h2>Tasks And Mobile Ops</h2>
          <span>{{ store.tasks().length }} open items</span>
        </div>
        <form class="staff-form camera-form task-create-form" [formGroup]="taskForm" (ngSubmit)="submitTask()">
          <label class="field">
            <span>Branch</span>
            <select formControlName="branchId">
              <option *ngFor="let branch of branchOptions()" [value]="branch.id">{{ branch.name || branch.id }}</option>
            </select>
          </label>
          <label class="field">
            <span>Staff</span>
            <select formControlName="staffId">
              <option value="">All staff</option>
              <option *ngFor="let staff of activeStaffForTask()" [value]="staff.id">{{ staff.fullName }}</option>
            </select>
          </label>
          <label class="field">
            <span>Priority</span>
            <select formControlName="priority">
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
              <option value="urgent">Urgent</option>
            </select>
          </label>
          <label class="field">
            <span>Task type</span>
            <select formControlName="taskType">
              <option value="general">General</option>
              <option value="training">Training</option>
              <option value="service">Service</option>
              <option value="attendance">Attendance</option>
              <option value="payroll">Payroll</option>
            </select>
          </label>
          <label class="field">
            <span>Due date</span>
            <input formControlName="dueAt" type="date" />
          </label>
          <label class="field full">
            <span>Task title</span>
            <input formControlName="title" placeholder="Example: Complete facial training" />
          </label>
          <label class="field full">
            <span>Description</span>
            <textarea formControlName="description" rows="2" placeholder="Task details"></textarea>
          </label>
          <div class="drawer-actions">
            <button type="submit" class="primary" [disabled]="taskForm.invalid || taskSaving()">{{ taskSaving() ? 'Saving...' : 'Create Task' }}</button>
            <span class="form-message" *ngIf="taskMessage()">{{ taskMessage() }}</span>
            <span class="error-message" *ngIf="taskError()">{{ taskError() }}</span>
          </div>
        </form>
        <div class="task-grid">
          <article *ngFor="let task of store.tasks()">
            <strong>{{ task.title }}</strong>
            <span>{{ task.priority }} · {{ task.status }}<ng-container *ngIf="task.dueAt"> · {{ task.dueAt }}</ng-container></span>
            <small *ngIf="task.description">{{ task.description }}</small>
            <button type="button" class="row-action" [disabled]="taskCompleting() === task.id" (click)="completeTask(task)">{{ taskCompleting() === task.id ? 'Closing...' : 'Complete' }}</button>
          </article>
          <div *ngIf="!store.tasks().length && !store.loading()" class="empty action-empty"><strong>No staff tasks assigned.</strong><span>Create training or service tasks to guide daily work.</span></div>
        </div>
      </section>
    </section>
  `,
  styles: [`
    .staff-os { box-sizing: border-box; display: grid; gap: 16px; min-width: 0; width: 100%; padding: 0; color: #10201a; }
    .topbar { display: flex; align-items: center; justify-content: space-between; gap: 16px; }
    .topbar-actions { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
    .eyebrow { margin: 0 0 4px; color: #547066; font-size: 12px; text-transform: uppercase; letter-spacing: .08em; }
    h1, h2 { margin: 0; letter-spacing: 0; }
    h1 { font-size: 28px; }
    h2 { font-size: 18px; }
    .refresh, .primary, .icon-button { border: 1px solid #cbd8d2; background: #fff; border-radius: 6px; padding: 9px 12px; cursor: pointer; min-height: 38px; font-weight: 700; }
    .primary { background: #0f766e; border-color: #0f766e; color: #fff; }
    .primary:disabled { opacity: .65; cursor: wait; }
    .icon-button { width: 38px; padding: 0; font-size: 22px; }
    .row-action { border: 1px solid #cbd8d2; background: #fff; border-radius: 6px; padding: 7px 10px; cursor: pointer; min-height: 32px; font-weight: 800; color: #0f766e; }
    .row-action:disabled { opacity: .65; cursor: wait; }
    .staff-shell-nav { align-items: center; background: rgba(255,255,255,.72); border: 1px solid #d9e5de; border-radius: 8px; display: flex; gap: 8px; max-width: 100%; overflow-x: auto; padding: 8px; }
    .staff-shell-nav a { align-items: center; background: #fff; border: 1px solid #d9e5de; border-radius: 7px; color: #10201a; display: grid; flex: 1 0 150px; gap: 2px 8px; grid-template-columns: auto 1fr; min-height: 52px; padding: 8px 10px; text-decoration: none; }
    .staff-shell-nav a.active { border-color: #0f766e; background: #effaf7; box-shadow: inset 0 0 0 1px #0f766e; }
    .staff-shell-nav span { align-items: center; background: #e8f5f2; border-radius: 8px; color: #0f766e; display: grid; font-size: 12px; font-weight: 900; height: 34px; justify-content: center; width: 34px; }
    .staff-shell-nav strong { font-size: 13px; line-height: 1.15; }
    .staff-shell-nav small { color: #60766d; font-size: 11px; grid-column: 2; }
    .staff-control-room { background: #fff; border: 1px solid #d9e5de; border-radius: 8px; display: grid; gap: 14px; padding: 16px; }
    .control-heading { align-items: end; display: grid; gap: 12px; grid-template-columns: 1fr auto; }
    .control-heading h2 { font-size: 20px; }
    .control-filters { align-items: end; display: flex; gap: 10px; flex-wrap: wrap; justify-content: flex-end; }
    .control-filters label { color: #60766d; display: grid; font-size: 11px; font-weight: 900; gap: 5px; text-transform: uppercase; }
    .control-filters input { min-height: 38px; width: 160px; }
    .control-cards { display: grid; gap: 10px; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); }
    .control-card { border: 1px solid #d9e5de; border-left: 5px solid #0f766e; border-radius: 8px; color: #10201a; display: grid; gap: 6px; min-height: 94px; padding: 13px; text-decoration: none; }
    .control-card span { color: #60766d; font-size: 11px; font-weight: 900; text-transform: uppercase; }
    .control-card strong { font-size: 25px; line-height: 1; }
    .control-card small { color: #60766d; font-weight: 700; }
    .control-card.green { border-left-color: #16a34a; }
    .control-card.amber { border-left-color: #b7791f; }
    .control-card.red { border-left-color: #dc2626; }
    .control-card.blue { border-left-color: #2563eb; }
    .control-card.violet { border-left-color: #7c3aed; }
    .control-tabs { display: flex; gap: 8px; overflow-x: auto; padding-bottom: 2px; }
    .control-tabs a { align-items: center; border: 1px solid #d9e5de; border-radius: 999px; color: #34483f; display: flex; flex: 0 0 auto; gap: 8px; min-height: 38px; padding: 8px 12px; text-decoration: none; }
    .control-tabs a.active { background: #0f766e; border-color: #0f766e; color: #fff; }
    .control-tabs strong { background: #eef7f5; border-radius: 999px; color: #0f766e; min-width: 24px; padding: 3px 7px; text-align: center; }
    .control-tabs a.active strong { background: #fff; }
    .metrics { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; }
    .metric, .panel, .state { border: 1px solid #d9e5de; background: #fff; border-radius: 8px; }
    .metric { display: grid; gap: 8px; padding: 14px; min-height: 76px; }
    .metric span { color: #5f746b; font-size: 13px; }
    .metric strong { font-size: 24px; }
    .metric.good { border-color: #bfe1ce; }
    .metric.warning { border-color: #ead28f; }
    .metric.critical { border-color: #e7b1b1; }
    .panel { display: grid; gap: 14px; padding: 16px; }
    .panel-heading, .row, .split { display: grid; align-items: center; gap: 12px; }
    .panel-heading { grid-template-columns: 1fr auto; color: #40544c; }
    .panel-heading span { color: #60766d; display: block; margin-top: 4px; }
    .staff-list-mode { gap: 10px; }
    .staff-list-mode .topbar,
    .staff-list-mode .staff-shell-nav,
    .staff-list-mode .staff-control-room,
    .staff-list-mode .metrics,
    .staff-list-mode .staff-register-panel { border-radius: 0; box-shadow: none; }
    .staff-list-mode .topbar { background: #fff; border: 1px solid #d8e1ea; padding: 13px 16px; }
    .staff-list-mode .refresh,
    .staff-list-mode .primary,
    .staff-list-mode .row-action { border-radius: 3px; min-height: 32px; padding: 7px 11px; }
    .staff-list-mode .primary { background: #0b72b5; border-color: #0b72b5; }
    .staff-list-mode .staff-shell-nav { background: #fff; border-color: #d8e1ea; padding: 7px; }
    .staff-list-mode .staff-shell-nav a { border-radius: 3px; min-height: 44px; }
    .staff-list-mode .staff-control-room { border-color: #d8e1ea; padding: 12px 16px; }
    .staff-list-mode .control-card { border-radius: 3px; min-height: 76px; padding: 10px 12px; }
    .staff-list-mode .control-card strong { font-size: 22px; }
    .staff-list-mode .metrics { gap: 0; border: 1px solid #d8e1ea; background: #fff; grid-template-columns: repeat(4, minmax(0, 1fr)); }
    .staff-list-mode .metric { border: 0; border-right: 1px solid #e5edf4; border-radius: 0; min-height: 62px; padding: 10px 14px; }
    .staff-list-mode .metric:last-child { border-right: 0; }
    .staff-register-panel { overflow: hidden; padding: 0; }
    .staff-register-heading { border-bottom: 1px solid #d8e1ea; padding: 13px 16px; }
    .staff-register-actions { align-items: center; display: flex; gap: 8px; flex-wrap: wrap; justify-content: flex-end; }
    .staff-register-actions > span { color: #5b6b81; font-weight: 900; margin: 0 8px 0 0; }
    .staff-register-kpis { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); border-bottom: 1px solid #d8e1ea; }
    .staff-register-kpis article { border-right: 1px solid #e5edf4; display: grid; gap: 3px; padding: 10px 16px; }
    .staff-register-kpis article:last-child { border-right: 0; }
    .staff-register-kpis span { color: #64748b; font-size: 12px; font-weight: 900; text-transform: uppercase; }
    .staff-register-kpis strong { color: #111827; font-size: 22px; line-height: 1; }
    .staff-register-kpis small { color: #64748b; }
    .staff-register-scroll { max-width: 100%; overflow: auto; }
    .staff-register-table { border-collapse: collapse; min-width: 1160px; width: 100%; }
    .staff-register-table th,
    .staff-register-table td { border-bottom: 1px solid #dfe7ef; padding: 10px 12px; text-align: left; vertical-align: middle; }
    .staff-register-table th { background: #f4f7fa; color: #5b6b81; font-size: 12px; text-transform: uppercase; }
    .staff-register-table tbody tr:hover { background: #eef7fc; }
    .staff-register-table td small { color: #60766d; display: block; font-size: 12px; margin-top: 3px; }
    .staff-register-footer { color: #64748b; display: flex; gap: 12px; justify-content: flex-end; padding: 8px 16px; border-top: 1px solid #d8e1ea; font-size: 12px; }
    .staff-workspace-panel { background: #fbfdff; }
    .workspace-heading { align-items: end; }
    .staff-workspace-shell { align-items: start; display: grid; gap: 14px; grid-template-columns: 300px minmax(0, 1fr); min-width: 0; }
    .staff-category-rail { display: grid; gap: 8px; position: sticky; top: 12px; }
    .staff-category-tile { align-content: center; background: #fff; border: 1px solid #d9e5de; border-left: 4px solid #0f766e; border-radius: 8px; color: #10201a; cursor: pointer; display: grid; gap: 4px; min-height: 82px; padding: 12px; text-align: left; width: 100%; }
    .staff-category-tile:hover, .staff-category-tile.active { background: #f4faf8; border-color: #b7d7cf; }
    .staff-category-tile.active { box-shadow: 0 10px 24px rgba(16, 32, 56, .08); }
    .staff-category-tile[data-state='ok'] { border-left-color: #16a34a; }
    .staff-category-tile[data-state='warn'] { border-left-color: #b7791f; }
    .staff-category-tile[data-state='bad'] { border-left-color: #dc2626; }
    .staff-category-tile span { font-size: 13px; font-weight: 900; line-height: 1.25; }
    .staff-category-tile strong { font-size: 20px; line-height: 1.1; overflow-wrap: anywhere; }
    .staff-category-tile small { color: #60766d; font-size: 11px; line-height: 1.3; }
    .staff-workspace-detail { background: #fff; border: 1px solid #d9e5de; border-radius: 8px; display: grid; gap: 14px; min-width: 0; padding: 16px; }
    .workspace-detail-head { align-items: start; border-bottom: 1px solid #edf2ef; display: grid; gap: 12px; grid-template-columns: 1fr auto; padding-bottom: 12px; }
    .workspace-detail-head p { color: #60766d; font-size: 13px; margin: 4px 0 0; }
    .badge.warn { background: #fff7e6; color: #8a5a11; }
    .badge.bad { background: #fdecec; color: #9f2424; }
    .workspace-detail-body { display: grid; gap: 14px; min-width: 0; }
    .workspace-kpi-grid { display: grid; gap: 10px; grid-template-columns: repeat(4, minmax(0, 1fr)); }
    .workspace-kpi-grid article { border: 1px solid #d9e5de; border-radius: 8px; display: grid; gap: 5px; min-height: 78px; padding: 12px; }
    .workspace-kpi-grid span { color: #60766d; font-size: 11px; font-weight: 900; text-transform: uppercase; }
    .workspace-kpi-grid strong { color: #10201a; font-size: 22px; overflow-wrap: anywhere; }
    .workspace-kpi-grid small { color: #60766d; }
    .workspace-actions { display: flex; flex-wrap: wrap; gap: 8px; }
    .workspace-actions a, .workspace-actions button { align-items: center; border: 1px solid #cbd8d2; border-radius: 6px; color: #0f766e; display: inline-flex; font-size: 13px; font-weight: 900; justify-content: center; min-height: 36px; padding: 8px 11px; text-decoration: none; }
    .workspace-actions .primary { color: #fff; }
    .staff-workspace-detail .table { max-height: 520px; }
    .workspace-directory-table .row { grid-template-columns: minmax(0, 1.25fr) minmax(0, .75fr) minmax(0, .95fr) minmax(0, 1fr) minmax(0, .6fr) minmax(0, 1fr) minmax(0, .65fr); }
    .salary-workspace-table .row { grid-template-columns: minmax(0, 1.2fr) minmax(0, .75fr) minmax(0, .75fr) minmax(0, .8fr) minmax(0, .65fr); }
    .salary-editor-card { border: 1px solid #d9e5de; border-radius: 8px; display: grid; gap: 12px; padding: 14px; }
    .salary-editor-form { display: grid; gap: 12px; grid-template-columns: repeat(4, minmax(0, 1fr)); }
    .salary-editor-form .field { grid-template-columns: 1fr; }
    .salary-editor-form .check-field, .salary-editor-form .state, .salary-editor-form .drawer-actions { grid-column: 1 / -1; }
    .salary-editor-form .drawer-actions { position: static; border: 0; display: flex; flex-wrap: wrap; justify-content: flex-end; padding: 0; }
    .workspace-manual-form.staff-form { border: 1px solid #d9e5de; border-radius: 8px; display: grid; gap: 12px; grid-template-columns: repeat(3, minmax(0, 1fr)); padding: 14px; }
    .workspace-manual-form .field, .workspace-manual-form .field.full { grid-template-columns: 1fr; }
    .workspace-manual-form .field.full, .workspace-manual-form .drawer-actions { grid-column: 1 / -1; }
    .workspace-manual-form .drawer-actions { position: static; border: 0; display: flex; flex-wrap: wrap; padding: 0; }
    .table { display: grid; border-top: 1px solid #edf2ef; max-height: 560px; overflow: auto; }
    .row { grid-template-columns: 1.3fr .8fr 1fr 1fr .65fr 1.1fr .7fr; min-height: 44px; border-bottom: 1px solid #edf2ef; }
    .row strong { display: block; font-size: 14px; }
    .row small { color: #60766d; display: block; font-size: 12px; margin-top: 3px; }
    .row.header { color: #6c8178; font-size: 12px; text-transform: uppercase; }
    .compact .row { grid-template-columns: 1fr 1fr 1fr .8fr; }
    .badge { width: fit-content; border-radius: 999px; background: #eef6f1; color: #286345; padding: 4px 9px; font-size: 12px; }
    .leave-actions { align-items: center; display: flex; flex-wrap: wrap; gap: 6px; }
    .leave-actions .refresh { min-height: 30px; padding: 6px 9px; }
    .leave-actions .danger { border-color: #f1c4bd; color: #a43b2e; }
    .live-badges, .row-links { display: flex; gap: 6px; flex-wrap: wrap; }
    .mini-badge { width: fit-content; border-radius: 999px; background: #f7faf8; border: 1px solid #d9e5de; color: #40544c; padding: 3px 8px; font-size: 11px; font-weight: 800; }
    .row-links a { border-bottom: 1px solid #99c8bd; color: #0f766e; font-size: 12px; font-weight: 800; text-decoration: none; }
    .state, .empty { padding: 14px; color: #61746c; }
    .action-empty { align-items: start; display: grid; gap: 7px; text-align: left; }
    .action-empty strong { color: #10201a; }
    .action-empty .primary, .action-empty .refresh { width: fit-content; }
    .error { color: #a52828; border-color: #e7b1b1; }
    .split { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .split article, .task-grid article { display: grid; gap: 6px; border: 1px solid #edf2ef; border-radius: 8px; padding: 14px; }
    .split strong { font-size: 24px; }
    .split span, .task-grid span { color: #60766d; }
    .heatmap { display: grid; grid-template-columns: repeat(14, minmax(10px, 1fr)); gap: 4px; }
    .heatmap span { aspect-ratio: 1; border-radius: 3px; background: #23865c; }
    .task-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; }
    .task-create-form.staff-form { border: 1px solid #d9e5de; border-radius: 8px; display: grid; gap: 12px; grid-template-columns: repeat(3, minmax(0, 1fr)); margin-bottom: 12px; padding: 14px; }
    .task-create-form .field.full, .task-create-form .drawer-actions { grid-column: 1 / -1; }
    .task-create-form .drawer-actions { position: static; border: 0; display: flex; flex-wrap: wrap; justify-content: flex-end; padding: 0; }
    .form-message { color: #0f766e; font-weight: 800; }
    .error-message { color: #b91c1c; font-weight: 800; }
    .commission-setup { align-items: center; border: 1px solid #d9e5de; border-radius: 8px; display: grid; gap: 12px; grid-template-columns: 1fr auto; padding: 14px; }
    .commission-setup strong { display: block; font-size: 15px; }
    .commission-actions { display: flex; flex-wrap: wrap; gap: 8px; justify-content: flex-end; }
    .commission-actions a { align-items: center; border: 1px solid #cbd8d2; border-radius: 6px; color: #0f766e; display: inline-flex; font-size: 13px; font-weight: 900; justify-content: center; min-height: 36px; padding: 8px 11px; text-decoration: none; }
    .success { color: #0f766e; border-color: #b6d8cf; background: #f0fbf7; }
    .attendance-command .panel-heading { align-items: end; }
    .attendance-command .panel-heading span { color: #60766d; display: block; margin-top: 4px; }
    .staff-attendance-mode { gap: 10px; }
    .staff-attendance-mode .topbar,
    .staff-attendance-mode .staff-shell-nav,
    .staff-attendance-mode .staff-control-room,
    .staff-attendance-mode .metrics,
    .staff-attendance-mode .attendance-command,
    .staff-attendance-mode .attendance-workspace .panel,
    .staff-attendance-mode .attendance-register-panel { border-radius: 0; box-shadow: none; }
    .staff-attendance-mode .topbar { background: #fff; border: 1px solid #d8e1ea; padding: 13px 16px; }
    .staff-attendance-mode .refresh,
    .staff-attendance-mode .primary,
    .staff-attendance-mode .row-action { border-radius: 3px; min-height: 32px; padding: 7px 11px; }
    .staff-attendance-mode .primary { background: #0b72b5; border-color: #0b72b5; }
    .staff-attendance-mode .staff-shell-nav { background: #fff; border-color: #d8e1ea; padding: 7px; }
    .staff-attendance-mode .staff-shell-nav a { border-radius: 3px; min-height: 44px; }
    .staff-attendance-mode .staff-control-room { border-color: #d8e1ea; padding: 12px 16px; }
    .staff-attendance-mode .control-card { border-radius: 3px; min-height: 76px; padding: 10px 12px; }
    .staff-attendance-mode .metrics { gap: 0; border: 1px solid #d8e1ea; background: #fff; grid-template-columns: repeat(4, minmax(0, 1fr)); }
    .staff-attendance-mode .metric { border: 0; border-right: 1px solid #e5edf4; border-radius: 0; min-height: 62px; padding: 10px 14px; }
    .staff-attendance-mode .metric:last-child { border-right: 0; }
    .staff-attendance-mode .attendance-command { border-color: #d8e1ea; padding: 0; overflow: hidden; }
    .staff-attendance-mode .attendance-command .panel-heading { border-bottom: 1px solid #d8e1ea; padding: 13px 16px; }
    .staff-attendance-mode .attendance-stats { gap: 0; grid-template-columns: repeat(4, minmax(0, 1fr)); }
    .staff-attendance-mode .attendance-stats article { border: 0; border-right: 1px solid #e5edf4; border-bottom: 1px solid #e5edf4; border-radius: 0; min-height: 64px; padding: 10px 16px; }
    .staff-attendance-mode .attendance-stats article:nth-child(4n) { border-right: 0; }
    .attendance-live-strip { border-top: 1px solid #d8e1ea; display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); }
    .attendance-live-strip article { border-right: 1px solid #e5edf4; display: grid; gap: 3px; min-width: 0; padding: 10px 16px; }
    .attendance-live-strip article:last-child { border-right: 0; }
    .attendance-live-strip span,
    .attendance-op-card span { color: #64748b; font-size: 11px; font-weight: 900; text-transform: uppercase; }
    .attendance-live-strip strong,
    .attendance-op-card strong { color: #111827; font-size: 20px; line-height: 1.1; overflow-wrap: anywhere; }
    .attendance-live-strip small,
    .attendance-op-card small { color: #64748b; }
    .attendance-ops-grid { display: grid; gap: 10px; grid-template-columns: repeat(6, minmax(0, 1fr)); }
    .attendance-op-card { background: #fff; border: 1px solid #d8e1ea; display: grid; gap: 4px; min-height: 78px; min-width: 0; padding: 11px 12px; }
    .attendance-op-card.green { border-left: 3px solid #0f766e; }
    .attendance-op-card.blue { border-left: 3px solid #0b72b5; }
    .attendance-op-card.amber { border-left: 3px solid #d97706; }
    .attendance-op-card.bad { border-left: 3px solid #dc2626; }
    .attendance-exception-panel { border-color: #d8e1ea; padding: 0; overflow: hidden; }
    .attendance-exception-panel .panel-heading { border-bottom: 1px solid #d8e1ea; padding: 13px 16px; }
    .exception-table { padding: 0; }
    .exception-table .row { grid-template-columns: minmax(0, 1.4fr) minmax(0, .8fr) minmax(0, .75fr) minmax(0, .6fr); min-height: 42px; padding: 8px 16px; }
    .exception-table .row.header { background: #f4f7fa; color: #5b6b81; font-size: 12px; text-transform: uppercase; }
    .badge.bad { background: #fff1f2; border-color: #fecdd3; color: #be123c; }
    .badge.warn { background: #fffbeb; border-color: #fde68a; color: #92400e; }
    .badge.good { background: #ecfdf5; border-color: #bbf7d0; color: #047857; }
    .staff-attendance-mode .attendance-workspace { gap: 10px; }
    .staff-attendance-mode .attendance-workspace .panel { border-color: #d8e1ea; padding: 13px; }
    .staff-attendance-mode .attendance-register-panel { border-color: #d8e1ea; overflow: hidden; padding: 0; }
    .attendance-register-heading { border-bottom: 1px solid #d8e1ea; padding: 13px 16px; }
    .attendance-register-scroll { max-width: 100%; overflow: auto; }
    .attendance-register-table { border-collapse: collapse; min-width: 960px; width: 100%; }
    .attendance-register-table th,
    .attendance-register-table td { border-bottom: 1px solid #dfe7ef; padding: 10px 12px; text-align: left; vertical-align: middle; }
    .attendance-register-table th { background: #f4f7fa; color: #5b6b81; font-size: 12px; text-transform: uppercase; }
    .attendance-register-table tbody tr:hover { background: #eef7fc; }
    .staff-roster-mode { gap: 10px; }
    .staff-roster-mode .topbar,
    .staff-roster-mode .staff-shell-nav,
    .staff-roster-mode .staff-control-room,
    .staff-roster-mode .metrics,
    .staff-roster-mode .roster-register-panel { border-radius: 0; box-shadow: none; }
    .staff-roster-mode .topbar { background: #fff; border: 1px solid #d8e1ea; padding: 13px 16px; }
    .staff-roster-mode .refresh,
    .staff-roster-mode .primary,
    .staff-roster-mode .row-action { border-radius: 3px; min-height: 32px; padding: 7px 11px; }
    .staff-roster-mode .primary { background: #0b72b5; border-color: #0b72b5; }
    .staff-roster-mode .staff-shell-nav { background: #fff; border-color: #d8e1ea; padding: 7px; }
    .staff-roster-mode .staff-shell-nav a { border-radius: 3px; min-height: 44px; }
    .staff-roster-mode .staff-control-room { border-color: #d8e1ea; padding: 12px 16px; }
    .staff-roster-mode .control-card { border-radius: 3px; min-height: 76px; padding: 10px 12px; }
    .staff-roster-mode .metrics { gap: 0; border: 1px solid #d8e1ea; background: #fff; grid-template-columns: repeat(4, minmax(0, 1fr)); }
    .staff-roster-mode .metric { border: 0; border-right: 1px solid #e5edf4; border-radius: 0; min-height: 62px; padding: 10px 14px; }
    .staff-roster-mode .metric:last-child { border-right: 0; }
    .roster-register-panel { border-color: #d8e1ea; overflow: hidden; padding: 0; }
    .roster-register-heading { border-bottom: 1px solid #d8e1ea; padding: 13px 16px; }
    .roster-kpi-strip { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); border-bottom: 1px solid #d8e1ea; }
    .roster-kpi-strip article { border-right: 1px solid #e5edf4; display: grid; gap: 3px; padding: 10px 16px; }
    .roster-kpi-strip article:last-child { border-right: 0; }
    .roster-kpi-strip span { color: #64748b; font-size: 12px; font-weight: 900; text-transform: uppercase; }
    .roster-kpi-strip strong { color: #111827; font-size: 22px; line-height: 1; }
    .roster-kpi-strip small { color: #64748b; }
    .roster-assign-form.staff-form { border-bottom: 1px solid #d8e1ea; margin: 0; padding: 13px 16px; }
    .roster-heatmap { border-bottom: 1px solid #d8e1ea; padding: 10px 16px; }
    .roster-register-scroll { max-width: 100%; overflow: auto; }
    .roster-register-table { border-collapse: collapse; min-width: 940px; width: 100%; }
    .roster-register-table th,
    .roster-register-table td { border-bottom: 1px solid #dfe7ef; padding: 10px 12px; text-align: left; vertical-align: middle; }
    .roster-register-table th { background: #f4f7fa; color: #5b6b81; font-size: 12px; text-transform: uppercase; }
    .roster-register-table tbody tr:hover { background: #eef7fc; }
    .staff-payroll-mode { gap: 10px; }
    .staff-payroll-mode .topbar,
    .staff-payroll-mode .staff-shell-nav,
    .staff-payroll-mode .staff-control-room,
    .staff-payroll-mode .metrics,
    .staff-payroll-mode .payroll-register-panel { border-radius: 0; box-shadow: none; }
    .staff-payroll-mode .topbar { background: #fff; border: 1px solid #d8e1ea; padding: 13px 16px; }
    .staff-payroll-mode .refresh,
    .staff-payroll-mode .primary,
    .staff-payroll-mode .row-action { border-radius: 3px; min-height: 32px; padding: 7px 11px; }
    .staff-payroll-mode .primary { background: #0b72b5; border-color: #0b72b5; }
    .staff-payroll-mode .staff-shell-nav { background: #fff; border-color: #d8e1ea; padding: 7px; }
    .staff-payroll-mode .staff-shell-nav a { border-radius: 3px; min-height: 44px; }
    .staff-payroll-mode .staff-control-room { border-color: #d8e1ea; padding: 12px 16px; }
    .staff-payroll-mode .control-card { border-radius: 3px; min-height: 76px; padding: 10px 12px; }
    .staff-payroll-mode .metrics { gap: 0; border: 1px solid #d8e1ea; background: #fff; grid-template-columns: repeat(4, minmax(0, 1fr)); }
    .staff-payroll-mode .metric { border: 0; border-right: 1px solid #e5edf4; border-radius: 0; min-height: 62px; padding: 10px 14px; }
    .staff-payroll-mode .metric:last-child { border-right: 0; }
    .payroll-register-panel { border-color: #d8e1ea; overflow: hidden; padding: 0; }
    .payroll-register-heading { border-bottom: 1px solid #d8e1ea; padding: 13px 16px; }
    .payroll-kpi-strip { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); border-bottom: 1px solid #d8e1ea; }
    .payroll-kpi-strip article { border-right: 1px solid #e5edf4; display: grid; gap: 3px; padding: 10px 16px; }
    .payroll-kpi-strip article:last-child { border-right: 0; }
    .payroll-kpi-strip span { color: #64748b; font-size: 12px; font-weight: 900; text-transform: uppercase; }
    .payroll-kpi-strip strong { color: #111827; font-size: 22px; line-height: 1; }
    .payroll-kpi-strip small { color: #64748b; }
    .payroll-register-scroll { max-width: 100%; overflow: auto; }
    .payroll-register-table { border-collapse: collapse; min-width: 980px; width: 100%; }
    .payroll-register-table th,
    .payroll-register-table td { border-bottom: 1px solid #dfe7ef; padding: 10px 12px; text-align: left; vertical-align: middle; }
    .payroll-register-table th { background: #f4f7fa; color: #5b6b81; font-size: 12px; text-transform: uppercase; }
    .payroll-register-table tbody tr:hover { background: #eef7fc; }
    .payroll-register-table td small { color: #60766d; display: block; font-size: 12px; margin-top: 3px; }
    .payroll-risk-strip { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px; padding: 10px 16px; border-top: 1px solid #d8e1ea; }
    .payroll-risk-strip article { border: 1px solid #dfe7ef; display: grid; gap: 4px; padding: 9px 10px; }
    .payroll-risk-strip span { color: #64748b; font-size: 12px; }
    .attendance-controls { display: flex; align-items: center; justify-content: flex-end; gap: 10px; flex-wrap: wrap; }
    .attendance-controls input,
    .attendance-controls select { width: 170px; min-height: 38px; }
    .attendance-stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 10px; }
    .attendance-stats article { border: 1px solid #d9e5de; border-radius: 8px; display: grid; gap: 4px; min-height: 78px; padding: 12px; }
    .attendance-stats span { color: #60766d; font-size: 11px; font-weight: 800; text-transform: uppercase; }
    .attendance-stats strong { font-size: 24px; color: #10201a; }
    .attendance-stats small { color: #60766d; }
    .attendance-workspace { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(460px, 100%), 1fr)); gap: 14px; align-items: start; min-width: 0; }
    .attendance-wide { grid-template-columns: repeat(auto-fit, minmax(min(460px, 100%), 1fr)); }
    .attendance-command,
    .attendance-workspace,
    .attendance-workspace .panel,
    .attendance-workspace .table,
    .attendance-workspace .row,
    .attendance-workspace .field {
      min-width: 0;
    }
    .camera-panel { align-content: start; overflow: hidden; }
    .camera-stage { border: 1px solid #d9e5de; border-radius: 8px; background: #f7faf8; width: 100%; max-width: 100%; min-height: 260px; overflow: hidden; display: grid; place-items: center; }
    .camera-stage video { display: block; width: 100%; max-width: 100%; height: 100%; min-height: 260px; object-fit: cover; background: #10201a; }
    .camera-stage .hidden { display: none; }
    .camera-placeholder { color: #60766d; font-weight: 800; }
    .camera-form { grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); }
    .device-form { display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); gap: 10px; align-items: end; }
    .gateway-form, .mapping-form, .consent-form, .payroll-form { grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); }
    .attendance-workspace .field,
    .attendance-command .field {
      grid-template-columns: 1fr;
      gap: 6px;
      align-items: stretch;
    }
    .attendance-workspace .field span,
    .attendance-command .field span {
      overflow-wrap: anywhere;
    }
    .attendance-workspace .camera-form.staff-form {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 12px;
      padding-top: 18px;
      min-width: 0;
    }
    .attendance-workspace .camera-form .field.full {
      grid-column: 1 / -1;
    }
    .attendance-workspace .camera-form .drawer-actions {
      position: static;
      grid-column: 1 / -1;
      grid-row: auto;
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 10px;
      padding: 0;
      border: 0;
      background: transparent;
    }
    .attendance-workspace .camera-form .drawer-actions .refresh,
    .attendance-workspace .camera-form .drawer-actions .primary {
      width: 100%;
      min-width: 0;
    }
    .device-form .primary { min-width: 120px; }
    .attendance-workspace .device-form .primary,
    .attendance-workspace .gateway-form .primary,
    .attendance-workspace .mapping-form .primary,
    .attendance-workspace .consent-form .primary,
    .attendance-workspace .payroll-form .primary {
      width: 100%;
    }
    .device-table .row, .evidence-table .row { grid-template-columns: minmax(0, 1.2fr) minmax(0, .8fr) minmax(0, .9fr) minmax(0, .8fr); }
    .mapping-table .row { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) minmax(0, .8fr) minmax(0, .7fr) minmax(0, .7fr); }
    .risk-table .row { grid-template-columns: minmax(0, 1.4fr) minmax(0, .5fr) minmax(0, .6fr) minmax(0, .7fr); }
    .attendance-workspace .row > span,
    .attendance-workspace .row > span strong,
    .attendance-workspace .row > span small,
    .attendance-workspace .badge,
    .attendance-workspace input,
    .attendance-workspace select {
      min-width: 0;
      max-width: 100%;
      overflow-wrap: anywhere;
    }
    .mini { min-height: 34px; padding: 8px 10px; }
    .drawer-shell { position: fixed; inset: 0; z-index: 50; display: grid; place-items: center; padding: 24px; }
    .drawer-scrim { position: absolute; inset: 0; background: rgba(15, 23, 42, .35); }
    .drawer { position: relative; width: min(1180px, 100%); height: min(840px, calc(100vh - 48px)); overflow-y: auto; background: #fff; border: 1px solid #cbd8d2; border-radius: 8px; box-shadow: 0 28px 80px rgba(15, 23, 42, .24); padding: 0 22px 18px 74px; display: flex; flex-direction: column; gap: 0; }
    .drawer::before { content: ''; position: fixed; width: 52px; height: min(838px, calc(100vh - 50px)); margin-left: -74px; background: linear-gradient(180deg, #06427d, #08396d); border-radius: 7px 0 0 7px; }
    .drawer::after { content: '⌕\A⌂\A☷\A◎\A◇\A▣\A⋯'; white-space: pre; position: fixed; margin-left: -60px; margin-top: 82px; color: rgba(255,255,255,.86); font-size: 20px; line-height: 2.15; text-align: center; width: 24px; }
    .drawer-header { position: sticky; top: 0; z-index: 2; display: flex; justify-content: space-between; gap: 16px; align-items: flex-start; background: #fff; border-bottom: 1px solid #e4ebe7; padding: 18px 0 12px; }
    .drawer-header span { color: #60766d; font-size: 13px; }
    .editor-breadcrumb { color: #0f6eb3; font-size: 12px; font-weight: 800; margin: 0 0 7px; }
    .editor-title-row { align-items: center; display: flex; gap: 12px; min-width: 0; }
    .editor-title-row h2 { color: #111827; font-size: 24px; }
    .status-pill { background: #d7f7d1; border: 1px solid #b7ebb0; border-radius: 4px; color: #20843b !important; font-size: 12px !important; font-weight: 900; padding: 4px 10px; }
    .detail-tabs { position: sticky; top: 76px; z-index: 2; display: flex; gap: 0; overflow-x: auto; background: #fff; border-bottom: 1px solid #d6dee0; padding-top: 12px; }
    .detail-tabs button { border: 1px solid #d6dee0; border-bottom: 0; background: #f8fafb; border-radius: 0; color: #4b5563; cursor: pointer; font-size: 12px; font-weight: 900; min-height: 34px; padding: 7px 11px; text-transform: uppercase; white-space: nowrap; }
    .detail-tabs button.active { background: #fff; border-top: 3px solid #f97316; color: #111827; padding-top: 5px; }
    .live-context { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)) 1.4fr; gap: 10px; border: 1px solid #d9e5de; border-radius: 4px; background: #f8fbf9; margin-top: 14px; padding: 12px; }
    .live-context article { display: grid; gap: 4px; min-width: 0; }
    .live-context span { color: #60766d; font-size: 11px; font-weight: 800; text-transform: uppercase; }
    .live-context strong { color: #10201a; font-size: 13px; overflow-wrap: anywhere; }
    .context-links { display: flex; align-items: center; justify-content: flex-end; gap: 8px; flex-wrap: wrap; }
    .context-links a { background: #fff; border: 1px solid #cbd8d2; border-radius: 6px; color: #0f766e; font-size: 12px; font-weight: 800; min-height: 30px; padding: 6px 9px; text-decoration: none; }
    .staff-form { display: grid; grid-template-columns: minmax(320px, 1fr) minmax(320px, 1fr) 172px; gap: 12px 18px; padding-top: 18px; }
    .field { display: grid; grid-template-columns: 165px minmax(0, 1fr); align-items: center; gap: 10px; font-weight: 800; color: #34483f; font-size: 13px; }
    .field.full, .staff-form > .full, .staff-form .state { grid-column: 1 / 3; }
    .field.full { grid-template-columns: 165px minmax(0, 1fr); }
    .login-provision { display: grid; grid-column: 1 / 3; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; padding: 14px; border: 1px solid #b6d8cf; border-radius: 8px; background: #f0fbf7; }
    .login-provision > div, .login-provision .check-field { grid-column: 1 / -1; }
    .check-field { align-items: center; border: 1px solid #edf2ef; border-radius: 8px; color: #34483f; display: grid; font-size: 13px; font-weight: 800; gap: 8px; grid-template-columns: auto 1fr; min-height: 43px; padding: 10px 11px; }
    .check-field input { width: 18px; height: 18px; padding: 0; }
    .salary-quick-panel { align-items: center; background: #f6fbff; border: 1px solid #c8dff2; border-radius: 8px; display: grid; gap: 12px; grid-template-columns: minmax(0, 1.2fr) minmax(0, 1fr) auto; padding: 14px; }
    .salary-quick-panel strong { color: #10201a; display: block; font-size: 16px; }
    .salary-quick-panel small { color: #60766d; display: block; margin-top: 4px; }
    .salary-quick-meta { display: grid; gap: 8px; grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .salary-quick-meta article { background: #fff; border: 1px solid #d9e5de; border-radius: 8px; display: grid; gap: 4px; min-height: 54px; padding: 9px 10px; }
    .salary-quick-meta span { color: #60766d; font-size: 11px; font-weight: 900; text-transform: uppercase; }
    .salary-quick-meta strong { font-size: 13px; overflow-wrap: anywhere; }
    .salary-quick-actions { display: flex; flex-wrap: wrap; gap: 8px; justify-content: flex-end; }
    .salary-quick-actions .primary, .salary-quick-actions .refresh { min-height: 34px; white-space: nowrap; }
    .incentive-command, .salary-command { align-items: center; background: #f0fbf7; border: 1px solid #b6d8cf; border-radius: 8px; display: grid; gap: 12px; grid-template-columns: 1fr auto; padding: 14px; }
    .salary-command { background: #f8fafc; border-color: #cbd5e1; }
    .incentive-command strong, .salary-command strong { display: block; font-size: 16px; }
    .incentive-command small, .salary-command small { color: #60766d; display: block; margin-top: 4px; }
    .incentive-summary, .salary-summary { display: grid; gap: 10px; grid-template-columns: repeat(4, minmax(0, 1fr)); }
    .incentive-summary article, .salary-summary article { border: 1px solid #d9e5de; border-radius: 8px; display: grid; gap: 5px; min-height: 72px; padding: 12px; }
    .incentive-summary span, .salary-summary span { color: #60766d; font-size: 12px; font-weight: 800; text-transform: uppercase; }
    .incentive-summary strong, .salary-summary strong { color: #10201a; font-size: 15px; overflow-wrap: anywhere; }
    .subdrawer-shell { position: fixed; inset: 0; z-index: 70; display: grid; justify-items: end; }
    .subdrawer-scrim { position: absolute; inset: 0; background: rgba(15, 23, 42, .22); }
    .subdrawer { position: relative; width: min(860px, 100%); height: 100%; overflow-y: auto; background: #fff; border-left: 1px solid #cbd8d2; box-shadow: -28px 0 70px rgba(15, 23, 42, .22); padding: 20px; display: grid; align-content: start; gap: 16px; }
    .advanced-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; }
    .rule-card { border: 1px solid #d9e5de; border-radius: 8px; display: grid; gap: 12px; padding: 14px; }
    .rule-heading { align-items: center; display: grid; gap: 12px; grid-template-columns: 1fr auto; }
    .rule-heading span { color: #60766d; display: block; font-size: 13px; margin-top: 3px; }
    .rule-actions { display: flex; flex-wrap: wrap; gap: 8px; justify-content: flex-end; }
    .rule-table, .slab-table { display: grid; gap: 8px; }
    .rule-row, .slab-row { display: grid; gap: 8px; align-items: center; }
    .rule-row { grid-template-columns: 1fr 1.45fr .8fr .75fr .75fr auto; }
    .slab-row { grid-template-columns: 1fr 1fr .8fr .8fr auto; }
    .rule-row.header, .slab-row.header { color: #60766d; font-size: 11px; font-weight: 800; min-height: 0; text-transform: uppercase; }
    .row-action.danger { color: #9f2424; }
    input, select, textarea { width: 100%; border: 1px solid #c8d1d6; border-radius: 4px; padding: 8px 10px; font: inherit; color: #10201a; background: #fff; min-height: 34px; }
    textarea { resize: vertical; min-height: 88px; }
    .field small { color: #a52828; font-weight: 700; }
    .drawer-actions { position: sticky; right: 0; top: 128px; grid-column: 3; grid-row: 1 / span 18; align-self: start; display: grid; justify-content: stretch; gap: 12px; padding: 0 0 0 12px; border-top: 0; border-left: 1px solid #e4ebe7; background: #fff; }
    .live-employee-panel { display: grid; gap: 9px; }
    .live-panel-title { border-bottom: 1px solid #e4ebe7; display: grid; gap: 3px; padding-bottom: 9px; }
    .live-panel-title span, .live-employee-panel article span, .catalog-mini-grid span { color: #60766d; font-size: 11px; font-weight: 900; text-transform: uppercase; }
    .live-panel-title strong { color: #111827; font-size: 13px; overflow-wrap: anywhere; }
    .live-employee-panel > article { border: 1px solid #d9e5de; border-left: 4px solid #0f6eb3; border-radius: 4px; display: grid; gap: 3px; min-height: 64px; padding: 9px; }
    .live-employee-panel > article.green { border-left-color: #16a34a; }
    .live-employee-panel > article.amber { border-left-color: #f59e0b; }
    .live-employee-panel > article.violet { border-left-color: #7c3aed; }
    .live-employee-panel > article.neutral { border-left-color: #94a3b8; }
    .live-employee-panel > article strong { color: #111827; font-size: 17px; overflow-wrap: anywhere; }
    .live-employee-panel > article small { color: #60766d; font-size: 11px; font-weight: 700; }
    .catalog-mini-grid { display: grid; gap: 7px; grid-template-columns: 1fr 1fr; }
    .catalog-mini-grid article { border: 1px solid #e4ebe7; border-radius: 4px; display: grid; gap: 3px; padding: 8px; }
    .catalog-mini-grid strong { color: #111827; font-size: 15px; }
    .live-panel-links { display: grid; gap: 7px; }
    .live-panel-links a { border: 1px solid #cbd8d2; border-radius: 4px; color: #0f6eb3; font-size: 12px; font-weight: 900; min-height: 32px; padding: 8px 9px; text-align: center; text-decoration: none; }
    .drawer-action-buttons { display: grid; gap: 10px; }
    .drawer-action-buttons .refresh, .drawer-action-buttons .primary { width: 100%; }
    @media (max-width: 900px) { .metrics, .task-grid, .split, .attendance-stats, .workspace-kpi-grid { grid-template-columns: 1fr 1fr; } .staff-attendance-mode .attendance-stats, .attendance-live-strip, .attendance-ops-grid, .roster-kpi-strip, .payroll-kpi-strip, .payroll-risk-strip { grid-template-columns: repeat(2, minmax(0, 1fr)); } .staff-attendance-mode .attendance-stats article:nth-child(2n), .attendance-live-strip article:nth-child(2n), .roster-kpi-strip article:nth-child(2n), .payroll-kpi-strip article:nth-child(2n) { border-right: 0; } .staff-workspace-shell, .commission-setup, .attendance-workspace, .attendance-wide { grid-template-columns: 1fr; } .commission-actions { justify-content: flex-start; } .staff-category-rail { position: static; grid-template-columns: repeat(2, minmax(0, 1fr)); } .staff-form, .device-form, .gateway-form, .mapping-form, .consent-form, .payroll-form, .salary-editor-form, .task-create-form.staff-form { grid-template-columns: repeat(2, minmax(0, 1fr)); } .attendance-workspace .device-form, .attendance-workspace .gateway-form, .attendance-workspace .mapping-form, .attendance-workspace .consent-form, .attendance-workspace .payroll-form, .attendance-workspace .camera-form, .attendance-workspace .camera-form.staff-form, .workspace-manual-form.staff-form { grid-template-columns: 1fr; } .attendance-workspace .camera-form .drawer-actions { grid-template-columns: 1fr; } .login-provision, .salary-quick-panel { grid-column: 1 / -1; } .salary-quick-panel { grid-template-columns: 1fr; } .salary-quick-actions { justify-content: flex-start; } .drawer-actions { position: static; grid-column: 1 / -1; grid-row: auto; border-left: 0; border-top: 1px solid #edf2ef; padding: 10px 0 0; } .live-employee-panel { grid-template-columns: repeat(2, minmax(0, 1fr)); } .live-panel-title, .catalog-mini-grid, .live-panel-links, .drawer-action-buttons { grid-column: 1 / -1; } }
    @media (max-width: 640px) {
      .staff-os { gap: 12px; padding: 0; }
      .drawer-shell { padding: 0; }
      .topbar { align-items: start; flex-direction: column; }
      .panel-heading { grid-template-columns: 1fr; align-items: start; }
      .topbar-actions, .attendance-controls, .drawer-actions { display: grid; grid-template-columns: 1fr; width: 100%; }
      .topbar-actions .refresh, .topbar-actions .primary, .attendance-controls .refresh, .attendance-controls .primary, .attendance-controls input, .attendance-controls select, .drawer-actions .refresh, .drawer-actions .primary { width: 100%; }
      .staff-shell-nav { margin: 0; padding: 8px; scroll-snap-type: x proximity; }
      .staff-shell-nav a { flex: 0 0 178px; scroll-snap-align: start; }
      .staff-control-room { padding: 13px; }
      .control-heading { grid-template-columns: 1fr; }
      .control-filters { display: grid; grid-template-columns: 1fr; justify-content: stretch; }
      .control-filters input, .control-filters .refresh { width: 100%; }
      .control-cards { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .control-card { min-height: 86px; padding: 11px; }
      .control-card strong { font-size: 22px; }
      .metrics, .task-grid, .split, .attendance-stats, .staff-category-rail, .workspace-kpi-grid, .attendance-workspace, .attendance-wide, .camera-form, .device-form, .gateway-form, .mapping-form, .consent-form, .payroll-form, .salary-editor-form, .task-create-form.staff-form { grid-template-columns: 1fr; }
      .staff-attendance-mode .attendance-stats, .attendance-live-strip, .attendance-ops-grid { grid-template-columns: 1fr; }
      .staff-attendance-mode .attendance-stats article, .attendance-live-strip article { border-right: 0; }
      .exception-table .row { grid-template-columns: 1fr; }
      .roster-kpi-strip { grid-template-columns: 1fr; }
      .roster-kpi-strip article { border-right: 0; }
      .payroll-kpi-strip, .payroll-risk-strip { grid-template-columns: 1fr; }
      .payroll-kpi-strip article { border-right: 0; }
      .metrics { gap: 9px; }
      .metric, .panel, .state { border-radius: 8px; }
      .panel { padding: 13px; }
      .attendance-stats article { min-height: 70px; }
      .attendance-stats strong { font-size: 22px; }
      .camera-stage, .camera-stage video { min-height: 210px; }
      .table { gap: 10px; max-height: none; overflow: visible; border-top: 0; }
      .workspace-detail-head { grid-template-columns: 1fr; }
      .workspace-actions { display: grid; grid-template-columns: 1fr; }
      .workspace-actions a, .workspace-actions button { width: 100%; }
      .row, .compact .row, .device-table .row, .mapping-table .row, .risk-table .row, .evidence-table .row, .workspace-directory-table .row, .salary-workspace-table .row { grid-template-columns: 1fr; gap: 5px; min-height: 0; border: 1px solid #d9e5de; border-radius: 8px; padding: 11px; }
      .row.header { display: none; }
      .heatmap { grid-template-columns: repeat(7, minmax(22px, 1fr)); }
      .action-empty .primary, .action-empty .refresh { width: 100%; }
      input, select, textarea { min-height: 44px; }
      .live-context { grid-template-columns: 1fr; }
      .context-links { justify-content: flex-start; }
      .drawer { width: 100%; height: 100%; border-radius: 0; padding: 0 14px 16px; }
      .drawer::before, .drawer::after { display: none; }
      .detail-tabs { top: 84px; }
      .staff-form { grid-template-columns: 1fr; }
      .field, .field.full { grid-template-columns: 1fr; }
      .field.full, .staff-form > .full, .staff-form .state { grid-column: 1 / -1; }
      .advanced-grid, .incentive-command, .salary-command, .salary-quick-panel, .salary-quick-meta, .incentive-summary, .salary-summary, .rule-heading, .rule-row, .slab-row { grid-template-columns: 1fr; }
      .subdrawer { width: 100%; }
      .login-provision { grid-template-columns: 1fr; }
    }
  `]
})
export class StaffOsSectionComponent implements OnInit, OnDestroy {
  @ViewChild('attendanceVideo') private attendanceVideo?: ElementRef<HTMLVideoElement>;
  @Input({ required: true }) title = 'Staff OS';
  @Input({ required: true }) section = 'staff-list';

  readonly heatmapCells = Array.from({ length: 42 });
  readonly staffShellLinks: StaffShellLink[] = [
    { label: 'Command Center', to: '/staff-enterprise', group: 'Staff command', icon: 'CC' },
    { label: 'Masters', to: '/staff-os/employee-masters', group: 'Employee setup', icon: 'MS' },
    { label: 'Attendance', to: '/staff-os/attendance-dashboard', group: 'Live roster', icon: 'AT' },
    { label: 'Payroll', to: '/staff-os/payroll-dashboard', group: 'Salary rules', icon: 'PY' },
    { label: 'Commission', to: '/commissions', group: 'Incentives', icon: 'CO' },
    { label: 'Reports', to: '/reports/staff-sales', group: 'Staff data', icon: 'RP' },
    { label: 'Training / Performance', to: '/staff-os/performance-dashboard', group: 'Scorecard', icon: 'TP' }
  ];
  readonly staffWorkspaceCategory = signal<StaffWorkspaceKey>('overview');
  readonly staffWorkspaceCategories: StaffWorkspaceCategory[] = [
    { key: 'overview', label: 'Staff Overview', source: 'Staff master + attendance + payroll live store' },
    { key: 'directory', label: 'Staff Directory', source: 'Employee master records, category, status and connected module links' },
    { key: 'attendance', label: 'Attendance / Physical Entry', source: 'Physical register entry, biometric queue, camera punch and payroll attendance rows' },
    { key: 'salary', label: 'Salary / Payroll', source: 'Staff profile salary tab, salary structure and attendance payroll preview' },
    { key: 'commission', label: 'Commission / Incentives', source: 'Performance rows, target incentives and staff-sales reports' },
    { key: 'roster', label: 'Roster / Leave', source: 'Shift master, roster calendar and leave management' },
    { key: 'profile', label: 'Profile / Login', source: 'Staff profile, staff app login and salary profile status' },
    { key: 'tasks', label: 'Tasks / Alerts', source: 'Staff tasks, risk score and owner action queue' }
  ];
  private cameraStream: MediaStream | null = null;
  readonly addStaffOpen = signal(false);
  readonly addStaffSaving = signal(false);
  readonly addStaffError = signal('');
  readonly staffActionError = signal('');
  readonly statusChanging = signal('');
  readonly salaryEditorStaff = signal<StaffOsStaff | null>(null);
  readonly salaryEditorSaving = signal(false);
  readonly salaryEditorError = signal('');
  readonly salaryEditorMessage = signal('');
  readonly attendanceDate = signal(new Date().toISOString().slice(0, 10));
  readonly attendanceError = signal('');
  readonly attendanceMessage = signal('');
  readonly cameraActive = signal(false);
  readonly cameraStarting = signal(false);
  readonly cameraSaving = signal(false);
  readonly manualAttendanceSaving = signal(false);
  readonly deviceSaving = signal(false);
  readonly gatewaySaving = signal(false);
  readonly mappingSaving = signal(false);
  readonly consentSaving = signal(false);
  readonly fraudScanning = signal(false);
  readonly payrollPreviewSaving = signal(false);
  readonly taskSaving = signal(false);
  readonly taskCompleting = signal('');
  readonly taskError = signal('');
  readonly taskMessage = signal('');
  readonly rosterSaving = signal(false);
  readonly rosterError = signal('');
  readonly rosterMessage = signal('');
  readonly leaveSaving = signal(false);
  readonly leaveDecisionChanging = signal('');
  readonly leaveError = signal('');
  readonly leaveMessage = signal('');
  readonly queueProcessing = signal(false);
  readonly advancedIncentiveOpen = signal(false);
  readonly incentiveRules = signal<IncentiveRuleDraft[]>([this.defaultIncentiveRule('service_category')]);
  readonly incentiveSlabs = signal<IncentiveSlabDraft[]>([this.defaultIncentiveSlab(0, 25000, 5)]);
  readonly detailTab = signal<StaffDetailTab>('core');
  readonly branchOptions = computed(() => this.orderedBranchOptions());
  readonly detailTabs: Array<{ id: StaffDetailTab; label: string }> = [
    { id: 'core', label: 'General' },
    { id: 'contact', label: 'Contact' },
    { id: 'emergency', label: 'Emergency' },
    { id: 'native', label: 'Native Contact' },
    { id: 'incentive', label: 'Commissions' },
    { id: 'attendance', label: 'Salary Setup' },
    { id: 'remarks', label: 'Remarks' }
  ];
  readonly integrationLinks: Record<StaffDetailTab, StaffIntegrationLink[]> = {
    core: [
      { label: 'Category Master', to: '/staff-os/staff-categories' },
      { label: 'Salary Setup', to: '/staff-os/salary-workspace' },
      { label: 'Staff Profile', to: '/staff-os/staff-profile' },
      { label: 'Roster', to: '/staff-os/roster-calendar' }
    ],
    contact: [
      { label: 'Staff Profile', to: '/staff-os/staff-profile' },
      { label: 'Mobile Preview', to: '/staff-os/mobile-preview' }
    ],
    emergency: [
      { label: 'Staff Profile', to: '/staff-os/staff-profile' },
      { label: 'Leave', to: '/staff-os/leave-management' }
    ],
    native: [
      { label: 'Staff Profile', to: '/staff-os/staff-profile' },
      { label: 'Mobile Preview', to: '/staff-os/mobile-preview' }
    ],
    incentive: [
      { label: 'Commission', to: '/staff-os/commission-dashboard' },
      { label: 'Performance', to: '/staff-os/performance-dashboard' },
      { label: 'Leaderboard', to: '/staff-os/leaderboard' }
    ],
    attendance: [
      { label: 'Salary Setup', to: '/staff-os/salary-workspace' },
      { label: 'Attendance', to: '/staff-os/attendance-dashboard' },
      { label: 'Payroll', to: '/staff-os/payroll-dashboard' },
      { label: 'Salary Structure', to: '/staff-os/payroll-salary-structure' },
      { label: 'Salary Generate', to: '/staff-os/salary-generate' },
      { label: 'Roster', to: '/staff-os/roster-calendar' }
    ],
    remarks: [
      { label: 'Staff Profile', to: '/staff-os/staff-profile' },
      { label: 'Tasks', to: '/staff-os/task-board' },
      { label: 'Training', to: '/staff-os/training-center' }
    ]
  };
  readonly staffForm = this.fb.group({
    branchId: ['', Validators.required],
    firstName: ['', [Validators.required, Validators.minLength(2)]],
    lastName: [''],
    shortName: [''],
    employeeCode: [''],
    mobile: ['', [Validators.pattern(/^[+0-9\s-]{10,16}$/)]],
    email: ['', Validators.email],
    enableStaffLogin: [false],
    loginId: [''],
    loginPassword: ['', Validators.minLength(6)],
    loginRole: ['staff'],
    roleId: ['staff', Validators.required],
    staffCategoryId: [''],
    employmentType: ['full_time', Validators.required],
    department: [''],
    designation: ['', Validators.required],
    joiningDate: [''],
    lastWorkingDate: [''],
    birthDate: [''],
    anniversaryDate: [''],
    gender: [''],
    entryPin: [''],
    hideFromRoster: [false],
    allowSkipOtp: [false],
    skillLicenseNotes: [''],
    contactPerson: [''],
    contactMobile: [''],
    address: [''],
    addressLine2: [''],
    landmark: [''],
    city: [''],
    pincode: [''],
    state: [''],
    country: [''],
    area: [''],
    phone: [''],
    fax: [''],
    contactEmail: ['', Validators.email],
    web: [''],
    emergencyContactName: [''],
    emergencyContactMobile: [''],
    emergencyContactPhone: [''],
    emergencyRelation: [''],
    emergencyAddress: [''],
    emergencyCity: [''],
    emergencyState: [''],
    emergencyCountry: [''],
    nativeContactName: [''],
    nativeContactMobile: [''],
    nativeContactPhone: [''],
    nativeAddress: [''],
    nativeCity: [''],
    nativeState: [''],
    nativeCountry: [''],
    fixedIncentivePercent: [0],
    fixedIncentiveAmount: [0],
    serviceIncentiveRules: [''],
    incentiveNotes: [''],
    incentiveCycle: ['monthly'],
    incentiveStartDate: [''],
    incentiveEndDate: [''],
    incentiveCapAmount: [0],
    incentivePayrollSync: [true],
    incentiveRequiresApproval: [true],
    incentiveApprovalRole: ['manager'],
    incentiveHoldOnAbsentDays: [2],
    incentiveReduceOnLateCount: [3],
    incentiveReducePercent: [10],
    incentivePayoutStatus: ['draft'],
    weeklyOff: [''],
    empCodeInDevice: [''],
    rfidCardNo: [''],
    attendanceCategory: [''],
    defaultShift: [''],
    devicePrivilege: ['user'],
    salaryStructureId: [''],
    salaryCycle: ['monthly'],
    salaryEffectiveFrom: [''],
    basicSalary: [0],
    paymentMode: [''],
    bankName: [''],
    accountNumber: [''],
    loanInstallment: [0],
    loanBalance: [0],
    otExtraRate: [0],
    lessWorkPenalty: [0],
    supportAttendancePayroll: [false],
    weeklyOffOvertime: [false],
    pfApplicable: [false],
    pfNo: [''],
    ptApplicable: [false],
    ptNo: [''],
    esicApplicable: [false],
    esicNo: [''],
    tdsApplicable: [false],
    panNo: [''],
    aadhaarNo: [''],
    remarks: [''],
    imeiNo: ['']
  });
  readonly cameraForm = this.fb.group({
    branchId: [''],
    staffId: ['', Validators.required],
    punchType: ['clock_in'],
    livenessScore: [0.92],
    matchScore: [0.9],
    notes: ['']
  });
  readonly manualAttendanceForm = this.fb.group({
    branchId: ['', Validators.required],
    staffId: ['', Validators.required],
    punchType: ['full_day'],
    clockInTime: ['10:00'],
    clockOutTime: ['19:00'],
    overtimeMinutes: [0],
    notes: ['']
  });
  readonly salaryEditorForm = this.fb.group({
    salaryStructureId: [''],
    salaryCycle: ['monthly'],
    salaryEffectiveFrom: [new Date().toISOString().slice(0, 10)],
    basicSalary: [0, [Validators.required, Validators.min(0)]],
    paymentMode: ['cash'],
    bankName: [''],
    accountNumber: [''],
    supportAttendancePayroll: [true]
  });
  readonly deviceForm = this.fb.group({
    branchId: ['', Validators.required],
    provider: ['zkteco', Validators.required],
    deviceCode: ['', Validators.required],
    deviceName: [''],
    locationLabel: [''],
    connectionMode: ['offline_sync']
  });
  readonly gatewayForm = this.fb.group({
    branchId: ['', Validators.required],
    gatewayCode: ['', Validators.required],
    displayName: [''],
    machineName: [''],
    versionLabel: [''],
    providers: ['zkteco, essl, mantra']
  });
  readonly mappingForm = this.fb.group({
    branchId: ['', Validators.required],
    deviceId: ['', Validators.required],
    staffId: ['', Validators.required],
    externalUserId: ['', Validators.required],
    notes: ['']
  });
  readonly consentForm = this.fb.group({
    branchId: ['', Validators.required],
    staffId: ['', Validators.required],
    consentType: ['biometric_attendance'],
    consentStatus: ['granted'],
    consentChannel: ['paper'],
    retentionDays: [365],
    consentText: ['Staff consent captured for biometric/camera attendance, payroll automation and audit evidence.']
  });
  readonly payrollPreviewForm = this.fb.group({
    branchId: ['', Validators.required],
    periodStart: [new Date().toISOString().slice(0, 10), Validators.required],
    periodEnd: [new Date().toISOString().slice(0, 10), Validators.required],
    defaultShiftStart: ['10:00'],
    lateGraceMinutes: [15],
    incentiveHoldAbsentDays: [2],
    latePenaltyAmount: [0],
    defaultGrossAmount: [0]
  });
  readonly taskForm = this.fb.group({
    branchId: ['', Validators.required],
    staffId: [''],
    title: ['', Validators.required],
    description: [''],
    taskType: ['general'],
    priority: ['medium'],
    dueAt: [new Date().toISOString().slice(0, 10)]
  });
  readonly rosterForm = this.fb.group({
    branchId: ['', Validators.required],
    staffId: ['', Validators.required],
    scheduleDate: [new Date().toISOString().slice(0, 10), Validators.required],
    shiftTemplateId: ['', Validators.required],
    notes: ['']
  });
  readonly leaveForm = this.fb.group({
    branchId: ['', Validators.required],
    staffId: ['', Validators.required],
    leaveType: ['', Validators.required],
    startDate: [new Date().toISOString().slice(0, 10), Validators.required],
    endDate: [new Date().toISOString().slice(0, 10), Validators.required],
    reason: ['']
  });

  constructor(
    public readonly store: StaffOsStore,
    private readonly fb: UntypedFormBuilder,
    private readonly route: ActivatedRoute,
    private readonly appState: AppStateService
  ) {
    effect(() => {
      const options = this.branchOptions();
      if (!this.addStaffOpen() || this.staffForm.get('branchId')?.value) return;
      const branchId = this.defaultBranchId(options);
      if (branchId) this.staffForm.patchValue({ branchId }, { emitEvent: false });
    });
    effect(() => {
      const branchId = this.defaultBranchId(this.branchOptions());
      if (!branchId) return;
      if (!this.manualAttendanceForm.get('branchId')?.value) this.patchAttendanceBranch(branchId);
    });
    effect(() => {
      const leaveType = this.leaveTypeOptions()[0]?.code || '';
      if (leaveType && !this.leaveForm.get('leaveType')?.value) {
        this.leaveForm.patchValue({ leaveType }, { emitEvent: false });
      }
    });
  }

  ngOnInit(): void {
    this.applyWorkspaceRouteContext();
    this.applyAttendanceRouteContext();
    this.store.load();
    if (this.section === 'workspace' || this.section === 'attendance-dashboard') {
      this.refreshAttendanceCenter();
    }
    if (this.section === 'leave-management') {
      this.refreshLeaveManagement();
    }
    if (this.section === 'staff-list' && this.route.snapshot.queryParamMap.get('add') === '1') {
      this.openAddStaff();
    }
  }

  ngOnDestroy(): void {
    this.stopCamera();
  }

  isShellLinkActive(link: StaffShellLink): boolean {
    const target = link.to.split('/').pop() || '';
    return target === this.section;
  }

  isControlTabActive(tab: StaffControlTab): boolean {
    const target = tab.to.split('/').pop() || '';
    return target === this.section;
  }

  staffContextParams(): ApiRecord {
    return {
      branchId: this.attendanceBranchId() || this.appState.selectedBranchId(),
      staffId: this.route.snapshot.queryParamMap.get('staffId') || '',
      date: this.attendanceDate()
    };
  }

  staffControlCards(): StaffControlCard[] {
    const summary = this.attendanceSummary();
    const performance = this.store.performance();
    const payrollRows = this.store.attendancePayrollPreview();
    const commissionRows = performance.rows || [];
    const commissionRules = this.commissionRuleCount();
    const topSeller = performance.rows?.[0]?.staffId || 'Live';
    return [
      { label: 'Present today', value: summary['attendanceEvents'] || this.attendanceRows().length || 0, hint: 'attendance rows', to: '/staff-os/attendance-dashboard', tone: 'green' },
      { label: 'Salary due', value: payrollRows.length, hint: 'payroll preview rows', to: '/staff-os/payroll-dashboard', tone: 'amber' },
      { label: 'Commission due', value: commissionRules || commissionRows.length, hint: commissionRules ? 'saved incentive rules' : 'rules / preview', to: '/staff-os/commission-dashboard', tone: 'violet' },
      { label: 'Late staff', value: summary['suspiciousEvents'] || 0, hint: 'needs review', to: '/staff-os/attendance-dashboard', tone: 'red' },
      { label: 'Top seller', value: topSeller, hint: 'from staff performance', to: '/reports/staff-sales', tone: 'blue' },
      { label: 'Risk staff', value: this.store.attendanceRisks().length, hint: 'Risk signals', to: '/staff-enterprise', tone: 'red' }
    ];
  }

  staffControlTabs(): StaffControlTab[] {
    return [
      { label: 'Overview', to: '/staff-enterprise', count: this.store.staff().length },
      { label: 'Master', to: '/staff-os/employee-masters', count: this.store.staff().length },
      { label: 'Live Data', to: '/staff-os/attendance-dashboard', count: this.attendanceRows().length },
      { label: 'Reports', to: '/reports/staff-sales', count: this.store.performance().rows?.length || 0 },
      { label: 'Actions', to: '/staff-os/task-board', count: this.store.tasks().length }
    ];
  }

  selectedStaffWorkspaceCategory(): StaffWorkspaceCategory {
    return this.staffWorkspaceCategories.find((item) => item.key === this.staffWorkspaceCategory()) || this.staffWorkspaceCategories[0];
  }

  private applyWorkspaceRouteContext(): void {
    if (this.section !== 'workspace') return;
    const requested = (
      this.route.snapshot.queryParamMap.get('workspace')
      || this.route.snapshot.queryParamMap.get('category')
      || (this.route.snapshot.routeConfig?.path?.includes('salary') ? 'salary' : '')
    ) as StaffWorkspaceKey;
    if (this.staffWorkspaceCategories.some((item) => item.key === requested)) {
      this.staffWorkspaceCategory.set(requested);
    }
  }

  staffWorkspaceValue(key: StaffWorkspaceKey): string | number {
    switch (key) {
      case 'overview': return `${this.activeStaffForAttendance().length}/${this.staffDirectoryRows().length}`;
      case 'directory': return this.staffDirectoryRows().length;
      case 'attendance': return this.attendanceRows().length;
      case 'salary': return this.salaryProfileCount();
      case 'commission': return this.commissionRuleCount() || this.store.performance().rows.length;
      case 'roster': return this.store.schedules().length;
      case 'profile': return this.loginLinkedCount();
      case 'tasks': return this.store.tasks().length + this.actionableRisks().length + this.store.attendanceRisks().length;
      default: return '—';
    }
  }

  staffWorkspaceNote(key: StaffWorkspaceKey): string {
    switch (key) {
      case 'overview': return `${this.store.staffCategories().length} categories · ${this.store.metrics().length} KPIs`;
      case 'directory': return `${this.activeStaffForAttendance().length} active · ${this.inactiveStaffCount()} inactive`;
      case 'attendance': return `physical entry · ${this.attendanceSummary()['devices'] || 0} devices`;
      case 'salary': return `${this.store.payrollStructures().length} structures · ${this.store.attendancePayrollPreview().length} previews`;
      case 'commission': return `${this.commissionRuleCount()} rules · ${this.store.performance().summary.avgScore || 0} avg score`;
      case 'roster': return `${this.store.schedules().length} shifts · leave linked`;
      case 'profile': return `${this.loginLinkedCount()} login linked · salary visible`;
      case 'tasks': return `${this.actionableRisks().length} open risk · ${this.store.attendanceRisks().length} attendance alerts`;
      default: return '';
    }
  }

  staffWorkspaceStatus(key: StaffWorkspaceKey): string {
    const state = this.staffWorkspaceState(key);
    if (state === 'bad') return 'Needs check';
    if (state === 'warn') return 'Pending';
    return 'Live';
  }

  staffWorkspaceState(key: StaffWorkspaceKey): 'ok' | 'warn' | 'bad' {
    switch (key) {
      case 'overview': return this.staffDirectoryRows().length ? 'ok' : 'warn';
      case 'directory': return this.activeStaffForAttendance().length ? 'ok' : 'warn';
      case 'attendance': return this.attendanceRows().length ? 'ok' : 'warn';
      case 'salary': return this.salaryProfileCount() >= this.activeStaffForAttendance().length ? 'ok' : 'warn';
      case 'commission': return this.commissionRuleCount() || this.store.performance().rows.length ? 'ok' : 'warn';
      case 'roster': return this.store.schedules().length ? 'ok' : 'warn';
      case 'profile': return this.loginLinkedCount() ? 'ok' : 'warn';
      case 'tasks': return this.store.attendanceRisks().length ? 'bad' : (this.actionableRisks().length || this.store.tasks().length ? 'warn' : 'ok');
      default: return 'ok';
    }
  }

  commissionRuleCount(): number {
    const types = new Set(['service', 'product', 'membership']);
    return this.store.targetIncentives().filter((rule) => {
      const status = String(rule.status || '').toLowerCase();
      return types.has(String(rule.targetType)) && !rule.hide && (!status || status === 'active');
    }).length;
  }

  actionableRisks(): StaffOsRiskScore[] {
    return this.store.risks().filter((risk) => {
      const level = String(risk.level || '').toLowerCase();
      return Number(risk.score || 0) >= 40 || level === 'medium' || level === 'high';
    });
  }

  salaryProfile(staff: StaffOsStaff): Record<string, unknown> {
    return (staff.employeeDetails?.attendanceSalary || {}) as Record<string, unknown>;
  }

  salaryAmount(staff: StaffOsStaff): number {
    return Number(this.salaryProfile(staff)['basicSalary'] || 0);
  }

  salaryProfileCount(): number {
    return this.staffDirectoryRows().filter((staff) => this.salaryAmount(staff) > 0 || Object.keys(this.salaryProfile(staff)).length > 0).length;
  }

  openSalaryEditor(staff: StaffOsStaff): void {
    const salary = this.salaryProfile(staff);
    this.salaryEditorStaff.set(staff);
    this.salaryEditorError.set('');
    this.salaryEditorMessage.set('');
    this.salaryEditorForm.reset({
      salaryStructureId: String(salary['salaryStructureId'] || ''),
      salaryCycle: String(salary['salaryCycle'] || 'monthly'),
      salaryEffectiveFrom: String(salary['salaryEffectiveFrom'] || new Date().toISOString().slice(0, 10)),
      basicSalary: Number(salary['basicSalary'] || 0),
      paymentMode: String(salary['paymentMode'] || 'cash'),
      bankName: String(salary['bankName'] || ''),
      accountNumber: String(salary['accountNumber'] || ''),
      supportAttendancePayroll: salary['supportAttendancePayroll'] !== false
    });
  }

  closeSalaryEditor(): void {
    if (this.salaryEditorSaving()) return;
    this.salaryEditorStaff.set(null);
    this.salaryEditorError.set('');
    this.salaryEditorMessage.set('');
  }

  saveStaffSalary(): void {
    const staff = this.salaryEditorStaff();
    if (!staff) return;
    if (this.salaryEditorForm.invalid) {
      this.salaryEditorForm.markAllAsTouched();
      return;
    }
    const value = this.salaryEditorForm.getRawValue() as ApiRecord;
    const existingDetails = staff.employeeDetails || {};
    const existingSalary = this.salaryProfile(staff);
    const employeeDetails = {
      ...existingDetails,
      attendanceSalary: {
        ...existingSalary,
        salaryStructureId: value['salaryStructureId'] || '',
        salaryCycle: value['salaryCycle'] || 'monthly',
        salaryEffectiveFrom: value['salaryEffectiveFrom'] || new Date().toISOString().slice(0, 10),
        basicSalary: Number(value['basicSalary'] || 0),
        paymentMode: value['paymentMode'] || '',
        bankName: value['bankName'] || '',
        accountNumber: value['accountNumber'] || '',
        supportAttendancePayroll: Boolean(value['supportAttendancePayroll'])
      }
    };
    this.salaryEditorSaving.set(true);
    this.salaryEditorError.set('');
    this.salaryEditorMessage.set('');
    this.store.updateStaff(staff, { employeeDetails })
      .pipe(finalize(() => this.salaryEditorSaving.set(false)))
      .subscribe({
        next: () => {
          this.salaryEditorMessage.set('Staff salary saved.');
          this.store.load();
        },
        error: (error: { error?: { error?: string; message?: string }; message?: string }) => {
          this.salaryEditorError.set(error?.error?.error || error?.error?.message || error?.message || 'Unable to save staff salary');
        }
      });
  }

  loginLinkedCount(): number {
    return this.staffDirectoryRows().filter((staff) => staff.loginUserId || staff.loginId || staff.loginEmail || staff.loginPasswordSet).length;
  }

  inactiveStaffCount(): number {
    return this.staffDirectoryRows().filter((staff) => {
      const status = String(staff.status || '').toLowerCase();
      return status && status !== 'active' && status !== 'working';
    }).length;
  }

  staffDirectoryRows(): StaffOsStaff[] {
    const selectedStaffId = this.section === 'staff-profile' ? this.route.snapshot.queryParamMap.get('staffId') : '';
    const rows = this.store.staff();
    return selectedStaffId ? rows.filter((staff) => staff.id === selectedStaffId) : rows;
  }

  opacity(index: number): number {
    return 0.25 + ((index % 7) / 10);
  }

  setAttendanceDate(value: string): void {
    if (!value) return;
    this.attendanceDate.set(value);
    this.payrollPreviewForm.patchValue({ periodStart: value, periodEnd: value }, { emitEvent: false });
    this.refreshAttendanceCenter();
  }

  setAttendanceBranch(value: string): void {
    const branchId = String(value || this.defaultBranchId(this.branchOptions()) || '');
    this.patchAttendanceBranch(branchId);
    this.refreshAttendanceCenter();
  }

  refreshAttendanceCenter(): void {
    const branchId = this.attendanceBranchId();
    this.attendanceError.set('');
    this.store.loadAttendanceCenter({ branchId, date: this.attendanceDate() });
  }

  attendanceSummary(): ApiRecord {
    return (this.store.biometricCenter()?.['summary'] || {}) as ApiRecord;
  }

  attendanceRows(): ApiRecord[] {
    const centerRows = this.store.biometricCenter()?.['attendance'];
    return Array.isArray(centerRows) ? centerRows : this.store.attendance();
  }

  attendanceBranchLabel(): string {
    const branchId = this.attendanceBranchId();
    const branch = this.branchOptions().find((item) => item.id === branchId);
    return branch?.name || branchId || 'No branch';
  }

  uniqueAttendanceStaffCount(): number {
    const staffIds = new Set(
      this.attendanceRows()
        .map((row) => String(row['staffId'] || row['staff_id'] || '').trim())
        .filter(Boolean)
    );
    return staffIds.size;
  }

  attendanceCoveragePct(): number {
    const activeCount = this.activeStaffForAttendance().length;
    if (!activeCount) return 0;
    return Math.min(100, Math.round((this.uniqueAttendanceStaffCount() / activeCount) * 100));
  }

  openAttendanceRiskCount(): number {
    return this.store.attendanceRisks().filter((risk) => {
      const status = String(risk['status'] || '').toLowerCase();
      return !status || !['closed', 'resolved', 'cleared'].includes(status);
    }).length;
  }

  payrollHoldCount(): number {
    return this.store.attendancePayrollPreview().filter((row) => row['incentiveHold'] || String(row['status'] || '').toLowerCase() === 'hold').length;
  }

  gatewayStatusLabel(): string {
    const summary = this.attendanceSummary();
    const gateways = Number(summary['gateways'] || this.gatewayRows().length || 0);
    const online = Number(summary['onlineGateways'] || this.gatewayRows().filter((row) => String(row['healthStatus'] || '').toLowerCase() === 'online').length || 0);
    return gateways ? `${online}/${gateways} gateway online` : 'No gateway';
  }

  attendanceLastSyncLabel(): string {
    const timestamps = [
      ...this.attendanceRows().flatMap((row) => [row['clockInAt'], row['clockOutAt'], row['capturedAt'], row['createdAt'], row['updatedAt']]),
      ...this.gatewayRows().map((row) => row['lastSeenAt'])
    ]
      .map((value) => value ? new Date(String(value)).getTime() : 0)
      .filter((value) => Number.isFinite(value) && value > 0);
    if (!timestamps.length) return 'Not synced';
    return this.timeOnly(new Date(Math.max(...timestamps)).toISOString());
  }

  attendanceOpsCards(): AttendanceDashboardCard[] {
    const summary = this.attendanceSummary();
    return [
      { label: 'Manual log', value: this.attendanceRows().filter((row) => String(row['source'] || '').includes('manual')).length, hint: 'physical entries', tone: 'blue' },
      { label: 'Camera proof', value: summary['cameraCaptures'] || 0, hint: 'verified captures', tone: 'green' },
      { label: 'Device queue', value: summary['queuedEvents'] || 0, hint: `${summary['failedEvents'] || 0} failed`, tone: Number(summary['failedEvents'] || 0) ? 'bad' : 'amber' },
      { label: 'Mappings', value: this.store.biometricMappings().length, hint: `${this.pendingMappingCount()} pending`, tone: this.pendingMappingCount() ? 'amber' : 'green' },
      { label: 'Consent', value: summary['consentGranted'] || this.store.biometricConsents().length, hint: `${summary['consentPending'] || this.pendingConsentCount()} pending`, tone: this.pendingConsentCount() ? 'amber' : 'green' },
      { label: 'Payroll draft', value: this.store.attendancePayrollPreview().length, hint: `${this.payrollHoldCount()} hold`, tone: this.payrollHoldCount() ? 'bad' : 'blue' }
    ];
  }

  attendanceExceptionRows(): AttendanceExceptionItem[] {
    const riskRows = this.store.attendanceRisks().slice(0, 8).map((risk) => ({
      title: risk['riskType'] || 'Attendance risk',
      meta: risk['reason'] || 'Needs owner review',
      staff: this.displayStaffName(risk),
      impact: risk['severity'] || risk['riskScore'] || 'review',
      status: risk['status'] || 'open',
      tone: String(risk['severity'] || '').toLowerCase() === 'high' ? 'bad' : 'warn'
    }));
    const payrollRows = this.store.attendancePayrollPreview()
      .filter((row) => row['incentiveHold'] || Number(row['lateCount'] || 0) || Number(row['absentDays'] || 0))
      .slice(0, 6)
      .map((row) => ({
        title: row['incentiveHold'] ? 'Payroll hold' : 'Payroll adjustment',
        meta: `${row['presentDays'] || 0} present · ${row['lateCount'] || 0} late · ${row['absentDays'] || 0} absent`,
        staff: this.displayStaffName(row),
        impact: `₹${Number(row['netPreview'] || 0).toLocaleString('en-IN')}`,
        status: row['incentiveHold'] ? 'hold' : 'draft',
        tone: row['incentiveHold'] ? 'bad' : 'warn'
      }));
    const alertRows = this.store.ownerAlerts().slice(0, 4).map((alert) => ({
      title: alert['title'] || alert['alertType'] || 'Owner alert',
      meta: alert['message'] || alert['description'] || 'Attendance action',
      staff: this.displayStaffName(alert),
      impact: alert['severity'] || 'owner',
      status: alert['status'] || 'open',
      tone: 'warn'
    }));
    return [...riskRows, ...payrollRows, ...alertRows].slice(0, 12);
  }

  activeStaffForAttendance(): StaffOsStaff[] {
    const branchId = this.attendanceBranchId();
    return this.store.staff().filter((staff) => {
      const status = String(staff.status || '').toLowerCase();
      const branchMatches = !branchId || staff.branchId === branchId;
      return branchMatches && (!status || status === 'active' || status === 'working');
    });
  }

  activeStaffForTask(): StaffOsStaff[] {
    const branchId = String(this.taskForm.get('branchId')?.value || this.attendanceBranchId());
    return this.store.staff().filter((staff) => {
      const status = String(staff.status || '').toLowerCase();
      const branchMatches = !branchId || staff.branchId === branchId;
      return branchMatches && (!status || status === 'active' || status === 'working');
    });
  }

  activeStaffForRoster(): StaffOsStaff[] {
    const branchId = String(this.rosterForm.get('branchId')?.value || this.attendanceBranchId());
    return this.store.staff().filter((staff) => {
      const status = String(staff.status || '').toLowerCase();
      const branchMatches = !branchId || staff.branchId === branchId;
      return branchMatches && !staff.employeeDetails?.hideFromRoster && (!status || status === 'active' || status === 'working');
    });
  }

  activeStaffForLeave(): StaffOsStaff[] {
    const branchId = String(this.leaveForm.get('branchId')?.value || this.attendanceBranchId());
    return this.store.staff().filter((staff) => {
      const status = String(staff.status || '').toLowerCase();
      const branchMatches = !branchId || staff.branchId === branchId;
      return branchMatches && (!status || status === 'active' || status === 'working');
    });
  }

  rosterShiftOptions(): StaffOsShiftMaster[] {
    const branchId = String(this.rosterForm.get('branchId')?.value || this.attendanceBranchId());
    return this.store.shiftMasters().filter((shift) => {
      const status = String(shift.status || '').toLowerCase();
      const branchMatches = !shift.branchId || !branchId || shift.branchId === branchId;
      return branchMatches && !shift.hide && (!status || status === 'active');
    });
  }

  leaveTypeOptions(): StaffOsLeaveMaster[] {
    const branchId = String(this.leaveForm.get('branchId')?.value || this.attendanceBranchId());
    return this.store.leaveMasters().filter((leave) => {
      const status = String(leave.status || '').toLowerCase();
      const branchMatches = !leave.branchId || !branchId || leave.branchId === branchId;
      return branchMatches && !leave.hide && (!status || status === 'active');
    });
  }

  selectedRosterShift(): StaffOsShiftMaster | undefined {
    const shiftId = String(this.rosterForm.get('shiftTemplateId')?.value || '');
    return this.rosterShiftOptions().find((shift) => shift.id === shiftId);
  }

  selectedSalaryStructureName(): string {
    const id = String(this.staffForm.get('salaryStructureId')?.value || '');
    if (!id) return 'Default';
    return this.store.payrollStructures().find((structure) => structure.id === id)?.name || id;
  }

  gatewayRows(): ApiRecord[] {
    const rows = this.store.biometricCenter()?.['gateways'];
    return Array.isArray(rows) ? rows : [];
  }

  registerGateway(): void {
    if (this.gatewayForm.invalid) {
      this.gatewayForm.markAllAsTouched();
      return;
    }
    const value = this.gatewayForm.getRawValue() as ApiRecord;
    const providers = String(value['providers'] || '')
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
    this.attendanceError.set('');
    this.attendanceMessage.set('');
    this.gatewaySaving.set(true);
    this.store.registerGateway({ ...value, providers })
      .pipe(finalize(() => this.gatewaySaving.set(false)))
      .subscribe({
        next: (result) => {
          this.attendanceMessage.set(`Gateway registered. API key generated once: ${result['gatewayApiKey'] || 'stored'}`);
          const branchId = String(value['branchId'] || this.attendanceBranchId());
          this.gatewayForm.patchValue({ branchId, gatewayCode: '', displayName: '', machineName: '', versionLabel: '' });
          this.store.loadAttendanceCenter({ branchId, date: this.attendanceDate() });
        },
        error: (error: { error?: { error?: string; message?: string }; message?: string }) => {
          this.attendanceError.set(error?.error?.error || error?.error?.message || error?.message || 'Unable to register gateway');
        }
      });
  }

  createBiometricMapping(): void {
    if (this.mappingForm.invalid) {
      this.mappingForm.markAllAsTouched();
      return;
    }
    const value = this.mappingForm.getRawValue() as ApiRecord;
    this.attendanceError.set('');
    this.attendanceMessage.set('');
    this.mappingSaving.set(true);
    this.store.createBiometricMapping(value)
      .pipe(finalize(() => this.mappingSaving.set(false)))
      .subscribe({
        next: () => {
          const branchId = String(value['branchId'] || this.attendanceBranchId());
          this.attendanceMessage.set('Staff biometric mapping created.');
          this.mappingForm.patchValue({ branchId, deviceId: '', staffId: '', externalUserId: '', notes: '' });
          this.store.loadAttendanceCenter({ branchId, date: this.attendanceDate() });
        },
        error: (error: { error?: { error?: string; message?: string }; message?: string }) => {
          this.attendanceError.set(error?.error?.error || error?.error?.message || error?.message || 'Unable to create biometric mapping');
        }
      });
  }

  approveBiometricMapping(mapping: ApiRecord): void {
    const id = String(mapping['id'] || '');
    if (!id) return;
    const branchId = String(mapping['branchId'] || this.attendanceBranchId());
    this.attendanceError.set('');
    this.attendanceMessage.set('');
    this.store.approveBiometricMapping(id, { version: mapping['version'] || 1 })
      .subscribe({
        next: () => {
          this.attendanceMessage.set('Biometric mapping approved.');
          this.store.loadAttendanceCenter({ branchId, date: this.attendanceDate() });
        },
        error: (error: { error?: { error?: string; message?: string }; message?: string }) => {
          this.attendanceError.set(error?.error?.error || error?.error?.message || error?.message || 'Unable to approve mapping');
        }
      });
  }

  saveBiometricConsent(): void {
    if (this.consentForm.invalid) {
      this.consentForm.markAllAsTouched();
      return;
    }
    const value = this.consentForm.getRawValue() as ApiRecord;
    this.attendanceError.set('');
    this.attendanceMessage.set('');
    this.consentSaving.set(true);
    this.store.upsertBiometricConsent(value)
      .pipe(finalize(() => this.consentSaving.set(false)))
      .subscribe({
        next: () => {
          const branchId = String(value['branchId'] || this.attendanceBranchId());
          this.attendanceMessage.set('Biometric consent saved.');
          this.consentForm.patchValue({ branchId, staffId: '' });
          this.store.loadAttendanceCenter({ branchId, date: this.attendanceDate() });
        },
        error: (error: { error?: { error?: string; message?: string }; message?: string }) => {
          this.attendanceError.set(error?.error?.error || error?.error?.message || error?.message || 'Unable to save consent');
        }
      });
  }

  requestConsentDeletion(consent: ApiRecord): void {
    const id = String(consent['id'] || '');
    if (!id) return;
    const branchId = String(consent['branchId'] || this.attendanceBranchId());
    this.attendanceError.set('');
    this.attendanceMessage.set('');
    this.store.requestBiometricConsentDeletion(id, { reason: 'Staff requested biometric evidence delete review' })
      .subscribe({
        next: () => {
          this.attendanceMessage.set('Consent delete request recorded.');
          this.store.loadAttendanceCenter({ branchId, date: this.attendanceDate() });
        },
        error: (error: { error?: { error?: string; message?: string }; message?: string }) => {
          this.attendanceError.set(error?.error?.error || error?.error?.message || error?.message || 'Unable to request delete');
        }
      });
  }

  runFraudScan(): void {
    const branchId = this.attendanceBranchId();
    if (!branchId) {
      this.attendanceError.set('Select branch first.');
      return;
    }
    this.attendanceError.set('');
    this.attendanceMessage.set('');
    this.fraudScanning.set(true);
    this.store.runAttendanceFraudScan({ branchId, date: this.attendanceDate() })
      .pipe(finalize(() => this.fraudScanning.set(false)))
      .subscribe({
        next: (result) => {
          const risks = Array.isArray(result['openRisks']) ? result['openRisks'].length : 0;
          this.attendanceMessage.set(`Fraud scan complete. ${risks} open risk event(s).`);
          this.store.loadAttendanceCenter({ branchId, date: this.attendanceDate() });
        },
        error: (error: { error?: { error?: string; message?: string }; message?: string }) => {
          this.attendanceError.set(error?.error?.error || error?.error?.message || error?.message || 'Unable to run fraud scan');
        }
      });
  }

  generatePayrollPreview(): void {
    if (this.payrollPreviewForm.invalid) {
      this.payrollPreviewForm.markAllAsTouched();
      return;
    }
    const value = this.payrollPreviewForm.getRawValue() as ApiRecord;
    const branchId = String(value['branchId'] || this.attendanceBranchId());
    this.attendanceError.set('');
    this.attendanceMessage.set('');
    this.payrollPreviewSaving.set(true);
    this.store.generateAttendancePayrollPreview(value)
      .pipe(finalize(() => this.payrollPreviewSaving.set(false)))
      .subscribe({
        next: (result) => {
          const rows = Array.isArray(result['rows']) ? result['rows'].length : 0;
          this.attendanceMessage.set(`Payroll preview generated for ${rows} staff.`);
          this.store.loadAttendanceCenter({ branchId, date: this.attendanceDate(), periodStart: value['periodStart'], periodEnd: value['periodEnd'] });
        },
        error: (error: { error?: { error?: string; message?: string }; message?: string }) => {
          this.attendanceError.set(error?.error?.error || error?.error?.message || error?.message || 'Unable to generate payroll preview');
        }
      });
  }

  submitManualAttendance(): void {
    if (this.manualAttendanceForm.invalid) {
      this.manualAttendanceForm.markAllAsTouched();
      return;
    }
    const value = this.manualAttendanceForm.getRawValue() as ApiRecord;
    const branchId = String(value['branchId'] || this.attendanceBranchId());
    const staffId = String(value['staffId'] || '');
    const punchType = String(value['punchType'] || 'full_day') as AttendancePunchType;
    const businessDate = this.attendanceDate();
    const basePayload: ApiRecord = {
      branchId,
      staffId,
      businessDate,
      source: 'physical_manual',
      notes: value['notes'] || ''
    };
    this.attendanceError.set('');
    this.attendanceMessage.set('');
    this.manualAttendanceSaving.set(true);
    const request = punchType === 'clock_out'
      ? this.store.manualClockOut({
          ...basePayload,
          clockOutAt: this.attendanceTimestamp(businessDate, value['clockOutTime'] || '19:00'),
          overtimeMinutes: Number(value['overtimeMinutes'] || 0)
        })
      : punchType === 'full_day'
        ? this.store.manualClockIn({
            ...basePayload,
            clockInAt: this.attendanceTimestamp(businessDate, value['clockInTime'] || '10:00')
          }).pipe(switchMap((attendance) => this.store.manualClockOut({
            ...basePayload,
            attendanceId: attendance['id'],
            clockOutAt: this.attendanceTimestamp(businessDate, value['clockOutTime'] || '19:00'),
            overtimeMinutes: Number(value['overtimeMinutes'] || 0)
          })))
        : this.store.manualClockIn({
            ...basePayload,
            clockInAt: this.attendanceTimestamp(businessDate, value['clockInTime'] || '10:00')
          });
    request.pipe(finalize(() => this.manualAttendanceSaving.set(false))).subscribe({
      next: () => {
        this.attendanceMessage.set(punchType === 'full_day' ? 'Physical full-day attendance saved.' : punchType === 'clock_out' ? 'Physical clock-out saved.' : 'Physical clock-in saved.');
        this.manualAttendanceForm.patchValue({ branchId, staffId: '', notes: '' });
        this.store.loadAttendanceCenter({ branchId, date: businessDate });
      },
      error: (error: { error?: { error?: string; message?: string }; message?: string }) => {
        this.attendanceError.set(error?.error?.error || error?.error?.message || error?.message || 'Unable to save physical attendance');
      }
    });
  }

  submitTask(): void {
    if (this.taskForm.invalid) {
      this.taskForm.markAllAsTouched();
      return;
    }
    const value = this.taskForm.getRawValue() as ApiRecord;
    const branchId = String(value['branchId'] || this.attendanceBranchId());
    const payload: ApiRecord = {
      branchId,
      staffId: value['staffId'] || '',
      title: value['title'],
      description: value['description'] || '',
      taskType: value['taskType'] || 'general',
      priority: value['priority'] || 'medium',
      dueAt: value['dueAt'] || '',
      status: 'open'
    };
    this.taskError.set('');
    this.taskMessage.set('');
    this.taskSaving.set(true);
    this.store.createTask(payload)
      .pipe(finalize(() => this.taskSaving.set(false)))
      .subscribe({
        next: (task) => {
          this.store.tasks.update((rows) => [task, ...rows.filter((row) => row.id !== task.id)]);
          this.taskForm.patchValue({
            branchId,
            staffId: '',
            title: '',
            description: '',
            taskType: 'general',
            priority: 'medium',
            dueAt: new Date().toISOString().slice(0, 10)
          });
          this.taskMessage.set('Staff task created.');
        },
        error: (error: { error?: { error?: string; message?: string }; message?: string }) => {
          this.taskError.set(error?.error?.error || error?.error?.message || error?.message || 'Unable to create staff task');
        }
      });
  }

  completeTask(task: StaffOsTask): void {
    this.taskError.set('');
    this.taskMessage.set('');
    this.taskCompleting.set(task.id);
    this.store.updateTask(task, { status: 'completed' })
      .pipe(finalize(() => this.taskCompleting.set('')))
      .subscribe({
        next: () => {
          this.store.tasks.update((rows) => rows.filter((row) => row.id !== task.id));
          this.taskMessage.set('Task completed.');
        },
        error: (error: { error?: { error?: string; message?: string }; message?: string }) => {
          this.taskError.set(error?.error?.error || error?.error?.message || error?.message || 'Unable to complete staff task');
        }
      });
  }

  assignRosterShift(): void {
    if (this.rosterForm.invalid) {
      this.rosterForm.markAllAsTouched();
      return;
    }
    const value = this.rosterForm.getRawValue() as ApiRecord;
    const shift = this.selectedRosterShift();
    if (!shift) {
      this.rosterError.set('Select shift first.');
      return;
    }
    const branchId = String(value['branchId'] || this.attendanceBranchId());
    const payload: ApiRecord = {
      branchId,
      staffId: value['staffId'],
      scheduleDate: value['scheduleDate'],
      startTime: shift.startTime,
      endTime: shift.endTime,
      shiftType: shift.shiftType || 'regular',
      status: 'scheduled',
      notes: value['notes'] || ''
    };
    this.rosterError.set('');
    this.rosterMessage.set('');
    this.rosterSaving.set(true);
    this.store.createSchedule(payload)
      .pipe(finalize(() => this.rosterSaving.set(false)))
      .subscribe({
        next: (schedule) => {
          this.store.schedules.update((rows) => [schedule, ...rows.filter((row) => row.id !== schedule.id)]);
          this.rosterForm.patchValue({ branchId, staffId: '', notes: '' });
          this.rosterMessage.set('Roster shift assigned.');
        },
        error: (error: { error?: { error?: string; message?: string }; message?: string }) => {
          this.rosterError.set(error?.error?.error || error?.error?.message || error?.message || 'Unable to assign roster shift');
        }
      });
  }

  refreshLeaveManagement(): void {
    const branchId = String(this.leaveForm.get('branchId')?.value || this.attendanceBranchId());
    this.leaveError.set('');
    this.store.loadLeaves({ branchId, limit: 200 });
  }

  leaveRows(): ApiRecord[] {
    return this.store.leaves();
  }

  submitLeaveRequest(): void {
    if (this.leaveForm.invalid) {
      this.leaveForm.markAllAsTouched();
      return;
    }
    const value = this.leaveForm.getRawValue() as ApiRecord;
    const startDate = String(value['startDate'] || '');
    const endDate = String(value['endDate'] || startDate);
    if (startDate && endDate && endDate < startDate) {
      this.leaveError.set('End date start date se pehle nahi ho sakta.');
      return;
    }
    const branchId = String(value['branchId'] || this.attendanceBranchId());
    const payload: ApiRecord = {
      branchId,
      staffId: value['staffId'],
      leaveType: value['leaveType'],
      startDate,
      endDate,
      reason: value['reason'] || ''
    };
    this.leaveError.set('');
    this.leaveMessage.set('');
    this.leaveSaving.set(true);
    this.store.requestLeave(payload)
      .pipe(finalize(() => this.leaveSaving.set(false)))
      .subscribe({
        next: (leave) => {
          this.store.leaves.update((rows) => [leave, ...rows.filter((row) => row['id'] !== leave['id'])]);
          this.leaveForm.patchValue({ branchId, staffId: '', reason: '' });
          this.leaveMessage.set('Leave request saved. Approve karne ke baad heatmap aur payroll me live count aayega.');
        },
        error: (error: { error?: { error?: string; message?: string }; message?: string }) => {
          this.leaveError.set(error?.error?.error || error?.error?.message || error?.message || 'Unable to save leave request');
        }
      });
  }

  decideLeave(leave: ApiRecord, status: 'approved' | 'rejected'): void {
    this.leaveError.set('');
    this.leaveMessage.set('');
    this.leaveDecisionChanging.set(String(leave['id'] || ''));
    const request = status === 'approved' ? this.store.approveLeave(leave) : this.store.rejectLeave(leave);
    request
      .pipe(finalize(() => this.leaveDecisionChanging.set('')))
      .subscribe({
        next: (updated) => {
          this.store.leaves.update((rows) => rows.map((row) => row['id'] === updated['id'] ? updated : row));
          this.leaveMessage.set(status === 'approved' ? 'Leave approved. Leave calendar heatmap refresh karo.' : 'Leave rejected.');
        },
        error: (error: { error?: { error?: string; message?: string }; message?: string }) => {
          this.leaveError.set(error?.error?.error || error?.error?.message || error?.message || 'Unable to update leave request');
        }
      });
  }

  leaveDateRange(leave: ApiRecord): string {
    const start = String(leave['startDate'] || leave['start_date'] || '');
    const end = String(leave['endDate'] || leave['end_date'] || start);
    return start === end ? start : `${start} - ${end}`;
  }

  leaveTypeName(leave: ApiRecord): string {
    const type = String(leave['leaveType'] || leave['leave_type'] || '');
    return this.store.leaveMasters().find((item) => item.code === type || item.id === type)?.name || type || 'Leave';
  }

  registerBiometricDevice(): void {
    if (this.deviceForm.invalid) {
      this.deviceForm.markAllAsTouched();
      return;
    }
    const value = this.deviceForm.getRawValue();
    this.attendanceError.set('');
    this.attendanceMessage.set('');
    this.deviceSaving.set(true);
    this.store.registerBiometricDevice(value)
      .pipe(finalize(() => this.deviceSaving.set(false)))
      .subscribe({
        next: () => {
          const branchId = String(value.branchId || this.attendanceBranchId());
          this.deviceForm.patchValue({ branchId, deviceCode: '', deviceName: '', locationLabel: '' });
          this.attendanceMessage.set('Biometric device added.');
          this.store.loadAttendanceCenter({ branchId, date: this.attendanceDate() });
        },
        error: (error: { error?: { error?: string; message?: string }; message?: string }) => {
          this.attendanceError.set(error?.error?.error || error?.error?.message || error?.message || 'Unable to add biometric device');
        }
      });
  }

  processBiometricQueue(): void {
    const branchId = this.attendanceBranchId();
    if (!branchId) {
      this.attendanceError.set('Select branch first.');
      return;
    }
    this.attendanceError.set('');
    this.attendanceMessage.set('');
    this.queueProcessing.set(true);
    this.store.processBiometricQueue({ branchId, limit: 100 })
      .pipe(finalize(() => this.queueProcessing.set(false)))
      .subscribe({
        next: (result) => {
          this.attendanceMessage.set(`Biometric queue processed: ${result['processed'] || 0} ok, ${result['failed'] || 0} failed.`);
          this.store.loadAttendanceCenter({ branchId, date: this.attendanceDate() });
        },
        error: (error: { error?: { error?: string; message?: string }; message?: string }) => {
          this.attendanceError.set(error?.error?.error || error?.error?.message || error?.message || 'Unable to process biometric queue');
        }
      });
  }

  async startCamera(): Promise<void> {
    this.attendanceError.set('');
    this.attendanceMessage.set('');
    if (!globalThis.navigator?.mediaDevices?.getUserMedia) {
      this.attendanceError.set('Camera is not available in this browser.');
      return;
    }
    this.cameraStarting.set(true);
    try {
      this.stopCamera();
      const stream = await globalThis.navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' }, audio: false });
      this.cameraStream = stream;
      this.cameraActive.set(true);
      await new Promise((resolve) => setTimeout(resolve, 0));
      const video = this.attendanceVideo?.nativeElement;
      if (video) {
        video.srcObject = stream;
        await video.play();
      }
    } catch (error) {
      this.cameraActive.set(false);
      this.attendanceError.set(error instanceof Error ? error.message : 'Unable to open camera');
    } finally {
      this.cameraStarting.set(false);
    }
  }

  stopCamera(): void {
    if (this.cameraStream) {
      for (const track of this.cameraStream.getTracks()) track.stop();
    }
    this.cameraStream = null;
    if (this.attendanceVideo?.nativeElement) {
      this.attendanceVideo.nativeElement.srcObject = null;
    }
    this.cameraActive.set(false);
  }

  submitCameraPunch(): void {
    if (this.cameraForm.invalid) {
      this.cameraForm.markAllAsTouched();
      return;
    }
    const imageDataUrl = this.captureCameraImage();
    if (!imageDataUrl) {
      this.attendanceError.set('Start camera before saving punch.');
      return;
    }
    const value = this.cameraForm.getRawValue() as ApiRecord;
    const branchId = String(value['branchId'] || this.attendanceBranchId());
    const punchType = String(value['punchType'] || 'clock_in') as AttendancePunchType;
    this.attendanceError.set('');
    this.attendanceMessage.set('');
    this.cameraSaving.set(true);
    this.store.cameraPunch({
      ...value,
      branchId,
      punchType,
      businessDate: this.attendanceDate(),
      capturedAt: new Date().toISOString(),
      imageDataUrl
    }).pipe(finalize(() => this.cameraSaving.set(false))).subscribe({
      next: () => {
        this.attendanceMessage.set(punchType === 'clock_in' ? 'Camera clock-in saved.' : 'Camera clock-out saved.');
        this.store.loadAttendanceCenter({ branchId, date: this.attendanceDate() });
      },
      error: (error: { error?: { error?: string; message?: string }; message?: string }) => {
        this.attendanceError.set(error?.error?.error || error?.error?.message || error?.message || 'Unable to save camera attendance');
      }
    });
  }

  displayStaffName(row: ApiRecord): string {
    const name = String(row['staffName'] || row['staff_name'] || '').trim();
    if (name) return name;
    const staff = this.store.staff().find((item) => item.id === row['staffId'] || item.id === row['staff_id']);
    return staff?.fullName || String(row['staffId'] || row['staff_id'] || 'Staff');
  }

  staffNameById(staffId: string): string {
    return this.store.staff().find((staff) => staff.id === staffId)?.fullName || staffId || 'Staff';
  }

  timeOnly(value: unknown): string {
    if (!value) return '';
    const date = new Date(String(value));
    if (Number.isNaN(date.getTime())) return String(value).slice(11, 16);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  pendingMappingCount(): number {
    return this.store.biometricMappings().filter((mapping) => String(mapping['status'] || '').toLowerCase() !== 'approved').length;
  }

  pendingConsentCount(): number {
    return this.store.biometricConsents().filter((consent) => String(consent['consentStatus'] || '').toLowerCase() !== 'granted').length;
  }

  openAddStaff(): void {
    const branchId = this.staffForm.get('branchId')?.value || this.defaultBranchId(this.branchOptions());
    this.addStaffError.set('');
    this.staffForm.patchValue({ branchId, employeeCode: this.nextStaffEmployeeCode(branchId) });
    this.detailTab.set('core');
    this.addStaffOpen.set(true);
  }

  attendanceBranchId(): string {
    return String(
      this.manualAttendanceForm.get('branchId')?.value
      || this.cameraForm.get('branchId')?.value
      || this.deviceForm.get('branchId')?.value
      || this.gatewayForm.get('branchId')?.value
      || this.mappingForm.get('branchId')?.value
      || this.consentForm.get('branchId')?.value
      || this.payrollPreviewForm.get('branchId')?.value
      || this.rosterForm.get('branchId')?.value
      || this.appState.selectedBranchId()
      || this.branchOptions()[0]?.id
      || ''
    );
  }

  private applyAttendanceRouteContext(): void {
    const params = this.route.snapshot.queryParamMap;
    const date = params.get('date') || params.get('businessDate') || '';
    const branchId = params.get('branchId') || '';
    const staffId = params.get('staffId') || '';
    if (date) {
      this.attendanceDate.set(date);
      this.payrollPreviewForm.patchValue({ periodStart: date, periodEnd: date }, { emitEvent: false });
    }
    if (branchId) this.patchAttendanceBranch(branchId);
    if (staffId) {
      this.manualAttendanceForm.patchValue({ staffId }, { emitEvent: false });
      this.cameraForm.patchValue({ staffId }, { emitEvent: false });
      this.mappingForm.patchValue({ staffId }, { emitEvent: false });
      this.consentForm.patchValue({ staffId }, { emitEvent: false });
      this.taskForm.patchValue({ staffId }, { emitEvent: false });
      this.rosterForm.patchValue({ staffId }, { emitEvent: false });
      this.leaveForm.patchValue({ staffId }, { emitEvent: false });
    }
  }

  private patchAttendanceBranch(branchId: string): void {
    this.manualAttendanceForm.patchValue({ branchId }, { emitEvent: false });
    this.cameraForm.patchValue({ branchId }, { emitEvent: false });
    this.deviceForm.patchValue({ branchId }, { emitEvent: false });
    this.gatewayForm.patchValue({ branchId }, { emitEvent: false });
    this.mappingForm.patchValue({ branchId }, { emitEvent: false });
    this.consentForm.patchValue({ branchId }, { emitEvent: false });
    this.payrollPreviewForm.patchValue({ branchId }, { emitEvent: false });
    this.taskForm.patchValue({ branchId }, { emitEvent: false });
    this.rosterForm.patchValue({ branchId }, { emitEvent: false });
    this.leaveForm.patchValue({ branchId }, { emitEvent: false });
  }

  private attendanceTimestamp(date: string, value: unknown): string {
    const time = String(value || '10:00').match(/^\d{2}:\d{2}$/) ? String(value) : '10:00';
    return `${date}T${time}:00+05:30`;
  }

  private captureCameraImage(): string {
    const video = this.attendanceVideo?.nativeElement;
    if (!video || !this.cameraActive()) return '';
    const width = video.videoWidth || 640;
    const height = video.videoHeight || 480;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) return '';
    context.drawImage(video, 0, 0, width, height);
    return canvas.toDataURL('image/jpeg', 0.72);
  }

  closeAddStaff(): void {
    if (this.addStaffSaving()) return;
    this.addStaffOpen.set(false);
    this.addStaffError.set('');
  }

  fieldInvalid(name: string): boolean {
    const control = this.staffForm.get(name);
    return Boolean(control && control.invalid && (control.dirty || control.touched));
  }

  saveStaff(): void {
    if (this.staffForm.invalid) {
      this.staffForm.markAllAsTouched();
      return;
    }
    const value = this.staffForm.getRawValue() as Record<string, unknown>;
    const loginEnabled = Boolean(value.enableStaffLogin || value.loginId || value.loginPassword);
    if (loginEnabled && (!String(value.loginId || '').trim() || !String(value.loginPassword || '').trim())) {
      this.addStaffError.set('Login ID and password are required when staff login is enabled.');
      this.detailTab.set('core');
      return;
    }
    const skillNotes = String(value.skillLicenseNotes || '').trim();
    const notes = skillNotes ? `Skill/license notes: ${skillNotes}` : '';
    const employeeDetails = this.buildEmployeeDetails(value);
    this.addStaffSaving.set(true);
    this.addStaffError.set('');
    this.store.createStaff({
      branchId: value.branchId,
      employeeCode: String(value.employeeCode || this.nextStaffEmployeeCode(String(value.branchId || ''))),
      firstName: value.firstName,
      lastName: value.lastName,
      mobile: value.mobile || value.contactMobile,
      email: value.email || value.contactEmail,
      gender: value.gender,
      dob: value.birthDate,
      joiningDate: value.joiningDate,
      roleId: value.roleId,
      staffCategoryId: value.staffCategoryId,
      employmentType: value.employmentType,
      department: value.department,
      designation: value.designation,
      emergencyContactName: value.emergencyContactName,
      emergencyContactMobile: value.emergencyContactMobile,
      address: value.address,
      city: value.city,
      state: value.state,
      pincode: value.pincode,
      employeeDetails,
      staffLogin: loginEnabled ? {
        enabled: true,
        loginId: value.loginId,
        email: value.email || value.contactEmail,
        password: value.loginPassword,
        role: value.loginRole || 'staff'
      } : undefined,
      notes
    }).pipe(finalize(() => this.addStaffSaving.set(false))).subscribe({
      next: () => {
        const branchId = String(value.branchId || '');
        this.staffForm.reset(this.defaultStaffFormValue(branchId));
        this.resetIncentiveProfile();
        this.detailTab.set('core');
        this.addStaffOpen.set(false);
        this.store.load();
      },
      error: (error: { error?: { error?: string; message?: string }; message?: string }) => {
        this.addStaffError.set(error?.error?.error || error?.error?.message || error?.message || 'Unable to save staff');
      }
    });
  }

  activeCategoriesForSelectedBranch(): StaffOsStaffCategory[] {
    const branchId = this.staffForm.get('branchId')?.value || '';
    return this.store.staffCategories().filter((category) => {
      const branchMatches = !category.branchId || !branchId || category.branchId === branchId;
      return category.status === 'active' && branchMatches;
    });
  }

  applySelectedCategoryDefaults(): void {
    const categoryId = this.staffForm.get('staffCategoryId')?.value;
    const category = this.store.staffCategories().find((item) => item.id === categoryId);
    if (!category) return;
    this.staffForm.patchValue({
      department: category.department || this.staffForm.get('department')?.value || '',
      designation: category.defaultDesignation || this.staffForm.get('designation')?.value || '',
      employmentType: category.defaultEmploymentType || this.staffForm.get('employmentType')?.value || 'full_time',
      fixedIncentivePercent: category.fixedIncentivePercent ?? this.staffForm.get('fixedIncentivePercent')?.value ?? 0,
      fixedIncentiveAmount: category.fixedIncentiveAmount ?? this.staffForm.get('fixedIncentiveAmount')?.value ?? 0,
      serviceIncentiveRules: category.serviceEligibility?.length
        ? category.serviceEligibility.join(', ')
        : this.staffForm.get('serviceIncentiveRules')?.value || '',
      skillLicenseNotes: category.skillLicenses?.length
        ? category.skillLicenses.join(', ')
        : this.staffForm.get('skillLicenseNotes')?.value || ''
    });
  }

  selectedCategory(): StaffOsStaffCategory | undefined {
    const categoryId = this.staffForm.get('staffCategoryId')?.value;
    return this.store.staffCategories().find((item) => item.id === categoryId);
  }

  selectedBranchName(): string {
    const branchId = this.staffForm.get('branchId')?.value || '';
    const branch = this.branchOptions().find((item) => item.id === branchId);
    return branch?.name || branchId || 'Select branch';
  }

  employeeLiveCards(): EmployeeLiveCard[] {
    const branchId = String(this.staffForm.get('branchId')?.value || '');
    const category = this.selectedCategory();
    const branchStaff = this.store.staff().filter((staff) => !branchId || staff.branchId === branchId);
    const activeStaff = branchStaff.filter((staff) => ['active', 'working', ''].includes(String(staff.status || '').toLowerCase()));
    const branchSchedules = this.store.schedules().filter((schedule) => !branchId || schedule.branchId === branchId);
    const attendanceRows = this.attendanceRows().filter((row) => {
      const rowBranch = String(row['branchId'] || row['branch_id'] || '');
      return !branchId || !rowBranch || rowBranch === branchId;
    });
    const payrollSync = this.staffForm.get('incentivePayrollSync')?.value ? 'Auto' : 'Manual';
    return [
      {
        label: 'Branch Staff',
        value: activeStaff.length,
        hint: `${branchStaff.length} total records`,
        tone: 'blue'
      },
      {
        label: 'Roster',
        value: branchSchedules.length,
        hint: 'live shifts connected',
        tone: branchSchedules.length ? 'green' : 'amber'
      },
      {
        label: 'Attendance',
        value: attendanceRows.length,
        hint: 'today records',
        tone: attendanceRows.length ? 'green' : 'amber'
      },
      {
        label: 'Commission',
        value: this.incentiveRules().length,
        hint: `${payrollSync} payroll sync`,
        tone: 'violet'
      },
      {
        label: 'Category',
        value: category?.name || 'Not set',
        hint: category ? this.categoryScopeLabel(category.scope) : 'select to apply defaults',
        tone: category ? 'green' : 'amber'
      },
      {
        label: 'Tasks',
        value: this.store.tasks().length,
        hint: 'staff action queue',
        tone: this.store.tasks().length ? 'blue' : 'neutral'
      }
    ];
  }

  employeeCatalogCards(): EmployeeCatalogCard[] {
    return [
      { label: 'Services', value: this.store.services().length },
      { label: 'Products', value: this.store.products().length },
      { label: 'Memberships', value: this.store.memberships().length },
      { label: 'Packages', value: this.store.packages().length },
      { label: 'Performance', value: this.store.performance().rows?.length || 0 },
      { label: 'Risks', value: this.actionableRisks().length }
    ];
  }

  private orderedBranchOptions(): StaffOsBranch[] {
    const selectedBranchId = this.appState.selectedBranchId();
    const seen = new Set<string>();
    const rows = this.store.branches()
      .filter((branch) => {
        const id = String(branch.id || '').trim();
        if (!id || seen.has(id)) return false;
        seen.add(id);
        return !branch.status || branch.status === 'active' || id === selectedBranchId;
      })
      .sort((left, right) => {
        if (left.id === selectedBranchId) return -1;
        if (right.id === selectedBranchId) return 1;
        return String(left.name || left.id).localeCompare(String(right.name || right.id));
      });
    if (selectedBranchId && !seen.has(selectedBranchId)) {
      return [{ id: selectedBranchId, name: selectedBranchId, status: 'active' }, ...rows];
    }
    return rows;
  }

  private defaultBranchId(options: StaffOsBranch[]): string {
    return this.appState.selectedBranchId() || options[0]?.id || '';
  }

  private serviceCategoryOptions(): IncentiveOption[] {
    const seen = new Set<string>();
    return this.store.services()
      .map((service) => String(service.category || '').trim())
      .filter((category) => {
        if (!category || seen.has(category)) return false;
        seen.add(category);
        return true;
      })
      .sort((left, right) => left.localeCompare(right))
      .map((category) => ({ id: category, name: category, meta: 'category' }));
  }

  private recordOptions(rows: Array<Record<string, unknown>>): IncentiveOption[] {
    return rows
      .filter((row) => !row['status'] || row['status'] === 'active')
      .map((row) => ({
        id: String(row['id'] || ''),
        name: String(row['name'] || row['title'] || row['sku'] || row['id'] || ''),
        meta: [row['category'], row['price'] ? `₹${row['price']}` : '', row['status']].filter(Boolean).join(' · ')
      }))
      .filter((row) => row.id && row.name)
      .sort((left, right) => left.name.localeCompare(right.name));
  }

  private defaultIncentiveRule(type: IncentiveRuleType): IncentiveRuleDraft {
    return {
      id: this.makeDraftId('rule'),
      type,
      targetId: '',
      targetName: '',
      calcMode: type === 'product' ? 'fixed' : 'percent',
      value: type === 'product' ? 50 : 5,
      minAmount: 0,
      notes: '',
      active: true
    };
  }

  private defaultIncentiveSlab(fromAmount: number, toAmount: number, incentivePercent: number): IncentiveSlabDraft {
    return {
      id: this.makeDraftId('slab'),
      fromAmount,
      toAmount,
      incentivePercent,
      incentiveAmount: 0
    };
  }

  private resetIncentiveProfile(): void {
    this.advancedIncentiveOpen.set(false);
    this.incentiveRules.set([this.defaultIncentiveRule('service_category')]);
    this.incentiveSlabs.set([this.defaultIncentiveSlab(0, 25000, 5)]);
  }

  private makeDraftId(prefix: string): string {
    return `${prefix}_${globalThis.crypto?.randomUUID?.() || `${Date.now()}_${Math.random().toString(16).slice(2)}`}`;
  }

  selectedCategoryDefaultsText(): string {
    const category = this.selectedCategory();
    if (!category) return 'Waiting for category';
    const parts = [
      category.department,
      category.defaultDesignation,
      category.defaultEmploymentType,
      category.fixedIncentivePercent ? `${category.fixedIncentivePercent}% incentive` : '',
      category.fixedIncentiveAmount ? `₹${category.fixedIncentiveAmount} fixed` : ''
    ].filter(Boolean);
    return parts.join(' · ') || 'No defaults set';
  }

  incentiveSummaryText(): string {
    const rules = this.incentiveRules().length;
    const slabs = this.incentiveSlabs().length;
    const payroll = this.staffForm.get('incentivePayrollSync')?.value ? 'payroll auto-sync' : 'manual payroll review';
    const approval = this.staffForm.get('incentiveRequiresApproval')?.value ? 'approval required' : 'no approval gate';
    return `${rules} rule${rules === 1 ? '' : 's'} · ${slabs} slab${slabs === 1 ? '' : 's'} · ${payroll} · ${approval}`;
  }

  targetOptionsFor(type: IncentiveRuleType): IncentiveOption[] {
    if (type === 'service_category') return this.serviceCategoryOptions();
    if (type === 'service') {
      return this.store.services()
        .filter((service) => !service.status || service.status === 'active')
        .map((service) => ({
          id: service.id,
          name: service.name,
          meta: [service.category, service.price ? `₹${service.price}` : ''].filter(Boolean).join(' · ')
        }));
    }
    if (type === 'product') return this.recordOptions(this.store.products());
    if (type === 'membership') return this.recordOptions(this.store.memberships());
    if (type === 'package') return this.recordOptions(this.store.packages());
    return [];
  }

  addIncentiveRule(type: IncentiveRuleType = 'service_category'): void {
    this.incentiveRules.update((rules) => [...rules, this.defaultIncentiveRule(type)]);
  }

  removeIncentiveRule(id: string): void {
    this.incentiveRules.update((rules) => rules.length === 1 ? rules : rules.filter((rule) => rule.id !== id));
  }

  setIncentiveRuleType(id: string, type: IncentiveRuleType): void {
    this.incentiveRules.update((rules) => rules.map((rule) => rule.id === id ? {
      ...rule,
      type,
      targetId: '',
      targetName: '',
      calcMode: type === 'product' ? 'fixed' : 'percent'
    } : rule));
  }

  setIncentiveRuleTarget(id: string, type: IncentiveRuleType, targetId: string): void {
    const option = this.targetOptionsFor(type).find((item) => item.id === targetId);
    this.incentiveRules.update((rules) => rules.map((rule) => rule.id === id ? {
      ...rule,
      targetId,
      targetName: option?.name || targetId
    } : rule));
  }

  updateIncentiveRule(id: string, key: keyof IncentiveRuleDraft, value: string): void {
    const numericKeys = new Set<keyof IncentiveRuleDraft>(['value', 'minAmount']);
    const booleanKeys = new Set<keyof IncentiveRuleDraft>(['active']);
    this.incentiveRules.update((rules) => rules.map((rule) => {
      if (rule.id !== id) return rule;
      const nextValue = numericKeys.has(key)
        ? Number(value || 0)
        : booleanKeys.has(key)
          ? value === 'true'
          : value;
      return { ...rule, [key]: nextValue };
    }));
  }

  addIncentiveSlab(): void {
    const slabs = this.incentiveSlabs();
    const last = slabs[slabs.length - 1];
    const nextFrom = Number(last?.toAmount || 0) + 1;
    const nextTo = nextFrom + 25000;
    this.incentiveSlabs.update((slabs) => [...slabs, this.defaultIncentiveSlab(nextFrom, nextTo, Number(last?.incentivePercent || 5) + 2)]);
  }

  removeIncentiveSlab(id: string): void {
    this.incentiveSlabs.update((slabs) => slabs.length === 1 ? slabs : slabs.filter((slab) => slab.id !== id));
  }

  updateIncentiveSlab(id: string, key: keyof IncentiveSlabDraft, value: string): void {
    this.incentiveSlabs.update((slabs) => slabs.map((slab) => slab.id === id ? { ...slab, [key]: Number(value || 0) } : slab));
  }

  trackById(_index: number, item: { id: string }): string {
    return item.id;
  }

  activeIntegrationLinks(): StaffIntegrationLink[] {
    return this.integrationLinks[this.detailTab()];
  }

  staffLiveBadges(staff: StaffOsStaff): string[] {
    const details = staff.employeeDetails;
    const salary = (details?.attendanceSalary || {}) as Record<string, unknown>;
    const badges = [];
    if (details?.contact && Object.keys(details.contact).length) badges.push('Contact');
    if (details?.emergencyContact && Object.keys(details.emergencyContact).length) badges.push('Emergency');
    if (details?.incentive && Object.keys(details.incentive).length) badges.push('Incentive');
    if (Number(salary['basicSalary'] || 0) > 0) badges.push('Salary');
    if (staff.staffCategoryName) badges.push('Category');
    if (staff.loginPasswordSet) badges.push('Login');
    return badges.length ? badges : ['Core only'];
  }

  categoryScopeLabel(scope: string): string {
    const labels: Record<string, string> = {
      operator: 'Operator',
      helper: 'Helper',
      admin: 'Admin',
      staff: 'Staff',
      contract_operator: 'Contract Operator'
    };
    return labels[scope] || scope;
  }

  statusActionLabel(staff: StaffOsStaff): string {
    return staff.status === 'archived' || staff.status === 'inactive' ? 'Restore' : 'Archive';
  }

  toggleStaffStatus(staff: StaffOsStaff): void {
    const status = staff.status === 'archived' || staff.status === 'inactive' ? 'active' : 'archived';
    this.staffActionError.set('');
    this.statusChanging.set(staff.id);
    this.store.updateStaffStatus(staff, status)
      .pipe(finalize(() => this.statusChanging.set('')))
      .subscribe({
        next: () => this.store.load(),
        error: (error: { error?: { error?: string; message?: string }; message?: string }) => {
          this.staffActionError.set(error?.error?.error || error?.error?.message || error?.message || 'Unable to update staff status');
        }
      });
  }

  private buildEmployeeDetails(value: Record<string, unknown>): Record<string, unknown> {
    return {
      shortName: value.shortName,
      lastWorkingDate: value.lastWorkingDate,
      anniversaryDate: value.anniversaryDate,
      hideFromRoster: value.hideFromRoster,
      allowSkipOtp: value.allowSkipOtp,
      entryPin: value.entryPin,
      contact: {
        contactPerson: value.contactPerson,
        mobile: value.contactMobile,
        address: value.address,
        addressLine2: value.addressLine2,
        landmark: value.landmark,
        city: value.city,
        pincode: value.pincode,
        state: value.state,
        country: value.country,
        area: value.area,
        phone: value.phone,
        fax: value.fax,
        email: value.contactEmail,
        web: value.web
      },
      emergencyContact: {
        name: value.emergencyContactName,
        mobile: value.emergencyContactMobile,
        phone: value.emergencyContactPhone,
        relation: value.emergencyRelation,
        address: value.emergencyAddress,
        city: value.emergencyCity,
        state: value.emergencyState,
        country: value.emergencyCountry
      },
      nativeContact: {
        name: value.nativeContactName,
        mobile: value.nativeContactMobile,
        phone: value.nativeContactPhone,
        address: value.nativeAddress,
        city: value.nativeCity,
        state: value.nativeState,
        country: value.nativeCountry
      },
      incentive: {
        fixedIncentivePercent: Number(value.fixedIncentivePercent || 0),
        fixedIncentiveAmount: Number(value.fixedIncentiveAmount || 0),
        serviceIncentiveRules: value.serviceIncentiveRules,
        ruleBuilder: this.incentiveRules().map((rule) => ({
          type: rule.type,
          targetId: rule.targetId,
          targetName: rule.targetName,
          calcMode: rule.calcMode,
          value: Number(rule.value || 0),
          minAmount: Number(rule.minAmount || 0),
          notes: rule.notes,
          active: rule.active
        })),
        targetSlabs: this.incentiveSlabs().map((slab, index) => ({
          sNo: index + 1,
          fromAmount: Number(slab.fromAmount || 0),
          toAmount: Number(slab.toAmount || 0),
          incentivePercent: Number(slab.incentivePercent || 0),
          incentiveAmount: Number(slab.incentiveAmount || 0)
        })),
        cycle: value.incentiveCycle,
        validity: {
          startDate: value.incentiveStartDate,
          endDate: value.incentiveEndDate
        },
        capAmount: Number(value.incentiveCapAmount || 0),
        payrollSync: Boolean(value.incentivePayrollSync),
        approval: {
          required: Boolean(value.incentiveRequiresApproval),
          role: value.incentiveApprovalRole,
          payoutStatus: value.incentivePayoutStatus
        },
        attendanceRule: {
          holdAfterAbsentDays: Number(value.incentiveHoldOnAbsentDays || 0),
          reduceAfterLateCount: Number(value.incentiveReduceOnLateCount || 0),
          reductionPercent: Number(value.incentiveReducePercent || 0)
        },
        notes: value.incentiveNotes
      },
      attendanceSalary: {
        weeklyOff: value.weeklyOff,
        empCodeInDevice: value.empCodeInDevice,
        rfidCardNo: value.rfidCardNo,
        attendanceCategory: value.attendanceCategory,
        defaultShift: value.defaultShift,
        devicePrivilege: value.devicePrivilege,
        salaryStructureId: value.salaryStructureId,
        salaryCycle: value.salaryCycle,
        salaryEffectiveFrom: value.salaryEffectiveFrom,
        basicSalary: Number(value.basicSalary || 0),
        paymentMode: value.paymentMode,
        bankName: value.bankName,
        accountNumber: value.accountNumber,
        loanInstallment: Number(value.loanInstallment || 0),
        loanBalance: Number(value.loanBalance || 0),
        otExtraRate: Number(value.otExtraRate || 0),
        lessWorkPenalty: Number(value.lessWorkPenalty || 0),
        supportAttendancePayroll: value.supportAttendancePayroll,
        weeklyOffOvertime: value.weeklyOffOvertime,
        pfApplicable: value.pfApplicable,
        pfNo: value.pfNo,
        ptApplicable: value.ptApplicable,
        ptNo: value.ptNo,
        esicApplicable: value.esicApplicable,
        esicNo: value.esicNo,
        tdsApplicable: value.tdsApplicable,
        panNo: value.panNo,
        aadhaarNo: value.aadhaarNo
      },
      remarks: value.remarks,
      imeiNo: value.imeiNo
    };
  }

  private defaultStaffFormValue(branchId = ''): Record<string, unknown> {
    return {
      branchId,
      firstName: '',
      lastName: '',
      shortName: '',
      employeeCode: branchId ? this.nextStaffEmployeeCode(branchId) : '',
      mobile: '',
      email: '',
      enableStaffLogin: false,
      loginId: '',
      loginPassword: '',
      loginRole: 'staff',
      roleId: 'staff',
      staffCategoryId: '',
      employmentType: 'full_time',
      department: '',
      designation: '',
      joiningDate: '',
      lastWorkingDate: '',
      birthDate: '',
      anniversaryDate: '',
      gender: '',
      entryPin: '',
      hideFromRoster: false,
      allowSkipOtp: false,
      skillLicenseNotes: '',
      contactPerson: '',
      contactMobile: '',
      address: '',
      addressLine2: '',
      landmark: '',
      city: '',
      pincode: '',
      state: '',
      country: '',
      area: '',
      phone: '',
      fax: '',
      contactEmail: '',
      web: '',
      emergencyContactName: '',
      emergencyContactMobile: '',
      emergencyContactPhone: '',
      emergencyRelation: '',
      emergencyAddress: '',
      emergencyCity: '',
      emergencyState: '',
      emergencyCountry: '',
      nativeContactName: '',
      nativeContactMobile: '',
      nativeContactPhone: '',
      nativeAddress: '',
      nativeCity: '',
      nativeState: '',
      nativeCountry: '',
      fixedIncentivePercent: 0,
      fixedIncentiveAmount: 0,
      serviceIncentiveRules: '',
      incentiveNotes: '',
      incentiveCycle: 'monthly',
      incentiveStartDate: '',
      incentiveEndDate: '',
      incentiveCapAmount: 0,
      incentivePayrollSync: true,
      incentiveRequiresApproval: true,
      incentiveApprovalRole: 'manager',
      incentiveHoldOnAbsentDays: 2,
      incentiveReduceOnLateCount: 3,
      incentiveReducePercent: 10,
      incentivePayoutStatus: 'draft',
      weeklyOff: '',
      empCodeInDevice: '',
      rfidCardNo: '',
      attendanceCategory: '',
      defaultShift: '',
      devicePrivilege: 'user',
      salaryStructureId: '',
      salaryCycle: 'monthly',
      salaryEffectiveFrom: '',
      basicSalary: 0,
      paymentMode: '',
      bankName: '',
      accountNumber: '',
      loanInstallment: 0,
      loanBalance: 0,
      otExtraRate: 0,
      lessWorkPenalty: 0,
      supportAttendancePayroll: false,
      weeklyOffOvertime: false,
      pfApplicable: false,
      pfNo: '',
      ptApplicable: false,
      ptNo: '',
      esicApplicable: false,
      esicNo: '',
      tdsApplicable: false,
      panNo: '',
      aadhaarNo: '',
      remarks: '',
      imeiNo: ''
    };
  }

  private nextStaffEmployeeCode(branchId = ''): string {
    const branchKey = String(branchId || '');
    const usedCodes = this.store.staff()
      .filter((staff) => !branchKey || String(staff.branchId || '') === branchKey)
      .map((staff) => Number(String(staff.employeeCode || '').trim()))
      .filter((code) => Number.isInteger(code) && code > 0);
    return String((usedCodes.length ? Math.max(...usedCodes) : 0) + 1);
  }
}
