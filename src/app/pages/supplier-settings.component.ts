import { CommonModule } from '@angular/common';
import { Component, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ApiRecord, ApiService } from '../core/api.service';

type SupplierSettingsState = {
  supplierControl: {
    suppliersEnabled: boolean;
    supplierCodeRequired: boolean;
    gstinRequired: boolean;
    contactRequired: boolean;
    allowDuplicateSupplier: boolean;
    supplierApprovalRequired: boolean;
  };
  purchaseControl: {
    purchaseOrderEnabled: boolean;
    purchaseBillDraftEnabled: boolean;
    requirePoBeforePurchase: boolean;
    ownerApprovalForHighValuePo: boolean;
    highValuePoLimit: number;
    allowDirectPurchaseBill: boolean;
  };
  compliance: {
    gstinValidationEnabled: boolean;
    paymentTermsRequired: boolean;
    bankDetailsRequired: boolean;
    documentUploadRequired: boolean;
    blockInactiveSupplierPurchase: boolean;
  };
  priceIntel: {
    trackPriceRise: boolean;
    cheaperSupplierSuggestion: boolean;
    priceChangeApprovalRequired: boolean;
    compareLastPurchaseRate: boolean;
  };
  paymentRisk: {
    payableTrackingEnabled: boolean;
    creditLimitEnabled: boolean;
    defaultCreditLimit: number;
    overdueAlertEnabled: boolean;
    riskSupplierReviewRequired: boolean;
  };
  notifications: {
    notifyOwnerOnNewSupplier: boolean;
    notifyOwnerOnPriceRise: boolean;
    notifyOwnerOnOverduePayable: boolean;
    notifyOwnerOnRiskSupplier: boolean;
  };
};

const DEFAULT_SETTINGS: SupplierSettingsState = {
  supplierControl: {
    suppliersEnabled: true,
    supplierCodeRequired: false,
    gstinRequired: false,
    contactRequired: true,
    allowDuplicateSupplier: false,
    supplierApprovalRequired: true
  },
  purchaseControl: {
    purchaseOrderEnabled: true,
    purchaseBillDraftEnabled: true,
    requirePoBeforePurchase: false,
    ownerApprovalForHighValuePo: true,
    highValuePoLimit: 50000,
    allowDirectPurchaseBill: true
  },
  compliance: {
    gstinValidationEnabled: true,
    paymentTermsRequired: true,
    bankDetailsRequired: false,
    documentUploadRequired: false,
    blockInactiveSupplierPurchase: true
  },
  priceIntel: {
    trackPriceRise: true,
    cheaperSupplierSuggestion: true,
    priceChangeApprovalRequired: true,
    compareLastPurchaseRate: true
  },
  paymentRisk: {
    payableTrackingEnabled: true,
    creditLimitEnabled: false,
    defaultCreditLimit: 0,
    overdueAlertEnabled: true,
    riskSupplierReviewRequired: true
  },
  notifications: {
    notifyOwnerOnNewSupplier: true,
    notifyOwnerOnPriceRise: true,
    notifyOwnerOnOverduePayable: true,
    notifyOwnerOnRiskSupplier: true
  }
};

function cloneSettings(settings: SupplierSettingsState): SupplierSettingsState {
  return JSON.parse(JSON.stringify(settings)) as SupplierSettingsState;
}

function boolValue(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function numberValue(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.round(parsed) : fallback;
}

@Component({
  selector: 'app-supplier-settings',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  template: `
    <section class="supplier-settings-page inner-page-shell">
      <aside class="settings-nav" aria-label="Settings sections">
        <a routerLink="/settings/general">General Settings</a>
        <a routerLink="/settings/products">Products Settings</a>
        <a class="active" routerLink="/settings/supplier">Supplier Settings</a>
        <a routerLink="/settings/inventory">Inventory Settings</a>
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
            <span class="eyebrow">Setup / Supplier</span>
            <h1>Supplier Settings Control</h1>
            <p>Control supplier onboarding, purchase rules, GST/compliance, price intelligence, payables risk and owner alerts.</p>
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
        <p class="phase-note">Next phase will connect supplier register, purchase orders, purchase bills, payable reports and supplier risk alerts to these saved rules.</p>

        <section class="settings-grid inner-form-grid">
          <article class="settings-card inner-page-card">
            <h2>Supplier Control</h2>
            <ng-container *ngFor="let item of supplierControls">
              <label class="switch-row">
                <span><strong>{{ item.label }}</strong><small>{{ item.help }}</small></span>
                <input type="checkbox" [(ngModel)]="settings.supplierControl[item.key]" />
                <i aria-hidden="true"></i>
              </label>
            </ng-container>
          </article>

          <article class="settings-card inner-page-card">
            <h2>Purchase Control</h2>
            <label class="switch-row">
              <span><strong>Purchase Order Enabled</strong><small>Enable purchase order workflow.</small></span>
              <input type="checkbox" [(ngModel)]="settings.purchaseControl.purchaseOrderEnabled" />
              <i aria-hidden="true"></i>
            </label>
            <label class="switch-row">
              <span><strong>Purchase Bill Draft Enabled</strong><small>Allow AI/manual purchase bill draft flow.</small></span>
              <input type="checkbox" [(ngModel)]="settings.purchaseControl.purchaseBillDraftEnabled" />
              <i aria-hidden="true"></i>
            </label>
            <label class="switch-row">
              <span><strong>Require PO Before Purchase</strong><small>Purchase bill needs prior PO reference.</small></span>
              <input type="checkbox" [(ngModel)]="settings.purchaseControl.requirePoBeforePurchase" />
              <i aria-hidden="true"></i>
            </label>
            <label class="switch-row">
              <span><strong>Owner Approval for High Value PO</strong><small>High value purchase orders require owner approval.</small></span>
              <input type="checkbox" [(ngModel)]="settings.purchaseControl.ownerApprovalForHighValuePo" />
              <i aria-hidden="true"></i>
            </label>
            <label class="field-row">
              <span>High Value PO Limit</span>
              <input type="number" min="0" [(ngModel)]="settings.purchaseControl.highValuePoLimit" />
            </label>
            <label class="switch-row">
              <span><strong>Allow Direct Purchase Bill</strong><small>Permit purchase bill without PO in allowed cases.</small></span>
              <input type="checkbox" [(ngModel)]="settings.purchaseControl.allowDirectPurchaseBill" />
              <i aria-hidden="true"></i>
            </label>
          </article>

          <article class="settings-card inner-page-card">
            <h2>Compliance</h2>
            <ng-container *ngFor="let item of complianceControls">
              <label class="switch-row">
                <span><strong>{{ item.label }}</strong><small>{{ item.help }}</small></span>
                <input type="checkbox" [(ngModel)]="settings.compliance[item.key]" />
                <i aria-hidden="true"></i>
              </label>
            </ng-container>
          </article>

          <article class="settings-card inner-page-card">
            <h2>Price Intelligence</h2>
            <ng-container *ngFor="let item of priceIntelControls">
              <label class="switch-row">
                <span><strong>{{ item.label }}</strong><small>{{ item.help }}</small></span>
                <input type="checkbox" [(ngModel)]="settings.priceIntel[item.key]" />
                <i aria-hidden="true"></i>
              </label>
            </ng-container>
          </article>

          <article class="settings-card inner-page-card">
            <h2>Payment & Risk</h2>
            <label class="switch-row">
              <span><strong>Payable Tracking Enabled</strong><small>Track supplier payable balance.</small></span>
              <input type="checkbox" [(ngModel)]="settings.paymentRisk.payableTrackingEnabled" />
              <i aria-hidden="true"></i>
            </label>
            <label class="switch-row">
              <span><strong>Credit Limit Enabled</strong><small>Track supplier credit limit policy.</small></span>
              <input type="checkbox" [(ngModel)]="settings.paymentRisk.creditLimitEnabled" />
              <i aria-hidden="true"></i>
            </label>
            <label class="field-row">
              <span>Default Credit Limit</span>
              <input type="number" min="0" [(ngModel)]="settings.paymentRisk.defaultCreditLimit" />
            </label>
            <label class="switch-row">
              <span><strong>Overdue Alert Enabled</strong><small>Alert owner for overdue supplier payables.</small></span>
              <input type="checkbox" [(ngModel)]="settings.paymentRisk.overdueAlertEnabled" />
              <i aria-hidden="true"></i>
            </label>
            <label class="switch-row">
              <span><strong>Risk Supplier Review Required</strong><small>Risk suppliers need owner review.</small></span>
              <input type="checkbox" [(ngModel)]="settings.paymentRisk.riskSupplierReviewRequired" />
              <i aria-hidden="true"></i>
            </label>
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
              <p><strong>Supplier:</strong> {{ settings.supplierControl.suppliersEnabled ? 'enabled' : 'disabled' }}, contact {{ settings.supplierControl.contactRequired ? 'required' : 'optional' }}.</p>
              <p><strong>Purchase:</strong> PO {{ settings.purchaseControl.purchaseOrderEnabled ? 'ON' : 'OFF' }}, high value limit ₹{{ settings.purchaseControl.highValuePoLimit }}.</p>
              <p><strong>Compliance:</strong> GSTIN validation {{ settings.compliance.gstinValidationEnabled ? 'ON' : 'OFF' }}, inactive purchase {{ settings.compliance.blockInactiveSupplierPurchase ? 'blocked' : 'allowed' }}.</p>
              <p><strong>Price:</strong> {{ settings.priceIntel.trackPriceRise ? 'price rise tracked' : 'price rise not tracked' }}, cheaper supplier {{ settings.priceIntel.cheaperSupplierSuggestion ? 'suggested' : 'hidden' }}.</p>
              <p><strong>Payable:</strong> {{ settings.paymentRisk.payableTrackingEnabled ? 'tracking ON' : 'tracking OFF' }}, overdue alert {{ settings.paymentRisk.overdueAlertEnabled ? 'ON' : 'OFF' }}.</p>
              <p><strong>Alerts:</strong> {{ notificationSummary() }}.</p>
            </div>
          </article>
        </section>
      </main>
    </section>
  `,
  styles: [`
    :host { display: block; color: #0f2235; }
    .supplier-settings-page {
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
      .supplier-settings-page { grid-template-columns: 1fr; }
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
export class SupplierSettingsComponent implements OnInit {
  saving = signal(false);
  message = signal('');
  error = signal('');
  settings = cloneSettings(DEFAULT_SETTINGS);

  readonly supplierControls: Array<{ key: keyof SupplierSettingsState['supplierControl']; label: string; help: string }> = [
    { key: 'suppliersEnabled', label: 'Suppliers Enabled', help: 'Enable supplier master and supplier command register.' },
    { key: 'supplierCodeRequired', label: 'Supplier Code Required', help: 'Require supplier code while creating suppliers.' },
    { key: 'gstinRequired', label: 'GSTIN Required', help: 'Require GSTIN or tax registration number.' },
    { key: 'contactRequired', label: 'Contact Required', help: 'Require supplier contact details.' },
    { key: 'allowDuplicateSupplier', label: 'Allow Duplicate Supplier', help: 'Permit duplicate supplier names/contact.' },
    { key: 'supplierApprovalRequired', label: 'Supplier Approval Required', help: 'New supplier needs owner approval.' }
  ];

  readonly complianceControls: Array<{ key: keyof SupplierSettingsState['compliance']; label: string; help: string }> = [
    { key: 'gstinValidationEnabled', label: 'GSTIN Validation Enabled', help: 'Validate GSTIN/tax registration before active use.' },
    { key: 'paymentTermsRequired', label: 'Payment Terms Required', help: 'Require payment terms on supplier profile.' },
    { key: 'bankDetailsRequired', label: 'Bank Details Required', help: 'Require bank details for supplier payout.' },
    { key: 'documentUploadRequired', label: 'Document Upload Required', help: 'Require compliance document upload.' },
    { key: 'blockInactiveSupplierPurchase', label: 'Block Inactive Supplier Purchase', help: 'Prevent purchases from inactive suppliers.' }
  ];

  readonly priceIntelControls: Array<{ key: keyof SupplierSettingsState['priceIntel']; label: string; help: string }> = [
    { key: 'trackPriceRise', label: 'Track Price Rise', help: 'Detect supplier price increases.' },
    { key: 'cheaperSupplierSuggestion', label: 'Cheaper Supplier Suggestion', help: 'Suggest cheaper supplier when available.' },
    { key: 'priceChangeApprovalRequired', label: 'Price Change Approval Required', help: 'Owner approval for major price changes.' },
    { key: 'compareLastPurchaseRate', label: 'Compare Last Purchase Rate', help: 'Compare purchase bill rate with last rate.' }
  ];

  readonly notificationControls: Array<{ key: keyof SupplierSettingsState['notifications']; label: string; help: string }> = [
    { key: 'notifyOwnerOnNewSupplier', label: 'Notify Owner on New Supplier', help: 'Owner alert when supplier is created.' },
    { key: 'notifyOwnerOnPriceRise', label: 'Notify Owner on Price Rise', help: 'Owner alert when price rise is detected.' },
    { key: 'notifyOwnerOnOverduePayable', label: 'Notify Owner on Overdue Payable', help: 'Owner alert for overdue supplier payable.' },
    { key: 'notifyOwnerOnRiskSupplier', label: 'Notify Owner on Risk Supplier', help: 'Owner alert for supplier risk.' }
  ];

  constructor(private readonly api: ApiService) {}

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.error.set('');
    this.message.set('');
    this.api.list<{ settings?: ApiRecord }>('settings/supplier').subscribe({
      next: (result) => {
        this.settings = this.normalize(result.settings);
      },
      error: (err) => {
        this.error.set(err?.error?.message || err?.message || 'Unable to load supplier settings');
        this.settings = cloneSettings(DEFAULT_SETTINGS);
      }
    });
  }

  save(): void {
    this.saving.set(true);
    this.error.set('');
    this.message.set('');
    const settings = this.normalize(this.settings);
    this.api.put<{ settings?: ApiRecord }>('settings/supplier', { settings }).subscribe({
      next: (result) => {
        this.settings = this.normalize(result.settings || settings);
        this.message.set('Supplier settings saved');
        this.saving.set(false);
      },
      error: (err) => {
        this.error.set(err?.error?.message || err?.message || 'Unable to save supplier settings');
        this.saving.set(false);
      }
    });
  }

  notificationSummary(): string {
    const enabled = [
      this.settings.notifications.notifyOwnerOnNewSupplier ? 'new supplier' : '',
      this.settings.notifications.notifyOwnerOnPriceRise ? 'price rise' : '',
      this.settings.notifications.notifyOwnerOnOverduePayable ? 'overdue payable' : '',
      this.settings.notifications.notifyOwnerOnRiskSupplier ? 'risk supplier' : ''
    ].filter(Boolean);
    return enabled.length ? enabled.join(', ') : 'no supplier alerts';
  }

  private normalize(input: unknown): SupplierSettingsState {
    const source = (input || {}) as SupplierSettingsState;
    const defaults = DEFAULT_SETTINGS;
    const supplierControl = source.supplierControl || defaults.supplierControl;
    const purchaseControl = source.purchaseControl || defaults.purchaseControl;
    const compliance = source.compliance || defaults.compliance;
    const priceIntel = source.priceIntel || defaults.priceIntel;
    const paymentRisk = source.paymentRisk || defaults.paymentRisk;
    const notifications = source.notifications || defaults.notifications;
    return {
      supplierControl: {
        suppliersEnabled: boolValue(supplierControl.suppliersEnabled, defaults.supplierControl.suppliersEnabled),
        supplierCodeRequired: boolValue(supplierControl.supplierCodeRequired, defaults.supplierControl.supplierCodeRequired),
        gstinRequired: boolValue(supplierControl.gstinRequired, defaults.supplierControl.gstinRequired),
        contactRequired: boolValue(supplierControl.contactRequired, defaults.supplierControl.contactRequired),
        allowDuplicateSupplier: boolValue(supplierControl.allowDuplicateSupplier, defaults.supplierControl.allowDuplicateSupplier),
        supplierApprovalRequired: boolValue(supplierControl.supplierApprovalRequired, defaults.supplierControl.supplierApprovalRequired)
      },
      purchaseControl: {
        purchaseOrderEnabled: boolValue(purchaseControl.purchaseOrderEnabled, defaults.purchaseControl.purchaseOrderEnabled),
        purchaseBillDraftEnabled: boolValue(purchaseControl.purchaseBillDraftEnabled, defaults.purchaseControl.purchaseBillDraftEnabled),
        requirePoBeforePurchase: boolValue(purchaseControl.requirePoBeforePurchase, defaults.purchaseControl.requirePoBeforePurchase),
        ownerApprovalForHighValuePo: boolValue(purchaseControl.ownerApprovalForHighValuePo, defaults.purchaseControl.ownerApprovalForHighValuePo),
        highValuePoLimit: numberValue(purchaseControl.highValuePoLimit, defaults.purchaseControl.highValuePoLimit),
        allowDirectPurchaseBill: boolValue(purchaseControl.allowDirectPurchaseBill, defaults.purchaseControl.allowDirectPurchaseBill)
      },
      compliance: {
        gstinValidationEnabled: boolValue(compliance.gstinValidationEnabled, defaults.compliance.gstinValidationEnabled),
        paymentTermsRequired: boolValue(compliance.paymentTermsRequired, defaults.compliance.paymentTermsRequired),
        bankDetailsRequired: boolValue(compliance.bankDetailsRequired, defaults.compliance.bankDetailsRequired),
        documentUploadRequired: boolValue(compliance.documentUploadRequired, defaults.compliance.documentUploadRequired),
        blockInactiveSupplierPurchase: boolValue(compliance.blockInactiveSupplierPurchase, defaults.compliance.blockInactiveSupplierPurchase)
      },
      priceIntel: {
        trackPriceRise: boolValue(priceIntel.trackPriceRise, defaults.priceIntel.trackPriceRise),
        cheaperSupplierSuggestion: boolValue(priceIntel.cheaperSupplierSuggestion, defaults.priceIntel.cheaperSupplierSuggestion),
        priceChangeApprovalRequired: boolValue(priceIntel.priceChangeApprovalRequired, defaults.priceIntel.priceChangeApprovalRequired),
        compareLastPurchaseRate: boolValue(priceIntel.compareLastPurchaseRate, defaults.priceIntel.compareLastPurchaseRate)
      },
      paymentRisk: {
        payableTrackingEnabled: boolValue(paymentRisk.payableTrackingEnabled, defaults.paymentRisk.payableTrackingEnabled),
        creditLimitEnabled: boolValue(paymentRisk.creditLimitEnabled, defaults.paymentRisk.creditLimitEnabled),
        defaultCreditLimit: numberValue(paymentRisk.defaultCreditLimit, defaults.paymentRisk.defaultCreditLimit),
        overdueAlertEnabled: boolValue(paymentRisk.overdueAlertEnabled, defaults.paymentRisk.overdueAlertEnabled),
        riskSupplierReviewRequired: boolValue(paymentRisk.riskSupplierReviewRequired, defaults.paymentRisk.riskSupplierReviewRequired)
      },
      notifications: {
        notifyOwnerOnNewSupplier: boolValue(notifications.notifyOwnerOnNewSupplier, defaults.notifications.notifyOwnerOnNewSupplier),
        notifyOwnerOnPriceRise: boolValue(notifications.notifyOwnerOnPriceRise, defaults.notifications.notifyOwnerOnPriceRise),
        notifyOwnerOnOverduePayable: boolValue(notifications.notifyOwnerOnOverduePayable, defaults.notifications.notifyOwnerOnOverduePayable),
        notifyOwnerOnRiskSupplier: boolValue(notifications.notifyOwnerOnRiskSupplier, defaults.notifications.notifyOwnerOnRiskSupplier)
      }
    };
  }
}
