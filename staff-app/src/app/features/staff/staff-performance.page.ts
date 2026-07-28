import { Component, OnInit, signal } from "@angular/core";
import { StaffAppService, StaffEnterpriseOs } from "../../core/staff-app.service";
import { PaiseInrPipe } from "../../core/paise-inr.pipe";
import { StaffPageStateComponent } from "./staff-page-state.component";

@Component({
  standalone: true,
  imports: [PaiseInrPipe, StaffPageStateComponent],
  template: `
    <section class="page"><header class="page-head"><div><p class="eyebrow">Performance</p><h1>Performance intelligence</h1><p>Productivity, utilization, rating and improvement signals.</p></div></header>
      @if (!canReadPerformance()) { <section staffPageState class="notice">You do not have permission to view performance.</section> }
      @if (loading()) { <section staffPageState class="state" [loading]="true">Loading performance...</section> }
      @if (staff.error()) { <section staffPageState class="notice">{{ staff.error() }}</section> }
      @if (canReadPerformance() && os(); as data) {
        <section class="grid four"><article class="kpi"><span>Score</span><strong>{{ scoreLabel(data.performance.productivityScore) }}</strong></article><article class="kpi"><span>Services</span><strong>{{ data.performance.completedServices }}</strong></article><article class="kpi"><span>Utilization</span><strong>{{ percentLabel(data.performance.avgUtilization) }}</strong></article><article class="kpi"><span>Rating</span><strong>{{ ratingLabel(data.performance.avgRating) }}</strong></article></section>
        <section class="panel"><div class="panel-title"><h2>Trend board</h2><span>{{ reportRows(data).length }}</span></div><div class="trend-grid">@for (row of reportRows(data); track row.key) { <article><span>{{ row.key }}</span><strong>{{ scoreLabel(row.value.productivityScore) }}</strong>@if (row.value.productivityScore !== null && row.value.productivityScore !== undefined) { <div class="timer-track"><span [style.width.%]="cap(row.value.productivityScore)"></span></div> }<small>{{ row.value.services }} services · {{ ratingLabel(row.value.rating) }}</small></article> } @empty { <p class="empty">No records yet.</p> }</div></section>
        <section class="grid two"><article class="panel"><div class="panel-title"><h2>Strengths</h2><span>{{ data.performance.strengths.length }}</span></div>@for (item of data.performance.strengths; track item) { <p class="insight">{{ item }}</p> } @empty { <p class="empty">No records yet.</p> }</article><article class="panel"><div class="panel-title"><h2>Opportunities</h2><span>{{ data.performance.opportunities.length }}</span></div>@for (item of data.performance.opportunities; track item) { <p class="insight">{{ item }}</p> } @empty { <p class="empty">No records yet.</p> }</article></section>
        @if (canSeeRevenue()) { <section class="panel"><div class="panel-title"><h2>Revenue impact</h2><span>connected</span></div><h2>{{ data.performance.revenue | paiseInr }}</h2></section> }
      }
    </section>
  `,
  styleUrls: ["./staff-app.styles.css"]
})
export class StaffPerformancePage implements OnInit {
  readonly os = signal<StaffEnterpriseOs | null>(null);
  readonly loading = signal(false);
  constructor(readonly staff: StaffAppService) {}
  ngOnInit() { if (this.canReadPerformance()) void this.load(); }
  async load() { this.loading.set(true); try { this.os.set(await this.staff.enterpriseOs()); } finally { this.loading.set(false); } }
  canReadPerformance(): boolean { return this.staff.hasPermission("staff.app.performance.read"); }
  canSeeRevenue(): boolean { return this.staff.hasAnyPermission(["staff.app.business.service_amount.read", "read:finance", "read:sales", "read:payments", "read:invoices"]); }
  reportRows(data: StaffEnterpriseOs) { return Object.entries(data.reports || {}).map(([key, value]) => ({ key, value })); }
  scoreLabel(value: number | null): string { return value === null || value === undefined ? "No records yet" : `${value}/100`; }
  percentLabel(value: number | null): string { return value === null || value === undefined ? "No records yet" : `${value}%`; }
  ratingLabel(value: number | null): string { return value === null || value === undefined ? "No records yet" : `${value}/5`; }
  cap(value: number): number { return Math.max(0, Math.min(100, Number(value || 0))); }
}
