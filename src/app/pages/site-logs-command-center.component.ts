import { CommonModule } from '@angular/common';
import { Component, OnInit, computed, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiRecord, ApiService } from '../core/api.service';
import { AuraDatePipe } from '../shared/pipes/aura-date.pipe';

@Component({
  selector: 'app-site-logs-command-center',
  standalone: true,
  imports: [AuraDatePipe, CommonModule, FormsModule],
  template: `
    <section class="site-logs-page">
      <header class="page-head">
        <div>
          <span class="eyebrow">Security / Activity Logs</span>
          <h1>Site Activity & Audit Command Center</h1>
          <p>Track daily CRM activity, staff changes, client and invoice edits, security events, IP/device trails and high-risk actions.</p>
        </div>
        <div class="head-actions">
          <button type="button" (click)="exportCsv()">Export CSV</button>
          <button type="button" (click)="printPage()">Print</button>
          <button class="primary" type="button" (click)="load()">Search</button>
        </div>
      </header>

      <section class="filters">
        <label><span>Date</span><input type="date" [(ngModel)]="filters.from" /></label>
        <label><span>To</span><input type="date" [(ngModel)]="filters.to" /></label>
        <label>
          <span>Log Type</span>
          <select [(ngModel)]="filters.type">
            <option *ngFor="let type of typeOptions()" [value]="type.value">{{ type.label }}</option>
          </select>
        </label>
        <label>
          <span>User</span>
          <select [(ngModel)]="filters.user">
            <option *ngFor="let user of userOptions()" [value]="user.value">{{ user.label }}</option>
          </select>
        </label>
        <label>
          <span>Branch</span>
          <select [(ngModel)]="filters.branchId">
            <option *ngFor="let branch of branchOptions()" [value]="branch.value">{{ branch.label }}</option>
          </select>
        </label>
        <label><span>IP Address</span><input [(ngModel)]="filters.ipAddress" placeholder="IP address" /></label>
        <label>
          <span>Entity</span>
          <select [(ngModel)]="filters.entityType">
            <option *ngFor="let entity of entityOptions()" [value]="entity.value">{{ entity.label }}</option>
          </select>
        </label>
        <label><span>Search</span><input [(ngModel)]="filters.q" placeholder="Customer, invoice, phone, action, staff" /></label>
      </section>

      <section class="cards">
        <article *ngFor="let card of cards()">
          <small>{{ card.label }}</small>
          <strong>{{ card.value }}</strong>
          <span>{{ card.detail }}</span>
        </article>
      </section>

      <section class="work-grid">
        <article class="risk-panel">
          <header>
            <div>
              <span class="eyebrow">Risk Detection</span>
              <h2>High-Risk Activity</h2>
            </div>
            <strong>{{ riskAlerts().length }}</strong>
          </header>
          <button class="risk-row" type="button" *ngFor="let alert of riskAlerts()" (click)="openDetail(alert)">
            <span>{{ alert.createdAt | auraDate:'dateTime' }}</span>
            <strong>{{ alert.activity }}</strong>
            <small>{{ alert.riskFlags?.join(', ') || alert.severity }}</small>
          </button>
          <p class="empty" *ngIf="!riskAlerts().length">No high-risk events in this filter.</p>
        </article>

        <article class="timeline-panel">
          <header>
            <div>
              <span class="eyebrow">Timeline</span>
              <h2>Recent Activity</h2>
            </div>
          </header>
          <ol>
            <li *ngFor="let item of timeline()">
              <span>{{ item.createdAt | auraDate:'time' }}</span>
              <div>
                <strong>{{ item.updatedBy }}</strong>
                <small>{{ item.activity }}</small>
              </div>
            </li>
          </ol>
        </article>
      </section>

      <section class="table-shell">
        <header class="table-top">
          <div>
            <span class="eyebrow">Site Logs</span>
            <h2>Activity Register</h2>
          </div>
          <label>Show
            <select [(ngModel)]="filters.limit" (change)="load()">
              <option [ngValue]="25">25</option>
              <option [ngValue]="50">50</option>
              <option [ngValue]="100">100</option>
              <option [ngValue]="200">200</option>
            </select>
          </label>
        </header>
        <div class="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Date & Time</th>
                <th>Updated By</th>
                <th>Activity</th>
                <th>IP Address</th>
                <th>Type</th>
                <th>Branch</th>
                <th>Severity</th>
                <th>Source</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              <tr *ngFor="let log of rows()">
                <td><strong>{{ log.createdAt | auraDate:'dateTime' }}</strong></td>
                <td>{{ log.updatedBy }}</td>
                <td>
                  <strong>{{ log.activity }}</strong>
                  <small>{{ log.entityType }} {{ log.entityId }}</small>
                </td>
                <td>{{ log.ipAddress || '-' }}</td>
                <td>{{ log.type }}</td>
                <td>{{ log.branchId || '-' }}</td>
                <td><span class="pill" [class.warn]="isWarning(log)" [class.critical]="isCritical(log)">{{ log.severity }}</span></td>
                <td>{{ log.source }}</td>
                <td><button type="button" (click)="openDetail(log)">Open</button></td>
              </tr>
            </tbody>
          </table>
        </div>
        <p class="empty" *ngIf="!loading() && !rows().length">No logs found for this filter.</p>
      </section>

      <aside class="drawer" *ngIf="selected()">
        <header>
          <div>
            <span class="eyebrow">Audit Drilldown</span>
            <h2>{{ selected()?.type }} Event</h2>
          </div>
          <button type="button" (click)="selected.set(null)">Close</button>
        </header>
        <dl>
          <div><dt>Date & Time</dt><dd>{{ selected()?.createdAt | auraDate:'dateTime' }}</dd></div>
          <div><dt>Updated By</dt><dd>{{ selected()?.updatedBy }}</dd></div>
          <div><dt>Activity</dt><dd>{{ selected()?.activity }}</dd></div>
          <div><dt>IP / Device</dt><dd>{{ selected()?.ipAddress || '-' }}<br />{{ selected()?.userAgent || '-' }}</dd></div>
          <div><dt>Request ID</dt><dd>{{ selected()?.requestId || '-' }}</dd></div>
          <div><dt>Risk Flags</dt><dd>{{ selected()?.riskFlags?.join(', ') || 'None' }}</dd></div>
        </dl>
        <section>
          <h3>Before Payload</h3>
          <pre>{{ selected()?.beforePayload | json }}</pre>
        </section>
        <section>
          <h3>After Payload</h3>
          <pre>{{ selected()?.afterPayload | json }}</pre>
        </section>
        <section>
          <h3>Entity Timeline</h3>
          <ol class="drawer-timeline">
            <li *ngFor="let item of detailTimeline()">
              <strong>{{ item.createdAt | auraDate:'dateTime' }}</strong>
              <span>{{ item.activity }}</span>
            </li>
          </ol>
        </section>
      </aside>
    </section>
  `,
  styles: [`
    :host { display: block; color: #0f172a; }
    .site-logs-page { min-height: 100vh; background: #f6f8fb; padding: 24px; }
    .page-head, .filters, .cards article, .risk-panel, .timeline-panel, .table-shell, .drawer { border: 1px solid #dbe3ea; background: #fff; box-shadow: 0 18px 45px rgba(15, 23, 42, .06); }
    .page-head { display: flex; justify-content: space-between; gap: 24px; align-items: flex-start; padding: 24px; border-radius: 8px; }
    .eyebrow { display: block; color: #64748b; font-size: 12px; font-weight: 800; letter-spacing: 0; text-transform: uppercase; }
    h1, h2, h3, p { margin: 0; }
    h1 { margin-top: 6px; font-size: 32px; line-height: 1.15; }
    h2 { font-size: 20px; }
    h3 { font-size: 15px; margin-bottom: 8px; }
    p { color: #475569; margin-top: 10px; max-width: 760px; line-height: 1.5; }
    .head-actions { display: flex; gap: 10px; flex-wrap: wrap; justify-content: flex-end; }
    button, select, input { font: inherit; }
    button { border: 1px solid #cbd5e1; border-radius: 7px; background: #fff; color: #0f172a; font-weight: 800; padding: 10px 14px; cursor: pointer; }
    button.primary { border-color: #111827; background: #111827; color: #fff; }
    .filters { margin-top: 16px; padding: 18px; border-radius: 8px; display: grid; grid-template-columns: repeat(8, minmax(120px, 1fr)); gap: 12px; align-items: end; }
    label { display: grid; gap: 7px; color: #475569; font-weight: 700; }
    label span { color: #0f172a; }
    input, select { min-width: 0; border: 1px solid #d8e0e7; border-radius: 7px; background: #f8fafc; padding: 11px 12px; color: #111827; }
    .cards { display: grid; grid-template-columns: repeat(6, minmax(130px, 1fr)); gap: 12px; margin-top: 16px; }
    .cards article { border-radius: 8px; padding: 16px; }
    .cards small { color: #64748b; font-weight: 800; text-transform: uppercase; }
    .cards strong { display: block; margin: 8px 0; font-size: 24px; }
    .cards span { color: #64748b; font-size: 13px; }
    .work-grid { display: grid; grid-template-columns: minmax(0, 1.15fr) minmax(320px, .85fr); gap: 16px; margin-top: 16px; }
    .risk-panel, .timeline-panel, .table-shell { border-radius: 8px; padding: 18px; }
    .risk-panel header, .timeline-panel header, .table-top, .drawer header { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 14px; }
    .risk-panel header strong { color: #b91c1c; font-size: 28px; }
    .risk-row { width: 100%; display: grid; grid-template-columns: 150px minmax(0, 1fr) minmax(160px, .65fr); text-align: left; gap: 12px; align-items: center; border: 1px solid #fee2e2; background: #fff7f7; margin-bottom: 8px; }
    .risk-row span, .risk-row small { color: #64748b; }
    ol { margin: 0; padding: 0; list-style: none; display: grid; gap: 10px; }
    .timeline-panel li { display: grid; grid-template-columns: 56px minmax(0, 1fr); gap: 12px; align-items: start; }
    .timeline-panel li > span { color: #0f766e; font-weight: 900; }
    .timeline-panel small { display: block; color: #64748b; margin-top: 3px; }
    .table-shell { margin-top: 16px; padding: 0; overflow: hidden; }
    .table-top { padding: 18px 20px; border-bottom: 1px solid #e2e8f0; margin: 0; }
    .table-top label { grid-auto-flow: column; align-items: center; }
    .table-scroll { overflow: auto; }
    table { width: 100%; min-width: 1120px; border-collapse: collapse; background: #fff; }
    th, td { padding: 14px 18px; border-bottom: 1px solid #e2e8f0; text-align: left; vertical-align: top; }
    th { background: #f8fafc; color: #475569; font-size: 12px; text-transform: uppercase; }
    td small { display: block; color: #64748b; margin-top: 4px; }
    .pill { display: inline-flex; min-width: 70px; justify-content: center; padding: 5px 9px; border-radius: 999px; background: #e0f2fe; color: #075985; font-size: 12px; font-weight: 900; text-transform: uppercase; }
    .pill.warn { background: #fef3c7; color: #92400e; }
    .pill.critical { background: #fee2e2; color: #991b1b; }
    .empty { padding: 16px; color: #64748b; }
    .drawer { position: fixed; top: 0; right: 0; z-index: 30; width: min(620px, 96vw); height: 100vh; overflow: auto; padding: 22px; border-radius: 0; }
    dl { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; margin: 0 0 18px; }
    dt { color: #64748b; font-size: 12px; font-weight: 900; text-transform: uppercase; }
    dd { margin: 4px 0 0; word-break: break-word; }
    pre { max-height: 220px; overflow: auto; background: #0f172a; color: #e2e8f0; border-radius: 8px; padding: 14px; font-size: 12px; }
    .drawer section { margin-top: 18px; }
    .drawer-timeline li { border-left: 3px solid #0f766e; padding-left: 10px; }
    .drawer-timeline span { display: block; color: #64748b; margin-top: 2px; }
    @media (max-width: 1100px) {
      .page-head, .work-grid { grid-template-columns: 1fr; display: grid; }
      .filters { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .cards { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    }
    @media (max-width: 640px) {
      .site-logs-page { padding: 12px; }
      .page-head, .filters { grid-template-columns: 1fr; }
      .cards { grid-template-columns: 1fr; }
      h1 { font-size: 26px; }
      dl { grid-template-columns: 1fr; }
    }
  `]
})
export class SiteLogsCommandCenterComponent implements OnInit {
  readonly rows = signal<ApiRecord[]>([]);
  readonly overview = signal<ApiRecord>({});
  readonly selected = signal<ApiRecord | null>(null);
  readonly detailTimeline = signal<ApiRecord[]>([]);
  readonly loading = signal(false);

  readonly filters: ApiRecord = {
    from: '',
    to: '',
    type: '',
    user: '',
    branchId: '',
    ipAddress: '',
    entityType: '',
    q: '',
    limit: 50
  };

  readonly cards = computed(() => (this.overview()['cards'] as ApiRecord[] | undefined) || []);
  readonly riskAlerts = computed(() => (this.overview()['riskAlerts'] as ApiRecord[] | undefined) || []);
  readonly timeline = computed(() => (this.overview()['timeline'] as ApiRecord[] | undefined) || []);
  readonly typeOptions = computed(() => ((this.overview()['filters'] as ApiRecord | undefined)?.['types'] as ApiRecord[] | undefined) || [{ label: 'All Types', value: '' }]);
  readonly userOptions = computed(() => ((this.overview()['filters'] as ApiRecord | undefined)?.['users'] as ApiRecord[] | undefined) || [{ label: 'All Users', value: '' }]);
  readonly branchOptions = computed(() => ((this.overview()['filters'] as ApiRecord | undefined)?.['branches'] as ApiRecord[] | undefined) || [{ label: 'All Branches', value: '' }]);
  readonly entityOptions = computed(() => ((this.overview()['filters'] as ApiRecord | undefined)?.['entities'] as ApiRecord[] | undefined) || [{ label: 'All Entities', value: '' }]);

  constructor(private readonly api: ApiService) {}

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.api.list<ApiRecord>('site-logs/overview', this.cleanFilters()).subscribe({
      next: (overview) => this.overview.set(overview || {}),
      error: () => this.overview.set({ cards: [], riskAlerts: [], timeline: [] })
    });
    this.api.list<ApiRecord>('site-logs', this.cleanFilters()).subscribe({
      next: (result) => this.rows.set((result['rows'] as ApiRecord[]) || []),
      error: () => this.rows.set([]),
      complete: () => this.loading.set(false)
    });
  }

  openDetail(log: ApiRecord): void {
    this.selected.set(log);
    this.detailTimeline.set([]);
    this.api.list<ApiRecord>(`site-logs/${log['id']}`).subscribe({
      next: (detail) => {
        this.selected.set((detail['log'] as ApiRecord) || log);
        this.detailTimeline.set((detail['timeline'] as ApiRecord[]) || []);
      },
      error: () => this.detailTimeline.set([])
    });
  }

  isWarning(log: ApiRecord): boolean {
    return String(log['severity'] || '').toLowerCase().includes('warning');
  }

  isCritical(log: ApiRecord): boolean {
    return String(log['severity'] || '').toLowerCase().includes('critical');
  }

  exportCsv(): void {
    const header = ['Date & Time', 'Updated By', 'Activity', 'IP Address', 'Type', 'Branch', 'Severity', 'Source'];
    const body = this.rows().map((row) => [
      row['createdAt'],
      row['updatedBy'],
      row['activity'],
      row['ipAddress'],
      row['type'],
      row['branchId'],
      row['severity'],
      row['source']
    ]);
    const csv = [header, ...body].map((line) => line.map((value) => `"${String(value || '').replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `site-logs-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  printPage(): void {
    window.print();
  }

  private cleanFilters(): ApiRecord {
    return Object.fromEntries(Object.entries(this.filters).filter(([, value]) => value !== '' && value !== null && value !== undefined));
  }
}
