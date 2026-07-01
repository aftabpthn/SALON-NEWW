import { CommonModule } from '@angular/common';
import { Component, OnInit, signal } from '@angular/core';
import { ReactiveFormsModule, UntypedFormBuilder, Validators } from '@angular/forms';
import { finalize } from 'rxjs';
import { StaffOsStore } from '../application/staff-os.store';
import { StaffOsCategoryScope, StaffOsStaffCategory } from '../domain/staff-os.models';

const scopes: Array<{ value: StaffOsCategoryScope; label: string }> = [
  { value: 'operator', label: 'Operator' },
  { value: 'helper', label: 'Helper' },
  { value: 'admin', label: 'Admin' },
  { value: 'staff', label: 'Staff' },
  { value: 'contract_operator', label: 'Contract Operator' }
];

@Component({
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  template: `
    <section class="category-page">
      <header class="topbar">
        <div>
          <h1>Category Master</h1>
          <span>Employee category master for Add Staff onboarding. Role permissions stay separate.</span>
        </div>
        <div class="topbar-actions">
          <button type="button" class="primary" (click)="startNew()">Add</button>
          <button type="button" class="refresh" (click)="store.load()">Refresh</button>
        </div>
      </header>

      <div class="scope-tabs" role="tablist" aria-label="Staff category scopes">
        <button
          type="button"
          *ngFor="let scope of scopes"
          [class.active]="activeScope() === scope.value"
          (click)="setScope(scope.value)"
        >
          {{ scope.label }}
        </button>
      </div>

      <div *ngIf="store.loading()" class="state">Loading categories...</div>
      <div *ngIf="store.error()" class="state error">{{ store.error() }}</div>

      <section class="category-shell">
        <aside class="list-panel">
          <div class="panel-heading">
            <h2>{{ scopeLabel(activeScope()) }}</h2>
            <span>{{ scopedCategories().length }} records</span>
          </div>
          <div class="category-table">
            <div class="category-row header"><span>Category</span><span>Status</span><span>Action</span></div>
            <div class="category-row" *ngFor="let category of scopedCategories()">
              <span>{{ category.name }}</span>
              <span class="badge" [class.archived]="category.status !== 'active'">{{ category.status }}</span>
              <span class="row-actions">
                <button type="button" class="link-button" (click)="edit(category)">Edit</button>
                <button type="button" class="link-button" (click)="toggleStatus(category)">
                  {{ category.status === 'active' ? 'Archive' : 'Restore' }}
                </button>
              </span>
            </div>
            <div class="empty" *ngIf="!scopedCategories().length && !store.loading()">No categories in this scope.</div>
          </div>
        </aside>

        <main class="editor-panel">
          <form [formGroup]="categoryForm" (ngSubmit)="save()">
            <div class="form-title">
              <div>
                <p class="eyebrow">{{ editing() ? 'Edit category' : 'New category' }}</p>
                <h2>{{ editing()?.name || 'Create staff category' }}</h2>
              </div>
              <label class="hide-toggle">
                <input type="checkbox" [checked]="categoryForm.value.status === 'archived'" (change)="setArchived($any($event.target).checked)" />
                Archive / inactive
              </label>
            </div>

            <label class="field full">
              <span>Name</span>
              <input formControlName="name" placeholder="Hair Stylist, Beautician, Nail Artist" />
              <small *ngIf="fieldInvalid('name')">Category name is required.</small>
            </label>

            <label class="field">
              <span>Branch</span>
              <select formControlName="branchId">
                <option value="">All branches</option>
                <option *ngFor="let branch of store.branches()" [value]="branch.id">{{ branch.name || branch.id }}</option>
              </select>
            </label>

            <label class="field">
              <span>Scope</span>
              <select formControlName="scope">
                <option *ngFor="let scope of scopes" [value]="scope.value">{{ scope.label }}</option>
              </select>
            </label>

            <label class="field">
              <span>Default department</span>
              <input formControlName="department" placeholder="Hair, Skin, Nail, Admin" />
            </label>

            <label class="field">
              <span>Default designation</span>
              <input formControlName="defaultDesignation" placeholder="Senior stylist, Therapist" />
            </label>

            <label class="field">
              <span>Default employment type</span>
              <select formControlName="defaultEmploymentType">
                <option value="full_time">Full time</option>
                <option value="part_time">Part time</option>
                <option value="contract">Contract</option>
                <option value="freelance">Freelance</option>
                <option value="intern">Intern</option>
              </select>
            </label>

            <label class="field">
              <span>Fixed incentive amount</span>
              <input type="number" formControlName="fixedIncentiveAmount" />
            </label>

            <section class="future-tabs">
              <button type="button" class="active">Operators</button>
              <button type="button">Fixed Incentive</button>
              <button type="button">Service eligibility</button>
              <button type="button">Skill/license requirement</button>
            </section>

            <label class="field full">
              <span>Service eligibility</span>
              <textarea formControlName="serviceEligibilityText" rows="3" placeholder="Comma separated service/category names for future service assignment"></textarea>
            </label>

            <label class="field full">
              <span>Skill/license requirement</span>
              <textarea formControlName="skillLicensesText" rows="3" placeholder="Example: Hair color certified, bridal makeup training"></textarea>
            </label>

            <label class="field full">
              <span>Remarks</span>
              <textarea formControlName="notes" rows="3"></textarea>
            </label>

            <div class="state error" *ngIf="error()">{{ error() }}</div>

            <footer class="form-actions">
              <button type="button" class="refresh" (click)="cancel()">Cancel</button>
              <button type="submit" class="primary" [disabled]="categoryForm.invalid || saving()">
                {{ saving() ? 'Saving...' : 'Save' }}
              </button>
            </footer>
          </form>
        </main>
      </section>
    </section>
  `,
  styles: [`
    .category-page { display: grid; gap: 18px; padding: 24px; color: #1e1b2e; }
    .topbar, .form-title, .panel-heading { display: flex; align-items: flex-start; justify-content: space-between; gap: 14px; }
    .topbar span, .form-title span { color: #6b7280; }
    .topbar-actions, .form-actions, .row-actions { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
    .eyebrow { margin: 0 0 4px; color: #6b7280; font-size: 12px; text-transform: uppercase; letter-spacing: .08em; font-weight: 800; }
    h1, h2 { margin: 0; letter-spacing: 0; }
    h1 { font-size: 28px; }
    h2 { font-size: 18px; font-weight: 800; }
    .refresh, .primary, .link-button { border: 1px solid #d1d5db; background: #fff; border-radius: 6px; padding: 9px 14px; cursor: pointer; min-height: 36px; font-weight: 700; transition: all .15s; }
    .primary { background: #4f46e5; border-color: #4f46e5; color: #fff; }
    .primary:hover { background: #4338ca; border-color: #4338ca; }
    .primary:disabled { opacity: .55; cursor: not-allowed; }
    .refresh:hover { background: #f9fafb; border-color: #9ca3af; }
    .link-button { min-height: 30px; padding: 5px 9px; color: #4f46e5; font-weight: 700; background: transparent; border: 0; cursor: pointer; }
    .link-button:hover { text-decoration: underline; }
    .scope-tabs, .future-tabs { display: flex; gap: 6px; overflow-x: auto; padding: 6px; border: 1px solid #e0e7ff; border-radius: 8px; background: #f8f9ff; }
    .scope-tabs button, .future-tabs button { border: 1px solid transparent; border-radius: 6px; background: transparent; padding: 8px 14px; font-weight: 700; white-space: nowrap; cursor: pointer; color: #374151; transition: all .15s; }
    .scope-tabs button:hover, .future-tabs button:hover { background: #eef2ff; }
    .scope-tabs button.active, .future-tabs button.active { background: #4f46e5; border-color: #4f46e5; color: #fff; }
    .category-shell { display: grid; grid-template-columns: 1fr; gap: 18px; align-items: start; }
    .list-panel, .editor-panel, .state { border: 1px solid #e0e7ff; border-radius: 10px; background: #fff; }
    .list-panel, .editor-panel { padding: 16px; display: grid; gap: 14px; }
    .list-panel:hover, .editor-panel:hover { border-color: #c7d2fe; }
    .category-table { display: grid; border: 1px solid #eef2ff; border-radius: 8px; overflow: hidden; }
    .category-row { display: grid; grid-template-columns: 1fr .7fr 1.2fr; gap: 10px; align-items: center; min-height: 42px; border-bottom: 1px solid #eef2ff; background: #fff; padding: 0 10px; }
    .category-row:last-child { border-bottom: 0; }
    .category-row:hover { background: #f8f9ff; }
    .category-row.header { color: #6b7280; font-size: 11px; font-weight: 800; text-transform: uppercase; letter-spacing: .04em; background: #f8f9ff; }
    .badge { width: fit-content; border-radius: 999px; background: #eef2ff; color: #4f46e5; padding: 3px 9px; font-size: 11px; font-weight: 800; }
    .badge.archived { background: #fef3c7; color: #92400e; }
    form { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
    .form-title, .future-tabs, .field.full, .form-actions, form .state { grid-column: 1 / -1; }
    .field { display: grid; gap: 5px; color: #374151; font-size: 13px; font-weight: 700; }
    input, select, textarea { width: 100%; border: 1px solid #d1d5db; border-radius: 8px; padding: 9px 11px; font: inherit; color: #1e1b2e; background: #fff; transition: border-color .15s; }
    input:focus, select:focus, textarea:focus { outline: none; border-color: #4f46e5; box-shadow: 0 0 0 3px rgba(79,70,229,.12); }
    textarea { resize: vertical; min-height: 72px; }
    .field small, .error { color: #dc2626; }
    .state, .empty { padding: 14px; color: #6b7280; }
    .error { border-color: #fecaca; }
    .hide-toggle { display: inline-flex; gap: 8px; align-items: center; font-weight: 700; color: #374151; cursor: pointer; }
    .hide-toggle input { accent-color: #4f46e5; width: auto; }
    .form-actions { justify-content: flex-end; border-top: 1px solid #e0e7ff; padding-top: 14px; }
    @media (max-width: 980px) { form { grid-template-columns: 1fr; } }
  `]
})
export class StaffCategoriesPage implements OnInit {
  readonly scopes = scopes;
  readonly activeScope = signal<StaffOsCategoryScope>('operator');
  readonly editing = signal<StaffOsStaffCategory | null>(null);
  readonly saving = signal(false);
  readonly error = signal('');

  readonly categoryForm = this.fb.group({
    branchId: [''],
    name: ['', Validators.required],
    scope: ['operator', Validators.required],
    department: [''],
    defaultDesignation: [''],
    defaultEmploymentType: ['full_time'],
    fixedIncentiveAmount: [0],
    serviceEligibilityText: [''],
    skillLicensesText: [''],
    notes: [''],
    status: ['active']
  });

  constructor(public readonly store: StaffOsStore, private readonly fb: UntypedFormBuilder) {}

  ngOnInit(): void {
    this.store.load();
  }

  scopedCategories(): StaffOsStaffCategory[] {
    return this.store.staffCategories().filter((category) => category.scope === this.activeScope());
  }

  setScope(scope: StaffOsCategoryScope): void {
    this.activeScope.set(scope);
    this.startNew(scope);
  }

  startNew(scope = this.activeScope()): void {
    this.editing.set(null);
    this.error.set('');
    this.categoryForm.reset({
      branchId: '',
      name: '',
      scope,
      department: '',
      defaultDesignation: '',
      defaultEmploymentType: 'full_time',
      fixedIncentiveAmount: 0,
      serviceEligibilityText: '',
      skillLicensesText: '',
      notes: '',
      status: 'active'
    });
  }

  edit(category: StaffOsStaffCategory): void {
    this.editing.set(category);
    this.error.set('');
    this.categoryForm.reset({
      branchId: category.branchId || '',
      name: category.name,
      scope: category.scope,
      department: category.department || '',
      defaultDesignation: category.defaultDesignation || '',
      defaultEmploymentType: category.defaultEmploymentType || 'full_time',
      fixedIncentiveAmount: category.fixedIncentiveAmount || 0,
      serviceEligibilityText: (category.serviceEligibility || []).join(', '),
      skillLicensesText: (category.skillLicenses || []).join(', '),
      notes: category.notes || '',
      status: category.status
    });
  }

  save(): void {
    if (this.categoryForm.invalid) {
      this.categoryForm.markAllAsTouched();
      return;
    }
    const category = this.editing();
    const payload = this.payload();
    this.saving.set(true);
    this.error.set('');
    const request = category ? this.store.updateStaffCategory(category, payload) : this.store.createStaffCategory(payload);
    request.pipe(finalize(() => this.saving.set(false))).subscribe({
      next: () => {
        this.store.load();
        this.startNew(this.activeScope());
      },
      error: (error: { error?: { error?: string; message?: string }; message?: string }) => {
        this.error.set(error?.error?.error || error?.error?.message || error?.message || 'Unable to save category');
      }
    });
  }

  toggleStatus(category: StaffOsStaffCategory): void {
    this.saving.set(true);
    this.error.set('');
    const status = category.status === 'active' ? 'archived' : 'active';
    this.store.updateStaffCategoryStatus(category, status).pipe(finalize(() => this.saving.set(false))).subscribe({
      next: () => this.store.load(),
      error: (error: { error?: { error?: string; message?: string }; message?: string }) => {
        this.error.set(error?.error?.error || error?.error?.message || error?.message || 'Unable to update category status');
      }
    });
  }

  cancel(): void {
    this.startNew(this.activeScope());
  }

  setArchived(archived: boolean): void {
    this.categoryForm.patchValue({ status: archived ? 'archived' : 'active' });
  }

  fieldInvalid(name: string): boolean {
    const control = this.categoryForm.get(name);
    return Boolean(control && control.invalid && (control.dirty || control.touched));
  }

  scopeLabel(scope: string): string {
    return scopes.find((item) => item.value === scope)?.label || scope;
  }

  private payload(): Record<string, unknown> {
    const value = this.categoryForm.getRawValue();
    return {
      branchId: value.branchId || '',
      name: value.name,
      scope: value.scope,
      department: value.department,
      defaultDesignation: value.defaultDesignation,
      defaultEmploymentType: value.defaultEmploymentType,
      fixedIncentiveAmount: Number(value.fixedIncentiveAmount || 0),
      serviceEligibility: this.csv(value.serviceEligibilityText),
      skillLicenses: this.csv(value.skillLicensesText),
      notes: value.notes,
      status: value.status
    };
  }

  private csv(value: string): string[] {
    return String(value || '').split(',').map((item) => item.trim()).filter(Boolean);
  }
}
