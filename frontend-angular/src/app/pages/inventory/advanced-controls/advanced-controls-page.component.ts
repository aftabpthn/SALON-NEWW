import { LanguageService } from '../../../core/i18n/language.service';

import { Component, inject, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { ApiEnvelope, ApiService } from '../../../shared/services/api.service';
import { TranslatePipe } from '../../../shared/pipes/translate.pipe';
import { AuthService } from '../../../core/services/auth.service';
import { DatePickerComponent } from '../../../shared/date-picker/date-picker.component';
import { ActionDialogService } from '../../../shared/services/action-dialog.service';

type Tab = 'exceptions' | 'approvals' | 'locks' | 'expiry' | 'dead-stock' | 'policy' | 'master-data' | 'operations';
type NegativeStockRequest = { id:string; productName:string; requestedStockQuantity:number; reason:string; status:string; requestedBy:string; requestedAt:string };
type InventoryPolicy = { negativeStockRule: 'block' | 'approval_required' | 'allow_with_warning'; autoCheckoutRetailSales:boolean; autoCheckoutServiceConsumption:boolean; valuationMethod: 'weighted_average' | 'fifo'; expiryWindowDays: number; countVarianceThresholdBps: number; countValueVarianceThresholdPaise?: number; allowZeroUnauditedAudit:boolean; reorderHistoryDays: number; reorderCoverageDays: number; partialDeliveryPolicy: 'allow' | 'block'; financialLockDate: string; editLockDays: number; masterEditLock: boolean; excessReceivingPolicy:'block'|'permission_required'; priceDifferencePrompt:boolean; priceDifferenceThresholdBps:number; transferBaseTransportCostPaise: number | null; transferCostPerKmPaise: number | null; transferHandlingCostPerUnitPaise: number | null; transferDelayCostPerUnitDayPaise: number | null; transferExpectedDays: number | null; approvalMatrix: Record<string, string>; stockActionMatrix:Record<'receipt'|'transfer'|'adjustment'|'audit'|'consumption'|'returns'|'kit',boolean>; purchaseOrderSettings:{ numberPrefix:string; approvalRequired:boolean; approvalThresholdPaise:number; bulkRaiseEnabled:boolean; supplierElectronicDelivery:boolean }; labelSettings:{ priceCaption:string; showName:boolean; showPrice:boolean; showSku:boolean; showBatch:boolean; showExpiry:boolean; widthMm:number; heightMm:number; columns:number; terms:Record<string,string> } };
type MasterValue = { id:string; kind:'category'|'subcategory'|'brand'|'adjustment_reason'|'action_label'; code:string; label:string; parentCode:string; active:boolean };
type InventoryMasterData = { values:MasterValue[]; units:Array<{ code:string; label:string; dimension:string; active:boolean }> };
type OperationsHealth = {
  queue: { queued:number; processing:number; retryScheduled:number; terminalFailed:number; oldestPendingAt?:string; lastSentAt?:string; lastFailure?:string };
  invariants: { ledgerStockMismatch:number; negativeStock:number; ledgerSnapshotMissing:number; ledgerSnapshotMismatch:number; provenanceIncomplete:number; batchEvidenceMissing:number; trustedLedgerRows:number; reconstructedLedgerRows:number };
  failedJobs: Array<{ id:string; channel:string; destination:string; attempts:number; maxAttempts:number; lastError:string; updatedAt:string }>;
  generatedAt?: string;
};
type AutomationPolicy = { enabled:boolean; autoTransferDrafts:boolean; autoPoDrafts:boolean; monthlyBudgetPaise:number; categoryBudgetsPaise:Record<string,number>; expiryRescueDays:number; runIntervalMinutes:number; escalationMinutes:number; minConfidenceBps:number; lastRunAt?:string; nextRunAt:string };
type AutomationAction = { id:string; actionType:string; status:string; title:string; rationale:string; confidenceBps:number; estimatedCostPaise:number; payloadJson:Record<string,unknown>; requestedBy:string; reviewedBy?:string; reviewNote:string; resourceType:string; resourceId:string; lastError:string; createdAt:string; updatedAt:string };
type AutonomousOperations = { persisted:boolean; policy:AutomationPolicy; actions:AutomationAction[]; summary:{ pendingApproval:number; failed:number; completed:number; budgetCommittedPaise:number; pendingExpensePaise:number; availableCashPaise:number; budgetRemainingPaise:number } };
type CategoryBudgetDraft = { category:string; amountRupees:number|null };
type ControlException = { branchId:string; branchName:string; severity: string; control: string; title: string; valuePaise: number; evidence: string; owner: string; status: string; route: string };
type ApprovalControl = { branchId:string; branchName:string; control: string; requiredRole: string; pending: number; gate: string; route: string };
type AuditLock = { branchId:string; branchName:string; lock: string; locked: number; reason: string; route: string };
type ExpiryRow = { branchId:string; branchName:string; productId: string; productName: string; batchNumber: string; expiryDate: string; daysToExpiry: number };
type DeadStockRow = { branchId:string; branchName:string; productId: string; productName: string; sku: string; stockQuantity: number; inactiveDays: number; valuePaise: number; lastOutboundAt?: string };
type AdvancedControls = {
  summary: { critical: number; warnings: number; pendingApprovals: number; expiryAlerts: number | null; deadStock: number };
  capabilities: { approvalMatrix: boolean; auditLocks: boolean; expiry: boolean; deadStock: boolean };
  exceptionRows: ControlException[];
  approvalMatrix: ApprovalControl[];
  auditLocks: AuditLock[];
  expiringRows: ExpiryRow[];
  deadStockRows: DeadStockRow[];
};

@Component({
    selector: 'page-inventory-advanced-controls',
    imports: [FormsModule, RouterLink, TranslatePipe, DatePickerComponent],
    templateUrl: './advanced-controls-page.component.html',
    styleUrls: ['./advanced-controls-page.component.css']
})
export class AdvancedControlsPageComponent implements OnInit {
  private readonly language = inject(LanguageService);
  private readonly api = inject(ApiService);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly dialogs = inject(ActionDialogService);

  readonly tabs: Array<{ id: Tab; label: string }> = [
    { id: 'exceptions', label: 'Exceptions' },
    { id: 'approvals', label: 'Approval Matrix' },
    { id: 'locks', label: 'Audit Locks' },
    { id: 'expiry', label: 'Expiry' },
    { id: 'dead-stock', label: 'Dead Stock' },
    { id: 'policy', label: 'Policy' },
    { id: 'master-data', label: 'Master Data' },
    { id: 'operations', label: 'Operations' },
  ];
  readonly stockActions:Array<keyof InventoryPolicy['stockActionMatrix']> = ['receipt','transfer','adjustment','audit','consumption','returns','kit'];
  activeTab: Tab = 'exceptions';
  severity = 'all';
  allBranches = true;
  loading = true;
  error = '';
  controls: AdvancedControls = this.emptyControls();
  policy: InventoryPolicy = { negativeStockRule: 'block', autoCheckoutRetailSales:true, autoCheckoutServiceConsumption:true, valuationMethod: 'weighted_average', expiryWindowDays: 30, countVarianceThresholdBps: 500, countValueVarianceThresholdPaise: 10_000, allowZeroUnauditedAudit:false, reorderHistoryDays: 60, reorderCoverageDays: 30, partialDeliveryPolicy:'allow', financialLockDate:'', editLockDays:90, masterEditLock:false, excessReceivingPolicy:'permission_required', priceDifferencePrompt:true, priceDifferenceThresholdBps:0, transferBaseTransportCostPaise: null, transferCostPerKmPaise: null, transferHandlingCostPerUnitPaise: null, transferDelayCostPerUnitDayPaise: null, transferExpectedDays: null, approvalMatrix: { negativeStock: 'owner', stockCount: 'inventory_manager', backbarOverride: 'owner' }, stockActionMatrix:{ receipt:true, transfer:true, adjustment:true, audit:true, consumption:true, returns:true, kit:true }, purchaseOrderSettings:{ numberPrefix:'PO', approvalRequired:true, approvalThresholdPaise:0, bulkRaiseEnabled:true, supplierElectronicDelivery:false }, labelSettings:{ priceCaption:'MRP', showName:true, showPrice:true, showSku:true, showBatch:true, showExpiry:true, widthMm:76, heightMm:32, columns:5, terms:{ product:'Product', retail:'Retail', consumable:'Consumable', stock:'Stock' } } };
  masterData: InventoryMasterData = { values:[], units:[] };
  masterDraft = { kind:'category' as MasterValue['kind'], code:'', label:'', parentCode:'', active:true };
  countValueVarianceThresholdRupees: number | null = 100;
  supportsCountValueVarianceThreshold = false;
  transferBaseTransportRupees: number | null = null;
  transferCostPerKmRupees: number | null = null;
  transferHandlingPerUnitRupees: number | null = null;
  transferDelayPerUnitDayRupees: number | null = null;
  savingPolicy = false;
  negativeStockRequests: NegativeStockRequest[] = [];
  notice = '';
  operations: OperationsHealth = this.emptyOperations();
  retryingJobId = '';
  autonomous: AutonomousOperations = this.emptyAutonomous();
  automationBudgetRupees: number | null = null;
  categoryBudgets: CategoryBudgetDraft[] = [];
  automationBusy = false;

  ngOnInit() {
    void this.reload();
  }

  get filteredExceptions() {
    return this.severity === 'all'
      ? this.controls.exceptionRows
      : this.controls.exceptionRows.filter((row) => row.severity === this.severity);
  }

  get canApproveAutomation() {
    return this.auth.hasRole('owner', 'admin') || this.auth.hasPermission('inventory.approve');
  }

  get canManageAutomationPolicy() {
    return this.auth.hasRole('owner', 'admin');
  }

  get canRunAutomation() {
    return this.auth.hasRole('owner', 'admin', 'manager') || this.auth.hasPermission('inventory.manage');
  }

  get canExportReports() {
    return this.auth.hasAccess(['owner', 'admin'], ['reports.export']);
  }

  async reload() {
    this.loading = true;
    this.error = '';
    try {
      const response = await firstValueFrom(this.api.get<ApiEnvelope<AdvancedControls>>(`/inventory/advanced-controls?allBranches=${this.allBranches}`));
      if (!response.success || !response.data) throw new Error(response.error?.message || 'Controls could not be loaded');
      this.controls = response.data;
      this.loading = false;
      void this.loadSupportingData();
    } catch (error: any) {
      this.controls = this.emptyControls();
      this.error = error?.error?.error?.message ?? error?.error?.message ?? error?.message ?? 'Controls could not be loaded';
    } finally {
      this.loading = false;
    }
  }

  async selectTab(tab: Tab) {
    this.activeTab = tab;
    if (tab === 'policy' || tab === 'operations') await this.loadSupportingData();
    if (tab === 'master-data') await this.loadMasterData();
  }

  async onBranchScopeChange() {
    await this.reload();
  }

  private async loadSupportingData() {
    const [policy, negativeRequests, operations, autonomous] = await Promise.allSettled([
      firstValueFrom(this.api.get<ApiEnvelope<InventoryPolicy>>('/inventory/policy')),
      firstValueFrom(this.api.get<ApiEnvelope<NegativeStockRequest[]>>('/inventory/negative-stock-requests')),
      firstValueFrom(this.api.get<ApiEnvelope<OperationsHealth>>('/inventory/operations-health')),
      firstValueFrom(this.api.get<ApiEnvelope<AutonomousOperations>>('/inventory/autonomous-operations')),
    ]);
    if (policy.status === 'fulfilled' && policy.value.data) { this.policy = { ...policy.value.data, allowZeroUnauditedAudit:policy.value.data.allowZeroUnauditedAudit ?? false, financialLockDate:policy.value.data.financialLockDate || '' }; this.supportsCountValueVarianceThreshold = Number.isSafeInteger(this.policy.countValueVarianceThresholdPaise); this.syncTransferCostInputs(); }
    if (negativeRequests.status === 'fulfilled' && negativeRequests.value.data) this.negativeStockRequests = negativeRequests.value.data;
    if (operations.status === 'fulfilled' && operations.value.data) this.operations = operations.value.data;
    if (autonomous.status === 'fulfilled' && autonomous.value.data) {
      this.autonomous = autonomous.value.data;
      this.automationBudgetRupees = this.autonomous.persisted ? this.autonomous.policy.monthlyBudgetPaise / 100 : null;
      this.syncCategoryBudgets();
    }
    const failure = [policy, negativeRequests, operations, autonomous].find((result) => result.status === 'rejected');
    if (failure?.status === 'rejected') {
      const error = failure.reason;
      this.error ||= error?.error?.error?.message ?? error?.error?.message ?? error?.message ?? 'Some supporting controls could not be loaded';
    }
  }

  async savePolicy() {
    this.savingPolicy = true; this.error = ''; this.notice = '';
    try {
      const response = await firstValueFrom(this.api.put<ApiEnvelope<InventoryPolicy>>('/inventory/policy', {
        ...this.policy,
        financialLockDate: this.policy.financialLockDate || null,
        ...(this.supportsCountValueVarianceThreshold ? { countValueVarianceThresholdPaise: this.toPaise(this.countValueVarianceThresholdRupees) ?? 0 } : {}),
        transferBaseTransportCostPaise: this.toPaise(this.transferBaseTransportRupees),
        transferCostPerKmPaise: this.toPaise(this.transferCostPerKmRupees),
        transferHandlingCostPerUnitPaise: this.toPaise(this.transferHandlingPerUnitRupees),
        transferDelayCostPerUnitDayPaise: this.toPaise(this.transferDelayPerUnitDayRupees),
      }));
      if (!response.data) throw new Error('Policy response was empty');
      this.policy = response.data; this.syncTransferCostInputs(); this.notice = this.language.text('inventory.message.b65d768d7a'); await this.reload();
    } catch (error: any) { this.error = error?.error?.error?.message ?? error?.message ?? 'Inventory policy could not be saved'; }
    finally { this.savingPolicy = false; }
  }

  setPriceDifferenceThreshold(value: number | string) {
    this.policy.priceDifferenceThresholdBps = Math.round(Number(value || 0) * 100);
  }

  async loadMasterData() {
    try {
      const response = await firstValueFrom(this.api.get<ApiEnvelope<InventoryMasterData>>('/inventory/master-data'));
      this.masterData = response.data ?? { values:[], units:[] };
    } catch (error:any) { this.error = error?.error?.error?.message ?? error?.message ?? 'Inventory master data could not be loaded'; }
  }
  editMasterValue(row:MasterValue) { this.masterDraft = { kind:row.kind, code:row.code, label:row.label, parentCode:row.parentCode, active:row.active }; }
  async saveMasterValue() {
    if (!this.masterDraft.code.trim() || !this.masterDraft.label.trim()) return;
    this.savingPolicy = true; this.error = ''; this.notice = '';
    try {
      await firstValueFrom(this.api.post('/inventory/master-data/values', { ...this.masterDraft, code:this.masterDraft.code.trim().toLowerCase(), label:this.titleCase(this.masterDraft.label) }));
      await this.loadMasterData(); this.notice = 'Inventory master saved';
    } catch (error:any) { this.error = error?.error?.error?.message ?? error?.message ?? 'Inventory master could not be saved'; }
    finally { this.savingPolicy = false; }
  }

  async reviewNegativeStock(row: NegativeStockRequest, decision: 'approve' | 'reject') {
    const reviewNote = decision === 'reject' ? await this.dialogs.prompt('Rejection reason', { required:true, multiline:true }) : '';
    if (decision === 'reject' && !reviewNote) return;
    this.savingPolicy = true; this.error = ''; try { await firstValueFrom(this.api.post(`/inventory/negative-stock-requests/${row.id}/review`, { decision, reviewNote: reviewNote || '' })); await this.reload(); this.notice = `Negative stock request ${decision}d`; } catch (error: any) { this.error = error?.error?.error?.message ?? error?.message ?? 'Request could not be reviewed'; } finally { this.savingPolicy = false; }
  }
  reviewException(row = this.filteredExceptions[0]) { this.openActionRoute(row); }
  openActionRoute(row?: { route?: string }) {
    if (!row?.route) { this.notice = ''; this.error = 'No action route available'; return; }
    void this.router.navigateByUrl(row.route);
  }
  async createApprovalRule() {
    const control = await this.dialogs.prompt('Approval control key', { defaultValue:'negativeStock', required:true });
    const role = await this.dialogs.prompt('Required role', { defaultValue:this.policy.approvalMatrix[control || ''] || 'owner', required:true });
    if (!control || !role) return;
    this.policy.approvalMatrix = { ...this.policy.approvalMatrix, [control]: role };
    await this.savePolicy();
  }
  reviewPendingApproval(row = this.controls.approvalMatrix.find((item) => item.pending > 0)) {
    this.openActionRoute(row);
  }
  openLockedItem(row = this.controls.auditLocks[0]) { this.openActionRoute(row); }
  resolveLock(row = this.controls.auditLocks[0]) { this.openActionRoute(row); }
  async createExpiryRescueAction() { await this.runAutomation(); }
  transferNearExpiryStock() { void this.router.navigate(['/inventory/transfers']); }
  async createClearanceAction() { await this.runAutomation(); }
  createDiscountOffer() { void this.router.navigate(['/marketing'], { queryParams: { section: 'offers', create: 1, source: 'dead-stock' } }); }
  async retryCommunication(id: string) {
    this.retryingJobId = id; this.error = ''; this.notice = '';
    try {
      await firstValueFrom(this.api.post(`/inventory/supplier-governance/communications/${id}/retry`, {}));
      await this.reload();
      this.notice = this.language.text('inventory.message.f61da9fdc6');
    } catch (error: any) { this.error = error?.error?.error?.message ?? error?.message ?? 'Communication could not be retried'; }
    finally { this.retryingJobId = ''; }
  }

  private toPaise(value: number | null) { return value === null ? null : Math.round(value * 100); }
  private syncTransferCostInputs() {
    this.countValueVarianceThresholdRupees = (this.policy.countValueVarianceThresholdPaise ?? 10_000) / 100;
    this.transferBaseTransportRupees = this.policy.transferBaseTransportCostPaise === null ? null : this.policy.transferBaseTransportCostPaise / 100;
    this.transferCostPerKmRupees = this.policy.transferCostPerKmPaise === null ? null : this.policy.transferCostPerKmPaise / 100;
    this.transferHandlingPerUnitRupees = this.policy.transferHandlingCostPerUnitPaise === null ? null : this.policy.transferHandlingCostPerUnitPaise / 100;
    this.transferDelayPerUnitDayRupees = this.policy.transferDelayCostPerUnitDayPaise === null ? null : this.policy.transferDelayCostPerUnitDayPaise / 100;
  }
  async saveAutomationPolicy() {
    this.automationBusy = true; this.error = ''; this.notice = '';
    try {
      const budgets = this.categoryBudgets
        .filter((row) => row.category.trim() && row.amountRupees !== null)
        .map((row) => [row.category.trim(), Math.round(Number(row.amountRupees) * 100)] as const);
      if (new Set(budgets.map(([category]) => category.toLowerCase())).size !== budgets.length) throw new Error('Category budgets must be unique');
      const categoryBudgetsPaise = Object.fromEntries(budgets);
      const payload = { ...this.autonomous.policy, monthlyBudgetPaise: Math.round(Number(this.automationBudgetRupees || 0) * 100), categoryBudgetsPaise };
      const response = await firstValueFrom(this.api.put<ApiEnvelope<AutonomousOperations>>('/inventory/autonomous-operations', payload));
      if (!response.data) throw new Error('Autonomous inventory response was empty');
      this.autonomous = response.data; this.automationBudgetRupees = response.data.policy.monthlyBudgetPaise / 100; this.syncCategoryBudgets(); this.notice = 'Autonomous inventory policy saved';
    } catch (error: any) { this.error = error?.error?.error?.message ?? error?.message ?? 'Autonomous inventory policy could not be saved'; }
    finally { this.automationBusy = false; }
  }
  addCategoryBudget() { this.categoryBudgets.push({ category:'', amountRupees:null }); }
  removeCategoryBudget(index: number) { this.categoryBudgets.splice(index, 1); }
  titleCase(value: string) { return value.toLowerCase().replace(/(^|\s)\S/g, (letter) => letter.toUpperCase()); }
  private syncCategoryBudgets() {
    this.categoryBudgets = Object.entries(this.autonomous.policy.categoryBudgetsPaise || {})
      .map(([category, amount]) => ({ category:this.titleCase(category), amountRupees:Number(amount) / 100 }));
  }
  async runAutomation() {
    if (!await this.dialogs.confirm('Run autonomous inventory checks now?')) return;
    this.automationBusy = true; this.error = ''; this.notice = '';
    try {
      const response = await firstValueFrom(this.api.post<ApiEnvelope<AutonomousOperations>>('/inventory/autonomous-operations/run', {}));
      if (response.data) this.autonomous = response.data;
      this.notice = 'Autonomous inventory checks completed'; await this.reload();
    } catch (error: any) { this.error = error?.error?.error?.message ?? error?.message ?? 'Autonomous inventory checks could not run'; }
    finally { this.automationBusy = false; }
  }
  async reviewAutomation(row: AutomationAction, decision: 'approve' | 'reject') {
    const reviewNote = decision === 'reject' ? await this.dialogs.prompt('Rejection reason', { required:true, multiline:true }) : '';
    if (decision === 'reject' && !reviewNote) return;
    if (!await this.dialogs.confirm(`${decision === 'approve' ? 'Approve' : 'Reject'} ${row.title}?`)) return;
    this.automationBusy = true; this.error = ''; this.notice = '';
    try {
      await firstValueFrom(this.api.post(`/inventory/autonomous-operations/actions/${row.id}/review`, { decision, reviewNote: reviewNote || '' }));
      await this.reload(); this.notice = `Automation action ${decision}d`;
    } catch (error: any) { this.error = error?.error?.error?.message ?? error?.message ?? 'Automation action could not be reviewed'; }
    finally { this.automationBusy = false; }
  }
  automationRoute(row: AutomationAction) {
    if (row.actionType === 'transfer_draft' || row.actionType === 'expiry_rescue') return '/inventory/transfers';
    if (row.actionType === 'po_draft') return '/purchase-orders';
    if (row.actionType === 'reconciliation') return '/inventory/gl-reconciliation';
    return '/inventory';
  }
  exportEvidence() {
    if (!this.canExportReports) { this.error = 'Report export permission is required'; return; }
    const rows = [
      ['Severity', 'Control', 'Exception', 'Value Paise', 'Evidence', 'Owner', 'Status'].map((value) => this.language.textValue(value)),
      ...this.filteredExceptions.map((row) => [row.severity, row.control, row.title, row.valuePaise, row.evidence, row.owner, row.status]),
    ];
    const csv = rows.map((row) => row.map((value) => this.csv(value)).join(',')).join('\r\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'inventory-control-evidence.csv';
    link.click();
    URL.revokeObjectURL(url);
  }

  money(paise: number) {
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format((Number(paise) || 0) / 100);
  }

  date(value?: string) {
    if (!value) return '—';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? '—' : new Intl.DateTimeFormat('en-GB').format(date);
  }

  private csv(value: unknown) {
    return `"${String(value ?? '').replace(/"/g, '""')}"`;
  }

  private emptyOperations(): OperationsHealth {
    return { queue: { queued:0, processing:0, retryScheduled:0, terminalFailed:0 }, invariants: { ledgerStockMismatch:0, negativeStock:0, ledgerSnapshotMissing:0, ledgerSnapshotMismatch:0, provenanceIncomplete:0, batchEvidenceMissing:0, trustedLedgerRows:0, reconstructedLedgerRows:0 }, failedJobs: [] };
  }
  private emptyAutonomous(): AutonomousOperations {
    return { persisted:false, policy:{ enabled:false, autoTransferDrafts:true, autoPoDrafts:true, monthlyBudgetPaise:0, categoryBudgetsPaise:{}, expiryRescueDays:30, runIntervalMinutes:1440, escalationMinutes:240, minConfidenceBps:7000, nextRunAt:'' }, actions:[], summary:{ pendingApproval:0, failed:0, completed:0, budgetCommittedPaise:0, pendingExpensePaise:0, availableCashPaise:0, budgetRemainingPaise:0 } };
  }
  private emptyControls(): AdvancedControls {
    return {
      summary: { critical: 0, warnings: 0, pendingApprovals: 0, expiryAlerts: null, deadStock: 0 },
      capabilities: { approvalMatrix: false, auditLocks: false, expiry: false, deadStock: false },
      exceptionRows: [], approvalMatrix: [], auditLocks: [], expiringRows: [], deadStockRows: [],
    };
  }
}
