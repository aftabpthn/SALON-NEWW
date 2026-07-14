import { CommonModule } from '@angular/common';
import { Component, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ApiRecord, ApiService } from '../core/api.service';
import { AuraDatePipe } from '../shared/pipes/aura-date.pipe';

type OtherSettingKey =
  | 'discountMembership'
  | 'barcodeBilling'
  | 'tipOption'
  | 'packageExpiryDays'
  | 'paidPackageAddon'
  | 'appointmentProductSearchByBrandAndType'
  | 'appointmentProductSearchByProductName'
  | 'staffCommissionOnBookingForm';

type OtherSettingsState = Record<OtherSettingKey, boolean>;

type OtherSettingsAudit = {
  lastChangedBy: string;
  lastChangedAt: string;
};

type OtherSettingItem = {
  key: OtherSettingKey;
  label: string;
  description: string;
  appliesTo: string[];
  impactOn: string;
  impactOff: string;
  riskyWhenOff?: boolean;
};

const DEFAULT_SETTINGS: OtherSettingsState = {
  discountMembership: true,
  barcodeBilling: true,
  tipOption: true,
  packageExpiryDays: true,
  paidPackageAddon: true,
  appointmentProductSearchByBrandAndType: true,
  appointmentProductSearchByProductName: true,
  staffCommissionOnBookingForm: true
};

const DEFAULT_AUDIT: OtherSettingsAudit = {
  lastChangedBy: 'Not saved yet',
  lastChangedAt: ''
};

const SETTING_ITEMS: OtherSettingItem[] = [
  {
    key: 'discountMembership',
    label: 'Discount Membership',
    description: 'Assign different discounts to customers so they can avail them during appointments.',
    appliesTo: ['POS', 'Appointment', 'Package'],
    impactOn: 'Membership discounts can be applied during appointment and billing flows.',
    impactOff: 'Membership discounts stay hidden from appointment and billing flows.'
  },
  {
    key: 'barcodeBilling',
    label: 'Barcode Billing',
    description: 'Enable barcode scanning during billing to scan product barcodes in POS.',
    appliesTo: ['POS', 'Product Consume'],
    impactOn: 'Barcode ON means POS product scan is enabled.',
    impactOff: 'Barcode OFF means billing users must search products manually.'
  },
  {
    key: 'tipOption',
    label: 'Tip Option',
    description: 'Activate tip collection for clients who want to pay gratuity to staff.',
    appliesTo: ['POS', 'Appointment'],
    impactOn: 'Tip line appears in billing and staff gratuity tracking.',
    impactOff: 'Tip collection is hidden from POS billing.'
  },
  {
    key: 'packageExpiryDays',
    label: 'Package Expiry Days',
    description: 'Control whether package expiry days are required for client packages.',
    appliesTo: ['Package', 'Appointment'],
    impactOn: 'Packages keep expiry controls and pending package liability is time-bound.',
    impactOff: 'Package expiry is disabled and package liability can remain open-ended.',
    riskyWhenOff: true
  },
  {
    key: 'paidPackageAddon',
    label: 'Paid Package AddOn',
    description: 'Manage paid package add-ons that can be attached to package sales.',
    appliesTo: ['Package', 'POS'],
    impactOn: 'Paid package add-ons can be selected during package sales.',
    impactOff: 'Paid package add-ons are hidden.'
  },
  {
    key: 'appointmentProductSearchByBrandAndType',
    label: 'Search products on appointments using brands and product type',
    description: 'Search appointment products using brand and product type filters.',
    appliesTo: ['Appointment', 'Product Consume'],
    impactOn: 'Appointment product search supports brand and product type filters.',
    impactOff: 'Brand and product type filters are hidden from appointment product search.'
  },
  {
    key: 'appointmentProductSearchByProductName',
    label: 'Search products on appointments using product name',
    description: 'Search appointment products by product name.',
    appliesTo: ['Appointment', 'Product Consume'],
    impactOn: 'Appointment product search supports product name lookup.',
    impactOff: 'Product name search is hidden from appointment product search.'
  },
  {
    key: 'staffCommissionOnBookingForm',
    label: 'Staff Commission on booking form?',
    description: 'Show staff commission option on booking forms.',
    appliesTo: ['Appointment', 'POS'],
    impactOn: 'Booking form can capture staff commission option.',
    impactOff: 'Staff commission option is hidden from booking form.'
  }
];

@Component({
  selector: 'app-other-settings',
  standalone: true,
  imports: [AuraDatePipe, CommonModule, FormsModule, RouterLink],
  template: `
    <section class="other-settings-page inner-page-shell">
      <aside class="settings-nav" aria-label="Settings sections">
        <a routerLink="/settings/general">General Settings</a>
        <a routerLink="/settings/products">Products Settings</a>
        <a routerLink="/settings/supplier">Supplier Settings</a>
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
        <a class="active" routerLink="/settings/others">Other Settings</a>
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
            <span class="eyebrow">Setup / POS & Appointment</span>
            <h1>Other Settings</h1>
            <p>Manage additional point-of-sale, package, product search, tip, barcode, and appointment settings.</p>
          </div>
          <div class="hero-actions inner-action-bar">
            <button class="ghost-button" type="button" (click)="load()">Refresh</button>
            <button class="ghost-button" type="button" (click)="resetDefaults()">Reset to defaults</button>
            <button class="primary-button" type="button" (click)="save()" [disabled]="saving()">
              {{ saving() ? 'Saving...' : 'Save' }}
            </button>
          </div>
        </header>

        <p class="state success" *ngIf="message()">{{ message() }}</p>
        <p class="state danger" *ngIf="error()">{{ error() }}</p>
        <p class="risk-warning" *ngIf="settings.packageExpiryDays === false">Package expiry is OFF. Pending package services can remain open-ended until next phase controls consume this policy.</p>

        <section class="control-panel">
          <label class="search-field">
            <span>Search/filter settings</span>
            <input [(ngModel)]="search" placeholder="Search POS, package, barcode, tip, appointment" />
          </label>
          <div class="audit-box">
            <span>Audit info</span>
            <strong>Last changed by: {{ audit.lastChangedBy || 'Not saved yet' }}</strong>
            <small>Last changed time: {{ audit.lastChangedAt ? (audit.lastChangedAt | auraDate:'date') : 'Not saved yet' }}</small>
          </div>
        </section>

        <section class="settings-list">
          <article class="setting-row" *ngFor="let item of visibleItems(); trackBy: trackItem">
            <div class="setting-main">
              <h2>{{ item.label }}</h2>
              <p>{{ item.description }}</p>
              <div class="badge-row">
                <span *ngFor="let badge of item.appliesTo">{{ badge }}</span>
              </div>
              <div class="impact-preview" [class.off]="!isEnabled(item.key)">
                {{ isEnabled(item.key) ? item.impactOn : item.impactOff }}
              </div>
            </div>
            <label class="switch-control" [attr.aria-label]="item.label">
              <input type="checkbox" [ngModel]="isEnabled(item.key)" (ngModelChange)="setEnabled(item.key, $event)" />
              <i aria-hidden="true"></i>
            </label>
          </article>
        </section>
      </main>
    </section>
  `,
  styles: [`
    .other-settings-page {
      display: grid;
      grid-template-columns: 220px minmax(0, 1fr);
      gap: 18px;
      padding: 20px;
      background: #f6f8f7;
      min-height: calc(100vh - 74px);
      color: var(--ink);
    }

    .settings-nav {
      position: sticky;
      top: 90px;
      align-self: start;
      background: #ffffff;
      border: 1px solid #d9e5e0;
      border-radius: 18px;
      padding: 14px;
      display: grid;
      gap: 8px;
    }

    .settings-nav a {
      color: #263a4d;
      text-decoration: none;
      font-weight: 800;
      padding: 10px 12px;
      border-radius: 12px;
    }

    .settings-nav a.active,
    .settings-nav a:hover {
      background: #e8f7f1;
      color: #08785d;
    }

    .settings-content {
      min-width: 0;
      display: grid;
      gap: 16px;
    }

    .settings-hero,
    .control-panel,
    .setting-row {
      background: #ffffff;
      border: 1px solid #d9e5e0;
      border-radius: 18px;
      box-shadow: 0 14px 32px rgba(15, 23, 42, 0.06);
    }

    .settings-hero {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      padding: 24px;
    }

    .eyebrow {
      color: #5b6a63;
      font-size: 0.78rem;
      text-transform: uppercase;
      font-weight: 900;
      letter-spacing: 0;
    }

    h1 {
      margin: 4px 0 8px;
      font-size: clamp(2rem, 4vw, 3rem);
      letter-spacing: 0;
    }

    h2 {
      margin: 0;
      font-size: 1.1rem;
      letter-spacing: 0;
    }

    p {
      margin: 0;
      color: #55677a;
    }

    .hero-actions {
      display: flex;
      gap: 10px;
      flex-wrap: wrap;
      justify-content: flex-end;
    }

    button {
      border: 0;
      border-radius: 12px;
      padding: 12px 18px;
      font-weight: 900;
      cursor: pointer;
    }

    button:disabled {
      opacity: 0.65;
      cursor: wait;
    }

    .primary-button {
      background: #0a9b72;
      color: #ffffff;
    }

    .ghost-button {
      background: #ffffff;
      border: 1px solid #d9e5e0;
      color: #172334;
    }

    .state,
    .risk-warning {
      border-radius: 14px;
      padding: 12px 14px;
      font-weight: 800;
    }

    .state.success {
      background: #e8f7f1;
      color: #08785d;
      border: 1px solid #9bddca;
    }

    .state.danger {
      background: #fff0f0;
      color: #b42318;
      border: 1px solid #ffc9c9;
    }

    .risk-warning {
      background: #fff8e7;
      color: #805600;
      border: 1px solid #f0d48a;
    }

    .control-panel {
      display: grid;
      grid-template-columns: minmax(260px, 1fr) minmax(240px, auto);
      gap: 14px;
      padding: 18px;
      align-items: end;
    }

    .search-field,
    .audit-box {
      display: grid;
      gap: 7px;
      font-weight: 900;
      min-width: 0;
    }

    .audit-box {
      border: 1px solid #d9e5e0;
      border-radius: 14px;
      padding: 12px;
      background: #fbfdfc;
    }

    .audit-box span,
    .audit-box small {
      color: #627385;
      font-weight: 800;
    }

    input {
      width: 100%;
      border: 1px solid #d9e5e0;
      border-radius: 12px;
      padding: 12px;
      color: #172334;
      background: #ffffff;
      font: inherit;
      min-width: 0;
    }

    .settings-list {
      display: grid;
      gap: 12px;
    }

    .setting-row {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: 16px;
      align-items: center;
      padding: 18px;
    }

    .setting-main {
      display: grid;
      gap: 9px;
      min-width: 0;
    }

    .badge-row {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }

    .badge-row span {
      border: 1px solid #a7dcca;
      background: #e8f7f1;
      color: #08785d;
      border-radius: 999px;
      padding: 5px 9px;
      font-size: 0.78rem;
      font-weight: 900;
    }

    .impact-preview {
      border: 1px solid #cfe7dc;
      background: #f5fbf8;
      color: #234d42;
      border-radius: 12px;
      padding: 10px 12px;
      font-weight: 800;
    }

    .impact-preview.off {
      border-color: #f0d48a;
      background: #fff8e7;
      color: #805600;
    }

    .switch-control {
      width: 52px;
      height: 30px;
      position: relative;
      display: inline-flex;
      align-items: center;
      cursor: pointer;
    }

    .switch-control input {
      position: absolute;
      opacity: 0;
      pointer-events: none;
    }

    .switch-control i {
      width: 52px;
      height: 30px;
      border-radius: 999px;
      background: #cbd5df;
      position: relative;
      transition: background 0.16s ease;
    }

    .switch-control i::after {
      content: '';
      position: absolute;
      width: 22px;
      height: 22px;
      left: 4px;
      top: 4px;
      border-radius: 999px;
      background: #ffffff;
      transition: transform 0.16s ease;
    }

    .switch-control input:checked + i {
      background: #111827;
    }

    .switch-control input:checked + i::after {
      transform: translateX(22px);
    }

    @media (max-width: 1100px) {
      .other-settings-page {
        grid-template-columns: 1fr;
      }

      .settings-nav {
        position: static;
        display: flex;
        overflow-x: auto;
      }

      .settings-nav a {
        white-space: nowrap;
      }

      .control-panel {
        grid-template-columns: 1fr;
      }
    }

    @media (max-width: 720px) {
      .other-settings-page {
        padding: 12px;
      }

      .settings-hero,
      .setting-row {
        align-items: flex-start;
        grid-template-columns: 1fr;
      }

      .settings-hero {
        flex-direction: column;
      }

      .hero-actions {
        width: 100%;
      }

      .hero-actions button {
        flex: 1;
      }
    }
  `]
})
export class OtherSettingsComponent implements OnInit {
  readonly saving = signal(false);
  readonly message = signal('');
  readonly error = signal('');

  search = '';
  settings: OtherSettingsState = { ...DEFAULT_SETTINGS };
  audit: OtherSettingsAudit = { ...DEFAULT_AUDIT };
  readonly items = SETTING_ITEMS;

  constructor(private readonly api: ApiService) {}

  ngOnInit(): void {
    this.load();
  }

  visibleItems(): OtherSettingItem[] {
    const term = this.search.trim().toLowerCase();
    if (!term) return this.items;
    return this.items.filter((item) => {
      const haystack = `${item.label} ${item.description} ${item.appliesTo.join(' ')} ${item.impactOn} ${item.impactOff}`.toLowerCase();
      return haystack.includes(term);
    });
  }

  isEnabled(key: OtherSettingKey): boolean {
    return this.settings[key] === true;
  }

  setEnabled(key: OtherSettingKey, value: boolean): void {
    this.settings = { ...this.settings, [key]: value === true };
  }

  resetDefaults(): void {
    this.settings = { ...DEFAULT_SETTINGS };
    this.message.set('Defaults restored. Save to apply.');
    this.error.set('');
  }

  load(): void {
    this.error.set('');
    this.message.set('');
    this.api.list<{ settings?: ApiRecord; audit?: OtherSettingsAudit }>('settings/others').subscribe({
      next: (result) => {
        this.settings = this.normalize(result.settings || {});
        this.audit = { ...DEFAULT_AUDIT, ...(result.audit || {}) };
      },
      error: (error) => {
        this.error.set(error?.error?.error || error?.message || 'Unable to load other settings');
      }
    });
  }

  save(): void {
    this.saving.set(true);
    this.error.set('');
    this.message.set('');
    const settings = this.normalize(this.settings);
    this.api.put<{ settings?: ApiRecord; audit?: OtherSettingsAudit }>('settings/others', { settings }).subscribe({
      next: (result) => {
        this.settings = this.normalize(result.settings || settings);
        this.audit = { ...DEFAULT_AUDIT, ...(result.audit || this.audit) };
        this.message.set('Other settings saved');
        this.saving.set(false);
      },
      error: (error) => {
        this.error.set(error?.error?.error || error?.message || 'Unable to save other settings');
        this.saving.set(false);
      }
    });
  }

  trackItem(_: number, item: OtherSettingItem): string {
    return item.key;
  }

  private normalize(input: ApiRecord | OtherSettingsState): OtherSettingsState {
    const raw = input as Partial<OtherSettingsState>;
    return {
      discountMembership: raw.discountMembership !== false,
      barcodeBilling: raw.barcodeBilling !== false,
      tipOption: raw.tipOption !== false,
      packageExpiryDays: raw.packageExpiryDays !== false,
      paidPackageAddon: raw.paidPackageAddon !== false,
      appointmentProductSearchByBrandAndType: raw.appointmentProductSearchByBrandAndType !== false,
      appointmentProductSearchByProductName: raw.appointmentProductSearchByProductName !== false,
      staffCommissionOnBookingForm: raw.staffCommissionOnBookingForm !== false
    };
  }
}
