import { LanguageService } from '../../../core/i18n/language.service';
import { CommonModule } from '@angular/common';
import { Component, inject, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { DatePickerComponent } from '../../../shared/date-picker/date-picker.component';
import { ApiEnvelope, ApiService } from '../../../shared/services/api.service';
import { TranslatePipe } from '../../../shared/pipes/translate.pipe';

type Draft = {
  id: string; status: string; sourceFileName: string; sourceSha256: string; sourceSizeBytes: number;
  supplierId?: string; purchaseOrderId?: string; purchaseReceiptId?: string; supplierName: string;
  supplierGstin: string; billNumber: string; billDate?: string; subtotalPaise: number; discountPaise: number;
  cgstPaise: number; sgstPaise: number; igstPaise: number; totalPaise: number; confidenceBps: number;
  warnings: string[]; fieldEvidence: Record<string, Evidence>; version: number; createdAt: string;
};
type Evidence = { confidence_bps?: number; confidenceBps?: number; warnings?: string[] };
type DraftLine = {
  id: string; lineNumber: number; rawName: string; supplierSku: string; inventoryItemId?: string;
  hsnSac: string; purchaseQuantity: number; packSize: number; conversionFactor: number; quantity: number;
  unitCostPaise: number; discountBps: number; discountPaise: number; gstPercent: number; taxablePaise: number;
  cgstPaise: number; sgstPaise: number; igstPaise: number; totalPaise: number; batchNumber: string;
  expiryDate?: string; confidenceBps: number; warnings: string[]; fieldEvidence: Record<string, Evidence>;
};
type Extraction = { id: string; provider: string; modelVersion: string; status: string; errorMessage: string; createdAt: string };
type Match = { id: string; draftLineId?: string; matchType: string; scoreBps: number; status: string; evidence: Record<string, unknown>; createdAt: string };
type DraftEvent = { id: string; eventType: string; actorUserId: string; details: Record<string, unknown>; createdAt: string };
type Details = { draft: Draft; lines: DraftLine[]; extractions: Extraction[]; matches: Match[]; events: DraftEvent[] };
type Supplier = { id: string; name: string; gstin: string; active: boolean };
type Item = { id: string; name: string; sku: string; unit: string; active: boolean };
type Order = { id: string; orderNumber: string; supplierId: string; supplierName: string; status: string };

@Component({
  selector: 'page-purchase-bill-drafts',
  standalone: true,
  imports: [CommonModule, FormsModule, DatePickerComponent, TranslatePipe],
  templateUrl: './purchase-bill-drafts-page.component.html',
  styleUrls: ['./purchase-bill-drafts-page.component.css'],
})
export class PurchaseBillDraftsPageComponent implements OnInit {
  private readonly language = inject(LanguageService);
  private readonly api = inject(ApiService);
  drafts: Draft[] = [];
  suppliers: Supplier[] = [];
  items: Item[] = [];
  orders: Order[] = [];
  selected: Details | null = null;
  status = '';
  loading = true;
  saving = false;
  uploading = false;
  error = '';
  notice = '';

  async ngOnInit() { await this.reload(); }

  async reload(preserve = true) {
    const selectedId = preserve ? this.selected?.draft.id : undefined;
    this.loading = true;
    this.error = '';
    try {
      [this.drafts, this.suppliers, this.items, this.orders] = await Promise.all([
        this.get<Draft[]>(`/purchases/bill-drafts${this.status ? `?status=${encodeURIComponent(this.status)}` : ''}`),
        this.get<Supplier[]>('/purchases/suppliers'),
        this.get<Item[]>('/inventory'),
        this.get<Order[]>('/purchases/orders'),
      ]);
      if (selectedId) await this.open(selectedId);
    } catch (error) { this.error = this.message(error, this.language.text('inventory.message.a8495bad85')); }
    finally { this.loading = false; }
  }

  async upload(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    if (!['application/pdf', 'image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      this.error = this.language.text('inventory.message.2e23275ed2'); return;
    }
    if (file.size > 10 * 1024 * 1024) { this.error = this.language.text('inventory.message.15a6667c94'); return; }
    this.uploading = true; this.error = ''; this.notice = '';
    try {
      const response = await firstValueFrom(this.api.postBytes<ApiEnvelope<Details>>(
        `/purchases/bill-drafts/upload?fileName=${encodeURIComponent(file.name)}`, file,
      ));
      if (!response.data) throw new Error('Upload returned no draft');
      this.selected = response.data;
      this.notice = this.language.text('inventory.message.3a64387121');
      await this.reload();
    } catch (error) { this.error = this.message(error, this.language.text('inventory.message.cf48ce5b00')); }
    finally { this.uploading = false; }
  }

  async open(id: string) {
    try { this.selected = await this.get<Details>(`/purchases/bill-drafts/${id}`); }
    catch (error) { this.error = this.message(error, this.language.text('inventory.message.4c63337c0d')); }
  }

  close() { this.selected = null; }

  async saveHeader() {
    if (!this.selected) return;
    const draft = this.selected.draft;
    await this.mutate(this.api.patch<ApiEnvelope<Details>>(`/purchases/bill-drafts/${draft.id}`, {
      supplierId: draft.supplierId || null, purchaseOrderId: draft.purchaseOrderId || null,
      supplierName: draft.supplierName, supplierGstin: draft.supplierGstin, billNumber: draft.billNumber,
      billDate: draft.billDate || null, subtotalPaise: draft.subtotalPaise, discountPaise: draft.discountPaise,
      cgstPaise: draft.cgstPaise, sgstPaise: draft.sgstPaise, igstPaise: draft.igstPaise,
      totalPaise: draft.totalPaise,
    }), 'Bill header saved');
  }

  async saveLine(line: DraftLine) {
    if (!this.selected) return;
    await this.mutate(this.api.patch<ApiEnvelope<Details>>(
      `/purchases/bill-drafts/${this.selected.draft.id}/lines/${line.id}`, this.linePayload(line),
    ), `Line ${line.lineNumber} saved`);
  }

  async addLine() {
    if (!this.selected) return;
    const line = this.blankLine();
    await this.mutate(this.api.post<ApiEnvelope<Details>>(
      `/purchases/bill-drafts/${this.selected.draft.id}/lines`, this.linePayload(line),
    ), 'Bill line added');
  }

  async removeLine(line: DraftLine) {
    if (!this.selected || !confirm(`Remove line ${line.lineNumber}?`)) return;
    await this.mutate(this.api.delete<ApiEnvelope<Details>>(
      `/purchases/bill-drafts/${this.selected.draft.id}/lines/${line.id}`,
    ), 'Bill line removed');
  }

  async runMatch() {
    if (!this.selected) return;
    await this.mutate(this.api.post<ApiEnvelope<Details>>(
      `/purchases/bill-drafts/${this.selected.draft.id}/match`, {},
    ), 'PO, GRN and product matching refreshed');
  }

  async confirmDraft() {
    if (!this.selected || !confirm(this.language.text('inventory.message.95314d6110'))) return;
    await this.mutate(this.api.post<ApiEnvelope<Details>>(
      `/purchases/bill-drafts/${this.selected.draft.id}/confirm`, {},
    ), 'Bill confirmed and GRN posted');
  }

  async cancelDraft() {
    if (!this.selected || !confirm(this.language.text('inventory.message.3a17f1770d'))) return;
    await this.mutate(this.api.post<ApiEnvelope<Details>>(
      `/purchases/bill-drafts/${this.selected.draft.id}/cancel`, {},
    ), 'Draft cancelled');
  }

  supplierChanged() {
    if (!this.selected) return;
    const supplier = this.suppliers.find((row) => row.id === this.selected?.draft.supplierId);
    if (supplier) { this.selected.draft.supplierName = supplier.name; this.selected.draft.supplierGstin = supplier.gstin || ''; }
  }

  fieldConfidence(field: string) {
    const value = this.selected?.draft.fieldEvidence?.[field];
    return Math.round(Number(value?.confidence_bps ?? value?.confidenceBps ?? 0) / 100);
  }

  money(paise: number) { return `₹${(Number(paise || 0) / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`; }
  rupees(paise: number) { return Number(paise || 0) / 100; }
  paise(value: unknown) { return Math.max(0, Math.round(Number(value || 0) * 100)); }
  confidence(bps: number) { return `${Math.round(Number(bps || 0) / 100)}%`; }
  date(value?: string) { if (!value) return '—'; const iso = value.slice(0, 10).split('-'); return iso.length === 3 ? `${iso[2]}/${iso[1]}/${iso[0]}` : value; }
  itemLabel(id?: string) { const item = this.items.find((row) => row.id === id); return item ? `${item.name} · ${item.sku || 'No SKU'}` : 'Unmatched'; }
  orderLabel(id?: string) { const order = this.orders.find((row) => row.id === id); return order ? `${order.orderNumber} · ${order.supplierName}` : 'No PO'; }
  canEdit() { return !!this.selected && ['review', 'extraction_failed'].includes(this.selected.draft.status); }
  canConfirm() { return this.canEdit() && !!this.selected?.draft.supplierId && !!this.selected.lines.length && this.selected.lines.every((line) => !!line.inventoryItemId && line.quantity > 0); }

  private linePayload(line: DraftLine) {
    return {
      rawName: line.rawName, supplierSku: line.supplierSku, inventoryItemId: line.inventoryItemId || null,
      hsnSac: line.hsnSac, purchaseQuantity: Number(line.purchaseQuantity || 0), packSize: Number(line.packSize || 1),
      conversionFactor: Number(line.conversionFactor || 1), quantity: Number(line.quantity || 0),
      unitCostPaise: Number(line.unitCostPaise || 0), discountBps: Number(line.discountBps || 0),
      discountPaise: Number(line.discountPaise || 0), gstPercent: Number(line.gstPercent || 0),
      taxablePaise: Number(line.taxablePaise || 0), cgstPaise: Number(line.cgstPaise || 0),
      sgstPaise: Number(line.sgstPaise || 0), igstPaise: Number(line.igstPaise || 0),
      totalPaise: Number(line.totalPaise || 0), batchNumber: line.batchNumber, expiryDate: line.expiryDate || null,
    };
  }

  private blankLine(): DraftLine {
    return {
      id: '', lineNumber: (this.selected?.lines.length || 0) + 1, rawName: '', supplierSku: '', hsnSac: '',
      purchaseQuantity: 1, packSize: 1, conversionFactor: 1, quantity: 1, unitCostPaise: 0,
      discountBps: 0, discountPaise: 0, gstPercent: 0, taxablePaise: 0, cgstPaise: 0,
      sgstPaise: 0, igstPaise: 0, totalPaise: 0, batchNumber: '', confidenceBps: 0,
      warnings: [], fieldEvidence: {},
    };
  }

  private async mutate(request: ReturnType<ApiService['post']>, notice: string) {
    this.saving = true; this.error = ''; this.notice = '';
    try {
      const response = await firstValueFrom(request as any) as ApiEnvelope<Details>;
      if (!response.data) throw new Error('API response did not contain data');
      this.selected = response.data;
      this.notice = notice;
      await this.reload();
    } catch (error) { this.error = this.message(error, this.language.text('inventory.message.78b92a0634')); }
    finally { this.saving = false; }
  }

  private async get<T>(path: string) {
    const response = await firstValueFrom(this.api.get<ApiEnvelope<T>>(path));
    if (response.data === undefined) throw new Error('API response did not contain data');
    return response.data;
  }

  private message(error: unknown, fallback: string) {
    const value = error as any;
    return value?.error?.error?.message || value?.error?.message || value?.message || fallback;
  }
}
