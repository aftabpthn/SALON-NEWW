import { CommonModule } from '@angular/common';
import { Component, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ApiRecord, ApiService } from '../core/api.service';

type BoolMap = Record<string, boolean>;
type TextMap = Record<string, string>;

type BillSettingsState = {
  common: {
    feedback: BoolMap;
    print: BoolMap;
    invoice: BoolMap;
    messages: TextMap;
    room: TextMap;
  };
  terms: {
    showTermsOnShortPrint: boolean;
    items: string[];
  };
  dualLanguage: {
    english: TextMap;
    other: TextMap;
  };
};

type ToggleItem = {
  key: string;
  label: string;
};

type TextItem = {
  key: string;
  label: string;
  placeholder?: string;
};

const DEFAULT_SETTINGS: BillSettingsState = {
  common: {
    feedback: {
      showBill: true,
      showFeedbackLink: true,
      showInvoiceLink: true
    },
    print: {
      shortPrint: false,
      a4Print: true
    },
    invoice: {
      headerIncludingLogo: true,
      businessName: true,
      invoiceId: true,
      dateTime: true,
      paymentMethod: true,
      displayStaff: true,
      displayTime: true,
      showAppointmentTime: true,
      displayEwalletBalance: true,
      displayPendingServices: true,
      showClientName: true,
      showClientContactNumber: true,
      showDiscount: true,
      showBillNotes: true,
      showDownloadInvoiceButton: true,
      showSignature: true,
      showPackageOfferPrice: true
    },
    messages: {
      heading: 'INVOICE',
      invoiceNumberPrefix: '',
      thanksMessage: 'Thank You For Visiting S.Sense Salon',
      poweredBy: 'S.Sense Salon'
    },
    room: {
      roomHeading: ''
    }
  },
  terms: {
    showTermsOnShortPrint: true,
    items: ['']
  },
  dualLanguage: {
    english: {
      salonName: 'S.SENSE SALON',
      email: '',
      contact: '',
      address: '',
      thanksMessage: 'Thank You For Visiting S.Sense Salon',
      poweredBy: 'S.Sense Salon',
      extraText1: 'Have a Great Day.',
      extraText2: 'Visit Again',
      taxInvoiceText: '',
      gstinLabel: 'GSTIN',
      dateLabel: 'Date',
      invoiceIdLabel: 'Invoice ID',
      customerNameLabel: 'Customer Name',
      customerContactLabel: 'Customer Contact',
      servicesLabel: 'Services',
      qtyLabel: 'Qty',
      priceLabel: 'Price',
      discountLabel: 'Discount',
      totalLabel: 'Total',
      productLabel: 'Product',
      packageLabel: 'Package',
      membershipLabel: 'Membership',
      validLabel: 'Valid',
      staffLabel: 'Staff',
      paidLabel: 'Paid',
      dueLabel: 'Due'
    },
    other: {
      salonName: '',
      email: '',
      contact: '',
      address: '',
      thanksMessage: '',
      poweredBy: '',
      extraText1: '',
      extraText2: '',
      taxInvoiceText: '',
      gstinLabel: '',
      dateLabel: '',
      invoiceIdLabel: '',
      customerNameLabel: '',
      customerContactLabel: '',
      servicesLabel: '',
      qtyLabel: '',
      priceLabel: '',
      discountLabel: '',
      totalLabel: '',
      productLabel: '',
      packageLabel: '',
      membershipLabel: '',
      validLabel: '',
      staffLabel: '',
      paidLabel: '',
      dueLabel: ''
    }
  }
};

const FEEDBACK_TOGGLES: ToggleItem[] = [
  { key: 'showBill', label: 'Show Bill' },
  { key: 'showFeedbackLink', label: 'Show Feedback Link' },
  { key: 'showInvoiceLink', label: 'Show Invoice Link' }
];

const PRINT_TOGGLES: ToggleItem[] = [
  { key: 'shortPrint', label: 'Short Print' },
  { key: 'a4Print', label: 'A4 Print' }
];

const INVOICE_TOGGLES: ToggleItem[] = [
  { key: 'headerIncludingLogo', label: 'Header Including Logo' },
  { key: 'businessName', label: 'Business Name' },
  { key: 'invoiceId', label: 'Invoice Id' },
  { key: 'dateTime', label: 'Date & Time' },
  { key: 'paymentMethod', label: 'Payment Method' },
  { key: 'displayStaff', label: 'Display Staff' },
  { key: 'displayTime', label: 'Display Time' },
  { key: 'showAppointmentTime', label: 'Show Appointment Time' },
  { key: 'displayEwalletBalance', label: 'Display Ewallet Balance' },
  { key: 'displayPendingServices', label: 'Display Pending Services' },
  { key: 'showClientName', label: 'Show Client Name' },
  { key: 'showClientContactNumber', label: 'Show Client Contact Number' },
  { key: 'showDiscount', label: 'Show Discount' },
  { key: 'showBillNotes', label: 'Show Bill Notes' },
  { key: 'showDownloadInvoiceButton', label: 'Show Download Invoice Button' },
  { key: 'showSignature', label: 'Show Signature' },
  { key: 'showPackageOfferPrice', label: 'Show Package offer Price' }
];

const MESSAGE_FIELDS: TextItem[] = [
  { key: 'heading', label: 'Heading' },
  { key: 'invoiceNumberPrefix', label: 'Invoice Number Prefix' },
  { key: 'thanksMessage', label: 'Thanks Message' },
  { key: 'poweredBy', label: 'Powered By' }
];

const ROOM_FIELDS: TextItem[] = [
  { key: 'roomHeading', label: 'Room Heading' }
];

const LANGUAGE_FIELDS: TextItem[] = [
  { key: 'salonName', label: 'Salon Name' },
  { key: 'gstinLabel', label: 'GSTIN Label' },
  { key: 'servicesLabel', label: 'Services Label' },
  { key: 'email', label: 'Email' },
  { key: 'dateLabel', label: 'Date Label' },
  { key: 'qtyLabel', label: 'Qty Label' },
  { key: 'contact', label: 'Contact' },
  { key: 'invoiceIdLabel', label: 'Invoice ID Label' },
  { key: 'priceLabel', label: 'Price Label' },
  { key: 'address', label: 'Address' },
  { key: 'customerNameLabel', label: 'Customer Name Label' },
  { key: 'discountLabel', label: 'Discount Label' },
  { key: 'thanksMessage', label: 'Thanks Message' },
  { key: 'customerContactLabel', label: 'Customer Contact Label' },
  { key: 'totalLabel', label: 'Total Label' },
  { key: 'poweredBy', label: 'Powered By' },
  { key: 'productLabel', label: 'Product Label' },
  { key: 'packageLabel', label: 'Package Label' },
  { key: 'extraText1', label: 'Extra Text 1' },
  { key: 'membershipLabel', label: 'Membership Label' },
  { key: 'validLabel', label: 'Valid Label' },
  { key: 'extraText2', label: 'Extra Text 2' },
  { key: 'staffLabel', label: 'Staff Label' },
  { key: 'paidLabel', label: 'Paid Label' },
  { key: 'taxInvoiceText', label: 'Tax Invoice Text' },
  { key: 'dueLabel', label: 'Due Label' }
];

function cloneSettings(settings: BillSettingsState): BillSettingsState {
  return JSON.parse(JSON.stringify(settings)) as BillSettingsState;
}

function mergeTextMap(input: unknown, defaults: TextMap): TextMap {
  const source = (input || {}) as TextMap;
  return Object.fromEntries(Object.keys(defaults).map((key) => [key, String(source[key] ?? defaults[key] ?? '')]));
}

function mergeBoolMap(input: unknown, defaults: BoolMap): BoolMap {
  const source = (input || {}) as BoolMap;
  return Object.fromEntries(Object.entries(defaults).map(([key, fallback]) => [key, typeof source[key] === 'boolean' ? source[key] : fallback]));
}

@Component({
  selector: 'app-bill-settings',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  template: `
    <section class="bill-settings-page inner-page-shell">
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
        <a class="active" routerLink="/settings/bill-setting">Bill Settings</a>
        <a routerLink="/settings/business-details">Business Details</a>
      <a routerLink="/settings/payment-methods">Payment Methods</a>
      <a routerLink="/settings/message-history">Message History</a>
      <a routerLink="/settings/sms-template">SMS Template</a>
      <a routerLink="/settings/security">Security</a>
      </aside>

      <main class="settings-content">
        <header class="settings-hero inner-page-header">
          <div>
            <span class="eyebrow">Setup / Invoice</span>
            <h1>Bill Settings Control</h1>
            <p>Control invoice layout, print options, terms, messages and dual-language bill labels.</p>
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
        <p class="phase-note">Next phase will connect these saved settings to POS invoice print, A4 print, short print and downloaded invoices.</p>

        <nav class="tab-row" aria-label="Bill settings tabs">
          <button type="button" [class.active]="activeTab() === 'common'" (click)="activeTab.set('common')">Common Setting</button>
          <button type="button" [class.active]="activeTab() === 'terms'" (click)="activeTab.set('terms')">Terms & Conditions</button>
          <button type="button" [class.active]="activeTab() === 'language'" (click)="activeTab.set('language')">Dual Invoice Language</button>
        </nav>

        <section *ngIf="activeTab() === 'common'" class="common-grid">
          <div class="side-stack">
            <article class="settings-card inner-page-card">
              <h2>Feedback Setting</h2>
              <label class="toggle-row" *ngFor="let item of feedbackToggles">
                <span>{{ item.label }}</span>
                <input type="checkbox" [ngModel]="settings.common.feedback[item.key]" (ngModelChange)="setBool('feedback', item.key, $event)" />
                <i aria-hidden="true"></i>
              </label>
            </article>

            <article class="settings-card inner-page-card">
              <h2>Print Setting</h2>
              <label class="toggle-row" *ngFor="let item of printToggles">
                <span>{{ item.label }}</span>
                <input type="checkbox" [ngModel]="settings.common.print[item.key]" (ngModelChange)="setBool('print', item.key, $event)" />
                <i aria-hidden="true"></i>
              </label>
            </article>
          </div>

          <article class="settings-card invoice-card">
            <h2>Invoice Settings</h2>
            <label class="toggle-row" *ngFor="let item of invoiceToggles">
              <span>{{ item.label }}</span>
              <input type="checkbox" [ngModel]="settings.common.invoice[item.key]" (ngModelChange)="setBool('invoice', item.key, $event)" />
              <i aria-hidden="true"></i>
            </label>
          </article>

          <div class="side-stack">
            <article class="settings-card input-card">
              <h2>Invoice Messages</h2>
              <label class="field-row" *ngFor="let item of messageFields">
                <span>{{ item.label }}</span>
                <input type="text" [(ngModel)]="settings.common.messages[item.key]" />
              </label>
            </article>

            <article class="settings-card input-card">
              <h2>Room Setting</h2>
              <label class="field-row" *ngFor="let item of roomFields">
                <span>{{ item.label }}</span>
                <input type="text" [(ngModel)]="settings.common.room[item.key]" />
              </label>
            </article>
          </div>
        </section>

        <section *ngIf="activeTab() === 'terms'" class="terms-panel">
          <label class="terms-toggle">
            <input type="checkbox" [(ngModel)]="settings.terms.showTermsOnShortPrint" />
            <i aria-hidden="true"></i>
            <span>Show terms on short print?</span>
          </label>

          <div class="terms-list">
            <article class="term-row" *ngFor="let term of settings.terms.items; let i = index; trackBy: trackByIndex">
              <span>Term</span>
              <textarea [(ngModel)]="settings.terms.items[i]" rows="2" placeholder="Enter invoice term or condition"></textarea>
              <button class="icon-button danger" type="button" *ngIf="settings.terms.items.length > 1" (click)="removeTerm(i)">Remove</button>
            </article>
          </div>

          <div class="term-actions">
            <button class="dark-button" type="button" (click)="addTerm()">Add More +</button>
            <button class="primary-button" type="button" (click)="save()" [disabled]="saving()">Save</button>
          </div>
        </section>

        <section *ngIf="activeTab() === 'language'" class="language-panel">
          <article class="language-card">
            <h2>English Language</h2>
            <div class="language-grid">
              <label class="field-row" *ngFor="let item of languageFields">
                <span>{{ item.label }}</span>
                <input type="text" [(ngModel)]="settings.dualLanguage.english[item.key]" />
              </label>
            </div>
          </article>

          <article class="language-card">
            <h2>Other Language</h2>
            <div class="language-grid">
              <label class="field-row" *ngFor="let item of languageFields">
                <span>{{ item.label }}</span>
                <input type="text" [(ngModel)]="settings.dualLanguage.other[item.key]" />
              </label>
            </div>
          </article>
        </section>
      </main>
    </section>
  `,
  styles: [`
    :host { display: block; color: #001b3a; }
    .bill-settings-page {
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
    .settings-content {
      display: grid;
      gap: 16px;
      min-width: 0;
    }
    .settings-hero,
    .settings-card,
    .terms-panel,
    .language-card {
      background: #fff;
      border: 1px solid #d8e6df;
      border-radius: 16px;
      box-shadow: 0 22px 48px rgba(0, 27, 58, 0.07);
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
    h1 {
      font-size: 40px;
      line-height: 1.1;
      letter-spacing: 0;
      margin-bottom: 10px;
    }
    h2 {
      font-size: 16px;
      padding: 18px 20px;
      border-bottom: 1px solid #e2ebe7;
    }
    .settings-hero p,
    .phase-note {
      color: #52655f;
      font-size: 15px;
      line-height: 1.5;
    }
    .hero-actions,
    .term-actions {
      display: flex;
      align-items: center;
      gap: 10px;
      flex-wrap: wrap;
    }
    button {
      border: 0;
      cursor: pointer;
      font: inherit;
      font-weight: 900;
    }
    .primary-button,
    .ghost-button,
    .dark-button,
    .icon-button {
      min-height: 46px;
      border-radius: 10px;
      padding: 0 18px;
    }
    .primary-button {
      color: #fff;
      background: #07966f;
      box-shadow: 0 16px 32px rgba(7, 150, 111, 0.18);
    }
    .primary-button:disabled {
      opacity: 0.6;
      cursor: wait;
    }
    .ghost-button,
    .icon-button {
      color: #0f2235;
      background: #fff;
      border: 1px solid #d8e6df;
    }
    .dark-button {
      color: #fff;
      background: #242833;
    }
    .icon-button.danger {
      color: #b42318;
      border-color: #ffd2cc;
      background: #fff7f5;
    }
    .state,
    .phase-note {
      padding: 12px 14px;
      border-radius: 10px;
      font-weight: 800;
    }
    .state.success {
      color: #006344;
      background: #e4fff2;
      border: 1px solid #9de8c4;
    }
    .state.danger {
      color: #b42318;
      background: #fff0ee;
      border: 1px solid #ffcdc7;
    }
    .phase-note {
      color: #8a5a00;
      background: #fff8e7;
      border: 1px solid #ffd275;
    }
    .tab-row {
      display: flex;
      flex-wrap: wrap;
      gap: 12px;
      padding: 14px;
      background: #fff;
      border: 1px solid #d8e6df;
      border-radius: 16px;
    }
    .tab-row button {
      min-height: 46px;
      padding: 0 20px;
      border-radius: 10px;
      color: #526b84;
      background: #f0f2f4;
    }
    .tab-row button.active {
      color: #fff;
      background: #242833;
    }
    .common-grid {
      display: grid;
      grid-template-columns: minmax(220px, 1fr) minmax(300px, 1.15fr) minmax(260px, 1fr);
      gap: 16px;
      align-items: start;
      min-width: 0;
    }
    .side-stack {
      display: grid;
      gap: 16px;
      min-width: 0;
    }
    .toggle-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 14px;
      min-height: 64px;
      padding: 12px 16px;
      border-bottom: 1px solid #e6eeeb;
      font-size: 16px;
    }
    .toggle-row:last-child {
      border-bottom: 0;
    }
    .toggle-row input,
    .terms-toggle input {
      position: absolute;
      opacity: 0;
      pointer-events: none;
    }
    .toggle-row i,
    .terms-toggle i {
      position: relative;
      width: 58px;
      height: 30px;
      flex: 0 0 auto;
      border-radius: 999px;
      background: #c6cbd0;
      transition: background 0.16s ease;
    }
    .toggle-row i::after,
    .terms-toggle i::after {
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
    .toggle-row input:checked + i,
    .terms-toggle input:checked + i {
      background: #20242b;
    }
    .toggle-row input:checked + i::after,
    .terms-toggle input:checked + i::after {
      transform: translateX(26px);
    }
    .field-row {
      display: grid;
      gap: 8px;
      min-width: 0;
      padding: 14px 16px;
      border-bottom: 1px solid #edf2f0;
    }
    .field-row:last-child {
      border-bottom: 0;
    }
    .field-row span {
      font-weight: 700;
    }
    input[type="text"],
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
    textarea {
      resize: vertical;
    }
    .terms-panel {
      min-height: 520px;
      padding: 22px;
      display: grid;
      gap: 24px;
    }
    .terms-toggle {
      display: flex;
      align-items: center;
      gap: 12px;
      font-size: 16px;
    }
    .terms-list {
      display: grid;
      gap: 14px;
    }
    .term-row {
      display: grid;
      grid-template-columns: 150px minmax(0, 1fr) auto;
      gap: 0;
      align-items: stretch;
      border: 1px solid #e1e7e4;
      border-radius: 12px;
      overflow: hidden;
      background: #f7f8f8;
    }
    .term-row > span {
      display: grid;
      place-items: center;
      color: #fff;
      background: #242833;
      font-weight: 900;
    }
    .term-row textarea {
      min-height: 72px;
      border: 0;
      border-radius: 0;
      background: #f7f8f8;
    }
    .term-row button {
      border-radius: 0;
      min-height: auto;
    }
    .term-actions {
      justify-content: space-between;
      margin-top: auto;
    }
    .language-panel {
      display: grid;
      gap: 18px;
      min-width: 0;
    }
    .language-card {
      overflow-x: auto;
    }
    .language-grid {
      display: grid;
      grid-template-columns: repeat(3, minmax(220px, 1fr));
      min-width: 760px;
    }
    @media (max-width: 1100px) {
      .bill-settings-page {
        grid-template-columns: 1fr;
      }
      .settings-nav {
        position: static;
        grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
      }
      .common-grid {
        grid-template-columns: 1fr;
      }
      h1 {
        font-size: 32px;
      }
    }
    @media (max-width: 700px) {
      .bill-settings-page {
        padding: 12px;
      }
      .settings-hero {
        align-items: stretch;
        flex-direction: column;
        padding: 20px;
      }
      .term-row {
        grid-template-columns: 1fr;
      }
      .term-row > span {
        min-height: 48px;
      }
    }
  `]
})
export class BillSettingsComponent implements OnInit {
  readonly feedbackToggles = FEEDBACK_TOGGLES;
  readonly printToggles = PRINT_TOGGLES;
  readonly invoiceToggles = INVOICE_TOGGLES;
  readonly messageFields = MESSAGE_FIELDS;
  readonly roomFields = ROOM_FIELDS;
  readonly languageFields = LANGUAGE_FIELDS;

  activeTab = signal<'common' | 'terms' | 'language'>('common');
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
    this.api.list<{ settings?: ApiRecord }>('settings/bill-setting').subscribe({
      next: (result) => {
        this.settings = this.normalize(result.settings);
      },
      error: (err) => {
        this.error.set(err?.error?.message || err?.message || 'Unable to load bill settings');
        this.settings = cloneSettings(DEFAULT_SETTINGS);
      }
    });
  }

  save(): void {
    this.saving.set(true);
    this.error.set('');
    this.message.set('');
    const settings = this.normalize(this.settings);
    this.api.put<{ settings?: ApiRecord }>('settings/bill-setting', { settings }).subscribe({
      next: (result) => {
        this.settings = this.normalize(result.settings || settings);
        this.message.set('Bill settings saved');
        this.saving.set(false);
      },
      error: (err) => {
        this.error.set(err?.error?.message || err?.message || 'Unable to save bill settings');
        this.saving.set(false);
      }
    });
  }

  setBool(group: 'feedback' | 'print' | 'invoice', key: string, value: boolean): void {
    this.settings.common[group][key] = Boolean(value);
  }

  addTerm(): void {
    this.settings.terms.items = [...this.settings.terms.items, ''];
  }

  removeTerm(index: number): void {
    this.settings.terms.items = this.settings.terms.items.filter((_, itemIndex) => itemIndex !== index);
    if (!this.settings.terms.items.length) this.settings.terms.items = [''];
  }

  trackByIndex(index: number): number {
    return index;
  }

  private normalize(input: unknown): BillSettingsState {
    const source = (input || {}) as BillSettingsState;
    const common = source.common || DEFAULT_SETTINGS.common;
    const terms = source.terms || DEFAULT_SETTINGS.terms;
    const dualLanguage = source.dualLanguage || DEFAULT_SETTINGS.dualLanguage;

    return {
      common: {
        feedback: mergeBoolMap(common.feedback, DEFAULT_SETTINGS.common.feedback),
        print: mergeBoolMap(common.print, DEFAULT_SETTINGS.common.print),
        invoice: mergeBoolMap(common.invoice, DEFAULT_SETTINGS.common.invoice),
        messages: mergeTextMap(common.messages, DEFAULT_SETTINGS.common.messages),
        room: mergeTextMap(common.room, DEFAULT_SETTINGS.common.room)
      },
      terms: {
        showTermsOnShortPrint: typeof terms.showTermsOnShortPrint === 'boolean'
          ? terms.showTermsOnShortPrint
          : DEFAULT_SETTINGS.terms.showTermsOnShortPrint,
        items: Array.isArray(terms.items) && terms.items.length ? terms.items.map((item) => String(item ?? '')) : ['']
      },
      dualLanguage: {
        english: mergeTextMap(dualLanguage.english, DEFAULT_SETTINGS.dualLanguage.english),
        other: mergeTextMap(dualLanguage.other, DEFAULT_SETTINGS.dualLanguage.other)
      }
    };
  }
}
