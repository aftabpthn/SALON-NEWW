import { CommonModule } from '@angular/common';
import { Component, OnInit, computed, signal } from '@angular/core';
import { ApiRecord, ApiService } from '../core/api.service';
import { StateComponent } from '../shared/ui/state/state.component';
import { AuraKpiCardComponent } from '../shared/ui/aura-kpi-card/aura-kpi-card.component';
import { AuraDatePipe } from '../shared/pipes/aura-date.pipe';

@Component({
  selector: 'app-quality-center',
  standalone: true,
  imports: [AuraDatePipe, CommonModule, StateComponent, AuraKpiCardComponent],
  template: `
    <section class="page-stack">
      <div class="module-hero">
        <div>
          <h2>Unit tests, API tests, validation tests, build checks, error boundary and demo seed data</h2>
        </div>
        <div class="hero-actions">
          <button class="ghost-button" type="button" (click)="load()">Refresh</button>
          <button class="primary-button" type="button" (click)="runQuality()" [disabled]="busy()">Run quality audit</button>
          <button class="dark-button" type="button" (click)="seedDemo()" [disabled]="busy()">Seed demo data</button>
        </div>
      </div>

      <app-state [loading]="loading()" [error]="error()"></app-state>

      <div class="metrics-grid" *ngIf="summary()?.metrics as metrics">
        <aura-kpi-card tone="neutral" target="/kpi-details/quality/quality-runs"><span>Quality runs</span><strong>{{ metrics.runs }}</strong></aura-kpi-card>
        <aura-kpi-card tone="neutral" target="/kpi-details/quality/last-passed"><span>Last passed</span><strong>{{ metrics.lastPassed ? 'Yes' : 'No' }}</strong></aura-kpi-card>
        <aura-kpi-card tone="neutral" target="/kpi-details/quality/demo-clients"><span>Demo clients</span><strong>{{ metrics.demoClients }}</strong></aura-kpi-card>
        <aura-kpi-card tone="neutral" target="/kpi-details/quality/demo-services"><span>Demo services</span><strong>{{ metrics.demoServices }}</strong></aura-kpi-card>
      </div>

      <section class="panel">
        <div class="section-title"><h2>Quality gates</h2></div>
        <div class="quick-grid">
          <article class="action-card" *ngFor="let check of checks()">
            <strong>{{ check.name }}</strong>
            <span>{{ check.detail }}</span>
            <span class="badge" [class.success]="check.passed">{{ check.passed ? 'passed' : 'blocked' }}</span>
          </article>
        </div>
      </section>

      <section class="panel">
        <div class="section-title"><h2>Run history</h2></div>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Type</th><th>Status</th><th>Result</th><th>Completed</th></tr></thead>
            <tbody>
              <tr *ngFor="let run of runs()">
                <td>{{ run.type }}</td>
                <td><span class="badge" [class.success]="run.status === 'passed'">{{ run.status }}</span></td>
                <td>{{ run.result | json }}</td>
                <td>{{ (run.completedAt || run.createdAt) | auraDate:'date' }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <pre class="result-json" *ngIf="result()">{{ result() | json }}</pre>
    </section>
  `
})
export class QualityCenterComponent implements OnInit {
  readonly summary = signal<ApiRecord | null>(null);
  readonly result = signal<ApiRecord | null>(null);
  readonly loading = signal(false);
  readonly busy = signal(false);
  readonly error = signal('');
  readonly checks = computed(() => this.summary()?.checks || []);
  readonly runs = computed(() => this.summary()?.runs || []);

  constructor(private readonly api: ApiService) {}

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.api.list<ApiRecord>('quality/summary').subscribe({
      next: (summary) => {
        this.summary.set(summary);
        this.loading.set(false);
      },
      error: (error) => {
        this.error.set(error?.error?.error || 'Unable to load quality center');
        this.loading.set(false);
      }
    });
  }

  runQuality(): void {
    this.busy.set(true);
    this.api.post<ApiRecord>('quality/run', { type: 'manual-quality-audit' }).subscribe({
      next: (response) => {
        this.result.set(response);
        this.busy.set(false);
        this.load();
      },
      error: (error) => {
        this.error.set(error?.error?.error || 'Unable to run quality audit');
        this.busy.set(false);
      }
    });
  }

  seedDemo(): void {
    this.busy.set(true);
    this.api.post<ApiRecord>('quality/seed-demo', {}).subscribe({
      next: (response) => {
        this.result.set(response);
        this.busy.set(false);
        this.load();
      },
      error: (error) => {
        this.error.set(error?.error?.error || 'Unable to seed demo data');
        this.busy.set(false);
      }
    });
  }
}
