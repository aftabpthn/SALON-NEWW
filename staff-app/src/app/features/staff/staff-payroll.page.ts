import { DatePipe } from "@angular/common";
import { Component, HostListener, OnInit, computed, signal } from "@angular/core";
import { StaffAppService, StaffPayrollItem, StaffPayrollProfile } from "../../core/staff-app.service";
import { displayBusinessDate } from "../../core/business-date";
import { PaiseInrPipe } from "../../core/paise-inr.pipe";
import { StaffPageStateComponent } from "./staff-page-state.component";

@Component({
  standalone: true,
  imports: [PaiseInrPipe, DatePipe, StaffPageStateComponent],
  template: `
    <section class="page">
      <header class="page-head">
        <div><p class="eyebrow">Payroll</p><h1>Payroll</h1><p>Your own payroll runs, pay breakdown, and payslip links from CRM.</p></div>
      </header>
      @if (!canSeePayroll()) { <section staffPageState class="notice">You do not have permission to view payroll.</section> }
      @if (loading() && !payroll().length) {
        <section class="payroll-skeleton" aria-label="Loading payroll">
          <div class="skeleton-grid"><span class="skeleton"></span><span class="skeleton"></span><span class="skeleton"></span></div>
          <span class="skeleton payroll-list-skeleton"></span>
        </section>
      }
      @if (loadError()) { <section staffPageState class="notice payroll-error"><span>{{ loadError() }}</span><button class="link-button" type="button" [disabled]="loading()" [attr.aria-busy]="loading()" (click)="load()">Retry</button></section> }
      @if (localError()) { <section staffPageState class="notice">{{ localError() }}</section> }
      @if (staff.error() && !loadError() && !localError()) { <section staffPageState class="notice">{{ staff.error() }}</section> }

      @if (canSeePayroll()) {
        <section class="grid three payroll-kpis">
          <article class="kpi"><span>Runs</span><strong>{{ payroll().length }}</strong><small>{{ refreshing() ? 'Refreshing...' : 'Your records' }}</small></article>
          <article class="kpi"><span>Gross</span><strong>{{ totalGross() | paiseInr }}</strong><small>Total shown</small></article>
          <article class="kpi"><span>Net pay</span><strong>{{ totalNet() | paiseInr }}</strong><small>{{ payslipCount() }} payslips</small></article>
        </section>
        @if (profile(); as payProfile) {
          <section class="panel payroll-profile">
            <div class="panel-title"><h2>Pay setup</h2><span>Active</span></div>
            <div class="payroll-profile-grid">
              <span><b>Rate</b>{{ payProfile.amountPaise | paiseInr }}</span>
              <span><b>Type</b>{{ label(payProfile.rateType) }}</span>
              <span><b>Effective from</b>{{ displayDate(payProfile.effectiveFrom) }}</span>
            </div>
          </section>
        }
        <section class="panel">
          <div class="panel-title"><h2>Payroll runs</h2><span>{{ refreshing() ? 'Refreshing...' : payroll().length }}</span></div>
          <div class="list">
            @for (item of payroll(); track item.id) {
              <div class="row payroll-row" [class.pending]="downloadingId() === item.id">
                <div class="row-main">
                  <strong>{{ item.netPay | paiseInr }}</strong>
                  <small>{{ periodLabel(item) }}</small>
                  <div class="payroll-breakdown">
                    <span><b>Salary</b>{{ item.salaryPay | paiseInr }}</span>
                    <span><b>Overtime</b>{{ item.overtimePay | paiseInr }}</span>
                    <span><b>Commission</b>{{ item.commissionPay | paiseInr }}</span>
                    <span><b>Adjustments</b>{{ item.adjustmentPay | paiseInr }}</span>
                    <span><b>Deductions</b>{{ item.deductionsPay | paiseInr }}</span>
                    <span><b>Net</b>{{ item.netPay | paiseInr }}</span>
                  </div>
                  <details class="payroll-details">
                    <summary>Detailed breakup</summary>
                    <h3>Attendance</h3>
                    <div class="payroll-breakdown">
                      <span><b>Present</b>{{ days(item.presentDaysX2) }}</span>
                      <span><b>Absent</b>{{ days(item.absentDaysX2) }}</span>
                      <span><b>Half days</b>{{ item.halfDayCount }}</span>
                      <span><b>Paid leave</b>{{ days(item.paidLeaveDaysX2) }}</span>
                      <span><b>Worked</b>{{ item.workedMinutes }} min</span>
                      <span><b>Late</b>{{ item.lateMinutes }} min</span>
                      <span><b>Early leave</b>{{ item.earlyLeaveMinutes }} min</span>
                    </div>
                    <h3>Overtime</h3>
                    <div class="payroll-breakdown">
                      <span><b>Approved</b>{{ hours(item.approvedOvertimeMinutes) }}</span>
                      <span><b>Rate / hour</b>{{ item.overtimeRatePayPerHour | paiseInr }}</span>
                      <span><b>Overtime pay</b>{{ item.overtimePay | paiseInr }}</span>
                    </div>
                    <h3>Business</h3>
                    <div class="payroll-breakdown">
                      <span><b>Services</b>{{ item.serviceSalesPay | paiseInr }}</span>
                      <span><b>Products</b>{{ item.productSalesPay | paiseInr }}</span>
                      <span><b>Memberships</b>{{ item.membershipSalesPay | paiseInr }}</span>
                      <span><b>Packages</b>{{ item.packageSalesPay | paiseInr }}</span>
                    </div>
                    <h3>Commission</h3>
                    <div class="payroll-breakdown">
                      <span><b>Services</b>{{ item.serviceCommissionPay | paiseInr }}</span>
                      <span><b>Products</b>{{ item.productCommissionPay | paiseInr }}</span>
                      <span><b>Memberships</b>{{ item.membershipCommissionPay | paiseInr }}</span>
                      <span><b>Packages</b>{{ item.packageCommissionPay | paiseInr }}</span>
                    </div>
                    <h3>Deductions</h3>
                    <div class="payroll-breakdown">
                      <span><b>Late</b>{{ item.lateDeductionPay | paiseInr }}</span>
                      <span><b>Absence</b>{{ item.absenceDeductionPay | paiseInr }}</span>
                      <span><b>Advance</b>{{ item.advanceRecoveryPay | paiseInr }}</span>
                      <span><b>Fine</b>{{ item.fineDeductionPay | paiseInr }}</span>
                      <span><b>Statutory</b>{{ item.statutoryDeductionPay | paiseInr }}</span>
                      <span><b>Other</b>{{ otherDeduction(item) | paiseInr }}</span>
                    </div>
                  </details>
                  @if (item.paidAt) { <small>Paid {{ item.paidAt | date:'dd/MM/yyyy' }}@if (item.paymentMethod) { · {{ label(item.paymentMethod) }}}@if (item.reference) { · Ref {{ item.reference }}}</small> }
                  @else { <small>@if (item.createdAt) { Finalized {{ item.createdAt | date:'dd/MM/yyyy' }} · }Payout not recorded</small> }
                </div>
                <div class="row-actions payroll-actions">
                  <span class="badge" [class.green]="item.status === 'paid' || item.status === 'finalized'">{{ item.status || 'unknown' }}</span>
                  @if (item.payslipPath) {
                    <button class="link-button" type="button" [disabled]="!!downloadingId()" [attr.aria-busy]="downloadingId() === item.id" (click)="downloadPayslip(item)">{{ downloadingId() === item.id ? 'Opening...' : 'Download PDF' }}</button>
                  } @else {
                    <span class="pill">No payslip</span>
                  }
                </div>
              </div>
            } @empty {
              @if (!loading() && !loadError()) { <div class="payroll-empty"><p>No finalized payroll runs yet.</p><small>Your finalized CRM payroll and payslip will appear here.</small></div> }
            }
          </div>
        </section>
      }
    </section>
  `,
  styleUrls: ["./staff-app.styles.css"],
  styles: [`
    .payroll-skeleton { display: grid; gap: 12px; }
    .payroll-list-skeleton { min-height: 260px; }
    .payroll-error { justify-content: space-between; }
    .payroll-kpis .kpi strong { font-size: clamp(1.25rem, 2.3vw, 1.75rem); }
    .payroll-row { align-items: flex-start; }
    .payroll-row.pending { opacity: .72; }
    .payroll-breakdown { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; margin-top: 10px; }
    .payroll-breakdown span { display: grid; gap: 3px; min-width: 0; padding: 9px 10px; border: 1px solid var(--staff-border); border-radius: 12px; background: var(--staff-surface-secondary); color: var(--staff-text); font-size: .82rem; font-weight: 750; overflow-wrap: anywhere; }
    .payroll-breakdown b { color: var(--staff-text-secondary); font-size: .68rem; text-transform: uppercase; }
    .payroll-details { margin-top: 10px; }
    .payroll-details summary { color: var(--staff-primary); cursor: pointer; font-size: .78rem; font-weight: 750; }
    .payroll-details h3 { margin: 12px 0 0; color: var(--staff-text-secondary); font-size: .72rem; text-transform: uppercase; }
    .payroll-actions .link-button { min-width: 102px; }
    .payroll-profile-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; }
    .payroll-profile-grid span { display: grid; gap: 4px; padding: 10px 12px; border: 1px solid var(--staff-border); border-radius: 12px; background: var(--staff-surface-secondary); font-weight: 750; }
    .payroll-profile-grid b { color: var(--staff-text-secondary); font-size: .7rem; text-transform: uppercase; }
    .payroll-empty { display: grid; justify-items: center; gap: 5px; padding: 26px 10px; color: var(--staff-text-secondary); font-weight: 600; text-align: center; }
    .payroll-empty p { margin: 0; }
    .payroll-empty small { font-weight: 600; line-height: 1.4; }
    @media (max-width: 700px) {
      .payroll-error, .payroll-row, .payroll-actions { align-items: stretch; flex-direction: column; }
      .payroll-error button, .payroll-actions .link-button { width: 100%; }
      .payroll-actions .badge, .payroll-actions .pill { width: fit-content; }
      .payroll-breakdown { grid-template-columns: 1fr; }
      .payroll-profile-grid { grid-template-columns: 1fr; }
    }
  `]
})
export class StaffPayrollPage implements OnInit {
  readonly payroll = signal<StaffPayrollItem[]>([]);
  readonly profile = signal<StaffPayrollProfile | null>(null);
  readonly loading = signal(false);
  readonly refreshing = signal(false);
  readonly loadError = signal("");
  readonly localError = signal("");
  readonly downloadingId = signal("");
  readonly totalGross = computed(() => this.payroll().reduce((total, item) => total + Number(item.grossPay || 0), 0));
  readonly totalNet = computed(() => this.payroll().reduce((total, item) => total + Number(item.netPay || 0), 0));
  readonly payslipCount = computed(() => this.payroll().filter((item) => !!item.payslipPath).length);

  constructor(readonly staff: StaffAppService) {}

  ngOnInit() { if (this.canSeePayroll()) void this.load(); }

  async load(silent = false) {
    if (!this.canSeePayroll()) {
      this.payroll.set([]);
      this.profile.set(null);
      return;
    }
    if (silent) this.refreshing.set(true); else this.loading.set(true);
    this.loadError.set("");
    try {
      const overview = await this.staff.payrollOverview();
      this.payroll.set(overview.items);
      this.profile.set(overview.profile);
    } catch {
      this.loadError.set(this.staff.error() || "Unable to load payroll.");
    } finally {
      this.loading.set(false);
      this.refreshing.set(false);
    }
  }

  @HostListener("window:aura:payroll-updated")
  onPayrollUpdated() { if (this.canSeePayroll()) void this.load(true); }

  @HostListener("document:visibilitychange")
  onVisibilityChange() {
    if (document.visibilityState === "visible" && this.canSeePayroll()) void this.load(true);
  }

  canSeePayroll(): boolean { return this.staff.hasPermission("staff.app.payroll.read"); }

  periodLabel(item: StaffPayrollItem): string {
    const start = this.displayDate(item.periodStart) || "Start date unavailable";
    const end = this.displayDate(item.periodEnd) || "End date unavailable";
    return `${start} - ${end}`;
  }

  displayDate(value: string): string { return displayBusinessDate(value); }
  label(value: string): string { return value.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase()); }
  days(valueX2: number): string { return `${Number(valueX2 || 0) / 2} days`; }
  hours(minutes: number): string { return `${(Number(minutes || 0) / 60).toFixed(2)} hr`; }
  otherDeduction(item: StaffPayrollItem): number {
    return Math.max(0, item.deductionsPay - item.lateDeductionPay - item.absenceDeductionPay - item.advanceRecoveryPay - item.fineDeductionPay - item.statutoryDeductionPay);
  }

  async downloadPayslip(item: StaffPayrollItem) {
    this.localError.set("");
    if (!item.payslipPath || this.downloadingId()) return;
    this.downloadingId.set(item.id);
    try {
      await this.staff.downloadPayslip(item.payslipPath);
    } catch {
      this.localError.set(this.staff.error() || "Unable to open payslip.");
    } finally {
      this.downloadingId.set("");
    }
  }
}
