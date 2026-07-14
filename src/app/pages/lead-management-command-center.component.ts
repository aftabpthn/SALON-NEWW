import { CommonModule } from '@angular/common';
import { Component, OnInit, computed, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { finalize } from 'rxjs';
import { environment } from '../../environments/environment';
import { ApiRecord, ApiService } from '../core/api.service';
import { AuraDatePipe } from '../shared/pipes/aura-date.pipe';

@Component({
  selector: 'app-lead-management-command-center',
  standalone: true,
  imports: [AuraDatePipe, CommonModule, FormsModule, RouterLink],
  template: `
    <section class="lead-page">
      <header class="lead-toolbar">
        <div class="view-switch">
          <button type="button" [class.active]="viewMode() === 'list'" (click)="viewMode.set('list')" title="List view">☰</button>
          <button type="button" [class.active]="viewMode() === 'board'" (click)="viewMode.set('board')" title="Board view">▦</button>
        </div>
        <nav>
          <a routerLink="/leads" [class.active]="mode() === 'board'">Leads</a>
          <a routerLink="/leads/follow-up" [class.active]="mode() === 'follow-up'">Follow Up</a>
          <a routerLink="/leads/settings" [class.active]="mode() === 'settings'">Lead Setting</a>
        </nav>
        <div class="toolbar-actions">
          <button class="primary" type="button" (click)="openLeadDrawer()">+ Lead</button>
          <a class="dark" routerLink="/leads/follow-up">Follow Up</a>
          <button class="dark" type="button" (click)="actionOpen.set(!actionOpen())">Action ▾</button>
          <div class="action-menu" *ngIf="actionOpen()">
            <a routerLink="/leads/settings">Lead Setting</a>
            <button type="button" (click)="downloadSample()">Sample File</button>
            <label>Import Leads<input type="file" accept=".csv,text/csv" (change)="importCsv($event)" /></label>
          </div>
        </div>
      </header>

      <section class="hero">
        <div>
          <span class="eyebrow">Sales Tools / Lead Management</span>
          <h1>Advanced Lead Management</h1>
          <p>Pipeline, follow-ups, lead scoring, staff ownership, won/lost conversion, import and audit in one command center.</p>
        </div>
        <div class="metrics">
          <article *ngFor="let card of cards()">
            <small>{{ card.label }}</small>
            <strong>{{ card.key === 'revenue' ? ('₹' + (card.value || 0)) : card.value }}</strong>
            <span>{{ card.detail }}</span>
          </article>
        </div>
      </section>

      <section class="lead-list-shell" *ngIf="mode() === 'board'">
        <header class="list-head">
          <div>
            <h2>All leads</h2>
            <p>{{ rows().length }} leads in selected view</p>
          </div>
          <button class="primary" type="button" (click)="openLeadDrawer()">+ Add new lead</button>
        </header>
        <div class="saved-filter-row">
          <label>
            <span>Saved views</span>
            <select [(ngModel)]="filters.savedView">
              <option value="">All leads</option>
              <option value="hot">Hot leads</option>
              <option value="attention">Needs attention</option>
              <option value="won">Won leads</option>
              <option value="overdue">Overdue follow-ups</option>
            </select>
          </label>
          <label>
            <span>Assigned to</span>
            <input [(ngModel)]="filters.assignedTo" placeholder="All staff" />
          </label>
          <label>
            <span>Status</span>
            <select [(ngModel)]="filters.status">
              <option value="">All</option>
              <option value="open">Open</option>
              <option value="won">Won</option>
              <option value="lost">Lost</option>
            </select>
          </label>
          <label>
            <span>Priority</span>
            <select [(ngModel)]="filters.priority">
              <option value="">All</option>
              <option value="hot">Hot</option>
              <option value="warm">Warm</option>
              <option value="cold">Cold</option>
            </select>
          </label>
          <button class="outline" type="button" (click)="advancedFiltersOpen.set(!advancedFiltersOpen())">Advanced filters</button>
          <label class="search-field">
            <span>Search</span>
            <input [(ngModel)]="filters.q" placeholder="Search" />
          </label>
          <button type="button" (click)="load()">Filter</button>
        </div>
      </section>

      <section class="attention-strip" *ngIf="mode() === 'board' && attentionRows().length">
        <div>
          <h2>Manager needs attention</h2>
          <p>Hot unassigned, overdue, stale and high-value leads needing action.</p>
        </div>
        <button class="attention-card" type="button" *ngFor="let lead of attentionRows()" (click)="openDetail(lead.id)">
          <span [class]="'attention-priority ' + (lead.attentionPriority || 'low')">{{ lead.attentionPriority || 'low' }}</span>
          <strong>{{ lead.customerName || lead.title }}</strong>
          <small>{{ attentionSummary(lead) }}</small>
          <em>{{ lead.nextBestAction?.label || 'Review lead' }}</em>
        </button>
      </section>

      <section class="automation-strip" *ngIf="mode() === 'board' && automationQueue().length">
        <header class="section-title">
          <div>
            <h2>Automation & staff accountability</h2>
            <span>{{ automationSummary().urgent || 0 }} urgent · {{ automationSummary().overdueAlerts || 0 }} overdue · {{ automationSummary().lostWinBack || 0 }} win-back</span>
          </div>
          <div class="detail-actions">
            <button type="button" class="outline mini" (click)="loadAutomationQueue()">Refresh</button>
            <button type="button" class="primary mini" (click)="runAutomationBatch()">Run top actions</button>
          </div>
        </header>
        <div class="automation-grid">
          <article class="automation-card" *ngFor="let item of automationQueue().slice(0, 8)" [ngClass]="item.priority || 'medium'">
            <span [class]="'attention-priority ' + (item.priority || 'medium')">{{ item.priority || 'medium' }}</span>
            <strong>{{ item.title }}</strong>
            <p>{{ item.customerName || item.leadTitle }} · {{ item.description }}</p>
            <small>{{ item.assignedName || 'Unassigned' }} · {{ item.leadTemperature || 'cold' }} {{ item.leadScore || 0 }}</small>
            <div class="detail-actions">
              <button type="button" class="outline mini" (click)="openDetail(item.leadId)">Open</button>
              <button type="button" class="primary mini" (click)="runAutomationItem(item)">{{ item.actionLabel || 'Run' }}</button>
            </div>
          </article>
        </div>
      </section>

      <section class="filters" *ngIf="mode() !== 'settings' && mode() !== 'detail' && advancedFiltersOpen()">
        <label><span>From</span><input type="date" [(ngModel)]="filters.from" /></label>
        <label><span>To</span><input type="date" [(ngModel)]="filters.to" /></label>
        <label>
          <span>Lead Stage</span>
          <select [(ngModel)]="filters.stageId">
            <option value="">All Stages</option>
            <option *ngFor="let stage of stages()" [value]="stage.id">{{ stage.name }}</option>
          </select>
        </label>
        <button type="button" (click)="load()">Filter</button>
      </section>

      <section class="mode-panel" *ngIf="mode() === 'board'">
        <div class="section-title">
          <h2>{{ viewMode() === 'board' ? 'Pipeline Board' : 'All leads table' }}</h2>
          <span>{{ viewMode() === 'board' ? 'Stage wise tracking' : 'Lead manager reference view' }}</span>
        </div>
        <div class="board" *ngIf="viewMode() === 'board'; else listView">
          <article class="stage-column" *ngFor="let column of columns()">
            <header [style.borderTopColor]="column.color || '#111827'">
              <strong>{{ column.name }}</strong>
              <span>{{ column.leads?.length || 0 }}</span>
            </header>
            <button class="lead-card" type="button" *ngFor="let lead of column.leads || []" (click)="openDetail(lead.id)">
              <div><strong>{{ lead.title }}</strong><small>{{ lead.followUpAt | auraDate:'dateTime' }}</small></div>
              <span class="amount">₹{{ lead.quotedAmount || 0 }}</span>
              <small>Name: {{ lead.customerName }}</small>
              <small>Contact: {{ lead.phone }}</small>
              <small>{{ lead.assignedName || 'Unassigned' }} · {{ lead.leadTemperature }}</small>
            </button>
          </article>
        </div>
        <ng-template #listView>
          <div class="lead-table">
            <div class="lead-table-row head">
              <span class="check-cell"><input type="checkbox" disabled /></span>
              <span>Lead name</span>
              <span>Email ID</span>
              <span>Lead type</span>
              <span>Source</span>
              <span>Score</span>
              <span>Status</span>
              <span>Date</span>
              <span>Reasons</span>
              <span>Next action</span>
              <span>Attention</span>
              <span>Assigned to</span>
              <span>Action</span>
            </div>
            <div class="lead-table-row" *ngFor="let lead of filteredRows(); trackBy: trackLead">
              <span class="check-cell"><input type="checkbox" /></span>
              <button class="lead-name-link" type="button" (click)="openDetail(lead.id)">
                <strong>{{ lead.customerName || lead.title }}</strong>
                <small>{{ lead.phone || 'No phone' }}</small>
              </button>
              <span>{{ lead.email || '-' }}</span>
              <span>{{ lead.typeName || 'Membership' }}</span>
              <span>{{ lead.source || '-' }}</span>
              <span><span class="score-pill" [class.hot]="lead.leadTemperature === 'hot'" [class.warm]="lead.leadTemperature === 'warm'">{{ lead.leadTemperature || 'cold' }} · {{ lead.leadScore || 0 }}</span></span>
              <span><span class="status-pill" [class.hot]="lead.leadTemperature === 'hot'" [class.won]="lead.status === 'won'" [class.lost]="lead.status === 'lost'">{{ lead.status || lead.stageName || 'New' }}</span></span>
              <span>{{ (lead.createdAt || lead.followUpAt) | auraDate:'date' }}</span>
              <span class="chip-list"><small *ngFor="let reason of topReasons(lead)" [class]="'reason-chip ' + (reason.tone || 'neutral')">{{ reason.label }}</small></span>
              <span><strong>{{ nextBestAction(lead).label || 'Review lead' }}</strong><small class="muted">{{ nextBestAction(lead).detail || '-' }}</small></span>
              <span><span [class]="'attention-pill ' + (lead.attentionPriority || 'none')" *ngIf="lead.needsAttention; else noAttention">{{ lead.attentionPriority }}</span><ng-template #noAttention><span class="muted">Clear</span></ng-template></span>
              <span>{{ lead.assignedName || lead.assignedTo || 'Unassigned' }}</span>
              <span><button class="outline mini" type="button" (click)="openDetail(lead.id)">Open</button></span>
            </div>
            <p class="empty" *ngIf="!filteredRows().length">No leads match this view.</p>
          </div>
        </ng-template>
      </section>

      <section class="mode-panel" *ngIf="mode() === 'follow-up'">
        <h2>Leads Follow Up</h2>
        <div class="table-card">
          <div class="day-band">Follow-up Queue</div>
          <div class="table-row head"><span>Followup Time</span><span>Lead Title</span><span>Lead Price</span><span>Stage</span><span>Staff</span><span>Customer Name</span><span>Customer Email</span><span>Customer Contact</span><span>Action</span></div>
          <div class="table-row" *ngFor="let item of followUps()">
            <span>{{ item.dueAt | auraDate:'time' }}</span>
            <span>{{ item.lead?.title || item.leadId }}</span>
            <span>₹{{ item.lead?.quotedAmount || 0 }}</span>
            <span>{{ item.lead?.stageName || '-' }}</span>
            <span>{{ item.lead?.assignedName || '-' }}</span>
            <span>{{ item.lead?.customerName || '-' }}</span>
            <span>{{ item.lead?.email || '-' }}</span>
            <span>{{ item.lead?.phone || '-' }}</span>
            <span><button class="outline mini" type="button" (click)="completeFollowUp(item)">Done</button></span>
          </div>
          <p class="empty" *ngIf="!followUps().length">No follow-ups for this filter.</p>
        </div>
      </section>

      <section class="mode-panel settings-grid" *ngIf="mode() === 'settings'">
        <article class="settings-card">
          <header><h2>Lead Stages</h2><button type="button" (click)="saveStage()">Save Stage</button></header>
          <div class="inline-form">
            <input [(ngModel)]="stageForm.name" placeholder="Stage name" />
            <input type="number" [(ngModel)]="stageForm.sortOrder" placeholder="Order" />
            <label><input type="checkbox" [(ngModel)]="stageForm.active" /> Active</label>
          </div>
          <div class="settings-row" *ngFor="let stage of stages()">
            <span>{{ stage.name }}</span><small>{{ stage.sortOrder }}</small><button type="button" (click)="editStage(stage)">Edit</button>
          </div>
        </article>
        <article class="settings-card">
          <header><h2>Lead Type</h2><button type="button" (click)="saveType()">Save Type</button></header>
          <div class="inline-form">
            <input [(ngModel)]="typeForm.name" placeholder="Type name" />
            <label><input type="checkbox" [(ngModel)]="typeForm.active" /> Active</label>
          </div>
          <div class="settings-row" *ngFor="let type of types()">
            <span>{{ type.name }}</span><small>{{ type.active ? 'Active' : 'Inactive' }}</small><button type="button" (click)="editType(type)">Edit</button>
          </div>
        </article>
      </section>

      <section class="detail-workspace" *ngIf="mode() === 'detail' && detail() as item">
        <header class="detail-topbar">
          <a routerLink="/leads" class="back-link">← Lead details</a>
          <div class="detail-top-actions">
            <button class="outline" type="button" (click)="openLeadDrawer(item.lead)">Edit lead</button>
            <button class="primary" type="button" (click)="openLeadDrawer()">+ Add new lead</button>
          </div>
        </header>
        <aside class="lead-side-list">
          <input [(ngModel)]="sideSearch" placeholder="Search" />
          <button class="side-lead" type="button" *ngFor="let lead of sideList(item.lead)" [class.active]="lead.id === item.lead?.id" (click)="openDetail(lead.id)">
            <span class="avatar">{{ initials(lead.customerName || lead.title) }}</span>
            <span><strong>{{ lead.customerName || lead.title }}</strong><small>{{ recentNote(lead) }}</small></span>
          </button>
        </aside>
        <article class="activity-panel">
          <div class="activity-head">
            <h2>Communication timeline</h2>
            <select [(ngModel)]="activityFilter">
              <option value="">All</option>
              <option value="whatsapp">WhatsApp</option>
              <option value="call">Calls</option>
              <option value="email">Email</option>
              <option value="note">Notes</option>
              <option value="follow">Follow-ups</option>
              <option value="ai">AI script</option>
              <option value="system">System</option>
            </select>
            <button class="outline" type="button" (click)="openPurchaseHistory(item.lead)">Purchase history</button>
          </div>
          <p class="action-notice" *ngIf="actionNotice">{{ actionNotice }}</p>
          <div class="timeline modern">
            <article *ngFor="let event of activityRows(item)" [class]="'timeline-item ' + (event.channel || 'system')">
              <span class="timeline-icon">{{ event.icon }}</span>
              <div>
                <span class="timeline-meta"><small>{{ event.kind }}</small><small>{{ event.status || 'recorded' }}</small></span>
                <strong>{{ event.title }}</strong>
                <p>{{ event.body }}</p>
                <small class="timeline-sub" *ngIf="event.dueAt">Due {{ event.dueAt | auraDate:'dateTime' }}</small>
              </div>
              <time>{{ event.createdAt | auraDate:'dateTime' }}</time>
            </article>
            <p class="empty" *ngIf="!activityRows(item).length">No activity recorded yet.</p>
          </div>
        </article>
        <aside class="lead-detail-panel">
          <div class="score-card">
            <span>Lead score</span>
            <strong>{{ item.lead?.leadScore || 0 }} / 100</strong>
          </div>
          <div class="quick-actions">
            <button type="button" (click)="callLead(item.lead)">Call</button>
            <button type="button" (click)="sendWhatsapp()">Message</button>
            <button type="button" (click)="emailLead(item.lead)">Email</button>
            <button type="button" (click)="aiCallLead(item.lead)">AI call</button>
          </div>
          <div class="next-action-card" *ngIf="nextBestAction(item.lead) as action">
            <span [class]="'attention-priority ' + (action.priority || 'normal')">{{ action.priority || 'normal' }}</span>
            <strong>{{ action.label }}</strong>
            <p>{{ action.detail }}</p>
          </div>
          <div class="attention-badges" *ngIf="managerAttention(item.lead).length">
            <span *ngFor="let attention of managerAttention(item.lead)" [class]="'attention-pill ' + (attention.priority || 'low')">{{ attention.label }}</span>
          </div>
          <section class="profile-section score-breakdown">
            <h3>Score breakdown</h3>
            <p *ngFor="let reason of scoreBreakdown(item.lead)">
              <span>{{ reason.label }}</span>
              <strong>{{ reason.value > 0 ? '+' : '' }}{{ reason.value }}</strong>
            </p>
          </section>
          <section class="profile-section quality-list">
            <h3>Quality signals</h3>
            <p *ngFor="let signal of qualitySignals(item.lead)" [class]="signal.status || 'neutral'">
              <strong>{{ signal.label }}</strong>
              <span>{{ signal.detail }}</span>
            </p>
          </section>
          <div class="tabs detail-tabs">
            <button type="button" [class.active]="detailTab() === 'details'" (click)="detailTab.set('details')">Details</button>
            <button type="button" [class.active]="detailTab() === 'notes'" (click)="detailTab.set('notes')">Notes</button>
            <button type="button" [class.active]="detailTab() === 'tasks'" (click)="detailTab.set('tasks')">Tasks</button>
            <button type="button" [class.active]="detailTab() === 'other'" (click)="detailTab.set('other')">Other info</button>
          </div>
          <div class="linked-profile">
            <strong>Linked guest profile</strong>
            <span>{{ item.lead?.customerName || '-' }} | {{ item.lead?.phone || '-' }}</span>
            <small>{{ item.lead?.clientId ? 'Client linked' : 'Client not linked yet' }}</small>
          </div>
          <section class="profile-section business-link-card">
            <div class="section-title">
              <h3>Business links</h3>
              <span>{{ clientMatches(item).length }} match</span>
            </div>
            <dl>
              <dt>Client</dt><dd>{{ businessLinks(item).client?.name || item.lead?.clientId || 'Not linked' }}</dd>
              <dt>Appointment</dt><dd>{{ businessLinks(item).appointment?.startAt ? (businessLinks(item).appointment?.startAt | auraDate:'dateTime') : (item.lead?.appointmentId || 'Not booked') }}</dd>
              <dt>Invoice</dt><dd>{{ businessLinks(item).invoice?.invoiceNumber || item.lead?.invoiceId || 'Not linked' }}</dd>
              <dt>Revenue</dt><dd>{{ money(item.lead?.convertedAmount || businessLinks(item).invoice?.total || 0) }}</dd>
            </dl>
            <div class="match-list" *ngIf="clientMatches(item).length">
              <button type="button" *ngFor="let match of clientMatches(item)" (click)="linkExistingClient(match.id)">
                {{ match.name || match.id }} <small>{{ match.phone || match.email || '' }}</small>
              </button>
            </div>
            <div class="business-actions">
              <button type="button" (click)="linkExistingClient()">Link client</button>
              <button type="button" (click)="createClientFromLead()">Create client</button>
              <button type="button" (click)="bookAppointmentFromLead(item.lead)">Book</button>
              <button type="button" (click)="linkInvoiceToLead()">Link invoice</button>
              <button type="button" (click)="openLinkedClient(item)">Open client</button>
              <button type="button" (click)="openLinkedAppointment(item)">Open booking</button>
              <button type="button" (click)="openLinkedInvoice(item)">Open invoice</button>
            </div>
          </section>
          <section class="profile-section" *ngIf="detailTab() === 'details'">
            <h3>User details</h3>
            <dl>
              <dt>Name</dt><dd>{{ item.lead?.customerName || '-' }}</dd>
              <dt>Phone</dt><dd>{{ item.lead?.phone || '-' }}</dd>
              <dt>Email</dt><dd>{{ item.lead?.email || '-' }}</dd>
              <dt>Description</dt><dd>{{ item.lead?.notes || '-' }}</dd>
              <dt>Source</dt><dd>{{ item.lead?.source || '-' }}</dd>
              <dt>Assigned to</dt><dd>{{ item.lead?.assignedName || item.lead?.assignedTo || '-' }}</dd>
            </dl>
          </section>
          <section class="profile-section" *ngIf="detailTab() === 'notes'">
            <textarea [(ngModel)]="noteText" rows="4" placeholder="Add note"></textarea>
            <div class="detail-actions right">
              <button type="button" (click)="addNote()">Save</button>
              <button type="button" (click)="draftWhatsapp()">WhatsApp Draft</button>
            </div>
          </section>
          <section class="profile-section" *ngIf="detailTab() === 'tasks'">
            <button type="button" (click)="addFollowUp()">Add Follow Up</button>
            <button type="button" (click)="assignLeadOwner(item.lead)">Assign</button>
            <button type="button" (click)="escalateLead()">Escalate</button>
            <button type="button" (click)="createWinBack()">Win-back</button>
            <button type="button" (click)="markWon()">Won</button>
            <button type="button" (click)="markLost()">Lost</button>
            <div class="task-list">
              <article *ngFor="let followUp of item.followUps || []">
                <strong>{{ followUp.status || 'pending' }}</strong>
                <span>{{ followUp.dueAt | auraDate:'dateTime' }}</span>
                <p>{{ followUp.note || 'Follow-up scheduled' }}</p>
                <button class="outline mini" type="button" (click)="completeFollowUp(followUp)" [disabled]="followUp.status === 'done'">Mark done</button>
              </article>
              <p class="empty compact" *ngIf="!(item.followUps || []).length">No follow-up tasks yet.</p>
            </div>
          </section>
          <section class="profile-section" *ngIf="detailTab() === 'other'">
            <h3>Lead assessment</h3>
            <p>Status: {{ item.lead?.status || '-' }}</p>
            <p>Stage: {{ item.lead?.stageName || '-' }}</p>
            <p>SLA: {{ item.lead?.slaStatus || '-' }}</p>
            <p>Quoted amount: ₹{{ item.lead?.quotedAmount || 0 }}</p>
          </section>
        </aside>
      </section>

      <section class="reports report-dashboard" *ngIf="mode() !== 'detail' && report() as report">
        <header class="report-header">
          <div>
            <span class="eyebrow">Lead Intelligence Reports</span>
            <h2>Owner insight dashboard</h2>
          </div>
          <button class="outline" type="button" (click)="loadOverview()">Refresh reports</button>
        </header>

        <div class="report-kpis">
          <article><small>Total leads</small><strong>{{ report.summary?.totalLeads || 0 }}</strong><span>Selected period</span></article>
          <article><small>Conversion</small><strong>{{ report.summary?.conversionRate || 0 }}%</strong><span>{{ report.summary?.wonLeads || 0 }} won / {{ report.summary?.lostLeads || 0 }} lost</span></article>
          <article><small>Won revenue</small><strong>{{ money(report.summary?.revenueFromWonLeads) }}</strong><span>From converted leads</span></article>
          <article><small>Lost opportunity</small><strong>{{ money(report.summary?.lostOpportunityValue) }}</strong><span>Quoted value lost</span></article>
          <article><small>Top source</small><strong>{{ report.summary?.topLeadSource || '-' }}</strong><span>{{ report.summary?.sourceCount || 0 }} sources</span></article>
          <article><small>Top staff</small><strong>{{ report.summary?.topStaff || '-' }}</strong><span>{{ report.summary?.staffCount || 0 }} owners</span></article>
        </div>

        <div class="report-grid">
          <article>
            <h3>Source ROI</h3>
            <div class="report-row head"><span>Source</span><span>Conv</span><span>Revenue</span><span>Attention</span></div>
            <div class="report-row" *ngFor="let row of reportList(report, 'sourceRoi')">
              <strong>{{ row.source || row.label || 'Unknown' }}</strong>
              <span>{{ row.conversionRate || 0 }}%</span>
              <span>{{ money(row.wonRevenue) }}</span>
              <span>{{ row.needsAttention || 0 }}</span>
            </div>
            <p class="empty compact" *ngIf="!reportList(report, 'sourceRoi').length">No source data yet.</p>
          </article>

          <article>
            <h3>Staff conversion</h3>
            <div class="report-row head"><span>Staff</span><span>Conv</span><span>Won</span><span>Overdue</span></div>
            <div class="report-row" *ngFor="let row of reportList(report, 'staffConversion')">
              <strong>{{ row.staff || row.label || 'Unassigned' }}</strong>
              <span>{{ row.conversionRate || 0 }}%</span>
              <span>{{ row.wonCount || 0 }}</span>
              <span>{{ row.overdueFollowUps || 0 }}</span>
            </div>
            <p class="empty compact" *ngIf="!reportList(report, 'staffConversion').length">No staff conversion data yet.</p>
          </article>

          <article>
            <h3>Funnel conversion</h3>
            <div class="report-row head"><span>Stage</span><span>Leads</span><span>Drop</span><span>Revenue</span></div>
            <div class="report-row" *ngFor="let row of reportList(report, 'funnelConversion')">
              <strong>{{ row.stage || row.label || '-' }}</strong>
              <span>{{ row.leadCount || row.count || 0 }}</span>
              <span>{{ row.dropOffRate || 0 }}%</span>
              <span>{{ money(row.revenue) }}</span>
            </div>
          </article>

          <article>
            <h3>Lost reason analysis</h3>
            <div class="report-row head"><span>Reason</span><span>Lost</span><span>Value</span><span>Source</span></div>
            <div class="report-row" *ngFor="let row of reportList(report, 'lostReasonAnalysis')">
              <strong>{{ row.reason || 'Unspecified' }}</strong>
              <span>{{ row.lostCount || 0 }}</span>
              <span>{{ money(row.lostOpportunity) }}</span>
              <span>{{ row.topSource || '-' }}</span>
            </div>
            <p class="empty compact" *ngIf="!reportList(report, 'lostReasonAnalysis').length">No lost leads in this view.</p>
          </article>

          <article>
            <h3>Revenue from won leads</h3>
            <p>Won revenue <strong>{{ money(report.revenueAttribution?.wonRevenue) }}</strong></p>
            <p>Average won value <strong>{{ money(report.revenueAttribution?.averageWonRevenue) }}</strong></p>
            <p>Invoice linked <strong>{{ report.revenueAttribution?.invoiceLinkedCount || 0 }}</strong></p>
            <p>Appointment linked <strong>{{ report.revenueAttribution?.appointmentLinkedCount || 0 }}</strong></p>
            <p>Unlinked won revenue <strong>{{ money(report.revenueAttribution?.unlinkedWonRevenue) }}</strong></p>
            <p>Open pipeline <strong>{{ money(report.revenueAttribution?.openPipelineValue) }}</strong></p>
          </article>

          <article class="recommendations">
            <h3>AI recommendations</h3>
            <div class="recommendation-card" *ngFor="let item of reportList(report, 'recommendations')" [ngClass]="item.priority || 'low'">
              <span>{{ item.priority || 'low' }}</span>
              <strong>{{ item.title }}</strong>
              <p>{{ item.detail }}</p>
              <small>{{ item.action }}</small>
            </div>
          </article>
        </div>
      </section>

      <aside class="drawer" *ngIf="drawerOpen()">
        <header><button type="button" (click)="drawerOpen.set(false)">×</button><h2>{{ form.id ? 'Edit Lead' : 'Add Lead' }}</h2></header>
        <div class="drawer-grid">
          <input [(ngModel)]="form.title" placeholder="Lead Title" />
          <input type="number" [(ngModel)]="form.quotedAmount" placeholder="Quoted Price" />
          <select [(ngModel)]="form.currency"><option value="INR">Indian rupee - INR - ₹</option><option value="USD">USD</option></select>
          <input [(ngModel)]="form.customerName" placeholder="Name*" />
          <input [(ngModel)]="form.email" placeholder="Email" />
          <input [(ngModel)]="form.phone" placeholder="Contact*" />
          <select [(ngModel)]="form.typeId"><option value="">Lead Type</option><option *ngFor="let type of types()" [value]="type.id">{{ type.name }}</option></select>
          <select [(ngModel)]="form.stageId"><option value="">Select Stage*</option><option *ngFor="let stage of stages()" [value]="stage.id">{{ stage.name }}</option></select>
          <input [(ngModel)]="form.assignedTo" placeholder="Select Employee*" />
          <input [(ngModel)]="form.source" placeholder="Source" />
          <input type="datetime-local" [(ngModel)]="form.followUpAt" />
          <textarea [(ngModel)]="form.notes" placeholder="Notes" rows="4"></textarea>
        </div>
        <footer><button type="button" (click)="saveLead()" [disabled]="saving()">Save</button></footer>
      </aside>
    </section>
  `,
  styles: [`
    .lead-page { padding: 18px; background: #f6f8fb; color: #111827; min-height: 100vh; }
    .lead-toolbar, .hero, .filters, .mode-panel, .reports article, .drawer { background: #fff; border: 1px solid #dfe5ec; border-radius: 8px; }
    .lead-toolbar { display: flex; align-items: center; gap: 16px; padding: 14px 16px; position: relative; }
    .view-switch { display: flex; gap: 6px; }
    button, a { border: 0; border-radius: 7px; padding: 10px 14px; font-weight: 700; cursor: pointer; text-decoration: none; color: inherit; }
    .view-switch button, .lead-toolbar nav a { background: #eef4f7; }
    .active { background: #0f172a !important; color: #fff !important; }
    .lead-toolbar nav { display: flex; gap: 8px; }
    .toolbar-actions { margin-left: auto; display: flex; gap: 10px; position: relative; }
    .primary { background: #059669; color: #fff; }
    .dark { background: #242832; color: #fff; }
    .action-menu { position: absolute; right: 0; top: 46px; display: grid; gap: 4px; min-width: 180px; padding: 10px; background: #fff; border: 1px solid #d4dce5; border-radius: 8px; box-shadow: 0 16px 40px rgba(15,23,42,.16); z-index: 5; }
    .action-menu input { display: none; }
    .hero { display: grid; grid-template-columns: minmax(0, 1.1fr) minmax(320px, .9fr); gap: 24px; padding: 22px; margin-top: 16px; }
    .eyebrow { color: #64748b; font-size: 12px; text-transform: uppercase; font-weight: 800; }
    h1, h2, h3, p { margin: 0; }
    h1 { font-size: 30px; margin-top: 6px; }
    .hero p { color: #52616b; margin-top: 8px; }
    .metrics { display: grid; grid-template-columns: repeat(5, minmax(110px, 1fr)); gap: 10px; }
    .metrics article { padding: 12px; border: 1px solid #dfe5ec; border-radius: 7px; }
    .metrics small, .metrics span { display: block; color: #64748b; }
    .metrics strong { display: block; font-size: 20px; margin: 5px 0; }
    .lead-list-shell { background: #fff; border: 1px solid #dfe5ec; border-radius: 8px; padding: 16px; margin-top: 14px; }
    .attention-strip { margin-top: 14px; padding: 16px; background: #fff; border: 1px solid #dfe5ec; border-radius: 8px; display: grid; grid-template-columns: minmax(220px, .8fr) repeat(3, minmax(170px, 1fr)); gap: 12px; align-items: stretch; }
    .attention-strip p { color: #64748b; margin-top: 4px; }
    .attention-card { text-align: left; background: #fffaf0; border: 1px solid #f2cf8c; display: grid; gap: 5px; align-content: start; }
    .attention-card small, .attention-card em { color: #64748b; font-style: normal; line-height: 1.35; }
    .automation-strip { margin-top: 14px; padding: 16px; background: #fff; border: 1px solid #dfe5ec; border-radius: 8px; display: grid; gap: 12px; }
    .automation-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; }
    .automation-card { border: 1px solid #dfe5ec; border-left: 4px solid #64748b; border-radius: 8px; padding: 12px; display: grid; gap: 7px; align-content: start; min-width: 0; }
    .automation-card.urgent { border-left-color: #dc2626; }
    .automation-card.high { border-left-color: #f59e0b; }
    .automation-card.medium { border-left-color: #0ea5e9; }
    .automation-card p, .automation-card small { color: #64748b; line-height: 1.35; overflow-wrap: anywhere; }
    .list-head, .saved-filter-row, .section-title, .activity-head, .detail-topbar { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
    .list-head p, .section-title span { color: #64748b; margin-top: 4px; }
    .detail-top-actions { display: flex; gap: 10px; align-items: center; }
    .saved-filter-row { display: grid; grid-template-columns: minmax(150px, 1fr) minmax(150px, 1fr) minmax(140px, 1fr) minmax(140px, 1fr) auto minmax(180px, 1.2fr) auto; margin-top: 16px; align-items: end; }
    .outline { background: #fff; color: #0f4c81; border: 1px solid #9fc3df; }
    .mini { padding: 7px 10px; font-size: 12px; }
    .search-field { min-width: 0; }
    .filters { display: grid; grid-template-columns: repeat(5, minmax(130px, 1fr)); gap: 12px; padding: 14px; margin-top: 14px; align-items: end; }
    label span { display: block; font-weight: 700; margin-bottom: 6px; }
    input, select, textarea { width: 100%; box-sizing: border-box; border: 1px solid #d5dde6; border-radius: 7px; padding: 10px 12px; font: inherit; background: #fff; }
    .filters button, .settings-card button, .detail-actions button, .drawer footer button { background: #111827; color: #fff; }
    .mode-panel { margin-top: 14px; padding: 16px; }
    .board { display: grid; grid-template-columns: repeat(7, minmax(220px, 1fr)); gap: 12px; overflow-x: auto; }
    .stage-column { min-height: 360px; background: #f8fafc; border: 1px solid #dfe5ec; border-radius: 8px; padding: 10px; }
    .stage-column header { border-top: 5px solid #111827; display: flex; justify-content: space-between; padding: 10px 6px 12px; }
    .lead-card { width: 100%; text-align: left; display: grid; gap: 8px; background: #fff; border: 1px solid #d6dee8; margin-bottom: 10px; }
    .lead-card div { display: flex; justify-content: space-between; gap: 12px; }
    .lead-card small { color: #4b5563; }
    .amount { background: #0f172a; color: #fff; border-radius: 999px; padding: 4px 8px; width: fit-content; }
    .lead-table { border: 1px solid #dfe5ec; border-radius: 8px; overflow-x: auto; background: #fff; }
    .lead-table-row { display: grid; grid-template-columns: 42px minmax(160px, 1.2fr) minmax(170px, 1.1fr) 120px 130px 115px 110px 125px minmax(190px, 1.3fr) minmax(190px, 1.2fr) 120px 145px 90px; gap: 12px; min-width: 1760px; padding: 12px 14px; align-items: center; border-top: 1px solid #edf1f5; }
    .lead-table-row.head { border-top: 0; background: #f8fafc; color: #5d6b7c; font-size: 12px; font-weight: 800; }
    .check-cell { display: grid; place-items: center; }
    .lead-name-link { background: transparent; padding: 0; text-align: left; display: grid; gap: 3px; }
    .lead-name-link small { color: #64748b; }
    .status-pill { display: inline-flex; align-items: center; width: fit-content; min-height: 22px; padding: 2px 8px; border-radius: 999px; background: #e8f1ff; color: #245c9c; font-size: 12px; font-weight: 800; text-transform: capitalize; }
    .status-pill.hot { background: #fff2c6; color: #865c00; }
    .status-pill.won { background: #dcfce7; color: #166534; }
    .status-pill.lost { background: #fee2e2; color: #991b1b; }
    .score-pill, .attention-pill, .reason-chip, .attention-priority { display: inline-flex; align-items: center; width: fit-content; border-radius: 999px; padding: 3px 8px; font-size: 12px; font-weight: 900; text-transform: capitalize; }
    .score-pill { background: #e5f0ff; color: #1d4e89; }
    .score-pill.hot { background: #fff2c6; color: #865c00; }
    .score-pill.warm { background: #eef8f5; color: #0f766e; }
    .chip-list { display: flex; flex-wrap: wrap; gap: 5px; }
    .reason-chip.positive { background: #dcfce7; color: #166534; }
    .reason-chip.warning { background: #fee2e2; color: #991b1b; }
    .reason-chip.neutral { background: #edf2f7; color: #475569; }
    .attention-pill.urgent, .attention-priority.urgent { background: #fee2e2; color: #991b1b; }
    .attention-pill.high, .attention-priority.high { background: #fff2c6; color: #865c00; }
    .attention-pill.medium, .attention-priority.medium { background: #e0f2fe; color: #075985; }
    .attention-pill.low, .attention-priority.low, .attention-pill.none, .attention-priority.normal { background: #edf2f7; color: #475569; }
    .muted { display: block; color: #64748b; font-size: 12px; margin-top: 3px; line-height: 1.35; }
    .table-card { border: 1px solid #dfe5ec; border-radius: 8px; overflow: hidden; }
    .table-row { display: grid; grid-template-columns: 1.2fr .9fr 1.2fr 1fr 1fr .9fr .9fr .7fr .7fr; gap: 12px; padding: 14px; border-top: 1px solid #edf1f5; align-items: center; }
    .table-row.head { background: #f1f5f9; color: #52616b; text-transform: uppercase; font-size: 12px; font-weight: 800; }
    .day-band { background: #020617; color: #fff; padding: 12px; font-weight: 800; }
    .empty { padding: 18px; color: #64748b; }
    .settings-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; }
    .settings-card { border: 1px solid #dfe5ec; border-radius: 8px; padding: 16px; }
    .settings-card header, .settings-row, .detail-actions, .tabs { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
    .inline-form { display: grid; grid-template-columns: 1fr 120px 120px; gap: 10px; margin: 14px 0; }
    .settings-row { padding: 12px 0; border-top: 1px solid #edf1f5; }
    .detail-workspace { display: grid; grid-template-columns: 280px minmax(420px, 1fr) 400px; grid-template-rows: auto minmax(640px, auto); gap: 0; margin-top: 14px; background: #fff; border: 1px solid #dfe5ec; border-radius: 8px; overflow: hidden; }
    .detail-topbar { grid-column: 1 / -1; padding: 18px; border-bottom: 1px solid #edf1f5; }
    .back-link { background: transparent; padding: 0; font-size: 20px; }
    .lead-side-list { padding: 14px; border-right: 1px solid #edf1f5; background: #f8fafc; display: grid; align-content: start; gap: 10px; }
    .side-lead { display: grid; grid-template-columns: 42px minmax(0, 1fr); gap: 10px; align-items: center; text-align: left; background: #fff; border: 1px solid #dfe5ec; min-width: 0; }
    .side-lead.active { background: #eef6ff !important; color: #0f172a !important; border-color: #82b9e8; }
    .side-lead span:last-child { display: grid; min-width: 0; gap: 2px; }
    .side-lead strong, .side-lead small { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .side-lead small { color: #64748b; }
    .avatar { width: 38px; height: 38px; border-radius: 999px; display: grid; place-items: center; background: #f4d7eb; color: #6b174d; font-weight: 900; }
    .activity-panel { padding: 18px; border-right: 1px solid #edf1f5; min-width: 0; overflow: hidden; }
    .activity-head { align-items: center; }
    .activity-head select { max-width: 160px; }
    .lead-detail-panel { padding: 18px; display: grid; align-content: start; gap: 14px; background: #fff; }
    .score-card, .linked-profile, .profile-section { border: 1px solid #dfe5ec; border-radius: 8px; padding: 14px; }
    .score-card { display: flex; justify-content: space-between; align-items: center; }
    .score-card strong { color: #15803d; }
    .next-action-card { border: 1px solid #f2cf8c; background: #fffaf0; border-radius: 8px; padding: 14px; display: grid; gap: 7px; }
    .next-action-card p { color: #64748b; line-height: 1.4; }
    .attention-badges { display: flex; flex-wrap: wrap; gap: 6px; }
    .quick-actions { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px; }
    .quick-actions button { border: 1px solid #b7d6ee; color: #0f4c81; background: #f8fbff; padding: 9px 8px; }
    .detail-tabs { justify-content: start; border-bottom: 1px solid #dfe5ec; }
    .detail-tabs button { background: transparent; border-radius: 0; padding: 10px 8px; }
    .detail-tabs button.active { background: transparent !important; color: #0f4c81 !important; border-bottom: 3px solid #0f82c6; }
    .linked-profile { background: #edf7ff; display: grid; gap: 5px; }
    .action-notice { margin-top: 12px; padding: 10px 12px; background: #ecfdf5; border: 1px solid #bbf7d0; border-radius: 8px; color: #166534; font-weight: 700; }
    .business-link-card { display: grid; gap: 12px; }
    .business-link-card .section-title { align-items: center; }
    .match-list, .business-actions { display: flex; flex-wrap: wrap; gap: 8px; }
    .match-list button { background: #f0f9ff; border: 1px solid #bae6fd; color: #0c4a6e; text-align: left; display: grid; gap: 2px; }
    .match-list small { color: #64748b; }
    .business-actions button { background: #f8fafc; border: 1px solid #d5dde6; color: #0f172a; padding: 8px 10px; }
    .profile-section dl { display: grid; grid-template-columns: 110px minmax(0, 1fr); gap: 9px 12px; margin: 12px 0 0; }
    .score-breakdown p { display: flex; justify-content: space-between; gap: 10px; padding: 7px 0; border-top: 1px solid #edf1f5; color: #475569; }
    .score-breakdown p:first-of-type { border-top: 0; }
    .quality-list p { display: grid; gap: 3px; padding: 8px 0; border-top: 1px solid #edf1f5; }
    .quality-list p:first-of-type { border-top: 0; }
    .quality-list p.positive strong { color: #166534; }
    .quality-list p.warning strong { color: #991b1b; }
    .quality-list p.neutral strong { color: #475569; }
    .quality-list span { color: #64748b; overflow-wrap: anywhere; }
    .profile-section dt { color: #64748b; font-weight: 800; }
    .profile-section dd { margin: 0; overflow-wrap: anywhere; }
    .user-card, .timeline-card { background: #fff; border: 1px solid #dfe5ec; border-radius: 8px; padding: 22px; }
    .user-card p { margin-top: 12px; }
    .timeline-card textarea { margin: 14px 0; min-height: 120px; }
    .right { justify-content: flex-end; }
    .timeline article { border-left: 4px solid #0ea5e9; padding: 12px 16px; margin-top: 12px; background: #f8fafc; }
    .timeline.modern { display: grid; grid-template-columns: minmax(0, 1fr); gap: 12px; margin-top: 14px; }
    .timeline.modern .timeline-item { width: 100%; min-width: 0; box-sizing: border-box; display: grid; grid-template-columns: 34px minmax(0, 1fr) max-content; gap: 12px; align-items: start; border-left: 4px solid #cbd5e1; border-bottom: 1px solid #edf1f5; border-radius: 8px; background: #fff; }
    .timeline.modern .timeline-item.whatsapp { border-left-color: #16a34a; }
    .timeline.modern .timeline-item.call { border-left-color: #0ea5e9; }
    .timeline.modern .timeline-item.email { border-left-color: #7c3aed; }
    .timeline.modern .timeline-item.follow { border-left-color: #f59e0b; }
    .timeline.modern .timeline-item.ai { border-left-color: #db2777; }
    .timeline.modern .timeline-item.system { border-left-color: #64748b; }
    .timeline.modern article div { min-width: 0; display: grid; gap: 5px; }
    .timeline.modern article strong, .timeline.modern article p, .timeline-sub { overflow-wrap: anywhere; }
    .timeline.modern time { float: none; justify-self: end; max-width: 170px; white-space: normal; text-align: right; color: #64748b; }
    .timeline-meta { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; }
    .timeline-meta small { width: fit-content; border-radius: 999px; padding: 2px 7px; background: #edf2f7; color: #475569; font-weight: 800; text-transform: capitalize; }
    .timeline-sub { color: #64748b; }
    .timeline-icon { width: 24px; height: 24px; border-radius: 999px; display: grid; place-items: center; background: #eef6ff; color: #0f4c81; }
    .timeline time { float: right; color: #64748b; }
    .task-list { display: grid; gap: 10px; margin-top: 12px; }
    .task-list article { border: 1px solid #dfe5ec; border-radius: 8px; padding: 10px; background: #f8fafc; }
    .task-list span { display: block; color: #64748b; margin-top: 4px; }
    .compact { padding: 8px 0 0; }
    .reports { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; margin-top: 14px; }
    .reports article { padding: 16px; }
    .reports p { display: flex; justify-content: space-between; margin-top: 10px; color: #52616b; }
    .report-dashboard { grid-template-columns: 1fr; }
    .report-header { display: flex; align-items: center; justify-content: space-between; gap: 12px; background: #fff; border: 1px solid #dfe5ec; border-radius: 8px; padding: 16px; }
    .report-kpis { display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)); gap: 10px; }
    .report-kpis article { background: #fff; border: 1px solid #dfe5ec; border-radius: 8px; padding: 14px; min-width: 0; }
    .report-kpis small, .report-kpis span { display: block; color: #64748b; }
    .report-kpis strong { display: block; font-size: 22px; margin: 4px 0; overflow-wrap: anywhere; }
    .report-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; align-items: start; }
    .report-grid article { background: #fff; border: 1px solid #dfe5ec; border-radius: 8px; padding: 16px; min-width: 0; }
    .report-row { display: grid; grid-template-columns: minmax(110px, 1.3fr) repeat(3, minmax(68px, .7fr)); gap: 10px; align-items: center; padding: 10px 0; border-top: 1px solid #edf1f5; color: #475569; }
    .report-row.head { border-top: 0; color: #64748b; font-size: 12px; font-weight: 900; text-transform: uppercase; }
    .report-row strong, .report-row span { min-width: 0; overflow-wrap: anywhere; }
    .recommendations { display: grid; gap: 10px; }
    .recommendation-card { border: 1px solid #dfe5ec; border-left: 4px solid #64748b; border-radius: 8px; padding: 12px; display: grid; gap: 5px; }
    .recommendation-card span { width: fit-content; border-radius: 999px; padding: 2px 8px; background: #edf2f7; color: #475569; font-size: 12px; font-weight: 900; text-transform: uppercase; }
    .recommendation-card p, .recommendation-card small { color: #64748b; line-height: 1.35; }
    .recommendation-card.urgent { border-left-color: #dc2626; }
    .recommendation-card.high { border-left-color: #f59e0b; }
    .recommendation-card.medium { border-left-color: #0ea5e9; }
    .recommendation-card.low { border-left-color: #16a34a; }
    .drawer { position: fixed; right: 0; top: 0; width: min(720px, 96vw); height: 100vh; z-index: 20; box-shadow: -20px 0 50px rgba(15,23,42,.25); overflow: auto; }
    .drawer header { display: flex; align-items: center; gap: 12px; padding: 22px; border-bottom: 1px solid #e5e7eb; }
    .drawer header button { font-size: 30px; background: transparent; padding: 0; }
    .drawer-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; padding: 22px; }
    .drawer-grid textarea { grid-column: 1 / -1; }
    .drawer footer { padding: 18px 22px; border-top: 1px solid #e5e7eb; text-align: right; }
    @media (max-width: 1000px) {
      .hero, .settings-grid, .reports, .detail-workspace, .report-kpis, .report-grid { grid-template-columns: 1fr; }
      .detail-topbar { grid-column: 1; }
      .lead-side-list, .activity-panel { border-right: 0; border-bottom: 1px solid #edf1f5; }
      .filters, .metrics, .drawer-grid, .saved-filter-row { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .attention-strip, .automation-grid { grid-template-columns: 1fr; }
      .lead-toolbar { flex-wrap: wrap; }
      .toolbar-actions { margin-left: 0; width: 100%; }
    }
  `]
})
export class LeadManagementCommandCenterComponent implements OnInit {
  readonly mode = signal<'board' | 'follow-up' | 'settings' | 'detail'>('board');
  readonly viewMode = signal<'board' | 'list'>('list');
  readonly drawerOpen = signal(false);
  readonly actionOpen = signal(false);
  readonly advancedFiltersOpen = signal(false);
  readonly saving = signal(false);
  readonly overview = signal<ApiRecord | null>(null);
  readonly detail = signal<ApiRecord | null>(null);
  readonly report = signal<ApiRecord | null>(null);
  readonly detailTab = signal<'details' | 'notes' | 'tasks' | 'other'>('details');

  readonly stages = computed(() => (this.overview()?.['stages'] as ApiRecord[] | undefined) || (this.detail()?.['stages'] as ApiRecord[] | undefined) || []);
  readonly types = computed(() => (this.overview()?.['types'] as ApiRecord[] | undefined) || (this.detail()?.['types'] as ApiRecord[] | undefined) || []);
  readonly rows = computed(() => (this.overview()?.['rows'] as ApiRecord[] | undefined) || []);
  readonly columns = computed(() => (this.overview()?.['columns'] as ApiRecord[] | undefined) || []);
  readonly followUps = computed(() => (this.overview()?.['followUps'] as ApiRecord[] | undefined) || []);
  readonly cards = computed(() => (this.overview()?.['cards'] as ApiRecord[] | undefined) || []);
  readonly automationQueue = computed(() => (this.overview()?.['automationQueue'] as ApiRecord[] | undefined) || []);
  readonly automationSummary = computed(() => (this.overview()?.['automationSummary'] as ApiRecord | undefined) || {});

  filters: ApiRecord = { from: '', to: '', stageId: '', assignedTo: '', q: '', status: '', priority: '', savedView: '' };
  form: ApiRecord = { currency: 'INR' };
  stageForm: ApiRecord = { name: '', sortOrder: 100, active: true };
  typeForm: ApiRecord = { name: '', active: true };
  noteText = '';
  leadId = '';
  activityFilter = '';
  sideSearch = '';
  actionNotice = '';

  constructor(private readonly api: ApiService, private readonly route: ActivatedRoute, private readonly router: Router) {}

  ngOnInit(): void {
    this.route.paramMap.subscribe((params) => {
      this.leadId = params.get('id') || '';
      this.actionNotice = '';
      this.syncMode();
      this.load();
    });
  }

  syncMode(): void {
    const url = this.router.url;
    if (url.startsWith('/leads/follow-up')) this.mode.set('follow-up');
    else if (url.startsWith('/leads/settings')) this.mode.set('settings');
    else if (this.leadId) this.mode.set('detail');
    else this.mode.set('board');
  }

  load(): void {
    this.syncMode();
    if (this.mode() === 'detail' && this.leadId) {
      this.api.list<ApiRecord>(`leads/${this.leadId}`).subscribe((data) => this.detail.set(data));
      if (!this.overview()) this.loadOverview();
      return;
    }
    this.loadOverview();
  }

  loadOverview(): void {
    this.api.list<ApiRecord>('leads/overview', this.filters).subscribe((data) => {
      this.overview.set(data);
      this.report.set(data['reports'] || null);
    });
  }

  loadAutomationQueue(): void {
    this.api.list<ApiRecord>('leads/automation/queue', this.filters).subscribe((data) => {
      const current = this.overview() || {};
      this.overview.set({ ...current, automationQueue: data['queue'] || [], automationSummary: data['summary'] || {} });
      this.actionNotice = data['summary'] ? 'Automation queue refreshed.' : '';
    });
  }

  runAutomationItem(item: ApiRecord = {}): void {
    const payload: ApiRecord = { leadId: item['leadId'], type: item['type'], limit: 1, query: this.filters };
    if (item['action'] === 'assign_owner') {
      const assignedTo = window.prompt('Assign lead to staff/user id', String(item['assignedTo'] || ''));
      if (!assignedTo) return;
      payload['assignedTo'] = assignedTo;
    }
    this.api.post<ApiRecord>('leads/automation/run', payload).subscribe({
      next: (data) => {
        this.actionNotice = `Automation processed ${data['processed'] || 0} action(s).`;
        this.loadOverview();
      },
      error: (error) => this.actionNotice = error?.error?.error || error?.message || 'Unable to run automation.'
    });
  }

  runAutomationBatch(): void {
    this.api.post<ApiRecord>('leads/automation/run', { limit: 10, query: this.filters }).subscribe({
      next: (data) => {
        this.actionNotice = `Automation processed ${data['processed'] || 0} action(s).`;
        this.loadOverview();
      },
      error: (error) => this.actionNotice = error?.error?.error || error?.message || 'Unable to run automation.'
    });
  }

  filteredRows(): ApiRecord[] {
    let rows = [...this.rows()];
    const status = String(this.filters['status'] || '');
    const priority = String(this.filters['priority'] || '');
    const savedView = String(this.filters['savedView'] || '');
    if (status) rows = rows.filter((row) => String(row['status'] || '') === status);
    if (priority) rows = rows.filter((row) => String(row['leadTemperature'] || '') === priority);
    if (savedView === 'hot') rows = rows.filter((row) => String(row['leadTemperature'] || '') === 'hot');
    if (savedView === 'attention') rows = rows.filter((row) => Boolean(row['needsAttention']));
    if (savedView === 'won') rows = rows.filter((row) => String(row['status'] || '') === 'won');
    if (savedView === 'overdue') rows = rows.filter((row) => ['overdue', 'missed'].includes(String(row['slaStatus'] || '').toLowerCase()));
    return rows;
  }

  attentionRows(): ApiRecord[] {
    const backendRows = (this.overview()?.['managerAttention'] as ApiRecord[] | undefined) || [];
    if (backendRows.length) return backendRows;
    return this.rows().filter((row) => Boolean(row['needsAttention'])).slice(0, 12);
  }

  scoreBreakdown(lead: ApiRecord = {}): ApiRecord[] {
    return ((lead['scoreBreakdown'] || []) as ApiRecord[]).slice(0, 8);
  }

  topReasons(lead: ApiRecord = {}): ApiRecord[] {
    return this.scoreBreakdown(lead).filter((reason) => Number(reason['value'] || 0) !== 0).slice(0, 3);
  }

  qualitySignals(lead: ApiRecord = {}): ApiRecord[] {
    return ((lead['qualitySignals'] || []) as ApiRecord[]).slice(0, 6);
  }

  managerAttention(lead: ApiRecord = {}): ApiRecord[] {
    return ((lead['managerAttention'] || []) as ApiRecord[]).slice(0, 5);
  }

  nextBestAction(lead: ApiRecord = {}): ApiRecord {
    return (lead['nextBestAction'] || {}) as ApiRecord;
  }

  attentionSummary(lead: ApiRecord = {}): string {
    const items = this.managerAttention(lead).map((item) => item['label']).filter(Boolean);
    return items.length ? items.join(', ') : 'Review this lead';
  }

  trackLead(index: number, lead: ApiRecord): string {
    return String(lead['id'] || index);
  }

  recentNote(lead: ApiRecord = {}): string {
    return String(lead['notes'] || lead['lostReason'] || lead['slaStatus'] || lead['leadTemperature'] || '-');
  }

  money(value: unknown): string {
    return `₹${Math.round(Number(value || 0)).toLocaleString('en-IN')}`;
  }

  reportList(report: ApiRecord | null, key: string): ApiRecord[] {
    return ((report?.[key] || []) as ApiRecord[]).slice(0, 8);
  }

  businessLinks(item: ApiRecord = {}): ApiRecord {
    return (item['businessLinks'] || {}) as ApiRecord;
  }

  clientMatches(item: ApiRecord = this.detail() || {}): ApiRecord[] {
    const links = this.businessLinks(item);
    const matches = (links['clientMatches'] || item['clientMatch']?.matches || []) as ApiRecord[];
    return matches.slice(0, 4);
  }

  initials(value: unknown): string {
    return String(value || 'Lead')
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part.charAt(0).toUpperCase())
      .join('') || 'LD';
  }

  sideList(currentLead: ApiRecord = {}): ApiRecord[] {
    const query = this.sideSearch.trim().toLowerCase();
    const rows = this.rows().length ? this.rows() : [currentLead];
    return rows
      .filter((row) => row && row['id'])
      .filter((row) => {
        const haystack = `${row['customerName'] || ''} ${row['title'] || ''} ${row['phone'] || ''} ${row['email'] || ''}`.toLowerCase();
        return !query || haystack.includes(query);
      })
      .slice(0, 12);
  }

  activityRows(item: ApiRecord = {}): ApiRecord[] {
    const timeline = ((item['communicationTimeline'] || []) as ApiRecord[]).map((event) => ({
      kind: event['kind'] || 'System',
      channel: event['channel'] || 'system',
      icon: event['icon'] || '•',
      title: event['title'] || 'Lead event',
      body: event['body'] || 'Lead activity recorded.',
      status: event['status'] || 'recorded',
      dueAt: event['dueAt'] || '',
      createdAt: event['createdAt'] || item['lead']?.createdAt
    }));
    if (timeline.length) return this.filterActivityRows(timeline);
    const events = ((item['events'] || []) as ApiRecord[]).map((event) => ({
      kind: 'System',
      channel: 'system',
      icon: '•',
      title: event['label'] || event['eventType'] || 'Lead event',
      body: event['description'] || event['note'] || 'Lead activity recorded.',
      status: event['status'] || 'recorded',
      createdAt: event['createdAt'] || item['lead']?.createdAt
    }));
    const notes = ((item['notes'] || []) as ApiRecord[]).map((note) => ({
      kind: 'Note',
      channel: 'note',
      icon: 'N',
      title: note['createdBy'] || 'Note added',
      body: note['note'] || '',
      status: note['noteType'] || 'recorded',
      createdAt: note['createdAt']
    }));
    const followUps = ((item['followUps'] || []) as ApiRecord[]).map((followUp) => ({
      kind: 'Follow-up',
      channel: 'follow',
      icon: 'F',
      title: followUp['status'] || 'Follow-up scheduled',
      body: followUp['note'] || 'Manual follow-up',
      status: followUp['status'] || 'pending',
      dueAt: followUp['dueAt'] || '',
      createdAt: followUp['dueAt'] || followUp['createdAt']
    }));
    const rows = [...events, ...notes, ...followUps].sort((a, b) => Date.parse(String(b['createdAt'] || '')) - Date.parse(String(a['createdAt'] || '')));
    return this.filterActivityRows(rows);
  }

  filterActivityRows(rows: ApiRecord[]): ApiRecord[] {
    const filter = this.activityFilter;
    if (filter) return rows.filter((row) => String(row['channel'] || '').toLowerCase() === filter);
    return rows;
  }

  openLeadDrawer(lead: ApiRecord = {}): void {
    this.form = { currency: 'INR', ...lead, quotedAmount: lead['quotedAmount'] || 0 };
    this.drawerOpen.set(true);
  }

  saveLead(): void {
    this.saving.set(true);
    const request = this.form.id
      ? this.api.patch<ApiRecord>(`leads/${this.form.id}`, this.form)
      : this.api.create<ApiRecord>('leads', this.form);
    request.pipe(finalize(() => this.saving.set(false))).subscribe({
      next: () => {
        this.drawerOpen.set(false);
        this.form = { currency: 'INR' };
        this.load();
      }
    });
  }

  openDetail(id: string): void {
    this.router.navigate(['/leads', id]);
  }

  callLead(lead: ApiRecord = {}): void {
    const phone = String(lead['phone'] || '').replace(/\D/g, '');
    if (!phone) {
      this.actionNotice = 'Phone number missing for this lead.';
      return;
    }
    window.location.href = `tel:${phone}`;
    const id = String(lead['id'] || this.leadId || '');
    if (!id) return;
    this.api.post(`leads/${id}/call-log`, { phone, status: 'attempted', note: `Call attempted: ${phone}` }).subscribe(() => {
      this.actionNotice = 'Call attempt logged.';
      this.load();
    });
  }

  emailLead(lead: ApiRecord = {}): void {
    const email = String(lead['email'] || '');
    if (!email) {
      this.actionNotice = 'Email missing for this lead.';
      return;
    }
    const subject = `Follow-up for ${lead['title'] || 'lead inquiry'}`;
    window.location.href = `mailto:${email}?subject=${encodeURIComponent(subject)}`;
    const id = String(lead['id'] || this.leadId || '');
    if (!id) return;
    this.api.post(`leads/${id}/email-log`, { email, subject, status: 'opened', note: `Email opened: ${subject} (${email})` }).subscribe(() => {
      this.actionNotice = 'Email action logged.';
      this.load();
    });
  }

  openPurchaseHistory(lead: ApiRecord = {}): void {
    const query = String(lead['phone'] || lead['email'] || lead['customerName'] || '').trim();
    if (query) window.open(`/pos/invoices?q=${encodeURIComponent(query)}`, '_blank', 'noopener,noreferrer');
  }

  linkExistingClient(clientId = ''): void {
    if (!this.leadId) return;
    const selected = clientId || window.prompt('Client ID to link', String(this.detail()?.['businessLinks']?.clientMatches?.[0]?.id || this.detail()?.['lead']?.clientId || ''));
    if (!selected) return;
    this.api.post(`leads/${this.leadId}/client/link`, { clientId: selected }).subscribe({
      next: (data) => {
        this.detail.set(data || null);
        this.actionNotice = 'Client linked to lead.';
        this.loadOverview();
      },
      error: (error) => this.actionNotice = error?.error?.error || error?.message || 'Unable to link client.'
    });
  }

  createClientFromLead(): void {
    if (!this.leadId) return;
    this.api.post(`leads/${this.leadId}/client/create`, {}).subscribe({
      next: (data) => {
        this.detail.set(data || null);
        this.actionNotice = 'Client created and linked.';
        this.loadOverview();
      },
      error: (error) => this.actionNotice = error?.error?.error || error?.message || 'Unable to create client.'
    });
  }

  bookAppointmentFromLead(lead: ApiRecord = {}): void {
    if (!this.leadId) return;
    const defaultStart = new Date(Date.now() + 60 * 60000).toISOString().slice(0, 16);
    const startAt = window.prompt('Appointment date/time', defaultStart);
    if (!startAt) return;
    const staffId = window.prompt('Staff ID', String(lead['assignedTo'] || '')) || '';
    this.api.post(`leads/${this.leadId}/appointment/book`, { startAt, staffId, serviceId: lead['typeId'] || '', notes: `Booked from lead: ${lead['title'] || lead['customerName'] || this.leadId}` }).subscribe({
      next: (data) => {
        this.detail.set(data || null);
        this.actionNotice = 'Appointment booked and linked.';
        this.loadOverview();
      },
      error: (error) => this.actionNotice = error?.error?.error || error?.message || 'Unable to book appointment.'
    });
  }

  linkInvoiceToLead(): void {
    if (!this.leadId) return;
    const invoiceId = window.prompt('Invoice ID or number', String(this.detail()?.['lead']?.invoiceId || ''));
    if (!invoiceId) return;
    this.api.post(`leads/${this.leadId}/invoice/link`, { invoiceId }).subscribe({
      next: (data) => {
        this.detail.set(data || null);
        this.actionNotice = 'Invoice linked and revenue attributed.';
        this.loadOverview();
      },
      error: (error) => this.actionNotice = error?.error?.error || error?.message || 'Unable to link invoice.'
    });
  }

  openLinkedClient(item: ApiRecord = this.detail() || {}): void {
    const id = String(this.businessLinks(item)?.client?.id || item['lead']?.clientId || '');
    if (id) window.open(`/clients?clientId=${encodeURIComponent(id)}`, '_blank', 'noopener,noreferrer');
  }

  openLinkedAppointment(item: ApiRecord = this.detail() || {}): void {
    const id = String(this.businessLinks(item)?.appointment?.id || item['lead']?.appointmentId || '');
    if (id) window.open(`/appointments?appointmentId=${encodeURIComponent(id)}`, '_blank', 'noopener,noreferrer');
  }

  openLinkedInvoice(item: ApiRecord = this.detail() || {}): void {
    const invoice = String(this.businessLinks(item)?.invoice?.invoiceNumber || item['lead']?.invoiceId || '');
    if (invoice) window.open(`/pos/invoices?q=${encodeURIComponent(invoice)}`, '_blank', 'noopener,noreferrer');
  }

  aiCallLead(lead: ApiRecord = {}): void {
    const name = String(lead['customerName'] || lead['title'] || 'this lead');
    const script = `AI call planned for ${name}. Opening line: Hi ${name}, this is Aura Shine. I saw your inquiry and wanted to help you book the right service.`;
    this.noteText = script;
    if (!this.leadId) return;
    this.api.post(`leads/${this.leadId}/notes`, { note: script, noteType: 'ai_call_script' }).subscribe(() => {
      this.api.post(`leads/${this.leadId}/whatsapp/draft`, { body: script }).subscribe(() => {
        this.actionNotice = 'AI call script saved and WhatsApp draft created.';
        this.noteText = '';
        this.load();
      });
    });
  }

  addNote(): void {
    if (!this.leadId || !this.noteText.trim()) return;
    this.api.post(`leads/${this.leadId}/notes`, { note: this.noteText }).subscribe(() => {
      this.actionNotice = 'Note saved to communication timeline.';
      this.noteText = '';
      this.load();
    });
  }

  addFollowUp(): void {
    const dueAt = window.prompt('Follow-up date/time', new Date().toISOString().slice(0, 16));
    if (!dueAt || !this.leadId) return;
    this.api.post(`leads/${this.leadId}/follow-ups`, { dueAt, note: 'Manual follow-up' }).subscribe(() => {
      this.actionNotice = 'Follow-up added to communication timeline.';
      this.load();
    });
  }

  completeFollowUp(followUp: ApiRecord = {}): void {
    const leadId = String(followUp['leadId'] || this.leadId || '');
    const followUpId = String(followUp['id'] || '');
    if (!leadId || !followUpId) return;
    this.api.post(`leads/${leadId}/follow-ups/${followUpId}/done`, { note: 'Completed from Lead Management' }).subscribe({
      next: () => {
        this.actionNotice = 'Follow-up marked done.';
        this.load();
      },
      error: (error) => this.actionNotice = error?.error?.error || error?.message || 'Unable to complete follow-up.'
    });
  }

  assignLeadOwner(lead: ApiRecord = {}): void {
    const leadId = String(lead['id'] || this.leadId || '');
    const assignedTo = window.prompt('Assign lead to staff/user id', String(lead['assignedTo'] || ''));
    if (!leadId || !assignedTo) return;
    this.api.post(`leads/${leadId}/assign`, { assignedTo, note: 'Assigned from Lead Management' }).subscribe({
      next: () => {
        this.actionNotice = 'Lead assigned.';
        this.load();
      },
      error: (error) => this.actionNotice = error?.error?.error || error?.message || 'Unable to assign lead.'
    });
  }

  escalateLead(): void {
    if (!this.leadId) return;
    const note = window.prompt('Escalation note', 'Manager review required for this lead.');
    if (!note) return;
    this.api.post(`leads/${this.leadId}/escalate`, { note }).subscribe({
      next: () => {
        this.actionNotice = 'Lead escalated to manager queue.';
        this.load();
      },
      error: (error) => this.actionNotice = error?.error?.error || error?.message || 'Unable to escalate lead.'
    });
  }

  createWinBack(): void {
    if (!this.leadId) return;
    const dueAt = window.prompt('Win-back follow-up date/time', new Date(Date.now() + 72 * 3600000).toISOString().slice(0, 16));
    if (!dueAt) return;
    this.api.post(`leads/${this.leadId}/win-back`, { dueAt }).subscribe({
      next: () => {
        this.actionNotice = 'Win-back follow-up created.';
        this.load();
      },
      error: (error) => this.actionNotice = error?.error?.error || error?.message || 'Unable to create win-back.'
    });
  }

  markWon(): void {
    const convertedAmount = window.prompt('Converted amount', String(this.detail()?.['lead']?.quotedAmount || 0));
    if (convertedAmount === null || !this.leadId) return;
    this.api.post(`leads/${this.leadId}/mark-won`, { convertedAmount, note: 'Marked won from Lead Management' }).subscribe(() => this.load());
  }

  markLost(): void {
    const reason = window.prompt('Lost reason', '');
    if (!reason || !this.leadId) return;
    this.api.post(`leads/${this.leadId}/mark-lost`, { lostReason: reason }).subscribe(() => this.load());
  }

  draftWhatsapp(): void {
    if (!this.leadId) return;
    const body = this.noteText || this.defaultMessageBody();
    this.api.post(`leads/${this.leadId}/whatsapp/draft`, { body }).subscribe(() => {
      this.actionNotice = 'WhatsApp draft created.';
      this.load();
    });
  }

  sendWhatsapp(): void {
    if (!this.leadId) return;
    const body = this.noteText || window.prompt('WhatsApp message', this.defaultMessageBody()) || '';
    if (!body) return;
    this.api.post(`leads/${this.leadId}/whatsapp/send`, { body }).subscribe(() => {
      this.actionNotice = 'WhatsApp message action completed.';
      this.load();
    });
  }

  defaultMessageBody(): string {
    const lead = (this.detail()?.['lead'] || {}) as ApiRecord;
    const name = String(lead['customerName'] || lead['title'] || 'there');
    return `Hi ${name}, thank you for your inquiry. Our team will help you with the right service and appointment slot.`;
  }

  editStage(stage: ApiRecord): void {
    this.stageForm = { ...stage };
  }

  saveStage(): void {
    this.api.post('leads/stages', this.stageForm).subscribe(() => {
      this.stageForm = { name: '', sortOrder: 100, active: true };
      this.load();
    });
  }

  editType(type: ApiRecord): void {
    this.typeForm = { ...type };
  }

  saveType(): void {
    this.api.post('leads/types', this.typeForm).subscribe(() => {
      this.typeForm = { name: '', active: true };
      this.load();
    });
  }

  downloadSample(): void {
    window.open(`${environment.apiBaseUrl}/leads/import/sample`, '_blank');
  }

  importCsv(event: Event): void {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      this.api.post('leads/import', { fileName: file.name, csv: String(reader.result || '') }).subscribe(() => this.load());
    };
    reader.readAsText(file);
  }
}
