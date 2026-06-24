import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';

type ShieldLayer = {
  level: string;
  title: string;
  status: string;
  detail: string;
  target?: string;
};

@Component({
  selector: 'app-enterprise-security-shield',
  standalone: true,
  imports: [CommonModule, RouterLink],
  template: `
    <section class="shield-workspace">
      <div class="page-heading">
        <div>
          <h1>Enterprise Security Shield</h1>
          <span>Detect, alert, block, audit and recover from suspicious activity across login, devices, exports, payments and admin actions</span>
        </div>
        <a class="primary-button" routerLink="/security-policy-center">Manage policies</a>
      </div>

      <div class="metric-strip">
        <article><span>Protection model</span><strong>{{ layers.length }}</strong><small>Security layers</small></article>
        <article><span>Active layers</span><strong>{{ activeLayerCount }}</strong><small>Currently enforced</small></article>
        <article><span>Response mode</span><strong>Auto</strong><small>Alert + block</small></article>
        <article><span>Audit trail</span><strong>On</strong><small>Existing security logs</small></article>
        <article><span>Recovery</span><strong>Ready</strong><small>Backup controls</small></article>
        <article><span>Policy center</span><strong>Live</strong><small>Owner/admin control</small></article>
      </div>

      <section class="panel">
        <div class="section-title"><h2>Security layers</h2><span>{{ layers.length }} controls</span></div>
        <div class="layer-grid">
          <article class="action-card" *ngFor="let layer of layers">
            <div>
              <small>{{ layer.level }}</small>
              <strong>{{ layer.title }}</strong>
            </div>
            <em>{{ layer.status }}</em>
            <span>{{ layer.detail }}</span>
            <a *ngIf="layer.target" [routerLink]="layer.target">Open</a>
          </article>
        </div>
      </section>

      <section class="panel">
        <div class="section-title"><h2>Operational posture</h2><span>Branch scope active</span></div>
        <div class="workdesk">
          <article class="action-card">
            <strong>Secure Foundation</strong>
            <span>CSP, HSTS, cross-origin protections and API rate limiting are layered into middleware.</span>
          </article>
          <article class="action-card">
            <strong>Active Defense</strong>
            <span>Critical brute-force alerts can create temporary IP blocks without affecting localhost development by default.</span>
          </article>
          <article class="action-card">
            <strong>Honest Security Claim</strong>
            <span>The system does not claim impossible security; it focuses on detection, alerting, blocking, audit and recovery.</span>
          </article>
        </div>
      </section>
    </section>
  `,
  styles: [`
    .shield-workspace { background: #fff; color: #111827; min-height: 100vh; }
    .command-bar { background: #111827; color: #fff; display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 12px 18px; box-shadow: 0 2px 10px rgba(15, 23, 42, 0.16); }
    .brand-block, .command-actions, .header-actions, .page-heading, .section-title { display: flex; align-items: center; gap: 10px; }
    .brand-mark { width: 34px; height: 34px; border-radius: 8px; display: grid; place-items: center; background: #635bff; font-weight: 900; }
    .brand-block small { display: block; color: #94a3b8; font-size: 10px; font-weight: 800; letter-spacing: 0; }
    .brand-block strong { display: block; font-size: 16px; }
    .zenoti-button, .primary-button { border: 1px solid #bfdbfe; background: #fff; color: #075985; border-radius: 4px; padding: 8px 13px; font-weight: 800; cursor: pointer; text-decoration: none; }
    .zenoti-button.primary, .primary-button { background: #0f8f7f; border-color: #0f8f7f; color: #fff; }
    .zenoti-header { display: grid; grid-template-columns: 1fr auto; gap: 10px; align-items: center; padding: 26px 16px 12px; border-bottom: 1px solid #d7e2ea; }
    .zenoti-header select { grid-column: 2; width: min(620px, 100%); border: 1px solid #bfdbfe; border-radius: 4px; padding: 9px 12px; font-weight: 800; background: #fff; }
    .page-heading { justify-content: space-between; padding: 14px 16px; border-bottom: 1px solid #d7e2ea; }
    .page-heading h1 { margin: 0 0 4px; font-size: 24px; }
    .page-heading span, .section-title span, small { color: #64748b; }
    .metric-strip { display: grid; grid-template-columns: repeat(6, minmax(150px, 1fr)); border-bottom: 1px solid #d7e2ea; background: #f8fafc; }
    .metric-strip article { padding: 14px 16px; border-right: 1px solid #d7e2ea; border-top: 4px solid #0f8f7f; min-height: 86px; }
    .metric-strip article:nth-child(2) { border-top-color: #2563eb; }
    .metric-strip article:nth-child(3) { border-top-color: #b7791f; }
    .metric-strip article:nth-child(4) { border-top-color: #15803d; }
    .metric-strip article:nth-child(5) { border-top-color: #7c3aed; }
    .metric-strip article:nth-child(6) { border-top-color: #b91c1c; }
    .metric-strip span { display: block; color: #64748b; font-size: 12px; font-weight: 900; }
    .metric-strip strong { display: block; margin-top: 6px; font-size: 25px; }
    .panel { margin: 16px; background: #fff; border: 1px solid #d7e2ea; border-radius: 4px; padding: 14px; }
    .section-title { justify-content: space-between; margin-bottom: 12px; }
    .section-title h2 { margin: 0; font-size: 16px; }
    .layer-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; }
    .workdesk { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; }
    .action-card { border: 1px solid #d7e2ea; border-radius: 4px; padding: 12px; min-height: 112px; display: grid; gap: 8px; align-content: start; }
    .action-card strong, .action-card span { display: block; }
    .action-card span { color: #64748b; font-size: 12px; }
    .action-card em { justify-self: start; border-radius: 999px; background: #dcfce7; color: #166534; padding: 4px 8px; font-size: 11px; font-style: normal; font-weight: 900; text-transform: uppercase; }
    .action-card a { color: #075985; font-weight: 900; text-decoration: none; }
    @media (max-width: 1180px) {
      .metric-strip { grid-template-columns: repeat(3, 1fr); }
      .layer-grid { grid-template-columns: repeat(2, 1fr); }
      .workdesk { grid-template-columns: 1fr; }
      .zenoti-header { grid-template-columns: 1fr; }
      .zenoti-header select { grid-column: auto; }
    }
    @media (max-width: 720px) {
      .command-bar, .page-heading { align-items: stretch; flex-direction: column; }
      .metric-strip, .layer-grid { grid-template-columns: 1fr; }
      .header-actions { flex-wrap: wrap; }
    }
  `]
})
export class EnterpriseSecurityShieldComponent {
  readonly layers: ShieldLayer[] = [
    { level: 'Level 1', title: 'Secure Foundation', status: 'active', detail: 'Security headers, CSP, HSTS, frame protection and rate limiting.', target: '/security' },
    { level: 'Level 2', title: 'Strong Login Protection', status: 'active', detail: 'Admin 2FA with authenticator and recovery codes.', target: '/two-factor' },
    { level: 'Level 3', title: 'Threat Detection', status: 'active', detail: 'Failed login, new IP, off-hours, sensitive access and probing signals.', target: '/security-alerts' },
    { level: 'Level 4', title: 'Real-Time Alerts', status: 'active', detail: 'Critical and warning alerts are queued for owner/admin notification.', target: '/security-alerts' },
    { level: 'Level 5', title: 'Active Defense', status: 'active', detail: 'Automatic blocklist for critical brute-force indicators.', target: '/security-blocklist' },
    { level: 'Level 6', title: 'Audit Trail', status: 'active', detail: 'Security actions are written to the existing audit architecture.', target: '/audit-logs' },
    { level: 'Level 7', title: 'Recovery Readiness', status: 'available', detail: 'Backup and security controls remain visible in the security module.', target: '/security' },
    { level: 'Level 8', title: 'Device Trust Layer', status: 'active', detail: 'Owner/admin can observe, trust or revoke browser/device records.', target: '/security-policy-center' },
    { level: 'Level 9', title: 'Security PIN Re-auth', status: 'active', detail: 'High-risk actions can require an owner/admin security PIN.', target: '/security-policy-center' },
    { level: 'Level 10', title: 'Export Protection', status: 'active', detail: 'Export/download routes are detected and can require PIN verification.', target: '/security-policy-center' },
    { level: 'Level 11', title: 'Field-Level Audit', status: 'active', detail: 'Sensitive before/after field changes are stored for investigation history.', target: '/security-policy-center' },
    { level: 'Level 12', title: 'Security Policy Center', status: 'active', detail: 'Owner/admin can control tenant security flags from one page.', target: '/security-policy-center' },
    { level: 'Level 13', title: 'Risk Scoring Engine', status: 'active', detail: 'Current session risk can be scored from device, IP, alert and export signals.', target: '/security-policy-center' },
    { level: 'Level 14', title: 'Sensitive Action Approval', status: 'active', detail: 'Risky admin actions can be queued for owner/admin approval.', target: '/security-policy-center' },
    { level: 'Level 15', title: 'IP Access Rules', status: 'active', detail: 'Suspicious IPs can be watched or marked as deny-signal sources.', target: '/security-policy-center' },
    { level: 'Level 16', title: 'Data Masking Policy', status: 'active', detail: 'Sensitive fields can be registered for role-aware masking.', target: '/security-policy-center' },
    { level: 'Level 17', title: 'Security Response Playbooks', status: 'active', detail: 'Incident review checklists are available for fast owner/admin response.', target: '/security-policy-center' },
    { level: 'Level 18', title: 'SSO Readiness', status: 'active', detail: 'SAML/OIDC policy records are ready for enterprise identity enforcement.', target: '/security-policy-center' },
    { level: 'Level 19', title: 'Privileged Session Control', status: 'active', detail: 'Sensitive admin work can run inside temporary elevated sessions.', target: '/security-policy-center' },
    { level: 'Level 20', title: 'API Client Governance', status: 'active', detail: 'Integration clients use hashed tokens, scopes and revocation records.', target: '/security-policy-center' },
    { level: 'Level 21', title: 'Payment Data Guard', status: 'active', detail: 'Payment and refund security events can be tracked for review.', target: '/security-policy-center' },
    { level: 'Level 22', title: 'Privacy Governance', status: 'active', detail: 'Client access, export and delete requests are tracked through a review queue.', target: '/security-policy-center' },
    { level: 'Level 23', title: 'Manage Access & Devices', status: 'active', detail: 'Owner/admin can review devices, sessions, IP and last activity.', target: '/security-policy-center' },
    { level: 'Level 24', title: 'Session Kill Switch', status: 'active', detail: 'Owner/admin can sign out one device or all devices for a user.', target: '/security-policy-center' },
    { level: 'Level 25', title: 'Subscription Guard', status: 'active', detail: 'Expired or suspended plans can lock reports, exports and AI modules.', target: '/security-policy-center' },
    { level: 'Level 26', title: 'Anti Account Sharing', status: 'active', detail: 'Same account across many devices or branches is flagged for review.', target: '/security-policy-center' },
    { level: 'Level 27', title: 'Fraud Warning Center', status: 'active', detail: 'Client-visible OTP, password, payment-link and phishing warnings.', target: '/security-policy-center' },
    { level: 'Level 28', title: 'Responsible Disclosure', status: 'active', detail: 'Security issue reports are captured in a professional review queue.', target: '/security-policy-center' }
  ];

  get activeLayerCount(): number {
    return this.layers.filter((layer) => layer.status === 'active').length;
  }
}
