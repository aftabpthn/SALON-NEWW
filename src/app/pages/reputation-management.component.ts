import { CommonModule } from '@angular/common';
import { Component, OnInit } from '@angular/core';
import { FormControl, FormGroup, FormsModule, ReactiveFormsModule, Validators } from '@angular/forms';
import { ApiRecord, ApiService } from '../core/api.service';
import { StateComponent } from '../shared/ui/state/state.component';

type Sentiment = 'positive' | 'neutral' | 'negative' | 'mixed' | 'unknown';
type RatingFilter = 'all' | 'high' | 'middle' | 'low';

interface ReviewRecord extends ApiRecord {
  id?: string;
  platform?: string;
  reviewer?: string;
  rating?: number | string;
  sentiment?: string;
  reviewText?: string;
  aiReply?: unknown;
  alerts?: unknown;
  status?: string;
  branchId?: string;
  createdAt?: string;
  created_at?: string;
}

interface SummaryMetric {
  label: string;
  value: string;
  helper: string;
  tone: 'green' | 'blue' | 'gold' | 'rose';
}

interface SegmentRow {
  key: string;
  label: string;
  count: number;
  percent: number;
}

@Component({
  selector: 'app-reputation-management',
  standalone: true,
  imports: [CommonModule, FormsModule, ReactiveFormsModule, StateComponent],
  template: `
    <section class="reputation-page">
      <div class="reputation-hero">
        <div class="hero-copy">
          <h2>Reviews command center</h2>
        </div>
        <div class="hero-actions">
          <button class="ghost-button" type="button" (click)="load()" [disabled]="loading">Refresh</button>
          <button class="primary-button" type="button" (click)="toggleForm()">{{ showForm ? 'Close form' : 'Add review' }}</button>
        </div>
      </div>

      <section class="metric-grid" aria-label="Review performance">
        <article class="metric-card" *ngFor="let metric of metrics" [class]="'metric-card ' + metric.tone">
          <span>{{ metric.label }}</span>
          <strong>{{ metric.value }}</strong>
          <small>{{ metric.helper }}</small>
        </article>
      </section>

      <section class="form-panel" *ngIf="showForm">
        <div class="section-heading">
          <div>
            <h3>Add reputation review</h3>
          </div>
          <button class="icon-button" type="button" (click)="toggleForm()" aria-label="Close review form">x</button>
        </div>

        <form [formGroup]="form" (ngSubmit)="save()">
          <label class="field">
            <span>Platform</span>
            <select formControlName="platform">
              <option value="Google">Google</option>
              <option value="WhatsApp">WhatsApp</option>
              <option value="Instagram">Instagram</option>
              <option value="Facebook">Facebook</option>
              <option value="Justdial">Justdial</option>
              <option value="Walk-in">Walk-in</option>
            </select>
          </label>
          <label class="field">
            <span>Reviewer</span>
            <input formControlName="reviewer" placeholder="Client name" />
          </label>
          <label class="field">
            <span>Rating</span>
            <input type="number" min="1" max="5" step="0.1" formControlName="rating" />
          </label>
          <label class="field">
            <span>Sentiment</span>
            <select formControlName="sentiment">
              <option value="positive">Positive</option>
              <option value="neutral">Neutral</option>
              <option value="negative">Negative</option>
              <option value="mixed">Mixed</option>
            </select>
          </label>
          <label class="field full">
            <span>Review text</span>
            <textarea formControlName="reviewText" rows="3" placeholder="Paste the client review here"></textarea>
          </label>
          <label class="field full">
            <span>AI reply draft</span>
            <textarea formControlName="aiReply" rows="3" placeholder="Optional reply draft for manager approval"></textarea>
          </label>
          <div class="form-actions">
            <button class="ghost-button" type="button" (click)="toggleForm()">Cancel</button>
            <button class="primary-button" type="submit" [disabled]="form.invalid || saving">{{ saving ? 'Saving...' : 'Save review' }}</button>
          </div>
        </form>
      </section>

      <section class="filter-panel">
        <label class="search-field">
          <span>Search</span>
          <input [(ngModel)]="query" placeholder="Search platform, reviewer, review text" />
        </label>
        <label class="compact-field">
          <span>Platform</span>
          <select [(ngModel)]="platformFilter">
            <option value="all">All platforms</option>
            <option *ngFor="let platform of platforms" [value]="platform">{{ platform }}</option>
          </select>
        </label>
        <label class="compact-field">
          <span>Sentiment</span>
          <select [(ngModel)]="sentimentFilter">
            <option value="all">All sentiment</option>
            <option value="positive">Positive</option>
            <option value="neutral">Neutral</option>
            <option value="negative">Negative</option>
            <option value="mixed">Mixed</option>
          </select>
        </label>
        <label class="compact-field">
          <span>Rating</span>
          <select [(ngModel)]="ratingFilter">
            <option value="all">All ratings</option>
            <option value="high">4.5 and above</option>
            <option value="middle">3.0 to 4.4</option>
            <option value="low">Below 3.0</option>
          </select>
        </label>
      </section>

      <app-state [loading]="loading" [error]="error"></app-state>
      <p class="notice" *ngIf="notice">{{ notice }}</p>

      <div class="content-grid" *ngIf="!loading && !error">
        <section class="review-feed" aria-label="Review feed">
          <div class="section-heading">
            <div>
              <h3>{{ filteredReviews.length }} visible reviews</h3>
            </div>
            <span class="health-pill" [class.alert]="negativeCount > 0">{{ healthLabel }}</span>
          </div>

          <article class="review-card" *ngFor="let review of filteredReviews; trackBy: trackByReview">
            <div class="review-topline">
              <div>
                <span class="platform-pill">{{ review.platform || 'Unknown platform' }}</span>
                <h4>{{ review.reviewer || 'Anonymous client' }}</h4>
              </div>
              <div class="rating-badge" [class.low]="ratingOf(review) < 3" [class.mid]="ratingOf(review) >= 3 && ratingOf(review) < 4.5">
                {{ ratingOf(review) | number: '1.1-1' }} / 5
              </div>
            </div>

            <p class="review-text">{{ review.reviewText || 'No review text captured yet.' }}</p>

            <div class="review-meta">
              <span class="sentiment-pill" [class]="sentimentClass(review)">{{ sentimentLabel(review) }}</span>
              <span>{{ createdLabel(review) }}</span>
              <span>{{ alertCount(review) }} alerts</span>
            </div>

            <div class="reply-strip" *ngIf="replyText(review) as reply">
              <div>
                <span>AI reply draft</span>
                <p>{{ reply }}</p>
              </div>
              <button class="ghost-button slim" type="button" (click)="copyReply(review)">Copy reply</button>
            </div>
          </article>

          <div class="empty-state" *ngIf="!filteredReviews.length">
            <strong>No reviews match this view</strong>
            <span>Clear filters or add a new review to start tracking reputation health.</span>
          </div>
        </section>

        <aside class="insight-panel" aria-label="Review intelligence">
          <section>
            <h3>Service recovery radar</h3>
            <div class="segment-list">
              <div class="segment-row" *ngFor="let segment of sentimentSegments">
                <div>
                  <strong>{{ segment.label }}</strong>
                  <span>{{ segment.count }} reviews</span>
                </div>
                <div class="bar-track">
                  <span [style.width.%]="segment.percent"></span>
                </div>
              </div>
            </div>
          </section>

          <section>
            <h3>Platform mix</h3>
            <div class="platform-row" *ngFor="let platform of platformSegments">
              <span>{{ platform.label }}</span>
              <strong>{{ platform.count }}</strong>
            </div>
          </section>

          <section>
            <h3>Manager queue</h3>
            <ul class="action-list">
              <li *ngFor="let action of actionQueue">{{ action }}</li>
            </ul>
          </section>
        </aside>
      </div>
    </section>
  `,
  styles: [`
    .reputation-page { display: grid; gap: 20px; }

    .reputation-hero,
    .filter-panel,
    .form-panel,
    .review-feed,
    .insight-panel {
      border: 1px solid var(--line);
      border-radius: 8px;
      background: var(--surface);
    }

    .reputation-hero {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 20px;
      padding: 28px;
    }

    .hero-copy { max-width: 760px; }
    .hero-copy h2 { margin: 4px 0 8px; font-size: 34px; line-height: 1.1; color: var(--ink); }
    .hero-copy p { margin: 0; color: var(--muted); font-size: 16px; line-height: 1.6; }
    .hero-actions, .form-actions { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }

    .metric-grid {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 14px;
    }

    .metric-card {
      min-height: 126px;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: var(--surface);
      padding: 18px;
      display: grid;
      align-content: space-between;
      gap: 10px;
    }
    .metric-card span, .metric-card small { color: var(--muted); }
    .metric-card strong { font-size: 28px; color: var(--ink); line-height: 1; }
    .metric-card.green { border-top: 4px solid #55173D; }
    .metric-card.blue { border-top: 4px solid #4B1238; }
    .metric-card.gold { border-top: 4px solid #ca8a04; }
    .metric-card.rose { border-top: 4px solid #e11d48; }

    .form-panel, .filter-panel, .review-feed, .insight-panel { padding: 22px; }

    .form-panel form {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 14px;
    }

    .field, .compact-field, .search-field {
      display: grid;
      gap: 7px;
      font-weight: 700;
      color: var(--ink);
    }
    .field.full { grid-column: 1 / -1; }
    .field input, .field select, .field textarea,
    .compact-field select, .search-field input {
      width: 100%;
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 12px 14px;
      background: var(--surface-2);
      color: var(--ink);
      font: inherit;
      font-weight: 500;
      outline: none;
    }
    .field textarea { resize: vertical; }
    .form-actions { grid-column: 1 / -1; justify-content: flex-end; }
    .form-panel .section-heading h3 { color: var(--ink); }

    .filter-panel {
      display: grid;
      grid-template-columns: 1fr repeat(3, minmax(140px, 1fr));
      gap: 14px;
      align-items: end;
    }

    .content-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 18px;
      align-items: stretch;
    }
    .review-feed, .insight-panel { display: grid; align-content: start; }

    .section-heading {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      margin-bottom: 18px;
    }
    .section-heading h3 { margin: 4px 0 0; color: var(--ink); }

    .review-card {
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 18px;
      display: grid;
      gap: 14px;
      background: var(--surface);
    }
    .review-card + .review-card { margin-top: 14px; }

    .review-topline, .review-meta, .reply-strip, .platform-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
    }
    .review-topline h4 { margin: 7px 0 0; color: var(--ink); font-size: 18px; }
    .review-text { margin: 0; color: var(--ink); line-height: 1.65; }
    .review-meta { justify-content: flex-start; flex-wrap: wrap; font-size: 13px; color: var(--muted); }

    .platform-pill, .sentiment-pill, .health-pill, .rating-badge {
      display: inline-flex;
      align-items: center;
      min-height: 30px;
      border-radius: 999px;
      padding: 6px 10px;
      font-size: 13px;
      font-weight: 800;
      line-height: 1;
    }
    .platform-pill { background: #eef6f4; color: #4B1238; }
    .sentiment-pill.positive { background: #e8f7f1; color: #047857; }
    .sentiment-pill.neutral, .sentiment-pill.unknown { background: var(--surface-2); color: var(--muted); }
    .sentiment-pill.negative { background: #fff1f2; color: #be123c; }
    .sentiment-pill.mixed { background: #fef3c7; color: #92400e; }
    .rating-badge { background: #e8f7f1; color: #047857; white-space: nowrap; }
    .rating-badge.mid { background: #fef3c7; color: #92400e; }
    .rating-badge.low { background: #fff1f2; color: #be123c; }

    .reply-strip {
      border-radius: 8px;
      border: 1px solid var(--line);
      background: var(--surface-2);
      padding: 14px;
      align-items: flex-start;
    }
    .reply-strip span { color: var(--muted); }
    .reply-strip p { margin: 5px 0 0; color: var(--ink); line-height: 1.55; }

    .insight-panel { display: grid; gap: 22px; }
    .insight-panel section + section { border-top: 1px solid var(--line); padding-top: 22px; }
    .insight-panel h3 { margin: 4px 0 8px; color: var(--ink); }
    .segment-list { display: grid; gap: 14px; }
    .segment-row { display: grid; gap: 8px; }
    .segment-row span { color: var(--muted); }
    .segment-row > div:first-child { display: flex; justify-content: space-between; gap: 12px; }
    .bar-track { height: 8px; overflow: hidden; border-radius: 999px; background: var(--surface-2); }
    .bar-track span { display: block; height: 100%; border-radius: inherit; background: #55173D; }
    .platform-row { border-bottom: 1px solid var(--line); padding: 11px 0; }
    .platform-row span { color: var(--muted); }
    .platform-row strong { color: var(--ink); }
    .action-list { margin: 0; padding-left: 18px; color: var(--ink); display: grid; gap: 10px; line-height: 1.5; }

    .health-pill { background: #e8f7f1; color: #047857; }
    .health-pill.alert { background: #fff1f2; color: #be123c; }

    .notice {
      margin: 0;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: var(--surface-2);
      padding: 12px 14px;
      font-weight: 700;
      color: var(--ink);
    }

    .empty-state {
      border: 1px dashed var(--line);
      border-radius: 8px;
      padding: 28px;
      display: grid;
      gap: 8px;
      text-align: center;
      color: var(--ink);
    }
    .empty-state span { color: var(--muted); }

    .icon-button {
      width: 36px; height: 36px;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: var(--surface);
      color: var(--ink);
      font-weight: 900;
      cursor: pointer;
    }

    .slim { padding: 9px 12px; white-space: nowrap; }

    @media (max-width: 1180px) {
      .metric-grid, .content-grid, .filter-panel, .form-panel form {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }
      .search-field { grid-column: 1 / -1; }
    }

    @media (max-width: 720px) {
      .reputation-hero, .review-topline, .reply-strip, .section-heading {
        align-items: stretch; flex-direction: column;
      }
      .metric-grid, .content-grid, .filter-panel, .form-panel form {
        grid-template-columns: 1fr;
      }
      .hero-copy h2 { font-size: 28px; }
      .search-field, .field.full, .form-actions { grid-column: auto; }
    }
  `]
})
export class ReputationManagementComponent implements OnInit {
  rows: ReviewRecord[] = [];
  query = '';
  platformFilter = 'all';
  sentimentFilter: Sentiment | 'all' = 'all';
  ratingFilter: RatingFilter = 'all';
  loading = true;
  saving = false;
  error = '';
  notice = '';
  showForm = false;

  readonly form = new FormGroup({
    platform: new FormControl('Google', { nonNullable: true, validators: [Validators.required] }),
    reviewer: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
    rating: new FormControl(5, { nonNullable: true, validators: [Validators.required, Validators.min(1), Validators.max(5)] }),
    sentiment: new FormControl<Sentiment>('positive', { nonNullable: true, validators: [Validators.required] }),
    reviewText: new FormControl('', { nonNullable: true }),
    aiReply: new FormControl('', { nonNullable: true })
  });

  constructor(private readonly api: ApiService) {}

  ngOnInit(): void {
    this.load();
  }

  get filteredReviews(): ReviewRecord[] {
    const term = this.query.trim().toLowerCase();
    return this.rows.filter((review) => {
      const matchesQuery = !term || [
        review.platform,
        review.reviewer,
        review.reviewText,
        review.sentiment,
        this.replyText(review)
      ].some((value) => String(value || '').toLowerCase().includes(term));
      const matchesPlatform = this.platformFilter === 'all' || review.platform === this.platformFilter;
      const sentiment = this.sentimentOf(review);
      const matchesSentiment = this.sentimentFilter === 'all' || sentiment === this.sentimentFilter;
      const rating = this.ratingOf(review);
      const matchesRating =
        this.ratingFilter === 'all' ||
        (this.ratingFilter === 'high' && rating >= 4.5) ||
        (this.ratingFilter === 'middle' && rating >= 3 && rating < 4.5) ||
        (this.ratingFilter === 'low' && rating < 3);
      return matchesQuery && matchesPlatform && matchesSentiment && matchesRating;
    });
  }

  get platforms(): string[] {
    return [...new Set(this.rows.map((row) => row.platform).filter((platform): platform is string => Boolean(platform)))].sort();
  }

  get averageRating(): number {
    if (!this.rows.length) return 0;
    return this.rows.reduce((sum, review) => sum + this.ratingOf(review), 0) / this.rows.length;
  }

  get negativeCount(): number {
    return this.rows.filter((review) => this.sentimentOf(review) === 'negative' || this.ratingOf(review) < 3).length;
  }

  get replyCoverage(): number {
    if (!this.rows.length) return 0;
    return Math.round((this.rows.filter((review) => Boolean(this.replyText(review))).length / this.rows.length) * 100);
  }

  get npsProxy(): number {
    if (!this.rows.length) return 0;
    const promoters = this.rows.filter((review) => this.ratingOf(review) >= 4.5).length;
    const detractors = this.rows.filter((review) => this.ratingOf(review) <= 3).length;
    return Math.round(((promoters - detractors) / this.rows.length) * 100);
  }

  get metrics(): SummaryMetric[] {
    return [
      {
        label: 'Average rating',
        value: `${this.averageRating.toFixed(1)} / 5`,
        helper: `${this.rows.length} reviews analyzed`,
        tone: 'green'
      },
      {
        label: 'NPS proxy',
        value: `${this.npsProxy}`,
        helper: 'Based on rating bands',
        tone: 'blue'
      },
      {
        label: 'AI reply coverage',
        value: `${this.replyCoverage}%`,
        helper: 'Reviews with reply drafts',
        tone: 'gold'
      },
      {
        label: 'Recovery alerts',
        value: `${this.negativeCount}`,
        helper: 'Low sentiment or rating risk',
        tone: 'rose'
      }
    ];
  }

  get sentimentSegments(): SegmentRow[] {
    const labels: Array<[Sentiment, string]> = [
      ['positive', 'Positive'],
      ['neutral', 'Neutral'],
      ['mixed', 'Mixed'],
      ['negative', 'Negative']
    ];
    return labels.map(([key, label]) => {
      const count = this.rows.filter((review) => this.sentimentOf(review) === key).length;
      return { key, label, count, percent: this.percent(count) };
    });
  }

  get platformSegments(): SegmentRow[] {
    return this.platforms.map((platform) => {
      const count = this.rows.filter((review) => review.platform === platform).length;
      return { key: platform, label: platform, count, percent: this.percent(count) };
    });
  }

  get actionQueue(): string[] {
    const queue: string[] = [];
    if (this.negativeCount) queue.push('Call back every low-rating client before the next campaign send.');
    if (this.replyCoverage < 80) queue.push('Draft AI-assisted replies for uncovered reviews.');
    if (this.averageRating < 4.4 && this.rows.length) queue.push('Review service quality patterns with branch managers.');
    if (!queue.length) queue.push('Keep review request cadence active after completed appointments.');
    return queue;
  }

  get healthLabel(): string {
    if (!this.rows.length) return 'No review data';
    if (this.negativeCount) return 'Recovery attention needed';
    if (this.averageRating >= 4.5) return 'Healthy reputation';
    return 'Monitor closely';
  }

  load(clearNotice = true): void {
    this.loading = true;
    this.error = '';
    if (clearNotice) this.notice = '';
    this.api.list<ReviewRecord[]>('reputationReviews', { branchId: this.api.selectedBranchId() }).subscribe({
      next: (rows) => {
        this.rows = rows || [];
        this.loading = false;
      },
      error: (error) => {
        this.error = error?.error?.error || error?.message || 'Unable to load reputation reviews';
        this.loading = false;
      }
    });
  }

  toggleForm(): void {
    this.showForm = !this.showForm;
    this.notice = '';
    if (this.showForm) {
      this.form.reset({
        platform: 'Google',
        reviewer: '',
        rating: 5,
        sentiment: 'positive',
        reviewText: '',
        aiReply: ''
      });
    }
  }

  save(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    const rating = Number(this.form.controls.rating.value || 0);
    const reply = this.form.controls.aiReply.value.trim();
    const payload: ReviewRecord = {
      platform: this.form.controls.platform.value,
      reviewer: this.form.controls.reviewer.value.trim(),
      rating,
      sentiment: this.form.controls.sentiment.value || this.deriveSentiment(rating),
      reviewText: this.form.controls.reviewText.value.trim(),
      aiReply: reply ? { reply, status: 'draft' } : {},
      alerts: this.deriveAlerts(rating, this.form.controls.reviewText.value),
      branchId: this.api.selectedBranchId()
    };

    this.saving = true;
    this.error = '';
    this.api.create<ReviewRecord>('reputationReviews', payload).subscribe({
      next: () => {
        this.saving = false;
        this.showForm = false;
        this.notice = 'Review saved and reputation metrics refreshed.';
        this.load(false);
      },
      error: (error) => {
        this.error = error?.error?.error || error?.message || 'Unable to save reputation review';
        this.saving = false;
      }
    });
  }

  ratingOf(review: ReviewRecord): number {
    const rating = Number(review.rating || 0);
    return Number.isFinite(rating) ? rating : 0;
  }

  sentimentOf(review: ReviewRecord): Sentiment {
    const value = String(review.sentiment || '').toLowerCase();
    if (value === 'positive' || value === 'neutral' || value === 'negative' || value === 'mixed') return value;
    return this.deriveSentiment(this.ratingOf(review));
  }

  sentimentLabel(review: ReviewRecord): string {
    const sentiment = this.sentimentOf(review);
    return sentiment.charAt(0).toUpperCase() + sentiment.slice(1);
  }

  sentimentClass(review: ReviewRecord): string {
    return this.sentimentOf(review);
  }

  replyText(review: ReviewRecord): string {
    const value = review.aiReply;
    if (!value) return '';
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (!trimmed) return '';
      try {
        return this.replyFromObject(JSON.parse(trimmed));
      } catch {
        return trimmed;
      }
    }
    return this.replyFromObject(value);
  }

  alertCount(review: ReviewRecord): number {
    const alerts = review.alerts;
    if (Array.isArray(alerts)) return alerts.length;
    if (typeof alerts === 'string') {
      try {
        const parsed = JSON.parse(alerts);
        return Array.isArray(parsed) ? parsed.length : Number(Boolean(parsed));
      } catch {
        return alerts.trim() ? 1 : 0;
      }
    }
    return alerts && typeof alerts === 'object' ? Object.keys(alerts).length : 0;
  }

  createdLabel(review: ReviewRecord): string {
    const raw = review.createdAt || review.created_at;
    if (!raw) return 'Date not captured';
    const date = new Date(raw);
    if (Number.isNaN(date.getTime())) return 'Date not captured';
    return new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }).format(date);
  }

  async copyReply(review: ReviewRecord): Promise<void> {
    const reply = this.replyText(review);
    if (!reply) {
      this.notice = 'No AI reply draft is available for this review.';
      return;
    }
    try {
      await globalThis.navigator?.clipboard?.writeText(reply);
      this.notice = `AI reply copied for ${review.reviewer || 'this review'}.`;
    } catch {
      this.notice = 'Copy failed. The reply text is visible in the review card.';
    }
  }

  trackByReview(index: number, review: ReviewRecord): string {
    return String(review.id || `${review.platform || 'review'}-${review.reviewer || index}-${review.createdAt || index}`);
  }

  private deriveSentiment(rating: number): Sentiment {
    if (rating >= 4) return 'positive';
    if (rating < 3) return 'negative';
    return 'neutral';
  }

  private deriveAlerts(rating: number, reviewText: string): ApiRecord[] {
    const alerts: ApiRecord[] = [];
    if (rating < 3) alerts.push({ type: 'low_rating', severity: 'high', message: 'Manager callback recommended' });
    if (reviewText.toLowerCase().includes('wait')) alerts.push({ type: 'wait_time', severity: 'medium', message: 'Review appointment timing' });
    return alerts;
  }

  private replyFromObject(value: unknown): string {
    if (!value || typeof value !== 'object') return '';
    const record = value as Record<string, unknown>;
    const candidate = record['reply'] || record['text'] || record['message'] || record['body'] || record['draft'];
    return typeof candidate === 'string' ? candidate : '';
  }

  private percent(count: number): number {
    if (!this.rows.length) return 0;
    return Math.round((count / this.rows.length) * 100);
  }
}
