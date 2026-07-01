import { CommonModule } from '@angular/common';
import { Component, inject } from '@angular/core';
import { Router } from '@angular/router';
import { DataMigrationStore } from './data-migration.store';

@Component({
  selector: 'app-data-migration-ai-mapping',
  standalone: true,
  imports: [CommonModule],
  template: `
    <section class="migration-shell">
      <header class="command-header">
        <div>
          <button class="back-btn" (click)="back()">← Back to Dashboard</button>
          <h1>AI Mapping Studio</h1>
        </div>
        <div class="score-card" [class.warning]="store.mappingCoverage() < 80">
          <span>Coverage</span>
          <strong>{{ store.mappingCoverage() }}%</strong>
          <small>{{ store.mappingDraft().length }} fields</small>
        </div>
      </header>

      <section class="profile-bar">
        <span class="card-label">Saved mapping profiles</span>
        <div class="profile-list">
          <article class="profile-item" *ngFor="let mapping of store.relevantMappings()">
            <div class="profile-body">
              <strong>{{ mapping.name || 'Unnamed profile' }}</strong>
              <small>{{ mapping.resource || 'auto' }} · {{ Object.keys(mapping.mapping || {}).length }} fields</small>
            </div>
            <button class="btn-secondary" (click)="store.applySavedMapping(mapping.id)">Apply</button>
          </article>
          <p class="empty-state" *ngIf="!store.relevantMappings().length">No saved mappings for this source/resource combination.</p>
        </div>
      </section>

      <section class="mapping-table">
        <div class="mapping-header">
          <span class="card-label">Field mapping table</span>
          <button class="btn-secondary" (click)="store.saveMappingProfile()">Save Mapping Profile</button>
        </div>
        <article class="mapping-row" *ngFor="let row of store.mappingDraft()">
          <div class="mapping-info">
            <strong>{{ store.label(row.targetField) }}</strong>
            <span class="required-badge" *ngIf="row.required">Required</span>
          </div>
          <div class="mapping-confidence">
            <span class="confidence-badge" [class.high]="row.confidence >= 80" [class.medium]="row.confidence >= 50 && row.confidence < 80" [class.low]="row.confidence < 50">{{ row.confidence }}%</span>
          </div>
          <input class="form-input" [value]="row.sourceColumn" (change)="onMappingChange(row.targetField, $event)" placeholder="Source column name" />
          <small class="mapping-aliases" *ngIf="row.aliases.length">Aliases: {{ row.aliases.join(', ') }}</small>
        </article>
        <p class="empty-state" *ngIf="!store.mappingDraft().length">No template columns loaded. Select a resource first.</p>
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
    .score-card strong { font-size: 28px; line-height: 1; }
    .score-card span { color: #64748b; font-size: 11px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.02em; }
    .score-card small { color: #64748b; font-size: 12px; }
    .score-card.warning { border-color: #f59e0b; background: #fffbeb; }
    .card-label { color: #64748b; font-size: 11px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.02em; display: block; margin-bottom: 6px; }
    .profile-bar { padding: 16px; border: 1px solid #e2e8f0; border-radius: 10px; background: #ffffff; display: grid; gap: 10px; }
    .profile-list { display: grid; gap: 8px; }
    .profile-item { display: flex; align-items: center; gap: 12px; padding: 10px 12px; border: 1px solid #e2e8f0; border-radius: 8px; background: #fafcfb; }
    .profile-body { flex: 1; min-width: 0; display: grid; gap: 2px; }
    .profile-body strong { font-size: 13px; }
    .profile-body small { font-size: 11px; color: #64748b; }
    .empty-state { color: #64748b; font-size: 12px; padding: 8px 0; margin: 0; }
    .btn-secondary { min-height: 36px; border: 1px solid #e2e8f0; border-radius: 8px; padding: 0 12px; font-weight: 700; font-size: 12px; cursor: pointer; background: #ffffff; color: #172033; flex-shrink: 0; }
    .btn-secondary:hover { background: #f8fafc; }
    .mapping-table { padding: 16px; border: 1px solid #e2e8f0; border-radius: 10px; background: #ffffff; display: grid; gap: 10px; }
    .mapping-header { display: flex; align-items: center; justify-content: space-between; }
    .mapping-row { display: grid; grid-template-columns: 1fr auto 1fr; gap: 10px; align-items: center; padding: 10px 12px; border: 1px solid #e2e8f0; border-radius: 8px; background: #fafcfb; }
    .mapping-info { display: flex; align-items: center; gap: 8px; }
    .mapping-info strong { font-size: 13px; }
    .required-badge { font-size: 9px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.03em; padding: 2px 6px; border-radius: 999px; background: #fef2f2; color: #b91c1c; }
    .mapping-confidence { display: flex; align-items: center; }
    .confidence-badge { font-size: 11px; font-weight: 800; padding: 3px 8px; border-radius: 999px; }
    .confidence-badge.high { background: #e8f7f4; color: #0f766e; }
    .confidence-badge.medium { background: #fffbeb; color: #b45309; }
    .confidence-badge.low { background: #fef2f2; color: #b91c1c; }
    .form-input { width: 100%; min-height: 38px; border: 1px solid #e2e8f0; border-radius: 8px; background: #ffffff; padding: 8px 10px; color: #172033; font-weight: 700; box-sizing: border-box; font-size: 13px; }
    .form-input:focus { border-color: #0f8f7f; outline: 2px solid rgba(15,143,127,.12); background: #ffffff; }
    .mapping-aliases { color: #64748b; font-size: 11px; grid-column: 1 / -1; }
    @media (max-width: 760px) { .mapping-row { grid-template-columns: 1fr; } .migration-shell { padding: 10px; } }
  `]
})
export class DataMigrationAiMappingComponent {
  readonly store = inject(DataMigrationStore);
  private readonly router = inject(Router);
  readonly Object = Object;

  onMappingChange(targetField: string, event: Event): void {
    this.store.setMappingSource(targetField, (event.target as HTMLInputElement).value);
  }

  back(): void {
    this.router.navigate(['/data-migration']);
  }
}
