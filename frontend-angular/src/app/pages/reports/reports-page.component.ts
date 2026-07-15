import { CommonModule } from '@angular/common';
import { Component, OnInit, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { DatePickerComponent } from '../../shared/date-picker/date-picker.component';
import { ApiService } from '../../shared/services/api.service';
import { AuthService } from '../../core/services/auth.service';

type ReportItem = {
  id: string;
  title: string;
  category: string;
  description: string;
  icon?: string;
  path: string;
};

type ReportCategory = { name: string; reports: ReportItem[] };
type ProfitTab = 'overview' | 'service' | 'staff' | 'customer' | 'branch' | 'leaks' | 'pricing' | 'recipe' | 'copilot' | 'actions';
type ProfitScope = 'branch' | 'tenant';
type ProfitMetrics = { revenuePaise: number; costOfGoodsPaise: number; operatingExpensePaise: number; totalExpensePaise: number; netProfitPaise: number; netMarginBps: number };
type ProfitSummary = { fromDate: string; toDate: string; source: string; branchScope: ProfitScope; branchCount: number; metrics: ProfitMetrics; breakdown: Array<{ key: string; metrics: ProfitMetrics }> };
type ProfitDimension = { dimension: string; entityId: string; entityName: string; unitCount: number; revenuePaise: number; discountPaise: number; productCostPaise: number; staffCostPaise: number; totalCostPaise: number; netProfitPaise: number; marginBps: number };
type ProfitLeak = { kind: string; sourceType: string; sourceId: string; title: string; message: string; impactPaise: number; severity: string };
type PricingRecommendation = { serviceId: string; serviceName: string; currentAveragePricePaise: number; suggestedPricePaise: number; currentMarginBps: number; targetMarginBps: number; expectedProfitLiftPaise: number };
type RecipeVariance = { serviceId: string; serviceName: string; soldQuantity: number; recipeItemCount: number; expectedCostPaise: number; actualCostPaise: number; variancePaise: number; varianceBps: number };
type CopilotInsight = { kind: string; title: string; message: string; impactPaise: number; sourceType: string; sourceId: string };
type AdvancedProfit = { fromDate: string; toDate: string; source: string; branchScope: ProfitScope; branchCount: number; copilotSource: string; copilotModel: string; serviceProfit: ProfitDimension[]; staffProfit: ProfitDimension[]; customerProfit: ProfitDimension[]; branchProfit: ProfitDimension[]; leaks: ProfitLeak[]; pricing: PricingRecommendation[]; recipeVariance: RecipeVariance[]; copilot: CopilotInsight[] };
type ProfitAction = { id: string; approvalId?: string; actionType: string; title: string; message: string; impactPaise: number; priority: string; status: string; sourceType: string; sourceId: string; createdAt: string; updatedAt: string };
type GovernanceSummary = { configuredRules: number; enabledRules: number; totalEvaluations: number; pendingApprovals: number; approved: number; rejected: number; blocked: number };
type ActionDraft = { actionType: string; title: string; message: string; impactPaise: number | null; priority: string; sourceType: string; sourceId: string };
type CustomReportDefinition = { dataset: string; rowDimension: string; columnDimension: string; metric: string; dateRange: string; fromDate?: string; toDate?: string; status?: string };
type CustomReportDraft = { id?: string; version?: number; name: string; definition: CustomReportDefinition; scheduleFrequency: string; scheduleDay: number; scheduleTime: string; recipientEmail: string };
type CustomReport = CustomReportDraft & { nextRunAt?: string; lastRunAt?: string; lastStatus: string; lastError: string; createdAt: string; updatedAt: string };
type CustomDataset = { id: string; label: string; dimensions: string[]; metrics: string[] };
type CustomReportOptions = { datasets: CustomDataset[]; dateRanges: string[]; schedules: string[] };
type PivotReport = { dataset: string; metric: string; fromDate: string; toDate: string; rows: string[]; columns: string[]; cells: Array<{ rowKey: string; columnKey: string; value: number }>; total: number };

const LEGACY_REPORT_METADATA: Record<string, Pick<ReportItem, 'category' | 'description' | 'icon'>> = {
  dashboard: { category: 'Overview', description: "Appointments, clients, services and today's sales at a glance.", icon: 'dashboard' },
  appointments: { category: 'Appointments', description: 'Appointment counts and service time grouped by day and status.', icon: 'calendar' },
  sales: { category: 'Sales & Finance', description: 'Total, paid and outstanding sales for the selected period.', icon: 'sales' },
  'invoice-activity': { category: 'Sales & Finance', description: 'Invoice notifications and delivery activity.', icon: 'invoice' },
  'due-recovery': { category: 'Sales & Finance', description: 'Outstanding invoice balances and follow-up status.', icon: 'recovery' },
  'service-trends': { category: 'Sales & Finance', description: 'Service revenue, quantity, discount, GST, cost and margin trends.', icon: 'sales' },
  'service-clients': { category: 'Customer', description: 'Clients, staff and invoices linked to each sold service.', icon: 'clients' },
  'payment-modes': { category: 'Sales & Finance', description: 'Payment totals grouped by payment method.', icon: 'payment' },
  'cash-drawer-eod': { category: 'Sales & Finance', description: 'Expected cash, counted cash and variance for day close.', icon: 'cash' },
  'pos-parity': { category: 'Sales & Finance', description: 'Recorded parity checks between POS calculation paths.', icon: 'balance' },
  'staff-performance': { category: 'Staff', description: 'Staff-wise appointment count and billed value for the selected period.', icon: 'staff' },
};

@Component({
  selector: 'page-reports',
  standalone: true,
  imports: [CommonModule, FormsModule, DatePickerComponent],
  templateUrl: './reports-page.component.html',
  styleUrls: ['./reports-page.component.css'],
})
export class ReportsPageComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly favouritesKey = 'aurashine_report_favourites';

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
  profitScope: ProfitScope = 'branch';
  fromDate = this.dateOffset(-29);
  toDate = this.dateOffset(0);
  profitSummary: ProfitSummary | null = null;
  advanced: AdvancedProfit | null = null;
  actions: ProfitAction[] = [];
  governance: GovernanceSummary | null = null;
  actionStatus = 'active';
  actionPriority = '';
  actionBusyId = '';
  actionDrawerOpen = false;
  actionDraft = this.blankAction();

  readonly profitTabs: Array<{ id: ProfitTab; label: string }> = [
    { id: 'overview', label: 'Overview' },
    { id: 'service', label: 'Service' },
    { id: 'staff', label: 'Staff' },
    { id: 'customer', label: 'Customer' },
    { id: 'branch', label: 'Branch' },
    { id: 'leaks', label: 'Leaks' },
    { id: 'pricing', label: 'Pricing' },
    { id: 'recipe', label: 'Recipe Variance' },
    { id: 'copilot', label: 'Copilot' },
    { id: 'actions', label: 'Action Queue' },
  ];
  readonly weekdays = [
    { value: 1, label: 'Monday' }, { value: 2, label: 'Tuesday' }, { value: 3, label: 'Wednesday' },
    { value: 4, label: 'Thursday' }, { value: 5, label: 'Friday' }, { value: 6, label: 'Saturday' },
    { value: 7, label: 'Sunday' },
  ];
  readonly monthDays = Array.from({ length: 28 }, (_, index) => index + 1);

  ngOnInit(): void {
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
    if (report.id === 'profit-intelligence') {
      this.profitOpen = true;
      void this.loadProfitWorkspace();
      return;
    }
    if (['invoice-activity', 'due-recovery', 'service-trends', 'service-clients'].includes(report.id)) {
      const query = report.id.startsWith('service-') ? `?report=${report.id}` : '';
      void this.router.navigateByUrl(`/reports/invoices${query}`);
      return;
    }
    if (report.id === 'appointments') void this.router.navigateByUrl('/appointment-reports');
    if (report.id === 'staff-performance') void this.router.navigateByUrl('/reports/staff-bookings');
    if (report.id === 'cash-drawer-eod') void this.router.navigateByUrl('/pos/cash-drawer');
    if (report.id === 'outgoing-funds') void this.router.navigateByUrl('/finance/outgoing-funds');
  }

  isFavourite(id: string): boolean { return this.favourites.has(id); }
  toggleCategory(name: string): void { this.collapsed.has(name) ? this.collapsed.delete(name) : this.collapsed.add(name); }
  isCollapsed(name: string): boolean { return this.collapsed.has(name); }
  selectCategory(category: string): void { this.activeCategory = this.activeCategory === category ? '' : category; this.activeView = 'all'; }

  get currentDimensionRows(): ProfitDimension[] {
    if (!this.advanced) return [];
    switch (this.profitTab) {
      case 'service': return this.advanced.serviceProfit;
      case 'staff': return this.advanced.staffProfit;
      case 'customer': return this.advanced.customerProfit;
      case 'branch': return this.advanced.branchProfit;
      default: return [];
    }
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

  async loadCustomReports(): Promise<void> {
    this.customLoading = true;
    this.customError = '';
    try {
      const response = await firstValueFrom(this.api.get<any>('/api/v1/reports/custom'));
      const data = this.data<any>(response) ?? {};
      this.customReports = Array.isArray(data.reports) ? data.reports : [];
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
    return this.advanced?.branchProfit.reduce((total, row) => total + row.netProfitPaise, 0) ?? 0;
  }

  closeProfitWorkspace(): void {
    this.profitOpen = false;
    this.actionDrawerOpen = false;
  }

  async loadProfitWorkspace(): Promise<void> {
    this.profitLoading = true;
    this.profitError = '';
    const query = new URLSearchParams({ fromDate: this.fromDate, toDate: this.toDate, scope: this.profitScope });
    try {
      const [summary, advanced, actions, governance] = await Promise.all([
        firstValueFrom(this.api.get<any>(`/api/v1/profit-intelligence/summary?${query}`)),
        firstValueFrom(this.api.get<any>(`/api/v1/profit-intelligence/advanced?${query}`)),
        firstValueFrom(this.api.get<any>(`/api/v1/profit-intelligence/actions?status=${this.actionStatus}&priority=${this.actionPriority}&limit=200`)),
        firstValueFrom(this.api.get<any>('/api/v1/profit-intelligence/governance/summary')).catch(() => null),
      ]);
      this.profitSummary = this.data<ProfitSummary>(summary);
      this.advanced = this.data<AdvancedProfit>(advanced);
      this.actions = this.data<ProfitAction[]>(actions) ?? [];
      this.governance = governance ? this.data<GovernanceSummary>(governance) : null;
    } catch (error: any) {
      this.profitError = error?.error?.error?.message ?? error?.error?.message ?? error?.message ?? 'Unable to load Profit Intelligence';
    } finally {
      this.profitLoading = false;
    }
  }

  async loadActions(): Promise<void> {
    this.profitError = '';
    try {
      const response = await firstValueFrom(this.api.get<any>(`/api/v1/profit-intelligence/actions?status=${this.actionStatus}&priority=${this.actionPriority}&limit=200`));
      this.actions = this.data<ProfitAction[]>(response) ?? [];
    } catch (error: any) {
      this.profitError = error?.error?.error?.message ?? error?.error?.message ?? 'Unable to load Profit Action Queue';
    }
  }

  openActionDrawer(source?: Partial<ActionDraft>): void {
    if (!this.canManageProfit) return;
    this.actionDraft = { ...this.blankAction(), ...source };
    this.actionDrawerOpen = true;
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

  async transitionAction(action: ProfitAction, transition: 'approve' | 'complete' | 'dismiss'): Promise<void> {
    if (!this.canManageProfit) return;
    this.actionBusyId = action.id;
    this.profitError = '';
    try {
      await firstValueFrom(this.api.post(`/api/v1/profit-intelligence/actions/${action.id}/${transition}`, {}));
      await this.loadActions();
    } catch (error: any) {
      this.profitError = error?.error?.error?.message ?? error?.error?.message ?? 'Unable to update profit action';
    } finally {
      this.actionBusyId = '';
    }
  }

  titleCase(value: string): string {
    return value.toLowerCase().replace(/(^|\s)\S/g, (letter) => letter.toUpperCase());
  }

  money(paise?: number): string {
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(Number(paise || 0) / 100);
  }

  percent(bps?: number): string { return `${(Number(bps || 0) / 100).toFixed(1)}%`; }

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
      staff: 'M16 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM8 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm0 2c-2.67 0-8 1.34-8 4v3h10v-3c0-1.02.39-1.9 1.06-2.65C10.05 13.53 8.8 13 8 13Zm8 0c-.88 0-1.91.15-2.91.43A4.98 4.98 0 0 1 14 17v3h10v-3c0-2.66-5.33-4-8-4Z',
    };
    return paths[icon || ''] || 'M5 3h14v18H5V3Zm3 5h8V6H8v2Zm0 4h8v-2H8v2Zm0 4h5v-2H8v2Z';
  }

  categoryIcon(category: string): string {
    return {
      'Sales & Finance': this.reportIcon('sales'),
      Customer: 'M12 12a5 5 0 1 0 0-10 5 5 0 0 0 0 10Zm0 2C7.58 14 4 16.24 4 19v3h16v-3c0-2.76-3.58-5-8-5Z',
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
    return { actionType: 'manual_profit_action', title: '', message: '', impactPaise: null, priority: 'medium', sourceType: 'manual', sourceId: '' };
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
