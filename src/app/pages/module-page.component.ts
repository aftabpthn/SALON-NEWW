import { CommonModule } from '@angular/common';
import { Component, OnDestroy, OnInit } from '@angular/core';
import { FormControl, FormsModule, ReactiveFormsModule, UntypedFormBuilder, UntypedFormGroup, Validators } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { Subscription } from 'rxjs';
import { ApiRecord, ApiService } from '../core/api.service';
import { AppStateService } from '../core/state/app-state.service';
import { StateComponent } from '../shared/ui/state/state.component';

type FieldConfig = {
  key: string;
  label: string;
  type?: 'text' | 'number' | 'email' | 'date' | 'json';
  required?: boolean;
  defaultValue?: any;
};

type ColumnConfig = {
  key: string;
  label: string;
  type?: 'text' | 'currency' | 'date' | 'badge' | 'json';
};

type PageConfig = {
  entity: string;
  title: string;
  subtitle?: string;
  createLabel: string;
  columns: ColumnConfig[];
  fields: FieldConfig[];
  variant?: 'zenoti';
};

type ServiceProductLockDraft = {
  uid: string;
  productId: string;
  unit: string;
  minQuantityPerService: number;
  quantityPerService: number;
  maxQuantityPerService: number;
  wastagePct: number;
  wastageApprovalPct: number;
  wastageHitLimit: number;
};

@Component({
  selector: 'app-module-page',
  standalone: true,
  imports: [CommonModule, FormsModule, ReactiveFormsModule, StateComponent],
  template: `
    <section class="page-stack" [class.zenoti-module-page]="isZenotiPage()" *ngIf="config">
      <ng-container *ngIf="isZenotiPage(); else defaultHero">
        <div class="zenoti-page-heading">
          <div>
            <h1>{{ config.title }}</h1>
            
          </div>
          <label class="zenoti-search">
            <span>{{ zenotiSearchLabel() }}</span>
            <input [(ngModel)]="query" (ngModelChange)="onQueryChange($event)" [placeholder]="zenotiSearchPlaceholder()" />
          </label>
        </div>

        <div class="zenoti-metric-strip">
          <article *ngFor="let metric of zenotiMetrics()"><span>{{ metric.label }}</span><strong>{{ metric.value }}</strong><small>{{ metric.hint }}</small></article>
        </div>
      </ng-container>

      <ng-template #defaultHero>
      <div class="module-hero">
        <div>
          <h2>{{ config.title }}</h2>
          
        </div>
        <button class="primary-button" type="button" (click)="toggleForm()">{{ showForm ? 'Close form' : config.createLabel }}</button>
      </div>
      </ng-template>

      <section class="form-panel" *ngIf="showForm">
        <form [formGroup]="form" (ngSubmit)="save()">
          <label class="field" *ngFor="let field of visibleFields()">
            <span>{{ field.label }}</span>
            <textarea *ngIf="field.type === 'json'; else scalar" [formControlName]="field.key"></textarea>
            <ng-template #scalar>
              <input [type]="field.type || 'text'" [formControlName]="field.key" />
            </ng-template>
            <small class="field-error" *ngIf="form.get(field.key)?.invalid && form.get(field.key)?.touched">Required</small>
          </label>
          <section class="service-product-lock" *ngIf="isServicesPage()">
            <div class="section-title compact">
              <div>
                <h3>Wastage lock for this service</h3>
              </div>
              <button class="ghost-button mini" type="button" (click)="addServiceProductLock()">Add product line</button>
            </div>
            <div class="service-product-lock-grid">
              <div class="service-product-lock-row head">
                <span>Product</span>
                <span>Unit</span>
                <span>Min qty</span>
                <span>Standard qty</span>
                <span>Max qty</span>
                <span>Waste %</span>
                <span>Owner approval %</span>
                <span>Hit limit</span>
                <span></span>
              </div>
              <div class="service-product-lock-row" *ngFor="let item of serviceProductLocks; trackBy: trackServiceProductLock">
                <select [ngModel]="item.productId" [ngModelOptions]="{standalone: true}" (ngModelChange)="setServiceProductLockProduct(item, $event)">
                  <option value="">Select product</option>
                  <option *ngFor="let product of serviceProductOptions()" [value]="product.id">{{ serviceProductLabel(product) }}</option>
                </select>
                <select [ngModel]="item.unit" [ngModelOptions]="{standalone: true}" (ngModelChange)="item.unit = $event">
                  <option *ngFor="let unit of serviceUnits" [value]="unit">{{ unit }}</option>
                </select>
                <input type="number" min="0" [ngModel]="item.minQuantityPerService" [ngModelOptions]="{standalone: true}" (ngModelChange)="item.minQuantityPerService = numberValue($event)" />
                <input type="number" min="0" [ngModel]="item.quantityPerService" [ngModelOptions]="{standalone: true}" (ngModelChange)="item.quantityPerService = numberValue($event)" />
                <input type="number" min="0" [ngModel]="item.maxQuantityPerService" [ngModelOptions]="{standalone: true}" (ngModelChange)="item.maxQuantityPerService = numberValue($event)" />
                <input type="number" min="0" [ngModel]="item.wastagePct" [ngModelOptions]="{standalone: true}" (ngModelChange)="item.wastagePct = numberValue($event)" />
                <input type="number" min="0" [ngModel]="item.wastageApprovalPct" [ngModelOptions]="{standalone: true}" (ngModelChange)="item.wastageApprovalPct = numberValue($event)" />
                <input type="number" min="1" [ngModel]="item.wastageHitLimit" [ngModelOptions]="{standalone: true}" (ngModelChange)="item.wastageHitLimit = numberValue($event)" />
                <button class="ghost-button mini danger" type="button" (click)="removeServiceProductLock(item.uid)" [disabled]="serviceProductLocks.length <= 1">Remove</button>
              </div>
            </div>
          </section>
          <div class="form-actions">
            <button class="ghost-button" type="button" (click)="toggleForm()">Cancel</button>
            <button class="primary-button" type="submit" [disabled]="form.invalid || saving">{{ saving ? 'Saving...' : 'Save' }}</button>
          </div>
        </form>
      </section>

      <section class="panel">
        <div class="table-toolbar">
          <label class="search-field">
            <span>Search</span>
            <input [(ngModel)]="query" (ngModelChange)="onQueryChange($event)" placeholder="Search records" />
          </label>
          <div class="service-gst-tools" *ngIf="isServicesPage()">
            <label class="field compact">
              <span>GST %</span>
              <input type="number" min="0" max="28" step="0.1" [(ngModel)]="bulkGstRate" />
            </label>
            <button class="ghost-button" type="button" (click)="applyGstToServices('category')" [disabled]="saving || !activeServiceCategory">Update category GST</button>
            <button class="primary-button" type="button" (click)="applyGstToServices('all')" [disabled]="saving">Update filtered GST</button>
          </div>
          <button class="ghost-button" type="button" (click)="load()">Refresh</button>
        </div>
        <p class="state success" *ngIf="actionMessage">{{ actionMessage }}</p>

        <app-state [loading]="loading" [error]="error"></app-state>

        <ng-container *ngIf="isServicesPage(); else genericTable">
          <div class="services-category-workspace" *ngIf="!loading && !error">
            <aside class="service-category-panel">
              <div class="section-title compact">
                <div>
                  <h3>Service groups</h3>
                </div>
                <span class="badge">{{ categorySummaries().length }}</span>
              </div>
              <button type="button" [class.active]="!activeServiceCategory" (click)="selectServiceCategory('')">
                <span>All categories</span>
                <strong>{{ rows.length }}</strong>
              </button>
              <button type="button" *ngFor="let category of categorySummaries()" [class.active]="activeServiceCategory === category.name" (click)="selectServiceCategory(category.name)">
                <span>{{ category.name }}</span>
                <strong>{{ category.count }}</strong>
              </button>
              <div class="rate-filter-block">
                <div class="section-title compact">
                  <div>
                    <h3>Rate groups</h3>
                  </div>
                  <span class="badge">{{ gstRateSummaries().length }}</span>
                </div>
                <button type="button" [class.active]="!activeGstRate" (click)="selectGstRate('')">
                  <span>All GST rates</span>
                  <strong>{{ categoryScopedRows().length }}</strong>
                </button>
                <button type="button" *ngFor="let rate of gstRateSummaries()" [class.active]="activeGstRate === rate.value" (click)="selectGstRate(rate.value)">
                  <span>{{ rate.label }}</span>
                  <strong>{{ rate.count }}</strong>
                </button>
              </div>
            </aside>

            <main class="service-list-panel">
              <div class="service-list-head">
                <div>
                  <span class="eyebrow">{{ activeServiceCategory || 'All services' }}</span>
                  <h3>{{ serviceRows().length }} service(s)</h3>
                </div>
                <span class="badge">GST {{ serviceGstSummary() }}</span>
              </div>
              <div class="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th *ngFor="let column of config.columns" (click)="sort(column.key)">
                        {{ column.label }}
                        <span *ngIf="sortKey === column.key">{{ sortDir === 'asc' ? 'up' : 'down' }}</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr *ngFor="let row of serviceRows()">
                      <td *ngFor="let column of config.columns">
                        <span *ngIf="column.type === 'badge'; else nonBadgeService" class="badge">{{ value(row, column) }}</span>
                        <ng-template #nonBadgeService>{{ value(row, column) }}</ng-template>
                      </td>
                    </tr>
                    <tr *ngIf="!serviceRows().length">
                      <td [attr.colspan]="config.columns.length">No services found for selected category.</td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <footer class="service-pager" aria-label="Services pagination">
                <span>Showing {{ servicePageStart() }}-{{ servicePageEnd() }} of {{ serviceTotal }}</span>
                <div>
                  <button class="ghost-button mini" type="button" (click)="changeServicePage(-1)" [disabled]="servicePage <= 1 || loading">Previous</button>
                  <span>Page {{ servicePage }} of {{ servicePageCount() }}</span>
                  <button class="ghost-button mini" type="button" (click)="changeServicePage(1)" [disabled]="servicePage >= servicePageCount() || loading">Next</button>
                </div>
              </footer>
            </main>
          </div>
        </ng-container>

        <ng-template #genericTable>
        <div class="table-wrap" *ngIf="!loading && !error">
          <table>
            <thead>
              <tr>
                <th *ngFor="let column of config.columns" (click)="sort(column.key)">
                  {{ column.label }}
                  <span *ngIf="sortKey === column.key">{{ sortDir === 'asc' ? 'up' : 'down' }}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              <tr *ngFor="let row of viewRows">
                <td *ngFor="let column of config.columns">
                  <span *ngIf="column.type === 'badge'; else nonBadge" class="badge">{{ value(row, column) }}</span>
                  <ng-template #nonBadge>{{ value(row, column) }}</ng-template>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        </ng-template>
      </section>
    </section>
  `,
  styles: [`
    .service-gst-tools {
      display: flex;
      flex-wrap: wrap;
      align-items: end;
      gap: 10px;
      margin-left: auto;
    }

    .service-pager { display: flex; justify-content: space-between; align-items: center; gap: 12px; padding-top: 14px; color: var(--muted); font-size: .86rem; }
    .service-pager div { display: flex; align-items: center; gap: 10px; }

    .service-product-lock {
      grid-column: 1 / -1;
      border: 1px solid #d9e3ec;
      border-radius: 8px;
      background: #f8fafc;
      padding: 14px;
      display: grid;
      gap: 12px;
    }

    .service-product-lock-grid {
      overflow-x: auto;
      display: grid;
      gap: 8px;
    }

    .service-product-lock-row {
      min-width: 1120px;
      display: grid;
      grid-template-columns: minmax(260px, 1.6fr) 110px repeat(6, minmax(110px, 1fr)) auto;
      gap: 8px;
      align-items: center;
    }

    .service-product-lock-row.head {
      color: #475569;
      font-size: 0.76rem;
      font-weight: 900;
      text-transform: uppercase;
    }

    .service-product-lock-row select,
    .service-product-lock-row input {
      width: 100%;
      border: 1px solid #cbd8e5;
      border-radius: 8px;
      padding: 10px 11px;
      font: inherit;
      background: #fff;
      color: #0f172a;
    }

    .service-lock-note {
      margin: 0;
      color: #64748b;
      font-size: 0.86rem;
    }

    .ghost-button.danger {
      color: #b91c1c;
      border-color: #fecaca;
    }

    .field.compact {
      min-width: 110px;
    }

    .services-category-workspace {
      display: grid;
      grid-template-columns: minmax(260px, 320px) minmax(0, 1fr);
      gap: 16px;
      align-items: start;
    }

    .service-category-panel,
    .service-list-panel {
      border: 1px solid #d9e3ec;
      border-radius: 8px;
      background: #fff;
      padding: 14px;
      box-shadow: 0 12px 28px rgba(15, 23, 42, 0.07);
    }

    .service-category-panel {
      display: grid;
      gap: 8px;
      max-height: 680px;
      overflow: auto;
    }

    .service-category-panel button {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: 10px;
      align-items: center;
      border: 1px solid #d9e3ec;
      border-radius: 8px;
      background: #f8fafc;
      color: #0f172a;
      padding: 11px 12px;
      text-align: left;
      cursor: pointer;
    }

    .service-category-panel button.active,
    .service-category-panel button:hover {
      border-color: #4B1238;
      background: #F3EAF0;
    }

    .rate-filter-block {
      display: grid;
      gap: 8px;
      margin-top: 8px;
      padding-top: 12px;
      border-top: 1px solid #d9e3ec;
    }

    .service-category-panel span {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-weight: 800;
    }

    .service-category-panel strong {
      min-width: 34px;
      border-radius: 999px;
      background: #FBF0E8;
      color: #7A4A28;
      padding: 4px 8px;
      text-align: center;
      font-size: 0.78rem;
    }

    .service-list-panel {
      display: grid;
      gap: 12px;
      min-width: 0;
    }

    .service-list-head {
      display: flex;
      justify-content: space-between;
      gap: 12px;
      align-items: center;
    }

    .service-list-head h3 {
      margin: 3px 0 0;
      color: #0f172a;
    }

    @media (max-width: 980px) {
      .services-category-workspace {
        grid-template-columns: 1fr;
      }

      .service-gst-tools,
      .service-list-head {
        align-items: stretch;
        flex-direction: column;
      }
    }

    .zenoti-module-page {
      display: grid;
      gap: 8px;
      padding: 8px;
      color: #1d2430;
      background: #f0f2f5;
      min-height: calc(100vh - 20px);
    }

    .command-bar {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 16px;
      padding: 14px 20px;
      background: #111827;
      color: #fff;
      border-bottom: 1px solid #d8e1ea;
    }

    .brand-block,
    .top-actions,
    .center-line,
    .header-actions {
      display: flex;
      align-items: center;
      gap: 10px;
    }

    .brand-mark {
      width: 34px;
      height: 34px;
      display: grid;
      place-items: center;
      border-radius: 8px;
      background: #6d5bd0;
      color: #fff;
      font-weight: 900;
    }

    .brand-block small,
    .zenoti-search span,
    .zenoti-metric-strip span {
      display: block;
      color: #5f6f85;
      font-size: 11px;
      font-weight: 800;
      text-transform: uppercase;
    }

    .brand-block small {
      color: #8fa1b8;
    }

    .brand-block strong {
      display: block;
      color: #fff;
      font-size: 15px;
    }

    .zenoti-button {
      border: 1px solid #b9cbe0;
      background: #fff;
      color: #0065a8;
      border-radius: 3px;
      padding: 8px 13px;
      font-weight: 800;
      cursor: pointer;
    }

    .zenoti-button.primary {
      background: #55173D;
      border-color: #55173D;
      color: #fff;
    }

    .zenoti-header {
      background: #fff;
    }
    .zenoti-page-heading {
      background: #fff;
      border: 1px solid #d8e1ea;
    }
    .zenoti-metric-strip {
      background: #fff;
      border: 1px solid #d8e1ea;
    }
    .zenoti-module-page .form-panel,
    .zenoti-module-page .panel {
      background: #fff;
      border: 1px solid #d8e1ea;
    }

    .zenoti-header {
      display: grid;
      gap: 10px;
      padding: 18px 16px 12px;
    }

    .center-line {
      justify-content: space-between;
    }

    .command-select {
      width: 100%;
      padding: 9px 12px;
      border: 1px solid #b9cbe0;
      border-radius: 3px;
      color: #111827;
      font-weight: 800;
      background: #fff;
    }

    .zenoti-page-heading {
      display: flex;
      justify-content: space-between;
      gap: 16px;
      padding: 16px;
      align-items: end;
    }

    .zenoti-page-heading h1 {
      margin: 0;
      font-size: 22px;
      color: #172033;
    }

    .zenoti-page-heading p {
      margin: 6px 0 0;
      color: #36506d;
      font-size: 13px;
    }

    .zenoti-search {
      width: min(100%, 360px);
      display: grid;
      gap: 5px;
    }

    .zenoti-search input,
    .zenoti-module-page .field input,
    .zenoti-module-page .field textarea {
      width: 100%;
      border: 1px solid #cbd8e5;
      border-radius: 3px;
      padding: 9px 11px;
      font: inherit;
      background: #fff;
      color: #172033;
    }

    .zenoti-metric-strip {
      display: grid;
      grid-template-columns: repeat(6, minmax(150px, 1fr));
      gap: 0;
      overflow-x: auto;
    }

    .zenoti-metric-strip article {
      min-width: 150px;
      padding: 13px 16px;
      border-right: 1px solid #d8e1ea;
      border-top: 3px solid #55173D;
    }

    .zenoti-metric-strip article:nth-child(2) { border-top-color: #16834f; }
    .zenoti-metric-strip article:nth-child(3) { border-top-color: #2b61d1; }
    .zenoti-metric-strip article:nth-child(4) { border-top-color: #bd7400; }
    .zenoti-metric-strip article:nth-child(5) { border-top-color: #7046d8; }
    .zenoti-metric-strip article:nth-child(6) { border-top-color: #bb241a; }

    .zenoti-metric-strip strong {
      display: block;
      margin: 6px 0 2px;
      color: #172033;
      font-size: 24px;
    }

    .zenoti-metric-strip small {
      color: #5f6f85;
      font-size: 12px;
    }

    .zenoti-module-page .form-panel,
    .zenoti-module-page .panel {
      border-radius: 0;
      box-shadow: none;
      border-left: 0;
      border-right: 0;
      border-top: 0;
      padding: 16px;
    }

    .zenoti-module-page .form-panel form {
      display: grid;
      grid-template-columns: repeat(4, minmax(180px, 1fr));
      gap: 10px;
    }

    .zenoti-module-page .field {
      display: grid;
      gap: 5px;
    }

    .zenoti-module-page .field span {
      color: #5f6f85;
      font-size: 11px;
      font-weight: 800;
      text-transform: uppercase;
    }

    .zenoti-module-page .field textarea {
      min-height: 74px;
      resize: vertical;
    }

    .zenoti-module-page .form-actions {
      grid-column: 1 / -1;
      display: flex;
      justify-content: flex-end;
      gap: 10px;
    }

    .zenoti-module-page .table-toolbar {
      display: none;
    }

    .zenoti-module-page .table-wrap {
      border: 1px solid #d8e1ea;
      overflow: auto;
      background: #fff;
    }

    .zenoti-module-page table {
      min-width: 880px;
      border-collapse: collapse;
    }

    .zenoti-module-page th,
    .zenoti-module-page td {
      padding: 10px 12px;
      border-bottom: 1px solid #dfe7ef;
      text-align: left;
      vertical-align: middle;
    }

    .zenoti-module-page th {
      background: #f4f7fa;
      color: #5b6b81;
      font-size: 12px;
      text-transform: uppercase;
    }

    .zenoti-module-page tr:hover td {
      background: #F5EEF2;
    }

    @media (max-width: 900px) {
      .command-bar,
      .center-line,
      .zenoti-page-heading {
        display: grid;
        align-items: start;
      }

      .top-actions,
      .header-actions {
        flex-wrap: wrap;
      }

      .zenoti-search {
        width: 100%;
      }

      .zenoti-metric-strip,
      .zenoti-module-page .form-panel form {
        grid-template-columns: 1fr;
      }
    }
  `]
})
export class ModulePageComponent implements OnInit, OnDestroy {
  config!: PageConfig;
  rows: ApiRecord[] = [];
  products: ApiRecord[] = [];
  query = '';
  loading = true;
  saving = false;
  error = '';
  showForm = false;
  sortKey = '';
  sortDir: 'asc' | 'desc' = 'asc';
  activeServiceCategory = '';
  activeGstRate = '';
  bulkGstRate = 18;
  actionMessage = '';
  servicePage = 1;
  serviceLimit = 50;
  serviceTotal = 0;
  serviceProductLocks: ServiceProductLockDraft[] = [];
  readonly serviceUnits = ['ml', 'gm', 'g', 'kg', 'l', 'pcs', 'tube', 'pack', 'box', 'nos'];
  form: UntypedFormGroup = this.fb.group({});
  private readonly subscription = new Subscription();
  private queryTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly api: ApiService,
    private readonly state: AppStateService,
    private readonly route: ActivatedRoute,
    private readonly fb: UntypedFormBuilder
  ) {}

  ngOnInit(): void {
    this.subscription.add(
      this.route.data.subscribe((data) => {
        this.config = data as PageConfig;
        this.buildForm();
        this.load();
      })
    );
  }

  ngOnDestroy(): void {
    this.subscription.unsubscribe();
    if (this.queryTimer) clearTimeout(this.queryTimer);
  }

  get viewRows(): ApiRecord[] {
    const filtered = this.roleScopedRows(this.rows).filter((row) => JSON.stringify(row).toLowerCase().includes(this.query.toLowerCase()));
    return this.sortedRows(filtered);
  }

  isServicesPage(): boolean {
    return this.config?.entity === 'services';
  }

  visibleFields(): FieldConfig[] {
    if (!this.isServicesPage()) return this.config.fields;
    return this.config.fields.filter((field) => field.key !== 'requiredProducts');
  }

  isZenotiPage(): boolean {
    return this.config?.variant === 'zenoti';
  }

  countBy(key: string, expected: string): number {
    const needle = expected.toLowerCase();
    return this.rows.filter((row) => String(row[key] || '').toLowerCase() === needle).length;
  }

  auditCount(term: string): number {
    const needle = term.toLowerCase();
    return this.rows.filter((row) => {
      const haystack = [row.action, row.entityType, row.details, row.targetType]
        .map((item) => typeof item === 'string' ? item : JSON.stringify(item || ''))
        .join(' ')
        .toLowerCase();
      return haystack.includes(needle);
    }).length;
  }

  statusCount(status: string): number {
    const needle = status.toLowerCase();
    return this.rows.filter((row) => String(row.status || '').toLowerCase().includes(needle)).length;
  }

  zenotiHeaderFilters(): Array<{ label: string; query: string }> {
    if (this.config?.entity === 'branches') {
      return [
        { label: 'All branches', query: '' },
        { label: 'Active', query: 'active' },
        { label: 'GSTIN', query: 'gstin' },
        { label: 'Phone', query: 'phone' }
      ];
    }
    if (this.config?.entity === 'notifications') {
      return [
        { label: 'All notifications', query: '' },
        { label: 'WhatsApp', query: 'whatsapp' },
        { label: 'SMS', query: 'sms' },
        { label: 'Email', query: 'email' }
      ];
    }
    if (this.config?.entity === 'auditLogs') {
      return [
        { label: 'All audit logs', query: '' },
        { label: 'Security', query: 'security' },
        { label: 'Finance', query: 'finance' },
        { label: 'Client', query: 'client' }
      ];
    }
    return [
      { label: 'All logs', query: '' },
      { label: 'WhatsApp', query: 'whatsapp' },
      { label: 'SMS', query: 'sms' },
      { label: 'Email', query: 'email' }
    ];
  }

  zenotiQuickActions(): Array<{ label: string; value: string }> {
    if (this.config?.entity === 'branches') {
      return [
        { label: this.config.createLabel, value: 'create' },
        { label: 'Refresh branches', value: 'refresh' },
        { label: 'Show active branches', value: 'active' },
        { label: 'Show GSTIN records', value: 'gstin' },
        { label: 'Show phone records', value: 'phone' }
      ];
    }
    if (this.config?.entity === 'auditLogs') {
      return [
        { label: this.config.createLabel, value: 'create' },
        { label: 'Refresh audit logs', value: 'refresh' },
        { label: 'Show security events', value: 'security' },
        { label: 'Show finance events', value: 'finance' },
        { label: 'Show warning logs', value: 'warning' }
      ];
    }
    return [
      { label: this.config.createLabel, value: 'create' },
      { label: 'Refresh records', value: 'refresh' },
      { label: 'Show failed messages', value: 'failed' },
      { label: 'Show WhatsApp logs', value: 'whatsapp' },
      { label: this.zenotiFifthMetricLabel(), value: 'queueOrOutbound' }
    ];
  }

  zenotiSearchLabel(): string {
    return this.config?.entity === 'branches' ? 'Search branches' : 'Search logs';
  }

  zenotiSearchPlaceholder(): string {
    if (this.config?.entity === 'branches') return 'Branch, city, phone, GSTIN, status';
    if (this.config?.entity === 'notifications') return 'Channel, type, status, message';
    if (this.config?.entity === 'auditLogs') return 'Action, entity, severity, actor, branch';
    return 'Recipient, channel, status, payload';
  }

  zenotiMetrics(): Array<{ label: string; value: string | number; hint: string }> {
    if (this.config?.entity === 'branches') {
      return [
        { label: 'Total branches', value: this.rows.length, hint: 'Salon locations' },
        { label: 'Active', value: this.statusCount('active'), hint: 'Operating centers' },
        { label: 'Cities', value: this.uniqueCount('city'), hint: 'Location spread' },
        { label: 'GSTIN ready', value: this.presentCount('gstin'), hint: 'Tax profile captured' },
        { label: 'Phone ready', value: this.presentCount('phone'), hint: 'Contact captured' },
        { label: 'Missing GSTIN', value: this.missingCount('gstin'), hint: 'Needs compliance follow-up' }
      ];
    }
    if (this.config?.entity === 'auditLogs') {
      return [
        { label: 'Total logs', value: this.rows.length, hint: 'Audit events' },
        { label: 'Security', value: this.auditCount('security'), hint: 'Security actions' },
        { label: 'Finance', value: this.auditCount('finance'), hint: 'Money controls' },
        { label: 'Client', value: this.auditCount('client'), hint: 'Client records' },
        { label: 'Warning', value: this.statusCount('warning'), hint: 'Needs review' },
        { label: 'Critical', value: this.statusCount('critical'), hint: 'High risk' }
      ];
    }
    return [
      { label: 'Total records', value: this.roleScopedRows(this.rows).length, hint: this.config.entity },
      { label: 'WhatsApp', value: this.countBy('channel', 'whatsapp'), hint: 'Chat messages' },
      { label: 'SMS', value: this.countBy('channel', 'sms'), hint: 'Text messages' },
      { label: 'Email', value: this.countBy('channel', 'email'), hint: 'Email logs' },
      { label: this.zenotiFifthMetricLabel(), value: this.zenotiFifthMetricValue(), hint: this.zenotiFifthMetricHint() },
      { label: 'Failed', value: this.statusCount('failed'), hint: 'Needs review' }
    ];
  }

  uniqueCount(key: string): number {
    return new Set(this.rows.map((row) => String(row[key] || '').trim()).filter(Boolean)).size;
  }

  presentCount(key: string): number {
    return this.rows.filter((row) => String(row[key] || '').trim()).length;
  }

  missingCount(key: string): number {
    return this.rows.filter((row) => !String(row[key] || '').trim()).length;
  }

  zenotiFifthMetricLabel(): string {
    return this.config?.entity === 'notifications' ? 'Queued' : 'Outbound';
  }

  zenotiFifthMetricValue(): number {
    return this.config?.entity === 'notifications' ? this.statusCount('queued') : this.countBy('direction', 'outbound');
  }

  zenotiFifthMetricHint(): string {
    return this.config?.entity === 'notifications' ? 'Waiting to send' : 'Sent from salon';
  }

  runZenotiAction(event: Event): void {
    const select = event.target as HTMLSelectElement;
    const action = select.value;
    if (action === 'create') {
      if (!this.showForm) this.toggleForm();
    }
    if (action === 'refresh') this.load();
    if (action === 'failed') this.query = 'failed';
    if (action === 'whatsapp') this.query = 'whatsapp';
    if (action === 'queueOrOutbound') this.query = this.config?.entity === 'notifications' ? 'queued' : 'outbound';
    if (action === 'active') this.query = 'active';
    if (action === 'gstin') this.query = 'gstin';
    if (action === 'phone') this.query = 'phone';
    if (action === 'security') this.query = 'security';
    if (action === 'finance') this.query = 'finance';
    if (action === 'warning') this.query = 'warning';
    select.selectedIndex = 0;
  }

  categorySummaries(): Array<{ name: string; count: number }> {
    const map = new Map<string, number>();
    for (const row of this.rows) {
      const category = this.serviceCategoryName(row);
      map.set(category, (map.get(category) || 0) + 1);
    }
    return [...map.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  serviceRows(): ApiRecord[] {
    const term = this.query.toLowerCase();
    const rows = this.categoryScopedRows().filter((row) => {
      const rateMatch = !this.activeGstRate || this.serviceGstValue(row) === this.activeGstRate;
      const searchMatch = !term || JSON.stringify(row).toLowerCase().includes(term);
      return rateMatch && searchMatch;
    });
    return this.sortedRows(rows);
  }

  categoryScopedRows(): ApiRecord[] {
    return this.rows.filter((row) => !this.activeServiceCategory || this.serviceCategoryName(row) === this.activeServiceCategory);
  }

  gstRateSummaries(): Array<{ value: string; label: string; count: number }> {
    const map = new Map<string, number>();
    for (const row of this.categoryScopedRows()) {
      const value = this.serviceGstValue(row);
      map.set(value, (map.get(value) || 0) + 1);
    }
    return [...map.entries()]
      .map(([value, count]) => ({ value, label: this.formatGstRate(value), count }))
      .sort((a, b) => Number(a.value) - Number(b.value));
  }

  selectServiceCategory(category: string): void {
    this.activeServiceCategory = category;
    this.activeGstRate = '';
    const first = this.rows.find((row) => !category || this.serviceCategoryName(row) === category);
    if (first?.gstRate !== undefined) this.bulkGstRate = Number(first.gstRate || 0);
  }

  selectGstRate(rate: string): void {
    this.activeGstRate = rate;
    if (rate) this.bulkGstRate = Number(rate);
  }

  serviceGstSummary(): string {
    const rates = [...new Set(this.serviceRows().map((row) => Number(row.gstRate ?? 0)))].sort((a, b) => a - b);
    if (!rates.length) return '-';
    return rates.length === 1 ? `${rates[0]}%` : `${rates.length} rates`;
  }

  applyGstToServices(scope: 'all' | 'category'): void {
    const rate = Number(this.bulkGstRate);
    if (Number.isNaN(rate) || rate < 0) {
      this.error = 'GST rate must be a valid positive number';
      return;
    }
    const targets = (scope === 'all' ? this.serviceRows() : this.rows.filter((row) => this.serviceCategoryName(row) === this.activeServiceCategory))
      .filter((row) => row.id);
    if (!targets.length) {
      this.actionMessage = 'No service found for GST update.';
      return;
    }
    const label = scope === 'all' ? 'filtered service(s)' : this.activeServiceCategory;
    if (!window.confirm(`Update GST to ${rate}% for ${targets.length} ${label}?`)) return;
    this.saving = true;
    this.error = '';
    this.actionMessage = '';
    this.api.post<{ updated: number }>('services/bulk-gst', {
      gstRate: rate,
      scope,
      category: this.activeServiceCategory,
      serviceIds: targets.map((row) => String(row.id)),
      branchId: this.api.selectedBranchId()
    }).subscribe({
      next: (result) => {
        this.saving = false;
        this.actionMessage = `GST updated to ${rate}% for ${result.updated || targets.length} service(s).`;
        this.load();
      },
      error: (error) => {
        this.saving = false;
        this.error = this.api.errorText(error, 'Unable to update service GST');
      }
    });
  }

  private sortedRows(rows: ApiRecord[]): ApiRecord[] {
    if (!this.sortKey) return rows;
    return [...rows].sort((a, b) => {
      const left = String(a[this.sortKey] ?? '');
      const right = String(b[this.sortKey] ?? '');
      return this.sortDir === 'asc' ? left.localeCompare(right) : right.localeCompare(left);
    });
  }

  private serviceCategoryName(row: ApiRecord): string {
    return String(row.category || row.serviceCategory || row.service_category || 'Uncategorized').trim() || 'Uncategorized';
  }

  private serviceGstValue(row: ApiRecord): string {
    const rate = Number(row.gstRate ?? 0);
    return Number.isFinite(rate) ? String(rate) : '0';
  }

  private formatGstRate(value: unknown): string {
    const rate = Number(value ?? 0);
    return Number.isFinite(rate) ? `${rate}%` : '0%';
  }

  load(): void {
    this.loading = true;
    this.error = '';
    if (this.isServicesPage()) this.loadServiceProducts();
    const resource = this.isServicesPage() ? 'visibility/services' : this.config.entity;
    const params = this.isServicesPage()
      ? { branchId: this.api.selectedBranchId(), page: this.servicePage, limit: this.serviceLimit, q: this.query.trim() }
      : { branchId: this.api.selectedBranchId() };
    this.api.list<ApiRecord[] | { rows: ApiRecord[]; total: number }>(resource, params).subscribe({
      next: (response) => {
        const paged = !Array.isArray(response) ? response : null;
        this.rows = paged?.rows || response as ApiRecord[] || [];
        if (paged) this.serviceTotal = Number(paged.total || 0);
        this.loading = false;
      },
      error: (error) => {
        this.error = error?.error?.error || 'Unable to load records';
        this.loading = false;
      }
    });
  }

  onQueryChange(value: string): void {
    this.query = value;
    if (!this.isServicesPage()) return;
    if (this.queryTimer) clearTimeout(this.queryTimer);
    this.queryTimer = setTimeout(() => {
      this.servicePage = 1;
      this.load();
    }, 300);
  }

  changeServicePage(delta: number): void {
    const next = Math.min(this.servicePageCount(), Math.max(1, this.servicePage + delta));
    if (next === this.servicePage) return;
    this.servicePage = next;
    this.load();
  }

  servicePageCount(): number { return Math.max(1, Math.ceil(this.serviceTotal / this.serviceLimit)); }
  servicePageStart(): number { return this.serviceTotal ? (this.servicePage - 1) * this.serviceLimit + 1 : 0; }
  servicePageEnd(): number { return Math.min(this.serviceTotal, (this.servicePage - 1) * this.serviceLimit + this.rows.length); }

  private roleScopedRows(rows: ApiRecord[]): ApiRecord[] {
    if (this.config?.entity !== 'notifications') return rows;
    const role = String(this.state.userRole() || '').replace(/[\s_-]+/g, '').toLowerCase();
    if (['owner', 'admin', 'superadmin'].includes(role)) return rows;
    const domains: Record<string, string> = {
      marketinglead: 'marketing campaign lead coupon whatsapp sms email reputation review client engagement', custommarketinglead: 'marketing campaign lead coupon whatsapp sms email reputation review client engagement',
      manager: 'appointment booking client service pos payment invoice inventory staff campaign lead notification', receptionist: 'appointment booking client service pos payment invoice reminder notification', frontdesk: 'appointment booking client service pos payment invoice reminder notification',
      cashier: 'pos payment invoice refund due client notification', accountant: 'finance payment invoice ledger cash expense tax notification', inventorymanager: 'inventory product stock supplier purchase expiry reorder notification', staff: 'staff appointment booking schedule task notification'
    };
    const allowed = (domains[role] || '').split(' ').filter(Boolean);
    if (!allowed.length) return [];
    return rows.filter((row) => {
      const haystack = JSON.stringify(row).toLowerCase();
    const blocked = ['owner', 'admin', 'security', 'finance', 'staff'].filter((keyword) => !allowed.includes(keyword));
    if (blocked.some((keyword) => haystack.includes(keyword))) return false;
    return allowed.some((keyword) => haystack.includes(keyword));
    });
  }

  buildForm(): void {
    const group: Record<string, FormControl> = {};
    for (const field of this.config.fields) {
      if (this.isServicesPage() && field.key === 'requiredProducts') continue;
      const value = field.type === 'json' ? JSON.stringify(field.defaultValue ?? [], null, 2) : field.defaultValue ?? '';
      group[field.key] = new FormControl(value, field.required ? Validators.required : []);
    }
    this.form = this.fb.group(group);
    if (this.isServicesPage()) this.resetServiceProductLocks();
  }

  toggleForm(): void {
    this.showForm = !this.showForm;
    if (this.showForm) this.buildForm();
  }

  save(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    this.saving = true;
    this.error = '';
    const payload: ApiRecord = {};
    for (const field of this.config.fields) {
      if (this.isServicesPage() && field.key === 'requiredProducts') continue;
      const raw = this.form.value[field.key];
      try {
        payload[field.key] = field.type === 'json' ? JSON.parse(raw || 'null') : raw;
      } catch {
        this.error = `${field.label} must be valid JSON`;
        this.saving = false;
        return;
      }
    }
    if (this.isServicesPage()) payload.requiredProducts = this.serviceProductLockPayload();
    this.api.create(this.config.entity, payload).subscribe({
      next: (created) => this.afterServiceSave(created, payload),
      error: (error) => {
        this.error = error?.error?.error || 'Unable to save record';
        this.saving = false;
      }
    });
  }

  sort(key: string): void {
    if (this.sortKey === key) {
      this.sortDir = this.sortDir === 'asc' ? 'desc' : 'asc';
    } else {
      this.sortKey = key;
      this.sortDir = 'asc';
    }
  }

  value(row: ApiRecord, column: ColumnConfig): string {
    const cell = row[column.key];
    if (this.isServicesPage() && column.key === 'gstRate') return this.formatGstRate(cell);
    if (this.isServicesPage() && column.key === 'membershipPricePaise') {
      if (!row.membershipPriceRecorded && !Number(cell || 0)) return 'Not recorded';
      return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(Number(cell || 0) / 100);
    }
    if (column.type === 'currency') return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(Number(cell || 0));
    if (column.type === 'date' && cell) return new Intl.DateTimeFormat('en-IN').format(new Date(cell));
    if (column.type === 'json') return JSON.stringify(cell);
    if (Array.isArray(cell)) return cell.join(', ');
    if (cell && typeof cell === 'object') return JSON.stringify(cell);
    return String(cell ?? '');
  }

  private loadServiceProducts(): void {
    this.api.list<ApiRecord[]>('products', { limit: 10000, branchId: this.api.selectedBranchId() }).subscribe({
      next: (products) => {
        this.products = products || [];
      },
      error: () => {
        this.products = [];
      }
    });
  }

  serviceProductOptions(): ApiRecord[] {
    const tagged = this.products.filter((product) => ['consumable', 'both'].includes(this.productType(product)));
    return tagged.length ? tagged : this.products;
  }

  serviceProductLabel(product: ApiRecord): string {
    const name = String(product.name || product.productName || product.sku || product.id || 'Product');
    const sku = product.sku ? ` · ${product.sku}` : '';
    const stock = product.stock !== undefined ? ` · stock ${product.stock}` : '';
    return `${name}${sku}${stock}`;
  }

  addServiceProductLock(): void {
    this.serviceProductLocks = [...this.serviceProductLocks, this.blankServiceProductLock()];
  }

  removeServiceProductLock(uid: string): void {
    if (this.serviceProductLocks.length <= 1) return;
    this.serviceProductLocks = this.serviceProductLocks.filter((item) => item.uid !== uid);
  }

  setServiceProductLockProduct(item: ServiceProductLockDraft, productId: string): void {
    item.productId = productId;
    const product = this.productById(productId);
    if (product) item.unit = String(product.unit || product.packUnit || product.baseUnit || item.unit || 'ml');
    this.serviceProductLocks = [...this.serviceProductLocks];
  }

  trackServiceProductLock(_: number, item: ServiceProductLockDraft): string {
    return item.uid;
  }

  numberValue(value: unknown): number {
    const number = Number(value);
    return Number.isFinite(number) ? number : 0;
  }

  private afterServiceSave(created: ApiRecord, payload: ApiRecord): void {
    if (!this.isServicesPage()) {
      this.finishSave();
      return;
    }
    const items = this.serviceProductLockPayload().filter((item) => item.productId);
    if (!items.length || !created?.id) {
      this.finishSave();
      return;
    }
    const serviceName = String(created.name || payload.name || 'Service');
    this.api.post<ApiRecord>('inventory-intelligence/service-recipes', {
      branchId: this.api.selectedBranchId(),
      serviceId: created.id,
      recipeName: `${serviceName} product lock`,
      serviceCategory: payload.category || '',
      servicePrice: Number(payload.price || 0),
      approvalStatus: 'approved',
      marginFloorPct: 35,
      notes: 'Synced from Services product consumption lock.',
      usageModifiers: [
        { key: 'short', label: 'Short hair', multiplier: 1 },
        { key: 'medium', label: 'Medium hair', multiplier: 1.5 },
        { key: 'long', label: 'Long hair', multiplier: 2 }
      ],
      enforceConsumableFilter: this.serviceProductOptions().length !== this.products.length,
      versionNote: 'Service form product lock synced',
      items: items.map((item, index) => {
        const product = this.productById(item.productId);
        return {
          ...item,
          unitCost: Number(product?.unitCost || 0),
          allowedSubstitutes: [],
          sortOrder: index,
          notes: 'Managed from Services add form'
        };
      })
    }).subscribe({
      next: () => this.finishSave('Service saved and product consumption lock synced.'),
      error: (error) => {
        this.error = `Service saved, but product lock sync failed: ${this.api.errorText(error, 'Unable to sync service recipe')}`;
        this.saving = false;
        this.showForm = false;
        this.load();
      }
    });
  }

  private finishSave(message = ''): void {
    this.saving = false;
    this.showForm = false;
    this.actionMessage = message;
    this.load();
  }

  private resetServiceProductLocks(): void {
    this.serviceProductLocks = [this.blankServiceProductLock()];
  }

  private blankServiceProductLock(): ServiceProductLockDraft {
    return {
      uid: globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      productId: '',
      unit: 'ml',
      minQuantityPerService: 0,
      quantityPerService: 1,
      maxQuantityPerService: 0,
      wastagePct: 0,
      wastageApprovalPct: 25,
      wastageHitLimit: 3
    };
  }

  private serviceProductLockPayload(): ApiRecord[] {
    return this.serviceProductLocks
      .filter((item) => item.productId)
      .map((item) => {
        const product = this.productById(item.productId);
        const quantity = Number(item.quantityPerService || 0);
        return {
          productId: item.productId,
          productName: product?.name || product?.productName || '',
          unit: item.unit || 'ml',
          quantity,
          quantityPerService: quantity,
          minQuantityPerService: Number(item.minQuantityPerService || 0),
          maxQuantityPerService: Number(item.maxQuantityPerService || 0),
          wastagePct: Number(item.wastagePct || 0),
          wastageApprovalPct: Number(item.wastageApprovalPct || 25),
          wastageHitLimit: Math.max(1, Number(item.wastageHitLimit || 3))
        };
      });
  }

  private productById(productId: string): ApiRecord | undefined {
    return this.products.find((product) => String(product.id) === String(productId));
  }

  private productType(product: ApiRecord): string {
    return String(product.productType || product.type || product.usageType || product.category || '').toLowerCase();
  }
}
