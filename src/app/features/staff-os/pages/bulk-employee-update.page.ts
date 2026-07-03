import { CommonModule } from '@angular/common';
import { Component, OnInit, computed, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { finalize, forkJoin } from 'rxjs';
import { StaffOsApi } from '../data/staff-os.api';
import { StaffOsBranch, StaffOsBulkEmployeeRow, StaffOsBulkEmployeeUpdateJob, StaffOsStaffCategory } from '../domain/staff-os.models';

type EditableBulkEmployeeRow = StaffOsBulkEmployeeRow & { dirty?: boolean };
type BulkField = keyof EditableBulkEmployeeRow;

@Component({
  standalone: true,
  imports: [CommonModule, RouterLink],
  template: `
    <section class="bulk-page">
      <header class="topbar">
        <div>
          <h1>Employee Master - Bulk Edit</h1>
        </div>
        <div class="topbar-actions">
          <a class="refresh" routerLink="/staff-os/employee-masters">Masters</a>
          <button type="button" class="refresh" (click)="exportCsv()" [disabled]="!rows().length">Excel</button>
          <button type="button" class="refresh" (click)="load()">Refresh</button>
          <button type="button" class="primary" [disabled]="saving() || !selectedRows().length" (click)="applyUpdate()">
            {{ saving() ? 'Updating...' : 'Update' }}
          </button>
        </div>
      </header>

      <section class="filter-bar">
        <span>Branch</span>
        <label><input type="radio" name="branchMode" [checked]="branchMode() === 'all'" (change)="setBranchMode('all')" /> All</label>
        <label><input type="radio" name="branchMode" [checked]="branchMode() === 'selected'" (change)="setBranchMode('selected')" /> Selected</label>
        <select [disabled]="branchMode() === 'all'" [value]="branchId()" (change)="selectBranch($any($event.target).value)">
          <option value="">Select branch</option>
          <option *ngFor="let branch of branches()" [value]="branch.id">{{ branch.name || branch.id }}</option>
        </select>
        <button type="button" class="refresh compact" (click)="selectAllVisible()">Select Visible</button>
        <button type="button" class="refresh compact" (click)="clearSelection()">Clear</button>
        <strong>Total Records: {{ visibleRows().length }}</strong>
      </section>

      <div class="metrics">
        <article><span>Rows</span><strong>{{ rows().length }}</strong></article>
        <article><span>Selected</span><strong>{{ selectedRows().length }}</strong></article>
        <article><span>Dirty</span><strong>{{ dirtyCount() }}</strong></article>
        <article><span>Updated</span><strong>{{ lastJob()?.updatedRows || 0 }}</strong></article>
        <article><span>Failed</span><strong>{{ lastJob()?.failedRows || 0 }}</strong></article>
      </div>

      <div *ngIf="loading()" class="state">Loading employee bulk grid...</div>
      <div *ngIf="error()" class="state error">{{ error() }}</div>
      <div *ngIf="saveMessage()" class="state success">{{ saveMessage() }}</div>

      <section class="grid-shell">
        <table>
          <thead>
            <tr class="group-row">
              <th class="sticky select-col"></th>
              <th class="sticky sr-col"></th>
              <th colspan="11">Personal Details</th>
              <th colspan="2">Statutory Details</th>
            </tr>
            <tr>
              <th class="sticky select-col"><input type="checkbox" [checked]="allVisibleSelected()" (change)="toggleAllVisible($any($event.target).checked)" /></th>
              <th class="sticky sr-col">Sr. No</th>
              <th>Employee Name</th>
              <th>Short Name</th>
              <th>Branch</th>
              <th>Type</th>
              <th>Category</th>
              <th>Designation</th>
              <th>Joining Date</th>
              <th>Left Date</th>
              <th>Hide</th>
              <th>Date of Birth</th>
              <th>Ann. Date</th>
              <th>Gender</th>
              <th>PAN No</th>
              <th>Aadhar No</th>
            </tr>
          </thead>
          <tbody>
            <tr *ngFor="let row of visibleRows(); let i = index" [class.dirty]="row.dirty">
              <td class="sticky select-col"><input type="checkbox" [checked]="selectedIds().includes(row.staffId)" (change)="toggleRow(row.staffId, $any($event.target).checked)" /></td>
              <td class="sticky sr-col">{{ i + 1 }}</td>
              <td><input [value]="row.employeeName" (input)="updateRow(row.staffId, 'employeeName', $any($event.target).value)" /></td>
              <td><input [value]="row.shortName || ''" (input)="updateRow(row.staffId, 'shortName', $any($event.target).value)" /></td>
              <td>
                <select [value]="row.branchId || ''" (change)="updateRow(row.staffId, 'branchId', $any($event.target).value)">
                  <option value="">Branch</option>
                  <option *ngFor="let branch of branches()" [value]="branch.id">{{ branch.name || branch.id }}</option>
                </select>
              </td>
              <td>
                <select [value]="row.type || ''" (change)="updateRow(row.staffId, 'type', $any($event.target).value)">
                  <option value="">Type</option>
                  <option value="operator">Operator</option>
                  <option value="helper">Helper</option>
                  <option value="admin">Admin</option>
                  <option value="staff">Staff</option>
                  <option value="contract_operator">Cont. Oprs.</option>
                  <option value="full_time">Full Time</option>
                  <option value="part_time">Part Time</option>
                </select>
              </td>
              <td>
                <select [value]="row.categoryId || ''" (change)="updateRow(row.staffId, 'categoryId', $any($event.target).value)">
                  <option value="">Category</option>
                  <option *ngFor="let category of categories()" [value]="category.id">{{ category.name }}</option>
                </select>
              </td>
              <td><input [value]="row.designation || ''" (input)="updateRow(row.staffId, 'designation', $any($event.target).value)" /></td>
              <td><input type="date" [value]="row.joiningDate || ''" (input)="updateRow(row.staffId, 'joiningDate', $any($event.target).value)" /></td>
              <td><input type="date" [value]="row.leftDate || ''" (input)="updateRow(row.staffId, 'leftDate', $any($event.target).value)" /></td>
              <td class="center"><input type="checkbox" [checked]="row.hide" (change)="updateRow(row.staffId, 'hide', $any($event.target).checked)" /></td>
              <td><input type="date" [value]="row.dateOfBirth || ''" (input)="updateRow(row.staffId, 'dateOfBirth', $any($event.target).value)" /></td>
              <td><input type="date" [value]="row.anniversaryDate || ''" (input)="updateRow(row.staffId, 'anniversaryDate', $any($event.target).value)" /></td>
              <td>
                <select [value]="row.gender || ''" (change)="updateRow(row.staffId, 'gender', $any($event.target).value)">
                  <option value="">Gender</option>
                  <option value="male">Male</option>
                  <option value="female">Female</option>
                  <option value="other">Other</option>
                </select>
              </td>
              <td><input [value]="row.panNo || ''" (input)="updateRow(row.staffId, 'panNo', $any($event.target).value.toUpperCase())" maxlength="10" /></td>
              <td><input [value]="row.aadharNo || ''" (input)="updateRow(row.staffId, 'aadharNo', $any($event.target).value)" maxlength="12" /></td>
            </tr>
            <tr *ngIf="!visibleRows().length">
              <td colspan="16" class="empty">No employee records found for selected branch.</td>
            </tr>
          </tbody>
        </table>
      </section>

      <section class="job-panel" *ngIf="lastJob()">
        <header>
          <strong>Last Update Job</strong>
          <span>{{ lastJob()?.status }}</span>
        </header>
        <div class="job-results">
          <article *ngFor="let result of lastJob()?.results || []" [class.failed]="result.status === 'failed'">
            <strong>{{ result.staffId }}</strong>
            <span>{{ result.status }}</span>
            <small *ngIf="result.error">{{ result.error }}</small>
          </article>
        </div>
      </section>
    </section>
  `,
  styles: [`
    .bulk-page { color: #10201a; display: grid; gap: 18px; padding: 24px; }
    .topbar, .topbar-actions, .filter-bar { align-items: flex-start; display: flex; gap: 12px; justify-content: space-between; }
    .topbar-actions { align-items: center; flex-wrap: wrap; justify-content: flex-end; }
    .eyebrow { color: #547066; font-size: 12px; font-weight: 850; letter-spacing: .08em; margin: 0 0 5px; text-transform: uppercase; }
    h1 { font-size: 30px; letter-spacing: 0; margin: 0; }
    .refresh, .primary { border: 1px solid #cbd8d2; border-radius: 6px; cursor: pointer; font-weight: 850; min-height: 38px; padding: 9px 12px; text-decoration: none; }
    .refresh { background: #fff; color: #34483f; }
    .primary { background: #4B1238; border-color: #4B1238; color: #fff; }
    .compact { min-height: 34px; padding: 7px 10px; }
    button:disabled { cursor: not-allowed; opacity: .58; }
    .filter-bar, .metrics article, .state, .grid-shell, .job-panel { background: #fff; border: 1px solid #d9e5de; border-radius: 8px; }
    .filter-bar { align-items: center; justify-content: flex-start; flex-wrap: wrap; padding: 12px; }
    .filter-bar span, .filter-bar strong { color: #34483f; font-weight: 900; }
    .filter-bar label { align-items: center; display: inline-flex; font-size: 13px; font-weight: 850; gap: 7px; }
    .filter-bar select { width: 180px; }
    .metrics { display: grid; gap: 12px; grid-template-columns: repeat(5, minmax(120px, 1fr)); }
    .metrics article, .state { padding: 14px; }
    .metrics span { color: #60766d; font-size: 12px; font-weight: 850; text-transform: uppercase; }
    .metrics strong { display: block; font-size: 24px; margin-top: 6px; }
    .state { color: #61746c; }
    .state.error { color: #a52828; border-color: #e7b1b1; }
    .state.success { color: #286345; border-color: #bddccc; }
    .grid-shell { max-height: 64vh; overflow: auto; }
    table { border-collapse: separate; border-spacing: 0; min-width: 1680px; width: 100%; }
    th, td { border-bottom: 1px solid #e8efeb; border-right: 1px solid #eef3f0; font-size: 13px; min-width: 126px; padding: 6px; text-align: left; vertical-align: middle; }
    th { background: #f8fbf9; color: #34483f; font-weight: 900; position: sticky; top: 34px; z-index: 3; }
    .group-row th { background: #edf5f1; top: 0; z-index: 4; text-align: center; }
    .sticky { left: 0; position: sticky; z-index: 5; }
    .select-col { min-width: 46px; width: 46px; }
    .sr-col { left: 46px; min-width: 70px; width: 70px; }
    td.sticky { background: #fff; }
    tr.dirty td { background: #fffaf0; }
    tr.dirty td.sticky { background: #fffaf0; }
    input, select { border: 1px solid #cbd8d2; border-radius: 6px; color: #10201a; font: inherit; min-height: 34px; padding: 7px 8px; width: 100%; }
    input[type='checkbox'] { height: 18px; min-height: 0; padding: 0; width: 18px; }
    .center { text-align: center; }
    .empty { color: #60766d; font-weight: 850; padding: 22px; text-align: center; }
    .job-panel { display: grid; gap: 12px; padding: 14px; }
    .job-panel header { align-items: center; display: flex; justify-content: space-between; }
    .job-panel header span { color: #60766d; font-size: 12px; font-weight: 900; text-transform: uppercase; }
    .job-results { display: grid; gap: 8px; grid-template-columns: repeat(3, minmax(0, 1fr)); }
    .job-results article { background: #f8fbf9; border: 1px solid #e8efeb; border-radius: 8px; display: grid; gap: 4px; padding: 10px; }
    .job-results article.failed { background: #fff5f5; border-color: #e7b1b1; }
    .job-results small { color: #a52828; }
    @media (max-width: 900px) {
      .bulk-page { padding: 16px; }
      .topbar { display: grid; }
      .metrics, .job-results { grid-template-columns: 1fr; }
      .grid-shell { max-height: 70vh; }
    }
  `]
})
export class BulkEmployeeUpdatePage implements OnInit {
  readonly branches = signal<StaffOsBranch[]>([]);
  readonly categories = signal<StaffOsStaffCategory[]>([]);
  readonly rows = signal<EditableBulkEmployeeRow[]>([]);
  readonly selectedIds = signal<string[]>([]);
  readonly branchMode = signal<'all' | 'selected'>('all');
  readonly branchId = signal('');
  readonly loading = signal(false);
  readonly saving = signal(false);
  readonly error = signal('');
  readonly saveMessage = signal('');
  readonly lastJob = signal<StaffOsBulkEmployeeUpdateJob | null>(null);

  readonly visibleRows = computed(() => {
    const branchId = this.branchId();
    if (this.branchMode() === 'all' || !branchId) return this.rows();
    return this.rows().filter((row) => row.branchId === branchId);
  });
  readonly selectedRows = computed(() => {
    const selected = new Set(this.selectedIds());
    return this.rows().filter((row) => selected.has(row.staffId));
  });
  readonly dirtyCount = computed(() => this.rows().filter((row) => row.dirty).length);
  readonly allVisibleSelected = computed(() => {
    const visible = this.visibleRows();
    return Boolean(visible.length) && visible.every((row) => this.selectedIds().includes(row.staffId));
  });

  constructor(private readonly api: StaffOsApi) {}

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.error.set('');
    this.saveMessage.set('');
    forkJoin({
      branches: this.api.branches({ limit: 1000 }),
      categories: this.api.staffCategories({ includeArchived: 'true', limit: 1000 }),
      rows: this.api.bulkEmployeeRows({ branchId: this.branchMode() === 'selected' ? this.branchId() : '', limit: 1000 })
    }).pipe(finalize(() => this.loading.set(false))).subscribe({
      next: ({ branches, categories, rows }) => {
        this.branches.set(branches);
        this.categories.set(categories);
        this.rows.set(rows.map((row) => ({ ...row, dirty: false })));
        this.selectedIds.set([]);
      },
      error: (error: unknown) => this.error.set(this.apiError(error, 'Unable to load bulk employee grid'))
    });
  }

  setBranchMode(mode: 'all' | 'selected'): void {
    this.branchMode.set(mode);
    this.load();
  }

  selectBranch(branchId: string): void {
    this.branchId.set(branchId);
    if (this.branchMode() === 'selected') this.load();
  }

  updateRow(staffId: string, field: BulkField, value: unknown): void {
    this.rows.update((rows) => rows.map((row) => row.staffId === staffId ? { ...row, [field]: value, dirty: true } : row));
    this.toggleRow(staffId, true);
  }

  toggleRow(staffId: string, checked: boolean): void {
    this.selectedIds.update((ids) => {
      if (checked) return ids.includes(staffId) ? ids : [...ids, staffId];
      return ids.filter((id) => id !== staffId);
    });
  }

  toggleAllVisible(checked: boolean): void {
    if (!checked) {
      const visible = new Set(this.visibleRows().map((row) => row.staffId));
      this.selectedIds.update((ids) => ids.filter((id) => !visible.has(id)));
      return;
    }
    this.selectAllVisible();
  }

  selectAllVisible(): void {
    const visibleIds = this.visibleRows().map((row) => row.staffId);
    this.selectedIds.update((ids) => Array.from(new Set([...ids, ...visibleIds])));
  }

  clearSelection(): void {
    this.selectedIds.set([]);
  }

  applyUpdate(): void {
    const rows = this.selectedRows();
    if (!rows.length) {
      this.saveMessage.set('');
      this.error.set('Select at least one employee row before update.');
      return;
    }
    this.saving.set(true);
    this.error.set('');
    this.saveMessage.set('');
    this.api.applyBulkEmployeeUpdate({ branchId: this.branchMode() === 'selected' ? this.branchId() : '', rows })
      .pipe(finalize(() => this.saving.set(false)))
      .subscribe({
        next: (job) => {
          this.lastJob.set(job);
          this.saveMessage.set(`Bulk update complete: ${job.updatedRows} updated, ${job.failedRows} failed.`);
          this.load();
        },
        error: (error: unknown) => this.error.set(this.apiError(error, 'Unable to apply bulk employee update'))
      });
  }

  exportCsv(): void {
    const headers = ['Employee Name', 'Short Name', 'Branch', 'Type', 'Category', 'Designation', 'Joining Date', 'Left Date', 'Hide', 'Date Of Birth', 'Anniversary Date', 'Gender', 'PAN No', 'Aadhar No'];
    const lines = [headers.join(',')];
    for (const row of this.visibleRows()) {
      lines.push([
        row.employeeName,
        row.shortName,
        row.branchId,
        row.type,
        row.categoryName || row.categoryId,
        row.designation,
        row.joiningDate,
        row.leftDate,
        row.hide ? 'Yes' : 'No',
        row.dateOfBirth,
        row.anniversaryDate,
        row.gender,
        row.panNo,
        row.aadharNo
      ].map((value) => `"${String(value || '').replace(/"/g, '""')}"`).join(','));
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `employee-bulk-update-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  private apiError(error: unknown, fallback: string): string {
    const value = error as { error?: { error?: string; message?: string }; message?: string };
    return value?.error?.error || value?.error?.message || value?.message || fallback;
  }
}
