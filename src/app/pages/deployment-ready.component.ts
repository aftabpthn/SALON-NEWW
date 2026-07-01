import { CommonModule, DatePipe } from '@angular/common';
import { Component, OnInit, computed, signal } from '@angular/core';
import { ReactiveFormsModule, UntypedFormBuilder, Validators } from '@angular/forms';
import { ApiRecord, ApiService } from '../core/api.service';
import { StateComponent } from '../shared/ui/state/state.component';
import { AuraKpiCardComponent } from '../shared/ui/aura-kpi-card/aura-kpi-card.component';

@Component({
  selector: 'app-deployment-ready',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, DatePipe, StateComponent, AuraKpiCardComponent],
  template: `
    <section class="page-stack">
      <div class="module-hero">
        <div>
          <span class="eyebrow">Level 26 · Deployment ready</span>
          <h2>Docker, environment config, production build, backend start, database backup and deployment guide</h2>
        </div>
        <div class="hero-actions">
          <button class="ghost-button" type="button" (click)="load()">Refresh</button>
          <button class="primary-button" type="button" (click)="runPreflight()" [disabled]="busy()">Run preflight</button>
          <button class="dark-button" type="button" (click)="createBackup()" [disabled]="busy()">Backup database</button>
        </div>
      </div>

      <app-state [loading]="loading()" [error]="error()"></app-state>

      <div class="metrics-grid" *ngIf="summary()?.metrics as metrics">
        <aura-kpi-card tone="teal" target="/kpi-details/deployment/ready-items"><span>Ready items</span><strong>{{ metrics.readyItems }}/{{ metrics.checklistItems }}</strong></aura-kpi-card>
        <aura-kpi-card tone="blue" target="/kpi-details/deployment/events"><span>Events</span><strong>{{ metrics.events }}</strong></aura-kpi-card>
        <aura-kpi-card tone="green" target="/kpi-details/deployment/backups"><span>Backups</span><strong>{{ metrics.backups }}</strong></aura-kpi-card>
      </div>

      <div class="dashboard-grid">
        <section class="panel">
          <div class="section-title"><h2>Preflight checklist</h2></div>
          <div class="rank-list">
            <article *ngFor="let item of checklist()">
              <div><strong>{{ item.name }}</strong><span>{{ item.detail }}</span></div>
              <span class="badge" [class.success]="item.passed">{{ item.passed ? 'ready' : 'missing' }}</span>
            </article>
          </div>
        </section>

        <section class="form-panel">
          <h3>Record deployment event</h3>
          <form [formGroup]="eventForm" (ngSubmit)="recordEvent()">
            <label class="field"><span>Type</span><input formControlName="type" /></label>
            <label class="field"><span>Environment</span><input formControlName="environment" /></label>
            <label class="field"><span>Version</span><input formControlName="version" /></label>
            <label class="field"><span>Status</span><select formControlName="status"><option>recorded</option><option>deployed</option><option>rolled-back</option></select></label>
            <div class="form-actions"><button class="primary-button" type="submit" [disabled]="eventForm.invalid || busy()">Record event</button></div>
          </form>
        </section>
      </div>

      <section class="panel">
        <div class="section-title"><h2>Deployment events</h2></div>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Type</th><th>Environment</th><th>Version</th><th>Status</th><th>Created</th></tr></thead>
            <tbody>
              <tr *ngFor="let event of events()">
                <td>{{ event.type }}</td>
                <td>{{ event.environment }}</td>
                <td>{{ event.version || 'local' }}</td>
                <td><span class="badge" [class.success]="event.status === 'ready' || event.status === 'completed' || event.status === 'deployed'">{{ event.status }}</span></td>
                <td>{{ event.createdAt | date: 'short' }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section class="panel">
        <div class="section-title"><h2>Backups</h2></div>
        <div class="rank-list">
          <article *ngFor="let backup of backups()">
            <div><strong>{{ backup.type }}</strong><span>{{ backup.fileSizeBytes }} bytes · {{ backup.checksum }}</span></div>
            <small>{{ backup.createdAt | date: 'short' }}</small>
          </article>
        </div>
      </section>

      <pre class="result-json" *ngIf="result()">{{ result() | json }}</pre>
    </section>
  `
})
export class DeploymentReadyComponent implements OnInit {
  readonly summary = signal<ApiRecord | null>(null);
  readonly result = signal<ApiRecord | null>(null);
  readonly loading = signal(false);
  readonly busy = signal(false);
  readonly error = signal('');
  readonly checklist = computed(() => this.summary()?.checklist || []);
  readonly events = computed(() => this.summary()?.events || []);
  readonly backups = computed(() => this.summary()?.backups || []);

  readonly eventForm = this.fb.group({
    type: ['release', Validators.required],
    environment: ['production', Validators.required],
    version: ['0.2.0-level-26', Validators.required],
    status: ['recorded', Validators.required]
  });

  constructor(private readonly api: ApiService, private readonly fb: UntypedFormBuilder) {}

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.api.list<ApiRecord>('deployment/summary').subscribe({
      next: (summary) => {
        this.summary.set(summary);
        this.loading.set(false);
      },
      error: (error) => {
        this.error.set(error?.error?.error || 'Unable to load deployment readiness');
        this.loading.set(false);
      }
    });
  }

  runPreflight(): void {
    this.busy.set(true);
    this.api.post<ApiRecord>('deployment/preflight', { environment: 'production', version: this.eventForm.value.version }).subscribe({
      next: (response) => {
        this.result.set(response);
        this.busy.set(false);
        this.load();
      },
      error: (error) => {
        this.error.set(error?.error?.error || 'Unable to run preflight');
        this.busy.set(false);
      }
    });
  }

  createBackup(): void {
    this.busy.set(true);
    this.api.post<ApiRecord>('deployment/backup', { environment: 'production', version: this.eventForm.value.version }).subscribe({
      next: (response) => {
        this.result.set(response);
        this.busy.set(false);
        this.load();
      },
      error: (error) => {
        this.error.set(error?.error?.error || 'Unable to create backup');
        this.busy.set(false);
      }
    });
  }

  recordEvent(): void {
    if (this.eventForm.invalid) return;
    this.busy.set(true);
    this.api.post<ApiRecord>('deployment/events', this.eventForm.value).subscribe({
      next: (response) => {
        this.result.set(response);
        this.busy.set(false);
        this.load();
      },
      error: (error) => {
        this.error.set(error?.error?.error || 'Unable to record deployment event');
        this.busy.set(false);
      }
    });
  }
}
