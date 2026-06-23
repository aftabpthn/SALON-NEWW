import { CommonModule, CurrencyPipe } from '@angular/common';
import { Component, OnInit, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { ApiRecord, ApiService } from '../core/api.service';
import { InventoryZenotiChromeComponent } from '../shared/ui/inventory-zenoti-chrome/inventory-zenoti-chrome.component';
import { StateComponent } from '../shared/ui/state/state.component';

@Component({
  selector: 'app-inventory-financial',
  standalone: true,
  imports: [CommonModule, CurrencyPipe, InventoryZenotiChromeComponent, StateComponent],
  template: `
    <section class="page-stack financial-page">
      <app-inventory-zenoti-chrome
        title="COGS, cash and margin"
        breadcrumb="Inventory > Financial Brain"
        (refresh)="load()"
      >
        <div zenoti-actions>
          <button class="primary-button" type="button" (click)="snapshot()" [disabled]="saving()">Create snapshot</button>
        </div>
      </app-inventory-zenoti-chrome>

      <app-state [loading]="loading()" [error]="error()"></app-state>
      <div class="state success" *ngIf="success()">{{ success() }}</div>

      <section class="financial-kpis">
        <article class="metric-card teal"><span>Cash locked</span><strong>{{ cashLocked() | currency:'INR':'symbol':'1.0-0' }}</strong><small>current stock value</small></article>
        <article class="metric-card amber"><span>COGS</span><strong>{{ cogs() | currency:'INR':'symbol':'1.0-0' }}</strong><small>deducted inventory cost</small></article>
        <article class="metric-card red"><span>Dead stock</span><strong>{{ deadStockValue() | currency:'INR':'symbol':'1.0-0' }}</strong><small>{{ deadStockProducts().length }} item(s)</small></article>
        <article class="metric-card blue"><span>Profit potential</span><strong>{{ profitPotential() | currency:'INR':'symbol':'1.0-0' }}</strong><small>gross margin in stock</small></article>
      </section>

      <div class="financial-grid">
        <section class="panel">
          <div class="section-title"><div><span class="eyebrow">Dead stock</span><h2>Cash stuck on shelves</h2></div></div>
          <article class="finance-row" *ngFor="let product of deadStockProducts()">
            <div><strong>{{ product.name }}</strong><span>{{ product.stock || 0 }} unit(s) · no sale/service usage</span></div>
            <strong>{{ stockValue(product) | currency:'INR':'symbol':'1.0-0' }}</strong>
          </article>
          <p class="muted" *ngIf="!deadStockProducts().length">No dead-stock signal right now.</p>
        </section>

        <section class="panel">
          <div class="section-title"><div><span class="eyebrow">Margin leakage</span><h2>Weak-margin products</h2></div></div>
          <article class="finance-row danger" *ngFor="let product of marginLeakageProducts()">
            <div><strong>{{ product.name }}</strong><span>Price {{ product.price | currency:'INR':'symbol':'1.0-0' }} · cost {{ product.unitCost | currency:'INR':'symbol':'1.0-0' }}</span></div>
            <strong>{{ productMargin(product) | currency:'INR':'symbol':'1.0-0' }}</strong>
          </article>
          <p class="muted" *ngIf="!marginLeakageProducts().length">No weak margin signal.</p>
        </section>
      </div>

      <section class="panel">
        <div class="section-title"><div><span class="eyebrow">Supplier spend</span><h2>Purchase cost by supplier</h2></div></div>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Supplier</th><th>Purchase entries</th><th>Total purchase</th><th>Last movement</th></tr></thead>
            <tbody>
              <tr *ngFor="let row of supplierSpendRows()">
                <td>{{ row.name }}</td>
                <td>{{ row.count }}</td>
                <td>{{ row.spend | currency:'INR':'symbol':'1.0-0' }}</td>
                <td>{{ row.lastDate || '-' }}</td>
              </tr>
              <tr *ngIf="!supplierSpendRows().length"><td colspan="4">No supplier purchase movements yet.</td></tr>
            </tbody>
          </table>
        </div>
      </section>
    </section>
  `,
  styles: [`
    .compact-hero, .hero-actions, .section-title, .finance-row {
      align-items: center;
    }

    .hero-actions,
    .finance-row {
      display: flex;
      gap: 10px;
      justify-content: space-between;
    }

    .hero-actions {
      flex-wrap: wrap;
      justify-content: flex-end;
    }

    .financial-kpis,
    .financial-grid {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 12px;
    }

    .financial-grid {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }

    .finance-row {
      margin-top: 10px;
      padding: 13px;
      border: 1px solid var(--line);
      border-radius: 14px;
      background: #fff;
    }

    .finance-row.danger {
      border-color: rgba(185, 28, 28, .25);
      background: #fff8f8;
    }

    .finance-row span,
    .muted {
      color: var(--muted);
      font-weight: 800;
    }

    .finance-row strong,
    .finance-row span {
      display: block;
    }

    .table-wrap {
      overflow: auto;
    }

    table {
      min-width: 760px;
    }

    @media (max-width: 980px) {
      .financial-kpis,
      .financial-grid {
        grid-template-columns: 1fr;
      }
    }
  `]
})
export class InventoryFinancialComponent implements OnInit {
  readonly products = signal<ApiRecord[]>([]);
  readonly transactions = signal<ApiRecord[]>([]);
  readonly suppliers = signal<ApiRecord[]>([]);
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
      firstValueFrom(this.api.list<ApiRecord[]>('inventory', { branchId: this.api.selectedBranchId(), limit: 5000 })),
      firstValueFrom(this.api.list<ApiRecord[]>('suppliers', { limit: 1000 }))
    ]).then(([products, transactions, suppliers]) => {
      this.products.set(products || []);
      this.transactions.set(transactions || []);
      this.suppliers.set(suppliers || []);
      this.loading.set(false);
    }).catch((error) => {
      this.error.set(this.api.errorText(error, 'Unable to load inventory financial brain'));
      this.loading.set(false);
    });
  }

  snapshot(): void {
    this.saving.set(true);
    this.api.post<ApiRecord>('inventory-intelligence/reports/snapshot', { branchId: this.api.selectedBranchId() }).subscribe({
      next: () => {
        this.success.set('Inventory financial snapshot saved.');
        this.saving.set(false);
      },
      error: (error) => {
        this.error.set(this.api.errorText(error, 'Unable to save financial snapshot'));
        this.saving.set(false);
      }
    });
  }

  cashLocked(): number {
    return this.products().reduce((total, product) => total + this.stockValue(product), 0);
  }

  cogs(): number {
    return this.transactions()
      .filter((row) => Number(row.quantity || 0) < 0)
      .reduce((total, row) => total + Math.abs(Number(row.totalCost || 0)), 0);
  }

  deadStockProducts(): ApiRecord[] {
    return this.products().filter((product) =>
      Number(product.stock || 0) > Math.max(10, Number(product.lowStockThreshold || 0) * 3)
      && this.productUsage(product.id) === 0
    );
  }

  deadStockValue(): number {
    return this.deadStockProducts().reduce((total, product) => total + this.stockValue(product), 0);
  }

  marginLeakageProducts(): ApiRecord[] {
    return this.products().filter((product) => this.productMargin(product) <= 0 && Number(product.stock || 0) > 0);
  }

  profitPotential(): number {
    return this.products().reduce((total, product) => total + Math.max(0, this.productMargin(product)) * Number(product.stock || 0), 0);
  }

  supplierSpendRows(): ApiRecord[] {
    const bySupplier = new Map<string, ApiRecord>();
    for (const row of this.transactions().filter((item) => String(item.type || '').includes('purchase'))) {
      const id = String(row.supplierId || row.supplier_id || 'unknown');
      const existing = bySupplier.get(id) || { id, name: this.supplierName(id), count: 0, spend: 0, lastDate: '' };
      existing.count += 1;
      existing.spend += Math.abs(Number(row.totalCost || 0));
      existing.lastDate = [existing.lastDate, row.createdAt].filter(Boolean).sort().pop() || '';
      bySupplier.set(id, existing);
    }
    return Array.from(bySupplier.values()).sort((a, b) => Number(b.spend || 0) - Number(a.spend || 0));
  }

  stockValue(product: ApiRecord): number {
    return Number(product.stock || 0) * Number(product.unitCost || product.price || 0);
  }

  productMargin(product: ApiRecord): number {
    return Number(product.price || 0) - Number(product.unitCost || 0);
  }

  productUsage(productId: string): number {
    return Math.abs(this.transactions()
      .filter((row) => row.productId === productId && Number(row.quantity || 0) < 0)
      .reduce((total, row) => total + Number(row.quantity || 0), 0));
  }

  supplierName(id: string): string {
    if (!id || id === 'unknown') return 'Unknown supplier';
    return this.suppliers().find((supplier) => supplier.id === id)?.name || id;
  }
}
