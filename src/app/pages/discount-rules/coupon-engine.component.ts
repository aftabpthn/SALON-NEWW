import { CommonModule } from '@angular/common';
import { Component, OnInit, computed, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { forkJoin } from 'rxjs';
import { ApiRecord, ApiService } from '../../core/api.service';

type CouponRow = ApiRecord & {
  id: number;
  code: string;
  title: string;
  discountType: string;
  discountValue: number;
  maxDiscountPaise: number;
  usageLimit: number;
  perClientLimit: number;
  usedCount: number;
  status: string;
  validFrom?: string | null;
  validTo?: string | null;
  target?: ApiRecord;
};

@Component({
  selector: 'app-coupon-engine',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './coupon-engine.component.html',
  styleUrls: ['./coupon-engine.component.css']
})
export class CouponEngineComponent implements OnInit {
  readonly loading = signal(false);
  readonly saving = signal(false);
  readonly error = signal('');
  readonly coupons = signal<CouponRow[]>([]);
  readonly analytics = signal<ApiRecord | null>(null);
  readonly templates = signal<ApiRecord[]>([]);
  readonly validation = signal<ApiRecord | null>(null);
  readonly analyticsRows = computed(() => this.analytics()?.rows || []);

  filters = {
    status: '',
    offerType: ''
  };

  couponForm: ApiRecord = {
    code: 'MONDAY20',
    title: 'Monday Happy Hours',
    offerType: 'generic',
    discountType: 'percent',
    discountValue: 20,
    maxDiscountPaise: 50000,
    usageLimit: 100,
    perClientLimit: 1,
    validFrom: this.today(),
    validTo: this.today(),
    status: 'active',
    minCartPaise: 0,
    branchIds: '',
    serviceCategories: '',
    serviceIds: '',
    clientSegment: '',
    firstVisitOnly: false,
    referralRequired: false,
    publicVisible: true
  };

  testForm: ApiRecord = {
    code: 'MONDAY20',
    cartTotalPaise: 250000,
    clientId: '',
    clientVisitCount: 0,
    isFirstVisit: false,
    referralClientId: '',
    serviceCategory: '',
    clientSegment: '',
    invoiceId: ''
  };

  readonly statuses = ['', 'draft', 'active', 'paused', 'expired', 'archived'];
  readonly offerTypes = ['', 'generic', 'first_visit', 'referral', 'branch_specific', 'service_specific', 'segment'];
  readonly selectableStatuses = this.statuses.slice(1);
  readonly selectableOfferTypes = this.offerTypes.slice(1);

  constructor(private readonly api: ApiService) {}

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.error.set('');
    forkJoin({
      coupons: this.api.list<{ rows: CouponRow[] }>('coupon-engine', this.params()),
      analytics: this.api.list<ApiRecord>('coupon-engine/analytics'),
      templates: this.api.list<{ rows: ApiRecord[] }>('coupon-engine/templates')
    }).subscribe({
      next: (result) => {
        this.coupons.set(result.coupons.rows || []);
        this.analytics.set(result.analytics);
        this.templates.set(result.templates.rows || []);
        this.loading.set(false);
      },
      error: (error) => {
        this.error.set(this.errorText(error, 'Unable to load coupon engine'));
        this.loading.set(false);
      }
    });
  }

  saveCoupon(): void {
    this.saving.set(true);
    this.error.set('');
    this.api.post<CouponRow>('coupon-engine', this.couponPayload()).subscribe({
      next: () => {
        this.saving.set(false);
        this.load();
      },
      error: (error) => {
        this.error.set(this.errorText(error, 'Unable to save coupon'));
        this.saving.set(false);
      }
    });
  }

  validate(): void {
    this.saving.set(true);
    this.error.set('');
    this.api.post<ApiRecord>('coupon-engine/validate', this.testPayload()).subscribe({
      next: (result) => {
        this.validation.set(result);
        this.saving.set(false);
      },
      error: (error) => {
        this.error.set(this.errorText(error, 'Unable to validate coupon'));
        this.saving.set(false);
      }
    });
  }

  redeem(): void {
    this.saving.set(true);
    this.error.set('');
    this.api.post<ApiRecord>('coupon-engine/redeem', this.testPayload()).subscribe({
      next: (result) => {
        this.validation.set(result);
        this.saving.set(false);
        this.load();
      },
      error: (error) => {
        this.error.set(this.errorText(error, 'Unable to redeem coupon'));
        this.saving.set(false);
      }
    });
  }

  applyTemplate(template: ApiRecord): void {
    this.couponForm = {
      ...this.couponForm,
      ...template,
      status: 'active',
      validFrom: this.today(),
      validTo: this.today(),
      maxDiscountPaise: template.discountType === 'flat' ? 0 : this.couponForm.maxDiscountPaise,
      publicVisible: true
    };
    this.testForm.code = template.code || this.testForm.code;
  }

  useCoupon(row: CouponRow): void {
    this.testForm.code = row.code;
    this.couponForm.code = row.code;
  }

  formatMoney(value: unknown): string {
    return `Rs ${(Math.round(Number(value || 0)) / 100).toLocaleString('en-IN')}`;
  }

  pretty(value: unknown): string {
    return String(value || '').replace(/_/g, ' ') || '-';
  }

  statusClass(value: unknown): string {
    return `status-${String(value || 'draft').replace(/[^a-z0-9_-]/gi, '_').toLowerCase()}`;
  }

  private params(): ApiRecord {
    return {
      status: this.filters.status,
      offerType: this.filters.offerType
    };
  }

  private couponPayload(): ApiRecord {
    return {
      ...this.couponForm,
      discountValue: Number(this.couponForm.discountValue || 0),
      maxDiscountPaise: Number(this.couponForm.maxDiscountPaise || 0),
      usageLimit: Number(this.couponForm.usageLimit || 0),
      perClientLimit: Number(this.couponForm.perClientLimit || 1),
      minCartPaise: Number(this.couponForm.minCartPaise || 0)
    };
  }

  private testPayload(): ApiRecord {
    return {
      ...this.testForm,
      cartTotalPaise: Number(this.testForm.cartTotalPaise || 0),
      clientVisitCount: Number(this.testForm.clientVisitCount || 0),
      isFirstVisit: Boolean(this.testForm.isFirstVisit),
      repeatClient: Number(this.testForm.clientVisitCount || 0) > 0
    };
  }

  private today(): string {
    return new Date().toISOString().slice(0, 10);
  }

  private errorText(error: unknown, fallback: string): string {
    const err = error as { error?: { error?: string; message?: string }; message?: string };
    return err?.error?.error || err?.error?.message || err?.message || fallback;
  }
}
