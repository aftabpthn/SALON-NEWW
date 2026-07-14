import { CommonModule } from '@angular/common';
import { Component, inject, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { ApiEnvelope, ApiService } from '../../../shared/services/api.service';

type PayrollTab = 'summary' | 'detail' | 'history';
type PayrollColumn = 'attendance' | 'payrate' | 'commission' | 'adjustments' | 'gross' | 'net' | 'validation' | 'status';
type StaffOption = { id: string; firstName: string; lastName: string; appointmentDisplayName: string };
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
type PayrollRunDetail = { run: PayrollRun; items: PayrollItem[]; events: PayrollEvent[] };
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
};

@Component({
  selector: 'page-staff-payroll',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './staff-payroll-page.component.html',
  styleUrls: ['./staff-payroll-page.component.css'],
})
export class StaffPayrollPageComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly router = inject(Router);

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
  month = new Date().getMonth() + 1;
  year = new Date().getFullYear();
  staffId = '';
  staff: StaffOption[] = [];
  history: PayrollRun[] = [];
  run: PayrollRun | null = null;
  items: PayrollItem[] = [];
  events: PayrollEvent[] = [];
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
  payoutKey = crypto.randomUUID();

  constructor() {
    const currentYear = new Date().getFullYear();
    this.years = Array.from({ length: 7 }, (_, index) => currentYear - 3 + index);
  }

  async ngOnInit() {
    await Promise.all([this.loadStaff(), this.loadHistory()]);
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
  get canSaveDraft() { return this.run?.status === 'calculated' && !this.loading; }
  get canAdvance() {
    if (!this.run || this.invalidCount > 0 || !['calculated', 'reviewed', 'finalized'].includes(this.run.status) || this.loading) return false;
    return this.run.status !== 'finalized' || Boolean(this.payoutMethod && (this.payoutMethod === 'cash' || this.payoutReference.trim()));
  }

  isVisible(column: PayrollColumn) { return this.visibleColumns[column]; }
  toggleColumn(column: PayrollColumn) {
    if (this.visibleColumns[column] || Object.values(this.visibleColumns).filter(Boolean).length > 1) {
      this.visibleColumns[column] = !this.visibleColumns[column];
    }
  }

  async changePeriod() {
    this.success = '';
    await this.loadPeriod();
  }

  async refresh() {
    this.success = '';
    await this.loadHistory();
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
      const payload = action === 'payout' ? { paymentMethod: this.payoutMethod, reference: this.payoutReference.trim(), idempotencyKey: this.payoutKey } : {};
      const result = await firstValueFrom(this.api.post<ApiEnvelope<PayrollRunDetail>>(`/staff-payroll/runs/${this.run!.id}/${action}`, payload));
      this.applyDetail(this.unwrap(result, 'Unable to update payroll status'));
      await this.loadHistory();
      this.success = `Payroll ${this.run!.status}`;
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
    if (!this.run) { this.error = 'Save a payroll run before exporting'; return; }
    await this.download(`/staff-payroll/runs/${this.run.id}/export`, `payroll-${this.run.periodStart}-${this.run.periodEnd}.csv`);
  }

  async printPayslip(item: PayrollItem) {
    if (!this.run || !['finalized', 'paid'].includes(this.run.status)) return;
    await this.download(`/staff-payroll/runs/${this.run.id}/payslips/${item.staffId}`, `payslip-${item.staffName}.pdf`);
  }

  formatMoney(paise: number | null | undefined) {
    if (paise === null || paise === undefined) return '—';
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
  backToStaff() { void this.router.navigate(['/staff']); }

  private async loadStaff() {
    try {
      const result = await firstValueFrom(this.api.get<ApiEnvelope<StaffListPage>>('/staff/list?page=1&pageSize=100&active=true&sortBy=firstName&sortDirection=asc'));
      this.staff = this.unwrap(result, 'Unable to load employees').items;
    } catch (error) {
      this.error = this.message(error, 'Unable to load employees');
    }
  }

  async loadHistory() {
    try {
      const result = await firstValueFrom(this.api.get<ApiEnvelope<PayrollRun[]>>('/staff-payroll/runs'));
      this.history = this.unwrap(result, 'Unable to load payroll history');
    } catch (error) {
      this.error = this.message(error, 'Unable to load payroll history');
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
    this.events = [];
    this.resetDraftInputs();
  }

  private applyDetail(detail: PayrollRunDetail) {
    this.run = detail.run;
    this.items = detail.items;
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
      this.error = this.message(error, 'Unable to download payroll file');
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
    catch (error) { this.error = this.message(error, 'Payroll action failed'); }
    finally { this.loading = false; this.action = ''; }
  }

  private message(error: unknown, fallback: string) {
    const candidate = error as { error?: { error?: { message?: string }; message?: string }; message?: string };
    return candidate?.error?.error?.message || candidate?.error?.message || candidate?.message || fallback;
  }
}
