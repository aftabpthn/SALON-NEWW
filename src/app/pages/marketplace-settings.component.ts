import { CommonModule, DecimalPipe } from '@angular/common';
import { Component, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ApiRecord, ApiService } from '../core/api.service';

type ReviewChannels = {
  sms: boolean;
  whatsapp: boolean;
  email: boolean;
};

type MarketplaceSettingsState = {
  internalReviews: boolean;
  marketplaceReviews: boolean;
  googleReviews: boolean;
  showReviewsOnBookingProfile: boolean;
  autoRequestEnabled: boolean;
  channels: ReviewChannels;
  requestTiming: string;
  highRatingMin: number;
  lowRatingMax: number;
  highRatingDestination: string;
  lowRatingDestination: string;
  ownerLowRatingAlert: boolean;
  staffReviewTracking: boolean;
  serviceReviewTracking: boolean;
  goodReviewReply: string;
  badReviewReply: string;
  complaintRecoveryReply: string;
  googleReviewUrl: string;
  marketplaceProfileUrl: string;
};

type ReputationSummary = {
  totalReviews: number;
  averageRating: number;
  pendingRequests: number;
  lowRatingAlerts: number;
  googleRedirects: number;
  internalComplaints: number;
};

const DEFAULT_SETTINGS: MarketplaceSettingsState = {
  internalReviews: true,
  marketplaceReviews: true,
  googleReviews: false,
  showReviewsOnBookingProfile: true,
  autoRequestEnabled: true,
  channels: {
    sms: true,
    whatsapp: true,
    email: false
  },
  requestTiming: 'twoHours',
  highRatingMin: 4,
  lowRatingMax: 3,
  highRatingDestination: 'both',
  lowRatingDestination: 'internalRecovery',
  ownerLowRatingAlert: true,
  staffReviewTracking: true,
  serviceReviewTracking: true,
  goodReviewReply: 'Thank you for your kind review. We look forward to seeing you again.',
  badReviewReply: 'Thank you for sharing this. Our owner will review and connect with you shortly.',
  complaintRecoveryReply: 'We are sorry your visit did not meet expectations. Please allow us to make this right.',
  googleReviewUrl: '',
  marketplaceProfileUrl: ''
};

const DEFAULT_SUMMARY: ReputationSummary = {
  totalReviews: 0,
  averageRating: 0,
  pendingRequests: 0,
  lowRatingAlerts: 0,
  googleRedirects: 0,
  internalComplaints: 0
};

@Component({
  selector: 'app-marketplace-settings',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, DecimalPipe],
  template: `
    <section class="marketplace-settings-page">
      <aside class="settings-nav" aria-label="Settings sections">
        <a routerLink="/settings">General Settings</a>
        <a routerLink="/setting/calendar">Calendar Settings</a>
        <a routerLink="/settings/clients/custom-form">Clients - Custom Form</a>
        <a routerLink="/settings/taxes">Tax Settings</a>
        <a class="active" routerLink="/settings/marketplace">Marketplace Settings</a>
        <a routerLink="/business-details">Business Details</a>
        <a routerLink="/pos/payment-modes">Payment Methods</a>
        <a routerLink="/message-logs">Message History</a>
        <a routerLink="/security">Security</a>
      </aside>

      <main class="settings-content">
        <header class="settings-hero">
          <div>
            <span class="eyebrow">Setup / Reviews</span>
            <h1>Review & Marketplace Reputation Control</h1>
            <p>Control how reviews are collected, where strong ratings are routed, and how low ratings are recovered.</p>
          </div>
          <div class="hero-actions">
            <button class="ghost-button" type="button" (click)="load()">Refresh</button>
            <button class="primary-button" type="button" (click)="save()" [disabled]="saving()">
              {{ saving() ? 'Saving...' : 'Save' }}
            </button>
          </div>
        </header>

        <p class="state success" *ngIf="message()">{{ message() }}</p>
        <p class="state danger" *ngIf="error()">{{ error() }}</p>
        <p class="phase-note">Next phase will connect appointment-complete triggers, Google redirects, complaint tickets, and owner notifications. This page stores the control policy only.</p>

        <section class="dashboard-grid" aria-label="Reputation Dashboard">
          <article>
            <span>Total Reviews</span>
            <strong>{{ summary().totalReviews }}</strong>
          </article>
          <article>
            <span>Average Rating</span>
            <strong>{{ summary().averageRating | number:'1.1-1' }}</strong>
          </article>
          <article>
            <span>Pending Requests</span>
            <strong>{{ summary().pendingRequests }}</strong>
          </article>
          <article>
            <span>Low Rating Alerts</span>
            <strong>{{ summary().lowRatingAlerts }}</strong>
          </article>
          <article>
            <span>Google Redirects</span>
            <strong>{{ summary().googleRedirects }}</strong>
          </article>
          <article>
            <span>Internal Complaints</span>
            <strong>{{ summary().internalComplaints }}</strong>
          </article>
        </section>

        <section class="settings-grid">
          <article class="settings-section">
            <div class="section-intro">
              <h2>Review Channels</h2>
              <p>Enable the review destinations the salon wants to use.</p>
            </div>
            <label class="switch-card">
              <span><strong>Internal Reviews</strong><small>Collect private salon feedback.</small></span>
              <input type="checkbox" [(ngModel)]="settings.internalReviews" />
              <i aria-hidden="true"></i>
            </label>
            <label class="switch-card">
              <span><strong>Marketplace Reviews</strong><small>Use the marketplace profile review flow.</small></span>
              <input type="checkbox" [(ngModel)]="settings.marketplaceReviews" />
              <i aria-hidden="true"></i>
            </label>
            <label class="switch-card">
              <span><strong>Google Reviews</strong><small>Route happy clients to Google review link.</small></span>
              <input type="checkbox" [(ngModel)]="settings.googleReviews" />
              <i aria-hidden="true"></i>
            </label>
          </article>

          <article class="settings-section">
            <div class="section-intro">
              <h2>Auto Review Request</h2>
              <p>Send review links after appointment completion.</p>
            </div>
            <label class="switch-card">
              <span><strong>Auto request enabled</strong><small>Prepare automatic review requests after service completion.</small></span>
              <input type="checkbox" [(ngModel)]="settings.autoRequestEnabled" />
              <i aria-hidden="true"></i>
            </label>
            <div class="channel-row" aria-label="Channels: SMS, WhatsApp, Email">
              <label><input type="checkbox" [(ngModel)]="settings.channels.sms" /> SMS</label>
              <label><input type="checkbox" [(ngModel)]="settings.channels.whatsapp" /> WhatsApp</label>
              <label><input type="checkbox" [(ngModel)]="settings.channels.email" /> Email</label>
            </div>
            <label class="field">
              <span>Review Timing</span>
              <select [(ngModel)]="settings.requestTiming">
                <option value="immediate">Immediately</option>
                <option value="twoHours">2 hours later</option>
                <option value="nextDay">Next day</option>
              </select>
            </label>
          </article>

          <article class="settings-section">
            <div class="section-intro">
              <h2>Rating Rules</h2>
              <p>Route good ratings outward and low ratings into recovery.</p>
            </div>
            <div class="form-grid two">
              <label class="field">
                <span>High rating minimum</span>
                <input type="number" min="1" max="5" [(ngModel)]="settings.highRatingMin" />
              </label>
              <label class="field">
                <span>Low rating maximum</span>
                <input type="number" min="1" max="5" [(ngModel)]="settings.lowRatingMax" />
              </label>
              <label class="field">
                <span>4-5 star destination</span>
                <select [(ngModel)]="settings.highRatingDestination">
                  <option value="google">Google</option>
                  <option value="marketplace">Marketplace</option>
                  <option value="both">Google + Marketplace</option>
                </select>
              </label>
              <label class="field">
                <span>1-3 star destination</span>
                <select [(ngModel)]="settings.lowRatingDestination" disabled>
                  <option value="internalRecovery">Internal complaint/recovery flow</option>
                </select>
              </label>
            </div>
          </article>

          <article class="settings-section">
            <div class="section-intro">
              <h2>Tracking & Alerts</h2>
              <p>Track review quality by staff and service, and notify owners on low ratings.</p>
            </div>
            <label class="switch-card">
              <span><strong>Negative Review Alert</strong><small>Owner notification for low rating cases.</small></span>
              <input type="checkbox" [(ngModel)]="settings.ownerLowRatingAlert" />
              <i aria-hidden="true"></i>
            </label>
            <label class="switch-card">
              <span><strong>Staff Review Tracking</strong><small>Track rating by staff member.</small></span>
              <input type="checkbox" [(ngModel)]="settings.staffReviewTracking" />
              <i aria-hidden="true"></i>
            </label>
            <label class="switch-card">
              <span><strong>Service Review Tracking</strong><small>Track rating by service category.</small></span>
              <input type="checkbox" [(ngModel)]="settings.serviceReviewTracking" />
              <i aria-hidden="true"></i>
            </label>
          </article>

          <article class="settings-section wide">
            <div class="section-intro">
              <h2>Marketplace Visibility</h2>
              <p>Control public review display and profile links.</p>
            </div>
            <label class="switch-card">
              <span><strong>Show reviews on online booking/profile</strong><small>Use approved ratings on customer-facing surfaces.</small></span>
              <input type="checkbox" [(ngModel)]="settings.showReviewsOnBookingProfile" />
              <i aria-hidden="true"></i>
            </label>
            <div class="form-grid two">
              <label class="field">
                <span>Google review URL</span>
                <input [(ngModel)]="settings.googleReviewUrl" placeholder="https://g.page/r/..." />
              </label>
              <label class="field">
                <span>Marketplace profile URL</span>
                <input [(ngModel)]="settings.marketplaceProfileUrl" placeholder="https://..." />
              </label>
            </div>
          </article>

          <article class="settings-section wide">
            <div class="section-intro">
              <h2>Reply Templates</h2>
              <p>Reusable replies for review response and complaint recovery.</p>
            </div>
            <div class="form-grid three">
              <label class="field">
                <span>Good review reply</span>
                <textarea [(ngModel)]="settings.goodReviewReply"></textarea>
              </label>
              <label class="field">
                <span>Bad review reply</span>
                <textarea [(ngModel)]="settings.badReviewReply"></textarea>
              </label>
              <label class="field">
                <span>Complaint recovery reply</span>
                <textarea [(ngModel)]="settings.complaintRecoveryReply"></textarea>
              </label>
            </div>
          </article>
        </section>
      </main>
    </section>
  `,
  styles: [`
    .marketplace-settings-page {
      display: grid;
      grid-template-columns: 220px minmax(0, 1fr);
      gap: 18px;
      padding: 20px;
      background: #f6f8f7;
      min-height: calc(100vh - 74px);
      color: var(--ink);
    }

    .settings-nav {
      position: sticky;
      top: 90px;
      align-self: start;
      background: #ffffff;
      border: 1px solid #d9e5e0;
      border-radius: 18px;
      padding: 14px;
      display: grid;
      gap: 8px;
    }

    .settings-nav a {
      color: #263a4d;
      text-decoration: none;
      font-weight: 800;
      padding: 10px 12px;
      border-radius: 12px;
    }

    .settings-nav a.active,
    .settings-nav a:hover {
      background: #e8f7f1;
      color: #08785d;
    }

    .settings-content {
      min-width: 0;
      display: grid;
      gap: 16px;
    }

    .settings-hero,
    .settings-section,
    .dashboard-grid article {
      background: #ffffff;
      border: 1px solid #d9e5e0;
      border-radius: 18px;
      box-shadow: 0 14px 32px rgba(15, 23, 42, 0.06);
    }

    .settings-hero {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      padding: 24px;
    }

    .eyebrow,
    .settings-section h2,
    .dashboard-grid span {
      color: #5b6a63;
      font-size: 0.78rem;
      text-transform: uppercase;
      letter-spacing: 0;
      font-weight: 900;
    }

    h1 {
      margin: 4px 0 8px;
      font-size: clamp(2rem, 4vw, 3rem);
      letter-spacing: 0;
    }

    p {
      margin: 0;
      color: #55677a;
    }

    .hero-actions {
      display: flex;
      gap: 10px;
      flex-wrap: wrap;
      justify-content: flex-end;
    }

    button {
      border: 0;
      border-radius: 12px;
      padding: 12px 18px;
      font-weight: 900;
      cursor: pointer;
    }

    button:disabled {
      opacity: 0.65;
      cursor: wait;
    }

    .primary-button {
      background: #0a9b72;
      color: #ffffff;
    }

    .ghost-button {
      background: #ffffff;
      border: 1px solid #d9e5e0;
      color: #172334;
    }

    .state,
    .phase-note {
      border-radius: 14px;
      padding: 12px 14px;
      font-weight: 800;
    }

    .state.success {
      background: #e8f7f1;
      color: #08785d;
      border: 1px solid #9bddca;
    }

    .state.danger {
      background: #fff0f0;
      color: #b42318;
      border: 1px solid #ffc9c9;
    }

    .phase-note {
      background: #fff8e7;
      color: #805600;
      border: 1px solid #f0d48a;
    }

    .dashboard-grid {
      display: grid;
      grid-template-columns: repeat(6, minmax(150px, 1fr));
      gap: 12px;
      overflow-x: auto;
      padding-bottom: 4px;
    }

    .dashboard-grid article {
      padding: 16px;
      min-height: 108px;
      display: grid;
      align-content: center;
      gap: 8px;
    }

    .dashboard-grid strong {
      font-size: 2rem;
    }

    .settings-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 16px;
    }

    .settings-section {
      padding: 18px;
      display: grid;
      gap: 14px;
      min-width: 0;
    }

    .settings-section.wide {
      grid-column: 1 / -1;
    }

    .section-intro h2 {
      margin: 0 0 6px;
      font-size: 1rem;
    }

    .switch-card {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto auto;
      align-items: center;
      gap: 12px;
      border: 1px solid #d9e5e0;
      border-radius: 14px;
      padding: 14px;
      background: #fbfdfc;
    }

    .switch-card span {
      display: grid;
      gap: 4px;
      min-width: 0;
    }

    .switch-card small {
      color: #627385;
      font-weight: 600;
    }

    .switch-card input[type="checkbox"] {
      position: absolute;
      opacity: 0;
      pointer-events: none;
    }

    .switch-card i {
      width: 48px;
      height: 28px;
      border-radius: 999px;
      background: #cbd5df;
      position: relative;
    }

    .switch-card i::after {
      content: '';
      position: absolute;
      width: 20px;
      height: 20px;
      left: 4px;
      top: 4px;
      border-radius: 999px;
      background: #ffffff;
      transition: transform 0.16s ease;
    }

    .switch-card input:checked + i {
      background: #111827;
    }

    .switch-card input:checked + i::after {
      transform: translateX(20px);
    }

    .channel-row {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
    }

    .channel-row label {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      border: 1px solid #d9e5e0;
      border-radius: 999px;
      padding: 9px 12px;
      font-weight: 900;
      background: #ffffff;
    }

    .form-grid {
      display: grid;
      gap: 12px;
    }

    .form-grid.two {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }

    .form-grid.three {
      grid-template-columns: repeat(3, minmax(0, 1fr));
    }

    .field {
      display: grid;
      gap: 7px;
      font-weight: 900;
      min-width: 0;
    }

    input,
    select,
    textarea {
      width: 100%;
      border: 1px solid #d9e5e0;
      border-radius: 12px;
      padding: 12px;
      color: #172334;
      background: #ffffff;
      font: inherit;
      min-width: 0;
    }

    textarea {
      min-height: 104px;
      resize: vertical;
    }

    @media (max-width: 1100px) {
      .marketplace-settings-page {
        grid-template-columns: 1fr;
      }

      .settings-nav {
        position: static;
        display: flex;
        overflow-x: auto;
      }

      .settings-nav a {
        white-space: nowrap;
      }

      .settings-grid,
      .form-grid.two,
      .form-grid.three {
        grid-template-columns: 1fr;
      }
    }

    @media (max-width: 720px) {
      .marketplace-settings-page {
        padding: 12px;
      }

      .settings-hero {
        align-items: flex-start;
        flex-direction: column;
      }

      .hero-actions {
        width: 100%;
      }

      .hero-actions button {
        flex: 1;
      }
    }
  `]
})
export class MarketplaceSettingsComponent implements OnInit {
  readonly saving = signal(false);
  readonly message = signal('');
  readonly error = signal('');
  readonly summary = signal<ReputationSummary>({ ...DEFAULT_SUMMARY });

  settings: MarketplaceSettingsState = this.cloneSettings(DEFAULT_SETTINGS);

  constructor(private readonly api: ApiService) {}

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.error.set('');
    this.message.set('');
    this.api.list<{ settings?: ApiRecord; summary?: ReputationSummary }>('v1/settings/marketplace').subscribe({
      next: (result) => {
        this.settings = this.normalize(result.settings || {});
        this.summary.set({ ...DEFAULT_SUMMARY, ...(result.summary || {}) });
      },
      error: (error) => {
        this.error.set(error?.error?.error || error?.message || 'Unable to load marketplace settings');
      }
    });
  }

  save(): void {
    this.saving.set(true);
    this.error.set('');
    this.message.set('');
    const settings = this.normalize(this.settings);
    this.api.put<{ settings?: ApiRecord; summary?: ReputationSummary }>('v1/settings/marketplace', { settings }).subscribe({
      next: (result) => {
        this.settings = this.normalize(result.settings || settings);
        this.summary.set({ ...DEFAULT_SUMMARY, ...(result.summary || this.summary()) });
        this.message.set('Marketplace settings saved');
        this.saving.set(false);
      },
      error: (error) => {
        this.error.set(error?.error?.error || error?.message || 'Unable to save marketplace settings');
        this.saving.set(false);
      }
    });
  }

  private normalize(input: ApiRecord | MarketplaceSettingsState): MarketplaceSettingsState {
    const raw = input as Partial<MarketplaceSettingsState>;
    const channels = (raw.channels || {}) as Partial<ReviewChannels>;
    const highRatingMin = this.clampRating(raw.highRatingMin, DEFAULT_SETTINGS.highRatingMin);
    const lowRatingMax = Math.min(this.clampRating(raw.lowRatingMax, DEFAULT_SETTINGS.lowRatingMax), highRatingMin - 1);
    return {
      ...this.cloneSettings(DEFAULT_SETTINGS),
      internalReviews: raw.internalReviews !== false,
      marketplaceReviews: raw.marketplaceReviews !== false,
      googleReviews: raw.googleReviews === true,
      showReviewsOnBookingProfile: raw.showReviewsOnBookingProfile !== false,
      autoRequestEnabled: raw.autoRequestEnabled !== false,
      channels: {
        sms: channels.sms !== false,
        whatsapp: channels.whatsapp !== false,
        email: channels.email === true
      },
      requestTiming: ['immediate', 'twoHours', 'nextDay'].includes(String(raw.requestTiming)) ? String(raw.requestTiming) : DEFAULT_SETTINGS.requestTiming,
      highRatingMin,
      lowRatingMax,
      highRatingDestination: ['google', 'marketplace', 'both'].includes(String(raw.highRatingDestination)) ? String(raw.highRatingDestination) : DEFAULT_SETTINGS.highRatingDestination,
      lowRatingDestination: 'internalRecovery',
      ownerLowRatingAlert: raw.ownerLowRatingAlert !== false,
      staffReviewTracking: raw.staffReviewTracking !== false,
      serviceReviewTracking: raw.serviceReviewTracking !== false,
      goodReviewReply: String(raw.goodReviewReply || DEFAULT_SETTINGS.goodReviewReply),
      badReviewReply: String(raw.badReviewReply || DEFAULT_SETTINGS.badReviewReply),
      complaintRecoveryReply: String(raw.complaintRecoveryReply || DEFAULT_SETTINGS.complaintRecoveryReply),
      googleReviewUrl: String(raw.googleReviewUrl || ''),
      marketplaceProfileUrl: String(raw.marketplaceProfileUrl || '')
    };
  }

  private cloneSettings(settings: MarketplaceSettingsState): MarketplaceSettingsState {
    return {
      ...settings,
      channels: { ...settings.channels }
    };
  }

  private clampRating(value: unknown, fallback: number): number {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(5, Math.max(1, Math.round(parsed)));
  }
}
