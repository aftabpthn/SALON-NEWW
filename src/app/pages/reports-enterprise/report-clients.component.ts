import { CommonModule } from '@angular/common';
import { Component, Input, OnInit, OnDestroy, computed, signal } from '@angular/core';
import { BaseChartComponent } from './base-chart.component';
import { ReportsEnterpriseService, FilterState } from './reports-enterprise.service';
import { Subscription } from 'rxjs';
import { AuraMoneyPipe } from '../../shared/pipes/aura-money.pipe';

@Component({
  selector: 'app-report-clients',
  standalone: true,
  imports: [AuraMoneyPipe, CommonModule, BaseChartComponent],
  template: `
    <ng-container *ngIf="!loading(); else skeleton">
      <div class="client-metrics inner-stats-grid">
        <div class="metric-card green"><span>New Clients</span><strong>{{ d()?.newClients }}</strong></div>
        <div class="metric-card blue"><span>Returning Clients</span><strong>{{ d()?.returningClients }}</strong></div>
        <div class="metric-card violet"><span>Retention Rate</span><strong>{{ d()?.retentionRate }}%</strong></div>
        <div class="metric-card teal"><span>Client Lifetime Value</span><strong>{{ d()?.lifetimeValue }}</strong></div>
        <div class="metric-card amber"><span>Rebooking Rate</span><strong>{{ d()?.rebookingRate }}%</strong></div>
        <div class="metric-card red"><span>At-Risk Clients</span><strong>{{ d()?.atRisk }}</strong></div>
      </div>

      <div class="client-charts">
        <section class="panel report-section inner-page-card">
          <div class="section-title inner-action-bar"><h3>Client Segments</h3></div>
          <div class="chart-container">
            <base-chart type="doughnut" [labels]="segLabels()" [datasets]="segDataset()"></base-chart>
          </div>
        </section>

        <section class="panel report-section inner-page-card">
          <div class="section-title inner-action-bar"><h3>Top Spending Clients</h3></div>
          <div class="rank-list">
            <article *ngFor="let c of topSpenders(); let i=index">
              <div><small>#{{ i+1 }}</small><strong>{{ c.name }}</strong><span>{{ c.visits }} visits</span></div>
              <strong>{{ c.spent | auraMoney:'1.0-0' }}</strong>
            </article>
          </div>
        </section>
      </div>

      <section class="panel report-section inner-page-card">
        <div class="section-title inner-action-bar">
          <h3>At-Risk Clients (No visit in 60/90 days)</h3>
          <button class="ghost-button mini" (click)="exportReport()">Export</button>
        </div>
        <div class="alert-card">
          <span>⚠️</span>
          <div><strong>{{ d()?.atRisk }} clients may churn</strong></div>
        </div>
      </section>
    </ng-container>

    <div *ngIf="!loading() && !d()" class="empty-state">
      <span class="empty-icon">👤</span><strong>No client data</strong>
    </div>

    <ng-template #skeleton>
      <div class="client-metrics"><div class="skeleton-card" *ngFor="let _ of [1,2,3,4,5,6]"><div class="skeleton-line w-60"></div><div class="skeleton-line w-80 h-8"></div></div></div>
    </ng-template>
  `,
  styles: [`
    .client-metrics { display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: 10px; margin-bottom: 16px; }
    .client-metrics .metric-card { min-height: 80px; display: grid; gap: 4px; padding: 14px; }
    .client-metrics .metric-card span { font-size: 11px; color: var(--muted); font-weight: 800; text-transform: uppercase; }
    .client-metrics .metric-card strong { font-size: 18px; }
    .client-charts { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 16px; }
    .chart-container { height: 240px; }
    .rank-list { display: grid; gap: 8px; }
    .rank-list article { display: flex; justify-content: space-between; align-items: center; padding: 10px 12px; border: 1px solid var(--line); border-radius: 8px; }
    .rank-list article div { display: grid; gap: 2px; }
    .rank-list article small { color: var(--muted); font-size: 11px; font-weight: 800; }
    .rank-list article strong { font-size: 14px; }
    .rank-list article span { font-size: 12px; color: var(--muted); }
    .alert-card { display: flex; gap: 12px; align-items: flex-start; padding: 16px; border: 1px solid #f59e0b; border-radius: 8px; background: #fffbeb; }
    .alert-card span { font-size: 24px; }
    .alert-card div { display: grid; gap: 4px; }
    .alert-card strong { font-size: 14px; }
    .alert-card small { color: var(--muted); font-size: 12px; }
    .skeleton-card { border: 1px solid var(--line); border-radius: 8px; padding: 16px; background: var(--surface); display: grid; gap: 10px; }
    .skeleton-line { height: 12px; border-radius: 6px; background: linear-gradient(90deg, var(--surface-2) 25%, var(--line) 50%, var(--surface-2) 75%); background-size: 200% 100%; animation: shimmer 1.5s infinite; }
    .skeleton-line.w-60 { width: 60%; } .skeleton-line.w-80 { width: 80%; } .skeleton-line.h-8 { height: 20px; }
    @keyframes shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }
    .empty-state { text-align: center; padding: 24px 16px; }
    .empty-icon { font-size: 40px; display: block; margin-bottom: 8px; }
    .empty-state strong { display: block; font-size: 16px; }
    .empty-state small { color: var(--muted); }
    @media (max-width: 760px) { .client-charts { grid-template-columns: 1fr; } }
  `]
})
export class ReportClientsComponent implements OnInit, OnDestroy {
  @Input() filters!: FilterState;
  readonly loading = signal(true);
  readonly d = signal<any>(null);
  readonly segLabels = computed(() => (this.d()?.segments || []).map((s: any) => s.label));
  readonly segDataset = computed(() => {
    const segs = this.d()?.segments || [];
    return [{ label: 'Clients', data: segs.map((s: any) => s.value), backgroundColor: segs.map((s: any) => s.color) }];
  });
  readonly topSpenders = computed(() => this.d()?.topSpenders || []);
  private subs: Subscription[] = [];

  constructor(private service: ReportsEnterpriseService) {}

  ngOnInit(): void {
    this.subs.push(this.service.getClientInsights().subscribe(d => { this.d.set(d); this.loading.set(false); }));
  }
  ngOnDestroy(): void { this.subs.forEach(s => s.unsubscribe()); }

  exportReport(): void {
    const blob = new Blob(['Client Insights Report'], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = 'client-insights.csv'; a.click();
    URL.revokeObjectURL(url);
  }
}
