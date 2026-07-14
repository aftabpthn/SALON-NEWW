import { CommonModule } from '@angular/common';
import { Component, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { forkJoin } from 'rxjs';
import { StateComponent } from '../../../shared/ui/state/state.component';
import { ReputationApiService } from '../data-access/reputation-api.service';
import { ReputationReview, ReviewPlatform, ReviewReply, SupportedPlatform } from '../domain/reputation.models';
import { AuraDatePipe } from '../../../shared/pipes/aura-date.pipe';

type RatingFilter = 'all' | '5' | '4' | '3' | '2' | '1';

@Component({
  selector: 'app-reviews-inbox-page',
  standalone: true,
  imports: [AuraDatePipe, CommonModule, FormsModule, RouterLink, StateComponent],
  template: `
    <section class="inbox-page">
      <header class="page-heading">
        <div>
          <h2>Inbox</h2>
        </div>
        <div class="heading-actions">
          <button class="ghost-button" type="button" (click)="load()" [disabled]="loading">Refresh</button>
          <a class="primary-link" routerLink="/reputation">Command center</a>
        </div>
      </header>

      <app-state [loading]="loading" [error]="error"></app-state>
      <p class="notice" *ngIf="notice">{{ notice }}</p>

      <div class="inbox-layout" *ngIf="!loading && !error">
        <aside class="filter-panel">
          <label class="field">
            <span>Search</span>
            <input [(ngModel)]="filters.search" (ngModelChange)="refreshFilters()" placeholder="Reviewer, text, topic" />
          </label>
          <label class="field">
            <span>Status</span>
            <select [(ngModel)]="filters.status" (ngModelChange)="refreshFilters()">
              <option value="all">All status</option>
              <option value="new">New</option>
              <option value="assigned">Assigned</option>
              <option value="flagged">Flagged</option>
              <option value="resolved">Resolved</option>
            </select>
          </label>
          <label class="field">
            <span>Platform</span>
            <select [(ngModel)]="filters.platform" (ngModelChange)="refreshFilters()">
              <option value="all">All platforms</option>
              <option *ngFor="let platform of platformOptions" [value]="platform.code">{{ platform.name }}</option>
            </select>
          </label>
          <label class="field">
            <span>Rating</span>
            <select [(ngModel)]="filters.rating" (ngModelChange)="refreshFilters()">
              <option value="all">All ratings</option>
              <option value="5">5</option>
              <option value="4">4</option>
              <option value="3">3</option>
              <option value="2">2</option>
              <option value="1">1</option>
            </select>
          </label>
          <label class="field">
            <span>Sentiment</span>
            <select [(ngModel)]="filters.sentiment" (ngModelChange)="refreshFilters()">
              <option value="all">All sentiment</option>
              <option value="positive">Positive</option>
              <option value="neutral">Neutral</option>
              <option value="negative">Negative</option>
              <option value="mixed">Mixed</option>
            </select>
          </label>
          <label class="field">
            <span>Reply</span>
            <select [(ngModel)]="filters.reply" (ngModelChange)="refreshFilters()">
              <option value="all">All replies</option>
              <option value="yes">Has reply</option>
              <option value="no">Needs reply</option>
              <option value="pending">Pending approval</option>
            </select>
          </label>
        </aside>

        <section class="review-list">
          <div class="list-header">
            <div>
              <h3>{{ filteredReviews.length }} reviews</h3>
            </div>
          </div>

          <button type="button" class="review-row" *ngFor="let review of filteredReviews; trackBy: trackByReview" [class.selected]="selected?.id === review.id" (click)="selectReview(review)">
            <div class="platform-dot" [style.background]="platformColor(review.platformCode)">{{ initials(review.platformName) }}</div>
            <div class="review-main">
              <div class="review-title">
                <strong>{{ review.reviewerName }}</strong>
                <span>{{ review.rating | number: '1.1-1' }} / {{ review.ratingMax || 5 }}</span>
              </div>
              <p>{{ review.reviewText || 'No review text captured.' }}</p>
              <div class="meta-row">
                <span>{{ review.platformName }}</span>
                <span [class]="'sentiment ' + sentimentClass(review)">{{ sentimentLabel(review) }}</span>
                <span *ngIf="review.topics.length">{{ review.topics.slice(0, 3).join(', ') }}</span>
                <span>{{ review.createdAt ? (review.createdAt | auraDate:'date') : 'Date missing' }}</span>
              </div>
            </div>
            <div class="status-stack">
              <span [class]="'status ' + review.status">{{ review.status }}</span>
              <small>{{ review.hasReply ? review.replyApprovalStatus || 'reply' : 'needs reply' }}</small>
            </div>
          </button>

          <div class="empty-box" *ngIf="!filteredReviews.length">
            <strong>No reviews match these filters</strong>
            <span>Change filters or connect a platform to expand the inbox.</span>
          </div>
        </section>

        <aside class="detail-panel" *ngIf="selected; else noSelection">
          <app-state [loading]="detailLoading" [error]="detailError"></app-state>
          <ng-container *ngIf="!detailLoading && !detailError && selected as review">
            <div class="detail-head">
              <div>
                <span class="eyebrow">{{ review.platformName }}</span>
                <h3>{{ review.reviewerName }}</h3>
              </div>
              <span [class]="'rating ' + ratingTone(review)">{{ review.rating | number: '1.1-1' }}</span>
            </div>

            <section class="detail-section">
              <p class="review-text">{{ review.reviewText || 'No review text captured.' }}</p>
              <p class="translation" *ngIf="review.reviewTranslatedText">{{ review.reviewTranslatedText }}</p>
              <div class="link-grid">
                <span>Customer: {{ review.customerId || 'not linked' }}</span>
                <span>Appointment: {{ review.appointmentId || 'not linked' }}</span>
                <span>Staff: {{ review.primaryStaffId || 'not attributed' }}</span>
              </div>
            </section>

            <section class="detail-section">
              <div class="section-title">
                <strong>{{ analysisStatus(review) }}</strong>
              </div>
              <div class="analysis-grid">
                <div><span>Sentiment</span><strong>{{ sentimentLabel(review) }}</strong><small>{{ review.sentimentScore | number: '1.2-2' }}</small></div>
                <div><span>Emotion</span><strong>{{ review.emotionPrimary || 'pending' }}</strong><small>{{ review.sentimentConfidence | number: '1.2-2' }} confidence</small></div>
                <div><span>Intent</span><strong>{{ review.intentDetected || 'pending' }}</strong><small>{{ review.reviewLanguage || 'language pending' }}</small></div>
                <div><span>Fake risk</span><strong>{{ review.fakeProbability | percent: '1.0-0' }}</strong><small>{{ review.toxicityScore | percent: '1.0-0' }} toxicity</small></div>
              </div>
              <div class="topic-list" *ngIf="review.topics.length">
                <span *ngFor="let topic of review.topics.slice(0, 6)">{{ topic }}</span>
              </div>
            </section>

            <section class="detail-section">
              <div class="section-title">
                <strong>{{ review.replyApprovalStatus || 'approval required' }}</strong>
              </div>
              <div class="reply-tools">
                <select [(ngModel)]="tone">
                  <option value="warm">Warm</option>
                  <option value="formal">Formal</option>
                  <option value="apologetic">Apologetic</option>
                </select>
                <select [(ngModel)]="language">
                  <option value="en">English</option>
                  <option value="hi">Hindi</option>
                  <option value="mr">Marathi</option>
                  <option value="ta">Tamil</option>
                  <option value="te">Telugu</option>
                </select>
                <button class="ghost-button" type="button" (click)="generateDrafts(review)" [disabled]="actionLoading">Generate AI reply</button>
              </div>
              <textarea [(ngModel)]="replyText" rows="5" placeholder="Write or edit the manager-approved reply"></textarea>
              <div class="actions-row">
                <button class="primary-button" type="button" (click)="saveReply(review)" [disabled]="actionLoading || !replyText.trim()">Save reply</button>
                <button class="ghost-button" type="button" (click)="resolve(review)" [disabled]="actionLoading">Resolve</button>
              </div>
              <div class="reply-history" *ngIf="review.replies?.length">
                <article *ngFor="let reply of review.replies">
                  <p>{{ reply.replyText }}</p>
                  <small>{{ reply.approvalStatus }} · {{ reply.createdAt | auraDate:'date' }}</small>
                  <div class="actions-row compact">
                    <button class="ghost-button" type="button" (click)="approveReply(reply)" [disabled]="actionLoading || reply.approvalStatus === 'approved'">Approve</button>
                    <button class="ghost-button" type="button" (click)="postReply(reply)" [disabled]="actionLoading || reply.approvalStatus !== 'approved'">Post</button>
                  </div>
                </article>
              </div>
            </section>

            <section class="detail-section">
              <div class="section-title">
                <strong>{{ review.priority || 'normal' }}</strong>
              </div>
              <label class="field">
                <span>Assign to</span>
                <input [(ngModel)]="assignedTo" placeholder="manager user id" />
              </label>
              <div class="actions-row">
                <button class="ghost-button" type="button" (click)="assign(review)" [disabled]="actionLoading || !assignedTo.trim()">Assign</button>
                <button class="ghost-button" type="button" (click)="flag(review)" [disabled]="actionLoading">Flag</button>
                <button class="ghost-button" type="button" (click)="resolve(review)" [disabled]="actionLoading">Mark resolved</button>
              </div>
            </section>
          </ng-container>
        </aside>

        <ng-template #noSelection>
          <aside class="detail-panel empty-box">
            <strong>Select a review</strong>
            <span>Full review, AI analysis, reply history and actions will appear here.</span>
          </aside>
        </ng-template>
      </div>
    </section>
  `,
  styles: [`
    .inbox-page { display: grid; gap: 18px; }
    .page-heading, .filter-panel, .review-list, .detail-panel {
      border: 1px solid #dbe4e8;
      border-radius: 8px;
      background: #fff;
      box-shadow: 0 14px 28px rgba(15, 23, 42, 0.06);
    }
    .page-heading { display: flex; justify-content: space-between; gap: 20px; padding: 24px; align-items: center; }
    .page-heading h2 { margin: 4px 0 8px; font-size: 32px; color: #0f172a; letter-spacing: 0; }
    .page-heading p { margin: 0; color: #53657d; line-height: 1.55; }
    .heading-actions, .actions-row, .reply-tools { display: flex; gap: 10px; flex-wrap: wrap; align-items: center; }
    .primary-link { display: inline-flex; align-items: center; justify-content: center; border-radius: 8px; background: #55173D; color: #fff; padding: 12px 16px; text-decoration: none; font-weight: 800; }
    .notice { margin: 0; border: 1px solid #c7e8df; border-radius: 8px; background: #f4fbf8; padding: 12px 14px; color: #53657d; font-weight: 800; }
    .inbox-layout { display: grid; grid-template-columns: 250px minmax(0, 1fr) 420px; gap: 16px; align-items: start; }
    .filter-panel, .review-list, .detail-panel { padding: 18px; }
    .filter-panel { display: grid; gap: 14px; position: sticky; top: 16px; }
    .field { display: grid; gap: 7px; color: #334155; font-weight: 800; }
    .field input, .field select, .reply-tools select, textarea {
      width: 100%;
      border: 1px solid #d8e0e6;
      border-radius: 8px;
      background: #fbfdfe;
      color: #0f172a;
      padding: 11px 12px;
      font: inherit;
      font-weight: 500;
      outline: none;
    }
    textarea { resize: vertical; margin-top: 12px; }
    .list-header, .detail-head, .section-title { display: flex; justify-content: space-between; align-items: center; gap: 12px; margin-bottom: 14px; }
    .list-header h3, .detail-head h3 { margin: 4px 0 0; color: #0f172a; letter-spacing: 0; }
    .review-row {
      width: 100%;
      border: 1px solid #e5edf1;
      border-radius: 8px;
      background: #fff;
      padding: 13px;
      display: grid;
      grid-template-columns: 42px minmax(0, 1fr) 110px;
      gap: 12px;
      text-align: left;
      cursor: pointer;
    }
    .review-row + .review-row { margin-top: 10px; }
    .review-row.selected { border-left: 4px solid #55173D; background: #F5EEF2; }
    .platform-dot { width: 42px; height: 42px; border-radius: 8px; color: #fff; font-weight: 900; display: grid; place-items: center; }
    .review-title { display: flex; justify-content: space-between; gap: 12px; color: #0f172a; }
    .review-main p { margin: 6px 0; color: #334155; line-height: 1.45; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
    .meta-row { display: flex; flex-wrap: wrap; gap: 8px; color: #53657d; font-size: 12px; font-weight: 700; }
    .sentiment, .status, .rating { border-radius: 999px; padding: 5px 9px; font-weight: 900; font-size: 12px; background: #eef2f7; color: #475569; }
    .sentiment.positive, .sentiment.very_positive, .rating.good { background: #FBF0E8; color: #7A4A28; }
    .sentiment.negative, .sentiment.very_negative, .rating.low { background: #fff1f2; color: #be123c; }
    .sentiment.mixed, .rating.mid { background: #fef3c7; color: #92400e; }
    .status-stack { display: grid; justify-items: end; align-content: center; gap: 5px; }
    .status-stack small, .link-grid, .translation, .reply-history small, .empty-box span, .analysis-grid small { color: #53657d; }
    .status.resolved { background: #FBF0E8; color: #7A4A28; }
    .status.flagged { background: #fff1f2; color: #be123c; }
    .detail-panel { min-height: 520px; }
    .rating { font-size: 18px; padding: 9px 12px; }
    .detail-section { border-top: 1px solid #edf2f5; padding-top: 16px; margin-top: 16px; }
    .review-text { margin: 0; color: #26364b; line-height: 1.65; }
    .translation { border-left: 3px solid #55173D; padding-left: 12px; line-height: 1.55; }
    .link-grid { display: grid; gap: 6px; margin-top: 14px; font-weight: 700; }
    .analysis-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
    .analysis-grid div { border: 1px solid #edf2f5; border-radius: 8px; padding: 12px; display: grid; gap: 4px; }
    .analysis-grid span, .section-title span { color: #53657d; font-weight: 800; }
    .analysis-grid strong, .section-title strong { color: #0f172a; }
    .topic-list { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; }
    .topic-list span { background: #eef6f4; color: #4B1238; border-radius: 999px; padding: 6px 10px; font-weight: 800; font-size: 12px; }
    .reply-tools select { width: auto; min-width: 120px; }
    .reply-history { display: grid; gap: 10px; margin-top: 12px; }
    .reply-history article { border: 1px solid #edf2f5; border-radius: 8px; padding: 12px; }
    .reply-history p { margin: 0 0 6px; color: #26364b; line-height: 1.45; }
    .actions-row { margin-top: 12px; }
    .actions-row.compact { margin-top: 8px; }
    .empty-box { border: 1px dashed #cfdbe3; border-radius: 8px; padding: 22px; display: grid; gap: 7px; text-align: center; color: #0f172a; }
    @media (max-width: 1280px) {
      .inbox-layout { grid-template-columns: 230px minmax(0, 1fr); }
      .detail-panel { grid-column: 1 / -1; }
    }
    @media (max-width: 820px) {
      .page-heading, .heading-actions { align-items: stretch; flex-direction: column; }
      .inbox-layout, .analysis-grid { grid-template-columns: 1fr; }
      .filter-panel { position: static; }
      .review-row { grid-template-columns: 42px minmax(0, 1fr); }
      .status-stack { justify-items: start; grid-column: 2; }
    }
  `]
})
export class ReviewsInboxPage implements OnInit {
  reviews: ReputationReview[] = [];
  filteredReviews: ReputationReview[] = [];
  selected: ReputationReview | null = null;
  platforms: ReviewPlatform[] = [];
  supported: SupportedPlatform[] = [];
  platformOptions: Array<{ code: string; name: string }> = [];
  loading = true;
  detailLoading = false;
  actionLoading = false;
  error = '';
  detailError = '';
  notice = '';
  replyText = '';
  assignedTo = '';
  tone = 'warm';
  language = 'en';
  filters: { search: string; status: string; platform: string; rating: RatingFilter; sentiment: string; reply: string } = {
    search: '',
    status: 'all',
    platform: 'all',
    rating: 'all',
    sentiment: 'all',
    reply: 'all'
  };

  constructor(
    private readonly route: ActivatedRoute,
    private readonly reputationApi: ReputationApiService
  ) {}

  ngOnInit(): void {
    this.load();
  }

  refreshFilters(): void {
    const search = this.filters.search.trim().toLowerCase();
    this.filteredReviews = this.reviews.filter((review) => {
      const matchesSearch = !search || [review.reviewerName, review.reviewText, review.platformName, review.topics.join(' ')]
        .some((value) => value.toLowerCase().includes(search));
      const matchesStatus = this.filters.status === 'all' || review.status === this.filters.status;
      const matchesPlatform = this.filters.platform === 'all' || review.platformCode === this.filters.platform;
      const matchesRating = this.filters.rating === 'all' || Math.floor(review.rating) === Number(this.filters.rating);
      const sentiment = this.sentimentClass(review);
      const matchesSentiment = this.filters.sentiment === 'all' || sentiment.includes(this.filters.sentiment);
      const matchesReply =
        this.filters.reply === 'all' ||
        (this.filters.reply === 'yes' && review.hasReply) ||
        (this.filters.reply === 'no' && !review.hasReply) ||
        (this.filters.reply === 'pending' && review.replyApprovalStatus === 'pending');
      return matchesSearch && matchesStatus && matchesPlatform && matchesRating && matchesSentiment && matchesReply;
    });
  }

  private refreshPlatformOptions(): void {
    const connected = this.platforms.map((platform) => ({ code: platform.platformCode, name: platform.platformName }));
    const supported = this.supported.map((platform) => ({ code: platform.code, name: platform.name }));
    const byCode = new Map([...supported, ...connected].map((platform) => [platform.code, platform]));
    this.platformOptions = [...byCode.values()];
  }

  load(): void {
    this.loading = true;
    this.error = '';
    this.notice = '';
    forkJoin({
      reviews: this.reputationApi.reviews({ limit: 250 }),
      platforms: this.reputationApi.platforms()
    }).subscribe({
      next: ({ reviews, platforms }) => {
        this.reviews = reviews;
        this.platforms = platforms.platforms;
        this.supported = platforms.supported;
        this.refreshPlatformOptions();
        this.refreshFilters();
        this.loading = false;
        const selectedId = this.route.snapshot.queryParamMap.get('selected');
        const initial = this.filteredReviews.find((review) => review.id === selectedId) || this.filteredReviews[0] || null;
        if (initial) this.selectReview(initial);
      },
      error: (error) => {
        this.error = error?.error?.error || error?.message || 'Unable to load reviews inbox';
        this.loading = false;
      }
    });
  }

  selectReview(review: ReputationReview): void {
    this.selected = review;
    this.replyText = review.replyText || '';
    this.assignedTo = review.assignedTo || '';
    this.detailLoading = true;
    this.detailError = '';
    this.reputationApi.review(review.id).subscribe({
      next: (detail) => {
        this.selected = detail;
        this.replyText = detail.replyText || '';
        this.assignedTo = detail.assignedTo || '';
        this.detailLoading = false;
        this.replaceReview(detail);
      },
      error: (error) => {
        this.detailError = error?.error?.error || error?.message || 'Unable to load review detail';
        this.detailLoading = false;
      }
    });
  }

  generateDrafts(review: ReputationReview): void {
    this.runAction(() => this.reputationApi.draftReplies(review.id, { tone: this.tone, language: this.language }).subscribe({
      next: (result) => {
        this.notice = result.message || 'Draft generation completed.';
        if (result.drafts.length) this.replyText = result.drafts[0];
        this.actionLoading = false;
      },
      error: (error) => this.actionError(error, 'Unable to generate AI reply drafts')
    }));
  }

  saveReply(review: ReputationReview): void {
    this.runAction(() => this.reputationApi.createReply(review.id, {
      replyText: this.replyText.trim(),
      replyLanguage: this.language,
      aiGenerated: false
    }).subscribe({
      next: () => {
        this.notice = 'Reply saved for approval.';
        this.actionLoading = false;
        this.selectReview(review);
      },
      error: (error) => this.actionError(error, 'Unable to save reply')
    }));
  }

  approveReply(reply: ReviewReply): void {
    this.runAction(() => this.reputationApi.approveReply(reply.id).subscribe({
      next: () => {
        this.notice = 'Reply approved.';
        this.actionLoading = false;
        if (this.selected) this.selectReview(this.selected);
      },
      error: (error) => this.actionError(error, 'Unable to approve reply')
    }));
  }

  postReply(reply: ReviewReply): void {
    this.runAction(() => this.reputationApi.postReply(reply.id).subscribe({
      next: (result) => {
        this.notice = String(result['message'] || 'Reply post attempted.');
        this.actionLoading = false;
      },
      error: (error) => this.actionError(error, 'Unable to post reply')
    }));
  }

  assign(review: ReputationReview): void {
    this.runAction(() => this.reputationApi.assignReview(review.id, this.assignedTo.trim()).subscribe({
      next: (updated) => {
        this.notice = 'Review assigned.';
        this.actionLoading = false;
        this.selected = updated;
        this.replaceReview(updated);
      },
      error: (error) => this.actionError(error, 'Unable to assign review')
    }));
  }

  resolve(review: ReputationReview): void {
    this.runAction(() => this.reputationApi.resolveReview(review.id).subscribe({
      next: (updated) => {
        this.notice = 'Review resolved.';
        this.actionLoading = false;
        this.selected = updated;
        this.replaceReview(updated);
      },
      error: (error) => this.actionError(error, 'Unable to resolve review')
    }));
  }

  flag(review: ReputationReview): void {
    this.runAction(() => this.reputationApi.updateReview(review.id, { isFlagged: true, flaggedReason: 'manager_review', status: 'flagged' }).subscribe({
      next: (updated) => {
        this.notice = 'Review flagged for manager attention.';
        this.actionLoading = false;
        this.selected = updated;
        this.replaceReview(updated);
      },
      error: (error) => this.actionError(error, 'Unable to flag review')
    }));
  }

  trackByReview(_index: number, review: ReputationReview): string {
    return review.id;
  }

  analysisStatus(review: ReputationReview): string {
    return review.sentimentScore || review.topics.length || review.intentDetected ? 'cached' : 'pending';
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

  ratingTone(review: ReputationReview): string {
    if (review.rating >= 4.5) return 'good';
    if (review.rating >= 3) return 'mid';
    return 'low';
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

  private runAction(start: () => void): void {
    this.actionLoading = true;
    this.notice = '';
    start();
  }

  private actionError(error: unknown, fallback: string): void {
    const shaped = error as { error?: { error?: string }; message?: string };
    this.notice = shaped?.error?.error || shaped?.message || fallback;
    this.actionLoading = false;
  }

  private replaceReview(updated: ReputationReview): void {
    this.reviews = this.reviews.map((review) => review.id === updated.id ? { ...review, ...updated } : review);
    this.refreshFilters();
  }
}
