import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, OnDestroy, OnInit, computed, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { Subscription } from 'rxjs';
import { ApiRecord, ApiService } from '../core/api.service';
import { StateComponent } from '../shared/ui/state/state.component';
import { AuraMoneyPipe } from '../shared/pipes/aura-money.pipe';
import { AuraDatePipe } from '../shared/pipes/aura-date.pipe';

type ClientReportConfig = {
  key: string;
  title: string;
  description: string;
  endpoint: string;
  apiName: string;
  accent: string;
  empty: string;
  params: (branchId: string) => ApiRecord;
};

type SummaryCard = {
  label: string;
  value: string | number;
  hint: string;
  currency?: boolean;
};

const CLIENT_REPORT_CONFIG: Record<string, ClientReportConfig> = {
  'top-rfm': {
    key: 'top-rfm',
    title: 'Top clients (RFM)',
    description: 'Highest value clients ranked by recency, frequency and monetary score.',
    endpoint: 'clients/top-rfm',
    apiName: 'clients/top-rfm',
    accent: 'blue',
    empty: 'No RFM clients found for this branch.',
    params: (branchId) => ({ limit: 50, branchId })
  },
  'client-revenue': {
    key: 'client-revenue',
    title: 'Client Revenue',
    description: 'Salonist-style client revenue register with visits, last visit, due and membership signal.',
    endpoint: 'clients/revenue',
    apiName: 'clients/revenue',
    accent: 'teal',
    empty: 'No client revenue found for the selected filters.',
    params: (branchId) => ({ limit: 100, branchId })
  },
  lapsed: {
    key: 'lapsed',
    title: 'Lapsed / at-risk clients',
    description: 'Clients sitting in the 60-180 day recovery queue with spend and action signals.',
    endpoint: 'clients/lapsed',
    apiName: 'clients/lapsed',
    accent: 'red',
    empty: 'No lapsed clients in this 60-180 day window.',
    params: (branchId) => ({ minDays: 60, maxDays: 180, limit: 50, branchId })
  },
  'new-vs-returning': {
    key: 'new-vs-returning',
    title: 'New vs returning clients',
    description: 'Monthly split of new and returning clients for retention tracking.',
    endpoint: 'clients/new-vs-returning',
    apiName: 'clients/new-vs-returning',
    accent: 'green',
    empty: 'No new vs returning client data found.',
    params: (branchId) => ({ months: 12, branchId })
  },
  occasions: {
    key: 'occasions',
    title: 'Birthday / anniversary',
    description: 'Upcoming client birthday and anniversary moments in the next 30 days.',
    endpoint: 'clients/occasions',
    apiName: 'clients/occasions',
    accent: 'amber',
    empty: 'No birthday or anniversary in the next 30 days.',
    params: (branchId) => ({ withinDays: 30, limit: 50, branchId })
  },
  'by-service': {
    key: 'by-service',
    title: 'Service-wise clients',
    description: 'Service-level client, visit and revenue distribution from live reports.',
    endpoint: 'clients/by-service',
    apiName: 'clients/by-service',
    accent: 'violet',
    empty: 'No service-wise client data found.',
    params: (branchId) => ({ limit: 50, branchId })
  }
};

@Component({
  selector: 'app-client-report-detail',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [AuraDatePipe, AuraMoneyPipe, CommonModule, FormsModule, RouterLink, StateComponent],
  template: `
    <section class="client-report-detail inner-page-shell">
      <div class="report-back-row">
        <a class="ghost-button fit" routerLink="/clients">Back to Client CRM</a>
      </div>

      <section class="panel report-hero inner-page-header" [ngClass]="config().accent">
        <div>
          <h1>{{ config().title }}</h1>
          <p>{{ config().description }}</p>
        </div>
        <span class="api-badge">{{ config().apiName }}</span>
      </section>

      <nav class="api-chip-row" aria-label="Client report pages">
        <a
          *ngFor="let item of reportNavItems"
          [routerLink]="['/clients', 'reports', item.key]"
          [class.active]="reportKey() === item.key"
        >
          {{ item.apiName }}
        </a>
      </nav>

      <app-state
        [loading]="loading()"
        loadingText="Loading client report"
        [error]="error()"
        [empty]="!loading() && !error() && !rows().length ? config().empty : ''"
      ></app-state>

      <ng-container *ngIf="!loading() && !error() && (rows().length || reportKey() === 'client-revenue')">
        <section class="panel revenue-filter-panel" *ngIf="reportKey() === 'client-revenue'">
          <label>
            <span>From</span>
            <input type="date" [(ngModel)]="revenueFilters.from" />
          </label>
          <label>
            <span>To</span>
            <input type="date" [(ngModel)]="revenueFilters.to" />
          </label>
          <label>
            <span>Revenue order</span>
            <select [(ngModel)]="revenueFilters.order">
              <option value="desc">High to low</option>
              <option value="asc">Low to high</option>
            </select>
          </label>
          <label>
            <span>Client</span>
            <input placeholder="Name or phone" [(ngModel)]="revenueFilters.search" />
          </label>
          <label>
            <span>Membership</span>
            <select [(ngModel)]="revenueFilters.membershipStatus">
              <option value="all">All clients</option>
              <option value="member">Members</option>
              <option value="non-member">Non-members</option>
            </select>
          </label>
          <label>
            <span>Visits</span>
            <select [(ngModel)]="revenueFilters.visitBucket">
              <option value="all">All visits</option>
              <option value="1">1 visit</option>
              <option value="2-5">2-5</option>
              <option value="6-10">6-10</option>
              <option value="10+">10+</option>
            </select>
          </label>
          <label>
            <span>Revenue</span>
            <select [(ngModel)]="revenueFilters.revenueBucket">
              <option value="all">All revenue</option>
              <option value="0-1000">Up to â‚¹1,000</option>
              <option value="1000-10000">â‚¹1,000 - â‚¹10,000</option>
              <option value="10000+">â‚¹10,000+</option>
            </select>
          </label>
          <label>
            <span>Staff</span>
            <input placeholder="Staff name" [(ngModel)]="revenueFilters.staff" />
          </label>
          <label>
            <span>Service</span>
            <input placeholder="Service name" [(ngModel)]="revenueFilters.service" />
          </label>
          <button class="primary-button" type="button" (click)="load()">Run Report</button>
        </section>

        <section class="report-summary-grid inner-stats-grid">
          <article class="summary-card aura-card" *ngFor="let card of summaryCards()">
            <span>{{ card.label }}</span>
            <strong>
              <ng-container *ngIf="card.currency; else plainValue">
                {{ numeric(card.value) | auraMoney:'1.0-0' }}
              </ng-container>
              <ng-template #plainValue>{{ card.value }}</ng-template>
            </strong>
            <small>{{ card.hint }}</small>
          </article>
        </section>

        <section class="panel report-table-panel">
          <div class="section-title compact inner-action-bar">
            <h2>{{ config().title }}</h2>
            <span class="api-badge soft">{{ rows().length }} row(s)</span>
          </div>

          <div [ngSwitch]="reportKey()">
            <div *ngSwitchCase="'client-revenue'" class="revenue-table-wrap">
              <table class="revenue-table">
                <thead>
                  <tr>
                    <th>Client</th>
                    <th>Phone</th>
                    <th>Visits</th>
                    <th>Last visit</th>
                    <th>Total revenue</th>
                    <th>Average bill</th>
                    <th>Paid</th>
                    <th>Pending due</th>
                    <th>Membership</th>
                    <th>Last staff</th>
                    <th>Last service</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  <tr *ngFor="let row of rows(); trackBy: trackRow">
                    <td><strong>{{ clientName(row) }}</strong></td>
                    <td>{{ text(row['phone'], '-') }}</td>
                    <td>{{ numeric(row['totalVisits']) }}</td>
                    <td>{{ row['lastVisitAt'] | auraDate:'date' }}</td>
                    <td>{{ numeric(row['totalRevenue']) | auraMoney:'1.0-0' }}</td>
                    <td>{{ numeric(row['averageBill']) | auraMoney:'1.0-0' }}</td>
                    <td>{{ numeric(row['paidAmount']) | auraMoney:'1.0-0' }}</td>
                    <td>{{ numeric(row['pendingDue']) | auraMoney:'1.0-0' }}</td>
                    <td><span class="status-pill" [class.member]="row['membershipStatus'] === 'Member'">{{ text(row['membershipStatus'], 'Non-member') }}</span></td>
                    <td>{{ text(row['lastStaffName'], 'Unassigned') }}</td>
                    <td>{{ text(row['lastServiceName'], '-') }}</td>
                    <td><a class="mini-link" [routerLink]="clientLink(row)">Open 360</a></td>
                  </tr>
                </tbody>
              </table>
            </div>

            <div *ngSwitchCase="'top-rfm'" class="report-list">
              <div class="report-row header four"><span>Client</span><span>RFM</span><span>Spend</span><span>Segment</span></div>
              <a class="report-row four clickable" *ngFor="let row of rows(); trackBy: trackRow" [routerLink]="clientLink(row)">
                <span class="client-line"><strong>{{ clientName(row) }}</strong><small>{{ text(row['phone'] || row['email'], 'Client profile') }}</small></span>
                <span>{{ numeric(row['rfmScore']) }}</span>
                <span>{{ numeric(row['monetary']) | auraMoney:'1.0-0' }}</span>
                <span>{{ text(row['segment'], '-') }}</span>
              </a>
            </div>

            <div *ngSwitchCase="'lapsed'" class="report-list">
              <div class="report-row header four"><span>Client</span><span>Inactive days</span><span>Spend</span><span>Suggested action</span></div>
              <a class="report-row four clickable" *ngFor="let row of rows(); trackBy: trackRow" [routerLink]="clientLink(row)">
                <span class="client-line"><strong>{{ clientName(row) }}</strong><small>{{ text(row['segment'], 'Recovery queue') }}</small></span>
                <span>{{ numeric(row['daysSinceLastVisit']) }}</span>
                <span>{{ numeric(row['monetary']) | auraMoney:'1.0-0' }}</span>
                <span>{{ text(row['suggestedAction'], 'Follow up') }}</span>
              </a>
            </div>

            <div *ngSwitchCase="'new-vs-returning'" class="report-list">
              <div class="report-row header three"><span>Month</span><span>New clients</span><span>Returning clients</span></div>
              <div class="report-row three" *ngFor="let row of rows(); trackBy: trackRow">
                <span>{{ text(row['month'], '-') }}</span>
                <span>{{ numeric(row['newClients']) }}</span>
                <span>{{ numeric(row['returningClients']) }}</span>
              </div>
            </div>

            <div *ngSwitchCase="'occasions'" class="report-list">
              <div class="report-row header four"><span>Client</span><span>Type</span><span>Next date</span><span>Days until</span></div>
              <a class="report-row four clickable" *ngFor="let row of rows(); trackBy: trackRow" [routerLink]="clientLink(row)">
                <span class="client-line"><strong>{{ clientName(row) }}</strong><small>{{ text(row['phone'] || row['email'], 'Client profile') }}</small></span>
                <span>{{ titleText(row['type']) }}</span>
                <span>{{ row['nextDate'] | auraDate:'date' }}</span>
                <span>{{ numeric(row['daysUntil']) }}</span>
              </a>
            </div>

            <div *ngSwitchCase="'by-service'" class="report-list">
              <div class="report-row header four"><span>Service</span><span>Clients</span><span>Revenue</span><span>Visits</span></div>
              <div class="report-row four" *ngFor="let row of rows(); trackBy: trackRow">
                <span class="client-line"><strong>{{ text(row['serviceName'], 'Service') }}</strong><small>{{ text(row['category'], 'Service report') }}</small></span>
                <span>{{ numeric(row['clientCount']) }}</span>
                <span>{{ numeric(row['revenue']) | auraMoney:'1.0-0' }}</span>
                <span>{{ numeric(row['visitCount']) }}</span>
              </div>
            </div>
          </div>
        </section>
      </ng-container>
    </section>
  `,
  styles: [`
    .client-report-detail {
      display: grid;
      gap: 16px;
    }

    .report-back-row {
      display: flex;
      justify-content: flex-start;
    }

    .report-hero {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      min-height: 132px;
      padding: 24px;
      border-left: 5px solid #55173D;
      background:
        radial-gradient(circle at 92% 12%, color-mix(in srgb, var(--accent, #4B1238) 18%, transparent), transparent 34%),
        linear-gradient(135deg, color-mix(in srgb, var(--accent, #4B1238) 8%, white), var(--surface));
    }

    .report-hero.blue { --accent: #4B1238; }
    .report-hero.teal { --accent: #55173D; }
    .report-hero.red { --accent: #b91c1c; }
    .report-hero.green { --accent: #4B1238; }
    .report-hero.amber { --accent: #4B1238; }
    .report-hero.violet { --accent: #4B1238; }

    .report-hero h1 {
      margin: 4px 0 6px;
      font-size: clamp(28px, 3vw, 44px);
      line-height: 1.05;
      letter-spacing: 0;
    }

    .report-hero p {
      margin: 0;
      max-width: 760px;
      color: var(--muted);
      font-weight: 700;
    }

    .api-chip-row {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }

    .api-chip-row a,
    .api-badge {
      display: inline-flex;
      align-items: center;
      min-height: 30px;
      padding: 6px 12px;
      border: 1px solid color-mix(in srgb, #4B1238 36%, var(--line));
      border-radius: 999px;
      background: color-mix(in srgb, #EAD9E5 40%, var(--surface));
      color: #7A4A28;
      text-decoration: none;
      font-size: 12px;
      font-weight: 900;
      letter-spacing: 0;
      white-space: nowrap;
    }

    .api-chip-row a.active,
    .api-chip-row a:hover {
      background: #4B1238;
      color: #fff;
      border-color: #4B1238;
    }

    .api-badge.soft {
      background: color-mix(in srgb, var(--surface) 78%, #EAD9E5);
      color: var(--muted);
    }

    .report-summary-grid {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 12px;
    }

    .revenue-filter-panel {
      display: grid;
      grid-template-columns: repeat(5, minmax(140px, 1fr));
      gap: 12px;
      align-items: end;
    }

    .revenue-filter-panel label {
      display: grid;
      gap: 6px;
    }

    .revenue-filter-panel span {
      color: var(--muted);
      font-size: 12px;
      font-weight: 900;
    }

    .revenue-filter-panel input,
    .revenue-filter-panel select {
      width: 100%;
      min-height: 44px;
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 0 12px;
      background: var(--surface);
      color: var(--ink);
      font: inherit;
    }

    .summary-card {
      display: grid;
      gap: 6px;
      min-height: 112px;
      padding: 16px;
      border: 1px solid var(--line);
      border-top: 4px solid #55173D;
      border-radius: 8px;
      background: var(--surface);
      box-shadow: 0 16px 30px color-mix(in srgb, var(--ink) 7%, transparent);
    }

    .summary-card span {
      color: var(--muted);
      font-size: 12px;
      font-weight: 900;
      text-transform: uppercase;
      letter-spacing: 0;
    }

    .summary-card strong {
      font-size: 28px;
      line-height: 1.05;
    }

    .summary-card small {
      color: var(--muted);
      font-weight: 700;
    }

    .report-table-panel {
      display: grid;
      gap: 14px;
      overflow: hidden;
    }

    .report-list {
      display: grid;
      gap: 6px;
      overflow-x: auto;
    }

    .revenue-table-wrap {
      overflow-x: auto;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: var(--surface);
    }

    .revenue-table {
      width: 100%;
      min-width: 1320px;
      border-collapse: collapse;
    }

    .revenue-table th,
    .revenue-table td {
      padding: 13px 14px;
      border-bottom: 1px solid var(--line);
      text-align: left;
      vertical-align: middle;
      white-space: nowrap;
    }

    .revenue-table th {
      background: color-mix(in srgb, var(--surface) 78%, #e2e8f0);
      color: var(--muted);
      font-size: 12px;
      font-weight: 900;
      text-transform: uppercase;
      letter-spacing: 0;
    }

    .status-pill,
    .mini-link {
      display: inline-flex;
      align-items: center;
      min-height: 28px;
      padding: 5px 10px;
      border-radius: 999px;
      font-size: 12px;
      font-weight: 900;
      text-decoration: none;
      white-space: nowrap;
    }

    .status-pill {
      background: #f1f5f9;
      color: #475569;
    }

    .status-pill.member {
      background: #FBF0E8;
      color: #7A4A28;
    }

    .mini-link {
      border: 1px solid color-mix(in srgb, #4B1238 36%, var(--line));
      background: color-mix(in srgb, #EAD9E5 35%, var(--surface));
      color: #7A4A28;
    }

    .report-row {
      display: grid;
      align-items: center;
      gap: 12px;
      min-height: 54px;
      padding: 12px 14px;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: var(--surface);
      color: var(--ink);
      text-decoration: none;
    }

    .report-row.four {
      grid-template-columns: minmax(220px, 1.5fr) 120px 150px minmax(180px, 1fr);
    }

    .report-row.three {
      grid-template-columns: minmax(180px, 1fr) 150px 170px;
    }

    .report-row.header {
      min-height: 38px;
      background: color-mix(in srgb, var(--surface) 78%, #e2e8f0);
      color: var(--muted);
      font-size: 12px;
      font-weight: 900;
      text-transform: uppercase;
      letter-spacing: 0;
    }

    .report-row.clickable:hover,
    .report-row.clickable:focus-visible {
      border-color: #55173D;
      box-shadow: 0 14px 28px color-mix(in srgb, var(--ink) 8%, transparent);
      outline: none;
      transform: translateY(-1px);
    }

    .client-line {
      display: grid;
      gap: 2px;
      min-width: 0;
    }

    .client-line strong,
    .client-line small {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .client-line small {
      color: var(--muted);
      font-weight: 700;
    }

    @media (max-width: 980px) {
      .report-hero {
        align-items: flex-start;
        flex-direction: column;
      }

      .report-summary-grid {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }

      .revenue-filter-panel {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }

      .report-row.four,
      .report-row.three {
        min-width: 720px;
      }
    }

    @media (max-width: 640px) {
      .report-summary-grid {
        grid-template-columns: 1fr;
      }

      .revenue-filter-panel {
        grid-template-columns: 1fr;
      }
    }
  `]
})
export class ClientReportDetailComponent implements OnInit, OnDestroy {
  readonly reportKey = signal('top-rfm');
  readonly rows = signal<ApiRecord[]>([]);
  readonly reportSummary = signal<ApiRecord>({});
  readonly loading = signal(true);
  readonly error = signal('');
  readonly config = computed(() => CLIENT_REPORT_CONFIG[this.reportKey()] || CLIENT_REPORT_CONFIG['top-rfm']);
  readonly reportNavItems = Object.values(CLIENT_REPORT_CONFIG);
  readonly revenueFilters = {
    from: '',
    to: '',
    order: 'desc',
    search: '',
    membershipStatus: 'all',
    visitBucket: 'all',
    revenueBucket: 'all',
    staff: '',
    service: ''
  };

  private routeSub?: Subscription;

  constructor(
    private readonly api: ApiService,
    private readonly route: ActivatedRoute
  ) {}

  ngOnInit(): void {
    this.routeSub = this.route.paramMap.subscribe((params) => {
      const key = params.get('reportKey') || 'top-rfm';
      this.reportKey.set(CLIENT_REPORT_CONFIG[key] ? key : 'top-rfm');
      this.load();
    });
  }

  ngOnDestroy(): void {
    this.routeSub?.unsubscribe();
  }

  load(): void {
    this.loading.set(true);
    this.error.set('');
    const config = this.config();
    this.api.report<ApiRecord[] | ApiRecord>(config.endpoint, this.paramsFor(config)).subscribe({
      next: (response) => {
        const rows = Array.isArray(response) ? response : Array.isArray(response?.['rows']) ? response['rows'] : [];
        this.reportSummary.set(!Array.isArray(response) && response?.['summary'] ? response['summary'] : {});
        this.rows.set(rows);
        this.loading.set(false);
      },
      error: (error) => {
        this.error.set(this.api.errorText(error, `Unable to load ${config.title}`));
        this.rows.set([]);
        this.loading.set(false);
      }
    });
  }

  summaryCards(): SummaryCard[] {
    const rows = this.rows();
    const sum = (key: string) => rows.reduce((total, row) => total + this.numeric(row[key]), 0);
    const max = (key: string) => rows.reduce((highest, row) => Math.max(highest, this.numeric(row[key])), 0);
    const summary = this.reportSummary();

    if (this.reportKey() === 'client-revenue') {
      return [
        { label: 'Total clients', value: this.numeric(summary['totalClients']) || rows.length, hint: 'Revenue clients in filter' },
        { label: 'Total visits', value: this.numeric(summary['totalVisits']) || sum('totalVisits'), hint: 'Valid invoice visits' },
        { label: 'Total revenue', value: this.numeric(summary['totalRevenue']) || sum('totalRevenue'), hint: 'Completed valid invoices', currency: true },
        { label: 'New clients', value: this.numeric(summary['newClients']), hint: 'Created in selected window' },
        { label: 'Repeat clients', value: this.numeric(summary['repeatClients']), hint: 'More than one visit' },
        { label: 'Average bill', value: this.numeric(summary['averageBill']) || sum('totalRevenue') / Math.max(1, sum('totalVisits')), hint: 'Revenue / visits', currency: true },
        { label: 'Pending due', value: this.numeric(summary['pendingDue']) || sum('pendingDue'), hint: 'Open balance', currency: true },
        { label: 'Member clients', value: this.numeric(summary['memberClients']), hint: 'Active membership signal' }
      ];
    }

    if (this.reportKey() === 'top-rfm') {
      return [
        { label: 'Clients', value: rows.length, hint: 'Ranked by RFM score' },
        { label: 'Top client', value: this.clientName(rows[0] || {}), hint: 'Highest score in this list' },
        { label: 'Total spend', value: sum('monetary'), hint: 'Visible rows', currency: true },
        { label: 'Max RFM', value: max('rfmScore'), hint: 'Best score' }
      ];
    }

    if (this.reportKey() === 'lapsed') {
      return [
        { label: 'At-risk clients', value: rows.length, hint: '60-180 day window' },
        { label: 'Oldest inactive', value: max('daysSinceLastVisit'), hint: 'Days since last visit' },
        { label: 'Recovery value', value: sum('monetary'), hint: 'Visible client value', currency: true },
        { label: 'First action', value: this.text(rows[0]?.['suggestedAction'], 'Follow up'), hint: 'Suggested queue action' }
      ];
    }

    if (this.reportKey() === 'new-vs-returning') {
      const latest = rows[rows.length - 1] || {};
      return [
        { label: 'Months', value: rows.length, hint: 'Report window' },
        { label: 'New clients', value: sum('newClients'), hint: 'Total in window' },
        { label: 'Returning', value: sum('returningClients'), hint: 'Total in window' },
        { label: 'Latest month', value: this.text(latest['month'], '-'), hint: `${this.numeric(latest['newClients'])} new / ${this.numeric(latest['returningClients'])} returning` }
      ];
    }

    if (this.reportKey() === 'occasions') {
      return [
        { label: 'Upcoming', value: rows.length, hint: 'Next 30 days' },
        { label: 'Nearest due', value: max('daysUntil') ? Math.min(...rows.map((row) => this.numeric(row['daysUntil'])).filter((value) => value >= 0)) : 0, hint: 'Days until occasion' },
        { label: 'Birthdays', value: rows.filter((row) => String(row['type'] || '').toLowerCase().includes('birth')).length, hint: 'Birthday records' },
        { label: 'Anniversaries', value: rows.filter((row) => String(row['type'] || '').toLowerCase().includes('anniversary')).length, hint: 'Anniversary records' }
      ];
    }

    return [
      { label: 'Services', value: rows.length, hint: 'Service rows' },
      { label: 'Client links', value: sum('clientCount'), hint: 'Total service-client links' },
      { label: 'Revenue', value: sum('revenue'), hint: 'Visible service revenue', currency: true },
      { label: 'Visits', value: sum('visitCount'), hint: 'Total visits' }
    ];
  }

  clientLink(row: ApiRecord): string[] {
    return row?.['id'] || row?.['clientId'] ? ['/clients', String(row['id'] || row['clientId'])] : ['/clients'];
  }

  clientName(row: ApiRecord): string {
    return this.text(row?.['name'] || row?.['clientName'], 'Unknown client');
  }

  numeric(value: unknown): number {
    const numberValue = Number(value || 0);
    return Number.isFinite(numberValue) ? numberValue : 0;
  }

  text(value: unknown, fallback = '-'): string {
    const stringValue = String(value || '').trim();
    return stringValue || fallback;
  }

  titleText(value: unknown): string {
    return this.text(value)
      .replace(/[_-]+/g, ' ')
      .replace(/\b\w/g, (letter) => letter.toUpperCase());
  }

  trackRow(index: number, row: ApiRecord): string {
    return String(row?.['id'] || row?.['serviceName'] || row?.['month'] || row?.['nextDate'] || index);
  }

  private paramsFor(config: ClientReportConfig): ApiRecord {
    const params = config.params(this.api.selectedBranchId());
    if (config.key !== 'client-revenue') return params;
    return {
      ...params,
      from: this.revenueFilters.from,
      to: this.revenueFilters.to,
      order: this.revenueFilters.order,
      search: this.revenueFilters.search,
      membershipStatus: this.revenueFilters.membershipStatus,
      visitBucket: this.revenueFilters.visitBucket,
      revenueBucket: this.revenueFilters.revenueBucket,
      staff: this.revenueFilters.staff,
      service: this.revenueFilters.service
    };
  }
}

