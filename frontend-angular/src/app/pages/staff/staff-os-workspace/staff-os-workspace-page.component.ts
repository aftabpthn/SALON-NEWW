import { CommonModule } from '@angular/common';
import { TranslatePipe } from '../../../shared/pipes/translate.pipe';
import { Component, OnInit, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { STAFF_OS_VIEWS, StaffOsAction, StaffOsActionField, StaffOsSection } from '../../../features/staff-os/domain/staff-os.models';
import { StaffOsStore } from '../../../features/staff-os/application/staff-os.store';
import { DatePickerComponent } from '../../../shared/date-picker/date-picker.component';

type StaffOption = {
  id: string;
  employeeCode?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  appointmentDisplayName?: string | null;
  jobTitle?: string | null;
};

type StaffListResponse = { items: StaffOption[] };
type ServiceOption = { id: string; name: string; category?: string | null; active?: boolean };

@Component({
    selector: 'page-staff-os-workspace',
    imports: [CommonModule, FormsModule, TranslatePipe, DatePickerComponent],
    providers: [StaffOsStore],
    templateUrl: './staff-os-workspace-page.component.html',
    styleUrls: ['./staff-os-workspace-page.component.css']
})
export class StaffOsWorkspacePageComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly store = inject(StaffOsStore);

  readonly periodEnd = this.iso(new Date());
  readonly periodStart = this.iso(new Date(Date.now() - 29 * 86_400_000));
  readonly view = STAFF_OS_VIEWS[String(this.route.snapshot.data['staffOsView'])] || STAFF_OS_VIEWS['leaderboard'];
  sections: StaffOsSection[] = [];
  loading = false;
  error = '';
  notice = '';
  taskDrawerOpen = false;
  taskOptionsLoading = false;
  taskSaving = false;
  taskError = '';
  actionDrawerOpen = false;
  actionSaving = false;
  actionError = '';
  activeAction: StaffOsAction | null = null;
  actionValues: Record<string, string> = {};
  staffOptions: StaffOption[] = [];
  serviceOptions: ServiceOption[] = [];
  readonly taskTypes = ['general', 'training', 'follow_up', 'compliance', 'performance'];
  readonly taskPriorities = ['low', 'medium', 'high', 'urgent'];
  taskForm = this.emptyTaskForm();

  async ngOnInit() {
    await this.refresh();
    if (this.view.key === 'tasks' && this.route.snapshot.queryParamMap.has('create')) await this.openTaskDrawer();
  }

  async refresh() {
    this.loading = true;
    this.error = '';
    try {
      this.sections = await this.store.load(this.view, this.periodStart, this.periodEnd);
    } catch (error) {
      this.error = this.message(error);
    } finally {
      this.loading = false;
    }
  }

  async run(action: StaffOsAction) {
    if (action.route) {
      await this.router.navigateByUrl(action.route);
      return;
    }
    if (!action.postPath) return;
    if (action.postPath === '/staff/tasks') {
      await this.openTaskDrawer();
      return;
    }
    if (!action.fields?.length) {
      this.error = '';
      this.notice = '';
      try {
        await this.submitAction(action, {});
      } catch (error) {
        this.error = this.message(error);
      }
      return;
    }
    await this.openActionDrawer(action);
  }

  async openActionDrawer(action: StaffOsAction) {
    this.activeAction = action;
    this.actionDrawerOpen = true;
    this.actionError = '';
    this.notice = '';
    this.actionValues = {};
    for (const field of action.fields || []) this.actionValues[field.key] = this.resolve(field.value || '');
    if ((action.fields || []).some((field) => field.type === 'staff')) await this.ensureStaffOptions();
  }

  closeActionDrawer() {
    if (this.actionSaving) return;
    this.actionDrawerOpen = false;
    this.activeAction = null;
    this.actionValues = {};
    this.actionError = '';
  }

  get canSaveAction() {
    if (this.actionSaving || this.taskOptionsLoading || !this.activeAction) return false;
    return (this.activeAction.fields || []).every((field) => field.optional || this.actionValues[field.key]?.trim());
  }

  async saveAction() {
    const action = this.activeAction;
    if (!action?.postPath) return;
    const body: Record<string, unknown> = {};
    for (const field of action.fields || []) {
      const raw = (this.actionValues[field.key] || '').trim();
      if (!raw) {
        if (field.optional) continue;
        this.actionError = `${field.label} is required`;
        return;
      }
      body[field.key] = this.fieldValue(field, raw);
    }
    this.actionSaving = true;
    this.actionError = '';
    try {
      await this.submitAction(action, body);
      this.actionDrawerOpen = false;
      this.activeAction = null;
      this.actionValues = {};
    } catch (error) {
      this.actionError = this.message(error);
    } finally {
      this.actionSaving = false;
    }
  }

  private async submitAction(action: StaffOsAction, body: Record<string, unknown>) {
    if (!action.postPath) return;
    if (action.postPath.includes('clock-in')) body['clockInAt'] = new Date().toISOString();
    if (action.postPath.includes('clock-out')) body['clockOutAt'] = new Date().toISOString();
    await this.store.post(action.postPath, body);
    this.notice = action.successMessage || `${action.label} completed`;
    await this.refresh();
  }

  private fieldValue(field: StaffOsActionField, raw: string): unknown {
    if (field.type === 'number' || /(?:count|minutes|amount|value)$/i.test(field.key)) {
      const number = Number(raw);
      return Number.isFinite(number) ? number : raw;
    }
    // Backend timestamp fields (dueAt, startAt…) take an ISO datetime, date pickers give YYYY-MM-DD.
    if (/At$/.test(field.key) && /^\d{4}-\d{2}-\d{2}$/.test(raw)) return new Date(`${raw}T23:59:59+05:30`).toISOString();
    return raw;
  }

  private async ensureStaffOptions() {
    if (this.staffOptions.length) return;
    this.taskOptionsLoading = true;
    try {
      const response = await this.store.get<StaffListResponse>('/staff/list?page=1&pageSize=100&active=true&sortBy=firstName&sortDirection=asc');
      this.staffOptions = response.items || [];
      if (!this.staffOptions.length) this.actionError = 'No active staff found';
    } catch (error) {
      this.actionError = this.message(error);
    } finally {
      this.taskOptionsLoading = false;
    }
  }

  async openTaskDrawer() {
    this.taskDrawerOpen = true;
    this.taskError = '';
    if (this.staffOptions.length && this.serviceOptions.length) return;
    this.taskOptionsLoading = true;
    try {
      const [response, services] = await Promise.all([
        this.store.get<StaffListResponse>('/staff/list?page=1&pageSize=100&active=true&sortBy=firstName&sortDirection=asc'),
        this.store.get<ServiceOption[]>('/services'),
      ]);
      this.staffOptions = response.items || [];
      this.serviceOptions = (services || []).filter((service) => service.active !== false);
      if (!this.staffOptions.length) this.taskError = 'No active staff found';
      else if (!this.serviceOptions.length) this.taskError = 'No active services found';
    } catch (error) {
      this.taskError = this.message(error);
    } finally {
      this.taskOptionsLoading = false;
    }
  }

  closeTaskDrawer() {
    if (this.taskSaving) return;
    this.taskDrawerOpen = false;
    this.taskError = '';
    this.taskForm = this.emptyTaskForm();
  }

  async saveTask() {
    if (this.taskForm.mode === 'service_target') {
      await this.saveServiceTarget();
      return;
    }
    const staffId = this.taskForm.staffId.trim();
    const title = this.taskForm.title.trim();
    if (!staffId || !title) {
      this.taskError = 'Staff and task title are required';
      return;
    }
    this.taskSaving = true;
    this.taskError = '';
    try {
      await this.store.post('/staff/tasks', {
        staffId,
        title,
        description: this.taskForm.description.trim() || undefined,
        taskType: this.taskForm.taskType,
        priority: this.taskForm.priority,
        dueAt: this.taskForm.dueDate ? new Date(`${this.taskForm.dueDate}T23:59:59+05:30`).toISOString() : undefined,
        status: 'open',
      });
      this.taskDrawerOpen = false;
      this.taskForm = this.emptyTaskForm();
      await this.refresh();
    } catch (error) {
      this.taskError = this.message(error);
    } finally {
      this.taskSaving = false;
    }
  }

  async saveServiceTarget() {
    const assigneeValue = this.taskForm.assigneeType === 'job_title' ? this.taskForm.jobTitle.trim() : this.taskForm.staffId.trim();
    const targetCount = Number(this.taskForm.targetCount);
    if (!assigneeValue || !this.taskForm.serviceId || !Number.isInteger(targetCount) || targetCount < 1 || !this.taskForm.startDate || !this.taskForm.endDate) {
      this.taskError = 'Assignee, service, target count, start date and end date are required';
      return;
    }
    if (this.taskForm.endDate < this.taskForm.startDate) {
      this.taskError = 'End date cannot be before start date';
      return;
    }
    const rewardAmountPaise = this.taskForm.rewardAmount.trim() ? Math.round(Number(this.taskForm.rewardAmount) * 100) : 0;
    if (!Number.isFinite(rewardAmountPaise) || rewardAmountPaise < 0 || (this.taskForm.rewardType === 'bonus' && rewardAmountPaise === 0)) {
      this.taskError = 'Enter a valid bonus amount';
      return;
    }
    if (['gift', 'other'].includes(this.taskForm.rewardType) && !this.taskForm.rewardDescription.trim()) {
      this.taskError = 'Reward description is required';
      return;
    }
    this.taskSaving = true;
    this.taskError = '';
    try {
      await this.store.post('/staff/service-targets', {
        assigneeType: this.taskForm.assigneeType,
        staffId: this.taskForm.assigneeType === 'staff' ? this.taskForm.staffId : undefined,
        jobTitle: this.taskForm.assigneeType === 'job_title' ? this.taskForm.jobTitle : undefined,
        serviceId: this.taskForm.serviceId,
        targetCount,
        startsOn: this.taskForm.startDate,
        endsOn: this.taskForm.endDate,
        rewardType: this.taskForm.rewardType,
        rewardAmountPaise,
        rewardDescription: this.taskForm.rewardDescription.trim() || undefined,
      });
      this.taskDrawerOpen = false;
      this.taskForm = this.emptyTaskForm();
      await this.refresh();
    } catch (error) {
      this.taskError = this.message(error);
    } finally {
      this.taskSaving = false;
    }
  }

  get staffCategories() {
    return [...new Set(this.staffOptions.map((staff) => staff.jobTitle?.trim()).filter((value): value is string => !!value))].sort();
  }

  get serviceCategories() {
    return [...new Set(this.serviceOptions.map((service) => service.category?.trim()).filter((value): value is string => !!value))].sort();
  }

  get filteredServiceOptions() {
    return this.serviceOptions.filter((service) => !this.taskForm.serviceCategory || service.category === this.taskForm.serviceCategory);
  }

  get canSaveTask() {
    if (this.taskSaving || this.taskOptionsLoading) return false;
    if (this.taskForm.mode === 'manual') return Boolean(this.taskForm.staffId && this.taskForm.title.trim());
    const assignee = this.taskForm.assigneeType === 'job_title' ? this.taskForm.jobTitle : this.taskForm.staffId;
    return Boolean(assignee && this.taskForm.serviceId && Number(this.taskForm.targetCount) > 0 && this.taskForm.startDate && this.taskForm.endDate);
  }

  staffOptionLabel(staff: StaffOption) {
    return staff.appointmentDisplayName?.trim()
      || [staff.firstName, staff.lastName].filter(Boolean).join(' ').trim()
      || staff.employeeCode
      || staff.id;
  }

  back() { void this.router.navigate(['/staff']); }
  label(value: string) { return value.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase()); }
  display(value: unknown, column = '') {
    if (value === null || value === undefined || value === '') return '—';
    if (this.isIdColumn(column)) return this.shortId(String(value));
    if (Array.isArray(value)) return `${value.length} ${value.length === 1 ? 'item' : 'items'}`;
    if (typeof value === 'object') return this.objectLabel(value as Record<string, unknown>);
    return String(value);
  }
  trackSection(_: number, section: StaffOsSection) { return section.title; }
  trackColumn(_: number, column: string) { return column; }
  trackRow(index: number, row: Record<string, unknown>) { return String(row['id'] || row['staffId'] || index); }

  private resolve(value: string) { return value.replace('{today}', this.periodEnd); }
  private iso(value: Date) { return value.toISOString().slice(0, 10); }
  private isIdColumn(column: string) { return /(^id$|id$)/i.test(column); }
  private objectLabel(value: Record<string, unknown>) {
    for (const key of ['displayName', 'staffName', 'appointmentDisplayName', 'name', 'title', 'status']) {
      if (typeof value[key] === 'string' && String(value[key]).trim()) return String(value[key]);
    }
    return `${Object.keys(value).length} fields`;
  }
  private shortId(value: string) {
    const text = value.trim();
    return text.length > 14 && /^[0-9a-f-]{14,}$/i.test(text) ? `${text.slice(0, 8)}…${text.slice(-4)}` : text;
  }
  private emptyTaskForm() {
    const startDate = this.iso(new Date());
    const end = new Date();
    end.setDate(end.getDate() + 7);
    return {
      mode: 'service_target', assigneeType: 'job_title', staffId: '', jobTitle: '', serviceCategory: '', serviceId: '',
      targetCount: '', startDate, endDate: this.iso(end), rewardType: 'none', rewardAmount: '', rewardDescription: '',
      title: '', description: '', taskType: 'general', priority: 'medium', dueDate: '',
    };
  }
  private message(error: unknown) {
    const candidate = error as { error?: { error?: { message?: string }; message?: string }; message?: string };
    return candidate?.error?.error?.message || candidate?.error?.message || candidate?.message || 'Staff OS could not be loaded';
  }
}
