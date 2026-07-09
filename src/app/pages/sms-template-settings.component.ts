import { CommonModule } from '@angular/common';
import { Component, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ApiRecord, ApiService } from '../core/api.service';

type SmsTemplate = {
  id: string;
  name: string;
  enabled: boolean;
  dltTemplateId: string;
  body: string;
};

type SmsTemplateSettingsState = {
  smsControl: {
    smsEnabled: boolean;
    transactionalSmsEnabled: boolean;
    promotionalSmsEnabled: boolean;
    requireOwnerApprovalForPromo: boolean;
    dltTemplateIdRequired: boolean;
  };
  sender: {
    senderId: string;
    countryCode: string;
    fallbackToWhatsapp: boolean;
    quietHoursEnabled: boolean;
    quietHoursStart: string;
    quietHoursEnd: string;
  };
  automation: {
    appointmentConfirmation: boolean;
    appointmentReminder: boolean;
    birthdayGreeting: boolean;
    paymentDueReminder: boolean;
    packageExpiryReminder: boolean;
    consentReminder: boolean;
    reviewRequest: boolean;
  };
  templates: SmsTemplate[];
  alerts: {
    notifyOwnerOnFailedSms: boolean;
    notifyOwnerOnLowBalance: boolean;
    lowBalanceThreshold: number;
  };
};

const DEFAULT_SETTINGS: SmsTemplateSettingsState = {
  smsControl: {
    smsEnabled: true,
    transactionalSmsEnabled: true,
    promotionalSmsEnabled: false,
    requireOwnerApprovalForPromo: true,
    dltTemplateIdRequired: true
  },
  sender: {
    senderId: 'AURAOS',
    countryCode: '+91',
    fallbackToWhatsapp: false,
    quietHoursEnabled: true,
    quietHoursStart: '21:00',
    quietHoursEnd: '09:00'
  },
  automation: {
    appointmentConfirmation: true,
    appointmentReminder: true,
    birthdayGreeting: true,
    paymentDueReminder: true,
    packageExpiryReminder: true,
    consentReminder: true,
    reviewRequest: true
  },
  templates: [
    {
      id: 'appointment_confirmation',
      name: 'Appointment Confirmation',
      enabled: true,
      dltTemplateId: '',
      body: 'Hi {{clientName}}, your appointment at {{businessName}} is confirmed for {{appointmentDate}} {{appointmentTime}}.'
    },
    {
      id: 'appointment_reminder',
      name: 'Appointment Reminder',
      enabled: true,
      dltTemplateId: '',
      body: 'Hi {{clientName}}, reminder for your appointment at {{businessName}} on {{appointmentDate}} {{appointmentTime}}.'
    },
    {
      id: 'payment_due',
      name: 'Payment Due Reminder',
      enabled: true,
      dltTemplateId: '',
      body: 'Hi {{clientName}}, your pending amount is {{dueAmount}} at {{businessName}}.'
    }
  ],
  alerts: {
    notifyOwnerOnFailedSms: true,
    notifyOwnerOnLowBalance: true,
    lowBalanceThreshold: 100
  }
};

function cloneSettings(settings: SmsTemplateSettingsState): SmsTemplateSettingsState {
  return JSON.parse(JSON.stringify(settings)) as SmsTemplateSettingsState;
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
  selector: 'app-sms-template-settings',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  template: `
    <section class="sms-settings-page inner-page-shell">
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
        <a routerLink="/settings/business-details">Business Details</a>
        <a routerLink="/settings/payment-methods">Payment Methods</a>
        <a routerLink="/settings/message-history">Message History</a>
        <a class="active" routerLink="/settings/sms-template">SMS Template</a>
        <a routerLink="/settings/security">Security</a>
      </aside>

      <main class="settings-content">
        <header class="settings-hero inner-page-header">
          <div>
            <span class="eyebrow">Setup / SMS Template</span>
            <h1>SMS Template Settings Control</h1>
            <p>Control SMS sending policy, sender identity, automation triggers, DLT IDs, templates and delivery alerts.</p>
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
        <p class="phase-note">Next phase will connect booking, billing, due recovery, package expiry, consent and review flows to these saved SMS templates.</p>

        <section class="settings-grid inner-form-grid">
          <article class="settings-card inner-page-card">
            <h2>SMS Control</h2>
            <ng-container *ngFor="let item of smsControls">
              <label class="switch-row">
                <span><strong>{{ item.label }}</strong><small>{{ item.help }}</small></span>
                <input type="checkbox" [(ngModel)]="settings.smsControl[item.key]" />
                <i aria-hidden="true"></i>
              </label>
            </ng-container>
          </article>

          <article class="settings-card inner-page-card">
            <h2>Sender & Quiet Hours</h2>
            <label class="field-row">
              <span>Sender ID</span>
              <input type="text" [(ngModel)]="settings.sender.senderId" />
            </label>
            <label class="field-row">
              <span>Country Code</span>
              <input type="text" [(ngModel)]="settings.sender.countryCode" />
            </label>
            <label class="switch-row">
              <span><strong>Fallback to WhatsApp</strong><small>Use WhatsApp if SMS cannot be sent.</small></span>
              <input type="checkbox" [(ngModel)]="settings.sender.fallbackToWhatsapp" />
              <i aria-hidden="true"></i>
            </label>
            <label class="switch-row">
              <span><strong>Quiet Hours Enabled</strong><small>Hold non-urgent SMS during quiet hours.</small></span>
              <input type="checkbox" [(ngModel)]="settings.sender.quietHoursEnabled" />
              <i aria-hidden="true"></i>
            </label>
            <div class="two-fields">
              <label class="field-row">
                <span>Quiet Hours Start</span>
                <input type="time" [(ngModel)]="settings.sender.quietHoursStart" />
              </label>
              <label class="field-row">
                <span>Quiet Hours End</span>
                <input type="time" [(ngModel)]="settings.sender.quietHoursEnd" />
              </label>
            </div>
          </article>

          <article class="settings-card inner-page-card">
            <h2>Automation Triggers</h2>
            <ng-container *ngFor="let item of automationControls">
              <label class="switch-row">
                <span><strong>{{ item.label }}</strong><small>{{ item.help }}</small></span>
                <input type="checkbox" [(ngModel)]="settings.automation[item.key]" />
                <i aria-hidden="true"></i>
              </label>
            </ng-container>
          </article>

          <article class="settings-card inner-page-card">
            <h2>Alerts</h2>
            <label class="switch-row">
              <span><strong>Notify Owner on Failed SMS</strong><small>Owner alert when SMS fails.</small></span>
              <input type="checkbox" [(ngModel)]="settings.alerts.notifyOwnerOnFailedSms" />
              <i aria-hidden="true"></i>
            </label>
            <label class="switch-row">
              <span><strong>Notify Owner on Low Balance</strong><small>Owner alert when SMS credit is low.</small></span>
              <input type="checkbox" [(ngModel)]="settings.alerts.notifyOwnerOnLowBalance" />
              <i aria-hidden="true"></i>
            </label>
            <label class="field-row">
              <span>Low Balance Threshold</span>
              <input type="number" min="0" [(ngModel)]="settings.alerts.lowBalanceThreshold" />
            </label>
          </article>

          <article class="settings-card templates-card">
            <h2>SMS Templates</h2>
            <div class="template-row header-row">
              <span>Name</span>
              <span>DLT Template ID</span>
              <span>Enabled</span>
              <span>Message</span>
              <span></span>
            </div>
            <div class="template-row" *ngFor="let template of settings.templates; let i = index">
              <input type="text" [(ngModel)]="template.name" />
              <input type="text" [(ngModel)]="template.dltTemplateId" placeholder="DLT ID" />
              <label class="mini-check"><input type="checkbox" [(ngModel)]="template.enabled" /> Enabled</label>
              <textarea rows="3" [(ngModel)]="template.body"></textarea>
              <button class="text-button" type="button" (click)="removeTemplate(i)" [disabled]="settings.templates.length <= 1">Remove</button>
            </div>
            <button class="ghost-button add-button" type="button" (click)="addTemplate()">Add Template</button>
          </article>

          <article class="settings-card preview-card">
            <h2>Policy Preview</h2>
            <div class="preview-list">
              <p><strong>SMS:</strong> {{ settings.smsControl.smsEnabled ? 'enabled' : 'disabled' }}, transactional {{ settings.smsControl.transactionalSmsEnabled ? 'ON' : 'OFF' }}.</p>
              <p><strong>Sender:</strong> {{ settings.sender.senderId || 'Not set' }} {{ settings.sender.countryCode }}.</p>
              <p><strong>Quiet Hours:</strong> {{ settings.sender.quietHoursEnabled ? (settings.sender.quietHoursStart + ' to ' + settings.sender.quietHoursEnd) : 'OFF' }}.</p>
              <p><strong>Automation:</strong> {{ automationSummary() }}.</p>
              <p><strong>Templates:</strong> {{ enabledTemplateCount() }} enabled of {{ settings.templates.length }}.</p>
              <p><strong>Alerts:</strong> {{ alertSummary() }}.</p>
            </div>
          </article>
        </section>
      </main>
    </section>
  `,
  styles: [`
    :host { display: block; color: #0f2235; }
    .sms-settings-page {
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
    .two-fields {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
    input[type="text"],
    input[type="number"],
    input[type="time"],
    textarea {
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
    textarea { resize: vertical; }
    .templates-card { grid-column: 1 / -1; overflow-x: auto; }
    .template-row {
      display: grid;
      grid-template-columns: 180px 180px 110px minmax(280px, 1fr) 90px;
      gap: 12px;
      align-items: center;
      padding: 12px 16px;
      border-bottom: 1px solid #edf2f0;
      min-width: 900px;
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
      .sms-settings-page { grid-template-columns: 1fr; }
      .settings-nav { position: static; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); }
    }
    @media (max-width: 800px) {
      .settings-grid,
      .preview-list,
      .two-fields { grid-template-columns: 1fr; }
      .settings-hero { align-items: stretch; flex-direction: column; padding: 20px; }
      h1 { font-size: 32px; }
    }
  `]
})
export class SmsTemplateSettingsComponent implements OnInit {
  saving = signal(false);
  message = signal('');
  error = signal('');
  settings = cloneSettings(DEFAULT_SETTINGS);

  readonly smsControls: Array<{ key: keyof SmsTemplateSettingsState['smsControl']; label: string; help: string }> = [
    { key: 'smsEnabled', label: 'SMS Enabled', help: 'Enable SMS policy for the branch.' },
    { key: 'transactionalSmsEnabled', label: 'Transactional SMS Enabled', help: 'Allow appointment, invoice and due SMS.' },
    { key: 'promotionalSmsEnabled', label: 'Promotional SMS Enabled', help: 'Allow campaign and offer SMS.' },
    { key: 'requireOwnerApprovalForPromo', label: 'Owner Approval for Promo', help: 'Promotional SMS needs owner approval.' },
    { key: 'dltTemplateIdRequired', label: 'DLT Template ID Required', help: 'Require DLT template ID before sending.' }
  ];

  readonly automationControls: Array<{ key: keyof SmsTemplateSettingsState['automation']; label: string; help: string }> = [
    { key: 'appointmentConfirmation', label: 'Appointment Confirmation', help: 'Send SMS when appointment is confirmed.' },
    { key: 'appointmentReminder', label: 'Appointment Reminder', help: 'Send reminder before appointment.' },
    { key: 'birthdayGreeting', label: 'Birthday Greeting', help: 'Send birthday greeting SMS.' },
    { key: 'paymentDueReminder', label: 'Payment Due Reminder', help: 'Send due payment reminder.' },
    { key: 'packageExpiryReminder', label: 'Package Expiry Reminder', help: 'Send package expiry reminder.' },
    { key: 'consentReminder', label: 'Consent Reminder', help: 'Send consent form reminder.' },
    { key: 'reviewRequest', label: 'Review Request', help: 'Send review request SMS.' }
  ];

  constructor(private readonly api: ApiService) {}

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.error.set('');
    this.message.set('');
    this.api.list<{ settings?: ApiRecord }>('settings/sms-template').subscribe({
      next: (result) => {
        this.settings = this.normalize(result.settings);
      },
      error: (err) => {
        this.error.set(err?.error?.message || err?.message || 'Unable to load SMS template settings');
        this.settings = cloneSettings(DEFAULT_SETTINGS);
      }
    });
  }

  save(): void {
    this.saving.set(true);
    this.error.set('');
    this.message.set('');
    const settings = this.normalize(this.settings);
    this.api.put<{ settings?: ApiRecord }>('settings/sms-template', { settings }).subscribe({
      next: (result) => {
        this.settings = this.normalize(result.settings || settings);
        this.message.set('SMS template settings saved');
        this.saving.set(false);
      },
      error: (err) => {
        this.error.set(err?.error?.message || err?.message || 'Unable to save SMS template settings');
        this.saving.set(false);
      }
    });
  }

  addTemplate(): void {
    const next = this.settings.templates.length + 1;
    this.settings.templates = [
      ...this.settings.templates,
      { id: `custom_sms_${next}`, name: `Custom SMS ${next}`, enabled: true, dltTemplateId: '', body: '' }
    ];
  }

  removeTemplate(index: number): void {
    if (this.settings.templates.length <= 1) return;
    this.settings.templates = this.settings.templates.filter((_, itemIndex) => itemIndex !== index);
  }

  enabledTemplateCount(): number {
    return this.settings.templates.filter((template) => template.enabled).length;
  }

  automationSummary(): string {
    const enabled = Object.values(this.settings.automation).filter(Boolean).length;
    return `${enabled} trigger(s) enabled`;
  }

  alertSummary(): string {
    const enabled = [
      this.settings.alerts.notifyOwnerOnFailedSms ? 'failed SMS' : '',
      this.settings.alerts.notifyOwnerOnLowBalance ? 'low balance' : ''
    ].filter(Boolean);
    return enabled.length ? `${enabled.join(', ')}; threshold ${this.settings.alerts.lowBalanceThreshold}` : 'no SMS alerts';
  }

  private normalize(input: unknown): SmsTemplateSettingsState {
    const source = (input || {}) as SmsTemplateSettingsState;
    const defaults = DEFAULT_SETTINGS;
    const smsControl = source.smsControl || defaults.smsControl;
    const sender = source.sender || defaults.sender;
    const automation = source.automation || defaults.automation;
    const alerts = source.alerts || defaults.alerts;
    const templates = Array.isArray(source.templates) && source.templates.length ? source.templates : defaults.templates;
    return {
      smsControl: {
        smsEnabled: boolValue(smsControl.smsEnabled, defaults.smsControl.smsEnabled),
        transactionalSmsEnabled: boolValue(smsControl.transactionalSmsEnabled, defaults.smsControl.transactionalSmsEnabled),
        promotionalSmsEnabled: boolValue(smsControl.promotionalSmsEnabled, defaults.smsControl.promotionalSmsEnabled),
        requireOwnerApprovalForPromo: boolValue(smsControl.requireOwnerApprovalForPromo, defaults.smsControl.requireOwnerApprovalForPromo),
        dltTemplateIdRequired: boolValue(smsControl.dltTemplateIdRequired, defaults.smsControl.dltTemplateIdRequired)
      },
      sender: {
        senderId: textValue(sender.senderId, defaults.sender.senderId),
        countryCode: textValue(sender.countryCode, defaults.sender.countryCode),
        fallbackToWhatsapp: boolValue(sender.fallbackToWhatsapp, defaults.sender.fallbackToWhatsapp),
        quietHoursEnabled: boolValue(sender.quietHoursEnabled, defaults.sender.quietHoursEnabled),
        quietHoursStart: textValue(sender.quietHoursStart, defaults.sender.quietHoursStart),
        quietHoursEnd: textValue(sender.quietHoursEnd, defaults.sender.quietHoursEnd)
      },
      automation: {
        appointmentConfirmation: boolValue(automation.appointmentConfirmation, defaults.automation.appointmentConfirmation),
        appointmentReminder: boolValue(automation.appointmentReminder, defaults.automation.appointmentReminder),
        birthdayGreeting: boolValue(automation.birthdayGreeting, defaults.automation.birthdayGreeting),
        paymentDueReminder: boolValue(automation.paymentDueReminder, defaults.automation.paymentDueReminder),
        packageExpiryReminder: boolValue(automation.packageExpiryReminder, defaults.automation.packageExpiryReminder),
        consentReminder: boolValue(automation.consentReminder, defaults.automation.consentReminder),
        reviewRequest: boolValue(automation.reviewRequest, defaults.automation.reviewRequest)
      },
      templates: templates.slice(0, 30).map((template, index) => ({
        id: textValue(template.id, `custom_sms_${index + 1}`),
        name: textValue(template.name, `SMS Template ${index + 1}`),
        enabled: boolValue(template.enabled, true),
        dltTemplateId: textValue(template.dltTemplateId, ''),
        body: textValue(template.body, '')
      })),
      alerts: {
        notifyOwnerOnFailedSms: boolValue(alerts.notifyOwnerOnFailedSms, defaults.alerts.notifyOwnerOnFailedSms),
        notifyOwnerOnLowBalance: boolValue(alerts.notifyOwnerOnLowBalance, defaults.alerts.notifyOwnerOnLowBalance),
        lowBalanceThreshold: numberValue(alerts.lowBalanceThreshold, defaults.alerts.lowBalanceThreshold)
      }
    };
  }
}
