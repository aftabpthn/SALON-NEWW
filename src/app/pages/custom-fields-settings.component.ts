import { CommonModule } from '@angular/common';
import { Component, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ApiRecord, ApiService } from '../core/api.service';
import { AuraDatePipe } from '../shared/pipes/aura-date.pipe';

type CustomFieldRow = {
  id: string;
  label: string;
  type: string;
  appliesTo: string;
  required: boolean;
  showOnline: boolean;
  active: boolean;
  optionsText: string;
};

type CustomFieldsSettingsState = {
  enabled: boolean;
  showOnPos: boolean;
  showOnBooking: boolean;
  allowStaffEdit: boolean;
  requireOwnerApprovalForRequiredFields: boolean;
  fields: CustomFieldRow[];
};

type CustomFieldsSettingsAudit = {
  lastChangedBy: string;
  lastChangedAt: string;
};

const FIELD_TYPES = ['text', 'number', 'date', 'select', 'checkbox', 'textarea'];
const APPLIES_TO = ['client', 'appointment', 'invoice', 'service', 'staff'];

const DEFAULT_SETTINGS: CustomFieldsSettingsState = {
  enabled: true,
  showOnPos: true,
  showOnBooking: false,
  allowStaffEdit: true,
  requireOwnerApprovalForRequiredFields: true,
  fields: [
    {
      id: 'client_source',
      label: 'Client Source',
      type: 'select',
      appliesTo: 'client',
      required: false,
      showOnline: false,
      active: true,
      optionsText: 'Walk-in, Instagram, Google, Referral'
    },
    {
      id: 'appointment_note',
      label: 'Appointment Note',
      type: 'textarea',
      appliesTo: 'appointment',
      required: false,
      showOnline: true,
      active: true,
      optionsText: ''
    }
  ]
};

const DEFAULT_AUDIT: CustomFieldsSettingsAudit = {
  lastChangedBy: 'Not saved yet',
  lastChangedAt: ''
};

function cloneSettings(settings: CustomFieldsSettingsState): CustomFieldsSettingsState {
  return JSON.parse(JSON.stringify(settings)) as CustomFieldsSettingsState;
}

function boolValue(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function stringValue(value: unknown, fallback: string): string {
  return String(value ?? fallback).trim() || fallback;
}

function slug(value: string, fallback: string): string {
  return (value || fallback).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 64) || fallback;
}

@Component({
  selector: 'app-custom-fields-settings',
  standalone: true,
  imports: [AuraDatePipe, CommonModule, FormsModule, RouterLink],
  template: `
    <section class="custom-fields-page inner-page-shell">
      <aside class="settings-nav" aria-label="Settings sections">
        <a routerLink="/settings/general">General Settings</a>
        <a routerLink="/settings/products">Products Settings</a>
        <a routerLink="/settings/supplier">Supplier Settings</a>
        <a routerLink="/settings/inventory">Inventory Settings</a>
        <a routerLink="/settings/services">Services Settings</a>
        <a routerLink="/settings/packages">Packages Settings</a>
        <a routerLink="/settings/membership">Membership Settings</a>
        <a class="active" routerLink="/settings/custom-fields">Custom Fields</a>
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
            <span class="eyebrow">Setup / Custom Fields</span>
            <h1>Custom Fields Settings Control</h1>
            <p>Create branch-specific custom fields for clients, appointments, invoices, services and staff records.</p>
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
        <p class="phase-note">Next phase will connect these custom fields into client records, appointment forms, invoice metadata, services and staff profiles.</p>

        <section class="audit-strip">
          <strong>Audit info</strong>
          <span>Last changed by: {{ audit.lastChangedBy || 'Not saved yet' }}</span>
          <span>Last changed time: {{ audit.lastChangedAt ? (audit.lastChangedAt | auraDate:'date') : 'Not saved yet' }}</span>
        </section>

        <section class="settings-grid inner-form-grid">
          <article class="settings-card inner-page-card">
            <h2>Custom Field Control</h2>
            <label class="switch-row"><span><strong>Custom fields enabled</strong><small>Enable custom fields across selected modules.</small></span><input type="checkbox" [(ngModel)]="settings.enabled" /><i></i></label>
            <label class="switch-row"><span><strong>Show on POS</strong><small>Allow POS and invoice screens to show relevant fields.</small></span><input type="checkbox" [(ngModel)]="settings.showOnPos" /><i></i></label>
            <label class="switch-row"><span><strong>Show on Booking</strong><small>Allow online booking to show approved fields.</small></span><input type="checkbox" [(ngModel)]="settings.showOnBooking" /><i></i></label>
            <label class="switch-row"><span><strong>Allow staff edit</strong><small>Permit staff users to edit non-restricted custom fields.</small></span><input type="checkbox" [(ngModel)]="settings.allowStaffEdit" /><i></i></label>
            <label class="switch-row"><span><strong>Owner approval for required fields</strong><small>Require owner review before required-field policy goes live.</small></span><input type="checkbox" [(ngModel)]="settings.requireOwnerApprovalForRequiredFields" /><i></i></label>
          </article>

          <article class="settings-card preview-card">
            <h2>Policy Preview</h2>
            <p>{{ activeFieldCount }} active custom field(s) configured across {{ targetSummary }}.</p>
            <p>POS display is {{ settings.showOnPos ? 'enabled' : 'disabled' }} and booking display is {{ settings.showOnBooking ? 'enabled' : 'disabled' }}.</p>
            <p>Staff editing is {{ settings.allowStaffEdit ? 'allowed' : 'blocked' }}.</p>
          </article>
        </section>

        <section class="fields-panel">
          <div class="panel-head">
            <div>
              <h2>Field Builder</h2>
              <p>Add fields, choose type, target module, required rule and online visibility.</p>
            </div>
            <button class="ghost-button" type="button" (click)="addField()">Add Field</button>
          </div>

          <div class="field-table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Field Name</th>
                  <th>Type</th>
                  <th>Applies To</th>
                  <th>Required</th>
                  <th>Display Online</th>
                  <th>Active</th>
                  <th>Options</th>
                </tr>
              </thead>
              <tbody>
                <tr *ngFor="let field of settings.fields; let i = index; trackBy: trackField">
                  <td><input [(ngModel)]="field.label" (ngModelChange)="syncFieldId(field)" /></td>
                  <td><select [(ngModel)]="field.type"><option *ngFor="let type of fieldTypes" [value]="type">{{ type }}</option></select></td>
                  <td><select [(ngModel)]="field.appliesTo"><option *ngFor="let target of appliesTo" [value]="target">{{ target }}</option></select></td>
                  <td><input type="checkbox" [(ngModel)]="field.required" /></td>
                  <td><input type="checkbox" [(ngModel)]="field.showOnline" /></td>
                  <td><input type="checkbox" [(ngModel)]="field.active" /></td>
                  <td><input [(ngModel)]="field.optionsText" placeholder="Comma options for select" /></td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
      </main>
    </section>
  `,
  styles: [`
    :host { display: block; }
    .custom-fields-page {
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
    .settings-card,
    .fields-panel {
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
    .settings-card p,
    .panel-head p {
      margin-top: 8px;
      color: var(--muted);
      font-weight: 650;
    }
    .hero-actions,
    .panel-head {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
    }
    .panel-head {
      align-items: center;
      justify-content: space-between;
      padding: 18px;
      border-bottom: 1px solid var(--line);
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
      grid-template-columns: minmax(0, .9fr) minmax(0, 1.1fr);
      gap: 16px;
    }
    .settings-card {
      display: grid;
      align-content: start;
      gap: 12px;
      min-width: 0;
      padding: 18px;
    }
    .settings-card h2,
    .fields-panel h2 {
      font-size: 16px;
      text-transform: uppercase;
      color: #506070;
    }
    .switch-row {
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
      min-height: 40px;
      border: 1px solid #cfe0d9;
      border-radius: 8px;
      padding: 0 10px;
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
      background: #f8fffc;
    }
    .field-table-wrap {
      overflow-x: auto;
      padding: 0 18px 18px;
    }
    table {
      width: 100%;
      min-width: 980px;
      border-collapse: collapse;
    }
    th,
    td {
      border-bottom: 1px solid var(--line);
      padding: 12px 10px;
      text-align: left;
      vertical-align: middle;
    }
    th {
      color: #506070;
      font-size: 12px;
      text-transform: uppercase;
    }
    td input[type="checkbox"] {
      width: 18px;
      min-height: 18px;
    }
    @media (max-width: 980px) {
      .custom-fields-page,
      .settings-grid {
        grid-template-columns: 1fr;
      }
      .custom-fields-page {
        padding: 14px;
      }
      .settings-nav {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }
      .settings-hero {
        align-items: stretch;
        flex-direction: column;
      }
    }
  `]
})
export class CustomFieldsSettingsComponent implements OnInit {
  readonly message = signal('');
  readonly error = signal('');
  readonly saving = signal(false);
  readonly fieldTypes = FIELD_TYPES;
  readonly appliesTo = APPLIES_TO;

  settings: CustomFieldsSettingsState = cloneSettings(DEFAULT_SETTINGS);
  audit: CustomFieldsSettingsAudit = { ...DEFAULT_AUDIT };

  constructor(private readonly api: ApiService) {}

  get activeFieldCount(): number {
    return this.settings.fields.filter((field) => field.active).length;
  }

  get targetSummary(): string {
    const targets = Array.from(new Set(this.settings.fields.filter((field) => field.active).map((field) => field.appliesTo)));
    return targets.length ? targets.join(', ') : 'no modules';
  }

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.error.set('');
    this.message.set('');
    this.api.list<{ settings?: ApiRecord; audit?: CustomFieldsSettingsAudit }>('settings/custom-fields').subscribe({
      next: (response) => {
        this.settings = this.normalizeSettings(response.settings || {});
        this.audit = this.normalizeAudit(response.audit);
      },
      error: () => {
        this.settings = cloneSettings(DEFAULT_SETTINGS);
        this.audit = { ...DEFAULT_AUDIT };
        this.error.set('Unable to load custom fields settings');
      }
    });
  }

  save(): void {
    this.saving.set(true);
    this.error.set('');
    this.message.set('');
    const settings = this.normalizeSettings(this.settings);
    this.api.put<{ settings?: ApiRecord; audit?: CustomFieldsSettingsAudit }>('settings/custom-fields', { settings }).subscribe({
      next: (response) => {
        this.settings = this.normalizeSettings(response.settings || settings);
        this.audit = this.normalizeAudit(response.audit);
        this.message.set('Custom fields settings saved.');
        this.saving.set(false);
        window.setTimeout(() => this.message.set(''), 2500);
      },
      error: () => {
        this.error.set('Unable to save custom fields settings');
        this.saving.set(false);
      }
    });
  }

  addField(): void {
    const index = this.settings.fields.length + 1;
    this.settings.fields = [
      ...this.settings.fields,
      {
        id: `custom_field_${index}`,
        label: `Custom Field ${index}`,
        type: 'text',
        appliesTo: 'client',
        required: false,
        showOnline: false,
        active: true,
        optionsText: ''
      }
    ];
  }

  syncFieldId(field: CustomFieldRow): void {
    field.id = slug(field.label, field.id || 'custom_field');
  }

  trackField(_index: number, field: CustomFieldRow): string {
    return field.id;
  }

  private normalizeSettings(input: Partial<CustomFieldsSettingsState> | ApiRecord): CustomFieldsSettingsState {
    const record = input as Partial<CustomFieldsSettingsState>;
    const fields = Array.isArray(record.fields) ? record.fields : DEFAULT_SETTINGS.fields;
    return {
      enabled: boolValue(record.enabled, DEFAULT_SETTINGS.enabled),
      showOnPos: boolValue(record.showOnPos, DEFAULT_SETTINGS.showOnPos),
      showOnBooking: boolValue(record.showOnBooking, DEFAULT_SETTINGS.showOnBooking),
      allowStaffEdit: boolValue(record.allowStaffEdit, DEFAULT_SETTINGS.allowStaffEdit),
      requireOwnerApprovalForRequiredFields: boolValue(record.requireOwnerApprovalForRequiredFields, DEFAULT_SETTINGS.requireOwnerApprovalForRequiredFields),
      fields: fields.slice(0, 50).map((field, index) => this.normalizeField(field as Partial<CustomFieldRow>, index))
    };
  }

  private normalizeField(input: Partial<CustomFieldRow>, index: number): CustomFieldRow {
    const label = stringValue(input.label, `Custom Field ${index + 1}`);
    return {
      id: slug(stringValue(input.id, label), `custom_field_${index + 1}`),
      label,
      type: FIELD_TYPES.includes(String(input.type)) ? String(input.type) : 'text',
      appliesTo: APPLIES_TO.includes(String(input.appliesTo)) ? String(input.appliesTo) : 'client',
      required: boolValue(input.required, false),
      showOnline: boolValue(input.showOnline, false),
      active: boolValue(input.active, true),
      optionsText: stringValue(input.optionsText, '')
    };
  }

  private normalizeAudit(input?: Partial<CustomFieldsSettingsAudit>): CustomFieldsSettingsAudit {
    return {
      lastChangedBy: stringValue(input?.lastChangedBy, DEFAULT_AUDIT.lastChangedBy),
      lastChangedAt: stringValue(input?.lastChangedAt, DEFAULT_AUDIT.lastChangedAt)
    };
  }
}
