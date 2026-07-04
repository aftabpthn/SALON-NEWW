import { CommonModule } from '@angular/common';
import { Component, inject } from '@angular/core';
import { Router } from '@angular/router';
import { DataMigrationStore } from './data-migration.store';

@Component({
  selector: 'app-data-migration-validation',
  standalone: true,
  imports: [CommonModule],
  template: `
    <section class="migration-shell">
      <header class="command-header">
        <div>
          <button class="back-btn" (click)="back()">← Back to Dashboard</button>
          <h1>Validation &amp; Reconciliation</h1>
        </div>
      </header>

      <section class="filter-tabs">
        <button class="filter-btn" *ngFor="let tab of filterTabs" [class.active]="store.rowFilter() === tab.value" (click)="store.rowFilter.set(tab.value)">{{ tab.label }}</button>
      </section>

      <section class="queue-grid">
        <article class="queue-card" *ngFor="let q of store.validationQueues()" [class.danger]="q.status === 'error' && q.count > 0" [class.warning]="q.status === 'warning' && q.count > 0" (click)="store.rowFilter.set(q.status)">
          <span class="card-label">{{ q.label }}</span>
          <strong>{{ q.count }}</strong>
          <small>{{ q.detail }}</small>
        </article>
      </section>

      <section class="preview-section" *ngIf="store.filteredPreviewRows().length">
        <span class="card-label">Preview rows ({{ store.filteredPreviewRows().length }})</span>
        <div class="preview-scroll">
          <article class="preview-row" *ngFor="let row of store.filteredPreviewRows().slice(0, 20)">
            <div class="preview-info">
              <span class="status-pill" [class.good]="row.status === 'valid'" [class.active]="row.status === 'warning'" [class.blocked]="row.status === 'error' || row.status === 'duplicate'">{{ row.status || 'pending' }}</span>
              <strong>{{ row.entity || 'record' }}</strong>
              <small style="color:#64748b;">#{{ row.sourceRowNumber || '—' }}</small>
            </div>
            <small style="color:#64748b;">{{ row.message || '' }}</small>
          </article>
        </div>
      </section>

      <section class="duplicate-section" *ngIf="store.duplicateRows().length">
        <span class="card-label">Duplicate conflicts ({{ store.duplicateRows().length }})</span>
        <article class="dup-row" *ngFor="let row of store.duplicatePreviewRows()">
          <div class="dup-info">
            <strong>{{ row.entity || 'record' }} #{{ row.sourceRowNumber || '—' }}</strong>
            <small>{{ row.message || '' }}</small>
          </div>
          <div class="dup-actions">
            <button class="decision-btn" [class.active]="store.duplicateDecision(row) === 'merge'" (click)="store.setDuplicateDecision(row, 'merge')">Merge</button>
            <button class="decision-btn" [class.active]="store.duplicateDecision(row) === 'keep'" (click)="store.setDuplicateDecision(row, 'keep')">Keep</button>
            <button class="decision-btn" [class.active]="store.duplicateDecision(row) === 'link'" (click)="store.setDuplicateDecision(row, 'link')">Link</button>
          </div>
        </article>
      </section>

      <section class="reconciliation-section">
        <span class="card-label">Reconciliation Lab</span>
        <div class="expected-grid">
          <div class="expected-field" *ngFor="let metric of store.expectedMetrics">
            <label>{{ metric.label }}</label>
            <input class="form-input" type="number" placeholder="Expected {{ metric.label }}" (change)="onExpectedTotalChange(metric.key, $event)" />
          </div>
        </div>
        <div class="recon-actions">
          <button class="btn-primary" (click)="store.runReconciliation()" [disabled]="store.loading()">Run Reconciliation</button>
          <button class="btn-secondary" (click)="store.clearReconciliation()">Clear</button>
        </div>
        <div class="recon-result" *ngIf="store.reconciliationResult()">
          <div class="recon-header">
            <span class="status-pill" [class.good]="store.reconciliationResult()?.matched" [class.blocked]="!store.reconciliationResult()?.matched">{{ store.reconciliationResult()?.matched ? 'Matched' : 'Differences' }}</span>
            <small>{{ store.reconciliationResult()?.message || '' }}</small>
          </div>
          <article class="recon-line" *ngFor="let line of store.reconciliationLines()">
            <div class="recon-metric">
              <strong>{{ line.metric }}</strong>
              <span class="status-pill" [class.good]="line.match === true" [class.blocked]="line.match === false" [class.active]="line.match === null">{{ line.match === true ? 'OK' : line.match === false ? 'Mismatch' : 'Pending' }}</span>
            </div>
            <div class="recon-values">
              <span>Expected: {{ line.expected ?? '—' }}</span>
              <span>Actual: {{ line.actual }}</span>
              <span *ngIf="line.difference != null">Diff: {{ line.difference }}</span>
            </div>
          </article>
        </div>
      </section>

      <section class="export-strip">
        <button class="btn-secondary" (click)="store.exportFailedRows()">Export Error Excel</button>
        <button class="btn-secondary" (click)="store.exportPreviewSummary()">Export Preview Summary</button>
      </section>

      <section class="message error" *ngIf="store.error()">{{ store.error() }}</section>
      <section class="message success" *ngIf="store.message()">{{ store.message() }}</section>
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
    .card-label { color: #64748b; font-size: 11px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.02em; display: block; margin-bottom: 6px; }
    .filter-tabs { display: flex; gap: 6px; }
    .filter-btn { min-height: 36px; border: 1px solid #e2e8f0; border-radius: 8px; padding: 0 14px; font-weight: 700; font-size: 12px; cursor: pointer; background: #ffffff; color: #64748b; }
    .filter-btn.active { background: #5A153F; color: #ffffff; border-color: #5A153F; }
    .filter-btn:hover:not(.active) { background: #f8fafc; }
    .queue-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 10px; }
    .queue-card { border: 1px solid #e2e8f0; border-radius: 10px; background: #ffffff; padding: 14px; display: grid; gap: 4px; cursor: pointer; }
    .queue-card strong { font-size: 22px; }
    .queue-card small { color: #64748b; font-size: 12px; }
    .queue-card.danger { border-color: #fecaca; background: #fef2f2; }
    .queue-card.warning { border-color: #fde68a; background: #fffbeb; }
    .preview-section, .duplicate-section, .reconciliation-section { padding: 16px; border: 1px solid #e2e8f0; border-radius: 10px; background: #ffffff; display: grid; gap: 10px; }
    .preview-scroll { display: grid; gap: 6px; max-height: 400px; overflow-y: auto; }
    .preview-row { display: flex; align-items: center; gap: 12px; padding: 8px 10px; border: 1px solid #e2e8f0; border-radius: 8px; background: #fafcfb; flex-wrap: wrap; }
    .preview-info { display: flex; align-items: center; gap: 8px; }
    .preview-info strong { font-size: 13px; }
    .status-pill { font-size: 10px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.03em; padding: 3px 8px; border-radius: 999px; white-space: nowrap; }
    .status-pill.good { background: #f5f2ef; color: #4B1238; }
    .status-pill.active { background: #fffbeb; color: #b45309; }
    .status-pill.blocked { background: #fef2f2; color: #b91c1c; }
    .dup-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 10px 12px; border: 1px solid #e2e8f0; border-radius: 8px; background: #fafcfb; flex-wrap: wrap; }
    .dup-info { display: grid; gap: 2px; }
    .dup-info strong { font-size: 13px; }
    .dup-info small { font-size: 11px; color: #64748b; }
    .dup-actions { display: flex; gap: 6px; }
    .decision-btn { min-height: 30px; border: 1px solid #e2e8f0; border-radius: 6px; padding: 0 10px; font-weight: 700; font-size: 11px; cursor: pointer; background: #ffffff; color: #172033; }
    .decision-btn.active { background: #5A153F; color: #ffffff; border-color: #5A153F; }
    .expected-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 10px; }
    .expected-field { display: grid; gap: 4px; }
    .expected-field label { font-size: 12px; font-weight: 700; color: #172033; }
    .form-input { width: 100%; min-height: 38px; border: 1px solid #e2e8f0; border-radius: 8px; background: #fafcfb; padding: 8px 10px; color: #172033; font-weight: 700; box-sizing: border-box; font-size: 13px; }
    .form-input:focus { border-color: #5A153F; outline: 2px solid rgba(90,21,63,.12); background: #ffffff; }
    .recon-actions { display: flex; gap: 10px; }
    .btn-primary { min-height: 36px; border: 1px solid #5A153F; border-radius: 8px; padding: 0 16px; font-weight: 700; font-size: 12px; cursor: pointer; background: #5A153F; color: #ffffff; }
    .btn-primary:disabled { opacity: .5; cursor: not-allowed; }
    .btn-secondary { min-height: 36px; border: 1px solid #e2e8f0; border-radius: 8px; padding: 0 12px; font-weight: 700; font-size: 12px; cursor: pointer; background: #ffffff; color: #172033; }
    .btn-secondary:hover { background: #f8fafc; }
    .recon-result { display: grid; gap: 8px; padding: 12px; border: 1px solid #e2e8f0; border-radius: 8px; background: #fafcfb; }
    .recon-header { display: flex; align-items: center; gap: 10px; }
    .recon-header small { color: #64748b; font-size: 12px; }
    .recon-line { display: grid; gap: 4px; padding: 8px 0; border-top: 1px solid #e2e8f0; }
    .recon-metric { display: flex; align-items: center; gap: 8px; }
    .recon-metric strong { font-size: 13px; }
    .recon-values { display: flex; gap: 16px; font-size: 12px; color: #64748b; }
    .export-strip { display: flex; gap: 10px; flex-wrap: wrap; }
    .message { padding: 12px 16px; border-radius: 10px; font-weight: 700; font-size: 13px; }
    .message.error { background: #fef2f2; color: #b91c1c; border: 1px solid #fecaca; }
    .message.success { background: #f5f2ef; color: #4B1238; border: 1px solid #DCC4D4; }
    @media (max-width: 760px) { .migration-shell { padding: 10px; } }
  `]
})
export class DataMigrationValidationComponent {
  readonly store = inject(DataMigrationStore);
  private readonly router = inject(Router);

  readonly filterTabs = [
    { label: 'All', value: 'all' as const },
    { label: 'Errors', value: 'error' as const },
    { label: 'Warnings', value: 'warning' as const },
    { label: 'Duplicates', value: 'duplicate' as const }
  ];

  onExpectedTotalChange(key: string, event: Event): void {
    this.store.setExpectedTotal(key, (event.target as HTMLInputElement).value);
  }

  back(): void {
    this.router.navigate(['/data-migration']);
  }
}
