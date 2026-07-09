import { CommonModule } from '@angular/common';
import { Component, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ApiRecord, ApiService } from '../core/api.service';

type ClientCustomField = {
  key: string;
  label: string;
  default: boolean;
  mandatory: boolean;
  displayOnBookNow: boolean;
  lockedDefault?: boolean;
  lockedMandatory?: boolean;
};

const DEFAULT_FIELDS: ClientCustomField[] = [
  { key: 'name', label: 'Name', default: true, mandatory: true, displayOnBookNow: true, lockedDefault: true, lockedMandatory: true },
  { key: 'contact', label: 'Contact', default: true, mandatory: true, displayOnBookNow: true, lockedDefault: true, lockedMandatory: true },
  { key: 'email', label: 'Email', default: false, mandatory: false, displayOnBookNow: false },
  { key: 'dateOfBirth', label: 'Date Of Birth', default: true, mandatory: false, displayOnBookNow: false },
  { key: 'dateOfAnniversary', label: 'Date Of Anniversary', default: true, mandatory: false, displayOnBookNow: false },
  { key: 'gender', label: 'Gender', default: true, mandatory: false, displayOnBookNow: false },
  { key: 'address', label: 'Address', default: false, mandatory: false, displayOnBookNow: false },
  { key: 'gstNumber', label: 'GST Number', default: false, mandatory: false, displayOnBookNow: false },
  { key: 'parentName', label: 'Parent Name', default: false, mandatory: false, displayOnBookNow: false },
  { key: 'parentContact', label: 'Parent Contact', default: false, mandatory: false, displayOnBookNow: false },
  { key: 'childAge', label: 'Child Age', default: false, mandatory: false, displayOnBookNow: false },
  { key: 'cardNumber', label: 'Card Number', default: false, mandatory: false, displayOnBookNow: false },
  { key: 'clientDiscountPercentage', label: 'Client Discount Percentage', default: false, mandatory: false, displayOnBookNow: false },
  { key: 'clientPicture', label: 'Client Picture', default: false, mandatory: false, displayOnBookNow: false }
];

@Component({
  selector: 'app-client-custom-form-settings',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  template: `
    <section class="client-custom-form-page inner-page-shell">
      <aside class="settings-nav" aria-label="Settings sections">
        <a routerLink="/settings/general">General Settings</a>
        <a routerLink="/setting/calendar">Calendar Settings</a>
        <a class="active" routerLink="/settings/clients/custom-form">Clients - Custom Form</a>
        <a routerLink="/settings/taxes">Tax Settings</a>
        <a routerLink="/settings/marketplace">Marketplace Settings</a>
        <a routerLink="/business-details">Business Details</a>
        <a routerLink="/pos/payment-modes">Payment Methods</a>
        <a routerLink="/message-logs">Message History</a>
        <a routerLink="/security">Security</a>
      </aside>

      <main class="settings-content">
        <header class="settings-hero inner-page-header">
          <div>
            <h1>Clients - Custom Form</h1>
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

        <section class="settings-section inner-page-card">
          <div class="section-intro">
            <h2>Client form fields</h2>
          </div>

          <div class="form-table-wrap">
            <table class="form-table">
              <thead>
                <tr>
                  <th>Field Name</th>
                  <th>Default</th>
                  <th>Mandatory</th>
                  <th>Display on Book Now</th>
                </tr>
              </thead>
              <tbody>
                <tr *ngFor="let field of fields(); trackBy: trackField">
                  <td>
                    <strong>{{ field.label }}</strong>
                    <small *ngIf="field.lockedDefault || field.lockedMandatory">Core client field</small>
                  </td>
                  <td>
                    <label class="check-cell" [class.locked]="field.lockedDefault === true">
                      <input type="checkbox" [(ngModel)]="field.default" [disabled]="field.lockedDefault === true" (ngModelChange)="normalizeLockedFields()" />
                      <span aria-hidden="true"></span>
                    </label>
                  </td>
                  <td>
                    <label class="check-cell" [class.locked]="field.lockedMandatory === true">
                      <input type="checkbox" [(ngModel)]="field.mandatory" [disabled]="field.lockedMandatory === true" (ngModelChange)="normalizeLockedFields()" />
                      <span aria-hidden="true"></span>
                    </label>
                  </td>
                  <td>
                    <label class="check-cell">
                      <input type="checkbox" [(ngModel)]="field.displayOnBookNow" />
                      <span aria-hidden="true"></span>
                    </label>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
      </main>
    </section>
  `,
  styles: [`
    .client-custom-form-page {
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
      display: grid;
      gap: 6px;
      padding: 14px;
      border-radius: 8px;
      background: #fff;
      border: 1px solid var(--line);
    }

    .settings-nav a {
      color: var(--ink);
      text-decoration: none;
      font-weight: 850;
      padding: 10px 12px;
      border-radius: 6px;
    }

    .settings-nav a.active,
    .settings-nav a:hover {
      background: #FBF0E8;
      color: #7A4A28;
    }

    .settings-content {
      display: grid;
      gap: 18px;
      min-width: 0;
    }

    .settings-hero,
    .settings-section {
      background: #fff;
      border: 1px solid var(--line);
      border-radius: 8px;
      box-shadow: var(--shadow-soft);
    }

    .settings-hero {
      display: flex;
      justify-content: space-between;
      gap: 18px;
      align-items: center;
      padding: 22px 24px;
    }

    .settings-hero h1,
    .section-intro h2 {
      margin: 0;
      color: var(--ink);
      letter-spacing: 0;
    }

    .settings-hero h1 {
      font-size: 30px;
      line-height: 1.12;
    }

    .settings-hero p,
    .section-intro p {
      max-width: 760px;
      margin: 6px 0 0;
      color: var(--muted);
      font-weight: 650;
      line-height: 1.55;
    }

    .hero-actions {
      display: flex;
      gap: 10px;
      align-items: center;
      flex-wrap: wrap;
      justify-content: flex-end;
    }

    .settings-section {
      padding: 22px;
    }

    .section-intro {
      margin-bottom: 16px;
    }

    .form-table-wrap {
      width: 100%;
      max-width: 100%;
      overflow-x: auto;
      border: 1px solid var(--line);
      border-radius: 8px;
    }

    .form-table {
      width: 100%;
      min-width: 860px;
      border-collapse: collapse;
    }

    .form-table th,
    .form-table td {
      border-bottom: 1px solid var(--line);
      padding: 18px 20px;
      text-align: left;
      vertical-align: middle;
    }

    .form-table th {
      background: #f8fafc;
      color: var(--muted);
      font-size: 12px;
      text-transform: uppercase;
    }

    .form-table td:first-child {
      min-width: 280px;
    }

    .form-table strong {
      display: block;
      color: var(--ink);
    }

    .form-table small {
      display: block;
      margin-top: 4px;
      color: var(--muted);
      font-weight: 700;
    }

    .check-cell {
      position: relative;
      display: inline-grid;
      place-items: center;
      width: 22px;
      height: 22px;
      cursor: pointer;
    }

    .check-cell input {
      position: absolute;
      opacity: 0;
      pointer-events: none;
    }

    .check-cell span {
      width: 18px;
      height: 18px;
      border: 1px solid #111827;
      border-radius: 4px;
      background: #fff;
      box-sizing: border-box;
    }

    .check-cell input:checked + span {
      background: #050505;
      border-color: #050505;
    }

    .check-cell input:checked + span::after {
      content: '';
      position: absolute;
      width: 9px;
      height: 5px;
      border-left: 2px solid #fff;
      border-bottom: 2px solid #fff;
      transform: rotate(-45deg);
      top: 7px;
      left: 6px;
    }

    .check-cell.locked {
      cursor: not-allowed;
      opacity: 0.72;
    }

    .state {
      margin: 0;
      padding: 12px 14px;
      border-radius: 8px;
      font-weight: 850;
    }

    .state.success {
      color: #7A4A28;
      background: #F3EAF0;
      border: 1px solid #DCC4D4;
    }

    .state.danger {
      color: #b91c1c;
      background: #fef2f2;
      border: 1px solid #fecaca;
    }

    @media (max-width: 980px) {
      .client-custom-form-page {
        grid-template-columns: 1fr;
      }

      .settings-nav {
        position: static;
        grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
      }

      .settings-hero {
        align-items: stretch;
        flex-direction: column;
      }

      .hero-actions {
        justify-content: flex-start;
      }
    }
  `]
})
export class ClientCustomFormSettingsComponent implements OnInit {
  readonly fields = signal<ClientCustomField[]>(this.clone(DEFAULT_FIELDS));
  readonly message = signal('');
  readonly error = signal('');
  readonly saving = signal(false);

  constructor(private readonly api: ApiService) {}

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.error.set('');
    this.api.list<{ fields?: ApiRecord[] }>('settings/clients/custom-form').subscribe({
      next: (result) => this.fields.set(this.normalize(result.fields)),
      error: (error) => this.error.set(this.api.errorText(error, 'Unable to load client custom form settings'))
    });
  }

  save(): void {
    this.normalizeLockedFields();
    this.saving.set(true);
    this.error.set('');
    this.message.set('');
    this.api.put<{ fields?: ApiRecord[] }>('settings/clients/custom-form', { fields: this.fields() }).subscribe({
      next: (result) => {
        this.fields.set(this.normalize(result.fields));
        this.message.set('Client custom form settings saved.');
        window.setTimeout(() => this.message.set(''), 2500);
      },
      error: (error) => this.error.set(this.api.errorText(error, 'Unable to save client custom form settings')),
      complete: () => this.saving.set(false)
    });
  }

  normalizeLockedFields(): void {
    this.fields.set(this.normalize(this.fields()));
  }

  trackField(_index: number, field: ClientCustomField): string {
    return field.key;
  }

  private normalize(input: ApiRecord[] = []): ClientCustomField[] {
    const saved = new Map((Array.isArray(input) ? input : []).map((field) => [String(field?.key || ''), field]));
    return DEFAULT_FIELDS.map((base) => {
      const row = saved.get(base.key) || {};
      const lockedDefault = base.lockedDefault === true;
      const lockedMandatory = base.lockedMandatory === true;
      return {
        ...base,
        default: lockedDefault ? true : row.default === true,
        mandatory: lockedMandatory ? true : row.mandatory === true,
        displayOnBookNow: row.displayOnBookNow === true || (base.displayOnBookNow === true && row.displayOnBookNow !== false),
        lockedDefault,
        lockedMandatory
      };
    });
  }

  private clone<T>(value: T): T {
    return JSON.parse(JSON.stringify(value)) as T;
  }
}
