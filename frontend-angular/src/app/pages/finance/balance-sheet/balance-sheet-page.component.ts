import { CommonModule } from '@angular/common';
import { Component, HostListener, inject, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { DatePickerComponent } from '../../../shared/date-picker/date-picker.component';
import { ApiEnvelope, ApiService } from '../../../shared/services/api.service';

type Tab = 'overview' | 'ledger' | 'fixedAssets' | 'deferredRevenue' | 'periods';
type Drawer = 'journal' | 'asset' | 'depreciation' | 'recognition' | 'closePeriod' | 'reopenPeriod' | 'costCenter' | 'tagCostCenter' | null;
type AccountGroup = 'asset' | 'liability' | 'equity' | 'revenue' | 'expense' | 'unclassified';

type AccountDefinition = { code: string; name: string; group: AccountGroup; normalBalance: 'debit' | 'credit'; current: boolean };
type AccountBalance = { code: string; name: string; group: AccountGroup; balancePaise: number };
type BalanceSheetReport = {
  asOfDate: string;
  branchId: string;
  balanced: boolean;
  totals: { assetsPaise: number; liabilitiesPaise: number; equityPaise: number; accountingEquationDifferencePaise: number };
  sections: { assets: AccountBalance[]; liabilities: AccountBalance[]; equity: AccountBalance[] };
  unclassifiedAccounts: AccountBalance[];
};
type WorkingCapitalReport = {
  asOfDate: string;
  branchId: string;
  currentAssetsPaise: number;
  currentLiabilitiesPaise: number;
  workingCapitalPaise: number;
};
type LedgerEntry = {
  journalEntryId: string;
  journalLineId: string;
  businessDate: string;
  sourceType: string;
  sourceId: string;
  memo: string;
  debitPaise: number;
  creditPaise: number;
  runningBalancePaise: number;
  costCenterId?: string;
  costCenterCode?: string;
  costCenterName?: string;
};
type LedgerPage = { account: AccountDefinition; fromDate?: string; toDate: string; page: number; pageSize: number; total: number; rows: LedgerEntry[] };
type CostCenter = { id: string; code: string; name: string; kind: string; active: boolean };
type FixedAsset = {
  id: string;
  assetCode: string;
  name: string;
  acquisitionDate: string;
  depreciationStartDate: string;
  costPaise: number;
  salvagePaise: number;
  usefulLifeMonths: number;
  accumulatedDepreciationPaise: number;
  netBookValuePaise: number;
  lastDepreciationDate?: string;
  purchaseOffsetAccount: string;
  status: string;
};
type DeferredSchedule = {
  id: string;
  sourceType: string;
  sourceItemId: string;
  totalPaise: number;
  recognizedPaise: number;
  remainingPaise: number;
  startDate: string;
  endDate: string;
  lastRecognitionDate?: string;
  status: string;
};
type AccountingPeriod = {
  id: string;
  periodMonth: string;
  status: string;
  closeReason: string;
  closedAt?: string;
  reopenReason: string;
  reopenedAt?: string;
};
type ReconciliationCheck = {
  key: string;
  status: string;
  sourceBalancePaise: number;
  ledgerBalancePaise: number;
  variancePaise: number;
  detailCount: number;
};
type HardeningStatus = {
  asOfDate: string;
  branchId: string;
  status: string;
  accountingPeriodStatus: string;
  balanceSheetBalanced: boolean;
  criticalCount: number;
  warningCount: number;
  checks: ReconciliationCheck[];
};
type JournalDraftLine = { accountCode: string; debitRupees: string; creditRupees: string };

@Component({
  selector: 'page-balance-sheet',
  standalone: true,
  imports: [CommonModule, FormsModule, DatePickerComponent],
  templateUrl: './balance-sheet-page.component.html',
  styleUrls: ['./balance-sheet-page.component.css'],
})
export class BalanceSheetPageComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly route = inject(ActivatedRoute);

  readonly tabs: Array<{ id: Tab; label: string; icon: string }> = [
    { id: 'overview', label: 'Overview', icon: 'bi-grid-1x2' },
    { id: 'ledger', label: 'Ledger', icon: 'bi-journal-text' },
    { id: 'fixedAssets', label: 'Fixed Assets', icon: 'bi-building' },
    { id: 'deferredRevenue', label: 'Deferred Revenue', icon: 'bi-hourglass-split' },
    { id: 'periods', label: 'Periods', icon: 'bi-calendar2-check' },
  ];
  activeTab: Tab = 'overview';
  drawer: Drawer = null;
  asOfDate = this.today();
  report: BalanceSheetReport | null = null;
  workingCapital: WorkingCapitalReport | null = null;
  hardening: HardeningStatus | null = null;
  accounts: AccountDefinition[] = [];
  ledger: LedgerPage | null = null;
  fixedAssets: FixedAsset[] = [];
  deferredSchedules: DeferredSchedule[] = [];
  periods: AccountingPeriod[] = [];
  costCenters: CostCenter[] = [];
  loadingOverview = true;
  loadingTab = false;
  saving = false;
  errorMessage = '';
  warningMessage = '';
  successMessage = '';

  ledgerAccountCode = '';
  ledgerFromDate = '';
  ledgerToDate = this.today();
  ledgerPage = 1;
  ledgerPageSize = 25;

  journalDraft = this.emptyJournalDraft();
  assetDraft = this.emptyAssetDraft();
  depreciationMonth = this.currentMonth();
  recognitionDate = this.today();
  periodMonth = this.currentMonth();
  periodReason = '';
  costCenterDraft = { code: '', name: '', kind: '' };
  selectedCostCenterId = '';
  selectedAsset: FixedAsset | null = null;
  selectedSchedule: DeferredSchedule | null = null;
  selectedPeriod: AccountingPeriod | null = null;
  selectedLedgerRow: LedgerEntry | null = null;

  get canWrite(): boolean {
    try {
      const token = localStorage.getItem('aurashine_access_token') ?? '';
      const segment = token.split('.')[1] ?? '';
      const normalized = segment.replace(/-/g, '+').replace(/_/g, '/');
      const claims = JSON.parse(atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '='))) as { role?: string; permissions?: string[] };
      return ['owner', 'admin', 'manager', 'accountant'].includes(claims.role?.toLowerCase() ?? '')
        || claims.permissions?.includes('finance.write') === true;
    } catch {
      return false;
    }
  }

  get differencePaise(): number {
    return this.report?.totals.accountingEquationDifferencePaise ?? 0;
  }

  get periodStatus(): string {
    return this.hardening?.accountingPeriodStatus || 'unavailable';
  }

  get ledgerPages(): number {
    return Math.max(1, Math.ceil((this.ledger?.total ?? 0) / this.ledgerPageSize));
  }

  ngOnInit(): void {
    const routeTab = this.route.snapshot.data['financeTab'] as Tab | undefined;
    if (routeTab && this.tabs.some((tab) => tab.id === routeTab)) this.activeTab = routeTab;
    void this.reloadAll().then(() => this.activeTab === 'overview' ? undefined : this.loadActiveTab());
  }

  async reloadAll(): Promise<void> {
    this.loadingOverview = true;
    this.errorMessage = '';
    this.warningMessage = '';
    const results = await Promise.allSettled([
      this.loadAccounts(),
      this.loadOverview(),
      this.loadHardening(),
      this.loadCostCenters(),
    ]);
    this.loadingOverview = false;
    const coreFailure = results.slice(0, 2).find((result): result is PromiseRejectedResult => result.status === 'rejected');
    const supportFailure = results.slice(2).find((result): result is PromiseRejectedResult => result.status === 'rejected');
    if (coreFailure) this.errorMessage = this.errorText(coreFailure.reason, 'Balance Sheet data could not be loaded.');
    if (supportFailure) this.warningMessage = 'Some finance controls are temporarily unavailable.';
    if (!this.ledgerAccountCode && this.accounts.length) this.ledgerAccountCode = this.accounts[0].code;
  }

  async refresh(): Promise<void> {
    this.successMessage = '';
    if (this.activeTab === 'overview') {
      await this.reloadAll();
      return;
    }
    const results = await Promise.allSettled([this.loadOverview(), this.loadHardening(), this.loadActiveTab()]);
    if (results[0].status === 'rejected') this.errorMessage = this.errorText(results[0].reason, 'Balance Sheet data could not be refreshed.');
    if (results[1].status === 'rejected') this.warningMessage = 'Finance control status is temporarily unavailable.';
  }

  async onAsOfDateChange(value: string): Promise<void> {
    this.asOfDate = value || this.today();
    this.ledgerToDate = this.asOfDate;
    await this.refresh();
  }

  async selectTab(tab: Tab): Promise<void> {
    this.activeTab = tab;
    this.errorMessage = '';
    this.successMessage = '';
    if (tab !== 'overview') await this.loadActiveTab();
  }

  async loadLedger(page = 1): Promise<void> {
    if (!this.ledgerAccountCode) {
      this.ledger = null;
      return;
    }
    this.loadingTab = true;
    this.errorMessage = '';
    try {
      this.ledgerPage = page;
      const params = new URLSearchParams({
        accountCode: this.ledgerAccountCode,
        toDate: this.ledgerToDate || this.asOfDate,
        page: String(page),
        pageSize: String(this.ledgerPageSize),
      });
      if (this.ledgerFromDate) params.set('fromDate', this.ledgerFromDate);
      this.ledger = await this.request<LedgerPage>(`/balance-sheet/ledger?${params}`);
    } catch (error) {
      this.ledger = null;
      this.errorMessage = this.errorText(error, 'Account ledger could not be loaded.');
    } finally {
      this.loadingTab = false;
    }
  }

  openLedger(account: AccountBalance): void {
    this.ledgerAccountCode = account.code;
    void this.selectTab('ledger');
  }

  openJournal(): void {
    if (!this.canWrite) return;
    this.journalDraft = this.emptyJournalDraft();
    this.openDrawer('journal');
  }

  addJournalLine(): void {
    this.journalDraft.lines.push({ accountCode: '', debitRupees: '', creditRupees: '' });
  }

  removeJournalLine(index: number): void {
    if (this.journalDraft.lines.length > 2) this.journalDraft.lines.splice(index, 1);
  }

  async saveJournal(): Promise<void> {
    const lines = this.journalDraft.lines.map((line) => ({
      accountCode: line.accountCode,
      debitPaise: this.rupeesToPaise(line.debitRupees),
      creditPaise: this.rupeesToPaise(line.creditRupees),
    }));
    const debit = lines.reduce((sum, line) => sum + line.debitPaise, 0);
    const credit = lines.reduce((sum, line) => sum + line.creditPaise, 0);
    if (!this.journalDraft.businessDate || lines.some((line) => !line.accountCode || (line.debitPaise > 0) === (line.creditPaise > 0)) || debit <= 0 || debit !== credit) {
      this.errorMessage = 'Journal needs a date, valid accounts, one-sided lines, and equal debit and credit totals.';
      return;
    }
    await this.runAction(
      this.api.post('/balance-sheet/journals', {
        businessDate: this.journalDraft.businessDate,
        idempotencyKey: this.idempotencyKey('manual-journal'),
        memo: this.journalDraft.memo.trim() || null,
        lines,
      }),
      'Journal posted.',
      async () => Promise.allSettled([this.loadOverview(), this.loadHardening(), this.activeTab === 'ledger' ? this.loadLedger(this.ledgerPage) : Promise.resolve()]),
    );
  }

  openAsset(): void {
    this.assetDraft = this.emptyAssetDraft();
    this.openDrawer('asset');
  }

  async saveAsset(): Promise<void> {
    const costPaise = this.rupeesToPaise(this.assetDraft.costRupees);
    const salvagePaise = this.rupeesToPaise(this.assetDraft.salvageRupees);
    const life = Number(this.assetDraft.usefulLifeMonths);
    if (!this.assetDraft.assetCode.trim() || !this.assetDraft.name.trim() || !this.assetDraft.acquisitionDate || !this.assetDraft.purchaseOffsetAccount || costPaise <= 0 || !Number.isInteger(life) || life <= 0 || salvagePaise < 0 || salvagePaise >= costPaise) {
      this.errorMessage = 'Complete the asset details with a positive cost, useful life, and salvage value below cost.';
      return;
    }
    await this.runAction(
      this.api.post('/balance-sheet/fixed-assets', {
        assetCode: this.assetDraft.assetCode.trim().toUpperCase(),
        name: this.assetDraft.name.trim(),
        acquisitionDate: this.assetDraft.acquisitionDate,
        depreciationStartDate: this.assetDraft.depreciationStartDate || null,
        costPaise,
        salvagePaise,
        usefulLifeMonths: life,
        purchaseOffsetAccount: this.assetDraft.purchaseOffsetAccount,
        idempotencyKey: this.idempotencyKey('fixed-asset'),
      }),
      'Fixed asset created.',
      async () => Promise.allSettled([this.loadFixedAssets(), this.loadOverview(), this.loadHardening()]),
    );
  }

  openDepreciation(asset: FixedAsset): void {
    this.selectedAsset = asset;
    this.depreciationMonth = this.currentMonth();
    this.openDrawer('depreciation');
  }

  async postDepreciation(): Promise<void> {
    if (!this.selectedAsset || !/^\d{4}-\d{2}$/.test(this.depreciationMonth)) {
      this.errorMessage = 'Depreciation month is required.';
      return;
    }
    await this.runAction(
      this.api.post(`/balance-sheet/fixed-assets/${encodeURIComponent(this.selectedAsset.id)}/depreciation`, { periodMonth: this.depreciationMonth }),
      'Depreciation posted.',
      async () => Promise.allSettled([this.loadFixedAssets(), this.loadOverview(), this.loadHardening()]),
    );
  }

  openRecognition(schedule: DeferredSchedule): void {
    this.selectedSchedule = schedule;
    this.recognitionDate = this.today();
    this.openDrawer('recognition');
  }

  async recognizeRevenue(): Promise<void> {
    if (!this.selectedSchedule || !this.recognitionDate) {
      this.errorMessage = 'Recognition date is required.';
      return;
    }
    await this.runAction(
      this.api.post(`/balance-sheet/deferred-revenue/${encodeURIComponent(this.selectedSchedule.id)}/recognize`, { recognitionDate: this.recognitionDate }),
      'Deferred revenue recognized.',
      async () => Promise.allSettled([this.loadDeferredRevenue(), this.loadOverview(), this.loadHardening()]),
    );
  }

  openClosePeriod(): void {
    this.periodMonth = this.currentMonth();
    this.periodReason = '';
    this.openDrawer('closePeriod');
  }

  openReopenPeriod(period: AccountingPeriod): void {
    this.selectedPeriod = period;
    this.periodMonth = period.periodMonth.slice(0, 7);
    this.periodReason = '';
    this.openDrawer('reopenPeriod');
  }

  async savePeriod(): Promise<void> {
    if (!/^\d{4}-\d{2}$/.test(this.periodMonth) || !this.periodReason.trim()) {
      this.errorMessage = 'Period month and reason are required.';
      return;
    }
    const request = this.drawer === 'reopenPeriod'
      ? this.api.post(`/balance-sheet/periods/${encodeURIComponent(this.periodMonth)}/reopen`, { reason: this.periodReason.trim() })
      : this.api.post('/balance-sheet/periods/close', { periodMonth: this.periodMonth, reason: this.periodReason.trim() });
    await this.runAction(
      request,
      this.drawer === 'reopenPeriod' ? 'Period reopened.' : 'Period closed.',
      async () => Promise.allSettled([this.loadPeriods(), this.loadOverview(), this.loadHardening()]),
    );
  }

  openCostCenter(): void {
    this.costCenterDraft = { code: '', name: '', kind: '' };
    this.openDrawer('costCenter');
  }

  async saveCostCenter(): Promise<void> {
    if (!this.costCenterDraft.code.trim() || !this.costCenterDraft.name.trim()) {
      this.errorMessage = 'Cost centre code and name are required.';
      return;
    }
    await this.runAction(
      this.api.post('/balance-sheet/cost-centers', {
        code: this.costCenterDraft.code.trim().toUpperCase(),
        name: this.costCenterDraft.name.trim(),
        kind: this.costCenterDraft.kind.trim() || null,
      }),
      'Cost centre created.',
      async () => this.loadCostCenters(),
    );
  }

  openTagCostCenter(row: LedgerEntry): void {
    this.selectedLedgerRow = row;
    this.selectedCostCenterId = row.costCenterId || '';
    this.openDrawer('tagCostCenter');
  }

  async tagCostCenter(): Promise<void> {
    if (!this.selectedLedgerRow || !this.selectedCostCenterId) {
      this.errorMessage = 'Select a cost centre.';
      return;
    }
    await this.runAction(
      this.api.put(`/balance-sheet/journal-lines/${encodeURIComponent(this.selectedLedgerRow.journalLineId)}/cost-center`, { costCenterId: this.selectedCostCenterId }),
      'Ledger line tagged.',
      async () => this.loadLedger(this.ledgerPage),
    );
  }

  async createSnapshot(): Promise<void> {
    if (!this.canWrite || this.saving) return;
    await this.runAction(
      this.api.post('/balance-sheet/snapshots', { asOfDate: this.asOfDate }),
      'Snapshot archived.',
      async () => Promise.allSettled([this.loadOverview(), this.loadHardening()]),
      false,
    );
  }

  openDrawer(drawer: Exclude<Drawer, null>): void {
    if (!this.canWrite) return;
    this.errorMessage = '';
    this.successMessage = '';
    this.drawer = drawer;
  }

  closeDrawer(): void {
    if (this.saving) return;
    this.drawer = null;
    this.selectedAsset = null;
    this.selectedSchedule = null;
    this.selectedPeriod = null;
    this.selectedLedgerRow = null;
    this.errorMessage = '';
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    this.closeDrawer();
  }

  titleCase(value: string): string {
    return value.replace(/\S+/g, (word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase());
  }

  money(paise?: number | null): string {
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format((Number(paise) || 0) / 100);
  }

  date(value?: string | null): string {
    const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
    return match ? `${match[3]}/${match[2]}/${match[1]}` : '—';
  }

  label(value?: string | null): string {
    return String(value || 'unavailable').replace(/[_-]+/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
  }

  trackByCode(_: number, row: AccountDefinition | AccountBalance): string {
    return row.code;
  }

  trackById(_: number, row: { id: string }): string {
    return row.id;
  }

  trackByJournalLine(_: number, row: LedgerEntry): string {
    return row.journalLineId;
  }

  private async loadActiveTab(): Promise<void> {
    if (this.activeTab === 'ledger') return this.loadLedger();
    if (this.activeTab === 'fixedAssets') return this.loadFixedAssets();
    if (this.activeTab === 'deferredRevenue') return this.loadDeferredRevenue();
    if (this.activeTab === 'periods') return this.loadPeriods();
  }

  private async loadAccounts(): Promise<void> {
    this.accounts = await this.request<AccountDefinition[]>('/balance-sheet/accounts');
  }

  private async loadOverview(): Promise<void> {
    const query = `asOfDate=${encodeURIComponent(this.asOfDate)}`;
    const [report, workingCapital] = await Promise.all([
      this.request<BalanceSheetReport>(`/balance-sheet/live?${query}`),
      this.request<WorkingCapitalReport>(`/balance-sheet/working-capital?${query}`),
    ]);
    this.report = report;
    this.workingCapital = workingCapital;
  }

  private async loadHardening(): Promise<void> {
    this.hardening = await this.request<HardeningStatus>(`/balance-sheet/hardening-status?asOfDate=${encodeURIComponent(this.asOfDate)}`);
  }

  private async loadCostCenters(): Promise<void> {
    this.costCenters = await this.request<CostCenter[]>('/balance-sheet/cost-centers');
  }

  private async loadFixedAssets(): Promise<void> {
    this.loadingTab = true;
    try {
      this.fixedAssets = await this.request<FixedAsset[]>('/balance-sheet/fixed-assets');
    } catch (error) {
      this.fixedAssets = [];
      this.errorMessage = this.errorText(error, 'Fixed assets could not be loaded.');
    } finally {
      this.loadingTab = false;
    }
  }

  private async loadDeferredRevenue(): Promise<void> {
    this.loadingTab = true;
    try {
      this.deferredSchedules = await this.request<DeferredSchedule[]>('/balance-sheet/deferred-revenue');
    } catch (error) {
      this.deferredSchedules = [];
      this.errorMessage = this.errorText(error, 'Deferred revenue could not be loaded.');
    } finally {
      this.loadingTab = false;
    }
  }

  private async loadPeriods(): Promise<void> {
    this.loadingTab = true;
    try {
      this.periods = await this.request<AccountingPeriod[]>('/balance-sheet/periods');
    } catch (error) {
      this.periods = [];
      this.errorMessage = this.errorText(error, 'Accounting periods could not be loaded.');
    } finally {
      this.loadingTab = false;
    }
  }

  private async request<T>(path: string): Promise<T> {
    const response = await firstValueFrom(this.api.get<ApiEnvelope<T> | T>(path));
    return this.unwrap(response);
  }

  private unwrap<T>(response: ApiEnvelope<T> | T): T {
    const envelope = response as ApiEnvelope<T>;
    if (Object.prototype.hasOwnProperty.call(envelope as object, 'data')) {
      if (envelope.data === undefined) throw new Error(envelope.error?.message || 'The server returned no data.');
      return envelope.data;
    }
    return response as T;
  }

  private async runAction(
    request: ReturnType<ApiService['post']> | ReturnType<ApiService['put']>,
    message: string,
    reload: () => Promise<unknown>,
    closeDrawer = true,
  ): Promise<void> {
    if (this.saving) return;
    this.saving = true;
    this.errorMessage = '';
    this.successMessage = '';
    try {
      await firstValueFrom(request);
      if (closeDrawer) this.drawer = null;
      await reload();
      this.successMessage = message;
    } catch (error) {
      this.errorMessage = this.errorText(error, 'Finance action could not be completed.');
    } finally {
      this.saving = false;
    }
  }

  private errorText(error: any, fallback: string): string {
    return error?.error?.error?.message ?? error?.error?.message ?? error?.message ?? fallback;
  }

  private rupeesToPaise(value: string): number {
    const amount = Number(value);
    return Number.isFinite(amount) && amount >= 0 ? Math.round(amount * 100) : -1;
  }

  private idempotencyKey(prefix: string): string {
    const id = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    return `${prefix}-${id}`;
  }

  private emptyJournalDraft(): { businessDate: string; memo: string; lines: JournalDraftLine[] } {
    return {
      businessDate: this.today(),
      memo: '',
      lines: [
        { accountCode: '', debitRupees: '', creditRupees: '' },
        { accountCode: '', debitRupees: '', creditRupees: '' },
      ],
    };
  }

  private emptyAssetDraft() {
    return {
      assetCode: '',
      name: '',
      acquisitionDate: this.today(),
      depreciationStartDate: '',
      costRupees: '',
      salvageRupees: '',
      usefulLifeMonths: '',
      purchaseOffsetAccount: '',
    };
  }

  private today(): string {
    const date = new Date();
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  }

  private currentMonth(): string {
    return this.today().slice(0, 7);
  }
}
