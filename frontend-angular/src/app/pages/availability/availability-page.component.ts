import { CommonModule } from '@angular/common';
import { Component, inject, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { DatePickerComponent } from '../../shared/date-picker/date-picker.component';
import { ApiEnvelope, ApiService } from '../../shared/services/api.service';

type ViewMode = 'day' | 'week' | 'month';
type ScheduleStatus = 'working' | 'annual_leave' | 'jury_duty' | 'leave' | 'sick_leave' | 'special_leave' | 'weekly_off' | 'working_other_center' | 'not_set';
type ScheduleStaff = { id: string; name: string; jobTitle: string; roleIds: string[] };
type ScheduleRole = { id: string; name: string };
type ScheduleEntry = {
  id?: string;
  staffId: string;
  scheduleDate: string;
  shift1Start: string;
  shift1End: string;
  shift2Start: string;
  shift2End: string;
  status: ScheduleStatus;
  notes: string;
};
type ScheduleData = { staff: ScheduleStaff[]; entries: ScheduleEntry[]; roles: ScheduleRole[]; jobs: string[] };

const STATUS_OPTIONS: Array<{ value: ScheduleStatus; label: string }> = [
  { value: 'working', label: 'Working' }, { value: 'annual_leave', label: 'Annual Leave' },
  { value: 'jury_duty', label: 'Jury Duty' }, { value: 'leave', label: 'Leave' },
  { value: 'sick_leave', label: 'Sick Leave' }, { value: 'special_leave', label: 'Special Leave' },
  { value: 'weekly_off', label: 'Weekly Off' }, { value: 'working_other_center', label: 'Working at Other Center' },
  { value: 'not_set', label: 'Not Set' },
];

@Component({
  selector: 'page-availability',
  standalone: true,
  imports: [CommonModule, FormsModule, DatePickerComponent],
  templateUrl: './availability-page.component.html',
  styleUrls: ['./availability-page.component.css'],
})
export class AvailabilityPageComponent implements OnInit {
  private readonly api = inject(ApiService);
  readonly statusOptions = STATUS_OPTIONS;
  readonly modes: ViewMode[] = ['day', 'week', 'month'];

  viewMode: ViewMode = 'week';
  anchorDate = this.toIso(new Date());
  centerLabel = 'Current center';
  roleId = '';
  job = '';
  staffId = '';
  roles: ScheduleRole[] = [];
  jobs: string[] = [];
  staff: ScheduleStaff[] = [];
  employeeOptions: ScheduleStaff[] = [];
  entries = new Map<string, ScheduleEntry>();
  selectedStaff = new Set<string>();
  loading = false;
  saving = false;
  copying = false;
  error = '';
  dirty = false;
  bulkStatus: ScheduleStatus = 'working';
  copyTargetDate = '';
  editorOpen = false;
  editorStaff?: ScheduleStaff;
  editorDate = '';
  editorDraft?: ScheduleEntry;

  ngOnInit() { void this.loadSchedule(); }

  get range() {
    const anchor = this.fromIso(this.anchorDate);
    if (this.viewMode === 'day') return { from: this.toIso(anchor), to: this.toIso(anchor) };
    if (this.viewMode === 'month') {
      const from = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth(), 1));
      const to = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth() + 1, 0));
      return { from: this.toIso(from), to: this.toIso(to) };
    }
    const from = this.addDays(anchor, -anchor.getUTCDay());
    return { from: this.toIso(from), to: this.toIso(this.addDays(from, 6)) };
  }

  get days() {
    const from = this.fromIso(this.range.from);
    const count = Math.round((this.fromIso(this.range.to).getTime() - from.getTime()) / 86400000) + 1;
    return Array.from({ length: count }, (_, index) => this.toIso(this.addDays(from, index)));
  }

  get rangeLabel() {
    const format = (iso: string) => this.fromIso(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });
    return this.range.from === this.range.to ? format(this.range.from) : `${format(this.range.from)} – ${format(this.range.to)}`;
  }

  get allSelected() { return this.staff.length > 0 && this.staff.every((person) => this.selectedStaff.has(person.id)); }

  async setView(mode: ViewMode) {
    if (mode === this.viewMode || !this.canDiscard()) return;
    this.viewMode = mode;
    await this.loadSchedule();
  }

  async navigate(direction: number) {
    if (!this.canDiscard()) return;
    const anchor = this.fromIso(this.anchorDate);
    if (this.viewMode === 'month') anchor.setUTCMonth(anchor.getUTCMonth() + direction);
    else anchor.setUTCDate(anchor.getUTCDate() + direction * (this.viewMode === 'week' ? 7 : 1));
    this.anchorDate = this.toIso(anchor);
    await this.loadSchedule();
  }

  async goToDate(value: string) {
    if (!value || value === this.anchorDate || !this.canDiscard()) return;
    this.anchorDate = value;
    await this.loadSchedule();
  }

  async reloadFilters() {
    if (!this.canDiscard()) return;
    await this.loadSchedule();
  }

  toggleAll(checked: boolean) {
    this.selectedStaff = checked ? new Set(this.staff.map((person) => person.id)) : new Set();
  }

  toggleStaff(id: string, checked: boolean) {
    const next = new Set(this.selectedStaff);
    checked ? next.add(id) : next.delete(id);
    this.selectedStaff = next;
  }

  cell(staffId: string, date: string) { return this.entries.get(this.key(staffId, date)); }

  openEditor(person: ScheduleStaff, date: string) {
    const existing = this.cell(person.id, date);
    this.editorStaff = person;
    this.editorDate = date;
    this.editorDraft = existing ? { ...existing } : this.emptyEntry(person.id, date);
    this.editorOpen = true;
  }

  closeEditor() { this.editorOpen = false; }

  applyEditor() {
    if (!this.editorDraft) return;
    this.error = this.validateEntry(this.editorDraft);
    if (this.error) return;
    this.entries.set(this.key(this.editorDraft.staffId, this.editorDraft.scheduleDate), { ...this.editorDraft });
    this.dirty = true;
    this.editorOpen = false;
  }

  applyBulkStatus() {
    const staffIds = this.selectedStaff.size ? this.selectedStaff : new Set(this.staff.map((person) => person.id));
    if (this.bulkStatus === 'working' && this.staff.some((person) => staffIds.has(person.id) && this.days.some((date) => {
      const entry = this.cell(person.id, date);
      return !entry?.shift1Start && !entry?.shift2Start;
    }))) {
      this.error = 'Add shift times before applying Working status';
      return;
    }
    this.error = '';
    for (const person of this.staff) {
      if (!staffIds.has(person.id)) continue;
      for (const date of this.days) {
        const entry = { ...(this.cell(person.id, date) || this.emptyEntry(person.id, date)), status: this.bulkStatus };
        if (this.bulkStatus === 'not_set') Object.assign(entry, { shift1Start: '', shift1End: '', shift2Start: '', shift2End: '' });
        this.entries.set(this.key(person.id, date), entry);
      }
    }
    this.dirty = true;
  }

  async save() {
    this.error = '';
    const visibleIds = new Set(this.staff.map((person) => person.id));
    const entries = [...this.entries.values()].filter((entry) => visibleIds.has(entry.staffId) && entry.scheduleDate >= this.range.from && entry.scheduleDate <= this.range.to);
    const invalid = entries.map((entry) => this.validateEntry(entry)).find(Boolean);
    if (invalid) { this.error = invalid; return; }
    this.saving = true;
    try {
      const result = await firstValueFrom(this.api.put<ApiEnvelope<unknown>>('/staff-schedule', {
        dateFrom: this.range.from, dateTo: this.range.to, staffIds: this.staff.map((person) => person.id), entries,
      }));
      if (!result.success) throw new Error(result.error?.message || 'Unable to save employee schedule');
      this.dirty = false;
      await this.loadSchedule();
    } catch (error) {
      this.error = error instanceof Error ? error.message : 'Unable to save employee schedule';
    } finally {
      this.saving = false;
    }
  }

  prepareCopy() {
    if (this.viewMode !== 'week') return;
    this.copyTargetDate = this.toIso(this.addDays(this.fromIso(this.range.from), 7));
  }

  async copySchedule() {
    if (!this.copyTargetDate || this.dirty) { this.error = this.dirty ? 'Save pending changes before copying' : 'Select target week'; return; }
    const staffIds = this.selectedStaff.size ? [...this.selectedStaff] : this.staff.map((person) => person.id);
    this.copying = true;
    this.error = '';
    try {
      const targetStart = this.addDays(this.fromIso(this.copyTargetDate), -this.fromIso(this.copyTargetDate).getUTCDay());
      const result = await firstValueFrom(this.api.post<ApiEnvelope<unknown>>('/staff-schedule/copy', {
        sourceStart: this.range.from, targetStart: this.toIso(targetStart), staffIds,
      }));
      if (!result.success) throw new Error(result.error?.message || 'Unable to copy employee schedule');
      this.anchorDate = this.toIso(targetStart);
      this.copyTargetDate = '';
      await this.loadSchedule();
    } catch (error) {
      this.error = error instanceof Error ? error.message : 'Unable to copy employee schedule';
    } finally {
      this.copying = false;
    }
  }

  dayLabel(iso: string) { return this.fromIso(iso).toLocaleDateString('en-IN', { weekday: 'short', day: '2-digit', month: 'short', timeZone: 'UTC' }); }
  statusLabel(status?: ScheduleStatus) { return STATUS_OPTIONS.find((option) => option.value === status)?.label || 'Not scheduled'; }
  shiftLabel(entry?: ScheduleEntry) {
    if (!entry) return 'Not scheduled';
    const shifts = [[entry.shift1Start, entry.shift1End], [entry.shift2Start, entry.shift2End]].filter(([start, end]) => start && end).map(([start, end]) => `${start}–${end}`);
    return shifts.length ? shifts.join(' · ') : entry.status === 'not_set' ? 'Not scheduled' : this.statusLabel(entry.status);
  }
  totalHours(person: ScheduleStaff) {
    return this.days.reduce((total, date) => {
      const entry = this.cell(person.id, date);
      return total + this.shiftHours(entry?.shift1Start, entry?.shift1End) + this.shiftHours(entry?.shift2Start, entry?.shift2End);
    }, 0);
  }

  private async loadSchedule() {
    this.loading = true;
    this.error = '';
    const params = new URLSearchParams({ dateFrom: this.range.from, dateTo: this.range.to });
    if (this.roleId) params.set('roleId', this.roleId);
    if (this.job) params.set('job', this.job);
    if (this.staffId) params.set('staffId', this.staffId);
    try {
      const result = await firstValueFrom(this.api.get<ApiEnvelope<ScheduleData>>(`/staff-schedule?${params}`));
      if (!result.success || !result.data) throw new Error(result.error?.message || 'Unable to load employee schedule');
      this.staff = result.data.staff;
      if (!this.roleId && !this.job && !this.staffId) this.employeeOptions = result.data.staff;
      this.roles = result.data.roles;
      this.jobs = result.data.jobs;
      this.entries = new Map(result.data.entries.map((entry) => {
        const normalized = { ...entry, shift1Start: this.time(entry.shift1Start), shift1End: this.time(entry.shift1End), shift2Start: this.time(entry.shift2Start), shift2End: this.time(entry.shift2End) };
        return [this.key(entry.staffId, entry.scheduleDate), normalized];
      }));
      this.selectedStaff = new Set(this.staff.map((person) => person.id));
      this.dirty = false;
    } catch (error) {
      this.staff = [];
      this.entries.clear();
      this.error = error instanceof Error ? error.message : 'Unable to load employee schedule';
    } finally {
      this.loading = false;
    }
  }

  private validateEntry(entry: ScheduleEntry) {
    const validShift = (start: string, end: string) => (!start && !end) || Boolean(start && end && start < end);
    if (!validShift(entry.shift1Start, entry.shift1End)) return 'Shift 1 requires a valid start and end time';
    if (!validShift(entry.shift2Start, entry.shift2End)) return 'Shift 2 requires a valid start and end time';
    if (entry.status === 'working' && !entry.shift1Start && !entry.shift2Start) return 'Working status requires at least one shift';
    return '';
  }
  private emptyEntry(staffId: string, scheduleDate: string): ScheduleEntry { return { staffId, scheduleDate, shift1Start: '', shift1End: '', shift2Start: '', shift2End: '', status: 'not_set', notes: '' }; }
  private canDiscard() { return !this.dirty || window.confirm('Discard unsaved schedule changes?'); }
  private key(staffId: string, date: string) { return `${staffId}:${date}`; }
  private time(value?: string | null) { return value ? value.slice(0, 5) : ''; }
  private shiftHours(start?: string, end?: string) { if (!start || !end) return 0; const [sh, sm] = start.split(':').map(Number); const [eh, em] = end.split(':').map(Number); return Math.max(0, (eh * 60 + em - sh * 60 - sm) / 60); }
  private fromIso(iso: string) { return new Date(`${iso}T00:00:00Z`); }
  private toIso(date: Date) { return date.toISOString().slice(0, 10); }
  private addDays(date: Date, days: number) { const next = new Date(date); next.setUTCDate(next.getUTCDate() + days); return next; }
}
