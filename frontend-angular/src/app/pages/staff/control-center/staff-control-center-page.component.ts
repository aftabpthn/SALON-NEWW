import { LanguageService } from '../../../core/i18n/language.service';
import { CommonModule } from '@angular/common';
import { TranslatePipe } from '../../../shared/pipes/translate.pipe';
import { Component, OnInit, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { DatePickerComponent } from '../../../shared/date-picker/date-picker.component';
import { ApiEnvelope, ApiService } from '../../../shared/services/api.service';
import { AuthService } from '../../../core/services/auth.service';

type WorkspaceTab = 'command' | 'workforce' | 'hrms' | 'development' | 'systems' | 'governance' | 'content';
type Row = Record<string, any>;
type SectionRequest = { label: string; run: Promise<void> };
type HrmsField = { key: string; label: string; type?: 'text' | 'number' | 'date' | 'textarea' | 'select' | 'multiselect'; required?: boolean; options?: Array<{ value: string; label: string }> };

@Component({
    selector: 'page-staff-control-center',
    imports: [CommonModule, FormsModule, DatePickerComponent, TranslatePipe],
    templateUrl: './staff-control-center-page.component.html',
    styleUrls: ['./staff-control-center-page.component.css']
})
export class StaffControlCenterPageComponent implements OnInit {
  private readonly language = inject(LanguageService);
  private readonly api = inject(ApiService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly auth = inject(AuthService);

  readonly tabs: Array<{ key: WorkspaceTab; label: string; icon: string }> = [
    { key: 'command', label: 'Command center', icon: 'bi-speedometer2' },
    { key: 'workforce', label: 'Workforce', icon: 'bi-calendar2-week' },
    { key: 'hrms', label: 'HRMS', icon: 'bi-diagram-3' },
    { key: 'development', label: 'Development', icon: 'bi-mortarboard' },
    { key: 'systems', label: 'Systems', icon: 'bi-fingerprint' },
    { key: 'governance', label: 'Governance', icon: 'bi-shield-check' },
    { key: 'content', label: 'Content', icon: 'bi-plus-square-dotted' },
  ];

  activeTab: WorkspaceTab = 'command';
  periodStart = this.isoDate(new Date(Date.now() - 29 * 86_400_000));
  periodEnd = this.isoDate(new Date());
  loading = false;
  error = '';
  lastLoaded = '';

  command: Row | null = null;
  floor: Row[] = [];
  swaps: Row[] = [];
  transfers: Row[] = [];
  coverage: Row | null = null;
  manpower: Row | null = null;
  skillMatrix: Row[] = [];
  licenses: Row[] = [];
  reviews: Row[] = [];
  coachingGoals: Row[] = [];
  training: Row[] = [];
  performanceSettings: Row = { visibleMetricKeys: [], customMetrics: [], version: 0 };
  readonly performanceMetrics = [
    ['product_service_percent', 'Product / service %'], ['repeat_guests_retained', 'Repeat guests retained'],
    ['new_guests_retained', 'New guests retained'], ['requested_count', 'Requested count'],
    ['service_sales', 'Service sales'], ['rebook_count', 'Rebook count'], ['rebook_rate', 'Rebook rate'],
    ['new_service_guests', 'New service guests'], ['service_invoices_with_product_percent', 'Invoices with product %'],
    ['average_feedback', 'Average feedback'], ['guest_count', 'Guest count'], ['average_invoice_value', 'Average invoice value'],
    ['service_revenue', 'Service revenue'], ['free_service_revenue', 'Free-service revenue'], ['product_revenue', 'Product revenue'],
    ['membership_revenue', 'Membership revenue'], ['package_revenue', 'Package revenue'], ['utilization', 'Utilization'],
    ['attendance', 'Attendance'], ['tips', 'Tips'], ['commissions', 'Commissions']
  ];
  lms: Row = { courses: [], enrolments: [], requirements: [], skillMatrix: [], recommendations: [] };
  devices: Row[] = [];
  gateways: Row[] = [];
  mappings: Row[] = [];
  consents: Row[] = [];
  biometricExceptions: Row[] = [];
  faceExceptions: Row[] = [];
  facePolicy: Row | null = null;
  mobileConflicts: Row[] = [];
  mobileTelemetry: Row[] = [];
  approvals: Row[] = [];
  feedbackRows: Row[] = [];
  auditRows: Row[] = [];
  notifications: Row[] = [];
  notificationLogs: Row[] = [];
  tips: Row[] = [];
  compliance: Row | null = null;
  selfService: Row | null = null;
  rosterDraft: Row | null = null;
  staffAi: Row | null = null;
  hrms: Row = { jobOpenings: [], applications: [], lifecycleCases: [], orgChart: [], documentAlerts: [], appraisalCycles: [], goalTemplates: [], appraisalReviews: [], learning: {}, successionPlans: [], promotionReadiness: { items: [] }, operationsIntelligence: { summary: {}, expiryAlerts: [], onboardingOverdue: [], missedTasks: [], exceptions: { items: [] }, completion: {}, benchmarks: { branch: {}, staff: [] }, monthlyOwnerSummary: {} } };
  contentTasks: Row[] = [];
  contentOffers: Row[] = [];
  penaltyRules: Row[] = [];
  rulesCenter: Row = { documents: [], violations: [] };
  surveys: Row[] = [];
  ruleEditorOpen = false;
  ruleDraft: Row = this.emptyRuleDraft();
  ruleQuiz: Row[] = [];
  hrmsEditorKind = '';
  hrmsEditorTitle = '';
  hrmsEditorFields: HrmsField[] = [];
  hrmsEditorRow: Row | null = null;
  hrmsDraft: Row = {};

  async ngOnInit() {
    const tab = this.route.snapshot.queryParamMap.get('tab');
    if (this.tabs.some((item) => item.key === tab)) this.activeTab = tab as WorkspaceTab;
    await this.refresh();
  }

  async refresh() {
    this.loading = true;
    this.error = '';
    const sections = this.tabRequests(this.activeTab);
    const results = await Promise.allSettled(sections.map((section) => section.run));
    const failures = sections.filter((_, index) => results[index].status === 'rejected').map((section) => section.label);
    if (failures.length) this.error = `Could not load: ${failures.join(', ')}`;
    this.lastLoaded = new Date().toISOString();
    this.loading = false;
  }

  private tabRequests(tab: WorkspaceTab): SectionRequest[] {
    const period = this.periodQuery();
    const today = this.periodEnd;
    if (tab === 'command') return [
      this.section('command center', this.loadOne(`/staff-enterprise/command-center?${period}`, (value) => this.command = value)),
      this.section('floor control', this.loadList(`/staff-enterprise/floor-control?date=${today}`, (value) => this.floor = value)),
    ];
    if (tab === 'workforce') return [
      this.section('shift swaps', this.loadList('/staff/shift-swaps', (value) => this.swaps = value)),
      this.section('branch transfers', this.loadList('/staff/branch-transfers', (value) => this.transfers = value)),
      this.section('roster coverage', this.loadOne(`/staff/roster/coverage?${period}`, (value) => this.coverage = value)),
      this.section('manpower forecast', this.loadOne(`/staff/manpower/forecast?${period}`, (value) => this.manpower = value)),
      this.section('staff AI', this.loadOne(`/staff/intelligence/ai-analysis?${period}`, (value) => this.staffAi = value)),
    ];
    if (tab === 'development') return [
      this.section('learning and skills', this.loadOne('/staff-enterprise/lms', (value) => {
        this.lms = value;
        this.skillMatrix = this.arrayValue(value['skillMatrix']);
      })),
      this.section('skill licenses', this.loadList('/staff/skill-licenses', (value) => this.licenses = value)),
      this.section('performance reviews', this.loadList('/staff/performance-reviews', (value) => this.reviews = value)),
      this.section('coaching goals', this.loadList('/staff/coach/goals', (value) => this.coachingGoals = value)),
      this.section('training', this.loadList('/staff-enterprise/training', (value) => this.training = value)),
      this.section('performance metric settings', this.loadOne('/staff/performance-settings', (value) => this.performanceSettings = value)),
    ];
    if (tab === 'hrms') return [
      this.section('enterprise HRMS', this.loadOne('/staff/hrms', (value) => this.hrms = value)),
      this.section('HR operations intelligence', this.loadOne(`/staff/hrms/operations-intelligence?${new URLSearchParams({ from: this.periodStart, to: this.periodEnd })}`, (value) => this.hrms['operationsIntelligence'] = value)),
    ];
    if (tab === 'systems') return [
      this.section('biometric devices', this.loadList('/staff/biometric/devices', (value) => this.devices = value)),
      this.section('biometric gateways', this.loadList('/staff/biometric/gateways', (value) => this.gateways = value)),
      this.section('biometric mappings', this.loadList('/staff/biometric/mappings', (value) => this.mappings = value)),
      this.section('biometric consents', this.loadList('/staff/biometric/consents', (value) => this.consents = value)),
      this.section('biometric exceptions', this.loadList('/staff/biometric/exceptions', (value) => this.biometricExceptions = value)),
      this.section('face attendance policy', this.loadOne('/staff-attendance/face-policy', (value) => this.facePolicy = value)),
      this.section('face attendance exceptions', this.loadList('/staff-attendance/face-exceptions', (value) => this.faceExceptions = value)),
      this.section('mobile conflicts', this.loadList('/staff/mobile/conflicts?status=open', (value) => this.mobileConflicts = value)),
      this.section('mobile telemetry', this.loadList('/staff/mobile/telemetry', (value) => this.mobileTelemetry = value)),
      this.section('staff self dashboard', this.loadOne(`/staff/self/dashboard?date=${today}`, (value) => this.selfService = value).catch((error) => {
        if ((error as { status?: number }).status === 404) this.selfService = null;
        else throw error;
      })),
    ];
    if (tab === 'content') return [
      this.section('rules and SOP', this.loadOne('/staff/rules', (value) => this.rulesCenter = value)),
      this.section('employee surveys', this.loadList('/staff/surveys', (value) => this.surveys = value)),
      this.section('tasks', this.loadList('/staff/tasks', (value) => this.contentTasks = value)),
      this.section('offers', this.loadList('/marketing/offers', (value) => this.contentOffers = value)),
      this.section('payroll rules', this.loadList('/staff/payroll-adjustment-rules', (value) => this.penaltyRules = value)),
    ];
    return [
      this.section('approvals', this.loadList('/staff/approvals?status=pending', (value) => this.approvals = value)),
      this.section('feedback', this.loadList('/staff/feedback', (value) => this.feedbackRows = value.map((row) => ({ ...row, nextStatus: row['status'], managerNoteDraft: row['managerNote'] || '' })))),
      this.section('audit', this.loadList('/staff/audit?eventPrefix=staff.', (value) => this.auditRows = value)),
      this.section('notifications', this.loadList('/staff/notifications', (value) => this.notifications = value)),
      this.section('notification logs', this.loadList('/staff/notification-delivery-logs', (value) => this.notificationLogs = value)),
      this.section('tips', this.loadList(`/staff/tips/summary?${period}`, (value) => this.tips = value)),
      this.section('payroll compliance', this.loadOne(`/staff/payroll-compliance/summary?${period}`, (value) => this.compliance = value)),
    ];
  }

  private section(label: string, run: Promise<void>): SectionRequest { return { label, run }; }

  canManage(...permissions: string[]) {
    return this.auth.hasRole('owner', 'admin', 'manager')
      || this.auth.hasPermission(...permissions)
      || (this.activeTab === 'hrms' && this.auth.hasPermission('staff.hrms.manage'));
  }

  performanceMetricKeys(): string[] { const value = this.performanceSettings['visibleMetricKeys']; return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []; }
  metricEnabled(key: string) { return this.performanceMetricKeys().includes(key); }
  togglePerformanceMetric(key: string, enabled: boolean) {
    const keys = new Set(this.performanceMetricKeys());
    enabled ? keys.add(key) : keys.delete(key);
    this.performanceSettings['visibleMetricKeys'] = [...keys];
  }
  addCustomPerformanceMetric() {
    const sourceMetricKey = this.askChoice('Source metric', this.performanceMetrics.map(([key]) => key));
    if (!sourceMetricKey) return;
    const label = this.ask('Custom metric label');
    if (!label) return;
    const key = label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 64);
    if (!key) return;
    const rows = this.arrayValue(this.performanceSettings['customMetrics']);
    if (rows.some((row) => row['key'] === key)) { this.error = 'Custom metric key already exists'; return; }
    this.performanceSettings['customMetrics'] = [...rows, { key, label, sourceMetricKey }];
  }
  removeCustomPerformanceMetric(key: string) { this.performanceSettings['customMetrics'] = this.arrayValue(this.performanceSettings['customMetrics']).filter((row) => row['key'] !== key); }
  async savePerformanceSettings() {
    await this.action('/staff/performance-settings', {
      visibleMetricKeys: this.performanceMetricKeys(),
      customMetrics: this.arrayValue(this.performanceSettings['customMetrics']),
      version: Number(this.performanceSettings['version'] || 0)
    }, true, 'put');
  }

  async decideSwap(row: Row, decision: 'approved' | 'rejected') {
    await this.action(`/staff/shift-swaps/${row['id']}/decision`, { decision, version: row['version'], note: '' });
  }

  async decideTransfer(row: Row, decision: 'approved' | 'rejected') {
    await this.action(`/staff/branch-transfers/${row['id']}/decision`, { decision, version: row['version'], note: '' });
  }

  async decideApproval(row: Row, decision: 'approved' | 'rejected') {
    await this.action(`/staff/approvals/${row['id']}/decision`, { decision, version: row['version'], comments: '' });
  }

  async createApproval() {
    const requestType = this.ask('Request type');
    const entityType = this.ask('Entity type');
    const entityId = this.ask('Entity ID');
    if (!requestType || !entityType || !entityId) return;
    await this.action('/staff/approvals', {
      requestType,
      entityType,
      entityId,
      amountPaise: this.contentRupeesToPaise(this.askOptional('Amount INR')) || 0,
      payload: {},
    });
  }

  async addFeedbackResolution() {
    const feedbackId = this.ask('Feedback ID');
    const status = this.askChoice('Status', ['in_review', 'resolved', 'closed']) || 'resolved';
    const managerNote = this.ask('Manager note');
    if (!feedbackId || !managerNote) return;
    await this.action(`/staff/feedback/${feedbackId}`, { status, managerNote }, true, 'patch');
  }

  async resolveFeedback(row: Row) {
    const status = String(row['nextStatus'] || row['status'] || '').trim();
    const managerNote = String(row['managerNoteDraft'] || '').trim();
    if (['resolved', 'closed'].includes(status) && !managerNote) {
      this.error = 'Manager note is required to resolve or close feedback';
      return;
    }
    await this.action(`/staff/feedback/${row['id']}`, { status, managerNote }, true, 'patch');
  }

  async createShiftSwap(row?: Row) {
    const scheduleId = this.ask('Schedule ID', row?.['scheduleId']);
    const toStaffId = this.ask('Target staff ID');
    if (!scheduleId || !toStaffId) return;
    await this.action('/staff/shift-swaps', { scheduleId, toStaffId, reason: this.askOptional('Reason') });
  }

  async createTransfer() {
    const staffId = this.ask('Staff ID');
    const targetBranchId = this.ask('Target branch ID');
    const roleId = this.ask('Role ID');
    const transferType = this.askChoice('Transfer type', ['deputation', 'permanent']);
    if (!staffId || !targetBranchId || !roleId || !transferType) return;
    const payload: Row = { staffId, targetBranchId, roleId, transferType, reason: this.askOptional('Reason') };
    if (transferType === 'deputation') {
      payload['validFrom'] = this.ask('Valid from YYYY-MM-DD', this.periodStart);
      payload['validUntil'] = this.ask('Valid until YYYY-MM-DD', this.periodEnd);
      if (!payload['validFrom'] || !payload['validUntil']) return;
    }
    await this.action('/staff/branch-transfers', payload);
  }

  async optimizeRoster() {
    this.rosterDraft = await this.action<Row>('/staff/roster/optimize', { periodStart: this.periodStart, periodEnd: this.periodEnd }, false);
  }

  async applyRoster() {
    if (!this.rosterDraft?.['id']) return;
    await this.action(`/staff/roster/drafts/${this.rosterDraft['id']}/apply`, { version: this.rosterDraft['version'] || 1 });
    this.rosterDraft = null;
  }

  async createLicense(row?: Row, status = 'pending') {
    const staffId = String(row?.['staffId'] || this.ask('Staff ID') || '');
    const skillName = String(row?.['skillName'] || this.ask('Skill name') || '');
    if (!staffId || !skillName) return;
    await this.action('/staff/skill-licenses', {
      id: row?.['id'] || undefined,
      staffId,
      skillName,
      skillLevel: Number(row?.['skillLevel'] || 1),
      issuer: row?.['issuer'] || this.askOptional('Issuer'),
      licenseNumber: row?.['licenseNumber'] || this.askOptional('License number'),
      issuedOn: row?.['issuedOn'] || this.askOptional('Issued on YYYY-MM-DD'),
      expiresOn: row?.['expiresOn'] || this.askOptional('Expires on YYYY-MM-DD'),
      verificationStatus: status,
      documentUrl: row?.['documentUrl'] || this.askOptional('Document URL'),
      notes: row?.['notes'] || this.askOptional('Notes'),
      version: row?.['version'],
    });
  }

  async createReview(row?: Row, status = 'draft') {
    const staffId = String(row?.['staffId'] || this.ask('Staff ID') || '');
    if (!staffId) return;
    await this.action('/staff/performance-reviews', {
      id: row?.['id'] || undefined,
      staffId,
      periodStart: row?.['periodStart'] || this.periodStart,
      periodEnd: row?.['periodEnd'] || this.periodEnd,
      score: Number((row?.['score'] ?? this.askOptional('Score 0-100')) || 0) || undefined,
      strengths: row?.['strengths'] || this.askOptional('Strengths'),
      improvementAreas: row?.['improvementAreas'] || this.askOptional('Improvement areas'),
      goals: row?.['goals'] || this.askOptional('Goals'),
      employeeComments: row?.['employeeComments'] || '',
      status,
      version: row?.['version'],
    });
  }

  async assignTraining() {
    const staffId = this.ask('Staff ID');
    const title = this.ask('Training title');
    if (!staffId || !title) return;
    const dueDate = this.askOptional('Due date YYYY-MM-DD');
    await this.action('/staff-enterprise/training/assign', {
      staffId,
      title,
      description: this.askOptional('Description'),
      priority: this.askChoice('Priority', ['medium', 'low', 'high', 'urgent']) || 'medium',
      dueAt: dueDate ? `${dueDate}T23:59:00+05:30` : undefined,
    });
  }

  async configureCourse(row: Row) {
    const skillName = this.askOptional('Skill name (empty for general SOP)', row['skillName'] || '');
    const skillLevel = Number(this.ask('Skill level 1-5', row['skillLevel'] || 1));
    const expectedMinutes = Number(this.ask('Expected minutes', row['expectedMinutes'] || 0));
    const certificationValidDays = Number(this.ask('Certification validity days (0 for none)', row['certificationValidDays'] || 0));
    if (![skillLevel, expectedMinutes, certificationValidDays].every(Number.isInteger)) return;
    await this.action(`/staff-enterprise/lms/courses/${row['id']}/profile`, {
      skillName, skillLevel, expectedMinutes, certificationValidDays, version: row['profileVersion'] || undefined,
    });
  }

  async assignCourse(row?: Row) {
    const staffId = this.ask('Staff ID');
    const courseId = String(row?.['id'] || this.ask('Course ID') || '');
    if (!staffId || !courseId) return;
    const dueDate = this.askOptional('Due date YYYY-MM-DD');
    await this.action('/staff-enterprise/lms/enrolments', {
      staffId, courseId,
      priority: this.askChoice('Priority', ['medium', 'low', 'high', 'urgent']) || 'medium',
      dueAt: dueDate ? `${dueDate}T23:59:00+05:30` : undefined,
    });
  }

  async saveSkillRequirement(row?: Row) {
    const scopeType = String(row?.['scopeType'] || this.askChoice('Scope', ['role', 'service']) || '');
    const scopeId = String(row?.['scopeId'] || this.ask('Role or service ID') || '');
    const skillName = String(row?.['skillName'] || this.ask('Required skill') || '');
    const requiredLevel = Number(this.ask('Required level 1-5', row?.['requiredLevel'] || 1));
    if (!scopeType || !scopeId || !skillName || !Number.isInteger(requiredLevel)) return;
    await this.action('/staff-enterprise/lms/skill-requirements', {
      scopeType, scopeId, skillName, requiredLevel,
      certificationRequired: row?.['certificationRequired'] ?? true,
      active: row?.['active'] ?? true,
      version: row?.['version'],
    });
  }

  async renewCertification(row: Row) {
    const expiresOn = this.ask('New expiry YYYY-MM-DD');
    if (!expiresOn) return;
    await this.action(`/staff-enterprise/lms/certifications/${row['id']}/renew`, {
      version: row['version'], expiresOn, documentUrl: this.askOptional('Renewal evidence URL'),
    });
  }

  async completeTraining(row: Row) {
    await this.action(`/staff/tasks/${row['id']}`, {
      staffId: row['staffId'],
      title: row['title'],
      description: row['description'] || '',
      taskType: row['taskType'] || 'training',
      priority: row['priority'] || 'medium',
      dueAt: row['dueAt'] || undefined,
      status: 'completed',
      version: row['version'],
    }, true, 'patch');
  }

  async completeCoachingAction(action: Row) {
    await this.action(`/staff/coach/actions/${action['id']}/complete`, { version: action['version'] || 1 });
  }

  async createDevice() {
    const provider = this.ask('Provider');
    const deviceCode = this.ask('Device code');
    const deviceName = this.ask('Device name');
    if (!provider || !deviceCode || !deviceName) return;
    await this.action('/staff/biometric/devices', { provider, deviceCode, deviceName, connectionMode: this.askOptional('Connection mode') });
  }

  async addCctvCamera() {
    const deviceCode = this.ask('CCTV camera code');
    const deviceName = this.ask('CCTV camera name');
    if (!deviceCode || !deviceName) return;
    await this.action('/staff/biometric/devices', { provider: 'camera', deviceCode, deviceName, connectionMode: 'gateway' }, false);
    const gatewayCode = this.askOptional('CCTV gateway code');
    if (gatewayCode) {
      const row = await this.action<Row>('/staff/biometric/gateways', { gatewayCode, displayName: gatewayCode, providers: ['camera'] });
      if (row?.['apiKey']) window.alert(`Gateway API key - copy now: ${row['apiKey']}`);
    } else {
      await this.refresh();
    }
  }
  async registerGateway() {
    const gatewayCode = this.ask('Gateway code');
    if (!gatewayCode) return;
    const providers = (this.askOptional('Providers comma separated') || '').split(',').map((item) => item.trim()).filter(Boolean);
    const row = await this.action<Row>('/staff/biometric/gateways', {
      gatewayCode,
      displayName: this.askOptional('Display name') || gatewayCode,
      providers,
      versionLabel: this.askOptional('Gateway version'),
    });
    if (row?.['apiKey']) window.alert(`Gateway API key - copy now: ${row['apiKey']}`);
  }

  async heartbeatGateway(row: Row) {
    const apiKey = this.ask('Gateway API key');
    if (!apiKey) return;
    await this.actionWithHeaders(`/staff/biometric/gateways/${row['id']}/heartbeat`, { versionLabel: row['versionLabel'] || '' }, { 'x-gateway-api-key': apiKey });
  }

  async createMapping() {
    const deviceId = this.ask('Device ID');
    const staffId = this.ask('Staff ID');
    const externalUserId = this.ask('External user ID');
    if (!deviceId || !staffId || !externalUserId) return;
    await this.action('/staff/biometric/mappings', { deviceId, staffId, externalUserId });
  }

  async approveMapping(row: Row) {
    await this.action(`/staff/biometric/mappings/${row['id']}/approve`, { version: row['version'] || 1 });
  }

  async saveConsent(row?: Row, status: 'granted' | 'withdrawn' = 'granted') {
    const staffId = String(row?.['staffId'] || this.ask('Staff ID') || '');
    if (!staffId) return;
    await this.action('/staff/biometric/consents', {
      staffId,
      purpose: row?.['purpose'] || this.askOptional('Purpose') || 'attendance',
      status,
      notes: row?.['notes'] || this.askOptional('Notes'),
      version: row?.['version'],
    });
  }

  async requestConsentDeletion(row: Row) {
    await this.action(`/staff/biometric/consents/${row['id']}/deletion-request`, { version: row['version'] || 1 });
  }

  async saveFacePolicy() {
    const current = this.facePolicy || {};
    const allowedRadiusMeters = Number(this.ask('Allowed radius meters', current['allowedRadiusMeters'] || 200));
    const networkMode = this.askChoice('Network mode', ['required', 'optional', 'off']) || String(current['networkMode'] || 'required');
    const currentIps = this.arrayValue(current['ipAllowlist']).join(',');
    const ipPrompt = 'Branch public IPs comma separated' + (currentIps ? ' (' + currentIps + ')' : '');
    const ipAllowlist = (this.askOptional(ipPrompt) || currentIps).split(',').map((ip) => ip.trim()).filter(Boolean);
    const livenessMode = this.askChoice('Liveness mode', ['basic', 'provider', 'none']) || String(current['livenessMode'] || 'basic');
    if (!Number.isFinite(allowedRadiusMeters)) return;
    await this.action('/staff-attendance/face-policy', {
      enabled: true,
      allowedRadiusMeters,
      deviceMode: String(current['deviceMode'] || 'approved'),
      networkMode,
      ipAllowlist,
      livenessMode,
    }, true, 'put');
  }

  async approveFaceException(row: Row) {
    await this.action(`/staff-attendance/face-exceptions/${row['id']}/approve`, {});
  }
  async approveFaceDevice(row: Row) {
    const deviceUid = String(row['deviceUid'] || '').trim();
    if (!deviceUid) return;
    await this.action(`/staff-attendance/face-devices/${encodeURIComponent(deviceUid)}/approve`, {});
  }
  async registerMobileDevice() {
    const staffId = this.ask('Staff ID');
    const deviceUid = this.ask('Device UID');
    const platform = this.askChoice('Platform', ['android', 'ios', 'web', 'windows']);
    if (!staffId || !deviceUid || !platform) return;
    const row = await this.action<Row>('/staff/mobile/devices', { staffId, deviceUid, platform });
    if (row?.['syncToken']) window.alert(`Mobile sync token - copy now: ${row['syncToken']}`);
  }

  async syncMobileMutation() {
    const deviceId = this.ask('Device ID');
    const syncToken = this.ask('Device sync token');
    const actionType = this.askChoice('Action type', ['clock_in', 'clock_out', 'leave_request', 'task_complete', 'service_start', 'service_complete']);
    const rawPayload = this.askOptional('Payload JSON');
    if (!deviceId || !syncToken || !actionType) return;
    let payload: unknown = {};
    if (rawPayload) {
      try {
        payload = JSON.parse(rawPayload);
      } catch {
        this.error = this.language.text('staff.message.67ef55faf5');
        return;
      }
    }
    await this.actionWithHeaders('/staff/mobile/sync', {
      deviceId,
      mutations: [{ idempotencyKey: crypto.randomUUID(), actionType, payload }],
    }, { 'x-device-sync-token': syncToken });
  }

  async resolveConflict(row: Row) {
    const resolution = this.askChoice('Resolution', ['server_wins', 'client_wins', 'manual']);
    if (!resolution) return;
    await this.action(`/staff/mobile/conflicts/${row['id']}/resolve`, { resolution, version: row['version'] || 1 });
  }

  async calculateCompliance() {
    const payrollRunId = this.ask('Payroll run ID');
    const staffId = this.ask('Staff ID');
    if (!payrollRunId || !staffId) return;
    await this.action('/staff/payroll-compliance/calculate', { payrollRunId, staffId });
  }

  async exportCompliance() {
    const row = await this.action<Row>('/staff/payroll-compliance/export', { periodStart: this.periodStart, periodEnd: this.periodEnd }, false);
    if (!row) return;
    this.downloadJson(row, `staff-compliance-${this.periodStart}-${this.periodEnd}.json`);
  }

  async recordTipPayout(row?: Row) {
    const staffId = String(row?.['staffId'] || this.ask('Staff ID') || '');
    const payoutReference = this.ask('Payout reference');
    const saleIds = (this.ask('Sale IDs comma separated') || '').split(',').map((id) => id.trim()).filter(Boolean);
    if (!staffId || !payoutReference || saleIds.length === 0) return;
    await this.action('/staff/tips/payouts', { staffId, periodStart: this.periodStart, periodEnd: this.periodEnd, payoutReference, saleIds });
  }

  async createTemplate() {
    const notificationType = this.askChoice('Notification type', [
      'schedule', 'attendance', 'leave', 'task', 'training', 'payroll',
      'payroll_finalized', 'payroll_paid', 'payroll_payslip_available',
      'payroll_fine_applied', 'payroll_advance_recovered', 'payroll_corrected',
      'compliance', 'announcement',
    ]);
    const languageCode = this.askChoice('Language', ['en-IN', 'hi-IN', 'hi-Latn-IN']) || 'en-IN';
    const title = this.ask('Title');
    const bodyTemplate = this.ask('Body template');
    if (!notificationType || !title || !bodyTemplate) return;
    await this.action('/staff/notification-templates', { notificationType, title, bodyTemplate, languageCode, sensitive: notificationType.startsWith('payroll') || notificationType === 'compliance' });
  }

  async savePreference() {
    const staffId = this.ask('Staff ID');
    if (!staffId) return;
    await this.action(`/staff/${staffId}/notification-preferences`, {
      whatsappOptIn: this.askChoice('WhatsApp opt-in', ['true', 'false']) !== 'false',
      allowPayrollAmounts: this.askChoice('Allow payroll amounts', ['false', 'true']) === 'true',
      languageCode: this.askOptional('Language code') || 'en-IN',
    }, true, 'put');
  }

  async createContentTask() {
    await this.router.navigate(['/staff-os/tasks'], { queryParams: { create: 1 } });
  }

  async createStaffGuidance(taskType: 'training' | 'compliance') {
    const staffId = this.ask('Staff ID');
    const title = this.ask(taskType === 'training' ? 'SOP title' : 'Rule title');
    const description = this.ask(taskType === 'training' ? 'SOP steps' : 'Rule details');
    if (!staffId || !title || !description) return;
    const dueDate = this.toIsoDate(this.askOptional('Due date YYYY-MM-DD') || '');
    await this.action('/staff/tasks', {
      staffId, title, description, taskType, priority: 'high',
      dueAt: dueDate ? `${dueDate}T23:59:00+05:30` : undefined,
      status: 'open',
    });
  }

  createJobOpening() {
    this.openHrmsEditor('job-opening', 'New job opening', [
      this.field('title', 'Job title', 'text', true), this.field('department', 'Department'),
      this.choice('employmentType', 'Employment type', ['full_time', 'part_time', 'contract', 'intern'], true),
      this.field('openingsCount', 'Openings', 'number'), this.field('description', 'Description', 'textarea'),
    ], { employmentType: 'full_time', openingsCount: '' });
  }

  updateJobOpening(row: Row) {
    const options = row['status'] === 'open' ? ['paused', 'closed'] : row['status'] === 'paused' ? ['open', 'closed'] : ['open', 'closed'];
    this.openHrmsEditor('opening-status', 'Update job opening', [this.choice('status', 'Status', options, true)], { status: options[0] }, row);
  }

  createApplication(row?: Row) {
    this.openHrmsEditor('application', 'Add candidate', [
      this.optionField('jobOpeningId', 'Job opening', this.arrayValue(this.hrms['jobOpenings']), 'id', 'title', true),
      this.field('firstName', 'First name', 'text', true), this.field('lastName', 'Last name'),
      this.field('email', 'Email'), this.field('phone', 'Phone'), this.field('source', 'Source'),
      this.field('resumeUrl', 'Resume URL'), this.field('notes', 'Notes', 'textarea'),
    ], { jobOpeningId: row?.['id'] || '' });
  }

  updateApplication(row: Row) {
    const next: Record<string, string[]> = { applied: ['screening', 'rejected', 'withdrawn'], screening: ['interview', 'rejected', 'withdrawn'], interview: ['offer', 'rejected'], offer: ['hired', 'rejected', 'withdrawn'] };
    this.openHrmsEditor('application-stage', 'Move candidate', [
      this.choice('stage', 'Stage', next[row['stage']] || [], true),
      this.optionField('linkedStaffId', 'Link employee when hired', this.arrayValue(this.hrms['orgChart']), 'staffId', 'staffName'),
      this.field('probationEndDate', 'Probation end date', 'date'),
    ], { stage: next[row['stage']]?.[0] || '', linkedStaffId: '', probationEndDate: '' }, row);
  }

  createLifecycleCase(caseType: 'onboarding' | 'offboarding') {
    const fields = [
      this.optionField('staffId', 'Employee', this.arrayValue(this.hrms['orgChart']), 'staffId', 'staffName'),
      this.field('effectiveDate', 'Effective date', 'date', true), this.field('checklist', 'Checklist, one task per line', 'textarea', true),
    ];
    if (caseType === 'onboarding') fields.splice(1, 0, this.optionField('applicationId', 'Hired candidate', this.arrayValue(this.hrms['applications']).filter((item) => item['stage'] === 'hired'), 'id', 'firstName'));
    this.openHrmsEditor('lifecycle-case', caseType === 'onboarding' ? 'Start onboarding' : 'Start offboarding', fields, { caseType, staffId: '', applicationId: '', effectiveDate: this.periodEnd, checklist: '' });
  }

  async updateLifecycleTask(row: Row, task: Row) {
    await this.action(`/staff/hrms/lifecycle-cases/${row['id']}/tasks/${task['id']}`, { completed: !task['completed'], version: row['version'] }, true, 'patch');
  }

  completeSettlement(row: Row) {
    this.openHrmsEditor('settlement', 'Complete final settlement', [this.field('reference', 'Settlement reference', 'text', true), this.field('payrollRunId', 'Paid payroll run ID')], {}, row);
  }

  updateEmployment(row: Row) {
    const current = String(row['employmentStatus'] || 'confirmed');
    const statuses = current === 'probation' ? ['confirmed', 'notice_period'] : ['notice_period'];
    this.openHrmsEditor('employment', 'Update employment lifecycle', [this.choice('status', 'Status', statuses, true), this.field('effectiveDate', 'Effective date', 'date', true)], { status: statuses[0], effectiveDate: this.periodEnd }, row);
  }

  createAppraisalCycle() {
    this.openHrmsEditor('appraisal-cycle', 'New appraisal cycle', [this.field('name', 'Cycle name', 'text', true), this.field('periodStart', 'Period start', 'date', true), this.field('periodEnd', 'Period end', 'date', true)], { periodStart: this.periodStart, periodEnd: this.periodEnd });
  }

  updateAppraisalCycle(row: Row) {
    const next: Record<string, string[]> = { draft: ['active'], active: ['review'], review: ['calibration'], calibration: ['closed'] };
    this.openHrmsEditor('appraisal-status', 'Advance appraisal cycle', [this.choice('status', 'Status', next[row['status']] || [], true)], { status: next[row['status']]?.[0] || '' }, row);
  }

  createGoalTemplate() {
    this.openHrmsEditor('goal-template', 'New OKR template', [this.field('name', 'Template name', 'text', true), this.field('description', 'Description', 'textarea'), this.field('keyResults', 'Key results: title | unit | target | weight bps, one per line', 'textarea', true)], {});
  }

  populateAppraisalCycle(row: Row) {
    this.openHrmsEditor('populate-cycle', 'Assign appraisal employees', [
      this.optionField('templateId', 'Goal template', this.arrayValue(this.hrms['goalTemplates']), 'id', 'name', true),
      this.optionField('staffIds', 'Employees', this.arrayValue(this.hrms['orgChart']).filter((item) => item['active']), 'staffId', 'staffName', true, true),
    ], { staffIds: [] }, row);
  }

  submitManagerAppraisal(row: Row) {
    this.openHrmsEditor('manager-review', 'Manager appraisal', [
      this.field('score', 'Manager score (0–100)', 'number', true), this.field('strengths', 'Strengths', 'textarea'),
      this.field('improvementAreas', 'Improvement areas', 'textarea'), this.field('goals', 'Goals', 'textarea'),
      this.field('comments', 'Comments', 'textarea'), this.field('incentiveAmount', 'Incentive amount INR', 'number'),
      this.field('incentiveEvidence', 'Incentive evidence, one item per line', 'textarea'),
    ], {}, row);
  }

  calibrateAppraisal(row: Row) {
    this.openHrmsEditor('calibration', 'Calibrate appraisal', [this.field('score', 'Calibrated score (0–100)', 'number', true), this.field('comments', 'Calibration comments', 'textarea', true)], { score: row['managerScore'] ?? '' }, row);
  }

  async approveAppraisal(row: Row) {
    if (!window.confirm(`Approve final rating for ${row['staffName']}?`)) return;
    await this.action(`/staff/hrms/appraisal-reviews/${row['id']}/approve`, { version: row['version'] }, true, 'patch');
  }

  createSuccessionPlan() {
    this.openHrmsEditor('succession-plan', 'New succession plan', [this.field('roleTitle', 'Critical role title', 'text', true), this.optionField('incumbentStaffId', 'Incumbent employee', this.arrayValue(this.hrms['orgChart']), 'staffId', 'staffName'), this.field('targetDate', 'Target date', 'date'), this.field('notes', 'Notes', 'textarea')], {});
  }

  addSuccessionCandidate(plan: Row) {
    this.openHrmsEditor('succession-candidate', 'Nominate succession candidate', [this.optionField('staffId', 'Employee', this.arrayValue(this.hrms['orgChart']).filter((item) => item['active']), 'staffId', 'staffName', true), this.field('evidence', 'Additional evidence, one item per line', 'textarea'), this.field('developmentActions', 'Development actions, one per line', 'textarea')], {}, plan);
  }

  closeSuccessionPlan(plan: Row) {
    this.openHrmsEditor('succession-close', 'Close succession plan', [this.field('closureNote', 'Closure note', 'textarea', true)], {}, plan);
  }

  updateSuccessionCandidate(row: Row) {
    this.openHrmsEditor('succession-update', 'Update succession candidate', [this.choice('status', 'Action', ['proposed', 'removed'], true), this.field('evidence', 'Additional evidence, one item per line', 'textarea'), this.field('developmentActions', 'Development actions, one per line', 'textarea')], { status: 'proposed', evidence: this.arrayValue(row['evidence']).join('\n'), developmentActions: this.arrayValue(row['developmentActions']).join('\n') }, row);
  }

  decideSuccessionCandidate(row: Row, decision: 'approved' | 'rejected') {
    this.openHrmsEditor('succession-decision', decision === 'approved' ? 'Approve promotion readiness' : 'Reject promotion readiness', [this.field('note', 'Decision note', 'textarea', true)], { decision }, row);
  }

  closeHrmsEditor() {
    this.hrmsEditorKind = '';
    this.hrmsEditorRow = null;
    this.hrmsEditorFields = [];
    this.hrmsDraft = {};
  }

  async saveHrmsEditor() {
    const missing = this.hrmsEditorFields.find((field) => field.required && (Array.isArray(this.hrmsDraft[field.key]) ? !this.hrmsDraft[field.key].length : !String(this.hrmsDraft[field.key] ?? '').trim()));
    if (missing) { this.error = `${missing.label} is required`; return; }
    const row = this.hrmsEditorRow || {};
    const draft = this.hrmsDraft;
    let result: Row | null = null;
    if (this.hrmsEditorKind === 'job-opening') result = await this.action('/staff/hrms/job-openings', { ...draft, openingsCount: Number(draft['openingsCount']) || 1 });
    else if (this.hrmsEditorKind === 'opening-status') result = await this.action(`/staff/hrms/job-openings/${row['id']}`, { status: draft['status'], version: row['version'] }, true, 'patch');
    else if (this.hrmsEditorKind === 'application') result = await this.action('/staff/hrms/applications', draft);
    else if (this.hrmsEditorKind === 'application-stage') {
      if (draft['stage'] === 'hired' && !draft['linkedStaffId']) { this.error = 'Link employee is required when hiring'; return; }
      result = await this.action(`/staff/hrms/applications/${row['id']}`, { stage: draft['stage'], linkedStaffId: draft['linkedStaffId'] || null, probationEndDate: draft['probationEndDate'] || null, version: row['version'] }, true, 'patch');
    } else if (this.hrmsEditorKind === 'lifecycle-case') {
      if (!draft['staffId'] && !draft['applicationId']) { this.error = 'Select an employee or hired candidate'; return; }
      result = await this.action('/staff/hrms/lifecycle-cases', { ...draft, checklist: this.lines(draft['checklist']) });
    } else if (this.hrmsEditorKind === 'settlement') result = await this.action(`/staff/hrms/lifecycle-cases/${row['id']}/settlement`, { reference: draft['reference'], payrollRunId: draft['payrollRunId'] || null, version: row['version'] }, true, 'patch');
    else if (this.hrmsEditorKind === 'employment') result = await this.action(`/staff/hrms/employees/${row['staffId']}/employment`, { ...draft, version: row['employmentVersion'] }, true, 'patch');
    else if (this.hrmsEditorKind === 'appraisal-cycle') result = await this.action('/staff/hrms/appraisal-cycles', draft);
    else if (this.hrmsEditorKind === 'appraisal-status') result = await this.action(`/staff/hrms/appraisal-cycles/${row['id']}`, { status: draft['status'], version: row['version'] }, true, 'patch');
    else if (this.hrmsEditorKind === 'goal-template') {
      const keyResults = this.lines(draft['keyResults']).map((line) => { const [title, metricUnit, targetValue, weightBasisPoints] = line.split('|').map((value) => value.trim()); return { title, metricUnit, targetValue: Number(targetValue), weightBasisPoints: Number(weightBasisPoints) }; });
      if (keyResults.some((item) => !item.title || !['count', 'percent', 'minutes', 'paise'].includes(item.metricUnit) || !Number.isInteger(item.targetValue) || !Number.isInteger(item.weightBasisPoints))) { this.error = 'Each key result must use: title | count/percent/minutes/paise | target | weight bps'; return; }
      result = await this.action('/staff/hrms/goal-templates', { name: draft['name'], description: draft['description'] || '', keyResults });
    } else if (this.hrmsEditorKind === 'populate-cycle') result = await this.action(`/staff/hrms/appraisal-cycles/${row['id']}/populate`, { templateId: draft['templateId'], staffIds: draft['staffIds'] });
    else if (this.hrmsEditorKind === 'manager-review') {
      const score = Number(draft['score']);
      if (!Number.isInteger(score) || score < 0 || score > 100) { this.error = 'Manager score must be an integer from 0 to 100'; return; }
      result = await this.action(`/staff/hrms/appraisal-reviews/${row['id']}/manager`, { score, strengths: draft['strengths'] || '', improvementAreas: draft['improvementAreas'] || '', goals: draft['goals'] || '', comments: draft['comments'] || '', coachingGoalId: null, incentiveAmountPaise: this.contentRupeesToPaise(String(draft['incentiveAmount'] || '')) || 0, incentiveEvidence: this.lines(draft['incentiveEvidence']), version: row['version'] }, true, 'patch');
    } else if (this.hrmsEditorKind === 'calibration') {
      const score = Number(draft['score']);
      if (!Number.isInteger(score) || score < 0 || score > 100) { this.error = 'Calibrated score must be an integer from 0 to 100'; return; }
      result = await this.action(`/staff/hrms/appraisal-reviews/${row['id']}/calibrate`, { score, comments: draft['comments'], version: row['version'] }, true, 'patch');
    } else if (this.hrmsEditorKind === 'succession-plan') result = await this.action('/staff/hrms/succession-plans', { ...draft, targetRoleId: null, criticalRole: true, incumbentStaffId: draft['incumbentStaffId'] || null, targetDate: draft['targetDate'] || null });
    else if (this.hrmsEditorKind === 'succession-candidate') result = await this.action(`/staff/hrms/succession-plans/${row['id']}/candidates`, { staffId: draft['staffId'], evidence: this.lines(draft['evidence']), developmentActions: this.lines(draft['developmentActions']) });
    else if (this.hrmsEditorKind === 'succession-close') result = await this.action(`/staff/hrms/succession-plans/${row['id']}`, { status: 'closed', closureNote: draft['closureNote'], version: row['version'] }, true, 'patch');
    else if (this.hrmsEditorKind === 'succession-update') result = await this.action(`/staff/hrms/succession-candidates/${row['id']}`, { status: draft['status'], evidence: this.lines(draft['evidence']), developmentActions: this.lines(draft['developmentActions']), version: row['version'] }, true, 'patch');
    else if (this.hrmsEditorKind === 'succession-decision') result = await this.action(`/staff/hrms/succession-candidates/${row['candidateId']}/decision`, { decision: draft['decision'], note: draft['note'], version: row['version'] });
    if (result) this.closeHrmsEditor();
  }

  private openHrmsEditor(kind: string, title: string, fields: HrmsField[], draft: Row, row: Row | null = null) {
    this.error = '';
    this.hrmsEditorKind = kind;
    this.hrmsEditorTitle = title;
    this.hrmsEditorFields = fields;
    this.hrmsEditorDraft(draft, row);
  }

  private hrmsEditorDraft(draft: Row, row: Row | null) {
    this.hrmsDraft = { ...draft };
    this.hrmsEditorRow = row;
  }

  private field(key: string, label: string, type: HrmsField['type'] = 'text', required = false): HrmsField { return { key, label, type, required }; }
  private choice(key: string, label: string, values: string[], required = false): HrmsField { return { key, label, type: 'select', required, options: values.map((value) => ({ value, label: this.label(value) })) }; }
  private optionField(key: string, label: string, rows: Row[], valueKey: string, labelKey: string, required = false, multiple = false): HrmsField { return { key, label, type: multiple ? 'multiselect' : 'select', required, options: rows.map((row) => ({ value: String(row[valueKey] || ''), label: String(row[labelKey] || row[valueKey] || '') })).filter((item) => item.value) }; }
  private lines(value: unknown) { return String(value || '').split(/\r?\n|,/).map((item) => item.trim()).filter(Boolean); }

  async runHrOperationsAutomations() {
    await this.action('/staff/hrms/operations-intelligence/automations/run', { from: this.periodStart, to: this.periodEnd });
  }

  exportEmployeeLifecycle() {
    const rows = this.arrayValue(this.hrms['lifecycleCases']).map((row) => [
      row['staffId'] || '', row['staffName'] || row['candidateName'] || '', row['caseType'] || '', row['effectiveDate'] || '',
      row['status'] || '', row['settlementStatus'] || '', this.arrayValue(row['tasks']).length,
      this.arrayValue(row['tasks']).filter((task) => task['completed']).length,
    ]);
    this.downloadCsv([
      ['staffId', 'staffName', 'caseType', 'effectiveDate', 'status', 'settlementStatus', 'taskCount', 'completedTaskCount'],
      ...rows,
    ], `employee-lifecycle-${this.periodStart}-${this.periodEnd}.csv`);
  }

  exportHrHealth() {
    const intelligence = this.hrms['operationsIntelligence'] || {};
    const branch = intelligence['benchmarks']?.['branch'] || {};
    const rows = this.arrayValue(intelligence['benchmarks']?.['staff']).map((row) => [
      row['staffId'] || '', row['employeeCode'] || '', row['staffName'] || '', row['jobTitle'] || '',
      row['attendancePercent'] ?? '', row['appraisalPercent'] ?? '', row['trainingPercent'] ?? '',
      row['operationsPercent'] ?? '', row['healthScore'] ?? '', row['coveragePercent'] ?? '',
    ]);
    this.downloadCsv([
      ['branchHealthScore', branch['healthScore'] ?? '', 'periodStart', this.periodStart, 'periodEnd', this.periodEnd],
      ['staffId', 'employeeCode', 'staffName', 'jobTitle', 'attendancePercent', 'appraisalPercent', 'trainingPercent', 'operationsPercent', 'healthScore', 'coveragePercent'],
      ...rows,
    ], `hr-health-${this.periodStart}-${this.periodEnd}.csv`);
  }

  openRuleEditor(row?: Row) {
    this.ruleDraft = row ? {
      documentKey: row['documentKey'], documentType: row['documentType'], category: row['category'],
      title: row['title'], content: row['content'], effectiveDate: this.periodEnd,
      expiresOn: '', mandatoryAcknowledgement: row['mandatoryAcknowledgement'] !== false,
      trainingAttachmentUrl: row['trainingAttachmentUrl'] || '', quizPassScore: row['quizPassScore'] || 80,
    } : this.emptyRuleDraft();
    this.ruleQuiz = row ? this.arrayValue(row['quiz']).map((question) => ({ ...question, options: [...(question['options'] || [])] })) : [];
    this.ruleEditorOpen = true;
  }

  closeRuleEditor() { this.ruleEditorOpen = false; this.ruleQuiz = []; }

  addRuleQuizQuestion() {
    const question = this.ask('Question');
    const options = (this.ask('Options, comma separated') || '').split(',').map((value) => value.trim()).filter(Boolean);
    const correct = Number(this.ask('Correct option number', '1')) - 1;
    if (!question || options.length < 2 || !Number.isInteger(correct) || correct < 0 || correct >= options.length) return;
    this.ruleQuiz.push({ id: crypto.randomUUID(), question, options, correctIndex: correct });
  }

  removeRuleQuizQuestion(index: number) { this.ruleQuiz.splice(index, 1); }

  async saveRuleDocument() {
    if (!String(this.ruleDraft['title'] || '').trim() || !String(this.ruleDraft['content'] || '').trim() || !this.ruleDraft['effectiveDate']) {
      this.error = 'Title, content and effective date are required'; return;
    }
    const saved = await this.action('/staff/rules', {
      documentKey: this.ruleDraft['documentKey'] || undefined,
      documentType: this.ruleDraft['documentType'], category: this.ruleDraft['category'],
      title: String(this.ruleDraft['title']).trim(), content: String(this.ruleDraft['content']).trim(),
      effectiveDate: this.ruleDraft['effectiveDate'], expiresOn: this.ruleDraft['expiresOn'] || undefined,
      mandatoryAcknowledgement: this.ruleDraft['mandatoryAcknowledgement'] !== false,
      trainingAttachmentUrl: String(this.ruleDraft['trainingAttachmentUrl'] || '').trim(),
      quiz: this.ruleQuiz, quizPassScore: this.ruleQuiz.length ? Number(this.ruleDraft['quizPassScore'] || 80) : 0,
    });
    if (saved) this.closeRuleEditor();
  }

  async publishRule(row: Row) { await this.action(`/staff/rules/${row['id']}/publish`, { version: row['version'] }); }
  async unpublishRule(row: Row) { await this.action(`/staff/rules/${row['id']}/unpublish`, { version: row['version'] }); }

  async createSurvey() {
    const title = prompt('Survey title')?.trim(); if (!title) return;
    const question = prompt('Survey question')?.trim(); if (!question) return;
    const kind = (prompt('Question type: rating, text, or single_choice', 'rating') || '').trim();
    if (!['rating', 'text', 'single_choice'].includes(kind)) { this.error = 'Survey question type is invalid.'; return; }
    const options = kind === 'single_choice' ? (prompt('Choices separated by commas') || '').split(',').map((value) => value.trim()).filter(Boolean) : undefined;
    if (kind === 'single_choice' && (!options || options.length < 2)) { this.error = 'A choice survey needs at least two choices.'; return; }
    await this.action('/staff/surveys', { title, questions: [{ id: crypto.randomUUID(), prompt: question, type: kind, options }] });
  }

  async updateSurveyStatus(row: Row, status: 'published' | 'closed') {
    await this.action(`/staff/surveys/${row['id']}/status`, { status, version: row['version'] }, true, 'patch');
  }

  async recordRuleViolation(row: Row) {
    const staffId = this.ask('Staff ID');
    const details = this.ask('Violation details');
    if (!staffId || !details) return;
    await this.action('/staff/rules/violations', { documentId: row['id'], staffId, details });
  }

  async resolveRuleViolation(row: Row) {
    const resolutionNote = this.ask('Resolution note');
    if (!resolutionNote) return;
    await this.action(`/staff/rules/violations/${row['id']}/resolve`, { version: row['version'], resolutionNote });
  }

  async createContentOffer() {
    const code = this.ask('Offer code');
    const benefitType = this.askChoice('Benefit type', [
      'percentage_discount',
      'fixed_discount',
      'complimentary_add_on',
      'loyalty_points',
      'wallet_credit',
      'gift_card',
      'package_upgrade',
      'priority_appointment',
      'off_peak_deal',
      'last_minute_slot',
    ]);
    if (!code || !benefitType) return;
    const needsValue = !['priority_appointment', 'package_upgrade'].includes(benefitType);
    const benefitValueInput = needsValue ? this.ask('Benefit value') : this.askOptional('Benefit value');
    const benefitValue = benefitValueInput ? Number(benefitValueInput) : undefined;
    if (needsValue && (!Number.isFinite(benefitValue as number) || Number(benefitValue) <= 0)) return;
    const complimentaryServiceId = benefitType === 'complimentary_add_on' ? this.ask('Complimentary service ID') : this.askOptional('Complimentary service ID');
    if (benefitType === 'complimentary_add_on' && !complimentaryServiceId) return;
    const targetServiceIds = this.askOptional('Target service IDs comma separated') || '';
    await this.action('/marketing/offers', {
      code: code.trim().toUpperCase(),
      benefitType,
      benefitValue: benefitValue ? Number(benefitValue) : undefined,
      targetClientId: this.askOptional('Client ID') || undefined,
      complimentaryServiceId: complimentaryServiceId || undefined,
      targetServiceIds: targetServiceIds.split(',').map((item) => item.trim()).filter(Boolean),
      startsAt: this.contentOfferDate(this.askOptional('Start date YYYY-MM-DD')),
      endsAt: this.contentOfferDate(this.askOptional('Expiry date YYYY-MM-DD'), true),
      minimumBillPaise: this.contentRupeesToPaise(this.askOptional('Minimum bill INR')),
      usageLimit: this.contentInteger(this.askOptional('Usage limit')),
      perClientLimit: this.contentInteger(this.askOptional('Per-client limit')) || 1,
      allowMembershipStacking: this.askChoice('Allow membership stacking', ['false', 'true']) === 'true',
      allowPackageStacking: this.askChoice('Allow package stacking', ['false', 'true']) === 'true',
    });
  }

  async createCoachingGoal() {
    const staffId = this.ask('Staff ID');
    const goalType = this.ask('Goal type');
    const metricUnit = this.ask('Metric unit');
    const targetValue = this.contentInteger(this.ask('Target value'));
    const dueDate = this.toIsoDate(this.ask('Due date YYYY-MM-DD') || '');
    const actionTitle = this.ask('Action title');
    if (!staffId || !goalType || !metricUnit || !targetValue || !dueDate || !actionTitle) return;
    await this.action('/staff/coach/goals', {
      staffId,
      goalType,
      metricUnit,
      targetValue,
      currentValue: this.contentInteger(this.askOptional('Current value')) || 0,
      dueDate,
      actionTitle,
      actionDescription: this.askOptional('Action description') || undefined,
      priority: this.askChoice('Priority', ['medium', 'low', 'high', 'urgent']) || 'medium',
    });
  }

  async createPenaltyRule() {
    let kind = this.askChoice('Rule kind', ['fine', 'allowance', 'deduction']) || 'deduction';
    const triggerType = this.askChoice('Trigger type', [
      'manual',
      'late_count',
      'absent_day',
      'half_day',
      'short_hours',
      'no_clock_out',
      'weekend_penalty',
      'sandwich_penalty',
      'unpaid_week_off',
      'fixed',
      'weekly_off_worked',
    ]) || 'manual';
    if (triggerType === 'weekly_off_worked') kind = 'allowance';
    if (['weekend_penalty', 'sandwich_penalty', 'unpaid_week_off'].includes(triggerType) && kind === 'allowance') kind = 'deduction';
    const amount = this.ask('Amount INR');
    const name = this.ask('Rule name');
    if (!amount || !name) return;
    await this.action('/staff/payroll-adjustment-rules', {
      kind,
      name,
      amountPaise: this.contentRupeesToPaise(amount),
      triggerType,
      triggerCount: this.contentInteger(this.askOptional('Trigger count')) || 1,
      applicationMode: this.askChoice('Application mode', ['fixed', 'per_occurrence']) || 'per_occurrence',
      autoApply: this.askChoice('Auto apply', ['false', 'true']) === 'true',
      notes: this.askOptional('Notes') || undefined,
      active: this.askChoice('Active', ['true', 'false']) !== 'false',
    });
  }

  async approveNotification(row: Row) {
    await this.action(`/staff/notifications/${row['id']}/approve`, { version: row['version'] || 1 });
  }

  async retryNotification(row: Row) {
    await this.action(`/staff/notifications/${row['id']}/retry`, { version: row['version'] || 1 });
  }

  async recordNotificationDelivery(row: Row, status: 'sent' | 'failed') {
    const provider = this.ask('Provider', row['channel'] === 'whatsapp' ? 'whatsapp_cloud' : row['channel']);
    if (!provider) return;
    await this.action(`/staff/notifications/${row['id']}/delivery-result`, {
      version: row['version'] || 1,
      provider,
      providerMessageId: status === 'sent' ? this.ask('Provider message ID') : this.askOptional('Provider message ID'),
      status,
      errorMessage: status === 'failed' ? this.askOptional('Error') : '',
      payload: {},
    });
  }

  async selectTab(tab: WorkspaceTab) {
    if (tab === this.activeTab || this.loading) return;
    this.activeTab = tab;
    await this.router.navigate([], { relativeTo: this.route, queryParams: { tab }, queryParamsHandling: 'merge', replaceUrl: true });
    await this.refresh();
  }
  backToStaff() { void this.router.navigate(['/staff']); }
  openPayroll() { void this.router.navigate(['/staff/payroll']); }
  openAttendance() { void this.router.navigate(['/staff/attendance-summary']); }
  openLeave() { void this.router.navigate(['/staff/leave-management']); }
  openRecommendation(row: Row) { if (String(row['route'] || '').startsWith('/')) void this.router.navigateByUrl(row['route']); }
  async requestEquipmentApproval(row: Row) {
    if (!row['approvalRequired']) return this.openRecommendation(row);
    if (['pending', 'approved'].includes(String(row['approvalStatus'] || '').toLowerCase())) return;
    if (this.askChoice(`Submit ${this.label(row['actionType'])} approval?`, ['yes', 'no']) !== 'yes') return;
    await this.action('/staff/approvals', {
      requestType: `equipment_${row['actionType']}`,
      entityType: 'equipment_recommendation',
      entityId: row['key'],
      amountPaise: 0,
      payload: { title: row['title'], department: row['department'], equipmentKind: row['equipmentKind'], evidence: row['evidence'] },
    });
  }
  recommendationEvidence(row: Row) { return this.objectEntries(row['evidence']).map((item) => `${item.key}: ${this.text(item.value)}`).join(' · '); }

  objectEntries(value: unknown): Array<{ key: string; value: unknown }> {
    if (!value || Array.isArray(value) || typeof value !== 'object') return [];
    return Object.entries(value as Row).map(([key, item]) => ({ key: this.label(key), value: item }));
  }

  arrayValue(value: unknown): Row[] { return Array.isArray(value) ? value : []; }
  publishedRuleCount() { return this.arrayValue(this.rulesCenter['documents']).filter((row) => row['status'] === 'published').length; }
  outstandingRuleCount() { return this.arrayValue(this.rulesCenter['documents']).reduce((total, row) => total + (row['status'] === 'published' ? Number(row['outstandingCount'] || 0) : 0), 0); }
  openRuleViolationCount() { return this.arrayValue(this.rulesCenter['violations']).filter((row) => row['status'] === 'open').length; }
  correctAnswerNumber(question: Row) { return Number(question['correctIndex'] || 0) + 1; }
  staffAiSections(): Row[] {
    if (!this.staffAi) return [];
    return [
      ['Attendance anomalies', 'attendanceAnomalies'],
      ['Buddy punching signals', 'buddyPunchingSignals'],
      ['Attrition risk', 'attritionRisk'],
      ['Commission anomalies', 'commissionAnomalies'],
      ['Roster recommendations', 'rosterRecommendations'],
    ].map(([label, key]) => ({ key, label, result: this.staffAi?.[key] || {} }));
  }
  text(value: unknown) { return value === null || value === undefined || value === '' ? '—' : String(value); }
  healthLabel(value: Row | null | undefined) {
    const score = value?.['hrHealthScore'] ?? value?.['healthScore'];
    return typeof score === 'number' ? `${score}%` : 'Insufficient evidence';
  }
  label(value: string) { return value.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase()); }
  money(value: unknown) {
    const amount = Number(value ?? 0);
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(amount / 100);
  }
  formatDate(value: unknown) {
    const date = String(value || '').slice(0, 10).split('-');
    return date.length === 3 ? `${date[2]}/${date[1]}/${date[0]}` : '—';
  }
  formatDateTime(value: unknown) {
    if (!value) return '—';
    const date = new Date(String(value));
    return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString('en-IN');
  }
  statusClass(value: unknown) { return ['approved', 'verified', 'processed', 'online', 'completed', 'closed', 'sent', 'granted'].includes(String(value).toLowerCase()) ? 'good' : ['rejected', 'expired', 'offline', 'conflict', 'failed', 'withdrawn', 'deletion_requested'].includes(String(value).toLowerCase()) ? 'bad' : ''; }
  staffName(row: Row) { return row['staffName'] || row['fromStaffName'] || row['displayName'] || row['staffId'] || '—'; }
  trackById(_: number, row: Row) { return row['id'] || row['staffId'] || row['key']; }

  private async action<T = Row>(path: string, payload: unknown, reload = true, method: 'post' | 'put' | 'patch' = 'post'): Promise<T | null> {
    this.loading = true;
    this.error = '';
    try {
      const response = method === 'put'
        ? await firstValueFrom(this.api.put<ApiEnvelope<T>>(path, payload))
        : method === 'patch'
          ? await firstValueFrom(this.api.patch<ApiEnvelope<T>>(path, payload))
          : await firstValueFrom(this.api.post<ApiEnvelope<T>>(path, payload));
      const data = this.unwrap(response, 'Action failed');
      if (reload) await this.refresh();
      else this.loading = false;
      return data;
    } catch (error) {
      this.error = this.message(error, this.language.text('staff.message.57af949595'));
      this.loading = false;
      return null;
    }
  }

  private async actionWithHeaders<T = Row>(path: string, payload: unknown, headers: Record<string, string>, reload = true): Promise<T | null> {
    this.loading = true;
    this.error = '';
    try {
      const response = await firstValueFrom(this.api.postWithHeaders<ApiEnvelope<T>>(path, payload, headers));
      const data = this.unwrap(response, 'Action failed');
      if (reload) await this.refresh();
      else this.loading = false;
      return data;
    } catch (error) {
      this.error = this.message(error, this.language.text('staff.message.57af949595'));
      this.loading = false;
      return null;
    }
  }

  private async loadList(path: string, assign: (value: Row[]) => void) {
    const response = await firstValueFrom(this.api.get<ApiEnvelope<Row[]>>(path));
    assign(this.unwrap(response, 'Unable to load staff data'));
  }

  private async loadOne(path: string, assign: (value: Row) => void) {
    const response = await firstValueFrom(this.api.get<ApiEnvelope<Row>>(path));
    assign(this.unwrap(response, 'Unable to load staff data'));
  }

  private unwrap<T>(response: ApiEnvelope<T>, fallback: string): T {
    if (!response.success || response.data === undefined) throw new Error(response.error?.message || fallback);
    return response.data;
  }

  private periodQuery() {
    return new URLSearchParams({ periodStart: this.periodStart, periodEnd: this.periodEnd }).toString();
  }

  private toIsoDate(value: string) {
    const match = String(value || '').trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
    return match ? `${match[1]}-${match[2]}-${match[3]}` : '';
  }

  private contentOfferDate(value: string, end = false) {
    const iso = this.toIsoDate(value);
    return iso ? new Date(`${iso}T${end ? '23:59:59' : '00:00:00'}+05:30`).toISOString() : undefined;
  }

  private contentRupeesToPaise(value: string | null) {
    if (!value) return undefined;
    const amount = Number(value);
    return Number.isFinite(amount) ? Math.round(amount * 100) : undefined;
  }

  private contentInteger(value: string | null) {
    if (!value) return undefined;
    const amount = Number(value);
    return Number.isInteger(amount) && amount > 0 ? amount : undefined;
  }
  private csv(value: string | null) { return String(value || '').split(',').map((item) => item.trim()).filter(Boolean); }

  private emptyRuleDraft(): Row {
    return { documentKey: '', documentType: 'sop', category: 'service', title: '', content: '', effectiveDate: this.periodEnd, expiresOn: '', mandatoryAcknowledgement: true, trainingAttachmentUrl: '', quizPassScore: 80 };
  }

  private isoDate(value: Date) { return value.toISOString().slice(0, 10); }
  private ask(label: string, initial = '') { const value = window.prompt(label, String(initial || ''))?.trim(); return value || null; }
  private askOptional(label: string, initial = '') { return window.prompt(label, initial)?.trim() || ''; }
  private askChoice(label: string, values: string[]) {
    const value = window.prompt(`${label}: ${values.join(' / ')}`, values[0])?.trim().toLowerCase();
    return value && values.includes(value) ? value : null;
  }
  private downloadJson(value: unknown, filename: string) {
    const blob = new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    link.click();
    URL.revokeObjectURL(link.href);
  }
  private downloadCsv(rows: unknown[][], filename: string) {
    const csv = rows.map((row) => row.map((value) => `"${String(value ?? '').replaceAll('"', '""')}"`).join(',')).join('\r\n');
    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    link.download = filename;
    link.click();
    URL.revokeObjectURL(link.href);
  }
  private message(error: unknown, fallback: string) {
    const candidate = error as { error?: { error?: { message?: string }; message?: string }; message?: string };
    return candidate?.error?.error?.message || candidate?.error?.message || candidate?.message || fallback;
  }
}
