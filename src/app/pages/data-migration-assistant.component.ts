import { CommonModule } from '@angular/common';
import { Component, inject } from '@angular/core';
import { Router } from '@angular/router';
import { DataMigrationStore } from './data-migration.store';

@Component({
  selector: 'app-data-migration-assistant',
  standalone: true,
  imports: [CommonModule],
  template: `
    <section class="migration-shell">
      <header class="command-header">
        <div>
          <button class="back-btn" (click)="back()">← Back to Dashboard</button>
          <h1>Migration Assistant</h1>
        </div>
      </header>

      <section class="ask-section">
        <span class="card-label">Ask the assistant</span>
        <div class="ask-input-row">
          <input class="form-input" [value]="store.assistantQuestion()" (change)="onQuestionChange($event)" placeholder="Why did rows fail?" />
          <button class="btn-primary" (click)="store.askMigrationAssistant()">Ask</button>
        </div>
        <div class="answer-card" *ngIf="store.assistantAnswer()">
          <p>{{ store.assistantAnswer() }}</p>
        </div>
      </section>

      <section class="anomaly-grid">
        <article class="anomaly-card" *ngFor="let card of store.anomalyCards()" [class.good]="card.tone === 'good'" [class.warning]="card.tone === 'warning'" [class.danger]="card.tone === 'danger'">
          <span class="card-label">{{ card.label }}</span>
          <strong>{{ card.count }}</strong>
          <small>{{ card.detail }}</small>
        </article>
      </section>

      <section class="stats-section" *ngIf="store.summary()">
        <span class="card-label">Quick stats</span>
        <div class="stats-grid">
          <div class="stat-item">
            <span class="stat-value">{{ store.summary()?.totalRows }}</span>
            <span class="stat-label">Total rows</span>
          </div>
          <div class="stat-item">
            <span class="stat-value good">{{ store.summary()?.validRows }}</span>
            <span class="stat-label">Valid</span>
          </div>
          <div class="stat-item">
            <span class="stat-value danger">{{ store.summary()?.errorRows }}</span>
            <span class="stat-label">Errors</span>
          </div>
          <div class="stat-item">
            <span class="stat-value warning">{{ store.summary()?.warningRows }}</span>
            <span class="stat-label">Warnings</span>
          </div>
          <div class="stat-item">
            <span class="stat-value warning">{{ store.summary()?.duplicateRows }}</span>
            <span class="stat-label">Duplicates</span>
          </div>
        </div>
      </section>

      <section class="export-strip">
        <button class="btn-secondary" (click)="store.exportFailedRows()">Export Error Excel</button>
      </section>

      <section class="message error" *ngIf="store.error()">{{ store.error() }}</section>
      <section class="message success" *ngIf="store.message()">{{ store.message() }}</section>
    </section>
  `,
  styles: [`
    :host { display: block; }
    .migration-shell { display: grid; gap: 14px; padding: 16px; color: #172033; }
    .command-header { display: grid; grid-template-columns: minmax(0, 1fr) 200px; gap: 16px; align-items: center; padding: 18px 20px; border: 1px solid #e2e8f0; border-radius: 12px; background: linear-gradient(135deg, #faf8f6, #ffffff 62%, #f0ece9); box-shadow: 0 1px 3px rgba(75,18,56,0.04), 0 1px 6px rgba(75,18,56,0.04); }
    .command-header h1 { margin: 4px 0; font-size: 22px; line-height: 1.1; letter-spacing: -0.01em; }
    .command-header p { margin: 0; max-width: 800px; color: #64748b; font-size: 13px; line-height: 1.45; }
    .back-btn { background: none; border: 1px solid #E7DDD6; border-radius: 8px; padding: 6px 14px; font-size: 12px; font-weight: 700; cursor: pointer; color: #4B1238; margin-bottom: 8px; }
    .back-btn:hover { background: #f1f5f9; }
    .card-label { color: #64748b; font-size: 11px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.02em; display: block; margin-bottom: 6px; }
    .ask-section { padding: 16px; border: 1px solid #e2e8f0; border-radius: 10px; background: #ffffff; display: grid; gap: 10px; }
    .ask-input-row { display: flex; gap: 10px; }
    .form-input { flex: 1; min-height: 38px; border: 1px solid #e2e8f0; border-radius: 8px; background: #fafcfb; padding: 8px 10px; color: #172033; font-weight: 700; box-sizing: border-box; font-size: 13px; }
    .form-input:focus { border-color: #5A153F; outline: 2px solid rgba(90,21,63,.12); background: #ffffff; }
    .btn-primary { min-height: 36px; border: 1px solid #5A153F; border-radius: 8px; padding: 0 16px; font-weight: 700; font-size: 12px; cursor: pointer; background: #5A153F; color: #ffffff; flex-shrink: 0; }
    .btn-primary:hover { background: #451133; }
    .answer-card { padding: 12px; border: 1px solid #e2e8f0; border-radius: 8px; background: #faf8f6; }
    .answer-card p { margin: 0; font-size: 13px; line-height: 1.5; color: #172033; }
    .anomaly-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 10px; }
    .anomaly-card { border: 1px solid #e2e8f0; border-radius: 10px; background: #ffffff; padding: 14px; display: grid; gap: 4px; }
    .anomaly-card strong { font-size: 22px; }
    .anomaly-card small { color: #64748b; font-size: 12px; }
    .anomaly-card.good { border-color: #E7DDD6; }
    .anomaly-card.warning { border-color: #fffbeb; background: #fffbeb; }
    .anomaly-card.danger { border-color: #fef2f2; background: #fef2f2; }
    .stats-section { padding: 16px; border: 1px solid #e2e8f0; border-radius: 10px; background: #ffffff; display: grid; gap: 10px; }
    .stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(100px, 1fr)); gap: 10px; }
    .stat-item { display: grid; gap: 2px; text-align: center; padding: 10px; border: 1px solid #e2e8f0; border-radius: 8px; background: #fafcfb; }
    .stat-value { font-size: 22px; font-weight: 800; line-height: 1; }
    .stat-value.good { color: #4B1238; }
    .stat-value.danger { color: #b91c1c; }
    .stat-value.warning { color: #b45309; }
    .stat-label { font-size: 11px; color: #64748b; font-weight: 600; text-transform: uppercase; letter-spacing: 0.02em; }
    .export-strip { display: flex; gap: 10px; flex-wrap: wrap; }
    .btn-secondary { min-height: 36px; border: 1px solid #e2e8f0; border-radius: 8px; padding: 0 12px; font-weight: 700; font-size: 12px; cursor: pointer; background: #ffffff; color: #172033; }
    .btn-secondary:hover { background: #f8fafc; }
    .message { padding: 12px 16px; border-radius: 10px; font-weight: 700; font-size: 13px; }
    .message.error { background: #fef2f2; color: #b91c1c; border: 1px solid #fecaca; }
    .message.success { background: #F8EEF4; color: #4B1238; border: 1px solid #DCC4D4; }
    @media (max-width: 760px) { .migration-shell { padding: 10px; } }
  `]
})
export class DataMigrationAssistantComponent {
  readonly store = inject(DataMigrationStore);
  private readonly router = inject(Router);

  onQuestionChange(event: Event): void {
    this.store.assistantQuestion.set((event.target as HTMLInputElement).value);
  }

  back(): void {
    this.router.navigate(['/data-migration']);
  }
}
