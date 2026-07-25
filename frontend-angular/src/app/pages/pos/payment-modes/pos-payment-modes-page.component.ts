
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
  saving = false;
  message = '';
  error = '';

  constructor(private readonly api: ApiService) {}

  ngOnInit(): void { this.load(); }

  load(): void {
    this.api.get<any>('/settings/payment-methods').subscribe({
      next: (response) => {
        this.modes = this.rows(response);
      },
      error: (err: any) => this.error = this.messageFor(err),
    });
  }

  edit(mode: PaymentMode): void {
    this.editingId = mode.id;
    this.draft = { name: mode.name, settlementType: mode.settlementType, shortcut: mode.shortcut, active: mode.active, showOnInvoice: mode.showOnInvoice, referenceRequired: mode.referenceRequired, sortOrder: mode.sortOrder };
    this.message = '';
    this.error = '';
  }

  reset(): void { this.editingId = null; this.draft = this.emptyDraft(); this.error = ''; }

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

  private rows(response: any): PaymentMode[] { const rows = Array.isArray(response) ? response : response?.data ?? response?.items ?? []; return Array.isArray(rows) ? rows : []; }
  private emptyDraft(): PaymentModeDraft { return { name: '', settlementType: 'custom', shortcut: '', active: true, showOnInvoice: true, referenceRequired: false, sortOrder: null }; }
  private messageFor(error: any): string { return error?.error?.message ?? error?.message ?? 'Unable to save payment mode'; }
}
