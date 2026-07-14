import { CommonModule } from '@angular/common';
import { Component, OnInit, signal } from '@angular/core';
import { ReactiveFormsModule, UntypedFormBuilder, Validators } from '@angular/forms';
import { ApiRecord, ApiService } from '../core/api.service';
import { StateComponent } from '../shared/ui/state/state.component';
import { AuraDatePipe } from '../shared/pipes/aura-date.pipe';

type WhatsAppViewKey = 'overview' | 'operations' | 'result' | 'inbox' | 'rules';

@Component({
  selector: 'app-whatsapp-automation',
  standalone: true,
  imports: [AuraDatePipe, CommonModule, ReactiveFormsModule, StateComponent],
  template: `
    <section class="whatsapp-workspace">
      <div class="page-heading">
        <div>
          <h1>WhatsApp automation engine</h1>
        </div>
        <label class="search-field">
          <span>Search threads</span>
          <input placeholder="Phone, client, intent, handoff" />
        </label>
      </div>

      <app-state [loading]="loading()" [error]="error()"></app-state>

      <div class="metric-strip" *ngIf="summary() as summary">
        <article><span>Open threads</span><strong>{{ summary.openThreads }}</strong></article>
        <article><span>Human handoffs</span><strong>{{ summary.activeHandoffs }}</strong></article>
        <article><span>Hot leads</span><strong>{{ summary.hotLeads }}</strong></article>
        <article><span>Auto replies</span><strong>{{ summary.autoRepliesToday }}</strong></article>
        <article><span>Broadcasts</span><strong>{{ summary.broadcastsToday }}</strong></article>
        <article><span>Outbound queue</span><strong>{{ summary.pendingOutbound }}</strong></article>
        <article><span>Rules active</span><strong>{{ summary.rulesActive }}</strong></article>
        <article><span>Threads stored</span><strong>{{ threads().length }}</strong></article>
      </div>

            <div class="whatsapp-section-workspace">
        <aside class="whatsapp-side-nav" aria-label="WhatsApp sections">
          <button
            class="whatsapp-nav-card"
            type="button"
            *ngFor="let view of whatsAppViews"
            [class.active]="activeWhatsAppView() === view.key"
            (click)="setWhatsAppView(view.key)"
          >
            <span class="whatsapp-nav-icon">{{ view.icon }}</span>
            <span><strong>{{ view.label }}</strong><small>{{ view.description }}</small></span>
            <em>{{ view.badge }}</em>
          </button>
        </aside>

        <main class="whatsapp-detail">
      <div class="ai-layout" *ngIf="!loading() && visibleWhatsAppView('operations')">
        <section class="form-panel">
          <h3>Inbound auto reply and intent detection</h3>
          <form [formGroup]="inboundForm" (ngSubmit)="processInbound()">
            <label class="field"><span>Phone</span><input formControlName="phone" placeholder="+91 98765 00000" /></label>
            <label class="field"><span>Name</span><input formControlName="displayName" placeholder="Lead name" /></label>
            <label class="field">
              <span>Branch</span>
              <select formControlName="branchId">
                <option value="">Current scope</option>
                <option *ngFor="let branch of branches()" [value]="branch.id">{{ branch.name }}</option>
              </select>
            </label>
            <label class="field full"><span>Incoming message</span><textarea formControlName="body"></textarea></label>
            <div class="form-actions">
              <button class="primary-button" type="submit" [disabled]="inboundForm.invalid || saving()">Process inbound</button>
              <button class="ghost-button" type="button" (click)="qualifyLead()" [disabled]="inboundForm.invalid || saving()">Qualify only</button>
            </div>
          </form>
        </section>

        <section class="panel">
          <div class="section-title">
            <div>
              <h2>Run operational WhatsApp jobs</h2>
            </div>
          </div>
          <form [formGroup]="actionForm" class="wa-action-form">
            <label class="field">
              <span>Appointment</span>
              <select formControlName="appointmentId">
                <option value="">Select appointment</option>
                <option *ngFor="let appointment of appointments()" [value]="appointment.id">
                  {{ clientName(appointment.clientId) }} · {{ appointment.startAt | auraDate:'date' }}
                </option>
              </select>
            </label>
            <label class="field">
              <span>Campaign</span>
              <select formControlName="campaignId">
                <option value="">Manual broadcast</option>
                <option *ngFor="let campaign of campaigns()" [value]="campaign.id">{{ campaign.name }}</option>
              </select>
            </label>
            <label class="field"><span>Hours ahead</span><input type="number" min="1" formControlName="hoursAhead" /></label>
            <label class="field"><span>Phone</span><input formControlName="phone" placeholder="Missed-call phone" /></label>
            <label class="field full"><span>Broadcast template</span><textarea formControlName="template"></textarea></label>
          </form>

          <div class="quick-grid">
            <button class="action-card command-card" type="button" (click)="bookingConfirmation()">
              <strong>Booking confirmation</strong><span>Send appointment confirmation.</span>
            </button>
            <button class="action-card command-card" type="button" (click)="reminders()">
              <strong>Reminder messages</strong><span>Queue reminders for upcoming bookings.</span>
            </button>
            <button class="action-card command-card" type="button" (click)="missedCall()">
              <strong>Missed-call follow-up</strong><span>Create a lead thread and callback text.</span>
            </button>
            <button class="action-card command-card" type="button" (click)="paymentReminders()">
              <strong>Payment reminders</strong><span>Queue messages for unpaid invoices.</span>
            </button>
            <button class="action-card command-card" type="button" (click)="birthdayWishes()">
              <strong>Birthday wishes</strong><span>Send birthday offer messages.</span>
            </button>
            <button class="action-card command-card" type="button" (click)="campaignBroadcast()">
              <strong>Campaign broadcasting</strong><span>Broadcast to saved segment clients.</span>
            </button>
          </div>
        </section>
      </div>

      <section class="panel register-panel" *ngIf="visibleWhatsAppView('result') && result() as result">
        <div class="section-title">
          <div>
            <h2>{{ resultTitle(result) }}</h2>
          </div>
        </div>
        <div class="chip-row">
          <span class="badge" *ngIf="result.detection">intent {{ result.detection.intent }}</span>
          <span class="badge" *ngIf="result.qualification">score {{ result.qualification.score }}</span>
          <span class="badge" *ngIf="result.count !== undefined">{{ result.count }} messages</span>
          <span class="badge" *ngIf="result.handoff">handoff created</span>
        </div>
        <pre class="result-json">{{ result | json }}</pre>
      </section>

      <div class="dashboard-grid" *ngIf="visibleWhatsAppView('inbox')">
        <section class="panel">
          <div class="section-title">
            <div>
              <h2>WhatsApp threads</h2>
            </div>
          </div>
          <div class="rank-list">
            <article *ngFor="let thread of threads()">
              <div>
                <strong>{{ thread.displayName || thread.phone }}</strong>
                <span>{{ thread.phone }} · {{ thread.intent }} · score {{ thread.leadScore }}</span>
                <small>{{ thread.lastMessagePreview || 'No messages yet' }}</small>
              </div>
              <div class="right">
                <strong>{{ thread.status }}</strong>
                <small>{{ thread.handoffStatus }}</small>
                <button class="ghost-button mini" type="button" (click)="openHandoff(thread.id)">Handoff</button>
              </div>
            </article>
            <article *ngIf="!threads().length"><strong>No WhatsApp threads</strong><span>Process an inbound message to start one.</span></article>
          </div>
        </section>

        <section class="panel">
          <div class="section-title">
            <div>
              <h2>Escalation queue</h2>
            </div>
          </div>
          <div class="activity-list">
            <article *ngFor="let handoff of handoffs()">
              <div>
                <strong>{{ handoff.reason }}</strong>
                <span>{{ handoff.priority }} · {{ handoff.status }}</span>
                <small>{{ handoff.createdAt | auraDate:'date' }}</small>
              </div>
              <button class="ghost-button mini" type="button" (click)="resolveHandoff(handoff.id)" *ngIf="handoff.status !== 'resolved'">Resolve</button>
            </article>
            <article *ngIf="!handoffs().length"><strong>No handoffs</strong><span>Escalations will appear here.</span></article>
          </div>
        </section>
      </div>

      <section class="panel register-panel" *ngIf="visibleWhatsAppView('rules')">
        <div class="section-title">
          <div>
            <h2>WhatsApp rule library</h2>
          </div>
        </div>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Rule</th>
                <th>Trigger</th>
                <th>Status</th>
                <th>Delay</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              <tr *ngFor="let rule of rules()">
                <td><strong>{{ rule.name }}</strong><small>{{ rule.template }}</small></td>
                <td>{{ rule.trigger }}</td>
                <td><span class="badge">{{ rule.status }}</span></td>
                <td>{{ rule.delayMinutes }} min</td>
                <td>{{ (rule.actions || []).join(', ') }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
        </main>
      </div>
    </section>
  `,
  styles: [`
    .whatsapp-workspace { display: grid; gap: 8px; padding: 8px; color: #1d2430; background: #f0f2f5; min-height: calc(100vh - 20px); }
    .command-bar { display: flex; justify-content: space-between; align-items: center; gap: 16px; padding: 14px 20px; background: #111827; color: #fff; border-bottom: 1px solid #d8e1ea; }
    .brand-block, .top-actions, .center-line, .header-actions, .form-actions, .chip-row { display: flex; align-items: center; gap: 10px; }
    .brand-mark { width: 34px; height: 34px; display: grid; place-items: center; border-radius: 8px; background: #6d5bd0; color: #fff; font-weight: 900; }
    .brand-block small, .field span, .search-field span, .section-title span { display: block; color: #5f6f85; font-size: 11px; font-weight: 800; text-transform: uppercase; }
    .brand-block small { color: #8fa1b8; }
    .brand-block strong { display: block; color: #fff; font-size: 15px; }
    .zenoti-button, .primary-button, .ghost-button { border: 1px solid #b9cbe0; background: #fff; color: #0065a8; border-radius: 3px; padding: 8px 13px; font-weight: 800; cursor: pointer; }
    .zenoti-button.primary, .primary-button { background: #55173D; border-color: #55173D; color: #fff; }
    .zenoti-header { background: #fff; display: grid; gap: 10px; padding: 18px 16px 12px; }
    .page-heading { background: #fff; border: 1px solid #d8e1ea; }
    .metric-strip { background: #fff; border: 1px solid #d8e1ea; }
    .ai-layout { background: #fff; border: 1px solid #d8e1ea; }
    .panel { background: #fff; border: 1px solid #d8e1ea; }
    .center-line { justify-content: space-between; }
    .center-line strong { font-size: 15px; }
    .command-select { width: 100%; padding: 9px 12px; border: 1px solid #b9cbe0; border-radius: 3px; color: #111827; font-weight: 800; background: #fff; }
    .page-heading { display: flex; justify-content: space-between; gap: 16px; padding: 16px; align-items: end; }
    .page-heading h1 { margin: 0; font-size: 22px; color: #172033; }
    .page-heading p { margin: 6px 0 0; color: #36506d; font-size: 13px; }
    .search-field { width: min(100%, 330px); display: grid; gap: 5px; }
    .search-field input, .field input, .field select, .field textarea, .wa-action-form input, .wa-action-form select, .wa-action-form textarea { width: 100%; border: 1px solid #cbd8e5; border-radius: 3px; padding: 9px 11px; font: inherit; background: #fff; color: #172033; }
    .metric-strip { display: grid; grid-template-columns: repeat(8, minmax(145px, 1fr)); gap: 0; overflow-x: auto; background: #fff; border-left: 1px solid #d8e1ea; border-right: 1px solid #d8e1ea; border-bottom: 1px solid #d8e1ea; }
    .metric-strip article { min-width: 145px; padding: 13px 16px; border-right: 1px solid #d8e1ea; border-top: 3px solid #55173D; }
    .metric-strip article:nth-child(2) { border-top-color: #bb241a; }
    .metric-strip article:nth-child(3) { border-top-color: #bd7400; }
    .metric-strip article:nth-child(4) { border-top-color: #2b61d1; }
    .metric-strip article:nth-child(5) { border-top-color: #16834f; }
    .metric-strip article:nth-child(6) { border-top-color: #7046d8; }
    .metric-strip article:nth-child(7) { border-top-color: #0f172a; }
    .metric-strip article:nth-child(8) { border-top-color: #d3336f; }
    .metric-strip span, .metric-strip small, td small, .rank-list small, .activity-list small { display: block; color: #5f6f85; font-size: 12px; }
    .metric-strip strong { display: block; margin: 6px 0 2px; color: #172033; font-size: 24px; }
    .whatsapp-section-workspace { display: grid; grid-template-columns: minmax(260px, 320px) minmax(0, 1fr); gap: 14px; align-items: start; }
    .whatsapp-side-nav { position: sticky; top: 92px; display: grid; gap: 10px; }
    .whatsapp-nav-card { display: grid; grid-template-columns: 44px minmax(0, 1fr) auto; gap: 11px; align-items: center; width: 100%; min-height: 92px; padding: 13px; border: 1px solid #d8e1ea; border-left: 4px solid #55173D; border-radius: 8px; background: #fff; color: #172033; text-align: left; box-shadow: 0 10px 24px rgba(15,23,42,.06); cursor: pointer; }
    .whatsapp-nav-card:hover, .whatsapp-nav-card.active { background: linear-gradient(135deg, #F1E8EE, #eef4ff); border-color: #D4C0CF; transform: translateY(-1px); }
    .whatsapp-nav-icon { display: grid; place-items: center; width: 44px; height: 44px; border-radius: 8px; background: #F1E8EE; color: #3D0F2C; font-weight: 950; font-size: 12px; }
    .whatsapp-nav-card strong, .whatsapp-nav-card small { display: block; }
    .whatsapp-nav-card small { margin-top: 4px; color: #5f6f85; font-size: 12px; font-weight: 700; line-height: 1.3; }
    .whatsapp-nav-card em { align-self: start; padding: 4px 7px; border-radius: 999px; background: #F1E8EE; color: #3D0F2C; font-size: 10px; font-style: normal; font-weight: 900; text-transform: uppercase; }
    .whatsapp-detail { display: grid; gap: 8px; min-width: 0; }
    .ai-layout, .dashboard-grid { display: grid; grid-template-columns: minmax(320px, .8fr) minmax(520px, 1.2fr); gap: 0; }
    .form-panel, .panel { border-right: 1px solid #d8e1ea; border-radius: 0; box-shadow: none; padding: 16px; }
    .panel:last-child, .form-panel:last-child { border-right: 0; }
    .form-panel h3, .section-title h2 { margin: 3px 0 12px; color: #172033; font-size: 18px; }
    form, .wa-action-form { display: grid; gap: 10px; }
    .field { display: grid; gap: 5px; }
    .field.full { grid-column: 1 / -1; }
    textarea { min-height: 78px; resize: vertical; }
    .wa-action-form { grid-template-columns: repeat(2, minmax(0, 1fr)); margin-bottom: 12px; }
    .quick-grid { display: grid; grid-template-columns: repeat(3, minmax(160px, 1fr)); gap: 10px; }
    .action-card { text-align: left; border: 1px solid #d8e1ea; border-radius: 0; background: #fbfcfe; padding: 12px; display: grid; gap: 5px; cursor: pointer; }
    .action-card:hover { background: #F5EEF2; border-color: #D4C0CF; }
    .rank-list, .activity-list { display: grid; gap: 0; border: 1px solid #d8e1ea; }
    .rank-list article, .activity-list article { display: flex; justify-content: space-between; gap: 12px; padding: 12px; border-bottom: 1px solid #dfe7ef; background: #fff; }
    .rank-list article:last-child, .activity-list article:last-child { border-bottom: 0; }
    .right { text-align: right; display: grid; gap: 4px; justify-items: end; }
    .badge { display: inline-flex; padding: 4px 9px; border-radius: 999px; background: #FBF0E8; color: #7A4A28; font-weight: 800; font-size: 12px; }
    .result-json { max-height: 280px; overflow: auto; margin: 12px 0 0; padding: 12px; border: 1px solid #d8e1ea; background: #f8fafc; color: #172033; white-space: pre-wrap; }
    .table-wrap { overflow: auto; border: 1px solid #d8e1ea; background: #fff; }
    table { width: 100%; min-width: 860px; border-collapse: collapse; }
    th, td { padding: 10px 12px; border-bottom: 1px solid #dfe7ef; text-align: left; vertical-align: middle; }
    th { background: #f4f7fa; color: #5b6b81; font-size: 12px; text-transform: uppercase; }
    td strong { display: block; color: #172033; }
    tr:hover td { background: #F5EEF2; }
    app-state { display: block; }
    @media (max-width: 1180px) {
      .whatsapp-section-workspace, .ai-layout, .dashboard-grid { grid-template-columns: 1fr; }
      .whatsapp-side-nav { position: static; grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .form-panel, .panel { border-right: 0; }
      .quick-grid { grid-template-columns: repeat(2, minmax(160px, 1fr)); }
    }
    @media (max-width: 760px) {
      .command-bar, .page-heading, .center-line, .rank-list article, .activity-list article { display: grid; align-items: start; }
      .top-actions, .header-actions, .form-actions { flex-wrap: wrap; }
      .search-field { width: 100%; }
      .whatsapp-section-workspace, .whatsapp-side-nav, .metric-strip, .wa-action-form, .quick-grid { grid-template-columns: 1fr; }
      .right { text-align: left; justify-items: start; }
    }
  `]
})
export class WhatsAppAutomationComponent implements OnInit {
  readonly summary = signal<ApiRecord | null>(null);
  readonly threads = signal<ApiRecord[]>([]);
  readonly messages = signal<ApiRecord[]>([]);
  readonly rules = signal<ApiRecord[]>([]);
  readonly handoffs = signal<ApiRecord[]>([]);
  readonly appointments = signal<ApiRecord[]>([]);
  readonly campaigns = signal<ApiRecord[]>([]);
  readonly clients = signal<ApiRecord[]>([]);
  readonly branches = signal<ApiRecord[]>([]);
  readonly result = signal<ApiRecord | null>(null);
  readonly loading = signal(true);
  readonly saving = signal(false);
  readonly error = signal('');
  readonly activeWhatsAppView = signal<WhatsAppViewKey>('overview');
  readonly whatsAppViews: Array<{ key: WhatsAppViewKey; label: string; description: string; icon: string; badge: string }> = [
    { key: 'overview', label: 'Overview', description: 'All WhatsApp automation sections', icon: 'OV', badge: 'All' },
    { key: 'operations', label: 'Operations', description: 'Inbound processing and quick actions', icon: 'OP', badge: 'Run' },
    { key: 'inbox', label: 'Inbox', description: 'Threads, messages and handoffs', icon: 'IB', badge: 'CRM' },
    { key: 'rules', label: 'Rules', description: 'Automation rule library', icon: 'RL', badge: 'Ops' }
  ];

  readonly inboundForm = this.fb.group({
    phone: ['+91 98765 43120', Validators.required],
    displayName: ['Riya Sharma'],
    branchId: [''],
    body: ['Hi, can I book hair color tomorrow and know the price?', Validators.required]
  });

  readonly actionForm = this.fb.group({
    appointmentId: [''],
    campaignId: [''],
    hoursAhead: [48],
    phone: ['+91 90000 30303'],
    displayName: ['New missed call lead'],
    template: ['Hi {{name}}, your Aura Salon offer is waiting. Reply BOOK to reserve a slot.']
  });

  constructor(private readonly api: ApiService, private readonly fb: UntypedFormBuilder) {}

  ngOnInit(): void {
    this.load();
  }

  setWhatsAppView(view: WhatsAppViewKey): void {
    this.activeWhatsAppView.set(view);
  }

  visibleWhatsAppView(view: WhatsAppViewKey): boolean {
    return this.activeWhatsAppView() === 'overview' || this.activeWhatsAppView() === view;
  }

  load(): void {
    this.loading.set(true);
    this.error.set('');
    Promise.all([
      this.api.list<ApiRecord>('whatsapp/summary').toPromise(),
      this.api.list<ApiRecord[]>('whatsapp/threads').toPromise(),
      this.api.list<ApiRecord[]>('whatsapp/messages').toPromise(),
      this.api.list<ApiRecord[]>('whatsapp/rules').toPromise(),
      this.api.list<ApiRecord[]>('whatsapp/handoffs').toPromise(),
      this.api.list<ApiRecord[]>('appointments').toPromise(),
      this.api.list<ApiRecord[]>('marketing').toPromise(),
      this.api.list<ApiRecord[]>('clients').toPromise(),
      this.api.list<ApiRecord[]>('branches').toPromise()
    ])
      .then(([summary, threads, messages, rules, handoffs, appointments, campaigns, clients, branches]) => {
        this.summary.set(summary || null);
        this.threads.set(threads || []);
        this.messages.set(messages || []);
        this.rules.set(rules || []);
        this.handoffs.set(handoffs || []);
        this.appointments.set(appointments || []);
        this.campaigns.set(campaigns || []);
        this.clients.set(clients || []);
        this.branches.set(branches || []);
        if (!this.actionForm.value.appointmentId && appointments?.[0]?.id) this.actionForm.patchValue({ appointmentId: appointments[0].id });
        if (!this.actionForm.value.campaignId && campaigns?.[0]?.id) this.actionForm.patchValue({ campaignId: campaigns[0].id });
        this.loading.set(false);
      })
      .catch((error) => {
        this.error.set(error?.error?.error || 'Unable to load WhatsApp automation engine');
        this.loading.set(false);
      });
  }

  processInbound(): void {
    if (this.inboundForm.invalid) return;
    this.runWorkflow('whatsapp/inbound', this.inboundForm.value);
  }

  qualifyLead(): void {
    if (this.inboundForm.invalid) return;
    this.runWorkflow('whatsapp/qualify-lead', this.inboundForm.value);
  }

  bookingConfirmation(): void {
    const appointmentId = this.actionForm.value.appointmentId;
    if (!appointmentId) {
      this.error.set('Select an appointment first');
      return;
    }
    this.runWorkflow('whatsapp/booking-confirmation', { appointmentId });
  }

  reminders(): void {
    this.runWorkflow('whatsapp/reminders', { hoursAhead: Number(this.actionForm.value.hoursAhead || 24) });
  }

  missedCall(): void {
    this.runWorkflow('whatsapp/missed-call', {
      phone: this.actionForm.value.phone,
      displayName: this.actionForm.value.displayName
    });
  }

  paymentReminders(): void {
    this.runWorkflow('whatsapp/payment-reminders', {});
  }

  birthdayWishes(): void {
    this.runWorkflow('whatsapp/birthday-wishes', {});
  }

  campaignBroadcast(): void {
    this.runWorkflow('whatsapp/campaign-broadcast', {
      campaignId: this.actionForm.value.campaignId,
      template: this.actionForm.value.template
    });
  }

  runQuickAction(event: Event): void {
    const select = event.target as HTMLSelectElement;
    const action = select.value;
    if (action === 'inbound') this.processInbound();
    if (action === 'qualify') this.qualifyLead();
    if (action === 'booking') this.bookingConfirmation();
    if (action === 'reminders') this.reminders();
    if (action === 'missed') this.missedCall();
    if (action === 'birthday') this.birthdayWishes();
    select.selectedIndex = 0;
  }

  openHandoff(threadId: string): void {
    this.runWorkflow('whatsapp/handoffs', {
      threadId,
      reason: 'Front desk follow-up requested from WhatsApp inbox',
      priority: 'normal'
    });
  }

  resolveHandoff(id: string): void {
    this.saving.set(true);
    this.api.patch(`whatsapp/handoffs/${id}`, { status: 'resolved', note: 'Resolved from console' }).subscribe({
      next: (result) => {
        this.result.set(result);
        this.saving.set(false);
        this.load();
      },
      error: (error) => {
        this.error.set(error?.error?.error || 'Unable to resolve handoff');
        this.saving.set(false);
      }
    });
  }

  runWorkflow(path: string, payload: ApiRecord): void {
    this.saving.set(true);
    this.error.set('');
    this.api.post<ApiRecord>(path, payload).subscribe({
      next: (result) => {
        this.result.set(result);
        this.saving.set(false);
        this.load();
      },
      error: (error) => {
        this.error.set(error?.error?.error || 'Unable to run WhatsApp workflow');
        this.saving.set(false);
      }
    });
  }

  clientName(clientId: string): string {
    return this.clients().find((client) => client.id === clientId)?.name || 'Client';
  }

  resultTitle(result: ApiRecord): string {
    if (result.detection) return 'Inbound processed';
    if (result.thread && result.message) return 'Message queued';
    if (result.count !== undefined) return 'Batch workflow complete';
    return 'Workflow complete';
  }
}
