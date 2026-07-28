import { LanguageService } from '../../../core/i18n/language.service';
import { CommonModule } from '@angular/common';
import { TranslatePipe } from '../../../shared/pipes/translate.pipe';
import { Component, inject, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { DatePickerComponent } from '../../../shared/date-picker/date-picker.component';
import { ApiEnvelope, ApiService } from '../../../shared/services/api.service';

type LeaveTab = 'requests' | 'balances' | 'calendar';
type StaffOption = { id: string; firstName: string; lastName: string; appointmentDisplayName: string };
type StaffListPage = { items: StaffOption[] };
type LeaveRequest = {
  id: string;
  staffId: string;
  staffName: string;
  employeeCode: string | null;
  leaveType: string;
  startDate: string;
  endDate: string;
  days: number;
  reason: string;
  status: string;
  requestedBy: string;
  reviewedBy: string | null;
  reviewedAt: string | null;
  reviewNote: string;
  version: number;
  createdAt: string;
};
type LeaveBalance = {
  staffId: string;
  staffName: string;
  employeeCode: string | null;
  leaveType: string;
  annualDays: number;
  usedDays: number;
  pendingDays: number;
  remainingDays: number;
};
type CalendarDay = { iso: string; day: number; inMonth: boolean };

@Component({
    selector: 'page-staff-leave-management',
    imports: [CommonModule, FormsModule, DatePickerComponent, TranslatePipe],
    templateUrl: './staff-leave-management-page.component.html',
    styleUrls: ['./staff-leave-management-page.component.css']
})
export class StaffLeaveManagementPageComponent implements OnInit {
  private readonly language = inject(LanguageService);
  private readonly api = inject(ApiService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  readonly tabs: Array<{ key: LeaveTab; label: string; icon: string }> = [
    { key: 'requests', label: 'Requests', icon: 'bi-inbox' },
    { key: 'balances', label: 'Balances', icon: 'bi-bar-chart' },
    { key: 'calendar', label: 'Calendar', icon: 'bi-calendar3' },
  ];
  readonly months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  readonly years: number[];
  readonly leaveTypes = [
    { value: 'annual', label: 'Annual' }, { value: 'sick', label: 'Sick' },
    { value: 'casual', label: 'Casual' }, { value: 'special', label: 'Special' },
    { value: 'unpaid', label: 'Unpaid' },
  ];
  readonly weekDays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  activeTab: LeaveTab = 'requests';
  month = new Date().getMonth() + 1;
  year = new Date().getFullYear();
  staffId = '';
  status = '';
  staff: StaffOption[] = [];
  requests: LeaveRequest[] = [];
  balances: LeaveBalance[] = [];
  loading = false;
  saving = false;
  error = '';
  success = '';
  createOpen = false;
  selectedRequest: LeaveRequest | null = null;
  reviewNote = '';
  form = this.emptyForm();

  constructor() {
    const current = new Date().getFullYear();
    this.years = Array.from({ length: 7 }, (_, index) => current - 3 + index);
  }

  async ngOnInit() {
    this.applyQueryParams();
    await Promise.all([this.loadStaff(), this.reload()]);
  }

  get pendingCount() { return this.requests.filter((row) => row.status === 'pending').length; }
  get approvedCount() { return this.requests.filter((row) => row.status === 'approved').length; }
  get canExport() { return this.activeTab === 'balances' ? this.balances.length > 0 : this.requests.length > 0; }
  get calendarDays() {
    const first = new Date(this.year, this.month - 1, 1);
    const start = new Date(this.year, this.month - 1, 1 - first.getDay());
    return Array.from({ length: 42 }, (_, index): CalendarDay => {
      const date = new Date(start);
      date.setDate(start.getDate() + index);
      return {
        iso: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`,
        day: date.getDate(),
        inMonth: date.getMonth() === this.month - 1,
      };
    });
  }

  async reload() {
    this.loading = true;
    this.error = '';
    try {
      await this.syncQueryParams();
      await Promise.all([this.loadRequests(), this.loadBalances()]);
    } catch (error) {
      this.error = this.message(error, this.language.text('staff.message.10ffb1ebb7'));
    } finally {
      this.loading = false;
    }
  }

  openCreate() {
    this.form = this.emptyForm();
    if (this.staffId) this.form.staffId = this.staffId;
    this.createOpen = true;
    this.error = '';
    this.success = '';
  }

  closeCreate() { this.createOpen = false; }

  openReview(row: LeaveRequest) {
    this.selectedRequest = row;
    this.reviewNote = '';
    this.error = '';
    this.success = '';
  }

  closeReview() { this.selectedRequest = null; this.reviewNote = ''; }

  async createRequest() {
    const endDate = this.form.endDate || this.form.startDate;
    if (!this.form.staffId || !this.form.leaveType || !this.form.startDate || !endDate) {
      this.error = this.language.text('staff.message.bf8f7f9753');
      return;
    }
    this.saving = true;
    this.error = '';
    try {
      const result = await firstValueFrom(this.api.post<ApiEnvelope<LeaveRequest>>('/staff-leave/requests', {
        staffId: this.form.staffId,
        leaveType: this.form.leaveType,
        startDate: this.form.startDate,
        endDate,
        reason: this.form.reason.trim(),
      }));
      this.unwrap(result, 'Leave request could not be saved');
      this.createOpen = false;
      this.success = 'Leave request saved';
      await this.reload();
    } catch (error) {
      this.error = this.message(error, this.language.text('staff.message.77e28c7a1f'));
    } finally {
      this.saving = false;
    }
  }

  async decide(decision: 'approve' | 'reject') {
    if (!this.selectedRequest) return;
    if (decision === 'reject' && !this.reviewNote.trim()) {
      this.error = this.language.text('staff.message.4ef4f1ffc6');
      return;
    }
    this.saving = true;
    this.error = '';
    try {
      const result = await firstValueFrom(this.api.post<ApiEnvelope<LeaveRequest>>(
        `/staff-leave/requests/${this.selectedRequest.id}/${decision}`,
        { version: this.selectedRequest.version, reviewNote: this.reviewNote.trim() },
      ));
      const updated = this.unwrap(result, `Leave request could not be ${decision}d`);
      this.selectedRequest = null;
      this.reviewNote = '';
      this.success = `Leave request ${updated.status}`;
      await this.reload();
    } catch (error) {
      this.error = this.message(error, `Leave request could not be ${decision}d`);
    } finally {
      this.saving = false;
    }
  }

  calendarLeaves(iso: string) {
    return this.requests.filter((row) => row.status !== 'rejected' && row.startDate <= iso && row.endDate >= iso);
  }

  exportCsv() {
    if (!this.canExport) return;
    const body = this.activeTab === 'balances'
      ? [
          ['employee', 'code', 'leaveType', 'annualDays', 'usedDays', 'pendingDays', 'remainingDays'],
          ...this.balances.map((row) => [row.staffName, row.employeeCode || '', row.leaveType, row.annualDays, row.usedDays, row.pendingDays, row.remainingDays]),
        ]
      : [
          ['employee', 'code', 'leaveType', 'startDate', 'endDate', 'days', 'reason', 'status', 'reviewNote'],
          ...this.requests.map((row) => [row.staffName, row.employeeCode || '', row.leaveType, row.startDate, row.endDate, row.days, row.reason, row.status, row.reviewNote]),
        ];
    const rows = [
      body[0].map((key) => this.language.text(`staff.export.${String(key)}`)),
      ...body.slice(1),
    ];
    const csv = rows.map((row) => row.map((value) => `"${String(value).replace(/"/g, '""')}"`).join(',')).join('\r\n');
    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    link.download = `staff-leave-${this.activeTab}-${this.year}-${String(this.month).padStart(2, '0')}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
  }

  displayDate(value: string) {
    const [year, month, day] = value.slice(0, 10).split('-');
    return year && month && day ? `${day}/${month}/${year}` : value;
  }
  label(value: string) { return value.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase()); }
  staffLabel(row: StaffOption) { return [row.firstName || row.appointmentDisplayName, row.lastName].filter(Boolean).join(' '); }
  backToStaff() { void this.router.navigate(['/staff']); }
  async selectTab(tab: LeaveTab) { this.activeTab = tab; await this.syncQueryParams(); }

  private async loadStaff() {
    try {
      const result = await firstValueFrom(this.api.get<ApiEnvelope<StaffListPage>>('/staff/list?page=1&pageSize=100&active=true&sortBy=firstName&sortDirection=asc'));
      this.staff = this.unwrap(result, 'Employees could not be loaded').items;
    } catch (error) {
      this.error = this.message(error, this.language.text('staff.message.5000550f07'));
    }
  }

  private async loadRequests() {
    const params = new URLSearchParams({ year: String(this.year), month: String(this.month) });
    if (this.staffId) params.set('staffId', this.staffId);
    if (this.status) params.set('status', this.status);
    const result = await firstValueFrom(this.api.get<ApiEnvelope<LeaveRequest[]>>(`/staff-leave/requests?${params}`));
    this.requests = this.unwrap(result, 'Leave requests could not be loaded');
  }

  private async loadBalances() {
    const params = new URLSearchParams({ year: String(this.year) });
    if (this.staffId) params.set('staffId', this.staffId);
    const result = await firstValueFrom(this.api.get<ApiEnvelope<LeaveBalance[]>>(`/staff-leave/balances?${params}`));
    this.balances = this.unwrap(result, 'Leave balances could not be loaded');
  }

  private emptyForm() {
    return { staffId: '', leaveType: 'casual', startDate: '', endDate: '', reason: '' };
  }

  private applyQueryParams() {
    const params = this.route.snapshot.queryParamMap;
    const tab = params.get('tab');
    const month = Number(params.get('month'));
    const year = Number(params.get('year'));
    const status = params.get('status') || '';
    if (this.tabs.some((item) => item.key === tab)) this.activeTab = tab as LeaveTab;
    if (Number.isInteger(month) && month >= 1 && month <= 12) this.month = month;
    if (this.years.includes(year)) this.year = year;
    if (['pending', 'approved', 'rejected'].includes(status)) this.status = status;
    this.staffId = params.get('staffId') || '';
  }

  private async syncQueryParams() {
    await this.router.navigate([], {
      relativeTo: this.route,
      queryParams: {
        tab: this.activeTab,
        month: this.month,
        year: this.year,
        staffId: this.staffId || null,
        status: this.status || null,
      },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  private unwrap<T>(result: ApiEnvelope<T>, fallback: string): T {
    if (!result.success || result.data === undefined) throw new Error(result.error?.message || fallback);
    return result.data;
  }

  private message(error: unknown, fallback: string) {
    const candidate = error as { error?: { error?: { message?: string }; message?: string }; message?: string };
    return candidate?.error?.error?.message || candidate?.error?.message || candidate?.message || fallback;
  }
}
