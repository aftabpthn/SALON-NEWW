import { CommonModule } from '@angular/common';
import { Component, Input, OnInit, OnDestroy, computed, signal } from '@angular/core';
import { BaseChartComponent } from './base-chart.component';
import { ReportsEnterpriseService, FilterState } from './reports-enterprise.service';
import { Subscription } from 'rxjs';
import { AuraMoneyPipe } from '../../shared/pipes/aura-money.pipe';

@Component({
  selector: 'app-report-services',
  standalone: true,
  imports: [AuraMoneyPipe, CommonModule, BaseChartComponent],
  template: `
    <ng-container *ngIf="!loading(); else skeleton">
      <div class="service-metrics inner-stats-grid">
        <section class="panel report-section inner-page-card">
          <div class="section-title inner-action-bar"><h3>Most Popular Services</h3></div>
          <div class="chart-container">
            <base-chart type="horizontalBar" [labels]="popularLabels()" [datasets]="popularDataset()"></base-chart>
          </div>
        </section>

        <section class="panel report-section inner-page-card">
          <div class="section-title inner-action-bar"><h3>Highest Revenue Services</h3></div>
          <div class="chart-container">
            <base-chart type="horizontalBar" [labels]="topRevenueLabels()" [datasets]="topRevenueDataset()"></base-chart>
          </div>
        </section>
      </div>

      <div class="service-bottom">
        <section class="panel report-section inner-page-card">
          <div class="section-title inner-action-bar"><h3>Category Breakdown</h3></div>
          <div class="chart-container">
            <base-chart type="doughnut" [labels]="catLabels()" [datasets]="catDataset()"></base-chart>
          </div>
        </section>

        <section class="panel report-section full-width inner-page-card">
          <div class="section-title inner-action-bar">
            <h3>Service Performance Table</h3>
            <button class="ghost-button mini" (click)="exportTable()">Export CSV</button>
          </div>
          <div class="table-wrap inner-table-wrap">
            <table>
              <thead><tr><th>Service</th><th>Bookings</th><th>Revenue</th><th>Avg Price</th><th>Growth %</th><th>Trend</th></tr></thead>
              <tbody>
                <tr *ngFor="let s of services()">
                  <td><strong>{{ s.name }}</strong></td>
                  <td>{{ s.bookings }}</td>
                  <td>{{ s.revenue | auraMoney:'1.0-0' }}</td>
                  <td>{{ s.avgPrice | auraMoney:'1.0-0' }}</td>
                  <td>{{ s.growth }}%</td>
                  <td><span class="trend-indicator" [class.trend-up]="s.growth>0" [class.trend-down]="s.growth<0">{{ s.growth>0 ? '↑' : '↓' }}</span></td>
                </tr>
                <tr *ngIf="services().length===0"><td colspan="6" class="empty-cell">No service data found.</td></tr>
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </ng-container>

    <div *ngIf="!loading() && !d()" class="empty-state">
      <span class="empty-icon">💇</span><strong>No service data</strong>
    </div>

    <ng-template #skeleton>
      <div class="service-metrics"><div class="skeleton-card" *ngFor="let _ of [1,2]"><div class="skeleton-line w-40"></div><div class="skeleton-line" style="height:200px;margin-top:12px"></div></div></div>
    </ng-template>
  `,
  styles: [`
    .service-metrics { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 16px; }
    .service-bottom { display: grid; grid-template-columns: 0.5fr 1fr; gap: 16px; }
    .full-width { grid-column: 1 / -1; }
    .chart-container { height: 220px; }
    .trend-indicator { display: inline-flex; align-items: center; justify-content: center; width: 24px; height: 24px; border-radius: 50%; font-weight: 900; font-size: 14px; }
    .trend-indicator.trend-up { background: #FBF0E8; color: var(--green); }
    .trend-indicator.trend-down { background: #fee2e2; color: var(--red); }
    .skeleton-card { border: 1px solid var(--line); border-radius: 8px; padding: 16px; background: var(--surface); }
    .skeleton-line { border-radius: 6px; background: linear-gradient(90deg, var(--surface-2) 25%, var(--line) 50%, var(--surface-2) 75%); background-size: 200% 100%; animation: shimmer 1.5s infinite; }
    .skeleton-line.w-40 { width: 40%; }
    @keyframes shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }
    .empty-state { text-align: center; padding: 24px 16px; }
    .empty-icon { font-size: 40px; display: block; margin-bottom: 8px; }
    .empty-state strong { display: block; font-size: 16px; }
    .empty-state small { color: var(--muted); }
    .empty-cell { text-align: center; padding: 24px; color: var(--muted); }
    @media (max-width: 760px) { .service-metrics, .service-bottom { grid-template-columns: 1fr; } }
  `]
})
export class ReportServicesComponent implements OnInit, OnDestroy {
  @Input() filters!: FilterState;
  readonly loading = signal(true);
  readonly d = signal<any>(null);
  readonly services = computed(() => this.d()?.services || []);
  readonly popularLabels = computed(() => this.services().slice(0, 5).map((s: any) => s.name));
  readonly popularDataset = computed(() => [{ label: 'Bookings', data: this.services().slice(0, 5).map((s: any) => s.bookings), backgroundColor: '#C87D4B' }]);
  readonly topRevenueLabels = computed(() => [...this.services()].sort((a: any, b: any) => b.revenue - a.revenue).slice(0, 5).map((s: any) => s.name));
  readonly topRevenueDataset = computed(() => [{ label: 'Revenue', data: [...this.services()].sort((a: any, b: any) => b.revenue - a.revenue).slice(0, 5).map((s: any) => s.revenue), backgroundColor: '#4B1238' }]);
  readonly catLabels = computed(() => (this.d()?.categoryBreakdown || []).map((c: any) => c.category));
  readonly catDataset = computed(() => [{ label: 'Revenue', data: (this.d()?.categoryBreakdown || []).map((c: any) => c.revenue), backgroundColor: ['#4B1238','#6B1E4B','#C87D4B','#f59e0b','#6d4cc2'] }]);
  private subs: Subscription[] = [];

  constructor(private service: ReportsEnterpriseService) {}

  ngOnInit(): void {
    this.subs.push(this.service.getServicePerformance().subscribe(d => { this.d.set(d); this.loading.set(false); }));
  }
  ngOnDestroy(): void { this.subs.forEach(s => s.unsubscribe()); }

  exportTable(): void {
    const rows = this.services().map((s: any) => `${s.name},${s.bookings},${s.revenue},${s.avgPrice},${s.growth}%`).join('\n');
    const blob = new Blob(['Service,Bookings,Revenue,Avg Price,Growth\n' + rows], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = 'service-performance.csv'; a.click();
    URL.revokeObjectURL(url);
  }
}
