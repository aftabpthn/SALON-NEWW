import { Component, HostListener, OnInit, signal } from "@angular/core";
import { StaffAppService, StaffEnterpriseOs } from "../../core/staff-app.service";
import { businessDate, businessDateOffset } from "../../core/business-date";
import { PaiseInrPipe } from "../../core/paise-inr.pipe";
import { StaffPageStateComponent } from "./staff-page-state.component";

@Component({
  standalone: true,
  imports: [PaiseInrPipe, StaffPageStateComponent],
  template: `
    <section class="page">
      <header class="page-head"><div><p class="eyebrow">Leaderboard</p><h1>Leaderboard</h1><p>Branch-scoped performance ranking and gamification.</p></div></header>
      @if (!canReadLeaderboard()) { <section staffPageState class="notice">You do not have permission to view leaderboard data.</section> }
      @if (loading() && !os()) {
        <section class="leaderboard-skeleton" aria-label="Loading leaderboard">
          <div class="skeleton-grid"><span class="skeleton"></span><span class="skeleton"></span><span class="skeleton"></span><span class="skeleton"></span></div>
          <span class="skeleton leaderboard-list-skeleton"></span>
        </section>
      }
      @if (loadError()) { <section staffPageState class="notice leaderboard-error"><span>{{ loadError() }}</span><button class="link-button" type="button" [disabled]="loading()" (click)="load()">Retry</button></section> }

      @if (canReadLeaderboard()) {
        <nav class="leaderboard-periods" aria-label="Leaderboard period">
          @for (days of [7, 30, 60]; track days) {
            <button type="button" [class.active]="periodDays() === days" [attr.aria-pressed]="periodDays() === days" [disabled]="loading()" (click)="setPeriod(days)">Last {{ days }} days</button>
          }
        </nav>
      }

      @if (canReadLeaderboard() && os(); as data) {
        <section class="grid four leaderboard-kpis">
          <article class="kpi"><span>Points</span><strong>{{ data.gamification.points }}</strong><small>{{ refreshing() ? 'Refreshing...' : 'CRM activity points' }}</small></article>
          <article class="kpi"><span>Level</span><strong>{{ data.gamification.level }}</strong><small>500 points per level</small></article>
          <article class="kpi"><span>Stars</span><strong>{{ data.gamification.stars }}/5</strong><small>Performance score</small></article>
          <article class="kpi"><span>Active days</span><strong>{{ data.gamification.activeDays ?? 0 }}</strong><small>Attendance records</small></article>
        </section>
        <section class="panel">
          <div class="panel-title"><h2>CRM scoring sources</h2><span>System rules</span></div>
          <p class="scoring-basis"><strong>Rank:</strong> completion 25% · attendance 25% · utilization 20% · repeat clients 15% · revenue target 15%. <strong>Points:</strong> completed service 100 · present day 20 · repeat client 50 · completed operation task 25.</p>
        </section>
        @if (sourceGaps(data).length) {
          <section class="panel"><div class="panel-title"><h2>CRM data readiness</h2><span>{{ sourceGaps(data).length }} pending</span></div><div class="list">@for (gap of sourceGaps(data); track gap) { <div class="row"><strong>{{ gap }}</strong><span class="badge">Pending in CRM</span></div> }</div></section>
        }
        <section class="grid two leaderboard-content">
          <article class="panel">
            <div class="panel-title"><h2>Rankings</h2><span>{{ data.leaderboard.length }}</span></div>
            <div class="list">
              @for (row of data.leaderboard; track row.staffId) {
                <details class="row leaderboard-row" [class.me]="row.isMe">
                  <summary>
                  <div class="rank">#{{ row.rank }}</div>
                  <div class="row-main"><strong>{{ row.staffName }}</strong><small>{{ row.points }} points · {{ row.days }} tracked days @if (row.isMe) { · You }</small></div>
                  <div class="row-actions">
                    <span class="badge" [class.green]="row.isMe">{{ row.score }}/100</span>
                    @if (row.rating !== null && row.rating !== undefined) { <span class="badge">{{ row.rating }}/5</span> }
                    @if (canSeeRevenue() && row.revenue !== null && row.revenue !== undefined) { <span class="badge">{{ row.revenue | paiseInr }}</span> }
                  </div>
                  </summary>
                  <div class="score-detail"><p>{{ row.scoreExplanation }}</p>@for (part of row.scoreComponents; track part.key) { <div><strong>{{ label(part.key) }}</strong><small>{{ part.value === null ? 'No evidence' : part.value + '%' }} · Weight {{ part.weightPercent }}% · {{ part.source }}</small></div> }</div>
                </details>
              } @empty { <div class="leaderboard-empty"><p>No scored staff records yet.</p><small>Appointments, attendance, roster, sales, targets, or operations are required.</small></div> }
            </div>
          </article>
          <article class="panel">
            <div class="panel-title"><h2>Badges</h2><span>{{ earnedBadges(data) }}/{{ data.gamification.badges.length }}</span></div>
            <div class="list">
              @for (badge of data.gamification.badges; track badge.label) {
                <div class="row badge-row" [class.earned]="badge.earned"><div class="row-main"><strong>{{ badge.label }}</strong><small>{{ badge.description }}</small></div><span class="badge" [class.green]="badge.earned">{{ badge.earned ? 'Earned' : 'Locked' }}</span></div>
              } @empty { <div class="leaderboard-empty"><p>No badge rules available.</p></div> }
            </div>
          </article>
        </section>
      }
    </section>
  `,
  styleUrls: ["./staff-app.styles.css"],
  styles: [`
    .leaderboard-skeleton { display: grid; gap: 12px; }
    .leaderboard-list-skeleton { min-height: 280px; }
    .leaderboard-error { justify-content: space-between; }
    .leaderboard-periods { display: flex; flex-wrap: wrap; gap: 8px; }
    .leaderboard-periods button { min-height: 38px; border: 1px solid var(--staff-border); border-radius: 12px; padding: 8px 12px; color: var(--staff-text); background: var(--staff-surface); font-weight: 700; }
    .leaderboard-periods button:hover, .leaderboard-periods button:focus-visible, .leaderboard-periods button.active { border-color: var(--staff-primary); color: var(--staff-primary-hover); background: var(--staff-primary-light); }
    .leaderboard-row { display: block; }
    .leaderboard-row summary { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; align-items: center; gap: 16px; list-style: none; cursor: pointer; }
    .leaderboard-row summary::-webkit-details-marker { display: none; }
    .score-detail { display: grid; gap: 8px; grid-column: 1 / -1; margin-top: 12px; padding: 12px; border-radius: 14px; background: var(--staff-surface-secondary); }
    .score-detail p, .score-detail small { display: block; margin: 0; color: var(--staff-text-secondary); font-weight: 600; line-height: 1.45; }
    .scoring-basis { margin: 0; color: var(--staff-text-secondary); font-weight: 600; line-height: 1.6; }
    .leaderboard-row.me, .badge-row.earned { background: var(--staff-primary-light); }
    .rank { display: grid; width: 38px; height: 38px; place-items: center; border-radius: 12px; color: var(--staff-primary-hover); background: var(--staff-primary-light); font-weight: 800; }
    .leaderboard-empty { display: grid; justify-items: center; gap: 5px; padding: 28px 10px; color: var(--staff-text-secondary); text-align: center; }
    .leaderboard-empty p { margin: 0; font-weight: 700; }
    .leaderboard-empty small { font-weight: 600; line-height: 1.4; }
    @media (max-width: 700px) {
      .leaderboard-error, .leaderboard-row summary { align-items: stretch; grid-template-columns: auto minmax(0, 1fr); }
      .leaderboard-error { flex-direction: column; }
      .leaderboard-error button { width: 100%; }
      .leaderboard-row .row-actions { grid-column: 1 / -1; justify-content: flex-start; }
      .leaderboard-content { grid-template-columns: 1fr; }
    }
  `]
})
export class StaffLeaderboardPage implements OnInit {
  readonly os = signal<StaffEnterpriseOs | null>(null);
  readonly loading = signal(false);
  readonly refreshing = signal(false);
  readonly loadError = signal("");
  readonly periodDays = signal(30);

  constructor(readonly staff: StaffAppService) {}

  ngOnInit() { if (this.canReadLeaderboard()) void this.load(); }

  async load(silent = false) {
    if (!this.canReadLeaderboard()) {
      this.os.set(null);
      return;
    }
    if (silent) this.refreshing.set(true); else this.loading.set(true);
    this.loadError.set("");
    try {
      const to = businessDate();
      this.os.set(await this.staff.enterpriseOs({ from: businessDateOffset(1 - this.periodDays(), to), to }));
    } catch {
      this.loadError.set(this.staff.error() || "Unable to load leaderboard.");
    } finally {
      this.loading.set(false);
      this.refreshing.set(false);
    }
  }

  @HostListener("document:visibilitychange")
  onVisibilityChange() {
    if (document.visibilityState === "visible" && this.canReadLeaderboard()) void this.load(true);
  }

  setPeriod(days: number) {
    if (days === this.periodDays()) return;
    this.periodDays.set(days);
    void this.load();
  }

  canReadLeaderboard(): boolean { return this.staff.hasPermission("staff.app.leaderboard.read"); }
  canSeeRevenue(): boolean { return this.staff.hasAnyPermission(["staff.app.business.service_amount.read", "read:finance", "read:sales", "read:payments", "read:invoices"]); }
  earnedBadges(data: StaffEnterpriseOs): number { return data.gamification.badges.filter((badge) => badge.earned).length; }
  label(value: string): string { return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase()); }
  sourceGaps(data: StaffEnterpriseOs): string[] {
    const status = data.gamification.sourceStatus;
    if (!status) return [];
    return [
      !status.appointments && "Completed appointments — Appointments / POS",
      (!status.attendance || !status.schedule) && "Published schedule and attendance — Availability / Attendance",
      !status.clients && "Client service history — Clients / Appointments",
      !status.revenueTarget && "Revenue target — Staff profile",
      !status.sharedReview && "Shared performance review — Staff Control Center"
    ].filter((value): value is string => !!value);
  }
}
