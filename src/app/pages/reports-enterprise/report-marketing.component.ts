import { CommonModule } from '@angular/common';
import { Component, Input, OnInit, OnDestroy, computed, signal } from '@angular/core';
import { BaseChartComponent } from './base-chart.component';
import { ReportsEnterpriseService, FilterState } from './reports-enterprise.service';
import { Subscription } from 'rxjs';
import { AuraMoneyPipe } from '../../shared/pipes/aura-money.pipe';

@Component({
  selector: 'app-report-marketing',
  standalone: true,
  imports: [AuraMoneyPipe, CommonModule, BaseChartComponent],
  template: `
    <ng-container *ngIf="!loading(); else skeleton">
      <div class="mkt-metrics inner-stats-grid">
        <div class="metric-card teal"><span>Campaign Revenue</span><strong>{{ d()?.totalRevenue | auraMoney:'1.0-0' }}</strong></div>
        <div class="metric-card green"><span>Avg Conversion Rate</span><strong>{{ d()?.avgConversion }}%</strong></div>
        <div class="metric-card violet"><span>Campaign ROI</span><strong>{{ d()?.campaignRoi }}%</strong></div>
      </div>

      <div class="mkt-charts">
        <section class="panel report-section inner-page-card">
          <div class="section-title inner-action-bar"><h3>Top Performing Campaigns</h3></div>
          <div class="chart-container">
            <base-chart type="horizontalBar" [labels]="campLabels()" [datasets]="campRevenueDataset()"></base-chart>
          </div>
        </section>

        <section class="panel report-section inner-page-card">
          <div class="section-title inner-action-bar"><h3>Campaign ROI Comparison</h3></div>
          <div class="chart-container">
            <base-chart type="bar" [labels]="campLabels()" [datasets]="campRoiDataset()"></base-chart>
          </div>
        </section>
      </div>

      <section class="panel report-section inner-page-card">
        <div class="section-title inner-action-bar">
          <h3>Campaign Performance Table</h3>
          <button class="ghost-button mini" (click)="exportTable()">Export CSV</button>
        </div>
        <div class="table-wrap inner-table-wrap">
          <table>
            <thead><tr><th>Campaign</th><th>Channel</th><th>Sent</th><th>Conversions</th><th>Revenue</th><th>ROI</th></tr></thead>
            <tbody>
              <tr *ngFor="let c of campaigns()">
                <td><strong>{{ c.name }}</strong></td>
                <td><span class="badge">{{ c.channel }}</span></td>
                <td>{{ c.sent }}</td>
                <td>{{ c.conversions }}</td>
                <td>{{ c.revenue | auraMoney:'1.0-0' }}</td>
                <td><span class="roi-badge">{{ c.roi }}%</span></td>
              </tr>
              <tr *ngIf="campaigns().length===0"><td colspan="6" class="empty-cell">No campaign data found.</td></tr>
            </tbody>
          </table>
        </div>
      </section>
    </ng-container>

    <div *ngIf="!loading() && !d()" class="empty-state">
      <span class="empty-icon">📢</span><strong>No marketing data</strong>
    </div>

    <ng-template #skeleton>
      <div class="mkt-metrics"><div class="skeleton-card" *ngFor="let _ of [1,2,3]"><div class="skeleton-line w-60"></div><div class="skeleton-line w-80 h-8"></div></div></div>
    </ng-template>
  `,
  styles: [`
    .mkt-metrics { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin-bottom: 16px; }
    .mkt-metrics .metric-card { min-height: 80px; display: grid; gap: 4px; padding: 14px; }
    .mkt-metrics .metric-card span { font-size: 11px; color: var(--muted); font-weight: 800; text-transform: uppercase; }
    .mkt-metrics .metric-card strong { font-size: 18px; }
    .mkt-charts { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 16px; }
    .chart-container { height: 240px; }
    .roi-badge { padding: 2px 8px; border-radius: 4px; background: #FBF0E8; color: var(--green); font-weight: 700; font-size: 12px; }
    .skeleton-card { border: 1px solid var(--line); border-radius: 8px; padding: 16px; background: var(--surface); display: grid; gap: 10px; }
    .skeleton-line { height: 12px; border-radius: 6px; background: linear-gradient(90deg, var(--surface-2) 25%, var(--line) 50%, var(--surface-2) 75%); background-size: 200% 100%; animation: shimmer 1.5s infinite; }
    .skeleton-line.w-60 { width: 60%; } .skeleton-line.w-80 { width: 80%; } .skeleton-line.h-8 { height: 20px; }
    @keyframes shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }
    .empty-state { text-align: center; padding: 24px 16px; }
    .empty-icon { font-size: 40px; display: block; margin-bottom: 8px; }
    .empty-state strong { display: block; font-size: 16px; }
    .empty-state small { color: var(--muted); }
    .empty-cell { text-align: center; padding: 24px; color: var(--muted); }
    @media (max-width: 760px) { .mkt-metrics, .mkt-charts { grid-template-columns: 1fr; } }
  `]
})
export class ReportMarketingComponent implements OnInit, OnDestroy {
  @Input() filters!: FilterState;
  readonly loading = signal(true);
  readonly d = signal<any>(null);
  readonly campaigns = computed(() => this.d()?.campaigns || []);
  readonly campLabels = computed(() => this.campaigns().map((c: any) => c.name));
  readonly campRevenueDataset = computed(() => [{ label: 'Revenue', data: this.campaigns().map((c: any) => c.revenue), backgroundColor: '#4B1238' }]);
  readonly campRoiDataset = computed(() => [{ label: 'ROI %', data: this.campaigns().map((c: any) => c.roi), backgroundColor: '#C87D4B' }]);
  private subs: Subscription[] = [];

  constructor(private service: ReportsEnterpriseService) {}

  ngOnInit(): void {
    this.subs.push(this.service.getMarketingRoi().subscribe(d => { this.d.set(d); this.loading.set(false); }));
  }
  ngOnDestroy(): void { this.subs.forEach(s => s.unsubscribe()); }

  exportTable(): void {
    const rows = this.campaigns().map((c: any) => `${c.name},${c.channel},${c.sent},${c.conversions},${c.revenue},${c.roi}%`).join('\n');
    const blob = new Blob(['Campaign,Channel,Sent,Conversions,Revenue,ROI\n' + rows], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = 'marketing-roi.csv'; a.click();
    URL.revokeObjectURL(url);
  }
}
