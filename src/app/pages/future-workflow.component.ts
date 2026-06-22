import { CommonModule } from '@angular/common';
import { Component, OnInit, signal } from '@angular/core';
import { ReactiveFormsModule, UntypedFormBuilder } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { forkJoin, of } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { ApiRecord, ApiService } from '../core/api.service';
import { AuraKpiCardComponent } from '../shared/ui/aura-kpi-card/aura-kpi-card.component';
import { StateComponent } from '../shared/ui/state/state.component';

type WorkflowConfig = {
  workflowType: string;
  title: string;
  subtitle: string;
  prompt: string;
  primaryEndpoint: string;
  secondaryEndpoint?: string;
  commandCenterRoute?: string;
  recordLabel: string;
};

@Component({
  selector: 'app-future-workflow',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, RouterLink, AuraKpiCardComponent, StateComponent],
  template: `
    <section class="workflow-shell">
      <header class="workflow-hero">
        <div>
          <p class="eyebrow">Future workflow</p>
          <h1>{{ config.title }}</h1>
          <p>{{ config.subtitle }}</p>
        </div>
        <nav class="hero-actions">
          <a routerLink="/future-features">Innovation center</a>
          <a *ngIf="config.commandCenterRoute" [routerLink]="config.commandCenterRoute">Command center</a>
        </nav>
      </header>

      <div class="metric-grid">
        <aura-kpi-card tone="teal" target="/future-features">
          <span>Workflow status</span>
          <strong>{{ workflowStatus() }}</strong>
          <small>{{ workflowMap()?.readySources || 0 }}/{{ workflowMap()?.sourceCount || 0 }} sources ready</small>
        </aura-kpi-card>
        <aura-kpi-card tone="blue" [target]="config.commandCenterRoute || '/future-features'">
          <span>{{ config.recordLabel }}</span>
          <strong>{{ primaryRows().length }}</strong>
          <small>Loaded from {{ config.primaryEndpoint }}</small>
        </aura-kpi-card>
        <aura-kpi-card tone="amber" target="/future-features">
          <span>Last run</span>
          <strong>{{ workflowMap()?.runCount || 0 }}</strong>
          <small>{{ workflowMap()?.lastRunAt || 'No run yet' }}</small>
        </aura-kpi-card>
      </div>

      <app-state [loading]="loading()" loadingText="Loading live workflow..." [error]="error()" [empty]="emptyText()"></app-state>

      <div class="workflow-grid">
        <form class="runner-panel" [formGroup]="runForm" (ngSubmit)="run()">
          <div class="panel-head">
            <p class="eyebrow">Connected launcher</p>
            <h2>Run {{ config.title }}</h2>
          </div>
          <textarea formControlName="prompt" rows="6"></textarea>
          <button type="submit" [disabled]="loading()">{{ loading() ? 'Running...' : 'Run live workflow' }}</button>
        </form>

        <section class="trace-panel">
          <div class="panel-head">
            <p class="eyebrow">Live source trace</p>
            <h2>Data used</h2>
          </div>
          <div class="source-list">
            <a class="source-row" *ngFor="let source of sourceRows()" [routerLink]="source.route || '/future-features'">
              <span>{{ source.name }}</span>
              <strong>{{ source.count || 0 }}</strong>
              <small>{{ source.signal || source.status }}</small>
            </a>
          </div>
        </section>
      </div>

      <section class="records-band">
        <div class="panel-head">
          <p class="eyebrow">Connected records</p>
          <h2>{{ config.recordLabel }}</h2>
        </div>
        <div class="record-grid" *ngIf="primaryRows().length; else noRecords">
          <article class="record-card" *ngFor="let item of primaryRows().slice(0, 6)">
            <strong>{{ item.name || item.title || item.phone || item.provider || item.id || 'Record' }}</strong>
            <span>{{ item.status || item.category || item.intent || item.scope || item.formType || 'active' }}</span>
            <small>{{ item.updatedAt || item.createdAt || item.branchId || item.id }}</small>
          </article>
        </div>
        <ng-template #noRecords>
          <p class="muted">No records returned from {{ config.primaryEndpoint }} yet.</p>
        </ng-template>
        <div class="secondary-strip" *ngIf="secondaryRows().length">
          <strong>Secondary live source</strong>
          <span>{{ secondaryRows().length }} records from {{ config.secondaryEndpoint }}</span>
        </div>
      </section>

      <section class="output-band" *ngIf="output() as result">
        <div class="panel-head">
          <p class="eyebrow">Generated output</p>
          <h2>{{ result.title || config.title }}</h2>
        </div>
        <p>{{ result.summary || result.reply || result.script || 'Workflow generated from live connected data.' }}</p>
        <div class="approval-grid" *ngIf="approvalFlow() as approval">
          <article>
            <span>Approval</span>
            <strong>{{ approval.status || 'ready_for_review' }}</strong>
            <small>{{ approval.requiredRole || 'manager' }} · {{ approval.checkpoint || 'Review before action' }}</small>
          </article>
          <article>
            <span>Evidence</span>
            <strong>{{ rows(approval.evidence).length }}</strong>
            <small>{{ rows(approval.blockers).length ? 'Blockers present' : 'No blockers' }}</small>
          </article>
        </div>
        <div class="plan-list" *ngIf="actionPlanRows().length">
          <article *ngFor="let item of actionPlanRows()">
            <span>{{ item.step || '-' }}</span>
            <strong>{{ item.action }}</strong>
            <small>{{ item.owner || 'manager' }} · {{ item.target || 'workflow' }} · {{ item.status || 'pending_review' }}</small>
          </article>
        </div>
        <div class="action-row">
          <span *ngFor="let action of rows(result.actions)">{{ action }}</span>
        </div>
        <div class="draft-action" *ngIf="firstDraft() as draft">
          <div>
            <strong>{{ draft.label || 'Generated draft' }}</strong>
            <small>Save to {{ draft.endpoint || config.primaryEndpoint }}</small>
          </div>
          <button type="button" (click)="saveDraft(draft)" [disabled]="actionBusy() || draft.ready === false">
            {{ actionBusy() ? 'Saving...' : 'Save draft' }}
          </button>
        </div>
        <p class="success-line" *ngIf="actionMessage()">{{ actionMessage() }}</p>
        <pre>{{ result | json }}</pre>
      </section>
    </section>
  `,
  styles: [`
    .workflow-shell {
      display: grid;
      gap: 18px;
      padding: 18px;
      color: #172033;
    }

    .workflow-hero,
    .workflow-grid,
    .records-band,
    .output-band {
      border: 1px solid #d8e2ef;
      border-radius: 8px;
      background: #ffffff;
      box-shadow: 0 10px 28px rgba(15, 23, 42, 0.06);
    }

    .workflow-hero {
      display: flex;
      justify-content: space-between;
      gap: 18px;
      padding: 22px;
    }

    h1,
    h2,
    p {
      margin: 0;
    }

    h1 {
      font-size: 30px;
      line-height: 1.12;
    }

    h2 {
      font-size: 18px;
      line-height: 1.2;
    }

    .eyebrow {
      margin-bottom: 6px;
      color: #64748b;
      font-size: 11px;
      font-weight: 800;
      text-transform: uppercase;
    }

    .hero-actions,
    .action-row {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
      align-items: center;
    }

    .hero-actions a,
    button,
    .action-row span {
      border: 1px solid #cbd5e1;
      border-radius: 8px;
      padding: 10px 14px;
      background: #f8fafc;
      color: #172033;
      font-weight: 800;
      text-decoration: none;
    }

    button {
      width: fit-content;
      border-color: #0f766e;
      background: #0f766e;
      color: #ffffff;
      cursor: pointer;
    }

    button:disabled {
      opacity: 0.68;
      cursor: progress;
    }

    .metric-grid {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 14px;
    }

    .workflow-grid {
      display: grid;
      grid-template-columns: minmax(0, 1.1fr) minmax(0, 0.9fr);
      gap: 18px;
      padding: 18px;
    }

    .runner-panel,
    .trace-panel {
      display: grid;
      gap: 14px;
      min-width: 0;
    }

    textarea {
      min-height: 144px;
      resize: vertical;
      border: 1px solid #cbd5e1;
      border-radius: 8px;
      padding: 12px;
      font: inherit;
    }

    .source-list,
    .record-grid,
    .plan-list {
      display: grid;
      gap: 10px;
    }

    .source-row,
    .record-card,
    .plan-list article,
    .approval-grid article,
    .draft-action,
    .secondary-strip {
      display: grid;
      gap: 4px;
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      padding: 12px;
      color: inherit;
      text-decoration: none;
    }

    .source-row {
      grid-template-columns: minmax(0, 1fr) auto;
      align-items: center;
    }

    .source-row small,
    .record-card small,
    .record-card span,
    .plan-list small,
    .approval-grid small,
    .draft-action small,
    .secondary-strip span,
    .muted {
      color: #64748b;
    }

    .records-band,
    .output-band {
      display: grid;
      gap: 14px;
      padding: 18px;
    }

    .record-grid {
      grid-template-columns: repeat(3, minmax(0, 1fr));
    }

    .approval-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 10px;
    }

    .plan-list article {
      grid-template-columns: 36px minmax(0, 1fr);
      align-items: center;
    }

    .plan-list small {
      grid-column: 2;
    }

    .draft-action {
      grid-template-columns: minmax(0, 1fr) auto;
      align-items: center;
      background: #f8fafc;
    }

    .success-line {
      color: #0f766e;
      font-weight: 800;
    }

    pre {
      max-height: 320px;
      overflow: auto;
      border-radius: 8px;
      background: #0f172a;
      color: #e2e8f0;
      padding: 14px;
      white-space: pre-wrap;
    }

    @media (max-width: 860px) {
      .workflow-hero,
      .workflow-grid {
        grid-template-columns: 1fr;
        display: grid;
      }

      .metric-grid,
      .record-grid,
      .approval-grid,
      .draft-action {
        grid-template-columns: 1fr;
      }
    }
  `]
})
export class FutureWorkflowComponent implements OnInit {
  readonly loading = signal(false);
  readonly error = signal('');
  readonly summary = signal<ApiRecord | null>(null);
  readonly output = signal<ApiRecord | null>(null);
  readonly primary = signal<ApiRecord[]>([]);
  readonly secondary = signal<ApiRecord[]>([]);
  readonly actionBusy = signal(false);
  readonly actionMessage = signal('');

  config: WorkflowConfig = {
    workflowType: 'growth-advisor',
    title: 'Future Workflow',
    subtitle: 'Connected workflow powered by live salon data.',
    prompt: 'Create a live operational recommendation from connected salon data.',
    primaryEndpoint: 'future-features/summary',
    recordLabel: 'Records'
  };

  readonly runForm = this.fb.group({ prompt: [''] });

  constructor(
    private readonly api: ApiService,
    private readonly fb: UntypedFormBuilder,
    private readonly route: ActivatedRoute
  ) {}

  ngOnInit(): void {
    this.route.data.subscribe((data) => {
      this.config = { ...this.config, ...(data as Partial<WorkflowConfig>) };
      this.runForm.patchValue({ prompt: this.config.prompt });
      this.load();
    });
  }

  load(): void {
    this.loading.set(true);
    this.error.set('');
    forkJoin({
      summary: this.api.list<ApiRecord>('future-features/summary'),
      primary: this.api.list<ApiRecord[] | ApiRecord>(this.config.primaryEndpoint).pipe(catchError(() => of([]))),
      secondary: this.config.secondaryEndpoint
        ? this.api.list<ApiRecord[] | ApiRecord>(this.config.secondaryEndpoint).pipe(catchError(() => of([])))
        : of([])
    }).subscribe({
      next: ({ summary, primary, secondary }) => {
        this.summary.set(summary);
        this.primary.set(this.recordRows(primary));
        this.secondary.set(this.recordRows(secondary));
        this.loading.set(false);
      },
      error: (error) => {
        this.error.set(this.api.errorText(error, 'Unable to load future workflow'));
        this.loading.set(false);
      }
    });
  }

  run(): void {
    this.loading.set(true);
    this.error.set('');
    this.actionMessage.set('');
    this.api.post<ApiRecord>(`future-features/${this.config.workflowType}/run`, {
      prompt: this.runForm.value.prompt,
      transcript: this.runForm.value.prompt,
      ui: this.config.title,
      primaryEndpoint: this.config.primaryEndpoint
    }).subscribe({
      next: (response) => {
        this.output.set(response.output || response);
        this.loading.set(false);
        this.load();
      },
      error: (error) => {
        this.error.set(this.api.errorText(error, 'Unable to run future workflow'));
        this.loading.set(false);
      }
    });
  }

  workflowMap(): ApiRecord | null {
    return this.recordRows(this.summary()?.workflowMap).find((item) => item.type === this.config.workflowType) || null;
  }

  workflowStatus(): string {
    return this.workflowMap()?.status || 'connected';
  }

  sourceRows(): ApiRecord[] {
    return this.rows(this.output()?.sourceTrace || this.workflowMap()?.sourceSignals).map((item) => {
      if (typeof item === 'string') return { name: item.split(':')[0], signal: item, count: 0 };
      return item;
    });
  }

  primaryRows(): ApiRecord[] {
    return this.primary();
  }

  secondaryRows(): ApiRecord[] {
    return this.secondary();
  }

  approvalFlow(): ApiRecord | null {
    return this.output()?.['approvalFlow'] || null;
  }

  actionPlanRows(): ApiRecord[] {
    return this.recordRows(this.output()?.['actionPlan']);
  }

  draftPayloads(): ApiRecord[] {
    return this.recordRows(this.output()?.['draftPayloads']);
  }

  firstDraft(): ApiRecord | null {
    return this.draftPayloads().find((draft) => draft.ready !== false) || null;
  }

  saveDraft(draft: ApiRecord): void {
    const endpoint = String(draft.endpoint || this.config.primaryEndpoint || '');
    const payload = draft.payload as ApiRecord | undefined;
    if (!endpoint || !payload || draft.ready === false) return;
    this.actionBusy.set(true);
    this.actionMessage.set('');
    this.error.set('');
    this.api.post<ApiRecord>(endpoint, payload).subscribe({
      next: () => {
        this.actionBusy.set(false);
        this.actionMessage.set(`Draft saved to ${endpoint}`);
        this.load();
      },
      error: (error) => {
        this.actionBusy.set(false);
        this.error.set(this.api.errorText(error, `Unable to save draft to ${endpoint}`));
      }
    });
  }

  emptyText(): string {
    return !this.loading() && !this.error() && !this.summary() ? 'No workflow data loaded yet.' : '';
  }

  recordRows(value: unknown): ApiRecord[] {
    return this.rows(value).filter((item): item is ApiRecord => !!item && typeof item === 'object' && !Array.isArray(item));
  }

  rows(value: unknown): Array<ApiRecord | string> {
    if (Array.isArray(value)) return value as Array<ApiRecord | string>;
    if (value && typeof value === 'object') {
      const record = value as ApiRecord;
      if (Array.isArray(record.items)) return record.items;
      if (Array.isArray(record.data)) return record.data;
      if (Array.isArray(record.results)) return record.results;
    }
    return [];
  }
}
