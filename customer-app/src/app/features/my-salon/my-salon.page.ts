import { Component, OnInit, computed, signal } from "@angular/core";
import { Router, RouterLink } from "@angular/router";
import { IonButton, IonContent, IonIcon } from "@ionic/angular/standalone";
import { addIcons } from "ionicons";
import {
  calendarOutline,
  chevronForwardOutline,
  flameOutline,
  giftOutline,
  personOutline,
  pricetagOutline,
  ribbonOutline,
  starOutline,
  timeOutline,
  walletOutline
} from "ionicons/icons";
import { MarketplaceService } from "../../core/marketplace.service";
import { AuthService } from "../../core/auth.service";
import { MySalonDashboard } from "../../core/api.types";

@Component({
  standalone: true,
  imports: [RouterLink, IonButton, IonContent, IonIcon],
  template: `
    <ion-content>
      <main class="page ms-page">
        <!-- Salon Header -->
        @if (dash(); as d) {
          @if (d.salon) {
          <section class="ms-salon-hero">
            <div class="ms-salon-avatar">{{ salonInitials(d.salon.name) }}</div>
            <div class="ms-salon-info">
              <h1>{{ d.salon.name }}</h1>
              <p>{{ d.salon.address }}</p>
              <div class="ms-salon-meta">
                @if (d.salon.ratingCount > 0) {
                <span class="ms-badge"><ion-icon name="star-outline"></ion-icon> {{ d.salon.ratingAverage.toFixed(1) }} ({{ d.salon.ratingCount }})</span>
                }
                <span class="ms-badge" [class.open]="d.salon.isOpen" [class.closed]="!d.salon.isOpen">
                  {{ d.salon.isOpen ? 'Open' : 'Closed' }} · {{ d.salon.hoursLabel }}
                </span>
              </div>
            </div>
            <a [routerLink]="['/business', d.salon.slug]" class="ms-btn-icon" aria-label="View salon profile">
              <ion-icon name="chevron-forward-outline"></ion-icon>
            </a>
          </section>
          }

          <!-- Quick Actions -->
          <section class="ms-actions">
            @if (d.salon) {
            <a [routerLink]="['/business', d.salon.slug, 'book']" class="ms-action">
              <div class="ms-action-icon primary"><ion-icon name="calendar-outline"></ion-icon></div>
              <span>Book now</span>
            </a>
            }
            <a routerLink="/tabs/profile" class="ms-action">
              <div class="ms-action-icon gold"><ion-icon name="wallet-outline"></ion-icon></div>
              <span>Wallet</span>
            </a>
            <a routerLink="/tabs/profile" class="ms-action">
              <div class="ms-action-icon rose"><ion-icon name="ribbon-outline"></ion-icon></div>
              <span>Rewards</span>
            </a>
            <a routerLink="/tabs/profile" class="ms-action">
              <div class="ms-action-icon slate"><ion-icon name="gift-outline"></ion-icon></div>
              <span>Packages</span>
            </a>
          </section>

          <!-- Wallet & Loyalty -->
          @if (d.wallet || d.loyalty) {
          <section class="ms-card-row">
            @if (d.wallet) {
            <article class="ms-stat-card wallet">
              <div class="ms-stat-top">
                <ion-icon name="wallet-outline"></ion-icon>
                <span class="ms-stat-label">Wallet balance</span>
              </div>
              <strong class="ms-stat-value">₹{{ formatPaise(d.wallet.balancePaise) }}</strong>
              @if (d.wallet.transactions.length) {
              <small class="ms-stat-sub">{{ d.wallet.transactions.length }} recent transactions</small>
              }
            </article>
            }
            @if (d.loyalty) {
            <article class="ms-stat-card loyalty">
              <div class="ms-stat-top">
                <ion-icon name="flame-outline"></ion-icon>
                <span class="ms-stat-label">{{ d.loyalty.tier || 'Member' }} tier</span>
              </div>
              <strong class="ms-stat-value">{{ d.loyalty.points }} pts</strong>
              <small class="ms-stat-sub">{{ d.loyalty.lifetimePoints }} lifetime points</small>
            </article>
            }
          </section>
          }

          <!-- Membership -->
          @if (d.membership) {
          <section class="ms-section">
            <div class="ms-section-head">
              <h2>Membership</h2>
            </div>
            <article class="ms-membership-card">
              <div class="ms-membership-info">
                <strong>{{ d.membership.planName }}</strong>
                <span class="ms-badge" [class.active]="d.membership.status === 'active'">{{ d.membership.status }}</span>
              </div>
              <div class="ms-membership-details">
                <span>{{ d.membership.creditsRemaining }} credits remaining</span>
                <span>Valid till {{ formatDate(d.membership.validityDate) }}</span>
              </div>
            </article>
          </section>
          }

          <!-- Packages -->
          @if (d.packages.length) {
          <section class="ms-section">
            <div class="ms-section-head">
              <h2>Your packages</h2>
            </div>
            @for (pkg of d.packages; track pkg.id) {
            <article class="ms-package-row">
              <div class="ms-package-info">
                <strong>{{ pkg.name }}</strong>
                <small>{{ pkg.sessionsUsed }}/{{ pkg.sessionsTotal }} sessions used</small>
              </div>
              <div class="ms-package-bar">
                <div class="ms-package-fill" [style.width.%]="(pkg.sessionsUsed / pkg.sessionsTotal) * 100"></div>
              </div>
            </article>
            }
          </section>
          }

          <!-- Recent Bookings -->
          @if (d.recentBookings.length) {
          <section class="ms-section">
            <div class="ms-section-head">
              <h2>Recent bookings</h2>
              <a routerLink="/tabs/bookings">View all</a>
            </div>
            @for (bk of d.recentBookings; track bk.id) {
            <article class="ms-booking-row">
              <div class="ms-booking-icon">
                <ion-icon name="calendar-outline"></ion-icon>
              </div>
              <div class="ms-booking-info">
                <strong>{{ bk.serviceName }}</strong>
                <small>{{ bk.staffName }} · {{ formatDateTime(bk.startAt) }}</small>
              </div>
              <div class="ms-booking-right">
                <span class="ms-badge" [class]="'status-' + bk.status">{{ bk.status }}</span>
                <small class="ms-booking-price">₹{{ formatPaise(bk.totalPricePaise) }}</small>
              </div>
            </article>
            }
          </section>
          }

          <!-- Services -->
          @if (d.services.length) {
          <section class="ms-section">
            <div class="ms-section-head">
              <h2>Services</h2>
            </div>
            <div class="ms-service-grid">
              @for (svc of d.services.slice(0, 6); track svc.id) {
              <article class="ms-service-chip">
                <strong>{{ svc.name }}</strong>
                <small>{{ svc.durationMinutes }}min · ₹{{ formatPaise(svc.pricePaise) }}</small>
              </article>
              }
            </div>
          </section>
          }

          <!-- Staff -->
          @if (d.staff.length) {
          <section class="ms-section">
            <div class="ms-section-head">
              <h2>Staff</h2>
            </div>
            <div class="ms-staff-row">
              @for (st of d.staff.slice(0, 6); track st.id) {
              <article class="ms-staff-chip">
                <div class="ms-staff-avatar">{{ staffInitials(st.name) }}</div>
                <strong>{{ st.name }}</strong>
                <small>{{ st.specialty || st.title }}</small>
              </article>
              }
            </div>
          </section>
          }

          <!-- Offers -->
          @if (d.offers.length) {
          <section class="ms-section">
            <div class="ms-section-head">
              <h2>Offers for you</h2>
              <a routerLink="/tabs/search" [queryParams]="{ filter: 'deals' }">Discover more</a>
            </div>
            @for (ofr of d.offers.slice(0, 3); track ofr.id) {
            <article class="ms-offer-card">
              <div class="ms-offer-badge">
                @if (ofr.discountType === 'percentage') {
                  {{ ofr.discountValue }}% OFF
                } @else {
                  ₹{{ formatPaise(ofr.discountValue * 100) }} OFF
                }
              </div>
              <div class="ms-offer-info">
                <strong>{{ ofr.title }}</strong>
                <small>{{ ofr.description }}</small>
                <small class="ms-offer-dates">Valid {{ formatDate(ofr.validFrom) }} — {{ formatDate(ofr.validTo) }}</small>
              </div>
            </article>
            }
          </section>
          }

          <!-- No primary salon -->
          @if (!d.hasPrimarySalon) {
          <section class="ms-empty">
            <div class="ms-empty-icon"><ion-icon name="star-outline"></ion-icon></div>
            <h2>No salon selected</h2>
            <p>Visit and book at a salon to see your personal dashboard here.</p>
            <ion-button class="primary-gradient" routerLink="/tabs/search">
              <ion-icon name="search-outline" slot="start"></ion-icon>
              Discover salons
            </ion-button>
          </section>
          }
        } @else {
          <!-- Loading -->
          <section class="ms-loading">
            @for (i of [1,2,3]; track i) {
            <div class="ms-skeleton"></div>
            }
          </section>
        }
      </main>
    </ion-content>
  `,
  styles: [`
    .ms-page {
      display: grid;
      gap: 20px;
      padding: 16px;
    }

    /* ── Salon Hero ── */
    .ms-salon-hero {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 16px;
      border: 1px solid var(--border);
      border-radius: 18px;
      background: rgba(255, 255, 255, 0.85);
      box-shadow: 0 8px 20px rgba(6, 23, 43, 0.06);
    }

    .ms-salon-avatar {
      width: 52px;
      height: 52px;
      border-radius: 14px;
      background: linear-gradient(135deg, var(--primary), var(--brand-600));
      display: flex;
      align-items: center;
      justify-content: center;
      color: white;
      font-weight: 900;
      font-size: 1.1rem;
      flex-shrink: 0;
    }

    .ms-salon-info {
      flex: 1;
      min-width: 0;
    }

    .ms-salon-info h1 {
      margin: 0;
      font-size: 1.1rem;
      font-weight: 950;
      color: var(--text);
      letter-spacing: -0.03em;
    }

    .ms-salon-info p {
      margin: 2px 0 0;
      font-size: 0.78rem;
      color: var(--muted);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .ms-salon-meta {
      display: flex;
      gap: 8px;
      margin-top: 6px;
      flex-wrap: wrap;
    }

    .ms-badge {
      display: inline-flex;
      align-items: center;
      gap: 3px;
      padding: 2px 8px;
      border-radius: 999px;
      background: rgba(11, 70, 120, 0.08);
      color: var(--primary);
      font-size: 0.7rem;
      font-weight: 900;
    }

    .ms-badge.open { background: rgba(34, 197, 94, 0.08); color: #16a34a; }
    .ms-badge.closed { background: rgba(239, 68, 68, 0.08); color: #dc2626; }
    .ms-badge.status-pending { background: rgba(245, 158, 11, 0.08); color: #d97706; }
    .ms-badge.status-confirmed { background: rgba(59, 130, 246, 0.08); color: #2563eb; }
    .ms-badge.status-completed { background: rgba(34, 197, 94, 0.08); color: #16a34a; }
    .ms-badge.status-cancelled { background: rgba(239, 68, 68, 0.08); color: #dc2626; }
    .ms-badge.active { background: rgba(34, 197, 94, 0.08); color: #16a34a; }

    .ms-btn-icon {
      width: 32px;
      height: 32px;
      border-radius: 10px;
      border: 1px solid var(--border);
      display: flex;
      align-items: center;
      justify-content: center;
      color: var(--muted);
      text-decoration: none;
      flex-shrink: 0;
    }

    @media (hover: hover) and (pointer: fine) {
      .ms-btn-icon:hover { border-color: rgba(11, 70, 120, 0.4); color: var(--primary); }
    }

    /* ── Actions ── */
    .ms-actions {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 10px;
    }

    .ms-action {
      display: grid;
      gap: 6px;
      justify-items: center;
      padding: 14px 8px;
      border: 1px solid var(--border);
      border-radius: 14px;
      background: rgba(255, 255, 255, 0.7);
      text-decoration: none;
      color: inherit;
      transition: border-color 160ms ease;
    }

    .ms-action-icon {
      width: 40px;
      height: 40px;
      border-radius: 12px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 1.1rem;
    }

    .ms-action-icon.primary { background: rgba(11, 70, 120, 0.1); color: var(--primary); }
    .ms-action-icon.gold { background: rgba(245, 158, 11, 0.1); color: #d97706; }
    .ms-action-icon.rose { background: rgba(11, 70, 120, 0.1); color: var(--primary); }
    .ms-action-icon.slate { background: rgba(100, 116, 139, 0.1); color: #475569; }

    .ms-action span {
      font-size: 0.74rem;
      font-weight: 900;
      color: var(--text);
    }

    @media (hover: hover) and (pointer: fine) {
      .ms-action:hover { border-color: rgba(11, 70, 120, 0.4); }
    }

    /* ── Stat Cards ── */
    .ms-card-row {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 10px;
    }

    .ms-stat-card {
      display: grid;
      gap: 4px;
      padding: 16px;
      border: 1px solid var(--border);
      border-radius: 16px;
      background: rgba(255, 255, 255, 0.85);
    }

    .ms-stat-top {
      display: flex;
      align-items: center;
      gap: 6px;
    }

    .ms-stat-top ion-icon { font-size: 1rem; }
    .ms-stat-card.wallet .ms-stat-top ion-icon { color: #d97706; }
    .ms-stat-card.loyalty .ms-stat-top ion-icon { color: var(--primary); }

    .ms-stat-label {
      font-size: 0.74rem;
      font-weight: 900;
      color: var(--muted);
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }

    .ms-stat-value {
      font-size: 1.4rem;
      font-weight: 950;
      color: var(--text);
      letter-spacing: -0.04em;
    }

    .ms-stat-sub {
      font-size: 0.7rem;
      color: var(--muted);
      font-weight: 800;
    }

    /* ── Sections ── */
    .ms-section {
      display: grid;
      gap: 10px;
    }

    .ms-section-head {
      display: flex;
      justify-content: space-between;
      align-items: center;
    }

    .ms-section-head h2 {
      margin: 0;
      font-size: 1rem;
      font-weight: 950;
      color: var(--text);
      letter-spacing: -0.03em;
    }

    .ms-section-head a {
      color: var(--primary);
      font-size: 0.78rem;
      font-weight: 900;
      text-decoration: none;
    }

    /* ── Membership ── */
    .ms-membership-card {
      display: grid;
      gap: 8px;
      padding: 16px;
      border: 1px solid var(--border);
      border-radius: 14px;
      background: rgba(255, 255, 255, 0.85);
    }

    .ms-membership-info {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .ms-membership-info strong {
      font-size: 0.95rem;
      color: var(--text);
    }

    .ms-membership-details {
      display: flex;
      gap: 12px;
      font-size: 0.78rem;
      color: var(--muted);
      font-weight: 800;
    }

    /* ── Packages ── */
    .ms-package-row {
      display: grid;
      gap: 6px;
      padding: 12px;
      border: 1px solid var(--border);
      border-radius: 12px;
      background: rgba(255, 255, 255, 0.7);
    }

    .ms-package-info {
      display: flex;
      justify-content: space-between;
      align-items: center;
    }

    .ms-package-info strong { font-size: 0.88rem; color: var(--text); }
    .ms-package-info small { font-size: 0.72rem; color: var(--muted); font-weight: 800; }

    .ms-package-bar {
      height: 4px;
      border-radius: 2px;
      background: rgba(11, 70, 120, 0.1);
      overflow: hidden;
    }

    .ms-package-fill {
      height: 100%;
      border-radius: 2px;
      background: linear-gradient(90deg, var(--primary), var(--brand-600));
      transition: width 400ms ease;
    }

    /* ── Bookings ── */
    .ms-booking-row {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 12px;
      border: 1px solid var(--border);
      border-radius: 12px;
      background: rgba(255, 255, 255, 0.7);
    }

    .ms-booking-icon {
      width: 36px;
      height: 36px;
      border-radius: 10px;
      background: rgba(11, 70, 120, 0.08);
      display: flex;
      align-items: center;
      justify-content: center;
      color: var(--primary);
      flex-shrink: 0;
    }

    .ms-booking-info {
      flex: 1;
      min-width: 0;
    }

    .ms-booking-info strong {
      display: block;
      font-size: 0.85rem;
      color: var(--text);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .ms-booking-info small {
      font-size: 0.72rem;
      color: var(--muted);
      font-weight: 800;
    }

    .ms-booking-right {
      display: flex;
      flex-direction: column;
      align-items: flex-end;
      gap: 2px;
      flex-shrink: 0;
    }

    .ms-booking-price {
      font-size: 0.72rem;
      font-weight: 900;
      color: var(--text);
    }

    /* ── Services Grid ── */
    .ms-service-grid {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 8px;
    }

    .ms-service-chip {
      display: grid;
      gap: 2px;
      padding: 10px 12px;
      border: 1px solid var(--border);
      border-radius: 12px;
      background: rgba(255, 255, 255, 0.7);
    }

    .ms-service-chip strong {
      font-size: 0.8rem;
      color: var(--text);
    }

    .ms-service-chip small {
      font-size: 0.7rem;
      color: var(--muted);
      font-weight: 800;
    }

    /* ── Staff ── */
    .ms-staff-row {
      display: flex;
      gap: 10px;
      overflow-x: auto;
      -webkit-overflow-scrolling: touch;
      scrollbar-width: none;
      padding-bottom: 2px;
    }

    .ms-staff-row::-webkit-scrollbar { display: none; }

    .ms-staff-chip {
      display: grid;
      gap: 4px;
      justify-items: center;
      padding: 12px 14px;
      border: 1px solid var(--border);
      border-radius: 12px;
      background: rgba(255, 255, 255, 0.7);
      min-width: 90px;
      text-align: center;
      flex-shrink: 0;
    }

    .ms-staff-avatar {
      width: 36px;
      height: 36px;
      border-radius: 10px;
      background: linear-gradient(135deg, var(--primary), var(--brand-600));
      display: flex;
      align-items: center;
      justify-content: center;
      color: white;
      font-weight: 900;
      font-size: 0.75rem;
    }

    .ms-staff-chip strong {
      font-size: 0.78rem;
      color: var(--text);
    }

    .ms-staff-chip small {
      font-size: 0.68rem;
      color: var(--muted);
      font-weight: 800;
    }

    /* ── Offers ── */
    .ms-offer-card {
      display: flex;
      gap: 12px;
      padding: 14px;
      border: 1px solid var(--border);
      border-radius: 14px;
      background: rgba(255, 255, 255, 0.7);
    }

    .ms-offer-badge {
      padding: 6px 10px;
      border-radius: 10px;
      background: linear-gradient(135deg, var(--primary), var(--brand-600));
      color: white;
      font-size: 0.72rem;
      font-weight: 950;
      white-space: nowrap;
      display: flex;
      align-items: center;
      align-self: flex-start;
    }

    .ms-offer-info {
      display: grid;
      gap: 2px;
    }

    .ms-offer-info strong {
      font-size: 0.85rem;
      color: var(--text);
    }

    .ms-offer-info small {
      font-size: 0.72rem;
      color: var(--muted);
      font-weight: 800;
    }

    .ms-offer-dates {
      margin-top: 2px;
      color: var(--primary) !important;
    }

    /* ── Empty ── */
    .ms-empty {
      display: grid;
      gap: 12px;
      justify-items: center;
      padding: 40px 16px;
      text-align: center;
    }

    .ms-empty-icon {
      width: 56px;
      height: 56px;
      border-radius: 16px;
      background: rgba(11, 70, 120, 0.08);
      display: flex;
      align-items: center;
      justify-content: center;
      color: var(--primary);
      font-size: 1.5rem;
    }

    .ms-empty h2 {
      margin: 0;
      font-size: 1.1rem;
      font-weight: 950;
      color: var(--text);
    }

    .ms-empty p {
      margin: 0;
      font-size: 0.88rem;
      color: var(--muted);
      max-width: 260px;
    }

    /* ── Loading ── */
    .ms-loading {
      display: grid;
      gap: 12px;
    }

    .ms-skeleton {
      height: 80px;
      border-radius: 14px;
      background: linear-gradient(90deg, rgba(11, 70, 120, 0.06), rgba(11, 70, 120, 0.14), rgba(11, 70, 120, 0.06));
      background-size: 200% 100%;
      animation: shimmer 1.5s infinite;
    }

    @keyframes shimmer {
      0% { background-position: 200% 0; }
      100% { background-position: -200% 0; }
    }

    @media (min-width: 768px) {
      .ms-page {
        padding: 24px;
        max-width: 600px;
        margin: 0 auto;
      }
    }
  `]
})
export class MySalonPage implements OnInit {
  readonly dash = signal<MySalonDashboard | null>(null);

  constructor(
    private readonly marketplace: MarketplaceService,
    private readonly auth: AuthService,
    private readonly router: Router
  ) {
    addIcons({
      calendarOutline,
      chevronForwardOutline,
      flameOutline,
      giftOutline,
      personOutline,
      pricetagOutline,
      ribbonOutline,
      starOutline,
      timeOutline,
      walletOutline
    });
  }

  ngOnInit() {
    if (!this.auth.isAuthenticated()) {
      void this.router.navigate(["/login"]);
      return;
    }
    this.marketplace.loadMySalonDashboard().then((d) => this.dash.set(d)).catch(() => this.dash.set(null));
  }

  salonInitials(name: string): string {
    return name.split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase();
  }

  staffInitials(name: string): string {
    return name.split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase();
  }

  formatPaise(paise: number): string {
    return (paise / 100).toLocaleString("en-IN", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  }

  formatDate(iso: string): string {
    if (!iso) return "";
    return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
  }

  formatDateTime(iso: string): string {
    if (!iso) return "";
    return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
  }
}
