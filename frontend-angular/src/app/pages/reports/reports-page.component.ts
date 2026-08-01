import { CommonModule } from '@angular/common';
import { Component, OnDestroy, OnInit, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { firstValueFrom, Subject, takeUntil } from 'rxjs';
import { DatePickerComponent } from '../../shared/date-picker/date-picker.component';
import { ApiService } from '../../shared/services/api.service';
import { AuthService } from '../../core/services/auth.service';
import { BranchNamePipe } from '../../shared/pipes/branch-name.pipe';
import { LanguageService } from '../../core/i18n/language.service';
import { TranslatePipe } from '../../shared/pipes/translate.pipe';

type ReportItem = {
  id: string;
  title: string;
  category: string;
  description: string;
  icon?: string;
  path: string;
};

type ReportCategory = { name: string; reports: ReportItem[] };
type ProfitTab = 'overview' | 'executive' | 'reconciliation' | 'service' | 'category' | 'staff' | 'customer' | 'product' | 'appointment' | 'branch' | 'channel' | 'booking' | 'liability' | 'scenario' | 'guard' | 'leaks' | 'pricing' | 'recipe' | 'copilot' | 'actions' | 'rules' | 'approvals' | 'audit';
type ProfitScope = 'branch' | 'tenant';
type ProfitLevel = 'contribution' | 'fullyLoaded';
type ProfitGroup = 'overview' | 'dimensions' | 'insights' | 'governance' | 'tools';
type ProfitDimension = { dimension: string; entityId: string; entityName: string; unitCount: number; revenuePaise: number; discountPaise: number; productCostPaise: number; staffCostPaise: number; staffTimeCostPaise: number; gatewayFeePaise: number; refundFeePaise: number; overheadCostPaise: number; totalCostPaise: number; netProfitPaise: number; marginBps: number; fullyLoadedCostPaise: number; fullyLoadedProfitPaise: number; fullyLoadedMarginBps: number; lineCount: number; incompleteCostLineCount: number; costCompletenessBps: number };
type ProfitLeak = { kind: string; sourceType: string; sourceId: string; title: string; message: string; impactPaise: number; severity: string };
type PricingRecommendation = { serviceId: string; serviceName: string; currentAveragePricePaise: number; suggestedPricePaise: number; currentMarginBps: number; targetMarginBps: number; expectedProfitLiftPaise: number };
type RecipeVariance = { serviceId: string; serviceName: string; soldQuantity: number; recipeItemCount: number; expectedCostPaise: number; actualCostPaise: number; variancePaise: number; varianceBps: number };
type CopilotInsight = { recommendationVersionId: string; recommendationKey: string; recommendationVersion: string; evaluationStatus: string; kind: string; title: string; message: string; impactPaise: number; sourceType: string; sourceId: string };
type ProfitHighlight = { entityId: string; label: string; profitPaise: number; revenuePaise: number };
type ExecutiveProfitKpis = { topService?: ProfitHighlight; topStaff?: ProfitHighlight; topCustomer?: ProfitHighlight; topBranch?: ProfitHighlight; revenuePerStaffPaise: number; revenuePerCustomerPaise: number; revenuePerBranchPaise: number };
type CustomerProfitScore = { customerId: string; customerName: string; revenuePaise: number; profitPaise: number; discountPaise: number; unitCount: number; marginBps: number; profitScore: number; tier: string };
type BookingRecommendation = { serviceId: string; serviceName: string; recommendedHour: number; appointmentCount: number; peakScore: number; expectedRevenuePaise: number; expectedCostPaise: number; expectedProfitPaise: number; marginBps: number; suggestedPriceUpliftBps: number; restrictionReason: string; recommendation: string };
type LiabilityRisk = { kind: string; planId: string; planName: string; soldValuePaise: number; recognizedValuePaise: number; remainingLiabilityPaise: number; projectedCostPaise: number; expectedFutureProfitPaise: number; severity: string; recommendation: string };
type ProfitTrendPoint = { date: string; revenuePaise: number; directCostPaise: number; contributionProfitPaise: number };
type EnterpriseProfitAnalytics = { trend: ProfitTrendPoint[]; nextMonthForecastProfitPaise: number; forecastBasis: string; alerts: string[] };
type ProfitScenario = { name: string; projectedRevenuePaise: number; projectedProfitPaise: number; profitDeltaPaise: number; projectedMarginBps: number };
type ProfitDigitalTwin = { baselineRevenuePaise: number; baselineProfitPaise: number; scenarios: ProfitScenario[] };
type ProfitBoardReport = { topWins: string[]; topRisks: string[]; nextActions: string[]; expectedRecoveryPaise: number };
type AdvancedProfit = { fromDate: string; toDate: string; source: string; branchScope: ProfitScope; branchCount: number; copilotSource: string; copilotModel: string; copilotFactSchemaVersion: string; copilotFactHash: string; copilotEvaluationStatus: string; reconciliationReady: boolean; recommendationsBlocked: boolean; incompleteCostLineCount: number; executiveKpis: ExecutiveProfitKpis; customerProfitScores: CustomerProfitScore[]; serviceProfit: ProfitDimension[]; categoryProfit: ProfitDimension[]; staffProfit: ProfitDimension[]; customerProfit: ProfitDimension[]; productProfit: ProfitDimension[]; appointmentProfit: ProfitDimension[]; branchProfit: ProfitDimension[]; channelProfit: ProfitDimension[]; leaks: ProfitLeak[]; pricing: PricingRecommendation[]; recipeVariance: RecipeVariance[]; bookingRecommendations: BookingRecommendation[]; liabilityRisks: LiabilityRisk[]; enterpriseAnalytics: EnterpriseProfitAnalytics; profitDigitalTwin: ProfitDigitalTwin; boardReport: ProfitBoardReport; copilot: CopilotInsight[] };
type MicroProfitReconciliation = { ledgerRevenuePaise: number; microRevenuePaise: number; revenueVariancePaise: number; revenueBridge: { ledgerRevenuePaise: number; missingInvoiceJournalPaise: number; microRevenuePaise: number; unexplainedVariancePaise: number }; ledgerCogsPaise: number; microProductCostPaise: number; cogsVariancePaise: number; ledgerPayrollPaise: number; payrollSourcePaise: number; payrollVariancePaise: number; reportableLineCount: number; costCompleteLineCount: number; costCompletenessBps: number; missingInvoiceJournalCount: number; missingProductCostLineCount: number; missingStaffCostLineCount: number; missingStaffTimeCostLineCount: number; missingGatewayFeeLineCount: number; missingRefundFeeLineCount: number; allocationRuleCount: number; unallocatedOverheadPaise: number; branchPeriodCloseReady: boolean };
type InvoiceJournalRepairItem = { branchId: string; saleId: string; invoiceNumber: string; businessDate: string; totalPaise: number; periodStatus: string };
type MicroProfitAllocationRule = { id: string; name: string; version: number; driver: string; accountCodes: string[]; effectiveFrom: string; effectiveTo?: string; createdAt: string };
type AllocationRuleDraft = { name: string; driver: string; accountCodes: string[]; effectiveFrom: string; effectiveTo: string };
type AccountDefinition = { code: string; name: string; group: string };
type ProfitAction = { id: string; approvalId?: string; actionType: string; title: string; message: string; impactPaise: number; priority: string; status: string; sourceType: string; sourceId: string; periodStart?: string; periodEnd?: string; ruleKey: string; ownerUserId?: string; ownerName?: string; dueAt?: string; slaMinutes?: number; notes: string; evidenceJson: Record<string, unknown>; baselineImpactPaise: number; expectedImpactPaise: number; realizedImpactPaise: number; occurrenceNumber: number; generatedBy: string; lastObservedAt?: string; createdAt: string; updatedAt: string };
type GovernanceSummary = { configuredRules: number; enabledRules: number; totalEvaluations: number; pendingApprovals: number; approved: number; rejected: number; blocked: number };
type GovernanceRule = { id: string; ruleType: string; title: string; description: string; enabled: boolean; minMarginBps: number; maxDiscountBps: number; maxImpactPaise: number; approvalRequired: boolean; autoExecuteAllowed: boolean; auditRequired: boolean; severity: string; updatedAt: string };
type GovernanceApproval = { id: string; decisionType: string; sourceType: string; sourceId: string; actionType: string; decision: string; status: string; estimatedProfitPaise: number; marginBps: number; impactPaise: number; message: string; requestedByUserId: string; requestedAt: string; reviewedAt?: string };
type GovernanceAudit = { id: string; decisionId?: string; ruleId?: string; eventType: string; actorUserId: string; detailsJson: unknown; createdAt: string };
type MicroProfitLine = { branchId: string; branchName: string; saleId: string; saleLineId: string; invoiceNumber: string; appointmentId: string; appointmentName: string; channel: string; journalEntryId: string; inventoryMovementIds: string[]; lineType: string; itemName: string; recognizedRevenuePaise: number; productCostPaise: number; staffCostPaise: number; staffTimeCostPaise: number; gatewayFeePaise: number; refundFeePaise: number; overheadCostPaise: number; contributionProfitPaise: number; fullyLoadedProfitPaise: number; costCompletenessBps: number; completenessStatus: string };
type MicroProfitPage = { total: number; rows: MicroProfitLine[] };
type ActionDraft = { actionType: string; title: string; message: string; impactPaise: number | null; expectedImpactPaise: number | null; priority: string; sourceType: string; sourceId: string; periodStart: string; periodEnd: string; slaMinutes: number | null; notes: string; evidence: string };
type PosGuardDecision = { decision: { decision: string; status: string; estimatedProfitPaise: number; marginBps: number; discountBps: number; message: string; reasonCodes: string[] }; approval?: { id: string; status: string } };
type CustomReportDefinition = { dataset: string; rowDimension: string; columnDimension: string; metric: string; dateRange: string; fromDate?: string; toDate?: string; status?: string; profitView?: { tab: ProfitTab; level: ProfitLevel; scope: ProfitScope; comparePrevious: boolean; actionStatus: string; actionPriority: string } };
type CustomReportDraft = { id?: string; version?: number; name: string; definition: CustomReportDefinition; scheduleFrequency: string; scheduleDay: number; scheduleTime: string; recipientEmail: string };
type CustomReport = CustomReportDraft & { nextRunAt?: string; lastRunAt?: string; lastStatus: string; lastError: string; active: boolean; createdAt: string; updatedAt: string };
type CustomDataset = { id: string; label: string; dimensions: string[]; metrics: string[] };
type CustomReportOptions = { datasets: CustomDataset[]; dateRanges: string[]; schedules: string[] };
type PivotReport = { dataset: string; metric: string; fromDate: string; toDate: string; rows: string[]; columns: string[]; cells: Array<{ rowKey: string; columnKey: string; value: number }>; total: number };
type LiveReportState = { report: ReportItem; rows: Array<Record<string, unknown>>; columns: string[]; summary: Record<string, unknown> };
type ProfitDialog = { kind: 'saveView' | 'actionTransition' | 'governanceReview' | 'periodClose'; titleKey: string; name: string; note: string; evidence: string; realizedImpactInr: number | null; action?: ProfitAction; transition?: 'approve' | 'complete' | 'dismiss'; approval?: GovernanceApproval; decision?: 'approve' | 'reject' };

const LEGACY_REPORT_METADATA: Record<string, Pick<ReportItem, 'category' | 'description' | 'icon'>> = {
  dashboard: { category: 'Overview', description: "Appointments, clients, services and today's sales at a glance.", icon: 'dashboard' },
  appointments: { category: 'Appointments', description: 'Appointment counts and service time grouped by day and status.', icon: 'calendar' },
  sales: { category: 'Sales & Finance', description: 'Total, paid and outstanding sales for the selected period.', icon: 'sales' },
  'invoice-activity': { category: 'Sales & Finance', description: 'Invoice notifications and delivery activity.', icon: 'invoice' },
  'due-recovery': { category: 'Sales & Finance', description: 'Outstanding invoice balances and follow-up status.', icon: 'recovery' },
  'service-trends': { category: 'Sales & Finance', description: 'Service revenue, quantity, discount, GST, cost and margin trends.', icon: 'sales' },
  'service-clients': { category: 'Customer', description: 'Clients, staff and invoices linked to each sold service.', icon: 'clients' },
  'product-sales': { category: 'Sales & Finance', description: 'Product revenue, quantities, discounts, GST, cost and margin.', icon: 'product' },
  'product-movements': { category: 'Inventory', description: 'Product sales, returns, purchases, transfers and current stock.', icon: 'inventory' },
  'payment-modes': { category: 'Sales & Finance', description: 'Payment totals grouped by payment method.', icon: 'payment' },
  'cash-drawer-eod': { category: 'Sales & Finance', description: 'Expected cash, counted cash and variance for day close.', icon: 'cash' },
  'pos-parity': { category: 'Sales & Finance', description: 'Recorded parity checks between POS calculation paths.', icon: 'balance' },
  'staff-performance': { category: 'Staff', description: 'Staff-wise appointment count and billed value for the selected period.', icon: 'staff' },
};

@Component({
    selector: 'page-reports',
    imports: [CommonModule, FormsModule, DatePickerComponent, BranchNamePipe, TranslatePipe],
    templateUrl: './reports-page.component.html',
    styleUrls: ['./reports-page.component.css']
})
export class ReportsPageComponent implements OnInit, OnDestroy {
  private readonly api = inject(ApiService);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  readonly language = inject(LanguageService);
  private readonly favouritesKey = 'aurashine_report_favourites';
  private readonly profitReload$ = new Subject<void>();
  private readonly profitTabReload$ = new Subject<void>();
  private readonly actionReload$ = new Subject<void>();
  private profitRequestId = 0;
  private profitTabRequestId = 0;
  private actionRequestId = 0;
  private advancedView: ProfitTab | '' = '';

  reports: ReportItem[] = [];
  favourites = new Set<string>(this.readFavourites());
  collapsed = new Set<string>();
  search = '';
  activeView: 'all' | 'favourites' = 'all';
  activeCategory = '';
  loading = true;
  error = '';
  profitOpen = false;
  customOpen = false;
  liveOpen = false;
  liveLoading = false;
  liveError = '';
  liveState: LiveReportState | null = null;
  customLoading = false;
  customBusy = false;
  customError = '';
  customReports: CustomReport[] = [];
  customOptions: CustomReportOptions = { datasets: [], dateRanges: [], schedules: [] };
  customDraft = this.blankCustomReport();
  pivot: PivotReport | null = null;
  profitTab: ProfitTab = 'overview';
  profitLoading = false;
  profitError = '';
  /** Set when an optional profit panel fails, so an empty panel is not read as "no data". */
  profitPanelError = '';
  profitScope: ProfitScope = 'branch';
  profitLevel: ProfitLevel = 'contribution';
  comparePrevious = false;
  fromDate = this.dateOffset(-29);
  toDate = this.dateOffset(0);
  advanced: AdvancedProfit | null = null;
  previousAdvanced: AdvancedProfit | null = null;
  reconciliation: MicroProfitReconciliation | null = null;
  invoiceRepairQueue: InvoiceJournalRepairItem[] = [];
  repairBusy = false;
  allocationRules: MicroProfitAllocationRule[] = [];
  allocationAccounts: AccountDefinition[] = [];
  allocationBusy = false;
  allocationDraft = this.blankAllocationRule();
  actions: ProfitAction[] = [];
  governance: GovernanceSummary | null = null;
  governanceRules: GovernanceRule[] = [];
  governanceApprovals: GovernanceApproval[] = [];
  governanceAudit: GovernanceAudit[] = [];
  governanceError = '';
  governanceBusyId = '';
  profitSavedViews: CustomReport[] = [];
  selectedDimensionRow: ProfitDimension | null = null;
  drillLines: MicroProfitLine[] = [];
  drillTotal = 0;
  drillPage = 1;
  drillBusy = false;
  actionStatus = 'active';
  actionPriority = '';
  actionBusyId = '';
  actionDrawerOpen = false;
  actionDraft = this.blankAction();
  scenarioDraft = { priceChangePct: null as number | null, volumeChangePct: null as number | null, staffCostChangePct: null as number | null, wastageReductionPct: null as number | null, overheadChangePct: null as number | null };
  posGuardDraft = { grossAmountPaise: null as number | null, discountPaise: null as number | null, productCostPaise: null as number | null, staffCostPaise: null as number | null, membershipRedemptionPaise: null as number | null };
  posGuardDecision: PosGuardDecision | null = null;
  posGuardBusy = false;
  copilotFeedback: Record<string, 'accepted' | 'rejected'> = {};
  profitDialog: ProfitDialog | null = null;
  periodCloseBusy = false;

  readonly profitTabs: Array<{ id: ProfitTab; label: string }> = [
    { id: 'overview', label: 'Overview' },
    { id: 'executive', label: 'Executive' },
    { id: 'service', label: 'Service' },
    { id: 'category', label: 'Category' },
    { id: 'staff', label: 'Staff' },
    { id: 'customer', label: 'Customer' },
    { id: 'product', label: 'Product' },
    { id: 'appointment', label: 'Appointment' },
    { id: 'branch', label: 'Branch' },
    { id: 'channel', label: 'Channel' },
    { id: 'booking', label: 'Booking Profit' },
    { id: 'liability', label: 'Liability Risk' },
    { id: 'scenario', label: 'Digital Twin' },
    { id: 'guard', label: 'POS Guard' },
    { id: 'reconciliation', label: 'Reconciliation' },
    { id: 'leaks', label: 'Leaks' },
    { id: 'pricing', label: 'Pricing' },
    { id: 'recipe', label: 'Recipe Variance' },
    { id: 'copilot', label: 'Copilot' },
    { id: 'actions', label: 'Action Queue' },
    { id: 'rules', label: 'Governance Rules' },
    { id: 'approvals', label: 'Approvals' },
    { id: 'audit', label: 'Audit' },
  ];
  readonly profitGroups: Array<{ id: ProfitGroup; label: string; tabs: ProfitTab[] }> = [
    { id: 'overview', label: 'Overview', tabs: ['overview', 'executive'] },
    { id: 'dimensions', label: 'Dimensions', tabs: ['service', 'category', 'staff', 'customer', 'product', 'appointment', 'branch', 'channel'] },
    { id: 'insights', label: 'Insights', tabs: ['booking', 'liability', 'leaks', 'pricing', 'recipe', 'copilot', 'actions'] },
    { id: 'governance', label: 'Governance', tabs: ['rules', 'approvals', 'audit'] },
    { id: 'tools', label: 'Tools', tabs: ['scenario', 'guard', 'reconciliation'] },
  ];
  readonly weekdays = [
    { value: 1, label: 'Monday' }, { value: 2, label: 'Tuesday' }, { value: 3, label: 'Wednesday' },
    { value: 4, label: 'Thursday' }, { value: 5, label: 'Friday' }, { value: 6, label: 'Saturday' },
    { value: 7, label: 'Sunday' },
  ];
  readonly monthDays = Array.from({ length: 28 }, (_, index) => index + 1);

  ngOnInit(): void {
    if (this.router.url.startsWith('/reports/profit-intelligence')) {
      this.profitOpen = true;
      void this.loadProfitWorkspace();
      return;
    }
    this.api.get<{ data?: ReportItem[] } | ReportItem[]>('/api/v1/reports').subscribe({
      next: (response) => {
        const reports = Array.isArray(response) ? response : response.data ?? [];
        this.reports = reports.map((report) => this.normalizeReport(report));
        this.loading = false;
      },
      error: (error) => {
        this.error = error?.error?.message ?? 'Unable to load reports';
        this.loading = false;
      },
    });
  }

  get categories(): ReportCategory[] {
    const query = this.search.trim().toLowerCase();
    const visible = this.reports.filter((report) => {
      const matchesSearch = !query || `${report.title} ${report.description} ${report.category}`.toLowerCase().includes(query);
      return matchesSearch
        && (this.activeView === 'all' || this.favourites.has(report.id))
        && (!this.activeCategory || report.category === this.activeCategory);
    });
    return visible.reduce<ReportCategory[]>((categories, report) => {
      const category = categories.find((item) => item.name === report.category);
      if (category) category.reports.push(report);
      else categories.push({ name: report.category, reports: [report] });
      return categories;
    }, []);
  }

  get categoryNames(): string[] {
    const order = ['Sales & Finance', 'Customer', 'Staff', 'Packages', 'Appointments', 'Overview'];
    return [...new Set(this.reports.map((report) => report.category))]
      .sort((left, right) => (order.indexOf(left) + 1 || 99) - (order.indexOf(right) + 1 || 99));
  }

  toggleFavourite(id: string): void {
    this.favourites.has(id) ? this.favourites.delete(id) : this.favourites.add(id);
    localStorage.setItem(this.favouritesKey, JSON.stringify([...this.favourites]));
  }

  openReport(report: ReportItem): void {
    if (report.id === 'advanced-business') { void this.router.navigateByUrl('/reports/advanced'); return; }
    if (['detailed-invoice', 'invoice-activity', 'due-recovery', 'recovery-history', 'wallet-ledger', 'payment-collection', 'staff-service-discount', 'service-trends', 'service-clients', 'product-sales', 'product-movements', 'payment-modes'].includes(report.id)) {
      void this.router.navigateByUrl(`/reports/invoices?report=${report.id}`);
      return;
    }
    if (['financial-summary', 'daily-revenue', 'daily-sheet', 'deleted-invoices', 'gst-summary', 'discount-summary', 'staff-sales', 'rewards-loyalty', 'membership-sales', 'package-sales', 'tips-payout', 'message-history'].includes(report.id)) { void this.router.navigateByUrl(`/reports/advanced?report=${report.id}`); return; }
    this.liveOpen = false;
    this.liveState = null;
    this.liveError = '';
    if (report.id === 'profit-intelligence') {
      void this.router.navigateByUrl('/reports/profit-intelligence');
      return;
    }

    if (report.id === 'appointments') { void this.router.navigateByUrl('/appointment-reports'); return; }
    if (report.id === 'staff-performance') { void this.router.navigateByUrl('/reports/staff-bookings'); return; }
    if (report.id === 'cash-drawer-eod') { void this.router.navigateByUrl('/pos/cash-drawer'); return; }
    if (report.id === 'outgoing-funds') { void this.router.navigateByUrl('/finance/outgoing-funds'); return; }
    if (report.path.startsWith('/reports/')) void this.openLiveReport(report);
  }

  isFavourite(id: string): boolean { return this.favourites.has(id); }
  toggleCategory(name: string): void { this.collapsed.has(name) ? this.collapsed.delete(name) : this.collapsed.add(name); }
  isCollapsed(name: string): boolean { return this.collapsed.has(name); }
  selectCategory(category: string): void { this.activeCategory = this.activeCategory === category ? '' : category; this.activeView = 'all'; }

  get currentDimensionRows(): ProfitDimension[] {
    if (!this.advanced) return [];
    switch (this.profitTab) {
      case 'service': return this.advanced.serviceProfit;
      case 'category': return this.advanced.categoryProfit ?? [];
      case 'staff': return this.advanced.staffProfit;
      case 'customer': return this.advanced.customerProfit;
      case 'product': return this.advanced.productProfit ?? [];
      case 'appointment': return this.advanced.appointmentProfit ?? [];
      case 'branch': return this.advanced.branchProfit ?? [];
      case 'channel': return this.advanced.channelProfit ?? [];
      default: return [];
    }
  }

  get previousDimensionRows(): ProfitDimension[] {
    if (!this.previousAdvanced) return [];
    return ({ service: this.previousAdvanced.serviceProfit, category: this.previousAdvanced.categoryProfit, staff: this.previousAdvanced.staffProfit, customer: this.previousAdvanced.customerProfit, product: this.previousAdvanced.productProfit, appointment: this.previousAdvanced.appointmentProfit, branch: this.previousAdvanced.branchProfit, channel: this.previousAdvanced.channelProfit } as Partial<Record<ProfitTab, ProfitDimension[]>>)[this.profitTab] ?? [];
  }

  get isDimensionTab(): boolean { return ['service', 'category', 'staff', 'customer', 'product', 'appointment', 'branch', 'channel'].includes(this.profitTab); }
  get isGovernanceTab(): boolean { return ['rules', 'approvals', 'audit'].includes(this.profitTab); }

  get profitCostsComplete(): boolean { return this.reconciliation?.costCompletenessBps === 10_000; }

  get microOverview(): { revenue: number; cost: number; profit: number; margin: number; previousProfit: number } {
    const rows = this.advanced?.branchProfit ?? [];
    const previous = this.previousAdvanced?.branchProfit ?? [];
    const revenue = rows.reduce((sum, row) => sum + row.revenuePaise, 0);
    const cost = rows.reduce((sum, row) => sum + this.rowCost(row), 0);
    const profit = revenue - cost;
    const previousProfit = previous.reduce((sum, row) => sum + this.rowProfit(row), 0);
    return { revenue, cost, profit, margin: revenue > 0 ? profit * 10_000 / revenue : 0, previousProfit };
  }

  get customScenario(): ProfitScenario | null {
    const twin = this.advanced?.profitDigitalTwin;
    if (!twin) return null;
    const rows = this.advanced?.branchProfit ?? [];
    const pricePct = Number(this.scenarioDraft.priceChangePct || 0);
    const volumePct = Number(this.scenarioDraft.volumeChangePct || 0);
    const staffPct = Number(this.scenarioDraft.staffCostChangePct || 0);
    const wastagePct = Number(this.scenarioDraft.wastageReductionPct || 0);
    const overheadPct = Number(this.scenarioDraft.overheadChangePct || 0);
    const priceDelta = Math.round(twin.baselineRevenuePaise * pricePct / 100);
    const volumeRevenueDelta = Math.round(twin.baselineRevenuePaise * volumePct / 100);
    const volumeProfitDelta = Math.round(twin.baselineProfitPaise * volumePct / 100);
    const staffDelta = -Math.round(rows.reduce((sum, row) => sum + row.staffCostPaise + row.staffTimeCostPaise, 0) * staffPct / 100);
    const wastageDelta = Math.round(rows.reduce((sum, row) => sum + row.productCostPaise, 0) * wastagePct / 100);
    const overheadDelta = -Math.round(rows.reduce((sum, row) => sum + row.overheadCostPaise, 0) * overheadPct / 100);
    const projectedRevenuePaise = twin.baselineRevenuePaise + priceDelta + volumeRevenueDelta;
    const profitDeltaPaise = priceDelta + volumeProfitDelta + staffDelta + wastageDelta + overheadDelta;
    const projectedProfitPaise = twin.baselineProfitPaise + profitDeltaPaise;
    return { name: 'Custom scenario', projectedRevenuePaise, projectedProfitPaise, profitDeltaPaise, projectedMarginBps: projectedRevenuePaise > 0 ? projectedProfitPaise * 10_000 / projectedRevenuePaise : 0 };
  }

  get actionCounts(): { active: number; high: number } {
    return {
      active: this.actions.filter((action) => !['completed', 'dismissed'].includes(action.status)).length,
      high: this.actions.filter((action) => action.priority === 'high' && !['completed', 'dismissed'].includes(action.status)).length,
    };
  }

  get canManageProfit(): boolean {
    return this.auth.hasRole('owner', 'admin', 'manager');
  }

  get canViewTenantProfit(): boolean {
    return this.auth.hasRole('owner', 'admin', 'manager', 'analyst');
  }

  get periodCloseBlockers(): string[] {
    const row = this.reconciliation;
    if (!row) return ['Reconciliation data is unavailable'];
    const blockers: string[] = [];
    if (!row.reportableLineCount) blockers.push('No reportable sale lines');
    if (row.costCompletenessBps !== 10_000) blockers.push(`${row.reportableLineCount - row.costCompleteLineCount} lines have incomplete costs`);
    if (row.missingInvoiceJournalCount) blockers.push(`${row.missingInvoiceJournalCount} invoice journals are missing`);
    if (row.revenueVariancePaise) blockers.push(`Revenue variance ${this.money(row.revenueVariancePaise)}`);
    if (row.cogsVariancePaise) blockers.push(`COGS variance ${this.money(row.cogsVariancePaise)}`);
    if (row.payrollVariancePaise) blockers.push(`Payroll variance ${this.money(row.payrollVariancePaise)}`);
    if (row.unallocatedOverheadPaise) blockers.push(`Unallocated overhead ${this.money(row.unallocatedOverheadPaise)}`);
    return blockers;
  }

  get rankedProfitLeaks(): ProfitLeak[] {
    return [...(this.advanced?.leaks ?? [])].sort((left, right) => Math.abs(right.impactPaise) - Math.abs(left.impactPaise));
  }

  get activeProfitGroup(): ProfitGroup {
    return this.profitGroups.find((group) => group.tabs.includes(this.profitTab))?.id ?? 'overview';
  }

  get activeProfitGroupTabs(): Array<{ id: ProfitTab; label: string }> {
    const tabs = this.profitGroups.find((group) => group.id === this.activeProfitGroup)?.tabs ?? ['overview'];
    return tabs.map((id) => this.profitTabs.find((tab) => tab.id === id)!).filter(Boolean);
  }

  selectProfitGroup(group: ProfitGroup): void {
    const tabs = this.profitGroups.find((item) => item.id === group)?.tabs ?? ['overview'];
    if (!tabs.includes(this.profitTab)) this.selectProfitTab(tabs[0]);
  }

  selectProfitTab(tab: ProfitTab): void {
    this.profitTab = tab;
    void this.loadProfitTabData();
  }

  get customDataset(): CustomDataset | undefined {
    return this.customOptions.datasets.find((dataset) => dataset.id === this.customDraft.definition.dataset);
  }

  openCustomWorkspace(): void {
    this.customOpen = true;
    this.customDraft = this.blankCustomReport();
    this.pivot = null;
    void this.loadCustomReports();
  }

  closeCustomWorkspace(): void {
    this.customOpen = false;
    this.customError = '';
  }

  closeLiveReport(): void {
    this.liveOpen = false;
    this.liveError = '';
    this.liveState = null;
  }

  async openLiveReport(report: ReportItem): Promise<void> {
    this.liveOpen = true;
    this.liveLoading = true;
    this.liveError = '';
    this.liveState = { report, rows: [], columns: [], summary: {} };
    try {
      const response = await firstValueFrom(this.api.get<any>(this.liveUrl(report)));
      const data = this.data<any>(response);
      this.liveState = { report, ...this.liveRows(data) };
    } catch (error: any) {
      this.liveError = error?.error?.error?.message || error?.error?.message || error?.message || 'Unable to load report';
    } finally {
      this.liveLoading = false;
    }
  }

  async loadCustomReports(): Promise<void> {
    this.customLoading = true;
    this.customError = '';
    try {
      const response = await firstValueFrom(this.api.get<any>('/api/v1/reports/custom'));
      const data = this.data<any>(response) ?? {};
      this.customReports = (Array.isArray(data.reports) ? data.reports : []).filter((report: CustomReport) => !this.isProfitSavedView(report));
      this.customOptions = data.options ?? this.customOptions;
      if (!this.customOptions.datasets.some((dataset) => dataset.id === this.customDraft.definition.dataset)) {
        this.customDraft = this.blankCustomReport();
      }
    } catch (error: any) {
      this.customError = error?.error?.error?.message ?? error?.error?.message ?? 'Unable to load custom reports';
    } finally {
      this.customLoading = false;
    }
  }

  customDatasetChanged(): void {
    const dataset = this.customDataset;
    this.customDraft.definition.rowDimension = dataset?.dimensions[0] ?? '';
    this.customDraft.definition.columnDimension = 'none';
    this.customDraft.definition.metric = dataset?.metrics[0] ?? '';
  }

  customRowChanged(): void {
    if (this.customDraft.definition.columnDimension === this.customDraft.definition.rowDimension) {
      this.customDraft.definition.columnDimension = 'none';
    }
  }

  async previewCustomReport(): Promise<void> {
    this.customBusy = true;
    this.customError = '';
    try {
      const response = await firstValueFrom(this.api.post<any>('/api/v1/reports/custom/preview', this.customDraft.definition));
      this.pivot = this.data<PivotReport>(response);
    } catch (error: any) {
      this.customError = error?.error?.error?.message ?? error?.error?.message ?? 'Unable to run custom report';
    } finally {
      this.customBusy = false;
    }
  }

  async saveCustomReport(): Promise<void> {
    if (!this.canManageProfit || !this.customDraft.name.trim()) return;
    this.customBusy = true;
    this.customError = '';
    try {
      const response = await firstValueFrom(this.api.post<any>('/api/v1/reports/custom', this.customDraft));
      const saved = this.data<CustomReport>(response);
      await this.loadCustomReports();
      if (saved) this.editCustomReport(saved);
    } catch (error: any) {
      this.customError = error?.error?.error?.message ?? error?.error?.message ?? 'Unable to save custom report';
    } finally {
      this.customBusy = false;
    }
  }

  editCustomReport(report: CustomReport): void {
    this.customDraft = { ...report, definition: { ...report.definition } };
    this.pivot = null;
  }

  async runSavedCustomReport(report: CustomReport): Promise<void> {
    if (!report.active) return;
    this.customBusy = true;
    this.customError = '';
    this.editCustomReport(report);
    try {
      const response = await firstValueFrom(this.api.post<any>(`/api/v1/reports/custom/${report.id}/run`, {}));
      this.pivot = this.data<PivotReport>(response);
      await this.loadCustomReports();
    } catch (error: any) {
      this.customError = error?.error?.error?.message ?? error?.error?.message ?? 'Unable to run saved report';
    } finally {
      this.customBusy = false;
    }
  }

  pivotValue(row: string, column: string): string {
    const value = this.pivot?.cells.find((cell) => cell.rowKey === row && cell.columnKey === column)?.value ?? 0;
    return this.pivot?.metric.endsWith('Paise') ? this.money(value) : new Intl.NumberFormat('en-IN').format(value);
  }

  customLabel(value: string): string {
    return this.titleCase(value.replace(/([a-z])([A-Z])/g, '$1 $2'));
  }

  get branchTotalRevenuePaise(): number {
    return this.advanced?.branchProfit.reduce((total, row) => total + row.revenuePaise, 0) ?? 0;
  }

  get branchTotalProfitPaise(): number {
    return this.advanced?.branchProfit.reduce((total, row) => total + this.rowProfit(row), 0) ?? 0;
  }

  closeProfitWorkspace(): void {
    if (this.router.url.startsWith('/reports/profit-intelligence')) {
      void this.router.navigateByUrl('/reports');
      return;
    }
    this.profitOpen = false;
    this.actionDrawerOpen = false;
    this.closeProfitDrill();
  }

  async loadProfitWorkspace(): Promise<void> {
    if (!this.validateProfitDateRange()) return;
    const requestId = ++this.profitRequestId;
    this.profitReload$.next();
    this.profitLoading = true;
    this.profitError = '';
    this.profitPanelError = '';
    const query = new URLSearchParams({ fromDate: this.fromDate, toDate: this.toDate, scope: this.profitScope, view: this.profitTab });
    const previous = this.previousPeriod();
    const previousQuery = new URLSearchParams({ fromDate: previous.fromDate, toDate: previous.toDate, scope: this.profitScope, view: this.profitTab });
    const get = (path: string) => firstValueFrom(this.api.get<any>(path).pipe(takeUntil(this.profitReload$)));
    try {
      const [advanced, reconciliation, savedViews, previousAdvanced] = await Promise.all([
        get(`/api/v1/profit-intelligence/advanced?${query}`),
        get(`/api/v1/profit-intelligence/reconciliation?${query}`),
        get('/api/v1/reports/custom').catch(() => null),
        this.comparePrevious ? get(`/api/v1/profit-intelligence/advanced?${previousQuery}`).catch(() => null) : Promise.resolve(null),
      ]);
      if (requestId !== this.profitRequestId) return;
      this.advanced = this.data<AdvancedProfit>(advanced);
      this.advancedView = this.profitTab;
      this.reconciliation = this.data<MicroProfitReconciliation>(reconciliation);
      const saved = savedViews ? this.data<{ reports: CustomReport[] }>(savedViews)?.reports ?? [] : [];
      this.profitSavedViews = saved.filter((report) => report.active && this.isProfitSavedView(report));
      this.previousAdvanced = previousAdvanced ? this.data<AdvancedProfit>(previousAdvanced) : null;
      // These two panels are optional; a failure must not read as "nothing saved" or "no change".
      const failedPanels: string[] = [];
      if (!savedViews) failedPanels.push('saved views');
      if (this.comparePrevious && !previousAdvanced) failedPanels.push('previous period');
      this.profitPanelError = failedPanels.length ? `Unable to load ${failedPanels.join(' and ')}` : '';
      await this.loadProfitTabData();
    } catch (error: any) {
      if (requestId !== this.profitRequestId) return;
      this.profitError = error?.error?.error?.message ?? error?.error?.message ?? error?.message ?? 'Unable to load Profit Intelligence';
    } finally {
      if (requestId === this.profitRequestId) this.profitLoading = false;
    }
  }

  async updateCustomReportLifecycle(report: CustomReport, action: 'stopSchedule' | 'archive' | 'restore'): Promise<void> {
    if (!this.canManageProfit || this.customBusy) return;
    const label = action === 'stopSchedule' ? 'Stop schedule' : action === 'archive' ? 'Archive' : 'Restore';
    if (!confirm(`${label} ${report.name}?`)) return;
    this.customBusy = true;
    this.customError = '';
    try {
      await firstValueFrom(this.api.post(`/api/v1/reports/custom/${report.id}/lifecycle`, { action, version: report.version }));
      if (action === 'archive' && this.customDraft.id === report.id) this.customDraft = this.blankCustomReport();
      await this.loadCustomReports();
    } catch (error: any) {
      this.customError = error?.error?.error?.message ?? error?.error?.message ?? `Unable to ${label.toLowerCase()} report`;
    } finally {
      this.customBusy = false;
    }
  }

  async loadProfitTabData(): Promise<void> {
    const requestId = ++this.profitTabRequestId;
    this.profitTabReload$.next();
    const get = (path: string) => firstValueFrom(this.api.get<any>(path).pipe(takeUntil(this.profitTabReload$)));
    try {
      if (this.advancedView !== this.profitTab && !['actions', 'rules', 'approvals', 'audit', 'reconciliation'].includes(this.profitTab)) {
        const query = new URLSearchParams({ fromDate: this.fromDate, toDate: this.toDate, scope: this.profitScope, view: this.profitTab });
        const advanced = await get(`/api/v1/profit-intelligence/advanced?${query}`);
        if (requestId !== this.profitTabRequestId) return;
        this.advanced = this.data<AdvancedProfit>(advanced);
        this.advancedView = this.profitTab;
      }
      if (this.profitTab === 'reconciliation') {
        const query = new URLSearchParams({ fromDate: this.fromDate, toDate: this.toDate, scope: this.profitScope });
        const [repairQueue, allocationRules, accounts] = await Promise.all([
          get(`/api/v1/profit-intelligence/reconciliation/invoice-repair-queue?${query}&pageSize=100`),
          get(`/api/v1/profit-intelligence/allocation-rules?${query}`),
          get('/api/v1/balance-sheet/accounts'),
        ]);
        if (requestId !== this.profitTabRequestId) return;
        this.invoiceRepairQueue = this.data<InvoiceJournalRepairItem[]>(repairQueue) ?? [];
        this.allocationRules = this.data<MicroProfitAllocationRule[]>(allocationRules) ?? [];
        const excluded = new Set(['SALES_RETURNS', 'COST_OF_GOODS_SOLD', 'PAYROLL_EXPENSE', 'ROUNDING_EXPENSE']);
        this.allocationAccounts = (this.data<AccountDefinition[]>(accounts) ?? []).filter((account) => account.group === 'expense' && !excluded.has(account.code));
        return;
      }
      if (this.profitTab === 'actions') {
        await this.loadActions();
        return;
      }
      if (!['rules', 'approvals', 'audit'].includes(this.profitTab)) return;
      if (!this.canManageProfit) {
        this.governanceError = this.language.text('profit.permissionGovernance');
        this.governance = null;
        this.governanceRules = [];
        this.governanceApprovals = [];
        this.governanceAudit = [];
        return;
      }
      this.governanceError = '';
      const detailPath = this.profitTab === 'rules' ? 'rules' : this.profitTab === 'approvals' ? 'approvals?limit=200' : 'audit?limit=200';
      const [summary, detail] = await Promise.all([
        get('/api/v1/profit-intelligence/governance/summary'),
        get(`/api/v1/profit-intelligence/governance/${detailPath}`),
      ]);
      if (requestId !== this.profitTabRequestId) return;
      this.governance = this.data<GovernanceSummary>(summary);
      if (this.profitTab === 'rules') this.governanceRules = this.data<GovernanceRule[]>(detail) ?? [];
      if (this.profitTab === 'approvals') this.governanceApprovals = this.data<GovernanceApproval[]>(detail) ?? [];
      if (this.profitTab === 'audit') this.governanceAudit = this.data<GovernanceAudit[]>(detail) ?? [];
    } catch (error: any) {
      if (requestId !== this.profitTabRequestId) return;
      const message = error?.status === 403 ? 'You are not permitted to view governance data' : error?.error?.error?.message ?? error?.error?.message ?? 'Unable to load this Profit Intelligence view';
      if (['rules', 'approvals', 'audit'].includes(this.profitTab)) this.governanceError = message;
      else this.profitError = message;
    }
  }

  async repairInvoiceJournals(): Promise<void> {
    if (!this.canManageProfit || this.repairBusy) return;
    if (!this.validateProfitDateRange()) return;
    this.repairBusy = true;
    this.profitError = '';
    const query = new URLSearchParams({ fromDate: this.fromDate, toDate: this.toDate, scope: this.profitScope, pageSize: '100' });
    try {
      await firstValueFrom(this.api.post(`/api/v1/profit-intelligence/reconciliation/invoice-repair-queue?${query}`, {}));
      await this.loadProfitWorkspace();
    } catch (error: any) {
      this.profitError = error?.error?.error?.message ?? error?.error?.message ?? 'Unable to repair invoice journals';
    } finally {
      this.repairBusy = false;
    }
  }

  async createAllocationRule(): Promise<void> {
    if (!this.canManageProfit || this.allocationBusy) return;
    const draft = this.allocationDraft;
    if (!draft.name.trim() || !draft.effectiveFrom || !draft.accountCodes.length) {
      this.profitError = 'Rule name, effective date and overhead accounts are required';
      return;
    }
    this.allocationBusy = true;
    this.profitError = '';
    try {
      await firstValueFrom(this.api.post('/api/v1/profit-intelligence/allocation-rules', {
        name: draft.name.trim(),
        driver: draft.driver,
        accountCodes: draft.accountCodes,
        effectiveFrom: draft.effectiveFrom,
        effectiveTo: draft.effectiveTo || null,
      }));
      this.allocationDraft = this.blankAllocationRule();
      await this.loadProfitWorkspace();
    } catch (error: any) {
      this.profitError = error?.error?.error?.message ?? error?.error?.message ?? 'Unable to create allocation rule';
    } finally {
      this.allocationBusy = false;
    }
  }

  async loadActions(): Promise<void> {
    const requestId = ++this.actionRequestId;
    this.actionReload$.next();
    this.profitError = '';
    try {
      const response = await firstValueFrom(this.api.get<any>(`/api/v1/profit-intelligence/actions?status=${this.actionStatus}&priority=${this.actionPriority}&limit=200`).pipe(takeUntil(this.actionReload$)));
      if (requestId !== this.actionRequestId) return;
      this.actions = this.data<ProfitAction[]>(response) ?? [];
    } catch (error: any) {
      if (requestId !== this.actionRequestId) return;
      this.profitError = error?.error?.error?.message ?? error?.error?.message ?? 'Unable to load Profit Action Queue';
    }
  }

  ngOnDestroy(): void {
    this.profitReload$.next();
    this.profitReload$.complete();
    this.profitTabReload$.next();
    this.profitTabReload$.complete();
    this.actionReload$.next();
    this.actionReload$.complete();
  }

  addExpense(): void {
    void this.router.navigateByUrl('/finance/outgoing-funds');
  }

  addCostOfGoods(): void {
    void this.router.navigateByUrl('/purchase-orders');
  }

  addAdjustment(): void {
    this.openActionDrawer({
      actionType: 'manual_profit_adjustment',
      title: 'Profit Adjustment',
      message: 'Record and track a manual profit adjustment',
      sourceType: 'manual',
    });
  }

  createProfitLeakAction(): void {
    const leak = this.advanced?.leaks?.[0];
    if (leak) {
      this.queueLeak(leak);
      return;
    }
    this.openActionDrawer({
      actionType: 'profit_leak_review',
      title: 'Review Profit Leak',
      message: 'Investigate and resolve a suspected profit leak',
      sourceType: 'profit_leak',
    });
  }

  openReconciliation(): void {
    this.selectProfitTab('reconciliation');
  }

  async runPosMarginCheck(): Promise<void> {
    if (!this.canManageProfit || this.posGuardBusy) return;
    const grossAmountPaise = Number(this.posGuardDraft.grossAmountPaise);
    const values = [grossAmountPaise, Number(this.posGuardDraft.discountPaise || 0), Number(this.posGuardDraft.productCostPaise || 0), Number(this.posGuardDraft.staffCostPaise || 0), Number(this.posGuardDraft.membershipRedemptionPaise || 0)];
    if (!Number.isFinite(grossAmountPaise) || grossAmountPaise <= 0 || values.some((value) => !Number.isFinite(value) || value < 0)) {
      this.profitError = 'Gross amount and recorded costs must be valid paise amounts';
      return;
    }
    const sourceId = `pos-preview-${crypto.randomUUID()}`;
    this.posGuardBusy = true;
    this.profitError = '';
    try {
      const response = await firstValueFrom(this.api.post<any>('/api/v1/profit-intelligence/pos-margin-check', {
        idempotencyKey: sourceId,
        sourceType: 'pos_margin_guard',
        sourceId,
        grossAmountPaise,
        discountPaise: values[1],
        productCostPaise: values[2],
        staffCostPaise: values[3],
        membershipRedemptionPaise: values[4],
      }));
      this.posGuardDecision = this.data<PosGuardDecision>(response);
      await this.loadActions();
    } catch (error: any) {
      this.profitError = error?.error?.error?.message ?? error?.error?.message ?? 'Unable to evaluate POS margin';
    } finally {
      this.posGuardBusy = false;
    }
  }

  openActionDrawer(source?: Partial<ActionDraft>): void {
    if (!this.canManageProfit) return;
    if (!this.validateProfitDateRange()) return;
    this.actionDraft = { ...this.blankAction(), ...source };
    this.actionDrawerOpen = true;
    this.focusActiveDialog();
  }

  closeActionDrawer(): void {
    this.actionDrawerOpen = false;
    this.actionDraft = this.blankAction();
  }

  queueLeak(leak: ProfitLeak): void {
    this.openActionDrawer({
      actionType: leak.kind,
      title: leak.title,
      message: leak.message,
      impactPaise: leak.impactPaise,
      priority: leak.severity,
      sourceType: leak.sourceType,
      sourceId: leak.sourceId,
    });
  }

  async markLeakReviewed(leak: ProfitLeak): Promise<void> {
    if (!this.canManageProfit || this.actionBusyId) return;
    if (!this.validateProfitDateRange()) return;
    this.actionBusyId = `leak:${leak.sourceType}:${leak.sourceId}`;
    this.profitError = '';
    try {
      const created = await firstValueFrom(this.api.post<any>('/api/v1/profit-intelligence/actions', {
        actionType: 'profit_leak_review',
        title: `Reviewed ${leak.title}`,
        message: leak.message,
        impactPaise: leak.impactPaise,
        priority: leak.severity,
        sourceType: leak.sourceType,
        sourceId: leak.sourceId || crypto.randomUUID(),
        periodStart: this.fromDate,
        periodEnd: this.toDate,
        ruleKey: 'profit_leak_review',
        notes: 'Marked reviewed from Profit Intelligence',
        evidence: { leakKind: leak.kind, reviewedFrom: 'profit-intelligence' },
        baselineImpactPaise: leak.impactPaise,
        expectedImpactPaise: 0,
        payload: {},
      }));
      const action = this.data<ProfitAction>(created);
      if (action?.id) {
        await firstValueFrom(this.api.post(`/api/v1/profit-intelligence/actions/${action.id}/dismiss`, {
          note: 'Profit leak reviewed',
          evidence: { leakKind: leak.kind, reviewedFrom: 'profit-intelligence' },
        }));
      }
      await this.loadActions();
      this.profitTab = 'actions';
    } catch (error: any) {
      this.profitError = error?.error?.error?.message ?? error?.error?.message ?? 'Unable to mark profit leak reviewed';
    } finally {
      this.actionBusyId = '';
    }
  }

  queuePricing(row: PricingRecommendation): void {
    this.openActionDrawer({
      actionType: 'pricing_recommendation',
      title: `Review ${row.serviceName} Price`,
      message: `Recorded cost supports a ${this.percent(row.targetMarginBps)} target margin`,
      impactPaise: row.expectedProfitLiftPaise,
      priority: row.expectedProfitLiftPaise >= 500000 ? 'high' : row.expectedProfitLiftPaise >= 100000 ? 'medium' : 'low',
      sourceType: 'service',
      sourceId: row.serviceId,
    });
  }

  queueCopilot(row: CopilotInsight): void {
    this.openActionDrawer({
      actionType: row.kind,
      title: row.title,
      message: row.message,
      impactPaise: row.impactPaise,
      priority: row.impactPaise >= 500000 ? 'high' : row.impactPaise >= 100000 ? 'medium' : 'low',
      sourceType: row.sourceType,
      sourceId: row.sourceId,
    });
  }

  async submitCopilotFeedback(row: CopilotInsight, decision: 'accepted' | 'rejected'): Promise<void> {
    if (!this.canManageProfit || !row.recommendationVersionId) return;
    this.actionBusyId = row.recommendationVersionId;
    this.profitError = '';
    try {
      await firstValueFrom(this.api.post(`/api/v1/profit-intelligence/copilot/recommendations/${row.recommendationVersionId}/feedback`, { decision }));
      this.copilotFeedback = { ...this.copilotFeedback, [row.recommendationVersionId]: decision };
    } catch (error: any) {
      this.profitError = error?.error?.error?.message ?? error?.error?.message ?? 'Unable to save Copilot feedback';
    } finally {
      this.actionBusyId = '';
    }
  }

  async createAction(): Promise<void> {
    if (!this.canManageProfit) return;
    if (!this.actionDraft.title.trim() || !this.actionDraft.actionType) {
      this.profitError = 'Action type and title are required';
      return;
    }
    this.actionBusyId = 'create';
    this.profitError = '';
    try {
      await firstValueFrom(this.api.post('/api/v1/profit-intelligence/actions', {
        actionType: this.actionDraft.actionType,
        title: this.actionDraft.title.trim(),
        message: this.actionDraft.message.trim(),
        impactPaise: this.actionDraft.impactPaise ?? 0,
        priority: this.actionDraft.priority,
        sourceType: this.actionDraft.sourceType || 'manual',
        sourceId: this.actionDraft.sourceId || crypto.randomUUID(),
        periodStart: this.actionDraft.periodStart || null,
        periodEnd: this.actionDraft.periodEnd || null,
        ruleKey: this.actionDraft.actionType,
        slaMinutes: this.actionDraft.slaMinutes,
        notes: this.actionDraft.notes.trim(),
        evidence: this.actionDraft.evidence.trim() ? { manualEvidence: this.actionDraft.evidence.trim() } : {},
        baselineImpactPaise: this.actionDraft.impactPaise ?? 0,
        expectedImpactPaise: this.actionDraft.expectedImpactPaise ?? this.actionDraft.impactPaise ?? 0,
        payload: {},
      }));
      this.closeActionDrawer();
      this.profitTab = 'actions';
      await this.loadActions();
    } catch (error: any) {
      this.profitError = error?.error?.error?.message ?? error?.error?.message ?? 'Unable to create profit action';
    } finally {
      this.actionBusyId = '';
    }
  }

  transitionAction(action: ProfitAction, transition: 'approve' | 'complete' | 'dismiss'): void {
    if (!this.canManageProfit) return;
    this.profitDialog = { kind: 'actionTransition', titleKey: `profit.dialog.${transition}Action`, name: '', note: '', evidence: '', realizedImpactInr: action.realizedImpactPaise ? action.realizedImpactPaise / 100 : null, action, transition };
    this.focusActiveDialog();
  }

  rowCost(row: ProfitDimension): number {
    return this.profitLevel === 'fullyLoaded' ? Number(row.fullyLoadedCostPaise || 0) : Number(row.totalCostPaise || 0);
  }

  rowProfit(row: ProfitDimension): number {
    return this.profitLevel === 'fullyLoaded' ? Number(row.fullyLoadedProfitPaise || 0) : Number(row.netProfitPaise || 0);
  }

  rowMargin(row: ProfitDimension): number {
    return this.profitLevel === 'fullyLoaded' ? Number(row.fullyLoadedMarginBps || 0) : Number(row.marginBps || 0);
  }

  comparisonProfit(row: ProfitDimension): number {
    const previous = this.previousDimensionRows.find((item) => item.entityId === row.entityId);
    return previous ? this.rowProfit(previous) : 0;
  }

  async openProfitDrill(row: ProfitDimension): Promise<void> {
    if (!this.validateProfitDateRange()) return;
    this.selectedDimensionRow = row;
    this.drillLines = [];
    this.drillTotal = 0;
    this.drillPage = 1;
    this.drillBusy = true;
    this.focusActiveDialog();
    await this.loadProfitDrillPage(row, false);
  }

  async loadMoreProfitDrill(): Promise<void> {
    if (!this.selectedDimensionRow || this.drillBusy || this.drillLines.length >= this.drillTotal) return;
    this.drillPage += 1;
    this.drillBusy = true;
    await this.loadProfitDrillPage(this.selectedDimensionRow, true);
  }

  private async loadProfitDrillPage(row: ProfitDimension, append: boolean): Promise<void> {
    const query = new URLSearchParams({ fromDate: this.fromDate, toDate: this.toDate, scope: this.profitScope, dimension: row.dimension, entityId: row.entityId, page: String(this.drillPage), pageSize: '200' });
    try {
      const response = await firstValueFrom(this.api.get<any>(`/api/v1/profit-intelligence/micro-lines?${query}`));
      const page = this.data<MicroProfitPage>(response);
      this.drillLines = append ? [...this.drillLines, ...(page?.rows ?? [])] : page?.rows ?? [];
      this.drillTotal = page?.total ?? 0;
    } catch (error: any) {
      this.profitError = error?.error?.error?.message ?? error?.error?.message ?? 'Unable to load Micro P&L drill-down';
    } finally {
      this.drillBusy = false;
    }
  }

  closeProfitDrill(): void {
    this.selectedDimensionRow = null;
    this.drillLines = [];
    this.drillTotal = 0;
    this.drillPage = 1;
  }

  async toggleGovernanceRule(rule: GovernanceRule): Promise<void> {
    if (!this.canManageProfit || this.governanceBusyId) return;
    this.governanceBusyId = rule.id;
    try {
      await firstValueFrom(this.api.post('/api/v1/profit-intelligence/governance/rules', {
        ruleType: rule.ruleType,
        title: rule.title,
        description: rule.description,
        enabled: !rule.enabled,
        minMarginBps: rule.minMarginBps,
        maxDiscountBps: rule.maxDiscountBps,
        maxImpactPaise: rule.maxImpactPaise,
        approvalRequired: rule.approvalRequired,
        autoExecuteAllowed: rule.autoExecuteAllowed,
        auditRequired: rule.auditRequired,
        severity: rule.severity,
      }));
      await this.loadProfitWorkspace();
    } catch (error: any) {
      this.profitError = error?.error?.error?.message ?? error?.error?.message ?? 'Unable to update governance rule';
    } finally {
      this.governanceBusyId = '';
    }
  }

  reviewGovernanceApproval(approval: GovernanceApproval, decision: 'approve' | 'reject'): void {
    if (!this.canManageProfit || this.governanceBusyId) return;
    this.profitDialog = { kind: 'governanceReview', titleKey: `profit.dialog.${decision}Governance`, name: '', note: '', evidence: '', realizedImpactInr: null, approval, decision };
    this.focusActiveDialog();
  }

  auditDetails(value: unknown): string {
    try { return JSON.stringify(value); } catch { return '-'; }
  }

  saveProfitView(): void {
    if (!this.canManageProfit) return;
    if (!this.validateProfitDateRange()) return;
    this.profitDialog = { kind: 'saveView', titleKey: 'profit.dialog.saveView', name: '', note: '', evidence: '', realizedImpactInr: null };
    this.focusActiveDialog();
  }

  openPeriodClose(): void {
    if (!this.canManageProfit || !this.reconciliation) return;
    this.profitDialog = { kind: 'periodClose', titleKey: this.reconciliation.branchPeriodCloseReady ? 'profit.dialog.closePeriod' : 'profit.dialog.closeBlockers', name: '', note: '', evidence: '', realizedImpactInr: null };
    this.focusActiveDialog();
  }

  closeProfitDialog(): void { this.profitDialog = null; }

  async submitProfitDialog(): Promise<void> {
    const dialog = this.profitDialog;
    if (!dialog || !this.canManageProfit) return;
    this.profitError = '';
    try {
      if (dialog.kind === 'saveView') {
        const name = dialog.name.trim();
        if (!name) { this.profitError = 'Saved view name is required'; return; }
        await firstValueFrom(this.api.post('/api/v1/reports/custom', {
          name,
          definition: {
            dataset: 'sales', rowDimension: 'date', columnDimension: 'none', metric: 'revenuePaise', dateRange: 'custom', fromDate: this.fromDate, toDate: this.toDate,
            profitView: { tab: this.profitTab, level: this.profitLevel, scope: this.profitScope, comparePrevious: this.comparePrevious, actionStatus: this.actionStatus, actionPriority: this.actionPriority },
          },
          scheduleFrequency: 'none', scheduleDay: 1, scheduleTime: '09:00', recipientEmail: '',
        }));
        const response = await firstValueFrom(this.api.get<any>('/api/v1/reports/custom'));
        this.profitSavedViews = (this.data<{ reports: CustomReport[] }>(response)?.reports ?? []).filter((report) => report.active && this.isProfitSavedView(report));
      }
      if (dialog.kind === 'actionTransition' && dialog.action && dialog.transition) {
        const realized = dialog.realizedImpactInr;
        if (realized != null && (!Number.isFinite(Number(realized)) || Number(realized) < 0)) { this.profitError = 'Realized impact must be a non-negative amount'; return; }
        this.actionBusyId = dialog.action.id;
        await firstValueFrom(this.api.post(`/api/v1/profit-intelligence/actions/${dialog.action.id}/${dialog.transition}`, {
          note: dialog.note.trim(),
          realizedImpactPaise: realized == null ? undefined : Math.round(Number(realized) * 100),
          evidence: dialog.evidence.trim() ? { completionEvidence: dialog.evidence.trim() } : undefined,
        }));
        await this.loadActions();
      }
      if (dialog.kind === 'governanceReview' && dialog.approval && dialog.decision) {
        this.governanceBusyId = dialog.approval.id;
        await firstValueFrom(this.api.post(`/api/v1/profit-intelligence/governance/approvals/${dialog.approval.id}/${dialog.decision}`, { note: dialog.note.trim() }));
        await this.loadProfitTabData();
      }
      if (dialog.kind === 'periodClose') {
        if (!this.reconciliation?.branchPeriodCloseReady || !dialog.note.trim()) { this.profitError = 'Resolve every blocker and enter a close reason'; return; }
        this.periodCloseBusy = true;
        await firstValueFrom(this.api.post('/balance-sheet/periods/close', { periodMonth: this.toDate.slice(0, 7), reason: dialog.note.trim() }));
        await this.loadProfitWorkspace();
      }
      this.closeProfitDialog();
    } catch (error: any) {
      this.profitError = error?.error?.error?.message ?? error?.error?.message ?? 'Unable to complete the requested action';
    } finally {
      this.actionBusyId = '';
      this.governanceBusyId = '';
      this.periodCloseBusy = false;
    }
  }

  applyProfitView(id: string): void {
    const view = this.profitSavedViews.find((item) => item.id === id);
    if (!view) return;
    const structured = view.definition.profitView;
    const [, legacyTab, legacyLevel, legacyScope] = (view.definition.status ?? '').split('_');
    const tab = structured?.tab ?? legacyTab;
    if (this.profitTabs.some((item) => item.id === tab)) this.profitTab = tab as ProfitTab;
    this.profitLevel = structured?.level ?? (legacyLevel === 'f' ? 'fullyLoaded' : 'contribution');
    const scope = structured?.scope ?? (legacyScope === 't' ? 'tenant' : 'branch');
    this.profitScope = scope === 'tenant' && this.canViewTenantProfit ? 'tenant' : 'branch';
    this.comparePrevious = structured?.comparePrevious ?? this.comparePrevious;
    this.actionStatus = structured?.actionStatus ?? this.actionStatus;
    this.actionPriority = structured?.actionPriority ?? this.actionPriority;
    this.fromDate = view.definition.fromDate ?? this.fromDate;
    this.toDate = view.definition.toDate ?? this.toDate;
    void this.loadProfitWorkspace();
  }

  exportProfit(format: 'csv' | 'excel'): void {
    if (!this.validateProfitDateRange()) return;
    const records = this.profitExportRecords();
    if (!records.length) { this.profitError = 'No data is available for the active view'; return; }
    const headers = Object.keys(records[0]);
    const values = records.map((record) => headers.map((header) => record[header]));
    const name = `micro-pnl-${this.profitTab}-${this.fromDate}-${this.toDate}`;
    if (format === 'csv') {
      const csv = [headers, ...values].map((row) => row.map((value) => `"${String(value ?? '').replace(/"/g, '""')}"`).join(',')).join('\r\n');
      this.download(`\uFEFF${csv}`, `${name}.csv`, 'text/csv;charset=utf-8');
      return;
    }
    const html = `<table><thead><tr>${headers.map((value) => `<th>${this.escapeHtml(value)}</th>`).join('')}</tr></thead><tbody>${values.map((row) => `<tr>${row.map((value) => `<td>${this.escapeHtml(String(value ?? ''))}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
    this.download(html, `${name}.xls`, 'application/vnd.ms-excel');
  }

  private profitExportRecords(): Array<Record<string, string | number>> {
    const dimensions = this.isDimensionTab ? this.currentDimensionRows : this.profitTab === 'overview' ? this.advanced?.branchProfit ?? [] : [];
    if (dimensions.length) return dimensions.map((row) => ({ Dimension: row.dimension, Name: row.entityName, Units: row.unitCount, 'Revenue (INR)': row.revenuePaise / 100, 'Cost (INR)': this.rowCost(row) / 100, [`${this.profitLevel === 'fullyLoaded' ? 'Fully Loaded Profit' : 'Contribution Profit'} (INR)`]: row.incompleteCostLineCount ? '' : this.rowProfit(row) / 100, 'Margin (%)': row.incompleteCostLineCount ? '' : this.rowMargin(row) / 100, 'Cost Source Coverage (%)': row.costCompletenessBps / 100, 'Incomplete Lines': row.incompleteCostLineCount }));
    if (this.profitTab === 'leaks') return this.rankedProfitLeaks.map((row) => ({ Type: row.kind, Title: row.title, Message: row.message, Severity: row.severity, 'Impact (INR)': row.impactPaise / 100 }));
    if (this.profitTab === 'pricing') return (this.advanced?.pricing ?? []).map((row) => ({ Service: row.serviceName, 'Current (INR)': row.currentAveragePricePaise / 100, 'Suggested (INR)': row.suggestedPricePaise / 100, 'Current Margin (%)': row.currentMarginBps / 100, 'Target Margin (%)': row.targetMarginBps / 100, 'Expected Lift (INR)': row.expectedProfitLiftPaise / 100 }));
    if (this.profitTab === 'recipe') return (this.advanced?.recipeVariance ?? []).map((row) => ({ Service: row.serviceName, Sold: row.soldQuantity, 'Recipe Items': row.recipeItemCount, 'Expected Cost (INR)': row.expectedCostPaise / 100, 'Actual Cost (INR)': row.actualCostPaise / 100, 'Variance (INR)': row.variancePaise / 100, 'Variance (%)': row.varianceBps / 100 }));
    if (this.profitTab === 'booking') return (this.advanced?.bookingRecommendations ?? []).map((row) => ({ Service: row.serviceName, Hour: this.bookingHour(row.recommendedHour), Appointments: row.appointmentCount, 'Revenue/Unit (INR)': row.expectedRevenuePaise / 100, 'Cost/Unit (INR)': row.expectedCostPaise / 100, 'Profit/Unit (INR)': row.expectedProfitPaise / 100, 'Margin (%)': row.marginBps / 100, Decision: row.restrictionReason || row.recommendation }));
    if (this.profitTab === 'liability') return (this.advanced?.liabilityRisks ?? []).map((row) => ({ Plan: row.planName, Type: row.kind, 'Sold (INR)': row.soldValuePaise / 100, 'Recognized (INR)': row.recognizedValuePaise / 100, 'Liability (INR)': row.remainingLiabilityPaise / 100, 'Future Profit (INR)': row.expectedFutureProfitPaise / 100, Risk: row.severity, Action: row.recommendation }));
    if (this.profitTab === 'copilot') return (this.advanced?.copilot ?? []).map((row) => ({ Type: row.kind, Title: row.title, Message: row.message, 'Impact (INR)': row.impactPaise / 100, Evaluation: row.evaluationStatus, Feedback: this.copilotFeedback[row.recommendationVersionId] ?? '' }));
    if (this.profitTab === 'actions') return this.actions.map((row) => ({ Title: row.title, Type: row.actionType, Priority: row.priority, Status: row.status, Owner: row.ownerName || row.ownerUserId || '', Period: this.actionPeriod(row), 'Expected (INR)': row.expectedImpactPaise / 100, 'Realized (INR)': row.realizedImpactPaise / 100 }));
    if (this.profitTab === 'rules') return this.governanceRules.map((row) => ({ Rule: row.title, Severity: row.severity, 'Minimum Margin (%)': row.minMarginBps / 100, 'Maximum Discount (%)': row.maxDiscountBps / 100, Approval: row.approvalRequired ? 'Required' : 'No', Audit: row.auditRequired ? 'Required' : 'No', Status: row.enabled ? 'Enabled' : 'Disabled' }));
    if (this.profitTab === 'approvals') return this.governanceApprovals.map((row) => ({ Requested: this.formatDate(row.requestedAt), Action: row.actionType, Source: `${row.sourceType} ${row.sourceId}`, Decision: row.message, 'Impact (INR)': row.impactPaise / 100, 'Margin (%)': row.marginBps / 100, Status: row.status }));
    if (this.profitTab === 'audit') return this.governanceAudit.map((row) => ({ Time: this.formatDate(row.createdAt), Event: row.eventType, Actor: row.actorUserId, Decision: row.decisionId ?? '', Rule: row.ruleId ?? '', Details: this.auditDetails(row.detailsJson) }));
    if (this.profitTab === 'reconciliation' && this.reconciliation) return [{ 'Complete Lines (%)': this.reconciliation.costCompletenessBps / 100, 'Revenue Variance (INR)': this.reconciliation.revenueVariancePaise / 100, 'COGS Variance (INR)': this.reconciliation.cogsVariancePaise / 100, 'Payroll Variance (INR)': this.reconciliation.payrollVariancePaise / 100, 'Missing Journals': this.reconciliation.missingInvoiceJournalCount, 'Close Ready': this.reconciliation.branchPeriodCloseReady ? 'Yes' : 'No' }];
    if (this.profitTab === 'scenario') return (this.advanced?.profitDigitalTwin.scenarios ?? []).map((row) => ({ Scenario: row.name, 'Revenue (INR)': row.projectedRevenuePaise / 100, 'Profit (INR)': row.projectedProfitPaise / 100, 'Change (INR)': row.profitDeltaPaise / 100, 'Margin (%)': row.projectedMarginBps / 100 }));
    if (this.profitTab === 'guard' && this.posGuardDecision) return [{ Decision: this.posGuardDecision.decision.decision, Status: this.posGuardDecision.decision.status, 'Estimated Profit (INR)': this.posGuardDecision.decision.estimatedProfitPaise / 100, 'Margin (%)': this.posGuardDecision.decision.marginBps / 100, Message: this.posGuardDecision.decision.message }];
    if (this.profitTab === 'executive' && this.advanced) return [{ 'Revenue/Staff (INR)': this.advanced.executiveKpis.revenuePerStaffPaise / 100, 'Revenue/Customer (INR)': this.advanced.executiveKpis.revenuePerCustomerPaise / 100, 'Revenue/Branch (INR)': this.advanced.executiveKpis.revenuePerBranchPaise / 100, 'Forecast Profit (INR)': this.advanced.enterpriseAnalytics.nextMonthForecastProfitPaise / 100, 'Expected Recovery (INR)': this.advanced.boardReport.expectedRecoveryPaise / 100 }];
    return [];
  }

  titleCase(value: string): string {
    return value.toLowerCase().replace(/(^|\s)\S/g, (letter) => letter.toUpperCase());
  }

  money(paise?: number): string {
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(Number(paise || 0) / 100);
  }

  liveCell(value: unknown, key = ''): string {
    if (typeof value === 'number' && key.toLowerCase().includes('paise')) return this.money(value);
    if (typeof value === 'number') return new Intl.NumberFormat('en-IN').format(value);
    if (value == null || value === '') return '-';
    if (typeof value === 'object') return JSON.stringify(value);
    return String(value);
  }

  percent(bps?: number): string { return `${(Number(bps || 0) / 100).toFixed(1)}%`; }

  paiseToInr(paise: number | null): number | null { return paise == null ? null : paise / 100; }
  inrToPaise(inr: number | null): number | null { return inr == null || inr === ('' as unknown as number) ? null : Math.round(Number(inr) * 100); }

  trendPoints(field: keyof Pick<ProfitTrendPoint, 'revenuePaise' | 'directCostPaise' | 'contributionProfitPaise'>): string {
    const trend = this.advanced?.enterpriseAnalytics.trend ?? [];
    const max = Math.max(1, ...trend.flatMap((row) => [row.revenuePaise, row.directCostPaise, Math.abs(row.contributionProfitPaise)]));
    return trend.map((row, index) => `${trend.length === 1 ? 50 : index * 100 / (trend.length - 1)},${40 - Math.max(0, Number(row[field])) * 36 / max}`).join(' ');
  }

  bookingHour(hour: number): string { return `${String(hour).padStart(2, '0')}:00`; }

  reportDate(value?: string): string { return value ? value.split('-').reverse().join('/') : '-'; }

  actionPeriod(action: ProfitAction): string {
    return action.periodStart && action.periodEnd ? `${this.reportDate(action.periodStart)}–${this.reportDate(action.periodEnd)}` : 'No period';
  }

  isActionOverdue(action: ProfitAction): boolean {
    return !['completed', 'dismissed'].includes(action.status) && !!action.dueAt && new Date(action.dueAt).getTime() < Date.now();
  }

  slaLabel(action: ProfitAction): string {
    if (!action.slaMinutes) return '-';
    const hours = Math.round(action.slaMinutes / 60);
    return hours < 48 ? `${hours}h` : `${Math.round(hours / 24)}d`;
  }

  formatDate(value?: string): string {
    const date = new Date(value || '');
    return Number.isNaN(date.getTime()) ? '-' : new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
  }

  reportIcon(icon?: string): string {
    const paths: Record<string, string> = {
      dashboard: 'M3 13h8V3H3v10Zm0 8h8v-6H3v6Zm10 0h8V11h-8v10Zm0-18v6h8V3h-8Z',
      calendar: 'M19 4h-1V2h-2v2H8V2H6v2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2Zm0 16H5V9h14v11Z',
      sales: 'M3 17h3v-7H3v7Zm5 0h3V7H8v10Zm5 0h3V3h-3v14Zm5 0h3v-4h-3v4ZM3 21h18v-2H3v2Z',
      invoice: 'M6 2h9l4 4v16H6V2Zm8 1.5V7h3.5L14 3.5ZM8 11h8v2H8v-2Zm0 4h8v2H8v-2Z',
      recovery: 'M12 2a10 10 0 1 0 10 10h-2a8 8 0 1 1-2.34-5.66L14 10h8V2l-2.94 2.94A9.95 9.95 0 0 0 12 2Zm1 5h-2v6l5.25 3.15 1-1.65-4.25-2.5V7Z',
      payment: 'M3 5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5Zm2 2v3h14V7H5Zm0 6v6h14v-6H5Zm3 2h4v2H8v-2Z',
      cash: 'M3 6h18v13H3V6Zm2 2v9h14V8H5Zm7 1a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Zm0 2a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3Z',
      balance: 'M12 3 2 8l10 5 8-4v7h2V8L12 3Zm-6 9v5l6 3 6-3v-5l-6 3-6-3Z',
      product: 'M4 5h16v14H4V5Zm2 2v10h12V7H6Zm2 2h8v2H8V9Zm0 4h5v2H8v-2Z',
      inventory: 'M3 7 12 2l9 5v10l-9 5-9-5V7Zm9-2.7L6 7.6 12 11l6-3.4-6-3.3ZM5 9.3v6.5l6 3.3v-6.4L5 9.3Zm8 9.8 6-3.3V9.3l-6 3.4v6.4Z',
      staff: 'M16 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM8 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm0 2c-2.67 0-8 1.34-8 4v3h10v-3c0-1.02.39-1.9 1.06-2.65C10.05 13.53 8.8 13 8 13Zm8 0c-.88 0-1.91.15-2.91.43A4.98 4.98 0 0 1 14 17v3h10v-3c0-2.66-5.33-4-8-4Z',
    };
    return paths[icon || ''] || 'M5 3h14v18H5V3Zm3 5h8V6H8v2Zm0 4h8v-2H8v2Zm0 4h5v-2H8v2Z';
  }

  categoryIcon(category: string): string {
    return {
      'Sales & Finance': this.reportIcon('sales'),
      Customer: 'M12 12a5 5 0 1 0 0-10 5 5 0 0 0 0 10Zm0 2C7.58 14 4 16.24 4 19v3h16v-3c0-2.76-3.58-5-8-5Z',
      Inventory: this.reportIcon('inventory'),
      Staff: this.reportIcon('staff'),
      Packages: 'm12 2 9 5v10l-9 5-9-5V7l9-5Zm0 2.3L6 7.6 12 11l6-3.4-6-3.3ZM5 9.3v6.5l6 3.3v-6.4L5 9.3Zm8 9.8 6-3.3V9.3l-6 3.4v6.4Z',
      Appointments: this.reportIcon('calendar'),
      Overview: this.reportIcon('dashboard'),
    }[category] || this.reportIcon('invoice');
  }

  private normalizeReport(report: ReportItem): ReportItem {
    const fallback = LEGACY_REPORT_METADATA[report.id];
    return {
      ...report,
      title: report.id === 'appointments' ? 'Detail Appointment List' : report.id === 'staff-performance' ? 'Appointments booked by staff' : report.title,
      category: report.category || fallback?.category || 'Other',
      description: report.description || fallback?.description || 'Report data for the selected scope.',
      icon: report.icon || fallback?.icon,
    };
  }

  private blankAction(): ActionDraft {
    return { actionType: 'manual_profit_action', title: '', message: '', impactPaise: null, expectedImpactPaise: null, priority: 'medium', sourceType: 'manual', sourceId: '', periodStart: this.fromDate, periodEnd: this.toDate, slaMinutes: null, notes: '', evidence: '' };
  }

  private blankAllocationRule(): AllocationRuleDraft {
    return { name: '', driver: 'service_minutes', accountCodes: [], effectiveFrom: '', effectiveTo: '' };
  }

  private previousPeriod(): { fromDate: string; toDate: string } {
    const from = new Date(`${this.fromDate}T00:00:00Z`);
    const to = new Date(`${this.toDate}T00:00:00Z`);
    const days = Math.max(1, Math.round((to.getTime() - from.getTime()) / 86_400_000) + 1);
    const previousTo = new Date(from.getTime() - 86_400_000);
    const previousFrom = new Date(previousTo.getTime() - (days - 1) * 86_400_000);
    return { fromDate: previousFrom.toISOString().slice(0, 10), toDate: previousTo.toISOString().slice(0, 10) };
  }

  private validateProfitDateRange(): boolean {
    if (this.fromDate && this.toDate && this.fromDate <= this.toDate) return true;
    this.profitError = 'From date must be on or before To date';
    return false;
  }

  private isProfitSavedView(report: CustomReport): boolean {
    return !!report.definition.profitView || report.definition.status?.startsWith('mp_') === true;
  }

  private download(content: string, fileName: string, type: string): void {
    const url = URL.createObjectURL(new Blob([content], { type }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = fileName;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url));
  }

  trapFocus(event: KeyboardEvent): void {
    if (event.key !== 'Tab') return;
    const container = event.currentTarget as HTMLElement;
    const focusable = [...container.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')];
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }

  private focusActiveDialog(): void {
    setTimeout(() => document.querySelector<HTMLElement>('.profit-dialog button, .action-drawer button, .action-drawer input, .action-drawer select')?.focus());
  }

  private escapeHtml(value: string): string {
    return value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character] ?? character));
  }

  private blankCustomReport(): CustomReportDraft {
    return {
      name: '',
      definition: { dataset: 'sales', rowDimension: 'date', columnDimension: 'none', metric: 'revenuePaise', dateRange: 'last30Days', fromDate: this.dateOffset(-29), toDate: this.dateOffset(0), status: '' },
      scheduleFrequency: 'none',
      scheduleDay: 1,
      scheduleTime: '09:00',
      recipientEmail: '',
    };
  }

  private data<T>(response: any): T | null {
    return (response?.data ?? response) as T ?? null;
  }

  private liveUrl(report: ReportItem): string {
    const params = new URLSearchParams();
    if (!['dashboard', 'pos-parity'].includes(report.id)) {
      params.set('startDate', this.fromDate);
      params.set('endDate', this.toDate);
    }
    const query = params.toString();
    return `/api/v1${report.path}${query ? `?${query}` : ''}`;
  }

  private liveRows(data: any): Pick<LiveReportState, 'rows' | 'columns' | 'summary'> {
    const summary = data && !Array.isArray(data) ? { ...data } : {};
    const rows = Array.isArray(data)
      ? data
      : Array.isArray(data?.rows)
        ? data.rows
        : Array.isArray(data?.topInvoices)
          ? data.topInvoices
          : Array.isArray(data?.paymentModes)
            ? data.paymentModes
            : Object.entries(data ?? {}).map(([key, value]) => ({ metric: key, value }));
    delete (summary as any).rows;
    delete (summary as any).topInvoices;
    delete (summary as any).paymentModes;
    const normalized: Array<Record<string, unknown>> = rows.map((row: any) => typeof row === 'object' && row ? row : { value: row });
    const columns = [...new Set<string>(normalized.flatMap((row) => Object.keys(row)))].slice(0, 12);
    return { rows: normalized, columns, summary };
  }

  private dateOffset(days: number): string {
    const date = new Date();
    date.setDate(date.getDate() + days);
    return date.toISOString().slice(0, 10);
  }

  private readFavourites(): string[] {
    try {
      const saved = JSON.parse(localStorage.getItem(this.favouritesKey) ?? '[]');
      return Array.isArray(saved) ? saved.filter((id): id is string => typeof id === 'string') : [];
    } catch {
      return [];
    }
  }
}

