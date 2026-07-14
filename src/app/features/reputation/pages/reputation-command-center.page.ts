import { CommonModule } from '@angular/common';
import { Component, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { forkJoin } from 'rxjs';
import { ApiRecord } from '../../../core/api.service';
import { StateComponent } from '../../../shared/ui/state/state.component';
import { ReputationApiService } from '../data-access/reputation-api.service';
import { PlatformSummary, ReputationAlert, ReputationDashboard, ReputationReview, ReviewPlatform, SupportedPlatform } from '../domain/reputation.models';
import { AuraDatePipe } from '../../../shared/pipes/aura-date.pipe';

type ReputationTab = 'overview' | 'feedback' | 'rating' | 'recovery' | 'staff';

interface PlatformCard {
  code: string;
  platformId: string;
  name: string;
  connected: boolean;
  reviewCount: number;
  averageRating: number;
  platformUrl: string;
  businessListingId: string;
  businessListingUrl: string;
  lastSyncStatus: string;
  lastSyncedAt: string;
  providerStatus: string;
  tokenEnvKey: string;
  accountId: string;
  locationId: string;
  pageAccountId: string;
}

interface StaffPreview {
  staffId: string;
  rating: number;
  mentions: number;
  negatives: number;
}

@Component({
  selector: 'app-reputation-command-center-page',
  standalone: true,
  imports: [AuraDatePipe, CommonModule, FormsModule, RouterLink, StateComponent],
  template: `
    <section class="rep-page">
      <header class="page-heading">
        <div>
          <h2>Command Center</h2>
        </div>
        <div class="heading-actions">
          <button class="ghost-button" type="button" (click)="load()" [disabled]="loading">Refresh</button>
          <a class="primary-link" routerLink="/reputation/inbox">Open inbox</a>
        </div>
      </header>

      <app-state [loading]="loading" [error]="error"></app-state>

      <ng-container *ngIf="!loading && !error && dashboard as data">
        <nav class="rep-tabs" aria-label="Reputation report tabs">
          <button type="button" [class.active]="activeTab === 'overview'" (click)="setTab('overview')">Overview</button>
          <button type="button" [class.active]="activeTab === 'feedback'" (click)="setTab('feedback')">Feedback Report</button>
          <button type="button" [class.active]="activeTab === 'rating'" (click)="setTab('rating')">Rating Intelligence</button>
          <button type="button" [class.active]="activeTab === 'recovery'" (click)="setTab('recovery')">Negative Review Recovery</button>
          <button type="button" [class.active]="activeTab === 'staff'" (click)="setTab('staff')">Staff Feedback Score</button>
        </nav>

        <section class="feedback-intelligence-panel" *ngIf="activeTab !== 'overview'">
          <div class="section-title">
            <div>
              <h3>{{ tabTitle }}</h3>
            </div>
            <div class="heading-actions">
              <button class="ghost-button slim" type="button" (click)="loadFeedbackReport()" [disabled]="feedbackLoading">Refresh report</button>
              <a class="ghost-button slim" [href]="feedbackCsvUrl" target="_blank" rel="noopener">CSV</a>
              <a class="ghost-button slim" [href]="feedbackPdfUrl" target="_blank" rel="noopener">Owner PDF</a>
            </div>
          </div>

          <p class="notice" *ngIf="feedbackNotice">{{ feedbackNotice }}</p>
          <app-state [loading]="feedbackLoading" [error]="feedbackError"></app-state>

          <div class="feedback-filters">
            <label class="field">
              <span>From</span>
              <input type="date" [(ngModel)]="feedbackFilters.from" />
            </label>
            <label class="field">
              <span>To</span>
              <input type="date" [(ngModel)]="feedbackFilters.to" />
            </label>
            <label class="field">
              <span>Rating bucket</span>
              <select [(ngModel)]="feedbackFilters.ratingBucket">
                <option value="all">All ratings</option>
                <option value="veryPoor">Very Poor</option>
                <option value="poor">Poor</option>
                <option value="average">Average</option>
                <option value="good">Good</option>
                <option value="awesome">Awesome</option>
              </select>
            </label>
            <label class="toggle-field">
              <input type="checkbox" [(ngModel)]="feedbackFilters.negativeOnly" />
              <span>Negative only</span>
            </label>
            <button class="primary-link button-like slim" type="button" (click)="loadFeedbackReport()">Apply filters</button>
          </div>

          <div class="feedback-kpis" *ngIf="feedbackReport">
            <article><span>No. of Feedback</span><strong>{{ feedbackNumber('totalFeedback') }}</strong></article>
            <article><span>Overall Rating</span><strong>{{ feedbackNumber('overallRating') | number:'1.1-1' }}</strong></article>
            <article><span>Very Poor</span><strong>{{ feedbackNumber('veryPoor') }}</strong></article>
            <article><span>Poor</span><strong>{{ feedbackNumber('poor') }}</strong></article>
            <article><span>Average</span><strong>{{ feedbackNumber('average') }}</strong></article>
            <article><span>Good</span><strong>{{ feedbackNumber('good') }}</strong></article>
            <article><span>Awesome</span><strong>{{ feedbackNumber('awesome') }}</strong></article>
            <article class="danger"><span>Recovery Pending</span><strong>{{ feedbackNumber('recoveryPending') }}</strong><small>{{ feedbackNumber('negativeFeedback') }} negative</small></article>
            <article><span>Review Conversion</span><strong>{{ feedbackNumber('reviewConversionRate') }}%</strong></article>
          </div>

          <div class="table-wrap" *ngIf="activeTab === 'feedback'">
            <table>
              <thead>
                <tr>
                  <th>Date / time</th><th>Client</th><th>Invoice / appointment</th><th>Services</th><th>Staff</th><th>Rating</th><th>Feedback</th><th>Status</th><th>Source</th><th>Action</th>
                </tr>
              </thead>
              <tbody>
                <tr *ngFor="let row of feedbackRows" [class.negative-row]="truthy(row['isNegative'])">
                  <td><strong>{{ row['date'] || '-' }}</strong><small>{{ row['time'] || '' }}</small></td>
                  <td><strong>{{ row['clientName'] || 'Walk-in' }}</strong><small>{{ row['clientPhone'] || 'Phone missing' }}</small></td>
                  <td><strong>{{ row['invoiceNumber'] || '-' }}</strong><small>{{ row['appointmentId'] || '' }}</small></td>
                  <td>{{ row['serviceNames'] || '-' }}</td>
                  <td>{{ row['staffName'] || 'Unassigned' }}</td>
                  <td><span [class]="'rating-pill ' + row['ratingBucket']">{{ row['rating'] || 0 }}/5</span></td>
                  <td>{{ row['feedback'] || 'No feedback text' }}</td>
                  <td>{{ row['status'] || 'new' }}</td>
                  <td>{{ row['source'] || 'Internal' }}</td>
                  <td><button class="ghost-button slim" type="button" (click)="setTab('recovery')" *ngIf="truthy(row['isNegative'])">Recover</button></td>
                </tr>
                <tr *ngIf="!feedbackRows.length"><td colspan="10">Feedback data not found. Send review links to start collecting customer feedback.</td></tr>
              </tbody>
            </table>
          </div>

          <div class="table-wrap" *ngIf="activeTab === 'rating'">
            <table>
              <thead><tr><th>Rating bucket</th><th>Count</th><th>Average</th><th>Negative</th><th>Recovery pending</th></tr></thead>
              <tbody>
                <tr *ngFor="let row of ratingRows">
                  <td>{{ row['bucket'] }}</td>
                  <td>{{ row['count'] }}</td>
                  <td>{{ row['averageRating'] | number:'1.1-1' }}</td>
                  <td>{{ row['negativeCount'] }}</td>
                  <td>{{ row['recoveryPending'] }}</td>
                </tr>
              </tbody>
            </table>
          </div>

          <div class="table-wrap" *ngIf="activeTab === 'recovery'">
            <table>
              <thead><tr><th>Client</th><th>Phone</th><th>Rating</th><th>Feedback</th><th>Staff</th><th>Recovery status</th><th>Actions</th></tr></thead>
              <tbody>
                <tr *ngFor="let row of recoveryRows" class="negative-row">
                  <td>{{ row['clientName'] || 'Walk-in' }}</td>
                  <td>{{ row['clientPhone'] || 'Missing' }}</td>
                  <td><span [class]="'rating-pill ' + row['ratingBucket']">{{ row['rating'] || 0 }}/5</span></td>
                  <td>{{ row['feedback'] || 'No feedback text' }}</td>
                  <td>{{ row['staffName'] || 'Unassigned' }}</td>
                  <td>{{ row['recoveryStatus'] || 'pending' }}</td>
                  <td class="action-cell">
                    <button class="ghost-button slim" type="button" (click)="sendRecovery(row)" [disabled]="feedbackActionBusy === row['id']">Send recovery</button>
                    <button class="ghost-button slim" type="button" (click)="markReviewed(row)" [disabled]="feedbackActionBusy === row['id']">Mark reviewed</button>
                  </td>
                </tr>
                <tr *ngIf="!recoveryRows.length"><td colspan="7">No negative recovery rows for selected filters.</td></tr>
              </tbody>
            </table>
          </div>

          <div class="table-wrap" *ngIf="activeTab === 'staff'">
            <table>
              <thead><tr><th>Staff</th><th>Feedback</th><th>Average rating</th><th>Negative</th><th>Recovery pending</th><th>Resolved</th><th>Signal</th></tr></thead>
              <tbody>
                <tr *ngFor="let row of staffScoreRows">
                  <td>{{ row['staffName'] || 'Unassigned' }}</td>
                  <td>{{ row['feedbackCount'] }}</td>
                  <td>{{ row['averageRating'] | number:'1.1-1' }}</td>
                  <td>{{ row['negativeCount'] }}</td>
                  <td>{{ row['recoveryPending'] }}</td>
                  <td>{{ row['resolvedCount'] }}</td>
                  <td>{{ row['repeatIssueSignal'] }}</td>
                </tr>
                <tr *ngIf="!staffScoreRows.length"><td colspan="7">No staff feedback score yet.</td></tr>
              </tbody>
            </table>
          </div>
        </section>

        <ng-container *ngIf="activeTab === 'overview'">
        <section class="kpi-grid" aria-label="Reputation KPIs">
          <article class="kpi-card">
            <span>Average rating</span>
            <strong>{{ data.metrics.averageRating | number: '1.1-1' }} / 5</strong>
            <small>{{ data.score.positivePct }}% positive</small>
          </article>
          <article class="kpi-card">
            <span>Total reviews</span>
            <strong>{{ data.metrics.totalReviews }}</strong>
            <small>{{ data.score.netPromoterScore }} NPS proxy</small>
          </article>
          <article class="kpi-card">
            <span>Reply rate</span>
            <strong>{{ data.metrics.replyRate }}%</strong>
            <small>{{ data.metrics.pendingReplyApprovals }} pending approvals</small>
          </article>
          <article class="kpi-card danger">
            <span>Avg reply time</span>
            <strong>{{ data.metrics.avgReplyTimeHours | number: '1.1-1' }} hrs</strong>
            <small>{{ data.metrics.unresolvedNegative }} recovery alerts</small>
          </article>
        </section>

        <section class="score-grid">
          <article class="score-panel">
            <div class="score-copy">
              <h3>{{ data.score.overallScore }} / 100</h3>
              <p>{{ scoreLabel(data.score.overallScore) }}</p>
            </div>
            <div class="gauge" [style.background]="gaugeBackground(data.score.overallScore)">
              <div class="gauge-inner">
                <strong>{{ data.score.overallScore }}</strong>
                <span>score</span>
              </div>
            </div>
            <div class="score-segments">
              <div *ngFor="let segment of scoreSegmentRows">
                <span>{{ segment.label }}</span>
                <div class="meter"><i [style.width.%]="segment.value"></i></div>
                <strong>{{ segment.value }}</strong>
              </div>
            </div>
          </article>

          <article class="alerts-panel">
            <div class="section-title">
              <div>
                <h3>Alerts</h3>
              </div>
              <span class="count-pill">{{ data.alerts.length }}</span>
            </div>
            <div class="alert-list" *ngIf="data.alerts.length; else noAlerts">
              <button type="button" class="alert-row" *ngFor="let alert of data.alerts">
                <span [class]="'severity ' + alert.severity"></span>
                <div>
                  <strong>{{ alert.severity || 'normal' | titlecase }} review alert</strong>
                  <small>{{ alert.createdAt ? (alert.createdAt | auraDate:'date') : 'Time not captured' }}</small>
                </div>
              </button>
            </div>
            <ng-template #noAlerts>
              <div class="empty-box">
                <strong>No urgent alerts</strong>
                <span>Low-rating escalations will appear here.</span>
              </div>
            </ng-template>
          </article>
        </section>

        <section class="platform-grid">
          <article class="platform-card" *ngFor="let platform of platformCards">
            <div class="platform-icon" [style.background]="platformColor(platform.code)">{{ initials(platform.name) }}</div>
            <div>
              <strong>{{ platform.name }}</strong>
              <span>{{ platform.connected ? platform.lastSyncStatus || 'connected' : platform.reviewCount ? 'legacy data only' : 'not connected' }}</span>
              <small *ngIf="platform.businessListingId">ID: {{ platform.businessListingId }}</small>
              <small>{{ platform.providerStatus || 'not_configured' }} · {{ platform.tokenEnvKey || 'credential env pending' }}</small>
            </div>
            <div class="platform-rating">
              <b>{{ platform.averageRating | number: '1.1-1' }}</b>
              <small>{{ platform.reviewCount }} reviews</small>
            </div>
            <button class="ghost-button slim" type="button" (click)="runPlatformAction(platform)" [disabled]="platformActionBusy === platform.code">
              {{ platformActionBusy === platform.code ? 'Working' : platform.connected && platform.platformId ? 'Sync now' : 'Connect' }}
            </button>
          </article>
        </section>
        <p class="platform-action-message" *ngIf="platformActionMessage">{{ platformActionMessage }}</p>

        <section class="request-panel">
          <div>
            <h3>Send invoice review link</h3>
          </div>
          <label class="field">
            <span>Appointment ID</span>
            <input [(ngModel)]="reviewAppointmentId" placeholder="appt_..." />
          </label>
          <label class="field">
            <span>Invoice ID</span>
            <input [(ngModel)]="reviewInvoiceId" placeholder="inv_... optional" />
          </label>
          <label class="field">
            <span>Channel</span>
            <select [(ngModel)]="reviewChannel">
              <option value="auto">Auto</option>
              <option value="whatsapp">WhatsApp</option>
              <option value="sms">SMS</option>
              <option value="email">Email</option>
              <option value="in_app">In-app</option>
            </select>
          </label>
          <button class="primary-link button-like" type="button" [class.disabled]="reviewRequestBusy" (click)="sendReviewLink()">
            {{ reviewRequestBusy ? 'Sending' : 'Send review link' }}
          </button>
          <p class="platform-action-message request-message" *ngIf="reviewRequestMessage">{{ reviewRequestMessage }}</p>
        </section>

        <div class="drawer-backdrop" *ngIf="setupPlatform" (click)="closePlatformSetup()"></div>
        <aside class="platform-setup-drawer" *ngIf="setupPlatform as setup">
          <div class="drawer-head">
            <button type="button" class="close-button" (click)="closePlatformSetup()" aria-label="Close">x</button>
            <div>
              <h3>Connect {{ setup.name }}</h3>
            </div>
          </div>
          <div class="drawer-body">
            <div class="connect-hero">
              <div class="platform-icon large" [style.background]="platformColor(setup.code)">{{ initials(setup.name) }}</div>
              <div>
                <strong>{{ setup.name }}</strong>
                <p>{{ setup.code === 'google' ? 'Google Business Profile needs OAuth access to your verified business listing before reviews/replies can sync.' : 'Create the platform record first, then configure the provider adapter or OAuth credentials.' }}</p>
              </div>
            </div>

            <div class="setup-warning" *ngIf="!selectedBranchId">
              Select one branch from the top Branch dropdown. Google reviews connect branch-by-branch, so "All branches" cannot be used for first setup.
            </div>
            <p class="setup-message" *ngIf="platformSetupMessage">{{ platformSetupMessage }}</p>

            <section>
              <strong>Required details</strong>
              <ul>
                <li *ngFor="let item of platformSetupRequirements">{{ item }}</li>
              </ul>
            </section>

            <section class="setup-form">
              <strong>Connection details</strong>
              <label class="field">
                <span>{{ listingIdLabel(setup.code) }}</span>
                <input [(ngModel)]="platformBusinessListingId" [placeholder]="listingIdPlaceholder(setup.code)" />
              </label>
              <label class="field">
                <span>Listing/Profile URL</span>
                <input [(ngModel)]="platformBusinessListingUrl" placeholder="https://..." />
              </label>
              <label class="field">
                <span>Provider app/account URL</span>
                <input [(ngModel)]="platformUrl" placeholder="Optional provider console or profile URL" />
              </label>
              <label class="field">
                <span>Provider OAuth/API credential env key</span>
                <input [(ngModel)]="platformTokenEnvKey" [placeholder]="credentialPlaceholder(setup.code)" />
              </label>
              <label class="field">
                <span>Provider account ID</span>
                <input [(ngModel)]="platformAccountId" placeholder="accounts/... or provider account ID" />
              </label>
              <label class="field">
                <span>Location ID</span>
                <input [(ngModel)]="platformLocationId" placeholder="locations/... optional" />
              </label>
              <label class="field">
                <span>Page / Instagram account ID</span>
                <input [(ngModel)]="platformPageAccountId" placeholder="Facebook page ID or Instagram business account ID" />
              </label>
              <div class="saved-connection" *ngIf="setup.businessListingId || setup.businessListingUrl">
                <span>Saved connection</span>
                <strong>{{ setup.businessListingId || 'ID missing' }}</strong>
                <small>{{ setup.businessListingUrl || setup.lastSyncStatus }}</small>
                <small>{{ setup.providerStatus || 'not_configured' }} · {{ setup.tokenEnvKey || 'credential env pending' }}</small>
              </div>
            </section>

            <section>
              <strong>Steps</strong>
              <ol>
                <li *ngFor="let step of platformSetupSteps">{{ step }}</li>
              </ol>
            </section>

            <div class="drawer-actions">
              <button class="ghost-button" type="button" (click)="closePlatformSetup()">Cancel</button>
              <button class="primary-link button-like" type="button" (click)="confirmPlatformConnect(setup)" [class.disabled]="platformActionBusy === setup.code">
                {{ platformActionBusy === setup.code ? 'Working' : selectedBranchId ? 'Create connection record' : 'Select branch first' }}
              </button>
            </div>
          </div>
        </aside>

        <section class="ops-grid">
          <article class="feed-panel">
            <div class="section-title">
              <div>
                <h3>Recent reviews</h3>
              </div>
              <a routerLink="/reputation/inbox">View all</a>
            </div>
            <div class="review-stream" *ngIf="data.recentReviews.length; else noReviews">
              <a class="feed-row" *ngFor="let review of data.recentReviews" routerLink="/reputation/inbox" [queryParams]="reviewQueryParams[review.id]">
                <div class="avatar" [style.background]="platformColor(review.platformCode)">{{ initials(review.reviewerName) }}</div>
                <div>
                  <strong>{{ review.reviewerName }}</strong>
                  <p>{{ review.reviewText || 'No review text captured.' }}</p>
                  <small>{{ review.platformName }} · {{ review.createdAt ? (review.createdAt | auraDate:'date') : 'Date missing' }}</small>
                </div>
                <span [class]="'sentiment ' + sentimentClass(review)">{{ sentimentLabel(review) }}</span>
              </a>
            </div>
            <ng-template #noReviews>
              <div class="empty-box">
                <strong>No reviews yet</strong>
                <span>Connected and legacy reviews will appear here.</span>
              </div>
            </ng-template>
          </article>

          <aside class="analytics-panel">
            <section>
              <h3>Visible review mix</h3>
              <div class="sentiment-bars">
                <div *ngFor="let row of sentimentPreviewRows">
                  <span>{{ row.label }}</span>
                  <div class="meter"><i [style.width.%]="row.value"></i></div>
                  <strong>{{ row.value }}%</strong>
                </div>
              </div>
            </section>

            <section>
              <h3>Approval queue</h3>
              <div class="draft-box" *ngIf="data.recentReviews.length; else noDraftReview">
                <label class="field">
                  <span>Review</span>
                  <select [(ngModel)]="replyDraftReviewId">
                    <option value="">Select review</option>
                    <option *ngFor="let review of data.recentReviews" [value]="review.id">
                      {{ review.platformName }} · {{ review.reviewerName || review.id }}
                    </option>
                  </select>
                </label>
                <button class="ghost-button slim" type="button" (click)="draftReply()" [disabled]="replyDraftBusy || !replyDraftReviewId">
                  {{ replyDraftBusy ? 'Drafting' : 'Generate draft' }}
                </button>
                <p class="platform-action-message" *ngIf="replyDraftMessage">{{ replyDraftMessage }}</p>
                <div class="draft-list" *ngIf="replyDrafts.length">
                  <article class="draft-row" *ngFor="let draft of replyDrafts">
                    <p>{{ draft }}</p>
                    <button class="primary-link button-like slim" type="button" (click)="saveDraftReply(draft)">Save for approval</button>
                  </article>
                </div>
              </div>
              <ng-template #noDraftReview>
                <div class="empty-box compact">
                  <strong>No review selected</strong>
                  <span>Recent reviews will appear here for reply drafting.</span>
                </div>
              </ng-template>
            </section>

            <section>
              <h3>Attribution</h3>
              <div class="staff-list" *ngIf="staffPreviewRows.length; else noStaff">
                <div class="staff-row" *ngFor="let staff of staffPreviewRows">
                  <strong>{{ staff.staffId }}</strong>
                  <span>{{ staff.mentions }} mentions · {{ staff.rating | number: '1.1-1' }} avg</span>
                  <small>{{ staff.negatives }} recovery signals</small>
                </div>
              </div>
              <ng-template #noStaff>
                <div class="empty-box compact">
                  <strong>No staff attribution yet</strong>
                  <span>Phase 4 analysis will enrich this view.</span>
                </div>
              </ng-template>
            </section>
          </aside>
        </section>
        </ng-container>
      </ng-container>
    </section>
  `,
  styles: [`
    .rep-page { display: grid; gap: 18px; }
    .page-heading, .score-panel, .alerts-panel, .feed-panel, .analytics-panel, .kpi-card, .platform-card, .request-panel {
      border: 1px solid #dbe4e8;
      border-radius: 8px;
      background: #fff;
      box-shadow: 0 14px 28px rgba(15, 23, 42, 0.06);
    }
    .page-heading { display: flex; justify-content: space-between; gap: 20px; padding: 24px; align-items: center; }
    .page-heading h2 { margin: 4px 0 8px; font-size: 32px; line-height: 1.1; color: #0f172a; letter-spacing: 0; }
    .page-heading p { margin: 0; color: #53657d; max-width: 760px; line-height: 1.55; }
    .heading-actions { display: flex; gap: 10px; flex-wrap: wrap; }
    .primary-link { display: inline-flex; align-items: center; justify-content: center; border-radius: 8px; background: #55173D; color: #fff; padding: 12px 16px; text-decoration: none; font-weight: 800; }
    .rep-tabs {
      display: grid;
      grid-template-columns: repeat(5, minmax(0, 1fr));
      gap: 10px;
      border: 1px solid #dbe4e8;
      border-radius: 8px;
      background: #fff;
      padding: 10px;
      box-shadow: 0 10px 20px rgba(15, 23, 42, 0.05);
    }
    .rep-tabs button {
      min-height: 42px;
      border: 1px solid #dbe4e8;
      border-radius: 8px;
      background: #f8fafc;
      color: #334155;
      font-weight: 900;
      cursor: pointer;
    }
    .rep-tabs button.active {
      border-color: #55173D;
      background: #55173D;
      color: #fff;
      box-shadow: 0 10px 18px rgba(85, 23, 61, 0.18);
    }
    .feedback-intelligence-panel {
      display: grid;
      gap: 14px;
      border: 1px solid #dbe4e8;
      border-radius: 8px;
      background: #fff;
      padding: 18px;
      box-shadow: 0 14px 28px rgba(15, 23, 42, 0.06);
    }
    .notice {
      margin: 0;
      border: 1px solid #c7e8df;
      border-radius: 8px;
      background: #f4fbf8;
      color: #4B1238;
      padding: 10px 12px;
      font-weight: 800;
    }
    .feedback-filters {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr)) minmax(150px, auto) auto;
      gap: 10px;
      align-items: end;
      border: 1px solid #e5edf1;
      border-radius: 8px;
      background: #f8fafc;
      padding: 12px;
    }
    .toggle-field {
      min-height: 42px;
      display: inline-flex;
      align-items: center;
      gap: 8px;
      color: #334155;
      font-weight: 900;
    }
    .feedback-kpis {
      display: grid;
      grid-template-columns: repeat(5, minmax(0, 1fr));
      gap: 10px;
    }
    .feedback-kpis article {
      min-height: 98px;
      display: grid;
      align-content: space-between;
      border: 1px solid #dbe4e8;
      border-top: 4px solid #55173D;
      border-radius: 8px;
      background: #fff;
      padding: 12px;
    }
    .feedback-kpis article.danger {
      border-top-color: #e11d48;
    }
    .feedback-kpis span,
    .feedback-kpis small {
      color: #53657d;
      font-weight: 800;
    }
    .feedback-kpis strong {
      color: #0f172a;
      font-size: 26px;
      line-height: 1;
    }
    .table-wrap {
      overflow-x: auto;
      border: 1px solid #dbe4e8;
      border-radius: 8px;
      background: #fff;
    }
    table {
      width: 100%;
      min-width: 980px;
      border-collapse: collapse;
    }
    th,
    td {
      padding: 10px 12px;
      border-bottom: 1px solid #e5edf1;
      text-align: left;
      vertical-align: top;
    }
    th {
      color: #53657d;
      background: #f8fafc;
      font-size: 12px;
      font-weight: 900;
      text-transform: uppercase;
    }
    td strong,
    td small {
      display: block;
    }
    td small {
      color: #53657d;
    }
    .negative-row {
      background: #fff7f7;
    }
    .rating-pill {
      display: inline-flex;
      border-radius: 999px;
      padding: 5px 9px;
      background: #eef2f7;
      color: #334155;
      font-weight: 900;
      white-space: nowrap;
    }
    .rating-pill.veryPoor,
    .rating-pill.poor {
      background: #fff1f2;
      color: #be123c;
    }
    .rating-pill.good,
    .rating-pill.awesome {
      background: #FBF0E8;
      color: #7A4A28;
    }
    .action-cell {
      min-width: 210px;
    }
    .action-cell .ghost-button {
      margin: 0 6px 6px 0;
    }
    .kpi-grid, .platform-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 14px; }
    .kpi-card { min-height: 128px; padding: 18px; display: grid; align-content: space-between; border-top: 4px solid #55173D; }
    .kpi-card.danger { border-top-color: #e11d48; }
    .kpi-card span, .kpi-card small, .platform-card span, .platform-card small, .feed-row small, .feed-row p, .empty-box span, .staff-row span, .staff-row small { color: #53657d; }
    .kpi-card strong { font-size: 30px; color: #0f172a; line-height: 1; }
    .score-grid { display: grid; grid-template-columns: minmax(0, 1fr) 360px; gap: 16px; }
    .score-panel { padding: 22px; display: grid; grid-template-columns: 240px 220px minmax(0, 1fr); gap: 20px; align-items: center; }
    .score-copy h3 { margin: 5px 0; font-size: 40px; color: #0f172a; letter-spacing: 0; }
    .score-copy p { margin: 0; color: #53657d; line-height: 1.5; }
    .gauge { width: 190px; aspect-ratio: 1; border-radius: 50%; padding: 18px; display: grid; place-items: center; }
    .gauge-inner { width: 100%; height: 100%; border-radius: 50%; background: #fff; display: grid; place-items: center; align-content: center; border: 1px solid #e5edf1; }
    .gauge-inner strong { font-size: 42px; color: #0f172a; line-height: 1; }
    .gauge-inner span { color: #53657d; font-weight: 800; }
    .score-segments, .sentiment-bars { display: grid; gap: 12px; }
    .score-segments > div, .sentiment-bars > div { display: grid; grid-template-columns: 92px minmax(0, 1fr) 42px; gap: 10px; align-items: center; color: #334155; font-weight: 800; }
    .meter { height: 9px; border-radius: 999px; overflow: hidden; background: #edf2f5; }
    .meter i { display: block; height: 100%; border-radius: inherit; background: #55173D; }
    .alerts-panel, .feed-panel, .analytics-panel { padding: 20px; }
    .section-title { display: flex; align-items: center; justify-content: space-between; gap: 14px; margin-bottom: 16px; }
    .section-title h3, .analytics-panel h3 { margin: 4px 0 0; color: #0f172a; letter-spacing: 0; }
    .count-pill { background: #fff1f2; color: #be123c; border-radius: 999px; padding: 6px 10px; font-weight: 900; }
    .alert-list, .review-stream, .staff-list { display: grid; gap: 10px; }
    .alert-row, .feed-row { width: 100%; border: 1px solid #e5edf1; border-radius: 8px; background: #fff; padding: 12px; display: flex; align-items: center; gap: 12px; text-align: left; text-decoration: none; color: inherit; }
    .severity { width: 10px; height: 42px; border-radius: 999px; background: #f59e0b; }
    .severity.high, .severity.critical { background: #e11d48; }
    .platform-card { padding: 16px; display: grid; grid-template-columns: 44px minmax(0, 1fr); gap: 12px; align-items: center; }
    .platform-icon, .avatar { color: #fff; font-weight: 900; display: grid; place-items: center; }
    .platform-icon { width: 44px; height: 44px; border-radius: 8px; }
    .platform-rating { grid-column: 1 / -1; display: flex; align-items: center; justify-content: space-between; border-top: 1px solid #edf2f5; padding-top: 12px; }
    .platform-rating b { color: #0f172a; font-size: 24px; }
    .platform-card .slim { grid-column: 1 / -1; padding: 9px 10px; }
    .platform-action-message { margin: 10px 0 0; color: #53657d; font-size: 13px; }
    .request-panel { display: grid; grid-template-columns: minmax(220px, 1fr) minmax(180px, 220px) minmax(180px, 220px) 150px auto; gap: 14px; align-items: end; padding: 18px; }
    .request-panel h3 { margin: 4px 0; color: #0f172a; letter-spacing: 0; }
    .request-panel p { margin: 0; color: #53657d; line-height: 1.45; }
    .field { display: grid; gap: 6px; color: #334155; font-size: 13px; font-weight: 900; }
    .field input, .field select { width: 100%; border: 1px solid #cbd5e1; border-radius: 8px; color: #0f172a; font: inherit; min-height: 42px; padding: 9px 11px; }
    .request-message { grid-column: 1 / -1; }
    .drawer-backdrop { position: fixed; inset: 0; z-index: 40; background: rgba(15, 23, 42, .56); }
    .platform-setup-drawer { position: fixed; inset: 0 0 0 auto; z-index: 41; width: min(560px, 100vw); background: #fff; box-shadow: -22px 0 44px rgba(15, 23, 42, .24); display: flex; flex-direction: column; }
    .drawer-head { display: flex; gap: 12px; align-items: center; padding: 20px 24px; border-bottom: 1px solid #e5edf1; }
    .drawer-head h3 { margin: 2px 0 0; color: #0f172a; letter-spacing: 0; }
    .close-button { width: 34px; height: 34px; border: 0; background: transparent; color: #0f172a; cursor: pointer; font-size: 30px; line-height: 1; }
    .drawer-body { padding: 24px; overflow: auto; display: grid; gap: 18px; }
    .connect-hero { display: flex; gap: 14px; align-items: center; border: 1px solid #e5edf1; border-radius: 8px; padding: 14px; background: #f8fafc; }
    .connect-hero p { margin: 4px 0 0; color: #53657d; line-height: 1.45; }
    .platform-icon.large { width: 58px; height: 58px; border-radius: 14px; flex: 0 0 auto; }
    .setup-warning { border: 1px solid #fed7aa; background: #fff7ed; color: #9a3412; border-radius: 8px; padding: 12px; font-weight: 800; line-height: 1.45; }
    .setup-message { margin: 0; border: 1px solid #c7e8df; background: #f4fbf8; color: #4B1238; border-radius: 8px; padding: 12px; font-weight: 800; line-height: 1.45; }
    .platform-setup-drawer section { border-top: 1px solid #edf2f5; padding-top: 16px; display: grid; gap: 10px; }
    .setup-form { grid-template-columns: 1fr; }
    .saved-connection { border: 1px solid #dbe4e8; border-radius: 8px; padding: 12px; display: grid; gap: 4px; background: #f8fafc; }
    .saved-connection span, .saved-connection small { color: #53657d; }
    .platform-setup-drawer ul, .platform-setup-drawer ol { margin: 0; padding-left: 22px; color: #53657d; line-height: 1.55; display: grid; gap: 8px; }
    .drawer-actions { display: flex; justify-content: flex-end; gap: 10px; border-top: 1px solid #edf2f5; padding-top: 16px; }
    .button-like { border: 0; cursor: pointer; }
    .button-like.disabled { opacity: .6; pointer-events: none; }
    .ops-grid { display: grid; grid-template-columns: minmax(0, 1fr) 380px; gap: 16px; align-items: start; }
    .avatar { width: 38px; height: 38px; border-radius: 50%; flex: 0 0 auto; }
    .feed-row p { margin: 3px 0; max-width: 680px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .sentiment { margin-left: auto; border-radius: 999px; padding: 6px 10px; font-weight: 900; font-size: 12px; background: #eef2f7; color: #475569; white-space: nowrap; }
    .sentiment.positive, .sentiment.very_positive { background: #FBF0E8; color: #7A4A28; }
    .sentiment.negative, .sentiment.very_negative { background: #fff1f2; color: #be123c; }
    .analytics-panel { display: grid; gap: 22px; }
    .analytics-panel section + section { border-top: 1px solid #e5edf1; padding-top: 20px; }
    .staff-row { border: 1px solid #edf2f5; border-radius: 8px; padding: 12px; display: grid; gap: 4px; }
    .draft-box, .draft-list { display: grid; gap: 10px; }
    .draft-row { border: 1px solid #edf2f5; border-radius: 8px; padding: 12px; display: grid; gap: 10px; }
    .draft-row p { margin: 0; color: #334155; line-height: 1.45; }
    .empty-box { border: 1px dashed #cfdbe3; border-radius: 8px; padding: 20px; display: grid; gap: 6px; text-align: center; color: #0f172a; }
    .empty-box.compact { text-align: left; }
    @media (max-width: 1180px) {
      .kpi-grid, .platform-grid, .score-grid, .ops-grid, .request-panel, .feedback-kpis, .feedback-filters { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .rep-tabs { grid-template-columns: repeat(3, minmax(0, 1fr)); }
      .score-panel { grid-template-columns: 1fr; }
    }
    @media (max-width: 760px) {
      .page-heading, .heading-actions, .alert-row, .feed-row { align-items: stretch; flex-direction: column; }
      .kpi-grid, .platform-grid, .score-grid, .ops-grid, .request-panel, .rep-tabs, .feedback-kpis, .feedback-filters { grid-template-columns: 1fr; }
      .page-heading h2 { font-size: 28px; }
      .sentiment { margin-left: 0; width: fit-content; }
    }
  `]
})
export class ReputationCommandCenterPage implements OnInit {
  activeTab: ReputationTab = 'overview';
  dashboard: ReputationDashboard | null = null;
  feedbackReport: ApiRecord | null = null;
  platforms: ReviewPlatform[] = [];
  supported: SupportedPlatform[] = [];
  platformCards: PlatformCard[] = [];
  scoreSegmentRows: Array<{ label: string; value: number }> = [];
  sentimentPreviewRows: Array<{ label: string; value: number }> = [];
  staffPreviewRows: StaffPreview[] = [];
  reviewQueryParams: Record<string, { selected: string }> = {};
  setupPlatform: PlatformCard | null = null;
  platformSetupSteps: string[] = [];
  platformSetupRequirements: string[] = [];
  platformSetupMessage = '';
  loading = true;
  error = '';
  platformActionBusy = '';
  platformActionMessage = '';
  reviewAppointmentId = '';
  reviewInvoiceId = '';
  reviewChannel = 'auto';
  reviewRequestBusy = false;
  reviewRequestMessage = '';
  platformBusinessListingId = '';
  platformBusinessListingUrl = '';
  platformUrl = '';
  platformTokenEnvKey = '';
  platformAccountId = '';
  platformLocationId = '';
  platformPageAccountId = '';
  replyDraftReviewId = '';
  replyDraftBusy = false;
  replyDraftMessage = '';
  replyDrafts: string[] = [];
  feedbackLoading = false;
  feedbackError = '';
  feedbackNotice = '';
  feedbackActionBusy = '';
  feedbackFilters = {
    from: '',
    to: '',
    ratingBucket: 'all',
    negativeOnly: false
  };

  constructor(
    private readonly reputationApi: ReputationApiService,
    private readonly route: ActivatedRoute
  ) {}

  ngOnInit(): void {
    const requestedTab = this.route.snapshot.queryParamMap.get('tab');
    if (this.isTab(requestedTab)) this.activeTab = requestedTab;
    this.load();
  }

  get selectedBranchId(): string {
    return this.reputationApi.selectedBranchId();
  }

  load(): void {
    this.loading = true;
    this.error = '';
    this.loadFeedbackReport();
    forkJoin({
      dashboard: this.reputationApi.dashboard(),
      platforms: this.reputationApi.platforms()
    }).subscribe({
      next: ({ dashboard, platforms }) => {
        this.dashboard = dashboard;
        this.platforms = platforms.platforms;
        this.supported = platforms.supported;
        this.refreshViewModels();
        this.loading = false;
      },
      error: (error) => {
        this.error = error?.error?.error || error?.message || 'Unable to load reputation command center';
        this.loading = false;
      }
    });
  }

  setTab(tab: ReputationTab): void {
    this.activeTab = tab;
    if (tab !== 'overview' && !this.feedbackReport && !this.feedbackLoading) this.loadFeedbackReport();
  }

  get tabTitle(): string {
    const titles: Record<ReputationTab, string> = {
      overview: 'Overview',
      feedback: 'Feedback Report',
      rating: 'Rating Intelligence',
      recovery: 'Negative Review Recovery',
      staff: 'Staff Feedback Score'
    };
    return titles[this.activeTab];
  }

  get feedbackRows(): ApiRecord[] {
    return this.arrayFrom(this.feedbackReport?.['rows']);
  }

  get ratingRows(): ApiRecord[] {
    return this.arrayFrom(this.feedbackReport?.['ratingIntelligence']);
  }

  get recoveryRows(): ApiRecord[] {
    return this.arrayFrom(this.feedbackReport?.['negativeRecovery']);
  }

  get staffScoreRows(): ApiRecord[] {
    return this.arrayFrom(this.feedbackReport?.['staffScore']);
  }

  get feedbackCsvUrl(): string {
    return `/api/reports/customer-feedback/export.csv?${this.feedbackQueryString()}`;
  }

  get feedbackPdfUrl(): string {
    return `/api/reports/customer-feedback/owner.pdf?${this.feedbackQueryString()}`;
  }

  feedbackNumber(key: string): number {
    const summary = this.recordFrom(this.feedbackReport?.['summary']);
    const value = Number(summary[key] || 0);
    return Number.isFinite(value) ? value : 0;
  }

  loadFeedbackReport(): void {
    this.feedbackLoading = true;
    this.feedbackError = '';
    this.reputationApi.customerFeedbackReport(this.feedbackQueryParams()).subscribe({
      next: (report) => {
        this.feedbackReport = report;
        this.feedbackLoading = false;
      },
      error: (error) => {
        this.feedbackError = error?.error?.error || error?.message || 'Unable to load customer feedback report';
        this.feedbackLoading = false;
      }
    });
  }

  sendRecovery(row: ApiRecord): void {
    const id = String(row['id'] || '');
    if (!id || this.feedbackActionBusy) return;
    this.feedbackActionBusy = id;
    this.feedbackNotice = '';
    this.reputationApi.sendFeedbackRecoveryMessage(id, { channel: 'whatsapp' }).subscribe({
      next: (result) => {
        this.feedbackNotice = result['status'] === 'phone_missing'
          ? 'Recovery note saved, but client phone missing hai.'
          : 'Recovery WhatsApp/message queued and reply saved for approval.';
        this.feedbackActionBusy = '';
        this.loadFeedbackReport();
      },
      error: (error) => {
        this.feedbackNotice = error?.error?.error || error?.message || 'Unable to queue recovery message.';
        this.feedbackActionBusy = '';
      }
    });
  }

  markReviewed(row: ApiRecord): void {
    const id = String(row['id'] || '');
    if (!id || this.feedbackActionBusy) return;
    this.feedbackActionBusy = id;
    this.feedbackNotice = '';
    this.reputationApi.markFeedbackReviewed(id, { recoveryOutcome: 'manager_reviewed' }).subscribe({
      next: () => {
        this.feedbackNotice = 'Feedback marked reviewed and recovery status updated.';
        this.feedbackActionBusy = '';
        this.loadFeedbackReport();
      },
      error: (error) => {
        this.feedbackNotice = error?.error?.error || error?.message || 'Unable to mark feedback reviewed.';
        this.feedbackActionBusy = '';
      }
    });
  }

  truthy(value: unknown): boolean {
    return value === true || value === 1 || value === '1' || value === 'true';
  }

  private feedbackQueryParams(): ApiRecord {
    return {
      branchId: this.selectedBranchId,
      from: this.feedbackFilters.from,
      to: this.feedbackFilters.to,
      ratingBucket: this.feedbackFilters.ratingBucket,
      negativeOnly: this.feedbackFilters.negativeOnly ? 'true' : ''
    };
  }

  private feedbackQueryString(): string {
    const params = new URLSearchParams();
    Object.entries(this.feedbackQueryParams()).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') params.set(key, String(value));
    });
    return params.toString();
  }

  private isTab(value: unknown): value is ReputationTab {
    return ['overview', 'feedback', 'rating', 'recovery', 'staff'].includes(String(value || ''));
  }

  private arrayFrom(value: unknown): ApiRecord[] {
    return Array.isArray(value) ? value.filter((item): item is ApiRecord => Boolean(item) && typeof item === 'object' && !Array.isArray(item)) : [];
  }

  private recordFrom(value: unknown): ApiRecord {
    return value && typeof value === 'object' && !Array.isArray(value) ? value as ApiRecord : {};
  }

  runPlatformAction(platform: PlatformCard): void {
    if (this.platformActionBusy) return;
    if (!platform.connected || !platform.platformId) {
      this.openPlatformSetup(platform);
      return;
    }

    this.platformActionBusy = platform.code;
    this.platformActionMessage = '';
    const request = platform.connected && platform.platformId
      ? this.reputationApi.syncPlatform(platform.platformId)
      : this.reputationApi.connectPlatform(platform.code, '');

    request.subscribe({
      next: (response) => {
        const result = response as { status?: string; message?: string };
        const status = result.status || result.message || 'not_configured';
        this.platformActionMessage = `${platform.name}: ${status}`;
        this.platformActionBusy = '';
        this.load();
      },
      error: (error) => {
        this.platformActionMessage = error?.error?.error || error?.message || `Unable to update ${platform.name}`;
        this.platformActionBusy = '';
      }
    });
  }

  sendReviewLink(): void {
    const appointmentId = this.reviewAppointmentId.trim();
    if (!appointmentId || this.reviewRequestBusy) {
      this.reviewRequestMessage = appointmentId ? '' : 'Appointment ID required hai.';
      return;
    }
    this.reviewRequestBusy = true;
    this.reviewRequestMessage = '';
    this.reputationApi.sendReviewRequest(appointmentId, {
      invoiceId: this.reviewInvoiceId.trim(),
      channel: this.reviewChannel,
      force: true
    }).subscribe({
      next: (response) => {
        const status = String(response['status'] || 'queued');
        const request = response['request'] as { id?: string } | undefined;
        const requestId = request?.id || '';
        this.reviewRequestMessage = requestId
          ? `Review link queued. Customer link: /reputation/internal-feedback?requestId=${requestId}${this.reviewInvoiceId.trim() ? `&invoiceId=${this.reviewInvoiceId.trim()}` : ''}`
          : `Review request ${status}.`;
        this.reviewRequestBusy = false;
        this.load();
      },
      error: (error) => {
        this.reviewRequestMessage = error?.error?.error || error?.message || 'Unable to send review link.';
        this.reviewRequestBusy = false;
      }
    });
  }

  openPlatformSetup(platform: PlatformCard): void {
    this.setupPlatform = platform;
    this.platformSetupMessage = '';
    this.platformBusinessListingId = platform.businessListingId || '';
    this.platformBusinessListingUrl = platform.businessListingUrl || '';
    this.platformUrl = platform.platformUrl || '';
    this.platformTokenEnvKey = platform.tokenEnvKey || this.defaultCredentialEnvKey(platform.code);
    this.platformAccountId = platform.accountId || '';
    this.platformLocationId = platform.locationId || '';
    this.platformPageAccountId = platform.pageAccountId || '';
    if (platform.code === 'google') {
      this.platformSetupRequirements = [
        'Verified Google Business Profile listing access',
        'Google Cloud project with Business Profile APIs enabled',
        'OAuth client ID and secret configured on backend',
        'Business Profile account ID and location/listing ID',
        'A specific AuraShine branch selected in the Branch dropdown'
      ];
      this.platformSetupSteps = [
        'Select the exact salon branch from the top Branch dropdown.',
        'In Google Cloud Console, enable Google Business Profile APIs for the project.',
        'Create an OAuth Web Application and add AuraShine callback URL from backend config.',
        'Grant the Google account Manager or Owner access to the Business Profile listing.',
        'Create the connection record here, then complete OAuth once provider credentials are configured.'
      ];
      return;
    }
    this.platformSetupRequirements = [
      'Provider OAuth/API credentials',
      'Business listing ID or page/account ID',
      'A specific AuraShine branch selected in the Branch dropdown'
    ];
    this.platformSetupSteps = [
      'Select the branch that owns this listing.',
      'Create the connection record.',
      'Configure the provider adapter credentials on the backend.',
      'Run Sync now after credentials are active.'
    ];
  }

  closePlatformSetup(): void {
    this.setupPlatform = null;
    this.platformSetupMessage = '';
    this.platformBusinessListingId = '';
    this.platformBusinessListingUrl = '';
    this.platformUrl = '';
    this.platformTokenEnvKey = '';
    this.platformAccountId = '';
    this.platformLocationId = '';
    this.platformPageAccountId = '';
  }

  confirmPlatformConnect(platform: PlatformCard): void {
    if (!this.selectedBranchId) {
      this.platformSetupMessage = 'Branch missing: select a real branch instead of "All branches", then connect.';
      return;
    }
    this.platformActionBusy = platform.code;
    this.platformSetupMessage = '';
    this.reputationApi.connectPlatform(platform.code, this.selectedBranchId, {
      businessListingId: this.platformBusinessListingId.trim(),
      businessListingUrl: this.platformBusinessListingUrl.trim(),
      platformUrl: this.platformUrl.trim(),
      tokenEnvKey: this.platformTokenEnvKey.trim(),
      accountId: this.platformAccountId.trim(),
      locationId: this.platformLocationId.trim(),
      pageAccountId: this.platformPageAccountId.trim()
    }).subscribe({
      next: (response) => {
        const result = response as { providerStatus?: string; status?: string; message?: string };
        this.platformSetupMessage = result.message || `${platform.name}: ${result.providerStatus || result.status || 'connection record created'}`;
        this.platformActionMessage = this.platformSetupMessage;
        this.platformActionBusy = '';
        this.load();
      },
      error: (error) => {
        this.platformSetupMessage = error?.error?.error || error?.message || `Unable to connect ${platform.name}`;
        this.platformActionBusy = '';
      }
    });
  }

  listingIdLabel(code: string): string {
    if (code === 'instagram') return 'Instagram business account ID / Facebook page ID';
    if (code === 'google') return 'Google location/listing ID';
    if (code === 'facebook') return 'Facebook page ID';
    return 'Business listing ID / account ID';
  }

  credentialPlaceholder(code: string): string {
    return this.defaultCredentialEnvKey(code) || 'PROVIDER_ACCESS_TOKEN_ENV';
  }

  listingIdPlaceholder(code: string): string {
    if (code === 'instagram') return '1784... or page_...';
    if (code === 'google') return 'locations/123456789 or listing ID';
    if (code === 'facebook') return 'Facebook page ID';
    return 'Provider listing/account ID';
  }

  draftReply(): void {
    const reviewId = this.replyDraftReviewId.trim();
    if (!reviewId || this.replyDraftBusy) return;
    this.replyDraftBusy = true;
    this.replyDraftMessage = '';
    this.replyDrafts = [];
    this.reputationApi.draftReplies(reviewId, { tone: 'warm' }).subscribe({
      next: (response) => {
        this.replyDrafts = response.drafts || [];
        this.replyDraftMessage = response.message || (this.replyDrafts.length ? 'Draft ready for approval.' : 'No draft returned.');
        this.replyDraftBusy = false;
      },
      error: (error) => {
        this.replyDraftMessage = error?.error?.error || error?.message || 'Unable to generate reply draft.';
        this.replyDraftBusy = false;
      }
    });
  }

  saveDraftReply(draft: string): void {
    const reviewId = this.replyDraftReviewId.trim();
    if (!reviewId || !draft.trim()) return;
    this.replyDraftBusy = true;
    this.reputationApi.createReply(reviewId, {
      replyText: draft.trim(),
      aiGenerated: true,
      approvalStatus: 'pending'
    }).subscribe({
      next: () => {
        this.replyDraftMessage = 'Draft saved for approval.';
        this.replyDraftBusy = false;
        this.load();
      },
      error: (error) => {
        this.replyDraftMessage = error?.error?.error || error?.message || 'Unable to save draft.';
        this.replyDraftBusy = false;
      }
    });
  }

  gaugeBackground(score: number): string {
    const degrees = Math.max(0, Math.min(360, Math.round(score * 3.6)));
    return `conic-gradient(#55173D 0deg ${degrees}deg, #edf2f5 ${degrees}deg 360deg)`;
  }

  scoreLabel(score: number): string {
    if (score >= 85) return 'Excellent reputation health across visible review channels.';
    if (score >= 70) return 'Strong reputation with a few response and recovery opportunities.';
    if (score > 0) return 'Reputation needs manager attention and faster recovery workflows.';
    return 'Connect review data to activate reputation scoring.';
  }

  private refreshViewModels(): void {
    this.platformCards = this.buildPlatformCards();
    this.scoreSegmentRows = this.dashboard ? this.buildScoreSegments(this.dashboard) : [];
    const recentReviews = this.dashboard?.recentReviews || [];
    this.sentimentPreviewRows = this.buildSentimentRows(recentReviews);
    this.staffPreviewRows = this.buildStaffLeaderboard(recentReviews);
    this.reviewQueryParams = Object.fromEntries(recentReviews.map((review) => [review.id, { selected: review.id }]));
    if (!this.replyDraftReviewId && recentReviews.length) this.replyDraftReviewId = recentReviews[0].id;
  }

  private buildPlatformCards(): PlatformCard[] {
    const summaries = new Map<string, PlatformSummary>();
    for (const summary of this.dashboard?.platforms || []) {
      summaries.set(summary.platformCode || summary.platformId || summary.platformName, summary);
    }
    const connected = new Map(this.platforms.map((platform) => [platform.platformCode, platform]));
    const supported = this.supported.length ? this.supported.slice(0, 8) : [...summaries.values()].map((summary) => ({ code: summary.platformCode, name: summary.platformName, rateLimitPerDay: 0 }));
    return supported.map((platform) => {
      const summary = summaries.get(platform.code) || summaries.get(platform.name) || null;
      const connection = connected.get(platform.code) || null;
      return {
        code: platform.code,
        platformId: connection?.id || summary?.platformId || '',
        name: platform.name,
        connected: Boolean(connection),
        reviewCount: summary?.reviewCount || 0,
        averageRating: summary?.averageRating || 0,
        platformUrl: connection?.platformUrl || '',
        businessListingId: connection?.businessListingId || '',
        businessListingUrl: connection?.businessListingUrl || '',
        lastSyncStatus: connection?.lastSyncStatus || summary?.lastSyncStatus || 'not_configured',
        lastSyncedAt: connection?.lastSyncedAt || summary?.lastSyncedAt || '',
        providerStatus: connection?.providerStatus || 'not_configured',
        tokenEnvKey: connection?.tokenEnvKey || this.defaultCredentialEnvKey(platform.code),
        accountId: connection?.accountId || '',
        locationId: connection?.locationId || '',
        pageAccountId: connection?.pageAccountId || ''
      };
    });
  }

  private defaultCredentialEnvKey(code: string): string {
    const envKeys: Record<string, string> = {
      google: 'GOOGLE_BUSINESS_PROFILE_ACCESS_TOKEN',
      instagram: 'META_GRAPH_ACCESS_TOKEN',
      facebook: 'META_GRAPH_ACCESS_TOKEN',
      yelp: 'YELP_API_KEY'
    };
    return envKeys[String(code || '').toLowerCase()] || '';
  }

  private buildScoreSegments(data: ReputationDashboard): Array<{ label: string; value: number }> {
    const segments = data.score.segments || {};
    return [
      { label: 'Quality', value: Math.round(segments['quality'] || (data.metrics.averageRating / 5) * 100 || 0) },
      { label: 'Response', value: Math.round(segments['response'] || data.metrics.replyRate || 0) },
      { label: 'Sentiment', value: Math.round(segments['sentiment'] || data.score.positivePct || 0) },
      { label: 'Recency', value: Math.round(segments['recency'] || 0) }
    ];
  }

  private buildSentimentRows(reviews: ReputationReview[]): Array<{ label: string; value: number }> {
    const total = Math.max(1, reviews.length);
    const positive = reviews.filter((review) => this.sentimentClass(review).includes('positive')).length;
    const negative = reviews.filter((review) => this.sentimentClass(review).includes('negative')).length;
    const neutral = Math.max(0, reviews.length - positive - negative);
    return [
      { label: 'Positive', value: Math.round((positive / total) * 100) },
      { label: 'Neutral', value: Math.round((neutral / total) * 100) },
      { label: 'Negative', value: Math.round((negative / total) * 100) }
    ];
  }

  private buildStaffLeaderboard(reviews: ReputationReview[]): StaffPreview[] {
    const grouped = new Map<string, { total: number; mentions: number; negatives: number }>();
    for (const review of reviews) {
      if (!review.primaryStaffId) continue;
      const row = grouped.get(review.primaryStaffId) || { total: 0, mentions: 0, negatives: 0 };
      row.total += review.rating;
      row.mentions += 1;
      if (this.sentimentClass(review).includes('negative') || review.rating <= 3) row.negatives += 1;
      grouped.set(review.primaryStaffId, row);
    }
    return [...grouped.entries()]
      .map(([staffId, row]) => ({ staffId, mentions: row.mentions, negatives: row.negatives, rating: row.mentions ? row.total / row.mentions : 0 }))
      .sort((a, b) => b.rating - a.rating)
      .slice(0, 5);
  }

  sentimentClass(review: ReputationReview): string {
    if (review.sentiment) return review.sentiment;
    if (review.rating >= 4) return 'positive';
    if (review.rating <= 3) return 'negative';
    return 'neutral';
  }

  sentimentLabel(review: ReputationReview): string {
    return this.sentimentClass(review).replace(/_/g, ' ') || 'neutral';
  }

  platformColor(code: string): string {
    const colors: Record<string, string> = {
      google: '#4285f4',
      justdial: '#b77900',
      zomato: '#e23744',
      facebook: '#1877f2',
      instagram: '#c13584',
      whatsapp: '#55173D',
      internal: '#334155'
    };
    return colors[String(code || '').toLowerCase()] || '#475569';
  }

  initials(value: string): string {
    return String(value || 'NA').split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase();
  }
}
