import { CommonModule } from '@angular/common';
import { Component, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ApiRecord, ApiService } from '../core/api.service';

type ConsentTemplate = {
  id: string;
  name: string;
  enabled: boolean;
  required: boolean;
};

type ConsentFormsSettingsState = {
  consentControl: {
    consentFormsEnabled: boolean;
    requireConsentBeforeService: boolean;
    requireConsentBeforeOnlineBooking: boolean;
    allowSkipWithOwnerApproval: boolean;
    storeSignedCopy: boolean;
  };
  captureRules: {
    digitalSignatureRequired: boolean;
    guardianConsentForMinor: boolean;
    photoConsentRequired: boolean;
    medicalHistoryRequired: boolean;
    patchTestConsentRequired: boolean;
    aftercareAcceptanceRequired: boolean;
  };
  formTemplates: ConsentTemplate[];
  notifications: {
    remindClientBeforeAppointment: boolean;
    notifyOwnerWhenMissing: boolean;
    notifyStaffWhenSigned: boolean;
  };
  retention: {
    retainSignedFormsYears: number;
    allowClientDownload: boolean;
  };
};

const DEFAULT_SETTINGS: ConsentFormsSettingsState = {
  consentControl: {
    consentFormsEnabled: true,
    requireConsentBeforeService: true,
    requireConsentBeforeOnlineBooking: false,
    allowSkipWithOwnerApproval: true,
    storeSignedCopy: true
  },
  captureRules: {
    digitalSignatureRequired: true,
    guardianConsentForMinor: true,
    photoConsentRequired: false,
    medicalHistoryRequired: false,
    patchTestConsentRequired: false,
    aftercareAcceptanceRequired: true
  },
  formTemplates: [
    { id: 'general_service', name: 'General Service Consent', enabled: true, required: true },
    { id: 'hair_color', name: 'Hair Color / Chemical Consent', enabled: true, required: false },
    { id: 'skin_treatment', name: 'Skin / Facial Consent', enabled: true, required: false }
  ],
  notifications: {
    remindClientBeforeAppointment: true,
    notifyOwnerWhenMissing: true,
    notifyStaffWhenSigned: true
  },
  retention: {
    retainSignedFormsYears: 3,
    allowClientDownload: true
  }
};

function cloneSettings(settings: ConsentFormsSettingsState): ConsentFormsSettingsState {
  return JSON.parse(JSON.stringify(settings)) as ConsentFormsSettingsState;
}

function boolValue(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function numberValue(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.round(parsed) : fallback;
}

function textValue(value: unknown, fallback: string): string {
  return String(value ?? fallback).trim();
}

@Component({
  selector: 'app-consent-forms-settings',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  template: `
    <section class="consent-settings-page inner-page-shell">
      <aside class="settings-nav" aria-label="Settings sections">
        <a routerLink="/settings/general">General Settings</a>
        <a routerLink="/settings/products">Products Settings</a>
        <a routerLink="/settings/supplier">Supplier Settings</a>
        <a routerLink="/settings/inventory">Inventory Settings</a>
        <a routerLink="/settings/services">Services Settings</a>
        <a routerLink="/settings/packages">Packages Settings</a>
        <a routerLink="/settings/membership">Membership Settings</a>
        <a routerLink="/settings/custom-fields">Custom Fields</a>
        <a class="active" routerLink="/settings/consent-forms">Consent Forms</a>
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
            <span class="eyebrow">Setup / Consent Forms</span>
            <h1>Consent Forms Settings Control</h1>
            <p>Control service consent forms, signatures, minor guardian consent, client reminders and signed form retention policy.</p>
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
        <p class="phase-note">Next phase will connect appointment creation, online booking, client profile and signed document storage to these saved consent rules.</p>

        <section class="settings-grid inner-form-grid">
          <article class="settings-card inner-page-card">
            <h2>Consent Control</h2>
            <label class="switch-row">
              <span><strong>Consent Forms Enabled</strong><small>Enable consent control for appointment and service flows.</small></span>
              <input type="checkbox" [(ngModel)]="settings.consentControl.consentFormsEnabled" />
              <i aria-hidden="true"></i>
            </label>
            <label class="switch-row">
              <span><strong>Require Consent Before Service</strong><small>Staff must collect consent before service starts.</small></span>
              <input type="checkbox" [(ngModel)]="settings.consentControl.requireConsentBeforeService" />
              <i aria-hidden="true"></i>
            </label>
            <label class="switch-row">
              <span><strong>Require Consent Before Online Booking</strong><small>Ask client to accept consent during booking.</small></span>
              <input type="checkbox" [(ngModel)]="settings.consentControl.requireConsentBeforeOnlineBooking" />
              <i aria-hidden="true"></i>
            </label>
            <label class="switch-row">
              <span><strong>Allow Skip With Owner Approval</strong><small>Missing consent can continue only after approval.</small></span>
              <input type="checkbox" [(ngModel)]="settings.consentControl.allowSkipWithOwnerApproval" />
              <i aria-hidden="true"></i>
            </label>
            <label class="switch-row">
              <span><strong>Store Signed Copy</strong><small>Keep signed consent record for audit and client history.</small></span>
              <input type="checkbox" [(ngModel)]="settings.consentControl.storeSignedCopy" />
              <i aria-hidden="true"></i>
            </label>
          </article>

          <article class="settings-card inner-page-card">
            <h2>Capture Rules</h2>
            <label class="switch-row">
              <span><strong>Digital Signature Required</strong><small>Require client signature on consent form.</small></span>
              <input type="checkbox" [(ngModel)]="settings.captureRules.digitalSignatureRequired" />
              <i aria-hidden="true"></i>
            </label>
            <label class="switch-row">
              <span><strong>Guardian Consent for Minor</strong><small>Require guardian consent for minor clients.</small></span>
              <input type="checkbox" [(ngModel)]="settings.captureRules.guardianConsentForMinor" />
              <i aria-hidden="true"></i>
            </label>
            <label class="switch-row">
              <span><strong>Photo Consent Required</strong><small>Capture consent before before/after photos.</small></span>
              <input type="checkbox" [(ngModel)]="settings.captureRules.photoConsentRequired" />
              <i aria-hidden="true"></i>
            </label>
            <label class="switch-row">
              <span><strong>Medical History Required</strong><small>Ask allergy/medical history before risky services.</small></span>
              <input type="checkbox" [(ngModel)]="settings.captureRules.medicalHistoryRequired" />
              <i aria-hidden="true"></i>
            </label>
            <label class="switch-row">
              <span><strong>Patch Test Consent Required</strong><small>Track patch test consent for chemical/color services.</small></span>
              <input type="checkbox" [(ngModel)]="settings.captureRules.patchTestConsentRequired" />
              <i aria-hidden="true"></i>
            </label>
            <label class="switch-row">
              <span><strong>Aftercare Acceptance Required</strong><small>Client accepts aftercare instructions.</small></span>
              <input type="checkbox" [(ngModel)]="settings.captureRules.aftercareAcceptanceRequired" />
              <i aria-hidden="true"></i>
            </label>
          </article>

          <article class="settings-card templates-card">
            <h2>Consent Form Templates</h2>
            <div class="template-row header-row">
              <span>Form Name</span>
              <span>Enabled</span>
              <span>Required</span>
              <span></span>
            </div>
            <div class="template-row" *ngFor="let template of settings.formTemplates; let i = index">
              <input type="text" [(ngModel)]="template.name" />
              <label class="mini-check"><input type="checkbox" [(ngModel)]="template.enabled" /> Enabled</label>
              <label class="mini-check"><input type="checkbox" [(ngModel)]="template.required" /> Required</label>
              <button class="text-button" type="button" (click)="removeTemplate(i)" [disabled]="settings.formTemplates.length <= 1">Remove</button>
            </div>
            <button class="ghost-button add-button" type="button" (click)="addTemplate()">Add More</button>
          </article>

          <article class="settings-card inner-page-card">
            <h2>Notifications</h2>
            <label class="switch-row">
              <span><strong>Remind Client Before Appointment</strong><small>Send consent reminder before appointment.</small></span>
              <input type="checkbox" [(ngModel)]="settings.notifications.remindClientBeforeAppointment" />
              <i aria-hidden="true"></i>
            </label>
            <label class="switch-row">
              <span><strong>Notify Owner When Missing</strong><small>Owner gets alert when consent is missing.</small></span>
              <input type="checkbox" [(ngModel)]="settings.notifications.notifyOwnerWhenMissing" />
              <i aria-hidden="true"></i>
            </label>
            <label class="switch-row">
              <span><strong>Notify Staff When Signed</strong><small>Assigned staff sees consent signed status.</small></span>
              <input type="checkbox" [(ngModel)]="settings.notifications.notifyStaffWhenSigned" />
              <i aria-hidden="true"></i>
            </label>
          </article>

          <article class="settings-card inner-page-card">
            <h2>Retention</h2>
            <label class="field-row">
              <span>Retain Signed Forms Years</span>
              <input type="number" min="1" max="10" [(ngModel)]="settings.retention.retainSignedFormsYears" />
            </label>
            <label class="switch-row">
              <span><strong>Allow Client Download</strong><small>Client can download their signed consent copy.</small></span>
              <input type="checkbox" [(ngModel)]="settings.retention.allowClientDownload" />
              <i aria-hidden="true"></i>
            </label>
          </article>

          <article class="settings-card preview-card">
            <h2>Policy Preview</h2>
            <div class="preview-list">
              <p><strong>Status:</strong> {{ settings.consentControl.consentFormsEnabled ? 'Consent forms ON' : 'Consent forms OFF' }}.</p>
              <p><strong>Service rule:</strong> {{ settings.consentControl.requireConsentBeforeService ? 'Required before service' : 'Not required before service' }}.</p>
              <p><strong>Signature:</strong> {{ settings.captureRules.digitalSignatureRequired ? 'Digital signature required' : 'Signature optional' }}.</p>
              <p><strong>Templates:</strong> {{ enabledTemplateCount() }} enabled, {{ requiredTemplateCount() }} required.</p>
              <p><strong>Retention:</strong> Signed forms retained for {{ settings.retention.retainSignedFormsYears }} year(s).</p>
              <p><strong>Alerts:</strong> {{ notificationSummary() }}.</p>
            </div>
          </article>
        </section>
      </main>
    </section>
  `,
  styles: [`
    :host { display: block; color: #0f2235; }
    .consent-settings-page {
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
    .primary-button:disabled,
    .text-button:disabled { opacity: 0.55; cursor: not-allowed; }
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
    input[type="text"],
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
    .templates-card { grid-column: 1 / -1; overflow-x: auto; }
    .template-row {
      display: grid;
      grid-template-columns: minmax(240px, 1fr) 120px 120px 100px;
      gap: 12px;
      align-items: center;
      padding: 12px 16px;
      border-bottom: 1px solid #edf2f0;
      min-width: 720px;
    }
    .header-row {
      color: #53645f;
      font-size: 12px;
      font-weight: 900;
      text-transform: uppercase;
      background: #f7fbfa;
    }
    .mini-check {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      font-weight: 800;
    }
    .text-button {
      color: #b42318;
      background: transparent;
      text-align: left;
      padding: 8px 0;
    }
    .add-button { margin: 14px 16px 18px; }
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
      .consent-settings-page { grid-template-columns: 1fr; }
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
export class ConsentFormsSettingsComponent implements OnInit {
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
    this.api.list<{ settings?: ApiRecord }>('settings/consent-forms').subscribe({
      next: (result) => {
        this.settings = this.normalize(result.settings);
      },
      error: (err) => {
        this.error.set(err?.error?.message || err?.message || 'Unable to load consent forms settings');
        this.settings = cloneSettings(DEFAULT_SETTINGS);
      }
    });
  }

  save(): void {
    this.saving.set(true);
    this.error.set('');
    this.message.set('');
    const settings = this.normalize(this.settings);
    this.api.put<{ settings?: ApiRecord }>('settings/consent-forms', { settings }).subscribe({
      next: (result) => {
        this.settings = this.normalize(result.settings || settings);
        this.message.set('Consent forms settings saved');
        this.saving.set(false);
      },
      error: (err) => {
        this.error.set(err?.error?.message || err?.message || 'Unable to save consent forms settings');
        this.saving.set(false);
      }
    });
  }

  addTemplate(): void {
    const next = this.settings.formTemplates.length + 1;
    this.settings.formTemplates = [
      ...this.settings.formTemplates,
      { id: `custom_${next}`, name: `Custom Consent Form ${next}`, enabled: true, required: false }
    ];
  }

  removeTemplate(index: number): void {
    if (this.settings.formTemplates.length <= 1) return;
    this.settings.formTemplates = this.settings.formTemplates.filter((_, itemIndex) => itemIndex !== index);
  }

  enabledTemplateCount(): number {
    return this.settings.formTemplates.filter((item) => item.enabled).length;
  }

  requiredTemplateCount(): number {
    return this.settings.formTemplates.filter((item) => item.required).length;
  }

  notificationSummary(): string {
    const enabled = [
      this.settings.notifications.remindClientBeforeAppointment ? 'client reminder' : '',
      this.settings.notifications.notifyOwnerWhenMissing ? 'owner missing alert' : '',
      this.settings.notifications.notifyStaffWhenSigned ? 'staff signed alert' : ''
    ].filter(Boolean);
    return enabled.length ? enabled.join(', ') : 'no consent alerts';
  }

  private normalize(input: unknown): ConsentFormsSettingsState {
    const source = (input || {}) as ConsentFormsSettingsState;
    const defaults = DEFAULT_SETTINGS;
    const consentControl = source.consentControl || defaults.consentControl;
    const captureRules = source.captureRules || defaults.captureRules;
    const notifications = source.notifications || defaults.notifications;
    const retention = source.retention || defaults.retention;
    const formTemplates = Array.isArray(source.formTemplates) && source.formTemplates.length ? source.formTemplates : defaults.formTemplates;
    return {
      consentControl: {
        consentFormsEnabled: boolValue(consentControl.consentFormsEnabled, defaults.consentControl.consentFormsEnabled),
        requireConsentBeforeService: boolValue(consentControl.requireConsentBeforeService, defaults.consentControl.requireConsentBeforeService),
        requireConsentBeforeOnlineBooking: boolValue(consentControl.requireConsentBeforeOnlineBooking, defaults.consentControl.requireConsentBeforeOnlineBooking),
        allowSkipWithOwnerApproval: boolValue(consentControl.allowSkipWithOwnerApproval, defaults.consentControl.allowSkipWithOwnerApproval),
        storeSignedCopy: boolValue(consentControl.storeSignedCopy, defaults.consentControl.storeSignedCopy)
      },
      captureRules: {
        digitalSignatureRequired: boolValue(captureRules.digitalSignatureRequired, defaults.captureRules.digitalSignatureRequired),
        guardianConsentForMinor: boolValue(captureRules.guardianConsentForMinor, defaults.captureRules.guardianConsentForMinor),
        photoConsentRequired: boolValue(captureRules.photoConsentRequired, defaults.captureRules.photoConsentRequired),
        medicalHistoryRequired: boolValue(captureRules.medicalHistoryRequired, defaults.captureRules.medicalHistoryRequired),
        patchTestConsentRequired: boolValue(captureRules.patchTestConsentRequired, defaults.captureRules.patchTestConsentRequired),
        aftercareAcceptanceRequired: boolValue(captureRules.aftercareAcceptanceRequired, defaults.captureRules.aftercareAcceptanceRequired)
      },
      formTemplates: formTemplates.slice(0, 25).map((item, index) => ({
        id: textValue(item.id, `custom_${index + 1}`),
        name: textValue(item.name, `Consent Form ${index + 1}`),
        enabled: boolValue(item.enabled, true),
        required: boolValue(item.required, false)
      })),
      notifications: {
        remindClientBeforeAppointment: boolValue(notifications.remindClientBeforeAppointment, defaults.notifications.remindClientBeforeAppointment),
        notifyOwnerWhenMissing: boolValue(notifications.notifyOwnerWhenMissing, defaults.notifications.notifyOwnerWhenMissing),
        notifyStaffWhenSigned: boolValue(notifications.notifyStaffWhenSigned, defaults.notifications.notifyStaffWhenSigned)
      },
      retention: {
        retainSignedFormsYears: numberValue(retention.retainSignedFormsYears, defaults.retention.retainSignedFormsYears),
        allowClientDownload: boolValue(retention.allowClientDownload, defaults.retention.allowClientDownload)
      }
    };
  }
}
