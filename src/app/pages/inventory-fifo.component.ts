import { CommonModule } from '@angular/common';
import { Component, OnInit, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { ApiRecord, ApiService } from '../core/api.service';
import { InventoryZenotiChromeComponent } from '../shared/ui/inventory-zenoti-chrome/inventory-zenoti-chrome.component';
import { StateComponent } from '../shared/ui/state/state.component';
import { AuraMoneyPipe } from '../shared/pipes/aura-money.pipe';

@Component({
  selector: 'app-inventory-fifo',
  standalone: true,
  imports: [AuraMoneyPipe, CommonModule, RouterLink, InventoryZenotiChromeComponent, StateComponent],
  template: `
    <section class="page-stack fifo-page inner-page-shell">
      <app-inventory-zenoti-chrome
        title="Next stock to consume"
        breadcrumb="Inventory > Batch + Expiry + FIFO"
        (refresh)="load()"
      ></app-inventory-zenoti-chrome>

      <app-state [loading]="loading()" [error]="error()"></app-state>

      <section class="zenoti-fifo-workspace">
        <div class="zenoti-result-bar inner-stats-grid">
          <div>
            <strong>{{ activeBatches().length }}</strong><span>Results</span>
            <small class="status-chip">Status: FIFO active in this center</small>
          </div>
          <div class="zenoti-totals">
            <span>Expiring soon <strong>{{ expiringSoon().length }}</strong></span>
            <span>No expiry <strong>{{ noExpiry().length }}</strong></span>
            <span>Batch value <strong>{{ batchValue() | auraMoney:'1.0-0' }}</strong></span>
            <span>Waste risk <strong>{{ wasteRiskCount() }}</strong></span>
          </div>
        </div>

        <div class="zenoti-table-wrap inner-table-wrap">
          <table>
            <thead>
              <tr>
                <th>Product</th>
                <th>Batch</th>
                <th>Branch</th>
                <th>Supplier</th>
                <th>Available</th>
                <th>Received</th>
                <th>Unit cost</th>
                <th>Batch value</th>
                <th>Expiry</th>
                <th>FIFO status</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              <tr *ngFor="let batch of activeBatches()">
                <td><strong>{{ productName(batch.productId) }}</strong><small>{{ batch.productId || 'Product' }}</small></td>
                <td>{{ batch.batchNumber || batch.id }}</td>
                <td>{{ branchName(batch.branchId) }}</td>
                <td>{{ supplierName(batch.supplierId) }}</td>
                <td>{{ batch.quantityAvailable || 0 }}</td>
                <td>{{ batch.quantityReceived || 0 }}</td>
                <td>{{ batch.unitCost | auraMoney:'1.0-0' }}</td>
                <td>{{ batchRowValue(batch) | auraMoney:'1.0-0' }}</td>
                <td>{{ batch.expiryDate || 'No expiry' }}<small *ngIf="batch.expiryDate">{{ daysUntil(batch.expiryDate) }} day(s)</small></td>
                <td><span class="fifo-chip" [class.warn]="isExpiring(batch)" [class.danger]="isExpired(batch)">{{ fifoStatus(batch) }}</span></td>
                <td><a class="zenoti-mini-button" [routerLink]="['/inventory/products', batch.productId]">Product 360</a></td>
              </tr>
              <tr *ngIf="!activeBatches().length">
                <td colspan="11" class="empty-cell">No active FIFO batches. Receive stock with batch and expiry details.</td>
              </tr>
            </tbody>
          </table>
        </div>

        <div class="zenoti-footer">
          <span>1 to {{ activeBatches().length }} of {{ activeBatches().length }}</span>
          <span>{{ api.selectedBranchId() ? 'Branch scope active' : 'All branches' }}</span>
        </div>
      </section>
    </section>
  `,
  styles: [`
    .fifo-page {
      gap: 0;
    }

    .zenoti-fifo-workspace {
      background: #f0f2f5;
      border: 1px solid #d8e1ea;
      display: grid;
      gap: 8px;
      overflow: hidden;
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
    .fifo-chip {
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

    .fifo-chip {
      background: #e7f7ef;
      border-color: #bfe9d4;
      color: #086245;
    }

    .fifo-chip.warn {
      background: #fff3d8;
      border-color: #f7d48a;
      color: #7c4d00;
    }

    .fifo-chip.danger {
      background: #fff1f0;
      border-color: #ffc8c2;
      color: #a51d16;
    }

    .zenoti-table-wrap {
      overflow: auto;
    }

    table {
      border-collapse: collapse;
      min-width: 1220px;
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

    @media (max-width: 1020px) {
      .zenoti-result-bar,
      .zenoti-footer {
        align-items: flex-start;
        display: grid;
      }
    }
  `]
})
export class InventoryFifoComponent implements OnInit {
  readonly products = signal<ApiRecord[]>([]);
  readonly suppliers = signal<ApiRecord[]>([]);
  readonly branches = signal<ApiRecord[]>([]);
  readonly batches = signal<ApiRecord[]>([]);
  readonly loading = signal(true);
  readonly error = signal('');

  constructor(readonly api: ApiService) {}

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.loading.set(true);
    Promise.all([
      firstValueFrom(this.api.list<ApiRecord[]>('products', { limit: 10000 })),
      firstValueFrom(this.api.list<ApiRecord[]>('suppliers', { limit: 1000 })),
      firstValueFrom(this.api.list<ApiRecord[]>('branches', { limit: 1000 })),
      firstValueFrom(this.api.list<ApiRecord[]>('inventoryBatches', { branchId: this.api.selectedBranchId(), limit: 10000 }))
    ]).then(([products, suppliers, branches, batches]) => {
      this.products.set(products || []);
      this.suppliers.set(suppliers || []);
      this.branches.set(branches || []);
      this.batches.set(batches || []);
      this.loading.set(false);
    }).catch((error) => {
      this.error.set(this.api.errorText(error, 'Unable to load FIFO batches'));
      this.loading.set(false);
    });
  }

  activeBatches(): ApiRecord[] {
    return this.batches()
      .filter((batch) => Number(batch.quantityAvailable || 0) > 0)
      .slice()
      .sort((a, b) => String(a.expiryDate || '9999-12-31').localeCompare(String(b.expiryDate || '9999-12-31')));
  }

  expiringSoon(): ApiRecord[] {
    return this.activeBatches().filter((batch) => batch.expiryDate && this.daysUntil(batch.expiryDate) <= 60);
  }

  noExpiry(): ApiRecord[] {
    return this.activeBatches().filter((batch) => !batch.expiryDate);
  }

  batchValue(): number {
    return this.activeBatches().reduce((total, batch) => total + Number(batch.quantityAvailable || 0) * Number(batch.unitCost || 0), 0);
  }

  batchRowValue(batch: ApiRecord): number {
    return Number(batch.quantityAvailable || 0) * Number(batch.unitCost || 0);
  }

  wasteRiskCount(): number {
    return this.expiringSoon().length + this.noExpiry().length;
  }

  isExpired(batch: ApiRecord): boolean {
    return Boolean(batch.expiryDate) && this.daysUntil(batch.expiryDate) < 0;
  }

  isExpiring(batch: ApiRecord): boolean {
    return Boolean(batch.expiryDate) && this.daysUntil(batch.expiryDate) >= 0 && this.daysUntil(batch.expiryDate) <= 60;
  }

  fifoStatus(batch: ApiRecord): string {
    if (this.isExpired(batch)) return 'Expired';
    if (this.isExpiring(batch)) return 'Consume first';
    if (!batch.expiryDate) return 'Expiry missing';
    return 'FIFO ready';
  }

  productName(id: string): string {
    return this.products().find((product) => product.id === id)?.name || id || 'Product';
  }

  supplierName(id: string): string {
    if (!id) return 'not linked';
    return this.suppliers().find((supplier) => supplier.id === id)?.name || id;
  }

  branchName(id: string): string {
    return this.branches().find((branch) => branch.id === id)?.name || id || 'All branches';
  }

  daysUntil(value: string): number {
    const time = new Date(value).getTime();
    if (!value || Number.isNaN(time)) return 9999;
    return Math.round((time - Date.now()) / 86400000);
  }
}
