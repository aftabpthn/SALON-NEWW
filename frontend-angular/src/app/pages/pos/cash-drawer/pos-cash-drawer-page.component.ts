import { CommonModule } from '@angular/common';
import { Component, OnDestroy, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { AuthService } from '../../../core/services/auth.service';
import { PosRealtimeService } from '../../../core/services/pos-realtime.service';
import { DatePickerComponent } from '../../../shared/date-picker/date-picker.component';
import { ApiService } from '../../../shared/services/api.service';
import { Subscription } from 'rxjs';

interface CashDrawerSession {
  id: string;
  businessDate: string;
  openingCashPaise: number;
  expectedCashPaise: number | null;
  countedCashPaise: number | null;
  variancePaise: number | null;
  status: string;
  blind: boolean;
  denominationBreakdown?: { denominations: Array<{ denominationPaise: number; count: number }>; looseCashPaise: number };
  handoverToStaffId: string;
  handoverNote: string;
  handoverAt: string | null;
}

interface StaffOption { id: string; firstName?: string; middleName?: string; lastName?: string; name?: string; }
interface StaffListPage { items: StaffOption[]; total: number; page: number; pageSize: number; }
interface BankDeposit { id: string; amountPaise: number; bankName: string; reference: string; status: string; notes: string; depositedAt: string; }
interface ProviderReconciliation { id: string; provider: string; statementReference: string; systemGrossPaise: number; statementGrossPaise: number; feePaise: number; bankNetPaise: number; grossDifferencePaise: number; netDifferencePaise: number; status: string; createdByUserId: string; reviewedByUserId: string; }
interface CashTill { id: string; tillCode: string; tillName: string; terminalId: string | null; openingCashPaise: number; expectedCashPaise: number | null; countedCashPaise: number | null; variancePaise: number | null; status: string; blind: boolean; }
interface PosTerminal { id: string; terminalName: string; terminalCode: string; status: string; }
interface CashMovement { id: string; cashDrawerTillId: string | null; movementType: string; amountPaise: number; referenceId: string; notes: string; reversesMovementId: string | null; reversedById: string | null; correctionReason: string; createdAt: string; }

interface CashDrawerReport {
  status: string;
  openingCashPaise: number;
  cashSalesPaise: number;
  cashRefundsPaise: number;
  cashInPaise: number;
  cashOutPaise: number;
  bookingDepositPaise: number;
  tipPaise: number;
  otherFeePaise: number;
  expectedCashPaise: number | null;
  countedCashPaise: number | null;
  variancePaise: number | null;
  paymentModes: Array<{ method: string; paymentCount: number; amountPaise: number; invoiceCount: number }>;
  bankDepositPaise: number;
  pendingDepositPaise: number;
  reconciliationExceptions: number;
  pettyCashCategories: Array<{ category: string; amountPaise: number }>;
}

@Component({
    selector: 'app-pos-cash-drawer-page',
    imports: [CommonModule, FormsModule, RouterLink, DatePickerComponent],
    templateUrl: './pos-cash-drawer-page.component.html',
    styleUrls: ['./pos-cash-drawer-page.component.css']
})
export class PosCashDrawerPageComponent implements OnInit, OnDestroy {
  businessDate = this.toIsoDate(new Date());
  session: CashDrawerSession | null = null;
  report: CashDrawerReport | null = null;
  openingCash = '';
  openingNotes = '';
  holidayException = false;
  movementType = 'cash_in';
  movementAmount = '';
  movementReference = '';
  movementNotes = '';
  movementTillId = '';
  movementIdempotencyKey = crypto.randomUUID();
  actionMfaCode = '';
  movements: CashMovement[] = [];
  movementCorrectionReasons: Record<string, string> = {};
  readonly denominations = [500, 200, 100, 50, 20, 10, 5, 2, 1].map((rupees) => ({ paise: rupees * 100, label: `₹${rupees}`, count: '' }));
  looseCash = '';
  closeNotes = '';
  staff: StaffOption[] = [];
  staffSearch = '';
  staffPage = 1;
  readonly staffPageSize = 25;
  staffTotal = 0;
  handoverStaffId = '';
  handoverNotes = '';
  deposits: BankDeposit[] = [];
  depositAmount = '';
  depositBank = '';
  depositReference = '';
  depositNotes = '';
  editingDepositId = '';
  depositAmendmentNote = '';
  reconciliations: ProviderReconciliation[] = [];
  reconciliationProvider = '';
  reconciliationReference = '';
  reconciliationGross = '';
  reconciliationFee = '';
  reconciliationBankNet = '';
  reconciliationNotes = '';
  reconciliationReviewNotes: Record<string, string> = {};
  reconciliationReviewMfaCodes: Record<string, string> = {};
  reconciliationMfaCode = '';
  readonly reconciliationProviders = ['razorpay', 'cashfree', 'phonepe'];
  reconciliationImporting = false;
  tills: CashTill[] = [];
  terminals: PosTerminal[] = [];
  tillCode = '';
  tillName = '';
  tillTerminalId = '';
  tillOpening = '';
  tillNotes = '';
  tillCounts: Record<string, string> = {};
  tillApprovalMfaCodes: Record<string, string> = {};
  approvalNote = '';
  approvalMfaCode = '';
  depositReviewMfaCodes: Record<string, string> = {};
  loading = false;
  busy = false;
  message = '';
  error = '';
  readonly sectionLoading = { staff: false, movements: false, tills: false, deposits: false, reconciliations: false, report: false };
  readonly sectionErrors = { staff: '', movements: '', tills: '', deposits: '', reconciliations: '', report: '' };
  private loadVersion = 0;
  private liveUpdates?: Subscription;

  constructor(private readonly api: ApiService, private readonly auth: AuthService, private readonly realtime: PosRealtimeService) {}

  ngOnInit(): void {
    this.loadStaff();
    this.loadTerminals();
    this.load();
    this.liveUpdates = this.realtime.events().subscribe((event) => {
      if (event.entityType === 'cash_drawer' || (event.entityType === 'invoice' && event.action === 'invoice.refunded')) this.load();
    });
  }
  ngOnDestroy(): void { this.liveUpdates?.unsubscribe(); }

  load(): void {
    this.loading = true;
    this.message = '';
    this.error = '';
    const date = this.isoDate();
    if (!date) { this.clearDrawerData(); this.loading = false; this.error = 'Select a valid business date'; return; }
    this.fetchSession(date, true, true, ++this.loadVersion);
  }

  onBusinessDateChange(value: string): void {
    this.businessDate = value;
    this.load();
  }

  openDrawer(): void {
    if (this.openingCash !== '' && (!Number.isFinite(Number(this.openingCash)) || Number(this.openingCash) < 0)) { this.error = 'Opening cash cannot be negative'; return; }
    if (this.holidayException && !this.openingNotes.trim()) { this.error = 'Holiday exception notes are required'; return; }
    this.run('/api/v1/pos/cash-drawer/open', {
      businessDate: this.isoDate(),
      openingCashPaise: this.toPaise(this.openingCash),
      notes: this.openingNotes.trim(),
      holidayException: this.holidayException,
    }, 'Cash drawer opened', () => { this.openingCash = ''; this.openingNotes = ''; this.holidayException = false; }, () => this.reloadSession(true));
  }

  recordMovement(): void {
    if (this.number(this.movementAmount) <= 0 || !this.movementNotes.trim()) { this.error = 'Amount and notes are required'; return; }
    if (this.toPaise(this.movementAmount) > 100_000_000_000 || this.movementNotes.trim().length > 1000 || this.movementReference.trim().length > 120) { this.error = 'Amount, reference or notes exceed the allowed limit'; return; }
    if (this.movementType === 'refund_cash' && !this.movementReference.trim()) { this.error = 'Refund reference is required'; return; }
    if (this.openTills.length > 1 && !this.movementTillId) { this.error = 'Select the till for this cash movement'; return; }
    if (this.tills.length && !this.openTills.length) { this.error = 'An open till is required for cash movement'; return; }
    if (!this.actionMfaCode.trim()) { this.error = 'Authenticator or recovery code is required'; return; }
    this.run('/api/v1/pos/cash-drawer/movements', {
      businessDate: this.isoDate(),
      movementType: this.movementType,
      amountPaise: this.toPaise(this.movementAmount),
      referenceType: this.movementType === 'refund_cash' ? 'invoice' : 'manual',
      referenceId: this.movementReference.trim(),
      notes: this.movementNotes.trim(),
      mfaCode: this.actionMfaCode.trim(),
      cashDrawerTillId: this.movementTillId || null,
      idempotencyKey: this.movementIdempotencyKey,
    }, 'Cash movement recorded', () => { this.movementAmount = ''; this.movementReference = ''; this.movementNotes = ''; this.actionMfaCode = ''; this.movementIdempotencyKey = crypto.randomUUID(); }, () => this.reloadMovementState());
  }

  reverseMovement(row: CashMovement): void {
    const reason = (this.movementCorrectionReasons[row.id] ?? '').trim();
    if (!reason) { this.error = 'Correction reason is required'; return; }
    if (!this.actionMfaCode.trim()) { this.error = 'Authenticator or recovery code is required'; return; }
    if (!confirm('Reverse this cash movement with an auditable correction entry?')) return;
    this.run(`/api/v1/pos/cash-drawer/movements/${row.id}/reverse`, { reason, mfaCode: this.actionMfaCode.trim() }, 'Cash movement reversed', () => { delete this.movementCorrectionReasons[row.id]; this.actionMfaCode = ''; }, () => this.reloadMovementState());
  }

  recordHandover(): void {
    if (!this.handoverStaffId || !this.handoverNotes.trim()) { this.error = 'Staff and handover notes are required'; return; }
    if (!confirm('Record this shift handover?')) return;
    this.run('/api/v1/pos/cash-drawer/handover', {
      businessDate: this.isoDate(),
      toStaffId: this.handoverStaffId,
      notes: this.handoverNotes.trim(),
    }, 'Shift handover recorded', () => { this.handoverStaffId = ''; this.handoverNotes = ''; }, () => this.reloadSession(false));
  }

  closeDrawer(): void {
    if (this.tills.some((till) => till.status !== 'closed')) {
      this.error = 'Close and approve every till before day close'; return;
    }
    if (!this.tills.length && (!this.cashCountEntered() || this.denominations.some((item) => item.count !== '' && (!Number.isInteger(Number(item.count)) || Number(item.count) < 0)) || this.number(this.looseCash) < 0)) {
      this.error = 'Enter a valid denomination count'; return;
    }
    if (!confirm(this.tills.length ? 'Close the day using all closed till totals?' : 'Submit blind cash count and close this drawer?')) return;
    const countedCashPaise = this.tills.length ? null : this.denominationTotalPaise();
    this.run('/api/v1/pos/cash-drawer/close', {
      businessDate: this.isoDate(),
      countedCashPaise,
      denominationBreakdown: this.tills.length ? null : {
        denominations: this.denominations.filter((item) => item.count !== '').map((item) => ({ denominationPaise: item.paise, count: Number(item.count) })),
        looseCashPaise: this.toPaise(this.looseCash),
      },
      notes: this.closeNotes.trim(),
    }, 'Cash drawer close submitted', () => { this.denominations.forEach((item) => item.count = ''); this.looseCash = ''; this.closeNotes = ''; }, () => this.reloadSession(true));
  }

  approveVariance(): void {
    if (!this.session || !this.approvalNote.trim()) { this.error = 'Approval note is required'; return; }
    if (!this.approvalMfaCode.trim()) { this.error = 'Authenticator or recovery code is required'; return; }
    if (!confirm('Approve this cash variance and close the drawer?')) return;
    this.run(`/api/v1/pos/cash-drawer/${this.session.id}/approve`, { approvalNote: this.approvalNote.trim(), mfaCode: this.approvalMfaCode.trim() }, 'Cash variance approved', () => { this.approvalNote = ''; this.approvalMfaCode = ''; }, () => this.reloadSession(true));
  }

  createDeposit(): void {
    if (!this.session || this.number(this.depositAmount) <= 0 || !this.depositBank.trim() || !this.depositReference.trim()) {
      this.error = 'Amount, bank and reference are required'; return;
    }
    if (!this.actionMfaCode.trim()) { this.error = 'Authenticator or recovery code is required'; return; }
    this.run(`/api/v1/pos/cash-drawer/${this.session.id}/deposits`, {
      amountPaise: this.toPaise(this.depositAmount), bankName: this.depositBank.trim(),
      reference: this.depositReference.trim(), notes: this.depositNotes.trim(), mfaCode: this.actionMfaCode.trim(),
    }, 'Bank deposit recorded', () => { this.depositAmount = ''; this.depositBank = ''; this.depositReference = ''; this.depositNotes = ''; this.actionMfaCode = ''; }, () => this.reloadDepositState());
  }

  editDeposit(deposit: BankDeposit): void {
    this.editingDepositId = deposit.id;
    this.depositAmount = String(this.money(deposit.amountPaise));
    this.depositBank = deposit.bankName;
    this.depositReference = deposit.reference;
    this.depositNotes = deposit.notes;
    this.depositAmendmentNote = '';
  }

  amendDeposit(): void {
    if (!this.editingDepositId || this.number(this.depositAmount) <= 0 || !this.depositBank.trim() || !this.depositReference.trim() || !this.depositAmendmentNote.trim()) {
      this.error = 'Amount, bank, reference and amendment note are required'; return;
    }
    if (!this.actionMfaCode.trim()) { this.error = 'Authenticator or recovery code is required'; return; }
    this.execute(this.api.put(`/api/v1/pos/cash-drawer/deposits/${this.editingDepositId}`, {
      amountPaise: this.toPaise(this.depositAmount), bankName: this.depositBank.trim(), reference: this.depositReference.trim(),
      notes: this.depositNotes.trim(), amendmentNote: this.depositAmendmentNote.trim(), mfaCode: this.actionMfaCode.trim(),
    }), 'Bank deposit amended', () => { this.editingDepositId = ''; this.depositAmount = ''; this.depositBank = ''; this.depositReference = ''; this.depositNotes = ''; this.depositAmendmentNote = ''; this.actionMfaCode = ''; }, () => this.reloadDepositState());
  }

  reviewDeposit(deposit: BankDeposit, action: 'confirm' | 'cancel'): void {
    const mfaCode = (this.depositReviewMfaCodes[deposit.id] ?? '').trim();
    if (!mfaCode) { this.error = 'Authenticator or recovery code is required'; return; }
    if (!confirm(`${action === 'confirm' ? 'Confirm' : 'Cancel'} deposit ${deposit.reference}?`)) return;
    this.run(`/api/v1/pos/cash-drawer/deposits/${deposit.id}/${action}`, { mfaCode }, `Bank deposit ${action === 'confirm' ? 'confirmed' : 'cancelled'}`, () => { delete this.depositReviewMfaCodes[deposit.id]; }, () => this.reloadDepositState());
  }

  createReconciliation(): void {
    if (!this.reconciliationProvider.trim() || !this.reconciliationReference.trim() || this.reconciliationGross === '' || this.reconciliationBankNet === '') {
      this.error = 'Provider, statement reference, gross and bank net are required'; return;
    }
    if (!this.reconciliationProviders.includes(this.reconciliationProvider) || !this.reconciliationMfaCode.trim()) { this.error = 'Select a supported provider and enter MFA code'; return; }
    if (this.reconciliationReference.trim().length > 120 || this.reconciliationNotes.trim().length > 1000 || [this.reconciliationGross, this.reconciliationFee, this.reconciliationBankNet].some((value) => this.toPaise(value) > 100_000_000_000)) { this.error = 'Statement values exceed the allowed limit'; return; }
    this.run('/api/v1/pos/provider-reconciliations', {
      provider: this.reconciliationProvider.trim(), settlementDate: this.isoDate(),
      statementReference: this.reconciliationReference.trim(), statementGrossPaise: this.toPaise(this.reconciliationGross),
      feePaise: this.toPaise(this.reconciliationFee), bankNetPaise: this.toPaise(this.reconciliationBankNet), notes: this.reconciliationNotes.trim(), mfaCode: this.reconciliationMfaCode.trim(),
    }, 'Provider statement reconciled', () => {
      this.reconciliationReference = ''; this.reconciliationGross = ''; this.reconciliationFee = ''; this.reconciliationBankNet = ''; this.reconciliationNotes = ''; this.reconciliationMfaCode = '';
    }, () => this.reloadReconciliationState());
  }

  async importReconciliationCsv(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file || this.reconciliationImporting) return;
    this.error = '';
    try {
      if (file.size > 1_048_576) throw new Error('CSV file cannot exceed 1 MB');
      const lines = (await file.text()).split(/\r?\n/).filter((line) => line.trim());
      if (lines.length < 2) throw new Error('CSV has no statement rows');
      if (lines.length - 1 > 500) throw new Error('CSV can contain at most 500 rows');
      if (!this.reconciliationMfaCode.trim()) throw new Error('Authenticator or recovery code is required');
      const headers = this.csvCells(lines[0]).map((value) => value.toLowerCase().replace(/[^a-z0-9]/g, ''));
      const index = (name: string) => headers.indexOf(name);
      const required = ['provider', 'settlementdate', 'statementreference', 'statementgross', 'fee', 'banknet'];
      if (required.some((name) => index(name) < 0)) throw new Error('Required CSV columns: provider, settlementDate, statementReference, statementGross, fee, bankNet');
      const rows = lines.slice(1).map((line, rowIndex) => {
        const cells = this.csvCells(line);
        const amount = (name: string) => {
          const value = Number(cells[index(name)]);
          if (!Number.isFinite(value) || value < 0 || Math.round(value * 100) > 100_000_000_000) throw new Error(`Invalid amount on CSV row ${rowIndex + 2}`);
          return Math.round(value * 100);
        };
        const provider = (cells[index('provider')] ?? '').trim();
        const statementReference = (cells[index('statementreference')] ?? '').trim();
        if (!this.reconciliationProviders.includes(provider.toLowerCase()) || !statementReference || statementReference.length > 120) throw new Error(`Supported provider and valid reference are required on CSV row ${rowIndex + 2}`);
        const notes = index('notes') >= 0 ? (cells[index('notes')] ?? '').trim() : '';
        if (notes.length > 1000) throw new Error(`Notes are too long on CSV row ${rowIndex + 2}`);
        return {
          provider: provider.toLowerCase(),
          settlementDate: this.csvDate(cells[index('settlementdate')] ?? ''),
          statementReference,
          statementGrossPaise: amount('statementgross'),
          feePaise: amount('fee'),
          bankNetPaise: amount('banknet'),
          notes,
        };
      });
      if (rows.length > 500) throw new Error('CSV can contain at most 500 rows');
      this.reconciliationImporting = true;
      this.api.post<any>('/api/v1/pos/provider-reconciliations/import', { rows, mfaCode: this.reconciliationMfaCode.trim() }).subscribe({
        next: () => { this.reconciliationImporting = false; input.value = ''; this.reconciliationMfaCode = ''; this.message = `${rows.length} provider statement row(s) imported`; this.reloadReconciliationState(); },
        error: (error) => { this.reconciliationImporting = false; input.value = ''; this.error = this.errorText(error); },
      });
    } catch (error) {
      input.value = '';
      this.error = error instanceof Error ? error.message : 'Invalid provider statement CSV';
    }
  }

  reviewReconciliation(row: ProviderReconciliation): void {
    if (!this.canReviewReconciliation(row)) { this.error = 'A different financial manager must review this reconciliation'; return; }
    const note = (this.reconciliationReviewNotes[row.id] ?? '').trim();
    if (!note) { this.error = 'Review note is required'; return; }
    const mfaCode = (this.reconciliationReviewMfaCodes[row.id] ?? '').trim();
    if (!mfaCode) { this.error = 'Authenticator or recovery code is required'; return; }
    this.run(`/api/v1/pos/provider-reconciliations/${row.id}/review`, { reviewNote: note, mfaCode }, 'Reconciliation reviewed', () => { delete this.reconciliationReviewNotes[row.id]; delete this.reconciliationReviewMfaCodes[row.id]; }, () => this.reloadReconciliationState());
  }

  createTill(): void {
    if (!this.session || !this.tillCode.trim() || !this.tillName.trim() || this.tillOpening === '' || this.number(this.tillOpening) < 0) {
      this.error = 'Till code, name and opening cash are required'; return;
    }
    this.run(`/api/v1/pos/cash-drawer/${this.session.id}/tills`, {
      tillCode: this.tillCode.trim(), tillName: this.tillName.trim(), openingCashPaise: this.toPaise(this.tillOpening), notes: this.tillNotes.trim(),
      terminalId: this.tillTerminalId || null,
    }, 'Cash till opened', () => { this.tillCode = ''; this.tillName = ''; this.tillTerminalId = ''; this.tillOpening = ''; this.tillNotes = ''; }, () => this.reloadTillState());
  }

  closeTill(till: CashTill): void {
    const value = this.tillCounts[till.id] ?? '';
    if (value === '' || this.number(value) < 0) { this.error = 'Counted cash is required'; return; }
    if (!confirm(`Submit counted cash for ${till.tillName}?`)) return;
    this.run(`/api/v1/pos/cash-drawer/tills/${till.id}/close`, { countedCashPaise: this.toPaise(value) }, 'Till close submitted', () => { delete this.tillCounts[till.id]; }, () => this.reloadTillState());
  }

  approveTill(till: CashTill): void {
    const mfaCode = (this.tillApprovalMfaCodes[till.id] ?? '').trim();
    if (!mfaCode) { this.error = 'Authenticator or recovery code is required'; return; }
    if (!confirm(`Approve variance for ${till.tillName}?`)) return;
    this.run(`/api/v1/pos/cash-drawer/tills/${till.id}/approve`, { mfaCode }, 'Till variance approved', () => { delete this.tillApprovalMfaCodes[till.id]; }, () => this.reloadTillState());
  }

  get canOperate(): boolean {
    return this.auth.hasRole('owner', 'admin', 'manager', 'cashier', 'receptionist', 'frontDesk', 'front-desk', 'front_desk', 'frontdesk')
      || this.auth.hasPermission('pos.manage', 'front_desk.write');
  }

  get canApprove(): boolean { return this.auth.hasRole('owner', 'admin', 'manager'); }
  get canManageFinancial(): boolean {
    return this.canApprove || this.auth.hasPermission('management.write', 'finance.write');
  }
  canReviewReconciliation(row: ProviderReconciliation): boolean {
    return this.canManageFinancial && row.createdByUserId !== this.auth.userId;
  }
  get openTills(): CashTill[] { return this.tills.filter((till) => till.status === 'open'); }
  terminalName(id: string | null): string { return this.terminals.find((row) => row.id === id)?.terminalName ?? 'Unassigned'; }
  get staffPageCount(): number { return Math.max(1, Math.ceil(this.staffTotal / this.staffPageSize)); }

  searchStaff(): void {
    this.staffPage = 1;
    this.handoverStaffId = '';
    this.loadStaff();
  }

  changeStaffPage(offset: number): void {
    const page = this.staffPage + offset;
    if (page < 1 || page > this.staffPageCount) return;
    this.staffPage = page;
    this.handoverStaffId = '';
    this.loadStaff();
  }

  tillLabel(id: string | null): string {
    const till = this.tills.find((item) => item.id === id);
    return till ? `${till.tillName} · ${till.tillCode}` : '';
  }

  money(paise: number | null | undefined): number { return (paise ?? 0) / 100; }
  get reportCanShowCloseTotals(): boolean { return !!this.report && !['open', 'not_opened'].includes(this.report.status); }
  displayDate(value: string): string {
    const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    return match ? `${match[3]}/${match[2]}/${match[1]}` : value;
  }
  denominationTotalPaise(): number {
    return this.denominations.reduce((total, item) => total + item.paise * (Number(item.count) || 0), this.toPaise(this.looseCash));
  }
  staffName(id: string): string {
    const value = this.staff.find((item) => item.id === id);
    return value ? (value.name || [value.firstName, value.middleName, value.lastName].filter(Boolean).join(' ')) : id;
  }

  private run(path: string, payload: unknown, success: string, reset: () => void, reload: () => void): void {
    this.execute(this.api.post(path, payload), success, reset, reload);
  }

  private execute(request: ReturnType<ApiService['post']>, success: string, reset: () => void, reload: () => void): void {
    if (this.busy) return;
    this.busy = true;
    this.message = '';
    this.error = '';
    request.subscribe({
      next: () => { reset(); this.busy = false; reload(); this.message = success; },
      error: (error) => { this.error = this.errorText(error); this.busy = false; },
    });
  }

  private errorText(error: any): string {
    const body = error?.error;
    return body?.error?.message ?? body?.message ?? error?.message ?? 'Cash drawer action failed';
  }

  loadStaff(): void {
    this.sectionLoading.staff = true;
    this.sectionErrors.staff = '';
    const params = new URLSearchParams({ page: String(this.staffPage), pageSize: String(this.staffPageSize), active: 'true', sortBy: 'firstName', sortDirection: 'asc' });
    if (this.staffSearch.trim()) params.set('q', this.staffSearch.trim());
    this.api.get<any>(`/staff/list?${params.toString()}`).subscribe({
      next: (response) => {
        const value = (response?.data ?? response) as StaffListPage;
        this.staff = Array.isArray(value?.items) ? value.items : [];
        this.staffTotal = Number(value?.total) || 0;
        this.staffPage = Number(value?.page) || this.staffPage;
        this.sectionLoading.staff = false;
      },
      error: (error) => { this.staff = []; this.staffTotal = 0; this.sectionErrors.staff = this.errorText(error); this.sectionLoading.staff = false; },
    });
  }

  loadTerminals(): void {
    this.api.get<any>('/api/v1/pos/terminals').subscribe({
      next: (response) => { const value = response?.data ?? response; this.terminals = Array.isArray(value) ? value.filter((row) => row.status === 'active') : []; },
      error: () => { this.terminals = []; },
    });
  }

  loadDeposits(sessionId: string, version = this.loadVersion): void {
    this.sectionLoading.deposits = true;
    this.sectionErrors.deposits = '';
    this.api.get<any>(`/api/v1/pos/cash-drawer/${sessionId}/deposits`).subscribe({
      next: (response) => { if (version !== this.loadVersion) return; const value = response?.data ?? response; this.deposits = Array.isArray(value) ? value : []; this.sectionLoading.deposits = false; },
      error: (error) => { if (version !== this.loadVersion) return; this.deposits = []; this.sectionErrors.deposits = this.errorText(error); this.sectionLoading.deposits = false; },
    });
  }
  loadTills(sessionId: string, version = this.loadVersion): void {
    this.sectionLoading.tills = true;
    this.sectionErrors.tills = '';
    this.api.get<any>(`/api/v1/pos/cash-drawer/${sessionId}/tills`).subscribe({
      next: (response) => {
        if (version !== this.loadVersion) return;
        const value = response?.data ?? response;
        this.tills = Array.isArray(value) ? value : [];
        const open = this.openTills;
        if (!open.some((till) => till.id === this.movementTillId)) this.movementTillId = open.length === 1 ? open[0].id : '';
        this.sectionLoading.tills = false;
      },
      error: (error) => { if (version !== this.loadVersion) return; this.tills = []; this.movementTillId = ''; this.sectionErrors.tills = this.errorText(error); this.sectionLoading.tills = false; },
    });
  }
  loadReconciliations(date = this.isoDate(), version = this.loadVersion): void {
    if (!date) return;
    this.sectionLoading.reconciliations = true;
    this.sectionErrors.reconciliations = '';
    this.api.get<any>(`/api/v1/pos/provider-reconciliations?businessDate=${date}`).subscribe({
      next: (response) => { if (version !== this.loadVersion) return; const value = response?.data ?? response; this.reconciliations = Array.isArray(value) ? value : []; this.sectionLoading.reconciliations = false; },
      error: (error) => { if (version !== this.loadVersion) return; this.reconciliations = []; this.sectionErrors.reconciliations = this.errorText(error); this.sectionLoading.reconciliations = false; },
    });
  }
  loadMovements(date = this.isoDate(), version = this.loadVersion): void {
    if (!date) return;
    this.sectionLoading.movements = true;
    this.sectionErrors.movements = '';
    this.api.get<any>(`/api/v1/pos/cash-drawer/movements?businessDate=${date}`).subscribe({
      next: (response) => { if (version !== this.loadVersion) return; const value = response?.data ?? response; this.movements = Array.isArray(value) ? value : []; this.sectionLoading.movements = false; },
      error: (error) => { if (version !== this.loadVersion) return; this.movements = []; this.sectionErrors.movements = this.errorText(error); this.sectionLoading.movements = false; },
    });
  }

  loadReport(date = this.isoDate(), version = this.loadVersion): void {
    if (!date) return;
    this.sectionLoading.report = true;
    this.sectionErrors.report = '';
    this.api.get<any>(`/api/v1/reports/cash-drawer-eod?startDate=${date}`).subscribe({
      next: (response) => { if (version !== this.loadVersion) return; this.report = response?.data ?? null; this.sectionLoading.report = false; },
      error: (error) => { if (version !== this.loadVersion) return; this.report = null; this.sectionErrors.report = this.errorText(error); this.sectionLoading.report = false; },
    });
  }

  private fetchSession(date: string, pageLoad: boolean, loadRelated: boolean, version = this.loadVersion): void {
    this.api.get<any>(`/api/v1/pos/cash-drawer/current?businessDate=${date}`).subscribe({
      next: (response) => {
        if (version !== this.loadVersion) return;
        this.session = response?.data ?? null;
        if (pageLoad) this.loading = false;
        if (!loadRelated) return;
        this.loadReport(date, version);
        this.loadReconciliations(date, version);
        if (this.session) {
          this.loadDeposits(this.session.id, version);
          this.loadTills(this.session.id, version);
          this.loadMovements(date, version);
        } else {
          this.deposits = [];
          this.tills = [];
          this.movements = [];
          this.movementTillId = '';
        }
      },
      error: (error) => { if (version !== this.loadVersion) return; this.clearDrawerData(); this.error = this.errorText(error); if (pageLoad) this.loading = false; },
    });
  }

  private reloadSession(loadRelated: boolean): void {
    const date = this.isoDate();
    if (date) this.fetchSession(date, false, loadRelated);
  }

  private reloadMovementState(): void {
    const date = this.isoDate();
    if (!date) return;
    this.loadMovements(date);
    this.loadReport(date);
    if (this.session) this.loadTills(this.session.id);
  }

  private reloadDepositState(): void {
    if (this.session) this.loadDeposits(this.session.id);
    this.loadReport();
  }

  private reloadReconciliationState(): void {
    this.loadReconciliations();
    this.loadReport();
  }

  private reloadTillState(): void {
    if (this.session) this.loadTills(this.session.id);
    this.loadReport();
  }

  private clearDrawerData(): void {
    this.session = null;
    this.report = null;
    this.deposits = [];
    this.tills = [];
    this.movements = [];
    this.reconciliations = [];
    this.movementTillId = '';
    Object.keys(this.sectionLoading).forEach((key) => this.sectionLoading[key as keyof typeof this.sectionLoading] = false);
    Object.keys(this.sectionErrors).forEach((key) => this.sectionErrors[key as keyof typeof this.sectionErrors] = '');
  }

  private cashCountEntered(): boolean { return this.looseCash !== '' || this.denominations.some((item) => item.count !== ''); }

  private csvCells(line: string): string[] {
    const cells: string[] = [];
    let value = '';
    let quoted = false;
    for (let index = 0; index < line.length; index += 1) {
      const char = line[index];
      if (char === '"' && quoted && line[index + 1] === '"') { value += '"'; index += 1; }
      else if (char === '"') quoted = !quoted;
      else if (char === ',' && !quoted) { cells.push(value); value = ''; }
      else value += char;
    }
    cells.push(value);
    return cells;
  }

  private csvDate(value: string): string {
    const raw = value.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
    const parts = raw.split('/');
    if (parts.length === 3 && /^\d{1,2}$/.test(parts[0]) && /^\d{1,2}$/.test(parts[1]) && /^\d{4}$/.test(parts[2])) {
      return `${parts[2]}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`;
    }
    throw new Error('Settlement date must be DD/MM/YYYY or YYYY-MM-DD');
  }

  private number(value: string): number { return Number(value) || 0; }
  private toPaise(value: string): number { return Math.round(this.number(value) * 100); }
  private isoDate(): string {
    const match = this.businessDate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return '';
    const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    return date.getFullYear() === Number(match[1]) && date.getMonth() === Number(match[2]) - 1 && date.getDate() === Number(match[3]) ? this.businessDate : '';
  }
  private toIsoDate(date: Date): string { return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`; }
}
