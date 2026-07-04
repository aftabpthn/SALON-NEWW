import { CommonModule } from '@angular/common';
import { Component, OnInit, computed, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { finalize } from 'rxjs/operators';
import { ApiRecord, ApiService } from '../core/api.service';

type Channel = 'whatsapp' | 'sms';

@Component({
  selector: 'app-birthday-campaign',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <section class="birthday-page">
      <header class="page-header">
        <div>
          <span class="eyebrow">Marketing automation</span>
          <h1>Birthday AI campaigns</h1>
          <p>Track current and upcoming birthdays, pick one of 10 AI messages and 10 offers, then send WhatsApp and SMS from the SaaS console.</p>
        </div>
        <div class="header-actions">
          <label>
            <span>Days ahead</span>
            <input type="number" min="1" max="60" [(ngModel)]="daysAhead" />
          </label>
          <button type="button" class="secondary-button" (click)="load()" [disabled]="loading()">Refresh</button>
          <button type="button" class="primary-button" (click)="sendBulk('today')" [disabled]="sending() || !(metrics().currentBirthdays || 0)">Send today</button>
          <button type="button" class="ghost-button" (click)="sendBulk('upcoming')" [disabled]="sending() || !(metrics().upcomingBirthdays || 0)">Send upcoming</button>
        </div>
      </header>

      <section class="metric-strip">
        <article><span>Today birthdays</span><strong>{{ metrics().currentBirthdays || 0 }}</strong></article>
        <article><span>Upcoming birthdays</span><strong>{{ metrics().upcomingBirthdays || 0 }}</strong></article>
        <article><span>Reachable clients</span><strong>{{ metrics().reachableClients || 0 }}</strong></article>
        <article><span>AI messages</span><strong>{{ metrics().messageSuggestions || 10 }}</strong></article>
        <article><span>AI offers</span><strong>{{ metrics().offerSuggestions || 10 }}</strong></article>
      </section>

      <section class="campaign-layout">
        <aside class="panel selector-panel">
          <div class="panel-head">
            <div>
              <span>Birthday queue</span>
              <h2>Current & upcoming</h2>
            </div>
            <button type="button" class="ghost-button" (click)="selectFirstCurrent()">Today</button>
          </div>
          <div class="filter-row">
            <button type="button" [class.active]="clientFilter() === 'all'" (click)="clientFilter.set('all')">All</button>
            <button type="button" [class.active]="clientFilter() === 'today'" (click)="clientFilter.set('today')">Today</button>
            <button type="button" [class.active]="clientFilter() === 'upcoming'" (click)="clientFilter.set('upcoming')">Upcoming</button>
          </div>
          <div class="client-list">
            <button
              type="button"
              *ngFor="let client of filteredClients()"
              [class.active]="selectedClientId() === client.id"
              (click)="selectClient(client)"
            >
              <span class="avatar">{{ initials(client.name) }}</span>
              <span><strong>{{ client.name || 'Client' }}</strong><small>{{ birthdayLabel(client) }} · {{ client.phone || 'phone missing' }}</small></span>
              <em>{{ client.birthdayStatus }}</em>
            </button>
            <p class="empty" *ngIf="!clients().length && !loading()">No birthdays found in the selected window.</p>
          </div>
        </aside>

        <main class="detail-stack">
          <section class="panel selected-panel" *ngIf="selectedClient() as client; else noClient">
            <div class="panel-head">
              <div>
                <span>{{ client.birthdayStatus === 'today' ? 'Current birthday' : 'Upcoming birthday' }}</span>
                <h2>{{ client.name }}</h2>
                <small>{{ birthdayLabel(client) }} · {{ client.phone || 'No reachable phone' }}</small>
              </div>
              <div class="channel-toggles">
                <label><input type="checkbox" [checked]="hasChannel('whatsapp')" (change)="toggleChannel('whatsapp')" /> WhatsApp</label>
                <label><input type="checkbox" [checked]="hasChannel('sms')" (change)="toggleChannel('sms')" /> SMS</label>
              </div>
            </div>

            <div class="suggestion-grid">
              <article>
                <div class="panel-head compact"><h3>10 AI text messages</h3></div>
                <button type="button" class="suggestion" *ngFor="let item of messageSuggestions(); let i = index" [class.active]="selectedMessageId() === item.id" (click)="selectMessage(item)">
                  <strong>{{ i + 1 }}. {{ item.title }}</strong>
                  <span>{{ renderMessage(item.template) }}</span>
                </button>
              </article>
              <article>
                <div class="panel-head compact"><h3>10 AI offers</h3></div>
                <button type="button" class="suggestion offer" *ngFor="let item of offerSuggestions(); let i = index" [class.active]="selectedOfferId() === item.id" (click)="selectOffer(item)">
                  <strong>{{ i + 1 }}. {{ item.title }}</strong>
                  <span>{{ item.discount }} · valid {{ item.validity }} · {{ item.bestFor }}</span>
                </button>
              </article>
            </div>

            <section class="panel preview-panel">
              <div class="panel-head compact">
                <h3>Send preview</h3>
                <button type="button" class="primary-button" [disabled]="sending() || !client.phone || !selectedChannels().length" (click)="sendSelected(client)">{{ sending() ? 'Sending...' : 'Send WhatsApp + SMS' }}</button>
              </div>
              <textarea rows="4" [(ngModel)]="customMessage"></textarea>
              <p class="success" *ngIf="message()">{{ message() }}</p>
              <p class="error" *ngIf="error()">{{ error() }}</p>
            </section>
          </section>

          <ng-template #noClient>
            <section class="panel empty-state">
              <h2>Select a birthday client</h2>
              <p>Choose a current or upcoming birthday from the left to review AI message and offer suggestions.</p>
            </section>
          </ng-template>
        </main>
      </section>
    </section>
  `,
  styles: [`
    :host { display: block; }
    .birthday-page { display: grid; gap: 14px; padding: 12px; color: #172033; background: #f0f2f5; min-height: calc(100vh - 20px); }
    .page-header, .panel { border: 1px solid #d8e1ea; border-radius: 8px; background: #fff; box-shadow: 0 12px 28px rgba(15,23,42,.06); }
    .page-header { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 14px; align-items: center; padding: 18px; }
    .page-header h1 { margin: 4px 0 6px; font-size: 30px; letter-spacing: 0; }
    .page-header p { margin: 0; color: #5f6f85; max-width: 860px; line-height: 1.45; }
    .eyebrow, .panel-head span, label span, .metric-strip span { color: #64748b; font-size: 12px; font-weight: 900; text-transform: uppercase; }
    .header-actions { display: flex; gap: 10px; align-items: end; }
    input, textarea { width: 100%; border: 1px solid #cfe0dc; border-radius: 8px; background: #f8fffd; padding: 10px 11px; color: #172033; font-weight: 800; box-sizing: border-box; }
    textarea { resize: vertical; font-family: inherit; line-height: 1.5; }
    button { min-height: 40px; border: 1px solid #cfe0dc; border-radius: 8px; padding: 0 14px; background: #fff; color: #172033; font-weight: 900; cursor: pointer; }
    button:disabled { opacity: .55; cursor: not-allowed; }
    .primary-button { background: #5A153F; border-color: #E7DDD6; color: #fff; }
    .secondary-button { background: #eff6ff; border-color: #bfdbfe; color: #1d4ed8; }
    .ghost-button { background: #fff; }
    .metric-strip { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 10px; }
    .metric-strip article { border: 1px solid #d8e1ea; border-radius: 8px; background: #fff; padding: 14px; }
    .metric-strip strong { display: block; margin-top: 5px; font-size: 24px; }
    .campaign-layout { display: grid; grid-template-columns: minmax(280px, 360px) minmax(0, 1fr); gap: 14px; align-items: start; }
    .panel { padding: 14px; min-width: 0; }
    .selector-panel { position: sticky; top: 92px; }
    .panel-head { display: flex; justify-content: space-between; gap: 12px; align-items: center; margin-bottom: 12px; }
    .panel-head h2, .panel-head h3 { margin: 2px 0 0; letter-spacing: 0; }
    .panel-head small { color: #64748b; font-weight: 700; }
    .panel-head.compact { margin-bottom: 8px; }
    .client-list, .detail-stack, .suggestion-grid article { display: grid; gap: 8px; }
    .filter-row { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 6px; margin-bottom: 8px; }
    .filter-row button.active { background: #5A153F; border-color: #E7DDD6; color: #fff; }
    .client-list button { display: grid; grid-template-columns: 42px minmax(0, 1fr) auto; gap: 10px; align-items: center; min-height: 70px; text-align: left; }
    .client-list button.active, .suggestion.active { background: linear-gradient(135deg, #F8EEF4, #FAF8F6); border-color: #E7DDD6; }
    .avatar { display: grid; place-items: center; width: 42px; height: 42px; border-radius: 8px; background: #F1E8EE; color: #3D0F2C; font-weight: 950; }
    .client-list strong, .client-list small { display: block; }
    .client-list small { margin-top: 3px; color: #64748b; font-size: 12px; }
    .client-list em { align-self: start; padding: 4px 7px; border-radius: 999px; background: #F1E8EE; color: #3D0F2C; font-size: 10px; font-style: normal; text-transform: uppercase; }
    .channel-toggles { display: flex; flex-wrap: wrap; gap: 8px; }
    .channel-toggles label { display: inline-flex; gap: 6px; align-items: center; font-weight: 900; color: #172033; }
    .channel-toggles input { width: 16px; padding: 0; }
    .suggestion-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
    .suggestion { display: grid; gap: 5px; min-height: 82px; padding: 10px; text-align: left; align-content: start; }
    .suggestion span { color: #64748b; font-size: 13px; line-height: 1.35; font-weight: 700; }
    .preview-panel { margin-top: 12px; background: #f8fffd; }
    .success { color: #047857; font-weight: 900; }
    .error { color: #b91c1c; font-weight: 900; }
    .empty, .empty-state p { color: #64748b; font-weight: 700; }
    @media (max-width: 1100px) { .campaign-layout, .suggestion-grid { grid-template-columns: 1fr; } .selector-panel { position: static; } .metric-strip { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
    @media (max-width: 760px) { .page-header, .metric-strip { grid-template-columns: 1fr; } .header-actions { align-items: stretch; flex-direction: column; } }
  `]
})
export class BirthdayCampaignComponent implements OnInit {
  daysAhead = 30;
  customMessage = '';
  readonly loading = signal(false);
  readonly sending = signal(false);
  readonly summary = signal<ApiRecord>({});
  readonly selectedClientId = signal('');
  readonly clientFilter = signal<'all' | 'today' | 'upcoming'>('all');
  readonly selectedMessageId = signal('birthday_msg_1');
  readonly selectedOfferId = signal('birthday_offer_1');
  readonly selectedChannels = signal<Channel[]>(['whatsapp', 'sms']);
  readonly message = signal('');
  readonly error = signal('');
  readonly metrics = computed(() => this.summary()['metrics'] || {});
  readonly clients = computed<ApiRecord[]>(() => this.rows(this.summary()['clients']));
  readonly filteredClients = computed<ApiRecord[]>(() => {
    const filter = this.clientFilter();
    if (filter === 'today') return this.clients().filter((client) => client['birthdayStatus'] === 'today');
    if (filter === 'upcoming') return this.clients().filter((client) => client['birthdayStatus'] === 'upcoming');
    return this.clients();
  });
  readonly messageSuggestions = computed<ApiRecord[]>(() => this.rows(this.summary()['messageSuggestions']));
  readonly offerSuggestions = computed<ApiRecord[]>(() => this.rows(this.summary()['offerSuggestions']));
  readonly selectedClient = computed<ApiRecord | null>(() => this.clients().find((client) => client.id === this.selectedClientId()) || this.clients()[0] || null);
  readonly selectedOffer = computed<ApiRecord>(() => this.offerSuggestions().find((item) => item.id === this.selectedOfferId()) || this.offerSuggestions()[0] || {});
  readonly selectedTemplate = computed<ApiRecord>(() => this.messageSuggestions().find((item) => item.id === this.selectedMessageId()) || this.messageSuggestions()[0] || {});

  constructor(private readonly api: ApiService) {}

  ngOnInit(): void { this.load(); }

  load(): void {
    this.loading.set(true);
    this.error.set('');
    this.api.list<ApiRecord>('birthday-campaign/summary', { daysAhead: this.daysAhead })
      .pipe(finalize(() => this.loading.set(false)))
      .subscribe({
        next: (value) => {
          this.summary.set(value || {});
          if (!this.selectedClientId() && this.clients().length) this.selectedClientId.set(this.clients()[0].id);
          this.refreshPreview();
        },
        error: (error) => this.error.set(error?.error?.error || 'Unable to load birthday campaigns')
      });
  }

  selectFirstCurrent(): void {
    const client = this.clients().find((row) => row.birthdayStatus === 'today') || this.clients()[0];
    if (client) this.selectClient(client);
  }

  selectClient(client: ApiRecord): void {
    this.selectedClientId.set(client.id || '');
    this.refreshPreview();
  }

  selectMessage(item: ApiRecord): void {
    this.selectedMessageId.set(item.id || '');
    this.refreshPreview();
  }

  selectOffer(item: ApiRecord): void {
    this.selectedOfferId.set(item.id || '');
    this.refreshPreview();
  }

  hasChannel(channel: Channel): boolean { return this.selectedChannels().includes(channel); }

  toggleChannel(channel: Channel): void {
    const next = this.hasChannel(channel) ? this.selectedChannels().filter((item) => item !== channel) : [...this.selectedChannels(), channel];
    this.selectedChannels.set(next);
  }

  sendBulk(mode: 'today' | 'upcoming' | 'all'): void {
    this.sending.set(true);
    this.message.set('');
    this.error.set('');
    this.api.post<ApiRecord>('birthday-campaign/send-bulk', {
      mode,
      daysAhead: this.daysAhead,
      messageId: this.selectedMessageId(),
      offerId: this.selectedOfferId(),
      channels: this.selectedChannels(),
      message: this.customMessage
    }).pipe(finalize(() => this.sending.set(false))).subscribe({
      next: (result) => this.message.set(`Birthday campaign queued: ${result['sent'] || 0} sent, ${result['failed'] || 0} failed.`),
      error: (error) => this.error.set(error?.error?.error || 'Unable to send birthday campaign')
    });
  }

  sendSelected(client: ApiRecord): void {
    this.sending.set(true);
    this.message.set('');
    this.error.set('');
    this.api.post<ApiRecord>('birthday-campaign/send', {
      clientId: client.id,
      messageId: this.selectedMessageId(),
      offerId: this.selectedOfferId(),
      channels: this.selectedChannels(),
      message: this.customMessage
    }).pipe(finalize(() => this.sending.set(false))).subscribe({
      next: () => this.message.set('Birthday WhatsApp/SMS queued successfully.'),
      error: (error) => this.error.set(error?.error?.error || 'Unable to send birthday campaign')
    });
  }

  refreshPreview(): void { this.customMessage = this.renderMessage(this.selectedTemplate()['template'] || ''); }

  renderMessage(template: string): string {
    const client = this.selectedClient() || {};
    const offer = this.selectedOffer();
    return String(template || '')
      .replaceAll('{{name}}', client['name'] || 'Client')
      .replaceAll('{{offer}}', offer['title'] || 'birthday offer')
      .replaceAll('{{discount}}', offer['discount'] || '20% off')
      .replaceAll('{{validity}}', offer['validity'] || '7 days')
      .replaceAll('{{salon}}', 'Aura Shine');
  }

  birthdayLabel(client: ApiRecord): string {
    const days = Number(client['daysUntilBirthday'] ?? 0);
    if (days === 0) return 'Today';
    if (days === 1) return 'Tomorrow';
    return `${days} days left`;
  }

  initials(name = ''): string {
    return String(name || 'Client').split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase();
  }

  private rows(value: unknown): ApiRecord[] { return Array.isArray(value) ? value as ApiRecord[] : []; }
}

