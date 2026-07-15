import { Component, OnInit, signal } from "@angular/core";
import { StaffAppService, StaffEnterpriseOs, StaffToday } from "../../core/staff-app.service";
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
      @if (loading()) { <section staffPageState class="state" [loading]="true">Loading roster...</section> }
      @if (message()) { <section staffPageState class="notice success">{{ message() }}</section> }
      @if (staff.error()) { <section staffPageState class="notice">{{ staff.error() }}</section> }

      @if (canReadRoster() && today(); as data) {
        <section class="grid two">
          <article class="panel">
            <div class="panel-title"><h2>Today shift</h2><span>{{ data.schedules.length }}</span></div>
            <div class="list">
              @for (shift of data.schedules; track shift.id) {
                <div class="row">
                  <div class="row-main">
                    <strong>{{ shift.startTime || '-' }} - {{ shift.endTime || '-' }}</strong>
                    <small>{{ shift.scheduleDate }}</small>
                  </div>
                  <span class="badge">{{ shift.shiftType || shift.status }}</span>
                </div>
              } @empty { <p class="empty">No rostered shift found today.</p> }
            </div>
          </article>
          <article class="panel">
            <div class="panel-title"><h2>Upcoming roster</h2><span>{{ upcomingSchedules().length }}</span></div>
            <div class="list">
              @for (item of upcomingSchedules(); track item.id) {
                <div class="row">
                  <div class="row-main">
                    <strong>{{ item.date }}</strong>
                    <small>{{ item.startTime || '-' }} - {{ item.endTime || '-' }}</small>
                    <small class="muted">{{ item.type || 'roster' }}</small>
                    @if (hasConflict(item)) { <small class="badge red">Overlap warning</small> }
                  </div>
                  <div class="row-actions">
                    <span class="badge">{{ item.status }}</span>
                    @if (canUpdateRoster()) {
                      @if (editingId() !== item.id) {
                        <button class="link-button" type="button" (click)="startMove(item)">Move</button>
                        <button class="link-button" type="button" (click)="changeStatus(item, item.status === 'cancelled' ? 'scheduled' : 'cancelled')">{{ item.status === 'cancelled' ? 'Reinstate' : 'Cancel' }}</button>
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
  readonly today = signal<StaffToday | null>(null);
  readonly os = signal<StaffEnterpriseOs | null>(null);
  readonly loading = signal(false);
  readonly message = signal("");
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
    try {
      const from = this.windowStart();
      const to = this.windowEnd();
      const [today, os] = await Promise.all([
        this.staff.today(this.windowStart()),
        this.staff.enterpriseOs({ from, to })
      ]);
      this.today.set(today);
      this.os.set(os);
    } finally {
      this.loading.set(false);
    }
  }

  canReadRoster(): boolean {
    return this.staff.hasPermission("read:staff");
  }

  canUpdateRoster(): boolean {
    return this.staff.hasAnyPermission(["write:staff", "update:staff"]);
  }

  upcomingSchedules() {
    const from = this.windowStart();
    const to = this.windowEnd();
    return (this.os()?.calendar || [])
      .filter((item) => item.date >= from && item.date <= to)
      .sort((left, right) => `${left.date} ${left.startTime || "00:00"}`.localeCompare(`${right.date} ${right.startTime || "00:00"}`));
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

  private addDays(value: string, days = 0): string {
    return addBusinessDays(value, days);
  }
}
