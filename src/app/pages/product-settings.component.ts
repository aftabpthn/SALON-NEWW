import { CommonModule } from '@angular/common';
import { Component, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ApiRecord, ApiService } from '../core/api.service';

type ProductSettingsState = {
  productCatalog: {
    productsEnabled: boolean;
    skuRequired: boolean;
    barcodeRequired: boolean;
    brandRequired: boolean;
    categoryRequired: boolean;
    allowDuplicateSku: boolean;
  };
  stockControl: {
    stockTrackingEnabled: boolean;
    allowNegativeStock: boolean;
    lowStockAlertEnabled: boolean;
    defaultLowStockQty: number;
    expiryTrackingEnabled: boolean;
    batchTrackingEnabled: boolean;
  };
  pricingTax: {
    costPriceRequired: boolean;
    sellingPriceRequired: boolean;
    mrpRequired: boolean;
    productTaxEditable: boolean;
    defaultTaxPercent: number;
    allowDiscountOnProducts: boolean;
  };
  posBehavior: {
    visibleInPosByDefault: boolean;
    barcodeScanEnabled: boolean;
    quickAddFromPos: boolean;
    requireProductImage: boolean;
    showProductStockInPos: boolean;
  };
  productConsume: {
    allowProductConsume: boolean;
    requireRecipeForServiceConsume: boolean;
    wastageReasonRequired: boolean;
    ownerApprovalForHighWastage: boolean;
  };
  notifications: {
    notifyOwnerOnLowStock: boolean;
    notifyOwnerOnExpiryRisk: boolean;
    notifyOwnerOnNegativeStockAttempt: boolean;
  };
};

const DEFAULT_SETTINGS: ProductSettingsState = {
  productCatalog: {
    productsEnabled: true,
    skuRequired: true,
    barcodeRequired: false,
    brandRequired: false,
    categoryRequired: true,
    allowDuplicateSku: false
  },
  stockControl: {
    stockTrackingEnabled: true,
    allowNegativeStock: false,
    lowStockAlertEnabled: true,
    defaultLowStockQty: 5,
    expiryTrackingEnabled: true,
    batchTrackingEnabled: false
  },
  pricingTax: {
    costPriceRequired: true,
    sellingPriceRequired: true,
    mrpRequired: false,
    productTaxEditable: true,
    defaultTaxPercent: 18,
    allowDiscountOnProducts: true
  },
  posBehavior: {
    visibleInPosByDefault: true,
    barcodeScanEnabled: true,
    quickAddFromPos: false,
    requireProductImage: false,
    showProductStockInPos: true
  },
  productConsume: {
    allowProductConsume: true,
    requireRecipeForServiceConsume: true,
    wastageReasonRequired: true,
    ownerApprovalForHighWastage: true
  },
  notifications: {
    notifyOwnerOnLowStock: true,
    notifyOwnerOnExpiryRisk: true,
    notifyOwnerOnNegativeStockAttempt: true
  }
};

function cloneSettings(settings: ProductSettingsState): ProductSettingsState {
  return JSON.parse(JSON.stringify(settings)) as ProductSettingsState;
}

function boolValue(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function numberValue(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.round(parsed) : fallback;
}

@Component({
  selector: 'app-product-settings',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  template: `
    <section class="product-settings-page inner-page-shell">
      <aside class="settings-nav" aria-label="Settings sections">
        <a routerLink="/settings/general">General Settings</a>
        <a routerLink="/settings/services">Services Settings</a>
        <a routerLink="/settings/packages">Packages Settings</a>
        <a routerLink="/settings/membership">Membership Settings</a>
        <a routerLink="/settings/custom-fields">Custom Fields</a>
        <a routerLink="/settings/consent-forms">Consent Forms</a>
        <a routerLink="/setting/calendar">Calendar Settings</a>
        <a routerLink="/settings/booking">Booking Settings</a>
        <a routerLink="/settings/multiple-location">Multiple Location</a>
        <a class="active" routerLink="/settings/products">Products Settings</a>
        <a routerLink="/settings/supplier">Supplier Settings</a>
        <a routerLink="/settings/inventory">Inventory Settings</a>
        <a routerLink="/settings/clients/custom-form">Clients - Custom Form</a>
        <a routerLink="/settings/taxes">Tax Settings</a>
        <a routerLink="/settings/marketplace">Marketplace Settings</a>
        <a routerLink="/settings/others">Other Settings</a>
        <a routerLink="/settings/bill-setting">Bill Settings</a>
        <a routerLink="/settings/business-details">Business Details</a>
      <a routerLink="/settings/payment-methods">Payment Methods</a>
      <a routerLink="/settings/message-history">Message History</a>
      <a routerLink="/settings/sms-template">SMS Template</a>
      <a routerLink="/settings/security">Security</a>
      </aside>

      <main class="settings-content">
        <header class="settings-hero inner-page-header">
          <div>
            <span class="eyebrow">Setup / Products</span>
            <h1>Products Settings Control</h1>
            <p>Control product catalog rules, stock tracking, POS behavior, product consume guardrails and inventory notifications.</p>
          </div>
          <div class="hero-actions inner-action-bar">
            <button class="ghost-button" type="button" (click)="load()">Refresh</button>
            <button class="primary-button" type="button" (click)="save()" [disabled]="saving()">
              {{ saving() ? 'Saving...' : 'Save' }}
            </button>
          </div>
        </header>

        <p class="state success" *ngIf="message()">{{ message() }}</p>
        <p class="state danger" *ngIf="error()">{{ error() }}</p>
        <p class="phase-note">Next phase will connect product create/edit, POS billing, product consume and inventory alerts to these saved rules.</p>

        <section class="settings-grid inner-form-grid">
          <article class="settings-card inner-page-card">
            <h2>Product Catalog</h2>
            <ng-container *ngFor="let item of catalogControls">
              <label class="switch-row">
                <span><strong>{{ item.label }}</strong><small>{{ item.help }}</small></span>
                <input type="checkbox" [(ngModel)]="settings.productCatalog[item.key]" />
                <i aria-hidden="true"></i>
              </label>
            </ng-container>
          </article>

          <article class="settings-card inner-page-card">
            <h2>Stock Control</h2>
            <label class="switch-row">
              <span><strong>Stock Tracking Enabled</strong><small>Track product stock movement.</small></span>
              <input type="checkbox" [(ngModel)]="settings.stockControl.stockTrackingEnabled" />
              <i aria-hidden="true"></i>
            </label>
            <label class="switch-row">
              <span><strong>Allow Negative Stock</strong><small>Permit billing or consume when stock is below zero.</small></span>
              <input type="checkbox" [(ngModel)]="settings.stockControl.allowNegativeStock" />
              <i aria-hidden="true"></i>
            </label>
            <label class="switch-row">
              <span><strong>Low Stock Alert Enabled</strong><small>Notify when stock reaches threshold.</small></span>
              <input type="checkbox" [(ngModel)]="settings.stockControl.lowStockAlertEnabled" />
              <i aria-hidden="true"></i>
            </label>
            <label class="field-row">
              <span>Default Low Stock Qty</span>
              <input type="number" min="0" [(ngModel)]="settings.stockControl.defaultLowStockQty" />
            </label>
            <label class="switch-row">
              <span><strong>Expiry Tracking Enabled</strong><small>Track product expiry date.</small></span>
              <input type="checkbox" [(ngModel)]="settings.stockControl.expiryTrackingEnabled" />
              <i aria-hidden="true"></i>
            </label>
            <label class="switch-row">
              <span><strong>Batch Tracking Enabled</strong><small>Track product batch/lot number.</small></span>
              <input type="checkbox" [(ngModel)]="settings.stockControl.batchTrackingEnabled" />
              <i aria-hidden="true"></i>
            </label>
          </article>

          <article class="settings-card inner-page-card">
            <h2>Pricing & Tax</h2>
            <label class="switch-row">
              <span><strong>Cost Price Required</strong><small>Require cost price on product records.</small></span>
              <input type="checkbox" [(ngModel)]="settings.pricingTax.costPriceRequired" />
              <i aria-hidden="true"></i>
            </label>
            <label class="switch-row">
              <span><strong>Selling Price Required</strong><small>Require selling price before POS usage.</small></span>
              <input type="checkbox" [(ngModel)]="settings.pricingTax.sellingPriceRequired" />
              <i aria-hidden="true"></i>
            </label>
            <label class="switch-row">
              <span><strong>MRP Required</strong><small>Require product MRP entry.</small></span>
              <input type="checkbox" [(ngModel)]="settings.pricingTax.mrpRequired" />
              <i aria-hidden="true"></i>
            </label>
            <label class="switch-row">
              <span><strong>Product Tax Editable</strong><small>Allow product-level tax override.</small></span>
              <input type="checkbox" [(ngModel)]="settings.pricingTax.productTaxEditable" />
              <i aria-hidden="true"></i>
            </label>
            <label class="field-row">
              <span>Default Tax Percent</span>
              <input type="number" min="0" max="100" [(ngModel)]="settings.pricingTax.defaultTaxPercent" />
            </label>
            <label class="switch-row">
              <span><strong>Allow Discount on Products</strong><small>Allow POS product discounts.</small></span>
              <input type="checkbox" [(ngModel)]="settings.pricingTax.allowDiscountOnProducts" />
              <i aria-hidden="true"></i>
            </label>
          </article>

          <article class="settings-card inner-page-card">
            <h2>POS Behavior</h2>
            <ng-container *ngFor="let item of posControls">
              <label class="switch-row">
                <span><strong>{{ item.label }}</strong><small>{{ item.help }}</small></span>
                <input type="checkbox" [(ngModel)]="settings.posBehavior[item.key]" />
                <i aria-hidden="true"></i>
              </label>
            </ng-container>
          </article>

          <article class="settings-card inner-page-card">
            <h2>Product Consume</h2>
            <label class="switch-row">
              <span><strong>Allow Product Consume</strong><small>Enable internal product consumption workflow.</small></span>
              <input type="checkbox" [(ngModel)]="settings.productConsume.allowProductConsume" />
              <i aria-hidden="true"></i>
            </label>
            <label class="switch-row">
              <span><strong>Require Recipe for Service Consume</strong><small>Use service recipe as product lock for consume drafts.</small></span>
              <input type="checkbox" [(ngModel)]="settings.productConsume.requireRecipeForServiceConsume" />
              <i aria-hidden="true"></i>
            </label>
            <label class="switch-row">
              <span><strong>Wastage Reason Required</strong><small>Require reason when product wastage is entered.</small></span>
              <input type="checkbox" [(ngModel)]="settings.productConsume.wastageReasonRequired" />
              <i aria-hidden="true"></i>
            </label>
            <label class="switch-row">
              <span><strong>Owner Approval for High Wastage</strong><small>Route high wastage cases to owner approval.</small></span>
              <input type="checkbox" [(ngModel)]="settings.productConsume.ownerApprovalForHighWastage" />
              <i aria-hidden="true"></i>
            </label>
          </article>

          <article class="settings-card inner-page-card">
            <h2>Notifications</h2>
            <label class="switch-row">
              <span><strong>Notify Owner on Low Stock</strong><small>Owner receives low stock alert.</small></span>
              <input type="checkbox" [(ngModel)]="settings.notifications.notifyOwnerOnLowStock" />
              <i aria-hidden="true"></i>
            </label>
            <label class="switch-row">
              <span><strong>Notify Owner on Expiry Risk</strong><small>Owner receives product expiry risk alert.</small></span>
              <input type="checkbox" [(ngModel)]="settings.notifications.notifyOwnerOnExpiryRisk" />
              <i aria-hidden="true"></i>
            </label>
            <label class="switch-row">
              <span><strong>Notify Owner on Negative Stock Attempt</strong><small>Owner receives alert when negative stock is attempted.</small></span>
              <input type="checkbox" [(ngModel)]="settings.notifications.notifyOwnerOnNegativeStockAttempt" />
              <i aria-hidden="true"></i>
            </label>
          </article>

          <article class="settings-card preview-card">
            <h2>Policy Preview</h2>
            <div class="preview-list">
              <p><strong>Catalog:</strong> {{ settings.productCatalog.productsEnabled ? 'Products enabled' : 'Products disabled' }}, SKU {{ settings.productCatalog.skuRequired ? 'required' : 'optional' }}.</p>
              <p><strong>Stock:</strong> {{ settings.stockControl.stockTrackingEnabled ? 'tracking ON' : 'tracking OFF' }}, low stock at {{ settings.stockControl.defaultLowStockQty }}.</p>
              <p><strong>Tax:</strong> default {{ settings.pricingTax.defaultTaxPercent }}%, {{ settings.pricingTax.productTaxEditable ? 'editable' : 'locked' }}.</p>
              <p><strong>POS:</strong> {{ settings.posBehavior.visibleInPosByDefault ? 'visible by default' : 'hidden by default' }}, barcode {{ settings.posBehavior.barcodeScanEnabled ? 'ON' : 'OFF' }}.</p>
              <p><strong>Consume:</strong> {{ settings.productConsume.allowProductConsume ? 'enabled' : 'disabled' }}, wastage reason {{ settings.productConsume.wastageReasonRequired ? 'required' : 'optional' }}.</p>
              <p><strong>Alerts:</strong> {{ notificationSummary() }}.</p>
            </div>
          </article>
        </section>
      </main>
    </section>
  `,
  styles: [`
    :host { display: block; color: #0f2235; }
    .product-settings-page {
      display: grid;
      grid-template-columns: 220px minmax(0, 1fr);
      gap: 18px;
      padding: 20px;
      background: #f3f7f5;
      min-height: calc(100vh - 88px);
      overflow-x: hidden;
    }
    .settings-nav {
      align-self: start;
      position: sticky;
      top: 16px;
      display: grid;
      gap: 6px;
      padding: 18px 14px;
      background: #fff;
      border: 1px solid #d8e6df;
      border-radius: 14px;
      box-shadow: 0 20px 42px rgba(0, 27, 58, 0.06);
    }
    .settings-nav a {
      color: #0f2235;
      text-decoration: none;
      font-weight: 800;
      padding: 12px 14px;
      border-radius: 10px;
    }
    .settings-nav a.active,
    .settings-nav a:hover {
      color: #007b61;
      background: #e6f8f1;
    }
    .settings-content { display: grid; gap: 16px; min-width: 0; }
    .settings-hero,
    .settings-card {
      background: #fff;
      border: 1px solid #d8e6df;
      border-radius: 16px;
      box-shadow: 0 22px 48px rgba(0, 27, 58, 0.07);
      min-width: 0;
    }
    .settings-hero {
      display: flex;
      justify-content: space-between;
      gap: 18px;
      align-items: center;
      padding: 28px;
    }
    .eyebrow {
      display: block;
      color: #5a6a66;
      font-size: 12px;
      font-weight: 900;
      letter-spacing: 0;
      text-transform: uppercase;
      margin-bottom: 8px;
    }
    h1, h2, p { margin: 0; }
    h1 { font-size: 40px; line-height: 1.1; letter-spacing: 0; margin-bottom: 10px; }
    h2 { font-size: 16px; padding: 18px 20px; border-bottom: 1px solid #e2ebe7; }
    .settings-hero p,
    .phase-note { color: #52655f; font-size: 15px; line-height: 1.5; }
    .hero-actions { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
    button { border: 0; cursor: pointer; font: inherit; font-weight: 900; }
    .primary-button,
    .ghost-button {
      min-height: 46px;
      border-radius: 10px;
      padding: 0 18px;
    }
    .primary-button { color: #fff; background: #07966f; box-shadow: 0 16px 32px rgba(7, 150, 111, 0.18); }
    .primary-button:disabled { opacity: 0.6; cursor: wait; }
    .ghost-button { color: #0f2235; background: #fff; border: 1px solid #d8e6df; }
    .state,
    .phase-note { padding: 12px 14px; border-radius: 10px; font-weight: 800; }
    .state.success { color: #006344; background: #e4fff2; border: 1px solid #9de8c4; }
    .state.danger { color: #b42318; background: #fff0ee; border: 1px solid #ffcdc7; }
    .phase-note { color: #8a5a00; background: #fff8e7; border: 1px solid #ffd275; }
    .settings-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(280px, 1fr));
      gap: 16px;
      min-width: 0;
    }
    .switch-row {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto auto;
      align-items: center;
      gap: 14px;
      min-height: 70px;
      padding: 12px 16px;
      border-bottom: 1px solid #e6eeeb;
    }
    .switch-row:last-child,
    .field-row:last-child { border-bottom: 0; }
    .switch-row span { display: grid; gap: 3px; min-width: 0; }
    .switch-row small { color: #60736d; font-size: 13px; line-height: 1.35; }
    .switch-row input[type="checkbox"] { position: absolute; opacity: 0; pointer-events: none; }
    .switch-row i {
      position: relative;
      width: 58px;
      height: 30px;
      flex: 0 0 auto;
      border-radius: 999px;
      background: #c6cbd0;
      transition: background 0.16s ease;
    }
    .switch-row i::after {
      content: '';
      position: absolute;
      top: 5px;
      left: 6px;
      width: 20px;
      height: 20px;
      border-radius: 999px;
      background: #fff;
      transition: transform 0.16s ease;
    }
    .switch-row input:checked + i { background: #20242b; }
    .switch-row input:checked + i::after { transform: translateX(26px); }
    .field-row {
      display: grid;
      gap: 8px;
      min-width: 0;
      padding: 14px 16px;
      border-bottom: 1px solid #edf2f0;
      font-weight: 800;
    }
    input[type="number"] {
      width: 100%;
      min-width: 0;
      border: 1px solid #d4dfda;
      border-radius: 9px;
      background: #f7f8f8;
      color: #0f2235;
      font: inherit;
      padding: 12px 14px;
      box-sizing: border-box;
    }
    .preview-card { grid-column: 1 / -1; }
    .preview-list {
      display: grid;
      grid-template-columns: repeat(2, minmax(240px, 1fr));
      gap: 12px;
      padding: 18px;
    }
    .preview-list p {
      padding: 14px;
      border: 1px solid #d8e6df;
      border-radius: 12px;
      background: #f7fbfa;
      color: #263a4d;
      line-height: 1.45;
    }
    @media (max-width: 1100px) {
      .product-settings-page { grid-template-columns: 1fr; }
      .settings-nav { position: static; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); }
    }
    @media (max-width: 800px) {
      .settings-grid,
      .preview-list { grid-template-columns: 1fr; }
      .settings-hero { align-items: stretch; flex-direction: column; padding: 20px; }
      h1 { font-size: 32px; }
    }
  `]
})
export class ProductSettingsComponent implements OnInit {
  saving = signal(false);
  message = signal('');
  error = signal('');
  settings = cloneSettings(DEFAULT_SETTINGS);

  readonly catalogControls: Array<{ key: keyof ProductSettingsState['productCatalog']; label: string; help: string }> = [
    { key: 'productsEnabled', label: 'Products Enabled', help: 'Enable product catalog and inventory product usage.' },
    { key: 'skuRequired', label: 'SKU Required', help: 'Require SKU while creating products.' },
    { key: 'barcodeRequired', label: 'Barcode Required', help: 'Require barcode for scan-ready product setup.' },
    { key: 'brandRequired', label: 'Brand Required', help: 'Require brand details on products.' },
    { key: 'categoryRequired', label: 'Category Required', help: 'Require product category.' },
    { key: 'allowDuplicateSku', label: 'Allow Duplicate SKU', help: 'Permit same SKU across product records.' }
  ];

  readonly posControls: Array<{ key: keyof ProductSettingsState['posBehavior']; label: string; help: string }> = [
    { key: 'visibleInPosByDefault', label: 'Visible in POS by Default', help: 'New products appear in POS billing.' },
    { key: 'barcodeScanEnabled', label: 'Barcode Scan Enabled', help: 'Allow barcode scanning in POS.' },
    { key: 'quickAddFromPos', label: 'Quick Add from POS', help: 'Allow product creation during billing.' },
    { key: 'requireProductImage', label: 'Require Product Image', help: 'Require product image before POS visibility.' },
    { key: 'showProductStockInPos', label: 'Show Product Stock in POS', help: 'Show available stock while billing.' }
  ];

  constructor(private readonly api: ApiService) {}

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.error.set('');
    this.message.set('');
    this.api.list<{ settings?: ApiRecord }>('settings/products').subscribe({
      next: (result) => {
        this.settings = this.normalize(result.settings);
      },
      error: (err) => {
        this.error.set(err?.error?.message || err?.message || 'Unable to load product settings');
        this.settings = cloneSettings(DEFAULT_SETTINGS);
      }
    });
  }

  save(): void {
    this.saving.set(true);
    this.error.set('');
    this.message.set('');
    const settings = this.normalize(this.settings);
    this.api.put<{ settings?: ApiRecord }>('settings/products', { settings }).subscribe({
      next: (result) => {
        this.settings = this.normalize(result.settings || settings);
        this.message.set('Product settings saved');
        this.saving.set(false);
      },
      error: (err) => {
        this.error.set(err?.error?.message || err?.message || 'Unable to save product settings');
        this.saving.set(false);
      }
    });
  }

  notificationSummary(): string {
    const enabled = [
      this.settings.notifications.notifyOwnerOnLowStock ? 'low stock' : '',
      this.settings.notifications.notifyOwnerOnExpiryRisk ? 'expiry risk' : '',
      this.settings.notifications.notifyOwnerOnNegativeStockAttempt ? 'negative stock attempt' : ''
    ].filter(Boolean);
    return enabled.length ? enabled.join(', ') : 'no product alerts';
  }

  private normalize(input: unknown): ProductSettingsState {
    const source = (input || {}) as ProductSettingsState;
    const defaults = DEFAULT_SETTINGS;
    const productCatalog = source.productCatalog || defaults.productCatalog;
    const stockControl = source.stockControl || defaults.stockControl;
    const pricingTax = source.pricingTax || defaults.pricingTax;
    const posBehavior = source.posBehavior || defaults.posBehavior;
    const productConsume = source.productConsume || defaults.productConsume;
    const notifications = source.notifications || defaults.notifications;
    return {
      productCatalog: {
        productsEnabled: boolValue(productCatalog.productsEnabled, defaults.productCatalog.productsEnabled),
        skuRequired: boolValue(productCatalog.skuRequired, defaults.productCatalog.skuRequired),
        barcodeRequired: boolValue(productCatalog.barcodeRequired, defaults.productCatalog.barcodeRequired),
        brandRequired: boolValue(productCatalog.brandRequired, defaults.productCatalog.brandRequired),
        categoryRequired: boolValue(productCatalog.categoryRequired, defaults.productCatalog.categoryRequired),
        allowDuplicateSku: boolValue(productCatalog.allowDuplicateSku, defaults.productCatalog.allowDuplicateSku)
      },
      stockControl: {
        stockTrackingEnabled: boolValue(stockControl.stockTrackingEnabled, defaults.stockControl.stockTrackingEnabled),
        allowNegativeStock: boolValue(stockControl.allowNegativeStock, defaults.stockControl.allowNegativeStock),
        lowStockAlertEnabled: boolValue(stockControl.lowStockAlertEnabled, defaults.stockControl.lowStockAlertEnabled),
        defaultLowStockQty: numberValue(stockControl.defaultLowStockQty, defaults.stockControl.defaultLowStockQty),
        expiryTrackingEnabled: boolValue(stockControl.expiryTrackingEnabled, defaults.stockControl.expiryTrackingEnabled),
        batchTrackingEnabled: boolValue(stockControl.batchTrackingEnabled, defaults.stockControl.batchTrackingEnabled)
      },
      pricingTax: {
        costPriceRequired: boolValue(pricingTax.costPriceRequired, defaults.pricingTax.costPriceRequired),
        sellingPriceRequired: boolValue(pricingTax.sellingPriceRequired, defaults.pricingTax.sellingPriceRequired),
        mrpRequired: boolValue(pricingTax.mrpRequired, defaults.pricingTax.mrpRequired),
        productTaxEditable: boolValue(pricingTax.productTaxEditable, defaults.pricingTax.productTaxEditable),
        defaultTaxPercent: numberValue(pricingTax.defaultTaxPercent, defaults.pricingTax.defaultTaxPercent),
        allowDiscountOnProducts: boolValue(pricingTax.allowDiscountOnProducts, defaults.pricingTax.allowDiscountOnProducts)
      },
      posBehavior: {
        visibleInPosByDefault: boolValue(posBehavior.visibleInPosByDefault, defaults.posBehavior.visibleInPosByDefault),
        barcodeScanEnabled: boolValue(posBehavior.barcodeScanEnabled, defaults.posBehavior.barcodeScanEnabled),
        quickAddFromPos: boolValue(posBehavior.quickAddFromPos, defaults.posBehavior.quickAddFromPos),
        requireProductImage: boolValue(posBehavior.requireProductImage, defaults.posBehavior.requireProductImage),
        showProductStockInPos: boolValue(posBehavior.showProductStockInPos, defaults.posBehavior.showProductStockInPos)
      },
      productConsume: {
        allowProductConsume: boolValue(productConsume.allowProductConsume, defaults.productConsume.allowProductConsume),
        requireRecipeForServiceConsume: boolValue(productConsume.requireRecipeForServiceConsume, defaults.productConsume.requireRecipeForServiceConsume),
        wastageReasonRequired: boolValue(productConsume.wastageReasonRequired, defaults.productConsume.wastageReasonRequired),
        ownerApprovalForHighWastage: boolValue(productConsume.ownerApprovalForHighWastage, defaults.productConsume.ownerApprovalForHighWastage)
      },
      notifications: {
        notifyOwnerOnLowStock: boolValue(notifications.notifyOwnerOnLowStock, defaults.notifications.notifyOwnerOnLowStock),
        notifyOwnerOnExpiryRisk: boolValue(notifications.notifyOwnerOnExpiryRisk, defaults.notifications.notifyOwnerOnExpiryRisk),
        notifyOwnerOnNegativeStockAttempt: boolValue(notifications.notifyOwnerOnNegativeStockAttempt, defaults.notifications.notifyOwnerOnNegativeStockAttempt)
      }
    };
  }
}
