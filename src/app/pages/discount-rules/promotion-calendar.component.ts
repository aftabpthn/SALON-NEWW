import { CommonModule } from '@angular/common';
import { Component, OnInit, computed, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { forkJoin } from 'rxjs';
import { ApiRecord, ApiService } from '../../core/api.service';

type CalendarView = 'month' | 'week';

type CalendarDay = {
  iso: string;
  label: string;
  muted: boolean;
  today: boolean;
  events: ApiRecord[];
  previewEvents: ApiRecord[];
};

@Component({
  selector: 'app-promotion-calendar',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './promotion-calendar.component.html',
  styleUrls: ['./promotion-calendar.component.css']
})
export class PromotionCalendarComponent implements OnInit {
  readonly loading = signal(false);
  readonly saving = signal(false);
  readonly error = signal('');
  readonly calendar = signal<ApiRecord[]>([]);
  readonly activeRules = signal<ApiRecord[]>([]);
  readonly coupons = signal<ApiRecord[]>([]);
  readonly viewMode = signal<CalendarView>('month');
  readonly cursor = signal(this.monthStartIso(new Date()));

  readonly days = computed(() => this.buildDays());
  readonly visibleEvents = computed(() => this.calendar().filter((row) => this.eventIntersectsWindow(row)));
  readonly scheduledCount = computed(() => this.visibleEvents().filter((row) => ['scheduled', 'active'].includes(String(row.status || ''))).length);
  readonly draftCount = computed(() => this.visibleEvents().filter((row) => String(row.status || '') === 'draft').length);
  readonly activeCount = computed(() => this.visibleEvents().filter((row) => String(row.status || '') === 'active').length);

  filters = {
    status: '',
    promoType: ''
  };

  promotionForm: ApiRecord = {
    title: 'Weekday slow hour offer',
    promoType: 'slow_hour',
    startDate: this.today(),
    endDate: this.today(),
    startTime: '12:00',
    endTime: '16:00',
    ruleId: '',
    couponId: '',
    status: 'scheduled',
    audience: { segment: 'all_clients' },
    notes: ''
  };

  readonly weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  readonly statuses = ['', 'draft', 'scheduled', 'active', 'paused', 'expired', 'archived'];
  readonly promoTypes = [
    '',
    'festival_offer',
    'slow_day_offer',
    'birthday_campaign',
    'month_end_campaign',
    'rainy_day_offer',
    'low_occupancy',
    'first_visit',
    'group_booking'
  ];
  readonly selectablePromoTypes = this.promoTypes.slice(1);
  readonly presets = [
    {
      key: 'festival_offer',
      label: 'Festival Offer',
      title: 'Festival glow-up offer',
      startTime: '10:00',
      endTime: '20:00',
      segment: 'all_clients',
      notes: 'Festival campaign with approved discount rule or coupon.'
    },
    {
      key: 'slow_day_offer',
      label: 'Slow Day',
      title: 'Weekday slow slot booster',
      startTime: '12:00',
      endTime: '16:00',
      segment: 'weekday_clients',
      notes: 'Use for low occupancy weekday blocks.'
    },
    {
      key: 'birthday_campaign',
      label: 'Birthday',
      title: 'Birthday month client offer',
      startTime: '09:00',
      endTime: '19:00',
      segment: 'birthday_month',
      notes: 'Target clients with birthday this month.'
    },
    {
      key: 'month_end_campaign',
      label: 'Month End',
      title: 'Month-end revenue push',
      startTime: '11:00',
      endTime: '19:00',
      segment: 'inactive_or_vip',
      notes: 'Controlled month-end campaign for selected client segments.'
    },
    {
      key: 'rainy_day_offer',
      label: 'Rainy Day',
      title: 'Rainy day walk-in recovery',
      startTime: '13:00',
      endTime: '18:00',
      segment: 'nearby_clients',
      notes: 'Use only when demand/weather context supports it.'
    }
  ];

  constructor(private readonly api: ApiService) {}

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.error.set('');
    forkJoin({
      calendar: this.api.list<{ rows: ApiRecord[] }>('happy-hours-control-tower/calendar', {
        from: this.windowStart(),
        to: this.windowEnd(),
        status: this.filters.status
      }),
      rules: this.api.list<{ rows: ApiRecord[] }>('discount-rules', { status: 'active' }),
      coupons: this.api.list<{ rows: ApiRecord[] }>('happy-hours-control-tower/coupons', { status: 'active' })
    }).subscribe({
      next: (result) => {
        const rows = result.calendar.rows || [];
        this.calendar.set(this.filters.promoType ? rows.filter((row) => row.promoType === this.filters.promoType) : rows);
        this.activeRules.set(result.rules.rows || []);
        this.coupons.set(result.coupons.rows || []);
        this.loading.set(false);
      },
      error: (error) => {
        this.error.set(this.errorText(error, 'Unable to load promotion calendar'));
        this.loading.set(false);
      }
    });
  }

  savePromotion(): void {
    this.saving.set(true);
    this.error.set('');
    this.api.post<ApiRecord>('happy-hours-control-tower/calendar', this.payload()).subscribe({
      next: () => {
        this.saving.set(false);
        this.resetFormDates();
        this.load();
      },
      error: (error) => {
        this.error.set(this.errorText(error, 'Unable to save promotion'));
        this.saving.set(false);
      }
    });
  }

  updateStatus(row: ApiRecord, status: string): void {
    this.saving.set(true);
    this.error.set('');
    this.api.patch<ApiRecord>(`happy-hours-control-tower/calendar/${row.id}`, {
      ...row,
      status,
      audience: row.audience || {},
      ruleId: row.ruleId || '',
      couponId: row.couponId || ''
    }).subscribe({
      next: () => {
        this.saving.set(false);
        this.load();
      },
      error: (error) => {
        this.error.set(this.errorText(error, 'Unable to update promotion'));
        this.saving.set(false);
      }
    });
  }

  deletePromotion(row: ApiRecord): void {
    this.saving.set(true);
    this.error.set('');
    this.api.delete<ApiRecord>('happy-hours-control-tower/calendar', String(row.id)).subscribe({
      next: () => {
        this.saving.set(false);
        this.load();
      },
      error: (error) => {
        this.error.set(this.errorText(error, 'Unable to delete promotion'));
        this.saving.set(false);
      }
    });
  }

  applyPreset(preset: ApiRecord): void {
    this.promotionForm = {
      ...this.promotionForm,
      title: preset.title,
      promoType: preset.key,
      startTime: preset.startTime,
      endTime: preset.endTime,
      audience: { segment: preset.segment },
      notes: preset.notes
    };
  }

  selectDay(day: CalendarDay): void {
    this.promotionForm.startDate = day.iso;
    this.promotionForm.endDate = day.iso;
  }

  shift(amount: number): void {
    const date = this.parseDate(this.cursor());
    if (this.viewMode() === 'week') {
      date.setDate(date.getDate() + amount * 7);
      this.cursor.set(this.iso(date));
    } else {
      date.setMonth(date.getMonth() + amount);
      this.cursor.set(this.monthStartIso(date));
    }
    this.load();
  }

  setView(view: CalendarView): void {
    this.viewMode.set(view);
    if (view === 'month') this.cursor.set(this.monthStartIso(this.parseDate(this.cursor())));
    this.load();
  }

  currentTitle(): string {
    const start = this.parseDate(this.windowStart());
    const end = this.parseDate(this.windowEnd());
    if (this.viewMode() === 'week') return `${start.toLocaleDateString()} - ${end.toLocaleDateString()}`;
    return start.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  }

  eventClass(row: ApiRecord): string {
    return `event-chip status-${String(row.status || 'draft').replace(/[^a-z0-9_-]/gi, '_').toLowerCase()}`;
  }

  statusClass(value: unknown): string {
    return `status-badge status-${String(value || 'draft').replace(/[^a-z0-9_-]/gi, '_').toLowerCase()}`;
  }

  promoLabel(value: unknown): string {
    return String(value || '').replace(/_/g, ' ');
  }

  linkLabel(row: ApiRecord): string {
    if (row.ruleId) return `Rule #${row.ruleId}`;
    if (row.couponId) return `Coupon #${row.couponId}`;
    return 'No linked offer';
  }

  private payload(): ApiRecord {
    return {
      ...this.promotionForm,
      ruleId: this.promotionForm.ruleId || null,
      couponId: this.promotionForm.couponId || null,
      audience: this.promotionForm.audience || {}
    };
  }

  private buildDays(): CalendarDay[] {
    const start = this.parseDate(this.windowStart());
    const end = this.parseDate(this.windowEnd());
    if (this.viewMode() === 'month') start.setDate(start.getDate() - start.getDay());
    if (this.viewMode() === 'month') end.setDate(end.getDate() + (6 - end.getDay()));
    const days: CalendarDay[] = [];
    const today = this.today();
    const cursorMonth = this.parseDate(this.cursor()).getMonth();
    for (const date = new Date(start); date <= end; date.setDate(date.getDate() + 1)) {
      const iso = this.iso(date);
      const events = this.calendar().filter((row) => this.eventFallsOn(row, iso));
      days.push({
        iso,
        label: String(date.getDate()),
        muted: this.viewMode() === 'month' && date.getMonth() !== cursorMonth,
        today: iso === today,
        events,
        previewEvents: events.slice(0, 3)
      });
    }
    return days;
  }

  private eventFallsOn(row: ApiRecord, iso: string): boolean {
    const start = String(row.startDate || '').slice(0, 10);
    const end = String(row.endDate || start).slice(0, 10);
    return Boolean(start) && start <= iso && end >= iso;
  }

  private eventIntersectsWindow(row: ApiRecord): boolean {
    const start = String(row.startDate || '').slice(0, 10);
    const end = String(row.endDate || start).slice(0, 10);
    return Boolean(start) && start <= this.windowEnd() && end >= this.windowStart();
  }

  private windowStart(): string {
    const date = this.parseDate(this.cursor());
    if (this.viewMode() === 'week') return this.iso(date);
    return this.monthStartIso(date);
  }

  private windowEnd(): string {
    const date = this.parseDate(this.cursor());
    if (this.viewMode() === 'week') {
      date.setDate(date.getDate() + 6);
      return this.iso(date);
    }
    return this.monthEndIso(date);
  }

  private resetFormDates(): void {
    const today = this.today();
    this.promotionForm = {
      ...this.promotionForm,
      startDate: today,
      endDate: today,
      title: ''
    };
  }

  private today(): string {
    return this.iso(new Date());
  }

  private monthStartIso(date: Date): string {
    return this.iso(new Date(date.getFullYear(), date.getMonth(), 1));
  }

  private monthEndIso(date: Date): string {
    return this.iso(new Date(date.getFullYear(), date.getMonth() + 1, 0));
  }

  private parseDate(value: string): Date {
    const [year, month, day] = String(value || this.today()).split('-').map(Number);
    return new Date(year || new Date().getFullYear(), (month || 1) - 1, day || 1);
  }

  private iso(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  private errorText(error: unknown, fallback: string): string {
    const err = error as { error?: { error?: string; message?: string }; message?: string };
    return err?.error?.error || err?.error?.message || err?.message || fallback;
  }
}
