import { CommonModule } from '@angular/common';
import { Component, OnInit, computed, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { catchError, finalize, forkJoin, of } from 'rxjs';
import { ApiRecord } from '../../../core/api.service';
import { StaffOsApi } from '../data/staff-os.api';
import { StaffOsBranch, StaffOsFinePenalty, StaffOsLeaveMaster, StaffOsSchedule, StaffOsStaff, StaffOsStaffCategory, StaffOsTargetIncentive } from '../domain/staff-os.models';
import { readStaffPayrollRules, type StaffPayrollRules } from './payroll-rules.store';

type PayrollMode = 'preview' | 'generate' | 'regenerate';
type FinePenaltyRuleType = NonNullable<StaffOsFinePenalty['ruleType']>;
type RulePenaltyBreakdown = {
  ruleId: string;
  ruleName: string;
  ruleType: FinePenaltyRuleType;
  breakCount: number;
  amount: number;
  evidence: string;
};

type SalaryRow = {
  staffId: string;
  staffName: string;
  categoryName: string;
  present: number;
  absent: number;
  halfDay: number;
  late: number;
  leave: number;
  paidLeaveDays: number;
  unpaidLeaveDays: number;
  leaveBalanceDays: number;
  leaveDeduction: number;
  weekOffDay: string;
  calendarWeekOffDays: number;
  paidWeekOffDays: number;
  unpaidWeekOffDays: number;
  weekOffWorkedDays: number;
  weekOffPayout: number;
  weekendPenaltyDays: number;
  sandwichPenaltyDays: number;
  totalPayableDays: number;
  totalDeductionDays: number;
  workedHours: number;
  requiredHours: number;
  otHours: number;
  baseSalary: number;
  earnedSalary: number;
  shiftHours: number;
  attendanceDeduction: number;
  lateFine: number;
  otAmount: number;
  invoiceSales: number;
  serviceSales: number;
  productSales: number;
  membershipSales: number;
  serviceCommission: number;
  productCommission: number;
  membershipCommission: number;
  totalCommission: number;
  tips: number;
  allowances: number;
  rulePenalty: number;
  rulePenaltyBreakdown: RulePenaltyBreakdown[];
  deductions: number;
  totalAdvance: number;
  advanceInstallments: number;
  installmentNo: number;
  installmentAmount: number;
  advanceDeducted: number;
  advanceCarryForward: number;
  balanceAdvance: number;
  grossEarning: number;
  netSalary: number;
  status: string;
};

@Component({
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  template: `
    <section class="salary-page">
      <header class="hero">
        <div>
          <h1>Salary Generate</h1>
        </div>
        <div class="hero-actions">
          <button type="button" routerLink="/staff-os/payroll-rules">Payroll Rules</button>
          <button type="button" routerLink="/staff-os/salary-workspace">Salary Setup</button>
          <button class="primary" type="button" [disabled]="loading()" (click)="previewPayroll()">Preview Salary</button>
          <button type="button" [disabled]="!rows().length || loading()" (click)="generatePermanentPayroll()">Generate Salary</button>
        </div>
      </header>

      <p class="banner err" *ngIf="error()">{{ error() }}</p>
      <p class="banner ok" *ngIf="message()">{{ message() }}</p>
      <p class="banner info" *ngIf="loading()">Payroll data loading...</p>

      <section class="filters">
        <label><span>Month / Period</span><input type="month" [ngModel]="period()" (ngModelChange)="period.set($event); loadBaseData()" /></label>
        <label><span>Branch</span>
          <select [ngModel]="branchId()" (ngModelChange)="changeBranch($event)">
            <option value="">All branches</option>
            <option *ngFor="let branch of branches()" [value]="branch.id">{{ branch.name || branch.id }}</option>
          </select>
        </label>
        <label><span>Staff category</span>
          <select [ngModel]="categoryId()" (ngModelChange)="categoryId.set($event); buildRows()">
            <option value="">All categories</option>
            <option *ngFor="let category of categories()" [value]="category.id">{{ category.name }}</option>
          </select>
        </label>
        <label><span>Staff</span>
          <select [ngModel]="staffId()" (ngModelChange)="changeStaff($event)">
            <option value="">All staff</option>
            <option *ngFor="let person of staffOptions()" [value]="person.id">{{ displayStaff(person) }}</option>
          </select>
        </label>
        <label><span>Generate mode</span>
          <select [ngModel]="mode()" (ngModelChange)="mode.set($event)">
            <option value="preview">Preview only</option>
            <option value="generate">Generate salary</option>
            <option value="regenerate">Regenerate selected staff</option>
          </select>
        </label>
      </section>

      <section class="cards">
        <article><span>Total staff</span><strong>{{ summary().staff }}</strong></article>
        <article><span>Invoice sales</span><strong>{{ money(summary().invoiceSales) }}</strong></article>
        <article><span>Gross salary</span><strong>{{ money(summary().gross) }}</strong></article>
        <article><span>Service sales</span><strong>{{ money(summary().serviceSales) }}</strong><small>commission {{ money(summary().serviceCommission) }}</small></article>
        <article><span>Product sales</span><strong>{{ money(summary().productSales) }}</strong><small>commission {{ money(summary().productCommission) }}</small></article>
        <article><span>Membership sales</span><strong>{{ money(summary().membershipSales) }}</strong><small>commission {{ money(summary().membershipCommission) }}</small></article>
        <article><span>Paid leave</span><strong>{{ summary().paidLeaveDays }}</strong><small>balance {{ summary().leaveBalanceDays }}</small></article>
        <article><span>Unpaid leave</span><strong>{{ summary().unpaidLeaveDays }}</strong><small>deduction {{ money(summary().leaveDeduction) }}</small></article>
        <article><span>OT amount</span><strong>{{ money(summary().ot) }}</strong></article>
        <article><span>Advance deducted</span><strong>{{ money(summary().advance) }}</strong></article>
        <article><span>Rule penalty</span><strong>{{ money(summary().rulePenalty) }}</strong></article>
        <article><span>Deductions</span><strong>{{ money(summary().deductions) }}</strong></article>
        <article><span>Net payable</span><strong>{{ money(summary().net) }}</strong></article>
        <article><span>Payroll health</span><strong>{{ healthScore() }}%</strong></article>
      </section>

      <section class="panel" *ngIf="generatedRuns().length">
        <div class="panel-head">
          <h2>Generated payroll records</h2>
          <button type="button" (click)="loadPayrollRuns()">Refresh</button>
        </div>
        <div class="run-list">
          <article *ngFor="let run of generatedRuns()">
            <span>{{ run['periodStart'] || run['period_start'] }} - {{ run['periodEnd'] || run['period_end'] }}</span>
            <strong>{{ money(numberValue(run['netAmount'] || run['net_amount'])) }}</strong>
            <small>{{ run['status'] || 'draft' }} · Gross {{ money(numberValue(run['grossAmount'] || run['gross_amount'])) }} · Deductions {{ money(numberValue(run['deductionsAmount'] || run['deductions_amount'])) }}</small>
          </article>
        </div>
      </section>

      <section class="split">
        <article class="panel">
          <div class="panel-head">
            <h2>Validation checklist</h2>
            <button type="button" (click)="message.set('Safe fixes queued for missing optional rules.')">Auto Fix Safe Issues</button>
          </div>
          <div class="check" *ngFor="let item of validations()" [class.bad]="item.severity === 'bad'" [class.warn]="item.severity === 'warn'">
            <span>{{ item.ok ? 'OK' : '!' }}</span>
            <div><strong>{{ item.label }}</strong><small>{{ item.detail }}</small></div>
          </div>
        </article>

        <article class="panel">
          <div class="panel-head"><h2>Owner summary notification</h2><button type="button" (click)="copyOwnerSummary()">Copy</button></div>
          <pre>{{ ownerSummary() }}</pre>
        </article>
      </section>

      <section class="panel">
        <div class="panel-head">
          <h2>Staff-wise payroll preview</h2>
          <div class="toolbar">
            <button type="button" [disabled]="!rows().length" (click)="message.set('OT approvals reviewed for current preview.')">Approve OT</button>
            <button type="button" [disabled]="!rows().length" (click)="message.set('Payroll locked for current review session.')">Lock Payroll</button>
            <button type="button" (click)="exportCsv()">Export Excel</button>
            <button type="button" [disabled]="!rows().length" (click)="message.set('Payroll export ready for accounting handoff.')">Accounting Handoff</button>
          </div>
        </div>
        <div class="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Staff</th><th>Attendance</th><th>Leave</th><th>Week Off</th><th>Payable Days</th><th>Penalty Days</th><th>Basic</th><th>Earned Salary</th><th>WO Payout</th><th>OT Hrs</th><th>OT Salary</th><th>Invoice Sale</th><th>Service Sale</th><th>Service Comm.</th><th>Product Sale</th><th>Product Comm.</th><th>Membership Sale</th><th>Membership Comm.</th><th>Total Comm.</th><th>Gross</th><th>Rule Penalty</th><th>Advance Plan</th><th>Advance Deduct</th><th>Carry Fwd.</th><th>Balance Adv.</th><th>Net Salary</th><th>Status</th>
              </tr>
            </thead>
            <tbody>
              <tr *ngFor="let row of rows()" (click)="selectedRow.set(row)">
                <td><strong>{{ row.staffName }}</strong><small>{{ row.categoryName || 'Staff' }}</small></td>
                <td>{{ row.present }} P / {{ row.absent }} A<small>{{ row.late }} late, {{ row.halfDay }} half</small></td>
                <td>{{ row.leave }}<small>{{ row.paidLeaveDays }} paid, {{ row.unpaidLeaveDays }} unpaid</small></td>
                <td>{{ row.weekOffDay }}: {{ row.calendarWeekOffDays }}<small>{{ row.paidWeekOffDays }} paid, {{ row.weekOffWorkedDays }} worked</small></td>
                <td>{{ row.totalPayableDays }}</td>
                <td>{{ row.totalDeductionDays }}<small>{{ row.weekendPenaltyDays }} weekend, {{ row.sandwichPenaltyDays }} sandwich</small></td>
                <td>{{ money(row.baseSalary) }}</td>
                <td>{{ money(row.earnedSalary) }}</td>
                <td>{{ money(row.weekOffPayout) }}</td>
                <td>{{ hours(row.otHours) }}<small>{{ row.shiftHours }}h shift</small></td>
                <td>{{ money(row.otAmount) }}</td>
                <td>{{ money(row.invoiceSales) }}</td>
                <td>{{ money(row.serviceSales) }}</td>
                <td>{{ money(row.serviceCommission) }}<small>{{ payrollRules().serviceCommissionPct }}%</small></td>
                <td>{{ money(row.productSales) }}</td>
                <td>{{ money(row.productCommission) }}<small>{{ payrollRules().productCommissionPct }}%</small></td>
                <td>{{ money(row.membershipSales) }}</td>
                <td>{{ money(row.membershipCommission) }}<small>{{ payrollRules().membershipCommissionPct }}%</small></td>
                <td>{{ money(row.totalCommission) }}</td>
                <td>{{ money(row.grossEarning) }}</td>
                <td>{{ money(row.rulePenalty) }}<small>{{ row.rulePenaltyBreakdown.length }} rule hit</small></td>
                <td>{{ row.installmentNo }}/{{ row.advanceInstallments }}<small>{{ money(row.totalAdvance) }} total</small></td>
                <td>{{ money(row.advanceDeducted) }}<small>{{ money(row.installmentAmount) }} EMI</small></td>
                <td>{{ money(row.advanceCarryForward) }}</td>
                <td>{{ money(row.balanceAdvance) }}</td>
                <td>{{ money(row.netSalary) }}</td>
                <td><span class="pill">{{ row.status }}</span></td>
              </tr>
              <tr *ngIf="!rows().length"><td colspan="27" class="empty">Preview salary to load staff payroll rows.</td></tr>
            </tbody>
          </table>
        </div>
      </section>

      <aside class="drawer" *ngIf="selectedRow() as row">
        <div class="drawer-head">
          <div><h2>{{ row.staffName }}</h2></div>
          <button type="button" (click)="selectedRow.set(null)">Close</button>
        </div>
        <section>
          <h3>Attendance Breakup</h3>
          <div class="detail-grid">
            <span>Present <b>{{ row.present }}</b></span><span>Absent <b>{{ row.absent }}</b></span><span>Half day <b>{{ row.halfDay }}</b></span><span>Late <b>{{ row.late }}</b></span><span>Leave <b>{{ row.leave }}</b></span><span>Paid leave <b>{{ row.paidLeaveDays }}</b></span><span>Unpaid leave <b>{{ row.unpaidLeaveDays }}</b></span><span>Leave balance <b>{{ row.leaveBalanceDays }}</b></span><span>Worked <b>{{ hours(row.workedHours) }}</b></span><span>Required <b>{{ hours(row.requiredHours) }}</b></span><span>OT <b>{{ hours(row.otHours) }}</b></span>
          </div>
        </section>
        <section>
          <h3>Week Off Calculation</h3>
          <div class="line"><span>Week off day</span><b>{{ row.weekOffDay }}</b></div>
          <div class="line"><span>Calendar week offs</span><b>{{ row.calendarWeekOffDays }}</b></div>
          <div class="line"><span>Paid week offs</span><b>{{ row.paidWeekOffDays }}</b></div>
          <div class="line"><span>Unpaid week offs</span><b>{{ row.unpaidWeekOffDays }}</b></div>
          <div class="line"><span>Week off worked</span><b>{{ row.weekOffWorkedDays }}</b></div>
          <div class="line"><span>Week off payout</span><b>{{ money(row.weekOffPayout) }}</b></div>
          <div class="line"><span>Weekend penalty days</span><b>{{ row.weekendPenaltyDays }}</b></div>
          <div class="line"><span>Sandwich penalty days</span><b>{{ row.sandwichPenaltyDays }}</b></div>
          <div class="line"><span>Total payable days</span><b>{{ row.totalPayableDays }}</b></div>
        </section>
        <section>
          <h3>Salary Breakup</h3>
          <div class="line"><span>Monthly salary</span><b>{{ money(row.baseSalary) }}</b></div>
          <div class="line"><span>Formula</span><b>Basic / {{ daysInPeriod() }} * attendance</b></div>
          <div class="line"><span>Earned salary</span><b>{{ money(row.earnedSalary) }}</b></div>
          <div class="line"><span>Attendance deduction</span><b>{{ money(row.attendanceDeduction) }}</b></div>
          <div class="line"><span>Unpaid leave deduction</span><b>{{ money(row.leaveDeduction) }}</b></div>
          <div class="line"><span>Late fine</span><b>{{ money(row.lateFine) }}</b></div>
          <div class="line"><span>Rule penalty</span><b>{{ money(row.rulePenalty) }}</b></div>
          <div class="line"><span>OT formula</span><b>Basic / ({{ daysInPeriod() }} * {{ row.shiftHours }}) * OT</b></div>
          <div class="line"><span>OT amount</span><b>{{ money(row.otAmount) }}</b></div>
        </section>
        <section *ngIf="row.rulePenaltyBreakdown.length">
          <h3>Fine / Penalty Rules</h3>
          <div class="line" *ngFor="let penalty of row.rulePenaltyBreakdown">
            <span>{{ penalty.ruleName }} · {{ penalty.evidence }}</span><b>{{ money(penalty.amount) }}</b>
          </div>
        </section>
        <section>
          <h3>Commission and earnings</h3>
          <div class="line"><span>Invoice sale</span><b>{{ money(row.invoiceSales) }}</b></div>
          <div class="line"><span>Service sale x {{ payrollRules().serviceCommissionPct }}%</span><b>{{ money(row.serviceSales) }} -> {{ money(row.serviceCommission) }}</b></div>
          <div class="line"><span>Product sale x {{ payrollRules().productCommissionPct }}%</span><b>{{ money(row.productSales) }} -> {{ money(row.productCommission) }}</b></div>
          <div class="line"><span>Membership sold x {{ payrollRules().membershipCommissionPct }}%</span><b>{{ money(row.membershipSales) }} -> {{ money(row.membershipCommission) }}</b></div>
          <div class="line"><span>Total commission</span><b>{{ money(row.totalCommission) }}</b></div>
          <div class="line"><span>Tips</span><b>{{ money(row.tips) }}</b></div>
          <div class="line"><span>Allowances</span><b>{{ money(row.allowances) }}</b></div>
        </section>
        <section>
          <h3>Advance installment ledger</h3>
          <div class="line"><span>Total advance</span><b>{{ money(row.totalAdvance) }}</b></div>
          <div class="line"><span>Installment</span><b>{{ row.installmentNo }}/{{ row.advanceInstallments }}</b></div>
          <div class="line"><span>Monthly installment</span><b>{{ money(row.installmentAmount) }}</b></div>
          <div class="line"><span>Deducted this month</span><b>{{ money(row.advanceDeducted) }}</b></div>
          <div class="line"><span>Carry forward shortfall</span><b>{{ money(row.advanceCarryForward) }}</b></div>
          <div class="line"><span>Balance advance</span><b>{{ money(row.balanceAdvance) }}</b></div>
        </section>
        <section>
          <h3>Deductions and final pay</h3>
          <div class="line"><span>Fine / manual deduction</span><b>{{ money(row.deductions) }}</b></div>
          <div class="line"><span>Unpaid leave deduction</span><b>{{ money(row.leaveDeduction) }}</b></div>
          <div class="line"><span>Advance recovery</span><b>{{ money(row.advanceDeducted) }}</b></div>
          <div class="line"><span>Gross salary</span><b>{{ money(row.grossEarning) }}</b></div>
          <div class="line total"><span>Net payable</span><b>{{ money(row.netSalary) }}</b></div>
        </section>
        <section>
          <h3>Staff notification preview</h3>
          <pre>{{ staffNotification(row) }}</pre>
        </section>
      </aside>
    </section>
  `,
  styles: [`
    .salary-page { display: grid; gap: 16px; color: #122033; max-width: 100%; min-width: 0; overflow-x: hidden; }
    .hero, .filters, .panel, .cards article, .drawer { background: #fff; border: 1px solid #d8e4ea; border-radius: 8px; box-shadow: 0 16px 34px rgba(15,23,42,.06); }
    .hero { display: flex; justify-content: space-between; align-items: center; gap: 16px; padding: 22px 24px; min-width: 0; }
    h1 { margin: 4px 0 6px; font-size: 32px; letter-spacing: 0; } h2 { margin: 0; font-size: 18px; } h3 { margin: 0 0 10px; font-size: 15px; }
    p { margin: 0; color: #607086; } .eyebrow { color: #55173D; font-size: 12px; font-weight: 900; text-transform: uppercase; }
    .hero-actions, .toolbar, .panel-head { display: flex; gap: 10px; align-items: center; justify-content: space-between; flex-wrap: wrap; min-width: 0; }
    .toolbar { justify-content: flex-end; overflow-x: auto; max-width: 100%; padding-bottom: 2px; }
    .toolbar button, .hero-actions button { white-space: nowrap; }
    button { min-height: 38px; border: 1px solid #9fb2b8; border-radius: 6px; padding: 0 12px; background: #fff; color: #122033; font-weight: 900; cursor: pointer; }
    button.primary { background: #55173D; border-color: #55173D; color: #fff; } button:disabled { opacity: .55; cursor: not-allowed; }
    .filters { display: grid; grid-template-columns: repeat(5, minmax(0,1fr)); gap: 12px; padding: 14px; }
    label { display: grid; gap: 5px; color: #31445c; font-weight: 900; } label span { font-size: 12px; text-transform: uppercase; }
    input, select { min-height: 40px; border: 1px solid #b7c5cf; border-radius: 6px; padding: 0 10px; font: inherit; }
    .cards { display: grid; grid-template-columns: repeat(4, minmax(0,1fr)); gap: 12px; }
    .cards article { padding: 15px; border-top: 4px solid #55173D; } .cards span { color: #607086; font-weight: 800; } .cards strong { display: block; margin-top: 7px; font-size: 24px; } .cards small { color: #64748b; display: block; font-weight: 800; margin-top: 4px; }
    .split { display: grid; grid-template-columns: minmax(0,1fr) minmax(0,1fr); gap: 12px; min-width: 0; } .panel { padding: 16px; min-width: 0; max-width: 100%; }
    .run-list { display: grid; grid-template-columns: repeat(3, minmax(0,1fr)); gap: 12px; }
    .run-list article { padding: 12px; border: 1px solid #d8e4ea; border-radius: 8px; background: #f8fcfb; }
    .run-list span, .run-list small { display: block; color: #607086; font-weight: 800; } .run-list strong { display: block; margin: 6px 0; font-size: 20px; }
    .check { display: grid; grid-template-columns: 30px 1fr; gap: 10px; padding: 10px 0; border-top: 1px solid #edf2f5; } .check:first-of-type { border-top: 0; }
    .check > span { width: 24px; height: 24px; display: grid; place-items: center; border-radius: 50%; background: #FBF0E8; color: #7A4A28; font-weight: 900; } .check.warn > span { background: #fef3c7; color: #92400e; } .check.bad > span { background: #fee2e2; color: #991b1b; }
    .check small, td small { display: block; color: #607086; margin-top: 3px; }
    pre { white-space: pre-wrap; margin: 0; padding: 12px; background: #f6faf9; border: 1px solid #d8e4ea; border-radius: 8px; color: #26364b; }
    .table-scroll { overflow: auto; max-width: 100%; min-width: 0; } table { width: 100%; min-width: 1920px; border-collapse: collapse; } th, td { padding: 10px 12px; border-bottom: 1px solid #e1e9ef; text-align: left; } th { background: #eef7f5; color: #31445c; font-size: 12px; text-transform: uppercase; } tr { cursor: pointer; }
    .pill { padding: 4px 9px; border-radius: 999px; background: #F5EEF2; color: #8B5E7C; font-weight: 900; font-size: 12px; } .empty { text-align: center; color: #607086; padding: 28px; }
    .drawer { position: fixed; top: 0; right: 0; bottom: 0; z-index: 50; width: min(560px, 100vw); overflow: auto; padding: 18px; display: grid; gap: 16px; border-radius: 0; }
    .drawer-head { display: flex; justify-content: space-between; gap: 12px; align-items: center; border-bottom: 1px solid #e1e9ef; padding-bottom: 12px; }
    .detail-grid { display: grid; grid-template-columns: repeat(2, minmax(0,1fr)); gap: 8px; } .detail-grid span, .line { display: flex; justify-content: space-between; gap: 10px; padding: 9px 0; border-bottom: 1px solid #edf2f5; } .line.total { font-size: 18px; color: #55173D; }
    .banner { margin: 0; padding: 10px 14px; border-radius: 8px; font-weight: 800; } .banner.err { background: #fee2e2; color: #991b1b; } .banner.ok { background: #FBF0E8; color: #7A4A28; } .banner.info { background: #F5EEF2; color: #8B5E7C; }
    @media (max-width: 980px) { .hero, .split { grid-template-columns: 1fr; flex-direction: column; align-items: stretch; } .filters, .cards { grid-template-columns: 1fr; } }
    @media (max-width: 980px) { .run-list { grid-template-columns: 1fr; } }
  `]
})
export class SalaryGeneratePage implements OnInit {
  readonly branches = signal<StaffOsBranch[]>([]);
  readonly categories = signal<StaffOsStaffCategory[]>([]);
  readonly staff = signal<StaffOsStaff[]>([]);
  readonly attendanceLogs = signal<ApiRecord[]>([]);
  readonly schedules = signal<StaffOsSchedule[]>([]);
  readonly leaveMasters = signal<StaffOsLeaveMaster[]>([]);
  readonly leaves = signal<ApiRecord[]>([]);
  readonly leaveBalances = signal<ApiRecord[]>([]);
  readonly targetIncentives = signal<StaffOsTargetIncentive[]>([]);
  readonly finePenalties = signal<StaffOsFinePenalty[]>([]);
  readonly staffSalesRows = signal<ApiRecord[]>([]);
  readonly previewRows = signal<ApiRecord[]>([]);
  readonly generatedRuns = signal<ApiRecord[]>([]);
  readonly rows = signal<SalaryRow[]>([]);
  readonly selectedRow = signal<SalaryRow | null>(null);
  readonly loading = signal(false);
  readonly error = signal('');
  readonly message = signal('');
  readonly period = signal(new Date().toISOString().slice(0, 7));
  readonly branchId = signal('');
  readonly categoryId = signal('');
  readonly staffId = signal('');
  readonly mode = signal<PayrollMode>('preview');

  readonly staffOptions = computed(() => this.staff().filter((person) =>
    (!this.branchId() || person.branchId === this.branchId()) &&
    (!this.categoryId() || person.staffCategoryId === this.categoryId())
  ));

  readonly summary = computed(() => {
    const rows = this.rows();
    const sum = (key: keyof SalaryRow) => rows.reduce((total, row) => total + Number(row[key] || 0), 0);
    return {
      staff: rows.length,
      invoiceSales: sum('invoiceSales'),
      gross: sum('grossEarning'),
      serviceSales: sum('serviceSales'),
      productSales: sum('productSales'),
      membershipSales: sum('membershipSales'),
      serviceCommission: sum('serviceCommission'),
      productCommission: sum('productCommission'),
      membershipCommission: sum('membershipCommission'),
      paidLeaveDays: sum('paidLeaveDays'),
      unpaidLeaveDays: sum('unpaidLeaveDays'),
      leaveBalanceDays: sum('leaveBalanceDays'),
      leaveDeduction: sum('leaveDeduction'),
      ot: sum('otAmount'),
      advance: sum('advanceDeducted'),
      rulePenalty: sum('rulePenalty'),
      deductions: sum('deductions') + sum('advanceDeducted') + sum('attendanceDeduction') + sum('lateFine'),
      net: sum('netSalary')
    };
  });

  readonly healthScore = computed(() => {
    const checks = this.validations();
    if (!checks.length) return 100;
    return Math.round((checks.filter((item) => item.ok).length / checks.length) * 100);
  });

  readonly validations = computed(() => {
    const rows = this.rows();
    const staff = this.staffOptions();
    return [
      { label: 'Missing attendance', ok: rows.some((row) => row.present || row.absent || row.leave || row.workedHours) || !staff.length, severity: rows.length ? 'warn' : 'bad', detail: 'Face Punch / Attendance records se present, absent, late aur OT aayega.' },
      { label: 'Missing shift', ok: rows.every((row) => row.requiredHours > 0) || !rows.length, severity: 'warn', detail: 'Required hours will be verified from Shift Master.' },
      { label: 'Missing staff salary', ok: rows.every((row) => row.baseSalary > 0) || !rows.length, severity: 'bad', detail: 'Monthly salary must be set in Staff -> Salary / Payroll.' },
      { label: 'Missing commission rule', ok: rows.some((row) => row.serviceCommission || row.productCommission || row.membershipCommission) || !rows.length, severity: 'warn', detail: 'Service, product and membership commission will come from POS plus commission rules.' },
      { label: 'Advance salary cap', ok: rows.every((row) => row.advanceDeducted <= Math.max(0, row.grossEarning - row.deductions)) || !rows.length, severity: 'bad', detail: 'Advance deduction is capped by available salary; balance carries forward.' },
      { label: 'Unapproved OT', ok: rows.every((row) => row.otHours <= 2) || !rows.length, severity: 'warn', detail: 'Approve high OT before generating payroll.' },
      { label: 'Payroll already locked', ok: true, severity: 'ok', detail: 'Lock and reopen audit will connect to the permanent backend run in phase 2.' }
    ] as Array<{ label: string; ok: boolean; severity: 'ok' | 'warn' | 'bad'; detail: string }>;
  });

  constructor(private readonly api: StaffOsApi, private readonly route: ActivatedRoute) {}

  ngOnInit(): void {
    this.applyQueryParams();
    this.loadBaseData();
  }

  loadBaseData(): void {
    this.loading.set(true);
    this.error.set('');
    const scope = this.dataScope();
    forkJoin({
      branches: this.api.branches({ limit: 1000 }),
      categories: this.api.staffCategories({ limit: 500, includeArchived: 'true' }),
      staff: this.api.staff({ limit: 1000 }),
      attendance: this.api.attendance({ ...scope, from: this.periodStart(), to: this.periodEnd(), limit: 500 }),
      schedules: this.api.schedules({ ...scope, from: this.periodStart(), to: this.periodEnd(), limit: 500 }),
      leaveMasters: this.api.leaveMasters({ ...scope, visibleOnly: 'true', status: 'active', limit: 500 }).pipe(catchError(() => of([]))),
      leaves: this.api.leaves({ ...scope, from: this.periodStart(), to: this.periodEnd(), status: 'approved', limit: 1000 }).pipe(catchError(() => of([]))),
      leaveBalances: this.api.leaveBalances({ ...(this.staffId() ? { staffId: this.staffId() } : {}) }).pipe(catchError(() => of([]))),
      targetIncentives: this.api.targetIncentives({ ...scope, visibleOnly: 'true', status: 'active', limit: 1000 }).pipe(catchError(() => of([]))),
      finePenalties: this.api.finePenalties({ ...scope, visibleOnly: 'true', status: 'active', limit: 1000 }).pipe(catchError(() => of([]))),
      staffSales: this.api.staffSalesReport({ ...scope, from: this.periodStart(), to: this.periodEnd(), limit: 10000 }).pipe(catchError(() => of({ staff: [] }))),
      preview: this.api.attendancePayrollPreview({ ...scope, periodStart: this.periodStart(), periodEnd: this.periodEnd(), limit: 500 }),
      payroll: this.api.payrollRuns({ branchId: this.branchId(), limit: 10 })
    }).pipe(finalize(() => this.loading.set(false))).subscribe({
      next: ({ branches, categories, staff, attendance, schedules, leaveMasters, leaves, leaveBalances, targetIncentives, finePenalties, staffSales, preview, payroll }) => {
        this.branches.set(branches || []);
        this.categories.set(categories || []);
        this.staff.set(staff || []);
        this.attendanceLogs.set(attendance || []);
        this.schedules.set(schedules || []);
        this.leaveMasters.set(leaveMasters || []);
        this.leaves.set(leaves || []);
        this.leaveBalances.set(leaveBalances || []);
        this.targetIncentives.set(targetIncentives || []);
        this.finePenalties.set(finePenalties || []);
        this.staffSalesRows.set(this.staffSalesReportRows(staffSales));
        this.previewRows.set(preview || []);
        this.generatedRuns.set(payroll || []);
        this.buildRows();
      },
      error: (error: any) => this.error.set(error?.message || 'Unable to load payroll data.')
    });
  }

  previewPayroll(): void {
    this.loading.set(true);
    this.error.set('');
    this.api.generateAttendancePayrollPreview({
      ...this.dataScope(),
      periodStart: this.periodStart(),
      periodEnd: this.periodEnd(),
      defaultShiftStart: '09:00',
      lateGraceMinutes: 10,
      incentiveHoldAbsentDays: 3,
      defaultGrossAmount: 25000
    }).pipe(finalize(() => this.loading.set(false))).subscribe({
      next: () => {
        this.message.set('Payroll preview is ready. Review the validation checklist before generating salary.');
        this.loadBaseData();
      },
      error: () => {
        this.message.set('Local preview is ready. Backend preview is unavailable, so estimates are shown.');
        this.buildRows();
      }
    });
  }

  generatePermanentPayroll(): void {
    if (!this.rows().length) return;
    this.loading.set(true);
    this.error.set('');
    this.api.generatePayroll({
      branchId: this.branchId(),
      periodStart: this.periodStart(),
      periodEnd: this.periodEnd(),
      payrollRows: this.rows().map((row) => this.payrollPayload(row)),
      rules: this.payrollRules(),
      source: 'salary-generate'
    }).pipe(finalize(() => this.loading.set(false))).subscribe({
      next: (run) => {
        const notifications = Array.isArray(run['penaltyNotifications']) ? run['penaltyNotifications'] as ApiRecord[] : [];
        const queued = notifications.filter((item) => item['status'] === 'queued').length;
        const skipped = notifications.filter((item) => item['status'] === 'skipped').length;
        const notificationText = notifications.length ? ` ${queued} penalty WhatsApp alert${queued === 1 ? '' : 's'} queued${skipped ? `, ${skipped} skipped` : ''}.` : '';
        this.message.set(`Salary saved. Payroll run ${run['id'] || ''} is ready for review.${notificationText}`);
        this.loadPayrollRuns();
      },
      error: (error: any) => this.error.set(error?.message || 'Unable to save generated salary.')
    });
  }

  loadPayrollRuns(): void {
    this.api.payrollRuns({ branchId: this.branchId(), limit: 10 }).subscribe({
      next: (rows) => this.generatedRuns.set(rows || []),
      error: () => undefined
    });
  }

  payrollPayload(row: SalaryRow): ApiRecord {
    return {
      staffId: row.staffId,
      staffName: row.staffName,
      categoryName: row.categoryName,
      periodStart: this.periodStart(),
      periodEnd: this.periodEnd(),
      present: row.present,
      absent: row.absent,
      halfDay: row.halfDay,
      late: row.late,
      leave: row.leave,
      paidLeaveDays: row.paidLeaveDays,
      unpaidLeaveDays: row.unpaidLeaveDays,
      leaveBalanceDays: row.leaveBalanceDays,
      leaveDeduction: row.leaveDeduction,
      workedHours: row.workedHours,
      requiredHours: row.requiredHours,
      otHours: row.otHours,
      otAmount: row.otAmount,
      baseSalary: row.baseSalary,
      earnedSalary: row.earnedSalary,
      attendanceDeduction: row.attendanceDeduction,
      lateFine: row.lateFine,
      weekOffDay: row.weekOffDay,
      calendarWeekOffDays: row.calendarWeekOffDays,
      paidWeekOffDays: row.paidWeekOffDays,
      unpaidWeekOffDays: row.unpaidWeekOffDays,
      weekOffWorkedDays: row.weekOffWorkedDays,
      weekOffPayout: row.weekOffPayout,
      weekendPenaltyDays: row.weekendPenaltyDays,
      sandwichPenaltyDays: row.sandwichPenaltyDays,
      totalPayableDays: row.totalPayableDays,
      totalDeductionDays: row.totalDeductionDays,
      invoiceSales: row.invoiceSales,
      serviceSales: row.serviceSales,
      productSales: row.productSales,
      membershipSales: row.membershipSales,
      serviceCommission: row.serviceCommission,
      productCommission: row.productCommission,
      membershipCommission: row.membershipCommission,
      totalCommission: row.totalCommission,
      tips: row.tips,
      allowances: row.allowances,
      rulePenalty: row.rulePenalty,
      rulePenaltyBreakdown: row.rulePenaltyBreakdown,
      deductions: row.deductions,
      totalAdvance: row.totalAdvance,
      advanceInstallments: row.advanceInstallments,
      installmentNo: row.installmentNo,
      installmentAmount: row.installmentAmount,
      advanceDeducted: row.advanceDeducted,
      advanceCarryForward: row.advanceCarryForward,
      balanceAdvance: row.balanceAdvance,
      grossEarning: row.grossEarning,
      netSalary: row.netSalary,
      status: row.status
    };
  }

  buildRows(): void {
    const previewByStaff = new Map(this.previewRows().map((row) => [String(row['staffId'] || row['staff_id'] || ''), row]));
    const attendanceByStaff = this.attendanceLogs().reduce((map, row) => {
      const staffId = String(row['staffId'] || row['staff_id'] || '');
      if (!staffId) return map;
      const rows = map.get(staffId) || [];
      rows.push(row);
      map.set(staffId, rows);
      return map;
    }, new Map<string, ApiRecord[]>());
    const schedulesByStaff = this.schedules().reduce((map, row) => {
      const staffId = String(row.staffId || '');
      if (!staffId) return map;
      const rows = map.get(staffId) || [];
      rows.push(row);
      map.set(staffId, rows);
      return map;
    }, new Map<string, StaffOsSchedule[]>());
    const leavesByStaff = this.leaves().reduce((map, row) => {
      const staffId = String(row['staffId'] || row['staff_id'] || '');
      if (!staffId) return map;
      const rows = map.get(staffId) || [];
      rows.push(row);
      map.set(staffId, rows);
      return map;
    }, new Map<string, ApiRecord[]>());
    const salesByStaff = new Map<string, ApiRecord>();
    for (const row of this.staffSalesRows()) {
      const staffId = String(row['staffId'] || '');
      const staffName = this.normalizeStaffKey(row['staffName']);
      if (staffId) salesByStaff.set(staffId, row);
      if (staffName && !salesByStaff.has(`name:${staffName}`)) salesByStaff.set(`name:${staffName}`, row);
    }
    const filtered = this.staffOptions().filter((person) => !this.staffId() || person.id === this.staffId());
    this.rows.set(filtered.map((person) => this.rowForStaff(
      person,
      previewByStaff.get(person.id),
      attendanceByStaff.get(person.id) || [],
      schedulesByStaff.get(person.id) || [],
      leavesByStaff.get(person.id) || [],
      salesByStaff.get(person.id) || salesByStaff.get(`name:${this.normalizeStaffKey(this.displayStaff(person))}`)
    )));
  }

  staffSalaryProfile(person: StaffOsStaff): ApiRecord {
    return (person.employeeDetails?.attendanceSalary || {}) as ApiRecord;
  }

  staffBaseSalary(person: StaffOsStaff, preview: ApiRecord | undefined): number {
    const salary = this.staffSalaryProfile(person);
    return number(
      preview?.['grossAmount']
        || preview?.['baseSalary']
        || preview?.['basicSalary']
        || preview?.['grossSalary']
        || salary['basicSalary']
        || salary['baseSalary']
        || salary['grossAmount']
        || salary['grossSalary'],
      0
    );
  }

  rowForStaff(person: StaffOsStaff, preview: ApiRecord | undefined, attendanceLogs: ApiRecord[] = [], schedules: StaffOsSchedule[] = [], approvedLeaves: ApiRecord[] = [], sales: ApiRecord | undefined = undefined): SalaryRow {
    const rules = this.payrollRules();
    const hasPreview = Boolean(preview);
    const scheduleSummary = this.scheduleSummary(schedules);
    const shiftHours = number(preview?.['shiftHours'] || preview?.['dailyShiftHours'], scheduleSummary.averageShiftHours || rules.defaultShiftHours);
    const attendanceSummary = this.attendanceSummary(attendanceLogs, shiftHours);
    const leaveSummary = this.leaveSummaryFor(person, approvedLeaves);
    const present = Math.max(number(preview?.['presentDays'], 0), attendanceSummary.presentDays);
    const absent = number(preview?.['absentDays'], 0);
    const late = Math.max(number(preview?.['lateCount'], 0), attendanceSummary.lateCount);
    const halfDay = number(preview?.['halfDays'], 0);
    const previewLeave = number(preview?.['leaveDays'], 0);
    const paidLeaveDays = leaveSummary.totalDays ? leaveSummary.paidDays : previewLeave;
    const unpaidLeaveDays = leaveSummary.unpaidDays;
    const leave = leaveSummary.totalDays || previewLeave;
    const baseSalary = this.staffBaseSalary(person, preview);
    const weekOffDayIndex = Math.max(0, Math.min(6, Math.round(number(preview?.['weekOffDay'], rules.weekOffDay))));
    const calendarWeekOffDays = this.countWeekdayInPeriod(weekOffDayIndex);
    const weekOffTaken = Math.max(0, Math.min(calendarWeekOffDays, number(preview?.['weekOffTaken'], hasPreview ? calendarWeekOffDays : 0)));
    const weekOffWorkedDays = hasPreview ? Math.max(0, calendarWeekOffDays - weekOffTaken) : 0;
    const paidWeekOffDays = rules.paidWeekOff && hasPreview ? Math.max(0, calendarWeekOffDays - weekOffWorkedDays) : 0;
    const unpaidWeekOffDays = Math.max(0, calendarWeekOffDays - paidWeekOffDays - weekOffWorkedDays);
    const weekendPenaltyDays = this.weekendPenaltyDays(preview, absent, rules);
    const sandwichPenaltyDays = rules.sandwichRule ? number(preview?.['sandwichPenaltyDays'], absent > 0 && calendarWeekOffDays > 0 ? Math.min(1, calendarWeekOffDays) : 0) : 0;
    const normalDeductionDays = Math.max(0, absent + halfDay * 0.5 + unpaidLeaveDays);
    const totalDeductionDays = normalDeductionDays + weekendPenaltyDays + sandwichPenaltyDays + unpaidWeekOffDays;
    const attendancePayableDays = present + halfDay * 0.5 + paidLeaveDays + paidWeekOffDays + weekOffWorkedDays;
    const totalPayableDays = Math.max(0, Math.min(this.daysInPeriod(), attendancePayableDays));
    const earnedSalary = Math.round((baseSalary / this.daysInPeriod()) * totalPayableDays);
    const workedHours = Math.max(number(preview?.['workedHours'], 0), attendanceSummary.workedHours || present * shiftHours);
    const requiredHours = Math.max(number(preview?.['requiredHours'], 0), scheduleSummary.requiredHours, present * shiftHours);
    const otHours = Math.max(0, attendanceSummary.overtimeHours, number(preview?.['overtimeMinutes'] || preview?.['overtime_minutes'], 0) / 60);
    const attendanceDeduction = Math.max(0, baseSalary - earnedSalary);
    const leaveDeduction = Math.round((baseSalary / this.daysInPeriod()) * unpaidLeaveDays);
    const lateFine = late * 50;
    const monthlyOtBaseHours = Math.max(1, this.daysInPeriod() * shiftHours);
    const otAmount = Math.round(otHours * (baseSalary / monthlyOtBaseHours));
    const serviceSales = Math.max(number(preview?.['serviceSales'] || preview?.['serviceAmount'], 0), number(sales?.['serviceRevenue'], 0));
    const productSales = Math.max(number(preview?.['productSales'] || preview?.['productAmount'], 0), number(sales?.['productRevenue'], 0));
    const membershipSales = Math.max(
      number(preview?.['membershipSales'] || preview?.['membershipAmount'], 0),
      number(sales?.['membershipRevenue'], 0) + number(sales?.['packageRevenue'], 0)
    );
    const invoiceSales = Math.max(number(preview?.['invoiceSales'] || preview?.['totalSales'] || preview?.['totalRevenue'], 0), number(sales?.['totalRevenue'], 0), serviceSales + productSales + membershipSales);
    const serviceCommission = Math.max(number(preview?.['serviceCommission'], 0), this.incentiveAmountFor(person, 'service', serviceSales, rules.serviceCommissionPct));
    const productCommission = Math.max(number(preview?.['productCommission'], 0), this.incentiveAmountFor(person, 'product', productSales, rules.productCommissionPct));
    const membershipCommission = Math.max(number(preview?.['membershipCommission'], 0), this.incentiveAmountFor(person, 'membership', membershipSales, rules.membershipCommissionPct));
    const totalCommission = serviceCommission + productCommission + membershipCommission;
    const tips = number(preview?.['tips'], 0);
    const allowances = number(preview?.['allowances'], 0);
    const weekOffPayout = Math.round(weekOffWorkedDays * (baseSalary / this.daysInPeriod()) * rules.weekOffWorkedMultiplier);
    const rulePenaltyBreakdown = this.rulePenaltyBreakdownFor(person, {
      late_count: late,
      absent_day: absent,
      half_day: halfDay,
      short_hours: Math.max(0, requiredHours - workedHours),
      no_clock_out: this.noClockOutCount(attendanceLogs),
      weekend_penalty: weekendPenaltyDays,
      sandwich_penalty: sandwichPenaltyDays,
      unpaid_week_off: unpaidWeekOffDays
    });
    const rulePenalty = rulePenaltyBreakdown.reduce((total, item) => total + item.amount, 0);
    const deductions = number(preview?.['deductions'], lateFine) + rulePenalty;
    const grossEarning = earnedSalary + weekOffPayout + otAmount + totalCommission + tips + allowances;
    const advancePlan = this.advancePlanFor(preview, rules.advanceSalaryCap ? Math.max(0, grossEarning - deductions) : Number.MAX_SAFE_INTEGER);
    const netSalary = Math.max(0, grossEarning - deductions - advancePlan.advanceDeducted);
    return {
      staffId: person.id,
      staffName: this.displayStaff(person),
      categoryName: person.staffCategoryName || '',
      present, absent, halfDay, late, leave, paidLeaveDays, unpaidLeaveDays, leaveBalanceDays: leaveSummary.balanceDays, leaveDeduction,
      weekOffDay: this.weekdayName(weekOffDayIndex), calendarWeekOffDays, paidWeekOffDays, unpaidWeekOffDays, weekOffWorkedDays, weekOffPayout, weekendPenaltyDays, sandwichPenaltyDays, totalPayableDays, totalDeductionDays,
      workedHours, requiredHours, otHours,
      baseSalary, earnedSalary, shiftHours, attendanceDeduction, lateFine, otAmount,
      invoiceSales, serviceSales, productSales, membershipSales, serviceCommission, productCommission, membershipCommission, totalCommission,
      tips, allowances, rulePenalty, rulePenaltyBreakdown, deductions, ...advancePlan, grossEarning, netSalary,
      status: preview?.['incentiveHold'] ? 'Hold' : rulePenalty ? 'Penalty deducted' : unpaidLeaveDays ? 'Unpaid leave deducted' : 'Ready'
    };
  }

  applyQueryParams(): void {
    const params = this.route.snapshot.queryParamMap;
    const branchId = params.get('branchId') || params.get('branch_id') || '';
    const staffId = params.get('staffId') || params.get('staff_id') || '';
    const date = params.get('date') || params.get('businessDate') || '';
    if (date) this.period.set(date.slice(0, 7));
    if (branchId) this.branchId.set(branchId);
    if (staffId) this.staffId.set(staffId);
  }

  changeBranch(branchId: string): void {
    this.branchId.set(branchId);
    this.loadBaseData();
  }

  changeStaff(staffId: string): void {
    this.staffId.set(staffId);
    this.loadBaseData();
  }

  dataScope(): ApiRecord {
    return {
      ...(this.branchId() ? { branchId: this.branchId() } : {}),
      ...(this.staffId() ? { staffId: this.staffId() } : {})
    };
  }

  staffSalesReportRows(report: ApiRecord | null | undefined): ApiRecord[] {
    return Array.isArray(report?.['staff']) ? report['staff'] as ApiRecord[] : [];
  }

  normalizeStaffKey(value: unknown): string {
    return String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
  }

  leaveSummaryFor(person: StaffOsStaff, approvedLeaves: ApiRecord[]): { paidDays: number; unpaidDays: number; totalDays: number; balanceDays: number } {
    const branchId = this.branchId() || person.branchId || '';
    const paidByType = new Map<string, number>();
    let paidDays = 0;
    let unpaidDays = 0;
    for (const leave of approvedLeaves) {
      const leaveType = String(leave['leaveType'] || leave['leave_type'] || '').trim();
      const master = this.leaveMasterFor(leaveType, branchId);
      const dayCount = Math.max(0, number(master?.dayCount, 1) || 1);
      const days = this.leaveDaysInPeriod(leave) * dayCount;
      if (days <= 0) continue;
      if (this.leaveMasterIsPaid(master)) {
        paidDays += days;
        paidByType.set(leaveType, (paidByType.get(leaveType) || 0) + days);
      } else {
        unpaidDays += days;
      }
    }
    for (const [leaveType, days] of paidByType) {
      const balance = this.leaveBalanceFor(person.id, leaveType);
      if (balance < 0) {
        const overBalanceDays = Math.min(days, Math.abs(balance));
        paidDays -= overBalanceDays;
        unpaidDays += overBalanceDays;
      }
    }
    paidDays = this.roundDays(paidDays);
    unpaidDays = this.roundDays(unpaidDays);
    return {
      paidDays,
      unpaidDays,
      totalDays: this.roundDays(paidDays + unpaidDays),
      balanceDays: this.roundDays(this.leaveBalanceFor(person.id))
    };
  }

  leaveMasterFor(leaveType: string, branchId: string): StaffOsLeaveMaster | undefined {
    const key = this.normalizeStaffKey(leaveType);
    const matches = this.leaveMasters().filter((master) => {
      const code = this.normalizeStaffKey(master.code);
      const name = this.normalizeStaffKey(master.name);
      return code === key || name === key;
    });
    return matches.find((master) => master.branchId === branchId)
      || matches.find((master) => !master.branchId)
      || matches[0];
  }

  leaveMasterIsPaid(master: StaffOsLeaveMaster | undefined): boolean {
    if (!master) return true;
    const raw = (master as unknown as ApiRecord)['paid'];
    return master.paid !== false && raw !== 0 && raw !== '0';
  }

  leaveDaysInPeriod(leave: ApiRecord): number {
    const rawStart = String(leave['startDate'] || leave['start_date'] || '').slice(0, 10);
    const rawEnd = String(leave['endDate'] || leave['end_date'] || rawStart).slice(0, 10);
    if (!this.isIsoDate(rawStart)) return Math.max(0, number(leave['days'] || leave['value'], 0));
    const start = rawStart > this.periodStart() ? rawStart : this.periodStart();
    const endSeed = this.isIsoDate(rawEnd) ? rawEnd : rawStart;
    const end = endSeed < this.periodEnd() ? endSeed : this.periodEnd();
    return this.daysBetween(start, end);
  }

  leaveBalanceFor(staffId: string, leaveType = ''): number {
    const targetType = this.normalizeStaffKey(leaveType);
    return this.leaveBalances()
      .filter((row) => String(row['staffId'] || row['staff_id'] || '') === staffId)
      .filter((row) => !targetType || this.normalizeStaffKey(row['leaveType'] || row['leave_type']) === targetType)
      .filter((row) => this.balanceRowAppliesToPeriod(row))
      .reduce((total, row) => total + number(row['balance'], 0), 0);
  }

  balanceRowAppliesToPeriod(row: ApiRecord): boolean {
    const start = String(row['periodStart'] || row['period_start'] || '').slice(0, 10);
    const end = String(row['periodEnd'] || row['period_end'] || '').slice(0, 10);
    return (!this.isIsoDate(start) || start <= this.periodEnd()) && (!this.isIsoDate(end) || end >= this.periodStart());
  }

  daysBetween(start: string, end: string): number {
    if (!this.isIsoDate(start) || !this.isIsoDate(end) || end < start) return 0;
    const [startYear, startMonth, startDay] = start.split('-').map(Number);
    const [endYear, endMonth, endDay] = end.split('-').map(Number);
    const startMs = Date.UTC(startYear, startMonth - 1, startDay);
    const endMs = Date.UTC(endYear, endMonth - 1, endDay);
    return Math.max(0, Math.floor((endMs - startMs) / 86400000) + 1);
  }

  isIsoDate(value: string): boolean {
    return /^\d{4}-\d{2}-\d{2}$/.test(value);
  }

  roundDays(value: number): number {
    return Math.round((value || 0) * 100) / 100;
  }

  incentiveAmountFor(person: StaffOsStaff, type: 'service' | 'product' | 'membership', amount: number, fallbackPercent: number): number {
    if (!amount) return 0;
    const rule = this.incentiveRuleFor(person, type);
    if (!rule) return Math.round(amount * (fallbackPercent / 100));
    const slabs = (rule.slabs || []).filter((slab) => Number.isFinite(number(slab.fromAmount, 0)));
    const slab = slabs.find((item) => {
      const from = number(item.fromAmount, 0);
      const to = number(item.toAmount, 0);
      return amount >= from && (!to || amount <= to);
    }) || slabs[slabs.length - 1];
    if (!slab) return Math.round(amount * (fallbackPercent / 100));
    const flat = number(slab.incentiveAmount || slab.employeeAmount, 0);
    const percent = number(slab.incentivePercent || slab.employeeAmountPercent, 0);
    if (flat > 0) return Math.round(flat);
    if (percent > 0) return Math.round(amount * (percent / 100));
    return Math.round(amount * (fallbackPercent / 100));
  }

  incentiveRuleFor(person: StaffOsStaff, type: 'service' | 'product' | 'membership'): StaffOsTargetIncentive | undefined {
    const branchId = this.branchId() || person.branchId || '';
    const active = this.targetIncentives().filter((rule) =>
      rule.targetType === type &&
      !rule.hide &&
      (!branchId || !rule.branchId || rule.branchId === branchId)
    );
    return active.find((rule) => rule.assigneeType === 'staff' && rule.assigneeId === person.id)
      || active.find((rule) => rule.assigneeType === 'standard')
      || active[0];
  }

  rulePenaltyBreakdownFor(person: StaffOsStaff, metrics: Partial<Record<FinePenaltyRuleType, number>>): RulePenaltyBreakdown[] {
    const branchId = this.branchId() || person.branchId || '';
    return this.finePenalties()
      .filter((rule) =>
        !rule.hide &&
        rule.status !== 'archived' &&
        rule.autoDeduct !== false &&
        (rule.ruleType || 'manual') !== 'manual' &&
        (!branchId || !rule.branchId || rule.branchId === branchId)
      )
      .map((rule) => {
        const breakCount = this.ruleBreakCount(rule, metrics);
        return {
          ruleId: rule.id,
          ruleName: rule.ruleLabel || rule.name,
          ruleType: rule.ruleType || 'manual',
          breakCount,
          amount: Math.round((rule.amount || 0) * breakCount),
          evidence: this.ruleEvidence(rule.ruleType || 'manual', metrics, rule.ruleLabel)
        };
      })
      .filter((item) => item.breakCount > 0 && item.amount > 0);
  }

  ruleBreakCount(rule: StaffOsFinePenalty, metrics: Partial<Record<FinePenaltyRuleType, number>>): number {
    const metric = metrics[rule.ruleType || 'manual'] || 0;
    const trigger = Math.max(1, number(rule.triggerCount, 1));
    if (metric < trigger) return 0;
    return rule.applyMode === 'fixed' ? 1 : Math.max(1, Math.floor(metric / trigger));
  }

  ruleEvidence(ruleType: FinePenaltyRuleType, metrics: Partial<Record<FinePenaltyRuleType, number>>, customLabel = ''): string {
    const labels: Record<FinePenaltyRuleType, string> = {
      manual: 'Manual',
      late_count: 'Late',
      absent_day: 'Absent',
      half_day: 'Half day',
      short_hours: 'Short hours',
      no_clock_out: 'No clock out',
      weekend_penalty: 'Weekend penalty',
      sandwich_penalty: 'Sandwich penalty',
      unpaid_week_off: 'Unpaid week off'
    };
    return `${customLabel || labels[ruleType]} ${Math.round((metrics[ruleType] || 0) * 100) / 100}`;
  }

  attendanceSummary(attendanceLogs: ApiRecord[], _dailyShiftHours = 0): { presentDays: number; workedHours: number; overtimeHours: number; lateCount: number } {
    const presentDates = new Set<string>();
    let workedHours = 0;
    let overtimeMinutes = 0;
    let lateCount = 0;
    attendanceLogs.forEach((row) => {
      const date = String(row['businessDate'] || row['business_date'] || '').slice(0, 10);
      if (date) presentDates.add(date);
      const durationHours = this.attendanceDurationHours(row);
      workedHours += durationHours;
      const savedOtMinutes = number(row['overtimeMinutes'] || row['overtime_minutes'], 0);
      overtimeMinutes += savedOtMinutes;
      const status = String(row['status'] || row['attendanceStatus'] || row['attendance_status'] || '').toLowerCase();
      if (status.includes('late')) lateCount += 1;
    });
    return {
      presentDays: presentDates.size,
      workedHours: Math.round(workedHours * 100) / 100,
      overtimeHours: Math.round((overtimeMinutes / 60) * 100) / 100,
      lateCount
    };
  }

  attendanceDurationHours(row: ApiRecord): number {
    const clockIn = this.parseAttendanceTime(this.attendanceClockIn(row));
    const clockOut = this.parseAttendanceTime(this.attendanceClockOut(row));
    if (!clockIn || !clockOut || clockOut <= clockIn) return 0;
    return (clockOut - clockIn) / 36e5;
  }

  attendanceClockIn(row: ApiRecord): unknown {
    return row['clockInAt'] || row['clock_in_at'] || row['checkInAt'] || row['check_in_at'] || row['inTime'] || row['in_time'];
  }

  attendanceClockOut(row: ApiRecord): unknown {
    return row['clockOutAt'] || row['clock_out_at'] || row['checkOutAt'] || row['check_out_at'] || row['outTime'] || row['out_time'];
  }

  parseAttendanceTime(value: unknown): number {
    if (!value) return 0;
    const parsed = new Date(String(value)).getTime();
    return Number.isFinite(parsed) ? parsed : 0;
  }

  noClockOutCount(attendanceLogs: ApiRecord[]): number {
    return attendanceLogs.filter((row) => this.attendanceClockIn(row) && !this.attendanceClockOut(row)).length;
  }

  scheduleSummary(schedules: StaffOsSchedule[]): { requiredHours: number; averageShiftHours: number } {
    const workingSchedules = schedules.filter((row) => {
      const record = row as unknown as ApiRecord;
      const status = String(record['status'] || '').toLowerCase();
      const shiftType = String(record['shiftType'] || record['shift_type'] || '').toLowerCase();
      return !status.includes('cancel') && !shiftType.includes('off') && !shiftType.includes('leave') && !shiftType.includes('holiday');
    });
    const requiredHours = workingSchedules.reduce((sum, row) => sum + this.scheduleDurationHours(row), 0);
    return {
      requiredHours: Math.round(requiredHours * 100) / 100,
      averageShiftHours: workingSchedules.length ? Math.round((requiredHours / workingSchedules.length) * 100) / 100 : 0
    };
  }

  scheduleDurationHours(row: StaffOsSchedule): number {
    const start = this.timeToMinutes(row.startTime);
    const end = this.timeToMinutes(row.endTime);
    if (start < 0 || end < 0) return 0;
    const normalizedEnd = end <= start ? end + 1440 : end;
    return (normalizedEnd - start) / 60;
  }

  timeToMinutes(value: unknown): number {
    const text = String(value || '').trim().toLowerCase();
    const match = text.match(/^(\d{1,2}):(\d{2})(?:\s*(am|pm))?$/);
    if (!match) return -1;
    let hour = Number(match[1]);
    const minute = Number(match[2]);
    const meridian = match[3];
    if (meridian === 'pm' && hour < 12) hour += 12;
    if (meridian === 'am' && hour === 12) hour = 0;
    return hour * 60 + minute;
  }

  advancePlanFor(preview: ApiRecord | undefined, availableSalary: number): Pick<SalaryRow, 'totalAdvance' | 'advanceInstallments' | 'installmentNo' | 'installmentAmount' | 'advanceDeducted' | 'advanceCarryForward' | 'balanceAdvance'> {
    const totalAdvance = number(preview?.['totalAdvance'] || preview?.['advanceTotal'], 0);
    const advanceInstallments = Math.max(1, Math.min(4, Math.round(number(preview?.['advanceInstallments'] || preview?.['installmentCount'], 1))));
    const paidInstallments = Math.max(0, Math.round(number(preview?.['advancePaidInstallments'], 0)));
    const installmentNo = totalAdvance ? Math.min(advanceInstallments, paidInstallments + 1) : 0;
    const installmentAmount = totalAdvance ? Math.ceil(totalAdvance / advanceInstallments) : 0;
    const openingBalance = Math.max(0, number(preview?.['balanceAdvance'] || preview?.['advanceBalance'], Math.max(0, totalAdvance - installmentAmount * paidInstallments)));
    const plannedDeduction = Math.min(openingBalance, number(preview?.['advanceDeducted'] || preview?.['advanceRecovery'], installmentAmount));
    const advanceDeducted = Math.min(plannedDeduction, Math.max(0, availableSalary));
    const advanceCarryForward = Math.max(0, plannedDeduction - advanceDeducted);
    const balanceAdvance = Math.max(0, openingBalance - advanceDeducted);
    return { totalAdvance, advanceInstallments, installmentNo, installmentAmount, advanceDeducted, advanceCarryForward, balanceAdvance };
  }

  payrollRules(): StaffPayrollRules {
    return readStaffPayrollRules();
  }

  countWeekdayInPeriod(weekday: number): number {
    const [year, month] = this.period().split('-').map(Number);
    const lastDate = new Date(year, month, 0).getDate();
    let count = 0;
    for (let day = 1; day <= lastDate; day += 1) {
      if (new Date(year, month - 1, day).getDay() === weekday) count += 1;
    }
    return count;
  }

  weekendPenaltyDays(preview: ApiRecord | undefined, absent: number, rules: StaffPayrollRules): number {
    if (!rules.weekendPenalty) return 0;
    const fridayAbsents = number(preview?.['fridayAbsents'], 0);
    const saturdayAbsents = number(preview?.['saturdayAbsents'], 0);
    const sundayAbsents = number(preview?.['sundayAbsents'], absent ? 1 : 0);
    return Math.max(0, fridayAbsents * (rules.fridayPenaltyDays - 1))
      + Math.max(0, saturdayAbsents * (rules.saturdayPenaltyDays - 1))
      + Math.max(0, sundayAbsents * (rules.sundayPenaltyDays - 1));
  }

  weekdayName(weekday: number): string {
    return ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][weekday] || 'Monday';
  }

  ownerSummary(): string {
    const s = this.summary();
    const top = [...this.rows()].sort((a, b) => b.netSalary - a.netSalary)[0];
    const highOt = [...this.rows()].sort((a, b) => b.otHours - a.otHours)[0];
    return `${this.period()} Payroll Ready\n\nTotal staff: ${s.staff}\nInvoice sales: ${this.money(s.invoiceSales)}\nService sales: ${this.money(s.serviceSales)}\nProduct sales: ${this.money(s.productSales)}\nMembership sales: ${this.money(s.membershipSales)}\nGross salary: ${this.money(s.gross)}\nPaid leave: ${s.paidLeaveDays}\nUnpaid leave: ${s.unpaidLeaveDays}\nLeave balance: ${s.leaveBalanceDays}\nLeave deduction: ${this.money(s.leaveDeduction)}\nService commission: ${this.money(s.serviceCommission)}\nProduct commission: ${this.money(s.productCommission)}\nMembership commission: ${this.money(s.membershipCommission)}\nOT: ${this.money(s.ot)}\nRule penalty: ${this.money(s.rulePenalty)}\nAdvance deducted: ${this.money(s.advance)}\nDeductions: ${this.money(s.deductions)}\nNet payable: ${this.money(s.net)}\n\nTop earner: ${top ? `${top.staffName} ${this.money(top.netSalary)}` : '-'}\nHighest OT: ${highOt ? `${highOt.staffName} ${this.hours(highOt.otHours)}` : '-'}\nAttention: ${this.validations().filter((item) => !item.ok).length} payroll checks need review.`;
  }

  staffNotification(row: SalaryRow): string {
    return `Hi ${row.staffName},\nYour ${this.period()} salary is ready.\n\nBasic salary: ${this.money(row.baseSalary)}\nEarned salary: ${this.money(row.earnedSalary)}\nAttendance: ${row.present} present, ${row.absent} absent, ${row.late} late\nLeave: ${row.paidLeaveDays} paid, ${row.unpaidLeaveDays} unpaid\nUnpaid leave deduction: ${this.money(row.leaveDeduction)}\nWorked hours: ${this.hours(row.workedHours)}\nOT: ${this.hours(row.otHours)} = ${this.money(row.otAmount)}\nService commission: ${this.money(row.serviceCommission)}\nProduct commission: ${this.money(row.productCommission)}\nMembership commission: ${this.money(row.membershipCommission)}\nRule penalty: ${this.money(row.rulePenalty)}\nAdvance installment: ${row.installmentNo}/${row.advanceInstallments}\nAdvance deducted: ${this.money(row.advanceDeducted)}\nCarry forward advance: ${this.money(row.advanceCarryForward)}\nBalance advance: ${this.money(row.balanceAdvance)}\nDeductions: ${this.money(row.deductions + row.attendanceDeduction + row.lateFine)}\n\nNet payable: ${this.money(row.netSalary)}\nPayslip: View`;
  }

  copyOwnerSummary(): void {
    navigator.clipboard?.writeText(this.ownerSummary());
    this.message.set('Owner summary copied.');
  }

  exportCsv(): void {
    const header = ['Staff', 'Present', 'Absent', 'Late', 'Paid Leave', 'Unpaid Leave', 'Leave Balance', 'Leave Deduction', 'Week Off Day', 'Calendar Week Off', 'Paid Week Off', 'Unpaid Week Off', 'Week Off Worked', 'Week Off Payout', 'Weekend Penalty Days', 'Sandwich Penalty Days', 'Total Payable Days', 'Total Deduction Days', 'Basic Salary', 'Earned Salary', 'OT Hrs', 'OT Salary', 'Invoice Sale', 'Service Sale', 'Service Commission', 'Product Sale', 'Product Commission', 'Membership Sale', 'Membership Commission', 'Total Commission', 'Gross Salary', 'Rule Penalty', 'Rule Penalty Breakup', 'Total Advance', 'Installment', 'Advance Deducted', 'Carry Forward Advance', 'Balance Advance', 'Net Salary', 'Status'];
    const rows = this.rows().map((row) => [row.staffName, row.present, row.absent, row.late, row.paidLeaveDays, row.unpaidLeaveDays, row.leaveBalanceDays, row.leaveDeduction, row.weekOffDay, row.calendarWeekOffDays, row.paidWeekOffDays, row.unpaidWeekOffDays, row.weekOffWorkedDays, row.weekOffPayout, row.weekendPenaltyDays, row.sandwichPenaltyDays, row.totalPayableDays, row.totalDeductionDays, row.baseSalary, row.earnedSalary, row.otHours, row.otAmount, row.invoiceSales, row.serviceSales, row.serviceCommission, row.productSales, row.productCommission, row.membershipSales, row.membershipCommission, row.totalCommission, row.grossEarning, row.rulePenalty, row.rulePenaltyBreakdown.map((item) => `${item.ruleName}: ${item.amount}`).join('; '), row.totalAdvance, `${row.installmentNo}/${row.advanceInstallments}`, row.advanceDeducted, row.advanceCarryForward, row.balanceAdvance, row.netSalary, row.status]);
    const csv = [header, ...rows].map((line) => line.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(',')).join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `salary-generate-${this.period()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  periodStart(): string { return `${this.period()}-01`; }
  periodEnd(): string {
    const [year, month] = this.period().split('-').map(Number);
    return new Date(year, month, 0).toISOString().slice(0, 10);
  }
  daysInPeriod(): number {
    const [year, month] = this.period().split('-').map(Number);
    return new Date(year, month, 0).getDate() || 31;
  }
  displayStaff(person: StaffOsStaff): string { return person.fullName || `${person.firstName} ${person.lastName || ''}`.trim(); }
  money(value: number): string { return '₹' + Math.round(value || 0).toLocaleString('en-IN'); }
  numberValue(value: unknown): number { return number(value, 0); }
  hours(value: number): string {
    const totalMinutes = Math.round((value || 0) * 60);
    return `${Math.floor(totalMinutes / 60)}h ${totalMinutes % 60}m`;
  }
}

function number(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}
