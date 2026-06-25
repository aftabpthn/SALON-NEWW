import { CommonModule } from '@angular/common';
import { Component, Input, OnChanges } from '@angular/core';
import { CommandCenterStore } from '../application/command-center.store';
import { CommandCenterModule } from '../domain/command-center.models';

@Component({
  selector: 'app-command-center-page',
  standalone: true,
  imports: [CommonModule],
  template: `
    <section class="command-center-page">
      <header class="cc-hero">
        <div>
          <p class="eyebrow">AI-native command center</p>
          <h1>{{ store.config().title }}</h1>
          <p>{{ store.config().subtitle }}</p>
        </div>
        <div class="cc-actions">
          <button type="button" class="cc-ghost" (click)="store.load()">Refresh</button>
          <button type="button" class="cc-primary" (click)="store.runAction()" [disabled]="store.saving() || !store.config().actionEndpoint || store.config().actionLabel === 'Await client'">
            {{ store.saving() ? 'Working...' : store.config().actionLabel }}
          </button>
        </div>
      </header>

      <section class="cc-metrics" aria-label="Command center metrics">
        <article *ngFor="let metric of store.metrics()" class="cc-metric-card" [class]="metric.tone">
          <span>{{ metric.label }}</span>
          <strong>{{ metric.value }}</strong>
        </article>
      </section>

      <div class="cc-state" *ngIf="store.loading()">Loading command intelligence...</div>
      <div class="cc-state cc-error" *ngIf="store.error()">{{ store.error() }}</div>

      <main class="cc-layout" *ngIf="!store.loading()">
        <section class="cc-panel">
          <div class="cc-panel-head">
            <h2>Live Records</h2>
            <span>{{ store.primary().length }} rows</span>
          </div>
          <div
            class="cc-record"
            *ngFor="let item of store.primary()"
            [class.selected]="isSelected(item)"
            (click)="store.selected.set(item)"
            (keydown.enter)="store.selected.set(item)"
            tabindex="0"
          >
            <div>
              <strong>{{ displayTitle(item) }}</strong>
              <span>{{ displayDescription(item) || displayMeta(item) }}</span>
            </div>
            <small [class]="riskTone(item)">{{ displayRisk(item) }}</small>
          </div>
          <div class="cc-empty" *ngIf="!store.primary().length && !store.error()">No records yet.</div>
        </section>

        <aside class="cc-panel cc-detail">
          <div class="cc-panel-head">
            <h2>{{ store.config().module === 'ai-workforce' ? 'Agent Detail' : 'Approval Detail' }}</h2>
            <span>{{ store.selected()?.status || 'ready' }}</span>
          </div>
          <ng-container *ngIf="store.selected() as selected; else noSelection">
            <div class="cc-detail-hero">
              <span>{{ store.config().module === 'ai-workforce' ? 'Selected agent' : 'Selected record' }}</span>
              <strong>{{ displayTitle(selected) }}</strong>
              <small [class]="riskTone(selected)">{{ displayRisk(selected) }}</small>
            </div>
            <p class="cc-detail-copy" *ngIf="displayDescription(selected)">{{ displayDescription(selected) }}</p>
            <dl class="cc-detail-grid">
              <div *ngFor="let field of detailFields(selected)">
                <dt>{{ field.label }}</dt>
                <dd>{{ field.value }}</dd>
              </div>
            </dl>
          </ng-container>
          <ng-template #noSelection>
            <div class="cc-empty cc-detail-empty">
              <strong>Select a record</strong>
              <span>Click any live record to inspect status, branch, version and approval context.</span>
            </div>
          </ng-template>
        </aside>
      </main>
    </section>
  `,
  styles: [`
    .command-center-page {
      display: grid; gap: 20px; padding: 28px 32px;
      background: #f5f6fb; min-height: 100%;
    }
    .cc-hero {
      display: flex; align-items: flex-start; justify-content: space-between; gap: 16px;
      background: #fff; border-radius: 14px; padding: 24px 28px;
      box-shadow: 0 1px 2px rgba(0,0,0,0.04), 0 1px 6px rgba(0,0,0,0.04);
    }
    .eyebrow { margin: 0 0 6px; color: #6b7c74; font-size: 11px; text-transform: uppercase; letter-spacing: 0.6px; font-weight: 700; }
    h1, h2, p { margin: 0; letter-spacing: 0; }
    h1 { font-size: 28px; color: #12231d; }
    .cc-hero p { max-width: 640px; color: #6b7c74; margin-top: 6px; font-size: 14px; line-height: 1.5; }
    .cc-actions { display: flex; gap: 8px; flex-shrink: 0; }
    .cc-actions button { border-radius: 8px; min-height: 38px; padding: 0 16px; cursor: pointer; font-weight: 700; font-size: 13px; transition: box-shadow 140ms ease, transform 140ms ease; }
    .cc-actions button:hover { transform: translateY(-1px); box-shadow: 0 4px 12px rgba(0,0,0,0.08); }
    .cc-primary { border: 0; background: #174f3a; color: #fff; }
    .cc-ghost { border: 1px solid #d9e5de; background: #fff; color: #2d3f38; }
    .cc-metrics {
      display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 14px;
    }
    .cc-metric-card {
      display: grid; gap: 6px; padding: 18px 20px;
      background: #fff; border-radius: 12px;
      box-shadow: 0 1px 2px rgba(0,0,0,0.04), 0 1px 6px rgba(0,0,0,0.04);
      border-top: 3px solid #d9e5de;
      transition: transform 200ms ease, box-shadow 200ms ease;
    }
    .cc-metric-card:hover { transform: translateY(-2px); box-shadow: 0 4px 16px rgba(0,0,0,0.06), 0 1px 4px rgba(0,0,0,0.04); }
    .cc-metric-card span { color: #6b7c74; font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.4px; }
    .cc-metric-card strong { font-size: 24px; color: #12231d; line-height: 1.2; }
    .cc-metric-card.critical { border-top-color: #d32f2f; }
    .cc-metric-card.warning { border-top-color: #f59e0b; }
    .cc-metric-card.good { border-top-color: #16a34a; }
    .cc-state { padding: 18px 22px; background: #fff; border-radius: 12px; color: #6b7c74; font-size: 14px; box-shadow: 0 1px 2px rgba(0,0,0,0.04); }
    .cc-error { border-left: 3px solid #d32f2f; color: #b71c1c; background: #fff; }
    .cc-layout {
      display: grid; grid-template-columns: minmax(0, 1.4fr) minmax(320px, .8fr); gap: 20px;
    }
    .cc-panel {
      display: grid; align-content: start; gap: 12px; padding: 20px;
      background: #fff; border-radius: 12px;
      box-shadow: 0 1px 2px rgba(0,0,0,0.04), 0 1px 6px rgba(0,0,0,0.04);
    }
    .cc-panel-head {
      display: flex; align-items: center; justify-content: space-between; gap: 12px;
      padding-bottom: 8px; border-bottom: 2px solid #edf2ef;
    }
    .cc-panel-head h2 { font-size: 16px; color: #12231d; }
    .cc-panel-head span { color: #6b7c74; font-size: 12px; font-weight: 700; }
    .cc-record {
      display: flex; justify-content: space-between; gap: 12px;
      border: 1px solid #edf2ef; border-radius: 10px; padding: 14px 16px;
      cursor: pointer; transition: border-color 140ms ease, box-shadow 140ms ease, transform 140ms ease;
    }
    .cc-record:hover, .cc-record.selected {
      border-color: #0f766e; box-shadow: 0 8px 22px rgba(15, 118, 110, 0.10); transform: translateY(-1px);
    }
    .cc-record div { display: grid; gap: 4px; }
    .cc-record strong { font-size: 14px; color: #12231d; }
    .cc-record span { color: #6b7c74; font-size: 12px; }
    .cc-record small { border-radius: 999px; background: #eef6f1; padding: 4px 10px; align-self: start; font-size: 11px; font-weight: 700; }
    .cc-record small.critical { background: #fde8e8; color: #b71c1c; }
    .cc-record small.warning { background: #fef3cd; color: #92400e; }
    .cc-record small.good { background: #dcfce7; color: #166534; }
    .cc-empty { padding: 18px 20px; color: #6b7c74; font-size: 13px; }
    .cc-detail { gap: 16px; }
    .cc-detail-hero {
      display: grid; gap: 6px; padding: 16px;
      border: 1px solid #edf2ef; border-radius: 10px; background: #f8fbfa;
    }
    .cc-detail-hero span, dt { color: #6b7c74; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.4px; }
    .cc-detail-hero strong { font-size: 18px; line-height: 1.2; color: #12231d; }
    .cc-detail-hero small { width: fit-content; border-radius: 999px; background: #eef6f1; padding: 4px 10px; font-size: 11px; font-weight: 700; }
    .cc-detail-copy { margin: 0; color: #425952; line-height: 1.5; font-size: 13px; }
    .cc-detail-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; margin: 0; }
    .cc-detail-grid div { display: grid; gap: 5px; padding: 12px; border: 1px solid #edf2ef; border-radius: 8px; background: #fafbfc; }
    dd { margin: 0; font-weight: 700; word-break: break-word; color: #12231d; font-size: 13px; }
    .cc-detail-empty { display: grid; gap: 6px; }
    @media (max-width: 920px) {
      .cc-hero, .cc-layout { grid-template-columns: 1fr; }
      .cc-metrics { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .cc-detail-grid { grid-template-columns: 1fr; }
      .command-center-page { padding: 16px; }
    }
  `]
})
export class CommandCenterPageComponent implements OnChanges {
  @Input({ required: true }) module!: CommandCenterModule;

  constructor(readonly store: CommandCenterStore) {}

  ngOnChanges(): void {
    if (this.module) this.store.setModule(this.module);
  }

  displayTitle(item: Record<string, unknown>): string {
    return String(
      item['agentName'] ||
      item['providerName'] ||
      item['pluginName'] ||
      item['franchiseName'] ||
      item['phone'] ||
      item['eventType'] ||
      item['aggregateType'] ||
      item['scenarioName'] ||
      item['actionType'] ||
      item['title'] ||
      item['summary'] ||
      item['leakType'] ||
      item['riskType'] ||
      item['kpiKey'] ||
      item['id'] ||
      'Record'
    );
  }

  displayMeta(item: Record<string, unknown>): string {
    return String(item['status'] || item['severity'] || item['riskLevel'] || item['createdAt'] || 'active');
  }

  displayDescription(item: Record<string, unknown>): string {
    return String(item['description'] || item['summary'] || item['actionText'] || item['recommendation'] || '');
  }

  displayRisk(item: Record<string, unknown>): string {
    return String(item['riskLevel'] || item['severity'] || item['status'] || 'normal');
  }

  riskTone(item: Record<string, unknown>): string {
    const risk = this.displayRisk(item);
    if (risk.includes('high') || risk.includes('critical')) return 'critical';
    if (risk.includes('pending') || risk.includes('medium')) return 'warning';
    return 'good';
  }

  isSelected(item: Record<string, unknown>): boolean {
    const selected = this.store.selected();
    return selected === item || (!!selected?.id && selected.id === item['id']);
  }

  detailFields(item: Record<string, unknown>): Array<{ label: string; value: string }> {
    const keys = [
      ['Agent type', 'agentType'],
      ['Agent key', 'agentKey'],
      ['Branch', 'branchId'],
      ['Tenant', 'tenantId'],
      ['Version', 'version'],
      ['Created', 'createdAt'],
      ['Updated', 'updatedAt']
    ];
    return keys
      .map(([label, key]) => ({ label, value: this.formatValue(item[key]) }))
      .filter((field) => field.value);
  }

  private formatValue(value: unknown): string {
    if (value === null || value === undefined || value === '') return '';
    if (typeof value === 'object') return JSON.stringify(value);
    return String(value);
  }
}
