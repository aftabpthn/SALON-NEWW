import { Component, OnInit, signal } from "@angular/core";
import { IonSpinner } from "@ionic/angular/standalone";
import { StaffAppService, StaffEnterpriseOs } from "../../core/staff-app.service";
import { PaiseInrPipe } from "../../core/paise-inr.pipe";

@Component({
  standalone: true,
  imports: [PaiseInrPipe, IonSpinner],
  template: `
    <section class="page"><header class="page-head"><div><p class="eyebrow">Performance</p><h1>Performance intelligence</h1><p>Productivity, utilization, rating and improvement signals.</p></div></header>
      @if (loading()) { <section class="state"><ion-spinner name="crescent" /> Loading performance...</section> }
      @if (staff.error()) { <section class="notice">{{ staff.error() }}</section> }
      @if (os(); as data) {
        <section class="grid four"><article class="kpi"><span>Score</span><strong>{{ data.performance.productivityScore }}/100</strong></article><article class="kpi"><span>Services</span><strong>{{ data.performance.completedServices }}</strong></article><article class="kpi"><span>Utilization</span><strong>{{ data.performance.avgUtilization }}%</strong></article><article class="kpi"><span>Rating</span><strong>{{ data.performance.avgRating || '-' }}</strong></article></section>
        <section class="panel"><div class="panel-title"><h2>Trend board</h2><span>daily to yearly</span></div><div class="trend-grid">@for (key of reportKeys(); track key) { <article><span>{{ key }}</span><strong>{{ data.reports[key].productivityScore }}/100</strong><div class="timer-track"><span [style.width.%]="data.reports[key].productivityScore"></span></div><small>{{ data.reports[key].services }} services</small></article> }</div></section>
        <section class="grid two"><article class="panel"><div class="panel-title"><h2>Strengths</h2><span>{{ data.performance.strengths.length }}</span></div>@for (item of data.performance.strengths; track item) { <p class="insight">{{ item }}</p> }</article><article class="panel"><div class="panel-title"><h2>Opportunities</h2><span>{{ data.performance.opportunities.length }}</span></div>@for (item of data.performance.opportunities; track item) { <p class="insight">{{ item }}</p> }</article></section>
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
  ngOnInit() { void this.load(); }
  async load() { this.loading.set(true); try { this.os.set(await this.staff.enterpriseOs()); } finally { this.loading.set(false); } }
  canSeeRevenue(): boolean { return this.staff.hasAnyPermission(["read:finance", "read:sales", "read:payments", "read:invoices"]); }
  reportKeys(): Array<"daily" | "weekly" | "monthly" | "yearly"> { return ["daily", "weekly", "monthly", "yearly"]; }
}
