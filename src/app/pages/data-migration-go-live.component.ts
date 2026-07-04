import { CommonModule } from '@angular/common';
import { Component, inject } from '@angular/core';
import { Router } from '@angular/router';
import { DataMigrationStore } from './data-migration.store';

@Component({
  selector: 'app-data-migration-go-live',
  standalone: true,
  imports: [CommonModule],
  template: `
    <section class="migration-shell">
      <header class="command-header">
        <div>
          <button class="back-btn" (click)="back()">← Back to Dashboard</button>
          <h1>Go-Live Checklist</h1>
        </div>
        <div class="score-card aura-card" [class.danger]="store.readinessScore() < 60" [class.warning]="store.readinessScore() >= 60 && store.readinessScore() < 85" [class.aura-card--tone-danger]="store.readinessScore() < 60" [class.aura-card--tone-warning]="store.readinessScore() >= 60 && store.readinessScore() < 85">
          <span>Readiness</span>
          <strong>{{ store.readinessScore() }}%</strong>
          <small>{{ store.goLiveGate() }}</small>
        </div>
      </header>

      <section class="checklist-grid">
        <div class="checklist-col">
          <span class="card-label">Completion checklist</span>
          <article class="check-item" *ngFor="let item of store.completionChecklist()">
            <span class="check-icon" [class.done]="item.done">{{ item.done ? '✓' : '○' }}</span>
            <span class="check-label">{{ item.label }}</span>
          </article>
        </div>
        <div class="checklist-col">
          <span class="card-label">Enterprise validation</span>
          <article class="check-item" *ngFor="let item of store.enterpriseChecklist()">
            <span class="check-icon" [class.done]="item.done">{{ item.done ? '✓' : '○' }}</span>
            <span class="check-label">{{ item.label }}</span>
          </article>
        </div>
      </section>

      <section class="sandbox-section">
        <label class="toggle-label">
          <input type="checkbox" [checked]="store.sandboxMode()" (change)="onSandboxChange($event)" />
          <span>Sandbox mode</span>
        </label>
      </section>

      <section class="gate-section">
        <span class="card-label">Go-Live Gate</span>
        <div class="gate-status">
          <span class="status-pill" [class.good]="store.readinessScore() >= 85" [class.active]="store.readinessScore() >= 60 && store.readinessScore() < 85" [class.blocked]="store.readinessScore() < 60">{{ store.goLiveGate() }}</span>
        </div>
      </section>

      <section class="rollback-section">
        <span class="card-label">Rollback</span>
        <p class="rollback-history" *ngIf="store.onboarding()?.rollbackHistory != null">
          <strong>{{ store.onboarding()?.rollbackHistory }}</strong> completed rollback batches
        </p>
        <textarea class="form-input" [value]="store.rollbackReason()" (change)="onRollbackReasonChange($event)" placeholder="Rollback reason (optional)" rows="2"></textarea>
        <button class="btn-danger" (click)="store.rollbackLast()" [disabled]="store.loading()">Rollback Last Import</button>
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
    .command-header { display: grid; grid-template-columns: minmax(0, 1fr) 200px; gap: 16px; align-items: center; padding: 18px 20px; border: 1px solid #e2e8f0; border-radius: 12px; background: linear-gradient(135deg, #faf8f6, #ffffff 62%, #f0ece9); box-shadow: 0 1px 3px rgba(0,0,0,0.04), 0 1px 6px rgba(0,0,0,0.04); }
    .command-header h1 { margin: 4px 0; font-size: 22px; line-height: 1.1; letter-spacing: -0.01em; }
    .command-header p { margin: 0; max-width: 800px; color: #64748b; font-size: 13px; line-height: 1.45; }
    .back-btn { background: none; border: 1px solid #E7DDD6; border-radius: 8px; padding: 6px 14px; font-size: 12px; font-weight: 700; cursor: pointer; color: #4B1238; margin-bottom: 8px; }
    .back-btn:hover { background: #f1f5f9; }
    .score-card { border: 1px solid #e2e8f0; border-radius: 10px; background: #ffffff; display: grid; align-content: center; gap: 4px; padding: 14px; }
    .score-card strong { font-size: 32px; line-height: 1; }
    .score-card span { color: #64748b; font-size: 11px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.02em; }
    .score-card small { color: #64748b; font-size: 12px; }
    .score-card.warning { border-color: #f59e0b; background: #fffbeb; }
    .score-card.danger { border-color: #ef4444; background: #fef2f2; }
    .card-label { color: #64748b; font-size: 11px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.02em; display: block; margin-bottom: 6px; }
    .checklist-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
    .checklist-col { padding: 16px; border: 1px solid #e2e8f0; border-radius: 10px; background: #ffffff; display: grid; gap: 8px; }
    .check-item { display: flex; align-items: center; gap: 10px; padding: 6px 0; }
    .check-icon { width: 22px; height: 22px; border-radius: 50%; border: 2px solid #e2e8f0; display: flex; align-items: center; justify-content: center; font-size: 12px; font-weight: 800; color: #64748b; flex-shrink: 0; }
    .check-icon.done { background: #5A153F; border-color: #5A153F; color: #ffffff; }
    .check-label { font-size: 13px; font-weight: 600; }
    .sandbox-section { display: flex; align-items: center; gap: 10px; padding: 12px 16px; border: 1px solid #e2e8f0; border-radius: 10px; background: #ffffff; }
    .toggle-label { display: flex; align-items: center; gap: 8px; font-weight: 700; font-size: 13px; cursor: pointer; }
    .gate-section { padding: 16px; border: 1px solid #e2e8f0; border-radius: 10px; background: #ffffff; display: grid; gap: 8px; }
    .gate-status { display: flex; align-items: center; gap: 10px; }
    .status-pill { font-size: 12px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.03em; padding: 6px 14px; border-radius: 999px; }
    .status-pill.good { background: #f5f2ef; color: #4B1238; }
    .status-pill.active { background: #fffbeb; color: #b45309; }
    .status-pill.blocked { background: #fef2f2; color: #b91c1c; }
    .rollback-section { padding: 16px; border: 1px solid #e2e8f0; border-radius: 10px; background: #ffffff; display: grid; gap: 10px; }
    .rollback-history { margin: 0; font-size: 13px; }
    .rollback-history strong { font-size: 18px; }
    .form-input { width: 100%; min-height: 38px; border: 1px solid #e2e8f0; border-radius: 8px; background: #fafcfb; padding: 8px 10px; color: #172033; font-weight: 700; box-sizing: border-box; font-size: 13px; }
    .form-input:focus { border-color: #5A153F; outline: 2px solid rgba(90,21,63,.12); background: #ffffff; }
    .btn-danger { min-height: 36px; border: 1px solid #fecaca; border-radius: 8px; padding: 0 12px; font-weight: 700; font-size: 12px; cursor: pointer; background: #fef2f2; color: #b91c1c; }
    .btn-danger:hover { background: #fee2e2; }
    .btn-danger:disabled { opacity: .5; cursor: not-allowed; }
    .message { padding: 12px 16px; border-radius: 10px; font-weight: 700; font-size: 13px; }
    .message.error { background: #fef2f2; color: #b91c1c; border: 1px solid #fecaca; }
    .message.success { background: #f5f2ef; color: #4B1238; border: 1px solid #DCC4D4; }
    .loading-section { display: flex; align-items: center; gap: 10px; padding: 16px; background: #fffbeb; border: 1px solid #f59e0b; border-radius: 10px; font-weight: 700; font-size: 13px; }
    .spinner { width: 18px; height: 18px; border: 3px solid #e2e8f0; border-top-color: #5A153F; border-radius: 50%; animation: spin .6s linear infinite; }
    @keyframes spin { to { transform: rotate(360deg); } }
    @media (max-width: 760px) { .checklist-grid { grid-template-columns: 1fr; } .migration-shell { padding: 10px; } .command-header { grid-template-columns: 1fr; } }
  `]
})
export class DataMigrationGoLiveComponent {
  readonly store = inject(DataMigrationStore);
  private readonly router = inject(Router);

  onSandboxChange(event: Event): void {
    this.store.sandboxMode.set((event.target as HTMLInputElement).checked);
  }

  onRollbackReasonChange(event: Event): void {
    this.store.rollbackReason.set((event.target as HTMLTextAreaElement).value);
  }

  back(): void {
    this.router.navigate(['/data-migration']);
  }
}
