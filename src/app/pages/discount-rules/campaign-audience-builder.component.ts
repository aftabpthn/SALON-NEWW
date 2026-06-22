import { CommonModule } from '@angular/common';
import { Component, OnInit, computed, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { forkJoin } from 'rxjs';
import { ApiRecord, ApiService } from '../../core/api.service';

type AudienceTemplate = ApiRecord & {
  key: string;
  name: string;
  description: string;
  criteria: ApiRecord;
  messageHint: string;
};

@Component({
  selector: 'app-campaign-audience-builder',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './campaign-audience-builder.component.html',
  styleUrls: ['./campaign-audience-builder.component.css']
})
export class CampaignAudienceBuilderComponent implements OnInit {
  readonly loading = signal(false);
  readonly saving = signal(false);
  readonly error = signal('');
  readonly templates = signal<AudienceTemplate[]>([]);
  readonly audiences = signal<ApiRecord[]>([]);
  readonly rules = signal<ApiRecord[]>([]);
  readonly coupons = signal<ApiRecord[]>([]);
  readonly preview = signal<ApiRecord | null>(null);
  readonly draftResult = signal<ApiRecord | null>(null);
  readonly previewSample = computed(() => (this.preview()?.sample || []).slice(0, 8));

  filters = {
    status: ''
  };

  form: ApiRecord = this.blankForm();

  readonly statuses = ['', 'draft', 'ready', 'archived'];
  readonly channels = ['whatsapp', 'sms'];

  constructor(private readonly api: ApiService) {}

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.error.set('');
    forkJoin({
      templates: this.api.list<{ rows: AudienceTemplate[] }>('happy-hours-campaign-audiences/templates'),
      audiences: this.api.list<{ rows: ApiRecord[] }>('happy-hours-campaign-audiences', { status: this.filters.status }),
      rules: this.api.list<{ rows: ApiRecord[] }>('discount-rules', { status: 'active' }),
      coupons: this.api.list<{ rows: ApiRecord[] }>('happy-hours-control-tower/coupons', { status: 'active' })
    }).subscribe({
      next: (result) => {
        this.templates.set(result.templates.rows || []);
        this.audiences.set(result.audiences.rows || []);
        this.rules.set(result.rules.rows || []);
        this.coupons.set(result.coupons.rows || []);
        this.loading.set(false);
      },
      error: (error) => {
        this.error.set(this.api.errorText(error, 'Unable to load Campaign Audience Builder'));
        this.loading.set(false);
      }
    });
  }

  applyTemplate(template: AudienceTemplate): void {
    this.form = {
      ...this.form,
      name: template.name,
      audienceKey: template.key,
      templateKey: template.key,
      criteria: { ...template.criteria },
      title: template.messageHint || `${template.name} campaign`
    };
    this.preview.set(null);
    this.draftResult.set(null);
  }

  editAudience(row: ApiRecord): void {
    this.form = {
      name: row.name,
      audienceKey: row.audienceKey,
      templateKey: row.definition?.templateKey || row.audienceKey,
      channel: row.channel || 'whatsapp',
      status: row.status || 'draft',
      criteria: { ...(row.definition?.criteria || {}) },
      ruleId: row.offer?.ruleId || '',
      couponId: row.offer?.couponId || '',
      title: row.offer?.title || row.name,
      message: row.offer?.message || '',
      scheduledFor: row.offer?.scheduledFor || ''
    };
    this.preview.set(row.preview || null);
  }

  previewAudience(): void {
    this.saving.set(true);
    this.error.set('');
    this.api.post<ApiRecord>('happy-hours-campaign-audiences/preview', this.payload()).subscribe({
      next: (result) => {
        this.preview.set(result);
        if (!this.form.message) this.form.message = result.offer?.message || '';
        this.saving.set(false);
      },
      error: (error) => {
        this.error.set(this.api.errorText(error, 'Unable to preview audience'));
        this.saving.set(false);
      }
    });
  }

  saveAudience(): void {
    this.saving.set(true);
    this.error.set('');
    this.api.post<ApiRecord>('happy-hours-campaign-audiences', this.payload()).subscribe({
      next: () => {
        this.saving.set(false);
        this.load();
      },
      error: (error) => {
        this.error.set(this.api.errorText(error, 'Unable to save audience'));
        this.saving.set(false);
      }
    });
  }

  createDraft(): void {
    this.saving.set(true);
    this.error.set('');
    this.api.post<ApiRecord>('happy-hours-campaign-audiences/draft', this.payload()).subscribe({
      next: (result) => {
        this.draftResult.set(result);
        this.preview.set(result.preview || null);
        this.saving.set(false);
        this.load();
      },
      error: (error) => {
        this.error.set(this.api.errorText(error, 'Unable to create campaign draft'));
        this.saving.set(false);
      }
    });
  }

  archive(row: ApiRecord): void {
    this.saving.set(true);
    this.error.set('');
    this.api.patch<ApiRecord>(`happy-hours-campaign-audiences/${row.id}/status`, { status: 'archived' }).subscribe({
      next: () => {
        this.saving.set(false);
        this.load();
      },
      error: (error) => {
        this.error.set(this.api.errorText(error, 'Unable to archive audience'));
        this.saving.set(false);
      }
    });
  }

  formatMoney(value: unknown): string {
    return `Rs ${(Math.round(Number(value || 0)) / 100).toLocaleString('en-IN')}`;
  }

  label(value: unknown): string {
    return String(value || '').replace(/([A-Z])/g, ' $1').replace(/_/g, ' ').trim();
  }

  criteriaText(criteria: ApiRecord = {}): string {
    const parts = Object.entries(criteria)
      .filter(([, value]) => value !== '' && value !== null && value !== undefined)
      .map(([key, value]) => `${this.label(key)}: ${value}`);
    return parts.length ? parts.join(' | ') : 'No criteria';
  }

  couponLabel(coupon: ApiRecord): string {
    return [coupon.code, coupon.title].filter(Boolean).join(' - ') || `Coupon #${coupon.id}`;
  }

  statusClass(value: unknown): string {
    return `status-badge status-${String(value || 'draft').replace(/[^a-z0-9_-]/gi, '_').toLowerCase()}`;
  }

  private payload(): ApiRecord {
    return {
      name: this.form.name,
      audienceKey: this.form.audienceKey,
      templateKey: this.form.templateKey,
      channel: this.form.channel || 'whatsapp',
      status: this.form.status || 'draft',
      criteria: this.cleanCriteria(this.form.criteria || {}),
      ruleId: this.form.ruleId || null,
      couponId: this.form.couponId || null,
      title: this.form.title,
      message: this.form.message,
      scheduledFor: this.form.scheduledFor
    };
  }

  private cleanCriteria(criteria: ApiRecord): ApiRecord {
    const clean: ApiRecord = {};
    for (const [key, value] of Object.entries(criteria)) {
      if (value === '' || value === undefined || value === null) continue;
      clean[key] = ['inactiveDaysGte', 'inactiveDaysLte', 'visitCountGte', 'visitCountLte', 'totalSpendPaiseGte', 'createdWithinDays'].includes(key)
        ? Number(value)
        : value;
    }
    return clean;
  }

  private blankForm(): ApiRecord {
    return {
      name: 'Inactive 60 Days',
      audienceKey: 'inactive_60_days',
      templateKey: 'inactive_60_days',
      channel: 'whatsapp',
      status: 'draft',
      criteria: {
        inactiveDaysGte: 60,
        inactiveDaysLte: '',
        visitCountGte: 1,
        visitCountLte: '',
        totalSpendPaiseGte: '',
        createdWithinDays: '',
        birthdayMonth: '',
        clientType: '',
        lastServiceCategory: '',
        serviceCategory: ''
      },
      ruleId: '',
      couponId: '',
      title: 'Limited-time comeback offer',
      message: '',
      scheduledFor: ''
    };
  }
}
