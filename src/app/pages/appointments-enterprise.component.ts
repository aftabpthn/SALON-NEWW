import { CommonModule } from '@angular/common';
import { Component, ElementRef, OnDestroy, OnInit, ViewChild, computed, effect, inject, signal, untracked } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { ApiRecord, ApiService } from '../core/api.service';
import { AppointmentToolbarService, normalizeAppointmentSlotMinutes } from '../core/appointment-toolbar.service';
import { AppStateService } from '../core/state/app-state.service';
import { serviceTotalMinutes } from '../shared/appointment-capacity';
import { StateComponent } from '../shared/ui/state/state.component';
import { AuraMoneyPipe } from '../shared/pipes/aura-money.pipe';
import { AuraDatePipe } from '../shared/pipes/aura-date.pipe';

type SchedulerDrawer = '' | 'booking' | 'blocked-time' | 'appointment' | 'ai-slots' | 'waitlist' | 'operations';
type BlockMode = 'add' | 'remove';
type SchedulerActionMenu = {
  staffId: string;
  minute: number;
  top: number;
};

type StaffGridSwipeState = {
  pointerId: number;
  startX: number;
  startY: number;
  startScrollLeft: number;
  grid: HTMLElement;
  dragging: boolean;
};

type StaffLane = {
  id: string;
  name: string;
  fullName?: string;
  shortName?: string;
  role?: string;
  designation?: string;
  specialization?: string;
  department?: string;
  status?: string;
  avatar?: string;
  phone?: string;
  mobile?: string;
  contact?: string;
  phoneNumber?: string;
  employeeCode?: string;
  staffCode?: string;
  code?: string;
  branchName?: string;
  branch?: string;
};

type BookingLineDraft = {
  id: string;
  appointmentId?: string;
  serviceId: string;
  staffId: string;
  startAt: string;
  durationMinutes: number;
  chair: string;
  room: string;
};

type ClientServiceHistoryRow = {
  id: string;
  date: string;
  serviceId: string;
  serviceName: string;
  staffId: string;
  staffName: string;
  price: number;
  durationMinutes: number;
  invoiceNumber: string;
};

type AppointmentBillLine = {
  id: string;
  name: string;
  startAt: string;
  staffName: string;
  quantity: number;
  price: number;
  discount: number;
  taxable: number;
  gstRate: number;
  gstAmount: number;
  total: number;
};

type AppointmentActivityLine = {
  id: string;
  title: string;
  time: string;
  body: string;
};

type AppointmentActionOption = {
  value: string;
  label: string;
};

type CalendarLayout = 'grid' | 'compact-grid' | 'timeline' | 'list';

type CalendarLayoutOption = {
  value: CalendarLayout;
  label: string;
  description: string;
};

type SchedulerContext = {
  branchId: string;
  date: string;
  from: string;
  to: string;
  staff: StaffLane[];
  staffTotal: number;
  staffWindow: { offset: number; limit: number; total: number; showingFrom: number; showingTo: number };
  appointments: ApiRecord[];
  appointmentTotal: number;
  clients: ApiRecord[];
  services: ApiRecord[];
  schedules: ApiRecord[];
  blockedTimes: ApiRecord[];
  waitlist: ApiRecord[];
  summary: ApiRecord;
  actionQueue: ApiRecord[];
};

type CalendarDay = {
  date: string;
  day: string;
  weekday: string;
  selected: boolean;
  today: boolean;
};

type TimeSlot = {
  minute: number;
  label: string;
  input: string;
};

type AppointmentDetailRow = {
  label: string;
  value: string;
};

type AppointmentCard = {
  appointment: ApiRecord;
  top: number;
  height: number;
  leftPct: number;
  widthPct: number;
  status: string;
  clientName: string;
  serviceLabel: string;
  timeLabel: string;
  detailRows: AppointmentDetailRow[];
};

type AppointmentHoverState = {
  card: AppointmentCard;
  x: number;
  y: number;
};

type RectangleEdges = Pick<DOMRect, 'top' | 'right' | 'bottom' | 'left'>;

export function appointmentPopoverPosition(
  anchor: RectangleEdges,
  popover: { width: number; height: number },
  viewport: { width: number; height: number },
  gap = 12,
  margin = 12
): { x: number; y: number } {
  const placements = [
    { available: viewport.width - anchor.right - gap, required: popover.width, x: anchor.right + gap, y: anchor.top },
    { available: anchor.left - gap, required: popover.width, x: anchor.left - gap - popover.width, y: anchor.top },
    { available: viewport.height - anchor.bottom - gap, required: popover.height, x: anchor.left, y: anchor.bottom + gap },
    { available: anchor.top - gap, required: popover.height, x: anchor.left, y: anchor.top - gap - popover.height }
  ];
  const placement = placements.find((candidate) => candidate.available >= candidate.required)
    || placements.reduce((best, candidate) => candidate.available > best.available ? candidate : best);
  const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), Math.max(min, max));
  return {
    x: clamp(placement.x, margin, viewport.width - popover.width - margin),
    y: clamp(placement.y, margin, viewport.height - popover.height - margin)
  };
}
type LaneBlock = {
  id: string;
  staffId: string;
  top: number;
  height: number;
  label: string;
  kind: 'shift' | 'blocked' | 'unavailable';
  reason: string;
};

type TimelineRow = {
  staff: StaffLane;
  cards: AppointmentCard[];
};

type ScheduledStaffPrefs = {
  order: string[];
  hidden: string[];
};

const DAY_START_MINUTES = 8 * 60;
const DAY_END_MINUTES = 22 * 60;
const ROW_HEIGHT = 44;
const COMPACT_ROW_HEIGHT = 24;
const STAFF_LIMIT = 30;
const PROCESSING_HANDOFF_MINUTES = 15;
const CALENDAR_LAYOUT_STORAGE_KEY = 'aura.appointments.calendarLayout.v1';
const SCHEDULED_STAFF_STORAGE_PREFIX = 'aura.appointments.scheduledStaff.v1';
const CALENDAR_LAYOUT_OPTIONS: CalendarLayoutOption[] = [
  { value: 'grid', label: 'Staff Grid', description: 'Full drag calendar' },
  { value: 'compact-grid', label: 'Compact Grid', description: 'Dense staff view' },
  { value: 'timeline', label: 'Timeline', description: 'Staff swimlanes' },
  { value: 'list', label: 'List', description: 'Bookings table' }
];
const STATUS_OPTIONS = ['payment_pending', 'booked', 'confirmed', 'arrived', 'waiting', 'in-service', 'completed', 'cancelled', 'no-show'];
const STATUS_TONES: Record<string, string> = {
  booked: 'blue',
  payment_pending: 'amber',
  confirmed: 'indigo',
  arrived: 'teal',
  waiting: 'amber',
  'in-service': 'violet',
  completed: 'green',
  billed: 'emerald',
  paid: 'emerald',
  cancelled: 'red',
  'no-show': 'slate'
};

@Component({
  selector: 'app-appointments-enterprise',
  standalone: true,
  imports: [AuraDatePipe, AuraMoneyPipe, CommonModule, ReactiveFormsModule, StateComponent],
  template: `
    <section class="enterprise-scheduler inner-page-shell" [class.enterprise-scheduler--fullscreen]="calendarFullscreen()">
      <app-state [loading]="loading()" [error]="drawer() ? '' : error()" loadingText="Loading enterprise scheduler"></app-state>
      <ng-container *ngIf="!loading() && (!error() || drawer())">
        <section class="deposit-followup-strip" *ngIf="adjustedDueFollowUpCount() > 0">
          <div>
            <strong>{{ adjustedDueFollowUpCount() }} adjusted + due booking(s) pending</strong>
          </div>
          <button class="ghost-button mini" type="button" (click)="openDepositFollowUpReport()">Open deposit report</button>
        </section>

        <section class="scheduled-staff-panel" *ngIf="staffPanelOpen()" aria-label="Scheduled staff panel">
          <header>
            <div>
              <h3>Scheduled Staff</h3>
              <span>{{ scheduledStaffVisibleCount() }} of {{ scheduledStaffRows().length }} visible</span>
            </div>
            <button type="button" aria-label="Close scheduled staff" (click)="cancelScheduledStaffPanel()">×</button>
          </header>
          <div class="scheduled-staff-list" *ngIf="scheduledStaffRows().length; else noScheduledStaffTop">
            <div
              class="scheduled-staff-row"
              *ngFor="let person of scheduledStaffRows(); trackBy: trackStaff"
              draggable="true"
              [class.dragging]="staffPanelDragId() === person.id"
              [class.hidden-staff]="isScheduledStaffHidden(person.id)"
              (dragstart)="beginScheduledStaffDrag(person.id, $event)"
              (dragover)="allowScheduledStaffDrop($event)"
              (drop)="dropScheduledStaff(person.id, $event)"
              (dragend)="endScheduledStaffDrag()"
            >
              <span class="scheduled-staff-handle" aria-hidden="true">⋮⋮</span>
              <label>
                <input
                  type="checkbox"
                  [checked]="!isScheduledStaffHidden(person.id)"
                  [disabled]="!canToggleScheduledStaff(person.id)"
                  (change)="toggleScheduledStaffVisibility(person.id, $any($event.target).checked)"
                />
                <span class="avatar">{{ initials(person.name) }}</span>
                <span class="scheduled-staff-copy">
                  <strong>{{ person.name }}</strong>
                  <small>{{ person.role || 'Staff' }}</small>
                </span>
              </label>
              <div class="scheduled-staff-row-actions" aria-label="Reorder staff">
                <button type="button" aria-label="Move staff up" (click)="moveScheduledStaffByOffset(person.id, -1)">↑</button>
                <button type="button" aria-label="Move staff down" (click)="moveScheduledStaffByOffset(person.id, 1)">↓</button>
              </div>
            </div>
          </div>
          <ng-template #noScheduledStaffTop>
            <p class="scheduled-staff-empty">No staff loaded for this branch.</p>
          </ng-template>
          <footer>
            <button type="button" class="ghost-button mini" (click)="resetScheduledStaffPanel()">Reset</button>
            <button type="button" class="ghost-button mini" (click)="cancelScheduledStaffPanel()">Cancel</button>
            <button type="button" class="primary-button mini" (click)="saveScheduledStaffPanel()">Save</button>
          </footer>
        </section>

        <section class="month-strip-band">
          <button type="button" (click)="shiftMonth(-1)" aria-label="Previous month">&lt;&lt;</button>
          <strong class="month-range-label">{{ selectedDate() | auraDate:'monthYear' }}</strong>
          <button type="button" (click)="shiftMonth(1)" aria-label="Next month">&gt;&gt;</button>
          <div class="month-strip" aria-label="Month date strip">
            <button
              type="button"
              *ngFor="let day of monthDays(); trackBy: trackDate"
              [class.active]="day.selected"
              [class.today]="day.today"
              (click)="selectDate(day.date)"
            >
              <b class="day-number">{{ day.day }}</b>
              <span class="day-name">{{ day.weekday }}</span>
              <small class="day-count">{{ day.date === selectedDate() ? (context()?.appointmentTotal || 0) : 0 }}/0</small>
            </button>
          </div>
        </section>

        <section class="summary-strip" [class.calendar-context-hidden]="calendarFullscreen()">
          <article><span>Booked</span><strong>{{ summaryValue('booked') }}</strong></article>
          <article class="pending-summary-card"><span>Pending</span><strong>{{ pendingAppointmentCount() }}</strong></article>
          <article><span>Arrived</span><strong>{{ summaryValue('arrived') }}</strong></article>
          <article><span>In service</span><strong>{{ summaryValue('inService') }}</strong></article>
          <article><span>Completed</span><strong>{{ summaryValue('completed') }}</strong></article>
          <button class="waitlist-summary-action" type="button" (click)="openWaitlistEntry()">
            <span>Waitlist</span>
            <strong>{{ summaryValue('waitlist') }}</strong>
          </button>
          <article><span>Revenue</span><strong>{{ money(summaryValue('revenue')) }}</strong></article>
        </section>

        <section class="scheduler-grid-shell" [class.scheduler-grid-shell--compact]="calendarLayout() === 'compact-grid'" [class.scheduler-grid-shell--fullscreen]="calendarFullscreen()" *ngIf="isGridCalendarLayout(); else alternateCalendarLayout">
          <button type="button" class="calendar-fullscreen-toggle" (pointerdown)="$event.stopPropagation()" (click)="calendarFullscreen() ? exitCalendarFullscreen() : toggleCalendarFullscreen()" aria-label="Toggle fullscreen calendar" title="Toggle fullscreen calendar">{{ calendarFullscreen() ? "×" : "⛶" }}</button>
          <div
            class="scheduler-grid"
            [class.scheduler-grid--compact]="calendarLayout() === 'compact-grid'"
            [class.scheduler-grid--swiping]="staffGridSwiping()"
            [style.--staff-count]="visibleStaff().length"
            [style.--slot-count]="timeSlots().length"
            [style.--row-height.px]="rowHeight()"
            (pointerdown)="startStaffGridSwipe($event)"
            (pointermove)="moveStaffGridSwipe($event)"
            (pointerup)="endStaffGridSwipe($event)"
            (pointercancel)="cancelStaffGridSwipe()"
            (pointerleave)="endStaffGridSwipe($event)"
          >
            <div class="time-head">Time</div>
            <div class="staff-head" *ngFor="let person of visibleStaff(); trackBy: trackStaff">
              <span class="avatar">{{ initials(person.name) }}</span>
              <div>
                <strong>{{ person.name }}</strong>
                <small>{{ person.role || 'Staff' }}</small>
              </div>
              <button class="staff-menu-button" type="button" (click)="openSchedulerActionMenu(person, $event)" title="Staff slot actions">⌄</button>
            </div>

            <div class="time-column">
              <div class="time-row" *ngFor="let slot of timeSlots(); trackBy: trackSlot">{{ slot.label }}</div>
              <span class="current-time-badge" *ngIf="currentTimeBodyTop() >= 0" [style.top.px]="currentTimeBodyTop()">
                {{ currentTimeLabel() }}
              </span>
            </div>

            <div
              class="staff-lane"
              *ngFor="let person of visibleStaff(); trackBy: trackStaff"
              (dragover)="$event.preventDefault()"
              (drop)="dropAppointment(person, $event)"
            >
              <ng-container *ngIf="schedulerActionMenu() as menu">
                <div class="staff-action-menu" *ngIf="menu.staffId === person.id" [style.top.px]="menu.top" (click)="$event.stopPropagation()">
                  <button type="button" (click)="openAddBlockedTimeFromMenu(person, menu.minute)">Add Blocked Time</button>
                  <button type="button" (click)="openRemoveBlockedTimeFromMenu(person, menu.minute)">
                    Remove Blocked Time
                    <span>{{ blockedCountForStaff(person.id) }}</span>
                  </button>
                </div>
              </ng-container>
              <button
                class="lane-cell"
                type="button"
                *ngFor="let slot of timeSlots(); trackBy: trackSlot"
                [title]="slot.label + ' - ' + person.name + ' | ' + cellCount(person.id, slot.minute)"
                (click)="openQuickBookingFromGrid(person, slot, $event)"
                (contextmenu)="openAddBlockedTime(person, slot, $event)"
                (mouseenter)="showSlotHover(person, slot, $event)"
                (mousemove)="showSlotHover(person, slot, $event)"
                (mouseleave)="hoverSlot.set(null)"
              ></button>
              <span class="current-time-line" *ngIf="currentTimeBodyTop() >= 0" [style.top.px]="currentTimeBodyTop()"></span>

              <button
                class="lane-block roster-closed"
                type="button"
                *ngFor="let block of unavailableBlocksByStaff().get(person.id) || []; trackBy: trackBlock"
                [style.top.px]="block.top"
                [style.height.px]="block.height"
                (click)="showRosterClosed(block, $event)"
              >
                {{ block.label }}
              </button>
              <div class="lane-block shift" *ngFor="let block of shiftBlocksByStaff().get(person.id) || []; trackBy: trackBlock" [style.top.px]="block.top" [style.height.px]="block.height">
                {{ block.label }}
              </div>
              <button
                class="lane-block blocked"
                type="button"
                *ngFor="let block of blockedBlocksByStaff().get(person.id) || []; trackBy: trackBlock"
                [style.top.px]="block.top"
                [style.height.px]="block.height"
                (click)="openRemoveBlockedTime(person, $event)"
              >
                {{ block.reason || 'Blocked' }}
              </button>

              <button
                type="button"
                class="appointment-card"
                *ngFor="let card of appointmentCardsByStaff().get(person.id) || []; trackBy: trackCard"
                [ngClass]="statusTone(card.status)"
                [style.top.px]="card.top"
                [style.height.px]="card.height"
                [style.left.%]="card.leftPct"
                [style.width.%]="card.widthPct"
                draggable="true"
                (dragstart)="beginDrag(card.appointment)"
                (dragend)="clearDrag()"
                (click)="openAppointment(card.appointment); $event.stopPropagation()"
                (mouseenter)="showAppointmentDetails(card, $event)"
                (mouseleave)="hideAppointmentDetails()"
                (focus)="showAppointmentDetails(card, $event)"
                (blur)="hideAppointmentDetails()"
              >
                <strong class="card-time">{{ card.timeLabel }}</strong>
                <b class="card-client">{{ card.clientName }}</b>
                <span class="card-service">{{ card.serviceLabel }}</span>
                <small class="card-status">{{ label(card.status) }}</small>
                <span class="resize-handle" (pointerdown)="beginResize(card.appointment, $event)"></span>
              </button>
            </div>

            <div class="slot-hover" *ngIf="hoverSlot() as hover" [style.left.px]="hover.left" [style.top.px]="hover.top">
              {{ hover.label }} - {{ hover.staffName }} | {{ hoverSummary() }}
            </div>
          </div>
        </section>

        <ng-template #alternateCalendarLayout>
          <section class="scheduler-grid-shell scheduler-grid-shell--alternate">
            <div class="calendar-timeline-view" *ngIf="calendarLayout() === 'timeline'; else listCalendarLayout">
              <div class="layout-empty" *ngIf="!timelineRows().length">
                <strong>No staff visible</strong>
                <span>Use staff window controls or reload after staff setup.</span>
              </div>
              <ng-container *ngIf="timelineRows().length">
                <div class="timeline-scale">
                  <span class="timeline-scale-label">Staff</span>
                  <div class="timeline-scale-track">
                    <span *ngFor="let slot of timelineScaleSlots(); trackBy: trackSlot" [style.left.%]="timelineLeftForMinute(slot.minute)">{{ slot.label }}</span>
                  </div>
                </div>
                <article class="timeline-row" *ngFor="let row of timelineRows(); trackBy: trackTimelineRow">
                  <div class="timeline-staff">
                    <span class="avatar">{{ initials(row.staff.name) }}</span>
                    <div>
                      <strong>{{ row.staff.name }}</strong>
                      <small>{{ row.cards.length }} booking(s)</small>
                    </div>
                  </div>
                  <div class="timeline-track">
                    <span class="timeline-marker" *ngFor="let slot of timelineScaleSlots(); trackBy: trackSlot" [style.left.%]="timelineLeftForMinute(slot.minute)"></span>
                    <span class="timeline-empty" *ngIf="!row.cards.length">No bookings</span>
                    <button type="button" class="timeline-appointment" *ngFor="let card of row.cards; trackBy: trackCard" [ngClass]="statusTone(card.status)" [style.left.%]="timelineLeft(card)" [style.width.%]="timelineWidth(card)" (click)="openAppointment(card.appointment)" (mouseenter)="showAppointmentDetails(card, $event)" (mouseleave)="hideAppointmentDetails()" (focus)="showAppointmentDetails(card, $event)" (blur)="hideAppointmentDetails()">
                      <strong>{{ card.timeLabel }}</strong>
                      <span>{{ card.clientName }}</span>
                      <small>{{ card.serviceLabel }}</small>
                    </button>
                  </div>
                </article>
              </ng-container>
            </div>
            <ng-template #listCalendarLayout>
              <div class="calendar-list-view">
                <div class="calendar-list-header">
                  <div>
                    <strong>{{ calendarAppointmentCards().length }} appointment(s)</strong>
                  </div>
                  <button class="ghost-button mini" type="button" (click)="openBlankBooking()">New booking</button>
                </div>
                <div class="calendar-list-table" *ngIf="calendarAppointmentCards().length; else emptyCalendarList">
                  <div class="calendar-list-head" aria-hidden="true">
                    <span>Time</span>
                    <span>Client / service</span>
                    <span>Staff</span>
                    <span>Status</span>
                  </div>
                  <button class="calendar-list-row" type="button" *ngFor="let card of calendarAppointmentCards(); trackBy: trackCard" (click)="openAppointment(card.appointment)">
                    <span class="list-time">{{ card.timeLabel }}</span>
                    <span class="list-client"><strong>{{ card.clientName }}</strong><small>{{ card.serviceLabel }}</small></span>
                    <span>{{ staffName(card.appointment.staffId || '') }}</span>
                    <span class="status-pill" [ngClass]="statusTone(card.status)">{{ label(card.status) }}</span>
                  </button>
                </div>
                <ng-template #emptyCalendarList>
                  <div class="layout-empty">
                    <strong>No appointments on this page</strong>
                    <span>Use Staff Grid to book a slot or tap New booking.</span>
                  </div>
                </ng-template>
              </div>
            </ng-template>
          </section>
        </ng-template>
      </ng-container>

      <div class="drawer-backdrop" *ngIf="drawer()" (click)="closeDrawer()"></div>

      <aside class="scheduler-drawer ai-slot-drawer" *ngIf="drawer() === 'ai-slots'">
        <header>
          <div>
            <h3>Best safe slots</h3>
          </div>
          <button type="button" (click)="closeDrawer()">×</button>
        </header>
        <div class="ai-slot-detail-grid">
          <button type="button" *ngFor="let slot of smartSlots(); trackBy: trackSmartSlot" (click)="openQuickBooking(slot.staff, slot.slot)">
            <strong>{{ slot.slot.label }}</strong>
            <span>{{ slot.staff.name }}</span>
            <small>{{ slot.reason }}</small>
          </button>
          <div class="empty-state" *ngIf="!smartSlots().length">No open safe slot in the visible window.</div>
        </div>
      </aside>

      <aside class="scheduler-drawer operations-drawer" *ngIf="drawer() === 'operations'">
        <header>
          <div>
            <h3>Demand queue</h3>
          </div>
          <button type="button" (click)="closeDrawer()">×</button>
        </header>
        <div class="drawer-stack">
          <section class="drawer-panel">
            <div class="panel-head">
              <strong>{{ waitlist().length }} waiting clients</strong>
              <button class="mini-action" type="button" (click)="openWaitlistEntry()">Add</button>
            </div>
            <div class="waitlist-row" *ngFor="let row of waitlist(); trackBy: trackApiRecord">
              <strong>{{ clientName(row.clientId) }}</strong>
              <span>{{ serviceNames(row.serviceIds) }}</span>
              <small>{{ row.priority || 'normal' }} · {{ row.preferredDate || selectedDate() }}</small>
            </div>
            <div class="empty-state" *ngIf="!waitlist().length">No waiting clients for this date.</div>
          </section>

          <section class="drawer-panel">
            <div class="panel-head"><strong>Risk radar</strong></div>
            <div class="pulse-grid expanded">
              <div><span>Capacity</span><strong>{{ summaryValue('capacityPct') }}%</strong><small>{{ summaryValue('bookedMinutes') }} of {{ summaryValue('plannedMinutes') }} min</small></div>
              <div><span>Conflicts</span><strong>{{ summaryValue('conflicts') }}</strong></div>
              <div><span>Blocked</span><strong>{{ summaryValue('blockedTimes') }}</strong></div>
              <div><span>No-show</span><strong>{{ summaryValue('noShow') }}</strong></div>
            </div>
          </section>

          <section class="drawer-panel">
            <div class="panel-head">
              <strong>{{ actionQueue().length }} live task{{ actionQueue().length === 1 ? '' : 's' }}</strong>
            </div>
            <div class="waitlist-row action-row" *ngFor="let row of actionQueue(); trackBy: trackApiRecord">
              <strong>{{ row['title'] || actionTypeLabel(row['type']) }}</strong>
              <span>{{ actionTypeLabel(row['type']) }} · {{ row['priority'] || 'medium' }}</span>
              <small>{{ row['detail'] || '-' }}</small>
              <small>{{ row['suggestedAction'] || 'Review this booking signal.' }}</small>
            </div>
            <div class="empty-state" *ngIf="!actionQueue().length">No conflicts, waitlist pressure, no-show recovery or capacity actions for this view.</div>
          </section>
        </div>
      </aside>

      <aside class="scheduler-drawer" *ngIf="drawer() === 'booking'">
        <header>
          <div>
            <h3>Create multi-service booking</h3>
          </div>
          <button type="button" (click)="closeDrawer()">×</button>
        </header>
        <form [formGroup]="bookingForm" (ngSubmit)="createBooking()" class="drawer-stack">
          <label class="search-select">
            <span>Client</span>
            <div class="smart-picker">
              <input
                class="picker-search"
                type="search"
                [value]="bookingClientSearch() || selectedBookingClientLabel()"
                (input)="setBookingClientSearch($any($event.target).value)"
                (focus)="bookingClientSearchActive.set(true)"
                (blur)="closeBookingClientSearchSoon()"
                placeholder="Search name, contact, ID 1/2"
                autocomplete="off"
              />
              <div class="smart-search-results" *ngIf="showBookingClientResults()">
                <button
                  type="button"
                  *ngFor="let client of filteredClients(); trackBy: trackApiRecord"
                  (mousedown)="$event.preventDefault()"
                  (click)="selectBookingClient(client)"
                >
                  <strong>{{ client.name || 'Client' }}</strong>
                  <span>{{ client.phone || client.mobile || client.email || client.id }}</span>
                </button>
              </div>
            </div>
            <small class="picker-empty" *ngIf="bookingClientSearchActive() && bookingClientSearch().length >= 1 && !filteredClients().length">No client match found.</small>
          </label>
          <label><span>Status</span><select formControlName="status"><option *ngFor="let status of statusOptions" [value]="status">{{ label(status) }}</option></select></label>
          <label><span>Notes</span><textarea formControlName="notes" rows="2"></textarea></label>
          <p class="inline-hint client-booking-note" *ngIf="selectedBookingClientProfileNote() as clientNotes">
            <strong>Client profile note:</strong> {{ clientNotes }}
          </p>

          <section class="previous-service-panel" *ngIf="selectedBookingClientId()">
            <div class="service-line-head">
              <div>
                <strong>Previous services</strong>
              </div>
              <button class="ghost-button mini" type="button" (click)="refreshPreviousServices()" [disabled]="clientServiceHistoryLoading()">
                {{ clientServiceHistoryLoading() ? 'Loading' : 'Refresh' }}
              </button>
            </div>
            <div class="previous-service-list" *ngIf="clientServiceHistory().length; else noPreviousServices">
              <article *ngFor="let item of clientServiceHistory(); trackBy: trackClientServiceHistory">
                <div>
                  <strong>{{ item.serviceName }}</strong>
                  <span>{{ formatShortDate(item.date) }} · {{ item.staffName || 'Staff' }} · {{ item.invoiceNumber || 'Invoice' }}</span>
                  <small>Last charged {{ money(item.price) }} · {{ item.durationMinutes || 30 }}m</small>
                </div>
                <button class="ghost-button mini edit-action" type="button" (click)="addPreviousServiceToBooking(item)">Add service</button>
              </article>
            </div>
            <ng-template #noPreviousServices>
              <p class="inline-hint">{{ clientServiceHistoryLoading() ? 'Loading previous service history.' : clientServiceHistoryError() || 'No previous service history found for this client.' }}</p>
            </ng-template>
          </section>

          <div class="service-line-head">
            <strong>Services</strong>
            <button class="ghost-button mini" type="button" (click)="addServiceLine()">
              {{ totalSelectedBookingServiceCount() ? 'Add ' + totalSelectedBookingServiceCount() + ' service' : 'Add service' }}
            </button>
          </div>
          <div class="service-line" *ngFor="let line of bookingLines(); trackBy: trackLine">
            <label class="search-select service-field-wide">
              <span>Service</span>
              <div class="smart-picker">
                <input
                  class="picker-search"
                  type="search"
                  [value]="lineServiceSearchValue(line)"
                  (input)="setLineSearch('service', line.id, $any($event.target).value)"
                  (focus)="setLineSearchActive('service', line.id, true)"
                  (blur)="closeLineSearchSoon('service', line.id)"
                  placeholder="Search service"
                  autocomplete="off"
                />
                <div class="smart-search-results" *ngIf="showLineServiceResults(line)">
                  <button
                    type="button"
                    *ngFor="let service of filteredServices(line); trackBy: trackApiRecord"
                    [class.selected]="isLineServiceSelected(line, service.id)"
                    (mousedown)="$event.preventDefault()"
                    (click)="toggleLineServiceSelection(line, service)"
                  >
                    <span class="multi-select-box" [class.checked]="isLineServiceSelected(line, service.id)" aria-hidden="true"></span>
                    <span class="result-copy">
                      <strong>{{ service.name || 'Service' }}</strong>
                      <span>{{ service.category || 'Service' }} · {{ service.durationMinutes || 30 }}m</span>
                    </span>
                    <span class="select-pill">{{ isLineServiceSelected(line, service.id) ? 'Selected' : 'Select' }}</span>
                  </button>
                  <div class="service-result-actions">
                    <button type="button" (mousedown)="$event.preventDefault()" (click)="selectVisibleLineServices(line)">Select visible</button>
                    <button type="button" *ngIf="selectedLineServiceIds(line).length" (mousedown)="$event.preventDefault()" (click)="clearLineServiceSelection(line.id)">Clear</button>
                  </div>
                </div>
              </div>
              <small class="picker-meta selected" *ngIf="selectedLineServiceIds(line).length">
                {{ selectedLineServiceIds(line).length }} service selected. Add will include all of them.
              </small>
              <small class="picker-meta" *ngIf="showLineServiceMultiHint(line)">Multiple services matched. Select the required services.</small>
              <small class="picker-empty" *ngIf="showLineServiceEmpty(line)">No service match.</small>
            </label>
            <label class="search-select staff-field-wide">
              <span>Staff</span>
              <div class="smart-picker">
                <div class="line-staff-input-wrap">
                  <input
                    class="picker-search"
                    type="search"
                    [value]="lineStaffSearchValue(line)"
                    (input)="setLineSearch('staff', line.id, $any($event.target).value)"
                    (focus)="setLineSearchActive('staff', line.id, true)"
                    (blur)="closeLineSearchSoon('staff', line.id)"
                    placeholder="Search staff name, phone, role, ID 1/2"
                    autocomplete="off"
                  />
                  <button
                    class="line-staff-clear-button"
                    *ngIf="lineStaffSearchValue(line)"
                    type="button"
                    aria-label="Clear staff"
                    (mousedown)="$event.preventDefault()"
                    (click)="clearLineStaffSelection(line)"
                  >
                    x
                  </button>
                </div>
                <div class="smart-search-results" *ngIf="showLineStaffResults(line)">
                  <button
                    class="line-staff-result"
                    type="button"
                    *ngFor="let person of filteredStaff(line); trackBy: trackStaff"
                    (mousedown)="$event.preventDefault()"
                    (click)="selectLineStaff(line, person)"
                  >
                    <strong>{{ person.name || person.fullName || 'Staff' }}</strong>
                    <span>{{ staffResultMeta(person) }}</span>
                  </button>
                </div>
              </div>
              <small class="picker-empty" *ngIf="showLineStaffEmpty(line)">No matching active staff found.</small>
            </label>
            <label class="start-field-wide"><span>Start</span><input type="datetime-local" [value]="line.startAt" (change)="updateLine(line.id, 'startAt', $any($event.target).value)" /></label>
            <label class="duration-field-compact"><span>Duration</span><input type="number" min="15" step="15" [value]="line.durationMinutes" (change)="updateLine(line.id, 'durationMinutes', $any($event.target).value)" /></label>
            <label class="chair-field-compact"><span>Chair / room</span><input [value]="line.chair" (input)="updateLine(line.id, 'chair', $any($event.target).value)" placeholder="Chair 1" /></label>
            <button class="ghost-button mini danger service-remove-button" type="button" (click)="removeServiceLine(line.id)" [disabled]="bookingLines().length === 1">Remove</button>
          </div>

          <fieldset class="notify-box">
            <legend>SMS hooks</legend>
            <label><input type="checkbox" formControlName="notifyClient" /> Client</label>
            <label><input type="checkbox" formControlName="notifyStaff" /> Staff</label>
            <label><input type="checkbox" formControlName="notifyOwner" /> Owner</label>
          </fieldset>
          <p class="inline-hint danger" *ngIf="error()">{{ error() }}</p>

          <div class="drawer-actions">
            <button class="ghost-button" type="button" (click)="closeDrawer()">Cancel</button>
            <button class="primary-button" type="submit" [disabled]="saving() || bookingForm.invalid">{{ saving() ? 'Saving...' : (editingAppointmentId() ? 'Update booking' : 'Create booking') }}</button>
          </div>
        </form>
      </aside>

      <aside class="scheduler-drawer" *ngIf="drawer() === 'waitlist'">
        <header>
          <div>
            <h3>Add waitlist entry</h3>
          </div>
          <button type="button" (click)="closeDrawer()">×</button>
        </header>
        <form [formGroup]="waitlistForm" (ngSubmit)="saveWaitlistEntry()" class="drawer-stack">
          <label>
            <span>Client</span>
            <select formControlName="clientId">
              <option value="">Select client</option>
              <option *ngFor="let client of clients(); trackBy: trackApiRecord" [value]="client.id">
                {{ client.name || client.phone || client.mobile || client.id }}
              </option>
            </select>
          </label>
          <label>
            <span>Service</span>
            <select formControlName="serviceId">
              <option value="">Any service</option>
              <option *ngFor="let service of services(); trackBy: trackApiRecord" [value]="service.id">
                {{ service.name || service.id }}
              </option>
            </select>
          </label>
          <label>
            <span>Preferred staff</span>
            <select formControlName="staffId">
              <option value="">Any staff</option>
              <option *ngFor="let person of visibleStaff(); trackBy: trackStaff" [value]="person.id">{{ person.name }}</option>
            </select>
          </label>
          <div class="inline-form-grid">
            <label><span>Date</span><input type="date" formControlName="preferredDate" /></label>
            <label><span>From</span><input type="time" formControlName="windowStartTime" /></label>
            <label><span>To</span><input type="time" formControlName="windowEndTime" /></label>
            <label><span>Priority</span><input type="number" min="0" max="10" formControlName="priority" /></label>
          </div>
          <label><span>Notes</span><textarea rows="3" formControlName="notes" placeholder="Client preference, urgency, alternate time"></textarea></label>
          <p class="inline-hint danger" *ngIf="waitlistError()">{{ waitlistError() }}</p>
          <p class="inline-hint success" *ngIf="waitlistMessage()">{{ waitlistMessage() }}</p>
          <div class="drawer-actions">
            <button class="ghost-button" type="button" (click)="closeDrawer()">Cancel</button>
            <button class="primary-button" type="submit" [disabled]="waitlistSaving() || waitlistForm.invalid">
              {{ waitlistSaving() ? 'Saving...' : 'Save waitlist entry' }}
            </button>
          </div>
        </form>
      </aside>

      <aside class="scheduler-drawer" *ngIf="drawer() === 'blocked-time'">
        <header>
          <div>
            <h3>{{ blockMode() === 'add' ? 'New blocked time' : 'Remove blocked time' }}</h3>
          </div>
          <button type="button" (click)="closeDrawer()">×</button>
        </header>
        <form *ngIf="blockMode() === 'add'" [formGroup]="blockForm" (ngSubmit)="saveBlockedTime()" class="drawer-stack">
          <label><span>Date</span><input type="date" formControlName="date" /></label>
          <label><span>Staff</span><select formControlName="staffId"><option *ngFor="let person of allStaffChoices(); trackBy: trackStaff" [value]="person.id">{{ person.name }}</option></select></label>
          <div class="two-col">
            <label><span>Start time</span><input type="time" formControlName="startTime" /></label>
            <label><span>End time</span><input type="time" formControlName="endTime" /></label>
          </div>
          <label><span>Reason</span><textarea rows="3" formControlName="reason"></textarea></label>
          <div class="drawer-actions">
            <button class="ghost-button" type="button" (click)="closeDrawer()">Cancel</button>
            <button class="primary-button" type="submit" [disabled]="saving() || blockForm.invalid">Save</button>
          </div>
        </form>
        <div *ngIf="blockMode() === 'remove'" class="drawer-stack">
          <div class="remove-row" *ngFor="let block of removableBlocks(); trackBy: trackApiRecord">
            <div>
              <strong>{{ block.startAt | auraDate:'time' }} - {{ block.endAt | auraDate:'time' }}</strong>
              <span>{{ block.reason || 'Blocked time' }}</span>
            </div>
            <button class="ghost-button mini danger" type="button" (click)="removeBlockedTime(block.id)">Remove</button>
          </div>
          <div class="empty-state" *ngIf="!removableBlocks().length">No blocked time for selected staff/date.</div>
        </div>
      </aside>

      <aside class="scheduler-drawer bill-drawer" *ngIf="drawer() === 'appointment' && selectedAppointment() as appointment">
        <header class="bill-header">
          <button class="bill-close" type="button" (click)="closeDrawer()">×</button>
          <div>
            <h3>View Bill</h3>
                <span>{{ appointment.startAt | auraDate:'time' }} · {{ appointmentBillingLabel(appointment) }}</span>
          </div>
          <button class="ghost-button mini" type="button" (click)="printAppointmentBill()">Print</button>
        </header>

        <div class="bill-tabs">
          <button type="button" [class.active]="appointmentDetailTab() === 'booking'" (click)="appointmentDetailTab.set('booking')">Booking Details</button>
          <button type="button" [class.active]="appointmentDetailTab() === 'activity'" (click)="appointmentDetailTab.set('activity')">Activity Log</button>
        </div>

        <ng-container *ngIf="appointmentDetailTab() === 'booking'; else activityPanel">
          <div class="bill-layout">
            <section class="bill-side">
              <article class="client-bill-card">
                <span class="avatar large">{{ initials(clientName(appointment.clientId)) }}</span>
                <div>
                  <strong>{{ clientName(appointment.clientId) }}</strong>
                  <small>{{ clientPhone(appointment.clientId) || appointment.clientId }}</small>
                  <b>Ewallet Balance: {{ clientWalletBalance(appointment.clientId) | auraMoney:'1.0-0' }}</b>
                </div>
                <button class="ghost-button mini" type="button" (click)="openClientHistory(appointment)">View History</button>
              </article>

              <article class="bill-panel">
                <h4>Payment Mode</h4>
                <strong>{{ appointmentPaymentMode(appointment) }}</strong>
              </article>
              <article class="bill-panel appointment-notes-panel">
                <div class="bill-panel-head">
                  <h4>Notes :</h4>
                  <button class="ghost-button mini" type="button" (click)="saveAppointmentNote(appointment)" [disabled]="appointmentNoteSavingId() === appointment.id">
                    {{ appointmentNoteSavingId() === appointment.id ? 'Saving' : 'Save note' }}
                  </button>
                </div>
                <textarea
                  class="appointment-note-box"
                  [value]="appointmentNoteDraft(appointment)"
                  (input)="setAppointmentNoteDraft(appointment, $any($event.target).value)"
                  placeholder="Appointment note add/edit"
                  rows="3"
                ></textarea>
                <p class="client-note-preview" *ngIf="clientProfileNoteSummary(appointment.clientId) as clientNotes">
                  <strong>Client profile note</strong>
                  <span>{{ clientNotes }}</span>
                </p>
              </article>
              <article class="bill-panel">
                <h4>Staff Alert :</h4>
                <p>{{ appointment.staffAlert || appointment.staff_alert || 'No staff alert.' }}</p>
              </article>
              <article class="bill-panel appointment-date-panel">
                <h4>Appointment Date</h4>
                <div class="bill-status-row">
                  <strong>{{ appointment.startAt | auraDate:'date' }}</strong>
                  <select [value]="appointmentActionValue(appointment)" (change)="handleAppointmentAction(appointment, $any($event.target).value)">
                    <option *ngFor="let action of appointmentActionOptions(appointment); trackBy: trackActionOption" [value]="action.value">{{ action.label }}</option>
                  </select>
                </div>
              </article>
              <article class="bill-panel bill-lines">
                <div><span>Subtotal</span><strong>{{ appointmentSubtotal(appointment) | auraMoney:'1.0-0' }}</strong></div>
                <div><span>Actual Price</span><strong>{{ appointmentSubtotal(appointment) | auraMoney:'1.0-0' }}</strong></div>
                <div><span>Discount</span><strong>{{ appointmentDiscount(appointment) | auraMoney:'1.0-0' }}</strong></div>
                <div><span>Taxable Amount</span><strong>{{ appointmentTaxable(appointment) | auraMoney:'1.0-0' }}</strong></div>
                <div><span>GST</span><strong>{{ appointmentGst(appointment) | auraMoney:'1.0-0' }}</strong></div>
              </article>
              <article class="bill-panel bill-lines total-box">
                <div><span>Total</span><strong>{{ appointmentTotal(appointment) | auraMoney:'1.0-0' }}</strong></div>
                <div><span>Paid</span><strong>{{ appointmentPaid(appointment) | auraMoney:'1.0-0' }}</strong></div>
                <div><span>Due</span><strong>{{ appointmentDue(appointment) | auraMoney:'1.0-0' }}</strong></div>
              </article>
            </section>

            <section class="bill-main">
              <article class="service-bill-card" *ngFor="let line of appointmentBillLines(appointment); trackBy: trackBillLine">
                <h4>Service</h4>
                <p>{{ line.name }}, {{ line.startAt | auraDate:'time' }}, {{ line.staffName }}</p>
                <div class="service-chip-row">
                  <span class="chip warm">Qty: {{ line.quantity }}</span>
                  <span class="chip cool">Price: {{ line.price | auraMoney:'1.0-0' }}</span>
                  <span class="chip pink">Discount: {{ line.discount | auraMoney:'1.0-0' }}</span>
                  <span class="chip teal">Total: {{ line.total | auraMoney:'1.0-0' }}</span>
                </div>
              </article>
              <div class="drawer-actions wrap">
                <button class="ghost-button" type="button" (click)="openEditAppointment(appointment)">Edit Booking</button>
                <button class="ghost-button" type="button" (click)="queueSms(appointment, 'client')">SMS client</button>
                <button class="ghost-button" type="button" (click)="queueSms(appointment, 'staff')">SMS staff</button>
                <button class="ghost-button" type="button" (click)="queueSms(appointment, 'owner')">SMS owner</button>
                <button class="primary-button" type="button" (click)="convertToPos(appointment)" [disabled]="billingStatusChecking() || appointmentBillingLocked(appointment)">
                  {{ billingStatusChecking() ? 'Checking bill...' : (appointmentBillingLocked(appointment) ? 'Already billed' : 'POS handoff') }}
                </button>
              </div>
            </section>
          </div>
        </ng-container>

        <ng-template #activityPanel>
          <div class="activity-log-panel">
            <article *ngFor="let event of appointmentActivityLines(appointment); trackBy: trackActivityLine">
              <strong>{{ event.title }}</strong>
              <span>{{ event.time | auraDate:'date' }}</span>
              <p>{{ event.body }}</p>
            </article>
          </div>
        </ng-template>
      </aside>
      <div #appointmentDetailPopover class="appointment-detail-popover" *ngIf="hoveredAppointment() as hover" role="tooltip" [style.left.px]="hover.x" [style.top.px]="hover.y">
        <div class="hover-title">
          <strong>{{ hover.card.clientName }}</strong>
          <small>{{ hover.card.timeLabel }}</small>
        </div>
        <div class="hover-row" *ngFor="let row of hover.card.detailRows; trackBy: trackAppointmentDetailRow">
          <em>{{ row.label }}</em>
          <b>{{ row.value }}</b>
        </div>
      </div>

      <div class="toast" *ngIf="notice()">
        <span>{{ notice() }}</span>
        <button class="toast-link" type="button" *ngIf="showClientHistoryToastAction()" (click)="openClientHistoryById(lastBookedClientId())">Client History</button>
      </div>
    </section>

  `,
  styles: [`
    :host { display: block; }
    .enterprise-scheduler { position: relative; z-index: 40; display: grid; gap: 16px; }
    .enterprise-scheduler--fullscreen {
      position: fixed !important;
      inset: 0 !important;
      z-index: 10000 !important;
      display: grid !important;
      grid-template-rows: auto minmax(0, 1fr);
      gap: 0 !important;
      padding: 0 !important;
      background: #f4f8f7;
      overflow: hidden !important;
    }
    .enterprise-scheduler--fullscreen > .deposit-followup-strip,
    .enterprise-scheduler--fullscreen > .scheduled-staff-panel,
    .enterprise-scheduler--fullscreen > .summary-strip,
    .enterprise-scheduler--fullscreen > .toast { display: none !important; }
    .enterprise-scheduler--fullscreen .month-strip-band {
      margin: 0 !important;
      border-radius: 0;
      flex: 0 0 auto;
    }
    .enterprise-scheduler > ng-container { display: contents; }
    .enterprise-scheduler .month-strip-band:first-of-type { margin-top: -16px; margin-bottom: -16px; }
    .month-strip-band, .scheduler-top-controls, .scheduler-view-toolbar, .summary-strip, .scheduler-grid-shell, .operations-grid, .scheduler-drawer {
      border: 1px solid #dbe8e4;
      background: rgba(255,255,255,.94);
      box-shadow: 0 18px 42px rgba(15, 23, 42, .08);
    }
    .deposit-followup-strip {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 14px;
      padding: 12px 16px;
      border: 1px solid #f7d7a5;
      border-radius: 14px;
      background: linear-gradient(135deg, #fff8ec, #ffffff);
      box-shadow: 0 14px 30px rgba(148, 96, 9, 0.08);
    }
    .deposit-followup-strip strong,
    .deposit-followup-strip small { display: block; }
    .deposit-followup-strip strong { color: #8a4b08; font-size: 16px; margin-top: 2px; }
    .deposit-followup-strip small { margin-top: 4px; color: #8b6b45; }
    h2, h3 { margin: 0; color: #111827; }
    h2 { font-size: 34px; line-height: 1.05; }
    h3 { font-size: 22px; }
    p { margin: 8px 0 0; color: #64748b; max-width: 760px; }
    .eyebrow { color: #2563eb; font-size: 12px; font-weight: 900; letter-spacing: 0; text-transform: uppercase; }
    .calendar-actions, .drawer-actions, .staff-window-controls, .scheduler-view-controls { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
    .primary-button, .ghost-button {
      border: 1px solid #cfe0dc;
      border-radius: 12px;
      padding: 12px 16px;
      font-weight: 900;
      color: #0f172a;
      background: white;
      text-decoration: none;
      cursor: pointer;
    }
    .primary-button { background: #0f8f7f; color: white; border-color: #0f8f7f; }
    .ghost-button.mini { padding: 8px 11px; font-size: 12px; }
    .danger { color: #b91c1c; }
    .month-strip-band { display: grid; grid-template-columns: 42px 84px 42px minmax(0, 1fr); gap: 8px; align-items: center; min-height: 76px; padding: 10px 14px; border-radius: 14px; }
    .calendar-fullscreen-toggle { position: absolute; top: 12px; right: 12px; z-index: 200; width: 34px; height: 34px; display: grid; place-items: center; border: 1px solid #cfe0dc; border-radius: 10px; background: #fff; color: #4b1238; font-size: 19px; line-height: 1; cursor: pointer; }
    .calendar-fullscreen-toggle:hover { border-color: #0f8f7f; color: #0f8f7f; }
    .calendar-context-hidden { display: none !important; }
    .scheduler-grid-shell--fullscreen {
      position: relative !important;
      height: 100% !important;
      min-height: 0 !important;
      padding: 0 !important;
      border: 0 !important;
      background: transparent !important;
      overflow: hidden !important;
    }
    .scheduler-grid-shell--fullscreen .scheduler-grid {
      position: relative !important;
      width: 100% !important;
      height: 100% !important;
      min-width: 0 !important;
      min-height: 0 !important;
      max-width: none !important;
      max-height: none !important;
      margin: 0 !important;
      padding: 0 !important;
      z-index: 1 !important;
      overflow: auto !important;
      overscroll-behavior: contain;
      border-radius: 0;
      background: #f4f8f7;
      isolation: isolate;
      align-content: start;
      grid-template-rows: auto max-content;
      grid-auto-rows: max-content;
    }
    .calendar-fullscreen-close { position: absolute; top: 16px; right: 16px; z-index: 100; width: 42px; height: 42px; display: grid; place-items: center; border: 1px solid #cfe0dc; border-radius: 10px; background: #fff; color: #4b1238; font-size: 24px; line-height: 1; cursor: pointer; box-shadow: 0 8px 24px rgba(15, 23, 42, .18); }
    .month-range-label { min-width: 84px; color: #172033; font-size: 14px; font-weight: 900; text-align: center; white-space: nowrap; }
    .month-strip-band > button { height: 40px; width: 40px; border-radius: 10px; border: 1px solid #e2d5df; background: #fff; color: #4b1238; font-weight: 900; }
    .month-strip { display: flex; gap: 8px; overflow-x: auto; overflow-y: hidden; padding: 0 0 5px; min-width: 0; scrollbar-gutter: stable; scrollbar-width: thin; }
    .month-strip::-webkit-scrollbar { height: 4px; }
    .month-strip::-webkit-scrollbar-track { background: transparent; }
    .month-strip::-webkit-scrollbar-thumb { background: #c8cdd3; border-radius: 999px; }
    .month-strip button { flex: 0 0 52px; width: 52px; min-width: 52px; min-height: 58px; border: 1px solid #eadde6; background: #fff; border-radius: 10px; padding: 6px 4px; color: #4b1238; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 2px; text-align: center; font-weight: 800; line-height: 1; }
    .month-strip button.active { border-color: #9b6b89; box-shadow: inset 0 -3px 0 #0f8f7f; background: #f8eef4; }
    .month-strip button.today { color: #0f8f7f; }
    .month-strip .day-number { display: block; width: 100%; font-size: 16px; line-height: 1; font-weight: 950; }
    .month-strip .day-name { display: block; width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 10px; line-height: 1.05; color: #4b1238; }
    .month-strip .day-count { display: block; width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 9px; line-height: 1.05; color: #64748b; }
    .scheduler-view-toolbar { display: grid; grid-template-columns: minmax(220px, 1fr) auto; align-items: center; gap: 12px; min-height: 58px; padding: 10px 14px; border-radius: 14px; }
    .scheduler-view-copy { display: grid; gap: 2px; }
    .scheduler-view-copy strong { color: #172033; font-size: 16px; }
    .scheduler-view-copy small { color: #64748b; font-weight: 800; }
    .scheduler-view-controls { justify-content: flex-end; }
    .view-control-field { min-width: 122px; }
    .calendar-layout-field { min-width: 178px; }
    .scheduled-staff-control { position: relative; display: flex; align-items: flex-end; }
    .scheduled-staff-button {
      position: relative;
      width: 42px;
      height: 42px;
      border: 1px solid #cfe0dc;
      border-radius: 999px;
      background: #fff;
      color: #4B1238;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      font-size: 18px;
      font-weight: 900;
      box-shadow: 0 10px 20px rgba(15, 23, 42, .08);
      cursor: pointer;
    }
    .scheduled-staff-button:hover, .scheduled-staff-button.active { background: #4B1238; color: #fff; border-color: #4B1238; }
    .scheduled-staff-button small {
      position: absolute;
      right: -5px;
      top: -6px;
      min-width: 18px;
      height: 18px;
      padding: 0 5px;
      border-radius: 999px;
      background: #E8A7B8;
      color: #4B1238;
      border: 2px solid #fff;
      font-size: 10px;
      line-height: 14px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
    }
    .scheduled-staff-panel {
      position: fixed;
      top: 158px;
      right: 0;
      z-index: 2100;
      width: min(340px, calc(100vw - 32px));
      max-height: min(580px, calc(100vh - 170px));
      display: grid;
      grid-template-rows: auto minmax(0, 1fr) auto;
      background: #fff;
      border: 1px solid #d8c9d2;
      border-radius: 18px;
      box-shadow: 0 24px 50px rgba(31, 41, 51, .18);
      overflow: hidden;
    }
    .scheduled-staff-panel header, .scheduled-staff-panel footer { padding: 14px 16px; display: flex; align-items: center; justify-content: space-between; gap: 10px; }
    .scheduled-staff-panel header { border-bottom: 1px solid #E7DED6; }
    .scheduled-staff-panel h3 { margin: 0; font-size: 20px; line-height: 1.1; color: #1F2933; }
    .scheduled-staff-panel header span { color: #6B7280; font-size: 12px; font-weight: 800; }
    .scheduled-staff-panel header button { width: 32px; height: 32px; border: 1px solid #E7DED6; border-radius: 999px; background: #FAF7F2; color: #4B1238; font-size: 20px; line-height: 1; cursor: pointer; }
    .scheduled-staff-list { overflow: auto; padding: 8px 0; }
    .scheduled-staff-row { display: grid; grid-template-columns: 20px minmax(0, 1fr) auto; align-items: center; gap: 8px; padding: 9px 14px; color: #1F2933; border-bottom: 1px solid rgba(231, 222, 214, .72); background: #fff; }
    .scheduled-staff-row:last-child { border-bottom: 0; }
    .scheduled-staff-row.dragging { opacity: .48; background: #FAF7F2; }
    .scheduled-staff-row.hidden-staff { opacity: .62; }
    .scheduled-staff-handle { color: #6B7280; font-weight: 900; cursor: grab; letter-spacing: -2px; }
    .scheduled-staff-row label { min-width: 0; display: flex; align-items: center; gap: 10px; cursor: pointer; text-transform: none; font-size: 13px; color: #1F2933; }
    .scheduled-staff-row input { width: 18px; height: 18px; min-height: 18px; accent-color: #4B1238; flex: 0 0 auto; }
    .scheduled-staff-row .avatar { width: 30px; height: 30px; min-width: 30px; border-radius: 999px; display: inline-flex; align-items: center; justify-content: center; background: #F8E7EE; color: #4B1238; font-size: 11px; font-weight: 900; }
    .scheduled-staff-copy { min-width: 0; display: grid; gap: 1px; }
    .scheduled-staff-copy strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13px; }
    .scheduled-staff-copy small { color: #6B7280; font-size: 11px; font-weight: 800; }
    .scheduled-staff-row-actions { display: flex; gap: 4px; }
    .scheduled-staff-row-actions button { width: 26px; height: 26px; border: 1px solid #E7DED6; border-radius: 999px; background: #FAF7F2; color: #4B1238; font-weight: 900; cursor: pointer; }
    .scheduled-staff-panel footer { border-top: 1px solid #E7DED6; background: #FFFCF8; justify-content: flex-end; }
    .scheduled-staff-empty { margin: 0; padding: 18px; color: #6B7280; font-weight: 800; }
    .view-control-field span { color: #64748b; font-size: 11px; font-weight: 900; text-transform: uppercase; }
    .view-control-field select { min-height: 38px; border-radius: 999px; padding: 7px 12px; }
    .calendar-layout-toggle { display: flex; gap: 4px; max-width: 100%; overflow-x: auto; padding: 4px; border: 1px solid #d5e2df; border-radius: 999px; background: #f8fafc; }
    .calendar-layout-toggle button { min-height: 34px; border: 0; border-radius: 999px; background: transparent; color: #334155; padding: 0 12px; font-weight: 900; white-space: nowrap; cursor: pointer; }
    .calendar-layout-toggle button.active { background: #0f8f7f; color: #fff; box-shadow: 0 6px 14px rgba(15, 143, 127, .18); }
    .scheduler-staff-window button { min-height: 34px; border: 1px solid #cfe0dc; border-radius: 999px; background: #fff; color: #172033; padding: 0 12px; font-weight: 900; cursor: pointer; }
    .scheduler-staff-window button:disabled { opacity: .42; cursor: not-allowed; }
    .scheduler-staff-window span { color: #64748b; font-size: 12px; font-weight: 900; white-space: nowrap; }
    label { display: grid; gap: 6px; color: #64748b; font-size: 12px; font-weight: 900; text-transform: uppercase; }
    input, select, textarea { width: 100%; min-height: 42px; border: 1px solid #d5e2df; border-radius: 10px; padding: 9px 11px; font: inherit; background: white; color: #172033; }
    .summary-strip { display: grid; grid-template-columns: repeat(7, minmax(116px, 1fr)); justify-content: start; gap: 12px; min-height: 54px; padding: 8px 12px; border-radius: 16px; }
    .summary-strip article, .summary-strip button, .pulse-grid div { border: 1px solid #d8e7e3; border-radius: 12px; padding: 8px 12px; background: linear-gradient(135deg, #ffffff, #f5fbfa); }
    .summary-strip button { cursor: pointer; text-align: left; font: inherit; color: #172033; }
    .summary-strip .pending-summary-card { border-color: #facc15; background: linear-gradient(135deg, #fffbeb, #ffffff); }
    .summary-strip .pending-summary-card strong { color: #b45309; }
    .summary-strip .waitlist-summary-action { border-color: #5eead4; background: linear-gradient(135deg, #ecfdf5, #ffffff); box-shadow: inset 0 0 0 1px rgba(15, 143, 127, 0.12); }
    .summary-strip .waitlist-summary-action small { color: #0f766e; font-weight: 900; }
    .summary-strip span, .pulse-grid span { color: #64748b; font-size: 11px; font-weight: 900; text-transform: uppercase; display: block; }
    .summary-strip strong { display: block; font-size: 20px; margin-top: 2px; line-height: 1.05; }
    .summary-strip small, .pulse-grid small { color: #64748b; }
    .scheduler-grid-shell { position: relative; padding: 16px; border-radius: 16px; overflow: hidden; }
    .scheduler-grid {
      --time-width: 86px;
      --staff-width: minmax(184px, 1fr);
      position: relative;
      display: grid;
      grid-template-columns: var(--time-width) repeat(var(--staff-count), var(--staff-width));
      grid-template-rows: auto max-content;
      grid-auto-rows: max-content;
      overflow: auto;
      max-height: 720px;
      border: 1px solid #d7e4e1;
      border-radius: 14px;
      background: #f8fbfb;
      cursor: grab;
      touch-action: pan-y;
    }
    .scheduler-grid--swiping { cursor: grabbing; user-select: none; }
    .scheduler-grid--swiping .lane-cell { cursor: grabbing; }
    .scheduler-grid--compact { --staff-width: minmax(172px, 1fr); max-height: 640px; }
    .time-head, .staff-head { position: sticky; top: 0; z-index: 60; min-height: 92px; background: #f8fbfb; border-bottom: 1px solid #d7e4e1; }
    .scheduler-grid--compact .time-head, .scheduler-grid--compact .staff-head { min-height: 84px; }
    .time-head { left: 0; z-index: 62; display: grid; place-items: center; font-weight: 900; color: #475569; text-transform: uppercase; }
    .staff-head { display: grid; grid-template-columns: 30px minmax(0, 1fr) 28px; align-items: center; column-gap: 8px; row-gap: 2px; padding: 10px 9px; border-left: 1px solid #d7e4e1; }
    .scheduler-grid--compact .staff-head { grid-template-columns: 26px minmax(0, 1fr) 26px; column-gap: 7px; padding: 8px; }
    .staff-head > div { min-width: 0; display: grid; gap: 3px; }
    .staff-head strong { max-width: 100%; font-size: 12px; line-height: 1.15; display: block; color: #1f2937; white-space: normal; overflow: visible; overflow-wrap: anywhere; word-break: break-word; }
    .staff-head small { max-width: 100%; font-size: 11px; line-height: 1.2; color: #64748b; white-space: normal; overflow: visible; overflow-wrap: anywhere; word-break: break-word; }
    .staff-menu-button { justify-self: end; height: 28px; width: 28px; min-width: 28px; border: 1px solid #cbd5e1; border-radius: 50%; background: #fff; cursor: pointer; font-weight: 900; }
    .staff-menu-button:hover { border-color: #0f8f7f; color: #0f766e; background: #ecfdf5; }
    .avatar { height: 30px; width: 30px; border-radius: 50%; display: grid; place-items: center; background: #d9f99d; color: #115e59; font-size: 11px; font-weight: 900; flex: 0 0 auto; }
    .scheduler-grid--compact .avatar { height: 26px; width: 26px; font-size: 10px; }
    .time-column { position: sticky; left: 0; z-index: 5; grid-column: 1; grid-row: 2; background: #f8fbfb; min-height: calc(var(--row-height) * var(--slot-count)); }
    .time-row { height: var(--row-height); border-bottom: 1px solid #e5ecea; display: flex; align-items: start; justify-content: flex-end; padding: 8px 10px 0 0; font-size: 12px; font-weight: 900; color: #64748b; }
    .scheduler-grid--compact .time-row { padding-top: 5px; font-size: 11px; }
    .staff-lane { position: relative; min-height: calc(var(--row-height) * var(--slot-count)); border-left: 1px solid #d7e4e1; grid-row: 2; overflow: hidden; }
    .lane-cell { display: block; width: 100%; height: var(--row-height); border: 0; border-bottom: 1px solid #edf2f1; background: white; cursor: crosshair; }
    .lane-cell:hover { background: #f0fdfa; outline: 1px solid #99f6e4; }
    .lane-block { position: absolute; left: 0; right: 0; z-index: 1; border: 1px solid rgba(15,23,42,.08); display: flex; align-items: center; justify-content: center; font-weight: 900; font-size: 12px; overflow: hidden; }
    .lane-block.shift { background: rgba(254, 215, 170, .82); color: #7c2d12; pointer-events: none; }
    .lane-block.blocked { background: repeating-linear-gradient(135deg, rgba(148,163,184,.25), rgba(148,163,184,.25) 8px, rgba(226,232,240,.7) 8px, rgba(226,232,240,.7) 16px); color: #334155; cursor: pointer; }
    .lane-block.roster-closed { background: repeating-linear-gradient(135deg, rgba(148,163,184,.2), rgba(148,163,184,.2) 8px, rgba(241,245,249,.82) 8px, rgba(241,245,249,.82) 16px); color: #64748b; cursor: not-allowed; }
    .appointment-card { position: absolute !important; z-index: 4 !important; box-sizing: border-box; container-type: size; border-radius: 8px !important; border: 1px solid #475569 !important; padding: clamp(5px, 5%, 10px) 7px; text-align: left; color: #172033; overflow: hidden !important; cursor: grab; box-shadow: 0 10px 20px rgba(15,23,42,.12) !important; isolation: auto !important; transform: none !important; display: grid; align-content: center; gap: 1px; }
    .scheduler-grid--compact .appointment-card { padding: 4px 6px; border-radius: 7px !important; }
    .appointment-card strong, .appointment-card b, .appointment-card span, .appointment-card small { display: block; min-width: 0; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; line-height: 1.05; }
    .appointment-card .card-time { font-size: clamp(10px, 8cqh, 13px); font-weight: 950; }
    .appointment-card .card-client { font-size: clamp(12px, 10cqh, 16px); font-weight: 950; }
    .appointment-card .card-service, .appointment-card .card-status { font-size: clamp(10px, 8cqh, 13px); font-weight: 850; }
    .scheduler-grid--compact .appointment-card .card-time { font-size: clamp(10px, 7cqh, 13px); }
    .scheduler-grid--compact .appointment-card .card-client { font-size: clamp(12px, 9cqh, 16px); }
    .scheduler-grid--compact .appointment-card .card-service,
    .scheduler-grid--compact .appointment-card .card-status { font-size: clamp(10px, 7cqh, 13px); }
    .appointment-card::before, .appointment-card::after { content: none !important; }
    .appointment-card.blue { background: #bfdbfe !important; border-color: #2563eb !important; border-left-color: #2563eb !important; }
    .appointment-card.indigo { background: #c7d2fe !important; border-color: #4f46e5 !important; border-left-color: #4f46e5 !important; }
    .appointment-card.teal { background: #99f6e4 !important; border-color: #0f766e !important; border-left-color: #0f766e !important; }
    .appointment-card.amber { background: #fde68a !important; border-color: #d97706 !important; border-left-color: #d97706 !important; }
    .appointment-card.violet { background: #ddd6fe !important; border-color: #7c3aed !important; border-left-color: #7c3aed !important; }
    .appointment-card.green, .appointment-card.emerald { background: #bbf7d0 !important; border-color: #16a34a !important; border-left-color: #16a34a !important; }
    .appointment-card.red { background: #fecaca !important; border-color: #dc2626 !important; border-left-color: #dc2626 !important; }
    .appointment-card.slate { background: #e2e8f0 !important; border-color: #64748b !important; border-left-color: #64748b !important; }
    .appointment-card:hover, .appointment-card:focus-visible, .timeline-appointment:hover, .timeline-appointment:focus-visible { z-index: 45 !important; }
    .appointment-detail-popover { position: fixed; z-index: 140; box-sizing: border-box; width: min(340px, calc(100vw - 24px)); max-height: min(420px, calc(100vh - 24px)); max-height: min(420px, calc(100dvh - 24px)); overflow: auto; display: grid; gap: 8px; padding: 13px 14px; border: 1px solid #e7ded6; border-radius: 14px; background: #fff; color: #1f2933; box-shadow: 0 22px 55px rgba(31,41,51,.22); pointer-events: none; }
    .appointment-detail-popover .hover-title { display: flex; align-items: start; justify-content: space-between; gap: 12px; padding-bottom: 7px; border-bottom: 1px solid #f0e7df; }
    .appointment-detail-popover .hover-title strong { color: #4b1238; font-size: 14px; line-height: 1.2; }
    .appointment-detail-popover .hover-title small { color: #6b7280; font-size: 11px; font-weight: 900; white-space: nowrap; }
    .appointment-detail-popover .hover-row { display: grid; grid-template-columns: 82px minmax(0, 1fr); gap: 10px; align-items: start; }
    .appointment-detail-popover em { color: #6b7280; font-size: 11px; font-style: normal; font-weight: 900; text-transform: uppercase; }
    .appointment-detail-popover .hover-row b { margin: 0; color: #1f2933; font-size: 12px; font-weight: 900; line-height: 1.35; overflow-wrap: anywhere; }
    .resize-handle { position: absolute; left: 0; right: 0; bottom: 0; height: 8px; cursor: ns-resize; background: rgba(15,23,42,.15); }
    .current-time-badge { position: absolute; left: 7px; z-index: 12; transform: translateY(-50%); border: 1px solid #ff2f2f; border-radius: 999px; background: #fff; color: #f02b2b; padding: 2px 7px; font-size: 11px; font-weight: 900; }
    .current-time-line { position: absolute; left: 0; right: 0; z-index: 3; height: 2px; background: #ff2f2f; box-shadow: 0 0 0 1px rgba(255,47,47,.1); pointer-events: none; }
    .current-time-line::before { content: ''; position: absolute; left: -4px; top: -4px; width: 10px; height: 10px; border-radius: 999px; background: #ff2f2f; }
    .staff-action-menu { position: absolute; left: 10px; z-index: 20; min-width: 178px; border: 1px solid #cbd5e1; border-radius: 10px; background: #fff; box-shadow: 0 18px 40px rgba(15,23,42,.2); overflow: hidden; }
    .staff-action-menu button { width: 100%; min-height: 38px; display: flex; align-items: center; justify-content: space-between; gap: 10px; border: 0; border-bottom: 1px solid #e2e8f0; background: #fff; padding: 9px 12px; color: #172033; font-size: 12px; font-weight: 900; text-align: left; cursor: pointer; }
    .staff-action-menu button:hover { background: #f0fdfa; color: #0f766e; }
    .staff-action-menu button:last-child { border-bottom: 0; }
    .staff-action-menu span { border-radius: 999px; background: #e2e8f0; padding: 2px 7px; font-size: 11px; }
    .slot-hover { position: absolute; z-index: 10; max-width: 260px; background: #fff7ed; border: 1px solid #fb923c; padding: 4px 8px; border-radius: 6px; font-size: 12px; box-shadow: 0 10px 24px rgba(15,23,42,.12); pointer-events: none; transform: translateY(-100%); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .scheduler-grid-shell--alternate { overflow-x: auto; }
    .calendar-timeline-view, .calendar-list-view { min-width: 780px; display: grid; gap: 10px; }
    .layout-empty { border: 1px dashed #cbd5e1; border-radius: 12px; padding: 22px; display: grid; gap: 5px; text-align: center; color: #64748b; background: #fff; }
    .layout-empty strong { color: #172033; }
    .timeline-scale, .timeline-row { display: grid; grid-template-columns: 180px minmax(640px, 1fr); }
    .timeline-scale-label, .timeline-staff { border: 1px solid #d7e4e1; background: #f8fbfb; }
    .timeline-scale-label { display: grid; place-items: center; min-height: 42px; color: #64748b; font-size: 11px; font-weight: 900; text-transform: uppercase; }
    .timeline-scale-track, .timeline-track { position: relative; border: 1px solid #d7e4e1; border-left: 0; background: #fff; overflow: hidden; }
    .timeline-scale-track { min-height: 42px; }
    .timeline-scale-track span { position: absolute; top: 50%; transform: translate(-50%, -50%); color: #64748b; font-size: 11px; font-weight: 900; white-space: nowrap; }
    .timeline-row + .timeline-row .timeline-staff, .timeline-row + .timeline-row .timeline-track { border-top: 0; }
    .timeline-staff { min-height: 68px; display: flex; align-items: center; gap: 9px; padding: 10px; }
    .timeline-staff strong, .timeline-staff small { display: block; }
    .timeline-staff small { margin-top: 2px; color: #64748b; font-size: 11px; font-weight: 800; }
    .timeline-track { min-height: 68px; }
    .timeline-marker { position: absolute; top: 0; bottom: 0; width: 1px; background: #e2e8f0; }
    .timeline-empty { position: absolute; left: 14px; top: 50%; transform: translateY(-50%); color: #94a3b8; font-size: 12px; font-weight: 900; }
    .timeline-appointment { position: absolute; top: 7px; bottom: 7px; min-width: 76px; border: 1px solid #475569; border-radius: 8px; padding: 6px 8px; text-align: left; color: #172033; overflow: hidden; cursor: pointer; box-shadow: 0 10px 20px rgba(15,23,42,.1); }
    .timeline-appointment > strong, .timeline-appointment > span, .timeline-appointment > small { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .timeline-appointment strong { font-size: 11px; }
    .timeline-appointment span { font-size: 12px; font-weight: 900; margin-top: 2px; }
    .timeline-appointment small { font-size: 11px; }
    .calendar-list-header { display: flex; justify-content: space-between; align-items: center; gap: 12px; }
    .calendar-list-header strong { display: block; color: #172033; font-size: 17px; }
    .calendar-list-table { display: grid; gap: 6px; }
    .calendar-list-head, .calendar-list-row { display: grid; grid-template-columns: 170px minmax(190px, 1.2fr) minmax(150px, 1fr) 140px; align-items: center; gap: 12px; }
    .calendar-list-head { padding: 0 12px; color: #64748b; font-size: 11px; font-weight: 900; text-transform: uppercase; }
    .calendar-list-row { width: 100%; min-height: 58px; border: 1px solid #dbe7e4; border-radius: 12px; background: #fff; color: #172033; padding: 10px 12px; text-align: left; cursor: pointer; }
    .calendar-list-row:hover { border-color: #0f8f7f; background: #f0fdfa; }
    .list-time, .list-client strong { font-weight: 900; }
    .list-client small { display: block; margin-top: 3px; color: #64748b; font-size: 12px; }
    .status-pill { justify-self: start; border: 1px solid #cbd5e1; border-radius: 999px; padding: 6px 10px; color: #172033; font-size: 12px; font-weight: 900; }
    .timeline-appointment.blue, .status-pill.blue { background: #bfdbfe; border-color: #2563eb; }
    .timeline-appointment.indigo, .status-pill.indigo { background: #c7d2fe; border-color: #4f46e5; }
    .timeline-appointment.teal, .status-pill.teal { background: #99f6e4; border-color: #0f766e; }
    .timeline-appointment.amber, .status-pill.amber { background: #fde68a; border-color: #d97706; }
    .timeline-appointment.violet, .status-pill.violet { background: #ddd6fe; border-color: #7c3aed; }
    .timeline-appointment.green, .timeline-appointment.emerald, .status-pill.green, .status-pill.emerald { background: #bbf7d0; border-color: #16a34a; }
    .timeline-appointment.red, .status-pill.red { background: #fecaca; border-color: #dc2626; }
    .timeline-appointment.slate, .status-pill.slate { background: #e2e8f0; border-color: #64748b; }
    .operations-grid { display: grid; grid-template-columns: 1fr 1fr 1.2fr; gap: 14px; }
    .operations-grid.compact { grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; }
    .ops-panel { border-radius: 14px; padding: 16px; display: grid; gap: 10px; align-content: start; }
    .operations-grid.compact .ops-panel { min-height: 46px; padding: 8px 10px; gap: 4px; border-radius: 10px; }
    .ops-launch { min-height: 92px; cursor: pointer; transition: border-color .15s ease, box-shadow .15s ease, transform .15s ease; }
    .operations-grid.compact .ops-launch { min-height: 46px; }
    .ops-launch p { margin: 0; color: #52627a; font-size: 13px; line-height: 1.4; }
    .operations-grid.compact .ops-launch p { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 11px; line-height: 1.2; }
    .ops-launch:focus-visible { outline: 3px solid rgba(15,143,127,.25); outline-offset: 3px; }
    .ops-launch:hover { border-color: #0f8f7f; box-shadow: 0 18px 42px rgba(15,143,127,.13); transform: translateY(-1px); }
    .panel-head { display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #e2e8f0; padding-bottom: 10px; }
    .operations-grid.compact .panel-head { min-height: 0; border-bottom: 0; padding-bottom: 0; gap: 8px; }
    .operations-grid.compact .panel-head strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; line-height: 1.15; color: #172033; }
    .panel-head small { border: 1px solid #99f6e4; border-radius: 999px; color: #0f766e; background: #ecfdf5; padding: 4px 9px; font-weight: 900; }
    .operations-grid.compact .panel-head small { min-width: 22px; height: 22px; display: inline-flex; align-items: center; justify-content: center; padding: 0 7px; font-size: 11px; }
    .ops-panel button, .waitlist-row { border: 1px solid #dbe7e4; border-radius: 10px; background: #fff; padding: 12px; text-align: left; display: grid; gap: 4px; }
    .pulse-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; }
    .empty-state { border: 1px dashed #cbd5e1; border-radius: 10px; padding: 18px; text-align: center; color: #64748b; background: #fff; }
    .drawer-backdrop { position: fixed; inset: 0; background: rgba(15,23,42,.42); z-index: 50; }
    .scheduler-drawer { position: fixed; top: 0; right: 0; bottom: 0; width: min(720px, 96vw); z-index: 60; border-radius: 0; padding: 22px; overflow-y: auto; }
    .scheduler-drawer header { display: flex; justify-content: space-between; align-items: start; gap: 12px; margin-bottom: 18px; }
    .scheduler-drawer header button { border: 0; background: transparent; font-size: 34px; cursor: pointer; }
    .ai-slot-drawer { width: min(560px, 96vw); }
    .operations-drawer { width: min(640px, 96vw); }
    .drawer-panel { border: 1px solid #dbe7e4; border-radius: 14px; background: #fff; padding: 16px; display: grid; gap: 12px; }
    .drawer-panel .panel-head { margin-bottom: 2px; }
    .mini-action { border: 1px solid #99f6e4; border-radius: 999px; background: #ecfdf5; color: #0f766e; padding: 6px 12px; font-size: 13px; font-weight: 900; cursor: pointer; }
    .mini-action:hover { border-color: #0f8f7f; background: #ccfbf1; }
    .pulse-grid.expanded div { min-height: 84px; align-content: start; }
    .pulse-grid strong { font-size: 20px; }
    .ai-slot-detail-grid { display: grid; gap: 12px; }
    .ai-slot-detail-grid button { border: 1px solid #dbe7e4; border-radius: 12px; background: #fff; padding: 14px; text-align: left; display: grid; gap: 5px; cursor: pointer; }
    .ai-slot-detail-grid button:hover { border-color: #0f8f7f; background: #f0fdfa; }
    .ai-slot-detail-grid strong { font-size: 18px; }
    .ai-slot-detail-grid small { color: #64748b; }
    .bill-drawer { width: min(980px, 98vw); background: #fff; padding: 0; }
    .bill-header { position: sticky; top: 0; z-index: 2; display: grid !important; grid-template-columns: auto 1fr auto; align-items: center !important; padding: 22px 28px 14px; background: #fff; border-bottom: 1px solid #eef2f7; }
    .bill-header h3 { font-size: 28px; }
    .bill-header span { color: #64748b; font-size: 13px; }
    .bill-close { font-size: 34px !important; line-height: 1; color: #0f172a; }
    .bill-header .ghost-button { border: 1px solid #cfe0dc; background: #fff; font-size: 12px; }
    .bill-tabs { display: flex; gap: 10px; padding: 0 28px 14px; background: #fff; }
    .bill-tabs button { border: 0; border-radius: 10px; padding: 12px 16px; background: #f4f4f5; color: #172033; font-weight: 900; cursor: pointer; }
    .bill-tabs button.active { background: #171b28; color: #fff; }
    .bill-layout { display: grid; grid-template-columns: 330px 1fr; gap: 18px; padding: 0 22px 28px; }
    .bill-side { display: grid; gap: 14px; align-content: start; }
    .client-bill-card, .bill-panel, .service-bill-card, .activity-log-panel article {
      border: 1px solid #e3e8ef;
      border-radius: 10px;
      background: #fff;
      padding: 16px;
      box-shadow: 0 8px 20px rgba(15,23,42,.04);
    }
    .client-bill-card { display: grid; grid-template-columns: 42px 1fr; gap: 12px; align-items: start; }
    .client-bill-card .ghost-button { grid-column: 2; justify-self: start; background: #171b28; color: #fff; border-color: #171b28; }
    .client-bill-card strong { display: block; text-transform: uppercase; color: #070044; }
    .client-bill-card small { display: block; color: #64748b; margin-top: 2px; }
    .client-bill-card b { display: inline-block; margin-top: 8px; border-radius: 6px; background: #fee2e2; color: #ef4444; padding: 3px 8px; font-size: 11px; }
    .avatar.large { width: 42px; height: 42px; font-size: 18px; background: #ede9fe; color: #4c1d95; }
    .bill-panel h4, .service-bill-card h4 { margin: 0 0 10px; color: #070044; font-size: 18px; }
    .bill-panel p { margin: 0; color: #334155; }
    .bill-panel-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-bottom: 10px; }
    .bill-panel-head h4 { margin: 0; }
    .appointment-notes-panel { display: grid; gap: 10px; }
    .appointment-note-box { min-height: 92px; resize: vertical; text-transform: none; }
    .client-note-preview { display: grid; gap: 4px; border: 1px solid #bbf7d0; border-radius: 8px; background: #f0fdf4; padding: 10px; }
    .client-note-preview strong { color: #166534; font-size: 12px; text-transform: uppercase; }
    .client-note-preview span { color: #334155; font-size: 13px; line-height: 1.35; overflow-wrap: anywhere; }
    .bill-status-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
    .bill-status-row select { min-height: 40px; max-width: 160px; background: #9bd8c5; border-color: #0f766e; }
    .bill-lines { display: grid; gap: 10px; }
    .bill-lines div { display: flex; justify-content: space-between; gap: 16px; color: #64748b; }
    .bill-lines strong { color: #0f172a; }
    .total-box strong { font-size: 18px; }
    .bill-main { display: grid; gap: 14px; align-content: start; }
    .service-bill-card { background: #f6f0ff; border-color: #eadcff; }
    .service-bill-card p { margin: 0 0 10px; color: #64748b; }
    .service-chip-row { display: flex; flex-wrap: wrap; gap: 10px; }
    .chip { border-radius: 6px; padding: 6px 10px; font-size: 13px; font-weight: 900; }
    .chip.warm { background: #fed7aa; color: #9a3412; }
    .chip.cool { background: #dbeafe; color: #1d4ed8; }
    .chip.pink { background: #f5d0fe; color: #86198f; }
    .chip.teal { background: #99f6e4; color: #115e59; }
    .activity-log-panel { display: grid; gap: 12px; padding: 0 22px 28px; }
    .activity-log-panel strong, .activity-log-panel span { display: block; }
    .activity-log-panel span { margin-top: 4px; color: #64748b; font-size: 12px; }
    .drawer-stack { display: grid; gap: 14px; }
    .service-line { display: grid; grid-template-columns: repeat(12, minmax(0, 1fr)); gap: 10px; align-items: end; border: 1px solid #dbe7e4; border-radius: 12px; padding: 12px; }
    .service-field-wide, .staff-field-wide { grid-column: span 6; }
    .start-field-wide { grid-column: span 5; }
    .duration-field-compact { grid-column: span 2; }
    .chair-field-compact { grid-column: span 3; }
    .service-remove-button { grid-column: span 2; min-height: 42px; }
    .service-line-head, .remove-row { display: flex; justify-content: space-between; align-items: center; gap: 10px; }
    .previous-service-panel { display: grid; gap: 10px; border: 1px solid rgba(15, 118, 110, .18); border-radius: 12px; padding: 12px; background: #f8fffd; }
    .previous-service-panel small, .previous-service-list span { display: block; color: #64748b; margin-top: 3px; }
    .previous-service-list { display: grid; gap: 8px; max-height: 280px; overflow: auto; }
    .previous-service-list article { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 10px; align-items: center; border: 1px solid #dbe7e4; border-radius: 10px; padding: 10px; background: #fff; }
    .previous-service-list strong { color: #172033; }
    .edit-action { border-color: rgba(15, 118, 110, .35); background: #f0fdfa; color: #0f766e; font-weight: 900; }
    .search-select { display: grid; gap: 6px; align-content: start; }
    .smart-picker { position: relative; min-width: 0; }
    .smart-search-results { position: absolute; z-index: 95; top: calc(100% + 6px); left: 0; right: 0; display: grid; max-height: 260px; overflow: auto; border: 1px solid #cfe0dc; border-radius: 12px; background: #ffffff; box-shadow: 0 18px 36px rgba(15,23,42,.18); padding: 6px; }
    .smart-search-results button { width: 100%; border: 0; border-radius: 10px; background: transparent; padding: 9px 10px; text-align: left; display: grid; gap: 2px; color: #172033; cursor: pointer; }
    .smart-search-results button:hover, .smart-search-results button.selected { background: #e8f7f4; }
    .smart-search-results button.selected { color: #0f766e; }
    .client-search-results button { justify-items: start; align-items: start; text-align: left; }
    .client-search-results strong, .client-search-results span { width: 100%; text-align: left; }
    .smart-search-results strong { font-size: 13px; }
    .smart-search-results span { font-size: 12px; color: #64748b; text-transform: none; }
    .smart-search-results .multi-select-box { width: 18px; height: 18px; border: 1px solid #cfe0dc; border-radius: 5px; background: #fff; align-self: center; }
    .smart-search-results .multi-select-box.checked { border-color: #10b981; background: #d1fae5; box-shadow: inset 0 0 0 4px #fff; }
    .smart-search-results .result-copy { display: grid; gap: 2px; min-width: 0; }
    .smart-search-results .select-pill { align-self: center; justify-self: end; border: 1px solid #bbf7d0; border-radius: 999px; background: #f0fdf4; color: #059669; font-size: 11px; font-weight: 900; padding: 5px 9px; }
    .smart-search-results .service-result-actions { display: flex; gap: 8px; padding: 6px; }
    .smart-search-results .service-result-actions button { width: auto; border: 1px solid #cfe0dc; border-radius: 999px; padding: 6px 10px; font-weight: 900; }
    .smart-search-results .service-result-actions button:hover { background: #ecfdf5; }
    .service-field-wide .smart-search-results button { grid-template-columns: auto minmax(0, 1fr) auto; align-items: center; column-gap: 10px; }
    .service-field-wide .smart-search-results .service-result-actions button { display: inline-flex; grid-template-columns: none; }
    .picker-search { min-height: 38px; border-radius: 10px; border: 1px solid #cfe0dc; background: #f8fffd; padding: 9px 10px; font-weight: 800; color: #172033; }
    .picker-search:focus { border-color: #0f8f7f; outline: 3px solid rgba(15,143,127,.14); background: #fff; }
    .line-staff-input-wrap { position: relative; }
    .line-staff-input-wrap .picker-search { width: 100%; padding-right: 38px; }
    .line-staff-clear-button { position: absolute; right: 8px; top: 50%; transform: translateY(-50%); width: 24px; height: 24px; border: 0; border-radius: 999px; background: #dff7ef; color: #0f766e; cursor: pointer; font-weight: 900; line-height: 1; }
    .line-staff-clear-button:hover { background: #baf3de; }
    .smart-search-results .line-staff-result { grid-template-columns: minmax(0, 1fr); }
    .picker-meta, .picker-empty { font-size: 11px; font-weight: 800; text-transform: none; color: #64748b; }
    .picker-meta.selected { color: #059669; }
    .picker-empty { color: #b45309; }
    .inline-form-grid { display: grid; grid-template-columns: repeat(4, minmax(110px, 1fr)); gap: 10px; }
    .inline-hint { margin: 0; border-radius: 10px; padding: 10px 12px; font-weight: 900; }
    .inline-hint.danger { background: #fee2e2; color: #991b1b; }
    .inline-hint.success { background: #dcfce7; color: #166534; }
    .client-booking-note { border: 1px solid #bbf7d0; background: #f0fdf4; color: #166534; text-transform: none; line-height: 1.35; }
    .client-booking-note strong { color: #14532d; }
    .two-col, .status-grid, .notify-box, .pulse-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; }
    .notify-box { border: 1px solid #dbe7e4; border-radius: 12px; padding: 12px; }
    .notify-box label { display: flex; align-items: center; gap: 8px; text-transform: none; font-size: 14px; color: #172033; }
    .notify-box input { width: auto; min-height: auto; }
    .detail-card { border: 1px solid #dbe7e4; border-radius: 12px; padding: 14px; display: grid; gap: 4px; background: #f8fafc; }
    .status-grid button { min-height: 40px; border: 1px solid #dbe7e4; border-radius: 10px; background: white; font-weight: 800; }
    .wrap { flex-wrap: wrap; }
    .toast { position: fixed; right: 24px; bottom: 24px; z-index: 70; display: flex; gap: 10px; align-items: center; flex-wrap: wrap; background: #0f8f7f; color: white; padding: 14px 18px; border-radius: 12px; box-shadow: 0 18px 36px rgba(15,23,42,.22); font-weight: 900; }
    .toast-link { border: 1px solid rgba(255,255,255,.6); background: rgba(255,255,255,.16); color: white; border-radius: 999px; padding: 7px 10px; font-weight: 900; cursor: pointer; }
@media (max-width: 1100px) {
      .scheduler-view-toolbar { grid-template-columns: 1fr; }
      .scheduler-view-controls { justify-content: flex-start; }
      .summary-strip, .operations-grid, .service-line, .bill-layout { grid-template-columns: 1fr 1fr; }
      .service-field-wide, .staff-field-wide, .start-field-wide, .duration-field-compact, .chair-field-compact, .service-remove-button { grid-column: auto; }
    }
    @media (max-width: 720px) {
      .month-strip-band { grid-template-columns: 1fr; }
      .calendar-fullscreen-toggle { justify-self: end; }
      .scheduler-view-controls, .calendar-layout-toggle, .scheduler-staff-window { width: 100%; }
      .calendar-layout-toggle { border-radius: 12px; }
      .calendar-layout-toggle button { flex: 1 0 auto; }
      .timeline-scale, .timeline-row { grid-template-columns: 150px minmax(560px, 1fr); }
      .calendar-list-head, .calendar-list-row { grid-template-columns: 1fr; gap: 6px; }
      .summary-strip, .operations-grid, .service-line, .inline-form-grid, .two-col, .pulse-grid, .bill-layout { grid-template-columns: 1fr; }
      .scheduled-staff-control { position: static; }
      .scheduled-staff-panel { position: fixed; top: 96px; left: 12px; right: 12px; width: auto; max-height: calc(100vh - 118px); }
    }
  `]
})
export class AppointmentsEnterpriseComponent implements OnInit, OnDestroy {
  @ViewChild('appointmentDetailPopover')
  private set appointmentDetailPopover(ref: ElementRef<HTMLDivElement> | undefined) {
    this.appointmentDetailPopoverElement = ref?.nativeElement;
    if (ref) this.scheduleAppointmentPopoverPosition();
  }
  private readonly fb = inject(FormBuilder);
  private readonly resizeState = signal<{ appointment: ApiRecord; startY: number; originalEnd: string } | null>(null);
  private handledStaffToggleRequests = 0;
  private timer = 0;
  private noticeTimer = 0;
  private appointmentPopoverFrame = 0;
  private appointmentDetailPopoverElement?: HTMLDivElement;
  private appointmentHoverAnchor: HTMLElement | null = null;
  readonly api = inject(ApiService);
  readonly appointmentToolbar = inject(AppointmentToolbarService);
  readonly state = inject(AppStateService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly appointmentActions: AppointmentActionOption[] = [
    { value: 'confirmed', label: 'Confirmed' },
    { value: 'arrived', label: 'Arrived' },
    { value: 'in-service', label: 'Start' },
    { value: 'completed', label: 'Completed' },
    { value: 'cancelled', label: 'Cancel' },
    { value: 'add-payment', label: 'Add Payment' }
  ];
  private readonly completedAppointmentActions: AppointmentActionOption[] = [
    { value: 'completed', label: 'Completed' },
    { value: 'add-payment', label: 'Add Payment' }
  ];
  private readonly completedAllowedActions = new Set(this.completedAppointmentActions.map((action) => action.value));
  readonly calendarLayoutOptions = CALENDAR_LAYOUT_OPTIONS;
  readonly calendarLayout = signal<CalendarLayout>(this.initialCalendarLayout());
  readonly calendarFullscreen = signal(false);
  readonly selectedCalendarLayoutLabel = computed(() => this.calendarLayoutOptions.find((option) => option.value === this.calendarLayout())?.label || 'Staff Grid');
  readonly rowHeight = computed(() => this.calendarLayout() === 'compact-grid' ? COMPACT_ROW_HEIGHT : ROW_HEIGHT);
  readonly statusOptions = STATUS_OPTIONS;
  readonly context = signal<SchedulerContext | null>(null);
  readonly adjustedDueFollowUpCount = signal(0);
  readonly loading = signal(false);
  readonly saving = signal(false);
  readonly error = signal('');
  readonly notice = signal('');
  readonly billingStatusChecking = signal(false);
  readonly appointmentNoteSavingId = signal('');
  readonly appointmentNoteDrafts = signal<Record<string, string>>({});
  readonly lastBookedClientId = signal('');
  readonly showClientHistoryToastAction = computed(() => !!this.lastBookedClientId() && this.notice().toLowerCase().includes('appointment'));
  readonly waitlistError = signal('');
  readonly waitlistMessage = signal('');
  readonly waitlistSaving = signal(false);
  readonly selectedDate = signal(new Date().toISOString().slice(0, 10));
  readonly staffOffset = signal(0);
  readonly staffGridSwiping = signal(false);
  readonly slotMinutes = signal(10);
  readonly activeSlotMinutes = computed(() => normalizeAppointmentSlotMinutes(this.slotMinutes()));
  readonly statusFilter = signal('');
  readonly staffSearch = signal('');
  readonly staffPanelOpen = signal(false);
  readonly staffPanelOrder = signal<string[]>([]);
  readonly hiddenStaffIds = signal<string[]>([]);
  readonly savedStaffPanelOrder = signal<string[]>([]);
  readonly savedHiddenStaffIds = signal<string[]>([]);
  readonly staffPanelDragId = signal('');
  readonly drawer = signal<SchedulerDrawer>('');
  readonly blockMode = signal<BlockMode>('add');
  readonly selectedStaff = signal<StaffLane | null>(null);
  readonly selectedAppointment = signal<ApiRecord | null>(null);
  readonly draggingAppointment = signal<ApiRecord | null>(null);
  readonly schedulerActionMenu = signal<SchedulerActionMenu | null>(null);
  readonly now = signal(new Date());
  readonly hoverSlot = signal<{ staffName: string; label: string; left: number; top: number } | null>(null);
  readonly hoveredAppointment = signal<AppointmentHoverState | null>(null);
  readonly bookingLines = signal<BookingLineDraft[]>([]);
  readonly bookingClientSearch = signal('');
  readonly bookingClientSearchActive = signal(false);
  readonly clientServiceHistory = signal<ClientServiceHistoryRow[]>([]);
  readonly clientServiceHistoryLoading = signal(false);
  readonly clientServiceHistoryError = signal('');
  readonly serviceSearchByLine = signal<Record<string, string>>({});
  readonly staffSearchByLine = signal<Record<string, string>>({});
  readonly serviceSearchActiveByLine = signal<Record<string, boolean>>({});
  readonly staffSearchActiveByLine = signal<Record<string, boolean>>({});
  readonly selectedServiceIdsByLine = signal<Record<string, string[]>>({});
  readonly editingAppointmentId = signal('');
  readonly appointmentDetailTab = signal<'booking' | 'activity'>('booking');

  readonly bookingForm = this.fb.group({
    clientId: ['', Validators.required],
    status: ['booked', Validators.required],
    notes: [''],
    notifyClient: [true],
    notifyStaff: [true],
    notifyOwner: [false]
  });

  readonly blockForm = this.fb.group({
    date: [this.selectedDate(), Validators.required],
    staffId: ['', Validators.required],
    startTime: ['10:00', Validators.required],
    endTime: ['10:30', Validators.required],
    reason: ['Blocked time']
  });

  readonly waitlistForm = this.fb.group({
    clientId: ['', Validators.required],
    serviceId: [''],
    staffId: [''],
    preferredDate: [this.selectedDate(), Validators.required],
    windowStartTime: ['10:00'],
    windowEndTime: ['18:00'],
    priority: [1],
    notes: ['']
  });

  readonly monthRange = computed(() => {
    const date = new Date(`${this.selectedDate()}T00:00:00`);
    const first = new Date(date.getFullYear(), date.getMonth(), 1);
    const last = new Date(date.getFullYear(), date.getMonth() + 1, 0);
    return { from: this.dateInput(first), to: this.dateInput(last) };
  });

  readonly monthDays = computed<CalendarDay[]>(() => {
    const range = this.monthRange();
    const days: CalendarDay[] = [];
    const cursor = new Date(`${range.from}T00:00:00`);
    const end = new Date(`${range.to}T00:00:00`);
    while (cursor <= end) {
      const date = this.dateInput(cursor);
      days.push({
        date,
        day: cursor.toLocaleDateString('en-IN', { day: '2-digit' }),
        weekday: cursor.toLocaleDateString('en-IN', { weekday: 'short' }),
        selected: date === this.selectedDate(),
        today: date === new Date().toISOString().slice(0, 10)
      });
      cursor.setDate(cursor.getDate() + 1);
    }
    return days;
  });

  readonly timeSlots = computed<TimeSlot[]>(() => {
    const rows: TimeSlot[] = [];
    for (let minute = DAY_START_MINUTES; minute < DAY_END_MINUTES; minute += this.activeSlotMinutes()) {
      rows.push({ minute, label: this.timeLabel(minute), input: this.localDateTime(minute) });
    }
    return rows;
  });

  readonly scheduledStaffRows = computed(() => this.orderStaffRows(this.context()?.staff || [], this.staffPanelOrder()));
  readonly visibleStaff = computed(() => {
    const hidden = new Set(this.hiddenStaffIds());
    return this.scheduledStaffRows().filter((person) => !hidden.has(person.id));
  });
  readonly scheduledStaffVisibleCount = computed(() => this.visibleStaff().length);
  private staffGridSwipeState: StaffGridSwipeState | null = null;
  private staffGridSwipeSuppressClick = false;
  private handledSafeSlotRequests = 0;
  private handledOperationsRequests = 0;
  readonly clients = computed(() => this.context()?.clients || []);
  readonly services = computed(() => this.context()?.services || []);
  readonly waitlist = computed(() => this.context()?.waitlist || []);
  readonly actionQueue = computed(() => this.context()?.actionQueue || []);
  readonly allStaffChoices = computed(() => this.visibleStaff());
  readonly filteredClients = computed(() => {
    const query = this.normalizeSearch(this.bookingClientSearch());
    if (query.length < 1) return [];
    return this.smartFilterApiRecords(this.clients(), query, (client, index) => [
      client.name,
      this.initials(client.name),
      client.phone,
      client.mobile,
      client.email,
      client.clientCode,
      client.code,
      client.id,
      String(index + 1),
      `id ${index + 1}`
    ]).slice(0, 25);
  });
  readonly clientById = computed(() => new Map(this.clients().map((client) => [client.id, client])));
  readonly serviceById = computed(() => new Map(this.services().map((service) => [service.id, service])));
  readonly staffById = computed(() => new Map(this.visibleStaff().map((person) => [person.id, person])));

  readonly appointmentCardsByStaff = computed(() => {
    const map = new Map<string, AppointmentCard[]>();
    const visibleStaffIds = new Set(this.visibleStaff().map((person) => person.id));
    for (const appointment of this.context()?.appointments || []) {
      if (!this.shouldShowOnAppointmentCalendar(appointment)) continue;
      const staffId = appointment.staffId || '';
      if (visibleStaffIds.size && !visibleStaffIds.has(staffId)) continue;
      const card = this.appointmentCard(appointment);
      if (!map.has(staffId)) map.set(staffId, []);
      map.get(staffId)?.push(card);
    }
    for (const cards of map.values()) this.applyAppointmentCardOverlapLayout(cards);
    return map;
  });
  readonly calendarAppointmentCards = computed(() =>
    Array.from(this.appointmentCardsByStaff().values())
      .flat()
      .sort((a, b) => this.minuteOf(a.appointment.startAt) - this.minuteOf(b.appointment.startAt))
  );
  readonly timelineRows = computed<TimelineRow[]>(() =>
    this.visibleStaff().map((staff) => ({ staff, cards: this.appointmentCardsByStaff().get(staff.id) || [] }))
  );
  readonly timelineScaleSlots = computed(() => {
    const hourStep = Math.max(1, Math.round(60 / this.activeSlotMinutes()));
    return this.timeSlots().filter((_, index) => index % hourStep === 0);
  });
  readonly pageAppointmentCount = computed(() =>
    new Set(
      Array.from(this.appointmentCardsByStaff().values())
        .flat()
        .map((card) => this.appointmentBookingCountKey(card.appointment))
        .filter(Boolean)
    ).size
  );
  readonly pendingAppointmentCount = computed(() => {
    const pending = new Set<string>();
    for (const cards of this.appointmentCardsByStaff().values()) {
      for (const card of cards) {
        if (!this.isPendingAppointment(card.appointment)) continue;
        const key = this.appointmentBookingCountKey(card.appointment);
        if (key) pending.add(key);
      }
    }
    return pending.size;
  });
  readonly totalSelectedBookingServiceCount = computed(() =>
    Object.values(this.selectedServiceIdsByLine()).reduce((total, ids) => total + ids.length, 0)
  );

  readonly shiftBlocksByStaff = computed(() => this.groupBlocks((this.context()?.schedules || []).map((row) => this.shiftBlock(row))));
  readonly unavailableBlocksByStaff = computed(() => this.groupBlocks(this.unavailableRosterBlocks()));
  readonly blockedBlocksByStaff = computed(() => this.groupBlocks((this.context()?.blockedTimes || []).map((row) => this.blockedBlock(row))));

  readonly smartSlots = computed(() => {
    const slots: { staff: StaffLane; slot: TimeSlot; reason: string }[] = [];
    for (const staff of this.visibleStaff()) {
      for (const slot of this.timeSlots()) {
        if (slot.minute < 10 * 60) continue;
        const keyCount = this.cellCount(staff.id, slot.minute);
        const inBlocked = (this.blockedBlocksByStaff().get(staff.id) || []).some((block) => slot.minute >= this.topToMinute(block.top) && slot.minute < this.topToMinute(block.top + block.height));
        if (!keyCount && !inBlocked && this.isStaffWorkingAt(staff.id, slot.minute)) {
          slots.push({ staff, slot, reason: 'Open slot with no visible conflict' });
          break;
        }
      }
      if (slots.length >= 5) break;
    }
    return slots;
  });

  private readonly toolbarStateSync = effect(() => {
    const toolbarSlot = this.appointmentToolbar.slotMinutes();
    const nextSlot = normalizeAppointmentSlotMinutes(toolbarSlot);
    if (nextSlot !== this.slotMinutes()) this.slotMinutes.set(nextSlot);

    const toolbarLayout = this.normalizeCalendarLayout(this.appointmentToolbar.calendarLayout());
    if (toolbarLayout !== this.calendarLayout()) {
      this.calendarLayout.set(toolbarLayout);
      this.draggingAppointment.set(null);
      this.resizeState.set(null);
      this.hoverSlot.set(null);
      this.closeSchedulerActionMenu();
      this.saveCalendarLayout(toolbarLayout);
    }

    this.appointmentToolbar.scheduledStaffVisibleCount.set(this.scheduledStaffVisibleCount());
    this.appointmentToolbar.staffPanelOpen.set(this.staffPanelOpen());
    this.appointmentToolbar.safeSlotCount.set(this.smartSlots().length);
    this.appointmentToolbar.waitlistCount.set(this.waitlist().length);
    this.appointmentToolbar.riskText.set(`${this.actionQueue().length} / ${this.summaryValue('capacityPct')}% / ${this.summaryValue('conflicts')}`);
  }, { allowSignalWrites: true });

  private readonly toolbarStaffToggleSync = effect(() => {
    const requests = this.appointmentToolbar.staffToggleRequests();
    if (requests <= this.handledStaffToggleRequests) return;
    this.handledStaffToggleRequests = requests;
    untracked(() => this.toggleScheduledStaffPanel());
  }, { allowSignalWrites: true });

  private readonly toolbarSafeSlotSync = effect(() => {
    const requests = this.appointmentToolbar.safeSlotRequests();
    if (requests <= this.handledSafeSlotRequests) return;
    this.handledSafeSlotRequests = requests;
    untracked(() => this.openAiSlotPilot());
  }, { allowSignalWrites: true });

  private readonly toolbarOperationsSync = effect(() => {
    const requests = this.appointmentToolbar.operationsRequests();
    if (requests <= this.handledOperationsRequests) return;
    this.handledOperationsRequests = requests;
    untracked(() => this.openOperationsPulse());
  }, { allowSignalWrites: true });

  ngOnInit(): void {
    this.appointmentToolbar.visible.set(true);
    this.slotMinutes.set(normalizeAppointmentSlotMinutes(this.appointmentToolbar.slotMinutes()));
    this.appointmentToolbar.setCalendarLayout(this.calendarLayout());
    this.applyRouteDateSelection();
    this.load();
    this.timer = window.setInterval(() => this.now.set(new Date()), 60000);
    window.addEventListener('pointermove', this.onResizeMove);
    window.addEventListener('pointerup', this.onResizeEnd);
  }

  ngOnDestroy(): void {
    this.appointmentToolbar.visible.set(false);
    this.appointmentToolbar.staffPanelOpen.set(false);
    window.clearInterval(this.timer);
    window.clearTimeout(this.noticeTimer);
    window.cancelAnimationFrame(this.appointmentPopoverFrame);
    this.appointmentDetailPopoverElement = undefined;
    window.removeEventListener('pointermove', this.onResizeMove);
    window.removeEventListener('pointerup', this.onResizeEnd);
    if (typeof document !== 'undefined') document.body.classList.remove('calendar-fullscreen-active');
  }

  private initialCalendarLayout(): CalendarLayout {
    try {
      if (typeof window === 'undefined' || !window.localStorage) return 'grid';
      return this.normalizeCalendarLayout(window.localStorage.getItem(CALENDAR_LAYOUT_STORAGE_KEY));
    } catch {
      return 'grid';
    }
  }

  private normalizeCalendarLayout(value: unknown): CalendarLayout {
    return CALENDAR_LAYOUT_OPTIONS.some((option) => option.value === value) ? value as CalendarLayout : 'grid';
  }

  private saveCalendarLayout(value: CalendarLayout): void {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        window.localStorage.setItem(CALENDAR_LAYOUT_STORAGE_KEY, value);
      }
    } catch {
      // Layout preference is optional; navigation must keep working if storage is unavailable.
    }
  }

  private scheduledStaffStorageKey(context = this.context()): string {
    const tenantId = this.state.selectedTenantId() || 'tenant_aura';
    const branchId = context?.branchId || this.state.selectedBranchId() || 'all';
    return `${SCHEDULED_STAFF_STORAGE_PREFIX}:${tenantId}:${branchId}`;
  }

  private syncScheduledStaffPrefs(context: SchedulerContext): void {
    const source = this.staffPanelOpen()
      ? { order: this.staffPanelOrder(), hidden: this.hiddenStaffIds() }
      : this.readScheduledStaffPrefs(context);
    const prefs = this.sanitizeScheduledStaffPrefs(source, context.staff || []);
    if (!this.staffPanelOpen()) {
      this.savedStaffPanelOrder.set(prefs.order);
      this.savedHiddenStaffIds.set(prefs.hidden);
    }
    this.staffPanelOrder.set(prefs.order);
    this.hiddenStaffIds.set(prefs.hidden);
  }

  private readScheduledStaffPrefs(context: SchedulerContext): ScheduledStaffPrefs {
    try {
      if (typeof window === 'undefined' || !window.localStorage) return { order: [], hidden: [] };
      const raw = window.localStorage.getItem(this.scheduledStaffStorageKey(context));
      if (!raw) return { order: [], hidden: [] };
      const parsed = JSON.parse(raw) as Partial<ScheduledStaffPrefs>;
      return {
        order: Array.isArray(parsed.order) ? parsed.order.map(String) : [],
        hidden: Array.isArray(parsed.hidden) ? parsed.hidden.map(String) : []
      };
    } catch {
      return { order: [], hidden: [] };
    }
  }

  private sanitizeScheduledStaffPrefs(prefs: Partial<ScheduledStaffPrefs> | null | undefined, staff: StaffLane[]): ScheduledStaffPrefs {
    const ids = staff.map((person) => person.id).filter(Boolean);
    const valid = new Set(ids);
    const order = this.uniqueStaffIds(prefs?.order || []).filter((id) => valid.has(id));
    for (const id of ids) {
      if (!order.includes(id)) order.push(id);
    }
    let hidden = this.uniqueStaffIds(prefs?.hidden || []).filter((id) => valid.has(id));
    if (ids.length && hidden.length >= ids.length) {
      hidden = hidden.filter((id) => id !== order[0]);
    }
    return { order, hidden };
  }

  private uniqueStaffIds(ids: string[]): string[] {
    const seen = new Set<string>();
    const rows: string[] = [];
    for (const raw of ids) {
      const id = String(raw || '').trim();
      if (!id || seen.has(id)) continue;
      seen.add(id);
      rows.push(id);
    }
    return rows;
  }

  private orderStaffRows(staff: StaffLane[], order: string[]): StaffLane[] {
    const byId = new Map(staff.map((person) => [person.id, person]));
    return this.sanitizeScheduledStaffPrefs({ order, hidden: [] }, staff).order
      .map((id) => byId.get(id))
      .filter((person): person is StaffLane => Boolean(person));
  }

  private currentStaffOrderIds(): string[] {
    return this.sanitizeScheduledStaffPrefs({ order: this.staffPanelOrder(), hidden: this.hiddenStaffIds() }, this.context()?.staff || []).order;
  }

  private showNotice(message: string, autoHideMs = 3200): void {
    window.clearTimeout(this.noticeTimer);
    this.notice.set(message);
    this.noticeTimer = window.setTimeout(() => {
      if (this.notice() === message) this.notice.set('');
    }, autoHideMs);
  }

  async load(): Promise<void> {
    this.loading.set(true);
    this.error.set('');
    try {
      const branchId = this.state.selectedBranchId();
      const selectedDate = this.selectedDate();
      const [context, depositReport] = await Promise.all([
        firstValueFrom(this.api.list<SchedulerContext>('enterprise-scheduler/context', {
          branchId,
          date: selectedDate,
          from: selectedDate,
          to: this.nextDate(selectedDate),
          staffLimit: STAFF_LIMIT,
          staffOffset: this.staffOffset(),
          staffSearch: this.staffSearch(),
          status: this.statusFilter(),
          clientLimit: 120,
          serviceLimit: 300
        })),
        firstValueFrom(this.api.list<{ rows?: ApiRecord[] }>('appointment-deposits/report', {
          branchId,
          from: selectedDate,
          to: selectedDate
        }))
      ]);
      this.context.set(context);
      this.syncScheduledStaffPrefs(context);
      this.openRouteAppointmentIfNeeded(context?.appointments || []);
      const rows = Array.isArray(depositReport?.rows) ? depositReport.rows : [];
      this.adjustedDueFollowUpCount.set(rows.filter((row) => Number(row.advanceAdjusted || 0) > 0 && Number(row.counterDue || 0) > 0).length);
    } catch (error) {
      this.adjustedDueFollowUpCount.set(0);
      this.error.set(this.api.errorText(error, 'Unable to load enterprise scheduler'));
    } finally {
      this.loading.set(false);
    }
  }

  selectDate(date: string): void {
    this.selectedDate.set(date);
    this.applySelectedDateToOpenBooking(date);
    this.staffOffset.set(0);
    this.load();
  }

  private applySelectedDateToOpenBooking(date: string): void {
    if (this.drawer() !== 'booking' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
    this.bookingLines.update((lines) => lines.map((line) => {
      const time = String(line.startAt || '').slice(11, 16) || '10:00';
      return { ...line, startAt: `${date}T${time}` };
    }));
  }

  private applyRouteDateSelection(): void {
    const routeDate = String(this.route.snapshot.queryParamMap.get('date') || '');
    if (/^\d{4}-\d{2}-\d{2}$/.test(routeDate)) {
      this.selectedDate.set(routeDate);
    }
  }

  private openRouteAppointmentIfNeeded(appointments: ApiRecord[]): void {
    const appointmentId = String(this.route.snapshot.queryParamMap.get('appointmentId') || '');
    if (!appointmentId) return;
    const appointment = appointments.find((row) => String(row.id || '') === appointmentId);
    if (!appointment) return;
    this.openAppointment(appointment);
    this.router.navigate([], {
      queryParams: { appointmentId: null, date: null },
      queryParamsHandling: 'merge',
      replaceUrl: true
    });
  }

  shiftMonth(direction: number): void {
    const date = new Date(`${this.selectedDate()}T00:00:00`);
    date.setMonth(date.getMonth() + direction);
    this.selectDate(this.dateInput(date));
  }

  reloadFromStart(): void {
    this.staffOffset.set(0);
    this.load();
  }

  showAppointmentDetails(card: AppointmentCard, event: MouseEvent | FocusEvent): void {
    this.appointmentHoverAnchor = event.currentTarget as HTMLElement | null;
    const rect = this.appointmentHoverAnchor?.getBoundingClientRect();
    this.hoveredAppointment.set({ card, x: rect ? rect.right + 12 : 12, y: rect?.top ?? 12 });
    this.scheduleAppointmentPopoverPosition();
  }

  hideAppointmentDetails(): void {
    this.appointmentHoverAnchor = null;
    this.appointmentDetailPopoverElement = undefined;
    if (typeof window !== 'undefined') window.cancelAnimationFrame(this.appointmentPopoverFrame);
    this.appointmentPopoverFrame = 0;
    this.hoveredAppointment.set(null);
  }

  showSlotHover(person: StaffLane, slot: TimeSlot, event: MouseEvent): void {
    const grid = (event.currentTarget as HTMLElement | null)?.closest('.scheduler-grid') as HTMLElement | null;
    const rect = grid?.getBoundingClientRect();
    const tooltipWidth = 260;
    if (!rect) {
      this.hoverSlot.set({ staffName: person.name, label: slot.label, left: 96, top: this.minuteTop(slot.minute) });
      return;
    }
    let left = event.clientX - rect.left + 12;
    if (left + tooltipWidth > rect.width - 8) left = event.clientX - rect.left - tooltipWidth - 12;
    this.hoverSlot.set({
      staffName: person.name,
      label: slot.label,
      left: Math.max(8, left),
      top: Math.max(10, event.clientY - rect.top - 10)
    });
  }

  private scheduleAppointmentPopoverPosition(): void {
    if (typeof window === 'undefined') return;
    window.cancelAnimationFrame(this.appointmentPopoverFrame);
    this.appointmentPopoverFrame = window.requestAnimationFrame(() => {
      this.appointmentPopoverFrame = 0;
      const current = this.hoveredAppointment();
      const anchor = this.appointmentHoverAnchor;
      const popover = this.appointmentDetailPopoverElement;
      if (!current || !anchor || !popover) return;
      const rect = popover.getBoundingClientRect();
      const position = appointmentPopoverPosition(
        anchor.getBoundingClientRect(),
        { width: rect.width, height: rect.height },
        { width: window.innerWidth, height: window.innerHeight }
      );
      this.hoveredAppointment.set({ ...current, ...position });
    });
  }
  setSlotMinutes(value: string): void {
    const next = normalizeAppointmentSlotMinutes(value);
    this.slotMinutes.set(next);
    if (this.appointmentToolbar.slotMinutes() !== next) this.appointmentToolbar.setSlotMinutes(next);
  }

  toggleScheduledStaffPanel(): void {
    if (this.staffPanelOpen()) {
      this.cancelScheduledStaffPanel();
      return;
    }
    const context = this.context();
    if (context) this.syncScheduledStaffPrefs(context);
    this.staffPanelOpen.set(true);
  }

  cancelScheduledStaffPanel(): void {
    const prefs = this.sanitizeScheduledStaffPrefs({ order: this.savedStaffPanelOrder(), hidden: this.savedHiddenStaffIds() }, this.context()?.staff || []);
    this.staffPanelOrder.set(prefs.order);
    this.hiddenStaffIds.set(prefs.hidden);
    this.staffPanelDragId.set('');
    this.staffPanelOpen.set(false);
  }

  saveScheduledStaffPanel(): void {
    const prefs = this.sanitizeScheduledStaffPrefs({ order: this.staffPanelOrder(), hidden: this.hiddenStaffIds() }, this.context()?.staff || []);
    this.staffPanelOrder.set(prefs.order);
    this.hiddenStaffIds.set(prefs.hidden);
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        window.localStorage.setItem(this.scheduledStaffStorageKey(), JSON.stringify(prefs));
      }
      this.savedStaffPanelOrder.set(prefs.order);
      this.savedHiddenStaffIds.set(prefs.hidden);
      this.staffPanelOpen.set(false);
      this.showNotice('Scheduled staff saved');
    } catch {
      this.showNotice('Unable to save scheduled staff preference');
    }
  }

  resetScheduledStaffPanel(): void {
    const ids = (this.context()?.staff || []).map((person) => person.id).filter(Boolean);
    this.staffPanelOrder.set(ids);
    this.hiddenStaffIds.set([]);
    this.staffPanelDragId.set('');
  }

  isScheduledStaffHidden(staffId: string): boolean {
    return this.hiddenStaffIds().includes(staffId);
  }

  canToggleScheduledStaff(staffId: string): boolean {
    return this.isScheduledStaffHidden(staffId) || this.visibleStaff().length > 1;
  }

  toggleScheduledStaffVisibility(staffId: string, checked: boolean): void {
    const hidden = new Set(this.hiddenStaffIds());
    if (checked) {
      hidden.delete(staffId);
    } else if (this.visibleStaff().length > 1) {
      hidden.add(staffId);
    } else {
      this.showNotice('At least one staff must stay visible', 1800);
      return;
    }
    this.hiddenStaffIds.set([...hidden]);
  }

  beginScheduledStaffDrag(staffId: string, event: DragEvent): void {
    this.staffPanelDragId.set(staffId);
    event.dataTransfer?.setData('text/plain', staffId);
    if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
  }

  allowScheduledStaffDrop(event: DragEvent): void {
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
  }

  dropScheduledStaff(targetStaffId: string, event: DragEvent): void {
    event.preventDefault();
    const sourceStaffId = event.dataTransfer?.getData('text/plain') || this.staffPanelDragId();
    this.moveScheduledStaff(sourceStaffId, targetStaffId);
    this.staffPanelDragId.set('');
  }

  endScheduledStaffDrag(): void {
    this.staffPanelDragId.set('');
  }

  moveScheduledStaffByOffset(staffId: string, offset: number): void {
    const order = this.currentStaffOrderIds();
    const from = order.indexOf(staffId);
    const to = Math.max(0, Math.min(order.length - 1, from + offset));
    if (from < 0 || from === to) return;
    order.splice(from, 1);
    order.splice(to, 0, staffId);
    this.staffPanelOrder.set(order);
  }

  private moveScheduledStaff(sourceStaffId: string, targetStaffId: string): void {
    if (!sourceStaffId || sourceStaffId === targetStaffId) return;
    const order = this.currentStaffOrderIds();
    const from = order.indexOf(sourceStaffId);
    const to = order.indexOf(targetStaffId);
    if (from < 0 || to < 0) return;
    const [source] = order.splice(from, 1);
    order.splice(to, 0, source);
    this.staffPanelOrder.set(order);
  }

  toggleCalendarFullscreen(): void {
    if (this.calendarFullscreen()) {
      this.exitCalendarFullscreen();
      return;
    }
    this.calendarFullscreen.set(true);
    if (typeof document !== 'undefined') document.body.classList.add('calendar-fullscreen-active');
  }

  exitCalendarFullscreen(): void {
    this.calendarFullscreen.set(false);
    if (typeof document !== 'undefined') document.body.classList.remove('calendar-fullscreen-active');
  }

  setCalendarLayout(value: string): void {
    const next = this.normalizeCalendarLayout(value);
    if (this.appointmentToolbar.calendarLayout() !== next) this.appointmentToolbar.setCalendarLayout(next);
    this.calendarLayout.set(next);
    this.draggingAppointment.set(null);
    this.resizeState.set(null);
    this.hoverSlot.set(null);
    this.closeSchedulerActionMenu();
    this.saveCalendarLayout(next);
  }

  isGridCalendarLayout(): boolean {
    const layout = this.calendarLayout();
    return layout === 'grid' || layout === 'compact-grid';
  }

  moveStaffWindow(direction: number): void {
    const next = Math.max(0, this.staffOffset() + direction * STAFF_LIMIT);
    this.staffOffset.set(next);
    this.load();
  }

  canMoveNextStaff(): boolean {
    const window = this.context()?.staffWindow;
    return Boolean(window && window.showingTo < window.total);
  }

  staffWindowLabel(): string {
    const window = this.context()?.staffWindow;
    if (!window || !window.total) return 'No staff';
    return `Showing ${window.showingFrom}-${window.showingTo} of ${window.total}`;
  }

  startStaffGridSwipe(event: PointerEvent): void {
    if (!this.isGridCalendarLayout() || (event.pointerType === 'mouse' && event.button !== 0)) return;
    const target = event.target instanceof HTMLElement ? event.target : null;
    if (target?.closest('.appointment-card, .resize-handle, .staff-menu-button, .staff-action-menu, .calendar-fullscreen-close, .calendar-fullscreen-toggle, .lane-block, input, select, textarea, a')) return;
    const grid = event.currentTarget instanceof HTMLElement ? event.currentTarget : null;
    if (!grid) return;
    this.staffGridSwipeState = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, startScrollLeft: grid.scrollLeft, grid, dragging: false };
    try {
      grid.setPointerCapture(event.pointerId);
    } catch {
      // Pointer capture can fail if the browser has already cancelled the pointer.
    }
  }

  moveStaffGridSwipe(event: PointerEvent): void {
    const state = this.staffGridSwipeState;
    if (!state || state.pointerId !== event.pointerId) return;
    const deltaX = event.clientX - state.startX;
    const deltaY = event.clientY - state.startY;
    const absX = Math.abs(deltaX);
    const absY = Math.abs(deltaY);
    if (!state.dragging) {
      if (absY > 12 && absY > absX) {
        this.cancelStaffGridSwipe();
        return;
      }
      if (absX < 12 || absX < absY * 1.2) return;
      state.dragging = true;
      this.staffGridSwiping.set(true);
      this.staffGridSwipeSuppressClick = true;
      this.hoverSlot.set(null);
    }
    event.preventDefault();
    state.grid.scrollLeft = state.startScrollLeft - deltaX;
  }

  endStaffGridSwipe(event: PointerEvent): void {
    const state = this.staffGridSwipeState;
    if (!state || state.pointerId !== event.pointerId) return;
    if (state.dragging) {
      event.preventDefault();
      this.completeStaffGridSwipe(state, event.clientX - state.startX);
      this.resetStaffGridClickGuardSoon();
    } else {
      this.staffGridSwipeSuppressClick = false;
    }
    this.releaseStaffGridPointer(state);
    this.staffGridSwipeState = null;
    this.staffGridSwiping.set(false);
  }

  cancelStaffGridSwipe(): void {
    if (this.staffGridSwipeState?.dragging) this.resetStaffGridClickGuardSoon();
    else this.staffGridSwipeSuppressClick = false;
    if (this.staffGridSwipeState) this.releaseStaffGridPointer(this.staffGridSwipeState);
    this.staffGridSwipeState = null;
    this.staffGridSwiping.set(false);
  }

  openQuickBookingFromGrid(staff: StaffLane, slot: TimeSlot, event: MouseEvent): void {
    if (this.staffGridSwipeSuppressClick) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    this.openQuickBooking(staff, slot);
  }

  private completeStaffGridSwipe(state: StaffGridSwipeState, deltaX: number): void {
    if (Math.abs(deltaX) < 72) return;
    const atStart = state.grid.scrollLeft <= 4;
    const atEnd = state.grid.scrollLeft + state.grid.clientWidth >= state.grid.scrollWidth - 4;
    if (deltaX < 0 && atEnd && this.canMoveNextStaff()) {
      state.grid.scrollLeft = 0;
      this.moveStaffWindow(1);
    } else if (deltaX > 0 && atStart && this.staffOffset() > 0) {
      state.grid.scrollLeft = Math.max(0, state.grid.scrollWidth - state.grid.clientWidth);
      this.moveStaffWindow(-1);
    }
  }

  private releaseStaffGridPointer(state: StaffGridSwipeState): void {
    try {
      if (state.grid.hasPointerCapture(state.pointerId)) state.grid.releasePointerCapture(state.pointerId);
    } catch {
      // Pointer capture may already be released after cancellation.
    }
  }

  private resetStaffGridClickGuardSoon(): void {
    const reset = () => {
      this.staffGridSwipeSuppressClick = false;
    };
    if (typeof window === 'undefined') {
      reset();
      return;
    }
    window.setTimeout(reset, 120);
  }

  openBlankBooking(): void {
    const staff = this.visibleStaff()[0];
    const slot = this.timeSlots()[0];
    if (staff && slot) this.openQuickBooking(staff, slot);
  }

  openAiSlotPilot(): void {
    this.drawer.set("ai-slots");
  }

  openOperationsPulse(): void {
    this.drawer.set('operations');
  }

  openDepositFollowUpReport(): void {
    this.router.navigateByUrl('/appointment-deposits?settlement=adjusted_due');
  }

  openQuickBooking(staff: StaffLane, slot: TimeSlot): void {
    if (!this.isStaffWorkingAt(staff.id, slot.minute)) {
      this.showNotice(`${staff.name} is not available at ${slot.label}.`);
      return;
    }
    this.error.set('');
    this.selectedStaff.set(staff);
    this.selectedAppointment.set(null);
    this.editingAppointmentId.set('');
    this.bookingForm.reset({ clientId: '', status: 'booked', notes: '', notifyClient: true, notifyStaff: true, notifyOwner: false });
    this.bookingClientSearch.set('');
    this.bookingClientSearchActive.set(false);
    this.clearClientServiceHistory();
    this.serviceSearchByLine.set({});
    this.staffSearchByLine.set({});
    this.serviceSearchActiveByLine.set({});
    this.staffSearchActiveByLine.set({});
    this.selectedServiceIdsByLine.set({});
    this.bookingLines.set([this.blankLine(staff.id, slot.input)]);
    this.drawer.set('booking');
  }

  openEditAppointment(appointment: ApiRecord): void {
    this.error.set('');
    const groupRows = this.appointmentEditRows(appointment);
    this.selectedAppointment.set(appointment);
    this.editingAppointmentId.set(String(appointment.id || ''));
    this.bookingClientSearch.set(this.clientName(appointment.clientId));
    this.bookingClientSearchActive.set(false);
    this.loadClientServiceHistory(String(appointment.clientId || ''));
    this.serviceSearchByLine.set({});
    this.staffSearchByLine.set({});
    this.serviceSearchActiveByLine.set({});
    this.staffSearchActiveByLine.set({});
    this.selectedServiceIdsByLine.set({});
    this.bookingForm.reset({
      clientId: appointment.clientId || '',
      status: appointment.status || 'booked',
      notes: appointment.notes || '',
      notifyClient: true,
      notifyStaff: true,
      notifyOwner: false
    });
    this.bookingLines.set(groupRows.map((row, index) => this.bookingLineFromAppointment(row, index)));
    this.drawer.set('booking');
  }

  private appointmentEditRows(appointment: ApiRecord): ApiRecord[] {
    const selectedId = String(appointment.id || '');
    const rows = this.appointmentGroupRows(appointment)
      .filter((row) => String(row.id || '') || row === appointment);
    const unique = new Map<string, ApiRecord>();
    for (const row of rows) {
      const id = String(row.id || '');
      if (!id) continue;
      unique.set(id, row);
    }
    if (selectedId && !unique.has(selectedId)) unique.set(selectedId, appointment);
    return Array.from(unique.values()).sort((left, right) =>
      new Date(String(left.startAt || left.createdAt || '')).getTime() - new Date(String(right.startAt || right.createdAt || '')).getTime()
      || String(left.groupMemberRole || left.group_member_role || '').localeCompare(String(right.groupMemberRole || right.group_member_role || ''))
      || String(left.id || '').localeCompare(String(right.id || ''))
    );
  }

  private bookingLineFromAppointment(appointment: ApiRecord, index: number): BookingLineDraft {
    const staffId = String(appointment.staffId || this.visibleStaff()[0]?.id || '');
    const serviceIds = this.appointmentServiceIds(appointment);
    const startAt = this.localInputFromIso(appointment.startAt || appointment.createdAt || new Date().toISOString());
    return {
      ...this.blankLine(staffId, startAt),
      id: `edit_${appointment.id || index}`,
      appointmentId: String(appointment.id || ''),
      serviceId: serviceIds[0] || '',
      staffId,
      startAt,
      durationMinutes: this.appointmentDuration(appointment),
      chair: appointment.chair || '',
      room: appointment.room || ''
    };
  }

  setBookingClientSearch(value: string): void {
    const next = value || '';
    this.bookingClientSearch.set(next);
    this.bookingClientSearchActive.set(true);
    const selected = this.clients().find((client) => this.bookingClientOption(client) === next);
    this.bookingForm.patchValue({ clientId: selected?.id || '' }, { emitEvent: false });
    if (selected?.id) {
      this.applyClientProfileNoteToBooking(selected);
      this.loadClientServiceHistory(String(selected.id));
    } else {
      this.clearClientServiceHistory();
    }
  }

  selectBookingClient(client: ApiRecord): void {
    this.bookingClientSearch.set(this.bookingClientOption(client));
    this.bookingForm.patchValue({ clientId: client.id || '' }, { emitEvent: false });
    this.applyClientProfileNoteToBooking(client);
    this.bookingClientSearchActive.set(false);
    this.loadClientServiceHistory(String(client.id || ''));
  }

  selectedBookingClientLabel(): string {
    const clientId = String(this.bookingForm.value.clientId || '');
    return clientId ? this.bookingClientOption(this.clientById().get(clientId) || { id: clientId }) : '';
  }

  selectedBookingClientId(): string {
    return String(this.bookingForm.value.clientId || '');
  }

  showBookingClientResults(): boolean {
    return this.bookingClientSearchActive() && this.bookingClientSearch().trim().length >= 1 && this.filteredClients().length > 0;
  }

  closeBookingClientSearchSoon(): void {
    window.setTimeout(() => this.bookingClientSearchActive.set(false), 120);
  }

  addServiceLine(): void {
    if (this.totalSelectedBookingServiceCount()) {
      this.addSelectedLineServices();
      return;
    }
    const lines = this.bookingLines();
    const last = lines.at(-1);
    const nextStart = this.nextServiceStartTime();
    this.bookingLines.set([...lines, this.blankLine(last?.staffId || this.visibleStaff()[0]?.id || '', nextStart)]);
  }

  private addSelectedLineServices(): void {
    const selectedByLine = this.selectedServiceIdsByLine();
    let lines = [...this.bookingLines()];
    const nextServiceSearch: Record<string, string> = { ...this.serviceSearchByLine() };
    const lineIds = lines.map((line) => line.id);

    for (const lineId of lineIds) {
      const serviceIds = Array.from(new Set(selectedByLine[lineId] || [])).filter(Boolean);
      if (!serviceIds.length) continue;
      const lineIndex = lines.findIndex((line) => line.id === lineId);
      if (lineIndex < 0) continue;
      const baseLine = lines[lineIndex];
      const builtLines: BookingLineDraft[] = [];
      for (let index = 0; index < serviceIds.length; index += 1) {
        const serviceId = serviceIds[index];
        const service = (this.serviceById().get(serviceId) || { id: serviceId }) as ApiRecord;
        const durationMinutes = this.serviceBlockDuration(service, baseLine.durationMinutes || 30);
        const previousLine = builtLines.at(-1);
        const startAt = previousLine
          ? this.nextServiceStartAfter(previousLine, { serviceId, staffId: baseLine.staffId })
          : baseLine.startAt;
        const nextLine = index === 0
          ? { ...baseLine, serviceId, durationMinutes }
          : { ...this.blankLine(baseLine.staffId, startAt), serviceId, durationMinutes, chair: baseLine.chair, room: baseLine.room };
        builtLines.push(nextLine);
        nextServiceSearch[nextLine.id] = this.bookingServiceOption(service);
      }
      lines = [...lines.slice(0, lineIndex), ...builtLines, ...lines.slice(lineIndex + 1)];
    }

    this.bookingLines.set(lines);
    this.serviceSearchByLine.set(nextServiceSearch);
    this.serviceSearchActiveByLine.set({});
    this.selectedServiceIdsByLine.set({});
  }

  removeServiceLine(idValue: string): void {
    this.bookingLines.set(this.bookingLines().filter((line) => line.id !== idValue));
    this.dropLineSearch(idValue);
  }

  updateLine(idValue: string, key: keyof BookingLineDraft, value: string): void {
    let changedIndex = -1;
    const lines = this.bookingLines().map((line, index) => {
      if (line.id !== idValue) return line;
      changedIndex = index;
      const next = { ...line, [key]: key === 'durationMinutes' ? Number(value || 30) : value };
      if (key === 'serviceId') {
        next.durationMinutes = this.serviceBlockDuration(this.serviceById().get(String(value || '')), next.durationMinutes || 30);
      }
      return next;
    });
    const resequenceFrom = key === 'serviceId' || key === 'staffId'
      ? Math.max(1, changedIndex)
      : changedIndex + 1;
    this.bookingLines.set(['serviceId', 'staffId', 'durationMinutes', 'startAt'].includes(String(key)) && changedIndex >= 0
      ? this.resequenceBookingLines(lines, resequenceFrom)
      : lines);
  }

  filteredServices(line: BookingLineDraft): ApiRecord[] {
    return this.includeSelected(
      this.filterApiRecords(this.services(), this.lineSearch(this.serviceSearchByLine(), line.id), (service) => [
        service.name,
        service.category,
        service.serviceCode,
        service.price,
        service.durationMinutes,
        service.id
      ]),
      this.services(),
      line.serviceId
    );
  }

  filteredStaff(line: BookingLineDraft): StaffLane[] {
    return this.includeSelected(
      this.filterStaff(this.allStaffChoices(), this.lineSearch(this.staffSearchByLine(), line.id)),
      this.allStaffChoices(),
      line.staffId
    );
  }

  lineServiceSearchValue(line: BookingLineDraft): string {
    const typed = this.lineSearch(this.serviceSearchByLine(), line.id);
    if (typed || !line.serviceId) return typed;
    return this.bookingServiceOption(this.serviceById().get(line.serviceId) || { id: line.serviceId });
  }

  lineStaffSearchValue(line: BookingLineDraft): string {
    const typed = this.lineSearch(this.staffSearchByLine(), line.id);
    if (typed || !line.staffId) return typed;
    return this.bookingStaffOption(this.staffById().get(line.staffId) || { id: line.staffId, name: line.staffId });
  }

  selectLineService(line: BookingLineDraft, service: ApiRecord): void {
    this.updateLine(line.id, 'serviceId', String(service.id || ''));
    this.setLineSearch('service', line.id, this.bookingServiceOption(service));
    this.setLineSearchActive('service', line.id, false);
  }

  selectedLineServiceIds(line: BookingLineDraft): string[] {
    return this.selectedServiceIdsByLine()[line.id] || [];
  }

  isLineServiceSelected(line: BookingLineDraft, serviceId: unknown): boolean {
    return this.selectedLineServiceIds(line).includes(String(serviceId || ''));
  }

  toggleLineServiceSelection(line: BookingLineDraft, service: ApiRecord): void {
    const serviceId = String(service.id || '');
    if (!serviceId) return;
    this.selectedServiceIdsByLine.update((current) => {
      const selected = current[line.id] || [];
      const nextSelected = selected.includes(serviceId)
        ? selected.filter((id) => id !== serviceId)
        : [...selected, serviceId];
      return { ...current, [line.id]: nextSelected };
    });
    this.setLineSearchActive('service', line.id, true);
  }

  selectVisibleLineServices(line: BookingLineDraft): void {
    const next = new Set(this.selectedLineServiceIds(line));
    for (const service of this.filteredServices(line)) {
      const serviceId = String(service.id || '');
      if (serviceId) next.add(serviceId);
    }
    this.selectedServiceIdsByLine.update((current) => ({ ...current, [line.id]: Array.from(next) }));
    this.setLineSearchActive('service', line.id, true);
  }

  clearLineServiceSelection(lineId: string): void {
    this.selectedServiceIdsByLine.update((current) => {
      const next = { ...current };
      delete next[lineId];
      return next;
    });
    this.setLineSearchActive('service', lineId, true);
  }

  selectLineStaff(line: BookingLineDraft, person: StaffLane): void {
    this.updateLine(line.id, 'staffId', String(person.id || ''));
    this.setLineSearch('staff', line.id, this.bookingStaffOption(person));
    this.setLineSearchActive('staff', line.id, false);
  }

  clearLineStaffSelection(line: BookingLineDraft): void {
    this.updateLine(line.id, 'staffId', '');
    this.setLineSearch('staff', line.id, '');
    this.setLineSearchActive('staff', line.id, false);
  }

  refreshPreviousServices(): void {
    this.loadClientServiceHistory(this.selectedBookingClientId(), true);
  }

  async loadClientServiceHistory(clientId: string, force = false): Promise<void> {
    if (!clientId) {
      this.clearClientServiceHistory();
      return;
    }
    if (!force && this.clientServiceHistory().some((row) => row.id.includes(clientId))) return;
    this.clientServiceHistoryLoading.set(true);
    this.clientServiceHistoryError.set('');
    try {
      const [invoices, sales] = await Promise.all([
        firstValueFrom(this.api.list<ApiRecord[]>('invoices', { clientId, customerId: clientId, limit: 200 })),
        firstValueFrom(this.api.list<ApiRecord[]>('sales', { clientId, customerId: clientId, limit: 200 }))
      ]);
      this.clientServiceHistory.set(this.buildClientServiceHistory(clientId, invoices || [], sales || []));
    } catch (error) {
      this.clientServiceHistory.set([]);
      this.clientServiceHistoryError.set(this.api.errorText(error, 'Unable to load previous service history.'));
    } finally {
      this.clientServiceHistoryLoading.set(false);
    }
  }

  addPreviousServiceToBooking(item: ClientServiceHistoryRow): void {
    const service = this.findServiceForHistory(item);
    if (!service?.id) {
      this.showNotice(`${item.serviceName} was not found in the service master. Select the service manually.`);
      return;
    }
    const lines = this.bookingLines();
    const emptyLine = lines.find((line) => !line.serviceId);
    const targetStaffId = item.staffId || this.visibleStaff()[0]?.id || '';
    const targetStartAt = this.nextServiceStartTime({ serviceId: String(service.id), staffId: targetStaffId });
    const target = emptyLine || this.blankLine(targetStaffId, targetStartAt);
    const nextLine = {
      ...target,
      serviceId: String(service.id),
      staffId: item.staffId || target.staffId || this.visibleStaff()[0]?.id || '',
      durationMinutes: Number(item.durationMinutes || service.durationMinutes || 30)
    };
    const nextLines = emptyLine
      ? lines.map((line) => line.id === emptyLine.id ? nextLine : line)
      : [...lines, nextLine];
    this.bookingLines.set(this.resequenceBookingLines(nextLines, Math.max(1, nextLines.findIndex((line) => line.id === nextLine.id))));
    this.setLineSearch('service', nextLine.id, this.bookingServiceOption(service));
    if (nextLine.staffId) {
      this.setLineSearch('staff', nextLine.id, this.bookingStaffOption(this.staffById().get(nextLine.staffId) || { id: nextLine.staffId, name: item.staffName || nextLine.staffId }));
    }
    this.showNotice(`${item.serviceName} added. Last charged ${this.money(item.price)}.`);
  }

  showLineServiceResults(line: BookingLineDraft): boolean {
    return this.lineSearchActive(this.serviceSearchActiveByLine(), line.id) && this.lineSearch(this.serviceSearchByLine(), line.id).trim().length > 0 && this.filteredServices(line).length > 0;
  }

  showLineStaffResults(line: BookingLineDraft): boolean {
    return this.lineSearchActive(this.staffSearchActiveByLine(), line.id) && this.filteredStaff(line).length > 0;
  }

  showLineServiceEmpty(line: BookingLineDraft): boolean {
    return this.lineSearchActive(this.serviceSearchActiveByLine(), line.id) && this.lineSearch(this.serviceSearchByLine(), line.id).trim().length > 0 && !this.filteredServices(line).length;
  }

  showLineServiceMultiHint(line: BookingLineDraft): boolean {
    return this.lineSearchActive(this.serviceSearchActiveByLine(), line.id)
      && this.lineSearch(this.serviceSearchByLine(), line.id).trim().length > 0
      && this.filteredServices(line).length > 1
      && !this.selectedLineServiceIds(line).length;
  }

  showLineStaffEmpty(line: BookingLineDraft): boolean {
    return this.lineSearchActive(this.staffSearchActiveByLine(), line.id) && this.lineSearch(this.staffSearchByLine(), line.id).trim().length > 0 && !this.filteredStaff(line).length;
  }

  lineSearch(source: Record<string, string>, lineId: string): string {
    return source[lineId] || '';
  }

  lineSearchActive(source: Record<string, boolean>, lineId: string): boolean {
    return Boolean(source[lineId]);
  }

  setLineSearch(kind: 'service' | 'staff', lineId: string, value: string): void {
    const target = kind === 'service' ? this.serviceSearchByLine : this.staffSearchByLine;
    target.update((current) => ({ ...current, [lineId]: value }));
    this.setLineSearchActive(kind, lineId, true);
  }

  setLineSearchActive(kind: 'service' | 'staff', lineId: string, value: boolean): void {
    const target = kind === 'service' ? this.serviceSearchActiveByLine : this.staffSearchActiveByLine;
    target.update((current) => ({ ...current, [lineId]: value }));
  }

  closeLineSearchSoon(kind: 'service' | 'staff', lineId: string): void {
    window.setTimeout(() => this.setLineSearchActive(kind, lineId, false), 120);
  }

  private dropLineSearch(lineId: string): void {
    this.serviceSearchByLine.update((current) => {
      const next = { ...current };
      delete next[lineId];
      return next;
    });
    this.staffSearchByLine.update((current) => {
      const next = { ...current };
      delete next[lineId];
      return next;
    });
    this.serviceSearchActiveByLine.update((current) => {
      const next = { ...current };
      delete next[lineId];
      return next;
    });
    this.staffSearchActiveByLine.update((current) => {
      const next = { ...current };
      delete next[lineId];
      return next;
    });
    this.selectedServiceIdsByLine.update((current) => {
      const next = { ...current };
      delete next[lineId];
      return next;
    });
  }

  private filterApiRecords(records: ApiRecord[], query: string, fields: (record: ApiRecord) => unknown[]): ApiRecord[] {
    const needle = this.normalizeSearch(query);
    if (!needle) return records;
    return records.filter((record) => fields(record).some((field) => this.normalizeSearch(field).includes(needle)));
  }

  private filterStaff(records: StaffLane[], query: string): StaffLane[] {
    const needle = this.normalizeSearch(query);
    if (!needle) return records;
    return records
      .map((person, index) => ({ person, score: this.smartSearchScore([
        person.name,
        person.fullName,
        this.initials(person.name),
        person.shortName,
        person.role,
        person.designation,
        person.specialization,
        person.department,
        person.status,
        person.phone,
        person.mobile,
        person.contact,
        person.phoneNumber,
        person.employeeCode,
        person.staffCode,
        person.code,
        person.id,
        String(index + 1),
        `id ${index + 1}`,
        `staff ${index + 1}`,
        `employee ${index + 1}`
      ], needle) }))
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score)
      .map((entry) => entry.person);
  }

  staffResultMeta(person: StaffLane): string {
    const role = person.role || person.designation || person.specialization || person.department || 'Staff';
    const phone = person.phone || person.mobile || person.contact || person.phoneNumber || '';
    const branch = person.branchName || person.branch || '';
    const smartId = this.staffSmartIdLabel(person);
    return [smartId, role, phone, branch].filter(Boolean).join(' · ');
  }

  private staffSmartIdLabel(person: StaffLane): string {
    const code = person.employeeCode || person.staffCode || person.code || person.id || '';
    return code ? `ID ${code}` : '';
  }

  private smartFilterApiRecords(records: ApiRecord[], query: string, fields: (record: ApiRecord, index: number) => unknown[]): ApiRecord[] {
    return records
      .map((record, index) => ({ record, score: this.smartSearchScore(fields(record, index), query) }))
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score)
      .map((entry) => entry.record);
  }

  private smartSearchScore(fields: unknown[], query: string): number {
    const normalizedFields = fields.map((field) => this.normalizeSearch(field)).filter(Boolean);
    const compactQuery = this.compactSearch(query);
    const digitQuery = this.phoneDigits(query);
    if (normalizedFields.some((field) => field === query || this.compactSearch(field) === compactQuery)) return 120;
    if (digitQuery && normalizedFields.some((field) => this.phoneDigits(field).includes(digitQuery))) return 110;
    if (normalizedFields.some((field) => field.startsWith(query) || this.compactSearch(field).startsWith(compactQuery))) return 95;
    if (normalizedFields.some((field) => field.includes(query) || this.compactSearch(field).includes(compactQuery))) return 80;
    if (normalizedFields.some((field) => this.smartSearchDistance(field, query) <= this.smartSearchTolerance(query))) return 54;
    if (normalizedFields.some((field) => this.searchLettersExistInField(field, query))) return 42;
    return 0;
  }

  private phoneDigits(value: unknown): string {
    const digits = String(value || '').replace(/\D/g, '');
    return digits.length > 10 ? digits.slice(-10) : digits;
  }

  private smartSearchTolerance(query: string): number {
    if (query.length < 4) return 0;
    if (query.length < 7) return 1;
    return 2;
  }

  private smartSearchDistance(value: string, query: string): number {
    const target = value.split(/\s+/).find((part) => Math.abs(part.length - query.length) <= 2) || value;
    if (Math.abs(target.length - query.length) > 2) return 9;
    const previous = Array.from({ length: query.length + 1 }, (_, index) => index);
    for (let i = 1; i <= target.length; i += 1) {
      let diagonal = previous[0];
      previous[0] = i;
      for (let j = 1; j <= query.length; j += 1) {
        const temp = previous[j];
        previous[j] = target[i - 1] === query[j - 1]
          ? diagonal
          : Math.min(previous[j] + 1, previous[j - 1] + 1, diagonal + 1);
        diagonal = temp;
      }
    }
    return previous[query.length];
  }

  private includeSelected<T extends { id?: string }>(filtered: T[], all: T[], selectedId: string): T[] {
    if (!selectedId || filtered.some((item) => item.id === selectedId)) return filtered;
    const selected = all.find((item) => item.id === selectedId);
    return selected ? [selected, ...filtered] : filtered;
  }

  private normalizeSearch(value: unknown): string {
    return String(value || '').toLowerCase().trim();
  }

  private compactSearch(value: unknown): string {
    return this.normalizeSearch(value).replace(/[^a-z0-9]+/g, '');
  }

  private searchLettersExistInField(field: string, query: string): boolean {
    const letters = this.compactSearch(query).split('');
    if (!letters.length || letters.some((letter) => /\d/.test(letter))) return false;
    const counts = new Map<string, number>();
    for (const letter of this.compactSearch(field)) {
      counts.set(letter, (counts.get(letter) || 0) + 1);
    }
    return letters.every((letter) => {
      const next = (counts.get(letter) || 0) - 1;
      if (next < 0) return false;
      counts.set(letter, next);
      return true;
    });
  }

  async createBooking(): Promise<void> {
    if (this.bookingForm.invalid) {
      this.bookingForm.markAllAsTouched();
      this.error.set('Select a client before creating the booking.');
      return;
    }
    this.error.set('');
    if (this.totalSelectedBookingServiceCount()) this.addSelectedLineServices();
    const lines = this.bookingLines();
    if (lines.some((line) => !line.serviceId || !line.staffId || !line.startAt)) {
      this.error.set('Every service line needs service, staff and start time.');
      return;
    }
    const conflictMessage = this.bookingConflictMessage(lines);
    if (conflictMessage) {
      this.error.set(conflictMessage);
      return;
    }
    const notifyTargets = [
      this.bookingForm.value.notifyClient ? 'client' : '',
      this.bookingForm.value.notifyStaff ? 'staff' : '',
      this.bookingForm.value.notifyOwner ? 'owner' : ''
    ].filter(Boolean);
    this.saving.set(true);
    let committedAppointments: ApiRecord[] = [];
    try {
      const bookedClientId = String(this.bookingForm.value.clientId || '');
      const payload = {
        branchId: this.context()?.branchId || this.state.selectedBranchId(),
        clientId: this.bookingForm.value.clientId,
        status: this.bookingForm.value.status || 'booked',
        notes: this.bookingForm.value.notes || '',
        notifyTargets,
        lines: lines.map((line) => ({
          serviceId: line.serviceId,
          staffId: line.staffId,
          startAt: this.isoFromLocal(line.startAt),
          durationMinutes: Number(line.durationMinutes || 30),
          chair: String(line.chair || '').trim(),
          room: String(line.room || '').trim()
        }))
      };
      if (this.editingAppointmentId()) {
        const editingAppointment = this.selectedAppointment();
        const editRows = this.appointmentEditRows(editingAppointment || {});
        if (lines.length !== editRows.length) {
          this.error.set('Group booking service lines add/remove nahi ki ja sakti. Har existing service line ko edit karke save karein.');
          return;
        }
        const updatedAppointments = await Promise.all(editRows.map((row, index) => {
          const line = lines.find((item) => item.appointmentId && item.appointmentId === String(row.id || '')) || lines[index];
          return firstValueFrom(this.api.update<ApiRecord>('appointments', String(row.id || ''), {
            branchId: payload.branchId,
            clientId: payload.clientId,
            status: payload.status,
            notes: payload.notes,
            version: row.version || 1,
            serviceIds: [line.serviceId],
            staffId: line.staffId,
            startAt: this.isoFromLocal(line.startAt),
            endAt: this.isoFromLocal(this.addLocalMinutes(line.startAt, Number(line.durationMinutes || 30))),
            durationMinutes: Number(line.durationMinutes || 30),
            chair: String(line.chair || '').trim(),
            room: String(line.room || '').trim()
          }));
        }));
        committedAppointments = updatedAppointments.filter(Boolean);
        this.lastBookedClientId.set(bookedClientId);
        this.showNotice(`${committedAppointments.length || 1} service line(s) updated`);
      } else {
        const result = await firstValueFrom(this.api.post<ApiRecord>('appointment-deposits/multi-service-bookings', payload));
        committedAppointments = Array.isArray(result.appointments) ? result.appointments : [];
        this.lastBookedClientId.set(bookedClientId);
        this.showNotice(result.deposit?.required
          ? `20% advance link sent: ${result.deposit.depositAmount} INR. Appointment will confirm after payment.`
          : `${result.appointments?.length || lines.length} appointment service line(s) created`);
      }
      this.closeDrawer();
      await this.load();
      this.mergeAppointmentsIntoContext(committedAppointments);
    } catch (error) {
      this.error.set(this.bookingErrorText(error));
    } finally {
      this.saving.set(false);
    }
  }

  private bookingConflictMessage(lines: BookingLineDraft[]): string {
    return '';
  }

  private bookingErrorText(error: unknown): string {
    const conflicts = this.errorConflicts(error);
    if (conflicts.length) {
      const first = conflicts[0];
      const staff = this.staffName(String(first.staffId || ''));
      const client = this.clientName(String(first.clientId || ''));
      const service = this.serviceNames(this.appointmentServiceIds(first));
      const time = first.startAt ? `${this.shortTime(String(first.startAt))}-${this.shortTime(String(first.endAt || first.startAt))}` : '';
      return `${staff || 'Staff'} is busy at ${time}${client ? ` (${client}${service ? ` · ${service}` : ''})` : ''}. Change time or staff.`;
    }
    return this.api.errorText(error, 'Unable to create booking');
  }

  private errorConflicts(error: unknown): ApiRecord[] {
    const payload = (error as { error?: ApiRecord })?.error || {};
    const details = payload.details || (payload.error as ApiRecord | undefined)?.details || {};
    const conflicts = (details as ApiRecord)?.conflicts;
    return Array.isArray(conflicts) ? conflicts : [];
  }

  openAddBlockedTime(staff: StaffLane, slot: TimeSlot, event: Event): void {
    event.preventDefault();
    event.stopPropagation();
    this.selectedStaff.set(staff);
    this.blockMode.set('add');
    this.blockForm.reset({
      date: this.selectedDate(),
      staffId: staff.id,
      startTime: this.hhmm(slot.minute),
      endTime: this.hhmm(slot.minute + this.activeSlotMinutes()),
      reason: 'Blocked time'
    });
    this.drawer.set('blocked-time');
  }

  openRemoveBlockedTime(staff: StaffLane, event: Event): void {
    event.preventDefault();
    event.stopPropagation();
    this.selectedStaff.set(staff);
    this.blockMode.set('remove');
    this.drawer.set('blocked-time');
  }

  openSchedulerActionMenu(person: StaffLane, event: MouseEvent): void {
    event.preventDefault();
    event.stopPropagation();
    const lane = (event.currentTarget as HTMLElement).closest('.staff-lane') as HTMLElement | null;
    const rect = lane?.getBoundingClientRect();
    const rawY = rect ? event.clientY - rect.top : 0;
    const minute = rawY > 0
      ? this.snapMinute(DAY_START_MINUTES + (rawY / this.rowHeight()) * this.activeSlotMinutes())
      : DAY_START_MINUTES;
    this.schedulerActionMenu.set({
      staffId: person.id,
      minute,
      top: rawY > 0 ? Math.max(10, this.minuteTop(minute) - 4) : 10
    });
  }

  closeSchedulerActionMenu(): void {
    this.schedulerActionMenu.set(null);
  }

  openAddBlockedTimeFromMenu(staff: StaffLane, minute: number): void {
    this.closeSchedulerActionMenu();
    this.openAddBlockedTime(staff, { minute, label: this.timeLabel(minute), input: this.localDateTime(minute) }, new Event('click'));
  }

  openRemoveBlockedTimeFromMenu(staff: StaffLane, minute: number): void {
    this.closeSchedulerActionMenu();
    this.selectedStaff.set(staff);
    this.blockMode.set('remove');
    this.blockForm.patchValue({
      date: this.selectedDate(),
      staffId: staff.id,
      startTime: this.hhmm(this.snapMinute(minute))
    });
    this.drawer.set('blocked-time');
  }

  async saveBlockedTime(): Promise<void> {
    if (this.blockForm.invalid) return;
    this.saving.set(true);
    try {
      await firstValueFrom(this.api.post('enterprise-scheduler/blocked-times', {
        branchId: this.context()?.branchId || this.state.selectedBranchId(),
        ...this.blockForm.value
      }));
      this.showNotice('Blocked time saved');
      this.closeDrawer();
      await this.load();
    } catch (error) {
      this.error.set(this.api.errorText(error, 'Unable to save blocked time'));
    } finally {
      this.saving.set(false);
    }
  }

  removableBlocks(): ApiRecord[] {
    const staffId = this.selectedStaff()?.id || '';
    return (this.context()?.blockedTimes || []).filter((block) => block.staffId === staffId);
  }

  async removeBlockedTime(idValue: string): Promise<void> {
    this.saving.set(true);
    try {
      await firstValueFrom(this.api.delete(`enterprise-scheduler/blocked-times`, idValue));
      this.showNotice('Blocked time removed');
      await this.load();
    } catch (error) {
      this.error.set(this.api.errorText(error, 'Unable to remove blocked time'));
    } finally {
      this.saving.set(false);
    }
  }

  openAppointment(appointment: ApiRecord): void {
    this.selectedAppointment.set(appointment);
    this.setAppointmentNoteDraftValue(appointment, this.appointmentNoteText(appointment));
    this.appointmentDetailTab.set('booking');
    this.drawer.set('appointment');
    void this.refreshAppointmentBillingStatus(appointment);
  }

  async saveAppointmentNote(appointment: ApiRecord): Promise<void> {
    const id = this.appointmentKey(appointment);
    if (!id) return;
    const notes = this.appointmentNoteDraft(appointment).trim();
    this.appointmentNoteSavingId.set(id);
    try {
      const updated = await firstValueFrom(this.api.update<ApiRecord>('appointments', id, {
        notes,
        version: appointment.version || 1
      }));
      this.applyAppointmentPatch(id, { ...updated, notes });
      this.setAppointmentNoteDraftValue({ ...appointment, id }, notes);
      await this.syncAppointmentNoteToClientProfile(appointment, notes);
      this.showNotice('Appointment note saved to client profile');
    } catch (error) {
      this.error.set(this.api.errorText(error, 'Unable to save appointment note'));
    } finally {
      this.appointmentNoteSavingId.set('');
    }
  }

  async setStatus(appointment: ApiRecord, status: string): Promise<void> {
    try {
      const localGroupRows = this.appointmentGroupRows(appointment);
      const appointmentIds = localGroupRows.map((row) => String(row.id || '')).filter(Boolean);
      const result = await firstValueFrom(this.api.post<ApiRecord>(`appointment-lifecycle/appointments/${appointment.id}/status`, { status, applyGroup: true, appointmentIds }));
      const updatedAppointment = (result['appointment'] as ApiRecord | undefined) || appointment;
      const groupAppointments = Array.isArray(result['appointments']) && result['appointments'].length
        ? result['appointments'] as ApiRecord[]
        : localGroupRows.map((row) => ({ ...row, status }));
      this.mergeAppointmentsIntoContext(groupAppointments);
      if (this.selectedAppointment()) this.selectedAppointment.set({ ...updatedAppointment, status });
      const serviceCount = this.groupAppointmentServiceIds(appointment, groupAppointments).length || groupAppointments.length || 1;
      this.showNotice(`${serviceCount} service line${serviceCount === 1 ? '' : 's'} marked ${this.label(status)}`);
      if (status === 'completed') {
        this.goToPos(updatedAppointment, groupAppointments);
        return;
      }
      await this.load();
    } catch (error) {
      this.error.set(this.api.errorText(error, 'Unable to update appointment status'));
    }
  }

  async queueSms(appointment: ApiRecord, target: 'client' | 'staff' | 'owner'): Promise<void> {
    try {
      await firstValueFrom(this.api.post(`appointment-sms/appointments/${appointment.id}/queue`, { target }));
      this.showNotice(`SMS queued for ${target}`);
    } catch (error) {
      this.error.set(this.api.errorText(error, 'Unable to queue SMS'));
    }
  }

  async convertToPos(appointment: ApiRecord): Promise<void> {
    if (await this.ensureAppointmentPosAllowed(appointment)) {
      this.goToPos(appointment);
    }
  }

  printAppointmentBill(): void {
    window.print();
  }

  openClientHistory(appointment: ApiRecord): void {
    const client = this.clientById().get(appointment.clientId);
    this.router.navigate(['/clients'], {
      queryParams: {
        clientId: appointment.clientId || undefined,
        q: client?.phone || client?.mobile || client?.name || this.clientName(appointment.clientId)
      }
    });
  }

  openClientHistoryById(clientId: string): void {
    if (!clientId) return;
    this.router.navigate(['/clients', clientId]);
  }

  async handleAppointmentAction(appointment: ApiRecord, action: string): Promise<void> {
    if (!action) return;
    if (this.isCompletedAppointment(appointment)) {
      if (action === 'completed') return;
      if (!this.completedAllowedActions.has(action)) {
        this.showNotice('Completed booking me ye action available nahi hai.');
        return;
      }
    }
    if (action === 'edit' || action === 'reschedule') {
      this.openEditAppointment(appointment);
      return;
    }
    if (action === 'add-payment' || action === 'add-tip') {
      this.goToPos(appointment);
      return;
    }
    await this.setStatus(appointment, action);
  }

  beginDrag(appointment: ApiRecord): void {
    this.draggingAppointment.set(appointment);
  }

  clearDrag(): void {
    this.draggingAppointment.set(null);
  }

  async dropAppointment(staff: StaffLane, event: DragEvent): Promise<void> {
    event.preventDefault();
    const appointment = this.draggingAppointment();
    if (!appointment || !event.currentTarget) return;
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    const minute = this.snapMinute(DAY_START_MINUTES + ((event.clientY - rect.top) / this.rowHeight()) * this.activeSlotMinutes());
    const duration = Math.max(15, this.appointmentDuration(appointment));
    await this.moveAppointment(appointment, staff.id, this.isoAtMinute(minute), this.isoAtMinute(minute + duration), 'Drag-drop scheduler move');
    this.clearDrag();
  }

  beginResize(appointment: ApiRecord, event: PointerEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.resizeState.set({ appointment, startY: event.clientY, originalEnd: appointment.endAt || this.isoAtMinute(this.minuteOf(appointment.startAt) + 30) });
  }

  private readonly onResizeMove = (event: PointerEvent): void => {
    const state = this.resizeState();
    if (!state) return;
    event.preventDefault();
  };

  private readonly onResizeEnd = async (event: PointerEvent): Promise<void> => {
    const state = this.resizeState();
    if (!state) return;
    const deltaRows = Math.round((event.clientY - state.startY) / this.rowHeight());
    const deltaMinutes = deltaRows * this.activeSlotMinutes();
    const startMinute = this.minuteOf(state.appointment.startAt);
    const originalEndMinute = this.minuteOf(state.originalEnd);
    const nextEndMinute = Math.max(startMinute + this.activeSlotMinutes(), this.snapMinute(originalEndMinute + deltaMinutes));
    this.resizeState.set(null);
    await this.moveAppointment(state.appointment, state.appointment.staffId || '', state.appointment.startAt, this.isoAtMinute(nextEndMinute), 'Resize appointment duration');
  };

  private async moveAppointment(appointment: ApiRecord, staffId: string, startAt: string, endAt: string, reason: string): Promise<void> {
    try {
      await firstValueFrom(this.api.patch(`enterprise-scheduler/appointments/${appointment.id}/move`, { staffId, startAt, endAt, reason }));
      this.showNotice('Appointment updated');
      await this.load();
    } catch (error) {
      this.error.set(this.api.errorText(error, 'Unable to move appointment'));
    }
  }

  closeDrawer(): void {
    this.drawer.set('');
    this.selectedAppointment.set(null);
    this.editingAppointmentId.set('');
    this.appointmentDetailTab.set('booking');
    this.closeSchedulerActionMenu();
  }

  openWaitlistEntry(): void {
    this.waitlistError.set('');
    this.waitlistMessage.set('');
    this.waitlistForm.patchValue({ preferredDate: this.selectedDate() });
    this.drawer.set('waitlist');
  }

  async saveWaitlistEntry(): Promise<void> {
    if (this.waitlistForm.invalid) return;
    const value = this.waitlistForm.value;
    const preferredDate = String(value.preferredDate || this.selectedDate());
    const windowStart = this.waitlistWindowIso(preferredDate, String(value.windowStartTime || ''));
    const windowEnd = this.waitlistWindowIso(preferredDate, String(value.windowEndTime || ''));
    this.waitlistSaving.set(true);
    this.waitlistError.set('');
    try {
      await firstValueFrom(this.api.post<ApiRecord>('waitlist', {
        branchId: this.context()?.branchId || this.state.selectedBranchId(),
        clientId: value.clientId,
        serviceId: value.serviceId || '',
        staffId: value.staffId || '',
        preferredDate,
        windowStart,
        windowEnd,
        priority: Number(value.priority || 0),
        notes: value.notes || '',
        status: 'waiting'
      }));
      this.waitlistMessage.set('Waitlist entry saved.');
      await this.load();
      this.closeDrawer();
    } catch (error) {
      this.waitlistError.set(this.api.errorText(error, 'Unable to save waitlist entry'));
    } finally {
      this.waitlistSaving.set(false);
    }
  }

  summaryValue(key: string): number {
    return Number(this.context()?.summary?.[key] || 0);
  }

  appointmentBillingLocked(appointment: ApiRecord): boolean {
    return !!appointment?.billingLocked;
  }

  appointmentBillingLabel(appointment: ApiRecord): string {
    if (this.appointmentBillingLocked(appointment)) return 'Already billed';
    return this.label(String(appointment.status || 'booked'));
  }

  appointmentNoteDraft(appointment: ApiRecord): string {
    const id = this.appointmentKey(appointment);
    const drafts = this.appointmentNoteDrafts();
    return id && Object.prototype.hasOwnProperty.call(drafts, id) ? drafts[id] : this.appointmentNoteText(appointment);
  }

  setAppointmentNoteDraft(appointment: ApiRecord, value: string): void {
    this.setAppointmentNoteDraftValue(appointment, value);
  }

  clientProfileNoteSummary(clientId: string): string {
    const client = this.clientById().get(clientId);
    const raw = this.clientProfileNoteText(client);
    if (!raw) return '';
    const summary = raw
      .replace(/(^|\n)(Front desk notes|Internal notes|Follow-up notes):\s*/gi, '$1$2: ')
      .split(/\n+/)
      .map((line) => line.trim())
      .filter(Boolean)
      .join(' | ');
    return summary.length > 240 ? `${summary.slice(0, 237)}...` : summary;
  }

  selectedBookingClientProfileNote(): string {
    return this.clientProfileNoteSummary(this.selectedBookingClientId());
  }

  appointmentActionOptions(appointment: ApiRecord): AppointmentActionOption[] {
    return this.isCompletedAppointment(appointment) ? this.completedAppointmentActions : this.appointmentActions;
  }

  appointmentActionValue(appointment: ApiRecord): string {
    const status = this.normalizedAppointmentStatus(appointment.status);
    if (this.isCompletedAppointment(appointment) && !this.completedAllowedActions.has(status)) return 'completed';
    return status || 'booked';
  }

  isCompletedAppointment(appointment: ApiRecord): boolean {
    const status = this.normalizedAppointmentStatus(appointment.status);
    return status === 'completed' || status === 'billed' || status === 'paid' || this.appointmentBillingLocked(appointment);
  }

  cellCount(staffId: string, minute: number): number {
    return (this.appointmentCardsByStaff().get(staffId) || []).filter((card) => {
      const start = this.topToMinute(card.top);
      const end = this.topToMinute(card.top + card.height);
      return minute >= start && minute < end;
    }).length;
  }

  blockedCountForStaff(staffId: string): number {
    return (this.context()?.blockedTimes || []).filter((block) => block.staffId === staffId).length;
  }

  hoverSummary(): string {
    const hover = this.hoverSlot();
    if (!hover) return '0 - 0 - 0';
    return `${this.context()?.appointmentTotal || 0} - ${this.summaryValue('conflicts')} - ${this.summaryValue('waitlist')}`;
  }

  currentTimeTop(): number {
    if (this.selectedDate() !== new Date().toISOString().slice(0, 10)) return -1;
    const date = this.now();
    const minute = date.getHours() * 60 + date.getMinutes();
    if (minute < DAY_START_MINUTES || minute > DAY_END_MINUTES) return -1;
    return this.minuteTop(minute) + 76;
  }

  currentTimeBodyTop(): number {
    if (this.selectedDate() !== new Date().toISOString().slice(0, 10)) return -1;
    const date = this.now();
    const minute = date.getHours() * 60 + date.getMinutes();
    if (minute < DAY_START_MINUTES || minute > DAY_END_MINUTES) return -1;
    return this.minuteTop(minute);
  }

  currentTimeLabel(): string {
    return this.now().toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });
  }

  minuteTop(minute: number): number {
    return ((minute - DAY_START_MINUTES) / this.activeSlotMinutes()) * this.rowHeight();
  }

  topToMinute(top: number): number {
    return DAY_START_MINUTES + Math.round(top / this.rowHeight()) * this.activeSlotMinutes();
  }

  appointmentCard(appointment: ApiRecord): AppointmentCard {
    const top = this.minuteTop(this.minuteOf(appointment.startAt));
    const minHeight = this.calendarLayout() === 'compact-grid' ? 28 : 36;
    const height = Math.max(minHeight, (this.appointmentDuration(appointment) / this.activeSlotMinutes()) * this.rowHeight() - 4);
    const status = String(appointment.status || 'booked').toLowerCase();
    const clientName = this.clientName(appointment.clientId);
    const serviceLabel = this.serviceNames(appointment.serviceIds);
    const timeLabel = `${this.shortTime(appointment.startAt)} - ${this.shortTime(appointment.endAt || this.isoAtMinute(this.minuteOf(appointment.startAt) + 30))}`;
    return {
      appointment,
      top,
      height,
      leftPct: 1,
      widthPct: 98,
      status,
      clientName,
      serviceLabel,
      timeLabel,
      detailRows: this.appointmentDetailRows(appointment, { clientName, serviceLabel, timeLabel })
    };
  }

  private applyAppointmentCardOverlapLayout(cards: AppointmentCard[]): void {
    cards.sort((a, b) => a.top - b.top || a.height - b.height || String(a.appointment.id || '').localeCompare(String(b.appointment.id || '')));
    let cluster: AppointmentCard[] = [];
    let clusterEnd = -1;
    const flush = () => {
      if (!cluster.length) return;
      this.layoutAppointmentCardCluster(cluster);
      cluster = [];
      clusterEnd = -1;
    };
    for (const card of cards) {
      const cardEnd = card.top + card.height;
      if (cluster.length && card.top >= clusterEnd) flush();
      cluster.push(card);
      clusterEnd = Math.max(clusterEnd, cardEnd);
    }
    flush();
  }

  private layoutAppointmentCardCluster(cluster: AppointmentCard[]): void {
    const columnEnds: number[] = [];
    const assigned = new Map<AppointmentCard, number>();
    for (const card of cluster) {
      let column = columnEnds.findIndex((end) => end <= card.top);
      if (column < 0) {
        column = columnEnds.length;
        columnEnds.push(0);
      }
      assigned.set(card, column);
      columnEnds[column] = card.top + card.height;
    }
    const columns = Math.max(1, columnEnds.length);
    const gapPct = columns > 1 ? 1.5 : 0;
    for (const card of cluster) {
      const column = assigned.get(card) || 0;
      card.leftPct = columns === 1 ? 1 : (column * 100) / columns + gapPct / 2;
      card.widthPct = columns === 1 ? 98 : Math.max(18, 100 / columns - gapPct);
    }
  }

  appointmentDetailRows(appointment: ApiRecord, summary: { clientName: string; serviceLabel: string; timeLabel: string }): AppointmentDetailRow[] {
    const phone = this.clientPhone(String(appointment.clientId || '')) || this.firstText(appointment.clientPhone, appointment.phone, appointment.mobile, appointment.whatsapp);
    const paymentMode = this.appointmentPaymentMode(appointment);
    const paymentStatus = this.firstText(appointment.paymentStatus, appointment.payment_status, appointment.billingStatus, appointment.billStatus);
    const total = this.appointmentTotal(appointment);
    const paid = this.appointmentPaid(appointment);
    const due = this.appointmentDue(appointment);
    const amountSummary = [
      total > 0 ? `Total ${this.money(total)}` : '',
      paid > 0 ? `Paid ${this.money(paid)}` : '',
      due > 0 ? `Due ${this.money(due)}` : ''
    ].filter(Boolean).join(' | ');
    const notes = this.appointmentNoteText(appointment).trim();
    const rows: AppointmentDetailRow[] = [
      { label: 'Time', value: `${summary.timeLabel} (${this.appointmentDuration(appointment)} mins)` },
      { label: 'Client', value: summary.clientName },
      { label: 'Phone', value: phone },
      { label: 'Service', value: summary.serviceLabel },
      { label: 'Staff', value: this.staffName(String(appointment.staffId || '')) },
      { label: 'Status', value: this.label(String(appointment.status || 'booked')) },
      { label: 'Payment', value: [paymentStatus ? this.label(paymentStatus) : '', paymentMode && paymentMode !== 'Not selected' ? paymentMode : ''].filter(Boolean).join(' | ') },
      { label: 'Amount', value: amountSummary },
      { label: 'Booking', value: this.firstText(appointment.bookingNo, appointment.bookingNumber, appointment.appointmentNo, appointment.invoiceNo, appointment.id) },
      { label: 'Notes', value: notes }
    ];
    return rows.filter((row) => row.value.trim());
  }

  shiftBlock(row: ApiRecord): LaneBlock {
    const date = row.scheduleDate || this.selectedDate();
    const start = this.minuteFromTime(row.startTime || '10:00');
    const end = this.minuteFromTime(row.endTime || '18:00');
    return {
      id: row.id,
      staffId: row.staffId,
      top: this.minuteTop(start),
      height: Math.max(this.rowHeight(), ((end - start) / this.activeSlotMinutes()) * this.rowHeight()),
      label: `${row.startTime || ''} TO ${row.endTime || ''}`,
      kind: 'shift',
      reason: `${date} ${row.shiftType || 'regular'}`
    };
  }

  unavailableRosterBlocks(): LaneBlock[] {
    const blocks: LaneBlock[] = [];
    for (const staff of this.visibleStaff()) {
      const shifts = (this.shiftBlocksByStaff().get(staff.id) || [])
        .map((block) => ({
          start: this.topToMinute(block.top),
          end: this.topToMinute(block.top + block.height)
        }))
        .filter((block) => block.end > block.start)
        .sort((a, b) => a.start - b.start);
      if (!shifts.length) continue;
      let cursor = DAY_START_MINUTES;
      shifts.forEach((shift, index) => {
        const start = Math.max(DAY_START_MINUTES, shift.start);
        const end = Math.min(DAY_END_MINUTES, shift.end);
        if (start > cursor) {
          blocks.push(this.unavailableRosterBlock(staff.id, cursor, start));
        }
        cursor = Math.max(cursor, end);
        if (index === shifts.length - 1 && cursor < DAY_END_MINUTES) {
          blocks.push(this.unavailableRosterBlock(staff.id, cursor, DAY_END_MINUTES));
        }
      });
    }
    return blocks;
  }

  unavailableRosterBlock(staffId: string, start: number, end: number): LaneBlock {
    return {
      id: `unavailable-${staffId}-${start}-${end}`,
      staffId,
      top: this.minuteTop(start),
      height: Math.max(this.rowHeight(), ((end - start) / this.activeSlotMinutes()) * this.rowHeight()),
      label: 'Off shift',
      kind: 'unavailable',
      reason: 'Outside staff shift'
    };
  }

  isStaffWorkingAt(staffId: string, minute: number): boolean {
    const shifts = this.shiftBlocksByStaff().get(staffId) || [];
    if (!shifts.length) return true;
    return shifts.some((block) => {
      const start = this.topToMinute(block.top);
      const end = this.topToMinute(block.top + block.height);
      return minute >= start && minute < end;
    });
  }

  showRosterClosed(block: LaneBlock, event: Event): void {
    event.stopPropagation();
    this.showNotice(`${block.reason}: booking is not allowed at this time.`);
  }

  blockedBlock(row: ApiRecord): LaneBlock {
    const start = this.minuteOf(row.startAt);
    const end = this.minuteOf(row.endAt);
    return {
      id: row.id,
      staffId: row.staffId,
      top: this.minuteTop(start),
      height: Math.max(this.rowHeight(), ((end - start) / this.activeSlotMinutes()) * this.rowHeight()),
      label: row.reason || 'Blocked',
      kind: 'blocked',
      reason: row.reason || 'Blocked'
    };
  }

  groupBlocks(blocks: LaneBlock[]): Map<string, LaneBlock[]> {
    const map = new Map<string, LaneBlock[]>();
    for (const block of blocks) {
      if (!map.has(block.staffId)) map.set(block.staffId, []);
      map.get(block.staffId)?.push(block);
    }
    return map;
  }

  serviceNames(value: unknown): string {
    const ids = Array.isArray(value) ? value : this.parseJsonArray(value);
    return ids.map((id) => this.serviceById().get(id)?.name || id).filter(Boolean).join(', ') || 'Service';
  }

  clientPhone(idValue: string): string {
    const client = this.clientById().get(idValue);
    return String(client?.phone || client?.mobile || client?.whatsapp || '');
  }

  clientWalletBalance(idValue: string): number {
    const client = this.clientById().get(idValue);
    return this.numberValue(client?.walletBalance, client?.wallet_balance, client?.ewalletBalance, client?.wallet, 0);
  }

  appointmentPaymentMode(appointment: ApiRecord): string {
    return String(appointment.paymentMode || appointment.payment_mode || appointment.paymentType || appointment.mode || 'Not selected');
  }

  appointmentBillLines(appointment: ApiRecord): AppointmentBillLine[] {
    const rows = this.appointmentEditRows(appointment);
    return rows.flatMap((row, rowIndex) => {
      const serviceIds = this.appointmentServiceIds(row);
      const fallbackName = this.serviceNames(serviceIds);
      const discountTotal = this.rawAppointmentDiscount(row);
      const subtotal = Math.max(1, serviceIds.reduce((sum, id) => sum + this.serviceBasePrice(id, row), 0));
      const ids = serviceIds.length ? serviceIds : [''];

      return ids.map((id, index) => {
        const service = this.serviceById().get(id);
        const price = this.serviceBasePrice(id, row);
        const discount = Math.max(0, Math.min(price, index === ids.length - 1
          ? discountTotal - ids.slice(0, -1).reduce((sum, previousId) => sum + Math.round((this.serviceBasePrice(previousId, row) / subtotal) * discountTotal), 0)
          : Math.round((price / subtotal) * discountTotal)));
        const taxable = Math.max(0, price - discount);
        const gstRate = this.numberValue(service?.gstRate, service?.gst, service?.taxRate, row.gstRate, row.gst, 0);
        const gstAmount = Math.round(taxable * gstRate / 100);
        return {
          id: `${row.id || appointment.id || 'appointment'}-${id || index}-${rowIndex}`,
          name: service?.name || fallbackName || 'Service',
          startAt: String(row.startAt || appointment.startAt || ''),
          staffName: this.staffName(row.staffId || service?.staffId || ''),
          quantity: 1,
          price,
          discount,
          taxable,
          gstRate,
          gstAmount,
          total: taxable + gstAmount
        };
      });
    });
  }

  appointmentSubtotal(appointment: ApiRecord): number {
    return this.appointmentBillLines(appointment).reduce((sum, line) => sum + line.price, 0);
  }

  appointmentDiscount(appointment: ApiRecord): number {
    const rows = this.appointmentEditRows(appointment);
    if (rows.length > 1) return rows.reduce((sum, row) => sum + this.rawAppointmentDiscount(row), 0);
    return this.rawAppointmentDiscount(appointment);
  }

  appointmentTaxable(appointment: ApiRecord): number {
    return this.appointmentBillLines(appointment).reduce((sum, line) => sum + line.taxable, 0);
  }

  appointmentGst(appointment: ApiRecord): number {
    return this.appointmentBillLines(appointment).reduce((sum, line) => sum + line.gstAmount, 0);
  }

  appointmentTotal(appointment: ApiRecord): number {
    const rows = this.appointmentEditRows(appointment);
    if (rows.length > 1) return this.appointmentBillLines(appointment).reduce((sum, line) => sum + line.total, 0);
    const explicitTotal = this.numberValue(appointment.total, appointment.totalAmount, appointment.amount, 0);
    return explicitTotal || this.appointmentBillLines(appointment).reduce((sum, line) => sum + line.total, 0);
  }

  appointmentPaid(appointment: ApiRecord): number {
    const rows = this.appointmentEditRows(appointment);
    if (rows.length > 1) return rows.reduce((sum, row) => sum + this.rawAppointmentPaid(row), 0);
    return this.rawAppointmentPaid(appointment);
  }

  private rawAppointmentDiscount(appointment: ApiRecord): number {
    return Math.max(0, this.numberValue(appointment.discountAmount, appointment.discount_amount, appointment.discount, appointment.manualDiscount, 0));
  }

  private rawAppointmentPaid(appointment: ApiRecord): number {
    return this.numberValue(appointment.paid, appointment.paidAmount, appointment.paid_amount, appointment.collectedAmount, 0);
  }

  appointmentDue(appointment: ApiRecord): number {
    return Math.max(0, this.appointmentTotal(appointment) - this.appointmentPaid(appointment));
  }

  appointmentActivityLines(appointment: ApiRecord): AppointmentActivityLine[] {
    const raw = Array.isArray(appointment.activityLog) ? appointment.activityLog : Array.isArray(appointment.history) ? appointment.history : [];
    const mapped = raw.map((event: ApiRecord, index: number) => ({
      id: String(event.id || `${appointment.id}-activity-${index}`),
      title: String(event.title || event.action || 'Activity'),
      time: String(event.time || event.createdAt || event.created_at || appointment.updatedAt || appointment.startAt || new Date().toISOString()),
      body: String(event.body || event.notes || event.description || `Status ${this.label(appointment.status || 'booked')}`)
    }));
    if (mapped.length) return mapped;
    return [
      {
        id: `${appointment.id}-created`,
        title: 'Booking created',
        time: String(appointment.createdAt || appointment.startAt || new Date().toISOString()),
        body: `${this.clientName(appointment.clientId)} booked ${this.serviceNames(this.appointmentServiceIds(appointment))}.`
      },
      {
        id: `${appointment.id}-status`,
        title: 'Current status',
        time: String(appointment.updatedAt || appointment.startAt || new Date().toISOString()),
        body: `Appointment is ${this.label(appointment.status || 'booked')}.`
      }
    ];
  }

  clientName(idValue: string): string {
    return this.clientById().get(idValue)?.name || idValue || 'Client';
  }

  staffName(idValue: string): string {
    return this.staffById().get(idValue)?.name || idValue || 'Staff';
  }

  bookingClientOption(client: ApiRecord): string {
    return String(client.name || client.phone || client.mobile || client.email || client.id || 'Client');
  }

  bookingServiceOption(service: ApiRecord): string {
    const duration = service ? ` · ${this.serviceBlockDuration(service)}m` : '';
    return String(`${service.name || service.id || 'Service'}${duration}`);
  }

  private serviceBlockDuration(service: ApiRecord | undefined, fallback = 30): number {
    return service ? serviceTotalMinutes(service) : Math.max(15, Number(fallback || 30));
  }

  private nextServiceStartAfter(previous: BookingLineDraft, next?: Pick<BookingLineDraft, 'serviceId' | 'staffId'>): string {
    return this.addLocalMinutes(previous.startAt, this.serviceHandoffMinutes(previous, next));
  }

  private nextServiceStartTime(next?: Pick<BookingLineDraft, 'serviceId' | 'staffId'>): string {
    const last = this.bookingLines().at(-1);
    return last ? this.nextServiceStartAfter(last, next) : this.localDateTime(10 * 60);
  }

  private resequenceBookingLines(lines: BookingLineDraft[], fromIndex = 1): BookingLineDraft[] {
    const nextLines = [...lines];
    for (let index = Math.max(1, fromIndex); index < nextLines.length; index += 1) {
      const previous = nextLines[index - 1];
      const current = nextLines[index];
      nextLines[index] = { ...current, startAt: this.nextServiceStartAfter(previous, current) };
    }
    return nextLines;
  }

  private serviceHandoffMinutes(previous: BookingLineDraft, next?: Pick<BookingLineDraft, 'serviceId' | 'staffId'>): number {
    const previousService = this.serviceById().get(previous.serviceId);
    const fullDuration = Math.max(15, Number(previous.durationMinutes || this.serviceBlockDuration(previousService, 30)));
    if (!previousService || !this.isProcessingService(previousService)) return fullDuration;

    const previousStaffId = String(previous.staffId || '').trim();
    const nextStaffId = String(next?.staffId || '').trim();
    const nextService = next?.serviceId ? this.serviceById().get(String(next.serviceId)) : undefined;
    const differentStaff = !!previousStaffId && !!nextStaffId && previousStaffId !== nextStaffId;
    const nextNeedsHairSequence = nextService ? this.isHairService(nextService) : false;
    if (!differentStaff || nextNeedsHairSequence) return fullDuration;

    return Math.min(fullDuration, this.processingHandoffMinutes(previousService));
  }

  private processingHandoffMinutes(service: ApiRecord): number {
    const explicit = this.numberValue(service.applicationMinutes, service.applicationTimeMin, service.staffTimeMin, service.handoffMinutes);
    if (explicit > 0) return Math.max(5, Math.min(60, explicit));
    return PROCESSING_HANDOFF_MINUTES;
  }

  private isProcessingService(service: ApiRecord): boolean {
    if (this.numberValue(service.processingTimeMin, service.processingMinutes, service.processTimeMin) > 0) return true;
    return /\b(root touch ?up|root|touch ?up|touchup|color|colour|tint|bleach|highlight|global|balayage|toner|smooth|keratin|botox|perm|rebond|chemical)\b/.test(this.serviceSearchText(service));
  }

  private isHairService(service: ApiRecord): boolean {
    return /\b(hair|root|touch ?up|touchup|color|colour|tint|bleach|highlight|global|balayage|toner|smooth|keratin|botox|perm|rebond|chemical|wash|cut|blow|scalp)\b/.test(this.serviceSearchText(service));
  }

  private serviceSearchText(service: ApiRecord): string {
    return [
      service.name,
      service.serviceName,
      service.title,
      service.category,
      service.subCategory,
      service.serviceCode,
      service.description
    ].map((value) => String(value || '').toLowerCase()).join(' ').replace(/[^a-z0-9]+/g, ' ').trim();
  }

  bookingStaffOption(person: StaffLane): string {
    return String(person.name || person.phone || person.id || 'Staff');
  }

  actionTypeLabel(type: string): string {
    const labels: Record<string, string> = {
      conflict_detection: 'Conflict detection',
      chair_conflict: 'Chair conflict',
      deposit_follow_up: 'Deposit follow-up',
      no_show_recovery: 'No-show recovery',
      waitlist_match: 'Waitlist match',
      staff_service_matching: 'Staff/service matching',
      capacity_optimization: 'Capacity optimization',
      calendar_sync: 'Calendar sync'
    };
    return labels[type] || this.label(type || 'action');
  }

  firstText(...values: unknown[]): string {
    for (const value of values) {
      const text = String(value || '').trim();
      if (text) return text;
    }
    return '';
  }

  label(value: string): string {
    return String(value || '').replace(/[-_]/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase());
  }

  statusTone(status: string): string {
    const raw = String(status || '').trim().toLowerCase();
    const dashed = raw.replace(/_/g, '-');
    return STATUS_TONES[raw] || STATUS_TONES[dashed] || 'blue';
  }

  statusClass(status: string): string {
    return `appointment-card ${this.statusTone(status)}`;
  }

  money(value: number): string {
    return `₹${Number(value || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
  }

  initials(value: unknown): string {
    return String(value || '').split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase() || 'ST';
  }

  trackDate(_: number, day: CalendarDay): string { return day.date; }
  trackStaff(_: number, staff: StaffLane): string { return staff.id; }
  trackSlot(_: number, slot: TimeSlot): number { return slot.minute; }
  trackValue(_: number, value: string): string { return value; }
  trackCalendarLayoutOption(_: number, option: CalendarLayoutOption): string { return option.value; }
  trackTimelineRow(_: number, row: TimelineRow): string { return row.staff.id; }
  trackApiRecord(_: number, record: ApiRecord): string { return record.id; }
  trackLine(_: number, line: BookingLineDraft): string { return line.id; }
  trackBlock(_: number, block: LaneBlock): string { return block.id; }
  trackCard(_: number, card: AppointmentCard): string { return card.appointment.id; }
  trackAppointmentDetailRow(_: number, row: AppointmentDetailRow): string { return row.label; }
  trackSmartSlot(_: number, slot: { staff: StaffLane; slot: TimeSlot }): string { return `${slot.staff.id}-${slot.slot.minute}`; }
  trackBillLine(_: number, line: AppointmentBillLine): string { return line.id; }
  trackActivityLine(_: number, line: AppointmentActivityLine): string { return line.id; }
  trackClientServiceHistory(_: number, line: ClientServiceHistoryRow): string { return line.id; }
  trackActionOption(_: number, action: AppointmentActionOption): string { return action.value; }

  timelineLeftForMinute(minute: number): number {
    const span = DAY_END_MINUTES - DAY_START_MINUTES;
    return Math.max(0, Math.min(100, ((minute - DAY_START_MINUTES) / span) * 100));
  }

  timelineLeft(card: AppointmentCard): number {
    return this.timelineLeftForMinute(this.minuteOf(card.appointment.startAt));
  }

  timelineWidth(card: AppointmentCard): number {
    const left = this.timelineLeft(card);
    const span = DAY_END_MINUTES - DAY_START_MINUTES;
    const width = (this.appointmentDuration(card.appointment) / span) * 100;
    return Math.max(4, Math.min(100 - left, width));
  }

  formatShortDate(value: string): string {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '-';
    return date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  }

  private blankLine(staffId: string, startAt: string): BookingLineDraft {
    return { id: `line_${Math.random().toString(16).slice(2)}`, serviceId: '', staffId, startAt, durationMinutes: 30, chair: '', room: '' };
  }

  private mergeAppointmentsIntoContext(appointments: ApiRecord[]): void {
    if (!appointments.length) return;
    const current = this.context();
    if (!current) return;
    const rows = [...(current.appointments || [])];
    for (const appointment of appointments) {
      const id = String(appointment?.id || '');
      if (!id) continue;
      const index = rows.findIndex((row) => String(row?.id || '') === id);
      if (index >= 0) {
        rows[index] = { ...rows[index], ...appointment };
      } else {
        rows.push(appointment);
      }
    }
    this.context.set({
      ...current,
      appointments: rows,
      appointmentTotal: Math.max(Number(current.appointmentTotal || 0), rows.length)
    });
  }

  private normalizedAppointmentStatus(value: unknown): string {
    return String(value || '').trim().toLowerCase().replace(/_/g, '-');
  }

  private isPendingAppointment(appointment: ApiRecord): boolean {
    const status = this.normalizedAppointmentStatus(appointment.status || 'booked');
    return !['completed', 'billed', 'paid', 'cancelled', 'canceled', 'no-show', 'deleted'].includes(status);
  }

  private shouldShowOnAppointmentCalendar(appointment: ApiRecord): boolean {
    const status = this.normalizedAppointmentStatus(appointment.status || 'booked');
    return !['cancelled', 'canceled', 'deleted'].includes(status);
  }

  private appointmentKey(appointment: ApiRecord): string {
    return String(appointment?.id || '');
  }

  private appointmentNoteText(appointment: ApiRecord): string {
    return String(appointment?.notes || appointment?.note || '');
  }

  private clientProfileNoteText(client: ApiRecord | undefined): string {
    return String(client?.notes || client?.note || '').trim();
  }

  private clientFrontDeskNote(client: ApiRecord | undefined): string {
    const notes = this.clientProfileNoteText(client);
    return this.sectionFromClientNotes(notes, 'Front desk notes') || notes;
  }

  private applyClientProfileNoteToBooking(client: ApiRecord): void {
    if (this.editingAppointmentId()) return;
    const current = String(this.bookingForm.value.notes || '').trim();
    if (current) return;
    const note = this.clientFrontDeskNote(client).trim();
    if (note) this.bookingForm.patchValue({ notes: note }, { emitEvent: false });
  }

  private setAppointmentNoteDraftValue(appointment: ApiRecord, value: string): void {
    const id = this.appointmentKey(appointment);
    if (!id) return;
    this.appointmentNoteDrafts.update((drafts) => ({ ...drafts, [id]: value }));
  }

  private applyAppointmentPatch(id: string, patch: ApiRecord): void {
    const current = this.context();
    if (current) {
      this.context.set({
        ...current,
        appointments: current.appointments.map((row) => String(row.id || '') === id ? { ...row, ...patch } : row)
      });
    }
    const selected = this.selectedAppointment();
    if (selected && String(selected.id || '') === id) {
      this.selectedAppointment.set({ ...selected, ...patch });
    }
  }

  private async syncAppointmentNoteToClientProfile(appointment: ApiRecord, notes: string): Promise<void> {
    const clientId = String(appointment.clientId || '').trim();
    const client = this.clientById().get(clientId);
    const nextNote = String(notes || '').trim();
    if (!clientId || !client || !nextNote) return;
    const nextNotes = this.mergeClientFrontDeskNotes(this.clientProfileNoteText(client), nextNote);
    if (nextNotes === this.clientProfileNoteText(client)) return;
    const updated = await firstValueFrom(this.api.update<ApiRecord>('clients', clientId, { notes: nextNotes }));
    this.applyClientPatch(clientId, { ...updated, notes: nextNotes });
  }

  private applyClientPatch(id: string, patch: ApiRecord): void {
    const current = this.context();
    if (!current) return;
    this.context.set({
      ...current,
      clients: current.clients.map((client) => String(client.id || '') === id ? { ...client, ...patch } : client)
    });
  }

  private mergeClientFrontDeskNotes(existingNotes: string, frontDeskNote: string): string {
    const existing = String(existingNotes || '').trim();
    const frontDesk = String(frontDeskNote || '').trim();
    const hasSections = /(^|\n)(Front desk notes|Internal notes|Follow-up notes):/i.test(existing);
    const internal = this.sectionFromClientNotes(existing, 'Internal notes') || (!hasSections && existing && existing !== frontDesk ? existing : '');
    const followUp = this.sectionFromClientNotes(existing, 'Follow-up notes');
    return [
      ['Front desk notes', frontDesk],
      ['Internal notes', internal],
      ['Follow-up notes', followUp]
    ]
      .filter(([, value]) => String(value || '').trim())
      .map(([label, value]) => `${label}:\n${String(value).trim()}`)
      .join('\n\n');
  }

  private sectionFromClientNotes(notes: string, label: string): string {
    const pattern = new RegExp(`${label}:\\s*([\\s\\S]*?)(?=\\n\\n(?:Front desk notes|Internal notes|Follow-up notes):|$)`, 'i');
    return String(notes || '').match(pattern)?.[1]?.trim() || '';
  }

  private dateInput(date: Date): string {
    const month = `${date.getMonth() + 1}`.padStart(2, '0');
    const day = `${date.getDate()}`.padStart(2, '0');
    return `${date.getFullYear()}-${month}-${day}`;
  }

  private nextDate(date: string): string {
    const next = new Date(`${date}T00:00:00`);
    next.setDate(next.getDate() + 1);
    return this.dateInput(next);
  }

  private hhmm(minute: number): string {
    return `${Math.floor(minute / 60)}`.padStart(2, '0') + ':' + `${minute % 60}`.padStart(2, '0');
  }

  private timeLabel(minute: number): string {
    const date = new Date(`${this.selectedDate()}T${this.hhmm(minute)}:00`);
    return date.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });
  }

  private localDateTime(minute: number): string {
    return `${this.selectedDate()}T${this.hhmm(minute)}`;
  }

  private addLocalMinutes(value: string, minutes: number): string {
    const date = new Date(value);
    date.setMinutes(date.getMinutes() + minutes);
    return `${this.dateInput(date)}T${this.hhmm(date.getHours() * 60 + date.getMinutes())}`;
  }

  private localInputFromIso(value: string): string {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return this.localDateTime(10 * 60);
    return `${this.dateInput(date)}T${this.hhmm(date.getHours() * 60 + date.getMinutes())}`;
  }

  private isoFromLocal(value: string): string {
    return new Date(value).toISOString();
  }

  private isoAtMinute(minute: number): string {
    return this.isoFromLocal(this.localDateTime(minute));
  }

  private clearClientServiceHistory(): void {
    this.clientServiceHistory.set([]);
    this.clientServiceHistoryError.set('');
    this.clientServiceHistoryLoading.set(false);
  }

  private buildClientServiceHistory(clientId: string, invoices: ApiRecord[], sales: ApiRecord[]): ClientServiceHistoryRow[] {
    const salesById = new Map(sales.map((sale) => [String(sale.id || ''), sale]));
    const rows: ClientServiceHistoryRow[] = [];
    for (const invoice of invoices) {
      const invoiceClientId = String(invoice.clientId || invoice.client_id || invoice.customerId || invoice.customer_id || '');
      const sale = salesById.get(String(invoice.saleId || invoice.sale_id || '')) || {};
      const saleClientId = String(sale.clientId || sale.client_id || sale.customerId || sale.customer_id || '');
      if (invoiceClientId && invoiceClientId !== clientId) continue;
      if (!invoiceClientId && saleClientId && saleClientId !== clientId) continue;
      rows.push(...this.historyRowsFromSource(clientId, invoice, sale));
    }
    for (const sale of sales) {
      const saleClientId = String(sale.clientId || sale.client_id || sale.customerId || sale.customer_id || '');
      if (saleClientId !== clientId) continue;
      if (invoices.some((invoice) => String(invoice.saleId || invoice.sale_id || '') === String(sale.id || ''))) continue;
      rows.push(...this.historyRowsFromSource(clientId, sale, sale));
    }
    const seen = new Set<string>();
    return rows
      .filter((row) => {
        const key = `${row.date}|${row.serviceId || row.serviceName}|${row.price}|${row.invoiceNumber}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
      .slice(0, 12);
  }

  private historyRowsFromSource(clientId: string, invoice: ApiRecord, sale: ApiRecord): ClientServiceHistoryRow[] {
    const date = String(invoice.invoiceDate || invoice.invoice_date || invoice.createdAt || invoice.created_at || sale.createdAt || sale.created_at || new Date().toISOString());
    const invoiceNumber = String(invoice.invoiceNumber || invoice.invoice_no || invoice.id || sale.id || '');
    return this.lineItemsFrom(invoice, sale)
      .filter((item) => this.isServiceLine(item))
      .map((item, index) => this.historyRowFromItem(clientId, item, date, invoiceNumber, index));
  }

  private historyRowFromItem(clientId: string, item: ApiRecord, date: string, invoiceNumber: string, index: number): ClientServiceHistoryRow {
    const serviceId = String(item.serviceId || item.service_id || item.id || item.itemId || item.item_id || '');
    const service = this.serviceById().get(serviceId) || this.findServiceByName(String(item.name || item.serviceName || item.title || ''));
    const matchedServiceId = String(service?.id || serviceId || '');
    const staffId = String(item.staffId || item.staff_id || '');
    return {
      id: `${clientId}-${invoiceNumber}-${matchedServiceId || index}-${index}`,
      date,
      serviceId: matchedServiceId,
      serviceName: String(item.serviceName || item.name || item.title || service?.name || serviceId || 'Service'),
      staffId,
      staffName: String(item.staffName || item.staff_name || this.staffById().get(staffId)?.name || ''),
      price: this.numberValue(item.finalAmount, item.total, item.lineTotal, item.price, item.rate, item.amount, service?.price, 0),
      durationMinutes: this.numberValue(item.durationMinutes, item.duration, service?.durationMinutes, 30),
      invoiceNumber
    };
  }

  private lineItemsFrom(invoice: ApiRecord, sale: ApiRecord): ApiRecord[] {
    const candidates = [
      invoice.lineItems,
      invoice.line_items,
      invoice.items,
      invoice.invoiceItems,
      sale.items,
      sale.lineItems,
      sale.line_items
    ];
    for (const value of candidates) {
      const rows = this.parseRecordArray(value);
      if (rows.length) return rows;
    }
    return [];
  }

  private parseRecordArray(value: unknown): ApiRecord[] {
    if (Array.isArray(value)) return value.filter((row): row is ApiRecord => !!row && typeof row === 'object');
    if (typeof value !== 'string' || !value.trim()) return [];
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed.filter((row): row is ApiRecord => !!row && typeof row === 'object') : [];
    } catch {
      return [];
    }
  }

  private isServiceLine(item: ApiRecord): boolean {
    const type = String(item.type || item.itemType || item.item_type || item.category || '').toLowerCase();
    if (type.includes('service')) return true;
    const id = String(item.serviceId || item.service_id || item.id || item.itemId || item.item_id || '');
    if (id && this.serviceById().has(id)) return true;
    return !!this.findServiceByName(String(item.name || item.serviceName || item.title || ''));
  }

  private findServiceForHistory(item: ClientServiceHistoryRow): ApiRecord | undefined {
    return this.serviceById().get(item.serviceId) || this.findServiceByName(item.serviceName);
  }

  private findServiceByName(name: string): ApiRecord | undefined {
    const normalized = this.normalizeSearch(name);
    if (!normalized) return undefined;
    return this.services().find((service) => this.normalizeSearch(service.name || service.title || service.id) === normalized);
  }

  private waitlistWindowIso(date: string, time: string): string {
    if (!date || !time) return '';
    return this.isoFromLocal(`${date}T${time}`);
  }

  private minuteOf(value: string): number {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return DAY_START_MINUTES;
    return date.getHours() * 60 + date.getMinutes();
  }

  private minuteFromTime(value: string): number {
    const [hour, minute] = String(value || '').split(':').map(Number);
    if (!Number.isFinite(hour) || !Number.isFinite(minute)) return DAY_START_MINUTES;
    return hour * 60 + minute;
  }

  private snapMinute(minute: number): number {
    const slotMinutes = this.activeSlotMinutes();
    const snapped = Math.round(minute / slotMinutes) * slotMinutes;
    return Math.min(DAY_END_MINUTES - slotMinutes, Math.max(DAY_START_MINUTES, snapped));
  }

  private appointmentDuration(appointment: ApiRecord): number {
    const start = new Date(appointment.startAt).getTime();
    const end = new Date(appointment.endAt || '').getTime();
    return Number.isFinite(start) && Number.isFinite(end) && end > start ? Math.round((end - start) / 60000) : 30;
  }

  private shortTime(value: string): string {
    return new Date(value).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });
  }

  private numberValue(...values: unknown[]): number {
    for (const value of values) {
      if (value === null || value === undefined || value === '') continue;
      const next = Number(String(value).replace(/[₹,\s]/g, ''));
      if (Number.isFinite(next)) return next;
    }
    return 0;
  }

  private appointmentServiceIds(appointment: ApiRecord): string[] {
    return this.idList(
      appointment.serviceIds ??
      appointment.service_ids ??
      appointment.serviceId ??
      appointment.service_id ??
      ''
    );
  }

  private serviceBasePrice(serviceId: string, appointment: ApiRecord): number {
    const service = this.serviceById().get(serviceId);
    const servicePrice = this.numberValue(service?.price, service?.sellingPrice, service?.rate, service?.amount, service?.defaultPrice, 0);
    if (servicePrice) return servicePrice;
    const serviceCount = Math.max(1, this.appointmentServiceIds(appointment).length);
    const appointmentPrice = this.numberValue(appointment.rate, appointment.price, appointment.subtotal, appointment.subTotal, appointment.totalAmount, appointment.total, appointment.amount, 0);
    return serviceCount > 1 ? Math.round(appointmentPrice / serviceCount) : appointmentPrice;
  }

  private parseJsonArray(value: unknown): string[] {
    if (Array.isArray(value)) return value.map(String);
    if (typeof value !== 'string' || !value.trim()) return [];
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed.map(String) : [];
    } catch {
      return value.split(',').map((item) => item.trim()).filter(Boolean);
    }
  }

  private idList(value: unknown): string[] {
    return this.parseJsonArray(value).filter(Boolean);
  }

  private goToPos(appointment: ApiRecord, sourceRows: ApiRecord[] = []): void {
    const groupRows = this.appointmentGroupRows(appointment, sourceRows);
    const serviceIds = this.groupAppointmentServiceIds(appointment, groupRows);
    const appointmentIds = groupRows.map((row) => String(row.id || '')).filter(Boolean);
    const bookingGroupId = this.bookingGroupIdOf(appointment) || groupRows.map((row) => this.bookingGroupIdOf(row)).find(Boolean) || '';
    this.router.navigate(['/pos'], {
      queryParams: {
        appointmentId: appointment.id || undefined,
        appointmentIds: appointmentIds.length > 1 ? appointmentIds.join(',') : undefined,
        bookingGroupId: bookingGroupId || undefined,
        serviceIds: serviceIds.length ? serviceIds.join(',') : undefined,
        clientId: appointment.clientId || undefined,
        q: this.clientById().get(appointment.clientId)?.phone || this.clientName(appointment.clientId) || undefined
      }
    });
  }

  private bookingGroupIdOf(appointment: ApiRecord): string {
    return String(appointment.bookingGroupId || appointment.booking_group_id || '').trim();
  }

  private appointmentBookingCountKey(appointment: ApiRecord): string {
    const bookingGroupId = this.bookingGroupIdOf(appointment);
    if (bookingGroupId) return `group:${bookingGroupId}`;
    return `appointment:${String(appointment.id || '')}`;
  }

  private appointmentGroupRows(appointment: ApiRecord, sourceRows: ApiRecord[] = []): ApiRecord[] {
    const bookingGroupId = this.bookingGroupIdOf(appointment);
    const rows = sourceRows.length ? sourceRows : this.context()?.appointments || [];
    if (!bookingGroupId) {
      const clientId = String(appointment.clientId || '').trim();
      const appointmentDate = this.dateInput(new Date(String(appointment.startAt || appointment.date || new Date().toISOString())));
      const grouped = rows.filter((row) => {
        const rowClientId = String(row.clientId || '').trim();
        const rowDate = this.dateInput(new Date(String(row.startAt || row.date || new Date().toISOString())));
        return clientId && rowClientId === clientId && rowDate === appointmentDate;
      });
      if (!grouped.some((row) => String(row.id || '') === String(appointment.id || ''))) grouped.unshift(appointment);
      return grouped.length ? grouped : [appointment];
    }
    const grouped = rows.filter((row) => this.bookingGroupIdOf(row) === bookingGroupId);
    if (!grouped.some((row) => String(row.id || '') === String(appointment.id || ''))) grouped.unshift(appointment);
    return grouped.length ? grouped : [appointment];
  }

  private groupAppointmentServiceIds(appointment: ApiRecord, sourceRows: ApiRecord[] = []): string[] {
    const ids: string[] = [];
    for (const row of this.appointmentGroupRows(appointment, sourceRows)) {
      for (const serviceId of this.appointmentServiceIds(row)) {
        ids.push(serviceId);
      }
    }
    return ids;
  }

  private async ensureAppointmentPosAllowed(appointment: ApiRecord): Promise<boolean> {
    const latest = await this.refreshAppointmentBillingStatus(appointment);
    if (this.appointmentBillingLocked(latest)) {
      this.showNotice(`Appointment ${appointment.id || ''} is already billed. POS is locked.`);
      return false;
    }
    return true;
  }

  private async refreshAppointmentBillingStatus(appointment: ApiRecord): Promise<ApiRecord> {
    const appointmentId = String(appointment.id || '');
    if (!appointmentId) return appointment;
    this.billingStatusChecking.set(true);
    try {
      const status = await firstValueFrom(this.api.list<ApiRecord>(`enterprise-scheduler/appointments/${appointmentId}/billing-status`));
      const next = {
        ...appointment,
        billingLocked: !!status?.billed,
        billedInvoiceId: status?.invoiceId || '',
        billedInvoiceNumber: status?.invoiceNumber || ''
      };
      this.selectedAppointment.update((current) => current && String(current.id || '') === appointmentId ? next : current);
      return next;
    } catch {
      return appointment;
    } finally {
      this.billingStatusChecking.set(false);
    }
  }
}
