import { CommonModule } from '@angular/common';
import { Component, OnInit, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { Observable, catchError, finalize, forkJoin, of, tap } from 'rxjs';
import { AuthService } from '../../../core/services/auth.service';
import { ApiEnvelope, ApiService } from '../../../shared/services/api.service';
import { DatePickerComponent } from '../../../shared/date-picker/date-picker.component';

type Source = 'snapshot' | 'profit' | 'advanced' | 'dues' | 'appointments' | 'actions' | 'action-audit' | 'inventory-command' | 'payments' | 'payment-risk' | 'payment-providers' | 'franchise' | 'membership-settings' | 'multi-branch' | 'growth' | 'ai-workforce' | 'forecast-revenue' | 'forecast-stock' | 'forecast-demand' | 'forecast-no-show' | 'briefing' | 'branch-anomaly';
type ForecastKind = 'revenue_forecast' | 'inventory_reorder_risk' | 'service_demand' | 'no_show_risk';

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

type AppointmentGroup = {
  count: number;
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

type ProfitAction = {
  id: string;
  approvalId?: string | null;
  actionType: string;
  title: string;
  message: string;
  impactPaise: number;
  priority: string;
  status: string;
  sourceType: string;
  sourceId: string;
  ownerUserId?: string | null;
  ownerName?: string | null;
  dueAt?: string | null;
  slaMinutes?: number | null;
  evidenceJson?: Record<string, unknown>;
  expectedImpactPaise: number;
  realizedImpactPaise: number;
  payloadJson?: Record<string, unknown>;
  createdByUserId: string;
  updatedAt: string;
  completedAt?: string | null;
  dismissedAt?: string | null;
};

type PriorityAction = {
  id: string;
  source: string;
  title: string;
  message: string;
  priority: string;
  metric: string;
  impactPaise: number;
  route: string;
  sourceType: string;
  sourceId: string;
  ownerName?: string | null;
  dueAt?: string | null;
  slaMinutes?: number | null;
  status?: string;
  managedActionId?: string;
  createdByUserId?: string;
  expectedImpact: string;
};

type Prediction = {
  subjectKind: string;
  subjectId: string;
  subjectName: string;
  lowerValue: number;
  upperValue: number;
  unit: string;
  confidence: string;
  sampleSize: number;
  dataSufficient: boolean;
  signals: string[];
};

type PredictionRun = {
  runId: string;
  kind: ForecastKind;
  modelVersion: string;
  computedBy: string;
  historyStart: string;
  historyEnd: string;
  predictions: Prediction[];
  insufficientSubjects: number;
  basis: string;
  disclaimer: string;
};

type BriefingSection = {
  signal: string;
  headline: string;
  whyItMatters: string;
  evidence: string[];
  recommendedAction: string;
  expectedImpact: string;
  openReportLink: string;
  confidence: string;
  source: string;
  period: string;
};

type AiBriefing = {
  generatedAt: string;
  sections: BriefingSection[];
  suppressed: string[];
  quiet: boolean;
  automationActive: boolean;
  scanIntervalMinutes: number;
};

type AiWorkforceSummary = {
  enabled: boolean;
  status: string;
  agents: Array<{ key: string; name: string; purpose: string; evidenceSources: string[]; actionOwnerUserId: string; status: string }>;
  metrics: { requestCount30d: number; deniedCount30d: number; predictionCount30d: number; openRecommendations: number; recommendationOwnerGaps: number; recommendationEvidenceGaps: number };
  latestEvaluation: { suiteVersion: string; unsafePromptTestsPassed: boolean; hallucinationTestsPassed: boolean; unauthorizedActionTestsPassed: boolean; baselineMetricBps: number | null; observedMetricBps: number | null; sampleSize: number; createdAt: string } | null;
};

type BranchAnomaly = {
  branchId: string;
  branchName: string;
  headline: string;
  confidence: string;
  evidence: string[];
};

type GovernanceAuditEvent = {
  id: string;
  eventType: string;
  actorUserId: string;
  detailsJson: Record<string, unknown>;
  createdAt: string;
};

type InventoryCommandSignal = {
  key: string;
  group: 'stock' | 'flow' | 'governance';
  label: string;
  detail: string;
  severity: string;
  metric: 'money' | 'count' | 'percent';
  metricValue: number;
  route: string;
  actionLabel: string;
};

type InventoryExceptionRecommendation = {
  key: string;
  category: string;
  evidenceHash: string;
  severity: string;
  title: string;
  explanation: string;
  recommendedAction: string;
  confidenceBps: number;
  evidence: Record<string, unknown>;
  route: string;
  approval: { required: boolean; status: string; mode: string; route: string; reviewedBy?: string; reviewedAt?: string; reviewNote: string };
};

type InventoryTransferOptimization = {
  sourceBranchId: string;
  sourceBranchName: string;
  destinationBranchId: string;
  destinationBranchName: string;
  sourceInventoryItemId: string;
  destinationInventoryItemId: string;
  productName: string;
  sku: string;
  suggestedQuantity: number;
  sourceStockQuantity: number;
  sourceSafeQuantity: number;
  destinationStockQuantity: number;
  destinationTargetQuantity: number;
  coverageTargetDays: number;
  sourceCoverageDaysAfter?: number;
  destinationCoverageDaysAfter?: number;
  earliestBatchNumber?: string;
  earliestExpiryDate?: string;
  distanceKm?: number;
  stockTransferCostPaise?: number;
  transportCostPaise?: number;
  handlingCostPaise?: number;
  delayCostPaise?: number;
  estimatedTransferCostPaise?: number;
  estimatedPurchaseCostPaise?: number;
  savingsPaise?: number;
  costDecision: string;
  sourceSafe: boolean;
  ownerApprovalRequired: boolean;
  approvalReason: string;
};

type InventoryCommandCenter = {
  summary: {
    totalStockValuePaise: number;
    stockoutRisk: number;
    overstockRisk: number;
    expiryRisk: number;
    deadStock: number;
    openPurchaseOrders: number;
    inTransitStock: number;
    consumptionVarianceQuantity: number;
    consumptionVarianceBps: number;
    auditExceptions: number;
    glMismatchPaise: number;
    pendingApprovals: number;
    supplierRisk: number;
    transferOpportunities: number;
  };
  signals: InventoryCommandSignal[];
  recommendations: InventoryExceptionRecommendation[];
  transferOpportunities: InventoryTransferOptimization[];
  generatedAt: string;
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

type GrowthIntelligence = {
  owner: {
    revenue30dPaise: number;
    todayAppointments: number;
    openAppointments: number;
    openDueCount: number;
    outstandingPaise: number;
    lowStockCount: number;
    activeStaffCount: number;
    activeClientCount: number;
    attentionCount: number;
  };
  revenueLeaks: Array<{
    kind: string;
    title: string;
    message: string;
    impactPaise: number;
    severity: string;
    nextAction: string;
  }>;
  clientMemory: Array<{
    clientId: string;
    clientName: string;
    visitCount: number;
    revenuePaise: number;
    lastVisitAt?: string | null;
    noShowCount: number;
    cancellationCount: number;
    riskScore: number;
    nextAction: string;
  }>;
  campaignPlanner: Array<{
    key: string;
    title: string;
    segmentKey: string;
    audienceCount: number;
    draftCount: number;
    approvedCount: number;
    actionLabel: string;
  }>;
  staffCoach: Array<{
    staffId: string;
    staffName: string;
    revenuePaise: number;
    serviceCount: number;
    activeGoalCount: number;
    noShowCount: number;
    priority: string;
    coachingFocus: string;
    opportunities: Array<{
      key: string;
      title: string;
      reason: string;
      suggestedAction: string;
      ownerStaffId: string;
      ownerStaffName: string;
      metricUnit: string;
      currentValue: number;
      targetValue: number;
      projectedImpactPaise: number;
      deadline: string;
      priority: string;
      status: string;
      goalId?: string | null;
      actionId?: string | null;
      actionStatus?: string | null;
      baselineValue?: number | null;
      actualValue: number;
      actualImpactPaise?: number | null;
    }>;
  }>;
  digitalTwin: Array<{
    key: string;
    title: string;
    metricLabel: string;
    metricValue: number;
    impactPaise: number;
    recommendation: string;
  }>;
  generatedAt: string;
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

const FORECASTS: Array<{ kind: ForecastKind; source: Source; label: string }> = [
  { kind: 'revenue_forecast', source: 'forecast-revenue', label: 'Revenue forecast' },
  { kind: 'inventory_reorder_risk', source: 'forecast-stock', label: 'Stock forecast' },
  { kind: 'service_demand', source: 'forecast-demand', label: 'Demand forecast' },
  { kind: 'no_show_risk', source: 'forecast-no-show', label: 'No-show forecast' },
];

const API_SOURCES: Array<{ source: Source; label: string; endpoint: string; access?: 'inventory' | 'payments' | 'locations' | 'ai' | 'governance' }> = [
  { source: 'snapshot', label: 'Executive dashboard', endpoint: '/api/v1/reports/dashboard' },
  { source: 'profit', label: 'Profit summary', endpoint: '/api/v1/profit-intelligence/summary' },
  { source: 'advanced', label: 'Profit intelligence', endpoint: '/api/v1/profit-intelligence/advanced' },
  { source: 'dues', label: 'Due recovery', endpoint: '/api/v1/reports/due-recovery' },
  { source: 'appointments', label: 'Appointment report', endpoint: '/api/v1/reports/appointments' },
  { source: 'actions', label: 'Profit actions', endpoint: '/api/v1/profit-intelligence/actions' },
  { source: 'action-audit', label: 'Action audit', endpoint: '/api/v1/profit-intelligence/governance/audit', access: 'governance' },
  { source: 'inventory-command', label: 'Inventory command', endpoint: '/api/v1/inventory/command-center', access: 'inventory' },
  { source: 'payments', label: 'Payment modes', endpoint: '/api/v1/reports/payment-modes' },
  { source: 'payment-risk', label: 'Payment risk', endpoint: '/api/v1/pos/fraud-summary', access: 'payments' },
  { source: 'payment-providers', label: 'Payment providers', endpoint: '/api/v1/pos/payment-providers', access: 'payments' },
  { source: 'franchise', label: 'Franchise controls', endpoint: '/api/v1/settings/franchise-controls', access: 'locations' },
  { source: 'membership-settings', label: 'Sharing settings', endpoint: '/api/v1/membership-enterprise/settings', access: 'locations' },
  { source: 'multi-branch', label: 'Multi-branch report', endpoint: '/api/v1/settings/multi-branch/command-center', access: 'locations' },
  { source: 'growth', label: 'Growth intelligence', endpoint: '/api/v1/reports/growth-intelligence' },
  { source: 'ai-workforce', label: 'Governed AI workforce', endpoint: '/api/v1/ai/workforce', access: 'ai' },
  ...FORECASTS.map(({ kind, source, label }) => ({ source, label, endpoint: `/api/v1/ai/predictions/${kind}/latest`, access: 'ai' as const })),
  { source: 'briefing', label: 'AI risk briefing', endpoint: '/api/v1/ai/briefing/daily', access: 'ai' },
  { source: 'branch-anomaly', label: 'Branch anomaly comparison', endpoint: '/api/v1/ai/briefing/compare', access: 'ai' },
];

@Component({
    selector: 'page-command-center',
    imports: [CommonModule, FormsModule, RouterLink, DatePickerComponent],
    templateUrl: './command-center-page.component.html',
    styleUrls: ['./command-center-page.component.css']
})
export class CommandCenterPageComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly auth = inject(AuthService);

  snapshot = EMPTY_SNAPSHOT;
  profit: ProfitSummary | null = null;
  advancedProfit: AdvancedProfit | null = null;
  dues: DueRecovery[] = [];
  appointmentGroups: AppointmentGroup[] = [];
  actions: ProfitAction[] = [];
  actionAudit: GovernanceAuditEvent[] = [];
  actionBusy = '';
  actionStatus = '';
  actionError = '';
  inventoryCommand: InventoryCommandCenter | null = null;
  inventoryRecommendationBusy = '';
  inventoryRecommendationError = '';
  paymentModes: PaymentMode[] = [];
  paymentRisk: PaymentRiskSummary | null = null;
  paymentProviders: PaymentProvider[] = [];
  franchise: FranchiseControls | null = null;
  membershipSettings: MembershipSettings | null = null;
  multiBranch: MultiBranchCommandCenter | null = null;
  growth: GrowthIntelligence | null = null;
  forecasts: Partial<Record<ForecastKind, PredictionRun | null>> = {};
  workforce: AiWorkforceSummary | null = null;
  briefing: AiBriefing | null = null;
  branchAnomalies: BranchAnomaly[] = [];
  branchSignal = 'margin_movement';
  readonly branchSignals = [
    ['margin_movement', 'Margin movement'], ['service_decline', 'Service demand'],
    ['staff_performance', 'Staff performance'], ['client_churn_opportunity', 'Client churn'],
    ['membership_expiry', 'Membership expiry'], ['stock_risk', 'Stock risk'],
    ['offer_performance', 'Offer performance'],
  ];
  intelligenceLoading = true;
  forecastRunning = false;
  intelligenceError = '';
  branchAnomalyLoading = true;
  locationStartDate = this.dateOffset(-29);
  locationEndDate = this.dateOffset(0);
  locationRegion = '';
  locationZone = '';
  locationCluster = '';
  locationBranchId = '';
  locationActionBusy = false;
  locationActionStatus = '';
  locationActionError = '';
  growthActionBusy = false;
  growthActionStatus = '';
  growthActionError = '';
  locationDrilldownKind = '';
  locationDrilldownRows: Array<Record<string, any>> = [];
  locationDrilldownLoading = false;
  healthStatus = 'checking';
  snapshotLoading = true;
  financeLoading = true;
  controlsLoading = true;
  paymentLoading = true;
  locationLoading = true;
  growthLoading = true;
  updatedAt: Date | null = null;
  apiStatusOpen = false;
  readonly errors = new Set<Source>();
  readonly sourceUpdatedAt = new Map<Source, Date>();

  ngOnInit(): void {
    this.refresh();
  }

  refresh(): void {
    this.errors.clear();
    this.loadSnapshot();
    this.loadFinance();
    this.loadControls();
    this.loadPayments();
    this.loadLocations();
    this.loadGrowth();
    this.loadIntelligence();
    this.loadBranchAnomalies();
  }

  get branchLabel(): string {
    return this.auth.branchName || 'Branch scope';
  }

  get workspaceLabel(): string {
    return this.auth.hasRole('owner') ? 'Owner workspace' : 'Management workspace';
  }

  get canReadInventory(): boolean {
    return this.auth.hasRole('owner', 'admin', 'manager', 'analyst')
      || this.auth.hasPermission('inventory.read', 'inventory.manage', 'tenant.read');
  }

  get canApproveInventory(): boolean {
    return this.auth.hasRole('owner', 'admin') || this.auth.hasPermission('inventory.approve');
  }

  get canReadPaymentControls(): boolean {
    return this.auth.hasRole('owner', 'admin', 'manager', 'analyst')
      || this.auth.hasPermission('pos.read', 'pos.manage', 'tenant.read');
  }

  get canReadLocations(): boolean {
    return this.auth.hasRole('owner', 'admin', 'superadmin', 'super-admin')
      || this.auth.hasPermission('settings.manage', 'tenant.read');
  }

  get canManageLocations(): boolean {
    return this.auth.hasRole('owner')
      || this.auth.hasPermission('settings.manage', 'management.write');
  }

  get canReadAi(): boolean {
    return this.auth.hasRole('owner', 'admin', 'manager', 'staff', 'frontdesk', 'receptionist', 'accountant', 'analyst', 'inventorymanager')
      || this.auth.hasPermission('ai.concierge.read', 'reports.read', 'clients.read', 'staff.analytics.read', 'memberships.read', 'pos.read');
  }

  get canManageProfitActions(): boolean {
    return this.auth.hasRole('owner', 'admin', 'manager');
  }

  get loading(): boolean {
    return this.snapshotLoading || this.financeLoading || this.controlsLoading || this.paymentLoading || this.locationLoading || this.growthLoading || this.intelligenceLoading || this.branchAnomalyLoading;
  }

  get liveState(): 'loading' | 'live' | 'partial' | 'unavailable' {
    if (this.loading && !this.updatedAt) return 'loading';
    if (this.errors.size === 0 && this.healthStatus === 'ok') return 'live';
    return this.updatedAt ? 'partial' : 'unavailable';
  }

  get liveStateLabel(): string {
    return ({ loading: 'Checking APIs', live: 'All APIs connected', partial: `${this.errors.size} APIs unavailable`, unavailable: 'APIs unavailable' })[this.liveState];
  }

  get apiStatusRows(): Array<{ source: Source; label: string; endpoint: string; state: 'connected' | 'refreshing' | 'unavailable' | 'waiting'; updatedAt: Date | null }> {
    return API_SOURCES.filter(({ access }) => !access
      || (access === 'inventory' && this.canReadInventory)
      || (access === 'payments' && this.canReadPaymentControls)
      || (access === 'locations' && this.canReadLocations)
      || (access === 'ai' && this.canReadAi)
      || (access === 'governance' && this.canManageProfitActions))
      .map(({ source, label, endpoint }) => ({
        source,
        label,
        endpoint,
        state: this.errors.has(source) ? 'unavailable' : this.sourceLoading(source) ? 'refreshing' : this.sourceUpdatedAt.has(source) ? 'connected' : 'waiting',
        updatedAt: this.sourceUpdatedAt.get(source) ?? null,
      }));
  }

  get connectedApiCount(): number {
    return this.apiStatusRows.filter(({ state }) => state === 'connected').length;
  }

  get outstandingPaise(): number {
    return this.dues.reduce((total, row) => total + Number(row.balancePaise || 0), 0);
  }

  get appointmentCount30Days(): number {
    return this.appointmentGroups.reduce((total, row) => total + Number(row.count || 0), 0);
  }

  get priorityQueueLoading(): boolean {
    return this.controlsLoading || this.paymentLoading || this.locationLoading || this.growthLoading;
  }

  get prioritizedActions(): PriorityAction[] {
    const persistedSources = new Set(this.actions.map((action) => `${action.sourceType}:${action.sourceId}`));
    const paymentRisk = this.paymentRisk?.openCount
      ? [{
          id: 'payment-risk', source: 'Payments', title: 'Review payment risk cases',
          message: `${this.paymentRisk.highRiskCount} high-risk of ${this.paymentRisk.openCount} open cases`,
          priority: this.paymentRisk.highRiskCount ? 'critical' : 'high',
          metric: this.paymentRisk.amountAtRiskPaise ? this.money(this.paymentRisk.amountAtRiskPaise) : `${this.paymentRisk.openCount} cases`,
          impactPaise: this.paymentRisk.amountAtRiskPaise, route: '/pos/enterprise', sourceType: 'payment', sourceId: 'open-risk-cases',
          expectedImpact: this.paymentRisk.amountAtRiskPaise ? `${this.money(this.paymentRisk.amountAtRiskPaise)} protected` : 'Reduce unresolved payment risk',
        } satisfies PriorityAction]
      : [];
    const items: PriorityAction[] = [
      ...this.actions.filter((action) => ['pending', 'approved'].includes(action.status)).map((action) => ({
        id: `profit-${action.id}`, source: this.label(action.sourceType), title: action.title, message: action.message,
        priority: action.priority, metric: this.money(action.expectedImpactPaise || action.impactPaise), impactPaise: action.expectedImpactPaise || action.impactPaise,
        route: this.safeActionRoute(action.payloadJson?.['route'], '/reports/profit-intelligence'), sourceType: action.sourceType, sourceId: action.sourceId,
        ownerName: action.ownerName, dueAt: action.dueAt, slaMinutes: action.slaMinutes, status: action.status,
        managedActionId: action.id, createdByUserId: action.createdByUserId,
        expectedImpact: action.expectedImpactPaise ? `${this.money(action.expectedImpactPaise)} expected` : 'Impact will be recorded on completion',
      })),
      ...(this.inventoryCommand?.signals ?? [])
        .filter((signal) => signal.metricValue > 0 && signal.severity !== 'healthy')
        .map((signal) => ({ id: `inventory-${signal.key}`, source: 'Inventory', title: signal.label, message: signal.detail, priority: signal.severity, metric: this.inventorySignalValue(signal), impactPaise: signal.metric === 'money' ? signal.metricValue : 0, route: signal.route, sourceType: 'inventory', sourceId: signal.key, expectedImpact: signal.actionLabel || 'Reduce inventory exposure' })),
      ...paymentRisk,
      ...this.locationConflicts.map((conflict, index) => ({ id: `location-${conflict.branchId}-${conflict.kind}-${index}`, source: 'Locations', title: `${conflict.branchName || 'Network'} · ${this.label(conflict.kind)}`, message: conflict.message, priority: conflict.severity, metric: this.label(conflict.severity), impactPaise: 0, route: '/settings', sourceType: 'location', sourceId: `${conflict.branchId || 'network'}:${conflict.kind}`, expectedImpact: 'Restore branch configuration consistency' })),
      ...(this.growth?.revenueLeaks ?? []).map((leak, index) => ({ id: `growth-${leak.kind}-${index}`, source: 'Growth', title: leak.title, message: leak.message, priority: leak.severity, metric: this.money(leak.impactPaise), impactPaise: leak.impactPaise, route: '/reports/profit-intelligence', sourceType: 'growth', sourceId: `${leak.kind}:${index}`, expectedImpact: leak.impactPaise ? `${this.money(leak.impactPaise)} recovery opportunity` : leak.nextAction })),
    ];
    const priority = (value: string) => ({ critical: 4, high: 3, medium: 2, warning: 2, low: 1 }[String(value || '').toLowerCase()] ?? 0);
    return items.filter((action) => action.managedActionId || !persistedSources.has(`${action.sourceType}:${action.sourceId}`))
      .sort((left, right) => priority(right.priority) - priority(left.priority) || right.impactPaise - left.impactPaise).slice(0, 8);
  }

  get recentActionHistory(): ProfitAction[] {
    return this.actions.filter((action) => ['completed', 'dismissed'].includes(action.status)).slice(0, 5);
  }

  get forecastCards(): Array<{ kind: ForecastKind; label: string; run: PredictionRun | null; prediction?: Prediction }> {
    return FORECASTS.map(({ kind, label }) => {
      const run = this.forecasts[kind] ?? null;
      const sufficient = (run?.predictions ?? []).filter((prediction) => prediction.dataSufficient);
      const prediction = [...sufficient].sort((left, right) => kind === 'inventory_reorder_risk'
        ? left.lowerValue - right.lowerValue
        : right.upperValue - left.upperValue)[0];
      return { kind, label, run, prediction };
    });
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

  get inventoryStockSignals(): InventoryCommandSignal[] {
    return this.inventorySignals('stock');
  }

  get inventoryFlowSignals(): InventoryCommandSignal[] {
    return this.inventorySignals('flow');
  }

  get inventoryGovernanceSignals(): InventoryCommandSignal[] {
    return this.inventorySignals('governance');
  }

  get inventoryRecommendations(): InventoryExceptionRecommendation[] {
    return (this.inventoryCommand?.recommendations ?? []).slice(0, 9);
  }

  get inventoryTransferOptimizations(): InventoryTransferOptimization[] {
    return (this.inventoryCommand?.transferOpportunities ?? []).slice(0, 6);
  }

  inventorySignalValue(signal: InventoryCommandSignal): string {
    if (signal.metric === 'money') return this.money(signal.metricValue);
    if (signal.metric === 'percent') return `${(Number(signal.metricValue || 0) / 100).toFixed(1)}%`;
    return String(signal.metricValue || 0);
  }

  inventoryConfidence(value: number): string {
    return `${(Number(value || 0) / 100).toFixed(0)}% confidence`;
  }

  inventoryCoverage(value?: number): string {
    return value === undefined || value === null ? 'No usage history' : `${value.toFixed(1)} days`;
  }

  reviewInventoryRecommendation(recommendation: InventoryExceptionRecommendation, decision: 'approve' | 'reject'): void {
    if (!this.canApproveInventory || this.inventoryRecommendationBusy) return;
    const reviewNote = decision === 'reject'
      ? window.prompt('Rejection reason')?.trim()
      : '';
    if (decision === 'reject' && !reviewNote) return;
    if (!window.confirm(`${decision === 'approve' ? 'Approve' : 'Reject'} this recommendation?`)) return;
    this.inventoryRecommendationError = '';
    this.inventoryRecommendationBusy = recommendation.key;
    this.api.post(`/api/v1/inventory/exception-recommendations/${encodeURIComponent(recommendation.key)}/review`, {
      evidenceHash: recommendation.evidenceHash,
      decision,
      reviewNote: reviewNote || '',
    }).pipe(finalize(() => (this.inventoryRecommendationBusy = ''))).subscribe({
      next: () => this.loadControls(),
      error: (error) => { this.inventoryRecommendationError = this.apiError(error, 'Unable to review recommendation'); },
    });
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

  get clientMemoryHighlights(): GrowthIntelligence['clientMemory'] {
    return (this.growth?.clientMemory ?? []).slice(0, 4);
  }

  get revenueLeakHighlights(): GrowthIntelligence['revenueLeaks'] {
    return (this.growth?.revenueLeaks ?? []).slice(0, 4);
  }

  get campaignPlannerHighlights(): GrowthIntelligence['campaignPlanner'] {
    return (this.growth?.campaignPlanner ?? []).slice(0, 4);
  }

  get staffCoachHighlights(): GrowthIntelligence['staffCoach'] {
    return (this.growth?.staffCoach ?? []).slice(0, 4);
  }

  get digitalTwinScenarios(): GrowthIntelligence['digitalTwin'] {
    return (this.growth?.digitalTwin ?? []).slice(0, 4);
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

  twinMetric(row: GrowthIntelligence['digitalTwin'][number]): string {
    return row.metricLabel.toLowerCase().includes('revenue')
      ? this.money(row.metricValue)
      : String(row.metricValue || 0);
  }

  label(value: string): string {
    return String(value || 'Unknown').replace(/[-_]/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
  }

  updatedLabel(updatedAt: Date | null = this.updatedAt): string {
    return updatedAt
      ? new Intl.DateTimeFormat('en-GB', {
          day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
        }).format(updatedAt)
      : 'Not updated';
  }

  dateTime(value?: string | null): string {
    if (!value) return 'Not assigned';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? 'Not assigned' : new Intl.DateTimeFormat('en-GB', {
      day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
    }).format(date);
  }

  isActionOverdue(action: PriorityAction): boolean {
    return Boolean(action.dueAt && ['pending', 'approved'].includes(action.status || '') && new Date(action.dueAt).getTime() < Date.now());
  }

  canApproveAction(action: PriorityAction): boolean {
    return this.canManageProfitActions && action.status === 'pending' && action.createdByUserId !== this.auth.userId;
  }

  forecastRange(prediction?: Prediction): string {
    if (!prediction) return 'Insufficient history';
    const value = (amount: number) => prediction.unit === 'paise'
      ? this.money(amount)
      : `${Math.round(amount)} ${this.label(prediction.unit)}`;
    return `${value(prediction.lowerValue)} – ${value(prediction.upperValue)}`;
  }

  createGovernedAction(action: PriorityAction): void {
    if (!this.canManageProfitActions || this.actionBusy) return;
    if (!window.confirm(`Assign ${action.title} with an approval SLA?`)) return;
    this.actionBusy = action.id;
    this.actionError = '';
    this.actionStatus = '';
    const priority = ['critical', 'high'].includes(action.priority.toLowerCase()) ? 'high'
      : ['medium', 'warning'].includes(action.priority.toLowerCase()) ? 'medium' : 'low';
    this.api.post('/api/v1/profit-intelligence/actions', {
      actionType: 'resolve_risk', title: action.title, message: action.message,
      impactPaise: action.impactPaise, expectedImpactPaise: action.impactPaise,
      priority, sourceType: action.sourceType, sourceId: action.sourceId,
      notes: 'Created from Command Center', payload: { route: action.route },
      evidence: { source: action.source, reason: action.message, expectedImpact: action.expectedImpact },
    }).pipe(finalize(() => (this.actionBusy = ''))).subscribe({
      next: () => { this.actionStatus = 'Action assigned for independent approval'; this.loadControls(); },
      error: (error) => { this.actionError = this.apiError(error, 'Unable to assign action'); },
    });
  }

  transitionGovernedAction(action: PriorityAction, transition: 'approve' | 'complete' | 'dismiss' | 'rollback'): void {
    if (!action.managedActionId || !this.canManageProfitActions || this.actionBusy) return;
    const note = transition === 'rollback'
      ? window.prompt('Rollback reason')?.trim()
      : transition === 'dismiss'
        ? window.prompt('Dismissal reason')?.trim()
        : `${this.label(transition)} from Command Center`;
    if ((transition === 'rollback' || transition === 'dismiss') && !note) return;
    if (!window.confirm(`${this.label(transition)} ${action.title}?`)) return;
    this.actionBusy = action.managedActionId;
    this.actionError = '';
    this.actionStatus = '';
    this.api.post(`/api/v1/profit-intelligence/actions/${encodeURIComponent(action.managedActionId)}/${transition}`, { note })
      .pipe(finalize(() => (this.actionBusy = ''))).subscribe({
        next: () => { this.actionStatus = `${action.title}: ${transition === 'rollback' ? 'rolled back' : this.label(transition)}`; this.loadControls(); },
        error: (error) => { this.actionError = this.apiError(error, `Unable to ${transition} action`); },
      });
  }

  rollbackHistoryAction(action: ProfitAction): void {
    this.transitionGovernedAction({
      id: action.id, source: this.label(action.sourceType), title: action.title, message: action.message,
      priority: action.priority, metric: this.money(action.expectedImpactPaise), impactPaise: action.expectedImpactPaise,
      route: this.safeActionRoute(action.payloadJson?.['route'], '/reports/profit-intelligence'), sourceType: action.sourceType,
      sourceId: action.sourceId, status: action.status, managedActionId: action.id, createdByUserId: action.createdByUserId,
      expectedImpact: this.money(action.expectedImpactPaise),
    }, 'rollback');
  }

  runForecasts(): void {
    if (!this.canReadAi || this.forecastRunning) return;
    this.forecastRunning = true;
    this.intelligenceError = '';
    forkJoin({
      revenue: this.optional('forecast-revenue', this.api.post<ApiEnvelope<PredictionRun> | PredictionRun>('/api/v1/ai/predictions/revenue_forecast', {})),
      stock: this.optional('forecast-stock', this.api.post<ApiEnvelope<PredictionRun> | PredictionRun>('/api/v1/ai/predictions/inventory_reorder_risk', {})),
      demand: this.optional('forecast-demand', this.api.post<ApiEnvelope<PredictionRun> | PredictionRun>('/api/v1/ai/predictions/service_demand', {})),
      noShow: this.optional('forecast-no-show', this.api.post<ApiEnvelope<PredictionRun> | PredictionRun>('/api/v1/ai/predictions/no_show_risk', {})),
    }).pipe(finalize(() => (this.forecastRunning = false))).subscribe(({ revenue, stock, demand, noShow }) => {
      this.forecasts = {
        revenue_forecast: this.unwrap(revenue) ?? null,
        inventory_reorder_risk: this.unwrap(stock) ?? null,
        service_demand: this.unwrap(demand) ?? null,
        no_show_risk: this.unwrap(noShow) ?? null,
      };
      this.touch();
    });
  }

  decideBriefing(signal: string, decision: 'acknowledge' | 'snooze' | 'dismiss'): void {
    if (!this.canReadAi || this.actionBusy) return;
    this.actionBusy = `briefing-${signal}`;
    this.actionError = '';
    this.api.post(`/api/v1/ai/briefing/signals/${encodeURIComponent(signal)}/decision`, { decision, snoozeHours: decision === 'snooze' ? 24 : 0 })
      .pipe(finalize(() => (this.actionBusy = ''))).subscribe({
        next: () => { this.actionStatus = `${this.label(signal)}: ${this.label(decision)}`; this.loadIntelligence(); },
        error: (error) => { this.actionError = this.apiError(error, 'Unable to update AI signal'); },
      });
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
      appointments: this.optional('appointments', this.api.get<ApiEnvelope<AppointmentGroup[]> | AppointmentGroup[]>(`/api/v1/reports/appointments?startDate=${this.dateOffset(-29)}&endDate=${this.dateOffset(0)}&pageSize=500`)),
    }).pipe(finalize(() => (this.financeLoading = false))).subscribe(({ profit, advanced, dues, appointments }) => {
      this.profit = this.unwrap(profit) ?? null;
      this.advancedProfit = this.unwrap(advanced) ?? null;
      this.dues = this.unwrap(dues) ?? [];
      this.appointmentGroups = this.unwrap(appointments) ?? [];
      if (profit || advanced || dues || appointments) this.touch();
    });
  }

  private loadControls(): void {
    this.controlsLoading = true;
    forkJoin({
      actions: this.optional('actions', this.api.get<ApiEnvelope<ProfitAction[]> | ProfitAction[]>('/api/v1/profit-intelligence/actions?status=all&limit=200')),
      audit: this.canManageProfitActions
        ? this.optional('action-audit', this.api.get<ApiEnvelope<GovernanceAuditEvent[]> | GovernanceAuditEvent[]>('/api/v1/profit-intelligence/governance/audit?limit=100'))
        : of(null),
      inventoryCommand: this.canReadInventory
        ? this.optional('inventory-command', this.api.get<ApiEnvelope<InventoryCommandCenter> | InventoryCommandCenter>('/api/v1/inventory/command-center'))
        : of(null),
    }).pipe(finalize(() => (this.controlsLoading = false))).subscribe(({ actions, audit, inventoryCommand }) => {
      this.actions = this.unwrap(actions) ?? [];
      this.actionAudit = this.unwrap(audit) ?? [];
      this.inventoryCommand = this.unwrap(inventoryCommand) ?? null;
      if (actions || audit || inventoryCommand) this.touch();
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

  private loadGrowth(): void {
    this.growthLoading = true;
    this.optional('growth', this.api.get<ApiEnvelope<GrowthIntelligence> | GrowthIntelligence>('/api/v1/reports/growth-intelligence'))
      .pipe(finalize(() => (this.growthLoading = false)))
      .subscribe((growth) => {
        this.growth = this.unwrap(growth) ?? null;
        if (growth) this.touch();
      });
  }

  private loadIntelligence(): void {
    if (!this.canReadAi) {
      this.intelligenceLoading = false;
      this.forecasts = {};
      this.workforce = null;
      this.briefing = null;
      return;
    }
    this.intelligenceLoading = true;
    this.optional('ai-workforce', this.api.get<ApiEnvelope<AiWorkforceSummary> | AiWorkforceSummary>('/api/v1/ai/workforce')).subscribe((response) => {
      this.workforce = this.unwrap(response) ?? null;
      this.loadGovernedIntelligence(Boolean(this.workforce?.enabled));
    });
  }

  private loadGovernedIntelligence(enabled: boolean): void {
    forkJoin({
      revenue: this.optional('forecast-revenue', this.api.get<ApiEnvelope<PredictionRun | null> | PredictionRun | null>('/api/v1/ai/predictions/revenue_forecast/latest')),
      stock: this.optional('forecast-stock', this.api.get<ApiEnvelope<PredictionRun | null> | PredictionRun | null>('/api/v1/ai/predictions/inventory_reorder_risk/latest')),
      demand: this.optional('forecast-demand', this.api.get<ApiEnvelope<PredictionRun | null> | PredictionRun | null>('/api/v1/ai/predictions/service_demand/latest')),
      noShow: this.optional('forecast-no-show', this.api.get<ApiEnvelope<PredictionRun | null> | PredictionRun | null>('/api/v1/ai/predictions/no_show_risk/latest')),
      briefing: enabled ? this.optional('briefing', this.api.get<ApiEnvelope<AiBriefing> | AiBriefing>('/api/v1/ai/briefing/daily')) : of(null),
    }).pipe(finalize(() => (this.intelligenceLoading = false))).subscribe(({ revenue, stock, demand, noShow, briefing }) => {
      this.forecasts = {
        revenue_forecast: this.unwrap(revenue) ?? null,
        inventory_reorder_risk: this.unwrap(stock) ?? null,
        service_demand: this.unwrap(demand) ?? null,
        no_show_risk: this.unwrap(noShow) ?? null,
      };
      this.briefing = this.unwrap(briefing) ?? null;
      if (this.workforce || revenue || stock || demand || noShow || briefing) this.touch();
    });
  }

  loadBranchAnomalies(): void {
    if (!this.canReadAi) {
      this.branchAnomalyLoading = false;
      this.branchAnomalies = [];
      return;
    }
    this.branchAnomalyLoading = true;
    this.optional('branch-anomaly', this.api.get<ApiEnvelope<BranchAnomaly[]> | BranchAnomaly[]>(`/api/v1/ai/briefing/compare/${encodeURIComponent(this.branchSignal)}`))
      .pipe(finalize(() => (this.branchAnomalyLoading = false)))
      .subscribe((rows) => {
        this.branchAnomalies = this.unwrap(rows) ?? [];
        if (rows) this.touch();
      });
  }


  createCampaignDraft(plan: GrowthIntelligence['campaignPlanner'][number]): void {
    if (this.growthActionBusy) return;
    if (!window.confirm(`Create a campaign draft for ${plan.title}?`)) return;
    this.growthActionBusy = true;
    this.growthActionStatus = '';
    this.growthActionError = '';
    this.api.post(`/api/v1/reports/growth-intelligence/campaign-plans/${encodeURIComponent(plan.key)}/draft`, {})
      .pipe(finalize(() => (this.growthActionBusy = false)))
      .subscribe({
        next: () => {
          this.growthActionStatus = `Campaign draft created for ${plan.title}`;
          this.loadGrowth();
        },
        error: (error) => { this.growthActionError = this.apiError(error, 'Unable to create campaign draft'); },
      });
  }

  createStaffGoal(staff: GrowthIntelligence['staffCoach'][number], opportunity: GrowthIntelligence['staffCoach'][number]['opportunities'][number]): void {
    if (this.growthActionBusy) return;
    if (!window.confirm(`Assign ${opportunity.title} to ${staff.staffName || staff.staffId}?`)) return;
    this.growthActionBusy = true;
    this.growthActionStatus = '';
    this.growthActionError = '';
    this.api.post(`/api/v1/reports/growth-intelligence/staff/${encodeURIComponent(staff.staffId)}/coaching-goal`, { opportunityKey: opportunity.key })
      .pipe(finalize(() => (this.growthActionBusy = false)))
      .subscribe({
        next: () => {
          this.growthActionStatus = `${opportunity.title} assigned to ${staff.staffName || staff.staffId}`;
          this.loadGrowth();
        },
        error: (error) => { this.growthActionError = this.apiError(error, 'Unable to create coaching goal'); },
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
    return request.pipe(tap(() => {
      this.errors.delete(source);
      this.sourceUpdatedAt.set(source, new Date());
    }), catchError(() => {
      this.errors.add(source);
      return of(null);
    }));
  }

  private sourceLoading(source: Source): boolean {
    if (source === 'snapshot') return this.snapshotLoading;
    if (['profit', 'advanced', 'dues', 'appointments'].includes(source)) return this.financeLoading;
    if (['actions', 'action-audit', 'inventory-command'].includes(source)) return this.controlsLoading;
    if (['payments', 'payment-risk', 'payment-providers'].includes(source)) return this.paymentLoading;
    if (['franchise', 'membership-settings', 'multi-branch'].includes(source)) return this.locationLoading;
    if (['forecast-revenue', 'forecast-stock', 'forecast-demand', 'forecast-no-show', 'briefing'].includes(source)) return this.intelligenceLoading || this.forecastRunning;
    if (source === 'branch-anomaly') return this.branchAnomalyLoading;
    return this.growthLoading;
  }

  private safeActionRoute(value: unknown, fallback: string): string {
    const route = typeof value === 'string' ? value.trim() : '';
    return route.startsWith('/') && !route.startsWith('//') ? route : fallback;
  }

  private unwrap<T>(response: ApiEnvelope<T> | T | null): T | undefined {
    if (response == null) return undefined;
    if (typeof response === 'object' && 'data' in response) return (response as ApiEnvelope<T>).data;
    return response as T;
  }

  private touch(): void {
    this.updatedAt = new Date();
  }

  private inventorySignals(group: InventoryCommandSignal['group']): InventoryCommandSignal[] {
    return (this.inventoryCommand?.signals ?? []).filter((signal) => signal.group === group);
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
