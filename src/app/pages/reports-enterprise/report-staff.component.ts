import { CommonModule } from '@angular/common';
import { Component, Input, OnInit, OnDestroy, computed, signal } from '@angular/core';
import { BaseChartComponent } from './base-chart.component';
import { ReportsEnterpriseService, FilterState } from './reports-enterprise.service';
import { Subscription } from 'rxjs';
import { AuraMoneyPipe } from '../../shared/pipes/aura-money.pipe';

@Component({
  selector: 'app-report-staff',
  standalone: true,
  imports: [AuraMoneyPipe, CommonModule, BaseChartComponent],
  template: `
    <ng-container *ngIf="!loading(); else skeleton">
      <section class="panel report-section inner-page-card">
        <div class="section-title inner-action-bar">
          <h3>Staff Leaderboard</h3>
          <button class="ghost-button mini" (click)="exportReport()">Export</button>
        </div>
        <div class="chart-container">
          <base-chart type="horizontalBar" [labels]="leaderLabels()" [datasets]="leaderDataset()"></base-chart>
        </div>
      </section>

      <section class="panel report-section inner-page-card">
        <div class="section-title inner-action-bar">
          <h3>Staff Performance Table</h3>
          <button class="ghost-button mini" (click)="exportTable()">Export CSV</button>
        </div>
        <div class="table-wrap inner-table-wrap">
          <table>
            <thead><tr><th>Staff</th><th>Bookings</th><th>Revenue</th><th>Product Sales</th><th>Commission</th><th>Utilization</th><th>Rating</th><th>No-Show Impact</th></tr></thead>
            <tbody>
              <tr *ngFor="let s of leaderboard()">
                <td><strong>{{ s.name }}</strong></td>
                <td>{{ s.bookings }}</td>
                <td>{{ s.revenue | auraMoney:'1.0-0' }}</td>
                <td>{{ s.productSales | auraMoney:'1.0-0' }}</td>
                <td>{{ s.commission | auraMoney:'1.0-0' }}</td>
                <td><span class="util-bar"><span class="util-fill" [style.width.%]="s.utilization"></span></span> {{ s.utilization }}%</td>
                <td>{{ s.rating }} ⭐</td>
                <td><span class="badge" [class.badge-red]="s.noShowImpact>5">{{ s.noShowImpact }}</span></td>
              </tr>
              <tr *ngIf="leaderboard().length===0"><td colspan="8" class="empty-cell">No staff data found.</td></tr>
            </tbody>
          </table>
        </div>
      </section>
    </ng-container>

    <div *ngIf="!loading() && !d()" class="empty-state">
      <span class="empty-icon">⭐</span><strong>No staff data</strong>
    </div>

    <ng-template #skeleton>
      <div class="skeleton-card"><div class="skeleton-line w-40"></div><div style="height:200px;margin-top:12px" class="skeleton-line"></div></div>
    </ng-template>
  `,
  styles: [`
    .chart-container { height: 250px; margin-bottom: 16px; }
    .util-bar { display: inline-block; width: 60px; height: 6px; border-radius: 3px; background: var(--line); vertical-align: middle; margin-right: 6px; }
    .util-fill { display: block; height: 100%; border-radius: 3px; background: #4B1238; }
    .badge-red { background: #fee2e2; color: var(--red); }
    .skeleton-card { border: 1px solid var(--line); border-radius: 8px; padding: 16px; background: var(--surface); }
    .skeleton-line { border-radius: 6px; background: linear-gradient(90deg, var(--surface-2) 25%, var(--line) 50%, var(--surface-2) 75%); background-size: 200% 100%; animation: shimmer 1.5s infinite; }
    .skeleton-line.w-40 { width: 40%; }
    @keyframes shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }
    .empty-state { text-align: center; padding: 24px 16px; }
    .empty-icon { font-size: 40px; display: block; margin-bottom: 8px; }
    .empty-state strong { display: block; font-size: 16px; }
    .empty-state small { color: var(--muted); }
    .empty-cell { text-align: center; padding: 24px; color: var(--muted); }
  `]
})
export class ReportStaffComponent implements OnInit, OnDestroy {
  @Input() filters!: FilterState;
  readonly loading = signal(true);
  readonly d = signal<any>(null);
  readonly leaderboard = computed(() => this.d()?.leaderboard || []);
  readonly leaderLabels = computed(() => this.leaderboard().map((s: any) => s.name));
  readonly leaderDataset = computed(() => [{ label: 'Revenue', data: this.leaderboard().map((s: any) => s.revenue), backgroundColor: '#4B1238' }]);
  private subs: Subscription[] = [];

  constructor(private service: ReportsEnterpriseService) {}

  ngOnInit(): void {
    this.subs.push(this.service.getStaffPerformance().subscribe(d => { this.d.set(d); this.loading.set(false); }));
  }
  ngOnDestroy(): void { this.subs.forEach(s => s.unsubscribe()); }

  exportReport(): void {
    const blob = new Blob(['Staff Performance Report'], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = 'staff-performance.csv'; a.click();
    URL.revokeObjectURL(url);
  }

  exportTable(): void {
    const rows = this.leaderboard().map((s: any) => `${s.name},${s.bookings},${s.revenue},${s.productSales},${s.commission},${s.utilization}%,${s.rating},${s.noShowImpact}`).join('\n');
    const blob = new Blob(['Staff,Bookings,Revenue,Product Sales,Commission,Utilization,Rating,No-Show Impact\n' + rows], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = 'staff-table.csv'; a.click();
    URL.revokeObjectURL(url);
  }
}
