import { CommonModule } from '@angular/common';
import { Component, OnInit, computed, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { finalize, forkJoin } from 'rxjs';
import { ApiRecord } from '../../../core/api.service';
import { ClientMastersApi } from '../data/client-masters.api';
import { ClientMasterKind, ClientMasterRecord, ClientMasterSummary } from '../domain/client-masters.models';

type FieldType = 'text' | 'number' | 'textarea' | 'select' | 'checkbox' | 'json' | 'color';

type FieldConfig = {
  key: string;
  label: string;
  type: FieldType;
  required?: boolean;
  defaultValue?: unknown;
  options?: Array<{ label: string; value: string }>;
  span?: 'full';
};

type MasterConfig = {
  kind: ClientMasterKind;
  label: string;
  plural: string;
  countKey: keyof ClientMasterSummary;
  helper: string;
  accent: 'blue' | 'green' | 'violet' | 'amber' | 'rose';
  fields: FieldConfig[];
};

const configs: MasterConfig[] = [
  {
    kind: 'categories',
    label: 'Client Category',
    plural: 'Client Categories',
    countKey: 'categories',
    helper: 'Client type, discount, loyalty multiplier, visit and spend thresholds.',
    accent: 'blue',
    fields: [
      { key: 'code', label: 'Short Code', type: 'text' },
      { key: 'name', label: 'Category Name', type: 'text', required: true },
      { key: 'description', label: 'Description', type: 'textarea', span: 'full' },
      { key: 'color', label: 'Color', type: 'color', defaultValue: '#2563eb' },
      { key: 'discountPercent', label: 'Discount %', type: 'number', defaultValue: 0 },
      { key: 'loyaltyMultiplier', label: 'Loyalty Multiplier', type: 'number', defaultValue: 1 },
      { key: 'visitThreshold', label: 'Visit Threshold', type: 'number', defaultValue: 0 },
      { key: 'spendThreshold', label: 'Spend Threshold', type: 'number', defaultValue: 0 },
      { key: 'hide', label: 'Hide', type: 'checkbox', defaultValue: false }
    ]
  },
  {
    kind: 'sources',
    label: 'Client Source',
    plural: 'Client Sources',
    countKey: 'sources',
    helper: 'Walk-in, referral, campaign, WhatsApp, website and marketplace source masters.',
    accent: 'green',
    fields: [
      { key: 'code', label: 'Short Code', type: 'text' },
      { key: 'name', label: 'Source Name', type: 'text', required: true },
      {
        key: 'sourceType',
        label: 'Source Type',
        type: 'select',
        defaultValue: 'walk_in',
        options: [
          { label: 'Walk in', value: 'walk_in' },
          { label: 'Referral', value: 'referral' },
          { label: 'WhatsApp', value: 'whatsapp' },
          { label: 'Instagram', value: 'instagram' },
          { label: 'Facebook', value: 'facebook' },
          { label: 'Google', value: 'google' },
          { label: 'Website', value: 'website' },
          { label: 'Campaign', value: 'campaign' },
          { label: 'Marketplace', value: 'marketplace' },
          { label: 'Corporate', value: 'corporate' },
          { label: 'Other', value: 'other' }
        ]
      },
      { key: 'defaultCampaignId', label: 'Default Campaign ID', type: 'text' },
      { key: 'attributionWindowDays', label: 'Attribution Window Days', type: 'number', defaultValue: 30 },
      { key: 'referralRequired', label: 'Referral Required', type: 'checkbox', defaultValue: false },
      { key: 'hide', label: 'Hide', type: 'checkbox', defaultValue: false },
      { key: 'notes', label: 'Notes', type: 'textarea', span: 'full' }
    ]
  },
  {
    kind: 'preferences',
    label: 'Preference / Risk',
    plural: 'Preferences & Risk Flags',
    countKey: 'preferences',
    helper: 'Allergies, communication choices, chemical risk and consent-driven profile flags.',
    accent: 'violet',
    fields: [
      { key: 'code', label: 'Short Code', type: 'text' },
      { key: 'name', label: 'Preference Name', type: 'text', required: true },
      {
        key: 'preferenceType',
        label: 'Preference Type',
        type: 'select',
        defaultValue: 'general',
        options: [
          { label: 'General', value: 'general' },
          { label: 'Allergy', value: 'allergy' },
          { label: 'Skin', value: 'skin' },
          { label: 'Hair', value: 'hair' },
          { label: 'Chemical', value: 'chemical' },
          { label: 'Communication', value: 'communication' },
          { label: 'Privacy', value: 'privacy' },
          { label: 'Medical', value: 'medical' },
          { label: 'Service', value: 'service' }
        ]
      },
      {
        key: 'riskLevel',
        label: 'Risk Level',
        type: 'select',
        defaultValue: 'none',
        options: [
          { label: 'None', value: 'none' },
          { label: 'Low', value: 'low' },
          { label: 'Medium', value: 'medium' },
          { label: 'High', value: 'high' }
        ]
      },
      { key: 'options', label: 'Options JSON', type: 'json', defaultValue: ['Yes', 'No'], span: 'full' },
      { key: 'consentRequired', label: 'Consent Required', type: 'checkbox', defaultValue: false },
      { key: 'hide', label: 'Hide', type: 'checkbox', defaultValue: false },
      { key: 'notes', label: 'Notes', type: 'textarea', span: 'full' }
    ]
  },
  {
    kind: 'consultation-templates',
    label: 'Consultation Template',
    plural: 'Consultation Templates',
    countKey: 'consultationTemplates',
    helper: 'Reusable consultation sections for hair, skin, bridal, chemical and wellness forms.',
    accent: 'amber',
    fields: [
      { key: 'code', label: 'Short Code', type: 'text' },
      { key: 'name', label: 'Template Name', type: 'text', required: true },
      {
        key: 'templateType',
        label: 'Template Type',
        type: 'select',
        defaultValue: 'general',
        options: [
          { label: 'General', value: 'general' },
          { label: 'Hair', value: 'hair' },
          { label: 'Skin', value: 'skin' },
          { label: 'Bridal', value: 'bridal' },
          { label: 'Chemical', value: 'chemical' },
          { label: 'Spa', value: 'spa' },
          { label: 'Wellness', value: 'wellness' },
          { label: 'Medical', value: 'medical' }
        ]
      },
      { key: 'validityDays', label: 'Validity Days', type: 'number', defaultValue: 180 },
      { key: 'sections', label: 'Sections JSON', type: 'json', defaultValue: [{ title: 'Client Concerns', fields: ['Concern', 'Sensitivity', 'Expected result'] }], span: 'full' },
      { key: 'consentRequired', label: 'Consent Required', type: 'checkbox', defaultValue: true },
      { key: 'hide', label: 'Hide', type: 'checkbox', defaultValue: false },
      { key: 'notes', label: 'Notes', type: 'textarea', span: 'full' }
    ]
  },
  {
    kind: 'feedback-definitions',
    label: 'Feedback Definition',
    plural: 'Feedback Definitions',
    countKey: 'feedbackDefinitions',
    helper: 'Rating questions, trigger event and score rules for visit and service feedback.',
    accent: 'rose',
    fields: [
      { key: 'code', label: 'Short Code', type: 'text' },
      { key: 'name', label: 'Feedback Name', type: 'text', required: true },
      {
        key: 'feedbackType',
        label: 'Feedback Type',
        type: 'select',
        defaultValue: 'service',
        options: [
          { label: 'Service', value: 'service' },
          { label: 'Visit', value: 'visit' },
          { label: 'Staff', value: 'staff' },
          { label: 'Product', value: 'product' },
          { label: 'Membership', value: 'membership' },
          { label: 'Package', value: 'package' },
          { label: 'Branch', value: 'branch' }
        ]
      },
      {
        key: 'triggerEvent',
        label: 'Trigger Event',
        type: 'select',
        defaultValue: 'visit_completed',
        options: [
          { label: 'Visit completed', value: 'visit_completed' },
          { label: 'Invoice paid', value: 'invoice_paid' },
          { label: 'Appointment completed', value: 'appointment_completed' },
          { label: 'Service completed', value: 'service_completed' },
          { label: 'Membership sold', value: 'membership_sold' },
          { label: 'Package sold', value: 'package_sold' }
        ]
      },
      { key: 'ratingScale', label: 'Rating Scale', type: 'number', defaultValue: 5 },
      { key: 'questions', label: 'Questions JSON', type: 'json', defaultValue: [{ label: 'How was the service?', type: 'rating', required: true }], span: 'full' },
      { key: 'scoreRules', label: 'Score Rules JSON', type: 'json', defaultValue: { detractorBelow: 3, promoterAbove: 4 }, span: 'full' },
      { key: 'hide', label: 'Hide', type: 'checkbox', defaultValue: false },
      { key: 'notes', label: 'Notes', type: 'textarea', span: 'full' }
    ]
  }
];

const emptyRecords: Record<ClientMasterKind, ClientMasterRecord[]> = {
  categories: [],
  sources: [],
  preferences: [],
  'consultation-templates': [],
  'feedback-definitions': []
};

@Component({
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  template: `
    <section class="client-masters-page">
      <header class="topbar">
        <div>
          <p class="eyebrow">Client CRM Masters</p>
          <h1>Client Masters</h1>
          <p class="lead">Flexi-style client master setup for categories, sources, preferences, consultation forms and feedback definitions.</p>
        </div>
        <div class="topbar-actions">
          <a class="secondary" routerLink="/clients">Client CRM</a>
          <a class="secondary" routerLink="/customer-360">Customer 360</a>
          <button type="button" class="secondary" (click)="load()">Refresh</button>
        </div>
      </header>

      <section class="metrics" aria-label="Client master metrics">
        <article>
          <span>Client Profiles</span>
          <strong>{{ summary().clientProfiles }}</strong>
        </article>
        <article *ngFor="let config of configs" [class]="config.accent">
          <span>{{ config.plural }}</span>
          <strong>{{ summary()[config.countKey] }}</strong>
        </article>
      </section>

      <div *ngIf="loading()" class="state">Loading client master workspace...</div>
      <div *ngIf="error()" class="state error">{{ error() }}</div>

      <nav class="master-tabs" aria-label="Client master sections">
        <button
          type="button"
          *ngFor="let config of configs"
          [class.active]="activeKind() === config.kind"
          [class]="config.accent"
          (click)="switchKind(config.kind)"
        >
          <span>{{ initials(config.label) }}</span>
          <strong>{{ config.plural }}</strong>
          <small>{{ summary()[config.countKey] }} live</small>
        </button>
      </nav>

      <section class="workspace">
        <aside class="list-panel">
          <div class="panel-heading">
            <div>
              <p class="eyebrow">{{ activeConfig().label }}</p>
              <h2>{{ activeConfig().plural }}</h2>
            </div>
            <button type="button" class="primary" (click)="newRecord()">Add</button>
          </div>
          <p class="helper">{{ activeConfig().helper }}</p>
          <label class="search">
            <span>Search</span>
            <input [ngModel]="query()" (ngModelChange)="query.set($event)" placeholder="Name, code, type" />
          </label>

          <div class="record-list" *ngIf="visibleRows().length; else emptyList">
            <button
              type="button"
              class="record-row"
              *ngFor="let row of visibleRows()"
              [class.active]="selectedId() === row.id"
              (click)="select(row)"
            >
              <span class="swatch" [style.background]="recordColor(row)"></span>
              <strong>{{ row.name }}</strong>
              <small>{{ row.code }} / {{ recordMeta(row) }}</small>
              <em [class.archived]="row.status === 'archived' || row.hide">{{ row.hide ? 'hidden' : row.status }}</em>
            </button>
          </div>
          <ng-template #emptyList>
            <div class="empty-state">
              <strong>No records yet</strong>
              <span>Add the first {{ activeConfig().label.toLowerCase() }} for this tenant or branch.</span>
            </div>
          </ng-template>
        </aside>

        <main class="editor-panel">
          <div class="panel-heading">
            <div>
              <p class="eyebrow">{{ selectedId() ? 'Edit Master' : 'New Master' }}</p>
              <h2>{{ selectedId() ? selectedName() : activeConfig().label }}</h2>
            </div>
            <span class="version" *ngIf="selectedId()">v{{ selectedVersion() }}</span>
          </div>

          <div class="form-grid">
            <label *ngFor="let field of activeConfig().fields" [class.full]="field.span === 'full'" [class.checkbox-field]="field.type === 'checkbox'">
              <span>{{ field.label }}</span>
              <ng-container [ngSwitch]="field.type">
                <textarea *ngSwitchCase="'textarea'" rows="4" [ngModel]="formValue(field.key)" (ngModelChange)="setField(field.key, $event)"></textarea>
                <textarea *ngSwitchCase="'json'" rows="6" [ngModel]="formValue(field.key)" (ngModelChange)="setField(field.key, $event)"></textarea>
                <select *ngSwitchCase="'select'" [ngModel]="formValue(field.key)" (ngModelChange)="setField(field.key, $event)">
                  <option *ngFor="let option of field.options || []" [value]="option.value">{{ option.label }}</option>
                </select>
                <input *ngSwitchCase="'number'" type="number" [ngModel]="formValue(field.key)" (ngModelChange)="setField(field.key, toNumber($event))" />
                <input *ngSwitchCase="'color'" type="color" [ngModel]="formValue(field.key)" (ngModelChange)="setField(field.key, $event)" />
                <input *ngSwitchCase="'checkbox'" type="checkbox" [ngModel]="formValue(field.key)" (ngModelChange)="setField(field.key, $event)" />
                <input *ngSwitchDefault [ngModel]="formValue(field.key)" (ngModelChange)="setField(field.key, $event)" />
              </ng-container>
            </label>
          </div>

          <div class="state error" *ngIf="saveError()">{{ saveError() }}</div>

          <footer class="actions">
            <button type="button" class="secondary" (click)="resetEditor()">Cancel</button>
            <button type="button" class="secondary danger" *ngIf="selected()" (click)="archiveOrRestore()">
              {{ isArchived() ? 'Restore' : 'Archive' }}
            </button>
            <button type="button" class="primary" [disabled]="saving()" (click)="save()">{{ saving() ? 'Saving...' : 'Save Master' }}</button>
          </footer>
        </main>
      </section>
    </section>
  `,
  styles: [`
    .client-masters-page { color: var(--ink); display: grid; gap: 18px; padding: 24px; }
    .topbar { align-items: flex-start; display: flex; gap: 16px; justify-content: space-between; }
    .topbar-actions, .actions { align-items: center; display: flex; flex-wrap: wrap; gap: 10px; justify-content: flex-end; }
    .eyebrow { color: var(--muted); font-size: 12px; font-weight: 850; letter-spacing: .08em; margin: 0 0 5px; text-transform: uppercase; }
    h1, h2 { letter-spacing: 0; margin: 0; }
    h1 { font-size: 30px; }
    h2 { font-size: 20px; }
    .lead, .helper { color: var(--muted); line-height: 1.55; margin: 8px 0 0; max-width: 760px; }
    .primary, .secondary { border: 1px solid var(--line); border-radius: 8px; cursor: pointer; font-weight: 850; min-height: 38px; padding: 9px 14px; text-decoration: none; transition: background 0.12s, border-color 0.12s; }
    .primary { background: var(--ink); border-color: var(--ink); color: var(--surface); }
    .primary:hover { opacity: 0.88; }
    .primary:disabled { opacity: 0.4; cursor: not-allowed; }
    .secondary { background: var(--surface); color: var(--ink); }
    .secondary:hover { border-color: var(--muted); }
    .danger { color: var(--red); }
    .metrics { display: grid; grid-template-columns: repeat(6, minmax(130px, 1fr)); gap: 12px; }
    .metrics article, .state, .list-panel, .editor-panel, .empty-state { background: var(--surface); border: 1px solid var(--line); border-radius: 10px; }
    .metrics article { min-height: 98px; padding: 14px; box-shadow: var(--shadow); }
    .metrics span { color: var(--muted); display: block; font-size: 12px; font-weight: 850; text-transform: uppercase; }
    .metrics strong { display: block; font-size: 26px; margin-top: 10px; }
    .metrics .blue { border-top: 3px solid var(--blue); }
    .metrics .green { border-top: 3px solid var(--green); }
    .metrics .violet { border-top: 3px solid var(--violet); }
    .metrics .amber { border-top: 3px solid var(--amber); }
    .metrics .rose { border-top: 3px solid var(--rose); }
    .state { color: var(--muted); padding: 14px; }
    .state.error { color: var(--red); border-color: #f2b8b5; background: #fff8f8; }
    .master-tabs { display: grid; grid-template-columns: repeat(5, minmax(150px, 1fr)); gap: 10px; }
    .master-tabs button { background: var(--surface); border: 1px solid var(--line); border-radius: 10px; color: var(--ink); cursor: pointer; display: grid; gap: 6px; min-height: 112px; padding: 14px; text-align: left; transition: border-color 0.12s, box-shadow 0.12s; }
    .master-tabs button:hover { border-color: var(--muted); }
    .master-tabs button.active { border-color: var(--ink); box-shadow: inset 0 0 0 1px var(--ink); }
    .master-tabs span, .swatch { align-items: center; border-radius: 8px; display: inline-flex; font-size: 12px; font-weight: 900; height: 34px; justify-content: center; width: 42px; }
    .master-tabs small { color: var(--muted); font-weight: 750; }
    .master-tabs .blue span { background: #eff6ff; color: #1d4ed8; }
    .master-tabs .green span { background: #edf7ef; color: #15803d; }
    .master-tabs .violet span { background: #f3efff; color: #6d28d9; }
    .master-tabs .amber span { background: #fff7e6; color: #a16207; }
    .master-tabs .rose span { background: #fff1f2; color: #be123c; }
    .workspace { align-items: stretch; display: grid; grid-template-columns: minmax(320px, .82fr) minmax(560px, 1.18fr); gap: 16px; }
    .list-panel, .editor-panel { display: grid; gap: 14px; padding: 16px; box-shadow: var(--elev-1); }
    .panel-heading { align-items: flex-start; display: flex; gap: 12px; justify-content: space-between; }
    .search, .form-grid label { color: var(--ink); display: grid; font-size: 13px; font-weight: 850; gap: 7px; }
    input, select, textarea { background: var(--surface); border: 1px solid var(--line); border-radius: 8px; color: var(--ink); font: inherit; padding: 10px 11px; width: 100%; transition: border-color 0.12s; }
    input:focus, select:focus, textarea:focus { outline: none; border-color: var(--teal); box-shadow: var(--ring-brand); }
    input[type='checkbox'] { height: 18px; padding: 0; width: 18px; }
    input[type='color'] { height: 42px; padding: 4px; }
    .record-list { border: 1px solid var(--line); border-radius: 10px; display: grid; overflow: hidden; }
    .record-row { align-items: center; background: var(--surface); border: 0; border-top: 1px solid var(--surface-2); color: var(--ink); cursor: pointer; display: grid; gap: 4px 10px; grid-template-columns: 48px 1fr auto; min-height: 70px; padding: 11px 12px; text-align: left; transition: background 0.1s; }
    .record-row:first-child { border-top: 0; }
    .record-row:hover { background: var(--surface-2); }
    .record-row.active { background: color-mix(in oklch, var(--teal) 6%, var(--surface)); }
    .record-row strong { font-size: 14px; }
    .record-row small { color: var(--muted); grid-column: 2 / 3; }
    .record-row em { border: 1px solid var(--line); border-radius: 999px; color: var(--green); font-size: 11px; font-style: normal; font-weight: 850; padding: 4px 8px; text-transform: uppercase; }
    .record-row em.archived { color: var(--red); }
    .swatch { grid-row: 1 / span 2; border-radius: 8px; }
    .empty-state { color: var(--muted); display: grid; gap: 6px; padding: 18px; box-shadow: var(--elev-1); }
    .empty-state strong { color: var(--ink); }
    .form-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; }
    .form-grid label.full { grid-column: 1 / -1; }
    .checkbox-field { align-items: center; display: flex !important; min-height: 42px; gap: 10px; }
    .checkbox-field span { order: 2; }
    .version { align-self: center; background: var(--surface-2); border-radius: 999px; color: var(--muted); font-size: 12px; font-weight: 850; padding: 6px 10px; }
    .actions { border-top: 1px solid var(--surface-2); padding-top: 14px; }
    @media (max-width: 1180px) { .metrics, .master-tabs { grid-template-columns: repeat(3, minmax(0, 1fr)); } .workspace { grid-template-columns: 1fr; } }
    @media (max-width: 720px) {
      .client-masters-page { padding: 16px; }
      .topbar, .panel-heading { display: grid; }
      .metrics, .master-tabs, .form-grid { grid-template-columns: 1fr; }
      .record-row { grid-template-columns: 44px 1fr; }
      .record-row em { grid-column: 2; justify-self: start; }
    }
  `]
})
export class ClientMastersPage implements OnInit {
  readonly configs = configs;
  readonly activeKind = signal<ClientMasterKind>('categories');
  readonly records = signal<Record<ClientMasterKind, ClientMasterRecord[]>>({ ...emptyRecords });
  readonly summary = signal<ClientMasterSummary>({
    clientProfiles: 0,
    categories: 0,
    sources: 0,
    preferences: 0,
    consultationTemplates: 0,
    feedbackDefinitions: 0
  });
  readonly loading = signal(false);
  readonly saving = signal(false);
  readonly error = signal('');
  readonly saveError = signal('');
  readonly query = signal('');
  readonly selectedId = signal('');
  readonly form = signal<ApiRecord>({});

  readonly activeConfig = computed(() => this.configs.find((config) => config.kind === this.activeKind()) || this.configs[0]);
  readonly activeRows = computed(() => this.records()[this.activeKind()] || []);
  readonly visibleRows = computed(() => {
    const term = this.query().trim().toLowerCase();
    return this.activeRows().filter((row) => {
      const haystack = `${row.name} ${row.code} ${this.recordMeta(row)} ${row.status}`.toLowerCase();
      return !term || haystack.includes(term);
    });
  });

  constructor(private readonly api: ClientMastersApi) {}

  ngOnInit(): void {
    this.resetEditor();
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.error.set('');
    forkJoin({
      summary: this.api.summary(),
      categories: this.api.list('categories', { includeArchived: 'true', limit: 1000 }),
      sources: this.api.list('sources', { includeArchived: 'true', limit: 1000 }),
      preferences: this.api.list('preferences', { includeArchived: 'true', limit: 1000 }),
      consultation: this.api.list('consultation-templates', { includeArchived: 'true', limit: 1000 }),
      feedback: this.api.list('feedback-definitions', { includeArchived: 'true', limit: 1000 })
    }).pipe(finalize(() => this.loading.set(false))).subscribe({
      next: ({ summary, categories, sources, preferences, consultation, feedback }) => {
        this.summary.set(summary);
        this.records.set({
          categories,
          sources,
          preferences,
          'consultation-templates': consultation,
          'feedback-definitions': feedback
        });
        this.reselect();
      },
      error: (error: unknown) => this.error.set(this.apiError(error, 'Unable to load client masters'))
    });
  }

  switchKind(kind: ClientMasterKind): void {
    this.activeKind.set(kind);
    this.query.set('');
    this.resetEditor();
  }

  newRecord(): void {
    this.resetEditor();
  }

  select(row: ClientMasterRecord): void {
    this.selectedId.set(row.id);
    const next: ApiRecord = {};
    for (const field of this.activeConfig().fields) {
      const value = (row as ApiRecord)[field.key];
      next[field.key] = field.type === 'json' ? JSON.stringify(value ?? field.defaultValue ?? [], null, 2) : value ?? field.defaultValue ?? '';
    }
    this.form.set(next);
    this.saveError.set('');
  }

  selected(): ClientMasterRecord | undefined {
    return this.activeRows().find((row) => row.id === this.selectedId());
  }

  selectedName(): string {
    return this.selected()?.name || this.activeConfig().label;
  }

  selectedVersion(): number {
    return this.selected()?.version || 1;
  }

  isArchived(): boolean {
    const selected = this.selected();
    return Boolean(selected?.hide || selected?.status === 'archived');
  }

  resetEditor(): void {
    this.selectedId.set('');
    const next: ApiRecord = {};
    for (const field of this.activeConfig().fields) {
      const value = field.defaultValue ?? (field.type === 'checkbox' ? false : '');
      next[field.key] = field.type === 'json' ? JSON.stringify(value, null, 2) : value;
    }
    this.form.set(next);
    this.saveError.set('');
  }

  formValue(key: string): unknown {
    return this.form()[key];
  }

  setField(key: string, value: unknown): void {
    this.form.update((current) => ({ ...current, [key]: value }));
  }

  save(): void {
    const selected = this.selected();
    const payload = this.payloadFromForm();
    if (!payload) return;
    this.saving.set(true);
    this.saveError.set('');
    const request = selected
      ? this.api.update(this.activeKind(), selected.id, { ...payload, version: selected.version })
      : this.api.create(this.activeKind(), payload);
    request.pipe(finalize(() => this.saving.set(false))).subscribe({
      next: (row: ClientMasterRecord) => {
        this.upsertRow(row);
        this.selectedId.set(row.id);
        this.select(row);
        this.refreshSummary();
      },
      error: (error: unknown) => this.saveError.set(this.apiError(error, 'Unable to save client master'))
    });
  }

  archiveOrRestore(): void {
    const selected = this.selected();
    if (!selected) return;
    this.saving.set(true);
    this.saveError.set('');
    const archived = this.isArchived();
    this.api.updateStatus(this.activeKind(), selected.id, {
      version: selected.version,
      status: archived ? 'active' : 'archived',
      hide: !archived
    }).pipe(finalize(() => this.saving.set(false))).subscribe({
      next: (row: ClientMasterRecord) => {
        this.upsertRow(row);
        this.select(row);
        this.refreshSummary();
      },
      error: (error: unknown) => this.saveError.set(this.apiError(error, 'Unable to change status'))
    });
  }

  payloadFromForm(): ApiRecord | null {
    const raw = this.form();
    const payload: ApiRecord = {};
    for (const field of this.activeConfig().fields) {
      const value = raw[field.key];
      if (field.required && String(value || '').trim() === '') {
        this.saveError.set(`${field.label} is required`);
        return null;
      }
      if (field.type === 'json') {
        try {
          payload[field.key] = JSON.parse(String(value || 'null'));
        } catch {
          this.saveError.set(`${field.label} must be valid JSON`);
          return null;
        }
      } else if (field.type === 'number') {
        payload[field.key] = this.toNumber(value);
      } else if (field.type === 'checkbox') {
        payload[field.key] = Boolean(value);
      } else {
        payload[field.key] = value;
      }
    }
    return payload;
  }

  refreshSummary(): void {
    this.api.summary().subscribe({
      next: (summary: ClientMasterSummary) => this.summary.set(summary),
      error: () => undefined
    });
  }

  upsertRow(row: ClientMasterRecord): void {
    const kind = this.activeKind();
    this.records.update((current) => {
      const existing = current[kind] || [];
      const rows = existing.some((item) => item.id === row.id)
        ? existing.map((item) => item.id === row.id ? row : item)
        : [row, ...existing];
      return { ...current, [kind]: rows };
    });
  }

  reselect(): void {
    const selected = this.selected();
    if (selected) this.select(selected);
  }

  recordMeta(row: ClientMasterRecord): string {
    const record = row as ApiRecord;
    return record['sourceType'] || record['preferenceType'] || record['templateType'] || record['feedbackType'] || `${record['discountPercent'] ?? 0}%`;
  }

  recordColor(row: ClientMasterRecord): string {
    return String((row as ApiRecord)['color'] || '#e2e8f0');
  }

  initials(value: string): string {
    return value.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('');
  }

  toNumber(value: unknown): number {
    const parsed = Number(value || 0);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  apiError(error: unknown, fallback: string): string {
    const err = error as { error?: { error?: unknown; message?: unknown }; message?: unknown };
    const nested = err?.error?.error;
    if (typeof nested === 'string') return nested;
    if (nested && typeof nested === 'object' && 'message' in nested) return String((nested as { message?: unknown }).message || fallback);
    if (typeof err?.error?.message === 'string') return err.error.message;
    if (typeof err?.message === 'string') return err.message;
    return fallback;
  }
}
