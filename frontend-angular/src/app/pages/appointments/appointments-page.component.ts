import { CommonModule } from '@angular/common';
import { Component, inject, OnDestroy, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { DatePickerComponent } from '../../shared/date-picker/date-picker.component';
import { ApiService } from '../../shared/services/api.service';

type CalendarView = 'Day' | 'Week';
type StaffGridMode =
  | 'Staff Grid'
  | 'Compact Grid'
  | 'Timeline'
  | 'List'
  | 'Chair / Room Grid'
  | 'Status Board'
  | 'Capacity View'
  | 'Conflict View';
type ToolbarCommand = 'block' | 'waitlist' | 'move';
type ApiList<T> = { success?: boolean; data?: T[] } | T[];
type AppointmentSettings = {
  startTime: string;
  endTime: string;
  overlapTimeSlot: boolean;
  previousTimeSlot: boolean;
  weekStartFrom: string;
  slotMinutes: number;
  timeFormat: string;
  roomNumberOption: boolean;
  staffCalendar: boolean;
  defaultStatus: string;
  clientSelfReschedule: boolean;
  rescheduleApprovalRequired: boolean;
  rescheduleCutoffHours: number;
  maxRescheduleCount: number;
  rescheduleSmsAppNotification: boolean;
  perServiceRescheduleSms: boolean;
  colors: Array<{ status: string; enabled: boolean; color: string; label: string }>;
};

type StaffOption = {
  id: string;
  initials: string;
  name: string;
  role: string;
  serviceIds: string[];
};

type ServiceOption = {
  id: string;
  name: string;
  category: string;
  durationMinutes: number;
  active: boolean;
  priceText: string;
  variants: Array<{ id: string; name: string; priceDeltaPaise: number; durationDeltaMinutes: number }>;
  addons: Array<{ id: string; name: string; pricePaise: number; durationMinutes: number }>;
};

type ClientOption = {
  id: string;
  name: string;
  phone: string;
  email: string;
};

type AppointmentRecord = {
  id: string;
  clientId: string;
  staffId: string;
  requestedStaffId: string;
  staffPreference: 'any' | 'preferred' | 'required';
  serviceIds: string[];
  startAt: string;
  endAt: string;
  status: string;
  notes: string;
  chairRoomId: string;
  amountText: string;
  paymentText: string;
  bookingNumber: string;
  bookingGroupId: string;
  activityLines: AppointmentActivityLine[];
};

type AppointmentActivityLine = {
  id: string;
  title: string;
  time: string;
  body: string;
};

type AppointmentCard = {
  id: string;
  clientId: string;
  staffId: string;
  requestedStaffId: string;
  staffPreference: 'any' | 'preferred' | 'required';
  serviceIds: string[];
  startAt: string;
  endAt: string;
  staff: number;
  top: number;
  height: number;
  lane: number;
  laneCount: number;
  client: string;
  service: string;
  time: string;
  status: string;
  notes: string;
  chairRoomId: string;
  amountText: string;
  paymentText: string;
  bookingNumber: string;
  bookingGroupId: string;
  activityLines: AppointmentActivityLine[];
  detailRows: Array<{ label: string; value: string }>;
};

type CalendarColumn = {
  id: string;
  title: string;
  subtitle: string;
  initials: string;
  staffId: string;
  date: string;
};

type BookingLine = {
  id: string;
  appointmentId: string;
  clientId: string;
  clientSearch: string;
  clientOpen: boolean;
  serviceId: string;
  serviceSearch: string;
  staffId: string;
  staffSearch: string;
  startTime: string;
  durationMinutes: number;
  chairRoomId: string;
  initialStaffId: string;
  requestedStaffId: string;
  staffPreference: 'any' | 'preferred' | 'required';
  staffChangeApproval: '' | 'client-approved' | 'manager-override';
  staffChangeReason: string;
  serviceOpen: boolean;
  staffOpen: boolean;
  variantId: string;
  addonIds: string[];
};

type ChairRoomOption = { id: string; name: string; kind: string };

type ResourceBooking = {
  id: string;
  client: string;
  service: string;
  time: string;
  status: string;
};

type StatusBoardColumn = {
  key: string;
  label: string;
  appointments: AppointmentCard[];
};

type CapacityRow = StaffOption & {
  occupiedMinutes: number;
  calendarMinutes: number;
  openSlots: number;
  utilization: number;
};

type ConflictRow = {
  id: string;
  type: 'Staff' | 'Chair / Room';
  target: string;
  first: string;
  second: string;
};

type PreviousService = {
  id: string;
  serviceName: string;
  staffName: string;
  date: string;
  durationMinutes: number;
  serviceId: string;
  staffId: string;
};

type WaitlistEntry = { id: string; customerId: string; serviceIds: string[]; preferredSlotAt: string; notes: string };
type BlackoutEntry = { id: string; staffId: string; blackoutGroupId: string; blackoutDate: string; blockedFrom: string; blockedUntil: string; reason: string };
type BookingIntelligence = {
  plan: Array<{ lineId: string; serviceName: string; startAt: string; activeEndsAt: string; busyUntil: string; processingMinutes: number; cleanupMinutes: number; bufferMinutes: number; consultation: { required: boolean; patchTestRequired: boolean; formDefinitionId: string; current: boolean }; staff: Array<{ staffId: string; name: string; gender: string; verifiedSkills: number; bookedMinutes: number }> }>;
  alternatives: Array<{ lineId: string; slots: Array<{ staffId: string; startAt: string; endAt: string; requestedStaff: boolean }> }>;
  deposit: { required: boolean; depositPaise: number; totalPaise: number };
  client: { activeMemberships: number; packageCredits: number; riskScore: number; riskLevel: string } | null;
};

type BookingClientKpi = {
  walletPaise: number;
  unpaidPaise: number;
  membershipAssignDate: string | null;
  membershipExpireDate: string | null;
  hasActiveMembership: boolean;
};

@Component({
  selector: 'page-appointments',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, DatePickerComponent],
  templateUrl: './appointments-page.component.html',
  styleUrls: ['./appointments-page.component.css'],
})
export class AppointmentsPageComponent implements OnInit, OnDestroy {
  private readonly api = inject(ApiService);
  private readonly router = inject(Router);

  readonly viewModes: CalendarView[] = ['Day', 'Week'];
  readonly staffGridModes: StaffGridMode[] = [
    'Staff Grid',
    'Compact Grid',
    'Timeline',
    'List',
    'Chair / Room Grid',
    'Status Board',
    'Capacity View',
    'Conflict View',
  ];
  readonly settingsKey = 'aurashine.appointment.settings';
  readonly scheduledStaffKey = 'aurashine.appointment.scheduled-staff';
  // ponytail: build auth headers from local auth context instead of fixed dev IDs.
  private readonly settingsUpdatedEvent = () => {
    const existingSelectedId = this.selectedAppointment?.id;
    this.appointmentSettings = this.loadAppointmentSettings();
    this.times = this.buildTimes();
    this.mapAppointmentCards();
    this.updateCurrentTimeLine();
    if (existingSelectedId) {
      this.selectedAppointment = this.appointments.find((item) => item.id === existingSelectedId) || null;
      if (!this.selectedAppointment) this.appointmentNoteDraft = '';
    }
  };

  private readonly storageUpdatedHandler = (event: StorageEvent) => {
    if (event.key === this.settingsKey) {
      this.settingsUpdatedEvent();
    }
  };

  activeView: CalendarView = 'Day';
  activeStaffGridMode: StaffGridMode = 'Staff Grid';
  appointmentSettings = this.loadAppointmentSettings();
  times = this.buildTimes();
  scheduledStaffOpen = false;
  scheduledStaffSelection: Record<string, boolean> = {};
  appointmentDate = new Date().toISOString().slice(0, 10);
  newBookingOpen = false;
  savingBooking = false;
  bookingError = '';
  editingAppointmentId = '';
  editingBookingGroupId = '';
  removedServiceAppointmentIds: string[] = [];
  staffChangeReviewOpen = false;
  dataSourceStatus = { label: 'Checking backend', online: false };
  hoveredAppointment: { card: AppointmentCard; x: number; y: number } | null = null;
  hoveredSlot: { time: string; staff: string; x: number; y: number } | null = null;
  currentTimeTop: number | null = null;
  currentTimeLabel = '';
  selectedAppointment: AppointmentCard | null = null;
  appointmentDetailTab: 'booking' | 'activity' = 'booking';
  appointmentNoteDraft = '';
  notesSaving = false;
  appointmentActionError = '';
  appointmentActionMessage = '';
  statusSaving = '';
  noShowDrawerOpen = false;
  noShowAmount = '';
  noShowProvider = 'razorpay';
  noShowSaving = false;
  activityRefreshError = '';
  clientSmsSending = false;
  private activityRefreshTimer: ReturnType<typeof setInterval> | null = null;
  private currentTimeTimer: ReturnType<typeof setInterval> | null = null;
  private liveSocket: WebSocket | null = null;
  private liveReconnectTimer: ReturnType<typeof setTimeout> | null = null;
  draggedAppointment: AppointmentCard | null = null;

  clients: ClientOption[] = [];
  staff: StaffOption[] = [];
  services: ServiceOption[] = [];
  chairRooms: ChairRoomOption[] = [];
  appointmentRows: AppointmentRecord[] = [];
  appointments: AppointmentCard[] = [];
  waitlistEntries: WaitlistEntry[] = [];
  blackouts: BlackoutEntry[] = [];

  bookingClientSearch = '';
  selectedClientId = '';
  bookingClientKpi: BookingClientKpi | null = null;
  bookingClientKpiLoading = false;
  bookingIntelligence: BookingIntelligence | null = null;
  bookingIntelligenceLoading = false;
  bookingIntelligenceError = "";
  private bookingIntelligenceRequest = 0;
  private bookingClientKpiRequest = 0;
  bookingNotes = '';
  notifyStaff = true;
  recurrenceFrequency: 'none' | 'weekly' | 'fortnightly' | 'monthly' = 'none';
  recurrenceCount = '';
  bookingLines: BookingLine[] = [];
  rescheduleMode = false;
  rescheduleSelectedAppointmentIds = new Set<string>();
  rescheduleRequests: any[] = [];
  activeCommand: ToolbarCommand | null = null;
  commandError = '';
  commandSaving = false;
  commandStaffId = '';
  commandStaffIds: string[] = [];
  commandClientId = '';
  commandServiceId = '';
  commandAppointmentId = '';
  commandStartTime = '08:00';
  commandDurationMinutes = 30;
  commandReason = '';
  slotAction: { columnIndex: number; time: string; left: number; top: number } | null = null;
  statusFilter: string[] | null = null;

  private lineSeed = 0;

  get summary() {
    const count = (statuses: string[]) => this.appointmentRows.filter((item) => statuses.includes(item.status)).length;

    return [
      { icon: 'booked', label: 'Booked', value: String(count(['booked', 'confirmed'])), tone: 'blue', statuses: ['booked', 'confirmed'] },
      { icon: 'pending', label: 'Pending', value: String(count(['pending', 'waiting', 'draft'])), tone: 'amber', statuses: ['pending', 'waiting', 'draft'] },
      { icon: 'arrived', label: 'Arrived', value: String(count(['arrived'])), tone: 'teal', statuses: ['arrived'] },
      { icon: 'service', label: 'In Service', value: String(count(['in-service'])), tone: 'violet', statuses: ['in-service'] },
      { icon: 'completed', label: 'Completed', value: String(count(['completed', 'paid'])), tone: 'green', statuses: ['completed', 'paid'] },
      { icon: 'waitlist', label: 'Waitlist', value: String(this.waitlistEntries.length), tone: 'pink', statuses: [] as string[], command: 'waitlist' },
      { icon: 'revenue', label: 'Revenue', value: '₹0', tone: 'dark', statuses: [] as string[], command: 'reports' },
    ];
  }

  setSummaryFilter(statuses: string[]) {
    if (!statuses.length) return;
    const alreadySelected = this.statusFilter?.length === statuses.length && statuses.every((status) => this.statusFilter?.includes(status));
    this.statusFilter = alreadySelected ? null : statuses;
    this.mapAppointmentCards();
  }

  openSummaryMetric(statuses: string[], command?: string) {
    if (command === 'waitlist') {
      this.openCommand('waitlist');
      return;
    }
    if (command === 'reports') {
      void this.router.navigate(['/appointment-reports']);
      return;
    }
    this.setSummaryFilter(statuses);
  }

  isSummaryFilterActive(statuses: string[]) {
    return Boolean(statuses.length && this.statusFilter?.length === statuses.length && statuses.every((status) => this.statusFilter?.includes(status)));
  }

  get scheduledStaff() {
    return this.staff.filter((person) => this.scheduledStaffSelection[person.id] !== false);
  }

  get visibleStaffLabel() {
    return `${this.scheduledStaff.length} of ${this.staff.length} visible`;
  }

  get todaysAppointments() {
    return this.appointments;
  }

  get chairRoomGridRows() {
    return this.chairRooms.map((resource) => ({
      ...resource,
      appointments: this.appointmentRows
        .filter((item) => item.chairRoomId === resource.id && this.isActiveDayAppointment(item))
        .map((item) => this.toResourceBooking(item)),
    }));
  }

  get statusBoardColumns(): StatusBoardColumn[] {
    const statuses = [
      { key: 'booked', label: 'Booked' },
      { key: 'confirmed', label: 'Confirmed' },
      { key: 'arrived', label: 'Arrived' },
      { key: 'in-service', label: 'In service' },
      { key: 'completed', label: 'Completed' },
    ];
    return statuses.map((status) => ({
      ...status,
      appointments: this.todaysAppointments.filter((item) => String(item.status || '').toLowerCase() === status.key),
    }));
  }

  get capacityRows(): CapacityRow[] {
    const calendarMinutes = Math.max(
      0,
      this.minutesFromTime(this.appointmentSettings.endTime) - this.minutesFromTime(this.appointmentSettings.startTime),
    );
    const slotMinutes = Math.max(1, Number(this.appointmentSettings.slotMinutes) || 15);
    return this.scheduledStaff.map((staff) => {
      const occupiedMinutes = this.appointmentRows
        .filter((item) => item.staffId === staff.id && this.isActiveDayAppointment(item))
        .reduce((total, item) => total + this.minutesBetween(item.startAt, item.endAt), 0);
      return {
        ...staff,
        occupiedMinutes,
        calendarMinutes,
        openSlots: Math.max(0, Math.floor((calendarMinutes - occupiedMinutes) / slotMinutes)),
        utilization: calendarMinutes ? Math.min(100, Math.round((occupiedMinutes / calendarMinutes) * 100)) : 0,
      };
    });
  }

  get conflictRows(): ConflictRow[] {
    const records = this.appointmentRows.filter((item) => this.isActiveDayAppointment(item));
    const conflicts: ConflictRow[] = [];
    // ponytail: O(n^2) day-level overlap scan; add a DB conflict query only if appointment volume makes it measurable.
    for (let index = 0; index < records.length; index += 1) {
      for (let next = index + 1; next < records.length; next += 1) {
        const first = records[index];
        const second = records[next];
        if (!this.appointmentsOverlap(first, second)) continue;
        if (first.staffId && first.staffId === second.staffId) {
          conflicts.push({
            id: `staff-${first.id}-${second.id}`,
            type: 'Staff',
            target: this.staffName(first.staffId),
            first: this.toResourceBooking(first).time,
            second: this.toResourceBooking(second).time,
          });
        }
        if (first.chairRoomId && first.chairRoomId === second.chairRoomId) {
          conflicts.push({
            id: `resource-${first.id}-${second.id}`,
            type: 'Chair / Room',
            target: this.chairRoomName(first.chairRoomId),
            first: this.toResourceBooking(first).time,
            second: this.toResourceBooking(second).time,
          });
        }
      }
    }
    return conflicts;
  }

  get calendarModeClass() {
    return {
      'compact-grid-mode': this.activeStaffGridMode === 'Compact Grid',
      'timeline-grid-mode': this.activeStaffGridMode === 'Timeline',
    };
  }

  private get calendarSlotHeight() {
    if (this.activeStaffGridMode === 'Compact Grid') return 38;
    if (this.activeStaffGridMode === 'Timeline') return 60;
    return 48;
  }

  get calendarColumns() {
    const staffCount = Math.max(1, this.calendarColumnsData.length);
    const timeWidth = this.activeStaffGridMode === 'Compact Grid' ? 72 : 84;
    const staffWidth = this.activeStaffGridMode === 'Compact Grid' ? 'minmax(150px, 1fr)' : 'minmax(220px, 1fr)';
    return `${timeWidth}px repeat(${staffCount}, ${staffWidth})`;
  }

  get calendarColumnsData(): CalendarColumn[] {
    if (this.activeView === 'Week') {
      return this.weekDates().map((date) => ({
        id: date,
        date,
        staffId: '',
        initials: this.weekdayInitial(date),
        title: this.weekdayTitle(date),
        subtitle: this.shortDate(date),
      }));
    }

    return this.scheduledStaff.map((person) => ({
      id: person.id,
      date: this.appointmentDate,
      staffId: person.id,
      initials: person.initials,
      title: person.name,
      subtitle: person.role,
    }));
  }

  get selectedAppointmentRows() {
    return this.selectedAppointment ? this.serviceBillLines(this.selectedAppointment) : [];
  }

  get commandRecords(): Array<WaitlistEntry | BlackoutEntry> {
    if (this.activeCommand === 'waitlist') return this.waitlistEntries;
    if (this.activeCommand !== 'block') return [];

    const seen = new Set<string>();
    return this.blackouts.filter((entry) => {
      const key = entry.blackoutGroupId || entry.id;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  get statusActions() {
    const actionStatuses = ['confirmed', 'arrived', 'in-service', 'completed', 'cancelled', 'no-show', 'not-confirmed'];
    const configured = new Map(this.appointmentSettings.colors.map((item) => [item.status, item]));
    const fallback = {
      confirmed: { status: 'confirmed', enabled: true, color: '#2563eb', label: 'Confirm' },
      arrived: { status: 'arrived', enabled: true, color: '#9fd6fd', label: 'Arrived' },
      'in-service': { status: 'in-service', enabled: true, color: '#ffa500', label: 'Start' },
      completed: { status: 'completed', enabled: true, color: '#323ec7', label: 'Completed' },
      cancelled: { status: 'cancelled', enabled: true, color: '#fc8e8f', label: 'Cancel' },
      'no-show': { status: 'no-show', enabled: true, color: '#23e830', label: 'Not Came' },
      'not-confirmed': { status: 'not-confirmed', enabled: true, color: '#8893d3', label: 'Not Confirmed' },
    };
    return actionStatuses
      .map((status) => {
        const value = configured.get(status);
        const base = fallback[status as keyof typeof fallback];
        if (!base) return null;
        return { ...base, ...(value || {}) };
      })
      .filter((item): item is { status: string; enabled: boolean; color: string; label: string } => !!item && item.enabled);
  }

  async ngOnInit() {
    void this.loadDataSourceStatus();
    window.addEventListener('aurashine:appointment-settings-updated', this.settingsUpdatedEvent);
    window.addEventListener('storage', this.storageUpdatedHandler);
    this.updateCurrentTimeLine();
    this.currentTimeTimer = setInterval(() => this.updateCurrentTimeLine(), 30000);
    void this.loadRescheduleRequests();
    await Promise.all([this.loadClients(), this.loadStaff(), this.loadServices(), this.loadChairRooms(), this.loadOverlapSetting(), this.loadWaitlist(), this.loadBlackouts()]);
    await this.loadAppointments();
    this.connectLiveAppointments();
  }

  ngOnDestroy() {
    window.removeEventListener('aurashine:appointment-settings-updated', this.settingsUpdatedEvent);
    window.removeEventListener('storage', this.storageUpdatedHandler);
    this.stopActivityRefresh();
    if (this.currentTimeTimer) clearInterval(this.currentTimeTimer);
    if (this.liveReconnectTimer) clearTimeout(this.liveReconnectTimer);
    this.liveSocket?.close();
  }

  async loadAppointments() {
    try {
      const result = await this.getJson<ApiList<any>>('/api/v1/appointments');
      const rows = this.asArray(result).map((item) => this.toAppointment(item));
      this.appointmentRows = rows;
      this.mapAppointmentCards();
    } catch {
      this.appointmentRows = [];
      this.appointments = [];
    }
  }

  async refreshPreviousServices() {
    await this.loadAppointments();
  }

  async refreshBookingIntelligence() {
    const lines = this.bookingLines.filter((line) => line.serviceId && line.startTime);
    if (!lines.length) {
      this.bookingIntelligence = null;
      this.bookingIntelligenceError = 'Add a service and time first';
      return;
    }
    const request = ++this.bookingIntelligenceRequest;
    this.bookingIntelligenceLoading = true;
    this.bookingIntelligenceError = '';
    try {
      const result: any = await this.postJson('/api/v1/booking-intelligence/preview', {
        clientId: this.selectedClientId,
        lines: lines.map((line, index) => ({
          id: line.id,
          serviceId: line.serviceId,
          staffId: line.staffId,
          startAt: this.localDateTimeToIso(this.appointmentDate, line.startTime),
          parallel: index > 0 && line.startTime === lines[0].startTime,
        })),
      });
      if (request === this.bookingIntelligenceRequest) this.bookingIntelligence = (result?.data ?? result) as BookingIntelligence;
    } catch (error) {
      if (request === this.bookingIntelligenceRequest) this.bookingIntelligenceError = this.errorMessage(error, 'Unable to load booking plan');
    } finally {
      if (request === this.bookingIntelligenceRequest) this.bookingIntelligenceLoading = false;
    }
  }

  private refreshBookingIntelligenceIfReady() {
    if (this.selectedClientId && this.bookingLines.some((line) => line.serviceId && line.startTime)) {
      void this.refreshBookingIntelligence();
    }
  }
  applySequencePlan() {
    const plans = new Map((this.bookingIntelligence?.plan || []).map((item) => [item.lineId, item]));
    this.bookingLines = this.bookingLines.map((line) => {
      const plan = plans.get(line.id);
      if (!plan) return line;
      const date = new Date(plan.startAt);
      return { ...line, startTime: `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}` };
    });
  }

  applyAlternative(lineId: string, slot: { staffId: string; startAt: string }) {
    const staff = this.staff.find((person) => person.id === slot.staffId);
    const date = new Date(slot.startAt);
    this.bookingLines = this.bookingLines.map((line) => line.id !== lineId ? line : {
      ...line,
      staffId: slot.staffId,
      staffSearch: staff?.name || line.staffSearch,
      startTime: `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`,
    });
  }

  filteredClients() {
    const q = this.bookingClientSearch.trim().toLowerCase();
    if (!q) return this.clients.slice(0, 8);
    return this.clients
      .filter((client) => `${client.name} ${client.phone} ${client.email}`.toLowerCase().includes(q))
      .slice(0, 8);
  }

  filteredServices(line: BookingLine) {
    const q = line.serviceSearch.trim().toLowerCase();
    return this.services
      .filter((service) => service.active)
      .filter((service) => !q || `${service.name} ${service.category}`.toLowerCase().includes(q))
      .slice(0, 8);
  }

  filteredStaff(line: BookingLine) {
    const q = line.staffSearch.trim().toLowerCase();
    return this.staff
      .filter((person) => !line.serviceId || person.serviceIds.includes(line.serviceId))
      .filter((person) => !q || `${person.name} ${person.role}`.toLowerCase().includes(q))
      .slice(0, 8);
  }

  previousServices(): PreviousService[] {
    if (!this.selectedClientId) return [];
    return this.appointmentRows
      .filter((item) => item.clientId === this.selectedClientId)
      .slice(0, 5)
      .map((item) => {
        const serviceId = item.serviceIds[0] || '';
        const staffId = item.staffId || '';
        return {
          id: item.id,
          serviceName: this.serviceName(serviceId),
          staffName: this.staffName(staffId),
          date: this.shortDate(item.startAt),
          durationMinutes: this.minutesBetween(item.startAt, item.endAt),
          serviceId,
          staffId,
        };
      });
  }

  setView(mode: CalendarView) {
    this.activeView = mode;
    this.activeCommand = null;
    this.mapAppointmentCards();
    this.updateCurrentTimeLine();
  }

  setStaffGridMode(mode: StaffGridMode) {
    this.activeStaffGridMode = mode;
    this.activeCommand = null;
    this.hideAppointmentDetails();
    this.updateCurrentTimeLine();
  }

  openScheduledStaff() {
    this.newBookingOpen = false;
    this.activeCommand = null;
    this.scheduledStaffOpen = true;
  }

  closeScheduledStaff() {
    this.scheduledStaffOpen = false;
  }

  saveScheduledStaff() {
    try {
      localStorage.setItem(this.scheduledStaffKey, JSON.stringify({
        selectedIds: this.scheduledStaff.map((person) => person.id),
        orderedIds: this.staff.map((person) => person.id),
      }));
    } catch {
      // Local display preference does not block calendar work when storage is unavailable.
    }
    this.closeScheduledStaff();
  }

  resetScheduledStaff() {
    this.scheduledStaffSelection = Object.fromEntries(this.staff.map((person) => [person.id, true]));
    this.mapAppointmentCards();
  }

  toggleScheduledStaff(id: string, checked: boolean) {
    this.scheduledStaffSelection = { ...this.scheduledStaffSelection, [id]: checked };
    this.mapAppointmentCards();
  }

  moveScheduledStaff(id: string, direction: -1 | 1) {
    const index = this.staff.findIndex((person) => person.id === id);
    const next = index + direction;
    if (index < 0 || next < 0 || next >= this.staff.length) return;
    const reordered = [...this.staff];
    [reordered[index], reordered[next]] = [reordered[next], reordered[index]];
    this.staff = reordered;
    this.mapAppointmentCards();
  }

  onDateChange() {
    this.times = this.buildTimes();
    this.mapAppointmentCards();
    this.updateCurrentTimeLine();
  }

  openNewBooking() {
    this.activeCommand = null;
    this.selectedAppointment = null;
    const firstStaff = this.scheduledStaff[0] || this.staff[0];
    this.openBookingWithSlot(firstStaff?.id || '', this.times[0]);
  }

  openSlot(staffIndex: number, time: string) {
    const person = this.scheduledStaff[staffIndex];
    this.openBookingWithSlot(person?.id || '', time);
  }

  openColumnSlot(columnIndex: number, time: string, event: MouseEvent) {
    const column = this.calendarColumnsData[columnIndex];
    if (column?.date) this.appointmentDate = column.date;
    this.slotAction = {
      columnIndex,
      time,
      left: event.clientX + 12,
      top: event.clientY + 12,
    };
  }

  openSlotAction(action: 'booking' | 'block' | 'waitlist') {
    const slot = this.slotAction;
    if (!slot) return;

    const column = this.calendarColumnsData[slot.columnIndex];
    const staffId = column?.staffId || this.scheduledStaff[0]?.id || '';
    if (column?.date) this.appointmentDate = column.date;
    this.slotAction = null;

    if (action === 'booking') {
      this.openBookingWithSlot(staffId, slot.time);
      return;
    }

    this.commandStartTime = this.timeToInput(slot.time);
    if (action === 'block') {
      this.commandStaffId = staffId;
      this.commandStaffIds = staffId ? [staffId] : [];
    }
    this.openCommand(action);
  }

  closeNewBooking() {
    this.newBookingOpen = false;
    this.bookingError = '';
    this.editingAppointmentId = '';
    this.editingBookingGroupId = '';
    this.removedServiceAppointmentIds = [];
    this.rescheduleMode = false;
    this.rescheduleSelectedAppointmentIds = new Set<string>();
  }

  openCommand(command: ToolbarCommand) {
    this.newBookingOpen = false;
    this.selectedAppointment = null;
    this.activeCommand = command;
    this.commandError = '';
    if (command === 'block') {
      const calendarStaffIds = new Set(this.scheduledStaff.map((person) => person.id));
      this.commandStaffIds = this.commandStaffIds.filter((id) => calendarStaffIds.has(id));
      this.commandStaffId = this.commandStaffIds[0] || this.scheduledStaff[0]?.id || '';
      if (!this.commandStaffIds.length && this.commandStaffId) this.commandStaffIds = [this.commandStaffId];
    } else {
      this.commandStaffId = this.commandStaffId || this.staff[0]?.id || '';
    }
    this.commandClientId = this.commandClientId || this.clients[0]?.id || '';
    this.commandServiceId = this.commandServiceId || this.services[0]?.id || '';
    this.commandAppointmentId = this.commandAppointmentId || this.appointmentRows[0]?.id || '';
    if (command === 'waitlist') void this.loadWaitlist();
    if (command === 'block') void this.loadBlackouts();
  }

  closeCommand() {
    this.activeCommand = null;
    this.commandError = '';
  }

  async saveCommand() {
    if (!this.activeCommand) return;

    this.commandError = '';
    this.commandSaving = true;

    try {
      if (this.activeCommand === 'block') {
        const staffIds = [...new Set(this.commandStaffIds.filter(Boolean))];
        if (!staffIds.length) throw new Error('Select at least one staff member');
        const blockedUntil = this.localDateTimeToIso(
          this.appointmentDate,
          this.addMinutesToTime(this.commandStartTime, this.commandDurationMinutes || 30),
        );
        await this.postJson('/api/v1/blackouts', {
          staff_ids: staffIds,
          blackout_date: this.appointmentDate,
          blocked_from: this.localDateTimeToIso(this.appointmentDate, this.commandStartTime),
          reason: this.commandReason.trim() || 'blocked',
          blocked_until: blockedUntil,
        });
      }

      if (this.activeCommand === 'waitlist') {
        if (!this.commandClientId) throw new Error('Client required');
        await this.postJson('/api/v1/smart-booking/waitlist', {
          customer_id: this.commandClientId,
          service_ids: this.commandServiceId ? [this.commandServiceId] : [],
          preferred_slot_at: this.localDateTimeToIso(this.appointmentDate, this.commandStartTime),
          notes: this.commandReason.trim(),
        });
      }

      if (this.activeCommand === 'move') {
        if (!this.commandAppointmentId) throw new Error('Appointment required');
        const current = this.appointmentRows.find((item) => item.id === this.commandAppointmentId);
        const duration = current ? this.minutesBetween(current.startAt, current.endAt) : this.commandDurationMinutes || 30;
        const startAt = this.localDateTimeToIso(this.appointmentDate, this.commandStartTime);
        await this.postJson(`/api/v1/appointments/${this.commandAppointmentId}/reschedule`, {
          start_at: startAt,
          end_at: this.localDateTimeToIso(this.appointmentDate, this.addMinutesToTime(this.commandStartTime, duration)),
          staff_id: this.commandStaffId,
          reason: this.commandReason.trim(),
        });
      }

      await Promise.all([this.loadAppointments(), this.loadWaitlist(), this.loadBlackouts()]);
      this.closeCommand();
    } catch (error) {
      this.commandError = this.errorMessage(error, 'Action failed');
    } finally {
      this.commandSaving = false;
    }
  }

  setBlockStaffIds(staffIds: string[]) {
    this.commandStaffIds = staffIds || [];
    this.commandStaffId = this.commandStaffIds[0] || '';
  }

  toggleBlockStaff(staffId: string, selected: boolean) {
    this.setBlockStaffIds(selected
      ? [...this.commandStaffIds, staffId]
      : this.commandStaffIds.filter((id) => id !== staffId));
  }

  selectAllBlockStaff() {
    this.setBlockStaffIds(this.scheduledStaff.map((person) => person.id));
  }

  setClientSearch(value: string) {
    this.bookingClientSearch = value;
    const selected = this.clients.find((client) => client.id === this.selectedClientId);
    if (selected && value !== this.clientLabel(selected)) {
      this.selectedClientId = '';
      this.bookingClientKpi = null;
      this.bookingIntelligence = null;
      this.bookingClientKpiRequest += 1;
    }
  }

  selectClient(client: ClientOption) {
    this.selectedClientId = client.id;
    this.bookingClientSearch = this.clientLabel(client);
    this.bookingLines = this.bookingLines.map((line) => line.clientId ? line : {
      ...line,
      clientId: client.id,
      clientSearch: this.clientLabel(client),
    });
    void this.loadBookingClientKpi(client.id);
    this.refreshBookingIntelligenceIfReady();
  }

  addPreviousServiceToBooking(item: PreviousService) {
    const line = this.blankLine(item.staffId || this.bookingLines[0]?.staffId || '', this.bookingLines[0]?.startTime || this.timeToInput(this.times[0]));
    const service = this.services.find((entry) => entry.id === item.serviceId);
    const staff = this.staff.find((entry) => entry.id === item.staffId);
    line.serviceId = item.serviceId;
    line.serviceSearch = service?.name || item.serviceName;
    line.staffId = item.staffId;
    line.staffSearch = staff?.name || item.staffName;
    line.durationMinutes = service?.durationMinutes || item.durationMinutes || 30;
    this.bookingLines = [...this.bookingLines, line];
  }

  addServiceLine() {
    const last = this.bookingLines[this.bookingLines.length - 1];
    const startTime = last ? this.addMinutesToTime(last.startTime, last.durationMinutes || 30) : this.timeToInput(this.times[0]);
    this.bookingLines = [...this.bookingLines, this.blankLine(last?.staffId || this.staff[0]?.id || '', startTime)];
  }

  addParallelServiceLine() {
    const base = this.bookingLines[0];
    const nextStaff = this.staff.find((person) => person.id !== base?.staffId)?.id || '';
    this.bookingLines = [...this.bookingLines, this.blankLine(nextStaff, base?.startTime || this.timeToInput(this.times[0]))];
  }

  filteredLineClients(line: BookingLine) {
    const q = line.clientSearch.trim().toLowerCase();
    return this.clients
      .filter((client) => !q || `${client.name} ${client.phone} ${client.email}`.toLowerCase().includes(q))
      .slice(0, 8);
  }

  setLineClientSearch(line: BookingLine, value: string) {
    line.clientSearch = value;
    line.clientId = '';
    line.clientOpen = true;
  }

  selectLineClient(line: BookingLine, client: ClientOption) {
    line.clientId = client.id;
    line.clientSearch = this.clientLabel(client);
    line.clientOpen = false;
  }

  removeServiceLine(lineId: string) {
    if (this.bookingLines.length === 1) return;
    const line = this.bookingLines.find((item) => item.id === lineId);
    if (line?.appointmentId) this.removedServiceAppointmentIds = [...this.removedServiceAppointmentIds, line.appointmentId];
    this.bookingLines = this.bookingLines.filter((line) => line.id !== lineId);
  }

  setServiceSearch(line: BookingLine, value: string) {
    line.serviceSearch = value;
    line.serviceId = '';
    line.serviceOpen = true;
  }

  selectService(line: BookingLine, service: ServiceOption) {
    line.serviceId = service.id;
    line.serviceSearch = service.name;
    line.durationMinutes = service.durationMinutes || line.durationMinutes || 30;
    line.serviceOpen = false;
    line.variantId = '';
    line.addonIds = [];
    this.refreshBookingIntelligenceIfReady();
  }

  serviceVariants(line: BookingLine) { return this.services.find((service) => service.id === line.serviceId)?.variants || []; }
  serviceAddons(line: BookingLine) { return this.services.find((service) => service.id === line.serviceId)?.addons || []; }
  selectVariant(line: BookingLine, variantId: string) {
    line.variantId = variantId;
    const service = this.services.find((item) => item.id === line.serviceId);
    const variant = service?.variants.find((item) => item.id === variantId);
    line.durationMinutes = Math.max(15, (service?.durationMinutes || 30) + (variant?.durationDeltaMinutes || 0));
  }
  toggleAddon(line: BookingLine, addonId: string) {
    line.addonIds = line.addonIds.includes(addonId)
      ? line.addonIds.filter((id) => id !== addonId)
      : [...line.addonIds, addonId];
  }

  setStaffSearch(line: BookingLine, value: string) {
    line.staffSearch = value;
    line.staffId = '';
    line.staffOpen = true;
  }

  selectStaff(line: BookingLine, person: StaffOption) {
    line.staffId = person.id;
    line.staffSearch = person.name;
    if (line.staffPreference !== 'any' && (!line.appointmentId || !line.requestedStaffId)) {
      line.requestedStaffId = person.id;
    }
    line.staffOpen = false;
    this.refreshBookingIntelligenceIfReady();
  }

  toggleStaffRequest(line: BookingLine) {
    if (!line.staffId) return;
    this.setStaffPreference(line, line.staffPreference === 'any' ? 'preferred' : 'any');
  }

  setStaffPreference(line: BookingLine, preference: 'any' | 'preferred' | 'required') {
    line.staffPreference = preference;
    line.requestedStaffId = preference === 'any' ? '' : (line.requestedStaffId || line.staffId);
  }

  addSelectedPreviousService(item: PreviousService) {
    this.addPreviousServiceToBooking(item);
  }

  async createBooking(skipStaffChangeReview = false) {
    this.bookingError = '';
    if (!this.selectedClientId || this.bookingLines.some((line) => !line.clientId)) {
      this.bookingError = 'Client required';
      return;
    }

    const validLines = this.bookingLines.filter((line) => line.serviceId && line.staffId && line.startTime);
    if (!validLines.length || validLines.length !== this.bookingLines.length) {
      this.bookingError = 'Service, staff, and time required';
      return;
    }
    if (!this.editingAppointmentId && this.recurrenceFrequency !== 'none'
      && (!Number.isInteger(Number(this.recurrenceCount)) || Number(this.recurrenceCount) < 2 || Number(this.recurrenceCount) > 52)) {
      this.bookingError = 'Recurring booking occurrences must be between 2 and 52';
      return;
    }
    if (validLines.some((line) => this.hasStaffBlackout(line.staffId, line.startTime, line.durationMinutes))) {
      this.bookingError = 'Staff is unavailable for this blocked time';
      return;
    }
    if (!this.appointmentSettings.overlapTimeSlot && validLines.some((line) => this.hasOverlap(line))) {
      this.bookingError = 'Time slot already booked';
      return;
    }
    if (!this.appointmentSettings.overlapTimeSlot && validLines.some((line) => this.hasChairRoomOverlap(line))) {
      this.bookingError = 'Selected chair or room is already booked for this time';
      return;
    }
    if (!skipStaffChangeReview && this.pendingStaffChanges().length) {
      this.staffChangeReviewOpen = true;
      return;
    }
    if (this.rescheduleMode) {
      await this.submitOfficialReschedule(validLines);
      return;
    }

    this.savingBooking = true;
    try {
      const bookingGroupId = this.editingAppointmentId
        ? this.editingBookingGroupId
        : (validLines.length > 1 ? crypto.randomUUID() : '');
      await this.postJson('/api/v1/appointments/batch', {
        client_id: this.selectedClientId,
        status: this.statusFromLabel(this.appointmentSettings.defaultStatus),
        booking_group_id: bookingGroupId,
        removed_appointment_ids: [...new Set(this.removedServiceAppointmentIds)],
        recurrence_count: this.editingAppointmentId || this.recurrenceFrequency === 'none' ? 1 : Number(this.recurrenceCount),
        recurrence_interval_days: this.recurrenceFrequency === 'fortnightly' ? 14 : this.recurrenceFrequency === 'monthly' ? 28 : 7,
        lines: validLines.map((line) => ({
          appointment_id: line.appointmentId,
          client_id: line.clientId,
          staff_id: line.staffId,
          requested_staff_id: line.requestedStaffId,
          staff_preference: line.staffPreference,
          staff_change_approval: line.staffChangeApproval,
          staff_change_reason: line.staffChangeReason.trim(),
          service_id: line.serviceId,
          start_at: this.localDateTimeToIso(this.appointmentDate, line.startTime),
          end_at: this.localDateTimeToIso(
            this.appointmentDate,
            this.addMinutesToTime(line.startTime, line.durationMinutes || 30),
          ),
          chair_room_id: line.chairRoomId,
          notes: this.bookingNotesFor(line),
          variant_id: line.variantId,
          addon_ids: line.addonIds,
        })),
      });

      await this.loadAppointments();
      this.closeNewBooking();
    } catch (error) {
      this.bookingError = error instanceof Error ? error.message : 'Unable to create booking';
    } finally {
      this.savingBooking = false;
    }
  }

  private async submitOfficialReschedule(lines: BookingLine[]) {
    const targets = [...new Map(lines.filter((line) => line.appointmentId && this.isRescheduleLineSelected(line)).map((line) => [line.appointmentId, line])).values()];
    if (!targets.length) {
      this.bookingError = 'Choose at least one service to reschedule';
      return;
    }
    this.savingBooking = true;
    try {
      for (const line of targets) {
        await this.postJson(`/api/v1/appointments/${line.appointmentId}/reschedule`, {
          start_at: this.localDateTimeToIso(this.appointmentDate, line.startTime),
          end_at: this.localDateTimeToIso(this.appointmentDate, this.addMinutesToTime(line.startTime, line.durationMinutes || 30)),
          staff_id: line.staffId,
          chair_room_id: line.chairRoomId,
          reason: 'Rescheduled from CRM',
          booking_group_id: this.editingBookingGroupId,
          change_mode: 'official',
          actor_source: 'crm',
          staff_change_approval: line.staffChangeApproval,
          staff_change_reason: line.staffChangeReason.trim(),
        });
      }
      await this.loadAppointments();
      this.closeNewBooking();
    } catch (error) {
      this.bookingError = error instanceof Error ? error.message : 'Unable to reschedule booking';
    } finally {
      this.savingBooking = false;
    }
  }

  confirmStaffChanges() {
    const pending = this.pendingStaffChanges();
    for (const line of pending) {
      if (line.staffPreference === 'required' && line.staffChangeApproval !== 'client-approved') {
        this.bookingError = 'Client approval is required to change required staff';
        return;
      }
      if (line.staffPreference === 'preferred' && !line.staffChangeApproval) {
        this.bookingError = 'Choose client approval or manager override';
        return;
      }
      if (line.staffChangeApproval === 'manager-override' && !line.staffChangeReason.trim()) {
        this.bookingError = 'Manager override reason is required';
        return;
      }
    }
    this.staffChangeReviewOpen = false;
    void this.createBooking(true);
  }

  pendingStaffChanges() {
    return this.bookingLines.filter((line) => line.appointmentId
      && line.initialStaffId !== line.staffId
      && line.staffPreference !== 'any'
      && line.requestedStaffId
      && line.requestedStaffId !== line.staffId);
  }

  trackByIndex(index: number) {
    return index;
  }

  trackLine(_: number, line: BookingLine) {
    return line.id;
  }

  showAppointmentDetails(card: AppointmentCard, event: MouseEvent | FocusEvent) {
    this.hoveredAppointment = { card, ...this.appointmentHoverPoint(event) };
  }

  moveAppointmentDetails(event: MouseEvent) {
    if (!this.hoveredAppointment) return;
    this.hoveredAppointment = { ...this.hoveredAppointment, ...this.appointmentHoverPoint(event) };
  }

  hideAppointmentDetails() {
    this.hoveredAppointment = null;
  }

  showSlotTime(column: CalendarColumn, time: string, event: MouseEvent | FocusEvent) {
    this.hoveredSlot = { time, staff: column.title, ...this.slotHoverPoint(event) };
  }

  moveSlotTime(event: MouseEvent) {
    if (!this.hoveredSlot) return;
    this.hoveredSlot = { ...this.hoveredSlot, ...this.slotHoverPoint(event) };
  }

  hideSlotTime() {
    this.hoveredSlot = null;
  }

  openAppointment(card: AppointmentCard) {
    this.newBookingOpen = false;
    this.activeCommand = null;
    this.scheduledStaffOpen = false;
    this.appointmentActionError = '';
    this.statusSaving = '';
    this.activityRefreshError = '';
    const source = this.appointments.find((item) => item.id === card.id) ?? card;
    const groupedServiceIds = this.bookingGroupRows(source).flatMap((item) => item.serviceIds);
    this.selectedAppointment = {
      ...source,
      serviceIds: groupedServiceIds,
      service: groupedServiceIds.map((id) => this.serviceName(id)).filter(Boolean).join(', ') || source.service,
      detailRows: [],
    };
    this.selectedAppointment.detailRows = this.appointmentDetailRows(this.selectedAppointment);
    this.appointmentDetailTab = 'booking';
    this.appointmentNoteDraft = source.notes;

    void this.refreshAppointmentActivity();
  }

  closeAppointmentDetail() {
    this.closeNoShowDrawer();
    this.selectedAppointment = null;
    this.appointmentDetailTab = 'booking';
    this.appointmentNoteDraft = '';
    this.appointmentActionError = '';
    this.appointmentActionMessage = '';
    this.statusSaving = '';
    this.activityRefreshError = '';
    this.stopActivityRefresh();
  }

  setAppointmentDetailTab(tab: 'booking' | 'activity') {
    this.appointmentDetailTab = tab;
    if (tab === 'activity') {
      void this.refreshAppointmentActivity();
      this.startActivityRefresh();
    } else {
      this.stopActivityRefresh();
    }
  }

  async setAppointmentStatus(status: string) {
    if (!this.selectedAppointment) return;
    if (this.statusSaving === status || (status !== 'completed' && this.selectedAppointment.status === status)) return;

    const targetId = this.selectedAppointment.id;
    if (status === 'no-show') {
      this.openNoShowDrawer();
      return;
    }
    if (status === 'completed') {
      this.appointmentActionError = '';
      this.statusSaving = status;
      try {
        const result: any = await this.postJson(`/api/v1/appointments/${targetId}/convert-to-sale`, {});
        const response = result?.data ?? result;
        const sale = response?.sales_order ?? response?.salesOrder;
        const saleId = String(sale?.sale_id ?? sale?.saleId ?? '');
        if (!saleId) throw new Error('Appointment invoice was not created');
        await this.loadAppointments();
        if (sale?.status && sale.status !== 'draft') {
          await this.router.navigate(['/pos/invoices']);
        } else {
          await this.router.navigate(['/pos'], { queryParams: { draft: saleId } });
        }
      } catch (error) {
        this.appointmentActionError = this.errorMessage(error, 'Unable to create appointment invoice');
        await this.loadAppointments().catch(() => {});
        this.selectedAppointment = this.appointments.find((item) => item.id === targetId) || null;
      } finally {
        this.statusSaving = '';
      }
      return;
    }
    this.appointmentActionError = '';
    this.statusSaving = status;

    try {
      const keepTab = this.appointmentDetailTab;
      await this.postJson<any>(`/api/v1/appointments/${targetId}/status`, {
        status,
        reason: '',
        apply_group: true,
      });
      await this.loadAppointments();

      this.selectedAppointment = this.appointments.find((item) => item.id === targetId) || null;
      this.appointmentDetailTab = keepTab;
      if (!this.selectedAppointment) {
        this.appointmentNoteDraft = '';
      } else {
        this.appointmentNoteDraft = this.selectedAppointment.notes;
      }
      await this.refreshAppointmentActivity();
    } catch (error) {
      this.appointmentActionError = error instanceof Error ? error.message : 'Unable to update status';
      await this.loadAppointments().catch(() => {});
      if (this.selectedAppointment) {
        this.selectedAppointment = this.appointments.find((item) => item.id === this.selectedAppointment!.id) || null;
      }
    } finally {
      this.statusSaving = '';
    }
  }

  openNoShowDrawer() {
    if (!this.selectedAppointment) return;
    this.appointmentActionError = '';
    this.appointmentActionMessage = '';
    this.noShowAmount = '';
    this.noShowProvider = 'razorpay';
    this.noShowDrawerOpen = true;
  }

  closeNoShowDrawer() {
    this.noShowDrawerOpen = false;
    this.noShowAmount = '';
    this.noShowSaving = false;
  }

  async submitNoShow(createCharge: boolean) {
    if (!this.selectedAppointment || this.noShowSaving) return;
    const appointmentId = this.selectedAppointment.id;
    const amountPaise = Math.round(Number(this.noShowAmount) * 100);
    if (createCharge && (!Number.isFinite(amountPaise) || amountPaise <= 0)) {
      this.appointmentActionError = 'No-show fee amount is required';
      return;
    }
    this.noShowSaving = true;
    this.appointmentActionError = '';
    this.appointmentActionMessage = '';
    try {
      if (createCharge) {
        const result: any = await this.postJson(`/api/v1/appointments/${appointmentId}/no-show-charge`, {
          amountPaise,
          provider: this.noShowProvider,
          idempotencyKey: `no-show-${appointmentId}-${Date.now()}`,
        });
        const charge = (result?.data ?? result)?.charge;
        const link = charge?.paymentLink?.url;
        if (link) {
          await navigator.clipboard.writeText(link).catch(() => undefined);
          this.appointmentActionMessage = 'No-show invoice and payment link created';
        } else if (charge?.activationRequired) {
          this.appointmentActionMessage = 'No-show invoice created; provider activation pending';
        } else {
          this.appointmentActionMessage = 'No-show invoice created';
        }
      } else {
        await this.postJson(`/api/v1/appointments/${appointmentId}/status`, {
          status: 'no-show',
          reason: 'no show',
          apply_group: false,
        });
        this.appointmentActionMessage = 'Appointment marked no-show';
      }
      this.closeNoShowDrawer();
      await this.loadAppointments();
      this.selectedAppointment = null;
    } catch (error) {
      this.appointmentActionError = this.errorMessage(error, 'Unable to complete no-show action');
      this.noShowSaving = false;
    }
  }

  async saveAppointmentNotes() {
    if (!this.selectedAppointment || this.notesSaving) return;
    const targetId = this.selectedAppointment.id;
    this.notesSaving = true;
    this.appointmentActionError = '';
    try {
      await this.postJson(`/api/v1/appointments/${targetId}/notes`, {
        notes: this.appointmentNoteDraft,
      });
      await this.loadAppointments();
      const refreshed = this.appointments.find((item) => item.id === targetId);
      if (refreshed) this.openAppointment(refreshed);
    } catch (error) {
      this.appointmentActionError = this.errorMessage(error, 'Unable to save appointment notes');
    } finally {
      this.notesSaving = false;
    }
  }

  openEditAppointment(card: AppointmentCard) {
    this.editingAppointmentId = card.id;
    this.editingBookingGroupId = card.bookingGroupId || crypto.randomUUID();
    this.removedServiceAppointmentIds = [];
    this.selectedAppointment = null;
    this.newBookingOpen = true;
    this.bookingError = '';
    this.selectedClientId = card.clientId;
    const client = this.clients.find((entry) => entry.id === card.clientId);
    this.bookingClientSearch = client ? this.clientLabel(client) : card.client;
    void this.loadBookingClientKpi(card.clientId);
    this.bookingNotes = card.notes;
    this.notifyStaff = true;
    const rows = this.bookingGroupRows(card);
    this.bookingLines = rows.length
      ? rows.flatMap((row) => (row.serviceIds.length ? row.serviceIds : ['']).map((serviceId) => {
          const line = this.blankLine(row.staffId, this.timeToInput(this.timeText(row.startAt)));
          const service = this.services.find((entry) => entry.id === serviceId);
          line.appointmentId = row.id;
          line.clientId = row.clientId;
          line.clientSearch = this.clientLabel(this.clients.find((entry) => entry.id === row.clientId));
          line.serviceId = serviceId;
          line.serviceSearch = service?.name || this.serviceName(serviceId);
          line.durationMinutes = service?.durationMinutes || line.durationMinutes;
          line.chairRoomId = row.chairRoomId;
          line.initialStaffId = row.staffId;
          line.requestedStaffId = row.requestedStaffId;
          line.staffPreference = row.staffPreference;
          return line;
        }))
      : [this.blankLine(card.staffId, this.timeToInput(this.timeText(card.startAt)))];
  }

  openRescheduleAppointment(card: AppointmentCard) {
    this.openEditAppointment(card);
    this.rescheduleMode = true;
    this.rescheduleSelectedAppointmentIds = new Set(this.bookingLines.map((line) => line.appointmentId).filter(Boolean));
  }

  isRescheduleLineSelected(line: BookingLine) {
    return !!line.appointmentId && this.rescheduleSelectedAppointmentIds.has(line.appointmentId);
  }

  get selectedRescheduleRequests() {
    const appointmentId = this.selectedAppointment?.id || '';
    return this.rescheduleRequests.filter((item) => String(item.appointmentId || '') === appointmentId);
  }

  private async loadRescheduleRequests() {
    try {
      const result = await this.getJson<any>('/api/v1/appointment-reschedule-requests');
      this.rescheduleRequests = this.asArray(result?.data ?? result);
    } catch {
      this.rescheduleRequests = [];
    }
  }

  async decideRescheduleRequest(requestId: string, approved: boolean) {
    this.appointmentActionError = '';
    try {
      await this.postJson(`/api/v1/appointment-reschedule-requests/${requestId}/${approved ? 'approve' : 'reject'}`, { reason: approved ? 'Approved by CRM' : 'Rejected by CRM' });
      await Promise.all([this.loadAppointments(), this.loadRescheduleRequests()]);
      if (this.selectedAppointment) {
        const refreshed = this.appointments.find((item) => item.id === this.selectedAppointment?.id);
        if (refreshed) this.openAppointment(refreshed);
      }
    } catch (error) {
      this.appointmentActionError = this.errorMessage(error, 'Unable to decide reschedule request');
    }
  }

  toggleRescheduleLine(line: BookingLine, selected: boolean) {
    if (!line.appointmentId) return;
    const next = new Set(this.rescheduleSelectedAppointmentIds);
    if (selected) next.add(line.appointmentId);
    else next.delete(line.appointmentId);
    this.rescheduleSelectedAppointmentIds = next;
  }

  async sendClientSms(card: AppointmentCard) {
    if (!this.clientPhone(card.clientId) || this.clientSmsSending) return;
    this.clientSmsSending = true;
    this.appointmentActionError = '';
    this.appointmentActionMessage = '';
    try {
      await this.postJson(`/api/v1/appointment-sms/appointments/${encodeURIComponent(card.id)}/queue`, {
        channel: 'sms',
        message: `Appointment update: ${card.service} is ${card.status} for ${card.time}.`,
      });
      this.appointmentActionMessage = 'Appointment SMS queued';
    } catch (error) {
      this.appointmentActionError = this.errorMessage(error, 'Unable to queue appointment SMS');
    } finally {
      this.clientSmsSending = false;
    }
  }

  serviceBillLines(card: AppointmentCard) {
    return this.bookingGroupRows(card).flatMap((appointment, appointmentIndex) => {
      const entries = appointment.serviceIds.length ? appointment.serviceIds : [''];
      return entries.map((serviceId, serviceIndex) => {
      const service = this.services.find((entry) => entry.id === serviceId);
      return {
        id: `${appointment.id}-${serviceId || serviceIndex}`,
        serviceName: service?.name || card.service,
        startTime: `${this.timeText(appointment.startAt)} - ${this.timeText(appointment.endAt)}`,
        staffName: this.staffName(appointment.staffId),
        quantity: '1',
        price: service?.priceText || '',
        discount: '',
        total: appointmentIndex === 0 && serviceIndex === 0 ? card.amountText : '',
      };
      });
    });
  }

  formatActivityTime(value: string) {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return date.toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: 'numeric', minute: '2-digit' });
  }

  private async loadDataSourceStatus() {
    try {
      await firstValueFrom(this.api.get('/health'));
      this.dataSourceStatus = { label: 'Real data only', online: true };
    } catch {
      this.dataSourceStatus = { label: 'Backend offline', online: false };
    }
  }

  private async loadClients() {
    try {
      const result = await this.getJson<ApiList<any>>('/api/v1/clients');
      this.clients = this.asArray(result).map((client) => ({
        id: String(client.id || ''),
        name: [client.firstName || client.first_name, client.lastName || client.last_name].filter(Boolean).join(' ').trim(),
        phone: String(client.phone || ''),
        email: String(client.email || ''),
      })).filter((client) => client.id);
    } catch {
      this.clients = [];
    }
  }

  private async loadBookingClientKpi(clientId: string) {
    const request = ++this.bookingClientKpiRequest;
    this.bookingClientKpi = null;
    this.bookingClientKpiLoading = true;
    try {
      const result: any = await this.getJson(`/api/v1/pos/clients/${clientId}/kpi`);
      if (request !== this.bookingClientKpiRequest) return;
      const kpi = result?.data ?? result;
      this.bookingClientKpi = {
        walletPaise: Number(kpi?.walletPaise ?? kpi?.wallet_paise ?? 0) || 0,
        unpaidPaise: Number(kpi?.unpaidPaise ?? kpi?.unpaid_paise ?? 0) || 0,
        membershipAssignDate: kpi?.membershipAssignDate ?? kpi?.membership_assigned_at ?? null,
        membershipExpireDate: kpi?.membershipExpireDate ?? kpi?.membership_expires_at ?? null,
        hasActiveMembership: Boolean(kpi?.hasActiveMembership ?? kpi?.has_active_membership),
      };
    } catch {
      if (request === this.bookingClientKpiRequest) this.bookingClientKpi = null;
    } finally {
      if (request === this.bookingClientKpiRequest) this.bookingClientKpiLoading = false;
    }
  }

  private restoreScheduledStaffPreference() {
    let saved: { selectedIds?: unknown; orderedIds?: unknown } = {};
    try {
      const raw = localStorage.getItem(this.scheduledStaffKey);
      if (raw) saved = JSON.parse(raw);
    } catch {
      saved = {};
    }
    const orderedIds = Array.isArray(saved.orderedIds)
      ? saved.orderedIds.filter((id): id is string => typeof id === 'string')
      : [];
    const selectedIds = Array.isArray(saved.selectedIds)
      ? saved.selectedIds.filter((id): id is string => typeof id === 'string')
      : this.staff.map((person) => person.id);
    const byId = new Map(this.staff.map((person) => [person.id, person]));
    const orderedStaff = orderedIds
      .map((id) => byId.get(id))
      .filter((person): person is StaffOption => !!person);
    const restoredIds = new Set(orderedStaff.map((person) => person.id));
    this.staff = [...orderedStaff, ...this.staff.filter((person) => !restoredIds.has(person.id))];
    const selected = new Set(selectedIds);
    this.scheduledStaffSelection = Object.fromEntries(
      this.staff.map((person) => [person.id, selected.has(person.id)]),
    );
  }

  private async loadStaff() {
    try {
      const result = await this.getJson<ApiList<any>>('/api/v1/staff?active=true');
      this.staff = this.asArray(result).map((person) => {
        const firstName = person.firstName || person.first_name || '';
        const lastName = person.lastName || person.last_name || '';
        const displayName = person.appointmentDisplayName || person.appointment_display_name || '';
        const name = displayName || [firstName, lastName].filter(Boolean).join(' ');
        const serviceIds = Array.isArray(person.serviceIds)
          ? person.serviceIds
          : Array.isArray(person.service_ids)
            ? person.service_ids
            : [];
        return {
          id: String(person.id || ''),
          initials: this.initials(firstName || name, lastName),
          name,
          role: person.jobTitle || person.job_title || 'All services',
          serviceIds: serviceIds.map((id: unknown) => String(id)).filter(Boolean),
        };
      }).filter((person) => person.id);
      this.restoreScheduledStaffPreference();
      this.mapAppointmentCards();
    } catch {
      this.staff = [];
      this.appointments = [];
    }
  }

  private async loadServices() {
    try {
      const result = await this.getJson<ApiList<any>>('/api/v1/services');
      this.services = this.asArray(result).map((service) => ({
        id: String(service.id || ''),
        name: String(service.name || ''),
        category: String(service.category || ''),
        durationMinutes: Number(service.durationMinutes ?? service.duration_minutes ?? 30) || 30,
        active: service.active !== false,
        priceText: this.priceText(service),
        variants: Array.isArray(service.variants) ? service.variants : [],
        addons: Array.isArray(service.addons) ? service.addons : [],
      })).filter((service) => service.id);
      this.mapAppointmentCards();
    } catch {
      this.services = [];
    }
  }

  private async loadChairRooms() {
    try {
      const result = await this.getJson<ApiList<any>>('/api/v1/appointment-resources');
      this.chairRooms = this.asArray(result).map((item) => ({
        id: String(item.id || ''), name: String(item.name || ''), kind: String(item.kind || 'chair'),
      })).filter((item) => item.id && item.name);
    } catch {
      this.chairRooms = [];
    }
  }

  private async loadWaitlist() {
    try {
      const result = await this.getJson<ApiList<any>>('/api/v1/smart-booking/waitlist');
      this.waitlistEntries = this.asArray(result).map((item) => ({
        id: String(item.id || ''),
        customerId: String(item.customerId || item.customer_id || ''),
        serviceIds: Array.isArray(item.serviceIds) ? item.serviceIds : Array.isArray(item.service_ids) ? item.service_ids : [],
        preferredSlotAt: String(item.preferredSlotAt || item.preferred_slot_at || ''),
        notes: String(item.notes || ''),
      })).filter((item) => item.id);
    } catch {
      this.waitlistEntries = [];
    }
  }

  private async loadBlackouts() {
    try {
      const result = await this.getJson<ApiList<any>>('/api/v1/blackouts');
      this.blackouts = this.asArray(result).map((item) => ({
        id: String(item.id || ''),
        staffId: String(item.staffId || item.staff_id || ''),
        blackoutGroupId: String(item.blackoutGroupId || item.blackout_group_id || ''),
        blackoutDate: String(item.blackoutDate || item.blackout_date || ''),
        blockedFrom: String(item.blockedFrom || item.blocked_from || ''),
        blockedUntil: String(item.blockedUntil || item.blocked_until || ''),
        reason: String(item.reason || ''),
      })).filter((item) => item.id);
    } catch {
      this.blackouts = [];
    }
  }

  async removeWaitlist(id: string) {
    try {
      await this.deleteJson(`/api/v1/smart-booking/waitlist/${id}`);
      await this.loadWaitlist();
    } catch (error) {
      this.commandError = this.errorMessage(error, 'Unable to remove waitlist entry');
    }
  }

  async removeBlackout(id: string) {
    try {
      await this.deleteJson(`/api/v1/blackouts/${id}`);
      await this.loadBlackouts();
    } catch (error) {
      this.commandError = this.errorMessage(error, 'Unable to remove blocked time');
    }
  }

  waitlistLabel(entry: WaitlistEntry) {
    const service = entry.serviceIds.map((id) => this.serviceName(id)).filter(Boolean).join(', ');
    return `${this.clientName(entry.customerId)} · ${service || 'Service'} · ${this.shortDate(entry.preferredSlotAt)} ${this.timeText(entry.preferredSlotAt)}`;
  }

  blackoutLabel(entry: BlackoutEntry) {
    const groupedEntries = entry.blackoutGroupId
      ? this.blackouts.filter((item) => item.blackoutGroupId === entry.blackoutGroupId)
      : [entry];
    const staffNames = groupedEntries
      .map((item) => this.staffName(item.staffId) || 'All staff')
      .filter((name, index, names) => names.indexOf(name) === index)
      .join(', ');
    return `${staffNames} · ${this.shortDate(entry.blockedFrom || entry.blackoutDate)} ${this.timeText(entry.blockedFrom)} - ${this.timeText(entry.blockedUntil)}`;
  }

  isBlackoutForColumn(entry: BlackoutEntry, column: CalendarColumn) {
    return Boolean(entry.blockedFrom)
      && entry.blockedFrom.slice(0, 10) === column.date
      && (this.activeView !== 'Day' || entry.staffId === column.staffId);
  }

  blackoutTop(entry: BlackoutEntry) {
    const start = new Date(entry.blockedFrom);
    return Math.max(0, ((start.getHours() * 60 + start.getMinutes() - this.minutesFromTime(this.appointmentSettings.startTime)) / this.appointmentSettings.slotMinutes) * this.calendarSlotHeight);
  }

  blackoutHeight(entry: BlackoutEntry) {
    return Math.max(this.calendarSlotHeight, (this.minutesBetween(entry.blockedFrom, entry.blockedUntil) / this.appointmentSettings.slotMinutes) * this.calendarSlotHeight - 4);
  }

  private async loadOverlapSetting() {
    try {
      const result = await this.getJson<any>('/api/v1/appointment-settings');
      const body = result?.data ?? result;
      this.appointmentSettings = {
        ...this.defaultAppointmentSettings(),
        ...(body?.settings && typeof body.settings === 'object' ? body.settings : {}),
        overlapTimeSlot: Boolean(body?.allowOverlap ?? body?.allow_overlap),
      };
      localStorage.setItem(this.settingsKey, JSON.stringify(this.appointmentSettings));
      this.times = this.buildTimes();
    } catch {
      // Existing local preference remains available while offline.
    }
  }

  startDrag(card: AppointmentCard) {
    this.draggedAppointment = card;
  }

  async dropAppointment(column: CalendarColumn, time: string, event: DragEvent) {
    event.preventDefault();
    const dragged = this.draggedAppointment;
    this.draggedAppointment = null;
    if (!dragged) return;
    const date = column.date || this.appointmentDate;
    const startAt = this.localDateTimeToIso(date, this.timeToInput(time));
    const duration = this.minutesBetween(dragged.startAt, dragged.endAt) || 30;
    const nextStaffId = column.staffId || dragged.staffId;
    if (nextStaffId !== dragged.staffId
      && dragged.staffPreference !== 'any'
      && dragged.requestedStaffId
      && dragged.requestedStaffId !== nextStaffId) {
      this.openEditAppointment(dragged);
      this.appointmentDate = date;
      const line = this.bookingLines.find((item) => item.appointmentId === dragged.id);
      if (line) {
        line.staffId = nextStaffId;
        line.staffSearch = this.staffName(nextStaffId);
        line.startTime = this.timeToInput(time);
        line.durationMinutes = duration;
      }
      this.staffChangeReviewOpen = true;
      return;
    }
    try {
      await this.postJson(`/api/v1/appointments/${dragged.id}/reschedule`, {
        start_at: startAt,
        end_at: this.localDateTimeToIso(date, this.addMinutesToTime(this.timeToInput(time), duration)),
        staff_id: nextStaffId,
        chair_room_id: dragged.chairRoomId,
        reason: 'Moved on calendar',
        change_mode: 'calendar-move',
        actor_source: 'crm',
      });
      await this.loadAppointments();
    } catch (error) {
      this.appointmentActionError = error instanceof Error ? error.message : 'Unable to move appointment';
    }
  }

  private connectLiveAppointments() {
    const token = localStorage.getItem('aurashine_access_token');
    if (!token) return;
    const scheme = window.location.protocol === 'https:' ? 'wss' : 'ws';
    this.liveSocket = new WebSocket(`${scheme}://${window.location.host}/api/v1/realtime/appointments`, ['aurashine-v1', token]);
    this.liveSocket.onmessage = () => void this.loadAppointments();
    this.liveSocket.onclose = () => {
      if (!this.liveReconnectTimer) {
        this.liveReconnectTimer = setTimeout(() => {
          this.liveReconnectTimer = null;
          this.connectLiveAppointments();
        }, 3000);
      }
    };
  }

  private openBookingWithSlot(staffId: string, time: string) {
    this.activeCommand = null;
    this.editingAppointmentId = '';
    this.editingBookingGroupId = '';
    this.newBookingOpen = true;
    this.bookingError = '';
    this.selectedClientId = '';
    this.bookingClientSearch = '';
    this.bookingClientKpi = null;
    this.bookingClientKpiRequest += 1;
    this.bookingNotes = '';
    this.notifyStaff = true;
    this.recurrenceFrequency = 'none';
    this.recurrenceCount = '';
    this.bookingLines = [this.blankLine(staffId, this.timeToInput(time))];
  }

  private blankLine(staffId: string, startTime: string): BookingLine {
    const person = this.staff.find((entry) => entry.id === staffId);
    const client = this.clients.find((entry) => entry.id === this.selectedClientId);
    return {
      id: `line_${++this.lineSeed}`,
      appointmentId: '',
      clientId: client?.id || '',
      clientSearch: this.clientLabel(client),
      clientOpen: false,
      serviceId: '',
      serviceSearch: '',
      staffId: person?.id || '',
      staffSearch: person?.name || '',
      startTime,
      durationMinutes: 30,
      chairRoomId: '',
      initialStaffId: '',
      requestedStaffId: person?.id || '',
      staffPreference: person?.id ? 'preferred' : 'any',
      staffChangeApproval: '',
      staffChangeReason: '',
      serviceOpen: false,
      staffOpen: false,
      variantId: '',
      addonIds: [],
    };
  }

  private mapAppointmentCards() {
    const columns = this.calendarColumnsData;
    const staffById = new Map(this.scheduledStaff.map((person, index) => [person.id, index]));
    const selectedStaffIds = new Set(this.scheduledStaff.map((person) => person.id));
    const cards = this.appointmentRows
      .filter((item) => {
        const status = String(item.status || '').toLowerCase();
        if (status === 'cancelled' || status === 'canceled') return false;
        if (this.statusFilter && !this.statusFilter.includes(status)) return false;
        if (this.activeView === 'Day') return item.startAt.slice(0, 10) === this.appointmentDate;
        return columns.some((column) => column.date === item.startAt.slice(0, 10)) && (!selectedStaffIds.size || selectedStaffIds.has(item.staffId));
      })
      .map((item) => {
        const staffIndex = this.activeView === 'Week'
          ? columns.findIndex((column) => column.date === item.startAt.slice(0, 10))
          : staffById.get(item.staffId);
        if (staffIndex === undefined || staffIndex < 0) return null;
        const start = new Date(item.startAt);
        const end = new Date(item.endAt);
        const minutes = start.getHours() * 60 + start.getMinutes();
        const top = Math.max(0, ((minutes - this.minutesFromTime(this.appointmentSettings.startTime)) / this.appointmentSettings.slotMinutes) * this.calendarSlotHeight);
        const height = Math.max(this.calendarSlotHeight, (Math.max(this.appointmentSettings.slotMinutes, (end.getTime() - start.getTime()) / 60000) / this.appointmentSettings.slotMinutes) * this.calendarSlotHeight - 4);
        const card: AppointmentCard = {
          id: item.id,
          clientId: item.clientId,
          staffId: item.staffId,
          requestedStaffId: item.requestedStaffId,
          staffPreference: item.staffPreference,
          serviceIds: item.serviceIds,
          startAt: item.startAt,
          endAt: item.endAt,
          staff: staffIndex,
          top,
          height,
          lane: 0,
          laneCount: 1,
          client: this.clientName(item.clientId),
          service: item.serviceIds.map((id) => this.serviceName(id)).filter(Boolean).join(', ') || 'Service',
          time: `${this.timeText(item.startAt)} - ${this.timeText(item.endAt)}`,
          status: item.status,
          notes: item.notes,
          chairRoomId: item.chairRoomId,
          amountText: item.amountText,
          paymentText: item.paymentText,
          bookingNumber: item.bookingNumber,
          bookingGroupId: item.bookingGroupId,
          activityLines: item.activityLines,
          detailRows: [],
        };
        card.detailRows = this.appointmentDetailRows(card);
        return card;
      })
      .filter(Boolean) as AppointmentCard[];
    this.assignOverlapLanes(cards);
    this.appointments = cards;
  }

  private assignOverlapLanes(cards: AppointmentCard[]) {
    const byColumn = new Map<number, AppointmentCard[]>();
    for (const card of cards) {
      const column = byColumn.get(card.staff) || [];
      column.push(card);
      byColumn.set(card.staff, column);
    }

    for (const column of byColumn.values()) {
      const sorted = [...column].sort((first, second) => new Date(first.startAt).getTime() - new Date(second.startAt).getTime());
      let cluster: AppointmentCard[] = [];
      let clusterEnd = -Infinity;
      for (const card of sorted) {
        const start = new Date(card.startAt).getTime();
        if (cluster.length && start >= clusterEnd) {
          this.assignClusterLanes(cluster);
          cluster = [];
          clusterEnd = -Infinity;
        }
        cluster.push(card);
        clusterEnd = Math.max(clusterEnd, new Date(card.endAt).getTime());
      }
      if (cluster.length) this.assignClusterLanes(cluster);
    }
  }

  private assignClusterLanes(cluster: AppointmentCard[]) {
    const active: Array<{ end: number; lane: number }> = [];
    let laneCount = 1;
    for (const card of cluster) {
      const start = new Date(card.startAt).getTime();
      for (let index = active.length - 1; index >= 0; index -= 1) {
        if (active[index].end <= start) active.splice(index, 1);
      }
      const occupied = new Set(active.map((entry) => entry.lane));
      let lane = 0;
      while (occupied.has(lane)) lane += 1;
      card.lane = lane;
      active.push({ end: new Date(card.endAt).getTime(), lane });
      laneCount = Math.max(laneCount, lane + 1);
    }
    cluster.forEach((card) => card.laneCount = laneCount);
  }

  private isActiveDayAppointment(item: AppointmentRecord) {
    const status = String(item.status || '').toLowerCase();
    return item.startAt.slice(0, 10) === this.appointmentDate
      && status !== 'cancelled'
      && status !== 'canceled'
      && status !== 'no-show';
  }

  private toResourceBooking(item: AppointmentRecord): ResourceBooking {
    return {
      id: item.id,
      client: this.clientName(item.clientId),
      service: item.serviceIds.map((serviceId) => this.serviceName(serviceId)).filter(Boolean)[0] || 'Service',
      time: `${this.timeText(item.startAt)} - ${this.timeText(item.endAt)}`,
      status: this.statusLabel(item.status),
    };
  }

  requestedStaffLabel(item: { requestedStaffId: string }) {
    return this.staffName(item.requestedStaffId) || 'Staff';
  }

  private appointmentsOverlap(first: AppointmentRecord, second: AppointmentRecord) {
    return new Date(first.startAt).getTime() < new Date(second.endAt).getTime()
      && new Date(second.startAt).getTime() < new Date(first.endAt).getTime();
  }

  private chairRoomName(id: string) {
    return this.chairRooms.find((item) => item.id === id)?.name || 'Unassigned resource';
  }

  private weekDates() {
    const selected = this.localDate(this.appointmentDate);
    const weekStartOffset = this.appointmentSettings.weekStartFrom === 'Monday' ? 1 : 0;
    selected.setDate(selected.getDate() - ((selected.getDay() - weekStartOffset + 7) % 7));
    return Array.from({ length: 7 }, (_, index) => {
      const date = new Date(selected);
      date.setDate(selected.getDate() + index);
      return this.isoDate(date);
    });
  }

  private localDate(value: string) {
    const [year, month, day] = value.split('-').map(Number);
    return new Date(year || new Date().getFullYear(), (month || 1) - 1, day || 1);
  }

  private isoDate(date: Date) {
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${date.getFullYear()}-${month}-${day}`;
  }

  private weekdayInitial(value: string) {
    return this.localDate(value).toLocaleDateString('en-US', { weekday: 'short' }).slice(0, 2).toUpperCase();
  }

  private weekdayTitle(value: string) {
    return this.localDate(value).toLocaleDateString('en-US', { weekday: 'short' });
  }

  private toAppointment(item: any): AppointmentRecord {
    return {
      id: String(item.id || ''),
      clientId: String(item.client_id || item.clientId || ''),
      staffId: String(item.staff_id || item.staffId || ''),
      requestedStaffId: String(item.requested_staff_id || item.requestedStaffId || ''),
      staffPreference: ['preferred', 'required'].includes(String(item.staff_preference || item.staffPreference || '').toLowerCase())
        ? String(item.staff_preference || item.staffPreference).toLowerCase() as 'preferred' | 'required'
        : 'any',
      serviceIds: Array.isArray(item.service_ids) ? item.service_ids : Array.isArray(item.serviceIds) ? item.serviceIds : [],
      startAt: String(item.start_at || item.startAt || ''),
      endAt: String(item.end_at || item.endAt || ''),
      status: String(item.status || 'booked'),
      notes: String(item.notes || ''),
      chairRoomId: String(item.chair_room_id || item.chairRoomId || ''),
      amountText: this.amountText(item),
      paymentText: this.paymentText(item),
      bookingNumber: this.firstText(item.bookingNo, item.booking_no, item.bookingNumber, item.booking_number, item.appointmentNo, item.appointment_no, item.invoiceNo, item.invoice_no, item.id),
      bookingGroupId: String(item.booking_group_id || item.bookingGroupId || ''),
      activityLines: this.activityLines(item),
    };
  }

  private bookingGroupRows(card: AppointmentCard) {
    const activeRows = this.appointmentRows.filter((item) => !['cancelled', 'canceled', 'no-show'].includes(item.status.toLowerCase()));
    if (!card.bookingGroupId) {
      return activeRows.filter((item) => item.id === card.id);
    }
    return activeRows.filter((item) => item.bookingGroupId === card.bookingGroupId);
  }

  private async refreshAppointmentActivity() {
    if (!this.selectedAppointment) return;
    const targetId = this.selectedAppointment.id;
    try {
      const result = await this.getJson<{ timeline?: any[] }>(`/api/v1/appointment-activity/appointments/${targetId}/timeline`);
      const timeline = this.activityTimelineFromResult(result, targetId);
      const finalTimeline = timeline.length > 0 ? timeline : this.activityFallback(this.selectedAppointment);
      if (!this.selectedAppointment || this.selectedAppointment.id !== targetId) return;
      this.selectedAppointment = { ...this.selectedAppointment, activityLines: finalTimeline };
      this.activityRefreshError = '';
    } catch {
      this.activityRefreshError = 'Unable to load activity';
      const fallback = this.appointmentRows.find((item) => item.id === targetId)?.activityLines || [];
      const finalFallback = fallback.length > 0 ? fallback : this.activityFallback({
        id: targetId,
        status: this.selectedAppointment?.status || 'booked',
        startAt: this.selectedAppointment?.startAt || '',
      } as any);
      if (this.selectedAppointment && this.selectedAppointment.id === targetId) {
        this.selectedAppointment = { ...this.selectedAppointment, activityLines: finalFallback };
      }
    }
  }

  private activityTimelineFromResult(result: { timeline?: any[] }, _id: string): AppointmentActivityLine[] {
    const timeline = Array.isArray(result?.timeline) ? result.timeline : [];
    return timeline
      .map((row: any, index: number) => ({
        id: String(row.id || `${_id}-activity-${index}`),
        title: this.activityTitle(row),
        time: String(row.created_at || row.createdAt || ''),
        body: this.activityBody(row),
      }))
      .filter((event) => event.time || event.title || event.body);
  }

  private activityFallback(appointment: { id: string; status: string; startAt?: string }): AppointmentActivityLine[] {
    return [{
      id: `${appointment.id}:fallback`,
      title: 'Booking created',
      time: appointment.startAt || '',
      body: `Status: ${appointment.status || 'booked'}`,
    }];
  }

  private activityTitle(row: any) {
    const oldStatus = String(row.old_status || row.oldStatus || '').trim();
    const newStatus = String(row.new_status || row.newStatus || '').trim();
    if (oldStatus && newStatus) return `Status: ${oldStatus} → ${newStatus}`;
    const action = String(row.action || row.title || row.event || 'Activity');
    const labels: Record<string, string> = {
      BOOKING_RESCHEDULED: 'Rescheduled by CRM', CLIENT_RESCHEDULE_REQUESTED: 'Client reschedule requested',
      CALENDAR_MOVED: 'Calendar moved', RESCHEDULE_APPROVED: 'Reschedule approved', RESCHEDULE_REJECTED: 'Reschedule rejected',
    };
    return labels[action] || action;
  }

  private activityBody(row: any) {
    const body = String(row.reason || row.body || row.description || row.action || '');
    const appointment = this.selectedAppointment;
    if (!appointment || appointment.staffPreference === 'any' || !/booking saved/i.test(body)) return body;
    const preference = appointment.staffPreference === 'required' ? 'Required' : 'Preferred';
    return `${body} · ♥ ${this.requestedStaffLabel(appointment)} requested (${preference})`;
  }

  private bookingNotesFor(line: BookingLine) {
    return this.bookingNotes.trim();
  }

  private startActivityRefresh() {
    if (this.activityRefreshTimer) return;
    this.activityRefreshTimer = setInterval(() => {
      void this.refreshAppointmentActivity();
    }, 6000);
  }

  private stopActivityRefresh() {
    if (this.activityRefreshTimer) {
      clearInterval(this.activityRefreshTimer);
      this.activityRefreshTimer = null;
    }
  }

  private async getJson<T>(url: string): Promise<T> {
    return firstValueFrom(this.api.get<T>(url));
  }

  private async postJson<T>(url: string, body: unknown): Promise<T> {
    return firstValueFrom(this.api.post<T>(url, body));
  }

  private async deleteJson<T>(url: string): Promise<T> {
    return firstValueFrom(this.api.delete<T>(url));
  }

  private errorMessage(error: any, fallback: string): string {
    return String(error?.error?.error || error?.error?.message || error?.message || fallback);
  }

  private asArray<T>(result: ApiList<T>): T[] {
    return Array.isArray(result) ? result : Array.isArray(result.data) ? result.data : [];
  }

  private appointmentHoverPoint(event: MouseEvent | FocusEvent) {
    const source = event instanceof MouseEvent ? event : event.target instanceof HTMLElement ? {
      clientX: event.target.getBoundingClientRect().left,
      clientY: event.target.getBoundingClientRect().top,
    } : { clientX: 20, clientY: 20 };
    const width = 340;
    const height = 360;
    let x = source.clientX + 16;
    let y = source.clientY + 16;
    if (x + width > window.innerWidth - 12) x = source.clientX - width - 16;
    if (y + height > window.innerHeight - 12) y = window.innerHeight - height - 12;
    return { x: Math.max(12, x), y: Math.max(12, y) };
  }

  private appointmentDetailRows(card: AppointmentCard) {
    const duration = this.minutesBetween(
      this.appointmentRows.find((item) => item.id === card.id)?.startAt || '',
      this.appointmentRows.find((item) => item.id === card.id)?.endAt || '',
    );
    const rows = [
      { label: 'Time', value: duration ? `${card.time} (${duration} mins)` : card.time },
      { label: 'Client', value: card.client },
      { label: 'Phone', value: this.clientPhone(card.clientId) },
      { label: 'Service', value: card.service },
      { label: 'Staff', value: this.appointmentSettings.staffCalendar ? this.staffName(card.staffId) : '' },
      { label: 'Status', value: this.statusLabel(card.status) },
      { label: 'Amount', value: card.amountText },
      { label: 'Booking', value: card.id },
      { label: 'Notes', value: card.notes },
    ];
    return rows.filter((row) => row.value.trim());
  }

  clientPhone(id: string) {
    return this.clients.find((client) => client.id === id)?.phone || '';
  }

  private amountText(item: any) {
    const total = Number(item.totalAmount ?? item.total_amount ?? item.total ?? item.amount ?? 0);
    const paid = Number(item.paidAmount ?? item.paid_amount ?? item.paid ?? 0);
    const due = Number(item.dueAmount ?? item.due_amount ?? item.due ?? 0);
    return [
      total > 0 ? `Total ₹${total.toLocaleString('en-IN')}` : '',
      paid > 0 ? `Paid ₹${paid.toLocaleString('en-IN')}` : '',
      due > 0 ? `Due ₹${due.toLocaleString('en-IN')}` : '',
    ].filter(Boolean).join(' | ');
  }

  private paymentText(item: any) {
    const paymentStatus = this.firstText(item.paymentStatus, item.payment_status, item.billingStatus, item.billing_status, item.billStatus, item.bill_status);
    const paymentMode = this.firstText(item.paymentMode, item.payment_mode, item.paymentType, item.payment_type, item.mode);
    return [paymentStatus, paymentMode].filter(Boolean).join(' | ');
  }

  private activityLines(item: any): AppointmentActivityLine[] {
    const raw = Array.isArray(item.activityLog) ? item.activityLog : Array.isArray(item.activity_log) ? item.activity_log : Array.isArray(item.history) ? item.history : [];
    return raw.map((event: any, index: number) => ({
      id: String(event.id || `${item.id || 'appointment'}-activity-${index}`),
      title: String(event.title || event.action || ''),
      time: String(event.time || event.createdAt || event.created_at || event.updatedAt || event.updated_at || ''),
      body: String(event.body || event.notes || event.description || ''),
    })).filter((event: AppointmentActivityLine) => event.title || event.time || event.body);
  }

  private priceText(item: any) {
    const raw = Number(item.price ?? item.priceAmount ?? item.price_amount ?? item.amount ?? 0);
    const paise = Number(item.pricePaise ?? item.price_paise ?? 0);
    const value = raw > 0 ? raw : paise > 0 ? paise / 100 : 0;
    return value > 0 ? `₹${value.toLocaleString('en-IN')}` : '';
  }

  private firstText(...values: unknown[]) {
    const found = values.find((value) => value !== undefined && value !== null && String(value).trim());
    return found === undefined ? '' : String(found).trim();
  }

  private initials(firstName = '', lastName = '') {
    return `${firstName[0] || ''}${lastName[0] || ''}`.toUpperCase() || '--';
  }

  private clientLabel(client?: ClientOption) {
    if (!client) return '';
    return [client.name, client.phone].filter(Boolean).join(' · ');
  }

  clientName(id: string) {
    return this.clients.find((client) => client.id === id)?.name || 'Client';
  }

  private serviceName(id: string) {
    return this.services.find((service) => service.id === id)?.name || 'Service';
  }

  staffName(id: string) {
    return this.staff.find((person) => person.id === id)?.name || 'Staff';
  }

  private timeToInput(label: string) {
    const plain = label.match(/^(\d{1,2}):(\d{2})$/);
    if (plain) return `${String(Number(plain[1])).padStart(2, '0')}:${plain[2]}`;
    const match = label.toLowerCase().match(/^(\d{1,2}):(\d{2})\s*(am|pm)$/);
    if (!match) return '08:00';
    let hour = Number(match[1]);
    const minute = Number(match[2]);
    const period = match[3];
    if (period === 'pm' && hour !== 12) hour += 12;
    if (period === 'am' && hour === 12) hour = 0;
    return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
  }

  private loadAppointmentSettings(): AppointmentSettings {
    try {
      return { ...this.defaultAppointmentSettings(), ...JSON.parse(localStorage.getItem(this.settingsKey) || '{}') };
    } catch {
      return this.defaultAppointmentSettings();
    }
  }

  private buildTimes() {
    const start = this.minutesFromTime(this.appointmentSettings.startTime);
    const end = Math.max(start + this.appointmentSettings.slotMinutes, this.minutesFromTime(this.appointmentSettings.endTime));
    const labels = Array.from({ length: Math.ceil((end - start) / this.appointmentSettings.slotMinutes) + 1 }, (_, index) => {
      const minutes = start + index * this.appointmentSettings.slotMinutes;
      return this.timeLabel(Math.floor(minutes / 60), minutes % 60);
    });
    if (this.appointmentSettings.previousTimeSlot || this.appointmentDate !== this.isoDate(new Date())) return labels;
    const now = new Date();
    const currentMinutes = now.getHours() * 60 + now.getMinutes();
    return labels.filter((label) => this.minutesFromTime(this.timeToInput(label)) >= currentMinutes);
  }

  private minutesFromTime(time: string) {
    const [hour, minute] = time.split(':').map(Number);
    return (hour || 0) * 60 + (minute || 0);
  }

  private timeLabel(hour: number, minute: number) {
    if (this.appointmentSettings.timeFormat === '24 Hours') return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
    const period = hour >= 12 ? 'pm' : 'am';
    const displayHour = hour % 12 || 12;
    return `${displayHour}:${String(minute).padStart(2, '0')} ${period}`;
  }

  statusColor(status: string) {
    return this.appointmentSettings.colors.find((item) => item.status === status && item.enabled)?.color || '';
  }

  statusLabel(status: string) {
    return this.appointmentSettings.colors.find((item) => item.status === status)?.label || status;
  }

  private statusFromLabel(label: string) {
    return this.appointmentSettings.colors.find((item) => item.label === label)?.status || 'booked';
  }

  private updateCurrentTimeLine() {
    if (this.activeView !== 'Day' || this.appointmentDate !== this.isoDate(new Date())) {
      this.currentTimeTop = null;
      return;
    }

    const now = new Date();
    const currentMinutes = now.getHours() * 60 + now.getMinutes();
    const gridStart = this.minutesFromTime(this.timeToInput(this.times[0] || this.appointmentSettings.startTime));
    const gridEnd = this.minutesFromTime(this.timeToInput(this.times[this.times.length - 1] || this.appointmentSettings.endTime));
    if (currentMinutes < gridStart || currentMinutes > gridEnd) {
      this.currentTimeTop = null;
      return;
    }

    this.currentTimeTop = ((currentMinutes - gridStart) / this.appointmentSettings.slotMinutes) * this.calendarSlotHeight;
    this.currentTimeLabel = this.timeLabel(now.getHours(), now.getMinutes());
  }

  private slotHoverPoint(event: MouseEvent | FocusEvent) {
    if ('clientX' in event) {
      return {
        x: Math.min(event.clientX + 12, window.innerWidth - 220),
        y: Math.min(event.clientY + 12, window.innerHeight - 92),
      };
    }

    const target = event.target instanceof HTMLElement ? event.target : null;
    const rect = target?.getBoundingClientRect();
    return {
      x: Math.min((rect?.left || 0) + 12, window.innerWidth - 220),
      y: Math.min((rect?.top || 0) + 12, window.innerHeight - 92),
    };
  }

  private defaultAppointmentSettings(): AppointmentSettings {
    return {
      startTime: '08:00',
      endTime: '20:00',
      overlapTimeSlot: false,
      previousTimeSlot: true,
      weekStartFrom: 'Sunday',
      slotMinutes: 15,
      timeFormat: '12 Hours',
      roomNumberOption: false,
      staffCalendar: true,
      defaultStatus: 'Confirmed',
      clientSelfReschedule: true,
      rescheduleApprovalRequired: false,
      rescheduleCutoffHours: 2,
      maxRescheduleCount: 2,
      rescheduleSmsAppNotification: true,
      perServiceRescheduleSms: true,
      colors: [
        { status: 'booked', enabled: true, color: '#84cfb1', label: 'Confirmed' },
        { status: 'arrived', enabled: true, color: '#9fd6fd', label: 'Arrived' },
        { status: 'in-service', enabled: true, color: '#ffa500', label: 'Start' },
        { status: 'completed', enabled: true, color: '#323ec7', label: 'Completed' },
        { status: 'cancelled', enabled: true, color: '#fc8e8f', label: 'Cancel' },
        { status: 'no-show', enabled: true, color: '#23e830', label: 'Not Came' },
        { status: 'not-confirmed', enabled: true, color: '#8893d3', label: 'Not Confirmed' },
        { status: 'rescheduled', enabled: true, color: '#2a2c32', label: 'Reschedule Booking' },
        { status: 'payment', enabled: true, color: '#bd60e8', label: 'Add Payment' },
        { status: 'deleted', enabled: true, color: '#ff0000', label: 'Delete' },
      ],
    };
  }

  private addMinutesToTime(time: string, minutes: number) {
    const [hour, minute] = time.split(':').map(Number);
    const date = new Date(2000, 0, 1, hour || 0, minute || 0);
    date.setMinutes(date.getMinutes() + minutes);
    return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
  }

  private localDateTimeToIso(date: string, time: string) {
    return new Date(`${date}T${time}:00`).toISOString();
  }

  timeText(value: string) {
    if (!value) return '';
    return new Date(value).toLocaleTimeString('en-IN', { hour: this.appointmentSettings.timeFormat === '24 Hours' ? '2-digit' : 'numeric', minute: '2-digit', hour12: this.appointmentSettings.timeFormat !== '24 Hours' }).toLowerCase();
  }

  bookingSlots(line: BookingLine): Array<{ value: string; label: string; blocked: boolean }> {
    return this.timeSlotsFor(
      line.staffId,
      Math.max(this.appointmentSettings.slotMinutes || 15, Number(line.durationMinutes) || 15),
      line.appointmentId || this.editingAppointmentId,
      line.chairRoomId,
    );
  }

  isChairRoomUnavailable(line: BookingLine, chairRoomId = line.chairRoomId): boolean {
    return !this.appointmentSettings.overlapTimeSlot
      && this.hasChairRoomOverlap(line, line.startTime, chairRoomId);
  }

  commandSlots(): Array<{ value: string; label: string; blocked: boolean }> {
    const appointment = this.activeCommand === 'move'
      ? this.appointmentRows.find((item) => item.id === this.commandAppointmentId)
      : null;
    const duration = appointment
      ? Math.max(this.appointmentSettings.slotMinutes || 15, this.minutesBetween(appointment.startAt, appointment.endAt))
      : Math.max(this.appointmentSettings.slotMinutes || 15, Number(this.commandDurationMinutes) || 15);
    const staffId = this.activeCommand === 'waitlist' ? '' : this.commandStaffId;
    const excludedAppointmentId = this.activeCommand === 'move' ? this.commandAppointmentId : '';
    return this.timeSlotsFor(staffId, duration, excludedAppointmentId);
  }

  selectCommandSlot(slot: { value: string; blocked: boolean }) {
    if (!slot.blocked) this.commandStartTime = slot.value;
  }

  private timeSlotsFor(
    staffId: string,
    durationMinutes: number,
    excludedAppointmentId = '',
    chairRoomId = '',
  ): Array<{ value: string; label: string; blocked: boolean }> {
    const step = Math.max(5, this.appointmentSettings.slotMinutes || 15);
    const start = this.minutesFromTime(this.appointmentSettings.startTime);
    const end = this.minutesFromTime(this.appointmentSettings.endTime);
    const duration = Math.max(step, durationMinutes || step);
    const count = Math.max(0, Math.floor((end - start - duration) / step) + 1);
    return Array.from({ length: count }, (_, index) => {
      const minutes = start + index * step;
      const value = `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
      const blockedByStaff = Boolean(staffId)
        && this.hasStaffOverlap(staffId, value, duration, excludedAppointmentId);
      const blockedByBlackout = Boolean(staffId)
        && this.hasStaffBlackout(staffId, value, duration);
      const blockedByChairRoom = Boolean(chairRoomId)
        && this.hasScheduleOverlap(value, duration, excludedAppointmentId, 'chairRoomId', chairRoomId);
      return {
        value,
        label: this.bookingSlotLabel(value),
        blocked: blockedByBlackout || (!this.appointmentSettings.overlapTimeSlot
          && (blockedByStaff || blockedByChairRoom)),
      };
    });
  }

  bookingSlotLabel(time: string): string {
    if (this.appointmentSettings.timeFormat === '24 Hours') return time;
    const [rawHour, rawMinute] = time.split(':').map(Number);
    const suffix = rawHour >= 12 ? 'PM' : 'AM';
    return `${String(rawHour % 12 || 12).padStart(2, '0')}:${String(rawMinute).padStart(2, '0')} ${suffix}`;
  }

  private hasOverlap(line: BookingLine, startTime = line.startTime) {
    return this.hasStaffOverlap(
      line.staffId,
      startTime,
      line.durationMinutes || 30,
      line.appointmentId || this.editingAppointmentId,
    );
  }

  private hasStaffOverlap(
    staffId: string,
    startTime: string,
    durationMinutes: number,
    excludedAppointmentId = '',
  ) {
    return this.hasScheduleOverlap(startTime, durationMinutes, excludedAppointmentId, 'staffId', staffId);
  }

  private hasStaffBlackout(staffId: string, startTime: string, durationMinutes: number) {
    const startAt = this.localDateTimeToIso(this.appointmentDate, startTime);
    const endAt = this.localDateTimeToIso(this.appointmentDate, this.addMinutesToTime(startTime, durationMinutes));
    return this.blackouts.some((entry) =>
      (entry.staffId === staffId || !entry.staffId)
      && entry.blockedFrom
      && entry.blockedFrom < endAt
      && entry.blockedUntil > startAt,
    );
  }

  private hasChairRoomOverlap(
    line: BookingLine,
    startTime = line.startTime,
    chairRoomId = line.chairRoomId,
  ) {
    if (!chairRoomId) return false;
    return this.hasScheduleOverlap(
      startTime,
      line.durationMinutes || 30,
      line.appointmentId || this.editingAppointmentId,
      'chairRoomId',
      chairRoomId,
    );
  }

  private hasScheduleOverlap(
    startTime: string,
    durationMinutes: number,
    excludedAppointmentId: string,
    field: 'staffId' | 'chairRoomId',
    value: string,
  ) {
    const startAt = this.localDateTimeToIso(this.appointmentDate, startTime);
    const endAt = this.localDateTimeToIso(this.appointmentDate, this.addMinutesToTime(startTime, durationMinutes));
    return this.appointmentRows.some((item) =>
      item[field] === value &&
      item.startAt < endAt &&
      item.endAt > startAt &&
      item.status !== 'cancelled' &&
      item.id !== excludedAppointmentId
    );
  }

  shortDate(value: string) {
    if (!value) return '';
    return new Date(value).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  }

  private minutesBetween(start: string, end: string) {
    const diff = new Date(end).getTime() - new Date(start).getTime();
    return Math.max(0, Math.round(diff / 60000));
  }
}
