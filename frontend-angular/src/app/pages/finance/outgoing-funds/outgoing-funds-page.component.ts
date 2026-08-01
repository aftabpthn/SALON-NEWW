import { CommonModule } from '@angular/common';
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { AuthService } from '../../../core/services/auth.service';
import { DatePickerComponent } from '../../../shared/date-picker/date-picker.component';
import { ApiService } from '../../../shared/services/api.service';

type OutgoingCategory = {
  key: string;
  label: string;
  categoryBucket: string;
  balanceSheetImpact: string;
  operating: boolean;
  accountCode?: string;
  manualEntry: boolean;
  workflowPath?: string;
  workflowLabel?: string;
  requiresParty?: boolean;
  requiresBillReference?: boolean;
  requiresAttachment?: boolean;
  approvalThresholdPaise?: number;
};

type AccountDefinition = { code: string; name: string; group: string };
type PartyOption = { id: string; name: string };
type CashTill = { id: string; tillCode: string; tillName: string; status: string };
type SupplierPayable = {
  purchaseReceiptId: string;
  sourceType: 'live_receipt' | 'opening_migration';
  supplierId: string;
  supplierName: string;
  supplierInvoiceNumber: string;
  receivedDate: string;
  dueDate?: string;
  totalPaise: number;
  returnedPaise: number;
  paidPaise: number;
  balancePaise: number;
};
type SupplierPaymentMetric = { supplierId: string; paidPaise: number; unpaidPaise: number; extraPaidPaise: number };
type SupplierPaymentSummary = { paidPaise: number; unpaidPaise: number; extraPaidPaise: number; suppliers: SupplierPaymentMetric[] };
type SupplierPaymentDraft = { receiptId: string; amount: string; method: string; reference: string };

type OutgoingLine = {
  id: string;
  lineNumber: number;
  categoryKey: string;
  categoryLabel: string;
  categoryBucket: string;
  balanceSheetImpact: string;
  operating: boolean;
  accountCode: string;
  amountPaise: number;
  gstTreatment: string;
  gstPaise: number;
  netPaise: number;
  subcategory?: string;
  costCenterId?: string;
  department?: string;
  linkedPartyType?: string;
  linkedPartyId?: string;
  linkedPartyName?: string;
  sourceReferenceType?: string;
  sourceReferenceId?: string;
  receiptNumber?: string;
  taxInvoice?: boolean;
  reimbursement?: boolean;
  remarks?: string;
};

type OutgoingAttachment = {
  id: string;
  lineNumber?: number;
  fileUrl: string;
  fileType?: string;
  uploadedByUserId: string;
  createdAt: string;
};

type OutgoingAuditEvent = {
  id: string;
  eventType: string;
  actorUserId: string;
  details: unknown;
  createdAt: string;
};

type OutgoingVoucher = {
  id: string;
  voucherNumber: string;
  businessDate: string;
  paymentAccountCode: string;
  paymentAccountName: string;
  paymentMode: string;
  fundSource: string;
  cashDrawerSessionId?: string;
  cashDrawerTillId?: string;
  openingBalancePaise?: number;
  closingBalancePaise?: number;
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
  approvalPolicyReason?: string;
  version: number;
  rejectionReason?: string;
  reversalReason?: string;
  createdAt: string;
  updatedAt: string;
  lines: OutgoingLine[];
  attachments: OutgoingAttachment[];
  auditEvents: OutgoingAuditEvent[];
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
  subcategory: string;
  costCenterId: string;
  department: string;
  linkedPartyType: string;
  linkedPartyId: string;
  linkedPartyName: string;
  sourceReferenceType: string;
  sourceReferenceId: string;
  receiptNumber: string;
  taxInvoice: boolean;
  reimbursement: boolean;
  remarks: string;
};

type DraftAttachment = {
  lineNumber: string;
  fileUrl: string;
  fileType: string;
};

type VoucherDraft = {
  businessDate: string;
  paymentAccountCode: string;
  paymentMode: string;
  fundSource: string;
  cashDrawerTillId: string;
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
  attachments: DraftAttachment[];
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
    imports: [CommonModule, FormsModule, RouterLink, DatePickerComponent],
    templateUrl: './outgoing-funds-page.component.html',
    styleUrls: ['./outgoing-funds-page.component.css']
})
export class OutgoingFundsPageComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly auth = inject(AuthService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private cashTillsLoadVersion = 0;

  readonly rows = signal<OutgoingVoucher[]>([]);
  readonly categories = signal<OutgoingCategory[]>([]);
  readonly accounts = signal<AccountDefinition[]>([]);
  readonly suppliers = signal<PartyOption[]>([]);
  readonly staff = signal<PartyOption[]>([]);
  readonly clients = signal<PartyOption[]>([]);
  readonly cashTills = signal<CashTill[]>([]);
  readonly cashDrawerOpen = signal(false);
  readonly cashTillsLoading = signal(false);
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
  readonly supplierPaymentOpen = signal(false);
  readonly supplierPaymentLoading = signal(false);
  readonly supplierPayables = signal<SupplierPayable[]>([]);
  readonly supplierPaymentMetric = signal<SupplierPaymentMetric>({ supplierId: '', paidPaise: 0, unpaidPaise: 0, extraPaidPaise: 0 });
  readonly paymentSupplier = signal<PartyOption | null>(null);

  search = '';
  fromDate = '';
  toDate = '';
  status = '';
  category = '';
  decisionReason = '';
  draft: VoucherDraft = blankVoucherDraft();
  supplierPaymentMode: 'payable' | 'advance' = 'payable';
  supplierPaymentDraft: SupplierPaymentDraft = blankSupplierPaymentDraft();

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
  readonly reportCategoryCount = computed(() => new Set(this.reportLines().map((line) => line.categoryKey)).size);
  readonly operatingOutgoingPaise = computed(() => this.reportLines().filter((line) => line.operating).reduce((total, line) => total + line.amountPaise, 0));
  readonly balanceSheetOnlyOutgoingPaise = computed(() => this.reportLines().filter((line) => !line.operating).reduce((total, line) => total + line.amountPaise, 0));
  readonly reviewLineCount = computed(() => this.reportLines().filter((line) => line.categoryBucket === 'review').length);
  readonly totalPages = computed(() => Math.max(1, Math.ceil(this.totalRecords() / 100)));

  readonly canWrite = this.auth.hasPermission('finance.write') || this.auth.hasRole('owner', 'admin', 'manager', 'accountant');
  readonly canExport = this.auth.hasPermission('reports.export', 'finance.write') || this.auth.hasRole('owner', 'admin', 'manager', 'accountant');
  readonly canApprove = this.auth.hasRole('owner', 'admin', 'manager');

  ngOnInit(): void {
    void this.loadInitial().then(() => this.openSupplierPaymentFromQuery());
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
    void this.loadCashTills();
  }

  async openSupplierPaymentFromQuery(): Promise<void> {
    const supplierId = this.route.snapshot.queryParamMap.get('supplierId')?.trim();
    if (!supplierId) return;
    const supplier = this.suppliers().find((row) => row.id === supplierId);
    if (!supplier) {
      this.error.set('Supplier is not available in this branch');
      return;
    }
    this.drawerOpen.set(false);
    this.paymentSupplier.set(supplier);
    this.supplierPaymentOpen.set(true);
    this.supplierPaymentMode = 'payable';
    this.supplierPaymentDraft = blankSupplierPaymentDraft();
    await this.loadSupplierPayment();
  }

  async loadSupplierPayment(): Promise<void> {
    const supplier = this.paymentSupplier();
    if (!supplier) return;
    this.supplierPaymentLoading.set(true);
    this.error.set('');
    try {
      const [payableResponse, summaryResponse] = await Promise.all([
        firstValueFrom(this.api.get<any>(`/api/v1/purchases/payables?supplierId=${encodeURIComponent(supplier.id)}`)),
        firstValueFrom(this.api.get<any>('/api/v1/purchases/payment-summary')),
      ]);
      const payables = this.unwrap<SupplierPayable[]>(payableResponse) || [];
      const summary = this.unwrap<SupplierPaymentSummary>(summaryResponse);
      this.supplierPayables.set(payables);
      this.supplierPaymentMetric.set(summary?.suppliers?.find((row) => row.supplierId === supplier.id)
        ?? { supplierId: supplier.id, paidPaise: 0, unpaidPaise: 0, extraPaidPaise: 0 });
      const selected = payables.find((row) => row.purchaseReceiptId === this.supplierPaymentDraft.receiptId && row.balancePaise > 0)
        ?? payables.find((row) => row.balancePaise > 0);
      this.supplierPaymentDraft.receiptId = selected?.purchaseReceiptId || '';
      this.supplierPaymentDraft.amount = selected ? this.inputMoney(selected.balancePaise) : '';
    } catch (error) {
      this.supplierPayables.set([]);
      this.error.set(this.errorMessage(error, 'Unable to load supplier payments'));
    } finally {
      this.supplierPaymentLoading.set(false);
    }
  }

  setSupplierPaymentMode(mode: 'payable' | 'advance'): void {
    this.supplierPaymentMode = mode;
    this.supplierPaymentDraft = blankSupplierPaymentDraft();
    if (mode === 'payable') {
      const payable = this.supplierPayables().find((row) => row.balancePaise > 0);
      this.supplierPaymentDraft.receiptId = payable?.purchaseReceiptId || '';
      this.supplierPaymentDraft.amount = payable ? this.inputMoney(payable.balancePaise) : '';
    }
    this.error.set('');
    this.success.set('');
  }

  supplierPayableChanged(): void {
    const payable = this.selectedSupplierPayable();
    this.supplierPaymentDraft.amount = payable ? this.inputMoney(payable.balancePaise) : '';
  }

  selectedSupplierPayable(): SupplierPayable | undefined {
    return this.supplierPayables().find((row) => row.purchaseReceiptId === this.supplierPaymentDraft.receiptId);
  }

  async saveSupplierPayment(): Promise<void> {
    const supplier = this.paymentSupplier();
    const amountPaise = this.rupeesToPaise(this.supplierPaymentDraft.amount);
    const payable = this.selectedSupplierPayable();
    if (!supplier || amountPaise <= 0) {
      this.error.set('Enter a valid supplier payment amount');
      return;
    }
    if (this.supplierPaymentMode === 'payable' && !payable) {
      this.error.set('Select an unpaid supplier bill');
      return;
    }
    this.busy.set(true);
    this.error.set('');
    this.success.set('');
    try {
      const payload = {
        amountPaise,
        paymentMethod: this.supplierPaymentDraft.method,
        reference: this.supplierPaymentDraft.reference.trim() || null,
        idempotencyKey: crypto.randomUUID(),
      };
      if (this.supplierPaymentMode === 'payable') {
        await firstValueFrom(this.api.post('/api/v1/purchases/payments', {
          ...payload,
          purchaseReceiptId: payable!.purchaseReceiptId,
        }));
        this.success.set('Supplier payment posted');
      } else {
        await firstValueFrom(this.api.post('/api/v1/purchases/supplier-advances', {
          ...payload,
          supplierId: supplier.id,
        }));
        this.success.set('Extra supplier payment recorded');
      }
      await Promise.all([this.loadSupplierPayment(), this.reload(false)]);
      if (this.supplierPaymentMode === 'advance') this.supplierPaymentDraft = blankSupplierPaymentDraft();
    } catch (error) {
      this.error.set(this.errorMessage(error, 'Unable to post supplier payment'));
    } finally {
      this.busy.set(false);
    }
  }

  closeSupplierPayment(): void {
    if (this.busy()) return;
    this.supplierPaymentOpen.set(false);
    this.paymentSupplier.set(null);
    this.supplierPayables.set([]);
    this.error.set('');
    this.success.set('');
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { supplierPayment: null, supplierId: null },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  openVoucher(voucher: OutgoingVoucher): void {
    this.selected.set(voucher);
    this.draft = {
      businessDate: voucher.businessDate,
      paymentAccountCode: voucher.paymentAccountCode,
      paymentMode: voucher.paymentMode,
      fundSource: voucher.fundSource || this.defaultFundSource(voucher.paymentAccountCode),
      cashDrawerTillId: voucher.cashDrawerTillId || '',
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
        subcategory: line.subcategory || '',
        costCenterId: line.costCenterId || '',
        department: line.department || '',
        linkedPartyType: line.linkedPartyType || 'voucher',
        linkedPartyId: line.linkedPartyId || '',
        linkedPartyName: line.linkedPartyName || '',
        sourceReferenceType: line.sourceReferenceType || '',
        sourceReferenceId: line.sourceReferenceId || '',
        receiptNumber: line.receiptNumber || '',
        taxInvoice: !!line.taxInvoice,
        reimbursement: !!line.reimbursement,
        remarks: line.remarks || '',
      })),
      attachments: (voucher.attachments || []).map((attachment) => ({
        lineNumber: attachment.lineNumber ? String(attachment.lineNumber) : '',
        fileUrl: attachment.fileUrl,
        fileType: attachment.fileType || '',
      })),
    };
    this.decisionMode.set('');
    this.decisionReason = '';
    this.error.set('');
    this.success.set('');
    this.drawerOpen.set(true);
    void this.loadCashTills();
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
    if (this.draft.paymentMode === 'Cash') {
      this.draft.paymentAccountCode = 'CASH_ON_HAND';
      if (!['business_cash', 'petty_cash_balance', 'other'].includes(this.draft.fundSource)) this.draft.fundSource = 'business_cash';
    } else if (this.draft.paymentMode !== 'Other') {
      this.draft.paymentAccountCode = 'BANK_CLEARING';
      this.draft.fundSource = 'bank';
    }
    void this.loadCashTills();
  }

  paymentAccountChanged(): void {
    this.draft.fundSource = this.defaultFundSource(this.draft.paymentAccountCode);
    if (this.draft.paymentAccountCode !== 'CASH_ON_HAND') this.draft.cashDrawerTillId = '';
    void this.loadCashTills();
  }

  voucherDateChanged(value: string): void {
    this.draft.businessDate = value;
    void this.loadCashTills();
  }

  defaultFundSource(paymentAccountCode: string): string {
    return paymentAccountCode === 'BANK_CLEARING' ? 'bank' : 'business_cash';
  }

  linePartyChanged(line: DraftLine): void {
    line.linkedPartyId = '';
    line.linkedPartyName = '';
  }

  linePartySelected(line: DraftLine): void {
    const party = this.partyOptionsFor(line.linkedPartyType).find((option) => option.id === line.linkedPartyId);
    line.linkedPartyName = party?.name || '';
  }

  isRecordLineParty(line: DraftLine): boolean {
    return ['vendor', 'staff', 'client'].includes(line.linkedPartyType);
  }

  addAttachment(): void {
    this.draft.attachments.push(blankAttachmentDraft());
  }

  removeAttachment(index: number): void {
    this.draft.attachments.splice(index, 1);
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
    return this.partyOptionsFor(this.draft.linkedPartyType);
  }

  partyOptionsFor(type: string): PartyOption[] {
    if (type === 'vendor') return this.suppliers();
    if (type === 'staff') return this.staff();
    if (type === 'client') return this.clients();
    return [];
  }

  isRecordParty(): boolean {
    return ['vendor', 'staff', 'client'].includes(this.draft.linkedPartyType);
  }

  titleCasePartyName(value: string): void {
    this.draft.linkedPartyName = value.replace(/\b\S+/g, (word) => `${word.charAt(0).toUpperCase()}${word.slice(1).toLowerCase()}`);
  }

  categoryRequirementText(): string {
    const selected = this.draft.lines
      .map((line) => this.categories().find((category) => category.key === line.categoryKey))
      .filter((category): category is OutgoingCategory => !!category);
    const required = [
      selected.some((category) => category.requiresParty) ? 'linked party' : '',
      selected.some((category) => category.requiresBillReference) ? 'bill reference' : '',
      selected.some((category) => category.requiresAttachment) ? 'evidence' : '',
    ].filter(Boolean);
    return required.length ? `Required for selected category: ${required.join(', ')}` : '';
  }

  async save(submit: boolean): Promise<void> {
    if (!this.canEditSelected()) return;
    const payload = this.payload(submit);
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
        line.categoryBucket || '', line.balanceSheetImpact || '', line.operating ? 'yes' : 'no',
        line.subcategory || '', line.department || '', voucher.linkedPartyName || line.linkedPartyName || '',
        voucher.paymentAccountName, voucher.paymentMode, voucher.fundSource || '',
        voucher.status, this.money(line.gstPaise), this.money(line.amountPaise),
        voucher.billReference || '', line.receiptNumber || '', line.taxInvoice ? 'yes' : 'no',
        line.reimbursement ? 'yes' : 'no', line.remarks || voucher.remarks || '',
      ]));
      const csv = [
        ['Date', 'Voucher', 'Category', 'Bucket', 'Balance sheet impact', 'Operating', 'Subcategory', 'Department', 'Linked party', 'Payment account', 'Payment mode', 'Fund source', 'Status', 'GST', 'Amount', 'Bill reference', 'Receipt', 'Tax invoice', 'Reimbursement', 'Remarks'],
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

  private payload(submit: boolean): Record<string, unknown> | null {
    if (!this.draft.businessDate || !this.draft.paymentAccountCode || !this.draft.paymentMode) {
      this.error.set('Voucher date, payment account and payment mode are required');
      return null;
    }
    const lines = this.draft.lines.map((line) => ({
      categoryKey: line.categoryKey,
      amountPaise: this.rupeesToPaise(line.amount),
      gstTreatment: line.gstTreatment,
      gstPaise: this.rupeesToPaise(line.gstAmount),
      subcategory: line.subcategory.trim() || null,
      costCenterId: line.costCenterId.trim() || null,
      department: line.department.trim() || null,
      linkedPartyType: line.linkedPartyType || 'voucher',
      linkedPartyId: line.linkedPartyId.trim() || null,
      linkedPartyName: line.linkedPartyName.trim() || null,
      sourceReferenceType: line.sourceReferenceType.trim() || null,
      sourceReferenceId: line.sourceReferenceId.trim() || null,
      receiptNumber: line.receiptNumber.trim() || null,
      taxInvoice: line.taxInvoice,
      reimbursement: line.reimbursement,
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
    if (lines.some((line) => ['vendor', 'staff', 'client'].includes(line.linkedPartyType) && !line.linkedPartyId)) {
      this.error.set('Select the real record for every line party');
      return null;
    }
    if (lines.some((line) => ['owner', 'other'].includes(line.linkedPartyType) && !line.linkedPartyName)) {
      this.error.set('Enter the name for every owner or other line party');
      return null;
    }
    if (submit && this.draft.paymentAccountCode === 'CASH_ON_HAND' && this.cashTills().length > 1 && !this.draft.cashDrawerTillId) {
      this.error.set('Select the cash till before submitting');
      return null;
    }
    const attachments = this.draft.attachments
      .map((attachment) => ({
        lineNumber: attachment.lineNumber ? Number(attachment.lineNumber) : null,
        fileUrl: attachment.fileUrl.trim(),
        fileType: attachment.fileType.trim() || null,
      }))
      .filter((attachment) => attachment.fileUrl);
    if (attachments.some((attachment) => attachment.lineNumber && (attachment.lineNumber < 1 || attachment.lineNumber > lines.length))) {
      this.error.set('Attachment line number must match an expense line');
      return null;
    }
    if (attachments.some((attachment) => !/^https?:\/\//i.test(attachment.fileUrl))) {
      this.error.set('Attachment file URL must start with http:// or https://');
      return null;
    }
    const attachmentUrl = this.draft.attachmentUrl.trim();
    if (attachmentUrl && !/^https?:\/\//i.test(attachmentUrl)) {
      this.error.set('Attachment URL must start with http:// or https://');
      return null;
    }
    const selectedCategories = lines
      .map((line) => this.categories().find((category) => category.key === line.categoryKey))
      .filter((category): category is OutgoingCategory => !!category);
    if (selectedCategories.some((category) => category.requiresParty)
      && this.draft.linkedPartyType === 'none'
      && !lines.some((line) => !['voucher', 'none'].includes(line.linkedPartyType))) {
      this.error.set('Linked party is required for the selected category');
      return null;
    }
    if (selectedCategories.some((category) => category.requiresBillReference) && !this.draft.billReference.trim()) {
      this.error.set('Bill reference is required for the selected category');
      return null;
    }
    if (selectedCategories.some((category) => category.requiresAttachment) && !attachmentUrl && !attachments.length) {
      this.error.set('Evidence is required for the selected category');
      return null;
    }
    return {
      businessDate: this.draft.businessDate,
      paymentAccountCode: this.draft.paymentAccountCode,
      paymentMode: this.draft.paymentMode,
      fundSource: this.draft.fundSource,
      cashDrawerTillId: this.draft.cashDrawerTillId.trim() || null,
      referenceNumber: this.draft.referenceNumber.trim() || null,
      chequeNumber: this.draft.chequeNumber.trim() || null,
      chequeDate: this.draft.chequeDate || null,
      linkedPartyType: this.draft.linkedPartyType,
      linkedPartyId: this.draft.linkedPartyId || null,
      linkedPartyName: this.draft.linkedPartyName.trim() || null,
      billReference: this.draft.billReference.trim() || null,
      attachmentUrl: attachmentUrl || null,
      remarks: this.draft.remarks.trim() || null,
      lines,
      attachments,
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

  private async loadCashTills(): Promise<void> {
    const version = ++this.cashTillsLoadVersion;
    this.cashTills.set([]);
    this.cashDrawerOpen.set(false);
    this.cashTillsLoading.set(false);
    if (this.draft.paymentAccountCode !== 'CASH_ON_HAND' || !this.draft.businessDate) return;
    this.cashTillsLoading.set(true);
    try {
      const sessionResponse = await firstValueFrom(this.api.get<any>(`/api/v1/pos/cash-drawer/current?businessDate=${this.draft.businessDate}`));
      if (version !== this.cashTillsLoadVersion) return;
      const session = this.unwrap<any>(sessionResponse);
      if (!session?.id || session.status !== 'open') return;
      this.cashDrawerOpen.set(true);
      const tillResponse = await firstValueFrom(this.api.get<any>(`/api/v1/pos/cash-drawer/${session.id}/tills`));
      if (version !== this.cashTillsLoadVersion) return;
      const tills = (this.unwrap<CashTill[]>(tillResponse) || []).filter((till) => till.status === 'open');
      this.cashTills.set(tills);
      if (!tills.some((till) => till.id === this.draft.cashDrawerTillId)) {
        this.draft.cashDrawerTillId = tills.length === 1 ? tills[0].id : '';
      }
    } catch {
      if (version !== this.cashTillsLoadVersion) return;
      this.cashTills.set([]);
      this.cashDrawerOpen.set(false);
    } finally {
      if (version === this.cashTillsLoadVersion) this.cashTillsLoading.set(false);
    }
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
    fundSource: 'business_cash',
    cashDrawerTillId: '',
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
    attachments: [],
  };
}

function blankLineDraft(): DraftLine {
  return {
    categoryKey: '',
    amount: '',
    gstTreatment: 'none',
    gstAmount: '',
    subcategory: '',
    costCenterId: '',
    department: '',
    linkedPartyType: 'voucher',
    linkedPartyId: '',
    linkedPartyName: '',
    sourceReferenceType: '',
    sourceReferenceId: '',
    receiptNumber: '',
    taxInvoice: false,
    reimbursement: false,
    remarks: '',
  };
}

function blankAttachmentDraft(): DraftAttachment {
  return { lineNumber: '', fileUrl: '', fileType: '' };
}

function blankSupplierPaymentDraft(): SupplierPaymentDraft {
  return { receiptId: '', amount: '', method: 'bank', reference: '' };
}

function todayIso(): string {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function csvCell(value: unknown): string {
  const text = String(value ?? '');
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}
