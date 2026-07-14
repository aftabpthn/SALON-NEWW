import { CommonModule } from '@angular/common';
import { Component, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ApiRecord } from '../core/api.service';
import { GeneralSettingsService } from '../core/general-settings.service';
import { AuraDatePipe } from '../shared/pipes/aura-date.pipe';

type GeneralSettingsState = {
  workspace: {
    workspaceName: string;
    defaultLandingPage: string;
    fastPosEnabled: boolean;
  };
  localization: {
    country: string;
    language: string;
    timezone: string;
    currency: string;
    locale: string;
  };
  branchBehavior: {
    rememberLastBranch: boolean;
    requireBranchSelection: boolean;
    allowBranchSwitch: boolean;
  };
  dateTime: {
    dateFormat: string;
    timeFormat: string;
    businessDayStartHour: number;
    weekStartsOn: string;
  };
  interface: {
    compactMode: boolean;
    showModuleBadges: boolean;
    enableCommandSearch: boolean;
  };
  defaults: {
    refreshReportsOnOpen: boolean;
    ownerNotifications: boolean;
    staffHints: boolean;
  };
};

type GeneralSettingsAudit = {
  lastChangedBy: string;
  lastChangedAt: string;
};

const DEFAULT_SETTINGS: GeneralSettingsState = {
  workspace: {
    workspaceName: 'Aurashine OS',
    defaultLandingPage: 'dashboard',
    fastPosEnabled: true
  },
  localization: {
    country: 'India',
    language: 'English',
    timezone: 'Asia/Kolkata',
    currency: 'INR',
    locale: 'en-IN'
  },
  branchBehavior: {
    rememberLastBranch: true,
    requireBranchSelection: true,
    allowBranchSwitch: true
  },
  dateTime: {
    dateFormat: 'DD/MM/YYYY',
    timeFormat: '12h',
    businessDayStartHour: 0,
    weekStartsOn: 'Monday'
  },
  interface: {
    compactMode: false,
    showModuleBadges: true,
    enableCommandSearch: true
  },
  defaults: {
    refreshReportsOnOpen: true,
    ownerNotifications: true,
    staffHints: true
  }
};

const DEFAULT_AUDIT: GeneralSettingsAudit = {
  lastChangedBy: 'Not saved yet',
  lastChangedAt: ''
};

const LANDING_PAGES = [
  { value: 'dashboard', label: 'Dashboard' },
  { value: 'pos', label: 'POS Billing' },
  { value: 'appointments', label: 'Appointments' },
  { value: 'clients', label: 'Clients' },
  { value: 'reports', label: 'Reports' }
];

const DATE_FORMATS = ['MM/DD/YYYY', 'DD/MM/YYYY', 'YYYY-MM-DD'];
const TIME_FORMATS = ['12h', '24h'];
const WEEK_STARTS = ['Sunday', 'Monday'];

function cloneSettings(settings: GeneralSettingsState): GeneralSettingsState {
  return JSON.parse(JSON.stringify(settings)) as GeneralSettingsState;
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
  selector: 'app-general-settings',
  standalone: true,
  imports: [AuraDatePipe, CommonModule, FormsModule, RouterLink],
  template: `
    <section class="general-settings-page inner-page-shell">
      <aside class="settings-nav" aria-label="Settings sections">
        <a class="active" routerLink="/settings/general">General Settings</a>
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
        <a routerLink="/settings/business-details">Business Details</a>
        <a routerLink="/settings/payment-methods">Payment Methods</a>
        <a routerLink="/settings/message-history">Message History</a>
        <a routerLink="/settings/security">Security</a>
      </aside>

      <main class="settings-content">
        <header class="settings-hero inner-page-header">
          <div>
            <span class="eyebrow">Setup / General</span>
            <h1>General Settings Control</h1>
            <p>Control workspace defaults, country/language, branch behavior, date-time display, interface and notification defaults.</p>
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
        <p class="phase-note">This policy is active across landing, branch selection, app shell, reports, notifications and staff guidance.</p>

        <section class="audit-strip">
          <strong>Audit info</strong>
          <span>Last changed by: {{ audit.lastChangedBy || 'Not saved yet' }}</span>
          <span>Last changed time: {{ audit.lastChangedAt ? (audit.lastChangedAt | auraDate:'date') : 'Not saved yet' }}</span>
        </section>

        <section class="settings-grid inner-form-grid">
          <article class="settings-card inner-page-card">
            <h2>Workspace Profile</h2>
            <label class="field-row"><span>Workspace name</span><input [(ngModel)]="settings.workspace.workspaceName" /></label>
            <label class="field-row"><span>Default landing page</span><select [(ngModel)]="settings.workspace.defaultLandingPage"><option *ngFor="let page of landingPages" [value]="page.value">{{ page.label }}</option></select></label>
            <label class="switch-row"><span><strong>Fast POS enabled</strong><small>Show quick access to POS in the header.</small></span><input type="checkbox" [(ngModel)]="settings.workspace.fastPosEnabled" /><i></i></label>
          </article>

          <article class="settings-card inner-page-card">
            <h2>Localization</h2>
            <label class="field-row"><span>Country</span><input [(ngModel)]="settings.localization.country" /></label>
            <label class="field-row"><span>Language</span><input [(ngModel)]="settings.localization.language" /></label>
            <label class="field-row"><span>Timezone</span><input [(ngModel)]="settings.localization.timezone" /></label>
            <label class="field-row"><span>Currency</span><input [(ngModel)]="settings.localization.currency" /></label>
            <label class="field-row"><span>Locale</span><input [(ngModel)]="settings.localization.locale" /></label>
          </article>

          <article class="settings-card inner-page-card">
            <h2>Branch Behavior</h2>
            <label class="switch-row"><span><strong>Remember last branch</strong><small>Keep the last selected branch for this workspace.</small></span><input type="checkbox" [(ngModel)]="settings.branchBehavior.rememberLastBranch" /><i></i></label>
            <label class="switch-row"><span><strong>Require branch selection</strong><small>Ask users to confirm branch context.</small></span><input type="checkbox" [(ngModel)]="settings.branchBehavior.requireBranchSelection" /><i></i></label>
            <label class="switch-row"><span><strong>Allow branch switch</strong><small>Allow permitted users to change branch.</small></span><input type="checkbox" [(ngModel)]="settings.branchBehavior.allowBranchSwitch" /><i></i></label>
          </article>

          <article class="settings-card inner-page-card">
            <h2>Date & Time</h2>
            <label class="field-row"><span>Date format</span><select [(ngModel)]="settings.dateTime.dateFormat"><option *ngFor="let item of dateFormats" [value]="item">{{ item }}</option></select></label>
            <label class="field-row"><span>Time format</span><select [(ngModel)]="settings.dateTime.timeFormat"><option *ngFor="let item of timeFormats" [value]="item">{{ item }}</option></select></label>
            <label class="field-row"><span>Business day start hour</span><input type="number" min="0" max="23" [(ngModel)]="settings.dateTime.businessDayStartHour" /></label>
            <label class="field-row"><span>Week starts on</span><select [(ngModel)]="settings.dateTime.weekStartsOn"><option *ngFor="let item of weekStarts" [value]="item">{{ item }}</option></select></label>
          </article>

          <article class="settings-card inner-page-card">
            <h2>Interface</h2>
            <label class="switch-row"><span><strong>Compact mode</strong><small>Use tighter spacing on operational screens.</small></span><input type="checkbox" [(ngModel)]="settings.interface.compactMode" /><i></i></label>
            <label class="switch-row"><span><strong>Show module badges</strong><small>Display module count/status badges in navigation.</small></span><input type="checkbox" [(ngModel)]="settings.interface.showModuleBadges" /><i></i></label>
            <label class="switch-row"><span><strong>Enable command search</strong><small>Allow global module and command search.</small></span><input type="checkbox" [(ngModel)]="settings.interface.enableCommandSearch" /><i></i></label>
          </article>

          <article class="settings-card inner-page-card">
            <h2>Alerts & Defaults</h2>
            <label class="switch-row"><span><strong>Refresh reports on open</strong><small>Load fresh report data when report pages open.</small></span><input type="checkbox" [(ngModel)]="settings.defaults.refreshReportsOnOpen" /><i></i></label>
            <label class="switch-row"><span><strong>Owner notifications</strong><small>Enable owner-level app notifications by default.</small></span><input type="checkbox" [(ngModel)]="settings.defaults.ownerNotifications" /><i></i></label>
            <label class="switch-row"><span><strong>Staff hints</strong><small>Show short operational hints to staff users.</small></span><input type="checkbox" [(ngModel)]="settings.defaults.staffHints" /><i></i></label>
          </article>

          <article class="settings-card preview-card inner-page-card">
            <h2>Policy Preview</h2>
            <p>{{ settings.workspace.workspaceName }} opens on {{ settings.workspace.defaultLandingPage }} with {{ settings.workspace.fastPosEnabled ? 'Fast POS ON' : 'Fast POS OFF' }}.</p>
            <p>{{ settings.localization.country }} / {{ settings.localization.language }} / {{ settings.localization.currency }} using {{ settings.localization.timezone }}.</p>
            <p>Date format {{ settings.dateTime.dateFormat }}, {{ settings.dateTime.timeFormat }} time, week starts {{ settings.dateTime.weekStartsOn }}.</p>
            <p>Branch switch is {{ settings.branchBehavior.allowBranchSwitch ? 'allowed' : 'blocked' }} and command search is {{ settings.interface.enableCommandSearch ? 'enabled' : 'disabled' }}.</p>
          </article>
        </section>
      </main>
    </section>
  `,
  styles: [`
    .general-settings-page {
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
      background: #fff;
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
    .settings-card,
    .audit-strip {
      background: #fff;
      border: 1px solid #d9e5e0;
      border-radius: 18px;
      box-shadow: 0 18px 50px rgba(7, 43, 36, 0.08);
    }
    .settings-hero {
      display: flex;
      justify-content: space-between;
      gap: 16px;
      align-items: center;
      padding: 26px;
    }
    .eyebrow {
      color: #5a6b63;
      font-size: 12px;
      font-weight: 900;
      text-transform: uppercase;
    }
    h1 {
      margin: 8px 0;
      font-size: clamp(30px, 4vw, 46px);
      line-height: 1;
    }
    p {
      margin: 0;
      color: #52667d;
      line-height: 1.45;
    }
    .hero-actions {
      display: flex;
      gap: 10px;
      flex-wrap: wrap;
      justify-content: flex-end;
    }
    .primary-button,
    .ghost-button {
      border: 1px solid #d9e5e0;
      border-radius: 12px;
      padding: 13px 18px;
      font-weight: 900;
      cursor: pointer;
      background: #fff;
      color: #102235;
      white-space: nowrap;
    }
    .primary-button {
      background: #07966f;
      border-color: #07966f;
      color: #fff;
    }
    .phase-note,
    .state,
    .audit-strip {
      padding: 14px 16px;
      border-radius: 12px;
      font-weight: 800;
    }
    .phase-note {
      border: 1px solid #f2c85b;
      background: #fff9e8;
      color: #835d00;
    }
    .state.success {
      border: 1px solid #a6dfc8;
      background: #effcf6;
      color: #08785d;
    }
    .state.danger {
      border: 1px solid #ffb4b4;
      background: #fff0f0;
      color: #b00000;
    }
    .audit-strip {
      display: flex;
      gap: 14px;
      flex-wrap: wrap;
      align-items: center;
      box-shadow: none;
    }
    .audit-strip span {
      color: #52667d;
      font-weight: 800;
    }
    .settings-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 16px;
    }
    .settings-card {
      padding: 18px;
      display: grid;
      gap: 12px;
      align-content: start;
    }
    .settings-card h2 {
      margin: 0;
      color: #53635d;
      font-size: 14px;
      text-transform: uppercase;
      letter-spacing: 0;
    }
    .field-row {
      display: grid;
      gap: 8px;
      color: #44586d;
      font-weight: 800;
    }
    .field-row input,
    .field-row select {
      border: 1px solid #d6e3de;
      border-radius: 12px;
      padding: 13px 14px;
      font: inherit;
      color: #102235;
      min-width: 0;
      background: #fff;
    }
    .switch-row {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: 12px;
      align-items: center;
      border: 1px solid #d9e5e0;
      border-radius: 12px;
      padding: 12px 14px;
      min-height: 72px;
    }
    .switch-row span {
      display: grid;
      gap: 4px;
    }
    .switch-row small {
      color: #5b6d83;
      font-size: 12px;
    }
    .switch-row input[type="checkbox"] {
      position: absolute;
      opacity: 0;
      pointer-events: none;
    }
    .switch-row i {
      width: 48px;
      height: 28px;
      background: #cbd5df;
      border-radius: 999px;
      position: relative;
      transition: 0.2s ease;
    }
    .switch-row i::after {
      content: "";
      position: absolute;
      width: 20px;
      height: 20px;
      background: #fff;
      border-radius: 50%;
      top: 4px;
      left: 4px;
      transition: 0.2s ease;
    }
    .switch-row input:checked + i {
      background: #132235;
    }
    .switch-row input:checked + i::after {
      transform: translateX(20px);
    }
    .preview-card {
      background: #f9fffc;
    }
    @media (max-width: 980px) {
      .general-settings-page {
        grid-template-columns: 1fr;
      }
      .settings-nav {
        position: static;
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }
      .settings-hero {
        align-items: stretch;
        flex-direction: column;
      }
      .settings-grid {
        grid-template-columns: 1fr;
      }
    }
  `]
})
export class GeneralSettingsComponent implements OnInit {
  readonly landingPages = LANDING_PAGES;
  readonly dateFormats = DATE_FORMATS;
  readonly timeFormats = TIME_FORMATS;
  readonly weekStarts = WEEK_STARTS;
  settings = cloneSettings(DEFAULT_SETTINGS);
  audit: GeneralSettingsAudit = { ...DEFAULT_AUDIT };
  saving = signal(false);
  message = signal('');
  error = signal('');

  constructor(private readonly generalSettings: GeneralSettingsService) {}

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.error.set('');
    this.message.set('');
    this.generalSettings.load(true).subscribe({
      next: (res) => {
        this.settings = this.normalize(res.settings || {});
        this.audit = this.normalizeAudit(res.audit || {});
      },
      error: (error) => {
        if (error?.status === 404) {
          this.settings = cloneSettings(DEFAULT_SETTINGS);
          this.audit = { ...DEFAULT_AUDIT };
          return;
        }
        this.error.set('Unable to load general settings');
      }
    });
  }

  save(): void {
    this.saving.set(true);
    this.error.set('');
    this.message.set('');
    const settings = this.normalize(this.settings);
    this.generalSettings.save(settings).subscribe({
      next: (res) => {
        this.settings = this.normalize(res.settings || settings);
        this.audit = this.normalizeAudit(res.audit || {});
        this.message.set('General settings saved');
        this.saving.set(false);
      },
      error: () => {
        this.error.set('Unable to save general settings');
        this.saving.set(false);
      }
    });
  }

  private normalize(input: ApiRecord): GeneralSettingsState {
    const workspace = (input['workspace'] || {}) as ApiRecord;
    const localization = (input['localization'] || {}) as ApiRecord;
    const branchBehavior = (input['branchBehavior'] || {}) as ApiRecord;
    const dateTime = (input['dateTime'] || {}) as ApiRecord;
    const interfaceSettings = (input['interface'] || {}) as ApiRecord;
    const defaults = (input['defaults'] || {}) as ApiRecord;

    return {
      workspace: {
        workspaceName: stringValue(workspace['workspaceName'], DEFAULT_SETTINGS.workspace.workspaceName),
        defaultLandingPage: stringValue(workspace['defaultLandingPage'], DEFAULT_SETTINGS.workspace.defaultLandingPage),
        fastPosEnabled: boolValue(workspace['fastPosEnabled'], DEFAULT_SETTINGS.workspace.fastPosEnabled)
      },
      localization: {
        country: stringValue(localization['country'], DEFAULT_SETTINGS.localization.country),
        language: stringValue(localization['language'], DEFAULT_SETTINGS.localization.language),
        timezone: stringValue(localization['timezone'], DEFAULT_SETTINGS.localization.timezone),
        currency: stringValue(localization['currency'], DEFAULT_SETTINGS.localization.currency),
        locale: stringValue(localization['locale'], DEFAULT_SETTINGS.localization.locale)
      },
      branchBehavior: {
        rememberLastBranch: boolValue(branchBehavior['rememberLastBranch'], DEFAULT_SETTINGS.branchBehavior.rememberLastBranch),
        requireBranchSelection: boolValue(branchBehavior['requireBranchSelection'], DEFAULT_SETTINGS.branchBehavior.requireBranchSelection),
        allowBranchSwitch: boolValue(branchBehavior['allowBranchSwitch'], DEFAULT_SETTINGS.branchBehavior.allowBranchSwitch)
      },
      dateTime: {
        dateFormat: stringValue(dateTime['dateFormat'], DEFAULT_SETTINGS.dateTime.dateFormat),
        timeFormat: stringValue(dateTime['timeFormat'], DEFAULT_SETTINGS.dateTime.timeFormat),
        businessDayStartHour: numberValue(dateTime['businessDayStartHour'], DEFAULT_SETTINGS.dateTime.businessDayStartHour),
        weekStartsOn: stringValue(dateTime['weekStartsOn'], DEFAULT_SETTINGS.dateTime.weekStartsOn)
      },
      interface: {
        compactMode: boolValue(interfaceSettings['compactMode'], DEFAULT_SETTINGS.interface.compactMode),
        showModuleBadges: boolValue(interfaceSettings['showModuleBadges'], DEFAULT_SETTINGS.interface.showModuleBadges),
        enableCommandSearch: boolValue(interfaceSettings['enableCommandSearch'], DEFAULT_SETTINGS.interface.enableCommandSearch)
      },
      defaults: {
        refreshReportsOnOpen: boolValue(defaults['refreshReportsOnOpen'], DEFAULT_SETTINGS.defaults.refreshReportsOnOpen),
        ownerNotifications: boolValue(defaults['ownerNotifications'], DEFAULT_SETTINGS.defaults.ownerNotifications),
        staffHints: boolValue(defaults['staffHints'], DEFAULT_SETTINGS.defaults.staffHints)
      }
    };
  }

  private normalizeAudit(input: ApiRecord): GeneralSettingsAudit {
    return {
      lastChangedBy: String(input['lastChangedBy'] || DEFAULT_AUDIT.lastChangedBy),
      lastChangedAt: String(input['lastChangedAt'] || DEFAULT_AUDIT.lastChangedAt)
    };
  }
}
