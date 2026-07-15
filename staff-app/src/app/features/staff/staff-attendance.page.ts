import { DatePipe } from "@angular/common";
import { Component, OnDestroy, OnInit, computed, signal } from "@angular/core";
import { isQueuedMutation, MutationResult, StaffAppService, StaffAttendance, StaffToday } from "../../core/staff-app.service";
import { StaffPageStateComponent } from "./staff-page-state.component";

@Component({
  standalone: true,
  imports: [DatePipe, StaffPageStateComponent],
  template: `
    <section class="page attendance-page">
      <header class="page-head"><div><p class="eyebrow">Attendance</p><h1>Attendance</h1><p>Clock-in, break, and clock-out controls.</p></div></header>
      @if (!canUseAttendance()) { <section staffPageState class="notice">You do not have permission to use attendance controls.</section> }
      @if (loading()) { <section staffPageState class="state" [loading]="true">Loading attendance...</section> }
       @if (message()) { <section staffPageState class="notice success">{{ message() }}</section> }
       @if (localError()) { <section staffPageState class="notice">{{ localError() }}</section> }
       @if (staff.error() && !localError()) { <section staffPageState class="notice">{{ staff.error() }}</section> }
      @if (today(); as data) {
         <section class="grid four attendance-kpis"><article class="kpi"><span>Status</span><strong>{{ attendanceStatus() }}</strong></article><article class="kpi"><span>Clock in</span><strong>{{ activeOrLatestAttendance()?.clockInAt ? (activeOrLatestAttendance()?.clockInAt | date:'shortTime') : '-' }}</strong></article><article class="kpi"><span>Clock out</span><strong>{{ activeOrLatestAttendance()?.clockOutAt ? (activeOrLatestAttendance()?.clockOutAt | date:'shortTime') : '-' }}</strong></article><article class="kpi"><span>Worked</span><strong>{{ workedLabel() }}</strong></article></section>
         <section class="panel actions-panel"><div class="panel-title"><h2>Actions</h2><span>{{ pendingAction() ? 'Saving...' : data.date }}</span></div><div class="row-actions">@if (canUseAttendance()) { @if (!activeAttendance()) { <button class="link-button" type="button" [disabled]="!!pendingAction()" (click)="clockIn()">{{ pendingAction() === 'clock-in' ? 'Clocking in...' : 'Clock in' }}</button> } @else if (isOnBreak()) { <button class="link-button" type="button" [disabled]="!!pendingAction()" (click)="endBreak()">{{ pendingAction() === 'end-break' ? 'Ending break...' : 'End break' }}</button> } @else { <button class="link-button" type="button" [disabled]="!!pendingAction()" (click)="startBreak()">{{ pendingAction() === 'start-break' ? 'Starting break...' : 'Start break' }}</button><button class="link-button" type="button" [disabled]="!!pendingAction()" (click)="clockOut()">{{ pendingAction() === 'clock-out' ? 'Clocking out...' : 'Clock out' }}</button> } }</div></section>
         <section class="panel history-panel" [attr.aria-busy]="historyLoading()"><div class="history-heading"><div><p class="eyebrow">History</p><h2>{{ activeRangeLabel() }} attendance</h2></div><span class="history-count" aria-live="polite">{{ historyLoading() ? 'Loading...' : attendance().length + ' records' }}</span></div><div class="history-presets" role="group" aria-label="Attendance history range">@for (option of historyRanges; track option.days) { <button class="link-button" type="button" [class.active-toggle]="selectedDays() === option.days" [attr.aria-pressed]="selectedDays() === option.days" [disabled]="historyLoading()" (click)="selectHistoryRange(option.days)">{{ option.label }}</button> }</div><div class="list">@for (row of attendance(); track row.id) { <div class="row"><div class="row-main"><strong>{{ row.businessDate }}</strong><small>Clock in {{ row.clockInAt ? (row.clockInAt | date:'shortTime') : '-' }} · Clock out {{ row.clockOutAt ? (row.clockOutAt | date:'shortTime') : '-' }}</small><small>Worked {{ formatMinutes(row.totalWorkedMinutes) }} · Break {{ formatMinutes(row.totalBreakMinutes) }} · Scheduled {{ row.scheduledShiftMinutes === null ? 'Not captured (legacy)' : formatMinutes(row.scheduledShiftMinutes) }} · OT {{ formatMinutes(row.overtimeMinutes) }}</small><small>{{ row.source || 'staff-app' }} · {{ row.overtimeCalculationStatus }}</small></div><span class="badge">{{ row.status }}</span></div> } @empty { @if (!historyLoading()) { <p class="empty">No attendance records in the {{ activeRangeLabel().toLowerCase() }}.</p> } }</div></section>
      }
    </section>
  `,
  styleUrls: ["./staff-app.styles.css"],
  styles: [`
    .history-heading{display:flex;align-items:end;justify-content:space-between;gap:12px;margin-bottom:12px}.history-heading .eyebrow{margin-bottom:3px}.history-heading h2{margin:0;color:var(--staff-text);font-size:1.08rem;letter-spacing:-.015em}.history-count{color:var(--staff-text-secondary);font-size:.76rem;font-weight:700;white-space:nowrap}.history-presets{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:6px;margin-bottom:10px;padding:4px;border:1px solid var(--staff-border);border-radius:16px;background:var(--staff-surface-secondary)}.history-presets .link-button{min-width:0;padding-inline:8px;border-radius:12px;font-size:.76rem}.history-panel[aria-busy="true"] .list{opacity:.58}.history-panel .list{transition:opacity var(--staff-motion-fast) var(--staff-motion-ease)}
    @media(max-width:700px){.attendance-page{gap:10px;padding-inline:14px}.attendance-page .page-head{min-height:0;gap:3px}.attendance-page .page-head .eyebrow{margin-bottom:3px;font-size:.6rem}.attendance-page .page-head h1{font-size:1.55rem;line-height:1.05}.attendance-page .page-head p:not(.eyebrow){margin-top:4px;font-size:.76rem;line-height:1.3}.attendance-kpis{grid-template-columns:repeat(2,minmax(0,1fr));gap:6px}.attendance-kpis .kpi{min-height:68px;padding:9px 11px;border-radius:14px;box-shadow:none}.attendance-kpis .kpi span{font-size:.58rem}.attendance-kpis .kpi strong{margin-top:3px;font-size:1.08rem;line-height:1.1}.attendance-page .panel{padding:11px 12px;border-radius:16px;box-shadow:none}.attendance-page .panel-title{min-height:24px;margin-bottom:6px;align-items:center}.attendance-page .panel-title h2,.history-heading h2{font-size:.92rem}.actions-panel .row-actions{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px}.actions-panel .row-actions .link-button{width:100%;min-height:44px;padding:8px 10px;border-radius:12px;font-size:.78rem}.history-heading{align-items:center;margin-bottom:8px}.history-heading .eyebrow{display:none}.history-count{font-size:.66rem}.history-presets{gap:3px;margin-bottom:4px;padding:3px;border-radius:13px}.history-presets .link-button{min-height:44px;padding:6px 3px;border-radius:10px;font-size:clamp(.62rem,2.8vw,.72rem);white-space:nowrap}.history-panel .row{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:6px;min-height:0;padding:8px 0}.history-panel .row-main{min-width:0}.history-panel .row strong{font-size:.8rem}.history-panel .row small{margin-top:2px;font-size:.64rem;line-height:1.28}.history-panel .badge{align-self:start;padding:4px 6px;font-size:.58rem}.history-panel .empty{padding:12px 0;font-size:.76rem}}
    @media(max-width:380px){.attendance-kpis{grid-template-columns:repeat(2,minmax(0,1fr))}.attendance-page{padding-inline:10px}.history-panel .row{grid-template-columns:1fr}.history-panel .badge{justify-self:start}}
    @media(prefers-reduced-motion:reduce){.history-panel .list{transition:none}}
  `]
})
export class StaffAttendancePage implements OnInit, OnDestroy {
  readonly today = signal<StaffToday | null>(null);
  readonly attendance = signal<StaffAttendance[]>([]);
  readonly loading = signal(false);
  readonly historyLoading = signal(false);
  readonly selectedDays = signal<30 | 90 | 180 | 365>(30);
  readonly historyRanges = [{ days: 30, label: "30 days", rangeLabel: "Last 30 days" }, { days: 90, label: "3 months", rangeLabel: "Last 3 months" }, { days: 180, label: "6 months", rangeLabel: "Last 6 months" }, { days: 365, label: "12 months", rangeLabel: "Last 12 months" }] as const;
  readonly activeRangeLabel = computed(() => this.historyRanges.find((option) => option.days === this.selectedDays())?.rangeLabel || "Last 30 days");
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
      const [today, attendance] = await Promise.all([this.staff.today(), this.staff.attendanceHistory(this.selectedDays())]);
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
  async selectHistoryRange(days: 30 | 90 | 180 | 365) {
    if (days === this.selectedDays() || this.historyLoading()) return;
    const previousDays = this.selectedDays();
    const previousAttendance = this.attendance();
    this.selectedDays.set(days);
    this.attendance.set([]);
    this.localError.set("");
    this.historyLoading.set(true);
    try { this.attendance.set(await this.staff.attendanceHistory(days)); }
    catch {
      this.selectedDays.set(previousDays);
      this.attendance.set(previousAttendance);
      this.localError.set(this.staff.error() || "Unable to load attendance history.");
    }
    finally { this.historyLoading.set(false); }
  }
}
