import { Component, OnInit, signal } from "@angular/core";
import { StaffAppService, StaffRosterItem } from "../../core/staff-app.service";
import { addBusinessDays, businessDate } from "../../core/business-date";
import { StaffPageStateComponent } from "./staff-page-state.component";

@Component({
  standalone: true,
  imports: [StaffPageStateComponent],
  template: `
    <section class="page">
      <header class="page-head">
        <div>
          <p class="eyebrow">Roster</p>
          <h1>Roster</h1>
          <p>Shift and calendar assignments.</p>
        </div>
        <div class="row-actions">
          <input aria-label="Roster window start date" [value]="windowStart()" type="date" (change)="updateWindowStart($any($event.target).value)" />
          <button class="button" type="button" (click)="setWindow(7)">Next 7 days</button>
          <button class="button" type="button" (click)="setWindow(14)">Next 14 days</button>
          <button class="button" type="button" (click)="setWindow(30)">Next 30 days</button>
        </div>
      </header>

      @if (!canReadRoster()) { <section staffPageState class="notice">You do not have permission to read roster data.</section> }
      @if (loading() && !roster()) { <section staffPageState class="state" [loading]="true">Loading roster...</section> }
      @if (message()) { <section staffPageState class="notice success">{{ message() }}</section> }
      @if (loadError()) { <section staffPageState class="notice"><span>{{ loadError() }}</span><button class="link-button" type="button" (click)="load()">Retry</button></section> }

      @if (canReadRoster() && roster()) {
        <section class="grid two">
          <article class="panel">
            <div class="panel-title"><h2>Selected day</h2><span>{{ selectedSchedules().length }}</span></div>
            <div class="list">
              @for (shift of selectedSchedules(); track shift.id) {
                <div class="row">
                  <div class="row-main">
                    <strong>{{ shift.startTime || '-' }} - {{ shift.endTime || '-' }}</strong>
                    <small>{{ displayDate(shift.date) }}</small>
                  </div>
                  <span class="badge">{{ shift.type || shift.status }}</span>
                </div>
              } @empty { <p class="empty">No rostered shift found for this date.</p> }
            </div>
          </article>
          <article class="panel">
            <div class="panel-title"><h2>Upcoming roster</h2><span>{{ upcomingSchedules().length }}</span></div>
            <div class="list">
              @for (item of upcomingSchedules(); track item.id) {
                <div class="row">
                  <div class="row-main">
                    <strong>{{ displayDate(item.date) }}</strong>
                    <small>{{ item.startTime || '-' }} - {{ item.endTime || '-' }}</small>
                    <small class="muted">{{ item.type || 'roster' }}</small>
                    @if (hasConflict(item)) { <small class="badge red">Overlap warning</small> }
                  </div>
                  <div class="row-actions">
                    <span class="badge">{{ item.status }}</span>
                    @if (canUpdateRoster()) {
                      @if (editingId() !== item.id) {
                        <button class="link-button" type="button" (click)="startMove(item)">Move</button>
                        @if (item.status === 'working' || item.status === 'weekly_off' || item.status === 'not_set') {
                          <button class="link-button" type="button" (click)="changeStatus(item, item.status === 'weekly_off' ? 'working' : 'weekly_off')">{{ item.status === 'weekly_off' ? 'Reinstate' : 'Mark off' }}</button>
                        }
                      }
                    }
                  </div>
                </div>
                @if (editingId() === item.id) {
                  <div class="form-grid compact-grid">
                    <label>Date<input [value]="moveDate()" type="date" (change)="moveDate.set($any($event.target).value)" /></label>
                    <label>Start<input [value]="moveStart()" type="time" (change)="moveStart.set($any($event.target).value)" /></label>
                    <label>End<input [value]="moveEnd()" type="time" (change)="moveEnd.set($any($event.target).value)" /></label>
                    <div class="row-actions">
                      <button class="button" type="button" (click)="saveMove(item)">Save</button>
                      <button class="button" type="button" (click)="cancelMove()">Close</button>
                    </div>
                  </div>
                }
              } @empty { <p class="empty">No upcoming roster entries.</p> }
            </div>
          </article>
        </section>
      }
    </section>
  `,
  styleUrls: ["./staff-app.styles.css"]
})
export class StaffRosterPage implements OnInit {
  readonly roster = signal<StaffRosterItem[] | null>(null);
  readonly loading = signal(false);
  readonly message = signal("");
  readonly loadError = signal("");
  readonly windowStart = signal(businessDate());
  readonly windowDays = signal(14);
  readonly editingId = signal<string | null>(null);
  readonly moveDate = signal(this.windowStart());
  readonly moveStart = signal("09:00");
  readonly moveEnd = signal("18:00");

  constructor(readonly staff: StaffAppService) {}

  ngOnInit() { if (this.canReadRoster()) void this.load(); }

  async load() {
    this.loading.set(true);
    this.message.set("");
    this.loadError.set("");
    try {
      const from = this.windowStart();
      const to = this.windowEnd();
      this.roster.set(await this.staff.roster(from, to));
    } catch {
      this.loadError.set(this.staff.error() || "Unable to load roster.");
    } finally {
      this.loading.set(false);
    }
  }

  canReadRoster(): boolean {
    return this.staff.hasPermission("staff.app.roster.read");
  }

  canUpdateRoster(): boolean {
    return this.staff.hasPermission("staff.app.roster.manage");
  }

  upcomingSchedules() {
    const from = this.windowStart();
    const to = this.windowEnd();
    return (this.roster() || [])
      .filter((item) => item.date >= from && item.date <= to)
      .sort((left, right) => `${left.date} ${left.startTime || "00:00"}`.localeCompare(`${right.date} ${right.startTime || "00:00"}`));
  }

  selectedSchedules() {
    return (this.roster() || []).filter((item) => item.date === this.windowStart());
  }

  windowEnd(): string {
    return this.addDays(this.windowStart(), this.windowDays() - 1);
  }

  setWindow(days: number) {
    this.windowDays.set(days);
    void this.load();
  }

  updateWindowStart(value: string) {
    this.windowStart.set(value || this.windowStart());
    void this.load();
  }

  startMove(item: { id: string; date: string; startTime: string; endTime: string }) {
    if (!this.canUpdateRoster()) return;
    this.editingId.set(item.id);
    this.moveDate.set(item.date || this.windowStart());
    this.moveStart.set(item.startTime || "09:00");
    this.moveEnd.set(item.endTime || "18:00");
  }

  cancelMove() {
    this.editingId.set(null);
  }

  async saveMove(item: { id: string; version?: number }) {
    if (!this.canUpdateRoster()) return;
    this.message.set("");
    const date = this.moveDate() || this.windowStart();
    const startTime = this.moveStart() || "09:00";
    const endTime = this.moveEnd() || "18:00";
    if (endTime <= startTime) {
      this.message.set("End time must be after start time.");
      return;
    }
    try {
      await this.staff.updateSchedule(item.id, {
        version: Number(item.version || 1),
        scheduleDate: date,
        startTime,
        endTime
      });
      this.message.set("Shift rescheduled.");
      this.editingId.set(null);
      await this.load();
    } catch {
      this.message.set(this.staff.error() || "Unable to update shift due to overlap or conflict.");
    }
  }

  async changeStatus(item: { id: string; version?: number; status: string }, status: string) {
    if (!this.canUpdateRoster()) return;
    try {
      await this.staff.updateSchedule(item.id, { version: Number(item.version || 1), status });
      this.message.set(`Shift ${status}`);
      await this.load();
    } catch {
      this.message.set(this.staff.error() || "Unable to update shift status.");
    }
  }

  hasConflict(item: { date: string; startTime: string; endTime: string; id: string }) {
    const items = this.upcomingSchedules();
    if (!item.date || !item.startTime || !item.endTime) return false;
    for (const other of items) {
      if (other.id === item.id || other.date !== item.date) continue;
      if (!other.startTime || !other.endTime) continue;
      if (item.startTime < other.endTime && item.endTime > other.startTime) return true;
    }
    return false;
  }

  displayDate(value: string): string {
    const [year, month, day] = value.split("-");
    return year && month && day ? `${day}/${month}/${year}` : value || "-";
  }

  private addDays(value: string, days = 0): string {
    return addBusinessDays(value, days);
  }
}
