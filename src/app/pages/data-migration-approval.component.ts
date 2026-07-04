import { CommonModule } from '@angular/common';
import { Component, inject } from '@angular/core';
import { Router } from '@angular/router';
import { DataMigrationStore } from './data-migration.store';

@Component({
  selector: 'app-data-migration-approval',
  standalone: true,
  imports: [CommonModule],
  template: `
    <section class="migration-shell">
      <header class="command-header">
        <div>
          <button class="back-btn" (click)="back()">← Back to Dashboard</button>
          <h1>Approval Workflow</h1>
        </div>
        <div class="score-card aura-card">
          <span>Approvals</span>
          <strong>{{ store.approvals().length }}</strong>
          <small>{{ pendingCount() }} pending</small>
        </div>
      </header>

      <section class="submit-section">
        <span class="card-label">Submit for Approval</span>
        <textarea class="form-input note-input" [value]="store.approvalNote" (change)="setNote($event)" placeholder="Approval note (optional)" rows="3"></textarea>
        <button class="btn-primary" (click)="store.submitApproval()" [disabled]="store.loading()">Submit for Approval</button>
        <button class="btn-secondary" (click)="store.loadApprovals()">↻ Refresh Approvals</button>
      </section>

      <section class="pending-card" *ngIf="store.latestPendingApproval()">
        <span class="card-label">Latest pending approval</span>
        <div class="pending-detail">
          <div class="pending-info">
            <strong>Approval #{{ store.latestPendingApproval()?.id?.slice(0,8) }}</strong>
            <span class="status-pill active">Pending</span>
            <small *ngIf="store.latestPendingApproval()?.note">Note: {{ store.latestPendingApproval()?.note }}</small>
            <small *ngIf="store.latestPendingApproval()?.submittedAt">Submitted: {{ store.latestPendingApproval()?.submittedAt }}</small>
          </div>
          <div class="pending-actions">
            <button class="btn-primary" (click)="store.decideApproval(store.latestPendingApproval()?.id || '', 'approved')">Approve</button>
            <button class="btn-danger" (click)="store.decideApproval(store.latestPendingApproval()?.id || '', 'rejected')">Reject</button>
          </div>
        </div>
      </section>

      <section class="approval-list">
        <span class="card-label">Approval history</span>
        <article class="approval-item" *ngFor="let approval of store.approvals()">
          <div class="approval-id">
            <strong>#{{ approval.id.slice(0,8) }}</strong>
            <span class="status-pill" [class.good]="approval.status === 'approved'" [class.active]="approval.status === 'pending'" [class.blocked]="approval.status === 'rejected'">{{ approval.status }}</span>
          </div>
          <div class="approval-meta">
            <small *ngIf="approval.resource">Resource: {{ approval.resource }}</small>
            <small *ngIf="approval.note">Note: {{ approval.note }}</small>
            <small *ngIf="approval.submittedAt">{{ approval.submittedAt }}</small>
            <small *ngIf="approval.reviewedAt">Reviewed: {{ approval.reviewedAt }}</small>
          </div>
          <div class="approval-actions" *ngIf="approval.status === 'pending'">
            <button class="btn-small good" (click)="store.decideApproval(approval.id, 'approved')">✓ Approve</button>
            <button class="btn-small danger" (click)="store.decideApproval(approval.id, 'rejected')">✗ Reject</button>
          </div>
        </article>
        <p class="empty-state" *ngIf="!store.approvals().length">No approval records yet.</p>
      </section>

      <section class="debug-section" *ngIf="store.approvalDebug()">
        <span class="card-label">Debug</span>
        <p>{{ store.approvalDebug() }}</p>
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
    .back-btn { background: none; border: 1px solid #e2e8f0; border-radius: 8px; padding: 6px 14px; font-size: 12px; font-weight: 700; cursor: pointer; color: #4f46e5; margin-bottom: 8px; }
    .back-btn:hover { background: #f1f5f9; }
    .score-card { border: 1px solid #e2e8f0; border-radius: 10px; background: #ffffff; display: grid; align-content: center; gap: 4px; padding: 14px; }
    .score-card strong { font-size: 24px; line-height: 1; }
    .score-card span { color: #64748b; font-size: 11px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.02em; }
    .score-card small { color: #64748b; font-size: 12px; }
    .card-label { color: #64748b; font-size: 11px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.02em; display: block; margin-bottom: 6px; }
    .submit-section { padding: 16px; border: 1px solid #e2e8f0; border-radius: 10px; background: #ffffff; display: grid; gap: 10px; }
    .form-input { width: 100%; min-height: 38px; border: 1px solid #e2e8f0; border-radius: 8px; background: #fafcfb; padding: 8px 10px; color: #172033; font-weight: 700; box-sizing: border-box; font-size: 13px; }
    .form-input:focus { border-color: #5A153F; outline: 2px solid rgba(90,21,63,.12); background: #ffffff; }
    .note-input { font-weight: 400; resize: vertical; }
    .btn-primary { min-height: 36px; border: 1px solid #5A153F; border-radius: 8px; padding: 0 16px; font-weight: 700; font-size: 12px; cursor: pointer; background: #5A153F; color: #ffffff; }
    .btn-primary:disabled { opacity: .5; cursor: not-allowed; }
    .btn-secondary { min-height: 36px; border: 1px solid #e2e8f0; border-radius: 8px; padding: 0 12px; font-weight: 700; font-size: 12px; cursor: pointer; background: #ffffff; color: #172033; }
    .btn-secondary:hover { background: #f8fafc; }
    .btn-danger { min-height: 36px; border: 1px solid #fecaca; border-radius: 8px; padding: 0 12px; font-weight: 700; font-size: 12px; cursor: pointer; background: #fef2f2; color: #b91c1c; }
    .btn-danger:hover { background: #fee2e2; }
    .pending-card { padding: 16px; border: 1px solid #f59e0b; border-radius: 10px; background: #fffbeb; display: grid; gap: 10px; }
    .pending-detail { display: flex; align-items: center; justify-content: space-between; gap: 16px; flex-wrap: wrap; }
    .pending-info { display: grid; gap: 4px; }
    .pending-info strong { font-size: 14px; }
    .pending-info small { font-size: 12px; color: #64748b; }
    .pending-actions { display: flex; gap: 8px; }
    .status-pill { font-size: 10px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.03em; padding: 3px 8px; border-radius: 999px; white-space: nowrap; display: inline-block; }
    .status-pill.good { background: #f5f2ef; color: #4B1238; }
    .status-pill.active { background: #fffbeb; color: #b45309; }
    .status-pill.blocked { background: #fef2f2; color: #b91c1c; }
    .approval-list { padding: 16px; border: 1px solid #e2e8f0; border-radius: 10px; background: #ffffff; display: grid; gap: 8px; }
    .approval-item { display: flex; align-items: center; gap: 12px; padding: 10px 12px; border: 1px solid #e2e8f0; border-radius: 8px; background: #fafcfb; flex-wrap: wrap; }
    .approval-id { display: flex; align-items: center; gap: 8px; }
    .approval-id strong { font-size: 13px; }
    .approval-meta { flex: 1; min-width: 0; display: flex; gap: 12px; flex-wrap: wrap; }
    .approval-meta small { font-size: 11px; color: #64748b; }
    .approval-actions { display: flex; gap: 6px; }
    .btn-small { min-height: 28px; border-radius: 6px; padding: 0 10px; font-weight: 700; font-size: 11px; cursor: pointer; border: 1px solid #e2e8f0; background: #ffffff; }
    .btn-small.good { background: #f5f2ef; color: #4B1238; border-color: #DCC4D4; }
    .btn-small.danger { background: #fef2f2; color: #b91c1c; border-color: #fecaca; }
    .empty-state { color: #64748b; font-size: 12px; padding: 8px 0; margin: 0; }
    .debug-section { padding: 12px; border: 1px solid #e2e8f0; border-radius: 10px; background: #ffffff; }
    .debug-section p { margin: 0; font-size: 12px; color: #64748b; }
    .message { padding: 12px 16px; border-radius: 10px; font-weight: 700; font-size: 13px; }
    .message.error { background: #fef2f2; color: #b91c1c; border: 1px solid #fecaca; }
    .message.success { background: #f5f2ef; color: #4B1238; border: 1px solid #DCC4D4; }
    .loading-section { display: flex; align-items: center; gap: 10px; padding: 16px; background: #fffbeb; border: 1px solid #f59e0b; border-radius: 10px; font-weight: 700; font-size: 13px; }
    .spinner { width: 18px; height: 18px; border: 3px solid #e2e8f0; border-top-color: #5A153F; border-radius: 50%; animation: spin .6s linear infinite; }
    @keyframes spin { to { transform: rotate(360deg); } }
    @media (max-width: 760px) { .migration-shell { padding: 10px; } .command-header { grid-template-columns: 1fr; } }
  `]
})
export class DataMigrationApprovalComponent {
  readonly store = inject(DataMigrationStore);
  private readonly router = inject(Router);

  back(): void {
    this.router.navigate(['/data-migration']);
  }

  pendingCount(): number {
    return this.store.approvals().filter(a => a.status === 'pending').length;
  }

  setNote(event: Event): void {
    this.store.approvalNote = (event.target as HTMLTextAreaElement).value;
  }
}
