import { CommonModule } from '@angular/common';
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { AuthService } from '../../../core/services/auth.service';
import { DatePickerComponent } from '../../../shared/date-picker/date-picker.component';
import { ApiService } from '../../../shared/services/api.service';

type OutgoingCategory = {
  key: string;
  label: string;
  accountCode?: string;
  manualEntry: boolean;
  workflowPath?: string;
  workflowLabel?: string;
};

type AccountDefinition = { code: string; name: string; group: string };
type PartyOption = { id: string; name: string };

type OutgoingLine = {
  id: string;
  lineNumber: number;
  categoryKey: string;
  categoryLabel: string;
  accountCode: string;
  amountPaise: number;
  gstTreatment: string;
  gstPaise: number;
  netPaise: number;
  remarks?: string;
};

type OutgoingVoucher = {
  id: string;
  voucherNumber: string;
  businessDate: string;
  paymentAccountCode: string;
  paymentAccountName: string;
  paymentMode: string;
  referenceNumber?: string;
  chequeNumber?: string;
  chequeDate?: string;
  linkedPartyType: string;
  linkedPartyId?: string;
  linkedPartyName?: string;
  billReference?: string;
  attachmentUrl?: string;
  remarks?: string;
  status: string;
  totalPaise: number;
  gstPaise: number;
  journalEntryId?: string;
  reversalJournalEntryId?: string;
  version: number;
  rejectionReason?: string;
  reversalReason?: string;
  createdAt: string;
  updatedAt: string;
  lines: OutgoingLine[];
};

type OutgoingSummary = {
  voucherCount: number;
  totalPaise: number;
  pendingCount: number;
  inputGstPaise: number;
};

type OutgoingPage = {
  rows: OutgoingVoucher[];
  summary: OutgoingSummary;
  meta: { page: number; pageSize: number; total: number };
};

type DraftLine = {
  categoryKey: string;
  amount: string;
  gstTreatment: 'none' | 'cgst_sgst' | 'igst';
  gstAmount: string;
  remarks: string;
};

type VoucherDraft = {
  businessDate: string;
  paymentAccountCode: string;
  paymentMode: string;
  referenceNumber: string;
  chequeNumber: string;
  chequeDate: string;
  linkedPartyType: string;
  linkedPartyId: string;
  linkedPartyName: string;
  billReference: string;
  attachmentUrl: string;
  remarks: string;
  lines: DraftLine[];
};

type ReportLine = OutgoingLine & {
  voucherId: string;
  voucherNumber: string;
  businessDate: string;
  paymentAccountName: string;
  paymentMode: string;
  linkedPartyName: string;
  billReference: string;
  status: string;
};

@Component({
  selector: 'page-outgoing-funds',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, DatePickerComponent],
  templateUrl: './outgoing-funds-page.component.html',
  styleUrls: ['./outgoing-funds-page.component.css'],
})
export class OutgoingFundsPageComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly auth = inject(AuthService);

  readonly rows = signal<OutgoingVoucher[]>([]);
  readonly categories = signal<OutgoingCategory[]>([]);
  readonly accounts = signal<AccountDefinition[]>([]);
  readonly suppliers = signal<PartyOption[]>([]);
  readonly staff = signal<PartyOption[]>([]);
  readonly clients = signal<PartyOption[]>([]);
  readonly summary = signal<OutgoingSummary>({ voucherCount: 0, totalPaise: 0, pendingCount: 0, inputGstPaise: 0 });
  readonly totalRecords = signal(0);
  readonly currentPage = signal(1);
  readonly selected = signal<OutgoingVoucher | null>(null);
  readonly loading = signal(false);
  readonly busy = signal(false);
  readonly drawerOpen = signal(false);
  readonly error = signal('');
  readonly success = signal('');
  readonly activeTab = signal<'entries' | 'report'>('entries');
  readonly decisionMode = signal<'reject' | 'reverse' | ''>('');

  search = '';
  fromDate = '';
  toDate = '';
  status = '';
  category = '';
  decisionReason = '';
  draft: VoucherDraft = blankVoucherDraft();

  readonly paymentAccounts = computed(() => this.accounts().filter((account) => ['CASH_ON_HAND', 'BANK_CLEARING'].includes(account.code)));
  readonly manualCategories = computed(() => this.categories().filter((category) => category.manualEntry));
  readonly workflowCategories = computed(() => this.categories().filter((category) => !category.manualEntry && category.workflowPath));
  readonly reportLines = computed<ReportLine[]>(() => this.rows().flatMap((voucher) => voucher.lines.map((line) => ({
    ...line,
    voucherId: voucher.id,
    voucherNumber: voucher.voucherNumber,
    businessDate: voucher.businessDate,
    paymentAccountName: voucher.paymentAccountName,
    paymentMode: voucher.paymentMode,
    linkedPartyName: voucher.linkedPartyName || '',
    billReference: voucher.billReference || '',
    status: voucher.status,
  }))));
  readonly totalPages = computed(() => Math.max(1, Math.ceil(this.totalRecords() / 100)));

  readonly canWrite = this.auth.hasPermission('finance.write') || this.auth.hasRole('owner', 'admin', 'manager', 'accountant');
  readonly canExport = this.auth.hasPermission('reports.export', 'finance.write') || this.auth.hasRole('owner', 'admin', 'manager', 'accountant');
  readonly canApprove = this.auth.hasRole('owner', 'admin', 'manager');

  ngOnInit(): void {
    void this.loadInitial();
  }

  async loadInitial(): Promise<void> {
    this.loading.set(true);
    this.error.set('');
    try {
      const [categoryResponse, accountResponse] = await Promise.all([
        firstValueFrom(this.api.get<any>('/api/v1/finance/outgoing-funds/categories')),
        firstValueFrom(this.api.get<any>('/api/v1/balance-sheet/accounts')),
      ]);
      this.categories.set(this.unwrap<OutgoingCategory[]>(categoryResponse) || []);
      this.accounts.set(this.unwrap<AccountDefinition[]>(accountResponse) || []);
      await Promise.all([this.loadParties(), this.reload(false)]);
    } catch (error) {
      this.error.set(this.errorMessage(error, 'Unable to load outgoing funds'));
    } finally {
      this.loading.set(false);
    }
  }

  async reload(showLoader = true): Promise<void> {
    if (showLoader) this.loading.set(true);
    this.error.set('');
    try {
      const response = await firstValueFrom(this.api.get<any>(`/api/v1/finance/outgoing-funds?${this.queryString()}`));
      const page = this.unwrap<OutgoingPage>(response);
      this.rows.set(page?.rows || []);
      this.summary.set(page?.summary || { voucherCount: 0, totalPaise: 0, pendingCount: 0, inputGstPaise: 0 });
      this.totalRecords.set(page?.meta?.total || 0);
      const lastPage = Math.max(1, Math.ceil(this.totalRecords() / 100));
      if (this.currentPage() > lastPage) {
        this.currentPage.set(lastPage);
        await this.reload(false);
        return;
      }
      const selected = this.selected();
      if (selected) this.selected.set((page?.rows || []).find((row) => row.id === selected.id) || selected);
    } catch (error) {
      this.rows.set([]);
      this.error.set(this.errorMessage(error, 'Unable to load outgoing funds'));
    } finally {
      if (showLoader) this.loading.set(false);
    }
  }

  applyFilters(): void {
    this.currentPage.set(1);
    void this.reload();
  }

  clearFilters(): void {
    this.search = '';
    this.fromDate = '';
    this.toDate = '';
    this.status = '';
    this.category = '';
    this.currentPage.set(1);
    void this.reload();
  }

  changePage(page: number): void {
    const next = Math.min(Math.max(page, 1), this.totalPages());
    if (next === this.currentPage()) return;
    this.currentPage.set(next);
    void this.reload();
  }

  openCreate(): void {
    this.selected.set(null);
    this.draft = blankVoucherDraft();
    this.decisionMode.set('');
    this.decisionReason = '';
    this.error.set('');
    this.success.set('');
    this.drawerOpen.set(true);
  }

  openVoucher(voucher: OutgoingVoucher): void {
    this.selected.set(voucher);
    this.draft = {
      businessDate: voucher.businessDate,
      paymentAccountCode: voucher.paymentAccountCode,
      paymentMode: voucher.paymentMode,
      referenceNumber: voucher.referenceNumber || '',
      chequeNumber: voucher.chequeNumber || '',
      chequeDate: voucher.chequeDate || '',
      linkedPartyType: voucher.linkedPartyType || 'none',
      linkedPartyId: voucher.linkedPartyId || '',
      linkedPartyName: voucher.linkedPartyName || '',
      billReference: voucher.billReference || '',
      attachmentUrl: voucher.attachmentUrl || '',
      remarks: voucher.remarks || '',
      lines: voucher.lines.map((line) => ({
        categoryKey: line.categoryKey,
        amount: this.inputMoney(line.amountPaise),
        gstTreatment: (line.gstTreatment as DraftLine['gstTreatment']) || 'none',
        gstAmount: this.inputMoney(line.gstPaise),
        remarks: line.remarks || '',
      })),
    };
    this.decisionMode.set('');
    this.decisionReason = '';
    this.error.set('');
    this.success.set('');
    this.drawerOpen.set(true);
  }

  openVoucherById(id: string): void {
    const voucher = this.rows().find((row) => row.id === id);
    if (voucher) this.openVoucher(voucher);
  }

  firstCategoryLabel(voucher: OutgoingVoucher): string {
    return voucher.lines[0]?.categoryLabel || 'Outgoing';
  }

  closeDrawer(): void {
    if (this.busy()) return;
    this.drawerOpen.set(false);
    this.selected.set(null);
    this.decisionMode.set('');
    this.decisionReason = '';
  }

  addLine(): void {
    this.draft.lines.push(blankLineDraft());
  }

  removeLine(index: number): void {
    if (this.draft.lines.length === 1) {
      this.draft.lines[0] = blankLineDraft();
      return;
    }
    this.draft.lines.splice(index, 1);
  }

  gstChanged(line: DraftLine): void {
    if (line.gstTreatment === 'none') line.gstAmount = '';
  }

  paymentModeChanged(): void {
    if (this.draft.paymentMode === 'Cash') this.draft.paymentAccountCode = 'CASH_ON_HAND';
    else if (this.draft.paymentMode !== 'Other') this.draft.paymentAccountCode = 'BANK_CLEARING';
  }

  linkedPartyChanged(): void {
    this.draft.linkedPartyId = '';
    this.draft.linkedPartyName = '';
  }

  partySelected(): void {
    const party = this.partyOptions().find((option) => option.id === this.draft.linkedPartyId);
    this.draft.linkedPartyName = party?.name || '';
  }

  partyOptions(): PartyOption[] {
    if (this.draft.linkedPartyType === 'vendor') return this.suppliers();
    if (this.draft.linkedPartyType === 'staff') return this.staff();
    if (this.draft.linkedPartyType === 'client') return this.clients();
    return [];
  }

  isRecordParty(): boolean {
    return ['vendor', 'staff', 'client'].includes(this.draft.linkedPartyType);
  }

  titleCasePartyName(value: string): void {
    this.draft.linkedPartyName = value.replace(/\b\S+/g, (word) => `${word.charAt(0).toUpperCase()}${word.slice(1).toLowerCase()}`);
  }

  async save(submit: boolean): Promise<void> {
    if (!this.canEditSelected()) return;
    const payload = this.payload();
    if (!payload) return;
    this.busy.set(true);
    this.error.set('');
    this.success.set('');
    try {
      const selected = this.selected();
      if (selected) {
        const updateResponse = await firstValueFrom(this.api.patch<any>(`/api/v1/finance/outgoing-funds/${selected.id}`, { ...payload, version: selected.version }));
        const updated = this.unwrap<OutgoingVoucher>(updateResponse);
        if (submit && updated) {
          await firstValueFrom(this.api.post<any>(`/api/v1/finance/outgoing-funds/${updated.id}/submit`, {}));
        }
      } else {
        await firstValueFrom(this.api.post<any>('/api/v1/finance/outgoing-funds', { ...payload, idempotencyKey: crypto.randomUUID(), submit }));
      }
      this.success.set(submit ? 'Outgoing voucher submitted' : 'Outgoing voucher saved');
      this.drawerOpen.set(false);
      this.selected.set(null);
      await this.reload(false);
    } catch (error) {
      this.error.set(this.errorMessage(error, 'Unable to save outgoing voucher'));
    } finally {
      this.busy.set(false);
    }
  }

  async action(action: 'submit' | 'approve' | 'reject' | 'reverse' | 'cancel'): Promise<void> {
    const voucher = this.selected();
    if (!voucher) return;
    if ((action === 'reject' || action === 'reverse') && this.decisionReason.trim().length < 3) {
      this.error.set('Reason must be at least 3 characters');
      return;
    }
    this.busy.set(true);
    this.error.set('');
    this.success.set('');
    try {
      const path = `/api/v1/finance/outgoing-funds/${voucher.id}`;
      const response = action === 'cancel'
        ? await firstValueFrom(this.api.delete<any>(path))
        : await firstValueFrom(this.api.post<any>(`${path}/${action}`, action === 'reject' || action === 'reverse' ? { reason: this.decisionReason.trim() } : {}));
      const updated = this.unwrap<OutgoingVoucher>(response);
      const message = ({ submit: 'Outgoing voucher submitted', approve: 'Outgoing voucher approved', reject: 'Outgoing voucher rejected', reverse: 'Outgoing voucher reversed', cancel: 'Outgoing voucher cancelled' } as const)[action];
      this.decisionMode.set('');
      this.decisionReason = '';
      if (action === 'cancel') {
        this.drawerOpen.set(false);
        this.selected.set(null);
      } else if (updated) {
        this.openVoucher(updated);
      }
      await this.reload(false);
      this.success.set(message);
    } catch (error) {
      this.error.set(this.errorMessage(error, `Unable to ${action} outgoing voucher`));
    } finally {
      this.busy.set(false);
    }
  }

  startDecision(mode: 'reject' | 'reverse'): void {
    this.decisionMode.set(mode);
    this.decisionReason = '';
  }

  cancelDecision(): void {
    this.decisionMode.set('');
    this.decisionReason = '';
  }

  async exportCsv(): Promise<void> {
    this.busy.set(true);
    this.error.set('');
    try {
      const response = await firstValueFrom(this.api.get<any>(`/api/v1/finance/outgoing-funds/export?${this.queryString()}`));
      const vouchers = this.unwrap<OutgoingVoucher[]>(response) || [];
      const rows = vouchers.flatMap((voucher) => voucher.lines.map((line) => [
        this.displayDate(voucher.businessDate), voucher.voucherNumber, line.categoryLabel,
        voucher.linkedPartyName || '', voucher.paymentAccountName, voucher.paymentMode,
        voucher.status, this.money(line.gstPaise), this.money(line.amountPaise),
        voucher.billReference || '', line.remarks || voucher.remarks || '',
      ]));
      const csv = [
        ['Date', 'Voucher', 'Category', 'Linked party', 'Payment account', 'Payment mode', 'Status', 'GST', 'Amount', 'Bill reference', 'Remarks'],
        ...rows,
      ].map((row) => row.map(csvCell).join(',')).join('\r\n');
      const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `outgoing-funds-${todayIso()}.csv`;
      anchor.click();
      URL.revokeObjectURL(url);
      this.success.set('Outgoing funds CSV exported');
    } catch (error) {
      this.error.set(this.errorMessage(error, 'Unable to export outgoing funds'));
    } finally {
      this.busy.set(false);
    }
  }

  canEditSelected(): boolean {
    const voucher = this.selected();
    return this.canWrite && (!voucher || ['draft', 'rejected'].includes(voucher.status));
  }

  lineTotalPaise(): number {
    return this.draft.lines.reduce((total, line) => total + this.rupeesToPaise(line.amount), 0);
  }

  gstTotalPaise(): number {
    return this.draft.lines.reduce((total, line) => total + this.rupeesToPaise(line.gstAmount), 0);
  }

  money(value: number): string {
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 2 }).format((Number(value) || 0) / 100);
  }

  inputMoney(value: number): string {
    return value > 0 ? (value / 100).toFixed(2).replace(/\.00$/, '') : '';
  }

  displayDate(value?: string): string {
    const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
    return match ? `${match[3]}/${match[2]}/${match[1]}` : '-';
  }

  displayDateTime(value?: string): string {
    if (!value) return '-';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat('en-GB', { dateStyle: 'short', timeStyle: 'short' }).format(date);
  }

  statusLabel(value: string): string {
    return String(value || '').replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
  }

  private payload(): Record<string, unknown> | null {
    if (!this.draft.businessDate || !this.draft.paymentAccountCode || !this.draft.paymentMode) {
      this.error.set('Voucher date, payment account and payment mode are required');
      return null;
    }
    const lines = this.draft.lines.map((line) => ({
      categoryKey: line.categoryKey,
      amountPaise: this.rupeesToPaise(line.amount),
      gstTreatment: line.gstTreatment,
      gstPaise: this.rupeesToPaise(line.gstAmount),
      remarks: line.remarks.trim() || null,
    })).filter((line) => line.categoryKey || line.amountPaise || line.remarks);
    if (!lines.length || lines.some((line) => !line.categoryKey || line.amountPaise <= 0)) {
      this.error.set('Every expense line requires a category and amount');
      return null;
    }
    if (lines.some((line) => line.gstTreatment === 'none' ? line.gstPaise !== 0 : line.gstPaise <= 0 || line.gstPaise > line.amountPaise)) {
      this.error.set('GST amount must match the selected GST treatment');
      return null;
    }
    if (this.draft.paymentMode === 'Cheque' && (!this.draft.chequeNumber.trim() || !this.draft.chequeDate)) {
      this.error.set('Cheque number and cheque date are required');
      return null;
    }
    if (this.draft.linkedPartyType !== 'none' && !this.draft.linkedPartyId && !this.draft.linkedPartyName.trim()) {
      this.error.set('Select or enter the linked party');
      return null;
    }
    return {
      businessDate: this.draft.businessDate,
      paymentAccountCode: this.draft.paymentAccountCode,
      paymentMode: this.draft.paymentMode,
      referenceNumber: this.draft.referenceNumber.trim() || null,
      chequeNumber: this.draft.chequeNumber.trim() || null,
      chequeDate: this.draft.chequeDate || null,
      linkedPartyType: this.draft.linkedPartyType,
      linkedPartyId: this.draft.linkedPartyId || null,
      linkedPartyName: this.draft.linkedPartyName.trim() || null,
      billReference: this.draft.billReference.trim() || null,
      attachmentUrl: this.draft.attachmentUrl.trim() || null,
      remarks: this.draft.remarks.trim() || null,
      lines,
    };
  }

  private queryString(): string {
    const params = new URLSearchParams({ page: String(this.currentPage()), pageSize: '100' });
    if (this.search.trim()) params.set('q', this.search.trim());
    if (this.fromDate) params.set('fromDate', this.fromDate);
    if (this.toDate) params.set('toDate', this.toDate);
    if (this.status) params.set('status', this.status);
    if (this.category) params.set('category', this.category);
    return params.toString();
  }

  private async loadParties(): Promise<void> {
    const results = await Promise.allSettled([
      firstValueFrom(this.api.get<any>('/api/v1/purchases/suppliers')),
      firstValueFrom(this.api.get<any>('/api/v1/staff?pageSize=100')),
      firstValueFrom(this.api.get<any>('/api/v1/clients?pageSize=100')),
    ]);
    this.suppliers.set(this.partyRows(results[0]));
    this.staff.set(this.partyRows(results[1]));
    this.clients.set(this.partyRows(results[2]));
  }

  private partyRows(result: PromiseSettledResult<any>): PartyOption[] {
    if (result.status !== 'fulfilled') return [];
    const body = this.unwrap<any>(result.value);
    const rows = Array.isArray(body) ? body : Array.isArray(body?.rows) ? body.rows : Array.isArray(body?.clients) ? body.clients : Array.isArray(body?.staff) ? body.staff : Array.isArray(body?.suppliers) ? body.suppliers : [];
    return rows.map((row: any) => ({
      id: String(row?.id || ''),
      name: String(row?.name || row?.fullName || row?.full_name || [row?.firstName || row?.first_name, row?.lastName || row?.last_name].filter(Boolean).join(' ') || ''),
    })).filter((row: PartyOption) => row.id && row.name).sort((a: PartyOption, b: PartyOption) => a.name.localeCompare(b.name));
  }

  private rupeesToPaise(value: string): number {
    const parsed = Number(String(value || '').replace(/,/g, '').trim());
    return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed * 100) : 0;
  }

  private unwrap<T>(response: any): T {
    return (response?.data ?? response) as T;
  }

  private errorMessage(error: any, fallback: string): string {
    return error?.error?.error?.message || error?.error?.message || error?.message || fallback;
  }
}

function blankVoucherDraft(): VoucherDraft {
  return {
    businessDate: todayIso(),
    paymentAccountCode: 'CASH_ON_HAND',
    paymentMode: 'Cash',
    referenceNumber: '',
    chequeNumber: '',
    chequeDate: '',
    linkedPartyType: 'none',
    linkedPartyId: '',
    linkedPartyName: '',
    billReference: '',
    attachmentUrl: '',
    remarks: '',
    lines: [blankLineDraft()],
  };
}

function blankLineDraft(): DraftLine {
  return { categoryKey: '', amount: '', gstTreatment: 'none', gstAmount: '', remarks: '' };
}

function todayIso(): string {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function csvCell(value: unknown): string {
  const text = String(value ?? '');
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}
