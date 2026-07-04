import { CommonModule } from '@angular/common';
import { Component, inject } from '@angular/core';
import { Router } from '@angular/router';
import { DataMigrationStore } from './data-migration.store';

@Component({
  selector: 'app-data-migration-launch',
  standalone: true,
  imports: [CommonModule],
  template: `
    <section class="migration-shell">
      <header class="command-header">
        <div>
          <button class="back-btn" (click)="back()">← Back to Dashboard</button>
          <h1>Launch Migration</h1>
        </div>
      </header>

      <div class="migration-grid">
        <section class="card">
          <span class="card-label">Source Software</span>
          <select class="form-input" [value]="store.sourceSoftware" (change)="onSourceChange($event)">
            <option *ngFor="let opt of store.sourceOptions" [value]="opt.value">{{ opt.label }}</option>
          </select>
        </section>
        <section class="card">
          <span class="card-label">Resource</span>
          <select class="form-input" [value]="store.resource" (change)="onResourceChange($event)">
            <option value="">Auto-detect</option>
            <option *ngFor="let opt of store.resourceOptions" [value]="opt.value">{{ opt.label }}</option>
          </select>
        </section>
        <section class="card">
          <span class="card-label">Upload File</span>
          <input class="form-input" type="file" accept=".xlsx,.xls,.csv" (change)="store.onFile($event)" />
          <small style="color:#64748b;margin-top:4px;display:block;">{{ store.fileSizeLabel() }}</small>
        </section>
        <section class="card" style="align-items:flex-end;">
          <span class="card-label">&nbsp;</span>
          <button class="btn-secondary" (click)="store.refreshSourceContext()">↻ Refresh source</button>
        </section>
      </div>

      <div class="toggle-row">
        <label class="toggle-label">
          <input type="checkbox" [checked]="store.sandboxMode()" (change)="onSandboxChange($event)" />
          <span>Sandbox mode</span>
        </label>
        <small style="color:#64748b;">When enabled, imports run in sandbox (no live data write)</small>
      </div>

      <section class="pipeline-strip" *ngIf="store.pipelineSteps().length">
        <article class="step" *ngFor="let step of store.pipelineSteps()" [class.done]="step.status === 'done'" [class.active]="step.status === 'active'" [class.blocked]="step.status === 'blocked'">
          <span class="step-key">{{ step.key }}</span>
          <div class="step-body">
            <strong>{{ step.label }}</strong>
            <small>{{ step.detail }}</small>
          </div>
          <span class="status-pill" [class.good]="step.status === 'done'" [class.active]="step.status === 'active'" [class.blocked]="step.status === 'blocked'">{{ step.status }}</span>
        </article>
      </section>

      <section class="risk-grid">
        <article class="risk-card" *ngFor="let card of store.riskCards()" [class.good]="card.tone === 'good'" [class.warning]="card.tone === 'warning'" [class.danger]="card.tone === 'danger'">
          <span class="card-label">{{ card.label }}</span>
          <strong>{{ card.value }}</strong>
          <small>{{ card.detail }}</small>
        </article>
      </section>

      <section class="action-strip">
        <button class="btn-primary" (click)="store.analyze()" [disabled]="store.loading()">Analyze</button>
        <button class="btn-primary" (click)="store.dryRun()" [disabled]="store.loading()">Dry Run</button>
        <button class="btn-primary danger" (click)="store.runImport()" [disabled]="store.loading()">Import</button>
      </section>

      <section class="progress-section" *ngIf="store.migrationProgress() > 0">
        <div class="progress-bar-bg">
          <div class="progress-bar-fill" [style.width.%]="store.migrationProgress()"></div>
        </div>
        <small style="color:#64748b;">{{ store.progressLabel() }} — {{ store.migrationProgress() }}%</small>
      </section>

      <section class="loading-section" *ngIf="store.loading()">
        <div class="spinner"></div>
        <span>Processing...</span>
      </section>

      <section class="message error" *ngIf="store.error()">{{ store.error() }}</section>
      <section class="message success" *ngIf="store.message()">{{ store.message() }}</section>

      <section class="summary-grid" *ngIf="store.summary()">
        <article class="card">
          <span class="card-label">Total rows</span>
          <strong>{{ store.summary()?.totalRows }}</strong>
        </article>
        <article class="card">
          <span class="card-label">Valid</span>
          <strong style="color:#4B1238;">{{ store.summary()?.validRows }}</strong>
        </article>
        <article class="card">
          <span class="card-label">Errors</span>
          <strong style="color:#b91c1c;">{{ store.summary()?.errorRows }}</strong>
        </article>
        <article class="card">
          <span class="card-label">Warnings</span>
          <strong style="color:#b45309;">{{ store.summary()?.warningRows }}</strong>
        </article>
        <article class="card">
          <span class="card-label">Duplicates</span>
          <strong style="color:#b45309;">{{ store.summary()?.duplicateRows }}</strong>
        </article>
        <article class="card">
          <span class="card-label">Data quality</span>
          <strong>{{ store.dataQualityScore() }}%</strong>
        </article>
      </section>
    </section>
  `,
  styles: [`
    :host { display: block; }
    .migration-shell { display: grid; gap: 14px; padding: 16px; color: #172033; }
    .command-header { display: grid; grid-template-columns: minmax(0, 1fr) 200px; gap: 16px; align-items: center; padding: 18px 20px; border: 1px solid #e2e8f0; border-radius: 12px; background: linear-gradient(135deg, #faf8f6, #ffffff 62%, #f0ece9); box-shadow: 0 1px 3px rgba(0,0,0,0.04), 0 1px 6px rgba(0,0,0,0.04); }
    .command-header h1 { margin: 4px 0; font-size: 22px; line-height: 1.1; letter-spacing: -0.01em; }
    .command-header p { margin: 0; max-width: 800px; color: #64748b; font-size: 13px; line-height: 1.45; }
    .back-btn { background: none; border: 1px solid #e2e8f0; border-radius: 8px; padding: 6px 14px; font-size: 12px; font-weight: 700; cursor: pointer; color: #4f46e5; margin-bottom: 8px; }
    .back-btn:hover { background: #f1f5f9; }
    .migration-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 10px; }
    .card, .risk-card, .step { border: 1px solid #e2e8f0; border-radius: 10px; background: #ffffff; padding: 12px; display: grid; gap: 4px; }
    .card-label { color: #64748b; font-size: 11px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.02em; }
    .card strong { font-size: 18px; }
    .card small { color: #64748b; font-size: 12px; }
    .form-input { width: 100%; min-height: 38px; border: 1px solid #e2e8f0; border-radius: 8px; background: #fafcfb; padding: 8px 10px; color: #172033; font-weight: 700; box-sizing: border-box; font-size: 13px; }
    .form-input:focus { border-color: #5A153F; outline: 2px solid rgba(90,21,63,.12); background: #ffffff; }
    .toggle-row { display: flex; align-items: center; gap: 10px; padding: 12px; border: 1px solid #e2e8f0; border-radius: 10px; background: #ffffff; }
    .toggle-label { display: flex; align-items: center; gap: 8px; font-weight: 700; font-size: 13px; cursor: pointer; }
    .pipeline-strip { display: grid; gap: 8px; }
    .step { display: grid; grid-template-columns: 28px minmax(0, 1fr) auto; gap: 10px; align-items: center; }
    .step-key { font-size: 13px; font-weight: 800; color: #64748b; }
    .step.done { border-color: #5A153F; }
    .step.active { border-color: #2563eb; }
    .step.blocked { border-color: #f59e0b; }
    .step-body { display: grid; gap: 2px; }
    .step-body strong { font-size: 13px; }
    .step-body small { font-size: 11px; color: #64748b; }
    .status-pill { font-size: 10px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.03em; padding: 3px 8px; border-radius: 999px; white-space: nowrap; }
    .status-pill.good { background: #f5f2ef; color: #4B1238; }
    .status-pill.active { background: #eff6ff; color: #1d4ed8; }
    .status-pill.blocked { background: #fef2f2; color: #b91c1c; }
    .risk-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 10px; }
    .risk-card { border-color: #e2e8f0; }
    .risk-card.good { border-color: #f5f2ef; }
    .risk-card.warning { border-color: #fffbeb; background: #fffbeb; }
    .risk-card.danger { border-color: #fef2f2; background: #fef2f2; }
    .risk-card strong { font-size: 24px; }
    .risk-card small { color: #64748b; font-size: 12px; }
    .action-strip { display: flex; gap: 10px; flex-wrap: wrap; }
    .action-strip button { min-height: 36px; border-radius: 8px; padding: 0 16px; font-weight: 700; font-size: 12px; cursor: pointer; border: 1px solid #e2e8f0; }
    .btn-primary { background: #5A153F; color: #ffffff; border-color: #5A153F !important; }
    .btn-primary.danger { background: #b91c1c; border-color: #b91c1c !important; }
    .btn-primary:disabled { opacity: .5; cursor: not-allowed; }
    .btn-secondary { min-height: 36px; border: 1px solid #e2e8f0; border-radius: 8px; padding: 0 12px; font-weight: 700; font-size: 12px; cursor: pointer; background: #ffffff; color: #172033; }
    .btn-secondary:hover { background: #f8fafc; }
    .progress-section { display: grid; gap: 6px; }
    .progress-bar-bg { height: 8px; border-radius: 999px; background: #e2e8f0; overflow: hidden; }
    .progress-bar-fill { height: 100%; border-radius: 999px; background: #5A153F; transition: width .3s; }
    .loading-section { display: flex; align-items: center; gap: 10px; padding: 16px; background: #fffbeb; border: 1px solid #f59e0b; border-radius: 10px; font-weight: 700; font-size: 13px; }
    .spinner { width: 18px; height: 18px; border: 3px solid #e2e8f0; border-top-color: #5A153F; border-radius: 50%; animation: spin .6s linear infinite; }
    @keyframes spin { to { transform: rotate(360deg); } }
    .message { padding: 12px 16px; border-radius: 10px; font-weight: 700; font-size: 13px; }
    .message.error { background: #fef2f2; color: #b91c1c; border: 1px solid #fecaca; }
    .message.success { background: #f5f2ef; color: #4B1238; border: 1px solid #DCC4D4; }
    .summary-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 10px; }
    @media (max-width: 760px) { .migration-shell { padding: 10px; } .command-header { grid-template-columns: 1fr; } }
  `]
})
export class DataMigrationLaunchComponent {
  readonly store = inject(DataMigrationStore);
  private readonly router = inject(Router);

  onSourceChange(event: Event): void {
    this.store.sourceSoftware = (event.target as HTMLSelectElement).value;
    this.store.refreshSourceContext();
  }

  onResourceChange(event: Event): void {
    this.store.resource = (event.target as HTMLSelectElement).value;
    this.store.onResourceChange();
  }

  onSandboxChange(event: Event): void {
    this.store.sandboxMode.set((event.target as HTMLInputElement).checked);
  }

  back(): void {
    this.router.navigate(['/data-migration']);
  }
}
