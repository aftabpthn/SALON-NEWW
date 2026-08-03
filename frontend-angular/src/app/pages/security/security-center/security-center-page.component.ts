import { CommonModule } from '@angular/common';
import { Component, OnInit, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { forkJoin } from 'rxjs';
import { ApiService } from '../../../shared/services/api.service';
import { AuthService } from '../../../core/services/auth.service';
import { PasskeyInfo, WebauthnService } from '../../../core/services/webauthn.service';

type Tab = 'overview' | 'mfa' | 'passkeys' | 'privileged' | 'provisioning' | 'audit' | 'fieldAudit' | 'sessions' | 'devices' | 'permissions' | 'governance' | 'playbooks' | 'privacy' | 'alerts' | 'blocklist' | 'fraud' | 'policy';

interface Envelope<T> {
  success: boolean;
  data?: T;
  error?: { message?: string };
}

interface SecurityPolicy {
  auditRetentionDays: number;
  auditPageSize: number;
  sessionRevocationEnabled: boolean;
  staffAppInactivityMinutes: number;
  staffAppGeofenceMode: 'full_access' | 'read_only' | 'blocked';
  staffAppGeofenceRadiusMeters: number;
  staffAppGeofenceExemptRoles: string[];
  staffContactVerificationRequired: boolean;
}

interface SecurityPolicyView {
  settings: SecurityPolicy;
  persisted: boolean;
  updatedBy?: string;
  updatedAt?: string;
}

interface SecuritySummary {
  counts: {
    openAlerts: number;
    activeBlocks: number;
    activeSessions: number;
    auditEvents: number;
  };
  policy: SecurityPolicyView;
}

interface ComplianceEvidenceExport {
  bundleId: string;
  generatedAt: string;
}

interface AuditEvent {
  id: string;
  userId?: string;
  eventType: string;
  outcome: string;
  ipAddress?: string;
  createdAt: string;
}

interface AuditChainStatus {
  valid: boolean;
  events: number;
  sealedEvents: number;
  headHash: string;
  failedEventId?: string;
  failedAt?: number;
  sealedAt?: string;
}

interface FieldAuditEvent {
  id: string;
  actorUserId: string;
  entityType: string;
  entityId: string;
  fieldGroup: string;
  fieldName: string;
  accessType: string;
  maskingApplied: boolean;
  reason: string;
  createdAt: string;
}

interface SecuritySession {
  sessionId: string;
  userId: string;
  roleName?: string;
  deviceId?: string;
  ipAddress?: string;
  userAgent?: string;
  expiresAt: string;
}

interface SecurityDevice {
  userId: string;
  deviceId: string;
  status: string;
  activeSessions: number;
  ipCount: number;
  userAgentCount: number;
  firstSeenAt?: string;
  lastSeenAt?: string;
  trustedAt?: string;
  revokedAt?: string;
}

interface PrivilegedSessionStatus {
  active: boolean;
  userId: string;
  sessionId: string;
  actionScope: string;
  verificationMethod?: string;
  verifiedAt?: string;
  expiresAt?: string;
  ttlSeconds: number;
}

interface SecurityAlert {
  id: string;
  alertType: string;
  severity: string;
  status: string;
  summary: string;
  sourceIp?: string;
  detectedAt: string;
}

interface SecurityBlock {
  id: string;
  ipAddress?: string;
  userId?: string;
  reason: string;
  severity: string;
  unblockedAt?: string;
  createdAt: string;
}

interface FraudRisk {
  id: string;
  businessDate: string;
  riskCode: string;
  severity: string;
  riskScore: number;
  entityType: string;
  amountAtRiskPaise: number;
  status: string;
}

interface FraudWarning {
  id: string;
  title: string;
  message: string;
  severity: string;
  status: string;
  createdAt: string;
}

interface SecurityApproval {
  id: string;
  requestedBy: string;
  decidedBy?: string;
  actionType: string;
  summary: string;
  status: string;
  decisionNote: string;
  decidedAt?: string;
  createdAt: string;
}

interface SecurityAccessRule {
  id: string;
  ruleType: string;
  matchValue: string;
  effect: string;
  reason: string;
  status: string;
  createdBy: string;
  disabledAt?: string;
  createdAt: string;
}

interface IncidentPlaybook {
  id: string;
  playbookKey: string;
  title: string;
  severity: string;
  checklistJson: string[];
  status: string;
  createdBy: string;
  createdAt: string;
}

interface PrivacyRequest {
  id: string;
  requesterId: string;
  subjectType: string;
  subjectId: string;
  requestType: string;
  summary: string;
  status: string;
  approvalStatus: string;
  approvedBy?: string;
  approvedAt?: string;
  executionStatus: string;
  executionSummaryJson: Record<string, unknown>;
  resolutionNote: string;
  resolvedBy?: string;
  resolvedAt?: string;
  createdAt: string;
}

interface RetentionPolicy {
  id: string;
  recordClass: string;
  retentionDays: number;
  disposition: string;
  legalBasis: string;
  ownerUserId: string;
  active: boolean;
  version: number;
  updatedAt: string;
}

interface LegalHold {
  id: string;
  subjectType: string;
  subjectId: string;
  reason: string;
  status: string;
  expiresAt?: string;
  createdAt: string;
}

interface PiiExport {
  id: string;
  subjectType: string;
  subjectId: string;
  rowLimit: number;
  reason: string;
  status: string;
  requestedBy: string;
  approvedBy?: string;
  approvalNote?: string;
  expiresAt?: string;
  downloadedAt?: string;
  createdAt: string;
}

interface ComplianceEvidenceItem {
  id: string;
  framework: string;
  controlKey: string;
  title: string;
  ownerUserId: string;
  status: string;
  evidenceReference: string;
  independentAssessor: string;
  validUntil?: string;
  notes: string;
  version: number;
  updatedAt: string;
}

interface PenTestFinding {
  id: string;
  title: string;
  severity: string;
  status: string;
  ownerUserId: string;
  remediationNote: string;
  riskAcceptanceReason: string;
  riskAcceptanceExpiresAt?: string;
  version: number;
  updatedAt: string;
}

interface DataGovernance {
  retentionPolicies: RetentionPolicy[];
  legalHolds: LegalHold[];
  piiExports: PiiExport[];
  evidenceItems: ComplianceEvidenceItem[];
  penTestFindings: PenTestFinding[];
  consentEvidence: { clientEvents: number; activeClientConsents: number; biometricConsents: number };
  openUnacceptedPenTestFindings: number;
}

interface DisclosureReport {
  id: string;
  reporterName: string;
  reporterContact: string;
  summary: string;
  details: string;
  severity: string;
  status: string;
  resolutionNote: string;
  resolvedBy?: string;
  resolvedAt?: string;
  createdAt: string;
}

interface PermissionMatrix {
  roles: Array<{ id: string; name: string; permissions: string[]; maskedFields?: string[]; isSystem: boolean }>;
  permissionOptions: Array<{ code: string; label: string }>;
}

interface MfaStatus {
  enabled: boolean;
  required: boolean;
  pending: boolean;
  recoveryCodesRemaining: number;
  verifiedAt?: string;
}

interface MfaSetup {
  secret: string;
  otpAuthUri: string;
  algorithm: string;
  digits: number;
  period: number;
}

interface MfaEnableResult {
  enabled: boolean;
  recoveryCodes: string[];
}

interface ScimTokenStatus {
  configured: boolean;
  lastFour?: string;
  updatedAt?: string;
}

interface ScimTokenRotation {
  token: string;
  status: ScimTokenStatus;
}

interface SsoPolicyView {
  googleConfigured: boolean;
  microsoftConfigured: boolean;
  samlConfigured: boolean;
  googleEnabled: boolean;
  microsoftEnabled: boolean;
  samlEnabled: boolean;
  enforcedRoles: string[];
  persisted: boolean;
  updatedBy?: string;
  updatedAt?: string;
}

interface TemporaryElevation {
  id: string;
  userId: string;
  permissionsJson: string[];
  source: 'approval' | 'break_glass';
  reason: string;
  createdBy: string;
  expiresAt: string;
  revokedAt?: string;
  createdAt: string;
}

interface PermissionSimulation {
  userId: string;
  branchId: string;
  roleName: string;
  basePermissions: string[];
  elevatedPermissions: string[];
  deniedPermissions: string[];
  effectivePermissions: string[];
}

@Component({
    selector: 'aura-security-center-page',
    imports: [CommonModule, FormsModule],
    templateUrl: './security-center-page.component.html',
    styleUrls: ['./security-center-page.component.css']
})
export class SecurityCenterPageComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly auth = inject(AuthService);
  readonly webauthn = inject(WebauthnService);

  readonly tabs: Array<{ key: Tab; label: string }> = [
    { key: 'overview', label: 'Overview' },
    { key: 'mfa', label: 'MFA' },
    { key: 'passkeys', label: 'Passkeys' },
    { key: 'privileged', label: 'Privileged' },
    { key: 'provisioning', label: 'SSO & SCIM' },
    { key: 'audit', label: 'Audit' },
    { key: 'fieldAudit', label: 'Field Audit' },
    { key: 'sessions', label: 'Sessions' },
    { key: 'devices', label: 'Devices' },
    { key: 'permissions', label: 'Permissions' },
    { key: 'governance', label: 'Approvals & Access' },
    { key: 'playbooks', label: 'Playbooks' },
    { key: 'privacy', label: 'Privacy & Disclosure' },
    { key: 'alerts', label: 'Alerts' },
    { key: 'blocklist', label: 'Blocklist' },
    { key: 'fraud', label: 'Fraud Guards' },
    { key: 'policy', label: 'Policy' },
  ];

  activeTab: Tab = 'overview';
  loading = false;
  saving = false;
  errorMessage = '';
  notice = '';
  auditSearch = '';
  summary?: SecuritySummary;
  auditEvents: AuditEvent[] = [];
  fieldAuditEvents: FieldAuditEvent[] = [];
  fieldAuditSearch = '';
  auditChain?: AuditChainStatus;
  sessions: SecuritySession[] = [];
  devices: SecurityDevice[] = [];
  permissions?: PermissionMatrix;
  alerts: SecurityAlert[] = [];
  blocks: SecurityBlock[] = [];
  fraudRisks: FraudRisk[] = [];
  fraudWarnings: FraudWarning[] = [];
  fraudWarningDraft = { title: '', message: '', severity: 'warning' };
  approvals: SecurityApproval[] = [];
  accessRules: SecurityAccessRule[] = [];
  approvalDraft = { actionType: '', summary: '' };
  accessRuleDraft = { ruleType: 'ip', matchValue: '', effect: 'watch', reason: '' };
  playbooks: IncidentPlaybook[] = [];
  playbookDraft = { playbookKey: '', title: '', severity: 'warning', checklistText: '' };
  privacyRequests: PrivacyRequest[] = [];
  privacyDraft = { subjectType: 'client', subjectId: '', requestType: 'access', summary: '' };
  dataGovernance?: DataGovernance;
  retentionDraft: { recordClass: string; retentionDays: number | null; disposition: string; legalBasis: string; ownerUserId: string; version: number | null } = {
    recordClass: '', retentionDays: null, disposition: 'review', legalBasis: '', ownerUserId: '', version: null,
  };
  legalHoldDraft = { subjectType: 'client', subjectId: '', reason: '' };
  piiExportDraft: { subjectId: string; rowLimit: number | null; reason: string; mfaCode: string } = {
    subjectId: '', rowLimit: null, reason: '', mfaCode: '',
  };
  privacyDeletionMfaCode = '';
  piiDownloadTokens: Record<string, string> = {};
  piiDownloadMfaCode = '';
  evidenceDraft = { framework: 'soc2', controlKey: '', title: '', ownerUserId: '', status: 'planned', evidenceReference: '', independentAssessor: '', notes: '', version: null as number | null };
  penTestDraft = { id: '', title: '', severity: 'high', status: 'open', ownerUserId: '', remediationNote: '', riskAcceptanceReason: '', riskAcceptanceExpiresAt: '', version: null as number | null };
  disclosureReports: DisclosureReport[] = [];
  disclosureDraft = { reporterName: '', reporterContact: '', summary: '', details: '', severity: 'warning' };
  policy?: SecurityPolicy;

  get staffGeofenceExemptRoles(): string {
    return this.policy?.staffAppGeofenceExemptRoles.join(', ') || '';
  }

  set staffGeofenceExemptRoles(value: string) {
    if (this.policy) this.policy.staffAppGeofenceExemptRoles = value.split(',').map((role) => role.trim()).filter(Boolean);
  }
  mfaStatus?: MfaStatus;
  mfaSetup?: MfaSetup;
  mfaCode = '';
  recoveryCodes: string[] = [];
  passkeys: PasskeyInfo[] = [];
  passkeyLabel = '';
  privilegedStatus?: PrivilegedSessionStatus;
  privilegedMfaCode = '';
  privilegedPassword = '';
  scimStatus?: ScimTokenStatus;
  scimToken = '';
  ssoPolicy?: SsoPolicyView;
  ssoDraft = { googleEnabled: false, microsoftEnabled: false, samlEnabled: false, enforcedRoles: [] as string[] };
  elevations: TemporaryElevation[] = [];
  elevationDraft: { userId: string; permissions: string[]; durationMinutes: number | null; reason: string } = {
    userId: '', permissions: [], durationMinutes: null, reason: '',
  };
  breakGlassDraft: { permissions: string[]; durationMinutes: number | null; reason: string } = {
    permissions: [], durationMinutes: null, reason: '',
  };
  simulatorUserId = '';
  simulation?: PermissionSimulation;

  get mfaEnrollmentRequired(): boolean {
    return this.auth.mfaEnrollmentRequired;
  }

  get canViewSecurityCenter(): boolean {
    return this.auth.hasRole('owner', 'admin', 'superadmin', 'super-admin')
      || this.auth.hasPermission('security.read', 'security.manage');
  }

  get canManageSecurity(): boolean {
    return this.auth.hasRole('owner', 'admin', 'superadmin', 'super-admin')
      || this.auth.hasPermission('security.manage');
  }

  get canActivateBreakGlass(): boolean {
    return this.auth.hasRole('owner');
  }

  get visibleTabs(): Array<{ key: Tab; label: string }> {
    return this.canViewSecurityCenter
      ? this.tabs
      : this.tabs.filter((tab) => tab.key === 'mfa' || tab.key === 'passkeys' || tab.key === 'privileged');
  }

  ngOnInit(): void {
    this.reload();
  }

  reload(): void {
    this.loading = true;
    this.errorMessage = '';
    if (this.mfaEnrollmentRequired) {
      this.activeTab = 'mfa';
      this.api.get<Envelope<MfaStatus>>('auth/mfa/status').subscribe({
        next: (response) => {
          this.mfaStatus = this.unwrap(response);
          this.loading = false;
        },
        error: (error) => {
          this.errorMessage = this.errorText(error, 'Unable to load MFA status.');
          this.loading = false;
        },
      });
      return;
    }
    if (!this.canViewSecurityCenter) {
      if (this.activeTab !== 'mfa' && this.activeTab !== 'passkeys') this.activeTab = 'mfa';
      forkJoin({
        mfa: this.api.get<Envelope<MfaStatus>>('auth/mfa/status'),
        passkeys: this.api.get<Envelope<{ credentials: PasskeyInfo[] }>>('auth/webauthn/credentials'),
        privileged: this.api.get<Envelope<PrivilegedSessionStatus>>('security/privileged-session'),
      }).subscribe({
        next: (result) => {
          this.mfaStatus = this.unwrap(result.mfa);
          this.passkeys = this.unwrap(result.passkeys).credentials;
          this.privilegedStatus = this.unwrap(result.privileged);
          this.loading = false;
        },
        error: (error) => {
          this.errorMessage = this.errorText(error, 'Unable to load account security data.');
          this.loading = false;
        },
      });
      return;
    }
    forkJoin({
      summary: this.api.get<Envelope<SecuritySummary>>('security/summary'),
      audit: this.api.get<Envelope<{ events: AuditEvent[] }>>(
        `security/audit?q=${encodeURIComponent(this.auditSearch.trim())}`,
      ),
      auditChain: this.api.get<Envelope<AuditChainStatus>>('security/audit-chain/verify'),
      fieldAudit: this.api.get<Envelope<{ events: FieldAuditEvent[] }>>(
        `security/field-audit?field=${encodeURIComponent(this.fieldAuditSearch.trim())}`,
      ),
      sessions: this.api.get<Envelope<{ sessions: SecuritySession[] }>>('security/sessions'),
      devices: this.api.get<Envelope<{ devices: SecurityDevice[] }>>('security/devices'),
      permissions: this.api.get<Envelope<PermissionMatrix>>('security/permission-matrix'),
      alerts: this.api.get<Envelope<{ alerts: SecurityAlert[] }>>('security/alerts?status=all'),
      blocks: this.api.get<Envelope<{ blocks: SecurityBlock[] }>>('security/blocklist?status=all'),
      fraudRisks: this.api.get<Envelope<{ risks: FraudRisk[] }>>('security/fraud-risks'),
      fraudWarnings: this.api.get<Envelope<{ warnings: FraudWarning[] }>>('security/fraud-warnings'),
      approvals: this.api.get<Envelope<{ approvals: SecurityApproval[] }>>('security/approvals?status=all'),
      accessRules: this.api.get<Envelope<{ rules: SecurityAccessRule[] }>>('security/access-rules?status=all'),
      elevations: this.api.get<Envelope<{ elevations: TemporaryElevation[] }>>('security/elevations'),
      playbooks: this.api.get<Envelope<{ playbooks: IncidentPlaybook[] }>>('security/playbooks?status=all'),
      privacyRequests: this.api.get<Envelope<{ requests: PrivacyRequest[] }>>('security/privacy-requests?status=all'),
      dataGovernance: this.api.get<Envelope<DataGovernance>>('security/data-governance'),
      disclosureReports: this.api.get<Envelope<{ reports: DisclosureReport[] }>>('security/disclosure-reports?status=all'),
      policy: this.api.get<Envelope<SecurityPolicyView>>('security/policy'),
      privileged: this.api.get<Envelope<PrivilegedSessionStatus>>('security/privileged-session'),
      mfa: this.api.get<Envelope<MfaStatus>>('auth/mfa/status'),
      passkeys: this.api.get<Envelope<{ credentials: PasskeyInfo[] }>>('auth/webauthn/credentials'),
      scim: this.api.get<Envelope<ScimTokenStatus>>('security/scim-token'),
      ssoPolicy: this.api.get<Envelope<SsoPolicyView>>('security/sso-policy'),
    }).subscribe({
      next: (result) => {
        this.summary = this.unwrap(result.summary);
        this.auditEvents = this.unwrap(result.audit).events;
        this.auditChain = this.unwrap(result.auditChain);
        this.fieldAuditEvents = this.unwrap(result.fieldAudit).events;
        this.sessions = this.unwrap(result.sessions).sessions;
        this.devices = this.unwrap(result.devices).devices;
        this.permissions = this.unwrap(result.permissions);
        this.alerts = this.unwrap(result.alerts).alerts;
        this.blocks = this.unwrap(result.blocks).blocks;
        this.fraudRisks = this.unwrap(result.fraudRisks).risks;
        this.fraudWarnings = this.unwrap(result.fraudWarnings).warnings;
        this.approvals = this.unwrap(result.approvals).approvals;
        this.accessRules = this.unwrap(result.accessRules).rules;
        this.elevations = this.unwrap(result.elevations).elevations;
        this.playbooks = this.unwrap(result.playbooks).playbooks;
        this.privacyRequests = this.unwrap(result.privacyRequests).requests;
        this.dataGovernance = this.unwrap(result.dataGovernance);
        this.disclosureReports = this.unwrap(result.disclosureReports).reports;
        this.policy = { ...this.unwrap(result.policy).settings };
        this.privilegedStatus = this.unwrap(result.privileged);
        this.mfaStatus = this.unwrap(result.mfa);
        this.passkeys = this.unwrap(result.passkeys).credentials;
        this.scimStatus = this.unwrap(result.scim);
        this.setSsoPolicy(this.unwrap(result.ssoPolicy));
        this.loading = false;
      },
      error: (error) => {
        this.errorMessage = this.errorText(error, 'Unable to load security data.');
        this.loading = false;
      },
    });
  }

  selectTab(tab: Tab): void {
    this.activeTab = tab;
    this.errorMessage = '';
    if (tab === 'overview') this.reloadSummary();
    else if (tab === 'mfa') this.reloadMfa();
    else if (tab === 'passkeys') this.reloadPasskeys();
    else if (tab === 'privileged') this.reloadPrivilegedSession();
    else if (tab === 'provisioning') this.reloadProvisioning();
    else if (tab === 'audit') this.reloadAudit();
    else if (tab === 'fieldAudit') this.reloadFieldAudit();
    else if (tab === 'sessions') this.reloadSessions();
    else if (tab === 'devices') this.reloadDevices();
    else if (tab === 'permissions') this.reloadPermissions();
    else if (tab === 'governance') this.reloadSecurityGovernance();
    else if (tab === 'playbooks') this.reloadPlaybooks();
    else if (tab === 'privacy') this.reloadPrivacyDisclosure();
    else if (tab === 'alerts') this.reloadAlerts();
    else if (tab === 'blocklist') this.reloadBlocks();
    else if (tab === 'fraud') this.reloadFraudGuards();
    else if (tab === 'policy') this.reloadPolicy();
  }

  deleteFirstPasskey(): void { if (this.passkeys[0]) this.deletePasskey(this.passkeys[0]); }
  revokeFirstSession(): void { if (this.sessions[0]) this.revokeSession(this.sessions[0]); }
  trustFirstDevice(): void { if (this.devices[0]) this.trustDevice(this.devices[0]); }
  revokeFirstDevice(): void { if (this.devices[0]) this.revokeDevice(this.devices[0]); }
  signOutFirstDevice(): void { if (this.devices[0]) this.signOutAllDevices(this.devices[0]); }
  decideFirstApproval(decision: 'approve' | 'reject'): void { if (this.approvals[0]) this.decideApproval(this.approvals[0], decision); }
  disableFirstPlaybook(): void { if (this.playbooks[0]) this.disablePlaybook(this.playbooks[0]); }
  resolveFirstPrivacyRequest(): void { if (this.privacyRequests[0]) this.resolvePrivacyRequest(this.privacyRequests[0]); }
  resolveFirstAlert(): void { if (this.alerts[0]) this.resolveAlert(this.alerts[0]); }
  unblockFirst(): void { if (this.blocks[0]) this.unblock(this.blocks[0]); }
  editRoleLater(): void { this.notice = 'Role edit is pending backend edit-role support.'; }

  exportComplianceEvidence(): void {
    if (this.saving) return;
    this.saving = true;
    this.errorMessage = '';
    this.api.get<Envelope<ComplianceEvidenceExport>>('security/compliance-evidence/export').subscribe({
      next: (response) => {
        const evidence = this.unwrap(response);
        const url = URL.createObjectURL(new Blob([JSON.stringify(evidence, null, 2)], { type: 'application/json' }));
        const link = document.createElement('a');
        link.href = url;
        link.download = `compliance-evidence-${evidence.generatedAt.slice(0, 10)}.json`;
        link.click();
        URL.revokeObjectURL(url);
        this.notice = `Compliance evidence ${evidence.bundleId} exported.`;
        this.saving = false;
        this.reloadAudit();
      },
      error: (error) => {
        this.errorMessage = this.errorText(error, 'Unable to export compliance evidence.');
        this.saving = false;
      },
    });
  }

  savePolicy(): void {
    if (!this.policy || this.saving) return;
    this.saving = true;
    this.errorMessage = '';
    this.api.put<Envelope<SecurityPolicyView>>('security/policy', this.policy).subscribe({
      next: (response) => {
        this.policy = { ...this.unwrap(response).settings };
        this.notice = 'Security policy saved.';
        this.saving = false;
        this.reloadSummary();
      },
      error: (error) => {
        this.errorMessage = this.errorText(error, 'Unable to save security policy.');
        this.saving = false;
      },
    });
  }

  sealAuditChain(): void {
    if (this.saving) return;
    this.saving = true;
    this.errorMessage = '';
    this.notice = '';
    this.api.post<Envelope<AuditChainStatus>>('security/audit-chain/seal', {}).subscribe({
      next: (response) => {
        this.auditChain = this.unwrap(response);
        this.notice = this.auditChain.valid ? 'Audit chain verified.' : 'Audit chain verification failed.';
        this.saving = false;
        this.reloadAudit();
      },
      error: (error) => {
        this.errorMessage = this.errorText(error, 'Unable to seal audit chain.');
        this.saving = false;
      },
    });
  }

  revokeSession(session: SecuritySession): void {
    if (!window.confirm('Revoke this active session?')) return;
    this.api.patch<Envelope<{ updated: boolean }>>(
      `security/sessions/${encodeURIComponent(session.sessionId)}/revoke`,
      {},
    ).subscribe({
      next: () => this.reloadSessions(),
      error: (error) => { this.errorMessage = this.errorText(error, 'Unable to revoke session.'); },
    });
  }

  trustDevice(device: SecurityDevice): void {
    this.updateDevice('security/devices/trust', device, 'Device trusted.');
  }

  revokeDevice(device: SecurityDevice): void {
    if (!window.confirm('Revoke this device and sign out its active sessions?')) return;
    this.updateDevice('security/devices/revoke', device, 'Device revoked.');
  }

  signOutAllDevices(device: SecurityDevice): void {
    if (!window.confirm('Sign out all active devices for this user?')) return;
    this.api.post<Envelope<{ revokedSessions: number }>>('security/devices/sign-out-all', {
      userId: device.userId,
    }).subscribe({
      next: (response) => {
        this.notice = `${this.unwrap(response).revokedSessions} sessions signed out.`;
        this.reloadDevices();
      },
      error: (error) => { this.errorMessage = this.errorText(error, 'Unable to sign out devices.'); },
    });
  }

  resolveAlert(alert: SecurityAlert): void {
    this.api.post<Envelope<SecurityAlert>>(
      `security/alerts/${encodeURIComponent(alert.id)}/resolve`,
      {},
    ).subscribe({
      next: () => this.reloadAlerts(),
      error: (error) => { this.errorMessage = this.errorText(error, 'Unable to resolve alert.'); },
    });
  }

  unblock(block: SecurityBlock): void {
    if (!window.confirm('Remove this security block?')) return;
    this.api.post<Envelope<SecurityBlock>>(
      `security/blocklist/${encodeURIComponent(block.id)}/unblock`,
      {},
    ).subscribe({
      next: () => this.reloadBlocks(),
      error: (error) => { this.errorMessage = this.errorText(error, 'Unable to remove block.'); },
    });
  }

  scanFraudRisks(): void {
    if (this.saving) return;
    this.saving = true;
    this.errorMessage = '';
    this.api.post<Envelope<{ risks: FraudRisk[] }>>('security/fraud-risks', {
      businessDate: this.localIsoDate(),
    }).subscribe({
      next: (response) => {
        this.fraudRisks = this.unwrap(response).risks;
        this.notice = 'Fraud guard scan completed.';
        this.saving = false;
      },
      error: (error) => {
        this.errorMessage = this.errorText(error, 'Unable to run fraud guard scan.');
        this.saving = false;
      },
    });
  }

  createFraudWarning(): void {
    const title = this.fraudWarningDraft.title.trim();
    const message = this.fraudWarningDraft.message.trim();
    if (!title || !message || this.saving) return;
    this.saving = true;
    this.errorMessage = '';
    this.api.post<Envelope<FraudWarning>>('security/fraud-warnings', {
      title,
      message,
      severity: this.fraudWarningDraft.severity,
    }).subscribe({
      next: () => {
        this.fraudWarningDraft = { title: '', message: '', severity: 'warning' };
        this.notice = 'Fraud warning added.';
        this.saving = false;
        this.reloadFraudGuards();
      },
      error: (error) => {
        this.errorMessage = this.errorText(error, 'Unable to add fraud warning.');
        this.saving = false;
      },
    });
  }

  createApproval(): void {
    const actionType = this.approvalDraft.actionType.trim();
    const summary = this.approvalDraft.summary.trim();
    if (!actionType || !summary || this.saving) return;
    this.saving = true;
    this.errorMessage = '';
    this.api.post<Envelope<SecurityApproval>>('security/approvals', { actionType, summary }).subscribe({
      next: () => {
        this.approvalDraft = { actionType: '', summary: '' };
        this.notice = 'Security approval requested.';
        this.saving = false;
        this.reloadSecurityGovernance();
      },
      error: (error) => {
        this.errorMessage = this.errorText(error, 'Unable to create security approval.');
        this.saving = false;
      },
    });
  }

  decideApproval(approval: SecurityApproval, decision: 'approve' | 'reject'): void {
    if (!window.confirm(`${decision === 'approve' ? 'Approve' : 'Reject'} this security request?`)) return;
    this.api.post<Envelope<SecurityApproval>>(
      `security/approvals/${encodeURIComponent(approval.id)}/${decision}`,
      {},
    ).subscribe({
      next: () => { this.notice = `Security request ${decision === 'approve' ? 'approved' : 'rejected'}.`; this.reloadSecurityGovernance(); },
      error: (error) => { this.errorMessage = this.errorText(error, 'Unable to decide security approval.'); },
    });
  }

  createAccessRule(): void {
    const matchValue = this.accessRuleDraft.matchValue.trim();
    if (!matchValue || this.saving) return;
    this.saving = true;
    this.errorMessage = '';
    this.api.post<Envelope<SecurityAccessRule>>('security/access-rules', {
      ...this.accessRuleDraft,
      matchValue,
      reason: this.accessRuleDraft.reason.trim(),
    }).subscribe({
      next: () => {
        this.accessRuleDraft = { ruleType: 'ip', matchValue: '', effect: 'watch', reason: '' };
        this.notice = 'Access rule added.';
        this.saving = false;
        this.reloadSecurityGovernance();
      },
      error: (error) => {
        this.errorMessage = this.errorText(error, 'Unable to add access rule.');
        this.saving = false;
      },
    });
  }

  disableAccessRule(rule: SecurityAccessRule): void {
    if (!window.confirm('Disable this access rule?')) return;
    this.api.post<Envelope<SecurityAccessRule>>(
      `security/access-rules/${encodeURIComponent(rule.id)}/disable`,
      {},
    ).subscribe({
      next: () => { this.notice = 'Access rule disabled.'; this.reloadSecurityGovernance(); },
      error: (error) => { this.errorMessage = this.errorText(error, 'Unable to disable access rule.'); },
    });
  }

  requestElevation(): void {
    const durationMinutes = this.elevationDraft.durationMinutes;
    if (!this.elevationDraft.userId.trim() || !this.elevationDraft.permissions.length || durationMinutes === null || !this.elevationDraft.reason.trim() || this.saving) return;
    this.saving = true;
    this.api.post<Envelope<SecurityApproval>>('security/elevations/request', {
      userId: this.elevationDraft.userId.trim(),
      permissions: this.elevationDraft.permissions,
      durationMinutes,
      reason: this.elevationDraft.reason.trim(),
    }).subscribe({
      next: () => {
        this.elevationDraft = { userId: '', permissions: [], durationMinutes: null, reason: '' };
        this.notice = 'Temporary access approval requested.';
        this.saving = false;
        this.reloadSecurityGovernance();
      },
      error: (error) => {
        this.errorMessage = this.errorText(error, 'Unable to request temporary access.');
        this.saving = false;
      },
    });
  }

  revokeElevation(elevation: TemporaryElevation): void {
    if (!window.confirm('Revoke this temporary access now?')) return;
    this.api.post<Envelope<TemporaryElevation>>(`security/elevations/${encodeURIComponent(elevation.id)}/revoke`, {}).subscribe({
      next: () => { this.notice = 'Temporary access revoked.'; this.reloadSecurityGovernance(); },
      error: (error) => { this.errorMessage = this.errorText(error, 'Unable to revoke temporary access.'); },
    });
  }

  activateBreakGlass(): void {
    const durationMinutes = this.breakGlassDraft.durationMinutes;
    if (!this.breakGlassDraft.permissions.length || durationMinutes === null || !this.breakGlassDraft.reason.trim() || this.saving) return;
    this.saving = true;
    this.api.post<Envelope<TemporaryElevation>>('security/break-glass', {
      permissions: this.breakGlassDraft.permissions,
      durationMinutes,
      reason: this.breakGlassDraft.reason.trim(),
    }).subscribe({
      next: () => {
        this.breakGlassDraft = { permissions: [], durationMinutes: null, reason: '' };
        this.notice = 'Emergency access activated.';
        this.saving = false;
        this.reloadSecurityGovernance();
      },
      error: (error) => {
        this.errorMessage = this.errorText(error, 'Unable to activate emergency access.');
        this.saving = false;
      },
    });
  }

  simulatePermissions(): void {
    const userId = this.simulatorUserId.trim();
    if (!userId) return;
    this.api.post<Envelope<PermissionSimulation>>('security/permission-simulator', { userId }).subscribe({
      next: (response) => { this.simulation = this.unwrap(response); },
      error: (error) => { this.errorMessage = this.errorText(error, 'Unable to simulate permissions.'); },
    });
  }

  elevationActive(elevation: TemporaryElevation): boolean {
    return !elevation.revokedAt && new Date(elevation.expiresAt).getTime() > Date.now();
  }

  createPlaybook(): void {
    const checklist = this.playbookDraft.checklistText
      .split(/\r?\n/)
      .map((step) => step.trim())
      .filter(Boolean);
    if (!this.playbookDraft.playbookKey.trim() || !this.playbookDraft.title.trim() || !checklist.length || this.saving) return;
    this.saving = true;
    this.errorMessage = '';
    this.api.post<Envelope<IncidentPlaybook>>('security/playbooks', {
      playbookKey: this.playbookDraft.playbookKey.trim(),
      title: this.playbookDraft.title.trim(),
      severity: this.playbookDraft.severity,
      checklist,
    }).subscribe({
      next: () => {
        this.playbookDraft = { playbookKey: '', title: '', severity: 'warning', checklistText: '' };
        this.notice = 'Incident playbook added.';
        this.saving = false;
        this.reloadPlaybooks();
      },
      error: (error) => {
        this.errorMessage = this.errorText(error, 'Unable to add incident playbook.');
        this.saving = false;
      },
    });
  }

  disablePlaybook(playbook: IncidentPlaybook): void {
    if (!window.confirm('Disable this incident playbook?')) return;
    this.api.post<Envelope<IncidentPlaybook>>(
      `security/playbooks/${encodeURIComponent(playbook.id)}/disable`,
      {},
    ).subscribe({
      next: () => { this.notice = 'Incident playbook disabled.'; this.reloadPlaybooks(); },
      error: (error) => { this.errorMessage = this.errorText(error, 'Unable to disable incident playbook.'); },
    });
  }

  createPrivacyRequest(): void {
    if (!this.privacyDraft.summary.trim() || this.saving) return;
    this.saving = true;
    this.errorMessage = '';
    this.api.post<Envelope<PrivacyRequest>>('security/privacy-requests', {
      subjectType: this.privacyDraft.subjectType,
      subjectId: this.privacyDraft.subjectId.trim(),
      requestType: this.privacyDraft.requestType,
      summary: this.privacyDraft.summary.trim(),
    }).subscribe({
      next: () => {
        this.privacyDraft = { subjectType: 'client', subjectId: '', requestType: 'access', summary: '' };
        this.notice = 'Privacy request added.';
        this.saving = false;
        this.reloadPrivacyDisclosure();
      },
      error: (error) => {
        this.errorMessage = this.errorText(error, 'Unable to add privacy request.');
        this.saving = false;
      },
    });
  }

  resolvePrivacyRequest(request: PrivacyRequest): void {
    if (!window.confirm('Resolve this privacy request?')) return;
    this.api.post<Envelope<PrivacyRequest>>(
      `security/privacy-requests/${encodeURIComponent(request.id)}/resolve`,
      {},
    ).subscribe({
      next: () => { this.notice = 'Privacy request resolved.'; this.reloadPrivacyDisclosure(); },
      error: (error) => { this.errorMessage = this.errorText(error, 'Unable to resolve privacy request.'); },
    });
  }

  saveRetentionPolicy(): void {
    const draft = this.retentionDraft;
    if (!draft.recordClass.trim() || draft.retentionDays === null || !draft.legalBasis.trim() || !draft.ownerUserId.trim() || this.saving) return;
    this.saving = true;
    this.api.put<Envelope<RetentionPolicy>>(
      `security/data-governance/retention-policies/${encodeURIComponent(draft.recordClass.trim())}`,
      { retentionDays: draft.retentionDays, disposition: draft.disposition, legalBasis: draft.legalBasis.trim(), ownerUserId: draft.ownerUserId.trim(), version: draft.version },
    ).subscribe({
      next: () => {
        this.retentionDraft = { recordClass: '', retentionDays: null, disposition: 'review', legalBasis: '', ownerUserId: '', version: null };
        this.notice = 'Retention policy saved.';
        this.saving = false;
        this.reloadPrivacyDisclosure();
      },
      error: (error) => { this.errorMessage = this.errorText(error, 'Unable to save retention policy.'); this.saving = false; },
    });
  }

  editRetentionPolicy(policy: RetentionPolicy): void {
    this.retentionDraft = { recordClass: policy.recordClass, retentionDays: policy.retentionDays, disposition: policy.disposition, legalBasis: policy.legalBasis, ownerUserId: policy.ownerUserId, version: policy.version };
  }

  createLegalHold(): void {
    const draft = this.legalHoldDraft;
    if (!draft.subjectId.trim() || !draft.reason.trim() || this.saving) return;
    this.saving = true;
    this.api.post<Envelope<LegalHold>>('security/data-governance/legal-holds', {
      subjectType: draft.subjectType, subjectId: draft.subjectId.trim(), reason: draft.reason.trim(), expiresAt: null,
    }).subscribe({
      next: () => {
        this.legalHoldDraft = { subjectType: 'client', subjectId: '', reason: '' };
        this.notice = 'Legal hold created.';
        this.saving = false;
        this.reloadPrivacyDisclosure();
      },
      error: (error) => { this.errorMessage = this.errorText(error, 'Unable to create legal hold.'); this.saving = false; },
    });
  }

  releaseLegalHold(hold: LegalHold): void {
    if (!window.confirm('Release this legal hold?')) return;
    this.api.post<Envelope<LegalHold>>(`security/data-governance/legal-holds/${encodeURIComponent(hold.id)}/release`, {}).subscribe({
      next: () => { this.notice = 'Legal hold released.'; this.reloadPrivacyDisclosure(); },
      error: (error) => { this.errorMessage = this.errorText(error, 'Unable to release legal hold.'); },
    });
  }

  requestPiiExport(): void {
    const draft = this.piiExportDraft;
    if (draft.rowLimit === null || !draft.reason.trim() || !draft.mfaCode.trim() || this.saving) return;
    this.saving = true;
    this.api.post<Envelope<PiiExport>>('security/pii-exports', {
      subjectId: draft.subjectId.trim(), rowLimit: draft.rowLimit, reason: draft.reason.trim(), mfaCode: draft.mfaCode.trim(),
    }).subscribe({
      next: () => {
        this.piiExportDraft = { subjectId: '', rowLimit: null, reason: '', mfaCode: '' };
        this.notice = 'PII export requested for independent approval.';
        this.saving = false;
        this.reloadPrivacyDisclosure();
      },
      error: (error) => { this.errorMessage = this.errorText(error, 'Unable to request PII export.'); this.saving = false; },
    });
  }

  decidePiiExport(item: PiiExport, decision: 'approved' | 'rejected'): void {
    const note = decision === 'rejected' ? window.prompt('Rejection reason')?.trim() : '';
    if (decision === 'rejected' && !note) return;
    this.api.post<Envelope<PiiExport & { downloadToken?: string }>>(
      `security/pii-exports/${encodeURIComponent(item.id)}/decision`, { decision, note: note || '' },
    ).subscribe({
      next: (response) => {
        const result = this.unwrap(response);
        if (result.downloadToken) this.piiDownloadTokens[item.id] = result.downloadToken;
        this.notice = decision === 'approved' ? 'PII export approved. Download token expires in 15 minutes.' : 'PII export rejected.';
        this.reloadPrivacyDisclosure();
      },
      error: (error) => { this.errorMessage = this.errorText(error, 'Unable to decide PII export.'); },
    });
  }

  downloadPiiExport(item: PiiExport): void {
    const token = this.piiDownloadTokens[item.id];
    if (!token || !this.piiDownloadMfaCode.trim()) return;
    this.api.post<Envelope<Record<string, unknown>>>(`security/pii-exports/${encodeURIComponent(item.id)}/download`, {
      downloadToken: token, mfaCode: this.piiDownloadMfaCode.trim(),
    }).subscribe({
      next: (response) => {
        const payload = this.unwrap(response);
        const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }));
        const link = document.createElement('a');
        link.href = url;
        link.download = `pii-export-${item.id}.json`;
        link.click();
        URL.revokeObjectURL(url);
        delete this.piiDownloadTokens[item.id];
        this.piiDownloadMfaCode = '';
        this.notice = 'PII export downloaded once.';
        this.reloadPrivacyDisclosure();
      },
      error: (error) => { this.errorMessage = this.errorText(error, 'Unable to download PII export.'); },
    });
  }

  approvePrivacyDeletion(request: PrivacyRequest): void {
    this.api.post<Envelope<PrivacyRequest>>(`security/privacy-requests/${encodeURIComponent(request.id)}/approve-deletion`, {}).subscribe({
      next: () => { this.notice = 'Deletion approved.'; this.reloadPrivacyDisclosure(); },
      error: (error) => { this.errorMessage = this.errorText(error, 'Unable to approve deletion.'); },
    });
  }

  executePrivacyDeletion(request: PrivacyRequest): void {
    if (!this.privacyDeletionMfaCode.trim() || !window.confirm('Execute irreversible customer anonymization and session revocation?')) return;
    this.api.post<Envelope<Record<string, unknown>>>(`security/privacy-requests/${encodeURIComponent(request.id)}/execute-deletion`, {
      mfaCode: this.privacyDeletionMfaCode.trim(),
    }).subscribe({
      next: () => {
        this.privacyDeletionMfaCode = '';
        this.notice = 'Customer deletion executed.';
        this.reloadPrivacyDisclosure();
      },
      error: (error) => { this.errorMessage = this.errorText(error, 'Unable to execute customer deletion.'); },
    });
  }

  saveComplianceEvidence(): void {
    const draft = this.evidenceDraft;
    if (!draft.controlKey.trim() || !draft.title.trim() || !draft.ownerUserId.trim() || this.saving) return;
    this.saving = true;
    this.api.put<Envelope<ComplianceEvidenceItem>>(
      `security/compliance-evidence/${encodeURIComponent(draft.framework)}/${encodeURIComponent(draft.controlKey.trim())}`,
      { title: draft.title.trim(), ownerUserId: draft.ownerUserId.trim(), status: draft.status, evidenceReference: draft.evidenceReference.trim(), independentAssessor: draft.independentAssessor.trim(), validUntil: null, notes: draft.notes.trim(), version: draft.version },
    ).subscribe({
      next: () => {
        this.evidenceDraft = { framework: 'soc2', controlKey: '', title: '', ownerUserId: '', status: 'planned', evidenceReference: '', independentAssessor: '', notes: '', version: null };
        this.notice = 'Compliance evidence item saved.';
        this.saving = false;
        this.reloadPrivacyDisclosure();
      },
      error: (error) => { this.errorMessage = this.errorText(error, 'Unable to save compliance evidence.'); this.saving = false; },
    });
  }

  editComplianceEvidence(item: ComplianceEvidenceItem): void {
    this.evidenceDraft = { framework: item.framework, controlKey: item.controlKey, title: item.title, ownerUserId: item.ownerUserId, status: item.status, evidenceReference: item.evidenceReference, independentAssessor: item.independentAssessor, notes: item.notes, version: item.version };
  }

  savePenTestFinding(): void {
    const draft = this.penTestDraft;
    if (!draft.title.trim() || !draft.ownerUserId.trim() || this.saving) return;
    this.saving = true;
    const path = draft.id ? `security/pen-test-findings/${encodeURIComponent(draft.id)}` : 'security/pen-test-findings';
    const request = {
      title: draft.title.trim(), severity: draft.severity, status: draft.status, ownerUserId: draft.ownerUserId.trim(),
      remediationNote: draft.remediationNote.trim(), riskAcceptanceReason: draft.riskAcceptanceReason.trim(),
      riskAcceptanceExpiresAt: draft.riskAcceptanceExpiresAt ? new Date(draft.riskAcceptanceExpiresAt).toISOString() : null, version: draft.version,
    };
    const save = draft.id ? this.api.patch<Envelope<PenTestFinding>>(path, request) : this.api.post<Envelope<PenTestFinding>>(path, request);
    save.subscribe({
      next: () => {
        this.penTestDraft = { id: '', title: '', severity: 'high', status: 'open', ownerUserId: '', remediationNote: '', riskAcceptanceReason: '', riskAcceptanceExpiresAt: '', version: null };
        this.notice = 'Pen-test finding recorded.';
        this.saving = false;
        this.reloadPrivacyDisclosure();
      },
      error: (error) => { this.errorMessage = this.errorText(error, 'Unable to save pen-test finding.'); this.saving = false; },
    });
  }

  editPenTestFinding(item: PenTestFinding): void {
    this.penTestDraft = {
      id: item.id, title: item.title, severity: item.severity, status: item.status, ownerUserId: item.ownerUserId,
      remediationNote: item.remediationNote, riskAcceptanceReason: item.riskAcceptanceReason,
      riskAcceptanceExpiresAt: item.riskAcceptanceExpiresAt?.slice(0, 16) || '', version: item.version,
    };
  }

  createDisclosureReport(): void {
    if (!this.disclosureDraft.summary.trim() || this.saving) return;
    this.saving = true;
    this.errorMessage = '';
    this.api.post<Envelope<DisclosureReport>>('security/disclosure-reports', {
      reporterName: this.disclosureDraft.reporterName.trim(),
      reporterContact: this.disclosureDraft.reporterContact.trim(),
      summary: this.disclosureDraft.summary.trim(),
      details: this.disclosureDraft.details.trim(),
      severity: this.disclosureDraft.severity,
    }).subscribe({
      next: () => {
        this.disclosureDraft = { reporterName: '', reporterContact: '', summary: '', details: '', severity: 'warning' };
        this.notice = 'Disclosure report added.';
        this.saving = false;
        this.reloadPrivacyDisclosure();
      },
      error: (error) => {
        this.errorMessage = this.errorText(error, 'Unable to add disclosure report.');
        this.saving = false;
      },
    });
  }

  resolveDisclosureReport(report: DisclosureReport): void {
    if (!window.confirm('Resolve this disclosure report?')) return;
    this.api.post<Envelope<DisclosureReport>>(
      `security/disclosure-reports/${encodeURIComponent(report.id)}/resolve`,
      {},
    ).subscribe({
      next: () => { this.notice = 'Disclosure report resolved.'; this.reloadPrivacyDisclosure(); },
      error: (error) => { this.errorMessage = this.errorText(error, 'Unable to resolve disclosure report.'); },
    });
  }

  money(paise: number | undefined): number {
    return Number(paise || 0) / 100;
  }

  startMfaSetup(): void {
    if (this.saving) return;
    this.saving = true;
    this.errorMessage = '';
    this.notice = '';
    this.recoveryCodes = [];
    this.api.post<Envelope<MfaSetup>>('auth/mfa/setup', {}).subscribe({
      next: (response) => {
        this.mfaSetup = this.unwrap(response);
        this.mfaStatus = {
          enabled: false,
          required: this.mfaEnrollmentRequired || this.mfaStatus?.required === true,
          pending: true,
          recoveryCodesRemaining: 0,
        };
        this.mfaCode = '';
        this.saving = false;
      },
      error: (error) => {
        this.errorMessage = this.errorText(error, 'Unable to start MFA setup.');
        this.saving = false;
      },
    });
  }

  enableMfa(): void {
    if (!this.mfaCode.trim() || this.saving) return;
    this.saving = true;
    this.errorMessage = '';
    this.api.post<Envelope<MfaEnableResult>>('auth/mfa/enable', { code: this.mfaCode.trim() }).subscribe({
      next: (response) => {
        const result = this.unwrap(response);
        this.recoveryCodes = result.recoveryCodes;
        this.mfaSetup = undefined;
        this.mfaCode = '';
        this.notice = 'MFA enabled. Store the recovery codes now.';
        this.auth.refreshAccessToken().subscribe({
          next: () => {
            this.saving = false;
            this.reload();
          },
          error: () => {
            this.errorMessage = 'MFA enabled. Sign in again to continue.';
            this.saving = false;
          },
        });
      },
      error: (error) => {
        this.errorMessage = this.errorText(error, 'Unable to enable MFA.');
        this.saving = false;
      },
    });
  }

  disableMfa(): void {
    if (!this.mfaCode.trim() || this.saving || !window.confirm('Disable MFA for your account?')) return;
    this.saving = true;
    this.errorMessage = '';
    this.api.post<Envelope<{ enabled: boolean }>>('auth/mfa/disable', { code: this.mfaCode.trim() }).subscribe({
      next: () => {
        this.mfaSetup = undefined;
        this.mfaCode = '';
        this.recoveryCodes = [];
        this.notice = 'MFA disabled.';
        this.saving = false;
        this.reloadMfa();
      },
      error: (error) => {
        this.errorMessage = this.errorText(error, 'Unable to disable MFA.');
        this.saving = false;
      },
    });
  }

  async addPasskey(): Promise<void> {
    const label = this.passkeyLabel.trim();
    if (!label || this.saving) return;
    this.saving = true;
    this.errorMessage = '';
    this.notice = '';
    try {
      await this.webauthn.register(label);
      this.passkeyLabel = '';
      this.notice = 'Passkey added.';
      this.reloadPasskeys();
    } catch (error: any) {
      this.errorMessage = error?.error?.error?.message || error?.message || 'Unable to add passkey.';
    } finally {
      this.saving = false;
    }
  }

  deletePasskey(passkey: PasskeyInfo): void {
    if (!window.confirm('Delete this passkey?')) return;
    this.api.delete<Envelope<{ updated: boolean }>>(
      `auth/webauthn/credentials/${encodeURIComponent(passkey.credentialId)}`,
    ).subscribe({
      next: () => { this.notice = 'Passkey deleted.'; this.reloadPasskeys(); },
      error: (error) => { this.errorMessage = this.errorText(error, 'Unable to delete passkey.'); },
    });
  }

  verifyPrivilegedSession(): void {
    if (this.saving) return;
    const mfaCode = this.privilegedMfaCode.trim();
    const password = this.privilegedPassword.trim();
    if (this.mfaStatus?.enabled && !mfaCode) return;
    if (!this.mfaStatus?.enabled && !password) return;
    this.saving = true;
    this.errorMessage = '';
    this.api.post<Envelope<PrivilegedSessionStatus>>('security/privileged-session/verify', {
      mfaCode,
      password,
    }).subscribe({
      next: (response) => {
        this.privilegedStatus = this.unwrap(response);
        this.privilegedMfaCode = '';
        this.privilegedPassword = '';
        this.notice = 'Privileged session verified.';
        this.saving = false;
      },
      error: (error) => {
        this.errorMessage = this.errorText(error, 'Unable to verify privileged session.');
        this.saving = false;
      },
    });
  }

  revokePrivilegedSession(): void {
    if (this.saving) return;
    this.saving = true;
    this.errorMessage = '';
    this.api.post<Envelope<PrivilegedSessionStatus>>('security/privileged-session/revoke', {}).subscribe({
      next: (response) => {
        this.privilegedStatus = this.unwrap(response);
        this.notice = 'Privileged session ended.';
        this.saving = false;
      },
      error: (error) => {
        this.errorMessage = this.errorText(error, 'Unable to end privileged session.');
        this.saving = false;
      },
    });
  }

  rotateScimToken(): void {
    if (this.saving || !window.confirm('Rotate the SCIM token? The previous token will stop working.')) return;
    this.saving = true;
    this.errorMessage = '';
    this.api.post<Envelope<ScimTokenRotation>>('security/scim-token', {}).subscribe({
      next: (response) => {
        const result = this.unwrap(response);
        this.scimStatus = result.status;
        this.scimToken = result.token;
        this.notice = 'SCIM token rotated. Copy it now.';
        this.saving = false;
      },
      error: (error) => {
        this.errorMessage = this.errorText(error, 'Unable to rotate SCIM token.');
        this.saving = false;
      },
    });
  }

  saveSsoPolicy(): void {
    if (this.saving) return;
    this.saving = true;
    this.errorMessage = '';
    this.api.put<Envelope<SsoPolicyView>>('security/sso-policy', this.ssoDraft).subscribe({
      next: () => {
        this.notice = 'SSO policy saved.';
        this.saving = false;
        this.reloadSsoPolicy();
        this.reloadAudit();
      },
      error: (error) => {
        this.errorMessage = this.errorText(error, 'Unable to save SSO policy.');
        this.saving = false;
      },
    });
  }

  revokeScimToken(): void {
    if (this.saving || !window.confirm('Revoke SCIM provisioning access?')) return;
    this.saving = true;
    this.api.delete<Envelope<{ updated: boolean }>>('security/scim-token').subscribe({
      next: () => {
        this.scimStatus = { configured: false };
        this.scimToken = '';
        this.notice = 'SCIM token revoked.';
        this.saving = false;
      },
      error: (error) => {
        this.errorMessage = this.errorText(error, 'Unable to revoke SCIM token.');
        this.saving = false;
      },
    });
  }

  copyScimToken(): void {
    if (!this.scimToken) return;
    void navigator.clipboard.writeText(this.scimToken).then(() => { this.notice = 'SCIM token copied.'; });
  }

  titleCase(value: string): string {
    return value.replace(/\b\w+/g, (word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase());
  }

  trackById(index: number, item: { id?: string; sessionId?: string }): string {
    return item.id || item.sessionId || String(index);
  }

  trackByDevice(index: number, item: SecurityDevice): string {
    return `${item.userId}:${item.deviceId}` || String(index);
  }

  private reloadSummary(): void {
    this.api.get<Envelope<SecuritySummary>>('security/summary').subscribe({
      next: (response) => { this.summary = this.unwrap(response); },
      error: (error) => { this.errorMessage = this.errorText(error, 'Unable to refresh summary.'); },
    });
  }

  private reloadAudit(): void {
    forkJoin({
      audit: this.api.get<Envelope<{ events: AuditEvent[] }>>(
        `security/audit?q=${encodeURIComponent(this.auditSearch.trim())}`,
      ),
      chain: this.api.get<Envelope<AuditChainStatus>>('security/audit-chain/verify'),
      summary: this.api.get<Envelope<SecuritySummary>>('security/summary'),
    }).subscribe({
      next: (result) => {
        this.auditEvents = this.unwrap(result.audit).events;
        this.auditChain = this.unwrap(result.chain);
        this.summary = this.unwrap(result.summary);
      },
      error: (error) => { this.errorMessage = this.errorText(error, 'Unable to refresh audit data.'); },
    });
  }

  reloadFieldAudit(): void {
    this.api.get<Envelope<{ events: FieldAuditEvent[] }>>(
      `security/field-audit?field=${encodeURIComponent(this.fieldAuditSearch.trim())}`,
    ).subscribe({
      next: (response) => { this.fieldAuditEvents = this.unwrap(response).events; },
      error: (error) => { this.errorMessage = this.errorText(error, 'Unable to refresh field audit.'); },
    });
  }

  private reloadSessions(): void {
    this.api.get<Envelope<{ sessions: SecuritySession[] }>>('security/sessions').subscribe({
      next: (response) => { this.sessions = this.unwrap(response).sessions; this.reloadSummary(); },
      error: (error) => { this.errorMessage = this.errorText(error, 'Unable to refresh sessions.'); },
    });
  }

  private reloadDevices(): void {
    forkJoin({
      devices: this.api.get<Envelope<{ devices: SecurityDevice[] }>>('security/devices'),
      sessions: this.api.get<Envelope<{ sessions: SecuritySession[] }>>('security/sessions'),
      summary: this.api.get<Envelope<SecuritySummary>>('security/summary'),
    }).subscribe({
      next: (result) => {
        this.devices = this.unwrap(result.devices).devices;
        this.sessions = this.unwrap(result.sessions).sessions;
        this.summary = this.unwrap(result.summary);
      },
      error: (error) => { this.errorMessage = this.errorText(error, 'Unable to refresh devices.'); },
    });
  }

  private updateDevice(path: string, device: SecurityDevice, success: string): void {
    if (this.saving) return;
    this.saving = true;
    this.errorMessage = '';
    this.api.post<Envelope<SecurityDevice>>(path, {
      userId: device.userId,
      deviceId: device.deviceId,
    }).subscribe({
      next: () => {
        this.notice = success;
        this.saving = false;
        this.reloadDevices();
      },
      error: (error) => {
        this.errorMessage = this.errorText(error, 'Unable to update device.');
        this.saving = false;
      },
    });
  }

  private reloadAlerts(): void {
    this.api.get<Envelope<{ alerts: SecurityAlert[] }>>('security/alerts?status=all').subscribe({
      next: (response) => { this.alerts = this.unwrap(response).alerts; this.reloadSummary(); },
      error: (error) => { this.errorMessage = this.errorText(error, 'Unable to refresh alerts.'); },
    });
  }

  private reloadBlocks(): void {
    this.api.get<Envelope<{ blocks: SecurityBlock[] }>>('security/blocklist?status=all').subscribe({
      next: (response) => { this.blocks = this.unwrap(response).blocks; this.reloadSummary(); },
      error: (error) => { this.errorMessage = this.errorText(error, 'Unable to refresh blocklist.'); },
    });
  }

  private reloadPermissions(): void {
    this.api.get<Envelope<PermissionMatrix>>('security/permission-matrix').subscribe({
      next: (response) => { this.permissions = this.unwrap(response); },
      error: (error) => { this.errorMessage = this.errorText(error, 'Unable to refresh permissions.'); },
    });
  }

  private reloadFraudGuards(): void {
    forkJoin({
      risks: this.api.get<Envelope<{ risks: FraudRisk[] }>>('security/fraud-risks'),
      warnings: this.api.get<Envelope<{ warnings: FraudWarning[] }>>('security/fraud-warnings'),
    }).subscribe({
      next: (result) => {
        this.fraudRisks = this.unwrap(result.risks).risks;
        this.fraudWarnings = this.unwrap(result.warnings).warnings;
      },
      error: (error) => { this.errorMessage = this.errorText(error, 'Unable to refresh fraud guards.'); },
    });
  }

  private reloadSecurityGovernance(): void {
    forkJoin({
      approvals: this.api.get<Envelope<{ approvals: SecurityApproval[] }>>('security/approvals?status=all'),
      rules: this.api.get<Envelope<{ rules: SecurityAccessRule[] }>>('security/access-rules?status=all'),
      elevations: this.api.get<Envelope<{ elevations: TemporaryElevation[] }>>('security/elevations'),
    }).subscribe({
      next: (result) => {
        this.approvals = this.unwrap(result.approvals).approvals;
        this.accessRules = this.unwrap(result.rules).rules;
        this.elevations = this.unwrap(result.elevations).elevations;
      },
      error: (error) => { this.errorMessage = this.errorText(error, 'Unable to refresh security governance.'); },
    });
  }

  private reloadPlaybooks(): void {
    this.api.get<Envelope<{ playbooks: IncidentPlaybook[] }>>('security/playbooks?status=all').subscribe({
      next: (response) => { this.playbooks = this.unwrap(response).playbooks; },
      error: (error) => { this.errorMessage = this.errorText(error, 'Unable to refresh incident playbooks.'); },
    });
  }

  private reloadPrivacyDisclosure(): void {
    forkJoin({
      privacy: this.api.get<Envelope<{ requests: PrivacyRequest[] }>>('security/privacy-requests?status=all'),
      governance: this.api.get<Envelope<DataGovernance>>('security/data-governance'),
      disclosure: this.api.get<Envelope<{ reports: DisclosureReport[] }>>('security/disclosure-reports?status=all'),
    }).subscribe({
      next: (result) => {
        this.privacyRequests = this.unwrap(result.privacy).requests;
        this.dataGovernance = this.unwrap(result.governance);
        this.disclosureReports = this.unwrap(result.disclosure).reports;
      },
      error: (error) => { this.errorMessage = this.errorText(error, 'Unable to refresh privacy governance.'); },
    });
  }

  private reloadSsoPolicy(): void {
    this.api.get<Envelope<SsoPolicyView>>('security/sso-policy').subscribe({
      next: (response) => { this.setSsoPolicy(this.unwrap(response)); },
      error: (error) => { this.errorMessage = this.errorText(error, 'Unable to refresh SSO policy.'); },
    });
  }

  private reloadProvisioning(): void {
    forkJoin({
      scim: this.api.get<Envelope<ScimTokenStatus>>('security/scim-token'),
      ssoPolicy: this.api.get<Envelope<SsoPolicyView>>('security/sso-policy'),
    }).subscribe({
      next: (result) => {
        this.scimStatus = this.unwrap(result.scim);
        this.setSsoPolicy(this.unwrap(result.ssoPolicy));
      },
      error: (error) => { this.errorMessage = this.errorText(error, 'Unable to refresh provisioning.'); },
    });
  }

  private reloadPrivilegedSession(): void {
    forkJoin({
      mfa: this.api.get<Envelope<MfaStatus>>('auth/mfa/status'),
      privileged: this.api.get<Envelope<PrivilegedSessionStatus>>('security/privileged-session'),
    }).subscribe({
      next: (result) => {
        this.mfaStatus = this.unwrap(result.mfa);
        this.privilegedStatus = this.unwrap(result.privileged);
      },
      error: (error) => { this.errorMessage = this.errorText(error, 'Unable to refresh privileged session.'); },
    });
  }

  private reloadPolicy(): void {
    this.api.get<Envelope<SecurityPolicyView>>('security/policy').subscribe({
      next: (response) => { this.policy = { ...this.unwrap(response).settings }; },
      error: (error) => { this.errorMessage = this.errorText(error, 'Unable to refresh security policy.'); },
    });
  }

  private setSsoPolicy(policy: SsoPolicyView): void {
    this.ssoPolicy = policy;
    this.ssoDraft = {
      googleEnabled: policy.googleEnabled,
      microsoftEnabled: policy.microsoftEnabled,
      samlEnabled: policy.samlEnabled,
      enforcedRoles: [...policy.enforcedRoles],
    };
  }

  private localIsoDate(): string {
    const date = new Date();
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  }

  private reloadMfa(): void {
    this.api.get<Envelope<MfaStatus>>('auth/mfa/status').subscribe({
      next: (response) => { this.mfaStatus = this.unwrap(response); },
      error: (error) => { this.errorMessage = this.errorText(error, 'Unable to refresh MFA status.'); },
    });
  }

  private reloadPasskeys(): void {
    this.api.get<Envelope<{ credentials: PasskeyInfo[] }>>('auth/webauthn/credentials').subscribe({
      next: (response) => { this.passkeys = this.unwrap(response).credentials; },
      error: (error) => { this.errorMessage = this.errorText(error, 'Unable to refresh passkeys.'); },
    });
  }

  private unwrap<T>(response: Envelope<T>): T {
    if (response.success && response.data !== undefined) return response.data;
    throw new Error(response.error?.message || 'Request failed.');
  }

  private errorText(error: any, fallback: string): string {
    return error?.error?.error?.message || error?.message || fallback;
  }
}
