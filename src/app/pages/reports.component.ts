import { CommonModule, CurrencyPipe } from '@angular/common';
import { Component, OnInit, computed, effect, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ApiRecord, ApiService } from '../core/api.service';
import { StateComponent } from '../shared/ui/state/state.component';
import { AuraKpiCardComponent } from '../shared/ui/aura-kpi-card/aura-kpi-card.component';

@Component({
  selector: 'app-reports',
  standalone: true,
  imports: [CommonModule, CurrencyPipe, FormsModule, RouterLink, StateComponent, AuraKpiCardComponent],
  template: `
    <section class="page-stack">
      <div class="module-hero">
        <div>
          <span class="eyebrow">Reports and analytics</span>
          <h2>Enterprise report command center</h2>
          <p>Branch and date scoped reports from saved POS, appointment, staff, GST, payment, client and inventory records.</p>
        </div>
        <div class="hero-actions">
          <a class="ghost-button" routerLink="/analytics">Analytics engine</a>
          <a class="ghost-button" routerLink="/reports/financial-summary">Financial summary</a>
          <a class="ghost-button" routerLink="/reports/invoices">Invoice reports</a>
          <a class="ghost-button" routerLink="/reports/inward-revenue">Inward revenue</a>
          <a class="ghost-button" routerLink="/appointment-activity">Appointment activity</a>
          <a class="ghost-button" routerLink="/inventory/reports">Inventory reports</a>
          <button class="ghost-button" type="button" (click)="createDefaultSchedule()">Schedule weekly</button>
          <button class="ghost-button" type="button" (click)="runAnomalyDetection()">Run anomaly scan</button>
          <button class="ghost-button" type="button" (click)="load()">Refresh</button>
        </div>
      </div>

      <section class="panel report-filter-panel">
        <label class="field">
          <span>From</span>
          <input type="date" [(ngModel)]="from" />
        </label>
        <label class="field">
          <span>To</span>
          <input type="date" [(ngModel)]="to" />
        </label>
        <div class="branch-context-card">
          <span>Header branch</span>
          <strong>{{ branchLabel() }}</strong>
          <small>Change branch only from top header.</small>
        </div>
        <button class="primary-button" type="button" (click)="load()">Apply filters</button>
      </section>

      <app-state [loading]="loading()" [error]="error()"></app-state>

      <ng-container *ngIf="analyticsCommand() as analytics">
        <div class="metrics-grid">
          <aura-kpi-card tone="blue" target="/kpi-details/analytics/14-day-forecast"><span>AI forecast</span><strong>{{ analytics.summary.projectedRevenue | currency: 'INR':'symbol':'1.0-0' }}</strong><small>{{ analytics.summary.trendPercent }}% trend</small></aura-kpi-card>
          <aura-kpi-card tone="violet" target="/kpi-details/analytics/high-churn-risk"><span>Churn risk</span><strong>{{ analytics.summary.highChurnRisk }}</strong><small>{{ analytics.summary.repeatRate }}% repeat rate</small></aura-kpi-card>
          <aura-kpi-card tone="red" target="/kpi-details/analytics/anomalies"><span>Anomalies</span><strong>{{ analytics.anomalyDetection.open }}</strong><small>{{ analytics.anomalyDetection.critical }} critical</small></aura-kpi-card>
          <aura-kpi-card tone="slate" target="/analytics"><span>Scheduled</span><strong>{{ analytics.scheduledReports.length }}</strong><small>{{ analytics.exportControls.message }}</small></aura-kpi-card>
        </div>

        <section class="panel">
          <div class="section-title">
            <div>
              <span class="eyebrow">Advanced report control</span>
              <h2>KPI detail mapping, export controls and insights</h2>
            </div>
            <span class="badge">{{ analytics.exportControls.allowed ? 'Export allowed' : 'Export blocked' }}</span>
          </div>
          <div class="report-link-grid">
            <a class="report-link-card" *ngFor="let item of analytics.kpiDetailMap" [routerLink]="item.route">
              <span>{{ item.module }} · {{ item.source }}</span>
              <strong>{{ item.title }}</strong>
              <small>Drill down</small>
            </a>
          </div>
        </section>

        <div class="dashboard-grid">
          <section class="panel">
            <div class="section-title"><h2>Insights</h2></div>
            <div class="quick-grid">
              <article class="action-card" *ngFor="let insight of analytics.aiInsights">
                <strong>{{ insight.title }}</strong>
                <span>{{ insight.recommendation }}</span>
                <small>{{ insight.severity }}</small>
              </article>
            </div>
          </section>

          <section class="panel">
            <div class="section-title"><h2>Scheduled reports</h2></div>
            <div class="quick-grid">
              <article class="action-card" *ngFor="let schedule of analytics.scheduledReports">
                <strong>{{ schedule.name }}</strong>
                <span>{{ schedule.cadence }} · {{ schedule.nextRunAt | date: 'short' }}</span>
                <small>{{ schedule.status }}</small>
              </article>
              <article class="action-card" *ngIf="!analytics.scheduledReports.length">
                <strong>No schedules yet</strong>
                <span>Create weekly owner digest from this page.</span>
                <small>Exports stay audit controlled.</small>
              </article>
            </div>
          </section>
        </div>

        <section class="panel">
          <div class="section-title"><h2>Report drilldowns</h2></div>
          <div class="table-wrap">
            <table>
              <thead><tr><th>Report</th><th>Rows</th><th>Source</th><th>Open</th></tr></thead>
              <tbody>
                <tr *ngFor="let drilldown of analytics.drilldowns">
                  <td>{{ drilldown.title }}</td>
                  <td>{{ drilldown.rows }}</td>
                  <td>{{ drilldown.source }}</td>
                  <td><a class="ghost-button" [routerLink]="drilldown.route">Open</a></td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
      </ng-container>

      <ng-container *ngIf="report() as report">
        <div class="metrics-grid">
          <aura-kpi-card tone="teal" target="/kpi-details/reports/sales-revenue"><span>Sales revenue</span><strong>{{ report.sales.revenue | currency: 'INR':'symbol':'1.0-0' }}</strong><small>{{ report.sales.count }} sales</small></aura-kpi-card>
          <aura-kpi-card tone="amber" target="/kpi-details/reports/gst-collected"><span>GST collected</span><strong>{{ report.gst.collected | currency: 'INR':'symbol':'1.0-0' }}</strong><small>{{ report.gst.invoices }} invoices</small></aura-kpi-card>
          <aura-kpi-card tone="green" target="/kpi-details/reports/bookings"><span>Bookings</span><strong>{{ report.bookings.total }}</strong><small>{{ report.bookings.completed }} completed</small></aura-kpi-card>
          <aura-kpi-card tone="red" target="/kpi-details/reports/low-stock-count"><span>Low stock count</span><strong>{{ report.inventory.lowStock }}</strong><small>{{ report.inventory.stockValue | currency: 'INR':'symbol':'1.0-0' }} stock value</small></aura-kpi-card>
        </div>

        <section class="panel connected-report-panel">
          <div class="section-title">
            <div>
              <span class="eyebrow">Connected reports</span>
              <h2>Open detailed report</h2>
            </div>
            <small>{{ branchLabel() }} · {{ report.filters?.from || 'start' }} to {{ report.filters?.to || 'today' }}</small>
          </div>
          <div class="report-link-grid">
            <a class="report-link-card" *ngFor="let link of quickLinks()" [routerLink]="link.path" [queryParams]="link.queryParams || null">
              <span>{{ link.module }}</span>
              <strong>{{ link.label }}</strong>
              <small>Open</small>
            </a>
          </div>
        </section>

        <div class="dashboard-grid">
          <section class="panel">
            <div class="section-title"><h2>Daily closing</h2></div>
            <div class="summary-lines">
              <div><span>Cash</span><strong>{{ report.dailyClosing.cash | currency: 'INR':'symbol':'1.0-0' }}</strong></div>
              <div><span>UPI</span><strong>{{ report.dailyClosing.upi | currency: 'INR':'symbol':'1.0-0' }}</strong></div>
              <div><span>Card</span><strong>{{ report.dailyClosing.card | currency: 'INR':'symbol':'1.0-0' }}</strong></div>
              <div><span>Other</span><strong>{{ (report.dailyClosing.other || 0) | currency: 'INR':'symbol':'1.0-0' }}</strong></div>
            </div>
          </section>

          <section class="panel">
            <div class="section-title"><h2>Profit / loss summary</h2></div>
            <div class="summary-lines">
              <div><span>Revenue</span><strong>{{ report.profitLoss.revenue | currency: 'INR':'symbol':'1.0-0' }}</strong></div>
              <div><span>Inventory cost</span><strong>{{ report.profitLoss.estimatedInventoryCost | currency: 'INR':'symbol':'1.0-0' }}</strong></div>
              <div class="total"><span>Gross profit</span><strong>{{ report.profitLoss.grossProfit | currency: 'INR':'symbol':'1.0-0' }}</strong></div>
            </div>
          </section>
        </div>

        <div class="dashboard-grid">
          <section class="panel">
            <div class="section-title"><h2>Booking status</h2></div>
            <div class="status-grid">
              <article><span>Booked</span><strong>{{ report.bookings.booked || 0 }}</strong></article>
              <article><span>Completed</span><strong>{{ report.bookings.completed || 0 }}</strong></article>
              <article><span>No-show</span><strong>{{ report.bookings.noShow || 0 }}</strong></article>
              <article><span>Cancelled</span><strong>{{ report.bookings.cancelled || 0 }}</strong></article>
            </div>
          </section>

          <section class="panel">
            <div class="section-title"><h2>Client and membership pulse</h2></div>
            <div class="summary-lines">
              <div><span>Total clients</span><strong>{{ report.clients?.total || 0 }}</strong></div>
              <div><span>New in range</span><strong>{{ report.clients?.newInPeriod || 0 }}</strong></div>
              <div><span>Repeat rate</span><strong>{{ report.retention.repeatCustomerRate }}%</strong></div>
              <div><span>Active memberships</span><strong>{{ report.memberships.active }}</strong></div>
            </div>
          </section>
        </div>

        <section class="panel">
          <div class="section-title">
            <div>
              <span class="eyebrow">Staff performance</span>
              <h2>Top staff from Staff OS + POS attribution</h2>
            </div>
            <a class="ghost-button" routerLink="/reports/staff-sales">Open full staff sales</a>
          </div>
          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Staff</th>
                  <th>Role</th>
                  <th>Revenue</th>
                  <th>Bookings</th>
                  <th>Completion</th>
                  <th>Commission</th>
                </tr>
              </thead>
              <tbody>
                <tr *ngFor="let person of topStaff()">
                  <td>{{ person.name }}</td>
                  <td>{{ person.role }}</td>
                  <td>{{ person.revenue | currency: 'INR':'symbol':'1.0-0' }}</td>
                  <td>{{ person.bookings }}</td>
                  <td>{{ person.rating }}%</td>
                  <td>{{ (person.commission || 0) | currency: 'INR':'symbol':'1.0-0' }}</td>
                </tr>
                <tr *ngIf="!topStaff().length">
                  <td colspan="6">No staff performance data found for selected filters.</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
      </ng-container>
    </section>
  `,
  styles: [`
    :host {
      display: block;
      color: var(--ink);
      background: var(--bg);
    }

    .page-stack {
      display: grid;
      gap: 12px;
    }

    .module-hero {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 14px;
      padding: 16px 18px;
      border: 1px solid var(--line);
      border-left: 0;
      border-right: 0;
      border-radius: 0;
      background: var(--surface);
      box-shadow: none;
    }

    .module-hero h2 {
      margin: 0;
      color: var(--ink);
      font-size: 1.35rem;
      line-height: 1.18;
    }

    .module-hero p {
      margin: 6px 0 0;
      color: var(--muted);
    }

    .hero-actions,
    .report-filter-panel {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
    }
    .hero-actions {
      justify-content: flex-end;
    }

    .hero-actions .ghost-button,
    .report-filter-panel .primary-button,
    .section-title .ghost-button {
      min-height: 34px;
      border-radius: 6px;
      padding: 0 12px;
      box-shadow: none;
    }

    .panel,
    .report-filter-panel {
      padding: 14px;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: var(--surface);
      box-shadow: 0 4px 12px rgba(12, 26, 43, 0.06);
    }

    .report-filter-panel {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr)) auto;
      align-items: end;
    }

    .field {
      display: grid;
      gap: 5px;
    }

    .field span,
    .branch-context-card span {
      color: var(--muted);
      font-size: 0.74rem;
      font-weight: 800;
      text-transform: uppercase;
    }

    input {
      min-height: 34px;
      border: 1px solid var(--line);
      border-radius: 6px;
      color: var(--ink);
      background: var(--surface);
      padding: 0 10px;
    }

    .branch-context-card {
      display: grid;
      gap: 4px;
      min-height: 58px;
      padding: 9px 10px;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: var(--surface-2);
    }

    .branch-context-card strong {
      color: var(--ink);
    }

    .branch-context-card small {
      color: var(--muted);
    }

    .metrics-grid,
    .dashboard-grid,
    .quick-grid {
      display: grid;
      gap: 10px;
    }

    .metrics-grid {
      grid-template-columns: repeat(4, minmax(0, 1fr));
    }

    .dashboard-grid {
      grid-template-columns: repeat(2, minmax(0, 1fr));
      align-items: start;
    }

    .quick-grid {
      grid-template-columns: repeat(auto-fit, minmax(210px, 1fr));
    }

    aura-kpi-card {
      min-width: 0;
    }

    .section-title {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 12px;
      margin-bottom: 10px;
    }

    .section-title h2 {
      margin: 0;
      color: var(--ink);
      font-size: 1rem;
      line-height: 1.2;
    }

    .badge {
      display: inline-flex;
      align-items: center;
      min-height: 24px;
      padding: 3px 9px;
      border: 1px solid var(--success-border, #A7F3D0);
      border-radius: 999px;
      color: var(--success-text, #065F46);
      background: var(--success-bg, #ECFDF5);
      font-size: 0.75rem;
      font-weight: 900;
    }

    .connected-report-panel {
      display: grid;
      gap: 10px;
    }
    .report-link-grid {
      display: grid;
      gap: 10px;
      grid-template-columns: repeat(3, minmax(0, 1fr));
    }
    .report-link-card {
      background: var(--surface);
      border: 1px solid var(--line);
      border-radius: 8px;
      color: inherit;
      display: grid;
      gap: 6px;
      min-height: 94px;
      padding: 12px;
      text-decoration: none;
      border-top: 3px solid var(--color-primary);
      box-shadow: none;
    }
    .report-link-card:hover {
      border-color: var(--color-primary-strong);
      background: var(--color-primary-soft);
    }
    .report-link-card span,
    .report-link-card small {
      color: var(--muted);
      font-size: 12px;
      font-weight: 800;
      text-transform: uppercase;
    }
    .report-link-card strong {
      color: var(--ink);
      font-size: 1rem;
      line-height: 1.2;
    }
    .action-card {
      display: grid;
      gap: 6px;
      min-height: 94px;
      padding: 12px;
      border: 1px solid var(--line);
      border-top: 3px solid var(--color-primary);
      border-radius: 8px;
      background: var(--surface);
      box-shadow: none;
    }
    .action-card strong {
      color: var(--ink);
      font-size: 1rem;
      line-height: 1.2;
    }
    .action-card span,
    .action-card small {
      color: var(--muted);
      font-weight: 800;
    }
    .summary-lines {
      display: grid;
      gap: 8px;
    }
    .summary-lines div {
      display: flex;
      justify-content: space-between;
      gap: 12px;
      padding: 10px 12px;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: var(--surface);
    }
    .summary-lines div.total {
      border-color: var(--success-border, #A7F3D0);
      background: var(--success-bg, #ECFDF5);
    }
    .summary-lines span {
      color: var(--muted);
    }
    .summary-lines strong {
      color: var(--ink);
    }
    .status-grid {
      display: grid;
      gap: 10px;
      grid-template-columns: repeat(4, minmax(0, 1fr));
    }
    .status-grid article {
      background: var(--surface);
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 12px;
      border-top: 3px solid var(--color-primary);
    }
    .status-grid span {
      color: var(--muted);
      display: block;
      font-size: 12px;
      font-weight: 800;
      text-transform: uppercase;
    }
    .status-grid strong {
      display: block;
      color: var(--ink);
      font-size: 1.35rem;
      margin-top: 6px;
    }
    .table-wrap {
      overflow-x: auto;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: var(--surface);
    }
    table {
      width: 100%;
      min-width: 760px;
      border-collapse: collapse;
    }
    th,
    td {
      padding: 9px 10px;
      border-bottom: 1px solid var(--line);
      text-align: left;
      vertical-align: top;
    }
    th {
      position: sticky;
      top: 0;
      z-index: 1;
      color: var(--muted);
      background: var(--surface-2);
      font-size: 0.75rem;
      font-weight: 900;
      text-transform: uppercase;
    }
    td small {
      color: var(--muted);
    }
    td .ghost-button {
      min-height: 30px;
      border-radius: 6px;
      padding: 0 10px;
      box-shadow: none;
    }
    td strong,
    td small {
      display: block;
    }
    @media (max-width: 760px) {
      .module-hero,
      .section-title {
        align-items: flex-start;
        flex-direction: column;
      }

      .report-filter-panel,
      .report-link-grid,
      .status-grid,
      .metrics-grid,
      .dashboard-grid {
        grid-template-columns: 1fr;
      }

      .hero-actions {
        justify-content: flex-start;
      }
    }
  `]
})
export class ReportsComponent implements OnInit {
  readonly report = signal<ApiRecord | null>(null);
  readonly analyticsCommand = signal<ApiRecord | null>(null);
  readonly branches = signal<ApiRecord[]>([]);
  readonly loading = signal(true);
  readonly error = signal('');
  readonly topStaff = computed(() => ((this.report()?.['staff'] as ApiRecord[] | undefined) || []).slice(0, 8));
  readonly quickLinks = computed(() => {
    const links = (this.report()?.['quickLinks'] as ApiRecord[] | undefined) || [];
    return links.length ? links : this.defaultQuickLinks;
  });

  from = this.monthStart();
  to = this.today();
  branchId = '';
  private initialized = false;

  private readonly defaultQuickLinks: ApiRecord[] = [
    { label: 'Financial Summary', path: '/reports/financial-summary', module: 'Owner accounting' },
    { label: 'Inward Revenue', path: '/reports/inward-revenue', module: 'FlexiSalon import' },
    { label: 'Sale Summary', path: '/reports/invoices', module: 'Sale list with bill' },
    { label: 'Service Trends', path: '/reports/invoices', queryParams: { report: 'service-trends' }, module: 'Service performance' },
    { label: 'Service Clients', path: '/reports/invoices', queryParams: { report: 'service-clients' }, module: 'Service client detail' },
    { label: 'Invoice Reports', path: '/reports/invoices', module: 'Invoice intelligence' },
    { label: 'Membership Redeem', path: '/memberships', queryParams: { tab: 'reports', report: 'membershipRedeem' }, module: 'Membership reports' },
    { label: 'Membership Sales By Customer', path: '/memberships', queryParams: { tab: 'reports', report: 'membershipSalesByCustomer' }, module: 'Membership reports' },
    { label: 'Staff Sales', path: '/reports/staff-sales', module: 'POS attribution' },
    { label: 'Commission Preview', path: '/reports/commission-preview', module: 'Payroll' },
    { label: 'Account Ledger', path: '/reports/account-ledger', module: 'Finance' },
    { label: 'Inventory Reports', path: '/inventory/reports', module: 'Inventory' },
    { label: 'Appointment Activity', path: '/appointment-activity', module: 'Bookings' },
    { label: 'Customer Feedback', path: '/reputation', queryParams: { tab: 'feedback' }, module: 'Reputation' },
    { label: 'Client CRM', path: '/clients', module: 'Clients' }
  ];

  constructor(private readonly api: ApiService) {
    effect(() => {
      this.api.selectedBranchId();
      if (this.initialized) this.load();
    });
  }

  ngOnInit(): void {
    this.initialized = true;
    this.loadBranches();
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.error.set('');
    this.branchId = this.api.selectedBranchId();
    this.api.report<ApiRecord>('advanced', {
      branchId: this.branchId,
      from: this.from,
      to: this.to
    }).subscribe({
      next: (report) => {
        this.report.set(report);
        this.loading.set(false);
      },
      error: (error) => {
        this.error.set(error?.error?.error || 'Unable to load reports');
        this.loading.set(false);
      }
    });
    this.loadAnalyticsCommandCenter();
  }

  loadAnalyticsCommandCenter(): void {
    this.api.list<ApiRecord>('analytics/report-command-center', {
      branchId: this.branchId || this.api.selectedBranchId(),
      from: this.from,
      to: this.to
    }).subscribe({
      next: (result) => this.analyticsCommand.set(result),
      error: () => this.analyticsCommand.set(null)
    });
  }

  createDefaultSchedule(): void {
    this.api.post<ApiRecord>('analytics/report-schedules', {
      branchId: this.api.selectedBranchId(),
      name: 'Weekly owner report digest',
      cadence: 'weekly',
      reportKeys: ['reports:sales-revenue', 'analytics:14-day-forecast', 'analytics:high-churn-risk'],
      recipients: []
    }).subscribe({
      next: () => this.loadAnalyticsCommandCenter(),
      error: (error) => this.error.set(this.api.errorText(error))
    });
  }

  runAnomalyDetection(): void {
    this.api.post<ApiRecord>('analytics/anomalies/run', { branchId: this.api.selectedBranchId() }).subscribe({
      next: () => this.loadAnalyticsCommandCenter(),
      error: (error) => this.error.set(this.api.errorText(error))
    });
  }

  branchLabel(): string {
    const branchId = this.api.selectedBranchId();
    if (!branchId) return 'Header branch not selected';
    return this.branches().find((branch) => branch.id === branchId)?.name || branchId;
  }

  private loadBranches(): void {
    this.api.list<ApiRecord[]>('branches', { limit: 1000 }).subscribe({
      next: (branches) => this.branches.set(branches || []),
      error: () => this.branches.set([])
    });
  }

  private today(): string {
    return new Date().toISOString().slice(0, 10);
  }

  private monthStart(): string {
    const date = new Date();
    date.setDate(1);
    return date.toISOString().slice(0, 10);
  }
}
