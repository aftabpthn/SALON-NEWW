import { CommonModule } from '@angular/common';
import { Component, inject } from '@angular/core';
import { Router } from '@angular/router';
import { DataMigrationStore } from './data-migration.store';

@Component({
  selector: 'app-data-migration-import-worker',
  standalone: true,
  imports: [CommonModule],
  template: `
    <section class="migration-shell">
      <header class="command-header">
        <div>
          <button class="back-btn" (click)="back()">← Back to Dashboard</button>
          <h1>Import Worker</h1>
        </div>
        <div class="score-card" *ngIf="store.largeJob()">
          <span>Job status</span>
          <strong>{{ store.largeJob()?.status }}</strong>
          <small>{{ store.largeJobProgress() }}% complete</small>
        </div>
      </header>

      <section class="config-grid">
        <section class="card">
          <span class="card-label">Chunk size</span>
          <input class="form-input" type="number" [value]="store.largeChunkSize()" (change)="onChunkSizeChange($event)" min="100" />
        </section>
        <section class="card">
          <span class="card-label">Max chunks</span>
          <input class="form-input" type="number" [value]="store.largeMaxChunks()" (change)="onMaxChunksChange($event)" min="1" />
        </section>
        <section class="card">
          <span class="card-label">&nbsp;</span>
          <label class="toggle-label">
            <input type="checkbox" [checked]="store.allowPartialLargeImport()" (change)="onAllowPartialChange($event)" />
            <span style="font-size:13px;font-weight:700;">Allow partial import</span>
          </label>
        </section>
      </section>

      <section class="action-strip">
        <button class="btn-primary" (click)="store.prepareLargeMigrationJob()" [disabled]="store.loading()">Prepare Large Migration</button>
        <button class="btn-secondary" (click)="store.queueLargeMigrationJob()" [disabled]="store.loading() || !store.largeJob()">Queue Worker</button>
        <button class="btn-secondary" (click)="store.runWorkerTick()" [disabled]="store.loading()">Run Worker Tick</button>
        <button class="btn-secondary" (click)="store.refreshLargeJobStatus()" [disabled]="store.loading() || !store.largeJob()">↻ Refresh</button>
      </section>

      <section class="job-status" *ngIf="store.largeJob()">
        <div class="status-header">
          <span class="card-label">Job #{{ store.largeJob()?.id?.slice(0,8) }}</span>
          <div class="status-pills">
            <span class="status-pill good" *ngIf="store.largeJob()?.status === 'completed'">Completed</span>
            <span class="status-pill active" *ngIf="store.largeJob()?.status === 'queued' || store.largeJob()?.status === 'processing'">Active</span>
            <span class="status-pill blocked" *ngIf="store.largeJob()?.status === 'failed' || store.largeJob()?.status === 'cancelled'">{{ store.largeJob()?.status }}</span>
            <span class="status-pill" [class.good]="store.largeJob()?.status === 'draft'" *ngIf="['draft','paused'].includes(store.largeJob()?.status || '')">{{ store.largeJob()?.status }}</span>
          </div>
        </div>
        <div class="progress-bar-bg">
          <div class="progress-bar-fill" [style.width.%]="store.largeJobProgress()"></div>
        </div>
        <div class="job-stats">
          <span>Total: {{ store.largeJob()?.totalRows || 0 }}</span>
          <span>Imported: {{ store.largeJob()?.importedRows || 0 }}</span>
          <span>Errors: {{ store.largeJob()?.errorRows || 0 }}</span>
          <span>Warnings: {{ store.largeJob()?.warningRows || 0 }}</span>
        </div>
      </section>

      <section class="control-strip" *ngIf="store.largeJob()">
        <button class="btn-secondary" (click)="store.pauseLargeMigrationJob()" [disabled]="store.loading()">Pause</button>
        <button class="btn-secondary" (click)="store.resumeLargeMigrationJob()" [disabled]="store.loading()">Resume</button>
        <button class="btn-danger" (click)="store.cancelLargeMigrationJob()" [disabled]="store.loading()">Cancel</button>
        <button class="btn-secondary" (click)="store.retryFailedLargeMigrationChunks()" [disabled]="store.loading()">Retry Failed</button>
        <button class="btn-secondary" (click)="store.runLargeJobReconciliation()" [disabled]="store.loading()">Proof Check</button>
        <button class="btn-secondary" (click)="store.downloadLargeReconciliationReport()">Export Proof</button>
      </section>

      <section class="chunk-list" *ngIf="store.largeJobChunks().length">
        <span class="card-label">Chunks ({{ store.largeReadyChunks() }} ready / {{ store.largePendingChunks() }} pending)</span>
        <article class="chunk-row" *ngFor="let chunk of store.largeJobChunks()">
          <div class="chunk-info">
            <strong>Chunk #{{ chunk.chunkNumber }}</strong>
            <span class="status-pill" [class.good]="['imported','analyzed'].includes(chunk.status)" [class.active]="chunk.status === 'analyzed_with_errors'" [class.blocked]="['failed','cancelled','rolled_back'].includes(chunk.status)">{{ chunk.status }}</span>
          </div>
          <small class="chunk-detail">{{ chunk.totalRows }} rows · {{ chunk.importedRows || 0 }} imported · {{ chunk.errorRows || 0 }} errors</small>
          <small class="chunk-detail" *ngIf="chunk.failureReason" style="color:#b91c1c;">{{ chunk.failureReason }}</small>
        </article>
      </section>

      <section class="worker-result" *ngIf="store.lastWorkerResultText()">
        <span class="card-label">Last worker result</span>
        <p>{{ store.lastWorkerResultText() }}</p>
      </section>

      <section class="message error" *ngIf="store.error()">{{ store.error() }}</section>
      <section class="message success" *ngIf="store.message()">{{ store.message() }}</section>

      <section class="loading-section" *ngIf="store.loading()">
        <div class="spinner"></div>
        <span>Processing...</span>
      </section>
    </section>
  `,
  styles: [`
    :host { display: block; }
    .migration-shell { display: grid; gap: 14px; padding: 16px; color: #172033; }
    .command-header { display: grid; grid-template-columns: minmax(0, 1fr) 200px; gap: 16px; align-items: center; padding: 18px 20px; border: 1px solid #e2e8f0; border-radius: 12px; background: linear-gradient(135deg, #f8fffd, #ffffff 62%, #edf7ff); box-shadow: 0 1px 3px rgba(0,0,0,0.04), 0 1px 6px rgba(0,0,0,0.04); }
    .command-header h1 { margin: 4px 0; font-size: 22px; line-height: 1.1; letter-spacing: -0.01em; }
    .command-header p { margin: 0; max-width: 800px; color: #64748b; font-size: 13px; line-height: 1.45; }
    .back-btn { background: none; border: 1px solid #e2e8f0; border-radius: 8px; padding: 6px 14px; font-size: 12px; font-weight: 700; cursor: pointer; color: #4f46e5; margin-bottom: 8px; }
    .back-btn:hover { background: #f1f5f9; }
    .score-card { border: 1px solid #e2e8f0; border-radius: 10px; background: #ffffff; display: grid; align-content: center; gap: 4px; padding: 14px; }
    .score-card strong { font-size: 20px; line-height: 1; text-transform: capitalize; }
    .score-card span { color: #64748b; font-size: 11px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.02em; }
    .score-card small { color: #64748b; font-size: 12px; }
    .card-label { color: #64748b; font-size: 11px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.02em; display: block; margin-bottom: 6px; }
    .config-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 10px; }
    .card { border: 1px solid #e2e8f0; border-radius: 10px; background: #ffffff; padding: 12px; display: grid; gap: 6px; }
    .form-input { width: 100%; min-height: 38px; border: 1px solid #e2e8f0; border-radius: 8px; background: #fafcfb; padding: 8px 10px; color: #172033; font-weight: 700; box-sizing: border-box; font-size: 13px; }
    .form-input:focus { border-color: #0f8f7f; outline: 2px solid rgba(15,143,127,.12); background: #ffffff; }
    .toggle-label { display: flex; align-items: center; gap: 8px; cursor: pointer; }
    .action-strip { display: flex; gap: 10px; flex-wrap: wrap; }
    .btn-primary { min-height: 36px; border: 1px solid #0f8f7f; border-radius: 8px; padding: 0 16px; font-weight: 700; font-size: 12px; cursor: pointer; background: #0f8f7f; color: #ffffff; }
    .btn-primary:disabled, .btn-secondary:disabled, .btn-danger:disabled { opacity: .5; cursor: not-allowed; }
    .btn-secondary { min-height: 36px; border: 1px solid #e2e8f0; border-radius: 8px; padding: 0 12px; font-weight: 700; font-size: 12px; cursor: pointer; background: #ffffff; color: #172033; }
    .btn-secondary:hover { background: #f8fafc; }
    .btn-danger { min-height: 36px; border: 1px solid #fecaca; border-radius: 8px; padding: 0 12px; font-weight: 700; font-size: 12px; cursor: pointer; background: #fef2f2; color: #b91c1c; }
    .btn-danger:hover { background: #fee2e2; }
    .job-status { padding: 16px; border: 1px solid #e2e8f0; border-radius: 10px; background: #ffffff; display: grid; gap: 10px; }
    .status-header { display: flex; align-items: center; justify-content: space-between; }
    .status-pills { display: flex; gap: 6px; }
    .status-pill { font-size: 10px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.03em; padding: 3px 8px; border-radius: 999px; white-space: nowrap; }
    .status-pill.good { background: #e8f7f4; color: #0f766e; }
    .status-pill.active { background: #eff6ff; color: #1d4ed8; }
    .status-pill.blocked { background: #fef2f2; color: #b91c1c; }
    .progress-bar-bg { height: 8px; border-radius: 999px; background: #e2e8f0; overflow: hidden; }
    .progress-bar-fill { height: 100%; border-radius: 999px; background: #0f8f7f; transition: width .3s; }
    .job-stats { display: flex; gap: 16px; font-size: 12px; color: #64748b; }
    .control-strip { display: flex; gap: 10px; flex-wrap: wrap; }
    .chunk-list { display: grid; gap: 8px; padding: 16px; border: 1px solid #e2e8f0; border-radius: 10px; background: #ffffff; }
    .chunk-row { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 16px; padding: 10px 12px; border: 1px solid #e2e8f0; border-radius: 8px; background: #fafcfb; }
    .chunk-info { display: flex; align-items: center; gap: 8px; }
    .chunk-info strong { font-size: 13px; }
    .chunk-detail { color: #64748b; font-size: 11px; }
    .worker-result { padding: 12px; border: 1px solid #e2e8f0; border-radius: 10px; background: #ffffff; }
    .worker-result p { margin: 0; font-size: 13px; color: #172033; }
    .message { padding: 12px 16px; border-radius: 10px; font-weight: 700; font-size: 13px; }
    .message.error { background: #fef2f2; color: #b91c1c; border: 1px solid #fecaca; }
    .message.success { background: #e8f7f4; color: #0f766e; border: 1px solid #a7f3d0; }
    .loading-section { display: flex; align-items: center; gap: 10px; padding: 16px; background: #fffbeb; border: 1px solid #f59e0b; border-radius: 10px; font-weight: 700; font-size: 13px; }
    .spinner { width: 18px; height: 18px; border: 3px solid #e2e8f0; border-top-color: #0f8f7f; border-radius: 50%; animation: spin .6s linear infinite; }
    @keyframes spin { to { transform: rotate(360deg); } }
    @media (max-width: 760px) { .migration-shell { padding: 10px; } .command-header { grid-template-columns: 1fr; } }
  `]
})
export class DataMigrationImportWorkerComponent {
  readonly store = inject(DataMigrationStore);
  private readonly router = inject(Router);

  onChunkSizeChange(event: Event): void {
    this.store.largeChunkSize.set(+(event.target as HTMLInputElement).value || 5000);
  }

  onMaxChunksChange(event: Event): void {
    this.store.largeMaxChunks.set(+(event.target as HTMLInputElement).value || 5);
  }

  onAllowPartialChange(event: Event): void {
    this.store.allowPartialLargeImport.set((event.target as HTMLInputElement).checked);
  }

  back(): void {
    this.router.navigate(['/data-migration']);
  }
}
