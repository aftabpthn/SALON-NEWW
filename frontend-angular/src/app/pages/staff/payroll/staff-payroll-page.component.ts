import { LanguageService } from '../../../core/i18n/language.service';
import { CommonModule } from '@angular/common';
import { TranslatePipe } from '../../../shared/pipes/translate.pipe';
import { Component, inject, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { AuthService } from '../../../core/services/auth.service';
import { ApiEnvelope, ApiService } from '../../../shared/services/api.service';
import { DatePickerComponent } from '../../../shared/date-picker/date-picker.component';
import { StaffPayrollSetupComponent } from './staff-payroll-setup.component';

type PayrollTab = 'summary' | 'detail' | 'history' | 'setup';
type SetupSection = 'structure' | 'adjustments' | 'incentives' | 'statutory' | 'revisions' | 'advances' | 'overtime' | 'period' | 'notifications';
type PayrollColumn = 'attendance' | 'payrate' | 'commission' | 'adjustments' | 'gross' | 'net' | 'validation' | 'status';
type SalaryMode = 'preview' | 'generate' | 'history';
type StaffOption = { id: string; firstName: string; lastName: string; appointmentDisplayName: string; jobTitle?: string | null; branchId?: string | null };
type StaffListPage = { items: StaffOption[] };

type PayrollItem = {
  id?: string;
  staffId: string;
  staffName: string;
  employeeCode?: string | null;
  payRateType?: string | null;
  payRatePaise?: number | null;
  attendanceDaysX2: number;
  paidLeaveDaysX2: number;
  weeklyOffDaysX2: number;
  holidayDaysX2: number;
  workedMinutes: number;
  overtimeMinutes: number;
  earnedSalaryPaise: number;
  overtimePaise: number;
  commissionPaise: number;
  adjustmentPaise: number;
  penaltyPaise: number;
  grossPaise: number;
  deductionsPaise: number;
  netPaise: number;
  validationErrors: string[];
  validationWarnings: string[];
  calculationJson: Record<string, unknown>;
  notes: string;
  status: string;
};

type PayrollRun = {
  id: string;
  cycle: string;
  periodStart: string;
  periodEnd: string;
  status: string;
  grossPaise: number;
  deductionsPaise: number;
  netPaise: number;
  staffCount: number;
  invalidCount: number;
  createdAt: string;
  updatedAt?: string | null;
  reviewedAt?: string | null;
  finalizedAt?: string | null;
  paidAt?: string | null;
  branchId?: string;
  branchName?: string;
  paymentMethod?: string;
  paymentReference?: string;
};
type PayrollHistoryPage = { items: PayrollRun[]; total: number; page: number; pageSize: number };

type PayrollEvent = { id: string; eventType: string; actorUserId: string; payloadJson: unknown; createdAt: string };
type PayrollRunDetail = { run: PayrollRun; items: PayrollItem[]; events: PayrollEvent[]; salaryRows?: Record<string, unknown>[] };
type PayrollCorrection = {
  id: string;
  originalRunId: string;
  staffId: string;
  correctionType: 'arrear' | 'recovery';
  amountPaise: number;
  reason: string;
  status: 'pending' | 'rejected' | 'approved' | 'posted' | 'cancelled';
  requestedBy: string;
  decidedBy?: string | null;
  decidedAt?: string | null;
  decisionNote: string;
  paymentMethod?: string | null;
  paymentReference: string;
  postedBy?: string | null;
  postedAt?: string | null;
  version: number;
  createdAt: string;
};
type PayrollCorrectionEvent = { id: string; eventType: string; actorUserId: string; payloadJson: unknown; createdAt: string };
type PayrollCorrectionDetail = { correction: PayrollCorrection; events: PayrollCorrectionEvent[] };
type PayrollPayoutState = {
  stateId?: string | null;
  payrollItemId: string;
  staffId: string;
  staffName: string;
  employeeCode?: string | null;
  grossPaise: number;
  netPaise: number;
  status: 'pending' | 'held' | 'processing' | 'failed' | 'paid';
  paymentMethod: string;
  reference: string;
  holdReason: string;
  lastError: string;
  attemptCount: number;
  paidAt?: string | null;
};
type PayrollPayoutReconciliation = {
  runStatus: string;
  staffCount: number;
  paidCount: number;
  heldCount: number;
  failedCount: number;
  processingCount: number;
  pendingCount: number;
  totalPaise: number;
  paidPaise: number;
  outstandingPaise: number;
  balanced: boolean;
  items: PayrollPayoutState[];
};
type StaffHoliday = { id: string; holidayDate: string; name: string; isPaid: boolean; active: boolean };
type WeekendRuleEvent = { date?: string; rule?: string; beforeDate?: string; afterDate?: string; triggeringDate?: string };
type AutoAdjustmentRow = { name?: string; triggerType?: string; occurrences?: number; amountPaise?: number; kind?: string };
type PayrollPreview = {
  cycle: string;
  periodStart: string;
  periodEnd: string;
  staffCount: number;
  invalidCount: number;
  grossPaise: number;
  deductionsPaise: number;
  netPaise: number;
  items: PayrollItem[];
  salaryRows?: Record<string, unknown>[];
};

@Component({
    selector: 'page-staff-payroll',
    imports: [CommonModule, FormsModule, DatePickerComponent, TranslatePipe, StaffPayrollSetupComponent],
    templateUrl: './staff-payroll-page.component.html',
    styleUrls: ['./staff-payroll-page.component.css']
})
export class StaffPayrollPageComponent implements OnInit {
  private readonly language = inject(LanguageService);
  private readonly api = inject(ApiService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly auth = inject(AuthService);

  readonly tabs: Array<{ key: PayrollTab; label: string; icon: string }> = [
    { key: 'summary', label: 'Summary', icon: 'bi-layout-text-window-reverse' },
    { key: 'detail', label: 'Detail', icon: 'bi-table' },
    { key: 'history', label: 'History', icon: 'bi-clock-history' },
    { key: 'setup', label: 'Setup', icon: 'bi-sliders' },
  ];
  private readonly setupSections: SetupSection[] = ['structure', 'adjustments', 'incentives', 'statutory', 'revisions', 'advances', 'overtime', 'period', 'notifications'];
  readonly columns: Array<{ key: PayrollColumn; label: string }> = [
    { key: 'attendance', label: 'Attendance' }, { key: 'payrate', label: 'Payrate' },
    { key: 'commission', label: 'Commission' }, { key: 'adjustments', label: 'Adjustments' },
    { key: 'gross', label: 'Gross pay' }, { key: 'net', label: 'Net pay' },
    { key: 'validation', label: 'Validation' }, { key: 'status', label: 'Status' },
  ];
  readonly visibleColumns: Record<PayrollColumn, boolean> = {
    attendance: true, payrate: true, commission: true, adjustments: true,
    gross: true, net: true, validation: true, status: true,
  };
  readonly months = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
  ];
  readonly years: number[];

  activeTab: PayrollTab = 'summary';
  setupSection: SetupSection = 'structure';
  setupCreateAdjustment = false;
  setupAdjustmentKind: 'fine' | 'allowance' | 'deduction' = 'deduction';
  cycle = 'monthly';
  salaryMode: SalaryMode = 'preview';
  month = new Date().getMonth() + 1;
  year = new Date().getFullYear();
  staffId = '';
  category = '';
  staff: StaffOption[] = [];
  history: PayrollRun[] = [];
  private periodRuns: PayrollRun[] = [];
  historyTotal = 0;
  historyPage = 1;
  readonly historyPageSize = 25;
  historyPeriod: 'all' | 'month' | 'range' = 'all';
  historyMonth = new Date().getMonth() + 1;
  historyYear = new Date().getFullYear();
  historyFrom = '';
  historyTo = '';
  historyStaffId = '';
  historyCategory = '';
  historyStatus = '';
  historyValidationState = '';
  historyPaymentMethod = '';
  historySearch = '';
  historyScope: 'branch' | 'tenant' = 'branch';
  private runBranchId = '';
  run: PayrollRun | null = null;
  items: PayrollItem[] = [];
  salaryRows: Record<string, unknown>[] = [];
  events: PayrollEvent[] = [];
  selectedItem: PayrollItem | null = null;
  correctionDrawerOpen = false;
  corrections: PayrollCorrection[] = [];
  selectedCorrection: PayrollCorrection | null = null;
  correctionEvents: PayrollCorrectionEvent[] = [];
  correctionStaffId = '';
  correctionType: 'arrear' | 'recovery' = 'arrear';
  correctionAmount = '';
  correctionReason = '';
  correctionDecisionNote = '';
  correctionPaymentMethod = '';
  correctionPaymentReference = '';
  correctionMfaCode = '';
  correctionPostingKey = crypto.randomUUID();
  adjustmentInputs: Record<string, string> = {};
  noteInputs: Record<string, string> = {};
  loading = false;
  action = '';
  error = '';
  success = '';
  columnMenuOpen = false;
  logOpen = false;
  lastChecked = '';
  payoutMethod = '';
  payoutReference = '';
  actionMfaCode = '';
  payoutKey = crypto.randomUUID();
  payoutDrawerOpen = false;
  payoutReconciliation: PayrollPayoutReconciliation | null = null;
  payoutSelected: Record<string, boolean> = {};
  payoutReferences: Record<string, string> = {};
  payoutHoldReason = '';
  holidays: StaffHoliday[] = [];
  holidayOpen = false;
  holidayDate = '';
  holidayName = '';
  holidayPaid = true;

  regenerateDialogOpen = false;
  regenerateReason = '';
  regenerateBefore: PayrollItem | null = null;
  regenerateAfter: PayrollItem | null = null;
  private regenerateAfterSalaryRows: Record<string, unknown>[] = [];
  private existingPeriodRun: PayrollRun | null = null;
  private existingPeriodItems: PayrollItem[] = [];
  private existingPeriodSalaryRows: Record<string, unknown>[] = [];

  constructor() {
    const currentYear = new Date().getFullYear();
    this.years = Array.from({ length: 7 }, (_, index) => currentYear - 3 + index);
  }

  async ngOnInit() {
    const tab = this.route.snapshot.queryParamMap.get('tab');
    const section = this.route.snapshot.queryParamMap.get('section');
    if (this.tabs.some((item) => item.key === tab)) this.activeTab = tab as PayrollTab;
    if (this.isSetupSection(section)) this.setupSection = section;
    if (this.route.snapshot.queryParamMap.get('kind') === 'fine') this.setupAdjustmentKind = 'fine';
    this.setupCreateAdjustment = this.route.snapshot.queryParamMap.has('create');
    await Promise.all([this.loadStaff(), this.loadHistory(), this.loadHolidays()]);
    await this.loadPeriod();
  }

  async selectTab(tab: PayrollTab) {
    this.activeTab = tab;
    await this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { tab, ...(tab === 'setup' ? { section: this.setupSection } : {}) },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
    if (tab === 'history') await this.loadHistory();
  }

  private isSetupSection(section: string | null): section is SetupSection {
    return this.setupSections.includes(section as SetupSection);
  }

  get invalidCount() { return this.items.filter((item) => item.validationErrors.length > 0).length; }
  get warningCount() { return this.items.filter((item) => item.validationWarnings.length > 0).length; }
  get grossTotal() { return this.run?.grossPaise ?? this.items.reduce((sum, item) => sum + item.grossPaise, 0); }
  get deductionTotal() { return this.run?.deductionsPaise ?? this.items.reduce((sum, item) => sum + item.deductionsPaise, 0); }
  get netTotal() { return this.run?.netPaise ?? this.items.reduce((sum, item) => sum + item.netPaise, 0); }
  get canPrintPayslips() { return Boolean(this.run && ['finalized', 'partially_paid', 'paid'].includes(this.run.status)); }
  get currentUserId() { return this.auth.userId; }
  get canViewPayouts() { return Boolean(this.run && ['finalized', 'partially_paid', 'paid'].includes(this.run.status) && this.runBranchId === this.auth.branchId); }
  get canManageCorrections() { return this.run?.status === 'paid' && this.runBranchId === this.auth.branchId; }
  get canRequestCorrection() {
    return this.canManageCorrections && Boolean(this.correctionStaffId && this.toPaise(this.correctionAmount) > 0 && this.correctionReason.trim()) && !this.loading;
  }
  get canApproveCorrection() {
    return this.selectedCorrection?.status === 'pending'
      && this.selectedCorrection.requestedBy !== this.auth.userId
      && Boolean(this.correctionMfaCode.trim())
      && !this.loading;
  }
  get canPostCorrection() {
    if (this.selectedCorrection?.status !== 'approved' || !this.correctionMfaCode.trim() || this.loading) return false;
    return this.selectedCorrection.correctionType !== 'arrear' || Boolean(this.correctionPaymentMethod);
  }
  get currentStep() {
    if (!this.run) return this.items.length ? 1 : 0;
    return ({ calculated: 1, reviewed: 2, finalized: 3, partially_paid: 3, paid: 4 } as Record<string, number>)[this.run.status] ?? 0;
  }
  get workflowLabel() {
    if (!this.run) return 'Review & finalize';
    if (this.run.status === 'calculated') return 'Send for review';
    if (this.run.status === 'reviewed') return 'Finalize payroll';
    if (this.run.status === 'finalized') return 'Record payout';
    if (this.run.status === 'partially_paid') return 'Continue payout';
    return 'Payroll paid';
  }
  get workflowIcon() {
    return this.run?.status === 'finalized' ? 'bi-check2-circle' : 'bi-shield-check';
  }
  get isStaffOsSalaryGenerate() { return Boolean(this.route.snapshot.data['staffOsSalaryGenerate']) || this.router.url.includes('/staff-os/'); }
  get pageTitle() { return this.isStaffOsSalaryGenerate ? 'Salary Generate' : 'Employee Payroll'; }
  get backLabel() { return this.isStaffOsSalaryGenerate ? 'Staff OS' : 'Back to staff'; }
  get branchLabel() { return this.auth.branchName || 'Current branch'; }
  get categoryOptions() {
    return [...new Set(this.staff.map((row) => (row.jobTitle || '').trim()).filter(Boolean))].sort();
  }
  get historyPageCount() { return Math.max(1, Math.ceil(this.historyTotal / this.historyPageSize)); }
  get filteredItems() {
    if (!this.category) return this.items;
    return this.items.filter((item) => this.itemCategory(item) === this.category);
  }
  get selectedSalaryRow() { return this.selectedItem ? this.salaryRow(this.selectedItem) : null; }
  get canSaveDraft() { return this.run?.status === 'calculated' && this.runBranchId === this.auth.branchId && !this.loading; }
  get canRegenerateSelected() {
    return Boolean(this.staffId && this.existingPeriodRun)
      && !this.loading
      && ['calculated', 'reviewed'].includes(this.existingPeriodRun!.status);
  }
  get generationLocked() {
    return Boolean(this.staffId && this.existingPeriodRun && ['finalized', 'partially_paid', 'paid'].includes(this.existingPeriodRun.status));
  }
  get runActionDisabled() { return this.loading || (this.salaryMode === 'generate' && this.generationLocked); }
  get primaryActionLabel() {
    if (this.action === 'run' || this.action === 'regenerate') return 'Running...';
    if (this.salaryMode === 'history') return 'Load list';
    if (this.salaryMode === 'preview') return 'Preview salary';
    if (this.generationLocked) return 'Payroll locked';
    if (this.staffId && this.existingPeriodRun) return 'Regenerate selected staff';
    if (this.staffId) return 'Generate selected staff';
    return 'Generate salary';
  }
  get canConfirmRegenerate() { return this.canRegenerateSelected && Boolean(this.regenerateReason.trim()) && !this.loading; }
  get regenerateRows() {
    if (!this.regenerateAfter) return [];
    const before = this.regenerateBefore;
    const after = this.regenerateAfter;
    const beforeTips = before ? this.tipsPaiseOf(before, this.existingPeriodSalaryRows) : null;
    const afterTips = this.tipsPaiseOf(after, this.regenerateAfterSalaryRows);
    return [
      this.diffRow('Attendance days', before?.attendanceDaysX2 ?? null, after.attendanceDaysX2, 'days'),
      this.diffRow('Paid leave days', before?.paidLeaveDaysX2 ?? null, after.paidLeaveDaysX2, 'days'),
      this.diffRow('Weekly off days', before?.weeklyOffDaysX2 ?? null, after.weeklyOffDaysX2, 'days'),
      this.diffRow('Holiday days', before?.holidayDaysX2 ?? null, after.holidayDaysX2, 'days'),
      this.diffRow('Worked minutes', before?.workedMinutes ?? null, after.workedMinutes, 'minutes'),
      this.diffRow('Overtime minutes', before?.overtimeMinutes ?? null, after.overtimeMinutes, 'minutes'),
      this.diffRow('Earned salary', before?.earnedSalaryPaise ?? null, after.earnedSalaryPaise, 'money'),
      this.diffRow('Overtime pay', before?.overtimePaise ?? null, after.overtimePaise, 'money'),
      this.diffRow('Commission', before?.commissionPaise ?? null, after.commissionPaise, 'money'),
      this.diffRow('Tips', beforeTips, afterTips, 'money'),
      this.diffRow('Adjustment', before?.adjustmentPaise ?? null, after.adjustmentPaise, 'money'),
      this.diffRow('Deductions', before?.deductionsPaise ?? null, after.deductionsPaise, 'money'),
      this.diffRow('Gross pay', before?.grossPaise ?? null, after.grossPaise, 'money'),
      this.diffRow('Net pay', before?.netPaise ?? null, after.netPaise, 'money'),
    ];
  }
  get canAdvance() {
    if (!this.run || this.runBranchId !== this.auth.branchId || this.invalidCount > 0 || !['calculated', 'reviewed', 'finalized', 'partially_paid'].includes(this.run.status) || this.loading) return false;
    if (this.run.status === 'calculated') return true;
    if (['finalized', 'partially_paid'].includes(this.run.status)) return true;
    return Boolean(this.actionMfaCode.trim());
  }
  get selectedPayoutItems() { return (this.payoutReconciliation?.items || []).filter((item) => this.payoutSelected[item.staffId]); }
  get payoutPayStaffIds() { return this.selectedPayoutItems.filter((item) => ['pending', 'failed'].includes(item.status)).map((item) => item.staffId); }
  get payoutHoldStaffIds() { return this.selectedPayoutItems.filter((item) => ['pending', 'failed'].includes(item.status)).map((item) => item.staffId); }
  get payoutReleaseStaffIds() { return this.selectedPayoutItems.filter((item) => item.status === 'held').map((item) => item.staffId); }
  get canPaySelected() {
    if (!this.payoutPayStaffIds.length || !this.payoutMethod || !this.actionMfaCode.trim() || this.loading) return false;
    return !['upi', 'other'].includes(this.payoutMethod)
      || this.payoutPayStaffIds.every((id) => Boolean((this.payoutReferences[id] || this.payoutReference).trim()));
  }
  get canHoldSelected() { return Boolean(this.payoutHoldStaffIds.length && this.payoutHoldReason.trim() && this.actionMfaCode.trim() && !this.loading); }
  get canReleaseSelected() { return Boolean(this.payoutReleaseStaffIds.length && this.actionMfaCode.trim() && !this.loading); }

  isVisible(column: PayrollColumn) { return this.visibleColumns[column]; }
  toggleColumn(column: PayrollColumn) {
    if (this.visibleColumns[column] || Object.values(this.visibleColumns).filter(Boolean).length > 1) {
      this.visibleColumns[column] = !this.visibleColumns[column];
    }
  }

  async changePeriod() {
    this.success = '';
    await Promise.all([this.loadPeriod(), this.loadHolidays()]);
  }

  async changeMode() {
    if (this.salaryMode === 'history') this.activeTab = 'history';
    else this.activeTab = this.salaryMode === 'generate' ? 'detail' : 'summary';
  }

  async refresh() {
    this.success = '';
    await Promise.all([this.loadHistory(), this.loadHolidays()]);
    await this.loadPeriod();
  }

  async checkSourceData(calculateCommissions = false) {
    await this.perform(calculateCommissions ? 'commissions' : 'checking', async () => {
      const path = calculateCommissions ? '/staff-payroll/commissions/calculate' : '/staff-payroll/preview';
      const request = calculateCommissions
        ? this.api.post<ApiEnvelope<PayrollPreview>>(`${path}?${this.periodParams()}`, {})
        : this.api.get<ApiEnvelope<PayrollPreview>>(`${path}?${this.periodParams()}`);
      const result = await firstValueFrom(request);
      const preview = this.unwrap(result, 'Unable to check payroll source data');
      this.applyPreview(preview);
      this.lastChecked = new Date().toISOString();
      this.success = calculateCommissions ? 'Commissions recalculated from saved sales' : '';
    });
  }

  async runPayroll() {
    await this.perform('run', async () => {
      const result = await firstValueFrom(this.api.post<ApiEnvelope<PayrollRunDetail>>('/staff-payroll/runs', {
        cycle: this.cycle, year: this.year, month: this.month, staffId: this.staffId || null,
      }));
      this.applyDetail(this.unwrap(result, 'Unable to run payroll'));
      await this.loadHistory();
      this.success = 'Payroll draft calculated and saved';
    });
  }

  async runSelectedMode() {
    if (this.salaryMode === 'history') { this.activeTab = 'history'; await this.loadHistory(); return; }
    if (this.salaryMode === 'generate') {
      if (this.generationLocked) { this.error = 'Finalized or paid payroll cannot be regenerated'; return; }
      if (this.staffId && this.existingPeriodRun) { await this.openRegenerateDialog(); return; }
      await this.runPayroll();
      return;
    }
    await this.checkSourceData(false);
  }

  async openRegenerateDialog() {
    if (!this.canRegenerateSelected) return;
    this.regenerateReason = '';
    await this.perform('regenerate-preview', async () => {
      const result = await firstValueFrom(this.api.get<ApiEnvelope<PayrollPreview>>(`/staff-payroll/preview?${this.periodParams()}`));
      const preview = this.unwrap(result, 'Unable to load regeneration preview');
      const after = preview.items.find((item) => item.staffId === this.staffId) || null;
      if (!after) { this.error = 'No source data found for the selected employee'; return; }
      this.regenerateAfter = after;
      this.regenerateAfterSalaryRows = preview.salaryRows || [];
      this.regenerateBefore = this.existingPeriodItems.find((item) => item.staffId === this.staffId) || null;
      this.regenerateDialogOpen = true;
    });
  }

  closeRegenerateDialog() {
    this.regenerateDialogOpen = false;
    this.regenerateReason = '';
    this.regenerateBefore = null;
    this.regenerateAfter = null;
    this.regenerateAfterSalaryRows = [];
  }

  async confirmRegenerateSelected() {
    if (!this.canConfirmRegenerate) return;
    await this.perform('regenerate', async () => {
      const result = await firstValueFrom(this.api.post<ApiEnvelope<PayrollRunDetail>>('/staff-payroll/runs', {
        cycle: this.cycle, year: this.year, month: this.month, staffId: this.staffId, reason: this.regenerateReason.trim(),
      }));
      this.applyDetail(this.unwrap(result, 'Unable to regenerate selected staff'));
      await this.loadHistory();
      this.success = 'Selected staff payroll regenerated';
      this.closeRegenerateDialog();
    });
  }

  private tipsPaiseOf(item: PayrollItem, rows: Record<string, unknown>[]) {
    const row = rows.find((candidate) => candidate['staffId'] === item.staffId)
      || (item.calculationJson?.['salaryRow'] as Record<string, unknown> | undefined)
      || {};
    return Number(row['tipsPaise'] || 0);
  }

  private diffRow(label: string, before: number | null, after: number, kind: 'money' | 'minutes' | 'days'): [string, string, string, string] {
    const format = (value: number) => kind === 'money' ? this.formatMoney(value) : kind === 'days' ? this.days(value) : String(value);
    const beforeValue = before ?? 0;
    const rawDelta = kind === 'days' ? (after - beforeValue) / 2 : after - beforeValue;
    const sign = rawDelta > 0 ? '+' : '';
    const deltaText = kind === 'money'
      ? `${sign}${this.formatMoney(after - beforeValue)}`
      : `${sign}${kind === 'days' ? rawDelta.toFixed(1).replace(/\.0$/, '') : rawDelta}`;
    return [label, before === null ? 'Not in run' : format(before), format(after), deltaText];
  }

  async saveDraft() {
    if (!this.run) return;
    await this.perform('save', async () => {
      const entries = this.items.map((item) => ({
        staffId: item.staffId,
        adjustmentPaise: this.toPaise(this.adjustmentInputs[item.staffId]),
        notes: (this.noteInputs[item.staffId] || '').trim(),
      }));
      const result = await firstValueFrom(this.api.put<ApiEnvelope<PayrollRunDetail>>(`/staff-payroll/runs/${this.run!.id}`, { entries }));
      this.applyDetail(this.unwrap(result, 'Unable to save payroll draft'));
      await this.loadHistory();
      this.success = 'Payroll draft saved';
    });
  }

  async advanceWorkflow() {
    if (!this.run || !this.canAdvance) return;
    if (['finalized', 'partially_paid'].includes(this.run.status)) { await this.openPayouts(); return; }
    const action = this.run.status === 'calculated' ? 'review' : this.run.status === 'reviewed' ? 'finalize' : 'payout';
    await this.perform(action, async () => {
      const payload = action === 'payout'
        ? { paymentMethod: this.payoutMethod, reference: this.payoutReference.trim(), idempotencyKey: this.payoutKey, mfaCode: this.actionMfaCode.trim() }
        : action === 'finalize' ? { mfaCode: this.actionMfaCode.trim() } : {};
      const result = await firstValueFrom(this.api.post<ApiEnvelope<PayrollRunDetail>>(`/staff-payroll/runs/${this.run!.id}/${action}`, payload));
      this.applyDetail(this.unwrap(result, 'Unable to update payroll status'));
      await this.loadHistory();
      this.success = `Payroll ${this.run!.status}`;
      this.actionMfaCode = '';
    });
  }

  async openHistoryRun(run: PayrollRun) {
    this.month = Number(run.periodStart.slice(5, 7));
    this.year = Number(run.periodStart.slice(0, 4));
    this.staffId = '';
    await this.loadRun(run.id, run.branchId || this.auth.branchId || '');
    this.activeTab = 'summary';
  }

  async applyHistoryFilters() {
    this.historyPage = 1;
    await this.loadHistory();
  }

  async clearHistoryFilters() {
    this.historyPeriod = 'all';
    this.historyFrom = '';
    this.historyTo = '';
    this.historyStaffId = '';
    this.historyCategory = '';
    this.historyStatus = '';
    this.historyValidationState = '';
    this.historyPaymentMethod = '';
    this.historySearch = '';
    this.historyScope = 'branch';
    await this.applyHistoryFilters();
  }

  async changeHistoryPage(page: number) {
    if (page < 1 || page > this.historyPageCount || page === this.historyPage) return;
    this.historyPage = page;
    await this.loadHistory();
  }

  async exportHistory() {
    await this.download(`/staff-payroll/history/export?${this.historyParams(false)}`, 'payroll-history.csv');
  }

  async exportCsv() {
    if (!this.run) {
      if (!this.filteredItems.length) { this.error = this.language.text('staff.message.e86a1c430a'); return; }
      this.downloadText(this.previewCsv(), `salary-preview-${this.year}-${String(this.month).padStart(2, '0')}.csv`);
      return;
    }
    await this.download(`/staff-payroll/runs/${this.run.id}/export?${this.runBranchParams()}`, `payroll-${this.run.periodStart}-${this.run.periodEnd}.csv`);
  }

  async printPayslip(item: PayrollItem) {
    if (!this.run || !['finalized', 'partially_paid', 'paid'].includes(this.run.status)) return;
    await this.download(`/staff-payroll/runs/${this.run.id}/payslips/${item.staffId}?${this.runBranchParams()}`, `payslip-${item.staffName}.pdf`);
  }

  async openPayouts() {
    if (!this.canViewPayouts) return;
    this.closeStaffDetail();
    this.closeCorrections();
    this.payoutDrawerOpen = true;
    await this.perform('payout-load', () => this.loadPayouts());
  }

  closePayouts() {
    this.payoutDrawerOpen = false;
    this.payoutReconciliation = null;
    this.payoutSelected = {};
    this.payoutReferences = {};
    this.payoutHoldReason = '';
    this.payoutMethod = '';
    this.payoutReference = '';
    this.actionMfaCode = '';
  }

  toggleAllPayouts(checked: boolean) {
    for (const item of this.payoutReconciliation?.items || []) this.payoutSelected[item.staffId] = checked && item.status !== 'paid' && item.status !== 'processing';
  }

  async paySelectedStaff() {
    if (!this.run || !this.canPaySelected) return;
    await this.perform('payout-staff', async () => {
      const references = Object.fromEntries(this.payoutPayStaffIds.map((id) => [id, (this.payoutReferences[id] || '').trim()]).filter(([, value]) => value));
      const result = await firstValueFrom(this.api.post<ApiEnvelope<PayrollRunDetail>>(`/staff-payroll/runs/${this.run!.id}/payout`, {
        paymentMethod: this.payoutMethod,
        reference: this.payoutReference.trim() || null,
        idempotencyKey: this.payoutKey,
        mfaCode: this.actionMfaCode.trim(),
        staffIds: this.payoutPayStaffIds,
        staffReferences: references,
      }));
      this.applyDetail(this.unwrap(result, 'Unable to record staff payouts'));
      this.payoutKey = crypto.randomUUID();
      this.actionMfaCode = '';
      await Promise.all([this.loadPayouts(), this.loadHistory()]);
      this.success = this.payoutReconciliation?.failedCount ? 'Payout completed with failed staff payments' : 'Selected staff payouts recorded';
    });
  }

  async holdSelectedPayouts() {
    if (!this.run || !this.canHoldSelected) return;
    await this.perform('payout-hold', async () => {
      const result = await firstValueFrom(this.api.post<ApiEnvelope<PayrollPayoutReconciliation>>(`/staff-payroll/runs/${this.run!.id}/payouts/hold`, {
        staffIds: this.payoutHoldStaffIds,
        reason: this.payoutHoldReason.trim(),
        mfaCode: this.actionMfaCode.trim(),
      }));
      this.payoutReconciliation = this.unwrap(result, 'Unable to hold staff payouts');
      this.applyDetail(await this.fetchRunDetail(this.run!.id, this.runBranchId));
      this.payoutHoldReason = '';
      this.actionMfaCode = '';
      this.payoutSelected = {};
      await this.loadHistory();
      this.success = 'Selected staff payouts held';
    });
  }

  async releaseSelectedPayouts() {
    if (!this.run || !this.canReleaseSelected) return;
    await this.perform('payout-release', async () => {
      const result = await firstValueFrom(this.api.post<ApiEnvelope<PayrollPayoutReconciliation>>(`/staff-payroll/runs/${this.run!.id}/payouts/release`, {
        staffIds: this.payoutReleaseStaffIds,
        mfaCode: this.actionMfaCode.trim(),
      }));
      this.payoutReconciliation = this.unwrap(result, 'Unable to release payout holds');
      this.applyDetail(await this.fetchRunDetail(this.run!.id, this.runBranchId));
      this.actionMfaCode = '';
      this.payoutSelected = {};
      await this.loadHistory();
      this.success = 'Selected payout holds released';
    });
  }

  async printCorrectedPayslip(correction: PayrollCorrection | null) {
    if (!this.run || !correction || correction.status !== 'posted') return;
    await this.download(
      `/staff-payroll/runs/${this.run.id}/payslips/${correction.staffId}?${this.runBranchParams()}&corrected=true`,
      `corrected-payslip-${this.correctionStaffName(correction.staffId)}.pdf`,
    );
  }

  async openCorrections() {
    if (!this.canManageCorrections || !this.run) return;
    this.closeStaffDetail();
    this.closePayouts();
    this.correctionDrawerOpen = true;
    this.selectedCorrection = null;
    this.correctionEvents = [];
    await this.perform('correction-load', () => this.refreshCorrections());
  }

  closeCorrections() {
    this.correctionDrawerOpen = false;
    this.corrections = [];
    this.selectedCorrection = null;
    this.correctionEvents = [];
    this.resetCorrectionAction();
  }

  async requestCorrection() {
    if (!this.run || !this.canRequestCorrection) return;
    await this.perform('correction-request', async () => {
      const result = await firstValueFrom(this.api.post<ApiEnvelope<PayrollCorrection>>(`/staff-payroll/runs/${this.run!.id}/corrections`, {
        staffId: this.correctionStaffId,
        correctionType: this.correctionType,
        amountPaise: this.toPaise(this.correctionAmount),
        reason: this.correctionReason.trim(),
      }));
      const created = this.unwrap(result, 'Unable to request payroll correction');
      this.correctionAmount = '';
      this.correctionReason = '';
      await this.refreshCorrections(created.id);
      this.success = 'Payroll correction requested';
    });
  }

  async selectCorrection(correction: PayrollCorrection) {
    await this.perform('correction-load', () => this.refreshCorrections(correction.id));
  }

  async decideCorrection(decision: 'approved' | 'rejected') {
    if (!this.selectedCorrection || (decision === 'approved' && !this.canApproveCorrection)) return;
    await this.perform(`correction-${decision}`, async () => {
      const result = await firstValueFrom(this.api.post<ApiEnvelope<PayrollCorrection>>(`/staff-payroll/corrections/${this.selectedCorrection!.id}/decision`, {
        version: this.selectedCorrection!.version,
        decision,
        note: this.correctionDecisionNote.trim() || null,
        mfaCode: decision === 'approved' ? this.correctionMfaCode.trim() : null,
      }));
      const updated = this.unwrap(result, 'Unable to decide payroll correction');
      this.resetCorrectionAction();
      await this.refreshCorrections(updated.id);
      this.success = `Payroll correction ${decision}`;
    });
  }

  async cancelCorrection() {
    if (!this.selectedCorrection || !['pending', 'approved'].includes(this.selectedCorrection.status)) return;
    await this.perform('correction-cancel', async () => {
      const result = await firstValueFrom(this.api.post<ApiEnvelope<PayrollCorrection>>(`/staff-payroll/corrections/${this.selectedCorrection!.id}/cancel`, {
        version: this.selectedCorrection!.version,
      }));
      const updated = this.unwrap(result, 'Unable to cancel payroll correction');
      this.resetCorrectionAction();
      await this.refreshCorrections(updated.id);
      this.success = 'Payroll correction cancelled';
    });
  }

  async postCorrection() {
    if (!this.selectedCorrection || !this.canPostCorrection) return;
    await this.perform('correction-post', async () => {
      const result = await firstValueFrom(this.api.post<ApiEnvelope<PayrollCorrection>>(`/staff-payroll/corrections/${this.selectedCorrection!.id}/post`, {
        version: this.selectedCorrection!.version,
        paymentMethod: this.selectedCorrection!.correctionType === 'arrear' ? this.correctionPaymentMethod : null,
        reference: this.correctionPaymentReference.trim() || null,
        idempotencyKey: this.correctionPostingKey,
        mfaCode: this.correctionMfaCode.trim(),
      }));
      const updated = this.unwrap(result, 'Unable to post payroll correction');
      this.resetCorrectionAction();
      await this.refreshCorrections(updated.id);
      this.success = 'Payroll correction posted';
    });
  }

  correctionStaffName(staffId: string) {
    return this.items.find((item) => item.staffId === staffId)?.staffName
      || this.staff.find((item) => item.id === staffId)?.appointmentDisplayName
      || 'Employee';
  }

  async saveHoliday() {
    if (!this.holidayDate || !this.holidayName.trim()) return;
    await this.perform('holiday', async () => {
      const result = await firstValueFrom(this.api.post<ApiEnvelope<StaffHoliday>>('/staff-payroll/holidays', {
        holidayDate: this.holidayDate,
        name: this.holidayName.trim(),
        isPaid: this.holidayPaid,
      }));
      this.unwrap(result, 'Unable to save holiday');
      this.holidayDate = '';
      this.holidayName = '';
      await this.loadHolidays();
      this.success = 'Holiday saved';
    });
  }

  async deleteHoliday(id: string) {
    await this.perform('holiday', async () => {
      const result = await firstValueFrom(this.api.delete<ApiEnvelope<unknown>>(`/staff-payroll/holidays/${id}`));
      this.unwrap(result, 'Unable to delete holiday');
      await this.loadHolidays();
      this.success = 'Holiday removed';
    });
  }

  formatMoney(paise: number | null | undefined) {
    if (paise === null || paise === undefined || !Number.isFinite(paise)) return '—';
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(paise / 100);
  }
  formatDate(value: string | null | undefined) {
    if (!value) return '—';
    const date = value.slice(0, 10).split('-');
    return date.length === 3 ? `${date[2]}/${date[1]}/${date[0]}` : value;
  }
  days(valueX2: number) { return valueX2 % 2 ? (valueX2 / 2).toFixed(1) : String(valueX2 / 2); }
  staffLabel(employee: StaffOption) {
    return `${employee.firstName || employee.appointmentDisplayName || ''} ${employee.lastName || ''}`.trim();
  }
  statusLabel(status: string) { return status.replace('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase()); }
  titleCase(value: string) { return value.toLowerCase().replace(/(^|\s)\S/g, (letter) => letter.toUpperCase()); }
  displayJson(value: unknown) { return JSON.stringify(value || {}, null, 2); }
  backToStaff() { void this.router.navigate([this.isStaffOsSalaryGenerate ? '/staff-os/salary-history' : '/staff']); }
  openStaffDetail(item: PayrollItem) { this.selectedItem = item; }
  closeStaffDetail() { this.selectedItem = null; }
  salaryRow(item: PayrollItem) {
    return this.salaryRows.find((row) => row['staffId'] === item.staffId)
      || (item.calculationJson?.['salaryRow'] as Record<string, unknown> | undefined)
      || {};
  }
  detailRows(item: PayrollItem | null) {
    if (!item) return [];
    const row = this.salaryRow(item);
    return [
      ['Payable days', this.days(Number(row['payableDaysX2'] || item.attendanceDaysX2 + item.paidLeaveDaysX2 + item.weeklyOffDaysX2 + item.holidayDaysX2))],
      ['Paid weekly off', this.days(Number(row['paidWeeklyOffDaysX2'] || 0))],
      ['Unpaid weekly off', this.days(Number(row['unpaidWeeklyOffDaysX2'] || 0))],
      ['Worked minutes', row['workedMinutes'] ?? item.workedMinutes],
      ['Overtime', `${row['overtimeMinutes'] ?? item.overtimeMinutes} min · ${this.formatMoney(item.overtimePaise)}`],
      ['Commission', this.formatMoney(Number(row['commissionPaise'] ?? item.commissionPaise))],
      ['Tips', this.formatMoney(Number(row['tipsPaise'] || 0))],
      ['Allowances', this.formatMoney(Number(row['allowancePaise'] || 0))],
      ['Deductions', this.formatMoney(item.deductionsPaise)],
      ['Net salary', this.formatMoney(item.netPaise)],
    ];
  }

  weekendRuleEvents(item: PayrollItem | null): WeekendRuleEvent[] {
    const value = item ? this.salaryRow(item)['weekendSandwichBreakdown'] : null;
    return Array.isArray(value) ? value as WeekendRuleEvent[] : [];
  }

  weekendAdjustmentRows(item: PayrollItem | null): AutoAdjustmentRow[] {
    const value = item ? this.salaryRow(item)['autoAdjustmentRules'] : null;
    if (!Array.isArray(value)) return [];
    const triggers = new Set(['weekend_penalty', 'sandwich_penalty', 'unpaid_week_off', 'weekly_off_worked']);
    return (value as AutoAdjustmentRow[]).filter((row) => triggers.has(row.triggerType || ''));
  }

  weekendEventDetail(event: WeekendRuleEvent) {
    if (event.beforeDate && event.afterDate) return `${this.formatDate(event.beforeDate)} and ${this.formatDate(event.afterDate)}`;
    if (event.triggeringDate) return this.formatDate(event.triggeringDate);
    return '';
  }

  private async loadStaff() {
    try {
      const result = await firstValueFrom(this.api.get<ApiEnvelope<StaffListPage>>('/staff/list?page=1&pageSize=100&active=true&sortBy=firstName&sortDirection=asc'));
      this.staff = this.unwrap(result, 'Unable to load employees').items;
    } catch (error) {
      this.error = this.message(error, this.language.text('staff.message.1ad2e1d76e'));
    }
  }

  async loadHistory() {
    try {
      const [historyResult, periodResult] = await Promise.all([
        firstValueFrom(this.api.get<ApiEnvelope<PayrollHistoryPage>>(`/staff-payroll/history?${this.historyParams(true)}`)),
        firstValueFrom(this.api.get<ApiEnvelope<PayrollRun[]>>('/staff-payroll/runs')),
      ]);
      const page = this.unwrap(historyResult, 'Unable to load payroll history');
      this.history = page.items;
      this.historyTotal = page.total;
      this.historyPage = page.page;
      this.periodRuns = this.unwrap(periodResult, 'Unable to load payroll periods');
    } catch (error) {
      this.error = this.message(error, this.language.text('staff.message.dd84d916e8'));
    }
  }

  async loadHolidays() {
    try {
      const result = await firstValueFrom(this.api.get<ApiEnvelope<StaffHoliday[]>>(`/staff-payroll/holidays?from=${this.year}-01-01&to=${this.year}-12-31`));
      this.holidays = this.unwrap(result, 'Unable to load holidays');
    } catch (error) {
      this.error = this.message(error, this.language.text('staff.message.cf143f3902'));
    }
  }

  private async loadPeriod() {
    const prefix = `${this.year}-${String(this.month).padStart(2, '0')}-`;
    const existing = this.periodRuns.find((run) => run.periodStart.startsWith(prefix));
    this.closeRegenerateDialog();
    this.existingPeriodRun = existing || null;
    this.runBranchId = this.auth.branchId || '';
    this.existingPeriodItems = [];
    this.existingPeriodSalaryRows = [];
    if (existing) {
      try {
        const detail = await this.fetchRunDetail(existing.id);
        this.existingPeriodRun = detail.run;
        this.existingPeriodItems = detail.items;
        this.existingPeriodSalaryRows = detail.salaryRows || [];
        if (!this.staffId) {
          this.applyDetail(detail);
          return;
        }
      } catch (error) {
        this.error = this.message(error, 'Unable to load existing payroll run');
        return;
      }
    }
    this.run = null;
    this.events = [];
    await this.checkSourceData(false);
  }

  private async loadRun(runId: string, branchId = this.auth.branchId || '') {
    this.runBranchId = branchId;
    await this.perform('loading', async () => {
      this.applyDetail(await this.fetchRunDetail(runId, branchId));
    });
  }

  private async fetchRunDetail(runId: string, branchId = '') {
    const query = branchId ? `?branchId=${encodeURIComponent(branchId)}` : '';
    const result = await firstValueFrom(this.api.get<ApiEnvelope<PayrollRunDetail>>(`/staff-payroll/runs/${runId}${query}`));
    return this.unwrap(result, 'Unable to load payroll run');
  }

  private applyPreview(preview: PayrollPreview) {
    this.runBranchId = this.auth.branchId || '';
    this.run = null;
    this.items = preview.items;
    this.salaryRows = preview.salaryRows || [];
    this.events = [];
    this.resetDraftInputs();
  }

  private applyDetail(detail: PayrollRunDetail) {
    if (this.run?.id !== detail.run.id) {
      this.closeCorrections();
      this.closePayouts();
    }
    this.run = detail.run;
    this.existingPeriodRun = detail.run;
    this.existingPeriodItems = detail.items;
    this.existingPeriodSalaryRows = detail.salaryRows || [];
    this.items = detail.items;
    this.salaryRows = detail.salaryRows || [];
    this.events = detail.events;
    if (detail.run.status === 'finalized') this.payoutKey = crypto.randomUUID();
    this.resetDraftInputs();
  }

  private resetDraftInputs() {
    this.adjustmentInputs = {};
    this.noteInputs = {};
    for (const item of this.items) {
      this.adjustmentInputs[item.staffId] = item.adjustmentPaise ? String(item.adjustmentPaise / 100) : '';
      this.noteInputs[item.staffId] = item.notes || '';
    }
  }

  private periodParams() {
    const params = new URLSearchParams({ cycle: this.cycle, year: String(this.year), month: String(this.month) });
    if (this.staffId) params.set('staffId', this.staffId);
    return params.toString();
  }

  private async loadPayouts() {
    if (!this.run) return;
    const result = await firstValueFrom(this.api.get<ApiEnvelope<PayrollPayoutReconciliation>>(`/staff-payroll/runs/${this.run.id}/payouts`));
    this.payoutReconciliation = this.unwrap(result, 'Unable to load payout reconciliation');
    this.payoutSelected = {};
    this.payoutReferences = Object.fromEntries(this.payoutReconciliation.items.map((item) => [item.staffId, item.reference || '']));
  }

  private async refreshCorrections(selectedId = '') {
    if (!this.run) return;
    const result = await firstValueFrom(this.api.get<ApiEnvelope<PayrollCorrection[]>>(`/staff-payroll/runs/${this.run.id}/corrections`));
    this.corrections = this.unwrap(result, 'Unable to load payroll corrections');
    const id = selectedId || this.selectedCorrection?.id;
    if (!id) return;
    const detailResult = await firstValueFrom(this.api.get<ApiEnvelope<PayrollCorrectionDetail>>(`/staff-payroll/corrections/${id}`));
    const detail = this.unwrap(detailResult, 'Unable to load payroll correction history');
    this.selectedCorrection = detail.correction;
    this.correctionEvents = detail.events;
  }

  private resetCorrectionAction() {
    this.correctionDecisionNote = '';
    this.correctionPaymentMethod = '';
    this.correctionPaymentReference = '';
    this.correctionMfaCode = '';
    this.correctionPostingKey = crypto.randomUUID();
  }

  private historyParams(includePage: boolean) {
    const params = new URLSearchParams({ scope: this.historyScope });
    if (this.historyPeriod === 'month') {
      params.set('year', String(this.historyYear));
      params.set('month', String(this.historyMonth));
    } else if (this.historyPeriod === 'range') {
      if (this.historyFrom) params.set('from', this.historyFrom);
      if (this.historyTo) params.set('to', this.historyTo);
    }
    if (this.historyStaffId) params.set('staffId', this.historyStaffId);
    if (this.historyCategory) params.set('category', this.historyCategory);
    if (this.historyStatus) params.set('status', this.historyStatus);
    if (this.historyValidationState) params.set('validationState', this.historyValidationState);
    if (this.historyPaymentMethod) params.set('paymentMethod', this.historyPaymentMethod);
    if (this.historySearch.trim()) params.set('search', this.historySearch.trim());
    if (includePage) {
      params.set('page', String(this.historyPage));
      params.set('pageSize', String(this.historyPageSize));
    }
    return params.toString();
  }

  private runBranchParams() {
    return new URLSearchParams({ branchId: this.runBranchId || this.auth.branchId || '' }).toString();
  }

  private itemCategory(item: PayrollItem) {
    return (this.staff.find((row) => row.id === item.staffId)?.jobTitle || '').trim();
  }

  private previewCsv() {
    const rows = this.filteredItems.map((item) => [
      item.employeeCode || '',
      item.staffName,
      this.itemCategory(item),
      item.payRateType || '',
      item.payRatePaise ?? '',
      item.earnedSalaryPaise,
      item.overtimePaise,
      item.commissionPaise,
      item.adjustmentPaise,
      item.deductionsPaise,
      item.netPaise,
      item.status,
    ]);
    return [
      [...['employeeCode', 'staff', 'category', 'payRateType', 'payRate', 'earnedSalary', 'overtime', 'commission', 'adjustment', 'deductions', 'netPay', 'status'].map((key) => this.language.text(`staff.export.${key}`))],
      ...rows,
    ].map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(',')).join('\n');
  }

  private downloadText(content: string, filename: string) {
    const blob = new Blob([content], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename.replace(/[^a-z0-9._-]+/gi, '-');
    link.click();
    URL.revokeObjectURL(url);
  }

  private toPaise(value: string | undefined) {
    if (!value?.trim()) return 0;
    const amount = Number(value);
    return Number.isFinite(amount) ? Math.round(amount * 100) : 0;
  }

  private async download(path: string, filename: string) {
    this.error = '';
    try {
      const blob = await firstValueFrom(this.api.getBlob(path));
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename.replace(/[^a-z0-9._-]+/gi, '-');
      link.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      this.error = this.message(error, this.language.text('staff.message.e1d064acf9'));
    }
  }

  private unwrap<T>(result: ApiEnvelope<T>, fallback: string): T {
    if (!result.success || result.data === undefined) throw new Error(result.error?.message || fallback);
    return result.data;
  }

  private async perform(action: string, operation: () => Promise<void>) {
    this.loading = true;
    this.action = action;
    this.error = '';
    try { await operation(); }
    catch (error) { this.error = this.message(error, this.language.text('staff.message.23adfe88a7')); }
    finally { this.loading = false; this.action = ''; }
  }

  private message(error: unknown, fallback: string) {
    const candidate = error as { error?: { error?: { message?: string }; message?: string }; message?: string };
    return candidate?.error?.error?.message || candidate?.error?.message || candidate?.message || fallback;
  }
}
