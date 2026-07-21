import { CommonModule } from '@angular/common';
import { Component, OnInit, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { Observable, catchError, finalize, forkJoin, of } from 'rxjs';
import { AuthService } from '../../../core/services/auth.service';
import { ApiEnvelope, ApiService } from '../../../shared/services/api.service';
import { DatePickerComponent } from '../../../shared/date-picker/date-picker.component';

type Source = 'snapshot' | 'profit' | 'advanced' | 'dues' | 'actions' | 'inventory' | 'inventory-controls' | 'security' | 'staff' | 'payments' | 'payment-risk' | 'payment-providers' | 'franchise' | 'membership-settings' | 'multi-branch';

type DashboardSnapshot = {
  totalAppointments: number;
  todayAppointments: number;
  openAppointments: number;
  totalClients: number;
  totalServices: number;
  todaySalesPaise: number;
  openSales: number;
  recentCompletedAppointments: number;
};

type DueRecovery = {
  invoiceId: string;
  balancePaise: number;
};

type ProfitSummary = {
  metrics: {
    revenuePaise: number;
    costOfGoodsPaise: number;
    operatingExpensePaise: number;
    totalExpensePaise: number;
    netProfitPaise: number;
    netMarginBps: number;
  };
};

type ProfitDimension = {
  entityId: string;
  entityName: string;
  revenuePaise: number;
  netProfitPaise: number;
  marginBps: number;
};

type ProfitLeak = {
  kind: string;
  sourceId: string;
  title: string;
  message: string;
  impactPaise: number;
  severity: string;
};

type AdvancedProfit = {
  serviceProfit: ProfitDimension[];
  staffProfit: ProfitDimension[];
  leaks: ProfitLeak[];
};

type StaffPerformance = {
  staffId: string;
  staffName: string;
  score: number | null;
  revenuePaise: number;
  burnoutRisk?: { level: string };
  retentionRisk?: { level: string };
};

type StaffCommandCenter = {
  kpis: {
    staffCount: number;
    totalRevenuePaise: number;
    highRiskSignals: number;
    pendingApprovals: number;
    trainingDue: number;
  };
  topStaff: StaffPerformance[];
  attentionQueue: {
    riskSignals: StaffPerformance[];
    pendingApprovals: unknown[];
    dueTraining: unknown[];
  };
};

type ProfitAction = {
  id: string;
  title: string;
  message: string;
  impactPaise: number;
  priority: string;
  status: string;
};

type ReorderSuggestion = {
  productId: string;
  productName: string;
  currentStock: number;
  reorderLevel: number;
  suggestedQuantity: number;
  priority: string;
  estimatedValuePaise: number;
};

type InventoryControlException = {
  severity: string;
  control: string;
  title: string;
  valuePaise: number;
  status: string;
};

type InventoryAdvancedControls = {
  summary: {
    critical: number;
    warnings: number;
    pendingApprovals: number;
    expiryAlerts: number | null;
    deadStock: number;
  };
  exceptionRows: InventoryControlException[];
};

type SecuritySummary = {
  counts: {
    openAlerts: number;
    activeBlocks: number;
    activeSessions: number;
    auditEvents: number;
  };
  policy: {
    persisted: boolean;
    settings: {
      auditRetentionDays: number;
      auditPageSize: number;
      sessionRevocationEnabled: boolean;
    };
  };
};

type PaymentMode = {
  method: string;
  paymentCount: number;
  amountPaise: number;
  invoiceCount: number;
};

type PaymentRiskSummary = {
  caseCount: number;
  highRiskCount: number;
  amountAtRiskPaise: number;
  openCount: number;
};

type PaymentProvider = {
  provider: string;
  enabled: boolean;
  webhookConfigured: boolean;
  environment: string;
};

type Branch = {
  id: string;
  name: string;
  code: string;
  regionName: string;
  zoneName: string;
  clusterName: string;
  royaltyBps: number;
  royaltyMinimumPaise: number;
  active: boolean;
};

type RoyaltyStatement = {
  id: string;
  branchName: string;
  periodStart: string;
  royaltyPaise: number;
  status: string;
};

type FranchiseControls = {
  centralBranchId: string;
  allowedOverrideFields: string[];
  branches: Branch[];
  centralMasters: unknown[];
  centralProductMasters: unknown[];
  royaltyStatements: RoyaltyStatement[];
};

type MembershipSettings = {
  crossLocation?: {
    enabled?: boolean;
    acceptInbound?: boolean;
    scope?: string;
    allowDiscounts?: boolean;
    allowServiceCredits?: boolean;
  };
};

type BranchComparison = {
  branchId: string;
  branchName: string;
  branchCode: string;
  regionName: string;
  zoneName: string;
  clusterName: string;
  active: boolean;
  revenuePaise: number;
  discountPaise: number;
  taxPaise: number;
  refundPaise: number;
  tipPaise: number;
  averageTicketPaise: number;
  saleCount: number;
  appointmentCount: number;
  lostAppointmentCount: number;
  bookedMinutes: number;
  scheduledMinutes: number;
  utilizationBps: number;
  voidCount: number;
  cashVariancePaise: number;
  openTillCount: number;
  transferCount: number;
  shortageCount: number;
  inventoryValuePaise: number;
  membershipLiabilityPaise: number;
  membershipRedeemedPaise: number;
  crossLocationRedeemedPaise: number;
  giftCardLiabilityPaise: number;
  loyaltyPointsBalance: number;
  sharedCustomerCount: number;
  royaltyOutstandingPaise: number;
  sharingEnabled: boolean;
  acceptInbound: boolean;
  serviceSyncGap: number;
  productSyncGap: number;
};

type BranchConflict = {
  kind: string;
  branchId: string;
  branchName: string;
  severity: string;
  message: string;
};

type BranchApproval = {
  id: string;
  action: string;
  status: string;
  note: string;
  decisionNote: string;
  requestedBy: string;
  decidedBy?: string;
  version: number;
  createdAt: string;
};

type BranchAudit = {
  id: string;
  eventType: string;
  outcome: string;
  actorUserId?: string;
  createdAt: string;
  details?: {
    published?: number;
    before?: { serviceSyncGap?: number; productSyncGap?: number };
    after?: { serviceSyncGap?: number; productSyncGap?: number };
  };
};

type MultiBranchCommandCenter = {
  rangeStart: string;
  rangeEnd: string;
  summary: {
    branchCount: number;
    activeBranchCount: number;
    revenuePaise: number;
    discountPaise: number;
    taxPaise: number;
    refundPaise: number;
    tipPaise: number;
    averageTicketPaise: number;
    saleCount: number;
    appointmentCount: number;
    lostAppointmentCount: number;
    bookedMinutes: number;
    scheduledMinutes: number;
    utilizationBps: number;
    voidCount: number;
    cashVariancePaise: number;
    openTillCount: number;
    transferCount: number;
    shortageCount: number;
    inventoryValuePaise: number;
    membershipLiabilityPaise: number;
    membershipRedeemedPaise: number;
    crossLocationRedeemedPaise: number;
    giftCardLiabilityPaise: number;
    loyaltyPointsBalance: number;
    sharedCustomerCount: number;
    royaltyOutstandingPaise: number;
    syncGapCount: number;
    pendingApprovalCount: number;
    conflictCount: number;
  };
  comparisons: BranchComparison[];
  conflicts: BranchConflict[];
  approvals: BranchApproval[];
  audit: BranchAudit[];
};

const EMPTY_SNAPSHOT: DashboardSnapshot = {
  totalAppointments: 0,
  todayAppointments: 0,
  openAppointments: 0,
  totalClients: 0,
  totalServices: 0,
  todaySalesPaise: 0,
  openSales: 0,
  recentCompletedAppointments: 0,
};

@Component({
  selector: 'page-command-center',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, DatePickerComponent],
  templateUrl: './command-center-page.component.html',
  styleUrls: ['./command-center-page.component.css'],
})
export class CommandCenterPageComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly auth = inject(AuthService);

  snapshot = EMPTY_SNAPSHOT;
  profit: ProfitSummary | null = null;
  advancedProfit: AdvancedProfit | null = null;
  dues: DueRecovery[] = [];
  actions: ProfitAction[] = [];
  reorderSuggestions: ReorderSuggestion[] = [];
  inventoryControls: InventoryAdvancedControls | null = null;
  security: SecuritySummary | null = null;
  staff: StaffCommandCenter | null = null;
  paymentModes: PaymentMode[] = [];
  paymentRisk: PaymentRiskSummary | null = null;
  paymentProviders: PaymentProvider[] = [];
  franchise: FranchiseControls | null = null;
  membershipSettings: MembershipSettings | null = null;
  multiBranch: MultiBranchCommandCenter | null = null;
  locationStartDate = this.dateOffset(-29);
  locationEndDate = this.dateOffset(0);
  locationRegion = '';
  locationZone = '';
  locationCluster = '';
  locationBranchId = '';
  locationActionBusy = false;
  locationActionStatus = '';
  locationActionError = '';
  locationDrilldownKind = '';
  locationDrilldownRows: Array<Record<string, any>> = [];
  locationDrilldownLoading = false;
  staffError = '';
  healthStatus = 'checking';
  snapshotLoading = true;
  financeLoading = true;
  controlsLoading = true;
  staffLoading = true;
  paymentLoading = true;
  locationLoading = true;
  updatedAt: Date | null = null;
  readonly errors = new Set<Source>();

  ngOnInit(): void {
    this.refresh();
  }

  refresh(): void {
    this.errors.clear();
    this.loadSnapshot();
    this.loadFinance();
    this.loadControls();
    this.loadStaff();
    this.loadPayments();
    this.loadLocations();
  }

  get branchLabel(): string {
    return this.auth.branchName || this.auth.branchId || 'Branch scope';
  }

  get workspaceLabel(): string {
    return this.auth.hasRole('owner') ? 'Owner workspace' : 'Management workspace';
  }

  get canReadStaff(): boolean {
    return this.auth.hasRole('owner', 'admin', 'manager', 'accountant');
  }

  get canReadInventory(): boolean {
    return this.auth.hasRole('owner', 'admin', 'manager', 'analyst')
      || this.auth.hasPermission('inventory.read', 'inventory.manage', 'tenant.read');
  }

  get canReadPaymentControls(): boolean {
    return this.auth.hasRole('owner', 'admin', 'manager', 'analyst')
      || this.auth.hasPermission('pos.read', 'pos.manage', 'tenant.read');
  }

  get canReadSecurity(): boolean {
    return this.auth.hasRole('owner', 'admin', 'superadmin', 'super-admin')
      || this.auth.hasPermission('security.read', 'security.manage');
  }

  get canReadLocations(): boolean {
    return this.auth.hasRole('owner', 'admin', 'superadmin', 'super-admin')
      || this.auth.hasPermission('settings.manage', 'tenant.read');
  }

  get canManageLocations(): boolean {
    return this.auth.hasRole('owner')
      || this.auth.hasPermission('settings.manage', 'management.write');
  }

  get loading(): boolean {
    return this.snapshotLoading || this.financeLoading || this.controlsLoading || this.staffLoading || this.paymentLoading || this.locationLoading;
  }

  get liveState(): 'loading' | 'live' | 'partial' | 'unavailable' {
    if (this.loading && !this.updatedAt) return 'loading';
    if (this.errors.size === 0 && this.healthStatus === 'ok') return 'live';
    return this.updatedAt ? 'partial' : 'unavailable';
  }

  get liveStateLabel(): string {
    return ({ loading: 'Loading', live: 'Live data', partial: 'Partial data', unavailable: 'API unavailable' })[this.liveState];
  }

  get outstandingPaise(): number {
    return this.dues.reduce((total, row) => total + Number(row.balancePaise || 0), 0);
  }

  get openAlerts(): number {
    return this.security?.counts.openAlerts ?? 0;
  }

  get visibleActions(): ProfitAction[] {
    return this.actions.slice(0, 5);
  }

  get topProfitContributors(): ProfitDimension[] {
    return [...(this.advancedProfit?.serviceProfit ?? [])]
      .sort((left, right) => right.netProfitPaise - left.netProfitPaise)
      .slice(0, 5);
  }

  get topProfitLeaks(): ProfitLeak[] {
    return [...(this.advancedProfit?.leaks ?? [])]
      .sort((left, right) => right.impactPaise - left.impactPaise)
      .slice(0, 5);
  }

  get topStaff(): StaffPerformance[] {
    return (this.staff?.topStaff ?? []).slice(0, 5);
  }

  get topReorderSuggestions(): ReorderSuggestion[] {
    return this.reorderSuggestions.slice(0, 5);
  }

  get reorderValuePaise(): number {
    return this.reorderSuggestions.reduce((total, row) => total + Number(row.estimatedValuePaise || 0), 0);
  }

  get topInventoryExceptions(): InventoryControlException[] {
    return (this.inventoryControls?.exceptionRows ?? []).slice(0, 5);
  }

  get topPaymentModes(): PaymentMode[] {
    return [...this.paymentModes]
      .sort((left, right) => right.amountPaise - left.amountPaise)
      .slice(0, 5);
  }

  get collectedPaise(): number {
    return this.paymentModes.reduce((total, row) => total + Number(row.amountPaise || 0), 0);
  }

  get paymentCount(): number {
    return this.paymentModes.reduce((total, row) => total + Number(row.paymentCount || 0), 0);
  }

  get readyProviderCount(): number {
    return this.paymentProviders.filter((provider) => provider.enabled && provider.webhookConfigured).length;
  }

  get locationBranches(): Branch[] {
    return this.franchise?.branches ?? [];
  }

  get activeLocationCount(): number {
    return this.multiBranch?.summary.activeBranchCount
      ?? this.locationBranches.filter((branch) => branch.active).length;
  }

  get locationBranchCount(): number {
    return this.multiBranch?.summary.branchCount ?? this.locationBranches.length;
  }

  get centralLocation(): Branch | undefined {
    return this.locationBranches.find((branch) => branch.id === this.franchise?.centralBranchId);
  }

  get configuredRoyaltyCount(): number {
    return this.locationBranches.filter((branch) => branch.royaltyBps > 0 || branch.royaltyMinimumPaise > 0).length;
  }

  get missingHierarchyCount(): number {
    return this.locationBranches.filter((branch) => branch.active && !branch.regionName && !branch.zoneName && !branch.clusterName).length;
  }

  get openRoyaltyStatements(): RoyaltyStatement[] {
    return (this.franchise?.royaltyStatements ?? []).filter((statement) => statement.status !== 'paid');
  }

  get outstandingRoyaltyPaise(): number {
    return this.multiBranch?.summary.royaltyOutstandingPaise
      ?? this.openRoyaltyStatements.reduce((total, statement) => total + Number(statement.royaltyPaise || 0), 0);
  }

  get locationAttentionCount(): number {
    return (this.multiBranch?.conflicts.length ?? 0) + this.openRoyaltyStatements.length;
  }

  get branchComparisons(): BranchComparison[] {
    return this.multiBranch?.comparisons ?? [];
  }

  get locationConflicts(): BranchConflict[] {
    return this.multiBranch?.conflicts ?? [];
  }

  get pendingLocationApprovals(): BranchApproval[] {
    return (this.multiBranch?.approvals ?? []).filter((approval) => approval.status === 'pending');
  }

  get locationAudit(): BranchAudit[] {
    return (this.multiBranch?.audit ?? []).slice(0, 10);
  }

  get syncGapCount(): number {
    return this.multiBranch?.summary.syncGapCount
      ?? this.branchComparisons.reduce((total, branch) => total + branch.serviceSyncGap + branch.productSyncGap, 0);
  }

  get locationRegions(): string[] {
    return this.uniqueLocationValues('regionName');
  }

  get locationZones(): string[] {
    return this.uniqueLocationValues('zoneName', (branch) => !this.locationRegion || branch.regionName === this.locationRegion);
  }

  get locationClusters(): string[] {
    return this.uniqueLocationValues('clusterName', (branch) => (!this.locationRegion || branch.regionName === this.locationRegion)
      && (!this.locationZone || branch.zoneName === this.locationZone));
  }

  get filteredLocationBranches(): Branch[] {
    return this.locationBranches.filter((branch) => (!this.locationRegion || branch.regionName === this.locationRegion)
      && (!this.locationZone || branch.zoneName === this.locationZone)
      && (!this.locationCluster || branch.clusterName === this.locationCluster));
  }

  applyLocationFilters(): void {
    if (!this.locationStartDate || !this.locationEndDate || this.locationStartDate > this.locationEndDate) {
      this.locationActionError = 'Select a valid report date range';
      return;
    }
    this.locationActionError = '';
    this.loadLocations();
  }

  resetLocationFilters(): void {
    this.locationStartDate = this.dateOffset(-29);
    this.locationEndDate = this.dateOffset(0);
    this.locationRegion = '';
    this.locationZone = '';
    this.locationCluster = '';
    this.locationBranchId = '';
    this.loadLocations();
  }

  locationRegionChanged(): void {
    this.locationZone = '';
    this.locationCluster = '';
    this.locationBranchId = '';
  }

  locationZoneChanged(): void {
    this.locationCluster = '';
    this.locationBranchId = '';
  }

  locationClusterChanged(): void {
    this.locationBranchId = '';
  }

  get membershipSharingLabel(): string {
    if (this.errors.has('membership-settings')) return 'Unavailable';
    return this.membershipSettings?.crossLocation?.enabled ? 'Enabled' : 'Disabled';
  }

  get membershipInboundLabel(): string {
    if (this.errors.has('membership-settings')) return 'Unavailable';
    return this.membershipSettings?.crossLocation?.acceptInbound ? 'Enabled' : 'Disabled';
  }

  get membershipScopeLabel(): string {
    if (this.errors.has('membership-settings')) return 'Unavailable';
    return this.label(this.membershipSettings?.crossLocation?.scope || 'tenant');
  }

  branchHierarchy(branch: Branch): string {
    return [branch.regionName, branch.zoneName, branch.clusterName].filter(Boolean).join(' / ') || 'Not assigned';
  }

  royaltyRate(bps: number): string {
    return `${(Number(bps || 0) / 100).toFixed(2)}%`;
  }

  comparisonHierarchy(branch: BranchComparison): string {
    return [branch.regionName, branch.zoneName, branch.clusterName].filter(Boolean).join(' / ') || 'Not assigned';
  }

  conflictCount(branchId: string): number {
    return this.locationConflicts.filter((conflict) => conflict.branchId === branchId).length;
  }

  requestMasterSync(): void {
    if (!this.canManageLocations || this.locationActionBusy || this.pendingLocationApprovals.length || !this.franchise?.centralBranchId) return;
    if (!window.confirm('Request approval to publish central masters to active branches?')) return;
    this.locationActionBusy = true;
    this.locationActionStatus = '';
    this.locationActionError = '';
    this.api.post('/api/v1/settings/multi-branch/approvals', { note: '' })
      .pipe(finalize(() => (this.locationActionBusy = false)))
      .subscribe({
        next: () => { this.locationActionStatus = 'Approval requested'; this.loadLocations(); },
        error: (error) => { this.locationActionError = this.apiError(error, 'Unable to request approval'); },
      });
  }

  decideLocationApproval(approval: BranchApproval, decision: 'approved' | 'rejected'): void {
    if (!this.canManageLocations || this.locationActionBusy || approval.status !== 'pending') return;
    const note = decision === 'rejected' ? window.prompt('Rejection note (optional)', '') : '';
    if (note === null || !window.confirm(`${this.label(decision)} this central master publish request?`)) return;
    this.locationActionBusy = true;
    this.locationActionStatus = '';
    this.locationActionError = '';
    this.api.patch(`/api/v1/settings/multi-branch/approvals/${encodeURIComponent(approval.id)}`, {
      decision,
      version: approval.version,
      note,
    }).pipe(finalize(() => (this.locationActionBusy = false))).subscribe({
      next: () => { this.locationActionStatus = `Approval ${decision}`; this.loadLocations(); },
      error: (error) => { this.locationActionError = this.apiError(error, 'Unable to decide approval'); },
    });
  }

  exportLocation(format: 'csv' | 'xlsx' | 'pdf'): void {
    if (this.locationActionBusy) return;
    this.locationActionBusy = true;
    this.locationActionError = '';
    this.api.getBlob(`/api/v1/settings/multi-branch/export.${format}?${this.locationReportQuery()}`)
      .pipe(finalize(() => (this.locationActionBusy = false)))
      .subscribe({
        next: (blob) => {
          const url = URL.createObjectURL(blob);
          const link = document.createElement('a');
          link.href = url;
          link.download = `multi-branch-${this.locationStartDate}-${this.locationEndDate}.${format}`;
          link.click();
          URL.revokeObjectURL(url);
        },
        error: (error) => { this.locationActionError = this.apiError(error, 'Unable to export branch report'); },
      });
  }

  loadLocationDrilldown(kind: 'sales' | 'appointments' | 'refunds' | 'transfers' | 'membershipRedemptions' | 'registerClosings' | 'conflicts' | 'interBranchSettlements', branchId = ''): void {
    if (this.locationDrilldownLoading) return;
    const query = this.locationReportQuery();
    query.set('kind', kind);
    if (branchId) query.set('branchId', branchId);
    this.locationDrilldownKind = kind;
    this.locationDrilldownRows = [];
    this.locationDrilldownLoading = true;
    this.locationActionError = '';
    this.api.get<ApiEnvelope<Array<Record<string, any>>> | Array<Record<string, any>>>(`/api/v1/settings/multi-branch/drilldown?${query}`)
      .pipe(finalize(() => (this.locationDrilldownLoading = false)))
      .subscribe({
        next: (response) => { this.locationDrilldownRows = this.unwrap(response) ?? []; },
        error: (error) => { this.locationActionError = this.apiError(error, 'Unable to load drilldown'); },
      });
  }

  settleInterBranchRedemption(row: Record<string, any>): void {
    if (!this.canManageLocations || this.locationActionBusy || row['status'] !== 'open') return;
    const paymentMethod = window.prompt('Payment method: bank_transfer or cash', 'bank_transfer')?.trim().toLowerCase();
    if (!paymentMethod || !['bank_transfer', 'cash'].includes(paymentMethod)) return;
    const reference = window.prompt('Settlement reference', '')?.trim();
    if (!reference || !window.confirm(`Settle ${this.money(row['valuePaise'])} between these branches?`)) return;
    this.locationActionBusy = true;
    this.locationActionStatus = '';
    this.locationActionError = '';
    this.api.post(`/api/v1/settings/multi-branch/settlements/${encodeURIComponent(row['redemptionId'])}/settle`, {
      version: Number(row['version'] || 0), paymentMethod, settlementReference: reference,
    }).pipe(finalize(() => (this.locationActionBusy = false))).subscribe({
      next: () => {
        this.locationActionStatus = 'Inter-branch settlement completed';
        this.loadLocationDrilldown('interBranchSettlements', this.locationBranchId);
        this.loadLocations();
      },
      error: (error) => { this.locationActionError = this.apiError(error, 'Unable to settle inter-branch redemption'); },
    });
  }

  closeLocationDrilldown(): void {
    this.locationDrilldownKind = '';
    this.locationDrilldownRows = [];
  }

  money(paise: number): string {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      maximumFractionDigits: 0,
    }).format(Number(paise || 0) / 100);
  }

  margin(bps: number): string {
    return `${(Number(bps || 0) / 100).toFixed(1)}%`;
  }

  label(value: string): string {
    return String(value || 'Unknown').replace(/[-_]/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
  }

  updatedLabel(): string {
    return this.updatedAt
      ? new Intl.DateTimeFormat('en-GB', {
          day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
        }).format(this.updatedAt)
      : 'Not updated';
  }

  private loadSnapshot(): void {
    this.snapshotLoading = true;
    this.optional('snapshot', this.api.get<ApiEnvelope<DashboardSnapshot> | DashboardSnapshot>('/api/v1/reports/dashboard'))
      .pipe(finalize(() => (this.snapshotLoading = false))).subscribe((snapshot) => {
        this.healthStatus = snapshot ? 'ok' : 'unavailable';
        this.snapshot = this.unwrap(snapshot) ?? EMPTY_SNAPSHOT;
        if (snapshot) this.touch();
      });
  }

  private loadFinance(): void {
    this.financeLoading = true;
    const query = new URLSearchParams({ fromDate: this.dateOffset(-29), toDate: this.dateOffset(0), scope: 'branch' });
    forkJoin({
      profit: this.optional('profit', this.api.get<ApiEnvelope<ProfitSummary> | ProfitSummary>(`/api/v1/profit-intelligence/summary?${query}`)),
      advanced: this.optional('advanced', this.api.get<ApiEnvelope<AdvancedProfit> | AdvancedProfit>(`/api/v1/profit-intelligence/advanced?${query}`)),
      dues: this.optional('dues', this.api.get<ApiEnvelope<DueRecovery[]> | DueRecovery[]>('/api/v1/reports/due-recovery')),
    }).pipe(finalize(() => (this.financeLoading = false))).subscribe(({ profit, advanced, dues }) => {
      this.profit = this.unwrap(profit) ?? null;
      this.advancedProfit = this.unwrap(advanced) ?? null;
      this.dues = this.unwrap(dues) ?? [];
      if (profit || advanced || dues) this.touch();
    });
  }

  private loadControls(): void {
    this.controlsLoading = true;
    forkJoin({
      actions: this.optional('actions', this.api.get<ApiEnvelope<ProfitAction[]> | ProfitAction[]>('/api/v1/profit-intelligence/actions?status=active&priority=high&limit=200')),
      inventory: this.canReadInventory
        ? this.optional('inventory', this.api.get<ApiEnvelope<ReorderSuggestion[]> | ReorderSuggestion[]>('/api/v1/inventory/reorder-suggestions'))
        : of(null),
      inventoryControls: this.canReadInventory
        ? this.optional('inventory-controls', this.api.get<ApiEnvelope<InventoryAdvancedControls> | InventoryAdvancedControls>('/api/v1/inventory/advanced-controls'))
        : of(null),
      security: this.canReadSecurity
        ? this.optional('security', this.api.get<ApiEnvelope<SecuritySummary> | SecuritySummary>('/api/v1/security/summary'))
        : of(null),
    }).pipe(finalize(() => (this.controlsLoading = false))).subscribe(({ actions, inventory, inventoryControls, security }) => {
      this.actions = this.unwrap(actions) ?? [];
      this.reorderSuggestions = this.unwrap(inventory) ?? [];
      this.inventoryControls = this.unwrap(inventoryControls) ?? null;
      this.security = this.unwrap(security) ?? null;
      if (actions || inventory || inventoryControls || security) this.touch();
    });
  }

  private loadStaff(): void {
    if (!this.canReadStaff) {
      this.staffLoading = false;
      this.staff = null;
      return;
    }
    this.staffLoading = true;
    this.staffError = '';
    const query = new URLSearchParams({ periodStart: this.dateOffset(-29), periodEnd: this.dateOffset(0) });
    this.api.get<ApiEnvelope<StaffCommandCenter> | StaffCommandCenter>(`/api/v1/staff-enterprise/command-center?${query}`)
      .pipe(finalize(() => (this.staffLoading = false)))
      .subscribe({
        next: (response) => {
          this.staff = this.unwrap(response) ?? null;
          this.touch();
        },
        error: (error) => {
          this.errors.add('staff');
          this.staff = null;
          this.staffError = error?.error?.error?.message ?? error?.error?.message ?? 'Staff data unavailable';
        },
      });
  }

  private loadPayments(): void {
    this.paymentLoading = true;
    const range = new URLSearchParams({ startDate: this.dateOffset(-29), endDate: this.dateOffset(0) });
    const riskRange = new URLSearchParams({ from: this.dateOffset(-29), to: this.dateOffset(0) });
    forkJoin({
      payments: this.optional('payments', this.api.get<ApiEnvelope<PaymentMode[]> | PaymentMode[]>(`/api/v1/reports/payment-modes?${range}`)),
      risk: this.canReadPaymentControls
        ? this.optional('payment-risk', this.api.get<ApiEnvelope<PaymentRiskSummary> | PaymentRiskSummary>(`/api/v1/pos/fraud-summary?${riskRange}`))
        : of(null),
      providers: this.canReadPaymentControls
        ? this.optional('payment-providers', this.api.get<ApiEnvelope<PaymentProvider[]> | PaymentProvider[]>('/api/v1/pos/payment-providers'))
        : of(null),
    }).pipe(finalize(() => (this.paymentLoading = false))).subscribe(({ payments, risk, providers }) => {
      this.paymentModes = this.unwrap(payments) ?? [];
      this.paymentRisk = this.unwrap(risk) ?? null;
      this.paymentProviders = this.unwrap(providers) ?? [];
      if (payments || risk || providers) this.touch();
    });
  }

  private loadLocations(): void {
    if (!this.canReadLocations) {
      this.locationLoading = false;
      this.franchise = null;
      this.membershipSettings = null;
      this.multiBranch = null;
      return;
    }
    this.locationLoading = true;
    this.errors.delete('franchise');
    this.errors.delete('membership-settings');
    this.errors.delete('multi-branch');
    const reportQuery = this.locationReportQuery();
    forkJoin({
      franchise: this.optional('franchise', this.api.get<ApiEnvelope<FranchiseControls> | FranchiseControls>('/api/v1/settings/franchise-controls')),
      membership: this.optional('membership-settings', this.api.get<ApiEnvelope<MembershipSettings> | MembershipSettings>('/api/v1/membership-enterprise/settings')),
      commandCenter: this.optional('multi-branch', this.api.get<ApiEnvelope<MultiBranchCommandCenter> | MultiBranchCommandCenter>(`/api/v1/settings/multi-branch/command-center?${reportQuery}`)),
    }).pipe(finalize(() => (this.locationLoading = false))).subscribe(({ franchise, membership, commandCenter }) => {
      this.franchise = this.unwrap(franchise) ?? null;
      this.membershipSettings = this.unwrap(membership) ?? null;
      this.multiBranch = this.unwrap(commandCenter) ?? null;
      if (franchise || membership || commandCenter) this.touch();
    });
  }

  private apiError(error: any, fallback: string): string {
    return error?.error?.error?.message ?? error?.error?.message ?? error?.message ?? fallback;
  }

  private locationReportQuery(): URLSearchParams {
    const query = new URLSearchParams({ startDate: this.locationStartDate, endDate: this.locationEndDate });
    if (this.locationRegion) query.set('region', this.locationRegion);
    if (this.locationZone) query.set('zone', this.locationZone);
    if (this.locationCluster) query.set('cluster', this.locationCluster);
    if (this.locationBranchId) query.set('branchId', this.locationBranchId);
    return query;
  }

  private optional<T>(source: Source, request: Observable<T>): Observable<T | null> {
    return request.pipe(catchError(() => {
      this.errors.add(source);
      return of(null);
    }));
  }

  private unwrap<T>(response: ApiEnvelope<T> | T | null): T | undefined {
    if (response == null) return undefined;
    if (typeof response === 'object' && 'data' in response) return (response as ApiEnvelope<T>).data;
    return response as T;
  }

  private touch(): void {
    this.updatedAt = new Date();
  }

  private uniqueLocationValues(
    field: 'regionName' | 'zoneName' | 'clusterName',
    predicate: (branch: Branch) => boolean = () => true,
  ): string[] {
    return [...new Set(this.locationBranches.filter(predicate).map((branch) => branch[field]).filter(Boolean))]
      .sort((left, right) => left.localeCompare(right));
  }

  private dateOffset(offset: number): string {
    const value = new Date();
    value.setDate(value.getDate() + offset);
    return value.toISOString().slice(0, 10);
  }
}
