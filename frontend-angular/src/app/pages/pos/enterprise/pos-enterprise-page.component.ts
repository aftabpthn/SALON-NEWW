import { CommonModule } from '@angular/common';
import { Component, OnDestroy, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { Observable, Subscription } from 'rxjs';
import { PosRealtimeService } from '../../../core/services/pos-realtime.service';
import { ApiService } from '../../../shared/services/api.service';

interface Terminal { id: string; terminalCode: string; terminalName: string; assignedCounter: string; status: string; lastSeenAt: string | null; activeSessionId: string | null; }
interface TerminalSalesSummary { terminalId: string; from: string; to: string; invoiceCount: number; totalPaise: number; paidPaise: number; }
interface PrintDevice { id: string; terminalId: string; deviceName: string; deviceType: string; connectionType: string; status: string; }
interface PrintJob { id: string; terminalId: string; deviceId: string | null; saleId: string; invoiceNumber: string; format: string; status: string; attempts: number; lastError: string; }
interface RiskCase { id: string; businessDate: string; riskCode: string; severity: string; riskScore: number; entityType: string; evidenceJson: any; amountAtRiskPaise: number; status: string; }
interface CorporateAccount { id: string; accountCode: string; accountName: string; billingEmail: string; phone: string; gstin: string; creditLimitPaise: number; outstandingPaise: number; paymentTermsDays: number; status: string; }
interface CorporateMember { id: string; clientId: string; clientName: string; clientPhone: string; employeeCode: string; department: string; spendingLimitPaise: number; status: string; }
interface CorporateStatement { id: string; saleId: string; invoiceNumber: string; dueDate: string; originalAmountPaise: number; paidPaise: number; outstandingPaise: number; status: string; }
interface Provider { provider: string; enabled: boolean; webhookConfigured: boolean; environment: string; }
interface NotificationProfile { senderEmail: string; senderPhone: string; logoUrl: string; signatureUrl: string; emailVerified: boolean; phoneVerified: boolean; ownerEmail: string; ownerPhone: string; reportingEmail: string; ownerEmailVerified: boolean; ownerPhoneVerified: boolean; reportingEmailVerified: boolean; clientEmailEnabled: boolean; clientWhatsappEnabled: boolean; ownerEmailEnabled: boolean; ownerWhatsappEnabled: boolean; dailyReportEnabled: boolean; dailyReportTime: string; dailyReportTimezone: string; }

@Component({
    selector: 'app-pos-enterprise-page',
    imports: [CommonModule, FormsModule, RouterLink],
    templateUrl: './pos-enterprise-page.component.html',
    styleUrls: ['./pos-enterprise-page.component.css']
})
export class PosEnterprisePageComponent implements OnInit, OnDestroy {
  tab: 'eod' | 'terminals' | 'print' | 'risk' | 'corporate' | 'reliability' | 'notifications' = 'eod';
  businessDate = this.displayDate(new Date());
  terminals: Terminal[] = [];
  terminalSales: TerminalSalesSummary | null = null;
  devices: PrintDevice[] = [];
  jobs: PrintJob[] = [];
  risks: RiskCase[] = [];
  accounts: CorporateAccount[] = [];
  corporateMembers: CorporateMember[] = [];
  corporateStatement: CorporateStatement[] = [];
  corporateOutstanding: any = null;
  fraudSummary: any = null;
  accountingPreview: any = null;
  taxRegister: any = null;
  reliability: any = null;
  notificationQueue: any[] = [];
  providers: Provider[] = [];
  dayClose: any = null;
  float: any = null;
  drawer: any = null;
  notification: NotificationProfile = { senderEmail: '', senderPhone: '', logoUrl: '', signatureUrl: '', emailVerified: false, phoneVerified: false, ownerEmail: '', ownerPhone: '', reportingEmail: '', ownerEmailVerified: false, ownerPhoneVerified: false, reportingEmailVerified: false, clientEmailEnabled: true, clientWhatsappEnabled: true, ownerEmailEnabled: false, ownerWhatsappEnabled: false, dailyReportEnabled: false, dailyReportTime: '21:00', dailyReportTimezone: 'Asia/Kolkata' };
  terminalCode = ''; terminalName = ''; terminalCounter = '';
  deviceTerminalId = ''; deviceName = ''; deviceType = 'thermal'; connectionType = 'browser';
  jobTerminalId = ''; jobDeviceId = ''; jobSaleId = ''; jobFormat = 'thermal';
  dayReason = ''; reopenReason = '';
  riskNotes: Record<string, string> = {};
  accountCode = ''; accountName = ''; accountEmail = ''; accountPhone = ''; accountGstin = ''; accountCredit = ''; accountTerms = '';
  corporateSaleId = ''; corporateAccountId = ''; corporateReference = '';
  memberClientId = ''; memberEmployeeCode = ''; memberDepartment = ''; memberLimit = '';
  corporatePayment = ''; corporatePaymentMethod = 'bank_transfer'; corporatePaymentReference = '';
  verificationKind: 'sender_email' | 'sender_phone' | 'owner_email' | 'owner_phone' | 'reporting_email' = 'sender_email';
  verificationId = ''; verificationOtp = '';
  approvalRecipient = ''; approvalChannel = 'whatsapp'; approvalPath = '';
  loading = false; busy = false; message = ''; error = '';
  private liveUpdates?: Subscription;

  constructor(private readonly api: ApiService, private readonly realtime: PosRealtimeService) {}

  ngOnInit(): void {
    this.load();
    this.liveUpdates = this.realtime.events().subscribe((event) => {
      if (event.entityType === 'terminal') this.reloadTerminals();
      if (event.entityType === 'invoice' && this.terminalSales?.terminalId) this.loadTerminalSales(this.terminalSales.terminalId);
      if (event.entityType === 'print_job') this.reloadPrintJobs();
      if (event.entityType === 'invoice' || event.entityType === 'print_job') this.reloadReliability();
    });
  }
  ngOnDestroy(): void { this.liveUpdates?.unsubscribe(); }

  load(): void {
    this.loading = true; this.error = ''; this.message = '';
    let pending = 14;
    const done = () => { pending -= 1; if (!pending) this.loading = false; };
    this.read<Terminal[]>('/api/v1/pos/terminals', (rows) => this.terminals = rows, done);
    this.read<PrintDevice[]>('/api/v1/pos/print-devices', (rows) => this.devices = rows, done);
    this.read<PrintJob[]>('/api/v1/pos/print-jobs', (rows) => this.jobs = rows, done);
    this.read<RiskCase[]>('/api/v1/pos/risk-cases?status=open', (rows) => this.risks = rows, done);
    this.read<CorporateAccount[]>('/api/v1/pos/corporate-accounts', (rows) => this.accounts = rows, done);
    this.read<Provider[]>('/api/v1/pos/payment-providers', (rows) => this.providers = rows, done);
    this.read<any>(`/api/v1/pos/day-close/${this.isoDate()}`, (row) => this.dayClose = row, done);
    this.read<any>('/api/v1/pos/float-suggestion', (row) => this.float = row, done);
    this.read<any>(`/api/v1/pos/fraud-summary?from=${this.isoDate()}&to=${this.isoDate()}`, (row) => this.fraudSummary = row, done);
    this.read<any>('/api/v1/pos/corporate-outstanding', (row) => this.corporateOutstanding = row, done);
    this.read<any>(`/api/v1/pos/day-close/${this.isoDate()}/accounting-preview`, (row) => this.accountingPreview = row, done);
    this.read<any>(`/api/v1/pos/day-close/${this.isoDate()}/tax-register`, (row) => this.taxRegister = row, done);
    this.read<any>('/api/v1/pos/reliability', (row) => this.reliability = row, done);
    this.api.get<any>(`/api/v1/pos/cash-drawer/current?businessDate=${this.isoDate()}`).subscribe({
      next: (response) => { this.drawer = response?.data ?? null; done(); },
      error: () => { this.drawer = null; done(); },
    });
    this.api.get<any>('/api/v1/invoice-notifications/profile').subscribe({ next: (response) => { const row = response?.data ?? response; if (row) this.notification = row; }, error: () => {} });
    this.api.get<any>('/api/v1/invoice-notifications/queue').subscribe({ next: (response) => { const row = response?.data ?? response; this.notificationQueue = Array.isArray(row) ? row : []; }, error: () => this.notificationQueue = [] });
  }

  createTerminal(): void {
    if (!this.terminalName.trim()) return this.fail('Terminal name is required');
    this.run(this.api.post('/api/v1/pos/terminals', { terminalCode: '', terminalName: this.terminalName.trim(), assignedCounter: this.terminalCounter.trim() }), 'Terminal registered', () => { this.terminalCode = ''; this.terminalName = ''; this.terminalCounter = ''; });
  }
  terminalAction(row: Terminal, action: 'session' | 'heartbeat' | 'status'): void {
    let request: Observable<any>;
    if (action === 'session') request = this.api.post(`/api/v1/pos/terminals/${row.id}/sessions/${row.activeSessionId ? 'end' : 'start'}`, {});
    else if (action === 'heartbeat') request = this.api.post(`/api/v1/pos/terminals/${row.id}/heartbeat`, {});
    else request = this.api.patch(`/api/v1/pos/terminals/${row.id}/status`, { status: row.status === 'active' ? 'suspended' : 'active' });
    this.run(request, action === 'heartbeat' ? 'Heartbeat recorded' : 'Terminal updated');
  }
  loadTerminalSales(terminalId: string): void {
    this.read<TerminalSalesSummary>(`/api/v1/pos/terminals/${terminalId}/sales?from=${this.isoDate()}&to=${this.isoDate()}`, (row) => this.terminalSales = row, () => {});
  }
  createDevice(): void {
    if (!this.deviceTerminalId || !this.deviceName.trim()) return this.fail('Terminal and device name are required');
    this.run(this.api.post('/api/v1/pos/print-devices', { terminalId: this.deviceTerminalId, deviceName: this.deviceName.trim(), deviceType: this.deviceType, connectionType: this.connectionType, config: {} }), 'Print device registered', () => this.deviceName = '');
  }
  createJob(): void {
    if (!this.jobTerminalId || !this.jobSaleId.trim()) return this.fail('Terminal and invoice ID are required');
    this.run(this.api.post('/api/v1/pos/print-jobs', { terminalId: this.jobTerminalId, deviceId: this.jobDeviceId || null, saleId: this.jobSaleId.trim(), format: this.jobFormat }), 'Print job queued', () => this.jobSaleId = '');
  }
  retryJob(row: PrintJob): void { this.run(this.api.post(`/api/v1/pos/print-jobs/${row.id}/retry`, {}), 'Print job queued again'); }

  lockDay(): void { if (!this.dayReason.trim()) return this.fail('Lock reason is required'); this.run(this.api.post(`/api/v1/pos/day-close/${this.isoDate()}/lock`, { reason: this.dayReason.trim() }), 'Business day locked', () => this.dayReason = ''); }
  reopenDay(): void { if (!this.reopenReason.trim()) return this.fail('Reopen reason is required'); this.run(this.api.post(`/api/v1/pos/day-close/${this.isoDate()}/reopen`, { reason: this.reopenReason.trim() }), 'Business day reopened', () => this.reopenReason = ''); }
  generateZ(): void { this.run(this.api.post(`/api/v1/pos/z-reports/${this.isoDate()}`, {}), 'Immutable Z-report generated'); }
  postAccounting(): void { this.run(this.api.post(`/api/v1/pos/z-reports/${this.isoDate()}/post-accounting`, {}), 'EOD accounting batch posted'); }
  exportZ(format: 'json' | 'csv' | 'tally'): void {
    this.busy = true; this.api.get<any>(`/api/v1/pos/z-reports/${this.isoDate()}/export?format=${format}`).subscribe({ next: (response) => { const row = response?.data ?? response; const blob = new Blob([row.content], { type: format === 'json' ? 'application/json' : format === 'tally' ? 'application/xml' : 'text/csv' }); const url = URL.createObjectURL(blob); const anchor = document.createElement('a'); anchor.href = url; anchor.download = `z-report-${this.isoDate()}.${format === 'tally' ? 'xml' : format}`; anchor.click(); URL.revokeObjectURL(url); this.busy = false; }, error: (error) => { this.busy = false; this.error = this.errorText(error); } });
  }
  createApprovalLink(): void { if (!this.drawer?.id) return this.fail('No drawer is pending approval'); this.run(this.api.post(`/api/v1/pos/cash-drawer/${this.drawer.id}/approval-link`, { recipient: this.approvalRecipient.trim() || null, channel: this.approvalChannel }), 'Approval link created', undefined, (row) => this.approvalPath = row.approvalPath); }

  scanRisks(): void { this.run(this.api.post(`/api/v1/pos/risk-scan/${this.isoDate()}`, {}), 'Risk scan completed'); }
  resolveRisk(row: RiskCase, status: 'resolved' | 'dismissed'): void { const note = (this.riskNotes[row.id] ?? '').trim(); if (!note) return this.fail('Resolution note is required'); this.run(this.api.post(`/api/v1/pos/risk-cases/${row.id}/resolve`, { status, resolutionNote: note }), 'Risk case updated', () => delete this.riskNotes[row.id]); }

  createAccount(): void {
    if (!this.accountName.trim() || this.accountCredit === '') return this.fail('Name and credit limit are required');
    this.run(this.api.post('/api/v1/pos/corporate-accounts', { accountCode: '', accountName: this.accountName.trim(), billingEmail: this.accountEmail.trim(), phone: this.accountPhone.trim(), gstin: this.accountGstin.trim(), creditLimitPaise: this.toPaise(this.accountCredit), paymentTermsDays: Number(this.accountTerms || 0) }), 'Corporate account created', () => { this.accountCode = ''; this.accountName = ''; this.accountEmail = ''; this.accountPhone = ''; this.accountGstin = ''; this.accountCredit = ''; this.accountTerms = ''; });
  }
  assignCorporateInvoice(): void { if (!this.corporateSaleId.trim() || !this.corporateAccountId || !this.corporateReference.trim()) return this.fail('Invoice, account and corporate reference are required'); this.run(this.api.post(`/api/v1/pos/invoices/${this.corporateSaleId.trim()}/corporate-credit`, { accountId: this.corporateAccountId, reference: this.corporateReference.trim() }), 'Invoice converted to corporate credit', () => { this.corporateSaleId = ''; this.corporateReference = ''; }); }
  selectCorporateAccount(accountId: string): void { this.corporateAccountId = accountId; this.corporateMembers = []; this.corporateStatement = []; if (!accountId) return; this.read<CorporateMember[]>(`/api/v1/pos/corporate-accounts/${accountId}/members`, (rows) => this.corporateMembers = rows, () => {}); this.read<any>(`/api/v1/pos/corporate-accounts/${accountId}/statement`, (row) => this.corporateStatement = Array.isArray(row?.invoices) ? row.invoices : [], () => {}); }
  addCorporateMember(): void { if (!this.corporateAccountId || !this.memberClientId.trim() || this.memberLimit === '') return this.fail('Account, client ID and spending limit are required'); this.run(this.api.post(`/api/v1/pos/corporate-accounts/${this.corporateAccountId}/members`, { clientId: this.memberClientId.trim(), employeeCode: this.memberEmployeeCode.trim(), department: this.memberDepartment.trim(), spendingLimitPaise: this.toPaise(this.memberLimit) }), 'Corporate member saved', () => { this.memberClientId = ''; this.memberEmployeeCode = ''; this.memberDepartment = ''; this.memberLimit = ''; }); }
  recordCorporatePayment(): void { if (!this.corporateAccountId || this.corporatePayment === '' || !this.corporatePaymentReference.trim()) return this.fail('Account, amount and payment reference are required'); this.run(this.api.post(`/api/v1/pos/corporate-accounts/${this.corporateAccountId}/payments`, { amountPaise: this.toPaise(this.corporatePayment), paymentMethod: this.corporatePaymentMethod, paymentReference: this.corporatePaymentReference.trim(), idempotencyKey: crypto.randomUUID() }), 'Corporate payment allocated FIFO', () => { this.corporatePayment = ''; this.corporatePaymentReference = ''; }); }
  saveNotification(): void { this.run(this.api.put('/api/v1/invoice-notifications/profile', this.notification), 'Notification profile saved'); }
  verifyProvider(kind: 'email' | 'phone'): void { this.run(this.api.post('/api/v1/invoice-notifications/profile/verify-provider', { kind }), `${kind === 'email' ? 'Email' : 'Phone'} provider verified`); }
  requestVerification(): void { this.run(this.api.post('/api/v1/invoice-notifications/contact-verifications/request', { contactKind: this.verificationKind }), 'Verification code sent', undefined, (row) => this.verificationId = row.verificationId); }
  confirmVerification(): void { if (!this.verificationId || !/^\d{6}$/.test(this.verificationOtp)) return this.fail('Enter the 6-digit verification code'); this.run(this.api.post('/api/v1/invoice-notifications/contact-verifications/verify', { verificationId: this.verificationId, otp: this.verificationOtp }), 'Contact verified', () => { this.verificationId = ''; this.verificationOtp = ''; }); }
  uploadMedia(kind: 'logo' | 'signature', event: Event): void { const input = event.target as HTMLInputElement; const file = input.files?.[0]; if (!file) return; this.run(this.api.putBytes(`/api/v1/invoice-notifications/profile/media/${kind}?fileName=${encodeURIComponent(file.name)}`, file), `${kind === 'logo' ? 'Logo' : 'Signature'} uploaded`, () => input.value = ''); }
  retryNotification(id: string): void { this.run(this.api.post(`/api/v1/invoice-notifications/queue/${id}/retry`, {}), 'Notification queued again'); }
  processDailyReport(): void { this.run(this.api.post('/api/v1/invoice-notifications/daily-report/process', {}), 'Due daily report processed'); }
  reloadReliability(): void { this.read<any>('/api/v1/pos/reliability', (row) => this.reliability = row, () => {}); }

  money(paise: number | null | undefined): number { return Number(paise ?? 0) / 100; }
  terminalNameFor(id: string): string { return this.terminals.find((row) => row.id === id)?.terminalName ?? id; }
  terminalPresence(row: Terminal): string {
    if (row.status !== 'active') return 'Suspended';
    const lastSeen = row.lastSeenAt ? Date.parse(row.lastSeenAt) : 0;
    return lastSeen && Date.now() - lastSeen <= 90_000 ? 'Online' : 'Offline';
  }
  copyApproval(): void { if (this.approvalPath) navigator.clipboard?.writeText(`${location.origin}${this.approvalPath}`); }
  private read<T>(path: string, assign: (value: T) => void, done: () => void): void { this.api.get<any>(path).subscribe({ next: (response) => { assign((response?.data ?? response) as T); done(); }, error: () => { done(); } }); }
  private reloadTerminals(): void { this.read<Terminal[]>('/api/v1/pos/terminals', (rows) => this.terminals = rows, () => {}); }
  private reloadPrintJobs(): void { this.read<PrintJob[]>('/api/v1/pos/print-jobs', (rows) => this.jobs = rows, () => {}); }
  private run(request: Observable<any>, success: string, reset?: () => void, capture?: (value: any) => void): void { if (this.busy) return; this.busy = true; this.error = ''; this.message = ''; request.subscribe({ next: (response) => { const value = response?.data ?? response; capture?.(value); reset?.(); this.busy = false; this.load(); if (this.corporateAccountId) this.selectCorporateAccount(this.corporateAccountId); this.message = success; }, error: (error) => { this.busy = false; this.error = this.errorText(error); } }); }
  private fail(message: string): void { this.error = message; }
  private toPaise(value: string): number { return Math.round(Number(value || 0) * 100); }
  private isoDate(): string { const [day, month, year] = this.businessDate.split('/').map(Number); return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`; }
  private displayDate(date: Date): string { return `${String(date.getDate()).padStart(2, '0')}/${String(date.getMonth() + 1).padStart(2, '0')}/${date.getFullYear()}`; }
  private errorText(error: any): string { return error?.error?.error?.message ?? error?.error?.message ?? error?.message ?? 'Request failed'; }
}
