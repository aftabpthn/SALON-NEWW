import { CommonModule } from '@angular/common';
import { Component, OnInit, computed, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { forkJoin } from 'rxjs';
import { ApiRecord, ApiService } from '../../core/api.service';

type TowerTab = 'overview' | 'calendar' | 'coupons' | 'roi' | 'segments' | 'incentives' | 'whatsapp' | 'abuse' | 'templates' | 'public';

@Component({
  selector: 'app-happy-hours-control-tower',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './happy-hours-control-tower.component.html',
  styleUrls: ['./happy-hours-control-tower.component.css']
})
export class HappyHoursControlTowerComponent implements OnInit {
  readonly activeTab = signal<TowerTab>('overview');
  readonly loading = signal(false);
  readonly saving = signal(false);
  readonly error = signal('');
  readonly summary = signal<ApiRecord | null>(null);
  readonly calendar = signal<ApiRecord[]>([]);
  readonly coupons = signal<ApiRecord[]>([]);
  readonly roi = signal<ApiRecord | null>(null);
  readonly segments = signal<ApiRecord[]>([]);
  readonly incentives = signal<ApiRecord[]>([]);
  readonly drafts = signal<ApiRecord[]>([]);
  readonly activeRules = signal<ApiRecord[]>([]);
  readonly campaignLinks = signal<ApiRecord[]>([]);
  readonly campaignPreview = signal<ApiRecord | null>(null);
  readonly abuseAlerts = signal<ApiRecord[]>([]);
  readonly templates = signal<ApiRecord[]>([]);
  readonly publicOffers = signal<ApiRecord | null>(null);
  readonly couponResult = signal<ApiRecord | null>(null);
  readonly branchPerformanceRows = computed(() => this.summary()?.branchPerformance || []);
  readonly roiRows = computed(() => this.roi()?.rows || []);
  readonly visiblePublicOffers = computed(() => this.publicOffers()?.offers || []);

  filters = {
    from: '',
    to: ''
  };

  promotionForm: ApiRecord = {
    title: 'Weekday slow hour offer',
    promoType: 'slow_hour',
    startDate: this.today(),
    endDate: this.today(),
    startTime: '12:00',
    endTime: '16:00',
    status: 'scheduled',
    notes: '',
    audience: { segment: 'all' }
  };

  couponForm: ApiRecord = {
    code: 'MONDAY20',
    title: 'Monday Happy Hours',
    discountType: 'percent',
    discountValue: 20,
    maxDiscountPaise: 50000,
    usageLimit: 100,
    perClientLimit: 1,
    validFrom: this.today(),
    validTo: this.today(),
    status: 'active',
    target: { publicVisible: true }
  };

  couponTest: ApiRecord = {
    code: 'MONDAY20',
    cartTotalPaise: 250000,
    clientId: ''
  };

  segmentForm: ApiRecord = {
    name: 'VIP Clients',
    segmentKey: 'vip_clients',
    definition: { criteria: { totalSpendPaiseGte: 1000000, visitCountGte: 5 } },
    status: 'active'
  };

  roiForm: ApiRecord = {
    ruleId: '',
    couponId: '',
    clientId: '',
    invoiceId: '',
    amountPaise: 250000,
    discountPaise: 25000,
    grossMarginPaise: 90000,
    repeatClient: false
  };

  incentiveForm: ApiRecord = {
    staffId: '',
    saleAmountPaise: 250000,
    discountPaise: 25000,
    incentivePaise: 2500,
    status: 'pending',
    notes: ''
  };

  draftForm: ApiRecord = {
    title: 'Happy Hours campaign',
    message: 'Hi {{name}}, special salon offer is live today. Book your slot now.',
    target: { segment: 'eligible_clients' },
    status: 'draft',
    scheduledFor: ''
  };

  campaignForm: ApiRecord = {
    ruleId: '',
    channel: 'whatsapp',
    segment: 'eligible_clients',
    audienceLabel: 'Eligible clients',
    title: '',
    message: '',
    scheduledFor: ''
  };

  tabs: Array<{ id: TowerTab; label: string }> = [
    { id: 'overview', label: 'Overview' },
    { id: 'calendar', label: 'Calendar' },
    { id: 'coupons', label: 'Coupons' },
    { id: 'roi', label: 'ROI' },
    { id: 'segments', label: 'Segments' },
    { id: 'incentives', label: 'Incentives' },
    { id: 'whatsapp', label: 'WhatsApp' },
    { id: 'abuse', label: 'Abuse' },
    { id: 'templates', label: 'Templates' },
    { id: 'public', label: 'Public' }
  ];

  constructor(private readonly api: ApiService) {}

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.error.set('');
    const params = this.params();
    forkJoin({
      summary: this.api.list<ApiRecord>('happy-hours-control-tower/summary', params),
      calendar: this.api.list<{ rows: ApiRecord[] }>('happy-hours-control-tower/calendar', params),
      coupons: this.api.list<{ rows: ApiRecord[] }>('happy-hours-control-tower/coupons'),
      roi: this.api.list<ApiRecord>('happy-hours-control-tower/roi', params),
      segments: this.api.list<{ rows: ApiRecord[] }>('happy-hours-control-tower/segments'),
      incentives: this.api.list<{ rows: ApiRecord[] }>('happy-hours-control-tower/staff-incentives'),
      drafts: this.api.list<{ rows: ApiRecord[] }>('happy-hours-control-tower/whatsapp-drafts'),
      activeRules: this.api.list<{ rows: ApiRecord[] }>('discount-rules', { status: 'active' }),
      campaignLinks: this.api.list<{ rows: ApiRecord[] }>('happy-hours-campaign-links'),
      abuse: this.api.list<{ rows: ApiRecord[] }>('happy-hours-control-tower/abuse-alerts'),
      templates: this.api.list<{ rows: ApiRecord[] }>('happy-hours-control-tower/templates'),
      publicOffers: this.api.list<ApiRecord>('happy-hours-control-tower/public-offers/preview')
    }).subscribe({
      next: (result) => {
        this.summary.set(result.summary);
        this.calendar.set(result.calendar.rows || []);
        this.coupons.set(result.coupons.rows || []);
        this.roi.set(result.roi);
        this.segments.set(result.segments.rows || []);
        this.incentives.set(result.incentives.rows || []);
        this.drafts.set(result.drafts.rows || []);
        this.activeRules.set(result.activeRules.rows || []);
        this.campaignLinks.set(result.campaignLinks.rows || []);
        this.abuseAlerts.set(result.abuse.rows || []);
        this.templates.set(result.templates.rows || []);
        this.publicOffers.set(result.publicOffers);
        this.loading.set(false);
      },
      error: (error) => {
        this.error.set(this.errorText(error, 'Unable to load Happy Hours Control Tower'));
        this.loading.set(false);
      }
    });
  }

  savePromotion(): void {
    this.save('happy-hours-control-tower/calendar', this.promotionForm);
  }

  saveCoupon(): void {
    this.save('happy-hours-control-tower/coupons', this.couponForm);
  }

  validateCoupon(): void {
    this.saving.set(true);
    this.error.set('');
    this.api.post<ApiRecord>('happy-hours-control-tower/coupons/validate', this.couponTest).subscribe({
      next: (result) => {
        this.couponResult.set(result);
        this.saving.set(false);
      },
      error: (error) => {
        this.error.set(this.errorText(error, 'Unable to validate coupon'));
        this.saving.set(false);
      }
    });
  }

  saveSegment(): void {
    this.save('happy-hours-control-tower/segments', this.segmentForm);
  }

  recordRoi(): void {
    this.save('happy-hours-control-tower/roi/outcome', this.roiForm);
  }

  saveIncentive(): void {
    this.save('happy-hours-control-tower/staff-incentives', this.incentiveForm);
  }

  saveDraft(): void {
    this.save('happy-hours-control-tower/whatsapp-drafts', this.draftForm);
  }

  previewCampaignFromRule(): void {
    if (!this.campaignForm.ruleId) {
      this.error.set('Select an active rule first');
      return;
    }
    this.saving.set(true);
    this.error.set('');
    this.api.post<ApiRecord>('happy-hours-campaign-links/preview', this.campaignForm).subscribe({
      next: (result) => {
        this.campaignPreview.set(result);
        if (!this.campaignForm.title) this.campaignForm.title = result.title || '';
        if (!this.campaignForm.message) this.campaignForm.message = result.message || '';
        this.saving.set(false);
      },
      error: (error) => {
        this.error.set(this.errorText(error, 'Unable to preview campaign'));
        this.saving.set(false);
      }
    });
  }

  createCampaignFromRule(): void {
    if (!this.campaignForm.ruleId) {
      this.error.set('Select an active rule first');
      return;
    }
    this.saving.set(true);
    this.error.set('');
    this.api.post<ApiRecord>('happy-hours-campaign-links/from-rule', this.campaignForm).subscribe({
      next: () => {
        this.campaignPreview.set(null);
        this.campaignForm.title = '';
        this.campaignForm.message = '';
        this.saving.set(false);
        this.load();
      },
      error: (error) => {
        this.error.set(this.errorText(error, 'Unable to create campaign draft'));
        this.saving.set(false);
      }
    });
  }

  scanAbuse(): void {
    this.saving.set(true);
    this.error.set('');
    this.api.post<ApiRecord>('happy-hours-control-tower/abuse-alerts/scan', this.params()).subscribe({
      next: () => {
        this.saving.set(false);
        this.load();
      },
      error: (error) => {
        this.error.set(this.errorText(error, 'Unable to scan abuse alerts'));
        this.saving.set(false);
      }
    });
  }

  reviewAlert(alert: ApiRecord, status = 'reviewed'): void {
    this.saving.set(true);
    this.api.patch<ApiRecord>(`happy-hours-control-tower/abuse-alerts/${alert.id}`, { status }).subscribe({
      next: () => {
        this.saving.set(false);
        this.load();
      },
      error: (error) => {
        this.error.set(this.errorText(error, 'Unable to update alert'));
        this.saving.set(false);
      }
    });
  }

  createRuleFromTemplate(template: ApiRecord): void {
    this.saving.set(true);
    this.error.set('');
    this.api.post<ApiRecord>(`happy-hours-control-tower/templates/${template.templateKey}/create-rule`, {
      name: template.name,
      validFrom: this.today(),
      validTo: this.today()
    }).subscribe({
      next: () => {
        this.saving.set(false);
        this.load();
      },
      error: (error) => {
        this.error.set(this.errorText(error, 'Unable to create draft rule'));
        this.saving.set(false);
      }
    });
  }

  exportRoiCsv(): void {
    const rows = this.roi()?.rows || [];
    const headers = ['offerName', 'applications', 'grossRevenuePaise', 'netRevenuePaise', 'totalDiscountPaise', 'repeatClients', 'returnOnDiscountPercent'];
    const lines = [headers.join(','), ...rows.map((row: ApiRecord) => headers.map((key) => this.csvCell(row[key])).join(','))];
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'happy-hours-offer-roi.csv';
    link.click();
    URL.revokeObjectURL(url);
  }

  formatMoney(value: unknown): string {
    return `Rs ${Math.round(Number(value || 0)) / 100}`;
  }

  pct(value: unknown): string {
    return `${Number(value || 0).toFixed(2)}%`;
  }

  pretty(value: unknown): string {
    if (value === undefined || value === null || value === '') return '-';
    if (typeof value === 'object') return JSON.stringify(value);
    return String(value);
  }

  statusClass(value: unknown): string {
    return `status-${String(value || 'draft').replace(/[^a-z0-9_-]/gi, '_').toLowerCase()}`;
  }

  private save(path: string, payload: ApiRecord): void {
    this.saving.set(true);
    this.error.set('');
    this.api.post<ApiRecord>(path, payload).subscribe({
      next: () => {
        this.saving.set(false);
        this.load();
      },
      error: (error) => {
        this.error.set(this.errorText(error, 'Unable to save record'));
        this.saving.set(false);
      }
    });
  }

  private params(): ApiRecord {
    return {
      from: this.filters.from,
      to: this.filters.to
    };
  }

  private today(): string {
    return new Date().toISOString().slice(0, 10);
  }

  private csvCell(value: unknown): string {
    return `"${String(value ?? '').replace(/"/g, '""')}"`;
  }

  private errorText(error: unknown, fallback: string): string {
    const err = error as { error?: { error?: string; message?: string }; message?: string };
    return err?.error?.error || err?.error?.message || err?.message || fallback;
  }
}
