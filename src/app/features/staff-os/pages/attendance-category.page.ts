import { CommonModule } from '@angular/common';
import { Component, OnInit, signal } from '@angular/core';
import { ReactiveFormsModule, UntypedFormBuilder, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { finalize, forkJoin } from 'rxjs';
import { StaffOsApi } from '../data/staff-os.api';
import { StaffOsAttendanceCategory, StaffOsAttendanceMaster, StaffOsAttendanceSlab, StaffOsBranch, StaffOsShiftMaster } from '../domain/staff-os.models';

@Component({
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, RouterLink],
  template: `
    <section class="category-page">
      <header class="topbar">
        <div>
          <h1>Attendance Category</h1>
        </div>
        <div class="topbar-actions">
          <a class="refresh" routerLink="/staff-os/employee-masters">Masters</a>
          <button type="button" class="primary" (click)="startNew()">Add</button>
          <button type="button" class="refresh" (click)="load()">Refresh</button>
        </div>
      </header>

      <div class="metrics">
        <article><span>Rules</span><strong>{{ records().length }}</strong></article>
        <article><span>Active</span><strong>{{ activeCount() }}</strong></article>
        <article><span>Auto Shifts</span><strong>{{ shiftCount() }}</strong></article>
        <article><span>Status Codes</span><strong>{{ statuses().length }}</strong></article>
      </div>

      <div *ngIf="loading()" class="state">Loading attendance category rules...</div>
      <div *ngIf="loadError()" class="state error">{{ loadError() }}</div>

      <section class="rule-shell">
        <aside class="list-panel">
          <div class="filters">
            <label>
              <span>Branch</span>
              <select [value]="branchFilter()" (change)="setBranchFilter($any($event.target).value)">
                <option value="">All branches</option>
                <option *ngFor="let branch of branches()" [value]="branch.id">{{ branch.name || branch.id }}</option>
              </select>
            </label>
            <label>
              <span>Search</span>
              <input [value]="search()" (input)="search.set($any($event.target).value)" />
            </label>
          </div>
          <div class="list">
            <button type="button" class="list-row" *ngFor="let record of filteredRecords()" [class.active]="editing()?.id === record.id" (click)="edit(record)">
              <span>
                <strong>{{ record.name }}</strong>
                <small>{{ record.workingDurationMinutes || 0 }} mins · {{ record.inTime || '--:--' }} to {{ record.outTime || '--:--' }}</small>
              </span>
              <em [class.hide]="record.hide">{{ record.hide ? 'Hide' : record.status }}</em>
            </button>
            <div class="empty" *ngIf="!filteredRecords().length && !loading()">No attendance category found.</div>
          </div>
        </aside>

        <main class="editor-panel">
          <form [formGroup]="form" (ngSubmit)="save()">
            <div class="form-title">
              <div>
                <p class="eyebrow">{{ editing() ? 'Edit rule' : 'New rule' }}</p>
                <h2>{{ editing()?.name || 'Create Attendance Category' }}</h2>
              </div>
              <label class="check-inline"><input type="checkbox" formControlName="hide" /> Hide</label>
            </div>

            <label class="field full">
              <span>Name</span>
              <input formControlName="name" placeholder="10:30 To 8:30" />
              <small *ngIf="fieldInvalid('name')">Name is required.</small>
            </label>

            <label class="field">
              <span>Branch</span>
              <select formControlName="branchId">
                <option value="">All branches</option>
                <option *ngFor="let branch of branches()" [value]="branch.id">{{ branch.name || branch.id }}</option>
              </select>
            </label>

            <label class="field">
              <span>Working Duration (mins)</span>
              <input type="number" min="0" formControlName="workingDurationMinutes" />
            </label>

            <label class="field">
              <span>In Time</span>
              <input type="time" formControlName="inTime" />
            </label>

            <label class="field">
              <span>Out Time</span>
              <input type="time" formControlName="outTime" />
            </label>

            <label class="check-field">
              <input type="checkbox" formControlName="overtimeApplicable" />
              <span>Overtime applicable</span>
            </label>

            <label class="field">
              <span>Minimum OT Duration</span>
              <input type="number" min="0" formControlName="minimumOtDurationMinutes" />
            </label>

            <label class="field">
              <span>Allowable Late Time</span>
              <input type="number" min="0" formControlName="allowableLateMinutes" />
            </label>

            <section class="rule-band full">
              <label class="field">
                <span>Mark</span>
                <select formControlName="lateMarkStatusId">
                  <option value="">Select status</option>
                  <option *ngFor="let status of statusOptions()" [value]="status.id">{{ statusLabel(status) }}</option>
                </select>
              </label>
              <label class="field">
                <span>No. of Late Coming</span>
                <input type="number" min="0" formControlName="lateMarkAfterCount" />
              </label>
              <div class="segmented">
                <button type="button" [class.active]="form.value.lateMarkMode === 'every_x_late'" (click)="form.patchValue({ lateMarkMode: 'every_x_late' })">Every X Late Coming</button>
                <button type="button" [class.active]="form.value.lateMarkMode === 'all_after_x_late'" (click)="form.patchValue({ lateMarkMode: 'all_after_x_late' })">All Late Coming After X</button>
              </div>
            </section>

            <section class="rule-band full">
              <label class="field">
                <span>Mark later than</span>
                <select formControlName="severeLateStatusId">
                  <option value="">Select status</option>
                  <option *ngFor="let status of statusOptions()" [value]="status.id">{{ statusLabel(status) }}</option>
                </select>
              </label>
              <label class="field">
                <span>Mins of late coming</span>
                <input type="number" min="0" formControlName="severeLateAfterMinutes" />
              </label>
            </section>

            <section class="slab-panel full">
              <div class="panel-heading">
                <h3>Attendance Slab</h3>
                <button type="button" class="refresh mini" (click)="addSlab()">Add Slab</button>
              </div>
              <div class="slab-grid header"><span>S.N</span><span>From Min.</span><span>To Min.</span><span>Status</span><span></span></div>
              <div class="slab-grid" *ngFor="let slab of slabs(); let i = index">
                <span>{{ i + 1 }}</span>
                <input type="number" min="0" [value]="slab.fromMinutes" (input)="updateSlab(i, 'fromMinutes', $any($event.target).value)" />
                <input type="number" min="0" [value]="slab.toMinutes" (input)="updateSlab(i, 'toMinutes', $any($event.target).value)" />
                <select [value]="slab.statusId || ''" (change)="updateSlabStatus(i, $any($event.target).value)">
                  <option value="">Select</option>
                  <option *ngFor="let status of statusOptions()" [value]="status.id">{{ statusLabel(status) }}</option>
                </select>
                <button type="button" class="icon-button" (click)="removeSlab(i)">×</button>
              </div>
            </section>

            <section class="shift-panel full">
              <div class="panel-heading">
                <h3>Select allowable shifts</h3>
                <span>{{ selectedShiftIds().length }} selected</span>
              </div>
              <label class="shift-row" *ngFor="let shift of shifts()">
                <input type="checkbox" [checked]="isShiftSelected(shift.id)" (change)="toggleShift(shift.id, $any($event.target).checked)" />
                <span>{{ shift.name }}</span>
                <small>{{ shift.startTime }} - {{ shift.endTime }} · {{ shift.shiftType }}</small>
              </label>
            </section>

            <label class="field full">
              <span>Notes</span>
              <textarea rows="3" formControlName="notes"></textarea>
            </label>

            <div class="state error full" *ngIf="saveError()">{{ saveError() }}</div>
            <div class="state warn full" *ngIf="!statusOptions().length && !loading()">Add an active status code in Attendance Master to enable late/slab status selection.</div>

            <footer class="actions full">
              <button type="button" class="refresh" (click)="cancel()">Cancel</button>
              <button type="button" class="refresh danger" *ngIf="editing()" (click)="archiveOrRestore()">
                {{ editing()?.hide || editing()?.status !== 'active' ? 'Restore' : 'Archive' }}
              </button>
              <button type="submit" class="primary" [disabled]="form.invalid || saving()">{{ saving() ? 'Saving...' : 'Save' }}</button>
            </footer>
          </form>
        </main>
      </section>
    </section>
  `,
  styles: [`
    .category-page { color: #10201a; display: grid; gap: 18px; padding: 24px; }
    .topbar, .form-title, .panel-heading { display: flex; justify-content: space-between; gap: 14px; align-items: flex-start; }
    .topbar-actions, .actions { display: flex; gap: 10px; flex-wrap: wrap; align-items: center; justify-content: flex-end; }
    .eyebrow { color: #547066; font-size: 12px; font-weight: 850; letter-spacing: .08em; margin: 0 0 5px; text-transform: uppercase; }
    h1, h2, h3 { margin: 0; letter-spacing: 0; }
    h1 { font-size: 30px; }
    h2 { font-size: 20px; }
    h3 { font-size: 15px; }
    .primary, .refresh { border: 1px solid #E7DDD6; border-radius: 6px; cursor: pointer; font-weight: 850; min-height: 38px; padding: 9px 12px; text-decoration: none; }
    .primary { background: #4B1238; border-color: #4B1238; color: #fff; }
    .refresh { background: #fff; color: #34483f; }
    .danger { color: #a52828; }
    .mini { min-height: 32px; padding: 6px 9px; }
    .metrics { display: grid; grid-template-columns: repeat(4, minmax(140px, 1fr)); gap: 12px; }
    .metrics article, .state, .list-panel, .editor-panel { background: #fff; border: 1px solid #E7DDD6; border-radius: 8px; }
    .metrics article { padding: 14px; }
    .metrics span { color: #60766d; font-size: 12px; font-weight: 850; text-transform: uppercase; }
    .metrics strong { display: block; font-size: 24px; margin-top: 6px; }
    .state { color: #61746c; padding: 14px; }
    .error { color: #a52828; border-color: #e7b1b1; }
    .warn { color: #8a5a00; border-color: #f0d79b; background: #fffaf0; }
    .rule-shell { display: grid; grid-template-columns: minmax(280px, 420px) minmax(0, 1fr); gap: 16px; align-items: start; }
    .list-panel, .editor-panel { display: grid; gap: 14px; padding: 16px; }
    .list-panel { min-width: 0; }
    .editor-panel { border-color: #b9d9d0; box-shadow: 0 18px 44px rgba(75, 18, 56, .08); min-width: 0; }
    .filters { display: grid; grid-template-columns: 1fr; gap: 10px; }
    .filters label, .field { display: grid; gap: 6px; color: #34483f; font-size: 13px; font-weight: 850; }
    input, select, textarea { background: #fff; border: 1px solid #E7DDD6; border-radius: 8px; color: #10201a; font: inherit; padding: 10px 11px; width: 100%; }
    .list { display: grid; border-top: 1px solid #edf2ef; }
    .list-row { align-items: center; background: #fff; border: 0; border-bottom: 1px solid #edf2ef; cursor: pointer; display: grid; gap: 10px; grid-template-columns: 1fr auto; min-height: 58px; padding: 10px 2px; text-align: left; }
    .list-row.active { color: #4B1238; }
    .list-row small, .shift-row small { color: #60766d; display: block; margin-top: 3px; }
    .list-row em { background: #eef6f1; border-radius: 999px; color: #286345; font-size: 12px; font-style: normal; font-weight: 850; padding: 4px 9px; }
    .list-row em.hide { background: #f5f0e6; color: #8a5a00; }
    form { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px 14px; }
    .form-title { background: #f6fbf9; border: 1px solid #E7DDD6; border-radius: 8px; padding: 12px 14px; }
    .full { grid-column: 1 / -1; }
    .check-inline, .check-field { align-items: center; display: inline-flex; gap: 8px; font-weight: 850; }
    .check-inline input, .check-field input, .shift-row input { width: 18px; height: 18px; padding: 0; }
    .check-field { border: 1px solid #edf2ef; border-radius: 8px; min-height: 43px; padding: 10px 11px; }
    .rule-band, .slab-panel, .shift-panel { border: 1px solid #E7DDD6; border-radius: 8px; display: grid; gap: 10px; padding: 12px; }
    .rule-band { grid-template-columns: minmax(260px, 1fr) 160px auto; align-items: end; background: #fbfdfc; }
    .segmented { display: flex; gap: 6px; flex-wrap: wrap; }
    .segmented button { background: #fff; border: 1px solid #E7DDD6; border-radius: 6px; color: #34483f; cursor: pointer; font-weight: 850; min-height: 36px; padding: 8px 10px; }
    .segmented button.active { background: #10201a; border-color: #10201a; color: #fff; }
    .slab-grid { align-items: center; display: grid; gap: 8px; grid-template-columns: 44px 1fr 1fr 1.5fr 36px; }
    .slab-grid.header { color: #60766d; font-size: 12px; font-weight: 900; text-transform: uppercase; }
    .icon-button { align-items: center; background: #fff; border: 1px solid #e7b1b1; border-radius: 6px; color: #a52828; cursor: pointer; display: inline-flex; font-size: 18px; font-weight: 900; height: 34px; justify-content: center; width: 34px; }
    .shift-panel { max-height: 260px; overflow: auto; }
    .shift-row { align-items: center; border-bottom: 1px solid #edf2ef; display: grid; gap: 10px; grid-template-columns: auto 1fr auto; min-height: 42px; }
    .empty { color: #61746c; padding: 16px; }
    .actions { border-top: 1px solid #edf2ef; padding-top: 12px; }
    @media (max-width: 980px) { .rule-shell, form, .metrics, .rule-band { grid-template-columns: 1fr; } }
  `]
})
export class AttendanceCategoryPage implements OnInit {
  readonly branches = signal<StaffOsBranch[]>([]);
  readonly statuses = signal<StaffOsAttendanceMaster[]>([]);
  readonly shifts = signal<StaffOsShiftMaster[]>([]);
  readonly records = signal<StaffOsAttendanceCategory[]>([]);
  readonly editing = signal<StaffOsAttendanceCategory | null>(null);
  readonly loading = signal(false);
  readonly saving = signal(false);
  readonly loadError = signal('');
  readonly saveError = signal('');
  readonly search = signal('');
  readonly branchFilter = signal('');
  readonly slabs = signal<StaffOsAttendanceSlab[]>([{ sNo: 1, fromMinutes: 0, toMinutes: 0, statusId: '', statusName: '' }]);
  readonly selectedShiftIds = signal<string[]>([]);

  readonly form = this.fb.group({
    branchId: [''],
    name: ['', Validators.required],
    workingDurationMinutes: [0],
    inTime: [''],
    outTime: [''],
    overtimeApplicable: [false],
    minimumOtDurationMinutes: [0],
    allowableLateMinutes: [0],
    lateMarkStatusId: [''],
    lateMarkAfterCount: [0],
    lateMarkMode: ['every_x_late'],
    severeLateStatusId: [''],
    severeLateAfterMinutes: [0],
    hide: [false],
    notes: [''],
    status: ['active']
  });

  constructor(private readonly api: StaffOsApi, private readonly fb: UntypedFormBuilder) {}

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.loadError.set('');
    forkJoin({
      branches: this.api.branches({ limit: 1000 }),
      statuses: this.api.attendanceMasters({ includeArchived: 'true', limit: 1000 }),
      shifts: this.api.shiftMasters({ includeArchived: 'true', limit: 1000 }),
      records: this.api.attendanceCategories({ includeArchived: 'true', branchId: this.branchFilter(), limit: 1000 })
    }).pipe(finalize(() => this.loading.set(false))).subscribe({
      next: (result) => {
        this.branches.set(result.branches);
        this.statuses.set(result.statuses);
        this.shifts.set(result.shifts);
        this.records.set(result.records);
      },
      error: (error: unknown) => this.loadError.set(this.apiError(error, 'Unable to load attendance category rules'))
    });
  }

  filteredRecords(): StaffOsAttendanceCategory[] {
    const term = this.search().trim().toLowerCase();
    return this.records().filter((record) => !term || record.name.toLowerCase().includes(term));
  }

  activeCount(): number {
    return this.records().filter((record) => record.status === 'active' && !record.hide).length;
  }

  statusOptions(): StaffOsAttendanceMaster[] {
    return this.statuses().filter((status) => status.status !== 'archived' && !status.hide);
  }

  statusLabel(status: StaffOsAttendanceMaster): string {
    const code = this.cleanStatusText(status.code || '');
    const name = this.cleanStatusText(status.name || '');
    if (code && name && code.toLowerCase() !== name.toLowerCase()) return `${code} · ${name}`;
    return name || code || 'Attendance status';
  }

  private cleanStatusText(value: string): string {
    return String(value || '')
      .replace(/\bQA\s*\d+\b/gi, '')
      .replace(/\b\d{6 }\b/g, '')
      .replace(/\s*[-·]\s*$/g, '')
      .replace(/\s{2 }/g, ' ')
      .trim();
  }

  shiftCount(): number {
    return this.records().reduce((total, record) => total + (record.allowableShiftIds?.length || 0), 0);
  }

  setBranchFilter(branchId: string): void {
    this.branchFilter.set(branchId);
    this.load();
  }

  startNew(): void {
    this.editing.set(null);
    this.saveError.set('');
    this.form.reset(this.defaultValue());
    this.slabs.set([{ sNo: 1, fromMinutes: 0, toMinutes: 0, statusId: '', statusName: '' }]);
    this.selectedShiftIds.set([]);
  }

  edit(record: StaffOsAttendanceCategory): void {
    this.editing.set(record);
    this.saveError.set('');
    this.form.reset({
      branchId: record.branchId || '',
      name: record.name,
      workingDurationMinutes: record.workingDurationMinutes || 0,
      inTime: record.inTime || '',
      outTime: record.outTime || '',
      overtimeApplicable: record.overtimeApplicable,
      minimumOtDurationMinutes: record.minimumOtDurationMinutes || 0,
      allowableLateMinutes: record.allowableLateMinutes || 0,
      lateMarkStatusId: record.lateMarkStatusId || '',
      lateMarkAfterCount: record.lateMarkAfterCount || 0,
      lateMarkMode: record.lateMarkMode || 'every_x_late',
      severeLateStatusId: record.severeLateStatusId || '',
      severeLateAfterMinutes: record.severeLateAfterMinutes || 0,
      hide: record.hide,
      notes: record.notes || '',
      status: record.status
    });
    this.slabs.set(record.attendanceSlabs?.length ? record.attendanceSlabs : [{ sNo: 1, fromMinutes: 0, toMinutes: 0, statusId: '', statusName: '' }]);
    this.selectedShiftIds.set(record.allowableShiftIds || []);
  }

  save(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const slabError = this.validateSlabs();
    if (slabError) {
      this.saveError.set(slabError);
      return;
    }
    const record = this.editing();
    const payload = this.payload(record?.version);
    this.saving.set(true);
    this.saveError.set('');
    const request = record ? this.api.updateAttendanceCategory(record.id, payload) : this.api.createAttendanceCategory(payload);
    request.pipe(finalize(() => this.saving.set(false))).subscribe({
      next: () => {
        this.startNew();
        this.load();
      },
      error: (error: unknown) => this.saveError.set(this.apiError(error, 'Unable to save attendance category'))
    });
  }

  archiveOrRestore(): void {
    const record = this.editing();
    if (!record) return;
    const restore = record.hide || record.status !== 'active';
    this.saving.set(true);
    this.api.updateAttendanceCategoryStatus(record.id, { version: record.version, status: restore ? 'active' : 'archived', hide: !restore })
      .pipe(finalize(() => this.saving.set(false)))
      .subscribe({
        next: () => {
          this.startNew();
          this.load();
        },
        error: (error: unknown) => this.saveError.set(this.apiError(error, 'Unable to update attendance category'))
      });
  }

  cancel(): void {
    this.startNew();
  }

  fieldInvalid(name: string): boolean {
    const control = this.form.get(name);
    return Boolean(control && control.invalid && (control.dirty || control.touched));
  }

  addSlab(): void {
    this.slabs.update((items) => [...items, { sNo: items.length + 1, fromMinutes: 0, toMinutes: 0, statusId: '', statusName: '' }]);
  }

  removeSlab(index: number): void {
    this.slabs.update((items) => items.filter((_, i) => i !== index).map((item, i) => ({ ...item, sNo: i + 1 })));
  }

  updateSlab(index: number, key: 'fromMinutes' | 'toMinutes', value: string): void {
    this.slabs.update((items) => items.map((item, i) => i === index ? { ...item, [key]: Number(value || 0) } : item));
  }

  updateSlabStatus(index: number, statusId: string): void {
    const status = this.statuses().find((item) => item.id === statusId);
    this.slabs.update((items) => items.map((item, i) => i === index ? { ...item, statusId, statusName: status?.name || '' } : item));
  }

  isShiftSelected(id: string): boolean {
    return this.selectedShiftIds().includes(id);
  }

  toggleShift(id: string, checked: boolean): void {
    const current = new Set(this.selectedShiftIds());
    if (checked) current.add(id);
    else current.delete(id);
    this.selectedShiftIds.set([...current]);
  }

  private payload(version?: number): Record<string, unknown> {
    const value = this.form.getRawValue();
    return {
      ...value,
      version,
      workingDurationMinutes: Number(value.workingDurationMinutes || 0),
      minimumOtDurationMinutes: Number(value.minimumOtDurationMinutes || 0),
      allowableLateMinutes: Number(value.allowableLateMinutes || 0),
      lateMarkAfterCount: Number(value.lateMarkAfterCount || 0),
      severeLateAfterMinutes: Number(value.severeLateAfterMinutes || 0),
      attendanceSlabs: this.slabs(),
      allowableShiftIds: this.selectedShiftIds()
    };
  }

  private validateSlabs(): string {
    const slabs = this.slabs().filter((slab) => slab.fromMinutes || slab.toMinutes || slab.statusId);
    for (const slab of slabs) {
      if (Number(slab.toMinutes || 0) < Number(slab.fromMinutes || 0)) return 'To Min. cannot be less than From Min. in an attendance slab.';
      if (!slab.statusId) return 'Select a status for each attendance slab.';
    }
    return '';
  }

  private defaultValue(): Record<string, unknown> {
    return {
      branchId: this.branchFilter(),
      name: '',
      workingDurationMinutes: 0,
      inTime: '',
      outTime: '',
      overtimeApplicable: false,
      minimumOtDurationMinutes: 0,
      allowableLateMinutes: 0,
      lateMarkStatusId: '',
      lateMarkAfterCount: 0,
      lateMarkMode: 'every_x_late',
      severeLateStatusId: '',
      severeLateAfterMinutes: 0,
      hide: false,
      notes: '',
      status: 'active'
    };
  }

  private apiError(error: unknown, fallback: string): string {
    const value = error as { error?: { error?: string; message?: string }; message?: string };
    return value?.error?.error || value?.error?.message || value?.message || fallback;
  }
}
