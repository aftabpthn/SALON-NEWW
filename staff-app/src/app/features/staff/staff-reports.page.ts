import { DatePipe } from "@angular/common";
import { Component, OnInit, signal } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { StaffAppService, StaffDashboard, StaffEnterpriseOs } from "../../core/staff-app.service";
import { businessDateOffset } from "../../core/business-date";
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
      @if (staff.error()) { <section staffPageState class="notice">{{ staff.error() }}</section> }

      @if (canReadReports()) {
        <section class="panel">
          <div class="panel-title"><h2>Report filters</h2><span>{{ fromDate }} to {{ toDate }}</span></div>
          <div class="form-grid compact-grid">
            <label>From<input [(ngModel)]="fromDate" type="date" /></label>
            <label>To<input [(ngModel)]="toDate" type="date" /></label>
          </div>
          <div class="row-actions permission-actions">
            <button class="button primary" type="button" (click)="load()">Apply</button>
            <button class="button" type="button" (click)="quickRange(0)">Today</button>
            <button class="button" type="button" (click)="quickRange(6)">7 days</button>
            <button class="button" type="button" (click)="quickRange(29)">30 days</button>
          </div>
        </section>
      }

      @if (canReadReports() && dashboard(); as dash) {
        <section class="grid four">
          <article class="kpi"><span>Appointments</span><strong>{{ dash.summary.appointments }}</strong><small>{{ dash.summary.todayAppointments }} in selected day</small></article>
          <article class="kpi"><span>Completed</span><strong>{{ dash.summary.completedAppointments }}</strong><small>finished services</small></article>
          <article class="kpi"><span>Live</span><strong>{{ dash.summary.liveAppointments }}</strong><small>active/current</small></article>
          <article class="kpi"><span>Value</span><strong>{{ dash.summary.appointmentValue | paiseInr }}</strong><small>appointment value</small></article>
        </section>

        @if (canSeeRevenue()) {
          <section class="grid three">
            <article class="kpi"><span>Sales</span><strong>{{ dash.summary.salesCount }}</strong><small>visible sales records</small></article>
            <article class="kpi"><span>Revenue</span><strong>{{ dash.summary.revenue | paiseInr }}</strong><small>connected sales</small></article>
            <article class="kpi"><span>Avg sale</span><strong>{{ averageSale() | paiseInr }}</strong><small>revenue per sale</small></article>
          </section>
        }
      }

      @if (canReadReports() && os(); as data) {
        <section class="panel">
          <div class="panel-title"><h2>Performance trend</h2><span>daily to yearly</span></div>
          <div class="trend-grid">
            @for (row of reportRows(data); track row.key) {
              <article><span>{{ row.key }}</span><strong>{{ scoreLabel(row.value.productivityScore) }}</strong>@if (row.value.productivityScore !== null && row.value.productivityScore !== undefined) { <div class="timer-track"><span [style.width.%]="cap(row.value.productivityScore)"></span></div> }<small>{{ row.value.services }} services · {{ ratingLabel(row.value.rating) }}</small></article>
            } @empty { <p class="empty">No records yet.</p> }
          </div>
        </section>
      }

      @if (canReadReports() && dashboard(); as dash) {
        <section class="grid two">
          <article class="panel">
            <div class="panel-title"><h2>Work report</h2><span>{{ dash.workReport.length }}</span></div>
            <div class="list">
              @for (item of dash.workReport.slice(0, 30); track item.id) {
                <div class="row"><div class="row-main"><strong>Assigned appointment</strong><small>{{ item.startAt | date:'medium' }} · {{ item.serviceNames.join(', ') || 'Service' }}</small></div><span class="badge">{{ item.status }}</span></div>
              } @empty { <p class="empty">No completed work in this report window.</p> }
            </div>
          </article>
          <article class="panel">
            <div class="panel-title"><h2>Sales</h2><span>{{ dash.sales.length }}</span></div>
            <div class="list">
              @for (sale of dash.sales.slice(0, 30); track sale.id) {
                <div class="row"><div class="row-main"><strong>{{ sale.total | paiseInr }}</strong><small>{{ sale.createdAt | date:'short' }} · commission {{ sale.commissionTotal | paiseInr }}</small></div><span class="badge">{{ sale.status }}</span></div>
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
  readonly dashboard = signal<StaffDashboard | null>(null);
  readonly loading = signal(false);
  readonly message = signal("");
  fromDate = this.dateOffset(6);
  toDate = this.dateOffset(0);
  private loadGeneration = 0;

  constructor(readonly staff: StaffAppService) {}

  ngOnInit() { if (this.canReadReports()) void this.load(); }

  async load() {
    const generation = ++this.loadGeneration;
    if (!this.canReadReports()) {
      this.os.set(null);
      this.dashboard.set(null);
      return;
    }
    this.loading.set(true);
    this.message.set("");
    try {
      const params = { from: this.fromDate, to: this.toDate, date: this.toDate };
      const [os, dashboard] = await Promise.all([this.staff.enterpriseOs(params), this.staff.dashboard(params)]);
      if (generation !== this.loadGeneration) return;
      this.os.set(os);
      this.dashboard.set(dashboard);
    } finally {
      if (generation === this.loadGeneration) this.loading.set(false);
    }
  }

  canReadReports(): boolean {
    return this.staff.hasPermission("staff.app.reports.read");
  }

  canSeeRevenue(): boolean { return this.staff.hasAnyPermission(["staff.app.business.service_amount.read", "read:finance", "read:sales", "read:payments", "read:invoices"]); }
  reportRows(data: StaffEnterpriseOs) { return Object.entries(data.reports || {}).map(([key, value]) => ({ key, value })); }
  scoreLabel(value: number | null): string { return value === null || value === undefined ? "No records yet" : `${value}/100`; }
  ratingLabel(value: number | null): string { return value === null || value === undefined ? "No records yet" : `${value}/5`; }
  cap(value: number): number { return Math.max(0, Math.min(100, Number(value || 0))); }

  averageSale(): number {
    const summary = this.dashboard()?.summary;
    return summary?.salesCount ? Number(summary.revenue || 0) / Number(summary.salesCount) : 0;
  }

  async quickRange(daysBack: number) {
    this.fromDate = this.dateOffset(daysBack);
    this.toDate = this.dateOffset(0);
    await this.load();
  }

  private dateOffset(daysBack: number): string {
    return businessDateOffset(-daysBack);
  }
}
