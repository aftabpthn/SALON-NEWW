import { DatePipe } from "@angular/common";
import { Component, computed, HostListener, OnInit, signal } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { RouterLink } from "@angular/router";
import { StaffAppService, StaffAppointment, StaffBusiness, StaffDashboard, StaffRecommendation } from "../../core/staff-app.service";
import { businessDate, businessDateOffset, parseDisplayBusinessDate } from "../../core/business-date";
import { PaiseInrPipe } from "../../core/paise-inr.pipe";
import { StaffDatePickerComponent } from "../../shared/staff-date-picker.component";
import { StaffPageStateComponent } from "./staff-page-state.component";

type AppointmentView = "today" | "upcoming" | "live" | "completed" | "cancelled" | "shifted" | "all";

const LIVE_STATUSES = new Set(["booked", "confirmed", "checked-in", "arrived", "in-service", "started"]);
const TERMINAL_STATUSES = new Set(["completed", "checked-out", "cancelled", "no-show"]);
const COMPLETED_STATUSES = new Set(["completed", "checked-out"]);
const CANCELLED_STATUSES = new Set(["cancelled", "no-show"]);
const IST_DATE_FORMATTER = new Intl.DateTimeFormat("en", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" });
const IST_DATE_TIME_FORMATTER = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

function istDateKey(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const parts = Object.fromEntries(IST_DATE_FORMATTER.formatToParts(date).map((part) => [part.type, part.value]));
  return [parts["year"], parts["month"], parts["day"]].join("-");
}

function istDateTimeInput(value: string): { date: string; time: string } {
  const parts = Object.fromEntries(IST_DATE_TIME_FORMATTER.formatToParts(new Date(value)).map((part) => [part.type, part.value]));
  return { date: [parts["year"], parts["month"], parts["day"]].join("-"), time: `${parts["hour"]}:${parts["minute"]}` };
}

@Component({
  standalone: true,
  imports: [PaiseInrPipe, DatePipe, FormsModule, RouterLink, StaffDatePickerComponent, StaffPageStateComponent],
  template: `
    <section class="page">
      <header class="page-head"><div><p class="eyebrow">Appointments</p><h1>Appointments</h1><p>Assigned bookings with service actions.</p></div></header>
      @if (loading() && !dashboard()) {
        <section class="appointment-skeleton" aria-label="Loading appointments">
          <div class="skeleton-grid">
            <span class="skeleton"></span><span class="skeleton"></span><span class="skeleton"></span><span class="skeleton"></span>
          </div>
          <span class="skeleton appointment-list-skeleton"></span>
        </section>
      }
      @if (loadError()) {
        <section staffPageState class="notice appointment-error">
          <span>{{ loadError() }}</span>
          <button class="link-button" type="button" [disabled]="loading()" (click)="load()">Retry</button>
        </section>
      }
      @if (actionMessage()) { <section staffPageState class="notice success" role="status">{{ actionMessage() }}</section> }

      @if (dashboard()) {
        <section class="grid four">
          <button class="kpi kpi-button" [class.active-toggle]="activeView() === 'today'" type="button" [attr.aria-pressed]="activeView() === 'today'" (click)="setView('today')"><span>Today</span><strong>{{ kpiCounts().today }}</strong></button>
          <button class="kpi kpi-button" [class.active-toggle]="activeView() === 'live'" type="button" [attr.aria-pressed]="activeView() === 'live'" (click)="setView('live')"><span>Live</span><strong>{{ kpiCounts().live }}</strong></button>
          <button class="kpi kpi-button" [class.active-toggle]="activeView() === 'completed'" type="button" [attr.aria-pressed]="activeView() === 'completed'" (click)="setView('completed')"><span>Completed</span><strong>{{ kpiCounts().completed }}</strong></button>
          <button class="kpi kpi-button" [class.active-toggle]="activeView() === 'cancelled'" type="button" [attr.aria-pressed]="activeView() === 'cancelled'" (click)="setView('cancelled')"><span>Cancelled</span><strong>{{ kpiCounts().cancelled }}</strong></button>
        </section>

        <nav class="queue-tabs" aria-label="Appointment queues">
          <button class="link-button" [class.active-toggle]="activeView() === 'today'" type="button" [attr.aria-pressed]="activeView() === 'today'" (click)="setView('today')">Today's Queue</button>
          <button class="link-button" [class.active-toggle]="activeView() === 'upcoming'" type="button" [attr.aria-pressed]="activeView() === 'upcoming'" (click)="setView('upcoming')">Upcoming</button>
          <button class="link-button" [class.active-toggle]="activeView() === 'completed'" type="button" [attr.aria-pressed]="activeView() === 'completed'" (click)="setView('completed')">Completed</button>
          <button class="link-button" [class.active-toggle]="activeView() === 'shifted'" type="button" [attr.aria-pressed]="activeView() === 'shifted'" (click)="setView('shifted')">Shifted</button>
          <button class="link-button" [class.active-toggle]="activeView() === 'all'" type="button" [attr.aria-pressed]="activeView() === 'all'" (click)="setView('all')">All History</button>
        </nav>

        @if (activeView() === 'all') {
          <section class="panel history-filters">
            <div class="panel-title"><h2>History filters</h2><span>{{ history()?.pagination?.appointmentTotal || 0 }} records</span></div>
            <div class="form-grid compact-grid">
              <label>From<aura-staff-date-picker [value]="historyFrom()" ariaLabel="History from date" (valueChange)="historyFrom.set($event)" /></label>
              <label>To<aura-staff-date-picker [value]="historyTo()" ariaLabel="History to date" (valueChange)="historyTo.set($event)" /></label>
              <label>Client<input type="search" maxlength="100" [ngModel]="historyClient()" (ngModelChange)="historyClient.set($event)" placeholder="Client name" /></label>
              <label>Status<select [ngModel]="historyStatus()" (ngModelChange)="historyStatus.set($event)"><option value="all">All statuses</option><option value="booked">Booked</option><option value="confirmed">Confirmed</option><option value="in-service">In service</option><option value="completed">Completed</option><option value="cancelled">Cancelled</option><option value="no-show">No-show</option></select></label>
              <label>Service<select [ngModel]="historyServiceId()" (ngModelChange)="historyServiceId.set($event)"><option value="">All services</option>@for (service of history()?.services || []; track service.id) { <option [value]="service.id">{{ service.name }}</option> }</select></label>
              <label>Department<select [ngModel]="historyDepartment()" (ngModelChange)="historyDepartment.set($event)"><option value="">All departments</option>@for (department of historyDepartments(); track department) { <option [value]="department">{{ department }}</option> }</select></label>
            </div>
            <div class="row-actions permission-actions"><button class="button primary" type="button" [disabled]="historyLoading()" (click)="loadHistory(true)">Apply</button><button class="button" type="button" [disabled]="historyLoading()" (click)="clearHistoryFilters()">Clear</button></div>
            @if (historyError()) { <p class="action-error">{{ historyError() }}</p> }
          </section>
        }

        <section class="panel" aria-live="polite">
          <div class="panel-title">
            <h2>{{ viewTitle() }}</h2>
            <div class="row-actions">
              <span>{{ activeView() === 'all' ? (history()?.pagination?.appointmentTotal || 0) : visibleAppointments().length }}</span>
              @if (loading() || historyLoading()) { <span class="refresh-line">Refreshing...</span> }
              @if (activeView() === 'live') { <a class="button" routerLink="/staff/queue">Open live timers</a> }
            </div>
          </div>
          <div class="list">
            @for (item of visibleAppointments(); track item.id) {
              <details class="appointment-list-item">
                <summary>
                  <div class="appointment-list-copy">
                  <strong>{{ item.clientName || 'Assigned appointment' }} @if (item.preferredClient) { <span class="preferred-client">Preferred</span> }</strong>
                    <span>{{ item.serviceNames.join(', ') || 'Service not mapped' }}</span>
                  @if (isValidDate(item.startAt) && isValidDate(item.endAt)) {
                  <small>{{ item.startAt | date:'mediumDate' }} · {{ item.startAt | date:'shortTime' }} - {{ item.endAt | date:'shortTime' }} · {{ item.durationMinutes || 0 }} min</small>
                  } @else {
                    <small>Date unavailable - {{ item.durationMinutes || 0 }} min</small>
                  }
                  </div>
                  <div class="appointment-list-meta"><span class="badge">{{ item.status }}</span>@if (item.rescheduleCount) { <span class="pill">Shifted {{ item.rescheduleCount }}</span> }<span class="expand-indicator" aria-hidden="true"></span></div>
                </summary>
                <div class="appointment-list-expanded">
                  <div class="row-actions">
                  @if (canSeeRevenue()) { <span class="badge">{{ item.value | paiseInr }}</span> }
                  <button class="link-button" type="button" (click)="openAppointment(item)">Details</button>
                  </div>
                </div>
              </details>
            } @empty {
              <div class="appointment-empty">
                <p>{{ emptyMessage() }}</p>
                @if (activeView() !== 'upcoming') { <button class="link-button" type="button" (click)="setView('upcoming')">Check upcoming</button> }
              </div>
            }
          </div>
          @if (activeView() === 'all' && history()?.pagination?.appointmentHasMore) { <div class="row-actions permission-actions"><button class="button" type="button" [disabled]="historyLoading()" (click)="loadHistory(false)">{{ historyLoading() ? 'Loading...' : 'Load More' }}</button></div> }
        </section>
      }

      @if (selectedAppointment(); as item) {
        <button class="detail-backdrop" type="button" (click)="closeDrawers()" aria-label="Close details"></button>
        <aside class="detail-drawer" role="dialog" aria-modal="true" aria-labelledby="appointment-detail-title" tabindex="-1">
          <div class="panel-title"><h2 id="appointment-detail-title">Appointment detail</h2><button class="link-button" type="button" (click)="closeDrawers()">Close</button></div>
          <section class="grid two compact-grid"><article class="kpi"><span>Work item</span><strong>Assigned appointment</strong></article><article class="kpi"><span>Status</span><strong>{{ item.status }}</strong></article></section>
          <div class="list"><div class="row"><strong>Client</strong><span>{{ item.clientName || '-' }}@if (item.preferredClient) { · Preferred client }</span></div><div class="row"><strong>Time</strong><span>{{ item.startAt | date:'short' }} - {{ item.endAt | date:'shortTime' }}</span></div><div class="row"><strong>Services</strong><span>{{ item.serviceNames.join(', ') || '-' }}@if (item.serviceDepartments.length) { · {{ item.serviceDepartments.join(', ') }}}</span></div><div class="row"><strong>Duration</strong><span>{{ item.durationMinutes || 0 }} min</span></div><div class="row"><strong>Chair</strong><span>{{ item.chair || '-' }}</span></div><div class="row"><strong>Shift history</strong><span>{{ item.rescheduleCount || 0 }} times</span></div><div class="row"><strong>Last service</strong><span>{{ item.lastServiceNames.join(', ') || '-' }}@if (item.lastServiceDepartments.length) { · {{ item.lastServiceDepartments.join(', ') }}}@if (item.lastServiceAt) { · {{ item.lastServiceAt | date:'dd/MM/yyyy' }}}</span></div></div>
          <section class="suitable-staff" aria-live="polite">
            <h3>Suitable staff</h3>
            @if (recommendationLoading()) { <small>Checking live availability...</small> }
            @else if (recommendationError()) { <small class="action-error">{{ recommendationError() }}</small> }
            @else {
              @for (recommendation of recommendations().slice(0, 3); track recommendation.staffId; let rank = $index) {
                <article [class.current-staff]="recommendation.staffId === item.staffId">
                  <strong>{{ rank + 1 }}. {{ recommendation.staffName }}@if (recommendation.staffId === item.staffId) { · Assigned }</strong>
                  <span>{{ recommendation.recommendationReason }}</span>
                  @if (recommendationMeta(recommendation)) { <small>{{ recommendationMeta(recommendation) }}</small> }
                </article>
              } @empty { <small>No suitable staff available for this slot.</small> }
            }
          </section>
          @if (item.rescheduleTimeline.length) { <section class="shift-timeline"><h3>Shift / reschedule timeline</h3>@for (event of item.rescheduleTimeline; track event.changedAt + event.action) { <div><strong>{{ event.changedAt | date:'dd/MM/yyyy' }} · {{ event.changedAt | date:'shortTime' }}</strong><span>{{ event.fromStartAt | date:'short' }} → {{ event.toStartAt | date:'short' }}</span>@if (event.reason) { <small>{{ event.reason }}</small> }</div> }</section> }
          @if (canManageAppointment(item) && !actionMode()) {
            <div class="drawer-actions"><button class="button" type="button" (click)="beginReschedule(item)">Reschedule</button><button class="link-button danger" type="button" (click)="beginCancel()">Cancel appointment</button></div>
          }
          @if (actionMode()) {
            <section class="action-form">
              <div class="panel-title"><h2>{{ actionMode() === 'reschedule' ? 'Reschedule appointment' : 'Cancel appointment' }}</h2></div>
              @if (actionMode() === 'reschedule') {
                <div class="action-fields"><label>Date<input type="date" [value]="actionDate()" (input)="actionDate.set($any($event.target).value)" /></label><label>Time<input type="time" [value]="actionTime()" (input)="actionTime.set($any($event.target).value)" /></label></div>
              }
              <label>Reason<textarea rows="3" maxlength="500" [value]="actionReason()" (input)="actionReason.set($any($event.target).value)"></textarea></label>
              @if (actionError()) { <p class="action-error">{{ actionError() }}</p> }
              <div class="drawer-actions"><button class="link-button" type="button" [disabled]="savingAction()" (click)="actionMode.set(null)">Back</button><button class="button" type="button" [disabled]="savingAction()" [attr.aria-busy]="savingAction()" (click)="submitAction(item)">{{ savingAction() ? 'Saving...' : 'Confirm' }}</button></div>
            </section>
          }
        </aside>
      }
    </section>
  `,
  styleUrls: ["./staff-app.styles.css"],
  styles: [`
    .appointment-list-item { border-top: 1px solid var(--staff-border); }
    .appointment-list-item:first-child { border-top: 0; }
    .appointment-list-item > summary { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 10px; min-height: 62px; padding: 8px 0; list-style: none; cursor: pointer; }
    .appointment-list-item > summary::-webkit-details-marker { display: none; }
    .appointment-list-copy { min-width: 0; display: grid; gap: 2px; }
    .appointment-list-copy strong, .appointment-list-copy span, .appointment-list-copy small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .appointment-list-copy strong { color: var(--staff-text); font-size: .86rem; }
    .preferred-client { color: #067647; font-size: .68rem; }
    .appointment-list-copy span { color: var(--staff-text-secondary); font-size: .75rem; font-weight: 650; }
    .appointment-list-copy small { color: var(--staff-text-secondary); font-size: .68rem; font-weight: 600; }
    .appointment-list-meta { display: flex; align-items: center; gap: 6px; }
    .appointment-list-meta .badge { max-width: 78px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .appointment-list-item[open] .expand-indicator::after { transform: none; }
    .appointment-list-expanded { padding: 8px 0 12px; border-top: 1px solid var(--staff-border); }
    .appointment-list-expanded .row-actions { justify-content: flex-start; }
    .drawer-actions { display: flex; gap: 8px; margin-top: 14px; }
    .drawer-actions > * { flex: 1; }
    .danger { color: #b42318; }
    .action-form { display: grid; gap: 12px; margin-top: 14px; padding-top: 14px; border-top: 1px solid var(--staff-border); }
    .action-form label { display: grid; gap: 5px; color: var(--staff-text-secondary); font-size: .72rem; font-weight: 700; }
    .action-fields { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
    .action-form input, .action-form textarea { width: 100%; box-sizing: border-box; border: 1px solid var(--staff-border); border-radius: 7px; background: #fff; color: var(--staff-text); font: inherit; padding: 9px 10px; }
    .action-form textarea { resize: vertical; }
    .action-error { margin: 0; color: #b42318; font-size: .75rem; font-weight: 700; }
    .appointment-skeleton { display: grid; gap: 12px; }
    .appointment-list-skeleton { min-height: 240px; }
    .appointment-error { justify-content: space-between; }
    .history-filters { display: grid; gap: 12px; }
    .shift-timeline { display: grid; gap: 8px; margin-top: 14px; padding-top: 14px; border-top: 1px solid var(--staff-border); }
    .shift-timeline h3 { margin: 0; font-size: .85rem; }
    .shift-timeline div { display: grid; gap: 2px; padding-left: 10px; border-left: 2px solid var(--staff-primary); font-size: .74rem; }
    .shift-timeline span, .shift-timeline small { color: var(--staff-text-secondary); }
    .suitable-staff { display: grid; gap: 8px; margin-top: 14px; padding-top: 14px; border-top: 1px solid var(--staff-border); }
    .suitable-staff h3 { margin: 0; font-size: .85rem; }
    .suitable-staff article { display: grid; gap: 3px; padding: 9px; border: 1px solid var(--staff-border); border-radius: 8px; background: #fff; }
    .suitable-staff article.current-staff { border-color: var(--staff-primary); background: var(--staff-primary-light); }
    .suitable-staff article strong { font-size: .76rem; }
    .suitable-staff article span, .suitable-staff article small, .suitable-staff > small { color: var(--staff-text-secondary); font-size: .7rem; line-height: 1.4; }
    .appointment-empty { display: grid; justify-items: center; gap: 10px; padding: 24px 0; color: var(--staff-text-secondary); font-weight: 600; text-align: center; }
    .appointment-empty p { margin: 0; }
    @media (max-width: 900px) {
      .detail-drawer { top: var(--staff-header-height); padding-bottom: calc(20px + env(safe-area-inset-bottom)); }
    }
    @media (max-width: 700px) {
      .appointment-list-item > summary { grid-template-columns: minmax(0, 1fr); }
      .appointment-list-meta, .appointment-list-expanded .row-actions, .drawer-actions, .appointment-error { align-items: stretch; flex-direction: column; }
      .appointment-list-meta { justify-self: stretch; }
      .appointment-list-meta .badge { max-width: none; width: fit-content; }
      .drawer-actions > *, .appointment-error button { width: 100%; }
      .action-fields { grid-template-columns: 1fr; }
    }
  `]
})
export class StaffAppointmentsPage implements OnInit {
  readonly dashboard = signal<StaffDashboard | null>(null);
  readonly activeView = signal<AppointmentView>("today");
  readonly kpiCounts = computed(() => {
    const rows = this.dashboard()?.appointments || [];
    const today = businessDate();
    return {
      today: rows.filter((item) => istDateKey(item.startAt) === today).length,
      live: rows.filter((item) => istDateKey(item.startAt) === today && LIVE_STATUSES.has(this.statusOf(item))).length,
      completed: rows.filter((item) => this.isCompleted(item, today)).length,
      cancelled: rows.filter((item) => CANCELLED_STATUSES.has(this.statusOf(item))).length
    };
  });
  readonly visibleAppointments = computed(() => {
    const today = businessDate();
    const view = this.activeView();
    if (view === "all") return this.history()?.appointments || [];
    const rows = (this.dashboard()?.appointments || []).filter((item) => {
      const date = istDateKey(item.startAt);
      const status = this.statusOf(item);
      switch (view) {
        case "today": return date === today;
        case "upcoming": return date > today && !TERMINAL_STATUSES.has(status);
        case "live": return date === today && LIVE_STATUSES.has(status);
        case "completed": return this.isCompleted(item, today);
        case "cancelled": return CANCELLED_STATUSES.has(status);
        case "shifted": return item.rescheduleCount > 0;
      }
    });
    const ascending = view === "today" || view === "live" || view === "upcoming";
    return rows.sort((left, right) => this.compareStartTimes(left, right, ascending));
  });
  readonly loading = signal(false);
  readonly history = signal<StaffBusiness | null>(null);
  readonly historyLoading = signal(false);
  readonly historyError = signal("");
  readonly historyFrom = signal("");
  readonly historyTo = signal("");
  readonly historyClient = signal("");
  readonly historyStatus = signal("all");
  readonly historyServiceId = signal("");
  readonly historyDepartment = signal("");
  readonly historyDepartments = computed(() => [...new Set((this.history()?.services || []).map((service) => service.category).filter(Boolean))].sort());
  readonly selectedAppointment = signal<StaffAppointment | null>(null);
  readonly actionMode = signal<"reschedule" | "cancel" | null>(null);
  readonly actionDate = signal("");
  readonly actionTime = signal("");
  readonly actionReason = signal("");
  readonly actionError = signal("");
  readonly actionMessage = signal("");
  readonly recommendations = signal<StaffRecommendation[]>([]);
  readonly recommendationLoading = signal(false);
  readonly recommendationError = signal("");
  readonly loadError = signal("");
  readonly savingAction = signal(false);
  private loadGeneration = 0;

  constructor(readonly staff: StaffAppService) {}

  ngOnInit() { void this.load(); }

  @HostListener("window:aura:appointments-updated")
  onAppointmentsUpdated() { void this.load(); }

  setView(view: AppointmentView) { this.activeView.set(view); this.actionMessage.set(""); if (view === "all" && !this.history()) void this.loadHistory(true); }

  viewTitle(): string {
    return ({ today: "Today's Queue", upcoming: "Upcoming appointments", live: "Live appointments", completed: "Completed appointments", cancelled: "Cancelled appointments", shifted: "Shifted appointments", all: "Complete appointment history" } as const)[this.activeView()];
  }

  emptyMessage(): string {
    return ({ today: "No appointments in today's queue.", upcoming: "No upcoming appointments assigned to you.", live: "No live appointments right now.", completed: "No completed appointments in the loaded range.", cancelled: "No cancelled appointments in the loaded range.", shifted: "No shifted appointments in the loaded range.", all: "No appointment history matches these filters." } as const)[this.activeView()];
  }

  isValidDate(value: string): boolean { return !Number.isNaN(new Date(value).getTime()); }

  async load() {
    const generation = ++this.loadGeneration;
    this.loading.set(true);
    this.loadError.set("");
    try {
      const today = businessDate();
      const [dashboard, os] = await Promise.all([
        this.staff.dashboard({ date: today }),
        this.staff.enterpriseOs({ from: businessDateOffset(-30, today), to: businessDateOffset(32, today) })
      ]);
      const current = new Map(dashboard.appointments.map((item) => [item.id, item]));
      const appointments = os.timeline.map((item) => ({
        ...(current.get(item.id) || {}), id: item.id, staffId: current.get(item.id)?.staffId || this.staff.user()?.staffId || "",
        branchId: current.get(item.id)?.branchId || this.staff.user()?.branchId || "", serviceIds: current.get(item.id)?.serviceIds || [],
        serviceNames: item.serviceNames || [], durationMinutes: item.durationMinutes || 0, value: current.get(item.id)?.value || 0,
        startAt: item.startAt, endAt: item.endAt, status: item.status, chair: item.chair || current.get(item.id)?.chair || "", source: current.get(item.id)?.source || "",
        clientName: item.clientName || current.get(item.id)?.clientName || "", preferredClient: item.preferredClient || current.get(item.id)?.preferredClient || false,
        rescheduleCount: item.rescheduleCount || current.get(item.id)?.rescheduleCount || 0,
        rescheduleTimeline: item.rescheduleTimeline || current.get(item.id)?.rescheduleTimeline || [], serviceDepartments: item.serviceDepartments || current.get(item.id)?.serviceDepartments || [], lastServiceAt: item.lastServiceAt || current.get(item.id)?.lastServiceAt || "",
        lastServiceNames: item.lastServiceNames || current.get(item.id)?.lastServiceNames || [], lastServiceDepartments: item.lastServiceDepartments || current.get(item.id)?.lastServiceDepartments || []
      } satisfies StaffAppointment));
      if (generation === this.loadGeneration) this.dashboard.set({ ...dashboard, appointments });
    } catch {
      if (generation === this.loadGeneration) this.loadError.set(this.staff.error() || "Unable to load appointments.");
    } finally { if (generation === this.loadGeneration) this.loading.set(false); }
  }

  async loadHistory(reset: boolean) {
    const from = parseDisplayBusinessDate(this.historyFrom());
    const to = parseDisplayBusinessDate(this.historyTo());
    if ((this.historyFrom() && !from) || (this.historyTo() && !to) || Boolean(from) !== Boolean(to) || (from && to && from > to)) {
      this.historyError.set("Choose both valid history dates, with From on or before To.");
      return;
    }
    const current = this.history();
    const page = reset ? 1 : Number(current?.pagination.page || 1) + 1;
    this.historyLoading.set(true); this.historyError.set("");
    try {
      const data = await this.staff.business({ from: from || undefined, to: to || undefined, allHistory: !from && !to, page, pageSize: 25, q: this.historyClient().trim(), status: this.historyStatus(), serviceId: this.historyServiceId(), department: this.historyDepartment(), sort: "desc" });
      if (reset || !current) this.history.set(data);
      else {
        const appointments = new Map([...current.appointments, ...data.appointments].map((item) => [item.id, item]));
        this.history.set({ ...data, appointments: [...appointments.values()] });
      }
    } catch { this.historyError.set(this.staff.error() || "Unable to load appointment history."); }
    finally { this.historyLoading.set(false); }
  }

  clearHistoryFilters() {
    this.historyFrom.set(""); this.historyTo.set(""); this.historyClient.set(""); this.historyStatus.set("all"); this.historyServiceId.set(""); this.historyDepartment.set("");
    void this.loadHistory(true);
  }

  canSeeRevenue(): boolean { return this.staff.hasAnyPermission(["staff.app.business.service_amount.read", "read:finance", "read:sales", "read:payments", "read:invoices"]); }
  canManageAppointment(item: StaffAppointment): boolean { return this.staff.hasPermission("staff.app.appointments.manage") && !TERMINAL_STATUSES.has(this.statusOf(item)); }
  openAppointment(item: StaffAppointment) {
    this.actionMode.set(null); this.actionMessage.set(""); this.selectedAppointment.set(item);
    this.recommendations.set([]); this.recommendationError.set(""); this.recommendationLoading.set(true);
    void this.staff.appointmentRecommendations(item.id)
      .then((rows) => { if (this.selectedAppointment()?.id === item.id) this.recommendations.set(rows); })
      .catch(() => { if (this.selectedAppointment()?.id === item.id) this.recommendationError.set(this.staff.error() || "Unable to load staff recommendations."); })
      .finally(() => { if (this.selectedAppointment()?.id === item.id) this.recommendationLoading.set(false); });
  }
  closeDrawers() { this.actionMode.set(null); this.selectedAppointment.set(null); this.recommendations.set([]); this.recommendationError.set(""); }
  recommendationMeta(item: StaffRecommendation): string {
    return [
      item.rating == null ? "" : `Rating ${item.rating.toFixed(1)}`,
      item.completionPercent == null ? "" : `${item.completionPercent}% completion`,
      item.repeatClientPercent == null ? "" : `${item.repeatClientPercent}% repeat`,
      item.utilizationPercent == null ? "" : `${item.utilizationPercent}% utilization`
    ].filter(Boolean).join(" · ");
  }
  beginReschedule(item: StaffAppointment) {
    const value = istDateTimeInput(item.startAt);
    this.actionDate.set(value.date); this.actionTime.set(value.time); this.actionReason.set(""); this.actionError.set(""); this.actionMode.set("reschedule");
  }
  beginCancel() { this.actionReason.set(""); this.actionError.set(""); this.actionMode.set("cancel"); }

  async submitAction(item: StaffAppointment) {
    const reason = this.actionReason().trim();
    if (reason.length < 3) { this.actionError.set("Enter a reason of at least 3 characters."); return; }
    this.savingAction.set(true); this.actionError.set("");
    try {
      if (this.actionMode() === "cancel") await this.staff.cancelAppointment(item.id, reason);
      else {
        const start = new Date(`${this.actionDate()}T${this.actionTime()}:00+05:30`);
        if (Number.isNaN(start.getTime()) || start <= new Date()) { this.actionError.set("Choose a future date and time."); return; }
        await this.staff.rescheduleAppointment(item.id, { startAt: start.toISOString(), reason });
      }
      this.actionMessage.set(this.actionMode() === "cancel" ? "Appointment cancelled." : "Appointment rescheduled.");
      this.closeDrawers();
      await this.load();
      if (this.history()) await this.loadHistory(true);
    } catch { this.actionError.set(this.staff.error() || "Unable to update appointment."); }
    finally { this.savingAction.set(false); }
  }

  private statusOf(item: StaffAppointment): string { return String(item.status || "").toLowerCase(); }
  private isCompleted(item: StaffAppointment, today: string): boolean {
    const status = this.statusOf(item);
    const date = istDateKey(item.startAt);
    return !CANCELLED_STATUSES.has(status) && (COMPLETED_STATUSES.has(status) || !date || date < today);
  }
  private compareStartTimes(left: StaffAppointment, right: StaffAppointment, ascending: boolean): number {
    const leftTime = new Date(left.startAt).getTime();
    const rightTime = new Date(right.startAt).getTime();
    if (Number.isNaN(leftTime)) return Number.isNaN(rightTime) ? 0 : 1;
    if (Number.isNaN(rightTime)) return -1;
    return ascending ? leftTime - rightTime : rightTime - leftTime;
  }
}
