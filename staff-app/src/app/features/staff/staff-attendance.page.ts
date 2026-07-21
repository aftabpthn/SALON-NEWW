import { DatePipe } from "@angular/common";
import { Component, OnDestroy, OnInit, computed, signal } from "@angular/core";
import { isQueuedMutation, MutationResult, StaffAppService, StaffAttendance, StaffToday } from "../../core/staff-app.service";
import { StaffPageStateComponent } from "./staff-page-state.component";

@Component({
  standalone: true,
  imports: [DatePipe, StaffPageStateComponent],
  template: `
    <section class="page">
      <header class="page-head"><div><p class="eyebrow">Attendance</p><h1>Attendance</h1><p>Clock-in, break, and clock-out controls.</p></div></header>
      @if (!canUseAttendance()) { <section staffPageState class="notice">You do not have permission to use attendance controls.</section> }
      @if (loading()) { <section staffPageState class="state" [loading]="true">Loading attendance...</section> }
       @if (message()) { <section staffPageState class="notice success">{{ message() }}</section> }
       @if (localError()) { <section staffPageState class="notice">{{ localError() }}</section> }
       @if (staff.error() && !localError()) { <section staffPageState class="notice">{{ staff.error() }}</section> }
      @if (today(); as data) {
        <section class="grid four"><article class="kpi"><span>Status</span><strong>{{ attendanceStatus() }}</strong></article><article class="kpi"><span>Clock in</span><strong>{{ activeOrLatestAttendance()?.clockInAt ? (activeOrLatestAttendance()?.clockInAt | date:'shortTime') : '-' }}</strong></article><article class="kpi"><span>Clock out</span><strong>{{ activeOrLatestAttendance()?.clockOutAt ? (activeOrLatestAttendance()?.clockOutAt | date:'shortTime') : '-' }}</strong></article><article class="kpi"><span>Worked</span><strong>{{ workedLabel() }}</strong></article></section>
        <section class="panel"><div class="panel-title"><h2>Actions</h2><span>{{ pendingAction() ? 'Saving...' : data.date }}</span></div><div class="row-actions">@if (canUseAttendance()) { @if (!activeAttendance()) { <button class="link-button" type="button" [disabled]="!!pendingAction()" (click)="clockIn()">{{ pendingAction() === 'clock-in' ? 'Clocking in...' : 'Clock in' }}</button> } @else if (isOnBreak()) { <button class="link-button" type="button" [disabled]="!!pendingAction()" (click)="endBreak()">{{ pendingAction() === 'end-break' ? 'Ending break...' : 'End break' }}</button> } @else { <button class="link-button" type="button" [disabled]="!!pendingAction()" (click)="startBreak()">{{ pendingAction() === 'start-break' ? 'Starting break...' : 'Start break' }}</button><button class="link-button" type="button" [disabled]="!!pendingAction()" (click)="clockOut()">{{ pendingAction() === 'clock-out' ? 'Clocking out...' : 'Clock out' }}</button> } }</div></section>
        <section class="panel"><div class="panel-title"><h2>Last 30 days attendance</h2><span>{{ attendance().length }}</span></div><div class="list">@for (row of attendance(); track row.id) { <div class="row"><div class="row-main"><strong>{{ row.businessDate }}</strong><small>Clock in {{ row.clockInAt ? (row.clockInAt | date:'shortTime') : '-' }} · Clock out {{ row.clockOutAt ? (row.clockOutAt | date:'shortTime') : '-' }}</small><small>Worked {{ formatMinutes(row.totalWorkedMinutes) }} · Break {{ formatMinutes(row.totalBreakMinutes) }} · Scheduled {{ row.scheduledShiftMinutes === null ? 'Not captured (legacy)' : formatMinutes(row.scheduledShiftMinutes) }} · OT {{ formatMinutes(row.overtimeMinutes) }}</small><small>{{ row.source || 'staff-app' }} · {{ row.overtimeCalculationStatus }}</small></div><span class="badge">{{ row.status }}</span></div> } @empty { <p class="empty">No attendance records in the last 30 days.</p> }</div></section>
      }
    </section>
  `,
  styleUrls: ["./staff-app.styles.css"]
})
export class StaffAttendancePage implements OnInit, OnDestroy {
  readonly today = signal<StaffToday | null>(null);
  readonly attendance = signal<StaffAttendance[]>([]);
  readonly loading = signal(false);
  readonly message = signal("");
  readonly localError = signal("");
  readonly pendingAction = signal<"clock-in" | "clock-out" | "start-break" | "end-break" | null>(null);
  readonly activeAttendance = computed(() => this.today()?.attendance.find((item) => ["clocked_in", "on_break", "break"].includes(String(item.status).toLowerCase())) || null);
  readonly activeOrLatestAttendance = computed<StaffAttendance | null>(() => this.activeAttendance() || this.today()?.attendance[0] || null);
  private readonly attendanceUpdated = () => void this.load();
  constructor(readonly staff: StaffAppService) {}
  ngOnInit() { window.addEventListener("aura:attendance-updated", this.attendanceUpdated); void this.load(); }
  ngOnDestroy() { window.removeEventListener("aura:attendance-updated", this.attendanceUpdated); }
  async load() {
    this.loading.set(true);
    try {
      const [today, attendance] = await Promise.all([this.staff.today(), this.staff.attendanceHistory()]);
      this.today.set(today);
      this.attendance.set(attendance);
    } finally { this.loading.set(false); }
  }
  canUseAttendance(): boolean { return this.staff.hasAnyPermission(["allow:staff-checkin-checkout", "write:staff"]); }
  attendanceStatus(): string { return this.activeOrLatestAttendance()?.status?.replace(/_/g, " ") || "not clocked in"; }
  isOnBreak(): boolean { return !!this.today()?.activeBreak || ["on_break", "break"].includes(String(this.activeAttendance()?.status || "").toLowerCase()); }
  workedLabel(): string { const row = this.activeOrLatestAttendance(); if (!row?.clockInAt) return "-"; if (row.clockOutAt) return this.formatMinutes(row.totalWorkedMinutes); const minutes = Math.max(0, Math.floor((Date.now() - new Date(row.clockInAt).getTime()) / 60000) - Number(row.totalBreakMinutes || 0)); return this.formatMinutes(minutes); }
  formatMinutes(value: number | null | undefined): string { const minutes = Math.max(0, Number(value || 0)); return `${Math.floor(minutes / 60)}h ${minutes % 60}m`; }
  async clockIn() { await this.runAction("clock-in", () => this.staff.clockIn(), "Clock-in saved."); }
  async clockOut() { await this.runAction("clock-out", () => this.staff.clockOut(this.activeAttendance()?.id), "Clock-out saved."); }
  async startBreak() { await this.runAction("start-break", () => this.staff.startBreak(), "Break started."); }
  async endBreak() { await this.runAction("end-break", () => this.staff.endBreak(), "Break ended."); }
  private async runAction(action: NonNullable<ReturnType<typeof this.pendingAction>>, mutate: () => Promise<MutationResult<unknown>>, completedMessage: string) {
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
    } catch {
      this.localError.set(this.staff.error() || `Unable to ${action.replace(/-/g, " ")}.`);
    } finally {
      this.pendingAction.set(null);
    }
  }
}
