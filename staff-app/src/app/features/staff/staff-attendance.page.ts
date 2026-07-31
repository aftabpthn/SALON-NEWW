import { DatePipe } from "@angular/common";
import { Component, OnDestroy, OnInit, computed, signal } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { isQueuedMutation, MutationResult, StaffAppService, StaffAttendance, StaffAttendanceToday, StaffEarlyDepartureRequest } from "../../core/staff-app.service";
import { StaffPageStateComponent } from "./staff-page-state.component";

type AttendanceAction = "clock-in" | "biometric-clock-in" | "clock-out" | "start-break" | "end-break";

@Component({
  standalone: true,
  imports: [DatePipe, FormsModule, StaffPageStateComponent],
  template: `
    <section class="page">
      <header class="page-head"><div><p class="eyebrow">Attendance</p><h1>Attendance</h1><p>Clock-in, break, and clock-out controls.</p></div></header>
      @if (!canUseAttendance()) { <section staffPageState class="notice">You can view attendance, but clock actions are not enabled for your role.</section> }
      @if (loading() && !today()) {
        <section class="attendance-skeleton" aria-label="Loading attendance">
          <div class="skeleton-grid"><span class="skeleton"></span><span class="skeleton"></span><span class="skeleton"></span><span class="skeleton"></span></div>
          <span class="skeleton attendance-panel-skeleton"></span>
          <span class="skeleton attendance-history-skeleton"></span>
        </section>
      }
      @if (loadError()) { <section staffPageState class="notice attendance-error"><span>{{ loadError() }}</span><button class="link-button" type="button" [disabled]="loading()" (click)="load()">Retry</button></section> }
      @if (historyLoadError() && today()) { <section class="optional-warning" role="status"><span aria-hidden="true">!</span><div><p>Attendance history could not refresh.</p><small>Today’s attendance remains available.</small></div><button type="button" class="text-control" (click)="loadHistory()">Retry</button></section> }
      @if (message()) { <section staffPageState class="notice success" role="status">{{ message() }}</section> }
      @if (localError()) { <section staffPageState class="notice">{{ localError() }}</section> }
      @if (today(); as data) {
        <section class="grid four"><article class="kpi"><span>Status</span><strong>{{ attendanceStatus() }}</strong></article><article class="kpi"><span>Clock in</span><strong>{{ activeOrLatestAttendance()?.clockInAt ? (activeOrLatestAttendance()?.clockInAt | date:'shortTime') : '-' }}</strong></article><article class="kpi"><span>Worked</span><strong>{{ workedLabel() }}</strong></article><article class="kpi"><span>Overtime</span><strong>{{ formatMinutes(activeOrLatestAttendance()?.overtimeMinutes) }}</strong></article></section>
        <section class="panel"><div class="panel-title"><h2>Shift schedule</h2><span>{{ loading() ? 'Refreshing...' : (data.schedules.length ? data.schedules[0].status : 'not assigned') }}</span></div><div class="list">@for (shift of data.schedules; track shift.id) { <div class="row"><strong>{{ shift.scheduleDate | date:'dd/MM/yyyy' }}</strong><span>{{ shift.startTime || '-' }} - {{ shift.endTime || '-' }} · {{ shift.shiftType || 'shift' }}</span></div> } @empty { <div class="attendance-empty"><p>No shift assigned today.</p><small>You can still clock in if your role allows it.</small></div> }</div></section>
        <section class="panel"><div class="panel-title"><h2>Actions</h2><span>{{ pendingAction() ? 'Saving...' : data.date }}</span></div><div class="row-actions attendance-action-row">@if (canUseAttendance()) { @if (!activeAttendance()) { <button class="button" type="button" [disabled]="!!pendingAction()" [attr.aria-busy]="pendingAction() === 'biometric-clock-in'" (click)="biometricClockIn()">{{ pendingAction() === 'biometric-clock-in' ? 'Verifying...' : 'Biometric clock-in' }}</button><button class="link-button" type="button" [disabled]="!!pendingAction()" [attr.aria-busy]="pendingAction() === 'clock-in'" (click)="clockIn()">{{ pendingAction() === 'clock-in' ? 'Clocking in...' : 'Clock in' }}</button> } @else if (isOnBreak()) { <button class="button" type="button" [disabled]="!!pendingAction()" [attr.aria-busy]="pendingAction() === 'end-break'" (click)="endBreak()">{{ pendingAction() === 'end-break' ? 'Ending break...' : 'End break' }}</button> } @else { <button class="link-button" type="button" [disabled]="!!pendingAction()" [attr.aria-busy]="pendingAction() === 'start-break'" (click)="startBreak()">{{ pendingAction() === 'start-break' ? 'Starting break...' : 'Start break' }}</button><button class="button" type="button" [disabled]="!!pendingAction()" [attr.aria-busy]="pendingAction() === 'clock-out'" (click)="clockOut()">{{ pendingAction() === 'clock-out' ? 'Clocking out...' : 'Clock out' }}</button> } } @else { <p class="attendance-readonly">Clock controls are disabled for this role.</p> }</div></section>
        <section class="panel early-panel">
          <div class="panel-title"><h2>Early departure requests</h2><span>{{ data.schedules.length ? data.schedules[0].endTime : 'No shift' }}</span></div>
          @if (canUseAttendance() && data.schedules.length) {
            <form class="early-form" (ngSubmit)="submitEarlyDeparture()">
              <label>Departure time<input type="time" name="earlyDepartureTime" required [(ngModel)]="earlyDepartureTime" [disabled]="earlySubmitting()" /></label>
              <label>Reason<input type="text" name="earlyDepartureReason" maxlength="500" required placeholder="Reason" [(ngModel)]="earlyDepartureReason" [disabled]="earlySubmitting()" /></label>
              <button class="button" type="submit" [disabled]="earlySubmitting() || !earlyDepartureTime || !earlyDepartureReason.trim()">{{ earlySubmitting() ? 'Sending...' : 'Send request' }}</button>
            </form>
            @if (earlyMinutes() > 0) { <small class="early-summary">Requested {{ earlyMinutes() }} minutes before the scheduled end.</small> }
          } @else if (canUseAttendance() && !data.schedules.length) { <div class="attendance-empty"><p>No working shift assigned today.</p></div> }
          <div class="list early-history">@for (request of earlyDepartures(); track request.id) { <div class="row"><div class="row-main"><strong>{{ displayDate(request.payloadJson.businessDate) }} · {{ request.payloadJson.requestedDepartureTime || '-' }}</strong><small>Scheduled end {{ request.payloadJson.scheduledEndTime || '-' }} · {{ request.payloadJson.earlyMinutes || 0 }} minutes early</small><small>{{ request.payloadJson.reason || '-' }}</small></div><span class="badge">{{ request.status }}</span></div> } @empty { @if (!earlyLoading()) { <div class="attendance-empty"><p>No early departure requests yet.</p></div> } }</div>
        </section>
        <section class="panel"><div class="panel-title"><h2>Last 30 days attendance</h2><span>{{ attendance().length }}</span></div><div class="list attendance-history-list">@for (row of attendance(); track row.id) { <div class="row attendance-history-row"><div class="row-main"><strong>{{ displayDate(row.businessDate) }}</strong><small>Clock in {{ row.clockInAt ? (row.clockInAt | date:'shortTime') : '-' }} · Clock out {{ row.clockOutAt ? (row.clockOutAt | date:'shortTime') : '-' }}</small><small>Worked {{ formatMinutes(row.totalWorkedMinutes) }} · Break {{ formatMinutes(row.totalBreakMinutes) }} · Scheduled {{ row.scheduledShiftMinutes === null ? 'Not captured (legacy)' : formatMinutes(row.scheduledShiftMinutes) }} · OT {{ formatMinutes(row.overtimeMinutes) }}</small><small>{{ row.source || 'staff-app' }} · {{ row.overtimeCalculationStatus }}</small></div><span class="badge">{{ row.status }}</span></div> } @empty { <div class="attendance-empty"><p>No attendance records in the last 30 days.</p><small>Clock-in records will appear here after CRM sync.</small></div> }</div></section>
      }
    </section>
  `,
  styleUrls: ["./staff-app.styles.css"],
  styles: [`
    .attendance-skeleton { display: grid; gap: 12px; }
    .attendance-panel-skeleton { min-height: 160px; }
    .attendance-history-skeleton { min-height: 260px; }
    .attendance-error { justify-content: space-between; }
    .attendance-empty { display: grid; justify-items: center; gap: 4px; padding: 22px 0; color: var(--staff-text-secondary); font-weight: 600; text-align: center; }
    .attendance-empty p, .attendance-readonly { margin: 0; }
    .attendance-empty small { font-weight: 600; }
    .attendance-readonly { width: 100%; color: var(--staff-text-secondary); font-weight: 650; }
    .attendance-action-row .button, .attendance-action-row .link-button { min-width: 132px; }
    .early-form { display: grid; grid-template-columns: minmax(150px, .55fr) minmax(220px, 1fr) auto; gap: 10px; align-items: end; }
    .early-form label { display: grid; gap: 6px; color: var(--staff-text-secondary); font-weight: 650; }
    .early-form input { min-height: 42px; padding: 0 12px; border: 1px solid var(--staff-border); border-radius: 8px; color: var(--staff-text-primary, #0f172a); font: inherit; }
    .early-summary { display: block; margin-top: 8px; color: var(--staff-text-secondary); font-weight: 600; }
    .early-history { margin-top: 14px; }
    @media (max-width: 700px) {
      .attendance-error, .attendance-action-row, .attendance-history-row { align-items: stretch; flex-direction: column; }
      .attendance-error button, .attendance-action-row .button, .attendance-action-row .link-button { width: 100%; }
      .attendance-history-row .badge { width: fit-content; }
      .early-form { grid-template-columns: 1fr; }
      .early-form .button { width: 100%; }
    }
  `]
})
export class StaffAttendancePage implements OnInit, OnDestroy {
  readonly today = signal<StaffAttendanceToday | null>(null);
  readonly attendance = signal<StaffAttendance[]>([]);
  readonly loading = signal(false);
  readonly message = signal("");
  readonly localError = signal("");
  readonly loadError = signal("");
  readonly historyLoadError = signal("");
  readonly pendingAction = signal<AttendanceAction | null>(null);
  readonly earlyDepartures = signal<StaffEarlyDepartureRequest[]>([]);
  readonly earlyLoading = signal(false);
  readonly earlySubmitting = signal(false);
  earlyDepartureTime = "";
  earlyDepartureReason = "";
  readonly activeAttendance = computed(() => this.today()?.attendance.find((item) => ["clocked_in", "on_break", "break"].includes(String(item.status).toLowerCase())) || null);
  readonly activeOrLatestAttendance = computed<StaffAttendance | null>(() => this.activeAttendance() || this.today()?.attendance[0] || null);
  private readonly attendanceUpdated = (event: Event) => {
    if ((event as CustomEvent).detail?.source === "attendance-page") return;
    void this.load();
  };
  constructor(readonly staff: StaffAppService) {}
  ngOnInit() { window.addEventListener("aura:attendance-updated", this.attendanceUpdated); void this.load(); }
  ngOnDestroy() { window.removeEventListener("aura:attendance-updated", this.attendanceUpdated); }
  async load() {
    this.loading.set(true);
    this.loadError.set("");
    this.historyLoadError.set("");
    try {
      this.today.set(await this.staff.attendanceToday());
    } catch {
      this.loadError.set(this.staff.error() || "Unable to load attendance.");
      this.loading.set(false);
      return;
    }
    this.loading.set(false);
    void this.loadHistory();
    void this.loadEarlyDepartures();
  }
  async loadHistory() {
    this.historyLoadError.set("");
    try { this.attendance.set(await this.staff.attendanceHistory()); }
    catch { this.historyLoadError.set("Unable to load attendance history."); }
  }
  canUseAttendance(): boolean { return this.staff.hasPermission("staff.app.attendance.manage"); }
  attendanceStatus(): string { return this.activeOrLatestAttendance()?.status?.replace(/_/g, " ") || "not clocked in"; }
  isOnBreak(): boolean { return !!this.today()?.activeBreak || ["on_break", "break"].includes(String(this.activeAttendance()?.status || "").toLowerCase()); }
  workedLabel(): string { const row = this.activeOrLatestAttendance(); if (!row?.clockInAt) return "-"; if (row.clockOutAt) return this.formatMinutes(row.totalWorkedMinutes); const minutes = Math.max(0, Math.floor((Date.now() - new Date(row.clockInAt).getTime()) / 60000) - Number(row.totalBreakMinutes || 0)); return this.formatMinutes(minutes); }
  formatMinutes(value: number | null | undefined): string { const minutes = Math.max(0, Number(value || 0)); return `${Math.floor(minutes / 60)}h ${minutes % 60}m`; }
  displayDate(value?: string): string { const parts = String(value || '').split('-'); return parts.length === 3 ? `${parts[2]}/${parts[1]}/${parts[0]}` : String(value || '-'); }
  earlyMinutes(): number {
    const end = this.today()?.schedules[0]?.endTime;
    if (!end || !this.earlyDepartureTime) return 0;
    const [endHour, endMinute] = end.split(':').map(Number);
    const [requestedHour, requestedMinute] = this.earlyDepartureTime.split(':').map(Number);
    return Math.max(0, endHour * 60 + endMinute - requestedHour * 60 - requestedMinute);
  }
  async loadEarlyDepartures() {
    this.earlyLoading.set(true);
    try { this.earlyDepartures.set(await this.staff.earlyDepartureRequests()); }
    catch { this.localError.set(this.staff.error() || "Unable to load early departure requests."); }
    finally { this.earlyLoading.set(false); }
  }
  async submitEarlyDeparture() {
    const businessDate = this.today()?.date;
    if (!businessDate || this.earlySubmitting()) return;
    this.earlySubmitting.set(true); this.localError.set(""); this.message.set("");
    try {
      await this.staff.requestEarlyDeparture({ businessDate, requestedDepartureTime: this.earlyDepartureTime, reason: this.earlyDepartureReason.trim() });
      this.earlyDepartureTime = ""; this.earlyDepartureReason = ""; this.message.set("Early departure request sent for approval.");
      await this.loadEarlyDepartures();
    } catch { this.localError.set(this.staff.error() || "Unable to send early departure request."); }
    finally { this.earlySubmitting.set(false); }
  }
  async clockIn() { await this.runAction("clock-in", () => this.staff.clockIn(), "Clock-in saved."); }
  async biometricClockIn() { await this.runAction("biometric-clock-in", () => this.staff.biometricClockIn(), "Biometric clock-in saved."); }
  async clockOut() { await this.runAction("clock-out", () => this.staff.clockOut(this.activeAttendance()?.id), "Clock-out saved."); }
  async startBreak() { await this.runAction("start-break", () => this.staff.startBreak(), "Break started."); }
  async endBreak() { await this.runAction("end-break", () => this.staff.endBreak(), "Break ended."); }
  private async runAction(action: AttendanceAction, mutate: () => Promise<MutationResult<unknown>>, completedMessage: string) {
    if (this.pendingAction()) return;
    this.pendingAction.set(action);
    this.message.set("");
    this.localError.set("");
    try {
      const result = await mutate();
      if (isQueuedMutation(result)) {
        this.message.set(`Offline: ${action.replace(/-/g, " ")} queued for sync (${result.queueId}).`);
        return;
      }
      this.message.set(completedMessage);
      await this.load();
      if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("aura:attendance-updated", { detail: { source: "attendance-page" } }));
    } catch {
      this.localError.set(this.staff.error() || `Unable to ${action.replace(/-/g, " ")}.`);
    } finally {
      this.pendingAction.set(null);
    }
  }
}
