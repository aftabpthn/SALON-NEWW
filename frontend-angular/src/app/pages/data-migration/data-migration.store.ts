import { computed, inject, Injectable, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { ApiEnvelope, ApiService } from '../../shared/services/api.service';

export type ImportIssue = { code: string; message: string };
export type ImportAnalysisRow = { sourceRowNumber: number; sourceExternalId: string; status: string; errors: ImportIssue[]; warnings: ImportIssue[]; duplicateTargetId?: string; duplicateDecision?: 'merge' | 'keep' | 'link' };
export type ImportEntity = 'clients' | 'staff' | 'services' | 'products' | 'suppliers' | 'inventory' | 'memberships' | 'packages' | 'appointments' | 'sales' | 'invoices' | 'payments' | 'expenses' | 'purchase-bills';
export type ImportAnalysis = { entity: ImportEntity; mapping: Record<string, string>; unmatchedColumns: string[]; rows: ImportAnalysisRow[]; summary: { sourceRows: number; validRows: number; errorRows: number; warningRows: number; duplicateRows: number; readyRows: number } };
export type ImportMapping = { id: string; name: string; entity: ImportEntity; mapping: Record<string, string>; sourceColumns: string[] };
export type ImportTemplate = { entity: ImportEntity; columns: { field: string; required: boolean; aliases: string[] }[] };
export type ImportJob = { id: string; entity: string; fileName: string; mode: string; status: string; errorsJson: { row: number; message: string }[]; totalRows: number; processedRows: number; errorRowCount: number; warningRowCount: number; duplicateRowCount: number; lastError: string; sourceFileId?: string; chunkSize: number; allowPartialImport: boolean; workerPhase: string; heartbeatAt?: string; totalChunks: number; completedChunks: number; failedChunks: number; ownerUserId: string; approvalStatus: 'not_required' | 'pending' | 'approved' | 'rejected'; analysisJson?: ImportAnalysis; createdAt: string; completedAt?: string; rolledBackAt?: string };
export type SourceFile = { id: string; originalFileName: string; format: string; sizeBytes: number; sha256: string; evidenceStatus: string; readOnly: boolean; artifacts: { id: string; entryName: string }[]; createdAt: string };
export type MigrationGovernance = {
  job: { jobId: string; branchId: string; entity: string; fileName: string; mode: string; status: string; ownerUserId: string; approvalStatus: string; sourceHash?: string; expected: { sourceRows: number; validRows: number; errorRows: number; warningRows: number; duplicateRows: number }; processedRows: number; createdAt: string; completedAt?: string; rolledBackAt?: string };
  actual: { created: number; merged: number; linked: number; kept: number; failed: number; rolledBack: number };
  reconciliation: { status: string; expectedValidRows: number; actualProcessedRows: number };
  branchEntityTotals: { branchId: string; entity: string; jobs: number; completedJobs: number; sourceRows: number; processedRows: number; errorRows: number };
  preRollbackImpact: { safeToRollback: boolean; actions: { wouldDelete: number; wouldRestore: number; wouldUnlink: number; noChange: number }; dependencies: { blockingRecords: number; cascadeRecords: number; setNullRecords: number; managedRecords?: number } };
  recoveryRecommendations: string[];
};
export type MigrationFailureAssistant = { jobId: string; source: string; model: string; summary: string; recommendations: string[] };
export type MigrationMonitoring = { generatedAt: string; queueDepth: number; staleWorkers: number; failedJobs24h: number; overdueApprovals: number; alerts: { code: string; severity: string; count: number; runbook: string }[] };

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
  readonly governanceLoading = signal(false);
  readonly activeWorkers = computed(() => this.jobs().filter((job) => ['staging', 'queued', 'processing'].includes(job.status)).length);
  readonly pendingApprovals = computed(() => this.jobs().filter((job) => job.approvalStatus === 'pending').length);

  async reload() {
    const [jobs, sourceFiles, mappings, templates, monitoring] = await Promise.all([
      firstValueFrom(this.api.get<ApiEnvelope<ImportJob[]>>('/settings/integrations/import-jobs')),
      firstValueFrom(this.api.get<ApiEnvelope<SourceFile[]>>('/settings/integrations/import-source-files')),
      firstValueFrom(this.api.get<ApiEnvelope<ImportMapping[]>>('/settings/integrations/import-mappings')),
      firstValueFrom(this.api.get<ApiEnvelope<ImportTemplate[]>>('/settings/integrations/import-templates')),
      firstValueFrom(this.api.get<ApiEnvelope<MigrationMonitoring>>('/settings/integrations/import-monitoring')),
    ]);
    this.jobs.set(jobs.data || []);
    this.sourceFiles.set(sourceFiles.data || []);
    this.mappings.set(mappings.data || []);
    this.templates.set(templates.data || []);
    this.monitoring.set(monitoring.data || null);
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
}
