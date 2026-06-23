import { CommonModule } from '@angular/common';
import { Component, OnDestroy, OnInit } from '@angular/core';
import { FormControl, FormsModule, ReactiveFormsModule, UntypedFormBuilder, UntypedFormGroup, Validators } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { Subscription } from 'rxjs';
import { ApiRecord, ApiService } from '../core/api.service';
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
  subtitle: string;
  createLabel: string;
  columns: ColumnConfig[];
  fields: FieldConfig[];
  variant?: 'zenoti';
};

@Component({
  selector: 'app-module-page',
  standalone: true,
  imports: [CommonModule, FormsModule, ReactiveFormsModule, StateComponent],
  template: `
    <section class="page-stack" [class.zenoti-module-page]="isZenotiPage()" *ngIf="config">
      <ng-container *ngIf="isZenotiPage(); else defaultHero">
        <div class="command-bar">
          <div class="brand-block">
            <span class="brand-mark">A</span>
            <div>
              <small>Enterprise command workspace</small>
              <strong>Aurashine OS</strong>
            </div>
          </div>
          <div class="top-actions">
            <button class="zenoti-button" type="button" (click)="load()">Refresh</button>
            <button class="zenoti-button primary" type="button" (click)="toggleForm()">{{ showForm ? 'Close form' : config.createLabel }}</button>
          </div>
        </div>

        <section class="zenoti-header">
          <div class="center-line">
            <strong>malad</strong>
            <div class="header-actions">
              <button class="zenoti-button" type="button" (click)="query = ''">All logs</button>
              <button class="zenoti-button" type="button" (click)="query = 'whatsapp'">WhatsApp</button>
              <button class="zenoti-button" type="button" (click)="query = 'sms'">SMS</button>
              <button class="zenoti-button" type="button" (click)="query = 'email'">Email</button>
            </div>
          </div>
          <select class="command-select" aria-label="Module quick action" (change)="runZenotiAction($event)">
            <option>I want to ...</option>
            <option value="create">{{ config.createLabel }}</option>
            <option value="refresh">Refresh records</option>
            <option value="failed">Show failed messages</option>
            <option value="whatsapp">Show WhatsApp logs</option>
            <option value="queueOrOutbound">{{ zenotiFifthMetricLabel() }}</option>
          </select>
        </section>

        <div class="zenoti-page-heading">
          <div>
            <h1>{{ config.title }}</h1>
            <p>{{ config.subtitle }}</p>
          </div>
          <label class="zenoti-search">
            <span>Search logs</span>
            <input [(ngModel)]="query" placeholder="Recipient, channel, status, payload" />
          </label>
        </div>

        <div class="zenoti-metric-strip">
          <article><span>Total records</span><strong>{{ rows.length }}</strong><small>{{ config.entity }}</small></article>
          <article><span>WhatsApp</span><strong>{{ countBy('channel', 'whatsapp') }}</strong><small>Chat messages</small></article>
          <article><span>SMS</span><strong>{{ countBy('channel', 'sms') }}</strong><small>Text messages</small></article>
          <article><span>Email</span><strong>{{ countBy('channel', 'email') }}</strong><small>Email logs</small></article>
          <article><span>{{ zenotiFifthMetricLabel() }}</span><strong>{{ zenotiFifthMetricValue() }}</strong><small>{{ zenotiFifthMetricHint() }}</small></article>
          <article><span>Failed</span><strong>{{ statusCount('failed') }}</strong><small>Needs review</small></article>
        </div>
      </ng-container>

      <ng-template #defaultHero>
      <div class="module-hero">
        <div>
          <span class="eyebrow">Module</span>
          <h2>{{ config.title }}</h2>
          <p>{{ config.subtitle }}</p>
        </div>
        <button class="primary-button" type="button" (click)="toggleForm()">{{ showForm ? 'Close form' : config.createLabel }}</button>
      </div>
      </ng-template>

      <section class="form-panel" *ngIf="showForm">
        <form [formGroup]="form" (ngSubmit)="save()">
          <label class="field" *ngFor="let field of config.fields">
            <span>{{ field.label }}</span>
            <textarea *ngIf="field.type === 'json'; else scalar" [formControlName]="field.key"></textarea>
            <ng-template #scalar>
              <input [type]="field.type || 'text'" [formControlName]="field.key" />
            </ng-template>
            <small class="field-error" *ngIf="form.get(field.key)?.invalid && form.get(field.key)?.touched">Required</small>
          </label>
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
            <input [(ngModel)]="query" placeholder="Search records" />
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
                  <span class="eyebrow">Categories</span>
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
                    <span class="eyebrow">GST Rates</span>
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
      border-color: #0f766e;
      background: #ecfdf5;
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
      background: #d1fae5;
      color: #065f46;
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
      gap: 0;
      color: #1d2430;
      background: #f7f9fb;
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
      background: #0b8f7c;
      border-color: #0b8f7c;
      color: #fff;
    }

    .zenoti-header,
    .zenoti-page-heading,
    .zenoti-metric-strip,
    .zenoti-module-page .form-panel,
    .zenoti-module-page .panel {
      background: #fff;
      border-bottom: 1px solid #d8e1ea;
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
      border-top: 3px solid #0b8f7c;
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
      background: #eef7fc;
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
  form: UntypedFormGroup = this.fb.group({});
  private readonly subscription = new Subscription();

  constructor(
    private readonly api: ApiService,
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
  }

  get viewRows(): ApiRecord[] {
    const filtered = this.rows.filter((row) => JSON.stringify(row).toLowerCase().includes(this.query.toLowerCase()));
    return this.sortedRows(filtered);
  }

  isServicesPage(): boolean {
    return this.config?.entity === 'services';
  }

  isZenotiPage(): boolean {
    return this.config?.variant === 'zenoti';
  }

  countBy(key: string, expected: string): number {
    const needle = expected.toLowerCase();
    return this.rows.filter((row) => String(row[key] || '').toLowerCase() === needle).length;
  }

  statusCount(status: string): number {
    const needle = status.toLowerCase();
    return this.rows.filter((row) => String(row.status || '').toLowerCase().includes(needle)).length;
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
    this.api.list<ApiRecord[]>(this.config.entity, { branchId: this.api.selectedBranchId() }).subscribe({
      next: (rows) => {
        this.rows = rows;
        this.loading = false;
      },
      error: (error) => {
        this.error = error?.error?.error || 'Unable to load records';
        this.loading = false;
      }
    });
  }

  buildForm(): void {
    const group: Record<string, FormControl> = {};
    for (const field of this.config.fields) {
      const value = field.type === 'json' ? JSON.stringify(field.defaultValue ?? [], null, 2) : field.defaultValue ?? '';
      group[field.key] = new FormControl(value, field.required ? Validators.required : []);
    }
    this.form = this.fb.group(group);
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
      const raw = this.form.value[field.key];
      try {
        payload[field.key] = field.type === 'json' ? JSON.parse(raw || 'null') : raw;
      } catch {
        this.error = `${field.label} must be valid JSON`;
        this.saving = false;
        return;
      }
    }
    this.api.create(this.config.entity, payload).subscribe({
      next: () => {
        this.saving = false;
        this.showForm = false;
        this.load();
      },
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
    if (column.type === 'currency') return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(Number(cell || 0));
    if (column.type === 'date' && cell) return new Intl.DateTimeFormat('en-IN').format(new Date(cell));
    if (column.type === 'json') return JSON.stringify(cell);
    if (Array.isArray(cell)) return cell.join(', ');
    if (cell && typeof cell === 'object') return JSON.stringify(cell);
    return String(cell ?? '');
  }
}
