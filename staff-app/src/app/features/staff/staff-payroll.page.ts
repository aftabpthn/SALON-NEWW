import { DatePipe } from "@angular/common";
import { Component, HostListener, OnInit, computed, signal } from "@angular/core";
import { StaffAppService, StaffEarningsDetail, StaffPayrollDocument, StaffPayrollItem, StaffPayrollProfile } from "../../core/staff-app.service";
import { businessDate, displayBusinessDate, parseDisplayBusinessDate } from "../../core/business-date";
import { PaiseInrPipe } from "../../core/paise-inr.pipe";
import { StaffDatePickerComponent } from "../../shared/staff-date-picker.component";
import { StaffPageStateComponent } from "./staff-page-state.component";

@Component({
  standalone: true,
  imports: [PaiseInrPipe, DatePipe, StaffDatePickerComponent, StaffPageStateComponent],
  template: `
    <section class="page">
      <header class="page-head">
        <div><p class="eyebrow">Payroll</p><h1>Payroll</h1><p>Your own payroll runs, earnings, tips, and documents from CRM.</p></div>
        @if (canSeePayroll()) { <button class="secondary-button" type="button" [disabled]="loading() || refreshing()" (click)="load(true)">Refresh</button> }
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

      @if (canSeePayroll()) {
        <section class="panel earnings-filter">
          <label>From<aura-staff-date-picker [value]="periodStart()" ariaLabel="Earnings period start" (valueChange)="periodStart.set($event)" /></label>
          <label>To<aura-staff-date-picker [value]="periodEnd()" ariaLabel="Earnings period end" (valueChange)="periodEnd.set($event)" /></label>
          <label>Commission basis<select [value]="basis()" (change)="basis.set($any($event.target).value); load(true)"><option value="sale_date">Sale date</option><option value="close_date">Close date</option></select></label>
          <button class="secondary-button" type="button" [disabled]="loading() || refreshing()" (click)="load(true)">Apply</button>
        </section>
        <section class="grid three payroll-kpis">
          <article class="kpi"><span>Runs</span><strong>{{ payroll().length }}</strong><small>{{ refreshing() ? 'Refreshing...' : 'Your records' }}</small></article>
          <article class="kpi"><span>Gross</span><strong>{{ totalGross() | paiseInr }}</strong><small>Total shown</small></article>
          <article class="kpi"><span>Net pay</span><strong>{{ totalNet() | paiseInr }}</strong><small>{{ payslipCount() }} payslips</small></article>
        </section>
        <section class="panel payroll-profile">
          <div class="panel-title"><h2>Year to date</h2><span>{{ currentYear }}</span></div>
          <div class="payroll-profile-grid"><span><b>Gross</b>{{ ytdGross() | paiseInr }}</span>@if (showDeductions()) { <span><b>Deductions</b>{{ ytdDeductions() | paiseInr }}</span> }<span><b>Net</b>{{ ytdNet() | paiseInr }}</span>@if (showEmployerCosts()) { <span><b>Employer contribution</b>{{ ytdEmployer() | paiseInr }}</span> }</div>
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
        } @else if (!loading() && !loadError()) {
          <section class="panel payroll-profile">
            <div class="panel-title"><h2>Pay setup</h2><span>CRM pending</span></div>
            <div class="payroll-empty"><p>No active pay rate configured.</p><small>Add the staff pay rate in CRM Staff → Payroll before payroll can be generated.</small></div>
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
                    @if (showDeductions()) { <span><b>Deductions</b>{{ item.deductionsPay | paiseInr }}</span> }
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
                    @if (showDeductions()) {
                      <h3>Deductions</h3>
                      <div class="payroll-breakdown">
                        <span><b>Late</b>{{ item.lateDeductionPay | paiseInr }}</span>
                        <span><b>Absence</b>{{ item.absenceDeductionPay | paiseInr }}</span>
                        <span><b>Advance</b>{{ item.advanceRecoveryPay | paiseInr }}</span>
                        <span><b>Fine</b>{{ item.fineDeductionPay | paiseInr }}</span>
                        <span><b>Statutory</b>{{ item.statutoryDeductionPay | paiseInr }}</span>
                        <span><b>Other</b>{{ otherDeduction(item) | paiseInr }}</span>
                      </div>
                    }
                    @if (showEmployerCosts()) { <h3>Employer</h3><div class="payroll-breakdown"><span><b>Statutory contribution</b>{{ item.statutoryEmployerPay | paiseInr }}</span></div> }
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

        @if (earnings(); as detail) {
          <section class="panel">
            <div class="panel-title"><h2>Commission drill-down</h2><span>@if (detail.calculatedUpTo) { Calculated up to {{ detail.calculatedUpTo | date:'dd/MM/yyyy HH:mm' }} } @else { No commission calculation }</span></div>
            <div class="list compact-list">
              @for (row of detail.commissions; track row.id) {
                <div class="row"><div class="row-main"><strong>{{ row.itemName || label(row.itemType) }}</strong><small>{{ row.invoiceNumber || row.saleId }} · {{ displayDate(detail.basis === 'close_date' ? row.closeDate : row.saleDate) }} · {{ label(row.itemType) }}</small><small>@if (row.freeService) { Free service · }@if (row.noShowOrCancellation) { Cancellation/no-show · }{{ row.ruleName || 'Commission rule' }}</small></div><div class="row-actions">@if (detail.visibility.costs) { <small>Base {{ row.basePaise | paiseInr }}</small> }<strong>{{ row.commissionPaise | paiseInr }}</strong></div></div>
              } @empty { <div class="payroll-empty"><p>No commission entries for this period.</p></div> }
            </div>
          </section>

          <section class="panel">
            <div class="panel-title"><h2>Tips and payouts</h2><span>INR · Bank / UPI · Zenoti Wallet N/A</span></div>
            <div class="list compact-list">
              @for (row of detail.tips; track row.saleId) {
                <div class="row"><div class="row-main"><strong>{{ row.amountPaise | paiseInr }}</strong><small>{{ row.invoiceNumber || row.saleId }} · {{ displayDate(row.businessDate) }} · {{ label(row.source) }}</small><small>{{ label(row.payoutStatus) }}@if (row.payoutMethod) { · {{ label(row.payoutMethod) }} }@if (row.reconciledAt) { · Reconciled {{ row.reconciledAt | date:'dd/MM/yyyy' }} }</small></div><div class="row-actions">@if (canDisputeTips()) { <button class="link-button" type="button" (click)="selectTipDispute(row.saleId, row.payoutId || '')">Dispute</button> }</div></div>
              } @empty { <div class="payroll-empty"><p>No card or cash tips for this period.</p></div> }
            </div>
            @if (disputeSaleId() || disputePayoutId()) {
              <div class="dispute-form"><label>Dispute reason<textarea [value]="disputeReason()" maxlength="1000" (input)="disputeReason.set($any($event.target).value)"></textarea></label><div class="row-actions"><button class="secondary-button" type="button" (click)="clearTipDispute()">Cancel</button><button class="primary-button" type="button" [disabled]="disputeSaving() || disputeReason().trim().length < 10" (click)="submitTipDispute()">{{ disputeSaving() ? 'Sending...' : 'Submit dispute' }}</button></div></div>
            }
            <details class="payroll-details"><summary>Declared tips, payout and dispute history</summary>
              <div class="history-grid">
                @for (row of detail.declaredTips; track row.sessionId) { <span><b>Declared {{ row.businessDate | date:'dd/MM/yyyy' }}</b>{{ row.amountPaise | paiseInr }}</span> }
                @for (row of detail.tipPayouts; track row.id) { <span><b>{{ label(row.status) }} payout</b>{{ row.amountPaise | paiseInr }} · {{ label(row.payoutMethod) }}@if (row.reconciledAt) { · Reconciled }</span> }
                @for (row of detail.tipDisputes; track row.id) { <span><b>{{ label(row.status) }} dispute</b>{{ row.reason }}@if (row.resolutionNote) { · {{ row.resolutionNote }} }</span> }
              </div>
            </details>
          </section>

          <section class="panel">
            <div class="panel-title"><h2>Advances and reimbursements</h2><span>{{ detail.advances.length + detail.reimbursements.length }}</span></div>
            <div class="list compact-list">
              @for (row of detail.advances; track row.id) { <div class="row"><div class="row-main"><strong>Salary advance · {{ label(row.status) }}</strong><small>{{ row.reason }}</small><small>{{ row.disbursementMethod ? label(row.disbursementMethod) : 'Not disbursed' }}@if (row.disbursementReference) { · {{ row.disbursementReference }} } · {{ row.recoveries.length }} recoveries</small></div><div class="row-actions"><strong>{{ row.outstandingPaise | paiseInr }}</strong><small>Outstanding</small></div></div> }
              @for (row of detail.reimbursements; track row.id) { <div class="row"><div class="row-main"><strong>Reimbursement · {{ row.voucherNumber }}</strong><small>{{ displayDate(row.businessDate) }} · {{ label(row.status) }} · {{ row.remarks }}</small></div><div class="row-actions"><strong>{{ row.amountPaise | paiseInr }}</strong></div></div> }
              @if (!detail.advances.length && !detail.reimbursements.length) { <div class="payroll-empty"><p>No advance or reimbursement history.</p></div> }
            </div>
          </section>
        }

        @if (canSeeDocuments()) {
          <section class="panel">
            <div class="panel-title"><h2>Payroll documents</h2><span>{{ documents().length }}</span></div>
            <div class="list compact-list">
              @for (document of documents(); track document.id) { <div class="row"><div class="row-main"><strong>{{ document.documentName || label(document.documentType) }}</strong><small>{{ label(document.documentType) }} · Added {{ document.createdAt | date:'dd/MM/yyyy' }}@if (document.expiryDate) { · Expires {{ displayDate(document.expiryDate) }} }</small></div><div class="row-actions"><button class="link-button" type="button" [disabled]="downloadingId() === document.id" (click)="downloadDocument(document)">{{ downloadingId() === document.id ? 'Opening...' : 'Download' }}</button></div></div> }
              @empty { <div class="payroll-empty"><p>No verified payroll documents.</p></div> }
            </div>
          </section>
        }
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
    .earnings-filter { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)) auto; align-items: end; gap: 10px; }
    .earnings-filter label, .dispute-form label { display: grid; gap: 6px; color: var(--staff-text-secondary); font-size: .72rem; font-weight: 700; }
    .earnings-filter select, .dispute-form textarea { width: 100%; min-height: 42px; border: 1px solid var(--staff-input-border); border-radius: 12px; padding: 9px 12px; background: var(--staff-input-background); color: var(--staff-input-text); font: inherit; }
    .compact-list .row { align-items: flex-start; }
    .compact-list .row-actions { align-items: flex-end; }
    .dispute-form { display: grid; gap: 10px; margin-top: 12px; padding: 12px; border: 1px solid var(--staff-border); border-radius: 12px; }
    .dispute-form textarea { min-height: 88px; resize: vertical; }
    .history-grid { display: grid; gap: 8px; margin-top: 10px; }
    .history-grid span { display: grid; gap: 3px; padding: 9px 10px; border: 1px solid var(--staff-border); border-radius: 10px; font-size: .78rem; overflow-wrap: anywhere; }
    @media (max-width: 700px) {
      .payroll-error, .payroll-row, .payroll-actions { align-items: stretch; flex-direction: column; }
      .payroll-error button, .payroll-actions .link-button { width: 100%; }
      .payroll-actions .badge, .payroll-actions .pill { width: fit-content; }
      .payroll-breakdown { grid-template-columns: 1fr; }
      .payroll-profile-grid { grid-template-columns: 1fr; }
      .earnings-filter { grid-template-columns: 1fr; }
      .compact-list .row-actions { align-items: stretch; }
    }
  `]
})
export class StaffPayrollPage implements OnInit {
  readonly currentYear = new Date().getFullYear();
  readonly payroll = signal<StaffPayrollItem[]>([]);
  readonly profile = signal<StaffPayrollProfile | null>(null);
  readonly earnings = signal<StaffEarningsDetail | null>(null);
  readonly documents = signal<StaffPayrollDocument[]>([]);
  readonly periodStart = signal(displayBusinessDate(`${businessDate().slice(0, 7)}-01`));
  readonly periodEnd = signal(displayBusinessDate(businessDate()));
  readonly basis = signal<"sale_date" | "close_date">("sale_date");
  readonly disputeSaleId = signal("");
  readonly disputePayoutId = signal("");
  readonly disputeReason = signal("");
  readonly disputeSaving = signal(false);
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
      this.earnings.set(null);
      this.documents.set([]);
      return;
    }
    if (silent) this.refreshing.set(true); else this.loading.set(true);
    this.loadError.set("");
    try {
      const overview = await this.staff.payrollOverview();
      this.payroll.set(overview.items);
      this.profile.set(overview.profile);
      const periodStart = parseDisplayBusinessDate(this.periodStart());
      const periodEnd = parseDisplayBusinessDate(this.periodEnd());
      if (!periodStart || !periodEnd || periodStart > periodEnd) throw new Error("Invalid earnings period.");
      const [earnings, documents] = await Promise.all([
        this.staff.earningsDetails(periodStart, periodEnd, this.basis()),
        this.canSeeDocuments() ? this.staff.payrollDocuments() : Promise.resolve([])
      ]);
      this.earnings.set(earnings);
      this.documents.set(documents);
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
  canSeeDocuments(): boolean { return this.staff.hasPermission("staff.app.payroll.documents.read"); }
  canDisputeTips(): boolean { return this.staff.hasPermission("staff.app.tips.dispute.manage"); }
  showDeductions(): boolean { return this.earnings()?.visibility.deductions ?? this.staff.hasPermission("staff.app.payroll.deductions.read"); }
  showEmployerCosts(): boolean { return this.earnings()?.visibility.costs ?? false; }
  ytdRows(): StaffPayrollItem[] { return this.payroll().filter((item) => Number(item.periodEnd.slice(0, 4)) === this.currentYear); }
  ytdGross(): number { return this.ytdRows().reduce((sum, item) => sum + item.grossPay, 0); }
  ytdDeductions(): number { return this.ytdRows().reduce((sum, item) => sum + item.deductionsPay, 0); }
  ytdNet(): number { return this.ytdRows().reduce((sum, item) => sum + item.netPay, 0); }
  ytdEmployer(): number { return this.ytdRows().reduce((sum, item) => sum + item.statutoryEmployerPay, 0); }

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

  selectTipDispute(saleId: string, payoutId: string) {
    this.disputeSaleId.set(saleId);
    this.disputePayoutId.set(payoutId);
    this.disputeReason.set("");
  }

  clearTipDispute() {
    this.disputeSaleId.set("");
    this.disputePayoutId.set("");
    this.disputeReason.set("");
  }

  async submitTipDispute() {
    const reason = this.disputeReason().trim();
    if (!this.canDisputeTips() || reason.length < 10 || this.disputeSaving()) return;
    this.disputeSaving.set(true);
    this.localError.set("");
    try {
      await this.staff.createTipDispute({ saleId: this.disputeSaleId() || undefined, payoutId: this.disputePayoutId() || undefined, reason });
      this.clearTipDispute();
      await this.load(true);
    } catch {
      this.localError.set(this.staff.error() || "Unable to submit tip dispute.");
    } finally {
      this.disputeSaving.set(false);
    }
  }

  async downloadDocument(document: StaffPayrollDocument) {
    if (!document.downloadPath || this.downloadingId()) return;
    this.downloadingId.set(document.id);
    this.localError.set("");
    try {
      await this.staff.downloadPayslip(document.downloadPath);
    } catch {
      this.localError.set(this.staff.error() || "Unable to open payroll document.");
    } finally {
      this.downloadingId.set("");
    }
  }
}
