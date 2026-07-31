import { DatePipe } from "@angular/common";
import { Component, computed, OnInit, signal } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { StaffAppService, StaffBusiness, StaffEnterpriseOs } from "../../core/staff-app.service";
import { businessDateOffset, displayBusinessDate, parseDisplayBusinessDate } from "../../core/business-date";
import { PaiseInrPipe } from "../../core/paise-inr.pipe";
import { StaffPageStateComponent } from "./staff-page-state.component";

@Component({
  standalone: true,
  imports: [PaiseInrPipe, DatePipe, FormsModule, StaffPageStateComponent],
  template: `
    <section class="page">
      <header class="page-head">
        <div>
          <p class="eyebrow">Reports</p>
          <h1>Staff reports</h1>
          <p>Filter your work, appointments, completed services and sales impact.</p>
        </div>
      </header>

      @if (!canReadReports()) { <section staffPageState class="notice">You do not have permission to view reports.</section> }
      @if (loading()) { <section staffPageState class="state" [loading]="true">Loading reports...</section> }
      @if (message()) { <section staffPageState class="notice success">{{ message() }}</section> }
      @if (loadError()) { <section staffPageState class="notice">{{ loadError() }}</section> }

      @if (canReadReports()) {
        <section class="panel">
          <div class="panel-title"><h2>Report filters</h2><span>{{ historyMode ? 'All history' : fromDate + ' to ' + toDate }}</span></div>
          <div class="form-grid compact-grid">
            <label>From<input [ngModel]="fromDate" (ngModelChange)="fromDate = $event; historyMode = false" type="text" inputmode="numeric" placeholder="DD/MM/YYYY" aria-label="Report from date DD/MM/YYYY" /></label>
            <label>To<input [ngModel]="toDate" (ngModelChange)="toDate = $event; historyMode = false" type="text" inputmode="numeric" placeholder="DD/MM/YYYY" aria-label="Report to date DD/MM/YYYY" /></label>
            <label>Client<input [(ngModel)]="clientQuery" type="search" maxlength="100" placeholder="Client name" /></label>
            <label>Status<select [(ngModel)]="status"><option value="all">All statuses</option><option value="booked">Booked</option><option value="confirmed">Confirmed</option><option value="in-service">In service</option><option value="completed">Completed</option><option value="cancelled">Cancelled</option><option value="no-show">No-show</option></select></label>
            <label>Service<select [(ngModel)]="serviceId"><option value="">All services</option>@for (service of business()?.services || []; track service.id) { <option [value]="service.id">{{ service.name }}</option> }</select></label>
            <label>Department<select [(ngModel)]="department"><option value="">All departments</option>@for (item of departments(); track item) { <option [value]="item">{{ item }}</option> }</select></label>
          </div>
          <div class="row-actions permission-actions">
            <button class="button primary" type="button" (click)="load()">Apply</button>
            <button class="button" type="button" (click)="quickRange(0)">Today</button>
            <button class="button" type="button" (click)="quickRange(6)">7 days</button>
            <button class="button" type="button" (click)="quickRange(29)">30 days</button>
            <button class="button" type="button" (click)="allHistory()">All history</button>
          </div>
        </section>
      }

      @if (canReadReports() && business(); as data) {
        @if (sourceGaps(data).length) {
          <section class="panel"><div class="panel-title"><h2>CRM source status</h2><span>{{ sourceGaps(data).length }} missing</span></div><div class="list">@for (gap of sourceGaps(data); track gap) { <div class="row"><strong>{{ gap }}</strong><span class="badge">No records in range</span></div> }</div></section>
        }
        <section class="grid four">
          <article class="kpi"><span>Appointments</span><strong>{{ data.summary.appointments }}</strong><small>selected range</small></article>
          <article class="kpi"><span>Completed</span><strong>{{ data.summary.completedServices }}</strong><small>finished services</small></article>
          <article class="kpi"><span>Live</span><strong>{{ data.performance.statusCounts.inService }}</strong><small>active/current</small></article>
          <article class="kpi"><span>Value</span><strong>{{ data.summary.appointmentValuePaise | paiseInr }}</strong><small>appointment value</small></article>
        </section>

        @if (data.permissions.serviceAmount) {
          <section class="grid three">
            <article class="kpi"><span>Sales</span><strong>{{ data.summary.bills }}</strong><small>connected invoices</small></article>
            <article class="kpi"><span>Revenue</span><strong>{{ data.summary.totalPaise | paiseInr }}</strong><small>attributed service sales</small></article>
            <article class="kpi"><span>Avg sale</span><strong>{{ data.performance.averageBillPaise | paiseInr }}</strong><small>revenue per sale</small></article>
          </section>
        }
      }

      @if (canReadReports() && os(); as data) {
        <section class="panel">
          <div class="panel-title"><h2>Performance</h2><span>selected range</span></div>
          <div class="trend-grid">
            @for (row of reportRows(data); track row.key) {
              <article><span>{{ row.key }}</span><strong>{{ scoreLabel(row.value.productivityScore) }}</strong>@if (row.value.productivityScore !== null && row.value.productivityScore !== undefined) { <div class="timer-track"><span [style.width.%]="cap(row.value.productivityScore)"></span></div> }<small>{{ row.value.services }} services · {{ ratingLabel(row.value.rating) }}</small></article>
            } @empty { <p class="empty">No records yet.</p> }
          </div>
        </section>
      }

      @if (canReadReports() && business(); as data) {
        <section class="panel">
          <div class="panel-title"><h2>Activity trend</h2><span>{{ data.dailyBreakdown.length }} active days</span></div>
          <div class="trend-grid">
            @for (day of data.dailyBreakdown; track day.date) {
              <article><span>{{ displayDate(day.date) }}</span><strong>{{ day.completedServices }} completed</strong><div class="timer-track"><span [style.width.%]="completionPercent(day)"></span></div><small>{{ day.appointments }} appointments · {{ day.workedMinutes }} min</small></article>
            } @empty { <p class="empty">No activity in this report window.</p> }
          </div>
        </section>

        <section class="grid two">
          <article class="panel">
            <div class="panel-title"><h2>Service history</h2><span>{{ data.pagination.appointmentTotal }}</span></div>
            <div class="list">
              @for (item of data.appointments; track item.id) {
                <div class="row"><div class="row-main"><strong>{{ item.clientName || 'Assigned appointment' }} @if (item.preferredClient) { · Preferred }</strong><small>{{ item.startAt | date:'dd/MM/yyyy, h:mm a' }} · {{ item.serviceNames.join(', ') || 'Service' }}@if (item.serviceDepartments.length) { · {{ item.serviceDepartments.join(', ') }}}</small><small>Shifted {{ item.rescheduleCount }} times@if (item.lastServiceAt) { · Last service {{ item.lastServiceAt | date:'dd/MM/yyyy' }}}</small></div><span class="badge">{{ item.status }}</span></div>
              } @empty { <p class="empty">No work in this report window.</p> }
            </div>
            @if (data.pagination.appointmentHasMore) { <div class="row-actions permission-actions"><button class="button" type="button" [disabled]="loadingMore()" (click)="load(false)">{{ loadingMore() ? 'Loading...' : 'Load More' }}</button></div> }
          </article>
          <article class="panel">
            <div class="panel-title"><h2>Service sales</h2><span>{{ data.performance.invoiceCount }}</span></div>
            <div class="list">
              @for (sale of data.serviceInvoices; track sale.saleId + ':' + sale.id) {
                <div class="row"><div class="row-main"><strong>{{ sale.serviceName }}</strong><small>{{ sale.createdAt | date:'dd/MM/yyyy, h:mm a' }}@if (data.permissions.serviceAmount) { · {{ sale.netTotalPaise | paiseInr }}}</small></div><span class="badge">{{ sale.status }}</span></div>
              } @empty { <p class="empty">No sales entries visible.</p> }
            </div>
          </article>
        </section>
      }
    </section>
  `,
  styleUrls: ["./staff-app.styles.css"]
})
export class StaffReportsPage implements OnInit {
  readonly os = signal<StaffEnterpriseOs | null>(null);
  readonly business = signal<StaffBusiness | null>(null);
  readonly loading = signal(false);
  readonly loadingMore = signal(false);
  readonly message = signal("");
  readonly loadError = signal("");
  fromDate = this.displayDate(this.dateOffset(6));
  toDate = this.displayDate(this.dateOffset(0));
  clientQuery = "";
  status = "all";
  serviceId = "";
  department = "";
  historyMode = false;
  readonly departments = computed(() => [...new Set((this.business()?.services || []).map((service) => service.category).filter(Boolean))].sort());
  private loadGeneration = 0;

  constructor(readonly staff: StaffAppService) {}

  ngOnInit() { if (this.canReadReports()) void this.load(); }

  async load(reset = true) {
    const from = this.historyMode ? "" : this.parseDate(this.fromDate);
    const to = this.historyMode ? "" : this.parseDate(this.toDate);
    if (!this.historyMode && (!from || !to || from > to)) {
      this.message.set("Choose a valid From date on or before the To date (DD/MM/YYYY). ");
      return;
    }
    const generation = ++this.loadGeneration;
    if (!this.canReadReports()) {
      this.os.set(null);
      this.business.set(null);
      return;
    }
    const current = this.business();
    const page = reset ? 1 : Number(current?.pagination.page || 1) + 1;
    reset ? this.loading.set(true) : this.loadingMore.set(true);
    this.message.set("");
    this.loadError.set("");
    try {
      const data = await this.staff.business({ from: from || undefined, to: to || undefined, allHistory: this.historyMode, page, pageSize: 50, q: this.clientQuery.trim(), status: this.status, serviceId: this.serviceId, department: this.department, sort: "desc" });
      if (generation !== this.loadGeneration) return;
      if (reset || !current) this.business.set(data);
      else {
        const appointments = new Map([...current.appointments, ...data.appointments].map((item) => [item.id, item]));
        this.business.set({ ...data, appointments: [...appointments.values()] });
      }
    } catch {
      if (generation === this.loadGeneration) this.loadError.set(this.staff.error() || "Unable to load staff reports.");
    } finally {
      if (generation === this.loadGeneration) { this.loading.set(false); this.loadingMore.set(false); }
    }
    if (!reset || this.historyMode) { this.os.set(null); return; }
    try {
      const data = await this.staff.enterpriseOs({ from, to }, false);
      if (generation === this.loadGeneration) this.os.set(data);
    } catch {
      if (generation === this.loadGeneration) this.os.set(null);
    }
  }

  canReadReports(): boolean {
    return this.staff.hasPermission("staff.app.reports.read");
  }

  reportRows(data: StaffEnterpriseOs) { return Object.entries(data.reports || {}).map(([key, value]) => ({ key, value })); }
  scoreLabel(value: number | null): string { return value === null || value === undefined ? "No records yet" : `${value}/100`; }
  ratingLabel(value: number | null): string { return value === null || value === undefined ? "No records yet" : `${value}/5`; }
  cap(value: number): number { return Math.max(0, Math.min(100, Number(value || 0))); }

  completionPercent(day: StaffBusiness["dailyBreakdown"][number]): number { return day.appointments ? this.cap(day.completedServices * 100 / day.appointments) : 0; }
  sourceGaps(data: StaffBusiness): string[] {
    return [
      !data.services.length && "Active service catalogue — CRM Services",
      !data.summary.appointments && "Assigned appointments — CRM Appointments",
      !data.performance.dutyMinutes && "Published schedule or attendance — CRM Availability / Attendance",
      data.permissions.serviceAmount && !data.performance.invoiceCount && "Completed service sales — CRM POS"
    ].filter((value): value is string => !!value);
  }

  async quickRange(daysBack: number) {
    this.historyMode = false;
    this.fromDate = this.displayDate(this.dateOffset(daysBack));
    this.toDate = this.displayDate(this.dateOffset(0));
    await this.load();
  }

  async allHistory() {
    this.historyMode = true;
    this.fromDate = "";
    this.toDate = "";
    await this.load();
  }

  displayDate(value: string): string {
    return displayBusinessDate(value);
  }

  private parseDate(value: string): string {
    return parseDisplayBusinessDate(value);
  }

  private dateOffset(daysBack: number): string {
    return businessDateOffset(-daysBack);
  }
}
