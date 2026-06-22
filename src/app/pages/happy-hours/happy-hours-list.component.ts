import { CommonModule } from '@angular/common';
import { Component, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { HappyHoursService } from './happy-hours.service';

type HappyHour = Record<string, any>;

@Component({
  selector: 'app-happy-hours-list',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './happy-hours-list.component.html'
})
export class HappyHoursListComponent implements OnInit {
  readonly happyHours = signal<HappyHour[]>([]);
  readonly activeNowIds = signal<Set<number>>(new Set());
  readonly showForm = signal(false);
  readonly editingId = signal<number | null>(null);
  readonly loading = signal(false);
  readonly error = signal('');
  readonly durationTiers = signal<HappyHour[]>([]);
  readonly bundles = signal<HappyHour[]>([]);

  draft: HappyHour = this.emptyDraft();
  durationTierDraft = { minDurationMins: 60, maxDurationMins: '', bonusPercent: 5 };
  bundleDraft = { name: '', serviceIds: '', percentOff: 10, bundlePricePaise: '' };

  constructor(private readonly service: HappyHoursService) {}

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.error.set('');
    this.service.list().subscribe({
      next: (result) => {
        this.happyHours.set(result.rows || result || []);
        this.loading.set(false);
        this.loadActiveNow();
        this.loadBundles();
      },
      error: (error) => {
        this.error.set(error?.error?.error || error?.message || 'Unable to load happy hours');
        this.loading.set(false);
      }
    });
  }

  loadActiveNow(): void {
    this.service.getActiveNow().subscribe({
      next: (rows) => this.activeNowIds.set(new Set((rows || []).map((row: HappyHour) => Number(row.id)))),
      error: () => this.activeNowIds.set(new Set())
    });
  }

  loadBundles(): void {
    this.service.listBundles().subscribe({
      next: (rows) => this.bundles.set(rows || []),
      error: () => this.bundles.set([])
    });
  }

  openForm(): void {
    this.editingId.set(null);
    this.draft = this.emptyDraft();
    this.durationTiers.set([]);
    this.showForm.set(true);
  }

  edit(hh: HappyHour): void {
    this.editingId.set(Number(hh.id));
    this.draft = {
      name: hh.name || '',
      description: hh.description || '',
      dayOfWeek: hh.dayOfWeek || 'everyday',
      startTime: hh.startTime || '',
      endTime: hh.endTime || '',
      discountType: hh.discountType || 'percent',
      discountValue: Number(hh.discountValue || 0),
      applicableTo: hh.applicableTo || 'all',
      maxDiscountPaise: Number(hh.maxDiscountPaise || 0),
      priority: Number(hh.priority || 1),
      stackable: Boolean(hh.stackable),
      validFrom: hh.validFrom || '',
      validTo: hh.validTo || '',
      serviceIds: (hh.services || []).map((service: HappyHour) => service.serviceId).join(',')
    };
    this.showForm.set(true);
    this.loadDurationTiers(Number(hh.id));
  }

  loadDurationTiers(id: number): void {
    this.service.listDurationTiers(id).subscribe({
      next: (rows) => this.durationTiers.set(rows || []),
      error: () => this.durationTiers.set([])
    });
  }

  save(): void {
    const body = this.toPayload();
    const id = this.editingId();
    const request = id ? this.service.update(id, body) : this.service.create(body);
    request.subscribe({
      next: () => {
        this.showForm.set(false);
        this.load();
      },
      error: (error) => this.error.set(error?.error?.error || error?.message || 'Unable to save happy hour')
    });
  }

  toggle(hh: HappyHour): void {
    const status = hh.status === 'active' ? 'inactive' : 'active';
    this.service.toggle(Number(hh.id), status).subscribe({
      next: () => this.load(),
      error: (error) => this.error.set(error?.error?.error || error?.message || 'Unable to toggle happy hour')
    });
  }

  remove(hh: HappyHour): void {
    if (!confirm(`Delete ${hh.name}?`)) return;
    this.service.remove(Number(hh.id)).subscribe({
      next: () => this.load(),
      error: (error) => this.error.set(error?.error?.error || error?.message || 'Unable to delete happy hour')
    });
  }

  isActiveNow(hh: HappyHour): boolean {
    return this.activeNowIds().has(Number(hh.id));
  }

  addDurationTier(): void {
    const id = this.editingId();
    if (!id) return;
    this.service.addDurationTier(id, {
      minDurationMins: Number(this.durationTierDraft.minDurationMins || 0),
      maxDurationMins: this.durationTierDraft.maxDurationMins || null,
      bonusPercent: Number(this.durationTierDraft.bonusPercent || 0)
    }).subscribe({
      next: () => this.loadDurationTiers(id),
      error: (error) => this.error.set(error?.error?.error || error?.message || 'Unable to save duration tier')
    });
  }

  removeDurationTier(tier: HappyHour): void {
    const id = this.editingId();
    if (!id) return;
    this.service.removeDurationTier(id, Number(tier.id)).subscribe({
      next: () => this.loadDurationTiers(id),
      error: (error) => this.error.set(error?.error?.error || error?.message || 'Unable to remove duration tier')
    });
  }

  createBundle(): void {
    const serviceIds = String(this.bundleDraft.serviceIds || '')
      .split(',')
      .map((id) => id.trim())
      .filter(Boolean);
    this.service.createBundle({
      name: this.bundleDraft.name,
      serviceIds,
      percentOff: Number(this.bundleDraft.percentOff || 0),
      bundlePricePaise: this.bundleDraft.bundlePricePaise || null
    }).subscribe({
      next: () => {
        this.bundleDraft = { name: '', serviceIds: '', percentOff: 10, bundlePricePaise: '' };
        this.loadBundles();
      },
      error: (error) => this.error.set(error?.error?.error || error?.message || 'Unable to save bundle')
    });
  }

  removeBundle(bundle: HappyHour): void {
    this.service.removeBundle(Number(bundle.id)).subscribe({
      next: () => this.loadBundles(),
      error: (error) => this.error.set(error?.error?.error || error?.message || 'Unable to remove bundle')
    });
  }

  discountLabel(hh: HappyHour): string {
    return hh.discountType === 'flat' ? `₹${Number(hh.discountValue || 0) / 100}` : `${hh.discountValue || 0}%`;
  }

  scopeLabel(hh: HappyHour): string {
    if (hh.applicableTo === 'services') return `${hh.services?.length || 0} services`;
    if (hh.applicableTo === 'categories') return 'Categories';
    return 'All services';
  }

  cancelForm(): void {
    this.showForm.set(false);
    this.editingId.set(null);
    this.durationTiers.set([]);
  }

  private emptyDraft(): HappyHour {
    return {
      name: '',
      description: '',
      dayOfWeek: 'everyday',
      startTime: '10:00',
      endTime: '13:00',
      discountType: 'percent',
      discountValue: 10,
      applicableTo: 'all',
      maxDiscountPaise: 0,
      priority: 1,
      stackable: false,
      validFrom: '',
      validTo: '',
      serviceIds: ''
    };
  }

  private toPayload(): HappyHour {
    const serviceIds = String(this.draft.serviceIds || '')
      .split(',')
      .map((id) => id.trim())
      .filter(Boolean);
    return {
      ...this.draft,
      discountValue: Number(this.draft.discountValue || 0),
      maxDiscountPaise: Number(this.draft.maxDiscountPaise || 0),
      priority: Number(this.draft.priority || 1),
      stackable: this.draft.stackable ? 1 : 0,
      validFrom: this.draft.validFrom || null,
      validTo: this.draft.validTo || null,
      serviceIds
    };
  }
}
