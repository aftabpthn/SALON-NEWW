import { computed, inject, Injectable, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { ApiEnvelope, ApiService } from '../../shared/services/api.service';

export type ImportIssue = { code: string; message: string; rowNumber?: number; sourceField?: string; valuePattern?: string; suggestedTarget?: string };
export type DuplicateDecision = 'merge' | 'keep' | 'link' | 'reject';
export type DuplicatePreview = { existingValue: Record<string, unknown>; incomingValue: Record<string, unknown>; finalValue: Record<string, unknown>; fieldsThatWillChange: string[]; dependentRecords: Record<string, number> };
export type ImportAnalysisRow = { sourceRowNumber: number; sourceExternalId: string; status: string; errors: ImportIssue[]; warnings: ImportIssue[]; duplicateTargetId?: string; duplicateDecision?: DuplicateDecision; duplicateSignals: { kind: string; normalizedValue: string }[]; allowedDuplicateDecisions: DuplicateDecision[]; duplicatePreview?: DuplicatePreview };
export type ImportEntity = 'clients' | 'staff' | 'services' | 'products' | 'suppliers' | 'inventory' | 'memberships' | 'client-memberships' | 'packages' | 'appointments' | 'sales' | 'invoices' | 'payments' | 'expenses' | 'purchase-bills' | 'opening-payables' | 'refunds' | 'gift-cards' | 'loyalty' | 'payroll' | 'commissions' | 'client-notes' | 'files' | 'stock-movements';
export type ImportAnalysis = { entity: ImportEntity; mapping: Record<string, string>; unmatchedColumns: string[]; rows: ImportAnalysisRow[]; summary: { sourceRows: number; validRows: number; errorRows: number; dependencyPendingRows: number; warningRows: number; duplicateRows: number; readyRows: number } };
export type ImportMapping = { id: string; name: string; entity: ImportEntity; mapping: Record<string, string>; sourceColumns: string[]; sourceProvider: string; sourceSheet: string; normalizedHeaders: string[]; headerFingerprint: string; columnCount: number; mappingVersion: number; transformerVersions: Record<string, string>; approvedBy: string; approvedAt: string; createdAt: string; updatedAt: string };
export type ImportMappingVersion = { mappingId: string; version: number; entity: ImportEntity; sourceProvider: string; sourceSheet: string; sourceColumns: string[]; normalizedHeaders: string[]; headerFingerprint: string; columnCount: number; mapping: Record<string, string>; transformerVersions: Record<string, string>; approvedBy: string; approvedAt: string; changeKind: 'approved' | 'rollback'; rolledBackFromVersion?: number };
export type ImportTemplate = { contractVersion: string; entity: ImportEntity; columns: { field: string; required: boolean; aliases: string[]; globalAliases: string[]; providerAliases: Record<string, string[]>; dataType: string; transformationRule: string }[] };
export type ImportJob = { id: string; entity: string; fileName: string; mode: string; status: string; errorsJson: { row: number; message: string }[]; totalRows: number; processedRows: number; errorRowCount: number; warningRowCount: number; duplicateRowCount: number; lastError: string; sourceFileId?: string; mappingId?: string; mappingVersion?: number; mappingHeaderFingerprint: string; transformerVersions: Record<string, string>; chunkSize: number; allowPartialImport: boolean; workerPhase: string; heartbeatAt?: string; totalChunks: number; completedChunks: number; failedChunks: number; ownerUserId: string; approvalStatus: 'not_required' | 'pending' | 'approved' | 'rejected'; analysisJson?: ImportAnalysis; createdAt: string; completedAt?: string; rolledBackAt?: string };
export type SourceFile = { id: string; tenantId: string; branchId: string; provider: string; uploadedBy: string; originalFileName: string; format: string; sizeBytes: number; sha256: string; evidenceStatus: string; readOnly: boolean; encrypted: boolean; encryptionScheme: string; retentionUntil: string; purgedAt?: string; artifacts: { id: string; entryName: string }[]; createdAt: string };
export type UploadSession = { id: string; missingParts: number[]; receivedBytes: number; expectedSizeBytes: number; status: string; lastError: string };
export type HistoricalEvidenceReport = {
  cutover: MigrationCutover;
  cutoverApproval?: { approvedBy: string; approvedRole: string; approvedAt: string };
  files: { id: string; sourceFileId: string; kind: 'historical_bill' | 'physical_inventory' | 'supplier_outstanding'; supplierBatch: string; originalSupplierBatch: string; evidenceState: 'active' | 'excluded'; correctionReason: string; correctedBy?: string; correctedAt?: string; downstreamUsed: boolean; originalFileName: string; format: string; sizeBytes: number; sha256: string; pageCount: number; uploadedBy: string; createdAt: string; artifacts: { id: string; entryName: string; format: string; sha256: string; pageCount: number }[] }[];
  failures: { uploadSessionId: string; fileName: string; supplierBatch: string; kind: string; status: string; message: string; updatedAt: string }[];
  groups: { supplierBatch: string; groupKey: string; detectedPageCount: number; approvedPageCount?: number; status: 'suggested' | 'approved' | 'rejected'; confidencePercentage: number; signals: string[]; sourceFileCount: number; documentKeys: string[]; decidedBy?: string; decidedAt?: string }[];
  summary: { totalFiles: number; auditFileCount: number; excludedFiles: number; totalPages: number; historicalBillFiles: number; unidentifiedSupplierBatches: string[]; physicalInventoryReady: boolean; supplierOutstandingReady: boolean; groupingApproved: boolean; cutoverApproved: boolean; checksumVerified: boolean; historicalStockEffect: 0; historicalAccountingEffect: 0; historicalGstEffect: 0; liveCrmWrites: 0; complete: boolean };
};
export type MigrationSourceColumnProfile = { originalHeader: string; normalizedHeader: string; sampleValues: string[]; detectedDataType: string; emptyPercentage: number; uniquePercentage: number; duplicateCount: number; minimum?: string; maximum?: string; patterns: string[]; possibleCrmEntity?: ImportEntity; possibleCrmField?: string; invalidValueCount: number; statisticsExact: boolean };
export type MigrationSourceProfile = { provider: string; sheets: { id: string; name: string; fileName: string; rowCount: number; columnCount: number; columns: string[]; columnProfiles: MigrationSourceColumnProfile[]; targets: ImportEntity[]; importable: boolean }[] };
export type MigrationGovernance = {
  job: { jobId: string; branchId: string; entity: string; fileName: string; mode: string; status: string; ownerUserId: string; approvalStatus: string; sourceHash?: string; mappingId?: string; mappingVersion?: number; mappingHeaderFingerprint: string; transformerVersions: Record<string, string>; mappingSnapshot: Record<string, string>; expected: { sourceRows: number; validRows: number; errorRows: number; warningRows: number; duplicateRows: number }; processedRows: number; createdAt: string; completedAt?: string; rolledBackAt?: string };
  actual: { created: number; merged: number; linked: number; kept: number; failed: number; rolledBack: number };
  dryRunSummary: { totalRows: number; readyRows: number; warningRows: number; yellowApprovals: number; yellowApproved: boolean; redRows: number; duplicates: number; unresolvedDuplicates: number; missingDependencies: number; expectedCreates: number; expectedUpdates: number; expectedLinks: number; expectedKeeps: number; commitBlocked: boolean };
  duplicateResolution: { rows: { sourceRowNumber: number; targetId: string; decision?: DuplicateDecision; status: string; signals: { kind: string; normalizedValue: string }[]; allowedDecisions: DuplicateDecision[]; preview: DuplicatePreview }[] };
  preview: { fields: { sourceRowNumber: number; originalSourceValue: unknown; sourceColumn: string; selectedCrmField: string; transformation: string; crmValue: unknown; confidence: 'green' | 'yellow' | 'red'; validationResult: string; existingMatch?: string; decision: string }[]; limit: number; truncated: boolean };
  openingStockPreview: {
    status: 'not_applicable' | 'ready' | 'blocked';
    rows: { sourceRowNumber: number; inventoryItemId: string; locationCode: string; sourceQuantity: string; sourceUnit: string; unitMultiplier: number; beforeQuantity: number; declaredQuantity: number; setToDelta: number; postCutoverDelta: number; expectedCurrentQuantity: number; correctionDelta: number; approvedUnitCostPaise: number; valuationPaise: number; classifications: Record<string, number>; countedBy: string; status: string; errorCode?: string; message?: string }[];
    summary: { rows?: number; declaredQuantity?: number; beforeQuantity?: number; setToDelta?: number; postCutoverDelta?: number; expectedCurrentQuantity?: number; correctionDelta?: number; valuationPaise?: number; blockingRows?: number };
  };
  openingPayablePreview: {
    status: 'not_applicable' | 'ready' | 'blocked';
    rows: { sourceRowNumber: number; supplierId: string; balanceSide: 'debit' | 'credit'; amountPaise: number; currency: string; dueDate?: string; allocatedPaise: number; unallocatedPaise: number; unallocatedApproved: boolean; gstPaise: number; status: string; errorCode?: string; message?: string }[];
    summary: { rows?: number; creditPaise?: number; debitPaise?: number; allocatedPaise?: number; unallocatedPaise?: number; sourcePaise?: number; expectedPaise?: number; differencePaise?: number; gstPaise?: number; currency?: string; openingBalanceAccount?: string; blockingRows?: number; sourceHash?: string; dataHash?: string };
    controls: { financeApproved?: boolean; financeApprovedBy?: string; financeApprovedAt?: string; branchConfirmed?: boolean; branchConfirmedBy?: string; branchConfirmedAt?: string; ownerApproved?: boolean; ownerApprovedBy?: string; openingBalanceAccount?: string; payableAccount?: string; supplierAdvanceAccount?: string };
  };
  quarantine: { records: MigrationQuarantineRecord[]; total: number; limit: number; truncated: boolean };
  reconciliation: { status: string; expectedValidRows: number; actualProcessedRows: number };
  financialReconciliation: { supported: boolean; status: string; matched?: boolean; metrics: Record<string, { sourcePaise: number; targetPaise: number; differencePaise: number }> };
  dependencies: { jobId: string; entity: string; status: string; completed: boolean }[];
  dependencyExecution: { state: string; pendingRows: number; deadlock?: { code: string; pendingRows?: number; blockers?: { jobId: string; entity: string; status: string; scopeValid: boolean }[] } };
  cutover: { ready: boolean; checks: { jobCompleted: boolean; rowsMatched: boolean; financialsMatched: boolean; dependenciesCompleted: boolean; approvalComplete: boolean } };
  branchEntityTotals: { branchId: string; entity: string; jobs: number; completedJobs: number; sourceRows: number; processedRows: number; errorRows: number };
  preRollbackImpact: { safeToRollback: boolean; actions: { wouldDelete: number; wouldRestore: number; wouldUnlink: number; noChange: number }; dependencies: { blockingRecords: number; cascadeRecords: number; setNullRecords: number; managedRecords?: number }; calculatedRecovery: { snapshotLiveMovements: number; openingPayableSettlementEvents: number; preserveLiveMovements: boolean; requiresManualRecovery: boolean } };
  recoveryRecommendations: string[];
};
export type MigrationQuarantineRecord = { sourceSheet: string; sourceRowNumber: number; state: string; originalRow: Record<string, string>; sourceColumn: string; originalValue: unknown; targetField: string; transformation: string; errorCode: string; explanation: string; suggestedCorrection: string; retryEligible: boolean; retryCount: number; lastError: string; quarantinedAt: string; lastRetryAt?: string; warnings: unknown[]; existingMatch?: string; duplicateDecision?: string; correction?: Record<string, string> };
export type MigrationFailureAssistant = { jobId: string; source: string; model: string; summary: string; recommendations: string[] };
export type MigrationMonitoring = { generatedAt: string; queueDepth: number; staleWorkers: number; failedJobs24h: number; overdueApprovals: number; dependencyDeadlocks: number; alerts: { code: string; severity: string; count: number; runbook: string }[] };
export type MigrationCutoverStatus = 'draft' | 'history_importing' | 'inventory_frozen' | 'snapshot_approved' | 'snapshot_applied' | 'reconciled' | 'live';
export type MigrationCutoverReconciliation = { status: 'matched' | 'blocked'; blockers: string[]; historical: { sourceBillCount: number; archiveBillCount: number; sourceLineCount: number; archiveLineCount: number; unmappedProducts: number; duplicateBills: number; rejectedLines: number; sourceAttachmentReferences: number; archiveAttachmentCount: number }; inventory: { declaredSnapshot: number; stockBefore: number; appliedDelta: number; stockAfter: number; postCutoverMovements: number; expectedCurrentStock: number; batchDeclaredTotal: number; locationTotal: number; openingValuationPaise: number; matched: boolean }; accounting: { historicalPostingEffectPaise: number; openingPayableSourcePaise: number; openingPayableAppliedPaise: number; openingInventoryJournalPaise: number; gstEffectPaise: number; supplierAllocationPaise: number }; finalization?: { evidenceFiles: number; archiveItems: number; finalArchiveItems: number; activeJobs: number; reconciliationVersion: string } };
export type MigrationCutover = { id: string; tenantId: string; branchId: string; businessTimezone: string; cutoverDate: string; cutoverAt: string; historicalPeriodEnd: string; inventoryFreezeStart?: string; inventoryFreezeEnd?: string; snapshotChecksum: string; status: MigrationCutoverStatus; approvedUsers: string[]; ownerApprovedBy?: string; ownerApprovedAt?: string; goLiveAt?: string; goLiveApprovedRole: string; goLiveApprovalNote: string; goLiveReconciliationVersion: string; goLiveReconciliationChecksum: string; goLiveReconciliation: Record<string, unknown>; rollbackPolicy: { observationPeriodHours?: number; decisionAuthorityUserId?: string; decisionAuthorityRole?: string; maximumAcceptableVariancePaise?: number; financialPeriodLockRequired?: boolean; alertRoles?: string[]; recoverySequence?: string[]; approvedAt?: string }; rollbackState: string; configuredBy: string; contractVersion: string; createdAt: string; updatedAt: string; transitions: { id: number; fromStatus?: string; toStatus: string; actorId: string; actorRole: string; note: string; createdAt: string }[]; reconciliation?: MigrationCutoverReconciliation };
export type HistoricalPurchaseBill = { id: string; provider: string; cutoverId: string; externalBillId: string; supplierName: string; supplierGstin: string; invoiceNumber: string; invoiceDate: string; receivedDate: string; currency: string; documentType: string; sourceStatus: string; paymentStatus: string; taxablePaise: number; taxPaise: number; lineTotalPaise: number; totalPaise: number; lineCount: number; unmappedProductCount: number; sourceFileId: string; sourceFileName: string; sourceChecksum: string; stockEffect: 'none'; accountingEffect: 'none'; liveRegisterCollision: boolean; createdAt: string };

@Injectable({ providedIn: 'root' })
export class DataMigrationStore {
  private readonly api = inject(ApiService);
  readonly jobs = signal<ImportJob[]>([]);
  readonly sourceFiles = signal<SourceFile[]>([]);
  readonly mappings = signal<ImportMapping[]>([]);
  readonly templates = signal<ImportTemplate[]>([]);
  readonly governance = signal<MigrationGovernance | null>(null);
  readonly failureAssistant = signal<MigrationFailureAssistant | null>(null);
  readonly monitoring = signal<MigrationMonitoring | null>(null);
  readonly activeCutover = signal<MigrationCutover | null>(null);
  readonly historicalPurchaseBills = signal<HistoricalPurchaseBill[]>([]);
  readonly governanceLoading = signal(false);
  readonly activeWorkers = computed(() => this.jobs().filter((job) => ['staging', 'dependency_pending', 'queued', 'processing'].includes(job.status)).length);
  readonly pendingApprovals = computed(() => this.jobs().filter((job) => job.approvalStatus === 'pending').length);

  async reload() {
    const [jobs, sourceFiles, mappings, templates, monitoring, cutover, historicalBills] = await Promise.all([
      firstValueFrom(this.api.get<ApiEnvelope<ImportJob[]>>('/settings/integrations/import-jobs')),
      firstValueFrom(this.api.get<ApiEnvelope<SourceFile[]>>('/settings/integrations/import-source-files')),
      firstValueFrom(this.api.get<ApiEnvelope<ImportMapping[]>>('/settings/integrations/import-mappings')),
      firstValueFrom(this.api.get<ApiEnvelope<ImportTemplate[]>>('/settings/integrations/import-templates')),
      firstValueFrom(this.api.get<ApiEnvelope<MigrationMonitoring>>('/settings/integrations/import-monitoring')),
      firstValueFrom(this.api.get<ApiEnvelope<MigrationCutover | null>>('/settings/integrations/migration-cutovers/active')),
      firstValueFrom(this.api.get<ApiEnvelope<HistoricalPurchaseBill[]>>('/settings/integrations/historical-purchase-bills')),
    ]);
    this.jobs.set(jobs.data || []);
    this.sourceFiles.set(sourceFiles.data || []);
    this.mappings.set(mappings.data || []);
    this.templates.set(templates.data || []);
    this.monitoring.set(monitoring.data || null);
    this.activeCutover.set(cutover.data || null);
    this.historicalPurchaseBills.set(historicalBills.data || []);
  }

  async loadFailureAssistant(jobId: string) {
    const result = await firstValueFrom(this.api.post<ApiEnvelope<MigrationFailureAssistant>>(`/settings/integrations/import-jobs/${jobId}/failure-assistant`, {}));
    this.failureAssistant.set(result.data || null);
  }

  async loadGovernance(jobId: string) {
    this.governanceLoading.set(true);
    try {
      const result = await firstValueFrom(this.api.get<ApiEnvelope<MigrationGovernance>>(`/settings/integrations/import-jobs/${jobId}/governance`));
      this.governance.set(result.data || null);
    } finally {
      this.governanceLoading.set(false);
    }
  }

  clearGovernance() {
    this.governance.set(null);
    this.failureAssistant.set(null);
  }

  async uploadSourceFile(file: File, options: { provider: string; retentionDays: number; sessionId?: string; evidenceKind?: string; supplierBatch?: string; cutoverId?: string }, progress?: (percent: number) => void) {
    if (!file.size || file.size > 500 * 1024 * 1024) throw new Error('File must be between 1 byte and 500 MB');
    const partSize = 8 * 1024 * 1024; const totalParts = Math.ceil(file.size / partSize);
    let sessionId = options.sessionId || '';
    let session: UploadSession;
    if (!sessionId) {
      const created = await firstValueFrom(this.api.post<ApiEnvelope<UploadSession>>('/settings/integrations/import-uploads', { fileName: file.name, provider: options.provider, contentType: file.type || 'application/octet-stream', sizeBytes: file.size, totalParts, retentionDays: options.retentionDays, evidenceKind: options.evidenceKind || null, supplierBatch: options.supplierBatch || null, cutoverId: options.cutoverId || null }));
      if (!created.data) throw new Error('Upload session was not created'); session = created.data; sessionId = session.id;
    } else {
      const existing = await firstValueFrom(this.api.get<ApiEnvelope<UploadSession>>(`/settings/integrations/import-uploads/${sessionId}`));
      if (!existing.data) throw new Error('Upload session was not found'); session = existing.data;
    }
    for (const partNumber of session.missingParts) {
      const chunk = file.slice((partNumber - 1) * partSize, Math.min(partNumber * partSize, file.size), file.type || 'application/octet-stream');
      const receipt = await firstValueFrom(this.api.putBytes<ApiEnvelope<{ session: UploadSession }>>(`/settings/integrations/import-uploads/${sessionId}/parts/${partNumber}`, chunk, { 'X-Part-Sha256': await this.sha256(chunk) }));
      progress?.(Math.round(100 * (receipt.data?.session.receivedBytes || 0) / file.size));
    }
    const completed = await firstValueFrom(this.api.post<ApiEnvelope<{ sourceFile: SourceFile }>>(`/settings/integrations/import-uploads/${sessionId}/complete`, {}));
    if (!completed.data?.sourceFile) throw new Error('Source evidence was not finalized');
    progress?.(100);
    return { sessionId, sourceFile: completed.data.sourceFile };
  }

  private async sha256(blob: Blob) { const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer()); return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join(''); }
}
