import { CommonModule, CurrencyPipe } from '@angular/common';
import { Component, OnInit, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { ApiRecord, ApiService } from '../core/api.service';
import { StateComponent } from '../shared/ui/state/state.component';

@Component({
  selector: 'app-inventory-reorder',
  standalone: true,
  imports: [CommonModule, CurrencyPipe, RouterLink, StateComponent],
  template: `
    <section class="page-stack separated-inventory-page">
      <div class="module-hero compact-hero">
        <div>
          <span class="eyebrow">Inventory / AI Reorder Autopilot</span>
          <h2>Approval-safe purchase plan</h2>
          <p>Low stock, predicted stockout and supplier-ready purchase suggestions live on this page only.</p>
        </div>
        <div class="hero-actions">
          <a class="ghost-button" routerLink="/inventory">Inventory home</a>
          <a class="ghost-button" routerLink="/inventory/purchase-orders">Purchase orders</a>
          <button class="primary-button" type="button" (click)="runReorder()" [disabled]="saving()">Generate PO draft</button>
        </div>
      </div>

      <app-state [loading]="loading()" [error]="error()"></app-state>
      <div class="state success" *ngIf="success()">{{ success() }}</div>

      <section class="reorder-kpis">
        <article class="metric-card teal"><span>Suggestions</span><strong>{{ suggestions().length }}</strong><small>approval required</small></article>
        <article class="metric-card amber"><span>Low stock</span><strong>{{ lowStock().length }}</strong><small>threshold reached</small></article>
        <article class="metric-card blue"><span>Estimated PO</span><strong>{{ suggestionValue() | currency:'INR':'symbol':'1.0-0' }}</strong><small>recommended spend</small></article>
        <article class="metric-card red"><span>Critical</span><strong>{{ criticalSuggestions().length }}</strong><small>stockout priority</small></article>
      </section>

      <section class="panel">
        <div class="section-title">
          <div><span class="eyebrow">AI reorder cockpit</span><h2>Purchase recommendations</h2></div>
          <small>{{ selectedBranchLabel() }}</small>
        </div>
        <div class="reorder-list">
          <article *ngFor="let row of suggestions()">
            <div>
              <strong>{{ row.name || productName(row.productId) }}</strong>
              <span>{{ row.reason || 'Low-stock threshold reached' }}</span>
              <small>Stockout {{ row.predictedStockoutDate || 'not projected' }} · supplier {{ row.supplier || supplierName(row.supplierId) }}</small>
            </div>
            <div class="right">
              <strong>{{ row.recommendedQty || row.quantity || 0 }} units</strong>
              <span>{{ row.estimatedCost | currency:'INR':'symbol':'1.0-0' }}</span>
              <a class="ghost-button mini" routerLink="/inventory/purchase-orders">Create PO</a>
            </div>
          </article>
          <article *ngIf="!suggestions().length">
            <div><strong>No urgent reorder</strong><span>Run autopilot after live stock changes or purchase receiving.</span></div>
          </article>
        </div>
      </section>
    </section>
  `,
  styles: [`
    .compact-hero, .hero-actions, .section-title {
      align-items: center;
    }

    .hero-actions {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      justify-content: flex-end;
    }

    .reorder-kpis {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 12px;
    }

    .section-title small,
    .reorder-list span,
    .reorder-list small {
      color: var(--muted);
      font-weight: 800;
    }

    .reorder-list {
      display: grid;
      gap: 10px;
    }

    .reorder-list article {
      display: grid;
      grid-template-columns: minmax(0, 1fr) 170px;
      gap: 14px;
      align-items: center;
      padding: 14px;
      border: 1px solid rgba(79, 70, 229, 0.1);
      border-radius: 18px;
      background: rgba(255, 255, 255, 0.92);
    }

    .reorder-list strong,
    .reorder-list span,
    .reorder-list small {
      display: block;
    }

    .reorder-list .right {
      display: grid;
      justify-items: end;
      gap: 4px;
      text-align: right;
    }

    @media (max-width: 980px) {
      .reorder-kpis,
      .reorder-list article {
        grid-template-columns: 1fr;
      }

      .reorder-list .right {
        justify-items: start;
        text-align: left;
      }
    }
  `]
})
export class InventoryReorderComponent implements OnInit {
  readonly products = signal<ApiRecord[]>([]);
  readonly suppliers = signal<ApiRecord[]>([]);
  readonly intelligence = signal<ApiRecord | null>(null);
  readonly loading = signal(true);
  readonly saving = signal(false);
  readonly error = signal('');
  readonly success = signal('');

  constructor(private readonly api: ApiService) {}

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.loading.set(true);
    Promise.all([
      firstValueFrom(this.api.list<ApiRecord[]>('products', { branchId: this.api.selectedBranchId(), limit: 10000 })),
      firstValueFrom(this.api.list<ApiRecord[]>('suppliers', { limit: 1000 })),
      firstValueFrom(this.api.list<ApiRecord>('inventory-intelligence/summary', { branchId: this.api.selectedBranchId() }))
    ]).then(([products, suppliers, intelligence]) => {
      this.products.set(products || []);
      this.suppliers.set(suppliers || []);
      this.intelligence.set(intelligence || null);
      this.loading.set(false);
    }).catch((error) => {
      this.error.set(this.api.errorText(error, 'Unable to load reorder autopilot'));
      this.loading.set(false);
    });
  }

  runReorder(): void {
    this.saving.set(true);
    this.api.post<ApiRecord>('inventory-intelligence/reorder-suggestions/run', { branchId: this.api.selectedBranchId() }).subscribe({
      next: () => {
        this.success.set('AI reorder suggestions refreshed.');
        this.saving.set(false);
        this.load();
      },
      error: (error) => {
        this.error.set(this.api.errorText(error, 'Unable to generate reorder suggestions'));
        this.saving.set(false);
      }
    });
  }

  suggestions(): ApiRecord[] {
    const direct = (this.intelligence()?.['suggestions'] || []) as ApiRecord[];
    if (direct.length) return direct;
    return this.lowStock().map((product) => {
      const qty = Math.max(1, Number(product.lowStockThreshold || 5) * 2 - Number(product.stock || 0));
      return {
        productId: product.id,
        name: product.name,
        supplier: product.supplier,
        stock: product.stock,
        lowStockThreshold: product.lowStockThreshold,
        recommendedQty: qty,
        estimatedCost: qty * Number(product.unitCost || 0),
        priority: 'high',
        reason: 'Low stock threshold reached'
      };
    });
  }

  lowStock(): ApiRecord[] {
    return this.products().filter((product) => Number(product.stock || 0) <= Number(product.lowStockThreshold || 0));
  }

  criticalSuggestions(): ApiRecord[] {
    return this.suggestions().filter((row) => String(row.priority || '').toLowerCase() === 'critical' || Number(row.daysOfStock || 999) <= 7);
  }

  suggestionValue(): number {
    return this.suggestions().reduce((total, row) => total + Number(row.estimatedCost || 0), 0);
  }

  productName(id: string): string {
    return this.products().find((product) => product.id === id)?.name || id || 'Product';
  }

  supplierName(id: string): string {
    if (!id) return 'not linked';
    return this.suppliers().find((supplier) => supplier.id === id)?.name || id;
  }

  selectedBranchLabel(): string {
    return this.api.selectedBranchId() ? 'Branch scope active' : 'All branches';
  }
}
