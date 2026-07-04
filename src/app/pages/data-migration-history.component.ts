import { CommonModule } from '@angular/common';
import { Component, inject } from '@angular/core';
import { Router } from '@angular/router';
import { DataMigrationStore } from './data-migration.store';

@Component({
  selector: 'app-data-migration-history',
  standalone: true,
  imports: [CommonModule],
  template: `
    <section class="migration-shell">
      <header class="command-header">
        <div>
          <button class="back-btn" (click)="back()">← Back to Dashboard</button>
          <h1>History &amp; Rollback</h1>
        </div>
        <div class="score-card aura-card">
          <span>Jobs</span>
          <strong>{{ store.jobs().length }}</strong>
          <small>{{ completedCount() }} completed</small>
        </div>
      </header>

      <div class="history-layout">
        <section class="jobs-list">
          <span class="card-label">Migration jobs</span>
          <article class="job-item" *ngFor="let job of store.jobs()" [class.selected]="store.selectedJob()?.id === job.id" (click)="selectJob(job.id)">
            <div class="job-header">
              <strong>{{ job.fileName || 'Job #' + job.id?.slice(0,8) }}</strong>
              <span class="status-pill" [class.good]="job.status === 'completed'" [class.active]="job.status === 'processing' || job.status === 'queued'" [class.blocked]="job.status === 'failed' || job.status === 'cancelled' || job.status === 'rolled_back'">{{ job.status }}</span>
            </div>
            <div class="job-meta">
              <small>{{ job.totalRows || 0 }} rows</small>
              <small>{{ job.importedRows || 0 }} imported</small>
              <small>{{ job.errorRows || 0 }} errors</small>
            </div>
            <small class="job-date" *ngIf="job.createdAt">{{ job.createdAt }}</small>
          </article>
          <p class="empty-state" *ngIf="!store.jobs().length">No migration jobs yet.</p>
        </section>

        <section class="job-detail" *ngIf="store.selectedJob()">
          <div class="detail-header">
            <span class="card-label">Job detail</span>
            <button class="btn-close" (click)="store.closeJobDetail()">✕ Close</button>
          </div>
          <div class="detail-body">
            <div class="detail-row">
              <span>ID</span>
              <strong>{{ store.selectedJob()?.id }}</strong>
            </div>
            <div class="detail-row">
              <span>File</span>
              <strong>{{ store.selectedJob()?.fileName || '—' }}</strong>
            </div>
            <div class="detail-row">
              <span>Status</span>
              <span class="status-pill" [class.good]="store.selectedJob()?.status === 'completed'" [class.active]="['processing','queued'].includes(store.selectedJob()?.status || '')" [class.blocked]="['failed','cancelled','rolled_back'].includes(store.selectedJob()?.status || '')">{{ store.selectedJob()?.status }}</span>
            </div>
            <div class="detail-stats">
              <div class="detail-stat"><span>Total</span><strong>{{ store.selectedJob()?.totalRows || 0 }}</strong></div>
              <div class="detail-stat"><span>Imported</span><strong>{{ store.selectedJob()?.importedRows || 0 }}</strong></div>
              <div class="detail-stat"><span>Errors</span><strong style="color:#b91c1c;">{{ store.selectedJob()?.errorRows || 0 }}</strong></div>
              <div class="detail-stat"><span>Warnings</span><strong style="color:#b45309;">{{ store.selectedJob()?.warningRows || 0 }}</strong></div>
            </div>
          </div>

          <div class="recovery-section" *ngIf="store.selectedJobRecovery()">
            <span class="card-label">Recovery report</span>
            <div class="recovery-status">
              <span class="status-pill" [class.good]="store.selectedJobRecovery()?.status === 'recovered'" [class.blocked]="store.selectedJobRecovery()?.status === 'failed'" [class.active]="store.selectedJobRecovery()?.status === 'partial'">{{ store.selectedJobRecovery()?.status }}</span>
            </div>
            <div class="recovery-summary" *ngIf="store.selectedJobRecovery()?.summary">
              <div class="summary-stat"><span>Failed rows</span><strong>{{ store.selectedJobRecovery()?.summary?.failedRows }}</strong></div>
              <div class="summary-stat"><span>Retry candidates</span><strong>{{ store.selectedJobRecovery()?.summary?.retryCandidates }}</strong></div>
              <div class="summary-stat"><span>Batches</span><strong>{{ store.selectedJobRecovery()?.summary?.batches }}</strong></div>
            </div>
            <div class="blocker-list" *ngIf="store.selectedJobRecovery()?.blockers?.length">
              <span class="card-label">Blockers</span>
              <p class="blocker-item" *ngFor="let blocker of store.selectedJobRecovery()?.blockers">{{ blocker }}</p>
            </div>
          </div>

          <div class="failed-rows" *ngIf="store.recoveryFailedRows().length">
            <span class="card-label">Failed rows ({{ store.recoveryFailedRows().length }})</span>
            <article class="failed-row" *ngFor="let row of store.recoveryFailedRows()">
              <div class="failed-info">
                <strong>{{ row.resource || 'record' }}</strong>
                <small>{{ row.rowKey || '' }}</small>
              </div>
              <small class="failed-msg">{{ row.message }}</small>
              <span class="retry-badge" *ngIf="row.retryable" [class.good]="row.retryable">Retryable</span>
            </article>
          </div>

          <div class="next-actions" *ngIf="store.recoveryNextActions().length">
            <span class="card-label">Next actions</span>
            <ol class="action-list">
              <li *ngFor="let action of store.recoveryNextActions()">{{ action }}</li>
            </ol>
          </div>

          <div class="detail-actions">
            <button class="btn-danger" (click)="store.rollbackRecoveryJob()" [disabled]="store.loading()">Rollback This Job</button>
            <button class="btn-secondary" (click)="store.exportRecoveryReport()">Export Recovery Report</button>
            <button class="btn-secondary" (click)="store.exportRecoveryFailedRows()">Export Failed Rows</button>
          </div>
        </section>
      </div>

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
    .command-header { display: grid; grid-template-columns: minmax(0, 1fr) 200px; gap: 16px; align-items: center; padding: 18px 20px; border: 1px solid #e2e8f0; border-radius: 12px; background: linear-gradient(135deg, #faf8f6, #ffffff 62%, #f0ece9); box-shadow: 0 1px 3px rgba(0,0,0,0.04), 0 1px 6px rgba(0,0,0,0.04); }
    .command-header h1 { margin: 4px 0; font-size: 22px; line-height: 1.1; letter-spacing: -0.01em; }
    .command-header p { margin: 0; max-width: 800px; color: #64748b; font-size: 13px; line-height: 1.45; }
    .back-btn { background: none; border: 1px solid #E7DDD6; border-radius: 8px; padding: 6px 14px; font-size: 12px; font-weight: 700; cursor: pointer; color: #4B1238; margin-bottom: 8px; }
    .back-btn:hover { background: #f1f5f9; }
    .score-card { border: 1px solid #e2e8f0; border-radius: 10px; background: #ffffff; display: grid; align-content: center; gap: 4px; padding: 14px; }
    .score-card strong { font-size: 24px; line-height: 1; }
    .score-card span { color: #64748b; font-size: 11px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.02em; }
    .score-card small { color: #64748b; font-size: 12px; }
    .card-label { color: #64748b; font-size: 11px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.02em; display: block; margin-bottom: 6px; }
    .history-layout { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
    .jobs-list { padding: 16px; border: 1px solid #e2e8f0; border-radius: 10px; background: #ffffff; display: grid; gap: 8px; align-content: start; max-height: 70vh; overflow-y: auto; }
    .job-item { padding: 12px; border: 1px solid #e2e8f0; border-radius: 8px; background: #fafcfb; cursor: pointer; display: grid; gap: 4px; transition: border-color .15s; }
    .job-item:hover { border-color: #5A153F; }
    .job-item.selected { border-color: #5A153F; background: #F5EEF2; }
    .job-header { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
    .job-header strong { font-size: 13px; }
    .job-meta { display: flex; gap: 12px; font-size: 11px; color: #64748b; }
    .job-date { font-size: 10px; color: #94a3b8; }
    .status-pill { font-size: 10px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.03em; padding: 3px 8px; border-radius: 999px; white-space: nowrap; display: inline-block; }
    .status-pill.good { background: #f5f2ef; color: #4B1238; }
    .status-pill.active { background: #F8EEF4; color: #4B1238; }
    .status-pill.blocked { background: #fef2f2; color: #b91c1c; }
    .empty-state { color: #64748b; font-size: 12px; padding: 8px 0; margin: 0; }
    .job-detail { display: grid; gap: 12px; padding: 16px; border: 1px solid #e2e8f0; border-radius: 10px; background: #ffffff; align-content: start; }
    .detail-header { display: flex; align-items: center; justify-content: space-between; }
    .btn-close { background: none; border: 1px solid #e2e8f0; border-radius: 6px; padding: 4px 10px; font-size: 12px; font-weight: 700; cursor: pointer; color: #64748b; }
    .btn-close:hover { background: #f1f5f9; }
    .detail-body { display: grid; gap: 8px; }
    .detail-row { display: flex; align-items: center; gap: 8px; font-size: 13px; }
    .detail-row span { color: #64748b; min-width: 60px; }
    .detail-row strong { word-break: break-all; }
    .detail-stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(80px, 1fr)); gap: 8px; margin-top: 8px; }
    .detail-stat { text-align: center; padding: 8px; border: 1px solid #e2e8f0; border-radius: 6px; background: #fafcfb; }
    .detail-stat span { display: block; font-size: 10px; color: #64748b; text-transform: uppercase; font-weight: 700; letter-spacing: 0.02em; }
    .detail-stat strong { font-size: 18px; }
    .recovery-section, .failed-rows, .next-actions { display: grid; gap: 8px; padding: 12px; border: 1px solid #e2e8f0; border-radius: 8px; background: #fafcfb; }
    .recovery-status { display: flex; align-items: center; gap: 8px; }
    .recovery-summary { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
    .summary-stat { text-align: center; }
    .summary-stat span { font-size: 11px; color: #64748b; display: block; }
    .summary-stat strong { font-size: 16px; }
    .blocker-list { display: grid; gap: 4px; }
    .blocker-item { margin: 0; font-size: 12px; color: #b91c1c; padding: 4px 0; border-bottom: 1px solid #e2e8f0; }
    .failed-row { display: flex; align-items: center; gap: 8px; padding: 6px 0; border-bottom: 1px solid #e2e8f0; flex-wrap: wrap; }
    .failed-info { display: flex; align-items: center; gap: 6px; }
    .failed-info strong { font-size: 12px; }
    .failed-info small { font-size: 11px; color: #64748b; }
    .failed-msg { font-size: 11px; color: #64748b; flex: 1; min-width: 0; }
    .retry-badge { font-size: 9px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.03em; padding: 2px 6px; border-radius: 999px; }
    .retry-badge.good { background: #f5f2ef; color: #4B1238; }
    .action-list { margin: 0; padding-left: 20px; display: grid; gap: 4px; }
    .action-list li { font-size: 12px; color: #172033; }
    .detail-actions { display: flex; gap: 8px; flex-wrap: wrap; }
    .btn-danger { min-height: 36px; border: 1px solid #fecaca; border-radius: 8px; padding: 0 12px; font-weight: 700; font-size: 12px; cursor: pointer; background: #fef2f2; color: #b91c1c; }
    .btn-danger:hover { background: #fee2e2; }
    .btn-danger:disabled { opacity: .5; cursor: not-allowed; }
    .btn-secondary { min-height: 36px; border: 1px solid #e2e8f0; border-radius: 8px; padding: 0 12px; font-weight: 700; font-size: 12px; cursor: pointer; background: #ffffff; color: #172033; }
    .btn-secondary:hover { background: #f8fafc; }
    .message { padding: 12px 16px; border-radius: 10px; font-weight: 700; font-size: 13px; }
    .message.error { background: #fef2f2; color: #b91c1c; border: 1px solid #fecaca; }
    .message.success { background: #f5f2ef; color: #4B1238; border: 1px solid #DCC4D4; }
    .loading-section { display: flex; align-items: center; gap: 10px; padding: 16px; background: #fffbeb; border: 1px solid #f59e0b; border-radius: 10px; font-weight: 700; font-size: 13px; }
    .spinner { width: 18px; height: 18px; border: 3px solid #e2e8f0; border-top-color: #5A153F; border-radius: 50%; animation: spin .6s linear infinite; }
    @keyframes spin { to { transform: rotate(360deg); } }
    @media (max-width: 960px) { .history-layout { grid-template-columns: 1fr; } }
    @media (max-width: 760px) { .migration-shell { padding: 10px; } .command-header { grid-template-columns: 1fr; } }
  `]
})
export class DataMigrationHistoryComponent {
  readonly store = inject(DataMigrationStore);
  private readonly router = inject(Router);

  back(): void {
    this.router.navigate(['/data-migration']);
  }

  completedCount(): number {
    return this.store.jobs().filter(j => j.status === 'completed').length;
  }

  selectJob(jobId: string): void {
    this.store.loadJobDetail(jobId);
    this.store.loadJobRecovery(jobId);
  }
}
