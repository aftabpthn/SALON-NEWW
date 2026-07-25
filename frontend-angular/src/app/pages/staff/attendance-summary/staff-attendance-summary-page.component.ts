import { LanguageService } from '../../../core/i18n/language.service';

import { TranslatePipe } from '../../../shared/pipes/translate.pipe';
import { Component, OnInit, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { ApiEnvelope, ApiService } from '../../../shared/services/api.service';

type AttendanceColumn =
  | 'name' | 'code' | 'salary' | 'workingDays' | 'leaveBalance' | 'specialLeaveBalance'
  | 'leaveAvailed' | 'specialLeaveAvailed' | 'operationMeetings' | 'operationTasks' | 'penalty' | 'leavesAccrued'
  | 'weeklyOffAdjustment' | 'specialLeaveAdjustment' | 'revisedLeaveBalance'
  | 'revisedSpecialLeaveBalance' | 'comments';

type AttendanceSummaryRow = {
  staffId: string;
  name: string;
  employeeCode: string | null;
  salaryPaise: number | null;
  workingDays: number;
  leaveBalance: number;
  specialLeaveBalance: number;
  leaveAvailed: number;
  specialLeaveAvailed: number;
  penaltyPaise: number;
  operationMeetingPresent: number;
  operationMeetingAbsent: number;
  operationTaskCompleted: number;
  operationTaskMissed: number;
  leavesAccrued: number;
  weeklyOffAdjustment: number;
  specialLeaveAdjustment: number;
  revisedLeaveBalance: number;
  revisedSpecialLeaveBalance: number;
  comments: string;
};

type AttendanceDetail = {
  id: string | null;
  businessDate: string;
  scheduledStatus: string | null;
  attendanceStatus: string | null;
  manualStatus: string | null;
  clockInAt: string | null;
  clockOutAt: string | null;
  workedMinutes: number;
  lateMinutes: number;
  earlyLeaveMinutes: number;
  overtimeMinutes: number;
  breakMinutes: number;
  penaltyPaise: number;
  source: string;
  comments: string;
  correctionReason: string;
  correctedAt: string | null;
  breaks: AttendanceBreak[];
  operations: AttendanceOperation[];
};

type AttendanceBreak = { id?: string; startedAt: string; endedAt: string; comments: string };
type AttendanceOperation = { id: string; title: string; operationType: string; status: string; attendanceStatus?: string; taskStatus?: string };
type CorrectionForm = {
  clockInAt: string; clockOutAt: string; manualStatus: string; penaltyRupees: number | null;
  comments: string; correctionReason: string;
  breaks: Array<{ startedAt: string; endedAt: string; comments: string }>;
};

@Component({
    selector: 'app-staff-attendance-summary-page',
    imports: [FormsModule, TranslatePipe],
    templateUrl: './staff-attendance-summary-page.component.html',
    styleUrls: ['./staff-attendance-summary-page.component.css']
})
export class StaffAttendanceSummaryPageComponent implements OnInit {
  private readonly language = inject(LanguageService);
  private readonly api = inject(ApiService);
  private readonly today = new Date();

  readonly months = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
  ];
  readonly years = Array.from({ length: 7 }, (_, index) => this.today.getFullYear() - 3 + index);
  readonly columns: Array<{ key: AttendanceColumn; label: string }> = [
    { key: 'name', label: 'Name' }, { key: 'code', label: 'Code' }, { key: 'salary', label: 'Salary' },
    { key: 'workingDays', label: 'Working Days' }, { key: 'leaveBalance', label: 'Leave Balance' },
    { key: 'specialLeaveBalance', label: 'Special Leave Balance' }, { key: 'leaveAvailed', label: 'Leave Availed' },
    { key: 'specialLeaveAvailed', label: 'Special Leave Availed' }, { key: 'operationMeetings', label: 'Meeting Attendance' },
    { key: 'operationTasks', label: 'Cleaning Tasks' }, { key: 'penalty', label: 'Penalty' },
    { key: 'leavesAccrued', label: 'Leaves Accrued' }, { key: 'weeklyOffAdjustment', label: 'Weekly Off Adjustment' },
    { key: 'specialLeaveAdjustment', label: 'Special Leave Adjustment' }, { key: 'revisedLeaveBalance', label: 'Revised Leave Balance' },
    { key: 'revisedSpecialLeaveBalance', label: 'Revised Special Leave Balance' }, { key: 'comments', label: 'Comments' },
  ];
  readonly visibleColumns = Object.fromEntries(this.columns.map((column) => [column.key, true])) as Record<AttendanceColumn, boolean>;

  cycle = 'monthly';
  month = this.today.getMonth() + 1;
  year = this.today.getFullYear();
  staffId = '';
  staffOptions: Array<{ id: string; name: string }> = [];
  rows: AttendanceSummaryRow[] = [];
  details: AttendanceDetail[] = [];
  selectedRow: AttendanceSummaryRow | null = null;
  loading = false;
  saving = false;
  recalculating = false;
  detailLoading = false;
  columnMenuOpen = false;
  error = '';
  correctionDetail: AttendanceDetail | null = null;
  correctionForm: CorrectionForm | null = null;
  correctionSaving = false;

  ngOnInit() { void this.loadSummary(); }

  isVisible(column: AttendanceColumn) { return this.visibleColumns[column]; }

  toggleColumn(column: AttendanceColumn) {
    if (this.visibleColumns[column] && Object.values(this.visibleColumns).filter(Boolean).length === 1) return;
    this.visibleColumns[column] = !this.visibleColumns[column];
  }

  async loadSummary() {
    this.loading = true;
    this.error = '';
    try {
      const result = await firstValueFrom(this.api.get<ApiEnvelope<AttendanceSummaryRow[]>>(`/staff-attendance/summary?${this.query()}`));
      this.rows = result.data || [];
      if (!this.staffId) this.staffOptions = this.rows.map(({ staffId: id, name }) => ({ id, name }));
    } catch (error) {
      this.error = this.message(error, this.language.text('staff.message.9106518826'));
      this.rows = [];
    } finally {
      this.loading = false;
    }
  }

  async recalculate() {
    this.recalculating = true;
    this.error = '';
    try {
      const result = await firstValueFrom(this.api.post<ApiEnvelope<AttendanceSummaryRow[]>>(`/staff-attendance/summary/recalculate?${this.query()}`, {}));
      this.rows = result.data || [];
    } catch (error) {
      this.error = this.message(error, this.language.text('staff.message.27f3e64dcf'));
    } finally {
      this.recalculating = false;
    }
  }

  async save() {
    if (!this.rows.length) return;
    this.saving = true;
    this.error = '';
    try {
      const result = await firstValueFrom(this.api.put<ApiEnvelope<AttendanceSummaryRow[]>>('/staff-attendance/summary', {
        year: this.year,
        month: this.month,
        entries: this.rows.map((row) => ({
          staffId: row.staffId,
          weeklyOffAdjustment: Number(row.weeklyOffAdjustment) || 0,
          specialLeaveAdjustment: Number(row.specialLeaveAdjustment) || 0,
          comments: row.comments.trim(),
        })),
      }));
      this.rows = result.data || [];
    } catch (error) {
      this.error = this.message(error, this.language.text('staff.message.1ceeaacac7'));
    } finally {
      this.saving = false;
    }
  }

  async openDetails(row: AttendanceSummaryRow) {
    this.selectedRow = row;
    this.correctionDetail = null;
    this.correctionForm = null;
    this.details = [];
    this.detailLoading = true;
    try {
      const result = await firstValueFrom(this.api.get<ApiEnvelope<AttendanceDetail[]>>(`/staff-attendance/${encodeURIComponent(row.staffId)}/details?${this.query(false)}`));
      this.details = result.data || [];
    } catch (error) {
      this.error = this.message(error, this.language.text('staff.message.66ba4df2e4'));
    } finally {
      this.detailLoading = false;
    }
  }

  closeDetails() { this.selectedRow = null; this.details = []; this.correctionDetail = null; this.correctionForm = null; }

  editAttendance(detail: AttendanceDetail) {
    this.correctionDetail = detail;
    this.correctionForm = {
      clockInAt: this.toLocalInput(detail.clockInAt),
      clockOutAt: this.toLocalInput(detail.clockOutAt),
      manualStatus: detail.manualStatus || '',
      penaltyRupees: detail.penaltyPaise ? detail.penaltyPaise / 100 : null,
      comments: detail.comments || '',
      correctionReason: '',
      breaks: (detail.breaks || []).map((item) => ({
        startedAt: this.toLocalInput(item.startedAt), endedAt: this.toLocalInput(item.endedAt), comments: item.comments || '',
      })),
    };
  }

  cancelCorrection() { this.correctionDetail = null; this.correctionForm = null; }

  addBreak() {
    this.correctionForm?.breaks.push({ startedAt: '', endedAt: '', comments: '' });
  }

  removeBreak(index: number) { this.correctionForm?.breaks.splice(index, 1); }

  async saveCorrection() {
    if (!this.selectedRow || !this.correctionDetail || !this.correctionForm) return;
    const form = this.correctionForm;
    if (!form.correctionReason.trim()) { this.error = this.language.text('staff.message.051f58a1a3'); return; }
    if (form.breaks.some((item) => !item.startedAt || !item.endedAt)) { this.error = this.language.text('staff.message.b226d82122'); return; }
    this.correctionSaving = true;
    this.error = '';
    try {
      const result = await firstValueFrom(this.api.patch<ApiEnvelope<unknown>>(
        `/staff-attendance/${encodeURIComponent(this.selectedRow.staffId)}/${this.correctionDetail.businessDate}/correction`,
        {
          clockInAt: this.toIso(form.clockInAt), clockOutAt: this.toIso(form.clockOutAt),
          manualStatus: form.manualStatus || null,
          penaltyPaise: form.penaltyRupees === null ? 0 : Math.round(form.penaltyRupees * 100),
          comments: form.comments.trim(), correctionReason: form.correctionReason.trim(),
          breaks: form.breaks.map((item) => ({
            startedAt: this.toIso(item.startedAt), endedAt: this.toIso(item.endedAt), comments: item.comments.trim(),
          })),
        },
      ));
      if (!result.success) throw new Error(result.error?.message || 'Attendance correction could not be saved.');
      const selected = this.selectedRow;
      this.cancelCorrection();
      await Promise.all([this.openDetails(selected), this.loadSummary()]);
    } catch (error) {
      this.error = this.message(error, this.language.text('staff.message.dd3fd5a7fb'));
    } finally { this.correctionSaving = false; }
  }

  exportCsv() {
    if (!this.rows.length) return;
    const headers = this.columns.map((column) => column.label);
    const lines = this.rows.map((row) => [
      row.name, row.employeeCode || '', this.money(row.salaryPaise), row.workingDays,
      row.leaveBalance, row.specialLeaveBalance, row.leaveAvailed, row.specialLeaveAvailed,
      `${row.operationMeetingPresent}/${row.operationMeetingAbsent}`, `${row.operationTaskCompleted}/${row.operationTaskMissed}`,
      this.money(row.penaltyPaise), row.leavesAccrued, row.weeklyOffAdjustment,
      row.specialLeaveAdjustment, row.revisedLeaveBalance, row.revisedSpecialLeaveBalance, row.comments,
    ].map((value) => `"${String(value).replace(/"/g, '""')}"`).join(','));
    const blob = new Blob([[headers.join(','), ...lines].join('\n')], { type: 'text/csv;charset=utf-8' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `employee-attendance-${this.year}-${String(this.month).padStart(2, '0')}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
  }

  printPdf() { window.print(); }

  money(value: number | null) {
    return value === null ? '—' : new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(value / 100);
  }

  displayDate(value: string) {
    const [year, month, day] = value.split('-');
    return year && month && day ? `${day}/${month}/${year}` : value;
  }

  displayTime(value: string | null) {
    if (!value) return '—';
    return new Intl.DateTimeFormat('en-IN', { hour: '2-digit', minute: '2-digit' }).format(new Date(value));
  }

  hours(minutes: number) { return `${Math.floor(minutes / 60)}h ${minutes % 60}m`; }

  statusLabel(detail: AttendanceDetail) {
    return (detail.attendanceStatus || detail.scheduledStatus || 'Not recorded').replaceAll('_', ' ');
  }

  operationLabel(operation: AttendanceOperation) {
    const status = operation.attendanceStatus || operation.taskStatus || operation.status;
    return `${operation.title} · ${operation.operationType.replaceAll('_', ' ')} · ${status || 'planned'}`;
  }

  private toLocalInput(value: string | null) {
    if (!value) return '';
    const date = new Date(value);
    return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
  }

  private toIso(value: string) { return value ? new Date(value).toISOString() : null; }

  private query(includeStaff = true) {
    const params = new URLSearchParams({ cycle: this.cycle, year: String(this.year), month: String(this.month) });
    if (includeStaff && this.staffId) params.set('staffId', this.staffId);
    return params.toString();
  }

  private message(error: unknown, fallback: string) {
    const candidate = error as { error?: { error?: string | { message?: string }; message?: string } };
    const apiError = candidate?.error?.error;
    return (typeof apiError === 'string' ? apiError : apiError?.message) || candidate?.error?.message || fallback;
  }
}
