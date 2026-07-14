import { CommonModule } from '@angular/common';
import { Component, OnInit, computed, signal } from '@angular/core';
import { ReactiveFormsModule, UntypedFormBuilder, Validators } from '@angular/forms';
import { ApiRecord, ApiService } from '../core/api.service';
import { StateComponent } from '../shared/ui/state/state.component';
import { AuraKpiCardComponent } from '../shared/ui/aura-kpi-card/aura-kpi-card.component';
import { AuraDatePipe } from '../shared/pipes/aura-date.pipe';

@Component({
  selector: 'app-deployment-ready',
  standalone: true,
  imports: [AuraDatePipe, CommonModule, ReactiveFormsModule, StateComponent, AuraKpiCardComponent],
  template: `
    <section class="page-stack">
      <div class="module-hero">
        <div>
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
        <aura-kpi-card tone="neutral" target="/kpi-details/deployment/ready-items"><span>Ready items</span><strong>{{ metrics.readyItems }}/{{ metrics.checklistItems }}</strong></aura-kpi-card>
        <aura-kpi-card tone="neutral" target="/kpi-details/deployment/events"><span>Events</span><strong>{{ metrics.events }}</strong></aura-kpi-card>
        <aura-kpi-card tone="neutral" target="/kpi-details/deployment/backups"><span>Backups</span><strong>{{ metrics.backups }}</strong></aura-kpi-card>
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
                <td>{{ event.createdAt | auraDate:'date' }}</td>
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
            <small>{{ backup.createdAt | auraDate:'date' }}</small>
          </article>
        </div>
      </section>

      <pre class="result-json" *ngIf="result()">{{ result() | json }}</pre>
    </section>
  `,
  styles: [`
    :host { display: block; min-width: 0; }

    .module-hero {
      align-items: flex-start !important;
      gap: 18px !important;
    }

    .module-hero > div:first-child {
      min-width: 0;
    }

    .module-hero h2 {
      max-width: 1120px;
      line-height: 1.12;
    }

    .hero-actions {
      display: flex !important;
      align-items: center !important;
      justify-content: flex-end !important;
      gap: 8px !important;
      flex-wrap: nowrap !important;
      min-width: max-content;
    }

    .hero-actions button,
    .form-actions button {
      min-height: 36px !important;
      height: 36px !important;
      padding: 0 16px !important;
      border-radius: 10px !important;
      display: inline-flex !important;
      align-items: center !important;
      justify-content: center !important;
      gap: 6px !important;
      line-height: 1 !important;
      white-space: nowrap !important;
      font-size: 0.82rem !important;
      font-weight: 800 !important;
    }

    .rank-list article {
      display: grid !important;
      grid-template-columns: minmax(0, 1fr) auto !important;
      align-items: center !important;
      gap: 14px !important;
      min-height: 70px !important;
      padding: 14px 16px !important;
    }

    .rank-list article > div {
      min-width: 0;
      display: grid;
      gap: 4px;
    }

    .rank-list article > div span {
      line-height: 1.35;
    }

    .badge {
      width: auto !important;
      min-width: 70px !important;
      height: 34px !important;
      min-height: 34px !important;
      padding: 0 14px !important;
      border-radius: 999px !important;
      display: inline-flex !important;
      align-items: center !important;
      justify-content: center !important;
      justify-self: end !important;
      align-self: center !important;
      line-height: 1 !important;
      white-space: nowrap !important;
      text-align: center !important;
      font-size: 0.72rem !important;
      font-weight: 900 !important;
      letter-spacing: 0 !important;
      text-transform: lowercase !important;
      background: #fff7ed !important;
      color: #9a3412 !important;
      border: 1px solid #fed7aa !important;
      box-shadow: none !important;
    }

    .badge.success {
      background: #FBF0E8 !important;
      color: #0f5f56 !important;
      border-color: #bde9dc !important;
    }

    td .badge {
      min-width: 84px !important;
      height: 30px !important;
      min-height: 30px !important;
      font-size: 0.7rem !important;
    }

    .form-actions {
      display: flex !important;
      justify-content: flex-end !important;
      align-items: center !important;
      gap: 8px !important;
    }

    :host-context([data-theme="dark"]) .badge {
      background: rgba(251, 146, 60, 0.16) !important;
      color: #fed7aa !important;
      border-color: rgba(251, 146, 60, 0.32) !important;
    }

    :host-context([data-theme="dark"]) .badge.success {
      background: rgba(214, 79, 146, 0.18) !important;
      color: #D4B8CC !important;
      border-color: rgba(200, 160, 184, 0.36) !important;
    }

    @media (max-width: 900px) {
      .module-hero {
        align-items: stretch !important;
      }

      .hero-actions {
        justify-content: flex-start !important;
        flex-wrap: wrap !important;
        min-width: 0;
      }
    }

    @media (max-width: 560px) {
      .rank-list article {
        grid-template-columns: 1fr !important;
        align-items: start !important;
      }

      .badge {
        justify-self: start !important;
      }

      .hero-actions button,
      .form-actions button {
        flex: 1 1 100%;
      }
    }
  `]
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
