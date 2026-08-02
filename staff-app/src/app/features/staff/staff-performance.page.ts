import { DatePipe } from "@angular/common";
import { Component, HostListener, OnInit, signal } from "@angular/core";
import { StaffAppraisal, StaffAppService, StaffPerformanceDashboard, StaffPerformanceMetric } from "../../core/staff-app.service";
import { businessDate, businessDateOffset } from "../../core/business-date";
import { StaffDatePickerComponent } from "../../shared/staff-date-picker.component";
import { StaffPageStateComponent } from "./staff-page-state.component";

type PeriodMode = "day" | "week" | "month" | "pay_period" | "custom";

@Component({
  standalone: true,
  imports: [DatePipe, StaffDatePickerComponent, StaffPageStateComponent],
  template: `
    <section class="page">
      <header class="page-head"><div><p class="eyebrow">Performance</p><h1>Performance intelligence</h1><p>Explainable metrics, goals and coaching from CRM evidence.</p></div></header>
      @if (!canReadPerformance()) { <section staffPageState class="notice">You do not have permission to view performance.</section> }
      @if (canReadPerformance()) {
        <section class="panel performance-controls">
          <nav class="performance-periods" aria-label="Performance period">
            @for (mode of periodModes; track mode.key) { <button type="button" [class.active]="periodMode() === mode.key" [attr.aria-pressed]="periodMode() === mode.key" [disabled]="loading()" (click)="setPeriod(mode.key)">{{ mode.label }}</button> }
          </nav>
          <div class="performance-filter-row">
            @if (periodMode() === 'custom') {
              <label>From<aura-staff-date-picker [value]="fromDate()" ariaLabel="Performance from date" (valueChange)="fromDate.set($event)" /></label>
              <label>To<aura-staff-date-picker [value]="toDate()" [min]="fromDate()" ariaLabel="Performance to date" (valueChange)="toDate.set($event)" /></label>
              <button class="link-button" type="button" [disabled]="loading()" (click)="load()">Apply</button>
            }
            @if (periodMode() === 'pay_period') {
              <label>Pay period<select aria-label="Pay period" [value]="selectedPayPeriod()" (change)="selectPayPeriod($any($event.target).value)">@for (period of dashboard()?.payPeriods || []; track period.id) { <option [value]="period.id">{{ period.from }} – {{ period.to }}</option> }</select></label>
            }
            <label>Revenue basis<select aria-label="Performance revenue basis" [value]="basis()" (change)="setBasis($any($event.target).value)"><option value="sale_date">Sale date</option><option value="close_date">Close date</option></select></label>
          </div>
        </section>
      }
      @if (loading() && !dashboard()) { <section class="performance-skeleton" aria-label="Loading performance"><div class="skeleton-grid"><span class="skeleton"></span><span class="skeleton"></span><span class="skeleton"></span><span class="skeleton"></span></div><span class="skeleton performance-list-skeleton"></span></section> }
      @if (loadError()) { <section staffPageState class="notice performance-error"><span>{{ loadError() }}</span><button class="link-button" type="button" [disabled]="loading()" (click)="load()">Retry</button></section> }

      @if (canReadPerformance() && dashboard(); as data) {
        <section class="panel score-panel">
          <div><span>Transparent score</span><strong>{{ data.score.value === null ? 'No evidence' : data.score.value + '/100' }}</strong><small>{{ data.score.explanation }}</small></div>
          <details><summary>How this score is calculated</summary>@for (part of data.score.components; track part.key) { <div class="row"><div><strong>{{ label(part.key) }}</strong><small>{{ part.source }}</small></div><span>{{ part.value === null ? 'No evidence' : part.value + '%' }} · {{ part.weightPercent }}%</span></div> }</details>
        </section>

        <section class="metric-grid">
          @for (metric of data.metrics; track metric.key) {
            <button class="metric-card" type="button" [class.open]="expandedMetric() === metric.key" (click)="toggleMetric(metric.key)">
              <span>{{ metric.label }}</span><strong>{{ metricValue(metric) }}</strong><small>{{ metric.source }}</small>
              @if (expandedMetric() === metric.key) { <div class="metric-detail"><p>{{ metric.explanation }}</p><p>Numerator {{ metric.numerator }}@if (metric.denominator !== null) { · Denominator {{ metric.denominator }} }</p></div> }
            </button>
          } @empty { <section staffPageState class="notice performance-empty-notice">No performance metric is enabled for your organization.</section> }
        </section>

        <section class="panel"><div class="panel-title"><h2>Trends</h2><span>{{ data.trends.length }} days</span></div><div class="trend-list" role="table" aria-label="Daily performance trends">@for (trend of data.trends; track trend.date) { <div class="trend-row" role="row"><strong>{{ trend.date | date:'dd/MM/yyyy' }}</strong><span>{{ trend.completedServices }} services</span><span>{{ trend.utilizationPercent === null ? 'No utilization evidence' : trend.utilizationPercent + '% utilization' }}</span>@if (trend.serviceRevenuePaise !== null) { <span>{{ money(trend.serviceRevenuePaise) }} service</span> }@if (trend.productRevenuePaise !== null) { <span>{{ money(trend.productRevenuePaise) }} product</span> }</div> } @empty { <div class="performance-empty compact"><p>No trend evidence for this period.</p></div> }</div></section>

        <section class="grid two performance-insights">
          <article class="panel"><div class="panel-title"><h2>Personal goals</h2><span>{{ data.goals.length }}</span></div><div class="list">@for (goal of data.goals; track goal.id) { <div class="row"><div><strong>{{ label(goal.goalType) }}</strong><small>Due {{ goal.dueDate }} · {{ goal.status }}</small><div class="timer-track"><span [style.width.%]="goalProgress(goal)"></span></div></div><span>{{ goal.currentValue ?? 0 }}/{{ goal.targetValue }} {{ goal.metricUnit }}</span></div> } @empty { <div class="performance-empty compact"><p>No personal goal assigned.</p></div> }</div></article>
          <article class="panel"><div class="panel-title"><h2>Explainable coaching</h2><span>{{ data.coaching.length }}</span></div>@for (item of data.coaching; track item.title) { <p class="insight"><strong>{{ item.title }}</strong><br><small>{{ item.evidenceSource }} · Advisory only</small></p> } @empty { <div class="performance-empty compact"><p>No coaching action currently needs attention.</p></div> }</article>
        </section>

        <section class="grid two performance-insights">
          <article class="panel"><div class="panel-title"><h2>Skills</h2><span>{{ data.skills?.services?.length || 0 }}</span></div><p class="insight">{{ data.skills?.jobTitle || 'No job title' }}</p>@for (service of data.skills?.services || []; track service['serviceId']) { <p class="insight">{{ service['serviceName'] }} · {{ service['category'] }}</p> } @empty { <div class="performance-empty compact"><p>No assigned service skill.</p></div> }</article>
          <article class="panel"><div class="panel-title"><h2>Training recommendations</h2><span>{{ data.training.recommendations.length }}</span></div>@for (item of data.training.recommendations; track $index) { <p class="insight"><strong>{{ item['title'] || item['courseName'] || 'Training recommendation' }}</strong><br><small>{{ item['reason'] || item['status'] || 'Based on assigned skill requirements' }}</small></p> } @empty { <div class="performance-empty compact"><p>No training recommendation.</p></div> }</article>
        </section>

        <section class="panel safeguard-panel"><div class="panel-title"><h2>Workload safeguards</h2><span>Excluded from score</span></div><p>{{ data.safeguards.explanation }}</p>@if (data.safeguards.burnout; as risk) { <p class="insight"><strong>Workload signal: {{ risk.level }}</strong><br><small>{{ risk.evidence.join(' · ') }}</small></p> } @else { <div class="performance-empty compact"><p>No workload evidence yet.</p></div> }</section>

        <section class="panel"><div class="panel-title"><h2>Appraisals</h2><span>{{ appraisals().length }}</span></div>@if (appraisalError()) { <section staffPageState class="notice performance-error">{{ appraisalError() }}</section> }<div class="list">@for (review of appraisals(); track review.id) { <article class="row appraisal-row"><div><strong>{{ review.cycleName }}</strong><small>{{ review.periodStart }} – {{ review.periodEnd }} · {{ review.status.replaceAll('_', ' ') }}</small>@for (result of review.keyResults; track result.id) { <small>{{ result.title }} · {{ result.currentValue ?? 'pending' }}/{{ result.targetValue }} {{ result.metricUnit }}</small> }</div><div class="row-actions">@if (review.status === 'self_review_pending') { <button type="button" [disabled]="appraisalSaving()" (click)="submitSelfReview(review)">Submit self review</button> }@if (review.status === 'approved') { <button type="button" [disabled]="appraisalSaving()" (click)="acknowledgeAppraisal(review)">Acknowledge</button> }</div></article> } @empty { <div class="performance-empty compact"><p>No appraisal assigned.</p></div> }</div></section>

        <p class="freshness">Calculated {{ data.generatedAt | date:'dd/MM/yyyy HH:mm' }} · Source freshness {{ data.dataFreshnessAt ? (data.dataFreshnessAt | date:'dd/MM/yyyy HH:mm') : 'No source updates' }} · {{ label(data.range.basis) }}</p>
      }
    </section>
  `,
  styleUrls: ["./staff-app.styles.css"],
  styles: [`
    .performance-skeleton{display:grid;gap:12px}.performance-list-skeleton{min-height:280px}.performance-error{justify-content:space-between}.performance-controls{display:grid;gap:14px}.performance-periods,.performance-filter-row{display:flex;flex-wrap:wrap;align-items:end;gap:8px}.performance-periods button{min-height:38px;border:1px solid var(--staff-border);border-radius:12px;padding:8px 12px;color:var(--staff-text);background:var(--staff-surface);font-weight:700}.performance-periods button:hover,.performance-periods button:focus-visible,.performance-periods button.active{border-color:var(--staff-primary);color:var(--staff-primary-hover);background:var(--staff-primary-light)}.performance-filter-row label{min-width:min(210px,100%)}.metric-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:12px}.metric-card{min-width:0;border:1px solid var(--staff-border);border-radius:18px;padding:16px;background:var(--staff-surface);color:var(--staff-text);text-align:left;box-shadow:var(--staff-shadow)}.metric-card:hover,.metric-card:focus-visible,.metric-card.open{border-color:var(--staff-primary);background:var(--staff-primary-light)}.metric-card>span,.metric-card>small{display:block;color:var(--staff-text-secondary);font-weight:700}.metric-card>strong{display:block;margin:8px 0 5px;font-size:1.45rem}.metric-detail{margin-top:12px;padding-top:10px;border-top:1px solid var(--staff-border)}.metric-detail p{margin:5px 0;color:var(--staff-text-secondary);font-size:.78rem;font-weight:600;line-height:1.45}.trend-list{display:grid;max-height:360px;overflow:auto}.trend-row{display:grid;grid-template-columns:120px repeat(4,minmax(130px,1fr));gap:10px;padding:10px 0;border-bottom:1px solid var(--staff-border);font-size:.8rem}.trend-row span{color:var(--staff-text-secondary);font-weight:650}.score-panel{display:grid;grid-template-columns:minmax(0,1fr) minmax(260px,1.4fr);gap:18px}.score-panel>div>span,.score-panel>div>small{display:block;color:var(--staff-text-secondary);font-weight:650}.score-panel>div>strong{display:block;margin:8px 0;font-size:2rem}.score-panel summary{font-weight:750;cursor:pointer}.performance-empty-notice{grid-column:1/-1}.performance-empty{display:grid;justify-items:center;gap:5px;padding:22px 8px;color:var(--staff-text-secondary);font-weight:600;text-align:center}.performance-empty.compact{padding:14px 8px}.performance-empty p{margin:0}.safeguard-panel>p{color:var(--staff-text-secondary);font-weight:600;line-height:1.5}.freshness{margin:0;color:var(--staff-text-secondary);font-size:.76rem;font-weight:650;text-align:right}@media(max-width:700px){.performance-error{align-items:stretch;flex-direction:column}.performance-error button{width:100%}.performance-filter-row,.performance-filter-row label{width:100%}.score-panel,.performance-insights{grid-template-columns:1fr}.metric-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.trend-row{grid-template-columns:1fr 1fr}}@media(max-width:380px){.metric-grid{grid-template-columns:1fr}}
  `]
})
export class StaffPerformancePage implements OnInit {
  readonly dashboard = signal<StaffPerformanceDashboard | null>(null);
  readonly loading = signal(false);
  readonly loadError = signal("");
  readonly periodMode = signal<PeriodMode>("month");
  readonly fromDate = signal(businessDateOffset(-29));
  readonly toDate = signal(businessDate());
  readonly basis = signal<"sale_date" | "close_date">("sale_date");
  readonly selectedPayPeriod = signal("");
  readonly expandedMetric = signal("");
  readonly appraisals = signal<StaffAppraisal[]>([]);
  readonly appraisalError = signal("");
  readonly appraisalSaving = signal(false);
  readonly periodModes: Array<{ key: PeriodMode; label: string }> = [{ key: "day", label: "Day" }, { key: "week", label: "Week" }, { key: "month", label: "Month" }, { key: "pay_period", label: "Pay period" }, { key: "custom", label: "Custom" }];

  constructor(readonly staff: StaffAppService) {}
  ngOnInit() { if (this.canReadPerformance()) { void this.load(); void this.loadAppraisals(); } }

  async load() {
    if (!this.canReadPerformance()) return;
    this.loading.set(true); this.loadError.set("");
    try {
      const data = await this.staff.performance({ from: this.fromDate(), to: this.toDate(), basis: this.basis() });
      this.dashboard.set(data);
      if (!this.selectedPayPeriod() && data.payPeriods.length) this.selectedPayPeriod.set(data.payPeriods[0].id);
    } catch { this.loadError.set(this.staff.error() || "Unable to load performance."); }
    finally { this.loading.set(false); }
  }

  @HostListener("window:aura:performance-updated") onPerformanceUpdated() { if (this.canReadPerformance()) void this.load(); }
  @HostListener("document:visibilitychange") onVisibilityChange() { if (document.visibilityState === "visible" && this.canReadPerformance()) void this.load(); }

  setPeriod(mode: PeriodMode) {
    this.periodMode.set(mode);
    const to = businessDate();
    if (mode === "custom") return;
    if (mode === "pay_period") {
      const period = this.dashboard()?.payPeriods.find((row) => row.id === this.selectedPayPeriod()) || this.dashboard()?.payPeriods[0];
      if (!period) return;
      this.fromDate.set(period.from); this.toDate.set(period.to);
    } else {
      const days = mode === "day" ? 1 : mode === "week" ? 7 : 30;
      this.toDate.set(to); this.fromDate.set(businessDateOffset(1 - days, to));
    }
    void this.load();
  }
  setBasis(value: string) { this.basis.set(value === "close_date" ? "close_date" : "sale_date"); void this.load(); }
  selectPayPeriod(id: string) { this.selectedPayPeriod.set(id); this.setPeriod("pay_period"); }
  toggleMetric(key: string) { this.expandedMetric.set(this.expandedMetric() === key ? "" : key); }
  canReadPerformance(): boolean { return this.staff.hasPermission("staff.app.performance.read"); }
  label(value: string): string { return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase()); }
  metricValue(metric: StaffPerformanceMetric): string {
    if (metric.value === null || metric.value === undefined) return "No evidence";
    if (metric.unit === "paise") return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 }).format(metric.value / 100);
    if (metric.unit === "percent") return `${metric.value}%`;
    if (metric.unit === "rating") return `${Number(metric.value).toFixed(1)}/5`;
    return new Intl.NumberFormat("en-IN").format(metric.value);
  }
  money(value: number): string { return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 }).format(value / 100); }
  goalProgress(goal: StaffPerformanceDashboard["goals"][number]): number { return goal.targetValue > 0 ? Math.min(100, Math.max(0, (goal.currentValue || 0) * 100 / goal.targetValue)) : 0; }

  async loadAppraisals() { try { this.appraisalError.set(""); this.appraisals.set(await this.staff.appraisals()); } catch { this.appraisalError.set(this.staff.error() || "Unable to load appraisals."); } }
  async submitSelfReview(review: StaffAppraisal) {
    const keyResults: Array<{ id: string; currentValue: number; evidence?: string }> = [];
    for (const result of review.keyResults) { const value = window.prompt(`${result.title}: current ${result.metricUnit}`, String(result.currentValue ?? "")); if (value === null || !Number.isFinite(Number(value)) || Number(value) < 0) return; keyResults.push({ id: result.id, currentValue: Number(value), evidence: window.prompt(`${result.title}: evidence (optional)`, result.evidence || "")?.trim() || "" }); }
    this.appraisalSaving.set(true); try { await this.staff.submitSelfReview(review.id, keyResults, window.prompt("Self-review comments", review.selfComments || "")?.trim() || "", review.version); await this.loadAppraisals(); } catch { this.appraisalError.set(this.staff.error() || "Unable to submit self review."); } finally { this.appraisalSaving.set(false); }
  }
  async acknowledgeAppraisal(review: StaffAppraisal) { if (!window.confirm(`Acknowledge ${review.cycleName} final rating?`)) return; this.appraisalSaving.set(true); try { await this.staff.acknowledgeAppraisal(review.id, review.version); await this.loadAppraisals(); } catch { this.appraisalError.set(this.staff.error() || "Unable to acknowledge appraisal."); } finally { this.appraisalSaving.set(false); } }
}
