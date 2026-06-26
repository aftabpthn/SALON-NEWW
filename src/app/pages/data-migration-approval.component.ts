import { CommonModule } from '@angular/common';
import { Component, inject } from '@angular/core';
import { Router, RouterModule } from '@angular/router';
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
          <p>Submit and approve migration batches</p>
        </div>
      </header>
      <section style="padding: 20px; border: 1px solid #e2e8f0; border-radius: 10px; background: #ffffff;">
        <p style="color: #64748b;">Owner sign-off workflow with approval history and submission controls.</p>
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
  `]
})
export class DataMigrationApprovalComponent {
  readonly store = inject(DataMigrationStore);
  private readonly router = inject(Router);

  back(): void {
    this.router.navigate(['/data-migration']);
  }
}
