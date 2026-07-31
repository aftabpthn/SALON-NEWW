import { CommonModule } from '@angular/common';
import { Component, OnDestroy, OnInit, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { AuthService } from '../../../core/services/auth.service';
import { DatePickerComponent } from '../../../shared/date-picker/date-picker.component';
import { ApiEnvelope, ApiService } from '../../../shared/services/api.service';
import { DataMigrationStore, HistoricalEvidenceReport, HistoricalPurchaseBill, MigrationCutover } from '../data-migration.store';

type Tab = 'evidence' | 'pilot' | 'bulk' | 'bills' | 'products' | 'vendors' | 'unmapped' | 'reconciliation';
type MappingKind = 'product' | 'vendor';
type MappingCandidate = { targetId: string; name: string; confidencePercentage: number; governance: 'green' | 'yellow' | 'red'; sku?: string; code?: string; warnings?: Record<string, string>; signals?: Record<string, boolean> };
type MappingSource = { identityType: MappingKind; provider: string; sourceKey: string; source: Record<string, unknown>; sourceDrift: boolean; currentMapping?: { id: string; version: number; decision: string; targetId?: string; sourceDrift?: boolean }; candidates: MappingCandidate[] };
type MappingReport = { status: string; historicalProducts: number; linkedProducts: number; createdProducts: number; historicalOnlyProducts: number; rejectedProducts: number; pendingProducts: number; historicalVendors: number; linkedVendors: number; createdVendors: number; historicalOnlyVendors: number; rejectedVendors: number; pendingVendors: number; driftedMappings: number; traceableSources: number; stockEffectPaise: number; accountingEffectPaise: number; gstEffectPaise: number; payableEffectPaise: number };
type MappingVersion = { version: number; decision: string; targetId?: string; source: Record<string, unknown>; evidence: Record<string, unknown>; warnings: unknown[]; reason: string; approvedBy: string; approvedAt: string; rollbackOfVersion?: number };
type MappingCreateForm = { name: string; code: string; sku: string; barcode: string; brand: string; category: string; unit: string; packageUnit: string; unitsPerPackage: string; gstin: string; phone: string; email: string; address: string };
type MappingDrawer = { mode: 'create' | 'history'; row: MappingSource; versions: MappingVersion[]; loading: boolean };
type BillFile = { id: string; sourceFileId: string; originalFileName: string; mediaType: string; sha256: string; createdAt: string };
type BillLine = { id: string; originalProductName: string; sku: string; barcode: string; mappedInventoryItemId?: string; mappedProductName?: string; purchasedQuantity: number; stockUnit: string; unitCostPaise: number; taxPaise: number; totalPaise: number; batchNumber: string; expiryDate?: string; sourceSheet: string; sourceRowNumber: number };
type BillDetail = HistoricalPurchaseBill & { supplierExternalId: string; supplierCode: string; supplierPhone: string; supplierEmail: string; cgstPaise: number; sgstPaise: number; igstPaise: number; discountPaise: number; shippingPaise: number; handlingPaise: number; importJobId: string; files: BillFile[]; lines: BillLine[] };
type PilotDocument = { draftId: string; sourceFileId: string; sourceArtifactId?: string; fileName: string; status: string; reviewDecision: string; confidenceBps: number; billNumber: string; supplierName: string; lineCount: number; blockingIssues: string[]; sha256: string };
type PilotMetric = { matched: number; checked: number; accuracyBps?: number; thresholdBps: number; accepted?: boolean };
type PilotGrouping = { supplierBatch: string; groupKey: string; detectedPageCount: number; approvedPageCount?: number; confidenceBps: number; confidenceLevel: 'green' | 'yellow' | 'red'; status: 'auto_grouped' | 'suggested' | 'blocked' | 'approved' | 'rejected'; signals: string[]; documentIds: string[]; fileNames: string[]; decidedBy?: string; decidedAt?: string };
type PilotReport = { cutoverId: string; documents: PilotDocument[]; summary: { uploadedDocuments: number; recognizedBills: number; totalPages: number; extractedProductLines: number; failedOrQuarantinedDocuments: number; duplicateFilesOrBills: number; duplicateArchiveCommits: number; silentSkippedDocuments: number; mappedSuppliers: number; unmappedSuppliers: number; mappedProducts: number; unmappedProducts: number; manualCorrections: number; averageConfidenceBps?: number; financiallyReconciledDocuments: number; groupedBills: number; groupingApprovalRequired: number; groupingBlocked: number; stockEffectPaise: number; accountingEffectPaise: number; gstEffectPaise: number }; accuracy: { supplier: PilotMetric; invoiceNumberAndDate: PilotMetric; financial: PilotMetric; productLineDetection: PilotMetric; quantityRateAndTax: PilotMetric; batchAndExpiry: PilotMetric; supplierMapping: PilotMetric; productMapping: PilotMetric }; grouping: { suggestions: PilotGrouping[]; acceptanceRule: string } };
type PilotCandidate = { key: string; sourceFileId: string; sourceArtifactId?: string; fileName: string; supplierBatch: string; pageCount: number; sha256: string };
type BulkItem = { id: string; draftId: string; sourceFileId: string; sourceArtifactId?: string; fileName: string; sha256: string; status: string; pageCount: number; attempts: number; retryEligible: boolean; errorCode: string; errorMessage: string; suggestedCorrection: string; supplierName: string; invoiceNumber: string; invoiceDate?: string; totalPaise: number; confidenceBps: number; reviewDecision: string; archivedBillId?: string; duplicateOfBillId?: string; heartbeatAt?: string };
type BulkSummary = { uploaded: number; profiling: number; extracting: number; reviewRequired: number; ready: number; archived: number; duplicates: number; quarantined: number; failed: number; dependencyPending: number; rejected: number; cancelled: number; accounted: number; totalDocuments: number; totalPages: number; sourceTotalPaise: number; archiveTotalPaise: number; stockEffectPaise: number; accountingEffectPaise: number; gstEffectPaise: number; payableEffectPaise: number };
type BulkBatch = { jobId: string; cutoverId: string; supplierBatch: string; provider: string; postingMode: string; expectedBillCount: number; expectedTotalPaise?: number; mappingVersion: number; transformerVersion: string; workerLimit: number; jobStatus: string; heartbeatAt?: string; lastError: string; partialApproval: boolean; summary: BulkSummary; items: BulkItem[] };
type BulkReport = { cutoverId: string; batches: BulkBatch[]; stockEffectPaise: number; accountingEffectPaise: number; gstEffectPaise: number; payableEffectPaise: number };

@Component({ selector: 'app-old-purchase-bills-page', imports: [CommonModule, FormsModule, RouterLink, DatePickerComponent], templateUrl: './old-purchase-bills-page.component.html', styleUrls: ['./old-purchase-bills-page.component.css'] })
export class OldPurchaseBillsPageComponent implements OnInit, OnDestroy {
  private readonly api = inject(ApiService);
  private readonly auth = inject(AuthService);
  private readonly migration = inject(DataMigrationStore);
  activeTab: Tab = 'evidence'; bills: HistoricalPurchaseBill[] = []; products: MappingSource[] = []; vendors: MappingSource[] = []; mappingReport: MappingReport | null = null; cutover: MigrationCutover | null = null; evidence: HistoricalEvidenceReport | null = null; pilot: PilotReport | null = null; bulk: BulkReport | null = null;
  selectedBill: BillDetail | null = null; loading = true; drawerLoading = false; busy = false; error = '';
  search = ''; provider = ''; vendor = ''; fromDate = ''; toDate = ''; mappingStatus = '';
  evidenceKind: 'historical_bill' | 'physical_inventory' | 'supplier_outstanding' = 'historical_bill'; supplierBatch = ''; evidenceRetentionDays = 3650; uploadProgress = 0; uploadStatus = '';
  readonly pilotSelection = new Set<string>();
  bulkSourceFileId = ''; bulkSupplierBatch = ''; bulkProvider = 'auto'; bulkExpectedBillCount: number | null = null; bulkExpectedTotalRupees = ''; bulkMappingVersion: number | null = null; bulkWorkerLimit = 4; bulkApprovalReason = ''; bulkAllowPartial = false; bulkAllowLiveCollisions = false;
  mappingReasons: Record<string, string> = {}; mappingTargets: Record<string, string> = {}; mappingDrawer: MappingDrawer | null = null; mappingCreate: MappingCreateForm = this.emptyMappingCreate(); bulkMappingReason = '';
  readonly unitApprovals = new Set<string>(); readonly driftApprovals = new Set<string>(); readonly bulkMappingSelection = new Set<string>();
  private bulkReloadTimer?: ReturnType<typeof setInterval>;

  get canManage() { return this.auth.hasRole('owner', 'admin', 'manager', 'superadmin', 'super-admin') || this.auth.hasPermission('data_migration.manage'); }
  get canExport() { return this.auth.hasRole('owner', 'admin', 'manager', 'superadmin', 'super-admin') || this.auth.hasPermission('data_migration.export'); }
  get canApproveCutover() { return this.auth.hasRole('owner', 'superadmin', 'super-admin'); }
  get canApproveBulk() { return this.canApproveCutover; }
  get canCreateProduct() { return this.auth.hasRole('owner', 'admin', 'superadmin', 'super-admin') || this.auth.hasPermission('inventory.manage') || this.auth.hasPermission('inventory.write'); }
  get canCreateVendor() { return this.auth.hasRole('owner', 'admin', 'superadmin', 'super-admin') || this.auth.hasPermission('purchases.manage') || this.auth.hasPermission('inventory.manage'); }
  get bulkSources() { return (this.evidence?.files || []).filter((file) => file.kind === 'historical_bill'); }
  get bulkActiveCount() { return (this.bulk?.batches || []).filter((batch) => ['queued', 'processing', 'paused'].includes(batch.jobStatus)).length; }
  get providers() { return [...new Set(this.bills.map((bill) => bill.provider).filter(Boolean))].sort(); }
  get vendorNames() { return [...new Set(this.bills.map((bill) => bill.supplierName).filter(Boolean))].sort(); }
  get filteredBills() { const q = this.search.trim().toLowerCase(); return this.bills.filter((bill) => { const text = [bill.invoiceNumber, bill.supplierName, bill.externalBillId, bill.sourceFileName].some((value) => value?.toLowerCase().includes(q)); const status = bill.unmappedProductCount ? 'unmapped' : 'mapped'; return (!q || text) && (!this.provider || bill.provider === this.provider) && (!this.vendor || bill.supplierName === this.vendor) && (!this.fromDate || bill.invoiceDate >= this.fromDate) && (!this.toDate || bill.invoiceDate <= this.toDate) && (!this.mappingStatus || status === this.mappingStatus); }); }
  get unmappedProducts() { return this.products.filter((row) => !row.currentMapping || row.currentMapping.decision === 'reject'); }
  get reconciliation() { return this.cutover?.reconciliation; }
  get pilotCandidates(): PilotCandidate[] {
    return (this.evidence?.files || []).filter((file) => file.kind === 'historical_bill').flatMap((file) =>
      file.format === 'zip'
        ? (file.artifacts || []).filter((artifact) => ['pdf', 'png', 'jpeg', 'webp'].includes(artifact.format)).map((artifact) => ({ key: `${file.sourceFileId}:${artifact.id}`, sourceFileId: file.sourceFileId, sourceArtifactId: artifact.id, fileName: artifact.entryName, supplierBatch: file.supplierBatch, pageCount: artifact.pageCount, sha256: artifact.sha256 }))
        : [{ key: file.sourceFileId, sourceFileId: file.sourceFileId, fileName: file.originalFileName, supplierBatch: file.supplierBatch, pageCount: file.pageCount, sha256: file.sha256 }],
    );
  }

  async ngOnInit() { await this.reload(); this.bulkReloadTimer = setInterval(() => { if (this.activeTab === 'bulk' && this.bulkActiveCount) void this.reloadBulk(); }, 5000); }
  ngOnDestroy() { if (this.bulkReloadTimer) clearInterval(this.bulkReloadTimer); }
  async reload() {
    this.loading = true; this.error = '';
    try {
      const [bills, products, vendors, mappingReport, cutover] = await Promise.all([
        firstValueFrom(this.api.get<ApiEnvelope<HistoricalPurchaseBill[]>>('/settings/integrations/historical-purchase-bills')),
        firstValueFrom(this.api.get<ApiEnvelope<MappingSource[]>>('/settings/integrations/historical-purchase-mappings/product')),
        firstValueFrom(this.api.get<ApiEnvelope<MappingSource[]>>('/settings/integrations/historical-purchase-mappings/vendor')),
        firstValueFrom(this.api.get<ApiEnvelope<MappingReport>>('/settings/integrations/historical-purchase-mapping-report')),
        firstValueFrom(this.api.get<ApiEnvelope<MigrationCutover | null>>('/settings/integrations/migration-cutovers/active')),
      ]);
      this.bills = bills.data || []; this.products = products.data || []; this.vendors = vendors.data || []; this.mappingReport = mappingReport.data || null; this.cutover = cutover.data || null;
      if (this.cutover) {
        const cutoverId = encodeURIComponent(this.cutover.id);
        const [evidence, pilot, bulk] = await Promise.all([
          firstValueFrom(this.api.get<ApiEnvelope<HistoricalEvidenceReport>>(`/settings/integrations/historical-purchase-evidence?cutoverId=${cutoverId}`)),
          firstValueFrom(this.api.get<ApiEnvelope<PilotReport>>(`/settings/integrations/historical-purchase-pilot?cutoverId=${cutoverId}`)),
          firstValueFrom(this.api.get<ApiEnvelope<BulkReport>>(`/settings/integrations/historical-purchase-bulk?cutoverId=${cutoverId}`)),
        ]);
        this.evidence = evidence.data || null; this.pilot = pilot.data || null; this.bulk = bulk.data || null;
      } else { this.evidence = null; this.pilot = null; this.bulk = null; }
    } catch (error) { this.error = this.message(error, 'Historical purchase archive could not be loaded'); }
    finally { this.loading = false; }
  }

  setTab(tab: Tab) { this.activeTab = tab; this.selectedBill = null; }
  clearFilters() { this.search = ''; this.provider = ''; this.vendor = ''; this.fromDate = ''; this.toDate = ''; this.mappingStatus = ''; }
  async uploadEvidence(event: Event) {
    const input = event.target as HTMLInputElement; const files = [...(input.files || [])]; input.value = '';
    if (!this.cutover || !files.length || (this.evidenceKind === 'historical_bill' && !this.supplierBatch.trim())) { this.error = this.cutover ? 'Supplier batch is required for historical bills' : 'Create a branch cutover first'; return; }
    await this.run(async () => {
      for (const file of files) {
        this.uploadStatus = `Uploading ${file.name}`; this.uploadProgress = 0;
        await this.migration.uploadSourceFile(file, { provider: 'auto', retentionDays: this.evidenceRetentionDays, evidenceKind: this.evidenceKind, supplierBatch: this.evidenceKind === 'historical_bill' ? this.supplierBatch.trim() : '', cutoverId: this.cutover!.id }, (progress) => this.uploadProgress = progress);
      }
      this.uploadStatus = 'Evidence verified'; await this.reload();
    }, 'Evidence upload could not be completed');
  }
  async decideGroup(group: HistoricalEvidenceReport['groups'][number], decision: 'approved' | 'rejected') { if (!this.canManage || !this.cutover) return; const approvedPageCount = Number(group.approvedPageCount || group.detectedPageCount); if (approvedPageCount <= 0) { this.error = 'Enter the verified page count before approval'; return; } await this.run(async () => { await firstValueFrom(this.api.post('/settings/integrations/historical-purchase-evidence/group-decisions', { cutoverId: this.cutover!.id, supplierBatch: group.supplierBatch, groupKey: group.groupKey, decision, approvedPageCount })); await this.reload(); }, 'Grouping decision could not be saved'); }
  async approveCutover() { if (!this.canApproveCutover || !this.cutover) return; await this.run(async () => { await firstValueFrom(this.api.post('/settings/integrations/historical-purchase-evidence/cutover-approval', { cutoverId: this.cutover!.id })); await this.reload(); }, 'Owner cutover approval could not be saved'); }
  pilotSelected(candidate: PilotCandidate) { return this.pilotSelection.has(candidate.key); }
  togglePilot(candidate: PilotCandidate, selected: boolean) { selected ? this.pilotSelection.add(candidate.key) : this.pilotSelection.delete(candidate.key); }
  async startPilot() {
    if (!this.canManage || !this.cutover || this.pilotSelection.size < 20 || this.pilotSelection.size > 50) { this.error = 'Select 20 to 50 approved historical bill documents'; return; }
    const selected = this.pilotCandidates.filter((candidate) => this.pilotSelection.has(candidate.key));
    await this.run(async () => {
      await firstValueFrom(this.api.post('/settings/integrations/historical-purchase-pilot', {
        cutoverId: this.cutover!.id,
        documents: selected.map(({ sourceFileId, sourceArtifactId }) => ({ sourceFileId, sourceArtifactId: sourceArtifactId || null })),
      }));
      this.pilotSelection.clear(); this.activeTab = 'pilot'; await this.reload();
    }, 'Historical purchase pilot could not be started');
  }
  async decidePilotGroup(group: PilotGrouping, decision: 'approved' | 'rejected') {
    if (!this.canManage || !this.cutover) return;
    await this.run(async () => {
      await firstValueFrom(this.api.post('/settings/integrations/historical-purchase-pilot/group-decisions', {
        cutoverId: this.cutover!.id, supplierBatch: group.supplierBatch, groupKey: group.groupKey,
        decision, approvedPageCount: group.detectedPageCount,
      }));
      await this.reload();
    }, 'Pilot grouping decision could not be saved');
  }
  selectBulkSource() {
    const source = this.bulkSources.find((file) => file.sourceFileId === this.bulkSourceFileId);
    if (!source) return;
    this.bulkSupplierBatch = source.supplierBatch || '';
    this.bulkExpectedBillCount = source.format === 'zip'
      ? (source.artifacts || []).filter((artifact) => ['pdf', 'png', 'jpeg', 'webp'].includes(artifact.format)).length
      : 1;
  }
  async startBulk() {
    if (!this.canManage || !this.cutover || !this.bulkSourceFileId || !this.bulkSupplierBatch.trim() || !this.bulkExpectedBillCount || !this.bulkMappingVersion) {
      this.error = 'Evidence batch, supplier, expected bill count and mapping version are required'; return;
    }
    let expectedTotalPaise: number | null = null;
    if (this.bulkExpectedTotalRupees.trim()) {
      expectedTotalPaise = this.parsePaise(this.bulkExpectedTotalRupees);
      if (expectedTotalPaise == null) { this.error = 'Expected total must be a valid rupee amount'; return; }
    }
    await this.run(async () => {
      await firstValueFrom(this.api.post('/settings/integrations/historical-purchase-bulk', {
        cutoverId: this.cutover!.id, sourceFileId: this.bulkSourceFileId,
        supplierBatch: this.bulkSupplierBatch.trim(), provider: this.bulkProvider,
        expectedBillCount: this.bulkExpectedBillCount, expectedTotalPaise,
        mappingVersion: this.bulkMappingVersion, workerLimit: this.bulkWorkerLimit,
      }));
      this.activeTab = 'bulk'; this.bulkSourceFileId = ''; this.bulkSupplierBatch = '';
      this.bulkExpectedBillCount = null; this.bulkExpectedTotalRupees = ''; await this.reload();
    }, 'Historical purchase bulk batch could not be started');
  }
  async reloadBulk() {
    if (!this.cutover || this.busy) return;
    try {
      const result = await firstValueFrom(this.api.get<ApiEnvelope<BulkReport>>(`/settings/integrations/historical-purchase-bulk?cutoverId=${encodeURIComponent(this.cutover.id)}`));
      this.bulk = result.data || null;
    } catch (error) { this.error = this.message(error, 'Bulk progress could not be reloaded'); }
  }
  async controlBulk(batch: BulkBatch, action: 'pause' | 'resume' | 'cancel') {
    if (!this.canManage || (action === 'cancel' && !confirm(`Cancel ${batch.supplierBatch}?`))) return;
    await this.run(async () => {
      await firstValueFrom(this.api.post(`/settings/integrations/import-jobs/${batch.jobId}/${action}`, {}));
      await this.reloadBulk();
    }, `Bulk batch could not be ${action}d`);
  }
  async archiveBulk(batch: BulkBatch) {
    if (!this.canApproveBulk || !confirm(`Archive ready documents in ${batch.supplierBatch}?`)) return;
    await this.run(async () => {
      await firstValueFrom(this.api.post(`/settings/integrations/historical-purchase-bulk/${batch.jobId}/archive`, {
        allowPartial: this.bulkAllowPartial, allowLiveCollisions: this.bulkAllowLiveCollisions,
        reason: this.bulkApprovalReason.trim(),
      }));
      this.bulkApprovalReason = ''; this.bulkAllowPartial = false; this.bulkAllowLiveCollisions = false;
      await this.reload();
    }, 'Bulk archive approval failed');
  }
  async openBill(bill: HistoricalPurchaseBill) { this.drawerLoading = true; this.error = ''; this.selectedBill = null; try { const result = await firstValueFrom(this.api.get<ApiEnvelope<BillDetail>>(`/settings/integrations/historical-purchase-bills/${bill.id}`)); this.selectedBill = result.data || null; } catch (error) { this.error = this.message(error, 'Historical bill detail could not be loaded'); } finally { this.drawerLoading = false; } }
  async downloadEvidence(file: BillFile | { sourceFileId: string; originalFileName?: string }) { if (!this.canExport || !file.sourceFileId) return; await this.run(async () => this.downloadBlob(await firstValueFrom(this.api.getBlob(`/settings/integrations/import-source-files/${file.sourceFileId}/evidence`)), file.originalFileName || 'historical-purchase-evidence'), 'Evidence could not be downloaded'); }
  exportBills() { if (!this.canExport) return; const rows = [['Invoice', 'Vendor', 'Invoice date', 'Provider', 'Tax paise', 'Total paise', 'Lines', 'Unmapped products', 'Source checksum'], ...this.filteredBills.map((bill) => [bill.invoiceNumber, bill.supplierName, bill.invoiceDate, bill.provider, bill.taxPaise, bill.totalPaise, bill.lineCount, bill.unmappedProductCount, bill.sourceChecksum])]; this.download(rows.map((row) => row.map((value) => this.csv(value)).join(',')).join('\r\n'), `old-purchase-bills-${new Date().toISOString().slice(0, 10)}.csv`, 'text/csv'); }
  exportEvidenceIndex() { if (!this.canExport) return; this.download(JSON.stringify({ generatedAt: new Date().toISOString(), stockEffect: 0, accountingEffect: 0, bills: this.filteredBills.map((bill) => ({ id: bill.id, sourceFileId: bill.sourceFileId, sourceFileName: bill.sourceFileName, sourceChecksum: bill.sourceChecksum, invoiceNumber: bill.invoiceNumber })) }, null, 2), `old-purchase-evidence-index-${new Date().toISOString().slice(0, 10)}.json`, 'application/json'); }
  selectedCandidate(row: MappingSource) { const target = this.mappingTargets[row.sourceKey]; return row.candidates.find((candidate) => candidate.targetId === target) || row.candidates[0]; }
  selectedCandidateIsRed(row: MappingSource) { return this.selectedCandidate(row)?.governance === 'red'; }
  selectedCandidateHasUnitWarning(row: MappingSource) { return Boolean(this.selectedCandidate(row)?.warnings?.['unitMismatch']); }
  mappingWarnings(candidate?: MappingCandidate) { return Object.values(candidate?.warnings || {}).filter(Boolean); }
  mappingKey(row: MappingSource) { return `${row.identityType}:${row.provider}:${row.sourceKey}`; }
  setApproval(set: Set<string>, row: MappingSource, approved: boolean) { approved ? set.add(this.mappingKey(row)) : set.delete(this.mappingKey(row)); }
  isApproved(set: Set<string>, row: MappingSource) { return set.has(this.mappingKey(row)); }
  greenCandidate(row: MappingSource) { const candidate = this.selectedCandidate(row); return candidate?.governance === 'green' && !row.sourceDrift && !this.mappingWarnings(candidate).length ? candidate : undefined; }
  toggleBulkMapping(row: MappingSource, selected: boolean) { selected ? this.bulkMappingSelection.add(this.mappingKey(row)) : this.bulkMappingSelection.delete(this.mappingKey(row)); }
  bulkMappingSelected(row: MappingSource) { return this.bulkMappingSelection.has(this.mappingKey(row)); }

  async decide(row: MappingSource, decision: 'link' | 'keep_historical_only' | 'reject', candidate = this.selectedCandidate(row)) {
    if (!this.canManage) return;
    const reason = (this.mappingReasons[row.sourceKey] || '').trim();
    if (!reason) { this.error = 'Decision reason is required'; return; }
    if (decision === 'link' && (!candidate || candidate.governance === 'red')) { this.error = 'Red or missing candidates cannot be linked'; return; }
    if (decision === 'link' && candidate?.warnings?.['unitMismatch'] && !this.isApproved(this.unitApprovals, row)) { this.error = 'Approve the exact unit conversion before linking'; return; }
    if (decision === 'link' && row.sourceDrift && !this.isApproved(this.driftApprovals, row)) { this.error = 'Review and approve the source-format drift before linking'; return; }
    if (decision !== 'link' && !confirm(`${decision === 'reject' ? 'Reject' : 'Keep historical only'} ${this.sourceValue(row, 'name')}?`)) return;
    await this.run(async () => { await this.postMappingDecision(row, { decision, targetId: decision === 'link' ? candidate?.targetId || '' : '', reason, approveUnitConversion: this.isApproved(this.unitApprovals, row), approveSourceDrift: this.isApproved(this.driftApprovals, row), bulkApproval: false, create: null }); this.mappingReasons[row.sourceKey] = ''; await this.reload(); }, 'Mapping decision could not be saved');
  }

  async bulkApproveMappings(kind: MappingKind) {
    if (!this.canManage) return;
    const reason = this.bulkMappingReason.trim();
    const rows = (kind === 'product' ? this.products : this.vendors).filter((row) => this.bulkMappingSelected(row));
    if (!reason || !rows.length || rows.some((row) => !this.greenCandidate(row))) { this.error = 'Select Green mappings and enter a bulk approval reason'; return; }
    await this.run(async () => {
      try {
        for (const row of rows) {
          const candidate = this.greenCandidate(row)!;
          await this.postMappingDecision(row, { decision: 'link', targetId: candidate.targetId, reason, approveUnitConversion: false, approveSourceDrift: false, bulkApproval: true, create: null });
        }
        this.bulkMappingReason = ''; this.bulkMappingSelection.clear();
      } finally { await this.reload(); }
    }, 'Green mapping bulk approval stopped; completed rows remain visible');
  }

  openMappingCreate(row: MappingSource) {
    this.mappingCreate = { ...this.emptyMappingCreate(), name: this.sourceFormValue(row, 'name'), code: this.sourceFormValue(row, 'vendorCode'), sku: this.sourceFormValue(row, 'sku'), barcode: this.sourceFormValue(row, 'barcode'), brand: this.sourceFormValue(row, 'brand'), unit: this.sourceFormValue(row, 'unit'), packageUnit: this.sourceFormValue(row, 'packageUnit'), unitsPerPackage: this.sourceFormValue(row, 'unitsPerPackage'), gstin: this.sourceFormValue(row, 'gstin'), phone: this.sourceFormValue(row, 'phone'), email: this.sourceFormValue(row, 'email'), address: this.sourceFormValue(row, 'address') };
    this.mappingDrawer = { mode: 'create', row, versions: [], loading: false };
  }

  async saveMappingCreate() {
    const row = this.mappingDrawer?.row; if (!row || this.mappingDrawer?.mode !== 'create') return;
    const reason = (this.mappingReasons[row.sourceKey] || '').trim();
    const unitsPerPackage = this.mappingCreate.unitsPerPackage.trim() ? Number(this.mappingCreate.unitsPerPackage) : null;
    if (!reason || !this.mappingCreate.name.trim()) { this.error = 'Name and decision reason are required'; return; }
    if (row.identityType === 'product' && (!this.mappingCreate.unit.trim() || !this.mappingCreate.packageUnit.trim() || !Number.isInteger(unitsPerPackage) || Number(unitsPerPackage) <= 0)) { this.error = 'Product unit, package unit and positive units per package are required'; return; }
    if (row.identityType === 'vendor' && !this.mappingCreate.code.trim()) { this.error = 'Vendor code is required'; return; }
    await this.run(async () => { await this.postMappingDecision(row, { decision: 'create', targetId: '', reason, approveUnitConversion: this.isApproved(this.unitApprovals, row), approveSourceDrift: false, bulkApproval: false, create: { ...this.mappingCreate, unitsPerPackage } }); this.mappingDrawer = null; this.mappingReasons[row.sourceKey] = ''; await this.reload(); }, 'CRM record could not be created and mapped');
  }

  async openMappingHistory(row: MappingSource) {
    this.mappingDrawer = { mode: 'history', row, versions: [], loading: true };
    try { const result = await firstValueFrom(this.api.get<ApiEnvelope<MappingVersion[]>>(`/settings/integrations/historical-purchase-mappings/${row.identityType}/${row.sourceKey}/versions?provider=${encodeURIComponent(row.provider)}`)); if (this.mappingDrawer?.row.sourceKey === row.sourceKey) this.mappingDrawer = { mode: 'history', row, versions: result.data || [], loading: false }; }
    catch (error) { this.error = this.message(error, 'Mapping history could not be loaded'); if (this.mappingDrawer) this.mappingDrawer.loading = false; }
  }

  async rollbackMapping(version: MappingVersion) {
    const row = this.mappingDrawer?.row; if (!row || !this.canManage || !confirm(`Restore mapping version ${version.version}?`)) return;
    await this.run(async () => { await firstValueFrom(this.api.post(`/settings/integrations/historical-purchase-mappings/${row.identityType}/${row.sourceKey}/rollback/${version.version}?provider=${encodeURIComponent(row.provider)}`, {})); await this.reload(); await this.openMappingHistory(this.mappingDrawer?.row || row); }, 'Mapping rollback failed');
  }

  private postMappingDecision(row: MappingSource, body: Record<string, unknown>) { return firstValueFrom(this.api.post(`/settings/integrations/historical-purchase-mappings/${row.identityType}/${row.sourceKey}/decisions?provider=${encodeURIComponent(row.provider)}`, { expectedVersion: row.currentMapping?.version || 0, approveVariantMismatch: false, ...body })); }
  private sourceValue(row: MappingSource, key: string) { const value = row.source[key]; return value == null || value === '' ? '—' : String(value); }
  private sourceFormValue(row: MappingSource, key: string) { const value = row.source[key]; return value == null ? '' : String(value); }
  private emptyMappingCreate(): MappingCreateForm { return { name: '', code: '', sku: '', barcode: '', brand: '', category: '', unit: '', packageUnit: '', unitsPerPackage: '', gstin: '', phone: '', email: '', address: '' }; }

  formatDate(value?: string) { return value ? new Intl.DateTimeFormat('en-GB').format(new Date(`${value.slice(0, 10)}T00:00:00`)) : '—'; }
  percentBps(value?: number) { return value == null ? '—' : `${Math.round(value / 100)}%`; }
  money(value = 0, currency = 'INR') { return new Intl.NumberFormat('en-IN', { style: 'currency', currency }).format(value / 100); }
  sourceText(row: MappingSource, key: string) { return this.sourceValue(row, key); }
  sourceNumber(row: MappingSource, key: string) { const value = Number(row.source[key]); return Number.isFinite(value) ? value : 0; }
  titleCaseCreate(field: 'name' | 'brand' | 'category') { this.mappingCreate[field] = this.mappingCreate[field].replace(/\S+/g, (word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()); }
  mappingLabel(row: MappingSource) { return row.currentMapping?.decision?.replaceAll('_', ' ') || 'Unmapped'; }
  private async run(action: () => Promise<void>, fallback: string) { this.busy = true; this.error = ''; try { await action(); } catch (error) { this.error = this.message(error, fallback); } finally { this.busy = false; } }
  private csv(value: unknown) { return `"${String(value ?? '').replaceAll('"', '""')}"`; }
  private parsePaise(value: string) {
    const match = value.trim().replaceAll(',', '').match(/^(-?)(\d+)(?:\.(\d{1,2}))?$/);
    if (!match) return null;
    const paise = Number(match[2]) * 100 + Number((match[3] || '').padEnd(2, '0'));
    return Number.isSafeInteger(paise) ? (match[1] ? -paise : paise) : null;
  }
  private downloadBlob(blob: Blob, name: string) { const url = URL.createObjectURL(blob); const anchor = document.createElement('a'); anchor.href = url; anchor.download = name; anchor.click(); URL.revokeObjectURL(url); }
  private download(content: string, name: string, type: string) { this.downloadBlob(new Blob([content], { type }), name); }
  private message(error: any, fallback: string) { return error?.error?.error?.message || error?.error?.message || error?.message || fallback; }
}
