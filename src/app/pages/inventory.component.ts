import { CommonModule, CurrencyPipe, DatePipe } from '@angular/common';
import { Component, OnInit, computed, signal } from '@angular/core';
import { FormsModule, ReactiveFormsModule, UntypedFormBuilder, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ApiRecord, ApiService } from '../core/api.service';
import { StateComponent } from '../shared/ui/state/state.component';
import { AuraKpiCardComponent } from '../shared/ui/aura-kpi-card/aura-kpi-card.component';

type InventoryDesk = '' | 'stock' | 'product' | 'supplier' | 'batch' | 'waste';

@Component({
  selector: 'app-inventory',
  standalone: true,
  imports: [CommonModule, FormsModule, ReactiveFormsModule, CurrencyPipe, DatePipe, RouterLink, StateComponent, AuraKpiCardComponent],
  template: `
    <section class="page-stack inventory-shell">
      <div class="module-hero inventory-hero">
        <div>
          <span class="eyebrow">Products and inventory</span>
          <h2>Retail stock, professional stock, purchase entry and auto deduction</h2>
          <p>Product sales and completed services create inventory transactions automatically.</p>
        </div>
        <div class="hero-actions">
          <button class="primary-button" type="button" (click)="activeDesk.set('product'); showProductForm.set(true)">+ Add product</button>
          <button class="ghost-button" type="button" (click)="runReorder()">Generate reorder</button>
        </div>
      </div>

      <app-state [loading]="loading()" [error]="error()"></app-state>

      <div class="inv-quick-links">
        <a class="inv-quick-link" routerLink="/inventory/reports">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
          Reports
        </a>
        <a class="inv-quick-link" routerLink="/inventory/reorder">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/></svg>
          Reorder
        </a>
        <a class="inv-quick-link" routerLink="/inventory/purchase-orders">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
          Purchase orders
        </a>
        <a class="inv-quick-link" routerLink="/inventory/purchase-bill-drafts">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="M8 6v12M16 6v12M6 10h4M6 14h4M14 10h4M14 14h4"/></svg>
          Bill drafts
        </a>
        <a class="inv-quick-link" routerLink="/inventory/stock-audit">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>
          Stock audit
        </a>
        <a class="inv-quick-link" routerLink="/inventory/fifo">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
          FIFO / Batches
        </a>
        <a class="inv-quick-link" routerLink="/inventory/recipes">Recipes</a>
        <a class="inv-quick-link" routerLink="/inventory/financial">Financial</a>
        <a class="inv-quick-link" routerLink="/inventory/scanner">Scanner</a>
      </div>

      <section class="inv-metrics" *ngIf="commandMetrics() as metrics">
        <article class="inv-metric inv-metric--teal">
          <span class="inv-metric-label">Live stock value</span>
          <strong class="inv-metric-value">{{ metrics.stockValue | currency: 'INR':'symbol':'1.0-0' }}</strong>
          <span class="inv-metric-hint">{{ metrics.products }} active products</span>
        </article>
        <article class="inv-metric inv-metric--amber">
          <span class="inv-metric-label">Low stock</span>
          <strong class="inv-metric-value">{{ metrics.lowStock }}</strong>
          <span class="inv-metric-hint">{{ metrics.branchShortage }} branch shortages</span>
        </article>
        <article class="inv-metric inv-metric--red">
          <span class="inv-metric-label">Expiry + dead stock</span>
          <strong class="inv-metric-value">{{ metrics.expiryRisk + metrics.deadStock }}</strong>
          <span class="inv-metric-hint">{{ metrics.expiryRisk }} exp · {{ metrics.deadStock }} dead</span>
        </article>
        <article class="inv-metric inv-metric--blue">
          <span class="inv-metric-label">Purchase spend</span>
          <strong class="inv-metric-value">{{ metrics.purchaseSpend | currency: 'INR':'symbol':'1.0-0' }}</strong>
          <span class="inv-metric-hint">{{ metrics.supplierPending }} pending drafts</span>
        </article>
        <article class="inv-metric inv-metric--purple">
          <span class="inv-metric-label">Wastage</span>
          <strong class="inv-metric-value">{{ metrics.wasteCost | currency: 'INR':'symbol':'1.0-0' }}</strong>
          <span class="inv-metric-hint">FIFO and expiry control</span>
        </article>
        <article class="inv-metric inv-metric--black">
          <span class="inv-metric-label">Margin leakage</span>
          <strong class="inv-metric-value">{{ metrics.marginLeakage | currency: 'INR':'symbol':'1.0-0' }}</strong>
          <span class="inv-metric-hint">Waste + weak margin</span>
        </article>
      </section>

      <div class="inv-workspace">
        <div class="inv-workspace-main">
          <section class="panel inv-ops-panel">
            <div class="inv-ops-header">
              <span class="eyebrow">Stock control desk</span>
              <button class="ghost-button mini" *ngIf="activeDesk()" type="button" (click)="activeDesk.set('')">Close</button>
            </div>
            <div class="inv-ops-tabs">
              <button type="button" [class.active]="activeDesk() === 'stock'" (click)="activeDesk.set('stock')">Stock movement</button>
              <button type="button" [class.active]="activeDesk() === 'product'" (click)="activeDesk.set('product'); showProductForm.set(true)">Product setup</button>
              <button type="button" [class.active]="activeDesk() === 'batch'" (click)="activeDesk.set('batch')">Receive batch</button>
              <button type="button" [class.active]="activeDesk() === 'supplier'" (click)="activeDesk.set('supplier')">Supplier</button>
              <button type="button" [class.active]="activeDesk() === 'waste'" (click)="activeDesk.set('waste')">Waste / expiry</button>
            </div>
            <div class="inv-ops-body" [ngSwitch]="activeDesk()">
              <div class="inv-ops-empty" *ngSwitchDefault>
                <span>Select a task above to start working</span>
              </div>
              <form *ngSwitchCase="'stock'" [formGroup]="adjustForm" (ngSubmit)="adjustStock()">
                <div class="inv-form-grid">
                  <label class="field"><span>Product</span>
                    <select formControlName="productId">
                      <option value="">Select product</option>
                      <option *ngFor="let product of products()" [value]="product.id">{{ product.name }} — {{ product.stock }} left</option>
                    </select>
                  </label>
                  <label class="field"><span>Branch</span>
                    <select formControlName="branchId">
                      <option value="">Select branch</option>
                      <option *ngFor="let branch of branches()" [value]="branch.id">{{ branch.name }}</option>
                    </select>
                  </label>
                  <label class="field"><span>Type</span>
                    <select formControlName="type">
                      <option value="purchase-entry">Purchase entry</option>
                      <option value="adjustment">Stock adjustment</option>
                      <option value="expiry-writeoff">Expiry write-off</option>
                    </select>
                  </label>
                  <label class="field"><span>Quantity (+/-)</span><input type="number" formControlName="quantity" /></label>
                  <label class="field inv-field-wide"><span>Reason</span><textarea formControlName="reason" rows="2"></textarea></label>
                  <div class="inv-form-action">
                    <button class="primary-button" type="submit" [disabled]="adjustForm.invalid || saving()">Apply stock movement</button>
                  </div>
                </div>
              </form>
              <form *ngSwitchCase="'product'" [formGroup]="productForm" (ngSubmit)="saveProduct()">
                <div class="inv-form-grid">
                  <label class="field"><span>Name</span><input formControlName="name" /></label>
                  <label class="field"><span>SKU</span><input formControlName="sku" /></label>
                  <label class="field"><span>Category</span><input formControlName="category" /></label>
                  <label class="field"><span>Unit</span>
                    <select formControlName="unit">
                      <option value="ml">ml</option><option value="gm">gm</option><option value="g">g</option>
                      <option value="kg">kg</option><option value="l">l</option><option value="pcs">pcs</option>
                      <option value="tube">tube</option><option value="bottle">bottle</option><option value="pack">pack</option>
                    </select>
                  </label>
                  <label class="field"><span>Usage type</span>
                    <select formControlName="usageType">
                      <option value="retail">Retail</option>
                      <option value="consumable">Consumable / professional</option>
                      <option value="both">Retail + professional</option>
                    </select>
                  </label>
                  <label class="field"><span>Supplier</span><input formControlName="supplier" /></label>
                  <label class="field"><span>Branch</span>
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
                  <div class="inv-form-actions">
                    <button class="ghost-button" type="button" (click)="activeDesk.set(''); showProductForm.set(false)">Cancel</button>
                    <button class="primary-button" type="submit" [disabled]="productForm.invalid || saving()">Save product</button>
                  </div>
                </div>
              </form>
              <form *ngSwitchCase="'batch'" [formGroup]="purchaseForm" (ngSubmit)="purchaseEntry()">
                <div class="inv-form-grid">
                  <label class="field"><span>Product</span>
                    <select formControlName="productId">
                      <option value="">Select product</option>
                      <option *ngFor="let product of products()" [value]="product.id">{{ product.name }}</option>
                    </select>
                  </label>
                  <label class="field"><span>Supplier</span>
                    <select formControlName="supplierId">
                      <option value="">No supplier</option>
                      <option *ngFor="let supplier of suppliers()" [value]="supplier.id">{{ supplier.name }}</option>
                    </select>
                  </label>
                  <label class="field"><span>Branch</span>
                    <select formControlName="branchId">
                      <option value="">Select branch</option>
                      <option *ngFor="let branch of branches()" [value]="branch.id">{{ branch.name }}</option>
                    </select>
                  </label>
                  <label class="field"><span>Batch number</span><input formControlName="batchNumber" /></label>
                  <label class="field"><span>Expiry date</span><input type="date" formControlName="expiryDate" /></label>
                  <label class="field"><span>Quantity</span><input type="number" formControlName="quantity" /></label>
                  <label class="field"><span>Unit cost</span><input type="number" formControlName="unitCost" /></label>
                  <div class="inv-form-action">
                    <button class="primary-button" type="submit" [disabled]="purchaseForm.invalid || saving()">Receive batch</button>
                  </div>
                </div>
              </form>
              <form *ngSwitchCase="'supplier'" [formGroup]="supplierForm" (ngSubmit)="saveSupplier()">
                <div class="inv-form-grid">
                  <label class="field"><span>Name</span><input formControlName="name" /></label>
                  <label class="field"><span>Contact</span><input formControlName="contactName" /></label>
                  <label class="field"><span>Phone</span><input formControlName="phone" /></label>
                  <label class="field"><span>Email</span><input type="email" formControlName="email" /></label>
                  <label class="field"><span>GSTIN</span><input formControlName="gstin" /></label>
                  <label class="field inv-field-wide"><span>Address</span><textarea formControlName="address" rows="2"></textarea></label>
                  <div class="inv-form-actions">
                    <a class="ghost-button" routerLink="/suppliers">Supplier register</a>
                    <button class="primary-button" type="submit" [disabled]="supplierForm.invalid || saving()">Save supplier</button>
                  </div>
                </div>
              </form>
              <form *ngSwitchCase="'waste'" [formGroup]="wasteForm" (ngSubmit)="recordWaste()">
                <div class="inv-form-grid">
                  <label class="field"><span>Product</span>
                    <select formControlName="productId">
                      <option value="">Select product</option>
                      <option *ngFor="let product of products()" [value]="product.id">{{ product.name }}</option>
                    </select>
                  </label>
                  <label class="field"><span>Batch</span>
                    <select formControlName="batchId">
                      <option value="">Auto / no batch</option>
                      <option *ngFor="let batch of batchesForProduct(wasteForm.value.productId)" [value]="batch.id">{{ batch.batchNumber }} · {{ batch.quantityAvailable }} left</option>
                    </select>
                  </label>
                  <label class="field"><span>Branch</span>
                    <select formControlName="branchId">
                      <option value="">Select branch</option>
                      <option *ngFor="let branch of branches()" [value]="branch.id">{{ branch.name }}</option>
                    </select>
                  </label>
                  <label class="field"><span>Quantity</span><input type="number" formControlName="quantity" /></label>
                  <label class="field"><span>Reason</span>
                    <select formControlName="reason">
                      <option value="expired">Expired</option>
                      <option value="damaged">Damaged</option>
                      <option value="spillage">Spillage</option>
                      <option value="service overuse">Service overuse</option>
                    </select>
                  </label>
                  <label class="field inv-field-wide"><span>Notes</span><textarea formControlName="notes" rows="2"></textarea></label>
                  <div class="inv-form-action">
                    <button class="primary-button" type="submit" [disabled]="wasteForm.invalid || saving()">Record waste</button>
                  </div>
                </div>
              </form>
            </div>
          </section>

          <section class="panel inv-table-panel">
            <div class="inv-table-toolbar">
              <label class="inv-search"><input [(ngModel)]="query" placeholder="Search by name, SKU or supplier…" /></label>
              <button class="ghost-button mini" type="button" (click)="load()">Refresh</button>
            </div>
            <div class="inv-table-scroll">
              <table class="inv-table">
                <thead>
                  <tr><th>Product</th><th>Type</th><th>Stock</th><th>Price</th><th>Supplier</th><th>Expiry</th></tr>
                </thead>
                <tbody>
                  <tr *ngFor="let product of filteredProducts()" [class.inv-row--low]="isLowStock(product)">
                    <td><strong>{{ product.name }}</strong><small>{{ product.sku || product.id }}</small></td>
                    <td><span class="inv-badge">{{ product.usageType }}</span></td>
                    <td><span class="inv-stock" [class.inv-stock--low]="isLowStock(product)">{{ product.stock }} <small *ngIf="isLowStock(product)">low</small></span></td>
                    <td>{{ product.price | currency: 'INR':'symbol':'1.0-0' }}</td>
                    <td><span class="inv-muted">{{ product.supplier || '-' }}</span></td>
                    <td><span class="inv-muted">{{ product.expiryDate | date: 'mediumDate' }}</span></td>
                  </tr>
                  <tr *ngIf="!filteredProducts().length">
                    <td colspan="6" class="inv-empty">No products match your search.</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>
        </div>

        <div class="inv-workspace-side">
          <ng-container *ngIf="intelligence() as intelligence">
            <section class="panel inv-side-panel">
              <div class="inv-side-header">
                <span class="eyebrow">KPI drill-down</span>
                <small>Click to explore</small>
              </div>
              <a class="inv-side-link" routerLink="/kpi-details/inventory/stock-value">
                <span>Stock value</span>
                <strong>{{ intelligence.metrics.stockValue | currency: 'INR':'symbol':'1.0-0' }}</strong>
              </a>
              <a class="inv-side-link" routerLink="/kpi-details/inventory/reorder-suggestions">
                <span>Reorder suggestions</span>
                <strong>{{ intelligence.metrics.reorderCount }}</strong>
              </a>
              <a class="inv-side-link" routerLink="/kpi-details/inventory/expiring-soon">
                <span>Expiring soon</span>
                <strong>{{ intelligence.metrics.expiringSoon }}</strong>
              </a>
              <a class="inv-side-link" routerLink="/kpi-details/inventory/waste-cost">
                <span>Waste cost</span>
                <strong>{{ intelligence.metrics.wasteCost | currency: 'INR':'symbol':'1.0-0' }}</strong>
              </a>
            </section>
          </ng-container>

          <section class="panel inv-side-panel">
            <div class="inv-side-header">
              <span class="eyebrow">Live feed</span>
              <small>Recent movements</small>
            </div>
            <div class="inv-feed-list">
              <article class="inv-feed-item" *ngFor="let t of transactions().slice(0, 5)">
                <div class="inv-feed-body">
                  <strong>{{ productName(t.productId) }}</strong>
                  <span>{{ t.type }} · {{ t.quantity }} units</span>
                </div>
                <span class="inv-feed-time">{{ t.createdAt | date: 'shortDate' }}</span>
              </article>
              <article class="inv-feed-empty" *ngIf="!transactions().length">
                <span>No movements yet.</span>
              </article>
            </div>
          </section>
        </div>
      </div>
    </section>
  `,
  styles: [`
    .inventory-shell { gap: 12px; }

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
    .hero-actions {
      display: flex;
      flex-wrap: wrap;
      justify-content: flex-end;
      gap: 8px;
    }

    .inv-metrics {
      display: grid;
      grid-template-columns: repeat(6, minmax(0, 1fr));
      gap: 10px;
    }
    .inv-metric {
      display: grid;
      gap: 6px;
      padding: 14px;
      border: 1px solid var(--line);
      border-radius: 10px;
      background: var(--surface);
    }
    .inv-metric-body {
      display: grid;
      gap: 2px;
    }
    .inv-metric-label {
      color: var(--muted);
      font-size: 0.72rem;
      font-weight: 900;
      text-transform: uppercase;
      letter-spacing: 0.03em;
    }
    .inv-metric-value {
      font-size: 1.35rem;
      line-height: 1.1;
    }
    .inv-metric-hint {
      color: var(--muted);
      font-size: 0.74rem;
    }
    .inv-metric--teal { border-left: 4px solid var(--teal); }
    .inv-metric--amber { border-left: 4px solid #b26b00; }
    .inv-metric--red { border-left: 4px solid var(--red); }
    .inv-metric--blue { border-left: 4px solid #2f5dcc; }
    .inv-metric--purple { border-left: 4px solid #6f3fc8; }
    .inv-metric--black { border-left: 4px solid #162033; }

    .inv-workspace {
      display: grid;
      grid-template-columns: minmax(0, 1.6fr) minmax(280px, 0.7fr);
      gap: 14px;
      align-items: stretch;
    }
    .inv-workspace-main {
      display: grid;
      gap: 14px;
    }
    .inv-workspace-side {
      display: flex;
      flex-direction: column;
      gap: 14px;
      height: 100%;
    }
    .inv-workspace-side .inv-side-panel:last-child {
      flex: 1;
    }

    .inv-side-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      margin-bottom: 8px;
    }
    .inv-side-header small { color: var(--muted); font-size: 11px; }
    .inv-side-link {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      min-height: 36px;
      padding: 6px 10px;
      border: 1px solid transparent;
      border-radius: 10px;
      color: var(--ink);
      text-decoration: none;
      font-size: 13px;
      transition: background 0.1s, border-color 0.1s;
    }
    .inv-side-link:hover {
      background: rgba(79, 70, 229, 0.04);
      border-color: rgba(79, 70, 229, 0.15);
    }
    .inv-side-link strong {
      color: #4f46e5;
      font-size: 14px;
    }

    .inv-ops-panel { padding: 14px; }
    .inv-ops-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      margin-bottom: 12px;
    }
    .inv-ops-title { display: grid; gap: 2px; }
    .inv-ops-title h2 { margin: 0; font-size: 1rem; }
    .inv-ops-actions { display: flex; gap: 8px; }
    .inv-ops-tabs {
      display: flex;
      gap: 6px;
      overflow-x: auto;
      padding-bottom: 10px;
      border-bottom: 1px solid var(--line);
    }
    .inv-ops-tabs button {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      min-height: 34px;
      padding: 0 12px;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: var(--surface);
      color: var(--muted);
      font-size: 0.82rem;
      font-weight: 800;
      white-space: nowrap;
      cursor: pointer;
      transition: all 0.12s ease;
    }
    .inv-ops-tabs button.active {
      border-color: var(--teal);
      background: var(--teal);
      color: #fff;
    }
    .inv-ops-tabs button svg { flex: 0 0 auto; }

    .inv-ops-body { padding-top: 12px; }
    .inv-ops-closed p { color: var(--muted); margin: 0; font-size: 0.88rem; }

    .inv-form-row {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 10px;
      align-items: end;
    }
    .inv-form-row .field { margin-bottom: 0; }
    .inv-field-wide { grid-column: span 2; }
    .inv-form-action {
      grid-column: 1 / -1;
      display: flex;
      justify-content: flex-end;
    }
    .inv-form-actions {
      grid-column: 1 / -1;
      display: flex;
      justify-content: flex-end;
      gap: 8px;
      padding-top: 4px;
    }
    .inv-form textarea { min-height: 38px; resize: vertical; }

    .inv-table-panel { padding: 12px; }
    .inv-table-header {
      display: flex;
      align-items: center;
      gap: 12px;
      margin-bottom: 10px;
    }
    .inv-search {
      flex: 1;
      display: grid;
      gap: 4px;
    }
    .inv-search span {
      color: var(--muted);
      font-size: 0.7rem;
      font-weight: 900;
      text-transform: uppercase;
    }
    .inv-search input {
      width: 100%;
      min-height: 36px;
      padding: 0 10px;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: var(--surface);
      font-size: 0.86rem;
    }
    .inv-table-actions { display: flex; gap: 6px; }

    .inv-table-scroll {
      max-height: 340px;
      overflow: auto;
      border: 1px solid var(--line);
      border-radius: 8px;
    }
    .inv-table {
      width: 100%;
      min-width: 500px;
      border-collapse: collapse;
    }
    .inv-table th, .inv-table td {
      padding: 10px 12px;
      border-bottom: 1px solid var(--line);
      text-align: left;
      vertical-align: middle;
      font-size: 0.82rem;
    }
    .inv-table th {
      position: sticky;
      top: 0;
      z-index: 2;
      background: var(--surface-2);
      color: var(--muted);
      font-size: 0.7rem;
      font-weight: 900;
      text-transform: uppercase;
    }
    .inv-table tbody tr:last-child td { border-bottom: 0; }
    .inv-table td strong, .inv-table td small { display: block; }
    .inv-table td small { color: var(--muted); font-size: 0.72rem; margin-top: 2px; }
    .inv-badge {
      display: inline-flex;
      padding: 2px 8px;
      border-radius: 999px;
      background: #eef3f2;
      color: var(--teal-2);
      font-size: 0.7rem;
      font-weight: 900;
      text-transform: uppercase;
    }
    .inv-stock { font-weight: 800; }
    .inv-stock--low { color: var(--red); }
    .inv-date { color: var(--muted); font-size: 0.8rem; }
    .inv-empty {
      color: var(--muted);
      text-align: center !important;
      padding: 20px !important;
    }

    .inv-kpi-panel,
    .inv-feed-panel { padding: 12px; }
    .inv-kpi-header,
    .inv-feed-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      margin-bottom: 10px;
      padding-bottom: 8px;
      border-bottom: 1px solid var(--line);
    }
    .inv-kpi-header small,
    .inv-feed-header small {
      color: var(--muted);
      font-size: 0.72rem;
    }
    .inv-kpi-list { display: grid; gap: 2px; }
    .inv-kpi-item {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      padding: 9px 10px;
      border-radius: 6px;
      color: var(--ink);
      text-decoration: none;
      transition: background 0.12s ease;
    }
    .inv-kpi-item:hover { background: var(--surface-2); }
    .inv-kpi-label {
      color: var(--muted);
      font-size: 0.78rem;
      font-weight: 800;
    }
    .inv-kpi-val { font-size: 0.95rem; }

    .inv-feed-list { display: grid; gap: 6px; }
    .inv-feed-item {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      padding: 8px 10px;
      border-radius: 6px;
      transition: background 0.12s ease;
    }
    .inv-feed-item:hover { background: var(--surface-2); }
    .inv-feed-body { display: grid; gap: 2px; min-width: 0; }
    .inv-feed-body strong { font-size: 0.85rem; }
    .inv-feed-body span { color: var(--muted); font-size: 0.74rem; }
    .inv-feed-time { color: var(--muted); font-size: 0.72rem; white-space: nowrap; }
    .inv-feed-empty span { color: var(--muted); font-size: 0.8rem; }

    .inventory-module-launcher { overflow: hidden; }
    .inventory-module-launcher .section-title small { color: var(--muted); font-weight: 800; }
    .inventory-module-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
      gap: 12px;
    }
    .inventory-module-card {
      min-height: 132px;
      display: grid;
      align-content: start;
      gap: 10px;
      padding: 16px;
      border: 1px solid var(--line);
      border-top: 5px solid var(--teal);
      border-radius: 18px;
      background:
        radial-gradient(circle at top right, color-mix(in srgb, var(--teal) 10%, transparent), transparent 42%),
        #fff;
      color: var(--ink);
      text-decoration: none;
      box-shadow: 0 16px 36px color-mix(in srgb, var(--ink) 6%, transparent);
      transition: transform .16s ease, box-shadow .16s ease, border-color .16s ease;
    }
    .inventory-module-card:hover {
      transform: translateY(-2px);
      border-color: color-mix(in srgb, var(--teal) 35%, var(--line));
      box-shadow: 0 20px 44px color-mix(in srgb, var(--ink) 9%, transparent);
    }
    .inventory-module-card span, .inventory-module-card small {
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
    .inventory-module-card.blue { border-top-color: #2f5dcc; }
    .inventory-module-card.amber { border-top-color: #b26b00; }
    .inventory-module-card.green { border-top-color: #177245; }
    .inventory-module-card.violet { border-top-color: #6f3fc8; }
    .inventory-module-card.red { border-top-color: var(--red); }
    .inventory-module-card.slate { border-top-color: #475569; }
    .inventory-module-card.black { border-top-color: #162033; }
    .inventory-module-card.orange { border-top-color: #d95f02; }

    @media (max-width: 1180px) {
      .inv-metrics { grid-template-columns: repeat(3, minmax(0, 1fr)); }
      .inv-workspace { grid-template-columns: 1fr; }
    }
    @media (max-width: 760px) {
      .inventory-hero { align-items: stretch; }
      .inv-metrics { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .inv-form-row { grid-template-columns: 1fr; }
      .inv-field-wide { grid-column: span 1; }
    }
    @media (max-width: 480px) {
      .inv-metrics { grid-template-columns: 1fr; }
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
  readonly selectedSupplierId = signal('');
  readonly supplierWhatsappDraft = signal('');
  readonly scannerResult = signal('');
  scannerCode = '';
  whatIfDemandPct = 20;
  query = '';

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
    packSize: [0],
    packUnit: ['pcs'],
    usageType: ['retail'],
    supplier: [''],
    branchId: ['', Validators.required],
    stock: [0],
    lowStockThreshold: [5],
    expiryDate: [''],
    unitCost: [0],
    price: [0],
    gstRate: [18]
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

  constructor(private readonly api: ApiService, private readonly fb: UntypedFormBuilder) {}

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.loading.set(true);
    Promise.all([
      this.api.list<ApiRecord[]>('products', { branchId: this.api.selectedBranchId() }).toPromise(),
      this.api.list<ApiRecord[]>('products', { limit: 10000 }).toPromise(),
      this.api.list<ApiRecord[]>('inventory', { branchId: this.api.selectedBranchId(), limit: 100 }).toPromise(),
      this.api.list<ApiRecord[]>('branches').toPromise(),
      this.api.list<ApiRecord[]>('suppliers').toPromise(),
      this.api.list<ApiRecord[]>('inventoryBatches', { branchId: this.api.selectedBranchId(), limit: 100 }).toPromise(),
      this.api.list<ApiRecord[]>('services', { limit: 1000 }).toPromise(),
      this.api.list<ApiRecord[]>('sales', { branchId: this.api.selectedBranchId(), limit: 1000 }).toPromise(),
      this.api.list<ApiRecord[]>('inventory-intelligence/predictions', { limit: 5 }).toPromise(),
      this.api.list<ApiRecord>('inventory-intelligence/summary', { branchId: this.api.selectedBranchId() }).toPromise()
    ])
      .then(([products, allProducts, transactions, branches, suppliers, batches, services, sales, predictions, intelligence]) => {
        this.products.set(products || []);
        this.allProducts.set(allProducts || products || []);
        this.transactions.set(transactions || []);
        this.branches.set(branches || []);
        this.suppliers.set(suppliers || []);
        this.batches.set(batches || []);
        this.services.set(services || []);
        this.sales.set(sales || []);
        this.predictions.set(predictions || []);
        this.intelligence.set(intelligence || null);
        if (!this.selectedProductId() && products?.[0]?.id) this.selectedProductId.set(products[0].id);
        if (!this.selectedSupplierId() && suppliers?.[0]?.id) this.selectedSupplierId.set(suppliers[0].id);
        this.loading.set(false);
      })
      .catch((error) => {
        this.error.set(error?.error?.error || 'Unable to load inventory');
        this.loading.set(false);
      });
  }

  saveProduct(): void {
    if (this.productForm.invalid) return;
    this.saving.set(true);
    this.api.create('products', this.productForm.value).subscribe({
      next: () => {
        this.saving.set(false);
        this.showProductForm.set(false);
        this.load();
      },
      error: (error) => {
        this.error.set(error?.error?.error || 'Unable to save product');
        this.saving.set(false);
      }
    });
  }

  productBulkPreview(): string {
    const unit = String(this.productForm.value.unit || 'pcs').trim() || 'pcs';
    const packUnit = String(this.productForm.value.packUnit || unit).trim() || unit;
    const packSize = Number(this.productForm.value.packSize || 0);
    if (packSize > 0 && unit.toLowerCase() !== packUnit.toLowerCase()) {
      return `1 ${unit} = ${packSize} ${packUnit}`;
    }
    return 'Set like 1 bottle = 1000 ml or 1 tube = 60 gm';
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
    return this.products().filter((product) => JSON.stringify(product).toLowerCase().includes(this.query.toLowerCase()));
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
        reason: `${product.category || 'Retail'} aftercare available · margin ${this.productMargin(product).toFixed(0)} · ${product.stock} in stock`
      }));
  }

  scanProduct(): void {
    const code = this.scannerCode.trim().toLowerCase();
    const product = this.products().find((item) => String(item.sku || '').toLowerCase() === code || String(item.name || '').toLowerCase().includes(code));
    this.scannerResult.set(product ? `${product.name}: ${product.stock || 0} in stock, ₹${product.price || 0} price` : 'No product matched this scan.');
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
