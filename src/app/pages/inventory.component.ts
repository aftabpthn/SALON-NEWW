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
          <a class="ghost-button" routerLink="/inventory/reports">Inventory report</a>
          <a class="ghost-button" routerLink="/inventory/purchase-bill-drafts">AI bill drafts</a>
          <a class="ghost-button" routerLink="/inventory/purchase-orders">Purchase orders</a>
          <a class="ghost-button" routerLink="/inventory/recipes">Service recipes</a>
          <a class="ghost-button" routerLink="/inventory/stock-audit">Stock audit</a>
          <a class="ghost-button" routerLink="/inventory/scanner">Scanner</a>
          <button class="ghost-button" type="button" (click)="runReorder()">Generate reorder</button>
          <button class="primary-button" type="button" (click)="activeDesk.set('product'); showProductForm.set(true)">Add product</button>
        </div>
      </div>

      <app-state [loading]="loading()" [error]="error()"></app-state>

      <section class="inventory-command-board" *ngIf="commandMetrics() as metrics">
        <article class="command-metric teal">
          <span>Live stock value</span>
          <strong>{{ metrics.stockValue | currency: 'INR':'symbol':'1.0-0' }}</strong>
          <small>{{ metrics.products }} active products</small>
        </article>
        <article class="command-metric amber">
          <span>Low stock</span>
          <strong>{{ metrics.lowStock }}</strong>
          <small>{{ metrics.branchShortage }} branch shortage signals</small>
        </article>
        <article class="command-metric red">
          <span>Expiry + dead stock</span>
          <strong>{{ metrics.expiryRisk + metrics.deadStock }}</strong>
          <small>{{ metrics.expiryRisk }} expiry · {{ metrics.deadStock }} dead stock</small>
        </article>
        <article class="command-metric blue">
          <span>Purchase spend</span>
          <strong>{{ metrics.purchaseSpend | currency: 'INR':'symbol':'1.0-0' }}</strong>
          <small>{{ metrics.supplierPending }} supplier pending drafts</small>
        </article>
        <article class="command-metric purple">
          <span>Wastage</span>
          <strong>{{ metrics.wasteCost | currency: 'INR':'symbol':'1.0-0' }}</strong>
          <small>FIFO and expiry control</small>
        </article>
        <article class="command-metric black">
          <span>Margin leakage</span>
          <strong>{{ metrics.marginLeakage | currency: 'INR':'symbol':'1.0-0' }}</strong>
          <small>Loss from waste or weak margin</small>
        </article>
      </section>

      <section class="panel inventory-module-launcher">
        <div class="section-title">
          <div>
            <span class="eyebrow">Separated inventory workspaces</span>
            <h2>Open each command area on its own page</h2>
          </div>
          <small>No more squeezed cards in one long dashboard.</small>
        </div>
        <div class="inventory-module-grid">
          <a class="inventory-module-card teal" routerLink="/inventory/reorder">
            <span>AI reorder autopilot</span>
            <strong>Approval-safe purchase plan</strong>
            <small>{{ autopilotSuggestions().length }} live suggestion(s)</small>
          </a>
          <a class="inventory-module-card blue" routerLink="/inventory/product-360">
            <span>Product 360</span>
            <strong>{{ selectedProduct().name || 'Product intelligence' }}</strong>
            <small>Stock, margin, batches and usage</small>
          </a>
          <a class="inventory-module-card amber" routerLink="/inventory/supplier-360">
            <span>Supplier 360</span>
            <strong>{{ selectedSupplier().name || 'Supplier intelligence' }}</strong>
            <small>GSTIN, purchase, risk and WhatsApp PO</small>
          </a>
          <a class="inventory-module-card green" routerLink="/inventory/recipes">
            <span>Service Recipe / BOM</span>
            <strong>Professional stock usage</strong>
            <small>{{ unmappedRecipeCount() }} service(s) need setup</small>
          </a>
          <a class="inventory-module-card violet" routerLink="/inventory/fifo">
            <span>Batch + expiry + FIFO</span>
            <strong>Next stock to consume</strong>
            <small>{{ fifoBatches().length }} active batch(es)</small>
          </a>
          <a class="inventory-module-card red" routerLink="/inventory/stock-audit">
            <span>Audit + leakage detection</span>
            <strong>Expected vs actual risk</strong>
            <small>{{ stockAuditRows().length }} risk signal(s)</small>
          </a>
          <a class="inventory-module-card slate" routerLink="/inventory/stock-audit" [queryParams]="{ focus: 'transfer' }">
            <span>Branch transfer optimizer</span>
            <strong>Move stock before buying</strong>
            <small>{{ transferRecommendations().length }} transfer idea(s)</small>
          </a>
          <a class="inventory-module-card black" routerLink="/inventory/financial">
            <span>Financial brain</span>
            <strong>COGS, cash and margin</strong>
            <small>{{ financialBrain().cashLocked | currency: 'INR':'symbol':'1.0-0' }} cash locked</small>
          </a>
          <a class="inventory-module-card orange" routerLink="/inventory/scanner">
            <span>Scanner + digital twin</span>
            <strong>Barcode, WhatsApp and scenarios</strong>
            <small>{{ digitalTwin().stockouts }} projected stockout(s)</small>
          </a>
          <a class="inventory-module-card teal" routerLink="/pos">
            <span>Inventory-to-POS intelligence</span>
            <strong>Retail upsell hints for checkout</strong>
            <small>{{ posUpsellHints().length }} retail hint(s)</small>
          </a>
        </div>
      </section>

      <ng-container *ngIf="intelligence() as intelligence">
        <div class="metrics-grid inventory-kpis">
          <aura-kpi-card tone="teal" target="/kpi-details/inventory/stock-value">
            <span>Stock value</span>
            <strong>{{ intelligence.metrics.stockValue | currency: 'INR':'symbol':'1.0-0' }}</strong>
            <small>{{ intelligence.metrics.products }} products · click for value report</small>
          </aura-kpi-card>
          <aura-kpi-card tone="amber" target="/kpi-details/inventory/reorder-suggestions">
            <span>Reorder suggestions</span>
            <strong>{{ intelligence.metrics.reorderCount }}</strong>
            <small>Open purchase prediction</small>
          </aura-kpi-card>
          <aura-kpi-card tone="red" target="/kpi-details/inventory/expiring-soon">
            <span>Expiring soon</span>
            <strong>{{ intelligence.metrics.expiringSoon }}</strong>
            <small>Open batch expiry alerts</small>
          </aura-kpi-card>
          <aura-kpi-card tone="blue" target="/kpi-details/inventory/waste-cost">
            <span>Waste cost</span>
            <strong>{{ intelligence.metrics.wasteCost | currency: 'INR':'symbol':'1.0-0' }}</strong>
            <small>Open waste analysis</small>
          </aura-kpi-card>
        </div>
      </ng-container>

      <section class="panel operations-panel">
        <div class="section-title">
          <div>
            <span class="eyebrow">Inventory operations</span>
            <h2>Single compact work desk</h2>
          </div>
          <div class="section-actions">
            <small>Choose one task instead of scrolling through every form.</small>
            <button class="ghost-button" *ngIf="activeDesk()" type="button" (click)="activeDesk.set('')">Close desk</button>
          </div>
        </div>
        <div class="desk-tabs">
          <button type="button" [class.active]="activeDesk() === 'stock'" (click)="activeDesk.set('stock')">Stock movement</button>
          <button type="button" [class.active]="activeDesk() === 'product'" (click)="activeDesk.set('product'); showProductForm.set(true)">Product setup</button>
          <button type="button" [class.active]="activeDesk() === 'batch'" (click)="activeDesk.set('batch')">Receive batch</button>
          <button type="button" [class.active]="activeDesk() === 'supplier'" (click)="activeDesk.set('supplier')">Supplier</button>
          <button type="button" [class.active]="activeDesk() === 'waste'" (click)="activeDesk.set('waste')">Waste / expiry</button>
        </div>

        <ng-template #closedDesk>
          <div class="desk-closed">
            <button type="button" (click)="activeDesk.set('stock')">
              <strong>Stock movement</strong>
              <span>Purchase, adjustment or expiry write-off.</span>
            </button>
            <button type="button" (click)="activeDesk.set('product'); showProductForm.set(true)">
              <strong>Product setup</strong>
              <span>Create retail or professional stock item.</span>
            </button>
            <button type="button" (click)="activeDesk.set('batch')">
              <strong>Receive batch</strong>
              <span>Batch, supplier and expiry entry.</span>
            </button>
            <button type="button" (click)="activeDesk.set('supplier')">
              <strong>Supplier</strong>
              <span>Vendor details and GST metadata.</span>
            </button>
            <button type="button" (click)="activeDesk.set('waste')">
              <strong>Waste / expiry</strong>
              <span>Track salon loss without scrolling.</span>
            </button>
          </div>
        </ng-template>

        <div class="desk-body" *ngIf="activeDesk(); else closedDesk" [ngSwitch]="activeDesk()">
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
              <select formControlName="unit">
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
              <span>Pack size</span>
              <input type="number" min="0" step="0.01" formControlName="packSize" placeholder="1000" />
            </label>
            <label class="field">
              <span>Consume unit</span>
              <select formControlName="packUnit">
                <option value="ml">ml</option>
                <option value="gm">gm</option>
                <option value="g">g</option>
                <option value="kg">kg</option>
                <option value="l">l</option>
                <option value="pcs">pcs</option>
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
            <div class="form-actions">
              <button class="ghost-button" type="button" (click)="activeDesk.set(''); showProductForm.set(false)">Cancel</button>
              <button class="primary-button" type="submit" [disabled]="productForm.invalid || saving()">Save product</button>
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
                <option *ngFor="let batch of batchesForProduct(wasteForm.value.productId)" [value]="batch.id">{{ batch.batchNumber }} · {{ batch.quantityAvailable }} left</option>
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

      <div class="inventory-data-grid">
        <section class="panel product-panel">
          <div class="table-toolbar">
            <label class="search-field"><span>Search products</span><input [(ngModel)]="query" /></label>
            <button class="ghost-button" type="button" (click)="load()">Refresh</button>
          </div>
          <div class="table-wrap product-table">
            <table>
              <thead>
                <tr>
                  <th>Product</th>
                  <th>Type</th>
                  <th>Supplier</th>
                  <th>Branch</th>
                  <th>Stock</th>
                  <th>Price</th>
                  <th>Expiry</th>
                </tr>
              </thead>
              <tbody>
                <tr *ngFor="let product of filteredProducts()">
                  <td><strong>{{ product.name }}</strong><small>{{ product.sku }}</small></td>
                  <td><span class="badge">{{ product.usageType }}</span></td>
                  <td>{{ product.supplier }}</td>
                  <td>{{ product.branchId }}</td>
                  <td>{{ product.stock }}</td>
                  <td>{{ product.price | currency: 'INR':'symbol':'1.0-0' }}</td>
                  <td>{{ product.expiryDate | date: 'mediumDate' }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        <section class="panel side-summary">
          <div class="section-title">
            <div>
              <span class="eyebrow">Live inventory feed</span>
              <h2>Recent movements</h2>
            </div>
            <a class="ghost-button" routerLink="/kpi-details/inventory/waste-cost">Open report</a>
          </div>
          <div class="activity-list compact-feed">
            <article *ngFor="let transaction of transactions().slice(0, 6)">
              <strong>{{ productName(transaction.productId) }} · {{ transaction.type }}</strong>
              <span>{{ transaction.quantity }} units · {{ transaction.reason }} · {{ transaction.createdAt | date: 'short' }}</span>
            </article>
            <article *ngIf="!transactions().length">
              <strong>No movements yet</strong>
              <span>Stock activity will appear after purchase, POS or adjustment.</span>
            </article>
          </div>
        </section>
      </div>
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
      border-top: 4px solid var(--teal);
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
    .command-metric.red { border-top-color: var(--red); }
    .command-metric.blue { border-top-color: #2f5dcc; }
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

    .inventory-module-card.blue { border-top-color: #2f5dcc; }
    .inventory-module-card.amber { border-top-color: #b26b00; }
    .inventory-module-card.green { border-top-color: #177245; }
    .inventory-module-card.violet { border-top-color: #6f3fc8; }
    .inventory-module-card.red { border-top-color: var(--red); }
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
      background: #f7fbfa;
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

    .inventory-kpis aura-kpi-card {
      --kpi-min-height: 72px;
      --kpi-padding: 10px 12px;
      --kpi-gap: 3px;
      --kpi-strong-size: 1.25rem;
      --kpi-small-size: 0.72rem;
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
      border-color: var(--teal);
      background: var(--teal);
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
      background: var(--surface-2);
    }

    .compact-feed {
      max-height: 292px;
      overflow: auto;
      padding-right: 4px;
    }

    .compact-feed article {
      padding: 10px 0;
    }

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
