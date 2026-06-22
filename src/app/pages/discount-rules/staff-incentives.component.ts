import { CommonModule } from '@angular/common';
import { Component, OnInit, computed, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { forkJoin } from 'rxjs';
import { ApiRecord, ApiService } from '../../core/api.service';

type IncentiveRow = ApiRecord & {
  id: number;
  staffId: string;
  ruleId?: number;
  couponId?: number;
  bookingId?: string;
  invoiceId?: string;
  saleAmountPaise: number;
  discountPaise: number;
  incentivePaise: number;
  status: string;
  source: string;
  notes?: string;
};

@Component({
  selector: 'app-happy-hours-staff-incentives',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './staff-incentives.component.html',
  styleUrls: ['./staff-incentives.component.css']
})
export class HappyHoursStaffIncentivesComponent implements OnInit {
  readonly rows = signal<IncentiveRow[]>([]);
  readonly rules = signal<ApiRecord[]>([]);
  readonly coupons = signal<ApiRecord[]>([]);
  readonly loading = signal(false);
  readonly saving = signal(false);
  readonly error = signal('');

  readonly totalIncentivePaise = computed(() => this.rows().reduce((sum, row) => sum + Number(row.incentivePaise || 0), 0));
  readonly pendingPaise = computed(() => this.rows().filter((row) => row.status === 'pending').reduce((sum, row) => sum + Number(row.incentivePaise || 0), 0));
  readonly approvedPaise = computed(() => this.rows().filter((row) => row.status === 'approved').reduce((sum, row) => sum + Number(row.incentivePaise || 0), 0));
  readonly paidPaise = computed(() => this.rows().filter((row) => row.status === 'paid').reduce((sum, row) => sum + Number(row.incentivePaise || 0), 0));

  filters = {
    status: '',
    staffId: ''
  };

  incentiveForm: ApiRecord = this.blankForm();

  readonly statuses = ['', 'pending', 'approved', 'paid', 'paused', 'rejected'];
  readonly conversionTypes = [
    { value: 'slow_hour_conversion', label: 'Slow hour conversion', rate: 2.5 },
    { value: 'low_occupancy_boost', label: 'Low occupancy boost', rate: 3 },
    { value: 'campaign_booking', label: 'Campaign booking', rate: 2 },
    { value: 'walk_in_saved', label: 'Walk-in saved', rate: 1.5 },
    { value: 'package_upgrade', label: 'Package upgrade', rate: 2.25 }
  ];

  constructor(private readonly api: ApiService) {}

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.error.set('');
    forkJoin({
      incentives: this.api.list<{ rows: IncentiveRow[] }>('happy-hours-control-tower/staff-incentives', this.filters),
      rules: this.api.list<{ rows: ApiRecord[] }>('discount-rules', { status: 'active' }),
      coupons: this.api.list<{ rows: ApiRecord[] }>('happy-hours-control-tower/coupons', { status: 'active' })
    }).subscribe({
      next: (result) => {
        this.rows.set(result.incentives.rows || []);
        this.rules.set(result.rules.rows || []);
        this.coupons.set(result.coupons.rows || []);
        this.loading.set(false);
      },
      error: (error) => {
        this.error.set(this.errorText(error, 'Unable to load staff incentives'));
        this.loading.set(false);
      }
    });
  }

  saveIncentive(): void {
    this.saving.set(true);
    this.error.set('');
    this.api.post<IncentiveRow>('happy-hours-control-tower/staff-incentives', this.payload()).subscribe({
      next: () => {
        this.saving.set(false);
        this.incentiveForm = this.blankForm();
        this.load();
      },
      error: (error) => {
        this.error.set(this.errorText(error, 'Unable to save incentive'));
        this.saving.set(false);
      }
    });
  }

  updateStatus(row: IncentiveRow, status: string): void {
    this.saving.set(true);
    this.error.set('');
    this.api.patch<IncentiveRow>(`happy-hours-control-tower/staff-incentives/${row.id}`, {
      ...row,
      status,
      notes: row.notes || ''
    }).subscribe({
      next: () => {
        this.saving.set(false);
        this.load();
      },
      error: (error) => {
        this.error.set(this.errorText(error, 'Unable to update incentive'));
        this.saving.set(false);
      }
    });
  }

  useConversionType(value: string): void {
    const type = this.conversionTypes.find((item) => item.value === value);
    if (!type) return;
    this.incentiveForm.source = value;
    this.incentiveForm.incentiveRatePercent = type.rate;
    this.recalculate();
  }

  recalculate(): void {
    const sale = Number(this.incentiveForm.saleAmountPaise || 0);
    const discount = Number(this.incentiveForm.discountPaise || 0);
    const rate = Number(this.incentiveForm.incentiveRatePercent || 0);
    const conversionReward = Math.round((sale * rate) / 100);
    const discountDisciplineBonus = discount > 0 ? Math.round(discount * 0.08) : 0;
    this.incentiveForm.incentivePaise = Math.max(0, conversionReward + discountDisciplineBonus);
  }

  ruleName(id: unknown): string {
    if (!id) return 'No rule';
    return this.rules().find((rule) => Number(rule.id) === Number(id))?.name || `Rule #${id}`;
  }

  couponName(id: unknown): string {
    if (!id) return 'No coupon';
    const coupon = this.coupons().find((row) => Number(row.id) === Number(id));
    return coupon ? `${coupon.code} · ${coupon.title}` : `Coupon #${id}`;
  }

  formatMoney(value: unknown): string {
    return `Rs ${Math.round(Number(value || 0)) / 100}`;
  }

  label(value: unknown): string {
    return String(value || '').replace(/_/g, ' ');
  }

  statusClass(value: unknown): string {
    return `status-badge status-${String(value || 'pending').replace(/[^a-z0-9_-]/gi, '_').toLowerCase()}`;
  }

  private blankForm(): ApiRecord {
    return {
      staffId: '',
      ruleId: '',
      couponId: '',
      bookingId: '',
      invoiceId: '',
      saleAmountPaise: 250000,
      discountPaise: 25000,
      incentiveRatePercent: 2.5,
      incentivePaise: 8250,
      source: 'slow_hour_conversion',
      status: 'pending',
      notes: 'Linked to Happy Hours conversion.'
    };
  }

  private payload(): ApiRecord {
    return {
      staffId: this.incentiveForm.staffId,
      ruleId: this.incentiveForm.ruleId || null,
      couponId: this.incentiveForm.couponId || null,
      bookingId: this.incentiveForm.bookingId || '',
      invoiceId: this.incentiveForm.invoiceId || '',
      saleAmountPaise: Number(this.incentiveForm.saleAmountPaise || 0),
      discountPaise: Number(this.incentiveForm.discountPaise || 0),
      incentivePaise: Number(this.incentiveForm.incentivePaise || 0),
      source: this.incentiveForm.source || 'manual',
      status: this.incentiveForm.status || 'pending',
      notes: `${this.incentiveForm.notes || ''} Rate ${this.incentiveForm.incentiveRatePercent || 0}%.`.trim()
    };
  }

  private errorText(error: unknown, fallback: string): string {
    const err = error as { error?: { error?: string; message?: string }; message?: string };
    return err?.error?.error || err?.error?.message || err?.message || fallback;
  }
}
