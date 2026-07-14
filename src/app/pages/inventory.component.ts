import { CommonModule } from '@angular/common';
import { Component, OnInit, computed, signal } from '@angular/core';
import { FormsModule, ReactiveFormsModule, UntypedFormBuilder, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { AuthSessionService } from '../core/auth-session.service';
import { grantsAllow, staticGrantsForRole } from '../core/permission.guard';
import { routePermissionForPath } from '../core/access-rules';
import { AppStateService } from '../core/state/app-state.service';
import { ApiRecord, ApiService } from '../core/api.service';
import { StateComponent } from '../shared/ui/state/state.component';
import { AuraMoneyPipe } from '../shared/pipes/aura-money.pipe';

type InventoryDesk = '' | 'stock' | 'product' | 'supplier' | 'batch' | 'waste';

@Component({
  selector: 'app-inventory',
  standalone: true,
  imports: [AuraMoneyPipe, CommonModule, FormsModule, ReactiveFormsModule, RouterLink, StateComponent],
  template: `
    <section class="page-stack inventory-shell zenoti-inventory-shell inner-page-shell">
      <section class="zenoti-product-page">
        <app-state [loading]="loading()" [error]="error()"></app-state>

        <div class="inventory-control-tower inner-page-header">
          <div>
            <strong>Inventory control tower</strong>
            <span>Stock, FIFO, reorder, wastage and profit linkage</span>
          </div>
          <div class="tower-score">
            <b>{{ inventoryReadinessScore() }}%</b>
            <span>{{ reorderReadinessLabel() }}</span>
          </div>
          <nav class="tower-links" aria-label="Inventory control shortcuts">
            <a routerLink="/inventory/reorder">AI reorder</a>
            <a routerLink="/inventory/fifo">FIFO / expiry</a>
            <a routerLink="/inventory/recipes">Service recipes</a>
            <a routerLink="/inventory/stock-audit">Stock audit</a>
            <a routerLink="/inventory/product-consume">Product consume</a>
            <a routerLink="/inventory/reports">Supplier orders</a>
            <a routerLink="/inventory/financial">Profit link</a>
            <a routerLink="/pos" *ngIf="canAccessPath('/pos')">POS</a>
          </nav>
        </div>

        <div class="zenoti-page-heading">
          <div>
            <h1>Manage products</h1>
            <p><a routerLink="/inventory">Inventory</a> &gt; Manage Products</p>
          </div>
          <label class="zenoti-search">
            <span>Search products</span>
            <input [(ngModel)]="query" placeholder="Search products" />
          </label>
        </div>

        <div class="zenoti-filter-grid inner-form-grid">
          <label>
            <span>Categories</span>
            <select [(ngModel)]="productCategoryFilter">
              <option value="">All categories</option>
              <option *ngFor="let category of productCategories()" [value]="category">{{ category }}</option>
            </select>
          </label>
          <label>
            <span>Brands</span>
            <select [(ngModel)]="productBrandFilter">
              <option value="">All brands</option>
              <option *ngFor="let brand of productBrands()" [value]="brand">{{ brand }}</option>
            </select>
          </label>
          <label>
            <span>Vendors</span>
            <select [(ngModel)]="productVendorFilter">
              <option value="">All vendors</option>
              <option *ngFor="let vendor of productVendors()" [value]="vendor">{{ vendor }}</option>
            </select>
          </label>
          <label>
            <span>Status</span>
            <select [(ngModel)]="productStatusFilter">
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
              <option value="">All status</option>
            </select>
          </label>
          <label>
            <span>Product type</span>
            <select [(ngModel)]="productTypeFilter">
              <option value="">All types</option>
              <option *ngFor="let type of productTypes()" [value]="type">{{ type }}</option>
            </select>
          </label>
          <button class="zenoti-filter-button" type="button" (click)="resetInventoryFilters()">Filters</button>
        </div>

        <div class="zenoti-results-line">
          <div>
            <strong>{{ filteredProducts().length }}</strong>
            <span>Results</span>
            <em>Status: {{ productStatusLabel() }}</em>
          </div>
          <div class="zenoti-grid-actions inner-action-bar">
            <a class="zenoti-mini-button" routerLink="/inventory/reports">Reports</a>
            <a class="zenoti-mini-button" routerLink="/inventory/purchase-orders">Purchase Orders</a>
            <button class="zenoti-mini-button" type="button" (click)="openNewProductForm()">Add Product</button>
          </div>
        </div>

        <div class="zenoti-table-shell inner-table-wrap">
          <table class="zenoti-products-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>SKU / Info</th>
                <th>Brand</th>
                <th>Category</th>
                <th>Subcategory</th>
                <th>Business unit</th>
                <th>Type</th>
                <th>Sale price</th>
                <th>MRP</th>
                <th>Amount</th>
                <th>Vendor</th>
                <th>In use</th>
                <th>Status</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              <tr *ngFor="let product of filteredProducts()" (click)="selectInventoryProduct(product)" [class.active]="selectedProductId() === product.id">
                <td><button class="zenoti-link-button" type="button">{{ product.name }}</button><small>{{ product.category || productBusinessUnit(product) }}</small></td>
                <td><strong class="product-sku-code">{{ productCode(product) }}</strong><small>{{ productType(product) }} - {{ productAmount(product) }}</small></td>
                <td>{{ productBrand(product) }}</td>
                <td>{{ product.category || '-' }}</td>
                <td>{{ product.subcategory || product.subCategory || '-' }}</td>
                <td>{{ productBusinessUnit(product) }}</td>
                <td>{{ productType(product) }}</td>
                <td>{{ product.price | auraMoney:'1.0-0' }}</td>
                <td>{{ productMrp(product) | auraMoney:'1.0-0' }}</td>
                <td>{{ productAmount(product) }}</td>
                <td>{{ productVendorName(product) }}</td>
                <td>{{ productInUse(product) }}</td>
                <td><span class="zenoti-status-pill" [class.inactive]="productStatus(product) !== 'Active'">{{ productStatus(product) }}</span></td>
                <td class="zenoti-action-cell"><a class="zenoti-row-action" [routerLink]="['/inventory/products', product.id]" (click)="$event.stopPropagation()">View Details</a><button class="zenoti-row-action" type="button" (click)="openEditProductForm(product); $event.stopPropagation()">Manage</button></td>
              </tr>
              <tr *ngIf="!filteredProducts().length">
                <td colspan="14" class="empty-cell">No products match these filters.</td>
              </tr>
            </tbody>
          </table>
        </div>

        <div class="zenoti-table-footer">
          <span>1 to {{ filteredProducts().length }} of {{ filteredProducts().length }}</span>
          <span>Page 1 of 1</span>
        </div>

        <div class="zenoti-shortcuts">
          <a routerLink="/inventory/reorder">Reorder plan</a>
          <a [routerLink]="selectedProductId() ? ['/inventory/products', selectedProductId()] : ['/inventory']">Product 360</a>
          <a [routerLink]="selectedSupplierId() ? ['/suppliers', selectedSupplierId()] : ['/suppliers']">Supplier 360</a>
          <a routerLink="/inventory/recipes">Service Recipes</a>
          <a routerLink="/inventory/fifo">FIFO Batches</a>
          <a routerLink="/inventory/stock-audit">Stock Audit</a>
          <a routerLink="/inventory/scanner">Scanner</a>
          <a routerLink="/inventory/product-consume">Product Consume</a>
        </div>
      </section>

        <section class="panel operations-panel inner-page-card" *ngIf="activeDesk()">
        <div class="section-title">
          <div>
            <h2>{{ deskTitle() }}</h2>
          </div>
          <div class="section-actions">
            <small>{{ selectedProduct().name || 'New inventory entry' }}</small>
            <button class="ghost-button" type="button" (click)="activeDesk.set(''); quickAction = ''">Back To Search</button>
          </div>
        </div>
        <div class="desk-tabs">
          <button type="button" [class.active]="activeDesk() === 'stock'" (click)="activeDesk.set('stock')">Stock movement</button>
          <button type="button" [class.active]="activeDesk() === 'product'" (click)="openEditProductForm(selectedProduct())">Product setup</button>
          <button type="button" [class.active]="activeDesk() === 'batch'" (click)="activeDesk.set('batch')">Receive batch</button>
          <button type="button" [class.active]="activeDesk() === 'supplier'" (click)="activeDesk.set('supplier')">Supplier</button>
          <button type="button" [class.active]="activeDesk() === 'waste'" (click)="activeDesk.set('waste')">Waste / expiry</button>
        </div>

        <div class="desk-body" [ngSwitch]="activeDesk()">
          <form *ngSwitchCase="'stock'" [formGroup]="adjustForm" (ngSubmit)="adjustStock()" class="compact-form">
            <label class="field">
              <span>Product</span>
              <select formControlName="productId">
                <option value="">Select product</option>
                <option *ngFor="let product of products()" [value]="product.id">{{ product.name }} - {{ product.stock }} left</option>
              </select>
            </label>
            <label class="field">
              <span>Branch</span>
              <select formControlName="branchId">
                <option value="">Select branch</option>
                <option *ngFor="let branch of branches()" [value]="branch.id">{{ branch.name }}</option>
              </select>
            </label>
            <label class="field">
              <span>Type</span>
              <select formControlName="type">
                <option value="purchase-entry">Purchase entry</option>
                <option value="adjustment">Stock adjustment</option>
                <option value="expiry-writeoff">Expiry write-off</option>
              </select>
            </label>
            <label class="field"><span>Quantity (+/-)</span><input type="number" formControlName="quantity" /></label>
            <label class="field full"><span>Reason</span><textarea formControlName="reason"></textarea></label>
            <div class="form-actions">
              <button class="primary-button" type="submit" [disabled]="adjustForm.invalid || saving()">Apply stock movement</button>
            </div>
          </form>

          <form *ngSwitchCase="'product'" [formGroup]="productForm" (ngSubmit)="saveProduct()" class="compact-form">
            <label class="field"><span>Name</span><input formControlName="name" /></label>
            <label class="field"><span>SKU</span><input formControlName="sku" /></label>
            <label class="field"><span>Category</span><input formControlName="category" /></label>
            <label class="field">
              <span>Unit</span>
              <select formControlName="unit" (change)="syncProductPackDefaults()">
                <option value="ml">ml</option>
                <option value="gm">gm</option>
                <option value="g">g</option>
                <option value="kg">kg</option>
                <option value="l">l</option>
                <option value="pcs">pcs</option>
                <option value="tube">tube</option>
                <option value="bottle">bottle</option>
                <option value="jar">jar</option>
                <option value="can">can</option>
                <option value="tin">tin</option>
                <option value="pack">pack</option>
                <option value="box">box</option>
                <option value="nos">nos</option>
              </select>
            </label>
            <label class="field">
              <span>{{ productPackSizeLabel() }}</span>
              <input type="number" min="0" step="0.01" formControlName="packSize" [placeholder]="productPackSizePlaceholder()" />
            </label>
            <label class="field">
              <span>Consume unit</span>
              <select formControlName="packUnit">
                <option *ngFor="let unit of productPackUnitOptions()" [value]="unit">{{ unit }}</option>
              </select>
            </label>
            <div class="bulk-preview">
              <span>Bulk config</span>
              <strong>{{ productBulkPreview() }}</strong>
            </div>
            <label class="field">
              <span>Usage type</span>
              <select formControlName="usageType">
                <option value="retail">Retail</option>
                <option value="consumable">Consumable / professional</option>
                <option value="both">Retail + professional</option>
              </select>
            </label>
            <label class="field"><span>Supplier</span><input formControlName="supplier" /></label>
            <label class="field">
              <span>Branch</span>
              <select formControlName="branchId">
                <option value="">Select branch</option>
                <option *ngFor="let branch of branches()" [value]="branch.id">{{ branch.name }}</option>
              </select>
            </label>
            <label class="field"><span>Stock</span><input type="number" formControlName="stock" /></label>
            <label class="field"><span>Low stock threshold</span><input type="number" formControlName="lowStockThreshold" /></label>
            <label class="field"><span>Expiry date</span><input type="date" formControlName="expiryDate" /></label>
            <label class="field"><span>Unit cost</span><input type="number" formControlName="unitCost" /></label>
            <label class="field"><span>Retail price</span><input type="number" formControlName="price" /></label>
            <label class="field"><span>GST rate</span><input type="number" formControlName="gstRate" /></label>
            <label class="field laundry-check"><span>Laundry</span><input type="checkbox" formControlName="isLaundry" /></label>
            <label class="field"><span>Laundry Rate</span><input type="number" min="0" formControlName="laundryRate" /></label>
            <div class="form-actions">
              <button class="ghost-button" type="button" (click)="closeProductForm()">Cancel</button>
              <button class="primary-button" type="submit" [disabled]="productForm.invalid || saving()">{{ editingProductId() ? 'Update product' : 'Save product' }}</button>
            </div>
          </form>

          <form *ngSwitchCase="'batch'" [formGroup]="purchaseForm" (ngSubmit)="purchaseEntry()" class="compact-form">
            <label class="field">
              <span>Product</span>
              <select formControlName="productId">
                <option value="">Select product</option>
                <option *ngFor="let product of products()" [value]="product.id">{{ product.name }}</option>
              </select>
            </label>
            <label class="field">
              <span>Supplier</span>
              <select formControlName="supplierId">
                <option value="">No supplier</option>
                <option *ngFor="let supplier of suppliers()" [value]="supplier.id">{{ supplier.name }}</option>
              </select>
            </label>
            <label class="field">
              <span>Branch</span>
              <select formControlName="branchId">
                <option value="">Select branch</option>
                <option *ngFor="let branch of branches()" [value]="branch.id">{{ branch.name }}</option>
              </select>
            </label>
            <label class="field"><span>Batch number</span><input formControlName="batchNumber" /></label>
            <label class="field"><span>Expiry date</span><input type="date" formControlName="expiryDate" /></label>
            <label class="field"><span>Quantity</span><input type="number" formControlName="quantity" /></label>
            <label class="field"><span>Unit cost</span><input type="number" formControlName="unitCost" /></label>
            <div class="form-actions">
              <button class="primary-button" type="submit" [disabled]="purchaseForm.invalid || saving()">Receive batch</button>
            </div>
          </form>

          <form *ngSwitchCase="'supplier'" [formGroup]="supplierForm" (ngSubmit)="saveSupplier()" class="compact-form">
            <label class="field"><span>Name</span><input formControlName="name" /></label>
            <label class="field"><span>Contact</span><input formControlName="contactName" /></label>
            <label class="field"><span>Phone</span><input formControlName="phone" /></label>
            <label class="field"><span>Email</span><input type="email" formControlName="email" /></label>
            <label class="field"><span>GSTIN</span><input formControlName="gstin" /></label>
            <label class="field full"><span>Address</span><textarea formControlName="address"></textarea></label>
            <div class="form-actions">
              <a class="ghost-button" routerLink="/suppliers">Open supplier register</a>
              <button class="primary-button" type="submit" [disabled]="supplierForm.invalid || saving()">Save supplier</button>
            </div>
          </form>

          <form *ngSwitchCase="'waste'" [formGroup]="wasteForm" (ngSubmit)="recordWaste()" class="compact-form">
            <label class="field">
              <span>Product</span>
              <select formControlName="productId">
                <option value="">Select product</option>
                <option *ngFor="let product of products()" [value]="product.id">{{ product.name }}</option>
              </select>
            </label>
            <label class="field">
              <span>Batch</span>
              <select formControlName="batchId">
                <option value="">Auto / no batch</option>
                <option *ngFor="let batch of batchesForProduct(wasteForm.value.productId)" [value]="batch.id">{{ batch.batchNumber }} Â· {{ batch.quantityAvailable }} left</option>
              </select>
            </label>
            <label class="field">
              <span>Branch</span>
              <select formControlName="branchId">
                <option value="">Select branch</option>
                <option *ngFor="let branch of branches()" [value]="branch.id">{{ branch.name }}</option>
              </select>
            </label>
            <label class="field"><span>Quantity</span><input type="number" formControlName="quantity" /></label>
            <label class="field">
              <span>Reason</span>
              <select formControlName="reason">
                <option value="expired">Expired</option>
                <option value="damaged">Damaged</option>
                <option value="spillage">Spillage</option>
                <option value="service overuse">Service overuse</option>
              </select>
            </label>
            <label class="field full"><span>Notes</span><textarea formControlName="notes"></textarea></label>
            <div class="form-actions">
              <button class="primary-button" type="submit" [disabled]="wasteForm.invalid || saving()">Record waste</button>
            </div>
          </form>
        </div>
      </section>

    </section>
  `,
  styles: [`
    .inventory-shell {
      gap: 12px;
    }

    .inventory-hero {
      align-items: center;
      min-height: auto;
      padding: 12px 16px;
    }

    .inventory-hero h2 {
      font-size: 1.18rem;
      line-height: 1.2;
      margin-bottom: 4px;
    }

    .inventory-hero p {
      margin: 0;
      display: -webkit-box;
      overflow: hidden;
      -webkit-line-clamp: 1;
      -webkit-box-orient: vertical;
    }

    .hero-actions,
    .section-actions {
      display: flex;
      flex-wrap: wrap;
      justify-content: flex-end;
      gap: 8px;
    }

    .section-actions {
      align-items: center;
    }

    .inventory-kpis {
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 10px;
    }

    .inventory-command-board {
      display: grid;
      grid-template-columns: repeat(6, minmax(0, 1fr));
      gap: 10px;
    }

    .command-metric {
      min-height: 96px;
      padding: 14px;
      border: 1px solid var(--line);
      border-top: 4px solid #4B1238;
      border-radius: 8px;
      background: #fff;
      box-shadow: var(--shadow);
    }

    .command-metric span,
    .command-metric small {
      display: block;
      color: var(--muted);
      font-size: 0.76rem;
      font-weight: 800;
    }

    .command-metric strong {
      display: block;
      margin: 6px 0 3px;
      color: var(--ink);
      font-size: 1.3rem;
      line-height: 1;
    }

    .command-metric.amber { border-top-color: #b26b00; }
    .command-metric.red { border-top-color: #b42318; }
    .command-metric.blue { border-top-color: #8B5E7C; }
    .command-metric.purple { border-top-color: #6f3fc8; }
    .command-metric.black { border-top-color: #162033; }

    .inventory-module-launcher {
      overflow: hidden;
    }

    .inventory-module-launcher .section-title small {
      color: var(--muted);
      font-weight: 800;
    }

    .inventory-module-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
      gap: 12px;
    }

    .inventory-module-card {
      min-height: 132px;
      display: grid;
      align-content: space-between;
      gap: 10px;
      padding: 16px;
      border: 1px solid var(--line);
      border-top: 5px solid #4B1238;
      border-radius: 18px;
      background:
        radial-gradient(circle at top right, color-mix(in srgb, #4B1238 10%, transparent), transparent 42%),
        #fff;
      color: var(--ink);
      text-decoration: none;
      box-shadow: 0 16px 36px color-mix(in srgb, var(--ink) 6%, transparent);
      transition: transform .16s ease, box-shadow .16s ease, border-color .16s ease;
    }

    .inventory-module-card:hover {
      transform: translateY(-2px);
      border-color: color-mix(in srgb, #4B1238 35%, var(--line));
      box-shadow: 0 20px 44px color-mix(in srgb, var(--ink) 9%, transparent);
    }

    .inventory-module-card span,
    .inventory-module-card small {
      display: block;
      color: var(--muted);
      font-size: .78rem;
      font-weight: 900;
    }

    .inventory-module-card strong {
      display: block;
      font-size: 1.06rem;
      line-height: 1.25;
    }

    .inventory-module-card.blue { border-top-color: #8B5E7C; }
    .inventory-module-card.amber { border-top-color: #b26b00; }
    .inventory-module-card.green { border-top-color: #C87D4B; }
    .inventory-module-card.violet { border-top-color: #6f3fc8; }
    .inventory-module-card.red { border-top-color: #b42318; }
    .inventory-module-card.slate { border-top-color: #475569; }
    .inventory-module-card.black { border-top-color: #162033; }
    .inventory-module-card.orange { border-top-color: #d95f02; }

    .inventory-ai-grid {
      display: grid;
      grid-template-columns: minmax(0, 1.2fr) minmax(0, 1fr) minmax(0, 1fr);
      gap: 12px;
      align-items: start;
    }

    .lower-grid {
      grid-template-columns: repeat(3, minmax(0, 1fr));
    }

    .autopilot-panel,
    .product-360,
    .supplier-360,
    .pos-intelligence-panel {
      min-height: 100%;
    }

    .autopilot-list,
    .timeline,
    .upsell-strip {
      display: grid;
      gap: 8px;
    }

    .autopilot-list article,
    .timeline article,
    .upsell-strip article {
      display: flex;
      justify-content: space-between;
      gap: 12px;
      padding: 10px;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: var(--surface);
    }

    .autopilot-list strong,
    .autopilot-list span,
    .autopilot-list small,
    .timeline strong,
    .timeline span,
    .upsell-strip strong,
    .upsell-strip span {
      display: block;
    }

    .autopilot-list span,
    .autopilot-list small,
    .timeline span,
    .upsell-strip span {
      color: var(--muted);
      font-size: 0.78rem;
      line-height: 1.35;
    }

    .autopilot-list .right {
      min-width: 120px;
      text-align: right;
    }

    .mini-metrics {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 8px;
      margin-bottom: 10px;
    }

    .mini-metrics div,
    .detail-list div {
      padding: 9px;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: #fff;
    }

    .mini-metrics span,
    .detail-list span {
      display: block;
      color: var(--muted);
      font-size: 0.72rem;
      font-weight: 800;
    }

    .mini-metrics strong,
    .detail-list strong {
      display: block;
      margin-top: 4px;
      color: var(--ink);
      font-size: 0.95rem;
      line-height: 1.25;
    }

    .detail-list {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 8px;
      margin-bottom: 10px;
    }

    .inline-select {
      width: min(260px, 100%);
      min-height: 40px;
      padding: 8px 10px;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: #fff;
    }

    .inline-actions {
      display: flex;
      gap: 8px;
      align-items: center;
      justify-content: flex-end;
      flex-wrap: wrap;
    }

    .timeline.mini article {
      display: block;
    }

    .draft-note {
      margin: 8px 0 0;
      padding: 10px;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: #F8EEF4;
      color: var(--muted);
      line-height: 1.4;
    }

    .compact-table {
      overflow: auto;
      max-height: 270px;
    }

    .compact-table table {
      min-width: 620px;
    }

    .upsell-strip {
      grid-template-columns: repeat(5, minmax(0, 1fr));
    }

    .operations-panel,
    .product-panel,
    .side-summary {
      padding: 12px;
    }

    .operations-panel .section-title,
    .side-summary .section-title {
      align-items: center;
      margin-bottom: 10px;
      padding-bottom: 10px;
    }

    .desk-tabs {
      display: flex;
      gap: 8px;
      overflow-x: auto;
      padding-bottom: 8px;
      border-bottom: 1px solid var(--line);
    }

    .desk-tabs button {
      min-height: 34px;
      padding: 0 12px;
      border: 1px solid var(--line);
      border-radius: 999px;
      background: #fff;
      color: var(--muted);
      font-weight: 900;
      white-space: nowrap;
      cursor: pointer;
    }

    .desk-tabs button.active {
      border-color: #4B1238;
      background: #4B1238;
      color: #fff;
    }

    .desk-body {
      padding-top: 12px;
    }

    .desk-closed {
      display: grid;
      grid-template-columns: repeat(5, minmax(0, 1fr));
      gap: 10px;
      padding-top: 12px;
    }

    .desk-closed button {
      min-height: 68px;
      padding: 10px;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: var(--surface);
      text-align: left;
      cursor: pointer;
      transition: transform 0.15s ease, box-shadow 0.15s ease;
    }

    .desk-closed button:hover {
      transform: translateY(-1px);
      box-shadow: var(--shadow);
    }

    .desk-closed strong,
    .desk-closed span {
      display: block;
    }

    .desk-closed strong {
      margin-bottom: 3px;
      font-weight: 900;
      font-size: 0.9rem;
    }

    .desk-closed span {
      color: var(--muted);
      font-size: 0.78rem;
      line-height: 1.3;
    }

    .compact-form {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 10px;
      align-items: end;
    }

    .compact-form .full,
    .compact-form .form-actions {
      grid-column: span 2;
    }

    .bulk-preview {
      min-height: 58px;
      display: grid;
      align-content: center;
      gap: 3px;
      padding: 9px 10px;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: #f8fafc;
    }

    .bulk-preview span {
      color: var(--muted);
      font-size: 0.72rem;
      font-weight: 900;
    }

    .bulk-preview strong {
      color: var(--ink);
      font-size: 0.88rem;
      line-height: 1.25;
    }

    .compact-form textarea {
      min-height: 42px;
      resize: vertical;
    }

    .inventory-data-grid {
      display: grid;
      grid-template-columns: minmax(0, 1.7fr) minmax(320px, 0.8fr);
      gap: 14px;
      align-items: start;
    }

    .product-table {
      max-height: 292px;
      overflow: auto;
    }

    .product-table table {
      min-width: 760px;
    }

    .product-table thead th {
      position: sticky;
      top: 0;
      z-index: 2;
      background: #f6f8f8;
    }

    .compact-feed {
      max-height: 292px;
      overflow: auto;
      padding-right: 4px;
    }

    .compact-feed article {
      padding: 10px 0;
    }


    :host .page-stack,
    :host .inventory-page { background: #f8f5f2; }
    :host .module-hero,
    :host .panel,
    :host .metric-card,
    :host .inventory-card,
    :host .workspace-card,
    :host .table-wrap,
    :host .form-panel,
    :host .summary-card {
      border-color: rgba(118, 85, 76, 0.13) !important;
      border-radius: 14px !important;
      background: #fff !important;
      background-image: none !important;
      box-shadow: 0 1px 2px rgba(41, 31, 28, 0.03), 0 10px 26px rgba(73, 51, 43, 0.045) !important;
    }
    :host .metric-card,
    :host .inventory-card,
    :host .workspace-card { border-left: 3px solid rgba(154, 106, 96, 0.68) !important; }
    :host h1, :host h2, :host h3, :host .metric-card strong, :host .inventory-card strong { color: #302522 !important; font-weight: 630 !important; }
    :host .metric-card span, :host .section-title span, :host th, :host td small { color: #766763 !important; font-weight: 540 !important; }
    :host th { position: sticky; top: 0; z-index: 1; background: #faf7f4 !important; }
    :host td { border-bottom-color: rgba(118, 85, 76, 0.08) !important; }
    :host tbody tr:hover td { background: #fffaf7 !important; }
    :host .badge, :host .chip, :host .status-chip { border-radius: 999px !important; background: #fff7f3 !important; color: #75524b !important; }
    @media (max-width: 1180px) {
      .inventory-kpis,
      .inventory-command-board,
      .inventory-module-grid,
      .desk-closed,
      .compact-form,
      .inventory-ai-grid,
      .lower-grid,
      .inventory-data-grid {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }

      .inventory-data-grid {
        grid-template-columns: 1fr;
      }
    }

    @media (max-width: 760px) {
      .inventory-hero {
        align-items: stretch;
      }

      .inventory-kpis,
      .inventory-command-board,
      .desk-closed,
      .compact-form,
      .inventory-ai-grid,
      .lower-grid,
      .compact-form .full,
      .compact-form .form-actions {
        grid-template-columns: 1fr;
        grid-column: span 1;
      }

      .mini-metrics,
      .detail-list,
      .upsell-strip {
        grid-template-columns: 1fr;
      }
    }

    .zenoti-inventory-shell {
      gap: 10px;
      color: #20242a;
    }

    .zenoti-product-page {
      overflow: hidden;
      border: 1px solid #d7dee6;
      border-radius: 4px;
      background: #f0f2f5;
      box-shadow: none;
      gap: 8px;
      padding: 8px;
    }

    .inventory-control-tower {
      display: grid;
      grid-template-columns: minmax(220px, 1fr) auto minmax(360px, 1.7fr);
      gap: 12px;
      align-items: center;
      padding: 12px 14px;
      border: 1px solid #D4C0CF;
      background: #fff;
    }

    .inventory-control-tower strong {
      display: block;
      margin-bottom: 4px;
      color: #4B1238;
      font-size: 1.05rem;
      font-weight: 900;
    }

    .inventory-control-tower span {
      color: #526173;
      font-size: 0.8rem;
      font-weight: 700;
    }

    .tower-score {
      display: grid;
      min-width: 108px;
      padding: 8px 10px;
      border: 1px solid #E7DDD6;
      background: #F8EEF4;
      text-align: center;
    }

    .tower-score b {
      color: #4B1238;
      font-size: 1rem;
    }

    .tower-links {
      display: flex;
      flex-wrap: wrap;
      justify-content: flex-end;
      gap: 8px;
    }

    .tower-links a {
      min-height: 30px;
      padding: 6px 10px;
      border: 1px solid #D4C0CF;
      border-radius: 4px;
      background: #fff;
      color: #4B1238;
      font-size: 0.78rem;
      font-weight: 800;
      text-decoration: none;
    }

    .zenoti-center-bar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      min-height: 50px;
      padding: 10px 14px;
      border: 1px solid #e3e8ee;
      background: #fff;
    }

    .zenoti-center-bar strong {
      font-size: 1.02rem;
      font-weight: 800;
    }

    .zenoti-center-actions,
    .zenoti-grid-actions,
    .zenoti-shortcuts,
    .section-actions {
      display: flex;
      align-items: center;
      justify-content: flex-end;
      gap: 8px;
      flex-wrap: wrap;
    }

    .zenoti-mini-button,
    .zenoti-filter-button,
    .zenoti-row-action {
      min-height: 30px;
      padding: 6px 11px;
      border: 1px solid #D4C0CF;
      border-radius: 4px;
      background: #fff;
      color: #4B1238;
      font-size: 0.78rem;
      font-weight: 800;
      text-decoration: none;
      cursor: pointer;
    }

    .zenoti-filter-button {
      align-self: end;
      color: #4B1238;
      background: #F8EEF4;
    }

    .zenoti-action-select {
      min-width: 152px;
      min-height: 34px;
      padding: 6px 10px;
      border: 1px solid #cbd6e2;
      border-radius: 4px;
      background: #fff;
      color: #1f2933;
      font-weight: 700;
    }

    .zenoti-page-heading {
      display: flex;
      justify-content: space-between;
      gap: 18px;
      padding: 14px;
      border: 1px solid #e3e8ee;
      background: #fff;
    }

    .zenoti-page-heading h1 {
      margin: 0;
      font-size: 1.25rem;
      line-height: 1.2;
      font-weight: 900;
    }

    .zenoti-page-heading p {
      margin: 8px 0 0;
      color: #526173;
      font-size: 0.82rem;
    }

    .zenoti-page-heading a {
      color: #4B1238;
      text-decoration: none;
    }

    .zenoti-search {
      width: min(280px, 100%);
      align-self: center;
    }

    .zenoti-search span,
    .zenoti-filter-grid span,
    .compact-form .field span {
      display: block;
      margin-bottom: 3px;
      color: #697789;
      font-size: 0.72rem;
      font-weight: 800;
    }

    .zenoti-search input,
    .zenoti-filter-grid select,
    .compact-form input,
    .compact-form select,
    .compact-form textarea {
      width: 100%;
      min-height: 34px;
      padding: 6px 10px;
      border: 1px solid #cfd8e3;
      border-radius: 4px;
      background: #fff;
      color: #1f2933;
      font-size: 0.86rem;
    }

    .zenoti-filter-grid {
      display: grid;
      grid-template-columns: repeat(5, minmax(150px, 1fr)) auto;
      gap: 8px;
      padding: 12px 14px 8px;
      background: #fbfcfe;
      border: 1px solid #e3e8ee;
    }

    .zenoti-results-line {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 14px;
      padding: 8px 14px;
      border: 1px solid #e3e8ee;
      background: #fff;
    }

    .zenoti-results-line strong,
    .zenoti-results-line span {
      font-size: 0.84rem;
    }

    .zenoti-results-line em {
      display: inline-flex;
      margin-left: 8px;
      padding: 4px 10px;
      border: 1px solid #D4C0CF;
      border-radius: 999px;
      background: #F8EEF4;
      color: #8B5E7C;
      font-style: normal;
      font-size: 0.76rem;
      font-weight: 800;
    }

    .zenoti-table-shell {
      max-height: 560px;
      overflow: auto;
      border: 1px solid #d7dee6;
    }

    .zenoti-products-table {
      width: 100%;
      min-width: 1380px;
      border-collapse: collapse;
      font-size: 0.82rem;
    }

    .zenoti-products-table th,
    .zenoti-products-table td {
      padding: 9px 12px;
      border-bottom: 1px solid #e7ebef;
      text-align: left;
      vertical-align: middle;
      white-space: nowrap;
    }

    .zenoti-products-table th:first-child,
    .zenoti-products-table td:first-child {
      min-width: 280px;
      max-width: 360px;
      white-space: normal;
    }

    .zenoti-products-table td:first-child .zenoti-link-button {
      max-width: 100%;
      white-space: normal;
      line-height: 1.25;
      text-align: left;
    }

    .zenoti-products-table td:first-child small {
      max-width: 100%;
      white-space: normal;
    }

    .zenoti-products-table th {
      position: sticky;
      top: 0;
      z-index: 2;
      background: #FAF8F6;
      color: #566273;
      font-size: 0.74rem;
      font-weight: 900;
      text-transform: none;
    }

    .zenoti-products-table tr:hover td,
    .zenoti-products-table tr.active td {
      background: #F8EEF4;
    }

    .zenoti-products-table small {
      display: block;
      max-width: 260px;
      overflow: hidden;
      color: #64748b;
      text-overflow: ellipsis;
    }

    .product-sku-code {
      display: block;
      color: #1f2933;
      font-size: 0.82rem;
      font-weight: 800;
    }

    .zenoti-link-button {
      padding: 0;
      border: 0;
      background: transparent;
      color: #4B1238;
      font-weight: 900;
      cursor: pointer;
    }

    .zenoti-status-pill {
      display: inline-flex;
      min-width: 58px;
      justify-content: center;
      padding: 3px 8px;
      border-radius: 3px;
      background: #FBF0E8;
      color: #7A4A28;
      font-size: 0.76rem;
      font-weight: 800;
    }

    .zenoti-status-pill.inactive {
      background: #f2f4f7;
      color: #667085;
    }

    .zenoti-table-footer {
      display: flex;
      justify-content: flex-end;
      gap: 18px;
      padding: 9px 14px;
      color: #667085;
      font-size: 0.78rem;
      background: #fff;
    }

    .zenoti-shortcuts {
      justify-content: flex-start;
      padding: 10px 14px 14px;
      background: #fff;
    }

    .zenoti-shortcuts a {
      padding: 6px 10px;
      border: 1px solid #d2dbe5;
      border-radius: 4px;
      color: #4B1238;
      font-size: 0.78rem;
      font-weight: 800;
      text-decoration: none;
    }

    .operations-panel {
      padding: 0 18px 18px;
      border: 1px solid #d7dee6;
      border-radius: 4px;
      background: #fff;
      box-shadow: none;
    }

    .operations-panel .section-title {
      align-items: center;
      margin: 0;
      padding: 14px 0 12px;
      border-bottom: 1px solid #e3e8ee;
    }

    .operations-panel .section-title h2 {
      margin: 4px 0 0;
      font-size: 1.18rem;
    }

    .desk-tabs {
      display: flex;
      gap: 0;
      overflow-x: auto;
      padding-top: 14px;
      border-bottom: 1px solid #cfd8e3;
    }

    .desk-tabs button {
      min-height: 32px;
      padding: 6px 11px;
      border: 1px solid #cfd8e3;
      border-bottom: 0;
      border-radius: 0;
      background: #f7f9fc;
      color: #344054;
      font-weight: 800;
      white-space: nowrap;
      cursor: pointer;
    }

    .desk-tabs button.active {
      background: #fff;
      color: #101828;
    }

    .desk-body {
      padding-top: 0;
    }

    .compact-form {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 12px;
      padding: 16px;
      border: 1px solid #cfd8e3;
      border-top: 0;
      align-items: end;
    }

    .compact-form .full,
    .compact-form .form-actions {
      grid-column: span 2;
    }

    .compact-form .form-actions {
      display: flex;
      justify-content: flex-end;
      gap: 8px;
    }

    .bulk-preview {
      min-height: 52px;
      display: grid;
      align-content: center;
      gap: 3px;
      padding: 8px 10px;
      border: 1px solid #cfd8e3;
      border-radius: 4px;
      background: #f8fafc;
    }

    .bulk-preview span {
      color: #697789;
      font-size: 0.72rem;
      font-weight: 800;
    }

    .bulk-preview strong {
      color: #1f2933;
      font-size: 0.84rem;
      line-height: 1.25;
    }

    .empty-cell {
      padding: 28px 12px;
      color: #667085;
      text-align: center;
    }


    :host .page-stack,
    :host .inventory-page { background: #f8f5f2; }
    :host .module-hero,
    :host .panel,
    :host .metric-card,
    :host .inventory-card,
    :host .workspace-card,
    :host .table-wrap,
    :host .form-panel,
    :host .summary-card {
      border-color: rgba(118, 85, 76, 0.13) !important;
      border-radius: 14px !important;
      background: #fff !important;
      background-image: none !important;
      box-shadow: 0 1px 2px rgba(41, 31, 28, 0.03), 0 10px 26px rgba(73, 51, 43, 0.045) !important;
    }
    :host .metric-card,
    :host .inventory-card,
    :host .workspace-card { border-left: 3px solid rgba(154, 106, 96, 0.68) !important; }
    :host h1, :host h2, :host h3, :host .metric-card strong, :host .inventory-card strong { color: #302522 !important; font-weight: 630 !important; }
    :host .metric-card span, :host .section-title span, :host th, :host td small { color: #766763 !important; font-weight: 540 !important; }
    :host th { position: sticky; top: 0; z-index: 1; background: #faf7f4 !important; }
    :host td { border-bottom-color: rgba(118, 85, 76, 0.08) !important; }
    :host tbody tr:hover td { background: #fffaf7 !important; }
    :host .badge, :host .chip, :host .status-chip { border-radius: 999px !important; background: #fff7f3 !important; color: #75524b !important; }
    @media (max-width: 1180px) {
      .zenoti-center-bar,
      .zenoti-page-heading,
      .zenoti-results-line {
        align-items: stretch;
        flex-direction: column;
      }

      .zenoti-filter-grid {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }

      .zenoti-filter-button {
        width: fit-content;
      }

      .compact-form {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }
    }

    @media (max-width: 760px) {
      .zenoti-center-actions,
      .zenoti-grid-actions,
      .section-actions {
        justify-content: flex-start;
      }

      .zenoti-filter-grid,
      .compact-form,
      .compact-form .full,
      .compact-form .form-actions {
        grid-template-columns: 1fr;
        grid-column: span 1;
      }
    }
  `]
})
export class InventoryComponent implements OnInit {
  readonly products = signal<ApiRecord[]>([]);
  readonly transactions = signal<ApiRecord[]>([]);
  readonly branches = signal<ApiRecord[]>([]);
  readonly suppliers = signal<ApiRecord[]>([]);
  readonly batches = signal<ApiRecord[]>([]);
  readonly services = signal<ApiRecord[]>([]);
  readonly sales = signal<ApiRecord[]>([]);
  readonly allProducts = signal<ApiRecord[]>([]);
  readonly predictions = signal<ApiRecord[]>([]);
  readonly intelligence = signal<ApiRecord | null>(null);
  readonly loading = signal(true);
  readonly saving = signal(false);
  readonly error = signal('');
  readonly activeDesk = signal<InventoryDesk>('');
  readonly showProductForm = signal(false);
  readonly selectedProductId = signal('');
  readonly editingProductId = signal('');
  readonly selectedSupplierId = signal('');
  readonly supplierWhatsappDraft = signal('');
  readonly scannerResult = signal('');
  scannerCode = '';
  whatIfDemandPct = 20;
  query = '';
  quickAction = '';
  productCategoryFilter = '';
  productBrandFilter = '';
  productVendorFilter = '';
  productStatusFilter = 'active';
  productTypeFilter = '';

  readonly commandMetrics = computed(() => {
    const products = this.products();
    const transactions = this.transactions();
    const intelligence = this.intelligence();
    const lowStock = products.filter((product) => this.isLowStock(product));
    const deadStock = this.deadStockProducts();
    const expiryRisk = this.expiryRiskRows().length;
    const purchaseSpend = this.purchaseTransactions().reduce((sum, row) => sum + Math.abs(Number(row.totalCost || 0)), 0);
    const wasteCost = Number(intelligence?.['metrics']?.['wasteCost'] || this.wasteTransactions().reduce((sum, row) => sum + Math.abs(Number(row.totalCost || 0)), 0));
    const marginLeakage = this.stockAuditRows().reduce((sum, row) => sum + Math.max(0, Number(row.variance || 0)), 0) + wasteCost;
    return {
      products: products.length,
      stockValue: products.reduce((sum, product) => sum + this.stockValue(product), 0),
      lowStock: lowStock.length,
      deadStock: deadStock.length,
      expiryRisk,
      branchShortage: this.branchShortages().length,
      supplierPending: this.autopilotSuggestions().filter((item) => !String(item.supplier || '').trim()).length,
      purchaseSpend,
      wasteCost,
      marginLeakage,
      transactions: transactions.length
    };
  });

  readonly product360Link = computed(() => {
    const id = this.selectedProduct()?.id;
    return id ? `/inventory/products/${id}` : '/inventory';
  });

  readonly supplier360Link = computed(() => {
    const id = this.selectedSupplier()?.id;
    return id ? `/suppliers/${id}` : '/suppliers';
  });

  readonly inventoryReadinessScore = computed(() => {
    const metrics = this.commandMetrics();
    let score = 100;
    if (metrics.lowStock) score -= Math.min(24, metrics.lowStock * 6);
    if (metrics.expiryRisk) score -= Math.min(18, metrics.expiryRisk * 4);
    if (metrics.branchShortage) score -= Math.min(16, metrics.branchShortage * 4);
    if (!this.autopilotSuggestions().length) score -= 8;
    return Math.max(0, Math.min(100, score));
  });

  readonly reorderReadinessLabel = computed(() => {
    const score = this.inventoryReadinessScore();
    if (score >= 85) return 'Reorder ready';
    if (score >= 65) return 'Needs review';
    return 'Action needed';
  });

  readonly selectedProduct = computed(() => {
    const products = this.products();
    const id = this.selectedProductId() || this.autopilotSuggestions()[0]?.productId || products[0]?.id || '';
    return products.find((product) => product.id === id) || products[0] || null;
  });

  readonly selectedSupplier = computed(() => {
    const suppliers = this.suppliers();
    const id = this.selectedSupplierId() || suppliers[0]?.id || '';
    return suppliers.find((supplier) => supplier.id === id) || suppliers[0] || null;
  });

  readonly productBatches = computed(() => {
    const product = this.selectedProduct();
    return product ? this.batches().filter((batch) => batch.productId === product.id) : [];
  });

  readonly productMovements = computed(() => {
    const product = this.selectedProduct();
    return product ? this.transactions().filter((row) => row.productId === product.id).slice().sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || ''))) : [];
  });

  readonly productForm = this.fb.group({
    name: ['', Validators.required],
    sku: ['', Validators.required],
    category: [''],
    unit: ['pcs'],
    packSize: [''],
    packUnit: ['pcs'],
    usageType: ['retail'],
    supplier: [''],
    branchId: ['', Validators.required],
    stock: [0],
    lowStockThreshold: [5],
    expiryDate: [''],
    unitCost: [0],
    price: [0],
    gstRate: [18],
    isLaundry: [false],
    laundryRate: [0]
  });

  readonly adjustForm = this.fb.group({
    productId: ['', Validators.required],
    branchId: ['', Validators.required],
    type: ['purchase-entry'],
    quantity: [1, Validators.required],
    reason: ['Purchase entry']
  });

  readonly supplierForm = this.fb.group({
    name: ['', Validators.required],
    contactName: [''],
    phone: [''],
    email: [''],
    gstin: [''],
    address: ['']
  });

  readonly purchaseForm = this.fb.group({
    productId: ['', Validators.required],
    supplierId: [''],
    branchId: ['', Validators.required],
    batchNumber: [`BATCH-${new Date().toISOString().slice(0, 10)}`],
    expiryDate: [''],
    quantity: [1, Validators.required],
    unitCost: [0]
  });

  readonly wasteForm = this.fb.group({
    productId: ['', Validators.required],
    batchId: [''],
    branchId: ['', Validators.required],
    quantity: [1, Validators.required],
    reason: ['expired', Validators.required],
    notes: ['']
  });

  constructor(
    private readonly api: ApiService,
    private readonly fb: UntypedFormBuilder,
    private readonly state: AppStateService,
    private readonly session: AuthSessionService
  ) {}

  canAccessPath(path: string): boolean {
    const permission = routePermissionForPath(path);
    if (!permission || (Array.isArray(permission) && !permission.length)) return true;
    const permissions = Array.isArray(permission) ? permission : [permission];
    const dynamicGrants = this.session.currentUser()?.permissions || [];
    const grants = Array.from(new Set([...staticGrantsForRole(this.state.userRole()), ...dynamicGrants]));
    return permissions.some((item) => grantsAllow(grants, item));
  }

  private isLaundryProduct(product: ApiRecord): boolean {
    const local = this.localLaundryProduct(product.id);
    const merged = { ...product, ...local };
    return merged.isLaundry === true || merged.laundry === true || merged.laundryProduct === true;
  }

  private saveLocalLaundryProduct(productId: string, patch: ApiRecord): void {
    localStorage.setItem(
      `aura_laundry_product_${productId}`,
      JSON.stringify({
        isLaundry: Boolean(patch.isLaundry),
        laundry: Boolean(patch.isLaundry),
        laundryProduct: Boolean(patch.isLaundry),
        laundryRate: Math.max(0, Number(patch.laundryRate || 0))
      })
    );
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

  load(): void {
    this.loading.set(true);
    Promise.all([
      this.api.list<ApiRecord[]>('products', { branchId: this.api.selectedBranchId(), noLimit: true, noCache: true }).toPromise(),
      this.api.list<ApiRecord[]>('inventory', { branchId: this.api.selectedBranchId(), limit: 100 }).toPromise(),
      this.api.list<ApiRecord[]>('branches').toPromise(),
      this.api.list<ApiRecord[]>('suppliers').toPromise(),
      this.api.list<ApiRecord[]>('inventoryBatches', { branchId: this.api.selectedBranchId(), limit: 100 }).toPromise(),
      this.api.list<ApiRecord[]>('services', { limit: 500 }).toPromise()
    ])
      .then(([products, transactions, branches, suppliers, batches, services]) => {
        this.products.set(products || []);
        this.allProducts.set(products || []);
        this.transactions.set(transactions || []);
        this.branches.set(branches || []);
        this.suppliers.set(suppliers || []);
        this.batches.set(batches || []);
        this.services.set(services || []);
        if (!this.selectedProductId() && products?.[0]?.id) this.selectedProductId.set(products[0].id);
        if (!this.selectedSupplierId() && suppliers?.[0]?.id) this.selectedSupplierId.set(suppliers[0].id);
        this.loading.set(false);
        this.loadInventoryInsights();
      })
      .catch((error) => {
        this.error.set(error?.error?.error || 'Unable to load inventory');
        this.loading.set(false);
      });
  }

  private loadInventoryInsights(): void {
    Promise.all([
      this.api.list<ApiRecord[]>('products', { limit: 10000 }).toPromise(),
      this.api.list<ApiRecord[]>('sales', { branchId: this.api.selectedBranchId(), limit: 1000 }).toPromise(),
      this.api.list<ApiRecord[]>('inventory-intelligence/predictions', { limit: 5 }).toPromise(),
      this.api.list<ApiRecord>('inventory-intelligence/summary', { branchId: this.api.selectedBranchId() }).toPromise()
    ])
      .then(([allProducts, sales, predictions, intelligence]) => {
        if (allProducts?.length) this.allProducts.set(allProducts);
        this.sales.set(sales || []);
        this.predictions.set(predictions || []);
        this.intelligence.set(intelligence || null);
      })
      .catch(() => undefined);
  }

  saveProduct(): void {
    if (this.productForm.invalid) {
      this.productForm.markAllAsTouched();
      return;
    }
    this.saving.set(true);
    this.error.set('');
    const payload = {
      ...this.productForm.value,
      packSize: Math.max(0, Number(this.productForm.value.packSize || 0)),
      isLaundry: Boolean(this.productForm.value.isLaundry),
      laundry: Boolean(this.productForm.value.isLaundry),
      laundryProduct: Boolean(this.productForm.value.isLaundry),
      laundryRate: Math.max(0, Number(this.productForm.value.laundryRate || 0))
    };
    const editingId = this.editingProductId();
    const request = editingId
      ? this.api.update('products', editingId, payload)
      : this.api.create('products', payload);
    request.subscribe({
      next: (product) => {
        const productId = String(product?.id || editingId || '');
        if (productId) {
          this.selectedProductId.set(productId);
          this.saveLocalLaundryProduct(productId, payload);
        }
        this.saving.set(false);
        this.closeProductForm();
        this.load();
      },
      error: (error) => {
        this.error.set(this.api.errorText(error, editingId ? 'Unable to update product' : 'Unable to save product'));
        this.saving.set(false);
      }
    });
  }

  productBulkPreview(): string {
    const unit = String(this.productForm.value.unit || 'pcs').trim() || 'pcs';
    const packUnit = String(this.productForm.value.packUnit || unit).trim() || unit;
    const packSize = Number(this.productForm.value.packSize || 0);
    if (packSize > 0) {
      return `1 ${unit} = ${packSize} ${packUnit}`;
    }
    return this.productPackSizePlaceholder();
  }

  productPackSizeLabel(): string {
    const unit = this.productUnitValue();
    const packUnit = String(this.productForm.value.packUnit || this.defaultPackUnit(unit)).trim() || this.defaultPackUnit(unit);
    if (unit === 'ml') return 'Bottle ml';
    if (unit === 'gm' || unit === 'g') return 'Pack grams';
    if (unit === 'kg') return 'Pack kg';
    if (unit === 'l') return 'Bottle liter';
    if (['tube', 'bottle', 'jar', 'can', 'tin', 'pack', 'box'].includes(unit)) return `${this.titleCase(unit)} size (${packUnit})`;
    return 'Pack size';
  }

  productPackSizePlaceholder(): string {
    const unit = this.productUnitValue();
    const packUnit = String(this.productForm.value.packUnit || this.defaultPackUnit(unit)).trim() || this.defaultPackUnit(unit);
    if (unit === 'ml') return 'e.g. 400 ml';
    if (unit === 'gm' || unit === 'g') return 'e.g. 100 gm';
    if (unit === 'kg') return 'e.g. 1 kg';
    if (unit === 'l') return 'e.g. 1 l';
    if (unit === 'tube') return `e.g. 60 ${packUnit}`;
    if (unit === 'bottle') return `e.g. 400 ${packUnit}`;
    if (unit === 'jar') return `e.g. 250 ${packUnit}`;
    return `e.g. 1 ${packUnit}`;
  }

  productPackUnitOptions(): string[] {
    const unit = this.productUnitValue();
    if (unit === 'ml' || unit === 'l' || ['bottle', 'can'].includes(unit)) return ['ml', 'l'];
    if (unit === 'gm' || unit === 'g' || unit === 'kg' || ['tube', 'jar', 'tin'].includes(unit)) return ['gm', 'g', 'kg', 'ml'];
    if (unit === 'pcs' || unit === 'nos') return ['pcs', 'nos'];
    return ['pcs', 'ml', 'gm', 'g', 'kg', 'l'];
  }

  syncProductPackDefaults(): void {
    const unit = this.productUnitValue();
    const options = this.productPackUnitOptions();
    const currentPackUnit = String(this.productForm.value.packUnit || '').toLowerCase();
    const patch: Record<string, string | number> = {};
    if (!options.includes(currentPackUnit)) patch['packUnit'] = this.defaultPackUnit(unit);
    if (!Number(this.productForm.value.packSize || 0)) patch['packSize'] = '';
    if (Object.keys(patch).length) this.productForm.patchValue(patch, { emitEvent: false });
  }

  private productUnitValue(): string {
    return String(this.productForm.value.unit || 'pcs').toLowerCase().trim() || 'pcs';
  }

  private normalizedProductUsageType(product: ApiRecord): string {
    const value = String(product.usageType || product.productType || product.type || 'retail').toLowerCase();
    if (value.includes('both')) return 'both';
    if (value.includes('consumable') || value.includes('professional')) return 'consumable';
    return 'retail';
  }

  private defaultPackUnit(unit: string): string {
    if (unit === 'ml' || unit === 'l' || ['bottle', 'can'].includes(unit)) return 'ml';
    if (unit === 'gm' || unit === 'g' || unit === 'kg' || ['tube', 'jar', 'tin'].includes(unit)) return 'gm';
    return 'pcs';
  }

  private titleCase(value: string): string {
    return value ? value[0].toUpperCase() + value.slice(1) : value;
  }

  adjustStock(): void {
    if (this.adjustForm.invalid) return;
    this.saving.set(true);
    this.api.post('inventory/adjust', this.adjustForm.value).subscribe({
      next: () => {
        this.saving.set(false);
        this.load();
      },
      error: (error) => {
        this.error.set(error?.error?.error || 'Unable to adjust stock');
        this.saving.set(false);
      }
    });
  }

  saveSupplier(): void {
    if (this.supplierForm.invalid) return;
    this.saving.set(true);
    this.api.post('inventory-intelligence/suppliers', this.supplierForm.value).subscribe({
      next: () => {
        this.saving.set(false);
        this.supplierForm.reset({ name: '', contactName: '', phone: '', email: '', gstin: '', address: '' });
        this.load();
      },
      error: (error) => {
        this.error.set(error?.error?.error || 'Unable to save supplier');
        this.saving.set(false);
      }
    });
  }

  purchaseEntry(): void {
    if (this.purchaseForm.invalid) return;
    this.saving.set(true);
    this.api.post('inventory-intelligence/purchase-entry', this.purchaseForm.value).subscribe({
      next: () => {
        this.saving.set(false);
        this.load();
      },
      error: (error) => {
        this.error.set(error?.error?.error || 'Unable to receive batch');
        this.saving.set(false);
      }
    });
  }

  recordWaste(): void {
    if (this.wasteForm.invalid) return;
    this.saving.set(true);
    this.api.post('inventory-intelligence/waste', this.wasteForm.value).subscribe({
      next: () => {
        this.saving.set(false);
        this.load();
      },
      error: (error) => {
        this.error.set(error?.error?.error || 'Unable to record waste');
        this.saving.set(false);
      }
    });
  }

  runReorder(): void {
    this.saving.set(true);
    this.api.post('inventory-intelligence/reorder-suggestions/run', { branchId: this.api.selectedBranchId() }).subscribe({
      next: () => {
        this.saving.set(false);
        this.load();
      },
      error: (error) => {
        this.error.set(error?.error?.error || 'Unable to generate reorder suggestions');
        this.saving.set(false);
      }
    });
  }

  filteredProducts(): ApiRecord[] {
    const query = this.query.trim().toLowerCase();
    return this.products().filter((product) => {
      const status = this.productStatus(product).toLowerCase();
      const type = this.productType(product);
      const vendor = this.productVendorName(product);
      const brand = this.productBrand(product);
      const text = JSON.stringify(product).toLowerCase();
      return (!query || text.includes(query) || vendor.toLowerCase().includes(query))
        && (!this.productCategoryFilter || String(product.category || '').toLowerCase() === this.productCategoryFilter.toLowerCase())
        && (!this.productBrandFilter || brand.toLowerCase() === this.productBrandFilter.toLowerCase())
        && (!this.productVendorFilter || vendor.toLowerCase() === this.productVendorFilter.toLowerCase())
        && (!this.productStatusFilter || status === this.productStatusFilter.toLowerCase())
        && (!this.productTypeFilter || type.toLowerCase() === this.productTypeFilter.toLowerCase());
    });
  }

  productCategories(): string[] {
    return this.uniqueProductOptions((product) => product.category);
  }

  productBrands(): string[] {
    return this.uniqueProductOptions((product) => this.productBrand(product));
  }

  productVendors(): string[] {
    return this.uniqueProductOptions((product) => this.productVendorName(product));
  }

  productTypes(): string[] {
    return this.uniqueProductOptions((product) => this.productType(product));
  }

  productStatusLabel(): string {
    if (!this.productStatusFilter) return 'All';
    return this.productStatusFilter === 'active' ? 'Active in this center' : 'Inactive';
  }

  productCode(product: ApiRecord): string {
    return String(product.code || product.productCode || product.sku || product.id || '-');
  }

  productBrand(product: ApiRecord): string {
    return String(product.brand || product.brandName || '-').trim() || '-';
  }

  productBusinessUnit(product: ApiRecord): string {
    return String(product.businessUnit || product.businessUnitName || product.category || '-').trim() || '-';
  }

  productType(product: ApiRecord): string {
    const value = String(product.usageType || product.type || '').toLowerCase();
    if (value === 'both') return 'Both';
    if (value.includes('consumable') || value.includes('professional')) return 'Consumable';
    if (value.includes('retail')) return 'Retail';
    return value ? value[0].toUpperCase() + value.slice(1) : 'Retail';
  }

  productMrp(product: ApiRecord): number {
    return Number(product.mrp || product.maxRetailPrice || product.price || 0);
  }

  productAmount(product: ApiRecord): string {
    const stock = Number(product.stock || 0);
    const unit = String(product.unit || product.packUnit || 'units');
    return `${stock} ${unit}`;
  }

  productVendorName(product: ApiRecord): string {
    return String(product.supplier || product.vendor || product.vendorName || this.supplierName(product.id) || '-').trim() || '-';
  }

  productInUse(product: ApiRecord): string {
    return this.productSaleUsage(product.id) + this.productServiceUsage(product.id) > 0 || Number(product.stock || 0) > 0 ? 'Yes' : 'No';
  }

  productStatus(product: ApiRecord): string {
    const raw = String(product.status || '').toLowerCase();
    if (raw && !['active', 'enabled', 'true'].includes(raw)) return 'Inactive';
    if (product.active === false || product.isActive === false) return 'Inactive';
    return 'Active';
  }

  selectedBranchName(): string {
    return this.branchName(this.api.selectedBranchId());
  }

  deskTitle(): string {
    const titles: Record<InventoryDesk, string> = {
      '': 'Inventory action',
      stock: 'Stock Movement',
      product: 'Edit Product',
      supplier: 'Edit Vendor',
      batch: 'Receive Batch',
      waste: 'Waste / Expiry'
    };
    return titles[this.activeDesk()];
  }

  selectInventoryProduct(product: ApiRecord): void {
    this.selectedProductId.set(product.id);
  }

  openNewProductForm(): void {
    this.editingProductId.set('');
    const branchId = this.api.selectedBranchId() || this.branches()[0]?.id || '';
    this.productForm.reset({
      name: '',
      sku: '',
      category: '',
      unit: 'pcs',
      packSize: '',
      packUnit: 'pcs',
      usageType: 'retail',
      supplier: '',
      branchId,
      stock: 0,
      lowStockThreshold: 5,
      expiryDate: '',
      unitCost: 0,
      price: 0,
      gstRate: 18,
      isLaundry: false,
      laundryRate: 0
    });
    this.error.set('');
    this.activeDesk.set('product');
    this.showProductForm.set(true);
  }

  openEditProductForm(product: ApiRecord | null): void {
    if (!product) {
      this.openNewProductForm();
      return;
    }
    this.selectInventoryProduct(product);
    const unit = String(product.unit || 'pcs').toLowerCase().trim() || 'pcs';
    const packUnit = String(product.packUnit || this.defaultPackUnit(unit)).toLowerCase().trim() || this.defaultPackUnit(unit);
    const usageType = this.normalizedProductUsageType(product);
    const localLaundry = this.localLaundryProduct(product.id);
    this.editingProductId.set(String(product.id || ''));
    this.productForm.reset({
      name: product.name || '',
      sku: product.sku || product.code || product.productCode || '',
      category: product.category || '',
      unit,
      packSize: product.packSize ?? '',
      packUnit,
      usageType,
      supplier: product.supplier || product.vendor || product.vendorName || '',
      branchId: product.branchId || this.api.selectedBranchId() || this.branches()[0]?.id || '',
      stock: Number(product.stock || 0),
      lowStockThreshold: Number(product.lowStockThreshold || 0),
      expiryDate: product.expiryDate || '',
      unitCost: Number(product.unitCost || 0),
      price: Number(product.price || 0),
      gstRate: Number(product.gstRate || 0),
      isLaundry: this.isLaundryProduct(product),
      laundryRate: Number(localLaundry.laundryRate ?? product.laundryRate ?? 0)
    });
    this.error.set('');
    this.activeDesk.set('product');
    this.showProductForm.set(true);
  }

  closeProductForm(): void {
    this.activeDesk.set('');
    this.showProductForm.set(false);
    this.editingProductId.set('');
  }

  resetInventoryFilters(): void {
    this.query = '';
    this.productCategoryFilter = '';
    this.productBrandFilter = '';
    this.productVendorFilter = '';
    this.productStatusFilter = 'active';
    this.productTypeFilter = '';
  }

  runQuickAction(action: string): void {
    if (!action) return;
    if (action === 'reorder') {
      this.runReorder();
      this.quickAction = '';
      return;
    }
    this.activeDesk.set(action as InventoryDesk);
    if (action === 'product') this.showProductForm.set(true);
  }

  private uniqueProductOptions(resolve: (product: ApiRecord) => unknown): string[] {
    return Array.from(new Set(this.products()
      .map((product) => String(resolve(product) || '').trim())
      .filter((value) => value && value !== '-')))
      .sort((a, b) => a.localeCompare(b));
  }

  lowStock(): ApiRecord[] {
    return this.products().filter((product) => Number(product.stock) <= Number(product.lowStockThreshold));
  }

  expiring(): ApiRecord[] {
    return this.products().filter((product) => product.expiryDate && product.expiryDate <= '2026-08-31');
  }

  productName(id: string): string {
    return this.products().find((product) => product.id === id)?.name || id;
  }

  batchesForProduct(productId: string): ApiRecord[] {
    return this.batches().filter((batch) => !productId || batch.productId === productId);
  }

  autopilotSuggestions(): ApiRecord[] {
    const suggestions = ((this.intelligence()?.['suggestions'] || []) as ApiRecord[]);
    if (suggestions.length) return suggestions;
    return this.products()
      .filter((product) => this.isLowStock(product))
      .map((product) => ({
        productId: product.id,
        name: product.name,
        supplier: product.supplier,
        stock: Number(product.stock || 0),
        lowStockThreshold: Number(product.lowStockThreshold || 0),
        recommendedQty: Math.max(1, Number(product.lowStockThreshold || 5) * 2 - Number(product.stock || 0)),
        estimatedCost: Math.max(1, Number(product.lowStockThreshold || 5) * 2 - Number(product.stock || 0)) * Number(product.unitCost || 0),
        predictedStockoutDate: '',
        priority: 'high',
        reason: 'Low stock threshold reached'
      }));
  }

  isLowStock(product: ApiRecord): boolean {
    return Number(product.stock || 0) <= Number(product.lowStockThreshold || 0);
  }

  stockValue(product: ApiRecord): number {
    return Number(product.stock || 0) * Number(product.unitCost || product.price || 0);
  }

  productMargin(product: ApiRecord): number {
    return Number(product.price || 0) - Number(product.unitCost || 0);
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

  nearestExpiry(productId: string): string {
    const expiry = this.batches()
      .filter((batch) => batch.productId === productId && Number(batch.quantityAvailable || 0) > 0 && batch.expiryDate)
      .map((batch) => String(batch.expiryDate))
      .sort()[0];
    return expiry || this.products().find((product) => product.id === productId)?.expiryDate || 'not set';
  }

  supplierName(productId: string): string {
    const batch = this.batches().find((row) => row.productId === productId && row.supplierId);
    return this.supplierNameFromId(batch?.supplierId || '');
  }

  supplierNameFromId(id: string): string {
    if (!id) return '-';
    return this.suppliers().find((supplier) => supplier.id === id)?.name || id;
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

  supplierPendingSuggestions(supplier: ApiRecord): ApiRecord[] {
    const name = String(supplier.name || '').toLowerCase();
    return this.autopilotSuggestions().filter((item) => String(item.supplier || '').toLowerCase() === name || item.supplierId === supplier.id);
  }

  supplierQualityIssues(id: string): ApiRecord[] {
    const productIds = new Set(this.batches().filter((batch) => batch.supplierId === id).map((batch) => batch.productId));
    return [
      ...this.expiryRiskRows().filter((row) => row.supplierId === id || productIds.has(row.productId)),
      ...this.wasteTransactions().filter((row) => row.supplierId === id || productIds.has(row.productId))
    ];
  }

  supplierLastPurchase(id: string): string {
    const row = this.transactions()
      .filter((item) => item.supplierId === id && String(item.type || '').includes('purchase'))
      .slice()
      .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))[0];
    return row?.createdAt ? new Date(row.createdAt).toLocaleDateString() : 'No purchase yet';
  }

  replacementSupplier(id: string): string {
    const supplier = this.suppliers()
      .filter((item) => item.id !== id && (item.status || 'active') === 'active')
      .sort((a, b) => this.supplierScore(b.id) - this.supplierScore(a.id))[0];
    return supplier?.name || 'No alternate supplier';
  }

  buildSupplierWhatsappDraft(supplier: ApiRecord): void {
    const suggestions = this.supplierPendingSuggestions(supplier);
    const lines = suggestions.length
      ? suggestions.slice(0, 4).map((item) => `${item.name}: ${item.recommendedQty || 0} units`).join(', ')
      : 'No urgent reorder items. Please confirm latest price list and delivery timeline.';
    this.supplierWhatsappDraft.set(`Draft to ${supplier.name}: Purchase request - ${lines}`);
  }

  recipeRows(): ApiRecord[] {
    return this.services().map((service) => {
      const required = Array.isArray(service.requiredProducts) ? service.requiredProducts : [];
      const recipe = required.length
        ? required.map((item: ApiRecord) => `${this.productName(item.productId)} x ${item.quantity || 1}`).join(', ')
        : 'No recipe';
      return { ...service, recipe };
    });
  }

  unmappedRecipeCount(): number {
    return this.recipeRows().filter((row) => row.recipe === 'No recipe').length;
  }

  fifoBatches(): ApiRecord[] {
    return this.batches()
      .filter((batch) => Number(batch.quantityAvailable || 0) > 0)
      .slice()
      .sort((a, b) => String(a.expiryDate || '9999-12-31').localeCompare(String(b.expiryDate || '9999-12-31')));
  }

  stockAuditRows(): ApiRecord[] {
    const rows: ApiRecord[] = [];
    for (const product of this.products()) {
      const usage = this.productSaleUsage(product.id) + this.productServiceUsage(product.id);
      const waste = Math.abs(this.wasteTransactions().filter((row) => row.productId === product.id).reduce((total, row) => total + Number(row.quantity || 0), 0));
      const weakMargin = this.productMargin(product) <= 0;
      if (waste > 0 || weakMargin || (usage > 0 && Number(product.stock || 0) <= 0)) {
        rows.push({
          productId: product.id,
          name: product.name,
          risk: weakMargin ? 'margin leakage' : waste > 0 ? 'waste variance' : 'stockout variance',
          reason: weakMargin ? 'Selling price is below or equal to unit cost' : waste > 0 ? 'Waste or expiry write-off recorded' : 'Usage exists but current stock is zero',
          variance: weakMargin ? Math.abs(this.productMargin(product)) * Number(product.stock || 1) : waste
        });
      }
    }
    return rows.sort((a, b) => Number(b.variance || 0) - Number(a.variance || 0));
  }

  branchShortages(): ApiRecord[] {
    return this.allProducts().filter((product) => this.isLowStock(product));
  }

  transferRecommendations(): ApiRecord[] {
    const products = this.allProducts();
    const recommendations: ApiRecord[] = [];
    for (const shortage of products.filter((product) => this.isLowStock(product))) {
      const donor = products.find((product) =>
        this.productKey(product) === this.productKey(shortage)
        && product.branchId !== shortage.branchId
        && Number(product.stock || 0) > Number(product.lowStockThreshold || 0) * 2
      );
      if (!donor) continue;
      recommendations.push({
        productName: shortage.name,
        quantity: Math.max(1, Math.floor(Number(donor.stock || 0) - Number(donor.lowStockThreshold || 0) * 1.5)),
        fromBranch: this.branchName(donor.branchId),
        toBranch: this.branchName(shortage.branchId)
      });
    }
    return recommendations;
  }

  financialBrain(): ApiRecord {
    const cogs = this.transactions()
      .filter((row) => Number(row.quantity || 0) < 0)
      .reduce((total, row) => total + Math.abs(Number(row.totalCost || 0)), 0);
    const cashLocked = this.products().reduce((total, product) => total + this.stockValue(product), 0);
    const deadStockValue = this.deadStockProducts().reduce((total, product) => total + this.stockValue(product), 0);
    const profitPotential = this.products().reduce((total, product) => total + Math.max(0, this.productMargin(product)) * Number(product.stock || 0), 0);
    return { cogs, cashLocked, deadStockValue, profitPotential };
  }

  posUpsellHints(): ApiRecord[] {
    return this.products()
      .filter((product) => String(product.usageType || 'retail') === 'retail' && Number(product.stock || 0) > 0 && this.productMargin(product) > 0)
      .sort((a, b) => this.productMargin(b) - this.productMargin(a))
      .map((product) => ({
        id: product.id,
        name: product.name,
        reason: `${product.category || 'Retail'} aftercare available Â· margin ${this.productMargin(product).toFixed(0)} Â· ${product.stock} in stock`
      }));
  }

  scanProduct(): void {
    const code = this.scannerCode.trim().toLowerCase();
    const product = this.products().find((item) => String(item.sku || '').toLowerCase() === code || String(item.name || '').toLowerCase().includes(code));
    this.scannerResult.set(product ? `${product.name}: ${product.stock || 0} in stock, â‚¹${product.price || 0} price` : 'No product matched this scan.');
    if (product) this.selectedProductId.set(product.id);
  }

  digitalTwin(): ApiRecord {
    const uplift = Math.max(0, Number(this.whatIfDemandPct || 0)) / 100;
    const risky = this.autopilotSuggestions().filter((item) => Number(item.daysOfStock || 999) <= 14 || Number(item.stock || 0) <= Number(item.lowStockThreshold || 0));
    const stockouts = Math.ceil(risky.length * (1 + uplift));
    const revenueAtRisk = risky.reduce((total, item) => {
      const product = this.products().find((row) => row.id === item.productId);
      return total + Number(item.recommendedQty || 1) * Number(product?.price || product?.unitCost || 0) * (1 + uplift);
    }, 0);
    return { stockouts, revenueAtRisk };
  }

  deadStockProducts(): ApiRecord[] {
    return this.products().filter((product) =>
      Number(product.stock || 0) > Math.max(10, Number(product.lowStockThreshold || 0) * 3)
      && this.productSaleUsage(product.id) + this.productServiceUsage(product.id) === 0
    );
  }

  expiryRiskRows(): ApiRecord[] {
    const productExpiry = this.products()
      .filter((product) => product.expiryDate && this.daysUntil(product.expiryDate) <= 60)
      .map((product) => ({ ...product, productId: product.id }));
    const batchExpiry = this.batches()
      .filter((batch) => batch.expiryDate && Number(batch.quantityAvailable || 0) > 0 && this.daysUntil(batch.expiryDate) <= 60);
    return [...productExpiry, ...batchExpiry];
  }

  purchaseTransactions(): ApiRecord[] {
    return this.transactions().filter((row) => String(row.type || '').includes('purchase'));
  }

  wasteTransactions(): ApiRecord[] {
    return this.transactions().filter((row) => {
      const text = `${row.type || ''} ${row.reason || ''}`.toLowerCase();
      return text.includes('waste') || text.includes('expiry') || text.includes('damaged') || text.includes('spillage');
    });
  }

  branchName(id: string): string {
    return this.branches().find((branch) => branch.id === id)?.name || id || 'All branches';
  }

  private productKey(product: ApiRecord): string {
    return String(product.sku || product.name || '').toLowerCase().trim();
  }

  private daysUntil(value: string): number {
    const time = new Date(value).getTime();
    if (!value || Number.isNaN(time)) return 9999;
    return Math.round((time - Date.now()) / 86400000);
  }
}
