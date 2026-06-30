import { CommonModule } from '@angular/common';
import { Component, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ApiRecord, ApiService } from '../core/api.service';

type StudioResponse = {
  summary?: ApiRecord;
  templates?: ApiRecord[];
};

type PreferencesResponse = {
  sections?: Array<{ key: string; title: string; rows: ApiRecord[] }>;
  preferences?: ApiRecord[];
};

@Component({
  selector: 'app-message-template-studio',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  template: `
    <section class="studio-page">
      <header class="studio-hero">
        <div>
          <span class="eyebrow">Message command center</span>
          <h1>Message Template Studio</h1>
          <p>Notification settings, SMS, WhatsApp, email templates and sent-message history in one workspace.</p>
        </div>
        <div class="hero-actions">
          <a class="ghost-button" routerLink="/message-logs">Message History</a>
          <a class="ghost-button" routerLink="/notification-center">Notification Center</a>
          <button class="primary-button" type="button" (click)="loadAll()">Refresh</button>
        </div>
      </header>

      <nav class="tab-rail" aria-label="Message template tabs">
        <button type="button" [class.active]="activeTab === 'settings'" (click)="setTab('settings')">Notification Settings</button>
        <button type="button" [class.active]="activeTab === 'sms'" (click)="setTab('sms')">SMS Templates</button>
        <button type="button" [class.active]="activeTab === 'whatsapp'" (click)="setTab('whatsapp')">WhatsApp Templates</button>
        <button type="button" [class.active]="activeTab === 'email'" (click)="setTab('email')">Email Templates</button>
        <button type="button" [class.active]="activeTab === 'history'" (click)="setTab('history')">Message History</button>
      </nav>

      <section class="kpi-grid">
        <article><span>Total templates</span><strong>{{ summary.totalTemplates || 0 }}</strong><small>SMS + WhatsApp + Email</small></article>
        <article><span>SMS</span><strong>{{ summary.smsTemplates || 0 }}</strong><small>Text templates</small></article>
        <article><span>WhatsApp</span><strong>{{ summary.whatsappTemplates || 0 }}</strong><small>Provider template mapped</small></article>
        <article><span>Email</span><strong>{{ summary.emailTemplates || 0 }}</strong><small>Email templates</small></article>
        <article><span>Enabled</span><strong>{{ summary.enabledTemplates || 0 }}</strong><small>Active automation settings</small></article>
      </section>

      <section *ngIf="activeTab === 'settings'" class="settings-panel">
        <div class="section-title">
          <div>
            <span class="eyebrow">Notification settings</span>
            <h2>Client, admin and staff notifications</h2>
          </div>
          <button class="primary-button" type="button" (click)="saveAllPreferences()">Save all</button>
        </div>

        <div class="settings-section" *ngFor="let section of sections">
          <h3>{{ section.title }}</h3>
          <div class="settings-grid">
            <article class="setting-card" *ngFor="let row of section.rows">
              <div>
                <strong>{{ row.eventName || titleCase(row.eventKey) }}</strong>
                <small>{{ row.audience }} · {{ row.channel | uppercase }}</small>
              </div>
              <label class="switch">
                <input type="checkbox" [(ngModel)]="row.enabled" />
                <span></span>
              </label>
              <label>
                <span>Linked template</span>
                <select [(ngModel)]="row.templateKey">
                  <option value="">No template</option>
                  <option *ngFor="let template of templatesForPreference(row)" [value]="template.templateKey">
                    {{ template.name }}
                  </option>
                </select>
              </label>
              <div class="setting-meta">
                <span>Last sent: <b>{{ row.lastSentCount || 0 }}</b></span>
                <button class="ghost-button mini" type="button" (click)="openTemplate(row)">Open template</button>
                <button class="ghost-button mini" type="button" (click)="savePreference(row)">Save</button>
              </div>
            </article>
          </div>
        </div>
      </section>

      <section *ngIf="activeTab === 'sms' || activeTab === 'whatsapp' || activeTab === 'email'" class="template-panel">
        <div class="section-title">
          <div>
            <span class="eyebrow">{{ activeTab }} templates</span>
            <h2>{{ activeTabLabel() }}</h2>
          </div>
          <div class="panel-actions">
            <div class="segmented">
              <button type="button" [class.active]="audienceFilter === 'client'" (click)="audienceFilter = 'client'">Client</button>
              <button type="button" [class.active]="audienceFilter === 'admin'" (click)="audienceFilter = 'admin'">Admin</button>
              <button type="button" [class.active]="audienceFilter === 'staff'" (click)="audienceFilter = 'staff'">Staff</button>
            </div>
            <button class="primary-button" type="button" (click)="newTemplate()">New template</button>
          </div>
        </div>

        <div class="template-grid" *ngIf="visibleTemplates().length; else noTemplates">
          <article class="template-card" *ngFor="let template of visibleTemplates()">
            <div class="template-head">
              <div>
                <input class="title-input" [(ngModel)]="template.name" placeholder="Template title" />
                <small>{{ template.templateKey || 'new_template' }} · {{ template.audience }} · {{ template.channel }}</small>
              </div>
              <label class="switch compact">
                <input type="checkbox" [(ngModel)]="template.enabled" />
                <span></span>
              </label>
            </div>

            <div class="chips">
              <button type="button" *ngFor="let variable of variablesFor(template)" (click)="insertVariable(template, variable)">
                {{ '{{' }}{{ variable }}{{ '}}' }}
              </button>
            </div>

            <label>
              <span>Template key</span>
              <input [(ngModel)]="template.templateKey" placeholder="quick_sale_sms" />
            </label>

            <label *ngIf="activeTab === 'whatsapp'">
              <span>WhatsApp provider template name</span>
              <input [(ngModel)]="template.providerTemplateName" placeholder="interakt_template_name" />
            </label>

            <div *ngIf="activeTab === 'whatsapp'" class="provider-map">
              <span>Provider variables</span>
              <b>{{ '{{1}}' }} = {{ variablesFor(template)[0] || 'Name' }}</b>
              <b>{{ '{{2}}' }} = {{ variablesFor(template)[1] || 'Date' }}</b>
              <b>{{ '{{3}}' }} = {{ variablesFor(template)[2] || 'Price' }}</b>
            </div>

            <label>
              <span>Message body</span>
              <textarea [(ngModel)]="template.body" maxlength="500" (input)="template.preview = ''"></textarea>
              <small [class.warn]="(template.body || '').length > 450">{{ (template.body || '').length }}/500 characters</small>
            </label>

            <div class="preview-box" *ngIf="template.preview">
              <span>Preview</span>
              <p>{{ template.preview }}</p>
            </div>

            <div class="template-actions">
              <button class="ghost-button mini" type="button" (click)="preview(template)">Preview</button>
              <button class="ghost-button mini" type="button" [disabled]="!template.id" (click)="testSend(template)">Test send</button>
              <button class="primary-button mini" type="button" (click)="saveTemplate(template)">Save</button>
            </div>
          </article>
        </div>

        <ng-template #noTemplates>
          <div class="empty-state">
            <strong>No {{ activeTab }} templates found</strong>
            <span>Create a template, then link it from Notification Settings.</span>
            <button class="primary-button" type="button" (click)="newTemplate()">Create template</button>
          </div>
        </ng-template>
      </section>

      <section *ngIf="activeTab === 'history'" class="history-panel">
        <div>
          <span class="eyebrow">Message ledger</span>
          <h2>Message History</h2>
          <p>All SMS, WhatsApp, email, invoice notifications, staff notifications and engagement messages continue to live in the existing Message History page.</p>
        </div>
        <a class="primary-button" routerLink="/message-logs">Open Message History</a>
      </section>

      <p class="status-line" *ngIf="status">{{ status }}</p>
    </section>
  `,
  styles: [`
    :host { display: block; min-height: 100vh; background: #f4f8f7; color: #122033; }
    .studio-page { display: grid; gap: 18px; padding: 22px; }
    .studio-hero, .settings-panel, .template-panel, .history-panel { background: #fff; border: 1px solid #dce9e5; border-radius: 18px; box-shadow: 0 16px 46px rgba(15, 23, 42, .06); }
    .studio-hero { display: flex; align-items: center; justify-content: space-between; gap: 18px; padding: 24px; }
    .hero-actions, .panel-actions, .template-actions, .setting-meta { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
    .eyebrow { display: block; color: #596a66; font-size: 12px; font-weight: 900; text-transform: uppercase; letter-spacing: .02em; }
    h1, h2, h3, p { margin: 0; }
    h1 { margin-top: 4px; font-size: clamp(30px, 3vw, 44px); }
    h2 { font-size: 22px; }
    h3 { font-size: 16px; }
    p { color: #63736f; margin-top: 8px; }
    .primary-button, .ghost-button { border: 1px solid #d7e5e1; border-radius: 13px; padding: 12px 16px; font-weight: 900; text-decoration: none; cursor: pointer; }
    .primary-button { background: #07966f; color: #fff; border-color: #07966f; }
    .ghost-button { background: #fff; color: #14233a; }
    .mini { padding: 8px 11px; font-size: 13px; }
    button:disabled { opacity: .5; cursor: not-allowed; }
    .tab-rail { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 8px; padding: 8px; background: #edf5f2; border-radius: 16px; }
    .tab-rail button, .segmented button { border: 0; border-radius: 11px; background: #f8fbfa; color: #485a55; font-weight: 900; padding: 13px; cursor: pointer; }
    .tab-rail button.active, .segmented button.active { background: #e7fbf4; color: #027a5e; box-shadow: inset 0 -3px 0 #12b886; }
    .kpi-grid { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 12px; }
    .kpi-grid article { background: #fff; border: 1px solid #dfeae7; border-radius: 15px; padding: 16px; }
    .kpi-grid span { color: #61716d; font-size: 13px; font-weight: 900; }
    .kpi-grid strong { display: block; margin-top: 7px; font-size: 27px; }
    .kpi-grid small, label span, td small, .template-card small { color: #5f706c; font-size: 12px; }
    .section-title { display: flex; align-items: center; justify-content: space-between; gap: 14px; padding: 22px 24px 0; }
    .settings-section { padding: 18px 24px 24px; }
    .settings-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; margin-top: 12px; }
    .setting-card, .template-card { display: grid; gap: 13px; border: 1px solid #dbe8e4; border-radius: 15px; padding: 15px; background: #fbfdfc; }
    .setting-card { grid-template-columns: minmax(180px, 1fr) auto; align-items: start; }
    .setting-card label:not(.switch), .setting-meta { grid-column: 1 / -1; }
    label { display: grid; gap: 7px; font-weight: 800; color: #465750; }
    input, select, textarea { width: 100%; box-sizing: border-box; border: 1px solid #d5e5e1; border-radius: 12px; padding: 11px 12px; font: inherit; background: #fff; color: #122033; }
    textarea { min-height: 118px; resize: vertical; line-height: 1.4; }
    .switch { display: inline-flex; align-items: center; justify-content: flex-end; }
    .switch input { display: none; }
    .switch span { width: 50px; height: 28px; border-radius: 999px; background: #1f2937; position: relative; transition: .2s ease; }
    .switch span::after { content: ''; position: absolute; width: 20px; height: 20px; top: 4px; right: 4px; border-radius: 50%; background: #fff; transition: .2s ease; }
    .switch input:not(:checked) + span { background: #b8c6c2; }
    .switch input:not(:checked) + span::after { right: 26px; }
    .switch.compact span { width: 44px; height: 25px; }
    .switch.compact span::after { width: 17px; height: 17px; }
    .segmented { display: inline-grid; grid-template-columns: repeat(3, 1fr); gap: 5px; padding: 5px; border-radius: 13px; background: #f0f6f4; }
    .segmented button { padding: 9px 12px; }
    .template-panel { padding-bottom: 24px; }
    .template-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; padding: 18px 24px 24px; }
    .template-head { display: flex; justify-content: space-between; gap: 12px; }
    .title-input { border: 0; border-bottom: 1px solid #d6e6e1; border-radius: 0; padding-left: 0; font-weight: 900; background: transparent; }
    .chips { display: flex; flex-wrap: wrap; gap: 8px; }
    .chips button { border: 1px solid #cfe6df; border-radius: 999px; background: #eefbf6; color: #047857; padding: 7px 10px; font-weight: 800; cursor: pointer; }
    .provider-map { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; color: #5f706c; }
    .provider-map b { background: #f4f7f6; border: 1px solid #dfe8e5; border-radius: 999px; padding: 7px 10px; color: #243447; }
    .preview-box { border: 1px dashed #b9d8ce; background: #f0fbf7; border-radius: 12px; padding: 12px; }
    .preview-box span { font-size: 12px; font-weight: 900; color: #047857; text-transform: uppercase; }
    .preview-box p { color: #122033; margin-top: 5px; }
    .warn { color: #b45309 !important; }
    .empty-state { display: grid; place-items: center; text-align: center; gap: 10px; min-height: 260px; color: #63736f; }
    .empty-state strong { color: #122033; font-size: 20px; }
    .history-panel { display: flex; align-items: center; justify-content: space-between; padding: 24px; gap: 20px; }
    .status-line { position: sticky; bottom: 14px; justify-self: start; background: #102033; color: #fff; border-radius: 999px; padding: 10px 14px; box-shadow: 0 10px 30px rgba(15, 23, 42, .2); }
    @media (max-width: 1200px) {
      .kpi-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); }
      .template-grid, .settings-grid { grid-template-columns: 1fr; }
    }
    @media (max-width: 760px) {
      .studio-page { padding: 12px; }
      .studio-hero, .history-panel, .section-title { align-items: flex-start; flex-direction: column; }
      .tab-rail, .kpi-grid { grid-template-columns: 1fr; }
    }
  `]
})
export class MessageTemplateStudioComponent implements OnInit {
  activeTab: 'settings' | 'sms' | 'whatsapp' | 'email' | 'history' = 'settings';
  audienceFilter: 'client' | 'admin' | 'staff' = 'client';
  summary: ApiRecord = {};
  templates: ApiRecord[] = [];
  sections: Array<{ key: string; title: string; rows: ApiRecord[] }> = [
    { key: 'client', title: 'Client Notifications', rows: [] },
    { key: 'admin', title: 'Admin Notifications', rows: [] },
    { key: 'staff', title: 'Staff Notifications', rows: [] }
  ];
  status = '';

  private readonly commonVariables = ['Name', 'Salon Name', 'Price', 'Balance', 'Date', 'Time', 'Service', 'Staff', 'Invoice No', 'Link', 'Points', 'Package', 'Giftcard', 'OTP'];

  constructor(private readonly api: ApiService) {}

  ngOnInit(): void {
    this.loadAll();
  }

  setTab(tab: 'settings' | 'sms' | 'whatsapp' | 'email' | 'history'): void {
    this.activeTab = tab;
  }

  loadAll(): void {
    this.status = 'Loading message templates...';
    this.api.list<StudioResponse>('message-templates', { limit: 500 }).subscribe({
      next: (response) => {
        this.summary = response.summary || {};
        this.templates = (response.templates || []).map((template) => ({ ...template, preview: '' }));
        this.loadPreferences();
      },
      error: (error) => this.status = this.api.errorText(error, 'Message templates load failed')
    });
  }

  loadPreferences(): void {
    this.api.list<PreferencesResponse>('message-templates/preferences').subscribe({
      next: (response) => {
        this.sections = response.sections || [];
        this.status = '';
      },
      error: (error) => this.status = this.api.errorText(error, 'Notification settings load failed')
    });
  }

  activeTabLabel(): string {
    if (this.activeTab === 'sms') return 'SMS Templates';
    if (this.activeTab === 'whatsapp') return 'WhatsApp Templates';
    return 'Email Templates';
  }

  visibleTemplates(): ApiRecord[] {
    return this.templates.filter((template) => template.channel === this.activeTab && template.audience === this.audienceFilter);
  }

  templatesForPreference(row: ApiRecord): ApiRecord[] {
    return this.templates.filter((template) => template.channel === row.channel && template.audience === row.audience);
  }

  variablesFor(template: ApiRecord): string[] {
    const fromTemplate = Array.isArray(template.variables) ? template.variables.map((item: unknown) => typeof item === 'string' ? item : String((item as ApiRecord)?.name || '')).filter(Boolean) : [];
    return Array.from(new Set([...fromTemplate, ...this.commonVariables])).slice(0, 14);
  }

  insertVariable(template: ApiRecord, variable: string): void {
    template.body = `${template.body || ''} {{${variable}}}`.trim();
    template.preview = '';
  }

  titleCase(value: string): string {
    return String(value || '').replace(/_/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase());
  }

  openTemplate(row: ApiRecord): void {
    const channel = String(row.channel || 'sms') as 'sms' | 'whatsapp' | 'email';
    this.activeTab = channel;
    this.audienceFilter = (row.audience || 'client') as 'client' | 'admin' | 'staff';
  }

  newTemplate(): void {
    const channel = this.activeTab === 'settings' || this.activeTab === 'history' ? 'sms' : this.activeTab;
    this.templates.unshift({
      id: '',
      name: `New ${channel.toUpperCase()} template`,
      templateKey: `custom_${channel}_${Date.now()}`,
      channel,
      audience: this.audienceFilter,
      eventKey: 'custom',
      body: 'Hi {{Name}}, message from {{Salon Name}}.',
      variables: ['Name', 'Salon Name'],
      enabled: true,
      preview: '',
      providerTemplateName: ''
    });
    this.activeTab = channel;
  }

  preview(template: ApiRecord): void {
    this.api.post<ApiRecord>('message-templates/preview', { body: template.body }).subscribe({
      next: (response) => template.preview = response.rendered || '',
      error: (error) => this.status = this.api.errorText(error, 'Preview failed')
    });
  }

  saveTemplate(template: ApiRecord): void {
    const payload = {
      name: template.name,
      templateKey: template.templateKey,
      channel: template.channel,
      audience: template.audience,
      eventKey: template.eventKey,
      body: template.body,
      variables: this.variablesFor(template),
      providerTemplateName: template.providerTemplateName || template.providerTemplateId || '',
      enabled: template.enabled !== false
    };
    const request = template.id
      ? this.api.put<ApiRecord>(`message-templates/${template.id}`, payload)
      : this.api.create<ApiRecord>('message-templates', payload);
    request.subscribe({
      next: (saved) => {
        Object.assign(template, saved, { preview: template.preview || '' });
        this.status = 'Template saved.';
        this.loadPreferences();
      },
      error: (error) => this.status = this.api.errorText(error, 'Template save failed')
    });
  }

  testSend(template: ApiRecord): void {
    if (!template.id) return;
    this.api.post<ApiRecord>(`message-templates/${template.id}/test-send`, { contact: 'test-recipient' }).subscribe({
      next: (response) => this.status = `Test message ${response.status || 'queued'} in history.`,
      error: (error) => this.status = this.api.errorText(error, 'Test send failed')
    });
  }

  savePreference(row: ApiRecord): void {
    this.api.put<PreferencesResponse>('message-templates/preferences', { preferences: [row] }).subscribe({
      next: (response) => {
        this.sections = response.sections || this.sections;
        this.status = 'Notification setting saved.';
      },
      error: (error) => this.status = this.api.errorText(error, 'Notification setting save failed')
    });
  }

  saveAllPreferences(): void {
    const preferences = this.sections.flatMap((section) => section.rows);
    this.api.put<PreferencesResponse>('message-templates/preferences', { preferences }).subscribe({
      next: (response) => {
        this.sections = response.sections || this.sections;
        this.status = 'Notification settings saved.';
      },
      error: (error) => this.status = this.api.errorText(error, 'Notification settings save failed')
    });
  }
}
