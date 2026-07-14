import { CommonModule } from '@angular/common';
import { Component, OnInit, computed, signal } from '@angular/core';
import { ReactiveFormsModule, UntypedFormBuilder, Validators } from '@angular/forms';
import { ApiRecord, ApiService } from '../core/api.service';
import { StateComponent } from '../shared/ui/state/state.component';
import { AuraDatePipe } from '../shared/pipes/aura-date.pipe';

@Component({
  selector: 'app-growth-rank-bot',
  standalone: true,
  imports: [AuraDatePipe, CommonModule, ReactiveFormsModule, StateComponent],
  template: `
    <section class="page-stack">
      <div class="rank-hero">
        <div>
          <h2>AI Growth Agency OS</h2>
          <div class="hero-badges">
            <span>Level 1-15 live</span>
            <span>tenant-safe</span>
            <span>draft-first automation</span>
          </div>
        </div>
        <div class="hero-actions">
          <button class="ghost-button" type="button" (click)="refreshAll()">Refresh</button>
          <button class="primary-button" type="button" (click)="generateAudit()" [disabled]="saving()">
            {{ saving() ? 'Generating...' : 'Generate rank plan' }}
          </button>
        </div>
      </div>

      <app-state [loading]="loading()" [error]="error()"></app-state>

      <div class="toast" *ngIf="toast() as note" [class.success]="note.type === 'success'" [class.error]="note.type === 'error'" [class.info]="note.type === 'info'">
        <span>{{ note.message }}</span>
        <button type="button" (click)="clearToast()">×</button>
      </div>

      <div class="metrics-grid" *ngIf="dashboard() as board">
        <article class="metric-card"><span>Clients</span><strong>{{ board.metrics?.clients || 0 }}</strong></article>
        <article class="metric-card"><span>Open tasks</span><strong>{{ board.metrics?.openTasks || 0 }}</strong></article>
        <article class="metric-card"><span>Keywords</span><strong>{{ board.metrics?.trackedKeywords || 0 }}</strong></article>
        <article class="metric-card"><span>Content</span><strong>{{ board.metrics?.contentFactoryItems || 0 }}</strong></article>
        <article class="metric-card"><span>Copilot</span><strong>{{ board.metrics?.copilotChats || 0 }}</strong></article>
        <article class="metric-card"><span>Profit</span><strong>₹{{ board.metrics?.campaignProfit || 0 }}</strong><small>{{ board.metrics?.campaignRoiPercent || 0 }}% ROI</small></article>
        <article class="metric-card"><span>SEO pages</span><strong>{{ board.metrics?.seoPages || 0 }}</strong></article>
        <article class="metric-card"><span>Alerts</span><strong>{{ board.metrics?.competitorAlerts || 0 }}</strong></article>
      </div>

      <section class="panel command-panel" *ngIf="commandCenter() as command">
        <div class="section-title">
          <div>
            <h3>Campaign ROI, recommendation queue, approvals and social leads</h3>
          </div>
          <span class="badge">{{ command.metrics?.approvalRequired || 0 }} approvals</span>
        </div>
        <div class="summary-grid">
          <article><span>Recommendations</span><strong>{{ command.metrics?.openRecommendations || 0 }}</strong></article>
          <article><span>Social leads</span><strong>{{ command.metrics?.socialLeads || 0 }}</strong></article>
          <article><span>Campaign profit</span><strong>₹{{ command.metrics?.campaignProfit || 0 }}</strong><small>{{ command.metrics?.campaignRoiPercent || 0 }}% ROI</small></article>
          <article><span>Weak keywords</span><strong>{{ command.seoRankBot?.weakKeywords?.length || 0 }}</strong><small>{{ command.seoRankBot?.nextAction }}</small></article>
        </div>
        <div class="dashboard-grid">
          <section class="ads-card">
            <header><h4>Growth recommendation queue</h4><span>high impact first</span></header>
            <div class="recommendation-list">
              <article *ngFor="let item of command.recommendationQueue">
                <strong>{{ item.priority }} · {{ item.title }}</strong>
                <span>{{ item.why }}</span>
                <small>{{ item.action }} · {{ item.status }}</small>
              </article>
              <article *ngIf="!command.recommendationQueue?.length"><strong>No growth recommendation pending</strong><span>Campaign planner and rank bot are clear.</span></article>
            </div>
          </section>
          <section class="ads-card">
            <header><h4>Approval workflow</h4><span>owner-controlled publishing</span></header>
            <div class="recommendation-list">
              <article *ngFor="let item of command.approvalWorkflow">
                <strong>{{ item.title }}</strong>
                <span>{{ item.type }} · {{ item.source }} · {{ item.owner }}</span>
                <small>{{ item.status }}</small>
                <button class="ghost-button" type="button" *ngIf="item.status !== 'approved'" [disabled]="actionBusy()" (click)="approveGrowthWorkflowItem(item)">Approve</button>
              </article>
              <article *ngIf="!command.approvalWorkflow?.length"><strong>No approval rows</strong><span>Create content planner or proposal rows to activate approval workflow.</span></article>
            </div>
          </section>
        </div>
        <div class="dashboard-grid">
          <section class="ads-card">
            <header><h4>Campaign ROI</h4><span>{{ command.campaignRoi?.scaleRule }}</span></header>
            <div class="table-wrap compact">
              <table>
                <thead><tr><th>Campaign</th><th>Source</th><th>Spend</th><th>Revenue</th><th>Profit</th><th>ROI</th></tr></thead>
                <tbody>
                  <tr *ngFor="let row of command.campaignRoi?.rows || []"><td>{{ row.campaignName }}</td><td>{{ row.source }}</td><td>₹{{ row.spend }}</td><td>₹{{ row.revenue }}</td><td>₹{{ row.profit }}</td><td>{{ row.roiPercent }}%</td></tr>
                  <tr *ngIf="!(command.campaignRoi?.rows || []).length"><td colspan="6">Campaign ROI rows pending.</td></tr>
                </tbody>
              </table>
            </div>
          </section>
          <section class="ads-card">
            <header><h4>Social lead tracking</h4><span>{{ command.socialLeadTracking?.conversionRule }}</span></header>
            <div class="table-wrap compact">
              <table>
                <thead><tr><th>Source</th><th>Leads</th><th>Bookings</th><th>Value</th></tr></thead>
                <tbody>
                  <tr *ngFor="let row of command.socialLeadTracking?.bySource || []"><td>{{ row.source }}</td><td>{{ row.leads }}</td><td>{{ row.bookings }}</td><td>₹{{ row.estimatedValue }}</td></tr>
                  <tr *ngIf="!(command.socialLeadTracking?.bySource || []).length"><td colspan="4">Social lead attribution pending.</td></tr>
                </tbody>
              </table>
            </div>
          </section>
        </div>
      </section>

      <div class="level-switch" role="tablist" aria-label="Growth bot levels">
        <button type="button" *ngFor="let level of levels" [class.active]="activeLevel() === level.level" (click)="selectLevel(level.level)">
          <strong>L{{ level.level }}</strong>
          <span>{{ level.label }}</span>
        </button>
      </div>

      <div class="workspace-grid">
        <section class="panel">
          <div class="section-title">
            <div>
              <h3>Create or update audit</h3>
            </div>
          </div>

          <form [formGroup]="auditForm" class="form-grid" (ngSubmit)="generateAudit()">
            <label class="field full"><span>Business name</span><input formControlName="businessName" /></label>
            <label class="field"><span>Industry</span><input formControlName="industry" /></label>
            <label class="field"><span>City</span><input formControlName="city" /></label>
            <label class="field"><span>Target area</span><input formControlName="targetArea" /></label>
            <label class="field"><span>Client email</span><input formControlName="clientEmail" /></label>
            <label class="field"><span>Package</span><input formControlName="packageName" /></label>
            <label class="field"><span>Monthly fee</span><input formControlName="monthlyFee" /></label>
            <label class="field full"><span>Top services</span><input formControlName="topServices" /></label>
            <label class="field full"><span>Rank keywords</span><input formControlName="rankKeywords" /></label>
            <label class="field full"><span>Competitors</span><input formControlName="competitors" /></label>
            <label class="field full"><span>Primary goal</span><textarea formControlName="goal" rows="3"></textarea></label>
            <label class="field full"><span>Instagram URL</span><input formControlName="instagramUrl" /></label>
            <label class="field full"><span>Facebook URL</span><input formControlName="facebookUrl" /></label>
            <label class="field full"><span>Google Business Profile URL</span><input formControlName="googleProfileUrl" /></label>
            <div class="button-row full">
              <button class="primary-button" type="submit" [disabled]="saving() || editMode()">{{ saving() ? 'Saving...' : 'Generate full Level 1-15 plan' }}</button>
              <button class="ghost-button" type="button" *ngIf="editMode()" [disabled]="saving()" (click)="updateAudit()">{{ saving() ? 'Updating...' : 'Update audit' }}</button>
              <button class="ghost-button" type="button" *ngIf="editMode()" [disabled]="saving()" (click)="cancelEdit()">Cancel edit</button>
            </div>
          </form>
        </section>

        <section class="panel">
          <div class="section-title">
            <div>
              <h3>Client growth plans</h3>
            </div>
          </div>
          <div class="inline-fields audit-filters">
            <label class="field"><span>Search audits</span><input [value]="auditSearch()" (input)="auditSearch.set($any($event.target).value)" placeholder="Business, city, industry" /></label>
            <label class="field"><span>Status</span>
              <select [value]="auditStatusFilter()" (change)="auditStatusFilter.set($any($event.target).value)">
                <option value="all">All</option>
                <option value="draft">Draft</option>
                <option value="active">Active</option>
                <option value="sent">Sent</option>
                <option value="won">Won</option>
                <option value="archived">Archived</option>
              </select>
            </label>
          </div>
          <div class="empty-state" *ngIf="!filteredAudits().length && !loading()">No saved rank audits found.</div>
          <div class="audit-list" *ngIf="filteredAudits().length">
            <button class="audit-row" type="button" *ngFor="let audit of filteredAudits()" [class.active]="selectedAudit()?.id === audit.id" (click)="selectAudit(audit)">
              <strong>{{ audit.businessName }}</strong>
              <span>{{ audit.market || audit.industry }} · {{ audit.createdAt | auraDate:'date' }}</span>
              <small>{{ audit.score }} score · {{ audit.status }}</small>
              <span class="row-actions">
                <em (click)="startEdit(audit); $event.stopPropagation()">Edit</em>
                <em class="danger" (click)="deleteAudit(audit); $event.stopPropagation()">Delete</em>
              </span>
            </button>
          </div>
        </section>
      </div>

      <ng-container *ngIf="selectedAudit() as audit">
        <!-- ============ ADVANCED AI WORKBENCH (new) ============ -->
        <section class="panel ai-workbench">
          <div class="section-title">
            <div>
              <h3>Live AI workbench</h3>
            </div>
            <span class="ai-pill">real model · honest estimates</span>
          </div>

          <div class="ai-grid">
            <!-- 1. Real-AI Copilot -->
            <article class="ai-card">
              <header><h4>Growth Copilot</h4><span>live data answer</span></header>
              <textarea class="ai-input" [formControl]="aiCopilotQuestion" rows="3" placeholder="e.g. mere salon ki ranking kyu down hai?"></textarea>
              <button class="primary-button full" type="button" [disabled]="aiBusy() === 'copilot'" (click)="askCopilotAI(audit)">
                {{ aiBusy() === 'copilot' ? 'Thinking...' : 'Ask AI (live)' }}
              </button>
              <div class="ai-answer" *ngIf="copilotAnswer() as ans">
                <div class="ai-answer-head">
                  <strong>{{ ans.intent }}</strong>
                  <span class="provider-tag" [class.local]="ans.provider !== 'openai' && ans.provider !== 'anthropic'">{{ ans.provider }}</span>
                </div>
                <p>{{ ans.answer }}</p>
                <div class="confidence-bar" [attr.aria-label]="'confidence ' + ans.confidence + '%'">
                  <span [style.width.%]="ans.confidence"></span>
                </div>
                <small>{{ ans.confidence }}% confidence</small>
                <ul class="ai-actions" *ngIf="ans.actions?.length">
                  <li *ngFor="let act of ans.actions">{{ act }}</li>
                </ul>
              </div>
            </article>

            <!-- 2. Honest Performance Prediction -->
            <article class="ai-card">
              <header><h4>Performance estimate</h4><span>vs your own average</span></header>
              <div class="inline-fields">
                <label class="field"><span>Channel</span>
                  <select [formControl]="predictChannel">
                    <option>Instagram Reel</option>
                    <option>Instagram</option>
                    <option>Facebook</option>
                    <option>Google Business Profile</option>
                  </select>
                </label>
                <label class="field"><span>Optimization score</span><input type="number" min="0" max="100" [formControl]="predictScore" /></label>
              </div>
              <button class="ghost-button full" type="button" [disabled]="aiBusy() === 'predict'" (click)="runPrediction(audit)">
                {{ aiBusy() === 'predict' ? 'Calculating...' : 'Estimate performance' }}
              </button>
              <div class="predict-result" *ngIf="prediction() as pred">
                <div class="predict-headline" [class.low]="pred.confidence === 'low'">
                  <strong *ngIf="pred.pctVsAverage !== null">{{ pred.pctVsAverage > 0 ? '+' : '' }}{{ pred.pctVsAverage }}%</strong>
                  <strong *ngIf="pred.pctVsAverage === null">—</strong>
                  <span>vs average · {{ pred.confidence }} confidence</span>
                </div>
                <p class="basis">{{ pred.basis }}</p>
                <small class="honest">{{ pred.honestNote }}</small>
              </div>
            </article>

            <!-- 3. Image Verify -->
            <article class="ai-card">
              <header><h4>Image check</h4><span>Platform readiness</span></header>
              <label class="field"><span>Target</span>
                <select [formControl]="verifyTarget">
                  <option value="instagram_post">Instagram Post (1:1)</option>
                  <option value="instagram_reel">Instagram Reel (9:16)</option>
                  <option value="instagram_story">Instagram Story (9:16)</option>
                  <option value="youtube_thumb">YouTube Thumbnail (16:9)</option>
                  <option value="gbp_post">Google Business Post (4:3)</option>
                  <option value="facebook_post">Facebook Post (1.91:1)</option>
                </select>
              </label>
              <label class="file-drop">
                <input type="file" accept="image/png,image/jpeg" (change)="onImageSelected($event, audit)" hidden />
                <span>{{ aiBusy() === 'verify' ? 'Checking...' : 'Upload image to verify' }}</span>
              </label>
              <div class="verify-result" *ngIf="verifyResult() as vr" [class.pass]="vr.willRun" [class.fail]="!vr.willRun">
                <strong>{{ vr.willRun ? 'Chalegi ✓' : 'Nahi chalegi ✗' }}</strong>
                <span class="verdict">{{ vr.verdict }}</span>
                <small *ngIf="vr.detected">Detected: {{ vr.detected.width }}×{{ vr.detected.height }} · {{ vr.detected.format }} · {{ vr.detected.sizeKb }}KB</small>
                <small *ngIf="vr.requiredSpec">Required: {{ vr.requiredSpec }}</small>
                <ul class="issues" *ngIf="vr.issues?.length">
                  <li *ngFor="let issue of vr.issues">{{ issue }}</li>
                </ul>
              </div>
            </article>
          </div>
        </section>

        <section class="panel command-panel">
          <div class="section-title">
            <div>
              <h3>{{ audit.businessName }} live actions</h3>
            </div>
            <div class="section-actions">
              <button class="ghost-button" type="button" (click)="startEdit(audit)">Edit audit</button>
              <button class="ghost-button" type="button" (click)="printReport()">Print / Export PDF</button>
              <button class="ghost-button" type="button" (click)="copyWhatsAppReport(audit)">Copy WhatsApp report</button>
              <small class="action-message" *ngIf="actionMessage()">{{ actionMessage() }}</small>
            </div>
          </div>

          <div class="summary-grid">
            <article><span>Rank score</span><strong>{{ audit.plan?.rankReadinessScore || audit.score }}</strong><small>{{ audit.plan?.scoreLabel || 'Ready' }}</small></article>
            <article><span>Tasks</span><strong>{{ audit.workspace?.tasks?.length || 0 }}</strong></article>
            <article><span>Campaign rows</span><strong>{{ audit.workspace?.campaignProfit?.length || 0 }}</strong></article>
            <article><span>Planner</span><strong>{{ audit.workspace?.publishingPlanner?.length || 0 }}</strong></article>
            <article><span>SEO pages</span><strong>{{ audit.workspace?.seoPages?.length || 0 }}</strong></article>
            <article><span>Alerts</span><strong>{{ audit.workspace?.competitorAlerts?.length || 0 }}</strong></article>
          </div>

          <div class="link-check-grid">
            <article *ngFor="let link of profileLinkChecks(audit)" [class.warn]="!link.ok">
              <span>{{ link.label }}</span>
              <strong>{{ link.ok ? 'Linked' : 'Check needed' }}</strong>
              <small>{{ link.message }}</small>
            </article>
          </div>

          <div class="score-breakdown">
            <article *ngFor="let score of scoreBreakdown(audit)">
              <span>{{ score.label }}</span>
              <strong>{{ score.value }}</strong>
            </article>
          </div>

          <form [formGroup]="commandForm" class="command-grid">
            <label class="field full" id="growth-option-ranks"><span>Manual rank import</span><textarea formControlName="rankRows" rows="3"></textarea></label>
            <label class="field full" id="growth-option-copilot"><span>AI Growth Copilot question</span><textarea formControlName="copilotQuestion" rows="3"></textarea></label>
            <label class="field" id="growth-option-kpis"><span>Meta reach</span><input formControlName="metaReach" /></label>
            <label class="field"><span>Meta messages</span><input formControlName="metaMessages" /></label>
            <label class="field"><span>Google views</span><input formControlName="googleViews" /></label>
            <label class="field"><span>Google calls</span><input formControlName="googleCalls" /></label>
            <label class="field" id="growth-option-roi"><span>Campaign name</span><input formControlName="campaignName" /></label>
            <label class="field"><span>Campaign source</span><input formControlName="campaignSource" /></label>
            <label class="field"><span>Spend</span><input formControlName="campaignSpend" /></label>
            <label class="field"><span>Leads</span><input formControlName="campaignLeads" /></label>
            <label class="field"><span>Bookings</span><input formControlName="campaignBookings" /></label>
            <label class="field"><span>Revenue</span><input formControlName="campaignRevenue" /></label>
            <label class="field" id="growth-option-planner"><span>Planner title</span><input formControlName="publishingTitle" /></label>
            <label class="field"><span>Planner channel</span><input formControlName="publishingChannel" /></label>
            <label class="field"><span>Schedule date</span><input formControlName="scheduledFor" /></label>
            <label class="field" id="growth-option-competitor"><span>Competitor</span><input formControlName="competitorName" /></label>
            <label class="field"><span>Signal</span><input formControlName="competitorSignal" /></label>
            <label class="field full"><span>Counter action</span><input formControlName="competitorAction" /></label>
          </form>

          <div class="command-cards">
            <button id="growth-action-ranks" type="button" [disabled]="actionBusy() || !audit.workspace" (click)="importRankRows(audit)">
              <strong>Import ranks</strong><span>keyword positions save/update</span>
            </button>
            <button id="growth-action-kpis" type="button" [disabled]="actionBusy() || !audit.workspace" (click)="syncKpis(audit)">
              <strong>Sync KPIs</strong><span>Meta + Google metrics store</span>
            </button>
            <button id="growth-action-report" type="button" [disabled]="actionBusy() || !audit.workspace" (click)="generateWeeklyReport(audit)">
              <strong>Generate report</strong><span>white-label weekly report</span>
            </button>
            <button id="growth-action-tasks" type="button" [disabled]="actionBusy() || !audit.workspace" (click)="runTaskBatch(audit)">
              <strong>Run task batch</strong><span>AI execution queue create</span>
            </button>
            <button id="growth-action-copilot" type="button" [disabled]="actionBusy() || !audit.workspace" (click)="askCopilot(audit)">
              <strong>Ask copilot</strong><span>live data answer save</span>
            </button>
            <button id="growth-action-roi" type="button" [disabled]="actionBusy() || !audit.workspace" (click)="saveCampaignProfit(audit)">
              <strong>Save ROI</strong><span>profit + ROI calculate</span>
            </button>
            <button id="growth-action-planner" type="button" [disabled]="actionBusy() || !audit.workspace" (click)="scheduleContent(audit)">
              <strong>Schedule content</strong><span>approved draft planner</span>
            </button>
            <button type="button" [disabled]="actionBusy() || !audit.workspace" (click)="generateSeoPages(audit)">
              <strong>Generate SEO pages</strong><span>service/city/offer pages</span>
            </button>
            <button id="growth-action-competitor" type="button" [disabled]="actionBusy() || !audit.workspace" (click)="createCompetitorAlert(audit)">
              <strong>Create alert</strong><span>competitor counter task</span>
            </button>
            <button type="button" [disabled]="actionBusy() || !audit.workspace" (click)="markProposalSent(audit)">
              <strong>Proposal sent</strong><span>proposal status update</span>
            </button>
            <button class="strong" type="button" [disabled]="actionBusy() || !audit.workspace" (click)="markInvoiceIssued(audit)">
              <strong>Invoice issued</strong><span>won + invoice issued</span>
            </button>
            <button type="button" [disabled]="actionBusy() || !audit.workspace" (click)="loadPortalPreview(audit)">
              <strong>Portal preview</strong><span>client portal snapshot</span>
            </button>
          </div>

          <div class="result-strip" *ngIf="latestCommandResult() as result">
            <strong>{{ result.title }}</strong>
            <span>{{ result.detail }}</span>
          </div>

          <div class="portal-preview" *ngIf="portalPreview() as portal">
            <strong>{{ portal.audit?.businessName }} client portal</strong>
            <span>{{ portal.audit?.score }} score · {{ portal.workspace?.rankKeywords?.length || 0 }} keywords · {{ portal.workspace?.contentFactory?.length || 0 }} content drafts · {{ portal.report?.title }}</span>
          </div>

          <div class="ai-history" *ngIf="audit.workspace?.copilotChats?.length">
            <div class="section-title">
              <div>
                <h3>Previous suggestions</h3>
              </div>
            </div>
            <article *ngFor="let chat of audit.workspace?.copilotChats || []">
              <strong>{{ chat.question }}</strong>
              <p>{{ chat.answer }}</p>
              <small>{{ chat.confidence || 0 }} confidence · {{ chat.provider || 'saved' }} · {{ chat.createdAt | auraDate:'date' }}</small>
            </article>
          </div>
        </section>

        <section class="panel growth-report-engine">
          <div class="section-title">
            <div>
              <h3>{{ audit.businessName }} performance report</h3>
            </div>
            <div class="section-actions">
              <button class="ghost-button" type="button" (click)="printReport()">Download / PDF</button>
              <button class="ghost-button" type="button" (click)="copyWhatsAppReport(audit)">Copy WhatsApp summary</button>
              <span class="ai-pill">live logic · report-ready</span>
            </div>
          </div>

          <div class="report-summary-band">
            <article class="score-report">
              <span>Marketing Score</span>
              <strong>{{ portalMarketingScore(audit) }}%</strong>
              <small>{{ growthReportVerdict(audit) }}</small>
            </article>
            <article *ngFor="let item of dhandaPerformanceCards(audit)">
              <span>{{ item.label }}</span>
              <strong>{{ item.value }}</strong>
              <small>{{ item.note || 'Google / social signal' }}</small>
            </article>
          </div>

          <div class="report-grid">
            <article class="report-card aura-card wide">
              <header><h4>Growth Action Report</h4><span>{{ dhandaGrowthDone(audit) }} of 35 actions completed</span><button class="report-link" type="button" (click)="openGrowthReport('growth', 'tasks')">Open</button></header>
              <div class="growth-action-list">
                <article *ngFor="let task of dhandaSocialTasks(audit)">
                  <span [style.background]="task.color">{{ task.icon }}</span>
                  <div>
                    <strong>{{ task.title }}</strong>
                    <small>{{ task.done }} done · target {{ task.target }} · {{ growthActionReason(task.title) }}</small>
                  </div>
                  <em>{{ task.action }}</em>
                </article>
              </div>
            </article>

            <article class="report-card aura-card">
              <header><h4>Review Reply Report</h4><span>{{ dhandaReviewSummary(audit).rating }} rating · {{ dhandaReviewSummary(audit).count }} reviews</span><button class="report-link" type="button" (click)="openGrowthReport('reviews', 'copilot')">Open</button></header>
              <div class="status-list">
                <article *ngFor="let reply of dhandaAiReplies(audit)">
                  <strong>{{ reply.name }}</strong>
                  <span>{{ reply.reply }}</span>
                  <small>{{ reply.status }}</small>
                </article>
              </div>
              <div class="empty-state" *ngIf="!dhandaAiReplies(audit).length">Review engine data is pending. Reply report will appear after review rows sync.</div>
            </article>

            <article class="report-card aura-card">
              <header><h4>Customer Review Request Report</h4><span>sent / open / reminded</span><button class="report-link" type="button" (click)="openGrowthReport('customers', 'roi')">Open</button></header>
              <div class="request-report">
                <article><span>Sent</span><strong>{{ dhandaCustomerStats(audit).sent }}</strong></article>
                <article><span>Open</span><strong>{{ dhandaCustomerStats(audit).open }}</strong></article>
                <article><span>Reminded</span><strong>{{ dhandaCustomerStats(audit).reminded }}</strong></article>
                <article><span>Target</span><strong>{{ dhandaCustomerStats(audit).target }}</strong></article>
              </div>
              <div class="status-list">
                <article *ngFor="let customer of dhandaCustomers(audit)">
                  <strong>{{ customer.name }}</strong>
                  <span>{{ customer.phone }}</span>
                </article>
              </div>
              <div class="empty-state" *ngIf="!dhandaCustomers(audit).length">Lead/customer attribution is pending. Customer report will appear after campaign ROI or attribution events are added.</div>
            </article>

            <article class="report-card aura-card wide">
              <header><h4>Keyword Rank Report</h4><span>search number + keyword + current rank</span><button class="report-link" type="button" (click)="openGrowthReport('keywords', 'ranks')">Open</button></header>
              <div class="table-wrap compact">
                <table *ngIf="dhandaKeywords(audit).length">
                  <thead><tr><th>Search</th><th>Keyword</th><th>Rank</th><th>Action</th></tr></thead>
                  <tbody>
                    <tr *ngFor="let row of dhandaKeywords(audit)">
                      <td>{{ row.search }}</td>
                      <td>{{ row.keyword }}</td>
                      <td>{{ row.rank }}</td>
                      <td>{{ keywordAction(row) }}</td>
                    </tr>
                  </tbody>
                </table>
                <div class="empty-state" *ngIf="!dhandaKeywords(audit).length">Rank tracker is empty. Keyword report will appear after ranks are imported.</div>
              </div>
            </article>

            <article class="report-card aura-card">
              <header><h4>Competitor Analysis Report</h4><span>rating + counter action</span><button class="report-link" type="button" (click)="openGrowthReport('competitors', 'competitor')">Open</button></header>
              <div class="mini-table report-table">
                <div *ngFor="let row of dhandaCompetitors(audit)">
                  <span>{{ row.name }}</span>
                  <strong>{{ row.rating }}★</strong>
                  <small>{{ row.status }}</small>
                </div>
              </div>
              <div class="empty-state" *ngIf="!dhandaCompetitors(audit).length">Competitor watch is empty. Report will appear after competitor alerts or signals are added.</div>
            </article>

            <article class="report-card aura-card">
              <header><h4>Post Media Report</h4><span>upload / poster / approval planner</span><button class="report-link" type="button" (click)="openGrowthReport('posts', 'planner')">Open</button></header>
              <div class="status-list">
                <article *ngFor="let item of dhandaPostPlanner(audit)">
                  <strong>{{ item.title }}</strong>
                  <span>{{ item.channel }}</span>
                  <small>{{ item.status }}</small>
                </article>
              </div>
              <div class="empty-state" *ngIf="!dhandaPostPlanner(audit).length">Publishing planner is empty. Post/media report will appear after content is scheduled.</div>
            </article>

            <article class="report-card aura-card wide">
              <header><h4>Monthly Performance Report</h4><span>summary cards + chart insight</span><button class="report-link" type="button" (click)="openGrowthReport('performance', 'report')">Open</button></header>
              <div class="report-metrics">
                <article *ngFor="let item of dhandaReportCards(audit)">
                  <small>{{ item.label }}</small>
                  <strong>{{ item.value }}</strong>
                  <span [class.down]="item.delta < 0">{{ item.delta > 0 ? '+' : '' }}{{ item.delta }}%</span>
                </article>
              </div>
              <div class="chart-grid">
                <article class="chart-card" *ngFor="let chart of dhandaCharts(audit)">
                  <div><strong>{{ chart.title }}</strong></div>
                  <div class="line-chart"><span *ngFor="let point of chart.points" [style.height.%]="point"></span></div>
                  <p>{{ chart.insight }}</p>
                </article>
              </div>
            </article>

            <article class="report-card aura-card wide">
              <header><h4>Social Calendar Report</h4><span>generated / approved / posted</span><button class="report-link" type="button" (click)="openGrowthReport('calendar', 'planner')">Open</button></header>
              <div class="calendar-board">
                <span *ngFor="let item of dhandaCalendarPlan(audit)" [class.posted]="item.status === 'posted'" [class.approved]="item.status === 'approved'">
                  <strong>{{ item.day }}</strong><small>{{ item.label }}</small><em>{{ item.status }}</em>
                </span>
              </div>
              <div class="empty-state" *ngIf="!dhandaCalendarPlan(audit).length">Social calendar is pending. Calendar report will fill after approved planner rows are scheduled.</div>
            </article>
          </div>

          <div class="opened-report-panel" id="growth-opened-report" *ngIf="activeGrowthReport() as reportKey">
            <div>
              <h4>{{ growthReportTitle(reportKey) }}</h4>
              <p>{{ growthReportOpenNote(reportKey, audit) }}</p>
            </div>
            <button class="ghost-button" type="button" (click)="activeGrowthReport.set('')">Close</button>
          </div>
        </section>


        <section class="panel ads-command-center">
          <div class="section-title">
            <div>
              <h3>Google + Meta growth control room</h3>
            </div>
            <span class="ai-pill">approval-first · multi-tenant · spend-safe</span>
          </div>

          <div class="summary-grid ads-kpi-grid">
            <article><span>Google spend</span><strong>₹{{ adsCommandSummary(audit).googleSpend }}</strong><small>{{ adsCommandSummary(audit).googleConversions }} conversions · ROAS {{ adsCommandSummary(audit).googleRoas }}x</small></article>
            <article><span>Meta spend</span><strong>₹{{ adsCommandSummary(audit).metaSpend }}</strong><small>{{ adsCommandSummary(audit).metaLeads }} leads · CTR {{ adsCommandSummary(audit).metaCtr }}%</small></article>
            <article><span>Health score</span><strong>{{ adsCommandSummary(audit).healthScore }}</strong><small>{{ adsCommandSummary(audit).healthLabel }}</small></article>
            <article><span>Guardrails</span><strong>{{ riskGuardrails(audit).length }}</strong></article>
          </div>

          <div class="ads-grid two-col">
            <article class="ads-card">
              <header><h4>Google Ads dashboard</h4><span>campaigns, budget, clicks, conversions, CPC, CPA, ROAS</span></header>
              <div class="table-wrap compact">
                <table>
                  <thead><tr><th>Campaign</th><th>Budget</th><th>Clicks</th><th>Conv.</th><th>CPC</th><th>CPA</th><th>ROAS</th></tr></thead>
                  <tbody>
                    <tr *ngFor="let row of googleAdsRows(audit)"><td>{{ row.campaign }}</td><td>₹{{ row.budget }}</td><td>{{ row.clicks }}</td><td>{{ row.conversions }}</td><td>₹{{ row.cpc }}</td><td>₹{{ row.cpa }}</td><td>{{ row.roas }}x</td></tr>
                  </tbody>
                </table>
              </div>
            </article>

            <article class="ads-card">
              <header><h4>Meta Ads dashboard</h4><span>Instagram/Facebook reach, leads, messages, spend, CTR</span></header>
              <div class="table-wrap compact">
                <table>
                  <thead><tr><th>Campaign</th><th>Platform</th><th>Reach</th><th>Leads</th><th>Messages</th><th>Spend</th><th>CTR</th></tr></thead>
                  <tbody>
                    <tr *ngFor="let row of metaAdsRows(audit)"><td>{{ row.campaign }}</td><td>{{ row.platform }}</td><td>{{ row.reach }}</td><td>{{ row.leads }}</td><td>{{ row.messages }}</td><td>₹{{ row.spend }}</td><td>{{ row.ctr }}%</td></tr>
                  </tbody>
                </table>
              </div>
            </article>
          </div>

          <div class="ads-grid">
            <article class="ads-card">
              <header><h4>Performance Max planner</h4><span>Search, YouTube, Display, Discover, Gmail, Maps</span></header>
              <div class="channel-strip">
                <span *ngFor="let channel of pmaxChannels()">{{ channel }}</span>
              </div>
              <ul class="ai-actions">
                <li>Asset groups: service proof, offer proof, local intent, remarketing</li>
                <li>Conversion goals: WhatsApp lead, call, booking, invoice paid</li>
                <li>Landing rule: city + service page before spend scale</li>
              </ul>
            </article>

            <article class="ads-card">
              <header><h4>Recommendation engine</h4><span>optimization score, bids, keywords, ads, assets</span></header>
              <div class="recommendation-list">
                <article *ngFor="let rec of adRecommendations(audit)">
                  <strong>{{ rec.title }}</strong>
                  <span>{{ rec.reason }}</span>
                  <small>Impact: {{ rec.impact }} · Priority: {{ rec.priority }}</small>
                </article>
              </div>
            </article>

            <article class="ads-card">
              <header><h4>Campaign health score</h4><span>budget waste, low CTR, high CPA, tracking, poor assets</span></header>
              <div class="health-list">
                <article *ngFor="let item of campaignHealth(audit)" [class.warn]="item.status !== 'ok'">
                  <strong>{{ item.label }}</strong>
                  <span>{{ item.detail }}</span>
                  <small>{{ item.status }}</small>
                </article>
              </div>
            </article>
          </div>

          <div class="ads-grid two-col">
            <article class="ads-card">
              <header><h4>AI ad copy generator</h4><span>headlines, descriptions, captions, Google assets</span></header>
              <form [formGroup]="adCopyForm" class="form-grid mini-form">
                <label class="field"><span>Offer</span><input formControlName="offer" /></label>
                <label class="field"><span>Audience</span><input formControlName="audience" /></label>
                <label class="field"><span>Platform</span><select formControlName="platform"><option>Google Ads</option><option>Instagram</option><option>Facebook</option><option>WhatsApp</option></select></label>
                <label class="field"><span>Tone</span><select formControlName="tone"><option>Premium</option><option>Urgent</option><option>Trust-first</option><option>Local Hindi-English</option></select></label>
                <button class="primary-button full" type="button" (click)="generateAdCopy(audit)">Generate ad copy</button>
              </form>
              <div class="copy-output" *ngIf="generatedAdCopy() as copy">
                <strong>{{ copy.headline }}</strong>
                <p>{{ copy.description }}</p>
                <small>{{ copy.caption }}</small>
              </div>
            </article>

            <article class="ads-card">
              <header><h4>Creative asset library</h4><span>image/video approval, size check, asset score</span></header>
              <div class="table-wrap compact">
                <table>
                  <thead><tr><th>Asset</th><th>Type</th><th>Spec</th><th>Approval</th><th>Score</th></tr></thead>
                  <tbody>
                    <tr *ngFor="let asset of creativeAssets(audit)"><td>{{ asset.name }}</td><td>{{ asset.type }}</td><td>{{ asset.spec }}</td><td>{{ asset.approval }}</td><td>{{ asset.score }}</td></tr>
                  </tbody>
                </table>
              </div>
            </article>
          </div>

          <div class="ads-grid">
            <article class="ads-card">
              <header><h4>Lead attribution funnel</h4><span>Google Ads → WhatsApp → booking → invoice</span></header>
              <div class="funnel-row">
                <article *ngFor="let stage of leadAttribution(audit)">
                  <span>{{ stage.label }}</span>
                  <strong>{{ stage.value }}</strong>
                  <small>{{ stage.rate }}</small>
                </article>
              </div>
            </article>

            <article class="ads-card">
              <header><h4>Budget optimizer</h4><span>move spend from low ROI to high ROI</span></header>
              <div class="recommendation-list">
                <article *ngFor="let move of budgetOptimizer(audit)">
                  <strong>{{ move.action }}</strong>
                  <span>{{ move.reason }}</span>
                  <small>Expected: {{ move.expected }}</small>
                </article>
              </div>
            </article>

            <article class="ads-card">
              <header><h4>Competitor ads watch</h4><span>offers, keywords, creatives, price signals</span></header>
              <div class="recommendation-list">
                <article *ngFor="let signal of competitorAdsWatch(audit)">
                  <strong>{{ signal.competitor }}</strong>
                  <span>{{ signal.signal }}</span>
                  <small>{{ signal.counter }}</small>
                </article>
              </div>
            </article>
          </div>

          <div class="ads-grid">
            <article class="ads-card">
              <header><h4>WhatsApp Business integration</h4><span>message templates, opt-in, lead reply handoff</span></header>
              <div class="status-list">
                <article *ngFor="let item of whatsappIntegration(audit)"><strong>{{ item.label }}</strong><span>{{ item.value }}</span></article>
              </div>
            </article>

            <article class="ads-card">
              <header><h4>Client approval workflow</h4><span>Draft → Client review → Approved → Scheduled → Published</span></header>
              <div class="approval-flow">
                <span *ngFor="let step of approvalWorkflow()">{{ step }}</span>
              </div>
            </article>

            <article class="ads-card">
              <header><h4>White-label agency report</h4><span>PDF and portal-ready client report</span></header>
              <div class="button-row">
                <button class="ghost-button" type="button" (click)="printReport()">Export PDF</button>
                <button class="ghost-button" type="button" (click)="copyWhatsAppReport(audit)">Share summary</button>
                <button class="ghost-button" type="button" [disabled]="actionBusy() || !audit.workspace" (click)="generateWeeklyReport(audit)">Generate agency report</button>
              </div>
            </article>
          </div>

          <div class="ads-grid two-col">
            <article class="ads-card">
              <header><h4>Multi-tenant agency mode</h4><span>client ad account, permissions, spend limit</span></header>
              <div class="table-wrap compact">
                <table>
                  <thead><tr><th>Client</th><th>Ad account</th><th>Role</th><th>Spend limit</th><th>Status</th></tr></thead>
                  <tbody>
                    <tr *ngFor="let tenant of tenantAccounts(audit)"><td>{{ tenant.client }}</td><td>{{ tenant.account }}</td><td>{{ tenant.role }}</td><td>₹{{ tenant.spendLimit }}</td><td>{{ tenant.status }}</td></tr>
                  </tbody>
                </table>
              </div>
            </article>

            <article class="ads-card guardrails-card">
              <header><h4>Risk guardrails</h4><span>no auto-publish, approval first, spend limit block</span></header>
              <div class="health-list">
                <article *ngFor="let guard of riskGuardrails(audit)" [class.warn]="guard.status !== 'safe'">
                  <strong>{{ guard.rule }}</strong>
                  <span>{{ guard.detail }}</span>
                  <small>{{ guard.status }}</small>
                </article>
              </div>
            </article>
          </div>
        </section>

        <section class="panel enterprise-ai-os">
          <div class="section-title">
            <div>
              <h3>Autonomous growth layer with approval control</h3>
            </div>
            <span class="ai-pill">local simulation · no real API calls</span>
          </div>

          <div class="summary-grid ai-os-kpi-grid">
            <article><span>Executive profit</span><strong>₹{{ executiveCommandCenter(audit).profit }}</strong><small>{{ executiveCommandCenter(audit).profitLabel }}</small></article>
            <article><span>Waste risk</span><strong>{{ executiveCommandCenter(audit).wasteRisk }}</strong><small>{{ executiveCommandCenter(audit).wasteLabel }}</small></article>
            <article><span>Next action</span><strong>{{ executiveCommandCenter(audit).nextAction }}</strong></article>
            <article><span>Approval gate</span><strong>{{ autonomousAgentPlan(audit).approvalRequired ? 'ON' : 'OFF' }}</strong></article>
          </div>

          <div class="ads-grid two-col">
            <article class="ads-card"><header><h4>1. Autonomous campaign agent</h4><span>budget, keywords, creatives, audience, bid strategy — approval required</span></header><div class="recommendation-list"><article *ngFor="let step of autonomousAgentPlan(audit).steps"><strong>{{ step.title }}</strong><span>{{ step.detail }}</span><small>{{ step.status }}</small></article></div><div class="guardrail-note">{{ autonomousAgentPlan(audit).policy }}</div></article>
            <article class="ads-card"><header><h4>2. Anomaly detection</h4><span>spend spike, CPC jump, lead drop, tracking broken</span></header><div class="health-list"><article *ngFor="let item of anomalyDetection(audit)" [class.warn]="item.severity !== 'normal'"><strong>{{ item.metric }}</strong><span>{{ item.detail }}</span><small>{{ item.severity }}</small></article></div></article>
          </div>

          <div class="ads-grid">
            <article class="ads-card"><header><h4>3. Forecast simulator</h4><span>budget se estimated leads, bookings and revenue</span></header><form class="form-grid mini-form"><label class="field"><span>Budget</span><input type="number" [formControl]="forecastBudget" /></label><label class="field"><span>Expected CPA</span><input type="number" [formControl]="forecastCpa" /></label><label class="field"><span>Booking rate %</span><input type="number" [formControl]="forecastBookingRate" /></label><label class="field"><span>Avg invoice</span><input type="number" [formControl]="forecastAverageInvoice" /></label></form><div class="funnel-row"><article *ngFor="let item of forecastSimulator()"><span>{{ item.label }}</span><strong>{{ item.value }}</strong><small>{{ item.note }}</small></article></div></article>
            <article class="ads-card"><header><h4>4. Customer journey map</h4><span>ad click → WhatsApp → appointment → invoice → repeat</span></header><div class="journey-map"><article *ngFor="let stage of customerJourneyMap(audit)"><strong>{{ stage.stage }}</strong><span>{{ stage.owner }}</span><small>{{ stage.kpi }}</small></article></div></article>
            <article class="ads-card"><header><h4>5. LTV / CAC dashboard</h4><span>customer lifetime value vs acquisition cost</span></header><div class="summary-grid mini-kpis"><article><span>CAC</span><strong>₹{{ ltvCacDashboard(audit).cac }}</strong></article><article><span>LTV</span><strong>₹{{ ltvCacDashboard(audit).ltv }}</strong></article><article><span>LTV:CAC</span><strong>{{ ltvCacDashboard(audit).ratio }}x</strong><small>{{ ltvCacDashboard(audit).label }}</small></article></div></article>
          </div>

          <div class="ads-grid two-col">
            <article class="ads-card"><header><h4>6. Audience intelligence</h4><span>city, age group, service interest, repeat segment</span></header><div class="table-wrap compact"><table><thead><tr><th>Segment</th><th>Insight</th><th>Action</th><th>Priority</th></tr></thead><tbody><tr *ngFor="let row of audienceIntelligence(audit)"><td>{{ row.segment }}</td><td>{{ row.insight }}</td><td>{{ row.action }}</td><td>{{ row.priority }}</td></tr></tbody></table></div></article>
            <article class="ads-card"><header><h4>7. Creative fatigue detector</h4><span>frequency high, CTR down, same ad overused</span></header><div class="health-list"><article *ngFor="let item of creativeFatigueDetector(audit)" [class.warn]="item.status !== 'healthy'"><strong>{{ item.asset }}</strong><span>{{ item.signal }}</span><small>{{ item.status }}</small></article></div></article>
          </div>

          <div class="ads-grid">
            <article class="ads-card"><header><h4>8. A/B testing lab</h4><span>headline, image, audience and offer experiments</span></header><div class="table-wrap compact"><table><thead><tr><th>Test</th><th>A</th><th>B</th><th>Winner rule</th><th>Status</th></tr></thead><tbody><tr *ngFor="let test of abTestingLab(audit)"><td>{{ test.name }}</td><td>{{ test.variantA }}</td><td>{{ test.variantB }}</td><td>{{ test.winnerRule }}</td><td>{{ test.status }}</td></tr></tbody></table></div></article>
            <article class="ads-card"><header><h4>9. AI auto report insights</h4><span>numbers ko business explanation me convert karta hai</span></header><ul class="ai-actions"><li *ngFor="let insight of autoReportInsights(audit)">{{ insight }}</li></ul></article>
            <article class="ads-card"><header><h4>10. Permission system preview</h4><span>owner, manager, agency, client access boundary</span></header><div class="table-wrap compact"><table><thead><tr><th>Role</th><th>Can view</th><th>Can approve</th><th>Can spend</th></tr></thead><tbody><tr *ngFor="let role of permissionPreview()"><td>{{ role.role }}</td><td>{{ role.view }}</td><td>{{ role.approve }}</td><td>{{ role.spend }}</td></tr></tbody></table></div></article>
          </div>

          <div class="ads-grid two-col">
            <article class="ads-card"><header><h4>11. Audit log</h4><span>budget, approval, export and AI action trail</span></header><div class="table-wrap compact"><table><thead><tr><th>Time</th><th>User</th><th>Action</th><th>Result</th></tr></thead><tbody><tr *ngFor="let row of auditLogRows(audit)"><td>{{ row.time }}</td><td>{{ row.user }}</td><td>{{ row.action }}</td><td>{{ row.result }}</td></tr></tbody></table></div></article>
            <article class="ads-card"><header><h4>12. SLA lead response alerts</h4><span>late WhatsApp/call response alert</span></header><div class="health-list"><article *ngFor="let alert of slaLeadAlerts(audit)" [class.warn]="alert.status !== 'on_time'"><strong>{{ alert.lead }}</strong><span>{{ alert.detail }}</span><small>{{ alert.status }}</small></article></div></article>
          </div>

          <div class="ads-grid">
            <article class="ads-card"><header><h4>13. Revenue attribution</h4><span>campaign se exact invoice revenue link</span></header><div class="table-wrap compact"><table><thead><tr><th>Campaign</th><th>Bookings</th><th>Invoices</th><th>Revenue</th><th>ROAS</th></tr></thead><tbody><tr *ngFor="let row of revenueAttribution(audit)"><td>{{ row.campaign }}</td><td>{{ row.bookings }}</td><td>{{ row.invoices }}</td><td>₹{{ row.revenue }}</td><td>{{ row.roas }}x</td></tr></tbody></table></div></article>
            <article class="ads-card"><header><h4>14. Smart recommendation priority</h4><span>high / medium / low impact queue</span></header><div class="recommendation-list"><article *ngFor="let item of smartRecommendationPriority(audit)"><strong>{{ item.priority }} · {{ item.title }}</strong><span>{{ item.why }}</span><small>Impact: {{ item.impact }} · Effort: {{ item.effort }}</small></article></div></article>
            <article class="ads-card executive-card"><header><h4>15. Executive command center</h4><span>profit, waste, best/worst campaign, next action</span></header><div class="status-list"><article><strong>Best campaign</strong><span>{{ executiveCommandCenter(audit).bestCampaign }}</span></article><article><strong>Worst campaign</strong><span>{{ executiveCommandCenter(audit).worstCampaign }}</span></article><article><strong>Next action</strong><span>{{ executiveCommandCenter(audit).nextActionDetail }}</span></article><article><strong>Decision</strong><span>{{ executiveCommandCenter(audit).decision }}</span></article></div></article>
          </div>
        </section>

        <section class="panel business-empire-os">
          <div class="section-title">
            <div>
              <h3>CEO Command Center + AI Workforce + Customer Intelligence</h3>
            </div>
            <span class="ai-pill">Tier 1–8 · local enterprise simulation</span>
          </div>

          <!-- Tier 1 — CEO Command Center -->
          <div class="tier-block">
            <div class="tier-head"><span>Tier 1</span><strong>CEO Command Center</strong></div>
            <div class="summary-grid ceo-score-grid">
              <article class="health-score"><span>Business Health Score</span><strong>{{ businessHealthScore(audit).score }}/100</strong><small>{{ businessHealthScore(audit).label }}</small></article>
              <article><span>Revenue</span><strong>₹{{ businessHealthScore(audit).revenue }}</strong></article>
              <article><span>Profit</span><strong>₹{{ businessHealthScore(audit).profit }}</strong></article>
              <article><span>Staff productivity</span><strong>{{ businessHealthScore(audit).staffProductivity }}%</strong></article>
              <article><span>Customer retention</span><strong>{{ businessHealthScore(audit).retention }}%</strong></article>
              <article><span>Marketing ROI</span><strong>{{ businessHealthScore(audit).marketingRoi }}x</strong></article>
            </div>
            <div class="ads-grid three-col">
              <article class="ads-card"><header><h4>Daily Briefing</h4><span>today, issues and next actions</span></header><div class="status-list"><article><strong>Today</strong><span>{{ dailyAiBriefing(audit).today }}</span></article><article class="warn"><strong>Issues</strong><span>{{ dailyAiBriefing(audit).bad }}</span></article><article><strong>Next action</strong><span>{{ dailyAiBriefing(audit).action }}</span></article></div></article>
              <article class="ads-card"><header><h4>Predictive Revenue</h4><span>next 7 / 30 / 90 days forecast</span></header><div class="funnel-row"><article *ngFor="let row of predictiveRevenue(audit)"><span>{{ row.period }}</span><strong>₹{{ row.revenue }}</strong><small>{{ row.confidence }} confidence</small></article></div></article>
              <article class="ads-card"><header><h4>Cash Flow Forecast</h4><span>salary, rent, inventory and marketing spend</span></header><div class="table-wrap compact"><table><thead><tr><th>Cost</th><th>Amount</th><th>Risk</th></tr></thead><tbody><tr *ngFor="let row of cashFlowForecast(audit)"><td>{{ row.category }}</td><td>₹{{ row.amount }}</td><td>{{ row.risk }}</td></tr></tbody></table></div></article>
            </div>
          </div>

          <!-- Tier 2 — AI Workforce -->
          <div class="tier-block">
            <div class="tier-head"><span>Tier 2</span><strong>AI Workforce</strong></div>
            <div class="ads-grid five-col">
              <article class="ads-card" *ngFor="let worker of aiWorkforceManagers(audit)"><header><h4>{{ worker.role }}</h4><span>{{ worker.focus }}</span></header><strong>{{ worker.recommendation }}</strong><small>{{ worker.action }}</small></article>
            </div>
          </div>

          <!-- Tier 3 — Customer Intelligence -->
          <div class="tier-block">
            <div class="tier-head"><span>Tier 3</span><strong>Customer Intelligence</strong></div>
            <div class="ads-grid two-col">
              <article class="ads-card"><header><h4>Customer 360 Profile</h4><span>visits, services, spend, membership, reviews</span></header><div class="table-wrap compact"><table><thead><tr><th>Customer</th><th>Visits</th><th>Services</th><th>Spend</th><th>Membership</th><th>Reviews</th></tr></thead><tbody><tr *ngFor="let customer of customer360Profiles(audit)"><td>{{ customer.name }}</td><td>{{ customer.visits }}</td><td>{{ customer.services }}</td><td>₹{{ customer.spend }}</td><td>{{ customer.membership }}</td><td>{{ customer.reviews }}</td></tr></tbody></table></div></article>
              <article class="ads-card"><header><h4>Churn Prediction</h4><span>kaun customer chhodne wala hai</span></header><div class="health-list"><article *ngFor="let row of churnPredictions(audit)" [class.warn]="row.risk !== 'low'"><strong>{{ row.customer }}</strong><span>{{ row.reason }}</span><small>{{ row.risk }} risk</small></article></div></article>
            </div>
            <div class="ads-grid three-col">
              <article class="ads-card"><header><h4>Upsell Engine</h4><span>Hair Spa customer ko Facial recommend</span></header><div class="recommendation-list"><article *ngFor="let row of upsellEngine(audit)"><strong>{{ row.customer }}</strong><span>{{ row.offer }}</span><small>{{ row.reason }}</small></article></div></article>
              <article class="ads-card"><header><h4>VIP Customer Detection</h4><span>high spend + high loyalty customers</span></header><div class="status-list"><article *ngFor="let vip of vipCustomers(audit)"><strong>{{ vip.name }}</strong><span>₹{{ vip.spend }} spend · {{ vip.tag }}</span></article></div></article>
              <article class="ads-card"><header><h4>Birthday / Anniversary Automation</h4><span>auto WhatsApp offer queue</span></header><div class="status-list"><article *ngFor="let auto of birthdayAnniversaryAutomation(audit)"><strong>{{ auto.customer }}</strong><span>{{ auto.event }} · {{ auto.message }}</span></article></div></article>
            </div>
          </div>

          <!-- Tier 4 — Franchise Ready -->
          <div class="tier-block">
            <div class="tier-head"><span>Tier 4</span><strong>Franchise Ready</strong></div>
            <div class="ads-grid two-col">
              <article class="ads-card"><header><h4>Multi-Branch Dashboard</h4><span>branch performance overview</span></header><div class="table-wrap compact"><table><thead><tr><th>Branch</th><th>Revenue</th><th>Profit</th><th>Rating</th><th>Rank</th></tr></thead><tbody><tr *ngFor="let branch of branchDashboard(audit)"><td>{{ branch.branch }}</td><td>₹{{ branch.revenue }}</td><td>₹{{ branch.profit }}</td><td>{{ branch.rating }}</td><td>#{{ branch.rank }}</td></tr></tbody></table></div></article>
              <article class="ads-card"><header><h4>Branch Comparison + Regional Manager View</h4><span>best/worst branch and required actions</span></header><div class="status-list"><article *ngFor="let row of branchComparison(audit)" [class.warn]="row.status !== 'healthy'"><strong>{{ row.metric }}</strong><span>{{ row.detail }}</span><small>{{ row.status }}</small></article></div></article>
            </div>
            <article class="ads-card"><header><h4>Franchise Royalty Tracking</h4><span>royalty, pending dues and franchise compliance</span></header><div class="table-wrap compact"><table><thead><tr><th>Branch</th><th>Royalty %</th><th>Due</th><th>Status</th></tr></thead><tbody><tr *ngFor="let row of franchiseRoyaltyTracking(audit)"><td>{{ row.branch }}</td><td>{{ row.royaltyPercent }}%</td><td>₹{{ row.due }}</td><td>{{ row.status }}</td></tr></tbody></table></div></article>
          </div>

          <!-- Tier 5 — Reputation & Local SEO -->
          <div class="tier-block">
            <div class="tier-head"><span>Tier 5</span><strong>Reputation & Local SEO</strong></div>
            <div class="ads-grid three-col">
              <article class="ads-card"><header><h4>Review Management Hub</h4><span>Google Reviews + Facebook Reviews</span></header><div class="table-wrap compact"><table><thead><tr><th>Source</th><th>Rating</th><th>Review</th><th>Status</th></tr></thead><tbody><tr *ngFor="let row of reviewHub(audit)"><td>{{ row.source }}</td><td>{{ row.rating }}</td><td>{{ row.review }}</td><td>{{ row.status }}</td></tr></tbody></table></div></article>
              <article class="ads-card"><header><h4>Review Reply AI + Negative Alert</h4><span>AI response and escalation</span></header><div class="health-list"><article *ngFor="let row of reviewReplyAi(audit)" [class.warn]="row.alert"><strong>{{ row.customer }}</strong><span>{{ row.reply }}</span><small>{{ row.alert ? 'negative alert' : 'ready reply' }}</small></article></div></article>
              <article class="ads-card"><header><h4>Local SEO Rank Heatmap + Competitor Gap</h4><span>area ranking and competitor difference</span></header><div class="table-wrap compact"><table><thead><tr><th>Area</th><th>Rank</th><th>Gap</th><th>Action</th></tr></thead><tbody><tr *ngFor="let row of localSeoHeatmap(audit)"><td>{{ row.area }}</td><td>#{{ row.rank }}</td><td>{{ row.gap }}</td><td>{{ row.action }}</td></tr></tbody></table></div></article>
            </div>
          </div>

          <!-- Tier 6 — Enterprise Security -->
          <div class="tier-block">
            <div class="tier-head"><span>Tier 6</span><strong>Enterprise Security</strong></div>
            <div class="ads-grid three-col">
              <article class="ads-card"><header><h4>Role-Based Access Control</h4><span>Owner, Manager, Staff, Agency, Client</span></header><div class="table-wrap compact"><table><thead><tr><th>Role</th><th>Access</th><th>Restriction</th></tr></thead><tbody><tr *ngFor="let role of enterpriseRoles()"><td>{{ role.role }}</td><td>{{ role.access }}</td><td>{{ role.restriction }}</td></tr></tbody></table></div></article>
              <article class="ads-card"><header><h4>Audit Trail + Activity Monitoring</h4><span>every sensitive action tracked</span></header><div class="status-list"><article *ngFor="let row of enterpriseAuditTrail(audit)"><strong>{{ row.actor }}</strong><span>{{ row.action }}</span><small>{{ row.time }}</small></article></div></article>
              <article class="ads-card"><header><h4>Sensitive Action Approval + Data Export Center</h4><span>budget, delete, export and permission approvals</span></header><div class="health-list"><article *ngFor="let row of sensitiveApprovals(audit)" [class.warn]="row.status !== 'approved'"><strong>{{ row.action }}</strong><span>{{ row.reason }}</span><small>{{ row.status }}</small></article></div><button class="ghost-button full" type="button" (click)="exportEnterpriseSnapshot(audit)">Export enterprise snapshot</button></article>
            </div>
          </div>

          <!-- Tier 7 — Automation Builder -->
          <div class="tier-block">
            <div class="tier-head"><span>Tier 7</span><strong>No-Code Automation Builder</strong></div>
            <div class="ads-grid two-col">
              <article class="ads-card"><header><h4>Workflow Builder</h4><span>new lead → WhatsApp → reminder → booking → invoice</span></header><div class="journey-map workflow-map"><article *ngFor="let step of workflowBuilderSteps()"><strong>{{ step.step }}</strong><span>{{ step.action }}</span><small>{{ step.owner }}</small></article></div></article>
              <article class="ads-card"><header><h4>Event Triggers + Scheduled Automations + Approval Workflows</h4><span>automation rules with human approval gates</span></header><div class="table-wrap compact"><table><thead><tr><th>Trigger</th><th>Schedule</th><th>Approval</th><th>Status</th></tr></thead><tbody><tr *ngFor="let row of automationRules(audit)"><td>{{ row.trigger }}</td><td>{{ row.schedule }}</td><td>{{ row.approval }}</td><td>{{ row.status }}</td></tr></tbody></table></div></article>
            </div>
          </div>

          <!-- Tier 8 — AI Command Center -->
          <div class="tier-block">
            <div class="tier-head"><span>Tier 8</span><strong>AI Command Center</strong></div>
            <div class="ads-grid two-col">
              <article class="ads-card executive-card"><header><h4>Ask Anything About Business</h4><span>last month profit, best campaign, best staff</span></header><textarea class="ai-input" [formControl]="businessCommandQuestion" rows="3" placeholder="Last month profit kyu gira?"></textarea><button class="primary-button full" type="button" (click)="askBusinessCommand(audit)">Ask Business Copilot</button><div class="ai-answer" *ngIf="businessCommandAnswer() as answer"><strong>{{ answer.title }}</strong><p>{{ answer.answer }}</p><small>{{ answer.decision }}</small></div></article>
              <article class="ads-card"><header><h4>Natural Language Reports + Executive AI Chat + Decision Assistant</h4><span>business insight in owner language</span></header><ul class="ai-actions"><li *ngFor="let insight of naturalLanguageReports(audit)">{{ insight }}</li></ul><div class="guardrail-note">Business Copilot rule: financial, budget, staff or customer-sensitive actions require owner approval before execution.</div></article>
            </div>
          </div>
        </section>


        <section class="panel">
          <div class="section-title">
            <div>
              <h3>{{ audit.businessName }} growth plan</h3>
            </div>
          </div>
          <p class="muted">{{ audit.plan?.positioning }}</p>
          <div class="action-grid">
            <article *ngFor="let action of audit.plan?.priorityActions || []"><strong>{{ action }}</strong><span>Owner approval and branch execution required.</span></article>
          </div>
        </section>

        <section class="panel">
          <div class="section-title">
            <div>
              <span class="eyebrow">Level {{ activeLevel() }}</span>
              <h3>{{ activeLevelTitle(audit) }}</h3>
            </div>
          </div>

          <ng-container [ngSwitch]="activeLevel()">
            <ng-container *ngSwitchCase="11">
              <div class="action-grid">
                <article><strong>Grounded answer policy</strong><span>{{ audit.plan?.advancedGrowthSystem?.aiGrowthCopilot?.answerPolicy }}</span></article>
                <article><strong>Live data sources</strong><span>{{ (audit.plan?.advancedGrowthSystem?.aiGrowthCopilot?.liveDataSources || []).join(' · ') }}</span></article>
              </div>
              <div class="table-wrap">
                <table>
                  <thead><tr><th>Question</th><th>Intent</th><th>Answer</th><th>Confidence</th></tr></thead>
                  <tbody>
                    <tr *ngFor="let chat of audit.workspace?.copilotChats || []"><td>{{ chat.question }}</td><td>{{ chat.intent }}</td><td>{{ chat.answer }}</td><td>{{ chat.confidence }}</td></tr>
                  </tbody>
                </table>
              </div>
            </ng-container>

            <ng-container *ngSwitchCase="12">
              <div class="action-grid">
                <article><strong>Profit policy</strong><span>{{ audit.plan?.advancedGrowthSystem?.campaignProfitEngine?.profitPolicy }}</span></article>
                <article><strong>Booking link rule</strong><span>{{ audit.plan?.advancedGrowthSystem?.campaignProfitEngine?.bookingLinkRule }}</span></article>
              </div>
              <div class="table-wrap">
                <table>
                  <thead><tr><th>Campaign</th><th>Source</th><th>Spend</th><th>Leads</th><th>Bookings</th><th>Revenue</th><th>Profit</th><th>ROI</th></tr></thead>
                  <tbody>
                    <tr *ngFor="let campaign of audit.workspace?.campaignProfit || []"><td>{{ campaign.campaignName }}</td><td>{{ campaign.source }}</td><td>₹{{ campaign.spend }}</td><td>{{ campaign.leads }}</td><td>{{ campaign.bookings }}</td><td>₹{{ campaign.revenue }}</td><td>₹{{ campaign.profit }}</td><td>{{ campaign.roiPercent }}%</td></tr>
                  </tbody>
                </table>
              </div>
            </ng-container>

            <ng-container *ngSwitchCase="13">
              <div class="action-grid">
                <article *ngFor="let provider of audit.plan?.advancedGrowthSystem?.approvalPublishingPlanner?.providerReadiness || []"><strong>{{ provider.provider }}</strong><span>{{ provider.status }} · {{ provider.requirement }}</span></article>
              </div>
              <div class="button-row planner-filters">
                <button class="ghost-button" type="button" [class.active]="plannerFilter() === 'today'" (click)="plannerFilter.set('today')">Today</button>
                <button class="ghost-button" type="button" [class.active]="plannerFilter() === 'week'" (click)="plannerFilter.set('week')">This week</button>
                <button class="ghost-button" type="button" [class.active]="plannerFilter() === 'month'" (click)="plannerFilter.set('month')">This month</button>
                <button class="ghost-button" type="button" [class.active]="plannerFilter() === 'all'" (click)="plannerFilter.set('all')">All</button>
              </div>
              <div class="table-wrap">
                <table>
                  <thead><tr><th>Title</th><th>Channel</th><th>Schedule</th><th>Approval</th><th>Publish</th><th>Provider</th></tr></thead>
                  <tbody>
                    <tr *ngFor="let item of filteredPlanner(audit)">
                      <td>{{ item.title }}</td>
                      <td>{{ item.channel }}</td>
                      <td>{{ item.scheduledFor }}</td>
                      <td>
                        <select [value]="item.approvalStatus || 'draft'" (change)="updatePublishingStatus(audit, item, $any($event.target).value)">
                          <option value="draft">Draft</option>
                          <option value="waiting_approval">Waiting approval</option>
                          <option value="approved">Approved</option>
                          <option value="scheduled">Scheduled</option>
                          <option value="published">Published</option>
                          <option value="failed">Failed</option>
                        </select>
                      </td>
                      <td>{{ item.publishStatus }}</td>
                      <td>{{ item.provider }}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </ng-container>

            <ng-container *ngSwitchCase="14">
              <div class="action-grid">
                <article><strong>Mini website builder</strong><span>{{ audit.plan?.advancedGrowthSystem?.localSeoWebsiteBuilder?.platform }}</span></article>
                <article><strong>Schema blocks</strong><span>{{ (audit.plan?.advancedGrowthSystem?.localSeoWebsiteBuilder?.schemaBlocks || []).join(' · ') }}</span></article>
              </div>
              <div class="table-wrap">
                <table>
                  <thead><tr><th>Type</th><th>Title</th><th>Keyword</th><th>Slug</th><th>Tracking</th><th>Status</th></tr></thead>
                  <tbody>
                    <tr *ngFor="let page of audit.workspace?.seoPages || []"><td>{{ page.pageType }}</td><td>{{ page.title }}</td><td>{{ page.targetKeyword }}</td><td>{{ page.slug }}</td><td>{{ page.trackingUrl }}</td><td>{{ page.status }}</td></tr>
                  </tbody>
                </table>
              </div>
            </ng-container>

            <ng-container *ngSwitchCase="15">
              <div class="action-grid">
                <article><strong>Signal policy</strong><span>{{ audit.plan?.advancedGrowthSystem?.aiCompetitorWatch?.sourcePolicy }}</span></article>
                <article><strong>Counter playbook</strong><span>{{ (audit.plan?.advancedGrowthSystem?.aiCompetitorWatch?.counterPlaybook || []).join(' · ') }}</span></article>
              </div>
              <div class="table-wrap">
                <table>
                  <thead><tr><th>Competitor</th><th>Signal</th><th>Severity</th><th>Recommended action</th><th>Status</th></tr></thead>
                  <tbody>
                    <tr *ngFor="let alert of audit.workspace?.competitorAlerts || []"><td>{{ alert.competitorName }}</td><td>{{ alert.signalType }}</td><td>{{ alert.severity }}</td><td>{{ alert.recommendedAction }}</td><td>{{ alert.status }}</td></tr>
                  </tbody>
                </table>
              </div>
            </ng-container>

            <ng-container *ngSwitchDefault>
              <div class="action-grid">
                <article *ngFor="let level of audit.plan?.levels || []">
                  <strong>L{{ level.level }} · {{ level.title }}</strong>
                  <span>{{ level.summary }}</span>
                  <small>{{ level.status }}</small>
                </article>
              </div>
              <div class="table-wrap" *ngIf="audit.workspace?.tasks?.length">
                <table>
                  <thead><tr><th>Task</th><th>Channel</th><th>Owner</th><th>Priority</th><th>Status</th></tr></thead>
                  <tbody>
                    <tr *ngFor="let task of audit.workspace?.tasks || []"><td>{{ task.title }}</td><td>{{ task.channel }}</td><td>{{ task.ownerRole }}</td><td>{{ task.priority }}</td><td>{{ task.status }}</td></tr>
                  </tbody>
                </table>
              </div>
            </ng-container>
          </ng-container>
        </section>
      </ng-container>
    </section>
  `,
  styles: [`
    /* ---- Typography foundation (font fix) ---- */
    :host {
      display: block;
      min-width: 0;
      width: 100%;
      font-family: var(--font-body);
      color: var(--ink);
      -webkit-font-smoothing: antialiased;
      text-rendering: optimizeLegibility;
    }
    :host * { box-sizing: border-box; font-family: inherit; min-width: 0; }
    /* Numbers align in metric cards / tables */
    .metric-card strong, .summary-grid strong, table td, .predict-headline strong, .confidence-bar { font-variant-numeric: tabular-nums; font-feature-settings: 'tnum' 1; }

    .page-stack { display: grid; gap: 1rem; max-width: 100%; min-width: 0; overflow-x: hidden; width: 100%; }
    .rank-hero { align-items: center; background: #fff; border: 1px solid var(--line); border-left: 6px solid #d5cec7; border-radius: 12px; display: flex; gap: 1rem; justify-content: space-between; padding: 1.5rem; }
    .rank-hero h2 { color: var(--ink); font-family: var(--font-display); font-size: 2.35rem; font-weight: 800; letter-spacing: -0.025em; line-height: 1.05; margin: 0.3rem 0 0.5rem; }
    .rank-hero p, .muted { color: var(--muted); margin: 0; line-height: 1.55; max-width: 60ch; }
    .hero-badges, .hero-actions, .button-row { display: flex; flex-wrap: wrap; gap: 0.55rem; }
    .hero-badges span, .badge { background: #EBD9E5; border: 1px solid #C9A8BA; border-radius: 999px; color: var(--teal-deep); font-size: 0.76rem; font-weight: 700; letter-spacing: 0.01em; padding: 0.35rem 0.7rem; }
    .eyebrow { color: var(--teal-deep); font-size: 0.72rem; font-weight: 800; letter-spacing: 0.1em; text-transform: uppercase; }
    .primary-button, .ghost-button, .command-cards button, .audit-row { border: 1px solid var(--line); border-radius: 10px; cursor: pointer; font-family: var(--font-display); font-weight: 700; letter-spacing: -0.005em; transition: transform .08s ease, box-shadow .12s ease, background .12s ease; }
    .primary-button { background: #d5cec7; color: #fff; padding: 0.85rem 1.1rem; }
    .primary-button:hover:not(:disabled) { background: var(--teal-deep); }
    .ghost-button { background: #fff; color: var(--ink); padding: 0.85rem 1.1rem; }
    .ghost-button:hover:not(:disabled) { background: var(--soft); }
    .primary-button:disabled, .ghost-button:disabled, .command-cards button:disabled { opacity: .55; cursor: not-allowed; }
    .metrics-grid, .summary-grid { display: grid; gap: 0.75rem; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); }
    .metric-card, .summary-grid article, .action-grid article, .result-strip, .portal-preview { background: #fff; border: 1px solid var(--line); border-radius: 12px; padding: 1rem; }
    .metric-card span, .metric-card small, .summary-grid span, .summary-grid small, .action-grid span, .action-grid small, .result-strip span, .portal-preview span { color: var(--muted); display: block; font-size: 0.82rem; }
    .metric-card strong, .summary-grid strong, .action-grid strong, .result-strip strong, .portal-preview strong { color: var(--ink); display: block; }
    .metric-card strong, .summary-grid strong { font-family: var(--font-display); font-size: 1.55rem; font-weight: 800; letter-spacing: -0.02em; margin: 0.3rem 0; }
    .link-check-grid { display: grid; gap: .7rem; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); }
    .link-check-grid article { background: #F3EAF0; border: 1px solid #FBF0E8; border-radius: 10px; padding: .8rem; }
    .link-check-grid article.warn { background: #faf8f6; border-color: #fed7aa; }
    .link-check-grid span, .link-check-grid small { color: var(--muted); display: block; font-size: .78rem; }
    .link-check-grid strong { color: var(--teal-deep); display: block; font-family: var(--font-display); font-size: 1rem; margin: .15rem 0; }
    .link-check-grid article.warn strong { color: #c2410c; }
    .metric-card span { font-weight: 600; }
    .level-switch { display: grid; gap: 0.5rem; grid-template-columns: repeat(auto-fit, minmax(112px, 1fr)); }
    .level-switch button { background: #fff; border: 1px solid var(--line); border-radius: 10px; color: #475569; cursor: pointer; display: grid; gap: 0.15rem; min-height: 62px; padding: 0.7rem; text-align: left; transition: border-color .12s ease, box-shadow .12s ease; }
    .level-switch button:hover { border-color: #d5cec7; }
    .level-switch button.active { border-color: #d5cec7; box-shadow: 0 0 0 2px rgba(90, 21, 63, 0.14); }
    .level-switch strong { color: var(--teal-deep); font-family: var(--font-display); font-weight: 800; }
    .level-switch span { font-size: 0.8rem; }
    .workspace-grid { display: grid; gap: 1rem; grid-template-columns: minmax(0, 1.2fr) minmax(280px, 0.8fr); max-width: 100%; }
    .panel { background: #fff; border: 1px solid var(--line); border-radius: 12px; min-width: 0; padding: 1.25rem; }
    .section-title { align-items: center; display: flex; justify-content: space-between; gap: 1rem; margin-bottom: 1.1rem; }
    .section-title h3 { color: var(--ink); font-family: var(--font-display); font-size: 1.2rem; font-weight: 700; letter-spacing: -0.015em; margin: 0.25rem 0 0; }
    .section-title h4 { color: var(--ink); font-family: var(--font-display); font-size: 1.02rem; font-weight: 700; margin: 0; }
    .form-grid, .command-grid { display: grid; gap: 0.8rem; grid-template-columns: repeat(4, minmax(0, 1fr)); }
    .field { color: #526178; display: grid; gap: 0.35rem; font-size: 0.82rem; font-weight: 600; }
    .field.full, .full { grid-column: 1 / -1; }
    .field input, .field textarea, .field select, .ai-input { border: 1px solid var(--line); border-radius: 9px; color: var(--ink); font: inherit; font-weight: 500; padding: 0.7rem 0.8rem; resize: vertical; transition: border-color .12s ease, box-shadow .12s ease; }
    .field input:focus, .field textarea:focus, .field select:focus, .ai-input:focus { border-color: #d5cec7; box-shadow: 0 0 0 3px rgba(90,21,63,.12); outline: none; }
    .audit-list, .action-grid { display: grid; gap: 0.65rem; }
    .audit-row { background: var(--soft); color: var(--ink); display: grid; gap: 0.2rem; padding: 0.85rem; text-align: left; width: 100%; }
    .audit-row:hover { border-color: #d5cec7; }
    .audit-row strong { font-family: var(--font-display); font-weight: 700; }
    .audit-row.active { border-color: #d5cec7; box-shadow: 0 0 0 2px rgba(90,21,63,.12); }
    .audit-row span, .audit-row small { color: var(--muted); font-size: 0.8rem; }
    .command-panel { display: grid; gap: 1rem; }
    .command-cards { display: grid; gap: 0.65rem; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); }
    .command-cards button { background: var(--soft); color: var(--ink); display: grid; gap: 0.2rem; min-height: 74px; padding: 0.85rem; text-align: left; }
    .command-cards button:hover:not(:disabled) { border-color: #d5cec7; transform: translateY(-1px); }
    .command-cards button strong { font-family: var(--font-display); font-weight: 700; }
    .command-cards button.strong { background: #d5cec7; color: #fff; }
    .command-cards button.strong span { color: rgba(255, 255, 255, 0.82); }
    .command-cards button span { color: var(--muted); font-size: 0.8rem; font-weight: 500; }
    .action-message { color: var(--teal-deep); font-weight: 700; }

    /* ---- Advanced AI workbench ---- */
    .ai-workbench { border-top: 3px solid #d5cec7; }
    .ai-pill { background: #F0E4EC; border: 1px solid #C9A8BA; border-radius: 999px; color: var(--teal-deep); font-size: 0.72rem; font-weight: 700; letter-spacing: 0.02em; padding: 0.35rem 0.7rem; }
    .ai-grid { display: grid; gap: 1rem; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); }
    .ai-card { background: var(--soft); border: 1px solid var(--line); border-radius: 12px; display: grid; gap: 0.7rem; padding: 1rem; align-content: start; }
    .ai-card header { display: grid; gap: 0.1rem; }
    .ai-card header span { color: var(--muted); font-size: 0.78rem; }
    .ai-input { width: 100%; }
    .inline-fields { display: grid; gap: 0.6rem; grid-template-columns: 1fr 1fr; }
    .ai-answer { background: #fff; border: 1px solid var(--line); border-radius: 10px; display: grid; gap: 0.45rem; padding: 0.85rem; }
    .ai-answer-head { align-items: center; display: flex; gap: 0.5rem; justify-content: space-between; }
    .ai-answer-head strong { color: var(--teal-deep); font-family: var(--font-display); font-size: 0.82rem; text-transform: capitalize; }
    .ai-answer p { color: var(--ink); line-height: 1.55; margin: 0; }
    .provider-tag { background: #EBD9E5; border-radius: 999px; color: var(--teal-deep); font-size: 0.68rem; font-weight: 700; padding: 0.18rem 0.5rem; text-transform: uppercase; }
    .provider-tag.local { background: #fef3c7; color: #92670c; }
    .confidence-bar { background: #e7efed; border-radius: 999px; height: 7px; overflow: hidden; }
    .confidence-bar span { background: linear-gradient(90deg, #d5cec7, var(--teal-deep)); display: block; height: 100%; }
    .ai-actions { color: var(--ink); display: grid; gap: 0.3rem; margin: 0.3rem 0 0; padding-left: 1.1rem; }
    .ai-actions li { font-size: 0.85rem; line-height: 1.45; }
    .predict-result { background: #fff; border: 1px solid var(--line); border-radius: 10px; display: grid; gap: 0.45rem; padding: 0.85rem; }
    .predict-headline { align-items: baseline; display: flex; gap: 0.55rem; }
    .predict-headline strong { color: var(--teal-deep); font-family: var(--font-display); font-size: 1.9rem; font-weight: 800; letter-spacing: -0.03em; }
    .predict-headline.low strong { color: var(--muted); }
    .predict-headline span { color: var(--muted); font-size: 0.8rem; }
    .basis { color: var(--ink); font-size: 0.85rem; line-height: 1.5; margin: 0; }
    .honest { color: #92670c; font-size: 0.76rem; }
    .file-drop { align-items: center; background: #fff; border: 1.5px dashed #C9A8BA; border-radius: 10px; color: var(--teal-deep); cursor: pointer; display: flex; font-weight: 600; justify-content: center; min-height: 54px; padding: 0.7rem; text-align: center; transition: background .12s ease, border-color .12s ease; }
    .file-drop:hover { background: #F0E4EC; border-color: #d5cec7; }
    .verify-result { border-radius: 10px; display: grid; gap: 0.35rem; padding: 0.85rem; }
    .verify-result.pass { background: #F0E4EC; border: 1px solid #C9A8BA; }
    .verify-result.fail { background: #fef2f2; border: 1px solid #f3c6c6; }
    .verify-result strong { font-family: var(--font-display); font-size: 1.05rem; font-weight: 800; }
    .verify-result.pass strong { color: var(--teal-deep); }
    .verify-result.fail strong { color: #b91c1c; }
    .verify-result .verdict { color: var(--ink); font-size: 0.85rem; }
    .verify-result small { color: var(--muted); font-size: 0.76rem; }
    .verify-result .issues { color: #b91c1c; display: grid; gap: 0.25rem; margin: 0.2rem 0 0; padding-left: 1.1rem; }
    .verify-result .issues li { font-size: 0.82rem; }

    .toast { align-items: center; border-radius: 10px; display: flex; justify-content: space-between; padding: 0.8rem 1rem; }
    .toast.success { background: #F0E4EC; border: 1px solid #C9A8BA; color: var(--teal-deep); }
    .toast.error { background: #fef2f2; border: 1px solid #f3c6c6; color: #b91c1c; }
    .toast.info { background: #f0ece9; border: 1px solid #E7DDD6; color: #4B1238; }
    .toast button { background: transparent; border: 0; cursor: pointer; font-size: 1.2rem; }
    .section-actions { align-items: center; display: flex; flex-wrap: wrap; gap: 0.5rem; justify-content: flex-end; }
    .audit-filters { margin-bottom: 0.8rem; }
    .row-actions { display: flex !important; gap: 0.6rem; margin-top: 0.3rem; }
    .row-actions em { color: var(--teal-deep); font-style: normal; font-weight: 800; }
    .row-actions em.danger { color: #b91c1c; }
    .score-breakdown { display: grid; gap: 0.65rem; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); }
    .score-breakdown article { background: var(--soft); border: 1px solid var(--line); border-radius: 10px; padding: 0.8rem; }
    .score-breakdown span { color: var(--muted); display: block; font-size: 0.78rem; }
    .score-breakdown strong { color: var(--teal-deep); font-family: var(--font-display); font-size: 1.35rem; }
    .planner-filters { margin: 0.5rem 0; }
    .planner-filters .active { border-color: #d5cec7; box-shadow: 0 0 0 2px rgba(90,21,63,.12); }
    .ai-history { display: grid; gap: 0.65rem; }
    .ai-history article { background: var(--soft); border: 1px solid var(--line); border-radius: 10px; padding: 0.85rem; }
    .ai-history p { color: var(--ink); line-height: 1.5; margin: 0.35rem 0; }
    .ai-history small { color: var(--muted); }

    /* ---- Dhanda-style mobile portal preview ---- */
    .growth-report-engine { border-top: 4px solid #f05a28; }
    .report-summary-band { display: grid; gap: .75rem; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); }
    .report-summary-band article { background: #fff; border: 1px solid var(--line); border-radius: 12px; padding: 1rem; }
    .report-summary-band span, .report-summary-band small { color: var(--muted); display: block; font-size: .8rem; }
    .report-summary-band strong { color: var(--ink); display: block; font-family: var(--font-display); font-size: 1.55rem; font-weight: 900; margin: .3rem 0; }
    .report-summary-band .score-report { background: linear-gradient(135deg, #faf8f6, #f0ece9); border-color: #fed7aa; }
    .report-summary-band .score-report strong { color: #f05a28; font-size: 2rem; }
    .report-grid { display: grid; gap: 1rem; grid-template-columns: repeat(2, minmax(0, 1fr)); margin-top: 1rem; }
    .report-card { background: var(--soft); border: 1px solid var(--line); border-radius: 12px; display: grid; gap: .85rem; padding: 1rem; }
    .report-card.wide { grid-column: 1 / -1; }
    .report-card header { align-items: center; display: flex; gap: .75rem; justify-content: space-between; }
    .report-card h4 { color: var(--ink); font-family: var(--font-display); font-size: 1rem; font-weight: 850; margin: 0; }
    .report-card header span { color: var(--muted); font-size: .8rem; }
    .report-link { background: #fff; border: 1px solid var(--line); border-radius: 999px; color: var(--teal-deep); cursor: pointer; flex: 0 0 auto; font-weight: 850; padding: .45rem .75rem; }
    .report-link:hover { border-color: #d5cec7; box-shadow: 0 8px 18px rgba(90, 21, 63, .12); }
    .opened-report-panel { align-items: center; background: #F5EEF2; border: 1px solid #D4B8CC; border-radius: 12px; display: flex; gap: 1rem; justify-content: space-between; margin-top: 1rem; padding: 1rem; }
    .opened-report-panel h4 { color: var(--ink); font-family: var(--font-display); font-size: 1.05rem; font-weight: 900; margin: .15rem 0; }
    .opened-report-panel p { color: var(--muted); margin: 0; }
    .growth-action-list { display: grid; gap: .65rem; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); }
    .growth-action-list article { align-items: center; background: #fff; border: 1px solid var(--line); border-radius: 12px; display: grid; gap: .7rem; grid-template-columns: auto 1fr auto; padding: .85rem; }
    .growth-action-list article > span { align-items: center; border-radius: 999px; color: #fff; display: inline-flex; font-weight: 900; height: 42px; justify-content: center; width: 42px; }
    .growth-action-list strong, .growth-action-list small { display: block; }
    .growth-action-list small { color: var(--muted); font-size: .78rem; line-height: 1.35; }
    .growth-action-list em { color: var(--teal-deep); font-style: normal; font-weight: 850; }
    .request-report { display: grid; gap: .55rem; grid-template-columns: repeat(4, minmax(0, 1fr)); }
    .request-report article { background: #fff; border: 1px solid var(--line); border-radius: 10px; padding: .75rem; }
    .request-report span { color: var(--muted); display: block; font-size: .75rem; }
    .request-report strong { color: var(--ink); display: block; font-family: var(--font-display); font-size: 1.25rem; margin-top: .2rem; }
    .chart-grid { display: grid; gap: .75rem; grid-template-columns: repeat(auto-fit, minmax(230px, 1fr)); }
    .report-table div { grid-template-columns: 1fr auto auto; }
    .calendar-board em { color: var(--teal-deep); font-size: .7rem; font-style: normal; font-weight: 850; text-transform: capitalize; }
    .score-gauge, .rating-card, .calendar-card, .request-stats article, .customer-row, .chart-card, .empty-posts, .planner-list article { background: #fff; border: 1px solid #e5edf3; border-radius: 16px; padding: 1rem; }
    .phone-kpis, .report-metrics { display: grid; gap: .55rem; grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .phone-kpis article, .report-metrics article { background: #fff; border: 1px solid #e5edf3; border-radius: 14px; padding: .8rem; }
    .phone-kpis small, .report-metrics small, .calendar-card small, .chart-card small, .planner-list small { color: #64748b; display: block; font-size: .72rem; }
    .phone-kpis strong, .report-metrics strong { color: #111827; display: block; font-family: var(--font-display); font-size: 1.2rem; margin-top: .2rem; }
    .mini-table { background: #fff; border: 1px solid #e5edf3; border-radius: 14px; overflow: hidden; }
    .mini-table div { align-items: center; border-bottom: 1px solid #eef2f7; display: grid; gap: .5rem; grid-template-columns: 1fr auto; padding: .75rem .85rem; }
    .mini-table div:last-child { border-bottom: 0; }
    .mini-table span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .mini-table strong { color: #111827; }
    .calendar-days span.active { background: #F5EEF2; color: #8B5E7C; font-weight: 850; }
    .pill-tabs button.active { background: #071036; color: #fff; }
    .report-metrics span { color: #C87D4B; display: block; font-size: .72rem; font-weight: 850; }
    .report-metrics span.down { color: #dc2626; }
    .chart-card { display: grid; gap: .65rem; }
    .chart-card div:first-child { align-items: center; display: flex; justify-content: space-between; }
    .line-chart { align-items: end; display: flex; gap: .45rem; height: 112px; padding-top: .5rem; }
    .line-chart span { background: #4f7bea; border-radius: 999px 999px 4px 4px; flex: 1; min-height: 10%; }
    .chart-card p { background: #4f7bea; border-radius: 12px; color: #fff; line-height: 1.45; margin: 0; padding: .75rem; }
    .calendar-board { display: grid; gap: .55rem; grid-template-columns: repeat(auto-fit, minmax(90px, 1fr)); }
    .calendar-board span { background: #faf8f6; border: 1px solid #fed7aa; border-radius: 10px; display: grid; gap: .2rem; padding: .65rem; }
    .calendar-board span.approved { background: #f0ece9; border-color: #E7DDD6; }
    .calendar-board span.posted { background: #F0E4EC; border-color: #C9A8BA; }
    .calendar-board strong, .calendar-board small { display: block; }
    .calendar-board small { color: var(--muted); font-size: .72rem; line-height: 1.35; }

    /* ---- Enterprise Ads Command Center ---- */
    .ads-command-center { border-top: 3px solid #4B1238; }
    .section-actions { align-items: center; display: flex; flex-wrap: wrap; gap: 0.55rem; justify-content: flex-end; }
    .ads-grid { display: grid; gap: 1rem; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); margin-top: 1rem; }
    .ads-grid.two-col { grid-template-columns: repeat(auto-fit, minmax(360px, 1fr)); }
    .ads-card { background: var(--soft); border: 1px solid var(--line); border-radius: 12px; display: grid; gap: 0.75rem; padding: 1rem; align-content: start; }
    .ads-card header { display: grid; gap: 0.12rem; }
    .ads-card h4 { color: var(--ink); font-family: var(--font-display); font-size: 1rem; font-weight: 800; letter-spacing: -0.01em; margin: 0; }
    .ads-card header span, .ads-card small { color: var(--muted); font-size: 0.78rem; }
    .ads-kpi-grid { margin-bottom: 0.35rem; }
    .table-wrap.compact { margin-top: 0; max-height: 340px; }
    .channel-strip, .approval-flow { display: flex; flex-wrap: wrap; gap: 0.45rem; }
    .channel-strip span, .approval-flow span { background: #F8EEF4; border: 1px solid #E7DDD6; border-radius: 999px; color: #4B1238; font-size: 0.76rem; font-weight: 800; padding: 0.35rem 0.65rem; }
    .recommendation-list, .health-list, .status-list { display: grid; gap: 0.55rem; }
    .recommendation-list article, .health-list article, .status-list article, .copy-output { background: #fff; border: 1px solid var(--line); border-radius: 10px; display: grid; gap: 0.25rem; padding: 0.75rem; }
    .recommendation-list strong, .health-list strong, .status-list strong, .copy-output strong { color: var(--ink); font-family: var(--font-display); font-weight: 800; }
    .recommendation-list span, .health-list span, .status-list span, .copy-output p { color: var(--muted); font-size: 0.84rem; line-height: 1.45; margin: 0; }
    .health-list article.warn { border-color: #fbbf24; background: #fffbeb; }
    .funnel-row { display: grid; gap: 0.6rem; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); }
    .funnel-row article { background: #fff; border: 1px solid var(--line); border-radius: 10px; padding: 0.75rem; }
    .funnel-row span { color: var(--muted); display: block; font-size: 0.76rem; }
    .funnel-row strong { color: var(--teal-deep); display: block; font-family: var(--font-display); font-size: 1.3rem; font-weight: 800; margin: 0.2rem 0; }
    .mini-form { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .guardrails-card { border-color: #fbbf24; }


    /* ---- AuraShine Enterprise OS Tier 1-8 ---- */
    .business-empire-os { border-top: 4px solid #111827; }
    .tier-block { border: 1px solid var(--line); border-radius: 14px; display: grid; gap: 1rem; margin-top: 1rem; padding: 1rem; background: linear-gradient(180deg, #fff, #faf8f6); }
    .tier-head { align-items: center; display: flex; flex-wrap: wrap; gap: .6rem; }
    .tier-head span { background: #111827; border-radius: 999px; color: #fff; font-size: .72rem; font-weight: 800; padding: .28rem .65rem; }
    .tier-head strong { color: var(--ink); font-family: var(--font-display); font-size: 1.05rem; }
    .tier-head small { color: var(--muted); }
    .health-score { border-color: #111827; box-shadow: 0 0 0 2px rgba(17,24,39,.08); }
    .three-col { grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); }
    .five-col { grid-template-columns: repeat(auto-fit, minmax(185px, 1fr)); }
    .workflow-map article { border-style: dashed; }

        /* ---- Enterprise AI Growth OS ---- */
    .enterprise-ai-os { border-top: 3px solid #7c3aed; }
    .ai-os-kpi-grid { margin-bottom: 0.35rem; }
    .journey-map { display: grid; gap: 0.6rem; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); }
    .journey-map article { background: #fff; border: 1px solid var(--line); border-radius: 10px; padding: 0.75rem; }
    .journey-map article strong, .journey-map article span, .journey-map article small { display: block; }
    .journey-map article span, .journey-map article small { color: var(--muted); font-size: 0.78rem; }
    .mini-kpis { grid-template-columns: repeat(auto-fit, minmax(110px, 1fr)); }
    .mini-kpis article { padding: 0.75rem; }
    .guardrail-note { background: #faf8f6; border: 1px solid #fed7aa; border-radius: 10px; color: #9a3412; font-size: 0.82rem; line-height: 1.45; padding: 0.75rem; }
    .executive-card { background: linear-gradient(180deg, #fff, #f0ece9); border-color: #ddd6fe; }

    .table-wrap { border: 1px solid var(--line); border-radius: 10px; margin-top: 1rem; max-height: 520px; overflow: auto; }
    table { border-collapse: collapse; width: 100%; }
    th, td { border-bottom: 1px solid #e7efed; color: #334155; padding: 0.75rem; text-align: left; vertical-align: top; }
    th { background: var(--soft); color: #526178; font-size: 0.74rem; font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase; }
    .empty-state { background: var(--soft); border: 1px dashed #C9A8BA; border-radius: 10px; color: var(--muted); padding: 1.1rem; }
    @media (max-width: 900px) {
      .rank-hero, .section-title { align-items: stretch; flex-direction: column; }
      .workspace-grid, .form-grid, .command-grid, .ai-grid, .inline-fields, .report-grid, .dashboard-grid { grid-template-columns: minmax(0, 1fr); }
      .rank-hero h2 { font-size: 1.85rem; }
      .phone-kpis, .report-metrics, .request-stats, .request-report { grid-template-columns: 1fr; }
    }
    @media (prefers-reduced-motion: reduce) {
      .primary-button, .ghost-button, .command-cards button, .level-switch button, .audit-row, .file-drop { transition: none; }
    }
  `]
})
export class GrowthRankBotComponent implements OnInit {
  readonly audits = signal<ApiRecord[]>([]);
  readonly dashboard = signal<ApiRecord | null>(null);
  readonly commandCenter = signal<ApiRecord | null>(null);
  readonly selectedAudit = signal<ApiRecord | null>(null);
  readonly portalPreview = signal<ApiRecord | null>(null);
  readonly latestCommandResult = signal<ApiRecord | null>(null);
  readonly loading = signal(true);
  readonly saving = signal(false);
  readonly error = signal('');
  readonly actionBusy = signal('');
  readonly actionMessage = signal('');
  readonly activeLevel = signal(11);
  readonly activeGrowthReport = signal('');
  readonly activeScore = computed(() => this.selectedAudit()?.plan?.rankReadinessScore || this.selectedAudit()?.score || 0);
  readonly editMode = signal(false);
  readonly auditSearch = signal('');
  readonly auditStatusFilter = signal('all');
  readonly plannerFilter = signal<'today' | 'week' | 'month' | 'all'>('all');
  readonly toast = signal<{ type: 'success' | 'error' | 'info'; message: string } | null>(null);
  readonly filteredAudits = computed(() => {
    const query = this.auditSearch().trim().toLowerCase();
    const status = this.auditStatusFilter();
    return this.audits().filter((audit) => {
      const haystack = [audit.businessName, audit.industry, audit.city, audit.market, audit.status].filter(Boolean).join(' ').toLowerCase();
      const matchesSearch = !query || haystack.includes(query);
      const matchesStatus = status === 'all' || String(audit.status || '').toLowerCase() === status;
      return matchesSearch && matchesStatus;
    });
  });

  // ---- Advanced AI workbench state ----
  readonly aiBusy = signal('');
  readonly copilotAnswer = signal<ApiRecord | null>(null);
  readonly prediction = signal<ApiRecord | null>(null);
  readonly verifyResult = signal<ApiRecord | null>(null);

  readonly levels = [
    { level: 1, label: 'Foundation' },
    { level: 2, label: 'Pro Growth' },
    { level: 3, label: 'Automation' },
    { level: 4, label: 'Integrations' },
    { level: 5, label: 'Agency SaaS' },
    { level: 6, label: 'Rank Tracker' },
    { level: 7, label: 'Content Factory' },
    { level: 8, label: 'Attribution' },
    { level: 9, label: 'Portal Billing' },
    { level: 10, label: 'Agency OS' },
    { level: 11, label: 'Growth Copilot' },
    { level: 12, label: 'Profit Engine' },
    { level: 13, label: 'Publishing' },
    { level: 14, label: 'SEO Website' },
    { level: 15, label: 'Competitor Watch' }
  ];

  readonly auditForm = this.fb.group({
    businessName: ['AuraShine Salon', Validators.required],
    industry: ['Salon & beauty'],
    city: ['Mumbai'],
    targetArea: ['Andheri West'],
    clientEmail: ['owner@aurashine.in'],
    packageName: ['Growth Pro'],
    monthlyFee: ['30000'],
    topServices: ['haircut, hair spa, bridal makeup, facial'],
    rankKeywords: ['salon near me, best salon in Mumbai, hair spa near me, bridal makeup near me, facial near Andheri West'],
    competitors: ['Andheri Beauty Studio, Glow Hair Lounge, Bridal Pro Salon, Skin Craft Clinic, Urban Salon Hub'],
    goal: ['Increase local discovery, WhatsApp leads and booking conversions'],
    instagramUrl: ['https://instagram.com/aurashine'],
    facebookUrl: ['https://facebook.com/aurashine'],
    googleProfileUrl: ['https://maps.google.com/?q=AuraShine+Salon']
  });

  readonly commandForm = this.fb.group({
    rankRows: ['salon near me: 8\nbest salon in Mumbai: 12\nhair spa near me: 6'],
    copilotQuestion: ['mere salon ki ranking kyu down hai?'],
    metaReach: ['9800'],
    metaMessages: ['42'],
    googleViews: ['1350'],
    googleCalls: ['58'],
    campaignName: ['Weekend hair spa reel'],
    campaignSource: ['Instagram Reel'],
    campaignSpend: ['3500'],
    campaignLeads: ['24'],
    campaignBookings: ['8'],
    campaignRevenue: ['32000'],
    publishingTitle: ['Approved hair spa proof reel'],
    publishingChannel: ['Instagram'],
    scheduledFor: [new Date(Date.now() + 86400000).toISOString().slice(0, 10)],
    competitorName: ['Andheri Beauty Studio'],
    competitorSignal: ['new_offer'],
    competitorAction: ['Launch counter proof reel, Google post and WhatsApp follow-up within 24 hours']
  });

  // ---- Advanced AI controls ----
  readonly aiCopilotQuestion = this.fb.control('mere salon ki ranking kyu down hai?');
  readonly predictChannel = this.fb.control('Instagram Reel');
  readonly predictScore = this.fb.control(82);
  readonly verifyTarget = this.fb.control('instagram_post');

  // ---- Enterprise Ads Command Center state ----
  readonly generatedAdCopy = signal<ApiRecord | null>(null);
  readonly adCopyForm = this.fb.group({
    offer: ['Hair spa + consultation offer'],
    audience: ['women 18-45 near Andheri West'],
    platform: ['Google Ads'],
    tone: ['Premium']
  });

  // ---- Enterprise AI Growth OS local simulation state ----
  readonly forecastBudget = this.fb.control(10000);
  readonly forecastCpa = this.fb.control(250);
  readonly forecastBookingRate = this.fb.control(35);
  readonly forecastAverageInvoice = this.fb.control(4000);


  // ---- AuraShine Enterprise OS Tier 1-8 state ----
  readonly businessCommandQuestion = this.fb.control('Last month profit kyu gira?');
  readonly businessCommandAnswer = signal<ApiRecord | null>(null);

  constructor(private readonly api: ApiService, private readonly fb: UntypedFormBuilder) {}

  ngOnInit(): void {
    this.refreshAll();
  }

  refreshAll(): void {
    this.loadAudits();
    this.loadDashboard();
    this.loadCommandCenter();
  }

  selectLevel(level: number): void {
    this.activeLevel.set(level);
  }

  activeLevelTitle(audit: ApiRecord): string {
    const level = (audit.plan?.levels || []).find((item: ApiRecord) => Number(item.level) === this.activeLevel());
    return level?.title || this.levels.find((item) => item.level === this.activeLevel())?.label || 'Growth workspace';
  }

  loadAudits(): void {
    this.loading.set(true);
    this.error.set('');
    this.api.list<ApiRecord[]>('growth-rank-bot/audits').subscribe({
      next: (audits) => {
        this.audits.set(audits);
        if (audits.length) {
          const selected = this.selectedAudit();
          if (!selected) {
            this.loadAuditDetail(audits[0].id);
            return;
          }
          this.loadAuditDetail(selected.id);
          return;
        }
        this.loading.set(false);
      },
      error: (error) => {
        this.error.set(this.api.errorText(error, 'Unable to load growth rank audits'));
        this.loading.set(false);
      }
    });
  }

  loadDashboard(): void {
    this.api.list<ApiRecord>('growth-rank-bot/dashboard').subscribe({
      next: (dashboard) => this.dashboard.set(dashboard),
      error: (error) => this.error.set(this.api.errorText(error, 'Unable to load agency growth dashboard'))
    });
  }

  loadCommandCenter(): void {
    this.api.list<ApiRecord>('growth-rank-bot/command-center').subscribe({
      next: (command) => this.commandCenter.set(command),
      error: () => this.commandCenter.set(null)
    });
  }

  approveGrowthWorkflowItem(item: ApiRecord): void {
    if (!item?.id || !item?.type) return;
    this.actionBusy.set(`approval-${item.id}`);
    this.api.patch<ApiRecord>(`growth-rank-bot/approval-workflow/${item.type}/${item.id}/status`, { status: 'approved' }).subscribe({
      next: () => {
        this.actionBusy.set('');
        this.loadCommandCenter();
        this.loadDashboard();
      },
      error: (error) => {
        this.error.set(this.api.errorText(error, 'Unable to approve growth workflow item'));
        this.actionBusy.set('');
      }
    });
  }

  generateAudit(): void {
    if (this.auditForm.invalid) {
      this.auditForm.markAllAsTouched();
      return;
    }
    this.saving.set(true);
    this.error.set('');
    this.api.post<ApiRecord>('growth-rank-bot/audits', this.payload()).subscribe({
      next: (audit) => {
        this.selectedAudit.set(audit);
        this.patchCommandForm(audit);
        this.audits.set([audit, ...this.audits().filter((item) => item.id !== audit.id)]);
        this.loadDashboard();
        this.saving.set(false);
      },
      error: (error) => {
        this.error.set(this.api.errorText(error, 'Unable to generate rank plan'));
        this.saving.set(false);
      }
    });
  }

  selectAudit(audit: ApiRecord): void {
    this.selectedAudit.set(audit);
    this.patchAuditForm(audit);
    this.patchCommandForm(audit);
    this.portalPreview.set(null);
    this.latestCommandResult.set(null);
    this.actionMessage.set('');
    this.editMode.set(false);
    this.copilotAnswer.set(null);
    this.prediction.set(null);
    this.verifyResult.set(null);
    this.loadAuditDetail(audit.id);
  }

  startEdit(audit: ApiRecord): void {
    this.selectedAudit.set(audit);
    this.patchAuditForm(audit);
    this.editMode.set(true);
    this.showToast('info', 'Audit edit mode enabled.');
  }

  cancelEdit(): void {
    this.editMode.set(false);
    const audit = this.selectedAudit();
    if (audit) this.patchAuditForm(audit);
  }

  updateAudit(): void {
    const audit = this.selectedAudit();
    if (!audit?.id) {
      this.showToast('error', 'Select an audit before updating.');
      return;
    }
    if (this.auditForm.invalid) {
      this.auditForm.markAllAsTouched();
      return;
    }
    this.saving.set(true);
    this.error.set('');
    this.api.patch<ApiRecord>(`growth-rank-bot/audits/${audit.id}`, this.payload()).subscribe({
      next: (updated) => {
        this.selectedAudit.set(updated);
        this.audits.set([updated, ...this.audits().filter((item) => item.id !== updated.id)]);
        this.patchCommandForm(updated);
        this.editMode.set(false);
        this.saving.set(false);
        this.showToast('success', 'Audit updated successfully.');
        this.loadDashboard();
      },
      error: (error) => {
        this.error.set(this.api.errorText(error, 'Unable to update audit'));
        this.saving.set(false);
        this.showToast('error', 'Audit update failed.');
      }
    });
  }

  deleteAudit(audit: ApiRecord): void {
    if (!audit?.id) return;
    if (!window.confirm(`Archive ${audit.businessName || 'this audit'}?`)) return;
    this.actionBusy.set('delete');
    this.error.set('');
    const payload = {
      ...(audit.input || {}),
      businessName: audit.businessName,
      industry: audit.industry,
      city: audit.city,
      targetArea: audit.targetArea,
      instagramUrl: audit.instagramUrl,
      facebookUrl: audit.facebookUrl,
      googleProfileUrl: audit.googleProfileUrl,
      goal: audit.goal,
      status: 'archived'
    };
    this.api.patch<ApiRecord>(`growth-rank-bot/audits/${audit.id}`, payload).subscribe({
      next: () => {
        this.audits.set(this.audits().filter((item) => item.id !== audit.id));
        if (this.selectedAudit()?.id === audit.id) {
          this.selectedAudit.set(null);
          this.portalPreview.set(null);
          this.latestCommandResult.set(null);
        }
        this.actionBusy.set('');
        this.showToast('success', 'Audit archived.');
        this.loadDashboard();
      },
      error: (error: unknown) => {
        this.error.set(this.api.errorText(error, 'Unable to archive audit'));
        this.actionBusy.set('');
        this.showToast('error', 'Audit archive failed.');
      }
    });
  }

  printReport(): void {
    window.print();
  }

  async copyWhatsAppReport(audit: ApiRecord): Promise<void> {
    const text = this.buildWhatsAppReport(audit);
    try {
      await navigator.clipboard.writeText(text);
      this.showToast('success', 'WhatsApp report copied.');
    } catch {
      this.showToast('error', 'Clipboard copy failed. Browser permission check karein.');
    }
  }

  buildWhatsAppReport(audit: ApiRecord): string {
    const score = audit.plan?.rankReadinessScore || audit.score || 0;
    const tasks = audit.workspace?.tasks?.length || 0;
    const keywords = audit.workspace?.rankKeywords?.length || 0;
    const roi = audit.workspace?.campaignProfit?.[0]?.roiPercent;
    const actions = (audit.plan?.priorityActions || []).slice(0, 3).map((item: string, index: number) => `${index + 1}. ${item}`).join('\n');
    return [
      `*${audit.businessName || 'Growth Plan'}*`,
      `Rank score: ${score}`,
      `Keywords tracked: ${keywords}`,
      `Open tasks: ${tasks}`,
      roi !== undefined ? `Latest ROI: ${roi}%` : '',
      actions ? `\nPriority actions:\n${actions}` : '',
      '\nReply YES to approve next execution batch.'
    ].filter(Boolean).join('\n');
  }

  filteredPlanner(audit: ApiRecord): ApiRecord[] {
    const rows = Array.isArray(audit.workspace?.publishingPlanner) ? audit.workspace.publishingPlanner : [];
    const filter = this.plannerFilter();
    if (filter === 'all') return rows;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return rows.filter((item: ApiRecord) => {
      const date = this.plannerDate(item.scheduledFor);
      if (!date) return false;
      if (filter === 'today') return date.getTime() === today.getTime();
      const diffDays = Math.floor((date.getTime() - today.getTime()) / 86400000);
      if (filter === 'week') return diffDays >= 0 && diffDays <= 7;
      return date.getFullYear() === today.getFullYear() && date.getMonth() === today.getMonth();
    });
  }

  updatePublishingStatus(audit: ApiRecord, item: ApiRecord, status: string): void {
    if (!audit?.id || !item?.id) {
      this.showToast('error', 'Publishing item id missing hai.');
      return;
    }
    this.runPatch('planner-status', `growth-rank-bot/audits/${audit.id}/publishing-planner/${item.id}/status`, {
      approvalStatus: status,
      publishStatus: status === 'published' ? 'published' : item.publishStatus
    }, audit.id, 'Publishing status updated', `Planner item moved to ${status}`);
  }

  scoreBreakdown(audit: ApiRecord): { label: string; value: number }[] {
    const plan = audit.plan || {};
    const workspace = audit.workspace || {};
    const base = Number(plan.rankReadinessScore || audit.score || 0);
    return [
      { label: 'SEO', value: Number(plan.seoScore || workspace.seoScore || Math.min(100, base + 4)) },
      { label: 'Social', value: Number(plan.socialScore || workspace.socialScore || Math.max(0, base - 3)) },
      { label: 'Content', value: Number(plan.contentScore || (workspace.contentFactory?.length ? Math.min(100, base + 6) : base)) },
      { label: 'Competitor', value: Number(plan.competitorScore || (workspace.competitorAlerts?.length ? Math.min(100, base + 2) : base)) },
      { label: 'Conversion', value: Number(plan.conversionScore || (workspace.campaignProfit?.length ? Math.min(100, base + 5) : base)) }
    ];
  }

  firstItem(value: unknown): ApiRecord | null {
    return Array.isArray(value) && value.length ? (value[0] as ApiRecord) : null;
  }


  // ============ ENTERPRISE ADS COMMAND CENTER METHODS ============

  adsCommandSummary(audit: ApiRecord): ApiRecord {
    const googleRows = this.googleAdsRows(audit);
    const metaRows = this.metaAdsRows(audit);
    const googleSpend = googleRows.reduce((sum, row) => sum + Number(row.budget || 0), 0);
    const googleConversions = googleRows.reduce((sum, row) => sum + Number(row.conversions || 0), 0);
    const googleRevenue = googleRows.reduce((sum, row) => sum + (Number(row.budget || 0) * Number(row.roas || 0)), 0);
    const metaSpend = metaRows.reduce((sum, row) => sum + Number(row.spend || 0), 0);
    const metaLeads = metaRows.reduce((sum, row) => sum + Number(row.leads || 0), 0);
    const avgMetaCtr = metaRows.length ? Math.round((metaRows.reduce((sum, row) => sum + Number(row.ctr || 0), 0) / metaRows.length) * 10) / 10 : 0;
    const healthScore = Math.max(55, Math.min(96, Number(audit.plan?.rankReadinessScore || audit.score || 82)));
    return {
      googleSpend,
      googleConversions,
      googleRoas: googleSpend ? Math.round((googleRevenue / googleSpend) * 10) / 10 : 0,
      metaSpend,
      metaLeads,
      metaCtr: avgMetaCtr,
      healthScore,
      healthLabel: healthScore >= 85 ? 'scale ready' : healthScore >= 70 ? 'optimize before scale' : 'needs cleanup'
    };
  }

  googleAdsRows(audit: ApiRecord): ApiRecord[] {
    const existing = audit.workspace?.googleAds || audit.workspace?.ads?.google || audit.plan?.advancedGrowthSystem?.adsCommandCenter?.googleAds;
    if (Array.isArray(existing) && existing.length) return existing;
    return [
      { campaign: 'Search · salon near me', budget: 12000, clicks: 780, conversions: 46, cpc: 15, cpa: 261, roas: 4.2 },
      { campaign: 'PMax · local beauty offers', budget: 18000, clicks: 1320, conversions: 72, cpc: 14, cpa: 250, roas: 5.1 },
      { campaign: 'Remarketing · booking intent', budget: 6000, clicks: 410, conversions: 28, cpc: 15, cpa: 214, roas: 6.3 }
    ];
  }

  metaAdsRows(audit: ApiRecord): ApiRecord[] {
    const existing = audit.workspace?.metaAds || audit.workspace?.ads?.meta || audit.plan?.advancedGrowthSystem?.adsCommandCenter?.metaAds;
    if (Array.isArray(existing) && existing.length) return existing;
    return [
      { campaign: 'Instagram Reel · hair spa proof', platform: 'Instagram', reach: 9800, leads: 24, messages: 42, spend: 3500, ctr: 1.9 },
      { campaign: 'Facebook Lead · bridal inquiry', platform: 'Facebook', reach: 7200, leads: 31, messages: 18, spend: 5200, ctr: 2.3 },
      { campaign: 'WhatsApp Click · facial offer', platform: 'Instagram + Facebook', reach: 11800, leads: 38, messages: 63, spend: 6400, ctr: 2.7 }
    ];
  }

  pmaxChannels(): string[] {
    return ['Search', 'YouTube', 'Display', 'Discover', 'Gmail', 'Maps'];
  }

  adRecommendations(audit: ApiRecord): ApiRecord[] {
    const existing = audit.workspace?.adRecommendations || audit.plan?.advancedGrowthSystem?.adsCommandCenter?.recommendations;
    if (Array.isArray(existing) && existing.length) return existing;
    return [
      { title: 'Increase exact-match local keywords', reason: 'High-intent Google queries are converting below available impression share.', impact: 'high', priority: 'P1' },
      { title: 'Pause low-CTR creative set', reason: 'Meta creative fatigue detected; CTR is below target while spend is rising.', impact: 'medium', priority: 'P2' },
      { title: 'Add WhatsApp conversion event', reason: 'Lead quality cannot be optimized until WhatsApp replies are tracked.', impact: 'high', priority: 'P1' },
      { title: 'Refresh PMax image and video assets', reason: 'Poor assets reduce delivery across YouTube, Display and Discover.', impact: 'medium', priority: 'P2' }
    ];
  }

  campaignHealth(audit: ApiRecord): ApiRecord[] {
    return [
      { label: 'Budget waste', detail: 'No campaign is allowed to scale if CPA rises 25% above target.', status: 'watch' },
      { label: 'Low CTR', detail: 'Meta CTR below 1.2% should trigger creative replacement.', status: this.adsCommandSummary(audit).metaCtr >= 1.2 ? 'ok' : 'warn' },
      { label: 'High CPA', detail: 'Google CPA monitored against booking gross margin.', status: 'ok' },
      { label: 'Conversion tracking', detail: 'Track call, WhatsApp, booking and invoice-paid events.', status: 'watch' },
      { label: 'Poor assets', detail: 'Assets below 70 score stay in draft until improved.', status: 'watch' }
    ];
  }

  creativeAssets(audit: ApiRecord): ApiRecord[] {
    const existing = audit.workspace?.creativeAssets || audit.plan?.advancedGrowthSystem?.adsCommandCenter?.creativeAssets;
    if (Array.isArray(existing) && existing.length) return existing;
    return [
      { name: 'Hair spa before-after reel', type: 'Video', spec: '9:16 · Reel/Story', approval: 'client_review', score: 86 },
      { name: 'Bridal makeup proof carousel', type: 'Image', spec: '1:1 · Instagram/Facebook', approval: 'approved', score: 91 },
      { name: 'Google Business offer post', type: 'Image', spec: '4:3 · GBP', approval: 'draft', score: 74 },
      { name: 'YouTube thumbnail', type: 'Image', spec: '16:9 · YouTube', approval: 'needs_fix', score: 62 }
    ];
  }

  leadAttribution(audit: ApiRecord): ApiRecord[] {
    const googleConversions = this.adsCommandSummary(audit).googleConversions;
    const metaLeads = this.adsCommandSummary(audit).metaLeads;
    const whatsapp = Number(audit.workspace?.attribution?.whatsapp || metaLeads + 18);
    const bookings = Number(audit.workspace?.attribution?.bookings || Math.round((googleConversions + metaLeads) * 0.36));
    const invoices = Number(audit.workspace?.attribution?.invoices || Math.round(bookings * 0.62));
    return [
      { label: 'Google Ads', value: googleConversions, rate: 'search + PMax conversions' },
      { label: 'WhatsApp', value: whatsapp, rate: 'message leads' },
      { label: 'Bookings', value: bookings, rate: 'confirmed appointments' },
      { label: 'Invoice', value: invoices, rate: 'paid customers' }
    ];
  }

  budgetOptimizer(audit: ApiRecord): ApiRecord[] {
    const existing = audit.workspace?.budgetRecommendations || audit.plan?.advancedGrowthSystem?.adsCommandCenter?.budgetOptimizer;
    if (Array.isArray(existing) && existing.length) return existing;
    return [
      { action: 'Move ₹500/day from low ROI campaign to high ROI campaign', reason: 'Search + PMax ROAS is stronger than fatigued Meta creative set.', expected: '+8-12% qualified leads' },
      { action: 'Cap remarketing until frequency normalizes', reason: 'Repeated impressions can waste spend without new bookings.', expected: 'lower CPA risk' },
      { action: 'Reserve 15% budget for creative testing', reason: 'Fresh reels and proof assets improve Meta CTR.', expected: '+0.3-0.6% CTR lift' }
    ];
  }

  competitorAdsWatch(audit: ApiRecord): ApiRecord[] {
    const existing = audit.workspace?.competitorAdSignals || audit.workspace?.competitorAlerts;
    if (Array.isArray(existing) && existing.length) {
      return existing.slice(0, 5).map((item: ApiRecord) => ({
        competitor: item.competitorName || item.competitor || 'Competitor',
        signal: item.signal || item.signalType || 'Offer/creative signal detected',
        counter: item.recommendedAction || item.counter || 'Launch proof-based counter creative'
      }));
    }
    return [
      { competitor: 'Andheri Beauty Studio', signal: 'New 30% hair spa offer running on Instagram', counter: 'Counter with proof reel + limited slot WhatsApp CTA' },
      { competitor: 'Glow Hair Lounge', signal: 'Ranking on bridal makeup near me keyword', counter: 'Add bridal landing page + Google Search exact keyword' },
      { competitor: 'Urban Salon Hub', signal: 'Aggressive price creative detected', counter: 'Use trust, reviews and hygiene proof instead of price war' }
    ];
  }

  whatsappIntegration(audit: ApiRecord): ApiRecord[] {
    return [
      { label: 'Cloud API status', value: audit.workspace?.whatsapp?.status || 'ready_for_provider_connection' },
      { label: 'Template policy', value: 'approved templates only for outbound campaigns' },
      { label: 'Lead handoff', value: 'ad click → WhatsApp reply → booking owner task' },
      { label: 'Opt-in guard', value: 'no broadcast without customer opt-in' }
    ];
  }

  approvalWorkflow(): string[] {
    return ['Draft', 'Client review', 'Approved', 'Scheduled', 'Published'];
  }

  tenantAccounts(audit: ApiRecord): ApiRecord[] {
    const existing = audit.workspace?.tenantAccounts || audit.plan?.advancedGrowthSystem?.adsCommandCenter?.tenants;
    if (Array.isArray(existing) && existing.length) return existing;
    return [
      { client: audit.businessName || 'AuraShine Salon', account: 'Google Ads · pending link', role: 'agency_manager', spendLimit: 50000, status: 'approval_required' },
      { client: audit.businessName || 'AuraShine Salon', account: 'Meta Business · pending link', role: 'advertiser', spendLimit: 40000, status: 'approval_required' }
    ];
  }

  riskGuardrails(audit: ApiRecord): ApiRecord[] {
    const spendLimit = Number(audit.workspace?.client?.spendLimit || audit.plan?.spendLimit || 50000);
    return [
      { rule: 'No auto-publish', detail: 'Every ad, post, WhatsApp template and SEO page needs approval before publishing.', status: 'safe' },
      { rule: 'Spend limit block', detail: `Monthly spend cannot exceed ₹${spendLimit} without owner approval.`, status: 'safe' },
      { rule: 'Conversion tracking required', detail: 'Campaign scale is blocked if call, WhatsApp, booking or invoice tracking is missing.', status: 'watch' },
      { rule: 'Client permission boundary', detail: 'Agency users can only access assigned tenant accounts and approved assets.', status: 'safe' },
      { rule: 'Claim safety', detail: 'AI copy cannot promise guaranteed ranking, leads, medical results or unrealistic discounts.', status: 'safe' }
    ];
  }

  generateAdCopy(audit: ApiRecord): void {
    const value = this.adCopyForm.value;
    const businessName = audit.businessName || 'your business';
    const offer = value.offer || 'limited-time offer';
    const audience = value.audience || 'local customers';
    const platform = value.platform || 'Google Ads';
    const tone = value.tone || 'Premium';
    this.generatedAdCopy.set({
      headline: `${businessName}: ${offer}`.slice(0, 60),
      description: `${tone} ${platform} copy for ${audience}: book now, see real proof, and chat on WhatsApp before slots fill.`,
      caption: `✨ ${offer} for ${audience}. Tap to WhatsApp, check availability, and confirm your booking today.`
    });
    this.showToast('success', 'AI ad copy draft generated. Review before publishing.');
  }

  // ============ ENTERPRISE AI GROWTH OS LOCAL METHODS ============

  autonomousAgentPlan(audit: ApiRecord): ApiRecord {
    const backendPolicy = audit.enterpriseOs?.campaignApprovalPolicy || audit.campaignApprovalPolicy;
    if (backendPolicy?.steps?.length) return backendPolicy;
    const score = Number(this.adsCommandSummary(audit).healthScore || 0);
    const pendingApprovals = Number(audit.workspace?.approvals?.filter?.((item: ApiRecord) => !['approved', 'rejected'].includes(item.status))?.length || 0)
      + Number(audit.workspace?.publishingPlanner?.filter?.((item: ApiRecord) => item.approvalStatus !== 'approved')?.length || 0);
    const liveRevenue = Number(audit.enterpriseOs?.dataSync?.invoiceRevenue || audit.workspace?.realData?.invoiceRevenue || 0);
    const maxAutoBudget = Math.max(1000, Math.round(liveRevenue * 0.03));
    return {
      approvalRequired: true,
      maxAutoBudget,
      pendingApprovals,
      policy: 'AI can recommend and draft changes, but cannot publish ads, change budgets or message customers without owner/client approval.',
      steps: [
        { title: 'Budget move', detail: score >= 80 && liveRevenue ? `Shift spend toward PMax and high-intent Search, capped at ₹${maxAutoBudget} until owner approval.` : 'Hold scale until tracking and creative quality improve.', status: 'approval_required' },
        { title: 'Keyword expansion', detail: 'Add exact local intent keywords plus negative keywords for low-quality traffic.', status: pendingApprovals ? 'client_review' : 'draft_ready' },
        { title: 'Creative refresh', detail: 'Generate 3 proof creatives and 2 offer creatives for Meta testing.', status: pendingApprovals ? 'approval_required' : 'client_review' },
        { title: 'Bid strategy', detail: 'Use conversion-focused bidding only after WhatsApp, booking and invoice events are connected.', status: liveRevenue ? 'guardrail_active' : 'tracking_required' }
      ]
    };
  }

  anomalyDetection(audit: ApiRecord): ApiRecord[] {
    const summary = this.adsCommandSummary(audit);
    return [
      { metric: 'Spend spike', detail: 'Daily spend variance above 25% should require manager review before scale.', severity: Number(summary.googleSpend || 0) > 40000 ? 'high' : 'normal' },
      { metric: 'CPC jump', detail: 'Average CPC is monitored against last 7-day baseline.', severity: 'watch' },
      { metric: 'Lead drop', detail: 'Meta leads are compared with same weekday average.', severity: Number(summary.metaLeads || 0) < 40 ? 'medium' : 'normal' },
      { metric: 'Conversion tracking', detail: 'Broken call, WhatsApp, booking or invoice events block auto-optimization.', severity: 'medium' }
    ];
  }

  forecastSimulator(): ApiRecord[] {
    const budget = Number(this.forecastBudget.value || 0);
    const cpa = Math.max(1, Number(this.forecastCpa.value || 1));
    const bookingRate = Math.max(0, Number(this.forecastBookingRate.value || 0)) / 100;
    const invoice = Number(this.forecastAverageInvoice.value || 0);
    const leads = Math.round(budget / cpa);
    const bookings = Math.round(leads * bookingRate);
    const revenue = bookings * invoice;
    const roas = budget ? Math.round((revenue / budget) * 10) / 10 : 0;
    return [
      { label: 'Leads', value: leads, note: `₹${cpa} CPA` },
      { label: 'Bookings', value: bookings, note: `${Math.round(bookingRate * 100)}% booking rate` },
      { label: 'Revenue', value: `₹${revenue}`, note: `₹${invoice} avg invoice` },
      { label: 'ROAS', value: `${roas}x`, note: 'simulated estimate' }
    ];
  }

  customerJourneyMap(audit: ApiRecord): ApiRecord[] {
    return [
      { stage: 'Ad click', owner: 'Google/Meta campaign', kpi: `${this.googleAdsRows(audit).reduce((sum, row) => sum + Number(row.clicks || 0), 0)} clicks tracked` },
      { stage: 'WhatsApp lead', owner: 'front desk / automation', kpi: `${this.leadAttribution(audit)[1]?.value || 0} conversations` },
      { stage: 'Appointment', owner: 'booking team', kpi: `${this.leadAttribution(audit)[2]?.value || 0} bookings` },
      { stage: 'Invoice', owner: 'POS / billing', kpi: `${this.leadAttribution(audit)[3]?.value || 0} paid invoices` },
      { stage: 'Repeat visit', owner: 'CRM / membership', kpi: 'retention campaign required' }
    ];
  }

  ltvCacDashboard(audit: ApiRecord): ApiRecord {
    const totalSpend = Number(this.adsCommandSummary(audit).googleSpend || 0) + Number(this.adsCommandSummary(audit).metaSpend || 0);
    const invoices = Math.max(1, Number(this.leadAttribution(audit)[3]?.value || 1));
    const cac = Math.round(totalSpend / invoices);
    const avgInvoice = Number(this.forecastAverageInvoice.value || 4000);
    const ltv = Math.round(avgInvoice * 2.4);
    const ratio = cac ? Math.round((ltv / cac) * 10) / 10 : 0;
    return { cac, ltv, ratio, label: ratio >= 3 ? 'healthy scale' : ratio >= 1.5 ? 'optimize retention' : 'acquisition too costly' };
  }

  audienceIntelligence(audit: ApiRecord): ApiRecord[] {
    const city = audit.city || audit.market || 'local area';
    return [
      { segment: `${city} high-intent searchers`, insight: 'Search users convert better near service keywords.', action: 'Increase exact-match local budget.', priority: 'high' },
      { segment: 'Women 18-45', insight: 'Beauty service creatives need proof, reviews and offer clarity.', action: 'Run reel + carousel A/B test.', priority: 'high' },
      { segment: 'Repeat customers', insight: 'Lower CAC via membership and WhatsApp reminders.', action: 'Launch retention audience.', priority: 'medium' },
      { segment: 'Bridal intent', insight: 'Higher ticket but needs trust-first funnel.', action: 'Use consultation CTA and portfolio proof.', priority: 'medium' }
    ];
  }

  creativeFatigueDetector(audit: ApiRecord): ApiRecord[] {
    return this.creativeAssets(audit).map((asset: ApiRecord, index: number) => {
      const score = Number(asset.score || 0);
      const fatigued = score < 70 || index === 0;
      return { asset: asset.name, signal: fatigued ? 'Frequency rising or score below scale threshold; refresh hook/thumbnail/offer.' : 'Asset score healthy for controlled testing.', status: fatigued ? 'fatigue_watch' : 'healthy' };
    });
  }

  abTestingLab(audit: ApiRecord): ApiRecord[] {
    return [
      { name: 'Headline test', variantA: 'Best salon near me', variantB: 'Hair spa with proof results', winnerRule: 'higher booking CPA after 500 clicks', status: 'draft' },
      { name: 'Creative test', variantA: 'before-after reel', variantB: 'client review carousel', winnerRule: 'CTR + WhatsApp replies', status: 'client_review' },
      { name: 'Audience test', variantA: 'local broad', variantB: 'service interest + remarketing', winnerRule: 'lower CAC', status: 'scheduled_after_approval' },
      { name: 'Offer test', variantA: 'consultation free', variantB: 'limited slot discount', winnerRule: 'invoice revenue not just leads', status: 'draft' }
    ];
  }

  autoReportInsights(audit: ApiRecord): string[] {
    const summary = this.adsCommandSummary(audit);
    const ltv = this.ltvCacDashboard(audit);
    return [
      `Google + Meta spend is ₹${Number(summary.googleSpend || 0) + Number(summary.metaSpend || 0)} with Google ROAS ${summary.googleRoas}x and Meta CTR ${summary.metaCtr}%.`,
      `LTV:CAC is ${ltv.ratio}x, so ${ltv.label}.`,
      'Bookings can improve if WhatsApp response SLA stays under 5 minutes and invoice attribution is connected.',
      'Next report should separate vanity leads from paid invoices so the owner sees real profit, not only clicks.'
    ];
  }

  permissionPreview(): ApiRecord[] {
    return [
      { role: 'Owner', view: 'all clients, spend, revenue', approve: 'ads, budget, reports', spend: 'increase limits' },
      { role: 'Manager', view: 'assigned branches', approve: 'content and replies', spend: 'request only' },
      { role: 'Agency', view: 'assigned ad accounts', approve: 'draft submit', spend: 'within approved cap' },
      { role: 'Client', view: 'portal report and approvals', approve: 'own assets only', spend: 'approve/reject' }
    ];
  }

  auditLogRows(audit: ApiRecord): ApiRecord[] {
    const existing = audit.workspace?.auditLog || audit.workspace?.growthAuditLog;
    if (Array.isArray(existing) && existing.length) return existing;
    return [
      { time: 'Today 09:10', user: 'AI Agent', action: 'Generated budget recommendation', result: 'approval_required' },
      { time: 'Today 09:18', user: 'Manager', action: 'Reviewed creative asset score', result: 'needs_fix' },
      { time: 'Today 10:02', user: 'Owner', action: 'Opened white-label report', result: 'viewed' },
      { time: 'Today 10:20', user: 'System', action: 'Checked spend guardrail', result: 'safe' }
    ];
  }

  slaLeadAlerts(audit: ApiRecord): ApiRecord[] {
    return [
      { lead: 'WhatsApp lead · hair spa', detail: 'Reply due within 5 minutes; route to front desk.', status: 'on_time' },
      { lead: 'Google call missed', detail: 'Missed call must create callback task within 10 minutes.', status: 'late_watch' },
      { lead: 'Bridal inquiry', detail: 'High-ticket lead should be assigned to senior consultant.', status: 'priority' }
    ];
  }

  revenueAttribution(audit: ApiRecord): ApiRecord[] {
    return this.googleAdsRows(audit).map((row: ApiRecord, index: number) => {
      const bookings = Math.max(1, Math.round(Number(row.conversions || 0) * 0.45));
      const invoices = Math.max(1, Math.round(bookings * 0.65));
      const revenue = invoices * Number(this.forecastAverageInvoice.value || 4000);
      return { campaign: row.campaign, bookings, invoices, revenue, roas: row.roas || (index + 3) };
    });
  }

  smartRecommendationPriority(audit: ApiRecord): ApiRecord[] {
    return [
      { priority: 'High', title: 'Fix conversion tracking before scale', why: 'Without invoice attribution, campaigns optimize for leads not revenue.', impact: 'high', effort: 'medium' },
      { priority: 'High', title: 'Refresh fatigued Meta creative', why: 'CTR and frequency risks can waste budget fast.', impact: 'high', effort: 'low' },
      { priority: 'Medium', title: 'Launch A/B offer test', why: 'Proof-based offer may beat discount-only positioning.', impact: 'medium', effort: 'low' },
      { priority: 'Low', title: 'Polish report branding', why: 'Improves client trust but does not directly reduce CPA.', impact: 'low', effort: 'low' }
    ];
  }

  executiveCommandCenter(audit: ApiRecord): ApiRecord {
    const googleRows = this.googleAdsRows(audit);
    const best = [...googleRows].sort((a, b) => Number(b.roas || 0) - Number(a.roas || 0))[0];
    const worst = [...googleRows].sort((a, b) => Number(a.roas || 0) - Number(b.roas || 0))[0];
    const revenue = this.revenueAttribution(audit).reduce((sum, row) => sum + Number(row.revenue || 0), 0);
    const spend = Number(this.adsCommandSummary(audit).googleSpend || 0) + Number(this.adsCommandSummary(audit).metaSpend || 0);
    const profit = Math.max(0, revenue - spend);
    const wasteRisk = this.anomalyDetection(audit).filter((item) => item.severity !== 'normal').length;
    return {
      profit,
      profitLabel: profit > spend ? 'profitable growth' : 'needs margin review',
      wasteRisk,
      wasteLabel: wasteRisk ? `${wasteRisk} items need review` : 'no major anomaly',
      bestCampaign: best?.campaign || 'PMax local campaign',
      worstCampaign: worst?.campaign || 'low ROI campaign',
      nextAction: wasteRisk ? 'Review' : 'Scale',
      nextActionDetail: wasteRisk ? 'Fix tracking/creative issues before increasing spend.' : 'Increase budget slowly with approval and invoice attribution.',
      decision: 'Approve only after guardrails, SLA and attribution checks pass.'
    };
  }


  // ============ AuraShine Enterprise OS Tier 1-8 local logic ============

  businessHealthScore(audit: ApiRecord): ApiRecord {
    const revenue = this.revenueAttribution(audit).reduce((sum, row) => sum + Number(row.revenue || 0), 0) || 128000;
    const spend = Number(this.adsCommandSummary(audit).googleSpend || 0) + Number(this.adsCommandSummary(audit).metaSpend || 0) || 18500;
    const profit = Math.max(0, revenue - spend - 42000);
    const marketingRoi = Number((revenue / Math.max(1, spend)).toFixed(1));
    const staffProductivity = 84;
    const retention = 71;
    const score = Math.min(100, Math.round((marketingRoi * 8) + (staffProductivity * .28) + (retention * .26) + (profit > 50000 ? 18 : 10)));
    return { score, label: score >= 80 ? 'healthy scale-ready' : score >= 65 ? 'stable but needs action' : 'risk needs owner review', revenue, profit, staffProductivity, retention, marketingRoi };
  }

  dailyAiBriefing(audit: ApiRecord): ApiRecord {
    return {
      today: 'Google + Meta leads active, content planner has approved drafts, and invoice attribution is improving.',
      bad: 'Missed call and creative fatigue can reduce bookings if not handled today.',
      action: 'Refresh Meta creative, call back high-ticket leads, and approve only campaigns with tracking enabled.'
    };
  }

  predictiveRevenue(audit: ApiRecord): ApiRecord[] {
    const base = Math.max(25000, Number(this.businessHealthScore(audit).revenue || 0));
    return [
      { period: 'Next 7 days', revenue: Math.round(base * 0.28), confidence: 'high' },
      { period: 'Next 30 days', revenue: Math.round(base * 1.12), confidence: 'medium' },
      { period: 'Next 90 days', revenue: Math.round(base * 3.25), confidence: 'medium-low' }
    ];
  }

  cashFlowForecast(audit: ApiRecord): ApiRecord[] {
    return [
      { category: 'Salary', amount: 65000, risk: 'fixed monthly' },
      { category: 'Rent', amount: 45000, risk: 'fixed monthly' },
      { category: 'Inventory', amount: 28000, risk: 'watch stock turns' },
      { category: 'Marketing spend', amount: Number(this.adsCommandSummary(audit).googleSpend || 0) + Number(this.adsCommandSummary(audit).metaSpend || 0) || 18500, risk: 'approval required before scale' }
    ];
  }

  aiWorkforceManagers(audit: ApiRecord): ApiRecord[] {
    return [
      { role: 'AI Marketing Manager', focus: 'campaign + content suggestions', recommendation: 'Launch proof-based hair spa reel + PMax local asset group.', action: 'Create content and campaign brief' },
      { role: 'AI Sales Manager', focus: 'lead follow-up + proposal reminders', recommendation: 'Prioritize bridal and WhatsApp leads within 5 minutes.', action: 'Create follow-up queue' },
      { role: 'AI Operations Manager', focus: 'staff issues detection', recommendation: 'Match peak hours with senior stylist availability.', action: 'Flag roster mismatch' },
      { role: 'AI Finance Manager', focus: 'profit leak detection', recommendation: 'Stop low-ROAS campaign until tracking is fixed.', action: 'Protect margin' },
      { role: 'AI HR Manager', focus: 'attendance + late arrivals + performance', recommendation: 'Review late arrival pattern and top performer incentives.', action: 'Create HR note' }
    ];
  }

  customer360Profiles(audit: ApiRecord): ApiRecord[] {
    return [
      { name: 'Priya S.', visits: 9, services: 'Hair spa, facial', spend: 42000, membership: 'Gold', reviews: '5★ Google' },
      { name: 'Neha K.', visits: 4, services: 'Bridal makeup', spend: 58000, membership: 'None', reviews: 'pending' },
      { name: 'Ayesha R.', visits: 2, services: 'Haircut', spend: 6200, membership: 'Trial', reviews: 'Facebook 4★' }
    ];
  }

  churnPredictions(audit: ApiRecord): ApiRecord[] {
    return [
      { customer: 'Ayesha R.', reason: 'No visit in 52 days after trial package.', risk: 'high' },
      { customer: 'Neha K.', reason: 'High-ticket bridal lead needs post-service retention offer.', risk: 'medium' },
      { customer: 'Priya S.', reason: 'Gold member with recent repeat visit.', risk: 'low' }
    ];
  }

  upsellEngine(audit: ApiRecord): ApiRecord[] {
    return [
      { customer: 'Priya S.', offer: 'Facial + scalp treatment bundle', reason: 'Hair spa customer with premium spend pattern' },
      { customer: 'Ayesha R.', offer: 'Hair spa intro offer', reason: 'Haircut-only customer ready for next service' },
      { customer: 'Neha K.', offer: 'Pre-bridal skin package', reason: 'Bridal service interest' }
    ];
  }

  vipCustomers(audit: ApiRecord): ApiRecord[] {
    return this.customer360Profiles(audit).filter((c) => Number(c.spend || 0) >= 40000).map((c) => ({ ...c, tag: 'VIP retention priority' }));
  }

  birthdayAnniversaryAutomation(audit: ApiRecord): ApiRecord[] {
    return [
      { customer: 'Priya S.', event: 'Birthday in 6 days', message: 'Send WhatsApp VIP pamper voucher' },
      { customer: 'Neha K.', event: 'Anniversary in 14 days', message: 'Send bridal glow package reminder' }
    ];
  }

  branchDashboard(audit: ApiRecord): ApiRecord[] {
    return [
      { branch: 'Andheri West', revenue: 420000, profit: 128000, rating: 4.7, rank: 1 },
      { branch: 'Bandra', revenue: 365000, profit: 99000, rating: 4.5, rank: 2 },
      { branch: 'Powai', revenue: 285000, profit: 61000, rating: 4.2, rank: 3 }
    ];
  }

  branchComparison(audit: ApiRecord): ApiRecord[] {
    return [
      { metric: 'Best branch', detail: 'Andheri West leads in revenue, profit and rating.', status: 'healthy' },
      { metric: 'Weak branch', detail: 'Powai has lower retention and needs local SEO boost.', status: 'watch' },
      { metric: 'Regional manager action', detail: 'Move winning offer playbook from Andheri to Powai.', status: 'action_required' }
    ];
  }

  franchiseRoyaltyTracking(audit: ApiRecord): ApiRecord[] {
    return this.branchDashboard(audit).map((b) => ({ branch: b.branch, royaltyPercent: 6, due: Math.round(Number(b.revenue || 0) * 0.06), status: b.rank === 3 ? 'review' : 'clear' }));
  }

  reviewHub(audit: ApiRecord): ApiRecord[] {
    return [
      { source: 'Google Reviews', rating: '5★', review: 'Great hair spa experience', status: 'reply ready' },
      { source: 'Google Reviews', rating: '2★', review: 'Waiting time was high', status: 'negative alert' },
      { source: 'Facebook Reviews', rating: '4★', review: 'Good bridal makeup', status: 'reply ready' }
    ];
  }

  reviewReplyAi(audit: ApiRecord): ApiRecord[] {
    return this.reviewHub(audit).map((r) => ({ customer: r.source, reply: r.rating === '2★' ? 'Apologize, request details, offer priority callback.' : 'Thank customer and mention relevant service keyword.', alert: r.rating === '2★' }));
  }

  localSeoHeatmap(audit: ApiRecord): ApiRecord[] {
    return [
      { area: 'Andheri West', rank: 3, gap: 'close to top 3', action: 'Add review + GBP post' },
      { area: 'Bandra', rank: 8, gap: 'competitor has more photos', action: 'Upload proof images' },
      { area: 'Powai', rank: 14, gap: 'weak local page', action: 'Create city/service landing page' }
    ];
  }

  enterpriseRoles(): ApiRecord[] {
    return [
      { role: 'Owner', access: 'all dashboards, exports, approvals', restriction: 'none' },
      { role: 'Manager', access: 'branch ops, staff, bookings', restriction: 'cannot change spend limit' },
      { role: 'Staff', access: 'assigned tasks and appointments', restriction: 'no financial export' },
      { role: 'Agency', access: 'ads, reports, content approvals', restriction: 'cannot view payroll' },
      { role: 'Client', access: 'portal reports and approvals', restriction: 'read-only business data' }
    ];
  }

  enterpriseAuditTrail(audit: ApiRecord): ApiRecord[] {
    return [
      { time: 'Today 10:12', actor: 'Owner', action: 'Approved report export' },
      { time: 'Today 11:05', actor: 'AI Marketing Manager', action: 'Suggested campaign budget shift' },
      { time: 'Today 11:22', actor: 'Manager', action: 'Reviewed negative review alert' }
    ];
  }

  sensitiveApprovals(audit: ApiRecord): ApiRecord[] {
    return [
      { action: 'Increase daily ad budget', reason: 'Spend limit impact', status: 'pending_owner_approval' },
      { action: 'Export customer data', reason: 'PII-sensitive export', status: 'pending_owner_approval' },
      { action: 'Publish approved content', reason: 'Client approved draft', status: 'approved' }
    ];
  }

  workflowBuilderSteps(): ApiRecord[] {
    return [
      { step: 'New lead', action: 'Capture source and service interest', owner: 'System' },
      { step: 'WhatsApp message', action: 'Send personalized reply', owner: 'AI Sales Manager' },
      { step: 'Reminder after 1 day', action: 'Follow up if no booking', owner: 'Automation' },
      { step: 'Book appointment', action: 'Create booking slot', owner: 'Front desk' },
      { step: 'Generate invoice', action: 'Link revenue to campaign', owner: 'Finance' }
    ];
  }

  automationRules(audit: ApiRecord): ApiRecord[] {
    return [
      { trigger: 'New WhatsApp lead', schedule: 'immediate', approval: 'not required', status: 'active' },
      { trigger: 'No reply after 24h', schedule: 'daily 10 AM', approval: 'not required', status: 'active' },
      { trigger: 'Budget increase', schedule: 'manual', approval: 'owner required', status: 'guarded' },
      { trigger: 'Negative review', schedule: 'immediate', approval: 'manager review', status: 'active' }
    ];
  }

  naturalLanguageReports(audit: ApiRecord): string[] {
    return [
      'Last month profit dropped mainly because spend increased faster than confirmed invoice revenue.',
      'Most profitable campaign is the one with highest invoice-linked ROAS, not just lowest CPL.',
      'Best staff performance should combine attendance, rebooking rate and review mentions.',
      'Decision assistant recommends fixing tracking and lead response SLA before scaling budget.'
    ];
  }

  askBusinessCommand(audit: ApiRecord): void {
    const q = String(this.businessCommandQuestion.value || '').trim().toLowerCase();
    let answer = 'Business health is stable, but growth depends on attribution, SLA response and repeat customers.';
    if (q.includes('profit')) answer = 'Profit likely dropped because marketing spend and missed lead response increased while invoice-linked bookings did not grow at the same rate.';
    if (q.includes('campaign')) answer = `Best campaign appears to be ${this.executiveCommandCenter(audit).bestCampaign}; validate with invoice revenue before scaling.`;
    if (q.includes('staff')) answer = 'Best staff should be ranked by attendance, completed bookings, rebooking rate, upsell revenue and customer review mentions.';
    this.businessCommandAnswer.set({ title: 'Business Copilot Answer', answer, decision: 'Recommended decision: approve only safe actions; budget/staff/customer-sensitive changes need owner approval.' });
  }

  exportEnterpriseSnapshot(audit: ApiRecord): void {
    const snapshot = {
      audit: audit.businessName,
      businessHealth: this.businessHealthScore(audit),
      dailyBriefing: this.dailyAiBriefing(audit),
      predictiveRevenue: this.predictiveRevenue(audit),
      cashFlow: this.cashFlowForecast(audit),
      aiWorkforce: this.aiWorkforceManagers(audit),
      customerIntelligence: this.customer360Profiles(audit),
      franchise: this.branchDashboard(audit),
      security: this.enterpriseRoles(),
      automations: this.automationRules(audit)
    };
    navigator.clipboard?.writeText(JSON.stringify(snapshot, null, 2));
    this.actionMessage.set('Enterprise snapshot copied');
  }

  portalMarketingScore(audit: ApiRecord): number {
    return Math.max(0, Math.min(100, Number(audit.plan?.rankReadinessScore || audit.score || 0)));
  }

  profileLinkChecks(audit: ApiRecord): ApiRecord[] {
    return [
      this.profileLinkCheck('Google Business Profile', audit.googleProfileUrl, ['google.', 'maps.google.', 'maps.app.goo.gl', 'g.page', 'share.google']),
      this.profileLinkCheck('Instagram', audit.instagramUrl, ['instagram.com']),
      this.profileLinkCheck('Facebook', audit.facebookUrl, ['facebook.com', 'fb.com'])
    ];
  }

  profileLinkCheck(label: string, value: unknown, domains: string[]): ApiRecord {
    const url = String(value || '').trim();
    if (!url) return { label, ok: false, message: 'Link missing hai.' };
    const lower = url.toLowerCase();
    const domainOk = /^https?:\/\//i.test(url) && domains.some((domain) => lower.includes(domain));
    return {
      label,
      ok: domainOk,
      message: domainOk ? url : `Wrong platform link: ${url}`
    };
  }

  dhandaPerformanceCards(audit: ApiRecord): ApiRecord[] {
    const integrations = Array.isArray(audit.workspace?.integrations) ? audit.workspace.integrations : [];
    const providers = integrations.flatMap((row: ApiRecord) => Array.isArray(row.providers) ? row.providers : [row]);
    const google = providers.find((item: ApiRecord) => String(item.provider || item.name || '').toLowerCase().includes('google'))?.metrics || {};
    const meta = providers.find((item: ApiRecord) => /meta|instagram|facebook/i.test(String(item.provider || item.name || '')))?.metrics || {};
    const campaigns = Array.isArray(audit.workspace?.campaignProfit) ? audit.workspace.campaignProfit : [];
    const reviewSummary = this.dhandaReviewSummary(audit);
    return [
      { label: 'Views', value: Number(google.views || google.profileViews || meta.reach || 0), note: integrations.length ? 'synced from integrations' : 'sync KPI first' },
      { label: 'Reviews', value: reviewSummary.count, note: reviewSummary.count ? 'from review engine' : 'review data pending' },
      { label: 'Leads', value: Number(meta.messages || meta.leads || campaigns.reduce((sum: number, item: ApiRecord) => sum + Number(item.leads || 0), 0)), note: campaigns.length ? 'from campaign ROI rows' : 'lead sync pending' },
      { label: 'Calls', value: Number(google.calls || 0), note: google.calls ? 'from Google metrics' : 'call sync pending' },
      { label: 'Directions', value: Number(google.directions || google.directionRequests || 0), note: google.directions || google.directionRequests ? 'from Google metrics' : 'direction sync pending' }
    ];
  }

  dhandaCompetitors(audit: ApiRecord): ApiRecord[] {
    const alerts = Array.isArray(audit.workspace?.competitorAlerts) ? audit.workspace.competitorAlerts : [];
    const signals = Array.isArray(audit.workspace?.competitorSignals) ? audit.workspace.competitorSignals : [];
    const names = this.csvList(audit.competitors || audit.plan?.competitors || []);
    if (alerts.length) {
      return alerts.slice(0, 8).map((alert: ApiRecord) => ({
        name: alert.competitorName,
        rating: alert.payload?.rating || alert.rating || 'Not synced',
        status: alert.status || alert.signalType || 'open',
        action: alert.recommendedAction
      }));
    }
    if (signals.length) {
      return signals.slice(0, 8).map((signal: ApiRecord) => ({
        name: signal.competitorName || signal.businessName,
        rating: signal.rating || signal.payload?.rating || 'Not synced',
        status: signal.signalType || 'tracked',
        action: signal.recommendedAction || signal.payload?.recommendedAction
      }));
    }
    return names.slice(0, 8).map((name) => ({ name, rating: 'Not synced', status: 'watch setup pending' }));
  }

  dhandaKeywords(audit: ApiRecord): ApiRecord[] {
    const rows = Array.isArray(audit.workspace?.rankKeywords) ? audit.workspace.rankKeywords : [];
    const snapshots = Array.isArray(audit.workspace?.rankSnapshots) ? audit.workspace.rankSnapshots : [];
    const fallback = this.csvList(audit.rankKeywords || audit.plan?.rankKeywords || []);
    const source = rows.length ? rows : fallback.map((keyword) => ({ keyword }));
    return source.slice(0, 12).map((row: ApiRecord, index: number) => ({
      search: Number(row.searchVolume || row.search || row.payload?.searchVolume || 0),
      keyword: row.keyword || row.name || fallback[index] || 'Keyword pending',
      rank: Number(row.rankPosition || row.currentRank || snapshots.find((snap: ApiRecord) => snap.keyword === row.keyword)?.rankPosition || 0)
    }));
  }

  dhandaSocialTasks(audit: ApiRecord): ApiRecord[] {
    const tasks = Array.isArray(audit.workspace?.tasks) ? audit.workspace.tasks : [];
    const planner = Array.isArray(audit.workspace?.publishingPlanner) ? audit.workspace.publishingPlanner : [];
    const approvals = Array.isArray(audit.workspace?.approvals) ? audit.workspace.approvals : [];
    const reviewStats = this.dhandaCustomerStats(audit);
    return [
      { icon: 'P', title: 'Complete Profile', done: this.profileCompletionCount(audit), target: 6, action: 'Improve profile', color: '#C87D4B' },
      { icon: 'R', title: 'Request Review', done: reviewStats.sent, target: reviewStats.target, action: 'Request reviews', color: '#c855e8' },
      { icon: 'M', title: 'Upload Media', done: planner.filter((item: ApiRecord) => /media|photo|reel|post/i.test(String(item.channel || item.title || ''))).length, target: 5, action: 'Plan media', color: '#f05273' },
      { icon: 'A', title: 'Approve Post', done: approvals.filter((item: ApiRecord) => String(item.status || item.approvalStatus || '').includes('approved')).length, target: Math.max(1, planner.length || tasks.length), action: 'Approve content', color: '#f97316' }
    ];
  }

  dhandaReviewSummary(audit: ApiRecord): ApiRecord {
    const reviews = Array.isArray(audit.workspace?.reviewEngine) ? audit.workspace.reviewEngine : [];
    const count = reviews.length;
    const rating = count ? reviews.reduce((sum: number, item: ApiRecord) => sum + Number(item.rating || 0), 0) / count : Number(audit.rating || 0);
    return {
      rating: rating ? rating.toFixed(1) : 'Not synced',
      count,
      shown: Math.min(50, count),
      pending: reviews.filter((item: ApiRecord) => !/replied|resolved|closed/i.test(String(item.status || ''))).length
    };
  }

  dhandaReviews(audit: ApiRecord): ApiRecord[] {
    const reviews = Array.isArray(audit.workspace?.reviewEngine) ? audit.workspace.reviewEngine : [];
    return reviews.slice(0, 10).map((review: ApiRecord) => ({
      initial: String(review.customerName || review.reviewType || 'R').charAt(0).toUpperCase(),
      name: review.customerName || review.reviewType || 'Review',
      age: review.createdAt ? new Date(review.createdAt).toLocaleDateString() : '',
      text: review.reviewText || review.feedback || review.requestScript || 'Review text pending',
      aiReply: review.aiReply,
      status: review.status
    }));
  }

  dhandaAiReplies(audit: ApiRecord): ApiRecord[] {
    return this.dhandaReviews(audit).map((review) => ({
      name: review.name,
      reply: review.aiReply || 'AI reply draft pending',
      status: review.status || 'pending'
    }));
  }

  dhandaCustomerStats(audit: ApiRecord): ApiRecord {
    const campaigns = Array.isArray(audit.workspace?.campaignProfit) ? audit.workspace.campaignProfit : [];
    const attribution = Array.isArray(audit.workspace?.attributionEvents) ? audit.workspace.attributionEvents : [];
    const leads = campaigns.reduce((sum: number, item: ApiRecord) => sum + Number(item.leads || 0), 0) || attribution.length;
    const bookings = campaigns.reduce((sum: number, item: ApiRecord) => sum + Number(item.bookings || 0), 0);
    return {
      sent: leads,
      target: 15,
      open: bookings,
      reminded: Math.max(0, leads - bookings)
    };
  }

  dhandaCustomers(audit: ApiRecord): ApiRecord[] {
    const leads = Array.isArray(audit.workspace?.leads) ? audit.workspace.leads : [];
    const attribution = Array.isArray(audit.workspace?.attributionEvents) ? audit.workspace.attributionEvents : [];
    return [...leads, ...attribution].slice(0, 10).map((item: ApiRecord) => ({
      initial: String(item.clientName || item.customerName || item.source || 'L').charAt(0).toUpperCase(),
      name: item.clientName || item.customerName || item.source || 'Lead',
      phone: item.phone || item.mobile || item.payload?.phone || 'Phone pending'
    }));
  }

  dhandaPostPlanner(audit: ApiRecord): ApiRecord[] {
    const rows = Array.isArray(audit.workspace?.publishingPlanner) ? audit.workspace.publishingPlanner : [];
    if (rows.length) return rows.slice(0, 5).map((item: ApiRecord) => ({ title: item.title, channel: item.channel, status: item.publishStatus || item.approvalStatus || 'draft' }));
    return [];
  }

  dhandaReportCards(audit: ApiRecord): ApiRecord[] {
    const cards = this.dhandaPerformanceCards(audit);
    const planner = this.dhandaPostPlanner(audit);
    const approvals = Array.isArray(audit.workspace?.approvals) ? audit.workspace.approvals : [];
    return [
      { label: 'Profile Views', value: cards[0].value, delta: this.metricDelta(audit, 'views') },
      { label: 'Leads', value: cards[2].value, delta: this.metricDelta(audit, 'leads') },
      { label: 'Calls', value: cards[3].value, delta: this.metricDelta(audit, 'calls') },
      { label: 'Direction Req.', value: cards[4].value, delta: this.metricDelta(audit, 'directions') },
      { label: 'Media Uploaded', value: planner.length, delta: 0 },
      { label: 'Posts Approved', value: approvals.filter((item: ApiRecord) => String(item.status || item.approvalStatus || '').includes('approved')).length, delta: 0 }
    ];
  }

  dhandaCharts(audit: ApiRecord): ApiRecord[] {
    const business = audit.businessName || 'Client salon';
    const cards = this.dhandaPerformanceCards(audit);
    return [
      { title: 'Growth in Views', points: this.chartPoints(cards[0].value), insight: cards[0].value ? `${business} profile views are now reportable from KPI sync.` : 'Views sync pending. Use Sync KPIs to make this chart live.' },
      { title: 'Growth in Leads', points: this.chartPoints(cards[2].value), insight: cards[2].value ? `${business} lead flow is connected to campaign/attribution rows.` : 'Lead attribution pending. Add campaign ROI or attribution events.' },
      { title: 'Growth in Reviews', points: this.chartPoints(this.dhandaReviewSummary(audit).count), insight: this.dhandaReviewSummary(audit).count ? 'Review reply and request report is active.' : 'Review engine data pending.' }
    ];
  }

  dhandaCalendarPlan(audit: ApiRecord): ApiRecord[] {
    const planner = this.dhandaPostPlanner(audit);
    if (!planner.length) return [];
    return planner.slice(0, 7).map((item: ApiRecord, index: number) => ({
      day: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][index],
      label: item.title || 'Untitled content',
      status: item.status || item.publishStatus || item.approvalStatus || 'draft'
    }));
  }

  dhandaGrowthDone(audit: ApiRecord): number {
    const taskCount = Number(audit.workspace?.tasks?.length || 0);
    const plannerCount = Number(audit.workspace?.publishingPlanner?.length || 0);
    const reviewSent = Number(this.dhandaCustomerStats(audit).sent || 0);
    return Math.min(35, taskCount + plannerCount + Math.min(15, reviewSent));
  }

  growthReportVerdict(audit: ApiRecord): string {
    const score = this.portalMarketingScore(audit);
    if (score >= 80) return 'Strong visibility. Scale content, reviews and conversion tracking.';
    if (score >= 60) return 'Average visibility. Ranking can improve with reviews, posts and keyword pages.';
    return 'Weak visibility. Profile, reviews, media and local keyword coverage need urgent work.';
  }

  growthActionReason(title: unknown): string {
    const text = String(title || '').toLowerCase();
    if (text.includes('profile')) return 'profile completeness improves trust and Google discovery';
    if (text.includes('review')) return 'fresh reviews support ranking and conversion';
    if (text.includes('media')) return 'new photos/reels improve engagement signals';
    if (text.includes('approve')) return 'approved posts keep the publishing calendar active';
    return 'recommended by growth report signals';
  }

  keywordAction(row: ApiRecord): string {
    const rank = Number(row.rank || 0);
    if (!rank) return 'import rank data';
    if (rank <= 3) return 'protect top ranking';
    if (rank <= 10) return 'push with review + GBP post';
    if (rank <= 20) return 'create service/city content';
    return 'needs local SEO page + proof media';
  }

  profileCompletionCount(audit: ApiRecord): number {
    const platforms = Array.isArray(audit.plan?.platforms) ? audit.plan.platforms : [];
    return [
      audit.businessName,
      audit.city || audit.targetArea || audit.market,
      audit.industry,
      audit.googleProfileUrl || platforms.find((item: ApiRecord) => item.key === 'googleProfile')?.profileUrl,
      audit.instagramUrl || platforms.find((item: ApiRecord) => item.key === 'instagram')?.profileUrl,
      audit.facebookUrl || platforms.find((item: ApiRecord) => item.key === 'facebook')?.profileUrl
    ].filter(Boolean).length;
  }

  metricDelta(audit: ApiRecord, key: string): number {
    const reports = Array.isArray(audit.workspace?.reports) ? audit.workspace.reports : [];
    const latest = reports[0]?.payload || reports[0] || {};
    const delta = latest?.deltas?.[key] ?? latest?.metrics?.[`${key}Delta`] ?? latest?.[`${key}Delta`];
    return Number(delta || 0);
  }

  chartPoints(value: unknown): number[] {
    const numeric = Math.max(0, Number(value || 0));
    if (!numeric) return [6, 6, 6, 6, 6, 6];
    const base = Math.max(12, Math.min(88, numeric > 100 ? 62 : numeric));
    return [base * 0.72, base * 0.82, base * 0.68, base * 0.9, base * 0.95, base].map((point) => Math.round(Math.max(8, Math.min(94, point))));
  }

  openGrowthReport(reportKey: string, option: 'ranks' | 'copilot' | 'kpis' | 'roi' | 'planner' | 'competitor' | 'report' | 'tasks'): void {
    this.activeGrowthReport.set(reportKey);
    window.setTimeout(() => {
      document.getElementById('growth-opened-report')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      this.flashGrowthOption(option);
    }, 0);
  }

  growthReportTitle(reportKey: string): string {
    const titles: Record<string, string> = {
      growth: 'Growth Action Report',
      reviews: 'Review Reply Report',
      customers: 'Customer Review Request Report',
      keywords: 'Keyword Rank Report',
      competitors: 'Competitor Analysis Report',
      posts: 'Post Media Report',
      performance: 'Monthly Performance Report',
      calendar: 'Social Calendar Report'
    };
    return titles[reportKey] || 'Growth Report';
  }

  growthReportOpenNote(reportKey: string, audit: ApiRecord): string {
    const notes: Record<string, string> = {
      growth: `${this.dhandaGrowthDone(audit)} actions complete hain. Run task batch se pending action queue update hogi.`,
      reviews: `${this.dhandaReviewSummary(audit).count} review signals aur ${this.dhandaReviewSummary(audit).rating} rating report me aa rahe hain.`,
      customers: `${this.dhandaCustomerStats(audit).sent} review requests tracked hain. Campaign ROI/attribution add karne se list aur strong hogi.`,
      keywords: `${this.dhandaKeywords(audit).length} keyword rows live hain. Manual rank import se rank report refresh hoti hai.`,
      competitors: `${this.dhandaCompetitors(audit).length} competitor rows active hain. Create alert se counter action save hota hai.`,
      posts: `${this.dhandaPostPlanner(audit).length} planner rows report me aa rahe hain. Schedule content se calendar update hota hai.`,
      performance: `${this.dhandaReportCards(audit).length} performance cards live data se ban rahe hain. Generate report se client report save hoti hai.`,
      calendar: `${this.dhandaCalendarPlan(audit).length} calendar items visible. Approved and scheduled content appears here.`
    };
    return notes[reportKey] || 'Ye report selected salon ke saved workspace data se ban rahi hai.';
  }

  scrollToGrowthOption(option: 'ranks' | 'copilot' | 'kpis' | 'roi' | 'planner' | 'competitor' | 'report' | 'tasks'): void {
    const actionTarget = document.getElementById(`growth-action-${option}`);
    const formTarget = document.getElementById(`growth-option-${option}`);
    const target = actionTarget || formTarget;
    target?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    this.flashGrowthOption(option);
  }

  flashGrowthOption(option: 'ranks' | 'copilot' | 'kpis' | 'roi' | 'planner' | 'competitor' | 'report' | 'tasks'): void {
    const actionTarget = document.getElementById(`growth-action-${option}`);
    const formTarget = document.getElementById(`growth-option-${option}`);
    const target = actionTarget || formTarget;
    target?.classList.add('linked-flash');
    window.setTimeout(() => target?.classList.remove('linked-flash'), 900);
  }

  imagePlatformSpec(target: string): ApiRecord {
    const specs: Record<string, ApiRecord> = {
      instagram_post: { ratio: 1, tolerance: 0.08, minWidth: 1080, minHeight: 1080, requiredSpec: 'Instagram Post 1:1, minimum 1080x1080' },
      instagram_reel: { ratio: 9 / 16, tolerance: 0.08, minWidth: 1080, minHeight: 1920, requiredSpec: 'Instagram Reel 9:16, minimum 1080x1920' },
      instagram_story: { ratio: 9 / 16, tolerance: 0.08, minWidth: 1080, minHeight: 1920, requiredSpec: 'Instagram Story 9:16, minimum 1080x1920' },
      youtube_thumb: { ratio: 16 / 9, tolerance: 0.08, minWidth: 1280, minHeight: 720, requiredSpec: 'YouTube Thumbnail 16:9, minimum 1280x720' },
      gbp_post: { ratio: 4 / 3, tolerance: 0.12, minWidth: 720, minHeight: 540, requiredSpec: 'Google Business Post 4:3, minimum 720x540' },
      facebook_post: { ratio: 1.91, tolerance: 0.14, minWidth: 1200, minHeight: 628, requiredSpec: 'Facebook Post 1.91:1, minimum 1200x628' }
    };
    return specs[target] || specs['instagram_post'];
  }

  private csvList(value: unknown): string[] {
    if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean);
    return String(value || '').split(',').map((item) => item.trim()).filter(Boolean);
  }

  // ============ ADVANCED AI METHODS (new) ============

  /** Growth copilot — uses the existing saved live-data copilot endpoint. */
  askCopilotAI(audit: ApiRecord): void {
    const question = String(this.aiCopilotQuestion.value || '').trim();
    if (!question) {
      this.error.set('Enter a question for the assistant.');
      return;
    }
    this.aiBusy.set('copilot');
    this.error.set('');
    this.copilotAnswer.set(null);
    this.api.post<ApiRecord>(`growth-rank-bot/audits/${audit.id}/copilot/ask`, { question }).subscribe({
      next: (answer) => {
        this.copilotAnswer.set({
          intent: answer.intent || 'growth_copilot',
          provider: answer.provider || 'workspace',
          answer: answer.answer || answer.response || 'Copilot answer saved.',
          confidence: Number(answer.confidence || 82),
          actions: Array.isArray(answer.actions) ? answer.actions : this.naturalLanguageReports(audit).slice(0, 3)
        });
        this.aiBusy.set('');
        this.loadAuditDetail(audit.id, true);
      },
      error: (error) => {
        this.error.set(this.api.errorText(error, 'Unable to get assistant answer'));
        this.aiBusy.set('');
      }
    });
  }

  /** Honest performance prediction — data-based estimate vs the client's own average. */
  runPrediction(audit: ApiRecord): void {
    this.aiBusy.set('predict');
    this.error.set('');
    this.prediction.set(null);
    const score = Math.max(0, Math.min(100, Number(this.predictScore.value || 0)));
    const channel = String(this.predictChannel.value || 'Campaign');
    const cards = this.dhandaPerformanceCards(audit);
    const current = cards.reduce((sum: number, item: ApiRecord) => sum + Number(item.value || 0), 0);
    const baseline = Math.max(1, Math.round(current / Math.max(1, cards.length || 1)));
    const lift = Math.round((score - 70) * 0.8);
    window.setTimeout(() => {
      this.prediction.set({
        pctVsAverage: lift,
        confidence: current ? (score >= 75 ? 'medium' : 'low') : 'low',
        basis: `${channel} estimate ${baseline} avg signal aur ${score}/100 optimization score par based hai.`,
        honestNote: current ? 'This forecast is estimated from live workspace metrics and is not guaranteed.' : 'Confidence improves after Google/Meta sync.'
      });
      this.aiBusy.set('');
    }, 150);
  }

  /** Browser-side size/aspect check for platform readiness. */
  onImageSelected(event: Event, audit: ApiRecord): void {
    const input = event.target as HTMLInputElement;
    const file = input.files && input.files[0];
    if (!file) return;
    if (file.size > 8 * 1024 * 1024) {
      this.error.set('Image 8MB se chhoti rakhein.');
      input.value = '';
      return;
    }
    this.aiBusy.set('verify');
    this.error.set('');
    this.verifyResult.set(null);
    const reader = new FileReader();
    reader.onload = () => {
      const base64 = String(reader.result || '');
      const image = new Image();
      image.onload = () => {
        const target = String(this.verifyTarget.value || 'instagram_post');
        const spec = this.imagePlatformSpec(target);
        const ratio = image.width / Math.max(1, image.height);
        const issues: string[] = [];
        if (Math.abs(ratio - spec.ratio) > spec.tolerance) issues.push(`Aspect ratio mismatch: required ${spec.requiredSpec}.`);
        if (image.width < spec.minWidth || image.height < spec.minHeight) issues.push(`Resolution low: minimum ${spec.minWidth}x${spec.minHeight}.`);
        const willRun = !issues.length;
        this.verifyResult.set({
          willRun,
          verdict: willRun ? 'Creative is within platform specifications and ready for approval.' : 'Resize or crop the creative before upload.',
          detected: { width: image.width, height: image.height, format: file.type || 'image', sizeKb: Math.round(file.size / 1024) },
          requiredSpec: spec.requiredSpec,
          issues
        });
        this.aiBusy.set('');
        input.value = '';
      };
      image.onerror = () => {
        this.error.set('Unable to read image dimensions. Try again with a PNG or JPG.');
        this.aiBusy.set('');
        input.value = '';
      };
      image.src = base64;
    };
    reader.onerror = () => {
      this.error.set('Unable to read the image. Try again.');
      this.aiBusy.set('');
      input.value = '';
    };
    reader.readAsDataURL(file);
  }

  // ============ existing command-layer methods ============

  importRankRows(audit: ApiRecord): void {
    const positions = this.parseRankRows();
    if (!positions.length) {
      this.error.set('Rank rows me keyword: rank format add karein.');
      return;
    }
    this.runAction('rank', `growth-rank-bot/audits/${audit.id}/rank-snapshots/import`, { source: 'manual_rank_import', positions }, audit.id, 'Rank positions imported', 'Rank tracker updated');
  }

  syncKpis(audit: ApiRecord): void {
    const value = this.commandForm.value;
    this.runAction('kpi', `growth-rank-bot/audits/${audit.id}/integration-sync`, {
      source: 'manual_kpi_import',
      providers: [
        { provider: 'Meta Graph API', status: 'manual_synced', metrics: { reach: Number(value.metaReach || 0), messages: Number(value.metaMessages || 0) } },
        { provider: 'Google Business Profile API', status: 'manual_synced', metrics: { views: Number(value.googleViews || 0), calls: Number(value.googleCalls || 0) } }
      ]
    }, audit.id, 'KPI sync saved', 'Meta and Google KPI rows refreshed');
  }

  generateWeeklyReport(audit: ApiRecord): void {
    this.runAction('report', `growth-rank-bot/audits/${audit.id}/weekly-report`, { note: 'Generated from command layer' }, audit.id, 'Executive weekly report generated', 'Report is ready for portal preview');
  }

  runTaskBatch(audit: ApiRecord): void {
    this.runAction('tasks', `growth-rank-bot/audits/${audit.id}/auto-tasks/run`, { note: 'Manual command-center task batch' }, audit.id, 'Auto growth task batch created', 'New execution tasks added');
  }

  askCopilot(audit: ApiRecord): void {
    const question = String(this.commandForm.value.copilotQuestion || '').trim();
    if (!question) {
      this.error.set('Copilot question required hai.');
      return;
    }
    this.runAction('copilot', `growth-rank-bot/audits/${audit.id}/copilot/ask`, { question }, audit.id, 'Copilot answer saved', 'Live-data copilot response saved');
  }

  saveCampaignProfit(audit: ApiRecord): void {
    const value = this.commandForm.value;
    this.runAction('campaign', `growth-rank-bot/audits/${audit.id}/campaign-profit`, {
      campaignName: value.campaignName,
      source: value.campaignSource,
      spend: Number(value.campaignSpend || 0),
      leads: Number(value.campaignLeads || 0),
      bookings: Number(value.campaignBookings || 0),
      revenue: Number(value.campaignRevenue || 0)
    }, audit.id, 'Campaign ROI row saved', 'Profit engine recalculated ROI');
  }

  scheduleContent(audit: ApiRecord): void {
    const value = this.commandForm.value;
    this.runAction('planner', `growth-rank-bot/audits/${audit.id}/publishing-planner`, {
      title: value.publishingTitle,
      channel: value.publishingChannel,
      scheduledFor: value.scheduledFor,
      approvalStatus: 'approved',
      publishStatus: 'scheduled_draft',
      provider: value.publishingChannel === 'Google Business Profile' ? 'Google Business Profile API' : 'Meta Graph API'
    }, audit.id, 'Publishing planner row scheduled', 'Approved draft moved to calendar');
  }

  generateSeoPages(audit: ApiRecord): void {
    this.runAction('seo', `growth-rank-bot/audits/${audit.id}/seo-pages/generate`, { force: false }, audit.id, 'Local SEO pages ready', 'Service, city and offer page drafts checked');
  }

  createCompetitorAlert(audit: ApiRecord): void {
    const value = this.commandForm.value;
    this.runAction('watch', `growth-rank-bot/audits/${audit.id}/competitor-alerts`, {
      competitorName: value.competitorName,
      signalType: value.competitorSignal,
      severity: 'high',
      recommendedAction: value.competitorAction,
      status: 'open'
    }, audit.id, 'Competitor watch alert created', 'Counter action queued');
  }

  markProposalSent(audit: ApiRecord): void {
    const proposal = this.firstItem(audit.workspace?.proposals);
    if (!proposal?.id) {
      this.error.set('Proposal row not found for this audit.');
      return;
    }
    this.runPatch('proposal', `growth-rank-bot/proposals/${proposal.id}/status`, { status: 'sent', invoiceStatus: proposal.invoiceStatus || 'draft' }, audit.id, 'Proposal marked as sent', 'Client proposal status updated');
  }

  markInvoiceIssued(audit: ApiRecord): void {
    const proposal = this.firstItem(audit.workspace?.proposals);
    if (!proposal?.id) {
      this.error.set('Proposal row not found for this audit.');
      return;
    }
    this.runPatch('invoice', `growth-rank-bot/proposals/${proposal.id}/status`, { status: 'won', invoiceStatus: 'issued' }, audit.id, 'Invoice marked as issued', 'Proposal won and invoice issued');
  }

  loadPortalPreview(audit: ApiRecord): void {
    const token = this.firstItem(audit.workspace?.portalSessions)?.portalToken || audit.workspace?.client?.portalToken;
    if (!token) {
      this.error.set('Portal token not found for this audit.');
      return;
    }
    this.actionBusy.set('portal');
    this.error.set('');
    this.api.list<ApiRecord>(`growth-rank-bot/client-portal/${token}`).subscribe({
      next: (portal) => {
        this.portalPreview.set(portal);
        this.actionMessage.set('Client portal preview loaded');
        this.latestCommandResult.set({ title: 'Portal preview loaded', detail: `${portal.audit?.businessName || audit.businessName} portal data is visible below.` });
        this.actionBusy.set('');
      },
      error: (error) => {
        this.error.set(this.api.errorText(error, 'Unable to load client portal preview'));
        this.actionBusy.set('');
      }
    });
  }

  private runAction(key: string, path: string, payload: ApiRecord, auditId: string, message: string, detail: string): void {
    this.actionBusy.set(key);
    this.error.set('');
    this.api.post<ApiRecord>(path, payload).subscribe({
      next: (result) => {
        this.actionMessage.set(message);
        this.latestCommandResult.set({ title: message, detail, payload: result });
        this.reloadSelectedAudit(auditId);
      },
      error: (error) => {
        this.error.set(this.api.errorText(error, message));
        this.actionBusy.set('');
      }
    });
  }

  private runPatch(key: string, path: string, payload: ApiRecord, auditId: string, message: string, detail: string): void {
    this.actionBusy.set(key);
    this.error.set('');
    this.api.patch<ApiRecord>(path, payload).subscribe({
      next: (result) => {
        this.actionMessage.set(message);
        this.latestCommandResult.set({ title: message, detail, payload: result });
        this.reloadSelectedAudit(auditId);
      },
      error: (error) => {
        this.error.set(this.api.errorText(error, message));
        this.actionBusy.set('');
      }
    });
  }

  private reloadSelectedAudit(auditId: string): void {
    this.loadAuditDetail(auditId, true);
  }

  private loadAuditDetail(auditId: string, isActionRefresh = false): void {
    this.api.get<ApiRecord>('growth-rank-bot/audits', auditId).subscribe({
      next: (audit) => {
        this.selectedAudit.set(audit);
        this.audits.set([audit, ...this.audits().filter((item) => item.id !== audit.id)]);
        this.patchCommandForm(audit);
        if (isActionRefresh) {
          this.loadDashboard();
          this.loadCommandCenter();
        }
        this.loading.set(false);
        this.actionBusy.set('');
      },
      error: (error) => {
        this.error.set(this.api.errorText(error, isActionRefresh ? 'Action saved but audit refresh failed' : 'Unable to load selected growth audit'));
        this.loading.set(false);
        this.actionBusy.set('');
      }
    });
  }

  private parseRankRows(): ApiRecord[] {
    return String(this.commandForm.value.rankRows || '')
      .split(/\n+/)
      .map((line) => {
        const [keyword, rawRank] = line.split(':');
        return { keyword: keyword?.trim(), rankPosition: Number(String(rawRank || '').trim()) };
      })
      .filter((item) => item.keyword && item.rankPosition > 0);
  }

  private patchCommandForm(audit: ApiRecord): void {
    const keywords = audit.workspace?.rankKeywords || audit.plan?.advancedGrowthSystem?.rankTracker?.keywords || [];
    if (Array.isArray(keywords) && keywords.length) {
      const rankRows = keywords.slice(0, 5).map((item: ApiRecord, index: number) => `${item.keyword}: ${item.currentRank || index + 6}`).join('\n');
      this.commandForm.patchValue({ rankRows }, { emitEvent: false });
    }
    const campaign = this.firstItem(audit.workspace?.campaignProfit);
    const alert = this.firstItem(audit.workspace?.competitorAlerts);
    this.commandForm.patchValue({
      campaignName: campaign?.campaignName || this.commandForm.value.campaignName,
      campaignSource: campaign?.source || this.commandForm.value.campaignSource,
      competitorName: alert?.competitorName || this.commandForm.value.competitorName,
      competitorSignal: alert?.signalType || this.commandForm.value.competitorSignal,
      competitorAction: alert?.recommendedAction || this.commandForm.value.competitorAction
    }, { emitEvent: false });
  }

  private patchAuditForm(audit: ApiRecord): void {
    this.auditForm.patchValue({
      businessName: audit.businessName || this.auditForm.value.businessName,
      industry: audit.industry || this.auditForm.value.industry,
      city: audit.city || this.auditForm.value.city,
      targetArea: audit.targetArea || audit.market || this.auditForm.value.targetArea,
      clientEmail: audit.clientEmail || audit.workspace?.client?.email || this.auditForm.value.clientEmail,
      packageName: audit.packageName || this.auditForm.value.packageName,
      monthlyFee: String(audit.monthlyFee || audit.packageFee || this.auditForm.value.monthlyFee || ''),
      topServices: Array.isArray(audit.topServices) ? audit.topServices.join(', ') : (audit.topServices || this.auditForm.value.topServices),
      rankKeywords: Array.isArray(audit.rankKeywords) ? audit.rankKeywords.join(', ') : (audit.rankKeywords || this.auditForm.value.rankKeywords),
      competitors: Array.isArray(audit.competitors) ? audit.competitors.join(', ') : (audit.competitors || this.auditForm.value.competitors),
      goal: audit.goal || audit.primaryGoal || this.auditForm.value.goal,
      instagramUrl: audit.instagramUrl || this.auditForm.value.instagramUrl,
      facebookUrl: audit.facebookUrl || this.auditForm.value.facebookUrl,
      googleProfileUrl: audit.googleProfileUrl || this.auditForm.value.googleProfileUrl
    }, { emitEvent: false });
  }

  private plannerDate(value: unknown): Date | null {
    if (!value) return null;
    const date = new Date(String(value));
    if (Number.isNaN(date.getTime())) return null;
    date.setHours(0, 0, 0, 0);
    return date;
  }

  private showToast(type: 'success' | 'error' | 'info', message: string): void {
    this.toast.set({ type, message });
    window.setTimeout(() => {
      if (this.toast()?.message === message) this.toast.set(null);
    }, 3500);
  }

  clearToast(): void {
    this.toast.set(null);
  }

  private payload(): ApiRecord {
    const value = this.auditForm.value;
    return {
      ...value,
      monthlyFee: Number(value.monthlyFee || 0),
      competitors: this.csv(value.competitors, 5),
      topServices: this.csv(value.topServices, 6),
      rankKeywords: this.csv(value.rankKeywords, 12)
    };
  }

  private csv(value: unknown, limit: number): string[] {
    return String(value || '').split(',').map((item) => item.trim()).filter(Boolean).slice(0, limit);
  }
}
