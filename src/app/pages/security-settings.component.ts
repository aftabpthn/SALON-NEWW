import { CommonModule } from '@angular/common';
import { Component, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ApiRecord, ApiService } from '../core/api.service';
import { AuraDatePipe } from '../shared/pipes/aura-date.pipe';

type SecuritySettingsState = {
  loginSession: {
    sessionTimeoutMinutes: number;
    refreshTokenDays: number;
    requireReauthForSensitiveActions: boolean;
    sessionKillSwitchEnabled: boolean;
  };
  passwordPolicy: {
    minLength: number;
    requireUppercase: boolean;
    requireNumber: boolean;
    requireSymbol: boolean;
    expiryDays: number;
  };
  twoFactor: {
    ownerRequired: boolean;
    staffOptional: boolean;
    rememberDeviceDays: number;
  };
  deviceIpProtection: {
    unknownDeviceAlert: boolean;
    ipBlocklistEnabled: boolean;
    geoRiskAlert: boolean;
    maxFailedAttempts: number;
  };
  exportDataAccess: {
    exportProtectionEnabled: boolean;
    requireOwnerApprovalForExport: boolean;
    maskClientContactForStaff: boolean;
  };
  approvalsAudit: {
    auditLogEnabled: boolean;
    securityAlertNotifications: boolean;
    dailySecurityDigest: boolean;
    approvalRequiredForRoleChange: boolean;
  };
};

type SecuritySettingsAudit = {
  lastChangedBy: string;
  lastChangedAt: string;
};

const DEFAULT_SETTINGS: SecuritySettingsState = {
  loginSession: {
    sessionTimeoutMinutes: 60,
    refreshTokenDays: 7,
    requireReauthForSensitiveActions: true,
    sessionKillSwitchEnabled: true
  },
  passwordPolicy: {
    minLength: 8,
    requireUppercase: true,
    requireNumber: true,
    requireSymbol: false,
    expiryDays: 90
  },
  twoFactor: {
    ownerRequired: true,
    staffOptional: true,
    rememberDeviceDays: 30
  },
  deviceIpProtection: {
    unknownDeviceAlert: true,
    ipBlocklistEnabled: true,
    geoRiskAlert: true,
    maxFailedAttempts: 5
  },
  exportDataAccess: {
    exportProtectionEnabled: true,
    requireOwnerApprovalForExport: true,
    maskClientContactForStaff: true
  },
  approvalsAudit: {
    auditLogEnabled: true,
    securityAlertNotifications: true,
    dailySecurityDigest: true,
    approvalRequiredForRoleChange: true
  }
};

const DEFAULT_AUDIT: SecuritySettingsAudit = {
  lastChangedBy: 'Not saved yet',
  lastChangedAt: ''
};

function cloneSettings(settings: SecuritySettingsState): SecuritySettingsState {
  return JSON.parse(JSON.stringify(settings)) as SecuritySettingsState;
}

function boolValue(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function numberValue(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.round(parsed) : fallback;
}

@Component({
  selector: 'app-security-settings',
  standalone: true,
  imports: [AuraDatePipe, CommonModule, FormsModule, RouterLink],
  template: `
    <section class="security-settings-page inner-page-shell">
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
        <a class="active" routerLink="/settings/security">Security</a>
      </aside>

      <main class="settings-content">
        <header class="settings-hero inner-page-header">
          <div>
            <span class="eyebrow">Setup / Security</span>
            <h1>Security Settings Control</h1>
            <p>Control login sessions, password rules, two-factor policy, device risk, export protection and audit alerts.</p>
          </div>
          <div class="hero-actions inner-action-bar">
            <a class="ghost-button" routerLink="/security">Open Security Center</a>
            <button class="ghost-button" type="button" (click)="load()">Refresh</button>
            <button class="primary-button" type="button" (click)="save()" [disabled]="saving()">
              {{ saving() ? 'Saving...' : 'Save' }}
            </button>
          </div>
        </header>

        <p class="state success" *ngIf="message()">{{ message() }}</p>
        <p class="state danger" *ngIf="error()">{{ error() }}</p>
        <p class="phase-note">Next phase will connect auth, export protection, role changes, alerts and audit enforcement to this saved security policy.</p>

        <section class="audit-strip">
          <strong>Audit info</strong>
          <span>Last changed by: {{ audit.lastChangedBy || 'Not saved yet' }}</span>
          <span>Last changed time: {{ audit.lastChangedAt ? (audit.lastChangedAt | auraDate:'date') : 'Not saved yet' }}</span>
        </section>

        <section class="settings-grid inner-form-grid">
          <article class="settings-card inner-page-card">
            <h2>Login & Session</h2>
            <p>Set session timeout, refresh duration and sensitive action checks.</p>
            <label class="field-row"><span>Session timeout minutes</span><input type="number" min="5" [(ngModel)]="settings.loginSession.sessionTimeoutMinutes" /></label>
            <label class="field-row"><span>Refresh token days</span><input type="number" min="1" [(ngModel)]="settings.loginSession.refreshTokenDays" /></label>
            <label class="switch-row"><span><strong>Require re-auth for sensitive actions</strong><small>Ask users to verify before risky operations.</small></span><input type="checkbox" [(ngModel)]="settings.loginSession.requireReauthForSensitiveActions" /><i></i></label>
            <label class="switch-row"><span><strong>Session kill switch enabled</strong><small>Allow owner/admin to invalidate risky sessions.</small></span><input type="checkbox" [(ngModel)]="settings.loginSession.sessionKillSwitchEnabled" /><i></i></label>
          </article>

          <article class="settings-card inner-page-card">
            <h2>Password Policy</h2>
            <p>Define minimum password strength and expiry policy.</p>
            <label class="field-row"><span>Minimum password length</span><input type="number" min="6" [(ngModel)]="settings.passwordPolicy.minLength" /></label>
            <label class="switch-row"><span><strong>Require uppercase</strong><small>Password must contain uppercase letter.</small></span><input type="checkbox" [(ngModel)]="settings.passwordPolicy.requireUppercase" /><i></i></label>
            <label class="switch-row"><span><strong>Require number</strong><small>Password must contain a number.</small></span><input type="checkbox" [(ngModel)]="settings.passwordPolicy.requireNumber" /><i></i></label>
            <label class="switch-row"><span><strong>Require symbol</strong><small>Password must contain a symbol.</small></span><input type="checkbox" [(ngModel)]="settings.passwordPolicy.requireSymbol" /><i></i></label>
            <label class="field-row"><span>Password expiry days</span><input type="number" min="0" [(ngModel)]="settings.passwordPolicy.expiryDays" /></label>
          </article>

          <article class="settings-card inner-page-card">
            <h2>Two Factor</h2>
            <p>Control 2FA requirements for owners and staff users.</p>
            <label class="switch-row"><span><strong>Owner two-factor required</strong><small>Require 2FA for owner level accounts.</small></span><input type="checkbox" [(ngModel)]="settings.twoFactor.ownerRequired" /><i></i></label>
            <label class="switch-row"><span><strong>Staff two-factor optional</strong><small>Allow staff 2FA without forcing it now.</small></span><input type="checkbox" [(ngModel)]="settings.twoFactor.staffOptional" /><i></i></label>
            <label class="field-row"><span>Remember device days</span><input type="number" min="0" [(ngModel)]="settings.twoFactor.rememberDeviceDays" /></label>
          </article>

          <article class="settings-card inner-page-card">
            <h2>Device & IP Protection</h2>
            <p>Detect risky devices, IPs, locations and failed login attempts.</p>
            <label class="switch-row"><span><strong>Unknown device alert</strong><small>Notify owner on new device login.</small></span><input type="checkbox" [(ngModel)]="settings.deviceIpProtection.unknownDeviceAlert" /><i></i></label>
            <label class="switch-row"><span><strong>IP blocklist enabled</strong><small>Use configured blocklist for risky IPs.</small></span><input type="checkbox" [(ngModel)]="settings.deviceIpProtection.ipBlocklistEnabled" /><i></i></label>
            <label class="switch-row"><span><strong>Geo risk alert</strong><small>Alert on unusual location signals.</small></span><input type="checkbox" [(ngModel)]="settings.deviceIpProtection.geoRiskAlert" /><i></i></label>
            <label class="field-row"><span>Max failed attempts</span><input type="number" min="1" [(ngModel)]="settings.deviceIpProtection.maxFailedAttempts" /></label>
          </article>

          <article class="settings-card inner-page-card">
            <h2>Export & Data Access</h2>
            <p>Protect CSV/download flows and client contact visibility.</p>
            <label class="switch-row"><span><strong>Export protection enabled</strong><small>Apply stricter checks before data export.</small></span><input type="checkbox" [(ngModel)]="settings.exportDataAccess.exportProtectionEnabled" /><i></i></label>
            <label class="switch-row"><span><strong>Require owner approval for export</strong><small>High-risk exports require owner approval.</small></span><input type="checkbox" [(ngModel)]="settings.exportDataAccess.requireOwnerApprovalForExport" /><i></i></label>
            <label class="switch-row"><span><strong>Mask client contact for staff</strong><small>Hide full phone/contact in staff views.</small></span><input type="checkbox" [(ngModel)]="settings.exportDataAccess.maskClientContactForStaff" /><i></i></label>
          </article>

          <article class="settings-card inner-page-card">
            <h2>Approval & Audit</h2>
            <p>Configure audit logs, security alerts and role-change approvals.</p>
            <label class="switch-row"><span><strong>Audit log enabled</strong><small>Keep security events in audit logs.</small></span><input type="checkbox" [(ngModel)]="settings.approvalsAudit.auditLogEnabled" /><i></i></label>
            <label class="switch-row"><span><strong>Security alert notifications</strong><small>Notify owner/admin for security alerts.</small></span><input type="checkbox" [(ngModel)]="settings.approvalsAudit.securityAlertNotifications" /><i></i></label>
            <label class="switch-row"><span><strong>Daily security digest</strong><small>Send daily security summary.</small></span><input type="checkbox" [(ngModel)]="settings.approvalsAudit.dailySecurityDigest" /><i></i></label>
            <label class="switch-row"><span><strong>Approval required for role change</strong><small>Role updates require owner approval.</small></span><input type="checkbox" [(ngModel)]="settings.approvalsAudit.approvalRequiredForRoleChange" /><i></i></label>
          </article>

          <article class="settings-card preview-card">
            <h2>Policy Preview</h2>
            <p>Sessions expire after {{ settings.loginSession.sessionTimeoutMinutes }} minutes and refresh tokens last {{ settings.loginSession.refreshTokenDays }} day(s).</p>
            <p>Password minimum is {{ settings.passwordPolicy.minLength }} characters; 2FA owner rule is {{ settings.twoFactor.ownerRequired ? 'required' : 'not required' }}.</p>
            <p>Failed login limit is {{ settings.deviceIpProtection.maxFailedAttempts }} attempt(s); exports are {{ settings.exportDataAccess.exportProtectionEnabled ? 'protected' : 'unprotected' }}.</p>
            <p>Audit logs are {{ settings.approvalsAudit.auditLogEnabled ? 'ON' : 'OFF' }} and role-change approval is {{ settings.approvalsAudit.approvalRequiredForRoleChange ? 'required' : 'not required' }}.</p>
          </article>
        </section>
      </main>
    </section>
  `,
  styles: [`
    .security-settings-page {
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
      .security-settings-page {
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
export class SecuritySettingsComponent implements OnInit {
  settings = cloneSettings(DEFAULT_SETTINGS);
  audit: SecuritySettingsAudit = { ...DEFAULT_AUDIT };
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
    this.api.list<{ settings?: ApiRecord; audit?: ApiRecord }>('settings/security').subscribe({
      next: (res) => {
        this.settings = this.normalize(res.settings || {});
        this.audit = this.normalizeAudit(res.audit || {});
      },
      error: () => {
        this.error.set('Unable to load security settings');
      }
    });
  }

  save(): void {
    this.saving.set(true);
    this.error.set('');
    this.message.set('');
    const settings = this.normalize(this.settings);
    this.api.put<{ settings?: ApiRecord; audit?: ApiRecord }>('settings/security', { settings }).subscribe({
      next: (res) => {
        this.settings = this.normalize(res.settings || settings);
        this.audit = this.normalizeAudit(res.audit || {});
        this.message.set('Security settings saved');
        this.saving.set(false);
      },
      error: () => {
        this.error.set('Unable to save security settings');
        this.saving.set(false);
      }
    });
  }

  private normalize(input: ApiRecord): SecuritySettingsState {
    const loginSession = (input['loginSession'] || {}) as ApiRecord;
    const passwordPolicy = (input['passwordPolicy'] || {}) as ApiRecord;
    const twoFactor = (input['twoFactor'] || {}) as ApiRecord;
    const deviceIpProtection = (input['deviceIpProtection'] || {}) as ApiRecord;
    const exportDataAccess = (input['exportDataAccess'] || {}) as ApiRecord;
    const approvalsAudit = (input['approvalsAudit'] || {}) as ApiRecord;

    return {
      loginSession: {
        sessionTimeoutMinutes: numberValue(loginSession['sessionTimeoutMinutes'], DEFAULT_SETTINGS.loginSession.sessionTimeoutMinutes),
        refreshTokenDays: numberValue(loginSession['refreshTokenDays'], DEFAULT_SETTINGS.loginSession.refreshTokenDays),
        requireReauthForSensitiveActions: boolValue(loginSession['requireReauthForSensitiveActions'], DEFAULT_SETTINGS.loginSession.requireReauthForSensitiveActions),
        sessionKillSwitchEnabled: boolValue(loginSession['sessionKillSwitchEnabled'], DEFAULT_SETTINGS.loginSession.sessionKillSwitchEnabled)
      },
      passwordPolicy: {
        minLength: numberValue(passwordPolicy['minLength'], DEFAULT_SETTINGS.passwordPolicy.minLength),
        requireUppercase: boolValue(passwordPolicy['requireUppercase'], DEFAULT_SETTINGS.passwordPolicy.requireUppercase),
        requireNumber: boolValue(passwordPolicy['requireNumber'], DEFAULT_SETTINGS.passwordPolicy.requireNumber),
        requireSymbol: boolValue(passwordPolicy['requireSymbol'], DEFAULT_SETTINGS.passwordPolicy.requireSymbol),
        expiryDays: numberValue(passwordPolicy['expiryDays'], DEFAULT_SETTINGS.passwordPolicy.expiryDays)
      },
      twoFactor: {
        ownerRequired: boolValue(twoFactor['ownerRequired'], DEFAULT_SETTINGS.twoFactor.ownerRequired),
        staffOptional: boolValue(twoFactor['staffOptional'], DEFAULT_SETTINGS.twoFactor.staffOptional),
        rememberDeviceDays: numberValue(twoFactor['rememberDeviceDays'], DEFAULT_SETTINGS.twoFactor.rememberDeviceDays)
      },
      deviceIpProtection: {
        unknownDeviceAlert: boolValue(deviceIpProtection['unknownDeviceAlert'], DEFAULT_SETTINGS.deviceIpProtection.unknownDeviceAlert),
        ipBlocklistEnabled: boolValue(deviceIpProtection['ipBlocklistEnabled'], DEFAULT_SETTINGS.deviceIpProtection.ipBlocklistEnabled),
        geoRiskAlert: boolValue(deviceIpProtection['geoRiskAlert'], DEFAULT_SETTINGS.deviceIpProtection.geoRiskAlert),
        maxFailedAttempts: numberValue(deviceIpProtection['maxFailedAttempts'], DEFAULT_SETTINGS.deviceIpProtection.maxFailedAttempts)
      },
      exportDataAccess: {
        exportProtectionEnabled: boolValue(exportDataAccess['exportProtectionEnabled'], DEFAULT_SETTINGS.exportDataAccess.exportProtectionEnabled),
        requireOwnerApprovalForExport: boolValue(exportDataAccess['requireOwnerApprovalForExport'], DEFAULT_SETTINGS.exportDataAccess.requireOwnerApprovalForExport),
        maskClientContactForStaff: boolValue(exportDataAccess['maskClientContactForStaff'], DEFAULT_SETTINGS.exportDataAccess.maskClientContactForStaff)
      },
      approvalsAudit: {
        auditLogEnabled: boolValue(approvalsAudit['auditLogEnabled'], DEFAULT_SETTINGS.approvalsAudit.auditLogEnabled),
        securityAlertNotifications: boolValue(approvalsAudit['securityAlertNotifications'], DEFAULT_SETTINGS.approvalsAudit.securityAlertNotifications),
        dailySecurityDigest: boolValue(approvalsAudit['dailySecurityDigest'], DEFAULT_SETTINGS.approvalsAudit.dailySecurityDigest),
        approvalRequiredForRoleChange: boolValue(approvalsAudit['approvalRequiredForRoleChange'], DEFAULT_SETTINGS.approvalsAudit.approvalRequiredForRoleChange)
      }
    };
  }

  private normalizeAudit(input: ApiRecord): SecuritySettingsAudit {
    return {
      lastChangedBy: String(input['lastChangedBy'] || DEFAULT_AUDIT.lastChangedBy),
      lastChangedAt: String(input['lastChangedAt'] || DEFAULT_AUDIT.lastChangedAt)
    };
  }
}
