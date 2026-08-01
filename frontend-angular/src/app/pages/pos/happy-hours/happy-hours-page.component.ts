import { CommonModule } from '@angular/common';
import { Component, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { Observable } from 'rxjs';
import { DatePickerComponent } from '../../../shared/date-picker/date-picker.component';
import { ApiService } from '../../../shared/services/api.service';

type CatalogItem = { id: string; name?: string; serviceName?: string; productName?: string; firstName?: string; lastName?: string };
type RuleScope = 'all' | 'service' | 'product';

type HappyHourRule = {
  id: string;
  name: string;
  startTime: string;
  endTime: string;
  weekdays: number[];
  discountBps: number;
  eligibleLineTypes: string[];
  eligibleItemIds: string[];
  eligibleClientCategories: string[];
  minMarginBps: number;
  blockOnUnknownCost: boolean;
  active: boolean;
};

type ControlTower = {
  summary: { totalRules: number; activeRules: number; liveRules: number; collectingRules: number; measuredOffers: number; applications: number; salesValuePaise: number; discountPaise: number; reversedDiscountPaise: number; averageHealthScore: number };
  offers: Array<{ ruleId: string; name: string; active: boolean; lifecycleStage: string; roiStatus: string; healthStatus: string; healthScore: number; applications: number; activeApplications: number; salesValuePaise: number; discountPaise: number; reversedDiscountPaise: number; discountRateBps: number; returnOnDiscountBps: number; lastAppliedAt: string | null }>;
  note: string;
};

type Intelligence = {
  summary: { fraudReviewSignals: number; noShowRisks: number; inventoryActions: number; staffActions: number };
  fraudReview: Array<{ signalType: string; subjectId: string; subject: string; severity: string; occurrences: number; amountPaise: number; reason: string }>;
  noShowRisks: Array<{ clientId: string; clientName: string; totalAppointments: number; noShowCount: number; cancellationCount: number; completedCount: number; riskScore: number; riskLevel: string }>;
  inventoryOffers: Array<{ itemId: string; itemName: string; stockQuantity: number; reorderPoint: number; status: string; recommendation: string }>;
  staffOffers: Array<{ staffId: string; staffName: string; scheduleStatus: string; scheduledMinutes: number; bookedMinutes: number; appointmentCount: number; occupancyBps: number; recommendation: string }>;
  note: string;
};

type Coupon = {
  id: string; code: string; discountType: 'amount' | 'percent'; discountValuePaise: number; discountBps: number;
  minSubtotalPaise: number; maxDiscountPaise: number; active: boolean; startsAt: string | null; endsAt: string | null;
  usageLimit: number | null; usedCount: number; perClientLimit: number;
  offerType: 'generic' | 'first_visit' | 'referral' | 'branch_specific' | 'service_specific' | 'segment';
  targetServiceIds: string[]; targetServiceCategories: string[]; targetClientSegments: string[];
  firstVisitOnly: boolean; referralRequired: boolean;
};
type CouponAnalytics = {
  couponId: string; couponCode: string; offerType: string; redemptions: number; uniqueClients: number;
  salesValuePaise: number; discountPaise: number; returnOnDiscountBps: number;
};

type AudienceCriteria = { inactiveDaysGte?: number; visitCountGte?: number; totalSpendPaiseGte?: number; birthdayMonth?: number; clientType?: 'new' | 'existing' };
type Audience = {
  id: string; audienceKey: string; name: string; channel: 'whatsapp' | 'sms'; criteria: AudienceCriteria;
  estimateCount: number; previewedAt: string | null; status: 'draft' | 'ready' | 'archived';
};
type AudiencePreview = {
  estimateCount: number;
  sample: Array<{ clientId: string; clientName: string; visitCount: number; totalSpendPaise: number; inactiveDays: number }>;
};
type CampaignLink = {
  id: string; audienceId: string; audienceName: string; ruleId: string; ruleName: string; couponId: string | null;
  couponCode: string | null; channel: string; title: string; message: string; status: 'draft' | 'ready' | 'archived';
};

type MarketObservation = {
  id: string; serviceCategory: string; competitorName: string; observedPricePaise: number;
  observedOn: string; sourceUrl: string; active: boolean; createdAt: string;
};
type MarketEvaluation = {
  status: 'collecting' | 'ready'; serviceCategory: string; signalDate: string; hourSlot: number;
  ourPricePaise: number; baseDiscountBps: number; maxDiscountBps: number; benchmarkSource: string;
  marketAvgPaise: number; marketMinPaise: number; marketMaxPaise: number; observationCount: number;
  scheduledStaff: number; appointmentCount: number; occupancyBps: number; priceGapBps: number;
  marketPosition: string; campaignAngle: string; suggestedDiscountBps: number; reasons: string[];
};
type MarketSuggestion = Omit<MarketEvaluation, 'status'> & { id: string; status: 'suggested' | 'approved' | 'paused' | 'archived'; createdAt: string; updatedAt: string };
type ContextOfferType = 'bundle' | 'channel' | 'lead_time' | 'weather_event' | 'member_wallet';
type ContextOfferEvaluation = {
  readiness: 'collecting' | 'ready'; offerType: ContextOfferType; serviceCategory: string;
  signalDate: string; hourSlot: number; servicePricePaise: number; baseDiscountBps: number;
  suggestedDiscountBps: number; campaignAngle: string; context: Record<string, any>; reasons: string[];
};
type ContextOfferSuggestion = Omit<ContextOfferEvaluation, 'readiness'> & {
  id: string; status: 'suggested' | 'approved' | 'paused' | 'archived'; createdAt: string; updatedAt: string;
};
type AutoSunsetPolicy = {
  expirePastEndDate: boolean; pauseCouponsAtUsageLimit: boolean; reviewNoEndDateAfterDays: number;
  autoApplyExpired: boolean; autoApplyUsageLimit: boolean; autoApplyStale: boolean; status: 'active' | 'paused'; updatedAt?: string | null;
};
type AutoSunsetDecision = {
  id: string; offerType: 'rule' | 'coupon'; offerId: string; offerName: string; action: string;
  reason: string; severity: 'medium' | 'high' | 'critical'; status: 'suggested' | 'applied' | 'skipped';
  evidence: Record<string, any>; source: 'manual' | 'job'; decidedAt: string; appliedAt: string | null;
};
type BranchLeaderboardRow = {
  rank: number; branchId: string; branchName: string; activeOffers: number; applications: number;
  uniqueClients: number; repeatClients: number; salesValuePaise: number; netDiscountPaise: number;
  returnOnDiscountBps: number; repeatRateBps: number; reversalRateBps: number;
  leaderboardScore: number; leaderboardGrade: 'excellent' | 'good' | 'watch' | 'poor' | 'no_data'; recommendation: string;
};
type ClientReturnRow = {
  sourceId: string; offerType: 'rule' | 'coupon'; offerId: string; offerTitle: string;
  clientId: string; clientName: string; usedAt: string; amountPaise: number; discountPaise: number;
  status: 'returned' | 'pending' | 'at_risk' | 'unknown_client'; returnAt: string | null;
  returnAmountPaise: number; daysToReturn: number | null; recommendation: string;
};
type OfferReturnRow = {
  offerType: 'rule' | 'coupon'; offerId: string; offerTitle: string; offerUses: number;
  returnedCount: number; atRiskCount: number; returnRateBps: number; returnRevenuePaise: number;
};
type ClientReturnTracker = {
  summary: {
    offerUses: number; returnedCount: number; pendingCount: number; atRiskCount: number;
    uniqueClients: number; returnedClients: number; returnRateBps: number; averageDaysToReturn: number;
    discountPaise: number; returnRevenuePaise: number;
  };
  clients: ClientReturnRow[];
  offers: OfferReturnRow[];
};
type ElasticityPricingRow = {
  serviceId: string; serviceName: string; discountBps: number; sampleCount: number;
  averageUnitsPerSlot: number; demandLiftBps: number; elasticity: number; revenuePaise: number;
  discountPaise: number; productCostPaise: number; staffCostPaise: number; netProfitPaise: number;
  profitPerSlotPaise: number; marginBps: number; minimumMarginBps: number;
  marginSafe: boolean; recommended: boolean;
};
type ElasticityPricing = {
  status: 'ready' | 'collecting'; fromDate: string; toDate: string; serviceCount: number;
  readyServiceCount: number; bandCount: number; rows: ElasticityPricingRow[]; source: string;
};
type RuleConflictResponse = {
  summary: { rulesChecked: number; conflictCount: number; highSeverityCount: number };
  conflicts: Array<{
    ruleId: string; ruleName: string; conflictingRuleId: string; conflictingRuleName: string;
    severity: 'high' | 'medium'; conflictType: string; overlappingWeekdays: number[]; reasons: string[];
  }>;
};
type SimulationResult = {
  status: 'applied' | 'blocked' | 'not_applicable'; reason: string; ruleId: string | null; ruleName: string | null;
  serviceId: string; serviceName: string; quantity: number; grossPaise: number; discountPaise: number;
  payablePaise: number; costPaise: number | null; marginBps: number | null;
};
type HappyHourApproval = {
  id: string; ruleId: string; ruleName: string; requestedBy: string; requestedRole: string;
  requestedDiscountBps: number; approvalLimitBps: number; ruleSnapshotJson: Record<string, any>; status: string; note: string; decisionNote: string;
  decidedBy: string | null; decidedAt: string | null; createdAt: string;
};
type DiscountApproval = {
  id: string; saleId: string; invoiceNumber: string; requestedBy: string; requestedRole: string;
  discountType: string; discountAmountPaise: number; reason: string; status: string; decisionNote: string;
  decidedBy: string | null; decidedAt: string | null; expiresAt: string; createdAt: string;
};
type CouponAbuseAlert = {
  id: string; clientId: string; clientName: string; couponCode: string; alertType: string; severity: string;
  evidenceJson: { usageCount?: number; totalDiscountPaise?: number; latestSaleId?: string };
  status: string; resolvedBy: string | null; resolvedAt: string | null; resolutionNote: string; detectedAt: string;
};
type HappyHourAnomaly = {
  id: string; anomalyType: string; severity: string; status: string; title: string; description: string;
  evidenceJson: Record<string, any>; detectedAt: string; reviewedBy: string | null; reviewedAt: string | null; reviewNote: string;
};
type FraudCase = {
  id: string; fraudType: string; subjectType: string; subjectId: string; riskScore: number; severity: string;
  decision: 'allow' | 'manager_review' | 'block_until_review'; status: string; title: string; description: string;
  evidenceJson: Record<string, any>; reviewedBy: string | null; reviewedAt: string | null; reviewNote: string; detectedAt: string;
};
type HappyHourBudget = {
  id: string; periodStart: string; periodEnd: string; budgetPaise: number; spentPaise: number;
  remainingPaise: number; usedBps: number; alertThresholdBps: number; approvalAboveBps: number;
  thresholdReached: boolean; exceeded: boolean; updatedAt: string;
};
type HappyHourAudit = { id: string; userId: string | null; eventType: string; outcome: string; detailsJson: Record<string, any>; createdAt: string };
type HappyHourWebhook = { id: string; name: string; endpointUrl: string; events: string[]; active: boolean; createdAt: string };
type WebhookDelivery = { id: string; subscriptionId: string; eventType: string; status: string; attempts: number; responseStatus: number | null; lastError: string; createdAt: string };

type RuleDraft = {
  name: string;
  startTime: string;
  endTime: string;
  weekdays: number[];
  discountPercent: string;
  scope: RuleScope;
  eligibleItemIds: string[];
  clientCategories: string;
  minMarginPercent: string;
  blockOnUnknownCost: boolean;
  active: boolean;
};

type CouponDraft = {
  code: string; discountType: 'amount' | 'percent'; discountValue: string; minSubtotal: string;
  maxDiscount: string; startDate: string; endDate: string; usageLimit: string; perClientLimit: string; active: boolean;
  offerType: Coupon['offerType']; targetServiceIds: string[]; serviceCategories: string; clientSegments: string;
};

type AudienceDraft = {
  name: string; channel: 'whatsapp' | 'sms'; status: 'draft' | 'ready'; inactiveDays: string;
  visitCount: string; minimumSpend: string; birthdayMonth: string; clientType: '' | 'new' | 'existing';
};
type CampaignLinkDraft = { audienceId: string; ruleId: string; couponId: string; title: string; message: string; status: 'draft' | 'ready' };
type MarketDraft = { serviceCategory: string; signalDate: string; hourSlot: string; ourPrice: string; baseDiscount: string; maxDiscount: string };
type MarketObservationDraft = { serviceCategory: string; competitorName: string; observedPrice: string; observedOn: string; sourceUrl: string };
type ContextOfferDraft = {
  offerType: ContextOfferType; serviceCategory: string; clientId: string; signalDate: string; hourSlot: string;
  servicePrice: string; baseDiscount: string; maxDiscount: string; selectedServiceCount: string;
  cartTotal: string; sourceChannel: string; channelFee: string; bookingLeadMinutes: string;
  weatherCondition: string; temperatureCelsius: string; rainProbabilityPercent: string;
  eventType: string; eventName: string; expectedFootfall: string;
};
type OfferPreset = { key: 'demand' | 'winback' | 'firstVisit' | 'market' | 'adaptive'; title: string; metric: string; action: string };

@Component({
    selector: 'app-happy-hours-page',
    imports: [CommonModule, FormsModule, RouterLink, DatePickerComponent],
    templateUrl: './happy-hours-page.component.html',
    styleUrls: ['./happy-hours-page.component.css']
})
export class HappyHoursPageComponent implements OnInit {
  readonly weekDays = [
    { value: 1, label: 'Mon' }, { value: 2, label: 'Tue' }, { value: 3, label: 'Wed' },
    { value: 4, label: 'Thu' }, { value: 5, label: 'Fri' }, { value: 6, label: 'Sat' },
    { value: 0, label: 'Sun' },
  ];

  rules: HappyHourRule[] = [];
  coupons: Coupon[] = [];
  couponAnalytics: CouponAnalytics[] = [];
  audiences: Audience[] = [];
  campaignLinks: CampaignLink[] = [];
  marketObservations: MarketObservation[] = [];
  marketSuggestions: MarketSuggestion[] = [];
  marketEvaluation: MarketEvaluation | null = null;
  contextOfferSuggestions: ContextOfferSuggestion[] = [];
  contextOfferEvaluation: ContextOfferEvaluation | null = null;
  autoSunsetPolicy: AutoSunsetPolicy = this.defaultAutoSunsetPolicy();
  autoSunsetDecisions: AutoSunsetDecision[] = [];
  branchLeaderboard: BranchLeaderboardRow[] = [];
  branchLeaderboardFilters = { from: '', to: '', sort: 'score' };
  clientReturnTracker: ClientReturnTracker | null = null;
  clientReturnFilters = { from: '', to: '', returnWindowDays: '30', status: '', offerType: '' };
  elasticityPricing: ElasticityPricing | null = null;
  elasticityFilters = { from: '', to: '', dayOfWeek: '', hourSlot: '', serviceId: '' };
  ruleConflicts: RuleConflictResponse | null = null;
  conflictActiveOnly = true;
  simulationDraft = { serviceId: '', clientId: '', weekday: '', time: '', quantity: '' };
  simulationResult: SimulationResult | null = null;
  approvals: HappyHourApproval[] = [];
  approvalDraft = { ruleId: '', note: '' };
  discountApprovals: DiscountApproval[] = [];
  discountApprovalDraft = { invoiceId: '', reason: '' };
  discountApprovalStatus = '';
  couponAbuseAlerts: CouponAbuseAlert[] = [];
  couponAbuseStatus = 'open';
  anomalies: HappyHourAnomaly[] = [];
  anomalyStatus = 'open';
  fraudCases: FraudCase[] = [];
  fraudStatus = 'open';
  budget: HappyHourBudget | null = null;
  budgetDraft = { periodStart: '', periodEnd: '', budget: '', alertThresholdPercent: '', approvalAbovePercent: '' };
  auditLog: HappyHourAudit[] = [];
  webhooks: HappyHourWebhook[] = [];
  webhookDeliveries: WebhookDelivery[] = [];
  webhookDraft = { name: '', endpointUrl: '' };
  webhookSecret = '';
  tab: 'rules' | 'control' | 'intelligence' | 'coupons' | 'calendar' | 'audiences' | 'campaignLinks' | 'marketAware' | 'contextAware' | 'autoSunset' | 'branchLeaderboard' | 'clientReturns' | 'elasticityPricing' | 'ruleTools' | 'governance' = 'rules';
  controlTower: ControlTower | null = null;
  intelligence: Intelligence | null = null;
  services: CatalogItem[] = [];
  products: CatalogItem[] = [];
  clients: CatalogItem[] = [];
  draft = this.emptyDraft();
  couponDraft = this.emptyCouponDraft();
  audienceDraft = this.emptyAudienceDraft();
  campaignLinkDraft = this.emptyCampaignLinkDraft();
  marketDraft = this.emptyMarketDraft();
  marketObservationDraft = this.emptyMarketObservationDraft();
  contextOfferDraft = this.emptyContextOfferDraft();
  audiencePreview: AudiencePreview | null = null;
  drawerMode: 'rule' | 'coupon' | 'audience' | 'campaignLink' | 'marketObservation' = 'rule';
  editingId = '';
  drawerOpen = false;
  loading = false;
  busy = false;
  message = '';
  error = '';
  /** Catalogue names whose last load failed, so an empty picker is not read as "no items". */
  private readonly catalogFailures = new Set<string>();

  constructor(private readonly api: ApiService) {}

  ngOnInit(): void {
    this.load();
    this.loadCatalog();
    this.loadCoupons();
    this.loadIntelligence();
    this.loadAudiences();
    this.loadCampaignLinks();
    this.loadMarketAware();
    this.loadContextAware();
    this.loadAutoSunset();
    this.loadBranchLeaderboard();
    this.loadClientReturns();
    this.loadElasticityPricing();
    this.loadGovernance();
  }

  load(): void {
    this.loading = true;
    this.error = '';
    this.api.get<any>('/api/v1/pos/happy-hours/rules').subscribe({
      next: (response) => { this.rules = this.rows(response); this.loading = false; this.loadControlTower(); this.loadRuleConflicts(); this.loadApprovals(); },
      error: (error) => { this.rules = []; this.loading = false; this.error = this.errorText(error, 'Happy Hours could not be loaded'); },
    });
  }

  loadControlTower(): void {
    this.api.get<any>('/api/v1/pos/happy-hours/control-tower').subscribe({
      next: (response) => this.controlTower = response?.data ?? response ?? null,
      error: () => this.controlTower = null,
    });
  }

  loadIntelligence(): void {
    this.api.get<any>('/api/v1/pos/happy-hours/intelligence').subscribe({
      next: (response) => this.intelligence = response?.data ?? response ?? null,
      error: () => this.intelligence = null,
    });
  }

  loadCoupons(): void {
    this.api.get<any>('/api/v1/pos/coupons').subscribe({
      next: (response) => this.coupons = this.rows(response),
      error: () => this.coupons = [],
    });
    this.api.get<any>('/api/v1/pos/coupons/analytics').subscribe({
      next: (response) => this.couponAnalytics = this.rows(response),
      error: () => this.couponAnalytics = [],
    });
  }

  loadAudiences(): void {
    this.api.get<any>('/api/v1/pos/happy-hours/audiences').subscribe({
      next: (response) => this.audiences = this.rows(response),
      error: () => this.audiences = [],
    });
  }

  loadCampaignLinks(): void {
    this.api.get<any>('/api/v1/pos/happy-hours/campaign-links').subscribe({
      next: (response) => this.campaignLinks = this.rows(response),
      error: () => this.campaignLinks = [],
    });
  }

  loadMarketAware(): void {
    this.api.get<any>('/api/v1/pos/happy-hours/market-aware/observations').subscribe({
      next: (response) => this.marketObservations = this.rows(response),
      error: () => this.marketObservations = [],
    });
    this.api.get<any>('/api/v1/pos/happy-hours/market-aware/suggestions').subscribe({
      next: (response) => this.marketSuggestions = this.rows(response),
      error: () => this.marketSuggestions = [],
    });
  }

  loadContextAware(): void {
    this.api.get<any>('/api/v1/pos/happy-hours/context-aware/suggestions').subscribe({
      next: (response) => this.contextOfferSuggestions = this.rows(response),
      error: () => this.contextOfferSuggestions = [],
    });
  }

  loadAutoSunset(): void {
    this.api.get<any>('/api/v1/pos/happy-hours/auto-sunset/policy').subscribe({
      next: (response) => this.autoSunsetPolicy = response?.data ?? response ?? this.defaultAutoSunsetPolicy(),
      error: () => this.autoSunsetPolicy = this.defaultAutoSunsetPolicy(),
    });
    this.api.get<any>('/api/v1/pos/happy-hours/auto-sunset/decisions').subscribe({
      next: (response) => this.autoSunsetDecisions = this.rows(response),
      error: () => this.autoSunsetDecisions = [],
    });
  }

  loadBranchLeaderboard(): void {
    const params = new URLSearchParams({ sort: this.branchLeaderboardFilters.sort });
    if (this.branchLeaderboardFilters.from) params.set('from', this.branchLeaderboardFilters.from);
    if (this.branchLeaderboardFilters.to) params.set('to', this.branchLeaderboardFilters.to);
    this.api.get<any>(`/api/v1/pos/happy-hours/branch-leaderboard?${params}`).subscribe({
      next: (response) => this.branchLeaderboard = this.rows(response),
      error: (error) => { this.branchLeaderboard = []; this.error = this.errorText(error, 'Branch leaderboard could not be loaded'); },
    });
  }

  loadClientReturns(): void {
    const params = new URLSearchParams({ returnWindowDays: this.clientReturnFilters.returnWindowDays });
    if (this.clientReturnFilters.from) params.set('from', this.clientReturnFilters.from);
    if (this.clientReturnFilters.to) params.set('to', this.clientReturnFilters.to);
    if (this.clientReturnFilters.status) params.set('status', this.clientReturnFilters.status);
    if (this.clientReturnFilters.offerType) params.set('offerType', this.clientReturnFilters.offerType);
    this.api.get<any>(`/api/v1/pos/happy-hours/client-returns?${params}`).subscribe({
      next: (response) => this.clientReturnTracker = response?.data ?? response ?? null,
      error: (error) => {
        this.clientReturnTracker = null;
        this.error = this.errorText(error, 'Client return tracker could not be loaded');
      },
    });
  }

  exportClientReturns(): void {
    const rows = this.clientReturnTracker?.clients ?? [];
    if (!rows.length) return;
    const values = rows.map((row) => [
      row.clientId, row.clientName, row.offerType, row.offerTitle, row.status,
      this.displayDate(row.usedAt), row.discountPaise, this.displayDate(row.returnAt),
      row.daysToReturn ?? '', row.returnAmountPaise,
    ]);
    const csv = [['Client ID', 'Client', 'Offer type', 'Offer', 'Status', 'Used', 'Discount paise', 'Returned', 'Days to return', 'Return revenue paise'], ...values]
      .map((columns) => columns.map((value) => `"${String(value).replace(/"/g, '""')}"`).join(','))
      .join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'happy-hours-client-return-tracker.csv';
    link.click();
    URL.revokeObjectURL(url);
  }

  loadElasticityPricing(): void {
    const params = new URLSearchParams();
    if (this.elasticityFilters.from) params.set('from', this.elasticityFilters.from);
    if (this.elasticityFilters.to) params.set('to', this.elasticityFilters.to);
    if (this.elasticityFilters.dayOfWeek !== '') params.set('dayOfWeek', this.elasticityFilters.dayOfWeek);
    if (this.elasticityFilters.hourSlot !== '') params.set('hourSlot', this.elasticityFilters.hourSlot);
    if (this.elasticityFilters.serviceId) params.set('serviceId', this.elasticityFilters.serviceId);
    this.api.get<any>(`/api/v1/pos/happy-hours/elasticity-pricing?${params}`).subscribe({
      next: (response) => this.elasticityPricing = response?.data ?? response ?? null,
      error: (error) => {
        this.elasticityPricing = null;
        this.error = this.errorText(error, 'Elasticity pricing could not be loaded');
      },
    });
  }

  loadRuleConflicts(): void {
    this.api.get<any>(`/api/v1/pos/happy-hours/rule-conflicts?activeOnly=${this.conflictActiveOnly}`).subscribe({
      next: (response) => this.ruleConflicts = response?.data ?? response ?? null,
      error: (error) => {
        this.ruleConflicts = null;
        this.error = this.errorText(error, 'Rule conflicts could not be loaded');
      },
    });
  }

  runSimulation(): void {
    const quantity = Number(this.simulationDraft.quantity);
    const weekday = Number(this.simulationDraft.weekday);
    if (!this.simulationDraft.serviceId || this.simulationDraft.weekday === '' || !this.simulationDraft.time || !Number.isInteger(quantity) || quantity < 1) {
      this.error = 'Service, day, time and quantity are required';
      return;
    }
    this.busy = true;
    this.error = '';
    this.simulationResult = null;
    this.api.post<any>('/api/v1/pos/happy-hours/simulate', {
      serviceId: this.simulationDraft.serviceId,
      clientId: this.simulationDraft.clientId || null,
      weekday,
      time: this.simulationDraft.time,
      quantity,
    }).subscribe({
      next: (response) => { this.simulationResult = response?.data ?? response ?? null; this.busy = false; },
      error: (error) => { this.busy = false; this.error = this.errorText(error, 'Simulation could not be run'); },
    });
  }

  loadGovernance(): void {
    this.loadApprovals();
    this.loadDiscountApprovals();
    this.loadCouponAbuseAlerts();
    this.loadAnomalies();
    this.loadFraudCases();
    this.loadBudget();
    this.loadAudit();
    this.loadWebhooks();
  }

  loadApprovals(): void {
    this.api.get<any>('/api/v1/pos/happy-hours/approvals').subscribe({
      next: (response) => this.approvals = this.rows(response),
      error: () => this.approvals = [],
    });
  }

  requestApproval(): void {
    if (!this.approvalDraft.ruleId) { this.error = 'Rule is required'; return; }
    this.run(
      this.api.post('/api/v1/pos/happy-hours/approvals', this.approvalDraft),
      'Approval requested',
      false,
      () => { this.approvalDraft = { ruleId: '', note: '' }; this.load(); this.loadApprovals(); this.loadAudit(); },
    );
  }

  decideApproval(row: HappyHourApproval, decision: 'approved' | 'rejected'): void {
    this.run(
      this.api.patch(`/api/v1/pos/happy-hours/approvals/${encodeURIComponent(row.id)}`, { decision, note: '' }),
      `Approval ${decision}`,
      false,
      () => { this.load(); this.loadApprovals(); this.loadAudit(); },
    );
  }

  loadDiscountApprovals(): void {
    this.api.get<any>(`/api/v1/pos/happy-hours/discount-approvals?status=${encodeURIComponent(this.discountApprovalStatus)}`).subscribe({
      next: (response) => this.discountApprovals = this.rows(response),
      error: () => this.discountApprovals = [],
    });
  }

  requestDiscountApproval(): void {
    if (!this.discountApprovalDraft.invoiceId.trim()) { this.error = 'Invoice ID is required'; return; }
    this.run(
      this.api.post('/api/v1/pos/happy-hours/discount-approvals', {
        invoiceId: this.discountApprovalDraft.invoiceId.trim(),
        reason: this.discountApprovalDraft.reason.trim() || null,
      }),
      'Discount approval requested',
      false,
      () => { this.discountApprovalDraft = { invoiceId: '', reason: '' }; this.loadDiscountApprovals(); this.loadAudit(); },
    );
  }

  decideDiscountApproval(row: DiscountApproval, decision: 'approved' | 'rejected'): void {
    this.run(
      this.api.patch(`/api/v1/pos/happy-hours/discount-approvals/${encodeURIComponent(row.id)}`, { decision, note: '' }),
      `Discount approval ${decision}`,
      false,
      () => { this.loadDiscountApprovals(); this.loadAudit(); },
    );
  }

  loadCouponAbuseAlerts(): void {
    this.api.get<any>(`/api/v1/pos/happy-hours/coupon-abuse/alerts?status=${encodeURIComponent(this.couponAbuseStatus)}`).subscribe({
      next: (response) => this.couponAbuseAlerts = this.rows(response),
      error: () => this.couponAbuseAlerts = [],
    });
  }

  scanCouponAbuse(): void {
    this.run(
      this.api.post('/api/v1/pos/happy-hours/coupon-abuse/scan', {}),
      'Coupon abuse scan completed',
      false,
      () => { this.loadCouponAbuseAlerts(); this.loadAudit(); },
    );
  }

  resolveCouponAbuse(row: CouponAbuseAlert): void {
    this.run(
      this.api.patch(`/api/v1/pos/happy-hours/coupon-abuse/alerts/${encodeURIComponent(row.id)}`, { note: '' }),
      'Coupon abuse alert resolved',
      false,
      () => { this.loadCouponAbuseAlerts(); this.loadAudit(); },
    );
  }

  loadAnomalies(): void {
    this.api.get<any>(`/api/v1/pos/happy-hours/anomalies?status=${encodeURIComponent(this.anomalyStatus)}`).subscribe({
      next: (response) => this.anomalies = this.rows(response),
      error: () => this.anomalies = [],
    });
  }

  scanAnomalies(): void {
    this.run(
      this.api.post('/api/v1/pos/happy-hours/anomalies/scan', {}),
      'Anomaly scan completed',
      false,
      () => { this.loadAnomalies(); this.loadAudit(); },
    );
  }

  reviewAnomaly(row: HappyHourAnomaly, status: 'reviewed' | 'dismissed'): void {
    this.run(
      this.api.patch(`/api/v1/pos/happy-hours/anomalies/${encodeURIComponent(row.id)}`, { status, note: '' }),
      `Anomaly ${status}`,
      false,
      () => { this.loadAnomalies(); this.loadAudit(); },
    );
  }

  loadFraudCases(): void {
    this.api.get<any>(`/api/v1/pos/happy-hours/fraud-guard/cases?status=${encodeURIComponent(this.fraudStatus)}`).subscribe({
      next: (response) => this.fraudCases = this.rows(response),
      error: () => this.fraudCases = [],
    });
  }

  scanFraudCases(): void {
    this.run(
      this.api.post('/api/v1/pos/happy-hours/fraud-guard/scan', {}),
      'Fraud guard scan completed', false,
      () => { this.loadFraudCases(); this.loadAnomalies(); this.loadAudit(); },
    );
  }

  reviewFraudCase(row: FraudCase, status: 'investigating' | 'resolved' | 'dismissed'): void {
    this.run(
      this.api.patch(`/api/v1/pos/happy-hours/fraud-guard/cases/${encodeURIComponent(row.id)}`, { status, note: '' }),
      `Fraud case ${status}`, false,
      () => { this.loadFraudCases(); this.loadAudit(); },
    );
  }

  loadBudget(): void {
    this.api.get<any>('/api/v1/pos/happy-hours/budget').subscribe({
      next: (response) => {
        this.budget = response?.data === null ? null : response?.data ?? response ?? null;
        if (this.budget) {
          this.budgetDraft = {
            periodStart: this.budget.periodStart,
            periodEnd: this.budget.periodEnd,
            budget: String(this.budget.budgetPaise / 100),
            alertThresholdPercent: String(this.budget.alertThresholdBps / 100),
            approvalAbovePercent: String(this.budget.approvalAboveBps / 100),
          };
        }
      },
      error: () => this.budget = null,
    });
  }

  saveBudget(): void {
    const budgetPaise = this.toPaise(this.budgetDraft.budget);
    const alertThresholdBps = this.bps(this.budgetDraft.alertThresholdPercent);
    const approvalAboveBps = this.bps(this.budgetDraft.approvalAbovePercent);
    if (!this.budgetDraft.periodStart || !this.budgetDraft.periodEnd || this.budgetDraft.budget === '' || budgetPaise < 0 || !(alertThresholdBps > 0 && alertThresholdBps <= 10_000) || !(approvalAboveBps > 0 && approvalAboveBps <= 10_000)) {
      this.error = 'Budget dates, amount and valid thresholds are required';
      return;
    }
    this.run(
      this.api.post('/api/v1/pos/happy-hours/budget', { periodStart: this.budgetDraft.periodStart, periodEnd: this.budgetDraft.periodEnd, budgetPaise, alertThresholdBps, approvalAboveBps }),
      'Budget saved',
      false,
      () => { this.loadBudget(); this.loadAudit(); },
    );
  }

  loadAudit(): void {
    this.api.get<any>('/api/v1/pos/happy-hours/audit').subscribe({
      next: (response) => this.auditLog = this.rows(response),
      error: () => this.auditLog = [],
    });
  }

  loadWebhooks(): void {
    this.api.get<any>('/api/v1/settings/integrations/webhooks').subscribe({
      next: (response) => this.webhooks = this.rows(response).filter((row) => Array.isArray(row.events) && row.events.some((event: string) => event.startsWith('happy_hours.'))),
      error: () => this.webhooks = [],
    });
    this.api.get<any>('/api/v1/settings/integrations/webhook-deliveries').subscribe({
      next: (response) => this.webhookDeliveries = this.rows(response).filter((row) => String(row.eventType || '').startsWith('happy_hours.')),
      error: () => this.webhookDeliveries = [],
    });
  }

  saveWebhook(): void {
    if (!this.webhookDraft.name.trim() || !/^https?:\/\//i.test(this.webhookDraft.endpointUrl.trim())) {
      this.error = 'Webhook name and HTTP(S) endpoint are required';
      return;
    }
    this.busy = true;
    this.error = '';
    this.webhookSecret = '';
    this.api.post<any>('/api/v1/settings/integrations/webhooks', {
      name: this.webhookDraft.name.trim(),
      endpointUrl: this.webhookDraft.endpointUrl.trim(),
      events: ['happy_hours.rule.created', 'happy_hours.rule.updated', 'happy_hours.approval.requested', 'happy_hours.approval.approved', 'happy_hours.approval.rejected', 'happy_hours.discount_approval.requested', 'happy_hours.discount_approval.approved', 'happy_hours.discount_approval.rejected', 'happy_hours.coupon_abuse.scanned', 'happy_hours.coupon_abuse.resolved', 'happy_hours.anomalies.scanned', 'happy_hours.anomaly.reviewed', 'happy_hours.fraud.scanned', 'happy_hours.fraud.reviewed', 'happy_hours.budget.updated'],
    }).subscribe({
      next: (response) => {
        this.busy = false;
        this.webhookSecret = response?.data?.signingSecret ?? response?.signingSecret ?? '';
        this.webhookDraft = { name: '', endpointUrl: '' };
        this.message = 'Webhook created';
        this.loadWebhooks();
      },
      error: (error) => { this.busy = false; this.error = this.errorText(error, 'Webhook could not be created'); },
    });
  }

  testWebhook(row: HappyHourWebhook): void {
    this.run(this.api.post(`/api/v1/settings/integrations/webhooks/${encodeURIComponent(row.id)}/test`, {}), 'Webhook test queued', false, () => this.loadWebhooks());
  }

  deactivateWebhook(row: HappyHourWebhook): void {
    this.run(this.api.delete(`/api/v1/settings/integrations/webhooks/${encodeURIComponent(row.id)}`), 'Webhook disabled', false, () => this.loadWebhooks());
  }

  openCreate(): void {
    this.drawerMode = 'rule';
    this.editingId = '';
    this.draft = this.emptyDraft();
    this.drawerOpen = true;
    this.message = '';
    this.error = '';
  }

  offerLaunchpad(): OfferPreset[] {
    return [
      { key: 'demand', title: 'Demand fill', metric: `${this.controlTower?.summary.collectingRules ?? 0} collecting`, action: 'Create off-peak rule' },
      { key: 'winback', title: 'Win-back audience', metric: `${this.clientReturnTracker?.summary.atRiskCount ?? 0} at risk`, action: 'Build return campaign' },
      { key: 'firstVisit', title: 'First-visit hook', metric: `${this.couponAnalytics.length} tracked coupons`, action: 'Create entry coupon' },
      { key: 'market', title: 'Market match', metric: `${this.marketSuggestions.length} suggestions`, action: 'Evaluate price gap' },
      { key: 'adaptive', title: 'Adaptive trigger', metric: `${this.contextOfferSuggestions.length} saved`, action: 'Evaluate context' },
    ];
  }

  launchPreset(key: OfferPreset['key']): void {
    this.message = '';
    this.error = '';
    if (key === 'demand') {
      this.openCreate();
      this.draft = { ...this.emptyDraft(), name: 'Demand Fill Happy Hour', startTime: '14:00', endTime: '17:00', weekdays: [1, 2, 3, 4], discountPercent: '15', minMarginPercent: '35' };
      return;
    }
    if (key === 'winback') {
      this.openAudience();
      this.audienceDraft = { ...this.emptyAudienceDraft(), name: 'Win Back Happy Hours', inactiveDays: '45', visitCount: '1', status: 'ready' };
      return;
    }
    if (key === 'firstVisit') {
      this.openCoupon();
      this.couponDraft = { ...this.emptyCouponDraft(), code: 'FIRST-VISIT', discountValue: '15', perClientLimit: '1', offerType: 'first_visit' };
      return;
    }
    if (key === 'market') {
      this.tab = 'marketAware';
      this.marketDraft = { ...this.emptyMarketDraft(), hourSlot: '14', baseDiscount: '10', maxDiscount: '25' };
      return;
    }
    this.tab = 'contextAware';
    this.contextOfferDraft = { ...this.emptyContextOfferDraft(), offerType: 'lead_time', hourSlot: '14', baseDiscount: '10', maxDiscount: '25', bookingLeadMinutes: '1440' };
  }

  openEdit(rule: HappyHourRule): void {
    this.drawerMode = 'rule';
    const scope = this.scope(rule);
    this.editingId = rule.id;
    this.draft = {
      name: rule.name,
      startTime: String(rule.startTime || '').slice(0, 5),
      endTime: String(rule.endTime || '').slice(0, 5),
      weekdays: [...rule.weekdays],
      discountPercent: this.percentInput(rule.discountBps),
      scope,
      eligibleItemIds: [...rule.eligibleItemIds],
      clientCategories: rule.eligibleClientCategories.join(', '),
      minMarginPercent: rule.minMarginBps ? this.percentInput(rule.minMarginBps) : '',
      blockOnUnknownCost: rule.blockOnUnknownCost,
      active: rule.active,
    };
    this.drawerOpen = true;
    this.message = '';
    this.error = '';
  }

  openCoupon(): void {
    this.drawerMode = 'coupon';
    this.couponDraft = this.emptyCouponDraft();
    this.editingId = '';
    this.drawerOpen = true;
    this.message = '';
    this.error = '';
  }

  openAudience(): void {
    this.drawerMode = 'audience';
    this.audienceDraft = this.emptyAudienceDraft();
    this.audiencePreview = null;
    this.drawerOpen = true;
    this.message = '';
    this.error = '';
  }

  openCampaignLink(): void {
    this.drawerMode = 'campaignLink';
    this.campaignLinkDraft = this.emptyCampaignLinkDraft();
    this.drawerOpen = true;
    this.message = '';
    this.error = '';
  }

  openMarketObservation(): void {
    this.drawerMode = 'marketObservation';
    this.marketObservationDraft = this.emptyMarketObservationDraft();
    this.drawerOpen = true;
    this.message = '';
    this.error = '';
  }

  closeDrawer(): void {
    if (this.busy) return;
    this.drawerOpen = false;
    this.editingId = '';
  }

  save(): void {
    const payload = this.payload(this.draft);
    if (!payload) return;
    const request = this.editingId
      ? this.api.patch(`/api/v1/pos/happy-hours/rules/${encodeURIComponent(this.editingId)}`, payload)
      : this.api.post('/api/v1/pos/happy-hours/rules', payload);
    this.run(request, this.editingId ? 'Happy Hour updated' : 'Happy Hour created', true);
  }

  saveCoupon(): void {
    const payload = this.couponPayload();
    if (!payload) return;
    this.run(
      this.api.post('/api/v1/pos/coupons', payload),
      'Coupon created',
      true,
      () => { this.loadCoupons(); this.loadIntelligence(); },
    );
  }

  saveDrawer(): void {
    if (this.drawerMode === 'coupon') return this.saveCoupon();
    if (this.drawerMode === 'audience') return this.saveCampaignAudience();
    if (this.drawerMode === 'campaignLink') return this.saveCampaignLink();
    if (this.drawerMode === 'marketObservation') return this.saveMarketObservation();
    this.save();
  }

  previewCampaignAudience(): void {
    const payload = this.audiencePayload();
    if (!payload || this.busy) return;
    this.busy = true;
    this.error = '';
    this.api.post<any>('/api/v1/pos/happy-hours/audiences/preview', payload).subscribe({
      next: (response) => { this.audiencePreview = response?.data ?? response; this.busy = false; },
      error: (error) => { this.busy = false; this.error = this.errorText(error, 'Audience could not be previewed'); },
    });
  }

  saveCampaignAudience(): void {
    const payload = this.audiencePayload();
    if (!payload) return;
    this.run(this.api.post('/api/v1/pos/happy-hours/audiences', payload), 'Audience saved', true, () => this.loadAudiences());
  }

  saveCampaignLink(): void {
    const payload = this.campaignLinkPayload();
    if (!payload) return;
    this.run(this.api.post('/api/v1/pos/happy-hours/campaign-links', payload), 'Campaign link saved', true, () => this.loadCampaignLinks());
  }

  setAudienceStatus(row: Audience, status: 'ready' | 'archived'): void {
    this.run(this.api.patch(`/api/v1/pos/happy-hours/audiences/${encodeURIComponent(row.id)}/status`, { status }), 'Audience updated', false, () => this.loadAudiences());
  }

  setCampaignLinkStatus(row: CampaignLink, status: 'ready' | 'archived'): void {
    this.run(this.api.patch(`/api/v1/pos/happy-hours/campaign-links/${encodeURIComponent(row.id)}/status`, { status }), 'Campaign link updated', false, () => this.loadCampaignLinks());
  }

  evaluateMarketOffer(): void {
    const payload = this.marketPayload();
    if (!payload || this.busy) return;
    this.busy = true;
    this.error = '';
    this.api.post<any>('/api/v1/pos/happy-hours/market-aware/evaluate', payload).subscribe({
      next: (response) => { this.marketEvaluation = response?.data ?? response; this.busy = false; },
      error: (error) => { this.busy = false; this.error = this.errorText(error, 'Market offer could not be evaluated'); },
    });
  }

  saveMarketSuggestion(): void {
    const payload = this.marketPayload();
    if (!payload) return;
    this.run(
      this.api.post('/api/v1/pos/happy-hours/market-aware/suggestions', payload),
      'Market suggestion saved',
      false,
      () => this.loadMarketAware(),
    );
  }

  saveMarketObservation(): void {
    const payload = this.marketObservationPayload();
    if (!payload) return;
    this.run(
      this.api.post('/api/v1/pos/happy-hours/market-aware/observations', payload),
      'Market observation saved',
      true,
      () => this.loadMarketAware(),
    );
  }

  setMarketSuggestionStatus(row: MarketSuggestion, status: 'approved' | 'paused' | 'archived'): void {
    this.run(
      this.api.patch(`/api/v1/pos/happy-hours/market-aware/suggestions/${encodeURIComponent(row.id)}/status`, { status }),
      'Market suggestion updated',
      false,
      () => this.loadMarketAware(),
    );
  }

  evaluateContextOffer(): void {
    const payload = this.contextOfferPayload();
    if (!payload || this.busy) return;
    this.busy = true;
    this.error = '';
    this.api.post<any>('/api/v1/pos/happy-hours/context-aware/evaluate', payload).subscribe({
      next: (response) => { this.contextOfferEvaluation = response?.data ?? response; this.busy = false; },
      error: (error) => { this.busy = false; this.error = this.errorText(error, 'Context-aware offer could not be evaluated'); },
    });
  }

  saveContextOfferSuggestion(): void {
    const payload = this.contextOfferPayload();
    if (!payload) return;
    this.run(
      this.api.post('/api/v1/pos/happy-hours/context-aware/suggestions', payload),
      'Context-aware suggestion saved', false, () => this.loadContextAware(),
    );
  }

  setContextOfferSuggestionStatus(row: ContextOfferSuggestion, status: 'approved' | 'paused' | 'archived'): void {
    this.run(
      this.api.patch(`/api/v1/pos/happy-hours/context-aware/suggestions/${encodeURIComponent(row.id)}/status`, { status }),
      'Context-aware suggestion updated', false, () => this.loadContextAware(),
    );
  }

  saveAutoSunsetPolicy(): void {
    this.run(
      this.api.post('/api/v1/pos/happy-hours/auto-sunset/policy', this.autoSunsetPolicy),
      'Auto-sunset policy saved', false, () => this.loadAutoSunset(),
    );
  }

  scanAutoSunset(apply: boolean): void {
    this.run(
      this.api.post('/api/v1/pos/happy-hours/auto-sunset/scan', { apply }),
      apply ? 'Auto-sunset scan applied' : 'Auto-sunset scan complete', false,
      () => { this.loadAutoSunset(); this.load(); this.loadCoupons(); },
    );
  }

  applyAutoSunsetDecision(row: AutoSunsetDecision): void {
    this.run(
      this.api.post(`/api/v1/pos/happy-hours/auto-sunset/decisions/${encodeURIComponent(row.id)}/apply`, {}),
      'Auto-sunset decision applied', false,
      () => { this.loadAutoSunset(); this.load(); this.loadCoupons(); },
    );
  }

  toggle(rule: HappyHourRule): void {
    this.run(
      this.api.patch(`/api/v1/pos/happy-hours/rules/${encodeURIComponent(rule.id)}`, this.rulePayload(rule, !rule.active)),
      rule.active ? 'Happy Hour disabled' : 'Happy Hour updated',
    );
  }

  setName(value: string): void { this.draft.name = this.titleCase(value); }
  setCategories(value: string): void { this.draft.clientCategories = this.titleCase(value); }
  setCouponCode(value: string): void { this.couponDraft.code = value.toUpperCase().replace(/\s+/g, '-'); }
  setAudienceName(value: string): void { this.audienceDraft.name = this.titleCase(value); }
  setCampaignTitle(value: string): void { this.campaignLinkDraft.title = this.titleCase(value); }
  setMarketCategory(value: string): void { this.marketDraft.serviceCategory = this.titleCase(value); }
  setObservationCategory(value: string): void { this.marketObservationDraft.serviceCategory = this.titleCase(value); }
  setCompetitorName(value: string): void { this.marketObservationDraft.competitorName = this.titleCase(value); }
  setContextCategory(value: string): void { this.contextOfferDraft.serviceCategory = this.titleCase(value); }
  setContextEventName(value: string): void { this.contextOfferDraft.eventName = this.titleCase(value); }

  setScope(scope: RuleScope): void {
    this.draft.scope = scope;
    this.draft.eligibleItemIds = [];
  }

  toggleDay(day: number): void {
    this.draft.weekdays = this.draft.weekdays.includes(day)
      ? this.draft.weekdays.filter((value) => value !== day)
      : [...this.draft.weekdays, day];
  }

  dayLabel(days: number[]): string {
    return days.length === 7 ? 'Every day' : this.weekDays.filter((day) => days.includes(day.value)).map((day) => day.label).join(', ');
  }

  scopeLabel(rule: HappyHourRule): string {
    const scope = this.scope(rule);
    if (scope === 'all') return 'All items';
    return `${scope === 'service' ? 'Services' : 'Products'} · ${rule.eligibleItemIds.length || 'All'}`;
  }

  catalogName(item: CatalogItem): string { return item.name || item.serviceName || item.productName || [item.firstName, item.lastName].filter(Boolean).join(' ') || item.id; }
  availableItems(): CatalogItem[] { return this.draft.scope === 'product' ? this.products : this.services; }
  money(paise: number): number { return Number(paise || 0) / 100; }
  efficiency(value: number): string { return value ? `${(value / 10000).toFixed(2)}x` : 'Collecting'; }
  percent(value: number): string { return `${(Number(value || 0) / 100).toFixed(0)}%`; }
  couponDiscount(coupon: Coupon): string {
    return coupon.discountType === 'percent' ? `${coupon.discountBps / 100}%` : `₹${this.money(coupon.discountValuePaise).toFixed(2)}`;
  }
  couponTarget(coupon: Coupon): string {
    if (coupon.offerType === 'service_specific') return `${coupon.targetServiceIds.length} services · ${coupon.targetServiceCategories.length} categories`;
    if (coupon.offerType === 'segment') return coupon.targetClientSegments.join(', ') || 'Segment';
    if (coupon.offerType === 'branch_specific') return 'Current branch';
    return this.actionLabel(coupon.offerType);
  }
  displayDate(value: string | null): string {
    const match = String(value || '').slice(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})$/);
    return match ? `${match[3]}/${match[2]}/${match[1]}` : '—';
  }
  actionLabel(value: string): string { return value.replace(/_/g, ' '); }
  criteriaLabel(criteria: AudienceCriteria): string {
    const values = [
      criteria.inactiveDaysGte !== undefined ? `Inactive ${criteria.inactiveDaysGte}+ days` : '',
      criteria.visitCountGte !== undefined ? `${criteria.visitCountGte}+ visits` : '',
      criteria.totalSpendPaiseGte !== undefined ? `Spend ₹${this.money(criteria.totalSpendPaiseGte).toFixed(0)}+` : '',
      criteria.birthdayMonth !== undefined ? `Birthday month ${criteria.birthdayMonth}` : '',
      criteria.clientType ? `${criteria.clientType} clients` : '',
    ].filter(Boolean);
    return values.join(' · ') || 'All consented clients';
  }
  contextSignalLabel(type: ContextOfferType, context: Record<string, any>): string {
    if (type === 'bundle') return `${context.packageCount || 0} packages · ${this.percent(context.averagePackageMarginBps || 0)} margin`;
    if (type === 'channel') return `${context.sourceChannel || '—'} · ${(context.channelBookingCount || 0) + (context.channelSalesCount || 0)} records`;
    if (type === 'lead_time') return `${context.leadTimeBucket || '—'} · ${context.bookingLeadMinutes || 0} min`;
    if (type === 'member_wallet') return `₹${this.money(context.walletBalancePaise || 0).toFixed(0)} wallet · ${context.membershipCreditsRemaining || 0} credits`;
    return `${this.actionLabel(context.weatherCondition || 'normal')} · ${this.actionLabel(context.eventType || 'none')}`;
  }
  readyAudiences(): Audience[] { return this.audiences.filter((row) => row.status === 'ready'); }
  activeRules(): HappyHourRule[] { return this.rules.filter((row) => row.active); }
  inactiveRules(): HappyHourRule[] { return this.rules.filter((row) => !row.active); }
  activeCoupons(): Coupon[] { return this.coupons.filter((row) => row.active); }

  private loadCatalog(): void {
    this.readCatalog('/api/v1/services', 'services', (rows) => this.services = rows);
    this.readCatalog('/api/v1/inventory?pageSize=200', 'products', (rows) => this.products = rows);
    this.readCatalog('/api/v1/clients', 'clients', (rows) => this.clients = rows);
  }

  private readCatalog(path: string, label: string, assign: (rows: CatalogItem[]) => void): void {
    this.api.get<any>(path).subscribe({
      next: (response) => { this.catalogFailures.delete(label); assign(this.rows(response)); },
      error: () => { this.catalogFailures.add(label); },
    });
  }

  catalogError(): string {
    return this.catalogFailures.size ? `Unable to load ${[...this.catalogFailures].join(', ')}` : '';
  }

  private run(request: Observable<any>, success: string, close = false, reload: () => void = () => this.load()): void {
    if (this.busy) return;
    this.busy = true;
    this.error = '';
    this.message = '';
    request.subscribe({
      next: () => {
        this.busy = false;
        if (close) this.closeDrawer();
        reload();
        this.message = success;
      },
      error: (error) => { this.busy = false; this.error = this.errorText(error, 'Happy Hour could not be saved'); },
    });
  }

  private couponPayload(): any | null {
    const draft = this.couponDraft;
    const value = Number(draft.discountValue);
    const minSubtotalPaise = this.toPaise(draft.minSubtotal);
    const maxDiscountPaise = this.toPaise(draft.maxDiscount);
    const usageLimit = draft.usageLimit === '' ? null : Number(draft.usageLimit);
    const perClientLimit = draft.perClientLimit === '' ? 0 : Number(draft.perClientLimit);
    const targetServiceCategories = draft.serviceCategories.split(',').map((item) => item.trim()).filter(Boolean);
    const targetClientSegments = draft.clientSegments.split(',').map((item) => item.trim()).filter(Boolean);
    if (!draft.code.trim() || !Number.isFinite(value) || value <= 0 || (draft.discountType === 'percent' && value > 100) || !Number.isFinite(minSubtotalPaise) || !Number.isFinite(maxDiscountPaise) || (usageLimit !== null && (!Number.isInteger(usageLimit) || usageLimit <= 0)) || !Number.isInteger(perClientLimit) || perClientLimit < 0 || (draft.startDate && draft.endDate && draft.endDate < draft.startDate)) {
      this.error = 'Code and a valid discount are required';
      return null;
    }
    if (draft.offerType === 'service_specific' && !draft.targetServiceIds.length && !targetServiceCategories.length) {
      this.error = 'Select a service or enter a service category'; return null;
    }
    if (draft.offerType === 'segment' && !targetClientSegments.length) {
      this.error = 'Enter at least one client segment'; return null;
    }
    return {
      code: draft.code.trim(), discountType: draft.discountType,
      discountValuePaise: draft.discountType === 'amount' ? Math.round(value * 100) : 0,
      discountBps: draft.discountType === 'percent' ? Math.round(value * 100) : 0,
      minSubtotalPaise, maxDiscountPaise, active: draft.active,
      startsAt: draft.startDate ? `${draft.startDate}T00:00:00Z` : null,
      endsAt: draft.endDate ? `${draft.endDate}T23:59:59Z` : null,
      usageLimit, perClientLimit, offerType: draft.offerType,
      targetServiceIds: draft.targetServiceIds,
      targetServiceCategories,
      targetClientSegments,
    };
  }

  private audiencePayload(): any | null {
    const draft = this.audienceDraft;
    if (!draft.name.trim()) { this.error = 'Audience name is required'; return null; }
    const criteria: any = {};
    if (!this.optionalWholeNumber(draft.inactiveDays, 'Inactive days', criteria, 'inactiveDaysGte')) return null;
    if (!this.optionalWholeNumber(draft.visitCount, 'Visit count', criteria, 'visitCountGte')) return null;
    if (draft.minimumSpend !== '') {
      const paise = this.toPaise(draft.minimumSpend);
      if (!Number.isFinite(paise) || paise < 0) { this.error = 'Minimum spend is invalid'; return null; }
      criteria.totalSpendPaiseGte = paise;
    }
    if (draft.birthdayMonth !== '') {
      const month = Number(draft.birthdayMonth);
      if (!Number.isInteger(month) || month < 1 || month > 12) { this.error = 'Birthday month must be 1 to 12'; return null; }
      criteria.birthdayMonth = month;
    }
    if (draft.clientType) criteria.clientType = draft.clientType;
    return { name: draft.name.trim(), channel: draft.channel, status: draft.status, criteria };
  }

  private campaignLinkPayload(): any | null {
    const draft = this.campaignLinkDraft;
    if (!draft.audienceId || !draft.ruleId || !draft.title.trim() || !draft.message.trim()) {
      this.error = 'Audience, rule, title and message are required';
      return null;
    }
    return { audienceId: draft.audienceId, ruleId: draft.ruleId, couponId: draft.couponId || null, title: draft.title.trim(), message: draft.message.trim(), status: draft.status };
  }

  private marketPayload(): any | null {
    const draft = this.marketDraft;
    if (!draft.serviceCategory.trim()) { this.error = 'Service category is required'; return null; }
    const hourSlot = draft.hourSlot === '' ? null : Number(draft.hourSlot);
    const ourPricePaise = draft.ourPrice === '' ? null : this.toPaise(draft.ourPrice);
    const baseDiscountBps = draft.baseDiscount === '' ? null : this.bps(draft.baseDiscount);
    const maxDiscountBps = draft.maxDiscount === '' ? null : this.bps(draft.maxDiscount);
    if ((hourSlot !== null && (!Number.isInteger(hourSlot) || hourSlot < 0 || hourSlot > 23))
      || (ourPricePaise !== null && (!Number.isFinite(ourPricePaise) || ourPricePaise <= 0))
      || (baseDiscountBps !== null && (!Number.isFinite(baseDiscountBps) || baseDiscountBps < 0 || baseDiscountBps > 4000))
      || (maxDiscountBps !== null && (!Number.isFinite(maxDiscountBps) || maxDiscountBps < 0 || maxDiscountBps > 4000))
      || (baseDiscountBps !== null && maxDiscountBps !== null && baseDiscountBps > maxDiscountBps)) {
      this.error = 'Price, hour or discount range is invalid';
      return null;
    }
    const payload: any = { serviceCategory: draft.serviceCategory.trim() };
    if (draft.signalDate) payload.signalDate = draft.signalDate;
    if (hourSlot !== null) payload.hourSlot = hourSlot;
    if (ourPricePaise !== null) payload.ourPricePaise = ourPricePaise;
    if (baseDiscountBps !== null) payload.baseDiscountBps = baseDiscountBps;
    if (maxDiscountBps !== null) payload.maxDiscountBps = maxDiscountBps;
    return payload;
  }

  private marketObservationPayload(): any | null {
    const draft = this.marketObservationDraft;
    const observedPricePaise = this.toPaise(draft.observedPrice);
    if (!draft.serviceCategory.trim() || !draft.competitorName.trim() || !draft.observedOn
      || !Number.isFinite(observedPricePaise) || observedPricePaise <= 0) {
      this.error = 'Category, competitor, date and price are required';
      return null;
    }
    return {
      serviceCategory: draft.serviceCategory.trim(), competitorName: draft.competitorName.trim(),
      observedPricePaise, observedOn: draft.observedOn, sourceUrl: draft.sourceUrl.trim() || null,
    };
  }

  private contextOfferPayload(): any | null {
    const draft = this.contextOfferDraft;
    if (!draft.serviceCategory.trim()) { this.error = 'Service category is required'; return null; }
    const payload: any = { offerType: draft.offerType, serviceCategory: draft.serviceCategory.trim() };
    const add = (value: string, key: string, multiplier: number, min: number, max: number, integer = false): boolean => {
      if (value === '') return true;
      const number = Number(value);
      if (!Number.isFinite(number) || number < min || number > max || (integer && !Number.isInteger(number))) {
        this.error = 'Context offer values are invalid';
        return false;
      }
      payload[key] = Math.round(number * multiplier);
      return true;
    };
    if (draft.signalDate) payload.signalDate = draft.signalDate;
    if (!add(draft.hourSlot, 'hourSlot', 1, 0, 23, true)
      || !add(draft.servicePrice, 'servicePricePaise', 100, 0.01, Number.MAX_SAFE_INTEGER)
      || !add(draft.baseDiscount, 'baseDiscountBps', 100, 0, 40)
      || !add(draft.maxDiscount, 'maxDiscountBps', 100, 0, 40)) return null;
    if (draft.offerType === 'bundle') {
      if (!add(draft.selectedServiceCount, 'selectedServiceCount', 1, 1, 20, true)) return null;
    }
    if ((draft.offerType === 'bundle' || draft.offerType === 'member_wallet')
      && !add(draft.cartTotal, 'cartTotalPaise', 100, 0, Number.MAX_SAFE_INTEGER)) return null;
    if (draft.offerType === 'member_wallet') {
      if (!draft.clientId) { this.error = 'Client is required'; return null; }
      payload.clientId = draft.clientId;
    }
    if (draft.offerType === 'channel') {
      if (!draft.sourceChannel) { this.error = 'Source channel is required'; return null; }
      payload.sourceChannel = draft.sourceChannel;
      if (!add(draft.channelFee, 'channelFeeBps', 100, 0, 40)) return null;
    }
    if (draft.offerType === 'lead_time'
      && !add(draft.bookingLeadMinutes, 'bookingLeadMinutes', 1, 0, 129600, true)) return null;
    if (draft.offerType === 'weather_event') {
      payload.weatherCondition = draft.weatherCondition;
      payload.eventType = draft.eventType;
      if (draft.eventName.trim()) payload.eventName = draft.eventName.trim();
      if (!add(draft.temperatureCelsius, 'temperatureCelsius', 1, -50, 60, true)
        || !add(draft.rainProbabilityPercent, 'rainProbabilityPercent', 1, 0, 100, true)
        || !add(draft.expectedFootfall, 'expectedFootfall', 1, 0, Number.MAX_SAFE_INTEGER, true)) return null;
    }
    return payload;
  }

  private payload(draft: RuleDraft): any | null {
    const discountBps = this.bps(draft.discountPercent);
    const minMarginBps = draft.minMarginPercent === '' ? 0 : this.bps(draft.minMarginPercent);
    if (!draft.name.trim() || !draft.startTime || !draft.endTime || !draft.weekdays.length || !Number.isFinite(discountBps) || discountBps < 1 || discountBps > 10000 || !Number.isFinite(minMarginBps) || minMarginBps < 0 || minMarginBps > 10000) {
      this.error = 'Name, time, days and a valid discount are required';
      return null;
    }
    return {
      name: draft.name.trim(), startTime: draft.startTime, endTime: draft.endTime,
      weekdays: draft.weekdays, discountBps,
      eligibleLineTypes: draft.scope === 'all' ? [] : [draft.scope],
      eligibleItemIds: draft.eligibleItemIds,
      eligibleClientCategories: draft.clientCategories.split(',').map((value) => value.trim()).filter(Boolean),
      minMarginBps, blockOnUnknownCost: draft.blockOnUnknownCost, active: draft.active,
    };
  }

  private rulePayload(rule: HappyHourRule, active: boolean): any {
    return {
      name: rule.name, startTime: String(rule.startTime).slice(0, 5), endTime: String(rule.endTime).slice(0, 5),
      weekdays: rule.weekdays, discountBps: rule.discountBps,
      eligibleLineTypes: rule.eligibleLineTypes, eligibleItemIds: rule.eligibleItemIds,
      eligibleClientCategories: rule.eligibleClientCategories, minMarginBps: rule.minMarginBps,
      blockOnUnknownCost: rule.blockOnUnknownCost, active,
    };
  }

  private emptyDraft(): RuleDraft {
    return { name: '', startTime: '', endTime: '', weekdays: [], discountPercent: '', scope: 'all', eligibleItemIds: [], clientCategories: '', minMarginPercent: '', blockOnUnknownCost: true, active: true };
  }

  private emptyCouponDraft(): CouponDraft {
    return { code: '', discountType: 'percent', discountValue: '', minSubtotal: '', maxDiscount: '', startDate: '', endDate: '', usageLimit: '', perClientLimit: '', offerType: 'generic', targetServiceIds: [], serviceCategories: '', clientSegments: '', active: true };
  }

  private emptyAudienceDraft(): AudienceDraft {
    return { name: '', channel: 'whatsapp', status: 'draft', inactiveDays: '', visitCount: '', minimumSpend: '', birthdayMonth: '', clientType: '' };
  }

  private emptyCampaignLinkDraft(): CampaignLinkDraft {
    return { audienceId: '', ruleId: '', couponId: '', title: '', message: '', status: 'draft' };
  }

  private emptyMarketDraft(): MarketDraft {
    return { serviceCategory: '', signalDate: '', hourSlot: '', ourPrice: '', baseDiscount: '', maxDiscount: '' };
  }

  private emptyMarketObservationDraft(): MarketObservationDraft {
    return { serviceCategory: '', competitorName: '', observedPrice: '', observedOn: this.todayIso(), sourceUrl: '' };
  }

  private emptyContextOfferDraft(): ContextOfferDraft {
    return {
      offerType: 'bundle', serviceCategory: '', clientId: '', signalDate: '', hourSlot: '', servicePrice: '',
      baseDiscount: '', maxDiscount: '', selectedServiceCount: '', cartTotal: '', sourceChannel: '',
      channelFee: '', bookingLeadMinutes: '', weatherCondition: 'normal', temperatureCelsius: '',
      rainProbabilityPercent: '', eventType: 'none', eventName: '', expectedFootfall: '',
    };
  }

  private defaultAutoSunsetPolicy(): AutoSunsetPolicy {
    return {
      expirePastEndDate: true, pauseCouponsAtUsageLimit: true, reviewNoEndDateAfterDays: 30,
      autoApplyExpired: true, autoApplyUsageLimit: true, autoApplyStale: false, status: 'active',
    };
  }

  private scope(rule: HappyHourRule): RuleScope {
    return rule.eligibleLineTypes.includes('product') ? 'product' : rule.eligibleLineTypes.includes('service') ? 'service' : 'all';
  }

  private rows(response: any): any[] { const value = response?.data ?? response; return Array.isArray(value) ? value : Array.isArray(value?.rows) ? value.rows : []; }
  private bps(value: string): number { return Math.round(Number(value) * 100); }
  private toPaise(value: string): number { return value === '' ? 0 : Math.round(Number(value) * 100); }
  private optionalWholeNumber(value: string, label: string, target: any, key: string): boolean {
    if (value === '') return true;
    const number = Number(value);
    if (!Number.isInteger(number) || number < 0) { this.error = `${label} is invalid`; return false; }
    target[key] = number;
    return true;
  }
  private percentInput(value: number): string { return String(Number(value || 0) / 100); }
  private todayIso(): string {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  }
  private titleCase(value: string): string { return value.toLowerCase().replace(/(^|[\s,])([a-z])/g, (_, prefix, letter) => `${prefix}${letter.toUpperCase()}`); }
  private errorText(error: any, fallback: string): string { return error?.error?.error?.message ?? error?.error?.message ?? error?.message ?? fallback; }
}
