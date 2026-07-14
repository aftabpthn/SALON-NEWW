import { CommonModule } from '@angular/common';
import { Component, OnInit, signal } from '@angular/core';
import { ReactiveFormsModule, UntypedFormBuilder, Validators } from '@angular/forms';
import { ApiRecord, ApiService } from '../core/api.service';
import { StateComponent } from '../shared/ui/state/state.component';
import { AuraKpiCardComponent } from '../shared/ui/aura-kpi-card/aura-kpi-card.component';
import { AuraDatePipe } from '../shared/pipes/aura-date.pipe';

@Component({
  selector: 'app-compliance-audit',
  standalone: true,
  imports: [AuraDatePipe, CommonModule, ReactiveFormsModule, StateComponent, AuraKpiCardComponent],
  template: `
    <section class="page-stack">
      <div class="module-hero">
        <div>
          <h2>Booking, billing, client deletion, payment, discount and login history with actor tracking</h2>
        </div>
        <button class="ghost-button" type="button" (click)="load()">Refresh</button>
      </div>

      <app-state [loading]="loading()" [error]="error()"></app-state>

      <div class="metrics-grid" *ngIf="summary()?.metrics as metrics">
        <aura-kpi-card tone="neutral" target="/kpi-details/compliance/tracked-events"><span>Tracked events</span><strong>{{ metrics.trackedEvents }}</strong></aura-kpi-card>
        <aura-kpi-card tone="neutral" target="/kpi-details/compliance/bookings-created"><span>Bookings created</span><strong>{{ metrics.bookingCreates }}</strong></aura-kpi-card>
        <aura-kpi-card tone="neutral" target="/kpi-details/compliance/bills-edited"><span>Bills edited</span><strong>{{ metrics.billEdits }}</strong></aura-kpi-card>
        <aura-kpi-card tone="neutral" target="/kpi-details/compliance/clients-deleted"><span>Clients deleted</span><strong>{{ metrics.clientDeletes }}</strong></aura-kpi-card>
        <aura-kpi-card tone="neutral" target="/kpi-details/compliance/payment-changes"><span>Payment changes</span><strong>{{ metrics.paymentChanges }}</strong></aura-kpi-card>
        <aura-kpi-card tone="neutral" target="/kpi-details/compliance/logins"><span>Logins</span><strong>{{ metrics.logins }}</strong></aura-kpi-card>
      </div>

      <section class="form-panel">
        <h3>Record compliance note</h3>
        <form [formGroup]="auditForm" (ngSubmit)="recordAudit()">
          <label class="field"><span>Action</span><input formControlName="action" /></label>
          <label class="field"><span>Target type</span><input formControlName="targetType" /></label>
          <label class="field"><span>Target ID</span><input formControlName="targetId" /></label>
          <label class="field"><span>Severity</span><select formControlName="severity"><option>info</option><option>warning</option><option>critical</option></select></label>
          <label class="field full"><span>Details</span><input formControlName="details" /></label>
          <div class="form-actions"><button class="primary-button" type="submit" [disabled]="auditForm.invalid || saving()">Record note</button></div>
        </form>
      </section>

      <div class="dashboard-grid">
        <section class="panel">
          <div class="section-title"><h2>Compliance buckets</h2></div>
          <div class="quick-grid">
            <article class="action-card" *ngFor="let bucket of bucketEntries()">
              <strong>{{ bucket[0] }}</strong>
              <span>{{ bucket[1].length }} events</span>
            </article>
          </div>
        </section>

        <section class="panel">
          <div class="section-title"><h2>Login history</h2></div>
          <div class="rank-list">
            <article *ngFor="let login of summary()?.buckets?.loginHistory || []">
              <div><strong>{{ login.actorUserId || 'unknown' }}</strong><span>{{ login.actorRole }} · {{ login.createdAt | auraDate:'date' }}</span></div>
              <span class="badge">{{ login.ipAddress || 'local' }}</span>
            </article>
          </div>
        </section>
      </div>

      <section class="panel">
        <div class="section-title"><h2>Audit ledger</h2></div>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Action</th><th>Actor</th><th>Target</th><th>Severity</th><th>Created</th></tr></thead>
            <tbody>
              <tr *ngFor="let log of summary()?.auditLogs || []">
                <td>{{ log.action }}</td>
                <td>{{ log.actorRole }} · {{ log.actorUserId }}</td>
                <td>{{ log.targetType }} {{ log.targetId }}</td>
                <td><span class="badge">{{ log.severity }}</span></td>
                <td>{{ log.createdAt | auraDate:'date' }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <pre class="result-json" *ngIf="result()">{{ result() | json }}</pre>
    </section>
  `
})
export class ComplianceAuditComponent implements OnInit {
  readonly summary = signal<ApiRecord | null>(null);
  readonly result = signal<ApiRecord | null>(null);
  readonly loading = signal(false);
  readonly saving = signal(false);
  readonly error = signal('');

  readonly auditForm = this.fb.group({
    action: ['compliance.manual_note', Validators.required],
    targetType: ['audit_review', Validators.required],
    targetId: ['front-desk-review'],
    severity: ['info', Validators.required],
    details: ['Reviewed daily compliance trail']
  });

  constructor(private readonly api: ApiService, private readonly fb: UntypedFormBuilder) {}

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.api.list<ApiRecord>('security/compliance').subscribe({
      next: (summary) => {
        this.summary.set(summary);
        this.loading.set(false);
      },
      error: (error) => {
        this.error.set(error?.error?.error || 'Unable to load compliance ledger');
        this.loading.set(false);
      }
    });
  }

  bucketEntries(): [string, ApiRecord[]][] {
    return Object.entries(this.summary()?.buckets || {}) as [string, ApiRecord[]][];
  }

  recordAudit(): void {
    if (this.auditForm.invalid) return;
    this.saving.set(true);
    const value = this.auditForm.value;
    this.api.post<ApiRecord>('security/audit', {
      action: value.action,
      targetType: value.targetType,
      targetId: value.targetId,
      severity: value.severity,
      details: { note: value.details }
    }).subscribe({
      next: (response) => {
        this.result.set(response);
        this.saving.set(false);
        this.load();
      },
      error: (error) => {
        this.error.set(error?.error?.error || 'Unable to record compliance note');
        this.saving.set(false);
      }
    });
  }
}
