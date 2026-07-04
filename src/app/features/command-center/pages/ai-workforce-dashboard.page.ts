import { CommonModule } from '@angular/common';
import { Component, OnInit, computed, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { finalize, forkJoin } from 'rxjs';
import { ApiRecord } from '../../../core/api.service';
import { CommandCenterApi } from '../data/command-center.api';

type AiTab = 'overview' | 'queue' | 'runs' | 'alerts' | 'settings' | 'premium';
type Tone = 'neutral' | 'good' | 'warning' | 'critical';
type QueueFilter = 'all' | 'critical' | 'high' | 'medium' | 'low';
type AlertFilter = QueueFilter;

interface AiTotals {
  agents: number;
  activeAgents: number;
  pendingApprovals: number;
  highRiskActions: number;
  failedRuns: number;
  openAlerts: number;
  aiCostToday: number;
  aiCostMonth: number;
  estimatedKpiImpact: number;
  providerConfigs: number;
  promptVersions: number;
}

interface AiAgent extends ApiRecord {
  id: string;
  agentName?: string;
  agentKey?: string;
  agentType?: string;
  description?: string;
  status?: string;
  riskLevel?: string;
  autonomyLevel?: string;
  providerKey?: string;
  branchId?: string;
  safetyScore?: number;
}

interface AiQueueItem extends ApiRecord {
  id: string;
  agentId?: string;
  runId?: string;
  title?: string;
  summary?: string;
  suggestedAction?: string;
  riskLevel?: string;
  confidence?: number;
  safetyScore?: number;
  approvalStatus?: string;
  status?: string;
  createdAt?: string;
  dueAt?: string;
  proposedActionJson?: unknown;
  beforePayloadJson?: unknown;
  afterPayloadJson?: unknown;
}

interface AiRun extends ApiRecord {
  id: string;
  agentId?: string;
  status?: string;
  riskLevel?: string;
  approvalStatus?: string;
  providerKey?: string;
  modelKey?: string;
  startedAt?: string;
  completedAt?: string;
  durationMs?: number;
  estimatedCost?: number;
  totalTokens?: number;
  resultSummary?: string;
  errorMessage?: string;
  errorText?: string;
  outputJson?: unknown;
}

interface AiRunStep extends ApiRecord {
  id: string;
  stepKey?: string;
  stepName?: string;
  stepOrder?: number;
  status?: string;
  riskLevel?: string;
  approvalStatus?: string;
  inputJson?: unknown;
  outputJson?: unknown;
  errorText?: string;
  startedAt?: string;
  completedAt?: string;
}

interface AiRunDetail extends AiRun {
  steps?: AiRunStep[];
  queue?: AiQueueItem[];
}

interface AiAlert extends ApiRecord {
  id: string;
  agentId?: string;
  runId?: string;
  alertType?: string;
  title?: string;
  message?: string;
  severity?: string;
  riskLevel?: string;
  status?: string;
  createdAt?: string;
}

interface AiSetting extends ApiRecord {
  id?: string;
  agentId: string;
  autonomyLevel?: string;
  approvalRequired?: number | boolean;
  riskThreshold?: string;
  providerKey?: string;
  modelKey?: string;
  promptVersion?: number;
  modulePermissionsJson?: unknown;
  branchPermissionsJson?: unknown;
  status?: string;
}

interface AiDashboard extends ApiRecord {
  totals?: Partial<AiTotals>;
  agents?: AiAgent[];
  queue?: AiQueueItem[];
  alerts?: AiAlert[];
  recentRuns?: AiRun[];
}

interface AiProvider extends ApiRecord {
  providerKey: string;
  providerName?: string;
  modelKey?: string;
  status?: string;
  configured?: boolean;
  envKey?: string;
  apiKeyRef?: string;
}

interface AiMarketplaceTemplate extends ApiRecord {
  templateKey: string;
  agentKey?: string;
  agentName?: string;
  description?: string;
  defaultTaskType?: string;
  riskLevel?: string;
  category?: string;
  moduleKey?: string;
  providerKey?: string;
  requiredProviderKey?: string;
  estimatedMonthlyValue?: number;
  setupMinutes?: number;
  permissionsJson?: unknown;
  installed?: boolean;
}

interface AiPromptVersion extends ApiRecord {
  id: string;
  agentId?: string;
  version?: number;
  status?: string;
  providerKey?: string;
  modelKey?: string;
  promptKey?: string;
  promptTitle?: string;
  promptText?: string;
  systemPrompt?: string;
  userPrompt?: string;
  guardrailsJson?: unknown;
  riskLevel?: string;
  approvalStatus?: string;
  approvedBy?: string;
  approvedAt?: string;
  createdAt?: string;
  updatedAt?: string;
}

interface AiCostSummary {
  todayCost?: number;
  monthCost?: number;
  totalCost?: number;
  totalTokens?: number;
}

interface AiCostReport extends ApiRecord {
  summary?: AiCostSummary;
  byAgent?: Array<ApiRecord & { agentId?: string; totalCost?: number; totalTokens?: number }>;
  rows?: ApiRecord[];
}

interface AiKpiImpact extends ApiRecord {
  id: string;
  agentId?: string;
  kpiLabel?: string;
  impactType?: string;
  estimatedValue?: number;
  estimatedRevenueImpact?: number;
  confidence?: number;
  status?: string;
  impactDate?: string;
}

interface AgentControlRow {
  agent: AiAgent;
  healthScore: number;
  runCount: number;
  successRate: number;
  failureCount: number;
  pendingApprovals: number;
  openAlerts: number;
  costMonth: number;
  tokens: number;
  kpiImpact: number;
  providerReady: boolean;
  lastRunAt: string;
  status: string;
  riskLevel: string;
}

interface ProviderHealthRow {
  provider: AiProvider;
  configured: boolean;
  runs: number;
  failures: number;
  failureRate: number;
  avgLatencyMs: number;
  cost: number;
  tokens: number;
  fallbackRuns: number;
  activeAgents: number;
  healthScore: number;
}

interface AgentRoiRow {
  agent: AiAgent;
  spend: number;
  tokens: number;
  impact: number;
  roi: number;
  runs: number;
  failedRuns: number;
  confidence: number;
}

interface PolicyRow {
  agent: AiAgent;
  setting?: AiSetting;
  autonomy: string;
  riskThreshold: string;
  approvalRequired: boolean;
  providerReady: boolean;
  activePrompt: boolean;
  gate: string;
  score: number;
}

@Component({
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <section class="page-stack ai-workforce-page">
      <div class="greeting">
        <div class="greeting-copy">
          <span class="greeting-eyebrow">Command center</span>
          <h1>Workforce Automation</h1>
          <p>Track agents, approvals, runs, alerts, and costs from one operational view.</p>
        </div>
        <div class="greeting-actions">
          <button class="btn-ghost" type="button" (click)="loadAll()" [disabled]="loading()">Refresh</button>
          <button class="btn-primary" type="button" (click)="registerAgent()" [disabled]="!!saving()">Register agent</button>
        </div>
      </div>

      <div *ngIf="loading()" class="state loading">Loading workforce data...</div>
      <div *ngIf="error()" class="state error">
        {{ error() }}
        <button class="btn-ghost mini" type="button" (click)="loadAll()">Retry</button>
      </div>

      <nav class="ai-tabs" aria-label="Workforce tabs">
        <button
          *ngFor="let tab of tabs"
          type="button"
          [class.active]="activeTab() === tab.id"
          (click)="activeTab.set(tab.id)"
        >
          <span>{{ tab.label }}</span>
          <strong *ngIf="tab.count() !== null">{{ tab.count() }}</strong>
        </button>
      </nav>

      <section *ngIf="activeTab() === 'overview'" class="ai-tab-panel">
        <div class="ai-metrics-grid">
          <article *ngFor="let metric of overviewMetrics()" class="metric-card">
            <span>{{ metric.label }}</span>
            <strong>{{ metric.value }}</strong>
            <small>{{ metric.caption }}</small>
          </article>
        </div>

        <article class="panel executive-brief-panel">
          <div class="section-title">
            <div>
              <h3>Readiness, risk and next actions</h3>
            </div>
            <span class="badge" [ngClass]="executiveTone()">{{ executiveStatusLabel() }}</span>
          </div>

          <div class="executive-brief-grid">
            <div class="executive-score-card neutral-surface" style="background: #fff !important; background-image: none !important;">
              <span>Overall readiness</span>
              <strong>{{ executiveReadinessScore() }}%</strong>
              <small>{{ executiveSummaryLine() }}</small>
              <div class="progress-track"><i [style.width.%]="executiveReadinessScore()"></i></div>
            </div>

            <div class="executive-snapshot-grid">
              <span>
                <strong>{{ executiveRiskCount() }}</strong>
              </span>
              <span>
                <strong>{{ formatCurrency(totalImpactValue()) }}</strong>
              </span>
              <span>
                <strong>{{ marketplaceReadyCount() }}</strong>
              </span>
              <span>
                <strong>{{ roiRatioLabel() }}</strong>
              </span>
            </div>

            <div class="executive-action-list">
              <article *ngFor="let action of executiveActions()" [ngClass]="action.tone">
                <small>{{ action.area }}</small>
                <strong>{{ action.title }}</strong>
                <span>{{ action.detail }}</span>
              </article>
            </div>
          </div>
        </article>

        <article class="panel control-tower-panel">
          <div class="section-title">
            <div>
              <h3>Health, cost, approvals and impact by agent</h3>
            </div>
            <span class="badge" [ngClass]="controlTowerRiskTone()">{{ controlTowerRiskLabel() }}</span>
          </div>

          <div class="control-strip">
            <article>
              <span>Fleet health</span>
              <strong>{{ fleetHealthScore() }}%</strong>
              <small>{{ healthyAgentsCount() }} healthy / {{ agents().length || 0 }} total</small>
            </article>
            <article>
              <span>Approval load</span>
              <strong>{{ totals().pendingApprovals }}</strong>
              <small>{{ totals().highRiskActions }} high-risk actions</small>
            </article>
            <article>
              <span>Run quality</span>
              <strong>{{ fleetSuccessRate() }}%</strong>
              <small>{{ totals().failedRuns }} failed runs</small>
            </article>
            <article>
              <span>Monthly cost</span>
              <strong>{{ formatCurrency(totals().aiCostMonth) }}</strong>
              <small>{{ formatNumber(costSummary().totalTokens || 0) }} tokens</small>
            </article>
          </div>

          <div *ngIf="!controlTowerAgents().length && !loading()" class="empty-state compact">
            <strong>No agent telemetry yet</strong>
            <span>Register and run an agent to populate health, cost and impact rows.</span>
          </div>

          <div class="control-table-wrap" *ngIf="controlTowerAgents().length">
            <table class="control-table">
              <thead>
                <tr>
                  <th>Agent</th>
                  <th>Health</th>
                  <th>Provider</th>
                  <th>Runs</th>
                  <th>Approvals</th>
                  <th>Alerts</th>
                  <th>Cost</th>
                  <th>Impact</th>
                  <th>Last run</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                <tr *ngFor="let row of controlTowerAgents(); trackBy: trackByControlAgent">
                  <td>
                    <strong>{{ row.agent.agentName || row.agent.agentKey || 'AI agent' }}</strong>
                    <small>{{ row.agent.agentType || row.agent.description || 'salon automation' }}</small>
                  </td>
                  <td>
                    <span class="score-pill" [ngClass]="scoreTone(row.healthScore)">{{ row.healthScore }}%</span>
                    <small>{{ row.successRate }}% success</small>
                  </td>
                  <td>
                    <span class="badge" [ngClass]="row.providerReady ? 'good' : 'warning'">
                      {{ providerLabel(settingFor(row.agent.id)?.providerKey || row.agent.providerKey) }}
                    </span>
                  </td>
                  <td>
                    <strong>{{ row.runCount }}</strong>
                    <small>{{ row.failureCount }} failed</small>
                  </td>
                  <td>
                    <strong>{{ row.pendingApprovals }}</strong>
                  </td>
                  <td>
                    <strong>{{ row.openAlerts }}</strong>
                  </td>
                  <td>
                    <strong>{{ formatCurrency(row.costMonth) }}</strong>
                    <small>{{ formatNumber(row.tokens) }} tokens</small>
                  </td>
                  <td>
                    <strong>{{ formatCurrency(row.kpiImpact) }}</strong>
                  </td>
                  <td>
                    <span>{{ formatDate(row.lastRunAt) }}</span>
                    <small>{{ row.status }}</small>
                  </td>
                  <td>
                    <button class="btn-ghost mini" type="button" (click)="focusAgent(row.agent)">Open</button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </article>

        <div class="ai-overview-grid">
          <article class="panel ai-list-panel">
            <div class="section-title">
              <div>
                <h3>Live Workforce</h3>
              </div>
              <span class="badge info">{{ agents().length }} agents</span>
            </div>

            <div *ngIf="!agents().length && !loading()" class="empty-state">
              <strong>No automation agents yet</strong>
              <span>Register an agent to start building the workforce queue.</span>
            </div>

            <button
              *ngFor="let agent of agents(); trackBy: trackById"
              class="agent-card"
              type="button"
              [class.selected]="selectedAgentId() === agent.id"
              (click)="selectedAgentId.set(agent.id)"
            >
              <span class="agent-avatar">{{ initials(agent.agentName || agent.agentKey || 'AI') }}</span>
              <span>
                <strong>{{ agent.agentName || agent.agentKey || 'Unnamed agent' }}</strong>
                <small>{{ agent.description || agent.agentType || 'Approval-safe salon automation agent' }}</small>
              </span>
              <span class="badge" [ngClass]="statusTone(agent.status)">{{ agent.status || 'active' }}</span>
            </button>
          </article>

          <article class="panel agent-detail-panel" *ngIf="selectedAgent() as agent">
            <div class="section-title">
              <div>
                <h3>{{ agent.agentName || agent.agentKey }}</h3>
              </div>
              <span class="badge" [ngClass]="riskTone(agent.riskLevel)">{{ agent.riskLevel || 'low' }} risk</span>
            </div>

            <div class="detail-grid">
              <div>
                <span>Provider</span>
                <strong>{{ providerLabel(settingFor(agent.id)?.providerKey || agent.providerKey) }}</strong>
              </div>
              <div>
                <span>Autonomy</span>
                <strong>{{ autonomyLabel(settingFor(agent.id)?.autonomyLevel || agent.autonomyLevel) }}</strong>
              </div>
              <div>
                <span>Approval</span>
                <strong>{{ isApprovalRequired(settingFor(agent.id)) ? 'Required' : 'Low-risk only' }}</strong>
              </div>
              <div>
                <span>Branch</span>
                <strong>{{ agent.branchId || 'All branches' }}</strong>
              </div>
            </div>

            <div class="agent-safety-card">
              <div>
                <span>Safety score</span>
                <strong>{{ scoreFor(agent) }}%</strong>
              </div>
              <div class="progress-track"><i [style.width.%]="scoreFor(agent)"></i></div>
            </div>

            <div class="agent-actions">
              <button class="btn-primary" type="button" (click)="runAgent(agent)" [disabled]="!!saving()">Run safely</button>
              <button class="btn-ghost" type="button" (click)="simulateAgent(agent)" [disabled]="!!saving()">Simulate</button>
              <button class="btn-ghost" type="button" (click)="toggleAgent(agent)" [disabled]="!!saving()">
                {{ agent.status === 'disabled' ? 'Enable' : 'Disable' }}
              </button>
              <button class="btn-ghost" type="button" (click)="activeTab.set('settings')">Settings</button>
              <button class="btn-ghost" type="button" (click)="activeTab.set('premium')">Premium controls</button>
            </div>

            <div class="section-title compact">
              <h3>Recent runs</h3>
              <span class="muted">{{ selectedAgentRuns().length }} linked</span>
            </div>
            <div *ngIf="!selectedAgentRuns().length" class="empty-state compact">
              <strong>No runs for this agent</strong>
              <span>Use Run safely to create a provider-aware run record.</span>
            </div>
            <div *ngFor="let run of selectedAgentRuns().slice(0, 3); trackBy: trackById" class="run-mini">
              <span class="badge" [ngClass]="statusTone(run.status)">{{ run.status || 'created' }}</span>
              <strong>{{ runSummary(run) }}</strong>
              <small>{{ formatDate(run.startedAt) }} · {{ formatCurrency(run.estimatedCost || 0) }}</small>
            </div>
          </article>
        </div>
      </section>

      <section *ngIf="activeTab() === 'queue'" class="ai-tab-panel">
        <article class="panel">
          <div class="section-title">
            <div>
              <h3>Approval Queue 2.0</h3>
            </div>
            <span class="badge warning">{{ queue().length }} pending</span>
          </div>

          <div *ngIf="!queue().length && !loading()" class="empty-state">
            <strong>No pending decisions</strong>
            <span>High-risk and approval-required suggestions will appear here.</span>
          </div>

          <ng-container *ngIf="queue().length">
            <div class="approval-triage-strip">
              <button
                *ngFor="let filter of queueFilters"
                type="button"
                [class.active]="activeQueueFilter() === filter.id"
                (click)="activeQueueFilter.set(filter.id)"
              >
                <span>{{ filter.label }}</span>
                <strong>{{ queueCount(filter.id) }}</strong>
              </button>
            </div>

            <div class="approval-workbench">
              <div class="queue-grid">
                <article
                  *ngFor="let item of filteredQueue(); trackBy: trackById"
                  class="decision-card"
                  [class.selected]="selectedQueueId() === item.id"
                  (click)="selectQueue(item)"
                >
                  <div class="decision-head">
                    <div>
                      <span class="eyebrow">{{ agentName(item.agentId) }}</span>
                      <h3>{{ item.title || 'Decision needs approval' }}</h3>
                    </div>
                    <span class="badge" [ngClass]="riskTone(item.riskLevel)">{{ item.riskLevel || 'medium' }}</span>
                  </div>
                  <p>{{ item.summary || item.suggestedAction || 'Review the proposed action before any execution.' }}</p>
                  <div class="decision-stats">
                    <span>Confidence <strong>{{ percent(item.confidence) }}</strong></span>
                    <span>Safety <strong>{{ percent(item.safetyScore) }}</strong></span>
                    <span>Age <strong>{{ approvalAge(item) }}</strong></span>
                  </div>
                  <div class="action-chips">
                    <span *ngFor="let chip of actionLabels(item)">{{ chip }}</span>
                  </div>
                  <div class="agent-actions">
                    <button class="btn-primary" type="button" (click)="approveQueue(item); $event.stopPropagation()" [disabled]="!!saving()">Approve</button>
                    <button class="btn-ghost" type="button" (click)="editQueue(item); $event.stopPropagation()" [disabled]="!!saving()">Edit</button>
                    <button class="btn-ghost" type="button" (click)="askAgain(item); $event.stopPropagation()" [disabled]="!!saving()">Ask again</button>
                    <button class="btn-ghost danger-text" type="button" (click)="rejectQueue(item); $event.stopPropagation()" [disabled]="!!saving()">Reject</button>
                  </div>
                </article>
              </div>

              <aside class="approval-detail-panel" *ngIf="selectedQueueItem() as item">
                <div class="section-title compact">
                  <div>
                    <h3>{{ item.title || 'Approval required' }}</h3>
                  </div>
                  <span class="badge" [ngClass]="riskTone(item.riskLevel)">{{ item.riskLevel || 'medium' }}</span>
                </div>

                <p>{{ item.summary || item.suggestedAction || 'Review before execution.' }}</p>

                <div class="decision-stats detail-stats">
                  <span>Agent <strong>{{ agentName(item.agentId) }}</strong></span>
                  <span>Confidence <strong>{{ percent(item.confidence) }}</strong></span>
                  <span>Safety <strong>{{ percent(item.safetyScore) }}</strong></span>
                  <span>Status <strong>{{ item.approvalStatus || item.status || 'pending' }}</strong></span>
                </div>

                <div class="approval-check-grid">
                  <article *ngFor="let check of approvalChecks(item)" [ngClass]="check.tone">
                    <strong>{{ check.label }}</strong>
                    <span>{{ check.value }}</span>
                  </article>
                </div>

                <div class="approval-evidence">
                  <strong>Proposed action</strong>
                  <span>{{ proposedActionSummary(item) }}</span>
                </div>
                <div class="approval-evidence">
                  <strong>Before</strong>
                  <span>{{ jsonSummary(item.beforePayloadJson) }}</span>
                </div>
                <div class="approval-evidence">
                  <strong>After</strong>
                  <span>{{ jsonSummary(item.afterPayloadJson || item.proposedActionJson) }}</span>
                </div>

                <div class="agent-actions">
                  <button class="btn-primary" type="button" (click)="approveQueue(item)" [disabled]="!!saving()">Approve</button>
                  <button class="btn-ghost" type="button" (click)="editQueue(item)" [disabled]="!!saving()">Edit safer copy</button>
                  <button class="btn-ghost" type="button" (click)="askAgain(item)" [disabled]="!!saving()">Ask again</button>
                  <button class="btn-ghost danger-text" type="button" (click)="rejectQueue(item)" [disabled]="!!saving()">Reject</button>
                </div>
              </aside>
            </div>
          </ng-container>
        </article>
      </section>

      <section *ngIf="activeTab() === 'runs'" class="ai-tab-panel">
        <article class="panel">
          <div class="section-title">
            <div>
              <h3>Run timeline, inputs and approval gates</h3>
            </div>
            <span class="badge info">{{ runs().length }} runs</span>
          </div>

          <div *ngIf="!runs().length && !loading()" class="empty-state">
            <strong>No run history yet</strong>
            <span>Agent runs will show duration, token usage, cost and result summaries.</span>
          </div>

          <div class="run-console-grid" *ngIf="runs().length">
            <div class="table-wrap ai-table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Agent</th>
                    <th>Provider</th>
                    <th>Started</th>
                    <th>Duration</th>
                    <th>Status</th>
                    <th>Cost</th>
                    <th>Tokens</th>
                    <th>Summary</th>
                  </tr>
                </thead>
                <tbody>
                  <tr
                    *ngFor="let run of runs(); trackBy: trackById"
                    [class.selected-row]="selectedRunId() === run.id"
                    (click)="selectRun(run)"
                  >
                    <td><strong>{{ agentName(run.agentId) }}</strong></td>
                    <td>{{ providerLabel(run.providerKey) }}</td>
                    <td>{{ formatDate(run.startedAt) }}</td>
                    <td>{{ formatDuration(run.durationMs) }}</td>
                    <td><span class="badge" [ngClass]="statusTone(run.status)">{{ run.status || 'created' }}</span></td>
                    <td>{{ formatCurrency(run.estimatedCost || 0) }}</td>
                    <td>{{ formatNumber(run.totalTokens || 0) }}</td>
                    <td>
                      {{ runSummary(run) }}
                      <small *ngIf="run.errorMessage || run.errorText" class="danger-text">{{ run.errorMessage || run.errorText }}</small>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            <aside class="run-console" *ngIf="selectedRunDetail() as run">
              <div class="section-title compact">
                <div>
                  <h3>{{ agentName(run.agentId) }}</h3>
                </div>
                <span class="badge" [ngClass]="statusTone(run.status)">{{ run.status || 'created' }}</span>
              </div>

              <div class="console-metrics">
                <article>
                  <span>Provider</span>
                  <strong>{{ providerLabel(run.providerKey) }}</strong>
                </article>
                <article>
                  <span>Approval</span>
                  <strong>{{ run.approvalStatus || (run.approvalRequired ? 'pending' : 'not required') }}</strong>
                </article>
                <article>
                  <span>Risk</span>
                  <strong>{{ run.riskLevel || run.safetyClassification || 'low' }}</strong>
                </article>
                <article>
                  <span>Cost</span>
                  <strong>{{ formatCurrency(run.estimatedCost || 0) }}</strong>
                </article>
              </div>

              <div class="run-timeline">
                <article class="timeline-step">
                  <span class="step-dot good"></span>
                  <div>
                    <strong>Input received</strong>
                    <small>{{ formatDate(run.startedAt) }}</small>
                    <p>{{ jsonSummary(run.inputJson) }}</p>
                  </div>
                </article>
                <article *ngFor="let step of run.steps || []; trackBy: trackById" class="timeline-step">
                  <span class="step-dot" [ngClass]="statusTone(step.status)"></span>
                  <div>
                    <strong>{{ step.stepName || step.stepKey || 'Run step' }}</strong>
                    <small>{{ step.status || 'created' }} · {{ formatDuration(stepDuration(step)) }}</small>
                    <p>{{ jsonSummary(step.outputJson || step.inputJson) }}</p>
                    <small *ngIf="step.errorText" class="danger-text">{{ step.errorText }}</small>
                  </div>
                </article>
                <article class="timeline-step" *ngIf="(run.queue || []).length">
                  <span class="step-dot warning"></span>
                  <div>
                    <strong>Approval gate</strong>
                    <small>{{ (run.queue || []).length }} queue item(s)</small>
                    <p>{{ approvalSummary(run.queue || []) }}</p>
                  </div>
                </article>
                <article class="timeline-step">
                  <span class="step-dot" [ngClass]="statusTone(run.status)"></span>
                  <div>
                    <strong>Output produced</strong>
                    <small>{{ formatDate(run.completedAt) }}</small>
                    <p>{{ jsonSummary(run.outputJson) }}</p>
                  </div>
                </article>
              </div>

              <details class="raw-json">
                <summary>Input JSON</summary>
                <pre>{{ run.inputJson | json }}</pre>
              </details>
              <details class="raw-json">
                <summary>Output JSON</summary>
                <pre>{{ run.outputJson | json }}</pre>
              </details>
            </aside>

            <aside class="run-console" *ngIf="!selectedRunDetail() && selectedRunLoading()">
              <div class="empty-state compact">
                <strong>Loading run detail</strong>
                <span>Fetching steps, queue and output evidence.</span>
              </div>
            </aside>
          </div>
        </article>
      </section>

      <section *ngIf="activeTab() === 'alerts'" class="ai-tab-panel">
        <article class="panel">
          <div class="section-title">
            <div>
              <h3>Alerts, triage and response evidence</h3>
            </div>
            <span class="badge danger">{{ alerts().length }} open</span>
          </div>

          <div *ngIf="!alerts().length && !loading()" class="empty-state">
            <strong>No open alerts</strong>
            <span>Provider, cost, high-risk and failed-run alerts will appear here.</span>
          </div>

          <ng-container *ngIf="alerts().length">
            <div class="incident-kpi-grid">
              <article>
                <span>Critical</span>
                <strong>{{ alertCount('critical') }}</strong>
              </article>
              <article>
                <span>High risk</span>
                <strong>{{ alertCount('high') }}</strong>
              </article>
              <article>
                <span>Linked evidence</span>
                <strong>{{ linkedAlertCount() }}</strong>
              </article>
              <article>
                <span>Average age</span>
                <strong>{{ averageAlertAge() }}</strong>
              </article>
            </div>

            <div class="alert-triage-strip">
              <button
                *ngFor="let filter of alertFilters"
                type="button"
                [class.active]="activeAlertFilter() === filter.id"
                (click)="activeAlertFilter.set(filter.id)"
              >
                <span>{{ filter.label }}</span>
                <strong>{{ alertCount(filter.id) }}</strong>
              </button>
            </div>

            <div class="incident-workbench">
              <div class="alerts-grid">
                <article
                  *ngFor="let alert of filteredAlerts(); trackBy: trackById"
                  class="alert-card"
                  [class.selected]="selectedAlert().id === alert.id"
                  [ngClass]="riskTone(alert.riskLevel || alert.severity)"
                  (click)="selectAlert(alert)"
                >
                  <div class="decision-head">
                    <div>
                      <span class="eyebrow">{{ alert.alertType || 'Alert' }}</span>
                      <h3>{{ alert.title || 'Workforce alert' }}</h3>
                    </div>
                    <span class="badge" [ngClass]="riskTone(alert.riskLevel || alert.severity)">{{ alert.severity || alert.riskLevel || 'medium' }}</span>
                  </div>
                  <p>{{ alert.message || 'Review this alert and take the next safe action.' }}</p>
                  <div class="incident-card-meta">
                    <span>{{ agentName(alert.agentId) }}</span>
                    <span>{{ alertAge(alert) }}</span>
                    <span>{{ alert.runId ? 'Run linked' : 'No run link' }}</span>
                  </div>
                  <div class="agent-actions">
                    <button class="btn-ghost" type="button" (click)="acknowledgeAlert(alert); $event.stopPropagation()" [disabled]="!!saving()">Acknowledge</button>
                    <button class="btn-primary" type="button" (click)="resolveAlert(alert); $event.stopPropagation()" [disabled]="!!saving()">Resolve</button>
                  </div>
                </article>
              </div>

              <aside class="incident-detail-panel" *ngIf="selectedAlert() as alert">
                <div class="section-title compact">
                  <div>
                    <span class="eyebrow">{{ alert.alertType || 'Incident' }}</span>
                    <h3>{{ alert.title || 'Workforce alert' }}</h3>
                  </div>
                  <span class="badge" [ngClass]="riskTone(alert.riskLevel || alert.severity)">{{ alert.severity || alert.riskLevel || 'medium' }}</span>
                </div>

                <p>{{ alert.message || 'Review this alert and take the next safe action.' }}</p>

                <div class="incident-evidence-grid">
                  <span>
                    <strong>{{ agentName(alert.agentId) }}</strong>
                  </span>
                  <span>
                    <strong>{{ alertAge(alert) }}</strong>
                  </span>
                  <span>
                    <strong>{{ alertSlaLabel(alert) }}</strong>
                  </span>
                  <span>
                    <strong>{{ alert.status || 'open' }}</strong>
                  </span>
                </div>

                <div class="incident-evidence-list">
                  <article *ngFor="let item of alertEvidence(alert)">
                    <small>{{ item.label }}</small>
                    <strong>{{ item.value }}</strong>
                  </article>
                </div>

                <div class="incident-run-preview" *ngIf="alertLinkedRun(alert) as run">
                  <strong>{{ runSummary(run) }}</strong>
                  <span>{{ formatDate(run.startedAt) }} · {{ formatCurrency(run.estimatedCost || 0) }} · {{ formatNumber(run.totalTokens || 0) }} tokens</span>
                </div>

                <div class="agent-actions">
                  <button class="btn-ghost" type="button" (click)="acknowledgeAlert(alert)" [disabled]="!!saving()">Acknowledge</button>
                  <button class="btn-primary" type="button" (click)="resolveAlert(alert)" [disabled]="!!saving()">Resolve</button>
                  <button class="btn-ghost" type="button" (click)="rerunAlertAgent(alert)" [disabled]="!!saving() || !agentForAlert(alert)">Re-run agent</button>
                </div>
              </aside>
            </div>
          </ng-container>
        </article>
      </section>

      <section *ngIf="activeTab() === 'settings'" class="ai-tab-panel">
        <article class="panel">
          <div class="section-title">
            <div>
              <h3>Agent Settings</h3>
            </div>
            <span class="badge info">Approval ON by default</span>
          </div>

          <div *ngIf="!agents().length && !loading()" class="empty-state">
            <strong>No agents to configure</strong>
            <span>Register an agent before setting provider, autonomy and permissions.</span>
          </div>

          <div *ngIf="agents().length" class="policy-center">
            <div class="policy-kpi-grid">
              <article>
                <span>Policy health</span>
                <strong>{{ policyHealthScore() }}%</strong>
                <small>{{ policyRows().length }} agents governed</small>
              </article>
              <article>
                <span>Approval gated</span>
                <strong>{{ policyApprovalCount() }}</strong>
              </article>
              <article>
                <span>Auto allowed</span>
                <strong>{{ policyAutoCount() }}</strong>
              </article>
              <article>
                <span>Setup gaps</span>
                <strong>{{ policyGapCount() }}</strong>
              </article>
            </div>

            <div class="policy-table-wrap">
              <table class="policy-table">
                <thead>
                  <tr>
                    <th>Agent</th>
                    <th>Gate</th>
                    <th>Autonomy</th>
                    <th>Risk</th>
                    <th>Provider</th>
                    <th>Prompt</th>
                    <th>Policy</th>
                  </tr>
                </thead>
                <tbody>
                  <tr *ngFor="let row of policyRows(); trackBy: trackByPolicyAgent">
                    <td>
                      <strong>{{ row.agent.agentName || row.agent.agentKey || 'AI agent' }}</strong>
                      <small>{{ row.agent.status || 'active' }}</small>
                    </td>
                    <td><span class="badge" [ngClass]="policyTone(row)">{{ row.gate }}</span></td>
                    <td>{{ autonomyLabel(row.autonomy) }}</td>
                    <td>{{ labelize(row.riskThreshold) }}</td>
                    <td>{{ row.providerReady ? 'Ready' : 'Setup needed' }}</td>
                    <td>{{ row.activePrompt ? 'Active' : 'Missing' }}</td>
                    <td>
                      <strong>{{ row.score }}%</strong>
                      <small>{{ policyHint(row) }}</small>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          <div class="settings-grid">
            <article *ngFor="let agent of agents(); trackBy: trackById" class="settings-card">
              <div class="section-title compact">
                <div>
                  <h3>{{ agent.agentName || agent.agentKey }}</h3>
                  <span class="muted">{{ agent.description || 'Safe automation agent' }}</span>
                </div>
                <label class="switch-line">
                  <input
                    type="checkbox"
                    [ngModel]="agent.status !== 'disabled'"
                    (ngModelChange)="toggleAgent(agent)"
                    [disabled]="!!saving()"
                  />
                  <span>{{ agent.status === 'disabled' ? 'Disabled' : 'Enabled' }}</span>
                </label>
              </div>

              <ng-container *ngIf="settingFor(agent.id) as setting">
                <div class="policy-card-strip">
                  <span>
                    <strong>{{ policyRowFor(agent).gate }}</strong>
                  </span>
                  <span>
                    <strong>{{ policyRowFor(agent).score }}%</strong>
                  </span>
                  <span>
                    <strong>{{ policyRowFor(agent).providerReady ? 'Ready' : 'Setup needed' }}</strong>
                  </span>
                </div>

                <div class="settings-form-grid">
                  <label class="field">
                    <span>Autonomy level</span>
                    <select [(ngModel)]="setting.autonomyLevel">
                      <option value="suggest_only">Suggest only</option>
                      <option value="draft_only">Draft only</option>
                      <option value="approval_required">Approval required</option>
                      <option value="auto_execute_low_risk">Auto-execute low-risk</option>
                      <option value="full_auto_disabled">Full auto disabled</option>
                    </select>
                  </label>

                  <label class="field">
                    <span>Risk threshold</span>
                    <select [(ngModel)]="setting.riskThreshold">
                      <option value="low">Low</option>
                      <option value="medium">Medium</option>
                      <option value="high">High</option>
                      <option value="critical">Critical</option>
                    </select>
                  </label>

                  <label class="field">
                    <span>Provider</span>
                    <select [(ngModel)]="setting.providerKey">
                      <option value="not_configured">Local / not configured</option>
                      <option value="openai">OpenAI</option>
                      <option value="anthropic">Anthropic</option>
                      <option value="gemini">Gemini</option>
                    </select>
                  </label>

                  <label class="field">
                    <span>Prompt version</span>
                    <input type="number" min="1" [(ngModel)]="setting.promptVersion" />
                  </label>
                </div>

                <div class="permission-row">
                  <span>Module permissions</span>
                  <strong>{{ permissionSummary(setting.modulePermissionsJson) }}</strong>
                </div>
                <div class="permission-row">
                  <span>Branch permissions</span>
                  <strong>{{ permissionSummary(setting.branchPermissionsJson) }}</strong>
                </div>
                <label class="check-line approval-line">
                  <input
                    type="checkbox"
                    [ngModel]="isApprovalRequired(setting)"
                    (ngModelChange)="setting.approvalRequired = $event ? 1 : 0"
                  />
                  Human approval required
                </label>

                <div class="agent-actions">
                  <button class="btn-primary" type="button" (click)="saveSetting(setting)" [disabled]="!!saving()">Save settings</button>
                  <button class="btn-ghost" type="button" (click)="runAgent(agent)" [disabled]="!!saving()">Test run</button>
                  <button class="btn-ghost" type="button" (click)="simulateAgent(agent)" [disabled]="!!saving()">Simulation</button>
                </div>
              </ng-container>
            </article>
          </div>
        </article>
      </section>

      <section *ngIf="activeTab() === 'premium'" class="ai-tab-panel">
        <div class="premium-grid">
          <article class="panel premium-card">
            <div class="section-title">
              <div>
                <h3>Keys, latency, cost and fallback health</h3>
              </div>
              <span class="badge info">{{ configuredProviders() }} configured</span>
            </div>

            <div class="provider-health-grid">
              <article *ngFor="let row of providerHealthRows(); trackBy: trackByProviderHealth" class="provider-health-card">
                <div class="provider-health-head">
                  <div>
                    <span class="provider-key">{{ row.provider.providerKey }}</span>
                    <h3>{{ row.provider.providerName || providerLabel(row.provider.providerKey) }}</h3>
                  </div>
                  <span class="badge" [ngClass]="providerHealthTone(row)">
                    {{ providerHealthLabel(row) }}
                  </span>
                </div>
                <div class="provider-health-score">
                  <span>Health</span>
                  <strong>{{ row.healthScore }}%</strong>
                  <div class="progress-track"><i [style.width.%]="row.healthScore"></i></div>
                </div>
                <div class="provider-health-stats">
                  <span>Runs <strong>{{ row.runs }}</strong></span>
                  <span>Failures <strong>{{ row.failureRate }}%</strong></span>
                  <span>Latency <strong>{{ formatDuration(row.avgLatencyMs) }}</strong></span>
                  <span>Cost <strong>{{ formatCurrency(row.cost) }}</strong></span>
                  <span>Tokens <strong>{{ formatNumber(row.tokens) }}</strong></span>
                  <span>Agents <strong>{{ row.activeAgents }}</strong></span>
                </div>
                <small>{{ providerHealthHint(row) }}</small>
              </article>
            </div>

            <div class="provider-grid">
              <article *ngFor="let provider of providers(); trackBy: trackByProvider" class="provider-card">
                <div>
                  <span class="provider-key">{{ provider.providerKey }}</span>
                  <h3>{{ provider.providerName || providerLabel(provider.providerKey) }}</h3>
                  <small>{{ provider.envKey || 'Local provider / no secret stored' }}</small>
                </div>
                <span class="badge" [ngClass]="providerConfigured(provider) ? 'success' : 'warning'">
                  {{ providerConfigured(provider) ? 'configured' : 'not configured' }}
                </span>
                <label class="field">
                  <span>Model</span>
                  <input [(ngModel)]="provider.modelKey" placeholder="model key" />
                </label>
                <label class="field" *ngIf="provider.providerKey !== 'local' && provider.providerKey !== 'local_rules'">
                  <span>API key reference</span>
                  <input [(ngModel)]="provider.apiKeyRef" placeholder="env:OPENAI_API_KEY or vault ref" />
                </label>
                <button class="btn-ghost full-button" type="button" (click)="saveProvider(provider)" [disabled]="!!saving()">
                  Save provider
                </button>
              </article>
            </div>
          </article>

          <article class="panel premium-card">
            <div class="section-title">
              <div>
                <h3>Template readiness and deployment plan</h3>
              </div>
              <span class="badge info">{{ marketplace().length }} templates</span>
            </div>

            <div *ngIf="!marketplace().length && !loading()" class="empty-state compact">
              <strong>No marketplace templates</strong>
              <span>Backend marketplace templates will appear here.</span>
            </div>

            <div *ngIf="marketplace().length" class="marketplace-studio">
              <div class="marketplace-kpi-grid">
                <article>
                  <span>Ready</span>
                  <strong>{{ marketplaceReadyCount() }}</strong>
                </article>
                <article>
                  <span>Installed</span>
                  <strong>{{ marketplaceInstalledCount() }}</strong>
                </article>
                <article>
                  <span>High risk</span>
                  <strong>{{ marketplaceRiskCount() }}</strong>
                </article>
                <article>
                  <span>Projected value</span>
                  <strong>{{ formatCurrency(marketplaceProjectedValue()) }}</strong>
                </article>
              </div>

              <div class="marketplace-workbench">
                <div class="marketplace-grid">
                  <article
                    *ngFor="let template of marketplaceRows(); trackBy: trackByTemplate"
                    class="marketplace-card"
                    [class.selected]="selectedTemplate().templateKey === template.templateKey"
                    (click)="selectTemplate(template)"
                  >
                    <div class="marketplace-card-head">
                      <span class="badge" [ngClass]="template.installed ? 'success' : riskTone(template.riskLevel)">
                        {{ template.installed ? 'installed' : (template.riskLevel || 'low') + ' risk' }}
                      </span>
                      <strong>{{ templateReadinessScore(template) }}%</strong>
                    </div>
                    <h3>{{ template.agentName || template.agentKey }}</h3>
                    <p>{{ template.description || 'Approval-safe automation template.' }}</p>
                    <div class="marketplace-meta-row">
                      <span>{{ templateCategory(template) }}</span>
                      <span>{{ template.defaultTaskType || 'manual task' }}</span>
                    </div>
                    <button class="btn-primary full-button" type="button" (click)="installTemplate(template); $event.stopPropagation()" [disabled]="!!saving() || !!template.installed || !templateProviderReady(template)">
                      {{ template.installed ? 'Installed' : templateProviderReady(template) ? 'Install agent' : 'Provider needed' }}
                    </button>
                  </article>
                </div>

                <aside class="marketplace-detail-panel" *ngIf="selectedTemplate() as template">
                  <div class="section-title compact">
                    <div>
                      <span class="eyebrow">{{ templateCategory(template) }}</span>
                      <h3>{{ template.agentName || template.agentKey || template.templateKey }}</h3>
                    </div>
                    <span class="badge" [ngClass]="template.installed ? 'success' : riskTone(template.riskLevel)">
                      {{ template.installed ? 'installed' : templateRiskLabel(template) }}
                    </span>
                  </div>

                  <p>{{ template.description || 'Approval-safe automation template.' }}</p>

                  <div class="template-readiness-grid">
                    <span *ngFor="let check of templateReadiness(template)" [ngClass]="check.tone">
                      <small>{{ check.label }}</small>
                      <strong>{{ check.value }}</strong>
                    </span>
                  </div>

                  <div class="template-rollout-list">
                    <article *ngFor="let step of templateRolloutPlan(template); let i = index">
                      <small>Step {{ i + 1 }}</small>
                      <strong>{{ step }}</strong>
                    </article>
                  </div>

                  <div class="template-value-strip">
                    <span>
                      <strong>{{ templateImpactLabel(template) }}</strong>
                    </span>
                    <span>
                      <strong>{{ template.setupMinutes || 15 }}m</strong>
                    </span>
                    <span>
                      <strong>{{ providerLabel(template.requiredProviderKey || template.providerKey || 'local_rules') }}</strong>
                    </span>
                  </div>

                  <button class="btn-primary full-button" type="button" (click)="installTemplate(template)" [disabled]="!!saving() || !!template.installed || !templateProviderReady(template)">
                    {{ template.installed ? 'Already installed' : templateProviderReady(template) ? 'Install selected template' : 'Complete provider setup first' }}
                  </button>
                </aside>
              </div>
            </div>
          </article>

          <article class="panel premium-card">
            <div class="section-title">
              <div>
                <h3>Govern prompts before activation</h3>
              </div>
              <button class="btn-ghost mini" type="button" (click)="createPromptVersion(selectedAgent())" [disabled]="!!saving() || !selectedAgent()">
                New version
              </button>
            </div>

            <div *ngIf="!promptVersions().length && !loading()" class="empty-state compact">
              <strong>No prompt versions yet</strong>
              <span>Create a version from the selected agent before switching prompts.</span>
            </div>

            <div *ngIf="promptVersions().length" class="prompt-studio">
              <div class="prompt-version-list">
                <button
                  *ngFor="let prompt of promptStudioRows(); trackBy: trackByPrompt"
                  class="prompt-version-card"
                  type="button"
                  [class.selected-row]="selectedPrompt().id === prompt.id"
                  (click)="selectPrompt(prompt)"
                >
                  <span class="prompt-version-main">
                    <strong>{{ prompt.promptTitle || agentName(prompt.agentId) }}</strong>
                    <small>v{{ prompt.version || 1 }} · {{ providerLabel(prompt.providerKey) }} · {{ prompt.modelKey || 'default model' }}</small>
                  </span>
                  <span class="badge" [ngClass]="prompt.status === 'active' ? 'success' : 'info'">{{ prompt.status || 'draft' }}</span>
                </button>
              </div>

              <div *ngIf="selectedPrompt() as prompt" class="prompt-inspector">
                <div class="prompt-inspector-head">
                  <div>
                    <h3>{{ prompt.promptTitle || agentName(prompt.agentId) }}</h3>
                    <small>{{ prompt.promptKey || 'dashboard-prompt' }} · {{ agentName(prompt.agentId) }}</small>
                  </div>
                  <div class="prompt-actions">
                    <button class="btn-ghost mini" type="button" (click)="testPrompt(prompt)" [disabled]="!!saving()">
                      Test
                    </button>
                    <button class="btn-primary mini" type="button" (click)="activatePrompt(prompt)" [disabled]="!!saving() || prompt.status === 'active'">
                      Activate
                    </button>
                  </div>
                </div>

                <div class="prompt-meta-grid">
                  <span>
                    <strong>v{{ prompt.version || 1 }}</strong>
                  </span>
                  <span>
                    <strong>{{ prompt.approvalStatus || 'pending' }}</strong>
                  </span>
                  <span>
                    <strong>{{ prompt.riskLevel || 'medium' }}</strong>
                  </span>
                  <span>
                    <strong>{{ formatDate(prompt.createdAt) }}</strong>
                  </span>
                </div>

                <div class="prompt-readiness-grid">
                  <span *ngFor="let check of promptReadiness(prompt)" [ngClass]="check.tone">
                    <small>{{ check.label }}</small>
                    <strong>{{ check.value }}</strong>
                  </span>
                </div>

                <div class="prompt-compare">
                  <div>
                    <strong>{{ activePromptLabel(prompt.agentId) }}</strong>
                  </div>
                  <div>
                    <strong>v{{ prompt.version || 1 }} · {{ prompt.status || 'draft' }}</strong>
                  </div>
                </div>

                <div class="prompt-preview-grid">
                  <div>
                    <p>{{ promptSnippet(prompt.systemPrompt || prompt.promptText || prompt.userPrompt) }}</p>
                  </div>
                  <div>
                    <p>{{ promptSnippet(prompt.guardrailsJson || 'Approval required for risky actions, tenant scoped output, no direct production writes without queue gate.') }}</p>
                  </div>
                </div>
              </div>
            </div>
          </article>

          <article class="panel premium-card">
            <div class="section-title">
              <div>
                <h3>Spend, value and agent economics</h3>
              </div>
              <button class="btn-ghost mini" type="button" (click)="recordKpiImpact(selectedAgent())" [disabled]="!!saving() || !selectedAgent()">
                Add impact
              </button>
            </div>

            <div class="cost-grid">
              <div>
                <span>Today</span>
                <strong>{{ formatCurrency(costSummary().todayCost || 0) }}</strong>
              </div>
              <div>
                <span>This month</span>
                <strong>{{ formatCurrency(costSummary().monthCost || 0) }}</strong>
              </div>
              <div>
                <span>Projected impact</span>
                <strong>{{ formatCurrency(totalImpactValue()) }}</strong>
              </div>
              <div>
                <span>ROI ratio</span>
                <strong>{{ roiRatioLabel() }}</strong>
              </div>
            </div>

            <div class="roi-health-strip">
              <div>
                <span class="badge" [ngClass]="roiHealthTone()">{{ roiHealthLabel() }}</span>
                <strong>{{ formatCurrency(costPerRun()) }}</strong>
                <small>average cost per run · {{ formatNumber(costSummary().totalTokens || 0) }} tokens</small>
              </div>
              <div class="spend-meter" aria-label="AI spend efficiency">
                <span [style.width.%]="roiEfficiencyPercent()"></span>
              </div>
            </div>

            <div *ngIf="!kpiImpact().length && !loading()" class="empty-state compact">
              <strong>No KPI impact tracked</strong>
              <span>Record projected savings or recovered revenue from selected agents.</span>
            </div>

            <div class="roi-workbench">
              <div class="roi-table-wrap" *ngIf="roiRows().length">
                <table class="roi-table">
                  <thead>
                    <tr>
                      <th>Agent</th>
                      <th>Spend</th>
                      <th>Impact</th>
                      <th>ROI</th>
                      <th>Runs</th>
                      <th>Confidence</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr *ngFor="let row of roiRows(); trackBy: trackByRoiAgent">
                      <td>
                        <strong>{{ row.agent.agentName || row.agent.agentKey || 'AI agent' }}</strong>
                        <small>{{ providerLabel(settingFor(row.agent.id)?.providerKey || row.agent.providerKey) }}</small>
                      </td>
                      <td>
                        <strong>{{ formatCurrency(row.spend) }}</strong>
                        <small>{{ formatNumber(row.tokens) }} tokens</small>
                      </td>
                      <td>{{ formatCurrency(row.impact) }}</td>
                      <td><span class="badge" [ngClass]="roiTone(row)">{{ roiLabel(row) }}</span></td>
                      <td>
                        <strong>{{ row.runs }}</strong>
                        <small>{{ row.failedRuns }} failed</small>
                      </td>
                      <td>{{ percent(row.confidence) }}</td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <aside class="roi-agent-panel">
                <div class="section-title compact">
                  <div>
                    <h3>{{ selectedAgent().agentName || selectedAgent().agentKey || 'No agent selected' }}</h3>
                  </div>
                  <span class="badge" [ngClass]="selectedAgentRoiTone()">{{ selectedAgentRoiLabel() }}</span>
                </div>
                <div class="roi-agent-stats">
                  <span>
                    <strong>{{ selectedAgentRuns().length }}</strong>
                  </span>
                  <span>
                    <strong>{{ formatCurrency(selectedAgentSpend()) }}</strong>
                  </span>
                  <span>
                    <strong>{{ formatCurrency(selectedAgentImpactValue()) }}</strong>
                  </span>
                </div>
                <div class="kpi-impact-list compact-list">
                  <article *ngFor="let impact of selectedAgentImpact().slice(0, 4); trackBy: trackById" class="kpi-impact-card">
                    <div>
                      <h3>{{ impact.kpiLabel || impact.impactType || 'Impact' }}</h3>
                      <small>{{ percent(impact.confidence) }} confidence · {{ impact.status || 'projected' }}</small>
                    </div>
                    <strong>{{ formatCurrency(impactAmount(impact)) }}</strong>
                  </article>
                </div>
              </aside>
            </div>
          </article>
        </div>
      </section>
    </section>
  `,
  styles: [`
    :host { display: contents; }
    .page-stack {
      padding: 24px 32px;
      display: flex;
      flex-direction: column;
      gap: 20px;
      background: #FAF8F6;
      min-height: 100vh;
    }

    /* ── Greeting ── */
    .greeting {
      display: flex;
      justify-content: space-between;
      align-items: flex-end;
      gap: 24px;
      flex-wrap: wrap;
    }
    .greeting-copy h1 {
      font-size: 20px; font-weight: 500;
      margin: 0; color: #2b2220;
    }
    .greeting-eyebrow {
      font-size: 11px; letter-spacing: .06em;
      text-transform: uppercase; color: #8f5c54; font-weight: 600;
    }
    .greeting-copy p {
      font-size: 13px; line-height: 1.45; color: #6F778A; margin: 2px 0 0;
    }
    .greeting-actions { display: flex; gap: 8px; }

    /* ── Buttons ── */
    .btn-ghost {
      display: inline-flex; align-items: center;
      height: 30px; padding: 0 12px; border-radius: 6px;
      font-size: 12px; font-weight: 500; color: #6F778A;
      background: #fff; border: 1px solid #E7DDD6;
      text-decoration: none; cursor: pointer;
      transition: background .15s, border-color .15s;
    }
    .btn-ghost:hover { background: #F8EEF4; border-color: #E7DDD6; color: #4B1238; }
    .btn-ghost.mini { height: 26px; padding: 0 10px; font-size: 11px; }
    .btn-primary {
      display: inline-flex; align-items: center;
      height: 32px; padding: 0 16px; border-radius: 6px;
      font-size: 12px; font-weight: 500; color: #fff;
      background: #4B1238; border: 0;
      text-decoration: none; cursor: pointer;
      transition: background .15s;
    }
    .btn-primary:hover { background: #3d0e2e; }
    .btn-primary.mini { height: 28px; padding: 0 12px; font-size: 11px; }

    .ai-workforce-page {
      color: #2b2220;
    }

    .ai-tabs {
      display: flex;
      flex-wrap: wrap;
      gap: 4px;
      padding: 4px;
      background: #F8EEF4;
      border-radius: 10px;
    }

    .ai-tabs button {
      height: 34px;
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 0 14px;
      border: 0;
      border-radius: 8px;
      color: #6F778A;
      background: transparent;
      font-weight: 500;
      font-size: 13px;
      cursor: pointer;
      transition: background .15s, color .15s;
    }
    .ai-tabs button:hover { background: #E7DDD6; color: #4B1238; }

    .ai-tabs button.active {
      color: #fff;
      background: #4B1238;
    }

    .ai-tabs strong {
      min-width: 22px;
      height: 22px;
      display: grid;
      place-items: center;
      border-radius: 999px;
      background: #F8EEF4;
      color: #4B1238;
      font-size: 11px;
      font-weight: 600;
    }

    .ai-tabs button.active strong {
      background: rgba(255, 255, 255, 0.2);
      color: #fff;
    }

    .ai-tab-panel {
      display: grid;
      gap: 12px;
    }

    .ai-metrics-grid {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 8px;
    }

    .ai-metrics-grid .metric-card,
    .ai-metrics-grid .metric-card.neutral,
    .ai-metrics-grid .metric-card.good,
    .ai-metrics-grid .metric-card.warning,
    .ai-metrics-grid .metric-card.critical {
      background: #fff !important;
      background-image: none !important;
      border-color: #E7DDD6 !important;
      border-left-color: #4B1238 !important;
      box-shadow: 0 1px 2px rgba(75,18,56,.03) !important;
    }

    .ai-overview-grid {
      display: grid;
      grid-template-columns: minmax(360px, 0.9fr) minmax(0, 1.2fr);
      gap: 12px;
      align-items: start;
    }

    .executive-brief-panel {
      display: grid;
      gap: 12px;
    }

    .executive-brief-grid {
      display: grid;
      grid-template-columns: 1fr 1fr 1fr;
      gap: 14px;
      align-items: stretch;
    }

    .executive-score-card {
      display: grid;
      gap: 6px;
      align-content: start;
      padding: 16px;
      border: 1px solid #E7DDD6 !important;
      border-left: 3px solid #4B1238 !important;
      border-radius: 8px;
      background: #fff !important;
      background-image: none !important;
      box-shadow: 0 1px 2px rgba(75,18,56,.03) !important;
    }

    .executive-score-card span {
      font-size: 10px;
      text-transform: uppercase;
      letter-spacing: .05em;
      color: #6F778A;
      font-weight: 600;
    }

    .executive-score-card strong {
      color: #2b2220;
      font-size: 28px;
      font-weight: 550;
      line-height: 1.1;
    }

    .executive-score-card small {
      font-size: 12px;
      color: #6F778A;
      line-height: 1.35;
    }

    .executive-snapshot-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 10px;
    }

    .executive-snapshot-grid span {
      padding: 12px;
      border: 1px solid #E7DDD6;
      border-radius: 8px;
      background: #fff;
    }

    .executive-snapshot-grid small {
      font-size: 10px;
      text-transform: uppercase;
      letter-spacing: .05em;
      color: #6F778A;
      font-weight: 600;
    }

    .executive-snapshot-grid strong {
      display: block;
      margin-top: 4px;
      color: #2b2220;
      font-weight: 600;
      font-size: 14px;
      line-height: 1.25;
    }

    .executive-action-list {
      display: grid;
      gap: 8px;
    }

    .executive-action-list article {
      padding: 12px;
      border: 1px solid #E7DDD6;
      border-radius: 8px;
      background: #fff;
      border-left: 3px solid #E7DDD6;
    }

    .executive-action-list article.good,
    .executive-action-list article.warning,
    .executive-action-list article.danger {
      border-left-color: #4B1238;
    }

    .executive-action-list small {
      font-size: 10px;
      text-transform: uppercase;
      letter-spacing: .05em;
      color: #6F778A;
      font-weight: 600;
    }

    .executive-action-list strong {
      display: block;
      margin-top: 3px;
      color: #2b2220;
      font-weight: 600;
      font-size: 13px;
      line-height: 1.3;
    }

    .executive-action-list span {
      display: block;
      font-size: 12px;
      color: #6F778A;
      line-height: 1.35;
    }

    .control-tower-panel {
      display: grid;
      gap: 12px;
    }

    .control-strip {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 10px;
    }

    .control-strip article {
      padding: 12px;
      border: 1px solid #E7DDD6;
      border-radius: 8px;
      background: #fff;
    }

    .control-strip span {
      display: block;
      color: #6F778A;
      font-size: 10px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: .04em;
    }

    .control-strip strong {
      display: block;
      margin-top: 4px;
      font-size: 18px;
      font-weight: 550;
      color: #2b2220;
    }

    .control-table-wrap {
      overflow-x: auto;
      border: 1px solid #E7DDD6;
      border-radius: 8px;
      background: #fff;
    }

    .control-table {
      width: 100%;
      min-width: 1120px;
      border-collapse: collapse;
    }

    .control-table th,
    .control-table td {
      padding: 8px 10px;
      border-bottom: 1px solid #E7DDD6;
      text-align: left;
      vertical-align: middle;
    }

    .control-table th {
      background: #F8EEF4;
      position: sticky;
      top: 0;
      z-index: 1;
      font-weight: 600;
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: .04em;
      color: #6F778A;
    }

    .control-table td { font-size: 13px; color: #2b2220; }

    .control-table td > strong,
    .control-table td > span {
      display: block;
    }

    .control-table tbody tr { transition: background .12s; }
    .control-table tbody tr:hover td { background: #FAF8F6; }

    .score-pill {
      width: fit-content;
      padding: 5px 9px;
      border-radius: 999px;
      font-weight: 600;
    }

    .score-pill.good {
      color: #4B1238;
      background: #F8EEF4;
    }

    .score-pill.warning {
      color: #4B1238;
      background: #F8EEF4;
    }

    .score-pill.danger {
      color: #4B1238;
      background: #F8EEF4;
    }

    .agent-card {
      width: 100%;
      display: grid;
      grid-template-columns: auto minmax(0, 1fr) auto;
      gap: 12px;
      align-items: center;
      margin-top: 10px;
      padding: 13px;
      border: 1px solid #E7DDD6;
      border-radius: 8px;
      background: #fff;
      color: #2b2220;
      text-align: left;
      box-shadow: 0 1px 2px rgba(75,18,56,.02);
    }

    .detail-grid,
    .settings-form-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 12px;
    }

    .detail-grid div,
    .agent-safety-card,
    .permission-row {
      padding: 13px;
      border: 1px solid #E7DDD6;
      border-radius: 8px;
      background: #fff;
    }

    .detail-grid span,
    .agent-safety-card span,
    .permission-row span {
      display: block;
      color: #6F778A;
      font-size: 0.78rem;
      font-weight: 600;
      text-transform: uppercase;
    }

    .detail-grid strong,
    .agent-safety-card strong,
    .permission-row strong {
      display: block;
      margin-top: 6px;
    }

    .agent-safety-card {
      display: grid;
      grid-template-columns: 150px minmax(0, 1fr);
      gap: 14px;
      align-items: center;
      margin-top: 14px;
    }

    .progress-track {
      height: 10px;
      overflow: hidden;
      border-radius: 999px;
      background: #F8EEF4;
    }

    .progress-track i {
      display: block;
      height: 100%;
      border-radius: inherit;
      background: #4B1238;
    }

    .agent-actions {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
      margin-top: 14px;
    }

    .section-title {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 8px;
    }
    .section-title h3 {
      font-size: 14px; font-weight: 600;
      margin: 0; color: #2b2220; letter-spacing: .01em;
    }
    .section-title.compact {
      margin-top: 16px;
      margin-bottom: 10px;
    }

    .run-mini,
    .decision-card,
    .alert-card,
    .settings-card {
      padding: 14px;
      border: 1px solid #E7DDD6;
      border-radius: 8px;
      background: #fff;
    }

    .run-mini {
      display: grid;
      gap: 5px;
      margin-top: 8px;
    }

    .queue-grid,
    .alerts-grid,
    .settings-grid {
      display: grid;
      gap: 12px;
    }

    .incident-kpi-grid {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 10px;
      margin-bottom: 12px;
    }

    .incident-kpi-grid article {
      padding: 12px;
      border: 1px solid #E7DDD6;
      border-radius: 8px;
      background: #f8f5f2;
    }

    .incident-kpi-grid span,
    .incident-kpi-grid small,
    .incident-card-meta,
    .incident-evidence-grid small,
    .incident-evidence-list small,
    .incident-run-preview small {
      color: #6F778A;
      font-weight: 600;
    }

    .incident-kpi-grid span {
      display: block;
      font-size: 0.78rem;
      text-transform: uppercase;
    }

    .incident-kpi-grid strong {
      display: block;
      margin-top: 5px;
      color: #2b2220;
      font-size: 1.18rem;
    }

    .alert-triage-strip {
      display: grid;
      grid-template-columns: repeat(5, minmax(0, 1fr));
      gap: 6px;
      margin-bottom: 12px;
    }

    .alert-triage-strip button {
      display: flex;
      justify-content: space-between;
      gap: 6px;
      align-items: center;
      padding: 8px 10px;
      border: 1px solid #E7DDD6;
      border-radius: 6px;
      background: #fff;
      color: #6F778A;
      font-weight: 500;
      font-size: 12px;
      cursor: pointer;
      transition: background .15s, border-color .15s, color .15s;
    }
    .alert-triage-strip button:hover {
      background: #FAF8F6;
      border-color: #4B1238;
    }

    .alert-triage-strip button.active {
      border-color: #4B1238;
      background: #F8EEF4;
      color: #4B1238;
    }

    .incident-workbench {
      display: grid;
      grid-template-columns: minmax(0, 1fr) minmax(300px, 0.78fr);
      gap: 14px;
      align-items: start;
    }

    .alert-card {
      cursor: pointer;
    }

    .alert-card.selected {
      border-color: rgba(75, 18, 56, 0.42);
      box-shadow: 0 0 0 2px rgba(75, 18, 56, 0.12);
    }

    .incident-card-meta {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 8px;
      margin-top: 10px;
      font-size: 0.78rem;
    }

    .incident-card-meta span {
      padding: 7px 8px;
      border-radius: 6px;
      background: #F8EEF4;
    }

    .incident-detail-panel {
      display: grid;
      gap: 12px;
      padding: 14px;
      border: 1px solid #E7DDD6;
      border-radius: 8px;
      background: #fff;
    }

    .incident-detail-panel p {
      margin: 0;
      color: #6F778A;
      line-height: 1.5;
    }

    .incident-evidence-grid,
    .incident-evidence-list {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 8px;
    }

    .incident-evidence-grid span,
    .incident-evidence-list article,
    .incident-run-preview {
      padding: 10px;
      border-radius: 6px;
      background: #F8EEF4;
    }

    .incident-evidence-grid strong,
    .incident-evidence-list strong,
    .incident-run-preview strong,
    .incident-run-preview span {
      display: block;
      margin-top: 4px;
      color: #2b2220;
      line-height: 1.35;
    }

    .policy-center {
      display: grid;
      gap: 12px;
      margin-bottom: 14px;
    }

    .policy-kpi-grid {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 10px;
    }

    .policy-kpi-grid article {
      padding: 12px;
      border: 1px solid #E7DDD6;
      border-radius: 8px;
      background: #f8f5f2;
    }

    .policy-kpi-grid span,
    .policy-kpi-grid small,
    .policy-card-strip small,
    .policy-table td small {
      color: #6F778A;
      font-weight: 600;
    }

    .policy-kpi-grid span {
      display: block;
      font-size: 0.78rem;
      text-transform: uppercase;
    }

    .policy-kpi-grid strong {
      display: block;
      margin-top: 5px;
      color: #2b2220;
      font-size: 1.18rem;
    }

    .policy-table-wrap {
      overflow: auto;
      border: 1px solid #E7DDD6;
      border-radius: 8px;
      background: #fff;
    }

    .policy-table {
      width: 100%;
      min-width: 760px;
      border-collapse: collapse;
    }

    .policy-table th,
    .policy-table td {
      padding: 11px;
      border-bottom: 1px solid #E7DDD6;
      text-align: left;
      vertical-align: top;
    }

    .policy-table th {
      background: #F8EEF4;
    }

    .policy-table td strong,
    .policy-table td small {
      display: block;
    }

    .policy-card-strip {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 8px;
    }

    .policy-card-strip span {
      padding: 10px;
      border: 1px solid #E7DDD6;
      border-radius: 6px;
      background: #fff;
    }

    .policy-card-strip strong {
      display: block;
      margin-top: 4px;
      color: #2b2220;
    }

    .approval-triage-strip {
      display: grid;
      grid-template-columns: repeat(5, minmax(0, 1fr));
      gap: 6px;
      margin-bottom: 12px;
    }

    .approval-triage-strip button {
      border: 1px solid #E7DDD6;
      border-radius: 6px;
      background: #fff;
      padding: 8px 10px;
      color: #6F778A;
      font-weight: 500;
      font-size: 12px;
      text-align: left;
      cursor: pointer;
      transition: background .15s, border-color .15s, color .15s;
    }
    .approval-triage-strip button:hover {
      background: #FAF8F6;
      border-color: #4B1238;
    }

    .approval-triage-strip button.active {
      border-color: #4B1238;
      background: #F8EEF4;
      color: #4B1238;
    }

    .approval-triage-strip span {
      display: block;
      color: #6F778A;
      font-size: 10px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: .04em;
    }

    .approval-triage-strip strong {
      display: block;
      margin-top: 3px;
      font-size: 14px;
      font-weight: 600;
      color: #2b2220;
    }

    .approval-workbench {
      display: grid;
      grid-template-columns: minmax(0, 1fr) minmax(360px, 0.62fr);
      gap: 14px;
      align-items: start;
    }

    .decision-card.selected {
      border-color: rgba(75, 18, 56, 0.45);
      background: #F8EEF4;
    }

    .approval-detail-panel {
      display: grid;
      gap: 12px;
      border: 1px solid #E7DDD6;
      border-radius: 8px;
      background: #fff;
      padding: 14px;
    }

    .approval-detail-panel p {
      margin: 0;
      color: #6F778A;
      line-height: 1.5;
    }

    .detail-stats {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }

    .approval-check-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 10px;
    }

    .approval-check-grid article,
    .approval-evidence {
      border: 1px solid #E7DDD6;
      border-radius: 6px;
      background: #f8f5f2;
      padding: 10px;
    }

    .approval-check-grid article {
      border-left: 3px solid #E7DDD6;
    }
    .approval-check-grid article.warning,
    .approval-check-grid article.danger,
    .approval-check-grid article.critical {
      border-left-color: #4B1238;
    }

    .approval-check-grid strong {
      display: block;
      margin-bottom: 4px;
    }

    .approval-check-grid span,
    .approval-evidence span {
      color: #6F778A;
      line-height: 1.45;
      word-break: break-word;
    }

    .decision-head {
      display: flex;
      justify-content: space-between;
      gap: 12px;
      align-items: start;
    }

    .decision-head h3,
    .settings-card h3 {
      margin: 0;
      line-height: 1.25;
    }

    .decision-card p,
    .alert-card p {
      margin: 10px 0;
      color: #6F778A;
      line-height: 1.5;
    }

    .decision-stats {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 10px;
    }

    .decision-stats span {
      padding: 10px;
      border: 1px solid #E7DDD6;
      border-radius: 6px;
      background: #fff;
      color: #6F778A;
      font-size: 13px;
    }

    .decision-stats strong {
      display: block;
      margin-top: 3px;
      color: #2b2220;
    }

    .action-chips {
      display: flex;
      flex-wrap: wrap;
      gap: 7px;
      margin-top: 12px;
    }

    .action-chips span {
      padding: 5px 9px;
      border-radius: 999px;
      background: #F8EEF4;
      color: #4B1238;
      font-size: 11px;
      font-weight: 600;
    }

    .ai-table-wrap table {
      min-width: 1060px;
    }

    .ai-table-wrap tr {
      cursor: pointer;
    }

    .ai-table-wrap tr.selected-row td {
      background: #F8EEF4;
    }

    .run-console-grid {
      display: grid;
      grid-template-columns: minmax(0, 1fr) minmax(360px, 0.6fr);
      gap: 14px;
      align-items: start;
    }

    .run-console {
      display: grid;
      gap: 12px;
      border: 1px solid #E7DDD6;
      border-radius: 8px;
      background: #fff;
      padding: 14px;
    }

    .console-metrics {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 10px;
    }

    .console-metrics article {
      padding: 10px;
      border: 1px solid #E7DDD6;
      border-radius: 6px;
      background: #fff;
    }

    .console-metrics span {
      display: block;
      color: #6F778A;
      font-size: 0.76rem;
      font-weight: 600;
      text-transform: uppercase;
    }

    .console-metrics strong {
      display: block;
      margin-top: 5px;
    }

    .run-timeline {
      display: grid;
      gap: 10px;
    }

    .timeline-step {
      display: grid;
      grid-template-columns: auto minmax(0, 1fr);
      gap: 10px;
      align-items: start;
    }

    .timeline-step p {
      margin: 5px 0 0;
      color: #6F778A;
      line-height: 1.45;
      word-break: break-word;
    }

    .timeline-step small {
      color: #6F778A;
      font-weight: 700;
    }

    .step-dot {
      width: 12px;
      height: 12px;
      margin-top: 5px;
      border-radius: 999px;
      background: #4B1238;
    }

    .step-dot.good,
    .step-dot.warning,
    .step-dot.danger,
    .step-dot.critical {
      background: #4B1238;
    }

    .raw-json {
      border: 1px solid #E7DDD6;
      border-radius: 6px;
      background: #F8EEF4;
      padding: 10px;
    }

    .raw-json summary {
      cursor: pointer;
      font-weight: 600;
    }

    .raw-json pre {
      overflow: auto;
      max-height: 220px;
      margin: 10px 0 0;
      white-space: pre-wrap;
      word-break: break-word;
      font-size: 0.78rem;
    }

    .alert-card.critical,
    .alert-card.danger,
    .alert-card.warning {
      border-left: 3px solid #4B1238;
    }

    .settings-card {
      display: grid;
      gap: 13px;
    }

    .premium-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 14px;
      align-items: start;
    }

    .premium-card {
      min-height: 100%;
    }

    .provider-grid,
    .marketplace-grid,
    .prompt-version-list,
    .kpi-impact-list,
    .provider-health-grid {
      display: grid;
      gap: 10px;
    }

    .provider-grid,
    .marketplace-grid {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }

    .provider-health-grid {
      margin-bottom: 14px;
    }

    .provider-card,
    .marketplace-card,
    .prompt-version-card,
    .kpi-impact-card,
    .provider-health-card {
      display: grid;
      gap: 10px;
      padding: 13px;
      border: 1px solid #E7DDD6;
      border-radius: 8px;
      background: #fff;
    }

    .provider-health-head {
      display: flex;
      justify-content: space-between;
      gap: 12px;
      align-items: start;
    }

    .provider-health-head h3 {
      margin: 0;
      line-height: 1.25;
    }

    .provider-health-score {
      display: grid;
      grid-template-columns: 72px 52px minmax(0, 1fr);
      gap: 10px;
      align-items: center;
      padding: 10px;
      border: 1px solid #E7DDD6;
      border-radius: 6px;
      background: #fff;
    }

    .provider-health-score span,
    .provider-health-stats span {
      color: #6F778A;
      font-size: 0.78rem;
      font-weight: 600;
    }

    .provider-health-score strong,
    .provider-health-stats strong {
      display: block;
      color: #2b2220;
      margin-top: 3px;
    }

    .provider-health-stats {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 8px;
    }

    .provider-health-stats span {
      padding: 9px;
      border: 1px solid #E7DDD6;
      border-radius: 6px;
      background: #fff;
    }

    .provider-health-card small {
      color: #6F778A;
      line-height: 1.45;
    }

    .provider-card h3,
    .marketplace-card h3,
    .prompt-version-card h3,
    .kpi-impact-card h3 {
      margin: 0;
      line-height: 1.25;
    }

    .provider-key {
      display: inline-flex;
      width: fit-content;
      margin-bottom: 5px;
      padding: 2px 7px;
      border-radius: 999px;
      background: #F8EEF4;
      color: #6F778A;
      font-size: 10px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: .04em;
    }

    .marketplace-card p {
      margin: 0;
      color: #6F778A;
      line-height: 1.45;
    }

    .marketplace-studio {
      display: grid;
      gap: 12px;
    }

    .marketplace-kpi-grid {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 10px;
    }

    .marketplace-kpi-grid article,
    .template-value-strip span {
      padding: 10px;
      border: 1px solid #E7DDD6;
      border-radius: 6px;
      background: #F8EEF4;
    }

    .marketplace-kpi-grid span,
    .marketplace-kpi-grid small,
    .template-readiness-grid small,
    .template-rollout-list small,
    .template-value-strip small,
    .marketplace-meta-row {
      color: #6F778A;
      font-weight: 600;
    }

    .marketplace-kpi-grid span {
      display: block;
      font-size: 0.78rem;
      text-transform: uppercase;
    }

    .marketplace-kpi-grid strong,
    .template-value-strip strong {
      display: block;
      margin-top: 4px;
      color: #2b2220;
    }

    .marketplace-workbench {
      display: grid;
      grid-template-columns: minmax(0, 1fr) minmax(280px, 0.82fr);
      gap: 12px;
      align-items: start;
    }

    .marketplace-card {
      cursor: pointer;
    }

    .marketplace-card.selected {
      border-color: rgba(75, 18, 56, 0.42);
      box-shadow: 0 0 0 2px rgba(75, 18, 56, 0.12);
    }

    .marketplace-card-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
    }

    .marketplace-card-head strong {
      color: #2b2220;
    }

    .marketplace-meta-row {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 8px;
      font-size: 0.78rem;
    }

    .marketplace-meta-row span {
      padding: 8px;
      border-radius: 6px;
      background: #F8EEF4;
    }

    .marketplace-detail-panel {
      display: grid;
      gap: 12px;
      padding: 14px;
      border: 1px solid #E7DDD6;
      border-radius: 8px;
      background: #fff;
    }

    .marketplace-detail-panel p {
      margin: 0;
      color: #6F778A;
      line-height: 1.5;
    }

    .template-readiness-grid,
    .template-rollout-list,
    .template-value-strip {
      display: grid;
      gap: 8px;
    }

    .template-readiness-grid {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }

    .template-value-strip {
      grid-template-columns: repeat(3, minmax(0, 1fr));
    }

    .template-readiness-grid span,
    .template-rollout-list article {
      padding: 10px;
      border-radius: 6px;
      background: #F8EEF4;
    }

    .template-readiness-grid span.good {
      border-left: 3px solid #4B1238;
    }

    .template-readiness-grid span.warning {
      border-left: 3px solid #4B1238;
    }

    .template-readiness-grid strong,
    .template-rollout-list strong {
      display: block;
      margin-top: 4px;
      color: #2b2220;
      line-height: 1.35;
    }

    .prompt-studio {
      display: grid;
      grid-template-columns: minmax(220px, 0.82fr) minmax(0, 1.18fr);
      gap: 12px;
      align-items: start;
    }

    .prompt-version-card,
    .kpi-impact-card {
      grid-template-columns: minmax(0, 1fr) auto auto;
      align-items: center;
    }

    .prompt-version-card {
      width: 100%;
      color: inherit;
      text-align: left;
      cursor: pointer;
    }

    .prompt-version-card.selected-row {
      border-color: rgba(75, 18, 56, 0.45);
      box-shadow: 0 0 0 2px rgba(75, 18, 56, 0.12);
    }

    .prompt-version-main {
      display: grid;
      gap: 4px;
      min-width: 0;
    }

    .prompt-version-main strong {
      color: #2b2220;
      line-height: 1.25;
    }

    .prompt-version-main small,
    .prompt-inspector-head small,
    .prompt-preview-grid small,
    .prompt-compare small,
    .prompt-meta-grid small,
    .prompt-readiness-grid small {
      color: #6F778A;
      font-weight: 600;
    }

    .prompt-inspector {
      display: grid;
      gap: 12px;
      padding: 14px;
      border: 1px solid #E7DDD6;
      border-radius: 8px;
      background: #fff;
    }

    .prompt-inspector-head {
      display: flex;
      justify-content: space-between;
      gap: 12px;
      align-items: start;
    }

    .prompt-inspector-head h3 {
      margin: 0;
      line-height: 1.25;
    }

    .prompt-actions {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
      justify-content: flex-end;
    }

    .prompt-meta-grid,
    .prompt-readiness-grid,
    .prompt-preview-grid,
    .prompt-compare {
      display: grid;
      gap: 8px;
    }

    .prompt-meta-grid,
    .prompt-readiness-grid {
      grid-template-columns: repeat(4, minmax(0, 1fr));
    }

    .prompt-preview-grid,
    .prompt-compare {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }

    .prompt-meta-grid span,
    .prompt-readiness-grid span,
    .prompt-preview-grid div,
    .prompt-compare div {
      padding: 10px;
      border-radius: 6px;
      background: #F8EEF4;
      min-width: 0;
    }

    .prompt-readiness-grid span.good {
      border-left: 3px solid #4B1238;
    }

    .prompt-readiness-grid span.warning,
    .prompt-readiness-grid span.danger {
      border-left: 3px solid #4B1238;
    }

    .prompt-meta-grid strong,
    .prompt-readiness-grid strong,
    .prompt-compare strong {
      display: block;
      margin-top: 3px;
      color: #2b2220;
      line-height: 1.25;
    }

    .prompt-preview-grid p {
      margin: 6px 0 0;
      color: #2b2220;
      line-height: 1.45;
      word-break: break-word;
    }

    .cost-grid {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 10px;
      margin-bottom: 12px;
    }

    .cost-grid div {
      padding: 12px;
      border: 1px solid #E7DDD6;
      border-radius: 8px;
      background: #f8f5f2;
    }

    .cost-grid span {
      display: block;
      color: #6F778A;
      font-size: 0.78rem;
      font-weight: 700;
    }

    .cost-grid strong {
      display: block;
      margin-top: 5px;
      font-size: 1.12rem;
    }

    .roi-health-strip {
      display: grid;
      gap: 10px;
      margin-bottom: 12px;
      padding: 12px;
      border: 1px solid #E7DDD6;
      border-radius: 8px;
      background: #fff;
    }

    .roi-health-strip > div:first-child {
      display: flex;
      gap: 10px;
      align-items: center;
      justify-content: space-between;
      flex-wrap: wrap;
    }

    .roi-health-strip strong {
      color: #2b2220;
      font-size: 1.08rem;
    }

    .roi-health-strip small {
      color: #6F778A;
      font-weight: 500;
      font-size: 12px;
    }

    .spend-meter {
      height: 9px;
      overflow: hidden;
      border-radius: 999px;
      background: #F8EEF4;
    }

    .spend-meter span {
      display: block;
      height: 100%;
      border-radius: inherit;
      background: linear-gradient(90deg, #8f5c54, #4B1238);
    }

    .roi-workbench {
      display: grid;
      grid-template-columns: minmax(0, 1.15fr) minmax(260px, 0.85fr);
      gap: 12px;
      align-items: start;
    }

    .roi-table-wrap {
      overflow: auto;
      border: 1px solid #E7DDD6;
      border-radius: 8px;
      background: #fff;
    }

    .roi-table {
      width: 100%;
      border-collapse: collapse;
      min-width: 620px;
    }

    .roi-table th,
    .roi-table td {
      padding: 11px;
      border-bottom: 1px solid #E7DDD6;
      text-align: left;
      vertical-align: top;
    }

    .roi-table th {
      background: #F8EEF4;
    }

    .roi-table td small {
      display: block;
      margin-top: 2px;
      color: #6F778A;
      font-weight: 500;
      font-size: 11px;
    }

    .roi-agent-panel {
      display: grid;
      gap: 12px;
      padding: 13px;
      border: 1px solid #E7DDD6;
      border-radius: 8px;
      background: #fff;
    }

    .roi-agent-stats {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 8px;
    }

    .roi-agent-stats span {
      padding: 10px;
      border: 1px solid #E7DDD6;
      border-radius: 6px;
      background: #fff;
    }

    .roi-agent-stats small {
      color: #6F778A;
      font-weight: 600;
    }

    .roi-agent-stats strong {
      display: block;
      margin-top: 4px;
      color: #2b2220;
    }

    .compact-list {
      gap: 8px;
    }

    .switch-line {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      color: #6F778A;
      font-weight: 700;
      white-space: nowrap;
    }

    .switch-line input,
    .approval-line input {
      width: auto;
      min-height: auto;
      accent-color: #4B1238;
    }

    .permission-row {
      display: flex;
      justify-content: space-between;
      gap: 12px;
    }

    .approval-line {
      padding: 10px 12px;
      border-radius: 6px;
      background: #F8EEF4;
      color: #8f5c54;
      font-weight: 600;
    }

    .ai-workforce-page .panel,
    .premium-card,
    .approval-detail-panel,
    .incident-detail-panel,
    .marketplace-detail-panel,
    .roi-agent-panel,
    .run-console {
      background: #fff;
      border: 1px solid #E7DDD6;
      border-radius: 10px;
      padding: 20px 24px;
      box-shadow: 0 1px 3px rgba(75,18,56,.04), 0 1px 2px rgba(75,18,56,.02);
    }

    .ai-workforce-page .metric-card {
      padding: 14px 16px;
      background: #fff;
      border: 1px solid #E7DDD6;
      border-radius: 8px;
      border-left: 3px solid #4B1238;
      box-shadow: 0 1px 2px rgba(75,18,56,.03);
      display: flex;
      flex-direction: column;
      gap: 2px;
      transition: box-shadow .2s, border-color .2s, transform .2s;
    }

    .ai-workforce-page .metric-card:hover {
      box-shadow: 0 4px 12px rgba(75,18,56,.07);
      border-color: #4B1238;
      transform: translateY(-1px);
    }

    .ai-workforce-page .metric-card span {
      font-size: 10px;
      color: #6F778A;
      font-weight: 500;
      text-transform: uppercase;
      letter-spacing: .05em;
    }

    .ai-workforce-page .metric-card strong {
      font-size: 18px;
      font-weight: 550;
      line-height: 1.25;
      color: #2b2220;
    }

    .ai-workforce-page .metric-card small {
      font-size: 11px;
      color: #6F778A;
      line-height: 1.3;
    }

    .agent-card,
    .run-mini,
    .decision-card,
    .alert-card,
    .settings-card,
    .kpi-impact-card,
    .provider-grid article,
    .marketplace-grid article,
    .marketplace-kpi-grid article,
    .policy-kpi-grid article,
    .incident-kpi-grid article,
    .cost-grid div,
    .console-metrics article,
    .approval-check-grid article,
    .template-readiness-grid span,
    .prompt-meta-grid span,
    .prompt-readiness-grid span,
    .prompt-preview-grid div,
    .detail-grid div,
    .agent-safety-card,
    .permission-row {
      border: 1px solid #E7DDD6;
      border-radius: 8px;
      background: #fff;
      box-shadow: 0 1px 2px rgba(75,18,56,.02);
    }

    .agent-card,
    .run-mini,
    .decision-card,
    .alert-card,
    .settings-card {
      padding: 16px;
    }

    .agent-card:hover,
    .agent-card.selected,
    .decision-card.selected,
    .alert-card.selected,
    .ai-table-wrap tr.selected-row td {
      border-color: #4B1238;
      background: #F8EEF4;
      box-shadow: inset 3px 0 0 #4B1238;
    }

    .agent-avatar {
      width: 42px;
      height: 42px;
      display: grid;
      place-items: center;
      border-radius: 5px;
      background: #4B1238;
      color: #fff;
      font-weight: 700;
      font-size: 14px;
    }

    .agent-card strong {
      font-size: 13px; font-weight: 600; color: #2b2220;
    }
    .agent-card small {
      display: block;
      margin-top: 4px;
      font-size: 12px; color: #6F778A; line-height: 1.4;
    }

    .agent-actions {
      gap: 8px;
      margin-top: 10px;
    }

    .agent-actions .btn-primary,
    .agent-actions .btn-ghost,
    .hero-actions .btn-primary,
    .hero-actions .btn-ghost {
      min-height: 34px;
      border-radius: 6px;
      padding: 0 12px;
      box-shadow: none;
    }

    .ai-table-wrap,
    .control-table-wrap,
    .policy-table-wrap,
    .roi-table-wrap {
      border: 1px solid #E7DDD6;
      border-radius: 8px;
      background: #fff;
      overflow: auto;
    }

    .ai-table-wrap th,
    .policy-table th,
    .roi-table th {
      background: #F8EEF4;
      position: sticky;
      top: 0;
      z-index: 1;
      font-weight: 600;
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: .04em;
      color: #6F778A;
      white-space: nowrap;
    }

    .ai-table-wrap td,
    .policy-table td,
    .roi-table td {
      font-size: 13px;
      color: #2b2220;
    }

    .ai-table-wrap tr,
    .policy-table tr,
    .roi-table tr {
      transition: background .12s;
    }
    .ai-table-wrap tr:hover td,
    .policy-table tr:hover td,
    .roi-table tr:hover td {
      background: #FAF8F6;
    }

    .ai-table-wrap th,
    .ai-table-wrap td,
    .policy-table th,
    .policy-table td,
    .roi-table th,
    .roi-table td {
      padding: 8px 10px;
    }

    .approval-triage-strip button,
    .alert-triage-strip button {
      min-height: 38px;
      border-radius: 6px;
      background: #fff;
    }

    .approval-triage-strip button.active,
    .alert-triage-strip button.active {
      border-color: #4B1238;
      background: #F8EEF4;
      color: #4B1238;
    }

    .badge {
      display: inline-flex;
      align-items: center;
      height: 20px;
      padding: 0 7px;
      border-radius: 4px;
      font-size: 10px;
      font-weight: 600;
      white-space: nowrap;
    }
    .badge.neutral {
      color: #4B1238;
      background: #F8EEF4;
    }
    .badge.good,
    .badge.success,
    .badge.info {
      color: #4B1238;
      background: #F8EEF4;
    }
    .badge.warning {
      color: #4B1238;
      background: #F8EEF4;
    }
    .badge.critical,
    .badge.danger {
      color: #4B1238;
      background: #F8EEF4;
    }

    .metric-card .badge { height: 20px; font-size: 10px; }

    .danger-text {
      color: #4B1238 !important;
    }

    .empty-state.compact {
      min-height: 92px;
    }

    @media (max-width: 1180px) {
      .ai-metrics-grid,
      .executive-brief-grid,
      .ai-overview-grid,
      .settings-form-grid,
      .premium-grid,
      .run-console-grid,
      .approval-workbench,
      .provider-grid,
      .provider-health-stats,
      .marketplace-grid,
      .marketplace-kpi-grid,
      .template-value-strip,
      .cost-grid,
      .roi-agent-stats,
      .policy-kpi-grid,
      .incident-kpi-grid,
      .incident-evidence-grid,
      .incident-evidence-list,
      .prompt-meta-grid,
      .prompt-readiness-grid {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }

      .ai-overview-grid,
      .prompt-studio,
      .roi-workbench,
      .incident-workbench,
      .marketplace-workbench {
        grid-template-columns: 1fr;
      }
    }

    @media (max-width: 760px) {
      .ai-metrics-grid,
      .executive-brief-grid,
      .executive-snapshot-grid,
      .detail-grid,
      .decision-stats,
      .settings-form-grid,
      .premium-grid,
      .run-console-grid,
      .approval-workbench,
      .approval-triage-strip,
      .alert-triage-strip,
      .approval-check-grid,
      .provider-grid,
      .provider-health-stats,
      .provider-health-score,
      .marketplace-grid,
      .marketplace-kpi-grid,
      .marketplace-meta-row,
      .template-readiness-grid,
      .template-value-strip,
      .cost-grid,
      .roi-agent-stats,
      .policy-kpi-grid,
      .policy-card-strip,
      .incident-kpi-grid,
      .incident-card-meta,
      .incident-evidence-grid,
      .incident-evidence-list,
      .prompt-version-card,
      .prompt-meta-grid,
      .prompt-readiness-grid,
      .prompt-preview-grid,
      .prompt-compare,
      .kpi-impact-card,
      .agent-safety-card {
        grid-template-columns: 1fr;
      }

      .agent-card {
        grid-template-columns: auto minmax(0, 1fr);
      }

      .agent-card .badge {
        grid-column: 1 / -1;
        width: fit-content;
      }

      .permission-row,
      .decision-head,
      .prompt-inspector-head {
        flex-direction: column;
      }
    }
  `]
})
export class AiWorkforceDashboardPage implements OnInit {
  readonly tabs: Array<{ id: AiTab; label: string; count: () => number | null }> = [
    { id: 'overview', label: 'Overview', count: () => null },
    { id: 'queue', label: 'Approval Queue', count: () => this.queue().length },
    { id: 'runs', label: 'Run History', count: () => this.runs().length },
    { id: 'alerts', label: 'Alerts', count: () => this.alerts().length },
    { id: 'settings', label: 'Agent Settings', count: () => this.settings().length },
    { id: 'premium', label: 'Premium', count: () => this.providers().length || null }
  ];

  readonly activeTab = signal<AiTab>('overview');
  readonly loading = signal(false);
  readonly saving = signal('');
  readonly error = signal('');
  readonly dashboard = signal<AiDashboard | null>(null);
  readonly agents = signal<AiAgent[]>([]);
  readonly queue = signal<AiQueueItem[]>([]);
  readonly runs = signal<AiRun[]>([]);
  readonly alerts = signal<AiAlert[]>([]);
  readonly settings = signal<AiSetting[]>([]);
  readonly providers = signal<AiProvider[]>([]);
  readonly marketplace = signal<AiMarketplaceTemplate[]>([]);
  readonly promptVersions = signal<AiPromptVersion[]>([]);
  readonly costReport = signal<AiCostReport | null>(null);
  readonly kpiImpact = signal<AiKpiImpact[]>([]);
  readonly selectedAgentId = signal('');
  readonly selectedRunId = signal('');
  readonly selectedRunDetail = signal<AiRunDetail | null>(null);
  readonly selectedRunLoading = signal(false);
  readonly activeQueueFilter = signal<QueueFilter>('all');
  readonly selectedQueueId = signal('');
  readonly selectedPromptId = signal('');
  readonly activeAlertFilter = signal<AlertFilter>('all');
  readonly selectedAlertId = signal('');
  readonly selectedTemplateKey = signal('');

  readonly queueFilters: Array<{ id: QueueFilter; label: string }> = [
    { id: 'all', label: 'All' },
    { id: 'critical', label: 'Critical' },
    { id: 'high', label: 'High' },
    { id: 'medium', label: 'Medium' },
    { id: 'low', label: 'Low' }
  ];

  readonly alertFilters: Array<{ id: AlertFilter; label: string }> = [
    { id: 'all', label: 'All' },
    { id: 'critical', label: 'Critical' },
    { id: 'high', label: 'High' },
    { id: 'medium', label: 'Medium' },
    { id: 'low', label: 'Low' }
  ];

  readonly selectedAgent = computed(() => {
    const id = this.selectedAgentId();
    return this.agents().find((agent) => agent.id === id) || this.agents()[0] || null;
  });

  readonly selectedAgentRuns = computed(() => {
    const id = this.selectedAgent()?.id;
    return id ? this.runs().filter((run) => run.agentId === id) : [];
  });

  readonly configuredProviders = computed(() => this.providers().filter((provider) => this.providerConfigured(provider)).length);

  readonly costSummary = computed(() => this.costReport()?.summary || {});

  readonly providerHealthRows = computed(() => this.providers().map((provider) => this.providerHealthFor(provider))
    .sort((a, b) => a.healthScore - b.healthScore || b.failures - a.failures || b.runs - a.runs));

  readonly controlTowerAgents = computed(() => this.agents().map((agent) => this.controlRowFor(agent))
    .sort((a, b) => a.healthScore - b.healthScore || b.pendingApprovals - a.pendingApprovals || b.openAlerts - a.openAlerts));

  readonly roiRows = computed(() => this.agents().map((agent) => this.roiRowFor(agent))
    .sort((a, b) => b.impact - a.impact || b.roi - a.roi || b.spend - a.spend));

  readonly selectedAgentImpact = computed(() => {
    const agentId = this.selectedAgent()?.id;
    if (!agentId) {
      return [];
    }
    return this.kpiImpact().filter((impact) => impact.agentId === agentId);
  });

  readonly policyRows = computed(() => this.agents().map((agent) => this.policyRowFor(agent))
    .sort((a, b) => a.score - b.score || this.riskRank(b.riskThreshold) - this.riskRank(a.riskThreshold)));

  readonly marketplaceRows = computed(() => this.marketplace().slice().sort((a, b) => {
    const installDelta = Number(a.installed || 0) - Number(b.installed || 0);
    if (installDelta) {
      return installDelta;
    }
    return this.templateReadinessScore(b) - this.templateReadinessScore(a) || this.riskRank(a.riskLevel) - this.riskRank(b.riskLevel);
  }));

  readonly selectedTemplate = computed(() => {
    const selected = this.selectedTemplateKey();
    return this.marketplace().find((template) => template.templateKey === selected) || this.marketplaceRows()[0] || null;
  });

  readonly filteredQueue = computed(() => {
    const filter = this.activeQueueFilter();
    const rows = filter === 'all'
      ? this.queue()
      : this.queue().filter((item) => String(item.riskLevel || 'medium').toLowerCase() === filter);
    return rows.slice().sort((a, b) => this.queuePriority(b) - this.queuePriority(a));
  });

  readonly selectedQueueItem = computed(() => {
    const selected = this.selectedQueueId();
    return this.queue().find((item) => item.id === selected) || this.filteredQueue()[0] || null;
  });

  readonly filteredAlerts = computed(() => {
    const filter = this.activeAlertFilter();
    const rows = filter === 'all'
      ? this.alerts()
      : this.alerts().filter((alert) => this.alertSeverity(alert) === filter);
    return rows.slice().sort((a, b) => this.riskRank(this.alertSeverity(b)) - this.riskRank(this.alertSeverity(a))
      || new Date(b.createdAt || '').getTime() - new Date(a.createdAt || '').getTime());
  });

  readonly selectedAlert = computed(() => {
    const selected = this.selectedAlertId();
    return this.alerts().find((alert) => alert.id === selected) || this.filteredAlerts()[0] || null;
  });

  readonly promptStudioRows = computed(() => this.promptVersions().slice().sort((a, b) => {
    const activeDelta = (b.status === 'active' ? 1 : 0) - (a.status === 'active' ? 1 : 0);
    if (activeDelta) {
      return activeDelta;
    }
    return Number(b.version || 0) - Number(a.version || 0);
  }));

  readonly selectedPrompt = computed(() => {
    const selected = this.selectedPromptId();
    return this.promptVersions().find((prompt) => prompt.id === selected) || this.promptStudioRows()[0] || null;
  });

  readonly overviewMetrics = computed(() => {
    const totals = this.totals();
    return [
      { label: 'Total agents', value: String(totals.agents), caption: `${totals.activeAgents} active`, tone: 'neutral' as Tone },
      { label: 'Pending approvals', value: String(totals.pendingApprovals), caption: 'Human approval required', tone: totals.pendingApprovals ? 'warning' as Tone : 'good' as Tone },
      { label: 'High-risk actions', value: String(totals.highRiskActions), caption: `${totals.openAlerts} open alerts`, tone: totals.highRiskActions ? 'critical' as Tone : 'good' as Tone },
      { label: 'Failed runs', value: String(totals.failedRuns), caption: 'Needs review', tone: totals.failedRuns ? 'critical' as Tone : 'good' as Tone },
      { label: 'Cost today', value: this.formatCurrency(totals.aiCostToday), caption: 'Estimated provider spend', tone: 'neutral' as Tone },
      { label: 'Cost month', value: this.formatCurrency(totals.aiCostMonth), caption: `${this.formatNumber(this.costSummary().totalTokens || 0)} tokens tracked`, tone: 'neutral' as Tone },
      { label: 'Providers', value: `${totals.providerConfigs}/${this.providers().length || 0}`, caption: `${totals.promptVersions} prompt versions`, tone: totals.providerConfigs ? 'good' as Tone : 'warning' as Tone },
      { label: 'KPI impact', value: this.formatCurrency(totals.estimatedKpiImpact), caption: 'Projected value protected', tone: 'good' as Tone }
    ];
  });

  constructor(private readonly api: CommandCenterApi) {}

  ngOnInit(): void {
    this.loadAll();
  }

  loadAll(): void {
    this.loading.set(true);
    this.error.set('');

    forkJoin({
      dashboard: this.api.list<AiDashboard>('ai-workforce/dashboard'),
      agents: this.api.list<AiAgent[]>('ai-workforce/agents'),
      queue: this.api.list<AiQueueItem[]>('ai-workforce/queue'),
      runs: this.api.list<AiRun[]>('ai-workforce/runs'),
      alerts: this.api.list<AiAlert[]>('ai-workforce/alerts'),
      settings: this.api.list<AiSetting[]>('ai-workforce/settings'),
      providers: this.api.list<AiProvider[]>('ai-workforce/providers'),
      marketplace: this.api.list<AiMarketplaceTemplate[]>('ai-workforce/marketplace'),
      promptVersions: this.api.list<AiPromptVersion[]>('ai-workforce/prompt-versions'),
      costReport: this.api.list<AiCostReport>('ai-workforce/costs'),
      kpiImpact: this.api.list<AiKpiImpact[]>('ai-workforce/kpi-impact')
    })
      .pipe(finalize(() => this.loading.set(false)))
      .subscribe({
        next: ({ dashboard, agents, queue, runs, alerts, settings, providers, marketplace, promptVersions, costReport, kpiImpact }) => {
          this.dashboard.set(dashboard);
          this.agents.set(agents || dashboard.agents || []);
          this.queue.set(queue || dashboard.queue || []);
          this.runs.set(runs || dashboard.recentRuns || []);
          this.alerts.set(alerts || dashboard.alerts || []);
          this.settings.set(settings || []);
          this.providers.set(providers || []);
          this.marketplace.set(marketplace || []);
          this.promptVersions.set(promptVersions || []);
          this.costReport.set(costReport || null);
          this.kpiImpact.set(kpiImpact || []);

          if (!this.selectedAgentId() && (agents?.length || dashboard.agents?.length)) {
            this.selectedAgentId.set((agents?.[0] || dashboard.agents?.[0])?.id || '');
          }
          const selectedRunStillVisible = this.selectedRunId() && (runs || []).some((run) => run.id === this.selectedRunId());
          if (!selectedRunStillVisible && runs?.length) {
            this.selectRun(runs[0]);
          } else if (selectedRunStillVisible && !this.selectedRunDetail()) {
            const run = (runs || []).find((item) => item.id === this.selectedRunId());
            if (run) this.selectRun(run);
          }
          const selectedQueueStillVisible = this.selectedQueueId() && (queue || []).some((item) => item.id === this.selectedQueueId());
          if (!selectedQueueStillVisible && queue?.length) {
            this.selectedQueueId.set(queue[0].id);
          }
          const selectedAlertStillVisible = this.selectedAlertId() && (alerts || []).some((alert) => alert.id === this.selectedAlertId());
          if (!selectedAlertStillVisible && alerts?.length) {
            this.selectedAlertId.set(alerts[0].id);
          }
          const selectedPromptStillVisible = this.selectedPromptId() && (promptVersions || []).some((prompt) => prompt.id === this.selectedPromptId());
          if (!selectedPromptStillVisible && promptVersions?.length) {
            this.selectedPromptId.set((promptVersions.find((prompt) => prompt.status === 'active') || promptVersions[0]).id);
          }
          const selectedTemplateStillVisible = this.selectedTemplateKey() && (marketplace || []).some((template) => template.templateKey === this.selectedTemplateKey());
          if (!selectedTemplateStillVisible && marketplace?.length) {
            this.selectedTemplateKey.set((marketplace.find((template) => !template.installed) || marketplace[0]).templateKey);
          }
        },
        error: (err: { message?: string }) => {
          this.error.set(err?.message || 'Unable to load workforce data.');
        }
      });
  }

  registerAgent(): void {
    const stamp = Date.now();
    this.saveAction('register-agent', this.api.post<AiAgent>('ai-workforce/agents', {
      agentKey: `custom-agent-${stamp}`,
      agentName: `Custom Agent ${String(stamp).slice(-4)}`,
      agentType: 'custom',
      description: 'Custom approval-safe salon automation agent.',
      providerKey: 'not_configured',
      autonomyLevel: 'approval_required',
      riskLevel: 'low',
      promptTitle: 'Custom salon operations copilot',
      promptText: 'Review salon operating data and create approval-safe recommendations only.',
      status: 'active'
    }));
  }

  toggleAgent(agent: AiAgent): void {
    const nextAction = agent.status === 'disabled' ? 'enable' : 'disable';
    this.saveAction(agent.id, this.api.post<AiAgent>(`ai-workforce/agents/${agent.id}/${nextAction}`, {}));
  }

  runAgent(agent: AiAgent): void {
    const setting = this.settingFor(agent.id);
    this.saveAction(agent.id, this.api.post<AiRun>(`ai-workforce/agents/${agent.id}/run`, {
      taskType: 'manual_dashboard_run',
      requestedAction: 'Prepare the next safe operational recommendation for this agent.',
      providerKey: setting?.providerKey || agent.providerKey || 'not_configured'
    }));
  }

  simulateAgent(agent: AiAgent | null): void {
    if (!agent) {
      this.error.set('Select an agent before running simulation.');
      return;
    }

    const setting = this.settingFor(agent.id);
    this.saveAction(`simulate-${agent.id}`, this.api.post<AiRun>(`ai-workforce/agents/${agent.id}/simulate`, {
      taskType: 'simulation_mode',
      requestedAction: 'Simulate this agent outcome without writing production data.',
      providerKey: setting?.providerKey || agent.providerKey || 'not_configured'
    }));
  }

  selectRun(run: AiRun): void {
    if (!run?.id) {
      return;
    }
    this.selectedRunId.set(run.id);
    this.selectedRunLoading.set(true);
    this.api.list<AiRunDetail>(`ai-workforce/runs/${run.id}`)
      .pipe(finalize(() => this.selectedRunLoading.set(false)))
      .subscribe({
        next: (detail) => this.selectedRunDetail.set(detail || { ...run, steps: [], queue: [] }),
        error: () => this.selectedRunDetail.set({ ...run, steps: [], queue: [] })
      });
  }

  selectQueue(item: AiQueueItem): void {
    this.selectedQueueId.set(item.id);
  }

  selectPrompt(prompt: AiPromptVersion): void {
    this.selectedPromptId.set(prompt.id);
  }

  selectAlert(alert: AiAlert): void {
    this.selectedAlertId.set(alert.id);
  }

  selectTemplate(template: AiMarketplaceTemplate): void {
    this.selectedTemplateKey.set(template.templateKey);
  }

  approveQueue(item: AiQueueItem): void {
    this.saveAction(item.id, this.api.post(`ai-workforce/queue/${item.id}/approve`, {
      note: 'Approved from Workforce Automation.'
    }));
  }

  rejectQueue(item: AiQueueItem): void {
    this.saveAction(item.id, this.api.post(`ai-workforce/queue/${item.id}/reject`, {
      reason: 'Rejected from Workforce Automation.'
    }));
  }

  editQueue(item: AiQueueItem): void {
    this.saveAction(item.id, this.api.post(`ai-workforce/queue/${item.id}/edit`, {
      editedPayload: {
        summary: `${item.summary || item.suggestedAction || 'Decision'} Manager edited before approval.`,
        editedFromDashboard: true
      }
    }));
  }

  askAgain(item: AiQueueItem): void {
    if (!item.agentId) {
      this.error.set('Agent link is missing for this queue item.');
      return;
    }

    this.saveAction(item.id, this.api.post(`ai-workforce/agents/${item.agentId}/run`, {
      taskType: 'approval_recheck',
      requestedAction: `Re-check this queued decision and produce a safer alternative for ${item.title || item.id}.`,
      sourceQueueId: item.id
    }));
  }

  acknowledgeAlert(alert: AiAlert): void {
    this.saveAction(alert.id, this.api.post(`ai-workforce/alerts/${alert.id}/acknowledge`, {}));
  }

  resolveAlert(alert: AiAlert): void {
    this.saveAction(alert.id, this.api.post(`ai-workforce/alerts/${alert.id}/resolve`, {
      resolutionNote: 'Resolved from Workforce Automation.'
    }));
  }

  rerunAlertAgent(alert: AiAlert): void {
    const agent = this.agentForAlert(alert);
    if (!agent) {
      this.error.set('Agent link is missing for this alert.');
      return;
    }
    this.runAgent(agent);
  }

  saveSetting(setting: AiSetting): void {
    this.saveAction(setting.agentId, this.api.patch(`ai-workforce/settings/${setting.agentId}`, {
      autonomyLevel: setting.autonomyLevel || 'approval_required',
      approvalRequired: this.isApprovalRequired(setting) ? 1 : 0,
      riskThreshold: setting.riskThreshold || 'medium',
      providerKey: setting.providerKey || 'not_configured',
      modelKey: setting.modelKey || 'not_configured',
      promptVersion: Number(setting.promptVersion || 1)
    }));
  }

  saveProvider(provider: AiProvider): void {
    const localProvider = provider.providerKey === 'local' || provider.providerKey === 'local_rules';
    const apiKeyRef = String(provider.apiKeyRef || '').trim();

    this.saveAction(`provider-${provider.providerKey}`, this.api.patch(`ai-workforce/providers/${provider.providerKey}`, {
      status: localProvider || apiKeyRef ? 'configured' : 'not_configured',
      modelKey: provider.modelKey || (localProvider ? 'rules-v1' : 'default'),
      apiKeyRef: apiKeyRef || undefined,
      configJson: {
        source: 'ai_workforce_dashboard',
        secretPolicy: 'reference_only'
      }
    }));
  }

  installTemplate(template: AiMarketplaceTemplate): void {
    this.saveAction(`marketplace-${template.templateKey}`, this.api.post(`ai-workforce/marketplace/${template.templateKey}/install`, {
      status: 'active',
      autonomyLevel: 'approval_required'
    }));
  }

  createPromptVersion(agent: AiAgent | null): void {
    if (!agent) {
      this.error.set('Select an agent before adding a prompt version.');
      return;
    }

    const setting = this.settingFor(agent.id);
    this.saveAction(`prompt-${agent.id}`, this.api.post(`ai-workforce/agents/${agent.id}/prompt-versions`, {
      promptTitle: `${agent.agentName || agent.agentKey} operating prompt`,
      promptKey: `${agent.agentKey || agent.id}-dashboard`,
      promptText: 'Create approval-safe, tenant-scoped salon operations recommendations with risk and confidence scores.',
      providerKey: setting?.providerKey || agent.providerKey || 'not_configured',
      modelKey: setting?.modelKey || 'not_configured',
      status: 'draft',
      approvalStatus: 'pending'
    }));
  }

  activatePrompt(prompt: AiPromptVersion): void {
    if (!prompt.agentId) {
      this.error.set('Agent link is missing for prompt activation.');
      return;
    }

    this.saveAction(`activate-prompt-${prompt.id}`, this.api.post(`ai-workforce/agents/${prompt.agentId}/prompt-versions/${prompt.id}/activate`, {
      approvalStatus: 'approved'
    }));
  }

  testPrompt(prompt: AiPromptVersion): void {
    const agent = this.agentForPrompt(prompt);
    if (!agent) {
      this.error.set('Agent link is missing for prompt test.');
      return;
    }

    this.simulateAgent(agent);
  }

  recordKpiImpact(agent: AiAgent | null): void {
    if (!agent) {
      this.error.set('Select an agent before adding KPI impact.');
      return;
    }

    this.saveAction(`kpi-${agent.id}`, this.api.post('ai-workforce/kpi-impact', {
      agentId: agent.id,
      kpiLabel: `${agent.agentName || agent.agentKey} projected value`,
      impactType: 'simulation_projection',
      estimatedRevenueImpact: 18000,
      confidence: 0.72,
      status: 'projected'
    }));
  }

  focusAgent(agent: AiAgent): void {
    this.selectedAgentId.set(agent.id);
    this.activeTab.set('overview');
  }

  settingFor(agentId?: string): AiSetting | undefined {
    if (!agentId) {
      return undefined;
    }

    return this.settings().find((setting) => setting.agentId === agentId);
  }

  isApprovalRequired(setting?: AiSetting): boolean {
    if (!setting) {
      return true;
    }

    return setting.approvalRequired === true || setting.approvalRequired === 1 || setting.approvalRequired === undefined;
  }

  agentName(agentId?: string): string {
    if (!agentId) {
      return 'Unassigned agent';
    }

    const agent = this.agents().find((item) => item.id === agentId);
    return agent?.agentName || agent?.agentKey || 'AI agent';
  }

  agentForPrompt(prompt: AiPromptVersion): AiAgent | null {
    if (!prompt.agentId) {
      return null;
    }
    return this.agents().find((agent) => agent.id === prompt.agentId) || null;
  }

  activePromptLabel(agentId?: string): string {
    const active = this.promptVersions()
      .filter((prompt) => prompt.agentId === agentId && prompt.status === 'active')
      .sort((a, b) => Number(b.version || 0) - Number(a.version || 0))[0];
    return active ? `v${active.version || 1} · active` : 'No active prompt';
  }

  promptReadiness(prompt: AiPromptVersion): Array<{ label: string; value: string; tone: string }> {
    const providerKey = prompt.providerKey || this.agentForPrompt(prompt)?.providerKey || 'not_configured';
    const provider = this.providers().find((item) => item.providerKey === providerKey);
    const providerReady = providerKey === 'local' || providerKey === 'local_rules' || this.providerConfigured(provider);
    const approved = ['approved', 'active'].includes(String(prompt.approvalStatus || prompt.status || '').toLowerCase());
    const hasPrompt = Boolean(prompt.systemPrompt || prompt.promptText || prompt.userPrompt);
    const hasGuardrails = Boolean(prompt.guardrailsJson);

    return [
      { label: 'Provider', value: providerReady ? 'Ready' : 'Setup needed', tone: providerReady ? 'good' : 'warning' },
      { label: 'Approval', value: approved ? 'Approved' : 'Pending', tone: approved ? 'good' : 'warning' },
      { label: 'Prompt body', value: hasPrompt ? 'Available' : 'Fallback only', tone: hasPrompt ? 'good' : 'warning' },
      { label: 'Guardrails', value: hasGuardrails ? 'Custom' : 'Default policy', tone: hasGuardrails ? 'good' : 'warning' }
    ];
  }

  promptSnippet(value: unknown): string {
    if (!value) {
      return 'No prompt body captured for this version yet.';
    }
    if (typeof value === 'string') {
      return value.slice(0, 260);
    }
    try {
      return JSON.stringify(value).slice(0, 260);
    } catch {
      return 'Prompt data is available but could not be previewed.';
    }
  }

  actionLabels(item: AiQueueItem): string[] {
    const action = item.proposedActionJson;
    if (Array.isArray(action)) {
      return action.slice(0, 3).map((value) => String(value));
    }

    if (action && typeof action === 'object') {
      return Object.entries(action as Record<string, unknown>)
        .slice(0, 3)
        .map(([key, value]) => `${this.labelize(key)}: ${String(value)}`);
    }

    return [item.suggestedAction || 'Review before execution'];
  }

  queueCount(filter: QueueFilter): number {
    if (filter === 'all') {
      return this.queue().length;
    }
    return this.queue().filter((item) => String(item.riskLevel || 'medium').toLowerCase() === filter).length;
  }

  approvalAge(item: AiQueueItem): string {
    const created = new Date(item.createdAt || '').getTime();
    if (!created || Number.isNaN(created)) {
      return 'new';
    }
    const minutes = Math.max(0, Math.floor((Date.now() - created) / 60000));
    if (minutes < 60) {
      return `${minutes}m`;
    }
    const hours = Math.floor(minutes / 60);
    if (hours < 48) {
      return `${hours}h`;
    }
    return `${Math.floor(hours / 24)}d`;
  }

  proposedActionSummary(item: AiQueueItem): string {
    const labels = this.actionLabels(item);
    return labels.length ? labels.join(' | ') : this.jsonSummary(item.proposedActionJson);
  }

  approvalChecks(item: AiQueueItem): Array<{ label: string; value: string; tone: string }> {
    return [
      {
        label: 'Risk gate',
        value: this.labelize(item.riskLevel || 'medium'),
        tone: this.riskTone(item.riskLevel)
      },
      {
        label: 'Human approval',
        value: item.approvalStatus || item.status || 'pending',
        tone: String(item.approvalStatus || item.status || '').toLowerCase() === 'pending' ? 'warning' : 'good'
      },
      {
        label: 'Safety score',
        value: this.percent(item.safetyScore),
        tone: Number(item.safetyScore || 0) < 0.7 ? 'warning' : 'good'
      },
      {
        label: 'Run link',
        value: item.runId ? 'Evidence attached' : 'No run linked',
        tone: item.runId ? 'good' : 'warning'
      }
    ];
  }

  alertCount(filter: AlertFilter): number {
    if (filter === 'all') {
      return this.alerts().length;
    }
    return this.alerts().filter((alert) => this.alertSeverity(alert) === filter).length;
  }

  linkedAlertCount(): number {
    return this.alerts().filter((alert) => Boolean(alert.runId || alert.agentId)).length;
  }

  averageAlertAge(): string {
    const ages = this.alerts()
      .map((alert) => new Date(alert.createdAt || '').getTime())
      .filter((value) => value > 0 && !Number.isNaN(value))
      .map((created) => Math.max(0, Date.now() - created));
    if (!ages.length) {
      return 'new';
    }
    const averageMs = ages.reduce((sum, value) => sum + value, 0) / ages.length;
    return this.durationLabel(averageMs);
  }

  alertAge(alert: AiAlert): string {
    const created = new Date(alert.createdAt || '').getTime();
    if (!created || Number.isNaN(created)) {
      return 'new';
    }
    return this.durationLabel(Math.max(0, Date.now() - created));
  }

  alertSlaLabel(alert: AiAlert): string {
    const severity = this.alertSeverity(alert);
    const ageMs = Math.max(0, Date.now() - new Date(alert.createdAt || '').getTime());
    const limitHours = severity === 'critical' ? 1 : severity === 'high' ? 4 : severity === 'medium' ? 24 : 72;
    if (!ageMs || Number.isNaN(ageMs)) {
      return `${limitHours}h target`;
    }
    const hours = ageMs / 3600000;
    return hours > limitHours ? 'breached' : `${Math.max(0, Math.ceil(limitHours - hours))}h left`;
  }

  alertEvidence(alert: AiAlert): Array<{ label: string; value: string }> {
    const run = this.alertLinkedRun(alert);
    return [
      { label: 'Severity', value: this.labelize(this.alertSeverity(alert)) },
      { label: 'Run evidence', value: run ? `${run.status || 'created'} · ${this.formatDate(run.startedAt)}` : 'No run linked' },
      { label: 'Provider', value: this.providerLabel(run?.providerKey || this.agentForAlert(alert)?.providerKey) },
      { label: 'Resolution path', value: this.alertResolutionPath(alert) }
    ];
  }

  alertLinkedRun(alert: AiAlert): AiRun | null {
    if (!alert.runId) {
      return null;
    }
    return this.runs().find((run) => run.id === alert.runId) || null;
  }

  agentForAlert(alert: AiAlert): AiAgent | null {
    if (!alert.agentId) {
      return null;
    }
    return this.agents().find((agent) => agent.id === alert.agentId) || null;
  }

  alertResolutionPath(alert: AiAlert): string {
    const type = String(alert.alertType || '').toLowerCase();
    if (type.includes('provider')) {
      return 'Check provider health, key reference and fallback route.';
    }
    if (type.includes('cost')) {
      return 'Review ROI studio before increasing run volume.';
    }
    if (type.includes('risk') || this.riskRank(this.alertSeverity(alert)) >= 3) {
      return 'Keep approval gate on and review queued decision evidence.';
    }
    if (type.includes('failed') || type.includes('run')) {
      return 'Inspect linked run console and re-run after correction.';
    }
    return 'Acknowledge, review evidence and resolve after owner check.';
  }

  permissionSummary(value: unknown): string {
    if (Array.isArray(value)) {
      return value.length ? value.join(', ') : 'All allowed';
    }

    if (value && typeof value === 'object') {
      const keys = Object.keys(value as Record<string, unknown>).filter((key) => Boolean((value as Record<string, unknown>)[key]));
      return keys.length ? keys.join(', ') : 'All allowed';
    }

    return 'All allowed';
  }

  runSummary(run: AiRun): string {
    if (run.resultSummary) {
      return run.resultSummary;
    }

    const output = run.outputJson;
    if (output && typeof output === 'object' && 'summary' in output) {
      return String((output as { summary?: unknown }).summary || 'Run completed');
    }

    if (run.errorMessage) {
      return 'Run failed';
    }

    return 'Provider-aware run record';
  }

  stepDuration(step: AiRunStep): number {
    const start = new Date(step.startedAt || '').getTime();
    const end = new Date(step.completedAt || '').getTime();
    if (!start || !end || Number.isNaN(start) || Number.isNaN(end)) {
      return 0;
    }
    return Math.max(0, end - start);
  }

  jsonSummary(value: unknown): string {
    if (!value) {
      return 'No payload captured.';
    }
    if (typeof value === 'string') {
      return value.slice(0, 220);
    }
    if (Array.isArray(value)) {
      return value.slice(0, 2).map((item) => this.jsonSummary(item)).join(' | ') || 'No array items.';
    }
    if (typeof value === 'object') {
      const record = value as Record<string, unknown>;
      const preferred = ['summary', 'decisionType', 'taskType', 'requestedAction', 'prompt', 'approvalGateReason', 'riskLevel']
        .map((key) => record[key])
        .filter((item) => item !== undefined && item !== null && item !== '');
      if (preferred.length) {
        return preferred.map((item) => String(item)).join(' - ').slice(0, 260);
      }
      return Object.entries(record)
        .slice(0, 4)
        .map(([key, item]) => `${this.labelize(key)}: ${typeof item === 'object' ? '[object]' : String(item)}`)
        .join(' - ')
        .slice(0, 260);
    }
    return String(value).slice(0, 220);
  }

  approvalSummary(queue: AiQueueItem[]): string {
    if (!queue.length) {
      return 'No approval queue item attached.';
    }
    return queue
      .slice(0, 2)
      .map((item) => `${item.title || item.summary || 'Approval required'} (${item.approvalStatus || item.status || 'pending'})`)
      .join(' | ');
  }

  alertSeverity(alert: AiAlert): AlertFilter {
    const normalized = String(alert.severity || alert.riskLevel || 'medium').toLowerCase();
    if (normalized === 'critical') {
      return 'critical';
    }
    if (normalized === 'high') {
      return 'high';
    }
    if (normalized === 'low') {
      return 'low';
    }
    return 'medium';
  }

  statusTone(status?: string): string {
    const normalized = String(status || '').toLowerCase();
    if (['active', 'completed', 'approved', 'resolved', 'success', 'posted'].includes(normalized)) {
      return 'good';
    }
    if (['pending', 'created', 'running', 'acknowledged'].includes(normalized)) {
      return 'warning';
    }
    if (['failed', 'disabled', 'rejected', 'open'].includes(normalized)) {
      return 'danger';
    }
    return 'neutral';
  }

  riskTone(risk?: string): string {
    const normalized = String(risk || '').toLowerCase();
    if (normalized === 'critical') {
      return 'critical';
    }
    if (normalized === 'high') {
      return 'danger';
    }
    if (normalized === 'medium') {
      return 'warning';
    }
    return 'good';
  }

  scoreFor(agent: AiAgent): number {
    const agentScore = Number(agent.safetyScore);
    if (Number.isFinite(agentScore) && agentScore > 0) {
      return Math.max(0, Math.min(100, Math.round(agentScore)));
    }

    const setting = this.settingFor(agent.id);
    if (setting?.riskThreshold === 'critical') {
      return 50;
    }
    if (setting?.riskThreshold === 'high') {
      return 70;
    }
    if (setting?.riskThreshold === 'medium') {
      return 86;
    }
    return 94;
  }

  scoreTone(score: number): string {
    if (score >= 80) {
      return 'good';
    }
    if (score >= 60) {
      return 'warning';
    }
    return 'danger';
  }

  fleetHealthScore(): number {
    const rows = this.controlTowerAgents();
    if (!rows.length) {
      return 0;
    }
    return Math.round(rows.reduce((sum, row) => sum + row.healthScore, 0) / rows.length);
  }

  healthyAgentsCount(): number {
    return this.controlTowerAgents().filter((row) => row.healthScore >= 80).length;
  }

  fleetSuccessRate(): number {
    const rows = this.controlTowerAgents();
    const runCount = rows.reduce((sum, row) => sum + row.runCount, 0);
    if (!runCount) {
      return 0;
    }
    const failures = rows.reduce((sum, row) => sum + row.failureCount, 0);
    return Math.max(0, Math.round(((runCount - failures) / runCount) * 100));
  }

  controlTowerRiskLabel(): string {
    const totals = this.totals();
    if (totals.failedRuns || totals.highRiskActions || totals.openAlerts) {
      return 'Needs review';
    }
    if (!this.configuredProviders()) {
      return 'Provider setup needed';
    }
    return 'Healthy';
  }

  controlTowerRiskTone(): string {
    const totals = this.totals();
    if (totals.failedRuns || totals.highRiskActions) {
      return 'danger';
    }
    if (totals.openAlerts || !this.configuredProviders()) {
      return 'warning';
    }
    return 'good';
  }

  autonomyLabel(value?: string): string {
    return this.labelize(value || 'approval_required');
  }

  providerLabel(value?: string): string {
    return this.labelize(value || 'not_configured');
  }

  providerConfigured(provider?: AiProvider): boolean {
    if (!provider) {
      return false;
    }
    if (provider.providerKey === 'local' || provider.providerKey === 'local_rules') {
      return true;
    }
    return provider.configured === true || provider.status === 'configured' || !!provider.apiKeyRef;
  }

  providerHealthTone(row: ProviderHealthRow): string {
    if (!row.configured || row.failureRate >= 25 || row.healthScore < 60) {
      return 'danger';
    }
    if (row.failures || row.healthScore < 82) {
      return 'warning';
    }
    return 'success';
  }

  providerHealthLabel(row: ProviderHealthRow): string {
    if (!row.configured) {
      return 'setup needed';
    }
    if (row.failureRate >= 25) {
      return 'unstable';
    }
    if (row.failures) {
      return 'watch';
    }
    return 'healthy';
  }

  providerHealthHint(row: ProviderHealthRow): string {
    if (!row.configured) {
      return 'Add a key reference or switch agents to local rules before production use.';
    }
    if (!row.runs) {
      return 'Configured, but no recent run evidence is available yet.';
    }
    if (row.failures) {
      return `${row.failures} failed run(s) need review before increasing autonomy.`;
    }
    if (row.fallbackRuns) {
      return `${row.fallbackRuns} local fallback run(s) were recorded for this provider family.`;
    }
    return 'Provider has current run evidence with no failed runs in this view.';
  }

  executiveReadinessScore(): number {
    const providerScore = this.providers().length ? Math.round((this.configuredProviders() / this.providers().length) * 100) : 60;
    const marketplaceScore = this.marketplace().length ? Math.round((this.marketplaceReadyCount() / this.marketplace().length) * 100) : 70;
    const roiScore = Math.min(100, Math.round(this.roiRatio() * 28));
    const incidentPenalty = Math.min(28, this.alertCount('critical') * 10 + this.alertCount('high') * 6);
    const queuePenalty = Math.min(18, this.totals().highRiskActions * 4);
    const base = Math.round((this.fleetHealthScore() + this.policyHealthScore() + providerScore + marketplaceScore + roiScore) / 5);
    return Math.max(0, Math.min(100, base - incidentPenalty - queuePenalty));
  }

  executiveTone(): string {
    const score = this.executiveReadinessScore();
    if (score >= 82) {
      return 'good';
    }
    if (score >= 62) {
      return 'warning';
    }
    return 'danger';
  }

  executiveStatusLabel(): string {
    const score = this.executiveReadinessScore();
    if (score >= 82) {
      return 'ready to scale';
    }
    if (score >= 62) {
      return 'needs controls';
    }
    return 'owner review';
  }

  executiveRiskCount(): number {
    return this.totals().highRiskActions + this.alertCount('critical') + this.alertCount('high') + this.policyGapCount();
  }

  executiveSummaryLine(): string {
    return `${this.healthyAgentsCount()} healthy agents, ${this.policyGapCount()} setup gaps, ${this.totals().pendingApprovals} approvals pending.`;
  }

  executiveActions(): Array<{ area: string; title: string; detail: string; tone: string }> {
    const actions: Array<{ area: string; title: string; detail: string; tone: string }> = [];
    if (this.alertCount('critical') || this.alertCount('high')) {
      actions.push({
        area: 'Incidents',
        title: 'Clear high-severity alerts',
        detail: `${this.alertCount('critical')} critical and ${this.alertCount('high')} high alerts need evidence review.`,
        tone: 'danger'
      });
    }
    if (this.totals().pendingApprovals) {
      actions.push({
        area: 'Approvals',
        title: 'Review pending decisions',
        detail: `${this.totals().pendingApprovals} queued actions, ${this.totals().highRiskActions} high-risk.`,
        tone: this.totals().highRiskActions ? 'warning' : 'neutral'
      });
    }
    if (this.policyGapCount()) {
      actions.push({
        area: 'Policy',
        title: 'Close governance setup gaps',
        detail: `${this.policyGapCount()} agents need provider or prompt readiness before scale.`,
        tone: 'warning'
      });
    }
    if (!this.configuredProviders()) {
      actions.push({
        area: 'Providers',
        title: 'Configure at least one AI provider',
        detail: 'Provider Health Center is still blocking production-grade runs.',
        tone: 'warning'
      });
    }
    if (!actions.length) {
      actions.push({
        area: 'Scale',
        title: 'Expand with ready marketplace agents',
        detail: `${this.marketplaceReadyCount()} templates are ready for approval-gated install.`,
        tone: 'good'
      });
    }
    return actions.slice(0, 4);
  }

  marketplaceReadyCount(): number {
    return this.marketplace().filter((template) => !template.installed && this.templateProviderReady(template)).length;
  }

  marketplaceInstalledCount(): number {
    return this.marketplace().filter((template) => template.installed).length;
  }

  marketplaceRiskCount(): number {
    return this.marketplace().filter((template) => ['high', 'critical'].includes(String(template.riskLevel || '').toLowerCase())).length;
  }

  marketplaceProjectedValue(): number {
    return this.marketplace().reduce((sum, template) => sum + Number(template.estimatedMonthlyValue || this.templateFallbackValue(template)), 0);
  }

  templateCategory(template: AiMarketplaceTemplate): string {
    return this.labelize(template.category || template.moduleKey || template.defaultTaskType || 'salon automation');
  }

  templateRiskLabel(template: AiMarketplaceTemplate): string {
    return `${this.labelize(template.riskLevel || 'low')} risk`;
  }

  templateProviderReady(template: AiMarketplaceTemplate): boolean {
    const key = template.requiredProviderKey || template.providerKey || 'local_rules';
    if (key === 'local' || key === 'local_rules' || key === 'not_configured') {
      return true;
    }
    const provider = this.providers().find((item) => item.providerKey === key);
    return this.providerConfigured(provider);
  }

  templateReadinessScore(template: AiMarketplaceTemplate): number {
    const providerReady = this.templateProviderReady(template);
    const installed = Boolean(template.installed);
    const highRisk = ['high', 'critical'].includes(String(template.riskLevel || '').toLowerCase());
    const hasDescription = Boolean(template.description);
    const hasTask = Boolean(template.defaultTaskType);
    return Math.max(0, Math.min(100, Math.round(
      92
      - (providerReady ? 0 : 28)
      - (installed ? 10 : 0)
      - (highRisk ? 12 : 0)
      - (hasDescription ? 0 : 8)
      - (hasTask ? 0 : 6)
    )));
  }

  templateReadiness(template: AiMarketplaceTemplate): Array<{ label: string; value: string; tone: string }> {
    const providerReady = this.templateProviderReady(template);
    const highRisk = ['high', 'critical'].includes(String(template.riskLevel || '').toLowerCase());
    return [
      { label: 'Provider', value: providerReady ? 'Ready' : 'Setup needed', tone: providerReady ? 'good' : 'warning' },
      { label: 'Risk gate', value: highRisk ? 'Owner approval' : 'Standard', tone: highRisk ? 'warning' : 'good' },
      { label: 'Install state', value: template.installed ? 'Installed' : 'Available', tone: template.installed ? 'good' : 'neutral' },
      { label: 'Permissions', value: template.permissionsJson ? 'Scoped' : 'Default safe', tone: 'good' }
    ];
  }

  templateRolloutPlan(template: AiMarketplaceTemplate): string[] {
    const risk = String(template.riskLevel || 'low').toLowerCase();
    const steps = [
      'Install as approval-required agent.',
      `Run ${template.defaultTaskType || 'simulation'} in safe mode.`,
      'Review first output in approval queue.'
    ];
    if (['high', 'critical'].includes(risk)) {
      steps.push('Keep owner approval gate on before live use.');
    } else {
      steps.push('Move to low-risk auto only after successful evidence.');
    }
    return steps;
  }

  templateImpactLabel(template: AiMarketplaceTemplate): string {
    return this.formatCurrency(Number(template.estimatedMonthlyValue || this.templateFallbackValue(template)));
  }

  policyHealthScore(): number {
    const rows = this.policyRows();
    if (!rows.length) {
      return 0;
    }
    return Math.round(rows.reduce((sum, row) => sum + row.score, 0) / rows.length);
  }

  policyApprovalCount(): number {
    return this.policyRows().filter((row) => row.approvalRequired).length;
  }

  policyAutoCount(): number {
    return this.policyRows().filter((row) => row.autonomy === 'auto_execute_low_risk' && row.providerReady && row.activePrompt).length;
  }

  policyGapCount(): number {
    return this.policyRows().filter((row) => !row.providerReady || !row.activePrompt).length;
  }

  policyTone(row: PolicyRow): string {
    if (row.score >= 82) {
      return 'good';
    }
    if (row.score >= 62) {
      return 'warning';
    }
    return 'danger';
  }

  policyHint(row: PolicyRow): string {
    if (!row.providerReady) {
      return 'Provider key or local fallback needs setup.';
    }
    if (!row.activePrompt) {
      return 'Activate a governed prompt before production use.';
    }
    if (!row.approvalRequired && this.riskRank(row.riskThreshold) >= 3) {
      return 'High-risk autonomy should stay approval gated.';
    }
    if (row.autonomy === 'auto_execute_low_risk') {
      return 'Auto execution is limited to low-risk policy gates.';
    }
    return 'Policy is within the safe operating band.';
  }

  totalImpactValue(): number {
    return this.kpiImpact().reduce((sum, impact) => sum + this.impactAmount(impact), 0);
  }

  roiRatio(): number {
    const spend = Number(this.costSummary().monthCost || this.runs().reduce((sum, run) => sum + Number(run.estimatedCost || 0), 0));
    if (!spend) {
      return this.totalImpactValue() ? 99 : 0;
    }
    return this.totalImpactValue() / spend;
  }

  roiRatioLabel(): string {
    const ratio = this.roiRatio();
    if (!ratio) {
      return '0x';
    }
    if (ratio >= 99) {
      return '99x+';
    }
    return `${ratio.toFixed(ratio >= 10 ? 0 : 1)}x`;
  }

  roiEfficiencyPercent(): number {
    return Math.max(4, Math.min(100, Math.round(this.roiRatio() * 12)));
  }

  costPerRun(): number {
    const spend = Number(this.costSummary().monthCost || this.runs().reduce((sum, run) => sum + Number(run.estimatedCost || 0), 0));
    return this.runs().length ? spend / this.runs().length : 0;
  }

  roiHealthLabel(): string {
    const ratio = this.roiRatio();
    if (ratio >= 3) {
      return 'profitable';
    }
    if (ratio >= 1) {
      return 'watch spend';
    }
    if (this.totalImpactValue()) {
      return 'below target';
    }
    return 'needs impact data';
  }

  roiHealthTone(): string {
    const ratio = this.roiRatio();
    if (ratio >= 3) {
      return 'good';
    }
    if (ratio >= 1 || this.totalImpactValue()) {
      return 'warning';
    }
    return 'neutral';
  }

  selectedAgentSpend(): number {
    return this.selectedAgentRuns().reduce((sum, run) => sum + Number(run.estimatedCost || 0), 0);
  }

  selectedAgentImpactValue(): number {
    return this.selectedAgentImpact().reduce((sum, impact) => sum + this.impactAmount(impact), 0);
  }

  selectedAgentRoiLabel(): string {
    const spend = this.selectedAgentSpend();
    const impact = this.selectedAgentImpactValue();
    if (!spend) {
      return impact ? 'high leverage' : 'no spend';
    }
    const ratio = impact / spend;
    if (ratio >= 3) {
      return `${ratio.toFixed(ratio >= 10 ? 0 : 1)}x ROI`;
    }
    if (ratio >= 1) {
      return 'watch';
    }
    return 'needs proof';
  }

  selectedAgentRoiTone(): string {
    const spend = this.selectedAgentSpend();
    const impact = this.selectedAgentImpactValue();
    if (!spend && impact) {
      return 'good';
    }
    if (!spend) {
      return 'neutral';
    }
    const ratio = impact / spend;
    if (ratio >= 3) {
      return 'good';
    }
    if (ratio >= 1) {
      return 'warning';
    }
    return 'danger';
  }

  roiTone(row: AgentRoiRow): string {
    if (row.roi >= 3 || (!row.spend && row.impact)) {
      return 'good';
    }
    if (row.roi >= 1 || row.impact) {
      return 'warning';
    }
    return row.spend ? 'danger' : 'neutral';
  }

  roiLabel(row: AgentRoiRow): string {
    if (!row.spend) {
      return row.impact ? 'high leverage' : 'no spend';
    }
    if (!row.impact) {
      return 'unproven';
    }
    return `${row.roi.toFixed(row.roi >= 10 ? 0 : 1)}x`;
  }

  impactAmount(impact: AiKpiImpact): number {
    return Number(impact.estimatedValue ?? impact.estimatedRevenueImpact ?? 0);
  }

  initials(value: string): string {
    return value
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join('') || 'AI';
  }

  percent(value?: number): string {
    const numeric = Number(value || 0);
    if (!Number.isFinite(numeric)) {
      return '0%';
    }

    const normalized = numeric > 1 ? numeric : numeric * 100;
    return `${Math.round(normalized)}%`;
  }

  formatDate(value?: string): string {
    if (!value) {
      return 'Not started';
    }

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return value;
    }

    return date.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
  }

  formatDuration(value?: number): string {
    const ms = Number(value || 0);
    if (!ms) {
      return '0s';
    }
    if (ms < 1000) {
      return `${ms}ms`;
    }
    if (ms < 60000) {
      return `${Math.round(ms / 1000)}s`;
    }
    return `${Math.round(ms / 60000)}m`;
  }

  formatCurrency(value: number): string {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      maximumFractionDigits: value >= 100 ? 0 : 2
    }).format(Number(value || 0));
  }

  formatNumber(value: number): string {
    return new Intl.NumberFormat('en-IN').format(Number(value || 0));
  }

  trackById(_index: number, item: { id?: string }): string {
    return item.id || String(_index);
  }

  trackByProvider(_index: number, item: AiProvider): string {
    return item.providerKey;
  }

  trackByProviderHealth(_index: number, row: ProviderHealthRow): string {
    return row.provider.providerKey;
  }

  trackByTemplate(_index: number, item: AiMarketplaceTemplate): string {
    return item.templateKey;
  }

  trackByControlAgent(_index: number, row: AgentControlRow): string {
    return row.agent.id || String(_index);
  }

  trackByPrompt(_index: number, prompt: AiPromptVersion): string {
    return prompt.id || String(_index);
  }

  trackByRoiAgent(_index: number, row: AgentRoiRow): string {
    return row.agent.id || String(_index);
  }

  trackByPolicyAgent(_index: number, row: PolicyRow): string {
    return row.agent.id || String(_index);
  }

  totals(): AiTotals {
    const dashboardTotals = this.dashboard()?.totals || {};
    return {
      agents: Number(dashboardTotals.agents ?? this.agents().length),
      activeAgents: Number(dashboardTotals.activeAgents ?? this.agents().filter((agent) => agent.status !== 'disabled').length),
      pendingApprovals: Number(dashboardTotals.pendingApprovals ?? this.queue().length),
      highRiskActions: Number(dashboardTotals.highRiskActions ?? this.queue().filter((item) => ['high', 'critical'].includes(String(item.riskLevel))).length),
      failedRuns: Number(dashboardTotals.failedRuns ?? this.runs().filter((run) => run.status === 'failed').length),
      openAlerts: Number(dashboardTotals.openAlerts ?? this.alerts().length),
      aiCostToday: Number(dashboardTotals.aiCostToday ?? this.runs().reduce((sum, run) => sum + Number(run.estimatedCost || 0), 0)),
      aiCostMonth: Number(dashboardTotals.aiCostMonth ?? this.costSummary().monthCost ?? 0),
      estimatedKpiImpact: Number(dashboardTotals.estimatedKpiImpact ?? this.kpiImpact().reduce((sum, item) => sum + this.impactAmount(item), 0)),
      providerConfigs: Number(dashboardTotals.providerConfigs ?? this.configuredProviders()),
      promptVersions: Number(dashboardTotals.promptVersions ?? this.promptVersions().length)
    };
  }

  private controlRowFor(agent: AiAgent): AgentControlRow {
    const runs = this.runs().filter((run) => run.agentId === agent.id);
    const queue = this.queue().filter((item) => item.agentId === agent.id);
    const alerts = this.alerts().filter((alert) => alert.agentId === agent.id && !['resolved', 'closed'].includes(String(alert.status || '').toLowerCase()));
    const costs = this.costReport()?.byAgent?.find((row) => row.agentId === agent.id);
    const impact = this.kpiImpact().filter((row) => row.agentId === agent.id).reduce((sum, row) => sum + this.impactAmount(row), 0);
    const failedRuns = runs.filter((run) => ['failed', 'not_configured'].includes(String(run.status || '').toLowerCase())).length;
    const successRuns = runs.filter((run) => ['completed', 'success', 'approved'].includes(String(run.status || '').toLowerCase())).length;
    const runCount = runs.length;
    const successRate = runCount ? Math.round((successRuns / runCount) * 100) : 0;
    const setting = this.settingFor(agent.id);
    const providerKey = setting?.providerKey || agent.providerKey || 'not_configured';
    const provider = this.providers().find((item) => item.providerKey === providerKey);
    const providerReady = this.providerConfigured(provider) || providerKey === 'local' || providerKey === 'local_rules';
    const lastRunAt = runs
      .map((run) => run.completedAt || run.startedAt || '')
      .filter(Boolean)
      .sort()
      .at(-1) || '';
    const safety = this.scoreFor(agent);
    const healthScore = Math.max(0, Math.min(100, Math.round(
      safety
      - failedRuns * 14
      - queue.length * 6
      - alerts.length * 8
      - (providerReady ? 0 : 18)
      - (String(agent.status || '').toLowerCase() === 'disabled' ? 22 : 0)
    )));

    return {
      agent,
      healthScore,
      runCount,
      successRate,
      failureCount: failedRuns,
      pendingApprovals: queue.length,
      openAlerts: alerts.length,
      costMonth: Number(costs?.totalCost || runs.reduce((sum, run) => sum + Number(run.estimatedCost || 0), 0)),
      tokens: Number(costs?.totalTokens || runs.reduce((sum, run) => sum + Number(run.totalTokens || 0), 0)),
      kpiImpact: impact,
      providerReady,
      lastRunAt,
      status: agent.status || 'active',
      riskLevel: agent.riskLevel || 'low'
    };
  }

  private providerHealthFor(provider: AiProvider): ProviderHealthRow {
    const providerKey = provider.providerKey;
    const configured = this.providerConfigured(provider);
    const runs = this.runs().filter((run) => String(run.providerKey || 'not_configured') === providerKey);
    const failures = runs.filter((run) => ['failed', 'not_configured'].includes(String(run.status || '').toLowerCase())).length;
    const runCount = runs.length;
    const failureRate = runCount ? Math.round((failures / runCount) * 100) : 0;
    const durationRows = runs.map((run) => Number(run.durationMs || 0)).filter((duration) => duration > 0);
    const avgLatencyMs = durationRows.length
      ? Math.round(durationRows.reduce((sum, duration) => sum + duration, 0) / durationRows.length)
      : 0;
    const cost = runs.reduce((sum, run) => sum + Number(run.estimatedCost || 0), 0);
    const tokens = runs.reduce((sum, run) => sum + Number(run.totalTokens || 0), 0);
    const fallbackRuns = ['local', 'local_rules'].includes(providerKey) ? runCount : 0;
    const activeAgents = this.agents().filter((agent) => {
      const setting = this.settingFor(agent.id);
      return (setting?.providerKey || agent.providerKey || 'not_configured') === providerKey && agent.status !== 'disabled';
    }).length;
    const healthScore = Math.max(0, Math.min(100, Math.round(
      96
      - (configured ? 0 : 35)
      - failures * 16
      - Math.max(0, failureRate - 10)
      - (avgLatencyMs > 30000 ? 12 : avgLatencyMs > 10000 ? 6 : 0)
      - (!runCount && activeAgents ? 6 : 0)
    )));

    return {
      provider,
      configured,
      runs: runCount,
      failures,
      failureRate,
      avgLatencyMs,
      cost,
      tokens,
      fallbackRuns,
      activeAgents,
      healthScore
    };
  }

  private roiRowFor(agent: AiAgent): AgentRoiRow {
    const runs = this.runs().filter((run) => run.agentId === agent.id);
    const costRow = this.costReport()?.byAgent?.find((row) => row.agentId === agent.id);
    const impacts = this.kpiImpact().filter((impact) => impact.agentId === agent.id);
    const spend = Number(costRow?.totalCost || runs.reduce((sum, run) => sum + Number(run.estimatedCost || 0), 0));
    const tokens = Number(costRow?.totalTokens || runs.reduce((sum, run) => sum + Number(run.totalTokens || 0), 0));
    const impact = impacts.reduce((sum, item) => sum + this.impactAmount(item), 0);
    const confidenceRows = impacts.map((item) => Number(item.confidence || 0)).filter((value) => value > 0);
    const confidence = confidenceRows.length
      ? confidenceRows.reduce((sum, value) => sum + value, 0) / confidenceRows.length
      : 0;
    const failedRuns = runs.filter((run) => ['failed', 'not_configured'].includes(String(run.status || '').toLowerCase())).length;

    return {
      agent,
      spend,
      tokens,
      impact,
      roi: spend ? impact / spend : impact ? 99 : 0,
      runs: runs.length,
      failedRuns,
      confidence
    };
  }

  policyRowFor(agent: AiAgent): PolicyRow {
    const setting = this.settingFor(agent.id);
    const autonomy = setting?.autonomyLevel || agent.autonomyLevel || 'approval_required';
    const riskThreshold = setting?.riskThreshold || agent.riskLevel || 'medium';
    const approvalRequired = this.isApprovalRequired(setting);
    const providerKey = setting?.providerKey || agent.providerKey || 'not_configured';
    const provider = this.providers().find((item) => item.providerKey === providerKey);
    const providerReady = providerKey === 'local' || providerKey === 'local_rules' || this.providerConfigured(provider);
    const activePrompt = this.promptVersions().some((prompt) => prompt.agentId === agent.id && prompt.status === 'active');
    const disabled = String(agent.status || '').toLowerCase() === 'disabled';
    const riskyAuto = !approvalRequired && this.riskRank(riskThreshold) >= 3;
    const score = Math.max(0, Math.min(100, Math.round(
      96
      - (disabled ? 20 : 0)
      - (providerReady ? 0 : 18)
      - (activePrompt ? 0 : 12)
      - (approvalRequired ? 0 : 8)
      - (riskyAuto ? 24 : 0)
      - (this.autonomyRank(autonomy) * 3)
      - (this.riskRank(riskThreshold) * 2)
    )));
    const gate = disabled
      ? 'Disabled'
      : !providerReady
        ? 'Setup blocked'
        : approvalRequired
          ? 'Approval gate'
          : autonomy === 'auto_execute_low_risk'
            ? 'Low-risk auto'
            : 'Manual review';

    return {
      agent,
      setting,
      autonomy,
      riskThreshold,
      approvalRequired,
      providerReady,
      activePrompt,
      gate,
      score
    };
  }

  private queuePriority(item: AiQueueItem): number {
    const risk = String(item.riskLevel || 'medium').toLowerCase();
    const riskScore = risk === 'critical' ? 400 : risk === 'high' ? 300 : risk === 'medium' ? 200 : 100;
    const confidence = Math.round(Number(item.confidence || 0) * 10);
    const safetyPenalty = Math.round((1 - Number(item.safetyScore || 0)) * 10);
    return riskScore + confidence + safetyPenalty;
  }

  private autonomyRank(value?: string): number {
    const normalized = String(value || '').toLowerCase();
    if (normalized === 'full_auto_disabled') return 0;
    if (normalized === 'suggest_only') return 1;
    if (normalized === 'draft_only') return 2;
    if (normalized === 'approval_required') return 3;
    if (normalized === 'auto_execute_low_risk') return 5;
    return 3;
  }

  private riskRank(value?: string): number {
    const normalized = String(value || '').toLowerCase();
    if (normalized === 'critical') return 4;
    if (normalized === 'high') return 3;
    if (normalized === 'medium') return 2;
    if (normalized === 'low') return 1;
    return 2;
  }

  private durationLabel(ms: number): string {
    if (!ms || !Number.isFinite(ms)) {
      return 'new';
    }
    const minutes = Math.max(0, Math.floor(ms / 60000));
    if (minutes < 60) {
      return `${minutes}m`;
    }
    const hours = Math.floor(minutes / 60);
    if (hours < 48) {
      return `${hours}h`;
    }
    return `${Math.floor(hours / 24)}d`;
  }

  private templateFallbackValue(template: AiMarketplaceTemplate): number {
    const risk = String(template.riskLevel || 'low').toLowerCase();
    const base = risk === 'critical' ? 30000 : risk === 'high' ? 22000 : risk === 'medium' ? 14000 : 9000;
    return template.installed ? base : Math.round(base * 0.8);
  }

  private saveAction(label: string, request$ = this.api.post(label, {})): void {
    this.saving.set(label);
    this.error.set('');

    request$
      .pipe(finalize(() => this.saving.set('')))
      .subscribe({
        next: () => this.loadAll(),
        error: (err: { message?: string }) => this.error.set(err?.message || 'Unable to complete action.')
      });
  }

  labelize(value: string): string {
    return String(value || '')
      .replace(/[_-]+/g, ' ')
      .replace(/\b\w/g, (letter) => letter.toUpperCase());
  }
}
