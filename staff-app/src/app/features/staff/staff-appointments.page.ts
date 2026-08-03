import { DatePipe } from "@angular/common";
import { Component, computed, HostListener, OnDestroy, OnInit, signal } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { RouterLink } from "@angular/router";
import { StaffAppService, StaffAppointment, StaffAppointmentBook, StaffAppointmentOperations, StaffAppointmentQuote, StaffBusiness, StaffDashboard, StaffGuest360, StaffGuestFormDefinition, StaffGuestFormField, StaffGuestFormSubmission, StaffPosCheckout, StaffRecommendation, StaffServiceRecipeLine, StaffServiceWorkspace } from "../../core/staff-app.service";
import { businessDate, businessDateOffset, displayBusinessDate, parseDisplayBusinessDate } from "../../core/business-date";
import { PaiseInrPipe } from "../../core/paise-inr.pipe";
import { StaffDatePickerComponent } from "../../shared/staff-date-picker.component";
import { StaffPageStateComponent } from "./staff-page-state.component";

type AppointmentView = "today" | "upcoming" | "live" | "completed" | "cancelled" | "shifted" | "all";
type CalendarView = "own" | "staff" | "resource";
type BookingLineDraft = {
  appointmentId: string; version: number; clientId: string; serviceId: string; staffId: string; preference: string;
  resourceId: string; date: string; time: string; duration: number; variantId: string; addonIds: string[];
  priceOverride: string; priceReason: string; serviceMode: string; segmentLabel: string;
};

const LIVE_STATUSES = new Set(["booked", "confirmed", "checked-in", "arrived", "in-service", "started", "paused"]);
const COMPLETED_STATUSES = new Set(["completed", "checked-out", "paid", "closed", "billed"]);
const CANCELLED_STATUSES = new Set(["cancelled", "canceled", "no-show", "void", "voided"]);
const TERMINAL_STATUSES = new Set([...COMPLETED_STATUSES, ...CANCELLED_STATUSES]);
const IST_DATE_FORMATTER = new Intl.DateTimeFormat("en", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" });
const IST_DATE_TIME_FORMATTER = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

function istDateKey(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const parts = Object.fromEntries(IST_DATE_FORMATTER.formatToParts(date).map((part) => [part.type, part.value]));
  return [parts["year"], parts["month"], parts["day"]].join("-");
}

function istDateTimeInput(value: string): { date: string; time: string } {
  const parts = Object.fromEntries(IST_DATE_TIME_FORMATTER.formatToParts(new Date(value)).map((part) => [part.type, part.value]));
  return { date: [parts["year"], parts["month"], parts["day"]].join("-"), time: `${parts["hour"]}:${parts["minute"]}` };
}

function matchesSecureMethod(value: string): boolean {
  return ["card", "upi"].includes(value.trim().toLowerCase());
}

@Component({
  standalone: true,
  imports: [PaiseInrPipe, DatePipe, FormsModule, RouterLink, StaffDatePickerComponent, StaffPageStateComponent],
  template: `
    <section class="page">
      <header class="page-head"><div><p class="eyebrow">Appointments</p><h1>Appointments</h1><p>Assigned bookings with service actions.</p></div>@if (book()?.permissions?.manage) { <button class="button primary" type="button" (click)="openCreateBooking()">Book appointment</button> }</header>
      @if (loading() && !dashboard()) {
        <section class="appointment-skeleton" aria-label="Loading appointments">
          <div class="skeleton-grid">
            <span class="skeleton"></span><span class="skeleton"></span><span class="skeleton"></span><span class="skeleton"></span>
          </div>
          <span class="skeleton appointment-list-skeleton"></span>
        </section>
      }
      @if (loadError()) {
        <section staffPageState class="notice appointment-error">
          <span>{{ loadError() }}</span>
          <button class="link-button" type="button" [disabled]="loading()" (click)="load()">Retry</button>
        </section>
      }
      @if (actionMessage()) { <section staffPageState class="notice success" role="status">{{ actionMessage() }}</section> }

      @if (dashboard()) {
        <section class="panel appointment-book" aria-label="Provider Appointment Book">
          <div class="panel-title"><h2>Appointment Book</h2><div class="row-actions"><button class="link-button" type="button" (click)="moveCalendar(-calendarSpan())">Previous</button><button class="link-button" type="button" (click)="calendarDate.set(minimumActionDate); loadBook()">Today</button><button class="link-button" type="button" (click)="moveCalendar(calendarSpan())">Next</button>@if (book()?.permissions?.manage) { <button class="link-button" type="button" (click)="blockoutOpen.set(!blockoutOpen())">Block time</button> }</div></div>
          <div class="book-toolbar">
            <div class="view-switch" aria-label="Calendar view">
              <button class="link-button" [class.active-toggle]="calendarView() === 'own'" type="button" (click)="setCalendarView('own')">My Calendar</button>
              @if (book()?.permissions?.teamRead) { <button class="link-button" [class.active-toggle]="calendarView() === 'staff'" type="button" (click)="setCalendarView('staff')">Staff</button><button class="link-button" [class.active-toggle]="calendarView() === 'resource'" type="button" (click)="setCalendarView('resource')">Room / equipment</button> }
            </div>
            <label>Date<aura-staff-date-picker [value]="displayBusinessDate(calendarDate())" ariaLabel="Appointment Book date" (valueChange)="setCalendarDate($event)" /></label>
            @if (calendarView() === 'own') { <label>Range<select [ngModel]="calendarSpan()" (ngModelChange)="setCalendarSpan(+$event)"><option [ngValue]="1">1 day</option><option [ngValue]="3">3 days</option><option [ngValue]="7">7 days</option></select></label> }
            @if (calendarView() === 'staff') { <label>Provider<select [ngModel]="calendarStaffId()" (ngModelChange)="calendarStaffId.set($event); loadBook()"><option value="">All staff</option>@for (provider of book()?.staff || []; track provider.id) { <option [value]="provider.id">{{ provider.name }}</option> }</select></label> }
            @if (calendarView() === 'resource') { <label>Resource<select [ngModel]="calendarResourceId()" (ngModelChange)="calendarResourceId.set($event)"><option value="">All rooms / equipment</option>@for (resource of book()?.resources || []; track resource.id) { <option [value]="resource.id">{{ resource.name }} · {{ resource.kind }}</option> }</select></label> }
            <label>Status<select [ngModel]="calendarStatus()" (ngModelChange)="calendarStatus.set($event); loadBook()"><option value="">All statuses</option><option value="booked">Booked</option><option value="confirmed">Confirmed</option><option value="arrived">Checked in</option><option value="in-service">In service</option><option value="completed">Completed</option><option value="cancelled">Cancelled</option><option value="no-show">No-show</option></select></label>
          </div>
          @if (bookError()) { <p class="action-error">{{ bookError() }}</p> }
          <div class="calendar-columns" [style.--calendar-days]="calendarDays().length">
            @for (day of calendarDays(); track day) {
              <section class="calendar-day"><header><strong>{{ day | date:'EEE, dd/MM/yyyy':'UTC' }}</strong><small>{{ scheduleLabel(day) }}</small></header>
                @for (blockout of blockoutsForDay(day); track blockout['id']) { <div class="calendar-blockout"><strong>Blocked</strong><span>{{ blockoutLabel(blockout) }}</span></div> }
                @for (item of appointmentsForDay(day); track item.id) {
                  <button class="calendar-item" type="button" (click)="openAppointment(item)"><strong>{{ item.startAt | date:'shortTime' }} · {{ item.clientName || 'Guest' }}</strong><span>{{ item.serviceNames.join(', ') || 'Service' }}</span><small>{{ item.status }} · {{ item.durationMinutes }} min @if (item.chair) { · {{ item.chair }} }</small></button>
                } @empty { <p class="calendar-empty">No appointments</p> }
              </section>
            }
          </div>
          @if (bookLoading()) { <small class="refresh-line">Refreshing Appointment Book...</small> }
          @if (blockoutOpen()) { <section class="action-form"><div class="action-fields"><label>Date<aura-staff-date-picker [value]="displayBusinessDate(blockoutDate())" ariaLabel="Block-out date" (valueChange)="blockoutDate.set(parseDisplayBusinessDate($event) || blockoutDate())" /></label><label>From<input type="time" [ngModel]="blockoutFrom()" (ngModelChange)="blockoutFrom.set($event)" /></label><label>To<input type="time" [ngModel]="blockoutTo()" (ngModelChange)="blockoutTo.set($event)" /></label></div><label>Reason<input maxlength="500" [ngModel]="blockoutReason()" (ngModelChange)="blockoutReason.set($event)" /></label><button class="button" type="button" [disabled]="savingAction()" (click)="createBlockout()">Save block time</button></section> }
        </section>

        @if (book()?.permissions?.teamManage && ((book()?.waitlist?.length || 0) || (book()?.onlineRequests?.length || 0))) {
          <section class="grid two advanced-queues">
            <article class="panel"><div class="panel-title"><h2>Waitlist</h2><span>{{ book()?.waitlist?.length || 0 }}</span></div><div class="list">@for (entry of book()?.waitlist || []; track recordText(entry,'id')) { <div class="row"><div><strong>{{ recordText(entry,'clientName') || 'Guest' }}</strong><small>{{ recordText(entry,'preferredSlotAt') | date:'dd/MM/yyyy, shortTime' }} · {{ recordText(entry,'notes') }}</small></div><button class="link-button" type="button" (click)="openWaitlist(entry)">Convert</button></div> } @empty { <p>No waitlist entries.</p> }</div></article>
            <article class="panel"><div class="panel-title"><h2>Online requests</h2><span>{{ book()?.onlineRequests?.length || 0 }}</span></div><div class="list">@for (request of book()?.onlineRequests || []; track recordText(request,'id')) { <div class="row request-row"><div><strong>{{ recordText(request,'requestType') }}</strong><small>{{ recordText(request,'createdAt') | date:'dd/MM/yyyy, shortTime' }}</small></div><div class="row-actions"><button class="link-button" type="button" (click)="decideOnlineRequest(request,'approved')">Approve</button><button class="link-button danger" type="button" (click)="decideOnlineRequest(request,'rejected')">Reject</button></div></div> } @empty { <p>No online requests.</p> }</div></article>
          </section>
        }

        <section class="grid four">
          <button class="kpi kpi-button" [class.active-toggle]="activeView() === 'today'" type="button" [attr.aria-pressed]="activeView() === 'today'" (click)="setView('today')"><span>Today</span><strong>{{ kpiCounts().today }}</strong></button>
          <button class="kpi kpi-button" [class.active-toggle]="activeView() === 'live'" type="button" [attr.aria-pressed]="activeView() === 'live'" (click)="setView('live')"><span>Live</span><strong>{{ kpiCounts().live }}</strong></button>
          <button class="kpi kpi-button" [class.active-toggle]="activeView() === 'completed'" type="button" [attr.aria-pressed]="activeView() === 'completed'" (click)="setView('completed')"><span>Completed</span><strong>{{ kpiCounts().completed }}</strong></button>
          <button class="kpi kpi-button" [class.active-toggle]="activeView() === 'cancelled'" type="button" [attr.aria-pressed]="activeView() === 'cancelled'" (click)="setView('cancelled')"><span>Cancelled</span><strong>{{ kpiCounts().cancelled }}</strong></button>
        </section>

        <nav class="queue-tabs" aria-label="Appointment queues">
          <button class="link-button" [class.active-toggle]="activeView() === 'today'" type="button" [attr.aria-pressed]="activeView() === 'today'" (click)="setView('today')">Today's Queue</button>
          <button class="link-button" [class.active-toggle]="activeView() === 'upcoming'" type="button" [attr.aria-pressed]="activeView() === 'upcoming'" (click)="setView('upcoming')">Upcoming</button>
          <button class="link-button" [class.active-toggle]="activeView() === 'completed'" type="button" [attr.aria-pressed]="activeView() === 'completed'" (click)="setView('completed')">Completed</button>
          <button class="link-button" [class.active-toggle]="activeView() === 'shifted'" type="button" [attr.aria-pressed]="activeView() === 'shifted'" (click)="setView('shifted')">Shifted</button>
          @if (canViewAllHistory()) { <button class="link-button" [class.active-toggle]="activeView() === 'all'" type="button" [attr.aria-pressed]="activeView() === 'all'" (click)="setView('all')">All History</button> }
        </nav>

        @if (activeView() === 'all') {
          <section class="panel history-filters">
            <div class="panel-title"><h2>History filters</h2><span>{{ history()?.pagination?.appointmentTotal || 0 }} records</span></div>
            <div class="form-grid compact-grid">
              <label>From<aura-staff-date-picker [value]="historyFrom()" ariaLabel="History from date" (valueChange)="historyFrom.set($event)" /></label>
              <label>To<aura-staff-date-picker [value]="historyTo()" ariaLabel="History to date" (valueChange)="historyTo.set($event)" /></label>
              <label>Client<input type="search" maxlength="100" [ngModel]="historyClient()" (ngModelChange)="historyClient.set($event)" placeholder="Client name" /></label>
              <label>Status<select [ngModel]="historyStatus()" (ngModelChange)="historyStatus.set($event)"><option value="all">All statuses</option><option value="booked">Booked</option><option value="confirmed">Confirmed</option><option value="in-service">In service</option><option value="completed">Completed</option><option value="cancelled">Cancelled</option><option value="no-show">No-show</option></select></label>
              <label>Service<select [ngModel]="historyServiceId()" (ngModelChange)="historyServiceId.set($event)"><option value="">All services</option>@for (service of history()?.services || []; track service.id) { <option [value]="service.id">{{ service.name }}</option> }</select></label>
              <label>Department<select [ngModel]="historyDepartment()" (ngModelChange)="historyDepartment.set($event)"><option value="">All departments</option>@for (department of historyDepartments(); track department) { <option [value]="department">{{ department }}</option> }</select></label>
            </div>
            <div class="row-actions permission-actions"><button class="button primary" type="button" [disabled]="historyLoading()" (click)="loadHistory(true)">Apply</button><button class="button" type="button" [disabled]="historyLoading()" (click)="clearHistoryFilters()">Clear</button></div>
            @if (historyError()) { <p class="action-error">{{ historyError() }}</p> }
          </section>
        }

        <section class="panel" aria-live="polite">
          <div class="panel-title">
            <h2>{{ viewTitle() }}</h2>
            <div class="row-actions">
              <span>{{ activeView() === 'all' ? (history()?.pagination?.appointmentTotal || 0) : visibleAppointments().length }}</span>
              @if (loading() || historyLoading()) { <span class="refresh-line">Refreshing...</span> }
              @if (activeView() === 'live') { <a class="button" routerLink="/staff/queue">Open live timers</a> }
            </div>
          </div>
          <div class="list">
            @for (item of visibleAppointments(); track item.id) {
              <details class="appointment-list-item">
                <summary>
                  <div class="appointment-list-copy">
                  <strong>{{ item.clientName || 'Assigned appointment' }} @if (item.preferredClient) { <span class="preferred-client">Preferred</span> }</strong>
                    <span>{{ item.serviceNames.join(', ') || 'Service not mapped' }}</span>
                  @if (isValidDate(item.startAt) && isValidDate(item.endAt)) {
                  <small>{{ item.startAt | date:'mediumDate' }} · {{ item.startAt | date:'shortTime' }} - {{ item.endAt | date:'shortTime' }} · {{ item.durationMinutes || 0 }} min</small>
                  } @else {
                    <small>Date unavailable - {{ item.durationMinutes || 0 }} min</small>
                  }
                  </div>
                  <div class="appointment-list-meta"><span class="badge">{{ item.status }}</span>@if (item.rescheduleCount) { <span class="pill">Shifted {{ item.rescheduleCount }}</span> }<span class="expand-indicator" aria-hidden="true"></span></div>
                </summary>
                <div class="appointment-list-expanded">
                  <div class="row-actions">
                  @if (canSeeRevenue()) { <span class="badge">{{ item.value | paiseInr }}</span> }
                  <button class="link-button" type="button" (click)="openAppointment(item)">Details</button>
                  </div>
                </div>
              </details>
            } @empty {
              <div class="appointment-empty">
                <p>{{ emptyMessage() }}</p>
                @if (activeView() !== 'upcoming') { <button class="link-button" type="button" (click)="setView('upcoming')">Check upcoming</button> }
              </div>
            }
          </div>
          @if (activeView() === 'all' && history()?.pagination?.appointmentHasMore) { <div class="row-actions permission-actions"><button class="button" type="button" [disabled]="historyLoading()" (click)="loadHistory(false)">{{ historyLoading() ? 'Loading...' : 'Load More' }}</button></div> }
        </section>
      }

      @if (bookingOpen()) {
        <button class="detail-backdrop" type="button" (click)="closeBooking()" aria-label="Close booking"></button>
        <aside class="detail-drawer booking-drawer" role="dialog" aria-modal="true" aria-labelledby="booking-title">
          <div class="panel-title"><h2 id="booking-title">{{ bookingLines()[0]?.appointmentId ? 'Edit appointment' : 'Book appointment' }}</h2><button class="link-button" type="button" (click)="closeBooking()">Close</button></div>
          <div class="booking-steps"><span [class.active]="bookingStep() === 1">1 · Details</span><span [class.active]="bookingStep() === 2">2 · Review</span></div>
          @if (bookingStep() === 1) {
            <section class="booking-form">
              <div class="form-grid compact-grid"><label>Booking type<select [ngModel]="bookingType()" (ngModelChange)="bookingType.set($event); bookingQuote.set(null)"><option value="standard">Standard</option><option value="couple">Couple</option><option value="group">Group (2-6 guests)</option><option value="large_group">Large group</option><option value="day_package">Day package</option></select></label>@if (bookingType() === 'day_package') { <label>Day package<select [ngModel]="bookingPackageId()" (ngModelChange)="applyDayPackage($event)"><option value="">Choose package</option>@for (item of book()?.packages || []; track item.id) { <option [value]="item.id">{{ item.name }}</option> }</select></label> }@if (bookingType() !== 'standard') { <label>Group name<input maxlength="120" [ngModel]="bookingGroupName()" (ngModelChange)="bookingGroupName.set($event)" /></label> }</div>
              <label>Find guest<div class="inline-field"><input type="search" maxlength="100" [ngModel]="bookingClientQuery()" (ngModelChange)="bookingClientQuery.set($event)" placeholder="Name, phone, email or code" /><button class="button" type="button" [disabled]="bookLoading()" (click)="searchGuests()">Search</button></div></label>
              <label>Guest<select [ngModel]="bookingClientId()" (ngModelChange)="bookingClientId.set($event); bookingQuote.set(null)"><option value="">Choose guest</option>@for (client of book()?.clients || []; track client.id) { <option [value]="client.id">{{ client.name }} · {{ client.phone || client.email || client.code }}</option> }</select></label>
              @if (book()?.permissions?.clientCreate) { <button class="link-button" type="button" (click)="newGuestOpen.set(!newGuestOpen())">New guest</button> }
              @if (newGuestOpen()) { <section class="new-guest"><div class="form-grid compact-grid"><label>First name<input maxlength="80" [ngModel]="newGuest().firstName" (ngModelChange)="updateNewGuest('firstName',$event)" /></label><label>Last name<input maxlength="80" [ngModel]="newGuest().lastName" (ngModelChange)="updateNewGuest('lastName',$event)" /></label><label>Phone<input maxlength="30" inputmode="tel" [ngModel]="newGuest().phone" (ngModelChange)="updateNewGuest('phone',$event)" /></label><label>Email<input maxlength="160" type="email" [ngModel]="newGuest().email" (ngModelChange)="updateNewGuest('email',$event)" /></label></div><button class="button" type="button" [disabled]="bookingSaving()" (click)="createGuest()">Create guest</button></section> }
              @for (line of bookingLines(); track $index; let index = $index) {
                <section class="booking-line">
                  <div class="panel-title"><h3>Service {{ index + 1 }}</h3>@if (bookingLines().length > 1) { <button class="link-button danger" type="button" (click)="removeBookingLine(index)">Remove</button> }</div>
                  <div class="form-grid compact-grid">
                    @if (bookingType() === 'couple' || bookingType() === 'group' || bookingType() === 'large_group') { <label>Guest<select [ngModel]="line.clientId" (ngModelChange)="updateBookingLine(index,{clientId:$event})"><option value="">Choose guest</option>@for (client of book()?.clients || []; track client.id) { <option [value]="client.id">{{ client.name }}</option> }</select></label> }
                    <label>Service<select [ngModel]="line.serviceId" (ngModelChange)="chooseService(index, $event)"><option value="">Choose service</option>@for (service of book()?.services || []; track service.id) { <option [value]="service.id">{{ service.name }}</option> }</select></label>
                    <label>Provider<select [ngModel]="line.staffId" (ngModelChange)="updateBookingLine(index,{staffId:$event})"><option value="">Choose provider</option>@for (provider of book()?.staff || []; track provider.id) { <option [value]="provider.id">{{ provider.name }}</option> }</select></label>
                    <label>Provider request<select [ngModel]="line.preference" (ngModelChange)="updateBookingLine(index,{preference:$event})"><option value="any">Any provider</option><option value="preferred">Preferred</option><option value="required">Specific provider</option></select></label>
                    <label>Room / equipment<select [ngModel]="line.resourceId" (ngModelChange)="updateBookingLine(index,{resourceId:$event})"><option value="">None</option>@for (resource of book()?.resources || []; track resource.id) { <option [value]="resource.id">{{ resource.name }} · {{ resource.kind }}</option> }</select></label>
                    <label>Date<aura-staff-date-picker [value]="displayBusinessDate(line.date)" ariaLabel="Service date" (valueChange)="updateBookingLine(index,{date:parseDisplayBusinessDate($event) || line.date})" /></label>
                    <label>Time<input type="time" [ngModel]="line.time" (ngModelChange)="updateBookingLine(index,{time:$event})" /></label>
                    <label>Duration (minutes)<input type="number" min="5" max="1440" [ngModel]="line.duration" (ngModelChange)="updateBookingLine(index,{duration:+$event})" /></label>
                    <label>Flow<select [ngModel]="line.serviceMode" (ngModelChange)="updateBookingLine(index,{serviceMode:$event})"><option value="sequential">Sequential</option><option value="gap">With gap</option><option value="parallel">Parallel</option><option value="segmented">Segmented</option></select></label>
                    @if (line.serviceMode === 'segmented') { <label>Segment label<input maxlength="120" [ngModel]="line.segmentLabel" (ngModelChange)="updateBookingLine(index,{segmentLabel:$event})" /></label> }
                    @if (serviceFor(line.serviceId)?.variants?.length) { <label>Variant<select [ngModel]="line.variantId" (ngModelChange)="updateBookingLine(index,{variantId:$event})"><option value="">Standard</option>@for (variant of serviceFor(line.serviceId)?.variants || []; track recordId(variant)) { <option [value]="recordId(variant)">{{ recordName(variant) }}</option> }</select></label> }
                  </div>
                  @if (serviceFor(line.serviceId)?.addons?.length) { <fieldset class="addon-list"><legend>Add-ons / upsell</legend>@for (addon of serviceFor(line.serviceId)?.addons || []; track recordId(addon)) { <label><input type="checkbox" [checked]="line.addonIds.includes(recordId(addon))" (change)="toggleAddon(index,recordId(addon),$any($event.target).checked)" />{{ recordName(addon) }}</label> }</fieldset> }
                  @if (book()?.permissions?.priceManage) { <div class="form-grid compact-grid"><label>Override price (₹)<input inputmode="decimal" [ngModel]="line.priceOverride" (ngModelChange)="updateBookingLine(index,{priceOverride:$event})" placeholder="Use calculated price" /></label>@if (line.priceOverride !== '') { <label>Override reason<input maxlength="500" [ngModel]="line.priceReason" (ngModelChange)="updateBookingLine(index,{priceReason:$event})" /></label> }</div> }
                </section>
              }
              <button class="link-button" type="button" (click)="addBookingLine()">Add service</button>
              <div class="form-grid compact-grid"><label>Repeat<select [ngModel]="recurrenceCount()" (ngModelChange)="recurrenceCount.set(+$event)"><option [ngValue]="1">One time</option><option [ngValue]="4">4 visits</option><option [ngValue]="8">8 visits</option><option [ngValue]="12">12 visits</option></select></label>@if (recurrenceCount() > 1) { <label>Every (days)<input type="number" min="1" max="365" [ngModel]="recurrenceDays()" (ngModelChange)="recurrenceDays.set(+$event)" /></label> }<label>Virtual meeting link<input type="url" maxlength="500" [ngModel]="virtualMeetingUrl()" (ngModelChange)="virtualMeetingUrl.set($event)" placeholder="https://" /></label><label class="check-label"><input type="checkbox" [checked]="surpriseVisit()" (change)="surpriseVisit.set($any($event.target).checked)" />Surprise visit</label></div>
              <label>Booking notes<textarea rows="3" maxlength="1000" [ngModel]="bookingNotes()" (ngModelChange)="bookingNotes.set($event)"></textarea></label>
              @if (bookingType() !== 'standard') { <label>Group notes<textarea rows="2" maxlength="2000" [ngModel]="bookingGroupNotes()" (ngModelChange)="bookingGroupNotes.set($event)"></textarea></label> }
            </section>
          } @else if (bookingQuote(); as quote) {
            <section class="booking-review"><div class="list"><div class="row"><strong>Guest</strong><span>{{ quote.eligibility?.clientName || 'Guest' }}</span></div><div class="row"><strong>Services</strong><span>{{ bookingLines().length }}</span></div><div class="row"><strong>Total quote</strong><span>{{ quote.totalPaise | paiseInr }}</span></div><div class="row"><strong>Deposit</strong><span>{{ quote.deposit.required ? (quote.deposit.depositPaise | paiseInr) : 'Not required' }}</span></div><div class="row"><strong>Membership</strong><span>{{ quote.eligibility?.membershipName || 'None' }} · {{ benefitsLabel(quote.eligibility?.membershipCredits) }}</span></div><div class="row"><strong>Package credits</strong><span>{{ benefitsLabel(quote.eligibility?.packageCredits) }}</span></div><div class="row"><strong>Wallet</strong><span>{{ (quote.eligibility?.walletPaise || 0) | paiseInr }}</span></div><div class="row"><strong>Unpaid</strong><span>{{ (quote.eligibility?.unpaidPaise || 0) | paiseInr }}</span></div></div></section>
          }
          @if (bookingError()) { <p class="action-error">{{ bookingError() }}</p> }
          <div class="drawer-actions">@if (bookingStep() === 2) { <button class="button" type="button" [disabled]="bookingSaving()" (click)="bookingStep.set(1)">Back</button> }<button class="button primary" type="button" [disabled]="bookingSaving()" (click)="bookingStep() === 1 ? reviewBooking() : saveBooking()">{{ bookingSaving() ? 'Checking...' : (bookingStep() === 1 ? 'Review' : 'Save appointment') }}</button></div>
        </aside>
      }

      @if (selectedAppointment(); as item) {
        <button class="detail-backdrop" type="button" (click)="closeDrawers()" aria-label="Close details"></button>
        <aside class="detail-drawer" role="dialog" aria-modal="true" aria-labelledby="appointment-detail-title" tabindex="-1">
          <div class="panel-title"><h2 id="appointment-detail-title">Appointment detail</h2><button class="link-button" type="button" (click)="closeDrawers()">Close</button></div>
          <section class="grid two compact-grid"><article class="kpi"><span>Work item</span><strong>Assigned appointment</strong></article><article class="kpi"><span>Status</span><strong>{{ item.status }}</strong></article></section>
          <div class="list"><div class="row"><strong>Client</strong><span>{{ item.clientName || '-' }}@if (item.preferredClient) { · Preferred client }</span></div><div class="row"><strong>Time</strong><span>{{ item.startAt | date:'short' }} - {{ item.endAt | date:'shortTime' }}</span></div><div class="row"><strong>Services</strong><span>{{ item.serviceNames.join(', ') || '-' }}@if (item.serviceDepartments.length) { · {{ item.serviceDepartments.join(', ') }}}</span></div><div class="row"><strong>Duration</strong><span>{{ item.durationMinutes || 0 }} min</span></div><div class="row"><strong>Chair</strong><span>{{ item.chair || '-' }}</span></div><div class="row"><strong>Shift history</strong><span>{{ item.rescheduleCount || 0 }} times</span></div><div class="row"><strong>Last service</strong><span>{{ item.lastServiceNames.join(', ') || '-' }}@if (item.lastServiceDepartments.length) { · {{ item.lastServiceDepartments.join(', ') }}}@if (item.lastServiceAt) { · {{ item.lastServiceAt | date:'dd/MM/yyyy' }}}</span></div></div>
          @if (operationLoading()) { <small class="refresh-line">Loading visit operations...</small> }
          @if (operationContext(); as context) {
            <section class="operation-status grid two"><article class="kpi"><span>Forms</span><strong>{{ context.forms.required ? (context.forms.complete ? 'Complete' : context.forms.completedCount + '/' + context.forms.requiredCount) : 'Not required' }}</strong></article><article class="kpi"><span>Consumables</span><strong>{{ context.consumables.pendingApproval ? 'Pending approval' : (context.consumables.recorded ? 'Recorded' : (context.consumables.required ? 'Pending' : 'Not required')) }}</strong></article></section>
            @if (item.virtualMeetingUrl) { <a class="button" [href]="item.virtualMeetingUrl" target="_blank" rel="noopener noreferrer">Join virtual appointment</a> }
            <div class="drawer-actions operation-actions"><button class="button" type="button" [disabled]="savingAction()" (click)="runOperation(item,'start')">Start service</button><button class="button" type="button" [disabled]="savingAction()" (click)="runOperation(item,item.executionStatus === 'paused' ? 'resume' : 'pause')">{{ item.executionStatus === 'paused' ? 'Resume' : 'Pause' }}</button><button class="button" type="button" [disabled]="savingAction()" (click)="runOperation(item,'complete-service')">Complete service</button></div>
            <div class="drawer-actions operation-actions"><button class="button" type="button" [disabled]="savingAction()" (click)="runOperation(item,'complete-appointment',true)">Complete appointment</button><button class="button primary" type="button" [disabled]="savingAction()" (click)="runOperation(item,'checkout')">Handoff to checkout</button></div>
            <div class="drawer-actions"><button class="button" type="button" (click)="rebook(item,true)">Rebook same provider</button><button class="button" type="button" (click)="rebook(item,false)">Rebook another provider</button></div>
            @if (context.permissions.teamManage) { <section class="action-form"><label>Handoff provider<select [ngModel]="handoffStaffId()" (ngModelChange)="handoffStaffId.set($event)"><option value="">Choose provider</option>@for (provider of book()?.staff || []; track provider.id) { <option [value]="provider.id">{{ provider.name }}</option> }</select></label><label>Handoff reason<input maxlength="500" [ngModel]="operationReason()" (ngModelChange)="operationReason.set($event)" /></label><button class="button" type="button" [disabled]="savingAction()" (click)="runOperation(item,'handoff')">Provider handoff</button></section> }
            @if (context.adjacentVisits.length) { <section class="shift-timeline"><h3>Immediate past / upcoming</h3>@for (visit of context.adjacentVisits; track recordText(visit,'id')) { <div><strong>{{ recordText(visit,'startAt') | date:'dd/MM/yyyy, shortTime' }}</strong><span>{{ recordArray(visit,'serviceNames').join(', ') }} · {{ recordText(visit,'status') }}</span></div> }</section> }
            @if (context.activity.length) { <section class="shift-timeline"><h3>Appointment activity</h3>@for (event of context.activity; track recordText(event,'id')) { <div><strong>{{ recordText(event,'createdAt') | date:'dd/MM/yyyy, shortTime' }} · {{ recordText(event,'action') }}</strong>@if (recordText(event,'reason')) { <span>{{ recordText(event,'reason') }}</span> }</div> }</section> }
          }
          <details class="guest-section service-workspace" open>
            <summary>Service workspace</summary>
            <div class="guest-section-body">
              @if (serviceWorkspaceLoading()) { <small class="refresh-line">Loading service workspace...</small> }
              @if (serviceWorkspaceError()) { <p class="action-error" role="alert">{{ serviceWorkspaceError() }}</p> }
              @if (serviceWorkspace(); as workspace) {
                <section class="workspace-summary grid two compact-grid">
                  <article class="kpi"><span>Guest</span><strong>{{ item.clientName || 'Guest' }}</strong><small>{{ recommendationWarning() }}</small></article>
                  <article class="kpi"><span>Service status</span><strong>{{ item.executionStatus || item.status }}</strong><small>{{ item.durationMinutes }} min · {{ recordText(workspace.visit.resource,'name') || item.chair || 'No room / equipment' }}</small></article>
                </section>
                @if (workspace.visit.providerInstructions) { <div class="workspace-warning"><strong>Provider instructions</strong><span>{{ workspace.visit.providerInstructions }}</span></div> }
                <div class="list">@for (service of workspace.visit.services; track service.id) { <div class="row"><div><strong>{{ service.name }}</strong><small>{{ service.durationMinutes }} min@if (service.variant['name']) { · {{ service.variant['name'] }}}@for (addon of service.addons; track recordText(addon,'id')) { · {{ recordText(addon,'name') }} }</small></div><span>{{ service.bookedPricePaise | paiseInr }}</span></div> } @empty { <small>No selected services.</small> }</div>
                <div class="row"><strong>Required forms</strong><span>{{ operationContext()?.forms?.required ? (operationContext()?.forms?.complete ? 'Complete' : 'Pending') : 'Not required' }}</span></div>

                <h3>Consumables</h3>
                <div class="list">@for (recipe of workspace.recipes; track recipe.serviceId + recipe.inventoryItemId) { <div class="row recommendation-row"><div><strong>{{ recipe.itemName }}</strong><small>Planned {{ recipe.expectedQuantity }} {{ recipe.unit }} · stock {{ recipe.stockQuantity }}@if (recipe.lowStock) { · LOW STOCK }@if (recipe.trackAutomatically) { · automatic on completion }</small></div>@if (!recipe.trackAutomatically && workspace.permissions.consumablesManage) { <button class="link-button" type="button" (click)="chooseRecipe(recipe)">Record</button> }</div> } @empty { <small>No consumable recipe for these services.</small> }</div>
                @if (selectedRecipe(); as recipe) { <section class="action-form"><strong>{{ recipe.itemName }} · planned {{ recipe.expectedQuantity }} {{ recipe.unit }}</strong><div class="form-grid compact-grid"><label>Actual quantity<input type="number" min="0.0001" step="0.0001" [ngModel]="actualUsage()" (ngModelChange)="actualUsage.set($event)" /></label><label>Damaged / wasted<input type="number" min="0" step="0.0001" [ngModel]="wastedUsage()" (ngModelChange)="wastedUsage.set($event)" /></label>@if (recipe.batchTracked) { <label>FEFO batch<select [ngModel]="selectedBatchId()" (ngModelChange)="selectedBatchId.set($event)"><option value="">Choose batch</option>@for (batch of recipe.batches; track batch.id) { <option [value]="batch.id">{{ batch.batchNumber }} · {{ batch.quantity }}@if (batch.expiryDate) { · {{ batch.expiryDate | date:'dd/MM/yyyy' }} }</option> }</select></label> }</div><label>Variance / waste reason<textarea rows="2" maxlength="1000" [ngModel]="usageReason()" (ngModelChange)="usageReason.set($event)"></textarea></label><button class="button primary" type="button" [disabled]="serviceWorkspaceSaving()" (click)="recordConsumable(item)">Record usage</button></section> }
                <div class="list">@for (usage of workspace.usage; track usage.id) { <div class="row recommendation-row"><div><strong>{{ usage.itemName }} · {{ usage.actualQuantity }} {{ usage.unit }}</strong><small>{{ usage.status }} · planned {{ usage.expectedQuantity }} · variance {{ usage.varianceQuantity }}@if (usage.wastedQuantity) { · wasted {{ usage.wastedQuantity }} }@if (usage.notes) { · {{ usage.notes }} }</small></div>@if (workspace.permissions.consumablesReview && usage.status === 'pending_approval') { <div class="row-actions"><button class="link-button" type="button" [disabled]="serviceWorkspaceSaving()" (click)="reviewUsage(item,usage.id,'approve')">Approve</button><button class="link-button danger" type="button" [disabled]="serviceWorkspaceSaving()" (click)="reviewUsage(item,usage.id,'reject')">Reject</button></div> }</div> } @empty { <small>No manual usage recorded.</small> }</div>

                <h3>Retail and upsell</h3>
                <div class="workspace-warning"><span>{{ recommendationWarning() }} No discount or sale is applied automatically.</span></div>
                @if (workspace.permissions.upsellManage) {
                  <div class="form-grid compact-grid"><label>Product search<div class="inline-field"><input type="search" maxlength="100" [ngModel]="retailQuery()" (ngModelChange)="retailQuery.set($event)" /><button class="button" type="button" (click)="searchRetail(item)">Search</button></div></label><label>Barcode<div class="inline-field"><input inputmode="numeric" maxlength="100" [ngModel]="retailBarcode()" (ngModelChange)="retailBarcode.set($event)" (keyup.enter)="searchRetail(item,true)" /><button class="button" type="button" (click)="searchRetail(item,true)">Find</button></div></label><label>Camera scan<input type="file" accept="image/*" capture="environment" (change)="scanRetailBarcode($event,item)" /></label><label>Quantity<input type="number" min="1" step="1" [ngModel]="retailQuantity()" (ngModelChange)="retailQuantity.set($event)" /></label></div>
                  @if (workspace.permissions.priceManage) { <div class="form-grid compact-grid"><label>Permitted unit price (₹)<input type="number" min="0" step="0.01" [ngModel]="retailPrice()" (ngModelChange)="retailPrice.set($event)" /></label><label>Price-change reason<input maxlength="500" [ngModel]="retailPriceReason()" (ngModelChange)="retailPriceReason.set($event)" /></label></div> }
                  <div class="list">@for (product of workspace.products; track product.id) { <div class="row recommendation-row"><div><strong>{{ product.name }}@if (product.previouslyPurchased) { · Previously purchased }</strong><small>{{ product.brand }} · stock {{ product.availableStock }} · {{ product.retailPricePaise | paiseInr }}</small></div><button class="link-button" type="button" [disabled]="serviceWorkspaceSaving() || product.availableStock < 1 || product.retailPricePaise < 1" (click)="addInvoiceLine(item,'product',product.id)">Add product</button></div> } @empty { <small>No matching retail products.</small> }</div>
                  <div class="list">@for (service of workspace.visit.services; track service.id) { <div class="row"><div><strong>{{ service.name }}</strong><small>Service recommendation</small></div><button class="link-button" type="button" [disabled]="serviceWorkspaceSaving()" (click)="addInvoiceLine(item,'service',service.id)">Add service</button></div> }@for (membership of workspace.offers.memberships; track membership.id) { <div class="row"><div><strong>{{ membership.name }}</strong><small>{{ membership.pricePaise | paiseInr }}@if (membership.alreadyOwned) { · already owned }</small></div><button class="link-button" type="button" [disabled]="serviceWorkspaceSaving() || membership.alreadyOwned" (click)="addInvoiceLine(item,'membership',membership.id)">Add membership</button></div> }@for (pack of workspace.offers.packages; track pack.id) { <div class="row"><div><strong>{{ pack.name }}</strong><small>{{ pack.pricePaise | paiseInr }}@if (pack.availableCredits) { · {{ pack.availableCredits }} credits available }</small></div><button class="link-button" type="button" [disabled]="serviceWorkspaceSaving() || pack.availableCredits > 0" (click)="addInvoiceLine(item,'package',pack.id)">Add package</button></div> }</div>
                }
                @if (workspace.invoice; as invoice) { <h3>Checkout draft</h3><div class="list">@for (line of invoice.lines; track line.id) { <div class="row"><div><strong>{{ line.itemName }}</strong><small>{{ line.quantity }} × {{ line.unitPricePaise | paiseInr }} · seller {{ line.staffId }}</small></div><span>{{ line.lineTotalPaise | paiseInr }}</span></div> } @empty { <small>No invoice recommendations.</small> }<div class="row"><strong>Total</strong><strong>{{ invoice.totalPaise | paiseInr }}</strong></div></div> }
                <section class="action-form"><label>Handoff notes<textarea rows="2" maxlength="2000" [ngModel]="handoffNote()" (ngModelChange)="handoffNote.set($event)"></textarea></label><button class="button" type="button" [disabled]="serviceWorkspaceSaving()" (click)="saveHandoffNote(item)">Save handoff note</button></section>
              }
            </div>
          </details>
          <details class="guest-section checkout-workspace">
            <summary>Staff checkout</summary>
            <div class="guest-section-body">
              @if (!staff.isOnline()) { <div class="workspace-warning" role="alert">Payments and register actions are blocked offline.</div> }
              @if (!checkout() && !checkoutLoading()) { <button class="button primary" type="button" (click)="loadCheckout(item.id)">Open invoice</button> }
              @if (checkoutLoading()) { <small class="refresh-line">Loading checkout...</small> }
              @if (checkoutError()) { <p class="action-error" role="alert">{{ checkoutError() }}</p> }
              @if (checkout(); as value) {
                <div class="panel-title"><h3>{{ value.checkout.invoice.invoiceNumber || 'Draft invoice' }}</h3><button class="link-button" type="button" [disabled]="checkoutLoading()" (click)="loadCheckout(item.id)">Reload</button></div>
                <section class="grid two compact-grid"><article class="kpi"><span>Total</span><strong>{{ value.checkout.sale.totalPaise | paiseInr }}</strong><small>Tax {{ value.checkout.sale.taxPaise | paiseInr }} · tip {{ value.checkout.sale.tipPaise | paiseInr }}</small></article><article class="kpi"><span>Balance due</span><strong>{{ value.checkout.sale.balanceDuePaise | paiseInr }}</strong><small>{{ value.checkout.sale.status }}@if (value.groupInvoice) { · group invoice }</small></article></section>
                <div class="list">@for (line of value.checkout.lines; track line.id) { <div class="row"><div><strong>{{ line.itemName }}</strong><small>{{ line.quantity }} × {{ line.unitPricePaise | paiseInr }} · tax {{ line.taxPercent }}%</small></div><span>{{ line.lineTotalPaise | paiseInr }}</span></div> } @empty { <small>No invoice lines.</small> }</div>
                @if (value.permissions.manage && value.checkout.sale.paidPaise === 0) {
                  <section class="action-form"><div class="form-grid compact-grid"><label>Bill discount (₹)<input type="number" min="0" step="0.01" [ngModel]="checkoutDiscount()" (ngModelChange)="checkoutDiscount.set($event)" /></label><label>Discount reason<input maxlength="500" [ngModel]="checkoutDiscountReason()" (ngModelChange)="checkoutDiscountReason.set($event)" /></label><label>Coupon<input maxlength="100" [ngModel]="checkoutCoupon()" (ngModelChange)="checkoutCoupon.set($event)" /></label><label>Tip (₹)<input type="number" min="0" step="0.01" [ngModel]="checkoutTip()" (ngModelChange)="checkoutTip.set($event)" /></label></div><h3>Tip split</h3>@for (split of checkoutTipSplits(); track $index; let index = $index) { <div class="form-grid compact-grid"><label>Staff<select [ngModel]="split.staffId" (ngModelChange)="updateTipSplit(index,'staffId',$event)"><option value="">Choose staff</option>@for (person of book()?.staff || []; track person.id) { <option [value]="person.id">{{ person.name }}</option> }</select></label><label>Amount (₹)<input type="number" min="0.01" step="0.01" [ngModel]="split.amount" (ngModelChange)="updateTipSplit(index,'amount',$event)" /></label><button class="link-button danger" type="button" (click)="removeTipSplit(index)">Remove</button></div> }<button class="link-button" type="button" (click)="addTipSplit()">Add tip recipient</button><label class="check-label"><input type="checkbox" [checked]="checkoutRound()" (change)="checkoutRound.set($any($event.target).checked)" />Round to nearest rupee</label><div class="form-grid compact-grid"><label>Package credit<select [ngModel]="packageCreditId()" (ngModelChange)="packageCreditId.set($event)"><option value="">None</option>@for (credit of value.packageCredits; track credit.id) { <option [value]="credit.id">{{ credit.packageName }} · {{ credit.serviceName }} · {{ credit.remainingQuantity }}</option> }</select></label><label>Membership credit<select [ngModel]="membershipCreditId()" (ngModelChange)="membershipCreditId.set($event)"><option value="">None</option>@for (credit of value.membershipCredits; track credit.id) { <option [value]="credit.id">{{ credit.membershipName }} · {{ credit.serviceName }} · {{ credit.remainingQuantity }}</option> }</select></label><label>Credit quantity<input type="number" min="1" step="1" [ngModel]="benefitQuantity()" (ngModelChange)="benefitQuantity.set($event)" /></label></div><button class="button" type="button" [disabled]="checkoutSaving()" (click)="saveCheckout(item.id)">Update invoice</button></section>
                  <section class="action-form"><h3>Gift / prepaid card sale</h3><div class="form-grid compact-grid"><label>Card code<input maxlength="64" [ngModel]="giftCardCode()" (ngModelChange)="giftCardCode.set($event)" /></label><label>Value (₹)<input type="number" min="0.01" step="0.01" [ngModel]="giftCardAmount()" (ngModelChange)="giftCardAmount.set($event)" /></label></div><button class="button" type="button" [disabled]="checkoutSaving()" (click)="addGiftCard(item)">Add liability item</button></section>
                }
                @if (value.permissions.manage && value.checkout.sale.balanceDuePaise > 0) {
                  <section class="action-form"><h3>Payment / split payment</h3><div class="form-grid compact-grid"><label>Method<select [ngModel]="paymentMethod()" (ngModelChange)="paymentMethod.set($event)">@for (method of allowedPaymentMethods(value); track method.code) { <option [value]="method.code">{{ method.name }}</option> }</select></label><label>Amount (₹)<input type="number" min="0.01" step="0.01" [ngModel]="paymentAmount()" (ngModelChange)="paymentAmount.set($event)" /></label><label>Reference<input maxlength="120" [ngModel]="paymentReference()" (ngModelChange)="paymentReference.set($event)" /></label><label>Till ID<input maxlength="120" [ngModel]="paymentTillId()" (ngModelChange)="paymentTillId.set($event)" /></label></div><button class="button primary" type="button" [disabled]="checkoutSaving() || !staff.isOnline()" (click)="recordPayment(item.id)">Record payment</button></section>
                  @if (value.providers.length) { <section class="action-form"><h3>Secure card / tap-to-pay</h3><small>Use a saved instrument or opaque tokens returned by the approved terminal/provider SDK. Never enter card details.</small><div class="form-grid compact-grid"><label>Saved instrument<select [ngModel]="savedInstrumentId()" (ngModelChange)="savedInstrumentId.set($event)"><option value="">New terminal payment</option>@for (instrument of value.paymentInstruments; track instrument.id) { <option [value]="instrument.id">{{ instrument.brand || instrument.methodType }} · •••• {{ instrument.last4 }} · {{ instrument.provider }}</option> }</select></label><label>Provider<select [ngModel]="paymentProvider()" (ngModelChange)="paymentProvider.set($event)">@for (provider of value.providers; track provider) { <option [value]="provider">{{ provider }}</option> }</select></label><label>Provider payment token<input autocomplete="off" maxlength="500" [disabled]="!!savedInstrumentId()" [ngModel]="providerPaymentToken()" (ngModelChange)="providerPaymentToken.set($event)" /></label><label>Provider customer token<input autocomplete="off" maxlength="500" [disabled]="!!savedInstrumentId()" [ngModel]="providerCustomerToken()" (ngModelChange)="providerCustomerToken.set($event)" /></label></div><label class="check-label"><input type="checkbox" [disabled]="!!savedInstrumentId()" [checked]="storePaymentMethod()" (change)="storePaymentMethod.set($any($event.target).checked)" />Save provider token for future payments</label><button class="button" type="button" [disabled]="checkoutSaving() || !staff.isOnline()" (click)="startProviderPayment(item.id)">Send to provider</button></section> }
                  <section class="action-form"><h3>India UPI / QR</h3><label>Provider<select [ngModel]="upiProvider()" (ngModelChange)="upiProvider.set($event)"><option value="razorpay">Razorpay</option><option value="cashfree">Cashfree</option><option value="phonepe">PhonePe</option></select></label><button class="button" type="button" [disabled]="checkoutSaving() || !staff.isOnline()" (click)="createUpiLink(item.id)">Create secure payment link / QR</button>@if (upiUrl()) { <a class="button primary" [href]="upiUrl()" target="_blank" rel="noopener noreferrer">Open UPI payment</a> }</section>
                }
                <div class="list">@for (payment of value.checkout.payments; track payment.id) { <div class="row"><div><strong>{{ payment.label || payment.method }}</strong><small>{{ payment.paidAt | date:'dd/MM/yyyy, shortTime' }}@if (payment.methodReference) { · {{ payment.methodReference }} }</small></div><span>{{ payment.amountPaise | paiseInr }}</span></div> } @empty { <small>No payments recorded.</small> }</div>
                <div class="drawer-actions"><button class="button primary" type="button" [disabled]="checkoutSaving() || !staff.isOnline() || value.checkout.sale.status !== 'draft'" (click)="finalizeCheckout(item.id)">Finalize invoice</button><button class="button" type="button" [disabled]="checkoutSaving()" (click)="printReceipt(item.id)">Print receipt</button><button class="button" type="button" [disabled]="checkoutSaving()" (click)="sendReceipt(item.id)">Send receipt</button></div>
                @if (value.permissions.lifecycle && value.checkout.sale.status !== 'draft') { <section class="action-form"><h3>Refund / void</h3><div class="form-grid compact-grid"><label>Reason<input maxlength="500" [ngModel]="lifecycleReason()" (ngModelChange)="lifecycleReason.set($event)" /></label><label>Refund amount (₹)<input type="number" min="0.01" step="0.01" [ngModel]="refundAmount()" (ngModelChange)="refundAmount.set($event)" /></label><label>MFA code<input inputmode="numeric" autocomplete="one-time-code" maxlength="12" [ngModel]="lifecycleMfa()" (ngModelChange)="lifecycleMfa.set($event)" /></label></div><div class="drawer-actions"><button class="link-button danger" type="button" [disabled]="checkoutSaving()" (click)="runCheckoutLifecycle(item.id,'void')">Void</button><button class="link-button danger" type="button" [disabled]="checkoutSaving()" (click)="runCheckoutLifecycle(item.id,'refund')">Refund</button></div></section> }
              }
            </div>
          </details>
          <section class="guest-360" aria-labelledby="guest-360-title">
            <div class="panel-title"><h2 id="guest-360-title">Guest 360</h2>@if (guestLoading()) { <small>Loading...</small> }</div>
            @if (guestError()) { <p class="action-error" role="alert">{{ guestError() }}</p> }
            @if (guest360(); as guest) {
              <section class="guest-identity">
                @if (guestPhotoUrl()) { <img [src]="guestPhotoUrl()" alt="Guest profile" /> } @else { <span class="guest-avatar" aria-hidden="true">{{ guest.guest.firstName.charAt(0) }}{{ guest.guest.lastName.charAt(0) }}</span> }
                <div><strong>{{ guest.guest.firstName }} {{ guest.guest.lastName }}</strong><span>{{ guest.guest.phone || 'Phone hidden' }} · {{ guest.guest.email || 'Email hidden' }}</span><small>{{ recordText(guest.guest,'membershipLabel') || 'No active membership' }}</small></div>
              </section>
              @if (guest.guest.clinicalProfile?.allergies || guest.guest.birthday || guest.guest.anniversary || relationRows('complaints').length || guestSummaryNumber('churnRiskScore')) {
                <div class="guest-alerts" role="status">
                  @if (guest.guest.clinicalProfile?.allergies) { <span>Allergy: {{ guest.guest.clinicalProfile?.allergies }}</span> }
                  @if (guest.guest.birthday) { <span>Birthday {{ guest.guest.birthday | date:'dd/MM/yyyy' }}</span> }
                  @if (guest.guest.anniversary) { <span>Anniversary {{ guest.guest.anniversary | date:'dd/MM/yyyy' }}</span> }
                  @if (relationRows('complaints').length) { <span>{{ relationRows('complaints').length }} guest issue(s)</span> }
                  @if (guestSummaryNumber('churnRiskScore')) { <span>Priority risk {{ guestSummaryNumber('churnRiskScore') }}</span> }
                </div>
              }
              <section class="grid two compact-grid guest-metrics"><article class="kpi"><span>Visits</span><strong>{{ recordText(guest.guest.summary,'totalVisits') || '0' }}</strong></article><article class="kpi"><span>Loyalty / wallet</span><strong>{{ guestWalletPaise() | paiseInr }}</strong></article></section>
              <small>{{ guestSummaryNumber('rewardPointsBalance') }} loyalty point(s) · {{ recordText(guest.guest.summary,'rfmSegment') || 'No segment' }}</small>

              <details class="guest-section"><summary>Visits, services and benefits</summary>
                <div class="guest-section-body">
                  <h3>Upcoming / past appointments</h3>
                  <div class="list">@for (visit of guest.guest.appointments.slice(0,6); track recordText(visit,'id')) { <div class="row"><div><strong>{{ recordText(visit,'startAt') | date:'dd/MM/yyyy, shortTime' }}</strong><small>{{ recordText(visit,'serviceNames') || 'Service' }} · {{ recordText(visit,'staffName') }} · {{ recordText(visit,'status') }}</small></div></div> } @empty { <small>No appointment history.</small> }</div>
                  <h3>Service history</h3>
                  <div class="list">@for (service of guest.guest.serviceHistory.slice(0,6); track recordText(service,'saleId') + recordText(service,'serviceId')) { <div class="row"><div><strong>{{ recordText(service,'serviceName') || 'Service' }}</strong><small>{{ recordText(service,'createdAt') | date:'dd/MM/yyyy' }} · {{ recordText(service,'invoiceNumber') }}</small></div></div> } @empty { <small>No service history.</small> }</div>
                  <h3>Memberships and packages</h3>
                  <div class="list">@for (membership of relationRows('memberships'); track recordText(membership,'clientMembershipId')) { <div class="row"><strong>{{ recordText(membership,'name') }}</strong><small>{{ recordText(membership,'active') === 'true' ? 'Active' : 'Inactive' }}@if (recordText(membership,'expiresAt')) { · expires {{ recordText(membership,'expiresAt') | date:'dd/MM/yyyy' }} }</small></div> } @for (pack of relationRows('packages'); track recordText(pack,'packageId')) { <div class="row"><strong>{{ recordText(pack,'name') }}</strong><small>{{ recordText(pack,'remainingQuantity') }} credit(s)</small></div> } @empty { <small>No package credits available.</small> }</div>
                  <h3>Product purchases and redemptions</h3>
                  <div class="list">@for (product of relationRows('products'); track recordText(product,'productId')) { <div class="row"><strong>{{ recordText(product,'name') }}</strong><small>{{ recordText(product,'quantity') }} purchased · {{ +(recordText(product,'spendPaise') || 0) | paiseInr }}</small></div> } @for (event of guest.timeline.slice(0,10); track recordText(event,'id')) { <div class="row"><div><strong>{{ recordText(event,'title') || recordText(event,'eventType') }}</strong><small>{{ recordText(event,'occurredAt') | date:'dd/MM/yyyy, shortTime' }} · {{ recordText(event,'detail') }}</small></div></div> } @empty { <small>No activity history.</small> }</div>
                  @if (relationRows('complaints').length) { <h3>Guest issues</h3><div class="list">@for (issue of relationRows('complaints'); track recordText(issue,'id')) { <div class="row"><div><strong>{{ recordText(issue,'type') }}</strong><small>{{ recordText(issue,'text') }}</small></div></div> }</div> }
                </div>
              </details>

              <details class="guest-section"><summary>Notes and clinical</summary><div class="guest-section-body">
                <div class="list">@for (note of guest.guest.clientNotes; track recordText(note,'id')) { <div class="row"><div><strong>{{ recordText(note,'noteType') }} · {{ recordText(note,'visibility') }}</strong><small>{{ recordText(note,'note') }}</small></div></div> } @empty { <small>No visible notes.</small> }</div>
                @if (guest.permissions.notesManage) { <section class="action-form"><div class="form-grid compact-grid"><label>Type<select [ngModel]="guestNoteType()" (ngModelChange)="guestNoteType.set($event)"><option value="general">General</option><option value="preference">Preference</option><option value="complaint">Issue</option></select></label><label>Visibility<select [ngModel]="guestNoteVisibility()" (ngModelChange)="guestNoteVisibility.set($event)"><option value="assigned_staff">Assigned staff</option><option value="branch_staff">Branch staff</option><option value="management">Management</option></select></label></div><label>Note<textarea rows="2" maxlength="2000" [ngModel]="guestNote()" (ngModelChange)="guestNote.set($event)"></textarea></label><button class="button" type="button" [disabled]="guestSaving()" (click)="saveGuestNote(item)">Save note</button></section> }
                @if (guest.permissions.clinicalRead) { <section class="action-form"><label>Allergies / sensitivities<textarea rows="2" maxlength="4000" [disabled]="!guest.permissions.clinicalManage" [ngModel]="guestAllergies()" (ngModelChange)="guestAllergies.set($event)"></textarea></label><label>Clinical preferences<textarea rows="2" maxlength="4000" [disabled]="!guest.permissions.clinicalManage" [ngModel]="guestPreferences()" (ngModelChange)="guestPreferences.set($event)"></textarea></label>@if (guest.permissions.clinicalManage) { <button class="button" type="button" [disabled]="guestSaving()" (click)="saveGuestClinical(item)">Save clinical profile</button> }</section> }
              </div></details>

              @if (guest.permissions.formsRead) { <details class="guest-section" open><summary>Digital forms</summary><div class="guest-section-body">
                <div class="form-status-list">@for (status of guest.formStatuses; track status.definitionId) { <button class="link-button" type="button" [class.active-toggle]="guestFormId() === status.definitionId" (click)="selectGuestFormById(status.definitionId)"><strong>{{ status.name }}</strong><span>{{ status.required ? 'Required · ' : '' }}{{ status.status }}</span></button> } @empty { <small>No applicable forms.</small> }</div>
                @if (selectedGuestForm(); as form) {
                  <section class="guest-form"><div class="form-grid compact-grid"><label>Mode<select [disabled]="!guest.permissions.formsManage" [ngModel]="guestFormMode()" (ngModelChange)="guestFormMode.set($event)">@if (form.staffModeAllowed) { <option value="staff">Staff-filled</option> }@if (form.guestModeAllowed) { <option value="guest">Guest mode</option> }</select></label><span class="badge">v{{ form.version }} · {{ form.required ? 'Required' : 'Optional' }}</span></div>
                    @for (field of form.fieldsJson; track field.key) {
                      @if (field.type === 'section') { <h3>{{ field.label }}</h3> }
                      @else if (formFieldVisible(field)) {
                        @if (field.type === 'textarea' || field.type === 'clinical') { <label>{{ field.label }}@if (field.required) { * }<textarea rows="3" [disabled]="!guest.permissions.formsManage" [ngModel]="formText(field.key)" (ngModelChange)="setFormValue(field.key,$event)"></textarea></label> }
                        @else if (field.type === 'select') { <label>{{ field.label }}@if (field.required) { * }<select [disabled]="!guest.permissions.formsManage" [ngModel]="formText(field.key)" (ngModelChange)="setFormValue(field.key,$event)"><option value="">Choose</option>@for (option of field.options || []; track option) { <option [value]="option">{{ option }}</option> }</select></label> }
                        @else if (field.type === 'boolean') { <label class="check-label"><input type="checkbox" [disabled]="!guest.permissions.formsManage" [checked]="!!formValue(field.key)" (change)="setFormValue(field.key,$any($event.target).checked)" />{{ field.label }}@if (field.required) { * }</label> }
                        @else if (field.type === 'date') { <label>{{ field.label }}@if (field.required) { * }<aura-staff-date-picker [value]="displayBusinessDate(formText(field.key))" [disabled]="!guest.permissions.formsManage" [ariaLabel]="field.label" (valueChange)="setFormValue(field.key,parseDisplayBusinessDate($event))" /></label> }
                        @else if (field.type === 'table') { <fieldset class="form-table"><legend>{{ field.label }}@if (field.required) { * }</legend>@for (row of formTableRows(field.key); track $index; let rowIndex = $index) { <div class="form-table-row">@for (column of field.columns || []; track column.key) { @if (column.type === 'boolean') { <label class="check-label"><input type="checkbox" [disabled]="!guest.permissions.formsManage" [checked]="!!row[column.key]" (change)="updateFormTableCell(field,rowIndex,column.key,$any($event.target).checked)" />{{ column.label }}</label> } @else if (column.type === 'date') { <label>{{ column.label }}<aura-staff-date-picker [value]="displayBusinessDate('' + (row[column.key] || ''))" [disabled]="!guest.permissions.formsManage" [ariaLabel]="column.label" (valueChange)="updateFormTableCell(field,rowIndex,column.key,parseDisplayBusinessDate($event))" /></label> } @else { <label>{{ column.label }}<input [type]="column.type === 'number' ? 'number' : 'text'" [disabled]="!guest.permissions.formsManage" [value]="row[column.key] || ''" (input)="updateFormTableCell(field,rowIndex,column.key,column.type === 'number' && $any($event.target).value !== '' ? +$any($event.target).value : $any($event.target).value)" /></label> } }<button class="link-button danger" type="button" [disabled]="!guest.permissions.formsManage" (click)="removeFormTableRow(field,rowIndex)">Remove</button></div> }<button class="link-button" type="button" [disabled]="!guest.permissions.formsManage" (click)="addFormTableRow(field)">Add row</button></fieldset> }
                        @else { <label>{{ field.label }}@if (field.required) { * }<input [type]="field.type === 'number' ? 'number' : 'text'" [min]="field.min" [max]="field.max" [disabled]="!guest.permissions.formsManage" [ngModel]="formText(field.key)" (ngModelChange)="setFormValue(field.key,field.type === 'number' && $event !== '' ? +$event : $event)" /></label> }
                      }
                    }
                    @if (formRequiresSignature(form)) { <label>Signature name *<input maxlength="200" [disabled]="!guest.permissions.formsManage" [ngModel]="guestSignatureName()" (ngModelChange)="guestSignatureName.set($event)" /></label><label class="check-label"><input type="checkbox" [disabled]="!guest.permissions.formsManage" [checked]="guestFormConsent()" (change)="guestFormConsent.set($any($event.target).checked)" />Guest confirmed this signature</label> }
                    @if (guestCorrectionId()) { <label>Correction reason *<textarea rows="2" maxlength="1000" [ngModel]="guestCorrectionReason()" (ngModelChange)="guestCorrectionReason.set($event)"></textarea></label> }
                    @if (guest.permissions.formsManage) { <div class="drawer-actions"><button class="button" type="button" [disabled]="guestSaving()" (click)="saveGuestForm(item,'draft')">Save draft</button><button class="button primary" type="button" [disabled]="guestSaving()" (click)="saveGuestForm(item,'submitted')">Final submit</button></div> }
                  </section>
                }
                <h3>Previous submissions</h3><div class="list">@for (submission of guest.guest.formSubmissions; track submission.id) { <div class="submission-row"><div><strong>{{ submission.formName }} · v{{ submission.formVersion }}</strong><small>{{ submission.status }}@if (submission.expiresAt) { · expires {{ submission.expiresAt | date:'dd/MM/yyyy' }} }@if (submission.reviewStatus) { · {{ submission.reviewStatus }} }</small></div><div class="row-actions">@if (submission.status === 'submitted' && guest.permissions.formsManage) { <button class="link-button" type="button" (click)="startGuestCorrection(submission)">Correct</button> }@if (submission.status === 'submitted' && guest.permissions.formsReview) { <button class="link-button" type="button" (click)="reviewGuestForm(item,submission,'approved')">Approve</button><button class="link-button" type="button" (click)="reviewGuestForm(item,submission,'correction_required')">Return</button> }</div></div> } @empty { <small>No form history.</small> }</div>
                @if (guest.permissions.formsReview) { <label>Review note<textarea rows="2" maxlength="1000" [ngModel]="guestReviewNote()" (ngModelChange)="guestReviewNote.set($event)"></textarea></label> }
              </div></details> }

              @if (guest.permissions.photosRead || guest.permissions.photosManage) { <details class="guest-section"><summary>Photos and files</summary><div class="guest-section-body">
                @if (guestPhotoUrl()) { <div class="guest-photo-preview"><img [src]="guestPhotoUrl()" alt="Selected guest treatment photo" /><a class="link-button" [href]="guestPhotoUrl()" download="guest-photo">Download</a></div> }
                <div class="photo-list">@for (photo of guest.guest.treatmentPhotos; track recordText(photo,'id')) { <div class="row"><div><strong>{{ recordText(photo,'photoType') }} · {{ recordText(photo,'caption') }}</strong><small>{{ recordText(photo,'createdAt') | date:'dd/MM/yyyy, shortTime' }} · {{ recordText(photo,'scanStatus') }}</small></div><div class="row-actions">@if (guest.permissions.photosRead) { <button class="link-button" type="button" (click)="viewGuestPhoto(recordText(photo,'id'))">View</button> }@if (guest.permissions.photosManage) { <button class="link-button danger" type="button" [disabled]="guestSaving()" (click)="deleteGuestPhoto(item,recordText(photo,'id'))">Delete</button> }</div></div> } @empty { <small>No treatment photos.</small> }</div>
                @if (guest.permissions.photosManage) { <section class="action-form"><label>Photo<input type="file" accept="image/jpeg,image/png,image/webp" capture="environment" (change)="onGuestPhotoFile($event)" /></label><div class="form-grid compact-grid"><label>Category<select [ngModel]="guestPhotoType()" (ngModelChange)="guestPhotoType.set($event)"><option value="profile">Profile</option><option value="before">Before</option><option value="after">After</option><option value="other">Other</option></select></label><label>Service<select [ngModel]="guestPhotoServiceId()" (ngModelChange)="guestPhotoServiceId.set($event)"><option value="">Appointment</option>@for (serviceId of item.serviceIds; track serviceId; let index = $index) { <option [value]="serviceId">{{ item.serviceNames[index] || 'Service' }}</option> }</select></label></div><label>Caption<input maxlength="500" [ngModel]="guestPhotoCaption()" (ngModelChange)="guestPhotoCaption.set($event)" /></label><label class="check-label"><input type="checkbox" [checked]="guestPhotoConsent()" (change)="guestPhotoConsent.set($any($event.target).checked)" />Guest consent confirmed *</label><label>Consent reason<input maxlength="500" [ngModel]="guestPhotoConsentReason()" (ngModelChange)="guestPhotoConsentReason.set($event)" /></label><button class="button" type="button" [disabled]="guestSaving()" (click)="uploadGuestPhoto(item)">Upload protected photo</button></section> }
              </div></details> }

              <details class="guest-section"><summary>Consent and communication</summary><div class="guest-section-body"><div class="list">@for (event of guest.guest.consentHistory.slice(0,8); track recordText(event,'id')) { <div class="row"><div><strong>{{ recordText(event,'channel') }} · {{ recordText(event,'optedIn') === 'true' ? 'Opted in' : 'Opted out' }}</strong><small>{{ recordText(event,'recordedAt') | date:'dd/MM/yyyy, shortTime' }} · {{ recordText(event,'reason') }}</small></div></div> } @empty { <small>No consent history.</small> }</div>@if (guest.permissions.consentManage) { <section class="action-form"><label>Preferred channel<select [ngModel]="guestPreferredChannel()" (ngModelChange)="guestPreferredChannel.set($event)"><option value="none">None</option><option value="whatsapp">WhatsApp</option><option value="sms">SMS</option><option value="email">Email</option><option value="phone">Phone</option></select></label><div class="consent-options"><label class="check-label"><input type="checkbox" [checked]="guestWhatsappOptIn()" (change)="guestWhatsappOptIn.set($any($event.target).checked)" />WhatsApp</label><label class="check-label"><input type="checkbox" [checked]="guestSmsOptIn()" (change)="guestSmsOptIn.set($any($event.target).checked)" />SMS</label><label class="check-label"><input type="checkbox" [checked]="guestEmailOptIn()" (change)="guestEmailOptIn.set($any($event.target).checked)" />Email</label></div><label>Change reason<input maxlength="500" [ngModel]="guestPreferenceReason()" (ngModelChange)="guestPreferenceReason.set($event)" /></label><button class="button" type="button" [disabled]="guestSaving()" (click)="saveGuestPreferences(item)">Save preferences</button></section> }</div></details>
            } @else if (!guestLoading()) { <small>Guest profile is not available for this appointment.</small> }
          </section>
          <section class="suitable-staff" aria-live="polite">
            <h3>Suitable staff</h3>
            @if (recommendationLoading()) { <small>Checking live availability...</small> }
            @else if (recommendationError()) { <small class="action-error">{{ recommendationError() }}</small> }
            @else {
              @for (recommendation of recommendations().slice(0, 3); track recommendation.staffId; let rank = $index) {
                <article [class.current-staff]="recommendation.staffId === item.staffId">
                  <strong>{{ rank + 1 }}. {{ recommendation.staffName }}@if (recommendation.staffId === item.staffId) { · Assigned }</strong>
                  <span><b>Why this staff?</b> {{ recommendation.recommendationReason }}</span>
                  @if (recommendationMeta(recommendation)) { <small>{{ recommendationMeta(recommendation) }}</small> }
                </article>
              } @empty { <small>No suitable staff available for this slot.</small> }
            }
          </section>
          @if (item.rescheduleTimeline.length) { <section class="shift-timeline"><h3>Shift / reschedule timeline</h3>@for (event of item.rescheduleTimeline; track event.changedAt + event.action) { <div><strong>{{ event.changedAt | date:'dd/MM/yyyy' }} · {{ event.changedAt | date:'shortTime' }}</strong><span>{{ event.fromStartAt | date:'short' }} → {{ event.toStartAt | date:'short' }}</span>@if (event.reason) { <small>{{ event.reason }}</small> }</div> }</section> }
          @if (canManageAppointment(item) && !actionMode()) {
            <div class="drawer-actions"><button class="button" type="button" (click)="openEditBooking(item)">Edit booking</button><button class="button" type="button" (click)="beginReschedule(item)">Reschedule</button><button class="link-button danger" type="button" (click)="beginCancel()">Cancel</button></div>
            <div class="drawer-actions"><button class="button" type="button" [disabled]="savingAction()" (click)="changeStatus(item,'confirmed')">Confirm</button><button class="button" type="button" [disabled]="savingAction()" (click)="changeStatus(item,'arrived')">Check in</button></div>
            <section class="action-form"><label>No-show reason<textarea rows="2" maxlength="500" [ngModel]="statusReason()" (ngModelChange)="statusReason.set($event)"></textarea></label>@if (actionError()) { <p class="action-error">{{ actionError() }}</p> }<button class="link-button danger" type="button" [disabled]="savingAction()" (click)="changeStatus(item,'no-show')">Mark no-show</button>@if (canManageLifecycle()) { <div class="form-grid compact-grid"><label>No-show fee (₹)<input type="number" min="0.01" step="0.01" [ngModel]="noShowFee()" (ngModelChange)="noShowFee.set($event)" /></label><label>Payment-link provider<select [ngModel]="noShowProvider()" (ngModelChange)="noShowProvider.set($event)"><option value="razorpay">Razorpay</option><option value="cashfree">Cashfree</option><option value="phonepe">PhonePe</option></select></label></div><button class="link-button danger" type="button" [disabled]="savingAction()" (click)="chargeNoShow(item)">Mark no-show and charge</button> }</section>
          }
          @if (actionMode()) {
            <section class="action-form">
              <div class="panel-title"><h2>{{ actionMode() === 'reschedule' ? 'Reschedule appointment' : 'Cancel appointment' }}</h2></div>
              @if (actionMode() === 'reschedule') {
                <div class="action-fields"><label>Date<aura-staff-date-picker [value]="actionDate()" [min]="minimumActionDate" ariaLabel="Reschedule date" (valueChange)="actionDate.set($event)" /></label><label>Time<input type="time" [value]="actionTime()" (input)="actionTime.set($any($event.target).value)" /></label></div>
              }
              <label>Reason<textarea rows="3" maxlength="500" [value]="actionReason()" (input)="actionReason.set($any($event.target).value)"></textarea></label>
              @if (actionError()) { <p class="action-error">{{ actionError() }}</p> }
              <div class="drawer-actions"><button class="link-button" type="button" [disabled]="savingAction()" (click)="actionMode.set(null)">Back</button><button class="button" type="button" [disabled]="savingAction()" [attr.aria-busy]="savingAction()" (click)="submitAction(item)">{{ savingAction() ? 'Saving...' : 'Confirm' }}</button></div>
            </section>
          }
        </aside>
      }
    </section>
  `,
  styleUrls: ["./staff-app.styles.css"],
  styles: [`
    .appointment-list-item { border-top: 1px solid var(--staff-border); }
    .appointment-list-item:first-child { border-top: 0; }
    .appointment-list-item > summary { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 10px; min-height: 62px; padding: 8px 0; list-style: none; cursor: pointer; }
    .appointment-list-item > summary::-webkit-details-marker { display: none; }
    .appointment-list-copy { min-width: 0; display: grid; gap: 2px; }
    .appointment-list-copy strong, .appointment-list-copy span, .appointment-list-copy small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .appointment-list-copy strong { color: var(--staff-text); font-size: .86rem; }
    .preferred-client { color: #067647; font-size: .68rem; }
    .appointment-list-copy span { color: var(--staff-text-secondary); font-size: .75rem; font-weight: 650; }
    .appointment-list-copy small { color: var(--staff-text-secondary); font-size: .68rem; font-weight: 600; }
    .appointment-list-meta { display: flex; align-items: center; gap: 6px; }
    .appointment-list-meta .badge { max-width: 78px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .appointment-list-item[open] .expand-indicator::after { transform: none; }
    .appointment-list-expanded { padding: 8px 0 12px; border-top: 1px solid var(--staff-border); }
    .appointment-list-expanded .row-actions { justify-content: flex-start; }
    .drawer-actions { display: flex; gap: 8px; margin-top: 14px; }
    .drawer-actions > * { flex: 1; }
    .danger { color: #b42318; }
    .action-form { display: grid; gap: 12px; margin-top: 14px; padding-top: 14px; border-top: 1px solid var(--staff-border); }
    .action-form label { display: grid; gap: 5px; color: var(--staff-text-secondary); font-size: .72rem; font-weight: 700; }
    .action-fields { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
    .action-form input, .action-form textarea { width: 100%; box-sizing: border-box; border: 1px solid var(--staff-border); border-radius: 7px; background: #fff; color: var(--staff-text); font: inherit; padding: 9px 10px; }
    .action-form textarea { resize: vertical; }
    .action-error { margin: 0; color: #b42318; font-size: .75rem; font-weight: 700; }
    .appointment-skeleton { display: grid; gap: 12px; }
    .appointment-list-skeleton { min-height: 240px; }
    .appointment-error { justify-content: space-between; }
    .history-filters { display: grid; gap: 12px; }
    .shift-timeline { display: grid; gap: 8px; margin-top: 14px; padding-top: 14px; border-top: 1px solid var(--staff-border); }
    .shift-timeline h3 { margin: 0; font-size: .85rem; }
    .shift-timeline div { display: grid; gap: 2px; padding-left: 10px; border-left: 2px solid var(--staff-primary); font-size: .74rem; }
    .shift-timeline span, .shift-timeline small { color: var(--staff-text-secondary); }
    .suitable-staff { display: grid; gap: 8px; margin-top: 14px; padding-top: 14px; border-top: 1px solid var(--staff-border); }
    .suitable-staff h3 { margin: 0; font-size: .85rem; }
    .suitable-staff article { display: grid; gap: 3px; padding: 9px; border: 1px solid var(--staff-border); border-radius: 8px; background: #fff; }
    .suitable-staff article.current-staff { border-color: var(--staff-primary); background: var(--staff-primary-light); }
    .suitable-staff article strong { font-size: .76rem; }
    .suitable-staff article span, .suitable-staff article small, .suitable-staff > small { color: var(--staff-text-secondary); font-size: .7rem; line-height: 1.4; }
    .appointment-empty { display: grid; justify-items: center; gap: 10px; padding: 24px 0; color: var(--staff-text-secondary); font-weight: 600; text-align: center; }
    .appointment-empty p { margin: 0; }
    .appointment-book { display: grid; gap: 12px; }
    .book-toolbar { display: flex; align-items: end; flex-wrap: wrap; gap: 8px; }
    .book-toolbar > label, .booking-form > label, .booking-line label, .new-guest label { display: grid; gap: 5px; color: var(--staff-text-secondary); font-size: .72rem; font-weight: 700; }
    .book-toolbar select, .booking-form input, .booking-form select, .booking-form textarea, .booking-line input, .booking-line select, .new-guest input { min-height: 38px; box-sizing: border-box; border: 1px solid var(--staff-border); border-radius: 7px; background: #fff; color: var(--staff-text); font: inherit; padding: 8px 9px; }
    .view-switch, .inline-field, .booking-steps { display: flex; gap: 6px; }
    .calendar-columns { display: grid; grid-template-columns: repeat(var(--calendar-days), minmax(180px, 1fr)); gap: 8px; overflow-x: auto; }
    .calendar-day { min-width: 0; border: 1px solid var(--staff-border); border-radius: 9px; background: #f8fbff; }
    .calendar-day > header { display: grid; gap: 2px; padding: 9px; border-bottom: 1px solid var(--staff-border); }
    .calendar-day > header small { color: var(--staff-text-secondary); font-size: .67rem; }
    .calendar-item { display: grid; gap: 2px; width: calc(100% - 12px); margin: 6px; padding: 8px; border: 1px solid #c9d8ef; border-radius: 7px; background: #fff; color: var(--staff-text); text-align: left; cursor: pointer; }
    .calendar-item strong { font-size: .74rem; }.calendar-item span, .calendar-item small { color: var(--staff-text-secondary); font-size: .68rem; }
    .calendar-empty { margin: 0; padding: 18px 8px; color: var(--staff-text-secondary); font-size: .7rem; text-align: center; }
    .calendar-blockout { display: grid; gap: 2px; margin: 6px; padding: 7px; border: 1px dashed #d0d5dd; border-radius: 7px; color: var(--staff-text-secondary); font-size: .68rem; }
    .booking-drawer { display: flex; flex-direction: column; gap: 12px; }
    .booking-steps span { flex: 1; padding: 7px; border-bottom: 2px solid var(--staff-border); color: var(--staff-text-secondary); font-size: .72rem; font-weight: 700; text-align: center; }
    .booking-steps span.active { border-color: var(--staff-primary); color: var(--staff-primary); }
    .booking-form, .booking-review, .new-guest { display: grid; gap: 12px; }
    .booking-line { display: grid; gap: 10px; padding: 10px; border: 1px solid var(--staff-border); border-radius: 9px; background: #f8fbff; }
    .booking-line h3 { margin: 0; font-size: .8rem; }
    .addon-list { display: flex; flex-wrap: wrap; gap: 8px; margin: 0; border: 1px solid var(--staff-border); border-radius: 7px; }
    .addon-list legend { color: var(--staff-text-secondary); font-size: .7rem; font-weight: 700; }.addon-list label { display: flex; align-items: center; gap: 5px; }
    .guest-360 { display: grid; gap: 10px; margin-top: 14px; padding-top: 14px; border-top: 1px solid var(--staff-border); }
    .guest-identity { display: grid; grid-template-columns: 52px minmax(0,1fr); align-items: center; gap: 10px; }
    .guest-identity img, .guest-avatar { width: 52px; height: 52px; border: 1px solid var(--staff-border); border-radius: 50%; object-fit: cover; }
    .guest-avatar { display: grid; place-items: center; background: var(--staff-primary-light); color: var(--staff-primary); font-weight: 700; }
    .guest-identity div { display: grid; gap: 2px; min-width: 0; }.guest-identity span, .guest-identity small { overflow: hidden; color: var(--staff-text-secondary); font-size: .7rem; text-overflow: ellipsis; white-space: nowrap; }
    .guest-alerts { display: flex; flex-wrap: wrap; gap: 5px; }.guest-alerts span { padding: 5px 7px; border: 1px solid #f2c7c3; border-radius: 999px; background: #fff3f2; color: #b42318; font-size: .67rem; font-weight: 700; }
    .guest-section { border: 1px solid var(--staff-border); border-radius: 8px; background: #fff; }.guest-section > summary { padding: 10px; color: var(--staff-text); font-size: .78rem; font-weight: 700; cursor: pointer; }.guest-section-body { display: grid; gap: 10px; padding: 0 10px 10px; border-top: 1px solid var(--staff-border); }.guest-section-body > h3 { margin: 10px 0 0; font-size: .76rem; }
    .guest-section .row { align-items: start; }.guest-section .row > div:first-child { display: grid; gap: 2px; min-width: 0; }.guest-section .row small { color: var(--staff-text-secondary); font-size: .68rem; }
    .guest-section input, .guest-section select, .guest-section textarea { width: 100%; min-height: 36px; box-sizing: border-box; border: 1px solid var(--staff-border); border-radius: 7px; background: #fff; color: var(--staff-text); font: inherit; padding: 8px; }.guest-section textarea { resize: vertical; }
    .guest-section label { display: grid; gap: 5px; color: var(--staff-text-secondary); font-size: .7rem; font-weight: 700; }.guest-section .check-label { display: flex; align-items: center; }.guest-section .check-label input { width: auto; min-height: 0; }
    .form-status-list { display: grid; grid-template-columns: repeat(2,minmax(0,1fr)); gap: 6px; margin-top: 10px; }.form-status-list button { display: grid; gap: 2px; text-align: left; }.form-status-list span { color: var(--staff-text-secondary); font-size: .65rem; }
    .guest-form { display: grid; gap: 10px; padding: 10px; border: 1px solid var(--staff-border); border-radius: 8px; background: #f8fbff; }.guest-form h3 { margin: 5px 0 0; font-size: .78rem; }
    .form-table { display: grid; gap: 8px; margin: 0; border: 1px solid var(--staff-border); border-radius: 7px; }.form-table legend { font-size: .7rem; font-weight: 700; }.form-table-row { display: grid; gap: 6px; padding-bottom: 8px; border-bottom: 1px solid var(--staff-border); }
    .submission-row { display: grid; grid-template-columns: minmax(0,1fr) auto; gap: 8px; padding: 8px 0; border-top: 1px solid var(--staff-border); }.submission-row:first-child { border-top: 0; }.submission-row > div { display: grid; gap: 2px; }
    .guest-photo-preview { display: grid; gap: 6px; margin-top: 10px; }.guest-photo-preview img { width: 100%; max-height: 260px; border-radius: 8px; object-fit: contain; background: #f2f4f7; }.photo-list { display: grid; gap: 4px; }.consent-options { display: flex; flex-wrap: wrap; gap: 10px; }
    @media (max-width: 900px) {
      .detail-drawer { top: var(--staff-header-height); padding-bottom: calc(20px + env(safe-area-inset-bottom)); }
    }
    @media (max-width: 700px) {
      .appointment-list-item > summary { grid-template-columns: minmax(0, 1fr); }
      .appointment-list-meta, .appointment-list-expanded .row-actions, .drawer-actions, .appointment-error { align-items: stretch; flex-direction: column; }
      .appointment-list-meta { justify-self: stretch; }
      .appointment-list-meta .badge { max-width: none; width: fit-content; }
      .drawer-actions > *, .appointment-error button { width: 100%; }
      .action-fields { grid-template-columns: 1fr; }
      .calendar-columns { grid-template-columns: repeat(var(--calendar-days), minmax(240px, 1fr)); }
      .book-toolbar > *, .inline-field { width: 100%; }
      .inline-field input { min-width: 0; flex: 1; }
      .form-status-list { grid-template-columns: 1fr; }.submission-row { grid-template-columns: 1fr; }
    }
  `]
})
export class StaffAppointmentsPage implements OnInit, OnDestroy {
  readonly dashboard = signal<StaffDashboard | null>(null);
  readonly activeView = signal<AppointmentView>("today");
  readonly kpiCounts = computed(() => {
    const rows = this.dashboard()?.appointments || [];
    const today = businessDate();
    return {
      today: rows.filter((item) => istDateKey(item.startAt) === today).length,
      live: rows.filter((item) => istDateKey(item.startAt) === today && LIVE_STATUSES.has(this.statusOf(item))).length,
      completed: rows.filter((item) => this.isCompleted(item)).length,
      cancelled: rows.filter((item) => CANCELLED_STATUSES.has(this.statusOf(item))).length
    };
  });
  readonly visibleAppointments = computed(() => {
    const today = businessDate();
    const view = this.activeView();
    if (view === "all") return this.history()?.appointments || [];
    const rows = (this.dashboard()?.appointments || []).filter((item) => {
      const date = istDateKey(item.startAt);
      const status = this.statusOf(item);
      switch (view) {
        case "today": return date === today;
        case "upcoming": return date > today && !TERMINAL_STATUSES.has(status);
        case "live": return date === today && LIVE_STATUSES.has(status);
        case "completed": return this.isCompleted(item);
        case "cancelled": return CANCELLED_STATUSES.has(status);
        case "shifted": return item.rescheduleCount > 0;
      }
    });
    const ascending = view === "today" || view === "live" || view === "upcoming";
    return rows.sort((left, right) => this.compareStartTimes(left, right, ascending));
  });
  readonly loading = signal(false);
  readonly history = signal<StaffBusiness | null>(null);
  readonly historyLoading = signal(false);
  readonly historyError = signal("");
  readonly historyFrom = signal("");
  readonly historyTo = signal("");
  readonly historyClient = signal("");
  readonly historyStatus = signal("all");
  readonly historyServiceId = signal("");
  readonly historyDepartment = signal("");
  readonly historyDepartments = computed(() => [...new Set((this.history()?.services || []).map((service) => service.category).filter(Boolean))].sort());
  readonly selectedAppointment = signal<StaffAppointment | null>(null);
  readonly guest360 = signal<StaffGuest360 | null>(null);
  readonly guestLoading = signal(false);
  readonly guestError = signal("");
  readonly guestSaving = signal(false);
  readonly guestNoteType = signal("general");
  readonly guestNoteVisibility = signal("assigned_staff");
  readonly guestNote = signal("");
  readonly guestAllergies = signal("");
  readonly guestPreferences = signal("");
  readonly guestFormId = signal("");
  readonly guestFormResponses = signal<Record<string, unknown>>({});
  readonly guestFormSubmission = signal<StaffGuestFormSubmission | null>(null);
  readonly guestFormMode = signal<"staff" | "guest">("staff");
  readonly guestSignatureName = signal("");
  readonly guestFormConsent = signal(false);
  readonly guestCorrectionId = signal("");
  readonly guestCorrectionReason = signal("");
  readonly guestReviewNote = signal("");
  readonly guestPhotoFile = signal<File | null>(null);
  readonly guestPhotoType = signal("before");
  readonly guestPhotoCaption = signal("");
  readonly guestPhotoServiceId = signal("");
  readonly guestPhotoConsent = signal(false);
  readonly guestPhotoConsentReason = signal("");
  readonly guestPhotoUrl = signal("");
  readonly guestPhotoViewedId = signal("");
  readonly guestPreferredChannel = signal("none");
  readonly guestWhatsappOptIn = signal(false);
  readonly guestSmsOptIn = signal(false);
  readonly guestEmailOptIn = signal(false);
  readonly guestPreferenceReason = signal("");
  readonly actionMode = signal<"reschedule" | "cancel" | null>(null);
  readonly actionDate = signal("");
  readonly actionTime = signal("");
  readonly actionReason = signal("");
  readonly actionError = signal("");
  readonly actionMessage = signal("");
  readonly recommendations = signal<StaffRecommendation[]>([]);
  readonly recommendationLoading = signal(false);
  readonly recommendationError = signal("");
  readonly loadError = signal("");
  readonly savingAction = signal(false);
  readonly minimumActionDate = businessDate();
  readonly book = signal<StaffAppointmentBook | null>(null);
  readonly bookLoading = signal(false);
  readonly bookError = signal("");
  readonly calendarView = signal<CalendarView>("own");
  readonly calendarSpan = signal<1 | 3 | 7>(1);
  readonly calendarDate = signal(businessDate());
  readonly calendarStaffId = signal("");
  readonly calendarResourceId = signal("");
  readonly calendarStatus = signal("");
  readonly calendarDays = computed(() => Array.from({ length: this.calendarView() === "own" ? this.calendarSpan() : 1 }, (_, index) => businessDateOffset(index, this.calendarDate())));
  readonly calendarAppointments = computed(() => {
    const resourceId = this.calendarResourceId();
    return (this.book()?.appointments || []).filter((item) => !resourceId || item.chairRoomId === resourceId);
  });
  readonly bookingOpen = signal(false);
  readonly bookingStep = signal<1 | 2>(1);
  readonly bookingClientId = signal("");
  readonly bookingClientQuery = signal("");
  readonly bookingLines = signal<BookingLineDraft[]>([]);
  readonly bookingRemovedIds = signal<string[]>([]);
  readonly bookingNotes = signal("");
  readonly bookingType = signal("standard");
  readonly bookingPackageId = signal("");
  readonly bookingGroupName = signal("");
  readonly bookingGroupNotes = signal("");
  readonly recurrenceCount = signal(1);
  readonly recurrenceDays = signal(7);
  readonly surpriseVisit = signal(false);
  readonly virtualMeetingUrl = signal("");
  readonly bookingQuote = signal<StaffAppointmentQuote | null>(null);
  readonly bookingError = signal("");
  readonly bookingSaving = signal(false);
  readonly newGuestOpen = signal(false);
  readonly newGuest = signal({ firstName: "", lastName: "", phone: "", email: "" });
  readonly statusReason = signal("");
  readonly noShowFee = signal("");
  readonly noShowProvider = signal("razorpay");
  readonly operationContext = signal<StaffAppointmentOperations | null>(null);
  readonly operationLoading = signal(false);
  readonly operationReason = signal("");
  readonly handoffStaffId = signal("");
  readonly serviceWorkspace = signal<StaffServiceWorkspace | null>(null);
  readonly serviceWorkspaceLoading = signal(false);
  readonly serviceWorkspaceError = signal("");
  readonly serviceWorkspaceSaving = signal(false);
  readonly selectedRecipe = signal<StaffServiceRecipeLine | null>(null);
  readonly actualUsage = signal("");
  readonly wastedUsage = signal("");
  readonly selectedBatchId = signal("");
  readonly usageReason = signal("");
  readonly retailQuery = signal("");
  readonly retailBarcode = signal("");
  readonly retailQuantity = signal("1");
  readonly retailPrice = signal("");
  readonly retailPriceReason = signal("");
  readonly handoffNote = signal("");
  readonly checkout = signal<StaffPosCheckout | null>(null);
  readonly checkoutLoading = signal(false);
  readonly checkoutSaving = signal(false);
  readonly checkoutError = signal("");
  readonly checkoutDiscount = signal("");
  readonly checkoutDiscountReason = signal("");
  readonly checkoutCoupon = signal("");
  readonly checkoutTip = signal("");
  readonly checkoutTipSplits = signal<Array<{ staffId: string; amount: string }>>([]);
  readonly checkoutRound = signal(false);
  readonly packageCreditId = signal("");
  readonly membershipCreditId = signal("");
  readonly benefitQuantity = signal("1");
  readonly paymentMethod = signal("cash");
  readonly paymentAmount = signal("");
  readonly paymentReference = signal("");
  readonly paymentTillId = signal("");
  readonly paymentProvider = signal("");
  readonly providerPaymentToken = signal("");
  readonly providerCustomerToken = signal("");
  readonly storePaymentMethod = signal(false);
  readonly savedInstrumentId = signal("");
  readonly upiProvider = signal("razorpay");
  readonly upiUrl = signal("");
  readonly lifecycleReason = signal("");
  readonly refundAmount = signal("");
  readonly lifecycleMfa = signal("");
  readonly giftCardCode = signal("");
  readonly giftCardAmount = signal("");
  readonly blockoutOpen = signal(false);
  readonly blockoutDate = signal(businessDate());
  readonly blockoutFrom = signal("09:00");
  readonly blockoutTo = signal("10:00");
  readonly blockoutReason = signal("");
  readonly convertingWaitlistId = signal("");
  private bookingMutationKey = "";
  private loadGeneration = 0;
  readonly displayBusinessDate = displayBusinessDate;
  readonly parseDisplayBusinessDate = parseDisplayBusinessDate;

  constructor(readonly staff: StaffAppService) {}

  ngOnInit() { void this.load(); }
  ngOnDestroy() { this.clearGuestPhotoUrl(); }

  @HostListener("window:aura:appointments-updated")
  onAppointmentsUpdated() { void this.load(); }

  setView(view: AppointmentView) { if (view === "all" && !this.canViewAllHistory()) return; this.activeView.set(view); this.actionMessage.set(""); if (view === "all" && !this.history()) void this.loadHistory(true); }

  viewTitle(): string {
    return ({ today: "Today's Queue", upcoming: "Upcoming appointments", live: "Live appointments", completed: "Completed appointments", cancelled: "Cancelled appointments", shifted: "Shifted appointments", all: "Complete appointment history" } as const)[this.activeView()];
  }

  emptyMessage(): string {
    return ({ today: "No appointments in today's queue.", upcoming: "No upcoming appointments assigned to you.", live: "No live appointments right now.", completed: "No completed appointments in the loaded range.", cancelled: "No cancelled appointments in the loaded range.", shifted: "No shifted appointments in the loaded range.", all: "No appointment history matches these filters." } as const)[this.activeView()];
  }

  isValidDate(value: string): boolean { return !Number.isNaN(new Date(value).getTime()); }

  async load() {
    const generation = ++this.loadGeneration;
    this.loading.set(true);
    this.loadError.set("");
    try {
      const today = businessDate();
      const osRequest = this.staff.enterpriseOs({ from: businessDateOffset(-30, today), to: businessDateOffset(32, today) }, false).catch(() => null);
      const dashboard = await this.staff.dashboard({ date: today });
      if (generation !== this.loadGeneration) return;
      this.dashboard.set(dashboard);
      const os = await osRequest;
      if (!os || generation !== this.loadGeneration) return;
      const current = new Map(dashboard.appointments.map((item) => [item.id, item]));
      const appointments = os.timeline.map((item) => ({
        ...(current.get(item.id) || {}), id: item.id, staffId: current.get(item.id)?.staffId || this.staff.user()?.staffId || "",
        branchId: current.get(item.id)?.branchId || this.staff.user()?.branchId || "", serviceIds: current.get(item.id)?.serviceIds || [],
        serviceNames: item.serviceNames || [], durationMinutes: item.durationMinutes || 0, value: current.get(item.id)?.value || 0,
        startAt: item.startAt, endAt: item.endAt, status: item.status, chair: item.chair || current.get(item.id)?.chair || "", source: current.get(item.id)?.source || "",
        clientId: current.get(item.id)?.clientId || "", clientName: item.clientName || current.get(item.id)?.clientName || "", preferredClient: item.preferredClient || current.get(item.id)?.preferredClient || false,
        rescheduleCount: item.rescheduleCount || current.get(item.id)?.rescheduleCount || 0,
        rescheduleTimeline: item.rescheduleTimeline || current.get(item.id)?.rescheduleTimeline || [], serviceDepartments: item.serviceDepartments || current.get(item.id)?.serviceDepartments || [], lastServiceAt: item.lastServiceAt || current.get(item.id)?.lastServiceAt || "",
        lastServiceNames: item.lastServiceNames || current.get(item.id)?.lastServiceNames || [], lastServiceDepartments: item.lastServiceDepartments || current.get(item.id)?.lastServiceDepartments || []
      } satisfies StaffAppointment));
      this.dashboard.set({ ...dashboard, appointments });
      await this.loadBook(true);
    } catch {
      if (generation === this.loadGeneration) this.loadError.set(this.staff.error() || "Unable to load appointments.");
    } finally { if (generation === this.loadGeneration) this.loading.set(false); }
  }

  async loadHistory(reset: boolean) {
    const from = parseDisplayBusinessDate(this.historyFrom());
    const to = parseDisplayBusinessDate(this.historyTo());
    if ((this.historyFrom() && !from) || (this.historyTo() && !to) || Boolean(from) !== Boolean(to) || (from && to && from > to)) {
      this.historyError.set("Choose both valid history dates, with From on or before To.");
      return;
    }
    const current = this.history();
    const page = reset ? 1 : Number(current?.pagination.page || 1) + 1;
    this.historyLoading.set(true); this.historyError.set("");
    try {
      const data = await this.staff.business({ from: from || undefined, to: to || undefined, allHistory: !from && !to, page, pageSize: 25, q: this.historyClient().trim(), status: this.historyStatus(), serviceId: this.historyServiceId(), department: this.historyDepartment(), sort: "desc" });
      if (reset || !current) this.history.set(data);
      else {
        const appointments = new Map([...current.appointments, ...data.appointments].map((item) => [item.id, item]));
        this.history.set({ ...data, appointments: [...appointments.values()] });
      }
    } catch { this.historyError.set(this.staff.error() || "Unable to load appointment history."); }
    finally { this.historyLoading.set(false); }
  }

  clearHistoryFilters() {
    this.historyFrom.set(""); this.historyTo.set(""); this.historyClient.set(""); this.historyStatus.set("all"); this.historyServiceId.set(""); this.historyDepartment.set("");
    void this.loadHistory(true);
  }

  async loadBook(reportError = true) {
    this.bookLoading.set(true); if (reportError) this.bookError.set("");
    try {
      const view = this.calendarView();
      const to = view === "own" ? businessDateOffset(this.calendarSpan() - 1, this.calendarDate()) : this.calendarDate();
      this.book.set(await this.staff.appointmentBook({
        from: this.calendarDate(), to, view,
        status: this.calendarStatus(), staffId: view === "staff" ? this.calendarStaffId() : "",
        q: this.bookingClientQuery().trim()
      }));
    } catch { if (reportError) this.bookError.set(this.staff.error() || "Unable to load Appointment Book."); }
    finally { this.bookLoading.set(false); }
  }

  setCalendarView(view: CalendarView) {
    if (view !== "own" && !this.book()?.permissions.teamRead) return;
    this.calendarView.set(view); if (view !== "own") this.calendarSpan.set(1); void this.loadBook();
  }
  setCalendarSpan(span: number) { this.calendarSpan.set(span === 7 ? 7 : span === 3 ? 3 : 1); void this.loadBook(); }
  moveCalendar(days: number) { this.calendarDate.set(businessDateOffset(days, this.calendarDate())); void this.loadBook(); }
  setCalendarDate(value: string) { const parsed = parseDisplayBusinessDate(value); if (parsed) { this.calendarDate.set(parsed); void this.loadBook(); } }
  appointmentsForDay(date: string): StaffAppointment[] { return this.calendarAppointments().filter((item) => istDateKey(item.startAt) === date); }
  scheduleLabel(date: string): string {
    const entries = this.book()?.schedules || [];
    const row = entries.find((value) => String(value["scheduleDate"] ?? value["schedule_date"] ?? "") === date);
    if (!row) return "Non-working / no shift";
    return [row["shift1Start"] ?? row["shift1_start"], row["shift1End"] ?? row["shift1_end"]].filter(Boolean).join(" - ") || String(row["status"] || "Scheduled");
  }
  blockoutsForDay(date: string): Array<Record<string, unknown>> { return (this.book()?.blockouts || []).filter((row) => istDateKey(String(row["startsAt"] ?? row["starts_at"] ?? "")) === date); }
  blockoutLabel(row: Record<string, unknown>): string {
    const start = new Date(String(row["startsAt"] ?? row["starts_at"] ?? "")); const end = new Date(String(row["endsAt"] ?? row["ends_at"] ?? ""));
    const time = (value: Date) => Number.isNaN(value.getTime()) ? "" : value.toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit" });
    const provider = this.book()?.staff.find((staff) => staff.id === String(row["staffId"] ?? row["staff_id"] ?? ""))?.name || "";
    return [provider, `${time(start)}-${time(end)}`, String(row["reason"] || "")].filter(Boolean).join(" · ");
  }

  openCreateBooking() {
    if (!this.book()?.permissions.manage) return;
    this.selectedAppointment.set(null); this.bookingClientId.set(""); this.bookingClientQuery.set("");
    this.bookingNotes.set(""); this.bookingQuote.set(null); this.bookingError.set(""); this.bookingStep.set(1);
    this.bookingType.set("standard"); this.bookingPackageId.set(""); this.bookingGroupName.set(""); this.bookingGroupNotes.set("");
    this.recurrenceCount.set(1); this.recurrenceDays.set(7); this.surpriseVisit.set(false); this.virtualMeetingUrl.set(""); this.convertingWaitlistId.set("");
    this.bookingLines.set([this.blankBookingLine()]); this.bookingRemovedIds.set([]); this.newGuest.set({ firstName: "", lastName: "", phone: "", email: "" }); this.bookingMutationKey = this.newBookingKey(); this.bookingOpen.set(true);
  }
  openEditBooking(item: StaffAppointment) {
    if (!this.canManageAppointment(item)) return;
    this.selectedAppointment.set(null); this.bookingClientId.set(item.clientId || ""); this.bookingNotes.set(item.notes || "");
    const group = item.bookingGroupId ? (this.book()?.appointments || []).filter((row) => row.bookingGroupId === item.bookingGroupId) : [item];
    this.bookingLines.set(group.map((row) => {
      const when = istDateTimeInput(row.startAt); const serviceId = row.serviceIds[0] || ""; const selection = row.serviceSelections?.[serviceId] || {};
      return { appointmentId: row.id, version: row.version || 0, clientId: row.clientId || "", serviceId, staffId: row.staffId, preference: row.staffPreference || "any",
        resourceId: row.chairRoomId || "", date: when.date, time: when.time, duration: row.durationMinutes || 45,
        variantId: selection.variantId || "", addonIds: selection.addonIds || [], priceOverride: "", priceReason: "", serviceMode: row.serviceMode || "sequential", segmentLabel: row.segmentLabel || "" };
    }));
    this.bookingType.set(item.bookingType || "standard"); this.bookingPackageId.set(item.dayPackageId || ""); this.bookingGroupName.set(item.groupName || ""); this.bookingGroupNotes.set(item.groupNotes || "");
    this.surpriseVisit.set(Boolean(item.surprise)); this.virtualMeetingUrl.set(item.virtualMeetingUrl || ""); this.recurrenceCount.set(1); this.convertingWaitlistId.set("");
    this.bookingRemovedIds.set([]); this.bookingQuote.set(null); this.bookingError.set(""); this.bookingStep.set(1); this.bookingMutationKey = this.newBookingKey(); this.bookingOpen.set(true);
  }
  closeBooking() { if (this.bookingSaving()) return; this.bookingOpen.set(false); this.newGuestOpen.set(false); this.bookingError.set(""); }
  addBookingLine() { this.bookingLines.update((rows) => [...rows, this.blankBookingLine()]); this.bookingQuote.set(null); }
  removeBookingLine(index: number) {
    if (this.bookingLines().length <= 1) return;
    const removed = this.bookingLines()[index]; if (removed.appointmentId) this.bookingRemovedIds.update((ids) => [...ids, removed.appointmentId]);
    this.bookingLines.update((rows) => rows.filter((_, rowIndex) => rowIndex !== index)); this.bookingQuote.set(null);
  }
  updateBookingLine(index: number, patch: Partial<BookingLineDraft>) {
    this.bookingLines.update((rows) => rows.map((row, rowIndex) => rowIndex === index ? { ...row, ...patch } : row)); this.bookingQuote.set(null);
  }
  chooseService(index: number, serviceId: string) {
    const service = this.book()?.services.find((item) => item.id === serviceId);
    this.updateBookingLine(index, { serviceId, duration: service?.durationMinutes || 45, variantId: "", addonIds: [] });
  }
  serviceFor(id: string) { return this.book()?.services.find((service) => service.id === id); }
  recordId(value: Record<string, unknown>): string { return String(value["id"] || value["addonId"] || value["variantId"] || ""); }
  recordName(value: Record<string, unknown>): string { return String(value["name"] || value["label"] || value["id"] || "Option"); }
  recordText(value: Record<string, unknown>, key: string): string { return String(value[key] ?? ""); }
  recordArray(value: Record<string, unknown>, key: string): string[] { return Array.isArray(value[key]) ? (value[key] as unknown[]).map(String) : []; }
  benefitsLabel(value: unknown): string { const count = Array.isArray(value) ? value.length : value && typeof value === "object" ? Object.keys(value).length : 0; return count ? `${count} available` : "No credits"; }
  updateNewGuest(field: "firstName" | "lastName" | "phone" | "email", value: string) { this.newGuest.update((guest) => ({ ...guest, [field]: value })); }
  toggleAddon(index: number, addonId: string, checked: boolean) {
    const line = this.bookingLines()[index];
    this.updateBookingLine(index, { addonIds: checked ? [...new Set([...line.addonIds, addonId])] : line.addonIds.filter((id) => id !== addonId) });
  }
  async searchGuests() { await this.loadBook(); }
  applyDayPackage(packageId: string) {
    this.bookingPackageId.set(packageId); this.bookingType.set("day_package");
    const item = this.book()?.packages.find((value) => value.id === packageId); if (!item) return;
    this.bookingLines.set(item.serviceIds.map((serviceId, index) => ({ ...this.blankBookingLine(), serviceId, duration: this.serviceFor(serviceId)?.durationMinutes || 45, sequenceNo: index + 1 } as BookingLineDraft)));
    this.bookingQuote.set(null);
  }
  openWaitlist(entry: Record<string, unknown>) {
    this.openCreateBooking(); const clientId = this.recordText(entry, "clientId"); const preferred = this.recordText(entry, "preferredStaffId");
    const slot = istDateTimeInput(this.recordText(entry, "preferredSlotAt")); const services = this.recordArray(entry, "serviceIds");
    this.bookingClientId.set(clientId); this.convertingWaitlistId.set(this.recordText(entry, "id")); this.bookingNotes.set(this.recordText(entry, "notes"));
    this.bookingLines.set((services.length ? services : [""]).map((serviceId) => ({ ...this.blankBookingLine(), clientId, serviceId, staffId: preferred || this.book()?.selfStaffId || "", date: slot.date || this.calendarDate(), time: slot.time || "09:00", duration: this.serviceFor(serviceId)?.durationMinutes || 45 })));
  }
  async createGuest() {
    const value = this.newGuest();
    if (!value.firstName.trim() || (!value.phone.trim() && !value.email.trim())) { this.bookingError.set("Guest first name and phone or email are required."); return; }
    this.bookingSaving.set(true); this.bookingError.set("");
    try {
      const saved = await this.staff.createAppointmentClient({ firstName: value.firstName.trim(), lastName: value.lastName.trim(), phone: value.phone.trim(), email: value.email.trim() });
      await this.loadBook(false); this.book.update((book) => book ? { ...book, clients: [saved, ...book.clients.filter((client) => client.id !== saved.id)] } : book); this.bookingClientId.set(saved.id); this.newGuestOpen.set(false);
    } catch { this.bookingError.set(this.staff.error() || "Unable to create guest."); }
    finally { this.bookingSaving.set(false); }
  }
  async reviewBooking() {
    const clients = new Set(this.bookingLines().map((line) => line.clientId || this.bookingClientId()).filter(Boolean));
    const groupShapeValid = this.bookingType() === "couple" ? clients.size === 2 : this.bookingType() === "group" ? clients.size >= 2 && clients.size <= 6 : this.bookingType() === "large_group" ? clients.size >= 7 && clients.size <= 30 : clients.size === 1;
    if (!this.bookingClientId() || !groupShapeValid || this.bookingLines().some((line) => !line.serviceId || !line.staffId || !line.date || !line.time || !Number.isFinite(line.duration) || line.duration < 5 || line.duration > 1440 || (line.serviceMode === "segmented" && !line.segmentLabel.trim()))) {
      this.bookingError.set("Choose a guest, service, provider, date, time, and duration for every line."); return;
    }
    if (this.virtualMeetingUrl() && !/^https?:\/\/[^\s]+$/i.test(this.virtualMeetingUrl()) || this.recurrenceCount() < 1 || this.recurrenceCount() > 52 || this.recurrenceDays() < 1 || this.recurrenceDays() > 365) { this.bookingError.set("Virtual link or recurrence is invalid."); return; }
    if (this.bookingLines().some((line) => line.priceOverride !== "" && (!Number.isFinite(Number(line.priceOverride)) || Number(line.priceOverride) < 0 || Number(line.priceOverride) > 1_000_000 || line.priceReason.trim().length < 3))) {
      this.bookingError.set("Price override requires a valid amount and a reason of at least 3 characters."); return;
    }
    this.bookingSaving.set(true); this.bookingError.set("");
    try { this.bookingQuote.set(await this.staff.quoteAppointment(this.bookingPayload())); this.bookingStep.set(2); }
    catch { this.bookingError.set(this.staff.error() || "Availability or price validation failed."); }
    finally { this.bookingSaving.set(false); }
  }
  async saveBooking() {
    if (!this.bookingQuote()) { await this.reviewBooking(); if (!this.bookingQuote()) return; }
    this.bookingSaving.set(true); this.bookingError.set("");
    try {
      const payload = { ...this.bookingPayload(), idempotency_key: this.bookingMutationKey };
      if (this.convertingWaitlistId()) await this.staff.convertWaitlist(this.convertingWaitlistId(), payload);
      else await this.staff.saveAppointmentBooking(payload);
      this.actionMessage.set("Appointment saved."); this.bookingOpen.set(false); await this.load();
    } catch { this.bookingError.set(this.staff.error() || "Unable to save appointment. You can retry safely."); }
    finally { this.bookingSaving.set(false); }
  }
  async changeStatus(item: StaffAppointment, status: "confirmed" | "arrived" | "no-show") {
    if (status === "no-show" && this.statusReason().trim().length < 3) { this.actionError.set("Enter a no-show reason of at least 3 characters."); return; }
    this.savingAction.set(true); this.actionError.set("");
    try { await this.staff.setAppointmentStatus(item.id, status, this.statusReason().trim()); this.actionMessage.set(`Appointment ${status}.`); this.closeDrawers(); await this.load(); }
    catch { this.actionError.set(this.staff.error() || "Unable to update appointment status."); }
    finally { this.savingAction.set(false); }
  }

  canManageLifecycle(): boolean { const role=(this.staff.user()?.role || "").toLowerCase(); return ["owner","admin"].includes(role) || this.staff.hasPermission("staff.app.pos.lifecycle.manage"); }

  async chargeNoShow(item: StaffAppointment) {
    const amount=this.moneyPaise(this.noShowFee(),false); if (this.statusReason().trim().length < 3 || amount === null || amount < 1) { this.actionError.set("Enter a no-show reason and valid fee."); return; }
    if (!globalThis.confirm("Mark this appointment no-show and create the fee collection?")) return;
    this.savingAction.set(true); this.actionError.set("");
    try { await this.staff.chargeAppointmentNoShow(item.id,amount,this.noShowProvider(),this.newBookingKey(),this.statusReason().trim()); this.actionMessage.set("No-show fee created with duplicate-charge protection."); this.closeDrawers(); await this.load(); }
    catch { this.actionError.set(this.staff.error() || "Unable to create no-show fee."); }
    finally { this.savingAction.set(false); }
  }

  async createBlockout() {
    if (this.blockoutReason().trim().length < 3) { this.bookError.set("Block-time reason must be at least 3 characters."); return; }
    const startsAt = new Date(`${this.blockoutDate()}T${this.blockoutFrom()}:00+05:30`); const endsAt = new Date(`${this.blockoutDate()}T${this.blockoutTo()}:00+05:30`);
    if (Number.isNaN(startsAt.getTime()) || endsAt <= startsAt) { this.bookError.set("Choose a valid block-time range."); return; }
    this.savingAction.set(true); try { await this.staff.createScheduleBlockout({ startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString(), reason: this.blockoutReason().trim() }); this.blockoutOpen.set(false); this.actionMessage.set("Block time saved."); await this.loadBook(); }
    catch { this.bookError.set(this.staff.error() || "Unable to save block time."); } finally { this.savingAction.set(false); }
  }

  async decideOnlineRequest(request: Record<string, unknown>, decision: "approved" | "rejected") {
    const reason = globalThis.prompt(`${decision === "approved" ? "Approval" : "Rejection"} reason`); if (!reason || reason.trim().length < 3) return;
    this.savingAction.set(true); try { await this.staff.decideOnlineBookingRequest(this.recordText(request,"id"),decision,reason.trim()); this.actionMessage.set(`Online request ${decision}.`); await this.load(); }
    catch { this.bookError.set(this.staff.error() || "Unable to decide online request."); } finally { this.savingAction.set(false); }
  }

  async runOperation(item: StaffAppointment, action: string, applyGroup = false) {
    const reason = this.operationReason().trim(); if (action === "handoff" && (!this.handoffStaffId() || reason.length < 3)) { this.actionError.set("Choose a handoff provider and enter a reason."); return; }
    this.savingAction.set(true); this.actionError.set("");
    try { await this.staff.runAppointmentOperation(item.id,action,{ reason, handoffStaffId:this.handoffStaffId(), applyGroup }); this.actionMessage.set(action === "checkout" ? "Appointment is checkout-ready." : "Appointment updated."); await this.load(); if (action !== "checkout") await this.openAppointmentById(item.id); else this.closeDrawers(); }
    catch { this.actionError.set(this.staff.error() || "Unable to update appointment operation."); } finally { this.savingAction.set(false); }
  }

  rebook(item: StaffAppointment, sameProvider: boolean) {
    this.openCreateBooking(); this.bookingClientId.set(item.clientId || "");
    const start = new Date(); start.setDate(start.getDate()+7); const date=istDateTimeInput(start.toISOString());
    this.bookingLines.set(item.serviceIds.map((serviceId) => ({ ...this.blankBookingLine(), clientId:item.clientId || "", serviceId, staffId:sameProvider ? item.staffId : "", date:date.date, time:date.time, duration:this.serviceFor(serviceId)?.durationMinutes || item.durationMinutes || 45 })));
  }

  private async openAppointmentById(id: string) {
    const item=(this.book()?.appointments || []).find((value)=>value.id===id) || (this.dashboard()?.appointments || []).find((value)=>value.id===id); if (item) this.openAppointment(item);
  }

  private blankBookingLine(): BookingLineDraft {
    return { appointmentId: "", version: 0, clientId: this.bookingClientId(), serviceId: "", staffId: this.book()?.selfStaffId || "", preference: "any", resourceId: "",
      date: this.calendarDate(), time: "09:00", duration: 45, variantId: "", addonIds: [], priceOverride: "", priceReason: "", serviceMode: "sequential", segmentLabel: "" };
  }
  private bookingPayload(): Record<string, unknown> {
    return {
      client_id: this.bookingClientId(), status: "booked", removed_appointment_ids: this.bookingRemovedIds(), notes: this.bookingNotes(),
      booking_type: this.bookingType(), day_package_id: this.bookingPackageId(), host_client_id: this.bookingClientId(), group_name: this.bookingGroupName().trim(), group_notes: this.bookingGroupNotes().trim(),
      is_surprise: this.surpriseVisit(), virtual_meeting_url: this.virtualMeetingUrl().trim(), recurrence_count: this.recurrenceCount(), recurrence_interval_days: this.recurrenceDays(),
      lines: this.bookingLines().map((line, index) => {
        const start = new Date(`${line.date}T${line.time}:00+05:30`);
        return { appointment_id: line.appointmentId, expected_version: line.version || undefined, client_id: line.clientId || this.bookingClientId(), staff_id: line.staffId,
          requested_staff_id: line.preference === "any" ? "" : line.staffId, staff_preference: line.preference, service_id: line.serviceId,
          start_at: start.toISOString(), end_at: new Date(start.getTime() + line.duration * 60_000).toISOString(), chair_room_id: line.resourceId,
          notes: this.bookingNotes(), variant_id: line.variantId, addon_ids: line.addonIds, service_mode: line.serviceMode, segment_label: line.segmentLabel.trim(), sequence_no: index + 1,
          price_override_paise: line.priceOverride === "" ? undefined : Math.round(Number(line.priceOverride) * 100), price_override_reason: line.priceReason.trim() };
      })
    };
  }
  private newBookingKey(): string { return globalThis.crypto?.randomUUID?.() || `staff-app:${Date.now()}:${Math.random().toString(36).slice(2)}`; }

  canSeeRevenue(): boolean { return this.staff.hasAnyPermission(["staff.app.business.service_amount.read", "read:finance", "read:sales", "read:payments", "read:invoices"]); }
  canViewAllHistory(): boolean { return this.staff.hasPermission("staff.app.business.read"); }
  canManageAppointment(item: StaffAppointment): boolean {
    const book = this.book();
    return Boolean(book?.permissions.manage && (item.staffId === book.selfStaffId || book.permissions.teamManage) && !TERMINAL_STATUSES.has(this.statusOf(item)));
  }
  openAppointment(item: StaffAppointment) {
    this.actionMode.set(null); this.actionMessage.set(""); this.selectedAppointment.set(item);
    this.resetGuest360(); void this.loadGuest360(item.id);
    this.resetServiceWorkspace(); void this.loadServiceWorkspace(item.id);
    this.resetCheckout();
    this.operationContext.set(null); this.operationLoading.set(true); this.operationReason.set(""); this.handoffStaffId.set("");
    void this.staff.appointmentOperations(item.id)
      .then((context) => { if (this.selectedAppointment()?.id === item.id) { this.operationContext.set(context); this.selectedAppointment.set({ ...item, ...context.appointment }); } })
      .catch(() => { if (this.selectedAppointment()?.id === item.id) this.actionError.set(this.staff.error() || "Unable to load visit operations."); })
      .finally(() => { if (this.selectedAppointment()?.id === item.id) this.operationLoading.set(false); });
    this.recommendations.set([]); this.recommendationError.set(""); this.recommendationLoading.set(true);
    void this.staff.appointmentRecommendations(item.id)
      .then((rows) => { if (this.selectedAppointment()?.id === item.id) this.recommendations.set(rows); })
      .catch(() => { if (this.selectedAppointment()?.id === item.id) this.recommendationError.set(this.staff.error() || "Unable to load staff recommendations."); })
      .finally(() => { if (this.selectedAppointment()?.id === item.id) this.recommendationLoading.set(false); });
  }
  closeDrawers() { this.actionMode.set(null); this.statusReason.set(""); this.noShowFee.set(""); this.selectedAppointment.set(null); this.recommendations.set([]); this.recommendationError.set(""); this.operationContext.set(null); this.operationReason.set(""); this.handoffStaffId.set(""); this.resetServiceWorkspace(); this.resetCheckout(); this.resetGuest360(); }

  private resetServiceWorkspace() {
    this.serviceWorkspace.set(null); this.serviceWorkspaceError.set(""); this.selectedRecipe.set(null); this.actualUsage.set(""); this.wastedUsage.set(""); this.selectedBatchId.set(""); this.usageReason.set(""); this.retailQuery.set(""); this.retailBarcode.set(""); this.retailQuantity.set("1"); this.retailPrice.set(""); this.retailPriceReason.set(""); this.handoffNote.set("");
  }

  private resetCheckout() {
    this.checkout.set(null); this.checkoutError.set(""); this.checkoutDiscount.set(""); this.checkoutDiscountReason.set(""); this.checkoutCoupon.set(""); this.checkoutTip.set(""); this.checkoutTipSplits.set([]); this.checkoutRound.set(false); this.packageCreditId.set(""); this.membershipCreditId.set(""); this.benefitQuantity.set("1"); this.paymentMethod.set("cash"); this.paymentAmount.set(""); this.paymentReference.set(""); this.paymentTillId.set(""); this.paymentProvider.set(""); this.providerPaymentToken.set(""); this.providerCustomerToken.set(""); this.storePaymentMethod.set(false); this.savedInstrumentId.set(""); this.upiUrl.set(""); this.lifecycleReason.set(""); this.refundAmount.set(""); this.lifecycleMfa.set(""); this.giftCardCode.set(""); this.giftCardAmount.set("");
  }

  async loadCheckout(appointmentId = this.selectedAppointment()?.id || "") {
    if (!appointmentId) return;
    this.checkoutLoading.set(true); this.checkoutError.set("");
    try {
      const value = await this.staff.appointmentCheckout(appointmentId);
      if (this.selectedAppointment()?.id !== appointmentId) return;
      this.checkout.set(value); this.checkoutDiscount.set(String(value.checkout.sale.billDiscountPaise / 100 || "")); this.checkoutCoupon.set(value.checkout.sale.couponCode || ""); this.checkoutTip.set(String(value.checkout.sale.tipPaise / 100 || "")); this.checkoutTipSplits.set(value.tipSplits.map((split)=>({ staffId:split.staffId,amount:String(split.amountPaise / 100) }))); this.paymentAmount.set(String(value.checkout.sale.balanceDuePaise / 100 || "")); this.paymentProvider.set(value.providers[0] || "");
    } catch { if (this.selectedAppointment()?.id === appointmentId) this.checkoutError.set(this.staff.error() || "Unable to load checkout."); }
    finally { if (this.selectedAppointment()?.id === appointmentId) this.checkoutLoading.set(false); }
  }

  allowedPaymentMethods(value: StaffPosCheckout) {
    const configured=value.paymentMethods.filter((method)=>!matchesSecureMethod(method.code));
    return configured.length ? configured : [{ id:"cash",code:"cash",name:"Cash",referenceRequired:false },{ id:"bank",code:"bank_transfer",name:"Bank transfer",referenceRequired:true }];
  }

  async saveCheckout(appointmentId: string) {
    const discount=this.moneyPaise(this.checkoutDiscount()), tip=this.moneyPaise(this.checkoutTip()), quantity=Number(this.benefitQuantity());
    if (discount === null || tip === null || !Number.isInteger(quantity) || quantity < 1) { this.checkoutError.set("Enter valid discount, tip, and credit quantity."); return; }
    if (discount > 0 && this.checkoutDiscountReason().trim().length < 3) { this.checkoutError.set("Enter a discount reason of at least 3 characters."); return; }
    const tipSplits: Array<{ staffId:string; amountPaise:number }> = [], tipStaffIds = new Set<string>();
    for (const split of this.checkoutTipSplits()) {
      const staffId=split.staffId.trim(), amountPaise=this.moneyPaise(split.amount,false);
      if (!staffId || amountPaise === null || amountPaise < 1 || tipStaffIds.has(staffId)) { this.checkoutError.set("Tip splits need unique staff and a positive amount."); return; }
      tipStaffIds.add(staffId); tipSplits.push({ staffId,amountPaise });
    }
    if (tipSplits.length && tipSplits.reduce((sum,split)=>sum+split.amountPaise,0) !== tip) { this.checkoutError.set("Tip split total must equal the invoice tip."); return; }
    this.checkoutSaving.set(true); this.checkoutError.set("");
    try { await this.staff.updateAppointmentCheckout(appointmentId,{ billDiscountPaise:discount,discountReason:this.checkoutDiscountReason().trim(),couponCode:this.checkoutCoupon().trim(),tipPaise:tip,tipSplits,roundToNearestRupee:this.checkoutRound(),packageRedemptions:this.packageCreditId() ? [{ creditId:this.packageCreditId(),quantity }] : [],membershipRedemptions:this.membershipCreditId() ? [{ creditId:this.membershipCreditId(),quantity }] : [] }); this.actionMessage.set("Invoice updated."); await this.loadCheckout(appointmentId); }
    catch { this.checkoutError.set(this.staff.error() || "Unable to update invoice."); }
    finally { this.checkoutSaving.set(false); }
  }

  addTipSplit() { this.checkoutTipSplits.update((rows)=>[...rows,{ staffId:"",amount:"" }]); }
  updateTipSplit(index: number, field: "staffId" | "amount", value: string) { this.checkoutTipSplits.update((rows)=>rows.map((row,rowIndex)=>rowIndex === index ? { ...row,[field]:value } : row)); }
  removeTipSplit(index: number) { this.checkoutTipSplits.update((rows)=>rows.filter((_,rowIndex)=>rowIndex !== index)); }

  async addGiftCard(item: StaffAppointment) {
    const code=this.giftCardCode().trim().toUpperCase(), amount=this.moneyPaise(this.giftCardAmount(),false);
    if (!/^[A-Z0-9-]{4,64}$/.test(code) || amount === null || amount < 1) { this.checkoutError.set("Enter a 4-64 character card code and positive value."); return; }
    this.checkoutSaving.set(true); this.checkoutError.set("");
    try { await this.staff.addAppointmentInvoiceLine(item.id,{ itemType:"gift_card",itemId:code,quantity:1,unitPricePaise:amount }); this.giftCardCode.set(""); this.giftCardAmount.set(""); this.actionMessage.set("Gift / prepaid liability item added."); await Promise.all([this.loadCheckout(item.id),this.loadServiceWorkspace(item.id)]); }
    catch { this.checkoutError.set(this.staff.error() || "Unable to add gift / prepaid card."); }
    finally { this.checkoutSaving.set(false); }
  }

  async recordPayment(appointmentId: string) {
    const amount=this.moneyPaise(this.paymentAmount(),false); if (amount === null || amount < 1) { this.checkoutError.set("Enter a valid payment amount."); return; }
    this.checkoutSaving.set(true); this.checkoutError.set("");
    try { await this.staff.addAppointmentPayment(appointmentId,{ method:this.paymentMethod(),amountPaise:amount,reference:this.paymentReference().trim(),notes:"Staff App checkout",cashDrawerTillId:this.paymentTillId().trim(),idempotencyKey:this.newBookingKey() }); this.paymentReference.set(""); this.actionMessage.set("Payment recorded."); await this.loadCheckout(appointmentId); }
    catch { this.checkoutError.set(this.staff.error() || "Unable to record payment."); }
    finally { this.checkoutSaving.set(false); }
  }

  async startProviderPayment(appointmentId: string) {
    const amount=this.moneyPaise(this.paymentAmount(),false), token=this.providerPaymentToken().trim(), savedInstrumentId=this.savedInstrumentId(); if (amount === null || amount < 1 || (!savedInstrumentId && (!this.paymentProvider() || !token))) { this.checkoutError.set("Choose a saved instrument or enter provider, secure payment token, and amount."); return; }
    this.checkoutSaving.set(true); this.checkoutError.set("");
    try { await this.staff.startAppointmentProviderPayment(appointmentId,{ provider:this.paymentProvider(),providerPaymentMethodId:token,providerCustomerId:this.providerCustomerToken().trim(),savedInstrumentId,amountPaise:amount,storePaymentMethod:this.storePaymentMethod(),idempotencyKey:this.newBookingKey() }); this.providerPaymentToken.set(""); this.providerCustomerToken.set(""); this.storePaymentMethod.set(false); this.savedInstrumentId.set(""); this.actionMessage.set("Payment sent to the secure provider. Reload after provider confirmation."); await this.loadCheckout(appointmentId); }
    catch { this.checkoutError.set(this.staff.error() || "Provider payment failed."); }
    finally { this.checkoutSaving.set(false); }
  }

  async createUpiLink(appointmentId: string) {
    const value=this.checkout(), amount=this.moneyPaise(this.paymentAmount(),false); if (!value || amount === null || amount < 1) { this.checkoutError.set("Enter a valid UPI amount."); return; }
    this.checkoutSaving.set(true); this.checkoutError.set("");
    try { if (value.checkout.sale.status === "draft") await this.staff.finalizeAppointmentCheckout(appointmentId,this.paymentTillId().trim()); const link=await this.staff.createAppointmentUpiLink(appointmentId,{ provider:this.upiProvider(),amountPaise:amount,idempotencyKey:this.newBookingKey() }); this.upiUrl.set(link.url); this.actionMessage.set("Secure UPI payment link created."); await this.loadCheckout(appointmentId); }
    catch { this.checkoutError.set(this.staff.error() || "Unable to create UPI payment link."); }
    finally { this.checkoutSaving.set(false); }
  }

  async finalizeCheckout(appointmentId: string) {
    this.checkoutSaving.set(true); this.checkoutError.set("");
    try { await this.staff.finalizeAppointmentCheckout(appointmentId,this.paymentTillId().trim()); this.actionMessage.set("Invoice finalized and ready for reconciliation."); await Promise.all([this.loadCheckout(appointmentId),this.reloadOperations(appointmentId)]); }
    catch { this.checkoutError.set(this.staff.error() || "Unable to finalize invoice."); }
    finally { this.checkoutSaving.set(false); }
  }

  async printReceipt(appointmentId: string) {
    this.checkoutSaving.set(true); this.checkoutError.set("");
    try { const receipt=await this.staff.appointmentReceipt(appointmentId); await this.staff.recordAppointmentReceipt(appointmentId,"print"); const url=URL.createObjectURL(new Blob([receipt.printHtml],{ type:"text/html" })); globalThis.open(url,"_blank","noopener,noreferrer"); setTimeout(()=>URL.revokeObjectURL(url),60_000); }
    catch { this.checkoutError.set(this.staff.error() || "Unable to open receipt."); }
    finally { this.checkoutSaving.set(false); }
  }

  async sendReceipt(appointmentId: string) {
    const recipient=globalThis.prompt("Receipt email or phone"); if (!recipient?.trim()) return;
    const action=recipient.includes("@") ? "email" : "sms";
    this.checkoutSaving.set(true); this.checkoutError.set("");
    try { await this.staff.recordAppointmentReceipt(appointmentId,action,recipient.trim()); this.actionMessage.set("Receipt delivery queued."); }
    catch { this.checkoutError.set(this.staff.error() || "Unable to send receipt."); }
    finally { this.checkoutSaving.set(false); }
  }

  async runCheckoutLifecycle(appointmentId: string, action: "void" | "refund") {
    const reason=this.lifecycleReason().trim(), amount=action === "refund" ? this.moneyPaise(this.refundAmount(),false) : undefined;
    if (reason.length < 3 || (action === "refund" && (!amount || amount < 1))) { this.checkoutError.set("Enter a reason and valid refund amount."); return; }
    if (!globalThis.confirm(`${action === "void" ? "Void" : "Refund"} this invoice?`)) return;
    this.checkoutSaving.set(true); this.checkoutError.set("");
    try { await this.staff.appointmentCheckoutLifecycle(appointmentId,action,{ amountPaise:amount,reason,mfaCode:this.lifecycleMfa().trim(),idempotencyKey:this.newBookingKey(),restock:true }); this.lifecycleMfa.set(""); this.actionMessage.set(`Invoice ${action} completed.`); await this.loadCheckout(appointmentId); }
    catch { this.checkoutError.set(this.staff.error() || `Unable to ${action} invoice.`); }
    finally { this.checkoutSaving.set(false); }
  }

  private moneyPaise(value: string, allowEmpty = true): number | null {
    if (allowEmpty && !String(value).trim()) return 0; const amount=Number(value); return Number.isFinite(amount) && amount >= 0 ? Math.round(amount*100) : null;
  }

  async loadServiceWorkspace(appointmentId = this.selectedAppointment()?.id || "", query: { q?: string; barcode?: string } = {}) {
    if (!appointmentId) return;
    this.serviceWorkspaceLoading.set(true); this.serviceWorkspaceError.set("");
    try { const value = await this.staff.serviceWorkspace(appointmentId, query); if (this.selectedAppointment()?.id === appointmentId) this.serviceWorkspace.set(value); }
    catch { if (this.selectedAppointment()?.id === appointmentId) this.serviceWorkspaceError.set(this.staff.error() || "Unable to load service workspace."); }
    finally { if (this.selectedAppointment()?.id === appointmentId) this.serviceWorkspaceLoading.set(false); }
  }

  chooseRecipe(recipe: StaffServiceRecipeLine) {
    this.selectedRecipe.set(recipe); this.actualUsage.set(String(recipe.expectedQuantity)); this.wastedUsage.set(""); this.selectedBatchId.set(recipe.batches[0]?.id || ""); this.usageReason.set("");
  }

  async recordConsumable(item: StaffAppointment) {
    const recipe=this.selectedRecipe(), actual=Number(this.actualUsage()), wasted=this.wastedUsage() === "" ? 0 : Number(this.wastedUsage());
    if (!recipe || !Number.isFinite(actual) || actual <= 0 || !Number.isFinite(wasted) || wasted < 0 || wasted > actual) { this.serviceWorkspaceError.set("Enter valid actual and wasted quantities."); return; }
    if ((wasted > 0 || actual < recipe.minQuantity || actual > recipe.maxQuantity) && this.usageReason().trim().length < 3) { this.serviceWorkspaceError.set("Enter a variance or waste reason."); return; }
    if (recipe.batchTracked && !this.selectedBatchId()) { this.serviceWorkspaceError.set("Choose the current FEFO batch."); return; }
    this.serviceWorkspaceSaving.set(true); this.serviceWorkspaceError.set("");
    try {
      await this.staff.recordProductUsage({ inventoryItemId:recipe.inventoryItemId, serviceId:recipe.serviceId, clientId:item.clientId || "", appointmentId:item.id, actualQuantity:actual, wastedQuantity:wasted, selectedBatchId:this.selectedBatchId() || undefined, wasteReason:this.usageReason().trim() || undefined, notes:this.usageReason().trim(), idempotencyKey:this.newBookingKey() });
      this.actionMessage.set("Consumable usage recorded."); this.selectedRecipe.set(null); await Promise.all([this.loadServiceWorkspace(item.id), this.reloadOperations(item.id)]);
    } catch { this.serviceWorkspaceError.set(this.staff.error() || "Unable to record consumable usage."); }
    finally { this.serviceWorkspaceSaving.set(false); }
  }

  async reviewUsage(item: StaffAppointment, usageId: string, decision: "approve" | "reject") {
    const note=globalThis.prompt(`${decision === "approve" ? "Approval" : "Rejection"} reason`); if (!note || note.trim().length < 3) return;
    this.serviceWorkspaceSaving.set(true); this.serviceWorkspaceError.set("");
    try { await this.staff.reviewProductUsage(usageId,decision,note.trim()); this.actionMessage.set(`Usage ${decision}d.`); await Promise.all([this.loadServiceWorkspace(item.id), this.reloadOperations(item.id)]); }
    catch { this.serviceWorkspaceError.set(this.staff.error() || "Unable to review usage."); }
    finally { this.serviceWorkspaceSaving.set(false); }
  }

  async searchRetail(item: StaffAppointment, barcode = false) {
    await this.loadServiceWorkspace(item.id, barcode ? { barcode:this.retailBarcode().trim() } : { q:this.retailQuery().trim() });
  }

  async scanRetailBarcode(event: Event, item: StaffAppointment) {
    const file=(event.target as HTMLInputElement).files?.[0]; if (!file) return;
    const Detector=(globalThis as unknown as { BarcodeDetector?: new (options: { formats: string[] }) => { detect(source: ImageBitmap): Promise<Array<{ rawValue: string }>> } }).BarcodeDetector;
    if (!Detector) { this.serviceWorkspaceError.set("Camera barcode detection is not supported on this device. Use the barcode field or scanner."); return; }
    try { const bitmap=await createImageBitmap(file); const result=await new Detector({ formats:["code_128","ean_13","ean_8","upc_a","upc_e"] }).detect(bitmap); bitmap.close(); const value=result[0]?.rawValue || ""; if (!value) throw new Error(); this.retailBarcode.set(value); await this.searchRetail(item,true); }
    catch { this.serviceWorkspaceError.set("Barcode could not be read. Try again or enter it manually."); }
  }

  async addInvoiceLine(item: StaffAppointment, itemType: "product" | "service" | "membership" | "package" | "gift_card", itemId: string) {
    const quantity=Number(this.retailQuantity()); if (!Number.isInteger(quantity) || quantity < 1) { this.serviceWorkspaceError.set("Quantity must be a whole number of at least 1."); return; }
    const priceText=this.retailPrice().trim(), unitPricePaise=priceText === "" ? undefined : Math.round(Number(priceText) * 100);
    if (unitPricePaise !== undefined && (!Number.isFinite(unitPricePaise) || unitPricePaise < 0 || this.retailPriceReason().trim().length < 3)) { this.serviceWorkspaceError.set("A valid price and price-change reason are required."); return; }
    this.serviceWorkspaceSaving.set(true); this.serviceWorkspaceError.set("");
    try { await this.staff.addAppointmentInvoiceLine(item.id,{ itemType,itemId,quantity,unitPricePaise,priceReason:this.retailPriceReason().trim() || undefined }); this.actionMessage.set("Recommendation added to the checkout draft."); this.retailPrice.set(""); this.retailPriceReason.set(""); await this.loadServiceWorkspace(item.id); }
    catch { this.serviceWorkspaceError.set(this.staff.error() || "Unable to add recommendation."); }
    finally { this.serviceWorkspaceSaving.set(false); }
  }

  async saveHandoffNote(item: StaffAppointment) {
    const reason=this.handoffNote().trim(); if (!reason) { this.serviceWorkspaceError.set("Enter a handoff note."); return; }
    this.serviceWorkspaceSaving.set(true); this.serviceWorkspaceError.set("");
    try { await this.staff.runAppointmentOperation(item.id,"note",{ reason }); this.actionMessage.set("Handoff note saved."); this.handoffNote.set(""); await this.reloadOperations(item.id); }
    catch { this.serviceWorkspaceError.set(this.staff.error() || "Unable to save handoff note."); }
    finally { this.serviceWorkspaceSaving.set(false); }
  }

  recommendationWarning(): string {
    const guest=this.guest360()?.guest; if (!guest) return "Review guest consent and history before recommending.";
    if (guest.clinicalProfile?.allergies) return `Check allergy or sensitivity: ${guest.clinicalProfile.allergies}`;
    if (!guest["whatsappOptIn"] && !guest["smsOptIn"] && !guest["emailOptIn"]) return "Guest has no marketing communication opt-in. In-visit recommendation only.";
    return "Review guest history and suitability before adding a recommendation.";
  }

  private async reloadOperations(appointmentId: string) {
    const context=await this.staff.appointmentOperations(appointmentId); if (this.selectedAppointment()?.id === appointmentId) { this.operationContext.set(context); this.selectedAppointment.set({ ...this.selectedAppointment()!, ...context.appointment }); }
  }

  async loadGuest360(appointmentId = this.selectedAppointment()?.id || "") {
    if (!appointmentId) return;
    this.guestLoading.set(true); this.guestError.set("");
    try {
      const value = await this.staff.appointmentGuest360(appointmentId);
      if (this.selectedAppointment()?.id !== appointmentId) return;
      this.guest360.set(value);
      this.guestAllergies.set(value.guest.clinicalProfile?.allergies || "");
      this.guestPreferences.set(value.guest.clinicalProfile?.preferences || "");
      this.guestPreferredChannel.set(this.recordText(value.guest, "preferredCommunicationChannel") || "none");
      this.guestWhatsappOptIn.set(Boolean(value.guest["whatsappOptIn"]));
      this.guestSmsOptIn.set(Boolean(value.guest["smsOptIn"]));
      this.guestEmailOptIn.set(Boolean(value.guest["emailOptIn"]));
      const selected = value.guest.formDefinitions.find((form) => form.id === this.guestFormId()) || value.guest.formDefinitions[0];
      if (selected) this.selectGuestForm(selected);
      else { this.guestFormId.set(""); this.guestFormResponses.set({}); this.guestFormSubmission.set(null); }
      if (value.profilePhotoId && value.permissions.photosRead) void this.viewGuestPhoto(value.profilePhotoId);
      else this.clearGuestPhotoUrl();
    } catch { if (this.selectedAppointment()?.id === appointmentId) this.guestError.set(this.staff.error() || "Unable to load Guest 360."); }
    finally { if (this.selectedAppointment()?.id === appointmentId) this.guestLoading.set(false); }
  }

  selectGuestForm(form: StaffGuestFormDefinition) {
    const draft = (this.guest360()?.guest.formSubmissions || []).find((row) => row.definitionId === form.id && row.status === "draft") || null;
    this.guestFormId.set(form.id); this.guestFormSubmission.set(draft); this.guestFormResponses.set({ ...(draft?.responsesJson || {}) });
    this.guestFormMode.set(draft?.mode || "staff"); this.guestSignatureName.set(draft?.signatureName || ""); this.guestFormConsent.set(false);
    this.guestCorrectionId.set(""); this.guestCorrectionReason.set("");
  }
  selectGuestFormById(id: string) { const form = this.guest360()?.guest.formDefinitions.find((value) => value.id === id); if (form) this.selectGuestForm(form); }
  selectedGuestForm(): StaffGuestFormDefinition | undefined { return this.guest360()?.guest.formDefinitions.find((form) => form.id === this.guestFormId()); }
  formRequiresSignature(form: StaffGuestFormDefinition): boolean { return form.requiresSignature || form.fieldsJson.some((field) => field.type === "signature"); }
  formValue(key: string): unknown { return this.guestFormResponses()[key]; }
  formText(key: string): string { const value = this.formValue(key); return value == null ? "" : String(value); }
  setFormValue(key: string, value: unknown) { this.guestFormResponses.update((current) => ({ ...current, [key]: value })); }
  formFieldVisible(field: StaffGuestFormField): boolean {
    if (!field.sectionKey) return true;
    const section = this.selectedGuestForm()?.fieldsJson.find((candidate) => candidate.type === "section" && candidate.key === field.sectionKey);
    return !section?.visibleWhen || this.formValue(section.visibleWhen.fieldKey) === section.visibleWhen.equals;
  }
  formTableRows(key: string): Array<Record<string, unknown>> { const value = this.formValue(key); return Array.isArray(value) ? value as Array<Record<string, unknown>> : []; }
  addFormTableRow(field: StaffGuestFormField) { this.setFormValue(field.key, [...this.formTableRows(field.key), Object.fromEntries((field.columns || []).map((column) => [column.key, column.type === "boolean" ? false : ""]))]); }
  updateFormTableCell(field: StaffGuestFormField, index: number, key: string, value: unknown) { this.setFormValue(field.key, this.formTableRows(field.key).map((row, rowIndex) => rowIndex === index ? { ...row, [key]: value } : row)); }
  removeFormTableRow(field: StaffGuestFormField, index: number) { this.setFormValue(field.key, this.formTableRows(field.key).filter((_, rowIndex) => rowIndex !== index)); }

  async saveGuestNote(item: StaffAppointment) {
    const note = this.guestNote().trim(); if (!note) { this.guestError.set("Enter a note."); return; }
    await this.runGuestSave(item.id, () => this.staff.saveAppointmentGuestNote(item.id, { noteType: this.guestNoteType(), note, visibility: this.guestNoteVisibility() }), "Note saved.");
    if (!this.guestError()) this.guestNote.set("");
  }
  async saveGuestClinical(item: StaffAppointment) {
    await this.runGuestSave(item.id, () => this.staff.saveAppointmentGuestClinical(item.id, { allergies: this.guestAllergies().trim(), preferences: this.guestPreferences().trim(), expectedVersion: this.guest360()?.guest.clinicalProfile?.version || 0 }), "Clinical profile saved.");
  }
  async saveGuestForm(item: StaffAppointment, status: "draft" | "submitted") {
    const form = this.selectedGuestForm(); if (!form) return;
    const serviceId = form.scopeType === "service" ? item.serviceIds.find((id) => !form.scopeIdsJson.length || form.scopeIdsJson.includes(id)) || "" : "";
    const submission = this.guestFormSubmission();
    await this.runGuestSave(item.id, () => this.staff.saveAppointmentGuestForm(item.id, {
      definitionId: form.id, submissionId: submission?.id || undefined, expectedVersion: submission?.version,
      responses: this.guestFormResponses(), serviceId: serviceId || undefined, mode: this.guestFormMode(), status,
      signatureName: this.guestSignatureName().trim() || undefined, consentConfirmed: this.guestFormConsent(),
      correctsSubmissionId: this.guestCorrectionId() || undefined, correctionReason: this.guestCorrectionReason().trim() || undefined
    }), status === "draft" ? "Form draft saved." : "Form submitted.");
  }
  startGuestCorrection(row: StaffGuestFormSubmission) {
    const form = this.guest360()?.guest.formDefinitions.find((value) => value.id === row.definitionId); if (!form) return;
    this.selectGuestForm(form); this.guestFormResponses.set({ ...row.responsesJson }); this.guestCorrectionId.set(row.id); this.guestCorrectionReason.set("");
  }
  async reviewGuestForm(item: StaffAppointment, row: StaffGuestFormSubmission, decision: "approved" | "correction_required") {
    const note = this.guestReviewNote().trim(); if (decision === "correction_required" && !note) { this.guestError.set("Enter a review note."); return; }
    await this.runGuestSave(item.id, () => this.staff.reviewAppointmentGuestForm(item.id, row.id, decision, note), `Form ${decision === "approved" ? "approved" : "returned for correction"}.`);
    if (!this.guestError()) this.guestReviewNote.set("");
  }
  onGuestPhotoFile(event: Event) { this.guestPhotoFile.set((event.target as HTMLInputElement).files?.[0] || null); }
  async uploadGuestPhoto(item: StaffAppointment) {
    const file = this.guestPhotoFile(); if (!file || !this.guestPhotoConsent()) { this.guestError.set("Choose a photo and confirm guest consent."); return; }
    await this.runGuestSave(item.id, () => this.staff.uploadAppointmentGuestPhoto(item.id, file, { caption: this.guestPhotoCaption().trim(), serviceId: this.guestPhotoServiceId(), photoType: this.guestPhotoType(), consentConfirmed: true, consentReason: this.guestPhotoConsentReason().trim() }), "Photo uploaded.");
    if (!this.guestError()) { this.guestPhotoFile.set(null); this.guestPhotoCaption.set(""); this.guestPhotoConsent.set(false); this.guestPhotoConsentReason.set(""); }
  }
  async viewGuestPhoto(photoId: string) {
    const appointmentId = this.selectedAppointment()?.id; if (!appointmentId) return;
    try { const blob = await this.staff.appointmentGuestPhoto(appointmentId, photoId); if (this.selectedAppointment()?.id !== appointmentId) return; this.clearGuestPhotoUrl(); this.guestPhotoUrl.set(URL.createObjectURL(blob)); this.guestPhotoViewedId.set(photoId); }
    catch { this.guestError.set(this.staff.error() || "Unable to load photo."); }
  }
  async deleteGuestPhoto(item: StaffAppointment, photoId: string) { await this.runGuestSave(item.id, () => this.staff.deleteAppointmentGuestPhoto(item.id, photoId), "Photo deleted."); }
  async saveGuestPreferences(item: StaffAppointment) {
    await this.runGuestSave(item.id, () => this.staff.saveAppointmentGuestPreferences(item.id, { preferredCommunicationChannel: this.guestPreferredChannel(), whatsappOptIn: this.guestWhatsappOptIn(), smsOptIn: this.guestSmsOptIn(), emailOptIn: this.guestEmailOptIn(), reason: this.guestPreferenceReason().trim() }), "Communication preferences saved.");
    if (!this.guestError()) this.guestPreferenceReason.set("");
  }
  relationRows(key: string): Array<Record<string, unknown>> { const value = this.guest360()?.relationships[key]; return Array.isArray(value) ? value as Array<Record<string, unknown>> : []; }
  guestSummaryNumber(key: string): number { return Number(this.guest360()?.guest.summary[key] || 0); }
  guestWalletPaise(): number { const wallet = this.guest360()?.relationships["wallet"]; return wallet && typeof wallet === "object" ? Number((wallet as Record<string, unknown>)["balancePaise"] || 0) : 0; }
  private async runGuestSave(appointmentId: string, action: () => Promise<unknown>, message: string) {
    this.guestSaving.set(true); this.guestError.set("");
    try { await action(); this.actionMessage.set(message); await this.loadGuest360(appointmentId); }
    catch (error) { this.guestError.set(error instanceof Error ? error.message : this.staff.error() || "Unable to save Guest 360."); }
    finally { this.guestSaving.set(false); }
  }
  private clearGuestPhotoUrl() { const value = this.guestPhotoUrl(); if (value) URL.revokeObjectURL(value); this.guestPhotoUrl.set(""); this.guestPhotoViewedId.set(""); }
  private resetGuest360() { this.guest360.set(null); this.guestLoading.set(false); this.guestError.set(""); this.guestSaving.set(false); this.guestFormId.set(""); this.guestFormResponses.set({}); this.guestFormSubmission.set(null); this.guestPhotoFile.set(null); this.clearGuestPhotoUrl(); }
  recommendationMeta(item: StaffRecommendation): string {
    return [
      item.rating == null ? "" : `Rating ${item.rating.toFixed(1)}`,
      item.completionPercent == null ? "" : `${item.completionPercent}% completion`,
      item.repeatClientPercent == null ? "" : `${item.repeatClientPercent}% repeat`,
      item.utilizationPercent == null ? "" : `${item.utilizationPercent}% utilization`
    ].filter(Boolean).join(" · ");
  }
  beginReschedule(item: StaffAppointment) {
    const value = istDateTimeInput(item.startAt);
    this.actionDate.set(displayBusinessDate(value.date)); this.actionTime.set(value.time); this.actionReason.set(""); this.actionError.set(""); this.actionMode.set("reschedule");
  }
  beginCancel() { this.actionReason.set(""); this.actionError.set(""); this.actionMode.set("cancel"); }

  async submitAction(item: StaffAppointment) {
    const reason = this.actionReason().trim();
    if (reason.length < 3) { this.actionError.set("Enter a reason of at least 3 characters."); return; }
    this.savingAction.set(true); this.actionError.set("");
    try {
      if (this.actionMode() === "cancel") await this.staff.cancelAppointment(item.id, reason);
      else {
        const start = new Date(`${parseDisplayBusinessDate(this.actionDate())}T${this.actionTime()}:00+05:30`);
        if (Number.isNaN(start.getTime()) || start <= new Date()) { this.actionError.set("Choose a future date and time."); return; }
        await this.staff.rescheduleAppointment(item.id, { startAt: start.toISOString(), reason });
      }
      this.actionMessage.set(this.actionMode() === "cancel" ? "Appointment cancelled." : "Appointment rescheduled.");
      this.closeDrawers();
      await this.load();
      if (this.history()) await this.loadHistory(true);
    } catch { this.actionError.set(this.staff.error() || "Unable to update appointment."); }
    finally { this.savingAction.set(false); }
  }

  private statusOf(item: StaffAppointment): string { return String(item.status || "").trim().toLowerCase().replace(/[_\s]+/g, "-"); }
  private isCompleted(item: StaffAppointment): boolean { return COMPLETED_STATUSES.has(this.statusOf(item)); }
  private compareStartTimes(left: StaffAppointment, right: StaffAppointment, ascending: boolean): number {
    const leftTime = new Date(left.startAt).getTime();
    const rightTime = new Date(right.startAt).getTime();
    if (Number.isNaN(leftTime)) return Number.isNaN(rightTime) ? 0 : 1;
    if (Number.isNaN(rightTime)) return -1;
    return ascending ? leftTime - rightTime : rightTime - leftTime;
  }
}
