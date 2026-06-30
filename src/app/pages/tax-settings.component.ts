import { CommonModule, CurrencyPipe, DecimalPipe } from '@angular/common';
import { Component, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ApiRecord, ApiService } from '../core/api.service';

type TaxSettingsState = {
  country: string;
  countryLabel: string;
  stateProvince: string;
  taxType: string;
  registrationLabel: string;
  registrationNumber: string;
  serviceTaxEnabled: boolean;
  productTaxApplicable: boolean;
  taxEditableOnPos: boolean;
  serviceTaxRate: number;
  productTaxRate: number;
  serviceTaxMode: string;
  productTaxMode: string;
  billLabel: string;
  billValue: string;
  debitCreditFeesEnabled: boolean;
  debitCreditFeesLabel: string;
  debitCreditFeesValue: number;
  defaultApplyMode: string;
};

type TaxPreset = Pick<TaxSettingsState, 'country' | 'countryLabel' | 'taxType' | 'registrationLabel' | 'serviceTaxRate' | 'productTaxRate' | 'serviceTaxMode' | 'productTaxMode'>;

const TAX_PRESETS: Record<string, TaxPreset> = {
  IN: { country: 'IN', countryLabel: 'India', taxType: 'GST', registrationLabel: 'GSTIN', serviceTaxRate: 18, productTaxRate: 18, serviceTaxMode: 'Including', productTaxMode: 'Excluding' },
  AE: { country: 'AE', countryLabel: 'UAE', taxType: 'VAT', registrationLabel: 'TRN', serviceTaxRate: 5, productTaxRate: 5, serviceTaxMode: 'Excluding', productTaxMode: 'Excluding' },
  US: { country: 'US', countryLabel: 'United States', taxType: 'Sales Tax', registrationLabel: 'Tax ID / EIN', serviceTaxRate: 0, productTaxRate: 0, serviceTaxMode: 'Excluding', productTaxMode: 'Excluding' },
  UK: { country: 'UK', countryLabel: 'United Kingdom', taxType: 'VAT', registrationLabel: 'VAT No', serviceTaxRate: 20, productTaxRate: 20, serviceTaxMode: 'Excluding', productTaxMode: 'Excluding' },
  EU: { country: 'EU', countryLabel: 'European Union', taxType: 'VAT', registrationLabel: 'VAT No', serviceTaxRate: 20, productTaxRate: 20, serviceTaxMode: 'Excluding', productTaxMode: 'Excluding' }
};

const DEFAULT_SETTINGS: TaxSettingsState = {
  ...TAX_PRESETS.IN,
  stateProvince: '',
  registrationNumber: '',
  serviceTaxEnabled: true,
  productTaxApplicable: true,
  taxEditableOnPos: true,
  billLabel: 'CIN NO.',
  billValue: '',
  debitCreditFeesEnabled: false,
  debitCreditFeesLabel: '',
  debitCreditFeesValue: 0,
  defaultApplyMode: 'newOnly'
};

@Component({
  selector: 'app-tax-settings',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, CurrencyPipe, DecimalPipe],
  template: `
    <section class="tax-settings-page">
      <aside class="settings-nav" aria-label="Settings sections">
        <a routerLink="/settings">General Settings</a>
        <a routerLink="/setting/calendar">Calendar Settings</a>
        <a routerLink="/settings/clients/custom-form">Clients - Custom Form</a>
        <a class="active" routerLink="/settings/taxes">Tax Settings</a>
        <a routerLink="/settings/marketplace">Marketplace Settings</a>
        <a routerLink="/business-details">Business Details</a>
        <a routerLink="/pos/payment-modes">Payment Methods</a>
        <a routerLink="/message-logs">Message History</a>
        <a routerLink="/security">Security</a>
      </aside>

      <main class="settings-content">
        <header class="settings-hero">
          <div>
            <span class="eyebrow">Setup / Point of Sale</span>
            <h1>Tax Settings</h1>
            <p>Setup default taxes for your business. Defaults can still be overridden on individual products and services.</p>
          </div>
          <div class="hero-actions">
            <button class="ghost-button" type="button" (click)="load()">Refresh</button>
            <button class="primary-button" type="button" (click)="save()" [disabled]="saving()">{{ saving() ? 'Saving...' : 'Save' }}</button>
          </div>
        </header>

        <p class="state success" *ngIf="message()">{{ message() }}</p>
        <p class="state danger" *ngIf="error()">{{ error() }}</p>
        <p class="tax-warning">Tax rates can vary by state/category. Verify before applying.</p>

        <section class="settings-section profile-section">
          <div class="section-intro">
            <h2>Country & Tax Profile</h2>
            <p>Choose the branch tax country and then edit local tax details as needed.</p>
          </div>
          <div class="form-grid three">
            <label class="field">
              <span>Country</span>
              <select [ngModel]="settings.country" (ngModelChange)="onCountryChange($event)">
                <option *ngFor="let item of countryOptions" [value]="item.country">{{ item.countryLabel }}</option>
              </select>
            </label>
            <label class="field">
              <span>State/Province</span>
              <input [(ngModel)]="settings.stateProvince" placeholder="State, province, emirate" />
            </label>
            <label class="field">
              <span>Tax Type</span>
              <input [(ngModel)]="settings.taxType" />
            </label>
            <label class="field">
              <span>Registration Label</span>
              <input [(ngModel)]="settings.registrationLabel" />
            </label>
            <label class="field">
              <span>Registration Number</span>
              <input [(ngModel)]="settings.registrationNumber" placeholder="GSTIN, TRN, VAT No" />
            </label>
            <label class="switch-card compact">
              <span>
                <strong>Tax editable on POS</strong>
                <small>Allow billing staff to override tax while invoicing.</small>
              </span>
              <input type="checkbox" [(ngModel)]="settings.taxEditableOnPos" />
              <i aria-hidden="true"></i>
            </label>
          </div>
        </section>

        <section class="settings-grid">
          <article class="settings-section">
            <div class="section-intro">
              <h2>Service Tax</h2>
              <p>Default service tax used for new services and POS service billing.</p>
            </div>
            <label class="switch-card">
              <span>
                <strong>Service Tax</strong>
                <small>Apply tax on service sales.</small>
              </span>
              <input type="checkbox" [(ngModel)]="settings.serviceTaxEnabled" />
              <i aria-hidden="true"></i>
            </label>
            <div class="form-grid two">
              <label class="field">
                <span>Service Tax %</span>
                <input type="number" min="0" max="100" step="0.01" [(ngModel)]="settings.serviceTaxRate" />
              </label>
              <label class="field">
                <span>Service tax including/excluding</span>
                <select [(ngModel)]="settings.serviceTaxMode">
                  <option>Including</option>
                  <option>Excluding</option>
                </select>
              </label>
            </div>
          </article>

          <article class="settings-section">
            <div class="section-intro">
              <h2>Product Tax</h2>
              <p>Default product tax used for new products and retail billing.</p>
            </div>
            <label class="switch-card">
              <span>
                <strong>Product tax applicable</strong>
                <small>Apply tax on product sales.</small>
              </span>
              <input type="checkbox" [(ngModel)]="settings.productTaxApplicable" />
              <i aria-hidden="true"></i>
            </label>
            <div class="form-grid two">
              <label class="field">
                <span>Product Tax %</span>
                <input type="number" min="0" max="100" step="0.01" [(ngModel)]="settings.productTaxRate" />
              </label>
              <label class="field">
                <span>Product tax including/excluding</span>
                <select [(ngModel)]="settings.productTaxMode">
                  <option>Including</option>
                  <option>Excluding</option>
                </select>
              </label>
            </div>
          </article>

          <article class="settings-section">
            <div class="section-intro">
              <h2>Bill Settings</h2>
              <p>Add a custom tax/compliance label on printed invoices.</p>
            </div>
            <div class="form-grid two">
              <label class="field">
                <span>Bill Label</span>
                <input [(ngModel)]="settings.billLabel" />
              </label>
              <label class="field">
                <span>Bill Value</span>
                <input [(ngModel)]="settings.billValue" />
              </label>
            </div>
          </article>

          <article class="settings-section">
            <div class="section-intro">
              <h2>Debit / Credit Fees</h2>
              <p>Configure optional extra charges on card payments.</p>
            </div>
            <label class="switch-card">
              <span>
                <strong>Debit/Credit Fees</strong>
                <small>Apply extra charges on card payments.</small>
              </span>
              <input type="checkbox" [(ngModel)]="settings.debitCreditFeesEnabled" />
              <i aria-hidden="true"></i>
            </label>
            <div class="form-grid two">
              <label class="field">
                <span>Debit/Credit fees label</span>
                <input [(ngModel)]="settings.debitCreditFeesLabel" />
              </label>
              <label class="field">
                <span>Debit/Credit fees value %</span>
                <input type="number" min="0" max="100" step="0.01" [(ngModel)]="settings.debitCreditFeesValue" />
              </label>
            </div>
          </article>
        </section>

        <section class="settings-section preview-section">
          <div class="section-intro">
            <h2>Invoice Preview</h2>
            <p>Preview how default service and product tax settings affect a sample invoice.</p>
          </div>
          <div class="preview-grid">
            <article>
              <span>Sample service</span>
              <strong>{{ previewServiceTotal() | currency:'INR':'symbol':'1.0-2' }}</strong>
              <small>{{ settings.serviceTaxRate | number:'1.0-2' }}% {{ settings.taxType }} · {{ settings.serviceTaxMode }}</small>
            </article>
            <article>
              <span>Sample product</span>
              <strong>{{ previewProductTotal() | currency:'INR':'symbol':'1.0-2' }}</strong>
              <small>{{ settings.productTaxRate | number:'1.0-2' }}% {{ settings.taxType }} · {{ settings.productTaxMode }}</small>
            </article>
            <article>
              <span>{{ settings.registrationLabel }}</span>
              <strong>{{ settings.registrationNumber || 'Not set' }}</strong>
              <small>{{ settings.countryLabel }} {{ settings.stateProvince || '' }}</small>
            </article>
          </div>
        </section>

        <section class="settings-section apply-section">
          <div class="section-intro">
            <h2>Apply Defaults</h2>
            <p>Choose how saved tax settings should be used. Existing records are not changed in this phase.</p>
          </div>
          <div class="apply-options">
            <label class="radio-card">
              <input type="radio" name="defaultApplyMode" value="newOnly" [(ngModel)]="settings.defaultApplyMode" />
              <span>
                <strong>Use for new services/products</strong>
                <small>Only new items will use these defaults.</small>
              </span>
            </label>
            <label class="radio-card">
              <input type="radio" name="defaultApplyMode" value="existingLater" [(ngModel)]="settings.defaultApplyMode" />
              <span>
                <strong>Apply to existing services/products later</strong>
                <small>Keep a preview-style setting for a later bulk update workflow.</small>
              </span>
            </label>
          </div>
        </section>
      </main>
    </section>
  `,
  styles: [`
    .tax-settings-page { display: grid; grid-template-columns: 220px minmax(0, 1fr); gap: 18px; padding: 20px; background: #f6f8f7; min-height: calc(100vh - 74px); color: var(--ink); }
    .settings-nav { position: sticky; top: 90px; align-self: start; display: grid; gap: 6px; padding: 14px; border-radius: 8px; background: #fff; border: 1px solid var(--line); }
    .settings-nav a { color: var(--ink); text-decoration: none; font-weight: 850; padding: 10px 12px; border-radius: 6px; }
    .settings-nav a.active, .settings-nav a:hover { background: #e8fbf3; color: #047857; }
    .settings-content { display: grid; gap: 18px; min-width: 0; }
    .settings-hero, .settings-section { background: #fff; border: 1px solid var(--line); border-radius: 8px; box-shadow: var(--shadow-soft); }
    .settings-hero { display: flex; justify-content: space-between; gap: 18px; align-items: center; padding: 22px 24px; }
    .settings-hero h1, .section-intro h2 { margin: 0; color: var(--ink); letter-spacing: 0; }
    .settings-hero h1 { font-size: 30px; line-height: 1.12; }
    .settings-hero p, .section-intro p, .switch-card small, .radio-card small { margin: 6px 0 0; color: var(--muted); font-weight: 650; line-height: 1.45; }
    .hero-actions { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; justify-content: flex-end; }
    .tax-warning { margin: 0; padding: 12px 14px; border: 1px solid #fde68a; border-radius: 8px; background: #fffbeb; color: #92400e; font-weight: 850; }
    .settings-section { padding: 22px; display: grid; gap: 16px; }
    .settings-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 18px; }
    .form-grid { display: grid; gap: 14px; }
    .form-grid.two { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .form-grid.three { grid-template-columns: repeat(3, minmax(0, 1fr)); }
    .field { display: grid; gap: 8px; min-width: 0; font-weight: 850; }
    .field span { color: var(--ink); }
    .field select, .field input { min-width: 0; width: 100%; height: 42px; box-sizing: border-box; border: 1px solid #cfd8dc; border-radius: 6px; background: #f8fafc; color: var(--ink); padding: 0 12px; font: inherit; }
    .switch-card { position: relative; display: flex; align-items: center; justify-content: space-between; gap: 18px; min-height: 70px; padding: 14px 16px; border: 1px solid var(--line); border-radius: 8px; background: #fff; }
    .switch-card.compact { min-height: 42px; }
    .switch-card input { position: absolute; opacity: 0; pointer-events: none; }
    .switch-card i { position: relative; flex: 0 0 auto; width: 48px; height: 24px; border-radius: 999px; background: #d1d5db; transition: background 0.16s ease; }
    .switch-card i::after { content: ''; position: absolute; top: 4px; left: 4px; width: 16px; height: 16px; border-radius: 50%; background: #fff; transition: transform 0.16s ease; }
    .switch-card input:checked + i { background: #1f1f1f; }
    .switch-card input:checked + i::after { transform: translateX(24px); }
    .preview-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 14px; }
    .preview-grid article { border: 1px solid var(--line); border-radius: 8px; padding: 16px; background: #f8fafc; display: grid; gap: 6px; }
    .preview-grid span { color: var(--muted); font-weight: 850; }
    .preview-grid strong { font-size: 22px; color: var(--ink); }
    .preview-grid small { color: var(--muted); font-weight: 700; }
    .apply-options { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; }
    .radio-card { display: flex; gap: 12px; align-items: flex-start; border: 1px solid var(--line); border-radius: 8px; padding: 16px; background: #fff; cursor: pointer; }
    .radio-card input { margin-top: 3px; width: 18px; height: 18px; accent-color: #059669; }
    .state { margin: 0; padding: 12px 14px; border-radius: 8px; font-weight: 850; }
    .state.success { color: #047857; background: #ecfdf5; border: 1px solid #a7f3d0; }
    .state.danger { color: #b91c1c; background: #fef2f2; border: 1px solid #fecaca; }
    @media (max-width: 1100px) { .settings-grid, .form-grid.three, .preview-grid { grid-template-columns: 1fr; } }
    @media (max-width: 980px) { .tax-settings-page { grid-template-columns: 1fr; } .settings-nav { position: static; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); } .settings-hero { align-items: stretch; flex-direction: column; } .hero-actions { justify-content: flex-start; } .form-grid.two, .apply-options { grid-template-columns: 1fr; } }
  `]
})
export class TaxSettingsComponent implements OnInit {
  readonly countryOptions = Object.values(TAX_PRESETS);
  readonly message = signal('');
  readonly error = signal('');
  readonly saving = signal(false);
  settings: TaxSettingsState = this.clone(DEFAULT_SETTINGS);

  constructor(private readonly api: ApiService) {}

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.error.set('');
    this.api.list<{ settings?: ApiRecord }>('settings/taxes').subscribe({
      next: (result) => this.settings = this.normalize(result.settings || DEFAULT_SETTINGS),
      error: (error) => this.error.set(this.api.errorText(error, 'Unable to load tax settings'))
    });
  }

  onCountryChange(country: string): void {
    const preset = TAX_PRESETS[String(country || '').toUpperCase()] || TAX_PRESETS.IN;
    this.settings = this.normalize({
      ...this.settings,
      ...preset,
      country: preset.country,
      countryLabel: preset.countryLabel
    });
  }

  save(): void {
    this.saving.set(true);
    this.error.set('');
    this.message.set('');
    this.api.put<{ settings?: ApiRecord }>('settings/taxes', { settings: this.normalize(this.settings) }).subscribe({
      next: (result) => {
        this.settings = this.normalize(result.settings || this.settings);
        this.message.set('Tax settings saved.');
        window.setTimeout(() => this.message.set(''), 2500);
      },
      error: (error) => this.error.set(this.api.errorText(error, 'Unable to save tax settings')),
      complete: () => this.saving.set(false)
    });
  }

  previewServiceTotal(): number {
    return this.previewTotal(1000, this.settings.serviceTaxRate, this.settings.serviceTaxMode);
  }

  previewProductTotal(): number {
    return this.previewTotal(1000, this.settings.productTaxRate, this.settings.productTaxMode);
  }

  private previewTotal(amount: number, rate: number, mode: string): number {
    if (mode === 'Including') return amount;
    return amount + (amount * Number(rate || 0) / 100);
  }

  private normalize(input: ApiRecord): TaxSettingsState {
    const preset = TAX_PRESETS[String(input?.['country'] || DEFAULT_SETTINGS.country).toUpperCase()] || TAX_PRESETS.IN;
    return {
      ...DEFAULT_SETTINGS,
      ...preset,
      country: String(input?.['country'] || preset.country).toUpperCase(),
      countryLabel: String(input?.['countryLabel'] || preset.countryLabel),
      stateProvince: String(input?.['stateProvince'] || ''),
      taxType: String(input?.['taxType'] || preset.taxType),
      registrationLabel: String(input?.['registrationLabel'] || preset.registrationLabel),
      registrationNumber: String(input?.['registrationNumber'] || ''),
      serviceTaxEnabled: input?.['serviceTaxEnabled'] !== false,
      productTaxApplicable: input?.['productTaxApplicable'] !== false,
      taxEditableOnPos: input?.['taxEditableOnPos'] !== false,
      serviceTaxRate: this.numberValue(input?.['serviceTaxRate'], preset.serviceTaxRate),
      productTaxRate: this.numberValue(input?.['productTaxRate'], preset.productTaxRate),
      serviceTaxMode: input?.['serviceTaxMode'] === 'Including' ? 'Including' : 'Excluding',
      productTaxMode: input?.['productTaxMode'] === 'Including' ? 'Including' : 'Excluding',
      billLabel: String(input?.['billLabel'] || DEFAULT_SETTINGS.billLabel),
      billValue: String(input?.['billValue'] || ''),
      debitCreditFeesEnabled: input?.['debitCreditFeesEnabled'] === true,
      debitCreditFeesLabel: String(input?.['debitCreditFeesLabel'] || ''),
      debitCreditFeesValue: this.numberValue(input?.['debitCreditFeesValue'], 0),
      defaultApplyMode: input?.['defaultApplyMode'] === 'existingLater' ? 'existingLater' : 'newOnly'
    };
  }

  private numberValue(value: unknown, fallback = 0): number {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(100, Math.max(0, Math.round(parsed * 100) / 100));
  }

  private clone<T>(value: T): T {
    return JSON.parse(JSON.stringify(value)) as T;
  }
}
