import { CommonModule, CurrencyPipe } from '@angular/common';
import { Component, OnInit, signal } from '@angular/core';
import { ReactiveFormsModule, UntypedFormBuilder, Validators } from '@angular/forms';
import { ApiRecord, ApiService } from '../core/api.service';
import { StateComponent } from '../shared/ui/state/state.component';

@Component({
  selector: 'app-ai-marketing-automation',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, CurrencyPipe, StateComponent],
  template: `
    <section class="marketing-workspace">
      <app-state [loading]="loading()" [error]="error()"></app-state>

      <ng-container *ngIf="summary() as summary">
        <div class="page-heading">
          <div>
            <h1>Marketing automation</h1>
            <p>Marketing &gt; Campaign generation, segmentation and reusable templates</p>
          </div>
          <label class="search-field">
            <span>Search campaigns</span>
            <input placeholder="Search campaigns, workflow, channel" />
          </label>
        </div>

        <div class="metric-strip">
          <article><span>Campaigns</span><strong>{{ summary.metrics.campaigns }}</strong><small>Saved campaigns</small></article>
          <article><span>Workflows</span><strong>{{ summary.metrics.activeWorkflows }}</strong><small>Active retargeting</small></article>
          <article><span>WhatsApp sequences</span><strong>{{ summary.metrics.whatsappSequences }}</strong><small>Automation journeys</small></article>
          <article><span>Email templates</span><strong>{{ summary.metrics.emailTemplates }}</strong><small>Reusable templates</small></article>
          <article><span>AI generations</span><strong>{{ summary.metrics.generatedIdeas }}</strong><small>Persisted outputs</small></article>
          <article><span>Audience</span><strong>{{ summary.metrics.estimatedAudience }}</strong><small>Segment reach</small></article>
        </div>

        <section class="workdesk">
          <div class="desk-heading">
            <div>
              <span>Marketing operations</span>
              <h2>Single compact work desk</h2>
            </div>
            <small>Choose one task instead of scrolling through every form.</small>
          </div>
          <div class="desk-tabs">
            <button type="button" class="active">Segment</button>
            <button type="button">Campaign</button>
            <button type="button">Workflow</button>
            <button type="button">WhatsApp</button>
            <button type="button">Email</button>
          </div>

          <div class="workdesk-grid">
            <form [formGroup]="segmentForm" (ngSubmit)="segment()" class="zenoti-form">
              <h3>Client segmentation</h3>
              <label class="field">
                <span>Segment</span>
                <select formControlName="tag">
                  <option value="">All clients</option>
                  <option>VIP</option>
                  <option>inactive</option>
                  <option>new</option>
                  <option>high spender</option>
                </select>
              </label>
              <label class="field"><span>Min spend</span><input type="number" formControlName="minSpend" /></label>
              <label class="field"><span>Min visits</span><input type="number" formControlName="minVisits" /></label>
              <label class="field"><span>Inactive days</span><input type="number" formControlName="inactiveDays" /></label>
              <label class="check-line"><input type="checkbox" formControlName="membershipOnly" /><span>Members only</span></label>
              <button class="primary-button" type="submit">Preview segment</button>
              <div class="segment-result" *ngIf="segmentResult() as result">
                <strong>{{ result.name }} · {{ result.count }} clients</strong>
                <span *ngFor="let client of result.clients">{{ client.name }}</span>
              </div>
            </form>

            <form [formGroup]="campaignForm" (ngSubmit)="generateCampaign()" class="zenoti-form">
              <h3>Auto campaign generation</h3>
              <label class="field"><span>Occasion</span><input formControlName="occasion" /></label>
              <label class="field">
                <span>Channel</span>
                <select formControlName="channel">
                  <option>WhatsApp</option>
                  <option>Email</option>
                  <option>SMS</option>
                  <option>Instagram</option>
                </select>
              </label>
              <label class="field"><span>Name</span><input formControlName="name" /></label>
              <label class="field full"><span>Offer hint</span><textarea formControlName="offerTitle"></textarea></label>
              <button class="primary-button" type="submit">Generate campaign</button>
            </form>

            <form [formGroup]="workflowForm" (ngSubmit)="createWorkflow()" class="zenoti-form">
              <h3>Retargeting workflow</h3>
              <label class="field"><span>Name</span><input formControlName="name" /></label>
              <label class="field"><span>Inactive days</span><input type="number" formControlName="inactiveDays" /></label>
              <label class="field">
                <span>Channel</span>
                <select formControlName="channel">
                  <option>WhatsApp</option>
                  <option>Email</option>
                </select>
              </label>
              <button class="primary-button" type="submit">Create workflow</button>
            </form>

            <form [formGroup]="sequenceForm" (ngSubmit)="createSequence()" class="zenoti-form">
              <h3>WhatsApp sequence</h3>
              <label class="field"><span>Name</span><input formControlName="name" /></label>
              <label class="field"><span>Audience tag</span><input formControlName="tag" /></label>
              <label class="field"><span>Min visits</span><input type="number" formControlName="minVisits" /></label>
              <button class="primary-button" type="submit">Create sequence</button>
            </form>

            <form [formGroup]="emailForm" (ngSubmit)="createEmailTemplate()" class="zenoti-form wide">
              <h3>Email template generator</h3>
              <label class="field"><span>Name</span><input formControlName="name" /></label>
              <label class="field"><span>Occasion</span><input formControlName="occasion" /></label>
              <label class="field"><span>Subject</span><input formControlName="subject" /></label>
              <label class="field full"><span>Body</span><textarea formControlName="body"></textarea></label>
              <button class="primary-button" type="submit">Generate template</button>
            </form>
          </div>
        </section>

        <section class="register-panel">
          <div class="register-heading">
            <div>
              <span>Offer recommendations</span>
              <h2>Offer ideas</h2>
            </div>
            <small>{{ summary.recommendations.length }} live suggestion(s)</small>
          </div>
          <div class="table-wrap">
            <table>
              <thead><tr><th>Offer</th><th>Description</th><th>Potential</th></tr></thead>
              <tbody>
                <tr *ngFor="let offer of summary.recommendations">
                  <td><strong>{{ offer.title }}</strong></td>
                  <td>{{ offer.description }}</td>
                  <td>{{ offer.estimatedRevenue | currency: 'INR':'symbol':'1.0-0' }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        <section class="register-panel" *ngIf="latestResult() as result">
          <div class="register-heading"><h2>Latest marketing output</h2></div>
          <div class="output-grid">
            <article *ngIf="result.campaign">
              <strong>{{ result.campaign.name }}</strong>
              <span>{{ result.campaign.template }}</span>
            </article>
            <article *ngIf="result.output?.caption">
              <strong>Caption</strong>
              <span>{{ result.output.caption }}</span>
            </article>
            <article *ngIf="result.workflow">
              <strong>{{ result.workflow.name }}</strong>
              <span>{{ result.workflow.steps?.length }} workflow steps</span>
            </article>
            <article *ngIf="result.sequence">
              <strong>{{ result.sequence.name }}</strong>
              <span>{{ result.sequence.steps?.length }} WhatsApp steps</span>
            </article>
            <article *ngIf="result.emailTemplate">
              <strong>{{ result.emailTemplate.subject }}</strong>
              <span>{{ result.emailTemplate.body }}</span>
            </article>
          </div>
        </section>

        <section class="register-panel">
          <div class="register-heading">
            <div>
              <span>Marketing register</span>
              <h2>Campaigns, workflows and sequences</h2>
            </div>
            <small>{{ summary.campaigns.length + summary.workflows.length + summary.sequences.length }} record(s)</small>
          </div>
          <div class="table-wrap">
            <table>
              <thead><tr><th>Name</th><th>Type</th><th>Status</th><th>Channel</th><th>Details</th></tr></thead>
              <tbody>
                <tr *ngFor="let campaign of summary.campaigns">
                  <td><strong>{{ campaign.name }}</strong><small>{{ campaign.template }}</small></td>
                  <td>Campaign</td>
                  <td><span class="badge">{{ campaign.status }}</span></td>
                  <td>{{ campaign.channel }}</td>
                  <td>{{ campaign.sentCount }} sent</td>
                </tr>
                <tr *ngFor="let workflow of summary.workflows">
                  <td><strong>{{ workflow.name }}</strong><small>{{ workflow.trigger }}</small></td>
                  <td>Workflow</td>
                  <td><span class="badge">{{ workflow.status }}</span></td>
                  <td>{{ workflow.channel }}</td>
                  <td>{{ workflow.steps?.length }} steps</td>
                </tr>
                <tr *ngFor="let sequence of summary.sequences">
                  <td><strong>{{ sequence.name }}</strong><small>{{ sequence.channel }}</small></td>
                  <td>Sequence</td>
                  <td><span class="badge">{{ sequence.status }}</span></td>
                  <td>{{ sequence.channel }}</td>
                  <td>{{ sequence.steps?.length }} steps</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
      </ng-container>
    </section>
  `,
  styles: [`
    .marketing-workspace { display: grid; gap: 0; color: #1d2430; background: #f7f9fb; min-height: calc(100vh - 20px); }
    .command-bar { display: flex; justify-content: space-between; align-items: center; gap: 16px; padding: 14px 20px; background: #111827; color: #fff; border-bottom: 1px solid #d8e1ea; }
    .brand-block, .top-actions, .center-line, .header-actions, .desk-heading, .register-heading, .desk-tabs { display: flex; align-items: center; gap: 10px; }
    .brand-mark { width: 34px; height: 34px; display: grid; place-items: center; border-radius: 8px; background: #6d5bd0; color: #fff; font-weight: 900; }
    .brand-block small, .desk-heading span, .register-heading span, .field span, .search-field span { display: block; color: #5f6f85; font-size: 11px; font-weight: 800; text-transform: uppercase; }
    .brand-block strong { display: block; color: #fff; font-size: 15px; }
    .zenoti-button, .desk-tabs button, .primary-button { border: 1px solid #b9cbe0; background: #fff; color: #0065a8; border-radius: 3px; padding: 8px 13px; font-weight: 800; cursor: pointer; }
    .zenoti-button.primary, .primary-button, .desk-tabs .active { background: #0b8f7c; border-color: #0b8f7c; color: #fff; }
    .zenoti-header, .page-heading, .metric-strip, .workdesk, .register-panel { background: #fff; border-bottom: 1px solid #d8e1ea; }
    .zenoti-header { display: grid; gap: 10px; padding: 18px 16px 12px; }
    .center-line { justify-content: space-between; }
    .center-line strong { font-size: 15px; }
    .command-select { width: 100%; padding: 9px 12px; border: 1px solid #b9cbe0; border-radius: 3px; color: #111827; font-weight: 800; background: #fff; }
    .page-heading { display: flex; justify-content: space-between; gap: 16px; padding: 16px; align-items: end; }
    .page-heading h1 { margin: 0; font-size: 22px; color: #172033; }
    .page-heading p { margin: 6px 0 0; color: #36506d; font-size: 13px; }
    .search-field { width: min(100%, 310px); }
    .search-field input, .field input, .field select, .field textarea { width: 100%; border: 1px solid #cbd8e5; border-radius: 3px; padding: 9px 11px; font: inherit; background: #fff; color: #172033; }
    .metric-strip { display: grid; grid-template-columns: repeat(6, minmax(150px, 1fr)); gap: 0; overflow-x: auto; }
    .metric-strip article { min-width: 150px; padding: 13px 16px; border-right: 1px solid #d8e1ea; border-top: 3px solid #0b8f7c; }
    .metric-strip article:nth-child(2) { border-top-color: #2b61d1; }
    .metric-strip article:nth-child(3) { border-top-color: #bd7400; }
    .metric-strip article:nth-child(4) { border-top-color: #0b8f7c; }
    .metric-strip article:nth-child(5) { border-top-color: #7046d8; }
    .metric-strip article:nth-child(6) { border-top-color: #bb241a; }
    .metric-strip span, .metric-strip small, td small, .output-grid span { display: block; color: #5f6f85; font-size: 12px; }
    .metric-strip strong { display: block; margin: 6px 0 2px; color: #172033; font-size: 24px; }
    .workdesk, .register-panel { padding: 16px; }
    .desk-heading, .register-heading { justify-content: space-between; align-items: end; margin-bottom: 12px; }
    .desk-heading h2, .register-heading h2, .zenoti-form h3 { margin: 3px 0 0; color: #172033; font-size: 18px; }
    .desk-tabs { flex-wrap: wrap; padding-bottom: 10px; border-bottom: 1px solid #d8e1ea; }
    .desk-tabs button { border-radius: 16px; color: #5f6f85; padding: 7px 13px; }
    .workdesk-grid { display: grid; grid-template-columns: repeat(4, minmax(220px, 1fr)); gap: 12px; padding-top: 14px; }
    .zenoti-form { display: grid; gap: 10px; align-content: start; padding: 12px; border: 1px solid #d8e1ea; background: #fbfcfe; }
    .zenoti-form.wide { grid-column: span 2; }
    .field.full { grid-column: 1 / -1; }
    .field textarea { min-height: 78px; resize: vertical; }
    .check-line { display: flex; align-items: center; gap: 8px; color: #41536b; font-weight: 700; }
    .segment-result { display: grid; gap: 5px; padding: 10px; background: #f4f7fa; border: 1px solid #d8e1ea; color: #41536b; font-size: 13px; }
    .table-wrap { overflow: auto; border: 1px solid #d8e1ea; background: #fff; }
    table { width: 100%; min-width: 900px; border-collapse: collapse; }
    th, td { padding: 10px 12px; border-bottom: 1px solid #dfe7ef; text-align: left; vertical-align: middle; }
    th { background: #f4f7fa; color: #5b6b81; font-size: 12px; text-transform: uppercase; }
    td strong { display: block; color: #172033; }
    tr:hover td { background: #eef7fc; }
    .badge { display: inline-flex; padding: 4px 9px; border-radius: 999px; background: #dff7ee; color: #046452; font-weight: 800; font-size: 12px; }
    .output-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 10px; }
    .output-grid article { min-height: 82px; padding: 12px; border: 1px solid #d8e1ea; background: #fbfcfe; }
    app-state { display: block; }
    @media (max-width: 1100px) {
      .metric-strip, .workdesk-grid { grid-template-columns: repeat(2, minmax(220px, 1fr)); }
      .zenoti-form.wide { grid-column: span 1; }
    }
    @media (max-width: 760px) {
      .command-bar, .page-heading, .center-line, .desk-heading, .register-heading { display: grid; align-items: start; }
      .top-actions, .header-actions { flex-wrap: wrap; }
      .search-field { width: 100%; }
      .metric-strip, .workdesk-grid { grid-template-columns: 1fr; }
    }
  `]
})
export class AiMarketingAutomationComponent implements OnInit {
  readonly summary = signal<ApiRecord | null>(null);
  readonly segmentResult = signal<ApiRecord | null>(null);
  readonly latestResult = signal<ApiRecord | null>(null);
  readonly loading = signal(true);
  readonly error = signal('');

  readonly segmentForm = this.fb.group({
    tag: [''],
    minSpend: [0],
    minVisits: [0],
    inactiveDays: [0],
    membershipOnly: [false]
  });

  readonly campaignForm = this.fb.group({
    occasion: ['summer glow'],
    channel: ['WhatsApp'],
    name: [''],
    offerTitle: ['']
  });

  readonly workflowForm = this.fb.group({
    name: ['Inactive client retargeting'],
    inactiveDays: [45],
    channel: ['WhatsApp']
  });

  readonly sequenceForm = this.fb.group({
    name: ['VIP WhatsApp booking sequence'],
    tag: ['VIP'],
    minVisits: [1]
  });

  readonly emailForm = this.fb.group({
    name: ['Festival email template', Validators.required],
    occasion: ['Diwali'],
    subject: [''],
    body: ['']
  });

  constructor(private readonly api: ApiService, private readonly fb: UntypedFormBuilder) {}

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.error.set('');
    this.api.list<ApiRecord>('ai-marketing/summary').subscribe({
      next: (summary) => {
        this.summary.set(summary);
        this.loading.set(false);
      },
      error: (error) => {
        this.error.set(error?.error?.error || 'Unable to load marketing automation');
        this.loading.set(false);
      }
    });
  }

  segment(): void {
    this.api.post<ApiRecord>('ai-marketing/segments', this.segmentForm.value).subscribe({
      next: (result) => this.segmentResult.set(result),
      error: (error) => this.error.set(error?.error?.error || 'Unable to segment clients')
    });
  }

  generateCampaign(): void {
    this.api.post<ApiRecord>('ai-marketing/campaigns/generate', { ...this.campaignForm.value, segment: this.segmentForm.value }).subscribe({
      next: (result) => {
        this.latestResult.set(result);
        this.load();
      },
      error: (error) => this.error.set(error?.error?.error || 'Unable to generate campaign')
    });
  }

  createWorkflow(): void {
    this.api.post<ApiRecord>('ai-marketing/retargeting-workflows', this.workflowForm.value).subscribe({
      next: (result) => {
        this.latestResult.set(result);
        this.load();
      },
      error: (error) => this.error.set(error?.error?.error || 'Unable to create workflow')
    });
  }

  createSequence(): void {
    this.api.post<ApiRecord>('ai-marketing/whatsapp-sequences', {
      name: this.sequenceForm.value.name,
      audienceRule: { tag: this.sequenceForm.value.tag, minVisits: this.sequenceForm.value.minVisits }
    }).subscribe({
      next: (result) => {
        this.latestResult.set(result);
        this.load();
      },
      error: (error) => this.error.set(error?.error?.error || 'Unable to create sequence')
    });
  }

  createEmailTemplate(): void {
    this.api.post<ApiRecord>('ai-marketing/email-templates', this.emailForm.value).subscribe({
      next: (result) => {
        this.latestResult.set({ emailTemplate: result.template, generation: result.generation });
        this.load();
      },
      error: (error) => this.error.set(error?.error?.error || 'Unable to create email template')
    });
  }

  festivalCampaign(): void {
    this.api.post<ApiRecord>('ai-marketing/festival-campaigns', { festival: this.emailForm.value.occasion || 'Festival Glow', segment: this.segmentForm.value }).subscribe({
      next: (result) => {
        this.latestResult.set(result);
        this.load();
      },
      error: (error) => this.error.set(error?.error?.error || 'Unable to generate festival campaign')
    });
  }
}
