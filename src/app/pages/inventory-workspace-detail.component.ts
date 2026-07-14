import { CommonModule } from '@angular/common';
import { Component, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { ApiRecord, ApiService } from '../core/api.service';
import { InventoryZenotiChromeComponent } from '../shared/ui/inventory-zenoti-chrome/inventory-zenoti-chrome.component';
import { StateComponent } from '../shared/ui/state/state.component';
import { AuraMoneyPipe } from '../shared/pipes/aura-money.pipe';

type InventoryWorkspaceMode = 'vendors' | 'stock' | 'procurement';

@Component({
  selector: 'app-inventory-workspace-detail',
  standalone: true,
  imports: [AuraMoneyPipe, CommonModule, FormsModule, InventoryZenotiChromeComponent, StateComponent],
  template: `
    <section class="page-stack inventory-detail-page inner-page-shell">
      <app-inventory-zenoti-chrome
        [title]="pageTitle()"
        [breadcrumb]="eyebrow()"
        (refresh)="load()"
      ></app-inventory-zenoti-chrome>

      <app-state [loading]="loading()" [error]="error()"></app-state>

      <section class="panel detail-shell inner-page-card" [ngSwitch]="workspace()">
        <ng-container *ngSwitchCase="'vendors'">
          <div class="detail-title">
            <div>
              <h2>Manage Vendors</h2>
            </div>
          </div>
          <div class="filter-bar compact inner-action-bar">
            <label>
              <span>Status</span>
              <select [(ngModel)]="vendorStatusFilter">
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
                <option value="">All status</option>
              </select>
            </label>
            <label class="wide">
              <span>Search by vendor / code</span>
              <input [(ngModel)]="vendorQuery" />
            </label>
          </div>
          <div class="table-wrap inner-table-wrap">
            <table>
              <thead><tr><th>Code</th><th>Name</th><th class="address-column">Address</th><th>Phone</th><th>Email</th><th>Score</th><th>Purchase value</th><th>Last purchase</th></tr></thead>
              <tbody>
                <tr *ngFor="let supplier of filteredVendorRows()">
                  <td>{{ supplier.code || supplier.id }}</td>
                  <td><strong>{{ supplier.name }}</strong><small>{{ supplier.gstin || 'GSTIN not set' }}</small></td>
                  <td class="address-column"><span>{{ supplier.address || '-' }}</span></td>
                  <td>{{ supplier.phone || '-' }}</td>
                  <td>{{ supplier.email || '-' }}</td>
                  <td>{{ supplierScore(supplier.id) }}</td>
                  <td>{{ supplierPurchaseValue(supplier.id) | auraMoney:'1.0-0' }}</td>
                  <td>{{ supplierLastPurchase(supplier.id) }}</td>
                </tr>
                <tr *ngIf="!filteredVendorRows().length"><td colspan="8" class="empty-cell">No vendors match these filters.</td></tr>
              </tbody>
            </table>
          </div>
        </ng-container>

        <ng-container *ngSwitchCase="'stock'">
          <div class="detail-title">
            <div>
              <h2>Current Stock</h2>
            </div>
          </div>
          <div class="filter-bar inner-form-grid">
            <label>
              <span>Center</span>
              <select [(ngModel)]="stockCenterFilter">
                <option value="">All centers</option>
                <option *ngFor="let branch of branches()" [value]="branch.id">{{ branch.name }}</option>
              </select>
            </label>
            <label>
              <span>Category</span>
              <select [(ngModel)]="stockCategoryFilter">
                <option value="">All categories</option>
                <option *ngFor="let category of productCategories()" [value]="category">{{ category }}</option>
              </select>
            </label>
            <label>
              <span>Vendor</span>
              <select [(ngModel)]="stockVendorFilter">
                <option value="">All vendors</option>
                <option *ngFor="let vendor of productVendors()" [value]="vendor">{{ vendor }}</option>
              </select>
            </label>
          </div>
          <div class="table-wrap inner-table-wrap">
            <table>
              <thead><tr><th>Product</th><th>Qty</th><th>Stock cost</th><th>Last price</th><th>Business unit</th><th>Purchase price</th><th>Avg price</th><th>Vendor</th></tr></thead>
              <tbody>
                <tr *ngFor="let row of filteredCurrentStockRows()">
                  <td><strong>{{ row.name }}</strong><small>{{ row.code }}</small></td>
                  <td>{{ row.quantity }}</td>
                  <td>{{ row.stockCost | auraMoney:'1.0-0' }}</td>
                  <td>{{ row.lastPrice | auraMoney:'1.0-0' }}</td>
                  <td>{{ row.businessUnit }}</td>
                  <td>{{ row.purchasePrice | auraMoney:'1.0-0' }}</td>
                  <td>{{ row.averagePrice | auraMoney:'1.0-0' }}</td>
                  <td>{{ row.vendor }}</td>
                </tr>
                <tr class="total-row">
                  <td>Total</td>
                  <td>{{ stockReportTotals().quantity }}</td>
                  <td>{{ stockReportTotals().stockCost | auraMoney:'1.0-0' }}</td>
                  <td colspan="5">{{ filteredCurrentStockRows().length }} row(s)</td>
                </tr>
              </tbody>
            </table>
          </div>
        </ng-container>

        <ng-container *ngSwitchDefault>
          <div class="detail-title">
            <div>
              <h2>Manage Procurement</h2>
            </div>
          </div>
          <div class="filter-bar">
            <label>
              <span>Report name</span>
              <select [(ngModel)]="procurementReportFilter">
                <option value="">Procurement list</option>
                <option value="purchase">Purchase order</option>
                <option value="transfer">Transfer order</option>
              </select>
            </label>
            <label>
              <span>Order status</span>
              <select [(ngModel)]="procurementStatusFilter">
                <option value="">All status</option>
                <option value="draft">Draft</option>
                <option value="open">Open</option>
                <option value="received">Received</option>
                <option value="cancelled">Cancelled</option>
              </select>
            </label>
            <label>
              <span>Date</span>
              <select [(ngModel)]="procurementDateFilter">
                <option value="">All dates</option>
                <option value="30">Last 30 days</option>
                <option value="90">Last 90 days</option>
                <option value="180">Last 180 days</option>
              </select>
            </label>
            <label class="wide">
              <span>Search</span>
              <input [(ngModel)]="procurementQuery" placeholder="Search reference, product, vendor" />
            </label>
          </div>
          <div class="table-wrap">
            <table>
              <thead>
                <tr><th>Reference no.</th><th>Order on</th><th>Deliver on</th><th>To center</th><th>From center/vendor</th><th>Status</th><th>Qty</th><th>Value</th><th>Tax</th><th>Notes</th></tr>
              </thead>
              <tbody>
                <tr *ngFor="let row of filteredProcurementRows()">
                  <td><strong>{{ row.referenceNo }}</strong><small>{{ row.orderType }}</small></td>
                  <td>{{ row.orderedOn || '-' }}</td>
                  <td>{{ row.deliverOn || '-' }}</td>
                  <td>{{ row.toCenter }}</td>
                  <td>{{ row.fromCenter }}</td>
                  <td><span class="badge">{{ row.status }}</span></td>
                  <td>{{ row.quantity }}</td>
                  <td>{{ row.value | auraMoney:'1.0-0' }}</td>
                  <td>{{ row.tax | auraMoney:'1.0-0' }}</td>
                  <td>{{ row.notes }}</td>
                </tr>
                <tr *ngIf="!filteredProcurementRows().length">
                  <td colspan="10" class="empty-cell">No procurement rows yet. Purchase entries and purchase orders will appear here.</td>
                </tr>
              </tbody>
            </table>
          </div>
        </ng-container>
      </section>
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

    .detail-shell {
      padding: 14px;
      border-radius: 8px;
      overflow: hidden;
    }

    .detail-title {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding-bottom: 12px;
      border-bottom: 1px solid var(--line);
      margin-bottom: 12px;
    }

    .detail-title h2 {
      margin: 0;
      color: var(--ink);
      font-size: 1.08rem;
      line-height: 1.2;
    }

    .filter-bar {
      display: grid;
      grid-template-columns: repeat(3, minmax(150px, 1fr)) minmax(260px, 1.4fr);
      gap: 10px;
      align-items: end;
      margin-bottom: 12px;
    }

    .filter-bar.compact {
      grid-template-columns: minmax(150px, 0.5fr) minmax(260px, 1.5fr);
    }

    .filter-bar label {
      display: grid;
      gap: 4px;
      min-width: 0;
    }

    .filter-bar span {
      color: var(--muted);
      font-size: 0.68rem;
      font-weight: 900;
      text-transform: uppercase;
    }

    .filter-bar select,
    .filter-bar input {
      width: 100%;
      min-height: 36px;
      border: 1px solid var(--line);
      border-radius: 6px;
      background: #fff;
      color: var(--ink);
      padding: 7px 9px;
      font: inherit;
      font-size: 0.86rem;
    }

    .table-wrap {
      max-height: 620px;
      overflow: auto;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: #fff;
    }

    table {
      width: 100%;
      min-width: 980px;
      border-collapse: collapse;
    }

    th,
    td {
      padding: 10px 12px;
      border-bottom: 1px solid var(--line);
      text-align: left;
      vertical-align: top;
      font-size: 0.82rem;
      white-space: nowrap;
    }

    th {
      position: sticky;
      top: 0;
      z-index: 2;
      background: #f7fbfa;
      color: var(--muted);
      font-size: 0.68rem;
      font-weight: 900;
      text-transform: uppercase;
    }

    .address-column {
      width: 34%;
      min-width: 280px;
      max-width: 460px;
      white-space: normal !important;
      line-height: 1.35;
    }

    td.address-column span {
      display: -webkit-box;
      overflow: hidden;
      -webkit-line-clamp: 3;
      -webkit-box-orient: vertical;
      overflow-wrap: anywhere;
      white-space: normal;
    }

    td strong,
    td small {
      display: block;
    }

    td small {
      color: var(--muted);
      margin-top: 3px;
      font-size: 0.72rem;
      font-weight: 800;
    }

    .total-row td {
      position: sticky;
      bottom: 0;
      background: #f7fbfa;
      font-weight: 900;
    }

    .empty-cell {
      color: var(--muted);
      text-align: center !important;
      white-space: normal !important;
    }

    @media (max-width: 920px) {
      .filter-bar,
      .filter-bar.compact {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }
    }

    @media (max-width: 640px) {
      .compact-hero {
        align-items: stretch;
      }

      .hero-actions {
        justify-content: flex-start;
      }

      .filter-bar,
      .filter-bar.compact {
        grid-template-columns: 1fr;
      }
    }
  `]
})
export class InventoryWorkspaceDetailComponent implements OnInit {
  readonly workspace = signal<InventoryWorkspaceMode>('vendors');
  readonly loading = signal(true);
  readonly error = signal('');
  readonly products = signal<ApiRecord[]>([]);
  readonly suppliers = signal<ApiRecord[]>([]);
  readonly branches = signal<ApiRecord[]>([]);
  readonly batches = signal<ApiRecord[]>([]);
  readonly transactions = signal<ApiRecord[]>([]);
  readonly purchaseOrders = signal<ApiRecord[]>([]);
  readonly intelligence = signal<ApiRecord | null>(null);

  vendorStatusFilter = 'active';
  vendorQuery = '';
  stockCenterFilter = '';
  stockCategoryFilter = '';
  stockVendorFilter = '';
  procurementReportFilter = '';
  procurementStatusFilter = '';
  procurementDateFilter = '';
  procurementQuery = '';

  constructor(private readonly api: ApiService, private readonly route: ActivatedRoute) {}

  ngOnInit(): void {
    this.workspace.set((this.route.snapshot.data['workspace'] as InventoryWorkspaceMode) || 'vendors');
    this.load();
  }

  async load(): Promise<void> {
    this.loading.set(true);
    try {
      const [products, suppliers, branches, batches, transactions, intelligence, purchaseOrders] = await Promise.all([
        firstValueFrom(this.api.list<ApiRecord[]>('products', { branchId: this.api.selectedBranchId(), limit: 10000 })),
        firstValueFrom(this.api.list<ApiRecord[]>('suppliers')),
        firstValueFrom(this.api.list<ApiRecord[]>('branches')),
        firstValueFrom(this.api.list<ApiRecord[]>('inventoryBatches', { branchId: this.api.selectedBranchId(), limit: 1000 })),
        firstValueFrom(this.api.list<ApiRecord[]>('inventory', { branchId: this.api.selectedBranchId(), limit: 1000 })),
        firstValueFrom(this.api.list<ApiRecord>('inventory-intelligence/summary', { branchId: this.api.selectedBranchId() })),
        firstValueFrom(this.api.list<ApiRecord[]>('inventory-intelligence/purchase-orders', { branchId: this.api.selectedBranchId(), limit: 100 })).catch(() => [])
      ]);
      this.products.set(products || []);
      this.suppliers.set(suppliers || []);
      this.branches.set(branches || []);
      this.batches.set(batches || []);
      this.transactions.set(transactions || []);
      this.intelligence.set(intelligence || null);
      this.purchaseOrders.set(purchaseOrders || []);
    } catch (error: any) {
      this.error.set(error?.error?.error || 'Unable to load inventory workspace');
    } finally {
      this.loading.set(false);
    }
  }

  eyebrow(): string {
    if (this.workspace() === 'stock') return 'Inventory - Reports';
    if (this.workspace() === 'procurement') return 'Inventory - Procurement';
    return 'Inventory - Vendors';
  }

  pageTitle(): string {
    if (this.workspace() === 'stock') return 'Current Stock';
    if (this.workspace() === 'procurement') return 'Manage Procurement';
    return 'Manage Vendors';
  }

  pageSubtitle(): string {
    if (this.workspace() === 'stock') return 'Center, category and vendor wise current stock with value totals.';
    if (this.workspace() === 'procurement') return 'Purchase entries, purchase orders and transfer style procurement rows.';
    return 'Vendor register with contact, GST, purchase value and reliability signals.';
  }

  filteredVendorRows(): ApiRecord[] {
    const query = this.vendorQuery.trim().toLowerCase();
    return this.suppliers().filter((supplier) => {
      const status = String(supplier.status || 'active').toLowerCase();
      const matchesStatus = !this.vendorStatusFilter || status === this.vendorStatusFilter;
      const matchesQuery = !query || JSON.stringify(supplier).toLowerCase().includes(query);
      return matchesStatus && matchesQuery;
    });
  }

  supplierScore(id: string): number {
    const row = ((this.intelligence()?.['supplierScorecards'] || []) as ApiRecord[]).find((item) => item.id === id);
    if (row) return Math.round(Number(row.reliabilityScore || 0));
    return Math.max(55, 96 - this.supplierQualityIssues(id).length * 8);
  }

  supplierPurchaseValue(id: string): number {
    return this.transactions()
      .filter((row) => row.supplierId === id && String(row.type || '').includes('purchase'))
      .reduce((total, row) => total + Math.abs(Number(row.totalCost || 0)), 0);
  }

  supplierLastPurchase(id: string): string {
    const row = this.transactions()
      .filter((item) => item.supplierId === id && String(item.type || '').includes('purchase'))
      .slice()
      .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))[0];
    return row?.createdAt ? new Date(row.createdAt).toLocaleDateString() : 'No purchase yet';
  }

  supplierQualityIssues(id: string): ApiRecord[] {
    const productIds = new Set(this.batches().filter((batch) => batch.supplierId === id).map((batch) => batch.productId));
    return this.transactions().filter((row) => {
      const text = `${row.type || ''} ${row.reason || ''}`.toLowerCase();
      return (row.supplierId === id || productIds.has(row.productId)) && /waste|expiry|damaged|spillage/.test(text);
    });
  }

  currentStockRows(): ApiRecord[] {
    return this.products().map((product) => {
      const quantity = Number(product.stock || 0);
      const purchasePrice = Number(product.unitCost || 0);
      const lastPrice = Number(product.price || product.unitCost || 0);
      return {
        id: product.id,
        code: this.productCode(product),
        name: product.name,
        branchId: product.branchId,
        category: product.category,
        vendor: this.productVendorName(product),
        businessUnit: this.productBusinessUnit(product),
        quantity,
        stockCost: quantity * purchasePrice,
        lastPrice,
        purchasePrice,
        averagePrice: purchasePrice || lastPrice
      };
    });
  }

  filteredCurrentStockRows(): ApiRecord[] {
    return this.currentStockRows().filter((row) =>
      (!this.stockCenterFilter || row.branchId === this.stockCenterFilter)
      && (!this.stockCategoryFilter || String(row.category || '').toLowerCase() === this.stockCategoryFilter.toLowerCase())
      && (!this.stockVendorFilter || String(row.vendor || '').toLowerCase() === this.stockVendorFilter.toLowerCase())
    );
  }

  stockReportTotals(): ApiRecord {
    return this.filteredCurrentStockRows().reduce((totals, row) => ({
      quantity: Number(totals.quantity || 0) + Number(row.quantity || 0),
      stockCost: Number(totals.stockCost || 0) + Number(row.stockCost || 0)
    }), { quantity: 0, stockCost: 0 });
  }

  procurementRows(): ApiRecord[] {
    if (this.purchaseOrders().length) {
      return this.purchaseOrders().map((order, index) => {
        const items = Array.isArray(order.items) ? order.items as ApiRecord[] : [];
        const quantity = Number(order.quantity || order.totalQuantity || items.reduce((sum, item) => sum + Number(item.quantity || 0), 0));
        const value = Number(order.value || order.totalAmount || order.totalCost || items.reduce((sum, item) => sum + Number(item.totalCost || item.amount || 0), 0));
        return {
          referenceNo: order.referenceNo || order.poNumber || order.orderNumber || order.id || `PO-${index + 1}`,
          orderType: order.orderType || 'purchase',
          orderedOn: String(order.orderedOn || order.orderDate || order.createdAt || '').slice(0, 10),
          deliverOn: String(order.deliverOn || order.deliveryDate || order.expectedDeliveryDate || '').slice(0, 10),
          toCenter: this.branchName(order.branchId || order.toBranchId || this.api.selectedBranchId()),
          fromCenter: order.vendorName || order.supplierName || this.supplierNameFromId(order.supplierId || ''),
          status: String(order.status || 'open').toLowerCase(),
          quantity,
          value,
          tax: Number(order.tax || order.taxAmount || order.gstAmount || 0),
          notes: order.notes || order.reason || '-',
          searchText: JSON.stringify(order).toLowerCase()
        };
      });
    }
    return this.purchaseTransactions().map((transaction, index) => ({
      referenceNo: transaction.referenceNo || transaction.invoiceNo || transaction.id || `PUR-${index + 1}`,
      orderType: 'purchase',
      orderedOn: String(transaction.createdAt || '').slice(0, 10),
      deliverOn: String(transaction.deliveryDate || transaction.createdAt || '').slice(0, 10),
      toCenter: this.branchName(transaction.branchId || this.api.selectedBranchId()),
      fromCenter: transaction.supplierName || this.supplierNameFromId(transaction.supplierId || ''),
      status: String(transaction.status || 'received').toLowerCase(),
      quantity: Math.abs(Number(transaction.quantity || 0)),
      value: Math.abs(Number(transaction.totalCost || 0)),
      tax: Math.abs(Number(transaction.tax || transaction.gstAmount || 0)),
      notes: transaction.reason || this.productName(transaction.productId),
      searchText: JSON.stringify(transaction).toLowerCase()
    }));
  }

  filteredProcurementRows(): ApiRecord[] {
    const query = this.procurementQuery.trim().toLowerCase();
    const dayLimit = Number(this.procurementDateFilter || 0);
    return this.procurementRows().filter((row) => {
      const matchesType = !this.procurementReportFilter || String(row.orderType || '').toLowerCase().includes(this.procurementReportFilter);
      const matchesStatus = !this.procurementStatusFilter || String(row.status || '').toLowerCase() === this.procurementStatusFilter;
      const matchesQuery = !query || String(row.searchText || JSON.stringify(row)).toLowerCase().includes(query);
      const rowDate = new Date(row.orderedOn || '').getTime();
      const matchesDate = !dayLimit || (!Number.isNaN(rowDate) && (Date.now() - rowDate) / 86400000 <= dayLimit);
      return matchesType && matchesStatus && matchesQuery && matchesDate;
    });
  }

  purchaseTransactions(): ApiRecord[] {
    return this.transactions().filter((row) => String(row.type || '').includes('purchase'));
  }

  productCategories(): string[] {
    return this.uniqueValues(this.products().map((product) => product.category));
  }

  productVendors(): string[] {
    return this.uniqueValues(this.products().map((product) => this.productVendorName(product)).filter((value) => value !== '-'));
  }

  productCode(product: ApiRecord): string {
    return String(product.code || product.productCode || product.sku || product.id || '-');
  }

  productBusinessUnit(product: ApiRecord): string {
    return String(product.businessUnit || product.category || product.usageType || 'Inventory');
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

  productName(id: string): string {
    return this.products().find((product) => product.id === id)?.name || id;
  }

  branchName(id: string): string {
    return this.branches().find((branch) => branch.id === id)?.name || id || 'All branches';
  }

  private uniqueValues(values: unknown[]): string[] {
    return Array.from(new Set(values.map((value) => String(value || '').trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b));
  }
}
