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
          <h2>Business Assistant</h2>
          <p>Use saved salon data to prepare client, booking, POS, inventory, marketing and review actions.</p>
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

      <div class="ai-command-grid" *ngIf="!loading()">
        <section class="panel workflow-panel">
          <div class="section-title">
            <div>
              <span class="eyebrow">Workflow router</span>
              <h2>Choose a workflow</h2>
            </div>
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
              <span>
                <strong>{{ tool.title }}</strong>
                <small>{{ tool.description }}</small>
              </span>
              <em>{{ tool.tier }}</em>
            </button>
          </div>
        </section>

        <section class="panel command-panel">
          <div class="command-header">
            <div>
              <span class="eyebrow">{{ selectedTool()?.category }}</span>
              <h2>{{ selectedTool()?.title }}</h2>
              <p>{{ selectedTool()?.description }}</p>
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

        <section class="panel governance-panel">
          <div class="section-title">
            <div>
              <span class="eyebrow">Governance rail</span>
              <h2>Model, policy and cost</h2>
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
      </div>

      <div class="ai-result-grid" *ngIf="!loading()">
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

        <section class="panel queue-panel">
          <div class="section-title">
            <div>
              <span class="eyebrow">Action queue</span>
              <h2>Drafts, suggestions and signals</h2>
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
    }

    .ai-command-page {
      color: var(--ink);
    }

    .ai-hero,
    .panel,
    .ai-kpi {
      border: 1px solid var(--line);
      background: var(--surface);
      box-shadow: var(--shadow-lg);
    }

    .ai-hero {
      position: relative;
      overflow: hidden;
      display: flex;
      justify-content: space-between;
      gap: 24px;
      min-height: 260px;
      padding: 34px;
      border-radius: 30px;
      background:
        radial-gradient(circle at 8% 12%, rgba(15, 118, 110, .22), transparent 28%),
        radial-gradient(circle at 88% 20%, rgba(183, 121, 31, .18), transparent 30%),
        linear-gradient(135deg, #f8fffd, #f4f7ef 48%, #eef8f7);
    }

    .hero-copy {
      position: relative;
      max-width: 850px;
      z-index: 1;
    }

    .ai-hero h2 {
      max-width: 880px;
      margin: 8px 0;
      font-size: clamp(38px, 5vw, 74px);
      line-height: .9;
      letter-spacing: -0.07em;
    }

    .ai-hero p {
      max-width: 720px;
      color: var(--muted);
      font-size: 17px;
      font-weight: 750;
      line-height: 1.55;
    }

    .hero-actions {
      position: relative;
      z-index: 1;
      display: flex;
      align-items: flex-start;
      gap: 10px;
      flex-wrap: wrap;
      justify-content: flex-end;
    }

    .hero-signal-row,
    .task-badges,
    .category-tabs,
    .result-metrics,
    .approval-checklist,
    .queue-stack {
      display: flex;
      gap: 10px;
      flex-wrap: wrap;
    }

    .hero-signal-row span,
    .task-badges span,
    .category-tabs button,
    .safety-strip,
    .badge {
      border: 1px solid color-mix(in srgb, var(--teal) 22%, var(--line));
      background: rgba(255, 255, 255, .72);
      color: #12433f;
      border-radius: 999px;
      padding: 8px 12px;
      font-size: 12px;
      font-weight: 900;
    }

    .hero-orbit {
      position: absolute;
      border: 1px solid rgba(15, 118, 110, .16);
      border-radius: 999px;
      pointer-events: none;
    }

    .hero-orbit.one {
      width: 360px;
      height: 360px;
      right: -120px;
      bottom: -170px;
    }

    .hero-orbit.two {
      width: 170px;
      height: 170px;
      right: 210px;
      top: -80px;
      border-color: rgba(183, 121, 31, .20);
    }

    .ai-kpi-grid {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 14px;
    }

    .ai-kpi {
      position: relative;
      overflow: hidden;
      padding: 18px;
      border-radius: 22px;
    }

    .ai-kpi::after {
      content: '';
      position: absolute;
      right: -34px;
      bottom: -34px;
      width: 110px;
      height: 110px;
      border-radius: 999px;
      background: rgba(15, 118, 110, .10);
    }

    .ai-kpi span,
    .workflow-card small,
    .governance-stack span,
    .queue-stack span,
    .mini-feed span,
    .answer-card span,
    .result-metrics span,
    .approval-checklist small,
    .raw-json summary {
      color: var(--muted);
      font-size: 12px;
      font-weight: 850;
    }

    .ai-kpi strong {
      display: block;
      margin: 7px 0;
      font-size: 31px;
      letter-spacing: -0.04em;
    }

    .ai-kpi small {
      color: var(--muted);
      font-weight: 750;
    }

    .ai-command-grid {
      display: grid;
      grid-template-columns: minmax(320px, .85fr) minmax(480px, 1.35fr) minmax(300px, .8fr);
      gap: 16px;
      align-items: start;
    }

    .panel {
      border-radius: 26px;
      padding: 18px;
    }

    .workflow-panel,
    .governance-panel {
      position: sticky;
      top: 18px;
    }

    .ai-search {
      display: grid;
      gap: 7px;
      margin: 12px 0;
    }

    .ai-search input {
      width: 100%;
      border: 1px solid var(--line);
      border-radius: 16px;
      padding: 12px 14px;
      font: inherit;
      font-weight: 750;
    }

    .category-tabs {
      margin: 12px 0 14px;
    }

    .category-tabs button {
      cursor: pointer;
    }

    .category-tabs button.active {
      background: #0f766e;
      color: #fff;
      border-color: #0f766e;
    }

    .category-tabs small {
      margin-left: 5px;
      opacity: .75;
    }

    .workflow-list {
      display: grid;
      gap: 10px;
      max-height: 720px;
      overflow: auto;
      padding-right: 4px;
    }

    .workflow-card {
      display: grid;
      grid-template-columns: 42px minmax(0, 1fr) auto;
      gap: 12px;
      align-items: center;
      width: 100%;
      text-align: left;
      border: 1px solid var(--line);
      border-radius: 18px;
      padding: 12px;
      background: #fff;
      cursor: pointer;
      color: var(--ink);
    }

    .workflow-card.active {
      border-color: #0f766e;
      background: linear-gradient(135deg, rgba(15, 118, 110, .10), #fff);
      box-shadow: 0 12px 35px rgba(15, 118, 110, .14);
    }

    .workflow-card.disabled {
      opacity: .55;
    }

    .workflow-card strong,
    .workflow-card small {
      display: block;
    }

    .workflow-card em {
      color: var(--teal);
      font-size: 11px;
      font-style: normal;
      font-weight: 950;
      text-transform: uppercase;
    }

    .workflow-icon {
      display: grid;
      place-items: center;
      width: 42px;
      height: 42px;
      border-radius: 14px;
      background: #e9f8f5;
      color: #0f766e;
      font-weight: 950;
    }

    .command-header {
      display: flex;
      justify-content: space-between;
      gap: 14px;
      margin-bottom: 16px;
    }

    .command-header h2 {
      margin: 4px 0;
      font-size: clamp(28px, 4vw, 46px);
      line-height: 1;
      letter-spacing: -0.05em;
    }

    .command-header p {
      color: var(--muted);
      font-weight: 750;
    }

    .task-badges {
      align-content: flex-start;
      justify-content: flex-end;
      min-width: 230px;
    }

    .task-badges .warn,
    .warning-text,
    .task-health-list .warn {
      color: var(--red);
    }

    .enterprise-form {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 12px;
    }

    .enterprise-form .full {
      grid-column: 1 / -1;
    }

    .field {
      display: grid;
      gap: 7px;
      color: var(--muted);
      font-size: 12px;
      font-weight: 900;
    }

    .field input,
    .field select,
    .field textarea {
      width: 100%;
      border: 1px solid var(--line);
      border-radius: 16px;
      padding: 12px 13px;
      background: #fff;
      color: var(--ink);
      font: inherit;
      font-weight: 750;
    }

    .field textarea {
      min-height: 146px;
      resize: vertical;
    }

    .safety-strip {
      display: grid;
      border-radius: 18px;
      background: linear-gradient(135deg, rgba(15, 118, 110, .10), rgba(183, 121, 31, .10));
    }

    .safety-strip strong {
      color: var(--ink);
    }

    .form-actions {
      display: flex;
      justify-content: flex-end;
      gap: 10px;
      flex-wrap: wrap;
    }

    .governance-stack,
    .queue-stack {
      display: grid;
      gap: 10px;
    }

    .governance-stack article,
    .queue-stack article,
    .result-metrics article,
    .approval-checklist article,
    .answer-card,
    .action-card,
    .mini-feed div {
      border: 1px solid var(--line);
      border-radius: 18px;
      background: #fff;
      padding: 14px;
    }

    .governance-stack strong,
    .queue-stack strong,
    .answer-card strong,
    .result-metrics strong,
    .approval-checklist strong,
    .mini-feed strong {
      display: block;
      margin: 5px 0;
    }

    .task-health-list {
      display: grid;
      gap: 8px;
      margin-top: 14px;
    }

    .task-health-list div {
      display: flex;
      justify-content: space-between;
      gap: 10px;
      border-bottom: 1px dashed var(--line);
      padding-bottom: 8px;
      font-size: 12px;
      font-weight: 850;
    }

    .prompt-registry {
      display: grid;
      gap: 10px;
      margin-top: 16px;
      border-top: 1px solid var(--line);
      padding-top: 14px;
    }

    .registry-head,
    .registry-list div {
      display: flex;
      justify-content: space-between;
      gap: 10px;
      align-items: center;
    }

    .registry-flags {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
    }

    .registry-flags span {
      border-radius: 999px;
      background: #eef7f4;
      color: #0f766e;
      padding: 5px 8px;
      font-size: 11px;
      font-weight: 900;
    }

    .registry-list {
      display: grid;
      gap: 8px;
    }

    .registry-list div {
      border-bottom: 1px dashed var(--line);
      padding-bottom: 8px;
      font-size: 12px;
      font-weight: 850;
    }

    .registry-list small {
      color: var(--muted);
    }

    .ai-result-grid {
      display: grid;
      grid-template-columns: minmax(0, 1.45fr) minmax(320px, .55fr);
      gap: 16px;
      align-items: start;
    }

    .ai-output {
      display: grid;
      gap: 14px;
    }

    .answer-card {
      background: linear-gradient(135deg, #10222b, #143b38);
      color: #fff;
    }

    .answer-card span,
    .answer-card p {
      color: rgba(255, 255, 255, .76);
    }

    .answer-card strong {
      font-size: 24px;
      line-height: 1.2;
      letter-spacing: -0.035em;
    }

    .result-metrics {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
    }

    .quick-grid {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 12px;
    }

    .action-card strong,
    .action-card span,
    .action-card small {
      display: block;
    }

    .action-card span,
    .action-card small {
      margin-top: 6px;
      color: var(--muted);
      font-weight: 750;
    }

    .approval-checklist {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
    }

    .approval-checklist article {
      display: grid;
      gap: 6px;
    }

    .approval-checklist span {
      display: grid;
      place-items: center;
      width: 28px;
      height: 28px;
      border-radius: 10px;
      background: #e9f8f5;
      color: #0f766e;
      font-weight: 950;
    }

    .raw-json {
      border: 1px solid var(--line);
      border-radius: 18px;
      padding: 12px;
      background: #f8fafc;
    }

    .raw-json pre {
      overflow: auto;
      max-height: 320px;
      white-space: pre-wrap;
      font-size: 12px;
    }

    .empty-command {
      display: grid;
      gap: 8px;
      min-height: 260px;
      place-content: center;
      text-align: center;
      border: 1px dashed var(--line);
      border-radius: 22px;
      color: var(--muted);
      font-weight: 850;
    }

    .queue-stack {
      grid-template-columns: 1fr;
    }

    .mini-feed {
      display: grid;
      gap: 10px;
      margin-top: 14px;
    }

    .table-wrap table small {
      display: block;
      color: var(--muted);
      max-width: 650px;
    }

    @media (max-width: 1280px) {
      .ai-command-grid,
      .ai-result-grid,
      .ai-kpi-grid,
      .result-metrics,
      .quick-grid,
      .approval-checklist {
        grid-template-columns: 1fr;
      }

      .workflow-panel,
      .governance-panel {
        position: static;
      }
    }

    @media (max-width: 860px) {
      .ai-hero,
      .command-header {
        flex-direction: column;
      }

      .enterprise-form {
        grid-template-columns: 1fr;
      }

      .hero-actions,
      .task-badges {
        justify-content: flex-start;
      }
    }
  `]
})
export class AiAssistantComponent implements OnInit {
  readonly tools: AiTool[] = [
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
    const value = output.recommendations || output.suggestions || output.clients || output.products || output.risks || output.insights || output.actions || output.segmentIdeas || output.captions || [];
    return this.rows(value).slice(0, 9).map((item) => typeof item === 'string' ? { name: item, value: '' } : item);
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
