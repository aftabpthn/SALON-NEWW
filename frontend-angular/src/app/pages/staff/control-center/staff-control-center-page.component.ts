import { LanguageService } from '../../../core/i18n/language.service';
import { CommonModule } from '@angular/common';
import { TranslatePipe } from '../../../shared/pipes/translate.pipe';
import { Component, OnInit, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { DatePickerComponent } from '../../../shared/date-picker/date-picker.component';
import { ApiEnvelope, ApiService } from '../../../shared/services/api.service';

type WorkspaceTab = 'command' | 'workforce' | 'development' | 'systems' | 'governance';
type Row = Record<string, any>;

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

  readonly tabs: Array<{ key: WorkspaceTab; label: string; icon: string }> = [
    { key: 'command', label: 'Command center', icon: 'bi-speedometer2' },
    { key: 'workforce', label: 'Workforce', icon: 'bi-calendar2-week' },
    { key: 'development', label: 'Development', icon: 'bi-mortarboard' },
    { key: 'systems', label: 'Systems', icon: 'bi-fingerprint' },
    { key: 'governance', label: 'Governance', icon: 'bi-shield-check' },
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
  devices: Row[] = [];
  gateways: Row[] = [];
  mappings: Row[] = [];
  consents: Row[] = [];
  biometricExceptions: Row[] = [];
  mobileConflicts: Row[] = [];
  approvals: Row[] = [];
  auditRows: Row[] = [];
  notifications: Row[] = [];
  notificationLogs: Row[] = [];
  tips: Row[] = [];
  compliance: Row | null = null;
  selfService: Row | null = null;
  rosterDraft: Row | null = null;

  async ngOnInit() {
    await this.refresh();
  }

  async refresh() {
    this.loading = true;
    this.error = '';
    const results = await Promise.allSettled(this.tabRequests(this.activeTab));
    const failures = results.filter((result) => result.status === 'rejected');
    if (failures.length) this.error = `${failures.length} section${failures.length === 1 ? '' : 's'} could not be loaded`;
    this.lastLoaded = new Date().toISOString();
    this.loading = false;
  }

  private tabRequests(tab: WorkspaceTab): Array<Promise<void>> {
    const period = this.periodQuery();
    const today = this.periodEnd;
    if (tab === 'command') return [
      this.loadOne(`/staff-enterprise/command-center?${period}`, (value) => this.command = value),
      this.loadList(`/staff-enterprise/floor-control?date=${today}`, (value) => this.floor = value),
    ];
    if (tab === 'workforce') return [
      this.loadList('/staff/shift-swaps', (value) => this.swaps = value),
      this.loadList('/staff/branch-transfers', (value) => this.transfers = value),
      this.loadOne(`/staff/roster/coverage?${period}`, (value) => this.coverage = value),
      this.loadOne(`/staff/manpower/forecast?${period}`, (value) => this.manpower = value),
    ];
    if (tab === 'development') return [
      this.loadList('/staff-enterprise/skill-matrix', (value) => this.skillMatrix = value),
      this.loadList('/staff/skill-licenses', (value) => this.licenses = value),
      this.loadList('/staff/performance-reviews', (value) => this.reviews = value),
      this.loadList('/staff/coach/goals', (value) => this.coachingGoals = value),
      this.loadList('/staff-enterprise/training', (value) => this.training = value),
    ];
    if (tab === 'systems') return [
      this.loadList('/staff/biometric/devices', (value) => this.devices = value),
      this.loadList('/staff/biometric/gateways', (value) => this.gateways = value),
      this.loadList('/staff/biometric/mappings', (value) => this.mappings = value),
      this.loadList('/staff/biometric/consents', (value) => this.consents = value),
      this.loadList('/staff/biometric/exceptions', (value) => this.biometricExceptions = value),
      this.loadList('/staff/mobile/conflicts?status=open', (value) => this.mobileConflicts = value),
      this.loadOne(`/staff/self/dashboard?date=${today}`, (value) => this.selfService = value).catch((error) => {
        if ((error as { status?: number }).status === 404) this.selfService = null;
        else throw error;
      }),
    ];
    return [
      this.loadList('/staff/approvals?status=pending', (value) => this.approvals = value),
      this.loadList('/staff/audit?eventPrefix=staff.', (value) => this.auditRows = value),
      this.loadList('/staff/notifications', (value) => this.notifications = value),
      this.loadList('/staff/notification-delivery-logs', (value) => this.notificationLogs = value),
      this.loadList(`/staff/tips/summary?${period}`, (value) => this.tips = value),
      this.loadOne(`/staff/payroll-compliance/summary?${period}`, (value) => this.compliance = value),
    ];
  }

  async decideSwap(row: Row, decision: 'approved' | 'rejected') {
    await this.action(`/staff/shift-swaps/${row['id']}/decision`, { decision, version: row['version'], note: '' });
  }

  async decideTransfer(row: Row, decision: 'approved' | 'rejected') {
    await this.action(`/staff/branch-transfers/${row['id']}/decision`, { decision, version: row['version'], note: '' });
  }

  async decideApproval(row: Row, decision: 'approved' | 'rejected') {
    await this.action(`/staff/approvals/${row['id']}/decision`, { decision, version: row['version'], notes: '' });
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
    const notificationType = this.askChoice('Notification type', ['training', 'compliance', 'payroll', 'leave', 'schedule', 'approval']);
    const title = this.ask('Title');
    const bodyTemplate = this.ask('Body template');
    if (!notificationType || !title || !bodyTemplate) return;
    await this.action('/staff/notification-templates', { notificationType, title, bodyTemplate, languageCode: 'en', sensitive: ['payroll', 'compliance'].includes(notificationType) });
  }

  async savePreference() {
    const staffId = this.ask('Staff ID');
    if (!staffId) return;
    await this.action(`/staff/${staffId}/notification-preferences`, {
      whatsappOptIn: this.askChoice('WhatsApp opt-in', ['true', 'false']) !== 'false',
      allowPayrollAmounts: this.askChoice('Allow payroll amounts', ['false', 'true']) === 'true',
      languageCode: this.askOptional('Language code') || 'en',
    }, true, 'put');
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
    await this.refresh();
  }
  backToStaff() { void this.router.navigate(['/staff']); }
  openPayroll() { void this.router.navigate(['/staff/payroll']); }
  openAttendance() { void this.router.navigate(['/staff/attendance-summary']); }
  openLeave() { void this.router.navigate(['/staff/leave-management']); }

  objectEntries(value: unknown): Array<{ key: string; value: unknown }> {
    if (!value || Array.isArray(value) || typeof value !== 'object') return [];
    return Object.entries(value as Row).map(([key, item]) => ({ key: this.label(key), value: item }));
  }

  arrayValue(value: unknown): Row[] { return Array.isArray(value) ? value : []; }
  text(value: unknown) { return value === null || value === undefined || value === '' ? '—' : String(value); }
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

  private isoDate(value: Date) { return value.toISOString().slice(0, 10); }
  private ask(label: string, initial = '') { const value = window.prompt(label, String(initial || ''))?.trim(); return value || null; }
  private askOptional(label: string) { return window.prompt(label, '')?.trim() || ''; }
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
  private message(error: unknown, fallback: string) {
    const candidate = error as { error?: { error?: { message?: string }; message?: string }; message?: string };
    return candidate?.error?.error?.message || candidate?.error?.message || candidate?.message || fallback;
  }
}
