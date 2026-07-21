import { CommonModule } from '@angular/common';
import { Component, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { DatePickerComponent } from '../../../shared/date-picker/date-picker.component';
import { ApiService } from '../../../shared/services/api.service';

type ReportTab = 'invoices' | 'invoice-activity' | 'due-recovery' | 'service-trends' | 'service-clients' | 'product-sales' | 'product-movements';
interface FilterOption { id: string; name: string; }
interface PaymentMode { code: string; name: string; }
interface InvoiceReportRow { id: string; invoiceNumber: string; branchId: string; clientName: string; staffName: string; businessDate: string; status: string; totalPaise: number; paidPaise: number; balancePaise: number; ageingDays: number; followUpRequired: boolean; }
interface InvoiceActivityRow { invoiceId: string; invoiceNumber: string; activityType: string; channel: string; recipient: string; status: string; createdAt: string; }
interface DueRecoveryRow { invoiceId: string; invoiceNumber: string; clientName: string; totalPaise: number; paidPaise: number; balancePaise: number; ageingDays: number; recoveryDays?: number | null; recovered: boolean; followUpCount: number; lastFollowUpAt?: string; lastPaymentAt?: string; recoveryManagerId: string; recoveryManagerName: string; }
interface ServiceTrendSummary { totalServicesSold: number; totalServiceRevenuePaise: number; averageServicePricePaise: number; topService: string; highestMarginService: string; lowestMarginService: string; discountLeakagePaise: number; serviceGstCollectedPaise: number; }
interface ServiceTrendRow { serviceId: string; serviceName: string; serviceGroup: string; staffName: string; quantitySold: number; grossSalePaise: number; discountPaise: number; netSalePaise: number; gstPaise: number; productCostPaise: number; grossMarginPaise: number; marginBps: number; clientCount: number; repeatClientCount: number; invoiceCount: number; peakSellingHour: string; lastSoldAt: string; }
interface ServiceClientSummary { totalClients: number; totalServiceRevenuePaise: number; totalServiceRows: number; appointmentRows: number; quickSaleRows: number; }
interface ServiceClientRow { soldAt: string; businessDate: string; serviceGroup: string; serviceName: string; clientName: string; clientPhone: string; servicePricePaise: number; saleType: string; staffName: string; invoiceId: string; invoiceNumber: string; }
interface ProductSalesSummary { totalProductsSold: number; totalProductRevenuePaise: number; averageProductPricePaise: number; topProduct: string; discountPaise: number; gstCollectedPaise: number; }
interface ProductSalesRow { productId: string; productName: string; category: string; sku: string; quantitySold: number; netSalePaise: number; discountPaise: number; gstPaise: number; productCostPaise: number; marginBps: number; clientCount: number; invoiceCount: number; lastSoldAt: string; }
interface ProductMovementRow { productId: string; productName: string; category: string; sku: string; currentStock: number; soldQuantity: number; returnedQuantity: number; purchasedQuantity: number; transferOutQuantity: number; transferInQuantity: number; adjustmentQuantity: number; consumedQuantity: number; currentStockValuePaise: number; lastMovementAt?: string; }

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
  activityRows: InvoiceActivityRow[] = [];
  dueRows: DueRecoveryRow[] = [];
  trendRows: ServiceTrendRow[] = [];
  clientRows: ServiceClientRow[] = [];
  productSalesRows: ProductSalesRow[] = [];
  productMovementRows: ProductMovementRow[] = [];
  trendSummary: ServiceTrendSummary | null = null;
  clientSummary: ServiceClientSummary | null = null;
  productSalesSummary: ProductSalesSummary | null = null;
  clients: FilterOption[] = [];
  staff: FilterOption[] = [];
  services: FilterOption[] = [];
  products: FilterOption[] = [];
  modes: PaymentMode[] = [];
  filters = this.emptyFilters();
  branchName = localStorage.getItem('aurashine_branch_name') ?? localStorage.getItem('selectedBranchName') ?? 'Current branch';
  loading = false;
  followUpLoadingId = '';
  followUpNotes: Record<string, string> = {};
  recoveryManagers: Record<string, string> = {};
  reminderLoading = false;
  message = '';
  error = '';

  constructor(private readonly api: ApiService, private readonly route: ActivatedRoute) {}

  ngOnInit(): void {
    const report = this.route.snapshot.queryParamMap.get('report');
    if (report === 'invoice-activity' || report === 'due-recovery' || report === 'service-trends' || report === 'service-clients' || report === 'product-sales' || report === 'product-movements') this.activeTab = report;
    this.loadOptions();
    this.load();
  }

  selectTab(tab: ReportTab): void { this.activeTab = tab; this.load(); }

  load(): void {
    this.loading = true;
    this.error = '';
    const path = this.activeTab === 'invoices' ? '/api/reports/invoices'
      : this.activeTab === 'invoice-activity' ? '/api/v1/reports/invoice-activity'
      : this.activeTab === 'due-recovery' ? '/api/v1/reports/due-recovery'
      : this.activeTab.startsWith('product-') ? `/api/v1/reports/products/${this.activeTab.replace('product-', '')}`
      : `/api/v1/reports/invoices/${this.activeTab}`;
    this.api.get<any>(`${path}?${this.query()}`).subscribe({
      next: (response) => {
        if (this.activeTab === 'invoices') this.rows = this.list(response).map((row) => this.normalizeInvoice(row));
        if (this.activeTab === 'invoice-activity') this.activityRows = this.list(response);
        if (this.activeTab === 'due-recovery') this.dueRows = this.list(response);
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
        if (this.activeTab === 'product-sales') {
          const data = this.data(response);
          this.productSalesSummary = data.summary ?? null;
          this.productSalesRows = Array.isArray(data.rows) ? data.rows : [];
        }
        if (this.activeTab === 'product-movements') this.productMovementRows = this.list(response);
        this.loading = false;
      },
      error: (error: any) => {
        this.error = error?.error?.error?.message ?? error?.error?.message ?? error?.message ?? 'Unable to load report';
        this.loading = false;
      },
    });
  }

  clear(): void { this.filters = this.emptyFilters(); this.load(); }
  recordFollowUp(row: DueRecoveryRow, action: 'follow_up' | 'call_done' | 'assign_manager'): void {
    const note = (this.followUpNotes[row.invoiceId] ?? '').trim();
    if (action === 'follow_up' && !note) { this.error = 'Follow-up note is required'; return; }
    const assignedManagerId = this.recoveryManagers[row.invoiceId] ?? row.recoveryManagerId ?? '';
    if (action === 'assign_manager' && !assignedManagerId) { this.error = 'Recovery manager is required'; return; }
    this.followUpLoadingId = row.invoiceId;
    this.error = '';
    const actionNote = action === 'call_done' ? 'Call completed' : action === 'assign_manager' ? 'Recovery manager assigned' : note;
    const payload = action === 'assign_manager' ? { action, note: actionNote, assignedManagerId } : { action, note: actionNote };
    this.api.post(`/api/v1/reports/invoices/${row.invoiceId}/follow-ups`, payload).subscribe({
      next: () => { this.followUpLoadingId = ''; delete this.followUpNotes[row.invoiceId]; delete this.recoveryManagers[row.invoiceId]; this.message = 'Follow-up saved'; this.load(); },
      error: (error: any) => { this.followUpLoadingId = ''; this.error = error?.error?.error?.message ?? error?.error?.message ?? error?.message ?? 'Unable to save follow-up'; },
    });
  }

  queueDueReminders(): void {
    this.reminderLoading = true;
    this.error = '';
    this.api.post<any>('/api/v1/pos/invoice-outbox/schedule-due-reminders', {}).subscribe({
      next: (response) => { this.reminderLoading = false; this.message = `${Number(this.data(response).queued ?? 0)} due reminder(s) queued`; this.load(); },
      error: (error: any) => { this.reminderLoading = false; this.error = error?.error?.error?.message ?? error?.error?.message ?? error?.message ?? 'Unable to queue due reminders'; },
    });
  }
  formatDate(value: string): string { const date = value.slice(0, 10).split('-'); return date.length === 3 ? `${date[2]}/${date[1]}/${date[0]}` : '-'; }
  percent(bps: number): string { return `${(Number(bps || 0) / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 })}%`; }

  private loadOptions(): void {
    this.api.get<any>('/api/clients').subscribe({ next: (res) => this.clients = this.list(res).map((item) => ({ id: String(item.id), name: this.name(item) })) });
    this.api.get<any>('/api/staff').subscribe({ next: (res) => this.staff = this.list(res).map((item) => ({ id: String(item.id), name: this.name(item) })) });
    this.api.get<any>('/api/services?pageSize=500').subscribe({ next: (res) => this.services = this.list(res).map((item) => ({ id: String(item.id), name: String(item.name) })) });
    this.api.get<any>('/api/v1/products?pageSize=500').subscribe({ next: (res) => this.products = this.list(res).map((item) => ({ id: String(item.id), name: String(item.name) })) });
    this.api.get<any>('/api/pos/payment-methods').subscribe({ next: (res) => this.modes = this.list(res).map((item) => ({ code: String(item.code ?? item.id), name: String(item.name ?? item.label) })) });
  }

  private emptyFilters() { return { clientId: '', staffId: '', serviceId: '', productId: '', paymentMethod: '', status: '', recovery: '', ageingDays: null as number | null, followUp: false, dateFrom: '', dateTo: '', q: '' }; }
  private query(): string { const params = new URLSearchParams(); for (const [key, value] of Object.entries(this.filters)) if (value !== '' && value !== null && value !== false) params.set(['invoice-activity', 'due-recovery'].includes(this.activeTab) && key === 'dateFrom' ? 'startDate' : ['invoice-activity', 'due-recovery'].includes(this.activeTab) && key === 'dateTo' ? 'endDate' : key, String(value)); return params.toString(); }
  private data(response: any): any { return response?.data ?? response ?? {}; }
  private list(response: any): any[] { const data = this.data(response); return Array.isArray(data) ? data : Array.isArray(data.rows) ? data.rows : []; }
  private normalizeInvoice(row: any): InvoiceReportRow { return { id: String(row.id), invoiceNumber: String(row.invoiceNumber ?? row.invoice_number), branchId: String(row.branchId ?? row.branch_id), clientName: String(row.clientName ?? row.client_name ?? 'Walk-in client'), staffName: String(row.staffName ?? row.staff_name ?? '-'), businessDate: String(row.businessDate ?? row.business_date ?? ''), status: String(row.status), totalPaise: Number(row.totalPaise ?? row.total_paise ?? 0), paidPaise: Number(row.paidPaise ?? row.paid_paise ?? 0), balancePaise: Number(row.balancePaise ?? row.balance_paise ?? 0), ageingDays: Number(row.ageingDays ?? row.ageing_days ?? 0), followUpRequired: Boolean(row.followUpRequired ?? row.follow_up_required) }; }
  private name(item: any): string { return String(item.name ?? item.fullName ?? [item.firstName ?? item.first_name, item.lastName ?? item.last_name].filter(Boolean).join(' ') ?? item.id); }
}
