import { CommonModule } from '@angular/common';
import { Component, OnInit, computed, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Observable, finalize, forkJoin, switchMap, tap } from 'rxjs';
import { StaffOsApi } from '../data/staff-os.api';
import { StaffOsBranch, StaffOsServiceAssignment, StaffOsServiceOption, StaffOsStaff, StaffOsTargetRoleScope } from '../domain/staff-os.models';

@Component({
  standalone: true,
  imports: [CommonModule, RouterLink],
  template: `
    <section class="assign-page">
      <header class="topbar">
        <div>
          <h1>Employees Wise Services Assign</h1>
        </div>
        <div class="topbar-actions">
          <a class="refresh" routerLink="/staff-os/employee-masters">Masters</a>
          <button type="button" class="refresh" (click)="load()">Refresh</button>
        </div>
      </header>

      <div class="metrics">
        <article><span>Employees</span><strong>{{ staff().length }}</strong></article>
        <article><span>Services</span><strong>{{ services().length }}</strong></article>
        <article><span>Assigned</span><strong>{{ selectedServiceIds().length }}</strong></article>
        <article><span>Copy Targets</span><strong>{{ copyTargets().length }}</strong></article>
      </div>

      <div *ngIf="loading()" class="state">Loading service assignment...</div>
      <div *ngIf="error()" class="state error">{{ error() }}</div>

      <section class="employee-section">
        <div class="section-header">
          <div>
            <h2>Select Employee</h2>
          </div>
          <div class="toggles">
            <label><input type="checkbox" [checked]="includeHide()" (change)="includeHide.set($any($event.target).checked)" /> Include Hide</label>
            <label><input type="checkbox" [checked]="includeLeft()" (change)="includeLeft.set($any($event.target).checked)" /> Include Left</label>
            <label><input type="checkbox" [checked]="onlyHideLeft()" (change)="onlyHideLeft.set($any($event.target).checked)" /> Only Hide & Left</label>
          </div>
        </div>

        <div class="employee-controls">
          <div class="filters">
            <label>
              <span>Branch</span>
              <select [value]="branchFilter()" (change)="setBranch($any($event.target).value)">
                <option value="">All branches</option>
                <option *ngFor="let branch of branches()" [value]="branch.id">{{ branch.name || branch.id }}</option>
              </select>
            </label>
            <label>
              <span>Search</span>
              <input [value]="employeeSearch()" (input)="employeeSearch.set($any($event.target).value)" placeholder="Name, designation..." />
            </label>
          </div>

          <div class="role-tabs">
            <button type="button" [class.active]="roleScope() === 'operator'" (click)="setRole('operator')">Operator</button>
            <button type="button" [class.active]="roleScope() === 'admin'" (click)="setRole('admin')">Admin</button>
          </div>
        </div>

        <div class="list">
          <div class="row" *ngFor="let item of visibleStaff()" [class.active]="selectedStaff()?.id === item.id">
            <label class="copy"><input type="checkbox" [disabled]="selectedStaff()?.id === item.id" [checked]="copySelected(item.id)" (change)="toggleCopy(item, $any($event.target).checked)" /></label>
            <button type="button" (click)="selectStaff(item)">
              <strong>{{ item.fullName }}</strong>
              <small>{{ item.branchId }} · {{ item.staffCategoryName || item.designation || item.roleId || 'Staff' }}</small>
            </button>
            <em *ngIf="assignmentFor(item)">Saved</em>
          </div>
        </div>
      </section>

      <section class="services-section">
        <div class="section-header">
          <div>
            <h2>Assign Services</h2>
          </div>
          <label class="hide-toggle"><input type="checkbox" [checked]="hideRecord()" (change)="hideRecord.set($any($event.target).checked)" /> Hide this assignment</label>
        </div>

        <div class="selected-band">
          <h2>{{ selectedStaff()?.fullName || '—' }}</h2>
          <span class="staff-id" *ngIf="selectedStaff()">{{ selectedStaff()?.branchId }} · {{ selectedStaff()?.staffCategoryName || selectedStaff()?.designation || selectedStaff()?.roleId }}</span>
        </div>

        <div class="service-toolbar">
          <label>
            <span>Category</span>
            <select [value]="categoryFilter()" (change)="categoryFilter.set($any($event.target).value)">
              <option value="">All categories</option>
              <option *ngFor="let category of serviceCategories()" [value]="category">{{ category }}</option>
            </select>
          </label>
          <label>
            <span>Service Search</span>
            <input [value]="serviceSearch()" (input)="serviceSearch.set($any($event.target).value)" placeholder="Search services..." />
          </label>
          <button type="button" class="refresh mini" (click)="selectAllVisible()">Select Visible</button>
          <button type="button" class="refresh mini" (click)="clearVisible()">Clear Visible</button>
        </div>

        <div class="service-grid">
          <div class="service-head"><span>Category</span><span>Service</span><span>Assign</span></div>
          <label class="service-row" *ngFor="let service of visibleServices()">
            <span>{{ service.category || 'General' }}</span>
            <strong>{{ service.name }}</strong>
            <input type="checkbox" [checked]="isServiceSelected(service.id)" (change)="toggleService(service, $any($event.target).checked)" />
          </label>
        </div>

        <label class="notes">
          <span>Remarks</span>
          <textarea rows="2" [value]="notes()" (input)="notes.set($any($event.target).value)" placeholder="Optional notes..."></textarea>
        </label>

        <div class="state error" *ngIf="saveError()">{{ saveError() }}</div>

        <footer class="actions">
          <button type="button" class="refresh" (click)="reset()">Cancel</button>
          <button type="button" class="refresh danger" *ngIf="selectedAssignment()" (click)="archiveOrRestore()">{{ archived() ? 'Restore' : 'Archive' }}</button>
          <button type="button" class="primary" [disabled]="!selectedStaff() || saving()" (click)="save()">{{ saving() ? 'Saving...' : 'Save' }}</button>
          <button type="button" class="primary secondary" [disabled]="!selectedAssignment() || !copyTargets().length || saving()" (click)="saveAndCopy()">Save & Copy To</button>
        </footer>
      </section>
    </section>
  `,
  styles: [`
    .assign-page { color: #1e1b2e; display: grid; gap: 28px; padding: 24px; }
    .topbar, .selected-band, .topbar-actions, .actions { align-items: flex-start; display: flex; gap: 12px; justify-content: space-between; }
    .topbar-actions, .actions { align-items: center; justify-content: flex-end; flex-wrap: wrap; }
    .eyebrow { color: #6b7280; font-size: 12px; font-weight: 850; letter-spacing: .08em; margin: 0 0 5px; text-transform: uppercase; }
    h1, h2 { letter-spacing: 0; margin: 0; }
    h1 { font-size: 28px; }
    h2 { font-size: 18px; font-weight: 800; }
    .metrics { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; }
    .metrics article { background: #fff; border: 1px solid #e0e7ff; border-radius: 10px; padding: 16px 18px; box-shadow: 0 1px 3px rgba(79,70,229,.06); }
    .metrics article:hover { border-color: #c7d2fe; }
    .metrics span { color: #6b7280; font-size: 11px; font-weight: 800; text-transform: uppercase; letter-spacing: .04em; }
    .metrics strong { display: block; font-size: 22px; margin-top: 5px; color: #4f46e5; }
    .state { background: #fff; border: 1px solid #e0e7ff; border-radius: 8px; padding: 14px; color: #6b7280; }
    .error { color: #dc2626; border-color: #fecaca; }
    .employee-section, .services-section { background: #fff; border: 1px solid #e0e7ff; border-radius: 10px; display: grid; gap: 14px; padding: 18px; }
    .employee-section:hover, .services-section:hover { border-color: #c7d2fe; }
    .section-header { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
    .toggles { display: flex; gap: 14px; align-items: center; flex-wrap: wrap; }
    .toggles label, .copy, .hide-toggle { align-items: center; color: #374151; display: inline-flex; font-size: 13px; font-weight: 600; gap: 6px; cursor: pointer; }
    .hide-toggle { gap: 8px; font-weight: 700; }
    input[type='checkbox'] { accent-color: #4f46e5; height: 16px; margin: 0; width: 16px; cursor: pointer; }
    .employee-controls { display: flex; gap: 14px; align-items: end; flex-wrap: wrap; }
    .filters { display: flex; gap: 10px; flex: 1; min-width: 260px; }
    .filters label { flex: 1; }
    .role-tabs { display: flex; gap: 4px; background: #f8f9ff; border: 1px solid #e0e7ff; border-radius: 8px; padding: 3px; }
    .role-tabs button, .refresh, .primary { border: 1px solid #d1d5db; border-radius: 6px; cursor: pointer; font-weight: 700; min-height: 36px; padding: 8px 14px; text-decoration: none; transition: all .15s; }
    .role-tabs button { background: transparent; border-color: transparent; color: #374151; font-weight: 700; min-height: 30px; padding: 5px 12px; }
    .role-tabs button.active { background: #4f46e5; color: #fff; border-color: #4f46e5; }
    .role-tabs button:not(.active):hover { background: #eef2ff; }
    .refresh { background: #fff; color: #374151; }
    .refresh:hover { background: #f9fafb; border-color: #9ca3af; }
    .primary { background: #4f46e5; border-color: #4f46e5; color: #fff; }
    .primary:hover { background: #4338ca; border-color: #4338ca; }
    .primary:disabled { opacity: .55; cursor: not-allowed; }
    .primary.secondary { background: #1e1b2e; border-color: #1e1b2e; }
    .primary.secondary:hover { background: #111827; }
    .danger { color: #dc2626; }
    .danger:hover { background: #fef2f2; border-color: #fca5a5; }
    .mini { min-height: 30px; padding: 5px 10px; font-size: 12px; }
    .service-toolbar { display: flex; gap: 10px; align-items: end; flex-wrap: wrap; background: #f8f9ff; border: 1px solid #e0e7ff; border-radius: 8px; padding: 10px 12px; }
    .service-toolbar label { min-width: 160px; flex: 1; }
    label { color: #374151; display: grid; font-size: 13px; font-weight: 700; gap: 4px; }
    input, select, textarea { border: 1px solid #d1d5db; border-radius: 8px; color: #1e1b2e; font: inherit; padding: 9px 11px; width: 100%; transition: border-color .15s; background: #fff; box-sizing: border-box; }
    input:focus, select:focus, textarea:focus { outline: none; border-color: #4f46e5; box-shadow: 0 0 0 3px rgba(79,70,229,.12); }
    .list { border: 1px solid #e0e7ff; border-radius: 8px; display: grid; max-height: 320px; overflow: auto; }
    .row { align-items: center; border-bottom: 1px solid #eef2ff; display: grid; gap: 8px; grid-template-columns: auto 1fr auto; min-height: 44px; padding: 0 8px; }
    .row:last-child { border-bottom: 0; }
    .row.active { background: #eef2ff; }
    .row:hover { background: #f8f9ff; }
    .row button { background: transparent; border: 0; cursor: pointer; padding: 6px 0; text-align: left; width: 100%; }
    .row button strong { font-size: 14px; }
    .row small { color: #6b7280; display: block; font-weight: 500; margin-top: 2px; font-size: 12px; }
    .row em { background: #eef2ff; border-radius: 999px; color: #4f46e5; font-size: 11px; font-style: normal; font-weight: 800; padding: 3px 8px; }
    .selected-band { border: 1px solid #e0e7ff; border-radius: 8px; padding: 12px 16px; background: #f8f9ff; display: grid; gap: 2px; }
    .selected-band .eyebrow { margin: 0; }
    .selected-band h2 { font-size: 16px; margin: 0; }
    .staff-id { color: #6b7280; font-size: 13px; }
    .service-grid { border: 1px solid #e0e7ff; border-radius: 8px; display: grid; max-height: 480px; overflow: auto; }
    .service-head, .service-row { align-items: center; display: grid; gap: 10px; grid-template-columns: minmax(140px, .55fr) 1fr 72px; min-height: 38px; padding: 0 12px; }
    .service-head { background: #f8f9ff; border-bottom: 1px solid #e0e7ff; font-size: 11px; font-weight: 800; color: #6b7280; text-transform: uppercase; letter-spacing: .04em; position: sticky; top: 0; z-index: 1; }
    .service-row { border-bottom: 1px solid #eef2ff; font-size: 13px; }
    .service-row:last-child { border-bottom: 0; }
    .service-row:hover { background: #f8f9ff; }
    .service-row strong { font-size: 14px; font-weight: 600; }
    .service-row input[type='checkbox'] { justify-self: center; }
    .notes { margin-top: 2px; }
    .actions { border-top: 1px solid #e0e7ff; padding-top: 14px; display: flex; gap: 10px; justify-content: flex-end; flex-wrap: wrap; }
    @media (max-width: 1060px) { .metrics { grid-template-columns: repeat(2, 1fr); } }
    @media (max-width: 700px) { .assign-page { padding: 16px; } .metrics { grid-template-columns: 1fr; } .employee-controls { flex-direction: column; } .filters { flex-direction: column; } .service-toolbar { flex-direction: column; } .service-toolbar label { min-width: auto; } .topbar { display: grid; } .service-head span:first-child, .service-row span { display: none; } .service-head, .service-row { grid-template-columns: 1fr auto; } }
  `]
})
export class ServiceAssignmentPage implements OnInit {
  readonly branches = signal<StaffOsBranch[]>([]);
  readonly staff = signal<StaffOsStaff[]>([]);
  readonly services = signal<StaffOsServiceOption[]>([]);
  readonly assignments = signal<StaffOsServiceAssignment[]>([]);
  readonly selectedStaff = signal<StaffOsStaff | null>(null);
  readonly selectedAssignment = signal<StaffOsServiceAssignment | null>(null);
  readonly selectedServiceIds = signal<string[]>([]);
  readonly selectedServiceSnapshot = signal<StaffOsServiceOption[]>([]);
  readonly copyTargets = signal<StaffOsStaff[]>([]);
  readonly roleScope = signal<StaffOsTargetRoleScope>('operator');
  readonly branchFilter = signal('');
  readonly employeeSearch = signal('');
  readonly serviceSearch = signal('');
  readonly categoryFilter = signal('');
  readonly includeHide = signal(false);
  readonly includeLeft = signal(false);
  readonly onlyHideLeft = signal(false);
  readonly hideRecord = signal(false);
  readonly notes = signal('');
  readonly loading = signal(false);
  readonly saving = signal(false);
  readonly error = signal('');
  readonly saveError = signal('');

  readonly serviceCategories = computed(() => Array.from(new Set(this.services().map((service) => service.category || 'General'))).sort());

  constructor(private readonly api: StaffOsApi) {}

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.error.set('');
    forkJoin({
      branches: this.api.branches({ limit: 1000 }),
      staff: this.api.staff({ includeArchived: 'true', branchId: this.branchFilter(), limit: 1000 }),
      services: this.api.services({ limit: 10000 }),
      assignments: this.api.serviceAssignments({ branchId: this.branchFilter(), roleScope: this.roleScope(), includeArchived: 'true', limit: 1000 })
    }).pipe(finalize(() => this.loading.set(false))).subscribe({
      next: (result) => {
        this.branches.set(result.branches);
        this.staff.set(result.staff);
        this.services.set(result.services || []);
        this.assignments.set(result.assignments);
        this.reselect();
      },
      error: (error: unknown) => this.error.set(this.apiError(error, 'Unable to load service assignment'))
    });
  }

  visibleStaff(): StaffOsStaff[] {
    const term = this.employeeSearch().trim().toLowerCase();
    return this.staff().filter((staff) => {
      const hidden = staff.status === 'archived' || staff.status === 'inactive' || staff.employeeDetails?.hideFromRoster;
      const left = Boolean(staff.employeeDetails?.lastWorkingDate);
      if (this.onlyHideLeft() && !hidden && !left) return false;
      if (!this.includeHide() && hidden) return false;
      if (!this.includeLeft() && left) return false;
      if (this.branchFilter() && staff.branchId !== this.branchFilter()) return false;
      if (this.roleScope() === 'admin') return staff.staffCategoryScope === 'admin' || ['admin', 'manager', 'superAdmin'].includes(staff.roleId || '');
      if (staff.staffCategoryScope === 'admin') return false;
      return !term || staff.fullName.toLowerCase().includes(term) || String(staff.staffCategoryName || staff.designation || '').toLowerCase().includes(term);
    });
  }

  visibleServices(): StaffOsServiceOption[] {
    const term = this.serviceSearch().trim().toLowerCase();
    const category = this.categoryFilter();
    return this.services().filter((service) =>
      (!category || (service.category || 'General') === category) &&
      (!term || service.name.toLowerCase().includes(term) || String(service.category || '').toLowerCase().includes(term))
    );
  }

  setRole(role: StaffOsTargetRoleScope): void {
    this.roleScope.set(role);
    this.reset();
    this.load();
  }

  setBranch(branchId: string): void {
    this.branchFilter.set(branchId);
    this.reset();
    this.load();
  }

  selectStaff(staff: StaffOsStaff): void {
    this.selectedStaff.set(staff);
    const assignment = this.assignmentFor(staff);
    this.selectedAssignment.set(assignment || null);
    this.selectedServiceIds.set(assignment?.serviceIds || []);
    this.selectedServiceSnapshot.set(assignment?.services || []);
    this.hideRecord.set(Boolean(assignment?.hide));
    this.notes.set(assignment?.notes || '');
    this.saveError.set('');
  }

  assignmentFor(staff: StaffOsStaff): StaffOsServiceAssignment | undefined {
    return this.assignments().find((item) => item.staffId === staff.id && item.roleScope === this.roleScope());
  }

  isServiceSelected(id: string): boolean {
    return this.selectedServiceIds().includes(id);
  }

  toggleService(service: StaffOsServiceOption, checked: boolean): void {
    if (checked) {
      this.selectedServiceIds.update((items) => items.includes(service.id) ? items : [...items, service.id]);
      this.selectedServiceSnapshot.update((items) => items.some((item) => item.id === service.id) ? items : [...items, service]);
      return;
    }
    this.selectedServiceIds.update((items) => items.filter((id) => id !== service.id));
    this.selectedServiceSnapshot.update((items) => items.filter((item) => item.id !== service.id));
  }

  selectAllVisible(): void {
    for (const service of this.visibleServices()) this.toggleService(service, true);
  }

  clearVisible(): void {
    for (const service of this.visibleServices()) this.toggleService(service, false);
  }

  toggleCopy(staff: StaffOsStaff, checked: boolean): void {
    this.copyTargets.update((items) => checked
      ? items.some((item) => item.id === staff.id) ? items : [...items, staff]
      : items.filter((item) => item.id !== staff.id));
  }

  copySelected(id: string): boolean {
    return this.copyTargets().some((item) => item.id === id);
  }

  archived(): boolean {
    const assignment = this.selectedAssignment();
    return Boolean(assignment?.hide || assignment?.status !== 'active');
  }

  save(): void {
    const staff = this.selectedStaff();
    if (!staff) return;
    this.saving.set(true);
    this.saveError.set('');
    this.saveRequest()
      .pipe(finalize(() => this.saving.set(false)))
      .subscribe({
        next: (saved) => {
          this.selectedAssignment.set(saved);
          this.load();
        },
        error: (error: unknown) => this.saveError.set(this.apiError(error, 'Unable to save service assignment'))
      });
  }

  saveAndCopy(): void {
    if (!this.selectedAssignment() || !this.copyTargets().length) return;
    this.saving.set(true);
    this.saveError.set('');
    this.saveRequest()
      .pipe(
        tap((saved) => this.selectedAssignment.set(saved)),
        switchMap((saved) => this.api.copyServiceAssignment(saved.id, {
          targets: this.copyTargets().map((staff) => ({
            staffId: staff.id,
            staffName: staff.fullName,
            branchId: staff.branchId,
            roleScope: this.roleScope()
          }))
        })),
        finalize(() => this.saving.set(false))
      )
      .subscribe({
        next: () => {
          this.copyTargets.set([]);
          this.load();
        },
        error: (error: unknown) => this.saveError.set(this.apiError(error, 'Unable to save and copy service assignment'))
      });
  }

  archiveOrRestore(): void {
    const assignment = this.selectedAssignment();
    if (!assignment) return;
    const restore = this.archived();
    this.saving.set(true);
    this.api.updateServiceAssignmentStatus(assignment.id, { version: assignment.version, status: restore ? 'active' : 'archived', hide: !restore })
      .pipe(finalize(() => this.saving.set(false)))
      .subscribe({
        next: () => this.load(),
        error: (error: unknown) => this.saveError.set(this.apiError(error, 'Unable to update service assignment'))
      });
  }

  reset(): void {
    this.selectedStaff.set(null);
    this.selectedAssignment.set(null);
    this.selectedServiceIds.set([]);
    this.selectedServiceSnapshot.set([]);
    this.copyTargets.set([]);
    this.hideRecord.set(false);
    this.notes.set('');
    this.saveError.set('');
  }

  private saveRequest(): Observable<StaffOsServiceAssignment> {
    const staff = this.selectedStaff();
    const assignment = this.selectedAssignment();
    const payload = {
      staffId: staff?.id,
      staffName: staff?.fullName,
      branchId: staff?.branchId || this.branchFilter(),
      roleScope: this.roleScope(),
      serviceIds: this.selectedServiceIds(),
      services: this.selectedServiceSnapshot(),
      categoryFilters: this.categoryFilter() ? [this.categoryFilter()] : [],
      hide: this.hideRecord(),
      notes: this.notes(),
      status: this.hideRecord() ? 'archived' : 'active',
      ...(assignment ? { version: assignment.version } : {})
    };
    return assignment ? this.api.updateServiceAssignment(assignment.id, payload) : this.api.createServiceAssignment(payload);
  }

  private reselect(): void {
    const selected = this.selectedStaff();
    if (!selected) return;
    const found = this.visibleStaff().find((staff) => staff.id === selected.id);
    if (found) this.selectStaff(found);
  }

  private apiError(error: unknown, fallback: string): string {
    const value = error as { error?: { error?: string; message?: string }; message?: string };
    return value?.error?.error || value?.error?.message || value?.message || fallback;
  }
}
