import { CommonModule } from '@angular/common';
import { Component, OnInit, computed, signal } from '@angular/core';
import { ReactiveFormsModule, UntypedFormBuilder, Validators } from '@angular/forms';
import { ApiRecord, ApiService } from '../core/api.service';
import { StateComponent } from '../shared/ui/state/state.component';

@Component({
  selector: 'app-permission-matrix',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, StateComponent],
  template: `
    <section class="permissions-workspace">
      <section class="zenoti-header">
        <div class="center-line">
          <strong>malad</strong>
          <div class="header-actions">
            <button class="zenoti-button" type="button" (click)="load()">Role library</button>
            <button class="zenoti-button" type="button">Access matrix</button>
            <button class="zenoti-button" type="button">Audit ready</button>
          </div>
        </div>
        <select class="command-select" aria-label="Permission quick action" (change)="runQuickAction($event)">
          <option>I want to ...</option>
          <option value="refresh">Refresh matrix</option>
          <option value="save">Save custom role</option>
          <option value="owner">Use owner role key</option>
          <option value="manager">Use manager role key</option>
        </select>
      </section>

      <div class="page-heading">
        <div>
          <h1>Permission matrix</h1>
          <p>Security &gt; Detailed role access for owner, manager, receptionist, staff, accountant and custom roles</p>
        </div>
        <label class="search-field">
          <span>Visible resources</span>
          <input [value]="(matrix()?.resources?.length || 0) + ' resources in matrix'" readonly />
        </label>
      </div>

      <app-state [loading]="loading()" [error]="error()"></app-state>

      <div class="metric-strip">
        <article><span>Roles</span><strong>{{ roles().length }}</strong><small>System and custom roles</small></article>
        <article><span>Resources</span><strong>{{ matrix()?.resources?.length || 0 }}</strong><small>Access surfaces</small></article>
        <article><span>Visible columns</span><strong>{{ visibleResources().length }}</strong><small>Current matrix view</small></article>
        <article><span>System roles</span><strong>{{ systemRoleCount() }}</strong><small>Protected defaults</small></article>
        <article><span>Custom roles</span><strong>{{ customRoleCount() }}</strong><small>Tenant configured</small></article>
        <article><span>Static grants</span><strong>{{ staticGrantCount() }}</strong><small>Role-level grants</small></article>
      </div>

      <div class="dashboard-grid workdesk">
        <section class="form-panel">
          <h3>Create or update custom role</h3>
          <form [formGroup]="roleForm" (ngSubmit)="saveRole()">
            <label class="field"><span>Role key</span><input formControlName="role" /></label>
            <label class="field"><span>Name</span><input formControlName="name" /></label>
            <label class="field full"><span>Description</span><input formControlName="description" /></label>
            <label class="field"><span>Resource</span><input formControlName="resource" /></label>
            <label class="field"><span>Actions CSV</span><input formControlName="actions" /></label>
            <div class="form-actions">
              <button class="primary-button" type="submit" [disabled]="roleForm.invalid || saving()">Save role</button>
            </div>
          </form>
        </section>

        <section class="panel">
          <div class="section-title"><h2>Role library</h2></div>
          <div class="rank-list">
            <article *ngFor="let role of roles()">
              <div>
                <strong>{{ role.name }}</strong>
                <span>{{ role.role }} · {{ role.isSystem ? 'system' : 'custom' }}</span>
              </div>
              <span class="badge">{{ role.staticGrants?.length || 0 }} static grants</span>
            </article>
          </div>
        </section>
      </div>

      <section class="panel">
        <div class="section-title">
          <h2>Access matrix</h2>
          <span>{{ matrix()?.resources?.length || 0 }} resources</span>
        </div>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Role</th>
                <th *ngFor="let resource of visibleResources()">{{ resource }}</th>
              </tr>
            </thead>
            <tbody>
              <tr *ngFor="let row of accessRows()">
                <td><strong>{{ row.role }}</strong></td>
                <td *ngFor="let resource of visibleResources()">
                  <span class="badge" *ngIf="row.resources?.[resource]?.admin">admin</span>
                  <span class="badge success" *ngIf="!row.resources?.[resource]?.admin && row.resources?.[resource]?.write">write</span>
                  <span class="badge" *ngIf="!row.resources?.[resource]?.admin && !row.resources?.[resource]?.write && row.resources?.[resource]?.read">read</span>
                  <span class="muted" *ngIf="!row.resources?.[resource]?.read && !row.resources?.[resource]?.write && !row.resources?.[resource]?.admin">none</span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <pre class="result-json" *ngIf="result()">{{ result() | json }}</pre>
    </section>
  `,
  styles: [`
    .permissions-workspace { display: grid; gap: 0; color: #1d2430; background: #f7f9fb; min-height: calc(100vh - 20px); }
    .command-bar { display: flex; justify-content: space-between; align-items: center; gap: 16px; padding: 14px 20px; background: #111827; color: #fff; border-bottom: 1px solid #d8e1ea; }
    .brand-block, .top-actions, .center-line, .header-actions, .form-actions { display: flex; align-items: center; gap: 10px; }
    .brand-mark { width: 34px; height: 34px; display: grid; place-items: center; border-radius: 8px; background: #6d5bd0; color: #fff; font-weight: 900; }
    .brand-block small, .field span, .search-field span, .section-title span { display: block; color: #5f6f85; font-size: 11px; font-weight: 800; text-transform: uppercase; }
    .brand-block small { color: #8fa1b8; }
    .brand-block strong { display: block; color: #fff; font-size: 15px; }
    .zenoti-button, .primary-button, .ghost-button { border: 1px solid #b9cbe0; background: #fff; color: #0065a8; border-radius: 3px; padding: 8px 13px; font-weight: 800; cursor: pointer; }
    .zenoti-button.primary, .primary-button { background: #0b8f7c; border-color: #0b8f7c; color: #fff; }
    .zenoti-header, .page-heading, .metric-strip, .panel, .form-panel { background: #fff; border-bottom: 1px solid #d8e1ea; }
    .zenoti-header { display: grid; gap: 10px; padding: 18px 16px 12px; }
    .center-line { justify-content: space-between; }
    .center-line strong { font-size: 15px; }
    .command-select { width: 100%; padding: 9px 12px; border: 1px solid #b9cbe0; border-radius: 3px; color: #111827; font-weight: 800; background: #fff; }
    .page-heading { display: flex; justify-content: space-between; gap: 16px; padding: 16px; align-items: end; }
    .page-heading h1 { margin: 0; font-size: 22px; color: #172033; }
    .page-heading p { margin: 6px 0 0; color: #36506d; font-size: 13px; }
    .search-field { width: min(100%, 330px); display: grid; gap: 5px; }
    .search-field input, .field input { width: 100%; border: 1px solid #cbd8e5; border-radius: 3px; padding: 9px 11px; font: inherit; background: #fff; color: #172033; }
    .metric-strip { display: grid; grid-template-columns: repeat(6, minmax(145px, 1fr)); gap: 0; overflow-x: auto; }
    .metric-strip article { min-width: 145px; padding: 13px 16px; border-right: 1px solid #d8e1ea; border-top: 3px solid #0b8f7c; }
    .metric-strip article:nth-child(2) { border-top-color: #2b61d1; }
    .metric-strip article:nth-child(3) { border-top-color: #bd7400; }
    .metric-strip article:nth-child(4) { border-top-color: #16834f; }
    .metric-strip article:nth-child(5) { border-top-color: #7046d8; }
    .metric-strip article:nth-child(6) { border-top-color: #bb241a; }
    .metric-strip span, .metric-strip small, .rank-list span { display: block; color: #5f6f85; font-size: 12px; }
    .metric-strip strong { display: block; margin: 6px 0 2px; color: #172033; font-size: 24px; }
    .dashboard-grid { display: grid; grid-template-columns: minmax(360px, .85fr) minmax(520px, 1.15fr); gap: 0; border-bottom: 1px solid #d8e1ea; }
    .form-panel, .panel { border-radius: 0; box-shadow: none; border-left: 0; border-right: 0; border-top: 0; padding: 16px; }
    .dashboard-grid .form-panel { border-right: 1px solid #d8e1ea; }
    .form-panel h3, .section-title h2 { margin: 3px 0 12px; color: #172033; font-size: 18px; }
    form { display: grid; grid-template-columns: repeat(2, minmax(170px, 1fr)); gap: 10px; }
    .field { display: grid; gap: 5px; }
    .field.full, .form-actions { grid-column: 1 / -1; }
    .form-actions { justify-content: flex-end; }
    .rank-list { display: grid; gap: 0; border: 1px solid #d8e1ea; background: #fff; }
    .rank-list article { display: flex; justify-content: space-between; gap: 12px; padding: 12px; border-bottom: 1px solid #dfe7ef; }
    .rank-list article:last-child { border-bottom: 0; }
    .badge { display: inline-flex; width: max-content; padding: 4px 9px; border-radius: 999px; background: #dff7ee; color: #046452; font-weight: 800; font-size: 12px; }
    .badge.success { background: #e7f0ff; color: #2855a7; }
    .muted { color: #94a3b8; }
    .table-wrap { overflow: auto; border: 1px solid #d8e1ea; background: #fff; }
    table { width: 100%; min-width: 980px; border-collapse: collapse; }
    th, td { padding: 10px 12px; border-bottom: 1px solid #dfe7ef; text-align: left; vertical-align: middle; }
    th { background: #f4f7fa; color: #5b6b81; font-size: 12px; text-transform: uppercase; }
    tr:hover td { background: #eef7fc; }
    .result-json { max-height: 260px; overflow: auto; margin: 0; padding: 12px 16px; border-top: 1px solid #d8e1ea; background: #f8fafc; color: #172033; white-space: pre-wrap; }
    app-state { display: block; }
    @media (max-width: 1050px) {
      .dashboard-grid { grid-template-columns: 1fr; }
      .dashboard-grid .form-panel { border-right: 0; }
      .metric-strip { grid-template-columns: repeat(2, minmax(145px, 1fr)); }
    }
    @media (max-width: 760px) {
      .command-bar, .page-heading, .center-line, .rank-list article { display: grid; align-items: start; }
      .top-actions, .header-actions, .form-actions { flex-wrap: wrap; }
      .search-field { width: 100%; }
      .metric-strip, form { grid-template-columns: 1fr; }
    }
  `]
})
export class PermissionMatrixComponent implements OnInit {
  readonly matrix = signal<ApiRecord | null>(null);
  readonly result = signal<ApiRecord | null>(null);
  readonly loading = signal(false);
  readonly saving = signal(false);
  readonly error = signal('');
  readonly roles = computed(() => this.matrix()?.roles || []);
  readonly accessRows = computed(() => this.matrix()?.matrix || []);
  readonly visibleResources = computed(() => (this.matrix()?.resources || []).slice(0, 10));

  readonly roleForm = this.fb.group({
    role: ['customRetentionLead', [Validators.required, Validators.pattern(/^[a-zA-Z][a-zA-Z0-9_-]{2,40}$/)]],
    name: ['Custom retention lead', Validators.required],
    description: ['Can view customers and run retention workflows.'],
    resource: ['workflows', Validators.required],
    actions: ['read,write', Validators.required]
  });

  constructor(private readonly api: ApiService, private readonly fb: UntypedFormBuilder) {}

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.api.list<ApiRecord>('security/permission-matrix').subscribe({
      next: (matrix) => {
        this.matrix.set(matrix);
        this.loading.set(false);
      },
      error: (error) => {
        this.error.set(error?.error?.error || 'Unable to load permission matrix');
        this.loading.set(false);
      }
    });
  }

  saveRole(): void {
    if (this.roleForm.invalid) return;
    this.saving.set(true);
    const value = this.roleForm.value;
    this.api.post<ApiRecord>('security/roles', {
      role: value.role,
      name: value.name,
      description: value.description,
      permissions: [
        {
          resource: value.resource,
          actions: String(value.actions || '').split(',').map((item) => item.trim()).filter(Boolean)
        }
      ]
    }).subscribe({
      next: (response) => {
        this.result.set(response.definition);
        this.matrix.set(response.matrix);
        this.saving.set(false);
      },
      error: (error) => {
        this.error.set(error?.error?.error || 'Unable to save role');
        this.saving.set(false);
      }
    });
  }

  systemRoleCount(): number {
    return this.roles().filter((role: ApiRecord) => !!role.isSystem).length;
  }

  customRoleCount(): number {
    return this.roles().filter((role: ApiRecord) => !role.isSystem).length;
  }

  staticGrantCount(): number {
    return this.roles().reduce((total: number, role: ApiRecord) => total + Number(role.staticGrants?.length || 0), 0);
  }

  runQuickAction(event: Event): void {
    const select = event.target as HTMLSelectElement;
    const action = select.value;
    if (action === 'refresh') this.load();
    if (action === 'save') this.saveRole();
    if (action === 'owner') this.roleForm.patchValue({ role: 'owner', name: 'Owner' });
    if (action === 'manager') this.roleForm.patchValue({ role: 'manager', name: 'Manager' });
    select.selectedIndex = 0;
  }
}
