import { CommonModule } from '@angular/common';
import { Component, OnInit, computed, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { ApiService } from '../core/api.service';

type MigrationSummary = {
  totalRows: number;
  validRows: number;
  warningRows: number;
  errorRows: number;
  duplicateRows: number;
  affectedRecords?: number;
  byEntity: Record<string, { total: number; valid: number; warnings: number; errors: number; duplicates: number }>;
  byBranch?: Record<string, { total: number; valid: number; warnings: number; errors: number }>;
};

type SourceAdapter = {
  label: string;
  type: string;
  formats: string[];
  status: string;
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
  chunks?: Array<{ id: string; chunkNumber: number; status: string; totalRows: number; importedRows?: number; errorRows?: number; warningRows?: number }>;
  reconciliations?: LargeReconciliationSnapshot[];
};

@Component({
  selector: 'app-data-migration',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <section class="migration-shell">
      <header class="command-header">
        <div>
          <span class="eyebrow">Enterprise Data Migration OS</span>
          <h1>100X import command center</h1>
          <p>Migrate legacy salon, POS, accounting, inventory and booking data into live modules through sandbox, validation, approval, import and rollback controls.</p>
        </div>
        <div class="score-card" [class.danger]="readinessScore() < 60" [class.warning]="readinessScore() >= 60 && readinessScore() < 85">
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
          <span>Live clients</span>
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
          <small>Completed rollback batches</small>
        </article>
      </section>

      <section class="workspace-grid">
        <article class="panel import-panel">
          <div class="panel-head">
            <div>
              <span class="eyebrow">Live Import Runbook</span>
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
              <span>Upload Excel / CSV</span>
              <input type="file" accept=".xlsx,.xls,.csv" (change)="onFile($event)" />
              <small>Preserves old IDs, created dates, invoice numbers and branch history.</small>
            </label>
          </div>

          <div class="action-row">
            <button class="secondary-button" [disabled]="!fileBase64() || loading()" (click)="analyze()">Analyze</button>
            <button class="secondary-button" [disabled]="!fileBase64() || loading()" (click)="dryRun()">Dry run</button>
            <button class="primary-button" [disabled]="!fileBase64() || loading() || hasCriticalErrors()" (click)="runImport()">Final import</button>
            <button class="ghost-button" type="button" [disabled]="!templateColumns().length" (click)="downloadTemplate()">Template</button>
          </div>

          <p class="error-text" *ngIf="fileBase64() && !summary() && !error()">
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

        <aside class="panel risk-panel">
          <div class="panel-head">
            <div>
              <span class="eyebrow">Risk Radar</span>
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
        <article class="panel worker-panel">
          <div class="panel-head">
            <div>
              <span class="eyebrow">Large Migration Worker</span>
              <h2>Chunked import queue</h2>
            </div>
            <span class="status-pill" [class.danger]="largeJob()?.status === 'failed'">{{ largeJob()?.status || 'Not prepared' }}</span>
          </div>
          <div class="control-strip compact">
            <article><span>Job ID</span><strong>{{ largeJob()?.id || '-' }}</strong><small>{{ largeJob()?.resumeToken || 'Create a staged job from analyzed data' }}</small></article>
            <article><span>Rows</span><strong>{{ largeJob()?.totalRows || summary()?.totalRows || 0 }}</strong><small>{{ largeJob()?.processedRows || 0 }} processed</small></article>
            <article><span>Imported</span><strong>{{ largeJob()?.importedRows || 0 }}</strong><small>{{ largeJob()?.skippedRows || 0 }} skipped</small></article>
            <article><span>Worker progress</span><strong>{{ largeJobProgress() }}%</strong><small>{{ largeJobChunks().length }} chunks tracked · {{ csvStagedRows() }} staged rows</small></article>
          </div>
          <div class="worker-settings">
            <label>
              <span>Chunk size</span>
              <input type="number" min="100" max="50000" step="100" [ngModel]="largeChunkSize()" (ngModelChange)="largeChunkSize.set(numberInput($event, 5000))" />
            </label>
            <label>
              <span>Chunks per tick</span>
              <input type="number" min="1" max="100" [ngModel]="largeMaxChunks()" (ngModelChange)="largeMaxChunks.set(numberInput($event, 5))" />
            </label>
          </div>
          <div class="action-row">
            <button class="secondary-button" type="button" [disabled]="!canPrepareLargeMigration() || loading()" (click)="prepareLargeMigrationJob()">Prepare chunk 1</button>
            <button class="secondary-button" type="button" [disabled]="!isCsvFileSelected() || loading()" (click)="stageCsvMigrationChunks()">Stage CSV chunks</button>
            <button class="primary-button" type="button" [disabled]="!largeJob() || hasCriticalErrors() || !importApprovalReady() || loading()" (click)="queueLargeMigrationJob()">Queue worker</button>
            <button class="secondary-button" type="button" [disabled]="!largeJob() || hasCriticalErrors() || !importApprovalReady() || loading()" (click)="runWorkerTick()">Run worker tick</button>
            <button class="ghost-button" type="button" [disabled]="!largeJob() || loading()" (click)="refreshLargeJobStatus()">Refresh</button>
            <button class="ghost-button" type="button" [disabled]="!largeJob() || loading()" (click)="pauseLargeMigrationJob()">Pause</button>
            <button class="secondary-button" type="button" [disabled]="!largeJob() || loading()" (click)="retryFailedLargeMigrationChunks()">Retry failed</button>
            <button class="danger-button" type="button" [disabled]="!largeJob() || loading()" (click)="cancelLargeMigrationJob()">Cancel</button>
            <button class="ghost-button" type="button" [disabled]="!largeJob() || hasCriticalErrors() || !importApprovalReady() || loading()" (click)="resumeLargeMigrationJob()">Resume now</button>
          </div>
          <p class="muted" *ngIf="!importApprovalReady()">Owner approval required before queued import writes into live modules.</p>
          <div class="chunk-list" *ngIf="largeJobChunks().length">
            <article *ngFor="let chunk of largeJobChunks()" [class.done]="chunk.status === 'imported'" [class.danger]="chunk.status === 'failed' || chunk.status === 'imported_with_errors'">
              <strong>Chunk {{ chunk.chunkNumber }}</strong>
              <span>{{ chunk.status }}</span>
              <small>{{ chunk.importedRows || 0 }}/{{ chunk.totalRows || 0 }} imported · {{ chunk.errorRows || 0 }} errors</small>
            </article>
          </div>
        </article>

        <article class="panel proof-panel">
          <div class="panel-head">
            <div>
              <span class="eyebrow">Migration Proof</span>
              <h2>Reconciliation sign-off</h2>
            </div>
            <span class="status-pill" [class.danger]="latestLargeReconciliation()?.status === 'warning'">{{ latestLargeReconciliation()?.status || 'Not checked' }}</span>
          </div>
          <div class="proof-grid">
            <article>
              <span>Snapshot</span>
              <strong>{{ latestLargeReconciliation()?.id || '-' }}</strong>
              <small>{{ latestLargeReconciliation()?.snapshotType || 'Run proof check after import' }}</small>
            </article>
            <article>
              <span>Differences</span>
              <strong>{{ largeReconciliationDifferences().length }}</strong>
              <small>{{ latestLargeReconciliation()?.createdAt || 'No audit snapshot yet' }}</small>
            </article>
          </div>
          <div class="action-row">
            <button class="primary-button" type="button" [disabled]="!largeJob() || loading()" (click)="runLargeJobReconciliation()">Run proof check</button>
            <button class="ghost-button" type="button" [disabled]="!largeJob() || loading()" (click)="refreshLargeJobStatus()">Refresh proof</button>
            <button class="secondary-button" type="button" [disabled]="!latestLargeReconciliation() || loading()" (click)="downloadLargeReconciliationReport()">Export proof</button>
          </div>
          <div class="checklist compact-checklist">
            <label *ngFor="let item of largeMigrationChecklist()">
              <input type="checkbox" [checked]="item.done" disabled />
              <span>{{ item.label }}</span>
            </label>
            <label>
              <input type="checkbox" [checked]="!!latestLargeReconciliation()" disabled />
              <span>Reconciliation snapshot saved</span>
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
            <p class="muted">No proof differences recorded for the latest snapshot.</p>
          </ng-template>
        </article>
      </section>

      <section class="grid three">
        <article class="panel">
          <div class="panel-head">
            <div>
              <span class="eyebrow">AI Mapping Studio</span>
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

        <article class="panel">
          <div class="panel-head">
            <div>
              <span class="eyebrow">Entity Coverage</span>
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

        <article class="panel">
          <div class="panel-head">
            <div>
              <span class="eyebrow">Reconciliation</span>
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
        <article class="panel">
          <div class="panel-head">
            <div>
              <span class="eyebrow">Reconciliation Lab</span>
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
            <button class="secondary-button" type="button" [disabled]="!fileBase64() || loading()" (click)="runReconciliation()">Run reconciliation</button>
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

        <article class="panel">
          <div class="panel-head">
            <div>
              <span class="eyebrow">Approval Control Tower</span>
              <h2>Owner sign-off workflow</h2>
            </div>
            <button class="secondary-button" type="button" [disabled]="loading()" (click)="loadApprovals()">Refresh</button>
          </div>
          <label>
            <span>Approval note</span>
            <textarea [(ngModel)]="approvalNote" rows="3" placeholder="Summary, risk notes, branch sign-off, reconciliation evidence"></textarea>
          </label>
          <div class="action-row">
            <button class="primary-button" type="button" [disabled]="!summary() || hasCriticalErrors() || loading()" (click)="submitApproval()">Submit for approval</button>
            <button class="ghost-button" type="button" [disabled]="!latestPendingApproval() || loading()" (click)="decideApproval(latestPendingApproval()?.id || '', 'approved')">Approve latest</button>
            <button class="danger-button" type="button" [disabled]="!latestPendingApproval() || loading()" (click)="decideApproval(latestPendingApproval()?.id || '', 'rejected')">Reject latest</button>
          </div>
          <p class="error-text" *ngIf="fileBase64() && !summary()">
            Analyze must run before approval.
          </p>
          <p class="success-text" *ngIf="summary() && !latestPendingApproval() && !importApprovalReady()">
            Analyze is complete. Click "Submit for approval".
          </p>
          <p class="error-text" *ngIf="approvalDebug()">{{ approvalDebug() }}</p>
          <div class="approval-list">
            <article *ngFor="let approval of recentApprovals()" [class.pending]="approval.status === 'pending'" [class.approved]="approval.status === 'approved'" [class.rejected]="approval.status === 'rejected'">
              <div>
                <strong>{{ approval.status | titlecase }} · {{ approval.resource || 'migration' }}</strong>
                <small>{{ approval.submittedAt | date:'short' }} {{ approval.reviewedAt ? '· reviewed ' + (approval.reviewedAt | date:'short') : '' }}</small>
              </div>
              <span>{{ approval.note || 'No note' }}</span>
            </article>
            <p class="muted" *ngIf="!approvals().length">No approval requests yet.</p>
          </div>
        </article>
      </section>

      <section class="grid two">
        <article class="panel">
          <div class="panel-head">
            <div>
              <span class="eyebrow">Duplicate Merge Studio</span>
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

        <article class="panel">
          <div class="panel-head">
            <div>
              <span class="eyebrow">Validation Ops Queue</span>
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
        <article class="panel" *ngIf="previewRows().length">
          <div class="panel-head">
            <div>
              <span class="eyebrow">Validation Cockpit</span>
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

        <article class="panel">
          <div class="panel-head">
            <div>
              <span class="eyebrow">Go-Live Checklist</span>
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
        <article class="panel">
          <div class="panel-head">
            <div>
              <span class="eyebrow">Enterprise Controls</span>
              <h2>Quality, sandbox & approval gate</h2>
            </div>
            <span class="status-pill" [class.danger]="dataQualityScore() < 60">{{ dataQualityScore() }}% quality</span>
          </div>
          <div class="control-strip compact">
            <article><span>Mode</span><strong>{{ sandboxMode() ? 'Sandbox' : 'Live' }}</strong><small>Sandbox recommended first</small></article>
            <article><span>Approval gate</span><strong>{{ importApprovalReady() ? 'Approved' : 'Blocked' }}</strong><small>Final import requires owner sign-off</small></article>
            <article><span>Progress</span><strong>{{ migrationProgress() }}%</strong><small>{{ progressLabel() }}</small></article>
            <article><span>PII preview</span><strong>{{ maskPreviewPii() ? 'Masked' : 'Visible' }}</strong><small>Phone/email protection</small></article>
          </div>
          <div class="action-row">
            <button class="secondary-button" type="button" (click)="sandboxMode.set(!sandboxMode())">{{ sandboxMode() ? 'Switch to live mode' : 'Switch to sandbox mode' }}</button>
            <button class="secondary-button" type="button" (click)="maskPreviewPii.set(!maskPreviewPii())">{{ maskPreviewPii() ? 'Show PII preview' : 'Mask PII preview' }}</button>
            <button class="ghost-button" type="button" [disabled]="!previewRows().length" (click)="exportFailedRows()">Export failed rows</button>
            <button class="ghost-button" type="button" [disabled]="!previewRows().length" (click)="exportPreviewSummary()">Export preview summary</button>
          </div>
          <div class="checklist">
            <label *ngFor="let item of enterpriseChecklist()">
              <input type="checkbox" [checked]="item.done" disabled />
              <span>{{ item.label }}</span>
            </label>
          </div>
        </article>

        <article class="panel">
          <div class="panel-head">
            <div>
              <span class="eyebrow">Migration Assistant</span>
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

      <section class="panel">
        <div class="panel-head">
          <div>
            <span class="eyebrow">Migration Ledger</span>
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
                <td>{{ job.createdAt | date: 'short' }}</td>
                <td>{{ job.sourceSoftware }}</td>
                <td>{{ job.fileName }}</td>
                <td><span class="badge">{{ job.status }}</span></td>
                <td>{{ job.totalRows }}</td>
                <td>{{ job.importedRows }}</td>
                <td>{{ job.errorRows }}</td>
                <td>
                  <button class="secondary-button" type="button" [disabled]="loading()" (click)="loadJobDetail(job.id)">Open</button>
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
              <span class="eyebrow">Job Drilldown</span>
              <h2>{{ job.fileName || job.id }}</h2>
            </div>
            <button class="ghost-button" type="button" (click)="selectedJob.set(null)">Close</button>
          </div>
          <div class="control-strip compact">
            <article><span>Total</span><strong>{{ job.totalRows }}</strong><small>Rows</small></article>
            <article><span>Imported</span><strong>{{ job.importedRows }}</strong><small>Live records</small></article>
            <article><span>Errors</span><strong>{{ job.errorRows }}</strong><small>Blocked rows</small></article>
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
      </section>
    </section>
  `,
  styles: [`
    :host { display: block; }
    .migration-shell { display: grid; gap: 18px; color: #172033; }
    .command-header { display: grid; grid-template-columns: minmax(0, 1fr) 220px; gap: 18px; align-items: stretch; padding: 22px; border: 1px solid #d7e6e2; border-radius: 8px; background: linear-gradient(120deg, #f8fffd, #ffffff 62%, #edf7ff); box-shadow: 0 18px 40px rgba(15,23,42,.08); }
    .command-header h1 { margin: 6px 0; font-size: 34px; line-height: 1.05; letter-spacing: 0; }
    .command-header p { margin: 0; max-width: 900px; color: #64748b; font-size: 15px; line-height: 1.55; }
    .eyebrow { color: #2563eb; font-size: 12px; font-weight: 900; letter-spacing: .04em; text-transform: uppercase; }
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
    .status-pill, .badge { border-radius: 999px; background: #e8f7f4; color: #0f766e; padding: 6px 10px; font-size: 12px; font-weight: 900; white-space: nowrap; }
    .status-pill.danger { background: #fef2f2; color: #b91c1c; }
    .badge.warning { background: #fffbeb; color: #b45309; }
    .badge.danger { background: #fef2f2; color: #b91c1c; }
    .form-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
    label { display: grid; gap: 6px; color: #64748b; font-size: 12px; font-weight: 900; text-transform: uppercase; }
    input, select, textarea { width: 100%; min-height: 42px; border: 1px solid #cfe0dc; border-radius: 8px; background: #f8fffd; padding: 10px 11px; color: #172033; font-weight: 800; box-sizing: border-box; }
    input:focus, select:focus, textarea:focus { border-color: #0f8f7f; outline: 3px solid rgba(15,143,127,.14); background: #ffffff; }
    textarea { resize: vertical; font-family: inherit; text-transform: none; }
    .file-drop { grid-column: 1 / -1; border: 1px dashed #93c5fd; border-radius: 8px; padding: 12px; background: #f8fbff; }
    .file-drop small, .muted { color: #64748b; text-transform: none; font-weight: 700; }
    .action-row { display: flex; flex-wrap: wrap; gap: 10px; margin: 14px 0; }
    button { min-height: 40px; border: 1px solid #cfe0dc; border-radius: 8px; padding: 0 14px; font-weight: 900; cursor: pointer; background: #ffffff; color: #172033; }
    button:disabled { opacity: .55; cursor: not-allowed; }
    .primary-button { background: #0f8f7f; color: #ffffff; border-color: #0f8f7f; }
    .secondary-button { background: #eff6ff; color: #1d4ed8; border-color: #bfdbfe; }
    .ghost-button { background: #ffffff; }
    .danger-button { background: #fef2f2; color: #b91c1c; border-color: #fecaca; }
    .success-text, .error-text { margin: 8px 0 0; font-weight: 900; }
    .success-text { color: #047857; }
    .error-text { color: #b91c1c; }
    .pipeline { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 8px; margin-top: 14px; }
    .pipeline article { padding: 10px; display: grid; gap: 3px; border-left: 4px solid #cbd5e1; }
    .pipeline article.done { border-left-color: #10b981; background: #f0fdf4; }
    .pipeline article.active { border-left-color: #2563eb; background: #eff6ff; }
    .pipeline article.blocked { border-left-color: #ef4444; background: #fef2f2; }
    .pipeline strong { font-size: 13px; }
    .pipeline small { color: #64748b; }
    .risk-panel { display: grid; gap: 10px; }
    .risk-panel .panel-head { margin-bottom: 0; }
    .risk-panel article { padding: 12px; display: grid; gap: 4px; border-left: 4px solid #94a3b8; }
    .risk-panel article.good { border-left-color: #10b981; }
    .risk-panel article.warning { border-left-color: #f59e0b; background: #fffbeb; }
    .risk-panel article.danger { border-left-color: #ef4444; background: #fef2f2; }
    .risk-panel strong { font-size: 24px; }
    .mapping-list, .entity-stack, .recon-list, .checklist { display: grid; gap: 8px; }
    .mapping-toolbar { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 8px; margin-bottom: 10px; }
    .mapping-list article { display: grid; grid-template-columns: minmax(120px, 1fr) minmax(120px, 1fr) auto; align-items: center; gap: 12px; padding: 10px; }
    .mapping-list article.required { border-color: #bfdbfe; background: #eff6ff; }
    .mapping-list strong, .entity-stack strong { display: block; }
    .mapping-list small, .entity-stack small { color: #64748b; }
    .mapping-list article > span { color: #2563eb; font-size: 12px; font-weight: 900; }
    .mapping-list input { min-height: 36px; }
    .duplicate-list, .ops-queue { display: grid; gap: 8px; }
    .duplicate-list article { border: 1px solid #d7e6e2; border-radius: 8px; padding: 10px; display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 10px; align-items: center; }
    .duplicate-list small { color: #64748b; }
    .decision-actions { display: inline-flex; border: 1px solid #cfe0dc; border-radius: 8px; overflow: hidden; }
    .decision-actions button { border: 0; border-radius: 0; min-height: 34px; }
    .decision-actions button.active { background: #0f8f7f; color: #ffffff; }
    .ops-queue { grid-template-columns: repeat(3, minmax(0, 1fr)); }
    .ops-queue button { min-height: 92px; display: grid; gap: 4px; align-content: center; text-align: left; border-left: 4px solid #94a3b8; }
    .ops-queue button.warning { border-left-color: #f59e0b; background: #fffbeb; }
    .ops-queue button.danger { border-left-color: #ef4444; background: #fef2f2; }
    .ops-queue button.active { outline: 3px solid rgba(15,143,127,.16); }
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
    .reconcile-table article.match { border-left-color: #10b981; background: #f0fdf4; }
    .reconcile-table article.mismatch { border-left-color: #ef4444; background: #fef2f2; }
    .reconcile-table span, .approval-list small, .approval-list span { color: #64748b; }
    .approval-list article { display: grid; grid-template-columns: minmax(0, 1fr) minmax(120px, .6fr); gap: 10px; border-left: 4px solid #94a3b8; }
    .approval-list article.pending { border-left-color: #f59e0b; background: #fffbeb; }
    .approval-list article.approved { border-left-color: #10b981; background: #f0fdf4; }
    .approval-list article.rejected { border-left-color: #ef4444; background: #fef2f2; }
    .job-detail { margin-top: 14px; display: grid; gap: 12px; }
    .control-strip.compact { grid-template-columns: repeat(4, minmax(0, 1fr)); }
    .worker-settings { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; margin-top: 12px; }
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
    .chunk-list article.done { border-left-color: #10b981; background: #f0fdf4; }
    .chunk-list article.danger { border-left-color: #ef4444; background: #fef2f2; }
    .chunk-list span, .chunk-list small { color: #64748b; }
    tr.selected td { background: #eff6ff; }
    .segmented { display: inline-flex; border: 1px solid #cfe0dc; border-radius: 8px; overflow: hidden; }
    .segmented button { border: 0; border-radius: 0; min-height: 34px; background: #ffffff; }
    .segmented button.active { background: #0f8f7f; color: #ffffff; }
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
    .result-box { border: 1px solid #d7e6e2; border-radius: 8px; padding: 12px; display: grid; gap: 6px; background: #f8fffd; }
    @media (max-width: 1100px) {
      .command-header, .workspace-grid, .grid.two, .grid.three, .control-strip { grid-template-columns: 1fr 1fr; }
      .pipeline { grid-template-columns: repeat(3, minmax(0, 1fr)); }
    }
    @media (max-width: 760px) {
      .command-header, .workspace-grid, .grid.two, .grid.three, .control-strip, .control-strip.compact, .form-grid, .pipeline, .recon-list, .expected-grid, .approval-list article, .proof-grid { grid-template-columns: 1fr; }
      .command-header h1 { font-size: 28px; }
      .panel-head { align-items: flex-start; flex-direction: column; }
      .mapping-toolbar, .mapping-list article, .duplicate-list article, .ops-queue, .worker-settings { grid-template-columns: 1fr; }
    }
  `]
})
export class DataMigrationComponent implements OnInit {
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
  readonly resourceOptions = [
    { value: 'clients', label: 'Clients' },
    { value: 'staff', label: 'Staff' },
    { value: 'services', label: 'Services' },
    { value: 'products', label: 'Products' },
    { value: 'inventory', label: 'Inventory' },
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
  rowFilter = signal<'all' | 'error' | 'warning' | 'duplicate'>('all');
  fileBase64 = signal('');
  fileName = signal('');
  fileSize = signal(0);
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
  migrationProgress = signal(0);
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
  lastWorkerResult = signal<any | null>(null);
  csvStagedRows = signal(0);
  csvStagedChunks = signal(0);
  private selectedSourceFile: File | null = null;
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
  mappingDraftPreview = computed(() => this.mappingDraft().slice(0, 10));
  recentApprovals = computed(() => this.approvals().slice(0, 5));
  duplicatePreviewRows = computed(() => this.duplicateRows().slice(0, 8));
  selectedJobRows = computed(() => (this.selectedJob()?.rows || []).slice(0, 200));
  reconciliationLines = computed<ReconciliationLine[]>(() => this.reconciliationResult()?.lines || []);
  largeJobChunks = computed(() => this.largeJob()?.chunks || []);
  latestLargeReconciliation = computed(() => this.largeJob()?.reconciliations?.[0] || null);
  largeReconciliationDifferences = computed(() => this.latestLargeReconciliation()?.differences || []);
  completionChecklist = computed(() => this.onboarding()?.completionChecklist || [
    { label: 'Upload source file', done: Boolean(this.fileBase64()) },
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
    { label: 'File size under 20MB', done: Boolean(this.fileBase64()) && this.fileSize() <= 20 * 1024 * 1024 },
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

  selectedAdapter = () => this.adapters()[this.sourceSoftware];

  readinessScore = computed(() => {
    const summary = this.summary();
    const onboarding = this.onboarding();
    let score = 15;
    if (this.fileBase64()) score += 15;
    if (summary?.totalRows) score += 20;
    if (summary?.totalRows) score += Math.round((Number(summary.validRows || 0) / Math.max(1, Number(summary.totalRows || 1))) * 25);
    if (onboarding?.completionChecklist?.some((item: any) => item.key === 'dryRun' && item.done)) score += 10;
    if (summary && !summary.errorRows) score += 10;
    if (this.jobs().some((job) => Number(job.importedRows || 0) > 0)) score += 5;
    return Math.max(0, Math.min(100, score - Math.min(30, Number(summary?.errorRows || 0) * 3)));
  });

  pipelineSteps = computed(() => {
    const summary = this.summary();
    const hasFile = Boolean(this.fileBase64());
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
      { label: 'Adapter readiness', value: this.selectedAdapter()?.status || 'ready', detail: this.selectedAdapter()?.formats?.join(', ') || 'xlsx, csv', tone: 'good' }
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

  constructor(private readonly api: ApiService) {}

  ngOnInit(): void {
    this.loadIntelligence();
    this.loadJobs();
    this.loadApprovals();
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
    if (!size) return 'Upload .xlsx, .xls or .csv';
    if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
    return `${(size / 1024 / 1024).toFixed(1)} MB`;
  }

  goLiveGate(): string {
    if (!this.fileBase64()) return 'Upload source file';
    if (this.hasCriticalErrors()) return 'Blocked by validation errors';
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

  onResourceChange(): void {
    this.selectedMappingId = '';
    this.rebuildMappingDraft();
  }

  onFile(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    this.selectedSourceFile = file;
    this.fileName.set(file.name);
    this.fileSize.set(file.size);
    this.error.set('');
    this.message.set('');
    this.summary.set(null);
    this.previewRows.set([]);
    this.duplicateDecisions.set({});
    this.reconciliationResult.set(null);
    this.selectedJob.set(null);
    this.largeJob.set(null);
    this.lastWorkerResult.set(null);
    this.csvStagedRows.set(0);
    this.csvStagedChunks.set(0);
    this.fileBase64.set('');
    if (file.size > 20 * 1024 * 1024 && !this.isCsvFile(file)) {
      this.error.set('Excel files over 20MB must be exported as CSV for chunked migration.');
      input.value = '';
      this.selectedSourceFile = null;
      return;
    }
    if (file.size > 20 * 1024 * 1024) {
      this.message.set('Large CSV selected. Use Stage CSV chunks for worker import.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => this.fileBase64.set(String(reader.result || '').split(',').pop() || '');
    reader.onerror = () => this.error.set('File read failed.');
    reader.readAsDataURL(file);
  }

  async analyze(): Promise<void> {
    await this.callMigration('migration/analyze', 'Analyze complete. Validation cockpit updated.');
  }

  async dryRun(): Promise<void> {
    await this.callMigration('migration/dry-run', 'Dry run complete. Data was not saved.');
    await this.loadJobs();
  }

  async runImport(): Promise<void> {
    if (!this.importApprovalReady()) {
      this.error.set('Final import blocked: run Analyze, submit for approval, then approve the latest request.');
      return;
    }
    if (!this.validateRequiredMapping()) return;
    if (!confirm(`${this.sandboxMode() ? 'Sandbox' : 'Live'} final import database me data save karega. Continue?`)) return;
    await this.callMigration('migration/import', this.sandboxMode() ? 'Sandbox import complete. Review results before live migration.' : 'Final import complete. Data saved in live modules.');
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
      this.error.set('Select an Excel or CSV file first.');
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
    try {
      this.loading.set(true);
      this.error.set('');
      const job = await firstValueFrom(this.api.post<LargeMigrationJob>('migration/large-jobs', {
        sourceSoftware: this.sourceSoftware,
        resource: this.resource || 'auto',
        fileName: this.fileName(),
        fileSizeBytes: this.fileSize(),
        totalRows: this.summary()?.totalRows || rows.length,
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
    return Boolean(this.fileBase64()) || this.isCsvFileSelected();
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
      this.message.set('Reading CSV and staging chunks...');
      const text = await file.text();
      const rows = this.parseCsvRows(text);
      if (!rows.length) {
        this.error.set('CSV has no data rows to stage.');
        return;
      }
      const chunkSize = Math.max(100, this.largeChunkSize());
      const job = await firstValueFrom(this.api.post<LargeMigrationJob>('migration/large-jobs', {
        sourceSoftware: this.sourceSoftware,
        resource: this.resource || 'auto',
        fileName: this.fileName(),
        fileSizeBytes: this.fileSize(),
        totalRows: rows.length,
        chunkSize,
        mapping: Object.fromEntries(this.mappingDraft().filter((row) => row.sourceColumn).map((row) => [row.sourceColumn, row.targetField]))
      }));
      let latest: LargeMigrationJob = job;
      for (let index = 0; index < rows.length; index += chunkSize) {
        const chunkNumber = Math.floor(index / chunkSize) + 1;
        const chunkRows = rows.slice(index, index + chunkSize);
        await firstValueFrom(this.api.post<LargeMigrationJob>(`migration/large-jobs/${job.id}/chunks`, {
          chunkNumber,
          totalRows: chunkRows.length,
          rowStart: index + 1,
          rowEnd: index + chunkRows.length,
          sourceSheet: 'csv'
        }));
        const analyzed = await firstValueFrom(this.api.post<any>(`migration/large-jobs/${job.id}/chunks/${chunkNumber}/analyze`, {
          rows: chunkRows,
          duplicateDecisions: this.duplicateDecisions()
        }));
        latest = analyzed.job || latest;
        this.largeJob.set(latest);
        this.csvStagedRows.set(Math.min(rows.length, index + chunkRows.length));
        this.csvStagedChunks.set(chunkNumber);
        this.migrationProgress.set(Math.round((this.csvStagedRows() / rows.length) * 65));
      }
      this.largeJob.set(latest);
      this.summary.set({
        totalRows: rows.length,
        validRows: Number(latest.validRows || 0),
        warningRows: Number(latest.warningRows || 0),
        errorRows: Number(latest.errorRows || 0),
        duplicateRows: 0,
        affectedRecords: Number(latest.validRows || 0) + Number(latest.warningRows || 0),
        byEntity: {}
      });
      this.previewRows.set(rows.slice(0, 500));
      this.message.set(`${rows.length} CSV rows staged across ${this.csvStagedChunks()} chunk(s). Submit approval, then queue worker.`);
    } catch (err: any) {
      this.error.set(this.api.errorText(err, 'Unable to stage CSV chunks.'));
    } finally {
      this.loading.set(false);
    }
  }

  private isCsvFile(file: File | null): file is File {
    return Boolean(file && (file.name.toLowerCase().endsWith('.csv') || file.type === 'text/csv'));
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
        migrationMode: true
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
        maxChunks: this.largeMaxChunks()
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

  async retryFailedLargeMigrationChunks(): Promise<void> {
    const job = this.largeJob();
    if (!job) return;
    try {
      this.loading.set(true);
      this.error.set('');
      const retry = await firstValueFrom(this.api.post<LargeMigrationJob>(`migration/large-jobs/${job.id}/retry-failed`, {}));
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
        migrationMode: true
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
    if (!this.fileBase64()) {
      this.error.set('Select an Excel file first.');
      return;
    }
    try {
      this.loading.set(true);
      this.error.set('');
      const result = await firstValueFrom(this.api.post<any>('migration/reconcile', {
        sourceSoftware: this.sourceSoftware,
        resource: this.resource,
        migrationMode: true,
        fileName: this.fileName(),
        fileBase64: this.fileBase64(),
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
    return this.approvals().find((approval) => approval.status === 'pending') || null;
  }

  async submitApproval(): Promise<void> {
    if (!this.summary()) {
      if (!this.fileBase64()) {
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
      const approval = await firstValueFrom(this.api.post<ApprovalRecord>('migration/approvals', {
        jobId: this.jobs()[0]?.id || '',
        resource: this.resource || 'auto',
        note: this.approvalNote || this.goLiveGate(),
        summary: {
          readinessScore: this.readinessScore(),
          dataQualityScore: this.dataQualityScore ? this.dataQualityScore() : undefined,
          summary: this.summary(),
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

  label(value: string): string {
    return String(value || '').replace(/[-_]/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase());
  }

  private async callMigration(path: string, successMessage: string): Promise<void> {
    if (!this.fileBase64()) {
      this.error.set('Select an Excel file first.');
      return;
    }
    try {
      this.loading.set(true);
      this.migrationProgress.set(path.includes('analyze') ? 20 : path.includes('dry-run') ? 55 : 82);
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
          fileName: this.fileName(),
          fileBase64: this.fileBase64()
        })
      );
      this.summary.set(response.summary || null);
      this.previewRows.set(response.rows || response.details?.rows || []);
      this.duplicateDecisions.set({});
      this.migrationProgress.set(path.includes('import') ? 100 : path.includes('dry-run') ? 75 : 45);
      this.message.set(successMessage);
      if (path.includes('analyze') || path.includes('dry-run') || path.includes('import')) {
        await this.loadApprovals();
      }
    } catch (err: any) {
      this.error.set(this.api.errorText(err, 'Migration failed.'));
    } finally {
      this.loading.set(false);
    }
  }

  dataQualityScore(): number {
    const summary = this.summary();
    if (!summary?.totalRows) return this.fileBase64() ? 35 : 0;
    const validRate = Number(summary.validRows || 0) / Math.max(1, Number(summary.totalRows || 1));
    const warningPenalty = Math.min(20, Number(summary.warningRows || 0) * 2);
    const errorPenalty = Math.min(35, Number(summary.errorRows || 0) * 5);
    const duplicatePenalty = Math.min(15, Number(summary.duplicateRows || 0) * 2);
    return Math.max(0, Math.min(100, Math.round(validRate * 100) - warningPenalty - errorPenalty - duplicatePenalty));
  }

  importApprovalReady(): boolean {
    return this.approvals().some((approval) => approval.status === 'approved');
  }

  progressLabel(): string {
    const progress = this.migrationProgress();
    if (!progress) return 'Not started';
    if (progress < 40) return 'Analyzing';
    if (progress < 80) return 'Dry-run / validation';
    if (progress < 100) return 'Importing';
    return 'Complete';
  }

  requiredMappingComplete(): boolean {
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

  exportFailedRows(): void {
    const rows = this.previewRows().filter((row) => row.status === 'error' || row.status === 'warning' || this.duplicateRows().includes(row));
    this.downloadCsv('migration-failed-rows.csv', rows);
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


