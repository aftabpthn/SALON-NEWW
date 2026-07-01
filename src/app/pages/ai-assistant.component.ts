import { CommonModule, CurrencyPipe, DatePipe } from '@angular/common';
import { Component, OnInit, computed, signal } from '@angular/core';
import { FormsModule, ReactiveFormsModule, UntypedFormBuilder, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ApiRecord, ApiService } from '../core/api.service';
import { StateComponent } from '../shared/ui/state/state.component';

type AiTool = {
  id: string;
  taskKey: string;
  title: string;
  category: string;
  icon: string;
  tier: 'fast' | 'smart' | 'governed';
  description: string;
  prompt: string;
  requires?: Array<'client' | 'service' | 'staff' | 'branch' | 'startAt' | 'review' | 'channel' | 'offer' | 'product' | 'cart'>;
};

@Component({
  selector: 'app-ai-assistant',
  standalone: true,
  imports: [CommonModule, FormsModule, ReactiveFormsModule, RouterLink, CurrencyPipe, DatePipe, StateComponent],
  template: `
    <section class="page-stack ai-command-page">
      <div class="ai-hero">
        <div class="hero-orbit one"></div>
        <div class="hero-orbit two"></div>
        <div class="hero-copy">
          <span class="eyebrow">Assistant</span>
          <h2>AI Business Assistant</h2>
          <p>Run governed AI workflows across client CRM, bookings, POS, inventory, marketing and reviews without changing source operations.</p>
          <div class="hero-signal-row">
            <span>{{ tools.length }} live workflows</span>
            <span>{{ history().length }} saved interactions</span>
            <span>{{ observability()?.callsToday || 0 }} calls today</span>
            <span>{{ modelMode() }}</span>
          </div>
        </div>
        <div class="hero-actions">
          <button class="ghost-button" type="button" (click)="load()">Refresh context</button>
          <a class="dark-button" routerLink="/command-center/ai-workforce-dashboard">Workforce tools</a>
          <a class="primary-button" routerLink="/knowledge-base">Knowledge base</a>
        </div>
      </div>

      <app-state [loading]="loading()" [error]="error()"></app-state>

      <div class="ai-kpi-grid" *ngIf="!loading()">
        <article class="ai-kpi">
          <span>Tenant data context</span>
          <strong>{{ clients().length + services().length + staff().length + products().length }}</strong>
          <small>{{ clients().length }} clients - {{ services().length }} services - {{ staff().length }} staff - {{ products().length }} products</small>
        </article>
        <article class="ai-kpi">
          <span>Review controls</span>
          <strong>{{ governance()?.enabled === false ? 'Paused' : 'Active' }}</strong>
          <small>{{ governance()?.usage?.callsRemaining ?? 0 }} calls left - {{ (governance()?.usage?.costRemainingUsd || 0) | currency:'USD':'symbol':'1.2-2' }} budget left</small>
        </article>
        <article class="ai-kpi">
          <span>Observability</span>
          <strong>{{ observability()?.cacheHitRate || 0 }}%</strong>
          <small>{{ observability()?.fallbackCallsToday || 0 }} local fallback - {{ observability()?.averageLatencyMs || 0 }}ms avg latency</small>
        </article>
        <article class="ai-kpi">
          <span>Human review queue</span>
          <strong>{{ reviewQueueCount() }}</strong>
          <small>{{ whatsappDrafts().length }} WhatsApp drafts - {{ automationSuggestions().length }} automation suggestions</small>
        </article>
      </div>

      <div class="ai-workspace-grid" *ngIf="!loading()">
        <div class="ai-left-stack">
        <section class="panel workflow-panel">
          <div class="section-title workflow-router-head">
            <div>
              <span class="eyebrow">Workflow router</span>
              <h2>Open a workflow</h2>
            </div>
            <span class="panel-count">{{ filteredTools().length }} shown</span>
          </div>

          <label class="ai-search">
            <span>Search workflow</span>
            <input [ngModel]="toolQuery()" (ngModelChange)="toolQuery.set($event)" placeholder="client churn, POS, inventory, WhatsApp..." />
          </label>

          <div class="category-tabs">
            <button type="button" *ngFor="let category of categoryPills()" [class.active]="activeCategory() === category.label" (click)="activeCategory.set(category.label)">
              {{ category.label }} <small>{{ category.count }}</small>
            </button>
          </div>

          <div class="workflow-list">
            <button
              type="button"
              class="workflow-card"
              *ngFor="let tool of filteredTools()"
              [class.active]="activeTool() === tool.id"
              [class.disabled]="!taskEnabled(tool)"
              (click)="selectTool(tool.id)"
            >
              <span class="workflow-icon">{{ tool.icon }}</span>
              <span class="workflow-copy">
                <span class="workflow-card-topline">
                  <strong>{{ tool.title }}</strong>
                  <em>{{ tool.tier }}</em>
                </span>
                <small>{{ tool.description }}</small>
                <span class="workflow-card-footer">
                  <span>{{ tool.category }}</span>
                  <b>{{ activeTool() === tool.id ? 'Opened' : 'Open workflow' }}</b>
                </span>
              </span>
            </button>
          </div>
        </section>
        </div>

        <div class="ai-main-stack">
        <section class="panel command-panel">
          <div class="command-header">
            <div class="command-title-row">
              <span class="workflow-icon command-workflow-icon">{{ selectedTool()?.icon || 'AI' }}</span>
              <div>
                <span class="eyebrow">{{ selectedTool()?.category }}</span>
                <h2>{{ selectedTool()?.title || 'Select workflow' }}</h2>
                <p>{{ selectedTool()?.description }}</p>
              </div>
            </div>
            <div class="task-badges">
              <span>{{ activeTaskKey() }}</span>
              <span [class.warn]="!taskEnabled(selectedTool())">{{ taskEnabled(selectedTool()) ? 'Policy allowed' : 'Policy disabled' }}</span>
              <span>Human review</span>
            </div>
          </div>

          <form [formGroup]="form" (ngSubmit)="run()" class="enterprise-form">
            <label class="field full">
              <span>Instruction</span>
              <textarea formControlName="prompt" [placeholder]="selectedTool()?.prompt || 'Ask what to do next'"></textarea>
            </label>

            <label class="field" *ngIf="requires('client')">
              <span>Client context</span>
              <select formControlName="clientId">
                <option value="">Select client</option>
                <option *ngFor="let client of clients()" [value]="client.id">{{ client.name }} - {{ client.phone || 'No phone' }}</option>
              </select>
            </label>

            <label class="field" *ngIf="requires('service') || requires('cart')">
              <span>Service / cart</span>
              <select formControlName="serviceId">
                <option value="">Select service</option>
                <option *ngFor="let service of services()" [value]="service.id">{{ service.name }} - {{ service.price | currency:'INR':'symbol':'1.0-0' }}</option>
              </select>
            </label>

            <label class="field" *ngIf="requires('product')">
              <span>Inventory product</span>
              <select formControlName="productId">
                <option value="">Choose priority stock</option>
                <option *ngFor="let product of products()" [value]="product.id">{{ product.name }} - {{ product.stock || 0 }}</option>
              </select>
            </label>

            <label class="field" *ngIf="requires('branch')">
              <span>Branch</span>
              <select formControlName="branchId">
                <option value="">Current scope</option>
                <option *ngFor="let branch of branches()" [value]="branch.id">{{ branch.name }}</option>
              </select>
            </label>

            <label class="field" *ngIf="requires('staff')">
              <span>Staff</span>
              <select formControlName="staffId">
                <option value="">All staff</option>
                <option *ngFor="let person of staff()" [value]="person.id">{{ person.name }}</option>
              </select>
            </label>

            <label class="field" *ngIf="requires('startAt')">
              <span>Target time</span>
              <input type="datetime-local" formControlName="startAt" />
            </label>

            <label class="field" *ngIf="requires('review')">
              <span>Review rating</span>
              <input type="number" min="1" max="5" formControlName="rating" />
            </label>

            <label class="field full" *ngIf="requires('review')">
              <span>Review text</span>
              <textarea formControlName="reviewText" placeholder="Paste the client review here"></textarea>
            </label>

            <label class="field" *ngIf="requires('channel')">
              <span>Channel</span>
              <select formControlName="channel">
                <option>WhatsApp</option>
                <option>SMS</option>
                <option>Email</option>
                <option>Instagram</option>
              </select>
            </label>

            <label class="field" *ngIf="requires('offer')">
              <span>Offer / campaign</span>
              <input formControlName="offer" placeholder="Weekend glow package, bridal upsell, win-back offer" />
            </label>

            <div class="safety-strip full">
              <span>Draft-first mode</span>
              <strong>No auto-send. No auto-discount. No inventory mutation from this assistant screen.</strong>
              <small>POS, appointment, WhatsApp and inventory confirmations stay unchanged.</small>
            </div>

            <div class="form-actions full">
              <button class="ghost-button" type="button" (click)="selectTool(activeTool())">Reset prompt</button>
              <button class="primary-button" type="submit" [disabled]="running() || form.invalid || !taskEnabled(selectedTool())">
                {{ running() ? 'Running...' : 'Run workflow' }}
              </button>
            </div>
          </form>
        </section>
        <section class="panel output-panel">
          <div class="section-title">
            <div>
              <span class="eyebrow">Decision output</span>
              <h2>{{ outputTitle() }}</h2>
            </div>
            <span class="badge" *ngIf="result()?.interaction">Saved interaction</span>
          </div>

          <div class="ai-output" *ngIf="result()?.output as output; else emptyOutput">
            <div class="answer-card">
              <span>Recommended response</span>
              <strong>{{ outputSummary(output) }}</strong>
              <p *ngIf="output.reason">{{ output.reason }}</p>
              <p *ngIf="output.providerWarning" class="warning-text">{{ output.providerWarning }}</p>
            </div>

            <div class="source-strip" *ngIf="knowledgeSources(output).length">
              <article *ngFor="let source of knowledgeSources(output)">
                <span>Source</span>
                <strong>{{ source.title || source }}</strong>
                <small>{{ source.excerpt || source.category || 'Knowledge base' }}</small>
              </article>
            </div>

            <div class="result-metrics">
              <article *ngFor="let metric of outputMetrics(output)">
                <span>{{ metric.label }}</span>
                <strong>{{ metric.value }}</strong>
              </article>
            </div>

            <div class="quick-grid" *ngIf="primaryList(output).length">
              <article class="action-card" *ngFor="let item of primaryList(output)">
                <strong>{{ item.name || item.title || item.clientName || item.recommendedAction || item.id }}</strong>
                <span>{{ item.reason || item.message || item.category || item.type || item.value }}</span>
                <small *ngIf="item.price">{{ item.price | currency:'INR':'symbol':'1.0-0' }}</small>
                <small *ngIf="item.score !== undefined">Score {{ item.score }}</small>
              </article>
            </div>

            <div class="approval-checklist">
              <article>
                <span>1</span>
                <strong>Review tone and policy</strong>
                <small>Owner or manager checks text before customer-facing use.</small>
              </article>
              <article>
                <span>2</span>
                <strong>Confirm operational action</strong>
                <small>Booking, POS, discount, stock and WhatsApp execution stay in their source workflows.</small>
              </article>
              <article>
                <span>3</span>
                <strong>Audit trail saved</strong>
                <small>Interaction, model, confidence and context snapshot are persisted.</small>
              </article>
            </div>

            <details class="raw-json">
              <summary>Audit JSON</summary>
              <pre>{{ output | json }}</pre>
            </details>
          </div>

          <ng-template #emptyOutput>
            <div class="empty-command">
              <strong>Select a workflow and run it.</strong>
              <span>The result will appear here with human-review guardrails and a persisted audit trail.</span>
            </div>
          </ng-template>
        </section>
        </div>

        <div class="ai-side-stack">
        <section class="panel governance-panel">
          <div class="section-title">
            <div>
              <span class="eyebrow">Governance rail</span>
              <h2>Governance rail</h2>
            </div>
          </div>
          <div class="governance-stack">
            <article>
              <span>Provider mode</span>
              <strong>{{ modelMode() }}</strong>
              <small>{{ observability()?.providerStatus?.openaiConfigured ? 'External provider configured' : 'Local business-rule fallback active' }}</small>
            </article>
            <article>
              <span>Daily limit</span>
              <strong>{{ governance()?.usage?.callsToday || 0 }} / {{ governance()?.dailyCallLimit || 0 }}</strong>
              <small>{{ (governance()?.usage?.costTodayUsd || 0) | currency:'USD':'symbol':'1.2-2' }} spent today</small>
            </article>
            <article>
              <span>Policy denials</span>
              <strong>{{ observability()?.policyDenialsToday || 0 }}</strong>
              <small>Role, budget and task override controls</small>
            </article>
          </div>

          <div class="task-health-list">
            <div *ngFor="let task of taskOverrides().slice(0, 8)">
              <span>{{ task.taskKey }}</span>
              <strong [class.warn]="task.enabled === false">{{ task.enabled === false ? 'off' : 'on' }}</strong>
            </div>
          </div>

          <div class="prompt-registry">
            <div class="registry-head">
              <span class="eyebrow">Prompt registry</span>
              <strong>{{ rows(promptRegistry()?.prompts).length }} prompts</strong>
            </div>
            <div class="registry-flags">
              <span>PII redaction</span>
              <span>Role policy</span>
              <span>Usage limits</span>
              <span>{{ promptRegistry()?.fallbackMode || 'local-business-rules' }}</span>
            </div>
            <div class="registry-list">
              <div *ngFor="let prompt of rows(promptRegistry()?.prompts).slice(0, 8)">
                <span>{{ prompt.taskKey }}</span>
                <strong>{{ prompt.promptVersion || 'v1' }}</strong>
                <small>{{ prompt.outputMode || 'json_schema' }}</small>
              </div>
            </div>
          </div>
        </section>
        <section class="panel queue-panel">
          <div class="section-title">
            <div>
              <span class="eyebrow">Action queue</span>
              <h2>Action queue</h2>
            </div>
          </div>

          <div class="queue-stack">
            <article>
              <span>WhatsApp drafts</span>
              <strong>{{ whatsappDrafts().length }}</strong>
              <small>Draft-first customer messaging</small>
            </article>
            <article>
              <span>Automation suggestions</span>
              <strong>{{ automationSuggestions().length }}</strong>
              <small>Review before activation</small>
            </article>
            <article>
              <span>Knowledge docs</span>
              <strong>{{ observability()?.knowledgeDocumentCount || 0 }}</strong>
              <small>Grounding library</small>
            </article>
          </div>

          <div class="mini-feed">
            <div *ngFor="let item of automationSuggestions().slice(0, 4)">
              <strong>{{ item.title || item.suggestionType || item.id }}</strong>
              <span>{{ item.message || item.status || item.reason || 'Automation suggestion' }}</span>
            </div>
            <div *ngIf="!automationSuggestions().length">
              <strong>No pending automation suggestions</strong>
              <span>Run workflows to create new reviewable signals.</span>
            </div>
          </div>
        </section>
        </div>
      </div>
      <section class="panel history-panel" *ngIf="!loading()">
        <div class="section-title">
          <div>
            <span class="eyebrow">Activity history</span>
            <h2>Recent assistant interactions</h2>
          </div>
          <button class="ghost-button" type="button" (click)="loadHistory()">Refresh history</button>
        </div>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Workflow</th>
                <th>Prompt</th>
                <th>Model</th>
                <th>Confidence</th>
                <th>Created</th>
              </tr>
            </thead>
            <tbody>
              <tr *ngFor="let item of history()">
                <td><span class="badge">{{ item.type }}</span></td>
                <td><strong>{{ item.output?.title || item.prompt }}</strong><small>{{ item.prompt }}</small></td>
                <td>{{ item.model }}</td>
                <td>{{ item.confidence }}</td>
                <td>{{ item.createdAt | date:'short' }}</td>
              </tr>
              <tr *ngIf="!history().length">
                <td colspan="5">No activity saved yet.</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </section>
  `,
  styles: [`
    :host {
      display: block;
      --ai-bg: #f6f8f9;
      --ai-card: #ffffff;
      --ai-card-soft: #f8fafc;
      --ai-ink: #172033;
      --ai-muted: #64748b;
      --ai-line: #e2e8f0;
      --ai-primary: #0f766e;
      --ai-primary-soft: rgba(15, 118, 110, 0.09);
      --ai-amber: #b7791f;
      --ai-red: #b42318;
      --ai-green: #15803d;
      --ai-shadow: 0 10px 24px rgba(15, 23, 42, 0.07);
    }

    .ai-command-page {
      width: min(100%, 1760px);
      margin: 0 auto;
      padding: 4px 0 28px;
      display: grid;
      gap: 16px;
      color: var(--ai-ink);
      background: var(--ai-bg);
      overflow-x: hidden;
    }

    .ai-hero,
    .panel,
    .ai-kpi {
      border: 1px solid var(--ai-line);
      border-radius: 14px;
      background: var(--ai-card);
      box-shadow: var(--ai-shadow);
    }

    .ai-hero {
      position: relative;
      overflow: hidden;
      min-height: 118px;
      display: grid;
      grid-template-columns: minmax(0, 1fr) max-content;
      align-items: center;
      gap: 18px;
      padding: 20px 22px;
    }

    .hero-orbit { display: none; }

    .hero-copy {
      min-width: 0;
      display: grid;
      gap: 8px;
    }

    .eyebrow {
      color: var(--ai-muted);
      font-size: 0.72rem;
      font-weight: 900;
      letter-spacing: 0.06em;
      text-transform: uppercase;
    }

    .ai-hero h2,
    .command-header h2,
    .section-title h2 {
      margin: 0;
      color: var(--ai-ink);
      letter-spacing: 0;
      line-height: 1.15;
    }

    .ai-hero h2 {
      font-size: clamp(1.55rem, 1.25rem + 1vw, 2.25rem);
      font-weight: 850;
    }

    .ai-hero p,
    .command-header p {
      max-width: 780px;
      margin: 0;
      color: var(--ai-muted);
      font-size: 0.92rem;
      font-weight: 650;
      line-height: 1.45;
    }

    .hero-actions,
    .form-actions,
    .section-title,
    .command-header,
    .task-badges,
    .category-tabs,
    .result-metrics,
    .approval-checklist,
    .queue-stack,
    .hero-signal-row {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      min-width: 0;
    }

    .hero-actions {
      justify-content: flex-end;
      align-items: center;
    }

    .hero-signal-row span,
    .task-badges span,
    .category-tabs button,
    .badge {
      min-height: 28px;
      display: inline-flex;
      align-items: center;
      border: 1px solid var(--ai-line);
      border-radius: 999px;
      padding: 5px 9px;
      color: var(--ai-muted);
      background: var(--ai-card-soft);
      font-size: 0.72rem;
      font-weight: 850;
      white-space: nowrap;
    }

    .task-badges span:first-child,
    .badge {
      color: var(--ai-primary);
      background: var(--ai-primary-soft);
      border-color: rgba(15, 118, 110, 0.18);
    }

    .task-badges .warn,
    .warning-text,
    .task-health-list .warn {
      color: var(--ai-red);
    }

    .ai-kpi-grid {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 10px;
    }

    .ai-kpi {
      min-height: 96px;
      display: grid;
      align-content: center;
      gap: 5px;
      padding: 14px 16px;
      border-left: 3px solid var(--ai-primary);
      box-shadow: 0 6px 16px rgba(15, 23, 42, 0.055);
    }

    .ai-kpi span,
    .workflow-card small,
    .governance-stack span,
    .queue-stack span,
    .mini-feed span,
    .answer-card span,
    .result-metrics span,
    .approval-checklist small,
    .raw-json summary,
    .registry-list small,
    .registry-flags span {
      color: var(--ai-muted);
      font-size: 0.75rem;
      font-weight: 750;
      line-height: 1.35;
    }

    .ai-kpi strong {
      color: var(--ai-ink);
      font-size: 1.55rem;
      line-height: 1;
    }

    .ai-kpi small {
      color: var(--ai-muted);
      font-size: 0.76rem;
      line-height: 1.32;
    }

    .ai-workspace-grid {
      display: grid;
      grid-template-columns: minmax(260px, 0.78fr) minmax(420px, 1.36fr) minmax(270px, 0.82fr);
      gap: 14px;
      align-items: start;
      min-width: 0;
    }

    .ai-left-stack,
    .ai-main-stack,
    .ai-side-stack {
      min-width: 0;
      display: grid;
      gap: 14px;
      align-content: start;
    }

    .panel {
      min-width: 0;
      padding: 16px;
    }

    .workflow-panel,
    .governance-panel {
      position: sticky;
      top: 82px;
      max-height: calc(100vh - 100px);
      overflow: hidden;
    }

    .governance-panel,
    .workflow-list {
      overflow: auto;
    }

    .section-title {
      justify-content: space-between;
      align-items: center;
      margin-bottom: 12px;
    }

    .section-title h2 {
      font-size: 1rem;
      font-weight: 820;
    }

    .ai-search,
    .field {
      display: grid;
      gap: 6px;
      color: var(--ai-muted);
      font-size: 0.76rem;
      font-weight: 850;
    }

    .ai-search {
      margin-bottom: 10px;
    }

    .ai-search input,
    .field input,
    .field select,
    .field textarea {
      width: 100%;
      min-width: 0;
      border: 1px solid var(--ai-line);
      border-radius: 10px;
      padding: 10px 11px;
      background: #fff;
      color: var(--ai-ink);
      font: inherit;
      font-size: 0.86rem;
      font-weight: 650;
      outline: none;
    }

    .ai-search input:focus,
    .field input:focus,
    .field select:focus,
    .field textarea:focus {
      border-color: rgba(15, 118, 110, 0.45);
      box-shadow: 0 0 0 3px rgba(15, 118, 110, 0.09);
    }

    .category-tabs {
      margin-bottom: 10px;
      max-height: 94px;
      overflow: auto;
    }

    .category-tabs button {
      cursor: pointer;
    }

    .category-tabs button.active {
      color: #fff;
      background: var(--ai-primary);
      border-color: var(--ai-primary);
    }

    .category-tabs small {
      margin-left: 5px;
      opacity: 0.75;
    }

    .panel-count {
      min-height: 26px;
      display: inline-flex;
      align-items: center;
      border: 1px solid var(--ai-line);
      border-radius: 999px;
      padding: 4px 9px;
      color: var(--ai-muted);
      background: var(--ai-card-soft);
      font-size: 0.72rem;
      font-weight: 850;
      white-space: nowrap;
    }

    .workflow-list {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(230px, 1fr));
      gap: 10px;
      max-height: calc(100vh - 285px);
      padding-right: 4px;
    }

    .workflow-card {
      width: 100%;
      min-height: 118px;
      display: grid;
      grid-template-columns: 38px minmax(0, 1fr);
      align-items: start;
      gap: 10px;
      border: 1px solid var(--ai-line);
      border-radius: 12px;
      padding: 12px;
      color: var(--ai-ink);
      background: #fff;
      text-align: left;
      cursor: pointer;
      box-shadow: 0 6px 14px rgba(15, 23, 42, 0.045);
      transition: border-color 140ms ease, box-shadow 140ms ease, transform 140ms ease;
    }

    .workflow-card:hover,
    .workflow-card:focus-visible {
      border-color: rgba(15, 118, 110, 0.45);
      box-shadow: 0 10px 20px rgba(15, 23, 42, 0.08);
      outline: none;
      transform: translateY(-1px);
    }

    .workflow-card.active {
      border-color: rgba(15, 118, 110, 0.65);
      background: #f7fffd;
      box-shadow: inset 3px 0 0 var(--ai-primary), 0 10px 20px rgba(15, 118, 110, 0.1);
    }

    .workflow-card.disabled {
      opacity: 0.58;
    }

    .workflow-copy {
      min-width: 0;
      display: grid;
      gap: 6px;
    }

    .workflow-card-topline,
    .workflow-card-footer {
      min-width: 0;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
    }

    .workflow-card strong,
    .workflow-card small {
      display: block;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .workflow-card strong {
      color: var(--ai-ink);
      font-size: 0.88rem;
      line-height: 1.2;
      white-space: nowrap;
    }

    .workflow-card small {
      display: -webkit-box;
      min-height: 34px;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
    }

    .workflow-card em {
      border-radius: 999px;
      padding: 4px 7px;
      color: var(--ai-primary);
      background: var(--ai-primary-soft);
      font-size: 0.62rem;
      font-style: normal;
      font-weight: 900;
      text-transform: uppercase;
      white-space: nowrap;
    }

    .workflow-card-footer span,
    .workflow-card-footer b {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-size: 0.72rem;
      font-weight: 850;
    }

    .workflow-card-footer span {
      color: var(--ai-muted);
    }

    .workflow-card-footer b {
      color: var(--ai-primary);
    }

    .workflow-icon {
      width: 38px;
      height: 38px;
      display: grid;
      place-items: center;
      border-radius: 10px;
      color: var(--ai-primary);
      background: var(--ai-primary-soft);
      font-size: 0.72rem;
      font-weight: 950;
    }

    .command-header {
      justify-content: space-between;
      align-items: flex-start;
      margin-bottom: 14px;
    }

    .command-title-row {
      min-width: 0;
      display: grid;
      grid-template-columns: 44px minmax(0, 1fr);
      gap: 12px;
      align-items: start;
    }

    .command-workflow-icon {
      width: 44px;
      height: 44px;
      margin-top: 2px;
    }

    .command-header h2 {
      margin-top: 3px;
      font-size: clamp(1.25rem, 1rem + 0.8vw, 1.8rem);
      font-weight: 850;
    }

    .task-badges {
      justify-content: flex-end;
      max-width: 360px;
    }

    .enterprise-form {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 10px;
    }

    .enterprise-form .full {
      grid-column: 1 / -1;
    }

    .field textarea {
      min-height: 122px;
      resize: vertical;
    }

    .safety-strip {
      display: grid;
      gap: 4px;
      border: 1px solid rgba(15, 118, 110, 0.18);
      border-radius: 10px;
      padding: 11px 12px;
      background: var(--ai-primary-soft);
      color: var(--ai-muted);
      font-size: 0.76rem;
    }

    .safety-strip span {
      color: var(--ai-primary);
      font-weight: 900;
    }

    .safety-strip strong {
      color: var(--ai-ink);
      font-size: 0.86rem;
    }

    .safety-strip small {
      color: var(--ai-muted);
    }

    .form-actions {
      justify-content: flex-end;
      align-items: center;
    }

    .ghost-button,
    .dark-button,
    .primary-button {
      min-height: 34px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      border-radius: 8px;
      padding: 0 12px;
      font-size: 0.82rem;
      font-weight: 850;
      white-space: nowrap;
    }

    .output-panel {
      display: grid;
      gap: 12px;
    }

    .ai-output {
      display: grid;
      gap: 12px;
    }

    .answer-card,
    .source-strip article,
    .result-metrics article,
    .approval-checklist article,
    .governance-stack article,
    .queue-stack article,
    .prompt-registry,
    .mini-feed div,
    .action-card,
    .empty-command {
      border: 1px solid var(--ai-line);
      border-radius: 10px;
      background: #fff;
      box-shadow: 0 4px 12px rgba(15, 23, 42, 0.04);
    }

    .answer-card {
      display: grid;
      gap: 7px;
      padding: 14px;
      border-left: 3px solid var(--ai-primary);
    }

    .answer-card strong {
      color: var(--ai-ink);
      font-size: 1rem;
      line-height: 1.35;
    }

    .answer-card p {
      margin: 0;
      color: var(--ai-muted);
      line-height: 1.45;
    }

    .source-strip,
    .quick-grid,
    .governance-stack,
    .registry-list,
    .mini-feed {
      display: grid;
      gap: 8px;
    }

    .source-strip {
      grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
    }

    .source-strip article,
    .result-metrics article,
    .approval-checklist article,
    .queue-stack article,
    .governance-stack article,
    .action-card {
      padding: 11px 12px;
    }

    .source-strip strong,
    .result-metrics strong,
    .approval-checklist strong,
    .queue-stack strong,
    .governance-stack strong,
    .mini-feed strong,
    .action-card strong {
      display: block;
      color: var(--ai-ink);
      font-size: 0.9rem;
      line-height: 1.3;
    }

    .result-metrics {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
    }

    .result-metrics article {
      display: grid;
      gap: 4px;
      min-height: 68px;
    }

    .approval-checklist {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
    }

    .approval-checklist article {
      display: grid;
      grid-template-columns: 26px minmax(0, 1fr);
      gap: 8px;
      align-items: start;
    }

    .approval-checklist article > span {
      width: 24px;
      height: 24px;
      display: grid;
      place-items: center;
      border-radius: 999px;
      color: #fff;
      background: var(--ai-primary);
      font-size: 0.72rem;
      font-weight: 900;
    }

    .approval-checklist small {
      grid-column: 2;
    }

    .quick-grid {
      grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));
    }

    .action-card {
      display: grid;
      gap: 5px;
      min-height: 86px;
      align-content: start;
    }

    .action-card span,
    .action-card small {
      color: var(--ai-muted);
      font-size: 0.76rem;
      line-height: 1.35;
    }

    .raw-json {
      border: 1px solid var(--ai-line);
      border-radius: 10px;
      background: var(--ai-card-soft);
      overflow: hidden;
    }

    .raw-json summary {
      cursor: pointer;
      padding: 11px 12px;
    }

    .raw-json pre {
      max-height: 260px;
      margin: 0;
      overflow: auto;
      padding: 12px;
      border-top: 1px solid var(--ai-line);
      color: var(--ai-muted);
      background: #fff;
      font-size: 0.78rem;
      white-space: pre-wrap;
    }

    .empty-command {
      min-height: 180px;
      display: grid;
      place-items: center;
      gap: 6px;
      padding: 24px;
      color: var(--ai-muted);
      text-align: center;
    }

    .empty-command strong {
      color: var(--ai-ink);
      font-size: 1rem;
    }

    .governance-stack,
    .queue-stack {
      grid-template-columns: 1fr;
      margin-bottom: 12px;
    }

    .governance-stack article,
    .queue-stack article {
      min-height: 70px;
      display: grid;
      gap: 4px;
      align-content: center;
      border-left: 3px solid var(--ai-primary);
      box-shadow: none;
    }

    .task-health-list {
      display: grid;
      gap: 6px;
      margin: 12px 0;
    }

    .task-health-list div,
    .registry-list div {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: 8px;
      align-items: center;
      padding: 8px 0;
      border-bottom: 1px solid var(--ai-line);
    }

    .task-health-list span,
    .registry-list span {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      color: var(--ai-muted);
      font-size: 0.76rem;
      font-weight: 750;
    }

    .task-health-list strong,
    .registry-list strong {
      color: var(--ai-green);
      font-size: 0.76rem;
      text-transform: uppercase;
    }

    .prompt-registry {
      padding: 12px;
    }

    .registry-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      margin-bottom: 10px;
    }

    .registry-flags {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      margin-bottom: 8px;
    }

    .registry-flags span {
      border-radius: 999px;
      padding: 5px 8px;
      background: var(--ai-card-soft);
    }

    .mini-feed {
      margin-top: 12px;
    }

    .mini-feed div {
      display: grid;
      gap: 4px;
      padding: 10px 12px;
    }

    .history-panel .table-wrap {
      width: 100%;
      overflow: auto;
      border: 1px solid var(--ai-line);
      border-radius: 10px;
      background: #fff;
    }

    .history-panel table {
      width: 100%;
      border-collapse: collapse;
      min-width: 760px;
    }

    .history-panel th,
    .history-panel td {
      padding: 10px 12px;
      border-bottom: 1px solid var(--ai-line);
      text-align: left;
      vertical-align: top;
      font-size: 0.84rem;
    }

    .history-panel th {
      color: var(--ai-muted);
      background: var(--ai-card-soft);
      font-size: 0.72rem;
      font-weight: 900;
      letter-spacing: 0.05em;
      text-transform: uppercase;
    }

    .history-panel td small {
      display: block;
      max-width: 520px;
      margin-top: 3px;
      color: var(--ai-muted);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    @media (max-width: 1280px) {
      .ai-workspace-grid {
        grid-template-columns: minmax(240px, 0.82fr) minmax(0, 1.18fr);
      }

      .ai-side-stack {
        grid-column: 1 / -1;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        align-items: start;
      }

      .workflow-panel,
      .governance-panel {
        position: static;
        max-height: none;
      }

      .workflow-list {
        max-height: 560px;
      }
    }

    @media (max-width: 980px) {
      .ai-hero,
      .ai-workspace-grid,
      .ai-side-stack {
        grid-template-columns: 1fr;
      }

      .hero-actions,
      .task-badges,
      .form-actions {
        justify-content: flex-start;
      }

      .ai-kpi-grid,
      .result-metrics,
      .approval-checklist {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }

      .enterprise-form {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }
    }

    @media (max-width: 640px) {
      .ai-command-page {
        gap: 12px;
      }

      .ai-hero,
      .panel {
        padding: 14px;
        border-radius: 12px;
      }

      .ai-kpi-grid,
      .result-metrics,
      .approval-checklist,
      .enterprise-form,
      .quick-grid,
      .source-strip {
        grid-template-columns: 1fr;
      }

      .workflow-card {
        grid-template-columns: 36px minmax(0, 1fr);
        min-height: 112px;
      }

      .workflow-card-topline,
      .workflow-card-footer {
        align-items: flex-start;
        flex-direction: column;
        gap: 5px;
      }

      .command-title-row {
        grid-template-columns: 38px minmax(0, 1fr);
      }

      .command-workflow-icon {
        width: 38px;
        height: 38px;
      }

      .hero-actions a,
      .hero-actions button,
      .form-actions button {
        width: 100%;
      }
    }
  `]
})
export class AiAssistantComponent implements OnInit {
  readonly tools: AiTool[] = [
    { id: 'knowledge-search-summary', taskKey: 'knowledge.search_summary', title: 'Knowledge answer', category: 'Executive', icon: 'KB', tier: 'governed', description: 'Answer from active knowledge-base articles with source citations.', prompt: 'What does our knowledge base say about cancellation notice?', requires: ['branch'] },
    { id: 'analytics-summary', taskKey: 'analytics.summary', title: 'Executive analytics brief', category: 'Executive', icon: 'EX', tier: 'smart', description: 'Summarize revenue, pending payments, low stock and owner actions.', prompt: 'Summarize the current salon performance and list the top 3 owner actions.' },
    { id: 'dashboard-executive-summary', taskKey: 'dashboard.executive_summary', title: 'Dashboard executive summary', category: 'Executive', icon: 'DB', tier: 'smart', description: 'Generate a board-room view from dashboard metrics.', prompt: 'Create an executive daily summary for the selected branch.', requires: ['branch'] },
    { id: 'dashboard-risk-briefing', taskKey: 'dashboard.risk_briefing', title: 'Risk briefing', category: 'Executive', icon: 'RK', tier: 'governed', description: 'Detect operational risks across bookings, payments and inventory.', prompt: 'Find the biggest operational risks and give safe next steps.', requires: ['branch'] },
    { id: 'dashboard-revenue-actions', taskKey: 'dashboard.revenue_actions', title: 'Revenue action plan', category: 'Executive', icon: 'RA', tier: 'smart', description: 'Prioritize rebooking, retail, payment recovery and service mix actions.', prompt: 'Recommend revenue actions for today with reasons.', requires: ['branch'] },
    { id: 'dashboard-owner-daily-brief', taskKey: 'dashboard.owner_daily_brief', title: 'Owner daily brief', category: 'Executive', icon: 'OB', tier: 'governed', description: 'Owner-ready daily brief with watch items and decisions.', prompt: 'Write my owner daily brief for this branch.', requires: ['branch'] },

    { id: 'customer-health-score', taskKey: 'customer360.health_score', title: 'Client health score', category: 'Client 360', icon: 'CH', tier: 'smart', description: 'Score client relationship health from saved visit, spend and risk signals.', prompt: 'Score this client and explain the relationship health.', requires: ['client'] },
    { id: 'customer-churn-risk', taskKey: 'customer360.churn_risk', title: 'Client churn risk', category: 'Client 360', icon: 'CR', tier: 'smart', description: 'Predict client retention risk and win-back priority.', prompt: 'Predict churn risk for this client and recommend a safe win-back action.', requires: ['client'] },
    { id: 'customer-next-best-action', taskKey: 'customer360.next_best_action', title: 'Next best action', category: 'Client 360', icon: 'NA', tier: 'smart', description: 'Choose the next action across rebooking, payment, service and membership.', prompt: 'What is the next best action for this client?', requires: ['client'] },
    { id: 'customer-upsell-recommendation', taskKey: 'customer360.upsell_recommendation', title: 'Ethical upsell recommendation', category: 'Client 360', icon: 'UP', tier: 'fast', description: 'Recommend service or retail add-ons without pressure selling.', prompt: 'Suggest one ethical upsell for this client with reason.', requires: ['client', 'service'] },
    { id: 'customer-rebooking-recommendation', taskKey: 'customer360.rebooking_recommendation', title: 'Rebooking recommendation', category: 'Client 360', icon: 'RB', tier: 'fast', description: 'Draft a rebooking strategy from visit cadence and preferences.', prompt: 'Recommend the best rebooking timing for this client.', requires: ['client', 'service'] },

    { id: 'calendar-smart-slot-score', taskKey: 'calendar.smart_slot_score', title: 'Smart slot score', category: 'Calendar', icon: 'SS', tier: 'fast', description: 'Score a slot using staff load, service, client and branch context.', prompt: 'Score this booking slot and explain if front desk should use it.', requires: ['branch', 'staff', 'service', 'startAt'] },
    { id: 'calendar-no-show-risk', taskKey: 'calendar.no_show_risk', title: 'No-show risk', category: 'Calendar', icon: 'NS', tier: 'smart', description: 'Estimate no-show risk and confirmation strategy.', prompt: 'Predict no-show risk for this appointment context.', requires: ['branch', 'client', 'service', 'startAt'] },
    { id: 'calendar-conflict-doctor', taskKey: 'calendar.conflict_doctor', title: 'Conflict doctor', category: 'Calendar', icon: 'CD', tier: 'smart', description: 'Spot booking conflicts and safer alternatives.', prompt: 'Check this appointment context for conflict risk.', requires: ['branch', 'staff', 'service', 'startAt'] },
    { id: 'calendar-revenue-gap-filler', taskKey: 'calendar.revenue_gap_filler', title: 'Revenue gap filler', category: 'Calendar', icon: 'GF', tier: 'smart', description: 'Find productive actions for idle calendar gaps.', prompt: 'Suggest how to fill idle calendar gaps today.', requires: ['branch'] },
    { id: 'calendar-staff-load-signal', taskKey: 'calendar.staff_load_signal', title: 'Staff load signal', category: 'Calendar', icon: 'SL', tier: 'fast', description: 'Check staff load and fatigue pressure.', prompt: 'Review staff load and flag overload risk.', requires: ['branch', 'staff'] },
    { id: 'calendar-delay-prediction', taskKey: 'calendar.delay_prediction', title: 'Delay prediction', category: 'Calendar', icon: 'DP', tier: 'fast', description: 'Predict delay risk for a service slot.', prompt: 'Predict delay risk for this service booking.', requires: ['branch', 'staff', 'service', 'startAt'] },
    { id: 'calendar-booking-quality-score', taskKey: 'calendar.booking_quality_score', title: 'Booking quality score', category: 'Calendar', icon: 'BQ', tier: 'smart', description: 'Rate booking completeness, service fit and operational readiness.', prompt: 'Score booking quality and missing information.', requires: ['branch', 'client', 'service', 'startAt'] },

    { id: 'pos-smart-upsell', taskKey: 'pos.smart_upsell', title: 'POS smart upsell', category: 'POS', icon: 'PU', tier: 'fast', description: 'Suggest one ethical POS add-on from cart and client context.', prompt: 'Suggest a safe add-on for this POS cart.', requires: ['client', 'service', 'cart'] },
    { id: 'pos-membership-suggestion', taskKey: 'pos.membership_suggestion', title: 'Membership suggestion', category: 'POS', icon: 'MS', tier: 'fast', description: 'Check if membership conversion is appropriate.', prompt: 'Should front desk offer a membership for this cart?', requires: ['client', 'service', 'cart'] },
    { id: 'pos-discount-guard', taskKey: 'pos.discount_guard', title: 'Discount guard', category: 'POS', icon: 'DG', tier: 'governed', description: 'Review discount safety against cart value and margin.', prompt: 'Check if this discount is safe and explain why.', requires: ['client', 'service', 'cart'] },
    { id: 'pos-payment-recovery', taskKey: 'pos.payment_recovery', title: 'Payment recovery', category: 'POS', icon: 'PR', tier: 'governed', description: 'Recover pending balance politely at billing.', prompt: 'Draft a polite payment recovery action.', requires: ['client'] },
    { id: 'pos-cart-profitability', taskKey: 'pos.cart_profitability', title: 'Cart profitability', category: 'POS', icon: 'CP', tier: 'smart', description: 'Analyze cart value, margin and leakage risk.', prompt: 'Analyze cart profitability and risk.', requires: ['client', 'service', 'cart'] },

    { id: 'inventory-reorder-prediction', taskKey: 'inventory.reorder_prediction', title: 'Reorder prediction', category: 'Inventory', icon: 'IR', tier: 'smart', description: 'Predict reorder needs from live stock and service demand.', prompt: 'Predict which product should be reordered first.', requires: ['branch', 'product'] },
    { id: 'inventory-expiry-waste-risk', taskKey: 'inventory.expiry_waste_risk', title: 'Expiry waste risk', category: 'Inventory', icon: 'EW', tier: 'smart', description: 'Flag expiring inventory and waste prevention actions.', prompt: 'Find expiry or waste risk in inventory.', requires: ['branch', 'product'] },
    { id: 'inventory-service-stock-readiness', taskKey: 'inventory.service_stock_readiness', title: 'Service stock readiness', category: 'Inventory', icon: 'SR', tier: 'fast', description: 'Check whether inventory can support a selected service.', prompt: 'Check stock readiness for this service.', requires: ['branch', 'service'] },
    { id: 'inventory-low-stock-reason', taskKey: 'inventory.low_stock_reason', title: 'Low stock reason', category: 'Inventory', icon: 'LS', tier: 'smart', description: 'Explain why products are low and what to do.', prompt: 'Explain the likely reason for low stock.', requires: ['branch', 'product'] },
    { id: 'inventory-purchase-plan', taskKey: 'inventory.purchase_plan', title: 'Purchase plan', category: 'Inventory', icon: 'PP', tier: 'governed', description: 'Create a reviewable purchase recommendation.', prompt: 'Create a purchase plan for priority salon stock.', requires: ['branch', 'product'] },

    { id: 'whatsapp-intent-detection', taskKey: 'whatsapp.intent_detection', title: 'WhatsApp intent detection', category: 'WhatsApp', icon: 'WI', tier: 'fast', description: 'Classify incoming WhatsApp intent before action.', prompt: 'Client says: Can I book a facial tomorrow and know the price?', requires: ['channel'] },
    { id: 'whatsapp-reply-generation', taskKey: 'whatsapp.reply_generation', title: 'WhatsApp reply generation', category: 'WhatsApp', icon: 'WR', tier: 'governed', description: 'Draft reply for manual approval.', prompt: 'Draft a helpful WhatsApp reply. Do not confirm until staff reviews.', requires: ['client', 'channel'] },
    { id: 'whatsapp-followup-draft', taskKey: 'whatsapp.followup_draft', title: 'Post-visit follow-up', category: 'WhatsApp', icon: 'WF', tier: 'governed', description: 'Generate reviewable follow-up message.', prompt: 'Generate a warm post-visit follow-up message.', requires: ['client', 'service', 'channel'] },
    { id: 'whatsapp-rebooking-draft', taskKey: 'whatsapp.rebooking_draft', title: 'Rebooking draft', category: 'WhatsApp', icon: 'WB', tier: 'governed', description: 'Draft rebooking WhatsApp with client context.', prompt: 'Draft a rebooking WhatsApp message for this client.', requires: ['client', 'service', 'channel'] },
    { id: 'whatsapp-payment-reminder-draft', taskKey: 'whatsapp.payment_reminder_draft', title: 'Payment reminder draft', category: 'WhatsApp', icon: 'WP', tier: 'governed', description: 'Draft polite payment reminder; never auto-send.', prompt: 'Draft a polite payment reminder for this client.', requires: ['client', 'channel'] },

    { id: 'review-reply', taskKey: 'review.reply', title: 'Review reply', category: 'Reputation', icon: 'RR', tier: 'governed', description: 'Reply to client reviews with recovery or appreciation tone.', prompt: 'Reply professionally to this review.', requires: ['review'] },
    { id: 'marketing-caption', taskKey: 'marketing.caption', title: 'Campaign caption generator', category: 'Growth', icon: 'MC', tier: 'fast', description: 'Create campaign captions from an offer and channel.', prompt: 'Create captions for a weekend salon offer.', requires: ['channel', 'offer'] }
  ];

  readonly activeTool = signal('analytics-summary');
  readonly activeCategory = signal('All');
  readonly toolQuery = signal('');
  readonly clients = signal<ApiRecord[]>([]);
  readonly services = signal<ApiRecord[]>([]);
  readonly branches = signal<ApiRecord[]>([]);
  readonly staff = signal<ApiRecord[]>([]);
  readonly products = signal<ApiRecord[]>([]);
  readonly history = signal<ApiRecord[]>([]);
  readonly observability = signal<ApiRecord | null>(null);
  readonly governance = signal<ApiRecord | null>(null);
  readonly promptRegistry = signal<ApiRecord | null>(null);
  readonly taskOverrides = signal<ApiRecord[]>([]);
  readonly automationSuggestions = signal<ApiRecord[]>([]);
  readonly whatsappDrafts = signal<ApiRecord[]>([]);
  readonly result = signal<ApiRecord | null>(null);
  readonly loading = signal(true);
  readonly running = signal(false);
  readonly error = signal('');

  readonly categoryPills = computed(() => {
    const categories = ['All', ...Array.from(new Set(this.tools.map((tool) => tool.category)))];
    return categories.map((label) => ({
      label,
      count: label === 'All' ? this.tools.length : this.tools.filter((tool) => tool.category === label).length
    }));
  });

  readonly form = this.fb.group({
    prompt: ['', Validators.required],
    clientId: [''],
    serviceId: [''],
    productId: [''],
    branchId: [''],
    staffId: [''],
    startAt: [this.localDateTime()],
    rating: [5],
    reviewText: [''],
    channel: ['WhatsApp'],
    offer: ['']
  });

  constructor(private readonly api: ApiService, private readonly fb: UntypedFormBuilder) {}

  ngOnInit(): void {
    this.selectTool(this.activeTool());
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.error.set('');
    const branchId = this.api.selectedBranchId();
    Promise.all([
      this.safeList<ApiRecord[]>('clients', { branchId, limit: 1000 }, []),
      this.safeList<ApiRecord[]>('services', { limit: 1000 }, []),
      this.safeList<ApiRecord[]>('branches', {}, []),
      this.safeList<ApiRecord[]>('staff', { branchId, limit: 1000 }, []),
      this.safeList<ApiRecord[]>('products', { branchId, limit: 1000 }, []),
      this.safeList<ApiRecord[]>('ai/history', { limit: 50 }, []),
      this.safeList<ApiRecord>('ai/observability', {}, {}),
      this.safeList<ApiRecord>('ai/governance/settings', {}, {}),
      this.safeList<ApiRecord>('ai/prompt-registry', {}, { prompts: [], safetyPolicy: {} }),
      this.safeList<ApiRecord>('ai/governance/task-overrides', {}, { tasks: [] }),
      this.safeList<ApiRecord>('ai/automation/suggestions', { limit: 20 }, { suggestions: [] }),
      this.safeList<ApiRecord>('ai/whatsapp-agent/drafts', { limit: 20 }, { drafts: [] })
    ])
      .then(([clients, services, branches, staff, products, history, observability, governance, registry, overrides, suggestions, drafts]) => {
        this.clients.set(this.rows(clients));
        this.services.set(this.rows(services));
        this.branches.set(this.rows(branches));
        this.staff.set(this.rows(staff));
        this.products.set(this.rows(products));
        this.history.set(this.rows(history));
        this.observability.set(observability || {});
        this.governance.set(governance || {});
        this.promptRegistry.set(registry || { prompts: [], safetyPolicy: {} });
        this.taskOverrides.set(this.rows(overrides?.tasks || overrides));
        this.automationSuggestions.set(this.rows(suggestions?.suggestions || suggestions));
        this.whatsappDrafts.set(this.rows(drafts?.drafts || drafts));
        if (!this.form.value.branchId && branchId) this.form.patchValue({ branchId });
        this.loading.set(false);
      })
      .catch((error) => {
        this.error.set(this.api.errorText(error, 'Unable to load assistant context'));
        this.loading.set(false);
      });
  }

  loadHistory(): void {
    this.api.list<ApiRecord[]>('ai/history', { limit: 50 }).subscribe({
      next: (history) => this.history.set(this.rows(history)),
      error: (error) => this.error.set(this.api.errorText(error, 'Unable to load activity history'))
    });
  }

  filteredTools(): AiTool[] {
    const term = this.toolQuery().trim().toLowerCase();
    const category = this.activeCategory();
    return this.tools.filter((tool) => {
      const matchesCategory = category === 'All' || tool.category === category;
      const haystack = `${tool.title} ${tool.description} ${tool.category} ${tool.taskKey}`.toLowerCase();
      return matchesCategory && (!term || haystack.includes(term));
    });
  }

  selectTool(toolId: string): void {
    const tool = this.tools.find((item) => item.id === toolId) || this.tools[0];
    this.activeTool.set(tool.id);
    this.result.set(null);
    this.form.patchValue({ prompt: tool.prompt });
  }

  selectedTool(): AiTool | undefined {
    return this.tools.find((tool) => tool.id === this.activeTool());
  }

  activeTaskKey(): string {
    return this.selectedTool()?.taskKey || '';
  }

  requires(requirement: NonNullable<AiTool['requires']>[number]): boolean {
    return Boolean(this.selectedTool()?.requires?.includes(requirement));
  }

  taskEnabled(tool?: AiTool): boolean {
    if (!tool) return true;
    const override = this.taskOverrides().find((row) => row.taskKey === tool.taskKey);
    return override?.enabled !== false;
  }

  reviewQueueCount(): number {
    return this.whatsappDrafts().length + this.automationSuggestions().length;
  }

  modelMode(): string {
    return this.observability()?.providerStatus?.mode || this.governance()?.providerMode || 'local';
  }

  run(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const tool = this.selectedTool();
    if (!tool) return;
    const value = this.form.value;
    if (tool.taskKey.startsWith('customer360.') && !value.clientId) {
      this.error.set('Select a client for this workflow.');
      return;
    }
    if (tool.id === 'pos-cart-profitability' && !value.serviceId) {
      this.error.set('Select a service so POS cart profitability has a cart item to analyze.');
      return;
    }
    if (!this.taskEnabled(tool)) {
      this.error.set(`${tool.taskKey} is disabled by policy.`);
      return;
    }

    this.running.set(true);
    this.error.set('');
    this.api.post<ApiRecord>(`ai/${tool.id}`, this.buildPayload(tool)).subscribe({
      next: (result) => {
        this.result.set(result);
        this.running.set(false);
        this.loadHistory();
        this.loadOptionalRails();
      },
      error: (error) => {
        this.error.set(this.api.errorText(error, 'Unable to run workflow'));
        this.running.set(false);
      }
    });
  }

  outputTitle(): string {
    return this.result()?.output?.title || this.selectedTool()?.title || 'Assistant result';
  }

  outputSummary(output: ApiRecord): string {
    if (Array.isArray(output.summary)) return output.summary.join(' ');
    return output.result || output.answer || output.reply || output.message || output.modelText || output.recommendedAction || 'Result generated from saved salon data.';
  }

  outputMetrics(output: ApiRecord): Array<{ label: string; value: string }> {
    const metrics = [
      { label: 'Confidence', value: `${Math.round(Number(output.confidence || 0) * 100)}%` },
      { label: 'Model', value: String(output.model || output.ai?.model || 'local') },
      { label: 'Risk', value: String(output.riskLevel || output.risk || 'review') },
      { label: 'Provider', value: String(output.ai?.provider || this.modelMode()) }
    ];
    if (output.score !== undefined) metrics[2] = { label: 'Score', value: String(output.score) };
    if (output.estimatedValue !== undefined) metrics[2] = { label: 'Value', value: `INR ${Math.round(Number(output.estimatedValue || 0))}` };
    return metrics;
  }

  primaryList(output: ApiRecord): ApiRecord[] {
    const value = output.recommendations || output.suggestions || output.clients || output.products || output.risks || output.insights || output.citations || output.actions || output.segmentIdeas || output.captions || [];
    return this.rows(value).slice(0, 9).map((item) => typeof item === 'string' ? { name: item, value: '' } : item);
  }

  knowledgeSources(output: ApiRecord): ApiRecord[] {
    return this.rows(output.citations || output.knowledge?.sources || output.sources).slice(0, 5)
      .map((item) => typeof item === 'string' ? { title: item } : item);
  }

  private buildPayload(tool: AiTool): ApiRecord {
    const value = this.form.value;
    const selectedService = this.services().find((service) => service.id === value.serviceId);
    const cartItems = selectedService ? [{
      type: 'service',
      serviceId: selectedService.id,
      name: selectedService.name,
      quantity: 1,
      price: Number(selectedService.price || selectedService.basePrice || 0)
    }] : [];
    return {
      ...value,
      branchId: value.branchId || this.api.selectedBranchId(),
      message: value.prompt,
      body: value.prompt,
      startAt: value.startAt ? new Date(String(value.startAt)).toISOString() : '',
      rating: Number(value.rating || 5),
      items: cartItems,
      cartItems,
      context: {
        source: 'ai-enterprise-copilot',
        taskKey: tool.taskKey,
        channel: value.channel
      },
      extraContext: {
        ui: 'Business Assistant',
        humanReviewRequired: true
      }
    };
  }

  private loadOptionalRails(): void {
    Promise.all([
      this.safeList<ApiRecord>('ai/observability', {}, {}),
      this.safeList<ApiRecord>('ai/automation/suggestions', { limit: 20 }, { suggestions: [] }),
      this.safeList<ApiRecord>('ai/whatsapp-agent/drafts', { limit: 20 }, { drafts: [] })
    ]).then(([observability, suggestions, drafts]) => {
      this.observability.set(observability || {});
      this.automationSuggestions.set(this.rows(suggestions?.suggestions || suggestions));
      this.whatsappDrafts.set(this.rows(drafts?.drafts || drafts));
    });
  }

  private safeList<T>(resource: string, params: ApiRecord, fallback: T): Promise<T> {
    return this.api.list<T>(resource, params).toPromise()
      .then((value) => (value ?? fallback) as T)
      .catch(() => fallback);
  }

  rows(value: unknown): ApiRecord[] {
    if (Array.isArray(value)) return value as ApiRecord[];
    if (value && typeof value === 'object') {
      const object = value as ApiRecord;
      if (Array.isArray(object.items)) return object.items;
      if (Array.isArray(object.rows)) return object.rows;
      if (Array.isArray(object.data)) return object.data;
      if (Array.isArray(object.results)) return object.results;
    }
    return [];
  }

  private localDateTime(): string {
    const now = new Date();
    now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
    now.setHours(now.getHours() + 2);
    return now.toISOString().slice(0, 16);
  }
}
