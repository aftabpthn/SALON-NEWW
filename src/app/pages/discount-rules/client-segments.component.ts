import { CommonModule } from '@angular/common';
import { Component, OnInit, computed, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ApiRecord, ApiService } from '../../core/api.service';

type SegmentTemplate = {
  key: string;
  name: string;
  description: string;
  criteria: ApiRecord;
  recommendedOffer: string;
};

@Component({
  selector: 'app-happy-hours-client-segments',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './client-segments.component.html',
  styleUrls: ['./client-segments.component.css']
})
export class HappyHoursClientSegmentsComponent implements OnInit {
  readonly segments = signal<ApiRecord[]>([]);
  readonly evaluation = signal<ApiRecord | null>(null);
  readonly loading = signal(false);
  readonly saving = signal(false);
  readonly error = signal('');

  readonly activeSegments = computed(() => this.segments().filter((row) => row.status === 'active').length);
  readonly inactiveSegments = computed(() => this.segments().filter((row) => row.definition?.criteria?.inactiveDaysGte !== undefined).length);
  readonly valueSegments = computed(() => this.segments().filter((row) => row.definition?.criteria?.totalSpendPaiseGte !== undefined).length);
  readonly evaluationMatches = computed(() => this.evaluation()?.matches || []);

  filters = {
    status: ''
  };

  segmentForm: ApiRecord = this.blankSegment();

  sampleContext: ApiRecord = {
    visitCount: 0,
    inactiveDays: 45,
    totalSpendPaise: 1500000,
    clientType: 'new',
    serviceCategory: 'bridal'
  };

  readonly statuses = ['', 'active', 'paused', 'draft'];
  readonly templates: SegmentTemplate[] = [
    {
      key: 'new_clients',
      name: 'New Clients',
      description: 'First visit or near-first-visit clients for acquisition offers.',
      criteria: { visitCountLte: 0, clientType: 'new' },
      recommendedOffer: '10-15% first visit coupon with strict per-client limit.'
    },
    {
      key: 'vip_clients',
      name: 'VIP Clients',
      description: 'High-spend repeat clients for premium retention campaigns.',
      criteria: { totalSpendPaiseGte: 1000000, visitCountGte: 5 },
      recommendedOffer: 'Lower discount, stronger service/package perk.'
    },
    {
      key: 'inactive_60_days',
      name: 'Inactive 60 Days',
      description: 'Clients who have not returned recently and need a win-back offer.',
      criteria: { inactiveDaysGte: 60, visitCountGte: 1 },
      recommendedOffer: '15-20% limited-time win-back offer.'
    },
    {
      key: 'high_spend_clients',
      name: 'High Spend Clients',
      description: 'Clients with strong historical value and upsell potential.',
      criteria: { totalSpendPaiseGte: 2500000, visitCountGte: 3 },
      recommendedOffer: 'Bundle/package upgrade instead of heavy discount.'
    },
    {
      key: 'bridal_package_clients',
      name: 'Bridal / Package Clients',
      description: 'Bridal and package-ready clients for high-ticket campaigns.',
      criteria: { serviceCategory: 'bridal', totalSpendPaiseGte: 500000 },
      recommendedOffer: 'Bundle price or premium package voucher.'
    },
    {
      key: 'at_risk_value_clients',
      name: 'At-risk Value Clients',
      description: 'Valuable clients with inactivity risk.',
      criteria: { inactiveDaysGte: 45, totalSpendPaiseGte: 1000000 },
      recommendedOffer: 'Retention save offer with manager-approved cap.'
    }
  ];

  constructor(private readonly api: ApiService) {}

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.error.set('');
    this.api.list<{ rows: ApiRecord[] }>('happy-hours-control-tower/segments', {
      status: this.filters.status
    }).subscribe({
      next: (result) => {
        this.segments.set(result.rows || []);
        this.loading.set(false);
      },
      error: (error) => {
        this.error.set(this.errorText(error, 'Unable to load client segments'));
        this.loading.set(false);
      }
    });
  }

  applyTemplate(template: SegmentTemplate): void {
    this.segmentForm = {
      name: template.name,
      segmentKey: template.key,
      definition: { criteria: { ...template.criteria }, recommendedOffer: template.recommendedOffer },
      status: 'active'
    };
  }

  editSegment(row: ApiRecord): void {
    this.segmentForm = {
      name: row.name,
      segmentKey: row.segmentKey,
      definition: {
        criteria: { ...(row.definition?.criteria || row.definition || {}) },
        recommendedOffer: row.definition?.recommendedOffer || ''
      },
      status: row.status || 'active'
    };
  }

  saveSegment(): void {
    this.saving.set(true);
    this.error.set('');
    this.api.post<ApiRecord>('happy-hours-control-tower/segments', this.cleanSegmentPayload()).subscribe({
      next: () => {
        this.saving.set(false);
        this.segmentForm = this.blankSegment();
        this.load();
      },
      error: (error) => {
        this.error.set(this.errorText(error, 'Unable to save segment'));
        this.saving.set(false);
      }
    });
  }

  evaluate(): void {
    this.saving.set(true);
    this.error.set('');
    this.api.post<ApiRecord>('happy-hours-control-tower/segments/evaluate', {
      context: this.cleanContext()
    }).subscribe({
      next: (result) => {
        this.evaluation.set(result);
        this.saving.set(false);
      },
      error: (error) => {
        this.error.set(this.errorText(error, 'Unable to evaluate segment'));
        this.saving.set(false);
      }
    });
  }

  criteriaText(row: ApiRecord): string {
    const criteria = row.definition?.criteria || row.definition || {};
    const parts = Object.entries(criteria)
      .filter(([, value]) => value !== undefined && value !== null && value !== '')
      .map(([key, value]) => `${this.label(key)}: ${value}`);
    return parts.length ? parts.join(' | ') : 'No criteria';
  }

  recommendedOffer(row: ApiRecord): string {
    return row.definition?.recommendedOffer || 'Use safe discount cap and ROI tracking.';
  }

  label(value: unknown): string {
    return String(value || '').replace(/([A-Z])/g, ' $1').replace(/_/g, ' ').trim();
  }

  formatMoney(value: unknown): string {
    return `Rs ${Math.round(Number(value || 0)) / 100}`;
  }

  statusClass(value: unknown): string {
    return `status-badge status-${String(value || 'active').replace(/[^a-z0-9_-]/gi, '_').toLowerCase()}`;
  }

  private blankSegment(): ApiRecord {
    return {
      name: 'VIP Clients',
      segmentKey: 'vip_clients',
      definition: {
        criteria: {
          visitCountGte: 5,
          visitCountLte: '',
          inactiveDaysGte: '',
          totalSpendPaiseGte: 1000000,
          clientType: '',
          serviceCategory: ''
        },
        recommendedOffer: 'Lower discount, stronger service/package perk.'
      },
      status: 'active'
    };
  }

  private cleanSegmentPayload(): ApiRecord {
    const criteria = this.cleanCriteria(this.segmentForm.definition?.criteria || {});
    return {
      name: this.segmentForm.name,
      segmentKey: this.segmentForm.segmentKey,
      definition: {
        criteria,
        recommendedOffer: this.segmentForm.definition?.recommendedOffer || ''
      },
      status: this.segmentForm.status || 'active'
    };
  }

  private cleanCriteria(criteria: ApiRecord): ApiRecord {
    const clean: ApiRecord = {};
    for (const [key, value] of Object.entries(criteria)) {
      if (value === '' || value === undefined || value === null) continue;
      clean[key] = ['visitCountGte', 'visitCountLte', 'inactiveDaysGte', 'totalSpendPaiseGte'].includes(key) ? Number(value) : value;
    }
    return clean;
  }

  private cleanContext(): ApiRecord {
    return {
      visitCount: Number(this.sampleContext.visitCount || 0),
      inactiveDays: Number(this.sampleContext.inactiveDays || 0),
      totalSpendPaise: Number(this.sampleContext.totalSpendPaise || 0),
      clientType: this.sampleContext.clientType || '',
      serviceCategory: this.sampleContext.serviceCategory || ''
    };
  }

  private errorText(error: unknown, fallback: string): string {
    const err = error as { error?: { error?: string; message?: string }; message?: string };
    return err?.error?.error || err?.error?.message || err?.message || fallback;
  }
}
