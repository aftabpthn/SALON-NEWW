import { CommonModule } from '@angular/common';
import { Component, Input, OnInit, OnDestroy, computed, signal } from '@angular/core';
import { BaseChartComponent } from './base-chart.component';
import { ReportsEnterpriseService, FilterState } from './reports-enterprise.service';
import { Subscription } from 'rxjs';
import { AuraMoneyPipe } from '../../shared/pipes/aura-money.pipe';

@Component({
  selector: 'app-report-branches',
  standalone: true,
  imports: [AuraMoneyPipe, CommonModule, BaseChartComponent],
  template: `
    <ng-container *ngIf="!loading(); else skeleton">
      <div class="branch-charts">
        <section class="panel report-section inner-page-card">
          <div class="section-title inner-action-bar"><h3>Revenue by Branch</h3></div>
          <div class="chart-container">
            <base-chart type="bar" [labels]="branchNames()" [datasets]="revenueDataset()"></base-chart>
          </div>
        </section>

        <section class="panel report-section inner-page-card">
          <div class="section-title inner-action-bar"><h3>Bookings by Branch</h3></div>
          <div class="chart-container">
            <base-chart type="bar" [labels]="branchNames()" [datasets]="bookingsDataset()"></base-chart>
          </div>
        </section>
      </div>

      <section class="panel report-section inner-page-card">
        <div class="section-title inner-action-bar">
          <h3>Branch Ranking Table</h3>
          <button class="ghost-button mini" (click)="exportTable()">Export CSV</button>
        </div>
        <div class="table-wrap inner-table-wrap">
          <table>
            <thead><tr><th>#</th><th>Branch</th><th>Revenue</th><th>Bookings</th><th>Client Growth</th><th>Staff Productivity</th><th>Profit Estimate</th></tr></thead>
            <tbody>
              <tr *ngFor="let b of branches(); let i=index">
                <td><span class="rank-num">{{ i+1 }}</span></td>
                <td><strong>{{ b.name }}</strong></td>
                <td>{{ b.revenue | auraMoney:'1.0-0' }}</td>
                <td>{{ b.bookings }}</td>
                <td><span class="growth-badge positive">{{ b.clientGrowth }}%</span></td>
                <td>{{ b.staffProductivity }}%</td>
                <td>{{ b.profitEstimate | auraMoney:'1.0-0' }}</td>
              </tr>
              <tr *ngIf="branches().length===0"><td colspan="7" class="empty-cell">No branch data found. Multi-branch may be disabled.</td></tr>
            </tbody>
          </table>
        </div>
      </section>
    </ng-container>

    <div *ngIf="!loading() && !d()" class="empty-state">
      <span class="empty-icon">🏢</span><strong>Multi-branch is disabled</strong>
    </div>

    <ng-template #skeleton>
      <div class="branch-charts"><div class="skeleton-card" *ngFor="let _ of [1,2]"><div class="skeleton-line w-40"></div><div class="skeleton-line" style="height:200px;margin-top:12px"></div></div></div>
    </ng-template>
  `,
  styles: [`
    .branch-charts { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 16px; }
    .chart-container { height: 240px; }
    .rank-num { display: inline-flex; align-items: center; justify-content: center; width: 24px; height: 24px; border-radius: 50%; background: #4B1238; color: #fff; font-size: 12px; font-weight: 900; }
    .growth-badge { padding: 2px 8px; border-radius: 4px; font-size: 12px; font-weight: 700; }
    .growth-badge.positive { background: #FBF0E8; color: var(--green); }
    .skeleton-card { border: 1px solid var(--line); border-radius: 8px; padding: 16px; background: var(--surface); }
    .skeleton-line { border-radius: 6px; background: linear-gradient(90deg, var(--surface-2) 25%, var(--line) 50%, var(--surface-2) 75%); background-size: 200% 100%; animation: shimmer 1.5s infinite; }
    .skeleton-line.w-40 { width: 40%; }
    @keyframes shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }
    .empty-state { text-align: center; padding: 24px 16px; }
    .empty-icon { font-size: 40px; display: block; margin-bottom: 8px; }
    .empty-state strong { display: block; font-size: 16px; }
    .empty-state small { color: var(--muted); }
    .empty-cell { text-align: center; padding: 24px; color: var(--muted); }
    @media (max-width: 760px) { .branch-charts { grid-template-columns: 1fr; } }
  `]
})
export class ReportBranchesComponent implements OnInit, OnDestroy {
  @Input() filters!: FilterState;
  readonly loading = signal(true);
  readonly d = signal<any>(null);
  readonly branches = computed(() => this.d()?.branches || []);
  readonly branchNames = computed(() => this.branches().map((b: any) => b.name));
  readonly revenueDataset = computed(() => [{ label: 'Revenue', data: this.branches().map((b: any) => b.revenue), backgroundColor: ['#4B1238','#6B1E4B','#C87D4B','#f59e0b'] }]);
  readonly bookingsDataset = computed(() => [{ label: 'Bookings', data: this.branches().map((b: any) => b.bookings), backgroundColor: ['#4B1238','#6B1E4B','#C87D4B','#f59e0b'] }]);
  private subs: Subscription[] = [];

  constructor(private service: ReportsEnterpriseService) {}

  ngOnInit(): void {
    this.subs.push(this.service.getBranchComparison().subscribe(d => { this.d.set(d); this.loading.set(false); }));
  }
  ngOnDestroy(): void { this.subs.forEach(s => s.unsubscribe()); }

  exportTable(): void {
    const rows = this.branches().map((b: any) => `${b.name},${b.revenue},${b.bookings},${b.clientGrowth}%,${b.staffProductivity}%,${b.profitEstimate}`).join('\n');
    const blob = new Blob(['Branch,Revenue,Bookings,Client Growth,Staff Productivity,Profit Estimate\n' + rows], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = 'branch-comparison.csv'; a.click();
    URL.revokeObjectURL(url);
  }
}
