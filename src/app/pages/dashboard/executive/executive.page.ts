import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ApiRecord, ApiService } from '../../../core/api.service';
import { AppStateService } from '../../../core/state/app-state.service';
import { ActivityFeedComponent, ActivityItem } from '../../../shared/components/activity-feed/activity-feed.component';
import { StateComponent } from '../../../shared/ui/state/state.component';
import { ExecutiveDashboard, ExecutiveDashboardService } from './executive.service';

type KpiVm = {
  key: string;
  label: string;
  value: string;
  subtitle?: string;
  delta: number;
  trend: string;
  route: string;
  tone: string;
};

@Component({
  selector: 'app-executive-dashboard-page',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, StateComponent, ActivityFeedComponent],
  providers: [ExecutiveDashboardService],
  templateUrl: './executive.page.html',
  styleUrl: './executive.page.css',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class ExecutiveDashboardPage implements OnInit {
  private readonly service = inject(ExecutiveDashboardService);
  private readonly api = inject(ApiService);
  private readonly appState = inject(AppStateService);

  readonly data = signal<ExecutiveDashboard | null>(null);
  readonly branches = signal<ApiRecord[]>([]);
  readonly loading = signal(true);
  readonly error = signal('');
  readonly range = signal('today');
  readonly branchId = signal(this.appState.selectedBranchId());
  readonly liveMode = signal(false);

  private timer: ReturnType<typeof setInterval> | null = null;

  readonly kpis = computed<KpiVm[]>(() => {
    const data = this.data();
    if (!data) return [];
    const revenue = this.metricValue('revenue');
    const appointments = this.metricValue('appointments');
    const expense = this.estimatedExpense(data);
    const netProfit = revenue - expense;
    const newCustomers = this.metricValue('newCustomers');
    const retention = this.metricValue('retention');
    return [
      this.kpi('todaySales', 'Today Sales', this.currency(revenue), 'POS + invoices', '/kpi-details/dashboard/revenue', 'money', 'revenue'),
      this.kpi('todayAppointments', 'Today Appointments', String(appointments), 'Booked service flow', '/appointments', 'ops', 'appointments'),
      this.customKpi('revenueExpense', 'Revenue vs Expense', `${this.currency(revenue)} / ${this.currency(expense)}`, 'Income against cost', '/finance', 'finance'),
      this.customKpi('netProfit', 'Net Profit', this.currency(netProfit), 'After tracked operating cost', '/finance', netProfit >= 0 ? 'profit' : 'risk'),
      this.customKpi('topStaff', 'Top Staff', this.topStaffLabel(data), 'Highest staff contribution', '/staff', 'people'),
      this.customKpi('topServices', 'Top Services', this.topServiceLabel(data), 'Best selling service', '/reports', 'service'),
      this.customKpi('pendingPayments', 'Pending Payments', this.currency(this.pendingPayments(data)), 'Collection follow-up', '/pos/invoices', 'risk'),
      this.customKpi('lowStock', 'Inventory Low Stock', String(this.lowStockCount(data)), 'Items needing reorder', '/inventory', 'stock'),
      this.kpi('repeatNew', 'Customer Repeat / New', `${retention}% / ${newCustomers}`, 'Retention vs acquisition', '/clients', 'customer', 'retention'),
      this.customKpi('branchPerformance', 'Branch-wise Performance', this.branchPerformanceLabel(), 'Compare revenue and risk', '/reports', 'branch')
    ];
  });

  readonly priorityCards = computed<KpiVm[]>(() =>
    this.kpis().filter((kpi) => ['revenueExpense', 'netProfit', 'pendingPayments', 'lowStock', 'repeatNew', 'branchPerformance'].includes(kpi.key))
  );

  readonly activityItems = computed<ActivityItem[]>(() =>
    (this.data()?.activity || []).map((item) => ({
      type: String(item['type'] || 'activity'),
      title: String(item['title'] || 'Activity'),
      subtitle: String(item['subtitle'] || ''),
      createdAt: String(item['createdAt'] || '')
    }))
  );

  ngOnInit(): void {
    this.api.list<ApiRecord[]>('branches').subscribe({ next: (branches) => this.branches.set(branches || []) });
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.error.set('');
    this.service.load({ range: this.range(), branchId: this.branchId() }).subscribe({
      next: (data) => {
        this.data.set(data);
        this.loading.set(false);
      },
      error: (err) => {
        this.error.set(err?.error?.error?.message || err?.error?.message || err?.message || 'Unable to load executive dashboard');
        this.loading.set(false);
      }
    });
  }

  setRange(value: string): void {
    this.range.set(value);
    this.load();
  }

  setBranch(value: string): void {
    this.branchId.set(value);
    this.appState.setBranch(value);
    this.load();
  }

  toggleLive(): void {
    this.liveMode.update((value) => !value);
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (this.liveMode()) {
      this.timer = setInterval(() => this.load(), 60_000);
    }
  }

  resolveAlert(id: string): void {
    if (!id) return;
    this.service.resolveAnomaly(id).subscribe({ next: () => this.load() });
  }

  maxChartValue(rows: ApiRecord[], key = 'value'): number {
    return Math.max(1, ...rows.map((row) => Number(row[key] || 0)));
  }

  currency(value: unknown): string {
    return `₹${Math.round(Number(value) || 0).toLocaleString('en-IN')}`;
  }

  toNumber(value: unknown): number {
    return Number(value) || 0;
  }

  rows(value: unknown): ApiRecord[] {
    return Array.isArray(value) ? value : [];
  }

  matrix(value: unknown): unknown[][] {
    return Array.isArray(value) ? value as unknown[][] : [];
  }

  record(value: unknown): ApiRecord {
    return value && typeof value === 'object' && !Array.isArray(value) ? value as ApiRecord : {};
  }

  private kpi(key: string, label: string, value: string, subtitle: string, route: string, tone: string, sourceKey = key): KpiVm {
    const item = this.data()?.kpis[sourceKey] || {};
    return {
      key,
      label,
      subtitle,
      value,
      delta: Number(item['deltaPct'] || 0),
      trend: String(item['trend'] || 'flat'),
      route,
      tone
    };
  }

  private customKpi(key: string, label: string, value: string, subtitle: string, route: string, tone: string): KpiVm {
    return { key, label, value, subtitle, delta: 0, trend: 'flat', route, tone };
  }

  private metricValue(key: string): number {
    return Number(this.data()?.kpis[key]?.['value'] || 0);
  }

  private estimatedExpense(data: ExecutiveDashboard): number {
    const gst = this.record(data.salonCritical['gstReports']);
    const chemical = this.record(data.salonCritical['productChemicalCost']);
    const refunds = this.record(data.salonCritical['refundsDisputes']);
    return Math.max(
      0,
      Number(chemical['totalCost'] || chemical['value'] || 0) +
        Number(gst['gstAmount'] || 0) +
        Number(refunds['refundAmount'] || 0)
    );
  }

  private pendingPayments(data: ExecutiveDashboard): number {
    const settlement = this.record(data.salonCritical['razorpaySettlement']);
    return Number(data.kpis['pendingPayments']?.['value'] || settlement['pendingSettlement'] || 0);
  }

  private lowStockCount(data: ExecutiveDashboard): number {
    return this.rows(data.salonCritical['lowStockAlerts']).length || this.rows(data.advanced['lowStockAlerts']).length;
  }

  private topStaffLabel(data: ExecutiveDashboard): string {
    const staff = data.topPerformers.staff?.[0];
    return staff ? String(staff['staff'] || staff['name'] || 'Staff') : 'No data';
  }

  private topServiceLabel(data: ExecutiveDashboard): string {
    const service = data.topPerformers.services?.[0];
    return service ? String(service['service'] || service['name'] || 'Service') : 'No data';
  }

  private branchPerformanceLabel(): string {
    const selected = this.branches().find((branch) => branch['id'] === this.branchId());
    if (selected) return String(selected['name'] || selected['id']);
    const count = this.branches().length;
    return count ? `${count} branches` : 'All branches';
  }
}
