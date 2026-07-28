
import { Component, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ApiService } from '../../../shared/services/api.service';

interface PaymentMode {
  id: string;
  code: string;
  name: string;
  settlementType: string;
  shortcut: string;
  active: boolean;
  showOnInvoice: boolean;
  referenceRequired: boolean;
  sortOrder: number;
}

interface PaymentModeDraft {
  name: string;
  settlementType: string;
  shortcut: string;
  active: boolean;
  showOnInvoice: boolean;
  referenceRequired: boolean;
  sortOrder: number | null;
}

@Component({
    selector: 'app-pos-payment-modes-page',
    imports: [FormsModule, RouterLink],
    templateUrl: './pos-payment-modes-page.component.html',
    styleUrls: ['./pos-payment-modes-page.component.css']
})
export class PosPaymentModesPageComponent implements OnInit {
  modes: PaymentMode[] = [];
  draft: PaymentModeDraft = this.emptyDraft();
  editingId: string | null = null;
  search = '';
  statusFilter: 'all' | 'active' | 'inactive' | 'reference-gap' = 'all';
  saving = false;
  loading = false;
  fixingReferences = false;
  message = '';
  error = '';
  private initializedDefaults = false;

  constructor(private readonly api: ApiService) {}

  ngOnInit(): void { this.load(); }

  load(): void {
    this.loading = true;
    this.error = '';
    this.api.get<any>('/settings/payment-methods').subscribe({
      next: (response) => {
        this.modes = this.rows(response);
        this.loading = false;
        if (!this.modes.length && !this.initializedDefaults) this.initializeDefaults();
      },
      error: (err: any) => { this.loading = false; this.error = this.messageFor(err); },
    });
  }

  get visibleModes(): PaymentMode[] {
    const query = this.search.trim().toLowerCase();
    return this.modes.filter((mode) => {
      const text = `${mode.name} ${mode.code} ${mode.settlementType} ${mode.shortcut}`.toLowerCase();
      if (query && !text.includes(query)) return false;
      if (this.statusFilter === 'active') return mode.active;
      if (this.statusFilter === 'inactive') return !mode.active;
      if (this.statusFilter === 'reference-gap') return this.referenceGap(mode);
      return true;
    });
  }

  get referenceGapCount(): number {
    return this.modes.filter((mode) => this.referenceGap(mode)).length;
  }

  edit(mode: PaymentMode): void {
    this.editingId = mode.id;
    this.draft = { name: mode.name, settlementType: mode.settlementType, shortcut: mode.shortcut, active: mode.active, showOnInvoice: mode.showOnInvoice, referenceRequired: mode.referenceRequired, sortOrder: mode.sortOrder };
    this.message = '';
    this.error = '';
  }

  reset(): void { this.editingId = null; this.draft = this.emptyDraft(); this.error = ''; }

  onSettlementTypeChange(): void {
    if (this.referenceRecommended(this.draft.settlementType)) this.draft.referenceRequired = true;
  }

  save(): void {
    if (!this.draft.name.trim()) { this.error = 'Mode name is required'; return; }
    this.saving = true;
    this.error = '';
    const body = { ...this.draft, name: this.draft.name.trim(), shortcut: this.draft.shortcut.trim(), sortOrder: this.draft.sortOrder ?? undefined };
    const request = this.editingId
      ? this.api.patch(`/settings/payment-methods/${this.editingId}`, body)
      : this.api.post('/settings/payment-methods', body);
    request.subscribe({
      next: () => { this.message = this.editingId ? 'Payment mode updated' : 'Payment mode added'; this.saving = false; this.reset(); this.load(); },
      error: (err: any) => { this.error = this.messageFor(err); this.saving = false; },
    });
  }

  deactivate(mode: PaymentMode): void {
    if (!window.confirm(`Deactivate ${mode.name}? It will no longer appear at checkout.`)) return;
    this.api.patch(`/settings/payment-methods/${mode.id}`, { active: false }).subscribe({ next: () => this.load(), error: (err: any) => this.error = this.messageFor(err) });
  }

  activate(mode: PaymentMode): void {
    this.api.patch(`/settings/payment-methods/${mode.id}`, { active: true }).subscribe({ next: () => this.load(), error: (err: any) => this.error = this.messageFor(err) });
  }

  fixReferenceGaps(): void {
    const gaps = this.modes.filter((mode) => this.referenceGap(mode));
    if (!gaps.length || this.fixingReferences) return;
    this.fixingReferences = true;
    this.patchReferenceGap(gaps, 0);
  }

  referenceGap(mode: PaymentMode): boolean {
    return mode.active && this.referenceRecommended(mode.settlementType) && !mode.referenceRequired;
  }

  referenceRecommendation(mode: PaymentMode): string {
    return this.referenceGap(mode) ? 'Reference recommended' : mode.referenceRequired ? 'Reference required' : 'Reference optional';
  }

  private initializeDefaults(): void {
    this.initializedDefaults = true;
    this.api.post('/settings/payment-methods/initialize', {}).subscribe({
      next: (response) => { this.modes = this.rows(response); },
      error: (err: any) => this.error = this.messageFor(err),
    });
  }

  private patchReferenceGap(gaps: PaymentMode[], index: number): void {
    if (index >= gaps.length) {
      this.fixingReferences = false;
      this.message = 'Reference policy updated';
      this.load();
      return;
    }
    this.api.patch(`/settings/payment-methods/${gaps[index].id}`, { referenceRequired: true }).subscribe({
      next: () => this.patchReferenceGap(gaps, index + 1),
      error: (err: any) => { this.fixingReferences = false; this.error = this.messageFor(err); this.load(); },
    });
  }

  private rows(response: any): PaymentMode[] { const rows = Array.isArray(response) ? response : response?.data ?? response?.items ?? []; return Array.isArray(rows) ? rows : []; }
  private emptyDraft(): PaymentModeDraft { return { name: '', settlementType: 'custom', shortcut: '', active: true, showOnInvoice: true, referenceRequired: false, sortOrder: null }; }
  private referenceRecommended(settlementType: string): boolean { return ['upi', 'card', 'bank_transfer', 'gift_card', 'store_credit'].includes(settlementType); }
  private messageFor(error: any): string { return error?.error?.message ?? error?.message ?? 'Unable to save payment mode'; }
}
