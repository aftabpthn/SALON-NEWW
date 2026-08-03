import { DatePipe } from "@angular/common";
import { Component, HostListener, OnInit, signal } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { StaffAppService, StaffRosterItem, StaffScheduleBlockout, StaffShiftSwap } from "../../core/staff-app.service";
import { addBusinessDays, businessDate } from "../../core/business-date";
import { StaffPageStateComponent } from "./staff-page-state.component";

@Component({
  standalone: true,
  imports: [DatePipe, FormsModule, StaffPageStateComponent],
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
        @if (canUpdateRoster()) {
          <section class="grid two">
            <article class="panel"><div class="panel-title"><h2>Create own schedule</h2><span>{{ displayDate(windowStart()) }}</span></div><div class="form-grid"><label>Start<input type="time" [(ngModel)]="newShiftStart" /></label><label>End<input type="time" [(ngModel)]="newShiftEnd" /></label><label>Job / role<input maxlength="100" [(ngModel)]="newShiftJob" /></label></div><div class="row-actions"><button class="button" type="button" [disabled]="savingSchedule()" (click)="createSchedule()">{{ savingSchedule() ? 'Saving...' : 'Create shift' }}</button></div></article>
            <article class="panel"><div class="panel-title"><h2>Block-out time</h2><span>{{ blockouts().length }}</span></div><div class="form-grid"><label>Start<input type="time" [(ngModel)]="blockStart" /></label><label>End<input type="time" [(ngModel)]="blockEnd" /></label><label>Reason<input maxlength="500" [(ngModel)]="blockReason" /></label></div><div class="row-actions"><button class="button" type="button" [disabled]="savingBlockout()" (click)="createBlockout()">{{ savingBlockout() ? 'Saving...' : 'Add block-out' }}</button></div><div class="list">@for (block of blockouts(); track block.id) { <div class="row"><div class="row-main"><strong>{{ block.startsAt | date:'shortTime' }} - {{ block.endsAt | date:'shortTime' }}</strong><small>{{ block.reason || 'Blocked' }}</small></div><button class="link-button" type="button" (click)="deleteBlockout(block)">Delete</button></div> } @empty { <p class="empty">No block-out time in this window.</p> }</div></article>
          </section>
        }
        <section class="panel"><div class="panel-title"><h2>Personal calendar feed</h2><span>iCal · Google · Outlook</span></div><div class="row-actions"><button class="button" type="button" (click)="createCalendarFeed()">Generate private feed</button>@if (calendarFeedUrl()) { <button class="link-button" type="button" (click)="copyCalendarFeed()">Copy link</button><button class="link-button" type="button" (click)="revokeCalendarFeed()">Revoke</button> }</div>@if (calendarFeedUrl()) { <p class="muted feed-url">{{ calendarFeedUrl() }}</p> }</section>
        <section class="panel">
          <div class="panel-title"><h2>Shift requests</h2><span>{{ shiftSwaps().length }}</span></div>
          <div class="list">
            @for (swap of shiftSwaps(); track swap.id) {
              <div class="row"><div class="row-main"><strong>{{ swap.fromStaffName }} · {{ displayDate(swap.scheduleDate) }}</strong><small>{{ swap.shift1Start || '-' }} - {{ swap.shift1End || '-' }}@if (swap.reason) { · {{ swap.reason }} }</small>@if (swap.targetDecisionNote) { <small>{{ swap.targetDecisionNote }}</small> }</div><span class="badge" [class.green]="swap.targetDecision === 'accepted'">{{ swap.targetDecision }}</span></div>
              @if (swap.status === 'pending' && swap.targetDecision === 'pending' && swap.toStaffId === staff.user()?.staffId) {
                <div class="form-grid compact-grid"><label>Decision note<textarea rows="2" maxlength="1000" [ngModel]="swapNote()" (ngModelChange)="swapNote.set($event)"></textarea></label><div class="row-actions"><button class="button" type="button" [disabled]="swapSaving() === swap.id" (click)="decideSwap(swap,'accepted')">Accept</button><button class="link-button danger" type="button" [disabled]="swapSaving() === swap.id || !swapNote().trim()" (click)="decideSwap(swap,'rejected')">Reject</button></div></div>
              }
            } @empty { <p class="empty">No shift substitution requests.</p> }
          </div>
        </section>
      }
    </section>
  `,
  styleUrls: ["./staff-app.styles.css"],
  styles: [`.feed-url { overflow-wrap: anywhere; }`]
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
  readonly blockouts = signal<StaffScheduleBlockout[]>([]);
  readonly savingSchedule = signal(false);
  readonly savingBlockout = signal(false);
  readonly calendarFeedUrl = signal("");
  readonly shiftSwaps = signal<StaffShiftSwap[]>([]);
  readonly swapSaving = signal("");
  readonly swapNote = signal("");
  newShiftStart = "09:00";
  newShiftEnd = "18:00";
  newShiftJob = "";
  blockStart = "12:00";
  blockEnd = "13:00";
  blockReason = "";

  constructor(readonly staff: StaffAppService) {}

  ngOnInit() { if (this.canReadRoster()) void this.load(); }

  @HostListener("window:aura:schedule-updated")
  onScheduleUpdated() { if (this.canReadRoster() && navigator.onLine) void this.load(); }

  async load() {
    this.loading.set(true);
    this.message.set("");
    this.loadError.set("");
    try {
      const from = this.windowStart();
      const to = this.windowEnd();
      this.roster.set(await this.staff.roster(from, to));
      try { this.shiftSwaps.set(await this.staff.shiftSwaps()); } catch { this.shiftSwaps.set([]); }
      try { this.blockouts.set(await this.staff.scheduleBlockouts(`${from}T00:00:00+05:30`, `${this.addDays(to, 1)}T00:00:00+05:30`)); }
      catch { this.blockouts.set([]); }
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

  async createSchedule() {
    if (this.savingSchedule()) return;
    if (!this.newShiftStart || this.newShiftEnd <= this.newShiftStart) { this.message.set("Shift end must be after start."); return; }
    this.savingSchedule.set(true); this.message.set("");
    try { await this.staff.createSchedule({ scheduleDate: this.windowStart(), startTime: this.newShiftStart, endTime: this.newShiftEnd, jobTitle: this.newShiftJob.trim() }); this.message.set("Shift created."); await this.load(); }
    catch { this.message.set(this.staff.error() || "Unable to create shift."); }
    finally { this.savingSchedule.set(false); }
  }

  async createBlockout() {
    if (this.savingBlockout()) return;
    if (!this.blockStart || this.blockEnd <= this.blockStart) { this.message.set("Block-out end must be after start."); return; }
    this.savingBlockout.set(true); this.message.set("");
    try { await this.staff.createScheduleBlockout({ startsAt: `${this.windowStart()}T${this.blockStart}:00+05:30`, endsAt: `${this.windowStart()}T${this.blockEnd}:00+05:30`, reason: this.blockReason.trim() }); this.blockReason = ""; this.message.set("Block-out added."); await this.load(); }
    catch { this.message.set(this.staff.error() || "Unable to create block-out."); }
    finally { this.savingBlockout.set(false); }
  }

  async deleteBlockout(block: StaffScheduleBlockout) {
    if (!confirm("Delete this block-out?")) return;
    try { await this.staff.deleteScheduleBlockout(block.id, block.version); this.message.set("Block-out deleted."); await this.load(); }
    catch { this.message.set(this.staff.error() || "Unable to delete block-out."); }
  }

  async createCalendarFeed() {
    try { const feed = await this.staff.createCalendarFeed(); this.calendarFeedUrl.set(`${window.location.origin}${feed.path}`); this.message.set("Private calendar feed generated. Regenerating revokes the old link."); }
    catch { this.message.set(this.staff.error() || "Unable to generate calendar feed."); }
  }

  async copyCalendarFeed() { await navigator.clipboard.writeText(this.calendarFeedUrl()); this.message.set("Calendar feed copied."); }
  async revokeCalendarFeed() { await this.staff.revokeCalendarFeed(); this.calendarFeedUrl.set(""); this.message.set("Calendar feed revoked."); }

  async decideSwap(swap: StaffShiftSwap, decision: "accepted" | "rejected") {
    if (this.swapSaving()) return;
    this.swapSaving.set(swap.id); this.message.set("");
    try { await this.staff.decideShiftSwap(swap.id, swap.version, decision, this.swapNote().trim()); this.swapNote.set(""); this.message.set(`Shift request ${decision}.`); await this.load(); }
    catch { this.message.set(this.staff.error() || "Unable to decide shift request."); }
    finally { this.swapSaving.set(""); }
  }

  displayDate(value: string): string {
    const [year, month, day] = value.split("-");
    return year && month && day ? `${day}/${month}/${year}` : value || "-";
  }

  private addDays(value: string, days = 0): string {
    return addBusinessDays(value, days);
  }
}
