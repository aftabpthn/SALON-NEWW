import { CommonModule } from '@angular/common';
import { Component, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { AuthSessionService } from '../core/auth-session.service';
import { grantsAllow, staticGrantsForRole } from '../core/permission.guard';
import { routePermissionForPath } from '../core/access-rules';
import { AppStateService } from '../core/state/app-state.service';
import { ApiRecord, ApiService } from '../core/api.service';

type MessageHistoryResponse = {
  summary?: ApiRecord;
  rows?: ApiRecord[];
  sources?: Array<{ key: string; label: string }>;
};

@Component({
  selector: 'app-message-history-report',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  template: `
    <section class="message-history-page inner-page-shell">
      <header class="page-hero inner-page-header">
        <div>
          <h1>Message History</h1>
        </div>
        <div class="hero-actions inner-action-bar">
          <a class="ghost-button" routerLink="/whatsapp">WhatsApp</a>
          <a class="ghost-button" routerLink="/notification-center">Notifications</a>
          <button class="primary-button" type="button" (click)="load()">Run Report</button>
        </div>
      </header>

      <section class="filter-panel">
        <label>
          <span>From</span>
          <input type="date" [(ngModel)]="filters.from" />
        </label>
        <label>
          <span>To</span>
          <input type="date" [(ngModel)]="filters.to" />
        </label>
        <label>
          <span>Channel</span>
          <select [(ngModel)]="filters.channel">
            <option value="all">All channels</option>
            <option value="whatsapp">WhatsApp</option>
            <option value="sms">SMS</option>
            <option value="email">Email</option>
            <option value="push">Push</option>
          </select>
        </label>
        <label>
          <span>Status</span>
          <select [(ngModel)]="filters.status">
            <option value="all">All statuses</option>
            <option value="queued">Queued</option>
            <option value="sent">Sent</option>
            <option value="delivered">Delivered</option>
            <option value="failed">Failed</option>
            <option value="blocked">Blocked</option>
          </select>
        </label>
        <label>
          <span>Source</span>
          <select [(ngModel)]="filters.source">
            <option value="all">All sources</option>
            <option *ngFor="let source of sources" [value]="source.key">{{ source.label }}</option>
          </select>
        </label>
        <label>
          <span>Template</span>
          <input [(ngModel)]="filters.template" placeholder="Template name" />
        </label>
        <label>
          <span>Search</span>
          <input [(ngModel)]="filters.q" placeholder="Client, phone, message, invoice" />
        </label>
        <button class="primary-button apply" type="button" (click)="load()">Apply filters</button>
      </section>

      <section class="kpi-grid">
        <article><span>Total messages</span><strong>{{ metric('total') }}</strong></article>
        <article><span>Outbound</span><strong>{{ metric('outbound') }}</strong></article>
        <article><span>WhatsApp</span><strong>{{ metric('whatsapp') }}</strong></article>
        <article><span>SMS</span><strong>{{ metric('sms') }}</strong></article>
        <article><span>Queued</span><strong>{{ metric('queued') }}</strong></article>
        <article><span>Sent</span><strong>{{ metric('sent') }}</strong></article>
        <article><span>Delivered</span><strong>{{ metric('delivered') }}</strong></article>
        <article><span>Failed</span><strong>{{ metric('failed') }}</strong></article>
      </section>

      <section class="source-strip">
        <button type="button" [class.active]="filters.source === 'all'" (click)="setSource('all')">All</button>
        <button *ngFor="let source of sources" type="button" [class.active]="filters.source === source.key" (click)="setSource(source.key)">
          {{ source.label }} <b>{{ sourceCount(source.key) }}</b>
        </button>
      </section>

      <section class="table-panel">
        <div class="section-title">
          <div>
            <h2>Automated Messages</h2>
          </div>
          <div class="table-actions">
            <span *ngIf="loading">Loading...</span>
            <button class="ghost-button mini" type="button" (click)="exportCsv()" [disabled]="!rows.length">CSV</button>
          </div>
        </div>

        <div class="table-wrap" *ngIf="rows.length; else emptyState">
          <table>
            <thead>
              <tr>
                <th>Send date & time</th>
                <th>Template / source</th>
                <th>Message</th>
                <th>Contact</th>
                <th>Client</th>
                <th>Channel</th>
                <th>Status</th>
                <th>Delivery</th>
                <th>Provider</th>
                <th>Reference</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              <tr *ngFor="let row of rows">
                <td><strong>{{ row.date || '-' }}</strong><small>{{ row.time || '-' }}</small></td>
                <td><strong>{{ row.template || '-' }}</strong><small>{{ row.source }}</small></td>
                <td class="message-cell">{{ row.message || '-' }}</td>
                <td><span class="pill">{{ row.contact || '-' }}</span></td>
                <td>{{ row.clientName || row.clientId || '-' }}</td>
                <td><span class="badge neutral">{{ row.channel || '-' }}</span></td>
                <td><span class="badge" [class.failed]="row.status === 'failed'" [class.ok]="row.status === 'sent' || row.status === 'delivered'">{{ row.status || '-' }}</span></td>
                <td>{{ row.deliveryStatus || '-' }}</td>
                <td><small>{{ row.provider || row.providerMessageId || '-' }}</small></td>
                <td><strong>{{ row.referenceLabel || row.referenceId || '-' }}</strong><small>{{ row.referenceType || '' }}</small></td>
                <td>
                  <div class="row-actions">
                    <a *ngIf="row.clientId" class="ghost-button mini" [routerLink]="['/clients', row.clientId]">Client</a>
                    <ng-container *ngIf="canAccessPath('/pos/invoices')">
                      <a *ngIf="row.referenceType === 'invoice' || row.referenceLabel" class="ghost-button mini" routerLink="/pos/invoices" [queryParams]="{ q: row.referenceLabel || row.referenceId }">Invoice</a>
                    </ng-container>
                    <a *ngIf="!row.clientId && !(row.referenceType === 'invoice' || row.referenceLabel)" class="ghost-button mini" routerLink="/message-logs">Open</a>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <ng-template #emptyState>
          <div class="empty-state">
            <strong>No message history found</strong>
            <span>Send messages from POS, appointments, due recovery, engagement, membership, campaigns or staff notifications. They will appear here when logged.</span>
          </div>
        </ng-template>
      </section>
    </section>
  `,
  styles: [`
    :host { display: block; background: #f4f8f7; min-height: 100vh; color: #102033; }
    .message-history-page { display: grid; gap: 18px; padding: 22px; }
    .page-hero, .filter-panel, .table-panel { background: #fff; border: 1px solid #dbe8e4; border-radius: 22px; box-shadow: 0 18px 50px rgba(15, 23, 42, .06); }
    .page-hero { display: flex; align-items: center; justify-content: space-between; gap: 18px; padding: 26px; }
    .eyebrow { display: block; color: #53645f; font-size: 12px; font-weight: 800; text-transform: uppercase; letter-spacing: .03em; }
    h1, h2 { margin: 4px 0; color: #122033; }
    p { margin: 0; color: #60716d; }
    .hero-actions, .table-actions, .row-actions { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
    .primary-button, .ghost-button { border: 1px solid #d7e5e1; border-radius: 14px; padding: 12px 18px; font-weight: 800; text-decoration: none; cursor: pointer; }
    .primary-button { background: #4D1538; color: #fff; border-color: #4D1538; }
    .primary-button:disabled, .ghost-button:disabled { opacity: .55; cursor: not-allowed; }
    .ghost-button { background: #fff; color: #162235; }
    .mini { padding: 8px 12px; font-size: 13px; }
    .filter-panel { display: grid; grid-template-columns: repeat(4, minmax(180px, 1fr)); gap: 14px; padding: 18px; }
    label { display: grid; gap: 7px; color: #45556a; font-size: 13px; font-weight: 800; }
    input, select { width: 100%; box-sizing: border-box; border: 1px solid #d6e6e1; border-radius: 13px; padding: 12px 13px; font: inherit; color: #14233a; background: #fff; }
    .apply { align-self: end; min-height: 45px; }
    .kpi-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 14px; }
    .kpi-grid article { background: #fff; border: 1px solid #dfeae7; border-radius: 16px; padding: 17px; }
    .kpi-grid span { display: block; color: #5a6a66; font-size: 13px; font-weight: 800; }
    .kpi-grid strong { display: block; margin-top: 6px; font-size: 28px; color: #122033; }
    .kpi-grid small, td small { display: block; color: #61716d; margin-top: 4px; }
    .source-strip { display: flex; gap: 10px; overflow-x: auto; padding: 4px 2px; }
    .source-strip button { border: 1px solid #d9e8e4; background: #fff; border-radius: 999px; padding: 10px 14px; font-weight: 800; white-space: nowrap; cursor: pointer; }
    .source-strip button.active { background: #e6fbf4; color: #05775b; border-color: #79d8c0; }
    .source-strip b { margin-left: 6px; color: #122033; }
    .table-panel { padding: 22px; overflow: hidden; }
    .section-title { display: flex; align-items: center; justify-content: space-between; gap: 14px; margin-bottom: 14px; }
    .table-wrap { overflow-x: auto; border: 1px solid #dfeae7; border-radius: 16px; }
    table { width: 100%; border-collapse: collapse; min-width: 1320px; }
    th, td { text-align: left; padding: 14px 16px; border-bottom: 1px solid #e4eeeb; vertical-align: top; }
    th { background: #F4EDF1; color: #48596f; font-size: 12px; text-transform: uppercase; }
    td { color: #132238; }
    .message-cell { min-width: 320px; max-width: 520px; line-height: 1.35; }
    .pill, .badge { display: inline-flex; align-items: center; border-radius: 999px; padding: 7px 11px; font-weight: 800; background: #f2f6f5; border: 1px solid #dce8e4; }
    .badge { color: #4B1238; background: #F0E6EE; border-color: #CEB6C4; text-transform: capitalize; }
    .badge.failed { color: #b42318; background: #fff1f0; border-color: #ffd5d0; }
    .badge.ok { color: #7A4A28; }
    .badge.neutral { color: #334155; background: #f5f7f9; border-color: #dce4ea; }
    .empty-state { display: grid; place-items: center; min-height: 260px; gap: 8px; text-align: center; color: #65736f; }
    .empty-state strong { color: #122033; font-size: 20px; }
    @media (max-width: 1100px) {
      .page-hero { align-items: flex-start; flex-direction: column; }
      .filter-panel, .kpi-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    }
    @media (max-width: 700px) {
      .message-history-page { padding: 12px; }
      .filter-panel, .kpi-grid { grid-template-columns: 1fr; }
    }
  `]
})
export class MessageHistoryReportComponent implements OnInit {
  loading = false;
  rows: ApiRecord[] = [];
  sources: Array<{ key: string; label: string }> = [];
  summary: ApiRecord = {};
  filters: ApiRecord = {
    from: this.defaultFrom(),
    to: this.today(),
    channel: 'all',
    status: 'all',
    source: 'all',
    direction: 'outbound',
    template: '',
    q: '',
    limit: 1000
  };

  constructor(
    private readonly api: ApiService,
    private readonly state: AppStateService,
    private readonly session: AuthSessionService
  ) {}

  canAccessPath(path: string): boolean {
    const permission = routePermissionForPath(path);
    if (!permission || (Array.isArray(permission) && !permission.length)) return true;
    const permissions = Array.isArray(permission) ? permission : [permission];
    const dynamicGrants = this.session.currentUser()?.permissions || [];
    const grants = Array.from(new Set([...staticGrantsForRole(this.state.userRole()), ...dynamicGrants]));
    return permissions.some((item) => grantsAllow(grants, item));
  }

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.loading = true;
    this.api.report<MessageHistoryResponse>('message-history', this.filters).subscribe({
      next: (response) => {
        this.summary = response.summary || {};
        this.rows = response.rows || [];
        this.sources = response.sources || [];
        this.loading = false;
      },
      error: () => {
        this.summary = {};
        this.rows = [];
        this.loading = false;
      }
    });
  }

  metric(key: string): number {
    return Number(this.summary?.[key] || 0);
  }

  sourceCount(key: string): number {
    return Number((this.summary?.['bySource'] || {})[key] || 0);
  }

  setSource(source: string): void {
    this.filters.source = source;
    this.load();
  }

  exportCsv(): void {
    const headers = ['Date', 'Time', 'Template', 'Source', 'Message', 'Contact', 'Client', 'Channel', 'Status', 'Delivery', 'Provider', 'Reference'];
    const lines = [headers.join(',')];
    for (const row of this.rows) {
      lines.push([
        row['date'],
        row['time'],
        row['template'],
        row['source'],
        row['message'],
        row['contact'],
        row['clientName'] || row['clientId'],
        row['channel'],
        row['status'],
        row['deliveryStatus'],
        row['provider'] || row['providerMessageId'],
        row['referenceLabel'] || row['referenceId']
      ].map((value) => `"${String(value || '').replace(/"/g, '""')}"`).join(','));
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `message-history-${this.today()}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  private today(): string {
    return new Date().toISOString().slice(0, 10);
  }

  private defaultFrom(): string {
    const date = new Date();
    date.setDate(date.getDate() - 7);
    return date.toISOString().slice(0, 10);
  }
}
