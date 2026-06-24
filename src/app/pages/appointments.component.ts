import { CommonModule, DatePipe } from '@angular/common';
import { Component, OnDestroy, OnInit, computed, signal } from '@angular/core';
import { ReactiveFormsModule, UntypedFormBuilder, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { Subscription, firstValueFrom } from 'rxjs';
import { ApiRecord, ApiService } from '../core/api.service';
import { StateComponent } from '../shared/ui/state/state.component';

type CalendarView = 'day' | 'week' | 'month' | 'timeline' | 'resource' | 'queue' | 'waitlist';
type GuardLevel = 'success' | 'warning' | 'danger';
type BookingGuard = { level: GuardLevel; title: string; details: string[]; hardBlock: boolean };
type OperationInsight = { label: string; value: string; hint: string; tone: GuardLevel; status?: string };
type SmartSlot = {
  startAt: string;
  staffId: string;
  staffName: string;
  resource: string;
  score: number;
  load: number;
  reason: string;
};
type BookingSlotContext = {
  staffId: string;
  staffName: string;
  startAt: string;
  timeLabel: string;
};
type BookingServiceLine = {
  id: string;
  serviceId: string;
  staffId: string;
  startAt: string;
  durationMinutes: number;
  chair: string;
};
type CalendarDateStripDay = {
  date: Date;
  dateInput: string;
  dayNumber: string;
  weekday: string;
  bookedCount: number;
  unbilledCount: number;
  selected: boolean;
  today: boolean;
};
type StaffShiftBlock = {
  id: string;
  label: string;
  source: string;
  shiftType: string;
  top: number;
  height: number;
};
type SlotHoverContext = {
  staffId: string;
  top: number;
  label: string;
};
type SchedulerActionMenu = {
  staffId: string;
  minute: number;
  top: number;
};
type BlockTimeDrawerMode = '' | 'add' | 'remove';
type SmsRecipientTarget = 'client' | 'staff' | 'owner';
type WaitlistEntry = ApiRecord & {
  clientId: string;
  serviceId?: string;
  staffId?: string;
  preferredDate?: string;
  windowStart?: string;
  windowEnd?: string;
  priority?: number;
  status?: string;
};

const SCHEDULER_START_MINUTES = 8 * 60;
const SCHEDULER_END_MINUTES = 22 * 60;
const SCHEDULER_HEADER_HEIGHT = 74;
const STAFF_RENDER_LIMIT = 15;
const STATUS_COLUMNS = ['booked', 'arrived', 'in-service', 'completed', 'billed', 'no-show', 'cancelled'];
const VIEW_OPTIONS: { id: CalendarView; label: string }[] = [
  { id: 'day', label: 'Day' },
  { id: 'week', label: 'Week' },
  { id: 'month', label: 'Month' },
  { id: 'timeline', label: 'Timeline' },
  { id: 'resource', label: 'Resource' },
  { id: 'queue', label: 'Queue' },
  { id: 'waitlist', label: 'Waitlist' }
];

@Component({
  selector: 'app-appointments',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, RouterLink, DatePipe, StateComponent],
  template: `
    <section class="appointment-shell">
      <section class="date-strip-panel" *ngIf="viewMode() !== 'day'">
        <div class="date-strip-head">
          <button type="button" (click)="shiftSelectedMonth(-1)" aria-label="Previous month">&lt;&lt;</button>
          <strong>{{ dateStripRangeLabel() }}</strong>
          <button type="button" (click)="shiftSelectedMonth(1)" aria-label="Next month">&gt;&gt;</button>
        </div>
        <div class="month-date-strip">
          <button
            type="button"
            *ngFor="let day of calendarDateStripDays(); trackBy: trackDateStripDay"
            [class.active]="day.selected"
            [class.today]="day.today"
            (click)="jumpToStripDate(day.dateInput)"
          >
            <strong>{{ day.dayNumber }}</strong>
            <span>{{ day.weekday }}</span>
            <small>{{ day.bookedCount }}/{{ day.unbilledCount }}</small>
          </button>
        </div>
      </section>

      <div class="view-tabs">
        <button
          type="button"
          *ngFor="let option of viewOptions; trackBy: trackViewOption"
          [class.active]="viewMode() === option.id"
          (click)="viewMode.set(option.id)"
        >
          {{ option.label }}
          <span>{{ viewCount(option.id) }}</span>
        </button>
      </div>

      <div class="calendar-action-row">
        <div class="calendar-filter-row">
          <label>
            <span>Grid</span>
            <select [value]="slotMinutes()" (change)="setSlotMinutes($any($event.target).value)">
              <option value="15">15 mins</option>
              <option value="30">30 mins</option>
            </select>
          </label>
          <label>
            <span>Staff</span>
            <select [value]="staffFilter()" (change)="setStaffFilter($any($event.target).value)">
              <option value="">All staff</option>
              <option *ngFor="let person of staff(); trackBy: trackStaff" [value]="person.id">{{ person.name }}</option>
            </select>
          </label>
          <label>
            <span>Status</span>
            <select [value]="statusFilter()" (change)="statusFilter.set($any($event.target).value)">
              <option value="">All statuses</option>
              <option *ngFor="let status of statusColumns; trackBy: trackValue" [value]="status">{{ label(status) }}</option>
            </select>
          </label>
        </div>
        <div class="calendar-toolbar-actions">
          <a
            class="ghost-button link-button"
            *ngIf="lastBookedClientId()"
            [routerLink]="['/clients', lastBookedClientId()]"
          >
            Client History
          </a>
          <button class="primary-button" type="button" (click)="openWaitlistDrawer()">+ Waitlist Entry</button>
        </div>
      </div>

      <div class="appointment-command-grid" *ngIf="!loading()">
        <section class="calendar-panel smart-slot-panel">
          <div class="panel-heading">
            <div>
              <span class="eyebrow">AI slot pilot</span>
              <h3>Best safe slots</h3>
            </div>
            <small>{{ smartSlotRecommendations().length }} ranked options</small>
          </div>
          <div class="smart-slot-grid">
            <button
              type="button"
              *ngFor="let slot of smartSlotRecommendations()"
              [class.selected]="slot.startAt === form.value.startAt && slot.staffId === form.value.staffId"
              (click)="applySmartSlot(slot)"
            >
              <strong>{{ slot.startAt | date: 'h:mm a' }}</strong>
              <span>{{ slot.staffName }} · {{ slot.resource }}</span>
              <small>{{ slot.reason }}</small>
              <b>{{ slot.score }} score</b>
            </button>
            <div class="empty-state compact" *ngIf="!smartSlotRecommendations().length">Select a service and staff/date for ranked slots.</div>
          </div>
        </section>

        <section class="calendar-panel ops-pulse-panel">
          <div class="panel-heading">
            <div>
              <span class="eyebrow">Operations pulse</span>
              <h3>Today risk radar</h3>
            </div>
            <small>{{ selectedDate() | date: 'MMM d' }}</small>
          </div>
          <div class="ops-pulse-grid">
            <button type="button" *ngFor="let insight of operationInsights()" [class]="insight.tone" (click)="focusInsight(insight)">
              <span>{{ insight.label }}</span>
              <strong>{{ insight.value }}</strong>
              <small>{{ insight.hint }}</small>
            </button>
          </div>
        </section>
      </div>

      <app-state [loading]="loading()" [error]="error()"></app-state>

      <div class="appointment-kpis" *ngIf="!loading()">
        <button type="button" class="waitlist-kpi-action" (click)="openWaitlistDrawer()">
          <span>Waitlist</span>
          <strong>+</strong>
          <small>Add client entry</small>
        </button>
        <button type="button" *ngFor="let metric of metrics()" (click)="statusFilter.set(metric.status)">
          <span>{{ metric.label }}</span>
          <strong>{{ metric.value }}</strong>
          <small>{{ metric.hint }}</small>
        </button>
      </div>

      <section class="calendar-panel flow-panel" *ngIf="!loading()">
        <div class="panel-heading">
          <div>
            <span class="eyebrow">Lifecycle command board</span>
            <h3>Status handoff lanes</h3>
          </div>
          <small>{{ visibleAppointments().length }} active cards</small>
        </div>
        <div class="flow-lanes">
          <div class="flow-lane" *ngFor="let status of statusColumns; trackBy: trackValue" [class.drop-ready]="draggingId" (dragover)="allowDrop($event)" (drop)="dropStatus(status, $event)">
            <div class="flow-lane-head">
              <strong>{{ label(status) }}</strong>
              <span>{{ statusLaneAppointments(status).length }}</span>
            </div>
            <button
              type="button"
              class="flow-card"
              *ngFor="let appointment of statusLaneAppointments(status); trackBy: trackAppointment"
              draggable="true"
              (dragstart)="draggingId = appointment.id"
              (dragend)="draggingId = ''"
              (click)="openAppointment(appointment)"
            >
              <b>{{ clientName(appointment.clientId) }}</b>
              <span>{{ timeRange(appointment) }} · {{ staffName(appointment.staffId) }}</span>
            </button>
            <div class="empty-mini" *ngIf="!statusLaneAppointments(status).length">Clear</div>
          </div>
        </div>
      </section>

      <section class="calendar-panel" *ngIf="!loading() && viewMode() === 'day'">
        <div class="panel-heading day-scheduler-heading">
          <div>
            <h3>Staff day scheduler</h3>
          </div>
        </div>
        <section class="date-strip-panel scheduler-date-strip">
          <div class="date-strip-head">
            <button type="button" (click)="shiftSelectedMonth(-1)" aria-label="Previous month">&lt;&lt;</button>
            <strong>{{ dateStripRangeLabel() }}</strong>
            <button type="button" (click)="shiftSelectedMonth(1)" aria-label="Next month">&gt;&gt;</button>
          </div>
          <div class="month-date-strip">
            <button
              type="button"
              *ngFor="let day of calendarDateStripDays(); trackBy: trackDateStripDay"
              [class.active]="day.selected"
              [class.today]="day.today"
              (click)="jumpToStripDate(day.dateInput)"
            >
              <strong>{{ day.dayNumber }}</strong>
              <span>{{ day.weekday }}</span>
              <small>{{ day.bookedCount }}/{{ day.unbilledCount }}</small>
            </button>
          </div>
        </section>
        <div class="day-board-scroll" [class.many-staff]="visibleStaff().length > 8" [style.--slot-height]="slotHeightStyle()">
          <div
            class="day-board"
            [style.grid-template-columns]="dayBoardColumns()"
            [style.min-width.px]="dayBoardMinWidth()"
            [style.min-height.px]="schedulerBoardHeight()"
          >
            <div class="time-rail" [style.height.px]="schedulerBoardHeight()">
              <div class="time-head-spacer">Time</div>
              <div
                class="time-slot"
              *ngFor="let slot of schedulerSlots(); trackBy: trackSchedulerSlot"
                [class.major]="slot.major"
                [style.height.px]="slotHeight()"
              >
                <span>{{ slot.label }}</span>
              </div>
              <span
                class="current-time-badge"
                *ngIf="currentTimeVisible()"
                [style.top.px]="currentTimeTop()"
              >
                {{ currentTimeLabel() }}
              </span>
            </div>
            <div
              class="staff-lane"
              *ngFor="let person of visibleStaff(); trackBy: trackStaff"
              [style.min-height.px]="schedulerBoardHeight()"
              (click)="openQuickBookingFromLane(person, $event)"
              (mousemove)="previewSlotHover(person, $event)"
              (mouseleave)="clearSlotHover()"
              (contextmenu)="openSchedulerActionMenu(person, $event)"
              (dragover)="allowDrop($event)"
              (drop)="dropOnScheduler(person.id, $event)"
            >
              <div class="staff-head">
                <span class="avatar" [style.background]="staffAvatarColor(person)">{{ initials(person.name) }}</span>
                <div>
                  <strong>{{ person.name }}</strong>
                  <small>{{ staffLoad(person.id).booked }} booked min · {{ staffLoad(person.id).idle }} idle min</small>
                </div>
                <button class="staff-menu-button" type="button" aria-label="Staff slot actions" (click)="openSchedulerActionMenu(person, $event)">⌄</button>
              </div>
              <ng-container *ngIf="schedulerActionMenu() as menu">
                <div class="staff-action-menu" *ngIf="menu.staffId === person.id" [style.top.px]="menu.top" (click)="$event.stopPropagation()">
                  <button type="button" (click)="openAddBlockedTime(person, menu.minute)">
                    Add Blocked Time
                  </button>
                  <button type="button" (click)="openRemoveBlockedTime(person, menu.minute)">
                    Remove Blocked Time
                    <span>{{ blockedTimesForStaff(person).length }}</span>
                  </button>
                </div>
              </ng-container>
              <div
                class="shift-block"
                *ngFor="let block of shiftBlocksForStaff(person); trackBy: trackShiftBlock"
                [class.off]="block.shiftType !== 'regular'"
                [class.blocked]="isBlockedShiftType(block.shiftType)"
                [style.top.px]="block.top"
                [style.height.px]="block.height"
              >
                <strong>{{ block.label }}</strong>
                <small>{{ block.source }}</small>
              </div>
              <div
                class="slot-hover-label"
                *ngIf="slotHoverContext() as hover"
                [class.visible]="hover.staffId === person.id"
                [style.top.px]="hover.top"
              >
                {{ hover.label }}
              </div>
              <span
                class="current-time-line"
                *ngIf="currentTimeVisible()"
                [style.top.px]="currentTimeTop()"
              ></span>
              <button
                type="button"
                class="scheduler-card"
                *ngFor="let appointment of appointmentsForStaff(person.id); trackBy: trackAppointment"
                [class.late]="isLate(appointment)"
                [ngClass]="appointmentStatusTone(appointment.status)"
                [style.top.px]="appointmentTop(appointment)"
                [style.height.px]="appointmentHeight(appointment)"
                draggable="true"
                (dragstart)="startSchedulerDrag(appointment)"
                (dragend)="endSchedulerDrag()"
                (click)="openAppointment(appointment); $event.stopPropagation()"
              >
                <div class="card-top">
                  <strong>{{ timeRange(appointment) }}</strong>
                  <span class="status-pill" [class]="statusClass(appointment.status)">{{ label(appointment.status) }}</span>
                </div>
                <b>{{ clientName(appointment.clientId) }}</b>
                <span>{{ serviceNames(appointment.serviceIds) }}</span>
                <div class="badge-row">
                  <small *ngFor="let badge of appointmentBadges(appointment)" [class]="badge.variant">{{ badge.label }}</small>
                </div>
                <span class="resize-handle" (pointerdown)="startResize($event, appointment)" title="Resize booking"></span>
              </button>
              <div class="empty-lane" *ngIf="!appointmentsForStaff(person.id).length">No bookings</div>
            </div>
          </div>
        </div>
      </section>

      <section class="calendar-panel" *ngIf="!loading() && viewMode() === 'week'">
        <div class="panel-heading">
          <div>
            <span class="eyebrow">Week view</span>
            <h3>7-day booking spread</h3>
          </div>
          <small>Click any booking for full action drawer</small>
        </div>
        <div class="week-board">
          <div class="week-day" *ngFor="let day of weekDays(); trackBy: trackDateValue">
            <div class="week-head">
              <strong>{{ day | date: 'EEE' }}</strong>
              <span>{{ day | date: 'MMM d' }}</span>
            </div>
            <button type="button" class="week-booking" *ngFor="let appointment of appointmentsForDate(day); trackBy: trackAppointment" (click)="openAppointment(appointment)">
              <strong>{{ timeRange(appointment) }}</strong>
              <span>{{ clientName(appointment.clientId) }}</span>
              <small>{{ staffName(appointment.staffId) }}</small>
            </button>
            <div class="empty-mini" *ngIf="!appointmentsForDate(day).length">Free</div>
          </div>
        </div>
      </section>

      <section class="calendar-panel" *ngIf="!loading() && viewMode() === 'month'">
        <div class="panel-heading">
          <div>
            <span class="eyebrow">Month heatmap</span>
            <h3>Booking count and revenue pressure</h3>
          </div>
          <small>Color shows occupancy pressure</small>
        </div>
        <div class="month-grid">
          <button
            type="button"
            *ngFor="let day of monthDays(); trackBy: trackMonthDay"
            [class.today]="isToday(day.date)"
            [style.--heat]="day.heat"
            (click)="setSelectedDate(toDateInput(day.date)); viewMode.set('day')"
          >
            <span>{{ day.date | date: 'd' }}</span>
            <strong>{{ day.count }}</strong>
            <small>{{ currency(day.revenue) }}</small>
          </button>
        </div>
      </section>

      <section class="calendar-panel" *ngIf="!loading() && viewMode() === 'timeline'">
        <div class="panel-heading">
          <div>
            <span class="eyebrow">Timeline</span>
            <h3>Horizontal staff swimlanes</h3>
          </div>
          <small>Useful for group, bridal and parallel bookings</small>
        </div>
        <div class="timeline-board">
          <div class="timeline-row" *ngFor="let person of visibleStaff(); trackBy: trackStaff">
            <div class="timeline-staff">{{ person.name }}</div>
            <div class="timeline-track">
              <button
                type="button"
                class="timeline-item"
                *ngFor="let appointment of appointmentsForStaff(person.id); trackBy: trackAppointment"
                [style.left.%]="timelineLeft(appointment)"
                [style.width.%]="timelineWidth(appointment)"
                (click)="openAppointment(appointment)"
              >
                {{ clientName(appointment.clientId) }} · {{ timeRange(appointment) }}
              </button>
            </div>
          </div>
        </div>
      </section>

      <section class="calendar-panel" *ngIf="!loading() && viewMode() === 'resource'">
        <div class="panel-heading">
          <div>
            <span class="eyebrow">Resource view</span>
            <h3>Chair and room utilization</h3>
          </div>
          <small>{{ resources().length }} resources</small>
        </div>
        <div class="resource-grid">
          <div class="resource-card" *ngFor="let resource of resources(); trackBy: trackValue">
            <div class="resource-head">
              <strong>{{ resource }}</strong>
              <span>{{ appointmentsForResource(resource).length }}</span>
            </div>
            <button type="button" *ngFor="let appointment of appointmentsForResource(resource); trackBy: trackAppointment" (click)="openAppointment(appointment)">
              <b>{{ timeRange(appointment) }}</b>
              <span>{{ clientName(appointment.clientId) }}</span>
              <small>{{ serviceNames(appointment.serviceIds) }}</small>
            </button>
          </div>
        </div>
      </section>

      <section class="calendar-panel" *ngIf="!loading() && viewMode() === 'queue'">
        <div class="panel-heading">
          <div>
            <span class="eyebrow">Walk-in queue</span>
            <h3>Tokens and arrival desk</h3>
          </div>
          <small>{{ queueAppointments().length }} active entries</small>
        </div>
        <div class="queue-list">
          <button type="button" *ngFor="let appointment of queueAppointments(); let index = index; trackBy: trackAppointment" (click)="openAppointment(appointment)">
            <span class="token">#{{ index + 1 }}</span>
            <div>
              <strong>{{ clientName(appointment.clientId) }}</strong>
              <small>{{ staffName(appointment.staffId) }} · {{ serviceNames(appointment.serviceIds) }}</small>
            </div>
            <span class="status-pill" [class]="statusClass(appointment.status)">{{ label(appointment.status) }}</span>
          </button>
        </div>
      </section>

      <section class="calendar-panel" *ngIf="!loading() && viewMode() === 'waitlist'">
        <div class="panel-heading">
          <div>
            <span class="eyebrow">Waitlist</span>
            <h3>Recovery and no-slot opportunities</h3>
          </div>
          <button class="ghost-button mini" type="button" (click)="openWaitlistDrawer()">Add waitlist</button>
        </div>
        <div class="waitlist-list">
          <button type="button" *ngFor="let entry of waitlistEntries(); trackBy: trackWaitlistEntry">
            <div>
              <strong>{{ waitlistClientName(entry) }}</strong>
              <small>{{ waitlistServiceName(entry) }} · {{ waitlistStaffName(entry) }}</small>
            </div>
            <span>{{ waitlistWindowLabel(entry) }}</span>
          </button>
          <button type="button" *ngFor="let appointment of waitlistAppointments()" (click)="openAppointment(appointment)">
            <div>
              <strong>{{ clientName(appointment.clientId) }}</strong>
              <small>{{ appointment.source || 'front-desk' }} · {{ serviceNames(appointment.serviceIds) }}</small>
            </div>
            <span>{{ nextBestAction(appointment) }}</span>
          </button>
          <div class="empty-state" *ngIf="!waitlistEntries().length && !waitlistAppointments().length">No waitlist pressure right now.</div>
        </div>
      </section>

      <div class="drawer-backdrop" *ngIf="selectedAppointment() || bookingDrawerOpen() || blockTimeDrawerMode() || waitlistDrawerOpen()" (click)="closeAnyDrawer()"></div>

      <aside class="appointment-drawer waitlist-drawer" *ngIf="waitlistDrawerOpen()">
        <header>
          <div>
            <span class="eyebrow">Calendar waitlist</span>
            <h3>Add client to waitlist</h3>
            <p>If no slot is available, hold the client with preferred date and time.</p>
          </div>
          <button type="button" class="ghost-button mini" (click)="closeWaitlistDrawer()">Close</button>
        </header>
        <div class="drawer-body">
          <form class="drawer-booking-form" [formGroup]="waitlistForm">
            <label class="field">
              <span>Client</span>
              <select formControlName="clientId">
                <option value="">Select client</option>
                <option *ngFor="let client of clients()" [value]="client.id">{{ client.name || client.phone || client.id }}</option>
              </select>
            </label>
            <label class="field">
              <span>Service</span>
              <select formControlName="serviceId">
                <option value="">Any service</option>
                <option *ngFor="let service of services()" [value]="service.id">{{ service.name }}</option>
              </select>
            </label>
            <label class="field">
              <span>Staff</span>
              <select formControlName="staffId">
                <option value="">Any staff</option>
                <option *ngFor="let person of staff()" [value]="person.id">{{ person.name }}</option>
              </select>
            </label>
            <div class="drawer-time-grid">
              <label class="field">
                <span>Preferred date</span>
                <input type="date" formControlName="preferredDate" />
              </label>
              <label class="field">
                <span>Priority</span>
                <input type="number" formControlName="priority" min="0" />
              </label>
            </div>
            <div class="drawer-time-grid">
              <label class="field">
                <span>From</span>
                <input type="time" formControlName="windowStartTime" />
              </label>
              <label class="field">
                <span>To</span>
                <input type="time" formControlName="windowEndTime" />
              </label>
            </div>
            <div class="drawer-actions">
              <button class="primary-button" type="button" (click)="saveWaitlist()" [disabled]="waitlistSaving()">
                {{ waitlistSaving() ? 'Saving...' : 'Save waitlist' }}
              </button>
              <button class="ghost-button" type="button" (click)="viewMode.set('waitlist')">Open waitlist view</button>
            </div>
          </form>
          <p class="inline-hint success" *ngIf="waitlistMessage()">{{ waitlistMessage() }}</p>
          <p class="inline-hint danger" *ngIf="waitlistError()">{{ waitlistError() }}</p>
          <div class="waitlist-list compact-list">
            <button type="button" *ngFor="let entry of waitlistEntries(); trackBy: trackWaitlistEntry">
              <div>
                <strong>{{ waitlistClientName(entry) }}</strong>
                <small>{{ waitlistServiceName(entry) }} · {{ waitlistStaffName(entry) }}</small>
              </div>
              <span>{{ waitlistWindowLabel(entry) }}</span>
            </button>
          </div>
        </div>
      </aside>

      <aside class="appointment-drawer booking-drawer" *ngIf="bookingDrawerOpen()">
        <header>
          <div>
            <span class="eyebrow">Front-desk quick booking</span>
            <h3>{{ bookingDrawerTitle() }}</h3>
            <p>{{ bookingDrawerSubtitle() }}</p>
          </div>
          <button type="button" class="ghost-button mini" (click)="closeBookingDrawer()">Close</button>
        </header>

        <div class="drawer-body">
          <div class="slot-summary" *ngIf="bookingSlotContext() as slot">
            <div>
              <span>Staff</span>
              <strong>{{ slot.staffName }}</strong>
            </div>
            <div>
              <span>Start</span>
              <strong>{{ slot.timeLabel }}</strong>
            </div>
            <div>
              <span>End</span>
              <strong>{{ bookingEndPreview() }}</strong>
            </div>
          </div>

          <form [formGroup]="form" (ngSubmit)="save()" class="drawer-booking-form">
            <label class="field">
              <span>Client</span>
              <input
                id="appointment-client-input"
                [value]="clientSearch()"
                (input)="setClientSearch($any($event.target).value)"
                (focus)="setClientSearch(clientSearch())"
                (blur)="closeAppointmentClientSearchSoon()"
                placeholder="Search / select client"
              />
              <div class="appointment-search-results" *ngIf="showAppointmentClientResults()">
                <button
                  type="button"
                  *ngFor="let client of filteredAppointmentClients()"
                  (mousedown)="$event.preventDefault()"
                  (click)="selectAppointmentClient(client)"
                >
                  <strong>{{ client.name || client.fullName || 'Client' }}</strong>
                  <span>{{ client.phone || client.mobile || client.email || client.id }}</span>
                </button>
              </div>
            </label>

            <label class="field">
              <span>Staff</span>
              <input
                list="appointment-staff-options"
                [value]="staffSearch()"
                (input)="setStaffSearch($any($event.target).value)"
                placeholder="Search / select staff"
              />
              <datalist id="appointment-staff-options">
                <option *ngFor="let person of staff()" [value]="staffOptionLabel(person)"></option>
              </datalist>
            </label>

            <label class="field">
              <span>Branch</span>
              <select formControlName="branchId">
                <option value="">Select branch</option>
                <option *ngFor="let branch of branches()" [value]="branch.id">{{ branch.name }}</option>
              </select>
            </label>

            <div class="service-plan">
              <div class="plan-head">
                <div>
                  <span class="eyebrow">Multi-service plan</span>
                  <strong>{{ bookingServiceLines().length }} service{{ bookingServiceLines().length === 1 ? '' : 's' }}</strong>
                </div>
                <div class="plan-actions">
                  <button class="ghost-button mini" type="button" (click)="autoSequenceBookingLines()">Auto sequence</button>
                  <button class="primary-button mini" type="button" (click)="addBookingLine()">Add service</button>
                </div>
              </div>

              <div class="service-line" *ngFor="let line of bookingServiceLines(); let index = index; trackBy: trackBookingLine">
                <div class="line-number">{{ index + 1 }}</div>
                <label class="field">
                  <span>Service</span>
                  <select [value]="line.serviceId" (change)="updateBookingLine(line.id, { serviceId: $any($event.target).value })">
                    <option value="">Select service</option>
                    <option *ngFor="let service of services()" [value]="service.id">{{ service.name }} · {{ serviceDurationById(service.id) }}m</option>
                  </select>
                </label>
                <label class="field">
                  <span>Staff</span>
                  <select [value]="line.staffId" (change)="updateBookingLine(line.id, { staffId: $any($event.target).value })">
                    <option value="">Select staff</option>
                    <option *ngFor="let person of staff()" [value]="person.id">{{ person.name }}</option>
                  </select>
                </label>
                <label class="field">
                  <span>Start</span>
                  <input type="datetime-local" [value]="line.startAt" (change)="updateBookingLine(line.id, { startAt: $any($event.target).value })" />
                </label>
                <label class="field">
                  <span>Duration</span>
                  <select [value]="line.durationMinutes" (change)="updateBookingLine(line.id, { durationMinutes: $any($event.target).value })">
                    <option value="15">15 mins</option>
                    <option value="30">30 mins</option>
                    <option value="45">45 mins</option>
                    <option value="60">60 mins</option>
                    <option value="75">75 mins</option>
                    <option value="90">90 mins</option>
                    <option value="120">120 mins</option>
                    <option value="150">150 mins</option>
                    <option value="180">180 mins</option>
                  </select>
                </label>
                <label class="field">
                  <span>Chair / room</span>
                  <input [value]="line.chair" (input)="updateBookingLine(line.id, { chair: $any($event.target).value })" placeholder="Chair 1" />
                </label>
                <button class="ghost-button mini remove-line" type="button" (click)="removeBookingLine(line.id)" [disabled]="bookingServiceLines().length === 1">Remove</button>
              </div>

              <div class="quick-time-row">
                <button type="button" *ngFor="let option of quickTimeOptions()" (click)="applyQuickTime(option.minutes)">
                  {{ option.label }}
                </button>
              </div>
            </div>

            <label class="field check-line">
              <input type="checkbox" formControlName="walkIn" />
              <span>Walk-in / arrived now</span>
            </label>

            <div class="booking-guard drawer-guard" *ngIf="bookingGuard() as guard" [class.guard-danger]="guard.level === 'danger'" [class.guard-warning]="guard.level === 'warning'" [class.guard-success]="guard.level === 'success'">
              <div>
                <span class="eyebrow">Live booking guard</span>
                <strong>{{ guard.title }}</strong>
              </div>
              <ul>
                <li *ngFor="let item of guard.details">{{ item }}</li>
              </ul>
            </div>

            <div class="drawer-actions">
              <button class="primary-button" type="submit" [disabled]="form.invalid || saving() || bookingGuard().hardBlock">
                {{ saving() ? 'Creating...' : 'Create booking' }}
              </button>
              <button class="ghost-button" type="button" (click)="resetForm()">Reset</button>
            </div>
          </form>
        </div>
      </aside>

      <aside class="appointment-drawer block-time-drawer" *ngIf="blockTimeDrawerMode() === 'add'">
        <header>
          <div>
            <span class="eyebrow">Staff calendar control</span>
            <h3>New Blocked Time</h3>
            <p>Mark the staff slot unavailable. Booking guard will block appointments during this time.</p>
          </div>
          <button type="button" class="ghost-button mini" (click)="closeBlockTimeDrawer()">Close</button>
        </header>

        <div class="drawer-body">
          <label class="field">
            <span>Date*</span>
            <input type="date" [value]="blockTimeDate()" (change)="blockTimeDate.set($any($event.target).value)" />
          </label>
          <label class="field">
            <span>Staff*</span>
            <select [value]="blockTimeStaffId()" (change)="blockTimeStaffId.set($any($event.target).value)">
              <option value="">Select staff</option>
              <option *ngFor="let person of staff()" [value]="person.id">{{ person.name }}</option>
            </select>
          </label>
          <div class="block-time-grid">
            <label class="field">
              <span>Start Time*</span>
              <select [value]="blockTimeStart()" (change)="setBlockTimeStart($any($event.target).value)">
                <option *ngFor="let option of blockTimeOptions(false)" [value]="option.value">{{ option.label }}</option>
              </select>
            </label>
            <label class="field">
              <span>End Time*</span>
              <select [value]="blockTimeEnd()" (change)="blockTimeEnd.set($any($event.target).value)">
                <option *ngFor="let option of blockTimeOptions(true)" [value]="option.value">{{ option.label }}</option>
              </select>
            </label>
          </div>
          <label class="field">
            <span>Reason</span>
            <textarea [value]="blockTimeReason()" (input)="blockTimeReason.set($any($event.target).value)" placeholder="Lunch, training, break, personal work"></textarea>
          </label>
          <div class="drawer-actions">
            <button class="primary-button" type="button" (click)="saveBlockedTime()" [disabled]="!canSaveBlockedTime() || blockTimeSaving()">
              {{ blockTimeSaving() ? 'Saving...' : 'Save' }}
            </button>
          </div>
        </div>
      </aside>

      <aside class="appointment-drawer block-time-drawer" *ngIf="blockTimeDrawerMode() === 'remove'">
        <header>
          <div>
            <span class="eyebrow">Staff calendar control</span>
            <h3>Remove Blocked Time</h3>
            <p>{{ blockTimeStaffName() }} · {{ blockTimeDate() | date: 'dd-MM-yyyy' }}</p>
          </div>
          <button type="button" class="ghost-button mini" (click)="closeBlockTimeDrawer()">Close</button>
        </header>

        <div class="drawer-body">
          <table class="blocked-time-table" *ngIf="removableBlockedTimes().length; else noBlockedTimes">
            <thead>
              <tr>
                <th>Date</th>
                <th>Start Time</th>
                <th>End Time</th>
                <th>Reason</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              <tr *ngFor="let row of removableBlockedTimes(); trackBy: trackSchedule">
                <td>{{ scheduleDateDisplay(row) }}</td>
                <td>{{ displayTimeValue(row.startTime || row.start_time) }}</td>
                <td>{{ displayTimeValue(row.endTime || row.end_time) }}</td>
                <td>{{ row.notes || 'Blocked time' }}</td>
                <td>
                  <button class="danger-button mini" type="button" (click)="removeBlockedTime(row)" [disabled]="blockTimeSaving()">Remove</button>
                </td>
              </tr>
            </tbody>
          </table>
          <ng-template #noBlockedTimes>
            <div class="empty-state compact">No blocked time found for this staff and date.</div>
          </ng-template>
        </div>
      </aside>

      <aside class="appointment-drawer" *ngIf="selectedAppointment() as selected">
        <header>
          <div>
            <span class="eyebrow">Appointment desk</span>
            <h3>{{ clientName(selected.clientId) }}</h3>
            <p>{{ serviceNames(selected.serviceIds) }} with {{ staffName(selected.staffId) }}</p>
          </div>
          <button type="button" class="ghost-button mini" (click)="closeAppointment()">Close</button>
        </header>

        <div class="drawer-body">
          <div class="detail-grid">
            <div><span>Status</span><strong>{{ label(selected.status) }}</strong></div>
            <div><span>Time</span><strong>{{ selected.startAt | date: 'MMM d, h:mm a' }}</strong></div>
            <div><span>Staff</span><strong>{{ staffName(selected.staffId) }}</strong></div>
            <div><span>Chair / room</span><strong>{{ selected.chair || selected.room || 'Not assigned' }}</strong></div>
            <div><span>Source</span><strong>{{ selected.sourceChannel || selected.source || 'front-desk' }}</strong></div>
            <div><span>Payment</span><strong>{{ selected.paymentStatus || selected.depositStatus || 'pending' }}</strong></div>
          </div>

          <div class="drawer-section">
            <h4>Arrival intelligence</h4>
            <div class="mini-metrics">
              <div><span>Duration</span><strong>{{ durationMinutes(selected) }} min</strong></div>
              <div><span>Value</span><strong>{{ currency(appointmentValue(selected)) }}</strong></div>
              <div><span>Risk</span><strong>{{ appointmentRisk(selected) }}</strong></div>
            </div>
          </div>

          <div class="drawer-section">
            <h4>Intelligence badges</h4>
            <div class="badge-row big">
              <small *ngFor="let badge of appointmentBadges(selected)" [class]="badge.variant">{{ badge.label }}</small>
            </div>
          </div>

          <div class="drawer-section">
            <h4>Reschedule</h4>
            <div class="reschedule-grid">
              <input type="datetime-local" [value]="rescheduleAt()" (change)="rescheduleAt.set($any($event.target).value)" />
              <select [value]="rescheduleStaffId()" (change)="rescheduleStaffId.set($any($event.target).value)">
                <option value="">Same staff</option>
                <option *ngFor="let person of staff()" [value]="person.id">{{ person.name }}</option>
              </select>
              <button class="ghost-button" type="button" (click)="reschedule(selected)">Apply</button>
            </div>
          </div>

          <div class="drawer-section" *ngIf="touchupEligibility() as eligibility">
            <h4>Warranty / touch-up</h4>
            <p>{{ eligibility.eligible ? 'Within warranty period. Free touch-up can be booked.' : eligibility.reason || 'No active warranty.' }}</p>
            <button class="ghost-button" type="button" [disabled]="!eligibility.eligible" (click)="createTouchup(selected)">Create touch-up</button>
          </div>

          <div class="drawer-actions">
            <button class="ghost-button" type="button" (click)="runAction(selected, 'check-in')" [disabled]="isTerminal(selected)">Check in</button>
            <button class="ghost-button" type="button" (click)="runAction(selected, 'start-service')" [disabled]="isTerminal(selected)">Start service</button>
            <button class="primary-button" type="button" (click)="runAction(selected, 'complete')" [disabled]="isTerminal(selected)">Complete</button>
            <button class="ghost-button" type="button" (click)="runAction(selected, 'convert-to-sale')" [disabled]="selected.status !== 'completed'">Bill</button>
            <button class="ghost-button" type="button" (click)="runAction(selected, 'duplicate')">Duplicate</button>
            <button class="ghost-button" type="button" (click)="runAction(selected, 'no-show')" [disabled]="isTerminal(selected)">No-show</button>
            <button class="danger-button" type="button" (click)="cancel(selected)" [disabled]="isTerminal(selected)">Cancel</button>
          </div>

          <div class="drawer-section">
            <h4>WhatsApp / payment desk</h4>
            <div class="drawer-actions">
              <button class="ghost-button" type="button" (click)="copyWhatsAppDraft(selected, 'reminder')">Reminder draft</button>
              <button class="ghost-button" type="button" (click)="copyWhatsAppDraft(selected, 'payment')">Payment draft</button>
              <button class="ghost-button" type="button" (click)="copyWhatsAppDraft(selected, 'recovery')">Recovery draft</button>
            </div>
            <p *ngIf="drawerNotice()">{{ drawerNotice() }}</p>
          </div>

          <div class="drawer-section sms-desk">
            <h4>SMS service</h4>
            <div class="sms-route-grid">
              <span><strong>Client</strong>{{ smsRecipientPreview(selected, 'client') }}</span>
              <span><strong>Staff</strong>{{ smsRecipientPreview(selected, 'staff') }}</span>
              <span><strong>Owner</strong>{{ smsRecipientPreview(selected, 'owner') }}</span>
            </div>
            <div class="drawer-actions sms-actions">
              <button class="ghost-button" type="button" (click)="queueAppointmentSms(selected, 'client')" [disabled]="smsQueueTarget() === 'client'">SMS client</button>
              <button class="ghost-button" type="button" (click)="queueAppointmentSms(selected, 'staff')" [disabled]="smsQueueTarget() === 'staff'">SMS staff</button>
              <button class="primary-button" type="button" (click)="queueAppointmentSms(selected, 'owner')" [disabled]="smsQueueTarget() === 'owner'">SMS owner</button>
              <a class="ghost-button link-button" *ngIf="selected.clientId" [routerLink]="['/clients', selected.clientId]">Client History</a>
              <a class="ghost-button link-button" routerLink="/staff" [queryParams]="{ q: staffName(selected.staffId) }">Staff page</a>
              <a class="ghost-button link-button" routerLink="/business-details">SMS settings</a>
            </div>
          </div>

          <div class="drawer-section">
            <h4>Audit timeline</h4>
            <div class="audit-list" *ngIf="!auditLoading(); else auditBusy">
              <div *ngFor="let event of appointmentAudit()">
                <strong>{{ auditActionLabel(event) }}</strong>
                <small>{{ auditTimestamp(event) | date: 'MMM d, h:mm a' }}</small>
                <span>{{ auditDetails(event) }}</span>
              </div>
              <div class="empty-mini" *ngIf="!appointmentAudit().length">No audit events yet</div>
            </div>
            <ng-template #auditBusy><p>Loading audit trail...</p></ng-template>
          </div>

          <div class="drawer-section">
            <h4>Notes</h4>
            <p>{{ selected.notes || 'No notes saved for this appointment.' }}</p>
          </div>
        </div>
      </aside>
    </section>
  `,
  styles: [`
    .appointment-shell {
      display: grid;
      gap: 14px;
    }

    .calendar-action-row,
    .calendar-panel,
    .appointment-drawer,
    .appointment-kpis button {
      border: 1px solid var(--line);
      border-radius: 10px;
      background: var(--surface);
      box-shadow: 0 10px 24px rgba(23, 32, 45, 0.05);
    }

    .panel-heading h3,
    .appointment-drawer h3 {
      margin: 0;
      color: var(--ink);
    }

    .appointment-drawer p,
    .drawer-section p {
      margin: 6px 0 0;
      color: var(--muted);
      max-width: 720px;
    }

    .calendar-action-buttons,
    .panel-heading,
    .card-top,
    .resource-head,
    .drawer-actions,
    .badge-row,
    .reschedule-grid {
      display: flex;
      align-items: center;
      gap: 10px;
    }

    .calendar-action-row {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      align-items: end;
      gap: 12px;
      padding: 10px 12px;
    }

    .calendar-filter-row {
      display: grid;
      grid-template-columns: 130px minmax(190px, 260px) minmax(160px, 220px);
      gap: 10px;
      align-items: end;
    }

    .calendar-action-buttons {
      justify-content: flex-end;
      flex-wrap: wrap;
    }

    .calendar-toolbar-actions {
      display: flex;
      justify-content: flex-end;
      align-items: end;
      gap: 8px;
    }

    .calendar-filter-row label,
    .field {
      display: grid;
      gap: 4px;
    }

    .calendar-filter-row span,
    .field span,
    .slot-summary span,
    .detail-grid span {
      color: var(--muted);
      font-size: 0.72rem;
      font-weight: 800;
      text-transform: uppercase;
    }

    input,
    select {
      min-height: 36px;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: #fff;
      padding: 0 10px;
      color: var(--ink);
    }

    .view-tabs {
      display: flex;
      gap: 6px;
      overflow-x: auto;
      padding-bottom: 2px;
    }

    .date-strip-panel {
      display: grid;
      grid-template-columns: auto minmax(0, 1fr);
      gap: 10px;
      align-items: stretch;
      border: 1px solid var(--line);
      border-radius: 10px;
      background: var(--surface);
      padding: 8px;
      box-shadow: 0 10px 24px rgba(23, 32, 45, 0.05);
    }

    .scheduler-date-strip {
      margin-bottom: 12px;
      box-shadow: none;
    }

    .date-strip-head {
      display: grid;
      grid-template-columns: 34px minmax(170px, auto) 34px;
      align-items: center;
      gap: 6px;
      white-space: nowrap;
    }

    .date-strip-head button,
    .month-date-strip button {
      border: 1px solid var(--line);
      border-radius: 8px;
      background: #fff;
      color: var(--ink);
      font-weight: 900;
    }

    .month-date-strip {
      display: grid;
      grid-auto-flow: column;
      grid-auto-columns: minmax(46px, 1fr);
      gap: 4px;
      overflow-x: auto;
    }

    .month-date-strip button {
      min-height: 54px;
      display: grid;
      place-items: center;
      gap: 1px;
      padding: 4px 5px;
    }

    .month-date-strip button.active {
      border-color: var(--teal);
      background: #e6f7f3;
      color: var(--teal-2);
      box-shadow: inset 0 -3px 0 var(--teal);
    }

    .month-date-strip button.today:not(.active) {
      border-color: rgba(15, 118, 110, 0.34);
    }

    .month-date-strip span,
    .month-date-strip small {
      color: var(--muted);
      font-size: 0.66rem;
      line-height: 1;
    }

    .view-tabs button {
      min-height: 34px;
      display: inline-flex;
      align-items: center;
      gap: 8px;
      border: 1px solid var(--line);
      border-radius: 999px;
      background: #fff;
      color: var(--muted);
      padding: 0 12px;
      font-weight: 800;
    }

    .view-tabs button.active {
      color: #fff;
      border-color: var(--teal);
      background: var(--teal);
    }

    .view-tabs span {
      min-width: 22px;
      border-radius: 999px;
      background: rgba(255, 255, 255, 0.22);
      padding: 1px 6px;
      font-size: 0.72rem;
    }

    .booking-guard,
    .appointment-command-grid {
      display: grid;
      gap: 12px;
    }

    .booking-guard {
      grid-template-columns: minmax(220px, 0.3fr) minmax(0, 1fr);
      align-items: center;
      border: 1px solid var(--line);
      border-radius: 10px;
      background: #f8fbfb;
      padding: 12px 14px;
    }

    .booking-guard strong {
      display: block;
      color: var(--ink);
      margin-top: 3px;
    }

    .booking-guard ul {
      margin: 0;
      padding-left: 18px;
      color: var(--muted);
      line-height: 1.55;
    }

    .booking-guard.guard-success {
      border-color: rgba(22, 163, 74, 0.3);
      background: #f1fbf5;
    }

    .booking-guard.guard-warning {
      border-color: rgba(217, 119, 6, 0.32);
      background: #fff9ea;
    }

    .booking-guard.guard-danger {
      border-color: rgba(180, 35, 24, 0.34);
      background: #fff2ed;
    }

    .appointment-command-grid {
      grid-template-columns: minmax(420px, 1.1fr) minmax(360px, 0.9fr);
      align-items: stretch;
    }

    .smart-slot-panel,
    .ops-pulse-panel {
      min-height: 100%;
    }

    .smart-slot-grid,
    .ops-pulse-grid {
      display: grid;
      gap: 8px;
    }

    .smart-slot-grid {
      grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
    }

    .smart-slot-grid button,
    .ops-pulse-grid button,
    .flow-card {
      border: 1px solid var(--line);
      border-radius: 9px;
      background: #fff;
      color: var(--ink);
      padding: 10px;
      text-align: left;
    }

    .smart-slot-grid button {
      display: grid;
      gap: 4px;
    }

    .smart-slot-grid button.selected {
      border-color: var(--teal);
      background: #e7f7f2;
      box-shadow: 0 0 0 2px rgba(15, 118, 110, 0.12);
    }

    .smart-slot-grid button b {
      color: var(--teal-2);
      font-size: 0.78rem;
    }

    .smart-slot-grid small,
    .ops-pulse-grid small,
    .flow-card span,
    .audit-list small,
    .audit-list span {
      color: var(--muted);
      line-height: 1.3;
    }

    .ops-pulse-grid {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }

    .ops-pulse-grid button {
      min-height: 86px;
      display: grid;
      gap: 3px;
    }

    .ops-pulse-grid button.success {
      border-color: rgba(22, 163, 74, 0.28);
      background: #f1fbf5;
    }

    .ops-pulse-grid button.warning {
      border-color: rgba(217, 119, 6, 0.32);
      background: #fff9ea;
    }

    .ops-pulse-grid button.danger {
      border-color: rgba(180, 35, 24, 0.32);
      background: #fff2ed;
    }

    .check-line {
      display: flex;
      align-items: center;
      min-height: 36px;
    }

    .appointment-kpis {
      display: grid;
      grid-template-columns: repeat(6, minmax(120px, 1fr));
      gap: 10px;
    }

    .appointment-kpis button {
      min-height: 74px;
      display: grid;
      justify-items: start;
      gap: 2px;
      padding: 10px 12px;
      text-align: left;
    }

    .appointment-kpis span,
    .eyebrow {
      color: var(--blue);
      font-size: 0.72rem;
      font-weight: 900;
      letter-spacing: 0.04em;
      text-transform: uppercase;
    }

    .appointment-kpis strong {
      font-size: 1.45rem;
      line-height: 1;
    }

    .appointment-kpis .waitlist-kpi-action {
      border-color: rgba(15, 118, 110, 0.34);
      background: linear-gradient(135deg, #ecfdf5, #ffffff);
    }

    .appointment-kpis .waitlist-kpi-action span,
    .appointment-kpis .waitlist-kpi-action strong {
      color: var(--teal-2);
    }

    .appointment-kpis small {
      font-size: 0.78rem;
    }

    .flow-panel {
      overflow: hidden;
    }

    .flow-lanes {
      display: grid;
      grid-template-columns: repeat(7, minmax(150px, 1fr));
      gap: 8px;
      overflow-x: auto;
      padding-bottom: 2px;
    }

    .flow-lane {
      min-height: 150px;
      display: grid;
      align-content: start;
      gap: 8px;
      border: 1px dashed var(--line);
      border-radius: 10px;
      background: #fbfdfd;
      padding: 9px;
    }

    .flow-lane.drop-ready {
      border-color: var(--teal);
      background: #f1fbf8;
    }

    .flow-lane-head {
      display: flex;
      justify-content: space-between;
      gap: 8px;
      align-items: center;
      padding-bottom: 7px;
      border-bottom: 1px solid var(--line);
    }

    .flow-lane-head span {
      border-radius: 999px;
      background: #edf4f4;
      padding: 2px 8px;
      font-weight: 900;
    }

    .flow-card {
      display: grid;
      gap: 3px;
      cursor: grab;
    }

    .flow-card:active {
      cursor: grabbing;
    }

    .calendar-panel {
      padding: 14px;
      min-width: 0;
    }

    .panel-heading {
      justify-content: space-between;
      padding-bottom: 10px;
      border-bottom: 1px solid var(--line);
      margin-bottom: 12px;
    }

    .scheduler-toolbar {
      display: grid;
      grid-template-columns: repeat(3, minmax(140px, 1fr)) minmax(220px, auto);
      gap: 8px;
      margin-bottom: 10px;
    }

    .day-scheduler-heading {
      margin-top: 2px;
      margin-bottom: 8px;
      padding-bottom: 8px;
    }

    .staff-window-controls {
      display: flex;
      align-items: center;
      justify-content: flex-end;
      gap: 8px;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: #fff;
      padding: 8px 10px;
      color: var(--muted);
      font-size: 0.78rem;
      font-weight: 900;
      white-space: nowrap;
    }

    .staff-window-controls button {
      min-width: 34px;
      min-height: 30px;
      border: 1px solid var(--line);
      border-radius: 7px;
      background: #f8fafc;
      color: var(--ink);
      font-weight: 900;
    }

    .staff-window-controls button:disabled {
      opacity: 0.45;
      cursor: not-allowed;
    }

    .scheduler-chip {
      min-height: 46px;
      display: grid;
      gap: 2px;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: #fbfdfd;
      padding: 8px 10px;
    }

    .scheduler-chip strong {
      color: var(--ink);
      line-height: 1;
    }

    .scheduler-chip span {
      color: var(--muted);
      font-size: 0.72rem;
      font-weight: 800;
      text-transform: uppercase;
    }

    .day-board-scroll {
      --slot-height: 36px;
      width: 100%;
      max-width: 100%;
      min-height: 680px;
      max-height: calc(100vh - 286px);
      overflow: auto;
      border: 1px solid var(--line);
      border-radius: 10px;
      background: #fff;
    }

    .day-board {
      display: grid;
      grid-template-columns: 72px repeat(1, minmax(180px, 1fr));
      align-items: start;
      width: 100%;
      min-width: 100%;
      position: relative;
    }

    .time-rail {
      display: block;
      border-right: 1px solid var(--line);
      background: #f8fbfb;
      position: sticky;
      left: 0;
      z-index: 10;
    }

    .time-head-spacer {
      height: 74px;
      display: grid;
      place-items: center;
      position: sticky;
      top: 0;
      z-index: 11;
      border-bottom: 1px solid var(--line);
      background: #fff;
      color: var(--muted);
      font-size: 0.72rem;
      font-weight: 900;
      text-transform: uppercase;
    }

    .time-slot {
      position: relative;
      border-bottom: 1px solid rgba(99, 112, 131, 0.16);
    }

    .time-slot.major {
      border-bottom-color: rgba(23, 32, 45, 0.34);
    }

    .time-slot span {
      display: flex;
      justify-content: flex-end;
      padding: 4px 8px 0 0;
      color: var(--muted);
      font-size: 0.68rem;
      font-weight: 800;
    }

    .current-time-badge {
      position: absolute;
      left: 7px;
      z-index: 12;
      transform: translateY(-50%);
      border: 1px solid #ff2f2f;
      border-radius: 999px;
      background: #fff;
      color: #f02b2b;
      padding: 2px 7px;
      font-size: 0.68rem;
      font-weight: 900;
    }

    .staff-lane {
      position: relative;
      min-width: 0;
      border-right: 1px solid var(--line);
      background:
        linear-gradient(#fff, #fff) 0 0 / 100% 74px no-repeat,
        repeating-linear-gradient(
          to bottom,
          rgba(255, 255, 255, 0.96) 0,
          rgba(255, 255, 255, 0.96) calc(var(--slot-height) - 1px),
          rgba(99, 112, 131, 0.16) var(--slot-height)
        );
      overflow: visible;
    }

    .shift-block {
      position: absolute;
      left: 0;
      right: 0;
      z-index: 2;
      display: grid;
      place-items: center;
      gap: 2px;
      border: 1px solid rgba(217, 119, 6, 0.18);
      background: rgba(252, 211, 160, 0.66);
      color: #5f3208;
      pointer-events: none;
      text-align: center;
      overflow: hidden;
    }

    .shift-block.off {
      border-color: rgba(100, 116, 139, 0.24);
      background: rgba(226, 232, 240, 0.74);
      color: var(--muted);
    }

    .shift-block.blocked {
      border-color: rgba(100, 116, 139, 0.42);
      background: rgba(31, 41, 55, 0.16);
      color: #1f2937;
    }

    .shift-block strong {
      font-size: 0.86rem;
      line-height: 1;
    }

    .shift-block small {
      max-width: 96%;
      overflow: hidden;
      color: inherit;
      font-size: 0.64rem;
      line-height: 1;
      text-overflow: ellipsis;
      white-space: nowrap;
      opacity: 0.76;
    }

    .slot-hover-label {
      display: none;
      position: absolute;
      left: 10px;
      z-index: 6;
      transform: translateY(-50%);
      max-width: calc(100% - 20px);
      overflow: hidden;
      border: 1px solid rgba(15, 118, 110, 0.36);
      border-radius: 4px;
      background: #fffbe8;
      color: var(--ink);
      padding: 2px 6px;
      font-size: 0.72rem;
      font-weight: 800;
      white-space: nowrap;
      text-overflow: ellipsis;
      pointer-events: none;
    }

    .slot-hover-label.visible {
      display: block;
    }

    .staff-head {
      position: sticky;
      top: 0;
      z-index: 7;
      height: 74px;
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px;
      border-bottom: 1px solid var(--line);
      background: #fff;
      overflow: hidden;
    }

    .current-time-line {
      position: absolute;
      left: 0;
      right: 0;
      z-index: 3;
      height: 2px;
      background: #ff2f2f;
      box-shadow: 0 0 0 1px rgba(255, 47, 47, 0.1);
      pointer-events: none;
    }

    .current-time-line::before {
      content: '';
      position: absolute;
      left: -4px;
      top: -4px;
      width: 10px;
      height: 10px;
      border-radius: 999px;
      background: #ff2f2f;
    }

    .staff-head > div {
      min-width: 0;
    }

    .staff-head strong,
    .staff-head small {
      display: block;
    }

    .staff-head strong {
      max-width: 158px;
      overflow: hidden;
      display: -webkit-box;
      -webkit-box-orient: vertical;
      -webkit-line-clamp: 2;
      line-height: 1.15;
    }

    .day-board-scroll.many-staff .staff-head {
      justify-content: center;
      padding: 6px 4px;
      text-align: center;
    }

    .day-board-scroll.many-staff .staff-head > div {
      display: grid;
      gap: 2px;
      justify-items: center;
    }

    .day-board-scroll.many-staff .staff-head strong {
      max-width: 92px;
      font-size: 0.72rem;
      line-height: 1.1;
    }

    .day-board-scroll.many-staff .staff-head small {
      display: none;
    }

    .day-board-scroll.many-staff .avatar {
      width: 24px;
      height: 24px;
      font-size: 0.68rem;
    }

    .staff-head small {
      white-space: normal;
      line-height: 1.2;
    }

    .staff-menu-button {
      width: 24px;
      height: 24px;
      display: grid;
      place-items: center;
      margin-left: auto;
      border: 1px solid var(--line);
      border-radius: 999px;
      background: #fff;
      color: var(--ink);
      font-size: 0.9rem;
      font-weight: 900;
      line-height: 1;
      flex: 0 0 auto;
    }

    .staff-action-menu {
      position: absolute;
      left: 10px;
      z-index: 30;
      width: max-content;
      min-width: 176px;
      overflow: hidden;
      border: 1px solid var(--line);
      border-radius: 9px;
      background: #fff;
      box-shadow: 0 18px 40px rgba(23, 32, 45, 0.18);
    }

    .staff-action-menu button {
      width: 100%;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      border: 0;
      border-bottom: 1px solid rgba(99, 112, 131, 0.12);
      border-radius: 0;
      background: #fff;
      color: var(--ink);
      padding: 12px 14px;
      text-align: left;
      font-weight: 850;
    }

    .staff-action-menu button:hover {
      background: #f1fbf8;
      color: var(--teal-2);
    }

    .staff-action-menu span {
      min-width: 22px;
      border-radius: 999px;
      background: #e6f7f3;
      color: var(--teal-2);
      padding: 1px 7px;
      text-align: center;
      font-size: 0.72rem;
      font-weight: 900;
    }

    .avatar,
    .token {
      width: 30px;
      height: 30px;
      display: grid;
      place-items: center;
      border-radius: 999px;
      background: #d9f3ef;
      color: var(--teal-2);
      font-weight: 900;
      flex: 0 0 auto;
    }

    .appointment-card,
    .week-booking,
    .resource-card button,
    .queue-list button,
    .waitlist-list button {
      width: 100%;
      border: 1px solid rgba(15, 118, 110, 0.24);
      border-radius: 8px;
      background: #d4f1e8;
      color: var(--ink);
      padding: 9px;
      text-align: left;
      transition: 140ms ease;
    }

    .appointment-card {
      display: grid;
      gap: 5px;
      margin-bottom: 8px;
    }

    .scheduler-card {
      position: absolute;
      left: 7px;
      right: 7px;
      z-index: 5;
      min-height: 32px;
      display: grid;
      align-content: start;
      gap: 4px;
      overflow: hidden;
      border: 1px solid rgba(79, 99, 215, 0.4);
      border-left-width: 4px;
      border-radius: 8px;
      background: #e5ebff;
      color: var(--ink);
      padding: 7px 8px 12px;
      text-align: left;
      box-shadow: 0 10px 22px rgba(23, 32, 45, 0.12);
      cursor: grab;
    }

    .scheduler-card:active {
      cursor: grabbing;
    }

    .scheduler-card.tone-booked {
      border-color: rgba(79, 99, 215, 0.55);
      background: #dfe7ff;
    }

    .scheduler-card.tone-arrived,
    .scheduler-card.tone-waiting {
      border-color: rgba(15, 159, 146, 0.5);
      background: #dbf7f2;
    }

    .scheduler-card.tone-in-service {
      border-color: rgba(22, 163, 74, 0.5);
      background: #dcfce7;
    }

    .scheduler-card.tone-completed,
    .scheduler-card.tone-billed,
    .scheduler-card.tone-paid {
      border-color: rgba(100, 116, 139, 0.45);
      background: #eef3f2;
    }

    .scheduler-card.tone-no-show {
      border-color: rgba(245, 158, 11, 0.58);
      background: #fff0c7;
    }

    .scheduler-card.tone-cancelled {
      border-color: rgba(239, 68, 68, 0.58);
      background: #ffe1dc;
      opacity: 0.8;
    }

    .scheduler-card.tone-rescheduled {
      border-color: rgba(124, 58, 237, 0.48);
      background: #efe7ff;
    }

    .scheduler-card b,
    .scheduler-card span {
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .scheduler-card > span:not(.status-pill):not(.resize-handle) {
      white-space: nowrap;
    }

    .scheduler-card .card-top {
      min-width: 0;
      gap: 5px;
    }

    .scheduler-card .card-top strong {
      font-size: 0.73rem;
      white-space: nowrap;
    }

    .scheduler-card .status-pill {
      flex: 0 0 auto;
    }

    .scheduler-card .badge-row {
      max-height: 22px;
      overflow: hidden;
    }

    .resize-handle {
      position: absolute;
      left: 24px;
      right: 24px;
      bottom: 2px;
      height: 8px;
      cursor: ns-resize;
    }

    .resize-handle::before {
      content: '';
      position: absolute;
      left: 50%;
      bottom: 2px;
      width: 34px;
      height: 3px;
      border-radius: 999px;
      background: rgba(23, 32, 45, 0.32);
      transform: translateX(-50%);
    }

    .appointment-card:hover,
    .scheduler-card:hover,
    .week-booking:hover,
    .resource-card button:hover,
    .queue-list button:hover,
    .waitlist-list button:hover {
      transform: translateY(-1px);
      box-shadow: 0 12px 22px rgba(15, 118, 110, 0.12);
    }

    .appointment-card.late {
      border-color: rgba(180, 35, 24, 0.38);
      background: #fff0ec;
    }

    .card-top,
    .resource-head {
      justify-content: space-between;
    }

    .status-pill,
    .badge-row small {
      display: inline-flex;
      align-items: center;
      width: fit-content;
      border-radius: 999px;
      padding: 2px 7px;
      font-size: 0.68rem;
      font-weight: 900;
      text-transform: uppercase;
    }

    .status-booked,
    .badge-info {
      background: #e7efff;
      color: var(--blue);
    }

    .status-arrived,
    .status-in-service,
    .badge-success {
      background: #e8f7ef;
      color: var(--green);
    }

    .status-completed,
    .status-billed,
    .status-paid {
      background: #eef3f2;
      color: var(--teal-2);
    }

    .status-no-show,
    .badge-warning {
      background: #fff5df;
      color: var(--amber);
    }

    .status-cancelled,
    .badge-danger {
      background: #ffe8e2;
      color: var(--red);
    }

    .badge-primary {
      background: #ede9fe;
      color: var(--violet);
    }

    .badge-row {
      flex-wrap: wrap;
      gap: 5px;
    }

    .badge-row.big {
      padding-top: 8px;
    }

    .empty-lane,
    .empty-mini,
    .empty-state {
      display: grid;
      place-items: center;
      min-height: 82px;
      border: 1px dashed var(--line);
      border-radius: 8px;
      color: var(--muted);
      background: rgba(255, 255, 255, 0.72);
    }

    .empty-lane {
      min-height: 94px;
      position: relative;
      z-index: 2;
      margin: 12px 8px 0;
    }

    .week-board,
    .resource-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
      gap: 10px;
    }

    .week-day,
    .resource-card {
      display: grid;
      align-content: start;
      gap: 8px;
      min-height: 270px;
      border: 1px solid var(--line);
      border-radius: 10px;
      background: #fbfdfd;
      padding: 10px;
    }

    .week-head {
      display: flex;
      justify-content: space-between;
      color: var(--muted);
      padding-bottom: 6px;
      border-bottom: 1px solid var(--line);
    }

    .month-grid {
      display: grid;
      grid-template-columns: repeat(7, minmax(92px, 1fr));
      gap: 8px;
    }

    .month-grid button {
      min-height: 84px;
      display: grid;
      justify-items: start;
      gap: 2px;
      border: 1px solid var(--line);
      border-radius: 10px;
      background: linear-gradient(135deg, rgba(15, 118, 110, calc(var(--heat) * 0.13)), #fff);
      padding: 10px;
      text-align: left;
    }

    .month-grid button.today {
      outline: 2px solid var(--teal);
    }

    .month-grid strong {
      font-size: 1.35rem;
    }

    .timeline-board {
      display: grid;
      gap: 8px;
      overflow-x: auto;
    }

    .timeline-row {
      display: grid;
      grid-template-columns: 180px minmax(760px, 1fr);
      align-items: center;
      min-height: 52px;
    }

    .timeline-staff {
      font-weight: 900;
    }

    .timeline-track {
      position: relative;
      height: 42px;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: repeating-linear-gradient(to right, #fff 0, #fff 74px, rgba(99, 112, 131, 0.18) 75px);
    }

    .timeline-item {
      position: absolute;
      top: 6px;
      height: 28px;
      overflow: hidden;
      border: 0;
      border-radius: 7px;
      background: var(--teal);
      color: #fff;
      padding: 0 8px;
      white-space: nowrap;
      text-overflow: ellipsis;
    }

    .resource-card {
      min-height: 210px;
    }

    .resource-head {
      padding-bottom: 8px;
      border-bottom: 1px solid var(--line);
    }

    .resource-head span {
      border-radius: 999px;
      background: #e6eeee;
      padding: 2px 8px;
      font-weight: 900;
    }

    .queue-list,
    .waitlist-list {
      display: grid;
      gap: 8px;
    }

    .queue-list button,
    .waitlist-list button {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      background: #fff;
      border-color: var(--line);
    }

    .waitlist-drawer {
      width: min(560px, 100vw);
    }

    .compact-list button {
      min-height: 62px;
    }

    .drawer-backdrop {
      position: fixed;
      inset: 0;
      z-index: 70;
      background: rgba(23, 32, 45, 0.42);
    }

    .appointment-drawer {
      position: fixed;
      top: 0;
      right: 0;
      z-index: 80;
      width: min(560px, 100vw);
      height: 100vh;
      display: flex;
      flex-direction: column;
      border-radius: 0;
      overflow: hidden;
    }

    .appointment-drawer header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 12px;
      padding: 16px;
      border-bottom: 1px solid var(--line);
    }

    .appointment-drawer header > button {
      flex: 0 0 auto;
      min-height: 38px;
      align-self: flex-start;
      white-space: nowrap;
    }

    .drawer-body {
      display: grid;
      gap: 14px;
      overflow-y: auto;
      overflow-x: hidden;
      padding: 16px;
    }

    .booking-drawer {
      width: min(760px, calc(100vw - 72px));
    }

    .block-time-drawer {
      width: min(520px, 100vw);
    }

    textarea {
      min-height: 78px;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: #fff;
      padding: 10px;
      color: var(--ink);
      resize: vertical;
    }

    .block-time-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 10px;
    }

    .blocked-time-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.88rem;
    }

    .blocked-time-table th,
    .blocked-time-table td {
      border-bottom: 1px solid var(--line);
      padding: 10px 8px;
      text-align: left;
      vertical-align: top;
    }

    .blocked-time-table th {
      color: var(--muted);
      font-size: 0.72rem;
      font-weight: 900;
      text-transform: uppercase;
    }

    .slot-summary {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 8px;
    }

    .slot-summary div {
      border: 1px solid rgba(15, 118, 110, 0.18);
      border-radius: 9px;
      background: #effaf7;
      padding: 10px;
    }

    .drawer-booking-form {
      display: grid;
      gap: 12px;
    }

    .drawer-booking-form input,
    .drawer-booking-form select {
      width: 100%;
      min-width: 0;
    }

    .drawer-booking-form .field {
      position: relative;
    }

    .appointment-search-results {
      position: absolute;
      z-index: 90;
      top: calc(100% + 6px);
      left: 0;
      right: 0;
      display: grid;
      max-height: 240px;
      overflow: auto;
      border: 1px solid var(--line);
      border-radius: 10px;
      background: #fff;
      box-shadow: 0 18px 34px rgba(15, 23, 42, 0.16);
      padding: 6px;
    }

    .appointment-search-results button {
      display: grid;
      gap: 2px;
      width: 100%;
      border: 0;
      border-radius: 8px;
      background: transparent;
      padding: 8px 10px;
      color: var(--ink);
      text-align: left;
      cursor: pointer;
    }

    .appointment-search-results button:hover {
      background: #effaf7;
    }

    .appointment-search-results strong {
      font-size: 13px;
    }

    .appointment-search-results span {
      color: var(--muted);
      font-size: 12px;
      font-weight: 700;
      text-transform: none;
    }

    .drawer-time-grid {
      display: grid;
      grid-template-columns: minmax(0, 1.4fr) minmax(130px, 0.6fr);
      gap: 10px;
    }

    .service-plan {
      display: grid;
      gap: 10px;
      border: 1px solid var(--line);
      border-radius: 10px;
      background: #fbfdfd;
      padding: 10px;
    }

    .plan-head,
    .plan-actions {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      flex-wrap: wrap;
    }

    .service-line {
      display: grid;
      grid-template-columns: 28px minmax(0, 1.15fr) minmax(0, 1fr);
      grid-template-areas:
        "num service service"
        ". staff start"
        ". duration chair"
        ". remove remove";
      gap: 10px;
      align-items: end;
      border-top: 1px solid rgba(100, 116, 139, 0.16);
      padding-top: 10px;
    }

    .line-number {
      grid-area: num;
      align-self: center;
      color: var(--teal-2);
      font-weight: 900;
    }

    .service-line .field {
      min-width: 0;
    }

    .service-line .field:nth-of-type(1) {
      grid-area: service;
    }

    .service-line .field:nth-of-type(2) {
      grid-area: staff;
    }

    .service-line .field:nth-of-type(3) {
      grid-area: start;
    }

    .service-line .field:nth-of-type(4) {
      grid-area: duration;
    }

    .service-line .field:nth-of-type(5) {
      grid-area: chair;
    }

    .remove-line {
      grid-area: remove;
      align-self: end;
      justify-self: end;
    }

    .quick-time-row {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }

    .quick-time-row button {
      min-height: 32px;
      border: 1px solid rgba(15, 118, 110, 0.22);
      border-radius: 999px;
      background: #f3fbf8;
      color: var(--teal-2);
      padding: 0 12px;
    }

    .drawer-guard {
      grid-template-columns: 1fr;
    }

    .detail-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 10px;
    }

    .mini-metrics {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 8px;
    }

    .mini-metrics div {
      border: 1px solid var(--line);
      border-radius: 8px;
      background: #fbfdfd;
      padding: 8px;
    }

    .detail-grid div,
    .drawer-section {
      border: 1px solid var(--line);
      border-radius: 9px;
      background: #fff;
      padding: 10px;
    }

    .detail-grid strong,
    .slot-summary strong {
      display: block;
      margin-top: 4px;
    }

    .drawer-section h4 {
      margin: 0 0 6px;
    }

    .reschedule-grid {
      align-items: stretch;
    }

    .reschedule-grid input,
    .reschedule-grid select {
      min-width: 0;
      flex: 1;
    }

    .drawer-actions {
      flex-wrap: wrap;
      align-items: stretch;
    }

    .sms-desk {
      border-color: rgba(15, 118, 110, 0.24);
      background: linear-gradient(135deg, #f7fffc, #fff);
    }

    .sms-route-grid {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 8px;
      margin: 10px 0;
    }

    .sms-route-grid span {
      display: grid;
      gap: 3px;
      min-width: 0;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: #fff;
      padding: 8px;
      color: var(--muted);
      font-size: 12px;
      overflow-wrap: anywhere;
    }

    .sms-route-grid strong {
      color: var(--ink);
      font-size: 13px;
    }

    .link-button {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      text-decoration: none;
    }

    .audit-list {
      display: grid;
      gap: 8px;
    }

    .audit-list > div:not(.empty-mini) {
      display: grid;
      gap: 2px;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: #fbfdfd;
      padding: 8px;
    }

    .compact {
      min-height: 86px;
    }

    .primary-button,
    .ghost-button,
    .danger-button {
      min-height: 36px;
      border-radius: 8px;
      padding: 0 13px;
      font-weight: 800;
    }

    .primary-button {
      border: 1px solid var(--teal);
      background: var(--teal);
      color: #fff;
    }

    .ghost-button {
      border: 1px solid var(--line);
      background: #fff;
      color: var(--ink);
    }

    .danger-button {
      border: 1px solid var(--red);
      background: var(--red);
      color: #fff;
    }

    .mini {
      min-height: 30px;
      padding: 0 10px;
      font-size: 0.82rem;
    }

    @media (max-width: 1180px) {
      .appointment-command-grid,
      .booking-guard {
        grid-template-columns: 1fr;
      }

      .calendar-action-row {
        grid-template-columns: 1fr;
      }

      .calendar-filter-row {
        grid-template-columns: repeat(3, minmax(0, 1fr));
      }

      .calendar-action-buttons {
        justify-content: flex-start;
      }

      .calendar-toolbar-actions {
        justify-content: flex-start;
      }

      .scheduler-toolbar {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }

      .appointment-kpis {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }
    }

    @media (max-width: 760px) {
      .calendar-action-row,
        .calendar-filter-row,
        .scheduler-toolbar,
        .date-strip-panel,
        .appointment-kpis,
        .ops-pulse-grid,
        .mini-metrics,
        .slot-summary,
        .drawer-time-grid,
        .service-line,
        .detail-grid,
        .sms-route-grid,
        .month-grid {
          grid-template-columns: 1fr;
        }

      .booking-drawer,
      .block-time-drawer,
      .appointment-drawer {
        width: 100vw;
      }

      .service-line {
        grid-template-areas:
          "num"
          "service"
          "staff"
          "start"
          "duration"
          "chair"
          "remove";
      }

      .line-number {
        align-self: start;
      }

      .calendar-action-buttons {
        align-items: stretch;
      }

      .calendar-action-buttons .primary-button,
      .calendar-action-buttons .ghost-button {
        flex: 1 1 100%;
        justify-content: center;
      }

      .day-board {
        min-height: 560px;
      }

      .day-board-scroll {
        min-height: 560px;
        max-height: calc(100vh - 280px);
      }

      .timeline-row {
        grid-template-columns: 120px minmax(620px, 1fr);
      }
    }
  `]
})
export class AppointmentsComponent implements OnInit, OnDestroy {
  readonly STAFF_RENDER_LIMIT = STAFF_RENDER_LIMIT;
  readonly statusColumns = STATUS_COLUMNS;
  readonly viewOptions = VIEW_OPTIONS;
  readonly timeSlots = ['9 AM', '10 AM', '11 AM', '12 PM', '1 PM', '2 PM', '3 PM', '4 PM', '5 PM', '6 PM', '7 PM'];
  readonly appointments = signal<ApiRecord[]>([]);
  readonly clients = signal<ApiRecord[]>([]);
  readonly staff = signal<ApiRecord[]>([]);
  readonly staffOsStaff = signal<ApiRecord[]>([]);
  readonly staffSchedules = signal<ApiRecord[]>([]);
  readonly services = signal<ApiRecord[]>([]);
  readonly branches = signal<ApiRecord[]>([]);
  readonly waitlistEntries = signal<WaitlistEntry[]>([]);
  readonly blackouts = signal<ApiRecord[]>([]);
  readonly businessProfile = signal<ApiRecord | null>(null);
  readonly appointmentAudit = signal<ApiRecord[]>([]);
  readonly comboValidation = signal<ApiRecord | null>(null);
  readonly loading = signal(true);
  readonly saving = signal(false);
  readonly auditLoading = signal(false);
  readonly comboChecking = signal(false);
  readonly error = signal('');
  readonly drawerNotice = signal('');
  readonly lastBookedClientId = signal('');
  readonly viewMode = signal<CalendarView>('day');
  readonly staffFilter = signal('');
  readonly statusFilter = signal('');
  readonly staffWindowStart = signal(0);
  readonly selectedDate = signal(this.toDateInput(new Date()));
  readonly slotMinutes = signal(15);
  readonly currentMinuteTicker = signal(Date.now());
  readonly selectedAppointment = signal<ApiRecord | null>(null);
  readonly bookingDrawerOpen = signal(false);
  readonly bookingSlotContext = signal<BookingSlotContext | null>(null);
  readonly bookingServiceLines = signal<BookingServiceLine[]>([]);
  readonly slotHoverContext = signal<SlotHoverContext | null>(null);
  readonly schedulerActionMenu = signal<SchedulerActionMenu | null>(null);
  readonly blockTimeDrawerMode = signal<BlockTimeDrawerMode>('');
  readonly blockTimeStaffId = signal('');
  readonly blockTimeDate = signal(this.selectedDate());
  readonly blockTimeStart = signal('09:00');
  readonly blockTimeEnd = signal('09:15');
  readonly blockTimeReason = signal('');
  readonly blockTimeSaving = signal(false);
  readonly waitlistDrawerOpen = signal(false);
  readonly waitlistSaving = signal(false);
  readonly waitlistMessage = signal('');
  readonly waitlistError = signal('');
  readonly smsQueueTarget = signal<SmsRecipientTarget | ''>('');
  readonly touchupEligibility = signal<ApiRecord | null>(null);
  readonly rescheduleAt = signal('');
  readonly rescheduleStaffId = signal('');
  readonly clientSearch = signal('');
  readonly appointmentClientSearchActive = signal(false);
  readonly staffSearch = signal('');
  readonly serviceSearch = signal('');
  readonly formRevision = signal(0);
  readonly resizePreview = signal<{ id: string; height: number } | null>(null);
  draggingId = '';
  private formSubscription = new Subscription();
  private comboTimer: ReturnType<typeof setTimeout> | null = null;
  private clockTimer: ReturnType<typeof setInterval> | null = null;
  private resizeState: { appointment: ApiRecord; startY: number; startHeight: number; nextHeight: number } | null = null;
  private readonly onResizeMove = (event: PointerEvent) => this.resizeMove(event);
  private readonly onResizeEnd = (event: PointerEvent) => this.resizeEnd(event);

  readonly form = this.fb.group({
    clientId: ['', Validators.required],
    staffId: ['', Validators.required],
    branchId: ['', Validators.required],
    serviceId: ['', Validators.required],
    startAt: [this.localDateTime(), Validators.required],
    durationMinutes: [30, [Validators.required, Validators.min(15)]],
    chair: ['Chair 1'],
    walkIn: [false]
  });

  readonly waitlistForm = this.fb.group({
    clientId: ['', Validators.required],
    serviceId: [''],
    staffId: [''],
    preferredDate: [this.selectedDate()],
    windowStartTime: [''],
    windowEndTime: [''],
    priority: [0]
  });

  readonly appointmentsByDate = computed(() => {
    const grouped = new Map<string, ApiRecord[]>();
    for (const appointment of this.appointments()) {
      const key = this.toDateInput(this.appointmentStart(appointment));
      const rows = grouped.get(key) || [];
      rows.push(appointment);
      grouped.set(key, rows);
    }
    for (const rows of grouped.values()) {
      rows.sort((a, b) => this.appointmentStart(a).getTime() - this.appointmentStart(b).getTime());
    }
    return grouped;
  });

  readonly selectedDayAppointments = computed(() => this.appointmentsByDate().get(this.selectedDate()) || []);

  readonly visibleAppointmentRows = computed(() => (this.viewMode() === 'month' ? this.appointments() : this.selectedDayAppointments())
    .filter((appointment) => (this.staffFilter() ? appointment.staffId === this.staffFilter() : true))
    .filter((appointment) => (this.statusFilter() ? appointment.status === this.statusFilter() : true))
    .sort((a, b) => this.appointmentStart(a).getTime() - this.appointmentStart(b).getTime()));

  readonly allStaffRows = computed(() => {
    const activeStaff = this.staffFilter() ? this.staff().filter((person) => person.id === this.staffFilter()) : this.staff();
    const rows = activeStaff.length ? activeStaff : [{ id: 'unassigned', name: 'Unassigned' }];
    if (this.staffFilter()) return rows;
    const bookedByStaff = this.selectedDayAppointments().reduce((map, appointment) => {
      const key = String(appointment.staffId || 'unassigned');
      map.set(key, (map.get(key) || 0) + this.durationMinutes(appointment));
      return map;
    }, new Map<string, number>());
    return [...rows].sort((a, b) => {
      const aBooked = bookedByStaff.get(String(a.id || '')) || 0;
      const bBooked = bookedByStaff.get(String(b.id || '')) || 0;
      return bBooked - aBooked || String(a.name || '').localeCompare(String(b.name || ''));
    });
  });

  readonly visibleStaffRows = computed(() => {
    const rows = this.allStaffRows();
    if (this.staffFilter()) return rows;
    const maxStart = Math.max(0, rows.length - STAFF_RENDER_LIMIT);
    const start = Math.min(Math.max(0, this.staffWindowStart()), maxStart);
    return rows.slice(start, start + STAFF_RENDER_LIMIT);
  });

  readonly appointmentsByStaff = computed(() => {
    const grouped = new Map<string, ApiRecord[]>();
    for (const appointment of this.visibleAppointmentRows()) {
      const key = String(appointment.staffId || 'unassigned');
      const rows = grouped.get(key) || [];
      rows.push(appointment);
      grouped.set(key, rows);
    }
    return grouped;
  });

  readonly appointmentsByResource = computed(() => {
    const grouped = new Map<string, ApiRecord[]>();
    for (const appointment of this.visibleAppointmentRows()) {
      const key = this.resourceName(appointment);
      const rows = grouped.get(key) || [];
      rows.push(appointment);
      grouped.set(key, rows);
    }
    return grouped;
  });

  readonly statusLaneRows = computed(() => {
    const grouped = new Map<string, ApiRecord[]>();
    for (const status of this.statusColumns) {
      grouped.set(status, this.visibleAppointmentRows().filter((appointment) => appointment.status === status).slice(0, 8));
    }
    return grouped;
  });

  readonly shiftBlocksByStaff = computed(() => {
    const grouped = new Map<string, StaffShiftBlock[]>();
    for (const person of this.visibleStaffRows()) {
      grouped.set(String(person.id || 'unassigned'), this.buildShiftBlocksForStaff(person));
    }
    return grouped;
  });

  readonly staffLoadRows = computed(() => {
    const loads = new Map<string, { booked: number; idle: number }>();
    for (const person of this.visibleStaffRows()) {
      const rows = this.appointmentsByStaff().get(String(person.id)) || [];
      const booked = rows.reduce((sum, appointment) => sum + this.durationMinutes(appointment), 0);
      loads.set(String(person.id), { booked, idle: Math.max(0, 600 - booked) });
    }
    return loads;
  });

  readonly bookingGuardState = computed(() => {
    this.formRevision();
    return this.buildBookingGuard();
  });

  constructor(private readonly api: ApiService, private readonly fb: UntypedFormBuilder) {}

  ngOnInit(): void {
    if (!this.bookingServiceLines().length) {
      this.bookingServiceLines.set([this.createBookingLine({ startAt: String(this.form.value.startAt || this.localDateTime()) })]);
    }
    this.load();
    this.formSubscription = this.form.valueChanges.subscribe(() => {
      this.formRevision.update((value) => value + 1);
      this.scheduleComboValidation();
      this.refreshBookingContextFromForm();
    });
    this.clockTimer = setInterval(() => this.currentMinuteTicker.set(Date.now()), 60000);
  }

  ngOnDestroy(): void {
    this.formSubscription.unsubscribe();
    if (this.comboTimer) clearTimeout(this.comboTimer);
    if (this.clockTimer) clearInterval(this.clockTimer);
    this.clearResizeListeners();
  }

  load(): void {
    this.loading.set(true);
    this.error.set('');
    const scheduleRange = this.selectedMonthRange();
    const appointmentRange = this.appointmentLoadRange();
    const branchId = this.api.selectedBranchId();
    Promise.all([
      firstValueFrom(this.api.list<ApiRecord[]>('appointments', { branchId, from: appointmentRange.from, to: appointmentRange.to, limit: 2000 })),
      firstValueFrom(this.api.list<ApiRecord[]>('clients', { branchId })),
      firstValueFrom(this.api.list<ApiRecord[]>('staff', { branchId })),
      firstValueFrom(this.api.list<ApiRecord[]>('staff-os/staff', { branchId, status: 'active', limit: 200 })).catch(() => [] as ApiRecord[]),
      firstValueFrom(this.api.list<ApiRecord[]>('staff-os/schedules', { branchId, from: scheduleRange.from, to: scheduleRange.to, limit: 500 })).catch(() => [] as ApiRecord[]),
      firstValueFrom(this.api.list<ApiRecord[]>('services')),
      firstValueFrom(this.api.list<ApiRecord[]>('branches')),
      firstValueFrom(this.api.list<WaitlistEntry[]>('waitlist', { branchId, limit: 100, status: 'waiting' })).catch(() => [] as WaitlistEntry[]),
      firstValueFrom(this.api.list<ApiRecord>('invoice-notifications/profile', { branchId })).catch(() => null as ApiRecord | null)
    ])
      .then(([appointments, clients, staff, staffOsStaff, staffSchedules, services, branches, waitlist, businessProfile]) => {
        this.appointments.set(appointments || []);
        this.clients.set(clients || []);
        this.staffOsStaff.set(staffOsStaff || []);
        this.staff.set(this.mergeStaffRows(staff || [], staffOsStaff || []));
        this.staffSchedules.set(staffSchedules || []);
        this.services.set(services || []);
        this.branches.set(branches || []);
        this.waitlistEntries.set(waitlist || []);
        this.businessProfile.set(businessProfile || null);
        const preferredBranch = this.currentBranchId();
        if (!this.form.value.branchId && preferredBranch) {
          this.form.patchValue({ branchId: preferredBranch }, { emitEvent: false });
          this.formRevision.update((value) => value + 1);
        }
        this.loadBlackouts();
        this.scheduleComboValidation();
        this.loading.set(false);
      })
      .catch((error) => {
        this.error.set(error?.error?.error || error?.message || 'Unable to load appointment calendar');
        this.loading.set(false);
      });
  }

  private loadAppointmentsForCurrentRange(): void {
    const branchId = this.api.selectedBranchId();
    const range = this.appointmentLoadRange();
    this.api.list<ApiRecord[]>('appointments', { branchId, from: range.from, to: range.to, limit: 2000 }).subscribe({
      next: (rows) => this.appointments.set(rows || []),
      error: (error) => this.error.set(this.api.errorText(error, 'Unable to refresh appointment calendar'))
    });
  }

  async save(): Promise<void> {
    if (this.bookingDrawerOpen()) {
      await this.saveBookingPlan();
      return;
    }
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const guard = this.bookingGuard();
    if (guard.hardBlock) {
      this.error.set(guard.details[0] || guard.title);
      return;
    }
    this.saving.set(true);
    const value = this.form.value;
    const bookedClientId = String(value.clientId || '');
    const serviceIds = this.currentServiceIds();
    const startAt = new Date(String(value.startAt)).toISOString();
    this.api.create('appointments', {
      clientId: value.clientId,
      staffId: value.staffId,
      branchId: value.branchId,
      serviceIds,
      startAt,
      endAt: new Date(new Date(startAt).getTime() + this.selectedServiceDuration() * 60000).toISOString(),
      source: value.walkIn ? 'walk-in' : 'front-desk',
      sourceChannel: value.walkIn ? 'walkin' : 'front_desk',
      onlineStatus: value.walkIn ? 'not-online' : 'confirmed',
      chair: value.chair,
      status: value.walkIn ? 'arrived' : 'booked'
    }).subscribe({
      next: () => {
        this.lastBookedClientId.set(bookedClientId);
        this.saving.set(false);
        this.resetForm();
        this.bookingDrawerOpen.set(false);
        this.bookingSlotContext.set(null);
        this.loadAppointmentsForCurrentRange();
      },
      error: (error) => {
        this.error.set(error?.error?.error || error?.message || 'Unable to create appointment');
        this.saving.set(false);
      }
    });
  }

  private async saveBookingPlan(): Promise<void> {
    if (this.hasIncompleteBookingLines()) {
      this.error.set('Complete service, staff, start time and duration in every service line.');
      return;
    }
    const lines = this.normalizedBookingLines();
    if (!this.form.value.clientId || !this.form.value.branchId || !lines.length) {
      this.form.markAllAsTouched();
      this.error.set('Client, branch and at least one complete service line are required.');
      return;
    }
    const guard = this.bookingGuard();
    if (guard.hardBlock) {
      this.error.set(guard.details[0] || guard.title);
      return;
    }
    this.saving.set(true);
    this.error.set('');
    const value = this.form.value;
    const bookedClientId = String(value.clientId || '');
    const sourceId = lines.length > 1 ? `multi_${Date.now().toString(36)}` : '';
    const created: ApiRecord[] = [];
    try {
      for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index];
        const startAt = new Date(line.startAt).toISOString();
        const endAt = new Date(new Date(startAt).getTime() + line.durationMinutes * 60000).toISOString();
        const appointment = await firstValueFrom(this.api.create<ApiRecord>('appointments', {
          clientId: value.clientId,
          staffId: line.staffId,
          branchId: value.branchId,
          serviceIds: [line.serviceId],
          startAt,
          endAt,
          source: value.walkIn ? 'walk-in' : 'front-desk',
          sourceChannel: lines.length > 1 ? 'front_desk_multi_service' : value.walkIn ? 'walkin' : 'front_desk',
          onlineStatus: value.walkIn ? 'not-online' : 'confirmed',
          chair: line.chair || value.chair || 'Chair 1',
          status: value.walkIn ? 'arrived' : 'booked',
          notes: [
            lines.length > 1 ? `Multi-service booking ${index + 1}/${lines.length}` : '',
            sourceId ? `Plan ${sourceId}` : ''
          ].filter(Boolean).join(' | ')
        }));
        created.push(appointment);
      }
      this.lastBookedClientId.set(bookedClientId);
      this.saving.set(false);
      this.resetForm();
      this.bookingDrawerOpen.set(false);
      this.bookingSlotContext.set(null);
      this.loadAppointmentsForCurrentRange();
    } catch (error: any) {
      this.saving.set(false);
      const message = error?.error?.error || error?.error?.message || error?.message || 'Unable to create multi-service booking';
      this.error.set(created.length ? `${created.length} service(s) booked, then stopped: ${message}` : message);
    }
  }

  resetForm(): void {
    this.clientSearch.set('');
    this.staffSearch.set('');
    this.serviceSearch.set('');
    this.comboValidation.set(null);
    const startAt = this.localDateTime();
    this.form.patchValue({
      clientId: '',
      staffId: '',
      branchId: this.currentBranchId(),
      serviceId: '',
      startAt,
      durationMinutes: 30,
      chair: 'Chair 1',
      walkIn: false
    });
    this.bookingServiceLines.set([this.createBookingLine({ startAt, chair: 'Chair 1' })]);
  }

  setSelectedDate(value: string): void {
    const previousMonth = String(this.selectedDate() || '').slice(0, 7);
    this.selectedDate.set(value);
    if (String(value || '').slice(0, 7) !== previousMonth) {
      this.staffWindowStart.set(0);
      this.loadAppointmentsForCurrentRange();
      this.loadStaffSchedulesForSelectedMonth();
    }
    this.loadBlackouts();
    this.scheduleComboValidation();
    this.clearSlotHover();
  }

  shiftSelectedDate(days: number): void {
    const next = new Date(`${this.selectedDate()}T00:00:00`);
    next.setDate(next.getDate() + days);
    this.setSelectedDate(this.toDateInput(next));
  }

  jumpToday(): void {
    this.setSelectedDate(this.toDateInput(new Date()));
    this.viewMode.set('day');
  }

  shiftSelectedMonth(months: number): void {
    const current = new Date(`${this.selectedDate()}T00:00:00`);
    current.setMonth(current.getMonth() + months, 1);
    this.setSelectedDate(this.toDateInput(current));
  }

  jumpToStripDate(value: string): void {
    this.setSelectedDate(value);
    this.viewMode.set('day');
  }

  setSlotMinutes(value: string | number): void {
    const minutes = Number(value);
    this.slotMinutes.set(minutes === 30 ? 30 : 15);
  }

  setStaffFilter(value: string): void {
    this.staffFilter.set(value);
    this.staffWindowStart.set(0);
    this.clearSlotHover();
  }

  shiftStaffWindow(delta: number): void {
    const total = this.staffWindowTotal();
    const maxStart = Math.max(0, total - STAFF_RENDER_LIMIT);
    const next = Math.max(0, Math.min(maxStart, this.staffWindowStart() + delta));
    this.staffWindowStart.set(next);
    this.clearSlotHover();
  }

  staffWindowTotal(): number {
    return this.allStaffRows().length;
  }

  staffWindowEnd(): number {
    return Math.min(this.staffWindowStartIndex() + STAFF_RENDER_LIMIT, this.staffWindowTotal());
  }

  staffWindowSummary(): string {
    const total = this.staffWindowTotal();
    if (!total) return 'No staff';
    return `Showing ${this.staffWindowStartIndex() + 1}-${this.staffWindowEnd()} of ${total}`;
  }

  private staffWindowStartIndex(): number {
    return Math.min(Math.max(0, this.staffWindowStart()), Math.max(0, this.staffWindowTotal() - STAFF_RENDER_LIMIT));
  }

  focusQuickBooking(): void {
    const selectedStaff = this.visibleStaff().find((person) => person.id !== 'unassigned') || this.staff()[0] || { id: '', name: 'Select staff' };
    const now = new Date();
    const minutes = this.toDateInput(now) === this.selectedDate()
      ? this.snapMinutes(Math.max(SCHEDULER_START_MINUTES, this.minutesOfDay(now)))
      : SCHEDULER_START_MINUTES;
    this.openQuickBookingForSlot(selectedStaff, minutes);
  }

  openQuickBookingFromLane(person: ApiRecord, event: MouseEvent): void {
    const target = event.target as HTMLElement;
    if (target.closest('.scheduler-card') || target.closest('.resize-handle') || target.closest('.staff-head') || target.closest('.staff-action-menu')) return;
    this.closeSchedulerActionMenu();
    const lane = event.currentTarget as HTMLElement;
    const rect = lane.getBoundingClientRect();
    const rawY = event.clientY - rect.top - SCHEDULER_HEADER_HEIGHT;
    if (rawY < 0) return;
    const minutes = this.snapMinutes(SCHEDULER_START_MINUTES + (rawY / this.slotHeight()) * this.slotMinutes());
    if (this.blockedTimesForStaffAtMinute(person, minutes).length) {
      this.openRemoveBlockedTime(person, minutes);
      return;
    }
    this.openQuickBookingForSlot(person, minutes);
  }

  openSchedulerActionMenu(person: ApiRecord, event: MouseEvent): void {
    event.preventDefault();
    event.stopPropagation();
    const lane = (event.currentTarget as HTMLElement).closest('.staff-lane') as HTMLElement | null;
    const rect = lane?.getBoundingClientRect();
    const rawY = rect ? event.clientY - rect.top - SCHEDULER_HEADER_HEIGHT : 0;
    const minute = rawY > 0
      ? this.snapMinutes(SCHEDULER_START_MINUTES + (rawY / this.slotHeight()) * this.slotMinutes())
      : SCHEDULER_START_MINUTES;
    this.schedulerActionMenu.set({
      staffId: String(person.id || 'unassigned'),
      minute,
      top: rawY > 0 ? Math.max(SCHEDULER_HEADER_HEIGHT + 8, this.topForMinutes(minute) - 4) : SCHEDULER_HEADER_HEIGHT + 8
    });
  }

  closeSchedulerActionMenu(): void {
    this.schedulerActionMenu.set(null);
  }

  openAddBlockedTime(person: ApiRecord, minute: number): void {
    const start = this.snapMinutes(minute);
    const end = Math.min(SCHEDULER_END_MINUTES, start + Math.max(this.slotMinutes(), 30));
    this.selectedAppointment.set(null);
    this.bookingDrawerOpen.set(false);
    this.closeSchedulerActionMenu();
    this.blockTimeStaffId.set(String(person.id || ''));
    this.blockTimeDate.set(this.selectedDate());
    this.blockTimeStart.set(this.timeValue(start));
    this.blockTimeEnd.set(this.timeValue(end));
    this.blockTimeReason.set('');
    this.blockTimeDrawerMode.set('add');
  }

  openRemoveBlockedTime(person: ApiRecord, minute: number): void {
    this.selectedAppointment.set(null);
    this.bookingDrawerOpen.set(false);
    this.closeSchedulerActionMenu();
    this.blockTimeStaffId.set(String(person.id || ''));
    this.blockTimeDate.set(this.selectedDate());
    this.blockTimeStart.set(this.timeValue(this.snapMinutes(minute)));
    this.blockTimeDrawerMode.set('remove');
  }

  openQuickBookingForSlot(person: ApiRecord, minutes: number): void {
    const start = this.dateAtMinutes(minutes);
    const staffId = person.id === 'unassigned' ? '' : String(person.id || '');
    this.selectedAppointment.set(null);
    this.drawerNotice.set('');
    this.bookingDrawerOpen.set(true);
    this.staffSearch.set(staffId ? this.staffOptionLabel(person) : '');
    this.form.patchValue({
      staffId,
      branchId: this.currentBranchId(),
      startAt: this.toDateTimeInput(start),
      durationMinutes: Number(this.form.value.durationMinutes || 30),
      chair: this.form.value.chair || 'Chair 1'
    });
    this.bookingServiceLines.set([this.createBookingLine({
      serviceId: String(this.form.value.serviceId || ''),
      staffId,
      startAt: this.toDateTimeInput(start),
      durationMinutes: Number(this.form.value.durationMinutes || 30),
      chair: String(this.form.value.chair || 'Chair 1')
    })]);
    this.bookingSlotContext.set({
      staffId,
      staffName: staffId ? this.staffName(staffId) : 'Select staff',
      startAt: start.toISOString(),
      timeLabel: start.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })
    });
    setTimeout(() => document.getElementById('appointment-client-input')?.focus(), 120);
  }

  closeAnyDrawer(): void {
    this.closeSchedulerActionMenu();
    this.closeBookingDrawer();
    this.closeAppointment();
    this.closeBlockTimeDrawer();
    this.closeWaitlistDrawer();
  }

  closeBookingDrawer(): void {
    this.bookingDrawerOpen.set(false);
    this.bookingSlotContext.set(null);
  }

  closeBlockTimeDrawer(): void {
    this.blockTimeDrawerMode.set('');
    this.blockTimeSaving.set(false);
  }

  openWaitlistDrawer(): void {
    this.waitlistMessage.set('');
    this.waitlistError.set('');
    this.waitlistForm.patchValue({
      clientId: '',
      serviceId: String(this.form.value.serviceId || ''),
      staffId: this.staffFilter() || String(this.form.value.staffId || ''),
      preferredDate: this.selectedDate(),
      windowStartTime: '',
      windowEndTime: '',
      priority: 0
    }, { emitEvent: false });
    this.viewMode.set('waitlist');
    this.waitlistDrawerOpen.set(true);
  }

  closeWaitlistDrawer(): void {
    this.waitlistDrawerOpen.set(false);
  }

  saveWaitlist(): void {
    const value = this.waitlistForm.value;
    const clientId = String(value.clientId || '').trim();
    if (!clientId) {
      this.waitlistError.set('Select a client to add to waitlist.');
      return;
    }
    const preferredDate = String(value.preferredDate || this.selectedDate()).slice(0, 10);
    const payload: ApiRecord = {
      clientId,
      serviceId: String(value.serviceId || ''),
      staffId: String(value.staffId || ''),
      preferredDate,
      priority: Number(value.priority || 0),
      status: 'waiting'
    };
    const windowStart = this.waitlistDateTime(preferredDate, String(value.windowStartTime || ''));
    const windowEnd = this.waitlistDateTime(preferredDate, String(value.windowEndTime || ''));
    if (windowStart) payload.windowStart = windowStart;
    if (windowEnd) payload.windowEnd = windowEnd;
    this.waitlistSaving.set(true);
    this.waitlistError.set('');
    this.api.create<WaitlistEntry>('waitlist', payload).subscribe({
      next: (entry) => {
        this.waitlistSaving.set(false);
        this.waitlistEntries.set([entry, ...this.waitlistEntries()]);
        this.waitlistMessage.set(`${this.waitlistClientName(entry)} added to waitlist.`);
      },
      error: (error) => {
        this.waitlistSaving.set(false);
        this.waitlistError.set(this.api.errorText(error, 'Waitlist was not saved.'));
      }
    });
  }

  trackBookingLine(_: number, line: BookingServiceLine): string {
    return line.id;
  }

  trackAppointment(_: number, appointment: ApiRecord): string {
    return String(appointment.id || `${appointment.staffId}_${appointment.startAt}`);
  }

  trackWaitlistEntry(_: number, entry: WaitlistEntry): string {
    return String(entry.id || `${entry.clientId}_${entry.preferredDate}_${entry.serviceId || 'any'}`);
  }

  trackSchedule(_: number, schedule: ApiRecord): string {
    return String(schedule.id || `${schedule.staffId || schedule.staff_id}_${schedule.scheduleDate || schedule.schedule_date}_${schedule.startTime || schedule.start_time}`);
  }

  trackStaff(_: number, person: ApiRecord): string {
    return String(person.id || person.staffOsId || person.name || 'staff');
  }

  trackValue(_: number, value: string): string {
    return String(value);
  }

  trackViewOption(_: number, option: { id: CalendarView }): string {
    return option.id;
  }

  trackSchedulerSlot(_: number, slot: { minutes: number }): number {
    return slot.minutes;
  }

  trackDateStripDay(_: number, day: CalendarDateStripDay): string {
    return day.dateInput;
  }

  trackDateValue(_: number, date: Date): string {
    return this.toDateInput(date);
  }

  trackMonthDay(_: number, day: { date: Date }): string {
    return this.toDateInput(day.date);
  }

  trackShiftBlock(_: number, block: StaffShiftBlock): string {
    return block.id;
  }

  addBookingLine(): void {
    const lines = this.bookingServiceLines();
    const previous = lines[lines.length - 1] || this.createBookingLine();
    const nextStart = this.toDateTimeInput(this.bookingLineEnd(previous));
    this.bookingServiceLines.set([
      ...lines,
      this.createBookingLine({
        startAt: nextStart,
        chair: previous.chair || String(this.form.value.chair || 'Chair 1'),
        durationMinutes: 30
      })
    ]);
    this.scheduleComboValidation();
  }

  updateBookingLine(id: string, patch: Partial<BookingServiceLine>): void {
    let firstLineChanged = false;
    const next = this.bookingServiceLines().map((line, index) => {
      if (line.id !== id) return line;
      firstLineChanged = index === 0;
      const serviceChanged = Object.prototype.hasOwnProperty.call(patch, 'serviceId');
      const serviceId = String(patch.serviceId ?? line.serviceId ?? '').trim();
      const durationSeed = serviceChanged && !Object.prototype.hasOwnProperty.call(patch, 'durationMinutes')
        ? this.serviceDurationById(serviceId)
        : patch.durationMinutes ?? line.durationMinutes;
      return this.createBookingLine({
        ...line,
        ...patch,
        serviceId,
        durationMinutes: this.coerceLineDuration(serviceId, durationSeed)
      });
    });
    this.bookingServiceLines.set(next);
    if (firstLineChanged) this.syncFormFromFirstBookingLine();
    this.scheduleComboValidation();
    this.refreshBookingContextFromForm();
  }

  removeBookingLine(id: string): void {
    const lines = this.bookingServiceLines();
    if (lines.length <= 1) return;
    const removedFirst = lines[0]?.id === id;
    this.bookingServiceLines.set(lines.filter((line) => line.id !== id));
    if (removedFirst) this.syncFormFromFirstBookingLine();
    this.scheduleComboValidation();
  }

  autoSequenceBookingLines(): void {
    const lines = this.bookingServiceLines();
    if (!lines.length) return;
    let cursor = new Date(String(lines[0].startAt || this.form.value.startAt || this.localDateTime()));
    if (Number.isNaN(cursor.getTime())) cursor = new Date();
    const sequenced = lines.map((line, index) => {
      const startAt = index === 0 ? this.toDateTimeInput(cursor) : this.toDateTimeInput(cursor);
      const nextLine = this.createBookingLine({ ...line, startAt });
      cursor = this.bookingLineEnd(nextLine);
      return nextLine;
    });
    this.bookingServiceLines.set(sequenced);
    this.syncFormFromFirstBookingLine();
    this.scheduleComboValidation();
  }

  normalizedBookingLines(): BookingServiceLine[] {
    return this.bookingServiceLines()
      .map((line) => this.createBookingLine({
        ...line,
        serviceId: String(line.serviceId || '').trim(),
        staffId: String(line.staffId || '').trim(),
        startAt: String(line.startAt || '').trim(),
        chair: String(line.chair || this.form.value.chair || 'Chair 1').trim() || 'Chair 1',
        durationMinutes: this.coerceLineDuration(line.serviceId, line.durationMinutes)
      }))
      .filter((line) => !!line.serviceId && !!line.staffId && !!line.startAt && !Number.isNaN(new Date(line.startAt).getTime()));
  }

  private hasIncompleteBookingLines(): boolean {
    const lines = this.bookingServiceLines();
    return !lines.length || lines.some((line) => {
      const start = new Date(String(line.startAt || ''));
      return !line.serviceId || !line.staffId || !line.startAt || Number(line.durationMinutes || 0) < 15 || Number.isNaN(start.getTime());
    });
  }

  private createBookingLine(partial: Partial<BookingServiceLine> = {}): BookingServiceLine {
    const serviceId = String(partial.serviceId ?? '').trim();
    const staffId = String(partial.staffId ?? this.form.value.staffId ?? '').trim();
    const startAt = String(partial.startAt ?? this.form.value.startAt ?? this.localDateTime()).slice(0, 16);
    const chair = String(partial.chair ?? this.form.value.chair ?? 'Chair 1').trim() || 'Chair 1';
    return {
      id: partial.id || `line_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
      serviceId,
      staffId,
      startAt,
      durationMinutes: this.coerceLineDuration(serviceId, partial.durationMinutes ?? this.form.value.durationMinutes),
      chair
    };
  }

  private coerceLineDuration(serviceId: string | undefined, value: unknown): number {
    const manual = Number(value || 0);
    if (manual >= 15) return Math.round(manual);
    return Math.max(15, serviceId ? this.serviceDurationById(String(serviceId)) : 30);
  }

  private bookingLineEnd(line: BookingServiceLine): Date {
    const start = new Date(String(line.startAt || this.localDateTime()));
    const safeStart = Number.isNaN(start.getTime()) ? new Date() : start;
    return new Date(safeStart.getTime() + this.coerceLineDuration(line.serviceId, line.durationMinutes) * 60000);
  }

  private syncFormFromFirstBookingLine(): void {
    const first = this.bookingServiceLines()[0];
    if (!first) return;
    this.form.patchValue({
      staffId: first.staffId || '',
      serviceId: first.serviceId || '',
      startAt: first.startAt || this.form.value.startAt,
      durationMinutes: first.durationMinutes || this.form.value.durationMinutes,
      chair: first.chair || this.form.value.chair || 'Chair 1'
    }, { emitEvent: false });
    const person = this.staff().find((item) => item.id === first.staffId);
    const service = this.services().find((item) => item.id === first.serviceId);
    this.staffSearch.set(person ? this.staffOptionLabel(person) : '');
    this.serviceSearch.set(service ? this.serviceOptionLabel(service) : '');
    this.formRevision.update((value) => value + 1);
    this.refreshBookingContextFromForm();
  }

  bookingDrawerTitle(): string {
    const slot = this.bookingSlotContext();
    return slot?.staffName && slot.staffName !== 'Select staff' ? `Book with ${slot.staffName}` : 'Create booking';
  }

  bookingDrawerSubtitle(): string {
    const slot = this.bookingSlotContext();
    return slot ? `${slot.timeLabel} · click any field below to change staff, time, branch, chair or service.` : 'Select staff and time to create a booking.';
  }

  bookingEndPreview(): string {
    if (this.bookingDrawerOpen() && this.bookingServiceLines().length) {
      const ends = this.bookingServiceLines()
        .filter((line) => line.startAt)
        .map((line) => this.bookingLineEnd(line).getTime())
        .filter((time) => Number.isFinite(time));
      if (ends.length) return this.timeLabel(new Date(Math.max(...ends)));
    }
    const start = new Date(String(this.form.value.startAt || this.localDateTime()));
    if (Number.isNaN(start.getTime())) return 'Select time';
    return this.timeLabel(new Date(start.getTime() + this.selectedServiceDuration() * 60000));
  }

  quickTimeOptions(): { label: string; minutes: number }[] {
    const start = new Date(String(this.form.value.startAt || this.localDateTime()));
    const base = Number.isNaN(start.getTime()) ? SCHEDULER_START_MINUTES : this.minutesOfDay(start);
    const candidates = [base - 30, base - 15, base, base + 15, base + 30, base + 60];
    const unique = Array.from(new Set(candidates.map((minutes) => this.snapMinutes(minutes))));
    return unique.map((minutes) => ({ label: this.minutesLabel(minutes), minutes }));
  }

  applyQuickTime(minutes: number): void {
    const start = new Date(String(this.form.value.startAt || `${this.selectedDate()}T00:00:00`));
    const safeStart = Number.isNaN(start.getTime()) ? new Date(`${this.selectedDate()}T00:00:00`) : start;
    safeStart.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0);
    const startAt = this.toDateTimeInput(safeStart);
    const first = this.bookingServiceLines()[0];
    if (first) {
      this.updateBookingLine(first.id, { startAt });
      if (this.bookingServiceLines().length > 1) this.autoSequenceBookingLines();
    } else {
      this.form.patchValue({ startAt });
    }
  }

  refreshBookingContextFromForm(): void {
    if (!this.bookingDrawerOpen()) return;
    const staffId = String(this.form.value.staffId || '');
    const start = new Date(String(this.form.value.startAt || this.localDateTime()));
    this.bookingSlotContext.set({
      staffId,
      staffName: staffId ? this.staffName(staffId) : 'Select staff',
      startAt: Number.isNaN(start.getTime()) ? '' : start.toISOString(),
      timeLabel: Number.isNaN(start.getTime()) ? 'Select time' : start.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })
    });
  }

  loadBlackouts(): void {
    const start = new Date(`${this.selectedDate()}T00:00:00`);
    start.setDate(start.getDate() - 7);
    const end = new Date(`${this.selectedDate()}T00:00:00`);
    end.setDate(end.getDate() + 45);
    this.api.list<ApiRecord[]>('blackouts', {
      branchId: this.currentBranchId(),
      from: this.toDateInput(start),
      to: this.toDateInput(end)
    }).subscribe({
      next: (blackouts) => this.blackouts.set(blackouts || []),
      error: () => this.blackouts.set([])
    });
  }

  scheduleComboValidation(): void {
    if (this.comboTimer) clearTimeout(this.comboTimer);
    this.comboTimer = setTimeout(() => this.validateCurrentCombo(), 350);
  }

  validateCurrentCombo(): void {
    const value = this.form.value;
    const serviceIds = this.currentServiceIds();
    if (!value.clientId || !serviceIds.length || !value.startAt) {
      this.comboValidation.set(null);
      return;
    }
    this.comboChecking.set(true);
    this.api.post<ApiRecord>('services/validate-combo', {
      clientId: value.clientId,
      serviceIds,
      date: new Date(String(value.startAt)).toISOString()
    }).subscribe({
      next: (result) => {
        this.comboValidation.set(result);
        this.comboChecking.set(false);
      },
      error: () => {
        this.comboValidation.set(null);
        this.comboChecking.set(false);
      }
    });
  }

  setClientSearch(value: string): void {
    this.clientSearch.set(value);
    this.appointmentClientSearchActive.set(true);
    const match = this.clients().find((client) => this.optionMatches(value, client.id, this.clientOptionLabel(client)));
    this.form.patchValue({ clientId: match?.id || '' });
  }

  selectAppointmentClient(client: ApiRecord): void {
    this.clientSearch.set(this.clientOptionLabel(client));
    this.appointmentClientSearchActive.set(false);
    this.form.patchValue({ clientId: client.id || '' });
  }

  showAppointmentClientResults(): boolean {
    return this.appointmentClientSearchActive() && this.clientSearch().trim().length > 0 && this.filteredAppointmentClients().length > 0;
  }

  closeAppointmentClientSearchSoon(): void {
    window.setTimeout(() => this.appointmentClientSearchActive.set(false), 120);
  }

  filteredAppointmentClients(): ApiRecord[] {
    const query = this.normalizeSearch(this.clientSearch());
    if (!query) return [];
    return this.clients()
      .filter((client) => this.clientMatchesAdvancedSearch(client, query))
      .sort((a, b) => this.clientAdvancedSearchScore(b, query) - this.clientAdvancedSearchScore(a, query))
      .slice(0, 25);
  }

  setStaffSearch(value: string): void {
    this.staffSearch.set(value);
    const match = this.staff().find((person) => this.optionMatches(value, person.id, this.staffOptionLabel(person)));
    const staffId = match?.id || '';
    this.form.patchValue({ staffId });
    const first = this.bookingServiceLines()[0];
    if (first) this.updateBookingLine(first.id, { staffId });
  }

  setServiceSearch(value: string): void {
    this.serviceSearch.set(value);
    const match = this.services().find((service) => this.optionMatches(value, service.id, this.serviceOptionLabel(service)));
    const serviceId = match?.id || '';
    const durationMinutes = match ? this.serviceDurationById(String(match.id)) : this.form.value.durationMinutes;
    this.form.patchValue({
      serviceId,
      durationMinutes
    });
    const first = this.bookingServiceLines()[0];
    if (first) this.updateBookingLine(first.id, { serviceId, durationMinutes });
  }

  clientOptionLabel(client: ApiRecord): string {
    const name = String(client.name || client.fullName || 'Client');
    const phone = String(client.phone || client.mobile || client.contact || '').trim();
    return phone ? `${name} - ${phone}` : name;
  }

  staffOptionLabel(person: ApiRecord): string {
    const name = String(person.name || person.fullName || 'Staff');
    const phone = String(person.phone || person.mobile || '').trim();
    return phone ? `${name} - ${phone}` : name;
  }

  serviceOptionLabel(service: ApiRecord): string {
    const price = Number(service.price || 0);
    return `${service.name || 'Service'} - ₹${price}`;
  }

  visibleAppointments(): ApiRecord[] {
    return this.visibleAppointmentRows();
  }

  visibleStaff(): ApiRecord[] {
    return this.visibleStaffRows();
  }

  dayBoardColumns(): string {
    return `72px repeat(${this.visibleStaff().length}, minmax(${this.schedulerColumnMinWidth()}px, 1fr))`;
  }

  dayBoardMinWidth(): number {
    return 72 + this.visibleStaff().length * this.schedulerColumnMinWidth();
  }

  schedulerColumnMinWidth(): number {
    const count = this.visibleStaff().length;
    if (count <= 5) return 210;
    if (count <= 8) return 170;
    if (count <= 12) return 138;
    return 118;
  }

  schedulerSlots(): { label: string; minutes: number; major: boolean }[] {
    const interval = this.slotMinutes();
    const total = Math.ceil((SCHEDULER_END_MINUTES - SCHEDULER_START_MINUTES) / interval);
    return Array.from({ length: total }, (_, index) => {
      const minutes = SCHEDULER_START_MINUTES + index * interval;
      return {
        label: this.minutesLabel(minutes),
        minutes,
        major: minutes % 60 === 0
      };
    });
  }

  slotHeight(): number {
    return this.slotMinutes() === 15 ? 36 : 44;
  }

  slotHeightStyle(): string {
    return `${this.slotHeight()}px`;
  }

  schedulerBoardHeight(): number {
    return SCHEDULER_HEADER_HEIGHT + this.schedulerSlots().length * this.slotHeight();
  }

  currentTimeVisible(): boolean {
    const now = new Date(this.currentMinuteTicker());
    const minute = this.minutesOfDay(now);
    return this.toDateInput(now) === this.selectedDate() && minute >= SCHEDULER_START_MINUTES && minute <= SCHEDULER_END_MINUTES;
  }

  currentTimeTop(): number {
    const now = new Date(this.currentMinuteTicker());
    return this.topForMinutes(this.minutesOfDay(now));
  }

  currentTimeLabel(): string {
    return this.timeLabel(new Date(this.currentMinuteTicker()));
  }

  appointmentTop(appointment: ApiRecord): number {
    return this.topForMinutes(this.minutesOfDay(this.appointmentStart(appointment)));
  }

  appointmentHeight(appointment: ApiRecord): number {
    const preview = this.resizePreview();
    if (preview && preview.id === appointment.id) return preview.height;
    return this.heightForDuration(this.durationMinutes(appointment));
  }

  appointmentStatusTone(status = ''): string {
    return `tone-${String(status || 'booked').replace(/_/g, '-').toLowerCase()}`;
  }

  appointmentsForStaff(staffId: string): ApiRecord[] {
    return this.appointmentsByStaff().get(String(staffId)) || [];
  }

  appointmentsForDate(date: Date): ApiRecord[] {
    return (this.appointmentsByDate().get(this.toDateInput(date)) || [])
      .filter((appointment) => (this.staffFilter() ? appointment.staffId === this.staffFilter() : true))
      .sort((a, b) => this.appointmentStart(a).getTime() - this.appointmentStart(b).getTime());
  }

  appointmentsForResource(resource: string): ApiRecord[] {
    return this.appointmentsByResource().get(resource) || [];
  }

  queueAppointments(): ApiRecord[] {
    return this.visibleAppointments().filter((appointment) => ['arrived', 'waiting', 'booked'].includes(appointment.status));
  }

  waitlistAppointments(): ApiRecord[] {
    return this.appointments()
      .filter((appointment) => ['waiting', 'rescheduled', 'no-show'].includes(appointment.status) || appointment.waitlist === 1)
      .slice(0, 20);
  }

  waitlistClientName(entry: WaitlistEntry): string {
    const client = this.clients().find((item) => String(item.id || '') === String(entry.clientId || ''));
    return String(client?.name || client?.phone || entry.clientId || 'Client');
  }

  waitlistServiceName(entry: WaitlistEntry): string {
    if (!entry.serviceId) return 'Any service';
    return String(this.services().find((service) => String(service.id || '') === String(entry.serviceId))?.name || entry.serviceId);
  }

  waitlistStaffName(entry: WaitlistEntry): string {
    if (!entry.staffId) return 'Any staff';
    return String(this.staff().find((person) => String(person.id || '') === String(entry.staffId))?.name || entry.staffId);
  }

  waitlistWindowLabel(entry: WaitlistEntry): string {
    const date = entry.preferredDate ? this.dateLabel(entry.preferredDate) : 'Any date';
    const start = this.timeLabel(entry.windowStart);
    const end = this.timeLabel(entry.windowEnd);
    return [date, start && end ? `${start} - ${end}` : start || end].filter(Boolean).join(' · ');
  }

  resources(): string[] {
    const names = new Set(['Chair 1', 'Chair 2', 'Chair 3', 'Room A']);
    for (const appointment of this.visibleAppointments()) names.add(this.resourceName(appointment));
    return Array.from(names).filter(Boolean);
  }

  metrics(): { label: string; value: number; hint: string; status: string }[] {
    const rows = this.selectedDayAppointments();
    return [
      { label: 'Booked', value: rows.filter((item) => item.status === 'booked').length, hint: 'scheduled', status: 'booked' },
      { label: 'Arrived', value: rows.filter((item) => item.status === 'arrived').length, hint: 'front desk', status: 'arrived' },
      { label: 'In service', value: rows.filter((item) => item.status === 'in-service').length, hint: 'chair busy', status: 'in-service' },
      { label: 'Completed', value: rows.filter((item) => item.status === 'completed').length, hint: 'ready to bill', status: 'completed' },
      { label: 'No-show', value: rows.filter((item) => item.status === 'no-show').length, hint: 'recover', status: 'no-show' },
      { label: 'Revenue', value: rows.reduce((sum, item) => sum + this.appointmentValue(item), 0), hint: 'planned value', status: '' }
    ];
  }

  operationInsights(): OperationInsight[] {
    const rows = this.selectedDayAppointments();
    const activeStaff = Math.max(1, this.visibleStaff().filter((person) => person.id !== 'unassigned').length);
    const capacityMinutes = activeStaff * 600;
    const bookedMinutes = rows
      .filter((appointment) => !this.isTerminal(appointment))
      .reduce((sum, appointment) => sum + this.durationMinutes(appointment), 0);
    const utilization = Math.min(100, Math.round((bookedMinutes / capacityMinutes) * 100));
    const queueOverdue = rows.filter((appointment) => ['arrived', 'waiting'].includes(appointment.status) && this.waitMinutes(appointment) > 20).length;
    const riskRows = rows.filter((appointment) => this.appointmentRisk(appointment) !== 'Low');
    const pendingPayments = rows.filter((appointment) => this.paymentPending(appointment)).length;
    const blackoutCount = this.blackoutsForDate(this.selectedDate()).length;
    return [
      { label: 'Capacity', value: `${utilization}%`, hint: `${bookedMinutes} of ${capacityMinutes} staff minutes`, tone: utilization > 88 ? 'warning' : 'success' },
      { label: 'Conflicts', value: String(this.liveConflictCount()), hint: 'staff or chair overlaps', tone: this.liveConflictCount() ? 'danger' : 'success' },
      { label: 'Queue SLA', value: String(queueOverdue), hint: 'waiting over 20 min', tone: queueOverdue ? 'warning' : 'success', status: 'arrived' },
      { label: 'No-show risk', value: String(riskRows.length), hint: `${this.currency(riskRows.reduce((sum, row) => sum + this.appointmentValue(row), 0))} at risk`, tone: riskRows.length ? 'warning' : 'success', status: 'booked' },
      { label: 'Payment pending', value: String(pendingPayments), hint: 'deposit or collection watch', tone: pendingPayments ? 'warning' : 'success' },
      { label: 'Blackouts', value: String(blackoutCount), hint: 'branch closures on selected date', tone: blackoutCount ? 'danger' : 'success' }
    ];
  }

  focusInsight(insight: OperationInsight): void {
    if (insight.status !== undefined) this.statusFilter.set(insight.status);
    if (insight.label === 'Queue SLA') this.viewMode.set('queue');
    if (insight.label === 'Conflicts') this.viewMode.set('timeline');
  }

  liveConflictCount(): number {
    const rows = this.selectedDayAppointments()
      .filter((appointment) => !['cancelled', 'no-show'].includes(appointment.status));
    let conflicts = 0;
    for (let index = 0; index < rows.length; index += 1) {
      for (let next = index + 1; next < rows.length; next += 1) {
        const sameStaff = rows[index].staffId && rows[index].staffId === rows[next].staffId;
        const sameResource = this.resourceName(rows[index]) !== 'Unassigned' && this.resourceName(rows[index]) === this.resourceName(rows[next]);
        if ((sameStaff || sameResource) && this.overlaps(rows[index], rows[next])) conflicts += 1;
      }
    }
    return conflicts;
  }

  viewCount(view: CalendarView): number {
    if (view === 'queue') return this.queueAppointments().length;
    if (view === 'waitlist') return this.waitlistEntries().length + this.waitlistAppointments().length;
    if (view === 'resource') return this.resources().length;
    if (view === 'month') return this.appointments().length;
    return this.visibleAppointments().length;
  }

  weekDays(): Date[] {
    const base = new Date(`${this.selectedDate()}T00:00:00`);
    const start = new Date(base);
    start.setDate(base.getDate() - base.getDay());
    return Array.from({ length: 7 }, (_, index) => {
      const day = new Date(start);
      day.setDate(start.getDate() + index);
      return day;
    });
  }

  monthDays(): { date: Date; count: number; revenue: number; heat: number }[] {
    const selected = new Date(`${this.selectedDate()}T00:00:00`);
    const first = new Date(selected.getFullYear(), selected.getMonth(), 1);
    const last = new Date(selected.getFullYear(), selected.getMonth() + 1, 0);
    const days = Array.from({ length: last.getDate() }, (_, index) => new Date(selected.getFullYear(), selected.getMonth(), index + 1));
    const max = Math.max(1, ...days.map((day) => this.appointmentsForDate(day).length));
    return days.map((day) => {
      const rows = this.appointmentsForDate(day);
      return {
        date: day,
        count: rows.length,
        revenue: rows.reduce((sum, row) => sum + this.appointmentValue(row), 0),
        heat: rows.length / max
      };
    });
  }

  calendarDateStripDays(): CalendarDateStripDay[] {
    const selected = new Date(`${this.selectedDate()}T00:00:00`);
    const days = Array.from(
      { length: new Date(selected.getFullYear(), selected.getMonth() + 1, 0).getDate() },
      (_, index) => new Date(selected.getFullYear(), selected.getMonth(), index + 1)
    );
    return days.map((day) => {
      const rows = this.appointmentsForDate(day);
      const unbilled = rows.filter((appointment) => !['cancelled', 'no-show', 'billed', 'paid'].includes(String(appointment.status || '').toLowerCase())).length;
      const dateInput = this.toDateInput(day);
      return {
        date: day,
        dateInput,
        dayNumber: String(day.getDate()).padStart(2, '0'),
        weekday: day.toLocaleDateString('en-IN', { weekday: 'short' }),
        bookedCount: rows.length,
        unbilledCount: unbilled,
        selected: dateInput === this.selectedDate(),
        today: this.isToday(day)
      };
    });
  }

  dateStripRangeLabel(): string {
    const range = this.selectedMonthRange();
    return `From ${this.displayDate(range.from)} To ${this.displayDate(range.to)}`;
  }

  shiftBlocksForStaff(person: ApiRecord): StaffShiftBlock[] {
    return this.shiftBlocksByStaff().get(String(person.id || 'unassigned')) || [];
  }

  private buildShiftBlocksForStaff(person: ApiRecord): StaffShiftBlock[] {
    const ids = this.staffIdentityIds(person);
    const scheduleRows = this.staffSchedules()
      .filter((row) => ids.has(String(row.staffId || row.staff_id || '')))
      .filter((row) => this.rowDateValue(row, ['scheduleDate', 'schedule_date', 'date']) === this.selectedDate())
      .filter((row) => !['cancelled', 'deleted'].includes(String(row.status || '').toLowerCase()));
    const scheduled = scheduleRows.map((row) => this.scheduleToShiftBlock(row)).filter((block): block is StaffShiftBlock => !!block);
    const fallback = this.fallbackShiftBlockForStaff(person);
    if (scheduled.length) {
      const hasRegularRoster = scheduleRows.some((row) => !this.isBlockedSchedule(row));
      return hasRegularRoster || !fallback ? scheduled : [fallback, ...scheduled];
    }
    return fallback ? [fallback] : [];
  }

  previewSlotHover(person: ApiRecord, event: MouseEvent): void {
    const target = event.target as HTMLElement;
    if (target.closest('.scheduler-card') || target.closest('.resize-handle') || target.closest('.staff-head')) return;
    const lane = event.currentTarget as HTMLElement;
    const rect = lane.getBoundingClientRect();
    const rawY = event.clientY - rect.top - SCHEDULER_HEADER_HEIGHT;
    if (rawY < 0) {
      this.clearSlotHover();
      return;
    }
    const minute = Math.max(
      SCHEDULER_START_MINUTES,
      Math.min(SCHEDULER_END_MINUTES - this.slotMinutes(), SCHEDULER_START_MINUTES + Math.floor(rawY / this.slotHeight()) * this.slotMinutes())
    );
    const counts = this.slotCountsForStaff(person, minute);
    const staffName = this.staffName(String(person.id || ''));
    this.slotHoverContext.set({
      staffId: String(person.id || 'unassigned'),
      top: this.topForMinutes(minute),
      label: `${this.minutesLabel(minute)} - ${staffName} | ${counts.booked} - ${counts.unbilled} - ${counts.services}`
    });
  }

  clearSlotHover(): void {
    this.slotHoverContext.set(null);
  }

  blockTimeOptions(includeEnd: boolean): { value: string; label: string }[] {
    const start = includeEnd ? SCHEDULER_START_MINUTES + this.slotMinutes() : SCHEDULER_START_MINUTES;
    const end = includeEnd ? SCHEDULER_END_MINUTES : SCHEDULER_END_MINUTES - this.slotMinutes();
    const selectedStart = this.parseTimeValue(this.blockTimeStart());
    const options: { value: string; label: string }[] = [];
    for (let minute = start; minute <= end; minute += this.slotMinutes()) {
      if (includeEnd && selectedStart !== null && minute <= selectedStart) continue;
      options.push({ value: this.timeValue(minute), label: this.minutesLabel(minute) });
    }
    return options;
  }

  setBlockTimeStart(value: string): void {
    this.blockTimeStart.set(value);
    const start = this.parseTimeValue(value) ?? SCHEDULER_START_MINUTES;
    const end = this.parseTimeValue(this.blockTimeEnd()) ?? 0;
    if (end <= start) this.blockTimeEnd.set(this.timeValue(Math.min(SCHEDULER_END_MINUTES, start + Math.max(this.slotMinutes(), 30))));
  }

  canSaveBlockedTime(): boolean {
    const start = this.parseTimeValue(this.blockTimeStart());
    const end = this.parseTimeValue(this.blockTimeEnd());
    return !!this.blockTimeStaffId() && !!this.blockTimeDate() && start !== null && end !== null && end > start;
  }

  blockTimeStaffName(): string {
    return this.staffName(this.blockTimeStaffId());
  }

  blockedTimesForStaff(person: ApiRecord): ApiRecord[] {
    const ids = this.staffIdentityIds(person);
    return this.staffSchedules()
      .filter((row) => ids.has(String(row.staffId || row.staff_id || '')))
      .filter((row) => this.rowDateValue(row, ['scheduleDate', 'schedule_date', 'date']) === this.selectedDate())
      .filter((row) => this.isBlockedSchedule(row));
  }

  blockedTimesForStaffAtMinute(person: ApiRecord, minute: number): ApiRecord[] {
    const date = this.selectedDate();
    const probe = {
      startAt: this.dateAtMinutes(minute).toISOString(),
      endAt: new Date(this.dateAtMinutes(minute).getTime() + this.slotMinutes() * 60000).toISOString()
    };
    return this.blockedTimesForStaff(person).filter((row) => {
      const startTime = String(row.startTime || row.start_time || '');
      const endTime = String(row.endTime || row.end_time || '');
      if (!startTime || !endTime) return false;
      return this.overlaps(probe, { startAt: `${date}T${startTime}:00`, endAt: `${date}T${endTime}:00` });
    });
  }

  removableBlockedTimes(): ApiRecord[] {
    const person = this.staff().find((row) => this.staffIdentityIds(row).has(this.blockTimeStaffId()));
    const ids = person ? this.staffIdentityIds(person) : new Set([this.blockTimeStaffId()]);
    return this.staffSchedules()
      .filter((row) => ids.has(String(row.staffId || row.staff_id || '')))
      .filter((row) => this.rowDateValue(row, ['scheduleDate', 'schedule_date', 'date']) === this.blockTimeDate())
      .filter((row) => this.isBlockedSchedule(row))
      .sort((a, b) => String(a.startTime || a.start_time || '').localeCompare(String(b.startTime || b.start_time || '')));
  }

  saveBlockedTime(): void {
    if (!this.canSaveBlockedTime()) return;
    const person = this.staff().find((row) => this.staffIdentityIds(row).has(this.blockTimeStaffId()));
    const staffId = this.scheduleStaffId(person || { id: this.blockTimeStaffId() });
    if (!staffId) {
      this.error.set('Staff schedule ID is missing. Connect staff from Employee Masters.');
      return;
    }
    this.blockTimeSaving.set(true);
    this.error.set('');
    this.api.create<ApiRecord>('staff-os/schedules', {
      branchId: this.currentBranchId(),
      staffId,
      scheduleDate: this.blockTimeDate(),
      startTime: this.blockTimeStart(),
      endTime: this.blockTimeEnd(),
      shiftType: 'blocked',
      status: 'blocked',
      notes: this.blockTimeReason().trim() || 'Blocked time'
    }).subscribe({
      next: (row) => {
        this.staffSchedules.set([...this.staffSchedules(), row]);
        this.blockTimeSaving.set(false);
        this.closeBlockTimeDrawer();
        this.scheduleComboValidation();
      },
      error: (error) => {
        this.error.set(this.api.errorText(error, 'Unable to save blocked time'));
        this.blockTimeSaving.set(false);
      }
    });
  }

  removeBlockedTime(row: ApiRecord): void {
    const id = String(row.id || '');
    if (!id) return;
    this.blockTimeSaving.set(true);
    this.api.delete('staff-os/schedules', id).subscribe({
      next: () => {
        this.staffSchedules.set(this.staffSchedules().filter((item) => String(item.id || '') !== id));
        this.blockTimeSaving.set(false);
        if (!this.removableBlockedTimes().length) this.closeBlockTimeDrawer();
        this.scheduleComboValidation();
      },
      error: (error) => {
        this.error.set(this.api.errorText(error, 'Unable to remove blocked time'));
        this.blockTimeSaving.set(false);
      }
    });
  }

  staffLoad(staffId: string): { booked: number; idle: number } {
    return this.staffLoadRows().get(String(staffId)) || { booked: 0, idle: 600 };
  }

  smartSlotRecommendations(): SmartSlot[] {
    const value = this.form.value;
    const serviceIds = this.currentServiceIds();
    if (!serviceIds.length) return [];
    const duration = this.selectedServiceDuration();
    const branchId = String(value.branchId || this.currentBranchId());
    const candidateStaff = (value.staffId ? this.staff().filter((person) => person.id === value.staffId) : this.staff())
      .filter((person) => !branchId || !person.branchId || person.branchId === branchId)
      .slice(0, 18);
    if (!candidateStaff.length) return [];
    const resourcePool = this.resources().filter((resource) => resource !== 'Unassigned');
    const slots: SmartSlot[] = [];
    for (const person of candidateStaff) {
      for (const hour of [9, 10, 11, 12, 14, 15, 16, 17, 18]) {
        for (const minute of [0, 30]) {
          const start = new Date(`${this.selectedDate()}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00`);
          if (start.getHours() >= 19) continue;
          const end = new Date(start.getTime() + duration * 60000);
          const resource = this.bestResourceForSlot(start, end, resourcePool);
          const probe = { staffId: person.id, chair: resource, startAt: start.toISOString(), endAt: end.toISOString(), serviceIds };
          if (this.blackoutsForDate(start).length || this.hasHardConflict(probe)) continue;
          const load = this.staffDayLoad(person.id, this.selectedDate());
          const gapBonus = this.nearestGapMinutes(person.id, start, end);
          const score = Math.max(40, Math.min(99, 95 - Math.round(load / 42) + Math.min(12, Math.round(gapBonus / 20))));
          slots.push({
            startAt: this.toDateTimeInput(start),
            staffId: person.id,
            staffName: person.name || 'Staff',
            resource,
            score,
            load,
            reason: load < 180 ? 'low staff load' : gapBonus >= 60 ? 'clean calendar gap' : 'balanced handoff'
          });
        }
      }
    }
    return slots.sort((a, b) => b.score - a.score || a.load - b.load || a.startAt.localeCompare(b.startAt)).slice(0, 8);
  }

  applySmartSlot(slot: SmartSlot): void {
    this.form.patchValue({
      staffId: slot.staffId,
      startAt: slot.startAt,
      chair: slot.resource
    });
    const person = this.staff().find((item) => item.id === slot.staffId);
    if (person) this.staffSearch.set(this.staffOptionLabel(person));
    const first = this.bookingServiceLines()[0];
    if (first) {
      this.updateBookingLine(first.id, {
        staffId: slot.staffId,
        startAt: slot.startAt,
        chair: slot.resource
      });
      if (this.bookingServiceLines().length > 1) this.autoSequenceBookingLines();
    }
  }

  statusLaneAppointments(status: string): ApiRecord[] {
    return this.statusLaneRows().get(status) || [];
  }

  openAppointment(appointment: ApiRecord): void {
    this.selectedAppointment.set(appointment);
    this.rescheduleAt.set(this.toDateTimeInput(appointment.startAt));
    this.rescheduleStaffId.set('');
    this.touchupEligibility.set(null);
    this.appointmentAudit.set([]);
    this.drawerNotice.set('');
    this.auditLoading.set(true);
    this.api.list<ApiRecord>(`appointments/${appointment.id}/touchup-eligibility`).subscribe({
      next: (eligibility) => this.touchupEligibility.set(eligibility),
      error: () => this.touchupEligibility.set({ eligible: false, reason: 'Warranty check unavailable' })
    });
    this.api.list<ApiRecord>(`appointment-activity/appointments/${appointment.id}/timeline`, { limit: 25 }).subscribe({
      next: (audit) => {
        const logs = Array.isArray(audit?.timeline) ? audit.timeline : Array.isArray(audit?.auditLogs) ? audit.auditLogs : Array.isArray(audit) ? audit : [];
        this.appointmentAudit.set(logs.slice(0, 8));
        this.auditLoading.set(false);
      },
      error: () => {
        this.appointmentAudit.set([]);
        this.auditLoading.set(false);
      }
    });
  }

  closeAppointment(): void {
    this.selectedAppointment.set(null);
    this.touchupEligibility.set(null);
    this.appointmentAudit.set([]);
    this.drawerNotice.set('');
  }

  runAction(appointment: ApiRecord, action: string): void {
    this.api.post<{ appointment?: ApiRecord }>(`appointments/${appointment.id}/${action}`, {}).subscribe({
      next: (result) => this.afterAppointmentChange(result.appointment || appointment),
      error: (error) => this.error.set(error?.error?.error || error?.message || `Unable to run ${action}`)
    });
  }

  cancel(appointment: ApiRecord): void {
    this.api.post<{ appointment?: ApiRecord }>(`appointments/${appointment.id}/cancel`, { reason: 'Front desk cancellation' }).subscribe({
      next: (result) => this.afterAppointmentChange(result.appointment || appointment),
      error: (error) => this.error.set(error?.error?.error || error?.message || 'Unable to cancel appointment')
    });
  }

  reschedule(appointment: ApiRecord): void {
    const probe = {
      ...appointment,
      staffId: this.rescheduleStaffId() || appointment.staffId,
      startAt: new Date(this.rescheduleAt()).toISOString(),
      endAt: new Date(new Date(this.rescheduleAt()).getTime() + this.durationMinutes(appointment) * 60000).toISOString()
    };
    if (this.hasHardConflict(probe, appointment.id)) {
      this.error.set('Selected reschedule slot overlaps staff or chair capacity.');
      return;
    }
    this.api.post<{ appointment?: ApiRecord }>(`appointments/${appointment.id}/reschedule`, {
      startAt: new Date(this.rescheduleAt()).toISOString(),
      staffId: this.rescheduleStaffId() || appointment.staffId,
      reason: 'Front desk reschedule'
    }).subscribe({
      next: (result) => this.afterAppointmentChange(result.appointment || appointment),
      error: (error) => this.error.set(error?.error?.error || error?.message || 'Unable to reschedule appointment')
    });
  }

  createTouchup(appointment: ApiRecord): void {
    this.api.post<{ appointment?: ApiRecord }>(`appointments/${appointment.id}/create-touchup`, {
      startAt: new Date(this.rescheduleAt()).toISOString(),
      staffId: this.rescheduleStaffId() || appointment.staffId,
      chair: appointment.chair || 'Chair 1'
    }).subscribe({
      next: (result) => this.afterAppointmentChange(result.appointment || appointment),
      error: (error) => this.error.set(error?.error?.error || error?.message || 'Unable to create touch-up')
    });
  }

  allowDrop(event: DragEvent): void {
    event.preventDefault();
  }

  startSchedulerDrag(appointment: ApiRecord): void {
    this.draggingId = appointment.id;
  }

  endSchedulerDrag(): void {
    this.draggingId = '';
  }

  dropOnScheduler(staffId: string, event: DragEvent): void {
    event.preventDefault();
    if (!this.draggingId) return;
    const appointment = this.appointments().find((item) => item.id === this.draggingId);
    if (!appointment) {
      this.draggingId = '';
      return;
    }
    const lane = event.currentTarget as HTMLElement;
    const rect = lane.getBoundingClientRect();
    const rawY = event.clientY - rect.top - SCHEDULER_HEADER_HEIGHT;
    const minutes = this.snapMinutes(SCHEDULER_START_MINUTES + (Math.max(0, rawY) / this.slotHeight()) * this.slotMinutes());
    const nextStart = this.dateAtMinutes(minutes);
    const nextEnd = new Date(nextStart.getTime() + this.durationMinutes(appointment) * 60000);
    this.moveAppointment(appointment, staffId, nextStart, nextEnd, 'Calendar drag-drop');
  }

  startResize(event: PointerEvent, appointment: ApiRecord): void {
    event.preventDefault();
    event.stopPropagation();
    this.resizeState = {
      appointment,
      startY: event.clientY,
      startHeight: this.heightForDuration(this.durationMinutes(appointment)),
      nextHeight: this.heightForDuration(this.durationMinutes(appointment))
    };
    this.resizePreview.set({ id: appointment.id, height: this.resizeState.startHeight });
    document.addEventListener('pointermove', this.onResizeMove);
    document.addEventListener('pointerup', this.onResizeEnd);
  }

  private resizeMove(event: PointerEvent): void {
    if (!this.resizeState) return;
    const delta = event.clientY - this.resizeState.startY;
    const snapped = Math.round(delta / this.slotHeight()) * this.slotHeight();
    const nextHeight = Math.max(this.heightForDuration(this.slotMinutes()), this.resizeState.startHeight + snapped);
    this.resizeState.nextHeight = nextHeight;
    this.resizePreview.set({ id: this.resizeState.appointment.id, height: nextHeight });
  }

  private resizeEnd(event: PointerEvent): void {
    event.preventDefault();
    const state = this.resizeState;
    this.clearResizeListeners();
    if (!state) return;
    const durationSlots = Math.max(1, Math.round(state.nextHeight / this.slotHeight()));
    const duration = durationSlots * this.slotMinutes();
    const start = this.appointmentStart(state.appointment);
    const end = new Date(start.getTime() + duration * 60000);
    this.moveAppointment(state.appointment, state.appointment.staffId || 'unassigned', start, end, 'Calendar resize');
  }

  private clearResizeListeners(): void {
    document.removeEventListener('pointermove', this.onResizeMove);
    document.removeEventListener('pointerup', this.onResizeEnd);
    this.resizeState = null;
    this.resizePreview.set(null);
  }

  dropStatus(status: string, event?: DragEvent): void {
    event?.preventDefault();
    if (!this.draggingId) return;
    this.api.post<{ appointment?: ApiRecord }>(`appointments/${this.draggingId}/status`, { status }).subscribe({
      next: (result) => this.afterAppointmentChange(result.appointment || { id: this.draggingId, status }),
      error: (error) => this.error.set(error?.error?.error || error?.message || 'Unable to update status')
    });
    this.draggingId = '';
  }

  private moveAppointment(appointment: ApiRecord, staffId: string, start: Date, end: Date, reason: string): void {
    const nextStaffId = staffId === 'unassigned' ? String(appointment.staffId || '') : staffId;
    const probe = {
      ...appointment,
      staffId: nextStaffId,
      startAt: start.toISOString(),
      endAt: end.toISOString()
    };
    if (this.hasHardConflict(probe, appointment.id)) {
      this.error.set('Selected calendar slot overlaps staff or chair capacity.');
      this.draggingId = '';
      return;
    }
    this.api.post<{ appointment?: ApiRecord }>(`appointments/${appointment.id}/reschedule`, {
      startAt: start.toISOString(),
      endAt: end.toISOString(),
      staffId: nextStaffId,
      chair: appointment.chair || appointment.chairId || '',
      reason
    }).subscribe({
      next: (result) => this.afterAppointmentChange(result.appointment || appointment),
      error: (error) => this.error.set(error?.error?.error || error?.message || 'Unable to update calendar timing')
    });
    this.draggingId = '';
  }

  copyWhatsAppDraft(appointment: ApiRecord, kind: 'reminder' | 'payment' | 'recovery'): void {
    const client = this.clientRecord(appointment.clientId);
    const name = client?.name || 'Client';
    const amount = this.currency(this.appointmentValue(appointment));
    const date = this.appointmentStart(appointment).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
    const services = this.serviceNames(appointment.serviceIds).toLowerCase();
    const base = `Hi ${name}, your ${services} appointment at AuraShine is scheduled for ${date} with ${this.staffName(appointment.staffId)}.`;
    const message = kind === 'payment'
      ? `${base} Estimated amount is ${amount}. Please keep payment ready or ask us for a secure payment link.`
      : kind === 'recovery'
        ? `Hi ${name}, we missed you for your AuraShine appointment. Reply with your preferred time and we will arrange the nearest available slot.`
        : `${base} Please reply YES to confirm or call us if you need to reschedule.`;
    if (!navigator?.clipboard) {
      this.drawerNotice.set(message);
      return;
    }
    navigator.clipboard.writeText(message)
      .then(() => this.drawerNotice.set('Draft copied for front desk follow-up.'))
      .catch(() => this.drawerNotice.set(message));
  }

  smsRecipientPreview(appointment: ApiRecord, target: SmsRecipientTarget): string {
    const phone = this.appointmentSmsRecipient(appointment, target);
    if (phone) return phone;
    return target === 'owner'
      ? 'Add owner mobile in Business Details'
      : target === 'staff'
        ? 'Add staff mobile in Staff page'
        : 'Add client mobile in Client page';
  }

  queueAppointmentSms(appointment: ApiRecord, target: SmsRecipientTarget): void {
    if (!appointment.id) {
      this.drawerNotice.set('Save the appointment before queueing SMS.');
      return;
    }
    this.smsQueueTarget.set(target);
    this.api.post<ApiRecord>(`appointment-sms/appointments/${appointment.id}/queue`, { target }).subscribe({
      next: (result) => {
        const recipients = Array.isArray(result.recipients) ? result.recipients.map((row: ApiRecord) => row.phone).filter(Boolean) : [];
        this.drawerNotice.set(`${this.label(target)} SMS queued${recipients.length ? ` to ${recipients.join(', ')}` : ''}.`);
        this.smsQueueTarget.set('');
      },
      error: (error) => {
        this.drawerNotice.set(this.api.errorText(error, `Unable to queue ${target} SMS`));
        this.smsQueueTarget.set('');
      }
    });
  }

  private appointmentSmsRecipient(appointment: ApiRecord, target: SmsRecipientTarget): string {
    if (target === 'client') return this.phoneFromRecord(this.clientRecord(appointment.clientId));
    if (target === 'staff') return this.phoneFromRecord(this.staffRecord(appointment.staffId));
    const profile = this.businessProfile() || {};
    const ownerMobiles = Array.isArray(profile.ownerMobiles) ? profile.ownerMobiles : [];
    return this.firstPhone([
      ...ownerMobiles,
      profile.ownerMobile,
      profile.mobileNumber,
      profile.appointmentNumber,
      profile.telephoneNumber
    ]);
  }

  private staffRecord(id: string): ApiRecord | undefined {
    return this.staff().find((item) => item.id === id || item.staffOsId === id || this.staffIdentityIds(item).has(String(id || '')));
  }

  private phoneFromRecord(record: ApiRecord | undefined): string {
    if (!record) return '';
    return this.firstPhone([
      record.phone,
      record.mobile,
      record.mobileNumber,
      record.contactNumber,
      record.whatsapp,
      record.whatsappNumber,
      record.primaryPhone,
      record.staffPhone
    ]);
  }

  private firstPhone(values: unknown[]): string {
    for (const value of values) {
      const phone = this.normalizeSmsPhone(value);
      if (phone) return phone;
    }
    return '';
  }

  private normalizeSmsPhone(value: unknown): string {
    const raw = String(value || '').trim();
    if (!raw) return '';
    const digits = raw.replace(/\D/g, '');
    if (digits.length < 7) return '';
    if (digits.startsWith('00') && digits.length > 4) return `+${digits.slice(2)}`;
    if (digits.length === 11 && digits.startsWith('0')) return `+91${digits.slice(1)}`;
    if (digits.length === 10) return `+91${digits}`;
    if (digits.length === 12 && digits.startsWith('91')) return `+${digits}`;
    if (raw.startsWith('+')) return `+${digits}`;
    return digits.length <= 15 ? `+${digits}` : '';
  }

  afterAppointmentChange(appointment: ApiRecord): void {
    this.loadAppointmentsForCurrentRange();
    const current = this.selectedAppointment();
    if (current) {
      this.selectedAppointment.set({ ...current, ...appointment });
    }
  }

  appointmentBadges(appointment: ApiRecord): { label: string; variant: string }[] {
    const client = this.clientRecord(appointment.clientId);
    const badges: { label: string; variant: string }[] = [];
    const tier = String(client?.tier || client?.loyaltyTier || '').toLowerCase();
    if (['gold', 'platinum', 'vip'].includes(tier) || String(client?.tags || '').toLowerCase().includes('vip')) {
      badges.push({ label: 'VIP', variant: 'badge-primary' });
    }
    if (Number(client?.visits || client?.visitCount || client?.totalVisits || 0) <= 1) badges.push({ label: 'First visit', variant: 'badge-info' });
    if (this.isLate(appointment)) badges.push({ label: 'Late', variant: 'badge-danger' });
    if (appointment.isTouchup || appointment.is_touchup) badges.push({ label: 'Touch-up', variant: 'badge-warning' });
    if (Number(client?.noShowCount || client?.noShows || 0) >= 2 || appointment.status === 'no-show') badges.push({ label: 'No-show risk', variant: 'badge-warning' });
    if (String(appointment.paymentStatus || appointment.depositStatus || '').toLowerCase().includes('pending')) badges.push({ label: 'Payment pending', variant: 'badge-danger' });
    if (appointment.sourceChannel || appointment.source) badges.push({ label: this.sourceLabel(appointment), variant: 'badge-success' });
    return badges.slice(0, 6);
  }

  bookingGuard(): BookingGuard {
    return this.bookingGuardState();
  }

  private buildBookingGuard(): BookingGuard {
    const value = this.form.value;
    const branchId = String(value.branchId || '');
    const clientId = String(value.clientId || '');
    const rawLines = this.bookingDrawerOpen()
      ? this.bookingServiceLines()
      : [this.createBookingLine({
          serviceId: String(value.serviceId || ''),
          staffId: String(value.staffId || ''),
          startAt: String(value.startAt || ''),
          durationMinutes: Number(value.durationMinutes || this.selectedServiceDuration()),
          chair: String(value.chair || 'Chair 1')
        })];
    const incompleteLine = rawLines.some((line) => {
      const start = new Date(String(line.startAt || ''));
      return !line.serviceId || !line.staffId || !line.startAt || Number(line.durationMinutes || 0) < 15 || Number.isNaN(start.getTime());
    });
    if (!clientId || !branchId || !rawLines.length || incompleteLine) {
      return {
        level: 'warning',
        title: 'Booking inputs pending',
        details: ['Complete client, branch, service, staff, start time and duration in every service row.'],
        hardBlock: !!clientId && !!branchId && incompleteLine
      };
    }
    const lines = this.bookingDrawerOpen() ? this.normalizedBookingLines() : rawLines;
    const details: string[] = [];
    let hardBlock = false;
    const planProbes: ApiRecord[] = [];
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      const start = new Date(String(line.startAt));
      if (Number.isNaN(start.getTime())) {
        return { level: 'danger', title: 'Invalid start time', details: [`Line ${index + 1}: choose a valid appointment date and time.`], hardBlock: true };
      }
      const end = new Date(start.getTime() + this.coerceLineDuration(line.serviceId, line.durationMinutes) * 60000);
      const probe = {
        clientId,
        staffId: line.staffId,
        branchId,
        chair: line.chair || value.chair || 'Chair 1',
        startAt: start.toISOString(),
        endAt: end.toISOString(),
        serviceIds: [line.serviceId]
      };
      const blackouts = this.blackoutsForDate(start).filter((blackout) => {
        const walkInBlocked = value.walkIn && Number(blackout.blockWalkin ?? blackout.block_walkin ?? 1) === 1;
        const onlineBlocked = !value.walkIn && Number(blackout.blockOnline ?? blackout.block_online ?? 1) === 1;
        return walkInBlocked || onlineBlocked;
      });
      if (blackouts.length) {
        hardBlock = true;
        details.push(`Line ${index + 1}: branch blackout - ${blackouts[0].reason || 'unavailable date'}.`);
      }
      const blockedTime = this.conflictingBlockedTimes(probe);
      if (blockedTime.length) {
        hardBlock = true;
        details.push(`Line ${index + 1}: ${this.staffName(line.staffId)} blocked ${this.displayTimeValue(blockedTime[0].startTime || blockedTime[0].start_time)} - ${this.displayTimeValue(blockedTime[0].endTime || blockedTime[0].end_time)}.`);
      }
      const calendarConflict = this.conflictingAppointments(probe);
      if (calendarConflict.length) {
        hardBlock = true;
        details.push(`Line ${index + 1}: conflict with ${this.clientName(calendarConflict[0].clientId)} at ${this.timeRange(calendarConflict[0])}.`);
      }
      const planConflict = planProbes.find((existing) => {
        const sameStaff = existing.staffId === probe.staffId;
        const sameChair = this.resourceName(existing) !== 'Unassigned' && this.resourceName(existing) === this.resourceName(probe);
        return (sameStaff || sameChair) && this.overlaps(existing, probe);
      });
      if (planConflict) {
        hardBlock = true;
        details.push(`Line ${index + 1}: same plan overlaps another selected staff/chair slot.`);
      }
      planProbes.push(probe);
    }
    const combo = this.comboValidation();
    const violations = Array.isArray(combo?.violations) ? combo.violations : [];
    if (violations.length) {
      const blocking = violations.some((violation: ApiRecord) => !violation.allowOverride);
      hardBlock = hardBlock || blocking;
      details.push(violations[0].warningMessage || 'Service rule needs manager review.');
    }
    const client = this.clientRecord(String(value.clientId || ''));
    if (Number(client?.noShowCount || client?.noShows || 0) >= 2) details.push('Client has repeated no-show history.');
    if (!String(client?.phone || client?.mobile || '').trim()) details.push('Client phone is missing for WhatsApp confirmation.');
    if (!details.length) details.push(`${lines.length} service line${lines.length === 1 ? '' : 's'} clear across selected staff and chair schedule.`);
    return {
      level: hardBlock ? 'danger' : details.length > 1 || violations.length ? 'warning' : 'success',
      title: hardBlock ? 'Booking blocked' : details.length > 1 || violations.length ? 'Manager watch' : 'Ready to book',
      details,
      hardBlock
    };
  }

  appointmentRisk(appointment: ApiRecord): string {
    const client = this.clientRecord(appointment.clientId);
    const score = Number(appointment.noShowRiskScore || appointment.no_show_risk_score || client?.noShowCount || client?.noShows || 0);
    if (appointment.status === 'no-show' || score >= 70 || Number(client?.noShowCount || client?.noShows || 0) >= 2) return 'High';
    if (score >= 35 || this.paymentPending(appointment) || this.isLate(appointment)) return 'Medium';
    return 'Low';
  }

  paymentPending(appointment: ApiRecord): boolean {
    const status = String(appointment.paymentStatus || appointment.depositStatus || '').toLowerCase();
    if (!status || status === 'not_required' || status === 'paid') return false;
    return ['pending', 'unpaid', 'due', 'failed', 'partial'].some((item) => status.includes(item));
  }

  waitMinutes(appointment: ApiRecord): number {
    const since = new Date(appointment.arrivedAt || appointment.checkInAt || appointment.startAt || Date.now()).getTime();
    return Math.max(0, Math.round((Date.now() - since) / 60000));
  }

  auditActionLabel(event: ApiRecord): string {
    return this.label(event.action || event.event || event.type || 'audit event');
  }

  auditTimestamp(event: ApiRecord): string {
    return event.createdAt || event.timestamp || event.occurredAt || new Date().toISOString();
  }

  auditDetails(event: ApiRecord): string {
    if (event.reason || event.riskReason || event.suggestedAction) {
      return [event.reason, event.riskReason, event.suggestedAction].filter(Boolean).join(' · ');
    }
    if (Array.isArray(event.changes) && event.changes.length) {
      return event.changes.slice(0, 2).map((change: ApiRecord) => `${change.field}: ${change.oldValue} -> ${change.newValue}`).join(' · ');
    }
    const details = event.details || event.metadata || event.payload || '';
    if (!details) return event.actorUserId || event.userId || 'System action';
    const text = typeof details === 'string' ? details : JSON.stringify(details);
    return text.length > 120 ? `${text.slice(0, 117)}...` : text;
  }

  nextBestAction(appointment: ApiRecord): string {
    if (appointment.status === 'no-show') return 'Send recovery WhatsApp';
    if (appointment.status === 'rescheduled') return 'Offer nearest slot';
    return 'Convert waitlist to booking';
  }

  isTerminal(appointment: ApiRecord): boolean {
    return ['completed', 'billed', 'paid', 'cancelled', 'no-show'].includes(appointment.status);
  }

  isLate(appointment: ApiRecord): boolean {
    return ['booked', 'confirmed', 'arrived'].includes(appointment.status) && Date.now() > this.appointmentStart(appointment).getTime() + 5 * 60000;
  }

  timelineLeft(appointment: ApiRecord): number {
    const start = this.appointmentStart(appointment);
    const hour = start.getHours() + start.getMinutes() / 60;
    return Math.max(0, Math.min(94, ((hour - 9) / 10) * 100));
  }

  timelineWidth(appointment: ApiRecord): number {
    return Math.max(8, Math.min(36, (this.durationMinutes(appointment) / 600) * 100));
  }

  clientName(id: string): string {
    return this.clientRecord(id)?.name || 'Client';
  }

  staffName(id: string): string {
    const person = this.staff().find((item) => item.id === id || item.staffOsId === id || this.staffIdentityIds(item).has(id));
    return person?.name || person?.fullName || 'Staff';
  }

  serviceNames(ids: string[] = []): string {
    return this.normalizeServiceIds(ids).map((id) => this.services().find((service) => service.id === id)?.name || id).join(', ') || 'No service';
  }

  currentServiceIds(): string[] {
    const lineIds = this.bookingDrawerOpen()
      ? this.bookingServiceLines().map((line) => line.serviceId)
      : [];
    return this.normalizeServiceIds(lineIds.length ? lineIds : [this.form.value.serviceId]);
  }

  selectedServiceDuration(): number {
    if (this.bookingDrawerOpen() && this.bookingServiceLines().length) {
      const total = this.bookingServiceLines()
        .filter((line) => line.serviceId)
        .reduce((sum, line) => sum + this.coerceLineDuration(line.serviceId, line.durationMinutes), 0);
      if (total >= 15) return total;
    }
    const manualDuration = Number(this.form.value.durationMinutes || 0);
    if (manualDuration >= 15) return manualDuration;
    return Math.max(15, this.currentServiceIds().reduce((sum, id) => sum + this.serviceDurationById(id), 0) || 30);
  }

  serviceDurationById(id: string): number {
    const service = this.services().find((item) => item.id === id);
    return Number(service?.durationMinutes || service?.duration || 30)
      + Number(service?.processingTimeMin || 0)
      + Number(service?.cleanupTimeMin || 0);
  }

  currentBranchId(): string {
    return String(this.form.value.branchId || this.api.selectedBranchId() || this.branches()[0]?.id || '');
  }

  timeRange(appointment: ApiRecord): string {
    const start = this.appointmentStart(appointment);
    const end = this.appointmentEnd(appointment);
    return `${this.timeLabel(start)} - ${this.timeLabel(end)}`;
  }

  label(value = ''): string {
    return String(value || '').replace(/[-_]/g, ' ').replace(/\b\w/g, (match) => match.toUpperCase());
  }

  statusClass(status = ''): string {
    return `status-${String(status || 'booked').replace(/_/g, '-')}`;
  }

  initials(name = ''): string {
    return String(name || 'A').split(' ').map((part) => part[0]).join('').slice(0, 2).toUpperCase();
  }

  staffAvatarColor(person: ApiRecord): string {
    const seed = String(person.id || person.name || 'staff').split('').reduce((sum, char) => sum + char.charCodeAt(0), 0);
    const palette = ['#dbeafe', '#dcfce7', '#fef3c7', '#fce7f3', '#ede9fe', '#cffafe', '#ffedd5'];
    return palette[seed % palette.length];
  }

  sourceLabel(appointment: ApiRecord): string {
    return this.label(appointment.sourceChannel || appointment.source || 'front-desk');
  }

  currency(value: number): string {
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(Number(value || 0));
  }

  resourceName(appointment: ApiRecord): string {
    return appointment.chair || appointment.chairId || appointment.room || appointment.roomId || 'Unassigned';
  }

  appointmentValue(appointment: ApiRecord): number {
    const serviceIds = this.normalizeServiceIds(appointment.serviceIds || appointment.serviceIdsJson || appointment.services);
    return serviceIds.reduce((sum: number, id: string) => sum + Number(this.services().find((service) => service.id === id)?.price || 0), 0);
  }

  durationMinutes(appointment: ApiRecord): number {
    if (appointment.startAt && appointment.endAt) {
      const minutes = (new Date(appointment.endAt).getTime() - new Date(appointment.startAt).getTime()) / 60000;
      if (Number.isFinite(minutes) && minutes > 0) return Math.round(minutes);
    }
    return this.normalizeServiceIds(appointment.serviceIds || appointment.serviceIdsJson || appointment.services)
      .reduce((sum: number, id: string) => sum + this.serviceDurationById(id), 0) || 30;
  }

  isToday(date: Date): boolean {
    return this.toDateInput(date) === this.toDateInput(new Date());
  }

  isSameDay(value: string | Date, compare: string | Date): boolean {
    return this.toDateInput(new Date(value)) === this.toDateInput(new Date(compare));
  }

  appointmentStart(appointment: ApiRecord): Date {
    return new Date(appointment.startAt || appointment.startTime || Date.now());
  }

  appointmentEnd(appointment: ApiRecord): Date {
    const start = this.appointmentStart(appointment);
    const explicit = appointment.endAt || appointment.endTime;
    if (explicit) {
      const end = new Date(explicit);
      if (!Number.isNaN(end.getTime())) return end;
    }
    return new Date(start.getTime() + this.durationMinutes(appointment) * 60000);
  }

  clientRecord(id: string): ApiRecord | undefined {
    return this.clients().find((client) => client.id === id);
  }

  blackoutsForDate(date: Date | string): ApiRecord[] {
    const selected = this.toDateInput(date);
    const branchId = this.currentBranchId();
    return this.blackouts().filter((blackout) => {
      const from = String(blackout.blackoutDate || blackout.blackout_date || '').slice(0, 10);
      const to = String(blackout.blackoutUntil || blackout.blackout_until || from).slice(0, 10);
      const blackoutBranch = String(blackout.branchId || blackout.branch_id || '');
      return from <= selected && selected <= to && (!blackoutBranch || !branchId || blackoutBranch === branchId);
    });
  }

  conflictingAppointments(probe: ApiRecord, ignoreId = ''): ApiRecord[] {
    return this.appointments()
      .filter((appointment) => appointment.id !== ignoreId)
      .filter((appointment) => !['cancelled', 'no-show'].includes(appointment.status))
      .filter((appointment) => this.isSameDay(appointment.startAt, probe.startAt))
      .filter((appointment) => {
        const sameStaff = appointment.staffId && appointment.staffId === probe.staffId;
        const sameResource = this.resourceName(appointment) !== 'Unassigned' && this.resourceName(appointment) === this.resourceName(probe);
        return (sameStaff || sameResource) && this.overlaps(appointment, probe);
      });
  }

  hasHardConflict(probe: ApiRecord, ignoreId = ''): boolean {
    return this.conflictingAppointments(probe, ignoreId).length > 0 || this.conflictingBlockedTimes(probe).length > 0;
  }

  conflictingBlockedTimes(probe: ApiRecord): ApiRecord[] {
    const date = this.toDateInput(probe.startAt);
    const staffIds = this.staffIdsForAnyId(String(probe.staffId || ''));
    return this.staffSchedules()
      .filter((row) => this.isBlockedSchedule(row))
      .filter((row) => this.rowDateValue(row, ['scheduleDate', 'schedule_date', 'date']) === date)
      .filter((row) => staffIds.has(String(row.staffId || row.staff_id || '')))
      .filter((row) => {
        const startTime = String(row.startTime || row.start_time || '');
        const endTime = String(row.endTime || row.end_time || '');
        if (!startTime || !endTime) return false;
        return this.overlaps(probe, {
          startAt: `${date}T${startTime}:00`,
          endAt: `${date}T${endTime}:00`
        });
      });
  }

  overlaps(first: ApiRecord, second: ApiRecord): boolean {
    const firstStart = this.appointmentStart(first).getTime();
    const firstEnd = this.appointmentEnd(first).getTime();
    const secondStart = this.appointmentStart(second).getTime();
    const secondEnd = this.appointmentEnd(second).getTime();
    return firstStart < secondEnd && secondStart < firstEnd;
  }

  bestResourceForSlot(start: Date, end: Date, resources: string[]): string {
    const pool = resources.length ? resources : ['Chair 1', 'Chair 2', 'Chair 3', 'Room A'];
    const scored = pool.map((resource) => {
      const probe = { startAt: start.toISOString(), endAt: end.toISOString(), chair: resource };
      const dayRows = this.appointmentsByDate().get(this.toDateInput(start)) || [];
      const collisions = dayRows
        .filter((appointment) => this.resourceName(appointment) === resource && this.overlaps(appointment, probe))
        .length;
      const total = dayRows.filter((appointment) => this.resourceName(appointment) === resource).length;
      return { resource, score: collisions * 100 + total };
    });
    return scored.sort((a, b) => a.score - b.score || a.resource.localeCompare(b.resource))[0]?.resource || 'Chair 1';
  }

  staffDayLoad(staffId: string, date: string | Date): number {
    return (this.appointmentsByDate().get(this.toDateInput(date)) || [])
      .filter((appointment) => appointment.staffId === staffId && this.isSameDay(appointment.startAt, date))
      .filter((appointment) => !['cancelled', 'no-show'].includes(appointment.status))
      .reduce((sum, appointment) => sum + this.durationMinutes(appointment), 0);
  }

  nearestGapMinutes(staffId: string, start: Date, end: Date): number {
    const rows = (this.appointmentsByDate().get(this.toDateInput(start)) || [])
      .filter((appointment) => appointment.staffId === staffId && this.isSameDay(appointment.startAt, start))
      .filter((appointment) => !['cancelled', 'no-show'].includes(appointment.status));
    if (!rows.length) return 180;
    return Math.max(0, Math.min(...rows.map((appointment) => {
      const before = Math.abs(start.getTime() - this.appointmentEnd(appointment).getTime()) / 60000;
      const after = Math.abs(this.appointmentStart(appointment).getTime() - end.getTime()) / 60000;
      return Math.min(before, after);
    })));
  }

  private selectedMonthRange(): { from: string; to: string } {
    const selected = new Date(`${this.selectedDate()}T00:00:00`);
    const first = new Date(selected.getFullYear(), selected.getMonth(), 1);
    const last = new Date(selected.getFullYear(), selected.getMonth() + 1, 0);
    return { from: this.toDateInput(first), to: this.toDateInput(last) };
  }

  private appointmentLoadRange(): { from: string; to: string } {
    const selected = new Date(`${this.selectedDate()}T00:00:00`);
    const first = new Date(selected.getFullYear(), selected.getMonth(), 1);
    const nextMonth = new Date(selected.getFullYear(), selected.getMonth() + 1, 1);
    return { from: first.toISOString(), to: nextMonth.toISOString() };
  }

  private loadStaffSchedulesForSelectedMonth(): void {
    const range = this.selectedMonthRange();
    this.api.list<ApiRecord[]>('staff-os/schedules', {
      branchId: this.currentBranchId(),
      from: range.from,
      to: range.to,
      limit: 500
    }).subscribe({
      next: (rows) => this.staffSchedules.set(rows || []),
      error: () => this.staffSchedules.set([])
    });
  }

  private mergeStaffRows(legacyRows: ApiRecord[], staffOsRows: ApiRecord[]): ApiRecord[] {
    const merged: ApiRecord[] = [];
    const byId = new Map<string, ApiRecord>();
    const byName = new Map<string, ApiRecord>();
    const add = (row: ApiRecord, source: 'legacy' | 'staff-os') => {
      const normalized = this.normalizeStaffRow(row, source);
      const id = String(normalized.id || '');
      const nameKey = this.staffNameKey(normalized);
      const sameId = id ? byId.get(id) : undefined;
      if (sameId) {
        Object.assign(sameId, { ...normalized, id: sameId.id, name: sameId.name || normalized.name });
        sameId.linkedStaffIds = Array.from(new Set([...(sameId.linkedStaffIds || []), ...(normalized.linkedStaffIds || []), id].filter(Boolean)));
        return;
      }
      const sameName = byName.get(nameKey);
      if (sameName && source === 'staff-os') {
        sameName.staffOsId = id;
        sameName.employeeDetails = normalized.employeeDetails || sameName.employeeDetails;
        sameName.shift = sameName.shift || normalized.shift;
        sameName.defaultShift = normalized.defaultShift || sameName.defaultShift;
        sameName.linkedStaffIds = Array.from(new Set([...(sameName.linkedStaffIds || []), ...(normalized.linkedStaffIds || []), id].filter(Boolean)));
        return;
      }
      normalized.linkedStaffIds = Array.from(new Set([...(normalized.linkedStaffIds || []), id, normalized.staffOsId].filter(Boolean)));
      merged.push(normalized);
      if (id) byId.set(id, normalized);
      if (nameKey) byName.set(nameKey, normalized);
    };
    legacyRows.forEach((row) => add(row, 'legacy'));
    staffOsRows.forEach((row) => add(row, 'staff-os'));
    return merged.sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
  }

  private normalizeStaffRow(row: ApiRecord, source: 'legacy' | 'staff-os'): ApiRecord {
    const fullName = String(row.name || row.fullName || [row.firstName, row.lastName].filter(Boolean).join(' ') || row.shortName || row.employeeCode || 'Staff').trim();
    const salary = row.employeeDetails?.attendanceSalary || row.attendanceSalary || {};
    const defaultShift = row.defaultShift || salary.defaultShift || salary.attendanceCategory || row.shift || '';
    return {
      ...row,
      id: String(row.id || ''),
      name: fullName,
      fullName,
      branchId: row.branchId || row.branch_id || '',
      phone: row.phone || row.mobile || '',
      shift: row.shift || defaultShift,
      defaultShift,
      staffOsId: source === 'staff-os' ? String(row.id || '') : row.staffOsId,
      linkedStaffIds: [row.id, row.staffId, row.staff_id, row.staffOsId].map((item) => String(item || '')).filter(Boolean)
    };
  }

  private staffNameKey(person: ApiRecord): string {
    return String(person.name || person.fullName || '').trim().toLowerCase().replace(/\s+/g, ' ');
  }

  private staffIdentityIds(person: ApiRecord): Set<string> {
    return new Set([person.id, person.staffId, person.staff_id, person.staffOsId, ...(person.linkedStaffIds || [])].map((item) => String(item || '')).filter(Boolean));
  }

  private staffIdsForAnyId(id: string): Set<string> {
    const person = this.staff().find((row) => this.staffIdentityIds(row).has(String(id || '')));
    return person ? this.staffIdentityIds(person) : new Set([String(id || '')].filter(Boolean));
  }

  private scheduleStaffId(person: ApiRecord): string {
    return String(person.staffOsId || person.staffId || person.staff_id || person.id || '');
  }

  isBlockedShiftType(shiftType = ''): boolean {
    return ['blocked', 'unavailable', 'break', 'personal', 'training'].includes(String(shiftType || '').toLowerCase());
  }

  private isBlockedSchedule(row: ApiRecord): boolean {
    return this.isBlockedShiftType(row.shiftType || row.shift_type) || String(row.status || '').toLowerCase() === 'blocked';
  }

  scheduleDateDisplay(row: ApiRecord): string {
    const value = this.rowDateValue(row, ['scheduleDate', 'schedule_date', 'date']);
    return value ? this.displayDate(value) : '-';
  }

  displayTimeValue(value: string): string {
    const minute = this.parseTimeValue(value);
    return minute === null ? String(value || '-') : this.minutesLabel(minute);
  }

  private timeValue(minutes: number): string {
    const clamped = Math.max(0, Math.min(24 * 60, minutes));
    const hour = Math.floor(clamped / 60);
    const minute = clamped % 60;
    return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
  }

  private parseTimeValue(value: string): number | null {
    const match = String(value || '').trim().match(/^(\d{1,2}):(\d{2})/);
    if (!match) return null;
    const hour = Number(match[1]);
    const minute = Number(match[2]);
    if (!Number.isFinite(hour) || !Number.isFinite(minute) || hour < 0 || hour > 24 || minute < 0 || minute > 59) return null;
    return hour * 60 + minute;
  }

  private slotCountsForStaff(person: ApiRecord, minute: number): { booked: number; unbilled: number; services: number } {
    const start = this.dateAtMinutes(minute);
    const end = new Date(start.getTime() + this.slotMinutes() * 60000);
    const ids = this.staffIdentityIds(person);
    const probe = { startAt: start.toISOString(), endAt: end.toISOString() };
    const rows = (this.appointmentsByDate().get(this.selectedDate()) || [])
      .filter((appointment) => ids.has(String(appointment.staffId || '')))
      .filter((appointment) => !['cancelled', 'no-show'].includes(String(appointment.status || '').toLowerCase()))
      .filter((appointment) => this.overlaps(appointment, probe));
    return {
      booked: rows.length,
      unbilled: rows.filter((appointment) => !['billed', 'paid'].includes(String(appointment.status || '').toLowerCase())).length,
      services: rows.reduce((sum, appointment) => sum + Math.max(1, this.normalizeServiceIds(appointment.serviceIds || appointment.services || appointment.serviceIdsJson).length), 0)
    };
  }

  private scheduleToShiftBlock(row: ApiRecord): StaffShiftBlock | null {
    const parsed = this.parseShiftWindow(String(row.startTime || row.start_time || ''), String(row.endTime || row.end_time || ''));
    if (!parsed) return null;
    const shiftType = String(row.shiftType || row.shift_type || 'regular').toLowerCase();
    const blocked = this.isBlockedShiftType(shiftType) || String(row.status || '').toLowerCase() === 'blocked';
    const label = blocked ? String(row.notes || 'Blocked time') : this.shiftWindowLabel(parsed.start, parsed.end);
    const source = blocked
      ? `${this.minutesLabel(parsed.start)} - ${this.minutesLabel(parsed.end)}`
      : row.notes ? `Staff OS roster · ${row.notes}` : 'Staff OS roster';
    return this.makeShiftBlock(
      String(row.id || `${row.staffId || row.staff_id}_${row.scheduleDate || row.schedule_date}`),
      parsed.start,
      parsed.end,
      label,
      blocked ? 'blocked' : shiftType,
      source
    );
  }

  private fallbackShiftBlockForStaff(person: ApiRecord): StaffShiftBlock | null {
    const salary = person.employeeDetails?.attendanceSalary || person.attendanceSalary || {};
    const weeklyOff = String(salary.weeklyOff || person.weeklyOff || '').toLowerCase();
    const selectedWeekday = new Date(`${this.selectedDate()}T00:00:00`).toLocaleDateString('en-IN', { weekday: 'long' }).toLowerCase();
    if (weeklyOff && weeklyOff === selectedWeekday) {
      return this.makeShiftBlock(`weekly_off_${person.id}`, SCHEDULER_START_MINUTES, SCHEDULER_END_MINUTES, 'W-O', 'weekly_off', 'Staff page weekly off');
    }
    const raw = String(person.defaultShift || person.shift || salary.defaultShift || salary.attendanceCategory || '').trim();
    const parsed = this.parseShiftWindow(raw);
    if (!parsed) return null;
    return this.makeShiftBlock(`default_shift_${person.id}`, parsed.start, parsed.end, parsed.label || this.shiftWindowLabel(parsed.start, parsed.end), 'regular', 'Staff page default shift');
  }

  private makeShiftBlock(id: string, startMinutes: number, endMinutes: number, label: string, shiftType: string, source: string): StaffShiftBlock | null {
    let start = startMinutes;
    let end = endMinutes;
    if (end <= start) end += 12 * 60;
    const clippedStart = Math.max(SCHEDULER_START_MINUTES, start);
    const clippedEnd = Math.min(SCHEDULER_END_MINUTES, end);
    if (clippedEnd <= clippedStart) return null;
    return {
      id,
      label,
      source,
      shiftType: String(shiftType || 'regular').toLowerCase(),
      top: this.topForMinutes(clippedStart),
      height: Math.max(28, this.heightForDuration(clippedEnd - clippedStart))
    };
  }

  private parseShiftWindow(rawOrStart: string, rawEnd = ''): { start: number; end: number; label?: string } | null {
    const raw = rawEnd ? `${rawOrStart}-${rawEnd}` : rawOrStart;
    const parts = String(raw || '').toUpperCase().split(/\s*(?:TO|T0|-|–|—)\s*/).filter(Boolean);
    if (parts.length < 2) return null;
    const start = this.parseShiftTimeToken(parts[0], false);
    if (start === null) return null;
    const end = this.parseShiftTimeToken(parts[1], true, start);
    if (end === null) return null;
    return { start, end, label: rawEnd ? this.shiftWindowLabel(start, end) : String(raw || '').toUpperCase().replace(/\s+/g, ' ') };
  }

  private parseShiftTimeToken(token: string, preferPm: boolean, startMinutes = 0): number | null {
    const match = String(token || '').trim().match(/^(\d{1,2})(?::(\d{2}))?\s*(AM|PM)?$/i);
    if (!match) return null;
    let hour = Number(match[1]);
    const minute = Number(match[2] || 0);
    const meridian = String(match[3] || '').toUpperCase();
    if (hour > 24 || minute > 59) return null;
    if (meridian === 'PM' && hour < 12) hour += 12;
    if (meridian === 'AM' && hour === 12) hour = 0;
    if (!meridian && preferPm && hour <= 12 && hour * 60 <= startMinutes) hour += 12;
    return hour * 60 + minute;
  }

  private shiftWindowLabel(start: number, end: number): string {
    const labelHour = (minutes: number) => {
      const hour = Math.floor((minutes % (24 * 60)) / 60);
      const twelve = hour % 12 || 12;
      return String(twelve).padStart(2, '0');
    };
    return `${labelHour(start)} TO ${labelHour(end)}`;
  }

  private rowDateValue(row: ApiRecord, keys: string[]): string {
    for (const key of keys) {
      const value = row[key];
      if (value) return String(value).slice(0, 10);
    }
    return '';
  }

  private displayDate(value: string | Date): string {
    return new Date(value).toLocaleDateString('en-GB');
  }

  normalizeServiceIds(value: unknown): string[] {
    if (Array.isArray(value)) return value.map((item) => String(item || '').trim()).filter(Boolean);
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (!trimmed) return [];
      if (trimmed.startsWith('[')) {
        try {
          const parsed = JSON.parse(trimmed);
          return Array.isArray(parsed) ? parsed.map((item) => String(item || '').trim()).filter(Boolean) : [];
        } catch {
          return [];
        }
      }
      return trimmed.split(',').map((item) => item.trim()).filter(Boolean);
    }
    return [];
  }

  toDateInput(date: Date | string): string {
    const value = new Date(date);
    value.setMinutes(value.getMinutes() - value.getTimezoneOffset());
    return value.toISOString().slice(0, 10);
  }

  private toDateTimeInput(date: Date | string): string {
    const value = new Date(date);
    value.setMinutes(value.getMinutes() - value.getTimezoneOffset());
    return value.toISOString().slice(0, 16);
  }

  private localDateTime(): string {
    return this.toDateTimeInput(new Date());
  }

  private optionMatches(value: string, id: unknown, label: string): boolean {
    const needle = String(value || '').trim().toLowerCase();
    return !!needle && (needle === String(id || '').trim().toLowerCase() || needle === label.trim().toLowerCase());
  }

  private clientMatchesAdvancedSearch(client: ApiRecord, query: string): boolean {
    const name = this.normalizeSearch(client.name || client.fullName || '');
    const haystack = this.normalizeSearch([
      client.name,
      client.fullName,
      client.phone,
      client.mobile,
      client.contact,
      client.email,
      client.clientCode,
      client.code,
      client.id
    ].filter(Boolean).join(' '));
    const compactQuery = this.compactSearch(query);
    return haystack.includes(query)
      || (Boolean(compactQuery) && this.compactSearch(haystack).includes(compactQuery))
      || this.searchLettersExistInName(name, query);
  }

  private clientAdvancedSearchScore(client: ApiRecord, query: string): number {
    const name = this.normalizeSearch(client.name || client.fullName || '');
    const haystack = this.normalizeSearch(`${client.name || ''} ${client.fullName || ''} ${client.phone || ''} ${client.mobile || ''} ${client.email || ''}`);
    const compactQuery = this.compactSearch(query);
    let score = 0;
    if (name === query) score += 100;
    if (name.startsWith(query)) score += 80;
    if (compactQuery && this.compactSearch(name).startsWith(compactQuery)) score += 75;
    if (haystack.includes(query)) score += 45;
    if (this.searchLettersExistInName(name, query)) score += 30;
    return score;
  }

  private searchLettersExistInName(name: string, query: string): boolean {
    const letters = this.compactSearch(query).split('');
    if (!letters.length || letters.some((letter) => /\d/.test(letter))) return false;
    const counts = new Map<string, number>();
    for (const letter of this.compactSearch(name)) {
      counts.set(letter, (counts.get(letter) || 0) + 1);
    }
    return letters.every((letter) => {
      const next = (counts.get(letter) || 0) - 1;
      if (next < 0) return false;
      counts.set(letter, next);
      return true;
    });
  }

  private normalizeSearch(value: unknown): string {
    return String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ');
  }

  private compactSearch(value: unknown): string {
    return this.normalizeSearch(value).replace(/\s+/g, '');
  }

  private topForMinutes(minutes: number): number {
    const clamped = Math.max(SCHEDULER_START_MINUTES, Math.min(SCHEDULER_END_MINUTES, minutes));
    return SCHEDULER_HEADER_HEIGHT + ((clamped - SCHEDULER_START_MINUTES) / this.slotMinutes()) * this.slotHeight();
  }

  private heightForDuration(minutes: number): number {
    return Math.max(32, (Math.max(this.slotMinutes(), minutes) / this.slotMinutes()) * this.slotHeight() - 4);
  }

  private minutesOfDay(date: Date): number {
    return date.getHours() * 60 + date.getMinutes();
  }

  private snapMinutes(minutes: number): number {
    const interval = this.slotMinutes();
    const snapped = Math.round(minutes / interval) * interval;
    return Math.max(SCHEDULER_START_MINUTES, Math.min(SCHEDULER_END_MINUTES - interval, snapped));
  }

  private dateAtMinutes(minutes: number): Date {
    const date = new Date(`${this.selectedDate()}T00:00:00`);
    date.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0);
    return date;
  }

  private minutesLabel(minutes: number): string {
    const date = new Date(`${this.selectedDate()}T00:00:00`);
    date.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0);
    return this.timeLabel(date);
  }

  private dateLabel(value: unknown): string {
    if (!value) return '';
    const date = new Date(String(value));
    if (Number.isNaN(date.getTime())) return String(value);
    return date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  }

  private waitlistDateTime(date: string, time: string): string {
    if (!date || !time) return '';
    const value = new Date(`${date}T${time}`);
    return Number.isNaN(value.getTime()) ? '' : value.toISOString();
  }

  private timeLabel(value: Date | string | undefined): string {
    if (!value) return '';
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return date.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });
  }
}
