import { CommonModule } from '@angular/common';
import { Component, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { ApiRecord, ApiService } from '../core/api.service';
import { StateComponent } from '../shared/ui/state/state.component';
import { AuraMoneyPipe } from '../shared/pipes/aura-money.pipe';

@Component({
  selector: 'app-inventory-product-edit',
  standalone: true,
  imports: [AuraMoneyPipe, CommonModule, FormsModule, RouterLink, StateComponent],
  template: `
    <section class="page-stack product-edit-page inner-page-shell">
      <div class="module-hero compact-hero inner-page-header">
        <div>
          <h2>Edit Product</h2>
          <p>{{ product()?.name || 'Selected product' }}</p>
        </div>
        <div class="hero-actions inner-action-bar">
          <a class="ghost-button" routerLink="/inventory">Back to products</a>
          <a class="ghost-button" [routerLink]="product360Link()">Open 360</a>
          <a class="primary-button" routerLink="/inventory/purchase-orders">Purchase orders</a>
        </div>
      </div>

      <app-state [loading]="loading()" [error]="error()"></app-state>

      <ng-container *ngIf="product() as item">
        <section class="panel edit-shell inner-page-card">
          <div class="edit-heading">
            <div>
              <h2>{{ item.name }}</h2>
              <small>{{ productCode(item) }} - {{ productStatus(item) }}</small>
            </div>
            <div class="status-pill">{{ productType(item) }}</div>
          </div>

          <div class="product-tabs">
            <button *ngFor="let tab of tabs" type="button" [class.active]="activeTab() === tab.key" (click)="activeTab.set(tab.key)">
              {{ tab.label }}
            </button>
          </div>

          <div class="tab-body" [ngSwitch]="activeTab()">
            <div class="field-grid" *ngSwitchCase="'general'">
              <div><span>Product code</span><strong>{{ productCode(item) }}</strong></div>
              <div><span>Product name</span><strong>{{ item.name }}</strong></div>
              <div><span>Category</span><strong>{{ item.category || '-' }}</strong></div>
              <div><span>Subcategory</span><strong>{{ item.subcategory || item.subCategory || '-' }}</strong></div>
              <div><span>Brand</span><strong>{{ productBrand(item) }}</strong></div>
              <div><span>Status</span><strong>{{ productStatus(item) }}</strong></div>
            </div>

            <div class="field-grid" *ngSwitchCase="'price'">
              <div><span>Sale price</span><strong>{{ item.price | auraMoney:'1.0-0' }}</strong></div>
              <div><span>MRP</span><strong>{{ productMrp(item) | auraMoney:'1.0-0' }}</strong></div>
              <div><span>Unit cost</span><strong>{{ item.unitCost | auraMoney:'1.0-0' }}</strong></div>
              <div><span>Margin</span><strong>{{ productMargin(item) | auraMoney:'1.0-0' }}</strong></div>
              <div><span>GST rate</span><strong>{{ item.gstRate || 0 }}%</strong></div>
              <div><span>Stock value</span><strong>{{ stockValue(item) | auraMoney:'1.0-0' }}</strong></div>
            </div>

            <div class="field-grid" *ngSwitchCase="'vendors'">
              <div><span>Primary vendor</span><strong>{{ productVendorName(item) }}</strong></div>
              <div><span>Vendor score</span><strong>{{ productVendorScore(item) }}</strong></div>
              <div><span>Last purchase</span><strong>{{ productVendorLastPurchase(item) }}</strong></div>
              <div><span>Purchase value</span><strong>{{ productVendorPurchaseValue(item) | auraMoney:'1.0-0' }}</strong></div>
            </div>

            <div class="field-grid" *ngSwitchCase="'catalog'">
              <div><span>SKU / barcode</span><strong>{{ item.sku || item.barcode || '-' }}</strong></div>
              <div><span>Usage type</span><strong>{{ productType(item) }}</strong></div>
              <div><span>Business unit</span><strong>{{ productBusinessUnit(item) }}</strong></div>
              <div><span>Low stock threshold</span><strong>{{ item.lowStockThreshold || 0 }}</strong></div>
              <div><span>Current stock</span><strong>{{ item.stock || 0 }} {{ item.unit || 'pcs' }}</strong></div>
              <div><span>Nearest expiry</span><strong>{{ nearestExpiry(item.id) }}</strong></div>
              <div class="laundry-config">
                <label class="switch-row">
                  <input type="checkbox" [ngModel]="laundryEnabled()" (ngModelChange)="laundryEnabled.set($event)" />
                  <span>
                    <strong>Laundry</strong>
                    <small>Tick karne par product Laundry Inward / Outward page me dikhega.</small>
                  </span>
                </label>
                <label class="laundry-rate">
                  <span>Laundry Rate</span>
                  <input type="number" min="0" [ngModel]="laundryRate()" (ngModelChange)="laundryRate.set(numberValue($event))" />
                </label>
                <button type="button" class="primary-button" (click)="saveLaundrySettings(item)" [disabled]="saving()">
                  {{ saving() ? 'Saving...' : 'Save laundry setup' }}
                </button>
              </div>
            </div>

            <div class="table-wrap inner-table-wrap" *ngSwitchCase="'variants'">
              <table>
                <thead><tr><th>Batch</th><th>Qty</th><th>Expiry</th><th>Vendor</th></tr></thead>
                <tbody>
                  <tr *ngFor="let batch of batchesForProduct(item.id)">
                    <td>{{ batch.batchNumber || batch.id }}</td>
                    <td>{{ batch.quantityAvailable || batch.quantity || 0 }}</td>
                    <td>{{ batch.expiryDate || '-' }}</td>
                    <td>{{ supplierNameFromId(batch.supplierId || '') }}</td>
                  </tr>
                  <tr *ngIf="!batchesForProduct(item.id).length"><td colspan="4" class="empty-cell">No batches received yet.</td></tr>
                </tbody>
              </table>
            </div>

            <div class="field-grid" *ngSwitchDefault>
              <div><span>Sale usage</span><strong>{{ productSaleUsage(item.id) }}</strong></div>
              <div><span>Service usage</span><strong>{{ productServiceUsage(item.id) }}</strong></div>
              <div><span>Reorder signal</span><strong>{{ productReorderSignal(item) }}</strong></div>
              <div><span>Stock audit risk</span><strong>{{ productAuditRisk(item.id) }}</strong></div>
            </div>
          </div>
        </section>
      </ng-container>
    </section>
  `,
  styles: [`
    .compact-hero,
    .hero-actions {
      align-items: center;
    }

    .hero-actions {
      display: flex;
      flex-wrap: wrap;
      justify-content: flex-end;
      gap: 8px;
    }

    .edit-shell {
      padding: 0;
      overflow: hidden;
      border-radius: 8px;
    }

    .edit-heading {
      display: flex;
      justify-content: space-between;
      gap: 12px;
      padding: 16px;
      border-bottom: 1px solid var(--line);
      background: #f7fbfa;
    }

    .edit-heading h2 {
      margin: 4px 0;
      color: var(--ink);
      font-size: 1.35rem;
      line-height: 1.2;
    }

    .edit-heading small {
      color: var(--muted);
      font-weight: 900;
    }

    .status-pill {
      align-self: start;
      border: 1px solid var(--line);
      border-radius: 999px;
      padding: 8px 12px;
      background: #fff;
      color: var(--ink);
      font-size: 0.78rem;
      font-weight: 900;
    }

    .product-tabs {
      display: flex;
      overflow-x: auto;
      border-bottom: 1px solid var(--line);
      background: #fff;
    }

    .product-tabs button {
      min-height: 40px;
      padding: 0 14px;
      border: 0;
      border-right: 1px solid var(--line);
      background: #fff;
      color: var(--muted);
      font-size: 0.76rem;
      font-weight: 900;
      cursor: pointer;
      white-space: nowrap;
    }

    .product-tabs button.active {
      color: var(--ink);
      background: #eef8f6;
      box-shadow: inset 0 -3px 0 var(--teal);
    }

    .tab-body {
      padding: 16px;
    }

    .field-grid {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 12px;
    }

    .field-grid div {
      min-width: 0;
      padding: 14px;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: #fff;
    }

    .field-grid span,
    .field-grid strong {
      display: block;
    }

    .field-grid span {
      color: var(--muted);
      font-size: 0.7rem;
      font-weight: 900;
      text-transform: uppercase;
    }

    .field-grid strong {
      margin-top: 6px;
      color: var(--ink);
      font-size: 1rem;
      line-height: 1.25;
      overflow-wrap: anywhere;
    }

    .table-wrap {
      overflow: auto;
      border: 1px solid var(--line);
      border-radius: 8px;
    }

    table {
      width: 100%;
      min-width: 720px;
      border-collapse: collapse;
    }

    th,
    td {
      padding: 12px;
      border-bottom: 1px solid var(--line);
      text-align: left;
      white-space: nowrap;
    }

    th {
      background: #f7fbfa;
      color: var(--muted);
      font-size: 0.72rem;
      font-weight: 900;
      text-transform: uppercase;
    }

    .empty-cell {
      color: var(--muted);
      text-align: center;
    }

    @media (max-width: 920px) {
      .field-grid {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }
    }

    @media (max-width: 640px) {
      .edit-heading,
      .compact-hero {
        align-items: stretch;
        flex-direction: column;
      }

      .hero-actions {
        justify-content: flex-start;
      }

      .field-grid {
        grid-template-columns: 1fr;
      }
    }
  `]
})
export class InventoryProductEditComponent implements OnInit {
  readonly loading = signal(true);
  readonly error = signal('');
  readonly product = signal<ApiRecord | null>(null);
  readonly products = signal<ApiRecord[]>([]);
  readonly suppliers = signal<ApiRecord[]>([]);
  readonly batches = signal<ApiRecord[]>([]);
  readonly transactions = signal<ApiRecord[]>([]);
  readonly intelligence = signal<ApiRecord | null>(null);
  readonly activeTab = signal('general');
  readonly saving = signal(false);
  readonly success = signal('');
  readonly laundryEnabled = signal(false);
  readonly laundryRate = signal(0);

  readonly tabs = [
    { key: 'general', label: 'GENERAL' },
    { key: 'price', label: 'PRICE' },
    { key: 'vendors', label: 'VENDORS' },
    { key: 'catalog', label: 'CATALOG' },
    { key: 'variants', label: 'VARIANTS' },
    { key: 'related', label: 'RELATED' }
  ];

  constructor(private readonly api: ApiService, private readonly route: ActivatedRoute) {}

  saveLaundrySettings(product: ApiRecord): void {
    const id = String(product.id || '');
    if (!id) return;
    const patch: ApiRecord = {
      isLaundry: this.laundryEnabled(),
      laundry: this.laundryEnabled(),
      laundryProduct: this.laundryEnabled(),
      laundryRate: this.laundryRate()
    };
    this.saving.set(true);
    this.error.set('');
    this.success.set('');
    this.api.update<ApiRecord>('products', id, patch).subscribe({
      next: (updated) => {
        const next = { ...product, ...patch, ...(updated || {}) };
        this.saveLocalLaundryProduct(id, patch);
        this.product.set(next);
        this.products.set(this.products().map((item) => (item.id === id ? next : item)));
        this.syncLaundryForm(next);
        this.success.set('Laundry setup saved.');
        this.saving.set(false);
      },
      error: (error) => {
        this.saveLocalLaundryProduct(id, patch);
        const next = { ...product, ...patch };
        this.product.set(next);
        this.products.set(this.products().map((item) => (item.id === id ? next : item)));
        this.syncLaundryForm(next);
        this.success.set('Laundry setup saved locally.');
        this.error.set(this.api.errorText(error, 'Backend save failed, local setup saved.'));
        this.saving.set(false);
      }
    });
  }

  numberValue(value: unknown): number {
    const next = Number(value || 0);
    return Number.isFinite(next) ? next : 0;
  }

  private syncLaundryForm(product: ApiRecord): void {
    const local = this.localLaundryProduct(product.id);
    const merged = { ...product, ...local };
    this.laundryEnabled.set(this.isLaundryProduct(merged));
    this.laundryRate.set(this.numberValue(merged.laundryRate ?? merged.unitCost ?? merged.costPrice ?? merged.price ?? 0));
  }

  private isLaundryProduct(product: ApiRecord): boolean {
    return product.isLaundry === true || product.laundry === true || product.laundryProduct === true;
  }

  private saveLocalLaundryProduct(productId: string, patch: ApiRecord): void {
    localStorage.setItem(`aura_laundry_product_${productId}`, JSON.stringify(patch));
  }

  private localLaundryProduct(productId: unknown): ApiRecord {
    try {
      return JSON.parse(localStorage.getItem(`aura_laundry_product_${String(productId || '')}`) || '{}');
    } catch {
      return {};
    }
  }

  ngOnInit(): void {
    this.load();
  }

  async load(): Promise<void> {
    this.loading.set(true);
    try {
      const id = this.route.snapshot.paramMap.get('id') || '';
      const [products, suppliers, batches, transactions, intelligence] = await Promise.all([
        firstValueFrom(this.api.list<ApiRecord[]>('products', { limit: 10000 })),
        firstValueFrom(this.api.list<ApiRecord[]>('suppliers')),
        firstValueFrom(this.api.list<ApiRecord[]>('inventoryBatches', { branchId: this.api.selectedBranchId(), limit: 1000 })),
        firstValueFrom(this.api.list<ApiRecord[]>('inventory', { branchId: this.api.selectedBranchId(), limit: 1000 })),
        firstValueFrom(this.api.list<ApiRecord>('inventory-intelligence/summary', { branchId: this.api.selectedBranchId() }))
      ]);
      this.products.set(products || []);
      this.suppliers.set(suppliers || []);
      this.batches.set(batches || []);
      this.transactions.set(transactions || []);
      this.intelligence.set(intelligence || null);
      this.product.set((products || []).find((item) => item.id === id) || null);
      if (this.product()) this.syncLaundryForm(this.product() as ApiRecord);
      if (!this.product()) this.error.set('Product not found');
    } catch (error: any) {
      this.error.set(error?.error?.error || 'Unable to load product');
    } finally {
      this.loading.set(false);
    }
  }

  product360Link(): string[] {
    const id = this.product()?.id;
    return id ? ['/inventory/products', id] : ['/inventory'];
  }

  productCode(product: ApiRecord): string {
    return String(product.code || product.productCode || product.sku || product.id || '-');
  }

  productBrand(product: ApiRecord): string {
    return String(product.brand || product.brandName || product.manufacturer || '-');
  }

  productType(product: ApiRecord): string {
    return String(product.usageType || product.productType || product.type || 'retail');
  }

  productBusinessUnit(product: ApiRecord): string {
    return String(product.businessUnit || product.category || product.usageType || 'Inventory');
  }

  productStatus(product: ApiRecord): string {
    const status = String(product.status || '').toLowerCase();
    if (status === 'inactive' || status === 'disabled' || status === 'archived') return 'inactive';
    return 'active';
  }

  productMrp(product: ApiRecord): number {
    return Number(product.mrp || product.marketPrice || product.retailPrice || product.price || 0);
  }

  stockValue(product: ApiRecord): number {
    return Number(product.stock || 0) * Number(product.unitCost || product.price || 0);
  }

  productMargin(product: ApiRecord): number {
    return Number(product.price || 0) - Number(product.unitCost || 0);
  }

  productVendorName(product: ApiRecord): string {
    const direct = String(product.supplier || product.vendor || product.vendorName || '').trim();
    const directSupplier = direct ? this.suppliers().find((supplier) => supplier.id === direct || supplier.code === direct) : null;
    if (directSupplier) return directSupplier.name;
    if (direct) return direct;
    const supplierId = this.productVendorId(product);
    return supplierId ? this.supplierNameFromId(supplierId) : '-';
  }

  productVendorId(product: ApiRecord): string {
    const directId = String(product.supplierId || product.vendorId || '').trim();
    if (directId) return directId;
    const batch = this.batches().find((row) => row.productId === product.id && row.supplierId);
    if (batch?.supplierId) return String(batch.supplierId);
    const direct = String(product.supplier || product.vendor || product.vendorName || '').trim().toLowerCase();
    return this.suppliers().find((supplier) => String(supplier.name || '').toLowerCase() === direct)?.id || '';
  }

  supplierNameFromId(id: string): string {
    if (!id) return '-';
    return this.suppliers().find((supplier) => supplier.id === id)?.name || id;
  }

  productVendorScore(product: ApiRecord): string {
    const supplierId = this.productVendorId(product);
    if (!supplierId) return '-';
    const row = ((this.intelligence()?.['supplierScorecards'] || []) as ApiRecord[]).find((item) => item.id === supplierId);
    return `${Math.round(Number(row?.reliabilityScore || 85))}`;
  }

  productVendorLastPurchase(product: ApiRecord): string {
    const supplierId = this.productVendorId(product);
    const row = this.transactions()
      .filter((item) => item.supplierId === supplierId && String(item.type || '').includes('purchase'))
      .slice()
      .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))[0];
    return row?.createdAt ? new Date(row.createdAt).toLocaleDateString() : 'No purchase yet';
  }

  productVendorPurchaseValue(product: ApiRecord): number {
    const supplierId = this.productVendorId(product);
    return this.transactions()
      .filter((row) => row.supplierId === supplierId && String(row.type || '').includes('purchase'))
      .reduce((total, row) => total + Math.abs(Number(row.totalCost || 0)), 0);
  }

  batchesForProduct(productId: string): ApiRecord[] {
    return this.batches().filter((batch) => batch.productId === productId);
  }

  nearestExpiry(productId: string): string {
    const expiry = this.batchesForProduct(productId)
      .filter((batch) => Number(batch.quantityAvailable || 0) > 0 && batch.expiryDate)
      .map((batch) => String(batch.expiryDate))
      .sort()[0];
    return expiry || this.product()?.expiryDate || 'not set';
  }

  productSaleUsage(productId: string): number {
    return Math.abs(this.transactions()
      .filter((row) => row.productId === productId && String(row.type || '').includes('sale'))
      .reduce((total, row) => total + Number(row.quantity || 0), 0));
  }

  productServiceUsage(productId: string): number {
    return Math.abs(this.transactions()
      .filter((row) => row.productId === productId && String(row.type || '').includes('service'))
      .reduce((total, row) => total + Number(row.quantity || 0), 0));
  }

  productReorderSignal(product: ApiRecord): string {
    const signal = ((this.intelligence()?.['suggestions'] || []) as ApiRecord[]).find((item) => item.productId === product.id || item.id === product.id);
    return signal ? `${signal.recommendedQty || 0} units - ${signal.priority || 'normal'}` : 'No reorder signal';
  }

  productAuditRisk(productId: string): string {
    const waste = this.transactions().some((row) => row.productId === productId && `${row.type || ''} ${row.reason || ''}`.toLowerCase().match(/waste|expiry|damaged|spillage/));
    if (waste) return 'waste variance';
    const item = this.product();
    if (item && this.productMargin(item) <= 0) return 'margin leakage';
    return 'No active risk';
  }
}
