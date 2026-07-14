import { CommonModule } from '@angular/common';
import { Component, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { environment } from '../../environments/environment';
import { AuthSessionService } from '../core/auth-session.service';
import { grantsAllow, staticGrantsForRole } from '../core/permission.guard';
import { routePermissionForPath } from '../core/access-rules';
import { ApiRecord, ApiService } from '../core/api.service';
import { AppStateService } from '../core/state/app-state.service';
import { StateComponent } from '../shared/ui/state/state.component';
import { AuraMoneyPipe } from '../shared/pipes/aura-money.pipe';

type StaffTab = 'overview' | 'roles' | 'services' | 'slabs' | 'roster' | 'payroll' | 'kyc' | 'reviews' | 'approvals' | 'optimizer';
type RosterView = 'day' | 'week' | 'month';

@Component({
  selector: 'app-staff-profile',
  standalone: true,
  imports: [AuraMoneyPipe, CommonModule, FormsModule, RouterLink, StateComponent],
  template: `
    <section class="page-stack">
      <div class="profile-command-bar">
        <a class="ghost-button fit" routerLink="/staff-os/staff-list">Back to staff</a>
        <div class="command-actions" *ngIf="staff() as staff">
          <button class="ghost-button" type="button" routerLink="/appointments">Open calendar</button>
          <button class="ghost-button" type="button" routerLink="/pos" *ngIf="canAccessPath('/pos')">Open POS</button>
          <button class="ghost-button" type="button" (click)="createNotification('shift_reminder')" [disabled]="saving()">Draft reminder</button>
          <button class="primary-button" type="button" (click)="load()">Refresh profile</button>
        </div>
      </div>

      <app-state [loading]="loading()" [error]="error()"></app-state>

      <ng-container *ngIf="profile() as profile">
        <section class="enterprise-profile-header">
          <div class="profile-identity">
            <span class="avatar large">{{ initials(profile.staff.name) }}</span>
            <div>
              <h2>{{ profile.staff.name }}</h2>
              <p>{{ profile.staff.designation || profile.staff.role }} · {{ profile.staff.department || 'Service' }} · {{ branchName(profile.staff.branchId) }}</p>
              <div class="chip-row">
                <span class="badge">{{ profile.staff.status || 'active' }}</span>
                <span class="badge">{{ profile.staff.joiningDate || 'joining date not set' }}</span>
                <span class="badge">{{ asArray(profile.staff.assignedServices).length }} service(s)</span>
                <span class="badge" [class.warning]="profile.optimizer?.burnoutRisk === 'medium'" [class.danger]="profile.optimizer?.burnoutRisk === 'high'">Burnout {{ profile.optimizer?.burnoutRisk }}</span>
              </div>
            </div>
          </div>
          <div class="score-orbit">
            <div><strong>{{ profile.metrics.productivityScore || 0 }}</strong><span>Productivity</span></div>
            <div><strong>{{ profile.metrics.utilization || 0 }}%</strong><span>Utilization</span></div>
            <div><strong>{{ profile.metrics.averageRating || 0 }}</strong><span>Rating</span></div>
          </div>
          <aside class="zenoti-action-rail">
            <button class="ghost-button" type="button" (click)="cloneStaffProfile()" [disabled]="saving()">Clone</button>
            <button class="ghost-button" type="button" disabled title="Password actions require a linked auth user">Update password</button>
            <button class="ghost-button" type="button" disabled title="Password actions require a linked auth user">Reset password</button>
            <button class="ghost-button danger-action" type="button" (click)="terminateStaff()" [disabled]="saving() || profile.staff.status === 'inactive'">Terminate</button>
            <a class="ghost-button fit" routerLink="/staff-os/staff-list">Back to search</a>
          </aside>
        </section>

        <div class="metrics-grid">
          <article class="metric-card teal"><span>Revenue</span><strong>{{ profile.metrics.revenue | auraMoney:'1.0-0' }}</strong><small>{{ profile.metrics.bookings }} booking(s)</small></article>
          <article class="metric-card green"><span>Completed</span><strong>{{ profile.metrics.completed }}</strong><small>{{ profile.metrics.cancelled }} cancelled</small></article>
          <article class="metric-card amber"><span>Attendance</span><strong>{{ profile.metrics.attendanceScore || 0 }}%</strong><small>{{ profile.attendance.length }} record(s)</small></article>
          <article class="metric-card violet"><span>Payroll net</span><strong>{{ profile.metrics.payrollNet | auraMoney:'1.0-0' }}</strong><small>{{ profile.payrollComponents.length }} payroll row(s)</small></article>
          <article class="metric-card blue"><span>Skill matrix</span><strong>{{ profile.skills.length }}</strong><small>{{ eligibleServiceCount(profile) }} eligible service(s)</small></article>
          <article class="metric-card red"><span>Conflicts</span><strong>{{ profile.conflicts.length }}</strong></article>
        </div>

        <section class="panel">
          <div class="segmented tabs">
            <button type="button" *ngFor="let item of tabs" [class.active]="tab() === item.key" (click)="tab.set(item.key)">{{ item.label }}</button>
          </div>
        </section>

        <section class="panel" *ngIf="tab() === 'overview'">
          <div class="section-title"><div><h2>Personal info, permissions and service assignment</h2></div></div>
          <div class="employee-profile-grid">
            <article><span>Employee code</span><strong>{{ profile.staff.employeeCode || profile.staff.id }}</strong><small>{{ profile.staff.messageName || profile.staff.name }} in appointment messages</small></article>
            <article><span>Contact</span><strong>{{ profile.staff.phone || 'No phone' }}</strong><small>{{ profile.staff.email || 'No email' }}</small></article>
            <article><span>Branches</span><strong>{{ branchNames(profile.staff) }}</strong></article>
            <article><span>Permissions</span><strong>{{ asArray(profile.staff.permissions).length }}</strong><small>{{ asArray(profile.staff.permissions).join(', ') || 'Role defaults' }}</small></article>
            <article><span>Break / offs</span><strong>{{ breakLabel(profile.staff) }}</strong><small>{{ asArray(profile.staff.weeklyOffs).join(', ') || 'Weekly off not set' }}</small></article>
          </div>
          <div class="activity-list compact-list">
            <article *ngFor="let service of assignedServices(profile.staff)">
              <strong>{{ service.name }}</strong>
              <span>{{ service.category }} · {{ service.durationMinutes }} min · {{ service.price | auraMoney:'1.0-0' }}</span>
            </article>
            <article *ngIf="!assignedServices(profile.staff).length"><strong>No service restriction</strong><span>Staff can be considered for any active service unless skill matrix restricts it.</span></article>
          </div>
        </section>

        <section class="panel" *ngIf="tab() === 'roles'">
          <div class="section-title">
            <div><h2>Map employee to branch, center and role</h2></div>
            <button class="primary-button" type="button" (click)="addEmployeeRole()" [disabled]="saving()">Add role</button>
          </div>
          <section class="form-panel compact-form">
            <label class="field"><span>View</span><select [(ngModel)]="roleDraft.viewType"><option value="Center">Center</option><option value="Organization">Organization</option></select></label>
            <label class="field"><span>Center / branch</span><select [(ngModel)]="roleDraft.branchId"><option value="">Select branch</option><option *ngFor="let branch of branches()" [value]="branch.id">{{ branch.name }}</option></select></label>
            <label class="field"><span>Role</span><input [(ngModel)]="roleDraft.role" placeholder="Manager, Therapist, Accountant" /></label>
          </section>
          <div class="table-wrap">
            <table>
              <thead><tr><th>View</th><th>Type</th><th>Role</th><th></th></tr></thead>
              <tbody>
                <tr *ngFor="let row of roleRows(profile.staff); let i = index">
                  <td>{{ branchName(row.branchId) || row.view || 'All centers' }}</td>
                  <td>{{ row.viewType || row.type || 'Center' }}</td>
                  <td>{{ row.role }}</td>
                  <td><button class="ghost-button mini" type="button" (click)="removeEmployeeRole(i)" [disabled]="saving()">Delete</button></td>
                </tr>
                <tr *ngIf="!roleRows(profile.staff).length"><td colspan="4">No custom role mapping saved yet.</td></tr>
              </tbody>
            </table>
          </div>
        </section>

        <section class="panel" *ngIf="tab() === 'services'">
          <div class="section-title">
            <div><h2>Per-employee service assignment, pricing and online booking</h2></div>
            <button class="primary-button" type="button" (click)="saveServiceMatrix()" [disabled]="saving()">Save service matrix</button>
          </div>
          <div class="table-wrap service-matrix-wrap">
            <table>
              <thead>
                <tr>
                  <th>Service</th><th>Shop cost</th><th>Labour cost</th><th>Commission %</th><th>Price scale %</th><th>Service time</th><th>Deductions</th><th>Assigned</th><th>Online</th>
                </tr>
              </thead>
              <tbody>
                <tr *ngFor="let service of services()">
                  <td><strong>{{ service.name }}</strong><small>{{ service.category }} · base {{ service.durationMinutes }} min · {{ service.price | auraMoney:'1.0-0' }}</small></td>
                  <td><input class="matrix-input" type="number" [ngModel]="serviceOverrideValue(service.id, 'shopCost')" (ngModelChange)="setServiceOverride(service.id, 'shopCost', $event)" /></td>
                  <td><input class="matrix-input" type="number" [ngModel]="serviceOverrideValue(service.id, 'labourCost')" (ngModelChange)="setServiceOverride(service.id, 'labourCost', $event)" /></td>
                  <td><input class="matrix-input" type="number" [ngModel]="serviceOverrideValue(service.id, 'commission')" (ngModelChange)="setServiceOverride(service.id, 'commission', $event)" /></td>
                  <td><input class="matrix-input" type="number" [ngModel]="serviceOverrideValue(service.id, 'priceScalingFactor')" (ngModelChange)="setServiceOverride(service.id, 'priceScalingFactor', $event)" /></td>
                  <td><input class="matrix-input" type="number" [ngModel]="serviceOverrideValue(service.id, 'serviceTime')" (ngModelChange)="setServiceOverride(service.id, 'serviceTime', $event)" /></td>
                  <td><input class="matrix-input" type="number" [ngModel]="serviceOverrideValue(service.id, 'commissionDeductions')" (ngModelChange)="setServiceOverride(service.id, 'commissionDeductions', $event)" /></td>
                  <td><input type="checkbox" [checked]="serviceOverrideChecked(service.id, 'serviceAssignment')" (change)="setServiceOverride(service.id, 'serviceAssignment', $any($event.target).checked)" /></td>
                  <td><input type="checkbox" [checked]="serviceOverrideChecked(service.id, 'availableOnline')" (change)="setServiceOverride(service.id, 'availableOnline', $any($event.target).checked)" /></td>
                </tr>
                <tr *ngIf="!services().length"><td colspan="9">No services found.</td></tr>
              </tbody>
            </table>
          </div>
        </section>

        <section class="panel" *ngIf="tab() === 'slabs'">
          <div class="section-title">
            <div><h2>Scaling factors, slabs and historical-safe payout rules</h2></div>
            <button class="primary-button" type="button" (click)="saveCommissionSettings()" [disabled]="saving()">Save settings</button>
          </div>
          <section class="form-panel compact-form">
            <label class="field"><span>Default commission scale %</span><input type="number" [(ngModel)]="commissionSettings.defaultScalingFactor" /></label>
            <label class="field"><span>Booking commission scale %</span><input type="number" [(ngModel)]="commissionSettings.bookingScalingFactor" /></label>
            <label class="field"><span>Slab mode</span><select [(ngModel)]="commissionSettings.slabMode"><option value="cumulative">Cumulative commission level</option><option value="highest">Highest qualified commission</option></select></label>
            <label class="field"><span>Past periods</span><select [(ngModel)]="commissionSettings.pastPeriodMode"><option value="period_active">Use slabs active in pay period</option><option value="current_active">Use current active slabs</option></select></label>
          </section>
          <section class="form-panel compact-form">
            <h3>Add revenue slab</h3>
            <label class="field"><span>From revenue</span><input type="number" [(ngModel)]="slabDraft.fromRevenue" /></label>
            <label class="field"><span>To revenue</span><input type="number" [(ngModel)]="slabDraft.toRevenue" /></label>
            <label class="field"><span>Commission %</span><input type="number" [(ngModel)]="slabDraft.commissionPercent" /></label>
            <button class="ghost-button" type="button" (click)="addCommissionSlab()" [disabled]="saving()">Add slab</button>
          </section>
          <div class="table-wrap">
            <table>
              <thead><tr><th>Revenue range</th><th>Commission</th><th>Mode</th><th></th></tr></thead>
              <tbody>
                <tr *ngFor="let slab of commissionSlabs(); let i = index">
                  <td>{{ slab.fromRevenue | auraMoney:'1.0-0' }} - {{ slab.toRevenue | auraMoney:'1.0-0' }}</td>
                  <td>{{ slab.commissionPercent }}%</td>
                  <td>{{ commissionSettings.slabMode }}</td>
                  <td><button class="ghost-button mini" type="button" (click)="removeCommissionSlab(i)" [disabled]="saving()">Delete</button></td>
                </tr>
                <tr *ngIf="!commissionSlabs().length"><td colspan="4">No commission slabs saved yet.</td></tr>
              </tbody>
            </table>
          </div>
        </section>

        <section class="panel" *ngIf="tab() === 'roster'">
          <div class="section-title">
            <div><h2>Shift calendar, leave workflow and conflicts</h2></div>
            <div class="segmented compact-tabs">
              <button type="button" [class.active]="rosterView() === 'day'" (click)="rosterView.set('day')">Day</button>
              <button type="button" [class.active]="rosterView() === 'week'" (click)="rosterView.set('week')">Week</button>
              <button type="button" [class.active]="rosterView() === 'month'" (click)="rosterView.set('month')">Month</button>
            </div>
          </div>
          <div class="roster-board">
            <article class="roster-day" *ngFor="let day of rosterDays(profile)" (dragover)="$event.preventDefault()" (drop)="dropShift(day.date)">
              <strong>{{ day.label }}</strong>
              <small>{{ day.date }}</small>
              <button class="ghost-button mini" type="button" (click)="quickPlanShift(day.date)" [disabled]="saving()">+ Shift</button>
              <div class="shift-pill"
                   *ngFor="let shift of day.shifts"
                   draggable="true"
                   (dragstart)="dragShiftId.set(shift.id)"
                   [class.warning]="conflictFor(profile, shift.id)">
                <b>{{ shift.startTime }} - {{ shift.endTime }}</b>
                <span>{{ branchName(shift.branchId) }}</span>
                <small>{{ conflictFor(profile, shift.id) || 'Drag to another day' }}</small>
              </div>
              <span class="empty-drop" *ngIf="!day.shifts.length">Drop shift here</span>
            </article>
          </div>
          <div class="dashboard-grid">
            <section class="form-panel compact-form">
              <h3>Create leave request</h3>
              <label class="field"><span>Leave type</span><select [(ngModel)]="leaveDraft.leaveType"><option>paid</option><option>casual</option><option>sick</option></select></label>
              <label class="field"><span>Start</span><input type="date" [(ngModel)]="leaveDraft.startDate" /></label>
              <label class="field"><span>End</span><input type="date" [(ngModel)]="leaveDraft.endDate" /></label>
              <label class="field full"><span>Reason</span><textarea [(ngModel)]="leaveDraft.reason"></textarea></label>
              <button class="primary-button" type="button" (click)="saveLeave()" [disabled]="saving()">Apply leave</button>
            </section>
            <section>
              <h3>Conflicts</h3>
              <div class="activity-list compact-list">
                <article *ngFor="let conflict of profile.conflicts"><strong>{{ conflict.type }}</strong><span>{{ conflict.message }}</span></article>
                <article *ngIf="!profile.conflicts.length"><strong>No roster conflicts</strong><span>Weekly off, leave and overlap checks are clean.</span></article>
              </div>
            </section>
            <section class="form-panel compact-form">
              <h3>Biometric device punch</h3>
              <label class="field"><span>Employee code</span><input [(ngModel)]="biometricDraft.employeeCode" /></label>
              <label class="field"><span>Device ID</span><input [(ngModel)]="biometricDraft.deviceId" /></label>
              <label class="field"><span>Event</span><select [(ngModel)]="biometricDraft.eventType"><option value="clock_in">Clock in</option><option value="clock_out">Clock out</option></select></label>
              <label class="field"><span>Event time</span><input type="datetime-local" [(ngModel)]="biometricDraft.eventAt" /></label>
              <button class="primary-button" type="button" (click)="recordBiometric()" [disabled]="saving()">Record punch</button>
            </section>
          </div>
          <div class="table-wrap">
            <table>
              <thead><tr><th>Date</th><th>Shift</th><th>Branch</th><th>Status</th></tr></thead>
              <tbody>
                <tr *ngFor="let shift of profile.shifts"><td>{{ shift.date }}</td><td>{{ shift.startTime }} - {{ shift.endTime }}</td><td>{{ branchName(shift.branchId) }}</td><td>{{ shift.status }}</td></tr>
                <tr *ngIf="!profile.shifts.length"><td colspan="4">No shifts planned yet.</td></tr>
              </tbody>
            </table>
          </div>
          <div class="table-wrap">
            <table>
              <thead><tr><th>Leave</th><th>Dates</th><th>Days</th><th>Status</th><th></th></tr></thead>
              <tbody>
                <tr *ngFor="let leave of profile.leaveRequests">
                  <td>{{ leave.leaveType }}</td>
                  <td>{{ leave.startDate }} - {{ leave.endDate }}</td>
                  <td>{{ leave.days }}</td>
                  <td><span class="badge" [class.warning]="leave.status === 'pending'" [class.danger]="leave.status === 'rejected'">{{ leave.status }}</span></td>
                  <td>
                    <button class="ghost-button mini" type="button" (click)="decideLeave(leave, 'approved')" [disabled]="!canApprove() || leave.status !== 'pending'" [title]="canApprove() ? 'Approve leave' : 'Manager approval is required'">Approve</button>
                    <button class="ghost-button mini" type="button" (click)="decideLeave(leave, 'rejected')" [disabled]="!canApprove() || leave.status !== 'pending'" [title]="canApprove() ? 'Reject leave' : 'Manager approval is required'">Reject</button>
                  </td>
                </tr>
                <tr *ngIf="!profile.leaveRequests.length"><td colspan="5">No leave requests yet.</td></tr>
              </tbody>
            </table>
          </div>
        </section>

        <section class="panel" *ngIf="tab() === 'payroll'">
          <div class="section-title"><div><h2>Salary components, deductions, approval and rules</h2></div></div>
          <div class="dashboard-grid">
            <section class="form-panel compact-form">
              <h3>Payroll component</h3>
              <label class="field"><span>Basic</span><input type="number" [(ngModel)]="payrollDraft.basic" /></label>
              <label class="field"><span>HRA</span><input type="number" [(ngModel)]="payrollDraft.hra" /></label>
              <label class="field"><span>Allowances</span><input type="number" [(ngModel)]="payrollDraft.allowances" /></label>
              <label class="field"><span>Deductions</span><input type="number" [(ngModel)]="payrollDraft.deductions" /></label>
              <label class="field"><span>PF</span><input type="number" [(ngModel)]="payrollDraft.pf" /></label>
              <label class="field"><span>ESI</span><input type="number" [(ngModel)]="payrollDraft.esi" /></label>
              <label class="field"><span>TDS</span><input type="number" [(ngModel)]="payrollDraft.tds" /></label>
              <label class="field"><span>PT</span><input type="number" [(ngModel)]="payrollDraft.pt" /></label>
              <button class="primary-button" type="button" (click)="savePayroll()" [disabled]="saving()">Save payroll</button>
            </section>
            <section class="form-panel compact-form">
              <h3>Advanced commission rule</h3>
              <label class="field full"><span>Name</span><input [(ngModel)]="commissionDraft.name" /></label>
              <label class="field"><span>Service %</span><input type="number" [(ngModel)]="commissionDraft.servicePercent" /></label>
              <label class="field"><span>Product %</span><input type="number" [(ngModel)]="commissionDraft.productPercent" /></label>
              <label class="field"><span>Membership %</span><input type="number" [(ngModel)]="commissionDraft.membershipPercent" /></label>
              <label class="field"><span>Package %</span><input type="number" [(ngModel)]="commissionDraft.packagePercent" /></label>
              <label class="field"><span>Flat amount</span><input type="number" [(ngModel)]="commissionDraft.flatAmount" /></label>
              <label class="field"><span>Target bonus</span><input type="number" [(ngModel)]="commissionDraft.targetBonus" /></label>
              <button class="primary-button" type="button" (click)="saveCommissionRule()" [disabled]="saving()">Save rule</button>
            </section>
          </div>
          <div class="table-wrap">
            <table>
              <thead><tr><th>Type</th><th>Gross/Rule</th><th>Net/Bonus</th><th>Status</th><th></th></tr></thead>
              <tbody>
                <tr *ngFor="let row of profile.payrollComponents"><td>Payroll</td><td>{{ row.grossPay | auraMoney:'1.0-0' }}</td><td>{{ row.netPay | auraMoney:'1.0-0' }}</td><td>{{ row.status }}</td><td><button class="ghost-button mini" type="button" (click)="openPayslip(row)">Payslip PDF</button></td></tr>
                <tr *ngFor="let row of profile.commissionRules"><td>Commission</td><td>{{ row.name }}</td><td>{{ row.targetBonus | auraMoney:'1.0-0' }}</td><td>{{ row.status }}</td><td></td></tr>
                <tr *ngIf="!profile.payrollComponents.length && !profile.commissionRules.length"><td colspan="5">No payroll or commission rules saved yet.</td></tr>
              </tbody>
            </table>
          </div>
        </section>

        <section class="panel" *ngIf="tab() === 'kyc'">
          <div class="section-title"><div><h2>Documents, certificates and service eligibility</h2></div></div>
          <div class="dashboard-grid">
            <section class="form-panel compact-form">
              <h3>Add document metadata</h3>
              <label class="field"><span>Type</span><select [(ngModel)]="documentDraft.documentType"><option>Aadhaar</option><option>PAN</option><option>Address proof</option><option>Certificate</option><option>Contract</option><option>Joining letter</option></select></label>
              <label class="field"><span>Number</span><input [(ngModel)]="documentDraft.documentNumber" /></label>
              <label class="field"><span>Status</span><select [(ngModel)]="documentDraft.status"><option>missing</option><option>pending</option><option>verified</option><option>expired</option></select></label>
              <label class="field"><span>Expires</span><input type="date" [(ngModel)]="documentDraft.expiresAt" /></label>
              <button class="primary-button" type="button" (click)="saveDocument()" [disabled]="saving()">Save document</button>
            </section>
            <section class="form-panel compact-form">
              <h3>Add skill</h3>
              <label class="field"><span>Skill</span><input [(ngModel)]="skillDraft.skillName" /></label>
              <label class="field"><span>Level</span><select [(ngModel)]="skillDraft.level"><option>beginner</option><option>intermediate</option><option>expert</option><option>master</option></select></label>
              <label class="field"><span>Certificate</span><select [(ngModel)]="skillDraft.certificationStatus"><option>pending</option><option>certified</option><option>expired</option></select></label>
              <label class="field full"><span>Eligible services</span><input [(ngModel)]="skillServicesText" placeholder="service ids comma separated" /></label>
              <button class="primary-button" type="button" (click)="saveSkill()" [disabled]="saving()">Save skill</button>
            </section>
          </div>
          <div class="activity-list compact-list">
            <article *ngFor="let doc of profile.documents">
              <strong>{{ doc.documentType }} · {{ doc.status }}</strong>
              <span>{{ doc.documentNumber || 'No number' }} · expires {{ doc.expiresAt || 'not set' }}</span>
              <small>{{ documentFileLabel(doc) }}</small>
              <input type="file" (change)="uploadDocument(doc, $event)" [disabled]="uploadingDocId() === doc.id" />
              <button class="ghost-button mini" type="button" (click)="openDocument(doc)" [disabled]="!documentHasFile(doc)">Open file</button>
            </article>
            <article *ngFor="let skill of profile.skills"><strong>{{ skill.skillName }} · {{ skill.level }}</strong><span>{{ skill.certificationStatus }} · {{ serviceNames(skill.serviceIds) }}</span></article>
          </div>
        </section>

        <section class="panel" *ngIf="tab() === 'reviews'">
          <div class="section-title"><div><h2>Rating, complaints, rebooking and punctuality</h2></div></div>
          <section class="form-panel compact-form">
            <h3>Add review / feedback</h3>
            <label class="field"><span>Rating</span><input type="number" min="1" max="5" [(ngModel)]="reviewDraft.rating" /></label>
            <label class="field full"><span>Feedback</span><textarea [(ngModel)]="reviewDraft.feedback"></textarea></label>
            <label class="field checkbox-line"><input type="checkbox" [(ngModel)]="reviewDraft.complaintFlag" /><span>Complaint</span></label>
            <label class="field checkbox-line"><input type="checkbox" [(ngModel)]="reviewDraft.rebookingFlag" /><span>Client rebooked</span></label>
            <button class="primary-button" type="button" (click)="saveReview()" [disabled]="saving()">Save review</button>
          </section>
          <div class="activity-list compact-list">
            <article *ngFor="let row of profile.reviews"><strong>{{ row.rating }}/5 · {{ row.complaintFlag ? 'Complaint' : 'Feedback' }}</strong><span>{{ row.feedback || 'No feedback text' }}</span></article>
            <article *ngIf="!profile.reviews.length"><strong>No staff reviews yet</strong><span>Ratings and client feedback will appear here.</span></article>
          </div>
        </section>

        <section class="panel" *ngIf="tab() === 'approvals'">
          <div class="section-title"><div><h2>Manager approvals and branch transfer history</h2></div></div>
          <section class="form-panel compact-form">
            <h3>Create branch transfer</h3>
            <label class="field"><span>To branch</span><select [(ngModel)]="transferDraft.toBranchId"><option value="">Select branch</option><option *ngFor="let branch of branches()" [value]="branch.id">{{ branch.name }}</option></select></label>
            <label class="field"><span>Effective date</span><input type="date" [(ngModel)]="transferDraft.effectiveDate" /></label>
            <label class="field full"><span>Reason</span><textarea [(ngModel)]="transferDraft.reason"></textarea></label>
            <button class="primary-button" type="button" (click)="createTransfer()" [disabled]="saving() || !transferDraft.toBranchId">Create transfer</button>
          </section>
          <div class="table-wrap">
            <table>
              <thead><tr><th>Request</th><th>Reference</th><th>Status</th><th>Action</th></tr></thead>
              <tbody>
                <tr *ngFor="let approval of profile.approvals">
                  <td>{{ approval.requestType }}</td><td>{{ approval.referenceId }}</td><td>{{ approval.status }}</td>
                  <td>
                    <button class="ghost-button mini" type="button" (click)="decideApproval(approval, 'approved')" [disabled]="!canApprove() || approval.status !== 'pending'">Approve</button>
                    <button class="ghost-button mini" type="button" (click)="decideApproval(approval, 'rejected')" [disabled]="!canApprove() || approval.status !== 'pending'">Reject</button>
                  </td>
                </tr>
                <tr *ngFor="let transfer of profile.transfers">
                  <td>Branch transfer</td><td>{{ branchName(transfer.fromBranchId) }} → {{ branchName(transfer.toBranchId) }}</td><td>{{ transfer.status }}</td>
                  <td><button class="ghost-button mini" type="button" (click)="approveTransfer(transfer)" [disabled]="!canApprove() || transfer.status !== 'pending'">Approve transfer</button></td>
                </tr>
                <tr *ngIf="!profile.approvals.length && !profile.transfers.length"><td colspan="4">No approvals or transfers yet.</td></tr>
              </tbody>
            </table>
          </div>
        </section>

        <section class="panel" *ngIf="tab() === 'optimizer'">
          <div class="section-title"><div><h2>Best staff, burnout, recovery and workload plan</h2></div></div>
          <div class="quick-grid">
            <article class="action-card"><strong>Best for booking</strong><span>{{ profile.optimizer.bestForBooking }}</span></article>
            <article class="action-card"><strong>Burnout risk</strong><span>{{ profile.optimizer.burnoutRisk }}</span><small>{{ profile.optimizer.workloadBalance }}</small></article>
            <article class="action-card"><strong>Absent recovery</strong><span>{{ profile.optimizer.absentRecoveryPlan }}</span></article>
            <article class="action-card"><strong>Target recovery</strong><span>{{ profile.optimizer.targetRecovery | auraMoney:'1.0-0' }}</span></article>
            <article class="action-card" *ngFor="let item of profile.optimizer.suggestions"><strong>Recommendation</strong><span>{{ item }}</span></article>
          </div>
          <div class="activity-list compact-list">
            <article *ngFor="let draft of profile.notifications.slice(0, 6)">
              <strong>{{ draft.type }} · {{ draft.status }}</strong>
              <span>{{ draft.body }}</span>
              <button class="ghost-button mini" type="button" (click)="copyNotification(draft)">Copy</button>
              <button class="ghost-button mini" type="button" (click)="sendWhatsapp(draft)" [disabled]="!profile.staff.phone || saving()" [title]="profile.staff.phone ? 'Send using configured WhatsApp provider' : 'Staff phone is required'">Send WhatsApp</button>
            </article>
          </div>
          <p class="muted-line" *ngIf="copied()">{{ copied() }}</p>
        </section>
      </ng-container>
    </section>
  `,
  styles: [`
    .profile-command-bar,
    .command-actions,
    .profile-identity,
    .score-orbit {
      display: flex;
      align-items: center;
      gap: 10px;
      flex-wrap: wrap;
    }

    .profile-command-bar {
      justify-content: space-between;
    }

    .enterprise-profile-header {
      display: flex;
      justify-content: space-between;
      gap: 18px;
      padding: 22px;
      border: 1px solid rgba(15, 23, 42, 0.08);
      border-radius: 10px;
      background: linear-gradient(135deg, rgba(255,255,255,0.96), rgba(245,238,242,0.82));
      box-shadow: 0 18px 45px rgba(15, 23, 42, 0.08);
    }

    .score-orbit > div,
    .employee-profile-grid > article {
      min-width: 130px;
      border: 1px solid rgba(15, 23, 42, 0.08);
      border-radius: 8px;
      padding: 12px;
      background: rgba(255,255,255,0.84);
    }

    .score-orbit strong {
      display: block;
      font-size: 26px;
    }

    .zenoti-action-rail {
      display: grid;
      gap: 8px;
      min-width: 170px;
      align-self: stretch;
      position: sticky;
      top: 12px;
    }

    .danger-action {
      border-color: rgba(220, 38, 38, 0.32);
      color: #b91c1c;
    }

    .info-strip {
      margin: 0 0 12px;
      padding: 10px 12px;
      border: 1px solid rgba(14, 116, 144, 0.18);
      border-radius: 8px;
      background: rgba(240, 249, 255, 0.84);
      color: #8B5E7C;
    }

    .service-matrix-wrap {
      max-height: 560px;
      overflow: auto;
    }

    .service-matrix-wrap th {
      position: sticky;
      top: 0;
      background: #fff;
      z-index: 1;
    }

    .matrix-input {
      width: 86px;
      min-width: 74px;
      padding: 7px 8px;
    }

    .tabs {
      justify-content: flex-start;
      flex-wrap: wrap;
    }

    .compact-tabs {
      width: auto;
    }

    .roster-board {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
      gap: 10px;
      margin-bottom: 16px;
    }

    .roster-day {
      min-height: 150px;
      border: 1px dashed rgba(15, 23, 42, 0.16);
      border-radius: 8px;
      padding: 10px;
      background: rgba(255,255,255,0.72);
    }

    .roster-day strong,
    .roster-day small {
      display: block;
    }

    .shift-pill {
      margin-top: 8px;
      padding: 8px;
      border-radius: 8px;
      border: 1px solid rgba(214, 79, 146, 0.28);
      background: rgba(214, 79, 146, 0.11);
      cursor: grab;
    }

    .shift-pill.warning {
      border-color: rgba(245, 158, 11, 0.42);
      background: rgba(245, 158, 11, 0.12);
    }

    .empty-drop {
      display: block;
      margin-top: 12px;
      color: var(--muted);
      font-size: 13px;
    }

    .employee-profile-grid {
      display: grid;
      grid-template-columns: repeat(4, minmax(160px, 1fr));
      gap: 12px;
      margin-bottom: 14px;
    }

    .compact-form {
      margin-bottom: 14px;
    }

    .compact-list article {
      align-items: flex-start;
    }

    .checkbox-line {
      flex-direction: row;
      align-items: center;
      gap: 8px;
    }

    .checkbox-line input {
      width: auto;
    }

    .muted-line {
      color: var(--muted);
      margin: 10px 0 0;
    }

    @media (max-width: 980px) {
      .enterprise-profile-header {
        display: grid;
      }

      .employee-profile-grid {
        grid-template-columns: 1fr;
      }
    }
  `]
})
export class StaffProfileComponent implements OnInit {
  readonly profile = signal<ApiRecord | null>(null);
  readonly branches = signal<ApiRecord[]>([]);
  readonly services = signal<ApiRecord[]>([]);
  readonly loading = signal(true);
  readonly saving = signal(false);
  readonly error = signal('');
  readonly copied = signal('');
  readonly tab = signal<StaffTab>('overview');
  readonly rosterView = signal<RosterView>('week');
  readonly dragShiftId = signal('');
  readonly uploadingDocId = signal('');
  readonly serviceOverrides = signal<ApiRecord[]>([]);
  readonly commissionSlabRows = signal<ApiRecord[]>([]);
  readonly tabs: { key: StaffTab; label: string }[] = [
    { key: 'overview', label: 'Overview' },
    { key: 'roles', label: 'Roles + centers' },
    { key: 'services', label: 'Services' },
    { key: 'slabs', label: 'Commission slabs' },
    { key: 'roster', label: 'Roster + leave' },
    { key: 'payroll', label: 'Payroll + commission' },
    { key: 'kyc', label: 'KYC + skills' },
    { key: 'reviews', label: 'Reviews' },
    { key: 'approvals', label: 'Approvals' },
    { key: 'optimizer', label: 'Optimizer' }
  ];

  leaveDraft: ApiRecord = {};
  payrollDraft: ApiRecord = {};
  commissionDraft: ApiRecord = {};
  documentDraft: ApiRecord = {};
  skillDraft: ApiRecord = {};
  reviewDraft: ApiRecord = {};
  transferDraft: ApiRecord = {};
  biometricDraft: ApiRecord = {};
  roleDraft: ApiRecord = {};
  slabDraft: ApiRecord = {};
  commissionSettings: ApiRecord = {};
  skillServicesText = '';

  constructor(
    private readonly api: ApiService,
    private readonly route: ActivatedRoute,
    private readonly appState: AppStateService,
    private readonly session: AuthSessionService
  ) {}

  canAccessPath(path: string): boolean {
    const permission = routePermissionForPath(path);
    if (!permission || (Array.isArray(permission) && !permission.length)) return true;
    const permissions = Array.isArray(permission) ? permission : [permission];
    const dynamicGrants = this.session.currentUser()?.permissions || [];
    const grants = Array.from(new Set([...staticGrantsForRole(this.appState.userRole()), ...dynamicGrants]));
    return permissions.some((item) => grantsAllow(grants, item));
  }

  ngOnInit(): void {
    this.resetDrafts();
    this.load();
  }

  staff(): ApiRecord | null {
    return this.profile()?.staff || null;
  }

  load(): void {
    this.loading.set(true);
    this.error.set('');
    const id = this.route.snapshot.paramMap.get('id') || '';
    Promise.all([
      this.api.get<ApiRecord>('staff-management/profile', id).toPromise(),
      this.api.list<ApiRecord[]>('branches').toPromise(),
      this.api.list<ApiRecord[]>('services').toPromise()
    ]).then(([profile, branches, services]) => {
      this.profile.set(profile || null);
      this.branches.set(Array.isArray(branches) ? branches : []);
      this.services.set(Array.isArray(services) ? services : []);
      this.syncConfigurationDrafts(profile || null);
      this.resetDrafts();
      this.loading.set(false);
    }).catch((error) => {
      this.error.set(error?.error?.error || 'Unable to load staff profile');
      this.loading.set(false);
    });
  }

  saveLeave(): void {
    const staff = this.staff();
    if (!staff) return;
    this.save('staff-management/leave', { ...this.leaveDraft, staffId: staff.id, branchId: staff.branchId });
  }

  decideLeave(row: ApiRecord, decision: string): void {
    this.save(`staff-management/leave/${row.id}/${decision}`, { reason: `${decision} from staff profile` }, false);
  }

  savePayroll(): void {
    const staff = this.staff();
    if (!staff) return;
    this.save('staff-management/payroll-components', { ...this.payrollDraft, staffId: staff.id, branchId: staff.branchId });
  }

  saveCommissionRule(): void {
    const staff = this.staff();
    if (!staff) return;
    this.save('staff-management/commission-rules', { ...this.commissionDraft, staffId: staff.id, branchId: staff.branchId });
  }

  saveDocument(): void {
    const staff = this.staff();
    if (!staff) return;
    this.save('staff-management/documents', { ...this.documentDraft, staffId: staff.id, branchId: staff.branchId });
  }

  saveSkill(): void {
    const staff = this.staff();
    if (!staff) return;
    this.save('staff-management/skills', { ...this.skillDraft, serviceIds: this.csvList(this.skillServicesText), staffId: staff.id, branchId: staff.branchId });
  }

  saveReview(): void {
    const staff = this.staff();
    if (!staff) return;
    this.save('staff-management/reviews', { ...this.reviewDraft, staffId: staff.id, branchId: staff.branchId });
  }

  createNotification(type: string): void {
    const staff = this.staff();
    if (!staff) return;
    this.save('staff-management/notifications/draft', { staffId: staff.id, branchId: staff.branchId, type }, true, true);
  }

  copyNotification(row: ApiRecord): void {
    navigator.clipboard?.writeText(row.body || '').then(() => {
      this.api.post(`staff-management/notifications/${row.id}/copied`, {}).subscribe({ next: () => this.load() });
      this.copied.set('Notification draft copied');
      setTimeout(() => this.copied.set(''), 1500);
    }).catch(() => this.error.set('Unable to copy notification draft'));
  }

  createTransfer(): void {
    const staff = this.staff();
    if (!staff) return;
    this.save('staff-management/transfers', { ...this.transferDraft, staffId: staff.id, fromBranchId: staff.branchId });
  }

  approveTransfer(row: ApiRecord): void {
    this.save(`staff-management/transfers/${row.id}/approve`, { reason: 'Approved from staff profile' }, false);
  }

  decideApproval(row: ApiRecord, decision: string): void {
    this.save(`staff-management/approvals/${row.id}/${decision}`, { reason: `${decision} from staff profile` }, false);
  }

  quickPlanShift(date: string): void {
    const staff = this.staff();
    if (!staff) return;
    this.save('staff-management/shifts', {
      staffId: staff.id,
      branchId: staff.branchId,
      date,
      startTime: '10:00',
      endTime: '19:00',
      role: staff.role,
      status: 'planned'
    }, false);
  }

  dropShift(date: string): void {
    const id = this.dragShiftId();
    const profile = this.profile();
    if (!id || !profile) return;
    const shift = this.asArray(profile.shifts).find((row) => row.id === id);
    this.dragShiftId.set('');
    if (!shift || shift.date === date) return;
    this.save(`staff-management/shifts/${id}/move`, {
      date,
      startTime: shift.startTime,
      endTime: shift.endTime,
      branchId: shift.branchId,
      status: shift.status
    }, false);
  }

  recordBiometric(): void {
    const staff = this.staff();
    if (!staff) return;
    const eventAt = this.biometricDraft.eventAt
      ? new Date(this.biometricDraft.eventAt).toISOString()
      : new Date().toISOString();
    this.save('staff-management/biometric-events', {
      ...this.biometricDraft,
      staffId: staff.id,
      branchId: staff.branchId,
      eventAt
    }, false);
  }

  uploadDocument(doc: ApiRecord, event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    this.uploadingDocId.set(doc.id);
    const reader = new FileReader();
    reader.onload = () => {
      const contentBase64 = String(reader.result || '').split(',').pop() || '';
      this.api.post<ApiRecord>(`staff-management/documents/${doc.id}/upload`, {
        fileName: file.name,
        mimeType: file.type || 'application/octet-stream',
        contentBase64
      }).subscribe({
        next: () => {
          this.uploadingDocId.set('');
          this.load();
        },
        error: (error) => {
          this.uploadingDocId.set('');
          this.error.set(error?.error?.error || 'Unable to upload document');
        }
      });
    };
    reader.readAsDataURL(file);
  }

  async openDocument(doc: ApiRecord): Promise<void> {
    if (!this.documentHasFile(doc)) return;
    const response = await fetch(`${environment.apiBaseUrl}/staff-management/documents/${doc.id}/file`, {
      headers: {
        'x-tenant-id': this.appState.selectedTenantId(),
        'x-user-role': this.appState.userRole()
      }
    });
    if (!response.ok) {
      this.error.set('Unable to open staff document');
      return;
    }
    const blob = await response.blob();
    window.open(URL.createObjectURL(blob), '_blank');
  }

  async openPayslip(row: ApiRecord): Promise<void> {
    const response = await fetch(`${environment.apiBaseUrl}/staff-management/payroll-components/${row.id}/payslip.pdf`, {
      headers: {
        'x-tenant-id': this.appState.selectedTenantId(),
        'x-user-role': this.appState.userRole()
      }
    });
    if (!response.ok) {
      this.error.set('Unable to open payslip PDF');
      return;
    }
    const blob = await response.blob();
    window.open(URL.createObjectURL(blob), '_blank');
  }

  sendWhatsapp(row: ApiRecord): void {
    this.save(`staff-management/notifications/${row.id}/send-whatsapp`, {}, false);
  }

  cloneStaffProfile(): void {
    const staff = this.staff();
    if (!staff) return;
    const clone: ApiRecord = {
      ...staff,
      name: `${staff.name} Copy`,
      employeeCode: `${staff.employeeCode || staff.id}-copy`,
      status: 'active'
    };
    delete clone.id;
    delete clone.createdAt;
    delete clone.updatedAt;
    this.saving.set(true);
    this.api.post<ApiRecord>('staff', clone).subscribe({
      next: () => {
        this.saving.set(false);
        this.load();
      },
      error: (error) => {
        this.error.set(error?.error?.error || 'Unable to clone staff profile');
        this.saving.set(false);
      }
    });
  }

  terminateStaff(): void {
    const staff = this.staff();
    if (!staff || !confirm(`Terminate ${staff.name}?`)) return;
    this.patchStaff({ status: 'inactive' }, 'Unable to terminate staff');
  }

  addEmployeeRole(): void {
    const staff = this.staff();
    if (!staff) return;
    const branchId = this.roleDraft.branchId || staff.branchId;
    const role = String(this.roleDraft.role || staff.role || '').trim();
    if (!role) {
      this.error.set('Role is required before adding employee role');
      return;
    }
    const rows = this.asArray(staff.employeeRoles).filter((row) => row && row.role);
    rows.push({
      branchId,
      view: this.branchName(branchId),
      viewType: this.roleDraft.viewType || 'Center',
      type: this.roleDraft.viewType || 'Center',
      role
    });
    const branchIds = Array.from(new Set([staff.branchId, ...this.asArray(staff.multiBranchIds), branchId].filter(Boolean)));
    this.patchStaff({ employeeRoles: rows, multiBranchIds: branchIds }, 'Unable to save employee role');
  }

  removeEmployeeRole(index: number): void {
    const staff = this.staff();
    if (!staff) return;
    const rows = this.asArray(staff.employeeRoles).filter((row) => row && row.role);
    rows.splice(index, 1);
    this.patchStaff({ employeeRoles: rows }, 'Unable to remove employee role');
  }

  roleRows(staff: ApiRecord): ApiRecord[] {
    const rows = this.asArray(staff.employeeRoles).filter((row) => row && row.role);
    if (rows.length) return rows;
    return staff.role ? [{ branchId: staff.branchId, view: this.branchName(staff.branchId), viewType: 'Center', type: 'Center', role: staff.role }] : [];
  }

  serviceOverrideValue(serviceId: string, field: string): number {
    const row = this.serviceOverride(serviceId);
    if (row[field] !== undefined && row[field] !== '') return Number(row[field] || 0);
    if (field === 'serviceTime') {
      return Number(this.services().find((service) => service.id === serviceId)?.durationMinutes || 0);
    }
    return 0;
  }

  serviceOverrideChecked(serviceId: string, field: string): boolean {
    const row = this.serviceOverride(serviceId);
    if (field === 'serviceAssignment') {
      const staff = this.staff();
      return Boolean(row.serviceAssignment ?? this.asArray(staff?.assignedServices).includes(serviceId));
    }
    return Boolean(row[field]);
  }

  setServiceOverride(serviceId: string, field: string, value: any): void {
    const rows = [...this.serviceOverrides()];
    const index = rows.findIndex((row) => row.serviceId === serviceId);
    const service = this.services().find((item) => item.id === serviceId);
    const row: ApiRecord = index >= 0 ? { ...rows[index] } : {
      serviceId,
      serviceName: service?.name || serviceId,
      serviceAssignment: this.asArray(this.staff()?.assignedServices).includes(serviceId),
      availableOnline: false,
      serviceTime: Number(service?.durationMinutes || 0)
    };
    row[field] = typeof value === 'boolean' ? value : Number(value || 0);
    if (index >= 0) rows[index] = row;
    else rows.push(row);
    this.serviceOverrides.set(rows);
  }

  saveServiceMatrix(): void {
    const rows = this.serviceOverrides();
    const assignedServices = rows.filter((row) => row.serviceAssignment).map((row) => row.serviceId);
    this.patchStaff({ serviceOverrides: rows, assignedServices }, 'Unable to save service matrix');
  }

  saveCommissionSettings(): void {
    const staff = this.staff();
    if (!staff) return;
    const current = this.asObject(staff.commissionRule);
    this.patchStaff({
      commissionRule: { ...current, ...this.commissionSettings },
      commissionSlabs: this.commissionSlabs()
    }, 'Unable to save commission settings');
  }

  addCommissionSlab(): void {
    const rows = [...this.commissionSlabs(), {
      fromRevenue: Number(this.slabDraft.fromRevenue || 0),
      toRevenue: Number(this.slabDraft.toRevenue || 0),
      commissionPercent: Number(this.slabDraft.commissionPercent || 0),
      activeFrom: new Date().toISOString().slice(0, 10)
    }];
    this.commissionSlabRows.set(rows);
    this.slabDraft = { fromRevenue: 0, toRevenue: 99999, commissionPercent: 10 };
    this.saveCommissionSettings();
  }

  removeCommissionSlab(index: number): void {
    const rows = [...this.commissionSlabs()];
    rows.splice(index, 1);
    this.commissionSlabRows.set(rows);
    this.saveCommissionSettings();
  }

  commissionSlabs(): ApiRecord[] {
    return this.commissionSlabRows();
  }

  private save(path: string, payload: ApiRecord, reset = true, copyAfter = false): void {
    this.saving.set(true);
    this.error.set('');
    this.api.post<ApiRecord>(path, payload).subscribe({
      next: (result) => {
        if (copyAfter && result?.body) this.copyNotification(result);
        this.saving.set(false);
        if (reset) this.resetDrafts();
        this.load();
      },
      error: (error) => {
        this.error.set(error?.error?.error || 'Unable to save staff workflow');
        this.saving.set(false);
      }
    });
  }

  private patchStaff(patch: ApiRecord, message: string): void {
    const staff = this.staff();
    if (!staff) return;
    this.saving.set(true);
    this.error.set('');
    this.api.patch<ApiRecord>(`staff/${staff.id}`, patch).subscribe({
      next: () => {
        this.saving.set(false);
        this.load();
      },
      error: (error) => {
        this.error.set(error?.error?.error || message);
        this.saving.set(false);
      }
    });
  }

  private serviceOverride(serviceId: string): ApiRecord {
    return this.serviceOverrides().find((row) => row.serviceId === serviceId) || {};
  }

  private syncConfigurationDrafts(profile: ApiRecord | null): void {
    const staff = profile?.staff || {};
    const assigned = new Set(this.asArray(staff.assignedServices));
    const existing = this.asArray(staff.serviceOverrides);
    const normalized = this.services().map((service) => {
      const row = existing.find((item) => item.serviceId === service.id) || {};
      return {
        serviceId: service.id,
        serviceName: service.name,
        shopCost: Number(row.shopCost || 0),
        labourCost: Number(row.labourCost || 0),
        commission: Number(row.commission ?? this.asObject(staff.commissionRule).servicePercent ?? 0),
        priceScalingFactor: Number(row.priceScalingFactor || 0),
        serviceTime: Number(row.serviceTime || service.durationMinutes || 0),
        commissionDeductions: Number(row.commissionDeductions || 0),
        serviceAssignment: Boolean(row.serviceAssignment ?? assigned.has(service.id)),
        availableOnline: Boolean(row.availableOnline)
      };
    });
    this.serviceOverrides.set(normalized);
    this.commissionSlabRows.set(this.asArray(staff.commissionSlabs));
    const rule = this.asObject(staff.commissionRule);
    this.commissionSettings = {
      defaultScalingFactor: Number(rule.defaultScalingFactor || 100),
      bookingScalingFactor: Number(rule.bookingScalingFactor || 100),
      slabMode: rule.slabMode || 'cumulative',
      pastPeriodMode: rule.pastPeriodMode || 'period_active'
    };
    this.roleDraft = {
      viewType: 'Center',
      branchId: staff.branchId || this.branches()[0]?.id || '',
      role: staff.role || 'Therapist'
    };
    this.slabDraft = { fromRevenue: 0, toRevenue: 99999, commissionPercent: 10 };
  }

  resetDrafts(): void {
    const staff = this.staff();
    const today = new Date().toISOString().slice(0, 10);
    this.leaveDraft = { leaveType: 'paid', startDate: today, endDate: today, reason: '' };
    this.payrollDraft = { basic: 25000, hra: 8000, allowances: 3000, deductions: 0, pf: 1800, esi: 0, tds: 0, pt: 200 };
    this.commissionDraft = { name: 'Enterprise commission rule', servicePercent: 10, productPercent: 5, membershipPercent: 3, packagePercent: 3, flatAmount: 0, targetBonus: 1000 };
    this.documentDraft = { documentType: 'Aadhaar', documentNumber: '', status: 'pending', expiresAt: '' };
    this.skillDraft = { skillName: 'Hair service', level: 'intermediate', certificationStatus: 'pending' };
    this.reviewDraft = { rating: 5, feedback: '', complaintFlag: false, rebookingFlag: false };
    this.transferDraft = { toBranchId: '', effectiveDate: today, reason: '' };
    this.biometricDraft = {
      employeeCode: this.asObject(staff?.biometricConfig).employeeCode || '',
      deviceId: this.asObject(staff?.biometricConfig).deviceId || '',
      eventType: 'clock_in',
      eventAt: new Date().toISOString().slice(0, 16)
    };
    this.skillServicesText = this.asArray(staff?.assignedServices).join(', ');
  }

  rosterDays(profile: ApiRecord): ApiRecord[] {
    const length = this.rosterView() === 'month' ? 30 : this.rosterView() === 'week' ? 7 : 1;
    const today = new Date();
    return Array.from({ length }, (_, index) => {
      const date = new Date(today);
      date.setDate(today.getDate() + index);
      const key = date.toISOString().slice(0, 10);
      return {
        date: key,
        label: date.toLocaleDateString('en-IN', { weekday: 'short' }),
        shifts: this.asArray(profile.shifts).filter((shift) => shift.date === key)
      };
    });
  }

  conflictFor(profile: ApiRecord, shiftId: string): string {
    return this.asArray(profile.conflicts).find((conflict) => conflict.shiftId === shiftId)?.message || '';
  }

  documentHasFile(doc: ApiRecord): boolean {
    return Boolean(this.asObject(doc.metadata).file?.url);
  }

  documentFileLabel(doc: ApiRecord): string {
    const file = this.asObject(doc.metadata).file;
    return file?.fileName ? `File: ${file.fileName}` : 'No file uploaded';
  }

  canApprove(): boolean {
    return ['superAdmin', 'owner', 'admin', 'manager'].includes(this.appState.userRole());
  }

  eligibleServiceCount(profile: ApiRecord): number {
    const ids = new Set<string>();
    for (const skill of this.asArray(profile.skills)) {
      this.asArray(skill.serviceIds).forEach((id) => ids.add(String(id)));
    }
    return ids.size || this.asArray(profile.staff.assignedServices).length;
  }

  assignedServices(staff: ApiRecord): ApiRecord[] {
    const ids = new Set(this.asArray(staff.assignedServices).map(String));
    return this.services().filter((service) => ids.has(service.id));
  }

  serviceNames(value: any): string {
    const ids = this.asArray(value);
    if (!ids.length) return 'All services';
    return ids.map((id) => this.services().find((service) => service.id === id)?.name || id).join(', ');
  }

  branchName(id: string): string {
    return this.branches().find((branch) => branch.id === id)?.name || id || 'Branch not set';
  }

  branchNames(staff: ApiRecord): string {
    const ids = Array.from(new Set([staff.branchId, ...this.asArray(staff.multiBranchIds)].filter(Boolean)));
    return ids.map((id) => this.branchName(String(id))).join(', ') || 'Branch not set';
  }

  breakLabel(staff: ApiRecord): string {
    const rule = this.asObject(staff.breakRules);
    if (!rule.start && !rule.end) return 'Break not set';
    return `${rule.start || '?'} - ${rule.end || '?'}`;
  }

  initials(name: string): string {
    return String(name || '?').split(' ').map((part) => part[0]).join('').slice(0, 2).toUpperCase();
  }

  asArray(value: any): any[] {
    if (Array.isArray(value)) return value;
    if (!value) return [];
    if (typeof value === 'string') {
      try {
        const parsed = JSON.parse(value);
        return Array.isArray(parsed) ? parsed : [];
      } catch {
        return value ? [value] : [];
      }
    }
    return [];
  }

  private asObject(value: any): ApiRecord {
    if (value && typeof value === 'object' && !Array.isArray(value)) return value;
    if (typeof value === 'string' && value.trim()) {
      try {
        const parsed = JSON.parse(value);
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
      } catch {
        return {};
      }
    }
    return {};
  }

  private csvList(value: any): string[] {
    return String(value || '').split(',').map((item) => item.trim()).filter(Boolean);
  }
}
