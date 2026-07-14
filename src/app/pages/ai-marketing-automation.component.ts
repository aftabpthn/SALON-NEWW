import { CommonModule } from '@angular/common';
import { Component, OnInit, signal } from '@angular/core';
import { ReactiveFormsModule, UntypedFormBuilder, Validators } from '@angular/forms';
import { ApiRecord, ApiService } from '../core/api.service';
import { StateComponent } from '../shared/ui/state/state.component';
import { AuraMoneyPipe } from '../shared/pipes/aura-money.pipe';

type MarketingViewKey = 'overview' | 'workdesk' | 'offers' | 'output' | 'register';

@Component({
  selector: 'app-ai-marketing-automation',
  standalone: true,
  imports: [AuraMoneyPipe, CommonModule, ReactiveFormsModule, StateComponent],
  template: `
    <section class="marketing-workspace">
      <app-state [loading]="loading()" [error]="error()"></app-state>
      <p class="state success" *ngIf="success()">{{ success() }}</p>

      <ng-container *ngIf="summary() as summary">
        <div class="page-heading">
          <div>
            <h1>Marketing automation</h1>
          </div>
          <label class="search-field">
            <span>Search campaigns</span>
            <input placeholder="Search campaigns, workflow, channel" />
          </label>
        </div>

        <div class="metric-strip">
          <article><span>Campaigns</span><strong>{{ summary.metrics.campaigns }}</strong></article>
          <article><span>Workflows</span><strong>{{ summary.metrics.activeWorkflows }}</strong></article>
          <article><span>WhatsApp sequences</span><strong>{{ summary.metrics.whatsappSequences }}</strong></article>
          <article><span>Email templates</span><strong>{{ summary.metrics.emailTemplates }}</strong></article>
          <article><span>AI generations</span><strong>{{ summary.metrics.generatedIdeas }}</strong></article>
          <article><span>Audience</span><strong>{{ summary.metrics.estimatedAudience }}</strong></article>
        </div>

        <div class="marketing-section-workspace">
          <aside class="marketing-side-nav" aria-label="Marketing sections">
            <button
              class="marketing-nav-card"
              type="button"
              *ngFor="let view of marketingViews"
              [class.active]="activeMarketingView() === view.key"
              (click)="setMarketingView(view.key)"
            >
              <span class="marketing-nav-icon">{{ view.icon }}</span>
              <span><strong>{{ view.label }}</strong><small>{{ view.description }}</small></span>
              <em>{{ view.badge }}</em>
            </button>
          </aside>

          <main class="marketing-detail">
        <section class="workdesk" *ngIf="visibleMarketingView('workdesk')">
          <div class="desk-heading">
            <div>
              <span>Marketing operations</span>
              <h2>Single compact work desk</h2>
            </div>
          </div>
          <div class="desk-tabs">
            <button type="button" [class.active]="activeTab() === 'segment'" (click)="setActiveTab('segment')">Segment</button>
            <button type="button" [class.active]="activeTab() === 'campaign'" (click)="setActiveTab('campaign')">Campaign</button>
            <button type="button" [class.active]="activeTab() === 'workflow'" (click)="setActiveTab('workflow')">Workflow</button>
            <button type="button" [class.active]="activeTab() === 'whatsapp'" (click)="setActiveTab('whatsapp')">WhatsApp</button>
            <button type="button" [class.active]="activeTab() === 'email'" (click)="setActiveTab('email')">Email</button>
          </div>

          <div class="workdesk-grid">
            <form *ngIf="activeTab() === 'segment'" [formGroup]="segmentForm" (ngSubmit)="segment()" class="zenoti-form">
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
              <button class="primary-button" type="submit" [disabled]="submitting()">Preview segment</button>
              <div class="segment-result" *ngIf="segmentResult() as result">
                <strong>{{ result.name }} · {{ result.count }} clients</strong>
                <span *ngFor="let client of result.clients">{{ client.name }}</span>
              </div>
            </form>

            <form *ngIf="activeTab() === 'campaign'" [formGroup]="campaignForm" (ngSubmit)="generateCampaign()" class="zenoti-form">
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
              <button class="primary-button" type="submit" [disabled]="submitting()">Generate campaign</button>
            </form>

            <form *ngIf="activeTab() === 'workflow'" [formGroup]="workflowForm" (ngSubmit)="createWorkflow()" class="zenoti-form">
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
              <button class="primary-button" type="submit" [disabled]="submitting()">Create workflow</button>
            </form>

            <form *ngIf="activeTab() === 'whatsapp'" [formGroup]="sequenceForm" (ngSubmit)="createSequence()" class="zenoti-form">
              <h3>WhatsApp sequence</h3>
              <label class="field"><span>Name</span><input formControlName="name" /></label>
              <label class="field"><span>Audience tag</span><input formControlName="tag" /></label>
              <label class="field"><span>Min visits</span><input type="number" formControlName="minVisits" /></label>
              <button class="primary-button" type="submit" [disabled]="submitting()">Create sequence</button>
            </form>

            <form *ngIf="activeTab() === 'email'" [formGroup]="emailForm" (ngSubmit)="createEmailTemplate()" class="zenoti-form wide">
              <h3>Email template generator</h3>
              <label class="field"><span>Name</span><input formControlName="name" /></label>
              <label class="field"><span>Occasion</span><input formControlName="occasion" /></label>
              <label class="field"><span>Subject</span><input formControlName="subject" /></label>
              <label class="field full"><span>Body</span><textarea formControlName="body"></textarea></label>
              <button class="primary-button" type="submit" [disabled]="submitting()">Generate template</button>
            </form>
          </div>
        </section>

        <section class="register-panel" *ngIf="visibleMarketingView('offers')">
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
                  <td>{{ offer.estimatedRevenue | auraMoney:'1.0-0' }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        <section class="register-panel" *ngIf="visibleMarketingView('output') && latestResult() as result">
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

        <section class="register-panel" *ngIf="visibleMarketingView('register')">
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
                <tr *ngIf="!summary.campaigns.length && !summary.workflows.length && !summary.sequences.length">
                  <td colspan="5" class="empty-row">No campaigns, workflows or sequences yet</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
          </main>
        </div>
      </ng-container>
    </section>
  `,
  styles: [`
    .marketing-workspace { display: grid; gap: 8px; padding: 8px; color: #1d2430; background: #f0f2f5; min-height: calc(100vh - 20px); }
    .command-bar { display: flex; justify-content: space-between; align-items: center; gap: 16px; padding: 14px 20px; background: #111827; color: #fff; border-bottom: 1px solid #d8e1ea; }
    .brand-block, .top-actions, .center-line, .header-actions, .desk-heading, .register-heading, .desk-tabs { display: flex; align-items: center; gap: 10px; }
    .brand-mark { width: 34px; height: 34px; display: grid; place-items: center; border-radius: 8px; background: #4B1238; color: #fff; font-weight: 900; }
    .brand-block small, .desk-heading span, .register-heading span, .field span, .search-field span { display: block; color: #5f6f85; font-size: 11px; font-weight: 800; text-transform: uppercase; }
    .brand-block strong { display: block; color: #fff; font-size: 15px; }
    .zenoti-button, .desk-tabs button, .primary-button { border: 1px solid #b9cbe0; background: #fff; color: #4B1238; border-radius: 3px; padding: 8px 13px; font-weight: 800; cursor: pointer; }
    .zenoti-button.primary, .primary-button, .desk-tabs .active { background: #55173D; border-color: #55173D; color: #fff; }
    .primary-button:disabled { opacity: .5; cursor: not-allowed; }
    .zenoti-header { background: #fff; }
    .zenoti-header { display: grid; gap: 10px; padding: 18px 16px 12px; }
    .center-line { justify-content: space-between; }
    .center-line strong { font-size: 15px; }
    .command-select { width: 100%; padding: 9px 12px; border: 1px solid #b9cbe0; border-radius: 3px; color: #111827; font-weight: 800; background: #fff; }
    .page-heading { display: flex; justify-content: space-between; gap: 16px; padding: 16px; align-items: end; background: #fff; border: 1px solid #d8e1ea; }
    .page-heading h1 { margin: 0; font-size: 22px; color: #172033; }
    .page-heading p { margin: 6px 0 0; color: #36506d; font-size: 13px; }
    .search-field { width: min(100%, 310px); }
    .search-field input, .field input, .field select, .field textarea { width: 100%; border: 1px solid #cbd8e5; border-radius: 3px; padding: 9px 11px; font: inherit; background: #fff; color: #172033; }
    .metric-strip { display: grid; grid-template-columns: repeat(6, minmax(150px, 1fr)); gap: 0; overflow-x: auto; background: #fff; border-left: 1px solid #d8e1ea; border-right: 1px solid #d8e1ea; border-bottom: 1px solid #d8e1ea; }
    .metric-strip article { min-width: 150px; padding: 13px 16px; border-right: 1px solid #d8e1ea; border-top: 3px solid #55173D; display: flex; flex-direction: column; }
    .metric-strip article:nth-child(2) { border-top-color: #2b61d1; }
    .metric-strip article:nth-child(3) { border-top-color: #bd7400; }
    .metric-strip article:nth-child(4) { border-top-color: #55173D; }
    .metric-strip article:nth-child(5) { border-top-color: #7046d8; }
    .metric-strip article:nth-child(6) { border-top-color: #bb241a; }
    .metric-strip article:last-child { border-right: none; }
    .metric-strip span, .metric-strip small, td small, .output-grid span { display: block; color: #5f6f85; font-size: 12px; }
    .metric-strip strong { display: block; margin: 6px 0 2px; color: #172033; font-size: 24px; }
    .marketing-section-workspace { display: grid; grid-template-columns: minmax(260px, 320px) minmax(0, 1fr); gap: 14px; align-items: start; }
    .marketing-side-nav { position: sticky; top: 92px; display: grid; gap: 10px; }
    .marketing-nav-card { display: grid; grid-template-columns: 44px minmax(0, 1fr) auto; gap: 11px; align-items: center; width: 100%; min-height: 92px; padding: 13px; border: 1px solid #d8e1ea; border-left: 4px solid #55173D; border-radius: 8px; background: #fff; color: #172033; text-align: left; box-shadow: 0 10px 24px rgba(15,23,42,.06); cursor: pointer; }
    .marketing-nav-card:hover, .marketing-nav-card.active { background: linear-gradient(135deg, #F8EEF4, #FAF8F6); border-color: #E7DDD6; transform: translateY(-1px); }
    .marketing-nav-icon { display: grid; place-items: center; width: 44px; height: 44px; border-radius: 8px; background: #F8EEF4; color: #4B1238; font-weight: 950; font-size: 12px; }
    .marketing-nav-card strong, .marketing-nav-card small { display: block; }
    .marketing-nav-card small { margin-top: 4px; color: #5f6f85; font-size: 12px; font-weight: 700; line-height: 1.3; }
    .marketing-nav-card em { align-self: start; padding: 4px 7px; border-radius: 999px; background: #F8EEF4; color: #4B1238; font-size: 10px; font-style: normal; font-weight: 900; text-transform: uppercase; }
    .marketing-detail { display: grid; gap: 8px; min-width: 0; }
    .workdesk, .register-panel { padding: 16px; background: #fff; border: 1px solid #d8e1ea; }
    .desk-heading, .register-heading { justify-content: space-between; align-items: end; margin-bottom: 12px; }
    .desk-heading h2, .register-heading h2, .zenoti-form h3 { margin: 3px 0 0; color: #172033; font-size: 18px; }
    .desk-tabs { flex-wrap: wrap; padding-bottom: 10px; border-bottom: 1px solid #d8e1ea; }
    .desk-tabs button { border-radius: 16px; color: #5f6f85; padding: 7px 13px; }
    .workdesk-grid { display: grid; grid-template-columns: repeat(4, minmax(220px, 1fr)); gap: 12px; padding-top: 14px; min-height: 370px; align-content: start; }
    .zenoti-form { display: grid; gap: 10px; align-content: start; padding: 12px; border: 1px solid #d8e1ea; background: #FAF8F6; box-shadow: 0 1px 3px rgba(0,0,0,.04); transition: box-shadow .15s, border-color .15s; min-height: 340px; }
    .zenoti-form:focus-within { border-color: #55173D; box-shadow: 0 2px 8px rgba(11,143,124,.1); }
    .zenoti-form.wide { grid-column: span 2; }
    .field.full { grid-column: 1 / -1; }
    .field textarea { min-height: 78px; resize: vertical; }
    .field input:focus, .field select:focus, .field textarea:focus { outline: 2px solid rgba(11,143,124,.3); border-color: #55173D; }
    .check-line { display: flex; align-items: center; gap: 8px; color: #41536b; font-weight: 700; }
    .segment-result { display: grid; gap: 5px; padding: 10px; background: #F8EEF4; border: 1px solid #d8e1ea; color: #41536b; font-size: 13px; }
    .table-wrap { overflow: auto; border: 1px solid #d8e1ea; background: #fff; min-height: 100px; }
    table { width: 100%; min-width: 900px; border-collapse: collapse; }
    th, td { padding: 10px 12px; border-bottom: 1px solid #dfe7ef; text-align: left; vertical-align: middle; }
    th { background: #F8EEF4; color: #5b6b81; font-size: 12px; text-transform: uppercase; }
    td strong { display: block; color: #172033; }
    tr:hover td { background: #F8EEF4; }
    .badge { display: inline-flex; padding: 4px 9px; border-radius: 999px; background: #F8EEF4; color: #4B1238; font-weight: 800; font-size: 12px; }
    .output-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 10px; }
    .output-grid article { min-height: 82px; padding: 12px; border: 1px solid #d8e1ea; background: #FAF8F6; display: flex; flex-direction: column; justify-content: center; }
    app-state { display: block; }
    .state.success { margin: 0 16px; padding: 12px 14px; border-radius: 8px; font-weight: 850; color: #7A4A28; background: #F8EEF4; border: 1px solid #E7DDD6; }
    .empty-row { text-align: center; color: #8a9aa8; padding: 24px 12px !important; font-style: italic; }

    :host .page-stack,
    :host .marketing-page { background: #f8f5f2; }
    :host .module-hero,
    :host .metric-strip,
    :host .metric-strip article,
    :host .panel,
    :host .workdesk-card,
    :host .marketing-side-nav,
    :host .table-wrap,
    :host .output-card {
      border-color: rgba(118, 85, 76, 0.13) !important;
      border-radius: 14px !important;
      background: #fff !important;
      background-image: none !important;
      box-shadow: 0 1px 2px rgba(41, 31, 28, 0.03), 0 10px 26px rgba(73, 51, 43, 0.045) !important;
    }
    :host .metric-strip { gap: 12px; padding: 12px; }
    :host .metric-strip article { border-left: 3px solid rgba(154, 106, 96, 0.68) !important; border-top: 1px solid rgba(118, 85, 76, 0.13) !important; }
    :host h1, :host h2, :host h3, :host .metric-strip strong { color: #302522 !important; font-weight: 630 !important; }
    :host .metric-strip span, :host .metric-strip small, :host th, :host td small { color: #766763 !important; font-weight: 540 !important; }
    :host th { position: sticky; top: 0; z-index: 1; background: #faf7f4 !important; }
    :host tbody tr:hover td { background: #fffaf7 !important; }
    @media (max-width: 1100px) {
      .marketing-section-workspace, .metric-strip { grid-template-columns: repeat(3, 1fr); }
      .marketing-side-nav { position: static; grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .workdesk-grid { grid-template-columns: repeat(2, minmax(220px, 1fr)); }
      .zenoti-form.wide { grid-column: span 1; }
    }
    @media (max-width: 760px) {
      .command-bar, .page-heading, .center-line, .desk-heading, .register-heading { display: grid; align-items: start; }
      .top-actions, .header-actions { flex-wrap: wrap; }
      .search-field { width: 100%; }
      .marketing-section-workspace, .marketing-side-nav, .metric-strip, .workdesk-grid { grid-template-columns: 1fr; }
    }
  `]
})
export class AiMarketingAutomationComponent implements OnInit {
  readonly summary = signal<ApiRecord | null>(null);
  readonly segmentResult = signal<ApiRecord | null>(null);
  readonly latestResult = signal<ApiRecord | null>(null);
  readonly loading = signal(true);
  readonly error = signal('');
  readonly activeTab = signal('segment');
  readonly activeMarketingView = signal<MarketingViewKey>('overview');
  readonly marketingViews: Array<{ key: MarketingViewKey; label: string; description: string; icon: string; badge: string }> = [
    { key: 'overview', label: 'Overview', description: 'All marketing workspaces', icon: 'OV', badge: 'All' },
    { key: 'workdesk', label: 'Workdesk', description: 'Segments, campaigns and workflows', icon: 'WD', badge: 'AI' },
    { key: 'offers', label: 'Offers', description: 'Recommendations and register', icon: 'OF', badge: 'Live' },
    { key: 'output', label: 'Output', description: 'Latest generated campaign result', icon: 'OT', badge: 'Run' },
    { key: 'register', label: 'Register', description: 'Saved marketing automation records', icon: 'RG', badge: 'Log' }
  ];
  readonly success = signal('');
  readonly submitting = signal(false);
  private successTimer: ReturnType<typeof setTimeout> | null = null;

  setActiveTab(tab: string): void {
    this.activeTab.set(tab);
  }

  setMarketingView(view: MarketingViewKey): void {
    this.activeMarketingView.set(view);
  }

  visibleMarketingView(view: MarketingViewKey): boolean {
    return this.activeMarketingView() === 'overview' || this.activeMarketingView() === view;
  }

  private showSuccess(msg: string): void {
    this.success.set(msg);
    if (this.successTimer) window.clearTimeout(this.successTimer);
    this.successTimer = window.setTimeout(() => {
      if (this.success() === msg) this.success.set('');
    }, 3200);
  }

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
    this.submitting.set(true);
    this.api.post<ApiRecord>('ai-marketing/segments', this.segmentForm.value).subscribe({
      next: (result) => {
        this.segmentResult.set(result);
        this.showSuccess('Segment preview ready');
        this.submitting.set(false);
      },
      error: (error) => {
        this.error.set(error?.error?.error || 'Unable to segment clients');
        this.submitting.set(false);
      }
    });
  }

  generateCampaign(): void {
    this.submitting.set(true);
    this.api.post<ApiRecord>('ai-marketing/campaigns/generate', { ...this.campaignForm.value, segment: this.segmentForm.value }).subscribe({
      next: (result) => {
        this.latestResult.set(result);
        this.showSuccess('Campaign generated');
        this.submitting.set(false);
        this.load();
      },
      error: (error) => {
        this.error.set(error?.error?.error || 'Unable to generate campaign');
        this.submitting.set(false);
      }
    });
  }

  createWorkflow(): void {
    this.submitting.set(true);
    this.api.post<ApiRecord>('ai-marketing/retargeting-workflows', this.workflowForm.value).subscribe({
      next: (result) => {
        this.latestResult.set(result);
        this.showSuccess('Workflow created');
        this.submitting.set(false);
        this.load();
      },
      error: (error) => {
        this.error.set(error?.error?.error || 'Unable to create workflow');
        this.submitting.set(false);
      }
    });
  }

  createSequence(): void {
    this.submitting.set(true);
    this.api.post<ApiRecord>('ai-marketing/whatsapp-sequences', {
      name: this.sequenceForm.value.name,
      audienceRule: { tag: this.sequenceForm.value.tag, minVisits: this.sequenceForm.value.minVisits }
    }).subscribe({
      next: (result) => {
        this.latestResult.set(result);
        this.showSuccess('WhatsApp sequence created');
        this.submitting.set(false);
        this.load();
      },
      error: (error) => {
        this.error.set(error?.error?.error || 'Unable to create sequence');
        this.submitting.set(false);
      }
    });
  }

  createEmailTemplate(): void {
    this.submitting.set(true);
    this.api.post<ApiRecord>('ai-marketing/email-templates', this.emailForm.value).subscribe({
      next: (result) => {
        this.latestResult.set({ emailTemplate: result.template, generation: result.generation });
        this.showSuccess('Email template created');
        this.submitting.set(false);
        this.load();
      },
      error: (error) => {
        this.error.set(error?.error?.error || 'Unable to create email template');
        this.submitting.set(false);
      }
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
