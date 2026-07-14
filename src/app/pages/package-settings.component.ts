import { CommonModule } from '@angular/common';
import { Component, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ApiRecord, ApiService } from '../core/api.service';
import { AuraDatePipe } from '../shared/pipes/aura-date.pipe';

type PackageSettingsState = {
  packageCatalog: {
    packageSalesEnabled: boolean;
    visibleInPos: boolean;
    packageGroupsEnabled: boolean;
    paidPackageAddonEnabled: boolean;
  };
  creditsRedemption: {
    allowPartialRedemption: boolean;
    allowCrossServiceRedemption: boolean;
    blockRedemptionWhenExpired: boolean;
    requireStaffConfirmation: boolean;
  };
  expiryRenewal: {
    expiryDaysEnabled: boolean;
    defaultExpiryDays: number;
    renewalReminderDays: number;
    expiredPendingAction: string;
  };
  pricingPayment: {
    allowDiscountOnPackage: boolean;
    packageTaxApplicable: boolean;
    taxInclusivePackagePrice: boolean;
    allowDueOnPackageSale: boolean;
  };
  onlineBooking: {
    showPackagesOnline: boolean;
    allowClientPackagePurchase: boolean;
    allowPackageServiceBooking: boolean;
  };
  remindersRisk: {
    pendingCreditReminder: boolean;
    expiryReminder: boolean;
    ownerAlertForHighPendingValue: boolean;
    highPendingValueThreshold: number;
  };
  defaults: {
    defaultStatus: string;
    defaultPackageType: string;
  };
};

type PackageSettingsAudit = {
  lastChangedBy: string;
  lastChangedAt: string;
};

const DEFAULT_SETTINGS: PackageSettingsState = {
  packageCatalog: {
    packageSalesEnabled: true,
    visibleInPos: true,
    packageGroupsEnabled: true,
    paidPackageAddonEnabled: true
  },
  creditsRedemption: {
    allowPartialRedemption: true,
    allowCrossServiceRedemption: false,
    blockRedemptionWhenExpired: true,
    requireStaffConfirmation: true
  },
  expiryRenewal: {
    expiryDaysEnabled: true,
    defaultExpiryDays: 365,
    renewalReminderDays: 30,
    expiredPendingAction: 'warn'
  },
  pricingPayment: {
    allowDiscountOnPackage: true,
    packageTaxApplicable: true,
    taxInclusivePackagePrice: false,
    allowDueOnPackageSale: true
  },
  onlineBooking: {
    showPackagesOnline: true,
    allowClientPackagePurchase: false,
    allowPackageServiceBooking: true
  },
  remindersRisk: {
    pendingCreditReminder: true,
    expiryReminder: true,
    ownerAlertForHighPendingValue: true,
    highPendingValueThreshold: 10000
  },
  defaults: {
    defaultStatus: 'active',
    defaultPackageType: 'serviceCredits'
  }
};

const DEFAULT_AUDIT: PackageSettingsAudit = {
  lastChangedBy: 'Not saved yet',
  lastChangedAt: ''
};

function cloneSettings(settings: PackageSettingsState): PackageSettingsState {
  return JSON.parse(JSON.stringify(settings)) as PackageSettingsState;
}

function boolValue(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function numberValue(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.round(parsed) : fallback;
}

function stringValue(value: unknown, fallback: string): string {
  return String(value ?? fallback).trim() || fallback;
}

@Component({
  selector: 'app-package-settings',
  standalone: true,
  imports: [AuraDatePipe, CommonModule, FormsModule, RouterLink],
  template: `
    <section class="package-settings-page inner-page-shell">
      <aside class="settings-nav" aria-label="Settings sections">
        <a routerLink="/settings/general">General Settings</a>
        <a routerLink="/settings/products">Products Settings</a>
        <a routerLink="/settings/supplier">Supplier Settings</a>
        <a routerLink="/settings/inventory">Inventory Settings</a>
        <a routerLink="/settings/services">Services Settings</a>
        <a class="active" routerLink="/settings/packages">Packages Settings</a>
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
        <a routerLink="/settings/security">Security</a>
      </aside>

      <main class="settings-content">
        <header class="settings-hero inner-page-header">
          <div>
            <span class="eyebrow">Setup / Packages</span>
            <h1>Packages Settings Control</h1>
            <p>Control package sale visibility, credit redemption, expiry rules, package pricing, online booking and reminder behavior.</p>
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
        <p class="phase-note">Next phase will connect POS package sale, package redemption, pending package reports, expiry reminders and online booking package flows to this saved policy.</p>

        <section class="audit-strip">
          <strong>Audit info</strong>
          <span>Last changed by: {{ audit.lastChangedBy || 'Not saved yet' }}</span>
          <span>Last changed time: {{ audit.lastChangedAt ? (audit.lastChangedAt | auraDate:'date') : 'Not saved yet' }}</span>
        </section>

        <section class="settings-grid inner-form-grid">
          <article class="settings-card inner-page-card">
            <h2>Package Catalog</h2>
            <label class="switch-row"><span><strong>Package sales enabled</strong><small>Allow package creation and sale workflow.</small></span><input type="checkbox" [(ngModel)]="settings.packageCatalog.packageSalesEnabled" /><i></i></label>
            <label class="switch-row"><span><strong>Visible in POS</strong><small>Show packages in POS sale screens.</small></span><input type="checkbox" [(ngModel)]="settings.packageCatalog.visibleInPos" /><i></i></label>
            <label class="switch-row"><span><strong>Package groups enabled</strong><small>Organize packages by group/category.</small></span><input type="checkbox" [(ngModel)]="settings.packageCatalog.packageGroupsEnabled" /><i></i></label>
            <label class="switch-row"><span><strong>Paid package addon enabled</strong><small>Allow paid add-ons inside package sales.</small></span><input type="checkbox" [(ngModel)]="settings.packageCatalog.paidPackageAddonEnabled" /><i></i></label>
          </article>

          <article class="settings-card inner-page-card">
            <h2>Credits & Redemption</h2>
            <label class="switch-row"><span><strong>Allow partial redemption</strong><small>Permit using only part of available package credits.</small></span><input type="checkbox" [(ngModel)]="settings.creditsRedemption.allowPartialRedemption" /><i></i></label>
            <label class="switch-row"><span><strong>Allow cross-service redemption</strong><small>Allow credits to redeem against substitute services.</small></span><input type="checkbox" [(ngModel)]="settings.creditsRedemption.allowCrossServiceRedemption" /><i></i></label>
            <label class="switch-row"><span><strong>Block redemption when expired</strong><small>Prevent expired package credits from being used.</small></span><input type="checkbox" [(ngModel)]="settings.creditsRedemption.blockRedemptionWhenExpired" /><i></i></label>
            <label class="switch-row"><span><strong>Require staff confirmation</strong><small>Ask staff to confirm package redemption at billing.</small></span><input type="checkbox" [(ngModel)]="settings.creditsRedemption.requireStaffConfirmation" /><i></i></label>
          </article>

          <article class="settings-card inner-page-card">
            <h2>Expiry & Renewal</h2>
            <label class="switch-row"><span><strong>Expiry days enabled</strong><small>Use expiry date on package credits.</small></span><input type="checkbox" [(ngModel)]="settings.expiryRenewal.expiryDaysEnabled" /><i></i></label>
            <label class="field-row"><span>Default expiry days</span><input type="number" min="0" max="3650" [(ngModel)]="settings.expiryRenewal.defaultExpiryDays" /></label>
            <label class="field-row"><span>Renewal reminder days</span><input type="number" min="0" max="365" [(ngModel)]="settings.expiryRenewal.renewalReminderDays" /></label>
            <label class="field-row"><span>Expired pending action</span><select [(ngModel)]="settings.expiryRenewal.expiredPendingAction"><option value="allow">Allow</option><option value="warn">Warn</option><option value="block">Block</option></select></label>
          </article>

          <article class="settings-card inner-page-card">
            <h2>Pricing & Payment</h2>
            <label class="switch-row"><span><strong>Allow discount on package</strong><small>Permit discount on package sale price.</small></span><input type="checkbox" [(ngModel)]="settings.pricingPayment.allowDiscountOnPackage" /><i></i></label>
            <label class="switch-row"><span><strong>Package tax applicable</strong><small>Apply tax setting to package sales.</small></span><input type="checkbox" [(ngModel)]="settings.pricingPayment.packageTaxApplicable" /><i></i></label>
            <label class="switch-row"><span><strong>Tax inclusive package price</strong><small>Treat package price as tax-inclusive by default.</small></span><input type="checkbox" [(ngModel)]="settings.pricingPayment.taxInclusivePackagePrice" /><i></i></label>
            <label class="switch-row"><span><strong>Allow due on package sale</strong><small>Permit unpaid/due balance on package sale.</small></span><input type="checkbox" [(ngModel)]="settings.pricingPayment.allowDueOnPackageSale" /><i></i></label>
          </article>

          <article class="settings-card inner-page-card">
            <h2>Online Booking</h2>
            <label class="switch-row"><span><strong>Show packages online</strong><small>Display packages on client-facing booking/profile surfaces.</small></span><input type="checkbox" [(ngModel)]="settings.onlineBooking.showPackagesOnline" /><i></i></label>
            <label class="switch-row"><span><strong>Allow client package purchase</strong><small>Allow clients to buy packages online.</small></span><input type="checkbox" [(ngModel)]="settings.onlineBooking.allowClientPackagePurchase" /><i></i></label>
            <label class="switch-row"><span><strong>Allow package service booking</strong><small>Let clients book services using available package credits.</small></span><input type="checkbox" [(ngModel)]="settings.onlineBooking.allowPackageServiceBooking" /><i></i></label>
          </article>

          <article class="settings-card inner-page-card">
            <h2>Reminders & Risk</h2>
            <label class="switch-row"><span><strong>Pending credit reminder</strong><small>Remind clients when credits remain unused.</small></span><input type="checkbox" [(ngModel)]="settings.remindersRisk.pendingCreditReminder" /><i></i></label>
            <label class="switch-row"><span><strong>Expiry reminder</strong><small>Send reminders before package expiry.</small></span><input type="checkbox" [(ngModel)]="settings.remindersRisk.expiryReminder" /><i></i></label>
            <label class="switch-row"><span><strong>Owner alert for high pending value</strong><small>Notify owner when unused package liability is high.</small></span><input type="checkbox" [(ngModel)]="settings.remindersRisk.ownerAlertForHighPendingValue" /><i></i></label>
            <label class="field-row"><span>High pending value threshold</span><input type="number" min="0" [(ngModel)]="settings.remindersRisk.highPendingValueThreshold" /></label>
          </article>

          <article class="settings-card inner-page-card">
            <h2>Defaults</h2>
            <label class="field-row"><span>Default package status</span><select [(ngModel)]="settings.defaults.defaultStatus"><option value="active">Active</option><option value="inactive">Inactive</option></select></label>
            <label class="field-row"><span>Default package type</span><select [(ngModel)]="settings.defaults.defaultPackageType"><option value="serviceCredits">Service Credits</option><option value="valueWallet">Value Wallet</option><option value="mixed">Mixed</option></select></label>
          </article>

          <article class="settings-card preview-card">
            <h2>Policy Preview</h2>
            <p>Packages are {{ settings.packageCatalog.packageSalesEnabled ? 'enabled' : 'disabled' }} and {{ settings.packageCatalog.visibleInPos ? 'visible in POS' : 'hidden from POS' }}.</p>
            <p>Default expiry is {{ settings.expiryRenewal.expiryDaysEnabled ? settings.expiryRenewal.defaultExpiryDays + ' days' : 'not applied' }} with reminder {{ settings.expiryRenewal.renewalReminderDays }} days before expiry.</p>
            <p>Expired pending packages will {{ settings.expiryRenewal.expiredPendingAction }} and redemption confirmation is {{ settings.creditsRedemption.requireStaffConfirmation ? 'required' : 'optional' }}.</p>
            <p>Online package purchase is {{ settings.onlineBooking.allowClientPackagePurchase ? 'allowed' : 'blocked' }} and package service booking is {{ settings.onlineBooking.allowPackageServiceBooking ? 'allowed' : 'blocked' }}.</p>
          </article>
        </section>
      </main>
    </section>
  `,
  styles: [`
    :host { display: block; }
    .package-settings-page {
      --ink: #0f2238;
      --muted: #5f6f7e;
      --line: #d7e5df;
      display: grid;
      grid-template-columns: 220px minmax(0, 1fr);
      gap: 18px;
      min-height: calc(100vh - 72px);
      padding: 22px;
      background: linear-gradient(180deg, #f6fbf8, #eef5f2);
      color: var(--ink);
    }
    .settings-nav {
      display: grid;
      align-content: start;
      gap: 8px;
      padding: 18px 14px;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: #fff;
      box-shadow: 0 18px 48px rgba(15, 34, 56, .08);
    }
    .settings-nav a {
      padding: 12px 14px;
      border-radius: 8px;
      color: var(--ink);
      font-weight: 900;
      text-decoration: none;
    }
    .settings-nav a.active,
    .settings-nav a:hover {
      background: #e2f6ee;
      color: #08745f;
    }
    .settings-content {
      display: grid;
      gap: 18px;
      min-width: 0;
    }
    .settings-hero,
    .audit-strip,
    .settings-card {
      border: 1px solid var(--line);
      border-radius: 8px;
      background: #fff;
      box-shadow: 0 18px 48px rgba(15, 34, 56, .08);
    }
    .settings-hero {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 18px;
      padding: 24px;
    }
    .eyebrow {
      color: var(--muted);
      font-size: 12px;
      font-weight: 900;
      text-transform: uppercase;
    }
    h1, h2, p { margin: 0; }
    h1 {
      margin-top: 8px;
      font-size: 32px;
      line-height: 1.1;
      letter-spacing: 0;
    }
    .settings-hero p,
    .settings-card small,
    .settings-card p {
      margin-top: 8px;
      color: var(--muted);
      font-weight: 650;
    }
    .hero-actions {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
    }
    .primary-button,
    .ghost-button {
      min-height: 48px;
      border-radius: 8px;
      padding: 0 20px;
      font-weight: 900;
      cursor: pointer;
    }
    .primary-button {
      border: 0;
      background: #059669;
      color: #fff;
    }
    .primary-button:disabled {
      cursor: not-allowed;
      opacity: .65;
    }
    .ghost-button {
      border: 1px solid var(--line);
      background: #fff;
      color: var(--ink);
    }
    .state,
    .phase-note {
      margin: 0;
      border-radius: 8px;
      padding: 12px 14px;
      font-weight: 900;
    }
    .state.success {
      border: 1px solid #a7f3d0;
      background: #ecfdf5;
      color: #047857;
    }
    .state.danger {
      border: 1px solid #fecaca;
      background: #fef2f2;
      color: #b91c1c;
    }
    .phase-note {
      border: 1px solid #f6d58b;
      background: #fff8e6;
      color: #8a5a00;
    }
    .audit-strip {
      display: flex;
      flex-wrap: wrap;
      gap: 12px;
      padding: 14px 16px;
      color: var(--muted);
      font-weight: 800;
    }
    .audit-strip strong { color: var(--ink); }
    .settings-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 16px;
    }
    .settings-card {
      display: grid;
      align-content: start;
      gap: 12px;
      min-width: 0;
      padding: 18px;
    }
    .settings-card h2 {
      font-size: 16px;
      text-transform: uppercase;
      color: #506070;
    }
    .switch-row,
    .field-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 14px;
      min-height: 64px;
      padding: 12px 14px;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: #fbfefd;
    }
    .switch-row span {
      display: grid;
      gap: 3px;
      min-width: 0;
    }
    input,
    select {
      width: min(260px, 100%);
      min-height: 42px;
      border: 1px solid #cfe0d9;
      border-radius: 8px;
      padding: 0 12px;
      font: inherit;
      font-weight: 750;
      color: var(--ink);
      background: #fff;
    }
    .switch-row input[type="checkbox"] {
      position: absolute;
      opacity: 0;
      pointer-events: none;
    }
    .switch-row i {
      position: relative;
      flex: 0 0 auto;
      width: 52px;
      height: 30px;
      border-radius: 999px;
      background: #cbd5e1;
    }
    .switch-row i::after {
      content: '';
      position: absolute;
      top: 4px;
      left: 4px;
      width: 22px;
      height: 22px;
      border-radius: 50%;
      background: #fff;
      transition: transform .16s ease;
    }
    .switch-row input:checked + i {
      background: #111827;
    }
    .switch-row input:checked + i::after {
      transform: translateX(22px);
    }
    .preview-card {
      grid-column: 1 / -1;
      background: #f8fffc;
    }
    @media (max-width: 980px) {
      .package-settings-page {
        grid-template-columns: 1fr;
        padding: 14px;
      }
      .settings-nav {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }
      .settings-grid {
        grid-template-columns: 1fr;
      }
      .settings-hero {
        align-items: stretch;
        flex-direction: column;
      }
    }
  `]
})
export class PackageSettingsComponent implements OnInit {
  readonly message = signal('');
  readonly error = signal('');
  readonly saving = signal(false);

  settings: PackageSettingsState = cloneSettings(DEFAULT_SETTINGS);
  audit: PackageSettingsAudit = { ...DEFAULT_AUDIT };

  constructor(private readonly api: ApiService) {}

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.error.set('');
    this.message.set('');
    this.api.list<{ settings?: ApiRecord; audit?: PackageSettingsAudit }>('settings/packages').subscribe({
      next: (response) => {
        this.settings = this.normalizeSettings(response.settings || {});
        this.audit = this.normalizeAudit(response.audit);
      },
      error: () => {
        this.settings = cloneSettings(DEFAULT_SETTINGS);
        this.audit = { ...DEFAULT_AUDIT };
        this.error.set('Unable to load packages settings');
      }
    });
  }

  save(): void {
    this.saving.set(true);
    this.error.set('');
    this.message.set('');
    const settings = this.normalizeSettings(this.settings);
    this.api.put<{ settings?: ApiRecord; audit?: PackageSettingsAudit }>('settings/packages', { settings }).subscribe({
      next: (response) => {
        this.settings = this.normalizeSettings(response.settings || settings);
        this.audit = this.normalizeAudit(response.audit);
        this.message.set('Packages settings saved.');
        this.saving.set(false);
        window.setTimeout(() => this.message.set(''), 2500);
      },
      error: () => {
        this.error.set('Unable to save packages settings');
        this.saving.set(false);
      }
    });
  }

  private normalizeSettings(input: Partial<PackageSettingsState> | ApiRecord): PackageSettingsState {
    const record = input as Partial<PackageSettingsState>;
    const defaults = cloneSettings(DEFAULT_SETTINGS);
    const packageCatalog = (record.packageCatalog || {}) as Partial<PackageSettingsState['packageCatalog']>;
    const creditsRedemption = (record.creditsRedemption || {}) as Partial<PackageSettingsState['creditsRedemption']>;
    const expiryRenewal = (record.expiryRenewal || {}) as Partial<PackageSettingsState['expiryRenewal']>;
    const pricingPayment = (record.pricingPayment || {}) as Partial<PackageSettingsState['pricingPayment']>;
    const onlineBooking = (record.onlineBooking || {}) as Partial<PackageSettingsState['onlineBooking']>;
    const remindersRisk = (record.remindersRisk || {}) as Partial<PackageSettingsState['remindersRisk']>;
    const fallbackDefaults = (record.defaults || {}) as Partial<PackageSettingsState['defaults']>;
    return {
      packageCatalog: {
        packageSalesEnabled: boolValue(packageCatalog.packageSalesEnabled, defaults.packageCatalog.packageSalesEnabled),
        visibleInPos: boolValue(packageCatalog.visibleInPos, defaults.packageCatalog.visibleInPos),
        packageGroupsEnabled: boolValue(packageCatalog.packageGroupsEnabled, defaults.packageCatalog.packageGroupsEnabled),
        paidPackageAddonEnabled: boolValue(packageCatalog.paidPackageAddonEnabled, defaults.packageCatalog.paidPackageAddonEnabled)
      },
      creditsRedemption: {
        allowPartialRedemption: boolValue(creditsRedemption.allowPartialRedemption, defaults.creditsRedemption.allowPartialRedemption),
        allowCrossServiceRedemption: boolValue(creditsRedemption.allowCrossServiceRedemption, defaults.creditsRedemption.allowCrossServiceRedemption),
        blockRedemptionWhenExpired: boolValue(creditsRedemption.blockRedemptionWhenExpired, defaults.creditsRedemption.blockRedemptionWhenExpired),
        requireStaffConfirmation: boolValue(creditsRedemption.requireStaffConfirmation, defaults.creditsRedemption.requireStaffConfirmation)
      },
      expiryRenewal: {
        expiryDaysEnabled: boolValue(expiryRenewal.expiryDaysEnabled, defaults.expiryRenewal.expiryDaysEnabled),
        defaultExpiryDays: numberValue(expiryRenewal.defaultExpiryDays, defaults.expiryRenewal.defaultExpiryDays),
        renewalReminderDays: numberValue(expiryRenewal.renewalReminderDays, defaults.expiryRenewal.renewalReminderDays),
        expiredPendingAction: ['allow', 'warn', 'block'].includes(String(expiryRenewal.expiredPendingAction)) ? String(expiryRenewal.expiredPendingAction) : defaults.expiryRenewal.expiredPendingAction
      },
      pricingPayment: {
        allowDiscountOnPackage: boolValue(pricingPayment.allowDiscountOnPackage, defaults.pricingPayment.allowDiscountOnPackage),
        packageTaxApplicable: boolValue(pricingPayment.packageTaxApplicable, defaults.pricingPayment.packageTaxApplicable),
        taxInclusivePackagePrice: boolValue(pricingPayment.taxInclusivePackagePrice, defaults.pricingPayment.taxInclusivePackagePrice),
        allowDueOnPackageSale: boolValue(pricingPayment.allowDueOnPackageSale, defaults.pricingPayment.allowDueOnPackageSale)
      },
      onlineBooking: {
        showPackagesOnline: boolValue(onlineBooking.showPackagesOnline, defaults.onlineBooking.showPackagesOnline),
        allowClientPackagePurchase: boolValue(onlineBooking.allowClientPackagePurchase, defaults.onlineBooking.allowClientPackagePurchase),
        allowPackageServiceBooking: boolValue(onlineBooking.allowPackageServiceBooking, defaults.onlineBooking.allowPackageServiceBooking)
      },
      remindersRisk: {
        pendingCreditReminder: boolValue(remindersRisk.pendingCreditReminder, defaults.remindersRisk.pendingCreditReminder),
        expiryReminder: boolValue(remindersRisk.expiryReminder, defaults.remindersRisk.expiryReminder),
        ownerAlertForHighPendingValue: boolValue(remindersRisk.ownerAlertForHighPendingValue, defaults.remindersRisk.ownerAlertForHighPendingValue),
        highPendingValueThreshold: numberValue(remindersRisk.highPendingValueThreshold, defaults.remindersRisk.highPendingValueThreshold)
      },
      defaults: {
        defaultStatus: ['active', 'inactive'].includes(String(fallbackDefaults.defaultStatus)) ? String(fallbackDefaults.defaultStatus) : defaults.defaults.defaultStatus,
        defaultPackageType: ['serviceCredits', 'valueWallet', 'mixed'].includes(String(fallbackDefaults.defaultPackageType)) ? String(fallbackDefaults.defaultPackageType) : defaults.defaults.defaultPackageType
      }
    };
  }

  private normalizeAudit(input?: Partial<PackageSettingsAudit>): PackageSettingsAudit {
    return {
      lastChangedBy: stringValue(input?.lastChangedBy, DEFAULT_AUDIT.lastChangedBy),
      lastChangedAt: stringValue(input?.lastChangedAt, DEFAULT_AUDIT.lastChangedAt)
    };
  }
}
