import { CommonModule } from '@angular/common';
import { Component, Input, OnInit, OnDestroy, signal } from '@angular/core';
import { ReportsEnterpriseService, FilterState } from './reports-enterprise.service';
import { Subscription } from 'rxjs';
import { AuraMoneyPipe } from '../../shared/pipes/aura-money.pipe';

@Component({
  selector: 'app-report-inventory',
  standalone: true,
  imports: [AuraMoneyPipe, CommonModule],
  template: `
    <ng-container *ngIf="!loading(); else skeleton">
      <div class="inv-metrics inner-stats-grid">
        <div class="metric-card teal"><span>Stock Value</span><strong>{{ data()?.stockValue | auraMoney:'1.0-0' }}</strong></div>
        <div class="metric-card green"><span>Product Profit Margin</span><strong>{{ data()?.profitMargin }}%</strong></div>
      </div>

      <div class="inv-grid">
        <section class="panel report-section inner-page-card">
          <div class="section-title inner-action-bar"><h3>Stock Status</h3></div>
          <div class="stock-list" *ngIf="data()?.products as products">
            <div *ngFor="let p of products" class="stock-item" [class.low]="p.status==='Low Stock'" [class.out]="p.status==='Out of Stock'">
              <div class="stock-info">
                <strong>{{ p.name }}</strong>
                <span class="stock-qty">Stock: {{ p.stock }} | Sold: {{ p.soldQty }}</span>
              </div>
              <span class="stock-badge" [ngClass]="{'badge-green': p.status==='In Stock', 'badge-amber': p.status==='Low Stock', 'badge-red': p.status==='Out of Stock' || p.status==='Dead Stock'}">{{ p.status }}</span>
            </div>
          </div>
        </section>

        <section class="panel report-section inner-page-card">
          <div class="section-title inner-action-bar"><h3>Reorder Suggestions</h3></div>
          <div class="reorder-list" *ngIf="data()?.reorderSuggestions as reorders">
            <div *ngFor="let r of reorders" class="reorder-item">
              <strong>{{ r.name }}</strong>
              <small>Suggested order: {{ r.suggestedQty }} units</small>
              <button class="ghost-button mini">Reorder</button>
            </div>
          </div>
        </section>
      </div>

      <section class="panel report-section inner-page-card">
        <div class="section-title inner-action-bar">
          <h3>Product Performance Table</h3>
          <button class="ghost-button mini" (click)="exportTable()">Export CSV</button>
        </div>
        <div class="table-wrap inner-table-wrap">
          <table>
            <thead><tr><th>Product</th><th>Stock</th><th>Sold</th><th>Revenue</th><th>Margin</th><th>Status</th></tr></thead>
            <tbody>
              <tr *ngFor="let p of (data()?.products || [])">
                <td><strong>{{ p.name }}</strong></td>
                <td>{{ p.stock }}</td><td>{{ p.soldQty }}</td>
                <td>{{ p.revenue | auraMoney:'1.0-0' }}</td>
                <td>{{ p.margin }}%</td>
                <td><span class="badge" [ngClass]="{'badge-green': p.status==='In Stock', 'badge-amber': p.status==='Low Stock', 'badge-red': p.status==='Out of Stock'}">{{ p.status }}</span></td>
              </tr>
              <tr *ngIf="!data()?.products?.length"><td colspan="6" class="empty-cell">No product data found.</td></tr>
            </tbody>
          </table>
        </div>
      </section>
    </ng-container>

    <div *ngIf="!loading() && !data()" class="empty-state">
      <span class="empty-icon">📦</span><strong>No inventory data</strong>
    </div>

    <ng-template #skeleton>
      <div class="inv-metrics"><div class="skeleton-card" *ngFor="let _ of [1,2]"><div class="skeleton-line w-60"></div><div class="skeleton-line w-80 h-8"></div></div></div>
    </ng-template>
  `,
  styles: [`
    .inv-metrics { display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; margin-bottom: 16px; }
    .inv-metrics .metric-card { min-height: 80px; display: grid; gap: 4px; padding: 14px; }
    .inv-metrics .metric-card span { font-size: 11px; color: var(--muted); font-weight: 800; text-transform: uppercase; }
    .inv-metrics .metric-card strong { font-size: 18px; }
    .inv-grid { display: grid; grid-template-columns: 1fr 0.7fr; gap: 16px; margin-bottom: 16px; }
    .stock-list { display: grid; gap: 8px; }
    .stock-item { display: flex; justify-content: space-between; align-items: center; padding: 10px 12px; border: 1px solid var(--line); border-radius: 8px; }
    .stock-item.low { border-color: #f59e0b; background: #fffbeb; }
    .stock-item.out { border-color: var(--red); background: #fef2f2; }
    .stock-info { display: grid; gap: 2px; }
    .stock-info strong { font-size: 13px; }
    .stock-qty { font-size: 11px; color: var(--muted); }
    .stock-badge { padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: 700; }
    .badge-green { background: #FBF0E8; color: var(--green); }
    .badge-amber { background: #fef3c7; color: #b7791f; }
    .badge-red { background: #fee2e2; color: var(--red); }
    .reorder-list { display: grid; gap: 8px; }
    .reorder-item { display: flex; align-items: center; gap: 8px; padding: 10px 12px; border: 1px solid var(--line); border-radius: 8px; }
    .reorder-item strong { flex: 1; font-size: 13px; }
    .reorder-item small { color: var(--muted); font-size: 11px; }
    .skeleton-card { border: 1px solid var(--line); border-radius: 8px; padding: 16px; background: var(--surface); display: grid; gap: 10px; }
    .skeleton-line { height: 12px; border-radius: 6px; background: linear-gradient(90deg, var(--surface-2) 25%, var(--line) 50%, var(--surface-2) 75%); background-size: 200% 100%; animation: shimmer 1.5s infinite; }
    .skeleton-line.w-60 { width: 60%; } .skeleton-line.w-80 { width: 80%; } .skeleton-line.h-8 { height: 20px; }
    @keyframes shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }
    .empty-state { text-align: center; padding: 24px 16px; }
    .empty-icon { font-size: 40px; display: block; margin-bottom: 8px; }
    .empty-state strong { display: block; font-size: 16px; }
    .empty-state small { color: var(--muted); }
    .empty-cell { text-align: center; padding: 24px; color: var(--muted); }
    @media (max-width: 760px) { .inv-grid { grid-template-columns: 1fr; } }
  `]
})
export class ReportInventoryComponent implements OnInit, OnDestroy {
  @Input() filters!: FilterState;
  readonly loading = signal(true);
  readonly data = signal<any>(null);
  private subs: Subscription[] = [];

  constructor(private service: ReportsEnterpriseService) {}

  ngOnInit(): void {
    this.subs.push(this.service.getInventoryReport().subscribe(d => { this.data.set(d); this.loading.set(false); }));
  }
  ngOnDestroy(): void { this.subs.forEach(s => s.unsubscribe()); }

  exportTable(): void {
    const rows = (this.data()?.products || []).map((p: any) => `${p.name},${p.stock},${p.soldQty},${p.revenue},${p.margin}%,${p.status}`).join('\n');
    const blob = new Blob(['Product,Stock,Sold,Revenue,Margin,Status\n' + rows], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = 'inventory-report.csv'; a.click();
    URL.revokeObjectURL(url);
  }
}
