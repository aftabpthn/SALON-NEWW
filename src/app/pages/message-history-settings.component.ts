import { CommonModule } from '@angular/common';
import { Component, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ApiRecord, ApiService } from '../core/api.service';
import { AuraDatePipe } from '../shared/pipes/aura-date.pipe';

type MessageHistorySettingsState = {
  logging: {
    sms: boolean;
    whatsapp: boolean;
    email: boolean;
    invoiceNotifications: boolean;
    staffNotifications: boolean;
    engagementMessages: boolean;
  };
  retention: {
    retentionDays: number;
    autoArchiveEnabled: boolean;
    hideDeletedLogs: boolean;
  };
  visibility: {
    showClientMessages: boolean;
    showStaffMessages: boolean;
    showSystemMessages: boolean;
    maskPhoneNumbers: boolean;
  };
  deliveryTracking: {
    trackQueued: boolean;
    trackSent: boolean;
    trackDelivered: boolean;
    trackFailed: boolean;
    captureProviderReference: boolean;
  };
  searchExport: {
    backendSearchEnabled: boolean;
    csvDownloadEnabled: boolean;
    includePayloadInExport: boolean;
  };
  alerts: {
    failedMessageAlert: boolean;
    highFailureRateAlert: boolean;
    ownerDailyDigest: boolean;
    failureRateThreshold: number;
  };
  resendPolicy: {
    allowManualResend: boolean;
    resendRequiresOwnerApproval: boolean;
    notesRequiredForResend: boolean;
  };
};

type MessageHistoryAudit = {
  lastChangedBy: string;
  lastChangedAt: string;
};

const DEFAULT_SETTINGS: MessageHistorySettingsState = {
  logging: {
    sms: true,
    whatsapp: true,
    email: true,
    invoiceNotifications: true,
    staffNotifications: true,
    engagementMessages: true
  },
  retention: {
    retentionDays: 365,
    autoArchiveEnabled: true,
    hideDeletedLogs: true
  },
  visibility: {
    showClientMessages: true,
    showStaffMessages: true,
    showSystemMessages: true,
    maskPhoneNumbers: false
  },
  deliveryTracking: {
    trackQueued: true,
    trackSent: true,
    trackDelivered: true,
    trackFailed: true,
    captureProviderReference: true
  },
  searchExport: {
    backendSearchEnabled: true,
    csvDownloadEnabled: true,
    includePayloadInExport: false
  },
  alerts: {
    failedMessageAlert: true,
    highFailureRateAlert: true,
    ownerDailyDigest: true,
    failureRateThreshold: 10
  },
  resendPolicy: {
    allowManualResend: true,
    resendRequiresOwnerApproval: true,
    notesRequiredForResend: true
  }
};

const DEFAULT_AUDIT: MessageHistoryAudit = {
  lastChangedBy: 'Not saved yet',
  lastChangedAt: ''
};

function cloneSettings(settings: MessageHistorySettingsState): MessageHistorySettingsState {
  return JSON.parse(JSON.stringify(settings)) as MessageHistorySettingsState;
}

function boolValue(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function numberValue(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.round(parsed) : fallback;
}

@Component({
  selector: 'app-message-history-settings',
  standalone: true,
  imports: [AuraDatePipe, CommonModule, FormsModule, RouterLink],
  template: `
    <section class="message-settings-page inner-page-shell">
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
        <a class="active" routerLink="/settings/message-history">Message History</a>
        <a routerLink="/settings/security">Security</a>
      </aside>

      <main class="settings-content">
        <header class="settings-hero inner-page-header">
          <div>
            <span class="eyebrow">Setup / Messages</span>
            <h1>Message History Settings Control</h1>
            <p>Control what gets logged, how long history is retained, delivery tracking, exports, alerts and resend policy.</p>
          </div>
          <div class="hero-actions inner-action-bar">
            <a class="ghost-button" routerLink="/message-logs">Open Message Logs</a>
            <button class="ghost-button" type="button" (click)="load()">Refresh</button>
            <button class="primary-button" type="button" (click)="save()" [disabled]="saving()">
              {{ saving() ? 'Saving...' : 'Save' }}
            </button>
          </div>
        </header>

        <p class="state success" *ngIf="message()">{{ message() }}</p>
        <p class="state danger" *ngIf="error()">{{ error() }}</p>
        <p class="phase-note">Next phase will connect SMS, WhatsApp, email senders and the Message Logs report to this saved policy.</p>

        <section class="audit-strip">
          <strong>Audit info</strong>
          <span>Last changed by: {{ audit.lastChangedBy || 'Not saved yet' }}</span>
          <span>Last changed time: {{ audit.lastChangedAt ? (audit.lastChangedAt | auraDate:'date') : 'Not saved yet' }}</span>
        </section>

        <section class="settings-grid inner-form-grid">
          <article class="settings-card inner-page-card">
            <h2>Message Channels</h2>
            <p>Choose which communication channels and business messages should be logged.</p>
            <label class="switch-row"><span><strong>SMS logs</strong><small>Store SMS activity in message history.</small></span><input type="checkbox" [(ngModel)]="settings.logging.sms" /><i></i></label>
            <label class="switch-row"><span><strong>WhatsApp logs</strong><small>Store WhatsApp activity in message history.</small></span><input type="checkbox" [(ngModel)]="settings.logging.whatsapp" /><i></i></label>
            <label class="switch-row"><span><strong>Email logs</strong><small>Store email activity in message history.</small></span><input type="checkbox" [(ngModel)]="settings.logging.email" /><i></i></label>
            <label class="switch-row"><span><strong>Invoice notifications</strong><small>Log invoice send and reminder messages.</small></span><input type="checkbox" [(ngModel)]="settings.logging.invoiceNotifications" /><i></i></label>
            <label class="switch-row"><span><strong>Staff notifications</strong><small>Log internal staff alerts.</small></span><input type="checkbox" [(ngModel)]="settings.logging.staffNotifications" /><i></i></label>
            <label class="switch-row"><span><strong>Engagement messages</strong><small>Log marketing and client engagement messages.</small></span><input type="checkbox" [(ngModel)]="settings.logging.engagementMessages" /><i></i></label>
          </article>

          <article class="settings-card inner-page-card">
            <h2>Retention & Archive</h2>
            <p>Control how long message history stays visible and when older rows are archived.</p>
            <label class="field-row"><span>Retention days</span><input type="number" min="1" [(ngModel)]="settings.retention.retentionDays" /></label>
            <label class="switch-row"><span><strong>Auto archive enabled</strong><small>Older history can be moved out of default views.</small></span><input type="checkbox" [(ngModel)]="settings.retention.autoArchiveEnabled" /><i></i></label>
            <label class="switch-row"><span><strong>Hide deleted logs</strong><small>Keep removed rows hidden from staff views.</small></span><input type="checkbox" [(ngModel)]="settings.retention.hideDeletedLogs" /><i></i></label>
          </article>

          <article class="settings-card inner-page-card">
            <h2>Visibility & Privacy</h2>
            <p>Decide which message types appear and how contact details are shown.</p>
            <label class="switch-row"><span><strong>Show client messages</strong><small>Display client-facing messages.</small></span><input type="checkbox" [(ngModel)]="settings.visibility.showClientMessages" /><i></i></label>
            <label class="switch-row"><span><strong>Show staff messages</strong><small>Display staff and owner alerts.</small></span><input type="checkbox" [(ngModel)]="settings.visibility.showStaffMessages" /><i></i></label>
            <label class="switch-row"><span><strong>Show system messages</strong><small>Display system generated entries.</small></span><input type="checkbox" [(ngModel)]="settings.visibility.showSystemMessages" /><i></i></label>
            <label class="switch-row"><span><strong>Mask phone numbers</strong><small>Mask contact numbers in shared views.</small></span><input type="checkbox" [(ngModel)]="settings.visibility.maskPhoneNumbers" /><i></i></label>
          </article>

          <article class="settings-card inner-page-card">
            <h2>Delivery Tracking</h2>
            <p>Store provider delivery states for audit and troubleshooting.</p>
            <label class="switch-row"><span><strong>Track queued</strong><small>Record queued messages.</small></span><input type="checkbox" [(ngModel)]="settings.deliveryTracking.trackQueued" /><i></i></label>
            <label class="switch-row"><span><strong>Track sent</strong><small>Record sent state.</small></span><input type="checkbox" [(ngModel)]="settings.deliveryTracking.trackSent" /><i></i></label>
            <label class="switch-row"><span><strong>Track delivered</strong><small>Record delivered state.</small></span><input type="checkbox" [(ngModel)]="settings.deliveryTracking.trackDelivered" /><i></i></label>
            <label class="switch-row"><span><strong>Track failed</strong><small>Record failed state.</small></span><input type="checkbox" [(ngModel)]="settings.deliveryTracking.trackFailed" /><i></i></label>
            <label class="switch-row"><span><strong>Capture provider reference</strong><small>Save provider ids for reconciliation.</small></span><input type="checkbox" [(ngModel)]="settings.deliveryTracking.captureProviderReference" /><i></i></label>
          </article>

          <article class="settings-card inner-page-card">
            <h2>Search & Export</h2>
            <p>Control backend search and CSV export behavior for message history.</p>
            <label class="switch-row"><span><strong>Backend search enabled</strong><small>Search message history from backend data.</small></span><input type="checkbox" [(ngModel)]="settings.searchExport.backendSearchEnabled" /><i></i></label>
            <label class="switch-row"><span><strong>CSV download enabled</strong><small>Allow CSV download from the report.</small></span><input type="checkbox" [(ngModel)]="settings.searchExport.csvDownloadEnabled" /><i></i></label>
            <label class="switch-row"><span><strong>Include payload in export</strong><small>Include provider payload in exports.</small></span><input type="checkbox" [(ngModel)]="settings.searchExport.includePayloadInExport" /><i></i></label>
          </article>

          <article class="settings-card inner-page-card">
            <h2>Alerts</h2>
            <p>Notify owners when delivery quality drops or messages fail.</p>
            <label class="switch-row"><span><strong>Failed message alert</strong><small>Alert owner when a message fails.</small></span><input type="checkbox" [(ngModel)]="settings.alerts.failedMessageAlert" /><i></i></label>
            <label class="switch-row"><span><strong>High failure rate alert</strong><small>Alert when failure rate crosses threshold.</small></span><input type="checkbox" [(ngModel)]="settings.alerts.highFailureRateAlert" /><i></i></label>
            <label class="switch-row"><span><strong>Owner daily digest</strong><small>Daily summary for message delivery health.</small></span><input type="checkbox" [(ngModel)]="settings.alerts.ownerDailyDigest" /><i></i></label>
            <label class="field-row"><span>Failure rate threshold %</span><input type="number" min="1" max="100" [(ngModel)]="settings.alerts.failureRateThreshold" /></label>
          </article>

          <article class="settings-card inner-page-card">
            <h2>Resend Policy</h2>
            <p>Control manual resend behavior for failed or customer-requested messages.</p>
            <label class="switch-row"><span><strong>Allow manual resend</strong><small>Staff can retry eligible messages.</small></span><input type="checkbox" [(ngModel)]="settings.resendPolicy.allowManualResend" /><i></i></label>
            <label class="switch-row"><span><strong>Resend requires owner approval</strong><small>Manual retry can be routed for approval.</small></span><input type="checkbox" [(ngModel)]="settings.resendPolicy.resendRequiresOwnerApproval" /><i></i></label>
            <label class="switch-row"><span><strong>Notes required for resend</strong><small>Require reason before retry.</small></span><input type="checkbox" [(ngModel)]="settings.resendPolicy.notesRequiredForResend" /><i></i></label>
          </article>

          <article class="settings-card preview-card">
            <h2>Policy Preview</h2>
            <p>{{ enabledChannelsLabel() }} logs are active.</p>
            <p>History retention is {{ settings.retention.retentionDays }} day(s) with {{ settings.retention.autoArchiveEnabled ? 'auto archive ON' : 'auto archive OFF' }}.</p>
            <p>Failed delivery alerts are {{ settings.alerts.failedMessageAlert ? 'ON' : 'OFF' }} and manual resend is {{ settings.resendPolicy.allowManualResend ? 'allowed' : 'blocked' }}.</p>
            <p>Exports are {{ settings.searchExport.csvDownloadEnabled ? 'enabled' : 'disabled' }}; phone masking is {{ settings.visibility.maskPhoneNumbers ? 'ON' : 'OFF' }}.</p>
          </article>
        </section>
      </main>
    </section>
  `,
  styles: [`
    .message-settings-page {
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
      text-decoration: none;
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

    .field-row {
      display: grid;
      gap: 8px;
      color: #44586d;
      font-weight: 800;
    }

    .field-row input {
      border: 1px solid #d6e3de;
      border-radius: 12px;
      padding: 13px 14px;
      font: inherit;
      color: #102235;
      min-width: 0;
    }

    .preview-card {
      background: #f9fffc;
    }

    @media (max-width: 980px) {
      .message-settings-page {
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

      .hero-actions {
        justify-content: flex-start;
      }

      .settings-grid {
        grid-template-columns: 1fr;
      }
    }
  `]
})
export class MessageHistorySettingsComponent implements OnInit {
  settings = cloneSettings(DEFAULT_SETTINGS);
  audit: MessageHistoryAudit = { ...DEFAULT_AUDIT };
  saving = signal(false);
  message = signal('');
  error = signal('');

  constructor(private readonly api: ApiService) {}

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.error.set('');
    this.message.set('');
    this.api.list<{ settings?: ApiRecord; audit?: ApiRecord }>('settings/message-history').subscribe({
      next: (res) => {
        this.settings = this.normalize(res.settings || {});
        this.audit = this.normalizeAudit(res.audit || {});
      },
      error: () => {
        this.error.set('Unable to load message history settings');
      }
    });
  }

  save(): void {
    this.saving.set(true);
    this.error.set('');
    this.message.set('');
    const settings = this.normalize(this.settings);
    this.api.put<{ settings?: ApiRecord; audit?: ApiRecord }>('settings/message-history', { settings }).subscribe({
      next: (res) => {
        this.settings = this.normalize(res.settings || settings);
        this.audit = this.normalizeAudit(res.audit || {});
        this.message.set('Message history settings saved');
        this.saving.set(false);
      },
      error: () => {
        this.error.set('Unable to save message history settings');
        this.saving.set(false);
      }
    });
  }

  enabledChannelsLabel(): string {
    const channels = [
      this.settings.logging.sms ? 'SMS' : '',
      this.settings.logging.whatsapp ? 'WhatsApp' : '',
      this.settings.logging.email ? 'Email' : ''
    ].filter(Boolean);
    return channels.length ? channels.join(', ') : 'No channel';
  }

  private normalize(input: ApiRecord): MessageHistorySettingsState {
    const logging = (input['logging'] || {}) as ApiRecord;
    const retention = (input['retention'] || {}) as ApiRecord;
    const visibility = (input['visibility'] || {}) as ApiRecord;
    const deliveryTracking = (input['deliveryTracking'] || {}) as ApiRecord;
    const searchExport = (input['searchExport'] || {}) as ApiRecord;
    const alerts = (input['alerts'] || {}) as ApiRecord;
    const resendPolicy = (input['resendPolicy'] || {}) as ApiRecord;

    return {
      logging: {
        sms: boolValue(logging['sms'], DEFAULT_SETTINGS.logging.sms),
        whatsapp: boolValue(logging['whatsapp'], DEFAULT_SETTINGS.logging.whatsapp),
        email: boolValue(logging['email'], DEFAULT_SETTINGS.logging.email),
        invoiceNotifications: boolValue(logging['invoiceNotifications'], DEFAULT_SETTINGS.logging.invoiceNotifications),
        staffNotifications: boolValue(logging['staffNotifications'], DEFAULT_SETTINGS.logging.staffNotifications),
        engagementMessages: boolValue(logging['engagementMessages'], DEFAULT_SETTINGS.logging.engagementMessages)
      },
      retention: {
        retentionDays: numberValue(retention['retentionDays'], DEFAULT_SETTINGS.retention.retentionDays),
        autoArchiveEnabled: boolValue(retention['autoArchiveEnabled'], DEFAULT_SETTINGS.retention.autoArchiveEnabled),
        hideDeletedLogs: boolValue(retention['hideDeletedLogs'], DEFAULT_SETTINGS.retention.hideDeletedLogs)
      },
      visibility: {
        showClientMessages: boolValue(visibility['showClientMessages'], DEFAULT_SETTINGS.visibility.showClientMessages),
        showStaffMessages: boolValue(visibility['showStaffMessages'], DEFAULT_SETTINGS.visibility.showStaffMessages),
        showSystemMessages: boolValue(visibility['showSystemMessages'], DEFAULT_SETTINGS.visibility.showSystemMessages),
        maskPhoneNumbers: boolValue(visibility['maskPhoneNumbers'], DEFAULT_SETTINGS.visibility.maskPhoneNumbers)
      },
      deliveryTracking: {
        trackQueued: boolValue(deliveryTracking['trackQueued'], DEFAULT_SETTINGS.deliveryTracking.trackQueued),
        trackSent: boolValue(deliveryTracking['trackSent'], DEFAULT_SETTINGS.deliveryTracking.trackSent),
        trackDelivered: boolValue(deliveryTracking['trackDelivered'], DEFAULT_SETTINGS.deliveryTracking.trackDelivered),
        trackFailed: boolValue(deliveryTracking['trackFailed'], DEFAULT_SETTINGS.deliveryTracking.trackFailed),
        captureProviderReference: boolValue(deliveryTracking['captureProviderReference'], DEFAULT_SETTINGS.deliveryTracking.captureProviderReference)
      },
      searchExport: {
        backendSearchEnabled: boolValue(searchExport['backendSearchEnabled'], DEFAULT_SETTINGS.searchExport.backendSearchEnabled),
        csvDownloadEnabled: boolValue(searchExport['csvDownloadEnabled'], DEFAULT_SETTINGS.searchExport.csvDownloadEnabled),
        includePayloadInExport: boolValue(searchExport['includePayloadInExport'], DEFAULT_SETTINGS.searchExport.includePayloadInExport)
      },
      alerts: {
        failedMessageAlert: boolValue(alerts['failedMessageAlert'], DEFAULT_SETTINGS.alerts.failedMessageAlert),
        highFailureRateAlert: boolValue(alerts['highFailureRateAlert'], DEFAULT_SETTINGS.alerts.highFailureRateAlert),
        ownerDailyDigest: boolValue(alerts['ownerDailyDigest'], DEFAULT_SETTINGS.alerts.ownerDailyDigest),
        failureRateThreshold: numberValue(alerts['failureRateThreshold'], DEFAULT_SETTINGS.alerts.failureRateThreshold)
      },
      resendPolicy: {
        allowManualResend: boolValue(resendPolicy['allowManualResend'], DEFAULT_SETTINGS.resendPolicy.allowManualResend),
        resendRequiresOwnerApproval: boolValue(resendPolicy['resendRequiresOwnerApproval'], DEFAULT_SETTINGS.resendPolicy.resendRequiresOwnerApproval),
        notesRequiredForResend: boolValue(resendPolicy['notesRequiredForResend'], DEFAULT_SETTINGS.resendPolicy.notesRequiredForResend)
      }
    };
  }

  private normalizeAudit(input: ApiRecord): MessageHistoryAudit {
    return {
      lastChangedBy: String(input['lastChangedBy'] || DEFAULT_AUDIT.lastChangedBy),
      lastChangedAt: String(input['lastChangedAt'] || DEFAULT_AUDIT.lastChangedAt)
    };
  }
}
