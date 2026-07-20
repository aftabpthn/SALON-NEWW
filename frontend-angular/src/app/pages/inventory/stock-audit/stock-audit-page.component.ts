import { CommonModule } from '@angular/common';
import { Component, OnInit, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { ApiEnvelope, ApiService } from '../../../shared/services/api.service';

type AuditStatus = 'counting' | 'recount_required' | 'review' | 'pending_approval' | 'posted' | 'rejected';
type Session = { id: string; name: string; status: AuditStatus; blindCounting: boolean; requiredCounters: number; recountThreshold: number; cutoffAt: string; createdAt: string };
type AuditItem = { id: string; inventoryItemId: string; itemName: string; sku: string; unit: string; expectedQuantity: number | null; approvedQuantity: number | null; varianceQuantity: number | null; varianceReason: string; postedAt: string | null };
type Detail = { session: Session; items: AuditItem[]; counts: Array<{ sessionItemId: string; counterUserId: string; roundNumber: number; countedQuantity: number; createdAt: string }>; findings: Array<{ sessionItemId: string; findingType: string; notes: string; evidence: unknown[]; createdAt: string }> };
type InventoryItem = { id: string; name: string; sku: string; unit: string };

@Component({
  selector: 'page-stock-audit',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './stock-audit-page.component.html',
  styleUrls: ['./stock-audit-page.component.css'],
})
export class StockAuditPageComponent implements OnInit {
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
    } catch (error) { this.error = this.message(error, 'Stock audit data could not be loaded'); }
    finally { this.loading = false; }
  }

  async select(session: Session) { await this.load(session.id); }

  async create() {
    this.saving = true; this.clearFeedback();
    try {
      const detail = await this.post<Detail>('/inventory/stock-audits', this.createForm);
      this.createForm = { name: '', blindCounting: true, requiredCounters: 1, recountThreshold: 0 };
      this.notice = 'Stock count session created';
      await this.load(detail.session.id);
    } catch (error) { this.error = this.message(error, 'Stock audit could not be created'); }
    finally { this.saving = false; }
  }

  async submitCount() {
    const detail = this.selected;
    if (!detail || !this.countForm.inventoryItemId || this.countForm.quantity === null || !Number.isSafeInteger(Number(this.countForm.quantity)) || Number(this.countForm.quantity) < 0) { this.error = 'Select a product and enter a whole counted quantity'; return; }
    this.saving = true; this.clearFeedback();
    try {
      await this.post<Detail>(`/inventory/stock-audits/${detail.session.id}/counts`, { inventoryItemId: this.countForm.inventoryItemId, countedQuantity: Number(this.countForm.quantity), deviceId: this.countForm.deviceId, idempotencyKey: crypto.randomUUID() });
      this.countForm = { ...this.countForm, quantity: null };
      this.notice = 'Count saved';
      await this.load(detail.session.id);
    } catch (error) { this.error = this.message(error, 'Count could not be saved'); }
    finally { this.saving = false; }
  }

  async action(action: 'close-counting' | 'submit' | 'approve') {
    if (!this.selected) return;
    this.saving = true; this.clearFeedback();
    try { await this.post<Detail>(`/inventory/stock-audits/${this.selected.session.id}/${action}`, {}); this.notice = action === 'approve' ? 'Adjustment posted to stock ledger and GL' : 'Stock audit updated'; await this.load(this.selected.session.id); }
    catch (error) { this.error = this.message(error, 'Stock audit action failed'); }
    finally { this.saving = false; }
  }

  async saveReason(item: AuditItem) {
    if (!this.selected) return;
    this.saving = true; this.clearFeedback();
    try { await firstValueFrom(this.api.patch(`/inventory/stock-audits/${this.selected.session.id}/items/${item.inventoryItemId}/reason`, { reason: item.varianceReason })); this.notice = 'Variance reason saved'; await this.load(this.selected.session.id); }
    catch (error) { this.error = this.message(error, 'Reason could not be saved'); }
    finally { this.saving = false; }
  }

  async addFinding() {
    if (!this.selected || !this.findingForm.itemId) { this.error = 'Select an audit item for the finding'; return; }
    const reference = this.findingForm.evidenceReference.trim();
    if ((this.findingForm.findingType === 'leakage' || this.findingForm.findingType === 'theft') && !reference) { this.error = 'Leakage and theft findings need an evidence reference'; return; }
    this.saving = true; this.clearFeedback();
    try {
      await this.post<Detail>(`/inventory/stock-audits/${this.selected.session.id}/items/${this.findingForm.itemId}/findings`, { findingType: this.findingForm.findingType, notes: this.findingForm.notes, evidence: reference ? [{ reference }] : [] });
      this.findingForm = { itemId: '', findingType: 'variance', notes: '', evidenceReference: '' };
      this.notice = 'Finding recorded'; await this.load(this.selected.session.id);
    } catch (error) { this.error = this.message(error, 'Finding could not be saved'); }
    finally { this.saving = false; }
  }

  async reject() {
    if (!this.selected || !this.rejectionReason.trim()) { this.error = 'Rejection reason is required'; return; }
    this.saving = true; this.clearFeedback();
    try { await this.post<Detail>(`/inventory/stock-audits/${this.selected.session.id}/reject`, { reason: this.rejectionReason.trim() }); this.rejectionReason = ''; this.notice = 'Stock audit rejected'; await this.load(this.selected.session.id); }
    catch (error) { this.error = this.message(error, 'Stock audit could not be rejected'); }
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
