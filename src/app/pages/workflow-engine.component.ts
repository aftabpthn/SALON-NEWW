import { CommonModule } from '@angular/common';
import { Component, OnInit, signal } from '@angular/core';
import { FormsModule, ReactiveFormsModule, UntypedFormBuilder, Validators } from '@angular/forms';
import { ApiRecord, ApiService } from '../core/api.service';
import { StateComponent } from '../shared/ui/state/state.component';
import { AuraKpiCardComponent } from '../shared/ui/aura-kpi-card/aura-kpi-card.component';
import { AuraDatePipe } from '../shared/pipes/aura-date.pipe';

@Component({
  selector: 'app-workflow-engine',
  standalone: true,
  imports: [AuraDatePipe, CommonModule, FormsModule, ReactiveFormsModule, StateComponent, AuraKpiCardComponent],
  template: `
    <section class="page-stack">
      <div class="module-hero">
        <div>
          <h2>Trigger, condition, action, delay and WhatsApp/SMS/Email execution</h2>
        </div>
        <div class="hero-actions">
          <button class="ghost-button" type="button" (click)="runDue()" [disabled]="!definitions().length">Run due workflows</button>
          <button class="ghost-button" type="button" (click)="load()">Refresh</button>
        </div>
      </div>

      <app-state [loading]="loading()" [error]="error()"></app-state>

      <div class="metrics-grid" *ngIf="summary()?.metrics as metrics">
        <aura-kpi-card tone="neutral" target="/kpi-details/workflow/workflows"><span>Workflows</span><strong>{{ metrics.workflows }}</strong></aura-kpi-card>
        <aura-kpi-card tone="neutral" target="/kpi-details/workflow/active"><span>Active</span><strong>{{ metrics.active }}</strong></aura-kpi-card>
        <aura-kpi-card tone="neutral" target="/kpi-details/workflow/runs"><span>Runs</span><strong>{{ metrics.runs }}</strong></aura-kpi-card>
        <aura-kpi-card tone="neutral" target="/kpi-details/workflow/messages"><span>Messages</span><strong>{{ metrics.messagesSent }}</strong></aura-kpi-card>
      </div>

      <div class="dashboard-grid">
        <section class="form-panel">
          <h3>Create inactive-client workflow</h3>
          <form [formGroup]="workflowForm" (ngSubmit)="createWorkflow()">
            <label class="field"><span>Name</span><input formControlName="name" /></label>
            <label class="field"><span>Inactive days</span><input type="number" formControlName="inactiveDays" /></label>
            <label class="field"><span>Channel</span><select formControlName="channel"><option>WhatsApp</option><option>SMS</option><option>Email</option></select></label>
            <label class="field"><span>Delay minutes</span><input type="number" formControlName="delayMinutes" /></label>
            <label class="field full"><span>Message template</span><textarea formControlName="template"></textarea></label>
            <div class="form-actions"><button class="primary-button" type="submit" [disabled]="workflowForm.invalid">Create workflow</button></div>
          </form>
        </section>

        <section class="panel">
          <div class="section-title"><h2>Workflow logic</h2></div>
          <div class="summary-lines">
            <div><span>Trigger</span><strong>{{ summary()?.example?.trigger }}</strong></div>
            <div><span>Condition</span><strong>{{ summary()?.example?.condition }}</strong></div>
            <div><span>Action</span><strong>{{ summary()?.example?.action }}</strong></div>
          </div>
          <pre class="result-json" *ngIf="result()">{{ result() | json }}</pre>
        </section>
      </div>

      <section class="panel">
        <div class="section-title"><h2>Workflow definitions</h2></div>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Name</th><th>Trigger</th><th>Condition</th><th>Delay</th><th>Status</th><th></th></tr></thead>
            <tbody>
              <tr *ngFor="let workflow of definitions()">
                <td><strong>{{ workflow.name }}</strong><small>{{ workflow.description }}</small></td>
                <td>{{ workflow.trigger?.type }}</td>
                <td>{{ workflow.conditions?.inactiveDays || 0 }} inactive days</td>
                <td>{{ workflow.delayMinutes }}m</td>
                <td><span class="badge">{{ workflow.status }}</span></td>
                <td><button class="ghost-button mini" type="button" (click)="run(workflow)" [disabled]="workflow.status !== 'active'">Run</button></td>
              </tr>
              <tr *ngIf="!definitions().length"><td colspan="6"><div class="empty-state"><strong>No workflows yet</strong><span>Create the inactive-client workflow to start automation.</span></div></td></tr>
            </tbody>
          </table>
        </div>
      </section>

      <section class="panel">
        <div class="section-title"><h2>Run history</h2></div>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Workflow</th><th>Audience</th><th>Sent</th><th>Status</th><th>Created</th></tr></thead>
            <tbody>
              <tr *ngFor="let run of runs()">
                <td>{{ workflowName(run.workflowId) }}</td>
                <td>{{ run.audience?.length || 0 }}</td>
                <td>{{ run.actionResult?.sent || 0 }}</td>
                <td><span class="badge">{{ run.status }}</span></td>
                <td>{{ run.createdAt | auraDate:'date' }}</td>
              </tr>
              <tr *ngIf="!runs().length"><td colspan="5"><div class="empty-state"><strong>No runs yet</strong><span>Run a workflow to create notification records.</span></div></td></tr>
            </tbody>
          </table>
        </div>
      </section>
    </section>
  `
})
export class WorkflowEngineComponent implements OnInit {
  readonly summary = signal<ApiRecord | null>(null);
  readonly result = signal<ApiRecord | null>(null);
  readonly loading = signal(false);
  readonly error = signal('');

  readonly workflowForm = this.fb.group({
    name: ['Inactive 30-day WhatsApp offer', Validators.required],
    inactiveDays: [30, Validators.required],
    channel: ['WhatsApp', Validators.required],
    delayMinutes: [0],
    template: ['Hi {{name}}, we miss you. Book this week and get a personalized salon offer.', Validators.required]
  });

  constructor(private readonly api: ApiService, private readonly fb: UntypedFormBuilder) {}

  ngOnInit(): void {
    this.load();
  }

  definitions(): ApiRecord[] {
    return this.summary()?.definitions || [];
  }

  runs(): ApiRecord[] {
    return this.summary()?.runs || [];
  }

  load(): void {
    this.loading.set(true);
    this.api.list<ApiRecord>('workflows/summary').subscribe({
      next: (summary) => {
        this.summary.set(summary);
        this.loading.set(false);
      },
      error: (error) => {
        this.error.set(error?.error?.error || 'Unable to load workflow engine');
        this.loading.set(false);
      }
    });
  }

  createWorkflow(): void {
    const value = this.workflowForm.value;
    this.api.post<ApiRecord>('workflows', {
      name: value.name,
      trigger: { type: 'client-inactive', schedule: 'manual' },
      conditions: { inactiveDays: Number(value.inactiveDays || 30) },
      actions: [{ channel: value.channel, template: value.template }],
      delayMinutes: Number(value.delayMinutes || 0),
      status: 'active'
    }).subscribe((response) => {
      this.result.set(response);
      this.load();
    });
  }

  run(workflow: ApiRecord): void {
    this.api.post<ApiRecord>(`workflows/${workflow.id}/run`, { triggerSource: { type: 'manual-ui' } }).subscribe((response) => {
      this.result.set(response);
      this.load();
    });
  }

  runDue(): void {
    this.api.post<ApiRecord>('workflows/run-due', {}).subscribe((response) => {
      this.result.set(response);
      this.load();
    });
  }

  workflowName(id: string): string {
    return this.definitions().find((workflow) => workflow.id === id)?.name || id;
  }
}
