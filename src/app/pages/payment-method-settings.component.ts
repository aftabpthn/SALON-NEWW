import { CommonModule } from '@angular/common';
import { Component, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ApiRecord, ApiService } from '../core/api.service';

type PaymentMethodSettingsState = {
  paymentModes: {
    cash: boolean;
    card: boolean;
    upi: boolean;
    wallet: boolean;
    giftCard: boolean;
  };
  splitPaymentRules: {
    allowSplitPayment: boolean;
    requireExactSplitTotal: boolean;
  };
  duePartialPayment: {
    partialPaymentAllowed: boolean;
    duePaymentMode: string;
  };
  refundRules: {
    refundMode: string;
    paymentNoteRequiredForDueRefund: boolean;
    ownerApprovalForHighDueRefund: boolean;
    highDueRefundThreshold: number;
  };
  settlement: {
    cardSettlementRequired: boolean;
    upiTransactionIdRequired: boolean;
    cardSettlementDays: number;
    upiSettlementDays: number;
  };
  walletGiftCard: {
    walletRedemptionAllowed: boolean;
    walletTopupAllowed: boolean;
    giftCardRedemptionAllowed: boolean;
  };
  posBillingBehavior: {
    blockDisabledPaymentModes: boolean;
    showPaymentPolicyWarning: boolean;
  };
};

const DEFAULT_SETTINGS: PaymentMethodSettingsState = {
  paymentModes: {
    cash: true,
    card: true,
    upi: true,
    wallet: true,
    giftCard: true
  },
  splitPaymentRules: {
    allowSplitPayment: true,
    requireExactSplitTotal: true
  },
  duePartialPayment: {
    partialPaymentAllowed: true,
    duePaymentMode: 'warn'
  },
  refundRules: {
    refundMode: 'original',
    paymentNoteRequiredForDueRefund: true,
    ownerApprovalForHighDueRefund: true,
    highDueRefundThreshold: 5000
  },
  settlement: {
    cardSettlementRequired: true,
    upiTransactionIdRequired: true,
    cardSettlementDays: 1,
    upiSettlementDays: 1
  },
  walletGiftCard: {
    walletRedemptionAllowed: true,
    walletTopupAllowed: true,
    giftCardRedemptionAllowed: true
  },
  posBillingBehavior: {
    blockDisabledPaymentModes: true,
    showPaymentPolicyWarning: true
  }
};

const DUE_MODES = [
  { value: 'allow', label: 'Allow' },
  { value: 'warn', label: 'Warn' },
  { value: 'block', label: 'Block' }
];

const REFUND_MODES = [
  { value: 'original', label: 'Original Mode' },
  { value: 'cash', label: 'Cash' },
  { value: 'wallet', label: 'Wallet' }
];

function cloneSettings(settings: PaymentMethodSettingsState): PaymentMethodSettingsState {
  return JSON.parse(JSON.stringify(settings)) as PaymentMethodSettingsState;
}

function boolValue(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function numberValue(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.round(parsed) : fallback;
}

function stringValue(value: unknown, fallback: string): string {
  return String(value ?? fallback);
}

@Component({
  selector: 'app-payment-method-settings',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  template: `
    <section class="payment-settings-page inner-page-shell">
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
        <a class="active" routerLink="/settings/payment-methods">Payment Methods</a>
        <a routerLink="/settings/message-history">Message History</a>
        <a routerLink="/settings/security">Security</a>
      </aside>

      <main class="settings-content">
        <header class="settings-hero inner-page-header">
          <div>
            <span class="eyebrow">Setup / Payments</span>
            <h1>Payment Methods Settings Control</h1>
            <p>Control POS payment modes, split billing, dues, refunds, settlement rules and wallet or gift card behavior.</p>
          </div>
          <div class="hero-actions inner-action-bar">
            <a class="ghost-button" routerLink="/pos/payment-modes">Manage POS Modes</a>
            <button class="ghost-button" type="button" (click)="load()">Refresh</button>
            <button class="primary-button" type="button" (click)="save()" [disabled]="saving()">
              {{ saving() ? 'Saving...' : 'Save' }}
            </button>
          </div>
        </header>

        <p class="state success" *ngIf="message()">{{ message() }}</p>
        <p class="state danger" *ngIf="error()">{{ error() }}</p>
        <p class="phase-note">Next phase will connect POS billing, invoice payment, settlement reports, cash drawer and due recovery to this saved policy.</p>

        <section class="settings-grid inner-form-grid">
          <article class="settings-card inner-page-card">
            <h2>Payment Modes</h2>
            <label class="switch-row">
              <span><strong>Cash ON/OFF</strong><small>Allow cash collection in POS billing.</small></span>
              <input type="checkbox" [(ngModel)]="settings.paymentModes.cash" />
              <i aria-hidden="true"></i>
            </label>
            <label class="switch-row">
              <span><strong>Card ON/OFF</strong><small>Allow card payment mode.</small></span>
              <input type="checkbox" [(ngModel)]="settings.paymentModes.card" />
              <i aria-hidden="true"></i>
            </label>
            <label class="switch-row">
              <span><strong>UPI ON/OFF</strong><small>Allow UPI payment mode.</small></span>
              <input type="checkbox" [(ngModel)]="settings.paymentModes.upi" />
              <i aria-hidden="true"></i>
            </label>
            <label class="switch-row">
              <span><strong>Wallet ON/OFF</strong><small>Allow client wallet payment.</small></span>
              <input type="checkbox" [(ngModel)]="settings.paymentModes.wallet" />
              <i aria-hidden="true"></i>
            </label>
            <label class="switch-row">
              <span><strong>Gift Card ON/OFF</strong><small>Allow gift card payment.</small></span>
              <input type="checkbox" [(ngModel)]="settings.paymentModes.giftCard" />
              <i aria-hidden="true"></i>
            </label>
          </article>

          <article class="settings-card inner-page-card">
            <h2>Split Payment Rules</h2>
            <label class="switch-row">
              <span><strong>Split Payment allow/block</strong><small>Allow multiple payment modes on one invoice.</small></span>
              <input type="checkbox" [(ngModel)]="settings.splitPaymentRules.allowSplitPayment" />
              <i aria-hidden="true"></i>
            </label>
            <label class="switch-row">
              <span><strong>Exact split total required</strong><small>Payment split must match invoice payable amount.</small></span>
              <input type="checkbox" [(ngModel)]="settings.splitPaymentRules.requireExactSplitTotal" />
              <i aria-hidden="true"></i>
            </label>
          </article>

          <article class="settings-card inner-page-card">
            <h2>Due / Partial Payment</h2>
            <label class="switch-row">
              <span><strong>Partial payment allow/block</strong><small>Allow invoice save with partial paid amount.</small></span>
              <input type="checkbox" [(ngModel)]="settings.duePartialPayment.partialPaymentAllowed" />
              <i aria-hidden="true"></i>
            </label>
            <label class="field-row">
              <span>Due payment allow/warn/block</span>
              <select [(ngModel)]="settings.duePartialPayment.duePaymentMode">
                <option *ngFor="let mode of dueModes" [value]="mode.value">{{ mode.label }}</option>
              </select>
            </label>
          </article>

          <article class="settings-card inner-page-card">
            <h2>Refund Rules</h2>
            <label class="field-row">
              <span>Refund to original mode / cash / wallet</span>
              <select [(ngModel)]="settings.refundRules.refundMode">
                <option *ngFor="let mode of refundModes" [value]="mode.value">{{ mode.label }}</option>
              </select>
            </label>
            <label class="switch-row compact">
              <span><strong>Payment note required for due/refund</strong><small>Require reason before due or refund save.</small></span>
              <input type="checkbox" [(ngModel)]="settings.refundRules.paymentNoteRequiredForDueRefund" />
              <i aria-hidden="true"></i>
            </label>
            <label class="switch-row compact">
              <span><strong>Owner approval for high due/refund</strong><small>Flag high-value exceptions for owner approval.</small></span>
              <input type="checkbox" [(ngModel)]="settings.refundRules.ownerApprovalForHighDueRefund" />
              <i aria-hidden="true"></i>
            </label>
            <label class="field-row">
              <span>High due/refund threshold</span>
              <input type="number" min="0" [(ngModel)]="settings.refundRules.highDueRefundThreshold" />
            </label>
          </article>

          <article class="settings-card inner-page-card">
            <h2>Card / UPI Settlement</h2>
            <label class="switch-row">
              <span><strong>Card settlement required</strong><small>Require settlement tracking for card payments.</small></span>
              <input type="checkbox" [(ngModel)]="settings.settlement.cardSettlementRequired" />
              <i aria-hidden="true"></i>
            </label>
            <label class="switch-row">
              <span><strong>UPI transaction ID required</strong><small>Require UPI reference or transaction id.</small></span>
              <input type="checkbox" [(ngModel)]="settings.settlement.upiTransactionIdRequired" />
              <i aria-hidden="true"></i>
            </label>
            <label class="field-row">
              <span>Card settlement days</span>
              <input type="number" min="0" [(ngModel)]="settings.settlement.cardSettlementDays" />
            </label>
            <label class="field-row">
              <span>UPI settlement days</span>
              <input type="number" min="0" [(ngModel)]="settings.settlement.upiSettlementDays" />
            </label>
          </article>

          <article class="settings-card inner-page-card">
            <h2>Wallet / Gift Card</h2>
            <label class="switch-row">
              <span><strong>Wallet redemption allowed</strong><small>Allow wallet balance usage on invoice.</small></span>
              <input type="checkbox" [(ngModel)]="settings.walletGiftCard.walletRedemptionAllowed" />
              <i aria-hidden="true"></i>
            </label>
            <label class="switch-row">
              <span><strong>Wallet top-up allowed</strong><small>Allow front desk wallet top-up.</small></span>
              <input type="checkbox" [(ngModel)]="settings.walletGiftCard.walletTopupAllowed" />
              <i aria-hidden="true"></i>
            </label>
            <label class="switch-row">
              <span><strong>Gift card redemption allowed</strong><small>Allow gift card redemption on invoice.</small></span>
              <input type="checkbox" [(ngModel)]="settings.walletGiftCard.giftCardRedemptionAllowed" />
              <i aria-hidden="true"></i>
            </label>
          </article>

          <article class="settings-card inner-page-card">
            <h2>POS Billing Behavior</h2>
            <label class="switch-row">
              <span><strong>Block disabled payment modes</strong><small>Hide disabled payment methods from billing.</small></span>
              <input type="checkbox" [(ngModel)]="settings.posBillingBehavior.blockDisabledPaymentModes" />
              <i aria-hidden="true"></i>
            </label>
            <label class="switch-row">
              <span><strong>Show payment policy warning</strong><small>Show staff warning for due/refund exceptions.</small></span>
              <input type="checkbox" [(ngModel)]="settings.posBillingBehavior.showPaymentPolicyWarning" />
              <i aria-hidden="true"></i>
            </label>
          </article>

          <article class="settings-card preview-card">
            <h2>Policy Preview</h2>
            <div class="preview-list">
              <p><strong>Active modes:</strong> {{ activeModesLabel() }}.</p>
              <p><strong>Split:</strong> {{ settings.splitPaymentRules.allowSplitPayment ? 'Allowed' : 'Blocked' }}; exact total {{ settings.splitPaymentRules.requireExactSplitTotal ? 'required' : 'optional' }}.</p>
              <p><strong>Due:</strong> {{ settings.duePartialPayment.duePaymentMode | titlecase }}; partial payment {{ settings.duePartialPayment.partialPaymentAllowed ? 'allowed' : 'blocked' }}.</p>
              <p><strong>Refund:</strong> {{ refundModeLabel() }}; note {{ settings.refundRules.paymentNoteRequiredForDueRefund ? 'required' : 'optional' }}.</p>
              <p><strong>Settlement:</strong> Card {{ settings.settlement.cardSettlementRequired ? 'tracked' : 'not required' }}, UPI ref {{ settings.settlement.upiTransactionIdRequired ? 'required' : 'optional' }}.</p>
              <p><strong>POS:</strong> {{ settings.posBillingBehavior.blockDisabledPaymentModes ? 'Disabled modes blocked' : 'Disabled modes warning only' }}.</p>
            </div>
          </article>
        </section>
      </main>
    </section>
  `,
  styles: [`
    :host { display: block; color: #0f2235; }
    .payment-settings-page {
      display: grid;
      grid-template-columns: 220px minmax(0, 1fr);
      gap: 18px;
      min-height: calc(100vh - 88px);
      padding: 20px;
      background: #f3f7f5;
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
      padding: 10px 12px;
      border-radius: 10px;
    }
    .settings-nav a.active,
    .settings-nav a:hover {
      background: #e1f5ed;
      color: #007b5f;
    }
    .settings-content {
      min-width: 0;
      display: grid;
      gap: 16px;
    }
    .settings-hero,
    .settings-card {
      background: #fff;
      border: 1px solid #d8e6df;
      border-radius: 16px;
      box-shadow: 0 20px 42px rgba(0, 27, 58, 0.06);
    }
    .settings-hero {
      display: flex;
      justify-content: space-between;
      gap: 16px;
      align-items: center;
      padding: 24px;
    }
    .eyebrow {
      display: block;
      color: #52645d;
      font-size: 0.75rem;
      font-weight: 900;
      letter-spacing: 0;
      text-transform: uppercase;
      margin-bottom: 8px;
    }
    h1, h2, p { margin: 0; }
    h1 { font-size: 2.2rem; line-height: 1.08; }
    h2 { font-size: 1rem; text-transform: uppercase; color: #52645d; }
    .settings-hero p,
    .phase-note,
    .state {
      color: #52645d;
      margin-top: 10px;
    }
    .hero-actions {
      display: flex;
      gap: 10px;
      flex-wrap: wrap;
      justify-content: flex-end;
    }
    .primary-button,
    .ghost-button {
      border: 1px solid #d8e6df;
      border-radius: 10px;
      padding: 12px 18px;
      font-weight: 900;
      text-decoration: none;
      cursor: pointer;
      white-space: nowrap;
    }
    .primary-button {
      background: #07956f;
      color: #fff;
      border-color: #07956f;
    }
    .ghost-button {
      background: #fff;
      color: #0f2235;
    }
    .primary-button:disabled {
      opacity: 0.65;
      cursor: progress;
    }
    .state,
    .phase-note {
      padding: 12px 14px;
      border-radius: 12px;
      font-weight: 800;
    }
    .state.success {
      background: #e9f8f0;
      border: 1px solid #b9e9d0;
      color: #07623f;
    }
    .state.danger {
      background: #fff1f1;
      border: 1px solid #ffc7c7;
      color: #b42318;
    }
    .phase-note {
      background: #fff8e8;
      border: 1px solid #f0d58a;
      color: #7a4d00;
    }
    .settings-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 16px;
    }
    .settings-card {
      min-width: 0;
      display: grid;
      gap: 12px;
      padding: 18px;
    }
    .switch-row,
    .field-row {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: 14px;
      align-items: center;
      padding: 12px 14px;
      border: 1px solid #d8e6df;
      border-radius: 12px;
      background: #fbfdfc;
    }
    .switch-row small,
    .field-row small {
      display: block;
      color: #5d6f68;
      margin-top: 4px;
      font-size: 0.82rem;
    }
    .field-row {
      grid-template-columns: 1fr;
    }
    .field-row input,
    .field-row select {
      width: 100%;
      min-height: 42px;
      border: 1px solid #d8e6df;
      border-radius: 10px;
      padding: 0 12px;
      font: inherit;
      background: #fff;
    }
    .switch-row input[type="checkbox"] {
      position: absolute;
      opacity: 0;
      pointer-events: none;
    }
    .switch-row i {
      width: 48px;
      height: 28px;
      border-radius: 999px;
      background: #cbd5dd;
      position: relative;
      transition: background 0.2s ease;
    }
    .switch-row i::after {
      content: '';
      position: absolute;
      top: 4px;
      left: 4px;
      width: 20px;
      height: 20px;
      border-radius: 50%;
      background: #fff;
      transition: transform 0.2s ease;
      box-shadow: 0 2px 4px rgba(0,0,0,0.18);
    }
    .switch-row input:checked + i {
      background: #132235;
    }
    .switch-row input:checked + i::after {
      transform: translateX(20px);
    }
    .preview-card {
      grid-column: 1 / -1;
    }
    .preview-list {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 10px;
    }
    .preview-list p {
      min-width: 0;
      padding: 12px;
      border: 1px solid #d8e6df;
      border-radius: 12px;
      background: #f8fbfa;
      color: #40564d;
    }
    @media (max-width: 980px) {
      .payment-settings-page {
        grid-template-columns: 1fr;
      }
      .settings-nav {
        position: static;
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }
      .settings-hero {
        align-items: flex-start;
        flex-direction: column;
      }
      .settings-grid,
      .preview-list {
        grid-template-columns: 1fr;
      }
    }
  `]
})
export class PaymentMethodSettingsComponent implements OnInit {
  readonly dueModes = DUE_MODES;
  readonly refundModes = REFUND_MODES;
  readonly saving = signal(false);
  readonly message = signal('');
  readonly error = signal('');
  settings: PaymentMethodSettingsState = cloneSettings(DEFAULT_SETTINGS);

  constructor(private readonly api: ApiService) {}

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.error.set('');
    this.message.set('');
    this.api.list<{ settings?: ApiRecord }>('settings/payment-methods').subscribe({
      next: (response) => {
        this.settings = this.normalize(response?.settings);
      },
      error: () => {
        this.settings = cloneSettings(DEFAULT_SETTINGS);
        this.error.set('Unable to load payment method settings');
      }
    });
  }

  save(): void {
    this.saving.set(true);
    this.error.set('');
    this.message.set('');
    const settings = this.normalize(this.settings);
    this.api.put<{ settings?: ApiRecord }>('settings/payment-methods', { settings }).subscribe({
      next: (response) => {
        this.settings = this.normalize(response?.settings || settings);
        this.message.set('Payment method settings saved');
        this.saving.set(false);
      },
      error: () => {
        this.error.set('Unable to save payment method settings');
        this.saving.set(false);
      }
    });
  }

  activeModesLabel(): string {
    const modes = [
      this.settings.paymentModes.cash ? 'Cash' : '',
      this.settings.paymentModes.card ? 'Card' : '',
      this.settings.paymentModes.upi ? 'UPI' : '',
      this.settings.paymentModes.wallet ? 'Wallet' : '',
      this.settings.paymentModes.giftCard ? 'Gift Card' : ''
    ].filter(Boolean);
    return modes.length ? modes.join(', ') : 'No payment mode enabled';
  }

  refundModeLabel(): string {
    return this.refundModes.find((mode) => mode.value === this.settings.refundRules.refundMode)?.label || 'Original Mode';
  }

  private normalize(input: unknown): PaymentMethodSettingsState {
    const source = (input || {}) as Partial<PaymentMethodSettingsState>;
    const paymentModes = (source.paymentModes || {}) as Partial<PaymentMethodSettingsState['paymentModes']>;
    const splitPaymentRules = (source.splitPaymentRules || {}) as Partial<PaymentMethodSettingsState['splitPaymentRules']>;
    const duePartialPayment = (source.duePartialPayment || {}) as Partial<PaymentMethodSettingsState['duePartialPayment']>;
    const refundRules = (source.refundRules || {}) as Partial<PaymentMethodSettingsState['refundRules']>;
    const settlement = (source.settlement || {}) as Partial<PaymentMethodSettingsState['settlement']>;
    const walletGiftCard = (source.walletGiftCard || {}) as Partial<PaymentMethodSettingsState['walletGiftCard']>;
    const posBillingBehavior = (source.posBillingBehavior || {}) as Partial<PaymentMethodSettingsState['posBillingBehavior']>;

    return {
      paymentModes: {
        cash: boolValue(paymentModes.cash, DEFAULT_SETTINGS.paymentModes.cash),
        card: boolValue(paymentModes.card, DEFAULT_SETTINGS.paymentModes.card),
        upi: boolValue(paymentModes.upi, DEFAULT_SETTINGS.paymentModes.upi),
        wallet: boolValue(paymentModes.wallet, DEFAULT_SETTINGS.paymentModes.wallet),
        giftCard: boolValue(paymentModes.giftCard, DEFAULT_SETTINGS.paymentModes.giftCard)
      },
      splitPaymentRules: {
        allowSplitPayment: boolValue(splitPaymentRules.allowSplitPayment, DEFAULT_SETTINGS.splitPaymentRules.allowSplitPayment),
        requireExactSplitTotal: boolValue(splitPaymentRules.requireExactSplitTotal, DEFAULT_SETTINGS.splitPaymentRules.requireExactSplitTotal)
      },
      duePartialPayment: {
        partialPaymentAllowed: boolValue(duePartialPayment.partialPaymentAllowed, DEFAULT_SETTINGS.duePartialPayment.partialPaymentAllowed),
        duePaymentMode: ['allow', 'warn', 'block'].includes(String(duePartialPayment.duePaymentMode))
          ? stringValue(duePartialPayment.duePaymentMode, DEFAULT_SETTINGS.duePartialPayment.duePaymentMode)
          : DEFAULT_SETTINGS.duePartialPayment.duePaymentMode
      },
      refundRules: {
        refundMode: ['original', 'cash', 'wallet'].includes(String(refundRules.refundMode))
          ? stringValue(refundRules.refundMode, DEFAULT_SETTINGS.refundRules.refundMode)
          : DEFAULT_SETTINGS.refundRules.refundMode,
        paymentNoteRequiredForDueRefund: boolValue(refundRules.paymentNoteRequiredForDueRefund, DEFAULT_SETTINGS.refundRules.paymentNoteRequiredForDueRefund),
        ownerApprovalForHighDueRefund: boolValue(refundRules.ownerApprovalForHighDueRefund, DEFAULT_SETTINGS.refundRules.ownerApprovalForHighDueRefund),
        highDueRefundThreshold: numberValue(refundRules.highDueRefundThreshold, DEFAULT_SETTINGS.refundRules.highDueRefundThreshold)
      },
      settlement: {
        cardSettlementRequired: boolValue(settlement.cardSettlementRequired, DEFAULT_SETTINGS.settlement.cardSettlementRequired),
        upiTransactionIdRequired: boolValue(settlement.upiTransactionIdRequired, DEFAULT_SETTINGS.settlement.upiTransactionIdRequired),
        cardSettlementDays: numberValue(settlement.cardSettlementDays, DEFAULT_SETTINGS.settlement.cardSettlementDays),
        upiSettlementDays: numberValue(settlement.upiSettlementDays, DEFAULT_SETTINGS.settlement.upiSettlementDays)
      },
      walletGiftCard: {
        walletRedemptionAllowed: boolValue(walletGiftCard.walletRedemptionAllowed, DEFAULT_SETTINGS.walletGiftCard.walletRedemptionAllowed),
        walletTopupAllowed: boolValue(walletGiftCard.walletTopupAllowed, DEFAULT_SETTINGS.walletGiftCard.walletTopupAllowed),
        giftCardRedemptionAllowed: boolValue(walletGiftCard.giftCardRedemptionAllowed, DEFAULT_SETTINGS.walletGiftCard.giftCardRedemptionAllowed)
      },
      posBillingBehavior: {
        blockDisabledPaymentModes: boolValue(posBillingBehavior.blockDisabledPaymentModes, DEFAULT_SETTINGS.posBillingBehavior.blockDisabledPaymentModes),
        showPaymentPolicyWarning: boolValue(posBillingBehavior.showPaymentPolicyWarning, DEFAULT_SETTINGS.posBillingBehavior.showPaymentPolicyWarning)
      }
    };
  }
}
