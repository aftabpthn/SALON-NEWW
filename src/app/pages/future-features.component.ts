import { CommonModule, CurrencyPipe, DatePipe, DecimalPipe } from '@angular/common';
import { Component, OnInit, signal } from '@angular/core';
import { FormsModule, ReactiveFormsModule, UntypedFormBuilder } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { ApiRecord, ApiService } from '../core/api.service';
import { StateComponent } from '../shared/ui/state/state.component';
import { AuraKpiCardComponent } from '../shared/ui/aura-kpi-card/aura-kpi-card.component';

type WorkflowOption = {
  type: string;
  label: string;
  category: string;
  prompt: string;
  summary: string;
};

@Component({
  selector: 'app-future-features',
  standalone: true,
  imports: [CommonModule, FormsModule, ReactiveFormsModule, RouterModule, CurrencyPipe, DatePipe, DecimalPipe, StateComponent, AuraKpiCardComponent],
  template: `
    <section class="page-stack future-command-page">
      <div class="future-hero">
        <div class="hero-orb hero-orb-a"></div>
        <div class="hero-orb hero-orb-b"></div>
        <div class="future-hero-copy">
          <span class="eyebrow">AI Innovation Command Center</span>
          <h2>Live connected future intelligence for growth, pricing, booking, inventory and front desk automation</h2>
          <div class="future-signal-row">
            <span>{{ metric('liveSources') }}/{{ sourceHealth().totalSources || 0 }} live data sources</span>
            <span>{{ metric('automationReady') }} connected workflows</span>
            <span>{{ metric('connectedModules') }} enterprise modules linked</span>
            <span>{{ metric('innovationRuns') }} persisted runs</span>
          </div>
        </div>
        <div class="future-hero-actions">
          <a class="dark-button" routerLink="/ai">Open AI assistant</a>
          <button class="ghost-button" type="button" (click)="load()">Refresh live map</button>
        </div>
      </div>

      <app-state [loading]="loading()" [error]="error()"></app-state>

      <div class="metrics-grid" *ngIf="summary()?.metrics as metrics">
        <aura-kpi-card tone="teal" target="/kpi-details/future-features/live-sources"><span>Live sources</span><strong>{{ metrics.liveSources || 0 }}/{{ sourceHealth().totalSources || 0 }}</strong></aura-kpi-card>
        <aura-kpi-card tone="blue" target="/kpi-details/future-features/automation-ready"><span>Connected workflows</span><strong>{{ metrics.automationReady || 0 }}</strong></aura-kpi-card>
        <aura-kpi-card tone="amber" target="/kpi-details/future-features/innovation-runs"><span>Innovation runs</span><strong>{{ metrics.innovationRuns || 0 }}</strong></aura-kpi-card>
        <aura-kpi-card tone="red" target="/kpi-details/future-features/no-show-risk"><span>No-show risk</span><strong>{{ metrics.noShowRisk || 0 }}</strong></aura-kpi-card>
        <aura-kpi-card tone="green" target="/kpi-details/future-features/demand-index"><span>Demand index</span><strong>{{ metrics.demandIndex || 0 }}</strong></aura-kpi-card>
        <aura-kpi-card tone="violet" target="/kpi-details/future-features/pricing-upside"><span>Pricing upside</span><strong>{{ (metrics.pricingOpportunity || 0) | currency: 'INR':'symbol':'1.0-0' }}</strong></aura-kpi-card>
      </div>

      <div class="future-command-grid" *ngIf="!loading()">
        <section class="panel live-spine-panel">
          <div class="section-title">
            <div>
              <span class="eyebrow">Live data spine</span>
              <h2>Where AI gets real data</h2>
            </div>
            <span class="badge">No fake data</span>
          </div>
          <div class="source-stack">
            <a class="source-node" *ngFor="let source of sourceRows()" [routerLink]="source.route || '/future-features'">
              <span class="source-pulse" [class.muted]="source.status !== 'live'"></span>
              <div>
                <strong>{{ source.name }}</strong>
                <small>{{ source.signal }}</small>
              </div>
              <em>{{ source.count || 0 }}</em>
            </a>
          </div>
        </section>

        <section class="panel launch-panel">
          <div class="section-title">
            <div>
              <span class="eyebrow">Connected launcher</span>
              <h2>Run future feature with source trace</h2>
            </div>
            <span class="badge">{{ selectedWorkflow()?.status || 'connected' }}</span>
          </div>
          <form [formGroup]="runForm" (ngSubmit)="run()">
            <label class="field full">
              <span>Feature workflow</span>
              <select formControlName="type" (change)="selectType($any($event.target).value)">
                <option *ngFor="let workflow of workflows" [value]="workflow.type">{{ workflow.label }}</option>
              </select>
            </label>
            <label class="field full">
              <span>Prompt, transcript or business instruction</span>
              <textarea formControlName="prompt" placeholder="Example: Find this week's highest-value growth actions and show connected modules."></textarea>
            </label>
            <div class="interconnect-strip">
              <article>
                <span>Input modules</span>
                <strong>{{ selectedModules().join(' + ') || 'Live data sources' }}</strong>
              </article>
              <article>
                <span>AI workflow</span>
                <strong>{{ selectedWorkflow()?.label || selectedOption()?.label }}</strong>
              </article>
              <article>
                <span>Next action</span>
                <strong>{{ selectedWorkflow()?.action || selectedOption()?.summary }}</strong>
              </article>
            </div>
            <div class="source-chip-row">
              <span *ngFor="let signal of selectedSignals()">{{ signal }}</span>
            </div>
            <div class="form-actions">
              <button class="primary-button" type="submit">Run connected intelligence</button>
            </div>
          </form>
        </section>

        <section class="panel action-rail-panel">
          <div class="section-title">
            <div>
              <span class="eyebrow">Action rail</span>
              <h2>Where output goes next</h2>
            </div>
          </div>
          <div class="action-rail">
            <a class="action-link" *ngFor="let action of actionRows()" [routerLink]="action.route || '/future-features'">
              <div>
                <strong>{{ action.title }}</strong>
                <small>{{ action.source }} → {{ action.target }}</small>
              </div>
              <span>{{ action.status }}</span>
            </a>
          </div>
        </section>
      </div>

      <section class="panel">
        <div class="section-title">
          <div>
            <span class="eyebrow">Enterprise interconnect map</span>
            <h2>10 AI workflows connected to live operational modules</h2>
          </div>
          <span class="badge">{{ metric('actionPaths') }} action paths</span>
        </div>
        <div class="workflow-map-grid">
          <article class="workflow-map-card" *ngFor="let workflow of workflowRows()" [class.active]="selectedType() === workflow.type" (click)="selectType(workflow.type)">
            <div class="workflow-card-head">
              <span>{{ workflow.category }}</span>
              <em>{{ workflow.runCount || 0 }} runs</em>
            </div>
            <strong>{{ workflow.label }}</strong>
            <p>{{ workflow.liveRecordCount || 0 }} live records from {{ workflow.sourceCount || 0 }} sources</p>
            <div class="route-chip-row">
              <a *ngFor="let route of workflow.routes || []" [routerLink]="route" (click)="$event.stopPropagation()">{{ route }}</a>
            </div>
          </article>
        </div>
      </section>

      <section class="panel" *ngIf="output()">
        <div class="section-title">
          <div>
            <span class="eyebrow">Latest generated output</span>
            <h2>{{ output()?.title }}</h2>
          </div>
          <span class="badge">{{ output()?.safetyMode || 'review-before-action' }}</span>
        </div>
        <div class="output-grid">
          <div class="output-card">
            <h3>Live source trace</h3>
            <div class="source-chip-row">
              <span *ngFor="let source of rows(output()?.sourceTrace)">{{ source.name }} · {{ source.count || 0 }}</span>
            </div>
            <pre class="result-json">{{ output() | json }}</pre>
          </div>
          <div class="output-card">
            <h3>Next connected routes</h3>
            <a class="action-link" *ngFor="let route of output()?.nextRoutes || []" [routerLink]="route">
              <strong>{{ route }}</strong>
              <span>Open module</span>
            </a>
          </div>
        </div>
      </section>

      <div class="dashboard-grid">
        <section class="panel">
          <div class="section-title"><h2>Growth advisor preview</h2></div>
          <ng-container *ngIf="summary()?.advisorPreview as advisor">
            <p class="strong-copy">{{ advisor.summary }}</p>
            <div class="rank-list">
              <article *ngFor="let item of advisor.priorities">
                <div><strong>{{ item.area }}</strong><span>{{ item.action }}</span></div>
                <strong>{{ item.impact | currency: 'INR':'symbol':'1.0-0' }}</strong>
              </article>
            </div>
          </ng-container>
        </section>

        <section class="panel">
          <div class="section-title"><h2>Voice and kiosk sessions</h2></div>
          <div class="rank-list">
            <article *ngFor="let session of summary()?.voiceSessions || []">
              <div><strong>{{ session.channel }}</strong><span>{{ session.status }} · {{ session.branchId || 'all branches' }}</span></div>
              <small>{{ session.createdAt | date: 'short' }}</small>
            </article>
            <article *ngFor="let session of summary()?.kioskSessions || []">
              <div><strong>{{ session.mode }}</strong><span>{{ session.status }} · {{ session.branchId }}</span></div>
              <small>{{ session.createdAt | date: 'short' }}</small>
            </article>
          </div>
        </section>
      </div>

      <section class="panel">
        <div class="section-title"><h2>Innovation run history</h2></div>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Type</th><th>Confidence</th><th>Status</th><th>Actions</th><th>Created</th></tr></thead>
            <tbody>
              <tr *ngFor="let run of summary()?.runs || []">
                <td>{{ run.type }}</td>
                <td>{{ run.confidence | number: '1.0-2' }}</td>
                <td><span class="badge">{{ run.status }}</span></td>
                <td>{{ run.actions?.length || 0 }}</td>
                <td>{{ run.createdAt | date: 'short' }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </section>
  `,
  styles: [`
    :host {
      display: block;
    }

    .future-command-page {
      color: var(--ink);
    }

    .future-hero {
      position: relative;
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: 24px;
      overflow: hidden;
      padding: clamp(26px, 4vw, 42px);
      border: 1px solid rgba(15, 118, 110, .16);
      border-radius: 32px;
      background:
        radial-gradient(circle at 82% 20%, rgba(196, 132, 26, .24), transparent 28%),
        radial-gradient(circle at 12% 88%, rgba(15, 118, 110, .18), transparent 34%),
        linear-gradient(135deg, #f8fffb 0%, #eef8f6 52%, #fff8ea 100%);
      box-shadow: 0 26px 70px rgba(15, 23, 42, .11);
    }

    .hero-orb {
      position: absolute;
      width: 220px;
      height: 220px;
      border: 1px solid rgba(15, 118, 110, .16);
      border-radius: 999px;
      pointer-events: none;
    }

    .hero-orb-a {
      right: 6%;
      top: -80px;
    }

    .hero-orb-b {
      left: 28%;
      bottom: -150px;
      width: 320px;
      height: 320px;
    }

    .future-hero-copy,
    .future-hero-actions {
      position: relative;
      z-index: 1;
    }

    .future-hero h2 {
      max-width: 1040px;
      margin: 8px 0;
      font-size: clamp(34px, 5vw, 64px);
      line-height: .92;
      letter-spacing: -0.06em;
    }

    .future-hero p {
      max-width: 820px;
      color: var(--muted);
      font-size: 1.02rem;
      font-weight: 750;
      line-height: 1.6;
    }

    .future-hero-actions {
      display: flex;
      align-items: start;
      gap: 12px;
      flex-wrap: wrap;
      justify-content: end;
    }

    .future-signal-row,
    .source-chip-row,
    .route-chip-row {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
      margin-top: 18px;
    }

    .future-signal-row span,
    .source-chip-row span,
    .route-chip-row a {
      display: inline-flex;
      align-items: center;
      min-height: 34px;
      padding: 0 12px;
      border: 1px solid rgba(15, 118, 110, .16);
      border-radius: 999px;
      background: rgba(255, 255, 255, .82);
      color: #123b36;
      font-size: .82rem;
      font-weight: 900;
      text-decoration: none;
    }

    .future-command-grid {
      display: grid;
      grid-template-columns: minmax(260px, .72fr) minmax(420px, 1.18fr) minmax(280px, .78fr);
      gap: 16px;
      align-items: start;
    }

    .source-stack,
    .action-rail {
      display: grid;
      gap: 10px;
    }

    .source-node,
    .action-link {
      display: grid;
      grid-template-columns: auto minmax(0, 1fr) auto;
      gap: 12px;
      align-items: center;
      padding: 13px;
      border: 1px solid rgba(15, 118, 110, .12);
      border-radius: 18px;
      background: linear-gradient(135deg, #ffffff, #f8fffc);
      color: inherit;
      text-decoration: none;
      transition: transform .16s ease, border-color .16s ease, box-shadow .16s ease;
    }

    .source-node:hover,
    .action-link:hover,
    .workflow-map-card:hover {
      transform: translateY(-2px);
      border-color: rgba(15, 118, 110, .32);
      box-shadow: 0 16px 36px rgba(15, 23, 42, .09);
    }

    .source-node small,
    .action-link small,
    .workflow-map-card p,
    .interconnect-strip span {
      color: var(--muted);
      font-weight: 800;
    }

    .source-node em,
    .action-link span {
      color: var(--teal);
      font-style: normal;
      font-weight: 950;
    }

    .source-pulse {
      width: 12px;
      height: 12px;
      border-radius: 999px;
      background: var(--green);
      box-shadow: 0 0 0 7px rgba(15, 138, 95, .12);
    }

    .source-pulse.muted {
      background: #94a3b8;
      box-shadow: 0 0 0 7px rgba(148, 163, 184, .16);
    }

    .interconnect-strip {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 10px;
      margin: 12px 0;
    }

    .interconnect-strip article,
    .output-card {
      display: grid;
      gap: 8px;
      padding: 14px;
      border: 1px solid rgba(15, 118, 110, .13);
      border-radius: 18px;
      background: #f8fffc;
    }

    .workflow-map-grid {
      display: grid;
      grid-template-columns: repeat(5, minmax(0, 1fr));
      gap: 12px;
    }

    .workflow-map-card {
      display: grid;
      gap: 10px;
      min-height: 180px;
      padding: 16px;
      border: 1px solid rgba(15, 118, 110, .13);
      border-radius: 22px;
      background: #fff;
      cursor: pointer;
      transition: transform .16s ease, border-color .16s ease, box-shadow .16s ease;
    }

    .workflow-map-card.active {
      border-color: rgba(15, 118, 110, .52);
      background: linear-gradient(135deg, rgba(15, 118, 110, .12), #fff);
    }

    .workflow-card-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      color: var(--amber);
      font-size: .75rem;
      font-weight: 950;
      text-transform: uppercase;
      letter-spacing: .06em;
    }

    .workflow-card-head em {
      color: var(--teal);
      font-style: normal;
    }

    .output-grid {
      display: grid;
      grid-template-columns: minmax(0, 1fr) minmax(280px, .45fr);
      gap: 14px;
    }

    .strong-copy {
      color: var(--muted);
      font-weight: 800;
      line-height: 1.6;
    }

    @media (max-width: 1180px) {
      .future-command-grid,
      .output-grid {
        grid-template-columns: 1fr;
      }

      .workflow-map-grid {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }
    }

    @media (max-width: 760px) {
      .future-hero {
        grid-template-columns: 1fr;
      }

      .future-hero-actions {
        justify-content: start;
      }

      .interconnect-strip,
      .workflow-map-grid {
        grid-template-columns: 1fr;
      }
    }
  `]
})
export class FutureFeaturesComponent implements OnInit {
  readonly summary = signal<ApiRecord | null>(null);
  readonly output = signal<ApiRecord | null>(null);
  readonly loading = signal(false);
  readonly error = signal('');
  readonly selectedType = signal('growth-advisor');

  readonly workflows: WorkflowOption[] = [
    { type: 'growth-advisor', label: 'AI salon growth advisor', category: 'Growth', prompt: 'Create next best actions for salon growth this week using live CRM, POS, inventory and booking data.', summary: 'Growth plan' },
    { type: 'pricing-optimizer', label: 'AI pricing optimizer', category: 'Revenue', prompt: 'Find safe service pricing upside from live sales and appointment demand.', summary: 'Price review' },
    { type: 'offer-engine', label: 'AI offer engine', category: 'Marketing', prompt: 'Generate segmented offers using clients, services, campaigns and WhatsApp context.', summary: 'Offer draft' },
    { type: 'emotion-analysis', label: 'AI customer emotion analysis', category: 'Experience', prompt: 'Analyze client emotion and suggest service recovery action.', summary: 'Recovery action' },
    { type: 'no-show-prediction', label: 'AI no-show prediction', category: 'Calendar', prompt: 'Predict no-show risk and show reminder actions for active bookings.', summary: 'Reminder queue' },
    { type: 'demand-forecasting', label: 'AI demand forecasting', category: 'Operations', prompt: 'Forecast demand for the next 7 days and connect staffing plus inventory actions.', summary: 'Demand plan' },
    { type: 'inventory-prediction', label: 'AI inventory prediction', category: 'Inventory', prompt: 'Predict reorder needs and stockout risk from live inventory, services and demand.', summary: 'Reorder plan' },
    { type: 'voice-booking-assistant', label: 'Voice booking assistant', category: 'Front desk', prompt: 'Book hair color tomorrow evening and suggest available slots.', summary: 'Slot options' },
    { type: 'voice-receptionist', label: 'AI voice receptionist', category: 'Front desk', prompt: 'Classify a live call, suggest the next booking or handoff action, and keep evidence connected.', summary: 'Call router' },
    { type: 'dynamic-pricing', label: 'Dynamic pricing engine', category: 'Revenue', prompt: 'Create review-before-action dynamic pricing rules from live demand and sales signals.', summary: 'Rule drafts' },
    { type: 'smart-kiosk-mode', label: 'Smart kiosk mode', category: 'Front desk', prompt: 'Start a self check-in kiosk session and estimate queue wait.', summary: 'Kiosk session' },
    { type: 'ai-receptionist', label: 'AI receptionist', category: 'Front desk', prompt: 'Classify booking, payment, membership or complaint intent and route it safely.', summary: 'Intent router' },
    { type: 'franchise-os', label: 'Franchise OS', category: 'Enterprise', prompt: 'Create franchise royalty, compliance and branch action summary from live branch data.', summary: 'Operator summary' },
    { type: 'smart-forms', label: 'Smart forms builder', category: 'Experience', prompt: 'Generate service-specific consultation and consent forms with signature rules.', summary: 'Form drafts' },
    { type: 'marketplace', label: 'App marketplace', category: 'Platform', prompt: 'Recommend provider connectors and plugin install actions for this tenant.', summary: 'Install plan' }
  ];

  readonly runForm = this.fb.group({
    type: ['growth-advisor'],
    prompt: [this.workflows[0].prompt]
  });

  constructor(private readonly api: ApiService, private readonly fb: UntypedFormBuilder) {}

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.error.set('');
    this.api.list<ApiRecord>('future-features/summary').subscribe({
      next: (summary) => {
        this.summary.set(summary);
        this.loading.set(false);
      },
      error: (error) => {
        this.error.set(this.api.errorText(error, 'Unable to load future feature command center'));
        this.loading.set(false);
      }
    });
  }

  run(): void {
    const type = this.runForm.value.type || this.selectedType();
    this.loading.set(true);
    this.error.set('');
    this.api.post<ApiRecord>(`future-features/${type}/run`, {
      prompt: this.runForm.value.prompt,
      transcript: this.runForm.value.prompt,
      sourceModules: this.selectedModules(),
      ui: 'AI Innovation Command Center'
    }).subscribe({
      next: (response) => {
        this.output.set(response.output);
        this.loading.set(false);
        this.load();
      },
      error: (error) => {
        this.error.set(this.api.errorText(error, 'Unable to run connected intelligence'));
        this.loading.set(false);
      }
    });
  }

  selectType(type: string): void {
    this.selectedType.set(type);
    const option = this.workflows.find((workflow) => workflow.type === type);
    this.runForm.patchValue({
      type,
      prompt: option?.prompt || this.runForm.value.prompt || ''
    });
  }

  metric(key: string): number {
    return Number(this.summary()?.metrics?.[key] || 0);
  }

  sourceHealth(): ApiRecord {
    return this.summary()?.sourceHealth || {};
  }

  sourceRows(): ApiRecord[] {
    return this.rows(this.summary()?.liveDataSources);
  }

  workflowRows(): ApiRecord[] {
    return this.rows(this.summary()?.workflowMap);
  }

  actionRows(): ApiRecord[] {
    return this.rows(this.summary()?.actionRail);
  }

  selectedWorkflow(): ApiRecord | null {
    return this.workflowRows().find((workflow) => workflow.type === this.selectedType()) || null;
  }

  selectedOption(): WorkflowOption | undefined {
    return this.workflows.find((workflow) => workflow.type === this.selectedType());
  }

  selectedModules(): string[] {
    return this.rows(this.selectedWorkflow()?.modules).map((item) => String(item));
  }

  selectedSignals(): string[] {
    return this.rows(this.selectedWorkflow()?.sourceSignals).map((item) => String(item));
  }

  rows(value: unknown): any[] {
    return Array.isArray(value) ? value : [];
  }
}
