import { LanguageService } from '../../../core/i18n/language.service';
import { CommonModule } from '@angular/common';
import { Component, OnInit, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { AuthService } from '../../../core/services/auth.service';
import { ApiEnvelope, ApiService } from '../../../shared/services/api.service';
import { TranslatePipe } from '../../../shared/pipes/translate.pipe';

type AuditStatus = 'counting' | 'recount_required' | 'review' | 'pending_approval' | 'posted' | 'rejected';
type Session = { id: string; name: string; status: AuditStatus; blindCounting: boolean; requiredCounters: number; recountThreshold: number; cutoffAt: string; createdAt: string };
type MovementSummary = { openingQuantity: number; purchaseQuantity: number; purchaseReturnQuantity: number; transferInQuantity: number; transferOutQuantity: number; transferReversalQuantity: number; saleQuantity: number; returnQuantity: number; consumptionQuantity: number; kitComponentOutQuantity: number; kitAssemblyInQuantity: number; adjustmentQuantity: number };
type AuditItem = { id: string; inventoryItemId: string; itemName: string; sku: string; unit: string; expectedQuantity: number | null; expectedUnitCostPaise?: number | null; expectedValuePaise?: number | null; expectedSourceLedgerId?: string | null; expectedLedgerMovementCount?: number | null; expectedProvenanceStatus?: 'verified_ledger' | 'opening_baseline' | 'legacy_snapshot' | null; expectedMovementSummary?: MovementSummary | null; approvedQuantity: number | null; varianceQuantity: number | null; countedValuePaise?: number | null; varianceValuePaise?: number | null; varianceCauseSuggestion?: 'possible_missing_inbound' | 'possible_unrecorded_consumption' | 'possible_missing_sale_or_checkout' | 'unaccounted' | null; varianceReason: string; postedAt: string | null };
type Detail = { session: Session; items: AuditItem[]; counts: Array<{ sessionItemId: string; counterUserId: string; roundNumber: number; countedQuantity: number; createdAt: string }>; findings: Array<{ sessionItemId: string; findingType: string; notes: string; evidence: unknown[]; createdAt: string }>; valueSummary?: { expectedValuePaise: number | null; countedValuePaise: number | null; netVarianceValuePaise: number | null; absoluteVarianceValuePaise: number | null; approvalThresholdPaise: number; ownerApprovalRequired: boolean | null } };

@Component({
    selector: 'page-stock-audit',
    imports: [CommonModule, FormsModule, TranslatePipe],
    templateUrl: './stock-audit-page.component.html',
    styleUrls: ['./stock-audit-page.component.css']
})
export class StockAuditPageComponent implements OnInit {
  private readonly language = inject(LanguageService);
  private readonly api = inject(ApiService);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  sessions: Session[] = [];
  selected: Detail | null = null;
  loading = false;
  saving = false;
  error = '';
  notice = '';
  searchQuery = '';
  countDrafts: Record<string, number | null> = {};
  createForm = { name: '', blindCounting: true, requiredCounters: 1, recountThreshold: 0 };
  countForm = { inventoryItemId: '', quantity: null as number | null, deviceId: this.deviceId() };
  findingForm = { itemId: '', findingType: 'variance', notes: '', evidenceReference: '' };
  rejectionReason = '';

  ngOnInit() { void this.load(); }

  async load(selectId?: string) {
    this.loading = true;
    this.clearFeedback();
    try {
      this.sessions = await this.get<Session[]>('/inventory/stock-audits');
      const target = selectId ?? this.selected?.session.id ?? this.sessions[0]?.id;
      if (target) this.selected = await this.get<Detail>(`/inventory/stock-audits/${target}`);
      else this.selected = null;
    } catch (error) { this.error = this.message(error, this.language.text('inventory.message.5057d29aab')); }
    finally { this.loading = false; }
  }

  async select(session: Session) { await this.load(session.id); }

  get visibleItems() {
    const query = this.searchQuery.trim().toLocaleLowerCase();
    if (!query || !this.selected) return this.selected?.items ?? [];
    return this.selected.items.filter((item) => `${item.itemName} ${item.sku} ${item.unit}`.toLocaleLowerCase().includes(query));
  }

  get countedProductCount() { return this.selected?.items.filter((item) => this.countFor(item) > 0).length ?? 0; }
  get hasDraftCounts() { return this.selected?.items.some((item) => this.countDrafts[item.id] !== null && this.countDrafts[item.id] !== undefined) ?? false; }

  openScanner() {
    if (!this.selected) return;
    void this.router.navigate(['/inventory/scanner'], { queryParams: { auditSessionId: this.selected.session.id } });
  }

  async saveProgress() {
    const detail = this.selected;
    if (!detail) return;
    const rows = detail.items.flatMap((item) => {
      const quantity = this.countDrafts[item.id];
      return quantity === null || quantity === undefined ? [] : [{ item, quantity: Number(quantity) }];
    });
    if (!rows.length || rows.some(({ quantity }) => !Number.isSafeInteger(quantity) || quantity < 0)) {
      this.error = 'Enter a valid whole-number count for at least one product';
      return;
    }

    this.saving = true; this.clearFeedback();
    let saved = 0;
    let failure = '';
    for (const { item, quantity } of rows) {
      try {
        await this.post<Detail>(`/inventory/stock-audits/${detail.session.id}/counts`, { inventoryItemId: item.inventoryItemId, countedQuantity: quantity, deviceId: this.countForm.deviceId, idempotencyKey: crypto.randomUUID() });
        delete this.countDrafts[item.id];
        saved += 1;
      } catch (error) {
        failure = this.message(error, 'Failed to save stock count');
        break;
      }
    }
    await this.load(detail.session.id);
    if (failure) this.error = saved ? `${saved} product counts saved. ${failure}` : failure;
    else this.notice = `${saved} product counts saved`;
    this.saving = false;
  }

  async create() {
    this.saving = true; this.clearFeedback();
    try {
      const detail = await this.post<Detail>('/inventory/stock-audits', this.createForm);
      this.createForm = { name: '', blindCounting: true, requiredCounters: 1, recountThreshold: 0 };
      this.notice = this.language.text('inventory.message.c714f46c02');
      await this.load(detail.session.id);
    } catch (error) { this.error = this.message(error, this.language.text('inventory.message.a2f3b17fa2')); }
    finally { this.saving = false; }
  }

  async submitCount() {
    const detail = this.selected;
    if (!detail || !this.countForm.inventoryItemId || this.countForm.quantity === null || !Number.isSafeInteger(Number(this.countForm.quantity)) || Number(this.countForm.quantity) < 0) { this.error = this.language.text('inventory.message.c16267c8cd'); return; }
    this.saving = true; this.clearFeedback();
    try {
      await this.post<Detail>(`/inventory/stock-audits/${detail.session.id}/counts`, { inventoryItemId: this.countForm.inventoryItemId, countedQuantity: Number(this.countForm.quantity), deviceId: this.countForm.deviceId, idempotencyKey: crypto.randomUUID() });
      this.countForm = { ...this.countForm, quantity: null };
      this.notice = this.language.text('inventory.message.14f753147d');
      await this.load(detail.session.id);
    } catch (error) { this.error = this.message(error, this.language.text('inventory.message.cda56c892d')); }
    finally { this.saving = false; }
  }

  async action(action: 'close-counting' | 'submit' | 'approve') {
    if (!this.selected) return;
    this.saving = true; this.clearFeedback();
    try { await this.post<Detail>(`/inventory/stock-audits/${this.selected.session.id}/${action}`, {}); this.notice = action === 'approve' ? 'Adjustment posted to stock ledger and GL' : 'Stock audit updated'; await this.load(this.selected.session.id); }
    catch (error) { this.error = this.message(error, this.language.text('inventory.message.a5449370e6')); }
    finally { this.saving = false; }
  }

  async saveReason(item: AuditItem) {
    if (!this.selected) return;
    this.saving = true; this.clearFeedback();
    try { await firstValueFrom(this.api.patch(`/inventory/stock-audits/${this.selected.session.id}/items/${item.inventoryItemId}/reason`, { reason: item.varianceReason })); this.notice = this.language.text('inventory.message.61ac4aa70c'); await this.load(this.selected.session.id); }
    catch (error) { this.error = this.message(error, this.language.text('inventory.message.8369ac2ce6')); }
    finally { this.saving = false; }
  }

  async addFinding() {
    if (!this.selected || !this.findingForm.itemId) { this.error = this.language.text('inventory.message.4045e3633e'); return; }
    const reference = this.findingForm.evidenceReference.trim();
    if ((this.findingForm.findingType === 'leakage' || this.findingForm.findingType === 'theft') && !reference) { this.error = this.language.text('inventory.message.50f9c2cded'); return; }
    this.saving = true; this.clearFeedback();
    try {
      await this.post<Detail>(`/inventory/stock-audits/${this.selected.session.id}/items/${this.findingForm.itemId}/findings`, { findingType: this.findingForm.findingType, notes: this.findingForm.notes, evidence: reference ? [{ reference }] : [] });
      this.findingForm = { itemId: '', findingType: 'variance', notes: '', evidenceReference: '' };
      this.notice = this.language.text('inventory.message.2d9631d272'); await this.load(this.selected.session.id);
    } catch (error) { this.error = this.message(error, this.language.text('inventory.message.3fffb72492')); }
    finally { this.saving = false; }
  }

  async reject() {
    if (!this.selected || !this.rejectionReason.trim()) { this.error = this.language.text('inventory.message.dd4e16ac15'); return; }
    this.saving = true; this.clearFeedback();
    try { await this.post<Detail>(`/inventory/stock-audits/${this.selected.session.id}/reject`, { reason: this.rejectionReason.trim() }); this.rejectionReason = ''; this.notice = this.language.text('inventory.message.c512fa8f7e'); await this.load(this.selected.session.id); }
    catch (error) { this.error = this.message(error, this.language.text('inventory.message.9d50b30fe8')); }
    finally { this.saving = false; }
  }

  countFor(item: AuditItem) { return this.selected?.counts.filter((row) => row.sessionItemId === item.id).length ?? 0; }
  provenanceLabel(item: AuditItem) {
    if (item.expectedProvenanceStatus === 'verified_ledger') return `Ledger verified · ${item.expectedLedgerMovementCount ?? 0} movements`;
    if (item.expectedProvenanceStatus === 'opening_baseline') return 'Opening baseline · no ledger movements';
    if (item.expectedProvenanceStatus === 'legacy_snapshot') return 'Legacy snapshot · evidence review required';
    return '';
  }
  movementBreakdown(item: AuditItem) {
    const summary = item.expectedMovementSummary;
    if (!summary) return [];
    return [
      ['Opening / carry-forward', summary.openingQuantity],
      ['Purchases', summary.purchaseQuantity],
      ['Purchase returns', summary.purchaseReturnQuantity],
      ['Transfers in', summary.transferInQuantity],
      ['Transfers out', summary.transferOutQuantity],
      ['Transfer reversals', summary.transferReversalQuantity],
      ['POS sales / checkout', summary.saleQuantity],
      ['Product returns / restock', summary.returnQuantity],
      ['Service consumption', summary.consumptionQuantity],
      ['Kit components', summary.kitComponentOutQuantity],
      ['Kit assemblies', summary.kitAssemblyInQuantity],
      ['Adjustments / discard', summary.adjustmentQuantity],
    ].filter((row, index) => index === 0 || row[1] !== 0) as Array<[string, number]>;
  }
  causeLabel(cause: AuditItem['varianceCauseSuggestion']) {
    if (!cause) return '';
    return ({
      possible_missing_inbound: 'Possible missing inbound',
      possible_unrecorded_consumption: 'Possible unrecorded consumption',
      possible_missing_sale_or_checkout: 'Possible missing sale / checkout',
      unaccounted: 'Unaccounted — investigate',
    } as const)[cause];
  }
  canManage() { return this.auth.hasAccess(['owner', 'admin', 'manager', 'inventory manager', 'inventory_manager', 'inventoryManager'], ['inventory.manage', 'inventory.write']); }
  canCount() { return this.canManage() && !!this.selected && ['counting', 'recount_required'].includes(this.selected.session.status); }
  canReview() { return this.canManage() && this.selected?.session.status === 'review'; }
  canApprove() { return this.auth.hasAccess(['owner'], ['inventory.approve']) && this.selected?.session.status === 'pending_approval'; }
  money(paise: number | null | undefined) { return paise == null ? '—' : this.language.formatCurrency(paise / 100); }
  private async get<T>(path: string) { const response = await firstValueFrom(this.api.get<ApiEnvelope<T>>(path)); if (response.data === undefined) throw new Error('API response did not contain data'); return response.data; }
  private async post<T>(path: string, body: unknown) { const response = await firstValueFrom(this.api.post<ApiEnvelope<T>>(path, body)); if (response.data === undefined) throw new Error('API response did not contain data'); return response.data; }
  private clearFeedback() { this.error = ''; this.notice = ''; }
  private deviceId() { const key = 'aurashine.inventory.scanner.device.v1'; const existing = localStorage.getItem(key); if (existing) return existing; const value = crypto.randomUUID(); localStorage.setItem(key, value); return value; }
  private message(error: any, fallback: string) { return error?.error?.error?.message || error?.error?.error || error?.error?.message || error?.message || fallback; }
}
