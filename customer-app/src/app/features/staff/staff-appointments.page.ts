import { CurrencyPipe, DatePipe } from "@angular/common";
import { Component, computed, OnInit, signal } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { RouterLink } from "@angular/router";
import { IonSpinner } from "@ionic/angular/standalone";
import { StaffAppService, StaffAppointment, StaffClient360, StaffDashboard } from "../../core/staff-app.service";

type AppointmentView = "today" | "upcoming" | "live" | "completed" | "cancelled";

const LIVE_STATUSES = new Set(["booked", "confirmed", "checked-in", "arrived", "in-service", "started"]);
const TERMINAL_STATUSES = new Set(["completed", "checked-out", "cancelled", "no-show"]);
const COMPLETED_STATUSES = new Set(["completed", "checked-out"]);
const CANCELLED_STATUSES = new Set(["cancelled", "no-show"]);
const IST_DATE_FORMATTER = new Intl.DateTimeFormat("en", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" });

function istDateKey(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const parts = Object.fromEntries(IST_DATE_FORMATTER.formatToParts(date).map((part) => [part.type, part.value]));
  return [parts["year"], parts["month"], parts["day"]].join("-");
}

@Component({
  standalone: true,
  imports: [CurrencyPipe, DatePipe, FormsModule, RouterLink, IonSpinner],
  template: `
    <section class="page">
      <header class="page-head"><div><p class="eyebrow">Appointments</p><h1>Appointments</h1><p>Assigned bookings with service actions and Client 360 links.</p></div></header>
      @if (loading()) { <section class="state"><ion-spinner name="crescent" /> Loading appointments...</section> }
      @if (message()) { <section class="notice success">{{ message() }}</section> }
      @if (staff.error()) { <section class="notice">{{ staff.error() }}</section> }

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
              <article class="row">
                <div class="row-main">
                  <strong>{{ item.clientName || 'Walk-in client' }}</strong>
                  <p>{{ item.serviceNames.join(', ') || 'Service not mapped' }}</p>
                  @if (isValidDate(item.startAt) && isValidDate(item.endAt)) {
                  <small>{{ item.startAt | date:'mediumDate' }} · {{ item.startAt | date:'shortTime' }} - {{ item.endAt | date:'shortTime' }} · {{ item.durationMinutes || 0 }} min</small>
                  } @else {
                    <small>Date unavailable - {{ item.durationMinutes || 0 }} min</small>
                  }
                </div>
                <div class="row-actions">
                  <span class="badge">{{ item.status }}</span>
                  @if (canSeeRevenue()) { <span class="badge">{{ item.value | currency:'INR':'symbol':'1.0-0' }}</span> }
                  @if (canUpdateAppointments()) {
                    <button class="link-button" type="button" (click)="startService(item.id)">Start</button>
                    <button class="link-button" type="button" (click)="completeService(item.id)">Complete</button>
                  }
                  <button class="link-button" type="button" (click)="openAppointment(item)">Details</button>
                  @if (item.clientId) { <button class="link-button" type="button" (click)="openClientPreview(item.clientId)">Preview</button> }
                  @if (item.clientId) { <a class="button" [routerLink]="['/staff/client-360', item.clientId]">Client 360</a> }
                </div>
              </article>
            } @empty {
              <p class="empty">{{ emptyMessage() }}</p>
            }
          </div>
        </section>
      }

      @if (selectedAppointment(); as item) {
        <button class="detail-backdrop" type="button" (click)="closeDrawers()" aria-label="Close details"></button>
        <aside class="detail-drawer">
          <div class="panel-title"><h2>Appointment detail</h2><button class="link-button" type="button" (click)="closeDrawers()">Close</button></div>
          <section class="grid two compact-grid"><article class="kpi"><span>Client</span><strong>{{ item.clientName || 'Walk-in' }}</strong></article><article class="kpi"><span>Status</span><strong>{{ item.status }}</strong></article></section>
          <div class="list"><div class="row"><strong>Time</strong><span>{{ item.startAt | date:'short' }} - {{ item.endAt | date:'shortTime' }}</span></div><div class="row"><strong>Services</strong><span>{{ item.serviceNames.join(', ') || '-' }}</span></div><div class="row"><strong>Duration</strong><span>{{ item.durationMinutes || 0 }} min</span></div><div class="row"><strong>Chair</strong><span>{{ item.chair || '-' }}</span></div><div class="row"><strong>Phone</strong><span>{{ item.clientPhone || '-' }}</span></div></div>
          <div class="form-grid drawer-form"><label>Status<input [(ngModel)]="editStatus" /></label><label>Chair<input [(ngModel)]="editChair" /></label><label>Start ISO<input [(ngModel)]="editStartAt" /></label><label>End ISO<input [(ngModel)]="editEndAt" /></label><label>Services CSV<input [(ngModel)]="editServiceIds" /></label><label>Notes<input [(ngModel)]="editNotes" /></label></div>
          <div class="row-actions drawer-actions">@if (canUpdateAppointments()) { <button class="link-button" type="button" (click)="startService(item.id)">Start</button><button class="link-button" type="button" (click)="completeService(item.id)">Complete</button> } @if (item.clientId) { <button class="link-button" type="button" (click)="openClientPreview(item.clientId)">Client preview</button><a class="button primary" [routerLink]="['/staff/client-360', item.clientId]">Full Client 360</a> }</div>
          <button class="button primary" type="button" (click)="saveAppointment(item.id)">Save changes</button>
        </aside>
      }

      @if (selectedClient(); as client) {
        <button class="detail-backdrop" type="button" (click)="closeClientPreview()" aria-label="Close client preview"></button>
        <aside class="detail-drawer client-preview">
          <div class="panel-title"><h2>Client preview</h2><button class="link-button" type="button" (click)="closeClientPreview()">Close</button></div>
          <section class="grid two compact-grid"><article class="kpi"><span>Retention</span><strong>{{ client.retentionScore }}%</strong></article><article class="kpi"><span>Visits</span><strong>{{ client.visitFrequency }}</strong></article></section>
          <div class="list"><div class="row"><strong>Name</strong><span>{{ client.profile.name }}</span></div><div class="row"><strong>Phone</strong><span>{{ client.profile.phone || '-' }}</span></div><div class="row"><strong>Outstanding</strong><span>{{ client.outstandingBalance | currency:'INR':'symbol':'1.0-0' }}</span></div></div>
          @for (tip of client.aiRecommendations; track tip) { <p class="insight">{{ tip }}</p> }
        </aside>
      }
    </section>
  `,
  styleUrls: ["./staff-app.styles.css"]
})
export class StaffAppointmentsPage implements OnInit {
  readonly dashboard = signal<StaffDashboard | null>(null);
  readonly activeView = signal<AppointmentView>("today");
  readonly kpiCounts = computed(() => {
    const rows = this.dashboard()?.appointments || [];
    const today = istDateKey(new Date());
    return {
      today: rows.filter((item) => istDateKey(item.startAt) === today).length,
      live: rows.filter((item) => istDateKey(item.startAt) === today && LIVE_STATUSES.has(this.statusOf(item))).length,
      completed: rows.filter((item) => this.isCompleted(item, today)).length,
      cancelled: rows.filter((item) => CANCELLED_STATUSES.has(this.statusOf(item))).length
    };
  });
  readonly visibleAppointments = computed(() => {
    const today = istDateKey(new Date());
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
  readonly message = signal("");
  readonly selectedAppointment = signal<StaffAppointment | null>(null);
  readonly selectedClient = signal<StaffClient360 | null>(null);
  editNotes = "";
  editChair = "";
  editStatus = "";
  editStartAt = "";
  editEndAt = "";
  editServiceIds = "";

  constructor(readonly staff: StaffAppService) {}

  ngOnInit() { void this.load(); }

  setView(view: AppointmentView) { this.activeView.set(view); }

  viewTitle(): string {
    return ({ today: "Today's Queue", upcoming: "Upcoming appointments", live: "Live appointments", completed: "Completed appointments", cancelled: "Cancelled appointments" } as const)[this.activeView()];
  }

  emptyMessage(): string {
    return ({ today: "No appointments in today's queue.", upcoming: "No upcoming appointments assigned to you.", live: "No live appointments right now.", completed: "No completed appointments in the loaded range.", cancelled: "No cancelled appointments in the loaded range." } as const)[this.activeView()];
  }

  isValidDate(value: string): boolean { return !Number.isNaN(new Date(value).getTime()); }

  async load() {
    this.loading.set(true);
    try { this.dashboard.set(await this.staff.dashboard()); } finally { this.loading.set(false); }
  }

  canSeeRevenue(): boolean { return this.staff.hasAnyPermission(["read:finance", "read:sales", "read:payments", "read:invoices"]); }
  canUpdateAppointments(): boolean { return this.staff.hasAnyPermission(["update:appointments", "write:appointments"]); }

  async startService(appointmentId: string) { await this.staff.startService(appointmentId).then(() => this.afterAction("Service started.")); }
  async completeService(appointmentId: string) { await this.staff.completeService(appointmentId).then(() => this.afterAction("Service completed.")); }

  openAppointment(item: StaffAppointment) { this.editNotes = item.notes || ""; this.editChair = item.chair || ""; this.editStatus = item.status || ""; this.editStartAt = item.startAt || ""; this.editEndAt = item.endAt || ""; this.editServiceIds = (item.serviceIds || []).join(", "); this.selectedAppointment.set(item); }
  closeDrawers() { this.selectedAppointment.set(null); this.selectedClient.set(null); }
  closeClientPreview() { this.selectedClient.set(null); }
  async openClientPreview(clientId: string) { this.selectedAppointment.set(null); this.selectedClient.set(await this.staff.client360(clientId)); }
  async saveAppointment(appointmentId: string) { const updated = await this.staff.updateAppointment(appointmentId, { notes: this.editNotes, chair: this.editChair, status: this.editStatus, startAt: this.editStartAt, endAt: this.editEndAt, serviceIds: this.editServiceIds.split(",").map((item) => item.trim()).filter(Boolean) }); this.message.set("Appointment updated."); this.selectedAppointment.set(updated); await this.load(); }

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

  private async afterAction(message: string) { this.message.set(message); await this.load(); }
}
