import { CommonModule } from '@angular/common';
import { Component, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { DatePickerComponent } from '../../../shared/date-picker/date-picker.component';
import { ApiService } from '../../../shared/services/api.service';

type ReportTab = 'invoices' | 'service-trends' | 'service-clients';
interface FilterOption { id: string; name: string; }
interface PaymentMode { code: string; name: string; }
interface InvoiceReportRow { id: string; invoiceNumber: string; branchId: string; clientName: string; staffName: string; businessDate: string; status: string; totalPaise: number; paidPaise: number; balancePaise: number; ageingDays: number; followUpRequired: boolean; }
interface ServiceTrendSummary { totalServicesSold: number; totalServiceRevenuePaise: number; averageServicePricePaise: number; topService: string; highestMarginService: string; lowestMarginService: string; discountLeakagePaise: number; serviceGstCollectedPaise: number; }
interface ServiceTrendRow { serviceId: string; serviceName: string; serviceGroup: string; staffName: string; quantitySold: number; grossSalePaise: number; discountPaise: number; netSalePaise: number; gstPaise: number; productCostPaise: number; grossMarginPaise: number; marginBps: number; clientCount: number; repeatClientCount: number; invoiceCount: number; peakSellingHour: string; lastSoldAt: string; }
interface ServiceClientSummary { totalClients: number; totalServiceRevenuePaise: number; totalServiceRows: number; appointmentRows: number; quickSaleRows: number; }
interface ServiceClientRow { soldAt: string; businessDate: string; serviceGroup: string; serviceName: string; clientName: string; clientPhone: string; servicePricePaise: number; saleType: string; staffName: string; invoiceId: string; invoiceNumber: string; }

@Component({
  selector: 'app-invoice-reports-page',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, DatePickerComponent],
  templateUrl: './invoice-reports-page.component.html',
  styleUrls: ['./invoice-reports-page.component.css'],
})
export class InvoiceReportsPageComponent implements OnInit {
  activeTab: ReportTab = 'invoices';
  rows: InvoiceReportRow[] = [];
  trendRows: ServiceTrendRow[] = [];
  clientRows: ServiceClientRow[] = [];
  trendSummary: ServiceTrendSummary | null = null;
  clientSummary: ServiceClientSummary | null = null;
  clients: FilterOption[] = [];
  staff: FilterOption[] = [];
  services: FilterOption[] = [];
  modes: PaymentMode[] = [];
  filters = this.emptyFilters();
  branchName = localStorage.getItem('aurashine_branch_name') ?? localStorage.getItem('selectedBranchName') ?? 'Current branch';
  loading = false;
  error = '';

  constructor(private readonly api: ApiService, private readonly route: ActivatedRoute) {}

  ngOnInit(): void {
    const report = this.route.snapshot.queryParamMap.get('report');
    if (report === 'service-trends' || report === 'service-clients') this.activeTab = report;
    this.loadOptions();
    this.load();
  }

  selectTab(tab: ReportTab): void { this.activeTab = tab; this.load(); }

  load(): void {
    this.loading = true;
    this.error = '';
    const path = this.activeTab === 'invoices'
      ? '/api/reports/invoices'
      : `/api/v1/reports/invoices/${this.activeTab}`;
    this.api.get<any>(`${path}?${this.query()}`).subscribe({
      next: (response) => {
        if (this.activeTab === 'invoices') this.rows = this.list(response).map((row) => this.normalizeInvoice(row));
        if (this.activeTab === 'service-trends') {
          const data = this.data(response);
          this.trendSummary = data.summary ?? null;
          this.trendRows = Array.isArray(data.rows) ? data.rows : [];
        }
        if (this.activeTab === 'service-clients') {
          const data = this.data(response);
          this.clientSummary = data.summary ?? null;
          this.clientRows = Array.isArray(data.rows) ? data.rows : [];
        }
        this.loading = false;
      },
      error: (error: any) => {
        this.error = error?.error?.error?.message ?? error?.error?.message ?? error?.message ?? 'Unable to load report';
        this.loading = false;
      },
    });
  }

  clear(): void { this.filters = this.emptyFilters(); this.load(); }
  formatDate(value: string): string { const date = value.slice(0, 10).split('-'); return date.length === 3 ? `${date[2]}/${date[1]}/${date[0]}` : '-'; }
  percent(bps: number): string { return `${(Number(bps || 0) / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 })}%`; }

  private loadOptions(): void {
    this.api.get<any>('/api/clients').subscribe({ next: (res) => this.clients = this.list(res).map((item) => ({ id: String(item.id), name: this.name(item) })) });
    this.api.get<any>('/api/staff').subscribe({ next: (res) => this.staff = this.list(res).map((item) => ({ id: String(item.id), name: this.name(item) })) });
    this.api.get<any>('/api/services?pageSize=500').subscribe({ next: (res) => this.services = this.list(res).map((item) => ({ id: String(item.id), name: String(item.name) })) });
    this.api.get<any>('/api/pos/payment-methods').subscribe({ next: (res) => this.modes = this.list(res).map((item) => ({ code: String(item.code ?? item.id), name: String(item.name ?? item.label) })) });
  }

  private emptyFilters() { return { clientId: '', staffId: '', serviceId: '', paymentMethod: '', status: '', recovery: '', ageingDays: null as number | null, followUp: false, dateFrom: '', dateTo: '', q: '' }; }
  private query(): string { const params = new URLSearchParams(); for (const [key, value] of Object.entries(this.filters)) if (value !== '' && value !== null && value !== false) params.set(key, String(value)); return params.toString(); }
  private data(response: any): any { return response?.data ?? response ?? {}; }
  private list(response: any): any[] { const data = this.data(response); return Array.isArray(data) ? data : Array.isArray(data.rows) ? data.rows : []; }
  private normalizeInvoice(row: any): InvoiceReportRow { return { id: String(row.id), invoiceNumber: String(row.invoiceNumber ?? row.invoice_number), branchId: String(row.branchId ?? row.branch_id), clientName: String(row.clientName ?? row.client_name ?? 'Walk-in client'), staffName: String(row.staffName ?? row.staff_name ?? '-'), businessDate: String(row.businessDate ?? row.business_date ?? ''), status: String(row.status), totalPaise: Number(row.totalPaise ?? row.total_paise ?? 0), paidPaise: Number(row.paidPaise ?? row.paid_paise ?? 0), balancePaise: Number(row.balancePaise ?? row.balance_paise ?? 0), ageingDays: Number(row.ageingDays ?? row.ageing_days ?? 0), followUpRequired: Boolean(row.followUpRequired ?? row.follow_up_required) }; }
  private name(item: any): string { return String(item.name ?? item.fullName ?? [item.firstName ?? item.first_name, item.lastName ?? item.last_name].filter(Boolean).join(' ') ?? item.id); }
}
