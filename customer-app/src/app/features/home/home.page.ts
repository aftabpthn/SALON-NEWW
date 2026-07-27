import { Component, OnInit, computed, signal } from "@angular/core";
import { RouterLink } from "@angular/router";
import { IonContent, IonIcon } from "@ionic/angular/standalone";
import { addIcons } from "ionicons";
import {
  bookmarkOutline,
  calendarOutline,
  compassOutline,
  logInOutline,
  ribbonOutline,
  sparklesOutline,
  timeOutline,
  walletOutline
} from "ionicons/icons";
import { MarketplaceService } from "../../core/marketplace.service";
import { MySalonDashboard } from "../../core/api.types";

@Component({
  standalone: true,
  imports: [RouterLink, IonContent, IonIcon],
  template: `
    <ion-content>
      <main class="page msd-page">
        @if (showDashboard()) {
        <!-- ═══ MY SALON DASHBOARD ═══ -->
        <section class="msd-hero">
          <div class="msd-hero-top">
            <div>
              <h1 class="msd-name">{{ dash()!.salon?.name }}</h1>
              <p class="msd-address">{{ dash()!.salon?.address }}{{ dash()!.salon?.city ? ', ' + dash()!.salon!.city : '' }}</p>
            </div>
            <span class="msd-status" [class.open]="dash()!.salon?.isOpen">{{ dash()!.salon?.isOpen ? 'Open' : 'Closed' }}</span>
          </div>
          <p class="msd-hours">{{ dash()!.salon?.hoursLabel }}</p>
          @if (dash()!.salon?.ratingAverage) {
          <div class="msd-rating">
            <ion-icon name="sparkles-outline"></ion-icon>
            <strong>{{ dash()!.salon!.ratingAverage.toFixed(1) }}</strong>
            <span>({{ dash()!.salon!.ratingCount }} reviews)</span>
          </div>
          }
          <div class="msd-actions">
            <a [routerLink]="['/business', dash()!.salon?.slug || '']" class="msd-btn primary">
              <ion-icon name="calendar-outline"></ion-icon>
              Book now
            </a>
            <button type="button" class="msd-btn secondary" routerLink="/tabs/search">
              <ion-icon name="compass-outline"></ion-icon>
              Change salon
            </button>
          </div>
        </section>

        <!-- Stats -->
        <div class="msd-stats">
          @if (dash()!.wallet) {
          <a routerLink="/tabs/profile" class="msd-stat">
            <ion-icon name="wallet-outline"></ion-icon>
            <span class="msd-stat-val">{{ money(dash()!.wallet!.balancePaise) }}</span>
            <span class="msd-stat-lbl">Wallet</span>
          </a>
          }
          @if (dash()!.loyalty) {
          <a routerLink="/tabs/profile" class="msd-stat">
            <ion-icon name="ribbon-outline"></ion-icon>
            <span class="msd-stat-val">{{ dash()!.loyalty!.points }} pts</span>
            <span class="msd-stat-lbl">{{ dash()!.loyalty!.tier || 'Member' }}</span>
          </a>
          }
          @if (dash()!.relationship) {
          <div class="msd-stat">
            <ion-icon name="time-outline"></ion-icon>
            <span class="msd-stat-val">{{ dash()!.relationship!.visitCount }}</span>
            <span class="msd-stat-lbl">Visits</span>
          </div>
          }
        </div>

        <!-- Membership -->
        @if (dash()!.membership) {
        <div class="msd-membership">
          <div class="msd-membership-badge">
            <ion-icon name="sparkles-outline"></ion-icon>
            <span>{{ dash()!.membership!.planName }}</span>
          </div>
          <div class="msd-membership-info">
            <strong>{{ dash()!.membership!.creditsRemaining }} credits remaining</strong>
            <span>Valid until {{ dash()!.membership!.validityDate }}</span>
          </div>
        </div>
        }

        <!-- Recent Bookings -->
        @if (dash()!.recentBookings.length) {
        <section class="msd-section">
          <div class="msd-section-head">
            <h2>Recent bookings</h2>
            <a routerLink="/tabs/bookings">View all</a>
          </div>
          <div class="msd-list">
            @for (b of dash()!.recentBookings.slice(0, 3); track b.id) {
            <div class="msd-row">
              <div class="msd-row-info">
                <strong>{{ b.serviceName }}</strong>
                <span>{{ b.staffName }} · {{ fmtDate(b.startAt) }}</span>
              </div>
              <span class="msd-badge" [attr.data-status]="b.status">{{ b.status }}</span>
            </div>
            }
          </div>
        </section>
        }

        <!-- Services -->
        @if (dash()!.services.length) {
        <section class="msd-section">
          <div class="msd-section-head"><h2>Services</h2></div>
          <div class="msd-list">
            @for (s of dash()!.services.slice(0, 6); track s.id) {
            <div class="msd-row">
              <div class="msd-row-info">
                <strong>{{ s.name }}</strong>
                <span>{{ s.category }} · {{ s.durationMinutes }} min</span>
              </div>
              <span class="msd-price">{{ money(s.pricePaise) }}</span>
            </div>
            }
          </div>
        </section>
        }

        <!-- Staff -->
        @if (dash()!.staff.length) {
        <section class="msd-section">
          <div class="msd-section-head"><h2>Staff</h2></div>
          <div class="msd-staff-rail">
            @for (m of dash()!.staff.slice(0, 6); track m.id) {
            <div class="msd-staff-card">
              <div class="msd-staff-avatar">{{ m.name.charAt(0) }}</div>
              <strong>{{ m.name }}</strong>
              <span>{{ m.specialty || m.title }}</span>
            </div>
            }
          </div>
        </section>
        }

        <!-- Offers -->
        @if (dash()!.offers.length) {
        <section class="msd-section">
          <div class="msd-section-head"><h2>Active offers</h2></div>
          <div class="msd-list">
            @for (o of dash()!.offers.slice(0, 3); track o.id) {
            <div class="msd-row offer">
              <div class="msd-row-info">
                <strong>{{ o.title }}</strong>
                <span>{{ o.description }}</span>
              </div>
              <span class="msd-price">{{ o.discountType === 'percentage' ? o.discountValue + '%' : money(o.discountValue) }}</span>
            </div>
            }
          </div>
        </section>
        }

        <!-- Packages -->
        @if (dash()!.packages.length) {
        <section class="msd-section">
          <div class="msd-section-head"><h2>Packages</h2></div>
          <div class="msd-list">
            @for (p of dash()!.packages; track p.id) {
            <div class="msd-row">
              <div class="msd-row-info">
                <strong>{{ p.name }}</strong>
                <span>{{ p.sessionsUsed }}/{{ p.sessionsTotal }} sessions used</span>
              </div>
              <span class="msd-price">{{ money(p.pricePaise) }}</span>
            </div>
            }
          </div>
        </section>
        }

        <!-- Explore CTA -->
        <section class="msd-explore-cta">
          <a routerLink="/tabs/search" class="msd-btn outline full">
            <ion-icon name="compass-outline"></ion-icon>
            Explore more salons
          </a>
        </section>

        } @else {
        <!-- ═══ EMPTY STATE ═══ -->
        <section class="msd-empty">
          <div class="msd-empty-hero">
            <div class="msd-empty-icon">✦</div>
            <h1>Your personal salon hub</h1>
            <p>Set a primary salon to see your wallet, loyalty, bookings, and services in one place.</p>
          </div>
          <div class="msd-empty-actions">
            <a routerLink="/tabs/search" class="msd-btn primary">
              <ion-icon name="compass-outline"></ion-icon>
              Explore salons
            </a>
            @if (!marketplace.isAuthenticated()) {
            <a routerLink="/login" class="msd-btn secondary">
              <ion-icon name="log-in-outline"></ion-icon>
              Sign in
            </a>
            }
          </div>
          <div class="msd-empty-features">
            <div class="msd-empty-feat">
              <ion-icon name="wallet-outline"></ion-icon>
              <strong>Wallet</strong>
              <span>Track credits and balance</span>
            </div>
            <div class="msd-empty-feat">
              <ion-icon name="ribbon-outline"></ion-icon>
              <strong>Loyalty</strong>
              <span>Earn points every visit</span>
            </div>
            <div class="msd-empty-feat">
              <ion-icon name="bookmark-outline"></ion-icon>
              <strong>Quick book</strong>
              <span>Book your favourite services</span>
            </div>
          </div>
        </section>
        }
      </main>
    </ion-content>
  `,
  styles: [`
    /* ═══ My Salon Dashboard — Pure Personal View ═══ */
    .msd-page {
      display: grid;
      gap: 16px;
      padding: 16px;
    }

    .msd-hero {
      display: grid;
      gap: 10px;
      padding: 20px;
      border: 1px solid var(--border);
      border-radius: var(--radius-lg);
      background: linear-gradient(145deg, rgba(255, 251, 241, 0.98), rgba(246, 228, 193, 0.9));
      box-shadow: 0 18px 42px rgba(92, 65, 28, 0.12);
    }

    .msd-hero-top {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 12px;
    }

    .msd-hero-top h1 {
      margin: 0;
      color: var(--text);
      font-size: 1.5rem;
      letter-spacing: -0.04em;
      line-height: 1.2;
    }

    .msd-address {
      margin: 4px 0 0;
      color: var(--muted);
      font-size: 0.84rem;
    }

    .msd-status {
      flex-shrink: 0;
      padding: 4px 12px;
      border-radius: 999px;
      font-size: 0.72rem;
      font-weight: 900;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      background: rgba(239, 68, 68, 0.1);
      color: #dc2626;
    }

    .msd-status.open {
      background: rgba(34, 197, 94, 0.1);
      color: #16a34a;
    }

    .msd-hours {
      margin: 0;
      color: var(--muted);
      font-size: 0.78rem;
    }

    .msd-rating {
      display: flex;
      align-items: center;
      gap: 4px;
      color: var(--text);
      font-size: 0.84rem;
    }

    .msd-rating ion-icon { color: #f59e0b; }
    .msd-rating strong { font-weight: 950; }
    .msd-rating span { color: var(--muted); font-size: 0.78rem; }

    .msd-actions {
      display: flex;
      gap: 8px;
      margin-top: 4px;
    }

    /* ── Buttons ── */
    .msd-btn {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 10px 18px;
      border-radius: 14px;
      font-size: 0.84rem;
      font-weight: 900;
      text-decoration: none;
      border: 0;
      cursor: pointer;
      transition: transform 160ms ease;
    }
    .msd-btn.primary {
      color: #fff;
      background: linear-gradient(135deg, #D6A94A, #9B6B22);
      box-shadow: 0 12px 24px rgba(92, 65, 28, 0.2);
    }
    .msd-btn.secondary {
      color: #6e4810;
      background: rgba(255, 255, 255, 0.72);
      border: 1px solid rgba(214, 169, 74, 0.24);
    }
    .msd-btn.outline {
      color: #6e4810;
      background: rgba(255, 255, 255, 0.6);
      border: 1px dashed rgba(214, 169, 74, 0.34);
    }
    .msd-btn.full {
      display: flex;
      justify-content: center;
      width: 100%;
      padding: 14px;
      font-size: 0.88rem;
    }
    @media (hover: hover) and (pointer: fine) {
      .msd-btn:hover { transform: translateY(-1px); }
    }

    /* ── Stats Row ── */
    .msd-stats {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 10px;
    }
    .msd-stat {
      display: grid;
      gap: 2px;
      padding: 14px;
      border: 1px solid var(--border);
      border-radius: 16px;
      background: rgba(255, 255, 255, 0.7);
      text-decoration: none;
      color: inherit;
    }
    .msd-stat ion-icon { color: #8a5a16; font-size: 1.2rem; margin-bottom: 4px; }
    .msd-stat-val { color: var(--text); font-size: 1.05rem; font-weight: 950; }
    .msd-stat-lbl { color: var(--muted); font-size: 0.72rem; font-weight: 800; }

    /* ── Membership Card ── */
    .msd-membership {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding: 16px;
      border-radius: 16px;
      color: #fff;
      background: linear-gradient(135deg, #F7D982, #D9A943, #B87D1E);
      box-shadow: 0 18px 42px rgba(92, 65, 28, 0.18);
    }
    .msd-membership-badge { display: flex; align-items: center; gap: 6px; font-weight: 950; font-size: 0.9rem; }
    .msd-membership-info { display: grid; gap: 2px; text-align: right; }
    .msd-membership-info strong { font-size: 0.84rem; }
    .msd-membership-info span { color: rgba(255, 255, 255, 0.78); font-size: 0.72rem; }

    /* ── Sections ── */
    .msd-section { display: grid; gap: 10px; }
    .msd-section-head { display: flex; justify-content: space-between; align-items: center; }
    .msd-section-head h2 { margin: 0; color: var(--text); font-size: 1.05rem; font-weight: 950; letter-spacing: -0.03em; }
    .msd-section-head a { color: #8a5a16; font-size: 0.78rem; font-weight: 900; text-decoration: none; }

    /* ── Lists ── */
    .msd-list { display: grid; gap: 8px; }
    .msd-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 12px;
      padding: 12px 14px;
      border: 1px solid var(--border);
      border-radius: 14px;
      background: rgba(255, 255, 255, 0.7);
    }
    .msd-row-info { display: grid; gap: 2px; min-width: 0; }
    .msd-row-info strong { color: var(--text); font-size: 0.88rem; font-weight: 950; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .msd-row-info span { color: var(--muted); font-size: 0.74rem; font-weight: 800; }
    .msd-price { flex-shrink: 0; color: var(--text); font-size: 0.88rem; font-weight: 950; }
    .msd-badge {
      flex-shrink: 0;
      padding: 3px 10px;
      border-radius: 999px;
      font-size: 0.68rem;
      font-weight: 900;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      background: rgba(59, 130, 246, 0.1);
      color: #2563eb;
    }
    .msd-badge[data-status="completed"] { background: rgba(34, 197, 94, 0.1); color: #16a34a; }
    .msd-badge[data-status="cancelled"] { background: rgba(239, 68, 68, 0.1); color: #dc2626; }

    /* ── Staff Rail ── */
    .msd-staff-rail { display: grid; grid-template-columns: repeat(auto-fill, minmax(90px, 1fr)); gap: 10px; }
    .msd-staff-card { display: grid; gap: 4px; padding: 14px 8px; border: 1px solid var(--border); border-radius: 14px; background: rgba(255, 255, 255, 0.7); text-align: center; align-items: center; }
    .msd-staff-avatar { width: 44px; height: 44px; display: grid; place-items: center; border-radius: 50%; color: #120D05; background: linear-gradient(135deg, #F4D58D, #D6A94A); font-weight: 1000; font-size: 1rem; margin: 0 auto; }
    .msd-staff-card strong { color: var(--text); font-size: 0.78rem; font-weight: 950; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .msd-staff-card span { color: var(--muted); font-size: 0.68rem; font-weight: 800; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

    /* ── Explore CTA ── */
    .msd-explore-cta { padding-top: 8px; }

    /* ── Empty State ── */
    .msd-empty { display: grid; gap: 28px; padding: 40px 16px; text-align: center; }
    .msd-empty-hero { display: grid; gap: 12px; justify-items: center; }
    .msd-empty-icon { font-size: 3rem; color: #D6A94A; }
    .msd-empty-hero h1 { margin: 0; color: var(--text); font-size: 1.6rem; letter-spacing: -0.04em; line-height: 1.2; }
    .msd-empty-hero p { margin: 0; color: var(--muted); font-size: 0.9rem; max-width: 340px; line-height: 1.5; }
    .msd-empty-actions { display: flex; justify-content: center; gap: 10px; }
    .msd-empty-features { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; }
    .msd-empty-feat { display: grid; gap: 6px; padding: 18px 10px; border: 1px solid var(--border); border-radius: 16px; background: rgba(255, 255, 255, 0.7); justify-items: center; }
    .msd-empty-feat ion-icon { color: #8a5a16; font-size: 1.4rem; }
    .msd-empty-feat strong { color: var(--text); font-size: 0.84rem; }
    .msd-empty-feat span { color: var(--muted); font-size: 0.72rem; text-align: center; }

    /* ── Responsive ── */
    @media (min-width: 768px) {
      .msd-page { padding: 24px; max-width: 720px; margin: 0 auto; }
    }
    @media (max-width: 400px) {
      .msd-stats { grid-template-columns: 1fr; }
    }
  `]
})
export class HomePage implements OnInit {
  readonly dashboard = signal<MySalonDashboard | null>(null);
  readonly loading = signal(false);
  readonly showDashboard = computed(() => this.marketplace.isAuthenticated() && !!this.dashboard());

  constructor(
    readonly marketplace: MarketplaceService
  ) {
    addIcons({
      bookmarkOutline,
      calendarOutline,
      compassOutline,
      logInOutline,
      ribbonOutline,
      sparklesOutline,
      timeOutline,
      walletOutline
    });
  }

  ngOnInit() {
    if (!this.marketplace.isAuthenticated()) return;
    this.loading.set(true);
    // Load salons first (may already be loaded), then dashboard
    this.marketplace.loadMySalons()
      .then(() => this.marketplace.loadMySalonDashboard())
      .then((d) => this.dashboard.set(d))
      .catch(() => {})
      .finally(() => this.loading.set(false));
  }

  dash(): MySalonDashboard {
    return this.dashboard()!;
  }

  money(paise: number): string {
    return this.marketplace.formatMoney(paise);
  }

  fmtDate(iso: string): string {
    if (!iso) return "";
    const date = new Date(iso);
    const now = new Date();
    const diffDays = Math.floor((now.getTime() - date.getTime()) / 86400000);
    if (diffDays === 0) return "Today";
    if (diffDays === 1) return "Yesterday";
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
  }
}
