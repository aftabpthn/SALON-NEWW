import { CommonModule } from '@angular/common';
import { Component, OnInit, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Observable, catchError, finalize, forkJoin, of } from 'rxjs';
import { ApiService } from '@app/shared/services/api.service';
import { LanguageService } from '@app/core/i18n/language.service';
import { TranslatePipe } from '@app/shared/pipes/translate.pipe';

type ApiEnvelope<T> = { data?: T };
type InsightSection = 'appointments' | 'sales' | 'forecast' | 'activity' | 'dues' | 'payments';

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

type AppointmentGroup = {
  reportDate: string;
  status: string;
  count: number;
  totalMinutes: number;
};

type SalesInvoice = {
  id: string;
  invoiceNumber: string;
  totalPaise: number;
  paidPaise: number;
  status: string;
  createdAt: string;
};

type SalesReport = {
  totalSalesPaise: number;
  paidSalesPaise: number;
  outstandingSalesPaise: number;
  topInvoices: SalesInvoice[];
};

type AppointmentActivity = {
  appointmentId: string;
  clientName?: string;
  staffName?: string;
  serviceNames?: string;
  status?: string;
  paymentStatus?: string;
  appointmentStartAt?: string;
  lastUpdatedAt?: string;
};

type ActivityRegister = { rows?: AppointmentActivity[] };

type DueRecovery = {
  invoiceId: string;
  invoiceNumber: string;
  clientName: string;
  balancePaise: number;
  ageingDays: number;
};

type PaymentMode = {
  method: string;
  paymentCount: number;
  amountPaise: number;
  invoiceCount: number;
};

type TrendPoint = { date: string; value: number };
type StatusPoint = { status: string; count: number };
type RevenueForecast = {
  method: string;
  source: string;
  historyDays: number;
  forecastDays: number;
  historicalTotalPaise: number;
  forecastTotalPaise: number;
  dailyAveragePaise: number;
  history: Array<{ date: string; valuePaise: number }>;
  forecast: Array<{ date: string; valuePaise: number }>;
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

const EMPTY_SALES: SalesReport = {
  totalSalesPaise: 0,
  paidSalesPaise: 0,
  outstandingSalesPaise: 0,
  topInvoices: [],
};
const DASHBOARD_STATUS_LABELS: Readonly<Record<string, string>> = {
  completed: 'dashboard.status.completed',
  scheduled: 'dashboard.status.scheduled',
  cancelled: 'dashboard.status.cancelled',
  canceled: 'dashboard.status.cancelled',
  noshow: 'dashboard.status.noShow',
  no_show: 'dashboard.status.noShow',
  no_showed: 'dashboard.status.noShow',
  checked_in: 'dashboard.status.checkedIn',
  checkedin: 'dashboard.status.checkedIn',
  in_progress: 'dashboard.status.inProgress',
  rescheduled: 'dashboard.status.rescheduled',
  confirmed: 'dashboard.status.confirmed',
  pending: 'dashboard.status.pending',
  open: 'dashboard.status.open',
  draft: 'dashboard.status.draft',
};
const DASHBOARD_PAYMENT_MODE_LABELS: Readonly<Record<string, string>> = {
  cash: 'dashboard.paymentMode.cash',
  card: 'dashboard.paymentMode.card',
  upi: 'dashboard.paymentMode.upi',
  visa: 'dashboard.paymentMode.card',
  mastercard: 'dashboard.paymentMode.card',
  'bank transfer': 'dashboard.paymentMode.bankTransfer',
  bank_transfer: 'dashboard.paymentMode.bankTransfer',
  wallet: 'dashboard.paymentMode.wallet',
  online: 'dashboard.paymentMode.online',
  cheque: 'dashboard.paymentMode.cheque',
  credit: 'dashboard.paymentMode.credit',
};

@Component({
    selector: 'page-dashboard',
    imports: [CommonModule, RouterLink, TranslatePipe],
    templateUrl: './dashboard.component.html',
    styleUrls: ['./dashboard.component.css']
})
export class DashboardComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly language = inject(LanguageService);

  snapshot = EMPTY_SNAPSHOT;
  sales = EMPTY_SALES;
  appointmentTrend: TrendPoint[] = [];
  appointmentStatuses: StatusPoint[] = [];
  salesTrend: TrendPoint[] = [];
  recentActivity: AppointmentActivity[] = [];
  dues: DueRecovery[] = [];
  paymentModes: PaymentMode[] = [];
  revenueForecast?: RevenueForecast;
  periodDays = 30;
  status = 'checking';
  loading = true;
  insightsLoading = true;
  activityLoading = true;
  error = '';
  loadedAt: Date | null = null;
  readonly sectionErrors = new Set<InsightSection>();

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.loading = !this.loadedAt;
    this.error = '';
    this.sectionErrors.clear();
      this.api.get<ApiEnvelope<DashboardSnapshot> | DashboardSnapshot>('/api/v1/reports/dashboard')
      .pipe(finalize(() => (this.loading = false)))
      .subscribe({
        next: (snapshot) => {
          this.snapshot = this.unwrap(snapshot) ?? EMPTY_SNAPSHOT;
          this.status = this.sectionErrors.size ? 'degraded' : 'ok';
          this.loadedAt = new Date();
        },
        error: (error) => {
          this.status = 'unavailable';
          this.error = this.language.text('dashboard.loadError');
        },
      });
    this.loadInsights();
    this.loadActivity();
  }

  setPeriod(days: 7 | 30): void {
    if (this.periodDays === days || this.insightsLoading) return;
    this.periodDays = days;
    this.loadInsights();
  }

  private loadInsights(): void {
    this.insightsLoading = true;
    for (const section of ['appointments', 'sales', 'forecast', 'dues', 'payments'] as InsightSection[]) {
      this.sectionErrors.delete(section);
    }
    const range = this.rangeQuery();

    forkJoin({
      appointments: this.optional('appointments', this.api.get<ApiEnvelope<AppointmentGroup[]> | AppointmentGroup[]>(`/api/v1/reports/appointments?${range}&pageSize=500`)),
      sales: this.optional('sales', this.api.get<ApiEnvelope<SalesReport> | SalesReport>(`/api/v1/reports/sales?${range}`)),
      forecast: this.optional('forecast', this.api.get<ApiEnvelope<RevenueForecast> | RevenueForecast>(
        `/api/v1/reports/revenue-forecast?historyDays=${this.periodDays}&forecastDays=7`,
      )),
      dues: this.optional('dues', this.api.get<ApiEnvelope<DueRecovery[]> | DueRecovery[]>('/api/v1/reports/due-recovery')),
      payments: this.optional('payments', this.api.get<ApiEnvelope<PaymentMode[]> | PaymentMode[]>(`/api/v1/reports/payment-modes?${range}`)),
    }).pipe(finalize(() => (this.insightsLoading = false))).subscribe({
      next: ({ appointments, sales, forecast, dues, payments }) => {
        const appointmentRows = this.unwrap(appointments) ?? [];
        this.sales = this.unwrap(sales) ?? EMPTY_SALES;
        this.revenueForecast = this.unwrap(forecast) ?? undefined;
        this.appointmentTrend = this.groupAppointmentsByDate(appointmentRows);
        this.appointmentStatuses = this.groupAppointmentsByStatus(appointmentRows);
        this.salesTrend = (this.revenueForecast?.history ?? [])
          .slice(-7)
          .map(({ date, valuePaise }) => ({ date, value: valuePaise }));
        this.dues = this.unwrap(dues) ?? [];
        this.paymentModes = this.unwrap(payments) ?? [];
      },
    });
  }

  private loadActivity(): void {
    this.activityLoading = true;
    this.sectionErrors.delete('activity');
    this.optional('activity', this.api.get<ApiEnvelope<ActivityRegister> | ActivityRegister>('/api/v1/appointment-activity/register?limit=100'))
      .pipe(finalize(() => (this.activityLoading = false)))
      .subscribe((activity) => {
        this.recentActivity = this.sortRecentActivity((this.unwrap(activity) ?? {}).rows ?? []).slice(0, 6);
      });
  }

  sectionUnavailable(section: InsightSection): boolean {
    return this.sectionErrors.has(section);
  }

  formatDate(value: string): string {
    const [year, month, day] = String(value || '').slice(0, 10).split('-');
    return year && month && day ? `${day}/${month}/${year}` : '-';
  }

  formatDateTime(value?: string): string {
    const date = new Date(value || '');
    return Number.isNaN(date.getTime())
      ? '-'
      : new Intl.DateTimeFormat('en-GB', {
          day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
        }).format(date);
  }

  labelStatus(value: string | undefined): string {
    const status = String(value || '').trim().toLowerCase();
    if (!status) return '-';
    const labelKey = DASHBOARD_STATUS_LABELS[status];
    return this.language.text(labelKey || 'dashboard.status.unknown');
  }

  labelPaymentMode(value: string | undefined): string {
    const normalized = String(value || '').trim().toLowerCase();
    if (!normalized) return '-';
    const key = DASHBOARD_PAYMENT_MODE_LABELS[normalized] ?? DASHBOARD_PAYMENT_MODE_LABELS[normalized.replace(/[^a-z0-9_]/g, '_')];
    return this.language.text(key || 'dashboard.paymentMode.unknown');
  }

  bookingReference(id?: string): string {
    return id ? `#${id.slice(-8).toUpperCase()}` : '-';
  }

  get maxAppointmentTrend(): number {
    return Math.max(1, ...this.appointmentTrend.map((point) => point.value));
  }

  get maxSalesTrend(): number {
    return Math.max(1, ...this.salesTrend.map((point) => point.value));
  }

  get maxForecastRevenue(): number {
    return Math.max(1, ...(this.revenueForecast?.forecast ?? []).map((point) => point.valuePaise));
  }

  get totalAppointmentStatuses(): number {
    return this.appointmentStatuses.reduce((sum, point) => sum + point.count, 0);
  }

  get totalDuePaise(): number {
    return this.dues.reduce((sum, row) => sum + Number(row.balancePaise || 0), 0);
  }

  get totalPaymentPaise(): number {
    return this.paymentModes.reduce((sum, row) => sum + Number(row.amountPaise || 0), 0);
  }

  get hasData(): boolean {
    return Object.values(this.snapshot).some((value) => value > 0)
      || this.appointmentTrend.length > 0
      || this.salesTrend.length > 0
      || (this.revenueForecast?.forecastTotalPaise ?? 0) > 0
      || this.recentActivity.length > 0
      || this.dues.length > 0
      || this.paymentModes.length > 0;
  }

  private optional<T>(section: InsightSection, request: Observable<T>): Observable<T | null> {
    return request.pipe(catchError(() => {
      this.sectionErrors.add(section);
      return of(null);
    }));
  }

  private unwrap<T>(response: ApiEnvelope<T> | T | null): T | null {
    if (response && typeof response === 'object' && 'data' in response) {
      return (response as ApiEnvelope<T>).data ?? null;
    }
    return response as T | null;
  }

  private rangeQuery(): string {
    const end = this.isoBusinessDate(new Date());
    const start = new Date(`${end}T00:00:00+05:30`);
    start.setDate(start.getDate() - (this.periodDays - 1));
    return `startDate=${this.isoBusinessDate(start)}&endDate=${end}`;
  }

  private isoBusinessDate(value: Date): string {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Kolkata',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(value);
    const byType = new Map(parts.map((part) => [part.type, part.value]));
    return `${byType.get('year')}-${byType.get('month')}-${byType.get('day')}`;
  }

  private groupAppointmentsByDate(rows: AppointmentGroup[]): TrendPoint[] {
    const grouped = new Map<string, number>();
    for (const row of rows) {
      if (!row.reportDate) continue;
      grouped.set(row.reportDate, (grouped.get(row.reportDate) ?? 0) + Number(row.count || 0));
    }
    return [...grouped.entries()]
      .map(([date, value]) => ({ date, value }))
      .sort((a, b) => a.date.localeCompare(b.date))
      .slice(-7);
  }

  private groupAppointmentsByStatus(rows: AppointmentGroup[]): StatusPoint[] {
    const grouped = new Map<string, number>();
    for (const row of rows) {
      const status = String(row.status || 'unknown').toLowerCase();
      grouped.set(status, (grouped.get(status) ?? 0) + Number(row.count || 0));
    }
    return [...grouped.entries()]
      .map(([status, count]) => ({ status, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 6);
  }

  private sortRecentActivity(rows: AppointmentActivity[]): AppointmentActivity[] {
    return [...rows].sort((a, b) => {
      const right = Date.parse(b.lastUpdatedAt || b.appointmentStartAt || '') || 0;
      const left = Date.parse(a.lastUpdatedAt || a.appointmentStartAt || '') || 0;
      return right - left;
    });
  }
}
