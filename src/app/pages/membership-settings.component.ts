import { CommonModule } from '@angular/common';
import { Component, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ApiRecord, ApiService } from '../core/api.service';
import { AuraDatePipe } from '../shared/pipes/aura-date.pipe';

type MembershipSettingsState = {
  membershipCatalog: {
    membershipSalesEnabled: boolean;
    visibleInPos: boolean;
    visibleOnline: boolean;
    freeMembershipEnabled: boolean;
    paidMembershipEnabled: boolean;
  };
  creditsBenefits: {
    serviceCreditsEnabled: boolean;
    walletCreditsEnabled: boolean;
    rewardPointsEnabled: boolean;
    discountBenefitsEnabled: boolean;
    allowBenefitStacking: boolean;
  };
  renewalExpiry: {
    autoRenewEnabled: boolean;
    expiryDaysEnabled: boolean;
    defaultValidityDays: number;
    renewalReminderDays: number;
    expiredBenefitAction: string;
  };
  paymentBilling: {
    allowDueOnMembershipSale: boolean;
    membershipTaxApplicable: boolean;
    taxInclusiveMembershipPrice: boolean;
    invoiceMembershipSnapshot: boolean;
  };
  redemptionRules: {
    blockRedemptionWhenExpired: boolean;
    requireStaffConfirmation: boolean;
    allowPartialCredits: boolean;
    allowFamilySharing: boolean;
  };
  notificationsRisk: {
    renewalReminder: boolean;
    lowCreditReminder: boolean;
    ownerAlertForHighBalance: boolean;
    highBalanceThreshold: number;
  };
  defaults: {
    defaultStatus: string;
    defaultMembershipType: string;
  };
};

type MembershipSettingsAudit = {
  lastChangedBy: string;
  lastChangedAt: string;
};

const DEFAULT_SETTINGS: MembershipSettingsState = {
  membershipCatalog: {
    membershipSalesEnabled: true,
    visibleInPos: true,
    visibleOnline: true,
    freeMembershipEnabled: true,
    paidMembershipEnabled: true
  },
  creditsBenefits: {
    serviceCreditsEnabled: true,
    walletCreditsEnabled: true,
    rewardPointsEnabled: true,
    discountBenefitsEnabled: true,
    allowBenefitStacking: false
  },
  renewalExpiry: {
    autoRenewEnabled: false,
    expiryDaysEnabled: true,
    defaultValidityDays: 365,
    renewalReminderDays: 30,
    expiredBenefitAction: 'warn'
  },
  paymentBilling: {
    allowDueOnMembershipSale: true,
    membershipTaxApplicable: true,
    taxInclusiveMembershipPrice: false,
    invoiceMembershipSnapshot: true
  },
  redemptionRules: {
    blockRedemptionWhenExpired: true,
    requireStaffConfirmation: true,
    allowPartialCredits: true,
    allowFamilySharing: false
  },
  notificationsRisk: {
    renewalReminder: true,
    lowCreditReminder: true,
    ownerAlertForHighBalance: true,
    highBalanceThreshold: 10000
  },
  defaults: {
    defaultStatus: 'active',
    defaultMembershipType: 'paid'
  }
};

const DEFAULT_AUDIT: MembershipSettingsAudit = {
  lastChangedBy: 'Not saved yet',
  lastChangedAt: ''
};

function cloneSettings(settings: MembershipSettingsState): MembershipSettingsState {
  return JSON.parse(JSON.stringify(settings)) as MembershipSettingsState;
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
  selector: 'app-membership-settings',
  standalone: true,
  imports: [AuraDatePipe, CommonModule, FormsModule, RouterLink],
  template: `
    <section class="membership-settings-page inner-page-shell">
      <aside class="settings-nav" aria-label="Settings sections">
        <a routerLink="/settings/general">General Settings</a>
        <a routerLink="/settings/products">Products Settings</a>
        <a routerLink="/settings/supplier">Supplier Settings</a>
        <a routerLink="/settings/inventory">Inventory Settings</a>
        <a routerLink="/settings/services">Services Settings</a>
        <a routerLink="/settings/packages">Packages Settings</a>
        <a class="active" routerLink="/settings/membership">Membership Settings</a>
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
            <span class="eyebrow">Setup / Membership</span>
            <h1>Membership Settings Control</h1>
            <p>Control membership sale visibility, benefits, expiry, renewal, payment behavior, redemption rules and alerts.</p>
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
        <p class="phase-note">Next phase will connect POS membership sale, membership redemption, renewal reminders, wallet/reward benefits and online profile visibility to this saved policy.</p>

        <section class="audit-strip">
          <strong>Audit info</strong>
          <span>Last changed by: {{ audit.lastChangedBy || 'Not saved yet' }}</span>
          <span>Last changed time: {{ audit.lastChangedAt ? (audit.lastChangedAt | auraDate:'date') : 'Not saved yet' }}</span>
        </section>

        <section class="settings-grid inner-form-grid">
          <article class="settings-card inner-page-card">
            <h2>Membership Catalog</h2>
            <label class="switch-row"><span><strong>Membership sales enabled</strong><small>Allow membership creation and sale workflow.</small></span><input type="checkbox" [(ngModel)]="settings.membershipCatalog.membershipSalesEnabled" /><i></i></label>
            <label class="switch-row"><span><strong>Visible in POS</strong><small>Show memberships in POS sale screens.</small></span><input type="checkbox" [(ngModel)]="settings.membershipCatalog.visibleInPos" /><i></i></label>
            <label class="switch-row"><span><strong>Visible online</strong><small>Show memberships on booking/profile surfaces.</small></span><input type="checkbox" [(ngModel)]="settings.membershipCatalog.visibleOnline" /><i></i></label>
            <label class="switch-row"><span><strong>Free membership enabled</strong><small>Allow free membership plans.</small></span><input type="checkbox" [(ngModel)]="settings.membershipCatalog.freeMembershipEnabled" /><i></i></label>
            <label class="switch-row"><span><strong>Paid membership enabled</strong><small>Allow paid membership plans.</small></span><input type="checkbox" [(ngModel)]="settings.membershipCatalog.paidMembershipEnabled" /><i></i></label>
          </article>

          <article class="settings-card inner-page-card">
            <h2>Credits & Benefits</h2>
            <label class="switch-row"><span><strong>Service credits enabled</strong><small>Allow service credit benefits.</small></span><input type="checkbox" [(ngModel)]="settings.creditsBenefits.serviceCreditsEnabled" /><i></i></label>
            <label class="switch-row"><span><strong>Wallet credits enabled</strong><small>Allow wallet balance benefits.</small></span><input type="checkbox" [(ngModel)]="settings.creditsBenefits.walletCreditsEnabled" /><i></i></label>
            <label class="switch-row"><span><strong>Reward points enabled</strong><small>Allow loyalty points benefits.</small></span><input type="checkbox" [(ngModel)]="settings.creditsBenefits.rewardPointsEnabled" /><i></i></label>
            <label class="switch-row"><span><strong>Discount benefits enabled</strong><small>Allow fixed or percent discount benefits.</small></span><input type="checkbox" [(ngModel)]="settings.creditsBenefits.discountBenefitsEnabled" /><i></i></label>
            <label class="switch-row"><span><strong>Allow benefit stacking</strong><small>Allow multiple membership benefits on one bill.</small></span><input type="checkbox" [(ngModel)]="settings.creditsBenefits.allowBenefitStacking" /><i></i></label>
          </article>

          <article class="settings-card inner-page-card">
            <h2>Renewal & Expiry</h2>
            <label class="switch-row"><span><strong>Auto renew enabled</strong><small>Prepare memberships for auto-renewal policy.</small></span><input type="checkbox" [(ngModel)]="settings.renewalExpiry.autoRenewEnabled" /><i></i></label>
            <label class="switch-row"><span><strong>Expiry days enabled</strong><small>Use expiry dates on membership benefits.</small></span><input type="checkbox" [(ngModel)]="settings.renewalExpiry.expiryDaysEnabled" /><i></i></label>
            <label class="field-row"><span>Default validity days</span><input type="number" min="0" max="3650" [(ngModel)]="settings.renewalExpiry.defaultValidityDays" /></label>
            <label class="field-row"><span>Renewal reminder days</span><input type="number" min="0" max="365" [(ngModel)]="settings.renewalExpiry.renewalReminderDays" /></label>
            <label class="field-row"><span>Expired benefit action</span><select [(ngModel)]="settings.renewalExpiry.expiredBenefitAction"><option value="allow">Allow</option><option value="warn">Warn</option><option value="block">Block</option></select></label>
          </article>

          <article class="settings-card inner-page-card">
            <h2>Payment & Billing</h2>
            <label class="switch-row"><span><strong>Allow due on membership sale</strong><small>Permit unpaid/due balance on membership sale.</small></span><input type="checkbox" [(ngModel)]="settings.paymentBilling.allowDueOnMembershipSale" /><i></i></label>
            <label class="switch-row"><span><strong>Membership tax applicable</strong><small>Apply tax setting to membership sales.</small></span><input type="checkbox" [(ngModel)]="settings.paymentBilling.membershipTaxApplicable" /><i></i></label>
            <label class="switch-row"><span><strong>Tax inclusive membership price</strong><small>Treat membership price as tax-inclusive by default.</small></span><input type="checkbox" [(ngModel)]="settings.paymentBilling.taxInclusiveMembershipPrice" /><i></i></label>
            <label class="switch-row"><span><strong>Invoice membership snapshot</strong><small>Store membership benefit snapshot with invoice.</small></span><input type="checkbox" [(ngModel)]="settings.paymentBilling.invoiceMembershipSnapshot" /><i></i></label>
          </article>

          <article class="settings-card inner-page-card">
            <h2>Redemption Rules</h2>
            <label class="switch-row"><span><strong>Block redemption when expired</strong><small>Prevent expired membership benefits from being used.</small></span><input type="checkbox" [(ngModel)]="settings.redemptionRules.blockRedemptionWhenExpired" /><i></i></label>
            <label class="switch-row"><span><strong>Require staff confirmation</strong><small>Ask staff to confirm membership redemption at billing.</small></span><input type="checkbox" [(ngModel)]="settings.redemptionRules.requireStaffConfirmation" /><i></i></label>
            <label class="switch-row"><span><strong>Allow partial credits</strong><small>Permit using part of available membership credits.</small></span><input type="checkbox" [(ngModel)]="settings.redemptionRules.allowPartialCredits" /><i></i></label>
            <label class="switch-row"><span><strong>Allow family sharing</strong><small>Allow approved family/client group sharing.</small></span><input type="checkbox" [(ngModel)]="settings.redemptionRules.allowFamilySharing" /><i></i></label>
          </article>

          <article class="settings-card inner-page-card">
            <h2>Notifications & Risk</h2>
            <label class="switch-row"><span><strong>Renewal reminder</strong><small>Send reminder before membership renewal/expiry.</small></span><input type="checkbox" [(ngModel)]="settings.notificationsRisk.renewalReminder" /><i></i></label>
            <label class="switch-row"><span><strong>Low credit reminder</strong><small>Notify clients when membership credits are low.</small></span><input type="checkbox" [(ngModel)]="settings.notificationsRisk.lowCreditReminder" /><i></i></label>
            <label class="switch-row"><span><strong>Owner alert for high balance</strong><small>Notify owner when membership liability is high.</small></span><input type="checkbox" [(ngModel)]="settings.notificationsRisk.ownerAlertForHighBalance" /><i></i></label>
            <label class="field-row"><span>High balance threshold</span><input type="number" min="0" [(ngModel)]="settings.notificationsRisk.highBalanceThreshold" /></label>
          </article>

          <article class="settings-card inner-page-card">
            <h2>Defaults</h2>
            <label class="field-row"><span>Default membership status</span><select [(ngModel)]="settings.defaults.defaultStatus"><option value="active">Active</option><option value="inactive">Inactive</option></select></label>
            <label class="field-row"><span>Default membership type</span><select [(ngModel)]="settings.defaults.defaultMembershipType"><option value="free">Free</option><option value="paid">Paid</option><option value="packageLinked">Package Linked</option></select></label>
          </article>

          <article class="settings-card preview-card">
            <h2>Policy Preview</h2>
            <p>Membership sales are {{ settings.membershipCatalog.membershipSalesEnabled ? 'enabled' : 'disabled' }} and {{ settings.membershipCatalog.visibleInPos ? 'visible in POS' : 'hidden from POS' }}.</p>
            <p>Default validity is {{ settings.renewalExpiry.expiryDaysEnabled ? settings.renewalExpiry.defaultValidityDays + ' days' : 'not applied' }} with reminder {{ settings.renewalExpiry.renewalReminderDays }} days before expiry.</p>
            <p>Expired benefits will {{ settings.renewalExpiry.expiredBenefitAction }} and redemption confirmation is {{ settings.redemptionRules.requireStaffConfirmation ? 'required' : 'optional' }}.</p>
            <p>Benefit stacking is {{ settings.creditsBenefits.allowBenefitStacking ? 'allowed' : 'blocked' }} and default plan type is {{ settings.defaults.defaultMembershipType }}.</p>
          </article>
        </section>
      </main>
    </section>
  `,
  styles: [`
    :host { display: block; }
    .membership-settings-page {
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
      .membership-settings-page {
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
export class MembershipSettingsComponent implements OnInit {
  readonly message = signal('');
  readonly error = signal('');
  readonly saving = signal(false);

  settings: MembershipSettingsState = cloneSettings(DEFAULT_SETTINGS);
  audit: MembershipSettingsAudit = { ...DEFAULT_AUDIT };

  constructor(private readonly api: ApiService) {}

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.error.set('');
    this.message.set('');
    this.api.list<{ settings?: ApiRecord; audit?: MembershipSettingsAudit }>('settings/membership').subscribe({
      next: (response) => {
        this.settings = this.normalizeSettings(response.settings || {});
        this.audit = this.normalizeAudit(response.audit);
      },
      error: () => {
        this.settings = cloneSettings(DEFAULT_SETTINGS);
        this.audit = { ...DEFAULT_AUDIT };
        this.error.set('Unable to load membership settings');
      }
    });
  }

  save(): void {
    this.saving.set(true);
    this.error.set('');
    this.message.set('');
    const settings = this.normalizeSettings(this.settings);
    this.api.put<{ settings?: ApiRecord; audit?: MembershipSettingsAudit }>('settings/membership', { settings }).subscribe({
      next: (response) => {
        this.settings = this.normalizeSettings(response.settings || settings);
        this.audit = this.normalizeAudit(response.audit);
        this.message.set('Membership settings saved.');
        this.saving.set(false);
        window.setTimeout(() => this.message.set(''), 2500);
      },
      error: () => {
        this.error.set('Unable to save membership settings');
        this.saving.set(false);
      }
    });
  }

  private normalizeSettings(input: Partial<MembershipSettingsState> | ApiRecord): MembershipSettingsState {
    const record = input as Partial<MembershipSettingsState>;
    const defaults = cloneSettings(DEFAULT_SETTINGS);
    const membershipCatalog = (record.membershipCatalog || {}) as Partial<MembershipSettingsState['membershipCatalog']>;
    const creditsBenefits = (record.creditsBenefits || {}) as Partial<MembershipSettingsState['creditsBenefits']>;
    const renewalExpiry = (record.renewalExpiry || {}) as Partial<MembershipSettingsState['renewalExpiry']>;
    const paymentBilling = (record.paymentBilling || {}) as Partial<MembershipSettingsState['paymentBilling']>;
    const redemptionRules = (record.redemptionRules || {}) as Partial<MembershipSettingsState['redemptionRules']>;
    const notificationsRisk = (record.notificationsRisk || {}) as Partial<MembershipSettingsState['notificationsRisk']>;
    const fallbackDefaults = (record.defaults || {}) as Partial<MembershipSettingsState['defaults']>;
    return {
      membershipCatalog: {
        membershipSalesEnabled: boolValue(membershipCatalog.membershipSalesEnabled, defaults.membershipCatalog.membershipSalesEnabled),
        visibleInPos: boolValue(membershipCatalog.visibleInPos, defaults.membershipCatalog.visibleInPos),
        visibleOnline: boolValue(membershipCatalog.visibleOnline, defaults.membershipCatalog.visibleOnline),
        freeMembershipEnabled: boolValue(membershipCatalog.freeMembershipEnabled, defaults.membershipCatalog.freeMembershipEnabled),
        paidMembershipEnabled: boolValue(membershipCatalog.paidMembershipEnabled, defaults.membershipCatalog.paidMembershipEnabled)
      },
      creditsBenefits: {
        serviceCreditsEnabled: boolValue(creditsBenefits.serviceCreditsEnabled, defaults.creditsBenefits.serviceCreditsEnabled),
        walletCreditsEnabled: boolValue(creditsBenefits.walletCreditsEnabled, defaults.creditsBenefits.walletCreditsEnabled),
        rewardPointsEnabled: boolValue(creditsBenefits.rewardPointsEnabled, defaults.creditsBenefits.rewardPointsEnabled),
        discountBenefitsEnabled: boolValue(creditsBenefits.discountBenefitsEnabled, defaults.creditsBenefits.discountBenefitsEnabled),
        allowBenefitStacking: boolValue(creditsBenefits.allowBenefitStacking, defaults.creditsBenefits.allowBenefitStacking)
      },
      renewalExpiry: {
        autoRenewEnabled: boolValue(renewalExpiry.autoRenewEnabled, defaults.renewalExpiry.autoRenewEnabled),
        expiryDaysEnabled: boolValue(renewalExpiry.expiryDaysEnabled, defaults.renewalExpiry.expiryDaysEnabled),
        defaultValidityDays: numberValue(renewalExpiry.defaultValidityDays, defaults.renewalExpiry.defaultValidityDays),
        renewalReminderDays: numberValue(renewalExpiry.renewalReminderDays, defaults.renewalExpiry.renewalReminderDays),
        expiredBenefitAction: ['allow', 'warn', 'block'].includes(String(renewalExpiry.expiredBenefitAction)) ? String(renewalExpiry.expiredBenefitAction) : defaults.renewalExpiry.expiredBenefitAction
      },
      paymentBilling: {
        allowDueOnMembershipSale: boolValue(paymentBilling.allowDueOnMembershipSale, defaults.paymentBilling.allowDueOnMembershipSale),
        membershipTaxApplicable: boolValue(paymentBilling.membershipTaxApplicable, defaults.paymentBilling.membershipTaxApplicable),
        taxInclusiveMembershipPrice: boolValue(paymentBilling.taxInclusiveMembershipPrice, defaults.paymentBilling.taxInclusiveMembershipPrice),
        invoiceMembershipSnapshot: boolValue(paymentBilling.invoiceMembershipSnapshot, defaults.paymentBilling.invoiceMembershipSnapshot)
      },
      redemptionRules: {
        blockRedemptionWhenExpired: boolValue(redemptionRules.blockRedemptionWhenExpired, defaults.redemptionRules.blockRedemptionWhenExpired),
        requireStaffConfirmation: boolValue(redemptionRules.requireStaffConfirmation, defaults.redemptionRules.requireStaffConfirmation),
        allowPartialCredits: boolValue(redemptionRules.allowPartialCredits, defaults.redemptionRules.allowPartialCredits),
        allowFamilySharing: boolValue(redemptionRules.allowFamilySharing, defaults.redemptionRules.allowFamilySharing)
      },
      notificationsRisk: {
        renewalReminder: boolValue(notificationsRisk.renewalReminder, defaults.notificationsRisk.renewalReminder),
        lowCreditReminder: boolValue(notificationsRisk.lowCreditReminder, defaults.notificationsRisk.lowCreditReminder),
        ownerAlertForHighBalance: boolValue(notificationsRisk.ownerAlertForHighBalance, defaults.notificationsRisk.ownerAlertForHighBalance),
        highBalanceThreshold: numberValue(notificationsRisk.highBalanceThreshold, defaults.notificationsRisk.highBalanceThreshold)
      },
      defaults: {
        defaultStatus: ['active', 'inactive'].includes(String(fallbackDefaults.defaultStatus)) ? String(fallbackDefaults.defaultStatus) : defaults.defaults.defaultStatus,
        defaultMembershipType: ['free', 'paid', 'packageLinked'].includes(String(fallbackDefaults.defaultMembershipType)) ? String(fallbackDefaults.defaultMembershipType) : defaults.defaults.defaultMembershipType
      }
    };
  }

  private normalizeAudit(input?: Partial<MembershipSettingsAudit>): MembershipSettingsAudit {
    return {
      lastChangedBy: stringValue(input?.lastChangedBy, DEFAULT_AUDIT.lastChangedBy),
      lastChangedAt: stringValue(input?.lastChangedAt, DEFAULT_AUDIT.lastChangedAt)
    };
  }
}
