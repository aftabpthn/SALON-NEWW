import { Component, OnInit, signal } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { IonSpinner } from "@ionic/angular/standalone";
import { StaffAppService, StaffEnterpriseOs, StaffToday } from "../../core/staff-app.service";

@Component({
  standalone: true,
  imports: [FormsModule, IonSpinner],
  template: `
    <section class="page">
      <header class="page-head">
        <div>
          <p class="eyebrow">Calendar</p>
          <h1>Calendar</h1>
          <p>Day and week staff schedule workspace.</p>
        </div>
        <div class="row-actions">
          <button class="button" [class.active-toggle]="view() === 'day'" type="button" (click)="setView('day')">Day</button>
          <button class="button" [class.active-toggle]="view() === 'week'" type="button" (click)="setView('week')">Week</button>
          <input [value]="selectedDate()" type="date" (change)="setDate($any($event.target).value)" />
          <button class="button" type="button" (click)="shiftDate(-1)">◀</button>
          <button class="button" type="button" (click)="shiftDate(1)">▶</button>
        </div>
      </header>

      @if (loading()) { <section class="state"><ion-spinner name="crescent" /> Loading calendar...</section> }
      @if (staff.error()) { <section class="notice">{{ staff.error() }}</section> }
      @if (message()) { <section class="notice" [class.success]="message().startsWith('Shift') || message().startsWith('Calendar')">{{ message() }}</section> }

      @if (canReadCalendar()) {
        @if (view() === 'day') {
          <section class="grid two">
            <article class="panel">
              <div class="panel-title"><h2>Selected day</h2><span>{{ selectedDate() }}</span></div>
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
                  <div class="row"><div class="row-main"><strong>{{ item.clientName }}</strong><small>{{ item.startAt }} · {{ item.state }}</small></div><span class="badge">{{ item.status }}</span></div>
                } @empty { <p class="empty">No appointment timeline items.</p> }
              </div>
            </article>
          </section>
        } @else {
          <section class="calendar-week">
            @for (item of weekSchedules(); track item.id) {
              <article class="panel" draggable="true" (dragstart)="dragSchedule(item)" (dragover)="$event.preventDefault()" (drop)="dropSchedule(item.date)">
                <div class="panel-title"><h2>{{ item.date || 'Scheduled' }}</h2><span>{{ item.status }}</span></div>
                <strong>{{ item.startTime || '-' }} - {{ item.endTime || '-' }}</strong>
                <p class="muted">{{ item.type || 'roster' }}</p>
                <small>{{ (item.status === 'cancelled') ? 'Cancelled shift' : 'Drag this card onto another date card to reschedule.' }}</small>
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
                      <button class="link-button" type="button" (click)="changeStatus(item, item.status === 'cancelled' ? 'scheduled' : 'cancelled')">{{ item.status === 'cancelled' ? 'Reinstate' : 'Cancel' }}</button>
                    }
                  </div>
              </article>
            } @empty { <section class="panel"><p class="empty">No upcoming calendar entries.</p></section> }
          </section>
        }
      }

      <section class="panel">
        <div class="panel-title"><h2>Quick help</h2><span>{{ canUpdateCalendar() ? 'action enabled' : 'view mode' }}</span></div>
        <small class="muted">Use Move/Cancel to adjust shifts. Drag cards in week mode for quick date-only reschedule.</small>
      </section>
    </section>
  `,
  styleUrls: ["./staff-app.styles.css"]
})
export class StaffCalendarPage implements OnInit {
  readonly os = signal<StaffEnterpriseOs | null>(null);
  readonly today = signal<StaffToday | null>(null);
  readonly loading = signal(false);
  readonly view = signal<"day" | "week">("day");
  readonly message = signal("");
  readonly selectedDate = signal(new Date().toISOString().slice(0, 10));
  readonly dragged = signal<{ id: string; version: number; startTime: string; endTime: string } | null>(null);
  readonly editingId = signal<string | null>(null);
  readonly moveDate = signal(new Date().toISOString().slice(0, 10));
  readonly moveStart = signal("09:00");
  readonly moveEnd = signal("18:00");

  constructor(readonly staff: StaffAppService) {}

  ngOnInit() { if (this.canReadCalendar()) void this.load(); }

  async load() {
    this.loading.set(true);
    try {
      const from = this.view() === "day" ? this.selectedDate() : this.weekStart();
      const to = this.view() === "day" ? this.selectedDate() : this.weekEnd();
      const [today, os] = await Promise.all([
        this.staff.today(this.selectedDate()),
        this.staff.enterpriseOs({ from, to })
      ]);
      this.today.set(today);
      this.os.set(os);
    } finally {
      this.loading.set(false);
    }
  }

  canReadCalendar(): boolean {
    return this.staff.hasPermission("read:staff");
  }

  canUpdateCalendar(): boolean {
    return this.staff.hasAnyPermission(["write:staff", "update:staff"]);
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
    return this.os()?.calendar?.filter((item) => item.date === date) || [];
  }

  weekSchedules() {
    const from = this.weekStart();
    const to = this.weekEnd();
    return (this.os()?.calendar || []).filter((item) => item.date >= from && item.date <= to);
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
    const parts = String(value || "").split("-").map((part) => Number(part));
    if (parts.length !== 3 || parts.some((part) => Number.isNaN(part))) return value;
    const date = new Date(parts[0], parts[1] - 1, parts[2]);
    date.setDate(date.getDate() + days);
    const month = `${date.getMonth() + 1}`.padStart(2, "0");
    const day = `${date.getDate()}`.padStart(2, "0");
    return `${date.getFullYear()}-${month}-${day}`;
  }
}
