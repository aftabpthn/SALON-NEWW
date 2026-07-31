import { DatePipe } from "@angular/common";
import { Component, OnInit, signal } from "@angular/core";
import { StaffAppService, StaffEnterpriseOs, StaffRosterItem } from "../../core/staff-app.service";
import { addBusinessDays, businessDate } from "../../core/business-date";
import { StaffPageStateComponent } from "./staff-page-state.component";

@Component({
  standalone: true,
  imports: [DatePipe, StaffPageStateComponent],
  template: `
    <section class="page">
      <header class="page-head">
        <div>
          <p class="eyebrow">Calendar</p>
          <h1>Calendar</h1>
          <p>Day and week staff schedule workspace.</p>
        </div>
        <div class="row-actions">
          <button class="button" [class.active-toggle]="view() === 'day'" [attr.aria-pressed]="view() === 'day'" type="button" (click)="setView('day')">Day</button>
          <button class="button" [class.active-toggle]="view() === 'week'" [attr.aria-pressed]="view() === 'week'" type="button" (click)="setView('week')">Week</button>
          <input aria-label="Selected calendar date" [value]="selectedDate()" type="date" (change)="setDate($any($event.target).value)" />
          <button class="button icon-button" type="button" aria-label="Previous date" (click)="shiftDate(-1)"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15.4 5.4-1.4-1.4-8 8 8 8 1.4-1.4L8.8 12z"></path></svg></button>
          <button class="button icon-button" type="button" aria-label="Next date" (click)="shiftDate(1)"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m8.6 18.6 1.4 1.4 8-8-8-8-1.4 1.4 6.6 6.6z"></path></svg></button>
        </div>
      </header>

      @if (loading() && !calendar()) { <section staffPageState class="state" [loading]="true">Loading calendar...</section> }
      @if (loadError()) { <section staffPageState class="notice"><span>{{ loadError() }}</span><button class="link-button" type="button" (click)="load()">Retry</button></section> }
      @if (timelineError() && calendar()) { <section class="optional-warning" role="status"><span aria-hidden="true">!</span><div><p>Appointment timeline could not refresh.</p><small>Your shift calendar remains available.</small></div><button type="button" class="text-control" (click)="loadTimeline()">Retry</button></section> }
      @if (message()) { <section staffPageState class="notice" [class.success]="message().startsWith('Shift') || message().startsWith('Calendar')">{{ message() }}</section> }

      @if (canReadCalendar()) {
        @if (view() === 'day') {
          <section class="grid two">
            <article class="panel">
              <div class="panel-title"><h2>Selected day</h2><span>{{ displayDate(selectedDate()) }}</span></div>
              <div class="calendar-day">
                @for (shift of daySchedules(); track shift.id) {
                  <div class="calendar-slot">
                    <b>{{ shift.startTime || '-' }}</b>
                    <div>
                      <strong>{{ shift.type || 'Shift' }}</strong>
                      <small>{{ shift.endTime || '-' }} · {{ shift.status }}</small>
                    </div>
                  </div>
                } @empty { <p class="empty">No shifts for selected day.</p> }
              </div>
            </article>
            <article class="panel">
              <div class="panel-title"><h2>Queue hint</h2><span>{{ os()?.timeline?.length || 0 }}</span></div>
              <div class="list">
                @for (item of os()?.timeline?.slice(0, 6) || []; track item.id) {
                  <div class="row"><div class="row-main"><strong>{{ item.serviceNames.join(', ') || 'Assigned appointment' }}</strong><small>{{ item.startAt | date:'dd/MM/yyyy, h:mm a' }} · {{ item.state }}</small></div><span class="badge">{{ item.status }}</span></div>
                } @empty { <p class="empty">No appointment timeline items.</p> }
              </div>
            </article>
          </section>
        } @else {
          <section class="calendar-week">
            @for (item of weekSchedules(); track item.id) {
              <article class="panel" draggable="true" (dragstart)="dragSchedule(item)" (dragover)="$event.preventDefault()" (drop)="dropSchedule(item.date)">
                <div class="panel-title"><h2>{{ displayDate(item.date) }}</h2><span>{{ item.status }}</span></div>
                <strong>{{ item.startTime || '-' }} - {{ item.endTime || '-' }}</strong>
                <p class="muted">{{ item.type || 'roster' }}</p>
                <small>{{ item.status === 'weekly_off' ? 'Weekly off' : 'Drag this card onto another date card to reschedule.' }}</small>
                <div class="row-actions">
                   @if (canUpdateCalendar()) {
                     <button class="link-button" type="button" (click)="startMove(item)">Move</button>
                   }
                   @if (editingId() === item.id) {
                     <div class="form-grid compact-grid">
                      <label>New date<input [value]="moveDate()" type="date" (change)="moveDate.set($any($event.target).value)" /></label>
                      <label>Start<input [value]="moveStart()" type="time" (change)="moveStart.set($any($event.target).value)" /></label>
                      <label>End<input [value]="moveEnd()" type="time" (change)="moveEnd.set($any($event.target).value)" /></label>
                      <div class="row-actions">
                        <button class="button" type="button" (click)="saveMove(item)">Save</button>
                        <button class="button" type="button" (click)="cancelMove()">Close</button>
                      </div>
                    </div>
                    } @else if (canUpdateCalendar()) {
                      @if (item.status === 'working' || item.status === 'weekly_off' || item.status === 'not_set') {
                        <button class="link-button" type="button" (click)="changeStatus(item, item.status === 'weekly_off' ? 'working' : 'weekly_off')">{{ item.status === 'weekly_off' ? 'Reinstate' : 'Mark off' }}</button>
                      }
                    }
                  </div>
              </article>
            } @empty { <section class="panel"><p class="empty">No upcoming calendar entries.</p></section> }
          </section>
        }
      }

      <section class="panel">
        <div class="panel-title"><h2>CRM schedule source</h2><span>{{ canUpdateCalendar() ? 'action enabled' : 'view mode' }}</span></div>
        <small class="muted">Schedules are published from CRM Availability. Use Move or Mark off to adjust a shift; week cards support date-only drag rescheduling.</small>
      </section>
    </section>
  `,
  styleUrls: ["./staff-app.styles.css"],
  styles: [`.icon-button{width:48px;padding:0}.icon-button svg{width:18px;height:18px;fill:currentColor}`]
})
export class StaffCalendarPage implements OnInit {
  readonly os = signal<StaffEnterpriseOs | null>(null);
  readonly calendar = signal<StaffRosterItem[] | null>(null);
  readonly loading = signal(false);
  readonly loadError = signal("");
  readonly timelineError = signal("");
  readonly view = signal<"day" | "week">("day");
  readonly message = signal("");
  readonly selectedDate = signal(businessDate());
  readonly dragged = signal<{ id: string; version: number; startTime: string; endTime: string } | null>(null);
  readonly editingId = signal<string | null>(null);
  readonly moveDate = signal(businessDate());
  readonly moveStart = signal("09:00");
  readonly moveEnd = signal("18:00");
  private loadGeneration = 0;

  constructor(readonly staff: StaffAppService) {}

  ngOnInit() { if (this.canReadCalendar()) void this.load(); }

  async load() {
    const generation = ++this.loadGeneration;
    this.loading.set(true);
    this.loadError.set("");
    this.timelineError.set("");
    try {
      const from = this.view() === "day" ? this.selectedDate() : this.weekStart();
      const to = this.view() === "day" ? this.selectedDate() : this.weekEnd();
      const calendar = await this.staff.calendar(from, to);
      if (generation !== this.loadGeneration) return;
      this.calendar.set(calendar);
      void this.loadTimeline(from, to, generation);
    } catch {
      if (generation === this.loadGeneration) this.loadError.set(this.staff.error() || "Unable to load calendar.");
    } finally {
      if (generation === this.loadGeneration) this.loading.set(false);
    }
  }

  async loadTimeline(from?: string, to?: string, generation = this.loadGeneration) {
    if (!this.staff.hasPermission("staff.app.appointments.read")) { this.os.set(null); return; }
    this.timelineError.set("");
    try {
      const rangeFrom = from || (this.view() === "day" ? this.selectedDate() : this.weekStart());
      const rangeTo = to || (this.view() === "day" ? this.selectedDate() : this.weekEnd());
      const os = await this.staff.enterpriseOs({ from: rangeFrom, to: rangeTo }, false);
      if (generation === this.loadGeneration) this.os.set(os);
    } catch {
      if (generation === this.loadGeneration) this.timelineError.set("Unable to load appointment timeline.");
    }
  }

  canReadCalendar(): boolean {
    return this.staff.hasPermission("staff.app.calendar.read");
  }

  canUpdateCalendar(): boolean {
    return this.staff.hasPermission("staff.app.calendar.manage");
  }

  setView(value: "day" | "week") {
    this.view.set(value);
    this.message.set("");
    void this.load();
  }

  setDate(value: string) {
    this.selectedDate.set(value || this.selectedDate());
    this.message.set("");
    void this.load();
  }

  shiftDate(direction: number) {
    if (!direction) return;
    this.selectedDate.set(this.addDays(this.selectedDate(), direction));
    this.message.set("");
    void this.load();
  }

  weekStart(): string {
    return this.startOfWeek(this.selectedDate());
  }

  weekEnd(): string {
    return this.addDays(this.weekStart(), 6);
  }

  daySchedules() {
    const date = this.selectedDate();
    return this.calendar()?.filter((item) => item.date === date) || [];
  }

  weekSchedules() {
    const from = this.weekStart();
    const to = this.weekEnd();
    return (this.calendar() || []).filter((item) => item.date >= from && item.date <= to);
  }

  dragSchedule(item: { id: string; version?: number; startTime: string; endTime: string }) {
    if (!this.canUpdateCalendar()) return;
    this.dragged.set({ id: item.id, version: Number(item.version || 1), startTime: item.startTime, endTime: item.endTime });
  }

  async dropSchedule(date: string) {
    if (!this.canUpdateCalendar()) return;
    const item = this.dragged();
    if (!item || !date) return;
    this.message.set("");
    try {
      await this.staff.updateSchedule(item.id, { version: item.version, scheduleDate: date, startTime: item.startTime, endTime: item.endTime });
      this.message.set("Shift moved.");
      await this.load();
    } catch {
      this.message.set(this.staff.error() || "Schedule could not be moved because of a conflict.");
    } finally {
      this.dragged.set(null);
    }
  }

  startMove(item: { id: string; date: string; startTime: string; endTime: string; version?: number }) {
    if (!this.canUpdateCalendar()) return;
    this.editingId.set(item.id);
    this.moveDate.set(item.date || this.selectedDate());
    this.moveStart.set(item.startTime || "09:00");
    this.moveEnd.set(item.endTime || "18:00");
  }

  cancelMove() {
    this.editingId.set(null);
  }

  async saveMove(item: { id: string; version?: number }) {
    const date = this.moveDate() || this.selectedDate();
    const startTime = this.moveStart() || "09:00";
    const endTime = this.moveEnd() || "18:00";
    if (endTime <= startTime) {
      this.message.set("End time must be after start time.");
      return;
    }
    this.message.set("");
    try {
      await this.staff.updateSchedule(item.id, { version: Number(item.version || 1), scheduleDate: date, startTime, endTime });
      this.message.set("Shift rescheduled.");
      this.editingId.set(null);
      await this.load();
    } catch {
      this.message.set(this.staff.error() || "Unable to update shift due to overlap or conflict.");
    }
  }

  async changeStatus(item: { id: string; version?: number; status: string }, status: string) {
    if (!this.canUpdateCalendar()) return;
    try {
      await this.staff.updateSchedule(item.id, { version: Number(item.version || 1), status });
      this.message.set(`Shift ${status}`);
      await this.load();
    } catch {
      this.message.set(this.staff.error() || "Unable to update shift status.");
    }
  }

  displayDate(value: string): string {
    const [year, month, day] = value.split("-");
    return year && month && day ? `${day}/${month}/${year}` : value || "-";
  }

  private startOfWeek(date: string): string {
    const parts = String(date || "").split("-").map((part) => Number(part));
    if (parts.length !== 3 || parts.some((part) => Number.isNaN(part))) return date;
    const current = new Date(parts[0], parts[1] - 1, parts[2]);
    const day = current.getDay();
    const diff = day === 0 ? 6 : day - 1;
    current.setDate(current.getDate() - diff);
    const month = `${current.getMonth() + 1}`.padStart(2, "0");
    const dayOfMonth = `${current.getDate()}`.padStart(2, "0");
    return `${current.getFullYear()}-${month}-${dayOfMonth}`;
  }

  private addDays(value: string, days = 0): string {
    return addBusinessDays(value, days);
  }
}
