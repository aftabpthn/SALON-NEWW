import { CommonModule } from '@angular/common';
import { Component, OnInit, computed, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { finalize, forkJoin } from 'rxjs';
import { ApiRecord, ApiService } from '../core/api.service';
import { StateComponent } from '../shared/ui/state/state.component';
import { environment } from '../../environments/environment';
import { AuraDatePipe } from '../shared/pipes/aura-date.pipe';

type ChannelFilter = 'all' | 'whatsapp' | 'sms' | 'email' | 'call' | 'review' | 'appointment' | 'system_alert';
type ComposerMode = 'reply' | 'note';

interface EngagementThread extends ApiRecord {
  id: string;
  type?: string;
  primaryChannel?: string;
  subject?: string;
  displayName?: string;
  phone?: string;
  email?: string;
  status?: string;
  priority?: string;
  riskLevel?: string;
  slaStatus?: string;
  unreadCount?: number;
  lastMessageAt?: string;
  lastMessagePreview?: string;
  assignedTo?: string;
  clientId?: string;
  appointmentId?: string;
  membershipId?: string;
  packageId?: string;
  tags?: string[];
  metadata?: ApiRecord;
}

interface EngagementMessage extends ApiRecord {
  id: string;
  threadId?: string;
  channel?: string;
  direction?: string;
  eventType?: string;
  body?: string;
  bodyPreview?: string;
  status?: string;
  deliveryStatus?: string;
  approvalStatus?: string;
  failureReason?: string;
  senderRole?: string;
  createdAt?: string;
  sentAt?: string;
}

interface EngagementDetail extends ApiRecord {
  thread?: EngagementThread;
  messages?: EngagementMessage[];
  drafts?: ApiRecord[];
  assignments?: ApiRecord[];
  slaEvents?: ApiRecord[];
  auditTrail?: ApiRecord[];
}

@Component({
  selector: 'app-engagement-command-center',
  standalone: true,
  imports: [AuraDatePipe, CommonModule, FormsModule, StateComponent],
  template: `
    <section class="engagement-page zenoti-engagement-page">
      <div class="zenoti-page-heading">
        <div>
          <h1>Engagement Command Center</h1>
        </div>
        <label class="zenoti-search">
          <span>Search engagement</span>
          <input [(ngModel)]="query" (ngModelChange)="filterThreads()" placeholder="Client name, mobile, subject" />
        </label>
      </div>

      <div class="zenoti-shortcuts">
        <button type="button" [class.active]="activeWorkspace() === 'inbox'" (click)="openInboxWorkspace()" [disabled]="loading()">Inbox</button>
        <button type="button" [class.active]="activeWorkspace() === 'leads'" (click)="openLeadIntelligence()" [disabled]="leadLoading()">Lead Intelligence</button>
        <button type="button" (click)="openRecoveryDrawer()" [disabled]="loading()">Recovery board</button>
        <button type="button" (click)="openReviewDrawer()" [disabled]="loading()">Review center</button>
        <button type="button" (click)="openRiskDrawer()" [disabled]="loading()">Risk signals</button>
        <button type="button" (click)="openSlaDrawer()" [disabled]="loading()">SLA board</button>
        <button type="button" (click)="openReportsDrawer()" [disabled]="loading()">Reports</button>
        <button type="button" (click)="openProviderDrawer()" [disabled]="loading()">Providers</button>
      </div>

      <app-state [loading]="loading()" [error]="error()"></app-state>

      <div class="state error" *ngIf="providerWarning()">
        {{ providerWarning() }}
        <button class="ghost-button mini" type="button" (click)="providerWarning.set('')">Dismiss</button>
      </div>

      <div class="state info" *ngIf="pendingApprovalCount() > 0">
        {{ pendingApprovalCount() }} draft{{ pendingApprovalCount() === 1 ? '' : 's' }} pending approval.
      </div>

      <section class="lead-intelligence-panel" *ngIf="activeWorkspace() === 'leads'">
        <div class="section-title-row">
          <div>
            <h3>Lead Intelligence</h3>
          </div>
          <div class="reports-actions">
            <button class="ghost-button" type="button" (click)="loadLeadReport()" [disabled]="leadLoading()">Refresh</button>
            <button class="ghost-button" type="button" (click)="exportLeadCsv()" [disabled]="!leadRows().length">Lead CSV</button>
          </div>
        </div>

        <section class="reports-toolbar">
          <label>
            <span>From date</span>
            <input type="date" [(ngModel)]="leadFromDate" />
          </label>
          <label>
            <span>To date</span>
            <input type="date" [(ngModel)]="leadToDate" />
          </label>
          <label>
            <span>Source</span>
            <select [(ngModel)]="leadSourceFilter">
              <option value="">All sources</option>
              <option value="WhatsApp">WhatsApp</option>
              <option value="Instagram">Instagram</option>
              <option value="Website">Website</option>
              <option value="Google Call">Google Call</option>
              <option value="Walk-in">Walk-in</option>
              <option value="Referral">Referral</option>
            </select>
          </label>
          <label>
            <span>Status</span>
            <select [(ngModel)]="leadStatusFilter">
              <option value="">All status</option>
              <option value="new">New</option>
              <option value="open">Open</option>
              <option value="pending">Pending</option>
              <option value="follow_up">Follow-up</option>
              <option value="won">Won</option>
              <option value="lost">Lost</option>
            </select>
          </label>
          <label>
            <span>Lead score</span>
            <select [(ngModel)]="leadScoreFilter">
              <option value="">All scores</option>
              <option value="hot">Hot</option>
              <option value="warm">Warm</option>
              <option value="cold">Cold</option>
            </select>
          </label>
          <label>
            <span>Follow-up due</span>
            <select [(ngModel)]="leadFollowUpFilter">
              <option value="">All follow-ups</option>
              <option value="today">Today</option>
              <option value="overdue">Overdue</option>
              <option value="upcoming">Upcoming</option>
            </select>
          </label>
          <label>
            <span>Owner</span>
            <input [(ngModel)]="leadAssignedFilter" placeholder="Staff/user id" />
          </label>
          <label>
            <span>Service interest</span>
            <input [(ngModel)]="leadServiceFilter" placeholder="Hair, facial, bridal" />
          </label>
          <label>
            <span>Branch</span>
            <input [(ngModel)]="leadBranchFilter" placeholder="Current branch or branch id" />
          </label>
          <label>
            <span>Search</span>
            <input [(ngModel)]="leadSearch" placeholder="Name, phone, source, invoice" />
          </label>
          <div class="reports-actions">
            <button class="primary-button" type="button" (click)="loadLeadReport()" [disabled]="leadLoading()">Run Report</button>
          </div>
        </section>

        <app-state [loading]="leadLoading()" [error]="leadError()"></app-state>
        <div class="state info" *ngIf="leadNotice()">{{ leadNotice() }}</div>

        <section class="reports-kpis" *ngIf="leadReport() as report">
          <article><strong>{{ report.summary?.totalLeads || 0 }}</strong></article>
          <article><strong>{{ report.summary?.hotLeads || 0 }}</strong></article>
          <article><strong>{{ report.summary?.pendingFollowUps || 0 }}</strong></article>
          <article><strong>{{ report.summary?.wonLeads || 0 }}</strong></article>
          <article><strong>{{ report.summary?.lostLeads || 0 }}</strong></article>
          <article><strong>{{ report.summary?.conversionRate || 0 }}%</strong></article>
          <article><strong>{{ reportCurrency(report.summary?.revenueFromLeads) }}</strong></article>
          <article><strong>{{ minutesLabel(report.summary?.averageResponseMinutes) }}</strong></article>
          <article><strong>{{ report.summary?.overdueFollowUps || 0 }}</strong></article>
          <article><strong>{{ report.summary?.topLeadSource || '-' }}</strong></article>
        </section>

        <section class="lead-table-wrap">
          <div class="lead-table-head">
            <span>Lead date</span>
            <span>Source</span>
            <span>Client</span>
            <span>Phone</span>
            <span>Interest</span>
            <span>Score</span>
            <span>Status</span>
            <span>Owner</span>
            <span>Response</span>
            <span>Follow-up</span>
            <span>Won invoice</span>
            <span>Revenue</span>
            <span>Lost reason</span>
            <span>Actions</span>
          </div>
          <article class="lead-table-row" *ngFor="let row of leadRows()">
            <span>{{ row.leadDateTime | auraDate:'date' }}</span>
            <strong>{{ row.source || 'Unknown' }}</strong>
            <span>{{ row.clientName || 'Lead' }}</span>
            <span>{{ row.phone || '-' }}</span>
            <span>{{ row.interestService || 'Not captured' }}</span>
            <span [class]="'risk-pill ' + leadScoreTone(row)">{{ row.leadTemperature || 'cold' }} · {{ row.leadScore || 0 }}</span>
            <span class="badge">{{ row.status || 'pending' }}</span>
            <span>{{ row.assignedName || row.assignedTo || 'Unassigned' }}</span>
            <span>{{ minutesLabel(row.firstResponseMinutes) }}</span>
            <span>{{ row.followUpStatus || 'upcoming' }}<br /><small>{{ row.lastFollowUpAt ? (row.lastFollowUpAt | auraDate:'date') : '-' }}</small></span>
            <span>{{ row.wonInvoiceNumber || '-' }}</span>
            <span>{{ reportCurrency(row.convertedRevenue) }}</span>
            <span>{{ row.lostReason || row.lastFollowUpNote || '-' }}</span>
            <span class="lead-actions">
              <button class="ghost-button mini" type="button" (click)="callLead(row)" [disabled]="!row.phone">Call</button>
              <button class="ghost-button mini" type="button" (click)="whatsappLead(row)" [disabled]="!row.phone">WhatsApp</button>
              <button class="ghost-button mini" type="button" (click)="bookLead(row)">Book</button>
              <button class="ghost-button mini" type="button" (click)="assignLead(row)" [disabled]="leadSaving()">Assign</button>
              <button class="ghost-button mini" type="button" (click)="addLeadFollowUp(row)" [disabled]="leadSaving()">Note</button>
              <button class="ghost-button mini" type="button" (click)="markLeadWon(row)" [disabled]="leadSaving()">Won</button>
              <button class="ghost-button mini" type="button" (click)="markLeadLost(row)" [disabled]="leadSaving()">Lost</button>
              <button class="ghost-button mini" type="button" (click)="openLeadClient(row)" [disabled]="!row.clientId">Client</button>
              <button class="ghost-button mini" type="button" (click)="openLeadInvoice(row)" [disabled]="!row.wonInvoiceId && !row.wonInvoiceNumber">Invoice</button>
            </span>
          </article>
          <div class="empty-state compact" *ngIf="!leadRows().length && !leadLoading()">
            <strong>No leads found</strong>
            <span>WhatsApp, engagement, campaign or lead widget activity will populate this report.</span>
          </div>
        </section>
      </section>

      <section class="action-queue-strip" *ngIf="activeWorkspace() === 'inbox' && engagementActionQueue().length">
        <div class="section-title-row">
          <div>
            <h3>Engagement action queue</h3>
          </div>
          <button class="ghost-button mini" type="button" (click)="loadManagerActions()">Refresh queue</button>
        </div>
        <div class="action-queue-grid">
          <button
            class="action-queue-card"
            type="button"
            *ngFor="let item of engagementActionQueue()"
            [class.urgent]="item.priority === 'urgent'"
            [class.high]="item.priority === 'high'"
            (click)="openActionQueueTarget(item)"
          >
            <span class="badge" [class.pending]="item.priority === 'normal'" [class.danger]="item.priority === 'urgent' || item.priority === 'high'">
              {{ actionQueueTypeLabel(item.type) }}
            </span>
            <strong>{{ item.count || 0 }}</strong>
            <span>{{ item.title }}</span>
            <small>{{ item.description }}</small>
          </button>
        </div>
      </section>

      <section class="engagement-shell" *ngIf="activeWorkspace() === 'inbox' && !loading()">
        <aside class="thread-rail">
          <div class="rail-section">
            <span class="rail-title">Channels</span>
            <div class="channel-grid">
              <button
                type="button"
                *ngFor="let channel of channelFilters"
                [class.active]="channelFilter() === channel.key"
                (click)="selectChannel(channel.key)"
              >
                <span>{{ channel.label }}</span>
                <strong>{{ countForChannel(channel.key) }}</strong>
              </button>
            </div>
          </div>

          <label class="thread-search">
            <span>Search client, name or phone</span>
            <input [(ngModel)]="query" (ngModelChange)="filterThreads()" placeholder="Client name, mobile, subject" />
          </label>

          <div class="rail-section" *ngIf="pinnedThreads().length">
            <span class="rail-title">Pinned</span>
            <button
              class="thread-card"
              type="button"
              *ngFor="let thread of pinnedThreads()"
              [class.active]="selectedThreadId() === thread.id"
              (click)="selectThread(thread.id)"
            >
              <ng-container *ngTemplateOutlet="threadCard; context: { thread: thread }"></ng-container>
            </button>
          </div>

          <div class="rail-section">
            <span class="rail-title">Recent threads</span>
            <button
              class="thread-card"
              type="button"
              *ngFor="let thread of visibleThreads()"
              [class.active]="selectedThreadId() === thread.id"
              (click)="selectThread(thread.id)"
            >
              <ng-container *ngTemplateOutlet="threadCard; context: { thread: thread }"></ng-container>
            </button>
            <div class="empty-state compact" *ngIf="!visibleThreads().length">
              <strong>No threads</strong>
              <span>Create or receive an engagement thread to start.</span>
            </div>
          </div>
        </aside>

        <main class="conversation-panel">
          <ng-container *ngIf="selectedDetail() as detail; else emptyConversation">
            <header class="conversation-header">
              <div>
                <span class="eyebrow">{{ detail.thread?.primaryChannel || detail.thread?.type || 'engagement' }}</span>
                <h3>{{ detail.thread?.displayName || detail.thread?.subject || 'Client conversation' }}</h3>
                <p>{{ detail.thread?.phone || detail.thread?.email || detail.thread?.subject || 'No contact captured yet' }}</p>
              </div>
              <div class="conversation-actions">
                <button class="primary-button mini" type="button" (click)="openBookingDrawer()" [disabled]="saving()">Book appointment</button>
                <select [ngModel]="detail.thread?.status" (ngModelChange)="setThreadStatus($event)" [disabled]="saving()">
                  <option value="open">Open</option>
                  <option value="pending">Pending</option>
                  <option value="waiting_for_client">Waiting for client</option>
                  <option value="resolved">Resolved</option>
                  <option value="escalated">Escalated</option>
                  <option value="archived">Archived</option>
                </select>
                <button class="ghost-button mini" type="button" (click)="assignToMe()" [disabled]="saving()">Assign me</button>
              </div>
            </header>

            <section class="timeline">
              <article class="timeline-item" *ngFor="let item of timelineItems()" [class.outbound]="item.kind === 'message' && item.direction === 'outbound'" [class.event]="item.kind !== 'message'">
                <span class="timeline-dot">{{ item.icon }}</span>
                <div>
                  <div class="timeline-topline">
                    <strong>{{ item.title }}</strong>
                    <small>{{ item.createdAt | auraDate:'date' }}</small>
                  </div>
                  <p>{{ item.body }}</p>
                  <div class="chip-row">
                    <span class="badge" *ngIf="item.channel">{{ item.channel }}</span>
                    <span class="badge" *ngIf="item.status">{{ item.status }}</span>
                    <span class="badge pending" *ngIf="item.approvalStatus === 'pending'">pending approval</span>
                    <span class="badge danger" *ngIf="item.failureReason">{{ item.failureReason }}</span>
                  </div>
                </div>
              </article>
              <div class="empty-state compact" *ngIf="!timelineItems().length">
                <strong>No activity yet</strong>
                <span>Draft a reply or note to create the first timeline item.</span>
              </div>
            </section>

            <section class="composer">
              <div class="composer-tabs">
                <button type="button" [class.active]="composerMode() === 'reply'" (click)="composerMode.set('reply')">Reply</button>
                <button type="button" [class.active]="composerMode() === 'note'" (click)="composerMode.set('note')">Private note</button>
              </div>
              <div class="composer-toolbar">
                <label>
                  <span>Channel</span>
                  <select [(ngModel)]="composerChannel" (ngModelChange)="loadTemplates()">
                    <option value="whatsapp">WhatsApp</option>
                    <option value="email">Email</option>
                    <option value="sms">SMS</option>
                    <option value="system_alert">System alert</option>
                  </select>
                </label>
                <label>
                  <span>Template</span>
                  <select [(ngModel)]="selectedTemplate" [disabled]="!templates().length">
                    <option value="">{{ templates().length ? 'Choose template' : 'No live templates yet' }}</option>
                    <option *ngFor="let template of templates()" [value]="template.id">{{ template.name }} · {{ template.approvalStatus || template.status }}</option>
                  </select>
                </label>
                <button class="ghost-button mini" type="button" (click)="applyTemplate()" [disabled]="!selectedTemplate">Apply</button>
              </div>
              <textarea [(ngModel)]="composerBody" [placeholder]="composerMode() === 'note' ? 'Internal note for staff only' : 'Write approval-safe reply draft'"></textarea>
              <div class="attachment-placeholder">
                Attachments placeholder · provider upload will be wired when channel provider is configured.
              </div>
              <div class="attachment-placeholder composer-footer">
                <span>Enterprise Controls</span>
                <label>
                  <input type="checkbox" [(ngModel)]="respectQuietHours">
                  Quiet hours
                </label>
              </div>
              <div class="composer-footer">
                <span [class.pending-text]="lastDraft()?.approvalStatus === 'pending'">
                  Draft status: {{ lastDraft()?.approvalStatus || 'not created' }}
                </span>
                <div>
                  <button class="ghost-button" type="button" (click)="rejectSelectedMessage()" [disabled]="!canReject() || saving()">Reject</button>
                  <button class="ghost-button" type="button" (click)="approveSelectedMessage()" [disabled]="!canApprove() || saving()">Approve</button>
                  <button class="primary-button" type="button" (click)="createDraft()" [disabled]="!composerBody.trim() || saving()">Save draft</button>
                  <button class="ghost-button" type="button" (click)="sendSelectedMessage()" [disabled]="!canSend() || saving()">Send</button>
                </div>
              </div>
            </section>
          </ng-container>
        </main>

        <aside class="client-rail">
          <ng-container *ngIf="selectedThread()?.clientId; else noClient">
            <section class="client-card aura-card">
              <h3>{{ clientProfile()?.name || selectedThread()?.displayName || 'Linked client' }}</h3>
              <p>{{ clientProfile()?.phone || selectedThread()?.phone || 'Phone not captured' }}</p>
              <p class="muted-line">{{ clientProfile()?.email || selectedThread()?.email || 'Email not captured' }}</p>
              <p class="muted-line">Branch: {{ client360()?.branch?.name || clientProfile()?.branchName || clientProfile()?.branchId || 'Branch not linked' }}</p>
              <div class="tag-row">
                <span *ngFor="let tag of profileTags()">{{ tag }}</span>
              </div>
            </section>

            <section class="client-card aura-card">
              <div class="info-grid">
                <div><strong>{{ client360()?.membership?.summaryText || 'None' }}</strong></div>
                <div><strong>{{ client360()?.package?.summaryText || 'None' }}</strong></div>
                <div><strong>₹{{ client360()?.wallet?.balance || 0 }}</strong></div>
                <div><strong>{{ client360()?.loyalty?.points || 0 }}</strong></div>
                <div><strong>₹{{ client360()?.balance?.dueAmount || 0 }}</strong></div>
                <div><strong>{{ client360()?.membership?.activeMembership?.creditsAfter ?? 0 }}</strong></div>
              </div>
            </section>

            <section class="client-card aura-card">
              <div class="mini-list">
                <article>
                  <strong>Last visit</strong>
                  <span>{{ lastAppointment()?.startAt || lastAppointment()?.appointmentDate || '-' }}</span>
                </article>
                <article>
                  <strong>Upcoming</strong>
                  <span>{{ upcomingAppointment()?.startAt || upcomingAppointment()?.appointmentDate || 'No upcoming appointment' }}</span>
                </article>
                <article *ngFor="let appt of pastAppointments().slice(0, 4)">
                  <strong>{{ appt.serviceName || appt.serviceId || 'Appointment' }}</strong>
                  <span>{{ appt.startAt || appt.appointmentDate || appt.date }} · {{ appt.staffName || appt.status || 'staff not captured' }}</span>
                </article>
              </div>
            </section>

            <section class="client-card aura-card">
              <div class="mini-list">
                <article *ngFor="let invoice of pastInvoices().slice(0, 4)">
                  <strong>{{ invoice.invoiceNumber || invoice.id }}</strong>
                  <span>₹{{ invoice.total || 0 }} · due ₹{{ invoice.due || 0 }}</span>
                </article>
                <article *ngIf="!pastInvoices().length">
                  <strong>No invoices found</strong>
                  <span>Invoices will appear when POS data exists for this client.</span>
                </article>
              </div>
            </section>

            <section class="client-card aura-card">
              <div class="info-grid">
                <div><strong>{{ listLabels(preferredStaff(), 'name') || 'None' }}</strong></div>
                <div><strong>{{ listLabels(preferredServices(), 'name') || 'None' }}</strong></div>
                <div><strong>{{ allergiesText() || 'None captured' }}</strong></div>
                <div><strong>{{ clientProfile()?.preferredChannel || 'Not set' }}</strong></div>
              </div>
            </section>

            <section class="client-card aura-card">
              <p>{{ clientProfile()?.notes || clientProfile()?.preferences || 'No notes captured yet.' }}</p>
              <p class="muted-line">{{ client360()?.files?.placeholder || 'Files placeholder ready.' }}</p>
              <div class="alert-list">
                <div *ngFor="let alert of alerts()">
                  <strong>{{ alert.title || alert.alertType || 'Alert' }}</strong>
                  <span>{{ alert.summary || alert.suggestedAction || alert.status }}</span>
                </div>
                <div *ngIf="!alerts().length"><strong>No open alerts</strong><span>Risk signals will appear here.</span></div>
              </div>
            </section>

            <section class="client-card aura-card ai-summary">
              <div class="card-header-row">
                <button class="ghost-button mini" type="button" (click)="openAiSummaryDrawer()" [disabled]="aiSummaryGenerating()">Review</button>
              </div>
              <p>{{ latestAiSummaryText() }}</p>
              <p class="muted-line" *ngIf="generatedAiSummary()">
                Generated {{ (generatedAiSummary()?.generatedAt || generatedAiSummary()?.generated_at) | auraDate:'date' }}
                · Confidence {{ confidencePercent(generatedAiSummary()?.confidence) }}
              </p>
            </section>
          </ng-container>
        </aside>
      </section>

      <div class="drawer-backdrop" *ngIf="bookingDrawerOpen()" (click)="closeBookingDrawer()"></div>
      <aside class="booking-drawer" *ngIf="bookingDrawerOpen()" role="dialog" aria-label="Engagement booking drawer">
        <header class="drawer-head">
          <div>
            <h3>Book from conversation</h3>
            <p>{{ bookingClientLabel() }}</p>
          </div>
          <button class="ghost-button mini icon-button" type="button" (click)="closeBookingDrawer()" aria-label="Close booking drawer">x</button>
        </header>

        <app-state [loading]="bookingLoading()" [error]="bookingError()"></app-state>
        <div class="state info" *ngIf="bookingSuccess()">{{ bookingSuccess() }}</div>

        <section class="drawer-section booking-grid-section">
          <label>
            <span>Client</span>
            <input [value]="bookingClientLabel()" disabled />
          </label>
          <label>
            <span>Appointment category</span>
            <select [(ngModel)]="bookingForm.appointmentCategory">
              <option value="service">Service</option>
              <option value="consultation">Consultation</option>
              <option value="touchup">Touch-up</option>
              <option value="package">Package session</option>
              <option value="membership">Membership visit</option>
            </select>
          </label>
          <label>
            <span>Branch</span>
            <select [(ngModel)]="bookingForm.branchId" (ngModelChange)="onBookingBranchChange()">
              <option *ngFor="let branch of bookingBranches()" [value]="branch.id">{{ branch.name || branch.id }}</option>
            </select>
          </label>
          <label>
            <span>Service</span>
            <select [(ngModel)]="bookingForm.serviceId" (ngModelChange)="onBookingServiceChange()">
              <option value="">Select service</option>
              <option *ngFor="let service of bookingServices()" [value]="service.id">{{ service.name }} · ₹{{ service.price || 0 }}</option>
            </select>
          </label>
          <label>
            <span>Staff/provider</span>
            <select [(ngModel)]="bookingForm.staffId" (ngModelChange)="clearBookingPreview()">
              <option value="">Auto assign</option>
              <option *ngFor="let person of bookingStaffForBranch()" [value]="person.id">{{ person.name }} · {{ person.role || 'Staff' }}</option>
            </select>
          </label>
          <label>
            <span>Room/resource</span>
            <input [(ngModel)]="bookingForm.roomResource" (ngModelChange)="clearBookingPreview()" placeholder="Chair 1, Room 1, Color bar" />
          </label>
          <label>
            <span>Duration</span>
            <input type="number" min="15" step="5" [(ngModel)]="bookingForm.durationMinutes" (ngModelChange)="clearBookingPreview()" />
          </label>
          <label>
            <span>Date</span>
            <input type="date" [(ngModel)]="bookingForm.date" (ngModelChange)="clearBookingPreview()" />
          </label>
          <label>
            <span>Number of guests</span>
            <input type="number" min="1" max="25" [(ngModel)]="bookingForm.numberOfGuests" />
          </label>
          <div class="toggle-grid">
            <label><input type="checkbox" [(ngModel)]="bookingForm.familyBooking" /> Family booking</label>
            <label><input type="checkbox" [(ngModel)]="bookingForm.surpriseVisit" /> Surprise visit</label>
            <label><input type="checkbox" [(ngModel)]="bookingForm.advancedMode" /> Advanced mode</label>
          </div>
          <label class="full-span">
            <span>Notes</span>
            <textarea [(ngModel)]="bookingForm.notes" placeholder="Client request, allergy note, recovery context"></textarea>
          </label>
        </section>

        <section class="drawer-section">
          <div class="card-header-row">
            <button class="ghost-button mini" type="button" (click)="previewBookingSlots()" [disabled]="bookingLoading() || !canPreviewBooking()">Find slots</button>
          </div>
          <div class="warning-stack" *ngIf="bookingSlotPreview() as preview">
            <span class="badge danger" *ngIf="preview.dueAmountWarning">{{ preview.dueAmountWarning }}</span>
            <span class="badge pending" *ngIf="preview.openAppointmentsWarning">{{ preview.openAppointmentsWarning }}</span>
          </div>
          <div class="slot-list">
            <button
              type="button"
              *ngFor="let slot of suggestedBookingSlots()"
              [class.active]="selectedBookingSlot()?.startAt === slot.startAt && selectedBookingSlot()?.staffId === slot.staffId"
              (click)="selectBookingSlot(slot)"
            >
              <strong>{{ slot.startAt | auraDate:'dateTime' }}</strong>
              <span>{{ slot.staffName || staffName(slot.staffId) }} · {{ slot.chair || slot.room || 'Auto resource' }} · Score {{ slot.score || '-' }}</span>
            </button>
            <div class="empty-state compact" *ngIf="!suggestedBookingSlots().length">
              <strong>No slots loaded</strong>
              <span>Select service/date and find slots.</span>
            </div>
          </div>
        </section>

        <section class="drawer-section review-box">
          <div class="info-grid">
            <div><strong>{{ bookingServiceName() }}</strong></div>
            <div><strong>{{ selectedBookingSlot()?.startAt ? (selectedBookingSlot()?.startAt | auraDate:'date') : 'Not selected' }}</strong></div>
            <div><strong>{{ bookingSlotPreview()?.dueAmountWarning || 'None' }}</strong></div>
            <div><strong>{{ bookingSlotPreview()?.openAppointmentsCount || 0 }}</strong></div>
          </div>
          <button class="primary-button" type="button" (click)="createEngagementBooking()" [disabled]="bookingSaving() || !selectedBookingSlot()">
            {{ bookingSaving() ? 'Booking...' : 'Review & book' }}
          </button>
        </section>
      </aside>

      <div class="drawer-backdrop" *ngIf="recoveryDrawerOpen()" (click)="closeRecoveryDrawer()"></div>
      <aside class="recovery-drawer" *ngIf="recoveryDrawerOpen()" role="dialog" aria-label="Recovery opportunities drawer">
        <header class="drawer-head">
          <div>
            <h3>Revenue recovery board</h3>
          </div>
          <button class="ghost-button mini icon-button" type="button" (click)="closeRecoveryDrawer()" aria-label="Close recovery board">x</button>
        </header>

        <app-state [loading]="recoveryLoading()" [error]="recoveryError()"></app-state>
        <div class="state info" *ngIf="recoveryNotice()">{{ recoveryNotice() }}</div>

        <section class="recovery-toolbar">
          <label class="thread-search">
            <span>Search recovery board</span>
            <input [(ngModel)]="recoveryQuery" (ngModelChange)="filterRecoveryOpportunities()" placeholder="Client, reason, type, staff, priority" />
          </label>
          <button class="ghost-button" type="button" (click)="loadRecoveryOpportunities()" [disabled]="recoveryLoading()">Refresh board</button>
        </section>

        <section class="recovery-kpis">
          <article>
            <strong>{{ recoveryOpenCount() }}</strong>
          </article>
          <article>
            <strong>{{ recoveryHighPriorityCount() }}</strong>
          </article>
          <article>
            <strong>₹{{ recoveryRevenueValue() }}</strong>
          </article>
        </section>

        <section class="recovery-board">
          <article class="recovery-card" *ngFor="let opportunity of visibleRecoveryOpportunities()">
            <div class="recovery-card-head">
              <div>
                <span class="eyebrow">{{ recoveryTypeLabel(opportunity.opportunityType || opportunity.type) }}</span>
                <h4>{{ opportunity.title || recoveryTypeLabel(opportunity.opportunityType || opportunity.type) }}</h4>
              </div>
              <span [class]="'priority-pill ' + (opportunity.priority || 'normal')">{{ opportunity.priority || 'normal' }}</span>
            </div>
            <div class="info-grid">
              <div><strong>₹{{ opportunity.revenueValue || opportunity.expectedValue || 0 }}</strong></div>
              <div><strong>{{ opportunity.client?.name || opportunity.clientName || opportunity.clientId || '-' }}</strong></div>
              <div><strong>{{ opportunity.assignedStaffName || opportunity.assignedTo || 'Unassigned' }}</strong></div>
              <div><strong>{{ opportunity.dueAt ? (opportunity.dueAt | auraDate:'date') : '-' }}</strong></div>
            </div>
            <p class="recovery-reason">{{ opportunity.reason || 'Recovery reason not captured.' }}</p>
            <p class="suggested-message">{{ opportunity.suggestedMessage || opportunity.suggestedAction || 'Suggested message will appear after detection.' }}</p>
            <div class="recovery-footer">
              <span class="badge">{{ opportunity.status || 'open' }}</span>
              <div>
                <button class="ghost-button mini" type="button" (click)="assignRecoveryToMe(opportunity)" [disabled]="recoverySaving()">Assign</button>
                <button class="primary-button mini" type="button" (click)="convertRecovery(opportunity)" [disabled]="recoverySaving()">Convert</button>
                <button class="ghost-button mini" type="button" (click)="markRecoveryDone(opportunity)" [disabled]="recoverySaving()">Done</button>
              </div>
            </div>
          </article>
          <div class="empty-state compact" *ngIf="!visibleRecoveryOpportunities().length && !recoveryLoading()">
            <strong>No recovery opportunities</strong>
            <span>Live appointment, invoice, membership, package, call and review signals will appear here.</span>
          </div>
        </section>
      </aside>

      <div class="drawer-backdrop" *ngIf="riskDrawerOpen()" (click)="closeRiskDrawer()"></div>
      <aside class="risk-drawer" *ngIf="riskDrawerOpen()" role="dialog" aria-label="AI risk and next best action drawer">
        <header class="drawer-head">
          <div>
            <h3>Client engagement risk signals</h3>
          </div>
          <button class="ghost-button mini icon-button" type="button" (click)="closeRiskDrawer()" aria-label="Close risk signals">x</button>
        </header>

        <app-state [loading]="riskLoading()" [error]="riskError()"></app-state>
        <div class="state info" *ngIf="riskNotice()">{{ riskNotice() }}</div>

        <section class="risk-toolbar">
          <label class="thread-search">
            <span>Search risk signals</span>
            <input [(ngModel)]="riskQuery" (ngModelChange)="filterRiskSignals()" placeholder="Client, reason, risk, next best action" />
          </label>
          <label>
            <span>Risk level</span>
            <select [(ngModel)]="riskLevelFilter" (ngModelChange)="filterRiskSignals()">
              <option value="">All levels</option>
              <option value="critical">Critical</option>
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
            </select>
          </label>
          <label>
            <span>Review status</span>
            <select [(ngModel)]="riskReviewStatusFilter" (ngModelChange)="filterRiskSignals()">
              <option value="">All statuses</option>
              <option value="unreviewed">Unreviewed</option>
              <option value="reviewing">Reviewing</option>
              <option value="acknowledged">Acknowledged</option>
              <option value="resolved">Resolved</option>
              <option value="dismissed">Dismissed</option>
            </select>
          </label>
          <button class="ghost-button" type="button" (click)="loadRiskSignals()" [disabled]="riskLoading()">Refresh signals</button>
        </section>

        <section class="risk-kpis">
          <article>
            <strong>{{ riskOpenCount() }}</strong>
          </article>
          <article>
            <strong>{{ riskHighCount() }}</strong>
          </article>
          <article>
            <strong>{{ riskUnreviewedCount() }}</strong>
          </article>
          <article>
            <strong>{{ riskAverageScore() }}</strong>
          </article>
        </section>

        <section class="risk-board">
          <article class="risk-card" *ngFor="let signal of visibleRiskSignals()">
            <div class="risk-card-head">
              <div>
                <span class="eyebrow">{{ riskTypeLabel(signal.alertType || signal.alert_type) }}</span>
                <h4>{{ signal.title || riskTypeLabel(signal.alertType || signal.alert_type) }}</h4>
              </div>
              <span [class]="'risk-pill ' + (signal.riskLevel || signal.risk_level || 'low')">{{ signal.riskLevel || signal.risk_level || 'low' }}</span>
            </div>
            <div class="info-grid">
              <div><strong>{{ riskScoreText(signal) }}</strong></div>
              <div><strong>{{ signal.client?.name || signal.clientName || signal.clientId || '-' }}</strong></div>
              <div><strong>{{ signal.staff?.name || signal.staffName || signal.staffId || '-' }}</strong></div>
              <div><strong>{{ signal.reviewStatus || signal.review_status || 'unreviewed' }}</strong></div>
            </div>
            <p class="risk-reason">{{ riskReason(signal) }}</p>
            <p class="suggested-message">{{ signal.suggestedAction || signal.suggested_action || 'Suggested action will appear after detection.' }}</p>
            <div class="risk-evidence">
              <span>{{ riskEvidenceSummary(signal) }}</span>
              <small>{{ signal.createdAt | auraDate:'date' }}</small>
            </div>
            <div class="risk-footer">
              <span class="badge">{{ signal.status || 'open' }}</span>
              <div>
                <button class="primary-button mini" type="button" (click)="reviewRiskSignal(signal, 'reviewing')" [disabled]="riskSaving()">Review now</button>
                <button class="ghost-button mini" type="button" (click)="reviewRiskSignal(signal, 'acknowledged')" [disabled]="riskSaving()">Acknowledge</button>
                <button class="ghost-button mini" type="button" (click)="reviewRiskSignal(signal, 'resolved')" [disabled]="riskSaving()">Resolve</button>
                <button class="ghost-button mini" type="button" (click)="reviewRiskSignal(signal, 'dismissed')" [disabled]="riskSaving()">Dismiss</button>
              </div>
            </div>
          </article>
          <div class="empty-state compact" *ngIf="!visibleRiskSignals().length && !riskLoading()">
            <strong>No risk signals</strong>
            <span>Live client, appointment, invoice, membership, review and message risk signals will appear here.</span>
          </div>
        </section>
      </aside>

      <div class="drawer-backdrop" *ngIf="slaDrawerOpen()" (click)="closeSlaDrawer()"></div>
      <aside class="sla-drawer" *ngIf="slaDrawerOpen()" role="dialog" aria-label="SLA and staff accountability drawer">
        <header class="drawer-head">
          <div>
            <h3>Manager response board</h3>
          </div>
          <button class="ghost-button mini icon-button" type="button" (click)="closeSlaDrawer()" aria-label="Close SLA board">x</button>
        </header>

        <app-state [loading]="slaLoading()" [error]="slaError()"></app-state>
        <div class="state info" *ngIf="slaNotice()">{{ slaNotice() }}</div>

        <section class="sla-kpis">
          <article>
            <strong>{{ slaOverdue().length }}</strong>
          </article>
          <article>
            <strong>{{ slaReport()?.summary?.unresolvedConversations || 0 }}</strong>
          </article>
          <article>
            <strong>{{ minutesLabel(slaReport()?.summary?.avgFirstResponseMinutes) }}</strong>
          </article>
          <article>
            <strong>{{ slaReport()?.summary?.conversions || 0 }}</strong>
          </article>
        </section>

        <section class="sla-grid">
          <article class="drawer-section">
            <div class="section-title-row">
              <div>
                <h4>Follow-ups needing manager attention</h4>
              </div>
              <button class="ghost-button mini" type="button" (click)="loadSlaAccountability()" [disabled]="slaLoading()">Refresh</button>
            </div>
            <div class="sla-overdue-list">
              <article class="sla-row" *ngFor="let item of slaOverdue()">
                <div>
                  <strong>{{ item.thread?.subject || item.clientName || 'Engagement thread' }}</strong>
                  <span>{{ item.clientName || item.thread?.displayName || 'Client not linked' }} · {{ item.assignedStaffName || 'Unassigned' }}</span>
                </div>
                <div class="sla-row-metrics">
                  <span [class]="'priority-pill ' + (item.priority || 'normal')">{{ item.priority || 'normal' }}</span>
                  <small>Due {{ item.dueAt ? (item.dueAt | auraDate:'date') : '-' }}</small>
                  <small>{{ item.overdueLabel || minutesLabel(item.overdueMinutes) }} overdue</small>
                </div>
                <button class="primary-button mini" type="button" (click)="escalateThreadFromSla(item)" [disabled]="slaSaving()">Escalate</button>
              </article>
              <div class="empty-state compact" *ngIf="!slaOverdue().length && !slaLoading()">
                <strong>No overdue conversations</strong>
                <span>SLA breaches from live engagement threads will appear here.</span>
              </div>
            </div>
          </article>

          <article class="drawer-section">
            <h4>Escalated and unresolved conversations</h4>
            <div class="info-grid">
              <div><strong>{{ managerView()?.escalatedThreads?.length || 0 }}</strong></div>
              <div><strong>{{ managerView()?.unresolvedConversations?.length || 0 }}</strong></div>
              <div><strong>{{ slaReport()?.summary?.overdueFollowUps || 0 }}</strong></div>
              <div><strong>{{ slaReport()?.summary?.abandonedRecovery || 0 }}</strong></div>
            </div>
          </article>
        </section>

        <section class="drawer-section">
          <h4>Response, resolution and recovery accountability</h4>
          <div class="staff-performance-table">
            <div class="staff-performance-head">
              <span>Staff</span>
              <span>First response</span>
              <span>Resolution</span>
              <span>Unresolved</span>
              <span>Overdue</span>
              <span>Conversions</span>
              <span>Abandoned recovery</span>
            </div>
            <div class="staff-performance-row" *ngFor="let row of slaReport()?.rows || []">
              <strong>{{ row.staffName || row.staffId || 'Unassigned' }}</strong>
              <span>{{ row.avgFirstResponseLabel || minutesLabel(row.avgFirstResponseMinutes) }}</span>
              <span>{{ row.avgResolutionLabel || minutesLabel(row.avgResolutionMinutes) }}</span>
              <span>{{ row.unresolvedConversations || 0 }}</span>
              <span>{{ row.overdueFollowUps || 0 }}</span>
              <span>{{ row.conversions || 0 }}</span>
              <span>{{ row.abandonedRecovery || 0 }}</span>
            </div>
            <div class="empty-state compact" *ngIf="!(slaReport()?.rows || []).length && !slaLoading()">
              <strong>No staff accountability rows</strong>
              <span>Assignments, messages, conversions and recovery work will populate this report.</span>
            </div>
          </div>
        </section>
      </aside>

      <div class="drawer-backdrop" *ngIf="reportsDrawerOpen()" (click)="closeReportsDrawer()"></div>
      <aside class="reports-drawer" *ngIf="reportsDrawerOpen()" role="dialog" aria-label="Engagement reports and analytics drawer">
        <header class="drawer-head">
          <div>
            <h3>Engagement performance center</h3>
          </div>
          <button class="ghost-button mini icon-button" type="button" (click)="closeReportsDrawer()" aria-label="Close engagement reports">x</button>
        </header>

        <section class="reports-toolbar">
          <label>
            <span>From date</span>
            <input type="date" [(ngModel)]="reportFromDate" />
          </label>
          <label>
            <span>To date</span>
            <input type="date" [(ngModel)]="reportToDate" />
          </label>
          <label>
            <span>Branch</span>
            <input [(ngModel)]="reportBranchFilter" placeholder="Current branch or branch id" />
          </label>
          <label>
            <span>Staff</span>
            <input [(ngModel)]="reportStaffFilter" placeholder="Staff/user id" />
          </label>
          <label>
            <span>Channel</span>
            <select [(ngModel)]="reportChannelFilter">
              <option value="">All channels</option>
              <option value="whatsapp">WhatsApp</option>
              <option value="sms">SMS</option>
              <option value="email">Email</option>
              <option value="call">Call</option>
              <option value="review">Review</option>
              <option value="appointment">Appointment</option>
              <option value="system_alert">System alert</option>
            </select>
          </label>
          <label>
            <span>Status</span>
            <select [(ngModel)]="reportStatusFilter">
              <option value="">All statuses</option>
              <option value="open">Open</option>
              <option value="pending">Pending</option>
              <option value="waiting_for_client">Waiting for client</option>
              <option value="resolved">Resolved</option>
              <option value="escalated">Escalated</option>
              <option value="approved">Approved</option>
              <option value="failed">Failed</option>
            </select>
          </label>
          <label>
            <span>Risk level</span>
            <select [(ngModel)]="reportRiskLevelFilter">
              <option value="">All risk</option>
              <option value="critical">Critical</option>
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
            </select>
          </label>
          <label>
            <span>Client segment</span>
            <select [(ngModel)]="reportClientSegmentFilter">
              <option value="">All clients</option>
              <option value="member">Members</option>
              <option value="due">Due balance</option>
              <option value="risk">At risk</option>
              <option value="high_value">High value</option>
              <option value="inactive">Inactive</option>
              <option value="new">New clients</option>
            </select>
          </label>
          <label>
            <span>Recovery type</span>
            <select [(ngModel)]="reportRecoveryTypeFilter">
              <option value="">All recovery</option>
              <option value="abandoned_appointment">Abandoned appointment</option>
              <option value="missed_call">Missed call</option>
              <option value="no_show">No-show</option>
              <option value="cancelled_appointment">Cancelled appointment</option>
              <option value="membership_expiry">Membership expiry</option>
              <option value="package_expiry">Package expiry</option>
              <option value="payment_due">Payment due</option>
              <option value="inactive_client">Inactive client</option>
              <option value="negative_review">Negative review</option>
            </select>
          </label>
          <div class="reports-actions">
            <button class="ghost-button" type="button" (click)="loadReports()" [disabled]="reportsLoading()">Refresh reports</button>
            <button class="ghost-button" type="button" (click)="exportEngagementReport('csv')">Export CSV</button>
            <button class="ghost-button" type="button" (click)="exportEngagementReport('pdf')">Export PDF</button>
          </div>
        </section>

        <app-state [loading]="reportsLoading()" [error]="reportsError()"></app-state>
        <div class="state info" *ngIf="reportsNotice()">{{ reportsNotice() }}</div>

        <section class="reports-kpis" *ngIf="reportData() as report">
          <article>
            <strong>{{ report.summary?.conversationVolume || 0 }}</strong>
          </article>
          <article>
            <strong>{{ report.summary?.totalMessages || 0 }}</strong>
          </article>
          <article>
            <strong>{{ report.responseTime?.avgFirstResponseLabel || minutesLabel(report.summary?.avgFirstResponseMinutes) }}</strong>
          </article>
          <article>
            <strong>{{ report.summary?.slaBreaches || 0 }}</strong>
          </article>
          <article>
            <strong>{{ reportCurrency(report.summary?.recoveryRevenue) }}</strong>
          </article>
          <article>
            <strong>{{ report.summary?.aiSuggestionAcceptanceRate || 0 }}%</strong>
          </article>
        </section>

        <section class="reports-grid" *ngIf="reportData() as report">
          <article class="drawer-section">
            <div class="section-title-row">
              <div>
                <h4>WhatsApp, SMS, email, calls and review traffic</h4>
              </div>
              <span class="badge">{{ report.channelWiseMessages?.length || 0 }} channels</span>
            </div>
            <div class="report-table compact">
              <div class="report-table-head five">
                <span>Channel</span><span>Total</span><span>Inbound</span><span>Outbound</span><span>Failed</span>
              </div>
              <div class="report-table-row five" *ngFor="let row of report.channelWiseMessages || []">
                <strong>{{ row.channel }}</strong><span>{{ row.total || 0 }}</span><span>{{ row.inbound || 0 }}</span><span>{{ row.outbound || 0 }}</span><span>{{ (row.failed || 0) + (row.blocked || 0) }}</span>
              </div>
            </div>
          </article>

          <article class="drawer-section">
            <h4>First response and breach control</h4>
            <div class="info-grid">
              <div><strong>{{ report.responseTime?.avgFirstResponseLabel || '0m' }}</strong></div>
              <div><strong>{{ report.slaBreach?.open || 0 }}</strong></div>
              <div><strong>{{ report.slaBreach?.resolved || 0 }}</strong></div>
              <div><strong>{{ report.responseTime?.rows?.length || 0 }}</strong></div>
            </div>
          </article>

          <article class="drawer-section wide">
            <h4>Ownership, messages, conversions and recovery revenue</h4>
            <div class="report-table">
              <div class="report-table-head six">
                <span>Staff</span><span>Threads</span><span>Messages</span><span>Avg response</span><span>Conversions</span><span>Revenue</span>
              </div>
              <div class="report-table-row six" *ngFor="let row of report.staffWiseEngagement || []">
                <strong>{{ row.staffName || row.staffId || 'Unassigned' }}</strong>
                <span>{{ row.threads || 0 }}</span>
                <span>{{ row.messages || 0 }}</span>
                <span>{{ row.avgFirstResponseLabel || '0m' }}</span>
                <span>{{ row.conversions || 0 }}</span>
                <span>{{ reportCurrency(row.revenue) }}</span>
              </div>
            </div>
          </article>

          <article class="drawer-section">
            <h4>Opportunity pipeline and converted value</h4>
            <div class="info-grid">
              <div><strong>{{ reportCurrency(report.recoveryRevenue?.totalRevenue) }}</strong></div>
              <div><strong>{{ reportCurrency(report.recoveryRevenue?.expectedPipeline) }}</strong></div>
              <div><strong>{{ report.recoveryRevenue?.converted || 0 }}</strong></div>
              <div><strong>{{ report.abandonedAppointmentConversion?.conversionRate || 0 }}%</strong></div>
            </div>
          </article>

          <article class="drawer-section">
            <h4>Expiry and due-balance recovery performance</h4>
            <div class="info-grid">
              <div><strong>{{ report.membershipPackageExpiryRecovery?.membership || 0 }}</strong></div>
              <div><strong>{{ report.membershipPackageExpiryRecovery?.package || 0 }}</strong></div>
              <div><strong>{{ report.paymentDueRecovery?.total || 0 }}</strong></div>
              <div><strong>{{ reportCurrency(report.paymentDueRecovery?.revenue) }}</strong></div>
            </div>
          </article>

          <article class="drawer-section">
            <h4>Review recovery and approval coverage</h4>
            <div class="info-grid">
              <div><strong>{{ report.reviewResponsePerformance?.totalReviews || 0 }}</strong></div>
              <div><strong>{{ report.reviewResponsePerformance?.negativeReviews || 0 }}</strong></div>
              <div><strong>{{ report.reviewResponsePerformance?.approvedResponses || 0 }}</strong></div>
              <div><strong>{{ report.reviewResponsePerformance?.providerMissing || 0 }}</strong></div>
            </div>
          </article>

          <article class="drawer-section">
            <h4>Draft approval and rejection trend</h4>
            <div class="info-grid">
              <div><strong>{{ report.aiSuggestionAcceptance?.suggestions || 0 }}</strong></div>
              <div><strong>{{ report.aiSuggestionAcceptance?.approved || 0 }}</strong></div>
              <div><strong>{{ report.aiSuggestionAcceptance?.rejected || 0 }}</strong></div>
              <div><strong>{{ report.aiSuggestionAcceptance?.acceptanceRate || 0 }}%</strong></div>
            </div>
          </article>

          <article class="drawer-section wide">
            <h4>Template render, draft and send outcomes</h4>
            <div class="report-table">
              <div class="report-table-head five">
                <span>Template</span><span>Rendered</span><span>Drafts</span><span>Sent</span><span>Approvals</span>
              </div>
              <div class="report-table-row five" *ngFor="let row of report.templatePerformance?.byTemplate || []">
                <strong>{{ row.name || row.templateId || 'Manual' }}</strong>
                <span>{{ row.rendered || 0 }}</span>
                <span>{{ row.draftsCreated || 0 }}</span>
                <span>{{ row.messagesSent || 0 }}</span>
                <span>{{ row.approvals || 0 }}</span>
              </div>
            </div>
          </article>

          <article class="drawer-section">
            <h4>Provider status placeholder</h4>
            <div class="info-grid">
              <div><strong>{{ report.whatsappDeliveryStatus?.configured ? 'Yes' : 'No' }}</strong></div>
              <div><strong>{{ report.whatsappDeliveryStatus?.delivered || 0 }}</strong></div>
              <div><strong>{{ report.whatsappDeliveryStatus?.pending || 0 }}</strong></div>
              <div><small>Failed/blocked</small><strong>{{ (report.whatsappDeliveryStatus?.failed || 0) + (report.whatsappDeliveryStatus?.blocked || 0) }}</strong></div>
            </div>
            <p class="suggested-message">{{ report.whatsappDeliveryStatus?.note }}</p>
          </article>
        </section>
      </aside>

      <div class="drawer-backdrop" *ngIf="providerDrawerOpen()" (click)="closeProviderDrawer()"></div>
      <aside class="provider-drawer" *ngIf="providerDrawerOpen()" role="dialog" aria-label="Provider readiness drawer">
        <header class="drawer-head">
          <div>
            <h3>Communication provider adapters</h3>
          </div>
          <button class="ghost-button mini icon-button" type="button" (click)="closeProviderDrawer()" aria-label="Close provider readiness">x</button>
        </header>

        <app-state [loading]="providerLoading()" [error]="providerError()"></app-state>
        <div class="state info" *ngIf="providerNotice()">{{ providerNotice() }}</div>

        <section class="reports-kpis" *ngIf="providerReadiness() as readiness">
          <article>
            <strong>{{ readiness.summary?.providers || 0 }}</strong>
          </article>
          <article>
            <strong>{{ readiness.summary?.activeConfigs || 0 }}</strong>
          </article>
          <article>
            <strong>{{ readiness.summary?.configuredPublicDetails || 0 }}</strong>
          </article>
          <article>
            <strong>{{ readiness.summary?.directSendReady || 0 }}</strong>
          </article>
          <article>
            <strong>{{ readiness.summary?.pendingSendOnly || 0 }}</strong>
          </article>
          <article>
            <strong>{{ readiness.summary?.disabledByDefault ? 'On' : 'Review' }}</strong>
          </article>
        </section>

        <section class="reports-toolbar">
          <label>
            <span>Provider</span>
            <select [(ngModel)]="providerForm.providerName" (ngModelChange)="selectProviderForConfig($event)">
              <option *ngFor="let provider of providerReadiness()?.providers || []" [value]="provider.providerName">{{ provider.label }}</option>
            </select>
          </label>
          <label>
            <span>Status</span>
            <select [(ngModel)]="providerForm.status">
              <option value="inactive">Inactive</option>
              <option value="active">Active</option>
              <option value="paused">Paused</option>
            </select>
          </label>
          <label>
            <span>Sender ID</span>
            <input [(ngModel)]="providerForm.senderId" placeholder="Business phone, email or sender id" />
          </label>
          <label>
            <span>Template namespace</span>
            <input [(ngModel)]="providerForm.templateNamespace" placeholder="WhatsApp namespace / app id" />
          </label>
          <label class="full-span">
            <span>Webhook URL</span>
            <input [(ngModel)]="providerForm.webhookUrl" placeholder="https://your-domain.com/webhooks/provider" />
          </label>
          <div class="reports-actions">
            <button class="ghost-button" type="button" (click)="loadProviders()" [disabled]="providerLoading()">Refresh providers</button>
            <button class="primary-button" type="button" (click)="saveProviderConfig()" [disabled]="providerSaving()">Save config</button>
          </div>
        </section>

        <section class="reports-grid" *ngIf="providerReadiness() as readiness">
          <article class="drawer-section" *ngFor="let provider of readiness.providers || []">
            <div class="section-title-row">
              <div>
                <span class="eyebrow">{{ provider.channel }}</span>
                <h4>{{ provider.label }}</h4>
              </div>
              <span [class]="'risk-pill ' + (provider.providerConfigured ? 'low' : provider.configComplete ? 'medium' : 'high')">
                {{ provider.readinessStatus || 'disabled' }}
              </span>
            </div>
            <div class="info-grid">
              <div><strong>{{ provider.status || 'inactive' }}</strong></div>
              <div><strong>{{ provider.senderId || '-' }}</strong></div>
              <div><strong>{{ provider.templateNamespace || '-' }}</strong></div>
              <div><strong>{{ provider.lastVerifiedAt ? (provider.lastVerifiedAt | auraDate:'date') : '-' }}</strong></div>
            </div>
            <p class="suggested-message">{{ provider.note }}</p>
            <div class="composer-footer">
              <span>{{ provider.sendMode || 'pending_send_only' }}</span>
              <button class="ghost-button mini" type="button" (click)="verifyProvider(provider)" [disabled]="providerSaving() || !provider.accountId">Verify readiness</button>
            </div>
          </article>
        </section>
      </aside>

      <div class="drawer-backdrop" *ngIf="auditDrawerOpen()" (click)="closeAuditDrawer()"></div>
      <aside class="audit-drawer" *ngIf="auditDrawerOpen()" role="dialog" aria-label="Communication audit ledger drawer">
        <header class="drawer-head">
          <div>
            <h3>Immutable engagement audit</h3>
          </div>
          <button class="ghost-button mini icon-button" type="button" (click)="closeAuditDrawer()" aria-label="Close audit ledger">x</button>
        </header>

        <app-state [loading]="auditLoading()" [error]="auditError()"></app-state>

        <section class="audit-toolbar">
          <label class="thread-search">
            <span>Search audit</span>
            <input [(ngModel)]="auditQuery" (ngModelChange)="filterAuditRows()" placeholder="Action, actor, entity, role" />
          </label>
          <button class="ghost-button" type="button" (click)="loadAuditLedger()" [disabled]="auditLoading()">Refresh ledger</button>
        </section>

        <section class="audit-table">
          <div class="audit-table-head">
            <span>When</span>
            <span>Action</span>
            <span>Actor</span>
            <span>Client</span>
            <span>Entity</span>
            <span>Branch</span>
          </div>
          <article class="audit-table-row" *ngFor="let row of visibleAuditRows()">
            <span>{{ row.createdAt | auraDate:'date' }}</span>
            <strong>{{ auditActionLabel(row.action) }}</strong>
            <span>{{ row.actorUserId || 'system' }} · {{ row.actorRole || '-' }}</span>
            <span>{{ row.clientId || '-' }}</span>
            <span>{{ row.entityType || '-' }} / {{ row.entityId || '-' }}</span>
            <span>{{ row.branchId || '-' }}</span>
          </article>
          <div class="empty-state compact" *ngIf="!visibleAuditRows().length && !auditLoading()">
            <strong>No audit rows</strong>
            <span>Communication activity will appear here as immutable ledger entries.</span>
          </div>
        </section>
      </aside>

      <div class="drawer-backdrop" *ngIf="reviewDrawerOpen()" (click)="closeReviewDrawer()"></div>
      <aside class="review-response-drawer" *ngIf="reviewDrawerOpen()" role="dialog" aria-label="Review response drawer">
        <header class="drawer-head">
          <div>
            <h3>Approve-safe review replies</h3>
          </div>
          <button class="ghost-button mini icon-button" type="button" (click)="closeReviewDrawer()" aria-label="Close review response center">x</button>
        </header>

        <app-state [loading]="reviewLoading()" [error]="reviewError()"></app-state>
        <div class="state info" *ngIf="reviewNotice()">{{ reviewNotice() }}</div>

        <section class="review-center-grid">
          <div class="review-list-panel">
            <label class="thread-search">
              <span>Search reviews</span>
              <input [(ngModel)]="reviewQuery" (ngModelChange)="filterReviews()" placeholder="Client, review, staff, platform" />
            </label>
            <button
              class="review-row"
              type="button"
              *ngFor="let review of visibleReviews()"
              [class.active]="selectedReview()?.id === review.id"
              (click)="selectReviewForResponse(review)"
            >
              <div>
                <strong>{{ review.client?.name || review.reviewerName || review.reviewer || 'Review client' }}</strong>
                <span>{{ review.platformName || review.platform || 'Review' }} · {{ review.reviewDate | auraDate:'date' }}</span>
              </div>
              <small [class]="'risk-pill ' + (review.riskLevel || 'low')">{{ review.rating || 0 }}/5</small>
              <p>{{ review.reviewText || 'No review text captured.' }}</p>
            </button>
            <div class="empty-state compact" *ngIf="!visibleReviews().length && !reviewLoading()">
              <strong>No reviews found</strong>
              <span>Live reputation reviews will appear here.</span>
            </div>
          </div>

          <div class="review-detail-panel" *ngIf="selectedReview() as review; else noReviewSelected">
            <section class="drawer-section">
              <div class="review-title-row">
                <div>
                  <span class="eyebrow">{{ review.platformName || review.platform || 'Review' }}</span>
                  <h3>{{ review.client?.name || review.reviewerName || review.reviewer || 'Client review' }}</h3>
                  <p>{{ review.serviceStaffLabel || 'Service/staff not linked' }}</p>
                </div>
                <span [class]="'risk-pill ' + (review.riskLevel || 'low')">{{ review.riskLevel || 'low' }}</span>
              </div>
              <div class="info-grid">
                <div><strong>{{ review.rating || 0 }} / {{ review.ratingMax || 5 }}</strong></div>
                <div><strong>{{ review.reviewDate | auraDate:'date' }}</strong></div>
                <div><strong>{{ review.client?.name || review.reviewerName || '-' }}</strong></div>
                <div><strong>{{ review.serviceStaffLabel || '-' }}</strong></div>
              </div>
              <p class="review-text-block">{{ review.reviewText || 'No review text captured.' }}</p>
            </section>

            <section class="drawer-section">
              <div class="card-header-row">
                <select [(ngModel)]="reviewTone">
                  <option value="warm">Warm</option>
                  <option value="professional">Professional</option>
                  <option value="apology">Apology</option>
                  <option value="retention">Retention</option>
                </select>
              </div>
              <textarea [(ngModel)]="reviewResponseText" placeholder="Generate or edit the response before approval"></textarea>
              <div class="composer-footer">
                <span>{{ review.replyApprovalStatus || 'pending' }} · {{ reviewProviderStatus() || 'provider not configured until posting' }}</span>
                <div>
                  <button class="ghost-button" type="button" (click)="generateReviewResponse()" [disabled]="reviewSaving()">Generate AI</button>
                  <button class="primary-button" type="button" (click)="approveReviewResponse()" [disabled]="reviewSaving() || !reviewResponseText.trim()">Approve</button>
                  <button class="ghost-button" type="button" (click)="sendReviewResponse()" [disabled]="reviewSaving()">Send/post placeholder</button>
                </div>
              </div>
            </section>
          </div>
          <ng-template #noReviewSelected>
            <div class="conversation-empty">
              <strong>Select a review</strong>
              <span>Rating, text, AI response, tone and audit-safe actions will appear here.</span>
            </div>
          </ng-template>
        </section>
      </aside>

      <div class="drawer-backdrop" *ngIf="aiSummaryDrawerOpen()" (click)="closeAiSummaryDrawer()"></div>
      <aside class="ai-summary-drawer" *ngIf="aiSummaryDrawerOpen()" role="dialog" aria-label="AI guest summary drawer">
        <header class="drawer-head">
          <div>
            <h3>{{ clientProfile()?.name || selectedThread()?.displayName || 'Linked client' }}</h3>
            <p *ngIf="generatedAiSummary()">
              Version {{ generatedAiSummary()?.version || 1 }} · Generated
              {{ (generatedAiSummary()?.generatedAt || generatedAiSummary()?.generated_at) | auraDate:'date' }}
              · Confidence {{ confidencePercent(generatedAiSummary()?.confidence) }}
            </p>
            <p *ngIf="!generatedAiSummary()">Deterministic local summary will be used when AI provider is not configured.</p>
          </div>
          <button class="ghost-button mini icon-button" type="button" (click)="closeAiSummaryDrawer()" aria-label="Close AI guest summary">x</button>
        </header>

        <app-state [loading]="aiSummaryGenerating()" [error]="aiSummaryError()"></app-state>

        <button class="primary-button" type="button" (click)="generateAiSummary()" [disabled]="aiSummaryGenerating() || !selectedThread()?.clientId">
          {{ generatedAiSummary() ? 'Regenerate summary' : 'Generate summary' }}
        </button>

        <section class="drawer-section summary-overview">
          <p>{{ latestAiSummaryText() }}</p>
        </section>

        <section class="drawer-section">
          <div class="summary-list">
            <article *ngFor="let item of summaryArray('insights')">
              <strong>{{ summaryItemTitle(item) }}</strong>
              <span>{{ summaryItemText(item) }}</span>
            </article>
            <article *ngIf="!summaryArray('insights').length"><strong>No insights yet</strong><span>Generate a summary to analyze recent visits, spend and preferences.</span></article>
          </div>
        </section>

        <section class="drawer-section">
          <div class="summary-list">
            <article *ngFor="let item of summaryArray('suggestions')">
              <strong>{{ summaryItemTitle(item) }}</strong>
              <span>{{ summaryItemText(item) }}</span>
            </article>
            <article *ngIf="!summaryArray('suggestions').length"><strong>No suggestions yet</strong><span>Likely upsell and retention ideas will appear here.</span></article>
          </div>
        </section>

        <section class="drawer-section">
          <div class="summary-list">
            <article *ngFor="let item of summaryArray('alerts')">
              <strong>{{ summaryItemTitle(item) }}</strong>
              <span>{{ summaryItemText(item) }}</span>
            </article>
            <article *ngIf="!summaryArray('alerts').length"><strong>No alerts</strong><span>No due, expiry, birthday or package alerts are currently detected.</span></article>
          </div>
        </section>

        <section class="drawer-section">
          <div class="summary-list">
            <article *ngFor="let item of summaryArray('risks')" class="risk-item">
              <strong>{{ summaryItemTitle(item) }} <em>{{ item.riskLevel || 'low' }}</em></strong>
              <span>{{ summaryItemText(item) }}</span>
            </article>
            <article *ngIf="!summaryArray('risks').length"><strong>No risks detected</strong><span>Churn, due balance and no-show risks will appear when evidence exists.</span></article>
          </div>
        </section>

        <section class="drawer-section">
          <div class="summary-list">
            <article *ngFor="let item of summaryArray('nextBestActions')">
              <strong>{{ summaryItemTitle(item) }}</strong>
              <span>{{ summaryItemText(item) }}</span>
            </article>
            <article *ngIf="!summaryArray('nextBestActions').length"><strong>No action yet</strong><span>Generate the summary to get the next best action.</span></article>
          </div>
        </section>
      </aside>

      <ng-template #threadCard let-thread="thread">
        <div class="thread-top">
          <strong>{{ thread.displayName || thread.subject || 'Unknown client' }}</strong>
          <span class="channel-pill">{{ thread.primaryChannel || thread.type }}</span>
        </div>
        <p>{{ thread.lastMessagePreview || thread.subject || 'No preview yet' }}</p>
        <div class="thread-meta">
          <span>{{ thread.status }}</span>
          <span *ngIf="thread.unreadCount" class="unread">{{ thread.unreadCount }} unread</span>
          <span *ngIf="isSlaOverdue(thread)" class="sla">SLA overdue</span>
        </div>
      </ng-template>

      <ng-template #emptyConversation>
        <div class="conversation-empty">
          <strong>No thread selected</strong>
          <span>Select a recent thread or create a new one.</span>
          <button class="primary-button" type="button" (click)="startNewThread()">Create thread</button>
        </div>
      </ng-template>

      <ng-template #noClient>
        <section class="client-card aura-card no-client">
          <h3>Thread is not linked to a client</h3>
        </section>
      </ng-template>
    </section>
  `,
  styles: [`
    .engagement-page { display: grid; gap: 16px; }
    .engagement-hero { align-items: center; }
    .engagement-shell { display: grid; grid-template-columns: minmax(260px, 320px) minmax(420px, 1fr) minmax(280px, 360px); gap: 14px; align-items: start; }
    .thread-rail, .conversation-panel, .client-rail { min-width: 0; }
    .thread-rail, .conversation-panel, .client-card { border: 1px solid #dce5e2; background: #fff; border-radius: 8px; box-shadow: 0 12px 30px rgba(15, 23, 42, .05); }
    .thread-rail { padding: 14px; display: grid; gap: 16px; max-height: calc(100vh - 220px); overflow: auto; }
    .rail-section { display: grid; gap: 10px; }
    .rail-title, .field span, .thread-search span, .composer label span { color: #526173; font-size: 12px; font-weight: 800; text-transform: uppercase; }
    .channel-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
    .channel-grid button, .composer-tabs button { border: 1px solid #d8e3df; background: #f8faf9; border-radius: 8px; padding: 9px; display: flex; justify-content: space-between; gap: 8px; cursor: pointer; }
    .channel-grid button.active, .composer-tabs button.active { border-color: #55173D; color: #2A091E; background: #EDE2EA; }
    .thread-search { display: grid; gap: 6px; }
    .thread-search input, .composer select, .composer textarea, .conversation-actions select { border: 1px solid #d8e3df; border-radius: 8px; padding: 10px 12px; font: inherit; width: 100%; }
    .thread-card { text-align: left; border: 1px solid #e3ebe8; background: #fff; border-radius: 8px; padding: 12px; cursor: pointer; display: grid; gap: 7px; }
    .thread-card.active { border-color: #55173D; box-shadow: inset 3px 0 0 #55173D; }
    .thread-top, .thread-meta, .conversation-header, .composer-footer, .timeline-topline { display: flex; justify-content: space-between; gap: 10px; align-items: center; }
    .thread-card p { margin: 0; color: #53657d; font-size: 13px; line-height: 1.35; }
    .thread-meta { color: #607083; font-size: 12px; flex-wrap: wrap; justify-content: flex-start; }
    .channel-pill, .badge, .tag-row span, .unread, .sla { display: inline-flex; align-items: center; border-radius: 999px; padding: 4px 8px; font-size: 11px; font-weight: 800; background: #eef5f3; color: #4B1238; }
    .unread { background: #e7f0ff; color: #2855a7; }
    .sla, .badge.danger { background: #fdecec; color: #b42318; }
    .badge.pending { background: #fff3d1; color: #8a5a00; }
    .conversation-panel { min-height: calc(100vh - 220px); display: grid; grid-template-rows: auto minmax(260px, 1fr) auto; overflow: hidden; }
    .conversation-header { padding: 16px 18px; border-bottom: 1px solid #e3ebe8; }
    .conversation-header h3 { margin: 4px 0; font-size: 24px; }
    .conversation-header p { margin: 0; color: #53657d; }
    .conversation-actions { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
    .timeline { padding: 18px; display: grid; gap: 12px; overflow: auto; max-height: calc(100vh - 430px); align-content: start; background: #fbfdfc; }
    .timeline-item { display: grid; grid-template-columns: 32px minmax(0, 1fr); gap: 10px; max-width: 80%; }
    .timeline-item.outbound { justify-self: end; }
    .timeline-item > div { border: 1px solid #e0e8e5; background: #fff; border-radius: 8px; padding: 12px; }
    .timeline-item.outbound > div { background: #EEE3EB; border-color: #D4B8CC; }
    .timeline-item.event > div { background: #f8fafc; }
    .timeline-dot { width: 28px; height: 28px; border-radius: 999px; display: grid; place-items: center; background: #eef5f3; color: #4B1238; font-size: 12px; font-weight: 900; }
    .timeline-item p { margin: 6px 0 0; color: #1f2937; white-space: pre-wrap; }
    .chip-row, .tag-row { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 8px; }
    .composer { border-top: 1px solid #e3ebe8; padding: 14px; display: grid; gap: 10px; background: #fff; }
    .composer-tabs { display: flex; gap: 8px; }
    .composer-toolbar { display: grid; grid-template-columns: 150px minmax(180px, 1fr) auto; gap: 10px; align-items: end; }
    .composer label { display: grid; gap: 5px; }
    .composer textarea { min-height: 92px; resize: vertical; }
    .attachment-placeholder { border: 1px dashed #c9d8d4; border-radius: 8px; padding: 10px; color: #607083; background: #f8faf9; }
    .pending-text { color: #8a5a00; font-weight: 800; }
    .client-rail { display: grid; gap: 14px; max-height: calc(100vh - 220px); overflow: auto; }
    .client-card { padding: 16px; display: grid; gap: 10px; }
    .client-card h3 { margin: 0; }
    .client-card p { margin: 0; color: #53657d; line-height: 1.45; }
    .card-header-row { display: flex; justify-content: space-between; gap: 10px; align-items: center; }
    .client-card .muted-line { color: #6b788a; font-size: 12px; }
    .info-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
    .info-grid div, .mini-list article, .alert-list div { border: 1px solid #edf2f0; border-radius: 8px; padding: 10px; background: #fbfdfc; display: grid; gap: 4px; }
    .info-grid small, .mini-list span, .alert-list span { color: #607083; }
    .mini-list, .alert-list { display: grid; gap: 8px; }
    .drawer-backdrop { position: fixed; inset: 0; background: rgba(15, 23, 42, .32); z-index: 70; }
    .ai-summary-drawer, .booking-drawer, .review-response-drawer, .recovery-drawer, .risk-drawer, .sla-drawer, .reports-drawer, .provider-drawer, .audit-drawer { position: fixed; top: 0; right: 0; bottom: 0; width: min(460px, 94vw); background: #fff; border-left: 1px solid #dce5e2; box-shadow: -24px 0 60px rgba(15, 23, 42, .22); z-index: 80; padding: 20px; overflow: auto; display: grid; gap: 14px; align-content: start; }
    .booking-drawer { width: min(620px, 96vw); }
    .review-response-drawer { width: min(920px, 98vw); }
    .recovery-drawer { width: min(1080px, 98vw); }
    .risk-drawer { width: min(1120px, 98vw); }
    .sla-drawer { width: min(1120px, 98vw); }
    .reports-drawer { width: min(1240px, 98vw); }
    .provider-drawer { width: min(1120px, 98vw); }
    .audit-drawer { width: min(1060px, 98vw); }
    .drawer-head { display: flex; justify-content: space-between; gap: 14px; align-items: start; border-bottom: 1px solid #e5eeeb; padding-bottom: 14px; }
    .drawer-head h3 { margin: 4px 0; font-size: 24px; }
    .drawer-head p, .summary-overview p { margin: 0; color: #53657d; line-height: 1.45; }
    .icon-button { width: 36px; height: 36px; padding: 0; display: grid; place-items: center; font-size: 18px; }
    .drawer-section { border: 1px solid #e1ebe7; border-radius: 8px; padding: 14px; display: grid; gap: 10px; background: #fbfdfc; }
    .booking-grid-section { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .booking-grid-section label, .drawer-section label { display: grid; gap: 6px; color: #526173; font-size: 12px; font-weight: 800; text-transform: uppercase; }
    .booking-grid-section input, .booking-grid-section select, .booking-grid-section textarea { border: 1px solid #d8e3df; border-radius: 8px; padding: 10px 12px; font: inherit; color: #111827; text-transform: none; font-weight: 500; background: #fff; }
    .booking-grid-section textarea { min-height: 80px; resize: vertical; }
    .full-span, .toggle-grid { grid-column: 1 / -1; }
    .toggle-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; }
    .toggle-grid label { border: 1px solid #e1ebe7; border-radius: 8px; background: #fff; padding: 10px; display: flex; align-items: center; gap: 8px; text-transform: none; }
    .warning-stack { display: flex; gap: 8px; flex-wrap: wrap; }
    .slot-list { display: grid; gap: 8px; }
    .slot-list button { text-align: left; border: 1px solid #E7DDD6; background: #fff; border-radius: 8px; padding: 11px 12px; display: grid; gap: 4px; cursor: pointer; }
    .slot-list button.active { border-color: #55173D; box-shadow: inset 3px 0 0 #55173D; background: #EEE3EB; }
    .slot-list span { color: #607083; }
    .review-box .primary-button { width: 100%; justify-content: center; }
    .review-center-grid { display: grid; grid-template-columns: 320px minmax(0, 1fr); gap: 14px; min-height: 0; }
    .review-list-panel, .review-detail-panel { border: 1px solid #e1ebe7; border-radius: 8px; background: #fbfdfc; padding: 12px; display: grid; gap: 10px; align-content: start; }
    .review-list-panel { max-height: calc(100vh - 150px); overflow: auto; }
    .review-row { border: 1px solid #E7DDD6; border-radius: 8px; background: #fff; padding: 11px; text-align: left; display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 6px 10px; cursor: pointer; }
    .review-row.active { border-color: #55173D; box-shadow: inset 3px 0 0 #55173D; background: #F0E6EE; }
    .review-row span, .review-row p { color: #607083; }
    .review-row p { grid-column: 1 / -1; margin: 0; line-height: 1.4; }
    .review-title-row { display: flex; justify-content: space-between; gap: 12px; align-items: start; }
    .review-title-row h3 { margin: 4px 0; }
    .review-text-block { margin: 0; line-height: 1.6; color: #26364b; background: #fff; border: 1px solid #edf2f0; border-radius: 8px; padding: 12px; }
    .risk-pill { border-radius: 999px; padding: 5px 9px; font-weight: 900; font-size: 12px; background: #e7f7ef; color: #7A4A28; text-transform: uppercase; white-space: nowrap; }
    .risk-pill.medium { background: #fff3d1; color: #8a5a00; }
    .risk-pill.high, .risk-pill.critical { background: #fdecec; color: #b42318; }
    .review-detail-panel textarea { min-height: 150px; resize: vertical; border: 1px solid #d8e3df; border-radius: 8px; padding: 10px 12px; font: inherit; color: #111827; background: #fff; }
    .review-detail-panel select { border: 1px solid #d8e3df; border-radius: 8px; padding: 9px 12px; font: inherit; color: #111827; background: #fff; }
    .recovery-toolbar { display: grid; grid-template-columns: minmax(220px, 1fr) auto; gap: 12px; align-items: end; }
    .recovery-kpis { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; }
    .recovery-kpis article { border: 1px solid #e1ebe7; border-radius: 8px; background: #fbfdfc; padding: 12px; display: grid; gap: 3px; }
    .recovery-kpis small { color: #607083; font-weight: 800; text-transform: uppercase; }
    .recovery-kpis strong { font-size: 22px; }
    .recovery-board { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
    .recovery-card { border: 1px solid #E7DDD6; border-radius: 8px; background: #fff; padding: 14px; display: grid; gap: 10px; }
    .recovery-card-head, .recovery-footer { display: flex; justify-content: space-between; gap: 12px; align-items: start; }
    .recovery-card h4 { margin: 3px 0 0; font-size: 18px; }
    .recovery-reason, .suggested-message { margin: 0; color: #526173; line-height: 1.45; }
    .suggested-message { border: 1px dashed #cfe0dc; border-radius: 8px; background: #f8faf9; padding: 10px; color: #26364b; }
    .risk-toolbar { display: grid; grid-template-columns: minmax(220px, 1fr) 150px 180px auto; gap: 12px; align-items: end; }
    .risk-toolbar label { display: grid; gap: 6px; color: #526173; font-size: 12px; font-weight: 800; text-transform: uppercase; }
    .risk-toolbar select { border: 1px solid #d8e3df; border-radius: 8px; padding: 10px 12px; font: inherit; color: #111827; background: #fff; }
    .risk-kpis { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; }
    .risk-kpis article { border: 1px solid #e1ebe7; border-radius: 8px; background: #fbfdfc; padding: 12px; display: grid; gap: 3px; }
    .risk-kpis small { color: #607083; font-weight: 800; text-transform: uppercase; }
    .risk-kpis strong { font-size: 22px; }
    .risk-board { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
    .risk-card { border: 1px solid #E7DDD6; border-radius: 8px; background: #fff; padding: 14px; display: grid; gap: 10px; }
    .risk-card-head, .risk-footer, .risk-evidence { display: flex; justify-content: space-between; gap: 12px; align-items: start; }
    .risk-card h4 { margin: 3px 0 0; font-size: 18px; }
    .risk-reason { margin: 0; color: #526173; line-height: 1.45; }
    .risk-evidence { color: #607083; font-size: 12px; align-items: center; }
    .risk-footer { align-items: center; flex-wrap: wrap; }
    .risk-footer > div { display: flex; gap: 8px; flex-wrap: wrap; justify-content: end; }
    .sla-kpis { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; }
    .sla-kpis article { border: 1px solid #e1ebe7; border-radius: 8px; background: #fbfdfc; padding: 12px; display: grid; gap: 3px; }
    .sla-kpis small { color: #607083; font-weight: 800; text-transform: uppercase; }
    .sla-kpis strong { font-size: 22px; }
    .sla-grid { display: grid; grid-template-columns: minmax(0, 1.35fr) minmax(300px, .65fr); gap: 12px; }
    .section-title-row, .sla-row { display: flex; justify-content: space-between; gap: 12px; align-items: start; }
    .section-title-row h4, .drawer-section h4 { margin: 3px 0 0; }
    .sla-overdue-list { display: grid; gap: 10px; }
    .sla-row { border: 1px solid #E7DDD6; border-radius: 8px; background: #fff; padding: 12px; align-items: center; }
    .sla-row > div:first-child { display: grid; gap: 4px; min-width: 0; }
    .sla-row span, .sla-row small { color: #607083; }
    .sla-row-metrics { display: grid; gap: 5px; justify-items: end; min-width: 150px; }
    .staff-performance-table { border: 1px solid #e1ebe7; border-radius: 8px; overflow: auto; background: #fff; }
    .staff-performance-head, .staff-performance-row { display: grid; grid-template-columns: minmax(170px, 1.2fr) repeat(6, minmax(110px, 1fr)); gap: 10px; align-items: center; min-width: 920px; padding: 11px 12px; border-bottom: 1px solid #edf2f0; }
    .staff-performance-head { background: #f5f8f7; color: #53657d; font-size: 12px; font-weight: 900; text-transform: uppercase; }
    .staff-performance-row:last-child { border-bottom: 0; }
    .staff-performance-row span { color: #26364b; }
    .reports-toolbar { display: grid; grid-template-columns: repeat(4, minmax(150px, 1fr)); gap: 12px; align-items: end; }
    .reports-toolbar label { display: grid; gap: 6px; color: #526173; font-size: 12px; font-weight: 800; text-transform: uppercase; }
    .reports-toolbar input, .reports-toolbar select { border: 1px solid #d8e3df; border-radius: 8px; padding: 10px 12px; font: inherit; color: #111827; background: #fff; text-transform: none; font-weight: 500; min-width: 0; }
    .reports-actions { display: flex; gap: 8px; flex-wrap: wrap; justify-content: end; align-items: center; grid-column: span 2; }
    .reports-kpis { display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)); gap: 10px; }
    .reports-kpis article { border: 1px solid #e1ebe7; border-radius: 8px; background: #fbfdfc; padding: 12px; display: grid; gap: 3px; min-width: 0; }
    .reports-kpis small { color: #607083; font-weight: 800; text-transform: uppercase; }
    .reports-kpis strong { font-size: 21px; overflow-wrap: anywhere; }
    .reports-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; align-items: start; }
    .reports-grid .wide { grid-column: 1 / -1; }
    .report-table { border: 1px solid #e1ebe7; border-radius: 8px; overflow: auto; background: #fff; }
    .report-table-head, .report-table-row { display: grid; gap: 10px; align-items: center; min-width: 780px; padding: 10px 12px; border-bottom: 1px solid #edf2f0; }
    .report-table.compact .report-table-head, .report-table.compact .report-table-row { min-width: 560px; }
    .report-table-head { background: #f5f8f7; color: #53657d; font-size: 12px; font-weight: 900; text-transform: uppercase; }
    .report-table-row:last-child { border-bottom: 0; }
    .report-table-row span { color: #26364b; }
    .report-table-head.five, .report-table-row.five { grid-template-columns: minmax(170px, 1.3fr) repeat(4, minmax(82px, 1fr)); }
    .report-table-head.six, .report-table-row.six { grid-template-columns: minmax(170px, 1.4fr) repeat(5, minmax(95px, 1fr)); }
    .lead-intelligence-panel { background: #fff; border-top: 1px solid #d8e1ea; border-bottom: 1px solid #d8e1ea; padding: 16px; display: grid; gap: 14px; }
    .lead-table-wrap { overflow-x: auto; border: 1px solid #d8e3df; border-radius: 4px; background: #fff; }
    .lead-table-head, .lead-table-row { display: grid; grid-template-columns: 130px 110px 150px 120px 170px 120px 110px 140px 100px 140px 130px 110px 170px 300px; gap: 10px; align-items: center; min-width: 2100px; padding: 10px 12px; border-bottom: 1px solid #edf2f0; }
    .lead-table-head { background: #f5f8f7; color: #53657d; font-size: 12px; font-weight: 900; text-transform: uppercase; }
    .lead-table-row:last-child { border-bottom: 0; }
    .lead-table-row span { overflow-wrap: anywhere; }
    .lead-actions { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; }
    .audit-toolbar { display: grid; grid-template-columns: minmax(240px, 1fr) auto; gap: 12px; align-items: end; }
    .audit-table { border: 1px solid #e1ebe7; border-radius: 8px; overflow: auto; background: #fff; }
    .audit-table-head, .audit-table-row { display: grid; grid-template-columns: 150px minmax(190px, 1.2fr) minmax(160px, 1fr) minmax(120px, .8fr) minmax(190px, 1fr) minmax(120px, .8fr); gap: 10px; align-items: center; min-width: 930px; padding: 11px 12px; border-bottom: 1px solid #edf2f0; }
    .audit-table-head { background: #f5f8f7; color: #53657d; font-size: 12px; font-weight: 900; text-transform: uppercase; }
    .audit-table-row:last-child { border-bottom: 0; }
    .audit-table-row span { color: #526173; }
    .priority-pill { border-radius: 999px; padding: 5px 9px; font-size: 12px; font-weight: 900; text-transform: uppercase; background: #e7f7ef; color: #7A4A28; white-space: nowrap; }
    .priority-pill.normal { background: #eef5f3; color: #4B1238; }
    .priority-pill.high { background: #fff3d1; color: #8a5a00; }
    .priority-pill.urgent { background: #fdecec; color: #b42318; }
    .summary-list { display: grid; gap: 8px; }
    .summary-list article { border: 1px solid #edf2f0; border-radius: 8px; background: #fff; padding: 10px; display: grid; gap: 4px; }
    .summary-list span { color: #607083; line-height: 1.4; }
    .summary-list em { margin-left: 6px; border-radius: 999px; padding: 2px 7px; background: #fff3d1; color: #8a5a00; font-style: normal; font-size: 11px; text-transform: uppercase; }
    .risk-item em { background: #fdecec; color: #b42318; }
    .conversation-empty { min-height: calc(100vh - 220px); display: grid; place-items: center; align-content: center; gap: 10px; color: #53657d; text-align: center; padding: 30px; }
    .conversation-empty strong { color: #111827; font-size: 22px; }
    .state.info { background: #eef8ff; border: 1px solid #E7DDD6; color: #1d4e89; padding: 12px 14px; border-radius: 8px; }
    .action-queue-strip { border: 1px solid #dce5e2; background: #fff; border-radius: 8px; padding: 14px; display: grid; gap: 12px; box-shadow: 0 12px 30px rgba(15, 23, 42, .05); }
    .action-queue-strip p { margin: 3px 0 0; color: #53657d; line-height: 1.45; }
    .action-queue-grid { display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)); gap: 10px; }
    .action-queue-card { text-align: left; border: 1px solid #e1ebe7; border-radius: 8px; background: #fbfdfc; padding: 12px; display: grid; gap: 6px; min-width: 0; cursor: pointer; }
    .action-queue-card:hover { border-color: #55173D; background: #F0E6EE; }
    .action-queue-card.urgent { border-color: #f4b4ae; background: #fff8f7; }
    .action-queue-card.high { border-color: #f4d28c; background: #fffaf0; }
    .action-queue-card strong { font-size: 24px; color: #111827; }
    .action-queue-card span:not(.badge) { font-weight: 900; color: #26364b; overflow-wrap: anywhere; }
    .action-queue-card small { color: #607083; line-height: 1.35; }
    .empty-state.compact { padding: 18px 12px; }
    .zenoti-engagement-page { gap: 8px; padding: 8px; color: #1d2430; background: #f0f2f5; min-height: calc(100vh - 20px); }
    .command-bar { display: flex; justify-content: space-between; align-items: center; gap: 16px; padding: 14px 20px; background: #111827; color: #fff; border-bottom: 1px solid #d8e1ea; }
    .brand-block, .top-actions, .center-line, .header-actions, .zenoti-shortcuts { display: flex; align-items: center; gap: 10px; }
    .brand-mark { width: 34px; height: 34px; display: grid; place-items: center; border-radius: 8px; background: #6d5bd0; color: #fff; font-weight: 900; }
    .brand-block small, .zenoti-search span { display: block; color: #8fa1b8; font-size: 11px; font-weight: 800; text-transform: uppercase; }
    .brand-block strong { display: block; color: #fff; font-size: 15px; }
    .zenoti-button, .zenoti-shortcuts button { border: 1px solid #b9cbe0; background: #fff; color: #0065a8; border-radius: 3px; padding: 8px 13px; font-weight: 800; cursor: pointer; }
    .zenoti-button.primary, .zenoti-shortcuts .active { background: #55173D; border-color: #55173D; color: #fff; }
    .zenoti-header { background: #fff; }
    .zenoti-page-heading { background: #fff; border: 1px solid #d8e1ea; }
    .zenoti-shortcuts { background: #fff; border: 1px solid #d8e1ea; }
    .zenoti-header { display: grid; gap: 10px; padding: 18px 16px 12px; }
    .center-line { justify-content: space-between; }
    .center-line strong { font-size: 15px; }
    .command-select { width: 100%; padding: 9px 12px; border: 1px solid #b9cbe0; border-radius: 3px; color: #111827; font-weight: 800; background: #fff; }
    .zenoti-page-heading { display: flex; justify-content: space-between; gap: 16px; padding: 16px; align-items: end; }
    .zenoti-page-heading h1 { margin: 0; font-size: 22px; color: #172033; }
    .zenoti-page-heading p { margin: 6px 0 0; color: #36506d; font-size: 13px; }
    .zenoti-search { width: min(100%, 340px); display: grid; gap: 5px; }
    .zenoti-search input { width: 100%; border: 1px solid #cbd8e5; border-radius: 3px; padding: 9px 11px; font: inherit; background: #fff; color: #172033; }
    .zenoti-shortcuts { flex-wrap: wrap; padding: 10px 16px; }
    .zenoti-shortcuts button { padding: 7px 12px; }
    .zenoti-engagement-page .state.info,
    .zenoti-engagement-page .state.error { border-radius: 0; margin: 0; border-left: 0; border-right: 0; }
    .zenoti-engagement-page .action-queue-strip { border: 0; border-radius: 0; box-shadow: none; padding: 14px 16px; }
    .zenoti-engagement-page .action-queue-card,
    .zenoti-engagement-page .thread-rail,
    .zenoti-engagement-page .conversation-panel,
    .zenoti-engagement-page .client-card,
    .zenoti-engagement-page .timeline-item > div,
    .zenoti-engagement-page .info-grid div,
    .zenoti-engagement-page .mini-list article,
    .zenoti-engagement-page .alert-list div,
    .zenoti-engagement-page .composer,
    .zenoti-engagement-page .attachment-placeholder,
    .zenoti-engagement-page .drawer-section,
    .zenoti-engagement-page .review-list-panel,
    .zenoti-engagement-page .review-detail-panel,
    .zenoti-engagement-page .recovery-card,
    .zenoti-engagement-page .risk-card,
    .zenoti-engagement-page .report-table,
    .zenoti-engagement-page .audit-table,
    .zenoti-engagement-page .summary-list article { border-radius: 0; box-shadow: none; }
    .zenoti-engagement-page .engagement-shell { grid-template-columns: minmax(270px, 320px) minmax(460px, 1fr) minmax(280px, 360px); gap: 0; align-items: stretch; border-top: 1px solid #d8e1ea; }
    .zenoti-engagement-page .thread-rail,
    .zenoti-engagement-page .conversation-panel,
    .zenoti-engagement-page .client-rail { max-height: calc(100vh - 260px); border: 0; border-right: 1px solid #d8e1ea; background: #fff; }
    .zenoti-engagement-page .client-rail { border-right: 0; padding: 0; gap: 0; }
    .zenoti-engagement-page .thread-rail { padding: 12px; gap: 12px; }
    .zenoti-engagement-page .conversation-panel { min-height: calc(100vh - 260px); }
    .zenoti-engagement-page .client-card { border: 0; border-bottom: 1px solid #d8e1ea; padding: 14px 16px; }
    .zenoti-engagement-page .conversation-header { padding: 14px 16px; border-bottom: 1px solid #d8e1ea; }
    .zenoti-engagement-page .conversation-header h3 { font-size: 20px; }
    .zenoti-engagement-page .timeline { background: #f8fafc; padding: 14px 16px; max-height: calc(100vh - 500px); }
    .zenoti-engagement-page .composer { padding: 12px 16px; border-top: 1px solid #d8e1ea; }
    .zenoti-engagement-page .channel-grid button,
    .zenoti-engagement-page .composer-tabs button,
    .zenoti-engagement-page .thread-card,
    .zenoti-engagement-page .slot-list button,
    .zenoti-engagement-page .review-row { border-radius: 0; }
    .zenoti-engagement-page input,
    .zenoti-engagement-page select,
    .zenoti-engagement-page textarea { border-radius: 3px !important; }
    .zenoti-engagement-page .primary-button,
    .zenoti-engagement-page .ghost-button { border-radius: 3px; }
    .zenoti-engagement-page .drawer-head { border-bottom: 1px solid #d8e1ea; }
    @media (max-width: 1280px) { .engagement-shell { grid-template-columns: 280px minmax(420px, 1fr); } .client-rail { grid-column: 1 / -1; grid-template-columns: repeat(2, minmax(0, 1fr)); max-height: none; } .action-queue-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); } }
    @media (max-width: 1040px) { .reports-toolbar, .reports-kpis, .reports-grid { grid-template-columns: 1fr; } .reports-actions { grid-column: auto; justify-content: start; } .reports-grid .wide { grid-column: auto; } }
    @media (max-width: 840px) { .engagement-shell { grid-template-columns: 1fr; } .thread-rail, .conversation-panel, .client-rail { max-height: none; } .timeline { max-height: none; } .composer-toolbar { grid-template-columns: 1fr; } .timeline-item { max-width: 100%; } .client-rail { grid-template-columns: 1fr; } .review-center-grid, .recovery-board, .recovery-kpis, .recovery-toolbar, .risk-board, .risk-kpis, .risk-toolbar, .sla-grid, .sla-kpis, .reports-toolbar, .reports-kpis, .reports-grid, .audit-toolbar, .action-queue-grid { grid-template-columns: 1fr; } .sla-row { display: grid; } .sla-row-metrics { justify-items: start; } }
  `]
})
export class EngagementCommandCenterComponent implements OnInit {
  readonly channelFilters: Array<{ key: ChannelFilter; label: string }> = [
    { key: 'all', label: 'All' },
    { key: 'whatsapp', label: 'WhatsApp' },
    { key: 'email', label: 'Email' },
    { key: 'sms', label: 'SMS' },
    { key: 'call', label: 'Calls' },
    { key: 'review', label: 'Reviews' },
    { key: 'appointment', label: 'Appts' },
    { key: 'system_alert', label: 'Alerts' }
  ];

  readonly threads = signal<EngagementThread[]>([]);
  readonly visibleThreads = signal<EngagementThread[]>([]);
  readonly selectedDetail = signal<EngagementDetail | null>(null);
  readonly selectedThreadId = signal('');
  readonly client360 = signal<ApiRecord | null>(null);
  readonly generatedAiSummary = signal<ApiRecord | null>(null);
  readonly clientProfile = signal<ApiRecord | null>(null);
  readonly appointments = signal<ApiRecord[]>([]);
  readonly walletSnapshot = signal<ApiRecord | null>(null);
  readonly alerts = signal<ApiRecord[]>([]);
  readonly templates = signal<ApiRecord[]>([]);
  readonly bookingDrawerOpen = signal(false);
  readonly bookingLoading = signal(false);
  readonly bookingSaving = signal(false);
  readonly bookingError = signal('');
  readonly bookingSuccess = signal('');
  readonly bookingBranches = signal<ApiRecord[]>([]);
  readonly bookingServices = signal<ApiRecord[]>([]);
  readonly bookingStaff = signal<ApiRecord[]>([]);
  readonly bookingSlotPreview = signal<ApiRecord | null>(null);
  readonly suggestedBookingSlots = signal<ApiRecord[]>([]);
  readonly selectedBookingSlot = signal<ApiRecord | null>(null);
  readonly recoveryDrawerOpen = signal(false);
  readonly recoveryOpportunities = signal<ApiRecord[]>([]);
  readonly visibleRecoveryOpportunities = signal<ApiRecord[]>([]);
  readonly recoveryLoading = signal(false);
  readonly recoverySaving = signal(false);
  readonly recoveryError = signal('');
  readonly recoveryNotice = signal('');
  readonly riskDrawerOpen = signal(false);
  readonly riskSignals = signal<ApiRecord[]>([]);
  readonly visibleRiskSignals = signal<ApiRecord[]>([]);
  readonly riskLoading = signal(false);
  readonly riskSaving = signal(false);
  readonly riskError = signal('');
  readonly riskNotice = signal('');
  readonly slaDrawerOpen = signal(false);
  readonly slaOverdue = signal<ApiRecord[]>([]);
  readonly slaReport = signal<ApiRecord | null>(null);
  readonly managerView = signal<ApiRecord | null>(null);
  readonly slaLoading = signal(false);
  readonly slaSaving = signal(false);
  readonly slaError = signal('');
  readonly slaNotice = signal('');
  readonly reportsDrawerOpen = signal(false);
  readonly reportData = signal<ApiRecord | null>(null);
  readonly reportsLoading = signal(false);
  readonly reportsError = signal('');
  readonly reportsNotice = signal('');
  readonly providerDrawerOpen = signal(false);
  readonly providerReadiness = signal<ApiRecord | null>(null);
  readonly providerLoading = signal(false);
  readonly providerSaving = signal(false);
  readonly providerError = signal('');
  readonly providerNotice = signal('');
  readonly auditDrawerOpen = signal(false);
  readonly auditRows = signal<ApiRecord[]>([]);
  readonly visibleAuditRows = signal<ApiRecord[]>([]);
  readonly auditLoading = signal(false);
  readonly auditError = signal('');
  readonly reviewDrawerOpen = signal(false);
  readonly reviews = signal<ApiRecord[]>([]);
  readonly visibleReviews = signal<ApiRecord[]>([]);
  readonly selectedReview = signal<ApiRecord | null>(null);
  readonly reviewLoading = signal(false);
  readonly reviewSaving = signal(false);
  readonly reviewError = signal('');
  readonly reviewNotice = signal('');
  readonly reviewProviderStatus = signal('');
  readonly activeWorkspace = signal<'inbox' | 'leads'>('inbox');
  readonly leadReport = signal<ApiRecord | null>(null);
  readonly leadLoading = signal(false);
  readonly leadSaving = signal(false);
  readonly leadError = signal('');
  readonly leadNotice = signal('');
  readonly loading = signal(true);
  readonly detailLoading = signal(false);
  readonly saving = signal(false);
  readonly error = signal('');
  readonly providerWarning = signal('');
  readonly aiSummaryError = signal('');
  readonly aiSummaryDrawerOpen = signal(false);
  readonly aiSummaryGenerating = signal(false);
  readonly channelFilter = signal<ChannelFilter>('all');
  readonly composerMode = signal<ComposerMode>('reply');

  query = '';
  composerChannel = 'whatsapp';
  composerBody = '';
  selectedTemplate = '';
  respectQuietHours = false;
  bookingForm = this.defaultBookingForm();
  recoveryQuery = '';
  riskQuery = '';
  riskLevelFilter = '';
  riskReviewStatusFilter = '';
  reportFromDate = '';
  reportToDate = '';
  reportBranchFilter = '';
  reportStaffFilter = '';
  reportChannelFilter = '';
  reportStatusFilter = '';
  reportRiskLevelFilter = '';
  reportClientSegmentFilter = '';
  reportRecoveryTypeFilter = '';
  providerForm: ApiRecord = {
    providerName: 'whatsapp_cloud',
    status: 'inactive',
    senderId: '',
    templateNamespace: '',
    webhookUrl: ''
  };
  auditQuery = '';
  reviewQuery = '';
  reviewTone = 'warm';
  reviewResponseText = '';
  reviewReplyId = '';
  leadFromDate = '';
  leadToDate = '';
  leadSourceFilter = '';
  leadStatusFilter = '';
  leadScoreFilter = '';
  leadAssignedFilter = '';
  leadFollowUpFilter = '';
  leadServiceFilter = '';
  leadBranchFilter = '';
  leadSearch = '';

  readonly selectedThread = computed(() => this.selectedDetail()?.thread || this.threads().find((thread) => thread.id === this.selectedThreadId()) || null);
  readonly leadRows = computed(() => ((this.leadReport()?.['rows'] as ApiRecord[] | undefined) || []));
  readonly pinnedThreads = computed(() => this.threads().filter((thread) => this.isPinned(thread)).slice(0, 8));
  readonly lastDraft = computed(() => {
    const detail = this.selectedDetail();
    if (!detail?.messages?.length) return null;
    return detail.messages.find((message) => message.direction === 'outbound' && ['draft', 'approved', 'send_blocked'].includes(message.status || '')) || null;
  });
  readonly pendingApprovalCount = computed(() => {
    return (this.selectedDetail()?.messages || []).filter((message) => message.approvalStatus === 'pending').length;
  });
  readonly engagementActionQueue = computed(() => {
    const actionQueue = (this.managerView()?.['actionQueue'] || {}) as ApiRecord;
    return ((actionQueue['items'] || []) as ApiRecord[]).slice(0, 6);
  });

  constructor(private readonly api: ApiService, private readonly route: ActivatedRoute) {}

  ngOnInit(): void {
    this.loadTemplates();
    this.load();
    this.route.queryParamMap.subscribe((params) => {
      if (params.get('tab') === 'leads') this.openLeadIntelligence();
    });
  }

  load(): void {
    this.loading.set(true);
    this.error.set('');
    this.providerWarning.set('');
    this.loadManagerActions();
    this.api.list<EngagementThread[]>('engagement/threads', { limit: 100 })
      .pipe(finalize(() => this.loading.set(false)))
      .subscribe({
        next: (threads) => {
          this.threads.set(threads || []);
          this.filterThreads();
          if (!this.selectedThreadId() && threads?.length) this.selectThread(threads[0].id);
          if (!threads?.length) this.selectedDetail.set(null);
        },
        error: (error) => this.error.set(error?.message || 'Unable to load engagement threads.')
      });
  }

  loadTemplates(): void {
    this.api.list<ApiRecord[]>('engagement/templates', { channel: this.composerChannel, limit: 100 }).subscribe({
      next: (templates) => this.templates.set(templates || []),
      error: (error) => this.error.set(error?.error?.error || error?.error?.message || error?.message || 'Unable to load engagement templates.')
    });
  }

  selectChannel(channel: ChannelFilter): void {
    this.channelFilter.set(channel);
    this.filterThreads();
  }

  filterThreads(): void {
    const query = this.query.trim().toLowerCase();
    const channel = this.channelFilter();
    const rows = this.threads().filter((thread) => {
      const matchesChannel = channel === 'all' || (thread.primaryChannel || thread.type) === channel;
      const haystack = `${thread.displayName || ''} ${thread.phone || ''} ${thread.email || ''} ${thread.subject || ''} ${thread.lastMessagePreview || ''}`.toLowerCase();
      return matchesChannel && (!query || haystack.includes(query));
    });
    this.visibleThreads.set(rows);
  }

  selectThread(id: string): void {
    this.selectedThreadId.set(id);
    this.detailLoading.set(true);
    this.error.set('');
    this.api.list<EngagementDetail>(`engagement/threads/${id}`)
      .pipe(finalize(() => this.detailLoading.set(false)))
      .subscribe({
        next: (detail) => {
          this.selectedDetail.set(detail);
          this.composerChannel = detail.thread?.primaryChannel || 'whatsapp';
          this.loadTemplates();
          this.loadClientContext(detail.thread);
        },
        error: (error) => this.error.set(error?.message || 'Unable to load conversation.')
      });
  }

  loadClientContext(thread?: EngagementThread): void {
    const clientId = thread?.clientId || '';
    this.client360.set(null);
    this.generatedAiSummary.set(null);
    this.aiSummaryError.set('');
    this.clientProfile.set(null);
    this.appointments.set([]);
    this.walletSnapshot.set(null);
    this.alerts.set([]);
    if (!clientId) {
      this.aiSummaryDrawerOpen.set(false);
      return;
    }
    this.api.list<ApiRecord>(`engagement/clients/${clientId}/360`).subscribe({
      next: (summary) => {
        const past = (summary?.appointments?.past || []) as ApiRecord[];
        const upcoming = (summary?.appointments?.upcoming || []) as ApiRecord[];
        this.client360.set(summary);
        this.clientProfile.set(summary?.client || null);
        this.appointments.set([...past, ...upcoming]);
        this.walletSnapshot.set(summary?.membership || null);
        this.alerts.set((summary?.alerts || []) as ApiRecord[]);
      },
      error: () => {
        this.client360.set(null);
        this.clientProfile.set(null);
        this.appointments.set([]);
        this.walletSnapshot.set(null);
        this.alerts.set([]);
      }
    });
  }

  openRecoveryDrawer(): void {
    this.recoveryDrawerOpen.set(true);
    this.recoveryError.set('');
    this.recoveryNotice.set('');
    this.loadRecoveryOpportunities();
  }

  closeRecoveryDrawer(): void {
    this.recoveryDrawerOpen.set(false);
  }

  loadRecoveryOpportunities(): void {
    this.recoveryLoading.set(true);
    this.recoveryError.set('');
    this.api.list<ApiRecord[]>('engagement/recovery-opportunities', { limit: 100 })
      .pipe(finalize(() => this.recoveryLoading.set(false)))
      .subscribe({
        next: (opportunities) => {
          this.recoveryOpportunities.set(opportunities || []);
          this.filterRecoveryOpportunities();
        },
        error: (error) => this.recoveryError.set(error?.error?.error || error?.message || 'Unable to load recovery opportunities.')
      });
  }

  filterRecoveryOpportunities(): void {
    const query = this.recoveryQuery.trim().toLowerCase();
    const rows = this.recoveryOpportunities().filter((opportunity) => {
      const haystack = [
        opportunity.title,
        opportunity.reason,
        opportunity.suggestedAction,
        opportunity.suggestedMessage,
        opportunity.opportunityType,
        opportunity.type,
        opportunity.priority,
        opportunity.status,
        opportunity.client?.name,
        opportunity.clientName,
        opportunity.assignedStaffName,
        opportunity.assignedTo
      ].join(' ').toLowerCase();
      return !query || haystack.includes(query);
    });
    this.visibleRecoveryOpportunities.set(rows);
  }

  assignRecoveryToMe(opportunity: ApiRecord): void {
    if (!opportunity?.id) return;
    this.recoverySaving.set(true);
    this.recoveryError.set('');
    this.api.post<ApiRecord>(`engagement/recovery-opportunities/${opportunity.id}/assign`, {
      assignedTo: 'current-user',
      reason: 'Claimed from Engagement Recovery Board'
    }).pipe(finalize(() => this.recoverySaving.set(false))).subscribe({
      next: (updated) => {
        this.replaceRecoveryOpportunity(updated);
        this.recoveryNotice.set('Recovery opportunity assigned.');
      },
      error: (error) => this.recoveryError.set(error?.error?.error || error?.message || 'Unable to assign recovery opportunity.')
    });
  }

  convertRecovery(opportunity: ApiRecord): void {
    if (!opportunity?.id) return;
    this.recoverySaving.set(true);
    this.recoveryError.set('');
    this.api.post<ApiRecord>(`engagement/recovery-opportunities/${opportunity.id}/create-draft`, {
      body: opportunity.suggestedMessage || opportunity.suggestedAction || '',
      channel: 'whatsapp'
    }).pipe(finalize(() => this.recoverySaving.set(false))).subscribe({
      next: (result) => {
        if (result.opportunity) this.replaceRecoveryOpportunity(result.opportunity as ApiRecord);
        this.recoveryNotice.set('Recovery draft created and pending approval.');
        if (result.thread?.id) {
          this.load();
          this.selectThread(String(result.thread.id));
        }
      },
      error: (error) => this.recoveryError.set(error?.error?.error || error?.message || 'Unable to convert recovery opportunity.')
    });
  }

  markRecoveryDone(opportunity: ApiRecord): void {
    if (!opportunity?.id) return;
    this.recoverySaving.set(true);
    this.recoveryError.set('');
    this.api.post<ApiRecord>(`engagement/recovery-opportunities/${opportunity.id}/mark-done`, {
      outcome: 'recovered',
      note: 'Marked done from Engagement Recovery Board'
    }).pipe(finalize(() => this.recoverySaving.set(false))).subscribe({
      next: (updated) => {
        this.replaceRecoveryOpportunity(updated);
        this.recoveryNotice.set('Recovery opportunity marked done.');
      },
      error: (error) => this.recoveryError.set(error?.error?.error || error?.message || 'Unable to mark recovery opportunity done.')
    });
  }

  replaceRecoveryOpportunity(updated: ApiRecord): void {
    this.recoveryOpportunities.set(this.recoveryOpportunities().map((item) => item.id === updated.id ? { ...item, ...updated } : item));
    this.filterRecoveryOpportunities();
  }

  recoveryTypeLabel(value: unknown): string {
    return String(value || 'recovery').replace(/_/g, ' ');
  }

  recoveryOpenCount(): number {
    return this.recoveryOpportunities().filter((item) => !['done', 'lost', 'archived'].includes(String(item.status || ''))).length;
  }

  recoveryHighPriorityCount(): number {
    return this.recoveryOpportunities().filter((item) => ['high', 'urgent'].includes(String(item.priority || ''))).length;
  }

  recoveryRevenueValue(): number {
    return Math.round(this.recoveryOpportunities().reduce((sum, item) => sum + Number(item.revenueValue || item.expectedValue || 0), 0));
  }

  openRiskDrawer(): void {
    this.riskDrawerOpen.set(true);
    this.riskError.set('');
    this.riskNotice.set('');
    this.loadRiskSignals();
  }

  closeRiskDrawer(): void {
    this.riskDrawerOpen.set(false);
  }

  loadRiskSignals(): void {
    this.riskLoading.set(true);
    this.riskError.set('');
    this.api.list<ApiRecord[]>('engagement/risk-signals', { limit: 150 })
      .pipe(finalize(() => this.riskLoading.set(false)))
      .subscribe({
        next: (signals) => {
          this.riskSignals.set(signals || []);
          this.filterRiskSignals();
        },
        error: (error) => this.riskError.set(error?.error?.error || error?.message || 'Unable to load engagement risk signals.')
      });
  }

  filterRiskSignals(): void {
    const query = this.riskQuery.trim().toLowerCase();
    const level = this.riskLevelFilter.trim().toLowerCase();
    const reviewStatus = this.riskReviewStatusFilter.trim().toLowerCase();
    const rows = this.riskSignals().filter((signal) => {
      const signalLevel = String(signal.riskLevel || signal.risk_level || '').toLowerCase();
      const signalReview = String(signal.reviewStatus || signal.review_status || '').toLowerCase();
      const haystack = [
        signal.title,
        signal.summary,
        signal.reason,
        signal.suggestedAction,
        signal.suggested_action,
        signal.alertType,
        signal.alert_type,
        signal.client?.name,
        signal.clientName,
        signal.staff?.name,
        signal.staffName,
        signal.status,
        signalReview,
        signalLevel
      ].join(' ').toLowerCase();
      return (!level || signalLevel === level)
        && (!reviewStatus || signalReview === reviewStatus)
        && (!query || haystack.includes(query));
    });
    this.visibleRiskSignals.set(rows);
  }

  reviewRiskSignal(signal: ApiRecord, reviewStatus: string): void {
    if (!signal?.id) return;
    this.riskSaving.set(true);
    this.riskError.set('');
    this.api.post<ApiRecord>(`engagement/risk-signals/${signal.id}/review`, {
      reviewStatus,
      resolutionNote: `Marked ${reviewStatus} from Engagement Risk Center`
    }).pipe(finalize(() => this.riskSaving.set(false))).subscribe({
      next: (updated) => {
        this.riskSignals.set(this.riskSignals().map((item) => item.id === updated.id ? { ...item, ...updated } : item));
        this.filterRiskSignals();
        this.riskNotice.set(`Risk signal marked ${updated.reviewStatus || updated.review_status || reviewStatus}.`);
      },
      error: (error) => this.riskError.set(error?.error?.error || error?.message || 'Unable to review risk signal.')
    });
  }

  riskTypeLabel(value: unknown): string {
    return String(value || 'risk_signal').replace(/_/g, ' ');
  }

  riskReason(signal: ApiRecord): string {
    return String(signal.reason || signal.summary || signal.title || 'Risk reason not captured.');
  }

  riskScoreText(signal: ApiRecord): string {
    const score = Number(signal.riskScore ?? signal.risk_score ?? 0);
    return Number.isFinite(score) ? `${Math.round(score)}/100` : '0/100';
  }

  riskEvidenceSummary(signal: ApiRecord): string {
    const evidence = Array.isArray(signal.evidence) ? signal.evidence : [];
    if (!evidence.length) return 'No evidence attached yet';
    const first = evidence[0] as ApiRecord;
    const label = first.messageId || first.appointmentId || first.invoiceId || first.reviewId || first.membershipId || first.packageId || first.clientId || 'evidence';
    return `${evidence.length} evidence item${evidence.length === 1 ? '' : 's'} · ${label}`;
  }

  riskOpenCount(): number {
    return this.riskSignals().filter((signal) => !['resolved', 'dismissed', 'archived'].includes(String(signal.status || '').toLowerCase())).length;
  }

  riskHighCount(): number {
    return this.riskSignals().filter((signal) => ['high', 'critical'].includes(String(signal.riskLevel || signal.risk_level || '').toLowerCase())).length;
  }

  riskUnreviewedCount(): number {
    return this.riskSignals().filter((signal) => String(signal.reviewStatus || signal.review_status || 'unreviewed').toLowerCase() === 'unreviewed').length;
  }

  riskAverageScore(): number {
    const rows = this.riskSignals();
    if (!rows.length) return 0;
    const total = rows.reduce((sum, signal) => sum + Number(signal.riskScore ?? signal.risk_score ?? 0), 0);
    return Math.round(total / rows.length);
  }

  openSlaDrawer(): void {
    this.slaDrawerOpen.set(true);
    this.slaError.set('');
    this.slaNotice.set('');
    this.loadSlaAccountability();
  }

  closeSlaDrawer(): void {
    this.slaDrawerOpen.set(false);
  }

  loadSlaAccountability(): void {
    this.slaLoading.set(true);
    this.slaError.set('');
    forkJoin({
      overdue: this.api.list<ApiRecord[]>('engagement/sla/overdue', { limit: 100 }),
      report: this.api.list<ApiRecord>('engagement/reports/staff-accountability'),
      manager: this.api.list<ApiRecord>('engagement/manager-view', { limit: 100 })
    }).pipe(finalize(() => this.slaLoading.set(false))).subscribe({
      next: ({ overdue, report, manager }) => {
        this.slaOverdue.set(overdue || []);
        this.slaReport.set(report || null);
        this.managerView.set(manager || null);
      },
      error: (error) => this.slaError.set(error?.error?.error || error?.message || 'Unable to load SLA accountability.')
    });
  }

  escalateThreadFromSla(item: ApiRecord): void {
    const threadId = String(item.threadId || item.thread?.id || '');
    if (!threadId) return;
    this.slaSaving.set(true);
    this.slaError.set('');
    this.api.post<EngagementThread>(`engagement/threads/${threadId}/escalate`, {
      reason: 'Escalated from Engagement SLA board',
      priority: item.priority || 'urgent'
    }).pipe(finalize(() => this.slaSaving.set(false))).subscribe({
      next: (thread) => {
        this.replaceThread(thread);
        this.slaNotice.set('Thread escalated for manager review.');
        this.loadSlaAccountability();
      },
      error: (error) => this.slaError.set(error?.error?.error || error?.message || 'Unable to escalate thread.')
    });
  }

  openReportsDrawer(): void {
    this.reportsDrawerOpen.set(true);
    this.reportsError.set('');
    this.reportsNotice.set('');
    this.loadReports();
  }

  closeReportsDrawer(): void {
    this.reportsDrawerOpen.set(false);
  }

  openEngagementQuickAction(event: Event): void {
    const action = (event.target as HTMLSelectElement).value;
    if (action === 'recovery') this.openRecoveryDrawer();
    if (action === 'reviews') this.openReviewDrawer();
    if (action === 'risk') this.openRiskDrawer();
    if (action === 'sla') this.openSlaDrawer();
    if (action === 'reports') this.openReportsDrawer();
    (event.target as HTMLSelectElement).selectedIndex = 0;
  }

  loadReports(): void {
    this.reportsLoading.set(true);
    this.reportsError.set('');
    this.reportsNotice.set('');
    this.api.list<ApiRecord>('engagement/reports', this.reportFilterParams())
      .pipe(finalize(() => this.reportsLoading.set(false)))
      .subscribe({
        next: (report) => {
          this.reportData.set(report || null);
          this.reportsNotice.set(report?.generatedAt ? `Generated ${new Date(report.generatedAt).toLocaleString()}` : '');
        },
        error: (error) => this.reportsError.set(error?.error?.error || error?.message || 'Unable to load engagement reports.')
      });
  }

  reportFilterParams(): ApiRecord {
    return {
      fromDate: this.reportFromDate,
      toDate: this.reportToDate,
      branchId: this.reportBranchFilter,
      staffId: this.reportStaffFilter,
      channel: this.reportChannelFilter,
      status: this.reportStatusFilter,
      riskLevel: this.reportRiskLevelFilter,
      clientSegment: this.reportClientSegmentFilter,
      recoveryType: this.reportRecoveryTypeFilter
    };
  }

  reportExportUrl(format: 'csv' | 'pdf'): string {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(this.reportFilterParams())) {
      if (value !== undefined && value !== null && value !== '') params.set(key, String(value));
    }
    const query = params.toString();
    return `${environment.apiBaseUrl}/engagement/reports/export/${format}${query ? `?${query}` : ''}`;
  }

  exportEngagementReport(format: 'csv' | 'pdf'): void {
    window.open(this.reportExportUrl(format), '_blank', 'noopener,noreferrer');
  }

  reportCurrency(value: unknown): string {
    const amount = Number(value || 0);
    if (!Number.isFinite(amount)) return '₹0';
    return `₹${Math.round(amount).toLocaleString('en-IN')}`;
  }

  openInboxWorkspace(): void {
    this.activeWorkspace.set('inbox');
  }

  openLeadIntelligence(): void {
    this.activeWorkspace.set('leads');
    if (!this.leadReport() && !this.leadLoading()) this.loadLeadReport();
  }

  loadLeadReport(): void {
    this.leadLoading.set(true);
    this.leadError.set('');
    this.leadNotice.set('');
    this.api.list<ApiRecord>('engagement/leads/report', this.leadFilterParams())
      .pipe(finalize(() => this.leadLoading.set(false)))
      .subscribe({
        next: (report) => {
          this.leadReport.set(report || null);
          this.leadNotice.set(report?.['generatedAt'] ? `Generated ${new Date(String(report['generatedAt'])).toLocaleString()}` : '');
        },
        error: (error) => this.leadError.set(error?.error?.error || error?.message || 'Unable to load lead intelligence.')
      });
  }

  leadFilterParams(): ApiRecord {
    return {
      fromDate: this.leadFromDate,
      toDate: this.leadToDate,
      branchId: this.leadBranchFilter || this.api.selectedBranchId(),
      source: this.leadSourceFilter,
      status: this.leadStatusFilter,
      score: this.leadScoreFilter,
      assignedTo: this.leadAssignedFilter,
      followUp: this.leadFollowUpFilter,
      service: this.leadServiceFilter,
      q: this.leadSearch,
      limit: 500
    };
  }

  leadScoreTone(row: ApiRecord): string {
    const score = String(row['leadTemperature'] || '').toLowerCase();
    if (score === 'hot') return 'high';
    if (score === 'warm') return 'medium';
    return 'low';
  }

  private leadActionPayload(row: ApiRecord, extra: ApiRecord = {}): ApiRecord {
    return {
      branchId: row['branchId'] || this.api.selectedBranchId(),
      threadId: row['threadId'] || '',
      whatsappThreadId: row['whatsappThreadId'] || '',
      clientId: row['clientId'] || '',
      invoiceId: row['wonInvoiceId'] || '',
      invoiceNumber: row['wonInvoiceNumber'] || '',
      convertedRevenue: row['convertedRevenue'] || 0,
      ...extra
    };
  }

  private runLeadAction(row: ApiRecord, endpoint: string, payload: ApiRecord, success: string): void {
    const leadId = String(row['id'] || '');
    if (!leadId) return;
    this.leadSaving.set(true);
    this.leadError.set('');
    this.api.post<ApiRecord>(`engagement/leads/${encodeURIComponent(leadId)}/${endpoint}`, payload)
      .pipe(finalize(() => this.leadSaving.set(false)))
      .subscribe({
        next: () => {
          this.leadNotice.set(success);
          this.loadLeadReport();
        },
        error: (error) => this.leadError.set(error?.error?.error || error?.message || 'Unable to update lead.')
      });
  }

  assignLead(row: ApiRecord): void {
    const assignedTo = window.prompt('Assign lead to staff/user id', String(row['assignedTo'] || ''));
    if (!assignedTo) return;
    this.runLeadAction(row, 'assign', this.leadActionPayload(row, { assignedTo, note: 'Assigned from Lead Intelligence' }), 'Lead assigned.');
  }

  addLeadFollowUp(row: ApiRecord): void {
    const note = window.prompt('Follow-up note', '');
    if (!note) return;
    this.runLeadAction(row, 'follow-up-note', this.leadActionPayload(row, { note }), 'Follow-up note added.');
  }

  markLeadWon(row: ApiRecord): void {
    const invoiceNumber = window.prompt('Won invoice number', String(row['wonInvoiceNumber'] || ''));
    if (invoiceNumber === null) return;
    const convertedRevenue = window.prompt('Converted revenue', String(row['convertedRevenue'] || 0));
    if (convertedRevenue === null) return;
    this.runLeadAction(row, 'mark-won', this.leadActionPayload(row, {
      invoiceNumber,
      convertedRevenue: Number(convertedRevenue || row['convertedRevenue'] || 0),
      note: 'Marked won from Lead Intelligence'
    }), 'Lead marked won.');
  }

  markLeadLost(row: ApiRecord): void {
    const reason = window.prompt('Lost reason', String(row['lostReason'] || ''));
    if (!reason) return;
    this.runLeadAction(row, 'mark-lost', this.leadActionPayload(row, { note: reason, lostReason: reason }), 'Lead marked lost.');
  }

  callLead(row: ApiRecord): void {
    const phone = String(row['phone'] || '').replace(/\D/g, '');
    if (phone) window.location.href = `tel:${phone}`;
  }

  whatsappLead(row: ApiRecord): void {
    const phone = String(row['phone'] || '').replace(/\D/g, '');
    if (phone) window.open(`https://wa.me/${phone}`, '_blank', 'noopener,noreferrer');
  }

  bookLead(row: ApiRecord): void {
    const clientId = String(row['clientId'] || '');
    if (!clientId) {
      this.leadError.set('Client link missing for this lead. Open WhatsApp/call first, then link the client.');
      return;
    }
    this.bookingForm = {
      ...this.defaultBookingForm(),
      clientId,
      branchId: String(row['branchId'] || this.api.selectedBranchId() || ''),
      notes: `Lead follow-up: ${row['clientName'] || row['phone'] || 'lead'} · ${row['interestService'] || 'service interest'}`
    };
    this.bookingError.set('');
    this.bookingSuccess.set('');
    this.clearBookingPreview();
    this.bookingDrawerOpen.set(true);
    this.loadBookingCatalog();
  }

  openLeadClient(row: ApiRecord): void {
    const clientId = String(row['clientId'] || '');
    if (clientId) window.open(`/clients/${encodeURIComponent(clientId)}`, '_blank', 'noopener,noreferrer');
  }

  openLeadInvoice(row: ApiRecord): void {
    const invoice = String(row['wonInvoiceNumber'] || row['wonInvoiceId'] || '');
    if (invoice) window.open(`/pos/invoices?q=${encodeURIComponent(invoice)}`, '_blank', 'noopener,noreferrer');
  }

  exportLeadCsv(): void {
    const keys = ['leadDateTime', 'source', 'clientName', 'phone', 'interestService', 'leadTemperature', 'leadScore', 'status', 'assignedName', 'firstResponseMinutes', 'followUpStatus', 'lastFollowUpAt', 'wonInvoiceNumber', 'convertedRevenue', 'lostReason'];
    const lines = [keys.join(',')];
    for (const row of this.leadRows()) {
      lines.push(keys.map((key) => this.csvCell(row[key])).join(','));
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `lead-intelligence-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  private csvCell(value: unknown): string {
    const text = String(value ?? '').replace(/"/g, '""');
    return `"${text}"`;
  }

  loadManagerActions(): void {
    this.api.list<ApiRecord>('engagement/manager-view', { limit: 100 }).subscribe({
      next: (manager) => this.managerView.set(manager || null),
      error: () => this.managerView.set(null)
    });
  }

  actionQueueTypeLabel(type: unknown): string {
    const labels: Record<string, string> = {
      pending_approval: 'Approval',
      quiet_hours: 'Quiet hours',
      delivery_attention: 'Delivery',
      conversion_tracking: 'Conversion',
      campaign_approval: 'Campaign',
      provider_readiness: 'Provider'
    };
    return labels[String(type || '')] || 'Action';
  }

  openActionQueueTarget(item: ApiRecord): void {
    const target = String(item?.['actionTarget'] || '');
    if (target === 'recovery') {
      this.openRecoveryDrawer();
      return;
    }
    if (target === 'reports') {
      this.openReportsDrawer();
      return;
    }
    if (target === 'providers') {
      this.openProviderDrawer();
      return;
    }
    this.selectChannel('whatsapp');
  }

  openProviderDrawer(): void {
    this.providerDrawerOpen.set(true);
    this.providerError.set('');
    this.providerNotice.set('');
    this.loadProviders();
  }

  closeProviderDrawer(): void {
    this.providerDrawerOpen.set(false);
  }

  loadProviders(): void {
    this.providerLoading.set(true);
    this.providerError.set('');
    this.api.list<ApiRecord>('engagement/providers/readiness')
      .pipe(finalize(() => this.providerLoading.set(false)))
      .subscribe({
        next: (readiness) => {
          this.providerReadiness.set(readiness || null);
          const providers = (readiness?.providers || []) as ApiRecord[];
          const selected = providers.find((provider) => provider.providerName === this.providerForm.providerName) || providers[0];
          if (selected) this.patchProviderForm(selected);
        },
        error: (error) => this.providerError.set(error?.error?.error || error?.message || 'Unable to load provider readiness.')
      });
  }

  selectProviderForConfig(providerName: string): void {
    const provider = ((this.providerReadiness()?.providers || []) as ApiRecord[]).find((item) => item.providerName === providerName);
    if (provider) this.patchProviderForm(provider);
  }

  patchProviderForm(provider: ApiRecord): void {
    this.providerForm = {
      providerName: String(provider.providerName || this.providerForm.providerName || 'whatsapp_cloud'),
      status: String(provider.status || 'inactive'),
      senderId: String(provider.senderId || ''),
      templateNamespace: String(provider.templateNamespace || ''),
      webhookUrl: String(provider.webhookUrl || '')
    };
  }

  saveProviderConfig(): void {
    this.providerSaving.set(true);
    this.providerError.set('');
    this.providerNotice.set('');
    this.api.post<ApiRecord>('engagement/providers/config', this.providerForm)
      .pipe(finalize(() => this.providerSaving.set(false)))
      .subscribe({
        next: (provider) => {
          this.providerNotice.set(`${provider.label || provider.providerName} saved. Direct send remains disabled until a real adapter is ready.`);
          this.loadProviders();
        },
        error: (error) => this.providerError.set(error?.error?.error || error?.message || 'Unable to save provider config.')
      });
  }

  verifyProvider(provider: ApiRecord): void {
    const id = String(provider.accountId || '');
    if (!id) return;
    this.providerSaving.set(true);
    this.providerError.set('');
    this.providerNotice.set('');
    this.api.post<ApiRecord>(`engagement/providers/${id}/verify`, { note: 'Verified from Provider Readiness drawer' })
      .pipe(finalize(() => this.providerSaving.set(false)))
      .subscribe({
        next: (result) => {
          this.providerNotice.set(`${result.label || result.providerName} readiness checked. Send mode: ${result.sendMode || 'pending_send_only'}.`);
          this.loadProviders();
        },
        error: (error) => this.providerError.set(error?.error?.error || error?.message || 'Unable to verify provider readiness.')
      });
  }

  minutesLabel(value: unknown): string {
    const numeric = Number(value || 0);
    if (!Number.isFinite(numeric) || numeric <= 0) return '0m';
    if (numeric < 60) return `${Math.round(numeric)}m`;
    return `${Math.floor(numeric / 60)}h ${Math.round(numeric % 60)}m`;
  }

  openAuditDrawer(): void {
    this.auditDrawerOpen.set(true);
    this.auditError.set('');
    this.loadAuditLedger();
  }

  closeAuditDrawer(): void {
    this.auditDrawerOpen.set(false);
  }

  loadAuditLedger(): void {
    this.auditLoading.set(true);
    this.auditError.set('');
    this.api.list<ApiRecord[]>('engagement/audit', { limit: 150 })
      .pipe(finalize(() => this.auditLoading.set(false)))
      .subscribe({
        next: (rows) => {
          this.auditRows.set(rows || []);
          this.filterAuditRows();
        },
        error: (error) => this.auditError.set(error?.error?.error || error?.message || 'Unable to load communication audit ledger.')
      });
  }

  filterAuditRows(): void {
    const query = this.auditQuery.trim().toLowerCase();
    const rows = this.auditRows().filter((row) => {
      const haystack = [
        row.action,
        row.entityType,
        row.entityId,
        row.actorUserId,
        row.actorRole,
        row.clientId,
        row.branchId,
        row.threadId
      ].join(' ').toLowerCase();
      return !query || haystack.includes(query);
    });
    this.visibleAuditRows.set(rows);
  }

  auditActionLabel(value: unknown): string {
    return String(value || 'engagement.audit').replace(/^engagement\./, '').replace(/\./g, ' ');
  }

  openReviewDrawer(): void {
    this.reviewDrawerOpen.set(true);
    this.reviewError.set('');
    this.reviewNotice.set('');
    this.loadReviews();
  }

  closeReviewDrawer(): void {
    this.reviewDrawerOpen.set(false);
  }

  loadReviews(): void {
    this.reviewLoading.set(true);
    this.reviewError.set('');
    this.api.list<ApiRecord[]>('engagement/reviews', { limit: 100 })
      .pipe(finalize(() => this.reviewLoading.set(false)))
      .subscribe({
        next: (reviews) => {
          this.reviews.set(reviews || []);
          this.filterReviews();
          const current = this.selectedReview();
          const next = current ? this.visibleReviews().find((review) => review.id === current.id) : this.visibleReviews()[0];
          if (next) this.selectReviewForResponse(next);
        },
        error: (error) => this.reviewError.set(error?.error?.error || error?.message || 'Unable to load engagement reviews.')
      });
  }

  filterReviews(): void {
    const query = this.reviewQuery.trim().toLowerCase();
    const rows = this.reviews().filter((review) => {
      const haystack = [
        review.client?.name,
        review.reviewerName,
        review.reviewer,
        review.reviewText,
        review.platformName,
        review.platform,
        review.serviceStaffLabel,
        review.riskLevel
      ].join(' ').toLowerCase();
      return !query || haystack.includes(query);
    });
    this.visibleReviews.set(rows);
  }

  selectReviewForResponse(review: ApiRecord): void {
    this.selectedReview.set(review);
    this.reviewReplyId = '';
    this.reviewProviderStatus.set('');
    this.reviewNotice.set('');
    this.reviewResponseText = String(review.replyText || review.aiReply?.reply || review.aiReply?.text || '');
    if (!this.reviewResponseText && Number(review.rating || 0) <= 3) this.reviewTone = 'apology';
  }

  generateReviewResponse(): void {
    const review = this.selectedReview();
    if (!review) return;
    this.reviewSaving.set(true);
    this.reviewError.set('');
    this.reviewNotice.set('');
    this.api.post<ApiRecord>(`engagement/reviews/${review.id}/ai-response`, { tone: this.reviewTone })
      .pipe(finalize(() => this.reviewSaving.set(false)))
      .subscribe({
        next: (result) => {
          this.reviewResponseText = String(result.aiResponse || result.reply?.replyText || '');
          this.reviewReplyId = String(result.reply?.id || '');
          this.reviewProviderStatus.set(String(result.providerStatus || 'local'));
          this.reviewNotice.set(result.negativeAlert ? 'Negative review risk alert created for manager follow-up.' : 'AI response drafted for approval.');
          if (result.review) this.replaceReview(result.review as ApiRecord);
        },
        error: (error) => this.reviewError.set(error?.error?.error || error?.message || 'Unable to generate review response.')
      });
  }

  approveReviewResponse(): void {
    const review = this.selectedReview();
    if (!review) return;
    this.reviewSaving.set(true);
    this.reviewError.set('');
    this.api.post<ApiRecord>(`engagement/reviews/${review.id}/approve-response`, {
      replyId: this.reviewReplyId,
      responseText: this.reviewResponseText,
      note: 'Approved from Engagement Review Response Center'
    }).pipe(finalize(() => this.reviewSaving.set(false))).subscribe({
      next: (result) => {
        this.reviewReplyId = String(result.reply?.id || this.reviewReplyId);
        this.reviewNotice.set('Review response approved and stored. External post still needs provider readiness.');
        if (result.review) this.replaceReview(result.review as ApiRecord);
      },
      error: (error) => this.reviewError.set(error?.error?.error || error?.message || 'Unable to approve review response.')
    });
  }

  sendReviewResponse(): void {
    const review = this.selectedReview();
    if (!review) return;
    this.reviewSaving.set(true);
    this.reviewError.set('');
    this.api.post<ApiRecord>(`engagement/reviews/${review.id}/send-response`, { replyId: this.reviewReplyId })
      .pipe(finalize(() => this.reviewSaving.set(false)))
      .subscribe({
        next: (result) => {
          this.reviewProviderStatus.set(String(result.status || 'not_configured'));
          this.reviewNotice.set(String(result.message || 'Provider not configured. Approved response remains stored only.'));
          if (result.review) this.replaceReview(result.review as ApiRecord);
        },
        error: (error) => this.reviewError.set(error?.error?.error || error?.message || 'Unable to send/post review response.')
      });
  }

  replaceReview(updated: ApiRecord): void {
    this.reviews.set(this.reviews().map((review) => review.id === updated.id ? { ...review, ...updated } : review));
    this.filterReviews();
    this.selectedReview.set({ ...(this.selectedReview() || {}), ...updated });
    this.reviewResponseText = String(updated.replyText || this.reviewResponseText || '');
  }

  startNewThread(): void {
    const displayName = window.prompt('Client name or phone for new engagement thread');
    if (!displayName) return;
    this.saving.set(true);
    this.api.post<EngagementThread>('engagement/threads', {
      type: 'whatsapp',
      subject: 'New engagement conversation',
      displayName,
      phone: displayName.replace(/\D/g, '').length >= 8 ? displayName : ''
    }).pipe(finalize(() => this.saving.set(false))).subscribe({
      next: (thread) => {
        this.threads.set([thread, ...this.threads()]);
        this.filterThreads();
        this.selectThread(thread.id);
      },
      error: (error) => this.error.set(error?.message || 'Unable to create engagement thread.')
    });
  }

  setThreadStatus(status: string): void {
    const thread = this.selectedThread();
    if (!thread) return;
    this.saving.set(true);
    this.api.patch<EngagementThread>(`engagement/threads/${thread.id}/status`, { status, reason: 'Updated from engagement command center' })
      .pipe(finalize(() => this.saving.set(false)))
      .subscribe({
        next: (updated) => this.replaceThread(updated),
        error: (error) => this.error.set(error?.message || 'Unable to update thread status.')
      });
  }

  assignToMe(): void {
    const thread = this.selectedThread();
    if (!thread) return;
    this.saving.set(true);
    this.api.patch<EngagementThread>(`engagement/threads/${thread.id}/assign`, { assignedTo: 'current-user', reason: 'Claimed from command center' })
      .pipe(finalize(() => this.saving.set(false)))
      .subscribe({
        next: (updated) => this.replaceThread(updated),
        error: (error) => this.error.set(error?.message || 'Unable to assign thread.')
      });
  }

  createDraft(): void {
    const thread = this.selectedThread();
    if (!thread) return;
    const channel = this.composerMode() === 'note' ? 'system_alert' : this.composerChannel;
    this.saving.set(true);
    this.api.post<ApiRecord>('engagement/messages/draft', {
      threadId: thread.id,
      body: this.composerBody,
      channel,
      draftType: this.composerMode() === 'note' ? 'private_note' : 'reply',
      source: this.composerMode() === 'note' ? 'private_note' : 'manual',
      approvalRequired: this.composerMode() !== 'note',
      optOutChecked: channel === 'whatsapp',
      metadata: {
        privateNote: this.composerMode() === 'note',
        quietHours: this.respectQuietHours ? { enabled: true, startHour: 21, endHour: 8 } : { enabled: false }
      }
    }).pipe(finalize(() => this.saving.set(false))).subscribe({
      next: () => {
        this.composerBody = '';
        this.selectThread(thread.id);
      },
      error: (error) => this.error.set(error?.message || 'Unable to create draft.')
    });
  }

  approveSelectedMessage(): void {
    const message = this.lastDraft();
    if (!message) return;
    this.saving.set(true);
    this.api.post<EngagementMessage>(`engagement/messages/${message.id}/approve`, { note: 'Approved from Engagement Command Center' })
      .pipe(finalize(() => this.saving.set(false)))
      .subscribe({
        next: () => this.selectThread(this.selectedThreadId()),
        error: (error) => this.error.set(error?.message || 'Unable to approve draft.')
      });
  }

  rejectSelectedMessage(): void {
    const message = this.lastDraft();
    if (!message) return;
    const reason = window.prompt('Reject reason');
    if (!reason) return;
    this.saving.set(true);
    this.api.post<EngagementMessage>(`engagement/messages/${message.id}/reject`, { reason })
      .pipe(finalize(() => this.saving.set(false)))
      .subscribe({
        next: () => this.selectThread(this.selectedThreadId()),
        error: (error) => this.error.set(error?.message || 'Unable to reject draft.')
      });
  }

  sendSelectedMessage(): void {
    const message = this.lastDraft();
    if (!message) return;
    this.saving.set(true);
    this.providerWarning.set('');
    this.api.post<EngagementMessage>(`engagement/messages/${message.id}/send`, {})
      .pipe(finalize(() => this.saving.set(false)))
      .subscribe({
        next: (updated) => {
          if (updated?.status === 'pending_send') {
            this.providerWarning.set(updated.failureReason || 'Provider disabled. Message was kept as pending send, not marked sent.');
          }
          this.selectThread(this.selectedThreadId());
        },
        error: (error) => {
          this.providerWarning.set(error?.message || 'Provider not configured. Message was not sent.');
          this.selectThread(this.selectedThreadId());
        }
      });
  }

  applyTemplate(): void {
    const template = this.templates().find((item) => item.id === this.selectedTemplate);
    if (!template) return;
    const thread = this.selectedThread();
    this.saving.set(true);
    this.api.post<ApiRecord>(`engagement/templates/${template.id}/render`, {
      threadId: thread?.id || '',
      clientId: thread?.clientId || '',
      variables: this.templateVariables()
    }).pipe(finalize(() => this.saving.set(false))).subscribe({
      next: (rendered) => {
        this.composerBody = String(rendered.renderedBody || template.body || this.composerBody);
        this.composerChannel = String(template.channel || this.composerChannel);
      },
      error: (error) => {
        const details = error?.error?.details || error?.error?.error?.details;
        const missing = Array.isArray(details?.missingVariables) ? ` Missing: ${details.missingVariables.join(', ')}` : '';
        this.error.set(`${error?.error?.error || error?.error?.message || error?.message || 'Unable to render template.'}${missing}`);
      }
    });
  }

  templateVariables(): ApiRecord {
    const metadata = (this.selectedThread()?.metadata || {}) as ApiRecord;
    return {
      payment_link: metadata.paymentLink || metadata.payment_link || '',
      booking_link: metadata.bookingLink || metadata.booking_link || ''
    };
  }

  defaultBookingForm(): ApiRecord {
    const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
    return {
      clientId: '',
      branchId: this.api.selectedBranchId() || '',
      familyBooking: false,
      appointmentCategory: 'service',
      numberOfGuests: 1,
      surpriseVisit: false,
      advancedMode: false,
      serviceId: '',
      staffId: '',
      roomResource: '',
      durationMinutes: 45,
      date: tomorrow,
      notes: ''
    };
  }

  openBookingDrawer(): void {
    const thread = this.selectedThread();
    if (!thread?.clientId) {
      this.bookingError.set('Client-linked conversation is required before booking.');
      this.bookingDrawerOpen.set(true);
      return;
    }
    this.bookingForm = {
      ...this.defaultBookingForm(),
      clientId: thread.clientId,
      branchId: thread.branchId || this.api.selectedBranchId() || '',
      staffId: thread.staffId || ''
    };
    this.bookingError.set('');
    this.bookingSuccess.set('');
    this.clearBookingPreview();
    this.bookingDrawerOpen.set(true);
    this.loadBookingCatalog();
  }

  closeBookingDrawer(): void {
    this.bookingDrawerOpen.set(false);
  }

  loadBookingCatalog(): void {
    this.bookingLoading.set(true);
    forkJoin({
      branches: this.api.list<ApiRecord[]>('branches', { limit: 1000 }),
      services: this.api.list<ApiRecord[]>('services', { limit: 1000 }),
      staff: this.api.list<ApiRecord[]>('staff', { branchId: this.bookingForm.branchId, limit: 1000 })
    }).pipe(finalize(() => this.bookingLoading.set(false))).subscribe({
      next: ({ branches, services, staff }) => {
        this.bookingBranches.set(branches || []);
        this.bookingServices.set((services || []).filter((service) => (service.status || 'active') !== 'inactive'));
        this.bookingStaff.set((staff || []).filter((person) => (person.status || 'active') !== 'inactive'));
        if (!this.bookingForm.branchId) this.bookingForm.branchId = this.bookingBranches()[0]?.id || this.api.selectedBranchId() || '';
        if (!this.bookingForm.serviceId) {
          const preferred = this.preferredServices()[0]?.id;
          this.bookingForm.serviceId = preferred || this.bookingServices()[0]?.id || '';
          this.applyBookingServiceDefaults();
        }
      },
      error: (error) => this.bookingError.set(error?.message || 'Unable to load booking catalog.')
    });
  }

  onBookingBranchChange(): void {
    this.clearBookingPreview();
    this.api.list<ApiRecord[]>('staff', { branchId: this.bookingForm.branchId, limit: 1000 }).subscribe({
      next: (staff) => this.bookingStaff.set((staff || []).filter((person) => (person.status || 'active') !== 'inactive')),
      error: (error) => this.bookingError.set(error?.message || 'Unable to load staff for branch.')
    });
  }

  onBookingServiceChange(): void {
    this.applyBookingServiceDefaults();
    this.clearBookingPreview();
  }

  applyBookingServiceDefaults(): void {
    const service = this.bookingServices().find((item) => item.id === this.bookingForm.serviceId);
    if (service?.durationMinutes) this.bookingForm.durationMinutes = Number(service.durationMinutes);
  }

  clearBookingPreview(): void {
    this.bookingSlotPreview.set(null);
    this.suggestedBookingSlots.set([]);
    this.selectedBookingSlot.set(null);
  }

  canPreviewBooking(): boolean {
    return Boolean(this.bookingForm.clientId && this.bookingForm.branchId && this.bookingForm.serviceId && this.bookingForm.date);
  }

  previewBookingSlots(): void {
    const thread = this.selectedThread();
    if (!this.canPreviewBooking()) {
      this.bookingError.set('Client, branch, service and date are required.');
      return;
    }
    this.bookingError.set('');
    this.bookingSuccess.set('');
    this.bookingLoading.set(true);
    this.api.post<ApiRecord>('engagement/booking/slot-preview', {
      threadId: thread?.id || '',
      clientId: this.bookingForm.clientId,
      branchId: this.bookingForm.branchId,
      serviceIds: [this.bookingForm.serviceId],
      staffId: this.bookingForm.staffId,
      roomResource: this.bookingForm.roomResource,
      durationMinutes: this.bookingForm.durationMinutes,
      date: this.bookingForm.date,
      limit: 8
    }).pipe(finalize(() => this.bookingLoading.set(false))).subscribe({
      next: (preview) => {
        this.bookingSlotPreview.set(preview);
        this.suggestedBookingSlots.set((preview?.suggestedSlots || []) as ApiRecord[]);
        this.selectedBookingSlot.set(((preview?.suggestedSlots || []) as ApiRecord[])[0] || null);
      },
      error: (error) => this.bookingError.set(error?.error?.error || error?.message || 'Unable to preview booking slots.')
    });
  }

  selectBookingSlot(slot: ApiRecord): void {
    this.selectedBookingSlot.set(slot);
  }

  createEngagementBooking(): void {
    const thread = this.selectedThread();
    const slot = this.selectedBookingSlot();
    if (!thread || !slot) return;
    this.bookingSaving.set(true);
    this.bookingError.set('');
    this.api.post<ApiRecord>('engagement/booking/create', {
      threadId: thread.id,
      clientId: this.bookingForm.clientId,
      branchId: this.bookingForm.branchId,
      familyBooking: this.bookingForm.familyBooking,
      appointmentCategory: this.bookingForm.appointmentCategory,
      numberOfGuests: this.bookingForm.numberOfGuests,
      surpriseVisit: this.bookingForm.surpriseVisit,
      advancedMode: this.bookingForm.advancedMode,
      serviceIds: [this.bookingForm.serviceId],
      staffId: slot.staffId || this.bookingForm.staffId,
      roomResource: slot.chair || slot.room || this.bookingForm.roomResource,
      durationMinutes: this.bookingForm.durationMinutes,
      startAt: slot.startAt,
      endAt: slot.endAt,
      slot,
      notes: this.bookingForm.notes
    }).pipe(finalize(() => this.bookingSaving.set(false))).subscribe({
      next: (result) => {
        this.bookingSuccess.set(`Booked appointment ${result.appointment?.id || ''}.`);
        this.selectThread(thread.id);
        this.load();
      },
      error: (error) => this.bookingError.set(error?.error?.error || error?.message || 'Unable to create booking.')
    });
  }

  bookingClientLabel(): string {
    const client = this.clientProfile();
    const thread = this.selectedThread();
    return client?.name || thread?.displayName || thread?.phone || 'No linked client';
  }

  bookingStaffForBranch(): ApiRecord[] {
    return this.bookingStaff().filter((person) => !this.bookingForm.branchId || person.branchId === this.bookingForm.branchId);
  }

  bookingServiceName(): string {
    return this.bookingServices().find((service) => service.id === this.bookingForm.serviceId)?.name || 'No service selected';
  }

  staffName(id: string): string {
    return this.bookingStaff().find((person) => person.id === id)?.name || id || 'Auto staff';
  }

  canApprove(): boolean {
    return this.lastDraft()?.approvalStatus === 'pending';
  }

  canReject(): boolean {
    return this.lastDraft()?.approvalStatus === 'pending';
  }

  canSend(): boolean {
    const draft = this.lastDraft();
    return !!draft && ['approved', 'not_required'].includes(draft.approvalStatus || '');
  }

  countForChannel(channel: ChannelFilter): number {
    if (channel === 'all') return this.threads().length;
    return this.threads().filter((thread) => (thread.primaryChannel || thread.type) === channel).length;
  }

  isPinned(thread: EngagementThread): boolean {
    return (thread.tags || []).includes('pinned') || thread.priority === 'urgent' || thread.status === 'escalated';
  }

  isSlaOverdue(thread: EngagementThread): boolean {
    return ['overdue', 'breached'].includes(thread.slaStatus || '');
  }

  replaceThread(updated: EngagementThread): void {
    this.threads.set(this.threads().map((thread) => thread.id === updated.id ? updated : thread));
    this.filterThreads();
    if (this.selectedThreadId() === updated.id) {
      this.selectedDetail.set({ ...(this.selectedDetail() || {}), thread: updated });
    }
  }

  timelineItems(): Array<ApiRecord & { kind: string; icon: string; title: string; body: string; createdAt?: string }> {
    const detail = this.selectedDetail();
    if (!detail) return [];
    const messages = (detail.messages || []).map((message) => ({
      kind: 'message',
      icon: message.direction === 'outbound' ? 'OUT' : 'IN',
      title: message.direction === 'outbound' ? 'Outbound draft/message' : 'Inbound message',
      body: message.body || message.bodyPreview || 'Message body not captured',
      createdAt: message.createdAt,
      channel: message.channel,
      direction: message.direction,
      status: message.status,
      approvalStatus: message.approvalStatus,
      failureReason: message.failureReason
    }));
    const events = (detail.auditTrail || []).map((event) => ({
      kind: 'event',
      icon: 'EV',
      title: String(event.action || 'Audit event').replaceAll('.', ' '),
      body: event.after?.reason || event.after?.failureReason || event.details?.note || event.entityType || 'System activity',
      createdAt: event.createdAt,
      status: event.severity
    }));
    const sla = (detail.slaEvents || []).map((event) => ({
      kind: 'sla',
      icon: 'SLA',
      title: event.eventType || 'SLA event',
      body: event.status || 'SLA update',
      createdAt: event.createdAt,
      status: event.severity
    }));
    return [...messages, ...events, ...sla].sort((a, b) => new Date(a.createdAt || '').getTime() - new Date(b.createdAt || '').getTime());
  }

  profileTags(): string[] {
    const richTags = (this.client360()?.tags || []) as ApiRecord[];
    if (richTags.length) return richTags.map((tag) => String(tag.label || tag.key || tag)).slice(0, 8);
    const client = this.clientProfile();
    const tags = client?.tags || client?.profileTags || [];
    if (Array.isArray(tags) && tags.length) return tags.slice(0, 6);
    return [client?.status || 'active', this.selectedThread()?.primaryChannel || 'engagement'].filter(Boolean);
  }

  pastAppointments(): ApiRecord[] {
    const past = this.client360()?.appointments?.past as ApiRecord[] | undefined;
    if (past?.length) return past;
    const today = Date.now();
    return this.appointments().filter((item) => new Date(item.startAt || item.appointmentDate || item.date || '').getTime() <= today);
  }

  lastAppointment(): ApiRecord | null {
    const last = this.client360()?.appointments?.last as ApiRecord | undefined;
    if (last) return last;
    return this.pastAppointments().at(-1) || null;
  }

  upcomingAppointment(): ApiRecord | null {
    const upcoming = this.client360()?.appointments?.upcoming as ApiRecord[] | undefined;
    if (upcoming?.length) return upcoming[0];
    const today = Date.now();
    return this.appointments().find((item) => new Date(item.startAt || item.appointmentDate || item.date || '').getTime() > today) || null;
  }

  pastInvoices(): ApiRecord[] {
    return (this.client360()?.invoices?.past || []) as ApiRecord[];
  }

  preferredStaff(): ApiRecord[] {
    return (this.client360()?.preferences?.preferredStaff || []) as ApiRecord[];
  }

  preferredServices(): ApiRecord[] {
    return (this.client360()?.preferences?.preferredServices || []) as ApiRecord[];
  }

  listLabels(items: ApiRecord[], field = 'name'): string {
    return items.map((item) => item[field] || item.id).filter(Boolean).slice(0, 3).join(', ');
  }

  allergiesText(): string {
    const allergies = (this.client360()?.preferences?.allergies || []) as unknown[];
    return allergies.map((item) => typeof item === 'string' ? item : JSON.stringify(item)).filter(Boolean).join(', ');
  }

  openAiSummaryDrawer(): void {
    if (!this.selectedThread()?.clientId) {
      this.aiSummaryError.set('Select a client-linked thread before generating an AI guest summary.');
      return;
    }
    this.aiSummaryDrawerOpen.set(true);
    if (this.client360() && !this.client360()?.client) {
      this.aiSummaryError.set('Linked client profile was not found. Re-link the thread to an active client before generating the summary.');
      return;
    }
    if (!this.generatedAiSummary()) this.generateAiSummary();
  }

  closeAiSummaryDrawer(): void {
    this.aiSummaryDrawerOpen.set(false);
  }

  generateAiSummary(): void {
    const thread = this.selectedThread();
    const clientId = thread?.clientId || '';
    if (!clientId) {
      this.aiSummaryError.set('Client link is required for AI guest summary.');
      return;
    }
    if (this.client360() && !this.client360()?.client) {
      this.aiSummaryError.set('Linked client profile was not found. Re-link the thread to an active client before generating the summary.');
      return;
    }
    this.aiSummaryError.set('');
    this.aiSummaryGenerating.set(true);
    this.api.post<ApiRecord>(`engagement/clients/${clientId}/ai-summary`, {
      threadId: thread?.id || '',
      appointmentId: thread?.appointmentId || '',
      membershipId: thread?.membershipId || '',
      packageId: thread?.packageId || ''
    }).pipe(finalize(() => this.aiSummaryGenerating.set(false))).subscribe({
      next: (summary) => this.generatedAiSummary.set(summary),
      error: (error) => this.aiSummaryError.set(error?.message || 'Unable to generate AI guest summary.')
    });
  }

  summaryArray(field: string): ApiRecord[] {
    const value = this.generatedAiSummary()?.[field];
    return Array.isArray(value) ? value as ApiRecord[] : [];
  }

  summaryItemTitle(item: unknown): string {
    if (typeof item === 'string') return item;
    const row = (item || {}) as ApiRecord;
    return String(row.title || row.label || row.name || row.riskLevel || 'Summary item');
  }

  summaryItemText(item: unknown): string {
    if (typeof item === 'string') return item;
    const row = (item || {}) as ApiRecord;
    return String(row.summary || row.reason || row.suggestedAction || row.status || row.actionType || '');
  }

  confidencePercent(value: unknown): string {
    const numeric = Number(value || 0);
    if (!Number.isFinite(numeric) || numeric <= 0) return '0%';
    return `${Math.round(numeric * 100)}%`;
  }

  latestAiSummaryText(): string {
    const generated = this.generatedAiSummary()?.summaryText;
    return generated ? String(generated) : this.aiSummaryText();
  }

  aiSummaryText(): string {
    if (this.client360()?.aiSummary) return String(this.client360()?.aiSummary);
    const detail = this.selectedDetail();
    const client = this.clientProfile();
    if (!detail?.thread) return 'Select a linked thread to generate a guest summary.';
    const due = this.client360()?.balance?.dueAmount || client?.unpaidBalance || client?.dueAmount || 0;
    const membership = this.client360()?.membership?.summaryText || this.walletSnapshot()?.activeMembership?.planName || 'no active membership';
    const lastBody = [...(detail.messages || [])].reverse().find((message) => message.body)?.body || detail.thread.lastMessagePreview || 'No message content yet.';
    return `${client?.name || detail.thread.displayName || 'Client'} has ${membership}, due amount ₹${due}, and latest context: ${lastBody}`;
  }
}
