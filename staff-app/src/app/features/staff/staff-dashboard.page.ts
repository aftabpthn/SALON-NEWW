import { Component, HostListener, OnDestroy, OnInit, computed, signal } from "@angular/core";
import { Router } from "@angular/router";
import { isQueuedMutation, MutationResult, StaffAppService, StaffAttendance, StaffDashboard, StaffEnterpriseOs, StaffLeaveBalance, StaffOvertimeSummary, StaffToday, StaffWorkspacePreferences } from "../../core/staff-app.service";
import { DashboardAction, buildStaffDashboardViewModel, shouldShowDashboardRecommendation } from "./staff-dashboard.model";
import { StaffDashboardSectionsComponent } from "./staff-dashboard-sections.component";
import { StaffPageStateComponent } from "./staff-page-state.component";

type DashboardModule = "enterprise" | "today" | "overtime" | "leave" | "preferences";

@Component({
  standalone: true,
  imports: [StaffDashboardSectionsComponent, StaffPageStateComponent],
  template: `
    <section class="page dashboard-page" aria-busy="{{ initialLoading() }}">
      @if (blockingError()) {
        <section class="dashboard-blocking-state" role="alert">
          <span class="state-mark" aria-hidden="true">!</span>
          <p class="eyebrow">Staff workspace unavailable</p>
          <h1>We could not open your staff record.</h1>
          <p>{{ blockingError() }}</p>
          <div class="row-actions">
            <button type="button" class="link-button primary-action" [disabled]="refreshing()" (click)="load()">{{ refreshing() ? 'Retrying…' : 'Retry' }}</button>
            <button type="button" class="button" (click)="signOut()">Sign out</button>
          </div>
          <small>If retry does not work, ask your salon manager to confirm that this login is linked to an active staff profile.</small>
        </section>
      } @else {
        @if (!online()) { <section class="sync-banner offline" role="status"><b>Offline</b><span>Live data may be out of date. Supported changes will sync when you reconnect.</span></section> }
        @if (queuedActions() > 0) { <section class="sync-banner" role="status"><b>{{ queuedActions() }} pending</b><span>Staff action{{ queuedActions() === 1 ? '' : 's' }} waiting to sync.</span></section> }
        @if (refreshing() && data()) { <div staffPageState class="refresh-line" role="status" [loading]="true">Refreshing today’s data</div> }

        @if (showTip()) {
          <aside class="context-notice" aria-label="Recommended action"><span class="recommendation-mark" aria-hidden="true">✓</span><b>{{ recommendationText() }}</b><button type="button" (click)="dismissTip()" aria-label="Dismiss recommendation">×</button></aside>
        }

        @if (actionMessage()) { <section staffPageState class="notice" [class.success]="!actionFailed()" role="status">{{ actionMessage() }}</section> }
        @if (refreshWarning()) {
          <section class="optional-warning" role="status"><span aria-hidden="true">!</span><p>Couldn’t refresh everything.</p><button type="button" class="text-control" [disabled]="refreshing()" (click)="load()">{{ refreshing() ? 'Retrying…' : 'Retry' }}</button></section>
        }

        @if (initialLoading()) {
          <section class="dashboard-skeleton" aria-label="Loading dashboard">
            <div class="skeleton hero-skeleton"></div><div class="skeleton action-skeleton"></div><div class="skeleton-grid"><div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div></div><span class="sr-only">Loading your staff dashboard</span>
          </section>
        } @else if (viewModel(); as vm) {
          <aura-staff-dashboard-sections
            [viewModel]="vm"
            [pendingAction]="pendingMutation()"
            (actionSelected)="runAction($event)"
          />
        }
      }
    </section>
  `,
  styleUrls: ["./staff-app.styles.css"]
})
export class StaffDashboardPage implements OnInit, OnDestroy {
  readonly data = signal<StaffDashboard | null>(null);
  readonly os = signal<StaffEnterpriseOs | null>(null);
  readonly today = signal<StaffToday | null>(null);
  readonly overtime = signal<StaffOvertimeSummary | null>(null);
  readonly leaveBalances = signal<StaffLeaveBalance[]>([]);
  readonly preferences = signal<StaffWorkspacePreferences | null>(null);
  readonly initialLoading = signal(true);
  readonly refreshing = signal(false);
  readonly blockingError = signal("");
  readonly optionalErrors = signal<string[]>([]);
  readonly refreshWarning = signal(false);
  readonly actionMessage = signal("");
  readonly actionFailed = signal(false);
  readonly pendingMutation = signal("");
  readonly online = signal(typeof navigator === "undefined" ? true : navigator.onLine);
  readonly queuedActions = signal(0);
  readonly dismissedRecommendation = signal("");
  readonly viewModel = computed(() => {
    const dashboard = this.data();
    if (!dashboard) return null;
    return buildStaffDashboardViewModel({
      user: this.staff.user(), dashboard, enterprise: this.os(), today: this.today(), overtime: this.overtime(), leaveBalances: this.leaveBalances(),
      hasPermission: (permission) => this.staff.hasPermission(permission)
    });
  });
  readonly recommendationIdentity = computed(() => {
    const hero = this.viewModel()?.hero;
    const action = hero?.actions[0];
    return action ? [action.id, action.appointmentId || "", action.route || "", hero?.title || ""].join(":") : "";
  });
  readonly recommendationText = computed(() => this.viewModel()?.hero.title || "Review today’s priorities");
  readonly showTip = computed(() => {
    const identity = this.recommendationIdentity();
    const vm = this.viewModel();
    return !!vm && shouldShowDashboardRecommendation({
      identity,
      text: this.recommendationText(),
      hero: vm.hero,
      hintsEnabled: this.preferences()?.defaults.staffHints !== false,
      dismissedIdentity: this.dismissedRecommendation(),
      hasPartialWarning: this.refreshWarning()
    });
  });

  private loadGeneration = 0;
  private readonly attendanceUpdated = () => void this.load();

  constructor(readonly staff: StaffAppService, private readonly router: Router) {}

  ngOnInit() {
    this.dismissedRecommendation.set(this.readRecommendationDismissal());
    window.addEventListener("aura:attendance-updated", this.attendanceUpdated);
    this.queuedActions.set(this.staff.offlineQueueSize());
    void this.load();
  }

  ngOnDestroy() { window.removeEventListener("aura:attendance-updated", this.attendanceUpdated); }
  @HostListener("window:online") onOnline() { this.online.set(true); this.queuedActions.set(this.staff.offlineQueueSize()); void this.load(); }
  @HostListener("window:offline") onOffline() { this.online.set(false); }

  async load() {
    const generation = ++this.loadGeneration;
    const hasData = !!this.data();
    this.initialLoading.set(!hasData);
    this.refreshing.set(hasData);
    this.blockingError.set("");
    if (!hasData) this.optionalErrors.set([]);
    try {
      const dashboard = await this.staff.dashboard();
      if (generation !== this.loadGeneration) return;
      this.data.set(dashboard);
    } catch (error) {
      if (generation !== this.loadGeneration) return;
      const message = this.staff.error() || (error instanceof Error ? error.message : "Unable to load your staff workspace.");
      if (!hasData || this.isStaffRecordError(message) || this.isSessionError(message)) this.blockingError.set(this.friendlyBlockingError(message));
      else { this.optionalErrors.set(["Today’s core summary could not refresh; the last successful data remains visible."]); this.refreshWarning.set(true); }
      this.initialLoading.set(false);
      this.refreshing.set(false);
      return;
    } finally {
      if (generation === this.loadGeneration && !this.data()) { this.initialLoading.set(false); this.refreshing.set(false); }
    }

    const canReadStaff = this.staff.hasPermission("read:staff");
    const canUseAttendance = this.staff.hasAnyPermission(["allow:staff-checkin-checkout", "read:staff", "write:staff"]);
    const modules: Array<{ name: DashboardModule; request: Promise<unknown> }> = [
      { name: "enterprise", request: this.staff.enterpriseOs() },
      { name: "preferences", request: this.staff.workspacePreferences() }
    ];
    if (canUseAttendance) modules.push(
      { name: "today", request: this.staff.today() },
      { name: "overtime", request: this.staff.overtimeSummary() }
    );
    if (canReadStaff) modules.push({ name: "leave", request: this.staff.leaveBalances() });
    const results = await Promise.allSettled(modules.map((module) => module.request));
    if (generation !== this.loadGeneration) return;
    const errors: string[] = [];
    results.forEach((result, index) => {
      const name = modules[index].name;
      if (result.status === "rejected") { errors.push(this.moduleError(name)); return; }
      if (name === "enterprise") this.os.set(result.value as StaffEnterpriseOs);
      if (name === "today") this.today.set(result.value as StaffToday);
      if (name === "overtime") this.overtime.set(result.value as StaffOvertimeSummary);
      if (name === "leave") this.leaveBalances.set(result.value as StaffLeaveBalance[]);
      if (name === "preferences") this.preferences.set(result.value as StaffWorkspacePreferences);
    });
    this.optionalErrors.set(errors);
    this.refreshWarning.set(hasData && errors.length > 0);
    this.queuedActions.set(this.staff.offlineQueueSize());
    this.initialLoading.set(false);
    this.refreshing.set(false);
  }

  async runAction(action: DashboardAction) {
    if (this.pendingMutation()) return;
    if (action.route) { await this.router.navigate(Array.isArray(action.route) ? [...action.route] : [action.route]); return; }
    if (action.kind === "clock") { await this.clockAction(); return; }
    if (action.kind === "end-break") { await this.runMutation("end-break", () => this.staff.endBreak(), "Break ended."); return; }
  }

  dismissTip() {
    const identity = this.recommendationIdentity();
    if (!identity) return;
    this.dismissedRecommendation.set(identity);
    this.writeScopedValue("dashboardRecommendationDismissed", identity);
  }

  async signOut() { await this.staff.logout(); await this.router.navigateByUrl("/staff/login"); }

  private async clockAction() {
    if (!this.staff.hasAnyPermission(["allow:staff-checkin-checkout", "write:staff"])) return;
    const open = this.openAttendance();
    await this.runMutation("attendance", () => open ? this.staff.clockOut(open.id) : this.staff.clockIn(), open ? "Clocked out." : "Clocked in.");
  }

  private async runMutation(id: string, mutate: () => Promise<MutationResult<unknown>>, completedMessage: string) {
    if (this.pendingMutation()) return;
    this.pendingMutation.set(id); this.actionMessage.set(""); this.actionFailed.set(false);
    try {
      const result = await mutate();
      if (isQueuedMutation(result)) {
        this.actionMessage.set("Change saved offline and queued for sync."); this.queuedActions.set(this.staff.offlineQueueSize()); return;
      }
      this.actionMessage.set(completedMessage); await this.load();
    } catch {
      this.actionFailed.set(true); this.actionMessage.set(this.staff.error() || "Unable to save this change. Please try again.");
    } finally { this.pendingMutation.set(""); }
  }

  private openAttendance(): StaffAttendance | null {
    return this.today()?.attendance.find((item) => !item.clockOutAt && !/out|closed|complete/i.test(String(item.status || ""))) || null;
  }

  private isStaffRecordError(message: string): boolean { return /staff (record|profile)|not linked/i.test(message); }
  private isSessionError(message: string): boolean { return /jwt|expired|session|401|login required/i.test(message); }
  private friendlyBlockingError(message: string): string {
    if (this.isSessionError(message)) return "Your session has expired. Sign in again to continue.";
    if (this.isStaffRecordError(message)) return "This login is not currently linked to an available staff profile.";
    return "We could not load your staff workspace. Please retry, or contact your administrator if the issue continues.";
  }
  private moduleError(module: DashboardModule): string {
    const labels: Record<DashboardModule, string> = { enterprise: "Floor alerts are unavailable.", today: "Shift, attendance, and tasks are unavailable.", overtime: "Overtime totals are unavailable.", leave: "Leave balance is unavailable.", preferences: "Workspace preferences are unavailable." };
    return labels[module];
  }
  private scopedKey(suffix: string): string { const user = this.staff.user(); return `auraStaff:${user?.id || user?.staffId || "unknown"}:${user?.branchId || "workspace"}:${suffix}`; }
  private readRecommendationDismissal(): string { try { return localStorage.getItem(this.scopedKey("dashboardRecommendationDismissed")) || ""; } catch { return ""; } }
  private writeScopedValue(suffix: string, value: string) { try { localStorage.setItem(this.scopedKey(suffix), value); } catch { /* Preferences remain usable when storage is unavailable. */ } }
}
