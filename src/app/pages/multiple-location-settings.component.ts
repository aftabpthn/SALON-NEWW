import { CommonModule } from '@angular/common';
import { Component, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { Observable, catchError, throwError } from 'rxjs';
import { ApiRecord, ApiService } from '../core/api.service';

type MultipleLocationSettingsState = {
  locationControl: {
    multipleLocationEnabled: boolean;
    branchSwitcherEnabled: boolean;
    centralOwnerDashboard: boolean;
    branchScopedLogin: boolean;
  };
  branchAccess: {
    visibilityMode: string;
    defaultBranchMode: string;
    allowCrossBranchReports: boolean;
    allowCrossBranchSearch: boolean;
  };
  dataSharing: {
    shareClientsAcrossBranches: boolean;
    shareMembershipsAcrossBranches: boolean;
    sharePackagesAcrossBranches: boolean;
    shareWalletAcrossBranches: boolean;
    shareInventoryAcrossBranches: boolean;
    shareStaffAcrossBranches: boolean;
  };
  bookingTransfer: {
    crossBranchBooking: boolean;
    bookingTransferAllowed: boolean;
    clientTransferAllowed: boolean;
    packageRedemptionAnyBranch: boolean;
    membershipRedemptionAnyBranch: boolean;
    ownerApprovalForTransfer: boolean;
    conflictHandling: string;
  };
  settlement: {
    interBranchSettlementRequired: boolean;
    settlementMode: string;
    revenueCreditBranch: string;
    inventoryCostBranch: string;
  };
  notifications: {
    notifyOwnerOnBranchChange: boolean;
    notifyStaffOnTransfer: boolean;
    notifyClientOnBranchTransfer: boolean;
  };
};

const DEFAULT_SETTINGS: MultipleLocationSettingsState = {
  locationControl: {
    multipleLocationEnabled: true,
    branchSwitcherEnabled: true,
    centralOwnerDashboard: true,
    branchScopedLogin: true
  },
  branchAccess: {
    visibilityMode: 'assigned',
    defaultBranchMode: 'lastSelected',
    allowCrossBranchReports: true,
    allowCrossBranchSearch: true
  },
  dataSharing: {
    shareClientsAcrossBranches: true,
    shareMembershipsAcrossBranches: true,
    sharePackagesAcrossBranches: true,
    shareWalletAcrossBranches: false,
    shareInventoryAcrossBranches: false,
    shareStaffAcrossBranches: false
  },
  bookingTransfer: {
    crossBranchBooking: true,
    bookingTransferAllowed: true,
    clientTransferAllowed: true,
    packageRedemptionAnyBranch: true,
    membershipRedemptionAnyBranch: true,
    ownerApprovalForTransfer: true,
    conflictHandling: 'approval'
  },
  settlement: {
    interBranchSettlementRequired: true,
    settlementMode: 'monthly',
    revenueCreditBranch: 'serviceBranch',
    inventoryCostBranch: 'consumingBranch'
  },
  notifications: {
    notifyOwnerOnBranchChange: true,
    notifyStaffOnTransfer: true,
    notifyClientOnBranchTransfer: true
  }
};

const VISIBILITY_MODES = [
  { value: 'assigned', label: 'Assigned branches only' },
  { value: 'region', label: 'Region branches' },
  { value: 'all', label: 'All branches' }
];
const DEFAULT_BRANCH_MODES = [
  { value: 'lastSelected', label: 'Last selected branch' },
  { value: 'homeBranch', label: 'Home branch' },
  { value: 'askEveryLogin', label: 'Ask every login' }
];
const CONFLICT_MODES = [
  { value: 'warn', label: 'Warn' },
  { value: 'block', label: 'Block' },
  { value: 'approval', label: 'Owner approval' }
];

function cloneSettings(settings: MultipleLocationSettingsState): MultipleLocationSettingsState {
  return JSON.parse(JSON.stringify(settings)) as MultipleLocationSettingsState;
}

function boolValue(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function oneOf(value: unknown, allowed: string[], fallback: string): string {
  return typeof value === 'string' && allowed.includes(value) ? value : fallback;
}

@Component({
  selector: 'app-multiple-location-settings',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  template: `
    <section class="multi-location-settings-page inner-page-shell">
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
        <a class="active" routerLink="/settings/multiple-location">Multiple Location</a>
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
            <span class="eyebrow">Setup / Multiple Location</span>
            <h1>Multiple Location Settings Control</h1>
            <p>Manage branch switcher, cross-branch access, shared clients, package redemption, transfers and inter-branch settlement policy.</p>
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
        <p class="phase-note">Next phase will connect branch switcher, booking transfer, reports, POS package redemption and settlement flows to these saved rules.</p>

        <section class="settings-grid inner-form-grid">
          <article class="settings-card inner-page-card">
            <h2>Location Control</h2>
            <label class="switch-row">
              <span><strong>Multiple Location Enabled</strong><small>Enable multi-branch controls for this tenant.</small></span>
              <input type="checkbox" [(ngModel)]="settings.locationControl.multipleLocationEnabled" />
              <i aria-hidden="true"></i>
            </label>
            <label class="switch-row">
              <span><strong>Branch Switcher Enabled</strong><small>Allow users to change active branch from header.</small></span>
              <input type="checkbox" [(ngModel)]="settings.locationControl.branchSwitcherEnabled" />
              <i aria-hidden="true"></i>
            </label>
            <label class="switch-row">
              <span><strong>Central Owner Dashboard</strong><small>Owner can view combined branch policy surface.</small></span>
              <input type="checkbox" [(ngModel)]="settings.locationControl.centralOwnerDashboard" />
              <i aria-hidden="true"></i>
            </label>
            <label class="switch-row">
              <span><strong>Branch Scoped Login</strong><small>Keep staff scoped to allowed branches.</small></span>
              <input type="checkbox" [(ngModel)]="settings.locationControl.branchScopedLogin" />
              <i aria-hidden="true"></i>
            </label>
          </article>

          <article class="settings-card inner-page-card">
            <h2>Branch Access</h2>
            <label class="field-row">
              <span>Branch Visibility</span>
              <select [(ngModel)]="settings.branchAccess.visibilityMode">
                <option *ngFor="let mode of visibilityModes" [value]="mode.value">{{ mode.label }}</option>
              </select>
            </label>
            <label class="field-row">
              <span>Default Branch</span>
              <select [(ngModel)]="settings.branchAccess.defaultBranchMode">
                <option *ngFor="let mode of defaultBranchModes" [value]="mode.value">{{ mode.label }}</option>
              </select>
            </label>
            <label class="switch-row compact">
              <span><strong>Cross-branch Reports</strong><small>Allow report totals across branches.</small></span>
              <input type="checkbox" [(ngModel)]="settings.branchAccess.allowCrossBranchReports" />
              <i aria-hidden="true"></i>
            </label>
            <label class="switch-row compact">
              <span><strong>Cross-branch Search</strong><small>Allow searching clients, bills and packages across branches.</small></span>
              <input type="checkbox" [(ngModel)]="settings.branchAccess.allowCrossBranchSearch" />
              <i aria-hidden="true"></i>
            </label>
          </article>

          <article class="settings-card inner-page-card">
            <h2>Data Sharing</h2>
            <label class="switch-row">
              <span><strong>Share Clients Across Branches</strong><small>Same client profile can be used in allowed branches.</small></span>
              <input type="checkbox" [(ngModel)]="settings.dataSharing.shareClientsAcrossBranches" />
              <i aria-hidden="true"></i>
            </label>
            <label class="switch-row">
              <span><strong>Share Memberships Across Branches</strong><small>Memberships can be visible across allowed branches.</small></span>
              <input type="checkbox" [(ngModel)]="settings.dataSharing.shareMembershipsAcrossBranches" />
              <i aria-hidden="true"></i>
            </label>
            <label class="switch-row">
              <span><strong>Share Packages Across Branches</strong><small>Package credits can be visible across allowed branches.</small></span>
              <input type="checkbox" [(ngModel)]="settings.dataSharing.sharePackagesAcrossBranches" />
              <i aria-hidden="true"></i>
            </label>
            <label class="switch-row">
              <span><strong>Share Wallet Across Branches</strong><small>Wallet balance can be used in allowed branches.</small></span>
              <input type="checkbox" [(ngModel)]="settings.dataSharing.shareWalletAcrossBranches" />
              <i aria-hidden="true"></i>
            </label>
            <label class="switch-row">
              <span><strong>Share Inventory Across Branches</strong><small>Inventory visibility remains policy-only in this phase.</small></span>
              <input type="checkbox" [(ngModel)]="settings.dataSharing.shareInventoryAcrossBranches" />
              <i aria-hidden="true"></i>
            </label>
            <label class="switch-row">
              <span><strong>Share Staff Across Branches</strong><small>Staff can be assigned across allowed branches.</small></span>
              <input type="checkbox" [(ngModel)]="settings.dataSharing.shareStaffAcrossBranches" />
              <i aria-hidden="true"></i>
            </label>
          </article>

          <article class="settings-card inner-page-card">
            <h2>Booking & Transfer</h2>
            <label class="switch-row">
              <span><strong>Cross-branch Booking</strong><small>Allow bookings for a different branch.</small></span>
              <input type="checkbox" [(ngModel)]="settings.bookingTransfer.crossBranchBooking" />
              <i aria-hidden="true"></i>
            </label>
            <label class="switch-row">
              <span><strong>Booking Transfer Allowed</strong><small>Move appointment from one branch to another.</small></span>
              <input type="checkbox" [(ngModel)]="settings.bookingTransfer.bookingTransferAllowed" />
              <i aria-hidden="true"></i>
            </label>
            <label class="switch-row">
              <span><strong>Client Transfer Allowed</strong><small>Move client ownership between branches.</small></span>
              <input type="checkbox" [(ngModel)]="settings.bookingTransfer.clientTransferAllowed" />
              <i aria-hidden="true"></i>
            </label>
            <label class="switch-row">
              <span><strong>Package Redemption Any Branch</strong><small>Allow package services at allowed branches.</small></span>
              <input type="checkbox" [(ngModel)]="settings.bookingTransfer.packageRedemptionAnyBranch" />
              <i aria-hidden="true"></i>
            </label>
            <label class="switch-row">
              <span><strong>Membership Redemption Any Branch</strong><small>Allow membership benefits at allowed branches.</small></span>
              <input type="checkbox" [(ngModel)]="settings.bookingTransfer.membershipRedemptionAnyBranch" />
              <i aria-hidden="true"></i>
            </label>
            <label class="switch-row">
              <span><strong>Owner Approval for Transfer</strong><small>Require owner approval for branch transfer cases.</small></span>
              <input type="checkbox" [(ngModel)]="settings.bookingTransfer.ownerApprovalForTransfer" />
              <i aria-hidden="true"></i>
            </label>
            <label class="field-row">
              <span>Conflict Handling</span>
              <select [(ngModel)]="settings.bookingTransfer.conflictHandling">
                <option *ngFor="let mode of conflictModes" [value]="mode.value">{{ mode.label }}</option>
              </select>
            </label>
          </article>

          <article class="settings-card inner-page-card">
            <h2>Inter-branch Settlement</h2>
            <label class="switch-row">
              <span><strong>Settlement Required</strong><small>Create settlement policy when service/sale branches differ.</small></span>
              <input type="checkbox" [(ngModel)]="settings.settlement.interBranchSettlementRequired" />
              <i aria-hidden="true"></i>
            </label>
            <label class="field-row">
              <span>Settlement Mode</span>
              <select [(ngModel)]="settings.settlement.settlementMode">
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
                <option value="monthly">Monthly</option>
              </select>
            </label>
            <label class="field-row">
              <span>Revenue Credit Branch</span>
              <select [(ngModel)]="settings.settlement.revenueCreditBranch">
                <option value="saleBranch">Sale Branch</option>
                <option value="serviceBranch">Service Branch</option>
              </select>
            </label>
            <label class="field-row">
              <span>Inventory Cost Branch</span>
              <select [(ngModel)]="settings.settlement.inventoryCostBranch">
                <option value="stockBranch">Stock Branch</option>
                <option value="consumingBranch">Consuming Branch</option>
              </select>
            </label>
          </article>

          <article class="settings-card inner-page-card">
            <h2>Notifications</h2>
            <label class="switch-row">
              <span><strong>Notify Owner on Branch Change</strong><small>Alert owner when branch context changes.</small></span>
              <input type="checkbox" [(ngModel)]="settings.notifications.notifyOwnerOnBranchChange" />
              <i aria-hidden="true"></i>
            </label>
            <label class="switch-row">
              <span><strong>Notify Staff on Transfer</strong><small>Alert staff when booking/client moves branch.</small></span>
              <input type="checkbox" [(ngModel)]="settings.notifications.notifyStaffOnTransfer" />
              <i aria-hidden="true"></i>
            </label>
            <label class="switch-row">
              <span><strong>Notify Client on Branch Transfer</strong><small>Inform client when branch is changed.</small></span>
              <input type="checkbox" [(ngModel)]="settings.notifications.notifyClientOnBranchTransfer" />
              <i aria-hidden="true"></i>
            </label>
          </article>

          <article class="settings-card preview-card">
            <h2>Policy Preview</h2>
            <div class="preview-list">
              <p><strong>Branch access:</strong> {{ settings.branchAccess.visibilityMode }} visibility with {{ settings.branchAccess.defaultBranchMode }} default.</p>
              <p><strong>Shared data:</strong> {{ sharedDataSummary() }}.</p>
              <p><strong>Booking:</strong> {{ settings.bookingTransfer.crossBranchBooking ? 'Cross-branch booking ON' : 'Cross-branch booking OFF' }}; conflict mode {{ settings.bookingTransfer.conflictHandling }}.</p>
              <p><strong>Redemption:</strong> Package {{ settings.bookingTransfer.packageRedemptionAnyBranch ? 'any branch' : 'home branch' }}, membership {{ settings.bookingTransfer.membershipRedemptionAnyBranch ? 'any branch' : 'home branch' }}.</p>
              <p><strong>Settlement:</strong> {{ settings.settlement.interBranchSettlementRequired ? settings.settlement.settlementMode : 'not required' }}.</p>
              <p><strong>Notifications:</strong> {{ notificationSummary() }}.</p>
            </div>
          </article>
        </section>
      </main>
    </section>
  `,
  styles: [`
    :host { display: block; color: #0f2235; }
    .multi-location-settings-page {
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
    .ghost-button { min-height: 46px; border-radius: 10px; padding: 0 18px; }
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
    .switch-row.compact { min-height: 62px; }
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
    select {
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
      .multi-location-settings-page { grid-template-columns: 1fr; }
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
export class MultipleLocationSettingsComponent implements OnInit {
  readonly visibilityModes = VISIBILITY_MODES;
  readonly defaultBranchModes = DEFAULT_BRANCH_MODES;
  readonly conflictModes = CONFLICT_MODES;

  saving = signal(false);
  message = signal('');
  error = signal('');
  settings = cloneSettings(DEFAULT_SETTINGS);

  constructor(private readonly api: ApiService) {}

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.error.set('');
    this.message.set('');
    this.loadSettings().subscribe({
      next: (result) => {
        this.settings = this.normalize(result.settings);
      },
      error: (err) => {
        this.error.set(err?.error?.message || err?.message || 'Unable to load multiple location settings');
        this.settings = cloneSettings(DEFAULT_SETTINGS);
      }
    });
  }

  save(): void {
    this.saving.set(true);
    this.error.set('');
    this.message.set('');
    const settings = this.normalize(this.settings);
    this.saveSettings(settings).subscribe({
      next: (result) => {
        this.settings = this.normalize(result.settings || settings);
        this.message.set('Multiple location settings saved');
        this.saving.set(false);
      },
      error: (err) => {
        this.error.set(err?.error?.message || err?.message || 'Unable to save multiple location settings');
        this.saving.set(false);
      }
    });
  }

  sharedDataSummary(): string {
    const enabled = [
      this.settings.dataSharing.shareClientsAcrossBranches ? 'clients' : '',
      this.settings.dataSharing.shareMembershipsAcrossBranches ? 'memberships' : '',
      this.settings.dataSharing.sharePackagesAcrossBranches ? 'packages' : '',
      this.settings.dataSharing.shareWalletAcrossBranches ? 'wallet' : '',
      this.settings.dataSharing.shareInventoryAcrossBranches ? 'inventory' : '',
      this.settings.dataSharing.shareStaffAcrossBranches ? 'staff' : ''
    ].filter(Boolean);
    return enabled.length ? enabled.join(', ') : 'no shared branch data';
  }

  notificationSummary(): string {
    const enabled = [
      this.settings.notifications.notifyOwnerOnBranchChange ? 'owner branch change' : '',
      this.settings.notifications.notifyStaffOnTransfer ? 'staff transfer' : '',
      this.settings.notifications.notifyClientOnBranchTransfer ? 'client transfer' : ''
    ].filter(Boolean);
    return enabled.length ? enabled.join(', ') : 'no transfer notifications';
  }

  private loadSettings(): Observable<{ settings?: ApiRecord }> {
    return this.api.list<{ settings?: ApiRecord }>('settings/multiple-location').pipe(
      catchError((err) => this.isNotFound(err) ? this.api.list<{ settings?: ApiRecord }>('settings/multiple-location') : throwError(() => err))
    );
  }

  private saveSettings(settings: MultipleLocationSettingsState): Observable<{ settings?: ApiRecord }> {
    return this.api.put<{ settings?: ApiRecord }>('settings/multiple-location', { settings }).pipe(
      catchError((err) => this.isNotFound(err) ? this.api.put<{ settings?: ApiRecord }>('settings/multiple-location', { settings }) : throwError(() => err))
    );
  }

  private isNotFound(error: unknown): boolean {
    return Number((error as { status?: number })?.status || 0) === 404;
  }

  private normalize(input: unknown): MultipleLocationSettingsState {
    const source = (input || {}) as MultipleLocationSettingsState;
    const defaults = DEFAULT_SETTINGS;
    const locationControl = source.locationControl || defaults.locationControl;
    const branchAccess = source.branchAccess || defaults.branchAccess;
    const dataSharing = source.dataSharing || defaults.dataSharing;
    const bookingTransfer = source.bookingTransfer || defaults.bookingTransfer;
    const settlement = source.settlement || defaults.settlement;
    const notifications = source.notifications || defaults.notifications;

    return {
      locationControl: {
        multipleLocationEnabled: boolValue(locationControl.multipleLocationEnabled, defaults.locationControl.multipleLocationEnabled),
        branchSwitcherEnabled: boolValue(locationControl.branchSwitcherEnabled, defaults.locationControl.branchSwitcherEnabled),
        centralOwnerDashboard: boolValue(locationControl.centralOwnerDashboard, defaults.locationControl.centralOwnerDashboard),
        branchScopedLogin: boolValue(locationControl.branchScopedLogin, defaults.locationControl.branchScopedLogin)
      },
      branchAccess: {
        visibilityMode: oneOf(branchAccess.visibilityMode, ['all', 'assigned', 'region'], defaults.branchAccess.visibilityMode),
        defaultBranchMode: oneOf(branchAccess.defaultBranchMode, ['lastSelected', 'homeBranch', 'askEveryLogin'], defaults.branchAccess.defaultBranchMode),
        allowCrossBranchReports: boolValue(branchAccess.allowCrossBranchReports, defaults.branchAccess.allowCrossBranchReports),
        allowCrossBranchSearch: boolValue(branchAccess.allowCrossBranchSearch, defaults.branchAccess.allowCrossBranchSearch)
      },
      dataSharing: {
        shareClientsAcrossBranches: boolValue(dataSharing.shareClientsAcrossBranches, defaults.dataSharing.shareClientsAcrossBranches),
        shareMembershipsAcrossBranches: boolValue(dataSharing.shareMembershipsAcrossBranches, defaults.dataSharing.shareMembershipsAcrossBranches),
        sharePackagesAcrossBranches: boolValue(dataSharing.sharePackagesAcrossBranches, defaults.dataSharing.sharePackagesAcrossBranches),
        shareWalletAcrossBranches: boolValue(dataSharing.shareWalletAcrossBranches, defaults.dataSharing.shareWalletAcrossBranches),
        shareInventoryAcrossBranches: boolValue(dataSharing.shareInventoryAcrossBranches, defaults.dataSharing.shareInventoryAcrossBranches),
        shareStaffAcrossBranches: boolValue(dataSharing.shareStaffAcrossBranches, defaults.dataSharing.shareStaffAcrossBranches)
      },
      bookingTransfer: {
        crossBranchBooking: boolValue(bookingTransfer.crossBranchBooking, defaults.bookingTransfer.crossBranchBooking),
        bookingTransferAllowed: boolValue(bookingTransfer.bookingTransferAllowed, defaults.bookingTransfer.bookingTransferAllowed),
        clientTransferAllowed: boolValue(bookingTransfer.clientTransferAllowed, defaults.bookingTransfer.clientTransferAllowed),
        packageRedemptionAnyBranch: boolValue(bookingTransfer.packageRedemptionAnyBranch, defaults.bookingTransfer.packageRedemptionAnyBranch),
        membershipRedemptionAnyBranch: boolValue(bookingTransfer.membershipRedemptionAnyBranch, defaults.bookingTransfer.membershipRedemptionAnyBranch),
        ownerApprovalForTransfer: boolValue(bookingTransfer.ownerApprovalForTransfer, defaults.bookingTransfer.ownerApprovalForTransfer),
        conflictHandling: oneOf(bookingTransfer.conflictHandling, ['warn', 'block', 'approval'], defaults.bookingTransfer.conflictHandling)
      },
      settlement: {
        interBranchSettlementRequired: boolValue(settlement.interBranchSettlementRequired, defaults.settlement.interBranchSettlementRequired),
        settlementMode: oneOf(settlement.settlementMode, ['daily', 'weekly', 'monthly'], defaults.settlement.settlementMode),
        revenueCreditBranch: oneOf(settlement.revenueCreditBranch, ['saleBranch', 'serviceBranch'], defaults.settlement.revenueCreditBranch),
        inventoryCostBranch: oneOf(settlement.inventoryCostBranch, ['stockBranch', 'consumingBranch'], defaults.settlement.inventoryCostBranch)
      },
      notifications: {
        notifyOwnerOnBranchChange: boolValue(notifications.notifyOwnerOnBranchChange, defaults.notifications.notifyOwnerOnBranchChange),
        notifyStaffOnTransfer: boolValue(notifications.notifyStaffOnTransfer, defaults.notifications.notifyStaffOnTransfer),
        notifyClientOnBranchTransfer: boolValue(notifications.notifyClientOnBranchTransfer, defaults.notifications.notifyClientOnBranchTransfer)
      }
    };
  }
}
