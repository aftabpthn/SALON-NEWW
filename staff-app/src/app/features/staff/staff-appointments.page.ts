import { DatePipe } from "@angular/common";
import { Component, computed, HostListener, OnInit, signal } from "@angular/core";
import { RouterLink } from "@angular/router";
import { StaffAppService, StaffAppointment, StaffDashboard } from "../../core/staff-app.service";
import { businessDate, businessDateOffset } from "../../core/business-date";
import { PaiseInrPipe } from "../../core/paise-inr.pipe";
import { StaffPageStateComponent } from "./staff-page-state.component";

type AppointmentView = "today" | "upcoming" | "live" | "completed" | "cancelled";

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
  imports: [PaiseInrPipe, DatePipe, RouterLink, StaffPageStateComponent],
  template: `
    <section class="page">
      <header class="page-head"><div><p class="eyebrow">Appointments</p><h1>Appointments</h1><p>Assigned bookings with service actions.</p></div></header>
      @if (loading()) { <section staffPageState class="state" [loading]="true">Loading appointments...</section> }
      @if (staff.error()) { <section staffPageState class="notice">{{ staff.error() }}</section> }

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
        </nav>

        <section class="panel" aria-live="polite">
          <div class="panel-title">
            <h2>{{ viewTitle() }}</h2>
            <div class="row-actions">
              <span>{{ visibleAppointments().length }}</span>
              @if (activeView() === 'live') { <a class="button" routerLink="/staff/queue">Open live timers</a> }
            </div>
          </div>
          <div class="list">
            @for (item of visibleAppointments(); track item.id) {
              <details class="appointment-list-item">
                <summary>
                  <div class="appointment-list-copy">
                  <strong>Assigned appointment</strong>
                    <span>{{ item.serviceNames.join(', ') || 'Service not mapped' }}</span>
                  @if (isValidDate(item.startAt) && isValidDate(item.endAt)) {
                  <small>{{ item.startAt | date:'mediumDate' }} · {{ item.startAt | date:'shortTime' }} - {{ item.endAt | date:'shortTime' }} · {{ item.durationMinutes || 0 }} min</small>
                  } @else {
                    <small>Date unavailable - {{ item.durationMinutes || 0 }} min</small>
                  }
                  </div>
                  <div class="appointment-list-meta"><span class="badge">{{ item.status }}</span><span class="expand-indicator" aria-hidden="true"></span></div>
                </summary>
                <div class="appointment-list-expanded">
                  <div class="row-actions">
                  @if (canSeeRevenue()) { <span class="badge">{{ item.value | paiseInr }}</span> }
                  <button class="link-button" type="button" (click)="openAppointment(item)">Details</button>
                  </div>
                </div>
              </details>
            } @empty {
              <p class="empty">{{ emptyMessage() }}</p>
            }
          </div>
        </section>
      }

      @if (selectedAppointment(); as item) {
        <button class="detail-backdrop" type="button" (click)="closeDrawers()" aria-label="Close details"></button>
        <aside class="detail-drawer" role="dialog" aria-modal="true" aria-labelledby="appointment-detail-title" tabindex="-1">
          <div class="panel-title"><h2 id="appointment-detail-title">Appointment detail</h2><button class="link-button" type="button" (click)="closeDrawers()">Close</button></div>
          <section class="grid two compact-grid"><article class="kpi"><span>Work item</span><strong>Assigned appointment</strong></article><article class="kpi"><span>Status</span><strong>{{ item.status }}</strong></article></section>
          <div class="list"><div class="row"><strong>Time</strong><span>{{ item.startAt | date:'short' }} - {{ item.endAt | date:'shortTime' }}</span></div><div class="row"><strong>Services</strong><span>{{ item.serviceNames.join(', ') || '-' }}</span></div><div class="row"><strong>Duration</strong><span>{{ item.durationMinutes || 0 }} min</span></div><div class="row"><strong>Chair</strong><span>{{ item.chair || '-' }}</span></div></div>
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
              <div class="drawer-actions"><button class="link-button" type="button" [disabled]="savingAction()" (click)="actionMode.set(null)">Back</button><button class="button" type="button" [disabled]="savingAction()" (click)="submitAction(item)">{{ savingAction() ? 'Saving...' : 'Confirm' }}</button></div>
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
    @media (max-width: 900px) {
      .detail-drawer { top: var(--staff-header-height); padding-bottom: calc(20px + env(safe-area-inset-bottom)); }
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
    const rows = (this.dashboard()?.appointments || []).filter((item) => {
      const date = istDateKey(item.startAt);
      const status = this.statusOf(item);
      switch (view) {
        case "today": return date === today;
        case "upcoming": return date > today && !TERMINAL_STATUSES.has(status);
        case "live": return date === today && LIVE_STATUSES.has(status);
        case "completed": return this.isCompleted(item, today);
        case "cancelled": return CANCELLED_STATUSES.has(status);
      }
    });
    const ascending = view === "today" || view === "live" || view === "upcoming";
    return rows.sort((left, right) => this.compareStartTimes(left, right, ascending));
  });
  readonly loading = signal(false);
  readonly selectedAppointment = signal<StaffAppointment | null>(null);
  readonly actionMode = signal<"reschedule" | "cancel" | null>(null);
  readonly actionDate = signal("");
  readonly actionTime = signal("");
  readonly actionReason = signal("");
  readonly actionError = signal("");
  readonly savingAction = signal(false);
  private loadGeneration = 0;

  constructor(readonly staff: StaffAppService) {}

  ngOnInit() { void this.load(); }

  @HostListener("window:aura:appointments-updated")
  onAppointmentsUpdated() { void this.load(); }

  setView(view: AppointmentView) { this.activeView.set(view); }

  viewTitle(): string {
    return ({ today: "Today's Queue", upcoming: "Upcoming appointments", live: "Live appointments", completed: "Completed appointments", cancelled: "Cancelled appointments" } as const)[this.activeView()];
  }

  emptyMessage(): string {
    return ({ today: "No appointments in today's queue.", upcoming: "No upcoming appointments assigned to you.", live: "No live appointments right now.", completed: "No completed appointments in the loaded range.", cancelled: "No cancelled appointments in the loaded range." } as const)[this.activeView()];
  }

  isValidDate(value: string): boolean { return !Number.isNaN(new Date(value).getTime()); }

  async load() {
    const generation = ++this.loadGeneration;
    this.loading.set(true);
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
        startAt: item.startAt, endAt: item.endAt, status: item.status, chair: current.get(item.id)?.chair || "", source: current.get(item.id)?.source || ""
      } satisfies StaffAppointment));
      if (generation === this.loadGeneration) this.dashboard.set({ ...dashboard, appointments });
    } finally { if (generation === this.loadGeneration) this.loading.set(false); }
  }

  canSeeRevenue(): boolean { return this.staff.hasAnyPermission(["read:finance", "read:sales", "read:payments", "read:invoices"]); }
  canManageAppointment(item: StaffAppointment): boolean { return this.staff.hasPermission("staff.app.appointments.manage") && !TERMINAL_STATUSES.has(this.statusOf(item)); }
  openAppointment(item: StaffAppointment) { this.actionMode.set(null); this.selectedAppointment.set(item); }
  closeDrawers() { this.actionMode.set(null); this.selectedAppointment.set(null); }
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
      this.closeDrawers();
      await this.load();
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
