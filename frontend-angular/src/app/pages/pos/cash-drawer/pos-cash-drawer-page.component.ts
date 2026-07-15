import { CommonModule } from '@angular/common';
import { Component, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ApiService } from '../../../shared/services/api.service';

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
interface BankDeposit { id: string; amountPaise: number; bankName: string; reference: string; status: string; notes: string; depositedAt: string; }
interface ProviderReconciliation { id: string; provider: string; statementReference: string; systemGrossPaise: number; statementGrossPaise: number; feePaise: number; bankNetPaise: number; grossDifferencePaise: number; netDifferencePaise: number; status: string; }
interface CashTill { id: string; tillCode: string; tillName: string; openingCashPaise: number; expectedCashPaise: number; countedCashPaise: number | null; variancePaise: number | null; status: string; }
interface CashMovement { id: string; movementType: string; amountPaise: number; referenceId: string; notes: string; reversesMovementId: string | null; reversedById: string | null; correctionReason: string; createdAt: string; }

interface CashDrawerReport {
  openingCashPaise: number;
  cashSalesPaise: number;
  cashRefundsPaise: number;
  cashInPaise: number;
  cashOutPaise: number;
  expectedCashPaise: number;
  countedCashPaise: number | null;
  variancePaise: number | null;
  status: string;
  paymentModes: Array<{ method: string; paymentCount: number; amountPaise: number; invoiceCount: number }>;
  bankDepositPaise: number;
  pendingDepositPaise: number;
  reconciliationExceptions: number;
}

@Component({
  selector: 'app-pos-cash-drawer-page',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './pos-cash-drawer-page.component.html',
  styleUrls: ['./pos-cash-drawer-page.component.css'],
})
export class PosCashDrawerPageComponent implements OnInit {
  businessDate = this.toDisplayDate(new Date());
  session: CashDrawerSession | null = null;
  report: CashDrawerReport | null = null;
  openingCash = '';
  openingNotes = '';
  movementType = 'cash_in';
  movementAmount = '';
  movementReference = '';
  movementNotes = '';
  actionMfaCode = '';
  movements: CashMovement[] = [];
  movementCorrectionReasons: Record<string, string> = {};
  readonly denominations = [500, 200, 100, 50, 20, 10, 5, 2, 1].map((rupees) => ({ paise: rupees * 100, label: `₹${rupees}`, count: '' }));
  looseCash = '';
  closeNotes = '';
  staff: StaffOption[] = [];
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
  reconciliationImporting = false;
  tills: CashTill[] = [];
  tillCode = '';
  tillName = '';
  tillOpening = '';
  tillNotes = '';
  tillCounts: Record<string, string> = {};
  approvalNote = '';
  loading = false;
  busy = false;
  message = '';
  error = '';

  constructor(private readonly api: ApiService) {}

  ngOnInit(): void { this.loadStaff(); this.load(); }

  load(): void {
    this.loading = true;
    this.message = '';
    this.error = '';
    const date = this.isoDate();
    this.api.get<any>(`/api/v1/pos/cash-drawer/current?businessDate=${date}`).subscribe({
      next: (response) => {
        this.session = response?.data ?? response ?? null;
        this.loading = false;
        if (this.session) {
          this.loadDeposits(this.session.id);
          this.loadTills(this.session.id);
          this.loadMovements(date);
        } else {
          this.deposits = [];
          this.tills = [];
          this.movements = [];
        }
      },
      error: (error) => { this.error = this.errorText(error); this.loading = false; },
    });
    this.api.get<any>(`/api/v1/reports/cash-drawer-eod?startDate=${date}`).subscribe({
      next: (response) => { this.report = response?.data ?? response ?? null; },
      error: () => { this.report = null; },
    });
    this.loadReconciliations(date);
  }

  openDrawer(): void {
    if (this.openingCash === '' || this.number(this.openingCash) < 0) { this.error = 'Opening cash is required'; return; }
    this.run('/api/v1/pos/cash-drawer/open', {
      businessDate: this.isoDate(),
      openingCashPaise: this.toPaise(this.openingCash),
      notes: this.openingNotes.trim(),
    }, 'Cash drawer opened', () => { this.openingCash = ''; this.openingNotes = ''; });
  }

  recordMovement(): void {
    if (this.number(this.movementAmount) <= 0 || !this.movementNotes.trim()) { this.error = 'Amount and notes are required'; return; }
    if (this.movementType === 'refund_cash' && !this.movementReference.trim()) { this.error = 'Refund reference is required'; return; }
    if (!this.actionMfaCode.trim()) { this.error = 'Authenticator or recovery code is required'; return; }
    this.run('/api/v1/pos/cash-drawer/movements', {
      businessDate: this.isoDate(),
      movementType: this.movementType,
      amountPaise: this.toPaise(this.movementAmount),
      referenceType: this.movementType === 'refund_cash' ? 'invoice' : 'manual',
      referenceId: this.movementReference.trim(),
      notes: this.movementNotes.trim(),
      mfaCode: this.actionMfaCode.trim(),
    }, 'Cash movement recorded', () => { this.movementAmount = ''; this.movementReference = ''; this.movementNotes = ''; this.actionMfaCode = ''; });
  }

  reverseMovement(row: CashMovement): void {
    const reason = (this.movementCorrectionReasons[row.id] ?? '').trim();
    if (!reason) { this.error = 'Correction reason is required'; return; }
    if (!this.actionMfaCode.trim()) { this.error = 'Authenticator or recovery code is required'; return; }
    if (!confirm('Reverse this cash movement with an auditable correction entry?')) return;
    this.run(`/api/v1/pos/cash-drawer/movements/${row.id}/reverse`, { reason, mfaCode: this.actionMfaCode.trim() }, 'Cash movement reversed', () => { delete this.movementCorrectionReasons[row.id]; this.actionMfaCode = ''; });
  }

  recordHandover(): void {
    if (!this.handoverStaffId || !this.handoverNotes.trim()) { this.error = 'Staff and handover notes are required'; return; }
    if (!confirm('Record this shift handover?')) return;
    this.run('/api/v1/pos/cash-drawer/handover', {
      businessDate: this.isoDate(),
      toStaffId: this.handoverStaffId,
      notes: this.handoverNotes.trim(),
    }, 'Shift handover recorded', () => { this.handoverStaffId = ''; this.handoverNotes = ''; });
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
    }, 'Cash drawer close submitted', () => { this.denominations.forEach((item) => item.count = ''); this.looseCash = ''; this.closeNotes = ''; });
  }

  approveVariance(): void {
    if (!this.session || !this.approvalNote.trim()) { this.error = 'Approval note is required'; return; }
    if (!confirm('Approve this cash variance and close the drawer?')) return;
    this.run(`/api/v1/pos/cash-drawer/${this.session.id}/approve`, { approvalNote: this.approvalNote.trim() }, 'Cash variance approved', () => { this.approvalNote = ''; });
  }

  createDeposit(): void {
    if (!this.session || this.number(this.depositAmount) <= 0 || !this.depositBank.trim() || !this.depositReference.trim()) {
      this.error = 'Amount, bank and reference are required'; return;
    }
    if (!this.actionMfaCode.trim()) { this.error = 'Authenticator or recovery code is required'; return; }
    this.run(`/api/v1/pos/cash-drawer/${this.session.id}/deposits`, {
      amountPaise: this.toPaise(this.depositAmount), bankName: this.depositBank.trim(),
      reference: this.depositReference.trim(), notes: this.depositNotes.trim(), mfaCode: this.actionMfaCode.trim(),
    }, 'Bank deposit recorded', () => { this.depositAmount = ''; this.depositBank = ''; this.depositReference = ''; this.depositNotes = ''; this.actionMfaCode = ''; });
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
    }), 'Bank deposit amended', () => { this.editingDepositId = ''; this.depositAmount = ''; this.depositBank = ''; this.depositReference = ''; this.depositNotes = ''; this.depositAmendmentNote = ''; this.actionMfaCode = ''; });
  }

  reviewDeposit(deposit: BankDeposit, action: 'confirm' | 'cancel'): void {
    if (!confirm(`${action === 'confirm' ? 'Confirm' : 'Cancel'} deposit ${deposit.reference}?`)) return;
    this.run(`/api/v1/pos/cash-drawer/deposits/${deposit.id}/${action}`, {}, `Bank deposit ${action === 'confirm' ? 'confirmed' : 'cancelled'}`, () => {});
  }

  createReconciliation(): void {
    if (!this.reconciliationProvider.trim() || !this.reconciliationReference.trim() || this.reconciliationGross === '' || this.reconciliationBankNet === '') {
      this.error = 'Provider, statement reference, gross and bank net are required'; return;
    }
    this.run('/api/v1/pos/provider-reconciliations', {
      provider: this.reconciliationProvider.trim(), settlementDate: this.isoDate(),
      statementReference: this.reconciliationReference.trim(), statementGrossPaise: this.toPaise(this.reconciliationGross),
      feePaise: this.toPaise(this.reconciliationFee), bankNetPaise: this.toPaise(this.reconciliationBankNet), notes: this.reconciliationNotes.trim(),
    }, 'Provider statement reconciled', () => {
      this.reconciliationReference = ''; this.reconciliationGross = ''; this.reconciliationFee = ''; this.reconciliationBankNet = ''; this.reconciliationNotes = '';
    });
  }

  async importReconciliationCsv(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file || this.reconciliationImporting) return;
    this.error = '';
    try {
      const lines = (await file.text()).split(/\r?\n/).filter((line) => line.trim());
      if (lines.length < 2) throw new Error('CSV has no statement rows');
      const headers = this.csvCells(lines[0]).map((value) => value.toLowerCase().replace(/[^a-z0-9]/g, ''));
      const index = (name: string) => headers.indexOf(name);
      const required = ['provider', 'settlementdate', 'statementreference', 'statementgross', 'fee', 'banknet'];
      if (required.some((name) => index(name) < 0)) throw new Error('Required CSV columns: provider, settlementDate, statementReference, statementGross, fee, bankNet');
      const rows = lines.slice(1).map((line, rowIndex) => {
        const cells = this.csvCells(line);
        const amount = (name: string) => {
          const value = Number(cells[index(name)]);
          if (!Number.isFinite(value) || value < 0) throw new Error(`Invalid amount on CSV row ${rowIndex + 2}`);
          return Math.round(value * 100);
        };
        const provider = (cells[index('provider')] ?? '').trim();
        const statementReference = (cells[index('statementreference')] ?? '').trim();
        if (!provider || !statementReference) throw new Error(`Provider and reference are required on CSV row ${rowIndex + 2}`);
        return {
          provider,
          settlementDate: this.csvDate(cells[index('settlementdate')] ?? ''),
          statementReference,
          statementGrossPaise: amount('statementgross'),
          feePaise: amount('fee'),
          bankNetPaise: amount('banknet'),
          notes: index('notes') >= 0 ? (cells[index('notes')] ?? '').trim() : '',
        };
      });
      if (rows.length > 500) throw new Error('CSV can contain at most 500 rows');
      this.reconciliationImporting = true;
      this.api.post<any>('/api/v1/pos/provider-reconciliations/import', { rows }).subscribe({
        next: () => { this.reconciliationImporting = false; input.value = ''; this.message = `${rows.length} provider statement row(s) imported`; this.load(); },
        error: (error) => { this.reconciliationImporting = false; input.value = ''; this.error = this.errorText(error); },
      });
    } catch (error) {
      input.value = '';
      this.error = error instanceof Error ? error.message : 'Invalid provider statement CSV';
    }
  }

  reviewReconciliation(row: ProviderReconciliation): void {
    const note = (this.reconciliationReviewNotes[row.id] ?? '').trim();
    if (!note) { this.error = 'Review note is required'; return; }
    this.run(`/api/v1/pos/provider-reconciliations/${row.id}/review`, { reviewNote: note }, 'Reconciliation reviewed', () => { delete this.reconciliationReviewNotes[row.id]; });
  }

  createTill(): void {
    if (!this.session || !this.tillCode.trim() || !this.tillName.trim() || this.tillOpening === '' || this.number(this.tillOpening) < 0) {
      this.error = 'Till code, name and opening cash are required'; return;
    }
    this.run(`/api/v1/pos/cash-drawer/${this.session.id}/tills`, {
      tillCode: this.tillCode.trim(), tillName: this.tillName.trim(), openingCashPaise: this.toPaise(this.tillOpening), notes: this.tillNotes.trim(),
    }, 'Cash till opened', () => { this.tillCode = ''; this.tillName = ''; this.tillOpening = ''; this.tillNotes = ''; });
  }

  closeTill(till: CashTill): void {
    const value = this.tillCounts[till.id] ?? '';
    if (value === '' || this.number(value) < 0) { this.error = 'Counted cash is required'; return; }
    if (!confirm(`Submit counted cash for ${till.tillName}?`)) return;
    this.run(`/api/v1/pos/cash-drawer/tills/${till.id}/close`, { countedCashPaise: this.toPaise(value) }, 'Till close submitted', () => { delete this.tillCounts[till.id]; });
  }

  approveTill(till: CashTill): void {
    if (!confirm(`Approve variance for ${till.tillName}?`)) return;
    this.run(`/api/v1/pos/cash-drawer/tills/${till.id}/approve`, {}, 'Till variance approved', () => {});
  }

  money(paise: number | null | undefined): number { return (paise ?? 0) / 100; }
  denominationTotalPaise(): number {
    return this.denominations.reduce((total, item) => total + item.paise * (Number(item.count) || 0), this.toPaise(this.looseCash));
  }
  staffName(id: string): string {
    const value = this.staff.find((item) => item.id === id);
    return value ? (value.name || [value.firstName, value.middleName, value.lastName].filter(Boolean).join(' ')) : id;
  }

  private run(path: string, payload: unknown, success: string, reset: () => void): void {
    this.execute(this.api.post(path, payload), success, reset);
  }

  private execute(request: ReturnType<ApiService['post']>, success: string, reset: () => void): void {
    this.busy = true;
    this.message = '';
    this.error = '';
    request.subscribe({
      next: () => { reset(); this.busy = false; this.load(); this.message = success; },
      error: (error) => { this.error = this.errorText(error); this.busy = false; },
    });
  }

  private errorText(error: any): string {
    const body = error?.error;
    return body?.error?.message ?? body?.message ?? error?.message ?? 'Cash drawer action failed';
  }

  private loadStaff(): void {
    this.api.get<any>('/api/v1/staff?pageSize=100').subscribe({
      next: (response) => { const value = response?.data ?? response; this.staff = Array.isArray(value) ? value : (value?.items ?? []); },
      error: () => { this.staff = []; },
    });
  }

  private loadDeposits(sessionId: string): void {
    this.api.get<any>(`/api/v1/pos/cash-drawer/${sessionId}/deposits`).subscribe({
      next: (response) => { const value = response?.data ?? response; this.deposits = Array.isArray(value) ? value : []; },
      error: () => { this.deposits = []; },
    });
  }
  private loadTills(sessionId: string): void {
    this.api.get<any>(`/api/v1/pos/cash-drawer/${sessionId}/tills`).subscribe({
      next: (response) => { const value = response?.data ?? response; this.tills = Array.isArray(value) ? value : []; },
      error: () => { this.tills = []; },
    });
  }
  private loadReconciliations(date: string): void {
    this.api.get<any>(`/api/v1/pos/provider-reconciliations?businessDate=${date}`).subscribe({
      next: (response) => { const value = response?.data ?? response; this.reconciliations = Array.isArray(value) ? value : []; },
      error: () => { this.reconciliations = []; },
    });
  }
  private loadMovements(date: string): void {
    this.api.get<any>(`/api/v1/pos/cash-drawer/movements?businessDate=${date}`).subscribe({
      next: (response) => { const value = response?.data ?? response; this.movements = Array.isArray(value) ? value : []; },
      error: () => { this.movements = []; },
    });
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
    const parts = this.businessDate.trim().split('/');
    return parts.length === 3 ? `${parts[2]}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}` : new Date().toISOString().slice(0, 10);
  }
  private toDisplayDate(date: Date): string { return `${String(date.getDate()).padStart(2, '0')}/${String(date.getMonth() + 1).padStart(2, '0')}/${date.getFullYear()}`; }
}
