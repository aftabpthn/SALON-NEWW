import { CommonModule } from '@angular/common';
import { Component, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ApiRecord, ApiService } from '../core/api.service';
import { AuraDatePipe } from '../shared/pipes/aura-date.pipe';

type ServiceSettingsState = {
  serviceCatalog: {
    serviceGroupsEnabled: boolean;
    serviceAddonsEnabled: boolean;
    packagesEnabled: boolean;
    membershipServicesEnabled: boolean;
  };
  pricingDuration: {
    defaultDurationMinutes: number;
    allowCustomDuration: boolean;
    allowPriceOverride: boolean;
    taxInclusiveDefault: boolean;
  };
  staffAssignment: {
    staffAssignmentRequired: boolean;
    allowMultiStaff: boolean;
    skillBasedAssignment: boolean;
    roomResourceRequired: boolean;
  };
  onlineBooking: {
    showServicesOnline: boolean;
    hideInactiveServices: boolean;
    allowPackageServiceBooking: boolean;
    requireDepositForOnlineServices: boolean;
  };
  recipeInventory: {
    requireRecipeForService: boolean;
    blockConsumeWithoutRecipe: boolean;
    warnHighWastage: boolean;
  };
  commission: {
    staffCommissionEnabled: boolean;
    commissionBasis: string;
    incentiveEligible: boolean;
  };
  qualityControl: {
    requireServiceNotes: boolean;
    requireBeforeAfterPhoto: boolean;
    consentRequiredForRiskServices: boolean;
  };
  defaults: {
    defaultStatus: string;
    defaultGstRate: number;
  };
};

type ServiceSettingsAudit = {
  lastChangedBy: string;
  lastChangedAt: string;
};

const DEFAULT_SETTINGS: ServiceSettingsState = {
  serviceCatalog: {
    serviceGroupsEnabled: true,
    serviceAddonsEnabled: true,
    packagesEnabled: true,
    membershipServicesEnabled: true
  },
  pricingDuration: {
    defaultDurationMinutes: 30,
    allowCustomDuration: true,
    allowPriceOverride: true,
    taxInclusiveDefault: false
  },
  staffAssignment: {
    staffAssignmentRequired: false,
    allowMultiStaff: true,
    skillBasedAssignment: true,
    roomResourceRequired: false
  },
  onlineBooking: {
    showServicesOnline: true,
    hideInactiveServices: true,
    allowPackageServiceBooking: true,
    requireDepositForOnlineServices: false
  },
  recipeInventory: {
    requireRecipeForService: false,
    blockConsumeWithoutRecipe: false,
    warnHighWastage: true
  },
  commission: {
    staffCommissionEnabled: true,
    commissionBasis: 'servicePrice',
    incentiveEligible: true
  },
  qualityControl: {
    requireServiceNotes: false,
    requireBeforeAfterPhoto: false,
    consentRequiredForRiskServices: true
  },
  defaults: {
    defaultStatus: 'active',
    defaultGstRate: 18
  }
};

const DEFAULT_AUDIT: ServiceSettingsAudit = {
  lastChangedBy: 'Not saved yet',
  lastChangedAt: ''
};

function cloneSettings(settings: ServiceSettingsState): ServiceSettingsState {
  return JSON.parse(JSON.stringify(settings)) as ServiceSettingsState;
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
  selector: 'app-service-settings',
  standalone: true,
  imports: [AuraDatePipe, CommonModule, FormsModule, RouterLink],
  template: `
    <section class="service-settings-page inner-page-shell">
      <aside class="settings-nav" aria-label="Settings sections">
        <a routerLink="/settings/general">General Settings</a>
        <a routerLink="/settings/products">Products Settings</a>
        <a routerLink="/settings/supplier">Supplier Settings</a>
        <a routerLink="/settings/inventory">Inventory Settings</a>
        <a class="active" routerLink="/settings/services">Services Settings</a>
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
        <a routerLink="/settings/security">Security</a>
      </aside>

      <main class="settings-content">
        <header class="settings-hero inner-page-header">
          <div>
            <span class="eyebrow">Setup / Services</span>
            <h1>Services Settings Control</h1>
            <p>Control service catalog behavior, pricing defaults, staff assignment, online booking visibility, recipes, commission and quality rules.</p>
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
        <p class="phase-note">Next phase will connect service create/edit, packages, memberships, online booking, POS billing and product consume recipes to this saved policy.</p>

        <section class="audit-strip">
          <strong>Audit info</strong>
          <span>Last changed by: {{ audit.lastChangedBy || 'Not saved yet' }}</span>
          <span>Last changed time: {{ audit.lastChangedAt ? (audit.lastChangedAt | auraDate:'date') : 'Not saved yet' }}</span>
        </section>

        <section class="settings-grid inner-form-grid">
          <article class="settings-card inner-page-card">
            <h2>Service Catalog</h2>
            <label class="switch-row"><span><strong>Service groups enabled</strong><small>Use category/group organization on services.</small></span><input type="checkbox" [(ngModel)]="settings.serviceCatalog.serviceGroupsEnabled" /><i></i></label>
            <label class="switch-row"><span><strong>Service add-ons enabled</strong><small>Allow add-on services during billing or booking.</small></span><input type="checkbox" [(ngModel)]="settings.serviceCatalog.serviceAddonsEnabled" /><i></i></label>
            <label class="switch-row"><span><strong>Packages enabled</strong><small>Allow services to be included in packages.</small></span><input type="checkbox" [(ngModel)]="settings.serviceCatalog.packagesEnabled" /><i></i></label>
            <label class="switch-row"><span><strong>Membership services enabled</strong><small>Allow service credits to be linked with memberships.</small></span><input type="checkbox" [(ngModel)]="settings.serviceCatalog.membershipServicesEnabled" /><i></i></label>
          </article>

          <article class="settings-card inner-page-card">
            <h2>Pricing & Duration</h2>
            <label class="field-row"><span>Default duration minutes</span><input type="number" min="5" max="480" [(ngModel)]="settings.pricingDuration.defaultDurationMinutes" /></label>
            <label class="switch-row"><span><strong>Allow custom duration</strong><small>Permit custom service duration on edit.</small></span><input type="checkbox" [(ngModel)]="settings.pricingDuration.allowCustomDuration" /><i></i></label>
            <label class="switch-row"><span><strong>Allow price override</strong><small>Permit authorized users to change service price.</small></span><input type="checkbox" [(ngModel)]="settings.pricingDuration.allowPriceOverride" /><i></i></label>
            <label class="switch-row"><span><strong>Tax inclusive default</strong><small>New service prices default to tax-inclusive.</small></span><input type="checkbox" [(ngModel)]="settings.pricingDuration.taxInclusiveDefault" /><i></i></label>
          </article>

          <article class="settings-card inner-page-card">
            <h2>Staff Assignment</h2>
            <label class="switch-row"><span><strong>Staff assignment required</strong><small>Require staff selection for each service.</small></span><input type="checkbox" [(ngModel)]="settings.staffAssignment.staffAssignmentRequired" /><i></i></label>
            <label class="switch-row"><span><strong>Allow multi-staff</strong><small>Allow more than one staff member on a service.</small></span><input type="checkbox" [(ngModel)]="settings.staffAssignment.allowMultiStaff" /><i></i></label>
            <label class="switch-row"><span><strong>Skill based assignment</strong><small>Prefer staff matched to service skill rules.</small></span><input type="checkbox" [(ngModel)]="settings.staffAssignment.skillBasedAssignment" /><i></i></label>
            <label class="switch-row"><span><strong>Room / resource required</strong><small>Require room or chair mapping for services.</small></span><input type="checkbox" [(ngModel)]="settings.staffAssignment.roomResourceRequired" /><i></i></label>
          </article>

          <article class="settings-card inner-page-card">
            <h2>Online Booking</h2>
            <label class="switch-row"><span><strong>Show services online</strong><small>Allow services to appear on booking profile.</small></span><input type="checkbox" [(ngModel)]="settings.onlineBooking.showServicesOnline" /><i></i></label>
            <label class="switch-row"><span><strong>Hide inactive services</strong><small>Keep inactive services hidden from clients.</small></span><input type="checkbox" [(ngModel)]="settings.onlineBooking.hideInactiveServices" /><i></i></label>
            <label class="switch-row"><span><strong>Allow package service booking</strong><small>Allow package-credit services to be booked.</small></span><input type="checkbox" [(ngModel)]="settings.onlineBooking.allowPackageServiceBooking" /><i></i></label>
            <label class="switch-row"><span><strong>Require deposit for online services</strong><small>Use deposit requirement for online service bookings.</small></span><input type="checkbox" [(ngModel)]="settings.onlineBooking.requireDepositForOnlineServices" /><i></i></label>
          </article>

          <article class="settings-card inner-page-card">
            <h2>Recipe & Inventory</h2>
            <label class="switch-row"><span><strong>Require recipe for service</strong><small>Ask service owners to maintain product recipe.</small></span><input type="checkbox" [(ngModel)]="settings.recipeInventory.requireRecipeForService" /><i></i></label>
            <label class="switch-row"><span><strong>Block consume without recipe</strong><small>Stop product consume confirmation when recipe is missing.</small></span><input type="checkbox" [(ngModel)]="settings.recipeInventory.blockConsumeWithoutRecipe" /><i></i></label>
            <label class="switch-row"><span><strong>Warn high wastage</strong><small>Show warnings when product consume wastage is high.</small></span><input type="checkbox" [(ngModel)]="settings.recipeInventory.warnHighWastage" /><i></i></label>
          </article>

          <article class="settings-card inner-page-card">
            <h2>Commission</h2>
            <label class="switch-row"><span><strong>Staff commission enabled</strong><small>Mark services eligible for staff commission.</small></span><input type="checkbox" [(ngModel)]="settings.commission.staffCommissionEnabled" /><i></i></label>
            <label class="field-row"><span>Commission basis</span><select [(ngModel)]="settings.commission.commissionBasis"><option value="servicePrice">Service Price</option><option value="netOfDiscount">Net of Discount</option><option value="netOfTax">Net of Tax</option></select></label>
            <label class="switch-row"><span><strong>Incentive eligible</strong><small>Allow services to participate in incentive rules.</small></span><input type="checkbox" [(ngModel)]="settings.commission.incentiveEligible" /><i></i></label>
          </article>

          <article class="settings-card inner-page-card">
            <h2>Quality Control</h2>
            <label class="switch-row"><span><strong>Require service notes</strong><small>Ask staff to add notes for selected services.</small></span><input type="checkbox" [(ngModel)]="settings.qualityControl.requireServiceNotes" /><i></i></label>
            <label class="switch-row"><span><strong>Require before / after photo</strong><small>Capture visual record for quality-sensitive services.</small></span><input type="checkbox" [(ngModel)]="settings.qualityControl.requireBeforeAfterPhoto" /><i></i></label>
            <label class="switch-row"><span><strong>Consent required for risk services</strong><small>Require consent flow for chemical or risk services.</small></span><input type="checkbox" [(ngModel)]="settings.qualityControl.consentRequiredForRiskServices" /><i></i></label>
          </article>

          <article class="settings-card inner-page-card">
            <h2>Defaults</h2>
            <label class="field-row"><span>Default service status</span><select [(ngModel)]="settings.defaults.defaultStatus"><option value="active">Active</option><option value="inactive">Inactive</option></select></label>
            <label class="field-row"><span>Default GST / tax rate %</span><input type="number" min="0" max="100" [(ngModel)]="settings.defaults.defaultGstRate" /></label>
          </article>

          <article class="settings-card preview-card">
            <h2>Policy Preview</h2>
            <p>New services default to {{ settings.defaults.defaultStatus }} with {{ settings.pricingDuration.defaultDurationMinutes }} minute duration and {{ settings.defaults.defaultGstRate }}% tax.</p>
            <p>Online services are {{ settings.onlineBooking.showServicesOnline ? 'visible' : 'hidden' }} and inactive services are {{ settings.onlineBooking.hideInactiveServices ? 'hidden' : 'allowed' }}.</p>
            <p>Recipe policy is {{ settings.recipeInventory.requireRecipeForService ? 'required' : 'optional' }} and high wastage warning is {{ settings.recipeInventory.warnHighWastage ? 'enabled' : 'disabled' }}.</p>
            <p>Commission uses {{ commissionBasisLabel }} basis and staff assignment is {{ settings.staffAssignment.staffAssignmentRequired ? 'required' : 'optional' }}.</p>
          </article>
        </section>
      </main>
    </section>
  `,
  styles: [`
    :host { display: block; }
    .service-settings-page {
      --ink: #0f2238;
      --muted: #5f6f7e;
      --line: #d7e5df;
      --soft: #f4faf7;
      display: grid;
      grid-template-columns: 220px minmax(0, 1fr);
      gap: 18px;
      padding: 22px;
      background: linear-gradient(180deg, #f6fbf8, #eef5f2);
      min-height: calc(100vh - 72px);
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
      padding: 18px;
      min-width: 0;
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
      .service-settings-page {
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
export class ServiceSettingsComponent implements OnInit {
  readonly message = signal('');
  readonly error = signal('');
  readonly saving = signal(false);

  settings: ServiceSettingsState = cloneSettings(DEFAULT_SETTINGS);
  audit: ServiceSettingsAudit = { ...DEFAULT_AUDIT };

  constructor(private readonly api: ApiService) {}

  get commissionBasisLabel(): string {
    const labels: Record<string, string> = {
      servicePrice: 'service price',
      netOfDiscount: 'net of discount',
      netOfTax: 'net of tax'
    };
    return labels[this.settings.commission.commissionBasis] || 'service price';
  }

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.error.set('');
    this.message.set('');
    this.api.list<{ settings?: ApiRecord; audit?: ServiceSettingsAudit }>('settings/services').subscribe({
      next: (response) => {
        this.settings = this.normalizeSettings(response.settings || {});
        this.audit = this.normalizeAudit(response.audit);
      },
      error: () => {
        this.settings = cloneSettings(DEFAULT_SETTINGS);
        this.audit = { ...DEFAULT_AUDIT };
        this.error.set('Unable to load services settings');
      }
    });
  }

  save(): void {
    this.saving.set(true);
    this.error.set('');
    this.message.set('');
    const settings = this.normalizeSettings(this.settings);
    this.api.put<{ settings?: ApiRecord; audit?: ServiceSettingsAudit }>('settings/services', { settings }).subscribe({
      next: (response) => {
        this.settings = this.normalizeSettings(response.settings || settings);
        this.audit = this.normalizeAudit(response.audit);
        this.message.set('Services settings saved.');
        this.saving.set(false);
        window.setTimeout(() => this.message.set(''), 2500);
      },
      error: () => {
        this.error.set('Unable to save services settings');
        this.saving.set(false);
      }
    });
  }

  private normalizeSettings(input: Partial<ServiceSettingsState> | ApiRecord): ServiceSettingsState {
    const record = input as Partial<ServiceSettingsState>;
    const defaults = cloneSettings(DEFAULT_SETTINGS);
    const serviceCatalog = { ...defaults.serviceCatalog, ...(record.serviceCatalog || {}) };
    const pricingDuration = { ...defaults.pricingDuration, ...(record.pricingDuration || {}) };
    const staffAssignment = { ...defaults.staffAssignment, ...(record.staffAssignment || {}) };
    const onlineBooking = { ...defaults.onlineBooking, ...(record.onlineBooking || {}) };
    const recipeInventory = { ...defaults.recipeInventory, ...(record.recipeInventory || {}) };
    const commission = { ...defaults.commission, ...(record.commission || {}) };
    const qualityControl = { ...defaults.qualityControl, ...(record.qualityControl || {}) };
    const fallbackDefaults = { ...defaults.defaults, ...(record.defaults || {}) };
    return {
      serviceCatalog: {
        serviceGroupsEnabled: boolValue(serviceCatalog.serviceGroupsEnabled, defaults.serviceCatalog.serviceGroupsEnabled),
        serviceAddonsEnabled: boolValue(serviceCatalog.serviceAddonsEnabled, defaults.serviceCatalog.serviceAddonsEnabled),
        packagesEnabled: boolValue(serviceCatalog.packagesEnabled, defaults.serviceCatalog.packagesEnabled),
        membershipServicesEnabled: boolValue(serviceCatalog.membershipServicesEnabled, defaults.serviceCatalog.membershipServicesEnabled)
      },
      pricingDuration: {
        defaultDurationMinutes: numberValue(pricingDuration.defaultDurationMinutes, defaults.pricingDuration.defaultDurationMinutes),
        allowCustomDuration: boolValue(pricingDuration.allowCustomDuration, defaults.pricingDuration.allowCustomDuration),
        allowPriceOverride: boolValue(pricingDuration.allowPriceOverride, defaults.pricingDuration.allowPriceOverride),
        taxInclusiveDefault: boolValue(pricingDuration.taxInclusiveDefault, defaults.pricingDuration.taxInclusiveDefault)
      },
      staffAssignment: {
        staffAssignmentRequired: boolValue(staffAssignment.staffAssignmentRequired, defaults.staffAssignment.staffAssignmentRequired),
        allowMultiStaff: boolValue(staffAssignment.allowMultiStaff, defaults.staffAssignment.allowMultiStaff),
        skillBasedAssignment: boolValue(staffAssignment.skillBasedAssignment, defaults.staffAssignment.skillBasedAssignment),
        roomResourceRequired: boolValue(staffAssignment.roomResourceRequired, defaults.staffAssignment.roomResourceRequired)
      },
      onlineBooking: {
        showServicesOnline: boolValue(onlineBooking.showServicesOnline, defaults.onlineBooking.showServicesOnline),
        hideInactiveServices: boolValue(onlineBooking.hideInactiveServices, defaults.onlineBooking.hideInactiveServices),
        allowPackageServiceBooking: boolValue(onlineBooking.allowPackageServiceBooking, defaults.onlineBooking.allowPackageServiceBooking),
        requireDepositForOnlineServices: boolValue(onlineBooking.requireDepositForOnlineServices, defaults.onlineBooking.requireDepositForOnlineServices)
      },
      recipeInventory: {
        requireRecipeForService: boolValue(recipeInventory.requireRecipeForService, defaults.recipeInventory.requireRecipeForService),
        blockConsumeWithoutRecipe: boolValue(recipeInventory.blockConsumeWithoutRecipe, defaults.recipeInventory.blockConsumeWithoutRecipe),
        warnHighWastage: boolValue(recipeInventory.warnHighWastage, defaults.recipeInventory.warnHighWastage)
      },
      commission: {
        staffCommissionEnabled: boolValue(commission.staffCommissionEnabled, defaults.commission.staffCommissionEnabled),
        commissionBasis: ['servicePrice', 'netOfDiscount', 'netOfTax'].includes(String(commission.commissionBasis)) ? String(commission.commissionBasis) : defaults.commission.commissionBasis,
        incentiveEligible: boolValue(commission.incentiveEligible, defaults.commission.incentiveEligible)
      },
      qualityControl: {
        requireServiceNotes: boolValue(qualityControl.requireServiceNotes, defaults.qualityControl.requireServiceNotes),
        requireBeforeAfterPhoto: boolValue(qualityControl.requireBeforeAfterPhoto, defaults.qualityControl.requireBeforeAfterPhoto),
        consentRequiredForRiskServices: boolValue(qualityControl.consentRequiredForRiskServices, defaults.qualityControl.consentRequiredForRiskServices)
      },
      defaults: {
        defaultStatus: ['active', 'inactive'].includes(String(fallbackDefaults.defaultStatus)) ? String(fallbackDefaults.defaultStatus) : defaults.defaults.defaultStatus,
        defaultGstRate: numberValue(fallbackDefaults.defaultGstRate, defaults.defaults.defaultGstRate)
      }
    };
  }

  private normalizeAudit(input?: Partial<ServiceSettingsAudit>): ServiceSettingsAudit {
    return {
      lastChangedBy: stringValue(input?.lastChangedBy, DEFAULT_AUDIT.lastChangedBy),
      lastChangedAt: stringValue(input?.lastChangedAt, DEFAULT_AUDIT.lastChangedAt)
    };
  }
}
