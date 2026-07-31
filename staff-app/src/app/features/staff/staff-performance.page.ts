import { Component, HostListener, OnInit, signal } from "@angular/core";
import { StaffAppService, StaffEnterpriseOs } from "../../core/staff-app.service";
import { businessDate, businessDateOffset } from "../../core/business-date";
import { PaiseInrPipe } from "../../core/paise-inr.pipe";
import { StaffPageStateComponent } from "./staff-page-state.component";

type PerformanceReportRow = { key: string; value: { days: number; revenue: number | null; services: number; productivityScore: number | null; rating: number | null } };

@Component({
  standalone: true,
  imports: [PaiseInrPipe, StaffPageStateComponent],
  template: `
    <section class="page">
      <header class="page-head"><div><p class="eyebrow">Performance</p><h1>Performance intelligence</h1><p>Productivity, utilization, rating and improvement signals.</p></div></header>
      @if (!canReadPerformance()) { <section staffPageState class="notice">You do not have permission to view performance.</section> }
      @if (loading() && !os()) {
        <section class="performance-skeleton" aria-label="Loading performance">
          <div class="skeleton-grid"><span class="skeleton"></span><span class="skeleton"></span><span class="skeleton"></span><span class="skeleton"></span></div>
          <span class="skeleton performance-list-skeleton"></span>
        </section>
      }
      @if (loadError()) { <section staffPageState class="notice performance-error"><span>{{ loadError() }}</span><button class="link-button" type="button" [disabled]="loading()" [attr.aria-busy]="loading()" (click)="load()">Retry</button></section> }

      @if (canReadPerformance()) {
        <nav class="performance-periods" aria-label="Performance period">
          @for (days of [7, 30, 60]; track days) {
            <button type="button" [class.active]="periodDays() === days" [attr.aria-pressed]="periodDays() === days" [disabled]="loading()" (click)="setPeriod(days)">Last {{ days }} days</button>
          }
        </nav>
      }

      @if (canReadPerformance() && os(); as data) {
        <section class="grid four performance-kpis">
          <article class="kpi"><span>Score</span><strong>{{ scoreLabel(data.performance.productivityScore) }}</strong><small>{{ refreshing() ? 'Refreshing...' : scoreHint(data.performance.productivityScore) }}</small></article>
          <article class="kpi"><span>Services</span><strong>{{ data.performance.completedServices || 0 }}</strong><small>Completed services</small></article>
          <article class="kpi"><span>Utilization</span><strong>{{ percentLabel(data.performance.avgUtilization) }}</strong><small>Worked vs scheduled</small></article>
          <article class="kpi"><span>Rating</span><strong>{{ ratingLabel(data.performance.avgRating) }}</strong><small>CRM review score</small></article>
        </section>
        @if (!hasPerformanceEvidence(data)) { <section staffPageState class="notice performance-empty-notice">No completed services, rating, utilization, or target evidence is available yet.</section> }
        <section class="panel">
          <div class="panel-title"><h2>Trend board</h2><span>{{ refreshing() ? 'Refreshing...' : reportRows(data).length }}</span></div>
          <div class="trend-grid performance-trend-grid">
            @for (row of reportRows(data); track row.key) {
              <article>
                <span>{{ label(row) }}</span>
                <strong>{{ scoreLabel(row.value.productivityScore) }}</strong>
                @if (row.value.productivityScore !== null && row.value.productivityScore !== undefined) { <div class="timer-track"><span [style.width.%]="cap(row.value.productivityScore)"></span></div> }
                <small>{{ row.value.services || 0 }} services · {{ ratingLabel(row.value.rating) }}</small>
                @if (canSeeRevenue() && row.value.revenue !== null && row.value.revenue !== undefined) { <small>{{ row.value.revenue | paiseInr }} revenue</small> }
              </article>
            } @empty { <div class="performance-empty"><p>No trend records yet.</p><small>Daily, weekly, monthly, and yearly CRM summaries will appear when data exists.</small></div> }
          </div>
        </section>
        <section class="grid two performance-insights">
          <article class="panel"><div class="panel-title"><h2>Strengths</h2><span>{{ data.performance.strengths.length }}</span></div>@for (item of data.performance.strengths; track item) { <p class="insight">{{ item }}</p> } @empty { <div class="performance-empty compact"><p>No strengths recorded.</p><small>CRM review or productivity signals are required.</small></div> }</article>
          <article class="panel"><div class="panel-title"><h2>Opportunities</h2><span>{{ data.performance.opportunities.length }}</span></div>@for (item of data.performance.opportunities; track item) { <p class="insight">{{ item }}</p> } @empty { <div class="performance-empty compact"><p>No opportunities recorded.</p><small>Manager reviews or system signals will appear here.</small></div> }</article>
        </section>
        @if (sourceGaps(data).length) {
          <section class="panel"><div class="panel-title"><h2>CRM data readiness</h2><span>{{ sourceGaps(data).length }} pending</span></div><div class="list">@for (gap of sourceGaps(data); track gap) { <div class="row"><strong>{{ gap }}</strong><span class="badge">Pending in CRM</span></div> }</div></section>
        }
        <section class="grid two performance-insights">
          <article class="panel"><div class="panel-title"><h2>Client activity</h2><span>{{ data.performance.appointmentsCount || 0 }} bookings</span></div><p class="insight">{{ data.performance.completedServices || 0 }} completed · {{ data.performance.completionPercent ?? 0 }}% completion</p><p class="insight">{{ data.performance.uniqueClients || 0 }} clients · {{ data.performance.repeatClients || 0 }} repeat</p></article>
          <article class="panel"><div class="panel-title"><h2>Attendance contribution</h2><span>{{ formatMinutes(data.performance.workedMinutes) }}</span></div><p class="insight">{{ data.performance.presentDays || 0 }} present · {{ data.performance.absentDays || 0 }} absent</p><p class="insight">OT {{ formatMinutes(data.performance.overtimeMinutes) }} · Late {{ formatMinutes(data.performance.lateMinutes) }} · Early {{ formatMinutes(data.performance.earlyLeaveMinutes) }}</p></article>
        </section>
        @if (canSeeRevenue()) {
          <section class="panel"><div class="panel-title"><h2>CRM revenue target</h2><span>{{ data.performance.revenueTargetPercent === null || data.performance.revenueTargetPercent === undefined ? 'Not configured' : data.performance.revenueTargetPercent + '%' }}</span></div><p class="insight">Target {{ data.performance.targetRevenuePaise | paiseInr }} · Actual {{ data.performance.revenue | paiseInr }}</p></section>
        }
        <section class="panel"><div class="panel-title"><h2>Revenue actions</h2><span>{{ data.performance.revenueOpportunities?.length || 0 }}</span></div>
          <div class="trend-grid performance-trend-grid">
            @for (item of data.performance.revenueOpportunities || []; track item.key) {
              <article><span>{{ item.title }}</span><strong>{{ item.currentValue }} → {{ item.targetValue }} {{ item.metricUnit }}</strong><small>{{ item.reason }}</small><small>Owner: {{ item.ownerStaffName }} · Due {{ item.deadline }}</small><small>Action: {{ item.suggestedAction }} · {{ item.actionStatus || item.status }}</small>@if (canSeeRevenue() && item.projectedImpactPaise !== null) { <small>Projected {{ item.projectedImpactPaise | paiseInr }} · Actual {{ (item.actualImpactPaise || 0) | paiseInr }}</small> }</article>
            } @empty { <div class="performance-empty compact"><p>No revenue action currently needs attention.</p></div> }
          </div>
        </section>
        <section class="panel"><div class="panel-title"><h2>Equipment capacity</h2><span>{{ data.performance.equipmentIntelligence?.summary?.activeResources || 0 }} active</span></div>
          <div class="trend-grid performance-trend-grid">
            @for (item of data.performance.equipmentIntelligence?.departments || []; track item.department) {
              <article><span>{{ item.department }}</span><strong>{{ item.peakHourlyDemand }} demand · {{ item.activeResources }} resources</strong><small>{{ item.appointments }} appointments · {{ item.unassignedAppointments }} without resource</small><small>{{ item.capacityShortage }} peak shortage · {{ item.equipmentLostBookings }} confirmed equipment losses</small></article>
            }
            @for (item of data.performance.equipmentIntelligence?.resources || []; track item.id) {
              <article><span>{{ item.name }} · {{ item.kind }}</span><strong>{{ item.demandWindowUtilizationPercent === null ? 'No utilization evidence' : item.demandWindowUtilizationPercent + '%' }}</strong><small>{{ item.appointments }} appointments · {{ item.bookedMinutes }} booked minutes</small></article>
            } @empty { @if (!(data.performance.equipmentIntelligence?.departments || []).length) { <div class="performance-empty compact"><p>No department resource signals for this period.</p></div> } }
          </div>
        </section>
        @if (canSeeRevenue()) {
          <section class="panel revenue-impact"><div class="panel-title"><h2>Revenue impact</h2><span>{{ data.performance.revenue === null || data.performance.revenue === undefined ? 'No records' : 'Connected' }}</span></div><h2>{{ data.performance.revenue | paiseInr }}</h2></section>
        } @else {
          <section staffPageState class="notice performance-empty-notice">Revenue impact is hidden by your role permissions.</section>
        }
      }
    </section>
  `,
  styleUrls: ["./staff-app.styles.css"],
  styles: [`
    .performance-skeleton { display: grid; gap: 12px; }
    .performance-list-skeleton { min-height: 280px; }
    .performance-error { justify-content: space-between; }
    .performance-kpis .kpi strong { font-size: clamp(1.2rem, 2.4vw, 1.75rem); }
    .performance-empty-notice { background: var(--staff-surface); color: var(--staff-text-secondary); border-color: var(--staff-border); }
    .performance-empty { display: grid; justify-items: center; gap: 5px; grid-column: 1 / -1; padding: 26px 10px; color: var(--staff-text-secondary); font-weight: 600; text-align: center; }
    .performance-empty.compact { padding: 18px 8px; }
    .performance-empty p { margin: 0; }
    .performance-empty small { font-weight: 600; line-height: 1.4; }
    .performance-periods { display: flex; flex-wrap: wrap; gap: 8px; }
    .performance-periods button { min-height: 38px; border: 1px solid var(--staff-border); border-radius: 12px; padding: 8px 12px; color: var(--staff-text); background: var(--staff-surface); font-weight: 700; }
    .performance-periods button:hover, .performance-periods button:focus-visible, .performance-periods button.active { border-color: var(--staff-primary); color: var(--staff-primary-hover); background: var(--staff-primary-light); }
    .performance-trend-grid article { min-width: 0; }
    .performance-trend-grid small { line-height: 1.35; }
    .revenue-impact h2 { margin: 0; color: var(--staff-text); font-size: clamp(1.5rem, 3vw, 2.1rem); }
    @media (max-width: 700px) {
      .performance-error { align-items: stretch; flex-direction: column; }
      .performance-error button { width: 100%; }
      .performance-trend-grid, .performance-insights { grid-template-columns: 1fr; }
    }
  `]
})
export class StaffPerformancePage implements OnInit {
  readonly os = signal<StaffEnterpriseOs | null>(null);
  readonly loading = signal(false);
  readonly refreshing = signal(false);
  readonly loadError = signal("");
  readonly periodDays = signal(30);

  constructor(readonly staff: StaffAppService) {}

  ngOnInit() { if (this.canReadPerformance()) void this.load(); }

  async load(silent = false) {
    if (!this.canReadPerformance()) {
      this.os.set(null);
      return;
    }
    if (silent) this.refreshing.set(true); else this.loading.set(true);
    this.loadError.set("");
    try {
      const to = businessDate();
      this.os.set(await this.staff.enterpriseOs({ from: businessDateOffset(1 - this.periodDays(), to), to }));
    } catch {
      this.loadError.set(this.staff.error() || "Unable to load performance.");
    } finally {
      this.loading.set(false);
      this.refreshing.set(false);
    }
  }

  @HostListener("window:aura:performance-updated")
  onPerformanceUpdated() { if (this.canReadPerformance()) void this.load(true); }

  @HostListener("document:visibilitychange")
  onVisibilityChange() {
    if (document.visibilityState === "visible" && this.canReadPerformance()) void this.load(true);
  }

  setPeriod(days: number) {
    if (days === this.periodDays()) return;
    this.periodDays.set(days);
    void this.load();
  }

  canReadPerformance(): boolean { return this.staff.hasPermission("staff.app.performance.read"); }
  canSeeRevenue(): boolean { return this.staff.hasAnyPermission(["staff.app.business.service_amount.read", "read:finance", "read:sales", "read:payments", "read:invoices"]); }
  reportRows(data: StaffEnterpriseOs): PerformanceReportRow[] { return Object.entries(data.reports || {}).map(([key, value]) => ({ key, value })).filter((row) => !!row.value); }
  hasPerformanceEvidence(data: StaffEnterpriseOs): boolean {
    const performance = data.performance || {} as StaffEnterpriseOs["performance"];
    return !!(performance.completedServices || performance.revenue || performance.productivityScore !== null && performance.productivityScore !== undefined || performance.avgUtilization !== null && performance.avgUtilization !== undefined || performance.avgRating !== null && performance.avgRating !== undefined || performance.strengths?.length || performance.opportunities?.length);
  }
  sourceGaps(data: StaffEnterpriseOs): string[] {
    const performance = data.performance;
    const gaps: string[] = [];
    if (performance.targetRevenuePaise === null || performance.targetRevenuePaise === undefined) gaps.push("Revenue target — Staff profile");
    if (performance.avgRating === null || performance.avgRating === undefined) gaps.push("Shared performance review — Staff Control Center");
    if (performance.avgUtilization === null || performance.avgUtilization === undefined) gaps.push("Published schedule and attendance — Availability / Attendance");
    if (!performance.appointmentsCount) gaps.push("Completed appointment activity — Appointments / POS");
    return gaps;
  }
  formatMinutes(value: number | null | undefined): string { const minutes = Math.max(0, Number(value || 0)); return `${Math.floor(minutes / 60)}h ${minutes % 60}m`; }
  scoreLabel(value: number | null): string { return value === null || value === undefined ? "No records" : `${value}/100`; }
  scoreHint(value: number | null): string { return value === null || value === undefined ? "Waiting for CRM data" : "Connected score"; }
  percentLabel(value: number | null): string { return value === null || value === undefined ? "No records" : `${value}%`; }
  ratingLabel(value: number | null): string { return value === null || value === undefined ? "No records" : `${value}/5`; }
  label(row: PerformanceReportRow): string { return row.key === "selected" ? `Last ${row.value.days} Days` : row.key.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase()); }
  cap(value: number): number { return Math.max(0, Math.min(100, Number(value || 0))); }
}
