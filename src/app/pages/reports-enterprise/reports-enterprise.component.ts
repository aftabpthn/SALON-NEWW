import { CommonModule } from '@angular/common';
import { Component, OnInit, computed, effect, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { FilterState, PaymentModeItem, ReportKpi, ReportsEnterpriseService } from './reports-enterprise.service';
import { ReportOverviewComponent } from './report-overview.component';
import { ReportRevenueComponent } from './report-revenue.component';
import { ReportClientsComponent } from './report-clients.component';
import { ReportStaffComponent } from './report-staff.component';
import { ReportServicesComponent } from './report-services.component';
import { ReportInventoryComponent } from './report-inventory.component';
import { ReportMarketingComponent } from './report-marketing.component';
import { ReportBranchesComponent } from './report-branches.component';
import { ReportAiInsightsComponent } from './report-ai-insights.component';
import { ReportCustomExportComponent } from './report-custom-export.component';

@Component({
  selector: 'app-reports-enterprise',
  standalone: true,
  imports: [
    CommonModule, FormsModule,
    ReportOverviewComponent, ReportRevenueComponent, ReportClientsComponent,
    ReportStaffComponent, ReportServicesComponent, ReportInventoryComponent,
    ReportMarketingComponent, ReportBranchesComponent, ReportAiInsightsComponent,
    ReportCustomExportComponent
  ],
  templateUrl: './reports-enterprise.component.html',
  styleUrls: ['./reports-enterprise.component.css']
})
export class ReportsEnterpriseComponent implements OnInit {
  readonly kpis = signal<ReportKpi[]>([]);
  readonly loading = signal(true);
  readonly refreshing = signal(false);
  readonly activeTab = signal('overview');
  readonly multiBranch = signal(true);
  readonly kpiLoading = signal(true);
  readonly paymentModeSummary = signal<PaymentModeItem[]>([]);
  readonly paymentModeLoading = signal(true);
  readonly paymentModeTotal = computed(() =>
    this.paymentModeSummary().reduce((s, p) => s + p.amount, 0)
  );

  readonly tabs = computed(() => {
    const base = [
      { id: 'overview', label: 'Business Overview', icon: '📊' },
      { id: 'revenue', label: 'Revenue', icon: '💰' },
      { id: 'clients', label: 'Client Insights', icon: '👤' },
      { id: 'staff', label: 'Staff Performance', icon: '⭐' },
      { id: 'services', label: 'Service Performance', icon: '💇' },
      { id: 'inventory', label: 'Inventory & Product', icon: '📦' },
      { id: 'marketing', label: 'Marketing ROI', icon: '📢' }
    ];
    if (this.multiBranch()) base.push({ id: 'branches', label: 'Branch Comparison', icon: '🏢' });
    base.push(
      { id: 'ai-insights', label: 'AI Insights', icon: '🤖' },
      { id: 'custom-export', label: 'Custom Export', icon: '📥' }
    );
    return base;
  });

  filters: FilterState = {
    dateRange: 'thisMonth',
    from: this.monthStart(),
    to: this.today(),
    branchId: '',
    staffId: '',
    category: '',
    paymentMethod: ''
  };

  constructor(readonly service: ReportsEnterpriseService) {}

  ngOnInit(): void {
    this.loadKpis();
  }

  loadKpis(): void {
    this.kpiLoading.set(true);
    this.paymentModeLoading.set(true);
    this.service.getKpis(this.toFilters()).subscribe(kpis => {
      this.kpis.set(kpis);
      this.kpiLoading.set(false);
      this.loading.set(false);
    });
    this.service.getPaymentModeSummary(this.toFilters()).subscribe(data => {
      this.paymentModeSummary.set(data);
      this.paymentModeLoading.set(false);
    });
  }

  refreshAll(): void {
    this.refreshing.set(true);
    this.loadKpis();
    setTimeout(() => this.refreshing.set(false), 600);
  }

  setDateRange(range: string): void {
    this.filters.dateRange = range;
    const now = new Date();
    switch (range) {
      case 'today':
        this.filters.from = this.filters.to = this.today();
        break;
      case 'thisWeek': {
        const start = new Date(now);
        start.setDate(now.getDate() - now.getDay());
        this.filters.from = start.toISOString().slice(0, 10);
        this.filters.to = this.today();
        break;
      }
      case 'lastMonth': {
        const first = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        const last = new Date(now.getFullYear(), now.getMonth(), 0);
        this.filters.from = first.toISOString().slice(0, 10);
        this.filters.to = last.toISOString().slice(0, 10);
        break;
      }
      default:
        this.filters.from = this.monthStart();
        this.filters.to = this.today();
    }
    this.loadKpis();
  }

  setBranch(id: string): void {
    this.filters.branchId = id;
    this.loadKpis();
  }

  exportReport(): void {
    const csv = this.kpis().map(k => `${k.label},${k.value},${k.change}`).join('\n');
    const blob = new Blob(['KPI Report\n' + csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `aura-report-${this.today()}.csv`; a.click();
    URL.revokeObjectURL(url);
  }

  toFilters() {
    return { ...this.filters, dateRange: this.filters.dateRange };
  }

  private today(): string { return new Date().toISOString().slice(0, 10); }
  private monthStart(): string {
    const d = new Date(); d.setDate(1);
    return d.toISOString().slice(0, 10);
  }
}
