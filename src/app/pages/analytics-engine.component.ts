import { CommonModule, DecimalPipe } from '@angular/common';
import { Component, OnInit, signal } from '@angular/core';
import { FormsModule, ReactiveFormsModule, UntypedFormBuilder } from '@angular/forms';

type AnalyticsViewKey = 'overview' | 'revenue-forecast' | 'heatmap' | 'staff-productivity' | 'churn-risk' | 'lifetime-value' | 'memberships' | 'conversion-funnel' | 'branches' | 'ai-insights' | 'history';
import { ApiRecord, ApiService } from '../core/api.service';
import { StateComponent } from '../shared/ui/state/state.component';
import { AuraKpiCardComponent } from '../shared/ui/aura-kpi-card/aura-kpi-card.component';
import { AuraMoneyPipe } from '../shared/pipes/aura-money.pipe';
import { AuraDatePipe } from '../shared/pipes/aura-date.pipe';

@Component({
  selector: 'app-analytics-engine',
  standalone: true,
  imports: [AuraDatePipe, AuraMoneyPipe, CommonModule, FormsModule, ReactiveFormsModule, DecimalPipe, StateComponent, AuraKpiCardComponent],
  template: `
    <section class="page-stack">
      <div class="module-hero">
        <div>
          <h2>Forecasting, productivity, retention, churn, heatmaps and branch reports</h2>
        </div>
        <div class="form-actions">
          <button class="ghost-button" type="button" (click)="createSchedule()">Schedule digest</button>
          <button class="ghost-button" type="button" (click)="runAnomalyScan()">Run anomaly scan</button>
          <button class="ghost-button" type="button" (click)="run()">Generate snapshot</button>
        </div>
      </div>

      <app-state [loading]="loading()" [error]="error()"></app-state>

      <section class="panel" *ngIf="commandCenter() as command">
        <div class="section-title">
          <div>
            <h2>Insights, scheduled reports, export controls and anomaly detection</h2>
          </div>
          <span class="badge">{{ command.exportControls.allowed ? 'Export controlled' : 'Export blocked' }}</span>
        </div>
        <div class="quick-grid">
          <article class="action-card">
            <strong>{{ command.anomalyDetection.open }}</strong>
            <span>Open anomalies</span>
            <small>{{ command.anomalyDetection.critical }} critical · {{ command.anomalyDetection.warning }} warning</small>
          </article>
          <article class="action-card">
            <strong>{{ command.scheduledReports.length }}</strong>
            <span>Scheduled reports</span>
            <small>{{ command.exportControls.message }}</small>
          </article>
          <article class="action-card" *ngFor="let insight of command.aiInsights">
            <strong>{{ insight.title }}</strong>
            <span>{{ insight.recommendation }}</span>
            <small>{{ insight.severity }}</small>
          </article>
        </div>
      </section>

      <section class="form-panel">
        <h3>Analysis scope</h3>
        <form [formGroup]="filterForm" (ngSubmit)="run()">
          <label class="field">
            <span>Period start</span>
            <input type="date" formControlName="periodStart" />
          </label>
          <label class="field">
            <span>Period end</span>
            <input type="date" formControlName="periodEnd" />
          </label>
          <label class="field">
            <span>Branch</span>
            <select formControlName="branchId">
              <option value="">All branches</option>
              <option *ngFor="let branch of branches()" [value]="branch.id">{{ branch.name }}</option>
            </select>
          </label>
          <div class="form-actions">
            <button class="primary-button" type="submit" [disabled]="loading()">Run analytics</button>
          </div>
        </form>
      </section>

      <div class="analytics-workspace">
        <aside class="analytics-side-nav" aria-label="Analytics pages">
          <button
            *ngFor="let view of analyticsViews"
            class="analytics-nav-card"
            type="button"
            [class.active]="activeView() === view.key"
            (click)="setAnalyticsView(view.key)"
          >
            <span class="nav-icon">{{ view.icon }}</span>
            <span>
              <strong>{{ view.label }}</strong>
              <small>{{ view.description }}</small>
            </span>
            <i>{{ view.badge }}</i>
          </button>
        </aside>

        <main class="analytics-detail">
      <ng-container *ngIf="metrics() as metrics">
        <div class="metrics-grid" *ngIf="visible('overview')">
          <aura-kpi-card tone="neutral" target="/kpi-details/analytics/14-day-forecast">
            <span>14-day forecast</span>
            <strong>{{ metrics.revenueForecast.projected14DayRevenue | auraMoney:'1.0-0' }}</strong>
            <small>{{ metrics.revenueForecast.trendPercent | number: '1.0-1' }}% recent trend</small>
          </aura-kpi-card>
          <aura-kpi-card tone="neutral" target="/kpi-details/analytics/peak-hour">
            <span>Peak hour</span>
            <strong>{{ metrics.peakHours.topHours?.[0]?.label || 'No data' }}</strong>
            <small>{{ metrics.peakHours.topHours?.[0]?.bookings || 0 }} bookings</small>
          </aura-kpi-card>
          <aura-kpi-card tone="neutral" target="/kpi-details/analytics/repeat-rate">
            <span>Repeat rate</span>
            <strong>{{ metrics.repeatCustomers.repeatRate | number: '1.0-1' }}%</strong>
            <small>{{ metrics.repeatCustomers.repeatClients }} repeat clients</small>
          </aura-kpi-card>
          <aura-kpi-card tone="neutral" target="/kpi-details/analytics/high-churn-risk">
            <span>High churn risk</span>
            <strong>{{ metrics.churn.highRisk }}</strong>
            <small>Avg risk {{ metrics.churn.averageRiskScore | number: '1.0-1' }}</small>
          </aura-kpi-card>
          <aura-kpi-card tone="neutral" target="/kpi-details/analytics/average-ltv">
            <span>Average LTV</span>
            <strong>{{ metrics.lifetimeValue.avgLtv | auraMoney:'1.0-0' }}</strong>
            <small>{{ metrics.lifetimeValue.totalLtv | auraMoney:'1.0-0' }} total</small>
          </aura-kpi-card>
          <aura-kpi-card tone="neutral" target="/kpi-details/analytics/membership-revenue">
            <span>Membership revenue</span>
            <strong>{{ metrics.membershipPerformance.revenue | auraMoney:'1.0-0' }}</strong>
            <small>{{ metrics.membershipPerformance.activeCount }} active</small>
          </aura-kpi-card>
          <aura-kpi-card tone="neutral" target="/kpi-details/analytics/funnel-paid">
            <span>Funnel paid</span>
            <strong>{{ funnelStage('Paid')?.conversionFromLead || 0 }}%</strong>
          </aura-kpi-card>
          <aura-kpi-card tone="neutral" target="/kpi-details/analytics/branches">
            <span>Branches</span>
            <strong>{{ metrics.branchComparison.length }}</strong>
            <small>{{ metrics.branchComparison[0]?.name || 'No branch data' }}</small>
          </aura-kpi-card>
        </div>

        <section class="panel" *ngIf="visible('ai-insights')">
          <div class="section-title">
            <div>
              <h2>Generated snapshot {{ snapshot()?.id }}</h2>
            </div>
          </div>
          <div class="quick-grid">
            <article class="action-card" *ngFor="let insight of insights()">
              <strong>{{ insight }}</strong>
              <span>Persisted analytics insight</span>
            </article>
          </div>
        </section>

        <div class="dashboard-grid" *ngIf="visible('revenue-forecast') || visible('conversion-funnel')">
          <section class="panel" *ngIf="visible('revenue-forecast')">
            <div class="section-title"><h2>Revenue forecast</h2></div>
            <div class="chart-bars">
              <div *ngFor="let point of metrics.revenueForecast.forecast14Days">
                <span>{{ point.date | auraDate:'date' }}</span>
                <i [style.height.%]="forecastHeight(point.projectedRevenue)"></i>
                <strong>{{ point.projectedRevenue | auraMoney:'1.0-0' }}</strong>
              </div>
            </div>
          </section>

          <section class="panel" *ngIf="visible('conversion-funnel')">
            <div class="section-title"><h2>Conversion funnel</h2></div>
            <div class="summary-lines">
              <div *ngFor="let stage of metrics.conversionFunnel.stages">
                <span>{{ stage.stage }}</span>
                <strong>{{ stage.count }} · {{ stage.conversionFromLead | number: '1.0-1' }}%</strong>
              </div>
            </div>
          </section>
        </div>

        <section class="panel" *ngIf="visible('heatmap')">
          <div class="section-title">
            <div>
              <h2>Booking and revenue intensity by day and hour</h2>
            </div>
          </div>
          <div class="heatmap-grid">
            <article *ngFor="let cell of metrics.heatmaps.strongestCells" >
              <strong>{{ cell.dayLabel }} {{ cell.hour }}:00</strong>
              <span>{{ cell.bookings }} bookings · {{ cell.revenue | auraMoney:'1.0-0' }}</span>
            </article>
          </div>
        </section>

        <div class="dashboard-grid" *ngIf="visible('staff-productivity') || visible('churn-risk')">
          <section class="panel" *ngIf="visible('staff-productivity')">
            <div class="section-title"><h2>Staff productivity scoring</h2></div>
            <div class="table-wrap">
              <table>
                <thead><tr><th>Staff</th><th>Score</th><th>Revenue</th><th>Bookings</th><th>Completion</th></tr></thead>
                <tbody>
                  <tr *ngFor="let person of metrics.staffProductivity">
                    <td><strong>{{ person.name }}</strong><small>{{ person.role }}</small></td>
                    <td>{{ person.productivityScore | number: '1.0-1' }}</td>
                    <td>{{ person.revenue | auraMoney:'1.0-0' }}</td>
                    <td>{{ person.bookings }}</td>
                    <td>{{ person.completionRate | number: '1.0-1' }}%</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>

          <section class="panel" *ngIf="visible('churn-risk')">
            <div class="section-title"><h2>Churn analysis</h2></div>
            <div class="rank-list">
              <article *ngFor="let client of metrics.churn.clients">
                <div>
                  <strong>{{ client.name }}</strong>
                  <span>{{ client.risk }} risk · {{ client.inactiveDays }} inactive days</span>
                </div>
                <div class="right">
                  <strong>{{ client.score }}</strong>
                  <small>{{ client.recommendedAction }}</small>
                </div>
              </article>
            </div>
          </section>
        </div>

        <div class="dashboard-grid" *ngIf="visible('lifetime-value') || visible('memberships')">
          <section class="panel" *ngIf="visible('lifetime-value')">
            <div class="section-title"><h2>Lifetime value</h2></div>
            <div class="table-wrap">
              <table>
                <thead><tr><th>Client</th><th>LTV</th><th>Avg ticket</th><th>Projected annual</th><th>Loyalty</th></tr></thead>
                <tbody>
                  <tr *ngFor="let client of metrics.lifetimeValue.topClients">
                    <td>{{ client.name }}</td>
                    <td>{{ client.lifetimeValue | auraMoney:'1.0-0' }}</td>
                    <td>{{ client.avgTicket | auraMoney:'1.0-0' }}</td>
                    <td>{{ client.projectedAnnualValue | auraMoney:'1.0-0' }}</td>
                    <td>{{ client.loyaltyPoints }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>

          <section class="panel" *ngIf="visible('memberships')">
            <div class="section-title"><h2>Membership performance</h2></div>
            <div class="summary-lines">
              <div><span>Credits sold</span><strong>{{ metrics.membershipPerformance.creditsSold }}</strong></div>
              <div><span>Credits redeemed</span><strong>{{ metrics.membershipPerformance.creditsRedeemed }}</strong></div>
              <div><span>Redemption rate</span><strong>{{ metrics.membershipPerformance.redemptionRate | number: '1.0-1' }}%</strong></div>
              <div><span>Auto renewals</span><strong>{{ metrics.membershipPerformance.autoRenewCount }}</strong></div>
            </div>
          </section>
        </div>

        <section class="panel" *ngIf="visible('branches')">
          <div class="section-title"><h2>Branch comparison</h2></div>
          <div class="table-wrap">
            <table>
              <thead><tr><th>Branch</th><th>Revenue</th><th>Sales</th><th>Bookings</th><th>Completion</th><th>Repeat</th><th>Low stock</th></tr></thead>
              <tbody>
                <tr *ngFor="let branch of metrics.branchComparison">
                  <td><strong>{{ branch.name }}</strong><small>{{ branch.city }}</small></td>
                  <td>{{ branch.revenue | auraMoney:'1.0-0' }}</td>
                  <td>{{ branch.sales }}</td>
                  <td>{{ branch.appointments }}</td>
                  <td>{{ branch.completionRate | number: '1.0-1' }}%</td>
                  <td>{{ branch.repeatRate | number: '1.0-1' }}%</td>
                  <td>{{ branch.lowStock }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
      </ng-container>

      <section class="panel" *ngIf="visible('history')">
        <div class="section-title">
          <div>
            <h2>Analytics run history</h2>
          </div>
        </div>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Snapshot</th><th>Period</th><th>Branch</th><th>Status</th><th>Created</th></tr></thead>
            <tbody>
              <tr *ngFor="let item of snapshots()">
                <td>{{ item.id }}</td>
                <td>{{ item.periodStart }} to {{ item.periodEnd }}</td>
                <td>{{ item.branchId || 'All branches' }}</td>
                <td><span class="badge">{{ item.status }}</span></td>
                <td>{{ item.createdAt | auraDate:'date' }}</td>
              </tr>
              <tr *ngIf="!snapshots().length"><td colspan="5">No analytics snapshots yet.</td></tr>
            </tbody>
          </table>
        </div>
      </section>
        </main>
      </div>
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

    .form-actions {
      display: flex;
      align-items: center;
      justify-content: flex-end;
      gap: 8px;
      flex-wrap: wrap;
    }

    .form-actions .ghost-button,
    .form-actions .primary-button {
      min-height: 34px;
      border-radius: 6px;
      padding: 0 12px;
      box-shadow: none;
    }

    .panel,
    .form-panel {
      padding: 14px;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: var(--surface);
      box-shadow: 0 4px 12px rgba(12, 26, 43, 0.06);
    }

    .section-title {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 12px;
      margin-bottom: 10px;
    }

    .section-title h2,
    .form-panel h3 {
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
      border: 1px solid var(--success-border, #DCC4D4);
      border-radius: 999px;
      color: var(--success-text, #7A4A28);
      background: var(--success-bg, #F3EAF0);
      font-size: 0.75rem;
      font-weight: 900;
    }

    .quick-grid,
    .metrics-grid,
    .dashboard-grid,
    .analytics-workspace {
      display: grid;
      gap: 10px;
    }

    .analytics-workspace {
      grid-template-columns: 315px minmax(0, 1fr);
      align-items: start;
    }

    .analytics-side-nav,
    .analytics-detail {
      display: grid;
      gap: 10px;
    }

    .analytics-side-nav {
      position: sticky;
      top: 82px;
      align-self: start;
    }

    .analytics-nav-card {
      display: grid;
      grid-template-columns: 48px minmax(0, 1fr) auto;
      align-items: center;
      gap: 10px;
      width: 100%;
      min-height: 88px;
      padding: 14px;
      border: 1px solid var(--line);
      border-left: 3px solid #4B1238;
      border-radius: 8px;
      color: var(--ink);
      background: var(--surface);
      box-shadow: 0 4px 12px rgba(12, 26, 43, 0.06);
      cursor: pointer;
      text-align: left;
    }

    .analytics-nav-card.active {
      border-color: var(--color-primary);
      background: var(--surface);
      box-shadow: 0 8px 22px rgba(12, 26, 43, 0.12);
    }

    .analytics-nav-card strong,
    .analytics-nav-card small,
    .analytics-nav-card i {
      display: block;
    }

    .analytics-nav-card strong {
      font-size: 0.98rem;
      line-height: 1.2;
    }

    .analytics-nav-card small {
      margin-top: 4px;
      color: var(--muted);
      font-size: 0.74rem;
      font-weight: 800;
    }

    .analytics-nav-card i {
      padding: 3px 8px;
      border-radius: 999px;
      color: var(--color-primary-strong);
      background: var(--surface-2);
      font-size: 0.7rem;
      font-style: normal;
      font-weight: 900;
      text-transform: uppercase;
    }

    .nav-icon {
      display: inline-grid;
      place-items: center;
      width: 48px;
      height: 48px;
      border-radius: 8px;
      color: var(--color-primary-strong);
      background: var(--surface-2);
      font-weight: 900;
    }

    .quick-grid {
      grid-template-columns: repeat(auto-fit, minmax(210px, 1fr));
    }

    .metrics-grid {
      grid-template-columns: repeat(4, minmax(0, 1fr));
    }

    .dashboard-grid {
      grid-template-columns: repeat(2, minmax(0, 1fr));
      align-items: start;
    }

    aura-kpi-card {
      min-width: 0;
    }

    :host ::ng-deep .metrics-grid aura-kpi-card .metric-card {
      background: var(--surface) !important;
      background-image: none !important;
      border-color: var(--line) !important;
      border-left: 3px solid #4B1238 !important;
      box-shadow: 0 4px 12px rgba(12, 26, 43, 0.06) !important;
    }

    .action-card,
    .summary-lines div,
    .rank-list article,
    .heatmap-grid article {
      border: 1px solid var(--line);
      border-radius: 8px;
      background: var(--surface);
      box-shadow: none;
    }

    .action-card {
      display: grid;
      gap: 6px;
      min-height: 94px;
      padding: 12px;
      border-top: 3px solid var(--color-primary);
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

    .form-panel form {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 10px;
      align-items: end;
    }

    .field {
      display: grid;
      gap: 5px;
    }

    .field span {
      color: var(--muted);
      font-size: 0.74rem;
      font-weight: 800;
      text-transform: uppercase;
    }

    input,
    select {
      min-height: 34px;
      border: 1px solid var(--line);
      border-radius: 6px;
      color: var(--ink);
      background: var(--surface);
      padding: 0 10px;
    }

    .chart-bars {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(52px, 1fr));
      gap: 8px;
      align-items: end;
      min-height: 220px;
      padding: 10px;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: var(--surface-2);
    }

    .chart-bars div {
      min-width: 0;
      display: grid;
      grid-template-rows: auto 1fr auto;
      gap: 6px;
      align-items: end;
      height: 190px;
      color: var(--muted);
      font-size: 0.72rem;
      text-align: center;
    }

    .chart-bars i {
      width: 100%;
      min-height: 8px;
      border-radius: 6px 6px 0 0;
      background: #4B1238;
    }

    .chart-bars strong {
      color: var(--ink);
      font-size: 0.74rem;
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
    }

    .summary-lines span,
    .rank-list span,
    .rank-list small {
      color: var(--muted);
    }

    .summary-lines strong,
    .rank-list strong {
      color: var(--ink);
    }

    .heatmap-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));
      gap: 10px;
    }

    .heatmap-grid article {
      min-height: 76px;
      padding: 12px;
      color: var(--ink);
    }

    .heatmap-grid strong,
    .heatmap-grid span {
      display: block;
    }

    .heatmap-grid span {
      margin-top: 5px;
      color: var(--muted);
      font-weight: 800;
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

    td strong,
    td small {
      display: block;
    }

    td small {
      color: var(--muted);
    }

    .rank-list {
      display: grid;
      gap: 8px;
    }

    .rank-list article {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 12px;
      padding: 12px;
    }

    .rank-list .right {
      text-align: right;
    }

    @media (max-width: 1180px) {
      .metrics-grid,
      .dashboard-grid,
      .form-panel form {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }

      .analytics-workspace {
        grid-template-columns: 1fr;
      }

      .analytics-side-nav {
        position: static;
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }
    }

    @media (max-width: 760px) {
      .module-hero,
      .section-title,
      .rank-list article {
        align-items: flex-start;
        flex-direction: column;
      }

      .metrics-grid,
      .dashboard-grid,
      .form-panel form,
      .analytics-side-nav {
        grid-template-columns: 1fr;
      }

      .form-actions {
        justify-content: flex-start;
      }
    }
  `]
})
export class AnalyticsEngineComponent implements OnInit {
  readonly snapshot = signal<ApiRecord | null>(null);
  readonly metrics = signal<ApiRecord | null>(null);
  readonly insights = signal<string[]>([]);
  readonly snapshots = signal<ApiRecord[]>([]);
  readonly commandCenter = signal<ApiRecord | null>(null);
  readonly branches = signal<ApiRecord[]>([]);
  readonly loading = signal(true);
  readonly error = signal('');
  readonly activeView = signal<AnalyticsViewKey>('overview');

  readonly analyticsViews: Array<{ key: AnalyticsViewKey; label: string; description: string; icon: string; badge: string }> = [
    { key: 'overview', label: 'Overview', description: 'All analytics KPIs and highlights', icon: 'OV', badge: 'Open' },
    { key: 'revenue-forecast', label: 'Revenue forecast', description: '14-day projection and trends', icon: 'RF', badge: 'AI' },
    { key: 'heatmap', label: 'Peak hours', description: 'Day and hour intensity map', icon: 'PH', badge: 'Live' },
    { key: 'staff-productivity', label: 'Staff productivity', description: 'Revenue, booking and completion scores', icon: 'SP', badge: 'Team' },
    { key: 'churn-risk', label: 'Churn risk', description: 'High-risk clients and next action', icon: 'CR', badge: 'AI' },
    { key: 'lifetime-value', label: 'Lifetime value', description: 'Top clients and projected value', icon: 'LV', badge: 'CRM' },
    { key: 'memberships', label: 'Memberships', description: 'Credits, renewals and redemption', icon: 'MB', badge: 'Plan' },
    { key: 'conversion-funnel', label: 'Conversion funnel', description: 'Lead to paid conversion stages', icon: 'CF', badge: 'Sales' },
    { key: 'branches', label: 'Branch comparison', description: 'Multi-branch revenue and operations', icon: 'BR', badge: 'Ops' },
    { key: 'ai-insights', label: 'AI insights', description: 'Snapshot recommendations and actions', icon: 'AI', badge: 'Smart' },
    { key: 'history', label: 'Run history', description: 'Generated analytics snapshots', icon: 'HI', badge: 'Audit' }
  ];

  readonly filterForm = this.fb.group({
    periodStart: [this.defaultStart()],
    periodEnd: [new Date().toISOString().slice(0, 10)],
    branchId: ['']
  });

  constructor(private readonly api: ApiService, private readonly fb: UntypedFormBuilder) {}

  ngOnInit(): void {
    this.filterForm.patchValue({ branchId: this.api.selectedBranchId() });
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.error.set('');
    Promise.all([
      this.api.list<ApiRecord[]>('branches').toPromise(),
      this.api.list<ApiRecord[]>('analytics/snapshots').toPromise()
    ])
      .then(([branches, snapshots]) => {
        this.branches.set(branches || []);
        this.snapshots.set(snapshots || []);
        this.loadCommandCenter();
        this.run();
      })
      .catch((error) => {
        this.error.set(error?.error?.error || 'Unable to load analytics engine');
        this.loading.set(false);
      });
  }

  run(): void {
    this.loading.set(true);
    this.error.set('');
    this.api.post<ApiRecord>('analytics/run', this.filterForm.value).subscribe({
      next: (result) => {
        this.snapshot.set(result.snapshot);
        this.metrics.set(result.metrics);
        this.insights.set(result.insights || []);
        this.loadSnapshots();
        this.loadCommandCenter();
        this.loading.set(false);
      },
      error: (error) => {
        this.error.set(error?.error?.error || 'Unable to generate analytics');
        this.loading.set(false);
      }
    });
  }

  loadSnapshots(): void {
    this.api.list<ApiRecord[]>('analytics/snapshots').subscribe({
      next: (snapshots) => this.snapshots.set(snapshots),
      error: () => this.snapshots.set([])
    });
  }

  loadCommandCenter(): void {
    this.api.list<ApiRecord>('analytics/report-command-center', this.filterForm.value).subscribe({
      next: (result) => this.commandCenter.set(result),
      error: () => this.commandCenter.set(null)
    });
  }

  createSchedule(): void {
    this.api.post<ApiRecord>('analytics/report-schedules', {
      ...this.filterForm.value,
      name: 'Analytics owner digest',
      cadence: 'weekly',
      reportKeys: ['analytics:14-day-forecast', 'analytics:high-churn-risk', 'analytics:anomalies']
    }).subscribe({
      next: () => this.loadCommandCenter(),
      error: (error) => this.error.set(this.api.errorText(error))
    });
  }

  runAnomalyScan(): void {
    this.api.post<ApiRecord>('analytics/anomalies/run', this.filterForm.value).subscribe({
      next: () => this.loadCommandCenter(),
      error: (error) => this.error.set(this.api.errorText(error))
    });
  }

  setAnalyticsView(view: AnalyticsViewKey): void {
    this.activeView.set(view);
  }

  visible(view: AnalyticsViewKey): boolean {
    const active = this.activeView();
    return active === 'overview' || active === view;
  }

  funnelStage(stage: string): ApiRecord | null {
    return this.metrics()?.conversionFunnel?.stages?.find((item: ApiRecord) => item.stage === stage) || null;
  }

  forecastHeight(value: number): number {
    const points = this.metrics()?.revenueForecast?.forecast14Days || [];
    const max = Math.max(1, ...points.map((item: ApiRecord) => Number(item.projectedRevenue || 0)));
    return Math.max(8, Math.round((Number(value || 0) / max) * 100));
  }


  private defaultStart(): string {
    const date = new Date();
    date.setDate(date.getDate() - 89);
    return date.toISOString().slice(0, 10);
  }
}
