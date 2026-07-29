import { LanguageService } from '../../../core/i18n/language.service';

import { Component, inject, OnDestroy, OnInit } from '@angular/core';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { DatePickerComponent } from '../../../shared/date-picker/date-picker.component';
import { ApiEnvelope, ApiService } from '../../../shared/services/api.service';
import { TranslatePipe } from '../../../shared/pipes/translate.pipe';

type Draft = {
  id: string; status: string; sourceFileName: string; sourceContentType: string; sourceSha256: string; sourceSizeBytes: number;
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
type Extraction = { id: string; provider: string; modelVersion: string; status: string; errorMessage: string; rawResponse: Record<string, unknown>; createdAt: string };
type Match = { id: string; draftLineId?: string; matchType: string; scoreBps: number; status: string; evidence: Record<string, unknown>; createdAt: string };
type DraftEvent = { id: string; eventType: string; actorUserId: string; details: Record<string, unknown>; createdAt: string };
type Details = { draft: Draft; lines: DraftLine[]; extractions: Extraction[]; matches: Match[]; events: DraftEvent[] };
type Supplier = { id: string; name: string; gstin: string; active: boolean };
type Item = { id: string; name: string; sku: string; unit: string; active: boolean };
type Order = { id: string; orderNumber: string; supplierId: string; supplierName: string; status: string };
type ProductDraft = { sku: string; category: string; unit: string; packageUnit: string; batchTracked: boolean };

@Component({
    selector: 'page-purchase-bill-drafts',
    imports: [FormsModule, DatePickerComponent, TranslatePipe],
    templateUrl: './purchase-bill-drafts-page.component.html',
    styleUrls: ['./purchase-bill-drafts-page.component.css']
})
export class PurchaseBillDraftsPageComponent implements OnInit, OnDestroy {
  private readonly language = inject(LanguageService);
  private readonly api = inject(ApiService);
  private readonly sanitizer = inject(DomSanitizer);
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
  itemSearch = '';
  previewUrl = '';
  previewSafeUrl: SafeResourceUrl | null = null;
  previewMime = '';
  previewLoading = false;
  previewError = '';
  private sourceBlob: Blob | null = null;
  private previewDraftId = '';
  private itemSearchTimer?: ReturnType<typeof setTimeout>;
  private itemSearchRequest = 0;
  readonly productDrafts: Record<string, ProductDraft> = {};

  async ngOnInit() { await this.reload(); }
  ngOnDestroy() { this.clearPreview(); if (this.itemSearchTimer) clearTimeout(this.itemSearchTimer); }

  async reload(preserve = true) {
    const selectedId = preserve ? this.selected?.draft.id : undefined;
    this.loading = true;
    this.error = '';
    try {
      this.drafts = await this.get<Draft[]>(`/purchases/bill-drafts${this.status ? `?status=${encodeURIComponent(this.status)}` : ''}`);
      void this.loadReferences();
      if (selectedId) await this.open(selectedId);
    } catch (error) { this.error = this.message(error, this.language.text('inventory.message.a8495bad85')); }
    finally { this.loading = false; }
  }

  private async loadReferences() {
    try {
      const [suppliers, orders] = await Promise.all([this.get<Supplier[]>('/purchases/suppliers'), this.get<Order[]>('/purchases/orders?page=1&pageSize=50&withCount=false')]);
      this.suppliers = suppliers;
      this.orders = orders;
      await this.loadItems(this.itemSearch);
    } catch (error) { this.error ||= this.message(error, this.language.text('inventory.message.a8495bad85')); }
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
    try {
      this.selected = await this.get<Details>(`/purchases/bill-drafts/${id}`);
      await this.loadPreview(id);
    }
    catch (error) { this.error = this.message(error, this.language.text('inventory.message.4c63337c0d')); }
  }

  close() { this.selected = null; this.clearPreview(); }

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
    this.recalculateLine(line);
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

  async createSupplier() {
    const draft = this.selected?.draft;
    if (!draft?.supplierName.trim()) { this.error = 'Supplier name is required'; return; }
    this.saving = true; this.error = ''; this.notice = '';
    try {
      const response = await firstValueFrom(this.api.post<ApiEnvelope<Supplier>>('/purchases/suppliers', {
        code: '', name: this.titleCase(draft.supplierName), gstin: draft.supplierGstin.trim().toUpperCase(),
        contactName: '', phone: '', email: '', address: '', paymentTermsDays: 0, active: true,
      }));
      if (!response.data) throw new Error('Supplier could not be created');
      this.suppliers = [...this.suppliers, response.data];
      draft.supplierId = response.data.id;
      draft.supplierName = response.data.name;
      draft.supplierGstin = response.data.gstin || '';
      this.saving = false;
      await this.saveHeader();
      this.notice = 'Supplier created and linked';
    } catch (error) { this.error = this.message(error, 'Supplier could not be created'); }
    finally { this.saving = false; }
  }

  productDraft(line: DraftLine) {
    return this.productDrafts[line.id] ??= {
      sku: line.supplierSku || '', category: '', unit: '', packageUnit: '',
      batchTracked: !!(line.batchNumber || line.expiryDate),
    };
  }

  async createAndLinkItem(line: DraftLine) {
    const draft = this.productDraft(line);
    if (!line.rawName.trim() || !draft.sku.trim() || !draft.category.trim() || !draft.unit || !draft.packageUnit) {
      this.error = 'Product name, SKU, category, stock unit and package unit are required'; return;
    }
    this.saving = true; this.error = ''; this.notice = '';
    try {
      const response = await firstValueFrom(this.api.post<ApiEnvelope<Item>>('/inventory', {
        sku: draft.sku.trim().toUpperCase(), name: this.titleCase(line.rawName), category: this.titleCase(draft.category), brand: '',
        unit: draft.unit, packageUnit: draft.packageUnit, unitsPerPackage: Math.max(1, Number(line.conversionFactor || 1)),
        stockQuantity: 0, reorderPoint: 0, unitCostPaise: Number(line.unitCostPaise || 0), hsnCode: line.hsnSac.trim(),
        gstPercent: Number(line.gstPercent || 0), barcode: '', batchTracked: draft.batchTracked,
        dualUseStock: false, active: true,
      }));
      if (!response.data) throw new Error('Inventory item could not be created');
      this.items = [response.data, ...this.items];
      line.inventoryItemId = response.data.id;
      delete this.productDrafts[line.id];
      this.saving = false;
      await this.saveLine(line);
      this.notice = 'Inventory item created and linked';
    } catch (error) { this.error = this.message(error, 'Inventory item could not be created'); }
    finally { this.saving = false; }
  }

  searchItems(query: string) {
    this.itemSearch = query;
    if (this.itemSearchTimer) clearTimeout(this.itemSearchTimer);
    this.itemSearchTimer = setTimeout(() => void this.loadItems(query).catch((error) => {
      this.error = this.message(error, 'Products could not be searched');
    }), 250);
  }

  private async loadItems(query: string) {
    const request = ++this.itemSearchRequest;
    const params = new URLSearchParams({ page: '1', pageSize: '100', withCount: 'false' });
    if (query.trim()) params.set('q', query.trim());
    const rows = await this.get<Item[]>(`/inventory?${params.toString()}`);
    if (request === this.itemSearchRequest) this.items = rows;
  }

  latestExtraction() { return this.selected?.extractions[0]; }
  reviewGates() {
    const detail = this.selected;
    if (!detail) return [];
    return [
      { label: 'Supplier linked', ready: !!detail.draft.supplierId },
      { label: 'Bill header', ready: !!detail.draft.billNumber.trim() && detail.draft.totalPaise > 0 },
      { label: 'Positive lines', ready: !!detail.lines.length && detail.lines.every((line) => line.quantity > 0) },
      { label: 'Products matched', ready: !!detail.lines.length && detail.lines.every((line) => !!line.inventoryItemId) },
    ];
  }
  fieldWarnings(field: string) { return this.selected?.draft.fieldEvidence?.[field]?.warnings ?? []; }
  lineWarnings(line: DraftLine) {
    const evidence = Object.values(line.fieldEvidence || {}).flatMap((value) => value.warnings ?? []);
    return [...new Set([...(line.warnings || []), ...evidence])];
  }
  headerMismatch() {
    const draft = this.selected?.draft;
    return draft ? draft.totalPaise - Math.max(0, draft.subtotalPaise - draft.discountPaise + draft.cgstPaise + draft.sgstPaise + draft.igstPaise) : 0;
  }
  lineExpected(line: DraftLine) {
    const gross = Math.max(0, Math.round(Number(line.quantity || 0) * Number(line.unitCostPaise || 0)));
    const discount = Math.round(gross * Math.max(0, Number(line.discountBps || 0)) / 10000);
    const taxable = Math.max(0, gross - discount);
    const gst = Math.round(taxable * Math.max(0, Number(line.gstPercent || 0)) / 100);
    return { discount, taxable, gst, total: taxable + gst, mismatch: Number(line.totalPaise || 0) - taxable - gst };
  }
  recalculateLine(line: DraftLine) {
    const expected = this.lineExpected(line);
    line.discountPaise = expected.discount;
    line.taxablePaise = expected.taxable;
    if (line.igstPaise > 0) {
      line.igstPaise = expected.gst; line.cgstPaise = 0; line.sgstPaise = 0;
    } else {
      line.cgstPaise = Math.floor(expected.gst / 2); line.sgstPaise = expected.gst - line.cgstPaise; line.igstPaise = 0;
    }
    line.totalPaise = expected.total;
  }
  recalculateQuantity(line: DraftLine) {
    line.quantity = Math.max(0, Math.round(Number(line.purchaseQuantity || 0) * Number(line.conversionFactor || 1)));
    this.recalculateLine(line);
  }

  private async loadPreview(id: string) {
    if (this.previewDraftId === id && this.sourceBlob) return;
    this.clearPreview();
    this.previewLoading = true;
    try {
      const blob = await firstValueFrom(this.api.getBlob(`/purchases/bill-drafts/${id}/source`));
      this.sourceBlob = blob;
      this.previewDraftId = id;
      this.previewMime = blob.type;
      this.previewUrl = URL.createObjectURL(blob);
      this.previewSafeUrl = this.sanitizer.bypassSecurityTrustResourceUrl(this.previewUrl);
    } catch (error) { this.previewError = this.message(error, 'Bill preview could not be loaded'); }
    finally { this.previewLoading = false; }
  }

  downloadSource() {
    if (!this.sourceBlob || !this.selected) return;
    const link = document.createElement('a');
    link.href = this.previewUrl;
    link.download = this.selected.draft.sourceFileName;
    link.click();
  }

  private clearPreview() {
    if (this.previewUrl) URL.revokeObjectURL(this.previewUrl);
    this.previewUrl = ''; this.previewSafeUrl = null; this.previewMime = ''; this.sourceBlob = null;
    this.previewDraftId = ''; this.previewError = ''; this.previewLoading = false;
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
  canConfirm() {
    return this.canEdit() && !!this.selected?.draft.supplierId && !!this.selected?.draft.billNumber.trim()
      && !!this.selected.lines.length && Math.abs(this.headerMismatch()) <= 100
      && this.selected.lines.every((line) => !!line.inventoryItemId && line.quantity > 0 && Math.abs(this.lineExpected(line).mismatch) <= 100);
  }

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
  private titleCase(value: string) { return value.toLowerCase().replace(/(^|\s)\S/g, (letter) => letter.toUpperCase()); }
}

