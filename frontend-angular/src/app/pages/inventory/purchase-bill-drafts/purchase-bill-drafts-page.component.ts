import { LanguageService } from '../../../core/i18n/language.service';

import { Component, inject, OnDestroy, OnInit } from '@angular/core';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { DatePickerComponent } from '../../../shared/date-picker/date-picker.component';
import { ApiEnvelope, ApiService } from '../../../shared/services/api.service';
import { TranslatePipe } from '../../../shared/pipes/translate.pipe';

type Draft = {
  id: string; status: string; workflowMode: 'live_receipt' | 'historical_pilot'; sourceFileName: string; sourceContentType: string; sourceSha256: string; sourceSizeBytes: number;
  migrationSourceFileId?: string; migrationSourceArtifactId?: string; migrationCutoverId?: string;
  supplierId?: string; purchaseOrderId?: string; purchaseReceiptId?: string; supplierName: string;
  supplierGstin: string; supplierPhone: string; supplierEmail: string; supplierAddress: string;
  billContract: BillContract;
  billNumber: string; billDate?: string; subtotalPaise: number; discountPaise: number;
  cgstPaise: number; sgstPaise: number; igstPaise: number; totalPaise: number; confidenceBps: number;
  warnings: string[]; fieldEvidence: Record<string, Evidence>; version: number; reviewDecision: string; reviewReason: string; reviewedBy?: string; reviewedAt?: string; createdAt: string;
};
type Evidence = { confidence_bps?: number; confidenceBps?: number; warnings?: string[]; original_value?: string; transformed_value?: string };
type BillContract = { buyerName?: string; buyerGstin?: string; buyerAddress?: string; consigneeName?: string; consigneeGstin?: string; consigneeAddress?: string; poNumber?: string; challanNumber?: string; paymentTerms?: string; dueDate?: string; receivedDate?: string; currency?: string; documentType?: string; sourcePaymentStatus?: string; sourceStatus?: string; supplierCode?: string; supplierMappingDecision?: string; pageCount?: number; pageNumber?: number; carryForwardPaise?: number; layoutFingerprint?: string; imageQualityScoreBps?: number; qualityWarnings?: string[]; freightPaise?: number; handlingPaise?: number; otherChargesPaise?: number; roundOffPaise?: number };
type ProductContract = { barcode?: string; brand?: string; category?: string; purchaseUnit?: string; stockUnit?: string; manufactureDate?: string; vendorCatalogCode?: string; size?: string; shade?: string; color?: string; mappingDecision?: string; mrpPaise?: number; freeQuantity?: number; acceptedQuantity?: number; damagedQuantity?: number; rejectedQuantity?: number };
type DraftLine = {
  id: string; lineNumber: number; rawName: string; supplierSku: string; inventoryItemId?: string;
  hsnSac: string; purchaseQuantity: number; packSize: number; conversionFactor: number; quantity: number;
  unitCostPaise: number; discountBps: number; discountPaise: number; gstPercent: number; taxablePaise: number;
  cgstPaise: number; sgstPaise: number; igstPaise: number; totalPaise: number; batchNumber: string;
  expiryDate?: string; confidenceBps: number; warnings: string[]; fieldEvidence: Record<string, any>;
  productContract: ProductContract;
};
type Extraction = { id: string; provider: string; modelVersion: string; status: string; errorMessage: string; rawResponse: Record<string, unknown>; createdAt: string };
type Match = { id: string; draftLineId?: string; matchType: string; matchedEntityId: string; scoreBps: number; status: string; evidence: Record<string, unknown>; createdAt: string };
type DraftEvent = { id: string; eventType: string; actorUserId: string; details: Record<string, unknown>; createdAt: string };
type Details = { draft: Draft; lines: DraftLine[]; extractions: Extraction[]; matches: Match[]; events: DraftEvent[]; readyToConfirm: boolean; blockingIssues: string[] };
type Supplier = { id: string; name: string; gstin: string; phone: string; email: string; address: string; active: boolean };
type Item = { id: string; name: string; sku: string; unit: string; category?: string; brand?: string; barcode?: string; hsnCode?: string; active: boolean };
type Order = { id: string; orderNumber: string; supplierId: string; supplierName: string; status: string };
type ProductDraft = { sku: string; category: string; brand: string; barcode: string; unit: string; packageUnit: string; batchTracked: boolean };

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
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
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
  reviewReason = '';
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
  readonly productForms: Record<string, boolean> = {};
  readonly expandedLines = new Set<string>();
  readonly reviewId = this.route.snapshot.paramMap.get('id') || '';

  async ngOnInit() { await this.reload(); }
  ngOnDestroy() { this.clearPreview(); if (this.itemSearchTimer) clearTimeout(this.itemSearchTimer); }

  async reload(preserve = true) {
    if (this.reviewId) {
      this.loading = true;
      this.error = '';
      try { await Promise.all([this.open(this.reviewId), this.loadReferences()]); }
      finally { this.loading = false; }
      return;
    }
    const selectedId = preserve ? this.selected?.draft.id : undefined;
    this.loading = true;
    this.error = '';
    try {
      const params = new URLSearchParams({ workflowMode: 'live_receipt' });
      if (this.status) params.set('status', this.status);
      this.drafts = await this.get<Draft[]>(`/purchases/bill-drafts?${params.toString()}`);
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
      this.notice = this.language.text('inventory.message.3a64387121');
      await this.router.navigate(['/purchase-bill-drafts', response.data.draft.id]);
    } catch (error) { this.error = this.message(error, this.language.text('inventory.message.cf48ce5b00')); }
    finally { this.uploading = false; }
  }

  async open(id: string) {
    try {
      this.selected = await this.get<Details>(`/purchases/bill-drafts/${id}`);
      this.mergeCandidateItems(this.selected);
      await this.loadPreview(id);
    }
    catch (error) { this.error = this.message(error, this.language.text('inventory.message.4c63337c0d')); }
  }

  openReview(id: string) { void this.router.navigate(['/purchase-bill-drafts', id]); }
  backToDrafts() { void this.router.navigate(['/purchase-bill-drafts']); }
  close() { this.backToDrafts(); }
  lineExpanded(id: string) { return this.expandedLines.has(id); }
  toggleLine(id: string) { this.expandedLines.has(id) ? this.expandedLines.delete(id) : this.expandedLines.add(id); }

  async saveHeader() {
    if (!this.selected) return;
    const draft = this.selected.draft;
    await this.mutate(this.api.patch<ApiEnvelope<Details>>(`/purchases/bill-drafts/${draft.id}`, {
      supplierId: draft.supplierId || null, purchaseOrderId: draft.purchaseOrderId || null,
      supplierName: draft.supplierName, supplierGstin: draft.supplierGstin, billNumber: draft.billNumber,
      supplierPhone: draft.supplierPhone, supplierEmail: draft.supplierEmail, supplierAddress: draft.supplierAddress,
      billContract: draft.billContract,
      billDate: draft.billDate || null, subtotalPaise: draft.subtotalPaise, discountPaise: draft.discountPaise,
      cgstPaise: draft.cgstPaise, sgstPaise: draft.sgstPaise, igstPaise: draft.igstPaise,
      totalPaise: draft.totalPaise, correctionReason: this.reviewReason,
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
    if (supplier) {
      this.selected.draft.billContract.supplierMappingDecision = 'link';
      Object.assign(this.selected.draft, {
        supplierName: supplier.name, supplierGstin: supplier.gstin || '', supplierPhone: supplier.phone || '',
        supplierEmail: supplier.email || '', supplierAddress: supplier.address || '',
      });
    }
  }

  async createSupplier() {
    const draft = this.selected?.draft;
    if (!draft?.supplierName.trim()) { this.error = 'Supplier name is required'; return; }
    await this.mutate(this.api.post<ApiEnvelope<Details>>(`/purchases/bill-drafts/${draft.id}/supplier`, {
      name: this.titleCase(draft.supplierName), gstin: draft.supplierGstin.trim().toUpperCase(),
      phone: draft.supplierPhone, email: draft.supplierEmail, address: draft.supplierAddress,
    }), 'Supplier created or matched and linked');
  }

  async reviewPilot(decision: 'approved' | 'quarantined' | 'rejected') {
    if (!this.selected || !this.reviewReason.trim()) {
      this.error = 'Review or correction reason is required';
      return;
    }
    await this.mutate(this.api.post<ApiEnvelope<Details>>(
      `/purchases/bill-drafts/${this.selected.draft.id}/pilot-review`,
      { decision, reason: this.reviewReason.trim() },
    ), `Historical pilot ${decision}`);
  }
  async retryExtraction() {
    if (!this.selected) return;
    await this.mutate(this.api.post<ApiEnvelope<Details>>(`/purchases/bill-drafts/${this.selected.draft.id}/retry-extraction`, {}), 'Extraction retried');
  }

  productDraft(line: DraftLine) {
    const product = { ...(line.fieldEvidence?.['_product'] ?? {}), ...(line.productContract || {}) };
    return this.productDrafts[line.id] ??= {
      sku: line.supplierSku || '', category: product.category || '', brand: product.brand || '',
      barcode: product.barcode || '', unit: String(product.stockUnit || product.unit || '').toLowerCase(),
      packageUnit: String(product.purchaseUnit || product.packageUnit || '').toLowerCase(),
      batchTracked: !!(line.batchNumber || line.expiryDate),
    };
  }

  candidateMatches(line: DraftLine) {
    return (this.selected?.matches || [])
      .filter((match) => match.matchType === 'inventory_item' && match.draftLineId === line.id && !!match.evidence?.['name'])
      .sort((a, b) => b.scoreBps - a.scoreBps)
      .slice(0, 3);
  }
  matchEvidence(match: Match, key: string) { return String(match.evidence?.[key] || ''); }

  async applyCandidate(line: DraftLine, match: Match) {
    line.inventoryItemId = match.matchedEntityId;
    await this.saveLine(line);
  }

  chooseNewProduct(line: DraftLine) { this.productForms[line.id] = true; }

  async createAndLinkItem(line: DraftLine) {
    const draft = this.productDraft(line);
    if (!line.rawName.trim() || !draft.sku.trim() || !draft.category.trim() || !draft.unit || !draft.packageUnit) {
      this.error = 'Product name, SKU, category, stock unit and package unit are required'; return;
    }
    this.saving = true; this.error = ''; this.notice = '';
    try {
      const response = await firstValueFrom(this.api.post<ApiEnvelope<Details>>(`/purchases/bill-drafts/${this.selected!.draft.id}/lines/${line.id}/product`, {
        sku: draft.sku.trim().toUpperCase(), name: this.titleCase(line.rawName), category: this.titleCase(draft.category), brand: this.titleCase(draft.brand),
        unit: draft.unit, packageUnit: draft.packageUnit, unitsPerPackage: Math.max(1, Number(line.conversionFactor || 1)),
        unitCostPaise: Number(line.unitCostPaise || 0), hsnCode: line.hsnSac.trim(),
        gstPercent: Number(line.gstPercent || 0), barcode: draft.barcode.trim(), batchTracked: draft.batchTracked,
      }));
      if (!response.data) throw new Error('Inventory item could not be created');
      this.selected = response.data;
      delete this.productDrafts[line.id];
      delete this.productForms[line.id];
      await this.reload();
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
    if (request === this.itemSearchRequest) {
      const retainedIds = new Set([
        ...(this.selected?.lines.map((line) => line.inventoryItemId).filter(Boolean) || []),
        ...(this.selected?.matches.filter((match) => match.matchType === 'inventory_item').map((match) => match.matchedEntityId) || []),
      ]);
      this.items = [...this.items.filter((item) => retainedIds.has(item.id) && !rows.some((row) => row.id === item.id)), ...rows];
    }
  }

  latestExtraction() { return this.selected?.extractions[0]; }
  partyRoleWarning() {
    const draft=this.selected?.draft; if(!draft) return '';
    const supplier=draft.supplierName.trim().toLocaleLowerCase();
    const buyer=(draft.billContract?.buyerName || '').trim().toLocaleLowerCase();
    const consignee=(draft.billContract?.consigneeName || '').trim().toLocaleLowerCase();
    return supplier && (supplier === buyer || supplier === consignee) ? 'Vendor matches buyer/consignee. Verify party roles before linking supplier.' : '';
  }
  reviewGates() {
    const detail = this.selected;
    if (!detail) return [];
    const historical = detail.draft.workflowMode === 'historical_pilot';
    return [
      { label: 'Supplier', ready: !!detail.draft.supplierId || (historical && detail.draft.billContract.supplierMappingDecision === 'keep_historical_only') },
      { label: 'Lines', ready: !!detail.lines.length && detail.lines.every((line) => line.quantity > 0 && (!!line.inventoryItemId || (historical && line.productContract.mappingDecision === 'keep_historical_only'))) },
      { label: 'Tax', ready: !!detail.lines.length && detail.lines.every((line) => Math.abs(this.lineExpected(line).mismatch) <= 100) },
      { label: 'Total', ready: !!detail.draft.billNumber.trim() && detail.draft.totalPaise > 0 && Math.abs(this.headerMismatch()) <= 100 },
    ];
  }
  fieldWarnings(field: string) { return this.selected?.draft.fieldEvidence?.[field]?.warnings ?? []; }
  fieldEvidenceEntries() {
    return Object.entries(this.selected?.draft.fieldEvidence || {}).map(([field, evidence]) => ({
      field, original: evidence.original_value || '—', transformed: evidence.transformed_value || '—',
      confidence: this.confidence(Number(evidence.confidence_bps ?? evidence.confidenceBps ?? 0)),
    }));
  }
  lineEvidenceEntries(line: DraftLine) {
    return Object.entries(line.fieldEvidence || {}).filter(([, evidence]: [string, any]) => evidence?.original_value !== undefined || evidence?.transformed_value !== undefined).map(([field, evidence]: [string, any]) => ({
      field, original: evidence.original_value || '—', transformed: evidence.transformed_value || '—',
    }));
  }
  lineWarnings(line: DraftLine) {
    const evidence = Object.values(line.fieldEvidence || {}).flatMap((value: any) => value?.warnings ?? []);
    return [...new Set([...(line.warnings || []), ...evidence])];
  }
  headerMismatch() {
    const draft = this.selected?.draft;
    const contract = draft?.billContract || {};
    return draft ? draft.totalPaise - (draft.subtotalPaise - draft.discountPaise + draft.cgstPaise + draft.sgstPaise + draft.igstPaise + Number(contract.freightPaise || 0) + Number(contract.handlingPaise || 0) + Number(contract.otherChargesPaise || 0) + Number(contract.roundOffPaise || 0)) : 0;
  }
  lineExpected(line: DraftLine) {
    const gross = Math.max(0, Math.round(Number(line.purchaseQuantity || 0) * Number(line.unitCostPaise || 0)));
    const discount = Math.round(gross * Math.max(0, Number(line.discountBps || 0)) / 10000);
    const taxable = Math.max(0, gross - discount);
    const gst = Math.round(taxable * Math.max(0, Number(line.gstPercent || 0)) / 100);
    return { discount, taxable, gst, total: taxable + gst, mismatch: Number(line.totalPaise || 0) - taxable - gst };
  }
  netRatePaise(line: DraftLine) { return line.purchaseQuantity > 0 ? Math.round(this.lineExpected(line).taxable / line.purchaseQuantity) : 0; }
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
  quantity(value: number) { return Number(value || 0).toLocaleString('en-IN', { minimumFractionDigits: 3, maximumFractionDigits: 3 }); }
  rupees(paise: number) { return Number(paise || 0) / 100; }
  paise(value: unknown) { return Math.max(0, Math.round(Number(value || 0) * 100)); }
  signedPaise(value: unknown) { return Math.round(Number(value || 0) * 100); }
  confidence(bps: number) { return `${Math.round(Number(bps || 0) / 100)}%`; }
  date(value?: string) { if (!value) return '—'; const iso = value.slice(0, 10).split('-'); return iso.length === 3 ? `${iso[2]}/${iso[1]}/${iso[0]}` : value; }
  lineDisplayName(line: DraftLine) { return line.inventoryItemId ? this.items.find((row) => row.id === line.inventoryItemId)?.name || line.rawName : line.rawName || 'Unnamed product'; }
  unitLabel(value: string) { return value ? value.charAt(0).toUpperCase() + value.slice(1).toLowerCase() : '—'; }
  taxLabel(line: DraftLine) { const rate = Number(line.gstPercent || 0); return line.igstPaise > 0 ? `${rate}% IGST` : `${rate}% (${rate / 2}% CGST, ${rate / 2}% SGST)`; }
  itemLabel(id?: string) { const item = this.items.find((row) => row.id === id); return item ? `${item.name} · ${item.sku || 'No SKU'}` : 'Unmatched'; }
  orderLabel(id?: string) { const order = this.orders.find((row) => row.id === id); return order ? `${order.orderNumber} · ${order.supplierName}` : 'No PO'; }
  isHistoricalPilot() { return this.selected?.draft.workflowMode === 'historical_pilot'; }
  canEdit() { return !!this.selected && ['review', 'extraction_failed'].includes(this.selected.draft.status); }
  canConfirm() { return this.canEdit() && !!this.selected?.readyToConfirm; }

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
      productContract: line.productContract || {}, correctionReason: this.reviewReason,
    };
  }

  private blankLine(): DraftLine {
    return {
      id: '', lineNumber: (this.selected?.lines.length || 0) + 1, rawName: '', supplierSku: '', hsnSac: '',
      purchaseQuantity: 1, packSize: 1, conversionFactor: 1, quantity: 1, unitCostPaise: 0,
      discountBps: 0, discountPaise: 0, gstPercent: 0, taxablePaise: 0, cgstPaise: 0,
      sgstPaise: 0, igstPaise: 0, totalPaise: 0, batchNumber: '', confidenceBps: 0,
      warnings: [], fieldEvidence: {}, productContract: {},
    };
  }

  private mergeCandidateItems(detail: Details) {
    for (const match of detail.matches.filter((row) => row.matchType === 'inventory_item' && !!row.evidence?.['name'])) {
      if (!this.items.some((item) => item.id === match.matchedEntityId)) {
        this.items.push({
          id: match.matchedEntityId, name: String(match.evidence['name']), sku: String(match.evidence['sku'] || ''),
          unit: '', category: String(match.evidence['category'] || ''), brand: String(match.evidence['brand'] || ''),
          barcode: String(match.evidence['barcode'] || ''), hsnCode: String(match.evidence['hsnCode'] || ''), active: true,
        });
      }
    }
  }

  private async mutate(request: ReturnType<ApiService['post']>, notice: string) {
    this.saving = true; this.error = ''; this.notice = '';
    try {
      const response = await firstValueFrom(request as any) as ApiEnvelope<Details>;
      if (!response.data) throw new Error('API response did not contain data');
      this.selected = response.data;
      this.notice = notice;
      this.reviewReason = '';
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

