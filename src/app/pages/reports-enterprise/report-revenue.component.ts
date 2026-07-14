import { CommonModule } from '@angular/common';
import { Component, Input, OnInit, OnDestroy, computed, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { BaseChartComponent } from './base-chart.component';
import { ReportsEnterpriseService, FilterState } from './reports-enterprise.service';
import { Subscription } from 'rxjs';
import { AuraMoneyPipe } from '../../shared/pipes/aura-money.pipe';

@Component({
  selector: 'app-report-revenue',
  standalone: true,
  imports: [AuraMoneyPipe, CommonModule, FormsModule, BaseChartComponent],
  template: `
    <ng-container *ngIf="!loading(); else skeleton">
      <div class="revenue-metrics inner-stats-grid">
        <div class="metric-card teal"><span>Total Revenue</span><strong>{{ d()?.total | auraMoney:'1.0-0' }}</strong></div>
        <div class="metric-card blue"><span>Service Revenue</span><strong>{{ d()?.service | auraMoney:'1.0-0' }}</strong></div>
        <div class="metric-card green"><span>Product Revenue</span><strong>{{ d()?.product | auraMoney:'1.0-0' }}</strong></div>
        <div class="metric-card violet"><span>Membership Revenue</span><strong>{{ d()?.membership | auraMoney:'1.0-0' }}</strong></div>
        <div class="metric-card amber"><span>Gift Card Revenue</span><strong>{{ d()?.giftCard | auraMoney:'1.0-0' }}</strong></div>
        <div class="metric-card red"><span>Refunds/Discounts</span><strong>-{{ d()?.refunds | auraMoney:'1.0-0' }}</strong></div>
      </div>

      <div class="revenue-charts">
        <section class="panel report-section inner-page-card">
          <div class="section-title inner-action-bar"><h3>Payment Method Breakdown</h3></div>
          <div class="chart-container">
            <base-chart type="doughnut" [labels]="payMethodLabels()" [datasets]="payMethodDataset()"></base-chart>
          </div>
        </section>

        <section class="panel report-section inner-page-card">
          <div class="section-title inner-action-bar"><h3>Revenue by Staff</h3></div>
          <div class="chart-container">
            <base-chart type="horizontalBar" [labels]="staffLabels()" [datasets]="staffDataset()"></base-chart>
          </div>
        </section>

        <section class="panel report-section inner-page-card">
          <div class="section-title inner-action-bar"><h3>Revenue by Branch</h3></div>
          <div class="chart-container">
            <base-chart type="bar" [labels]="branchLabels()" [datasets]="branchDataset()"></base-chart>
          </div>
        </section>
      </div>

      <section class="panel report-section inner-page-card">
        <div class="section-title inner-action-bar">
          <h3>Revenue Transactions</h3>
          <button class="ghost-button mini" (click)="exportTable()">Export CSV</button>
        </div>
        <div class="table-wrap inner-table-wrap">
          <table>
            <thead><tr><th>Date</th><th>Invoice</th><th>Client</th><th>Staff</th><th>Amount</th><th>Payment</th></tr></thead>
            <tbody>
              <tr *ngFor="let t of txns()">
                <td>{{ t.date }}</td><td>{{ t.invoice }}</td><td>{{ t.client }}</td><td>{{ t.staff }}</td>
                <td><strong>{{ t.amount | auraMoney:'1.0-0' }}</strong></td><td><span class="badge">{{ t.paymentMethod }}</span></td>
              </tr>
              <tr *ngIf="txns().length===0"><td colspan="6" class="empty-cell">No transactions found for this period.</td></tr>
            </tbody>
          </table>
        </div>
      </section>
    </ng-container>

    <div *ngIf="!loading() && !d()" class="empty-state">
      <span class="empty-icon">💰</span><strong>No revenue data</strong>
    </div>

    <ng-template #skeleton>
      <div class="revenue-metrics"><div class="skeleton-card" *ngFor="let _ of [1,2,3,4,5,6]"><div class="skeleton-line w-60"></div><div class="skeleton-line w-80 h-8"></div></div></div>
    </ng-template>
  `,
  styles: [`
    .revenue-metrics { display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: 10px; margin-bottom: 16px; }
    .revenue-metrics .metric-card { min-height: 80px; display: grid; gap: 4px; padding: 14px; }
    .revenue-metrics .metric-card span { font-size: 11px; color: var(--muted); font-weight: 800; text-transform: uppercase; }
    .revenue-metrics .metric-card strong { font-size: 18px; }
    .revenue-charts { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; margin-bottom: 16px; }
    .chart-container { height: 220px; }
    .skeleton-card { border: 1px solid var(--line); border-radius: 8px; padding: 16px; background: var(--surface); display: grid; gap: 10px; }
    .skeleton-line { height: 12px; border-radius: 6px; background: linear-gradient(90deg, var(--surface-2) 25%, var(--line) 50%, var(--surface-2) 75%); background-size: 200% 100%; animation: shimmer 1.5s infinite; }
    .skeleton-line.w-60 { width: 60%; } .skeleton-line.w-80 { width: 80%; } .skeleton-line.h-8 { height: 20px; }
    @keyframes shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }
    .empty-state { text-align: center; padding: 24px 16px; }
    .empty-icon { font-size: 40px; display: block; margin-bottom: 8px; }
    .empty-state strong { display: block; font-size: 16px; }
    .empty-state small { color: var(--muted); }
    .empty-cell { text-align: center; padding: 24px; color: var(--muted); }
    @media (max-width: 760px) { .revenue-charts { grid-template-columns: 1fr; } }
  `]
})
export class ReportRevenueComponent implements OnInit, OnDestroy {
  @Input() filters!: FilterState;
  readonly loading = signal(true);
  readonly d = signal<any>(null);
  readonly payMethodLabels = computed(() => (this.d()?.byPayment || []).map((p: any) => p.mode));
  readonly payMethodDataset = computed(() => {
    const data = (this.d()?.byPayment || []).map((p: any) => p.amount);
    return [{ label: 'Amount', data, backgroundColor: ['#4B1238','#C87D4B','#f59e0b','#ef4444','#6d4cc2'] }];
  });
  readonly staffLabels = computed(() => (this.d()?.byStaff || []).map((s: any) => s.name));
  readonly staffDataset = computed(() => [{ label: 'Revenue', data: (this.d()?.byStaff || []).map((s: any) => s.amount), backgroundColor: '#4B1238' }]);
  readonly branchLabels = computed(() => (this.d()?.byBranch || []).map((b: any) => b.name));
  readonly branchDataset = computed(() => [{ label: 'Revenue', data: (this.d()?.byBranch || []).map((b: any) => b.amount), backgroundColor: '#2f5fbd' }]);
  readonly txns = computed(() => this.d()?.transactions || []);
  private subs: Subscription[] = [];

  constructor(private service: ReportsEnterpriseService) {}

  ngOnInit(): void {
    this.subs.push(this.service.getRevenueReport().subscribe(d => { this.d.set(d); this.loading.set(false); }));
  }
  ngOnDestroy(): void { this.subs.forEach(s => s.unsubscribe()); }

  exportTable(): void {
    const rows = this.txns().map((t: any) => `${t.date},${t.invoice},${t.client},${t.staff},${t.amount},${t.paymentMethod}`).join('\n');
    const blob = new Blob(['Date,Invoice,Client,Staff,Amount,Payment\n' + rows], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = 'revenue-transactions.csv'; a.click();
    URL.revokeObjectURL(url);
  }
}
