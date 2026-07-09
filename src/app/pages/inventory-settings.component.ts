import { CommonModule } from '@angular/common';
import { Component, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ApiRecord, ApiService } from '../core/api.service';

type InventorySettingsState = {
  inventoryControl: {
    inventoryEnabled: boolean;
    stockAuditEnabled: boolean;
    fifoCostingEnabled: boolean;
    multiWarehouseEnabled: boolean;
    requireReasonForAdjustment: boolean;
    ownerApprovalForManualAdjustment: boolean;
  };
  stockMovement: {
    inwardEnabled: boolean;
    outwardEnabled: boolean;
    transferEnabled: boolean;
    damagedStockTracking: boolean;
    expiredStockTracking: boolean;
    allowBackdatedMovement: boolean;
  };
  reorderRules: {
    autoReorderSuggestions: boolean;
    defaultReorderLevel: number;
    defaultReorderQty: number;
    lowStockAlertEnabled: boolean;
    stockoutAlertEnabled: boolean;
    supplierSuggestionEnabled: boolean;
  };
  warehouseRules: {
    defaultWarehouseRequired: boolean;
    branchWarehouseIsolation: boolean;
    interBranchTransferApproval: boolean;
    stockReservationEnabled: boolean;
  };
  consumeRules: {
    serviceRecipeRequired: boolean;
    consumeDraftAutoCreate: boolean;
    allowExtraProductConsume: boolean;
    wastageLimitEnabled: boolean;
    highWastageApprovalRequired: boolean;
  };
  notifications: {
    notifyOwnerLowStock: boolean;
    notifyOwnerStockout: boolean;
    notifyOwnerManualAdjustment: boolean;
    notifyOwnerHighWastage: boolean;
    notifyOwnerExpiryRisk: boolean;
  };
};

const DEFAULT_SETTINGS: InventorySettingsState = {
  inventoryControl: {
    inventoryEnabled: true,
    stockAuditEnabled: true,
    fifoCostingEnabled: true,
    multiWarehouseEnabled: false,
    requireReasonForAdjustment: true,
    ownerApprovalForManualAdjustment: true
  },
  stockMovement: {
    inwardEnabled: true,
    outwardEnabled: true,
    transferEnabled: true,
    damagedStockTracking: true,
    expiredStockTracking: true,
    allowBackdatedMovement: false
  },
  reorderRules: {
    autoReorderSuggestions: true,
    defaultReorderLevel: 10,
    defaultReorderQty: 20,
    lowStockAlertEnabled: true,
    stockoutAlertEnabled: true,
    supplierSuggestionEnabled: true
  },
  warehouseRules: {
    defaultWarehouseRequired: false,
    branchWarehouseIsolation: true,
    interBranchTransferApproval: true,
    stockReservationEnabled: true
  },
  consumeRules: {
    serviceRecipeRequired: true,
    consumeDraftAutoCreate: true,
    allowExtraProductConsume: true,
    wastageLimitEnabled: true,
    highWastageApprovalRequired: true
  },
  notifications: {
    notifyOwnerLowStock: true,
    notifyOwnerStockout: true,
    notifyOwnerManualAdjustment: true,
    notifyOwnerHighWastage: true,
    notifyOwnerExpiryRisk: true
  }
};

function cloneSettings(settings: InventorySettingsState): InventorySettingsState {
  return JSON.parse(JSON.stringify(settings)) as InventorySettingsState;
}

function boolValue(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function numberValue(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.round(parsed) : fallback;
}

@Component({
  selector: 'app-inventory-settings',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  template: `
    <section class="inventory-settings-page inner-page-shell">
      <aside class="settings-nav" aria-label="Settings sections">
        <a routerLink="/settings/general">General Settings</a>
        <a routerLink="/settings/products">Products Settings</a>
        <a routerLink="/settings/supplier">Supplier Settings</a>
        <a class="active" routerLink="/settings/inventory">Inventory Settings</a>
        <a routerLink="/settings/services">Services Settings</a>
        <a routerLink="/settings/packages">Packages Settings</a>
        <a routerLink="/settings/membership">Membership Settings</a>
        <a routerLink="/settings/custom-fields">Custom Fields</a>
        <a routerLink="/settings/consent-forms">Consent Forms</a>
        <a routerLink="/setting/calendar">Calendar Settings</a>
        <a routerLink="/settings/booking">Booking Settings</a>
        <a routerLink="/settings/multiple-location">Multiple Location</a>
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
            <span class="eyebrow">Setup / Inventory</span>
            <h1>Inventory Settings Control</h1>
            <p>Control stock audit, FIFO costing, stock movement, reorder rules, warehouse behavior, product consume and owner alerts.</p>
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
        <p class="phase-note">Next phase will connect stock movement, FIFO reports, reorder, warehouse transfer and product consume flows to these saved rules.</p>

        <section class="settings-grid inner-form-grid">
          <article class="settings-card inner-page-card">
            <h2>Inventory Control</h2>
            <ng-container *ngFor="let item of inventoryControls">
              <label class="switch-row">
                <span><strong>{{ item.label }}</strong><small>{{ item.help }}</small></span>
                <input type="checkbox" [(ngModel)]="settings.inventoryControl[item.key]" />
                <i aria-hidden="true"></i>
              </label>
            </ng-container>
          </article>

          <article class="settings-card inner-page-card">
            <h2>Stock Movement</h2>
            <ng-container *ngFor="let item of stockMovementControls">
              <label class="switch-row">
                <span><strong>{{ item.label }}</strong><small>{{ item.help }}</small></span>
                <input type="checkbox" [(ngModel)]="settings.stockMovement[item.key]" />
                <i aria-hidden="true"></i>
              </label>
            </ng-container>
          </article>

          <article class="settings-card inner-page-card">
            <h2>Reorder Rules</h2>
            <label class="switch-row">
              <span><strong>Auto Reorder Suggestions</strong><small>Suggest reorder actions from stock levels.</small></span>
              <input type="checkbox" [(ngModel)]="settings.reorderRules.autoReorderSuggestions" />
              <i aria-hidden="true"></i>
            </label>
            <label class="field-row">
              <span>Default Reorder Level</span>
              <input type="number" min="0" [(ngModel)]="settings.reorderRules.defaultReorderLevel" />
            </label>
            <label class="field-row">
              <span>Default Reorder Qty</span>
              <input type="number" min="0" [(ngModel)]="settings.reorderRules.defaultReorderQty" />
            </label>
            <label class="switch-row">
              <span><strong>Low Stock Alert Enabled</strong><small>Alert before stockout.</small></span>
              <input type="checkbox" [(ngModel)]="settings.reorderRules.lowStockAlertEnabled" />
              <i aria-hidden="true"></i>
            </label>
            <label class="switch-row">
              <span><strong>Stockout Alert Enabled</strong><small>Alert when product stock is zero.</small></span>
              <input type="checkbox" [(ngModel)]="settings.reorderRules.stockoutAlertEnabled" />
              <i aria-hidden="true"></i>
            </label>
            <label class="switch-row">
              <span><strong>Supplier Suggestion Enabled</strong><small>Suggest supplier for reorder.</small></span>
              <input type="checkbox" [(ngModel)]="settings.reorderRules.supplierSuggestionEnabled" />
              <i aria-hidden="true"></i>
            </label>
          </article>

          <article class="settings-card inner-page-card">
            <h2>Warehouse Rules</h2>
            <ng-container *ngFor="let item of warehouseControls">
              <label class="switch-row">
                <span><strong>{{ item.label }}</strong><small>{{ item.help }}</small></span>
                <input type="checkbox" [(ngModel)]="settings.warehouseRules[item.key]" />
                <i aria-hidden="true"></i>
              </label>
            </ng-container>
          </article>

          <article class="settings-card inner-page-card">
            <h2>Product Consume</h2>
            <ng-container *ngFor="let item of consumeControls">
              <label class="switch-row">
                <span><strong>{{ item.label }}</strong><small>{{ item.help }}</small></span>
                <input type="checkbox" [(ngModel)]="settings.consumeRules[item.key]" />
                <i aria-hidden="true"></i>
              </label>
            </ng-container>
          </article>

          <article class="settings-card inner-page-card">
            <h2>Notifications</h2>
            <ng-container *ngFor="let item of notificationControls">
              <label class="switch-row">
                <span><strong>{{ item.label }}</strong><small>{{ item.help }}</small></span>
                <input type="checkbox" [(ngModel)]="settings.notifications[item.key]" />
                <i aria-hidden="true"></i>
              </label>
            </ng-container>
          </article>

          <article class="settings-card preview-card">
            <h2>Policy Preview</h2>
            <div class="preview-list">
              <p><strong>Inventory:</strong> {{ settings.inventoryControl.inventoryEnabled ? 'enabled' : 'disabled' }}, FIFO {{ settings.inventoryControl.fifoCostingEnabled ? 'ON' : 'OFF' }}.</p>
              <p><strong>Movement:</strong> inward {{ settings.stockMovement.inwardEnabled ? 'ON' : 'OFF' }}, transfer {{ settings.stockMovement.transferEnabled ? 'ON' : 'OFF' }}.</p>
              <p><strong>Reorder:</strong> level {{ settings.reorderRules.defaultReorderLevel }}, qty {{ settings.reorderRules.defaultReorderQty }}.</p>
              <p><strong>Warehouse:</strong> {{ settings.warehouseRules.branchWarehouseIsolation ? 'branch isolated' : 'shared' }}, transfer approval {{ settings.warehouseRules.interBranchTransferApproval ? 'required' : 'not required' }}.</p>
              <p><strong>Consume:</strong> recipe {{ settings.consumeRules.serviceRecipeRequired ? 'required' : 'optional' }}, wastage limit {{ settings.consumeRules.wastageLimitEnabled ? 'ON' : 'OFF' }}.</p>
              <p><strong>Alerts:</strong> {{ notificationSummary() }}.</p>
            </div>
          </article>
        </section>
      </main>
    </section>
  `,
  styles: [`
    :host { display: block; color: #0f2235; }
    .inventory-settings-page {
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
      .inventory-settings-page { grid-template-columns: 1fr; }
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
export class InventorySettingsComponent implements OnInit {
  saving = signal(false);
  message = signal('');
  error = signal('');
  settings = cloneSettings(DEFAULT_SETTINGS);

  readonly inventoryControls: Array<{ key: keyof InventorySettingsState['inventoryControl']; label: string; help: string }> = [
    { key: 'inventoryEnabled', label: 'Inventory Enabled', help: 'Enable inventory command and stock controls.' },
    { key: 'stockAuditEnabled', label: 'Stock Audit Enabled', help: 'Enable stock audit workflow.' },
    { key: 'fifoCostingEnabled', label: 'FIFO Costing Enabled', help: 'Use FIFO/WMA-compatible stock valuation rules.' },
    { key: 'multiWarehouseEnabled', label: 'Multi Warehouse Enabled', help: 'Allow warehouse-level stock control.' },
    { key: 'requireReasonForAdjustment', label: 'Require Reason for Adjustment', help: 'Manual stock changes need a reason.' },
    { key: 'ownerApprovalForManualAdjustment', label: 'Owner Approval for Manual Adjustment', help: 'Owner approval required for sensitive stock changes.' }
  ];

  readonly stockMovementControls: Array<{ key: keyof InventorySettingsState['stockMovement']; label: string; help: string }> = [
    { key: 'inwardEnabled', label: 'Inward Enabled', help: 'Allow stock inward entries.' },
    { key: 'outwardEnabled', label: 'Outward Enabled', help: 'Allow stock outward entries.' },
    { key: 'transferEnabled', label: 'Transfer Enabled', help: 'Allow branch/warehouse stock transfers.' },
    { key: 'damagedStockTracking', label: 'Damaged Stock Tracking', help: 'Track damaged stock separately.' },
    { key: 'expiredStockTracking', label: 'Expired Stock Tracking', help: 'Track expired product stock.' },
    { key: 'allowBackdatedMovement', label: 'Allow Backdated Movement', help: 'Permit backdated stock movement entries.' }
  ];

  readonly warehouseControls: Array<{ key: keyof InventorySettingsState['warehouseRules']; label: string; help: string }> = [
    { key: 'defaultWarehouseRequired', label: 'Default Warehouse Required', help: 'Require warehouse selection on stock entries.' },
    { key: 'branchWarehouseIsolation', label: 'Branch Warehouse Isolation', help: 'Keep branch stock isolated by default.' },
    { key: 'interBranchTransferApproval', label: 'Inter-branch Transfer Approval', help: 'Owner approval required for inter-branch transfer.' },
    { key: 'stockReservationEnabled', label: 'Stock Reservation Enabled', help: 'Reserve stock for pending orders/consume drafts.' }
  ];

  readonly consumeControls: Array<{ key: keyof InventorySettingsState['consumeRules']; label: string; help: string }> = [
    { key: 'serviceRecipeRequired', label: 'Service Recipe Required', help: 'Require service recipe for product consume drafts.' },
    { key: 'consumeDraftAutoCreate', label: 'Consume Draft Auto Create', help: 'Create consume draft after POS service invoice.' },
    { key: 'allowExtraProductConsume', label: 'Allow Extra Product Consume', help: 'Allow explicit extra products beyond recipe lock.' },
    { key: 'wastageLimitEnabled', label: 'Wastage Limit Enabled', help: 'Apply wastage limit controls.' },
    { key: 'highWastageApprovalRequired', label: 'High Wastage Approval Required', help: 'Owner approval for high wastage.' }
  ];

  readonly notificationControls: Array<{ key: keyof InventorySettingsState['notifications']; label: string; help: string }> = [
    { key: 'notifyOwnerLowStock', label: 'Notify Owner Low Stock', help: 'Alert owner when stock is low.' },
    { key: 'notifyOwnerStockout', label: 'Notify Owner Stockout', help: 'Alert owner when stock is out.' },
    { key: 'notifyOwnerManualAdjustment', label: 'Notify Owner Manual Adjustment', help: 'Alert owner on manual stock adjustment.' },
    { key: 'notifyOwnerHighWastage', label: 'Notify Owner High Wastage', help: 'Alert owner on high wastage.' },
    { key: 'notifyOwnerExpiryRisk', label: 'Notify Owner Expiry Risk', help: 'Alert owner for expiry risk.' }
  ];

  constructor(private readonly api: ApiService) {}

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.error.set('');
    this.message.set('');
    this.api.list<{ settings?: ApiRecord }>('settings/inventory').subscribe({
      next: (result) => {
        this.settings = this.normalize(result.settings);
      },
      error: (err) => {
        this.error.set(err?.error?.message || err?.message || 'Unable to load inventory settings');
        this.settings = cloneSettings(DEFAULT_SETTINGS);
      }
    });
  }

  save(): void {
    this.saving.set(true);
    this.error.set('');
    this.message.set('');
    const settings = this.normalize(this.settings);
    this.api.put<{ settings?: ApiRecord }>('settings/inventory', { settings }).subscribe({
      next: (result) => {
        this.settings = this.normalize(result.settings || settings);
        this.message.set('Inventory settings saved');
        this.saving.set(false);
      },
      error: (err) => {
        this.error.set(err?.error?.message || err?.message || 'Unable to save inventory settings');
        this.saving.set(false);
      }
    });
  }

  notificationSummary(): string {
    const enabled = [
      this.settings.notifications.notifyOwnerLowStock ? 'low stock' : '',
      this.settings.notifications.notifyOwnerStockout ? 'stockout' : '',
      this.settings.notifications.notifyOwnerManualAdjustment ? 'manual adjustment' : '',
      this.settings.notifications.notifyOwnerHighWastage ? 'high wastage' : '',
      this.settings.notifications.notifyOwnerExpiryRisk ? 'expiry risk' : ''
    ].filter(Boolean);
    return enabled.length ? enabled.join(', ') : 'no inventory alerts';
  }

  private normalize(input: unknown): InventorySettingsState {
    const source = (input || {}) as InventorySettingsState;
    const defaults = DEFAULT_SETTINGS;
    const inventoryControl = source.inventoryControl || defaults.inventoryControl;
    const stockMovement = source.stockMovement || defaults.stockMovement;
    const reorderRules = source.reorderRules || defaults.reorderRules;
    const warehouseRules = source.warehouseRules || defaults.warehouseRules;
    const consumeRules = source.consumeRules || defaults.consumeRules;
    const notifications = source.notifications || defaults.notifications;
    return {
      inventoryControl: {
        inventoryEnabled: boolValue(inventoryControl.inventoryEnabled, defaults.inventoryControl.inventoryEnabled),
        stockAuditEnabled: boolValue(inventoryControl.stockAuditEnabled, defaults.inventoryControl.stockAuditEnabled),
        fifoCostingEnabled: boolValue(inventoryControl.fifoCostingEnabled, defaults.inventoryControl.fifoCostingEnabled),
        multiWarehouseEnabled: boolValue(inventoryControl.multiWarehouseEnabled, defaults.inventoryControl.multiWarehouseEnabled),
        requireReasonForAdjustment: boolValue(inventoryControl.requireReasonForAdjustment, defaults.inventoryControl.requireReasonForAdjustment),
        ownerApprovalForManualAdjustment: boolValue(inventoryControl.ownerApprovalForManualAdjustment, defaults.inventoryControl.ownerApprovalForManualAdjustment)
      },
      stockMovement: {
        inwardEnabled: boolValue(stockMovement.inwardEnabled, defaults.stockMovement.inwardEnabled),
        outwardEnabled: boolValue(stockMovement.outwardEnabled, defaults.stockMovement.outwardEnabled),
        transferEnabled: boolValue(stockMovement.transferEnabled, defaults.stockMovement.transferEnabled),
        damagedStockTracking: boolValue(stockMovement.damagedStockTracking, defaults.stockMovement.damagedStockTracking),
        expiredStockTracking: boolValue(stockMovement.expiredStockTracking, defaults.stockMovement.expiredStockTracking),
        allowBackdatedMovement: boolValue(stockMovement.allowBackdatedMovement, defaults.stockMovement.allowBackdatedMovement)
      },
      reorderRules: {
        autoReorderSuggestions: boolValue(reorderRules.autoReorderSuggestions, defaults.reorderRules.autoReorderSuggestions),
        defaultReorderLevel: numberValue(reorderRules.defaultReorderLevel, defaults.reorderRules.defaultReorderLevel),
        defaultReorderQty: numberValue(reorderRules.defaultReorderQty, defaults.reorderRules.defaultReorderQty),
        lowStockAlertEnabled: boolValue(reorderRules.lowStockAlertEnabled, defaults.reorderRules.lowStockAlertEnabled),
        stockoutAlertEnabled: boolValue(reorderRules.stockoutAlertEnabled, defaults.reorderRules.stockoutAlertEnabled),
        supplierSuggestionEnabled: boolValue(reorderRules.supplierSuggestionEnabled, defaults.reorderRules.supplierSuggestionEnabled)
      },
      warehouseRules: {
        defaultWarehouseRequired: boolValue(warehouseRules.defaultWarehouseRequired, defaults.warehouseRules.defaultWarehouseRequired),
        branchWarehouseIsolation: boolValue(warehouseRules.branchWarehouseIsolation, defaults.warehouseRules.branchWarehouseIsolation),
        interBranchTransferApproval: boolValue(warehouseRules.interBranchTransferApproval, defaults.warehouseRules.interBranchTransferApproval),
        stockReservationEnabled: boolValue(warehouseRules.stockReservationEnabled, defaults.warehouseRules.stockReservationEnabled)
      },
      consumeRules: {
        serviceRecipeRequired: boolValue(consumeRules.serviceRecipeRequired, defaults.consumeRules.serviceRecipeRequired),
        consumeDraftAutoCreate: boolValue(consumeRules.consumeDraftAutoCreate, defaults.consumeRules.consumeDraftAutoCreate),
        allowExtraProductConsume: boolValue(consumeRules.allowExtraProductConsume, defaults.consumeRules.allowExtraProductConsume),
        wastageLimitEnabled: boolValue(consumeRules.wastageLimitEnabled, defaults.consumeRules.wastageLimitEnabled),
        highWastageApprovalRequired: boolValue(consumeRules.highWastageApprovalRequired, defaults.consumeRules.highWastageApprovalRequired)
      },
      notifications: {
        notifyOwnerLowStock: boolValue(notifications.notifyOwnerLowStock, defaults.notifications.notifyOwnerLowStock),
        notifyOwnerStockout: boolValue(notifications.notifyOwnerStockout, defaults.notifications.notifyOwnerStockout),
        notifyOwnerManualAdjustment: boolValue(notifications.notifyOwnerManualAdjustment, defaults.notifications.notifyOwnerManualAdjustment),
        notifyOwnerHighWastage: boolValue(notifications.notifyOwnerHighWastage, defaults.notifications.notifyOwnerHighWastage),
        notifyOwnerExpiryRisk: boolValue(notifications.notifyOwnerExpiryRisk, defaults.notifications.notifyOwnerExpiryRisk)
      }
    };
  }
}
