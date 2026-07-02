import { CommonModule } from '@angular/common';
import { Component, OnInit, computed, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiRecord, ApiService } from '../core/api.service';
import { StateComponent } from '../shared/ui/state/state.component';

type CareMessage = {
  role: 'customer' | 'assistant';
  text: string;
  at: string;
  relatedModules?: string[];
  nextSteps?: string[];
  escalation?: string;
  provider?: string;
};

type CareContext = {
  provider: string;
  model: string;
  configured: boolean;
  knowledge: Array<{ area: string; details: string[] }>;
  quickActions: string[];
  capabilities: string[];
  guardrails: string[];
};

@Component({
  selector: 'app-customer-care-ai',
  standalone: true,
  imports: [CommonModule, FormsModule, StateComponent],
  template: `
    <section class="care-shell">
      <header class="care-hero">
        <div>
          <span class="eyebrow">Aura Shine support brain</span>
          <h1>Customer Care AI</h1>
          <p>Ask customer-service questions across bookings, clients, POS, data migration, memberships, loyalty, inventory, marketing, reports, settings and branch operations.</p>
        </div>
        <div class="hero-status">
          <span>{{ context()?.configured ? 'OpenAI connected' : 'Local support mode' }}</span>
          <strong>{{ context()?.model || 'checking model' }}</strong>
          <small>{{ context()?.provider || 'provider pending' }}</small>
        </div>
      </header>

      <app-state [loading]="loading()" [error]="error()"></app-state>

      <div class="care-grid" *ngIf="!loading()">
        <aside class="care-panel context-panel">
          <div class="panel-head">
            <h2>Software Knowledge</h2>
            <button type="button" (click)="load()">Refresh</button>
          </div>
          <div class="knowledge-list">
            <article *ngFor="let item of context()?.knowledge || []">
              <strong>{{ item.area }}</strong>
              <p>{{ item.details[0] }}</p>
            </article>
          </div>
          <div class="guardrail-box">
            <strong>Escalation guardrails</strong>
            <span *ngFor="let guardrail of context()?.guardrails || []">{{ guardrail }}</span>
          </div>
        </aside>

        <main class="care-panel chat-panel">
          <div class="panel-head">
            <div>
              <h2>Live Customer Chat</h2>
              <span>{{ messages().length }} messages - {{ selectedTopic() }}</span>
            </div>
            <select [ngModel]="selectedTopic()" (ngModelChange)="selectedTopic.set($event)" aria-label="Support topic">
              <option *ngFor="let topic of topics" [value]="topic">{{ topic }}</option>
            </select>
          </div>

          <div class="quick-row" aria-label="Quick questions">
            <button type="button" *ngFor="let question of context()?.quickActions || []" (click)="askQuick(question)">
              {{ question }}
            </button>
          </div>

          <section class="message-list" aria-live="polite">
            <article class="message" *ngFor="let message of messages()" [class.customer]="message.role === 'customer'">
              <div class="avatar">{{ message.role === 'customer' ? 'C' : 'AI' }}</div>
              <div class="bubble">
                <small>{{ message.role === 'customer' ? 'Customer' : 'Aura Care AI' }} - {{ message.at }}</small>
                <p>{{ message.text }}</p>
                <div class="chips" *ngIf="message.relatedModules?.length">
                  <span *ngFor="let module of message.relatedModules">{{ module }}</span>
                </div>
                <ol *ngIf="message.nextSteps?.length">
                  <li *ngFor="let step of message.nextSteps">{{ step }}</li>
                </ol>
                <em *ngIf="message.escalation">{{ message.escalation }}</em>
              </div>
            </article>
          </section>

          <form class="composer" (ngSubmit)="send()">
            <input [(ngModel)]="customerName" name="customerName" placeholder="Customer name" />
            <input [(ngModel)]="customerPhone" name="customerPhone" placeholder="Phone or booking ref" />
            <textarea [(ngModel)]="draft" name="draft" rows="3" placeholder="Ask anything about AuraSalon customer service..." required></textarea>
            <button type="submit" [disabled]="sending() || !draft.trim()">{{ sending() ? 'Thinking...' : 'Send' }}</button>
          </form>
        </main>

        <aside class="care-panel insight-panel">
          <div class="panel-head">
            <h2>Answer Controls</h2>
          </div>
          <div class="metric-card">
            <span>Provider</span>
            <strong>{{ lastProvider() }}</strong>
            <small>{{ context()?.configured ? 'Server OpenAI key active' : 'Set OPENAI_API_KEY on server' }}</small>
          </div>
          <div class="metric-card">
            <span>Coverage</span>
            <strong>{{ moduleCount() }}</strong>
            <small>knowledge areas loaded</small>
          </div>
          <div class="playbook">
            <strong>Support playbook</strong>
            <button type="button" *ngFor="let item of playbook" (click)="askQuick(item.prompt)">
              <span>{{ item.title }}</span>
              <small>{{ item.detail }}</small>
            </button>
          </div>
        </aside>
      </div>
    </section>
  `,
  styles: [`
    :host { display: block; height: calc(100vh - 44px); min-height: 0; overflow: hidden; }
    .care-shell { display: grid; grid-template-rows: auto auto minmax(0, 1fr); gap: 10px; height: 100%; min-height: 0; padding-top: 6px; color: #172033; min-width: 0; overflow: hidden; }
    .care-hero { display: flex; justify-content: space-between; gap: 18px; align-items: stretch; padding: 14px 18px; border: 1px solid #dfe7ef; border-radius: 8px; background: linear-gradient(135deg, #ffffff, #f4faf8); box-shadow: 0 10px 24px rgba(15, 23, 42, .07); scroll-margin-top: 88px; }
    .eyebrow { display: block; color: #0f766e; font-weight: 800; text-transform: uppercase; font-size: 12px; letter-spacing: .08em; }
    h1, h2, p { margin: 0; }
    h1 { font-size: 28px; letter-spacing: 0; }
    h2 { font-size: 18px; letter-spacing: 0; }
    .care-hero p { max-width: 860px; margin-top: 4px; color: #5f6f83; line-height: 1.4; }
    .hero-status { min-width: 230px; display: grid; align-content: center; gap: 3px; padding: 10px 14px; border: 1px solid #dbe5ee; border-radius: 8px; background: #fff; }
    .hero-status span, .hero-status small, .panel-head span, .metric-card span, .metric-card small { color: #64748b; }
    .hero-status strong { font-size: 18px; }
    .care-grid { display: grid; grid-template-columns: minmax(240px, 280px) minmax(0, 1fr) minmax(220px, 260px); gap: 12px; align-items: stretch; min-width: 0; min-height: 0; }
    .care-panel { min-width: 0; min-height: 0; border: 1px solid #dfe7ef; border-radius: 8px; background: #fff; box-shadow: 0 8px 22px rgba(15, 23, 42, .06); }
    .panel-head { display: flex; justify-content: space-between; gap: 12px; align-items: center; padding: 14px; border-bottom: 1px solid #edf2f7; min-width: 0; }
    .panel-head button, .quick-row button, .playbook button { border: 1px solid #dbe5ee; background: #f8fafc; color: #172033; border-radius: 8px; padding: 9px 11px; font-weight: 700; cursor: pointer; }
    select, input, textarea { width: 100%; min-width: 0; border: 1px solid #dbe5ee; border-radius: 8px; padding: 10px 12px; font: inherit; color: #172033; background: #fff; }
    select { max-width: 360px; }
    .context-panel, .insight-panel { height: 100%; overflow-y: auto; overflow-x: hidden; }
    .knowledge-list, .guardrail-box, .insight-panel, .playbook { display: grid; gap: 10px; padding: 14px; }
    .knowledge-list article { display: grid; gap: 5px; padding: 12px; border: 1px solid #edf2f7; border-radius: 8px; background: #fbfdff; }
    .knowledge-list p { color: #64748b; font-size: 13px; line-height: 1.45; }
    .guardrail-box { margin: 0 14px 14px; border: 1px solid #fde2b8; background: #fffbeb; border-radius: 8px; }
    .guardrail-box span { color: #92400e; font-size: 13px; }
    .chat-panel { height: 100%; min-height: 0; display: grid; grid-template-rows: auto auto minmax(0, 1fr) auto; overflow: hidden; }
    .quick-row { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px; overflow: visible; padding: 10px 14px; border-bottom: 1px solid #edf2f7; }
    .quick-row button { min-height: 36px; text-align: left; white-space: normal; line-height: 1.2; font-size: 13px; padding: 8px 10px; }
    .message-list { display: grid; gap: 12px; align-content: start; min-height: 0; overflow-y: auto; overflow-x: hidden; padding: 16px 16px 22px; background: #f8fafc; }
    .message { display: grid; grid-template-columns: 38px minmax(0, 1fr); gap: 10px; min-width: 0; }
    .message.customer { grid-template-columns: minmax(0, 1fr) 38px; }
    .message.customer .avatar { grid-column: 2; grid-row: 1; background: #111827; }
    .message.customer .bubble { grid-column: 1; grid-row: 1; justify-self: end; background: #102033; color: #fff; }
    .message.customer .bubble small { color: #cbd5e1; }
    .avatar { width: 38px; height: 38px; border-radius: 50%; display: grid; place-items: center; background: #0f766e; color: #fff; font-weight: 900; font-size: 12px; }
    .bubble { width: min(820px, 100%); max-width: 100%; display: grid; gap: 9px; padding: 13px; border: 1px solid #dfe7ef; border-radius: 8px; background: #fff; overflow-wrap: anywhere; }
    .bubble p { white-space: pre-wrap; line-height: 1.55; }
    .bubble small, .bubble em { color: #64748b; }
    .chips { display: flex; flex-wrap: wrap; gap: 7px; }
    .chips span { padding: 5px 8px; border-radius: 999px; background: #e7f8f5; color: #0f766e; font-size: 12px; font-weight: 800; }
    ol { margin: 0; padding-left: 18px; color: #334155; }
    .composer { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) 118px; gap: 10px; padding: 12px 14px 14px; border-top: 1px solid #edf2f7; background: #fff; }
    .composer textarea { grid-column: 1 / 3; min-height: 76px; max-height: 120px; resize: vertical; }
    .composer button { grid-column: 3; grid-row: 1 / 3; min-width: 118px; border: 0; border-radius: 8px; background: #0f766e; color: #fff; font-weight: 900; cursor: pointer; }
    .composer button:disabled { opacity: .55; cursor: not-allowed; }
    .metric-card { display: grid; gap: 5px; padding: 14px; border: 1px solid #edf2f7; border-radius: 8px; background: #fbfdff; }
    .metric-card strong { font-size: 22px; }
    .playbook button { display: grid; gap: 3px; text-align: left; }
    .playbook small { color: #64748b; }
    @media (max-width: 1280px) { .care-grid { grid-template-columns: minmax(220px, 260px) minmax(0, 1fr); } .insight-panel { display: none; } .quick-row { grid-template-columns: repeat(3, minmax(0, 1fr)); } }
    @media (max-width: 980px) { :host { height: auto; overflow: visible; } .care-shell { overflow: visible; } .care-grid { grid-template-columns: 1fr; } .context-panel, .insight-panel, .chat-panel { height: auto; max-height: none; } .chat-panel { min-height: 640px; } .quick-row { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
    @media (max-width: 720px) { .care-hero { flex-direction: column; } h1 { font-size: 28px; } .quick-row { grid-template-columns: 1fr; } .composer { grid-template-columns: 1fr; } .composer textarea, .composer button { grid-column: auto; grid-row: auto; } }
  `]
})
export class CustomerCareAiComponent implements OnInit {
  readonly loading = signal(true);
  readonly sending = signal(false);
  readonly error = signal('');
  readonly context = signal<CareContext | null>(null);
  readonly messages = signal<CareMessage[]>([]);
  readonly selectedTopic = signal('General support');
  readonly lastProvider = signal('checking');
  readonly moduleCount = computed(() => this.context()?.knowledge?.length || 0);

  draft = '';
  customerName = '';
  customerPhone = '';

  readonly topics = ['General support', 'Booking', 'Billing', 'Data Migration', 'Membership', 'POS', 'Inventory', 'Reports', 'Marketing', 'Security'];
  readonly playbook = [
    { title: 'Booking issue', detail: 'Slots, staff, deposits', prompt: 'A customer wants to reschedule an appointment. What should support check?' },
    { title: 'Billing help', detail: 'Invoices, dues, refunds', prompt: 'A customer says their invoice payment is wrong. What is the support workflow?' },
    { title: 'Migration help', detail: 'Imports, mapping, validation', prompt: 'How do I do data migration from old salon software?' },
    { title: 'Membership help', detail: 'Benefits and balances', prompt: 'How should support explain membership benefits and package balance?' },
    { title: 'Branch question', detail: 'Multi-location handling', prompt: 'How does branch-specific pricing and availability work for customers?' }
  ];

  constructor(private readonly api: ApiService) {}

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.error.set('');
    this.api.list<CareContext>('customer-care-ai/context', { includeAllBranches: true }).subscribe({
      next: (context) => {
        this.context.set(context);
        this.lastProvider.set(context.provider);
        if (!this.messages().length) {
          this.messages.set([{
            role: 'assistant',
            text: 'Hi, I am Aura Customer Care AI. Ask me about bookings, invoices, data migration, memberships, packages, loyalty, POS, inventory, campaigns, reviews, reports, settings or branch operations.',
            at: this.timeLabel(),
            relatedModules: ['Home', 'Bookings', 'Clients CRM', 'POS'],
            nextSteps: ['Choose a quick question or type the customer issue.', 'Share customer name and booking reference when available.'],
            provider: context.provider
          }]);
        }
        this.loading.set(false);
      },
      error: (error) => {
        this.error.set(this.api.errorText(error, 'Customer Care AI context could not be loaded.'));
        this.loading.set(false);
      }
    });
  }

  askQuick(question: string): void {
    this.draft = question;
    this.send();
  }

  send(): void {
    const text = this.draft.trim();
    if (!text || this.sending()) return;
    const customerMessage: CareMessage = { role: 'customer', text, at: this.timeLabel() };
    const history = [...this.messages(), customerMessage].slice(-12).map((message) => ({ role: message.role, text: message.text }));
    this.messages.update((items) => [...items, customerMessage]);
    this.draft = '';
    this.sending.set(true);
    this.error.set('');
    this.api.post<ApiRecord>('customer-care-ai/chat', {
      message: text,
      topic: this.selectedTopic(),
      customerName: this.customerName,
      customerPhone: this.customerPhone,
      history,
      includeAllBranches: true
    }).subscribe({
      next: (answer) => {
        this.lastProvider.set(String(answer['provider'] || 'customer-care-ai'));
        this.messages.update((items) => [...items, {
          role: 'assistant',
          text: String(answer['answer'] || 'I could not generate an answer. Please try again with more details.'),
          at: this.timeLabel(),
          relatedModules: this.asTextArray(answer['relatedModules']),
          nextSteps: this.asTextArray(answer['nextSteps']),
          escalation: String(answer['escalation'] || ''),
          provider: String(answer['provider'] || '')
        }]);
        this.sending.set(false);
      },
      error: (error) => {
        this.error.set(this.api.errorText(error, 'Customer Care AI could not answer right now.'));
        this.sending.set(false);
      }
    });
  }

  private asTextArray(value: unknown): string[] {
    return Array.isArray(value) ? value.map((item) => String(item)).filter(Boolean) : [];
  }

  private timeLabel(): string {
    return new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
  }
}




