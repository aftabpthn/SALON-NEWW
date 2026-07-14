import { CommonModule } from '@angular/common';
import { Component, OnInit, computed, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { ApiRecord, ApiService } from '../core/api.service';
import { StateComponent } from '../shared/ui/state/state.component';
import { AuraDatePipe } from '../shared/pipes/aura-date.pipe';

@Component({
  selector: 'app-security-policy-center',
  standalone: true,
  imports: [AuraDatePipe, CommonModule, FormsModule, StateComponent],
  template: `
    <section class="policy-workspace">
      <app-state [loading]="loading()" [error]="error()"></app-state>

      <div class="page-heading">
        <div>
          <h1>Security Policy Center</h1>
          <span>Control device trust, PIN re-auth, export protection, field audit, access devices, fraud warnings and compliance evidence</span>
        </div>
        <button class="primary-button" type="button" (click)="savePolicies()">Save policies</button>
      </div>

      <div class="metric-strip">
        <article><span>Device trust</span><strong>{{ enabledLabel('deviceTrustEnabled') }}</strong></article>
        <article><span>PIN re-auth</span><strong>{{ enabledLabel('securityPinRequiredForRefund') }}</strong></article>
        <article><span>Export guard</span><strong>{{ enabledLabel('exportProtectionEnabled') }}</strong></article>
        <article><span>Risk score</span><strong>{{ latestRisk()?.riskScore ?? 0 }}</strong><small>{{ latestRisk()?.riskLevel || 'No signal' }}</small></article>
        <article><span>Access devices</span><strong>{{ managedDevices().devices?.length || 0 }}</strong></article>
        <article><span>Compliance</span><strong>{{ complianceReadiness()?.score || 0 }}%</strong><small>{{ complianceReadiness()?.status || 'Not checked' }}</small></article>
      </div>

      <section class="panel">
        <div class="section-title">
          <div>
            <h2>SOC2 / ISO Readiness</h2>
          </div>
          <div class="inline-row">
            <button class="ghost-button" type="button" (click)="loadComplianceReadiness()">Refresh readiness</button>
            <button class="primary-button" type="button" (click)="exportComplianceEvidence()">Export evidence</button>
          </div>
        </div>
        <div class="quick-grid" *ngIf="complianceReadiness() as readiness">
          <article class="action-card aura-card aura-card--type-action score-card">
            <strong>{{ readiness.score || 0 }}%</strong>
            <span>{{ readiness.status }} · {{ readiness.scoreBreakdown?.ready || 0 }} ready / {{ readiness.scoreBreakdown?.total || 0 }} controls</span>
          </article>
          <article class="action-card aura-card aura-card--type-action" *ngFor="let control of complianceControls()">
            <small>{{ control.framework }}</small>
            <strong>{{ control.label }}</strong>
            <span>{{ control.evidence }}</span>
            <span class="badge">{{ control.status }}</span>
          </article>
          <article class="action-card aura-card aura-card--type-action">
            <strong>{{ readiness.evidence?.immutableAuditHash?.slice(0, 16) || '-' }}</strong>
            <span>{{ readiness.evidence?.evidenceRows || 0 }} audit rows sampled for chain evidence.</span>
          </article>
          <article class="action-card aura-card aura-card--type-action">
            <strong>{{ readiness.evidence?.exportProtectionReady ? 'Ready' : 'Gap' }}</strong>
            <span>Evidence bundle: {{ readiness.evidence?.exportBundleId || '-' }}</span>
          </article>
        </div>
        <div class="risk-heatmap" *ngIf="riskHeatmapRows().length">
          <article *ngFor="let row of riskHeatmapRows()" [class]="'risk-tile ' + (row.risk || 'low')">
            <small>{{ row.area }}</small>
            <strong>{{ row.score || 0 }}</strong>
            <span>{{ row.risk }} · {{ row.evidence }}</span>
          </article>
        </div>
        <div class="evidence-export" *ngIf="evidenceExport() as evidence">
          <div>
            <strong>{{ evidence.bundleId }}</strong>
            <span>{{ evidence.framework?.join(', ') }} · {{ evidence.generatedAt | auraDate:'date' }}</span>
          </div>
          <pre>{{ evidence | json }}</pre>
        </div>
      </section>

      <section class="panel">
        <div class="section-title">
          <div>
            <h2>Policy controls</h2>
          </div>
          <button class="primary-button" type="button" (click)="savePolicies()">Save policies</button>
        </div>
        <div class="quick-grid">
          <label class="action-card aura-card aura-card--type-action policy-toggle" *ngFor="let toggle of toggles">
            <small>{{ toggle.layer }}</small>
            <strong>{{ toggle.label }}</strong>
            <span>{{ toggle.detail }}</span>
            <input type="checkbox" [ngModel]="policies()[toggle.key] === 'true'" (ngModelChange)="setPolicy(toggle.key, $event ? 'true' : 'false')" />
          </label>
        </div>
        <div class="form-grid">
          <label>
            <span>Daily export limit</span>
            <input type="number" [ngModel]="policies().exportDailyLimit" (ngModelChange)="setPolicy('exportDailyLimit', $event)" />
          </label>
          <label>
            <span>Max records per export</span>
            <input type="number" [ngModel]="policies().exportMaxRecords" (ngModelChange)="setPolicy('exportMaxRecords', $event)" />
          </label>
          <label>
            <span>Security PIN test</span>
            <div class="inline-row">
              <input type="password" [(ngModel)]="pin" placeholder="Enter PIN" />
              <button class="ghost-button" type="button" (click)="verifyPin()">Verify</button>
            </div>
          </label>
        </div>
      </section>

      <section class="panel">
        <div class="section-title">
          <div>
            <h2>Manage Access & Devices</h2>
          </div>
          <button class="ghost-button" type="button" (click)="loadNetflixPack()">Refresh access</button>
        </div>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Device</th><th>User</th><th>IP</th><th>Status</th><th>Last seen</th><th></th></tr></thead>
            <tbody>
              <tr *ngFor="let device of managedDeviceRows()">
                <td>{{ device.deviceName || device.deviceId }}</td>
                <td>{{ device.userId || '-' }}</td>
                <td>{{ device.ipAddress || '-' }}</td>
                <td><span class="badge">{{ device.status }}</span></td>
                <td>{{ device.lastSeenAt | auraDate:'date' }}</td>
                <td>
                  <button class="ghost-button mini" type="button" (click)="signOutDevice(device)">Sign out device</button>
                  <button class="ghost-button mini" type="button" (click)="signOutAll(device.userId)">Sign out all</button>
                </td>
              </tr>
              <tr *ngIf="!managedDeviceRows().length"><td colspan="6">No managed device records yet.</td></tr>
            </tbody>
          </table>
        </div>
      </section>

      <section class="panel">
        <div class="section-title">
          <div>
            <h2>Subscription Guard + Anti Sharing</h2>
          </div>
          <button class="ghost-button" type="button" (click)="evaluateAccountSharing()">Evaluate sharing</button>
        </div>
        <div class="quick-grid">
          <article class="action-card aura-card aura-card--type-action">
            <strong>{{ subscriptionEvents().length || 0 }} events</strong>
            <span>Reports/export/AI premium paths are guarded when subscription status is expired or suspended.</span>
          </article>
          <article class="action-card aura-card aura-card--type-action">
            <strong>{{ sharingEvents().length || 0 }} signals</strong>
            <span>Flags same account across many devices or branches.</span>
          </article>
        </div>
      </section>

      <section class="panel">
        <div class="section-title">
          <div>
            <h2>Fraud Warning Center</h2>
          </div>
          <button class="primary-button" type="button" (click)="saveFraudWarning()">Add warning</button>
        </div>
        <div class="form-grid">
          <label><span>Title</span><input [(ngModel)]="fraudForm.title" placeholder="Never share OTP" /></label>
          <label><span>Message</span><input [(ngModel)]="fraudForm.message" placeholder="Aura staff will never ask for password or OTP." /></label>
          <label><span>Severity</span><select [(ngModel)]="fraudForm.severity"><option value="info">Info</option><option value="warning">Warning</option><option value="critical">Critical</option></select></label>
        </div>
        <div class="quick-grid">
          <article class="action-card aura-card aura-card--type-action" *ngFor="let warning of fraudWarnings()">
            <small>{{ warning.severity }}</small>
            <strong>{{ warning.title }}</strong>
            <span>{{ warning.message }}</span>
          </article>
        </div>
      </section>

      <section class="panel">
        <div class="section-title">
          <div>
            <h2>Responsible Disclosure / Bug Report</h2>
          </div>
          <button class="primary-button" type="button" (click)="createDisclosureReport()">Submit report</button>
        </div>
        <div class="form-grid">
          <label><span>Reporter</span><input [(ngModel)]="disclosureForm.reporterName" placeholder="Name" /></label>
          <label><span>Contact</span><input [(ngModel)]="disclosureForm.reporterContact" placeholder="email / phone" /></label>
          <label><span>Summary</span><input [(ngModel)]="disclosureForm.summary" placeholder="Security issue summary" /></label>
        </div>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Summary</th><th>Reporter</th><th>Severity</th><th>Status</th><th>Created</th></tr></thead>
            <tbody>
              <tr *ngFor="let report of disclosureReports()">
                <td>{{ report.summary }}</td>
                <td>{{ report.reporterName || '-' }}</td>
                <td>{{ report.severity }}</td>
                <td>{{ report.status }}</td>
                <td>{{ report.createdAt | auraDate:'date' }}</td>
              </tr>
              <tr *ngIf="!disclosureReports().length"><td colspan="5">No disclosure reports yet.</td></tr>
            </tbody>
          </table>
        </div>
      </section>

      <section class="panel">
        <div class="section-title">
          <div>
            <h2>Zenoti-Style Enterprise Pack</h2>
          </div>
          <button class="ghost-button" type="button" (click)="loadZenotiPack()">Refresh pack</button>
        </div>
        <div class="quick-grid">
          <article class="action-card aura-card aura-card--type-action">
            <strong>{{ ssoSettings().length || 0 }} settings</strong>
            <span>SAML/OIDC provider policy placeholder for owner/admin roles.</span>
            <button class="ghost-button mini" type="button" (click)="saveSsoSetting()">Save draft</button>
          </article>
          <article class="action-card aura-card aura-card--type-action">
            <strong>{{ privilegedSessions().length || 0 }} sessions</strong>
            <span>Temporary elevated-action window for sensitive admin work.</span>
            <button class="ghost-button mini" type="button" (click)="startPrivilegedSession()">Start 15 min</button>
          </article>
          <article class="action-card aura-card aura-card--type-action">
            <strong>{{ apiClients().length || 0 }} clients</strong>
            <span>Register API clients with hashed tokens and revocation support.</span>
            <button class="ghost-button mini" type="button" (click)="createApiClient()">Create client</button>
          </article>
          <article class="action-card aura-card aura-card--type-action">
            <strong>{{ paymentGuardEvents().length || 0 }} events</strong>
            <span>Track payment data access and suspicious refund/payment events.</span>
            <button class="ghost-button mini" type="button" (click)="recordPaymentGuard()">Record event</button>
          </article>
          <article class="action-card aura-card aura-card--type-action">
            <strong>{{ privacyRequests().length || 0 }} requests</strong>
            <span>Track access/export/delete privacy requests for clients.</span>
            <button class="ghost-button mini" type="button" (click)="createPrivacyRequest()">Create request</button>
          </article>
        </div>
      </section>

      <section class="panel">
        <div class="section-title">
          <div>
            <h2>Risk Scoring Engine</h2>
          </div>
          <button class="ghost-button" type="button" (click)="evaluateRisk()">Evaluate now</button>
        </div>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Score</th><th>Level</th><th>Reasons</th><th>IP</th><th>Created</th></tr></thead>
            <tbody>
              <tr *ngFor="let event of riskEvents()">
                <td>{{ event.riskScore }}</td>
                <td><span class="badge">{{ event.riskLevel }}</span></td>
                <td>{{ joinList(event.reasons) || '-' }}</td>
                <td>{{ event.ipAddress || '-' }}</td>
                <td>{{ event.createdAt | auraDate:'date' }}</td>
              </tr>
              <tr *ngIf="!riskEvents().length"><td colspan="5">No risk events yet.</td></tr>
            </tbody>
          </table>
        </div>
      </section>

      <section class="panel">
        <div class="section-title">
          <div>
            <h2>Sensitive Action Approval</h2>
          </div>
          <button class="primary-button" type="button" (click)="createApproval()">Create request</button>
        </div>
        <div class="form-grid">
          <label><span>Action type</span><input [(ngModel)]="approvalForm.actionType" placeholder="refund_override" /></label>
          <label><span>Summary</span><input [(ngModel)]="approvalForm.summary" placeholder="Approve high-value refund" /></label>
        </div>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Action</th><th>Summary</th><th>Status</th><th>Requested by</th><th>Created</th><th></th></tr></thead>
            <tbody>
              <tr *ngFor="let approval of approvals()">
                <td>{{ approval.actionType }}</td>
                <td>{{ approval.summary }}</td>
                <td><span class="badge">{{ approval.status }}</span></td>
                <td>{{ approval.requestedBy || '-' }}</td>
                <td>{{ approval.createdAt | auraDate:'date' }}</td>
                <td>
                  <button class="ghost-button mini" type="button" [disabled]="approval.status !== 'pending'" (click)="decideApproval(approval, 'approve')">Approve</button>
                  <button class="ghost-button mini" type="button" [disabled]="approval.status !== 'pending'" (click)="decideApproval(approval, 'reject')">Reject</button>
                </td>
              </tr>
              <tr *ngIf="!approvals().length"><td colspan="6">No approval requests yet.</td></tr>
            </tbody>
          </table>
        </div>
      </section>

      <section class="panel">
        <div class="section-title">
          <div>
            <h2>IP Access Rules</h2>
          </div>
          <button class="primary-button" type="button" (click)="createAccessRule()">Add rule</button>
        </div>
        <div class="form-grid">
          <label><span>IP / match value</span><input [(ngModel)]="ruleForm.matchValue" placeholder="103.21.244.0" /></label>
          <label><span>Effect</span><select [(ngModel)]="ruleForm.effect"><option value="watch">Watch</option><option value="deny">Deny signal</option><option value="allow">Allow</option></select></label>
          <label><span>Reason</span><input [(ngModel)]="ruleForm.reason" placeholder="Suspicious export attempts" /></label>
        </div>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Type</th><th>Value</th><th>Effect</th><th>Reason</th><th>Status</th><th></th></tr></thead>
            <tbody>
              <tr *ngFor="let rule of accessRules()">
                <td>{{ rule.ruleType }}</td>
                <td>{{ rule.matchValue }}</td>
                <td>{{ rule.effect }}</td>
                <td>{{ rule.reason || '-' }}</td>
                <td>{{ rule.status }}</td>
                <td><button class="ghost-button mini" type="button" [disabled]="rule.status !== 'active'" (click)="disableRule(rule)">Disable</button></td>
              </tr>
              <tr *ngIf="!accessRules().length"><td colspan="6">No access rules yet.</td></tr>
            </tbody>
          </table>
        </div>
      </section>

      <section class="panel">
        <div class="section-title">
          <div>
            <h2>Data Masking Policy</h2>
          </div>
          <button class="primary-button" type="button" (click)="saveMask()">Save mask</button>
        </div>
        <div class="form-grid">
          <label><span>Entity</span><input [(ngModel)]="maskForm.entityType" placeholder="client" /></label>
          <label><span>Field</span><input [(ngModel)]="maskForm.fieldName" placeholder="mobile" /></label>
          <label><span>Mask</span><select [(ngModel)]="maskForm.maskType"><option value="partial">Partial</option><option value="full">Full</option><option value="last4">Last 4</option></select></label>
        </div>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Entity</th><th>Field</th><th>Mask</th><th>Allowed roles</th><th>Status</th></tr></thead>
            <tbody>
              <tr *ngFor="let mask of dataMasks()">
                <td>{{ mask.entityType }}</td>
                <td>{{ mask.fieldName }}</td>
                <td>{{ mask.maskType }}</td>
                <td>{{ mask.rolesAllowed }}</td>
                <td>{{ mask.status }}</td>
              </tr>
              <tr *ngIf="!dataMasks().length"><td colspan="5">No data masking policy yet.</td></tr>
            </tbody>
          </table>
        </div>
      </section>

      <section class="panel">
        <div class="section-title"><h2>Security Response Playbooks</h2></div>
        <div class="quick-grid">
          <article class="action-card aura-card aura-card--type-action" *ngFor="let playbook of playbooks()">
            <small>{{ playbook.severity }}</small>
            <strong>{{ playbook.title }}</strong>
            <span>{{ joinList(playbook.checklist) }}</span>
          </article>
        </div>
      </section>

      <section class="panel">
        <div class="section-title">
          <div>
            <h2>Device Trust Layer</h2>
          </div>
          <button class="ghost-button" type="button" (click)="observeDevice()">Observe this device</button>
        </div>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Device</th><th>User</th><th>IP</th><th>Status</th><th>Last seen</th><th></th></tr></thead>
            <tbody>
              <tr *ngFor="let device of devices()">
                <td>{{ device.deviceName || device.deviceId }}</td>
                <td>{{ device.userId || '-' }}</td>
                <td>{{ device.ipAddress || '-' }}</td>
                <td><span class="badge">{{ device.status }}</span></td>
                <td>{{ device.lastSeenAt | auraDate:'date' }}</td>
                <td>
                  <button class="ghost-button mini" type="button" (click)="trustDevice(device)">Trust</button>
                  <button class="ghost-button mini" type="button" (click)="revokeDevice(device)">Revoke</button>
                </td>
              </tr>
              <tr *ngIf="!devices().length"><td colspan="6">No trusted-device records yet.</td></tr>
            </tbody>
          </table>
        </div>
      </section>

      <section class="panel">
        <div class="section-title"><h2>Field-Level Audit</h2></div>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Entity</th><th>Field</th><th>Old</th><th>New</th><th>User</th><th>Created</th></tr></thead>
            <tbody>
              <tr *ngFor="let log of fieldLogs()">
                <td>{{ log.entityType }} {{ log.entityId }}</td>
                <td>{{ log.fieldName }}</td>
                <td>{{ log.oldValue }}</td>
                <td>{{ log.newValue }}</td>
                <td>{{ log.userId || '-' }}</td>
                <td>{{ log.createdAt | auraDate:'date' }}</td>
              </tr>
              <tr *ngIf="!fieldLogs().length"><td colspan="6">No field audit records yet.</td></tr>
            </tbody>
          </table>
        </div>
      </section>
    </section>
  `,
  styles: [`
    .policy-workspace { background: #FAF8F6; color: #151827; min-height: 100vh; gap: 8px; padding: 8px; }
    .command-bar { background: #111827; color: #fff; display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 12px 18px; box-shadow: 0 2px 10px rgba(15, 23, 42, 0.16); }
    .brand-block, .command-actions, .header-actions, .page-heading, .section-title, .inline-row { display: flex; align-items: center; gap: 10px; }
    .brand-mark { width: 34px; height: 34px; border-radius: 8px; display: grid; place-items: center; background: #4B1238; font-weight: 900; }
    .brand-block small { display: block; color: #94a3b8; font-size: 10px; font-weight: 800; letter-spacing: 0; }
    .brand-block strong { display: block; font-size: 16px; }
    .zenoti-button, .primary-button, .ghost-button { border: 1px solid #E7DDD6; background: #fff; color: #8B5E7C; border-radius: 4px; padding: 8px 13px; font-weight: 800; cursor: pointer; text-decoration: none; }
    .zenoti-button.primary, .primary-button { background: #4B1238; border-color: #4B1238; color: #fff; }
    .zenoti-button:disabled, .ghost-button:disabled { opacity: 0.6; cursor: not-allowed; }
    .zenoti-header { display: grid; grid-template-columns: 1fr auto; gap: 10px; align-items: center; padding: 26px 16px 12px; border: 1px solid #d7e2ea; }
    .zenoti-header select { grid-column: 2; width: min(620px, 100%); border: 1px solid #E7DDD6; border-radius: 4px; padding: 9px 12px; font-weight: 800; background: #fff; }
    .page-heading { justify-content: space-between; padding: 14px 16px; border: 1px solid #d7e2ea; }
    .page-heading h1 { margin: 0 0 4px; font-size: 24px; }
    .page-heading span, .section-title p, .section-title span, small, td, .form-grid label span { color: #64748b; }
    .metric-strip { display: grid; grid-template-columns: repeat(6, minmax(150px, 1fr)); border-left: 1px solid #d7e2ea; border-right: 1px solid #d7e2ea; border-bottom: 1px solid #d7e2ea; background: #f8fafc; }
    .metric-strip article { padding: 14px 16px; border-right: 1px solid #E7DDD6; border-top: 4px solid #E7DDD6; min-height: 86px; }
    .metric-strip article:nth-child(2) { border-top-color: #4B1238; }
    .metric-strip article:nth-child(3) { border-top-color: #b7791f; }
    .metric-strip article:nth-child(4) { border-top-color: #b91c1c; }
    .metric-strip article:nth-child(5) { border-top-color: #7c3aed; }
    .metric-strip article:nth-child(6) { border-top-color: #C87D4B; }
    .metric-strip span { display: block; color: #64748b; font-size: 12px; font-weight: 900; }
    .metric-strip strong { display: block; margin-top: 6px; font-size: 25px; }
    .panel { margin: 16px; background: #fff; border: 1px solid #d7e2ea; border-radius: 4px; padding: 14px; }
    .section-title { justify-content: space-between; margin-bottom: 12px; }
    .section-title h2 { margin: 0 0 4px; font-size: 16px; }
    .section-title p { margin: 0; }
    .quick-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; }
    .action-card { border: 1px solid #d7e2ea; border-radius: 4px; padding: 12px; min-height: 102px; display: grid; gap: 7px; align-content: start; background: #fff; }
    .action-card strong, .action-card span { display: block; }
    .action-card span { color: #64748b; font-size: 12px; }
    .score-card strong { font-size: 28px; }
    .badge { display: inline-block; border-radius: 999px; background: #F8EEF4; color: #4B1238; padding: 5px 9px; font-weight: 800; font-size: 12px; }
    .table-wrap { overflow: auto; border: 1px solid #d7e2ea; border-radius: 4px; }
    table { width: 100%; border-collapse: collapse; min-width: 880px; }
    th { background: #f1f5f9; color: #475569; font-size: 12px; text-align: left; text-transform: uppercase; }
    th, td { border-bottom: 1px solid #d7e2ea; padding: 12px; vertical-align: top; }
    input, select { border: 1px solid #d7e2ea; border-radius: 4px; min-height: 38px; padding: 8px 10px; color: #111827; background: #fff; }
    .mini { padding: 6px 10px; }
    .policy-toggle { position: relative; }
    .policy-toggle input { position: absolute; right: 16px; top: 16px; width: 20px; height: 20px; accent-color: #4B1238; }
    .form-grid { display: grid; gap: 12px; grid-template-columns: repeat(3, minmax(0, 1fr)); margin-top: 18px; }
    .form-grid label span { display: block; margin-bottom: 8px; font-weight: 800; }
    .risk-heatmap { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 10px; margin-top: 14px; }
    .risk-tile, .evidence-export { border: 1px solid #E7DDD6; border-radius: 4px; padding: 14px; background: #fff; display: grid; gap: 6px; }
    .risk-tile strong { font-size: 24px; }
    .risk-tile.low { border-color: #E7DDD6; background: #FAF8F6; }
    .risk-tile.warning { border-color: #E7DDD6; background: #FAF8F6; }
    .risk-tile.high, .risk-tile.critical { border-color: #E7DDD6; background: #FAF8F6; }
    .evidence-export { margin-top: 14px; }
    .evidence-export pre { max-height: 260px; overflow: auto; margin: 0; border-radius: 8px; background: #0f172a; color: #E7DDD6; padding: 12px; white-space: pre-wrap; }
    @media (max-width: 1180px) {
      .metric-strip { grid-template-columns: repeat(3, 1fr); }
      .quick-grid { grid-template-columns: repeat(2, 1fr); }
      .zenoti-header { grid-template-columns: 1fr; }
      .zenoti-header select { grid-column: auto; }
    }
    @media (max-width: 900px) { .form-grid, .risk-heatmap { grid-template-columns: 1fr; } .inline-row { flex-direction: column; align-items: stretch; } }
    @media (max-width: 720px) {
      .command-bar, .page-heading, .section-title { align-items: stretch; flex-direction: column; }
      .metric-strip, .quick-grid { grid-template-columns: 1fr; }
      .header-actions { flex-wrap: wrap; }
    }
  `]
})
export class SecurityPolicyCenterComponent implements OnInit {
  readonly policies = signal<ApiRecord>({});
  readonly devices = signal<ApiRecord[]>([]);
  readonly fieldLogs = signal<ApiRecord[]>([]);
  readonly riskEvents = signal<ApiRecord[]>([]);
  readonly approvals = signal<ApiRecord[]>([]);
  readonly accessRules = signal<ApiRecord[]>([]);
  readonly dataMasks = signal<ApiRecord[]>([]);
  readonly playbooks = signal<ApiRecord[]>([]);
  readonly ssoSettings = signal<ApiRecord[]>([]);
  readonly privilegedSessions = signal<ApiRecord[]>([]);
  readonly apiClients = signal<ApiRecord[]>([]);
  readonly paymentGuardEvents = signal<ApiRecord[]>([]);
  readonly privacyRequests = signal<ApiRecord[]>([]);
  readonly managedDevices = signal<ApiRecord>({ devices: [], activeTokens: [], revocations: [] });
  readonly subscriptionEvents = signal<ApiRecord[]>([]);
  readonly sharingEvents = signal<ApiRecord[]>([]);
  readonly fraudWarnings = signal<ApiRecord[]>([]);
  readonly disclosureReports = signal<ApiRecord[]>([]);
  readonly complianceReadiness = signal<ApiRecord | null>(null);
  readonly evidenceExport = signal<ApiRecord | null>(null);
  readonly complianceControls = computed(() => this.complianceReadiness()?.controls || []);
  readonly managedDeviceRows = computed(() => this.managedDevices().devices || []);
  readonly loading = signal(false);
  readonly error = signal('');
  pin = '';
  approvalForm: ApiRecord = { actionType: 'refund_override', summary: '' };
  ruleForm: ApiRecord = { ruleType: 'ip', matchValue: '', effect: 'watch', reason: '' };
  maskForm: ApiRecord = { entityType: 'client', fieldName: 'mobile', maskType: 'partial', rolesAllowed: 'owner,admin,superAdmin' };
  fraudForm: ApiRecord = { title: 'Never share OTP or password', message: 'Aura staff will never ask for OTP, password, card number or recovery code.', severity: 'warning' };
  disclosureForm: ApiRecord = { reporterName: '', reporterContact: '', summary: '', details: '', severity: 'warning' };

  readonly toggles = [
    { key: 'deviceTrustEnabled', layer: 'Device Trust Layer', label: 'Track trusted devices', detail: 'Observe browser/device identity and let owner/admin trust or revoke it.' },
    { key: 'securityPinRequiredForRefund', layer: 'Security PIN Re-auth', label: 'Require PIN for refunds', detail: 'Use manager PIN before high-risk money actions.' },
    { key: 'securityPinRequiredForExport', layer: 'Export Protection', label: 'Require PIN for exports', detail: 'Protect CSV/PDF/download routes with PIN verification when enabled.' },
    { key: 'exportProtectionEnabled', layer: 'Export Protection', label: 'Monitor export/download routes', detail: 'Detect export-like routes and add sensitive-access signals.' },
    { key: 'fieldAuditEnabled', layer: 'Field-Level Audit', label: 'Record sensitive field changes', detail: 'Store before/after values for investigation-ready history.' },
    { key: 'sessionRiskScoreEnabled', layer: 'Risk Scoring Engine', label: 'Session risk scoring', detail: 'Scores device, IP, open alerts and sensitive-route activity.' },
    { key: 'sensitiveApprovalRequired', layer: 'Sensitive Approval', label: 'Approval queue ready', detail: 'Routes risky admin actions through owner/admin approval.' },
    { key: 'ipAccessRulesEnabled', layer: 'IP Access Rules', label: 'IP rules enabled', detail: 'Watch, allow or deny-signal suspicious network sources.' },
    { key: 'dataMaskingEnabled', layer: 'Data Masking Policy', label: 'Data masking enabled', detail: 'Marks sensitive fields for masking by role.' },
    { key: 'securityPlaybooksEnabled', layer: 'Security Playbooks', label: 'Playbooks enabled', detail: 'Shows response checklists for security incidents.' },
    { key: 'ssoEnforcementReady', layer: 'SSO Readiness', label: 'SSO enforcement ready', detail: 'Prepares SAML/OIDC enforcement policy for admin roles.' },
    { key: 'privilegedSessionRequired', layer: 'Privileged Sessions', label: 'Privileged session required', detail: 'Uses temporary elevated sessions for sensitive admin work.' },
    { key: 'apiClientGovernanceEnabled', layer: 'API Governance', label: 'API client governance', detail: 'Controls API clients with hashed tokens and revocation.' },
    { key: 'paymentDataGuardEnabled', layer: 'Payment Guard', label: 'Payment data guard', detail: 'Tracks suspicious payment/refund data events.' },
    { key: 'privacyGovernanceEnabled', layer: 'Privacy Governance', label: 'Privacy request governance', detail: 'Tracks client access/export/delete privacy requests.' },
    { key: 'manageAccessDevicesEnabled', layer: 'Manage Access & Devices', label: 'Access/device control', detail: 'Shows devices and active sessions for owner/admin review.' },
    { key: 'sessionKillSwitchEnabled', layer: 'Session Kill Switch', label: 'Session kill switch', detail: 'Owner/admin can sign out one device or all user devices.' },
    { key: 'subscriptionGuardEnabled', layer: 'Subscription Guard', label: 'Subscription guard', detail: 'Locks premium reports/export/AI modules on expired plans.' },
    { key: 'antiAccountSharingEnabled', layer: 'Anti Account Sharing', label: 'Account sharing detection', detail: 'Flags many devices or branches using the same account.' },
    { key: 'fraudWarningCenterEnabled', layer: 'Fraud Warning Center', label: 'Fraud warning center', detail: 'Client-visible phishing and OTP safety messages.' },
    { key: 'responsibleDisclosureEnabled', layer: 'Bug Report', label: 'Responsible disclosure', detail: 'Security issue report queue for owner/admin review.' },
    { key: 'encryptionAtRestReady', layer: 'SOC2 / ISO Readiness', label: 'Encryption-at-rest ready', detail: 'Marks encryption-at-rest rollout as ready after DB/key infrastructure is configured.' },
    { key: 'immutableAuditEvidenceEnabled', layer: 'SOC2 / ISO Readiness', label: 'Immutable audit evidence', detail: 'Produces tenant audit evidence hash from append-only security and activity logs.' },
    { key: 'soc2ReadinessEnabled', layer: 'SOC2 / ISO Readiness', label: 'SOC2 readiness', detail: 'Tracks SOC2 control evidence for access, audit, privacy and incident response.' },
    { key: 'iso27001ReadinessEnabled', layer: 'SOC2 / ISO Readiness', label: 'ISO 27001 readiness', detail: 'Tracks ISO-style access, encryption, audit and incident control evidence.' }
  ];

  constructor(private readonly api: ApiService, private readonly router: Router) {}

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.error.set('');
    this.api.list<{ policies: ApiRecord }>('security/policy').subscribe({
      next: (result) => {
        this.policies.set(result.policies || {});
        this.loadDevices();
        this.loadFieldAudit();
        this.loadRiskEvents();
        this.loadApprovals();
        this.loadAccessRules();
        this.loadDataMasks();
        this.loadPlaybooks();
        this.loadComplianceReadiness();
        this.loadZenotiPack();
        this.loadNetflixPack();
      },
      error: (error) => { this.error.set(this.api.errorText(error)); this.loading.set(false); }
    });
  }

  loadDevices(): void {
    this.api.list<{ devices: ApiRecord[] }>('security/devices').subscribe({
      next: (result) => this.devices.set(result.devices || []),
      error: (error) => this.error.set(this.api.errorText(error))
    });
  }

  loadFieldAudit(): void {
    this.api.list<{ logs: ApiRecord[] }>('security/field-audit').subscribe({
      next: (result) => { this.fieldLogs.set(result.logs || []); this.loading.set(false); },
      error: (error) => { this.error.set(this.api.errorText(error)); this.loading.set(false); }
    });
  }

  loadRiskEvents(): void {
    this.api.list<{ events: ApiRecord[] }>('security/risk/events').subscribe({
      next: (result) => this.riskEvents.set(result.events || []),
      error: (error) => this.error.set(this.api.errorText(error))
    });
  }

  loadApprovals(): void {
    this.api.list<{ approvals: ApiRecord[] }>('security/approvals').subscribe({
      next: (result) => this.approvals.set(result.approvals || []),
      error: (error) => this.error.set(this.api.errorText(error))
    });
  }

  loadAccessRules(): void {
    this.api.list<{ rules: ApiRecord[] }>('security/access-rules').subscribe({
      next: (result) => this.accessRules.set(result.rules || []),
      error: (error) => this.error.set(this.api.errorText(error))
    });
  }

  loadDataMasks(): void {
    this.api.list<{ masks: ApiRecord[] }>('security/data-masks').subscribe({
      next: (result) => this.dataMasks.set(result.masks || []),
      error: (error) => this.error.set(this.api.errorText(error))
    });
  }

  loadPlaybooks(): void {
    this.api.list<{ playbooks: ApiRecord[] }>('security/playbooks').subscribe({
      next: (result) => this.playbooks.set(result.playbooks || []),
      error: (error) => this.error.set(this.api.errorText(error))
    });
  }

  loadComplianceReadiness(): void {
    this.api.list<{ readiness: ApiRecord }>('security/compliance-readiness').subscribe({
      next: (result) => {
        this.complianceReadiness.set(result.readiness || null);
        if (result.readiness?.evidenceExport) this.evidenceExport.set(result.readiness.evidenceExport);
      },
      error: (error) => this.error.set(this.api.errorText(error))
    });
  }

  exportComplianceEvidence(): void {
    this.api.list<{ evidence: ApiRecord }>('security/compliance-evidence/export').subscribe({
      next: (result) => this.evidenceExport.set(result.evidence || null),
      error: (error) => this.error.set(this.api.errorText(error))
    });
  }

  loadZenotiPack(): void {
    this.api.list<{ settings: ApiRecord[] }>('security/sso-settings').subscribe({ next: (result) => this.ssoSettings.set(result.settings || []), error: (error) => this.error.set(this.api.errorText(error)) });
    this.api.list<{ sessions: ApiRecord[] }>('security/privileged-sessions').subscribe({ next: (result) => this.privilegedSessions.set(result.sessions || []), error: (error) => this.error.set(this.api.errorText(error)) });
    this.api.list<{ clients: ApiRecord[] }>('security/api-clients').subscribe({ next: (result) => this.apiClients.set(result.clients || []), error: (error) => this.error.set(this.api.errorText(error)) });
    this.api.list<{ events: ApiRecord[] }>('security/payment-guard').subscribe({ next: (result) => this.paymentGuardEvents.set(result.events || []), error: (error) => this.error.set(this.api.errorText(error)) });
    this.api.list<{ requests: ApiRecord[] }>('security/privacy-requests').subscribe({ next: (result) => this.privacyRequests.set(result.requests || []), error: (error) => this.error.set(this.api.errorText(error)) });
  }

  loadNetflixPack(): void {
    this.api.list<ApiRecord>('security/access/devices').subscribe({ next: (result) => this.managedDevices.set(result || { devices: [], activeTokens: [], revocations: [] }), error: (error) => this.error.set(this.api.errorText(error)) });
    this.api.list<{ events: ApiRecord[] }>('security/subscription-guard').subscribe({ next: (result) => this.subscriptionEvents.set(result.events || []), error: (error) => this.error.set(this.api.errorText(error)) });
    this.api.list<{ events: ApiRecord[] }>('security/account-sharing').subscribe({ next: (result) => this.sharingEvents.set(result.events || []), error: (error) => this.error.set(this.api.errorText(error)) });
    this.api.list<{ warnings: ApiRecord[] }>('security/fraud-warnings').subscribe({ next: (result) => this.fraudWarnings.set(result.warnings || []), error: (error) => this.error.set(this.api.errorText(error)) });
    this.api.list<{ reports: ApiRecord[] }>('security/disclosure-reports').subscribe({ next: (result) => this.disclosureReports.set(result.reports || []), error: (error) => this.error.set(this.api.errorText(error)) });
  }

  setPolicy(key: string, value: string): void {
    this.policies.set({ ...this.policies(), [key]: String(value) });
  }

  savePolicies(): void {
    this.api.put<{ policies: ApiRecord }>('security/policy', this.policies()).subscribe({
      next: (result) => this.policies.set(result.policies || {}),
      error: (error) => this.error.set(this.api.errorText(error))
    });
  }

  verifyPin(): void {
    this.api.post('security/pin/verify', { pin: this.pin }).subscribe({
      next: () => { this.pin = ''; this.error.set(''); },
      error: (error) => this.error.set(this.api.errorText(error))
    });
  }

  observeDevice(): void {
    this.api.post('security/devices/observe', {}).subscribe({
      next: () => this.loadDevices(),
      error: (error) => this.error.set(this.api.errorText(error))
    });
  }

  trustDevice(device: ApiRecord): void {
    this.api.post(`security/devices/${device.id}/trust`, {}).subscribe({ next: () => this.loadDevices(), error: (error) => this.error.set(this.api.errorText(error)) });
  }

  revokeDevice(device: ApiRecord): void {
    this.api.post(`security/devices/${device.id}/revoke`, {}).subscribe({ next: () => this.loadDevices(), error: (error) => this.error.set(this.api.errorText(error)) });
  }

  evaluateRisk(): void {
    this.api.post('security/risk/evaluate', {}).subscribe({ next: () => this.loadRiskEvents(), error: (error) => this.error.set(this.api.errorText(error)) });
  }

  createApproval(): void {
    this.api.post('security/approvals', this.approvalForm).subscribe({
      next: () => { this.approvalForm = { actionType: 'refund_override', summary: '' }; this.loadApprovals(); },
      error: (error) => this.error.set(this.api.errorText(error))
    });
  }

  decideApproval(approval: ApiRecord, decision: 'approve' | 'reject'): void {
    this.api.post(`security/approvals/${approval.id}/${decision}`, {}).subscribe({ next: () => this.loadApprovals(), error: (error) => this.error.set(this.api.errorText(error)) });
  }

  createAccessRule(): void {
    this.api.post('security/access-rules', this.ruleForm).subscribe({
      next: () => { this.ruleForm = { ruleType: 'ip', matchValue: '', effect: 'watch', reason: '' }; this.loadAccessRules(); },
      error: (error) => this.error.set(this.api.errorText(error))
    });
  }

  disableRule(rule: ApiRecord): void {
    this.api.post(`security/access-rules/${rule.id}/disable`, {}).subscribe({ next: () => this.loadAccessRules(), error: (error) => this.error.set(this.api.errorText(error)) });
  }

  saveMask(): void {
    this.api.post('security/data-masks', this.maskForm).subscribe({
      next: () => { this.maskForm = { entityType: 'client', fieldName: 'mobile', maskType: 'partial', rolesAllowed: 'owner,admin,superAdmin' }; this.loadDataMasks(); },
      error: (error) => this.error.set(this.api.errorText(error))
    });
  }

  saveSsoSetting(): void {
    this.api.post('security/sso-settings', { provider: 'saml', domainHint: 'company.com', status: 'draft' }).subscribe({ next: () => this.loadZenotiPack(), error: (error) => this.error.set(this.api.errorText(error)) });
  }

  startPrivilegedSession(): void {
    this.api.post('security/privileged-sessions', { purpose: 'Sensitive admin operation', minutes: 15 }).subscribe({ next: () => this.loadZenotiPack(), error: (error) => this.error.set(this.api.errorText(error)) });
  }

  createApiClient(): void {
    this.api.post('security/api-clients', { clientName: 'Enterprise integration', scopes: 'read:security,write:security' }).subscribe({ next: () => this.loadZenotiPack(), error: (error) => this.error.set(this.api.errorText(error)) });
  }

  recordPaymentGuard(): void {
    this.api.post('security/payment-guard', { eventType: 'payment_data_review', summary: 'Payment data guard event created from policy center', severity: 'info' }).subscribe({ next: () => this.loadZenotiPack(), error: (error) => this.error.set(this.api.errorText(error)) });
  }

  createPrivacyRequest(): void {
    this.api.post('security/privacy-requests', { requestType: 'access_review', summary: 'Client privacy request review', subjectType: 'client' }).subscribe({ next: () => this.loadZenotiPack(), error: (error) => this.error.set(this.api.errorText(error)) });
  }

  signOutDevice(device: ApiRecord): void {
    const deviceId = device.deviceId || device.id;
    this.api.post(`security/access/devices/${deviceId}/sign-out`, {}).subscribe({ next: () => this.loadNetflixPack(), error: (error) => this.error.set(this.api.errorText(error)) });
  }

  signOutAll(userId: string): void {
    this.api.post('security/access/sign-out-all', { userId }).subscribe({ next: () => this.loadNetflixPack(), error: (error) => this.error.set(this.api.errorText(error)) });
  }

  evaluateAccountSharing(): void {
    this.api.post('security/account-sharing/evaluate', {}).subscribe({ next: () => this.loadNetflixPack(), error: (error) => this.error.set(this.api.errorText(error)) });
  }

  saveFraudWarning(): void {
    this.api.post('security/fraud-warnings', this.fraudForm).subscribe({
      next: () => { this.fraudForm = { title: 'Never share OTP or password', message: 'Aura staff will never ask for OTP, password, card number or recovery code.', severity: 'warning' }; this.loadNetflixPack(); },
      error: (error) => this.error.set(this.api.errorText(error))
    });
  }

  createDisclosureReport(): void {
    this.api.post('security/disclosure-reports', this.disclosureForm).subscribe({
      next: () => { this.disclosureForm = { reporterName: '', reporterContact: '', summary: '', details: '', severity: 'warning' }; this.loadNetflixPack(); },
      error: (error) => this.error.set(this.api.errorText(error))
    });
  }

  runQuickAction(event: Event): void {
    const select = event.target as HTMLSelectElement;
    if (select.value === 'refresh') this.load();
    if (select.value === 'save') this.savePolicies();
    if (select.value === 'risk') this.evaluateRisk();
    if (select.value === 'devices') this.loadNetflixPack();
    if (select.value === 'alerts') this.router.navigate(['/security-alerts']);
    select.selectedIndex = 0;
  }

  enabledLabel(key: string): string {
    return this.policies()[key] === 'false' ? 'Off' : 'On';
  }

  latestRisk(): ApiRecord | null {
    return this.riskEvents()[0] || null;
  }

  riskHeatmapRows(): ApiRecord[] {
    return (this.complianceReadiness()?.riskHeatmap || []) as ApiRecord[];
  }

  joinList(value: unknown): string {
    return Array.isArray(value) ? value.join(', ') : String(value || '');
  }

  zenotiPackCount(): number {
    return this.ssoSettings().length + this.privilegedSessions().length + this.apiClients().length + this.paymentGuardEvents().length + this.privacyRequests().length;
  }
}
