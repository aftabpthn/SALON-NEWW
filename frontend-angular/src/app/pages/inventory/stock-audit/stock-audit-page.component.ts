import { LanguageService } from '../../../core/i18n/language.service';
import { CommonModule } from '@angular/common';
import { Component, OnInit, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { ApiEnvelope, ApiService } from '../../../shared/services/api.service';
import { TranslatePipe } from '../../../shared/pipes/translate.pipe';

type AuditStatus = 'counting' | 'recount_required' | 'review' | 'pending_approval' | 'posted' | 'rejected';
type Session = { id: string; name: string; status: AuditStatus; blindCounting: boolean; requiredCounters: number; recountThreshold: number; cutoffAt: string; createdAt: string };
type AuditItem = { id: string; inventoryItemId: string; itemName: string; sku: string; unit: string; expectedQuantity: number | null; approvedQuantity: number | null; varianceQuantity: number | null; varianceReason: string; postedAt: string | null };
type Detail = { session: Session; items: AuditItem[]; counts: Array<{ sessionItemId: string; counterUserId: string; roundNumber: number; countedQuantity: number; createdAt: string }>; findings: Array<{ sessionItemId: string; findingType: string; notes: string; evidence: unknown[]; createdAt: string }> };
type InventoryItem = { id: string; name: string; sku: string; unit: string };

@Component({
  selector: 'page-stock-audit',
  standalone: true,
  imports: [CommonModule, FormsModule, TranslatePipe],
  templateUrl: './stock-audit-page.component.html',
  styleUrls: ['./stock-audit-page.component.css'],
})
export class StockAuditPageComponent implements OnInit {
  private readonly language = inject(LanguageService);
  private readonly api = inject(ApiService);
  sessions: Session[] = [];
  inventory: InventoryItem[] = [];
  selected: Detail | null = null;
  loading = false;
  saving = false;
  error = '';
  notice = '';
  createForm = { name: '', blindCounting: true, requiredCounters: 1, recountThreshold: 0 };
  countForm = { inventoryItemId: '', quantity: null as number | null, deviceId: this.deviceId() };
  findingForm = { itemId: '', findingType: 'variance', notes: '', evidenceReference: '' };
  rejectionReason = '';

  ngOnInit() { void this.load(); }

  async load(selectId?: string) {
    this.loading = true;
    this.clearFeedback();
    try {
      const [sessions, inventory] = await Promise.all([
        this.get<Session[]>('/inventory/stock-audits'),
        this.get<InventoryItem[]>('/inventory?pageSize=200'),
      ]);
      this.sessions = sessions;
      this.inventory = inventory;
      const target = selectId ?? this.selected?.session.id;
      if (target) this.selected = await this.get<Detail>(`/inventory/stock-audits/${target}`);
      else this.selected = null;
    } catch (error) { this.error = this.message(error, this.language.text('inventory.message.5057d29aab')); }
    finally { this.loading = false; }
  }

  async select(session: Session) { await this.load(session.id); }

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
  canCount() { return !!this.selected && ['counting', 'recount_required'].includes(this.selected.session.status); }
  canReview() { return this.selected?.session.status === 'review'; }
  canApprove() { return this.selected?.session.status === 'pending_approval'; }
  private async get<T>(path: string) { const response = await firstValueFrom(this.api.get<ApiEnvelope<T>>(path)); if (response.data === undefined) throw new Error('API response did not contain data'); return response.data; }
  private async post<T>(path: string, body: unknown) { const response = await firstValueFrom(this.api.post<ApiEnvelope<T>>(path, body)); if (response.data === undefined) throw new Error('API response did not contain data'); return response.data; }
  private clearFeedback() { this.error = ''; this.notice = ''; }
  private deviceId() { const key = 'aurashine.inventory.scanner.device.v1'; const existing = localStorage.getItem(key); if (existing) return existing; const value = crypto.randomUUID(); localStorage.setItem(key, value); return value; }
  private message(error: any, fallback: string) { return error?.error?.error?.message || error?.error?.error || error?.error?.message || error?.message || fallback; }
}
