import { CommonModule } from '@angular/common';
import { Component, OnInit, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { ApiRecord, ApiService } from '../core/api.service';
import { InventoryZenotiChromeComponent } from '../shared/ui/inventory-zenoti-chrome/inventory-zenoti-chrome.component';
import { StateComponent } from '../shared/ui/state/state.component';
import { AuraMoneyPipe } from '../shared/pipes/aura-money.pipe';

@Component({
  selector: 'app-inventory-reorder',
  standalone: true,
  imports: [AuraMoneyPipe, CommonModule, RouterLink, InventoryZenotiChromeComponent, StateComponent],
  template: `
    <section class="page-stack separated-inventory-page inner-page-shell">
      <app-inventory-zenoti-chrome
        title="Approval-safe purchase plan"
        breadcrumb="Inventory > AI Reorder Autopilot"
        (refresh)="load()"
      >
        <div zenoti-actions>
          <button class="primary-button" type="button" (click)="runReorder()" [disabled]="saving()">Generate PO draft</button>
        </div>
      </app-inventory-zenoti-chrome>

      <app-state [loading]="loading()" [error]="error()"></app-state>
      <div class="state success" *ngIf="success()">{{ success() }}</div>

      <section class="zenoti-reorder-workspace">
        <div class="zenoti-result-bar inner-stats-grid">
          <div>
            <strong>{{ suggestions().length }}</strong><span>Results</span>
            <small class="status-chip">Status: Reorder active in this center</small>
          </div>
          <div class="zenoti-totals">
            <span>Low stock <strong>{{ lowStock().length }}</strong></span>
            <span>Estimated PO <strong>{{ suggestionValue() | auraMoney:'1.0-0' }}</strong></span>
            <span>Critical <strong>{{ criticalSuggestions().length }}</strong></span>
          </div>
        </div>

        <div class="zenoti-table-wrap inner-table-wrap">
          <table>
            <thead>
              <tr>
                <th>Product</th>
                <th>Reason</th>
                <th>Supplier</th>
                <th>Current stock</th>
                <th>Threshold</th>
                <th>Stockout</th>
                <th>Order qty</th>
                <th>Estimated PO</th>
                <th>Priority</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              <tr *ngFor="let row of suggestions()">
                <td>
                  <strong>{{ row.name || productName(row.productId) }}</strong>
                  <small>{{ row.productId || row.sku || 'AI suggestion' }}</small>
                </td>
                <td>{{ row.reason || 'Low stock threshold reached' }}</td>
                <td>{{ row.supplier || supplierName(row.supplierId) }}</td>
                <td>{{ row.stock ?? '-' }}</td>
                <td>{{ row.lowStockThreshold ?? '-' }}</td>
                <td>{{ row.predictedStockoutDate || 'not projected' }}</td>
                <td>{{ row.recommendedQty || row.quantity || 0 }} units</td>
                <td>{{ row.estimatedCost | auraMoney:'1.0-0' }}</td>
                <td><span class="priority-chip" [class.critical]="isCritical(row)">{{ priorityLabel(row) }}</span></td>
                <td><a class="zenoti-mini-button" routerLink="/inventory/purchase-orders">Create PO</a></td>
              </tr>
              <tr *ngIf="!suggestions().length">
                <td colspan="10" class="empty-cell">No urgent reorder. Run autopilot after live stock changes or purchase receiving.</td>
              </tr>
            </tbody>
          </table>
        </div>

        <div class="zenoti-footer">
          <span>1 to {{ suggestions().length }} of {{ suggestions().length }}</span>
          <span>{{ selectedBranchLabel() }}</span>
        </div>
      </section>
    </section>
  `,
  styles: [`
    .separated-inventory-page {
      gap: 0;
    }

    .zenoti-reorder-workspace {
      background: #f0f2f5;
      border: 1px solid #d8e1ea;
      display: grid;
      gap: 8px;
      padding: 8px;
    }

    .zenoti-result-bar,
    .zenoti-footer {
      align-items: center;
      display: flex;
      gap: 12px;
      justify-content: space-between;
      padding: 10px 16px;
    }

    .zenoti-result-bar {
      border: 1px solid #d8e1ea;
    }

    .zenoti-result-bar > div,
    .zenoti-totals {
      align-items: center;
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }

    .zenoti-result-bar strong {
      color: #152033;
      font-size: 14px;
      font-weight: 900;
    }

    .zenoti-result-bar span,
    .zenoti-footer {
      color: #50637d;
      font-size: 12px;
      font-weight: 800;
    }

    .status-chip,
    .priority-chip {
      background: #eaf6ff;
      border: 1px solid #b9d0e7;
      border-radius: 999px;
      color: #173f62;
      display: inline-flex;
      font-size: 12px;
      font-weight: 900;
      line-height: 1;
      padding: 6px 10px;
      white-space: nowrap;
    }

    .priority-chip {
      background: #e7f7ef;
      border-color: #bfe9d4;
      color: #086245;
    }

    .priority-chip.critical {
      background: #fff1f0;
      border-color: #ffc8c2;
      color: #a51d16;
    }

    .zenoti-table-wrap {
      overflow: auto;
    }

    table {
      border-collapse: collapse;
      min-width: 1180px;
      width: 100%;
    }

    th,
    td {
      border-bottom: 1px solid #dfe6ee;
      color: #243142;
      font-size: 13px;
      padding: 11px 14px;
      text-align: left;
      vertical-align: middle;
      white-space: nowrap;
    }

    th {
      background: #f5f8fb;
      color: #5d6e84;
      font-size: 12px;
      font-weight: 900;
      text-transform: none;
    }

    td strong {
      color: #075f9e;
      display: block;
      font-size: 14px;
      font-weight: 900;
    }

    td small {
      color: #61738d;
      display: block;
      font-size: 11px;
      font-weight: 800;
      margin-top: 3px;
    }

    .zenoti-mini-button {
      background: #fff;
      border: 1px solid #b9d0e7;
      border-radius: 3px;
      color: #075f9e;
      display: inline-flex;
      font-size: 12px;
      font-weight: 900;
      padding: 7px 10px;
      text-decoration: none;
    }

    .empty-cell {
      color: #61738d;
      font-weight: 800;
      padding: 28px 14px;
      text-align: center;
    }

    .zenoti-footer {
      border-top: 1px solid #d8e1ea;
      justify-content: flex-end;
    }

    @media (max-width: 980px) {
      .zenoti-result-bar,
      .zenoti-footer {
        align-items: flex-start;
        display: grid;
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
    return this.suggestions().filter((row) => this.isCritical(row));
  }

  isCritical(row: ApiRecord): boolean {
    return String(row.priority || '').toLowerCase() === 'critical' || Number(row.daysOfStock || 999) <= 7;
  }

  priorityLabel(row: ApiRecord): string {
    return this.isCritical(row) ? 'Critical' : String(row.priority || 'High');
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
