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

type PayrollTab = 'summary' | 'detail' | 'history';
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
};

type PayrollEvent = { id: string; eventType: string; actorUserId: string; payloadJson: unknown; createdAt: string };
type PayrollRunDetail = { run: PayrollRun; items: PayrollItem[]; events: PayrollEvent[]; salaryRows?: Record<string, unknown>[] };
type StaffHoliday = { id: string; holidayDate: string; name: string; isPaid: boolean; active: boolean };
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
    imports: [CommonModule, FormsModule, DatePickerComponent, TranslatePipe],
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
  ];
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
  cycle = 'monthly';
  salaryMode: SalaryMode = 'preview';
  month = new Date().getMonth() + 1;
  year = new Date().getFullYear();
  staffId = '';
  category = '';
  staff: StaffOption[] = [];
  history: PayrollRun[] = [];
  run: PayrollRun | null = null;
  items: PayrollItem[] = [];
  salaryRows: Record<string, unknown>[] = [];
  events: PayrollEvent[] = [];
  selectedItem: PayrollItem | null = null;
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

  constructor() {
    const currentYear = new Date().getFullYear();
    this.years = Array.from({ length: 7 }, (_, index) => currentYear - 3 + index);
  }

  async ngOnInit() {
    await Promise.all([this.loadStaff(), this.loadHistory(), this.loadHolidays()]);
    await this.loadPeriod();
  }

  get invalidCount() { return this.items.filter((item) => item.validationErrors.length > 0).length; }
  get warningCount() { return this.items.filter((item) => item.validationWarnings.length > 0).length; }
  get grossTotal() { return this.run?.grossPaise ?? this.items.reduce((sum, item) => sum + item.grossPaise, 0); }
  get deductionTotal() { return this.run?.deductionsPaise ?? this.items.reduce((sum, item) => sum + item.deductionsPaise, 0); }
  get netTotal() { return this.run?.netPaise ?? this.items.reduce((sum, item) => sum + item.netPaise, 0); }
  get canPrintPayslips() { return Boolean(this.run && ['finalized', 'paid'].includes(this.run.status)); }
  get currentStep() {
    if (!this.run) return this.items.length ? 1 : 0;
    return ({ calculated: 1, reviewed: 2, finalized: 3, paid: 4 } as Record<string, number>)[this.run.status] ?? 0;
  }
  get workflowLabel() {
    if (!this.run) return 'Review & finalize';
    if (this.run.status === 'calculated') return 'Send for review';
    if (this.run.status === 'reviewed') return 'Finalize payroll';
    if (this.run.status === 'finalized') return 'Record payout';
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
  get filteredItems() {
    if (!this.category) return this.items;
    return this.items.filter((item) => this.itemCategory(item) === this.category);
  }
  get selectedSalaryRow() { return this.selectedItem ? this.salaryRow(this.selectedItem) : null; }
  get canSaveDraft() { return this.run?.status === 'calculated' && !this.loading; }
  get canRegenerateSelected() {
    return Boolean(this.staffId) && !this.loading && (!this.run || !['finalized', 'paid'].includes(this.run.status));
  }
  get canConfirmRegenerate() { return Boolean(this.regenerateReason.trim()) && !this.loading; }
  get regenerateRows() {
    if (!this.regenerateBefore || !this.regenerateAfter) return [];
    const before = this.regenerateBefore;
    const after = this.regenerateAfter;
    const beforeTips = this.tipsPaiseOf(before, this.salaryRows);
    const afterTips = this.tipsPaiseOf(after, this.regenerateAfterSalaryRows);
    return [
      this.diffRow('Attendance days', before.attendanceDaysX2, after.attendanceDaysX2, 'days'),
      this.diffRow('Paid leave days', before.paidLeaveDaysX2, after.paidLeaveDaysX2, 'days'),
      this.diffRow('Weekly off days', before.weeklyOffDaysX2, after.weeklyOffDaysX2, 'days'),
      this.diffRow('Holiday days', before.holidayDaysX2, after.holidayDaysX2, 'days'),
      this.diffRow('Worked minutes', before.workedMinutes, after.workedMinutes, 'minutes'),
      this.diffRow('Overtime minutes', before.overtimeMinutes, after.overtimeMinutes, 'minutes'),
      this.diffRow('Earned salary', before.earnedSalaryPaise, after.earnedSalaryPaise, 'money'),
      this.diffRow('Overtime pay', before.overtimePaise, after.overtimePaise, 'money'),
      this.diffRow('Commission', before.commissionPaise, after.commissionPaise, 'money'),
      this.diffRow('Tips', beforeTips, afterTips, 'money'),
      this.diffRow('Adjustment', before.adjustmentPaise, after.adjustmentPaise, 'money'),
      this.diffRow('Deductions', before.deductionsPaise, after.deductionsPaise, 'money'),
      this.diffRow('Gross pay', before.grossPaise, after.grossPaise, 'money'),
      this.diffRow('Net pay', before.netPaise, after.netPaise, 'money'),
    ];
  }
  get canAdvance() {
    if (!this.run || this.invalidCount > 0 || !['calculated', 'reviewed', 'finalized'].includes(this.run.status) || this.loading) return false;
    if (this.run.status === 'calculated') return true;
    if (!this.actionMfaCode.trim()) return false;
    return this.run.status !== 'finalized' || Boolean(this.payoutMethod && (['cash', 'bank'].includes(this.payoutMethod) || this.payoutReference.trim()));
  }

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
      if (this.staffId) { await this.openRegenerateDialog(); return; }
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
      this.regenerateBefore = this.items.find((item) => item.staffId === this.staffId) || after;
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

  private diffRow(label: string, before: number, after: number, kind: 'money' | 'minutes' | 'days'): [string, string, string, string] {
    const format = (value: number) => kind === 'money' ? this.formatMoney(value) : kind === 'days' ? this.days(value) : String(value);
    const rawDelta = kind === 'days' ? (after - before) / 2 : after - before;
    const sign = rawDelta > 0 ? '+' : '';
    const deltaText = kind === 'money'
      ? `${sign}${this.formatMoney(after - before)}`
      : `${sign}${kind === 'days' ? rawDelta.toFixed(1).replace(/\.0$/, '') : rawDelta}`;
    return [label, format(before), format(after), deltaText];
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
    await this.loadRun(run.id);
    this.activeTab = 'summary';
  }

  async exportCsv() {
    if (!this.run) {
      if (!this.filteredItems.length) { this.error = this.language.text('staff.message.e86a1c430a'); return; }
      this.downloadText(this.previewCsv(), `salary-preview-${this.year}-${String(this.month).padStart(2, '0')}.csv`);
      return;
    }
    await this.download(`/staff-payroll/runs/${this.run.id}/export`, `payroll-${this.run.periodStart}-${this.run.periodEnd}.csv`);
  }

  async printPayslip(item: PayrollItem) {
    if (!this.run || !['finalized', 'paid'].includes(this.run.status)) return;
    await this.download(`/staff-payroll/runs/${this.run.id}/payslips/${item.staffId}`, `payslip-${item.staffName}.pdf`);
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
      ['Worked minutes', row['workedMinutes'] ?? item.workedMinutes],
      ['Overtime', `${row['overtimeMinutes'] ?? item.overtimeMinutes} min · ${this.formatMoney(item.overtimePaise)}`],
      ['Commission', this.formatMoney(Number(row['commissionPaise'] ?? item.commissionPaise))],
      ['Tips', this.formatMoney(Number(row['tipsPaise'] || 0))],
      ['Allowances', this.formatMoney(Number(row['allowancePaise'] || 0))],
      ['Deductions', this.formatMoney(item.deductionsPaise)],
      ['Net salary', this.formatMoney(item.netPaise)],
    ];
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
      const result = await firstValueFrom(this.api.get<ApiEnvelope<PayrollRun[]>>('/staff-payroll/runs'));
      this.history = this.unwrap(result, 'Unable to load payroll history');
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
    const existing = this.history.find((run) => run.periodStart.startsWith(prefix));
    if (existing && !this.staffId) await this.loadRun(existing.id);
    else {
      this.run = null;
      this.events = [];
      await this.checkSourceData(false);
    }
  }

  private async loadRun(runId: string) {
    await this.perform('loading', async () => {
      const result = await firstValueFrom(this.api.get<ApiEnvelope<PayrollRunDetail>>(`/staff-payroll/runs/${runId}`));
      this.applyDetail(this.unwrap(result, 'Unable to load payroll run'));
    });
  }

  private applyPreview(preview: PayrollPreview) {
    this.run = null;
    this.items = preview.items;
    this.salaryRows = preview.salaryRows || [];
    this.events = [];
    this.resetDraftInputs();
  }

  private applyDetail(detail: PayrollRunDetail) {
    this.run = detail.run;
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
