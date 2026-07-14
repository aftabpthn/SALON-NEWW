import { CommonModule } from '@angular/common';
import { Component, ElementRef, OnDestroy, OnInit, ViewChild, computed, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { ApiService } from '../core/api.service';
import { AuraDatePipe } from '../shared/pipes/aura-date.pipe';

type MigrationSummary = {
  totalRows: number;
  validRows: number;
  warningRows: number;
  errorRows: number;
  duplicateRows: number;
  affectedRecords?: number;
  byEntity: Record<string, { total: number; valid: number; warnings: number; errors: number; duplicates: number }>;
  byBranch?: Record<string, { total: number; valid: number; warnings: number; errors: number }>;
  diagnostics?: AnalyzerDiagnostics;
};

type AnalyzerDiagnostics = {
  analyzerFixVersion?: string;
  adapter?: string;
  sourceSoftware?: string;
  largeMode?: boolean;
  crossChunkReferencesLoaded?: number;
  paymentInvoiceUnresolved?: number;
  clientPhoneMissing?: number;
  jobId?: string;
  generatedAt?: string;
};

type SourceAdapter = {
  label: string;
  type: string;
  formats: string[];
  status: string;
};
type NormalizedMigrationFile = {
  file: string;
  resource: string;
  rows: number;
  sizeBytes: number;
};

type NormalizedMigrationPackage = {
  normalized: boolean;
  sourceFileName: string;
  sourceSoftware: string;
  targetSourceSoftware: string;
  targetResource: string;
  fileName: string;
  fileBase64: string;
  fileSizeBytes: number;
  summary: { fileCount: number; totalRows: number; files: NormalizedMigrationFile[] };
  files: NormalizedMigrationFile[];
  unmatchedColumns?: string[];
};

type MigrationTemplate = {
  resource: string;
  table: string;
  required: string[];
  columns: Array<{ field: string; required: boolean; aliases: string[]; example: string }>;
};

type MappingDraftRow = {
  targetField: string;
  sourceColumn: string;
  required: boolean;
  confidence: number;
  aliases: string[];
};

type ReconciliationLine = {
  metric: string;
  expected: number | null;
  actual: number;
  difference: number | null;
  match: boolean | null;
  status: string;
};


type LargeReconciliationSnapshot = {
  id: string;
  status: 'passed' | 'warning' | 'failed' | string;
  snapshotType?: string;
  createdAt?: string;
  expected?: any;
  actual?: any;
  differences?: Array<{ code?: string; severity?: string; resource?: string; expected?: number; actual?: number; missing?: number; message?: string }>;
};
type ApprovalRecord = {
  id: string;
  jobId?: string;
  resource?: string;
  sourceSoftware?: string;
  fileName?: string;
  sourceFileHash?: string;
  totalRows?: number;
  errorCount?: number;
  warningCount?: number;
  validRows?: number;
  importableRows?: number;
  status: string;
  note?: string;
  submittedAt?: string;
  reviewedAt?: string;
  summary?: any;
};
type LargeMigrationJob = {
  id: string;
  status: string;
  totalRows?: number;
  processedRows?: number;
  validRows?: number;
  importedRows?: number;
  skippedRows?: number;
  errorRows?: number;
  warningRows?: number;
  chunkSize?: number;
  resumeToken?: string;
  createdAt?: string;
  sourceSoftware?: string;
  resource?: string;
  fileName?: string;
  sourceFileHash?: string;
  settings?: { sourceFileHash?: string; sourceEvidence?: any } & Record<string, any>;
  chunks?: Array<{ id: string; chunkNumber: number; status: string; totalRows: number; importedRows?: number; skippedRows?: number; errorRows?: number; warningRows?: number; checksum?: string; completedAt?: string; failureReason?: string; summary?: { diagnostics?: AnalyzerDiagnostics } & Record<string, any> }>;
  reconciliations?: LargeReconciliationSnapshot[];
  summary?: { diagnostics?: AnalyzerDiagnostics } & Record<string, any>;
  diagnostics?: AnalyzerDiagnostics;
};

type MigrationRecoveryReport = {
  status: string;
  blockers: string[];
  summary: { totalRows: number; importedRows: number; failedRows: number; warningRows: number; retryCandidates: number; missingLiveTargets: number; batches: number };
  failedRows: Array<{ rowKey: string; resource: string; sourceExternalId?: string; message: string; retryable: boolean; retryReason: string }>;
  warningRows: Array<{ rowKey: string; resource: string; sourceExternalId?: string; message: string; retryable: boolean; retryReason: string }>;
  retryCandidates: Array<{ rowKey: string; resource: string; sourceExternalId?: string; message: string; retryable: boolean; retryReason: string }>;
  rollbackPlan?: { recommended: boolean; endpoint: string; batches: Array<{ batchId: string; status: string; resource: string; importedRows: number; errorRows: number; createdAt?: string }> };
  idMapCoverage?: Record<string, Record<string, number>>;
  missingLiveTargets?: Array<{ rowKey: string; resource: string; sourceExternalId?: string; targetId?: string; message: string }>;
  nextActions: string[];
};
@Component({
  selector: 'app-data-migration',
  standalone: true,
  imports: [AuraDatePipe, CommonModule, FormsModule, RouterLink, RouterLinkActive, RouterOutlet],
  template: `
    <section class="migration-shell" [class.child-page-active]="migrationChildActive()" [class.migration-section-mode]="activeMigrationSection()">
      <header class="command-header">
        <div>
          <h1>100X import command center</h1>
        </div>
        <div class="score-card aura-card" [class.danger]="readinessScore() < 60" [class.warning]="readinessScore() >= 60 && readinessScore() < 85" [class.aura-card--tone-danger]="readinessScore() < 60" [class.aura-card--tone-warning]="readinessScore() >= 60 && readinessScore() < 85">
          <span>Go-live readiness</span>
          <strong>{{ readinessScore() }}%</strong>
          <small>{{ goLiveGate() }}</small>
        </div>
      </header>

      <section class="control-strip">
        <article>
          <span>Source intelligence</span>
          <strong>{{ selectedSourceLabel() }}</strong>
          <small>{{ selectedAdapterType() }} - {{ selectedAdapterStatus() }}</small>
        </article>
        <article>
          <span>Selected file</span>
          <strong>{{ fileName() || 'No file selected' }}</strong>
          <small>{{ fileSizeLabel() }}</small>
        </article>
        <article>
          <span>Client Master</span>
          <strong>{{ liveClientTotal() }}</strong>
          <small>{{ migratedClientTotal() }} migrated · {{ tenantClientTotal() }} total</small>
        </article>
        <article>
          <span>Rows scanned</span>
          <strong>{{ summary()?.totalRows || 0 }}</strong>
          <small>{{ summary()?.validRows || 0 }} valid - {{ summary()?.errorRows || 0 }} critical</small>
        </article>
        <article>
          <span>Rollback cover</span>
          <strong>{{ onboarding()?.rollbackHistory || 0 }}</strong>
        </article>
      </section>

      <section class="migration-page-workspace">
        <aside class="migration-side-nav" aria-label="Data migration pages">
          <a
            class="migration-nav-card"
            *ngFor="let page of migrationPages"
            [routerLink]="page.route"
            routerLinkActive="active"
            [routerLinkActiveOptions]="{ exact: page.exact }"
          >
            <span class="migration-nav-icon">{{ page.icon }}</span>
            <span><strong>{{ page.label }}</strong><small>{{ page.description }}</small></span>
            <em>{{ page.badge }}</em>
          </a>
        </aside>
        <main class="migration-page-detail">
          <router-outlet></router-outlet>
        </main>
      </section>

      <section class="normalizer-files" *ngIf="!activeMigrationSection() && entityTotalCards().length">
        <article *ngFor="let item of entityTotalCards()">
          <strong>{{ item.label }}</strong>
          <small>{{ item.total || 0 }} total - {{ item.branchTotal || 0 }} branch - {{ item.migrated || 0 }} migrated</small>
        </article>
      </section>

      <section class="workspace-grid">
        <article class="panel import-panel" *ngIf="showMigrationSection('purchase-bill-history')">
          <div class="panel-head">
            <div>
              <h2>Historical purchase bill migration</h2>
              <p>Import old vendor bills into purchase bill history only. Supplier details and product line items are preserved, but product masters, batches and inventory stock are not created.</p>
            </div>
            <span class="status-pill">History only</span>
          </div>
          <div class="control-strip compact">
            <article><span>Target</span><strong>Purchase bill drafts</strong><small>Status: historical_imported</small></article>
            <article><span>Inventory effect</span><strong>0 stock movement</strong><small>No old purchase quantity appears in live inventory</small></article>
            <article><span>Vendor detail</span><strong>Name, GSTIN, phone</strong><small>Email and address are also retained when mapped</small></article>
          </div>
          <div class="action-row">
            <button class="primary-button" type="button" (click)="selectHistoricalPurchaseBillMigration()">Use purchase bill template</button>
            <a class="ghost-button" routerLink="/inventory/purchase-bill-drafts">View migrated bills</a>
          </div>
          <p class="estimate-text">Required columns: branch, supplier name, bill number, product name and quantity. Optional columns preserve GST, SKU, batch, expiry and vendor contact details.</p>
        </article>

        <article class="panel import-panel" *ngIf="showMigrationSection('controlled-migration-launch')">
          <div class="panel-head">
            <div>
              <h2>Controlled migration launch</h2>
            </div>
            <span class="status-pill">{{ loading() ? 'Running' : 'Ready' }}</span>
          </div>

          <div class="form-grid">
            <label>
              <span>Source software</span>
              <select [(ngModel)]="sourceSoftware" (ngModelChange)="refreshSourceContext()">
                <option *ngFor="let source of sourceOptions" [value]="source.value">{{ source.label }}</option>
              </select>
            </label>
            <label>
              <span>Resource</span>
              <select [(ngModel)]="resource" (ngModelChange)="onResourceChange()">
                <option value="">Auto-detect by sheet name</option>
                <option *ngFor="let item of resourceOptions" [value]="item.value">{{ item.label }}</option>
              </select>
            </label>
            <label class="file-drop">
              <span>Upload Excel / CSV / ZIP</span>
              <input #sourceFileInput type="file" accept=".xlsx,.xls,.csv,.zip" (change)="onFile($event)" />
              <label class="inline-toggle" style="margin-top:8px">
                <input type="checkbox" [ngModel]="largeUploadMode()" (ngModelChange)="largeUploadMode.set($event)" />
                <span>Use Large Import Mode for 50K+ rows / large ZIP/XLSX</span>
              </label>
            </label>
          </div>

          <div class="normalizer-card" *ngIf="canNormalizeSource() || normalizerResult()">
            <div>
              <span>Migration Source Normalizer</span>
              <strong>{{ normalizerTitle() }}</strong>
              <small>{{ normalizerSubtitle() }}</small>
            </div>
            <div class="normalizer-actions">
              <button class="secondary-button" type="button" [disabled]="!canNormalizeSource() || loading()" (click)="normalizeSource()">{{ operationButtonLabel('normalize', 'Convert to Aura format') }}</button>
              <button class="ghost-button" type="button" [disabled]="!normalizerResult() || loading()" (click)="downloadNormalizedPackage()">Download package</button>
              <span>{{ normalizedPackageSizeLabel() }}</span>
            </div>
          </div>
          <div class="normalizer-files" *ngIf="normalizerFiles().length">
            <article *ngFor="let item of normalizerFiles().slice(0, 6)">
              <strong>{{ item.resource }}</strong>
              <small>{{ item.rows }} rows</small>
            </article>
          </div>

          <div class="normalizer-card" *ngIf="commandCenterReport() || resumableOpenSessions().length">
            <div>
              <span>Advanced Command Center</span>
              <strong>{{ commandCenterReport()?.simulator?.estimatedImportRows || summary()?.validRows || 0 }} rows ready</strong>
              <small>{{ commandCenterReport()?.simulator?.readyBranches || 0 }}/{{ commandCenterReport()?.simulator?.branchCount || 0 }} branches clear - {{ resumableOpenSessions().length }} resumable uploads</small>
            </div>
            <div class="normalizer-actions">
              <button class="secondary-button" type="button" [disabled]="!hasSelectedSourcePayload() || loading()" (click)="runCommandCenterScan()">Advanced scan</button>
              <button class="ghost-button" type="button" [disabled]="loading()" (click)="loadResumableUploadSessions()">Resume list</button>
              <button class="ghost-button" type="button" [disabled]="loading()" (click)="downloadBackendProofPack()">Proof pack</button>
            </div>
          </div>
          <div class="normalizer-files" *ngIf="commandCenterEntities().length || commandCenterBranches().length">
            <article *ngFor="let item of commandCenterEntities().slice(0, 4)">
              <strong>{{ item.resource }}</strong>
              <small>{{ item.total || 0 }} rows - {{ item.errors || 0 }} errors</small>
            </article>
            <article *ngFor="let branch of commandCenterBranches().slice(0, 4)">
              <strong>{{ branch.branchId }}</strong>
              <small>{{ branch.franchiseRisk }} - {{ branch.estimatedImportRows }} rows</small>
            </article>
          </div>

          <div class="migration-progress-panel" *ngIf="largeUploadStatus() !== 'idle'">
            <div>
              <span>{{ largeUploadLabel() }}</span>
              <strong>{{ largeUploadProgress() }}%</strong>
              <small>{{ largeUploadDetail() }}</small>
            </div>
            <div class="progress-track" aria-hidden="true"><span [style.width.%]="largeUploadProgress()"></span></div>
          </div>
          <div class="action-row">
            <button class="secondary-button" [disabled]="!hasSelectedSourcePayload() || loading()" (click)="analyze()">{{ operationButtonLabel('analyze', 'Analyze') }}</button>
            <button class="secondary-button" [disabled]="!hasSelectedSourcePayload() || loading()" (click)="dryRun()">{{ operationButtonLabel('dry-run', 'Dry run') }}</button>
            <button class="primary-button" [disabled]="!hasSelectedSourcePayload() || loading() || alreadyImportedCurrentFile()" (click)="runImport()">{{ operationButtonLabel('import', 'Final import') }}</button>
            <button class="ghost-button" type="button" [disabled]="!templateColumns().length" (click)="downloadTemplate()">Template</button>
          </div>
          <p class="estimate-text" *ngIf="hasSelectedSourcePayload()">{{ analyzeEstimateText() }}</p>
          <div class="migration-progress-panel" *ngIf="migrationProgressVisible()">
            <div>
              <span>{{ activeMigrationLabel() }}</span>
              <strong>{{ migrationProgress() }}%</strong>
              <small>{{ activeMigrationDetail() }}</small>
            </div>
            <div class="progress-track" aria-hidden="true"><span [style.width.%]="migrationProgress()"></span></div>
          </div>
          <label class="inline-toggle" *ngIf="hasCriticalErrors()">
            <input type="checkbox" [ngModel]="allowPartialLargeImport()" (ngModelChange)="allowPartialLargeImport.set($event)" />
            <span>Import valid rows only; skip {{ summary()?.errorRows || 0 }} critical rows</span>
          </label>

          <p class="success-text" *ngIf="alreadyImportedCurrentFile() && !error()">
            This source file already has an import job. Roll it back before importing again.
          </p>
          <p class="error-text" *ngIf="hasSelectedSourcePayload() && !summary() && !error()">
            Run Analyze before final import, then submit and approve it.
          </p>
          <p class="error-text" *ngIf="error()">{{ error() }}</p>
          <p class="success-text" *ngIf="message()">{{ message() }}</p>

          <div class="pipeline">
            <article *ngFor="let step of pipelineSteps()" [class.done]="step.status === 'done'" [class.active]="step.status === 'active'" [class.blocked]="step.status === 'blocked'">
              <span>{{ step.key }}</span>
              <strong>{{ step.label }}</strong>
              <small>{{ step.detail }}</small>
            </article>
          </div>
        </article>

        <aside class="panel risk-panel" *ngIf="showMigrationSection('import-blockers')">
          <div class="panel-head">
            <div>
              <h2>Import blockers</h2>
            </div>
          </div>
          <article *ngFor="let risk of riskCards()" [class.danger]="risk.tone === 'danger'" [class.warning]="risk.tone === 'warning'" [class.good]="risk.tone === 'good'">
            <span>{{ risk.label }}</span>
            <strong>{{ risk.value }}</strong>
            <small>{{ risk.detail }}</small>
          </article>
        </aside>
      </section>


      <section class="grid two">
        <article class="panel worker-panel" *ngIf="showMigrationSection('chunked-import-queue')">
          <div class="panel-head">
            <div>
              <h2>Chunked import queue</h2>
            </div>
            <span class="status-pill" [class.danger]="largeJob()?.status === 'failed'">{{ largeJob()?.status || 'Not prepared' }}</span>
          </div>
          <div class="control-strip compact">
            <article><span>Job ID</span><strong>{{ largeJob()?.id || '-' }}</strong><small>{{ largeJob()?.resumeToken || 'Create a staged job from analyzed data' }}</small></article>
            <article><span>Rows</span><strong>{{ largeJob()?.totalRows || summary()?.totalRows || 0 }}</strong><small>{{ largeJob()?.processedRows || 0 }} processed</small></article>
            <article><span>Imported</span><strong>{{ largeJob()?.importedRows || 0 }}</strong><small>{{ largeJob()?.skippedRows || 0 }} skipped</small></article>
            <article><span>Worker progress</span><strong>{{ largeJobProgress() }}%</strong><small>{{ largeJobProgressDetail() }}</small></article>
          </div>
          <p class="muted" *ngIf="largeUploadStatus() === 'complete' && largeJob()">
            Auto-created by Large Import Mode. Chunks are already staged and queued for processing.
          </p>
          <div class="worker-settings">
            <label>
              <span>Chunk size</span>
              <input type="number" min="100" max="50000" step="100" [ngModel]="largeChunkSize()" (ngModelChange)="largeChunkSize.set(numberInput($event, 5000))" />
            </label>
            <label>
              <span>Chunks per tick</span>
              <input type="number" min="1" max="100" [ngModel]="largeMaxChunks()" (ngModelChange)="largeMaxChunks.set(numberInput($event, 5))" />
            </label>
            <label class="toggle-field">
              <span>Allow partial import</span>
              <input type="checkbox" [ngModel]="allowPartialLargeImport()" (ngModelChange)="allowPartialLargeImport.set($event)" />
            </label>
          </div>
          <div class="action-row">
            <button class="secondary-button" type="button" [disabled]="!canPrepareLargeMigration() || loading()" (click)="prepareLargeMigrationJob()" *ngIf="largeUploadStatus() !== 'complete'">Prepare chunk 1</button>
            <button class="secondary-button" type="button" [disabled]="!isCsvFileSelected() || loading()" (click)="stageCsvMigrationChunks()" *ngIf="largeUploadStatus() !== 'complete'">Stage CSV chunks</button>
            <button class="primary-button" type="button" [disabled]="!largeJob() || analyzerVersionMissing() || (hasCriticalErrors() && !allowPartialLargeImport()) || !importApprovalReady() || loading()" (click)="queueLargeMigrationJob()">Queue worker</button>
            <button class="secondary-button" type="button" [disabled]="!largeJob() || analyzerVersionMissing() || (hasCriticalErrors() && !allowPartialLargeImport()) || !importApprovalReady() || loading()" (click)="runWorkerTick()">Run worker tick</button>
            <button class="ghost-button" type="button" [disabled]="!largeJob() || loading()" (click)="refreshLargeJobStatus()">Refresh</button>
            <button class="ghost-button" type="button" [disabled]="!largeJob() || loading()" (click)="pauseLargeMigrationJob()">Pause</button>
            <button class="secondary-button" type="button" [disabled]="!largeJob() || loading()" (click)="retryFailedLargeMigrationChunks()">Retry failed</button>
            <button class="danger-button" type="button" [disabled]="!largeJob() || loading()" (click)="cancelLargeMigrationJob()">Cancel</button>
            <button class="danger-button" type="button" [disabled]="!largeJob() || loading()" (click)="discardLargeMigrationJob()">Start fresh import</button>
            <button class="ghost-button" type="button" [disabled]="!largeJob() || analyzerVersionMissing() || (hasCriticalErrors() && !allowPartialLargeImport()) || !importApprovalReady() || loading()" (click)="resumeLargeMigrationJob()">Resume now</button>
          </div>
          <p class="migration-warning" *ngIf="largeJob() && analyzerVersionMissing()">Fresh analyzer did not run. Please restart API or check backend route.</p>
          <div class="fresh-start-banner" *ngIf="largeJobNeedsFreshStart()">
            <span>⚠ Old analyzer / cached job detected. Start fresh import required.</span>
            <button class="danger-button" type="button" [disabled]="loading()" (click)="discardLargeMigrationJob()">Start fresh import</button>
          </div>
          <div class="diag-panel" *ngIf="largeJob() || analyzerDiagnostics()">
            <div class="diag-head">
              <strong>Analyzer Diagnostics</strong>
              <span class="diag-badge" [class.warn]="analyzerVersionMissing()">{{ analyzerDiagnostics()?.analyzerFixVersion || 'version missing' }}</span>
            </div>
            <p class="diag-stale" *ngIf="analyzerVersionMissing()">Old analyzer / cached job detected. Start fresh import required.</p>
            <div class="diag-grid">
              <span>Job ID</span><strong>{{ analyzerDiagnostics()?.jobId || largeJob()?.id || '-' }}</strong>
              <span>Job created</span><strong>{{ largeJob()?.createdAt ? (largeJob()?.createdAt | auraDate:'date') : '-' }}</strong>
              <span>Analyzed at</span><strong>{{ analyzerDiagnostics()?.generatedAt ? (analyzerDiagnostics()?.generatedAt | auraDate:'date') : '-' }}</strong>
              <span>Analyzer version</span><strong [class.bad]="analyzerVersionMissing()">{{ analyzerDiagnostics()?.analyzerFixVersion || 'missing' }}</strong>
              <span>Adapter</span><strong>{{ analyzerDiagnostics()?.adapter || '-' }}</strong>
              <span>Source</span><strong>{{ analyzerDiagnostics()?.sourceSoftware || '-' }}</strong>
              <span>Large mode</span><strong>{{ analyzerDiagnostics()?.largeMode ? 'true' : 'false' }}</strong>
              <span>Cross-chunk refs</span><strong>{{ analyzerDiagnostics()?.crossChunkReferencesLoaded ?? 0 }}</strong>
              <span>Payment→invoice unresolved</span><strong [class.bad]="(analyzerDiagnostics()?.paymentInvoiceUnresolved || 0) > 0">{{ analyzerDiagnostics()?.paymentInvoiceUnresolved ?? 0 }}</strong>
              <span>Client phone missing</span><strong>{{ analyzerDiagnostics()?.clientPhoneMissing ?? 0 }}</strong>
              <span>Diagnostics source</span><strong>{{ diagnosticsSource() }}</strong>
            </div>
          </div>
          <p class="muted" *ngIf="!importApprovalReady()">Approval required for this exact upload/job.</p>
          <p class="migration-warning" *ngIf="largePendingChunks()">{{ largePendingChunks() }} chunk(s) still need analysis. Queue/resume is blocked unless partial import is enabled.</p>
          <div class="chunk-list" *ngIf="largeJobChunks().length">
            <article *ngFor="let chunk of largeJobChunks()" [class.done]="chunk.status === 'imported' || chunk.status === 'imported_with_errors' || chunk.status === 'skipped_with_errors'" [class.danger]="chunk.status === 'failed'">
              <strong>Chunk {{ chunk.chunkNumber }}</strong>
              <span>{{ chunk.status }}</span>
              <small>{{ chunk.importedRows || 0 }}/{{ chunk.totalRows || 0 }} imported · {{ chunk.errorRows || 0 }} errors</small>
            </article>
          </div>
        </article>

        <article class="panel proof-panel" *ngIf="showMigrationSection('reconciliation-sign-off')">
          <div class="panel-head">
            <div>
              <h2>Reconciliation sign-off</h2>
            </div>
            <span class="status-pill" [class.danger]="latestLargeReconciliation()?.status === 'warning' || reconciliationResult()?.mismatchCount">{{ proofStatus() }}</span>
          </div>
          <div class="proof-grid">
            <article>
              <span>Snapshot</span>
              <strong>{{ latestLargeReconciliation()?.id || reconciliationResult()?.fileName || '-' }}</strong>
              <small>{{ latestLargeReconciliation()?.snapshotType || (reconciliationResult() ? 'Direct import reconciliation' : 'Run proof check after import') }}</small>
            </article>
            <article>
              <span>Differences</span>
              <strong>{{ latestLargeReconciliation() ? largeReconciliationDifferences().length : reconciliationResult()?.mismatchCount || 0 }}</strong>
              <small>{{ latestLargeReconciliation()?.createdAt || (reconciliationResult() ? 'Direct check completed' : 'No audit snapshot yet') }}</small>
            </article>
          </div>
          <div class="action-row">
            <button class="primary-button" type="button" [disabled]="(!largeJob() && !hasSelectedSourcePayload()) || loading()" (click)="runProofCheck()">Run proof check</button>
            <button class="ghost-button" type="button" [disabled]="!largeJob() || loading()" (click)="refreshLargeJobStatus()">Refresh proof</button>
            <button class="secondary-button" type="button" [disabled]="(!latestLargeReconciliation() && !reconciliationResult()) || loading()" (click)="downloadProofReport()">Export proof</button>
          </div>
          <div class="checklist compact-checklist">
            <label *ngFor="let item of largeMigrationChecklist()">
              <input type="checkbox" [checked]="item.done" disabled />
              <span>{{ item.label }}</span>
            </label>
            <label>
              <input type="checkbox" [checked]="!!latestLargeReconciliation() || !!reconciliationResult()" disabled />
              <span>Reconciliation proof available</span>
            </label>
          </div>
          <div class="result-box" *ngIf="lastWorkerResult()">
            <span>Last worker result</span>
            <strong>{{ lastWorkerResult()?.checkedJobs || lastWorkerResult()?.processedChunks || 0 }} unit(s) processed</strong>
            <small>{{ lastWorkerResultText() }}</small>
          </div>
          <div class="difference-list" *ngIf="largeReconciliationDifferences().length; else noLargeReconDiffs">
            <article *ngFor="let diff of largeReconciliationDifferences()" [class.danger]="diff.severity === 'critical'">
              <strong>{{ diff.code || 'difference' }}</strong>
              <span>{{ diff.message || 'Review this migration proof difference.' }}</span>
              <small>{{ diff.resource || 'all resources' }} · expected {{ diff.expected ?? '-' }} · actual {{ diff.actual ?? '-' }}</small>
            </article>
          </div>
          <ng-template #noLargeReconDiffs>
            <div class="difference-list" *ngIf="reconciliationLines().length; else noDirectReconDiffs">
              <article *ngFor="let line of reconciliationLines()" [class.danger]="line.status === 'mismatch'">
                <strong>{{ line.metric }}</strong>
                <span>{{ line.status === 'mismatch' ? 'Review expected vs actual value.' : 'Direct reconciliation line checked.' }}</span>
                <small>Expected {{ line.expected ?? 'not set' }} · actual {{ line.actual }} · diff {{ line.difference ?? '-' }}</small>
              </article>
            </div>
          </ng-template>
          <ng-template #noDirectReconDiffs>
            <p class="muted">No proof differences recorded for the latest snapshot.</p>
          </ng-template>
        </article>
      </section>

      <section class="grid three">
        <article class="panel" *ngIf="showMigrationSection('field-confidence-saved-profiles')">
          <div class="panel-head">
            <div>
              <h2>Field confidence & saved profiles</h2>
            </div>
            <span class="status-pill">{{ mappingCoverage() }}% mapped</span>
          </div>
          <div class="mapping-toolbar">
            <select [(ngModel)]="selectedMappingId" (ngModelChange)="applySavedMapping($event)">
              <option value="">New AI mapping draft</option>
              <option *ngFor="let mapping of relevantMappings()" [value]="mapping.id">{{ mapping.name || mapping.resource }}</option>
            </select>
            <button class="secondary-button" type="button" [disabled]="!mappingDraft().length || loading()" (click)="saveMappingProfile()">Save profile</button>
          </div>
          <div class="mapping-list">
            <article *ngFor="let row of mappingDraftPreview()" [class.required]="row.required">
              <div>
                <strong>{{ row.targetField }}</strong>
                <small>{{ row.aliases.slice(0, 3).join(', ') || 'No alias' }}</small>
              </div>
              <input [ngModel]="row.sourceColumn" (ngModelChange)="setMappingSource(row.targetField, $event)" placeholder="Source column" />
              <span>{{ row.confidence }}%</span>
            </article>
            <p class="muted" *ngIf="!templateColumns().length">Select a resource to inspect required fields.</p>
          </div>
        </article>

        <article class="panel" *ngIf="showMigrationSection('detected-modules')">
          <div class="panel-head">
            <div>
              <h2>Detected modules</h2>
            </div>
          </div>
          <div class="entity-stack">
            <article *ngFor="let row of entityRows()">
              <strong>{{ label(row.entity) }}</strong>
              <span>{{ row.valid }}/{{ row.total }} valid</span>
              <meter min="0" [max]="row.total || 1" [value]="row.valid"></meter>
              <small>{{ row.errors }} errors - {{ row.duplicates }} duplicates</small>
            </article>
            <p class="muted" *ngIf="!entityRows().length">Analyze a file to see entity coverage.</p>
          </div>
        </article>

        <article class="panel" *ngIf="showMigrationSection('old-vs-aura-checks')">
          <div class="panel-head">
            <div>
              <h2>Old vs Aura checks</h2>
            </div>
          </div>
          <div class="recon-list">
            <article *ngFor="let row of reconciliationRows()">
              <span>{{ row.label }}</span>
              <strong>{{ row.value }}</strong>
              <small>{{ row.detail }}</small>
            </article>
          </div>
        </article>
      </section>

      <section class="grid two">
        <article class="panel" *ngIf="showMigrationSection('expected-totals-analyzed-data')">
          <div class="panel-head">
            <div>
              <h2>Expected totals vs analyzed data</h2>
            </div>
            <span class="status-pill" [class.danger]="reconciliationResult()?.mismatchCount">{{ reconciliationResult()?.matched ? 'Matched' : reconciliationResult() ? 'Mismatch' : 'Not run' }}</span>
          </div>
          <div class="expected-grid">
            <label *ngFor="let metric of expectedMetrics">
              <span>{{ metric.label }}</span>
              <input type="number" min="0" [ngModel]="expectedTotals()[metric.key] || ''" (ngModelChange)="setExpectedTotal(metric.key, $event)" />
            </label>
          </div>
          <div class="action-row">
            <button class="secondary-button" type="button" [disabled]="!hasSelectedSourcePayload() || loading()" (click)="runReconciliation()">Run reconciliation</button>
            <button class="ghost-button" type="button" [disabled]="!reconciliationResult()" (click)="clearReconciliation()">Clear</button>
          </div>
          <div class="reconcile-table" *ngIf="reconciliationLines().length">
            <article *ngFor="let line of reconciliationLines()" [class.mismatch]="line.status === 'mismatch'" [class.match]="line.status === 'match'">
              <span>{{ line.metric }}</span>
              <strong>{{ line.actual }}</strong>
              <small>Expected {{ line.expected ?? 'not set' }} · Diff {{ line.difference ?? '-' }}</small>
            </article>
          </div>
        </article>

        <article class="panel" *ngIf="showMigrationSection('owner-sign-off-workflow')">
          <div class="panel-head">
            <div>
              <h2>Owner sign-off workflow</h2>
            </div>
            <button class="secondary-button" type="button" [disabled]="loading()" (click)="loadApprovals()">Refresh</button>
          </div>
          <label>
            <span>Approval note</span>
            <textarea [(ngModel)]="approvalNote" rows="3" placeholder="Summary, risk notes, branch sign-off, reconciliation evidence"></textarea>
          </label>
          <div class="action-row">
            <button class="primary-button" type="button" [disabled]="!summary() || hasBlockingCriticalErrors() || loading()" (click)="submitApproval()">Submit for approval</button>
            <button class="ghost-button" type="button" [disabled]="!latestPendingApproval() || loading()" (click)="decideApproval(latestPendingApproval()?.id || '', 'approved')">Approve latest</button>
            <button class="danger-button" type="button" [disabled]="!latestPendingApproval() || loading()" (click)="decideApproval(latestPendingApproval()?.id || '', 'rejected')">Reject latest</button>
          </div>
          <p class="error-text" *ngIf="hasSelectedSourcePayload() && !summary()">
            Analyze must run before approval.
          </p>
          <p class="success-text" *ngIf="summary() && !latestPendingApproval() && !importApprovalReady()">
            Analyze is complete. Submit approval for this exact upload/job.
          </p>
          <p class="error-text" *ngIf="approvalDebug()">{{ approvalDebug() }}</p>
          <div class="approval-list">
            <article *ngFor="let approval of recentApprovals()" [class.pending]="approval.status === 'pending'" [class.approved]="approval.status === 'approved'" [class.rejected]="approval.status === 'rejected'">
              <div>
                <strong>{{ approval.status | titlecase }} · {{ approval.resource || 'migration' }}</strong>
                <small>{{ approval.submittedAt | auraDate:'date' }} {{ approval.reviewedAt ? '· reviewed ' + (approval.reviewedAt | auraDate:'date') : '' }}</small>
              </div>
              <span>{{ approval.note || 'No note' }}</span>
            </article>
            <p class="muted" *ngIf="!approvals().length">No approval requests yet.</p>
          </div>
        </article>
      </section>

      <section class="grid two">
        <article class="panel" *ngIf="showMigrationSection('client-invoice-source-collisions')">
          <div class="panel-head">
            <div>
              <h2>Client, invoice & source collisions</h2>
            </div>
            <span class="status-pill">{{ duplicateDecisionCount() }}/{{ duplicateRows().length }} decided</span>
          </div>
          <div class="duplicate-list">
            <article *ngFor="let row of duplicatePreviewRows()">
              <div>
                <strong>{{ label(row.entity || 'record') }} row {{ row.sourceRowNumber || '-' }}</strong>
                <small>{{ row.message || row.sourceExternalId || row.targetId || 'Possible duplicate' }}</small>
              </div>
              <div class="decision-actions">
                <button type="button" [class.active]="duplicateDecision(row) === 'merge'" (click)="setDuplicateDecision(row, 'merge')">Merge</button>
                <button type="button" [class.active]="duplicateDecision(row) === 'keep'" (click)="setDuplicateDecision(row, 'keep')">Keep</button>
                <button type="button" [class.active]="duplicateDecision(row) === 'link'" (click)="setDuplicateDecision(row, 'link')">Link</button>
              </div>
            </article>
            <p class="muted" *ngIf="!duplicateRows().length">No duplicate rows in the current preview.</p>
          </div>
        </article>

        <article class="panel" *ngIf="showMigrationSection('fix-priorities')">
          <div class="panel-head">
            <div>
              <h2>Fix priorities</h2>
            </div>
          </div>
          <div class="ops-queue">
            <button type="button" *ngFor="let item of validationQueues()" [class.danger]="item.status === 'error'" [class.warning]="item.status === 'warning'" [class.active]="rowFilter() === item.status" (click)="rowFilter.set(item.status)">
              <span>{{ item.label }}</span>
              <strong>{{ item.count }}</strong>
              <small>{{ item.detail }}</small>
            </button>
          </div>
        </article>
      </section>

      <section class="grid two">
        <article class="panel" *ngIf="!activeMigrationSection() && previewRows().length">
          <div class="panel-head">
            <div>
              <h2>First 500 row decisions</h2>
            </div>
            <div class="segmented">
              <button [class.active]="rowFilter() === 'all'" (click)="rowFilter.set('all')">All</button>
              <button [class.active]="rowFilter() === 'error'" (click)="rowFilter.set('error')">Errors</button>
              <button [class.active]="rowFilter() === 'warning'" (click)="rowFilter.set('warning')">Warnings</button>
              <button [class.active]="rowFilter() === 'duplicate'" (click)="rowFilter.set('duplicate')">Duplicates</button>
            </div>
          </div>
          <div class="table-wrap dense">
            <table>
              <thead>
                <tr>
                  <th>Sheet</th>
                  <th>Row</th>
                  <th>Entity</th>
                  <th>Status</th>
                  <th>Decision</th>
                  <th>Target/source</th>
                </tr>
              </thead>
              <tbody>
                <tr *ngFor="let row of filteredPreviewRows()">
                  <td>{{ row.sourceSheet }}</td>
                  <td>{{ row.sourceRowNumber }}</td>
                  <td>{{ row.entity }}</td>
                  <td><span class="badge" [class.danger]="row.status === 'error'" [class.warning]="row.status === 'warning'">{{ row.status }}</span></td>
                  <td>{{ row.message }}</td>
                  <td>{{ row.sourceExternalId || row.targetId }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </article>

        <article class="panel" *ngIf="showMigrationSection('sign-off-controls')">
          <div class="panel-head">
            <div>
              <h2>Sign-off controls</h2>
            </div>
          </div>
          <div class="checklist">
            <label *ngFor="let item of completionChecklist()">
              <input type="checkbox" [checked]="item.done" disabled />
              <span>{{ item.label }}</span>
            </label>
          </div>
          <div class="rollback-zone">
            <strong>Emergency rollback</strong>
            <span>Last import, job-wise rollback and batch-level audit are available from the same migration ledger.</span>
            <label>
              <span>Rollback reason</span>
              <textarea [ngModel]="rollbackReason()" (ngModelChange)="rollbackReason.set($event)" rows="2" placeholder="Why rollback is required?"></textarea>
            </label>
            <button class="danger-button" [disabled]="loading() || !jobs().length" (click)="rollbackLast()">Rollback last import</button>
          </div>
        </article>
      </section>


      <section class="grid two">
        <article class="panel" *ngIf="showMigrationSection('quality-sandbox-approval-gate')">
          <div class="panel-head">
            <div>
              <h2>Quality, sandbox & approval gate</h2>
            </div>
            <span class="status-pill" [class.danger]="dataQualityScore() < 60">{{ dataQualityScore() }}% quality</span>
          </div>
          <div class="control-strip compact">
            <article><span>Mode</span><strong>{{ sandboxMode() ? 'Sandbox' : 'Live' }}</strong></article>
            <article><span>Approval gate</span><strong>{{ importApprovalReady() ? 'Approved' : 'Blocked' }}</strong></article>
            <article><span>Progress</span><strong>{{ migrationProgress() }}%</strong><small>{{ progressLabel() }}</small></article>
            <article><span>PII preview</span><strong>{{ maskPreviewPii() ? 'Masked' : 'Visible' }}</strong></article>
          </div>
          <div class="action-row">
            <button class="secondary-button" type="button" (click)="sandboxMode.set(!sandboxMode())">{{ sandboxMode() ? 'Switch to live mode' : 'Switch to sandbox mode' }}</button>
            <button class="secondary-button" type="button" (click)="maskPreviewPii.set(!maskPreviewPii())">{{ maskPreviewPii() ? 'Show PII preview' : 'Mask PII preview' }}</button>
            <button class="ghost-button" type="button" [disabled]="!hasSelectedSourcePayload() || loading()" (click)="exportFailedRows()">Export error Excel</button>
            <button class="ghost-button" type="button" [disabled]="!previewRows().length" (click)="exportPreviewSummary()">Export preview summary</button>
          </div>
          <div class="checklist">
            <label *ngFor="let item of enterpriseChecklist()">
              <input type="checkbox" [checked]="item.done" disabled />
              <span>{{ item.label }}</span>
            </label>
          </div>
        </article>

        <article class="panel" *ngIf="showMigrationSection('ask-why-rows-failed')">
          <div class="panel-head">
            <div>
              <h2>Ask why rows failed</h2>
            </div>
          </div>
          <label>
            <span>Ask migration assistant</span>
            <textarea [ngModel]="assistantQuestion()" (ngModelChange)="assistantQuestion.set($event)" rows="3" placeholder="Example: kyu 50 rows fail hui?"></textarea>
          </label>
          <div class="action-row">
            <button class="primary-button" type="button" [disabled]="!previewRows().length" (click)="askMigrationAssistant()">Ask assistant</button>
            <button class="ghost-button" type="button" [disabled]="!assistantAnswer()" (click)="assistantAnswer.set('')">Clear</button>
          </div>
          <div class="result-box" *ngIf="assistantAnswer()">
            <strong>Assistant answer</strong>
            <span>{{ assistantAnswer() }}</span>
          </div>
          <div class="ops-queue">
            <button type="button" *ngFor="let item of anomalyCards()" [class.danger]="item.tone === 'danger'" [class.warning]="item.tone === 'warning'">
              <span>{{ item.label }}</span>
              <strong>{{ item.count }}</strong>
              <small>{{ item.detail }}</small>
            </button>
          </div>
        </article>
      </section>

      <section class="panel" *ngIf="showMigrationSection('jobs-audits-rollback-history')">
        <div class="panel-head">
          <div>
            <h2>Jobs, audits and rollback history</h2>
          </div>
          <button class="secondary-button" (click)="loadJobs()" [disabled]="loading()">Refresh</button>
        </div>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Created</th>
                <th>Source</th>
                <th>File</th>
                <th>Status</th>
                <th>Total</th>
                <th>Imported</th>
                <th>Errors</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              <tr *ngFor="let job of jobs()" [class.selected]="selectedJob()?.id === job.id">
                <td>{{ job.createdAt | auraDate:'date' }}</td>
                <td>{{ job.sourceSoftware }}</td>
                <td>{{ job.fileName }}</td>
                <td><span class="badge">{{ job.status }}</span></td>
                <td>{{ job.totalRows }}</td>
                <td>{{ job.importedRows }}</td>
                <td>{{ job.errorRows }}</td>
                <td>
                  <button class="secondary-button" type="button" [disabled]="loading()" (click)="loadJobDetail(job.id)">Open</button>
                  <button class="ghost-button" type="button" [disabled]="loading()" (click)="loadJobRecovery(job.id)">Recovery</button>
                  <button class="danger-button" [disabled]="job.status === 'rolled_back' || loading()" (click)="rollback(job.id)">Rollback</button>
                </td>
              </tr>
              <tr *ngIf="!jobs().length"><td colspan="8">No migration jobs yet.</td></tr>
            </tbody>
          </table>
        </div>
        <div class="job-detail" *ngIf="selectedJob() as job">
          <div class="panel-head">
            <div>
              <h2>{{ job.fileName || job.id }}</h2>
            </div>
            <div class="action-row tight">
              <button class="secondary-button" type="button" [disabled]="loading()" (click)="loadJobRecovery(job.id)">Recovery</button>
              <button class="ghost-button" type="button" [disabled]="!selectedJobRecovery()" (click)="exportRecoveryReport()">Export recovery</button>
              <button class="ghost-button" type="button" (click)="closeJobDetail()">Close</button>
            </div>
          </div>
          <div class="control-strip compact">
            <article><span>Total</span><strong>{{ job.totalRows }}</strong></article>
            <article><span>Imported</span><strong>{{ job.importedRows }}</strong></article>
            <article><span>Errors</span><strong>{{ job.errorRows }}</strong></article>
            <article><span>Status</span><strong>{{ job.status }}</strong><small>{{ job.sourceSoftware }}</small></article>
          </div>
          <div class="table-wrap dense" *ngIf="job.rows?.length">
            <table>
              <thead><tr><th>Sheet</th><th>Row</th><th>Entity</th><th>Status</th><th>Message</th></tr></thead>
              <tbody>
                <tr *ngFor="let row of selectedJobRows()">
                  <td>{{ row.sourceSheet }}</td>
                  <td>{{ row.sourceRowNumber }}</td>
                  <td>{{ row.entity }}</td>
                  <td><span class="badge" [class.danger]="row.status === 'error'" [class.warning]="row.status === 'warning'">{{ row.status }}</span></td>
                  <td>{{ row.message }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
          <div class="recovery-panel" *ngIf="selectedJobRecovery() as recovery">
            <div class="panel-head">
              <div>
                <h2>{{ recovery.status | titlecase }}</h2>
              </div>
              <span class="status-pill" [class.danger]="recovery.blockers.length">{{ recovery.blockers.length || 0 }} blocker(s)</span>
            </div>
            <div class="recovery-grid">
              <article><span>Failed rows</span><strong>{{ recovery.summary.failedRows }}</strong><small>{{ recovery.summary.retryCandidates }} retry candidates</small></article>
              <article><span>Warnings</span><strong>{{ recovery.summary.warningRows }}</strong></article>
              <article><span>Missing targets</span><strong>{{ recovery.summary.missingLiveTargets }}</strong></article>
              <article><span>Rollback batches</span><strong>{{ recovery.rollbackPlan?.batches?.length || 0 }}</strong><small>{{ recovery.rollbackPlan?.recommended ? 'Rollback recommended' : 'Rollback optional' }}</small></article>
            </div>
            <div class="action-row">
              <button class="secondary-button" type="button" [disabled]="!recoveryFailedRows().length" (click)="exportRecoveryFailedRows()">Export failed rows</button>
              <button class="danger-button" type="button" [disabled]="!recovery.rollbackPlan?.recommended || loading()" (click)="rollbackRecoveryJob()">Rollback affected job</button>
            </div>
            <div class="recovery-list" *ngIf="recoveryNextActions().length">
              <article *ngFor="let action of recoveryNextActions(); let i = index">
                <strong>{{ i + 1 }}</strong>
                <span>{{ action }}</span>
              </article>
            </div>
            <div class="table-wrap dense" *ngIf="recoveryFailedRows().length">
              <table>
                <thead><tr><th>Row</th><th>Resource</th><th>Legacy ID</th><th>Reason</th><th>Action</th></tr></thead>
                <tbody>
                  <tr *ngFor="let row of recoveryFailedRows()">
                    <td>{{ row.rowKey }}</td>
                    <td>{{ row.resource }}</td>
                    <td>{{ row.sourceExternalId || '-' }}</td>
                    <td>{{ row.message }}</td>
                    <td>{{ row.retryReason }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
      </section>
    </section>
  `,
  styles: [`
    :host { display: block; }
    .migration-shell { display: grid; grid-template-columns: minmax(260px, 320px) minmax(0, 1fr); gap: 18px 14px; align-items: start; color: #172033; }
    .migration-shell:not(.child-page-active) .migration-page-detail { display: none; }
    .migration-shell.migration-section-mode .migration-page-detail { display: none; }
    .migration-shell.migration-section-mode .workspace-grid, .migration-shell.migration-section-mode .grid.two, .migration-shell.migration-section-mode .grid.three { grid-template-columns: 1fr; }
    .migration-page-workspace { display: contents; }
    .command-header, .control-strip { grid-column: 1 / -1; }
    .migration-shell > :not(.command-header):not(.control-strip):not(.migration-page-workspace) { grid-column: 2; }
    .migration-side-nav { grid-column: 1; grid-row: 3 / span 80; position: sticky; top: 92px; display: grid; gap: 10px; align-self: start; }
    .migration-nav-card { display: grid; grid-template-columns: 44px minmax(0, 1fr) auto; gap: 11px; align-items: center; min-height: 92px; padding: 13px; border: 1px solid #d7e6e2; border-left: 4px solid #55173D; border-radius: 8px; background: #fff; color: #172033; text-decoration: none; box-shadow: 0 12px 26px rgba(15,23,42,.07); cursor: pointer; }
    .migration-nav-card:hover, .migration-nav-card.active { background: #F8EEF4; border-color: #D4C0CF; transform: translateY(-1px); }
    .migration-nav-icon { display: grid; place-items: center; width: 44px; height: 44px; border-radius: 8px; background: #F8EEF4; color: #3D0F2C; font-weight: 950; font-size: 12px; }
    .migration-nav-card strong, .migration-nav-card small { display: block; }
    .migration-nav-card small { margin-top: 4px; color: #64748b; font-size: 12px; font-weight: 700; line-height: 1.3; }
    .migration-nav-card em { align-self: start; padding: 4px 7px; border-radius: 999px; background: #F8EEF4; color: #3D0F2C; font-size: 10px; font-style: normal; font-weight: 900; text-transform: uppercase; }
    .migration-page-detail { grid-column: 2; min-width: 0; display: block; }
    .migration-page-detail .migration-shell { padding: 0; }
    .command-header { display: grid; grid-template-columns: minmax(0, 1fr) 220px; gap: 18px; align-items: stretch; padding: 22px; border: 1px solid #d7e6e2; border-radius: 8px; background: linear-gradient(120deg, #faf8f6, #ffffff 62%, #F8EEF4); box-shadow: 0 18px 40px rgba(15,23,42,.08); }
    .command-header h1 { margin: 6px 0; font-size: 34px; line-height: 1.05; letter-spacing: 0; }
    .command-header p { margin: 0; max-width: 900px; color: #64748b; font-size: 15px; line-height: 1.55; }
    .eyebrow { color: #4B1238; font-size: 12px; font-weight: 900; letter-spacing: .04em; text-transform: uppercase; }
    .score-card, .control-strip article, .panel, .pipeline article, .risk-panel article, .mapping-list article, .entity-stack article, .recon-list article { border: 1px solid #d7e6e2; border-radius: 8px; background: #ffffff; }
    .score-card { display: grid; align-content: center; gap: 6px; padding: 18px; }
    .score-card strong { font-size: 42px; line-height: 1; }
    .score-card span, .control-strip span, .panel-head span, .risk-panel span, .recon-list span { color: #64748b; font-size: 12px; font-weight: 900; text-transform: uppercase; }
    .score-card small, .control-strip small, .risk-panel small, .recon-list small { color: #64748b; }
    .score-card.warning { border-color: #f59e0b; background: #fffbeb; }
    .score-card.danger { border-color: #ef4444; background: #fef2f2; }
    .control-strip { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; }
    .control-strip article { padding: 14px; display: grid; gap: 4px; min-width: 0; }
    .control-strip strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .workspace-grid { display: grid; grid-template-columns: minmax(0, 1.65fr) minmax(260px, .65fr); gap: 14px; align-items: start; }
    .grid { display: grid; gap: 14px; }
    .grid.two { grid-template-columns: minmax(0, 1.2fr) minmax(320px, .8fr); }
    .grid.three { grid-template-columns: repeat(3, minmax(0, 1fr)); }
    .panel { padding: 18px; min-width: 0; }
    .panel-head { display: flex; justify-content: space-between; gap: 12px; align-items: center; margin-bottom: 14px; }
    .panel-head h2 { margin: 3px 0 0; font-size: 20px; letter-spacing: 0; }
    .status-pill, .badge { border-radius: 999px; background: #F8EEF4; color: #4B1238; padding: 6px 10px; font-size: 12px; font-weight: 900; white-space: nowrap; }
    .status-pill.danger { background: #fef2f2; color: #b91c1c; }
    .badge.warning { background: #fffbeb; color: #b45309; }
    .badge.danger { background: #fef2f2; color: #b91c1c; }
    .form-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
    label { display: grid; gap: 6px; color: #64748b; font-size: 12px; font-weight: 900; text-transform: uppercase; }
    input, select, textarea { width: 100%; min-height: 42px; border: 1px solid #cfe0dc; border-radius: 8px; background: #faf8f6; padding: 10px 11px; color: #172033; font-weight: 800; box-sizing: border-box; }
    input:focus, select:focus, textarea:focus { border-color: #5A153F; outline: 3px solid rgba(90,21,63,.14); background: #ffffff; }
    textarea { resize: vertical; font-family: inherit; text-transform: none; }
    .file-drop { grid-column: 1 / -1; border: 1px dashed #C8A0B8; border-radius: 8px; padding: 12px; background: #f8fbff; }
    .file-drop small, .muted { color: #64748b; text-transform: none; font-weight: 700; }
    .migration-warning { margin: 10px 0 0; border: 1px solid #f59e0b; border-radius: 8px; background: #fffbeb; color: #92400e; padding: 10px 12px; font-weight: 900; }
    .inline-toggle { display: inline-flex; align-items: center; gap: 8px; margin: 0 0 4px; color: #92400e; font-size: 13px; font-weight: 900; text-transform: none; }
    .inline-toggle input { width: 18px; min-height: 18px; padding: 0; }
    .toggle-field { grid-template-columns: minmax(0, 1fr) auto; align-items: center; }
    .toggle-field input { width: 20px; min-height: 20px; padding: 0; }
    .action-row { display: flex; flex-wrap: wrap; gap: 10px; margin: 14px 0; }
    .estimate-text { margin: -4px 0 12px; border: 1px solid #d7e6e2; border-radius: 8px; background: #faf8f6; color: #475569; padding: 10px 12px; font-size: 13px; font-weight: 800; line-height: 1.45; }
    .normalizer-card { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 12px; align-items: center; margin-top: 12px; border: 1px solid #cfe0dc; border-radius: 8px; background: #faf8f6; padding: 12px; }
    .normalizer-card span, .migration-progress-panel span { color: #64748b; font-size: 12px; font-weight: 900; text-transform: uppercase; }
    .normalizer-card strong, .migration-progress-panel strong { display: block; margin-top: 4px; }
    .normalizer-card small, .migration-progress-panel small { color: #64748b; font-weight: 700; }
    .normalizer-actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 8px; align-items: center; }
    .normalizer-actions > span { min-width: 56px; color: #64748b; font-size: 12px; font-weight: 900; text-align: right; }
    .normalizer-files { display: grid; grid-template-columns: repeat(auto-fit, minmax(110px, 1fr)); gap: 8px; margin-top: 8px; }
    .normalizer-files article { border: 1px solid #d7e6e2; border-radius: 8px; background: #ffffff; padding: 9px; min-width: 0; }
    .normalizer-files strong { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13px; }
    .normalizer-files small { color: #64748b; }
    .migration-progress-panel { display: grid; gap: 10px; margin: 6px 0 12px; border: 1px solid #E7DDD6; border-radius: 8px; background: #F8EEF4; padding: 12px; }
    .migration-progress-panel > div:first-child { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 4px 12px; align-items: center; }
    .migration-progress-panel small { grid-column: 1 / -1; }
    .progress-track { height: 10px; border-radius: 999px; background: #F8EEF4; overflow: hidden; }
    .progress-track span { display: block; height: 100%; min-width: 4px; border-radius: inherit; background: linear-gradient(90deg, #4B1238, #6B1E4B); transition: width .25s ease; }
    button { min-height: 40px; border: 1px solid #cfe0dc; border-radius: 8px; padding: 0 14px; font-weight: 900; cursor: pointer; background: #ffffff; color: #172033; }
    button:disabled { opacity: .55; cursor: not-allowed; }
    .primary-button { background: #5A153F; color: #ffffff; border-color: #5A153F; }
    .secondary-button { background: #F8EEF4; color: #4B1238; border-color: #E7DDD6; }
    .ghost-button { background: #ffffff; }
    .danger-button { background: #fef2f2; color: #b91c1c; border-color: #fecaca; }
    .success-text, .error-text { margin: 8px 0 0; font-weight: 900; }
    .success-text { color: #7A4A28; }
    .error-text { color: #b91c1c; }
    .pipeline { display: grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap: 8px; margin-top: 14px; }
    .pipeline article { padding: 10px; display: grid; gap: 3px; border-left: 4px solid #cbd5e1; }
    .pipeline article.done { border-left-color: #C87D4B; background: #FBF0E8; }
    .pipeline article.active { border-left-color: #4B1238; background: #F8EEF4; }
    .pipeline article.blocked { border-left-color: #ef4444; background: #fef2f2; }
    .pipeline strong { font-size: 13px; }
    .pipeline small { color: #64748b; }
    .risk-panel { display: grid; gap: 10px; }
    .risk-panel .panel-head { margin-bottom: 0; }
    .risk-panel article { padding: 12px; display: grid; gap: 4px; border-left: 4px solid #94a3b8; }
    .risk-panel article.good { border-left-color: #C87D4B; }
    .risk-panel article.warning { border-left-color: #f59e0b; background: #fffbeb; }
    .risk-panel article.danger { border-left-color: #ef4444; background: #fef2f2; }
    .risk-panel strong { font-size: 24px; }
    .mapping-list, .entity-stack, .recon-list, .checklist { display: grid; gap: 8px; }
    .mapping-toolbar { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 8px; margin-bottom: 10px; }
    .mapping-list article { display: grid; grid-template-columns: minmax(120px, 1fr) minmax(120px, 1fr) auto; align-items: center; gap: 12px; padding: 10px; }
    .mapping-list article.required { border-color: #E7DDD6; background: #F8EEF4; }
    .mapping-list strong, .entity-stack strong { display: block; }
    .mapping-list small, .entity-stack small { color: #64748b; }
    .mapping-list article > span { color: #4B1238; font-size: 12px; font-weight: 900; }
    .mapping-list input { min-height: 36px; }
    .duplicate-list, .ops-queue { display: grid; gap: 8px; }
    .duplicate-list article { border: 1px solid #d7e6e2; border-radius: 8px; padding: 10px; display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 10px; align-items: center; }
    .duplicate-list small { color: #64748b; }
    .decision-actions { display: inline-flex; border: 1px solid #cfe0dc; border-radius: 8px; overflow: hidden; }
    .decision-actions button { border: 0; border-radius: 0; min-height: 34px; }
    .decision-actions button.active { background: #5A153F; color: #ffffff; }
    .ops-queue { grid-template-columns: repeat(3, minmax(0, 1fr)); }
    .ops-queue button { min-height: 92px; display: grid; gap: 4px; align-content: center; text-align: left; border-left: 4px solid #94a3b8; }
    .ops-queue button.warning { border-left-color: #f59e0b; background: #fffbeb; }
    .ops-queue button.danger { border-left-color: #ef4444; background: #fef2f2; }
    .ops-queue button.active { outline: 3px solid rgba(90,21,63,.16); }
    .ops-queue strong { font-size: 26px; }
    .ops-queue span, .ops-queue small { color: #64748b; }
    .entity-stack article { padding: 10px; display: grid; gap: 6px; }
    meter { width: 100%; height: 8px; }
    .recon-list { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .recon-list article { padding: 12px; display: grid; gap: 4px; }
    .recon-list strong { font-size: 22px; }
    .expected-grid { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 8px; }
    .reconcile-table, .approval-list { display: grid; gap: 8px; }
    .reconcile-table article, .approval-list article, .job-detail { border: 1px solid #d7e6e2; border-radius: 8px; padding: 10px; background: #ffffff; }
    .reconcile-table article { display: grid; gap: 4px; border-left: 4px solid #94a3b8; }
    .reconcile-table article.match { border-left-color: #C87D4B; background: #FBF0E8; }
    .reconcile-table article.mismatch { border-left-color: #ef4444; background: #fef2f2; }
    .reconcile-table span, .approval-list small, .approval-list span { color: #64748b; }
    .approval-list article { display: grid; grid-template-columns: minmax(0, 1fr) minmax(120px, .6fr); gap: 10px; border-left: 4px solid #94a3b8; }
    .approval-list article.pending { border-left-color: #f59e0b; background: #fffbeb; }
    .approval-list article.approved { border-left-color: #C87D4B; background: #FBF0E8; }
    .approval-list article.rejected { border-left-color: #ef4444; background: #fef2f2; }
    .job-detail { margin-top: 14px; display: grid; gap: 12px; }
    .recovery-panel { margin-top: 14px; border: 1px solid #d7e6e2; border-radius: 8px; padding: 12px; background: #faf8f6; display: grid; gap: 12px; }
    .recovery-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px; }
    .recovery-grid article { border: 1px solid #d7e6e2; border-radius: 8px; padding: 10px; background: #ffffff; display: grid; gap: 4px; }
    .recovery-grid span, .recovery-grid small, .recovery-list span { color: #64748b; }
    .recovery-grid strong { font-size: 22px; }
    .recovery-list { display: grid; gap: 8px; }
    .recovery-list article { border: 1px solid #d7e6e2; border-radius: 8px; padding: 10px; background: #ffffff; display: grid; grid-template-columns: 32px minmax(0, 1fr); gap: 10px; align-items: center; }
    .recovery-list strong { width: 28px; height: 28px; border-radius: 50%; display: inline-grid; place-items: center; background: #F8EEF4; color: #4B1238; }
    .control-strip.compact { grid-template-columns: repeat(4, minmax(0, 1fr)); }
    .worker-settings { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; margin-top: 12px; }
    .fresh-start-banner { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-top: 12px; padding: 8px 12px; border: 1px solid #fca5a5; background: #fef2f2; border-radius: 8px; color: #b91c1c; font-size: 13px; font-weight: 600; }
    .diag-panel { margin-top: 12px; padding: 10px 12px; border: 1px solid #d7e6e2; border-radius: 8px; background: #faf8f6; }
    .diag-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 6px; }
    .diag-head strong { font-size: 13px; }
    .diag-badge { font-size: 11px; font-family: ui-monospace, monospace; padding: 2px 8px; border-radius: 999px; background: #e0f2ee; color: #4B1238; }
    .diag-badge.warn { background: #fef3c7; color: #b45309; }
    .diag-stale { margin: 0 0 6px; font-size: 12px; color: #b45309; font-weight: 600; }
    .diag-grid { display: grid; grid-template-columns: 1fr auto; gap: 2px 12px; font-size: 12px; }
    .diag-grid span { color: #64748b; }
    .diag-grid strong { text-align: right; color: #0f172a; }
    .diag-grid strong.bad { color: #dc2626; }
    .proof-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; margin-bottom: 10px; }
    .proof-grid article, .difference-list article { border: 1px solid #d7e6e2; border-radius: 8px; padding: 10px; display: grid; gap: 4px; background: #ffffff; }
    .proof-grid span, .difference-list span, .difference-list small { color: #64748b; }
    .proof-grid strong { font-size: 18px; word-break: break-word; }
    .compact-checklist { margin-top: 10px; }
    .difference-list { display: grid; gap: 8px; margin-top: 10px; }
    .difference-list article { border-left: 4px solid #f59e0b; background: #fffbeb; }
    .difference-list article.danger { border-left-color: #ef4444; background: #fef2f2; }
    .chunk-list { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 8px; margin-top: 12px; }
    .chunk-list article { border: 1px solid #d7e6e2; border-left: 4px solid #94a3b8; border-radius: 8px; padding: 10px; display: grid; gap: 4px; background: #ffffff; }
    .chunk-list article.done { border-left-color: #C87D4B; background: #FBF0E8; }
    .chunk-list article.danger { border-left-color: #ef4444; background: #fef2f2; }
    .chunk-list span, .chunk-list small { color: #64748b; }
    tr.selected td { background: #F8EEF4; }
    .segmented { display: inline-flex; border: 1px solid #cfe0dc; border-radius: 8px; overflow: hidden; }
    .segmented button { border: 0; border-radius: 0; min-height: 34px; background: #ffffff; }
    .segmented button.active { background: #5A153F; color: #ffffff; }
    .table-wrap { overflow: auto; border: 1px solid #d7e6e2; border-radius: 8px; }
    table { width: 100%; border-collapse: collapse; min-width: 760px; }
    th, td { padding: 11px 12px; border-bottom: 1px solid #edf2f7; text-align: left; vertical-align: top; }
    th { background: #f8fafc; color: #64748b; font-size: 12px; text-transform: uppercase; }
    td { font-size: 13px; }
    .dense { max-height: 420px; }
    .checklist label { display: flex; align-items: center; gap: 10px; text-transform: none; color: #172033; font-size: 14px; }
    .checklist input { width: auto; min-height: auto; }
    .rollback-zone { margin-top: 16px; border: 1px solid #fecaca; border-radius: 8px; padding: 14px; display: grid; gap: 8px; background: #fff7f7; }
    .rollback-zone span, .result-box span { color: #64748b; }
    .result-box { border: 1px solid #d7e6e2; border-radius: 8px; padding: 12px; display: grid; gap: 6px; background: #faf8f6; }
    @media (max-width: 1100px) {
      .migration-shell { grid-template-columns: 1fr; }
      .command-header, .workspace-grid, .grid.two, .grid.three, .control-strip { grid-template-columns: 1fr 1fr; }
      .migration-page-workspace { display: contents; }
      .migration-shell > :not(.command-header):not(.control-strip):not(.migration-page-workspace), .migration-side-nav, .migration-page-detail { grid-column: 1; }
      .migration-side-nav { grid-row: auto; position: static; grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .pipeline { grid-template-columns: repeat(3, minmax(0, 1fr)); }
    }
    @media (max-width: 760px) {
      .command-header, .workspace-grid, .grid.two, .grid.three, .control-strip, .control-strip.compact, .migration-side-nav, .form-grid, .pipeline, .recon-list, .expected-grid, .approval-list article, .proof-grid, .recovery-grid { grid-template-columns: 1fr; }
      .command-header h1 { font-size: 28px; }
      .panel-head { align-items: flex-start; flex-direction: column; }
      .mapping-toolbar, .mapping-list article, .duplicate-list article, .ops-queue, .worker-settings, .normalizer-head { grid-template-columns: 1fr; }
      .normalizer-head { display: grid; }
    }
  `]
})
export class DataMigrationComponent implements OnInit, OnDestroy {
  readonly migrationPages = [
    { route: '/data-migration/controlled-migration-launch', section: 'controlled-migration-launch', label: 'Controlled migration launch', description: 'Source upload, analyzer, dry run and import actions', icon: 'CL', badge: 'Start', exact: true },
    { route: '/data-migration/purchase-bill-history', section: 'purchase-bill-history', label: 'Purchase bill history', description: 'Migrate old vendor bills as history without adding inventory stock', icon: 'PB', badge: 'No stock', exact: true },
    { route: '/data-migration/import-blockers', section: 'import-blockers', label: 'Import blockers', description: 'Critical errors, warnings, duplicates and adapter readiness', icon: 'IB', badge: 'Risk', exact: true },
    { route: '/data-migration/chunked-import-queue', section: 'chunked-import-queue', label: 'Chunked import queue', description: 'Large import job, chunks, worker tick and resume controls', icon: 'CQ', badge: 'Queue', exact: true },
    { route: '/data-migration/reconciliation-sign-off', section: 'reconciliation-sign-off', label: 'Reconciliation sign-off', description: 'Proof checks, reconciliation evidence and export', icon: 'RS', badge: 'Proof', exact: true },
    { route: '/data-migration/field-confidence-saved-profiles', section: 'field-confidence-saved-profiles', label: 'Field confidence & saved profiles', description: 'AI mapping confidence and reusable profiles', icon: 'FC', badge: 'Map', exact: true },
    { route: '/data-migration/detected-modules', section: 'detected-modules', label: 'Detected modules', description: 'Entity coverage, valid rows, errors and duplicates', icon: 'DM', badge: 'Scan', exact: true },
    { route: '/data-migration/old-vs-aura-checks', section: 'old-vs-aura-checks', label: 'Old vs Aura checks', description: 'Source-to-Aura reconciliation summary', icon: 'OA', badge: 'Check', exact: true },
    { route: '/data-migration/expected-totals-analyzed-data', section: 'expected-totals-analyzed-data', label: 'Expected totals vs analyzed data', description: 'Expected count inputs and reconciliation run', icon: 'ET', badge: 'Match', exact: true },
    { route: '/data-migration/owner-sign-off-workflow', section: 'owner-sign-off-workflow', label: 'Owner sign-off workflow', description: 'Approval note, submit, approve and reject flow', icon: 'OS', badge: 'Gate', exact: true },
    { route: '/data-migration/fix-priorities', section: 'fix-priorities', label: 'Fix priorities', description: 'Error, warning and duplicate priority queues', icon: 'FP', badge: 'Fix', exact: true },
    { route: '/data-migration/client-invoice-source-collisions', section: 'client-invoice-source-collisions', label: 'Client, invoice & source collisions', description: 'Merge, keep and link duplicate decisions', icon: 'CC', badge: 'Resolve', exact: true },
    { route: '/data-migration/sign-off-controls', section: 'sign-off-controls', label: 'Sign-off controls', description: 'Completion checklist and rollback controls', icon: 'SC', badge: 'Audit', exact: true },
    { route: '/data-migration/quality-sandbox-approval-gate', section: 'quality-sandbox-approval-gate', label: 'Quality, sandbox & approval gate', description: 'Sandbox mode, approval gate and quality checklist', icon: 'QG', badge: 'QA', exact: true },
    { route: '/data-migration/ask-why-rows-failed', section: 'ask-why-rows-failed', label: 'Ask why rows failed', description: 'Migration assistant and anomaly explanation', icon: 'AW', badge: 'Help', exact: true },
    { route: '/data-migration/jobs-audits-rollback-history', section: 'jobs-audits-rollback-history', label: 'Jobs, audits and rollback history', description: 'Job ledger, audit detail, recovery and rollback history', icon: 'JH', badge: 'Log', exact: true }
  ];
  readonly sourceOptions = [
    { value: 'zenoti', label: 'Zenoti' },
    { value: 'salonist', label: 'Salonist' },
    { value: 'dingg', label: 'DINGG' },
    { value: 'fresha', label: 'Fresha' },
    { value: 'tally', label: 'Tally' },
    { value: 'busy', label: 'Busy' },
    { value: 'marg', label: 'Marg' },
    { value: 'excel', label: 'Generic Excel' },
    { value: 'csv', label: 'Generic CSV' },
    { value: 'manual', label: 'Manual records' }
  ];
  private readonly fallbackAdapters: Record<string, SourceAdapter> = {
    zenoti: { label: 'Zenoti', type: 'salon-pos', formats: ['xlsx', 'csv', 'zip'], status: 'adapter-ready' },
    salonist: { label: 'Salonist', type: 'salon-pos', formats: ['xlsx', 'csv', 'zip'], status: 'adapter-ready' },
    dingg: { label: 'DINGG', type: 'salon-pos', formats: ['xlsx', 'csv', 'zip'], status: 'adapter-ready' },
    fresha: { label: 'Fresha', type: 'salon-pos', formats: ['xlsx', 'csv', 'zip'], status: 'adapter-ready' },
    tally: { label: 'Tally', type: 'accounting', formats: ['xlsx', 'csv', 'zip'], status: 'scaffold-ready' },
    busy: { label: 'Busy', type: 'accounting', formats: ['xlsx', 'csv', 'zip'], status: 'scaffold-ready' },
    marg: { label: 'Marg', type: 'inventory-accounting', formats: ['xlsx', 'csv', 'zip'], status: 'scaffold-ready' },
    excel: { label: 'Generic Excel', type: 'spreadsheet', formats: ['xlsx', 'xls', 'zip'], status: 'adapter-ready' },
    csv: { label: 'Generic CSV', type: 'spreadsheet', formats: ['csv', 'zip'], status: 'adapter-ready' },
    manual: { label: 'Manual records', type: 'manual', formats: ['xlsx', 'csv', 'zip'], status: 'adapter-ready' }
  };
  readonly resourceOptions = [
    { value: 'clients', label: 'Clients' },
    { value: 'staff', label: 'Staff' },
    { value: 'services', label: 'Services' },
    { value: 'products', label: 'Products' },
    { value: 'inventory', label: 'Inventory' },
    { value: 'purchaseBills', label: 'Purchase Bills (history only)' },
    { value: 'vendors', label: 'Vendors' },
    { value: 'expenses', label: 'Expenses' },
    { value: 'memberships', label: 'Memberships' },
    { value: 'appointments', label: 'Appointments' },
    { value: 'sales', label: 'Sales' },
    { value: 'invoices', label: 'Invoices' },
    { value: 'payments', label: 'Payments' }
  ];
  readonly expectedMetrics = [
    { key: 'clients', label: 'Clients' },
    { key: 'appointments', label: 'Appointments' },
    { key: 'invoices', label: 'Invoices' },
    { key: 'payments', label: 'Payments' },
    { key: 'revenue', label: 'Revenue total' }
  ];

  sourceSoftware = 'dingg';
  resource = '';
  selectedMappingId = '';
  approvalNote = '';
  private resumeFinalImportAfterApproval = false;
  rowFilter = signal<'all' | 'error' | 'warning' | 'duplicate'>('all');
  fileBase64 = signal('');
  fileRef = signal('');
  fileSha256 = signal('');
  fileName = signal('');
  fileSize = signal(0);
  rawSourceFileName = signal('');
  @ViewChild('sourceFileInput') sourceFileInput?: ElementRef<HTMLInputElement>;
  normalizerResult = signal<NormalizedMigrationPackage | null>(null);
  forceFreshNextUpload = signal(false);
  loading = signal(false);
  error = signal('');
  message = signal('');
  summary = signal<MigrationSummary | null>(null);
  previewRows = signal<any[]>([]);
  jobs = signal<any[]>([]);
  onboarding = signal<any | null>(null);
  adapters = signal<Record<string, SourceAdapter>>({});
  templates = signal<Record<string, MigrationTemplate>>({});
  mappings = signal<any[]>([]);
  mappingDraft = signal<MappingDraftRow[]>([]);
  duplicateDecisions = signal<Record<string, 'merge' | 'keep' | 'link'>>({});
  expectedTotals = signal<Record<string, number>>({});
  reconciliationResult = signal<any | null>(null);
  approvals = signal<ApprovalRecord[]>([]);
  selectedJob = signal<any | null>(null);
  selectedJobRecovery = signal<MigrationRecoveryReport | null>(null);
  migrationProgress = signal(0);
  activeMigrationOperation = signal('');
  liveClientStats = signal({ total: 0, migrated: 0 });
  sandboxMode = signal(true);
  maskPreviewPii = signal(true);
  rollbackReason = signal('');
  assistantQuestion = signal('');
  assistantAnswer = signal('');
  approvalDebug = signal('');
  largeJob = signal<LargeMigrationJob | null>(null);
  largeChunkSize = signal(5000);
  largeMaxChunks = signal(5);
  allowPartialLargeImport = signal(false);
  lastWorkerResult = signal<any | null>(null);
  csvStagedRows = signal(0);
  csvStagedChunks = signal(0);
  commandCenterReport = signal<any | null>(null);
  resumableUploadSessions = signal<any[]>([]);
  proofPack = signal<any | null>(null);
  largeUploadMode = signal(false);
  largeUploadProgress = signal(0);
  largeUploadStatus = signal<'idle' | 'uploading' | 'processing' | 'complete' | 'error'>('idle');
  private selectedSourceFile: File | null = null;
  private progressTimer: ReturnType<typeof setInterval> | null = null;
  private readonly migrationUploadChunkBytes = 8 * 1024 * 1024;
  private readonly emptyTemplateColumns: MigrationTemplate['columns'] = [];
  private relevantMappingsCacheKey = '';
  private relevantMappingsCacheSource: any[] | null = null;
  private relevantMappingsCache: any[] = [];

  entityRows = computed(() => {
    const summary = this.summary();
    if (!summary?.byEntity) return [];
    return Object.entries(summary.byEntity).map(([entity, value]) => ({ entity, ...value }));
  });

  hasCriticalErrors = computed(() => Boolean(this.summary()?.errorRows));
  hasBlockingCriticalErrors = computed(() => this.hasCriticalErrors() && !this.allowPartialLargeImport());
  analyzerDiagnostics = computed<AnalyzerDiagnostics | null>(() => {
    const job = this.largeJob();
    const latestChunkDiag = (job?.chunks || [])
      .map((c) => c.summary?.diagnostics)
      .filter(Boolean)
      .pop();
    return this.summary()?.diagnostics
      || job?.diagnostics
      || job?.summary?.diagnostics
      || latestChunkDiag
      || null;
  });
  // Which response field carried diagnostics (for the on-screen debug line).
  diagnosticsSource = computed<string>(() => {
    const job = this.largeJob();
    if (this.summary()?.diagnostics) return 'analyze preview summary.diagnostics';
    if (job?.diagnostics) return 'GET large-job .diagnostics';
    if (job?.summary?.diagnostics) return 'GET large-job summary.diagnostics';
    if ((job?.chunks || []).some((c) => c.summary?.diagnostics)) return 'GET large-job chunk.summary.diagnostics (fallback)';
    return 'none — diagnostics field missing in all paths';
  });
  expectedAnalyzerFixVersion = '2026-06-large-xref-invoicekey-1';
  analyzerVersionMissing = computed(() => {
    // Only meaningful once an analysis exists. If neither a preview summary nor a
    // large job is present, there is nothing to flag yet.
    if (!this.summary() && !this.largeJob()) return false;
    return this.analyzerDiagnostics()?.analyzerFixVersion !== this.expectedAnalyzerFixVersion;
  });
  largeJobNeedsFreshStart = computed(() => Boolean(this.largeJob()) && this.analyzerVersionMissing());
  mappingDraftPreview = computed(() => this.mappingDraft().slice(0, 10));
  recentApprovals = computed(() => this.approvals().slice(0, 5));
  duplicatePreviewRows = computed(() => this.duplicateRows().slice(0, 8));
  normalizerFiles = computed(() => this.normalizerResult()?.files || []);
  commandCenterEntities = computed(() => this.commandCenterReport()?.entities || []);
  commandCenterBranches = computed(() => this.commandCenterReport()?.branches || []);
  commandCenterActions = computed(() => this.commandCenterReport()?.recommendedActions || []);
  entityTotalCards = computed(() => (this.commandCenterReport()?.liveTotals || this.onboarding()?.entityTotals || []).slice(0, 12));
  resumableOpenSessions = computed(() => this.resumableUploadSessions().filter((session) => session.status === 'open'));

  largeUploadLabel = computed(() => {
    const status = this.largeUploadStatus();
    if (status === 'uploading') return `Uploading ${this.largeUploadProgress()}%`;
    if (status === 'processing') return `Backend processing ${this.largeUploadProgress()}%`;
    if (status === 'complete') return 'Large import ready';
    if (status === 'error') return 'Upload failed';
    return 'Large Import';
  });

  largeUploadDetail = computed(() => {
    const status = this.largeUploadStatus();
    const job = this.largeJob();
    if (status === 'uploading') return 'Sending file to server';
    if (status === 'processing') return `Job ${job?.id || ''} · ${job?.chunks?.length || 0} chunks queued`;
    if (status === 'complete') return `${job?.totalRows || 0} rows · ${job?.chunks?.length || 0} chunks · ${job?.status || ''}`;
    if (status === 'error') return this.error() || 'Upload failed';
    return '';
  });
  selectedJobRows = computed(() => (this.selectedJob()?.rows || []).slice(0, 200));
  recoveryFailedRows = computed(() => this.selectedJobRecovery()?.failedRows?.slice(0, 50) || []);
  recoveryNextActions = computed(() => this.selectedJobRecovery()?.nextActions || []);
  reconciliationLines = computed<ReconciliationLine[]>(() => this.reconciliationResult()?.lines || []);
  largeJobChunks = computed(() => this.largeJob()?.chunks || []);
  largeReadyChunks = computed(() => this.largeJobChunks().filter((chunk) => ['analyzed', 'analyzed_with_errors', 'failed'].includes(chunk.status)).length);
  largePendingChunks = computed(() => this.largeJobChunks().filter((chunk) => !['analyzed', 'analyzed_with_errors', 'failed', 'imported', 'imported_with_errors', 'skipped_with_errors', 'rolled_back', 'cancelled'].includes(chunk.status)).length);
  latestLargeReconciliation = computed(() => this.largeJob()?.reconciliations?.[0] || null);
  largeReconciliationDifferences = computed(() => this.latestLargeReconciliation()?.differences || []);
  completionChecklist = computed(() => this.onboarding()?.completionChecklist || [
    { label: 'Upload source file', done: this.hasSelectedSourcePayload() },
    { label: 'Run analyze', done: Boolean(this.summary()) },
    { label: 'Resolve critical errors', done: !this.hasCriticalErrors() },
    { label: 'Run dry-run validation', done: false },
    { label: 'Owner final sign-off', done: false }
  ]);
  validationQueues = computed<Array<{ status: 'all' | 'error' | 'warning' | 'duplicate'; label: string; count: number; detail: string }>>(() => {
    const rows = this.previewRows();
    const errors = rows.filter((row) => row.status === 'error').length;
    const warnings = rows.filter((row) => row.status === 'warning').length;
    return [
      { status: 'error', label: 'Critical fixes', count: errors, detail: errors ? 'Must resolve before import' : 'No blockers' },
      { status: 'warning', label: 'Review queue', count: warnings, detail: warnings ? 'Can import with owner sign-off' : 'No warnings' },
      { status: 'duplicate', label: 'Duplicate conflicts', count: this.duplicateRows().length, detail: 'Merge / keep / link required' },
      { status: 'all', label: 'All decisions', count: rows.length, detail: 'Full row-level report' }
    ];
  });
  enterpriseChecklist = computed(() => [
    { label: 'File stored for migration', done: this.hasSelectedSourcePayload() },
    { label: 'Required mapping fields completed', done: this.requiredMappingComplete() },
    { label: 'No critical errors', done: !this.hasCriticalErrors() && Boolean(this.summary()) },
    { label: 'Duplicate decisions reviewed', done: !this.duplicateRows().length || this.duplicateDecisionCount() === this.duplicateRows().length },
    { label: 'Owner approval received', done: this.importApprovalReady() },
    { label: 'Sandbox mode reviewed before live import', done: this.sandboxMode() || this.importApprovalReady() }
  ]);
  anomalyCards = computed<Array<{ label: string; count: number; detail: string; tone: string }>>(() => {
    const rows = this.previewRows();
    const invalidDates = rows.filter((row) => /date|future|invalid/i.test(String(row.message || ''))).length;
    const badPhone = rows.filter((row) => /phone|mobile/i.test(String(row.message || ''))).length;
    const badMoney = rows.filter((row) => /negative|amount|payment|invoice|discount/i.test(String(row.message || ''))).length;
    return [
      { label: 'Invalid dates', count: invalidDates, detail: 'Future/invalid appointment or invoice dates', tone: invalidDates ? 'warning' : 'good' },
      { label: 'Phone/email issues', count: badPhone, detail: 'PII and contact validation issues', tone: badPhone ? 'warning' : 'good' },
      { label: 'Money anomalies', count: badMoney, detail: 'Negative invoice/payment/discount issues', tone: badMoney ? 'danger' : 'good' }
    ];
  });

  templateColumns = () => {
    const key = this.resource || 'clients';
    return this.templates()[key]?.columns || this.emptyTemplateColumns;
  };

  relevantMappings = () => {
    const resource = this.resource || 'clients';
    const mappings = this.mappings();
    const cacheKey = `${resource}|${this.sourceSoftware}|${mappings.length}`;
    if (cacheKey !== this.relevantMappingsCacheKey || mappings !== this.relevantMappingsCacheSource) {
      this.relevantMappingsCacheKey = cacheKey;
      this.relevantMappingsCacheSource = mappings;
      this.relevantMappingsCache = mappings.filter((mapping) => (!mapping.resource || mapping.resource === resource) && (!mapping.sourceSoftware || mapping.sourceSoftware === this.sourceSoftware));
    }
    return this.relevantMappingsCache;
  };

  selectedAdapter = (): SourceAdapter => {
    const adapter = this.adapters()[this.sourceSoftware] || this.fallbackAdapters[this.sourceSoftware];
    if (!adapter) {
      return {
        label: this.sourceOptions.find((item) => item.value === this.sourceSoftware)?.label || this.sourceSoftware,
        type: 'spreadsheet',
        formats: ['xlsx', 'csv', 'zip'],
        status: 'adapter-ready'
      };
    }
    const formats = Array.from(new Set([...(adapter.formats || []), 'zip']));
    return formats.length === adapter.formats?.length ? adapter : { ...adapter, formats };
  };

  readinessScore = computed(() => {
    const summary = this.summary();
    const onboarding = this.onboarding();
    let score = 15;
    if (this.hasSelectedSourcePayload()) score += 15;
    if (summary?.totalRows) score += 20;
    if (summary?.totalRows) score += Math.round((Number(summary.validRows || 0) / Math.max(1, Number(summary.totalRows || 1))) * 25);
    if (onboarding?.completionChecklist?.some((item: any) => item.key === 'dryRun' && item.done)) score += 10;
    if (summary && !summary.errorRows) score += 10;
    if (this.jobs().some((job) => Number(job.importedRows || 0) > 0)) score += 5;
    return Math.max(0, Math.min(100, score - Math.min(30, Number(summary?.errorRows || 0) * 3)));
  });

  pipelineSteps = computed(() => {
    const summary = this.summary();
    const hasFile = this.hasSelectedSourcePayload();
    const hasErrors = Number(summary?.errorRows || 0) > 0;
    const imported = this.jobs().some((job) => Number(job.importedRows || 0) > 0 && job.status !== 'rolled_back');
    return [
      { key: '01', label: 'Upload', detail: hasFile ? this.fileName() : 'Waiting for file', status: hasFile ? 'done' : 'active' },
      { key: '02', label: 'Map', detail: `${this.mappingCoverage()}% field confidence`, status: hasFile ? 'active' : 'blocked' },
      { key: '03', label: 'Validate', detail: summary ? `${summary.errorRows} critical errors` : 'Analyze pending', status: summary ? (hasErrors ? 'blocked' : 'done') : 'blocked' },
      { key: '04', label: 'Dry run', detail: 'No database write', status: summary && !hasErrors ? 'active' : 'blocked' },
      { key: '05', label: 'Import', detail: imported ? 'Live modules updated' : 'Awaiting sign-off', status: imported ? 'done' : (summary && !hasErrors ? 'active' : 'blocked') }
    ];
  });

  riskCards = computed(() => {
    const summary = this.summary();
    const errors = Number(summary?.errorRows || 0);
    const warnings = Number(summary?.warningRows || 0);
    const duplicates = Number(summary?.duplicateRows || 0);
    return [
      { label: 'Critical errors', value: errors, detail: errors ? 'Fix before final import' : 'No hard blocker detected', tone: errors ? 'danger' : 'good' },
      { label: 'Warnings', value: warnings, detail: warnings ? 'Review row-level decisions' : 'Clean validation layer', tone: warnings ? 'warning' : 'good' },
      { label: 'Duplicates', value: duplicates, detail: duplicates ? 'Merge studio review needed' : 'No duplicate pressure', tone: duplicates ? 'warning' : 'good' },
      { label: 'Adapter readiness', value: this.selectedAdapter()?.status || 'ready', detail: this.selectedAdapter()?.formats?.join(', ') || 'xlsx, csv, zip', tone: 'good' }
    ];
  });

  filteredPreviewRows = computed(() => {
    const filter = this.rowFilter();
    const rows = this.previewRows();
    if (filter === 'all') return rows;
    if (filter === 'duplicate') return rows.filter((row) =>
      row.status === 'duplicate'
        || String(row.message || '').toLowerCase().includes('duplicate')
        || String(row.message || '').toLowerCase().includes('already')
    );
    return rows.filter((row) => row.status === filter);
  });

  duplicateRows = computed(() => this.previewRows().filter((row) =>
    row.status === 'duplicate'
      || String(row.message || '').toLowerCase().includes('duplicate')
      || String(row.message || '').toLowerCase().includes('already')
  ));

  liveClientTotal(): number {
    const onboarding = this.onboarding();
    return Number(this.liveClientStats().total || onboarding?.liveClientBranchCount || onboarding?.liveClientCount || 0);
  }

  tenantClientTotal(): number {
    const onboarding = this.onboarding();
    return Number(onboarding?.liveClientCount ?? this.liveClientTotal());
  }

  migratedClientTotal(): number {
    const onboarding = this.onboarding();
    return Number(this.liveClientStats().migrated || onboarding?.migratedClientBranchCount || onboarding?.migratedClientCount || onboarding?.importedRecordsCount || 0);
  }

  reconciliationRows = computed(() => {
    const summary = this.summary();
    const total = Number(summary?.totalRows || 0);
    const valid = Number(summary?.validRows || 0);
    const imported = this.jobs().reduce((sum, job) => sum + Number(job.importedRows || 0), 0);
    const affected = Number(summary?.affectedRecords || 0);
    const liveClients = this.liveClientTotal();
    const tenantClients = this.tenantClientTotal();
    const migratedClients = this.migratedClientTotal();
    return [
      { label: 'Live clients', value: liveClients, detail: tenantClients !== liveClients ? `${tenantClients} clients across all branches` : 'Live client master records' },
      { label: 'Migrated clients', value: migratedClients, detail: 'Imported clients visible in live module' },
      { label: 'Source rows', value: total, detail: 'Rows read from uploaded workbook' },
      { label: 'Aura-ready rows', value: valid, detail: total ? `${Math.round(valid / Math.max(1, total) * 100)}% can move forward` : 'Awaiting analyze' },
      { label: 'Affected records', value: affected, detail: 'Expected create/update impact' },
      { label: 'Historical imported', value: imported, detail: 'Imported rows across all jobs' }
    ];
  });

  constructor(private readonly api: ApiService, private readonly router: Router) {}

  activeMigrationSection(): string | null {
    const path = this.router.url.split('?')[0].replace(/\/$/, '');
    const section = path.split('/').pop() || '';
    return this.migrationPages.some((page) => page.section === section) ? section : null;
  }

  showMigrationSection(section: string): boolean {
    const active = this.activeMigrationSection();
    return !active || active === section;
  }

  migrationChildActive(): boolean {
    const path = this.router.url.split('?')[0].replace(/\/$/, '');
    return path !== '/data-migration';
  }
  ngOnInit(): void {
    this.loadIntelligence();
    this.loadJobs();
    this.loadApprovals();
    this.loadResumableUploadSessions();
  }

  ngOnDestroy(): void {
    this.stopMigrationProgress();
    this.stopLargeUploadPolling();
  }

  selectedSourceLabel(): string {
    return this.selectedAdapter()?.label || this.sourceOptions.find((item) => item.value === this.sourceSoftware)?.label || this.sourceSoftware;
  }

  selectedAdapterType(): string {
    return this.selectedAdapter()?.type || 'adapter pending';
  }

  selectedAdapterStatus(): string {
    return this.selectedAdapter()?.status || 'local rule set';
  }

  fileSizeLabel(): string {
    const size = this.fileSize();
    if (!size) return 'Upload .xlsx, .xls, .csv or .zip';
    if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
    return `${(size / 1024 / 1024).toFixed(1)} MB`;
  }

  goLiveGate(): string {
    if (!this.hasSelectedSourcePayload()) return 'Upload source file';
    if (this.hasBlockingCriticalErrors()) return 'Blocked by validation errors';
    if (this.hasCriticalErrors()) return 'Partial import review required';
    if (!this.summary()) return 'Run analyze';
    if (this.readinessScore() >= 85) return 'Ready for owner sign-off';
    return 'Dry run recommended';
  }

  mappingCoverage(): number {
    const rows = this.mappingDraft();
    if (!rows.length) return 0;
    return Math.round((rows.filter((row) => row.sourceColumn.trim()).length / rows.length) * 100);
  }

  refreshSourceContext(): void {
    this.message.set(`${this.selectedSourceLabel()} adapter selected.`);
    this.rebuildMappingDraft();
  }

  selectHistoricalPurchaseBillMigration(): void {
    this.resource = 'purchaseBills';
    this.selectedMappingId = '';
    this.rebuildMappingDraft();
    this.message.set('Purchase bill history template selected. Upload the old purchase bill file and run Analyze.');
    void this.router.navigate(['/data-migration/controlled-migration-launch'], { queryParams: { resource: 'purchaseBills' } });
  }

  onResourceChange(): void {
    this.selectedMappingId = '';
    this.rebuildMappingDraft();
  }

  onFile(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    this.selectedSourceFile = file;
    // Reset the native input so re-selecting the SAME file later still fires the
    // change event (browsers suppress it otherwise) — required after Start fresh.
    input.value = '';
    this.fileName.set(file.name);
    this.fileSize.set(file.size);
    this.rawSourceFileName.set(file.name);
    this.normalizerResult.set(null);
    this.error.set('');
    this.message.set('');
    this.summary.set(null);
    this.previewRows.set([]);
    this.duplicateDecisions.set({});
    this.reconciliationResult.set(null);
    this.selectedJob.set(null);
    this.selectedJobRecovery.set(null);
    this.largeJob.set(null);
    this.lastWorkerResult.set(null);
    this.csvStagedRows.set(0);
    this.csvStagedChunks.set(0);
    this.commandCenterReport.set(null);
    this.proofPack.set(null);
    this.fileBase64.set('');
    this.fileRef.set('');
    this.fileSha256.set('');
    if (this.largeUploadMode()) {
      void this.uploadLargeFile(file);
      return;
    }
    if (file.size > 20 * 1024 * 1024 && !this.isCsvFile(file) && !this.isZipFile(file)) {
      this.error.set('Excel files over 20MB must be split or exported as CSV, or use Large Import Mode toggle above.');
      input.value = '';
      this.selectedSourceFile = null;
      return;
    }
    if (file.size > 20 * 1024 * 1024 && (this.isCsvFile(file) || this.isZipFile(file))) {
      void this.storeSourceEvidenceFile(file, 'source');
      this.message.set(this.isZipFile(file)
        ? 'Large ZIP selected. Resumable evidence upload started.'
        : 'Large CSV selected. Resumable evidence upload started; Stage CSV chunks remains available.');
      return;
    }
    const reader = new FileReader();
    reader.onload = async () => {
      const base64 = String(reader.result || '').split(',').pop() || '';
      this.fileBase64.set(base64);
      await this.storeSourceEvidenceFile(file, 'source');
    };
    reader.onerror = () => this.error.set('File read failed.');
    reader.readAsDataURL(file);
  }

  async uploadLargeFile(file: File): Promise<void> {
    this.largeUploadProgress.set(0);
    this.largeUploadStatus.set('uploading');
    this.error.set('');
    this.message.set('');
    try {
      await this.storeSourceEvidenceFile(file, 'large-import');
      if (!this.fileRef()) throw new Error('Large upload storage did not return a file reference.');
      this.largeUploadProgress.set(65);
      this.largeUploadStatus.set('processing');
      const forceFresh = this.forceFreshNextUpload();
      const result = await firstValueFrom(this.api.post<any>('migration/large-upload/from-file-ref', {
        fileRef: this.fileRef(),
        sourceSoftware: this.sourceSoftware,
        resource: this.resource || 'auto',
        branchId: '',
        forceFresh
      }));
      this.forceFreshNextUpload.set(false);
      this.fileRef.set(result.fileRef || this.fileRef());
      this.largeUploadProgress.set(100);
      this.largeJob.set(result.job || null);
      this.summary.set({
        totalRows: result.totalRows || 0,
        validRows: result.job?.validRows || 0,
        warningRows: result.job?.warningRows || 0,
        errorRows: result.job?.errorRows || 0,
        duplicateRows: 0,
        affectedRecords: result.totalRows || 0,
        byEntity: {},
        diagnostics: result.job?.summary?.diagnostics
      });
      this.message.set(result.message || 'Large file uploaded and split into chunks.');
      this.largeUploadStatus.set('complete');
      this.startLargeUploadPolling(result.job?.id);
    } catch (err: any) {
      this.largeUploadStatus.set('error');
      this.error.set(this.api.errorText(err, 'Large upload failed.'));
    }
  }

  private largeUploadPollTimer: ReturnType<typeof setInterval> | null = null;

  private startLargeUploadPolling(jobId: string): void {
    this.stopLargeUploadPolling();
    if (!jobId) return;
    this.largeUploadPollTimer = setInterval(async () => {
      try {
        const job = await firstValueFrom(this.api.get<LargeMigrationJob>('migration/large-jobs', jobId));
        this.largeJob.set(job);
        if (['completed', 'completed_with_errors', 'failed', 'cancelled', 'rolled_back'].includes(String(job?.status))) {
          this.stopLargeUploadPolling();
          this.message.set(`Large import ${job?.status}. ${job?.importedRows || 0} rows imported.`);
        }
      } catch {
        this.stopLargeUploadPolling();
      }
    }, 3000);
  }

  private stopLargeUploadPolling(): void {
    if (!this.largeUploadPollTimer) return;
    clearInterval(this.largeUploadPollTimer);
    this.largeUploadPollTimer = null;
  }

  canNormalizeSource(): boolean {
    if (!this.hasSelectedSourcePayload() || this.loading() || this.normalizerResult() || this.isAuraReadyPackage()) return false;
    const name = this.fileName().toLowerCase();
    return name.endsWith('.zip') || name.endsWith('.xlsx') || name.endsWith('.xls') || name.endsWith('.csv');
  }

  normalizerTitle(): string {
    const result = this.normalizerResult();
    if (result) return `${result.summary.fileCount} Aura CSV files ready`;
    if (this.hasSelectedSourcePayload()) return this.rawSourceFileName() || this.fileName();
    return 'No source selected';
  }

  normalizerSubtitle(): string {
    const result = this.normalizerResult();
    if (result) return `${result.summary.totalRows} rows converted from ${result.sourceFileName}`;
    if (this.hasSelectedSourcePayload()) return this.fileRef() ? 'Raw package stored as migration evidence' : 'Raw package staged for conversion';
    return 'Upload a raw ZIP, Excel, or CSV source';
  }

  normalizedPackageSizeLabel(): string {
    const size = Number(this.normalizerResult()?.fileSizeBytes || 0);
    if (!size) return '-';
    if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
    return `${(size / 1024 / 1024).toFixed(1)} MB`;
  }

  async normalizeSource(): Promise<void> {
    if (!this.hasSelectedSourcePayload()) {
      this.error.set('Select a raw migration ZIP, Excel, or CSV file first.');
      return;
    }
    if (this.isAuraReadyPackage()) {
      this.error.set('');
      this.message.set('This ZIP is already Aura-ready. Run Analyze directly.');
      this.migrationProgress.set(0);
      return;
    }
    try {
      this.loading.set(true);
      this.error.set('');
      this.message.set('Converting source into Aura format...');
      this.startMigrationProgress('normalize');
      const result = await firstValueFrom(this.api.post<NormalizedMigrationPackage>('migration/normalize-source', {
        sourceSoftware: this.sourceSoftware,
        resource: this.resource || 'auto',
        ...this.sourceFilePayload(this.rawSourceFileName() || this.fileName())
      }));
      if (!result?.fileBase64 || !result?.fileName) {
        this.error.set('Normalizer response did not include an Aura ZIP package.');
        return;
      }
      this.normalizerResult.set(result);
      this.sourceSoftware = result.targetSourceSoftware || 'csv';
      this.resource = '';
      this.fileName.set(result.fileName);
      this.fileSize.set(Number(result.fileSizeBytes || 0));
      this.fileBase64.set(result.fileBase64);
      this.fileRef.set('');
      this.fileSha256.set('');
      await this.storeSourceEvidence(result.fileName, result.fileBase64, 'normalized');
      this.summary.set(null);
      this.previewRows.set([]);
      this.duplicateDecisions.set({});
      this.reconciliationResult.set(null);
      this.selectedJob.set(null);
      this.selectedJobRecovery.set(null);
      this.largeJob.set(null);
      this.rebuildMappingDraft();
      this.finishMigrationProgress();
      this.message.set(`Aura package ready: ${result.summary.totalRows} rows across ${result.summary.fileCount} CSV file(s).`);
    } catch (err: any) {
      this.error.set(this.api.errorText(err, 'Source normalization failed.'));
    } finally {
      this.loading.set(false);
      if (this.error()) this.stopMigrationProgress();
    }
  }

  downloadNormalizedPackage(): void {
    const result = this.normalizerResult();
    if (!result?.fileBase64) return;
    const binary = atob(result.fileBase64);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
    const url = URL.createObjectURL(new Blob([bytes], { type: 'application/zip' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = result.fileName || 'aura-import.zip';
    link.click();
    URL.revokeObjectURL(url);
  }
  async analyze(): Promise<void> {
    if (this.shouldAnalyzeAsLargePackage()) {
      await this.prepareLargePackageFromStoredSource('Analyze complete. Large import chunks are ready.');
      return;
    }
    await this.callMigration('migration/analyze', 'Analyze complete. Validation cockpit updated.');
  }

  private shouldAnalyzeAsLargePackage(): boolean {
    const totalRows = Number(this.normalizerResult()?.summary?.totalRows || 0);
    const name = this.fileName().toLowerCase();
    return this.largeUploadMode() && (totalRows > 50000 || name.endsWith('.zip') || name.endsWith('.xlsx') || name.endsWith('.xls'));
  }

  private async prepareLargePackageFromStoredSource(successMessage: string): Promise<void> {
    if (!this.hasSelectedSourcePayload()) {
      this.error.set('Select an Excel / CSV / ZIP file first.');
      return;
    }
    const existingJob = this.largeJob();
    if (existingJob?.id && !this.largeJobIsTerminal()) {
      await this.refreshLargeJob();
      this.syncSummaryFromLargeJob();
      this.finishMigrationProgress();
      this.message.set(successMessage || 'Large import chunks are already prepared.');
      return;
    }
    try {
      this.loading.set(true);
      this.error.set('');
      this.message.set('Preparing large import chunks...');
      this.startMigrationProgress('analyze');
      if (!this.fileRef() && this.fileBase64()) {
        await this.storeSourceEvidence(this.fileName(), this.fileBase64(), 'large-import');
      }
      if (!this.fileRef()) throw new Error('Large import package is not stored yet. Convert or upload the package again.');
      const result = await firstValueFrom(this.api.post<any>('migration/large-upload/from-file-ref', {
        fileRef: this.fileRef(),
        sourceSoftware: this.sourceSoftware,
        resource: this.resource || 'auto',
        branchId: ''
      }));
      this.fileRef.set(result.fileRef || this.fileRef());
      this.largeJob.set(result.job || null);
      this.summary.set({
        totalRows: result.totalRows || result.job?.totalRows || 0,
        validRows: result.job?.validRows || result.totalRows || 0,
        warningRows: result.job?.warningRows || 0,
        errorRows: result.job?.errorRows || 0,
        duplicateRows: 0,
        affectedRecords: result.totalRows || result.job?.totalRows || 0,
        byEntity: {}
      });
      this.previewRows.set([]);
      this.largeUploadProgress.set(100);
      this.largeUploadStatus.set('complete');
      this.finishMigrationProgress();
      this.message.set(result.message || successMessage);
      this.startLargeUploadPolling(result.job?.id);
      await this.loadApprovals();
    } catch (err: any) {
      this.largeUploadStatus.set('error');
      this.error.set(this.api.errorText(err, 'Large import analyze failed.'));
    } finally {
      this.loading.set(false);
      if (this.error()) this.stopMigrationProgress();
    }
  }

  async dryRun(): Promise<void> {
    if (this.shouldUseLargeMigrationFlow()) {
      if (!this.largeJob()?.id || this.largeJobIsTerminal()) {
        await this.prepareLargePackageFromStoredSource('Large dry run ready. Chunks are staged for worker import.');
      } else {
        await this.refreshLargeJob();
        this.message.set('Large dry run ready. Use Final import to process staged chunks.');
      }
      return;
    }
    await this.callMigration('migration/dry-run', 'Dry run complete. Data was not saved.');
    await this.loadJobs();
  }

  async runImport(options: { skipConfirmation?: boolean } = {}): Promise<void> {
    if (this.alreadyImportedCurrentFile()) {
      const job = this.currentFileImportJob();
      this.error.set(`This file was already imported${job?.id ? ` in job ${job.id}` : ''}. Rollback that job before importing again.`);
      return;
    }
    const criticalErrors = this.importCriticalErrors();
    if (criticalErrors && !this.allowPartialLargeImport()) {
      this.error.set(`Final import blocked: ${criticalErrors} critical rows found. Fix them or enable partial import to skip those rows.`);
      return;
    }
    const approvedApproval = this.approvedApproval();
    if (!approvedApproval) {
      this.resumeFinalImportAfterApproval = true;
      this.error.set('Final import blocked: Approval required for this exact upload/job. Approve latest to continue import automatically.');
      return;
    }
    if (this.shouldUseLargeMigrationFlow() && (!this.largeJob()?.id || this.largeJobIsTerminal())) {
      this.error.set('Large import job is not ready for final import. Click Analyze to create fresh staged chunks, or Retry failed if you cancelled the existing job.');
      return;
    }
    if (this.shouldUseLargeFinalImport()) {
      await this.importLargeJobFromFinalButton(criticalErrors);
      return;
    }
    if (!this.validateRequiredMapping()) return;
    const partialNote = criticalErrors ? ` ${criticalErrors} critical rows will be skipped.` : '';
    if (!options.skipConfirmation && !confirm(`${this.sandboxMode() ? 'Sandbox' : 'Live'} final import database me data save karega.${partialNote} Continue?`)) return;
    const success = criticalErrors
      ? (this.sandboxMode() ? 'Sandbox partial import complete. Critical rows were skipped.' : 'Partial import complete. Valid rows saved; critical rows skipped.')
      : (this.sandboxMode() ? 'Sandbox import complete. Review results before live migration.' : 'Final import complete. Data saved in live modules.');
    const approvalIdentity = this.activeApprovalIdentity();
    this.resumeFinalImportAfterApproval = false;
    await this.callMigration('migration/import', success, {
      allowPartialImport: this.allowPartialLargeImport(),
      approvalId: approvedApproval.id,
      jobId: approvalIdentity.jobId || approvedApproval.jobId || '',
      sourceFileHash: approvalIdentity.sourceFileHash || approvedApproval.sourceFileHash || '',
      fileName: approvalIdentity.fileName || approvedApproval.fileName || '',
      totalRows: approvalIdentity.totalRows || approvedApproval.totalRows || 0
    });
    await this.loadJobs();
  }

  private shouldUseLargeMigrationFlow(): boolean {
    return this.largeUploadMode() || Number(this.summary()?.totalRows || 0) > 50000 || Number(this.normalizerResult()?.summary?.totalRows || 0) > 50000;
  }

  private importCriticalErrors(): number {
    const summaryErrors = Number(this.summary()?.errorRows || 0);
    const jobErrors = Number(this.largeJob()?.errorRows || 0);
    const chunkErrors = this.largeJobChunks().reduce((total, chunk) => total + Number(chunk.errorRows || 0), 0);
    return Math.max(summaryErrors, jobErrors, chunkErrors);
  }

  private largeJobIsTerminal(): boolean {
    const status = String(this.largeJob()?.status || '');
    return ['cancelled', 'rolled_back', 'completed', 'completed_with_errors'].includes(status);
  }

  private shouldUseLargeFinalImport(): boolean {
    return Boolean(this.largeJob()?.id) && !this.largeJobIsTerminal() && this.shouldUseLargeMigrationFlow();
  }

  private async importLargeJobFromFinalButton(criticalErrors: number): Promise<void> {
    const job = this.largeJob();
    if (!job?.id) {
      this.error.set('Large import job is not ready. Run Analyze again to prepare chunks.');
      return;
    }
    const partialNote = criticalErrors ? ` ${criticalErrors} critical rows will be skipped.` : '';
    if (!confirm(`${this.sandboxMode() ? 'Sandbox' : 'Live'} large final import will process ${job.totalRows || this.summary()?.totalRows || 0} staged rows in chunks.${partialNote} Continue?`)) return;
    await this.resumeLargeMigrationJob();
    await this.loadJobs();
  }

  numberInput(value: unknown, fallback: number): number {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  }

  largeJobProgress(): number {
    const job = this.largeJob();
    const total = Number(job?.totalRows || 0);
    if (!total) return 0;
    return Math.max(0, Math.min(100, Math.round(((Number(job?.importedRows || 0) + Number(job?.skippedRows || 0) + Number(job?.errorRows || 0)) / total) * 100)));
  }

  largeJobProgressDetail(): string {
    const chunks = this.largeJobChunks();
    const totalChunks = chunks.length;
    const analyzedStatuses = new Set(['analyzed', 'analyzed_with_errors', 'failed', 'imported', 'imported_with_errors', 'skipped_with_errors']);
    const importedStatuses = new Set(['imported', 'imported_with_errors', 'skipped_with_errors']);
    const analyzed = chunks.filter((chunk) => analyzedStatuses.has(String(chunk.status || ''))).length;
    const imported = chunks.filter((chunk) => importedStatuses.has(String(chunk.status || ''))).length;
    const failed = chunks.filter((chunk) => String(chunk.status || '') === 'failed').length;
    if (!totalChunks) {
      const stagedRows = Number(this.csvStagedRows() || 0);
      return stagedRows ? `${this.formatCount(stagedRows)} staged rows - ETA ${this.estimatedAnalyzeTimeText()}` : `No chunks yet - ETA ${this.estimatedAnalyzeTimeText()}`;
    }
    return `${analyzed}/${totalChunks} analyzed - ${imported}/${totalChunks} imported - ${failed} failed - ETA ${this.estimatedAnalyzeTimeText()}`;
  }

  analyzeEstimateText(): string {
    const mode = this.largeUploadMode() || this.shouldAnalyzeAsLargePackage() ? 'Large Analyze' : 'Analyze';
    const running = this.loading() && this.activeMigrationOperation() === 'analyze';
    const prefix = running ? `${mode} running` : this.summary() ? `${mode} re-run estimate` : `${mode} estimate`;
    return `${prefix}: ${this.analyzeWorkloadLabel()} - approx ${this.estimatedAnalyzeTimeText()}.`;
  }

  private analyzeWorkloadLabel(): string {
    const rows = this.estimatedAnalyzeRows();
    const chunks = this.estimatedAnalyzeChunks(rows);
    if (rows) {
      const chunkText = chunks > 1 ? ` across about ${chunks} chunks` : '';
      return `${this.formatCount(rows)} rows${chunkText}`;
    }
    const name = this.fileName();
    const fileText = this.fileSize() ? this.fileSizeLabel() : 'selected file';
    const modeText = this.largeUploadMode() ? ' in Large Import Mode' : '';
    return `${fileText}${name ? ` ${name}` : ''}${modeText}`;
  }

  private estimatedAnalyzeRows(): number {
    return Number(
      this.normalizerResult()?.summary?.totalRows
      || this.largeJob()?.totalRows
      || this.summary()?.totalRows
      || this.commandCenterReport()?.simulator?.estimatedImportRows
      || 0
    );
  }

  private estimatedAnalyzeChunks(rows = this.estimatedAnalyzeRows()): number {
    const actualChunks = this.largeJobChunks().length;
    if (actualChunks) return actualChunks;
    const fileName = this.fileName().toLowerCase();
    const chunkable = this.largeUploadMode() || rows > 50000 || fileName.endsWith('.zip') || fileName.endsWith('.xlsx') || fileName.endsWith('.xls');
    if (!chunkable || !rows) return 0;
    return Math.max(1, Math.ceil(rows / Math.max(100, this.largeChunkSize())));
  }

  private estimatedAnalyzeTimeText(): string {
    const rows = this.estimatedAnalyzeRows();
    const chunks = this.estimatedAnalyzeChunks(rows);
    const fileName = this.fileName().toLowerCase();
    const archiveLike = fileName.endsWith('.zip') || fileName.endsWith('.xlsx') || fileName.endsWith('.xls');
    const largeMode = this.largeUploadMode() || this.shouldAnalyzeAsLargePackage() || rows > 50000 || chunks > 1;
    if (rows) {
      const rowBatches = Math.max(1, Math.ceil(rows / 10000));
      const minSeconds = largeMode ? 20 + Math.max(1, chunks) * 4 : 8 + rowBatches * 4;
      const maxSeconds = largeMode ? 45 + Math.max(1, chunks) * 10 : 20 + rowBatches * 8;
      return this.durationRange(minSeconds, maxSeconds);
    }
    const sizeMb = Number(this.fileSize() || 0) / 1024 / 1024;
    if (!sizeMb) return 'available after file select';
    if (largeMode || archiveLike) {
      return this.durationRange(Math.max(60, sizeMb * 2), Math.max(180, sizeMb * 8));
    }
    return this.durationRange(Math.max(15, sizeMb * 1.5), Math.max(45, sizeMb * 5));
  }

  private durationRange(minSeconds: number, maxSeconds: number): string {
    const min = Math.max(5, Math.round(minSeconds));
    const max = Math.max(min, Math.round(maxSeconds));
    const left = this.durationLabel(min);
    const right = this.durationLabel(max);
    return left === right ? `~${left}` : `~${left}-${right}`;
  }

  private durationLabel(seconds: number): string {
    if (seconds < 60) {
      const rounded = Math.max(10, Math.round(seconds / 10) * 10);
      return `${rounded} sec`;
    }
    return `${Math.max(1, Math.round(seconds / 60))} min`;
  }

  private formatCount(value: number): string {
    return Math.round(Number(value || 0)).toLocaleString('en-IN');
  }
  largeMigrationChecklist(): Array<{ label: string; done: boolean }> {
    return [
      { label: 'Source file uploaded', done: this.canPrepareLargeMigration() },
      { label: 'Analyze completed', done: Boolean(this.summary()) },
      { label: 'No critical errors', done: Boolean(this.summary()) && !this.hasCriticalErrors() },
      { label: 'Chunk 1 staged', done: Boolean(this.largeJobChunks().length) },
      { label: 'Owner approval received', done: this.importApprovalReady() },
      { label: 'Worker queued or completed', done: ['queued', 'processing', 'completed'].includes(String(this.largeJob()?.status || '')) }
    ];
  }

  lastWorkerResultText(): string {
    const result = this.lastWorkerResult();
    if (!result) return '';
    const first = Array.isArray(result.results) ? result.results[0] : result;
    if (!first) return 'No queued jobs were ready.';
    return first.ok === false ? first.message || 'Worker failed.' : `${first.status || this.largeJob()?.status || 'processed'} · ${first.processedChunks || 0} chunk(s)`;
  }

  async prepareLargeMigrationJob(): Promise<void> {
    if (!this.canPrepareLargeMigration()) {
      this.error.set('Select an Excel, CSV, or ZIP file first.');
      return;
    }
    if (!this.fileBase64() && this.isCsvFileSelected()) {
      await this.stageCsvMigrationChunks();
      return;
    }
    if (!this.summary()) await this.analyze();
    const rows = this.previewChunkRows();
    if (!rows.length) {
      this.error.set('Analyze did not return preview rows to stage. Re-run Analyze and try again.');
      return;
    }
    const totalRows = this.summary()?.totalRows || rows.length;
    if (!this.isCsvFileSelected() && totalRows > rows.length) {
      this.error.set('ZIP/Excel large migration cannot be queued from the 500-row preview. Use Final import for this package, or export CSV and stage CSV chunks.');
      return;
    }
    try {
      this.loading.set(true);
      this.error.set('');
      const job = await firstValueFrom(this.api.post<LargeMigrationJob>('migration/large-jobs', {
        sourceSoftware: this.sourceSoftware,
        resource: this.resource || 'auto',
        fileName: this.fileName(),
        fileSizeBytes: this.fileSize(),
        sourceFileHash: this.fileSha256() || ((this.summary() as any)?.sourceEvidence?.sha256 || ''),
        totalRows,
        chunkSize: this.largeChunkSize(),
        mapping: Object.fromEntries(this.mappingDraft().filter((row) => row.sourceColumn).map((row) => [row.sourceColumn, row.targetField]))
      }));
      const registered = await firstValueFrom(this.api.post<LargeMigrationJob>(`migration/large-jobs/${job.id}/chunks`, {
        chunkNumber: 1,
        totalRows: rows.length,
        rowStart: 1,
        rowEnd: rows.length,
        sourceSheet: this.previewRows()[0]?.sourceSheet || 'preview'
      }));
      const analyzed = await firstValueFrom(this.api.post<any>(`migration/large-jobs/${job.id}/chunks/1/analyze`, {
        rows,
        duplicateDecisions: this.duplicateDecisions()
      }));
      this.largeJob.set(analyzed.job || registered || job);
      this.message.set('Large migration chunk 1 staged. Queue worker after approval.');
    } catch (err: any) {
      this.error.set(this.api.errorText(err, 'Unable to prepare large migration job.'));
    } finally {
      this.loading.set(false);
    }
  }

  canPrepareLargeMigration(): boolean {
    return this.hasSelectedSourcePayload() || this.isCsvFileSelected();
  }

  isCsvFileSelected(): boolean {
    return this.isCsvFile(this.selectedSourceFile);
  }

  async stageCsvMigrationChunks(): Promise<void> {
    const file = this.selectedSourceFile;
    if (!this.isCsvFile(file)) {
      this.error.set('Select a CSV file for multi-chunk staging.');
      return;
    }
    try {
      this.loading.set(true);
      this.error.set('');
      this.message.set('Streaming CSV chunks to backend parser...');
      const chunkSize = Math.max(100, this.largeChunkSize());
      const mapping = Object.fromEntries(this.mappingDraft().filter((row) => row.sourceColumn).map((row) => [row.sourceColumn, row.targetField]));
      const estimatedRows = await this.estimateCsvRows(file);
      const job = await firstValueFrom(this.api.post<LargeMigrationJob>('migration/large-jobs', {
        sourceSoftware: this.sourceSoftware,
        resource: this.resource || 'auto',
        fileName: this.fileName(),
        fileSizeBytes: this.fileSize(),
        totalRows: estimatedRows,
        chunkSize,
        mapping
      }));
      let latest: LargeMigrationJob = job;
      let header: string[] = [];
      let chunkRecords: string[] = [];
      let chunkNumber = 1;
      let stagedRows = 0;
      for await (const line of this.csvLineIterator(file)) {
        if (!header.length) {
          header = this.parseCsvRecords(line).shift() || [];
          continue;
        }
        if (!line.trim()) continue;
        chunkRecords.push(line);
        if (chunkRecords.length >= chunkSize) {
          latest = await this.stageCsvTextChunk(job.id, chunkNumber, header, chunkRecords, stagedRows + 1);
          stagedRows += chunkRecords.length;
          this.largeJob.set(latest);
          this.csvStagedRows.set(stagedRows);
          this.csvStagedChunks.set(chunkNumber);
          this.migrationProgress.set(estimatedRows ? Math.round((stagedRows / estimatedRows) * 65) : Math.min(65, chunkNumber * 5));
          chunkNumber++;
          chunkRecords = [];
        }
      }
      if (!header.length) {
        this.error.set('CSV header row is missing.');
        return;
      }
      if (chunkRecords.length) {
        latest = await this.stageCsvTextChunk(job.id, chunkNumber, header, chunkRecords, stagedRows + 1);
        stagedRows += chunkRecords.length;
        this.csvStagedChunks.set(chunkNumber);
      }
      this.largeJob.set(latest);
      this.csvStagedRows.set(stagedRows);
      this.summary.set({
        totalRows: stagedRows,
        validRows: Number(latest.validRows || 0),
        warningRows: Number(latest.warningRows || 0),
        errorRows: Number(latest.errorRows || 0),
        duplicateRows: 0,
        affectedRecords: Number(latest.validRows || 0) + Number(latest.warningRows || 0),
        byEntity: {}
      });
      this.previewRows.set([]);
      this.message.set(`${stagedRows} CSV rows streamed across ${this.csvStagedChunks()} chunk(s). Submit approval, then queue worker.`);
    } catch (err: any) {
      this.error.set(this.api.errorText(err, 'Unable to stream CSV chunks.'));
    } finally {
      this.loading.set(false);
    }
  }

  private async stageCsvTextChunk(jobId: string, chunkNumber: number, header: string[], records: string[], rowStart: number): Promise<LargeMigrationJob> {
    const csvText = records.join('\n');
    const analyzed = await firstValueFrom(this.api.post<any>(`migration/large-jobs/${jobId}/chunks/${chunkNumber}/stage-csv`, {
      header,
      csvText,
      rowStart,
      rowEnd: rowStart + records.length - 1,
      sourceSheet: 'csv',
      duplicateDecisions: this.duplicateDecisions()
    }));
    return analyzed.job || this.largeJob() || { id: jobId, status: 'draft' };
  }

  private async estimateCsvRows(file: File): Promise<number> {
    let rows = 0;
    for await (const line of this.csvLineIterator(file)) {
      if (rows === 0 || line.trim()) rows++;
    }
    return Math.max(0, rows - 1);
  }

  private async *csvLineIterator(file: File): AsyncGenerator<string> {
    const reader = file.stream().pipeThrough(new TextDecoderStream()).getReader();
    let buffer = '';
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += value;
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() || '';
        for (const line of lines) yield line;
      }
      if (buffer) yield buffer;
    } finally {
      reader.releaseLock();
    }
  }
  private isCsvFile(file: File | null): file is File {
    return Boolean(file && (file.name.toLowerCase().endsWith('.csv') || file.type === 'text/csv'));
  }

  private isZipFile(file: File | null): file is File {
    return Boolean(file && file.name.toLowerCase().endsWith('.zip'));
  }

  private isAuraReadyPackage(name = this.fileName()): boolean {
    const lower = String(name || '').toLowerCase();
    return lower.endsWith('.zip') && (lower.includes('aura-app-import-ready') || lower.includes('aura-import-') || lower.startsWith('aura-'));
  }

  private parseCsvRows(text: string): Record<string, string>[] {
    const records = this.parseCsvRecords(text.replace(/^\uFEFF/, ''));
    const headers = (records.shift() || []).map((header) => String(header || '').trim());
    if (!headers.length) return [];
    return records
      .filter((record) => record.some((value) => String(value || '').trim()))
      .map((record) => Object.fromEntries(headers.map((header, index) => [header || `column${index + 1}`, record[index] ?? ''])));
  }

  private parseCsvRecords(text: string): string[][] {
    const rows: string[][] = [];
    let row: string[] = [];
    let field = '';
    let quoted = false;
    for (let index = 0; index < text.length; index++) {
      const char = text[index];
      const next = text[index + 1];
      if (quoted) {
        if (char === '"' && next === '"') {
          field += '"';
          index++;
        } else if (char === '"') {
          quoted = false;
        } else {
          field += char;
        }
        continue;
      }
      if (char === '"') {
        quoted = true;
      } else if (char === ',') {
        row.push(field);
        field = '';
      } else if (char === '\n') {
        row.push(field);
        rows.push(row);
        row = [];
        field = '';
      } else if (char !== '\r') {
        field += char;
      }
    }
    row.push(field);
    if (row.some((value) => value !== '') || field) rows.push(row);
    return rows;
  }
  async queueLargeMigrationJob(): Promise<void> {
    const job = this.largeJob();
    if (!job) return;
    try {
      this.loading.set(true);
      this.error.set('');
      const queued = await firstValueFrom(this.api.post<LargeMigrationJob>(`migration/large-jobs/${job.id}/queue`, {
        maxChunks: this.largeMaxChunks(),
        stopOnError: true,
        migrationMode: true,
        allowPartialImport: this.allowPartialLargeImport()
      }));
      this.largeJob.set(queued);
      this.message.set('Large migration queued. Worker will process staged chunks.');
    } catch (err: any) {
      this.error.set(this.api.errorText(err, 'Unable to queue large migration job.'));
    } finally {
      this.loading.set(false);
    }
  }

  async runWorkerTick(): Promise<void> {
    try {
      this.loading.set(true);
      this.error.set('');
      const result = await firstValueFrom(this.api.post<any>('migration/large-jobs/worker/tick', {
        maxJobs: 1,
        maxChunks: this.largeMaxChunks(),
        allowPartialImport: this.allowPartialLargeImport()
      }));
      this.lastWorkerResult.set(result);
      await this.refreshLargeJob();
      this.message.set('Worker tick completed.');
    } catch (err: any) {
      this.error.set(this.api.errorText(err, 'Worker tick failed.'));
    } finally {
      this.loading.set(false);
    }
  }

  async refreshLargeJobStatus(): Promise<void> {
    await this.refreshLargeJob();
    this.message.set('Large migration status refreshed.');
  }

  async pauseLargeMigrationJob(): Promise<void> {
    const job = this.largeJob();
    if (!job) return;
    try {
      this.loading.set(true);
      this.error.set('');
      const paused = await firstValueFrom(this.api.post<LargeMigrationJob>(`migration/large-jobs/${job.id}/pause`, { reason: 'operator pause from command center' }));
      this.largeJob.set(paused);
      this.message.set('Large migration paused. Resume when ready.');
    } catch (err: any) {
      this.error.set(this.api.errorText(err, 'Unable to pause large migration.'));
    } finally {
      this.loading.set(false);
    }
  }

  async cancelLargeMigrationJob(): Promise<void> {
    const job = this.largeJob();
    if (!job) return;
    if (!confirm('Cancel this large migration job? Imported chunks will remain; pending chunks will be cancelled.')) return;
    try {
      this.loading.set(true);
      this.error.set('');
      const cancelled = await firstValueFrom(this.api.post<LargeMigrationJob>(`migration/large-jobs/${job.id}/cancel`, { reason: 'operator cancel from command center' }));
      this.largeJob.set(cancelled);
      this.message.set('Large migration cancelled.');
    } catch (err: any) {
      this.error.set(this.api.errorText(err, 'Unable to cancel large migration.'));
    } finally {
      this.loading.set(false);
    }
  }

  async discardLargeMigrationJob(): Promise<void> {
    const job = this.largeJob();
    if (!job) {
      this.error.set('No large import job is selected to clear.');
      return;
    }
    // No window.confirm() here: in embedded webviews confirm() is suppressed and
    // returns false, which made the button silently do nothing. The action only
    // deletes this job's staged analysis (no live records), so proceed directly.
    const jobId = job.id;
    try {
      this.loading.set(true);
      this.error.set('');
      this.message.set('Clearing old failed import…');
      const result = await firstValueFrom(this.api.post<any>(`migration/large-jobs/${jobId}/discard`, {}));
      // Reset all large-import UI state back to a fresh upload.
      this.stopLargeUploadPolling();
      this.largeJob.set(null);
      this.summary.set(null);
      this.previewRows.set([]);
      this.lastWorkerResult.set(null);
      this.csvStagedRows.set(0);
      this.csvStagedChunks.set(0);
      this.largeUploadStatus.set('idle');
      this.largeUploadProgress.set(0);
      this.normalizerResult.set(null);
      this.fileBase64.set('');
      this.fileRef.set('');
      this.fileSha256.set('');
      this.fileName.set('');
      this.fileSize.set(0);
      this.rawSourceFileName.set('');
      this.selectedSourceFile = null;
      // Clear the native file input so it shows "No file chosen" and re-picking
      // the same ZIP fires the change event again.
      if (this.sourceFileInput) this.sourceFileInput.nativeElement.value = '';
      // Force the next upload to create a brand-new job + fresh analysis, never
      // reusing any cached job for the same file.
      this.forceFreshNextUpload.set(true);
      this.message.set(result?.message || 'Old failed import cleared. Please upload again.');
    } catch (err: any) {
      // eslint-disable-next-line no-console
      console.error('discardLargeMigrationJob failed for', jobId, err);
      const text = this.api.errorText(err, 'Could not clear old import job. Please check API server.');
      // If the job no longer exists server-side, it is effectively already
      // cleared — reset the UI so the operator is never stuck on a ghost job.
      if (/not found/i.test(text)) {
        this.stopLargeUploadPolling();
        this.largeJob.set(null);
        this.summary.set(null);
        this.previewRows.set([]);
        this.lastWorkerResult.set(null);
        this.largeUploadStatus.set('idle');
        this.largeUploadProgress.set(0);
        this.message.set('Old failed import cleared. Please upload again.');
      } else {
        this.error.set(text);
      }
    } finally {
      this.loading.set(false);
    }
  }

  async retryFailedLargeMigrationChunks(): Promise<void> {
    const job = this.largeJob();
    if (!job) return;
    try {
      this.loading.set(true);
      this.error.set('');
      const retry = await firstValueFrom(this.api.post<LargeMigrationJob>(`migration/large-jobs/${job.id}/retry-failed`, {
        maxChunks: this.largeMaxChunks(),
        stopOnError: true,
        migrationMode: true,
        allowPartialImport: this.allowPartialLargeImport(),
        includeCancelled: job.status === 'cancelled'
      }));
      this.largeJob.set(retry);
      this.message.set('Failed chunks reset for retry. Queue or resume the worker.');
    } catch (err: any) {
      this.error.set(this.api.errorText(err, 'Unable to retry failed chunks.'));
    } finally {
      this.loading.set(false);
    }
  }
  async resumeLargeMigrationJob(): Promise<void> {
    const job = this.largeJob();
    if (!job) return;
    try {
      this.loading.set(true);
      this.error.set('');
      const result = await firstValueFrom(this.api.post<any>(`migration/large-jobs/${job.id}/resume`, {
        maxChunks: this.largeMaxChunks(),
        stopOnError: true,
        migrationMode: true,
        allowPartialImport: this.allowPartialLargeImport(),
        includeCancelled: job.status === 'cancelled'
      }));
      this.lastWorkerResult.set(result);
      this.largeJob.set(result.job || this.largeJob());
      this.message.set('Large migration resume completed.');
    } catch (err: any) {
      this.error.set(this.api.errorText(err, 'Unable to resume large migration.'));
    } finally {
      this.loading.set(false);
    }
  }

  proofStatus(): string {
    const snapshot = this.latestLargeReconciliation();
    if (snapshot?.status) return snapshot.status;
    const reconciliation = this.reconciliationResult();
    if (reconciliation) return reconciliation.matched ? 'Matched' : 'Mismatch';
    return 'Not checked';
  }

  async runProofCheck(): Promise<void> {
    if (this.largeJob()) {
      await this.runLargeJobReconciliation();
      return;
    }
    await this.runReconciliation();
  }

  downloadProofReport(): void {
    if (this.latestLargeReconciliation()) {
      this.downloadLargeReconciliationReport();
      return;
    }
    this.downloadDirectReconciliationReport();
  }

  private downloadDirectReconciliationReport(): void {
    const reconciliation = this.reconciliationResult();
    if (!reconciliation) {
      this.error.set('Run proof check before exporting the migration report.');
      return;
    }
    const report = {
      generatedAt: new Date().toISOString(),
      tenantScope: 'current tenant and branch headers',
      fileName: this.fileName(),
      sourceSoftware: this.sourceSoftware,
      resource: this.resource || 'auto',
      summary: this.summary(),
      reconciliation,
      clientNote: 'Direct import proof generated from the selected source file and latest analyze context.'
    };
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const safeName = String(this.fileName() || 'direct-import').replace(/[^a-z0-9._-]+/gi, '-');
    link.href = url;
    link.download = `migration-proof-${safeName}.json`;
    link.click();
    URL.revokeObjectURL(url);
    this.message.set('Migration proof report exported.');
  }
  async runLargeJobReconciliation(): Promise<void> {
    const job = this.largeJob();
    if (!job) return;
    try {
      this.loading.set(true);
      this.error.set('');
      const result = await firstValueFrom(this.api.post<{ job: LargeMigrationJob; snapshot: LargeReconciliationSnapshot }>(`migration/large-jobs/${job.id}/reconcile`, {
        snapshotType: 'post_import_operator_check'
      }));
      this.largeJob.set(result.job || this.largeJob());
      this.message.set(`Proof check saved: ${result.snapshot.status || 'completed'}.`);
    } catch (err: any) {
      this.error.set(this.api.errorText(err, 'Unable to run migration proof check.'));
    } finally {
      this.loading.set(false);
    }
  }
  downloadLargeReconciliationReport(): void {
    const job = this.largeJob();
    const snapshot = this.latestLargeReconciliation();
    if (!job || !snapshot) {
      this.error.set('Run proof check before exporting the migration report.');
      return;
    }
    const report = {
      generatedAt: new Date().toISOString(),
      tenantScope: 'current tenant and branch headers',
      job: {
        id: job.id,
        status: job.status,
        totalRows: job.totalRows || 0,
        processedRows: job.processedRows || 0,
        importedRows: job.importedRows || 0,
        skippedRows: job.skippedRows || 0,
        errorRows: job.errorRows || 0,
        warningRows: job.warningRows || 0,
        chunkSize: job.chunkSize || 0,
        resumeToken: job.resumeToken || ''
      },
      chunks: job.chunks || [],
      chunkManifest: (job.chunks || []).map((chunk) => ({
        chunkNumber: chunk.chunkNumber,
        status: chunk.status,
        totalRows: chunk.totalRows || 0,
        importedRows: chunk.importedRows || 0,
        skippedRows: chunk.skippedRows || 0,
        errorRows: chunk.errorRows || 0,
        warningRows: chunk.warningRows || 0,
        checksum: chunk.checksum || '',
        completedAt: chunk.completedAt || '',
        failureReason: chunk.failureReason || ''
      })),
      reconciliation: snapshot,
      handover: {
        status: snapshot.status,
        differences: snapshot.differences || [],
        clientNote: 'Use this proof file with the import batch and rollback history for migration sign-off.'
      }
    };
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `migration-proof-${job.id}-${snapshot.id}.json`;
    link.click();
    URL.revokeObjectURL(url);
    this.message.set('Migration proof report exported.');
  }
  private syncSummaryFromLargeJob(): void {
    const job = this.largeJob();
    if (!job) return;
    this.summary.set({
      totalRows: Number(job.totalRows || 0),
      validRows: Number(job.validRows || 0),
      warningRows: Number(job.warningRows || 0),
      errorRows: Number(job.errorRows || 0),
      duplicateRows: 0,
      affectedRecords: Number(job.totalRows || 0),
      byEntity: {}
    });
  }
  private async refreshLargeJob(): Promise<void> {
    const job = this.largeJob();
    if (!job?.id) return;
    try {
      const fresh = await firstValueFrom(this.api.get<LargeMigrationJob>('migration/large-jobs', job.id));
      this.largeJob.set(fresh);
    } catch {
      // Keep the visible local job state if refresh fails.
    }
  }

  private previewChunkRows(): any[] {
    return this.previewRows().map((row) => {
      if (row?.raw && Object.keys(row.raw).length) return row.raw;
      if (row?.fields && Object.keys(row.fields).length) return row.fields;
      return row?.payload || row;
    }).filter((row) => row && Object.keys(row).length);
  }
  closeJobDetail(): void {
    this.selectedJob.set(null);
    this.selectedJobRecovery.set(null);
  }

  async loadJobRecovery(jobId: string): Promise<void> {
    try {
      this.loading.set(true);
      this.error.set('');
      const [job, recovery] = await Promise.all([
        firstValueFrom(this.api.get<any>('migration/jobs', jobId)),
        firstValueFrom(this.api.get<MigrationRecoveryReport>('migration/jobs', `${jobId}/recovery`))
      ]);
      this.selectedJob.set(job || null);
      this.selectedJobRecovery.set(recovery || null);
      this.message.set(recovery?.blockers?.length ? 'Recovery report loaded with blockers.' : 'Recovery report loaded.');
    } catch (err: any) {
      this.error.set(this.api.errorText(err, 'Unable to load recovery report.'));
    } finally {
      this.loading.set(false);
    }
  }

  exportRecoveryReport(): void {
    const report = this.selectedJobRecovery();
    const job = this.selectedJob();
    if (!report || !job) return;
    const blob = new Blob([JSON.stringify({ jobId: job.id, fileName: job.fileName, exportedAt: new Date().toISOString(), report }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `migration-recovery-${job.id}.json`;
    link.click();
    URL.revokeObjectURL(url);
    this.message.set('Recovery report exported.');
  }

  exportRecoveryFailedRows(): void {
    const rows = this.recoveryFailedRows().map((row) => ({
      rowKey: row.rowKey,
      resource: row.resource,
      sourceExternalId: row.sourceExternalId || '',
      message: row.message,
      retryReason: row.retryReason
    }));
    this.downloadCsv('migration-recovery-failed-rows.csv', rows);
  }
  async rollbackRecoveryJob(): Promise<void> {
    const job = this.selectedJob();
    if (!job?.id) return;
    await this.rollback(job.id);
  }
  async rollback(jobId: string): Promise<void> {
    if (!confirm('Rollback selected import records delete karega. Continue?')) return;
    try {
      this.loading.set(true);
      const result = await firstValueFrom(this.api.post<any>(`migration/jobs/${jobId}/rollback`, { reason: this.rollbackReason() || 'manual rollback' }));
      this.message.set(result.message || 'Rollback complete.');
      await this.loadJobs();
    } catch (err: any) {
      this.error.set(this.api.errorText(err, 'Rollback failed.'));
    } finally {
      this.loading.set(false);
    }
  }

  async rollbackLast(): Promise<void> {
    if (!confirm('Rollback last imported batch?')) return;
    try {
      this.loading.set(true);
      const result = await firstValueFrom(this.api.post<any>('migration/rollback/last', { reason: this.rollbackReason() || 'manual rollback last import' }));
      this.message.set(result.message || 'Rollback last import complete.');
      await this.loadJobs();
    } catch (err: any) {
      this.error.set(this.api.errorText(err, 'Rollback failed.'));
    } finally {
      this.loading.set(false);
    }
  }

  async loadJobs(): Promise<void> {
    try {
      const jobs = await firstValueFrom(this.api.list<any[]>('migration/jobs'));
      this.jobs.set(jobs || []);
      const onboarding = await firstValueFrom(this.api.list<any>('migration/onboarding'));
      this.onboarding.set(onboarding || null);
      await this.loadLiveClientStats();
    } catch {
      this.jobs.set([]);
    }
  }

  async loadResumableUploadSessions(): Promise<void> {
    try {
      const sessions = await firstValueFrom(this.api.list<any[]>('migration/uploads/sessions', { status: 'open', limit: 20 }));
      this.resumableUploadSessions.set(Array.isArray(sessions) ? sessions : []);
    } catch {
      this.resumableUploadSessions.set([]);
    }
  }

  async runCommandCenterScan(): Promise<void> {
    if (!this.hasSelectedSourcePayload()) {
      this.error.set('Select an Excel / CSV / ZIP file first.');
      return;
    }
    try {
      this.loading.set(true);
      this.error.set('');
      const report = await firstValueFrom(this.api.post<any>('migration/command-center', {
        sourceSoftware: this.sourceSoftware,
        resource: this.resource,
        mapping: Object.fromEntries(this.mappingDraft().filter((row) => row.sourceColumn).map((row) => [row.sourceColumn, row.targetField])),
        duplicateDecisions: this.duplicateDecisions(),
        simulationMode: 'branch_franchise_preview',
        ...this.sourceFilePayload()
      }));
      this.commandCenterReport.set(report || null);
      this.message.set('Advanced migration command-center scan complete.');
      await this.loadResumableUploadSessions();
    } catch (err: any) {
      this.error.set(this.api.errorText(err, 'Unable to run advanced migration scan.'));
    } finally {
      this.loading.set(false);
    }
  }

  async downloadBackendProofPack(): Promise<void> {
    try {
      this.loading.set(true);
      this.error.set('');
      const activeJob = this.selectedJob()?.id || this.currentFileImportJob()?.id || this.largeJob()?.id || '';
      const pack = await firstValueFrom(this.api.post<any>('migration/proof-pack', activeJob ? { jobId: activeJob } : {}));
      this.proofPack.set(pack || null);
      const blob = new Blob([JSON.stringify(pack || {}, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `migration-proof-pack-${activeJob || 'recent'}.json`;
      anchor.click();
      URL.revokeObjectURL(url);
      this.message.set('Backend migration proof pack exported.');
    } catch (err: any) {
      this.error.set(this.api.errorText(err, 'Unable to export backend proof pack.'));
    } finally {
      this.loading.set(false);
    }
  }
  async loadLiveClientStats(): Promise<void> {
    try {
      const clients = await firstValueFrom(this.api.list<any[]>('clients', { limit: 10000 }));
      const rows = clients || [];
      this.liveClientStats.set({
        total: rows.length,
        migrated: rows.filter((client) => Number(client.imported || 0) === 1 || client.importBatchId || client.migrationBatchId).length
      });
    } catch {
      this.liveClientStats.set({ total: 0, migrated: 0 });
    }
  }

  async loadIntelligence(): Promise<void> {
    try {
      const [adapters, templates, mappings] = await Promise.all([
        firstValueFrom(this.api.list<Record<string, SourceAdapter>>('migration/adapters')),
        firstValueFrom(this.api.list<Record<string, MigrationTemplate>>('migration/templates')),
        firstValueFrom(this.api.list<any[]>('migration/mappings'))
      ]);
      this.adapters.set(adapters || {});
      this.templates.set(templates || {});
      this.mappings.set(mappings || []);
      this.rebuildMappingDraft();
    } catch {
      this.adapters.set({});
      this.templates.set({});
      this.mappings.set([]);
      this.rebuildMappingDraft();
    }
  }

  setExpectedTotal(key: string, value: unknown): void {
    const amount = Number(value || 0);
    this.expectedTotals.update((current) => ({
      ...current,
      [key]: Number.isFinite(amount) ? amount : 0
    }));
  }

  async runReconciliation(): Promise<void> {
    if (!this.hasSelectedSourcePayload()) {
      this.error.set('Select an Excel / CSV / ZIP file first.');
      return;
    }
    try {
      this.loading.set(true);
      this.error.set('');
      const result = await firstValueFrom(this.api.post<any>('migration/reconcile', {
        sourceSoftware: this.sourceSoftware,
        resource: this.resource,
        migrationMode: true,
        ...this.sourceFilePayload(),
        expected: this.expectedTotals()
      }));
      this.reconciliationResult.set(result || null);
      this.message.set(result?.matched ? 'Reconciliation matched.' : 'Reconciliation completed with differences.');
    } catch (err: any) {
      this.error.set(this.api.errorText(err, 'Reconciliation failed.'));
    } finally {
      this.loading.set(false);
    }
  }

  clearReconciliation(): void {
    this.reconciliationResult.set(null);
    this.expectedTotals.set({});
  }

  async loadApprovals(): Promise<void> {
    try {
      this.approvalDebug.set('');
      const rows = await firstValueFrom(this.api.list<ApprovalRecord[]>('migration/approvals'));
      const safeRows = Array.isArray(rows) ? rows : [];
      this.approvals.set(safeRows);
      if (!safeRows.length) {
        this.approvalDebug.set('No approval records found from backend yet.');
      }
    } catch (err: any) {
      this.approvals.set([]);
      this.approvalDebug.set(this.api.errorText(err, 'Approval refresh failed. Check /migration/approvals route.'));
    }
  }

  latestPendingApproval(): ApprovalRecord | null {
    return this.approvals().find((approval) => approval.status === 'pending' && this.approvalMatchesActiveUpload(approval)) || null;
  }

  private approvedApproval(): ApprovalRecord | null {
    return this.approvals().find((approval) => approval.status === 'approved' && this.approvalMatchesActiveUpload(approval)) || null;
  }
  private activeApprovalIdentity(): { jobId: string; sourceFileHash: string; fileName: string; totalRows: number; resource: string; sourceSoftware: string } {
    const job = this.largeJob();
    const summary = this.summary() as any;
    const sourceEvidence = summary?.sourceEvidence || job?.settings?.sourceEvidence || {};
    return {
      jobId: String(job?.id || ''),
      sourceFileHash: String(this.fileSha256() || job?.sourceFileHash || job?.settings?.sourceFileHash || sourceEvidence?.sha256 || ''),
      fileName: String(job?.fileName || this.fileName() || sourceEvidence?.fileName || ''),
      totalRows: Number(job?.totalRows || summary?.totalRows || 0),
      resource: String(job?.resource || this.resource || 'auto'),
      sourceSoftware: String(job?.sourceSoftware || this.sourceSoftware || '')
    };
  }

  private approvalMatchesActiveUpload(approval: ApprovalRecord | null | undefined): boolean {
    if (!approval) return false;
    const active = this.activeApprovalIdentity();
    const approvalJobId = this.approvalText(approval.jobId);
    if (active.jobId && approvalJobId && approvalJobId === active.jobId) return true;
    if (!this.approvalScopeMatches(approval, active)) return false;

    const approvalHash = this.approvalText(approval.sourceFileHash);
    if (active.sourceFileHash && approvalHash && approvalHash === active.sourceFileHash) return true;

    const approvalFileName = this.approvalFileName(approval.fileName);
    const activeFileName = this.approvalFileName(active.fileName);
    const approvalRows = Number(approval.totalRows || 0);
    return Boolean(approvalFileName && activeFileName && approvalFileName === activeFileName && approvalRows > 0 && approvalRows === active.totalRows);
  }

  private approvalScopeMatches(approval: ApprovalRecord, active: { resource: string; sourceSoftware: string }): boolean {
    const approvalResource = this.approvalResourceKey(approval.resource);
    const activeResource = this.approvalResourceKey(active.resource);
    const resourceMatches = !approvalResource || !activeResource || approvalResource === 'auto' || activeResource === 'auto' || approvalResource === activeResource;
    const approvalSource = this.approvalText(approval.sourceSoftware).toLowerCase();
    const activeSource = this.approvalText(active.sourceSoftware).toLowerCase();
    const sourceMatches = !approvalSource || !activeSource || approvalSource === activeSource;
    return resourceMatches && sourceMatches;
  }

  private approvalResourceKey(value: string | undefined): string {
    return this.approvalText(value).toLowerCase().replace(/[_\-.]+/g, ' ').replace(/\s+/g, ' ').trim();
  }

  private approvalFileName(value: string | undefined): string {
    return this.approvalText(value).toLowerCase().split(/[\\/]/).pop() || '';
  }

  private approvalText(value: string | undefined): string {
    return String(value || '').trim();
  }
  async submitApproval(): Promise<void> {
    if (!this.summary()) {
      if (!this.hasSelectedSourcePayload()) {
        this.error.set('Select a file before approval.');
        return;
      }
      await this.analyze();
      if (!this.summary()) {
        this.error.set('Analyze summary is missing for approval. Check the network response.');
        return;
      }
    }

    try {
      this.loading.set(true);
      this.error.set('');
      this.approvalDebug.set('');
      const summary = this.summary();
      const sourceEvidence = (summary as any)?.sourceEvidence || null;
      const approvalIdentity = this.activeApprovalIdentity();
      const errorCount = Number(summary?.errorRows || this.largeJob()?.errorRows || 0);
      const warningCount = Number(summary?.warningRows || this.largeJob()?.warningRows || 0);
      const validRows = Number(summary?.validRows || this.largeJob()?.validRows || 0);
      const importableRows = validRows + warningCount;
      const approvalSourceEvidence = { ...(sourceEvidence || {}), fileName: approvalIdentity.fileName, sha256: approvalIdentity.sourceFileHash };
      const approval = await firstValueFrom(this.api.post<ApprovalRecord>('migration/approvals', {
        jobId: approvalIdentity.jobId,
        resource: this.resource || 'auto',
        sourceSoftware: this.sourceSoftware,
        fileName: approvalIdentity.fileName,
        sourceFileHash: approvalIdentity.sourceFileHash,
        totalRows: approvalIdentity.totalRows,
        errorCount,
        warningCount,
        validRows,
        importableRows,
        sourceEvidence: approvalSourceEvidence,
        note: this.approvalNote || this.goLiveGate(),
        summary: {
          readinessScore: this.readinessScore(),
          dataQualityScore: this.dataQualityScore ? this.dataQualityScore() : undefined,
          summary,
          sourceEvidence: approvalSourceEvidence,
          reconciliation: this.reconciliationResult(),
          duplicateDecisions: this.duplicateDecisions()
        }
      }));

      if (!approval?.id) {
        this.approvalDebug.set('Backend approval response did not include an id. Check migrationService.submitApproval response.');
      }

      this.approvals.update((current) => {
        const withoutDuplicate = current.filter((item) => item.id !== approval?.id);
        return approval?.id ? [approval, ...withoutDuplicate] : current;
      });

      this.message.set(`Approval request submitted: ${approval?.status || 'pending'}.`);
      await this.loadApprovals();
    } catch (err: any) {
      const text = this.api.errorText(err, 'Unable to submit approval.');
      this.error.set(text);
      this.approvalDebug.set(text);
    } finally {
      this.loading.set(false);
    }
  }

  async decideApproval(id: string, decision: 'approved' | 'rejected'): Promise<void> {
    if (!id) {
      this.approvalDebug.set('No pending approval selected. Submit for approval first.');
      return;
    }
    try {
      this.loading.set(true);
      this.error.set('');
      this.approvalDebug.set('');
      const approval = await firstValueFrom(this.api.post<ApprovalRecord>(`migration/approvals/${id}/decide`, {
        decision,
        note: this.approvalNote || decision
      }));

      this.approvals.update((current) => current.map((item) => item.id === id ? approval : item));
      this.message.set(`Approval ${approval?.status || decision}.`);
      await this.loadApprovals();

      const shouldResumeFinalImport = decision === 'approved' && this.resumeFinalImportAfterApproval && this.importApprovalReady();
      if (decision === 'rejected') this.resumeFinalImportAfterApproval = false;
      if (shouldResumeFinalImport) {
        this.resumeFinalImportAfterApproval = false;
        this.loading.set(false);
        this.message.set('Approval approved. Starting final import...');
        await this.runImport({ skipConfirmation: true });
      }
    } catch (err: any) {
      const text = this.api.errorText(err, 'Unable to update approval.');
      this.error.set(text);
      this.approvalDebug.set(text);
    } finally {
      this.loading.set(false);
    }
  }

  async loadJobDetail(jobId: string): Promise<void> {
    try {
      this.loading.set(true);
      this.error.set('');
      const job = await firstValueFrom(this.api.get<any>('migration/jobs', jobId));
      this.selectedJob.set(job || null);
    } catch (err: any) {
      this.error.set(this.api.errorText(err, 'Unable to load migration job.'));
    } finally {
      this.loading.set(false);
    }
  }

  applySavedMapping(mappingId: string): void {
    const mapping = this.mappings().find((item) => item.id === mappingId);
    if (!mapping) {
      this.rebuildMappingDraft();
      return;
    }
    this.resource = mapping.resource || this.resource || 'clients';
    const saved = mapping.mapping || {};
    this.mappingDraft.set(this.templateColumns().map((column) => ({
      targetField: column.field,
      sourceColumn: this.sourceForTarget(saved, column.field) || column.aliases[0] || column.field,
      required: column.required,
      confidence: this.mappingConfidence(column.required, true),
      aliases: column.aliases || []
    })));
    this.message.set(`${mapping.name || 'Mapping profile'} loaded.`);
  }

  async saveMappingProfile(): Promise<void> {
    const resource = this.resource || 'clients';
    const mapping = Object.fromEntries(this.mappingDraft().filter((row) => row.sourceColumn).map((row) => [row.sourceColumn, row.targetField]));
    try {
      this.loading.set(true);
      await firstValueFrom(this.api.post<any>('migration/mappings', {
        sourceSoftware: this.sourceSoftware,
        resource,
        name: `${this.selectedSourceLabel()} ${this.label(resource)} mapping`,
        mapping,
        unmatchedColumns: [],
        requiredFields: this.templates()[resource]?.required || []
      }));
      this.message.set('Mapping profile saved for future imports.');
      await this.loadIntelligence();
    } catch (err: any) {
      this.error.set(this.api.errorText(err, 'Unable to save mapping profile.'));
    } finally {
      this.loading.set(false);
    }
  }

  setMappingSource(targetField: string, sourceColumn: string): void {
    this.mappingDraft.update((rows) => rows.map((row) => row.targetField === targetField
      ? { ...row, sourceColumn, confidence: this.mappingConfidence(row.required, Boolean(sourceColumn)) }
      : row
    ));
  }

  duplicateDecision(row: any): 'merge' | 'keep' | 'link' | '' {
    return this.duplicateDecisions()[this.rowKey(row)] || '';
  }

  setDuplicateDecision(row: any, decision: 'merge' | 'keep' | 'link'): void {
    const key = this.rowKey(row);
    this.duplicateDecisions.update((current) => ({ ...current, [key]: decision }));
  }

  duplicateDecisionCount(): number {
    const decisions = this.duplicateDecisions();
    return this.duplicateRows().filter((row) => decisions[this.rowKey(row)]).length;
  }

  downloadTemplate(): void {
    const columns = this.templateColumns().map((column) => column.field);
    if (!columns.length) return;
    const escape = (value: unknown) => `"${String(value ?? '').replace(/"/g, '""')}"`;
    const csv = `${columns.map(escape).join(',')}\n${this.templateColumns().map((column) => escape(column.example || '')).join(',')}`;
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${this.resource || 'clients'}-migration-template.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  currentFileImportJob(): any | null {
    const name = this.fileName();
    if (!name) return null;
    return this.jobs().find((job) => {
      const status = String(job.status || '');
      return String(job.fileName || '') === name && !job.dryRun && ['completed', 'completed_with_errors', 'importing'].includes(status);
    }) || null;
  }

  alreadyImportedCurrentFile(): boolean {
    const status = String(this.currentFileImportJob()?.status || '');
    return ['completed', 'completed_with_errors'].includes(status);
  }

  private isTimeoutError(err: any): boolean {
    const text = this.api.errorText(err, '').toLowerCase();
    return text.includes('timeout') || text.includes('timed out');
  }

  private async recoverTimedOutImport(): Promise<boolean> {
    await this.loadJobs();
    const job = this.currentFileImportJob();
    if (!job || !['completed', 'completed_with_errors'].includes(String(job.status || ''))) return false;
    this.selectedJob.set(job);
    this.summary.set(job.summary || this.summary());
    this.error.set('');
    this.message.set(`Import completed on backend as job ${job.id}. UI refreshed with latest status.`);
    return true;
  }
  label(value: string): string {
    return String(value || '').replace(/[-_]/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase());
  }

  private async storeSourceEvidenceFile(file: File, purpose: string): Promise<void> {
    try {
      if (file.size > this.migrationUploadChunkBytes) {
        await this.storeSourceEvidenceFileInChunks(file, purpose);
        return;
      }
      const upload = await firstValueFrom(this.api.postBinary<any>('migration/uploads/binary', file, file.name, file.type || 'application/octet-stream'));
      this.fileRef.set(upload?.fileRef || '');
      this.fileSha256.set(upload?.sha256 || '');
      this.message.set(upload?.fileRef ? `Source evidence stored: ${upload.fileRef}` : this.message());
    } catch (err: any) {
      this.fileRef.set('');
      this.fileSha256.set('');
      this.error.set('');
      this.message.set('Source file loaded. Evidence upload will retry later; conversion can continue.');
    }
  }

  private async storeSourceEvidenceFileInChunks(file: File, purpose: string): Promise<void> {
    const totalParts = Math.ceil(file.size / this.migrationUploadChunkBytes);
    const expectedSha256 = await this.fileSha256Hex(file);
    const session = await firstValueFrom(this.api.post<any>('migration/uploads/sessions', {
      fileName: file.name,
      mimeType: file.type || 'application/octet-stream',
      purpose,
      sizeBytes: file.size,
      totalParts,
      sha256: expectedSha256
    }));
    const sessionId = session?.sessionId;
    if (!sessionId) throw new Error('Migration upload session was not created.');
    for (let index = 0; index < totalParts; index += 1) {
      const start = index * this.migrationUploadChunkBytes;
      const chunk = file.slice(start, Math.min(file.size, start + this.migrationUploadChunkBytes));
      await firstValueFrom(this.api.postBinary<any>(`migration/uploads/sessions/${sessionId}/parts/${index + 1}`, chunk, file.name, file.type || 'application/octet-stream'));
      this.message.set(`Source evidence upload ${index + 1}/${totalParts} parts stored.`);
    }
    const upload = await firstValueFrom(this.api.post<any>(`migration/uploads/sessions/${sessionId}/complete`, { sha256: expectedSha256 }));
    this.fileRef.set(upload?.fileRef || '');
    this.fileSha256.set(upload?.sha256 || expectedSha256 || '');
    this.message.set(upload?.fileRef ? `Source evidence stored: ${upload.fileRef}` : this.message());
  }

  private async fileSha256Hex(file: File): Promise<string> {
    const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
    return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, '0')).join('');
  }
  private async storeSourceEvidence(fileName: string, fileBase64: string, purpose: string): Promise<void> {
    if (!fileName || !fileBase64) return;
    try {
      const upload = await firstValueFrom(this.api.post<any>('migration/uploads', { fileName, fileBase64, purpose }));
      this.fileRef.set(upload?.fileRef || '');
      this.fileSha256.set(upload?.sha256 || '');
      this.message.set(upload?.fileRef ? `Source evidence stored: ${upload.fileRef}` : this.message());
    } catch (err: any) {
      this.fileRef.set('');
      this.fileSha256.set('');
      this.message.set('Source file is loaded. Evidence storage will retry on next upload.');
    }
  }

  hasSelectedSourcePayload(): boolean {
    return Boolean(this.fileRef() || this.fileBase64());
  }

  private sourceFilePayload(fileName = this.fileName()): Record<string, unknown> {
    const payload: Record<string, unknown> = { fileName };
    if (this.fileRef()) payload['fileRef'] = this.fileRef();
    else payload['fileBase64'] = this.fileBase64();
    return payload;
  }
  private async callMigration(path: string, successMessage: string, extraPayload: Record<string, unknown> = {}): Promise<void> {
    if (!this.hasSelectedSourcePayload()) {
      this.error.set('Select an Excel / CSV / ZIP file first.');
      return;
    }
    const operation = this.operationFromPath(path);
    try {
      this.loading.set(true);
      this.startMigrationProgress(operation);
      this.error.set('');
      this.message.set('');
      const response = await firstValueFrom(
        this.api.post<any>(path, {
          sourceSoftware: this.sourceSoftware,
          resource: this.resource,
          migrationMode: true,
          sandboxMode: this.sandboxMode(),
          mapping: Object.fromEntries(this.mappingDraft().filter((row) => row.sourceColumn).map((row) => [row.sourceColumn, row.targetField])),
          duplicateDecisions: this.duplicateDecisions(),
          allowPartialImport: this.allowPartialLargeImport(),
          ...this.sourceFilePayload(),
          ...extraPayload
        })
      );
      if (response.duplicateImport) {
        const details = response.details || response.job || null;
        this.selectedJob.set(details);
        this.summary.set(response.summary || details?.summary || this.summary());
        this.previewRows.set(details?.rows || []);
        this.error.set('');
        this.finishMigrationProgress();
        this.message.set(response.message || 'This source file is already imported. Roll back before retrying.');
        await this.loadJobs();
        return;
      }
      this.summary.set(response.summary || null);
      this.previewRows.set(response.rows || response.details?.rows || []);
      this.duplicateDecisions.set({});
      this.finishMigrationProgress();
      this.message.set(successMessage);
      if (path.includes('analyze') || path.includes('dry-run') || path.includes('import')) {
        await this.loadApprovals();
      }
    } catch (err: any) {
      if (this.isTimeoutError(err)) {
        if (path.includes('import') && await this.recoverTimedOutImport()) return;
        await this.loadJobs();
        await this.loadApprovals();
        this.error.set('');
        this.message.set(`${this.activeMigrationLabel()} is taking longer than usual. Status refreshed; keep this page open or use Refresh in migration history.`);
        this.stopMigrationProgress();
        this.migrationProgress.set(Math.max(this.migrationProgress(), 90));
        return;
      }
      this.error.set(this.api.errorText(err, 'Migration failed.'));
    } finally {
      this.loading.set(false);
      if (this.error()) this.stopMigrationProgress();
    }
  }

  dataQualityScore(): number {
    const summary = this.summary();
    if (!summary?.totalRows) return this.hasSelectedSourcePayload() ? 35 : 0;
    const validRate = Number(summary.validRows || 0) / Math.max(1, Number(summary.totalRows || 1));
    const warningPenalty = Math.min(20, Number(summary.warningRows || 0) * 2);
    const errorPenalty = Math.min(35, Number(summary.errorRows || 0) * 5);
    const duplicatePenalty = Math.min(15, Number(summary.duplicateRows || 0) * 2);
    return Math.max(0, Math.min(100, Math.round(validRate * 100) - warningPenalty - errorPenalty - duplicatePenalty));
  }

  importApprovalReady(): boolean {
    return Boolean(this.approvedApproval());
  }

  progressLabel(): string {
    const operation = this.activeMigrationOperation();
    const progress = this.migrationProgress();
    if (!progress) return 'Not started';
    if (operation === 'normalize') return progress < 100 ? 'Converting source package' : 'Package ready';
    if (operation === 'analyze') return progress < 100 ? 'Scanning rows and validation rules' : 'Analyze complete';
    if (operation === 'dry-run') return progress < 100 ? 'Dry-run validation' : 'Dry run complete';
    if (operation === 'import') return progress < 100 ? 'Importing live data' : 'Import complete';
    if (progress < 25) return 'Loading source';
    if (progress < 50) return 'Analyzing records';
    if (progress < 80) return 'Dry-run / validation';
    if (progress < 100) return 'Processing';
    return 'Complete';
  }

  migrationProgressVisible(): boolean {
    return this.loading() || this.migrationProgress() > 0 || Boolean(this.message() || this.error());
  }

  operationButtonLabel(operation: string, idleLabel: string): string {
    if (!this.loading() || this.activeMigrationOperation() !== operation) return idleLabel;
    return `${this.activeMigrationLabel()} ${this.migrationProgress()}%`;
  }

  activeMigrationLabel(): string {
    const operation = this.activeMigrationOperation();
    if (operation === 'normalize') return 'Converting package';
    if (operation === 'analyze') return 'Analyzing';
    if (operation === 'dry-run') return 'Dry run';
    if (operation === 'import') return 'Final import';
    if (operation === 'worker') return 'Worker queue';
    if (operation === 'proof') return 'Proof check';
    if (this.error()) return 'Needs attention';
    if (this.message()) return 'Last result';
    return 'Migration progress';
  }

  activeMigrationDetail(): string {
    const summary = this.summary();
    const rows = summary?.totalRows || this.largeJob()?.totalRows || 0;
    const rowText = rows ? `${rows} rows scanned` : 'Waiting for source analysis';
    if (this.loading()) return `${this.progressLabel()} - ${rowText}`;
    if (this.error()) return this.error();
    if (this.message()) return this.message();
    return rowText;
  }

  private operationFromPath(path: string): string {
    if (path.includes('analyze')) return 'analyze';
    if (path.includes('dry-run')) return 'dry-run';
    if (path.includes('import')) return 'import';
    return 'migration';
  }

  private startMigrationProgress(operation: string): void {
    this.stopMigrationProgress();
    this.activeMigrationOperation.set(operation);
    const start = operation === 'normalize' ? 12 : operation === 'analyze' ? 18 : operation === 'dry-run' ? 52 : operation === 'import' ? 78 : 20;
    const cap = operation === 'import' ? 96 : operation === 'dry-run' ? 94 : 92;
    this.migrationProgress.set(start);
    this.progressTimer = setInterval(() => {
      const current = this.migrationProgress();
      if (!this.loading() || current >= cap) return;
      const remaining = cap - current;
      const step = remaining > 30 ? 7 : remaining > 12 ? 4 : 1;
      this.migrationProgress.set(Math.min(cap, current + step));
    }, 1200);
  }

  private finishMigrationProgress(value = 100): void {
    this.stopMigrationProgress();
    this.migrationProgress.set(value);
  }

  private stopMigrationProgress(): void {
    if (!this.progressTimer) return;
    clearInterval(this.progressTimer);
    this.progressTimer = null;
  }

  requiredMappingComplete(): boolean {
    if (!this.resource && this.isZipFile(this.selectedSourceFile)) return true;
    return this.mappingDraft().filter((row) => row.required).every((row) => row.sourceColumn.trim());
  }

  validateRequiredMapping(): boolean {
    if (this.requiredMappingComplete()) return true;
    this.error.set('Required mapping fields are missing. Complete the required source columns in Mapping Studio.');
    return false;
  }

  askMigrationAssistant(): void {
    const rows = this.previewRows();
    const errors = rows.filter((row) => row.status === 'error');
    const warnings = rows.filter((row) => row.status === 'warning');
    const duplicates = this.duplicateRows();
    const topMessages = [...errors, ...warnings, ...duplicates]
      .slice(0, 8)
      .map((row) => row.message || `${row.entity || 'record'} row ${row.sourceRowNumber || ''}`)
      .filter(Boolean);
    this.assistantAnswer.set([
      `${errors.length} critical errors, ${warnings.length} warnings aur ${duplicates.length} duplicate/conflict rows detect hui.`,
      topMessages.length ? `Top reasons: ${Array.from(new Set(topMessages)).slice(0, 5).join(' | ')}` : 'No row-level issue found.',
      this.hasCriticalErrors() ? 'Final import remains blocked until critical errors are fixed.' : 'No critical errors found. Complete the approval gate to import.'
    ].join(' '));
  }

  async exportFailedRows(): Promise<void> {
    if (!this.hasSelectedSourcePayload()) {
      this.error.set('Select and analyze a source file before exporting the error Excel.');
      return;
    }
    try {
      this.loading.set(true);
      this.error.set('');
      const blob = await firstValueFrom(this.api.postBlob('migration/error-report.xlsx', {
        sourceSoftware: this.sourceSoftware,
        resource: this.resource,
        migrationMode: true,
        sandboxMode: this.sandboxMode(),
        mapping: Object.fromEntries(this.mappingDraft().filter((row) => row.sourceColumn).map((row) => [row.sourceColumn, row.targetField])),
        duplicateDecisions: this.duplicateDecisions(),
        allowPartialImport: this.allowPartialLargeImport(),
        ...this.sourceFilePayload()
      }));
      this.downloadBlob(this.errorReportFileName(), blob);
      this.message.set('Migration error Excel exported.');
    } catch (err: any) {
      this.error.set(this.api.errorText(err, 'Unable to export migration error Excel.'));
    } finally {
      this.loading.set(false);
    }
  }

  exportPreviewSummary(): void {
    const summary = this.summary();
    const rows = [
      { metric: 'totalRows', value: summary?.totalRows || 0 },
      { metric: 'validRows', value: summary?.validRows || 0 },
      { metric: 'warningRows', value: summary?.warningRows || 0 },
      { metric: 'errorRows', value: summary?.errorRows || 0 },
      { metric: 'duplicateRows', value: summary?.duplicateRows || 0 },
      { metric: 'dataQualityScore', value: this.dataQualityScore() },
      { metric: 'readinessScore', value: this.readinessScore() }
    ];
    this.downloadCsv('migration-preview-summary.csv', rows);
  }

  private downloadBlob(fileName: string, blob: Blob): void {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = fileName;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  private errorReportFileName(): string {
    const base = (this.fileName() || 'migration').replace(/\.[^.]+$/, '').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'migration';
    return `migration-error-report-${base}.xlsx`;
  }

  private downloadCsv(fileName: string, rows: Record<string, unknown>[]): void {
    if (!rows.length) return;
    const headers: string[] = Array.from(rows.reduce((set, row) => {
      Object.keys(row || {}).forEach((key) => set.add(key));
      return set;
    }, new Set<string>()));
    const escape = (value: unknown) => `"${String(value ?? '').replace(/"/g, '""')}"`;
    const csv = [headers.join(','), ...rows.map((row) => headers.map((key) => escape(row?.[key])).join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = fileName;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  private rebuildMappingDraft(): void {
    const columns = this.templateColumns();
    this.mappingDraft.set(columns.map((column) => ({
      targetField: column.field,
      sourceColumn: column.aliases[0] || column.field,
      required: column.required,
      confidence: this.mappingConfidence(column.required, Boolean(column.aliases.length)),
      aliases: column.aliases || []
    })));
  }

  private sourceForTarget(mapping: Record<string, string>, targetField: string): string {
    const entry = Object.entries(mapping).find(([, target]) => target === targetField);
    return entry?.[0] || '';
  }

  private mappingConfidence(required: boolean, hasSource: boolean): number {
    if (!hasSource) return required ? 35 : 20;
    return required ? 96 : 82;
  }

  private rowKey(row: any): string {
    return `${row.sourceSheet || 'sheet'}:${row.sourceRowNumber || row.targetId || row.sourceExternalId || 'row'}`;
  }
}





