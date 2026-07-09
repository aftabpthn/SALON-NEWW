import { CommonModule } from '@angular/common';
import { Component, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ApiRecord, ApiService } from '../core/api.service';

type BusinessDetailsSettingsState = {
  businessProfile: {
    businessName: string;
    branchDisplayName: string;
    ownerName: string;
  };
  contactDetails: {
    phone: string;
    whatsappNumber: string;
    email: string;
    website: string;
  };
  addressLocation: {
    addressLine1: string;
    addressLine2: string;
    city: string;
    stateProvince: string;
    country: string;
    postalCode: string;
  };
  invoiceIdentity: {
    invoiceBusinessName: string;
    invoiceFooterName: string;
    showBusinessDetailsOnInvoice: boolean;
    showLogoOnInvoice: boolean;
  };
  branding: {
    logoUrl: string;
    brandColor: string;
  };
  socialOnlineProfile: {
    instagramLink: string;
    facebookLink: string;
    googleProfileLink: string;
    onlineBookingProfileSlug: string;
  };
  legalRegistration: {
    registrationLabel: string;
    registrationNumber: string;
  };
};

const DEFAULT_SETTINGS: BusinessDetailsSettingsState = {
  businessProfile: {
    businessName: 'Aura Salon',
    branchDisplayName: '',
    ownerName: ''
  },
  contactDetails: {
    phone: '',
    whatsappNumber: '',
    email: '',
    website: ''
  },
  addressLocation: {
    addressLine1: '',
    addressLine2: '',
    city: '',
    stateProvince: '',
    country: 'India',
    postalCode: ''
  },
  invoiceIdentity: {
    invoiceBusinessName: 'Aura Salon',
    invoiceFooterName: 'Aura Salon',
    showBusinessDetailsOnInvoice: true,
    showLogoOnInvoice: true
  },
  branding: {
    logoUrl: '',
    brandColor: '#07956f'
  },
  socialOnlineProfile: {
    instagramLink: '',
    facebookLink: '',
    googleProfileLink: '',
    onlineBookingProfileSlug: ''
  },
  legalRegistration: {
    registrationLabel: 'GSTIN / Tax ID / TRN / VAT No',
    registrationNumber: ''
  }
};

function cloneSettings(settings: BusinessDetailsSettingsState): BusinessDetailsSettingsState {
  return JSON.parse(JSON.stringify(settings)) as BusinessDetailsSettingsState;
}

function textValue(value: unknown, fallback = ''): string {
  return String(value ?? fallback);
}

function boolValue(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

@Component({
  selector: 'app-business-details-settings',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  template: `
    <section class="business-settings-page">
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
        <a routerLink="/settings/others">Other Settings</a>
        <a routerLink="/settings/bill-setting">Bill Settings</a>
        <a class="active" routerLink="/settings/business-details">Business Details</a>
      <a routerLink="/settings/payment-methods">Payment Methods</a>
      <a routerLink="/settings/message-history">Message History</a>
      <a routerLink="/settings/sms-template">SMS Template</a>
      <a routerLink="/settings/security">Security</a>
      </aside>

      <main class="settings-content">
        <header class="settings-hero inner-page-header">
          <div>
            <span class="eyebrow">Setup / Business</span>
            <h1>Business Details Settings Control</h1>
            <p>Manage salon identity, branch contact details, invoice identity, branding, online profile links and registration details.</p>
          </div>
          <div class="hero-actions inner-action-bar">
            <a class="ghost-button" routerLink="/business-details">Manage Existing Profile</a>
            <button class="ghost-button" type="button" (click)="load()">Refresh</button>
            <button class="primary-button" type="button" (click)="save()" [disabled]="saving()">
              {{ saving() ? 'Saving...' : 'Save' }}
            </button>
          </div>
        </header>

        <p class="state success" *ngIf="message()">{{ message() }}</p>
        <p class="state danger" *ngIf="error()">{{ error() }}</p>
        <p class="phase-note">Next phase will connect invoices, receipts, WhatsApp templates, reports headers and online booking profile to these saved details.</p>

        <section class="settings-grid">
          <article class="settings-card inner-page-card">
            <h2>Business Profile</h2>
            <label class="field-row"><span>Business name</span><input [(ngModel)]="settings.businessProfile.businessName" /></label>
            <label class="field-row"><span>Branch display name</span><input [(ngModel)]="settings.businessProfile.branchDisplayName" /></label>
            <label class="field-row"><span>Owner name</span><input [(ngModel)]="settings.businessProfile.ownerName" /></label>
          </article>

          <article class="settings-card inner-page-card">
            <h2>Contact Details</h2>
            <label class="field-row"><span>Phone</span><input [(ngModel)]="settings.contactDetails.phone" /></label>
            <label class="field-row"><span>WhatsApp number</span><input [(ngModel)]="settings.contactDetails.whatsappNumber" /></label>
            <label class="field-row"><span>Email</span><input type="email" [(ngModel)]="settings.contactDetails.email" /></label>
            <label class="field-row"><span>Website</span><input [(ngModel)]="settings.contactDetails.website" /></label>
          </article>

          <article class="settings-card inner-page-card">
            <h2>Address & Location</h2>
            <label class="field-row"><span>Address line 1</span><input [(ngModel)]="settings.addressLocation.addressLine1" /></label>
            <label class="field-row"><span>Address line 2</span><input [(ngModel)]="settings.addressLocation.addressLine2" /></label>
            <label class="field-row"><span>City</span><input [(ngModel)]="settings.addressLocation.city" /></label>
            <label class="field-row"><span>State/Province</span><input [(ngModel)]="settings.addressLocation.stateProvince" /></label>
            <label class="field-row"><span>Country</span><input [(ngModel)]="settings.addressLocation.country" /></label>
            <label class="field-row"><span>Postal code</span><input [(ngModel)]="settings.addressLocation.postalCode" /></label>
          </article>

          <article class="settings-card inner-page-card">
            <h2>Invoice Identity</h2>
            <label class="field-row"><span>Invoice business name</span><input [(ngModel)]="settings.invoiceIdentity.invoiceBusinessName" /></label>
            <label class="field-row"><span>Invoice footer name</span><input [(ngModel)]="settings.invoiceIdentity.invoiceFooterName" /></label>
            <label class="switch-row">
              <span><strong>Show business details on invoice ON/OFF</strong><small>Display profile, address and registration on invoice print.</small></span>
              <input type="checkbox" [(ngModel)]="settings.invoiceIdentity.showBusinessDetailsOnInvoice" />
              <i aria-hidden="true"></i>
            </label>
            <label class="switch-row">
              <span><strong>Show logo on invoice ON/OFF</strong><small>Display business logo on invoice print.</small></span>
              <input type="checkbox" [(ngModel)]="settings.invoiceIdentity.showLogoOnInvoice" />
              <i aria-hidden="true"></i>
            </label>
          </article>

          <article class="settings-card inner-page-card">
            <h2>Branding</h2>
            <label class="field-row"><span>Logo URL</span><input [(ngModel)]="settings.branding.logoUrl" /></label>
            <label class="field-row color-row">
              <span>Brand color</span>
              <input type="color" [(ngModel)]="settings.branding.brandColor" />
              <input [(ngModel)]="settings.branding.brandColor" />
            </label>
          </article>

          <article class="settings-card inner-page-card">
            <h2>Social / Online Profile</h2>
            <label class="field-row"><span>Instagram link</span><input [(ngModel)]="settings.socialOnlineProfile.instagramLink" /></label>
            <label class="field-row"><span>Facebook link</span><input [(ngModel)]="settings.socialOnlineProfile.facebookLink" /></label>
            <label class="field-row"><span>Google profile link</span><input [(ngModel)]="settings.socialOnlineProfile.googleProfileLink" /></label>
            <label class="field-row"><span>Online booking profile slug</span><input [(ngModel)]="settings.socialOnlineProfile.onlineBookingProfileSlug" /></label>
          </article>

          <article class="settings-card inner-page-card">
            <h2>Legal / Registration</h2>
            <label class="field-row"><span>GSTIN / Tax ID / TRN / VAT No</span><input [(ngModel)]="settings.legalRegistration.registrationNumber" /></label>
            <label class="field-row"><span>Registration label</span><input [(ngModel)]="settings.legalRegistration.registrationLabel" /></label>
          </article>

          <article class="settings-card preview-card">
            <h2>Preview</h2>
            <div class="preview-panel">
              <div class="logo-preview" [style.background]="settings.branding.brandColor">{{ initials() }}</div>
              <div>
                <strong>{{ settings.businessProfile.businessName || 'Business name' }}</strong>
                <p>{{ settings.businessProfile.branchDisplayName || 'Branch display name' }}</p>
                <p>{{ settings.contactDetails.phone || 'Phone' }} · {{ settings.contactDetails.email || 'Email' }}</p>
                <p>{{ addressPreview() }}</p>
                <p>{{ settings.legalRegistration.registrationLabel }}: {{ settings.legalRegistration.registrationNumber || 'Not set' }}</p>
                <p>Invoice: {{ settings.invoiceIdentity.invoiceBusinessName || settings.businessProfile.businessName }}</p>
              </div>
            </div>
          </article>
        </section>
      </main>
    </section>
  `,
  styles: [`
    :host { display: block; color: #0f2235; }
    .business-settings-page {
      display: grid;
      grid-template-columns: 220px minmax(0, 1fr);
      gap: 18px;
      min-height: calc(100vh - 88px);
      padding: 20px;
      background: #f3f7f5;
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
      padding: 10px 12px;
      border-radius: 10px;
    }
    .settings-nav a.active,
    .settings-nav a:hover {
      background: #e1f5ed;
      color: #007b5f;
    }
    .settings-content { min-width: 0; display: grid; gap: 16px; }
    .settings-hero,
    .settings-card {
      background: #fff;
      border: 1px solid #d8e6df;
      border-radius: 16px;
      box-shadow: 0 20px 42px rgba(0, 27, 58, 0.06);
    }
    .settings-hero {
      display: flex;
      justify-content: space-between;
      gap: 16px;
      align-items: center;
      padding: 24px;
    }
    .eyebrow {
      display: block;
      color: #52645d;
      font-size: 0.75rem;
      font-weight: 900;
      letter-spacing: 0;
      text-transform: uppercase;
      margin-bottom: 8px;
    }
    h1, h2, p { margin: 0; }
    h1 { font-size: 2.2rem; line-height: 1.08; }
    h2 { font-size: 1rem; text-transform: uppercase; color: #52645d; }
    .settings-hero p,
    .phase-note,
    .state {
      color: #52645d;
      margin-top: 10px;
    }
    .hero-actions { display: flex; gap: 10px; flex-wrap: wrap; justify-content: flex-end; }
    .primary-button,
    .ghost-button {
      border: 1px solid #d8e6df;
      border-radius: 10px;
      padding: 12px 18px;
      font-weight: 900;
      text-decoration: none;
      cursor: pointer;
      white-space: nowrap;
    }
    .primary-button { background: #07956f; color: #fff; border-color: #07956f; }
    .ghost-button { background: #fff; color: #0f2235; }
    .primary-button:disabled { opacity: 0.65; cursor: progress; }
    .state,
    .phase-note {
      padding: 12px 14px;
      border-radius: 12px;
      font-weight: 800;
    }
    .state.success { background: #e9f8f0; border: 1px solid #b9e9d0; color: #07623f; }
    .state.danger { background: #fff1f1; border: 1px solid #ffc7c7; color: #b42318; }
    .phase-note { background: #fff8e8; border: 1px solid #f0d58a; color: #7a4d00; }
    .settings-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 16px;
    }
    .settings-card { min-width: 0; display: grid; gap: 12px; padding: 18px; align-content: start; }
    .field-row,
    .switch-row {
      display: grid;
      gap: 8px;
      padding: 12px 14px;
      border: 1px solid #d8e6df;
      border-radius: 12px;
      background: #fbfdfc;
    }
    .switch-row {
      grid-template-columns: minmax(0, 1fr) auto;
      gap: 14px;
      align-items: center;
    }
    .switch-row small { display: block; color: #5d6f68; margin-top: 4px; font-size: 0.82rem; }
    .field-row input {
      width: 100%;
      min-height: 42px;
      border: 1px solid #d8e6df;
      border-radius: 10px;
      padding: 0 12px;
      font: inherit;
      background: #fff;
    }
    .color-row {
      grid-template-columns: 120px minmax(0, 1fr);
      align-items: center;
    }
    .color-row span { grid-column: 1 / -1; }
    .color-row input[type="color"] { padding: 4px; }
    .switch-row input[type="checkbox"] { position: absolute; opacity: 0; pointer-events: none; }
    .switch-row i {
      width: 48px;
      height: 28px;
      border-radius: 999px;
      background: #cbd5dd;
      position: relative;
      transition: background 0.2s ease;
    }
    .switch-row i::after {
      content: '';
      position: absolute;
      top: 4px;
      left: 4px;
      width: 20px;
      height: 20px;
      border-radius: 50%;
      background: #fff;
      transition: transform 0.2s ease;
      box-shadow: 0 2px 4px rgba(0,0,0,0.18);
    }
    .switch-row input:checked + i { background: #132235; }
    .switch-row input:checked + i::after { transform: translateX(20px); }
    .preview-card { grid-column: 1 / -1; }
    .preview-panel {
      display: grid;
      grid-template-columns: auto minmax(0, 1fr);
      gap: 16px;
      align-items: start;
      padding: 16px;
      border: 1px solid #d8e6df;
      border-radius: 14px;
      background: #f8fbfa;
    }
    .logo-preview {
      display: grid;
      place-items: center;
      width: 64px;
      height: 64px;
      border-radius: 16px;
      color: #fff;
      font-weight: 900;
    }
    .preview-panel p { color: #52645d; margin-top: 6px; }
    @media (max-width: 980px) {
      .business-settings-page { grid-template-columns: 1fr; }
      .settings-nav { position: static; grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .settings-hero { align-items: flex-start; flex-direction: column; }
      .settings-grid { grid-template-columns: 1fr; }
      .preview-panel { grid-template-columns: 1fr; }
    }
  `]
})
export class BusinessDetailsSettingsComponent implements OnInit {
  readonly saving = signal(false);
  readonly message = signal('');
  readonly error = signal('');
  settings: BusinessDetailsSettingsState = cloneSettings(DEFAULT_SETTINGS);

  constructor(private readonly api: ApiService) {}

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.error.set('');
    this.message.set('');
    this.api.list<{ settings?: ApiRecord }>('settings/business-details').subscribe({
      next: (response) => {
        this.settings = this.normalize(response?.settings);
      },
      error: () => {
        this.settings = cloneSettings(DEFAULT_SETTINGS);
        this.error.set('Unable to load business details settings');
      }
    });
  }

  save(): void {
    this.saving.set(true);
    this.error.set('');
    this.message.set('');
    const settings = this.normalize(this.settings);
    this.api.put<{ settings?: ApiRecord }>('settings/business-details', { settings }).subscribe({
      next: (response) => {
        this.settings = this.normalize(response?.settings || settings);
        this.message.set('Business details settings saved');
        this.saving.set(false);
      },
      error: () => {
        this.error.set('Unable to save business details settings');
        this.saving.set(false);
      }
    });
  }

  initials(): string {
    const name = this.settings.businessProfile.businessName || 'Aura Salon';
    return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('') || 'AS';
  }

  addressPreview(): string {
    return [
      this.settings.addressLocation.addressLine1,
      this.settings.addressLocation.addressLine2,
      this.settings.addressLocation.city,
      this.settings.addressLocation.stateProvince,
      this.settings.addressLocation.country,
      this.settings.addressLocation.postalCode
    ].filter(Boolean).join(', ') || 'Address not set';
  }

  private normalize(input: unknown): BusinessDetailsSettingsState {
    const source = (input || {}) as Partial<BusinessDetailsSettingsState>;
    const businessProfile = (source.businessProfile || {}) as Partial<BusinessDetailsSettingsState['businessProfile']>;
    const contactDetails = (source.contactDetails || {}) as Partial<BusinessDetailsSettingsState['contactDetails']>;
    const addressLocation = (source.addressLocation || {}) as Partial<BusinessDetailsSettingsState['addressLocation']>;
    const invoiceIdentity = (source.invoiceIdentity || {}) as Partial<BusinessDetailsSettingsState['invoiceIdentity']>;
    const branding = (source.branding || {}) as Partial<BusinessDetailsSettingsState['branding']>;
    const socialOnlineProfile = (source.socialOnlineProfile || {}) as Partial<BusinessDetailsSettingsState['socialOnlineProfile']>;
    const legalRegistration = (source.legalRegistration || {}) as Partial<BusinessDetailsSettingsState['legalRegistration']>;

    return {
      businessProfile: {
        businessName: textValue(businessProfile.businessName, DEFAULT_SETTINGS.businessProfile.businessName),
        branchDisplayName: textValue(businessProfile.branchDisplayName, DEFAULT_SETTINGS.businessProfile.branchDisplayName),
        ownerName: textValue(businessProfile.ownerName, DEFAULT_SETTINGS.businessProfile.ownerName)
      },
      contactDetails: {
        phone: textValue(contactDetails.phone, DEFAULT_SETTINGS.contactDetails.phone),
        whatsappNumber: textValue(contactDetails.whatsappNumber, DEFAULT_SETTINGS.contactDetails.whatsappNumber),
        email: textValue(contactDetails.email, DEFAULT_SETTINGS.contactDetails.email),
        website: textValue(contactDetails.website, DEFAULT_SETTINGS.contactDetails.website)
      },
      addressLocation: {
        addressLine1: textValue(addressLocation.addressLine1, DEFAULT_SETTINGS.addressLocation.addressLine1),
        addressLine2: textValue(addressLocation.addressLine2, DEFAULT_SETTINGS.addressLocation.addressLine2),
        city: textValue(addressLocation.city, DEFAULT_SETTINGS.addressLocation.city),
        stateProvince: textValue(addressLocation.stateProvince, DEFAULT_SETTINGS.addressLocation.stateProvince),
        country: textValue(addressLocation.country, DEFAULT_SETTINGS.addressLocation.country),
        postalCode: textValue(addressLocation.postalCode, DEFAULT_SETTINGS.addressLocation.postalCode)
      },
      invoiceIdentity: {
        invoiceBusinessName: textValue(invoiceIdentity.invoiceBusinessName, DEFAULT_SETTINGS.invoiceIdentity.invoiceBusinessName),
        invoiceFooterName: textValue(invoiceIdentity.invoiceFooterName, DEFAULT_SETTINGS.invoiceIdentity.invoiceFooterName),
        showBusinessDetailsOnInvoice: boolValue(invoiceIdentity.showBusinessDetailsOnInvoice, DEFAULT_SETTINGS.invoiceIdentity.showBusinessDetailsOnInvoice),
        showLogoOnInvoice: boolValue(invoiceIdentity.showLogoOnInvoice, DEFAULT_SETTINGS.invoiceIdentity.showLogoOnInvoice)
      },
      branding: {
        logoUrl: textValue(branding.logoUrl, DEFAULT_SETTINGS.branding.logoUrl),
        brandColor: /^#[0-9a-fA-F]{6}$/.test(String(branding.brandColor || '')) ? String(branding.brandColor) : DEFAULT_SETTINGS.branding.brandColor
      },
      socialOnlineProfile: {
        instagramLink: textValue(socialOnlineProfile.instagramLink, DEFAULT_SETTINGS.socialOnlineProfile.instagramLink),
        facebookLink: textValue(socialOnlineProfile.facebookLink, DEFAULT_SETTINGS.socialOnlineProfile.facebookLink),
        googleProfileLink: textValue(socialOnlineProfile.googleProfileLink, DEFAULT_SETTINGS.socialOnlineProfile.googleProfileLink),
        onlineBookingProfileSlug: textValue(socialOnlineProfile.onlineBookingProfileSlug, DEFAULT_SETTINGS.socialOnlineProfile.onlineBookingProfileSlug)
      },
      legalRegistration: {
        registrationLabel: textValue(legalRegistration.registrationLabel, DEFAULT_SETTINGS.legalRegistration.registrationLabel),
        registrationNumber: textValue(legalRegistration.registrationNumber, DEFAULT_SETTINGS.legalRegistration.registrationNumber)
      }
    };
  }
}
