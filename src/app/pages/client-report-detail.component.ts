import { CommonModule, CurrencyPipe, DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, OnDestroy, OnInit, computed, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { Subscription } from 'rxjs';
import { ApiRecord, ApiService } from '../core/api.service';
import { StateComponent } from '../shared/ui/state/state.component';

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
  imports: [CommonModule, RouterLink, CurrencyPipe, DatePipe, StateComponent],
  template: `
    <section class="client-report-detail">
      <div class="report-back-row">
        <a class="ghost-button fit" routerLink="/clients">Back to Client CRM</a>
      </div>

      <section class="panel report-hero" [ngClass]="config().accent">
        <div>
          <span class="eyebrow">Client intelligence</span>
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

      <ng-container *ngIf="!loading() && !error() && rows().length">
        <section class="report-summary-grid">
          <article class="summary-card" *ngFor="let card of summaryCards()">
            <span>{{ card.label }}</span>
            <strong>
              <ng-container *ngIf="card.currency; else plainValue">
                {{ numeric(card.value) | currency: 'INR':'symbol':'1.0-0' }}
              </ng-container>
              <ng-template #plainValue>{{ card.value }}</ng-template>
            </strong>
            <small>{{ card.hint }}</small>
          </article>
        </section>

        <section class="panel report-table-panel">
          <div class="section-title compact">
            <h2>{{ config().title }}</h2>
            <span class="api-badge soft">{{ rows().length }} row(s)</span>
          </div>

          <div [ngSwitch]="reportKey()">
            <div *ngSwitchCase="'top-rfm'" class="report-list">
              <div class="report-row header four"><span>Client</span><span>RFM</span><span>Spend</span><span>Segment</span></div>
              <a class="report-row four clickable" *ngFor="let row of rows(); trackBy: trackRow" [routerLink]="clientLink(row)">
                <span class="client-line"><strong>{{ clientName(row) }}</strong><small>{{ text(row['phone'] || row['email'], 'Client profile') }}</small></span>
                <span>{{ numeric(row['rfmScore']) }}</span>
                <span>{{ numeric(row['monetary']) | currency: 'INR':'symbol':'1.0-0' }}</span>
                <span>{{ text(row['segment'], '-') }}</span>
              </a>
            </div>

            <div *ngSwitchCase="'lapsed'" class="report-list">
              <div class="report-row header four"><span>Client</span><span>Inactive days</span><span>Spend</span><span>Suggested action</span></div>
              <a class="report-row four clickable" *ngFor="let row of rows(); trackBy: trackRow" [routerLink]="clientLink(row)">
                <span class="client-line"><strong>{{ clientName(row) }}</strong><small>{{ text(row['segment'], 'Recovery queue') }}</small></span>
                <span>{{ numeric(row['daysSinceLastVisit']) }}</span>
                <span>{{ numeric(row['monetary']) | currency: 'INR':'symbol':'1.0-0' }}</span>
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
                <span>{{ row['nextDate'] | date: 'mediumDate' }}</span>
                <span>{{ numeric(row['daysUntil']) }}</span>
              </a>
            </div>

            <div *ngSwitchCase="'by-service'" class="report-list">
              <div class="report-row header four"><span>Service</span><span>Clients</span><span>Revenue</span><span>Visits</span></div>
              <div class="report-row four" *ngFor="let row of rows(); trackBy: trackRow">
                <span class="client-line"><strong>{{ text(row['serviceName'], 'Service') }}</strong><small>{{ text(row['category'], 'Service report') }}</small></span>
                <span>{{ numeric(row['clientCount']) }}</span>
                <span>{{ numeric(row['revenue']) | currency: 'INR':'symbol':'1.0-0' }}</span>
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
      border-left: 5px solid #0f8f7b;
      background:
        radial-gradient(circle at 92% 12%, color-mix(in srgb, var(--accent, #0f8f7b) 18%, transparent), transparent 34%),
        linear-gradient(135deg, color-mix(in srgb, var(--accent, #0f8f7b) 8%, white), var(--surface));
    }

    .report-hero.blue { --accent: #2f5dcc; }
    .report-hero.red { --accent: #b91c1c; }
    .report-hero.green { --accent: #1f7a3d; }
    .report-hero.amber { --accent: #b87810; }
    .report-hero.violet { --accent: #6d4bd8; }

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
      border: 1px solid color-mix(in srgb, #0f766e 36%, var(--line));
      border-radius: 999px;
      background: color-mix(in srgb, #ccfbf1 40%, var(--surface));
      color: #064e3b;
      text-decoration: none;
      font-size: 12px;
      font-weight: 900;
      letter-spacing: 0;
      white-space: nowrap;
    }

    .api-chip-row a.active,
    .api-chip-row a:hover {
      background: #0f766e;
      color: #fff;
      border-color: #0f766e;
    }

    .api-badge.soft {
      background: color-mix(in srgb, var(--surface) 78%, #ccfbf1);
      color: var(--muted);
    }

    .report-summary-grid {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 12px;
    }

    .summary-card {
      display: grid;
      gap: 6px;
      min-height: 112px;
      padding: 16px;
      border: 1px solid var(--line);
      border-top: 4px solid #0f8f7b;
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
      border-color: #0f8f7b;
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

      .report-row.four,
      .report-row.three {
        min-width: 720px;
      }
    }

    @media (max-width: 640px) {
      .report-summary-grid {
        grid-template-columns: 1fr;
      }
    }
  `]
})
export class ClientReportDetailComponent implements OnInit, OnDestroy {
  readonly reportKey = signal('top-rfm');
  readonly rows = signal<ApiRecord[]>([]);
  readonly loading = signal(true);
  readonly error = signal('');
  readonly config = computed(() => CLIENT_REPORT_CONFIG[this.reportKey()] || CLIENT_REPORT_CONFIG['top-rfm']);
  readonly reportNavItems = Object.values(CLIENT_REPORT_CONFIG);

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
    this.api.report<ApiRecord[]>(config.endpoint, config.params(this.api.selectedBranchId())).subscribe({
      next: (rows) => {
        this.rows.set(Array.isArray(rows) ? rows : []);
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
    return row?.['id'] ? ['/clients', String(row['id'])] : ['/clients'];
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
}
