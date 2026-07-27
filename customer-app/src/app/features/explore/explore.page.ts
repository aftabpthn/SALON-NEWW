import { Component, OnInit, computed, signal } from "@angular/core";
import { Router, RouterLink } from "@angular/router";
import { IonButton, IonContent, IonIcon } from "@ionic/angular/standalone";
import { addIcons } from "ionicons";
import {
  businessOutline,
  chevronForwardOutline,
  locationOutline,
  navigateOutline,
  pricetagOutline,
  ribbonOutline,
  searchOutline,
  timeOutline
} from "ionicons/icons";
import { BusinessCardComponent } from "../../shared/business-card.component";
import { MarketplaceService } from "../../core/marketplace.service";
import { Business } from "../../core/api.types";

@Component({
  standalone: true,
  imports: [RouterLink, IonButton, IonContent, IonIcon, BusinessCardComponent],
  template: `
    <ion-content>
      <main class="page explore-page">
        <!-- Header -->
        <div class="explore-header">
          <div class="explore-greeting">
            <h1>{{ greeting() }}</h1>
            <p class="explore-location">
              <ion-icon name="location-outline"></ion-icon>
              {{ areaLabel() }}
            </p>
          </div>
        </div>

        <!-- Search Bar (tap → opens full search) -->
        <button type="button" class="explore-search-bar" (click)="openSearch()">
          <ion-icon name="search-outline"></ion-icon>
          <span>Search services, salons or staff...</span>
        </button>

        <!-- Quick Filters -->
        <div class="explore-chips">
          <a routerLink="/search" [queryParams]="{ filter: 'nearest', sort: 'distance', nearMe: true }" class="chip">
            <ion-icon name="navigate-outline"></ion-icon> Near me
          </a>
          <a routerLink="/search" [queryParams]="{ filter: 'open' }" class="chip">Open now</a>
          <a routerLink="/search" [queryParams]="{ filter: 'deals' }" class="chip">
            <ion-icon name="pricetag-outline"></ion-icon> Offers
          </a>
          <a routerLink="/search" [queryParams]="{ filter: 'premium' }" class="chip">Premium</a>
        </div>

        <!-- Categories -->
        @if (marketplace.categories().length) {
        <section class="explore-section">
          <div class="explore-section-head">
            <h2>Categories</h2>
          </div>
          <div class="explore-categories">
            @for (cat of marketplace.categories(); track cat.id || cat.slug) {
            <a routerLink="/search" [queryParams]="{ category: cat.slug }" class="category-card">
              <ion-icon name="business-outline"></ion-icon>
              <span>{{ cat.label }}</span>
            </a>
            }
          </div>
        </section>
        }

        <!-- Where You Left Off -->
        @if (recentlyViewed().length) {
        <section class="explore-section">
          <div class="explore-section-head">
            <h2>Continue where you left off</h2>
          </div>
          <div class="explore-business-grid">
            @for (biz of recentlyViewed(); track biz.id) {
              <aura-business-card [business]="biz" [userLocation]="currentLocation()"></aura-business-card>
            }
          </div>
        </section>
        }

        <!-- Recommendations -->
        <section class="explore-section">
          <div class="explore-section-head">
            <h2>Recommended for you</h2>
            <a routerLink="/search">See all</a>
          </div>
          <div class="explore-business-grid">
            @for (biz of recommendations(); track biz.id) {
              <aura-business-card [business]="biz" [userLocation]="currentLocation()"></aura-business-card>
            } @empty {
              @if (!marketplace.loading()) {
              <div class="explore-empty">
                <p>No salons found nearby yet.</p>
                <ion-button class="primary-gradient" (click)="openSearch()">
                  <ion-icon name="search-outline" slot="start"></ion-icon>
                  Discover salons
                </ion-button>
              </div>
              }
            }
          </div>
        </section>

        <!-- Recently Viewed -->
        @if (recentlyVisited().length) {
        <section class="explore-section">
          <div class="explore-section-head">
            <h2>Book again</h2>
            <a routerLink="/tabs/bookings">View bookings</a>
          </div>
          <div class="explore-business-grid">
            @for (item of recentlyVisited(); track item.business.id) {
              <aura-business-card [business]="item.business" [userLocation]="currentLocation()"></aura-business-card>
            }
          </div>
        </section>
        }

        <!-- Loading -->
        @if (marketplace.loading()) {
        <section class="explore-loading">
          @for (i of [1,2,3]; track i) {
          <div class="skeleton-card"></div>
          }
        </section>
        }
      </main>
    </ion-content>
  `,
  styles: [`
    .explore-page {
      display: grid;
      gap: 16px;
      padding: 16px;
    }

    .explore-header {
      display: grid;
      gap: 4px;
    }

    .explore-greeting h1 {
      margin: 0;
      color: var(--text);
      font-size: 1.5rem;
      letter-spacing: -0.04em;
      line-height: 1.2;
    }

    .explore-location {
      display: flex;
      align-items: center;
      gap: 4px;
      margin: 0;
      color: var(--muted);
      font-size: 0.84rem;
      font-weight: 800;
    }

    .explore-location ion-icon {
      color: #8a5a16;
    }

    /* ── Search Bar (tap target) ── */
    .explore-search-bar {
      display: flex;
      align-items: center;
      gap: 10px;
      width: 100%;
      padding: 14px 16px;
      border: 1px solid var(--border);
      border-radius: 14px;
      background: rgba(255, 255, 255, 0.85);
      box-shadow: 0 8px 20px rgba(92, 65, 28, 0.06);
      color: var(--muted);
      font-size: 0.88rem;
      font-weight: 800;
      text-align: left;
      cursor: pointer;
      transition: border-color 160ms ease, box-shadow 160ms ease;
    }

    .explore-search-bar ion-icon {
      color: #8a5a16;
      font-size: 1.1rem;
    }

    @media (hover: hover) and (pointer: fine) {
      .explore-search-bar:hover {
        border-color: rgba(214, 169, 74, 0.4);
        box-shadow: 0 12px 28px rgba(92, 65, 28, 0.1);
      }
    }

    /* ── Quick Chips ── */
    .explore-chips {
      display: flex;
      gap: 8px;
      overflow-x: auto;
      -webkit-overflow-scrolling: touch;
      scrollbar-width: none;
      padding-bottom: 2px;
    }

    .explore-chips::-webkit-scrollbar { display: none; }

    .chip {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      flex-shrink: 0;
      padding: 8px 14px;
      border: 1px solid var(--border);
      border-radius: 999px;
      color: var(--text);
      background: rgba(255, 255, 255, 0.8);
      font-size: 0.78rem;
      font-weight: 900;
      text-decoration: none;
      transition: border-color 160ms ease, background 160ms ease;
    }

    .chip ion-icon {
      color: #8a5a16;
      font-size: 0.9rem;
    }

    @media (hover: hover) and (pointer: fine) {
      .chip:hover {
        border-color: rgba(214, 169, 74, 0.4);
        background: rgba(246, 228, 193, 0.2);
      }
    }

    /* ── Sections ── */
    .explore-section {
      display: grid;
      gap: 12px;
    }

    .explore-section-head {
      display: flex;
      justify-content: space-between;
      align-items: center;
    }

    .explore-section-head h2 {
      margin: 0;
      color: var(--text);
      font-size: 1.05rem;
      font-weight: 950;
      letter-spacing: -0.03em;
    }

    .explore-section-head a {
      color: #8a5a16;
      font-size: 0.78rem;
      font-weight: 900;
      text-decoration: none;
    }

    /* ── Categories ── */
    .explore-categories {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(100px, 1fr));
      gap: 10px;
    }

    .category-card {
      display: grid;
      gap: 6px;
      padding: 14px 10px;
      border: 1px solid var(--border);
      border-radius: 14px;
      background: rgba(255, 255, 255, 0.7);
      text-align: center;
      text-decoration: none;
      color: inherit;
      transition: border-color 160ms ease;
    }

    .category-card ion-icon {
      color: #8a5a16;
      font-size: 1.3rem;
      margin: 0 auto;
    }

    .category-card span {
      color: var(--text);
      font-size: 0.74rem;
      font-weight: 900;
    }

    @media (hover: hover) and (pointer: fine) {
      .category-card:hover {
        border-color: rgba(214, 169, 74, 0.4);
      }
    }

    /* ── Business Grid ── */
    .explore-business-grid {
      display: grid;
      gap: 12px;
    }

    @media (min-width: 600px) {
      .explore-business-grid {
        grid-template-columns: repeat(2, 1fr);
      }
    }

    @media (min-width: 1024px) {
      .explore-business-grid {
        grid-template-columns: repeat(3, 1fr);
      }
    }

    /* ── Empty ── */
    .explore-empty {
      grid-column: 1 / -1;
      display: grid;
      gap: 12px;
      justify-items: center;
      padding: 32px 16px;
      text-align: center;
    }

    .explore-empty p {
      margin: 0;
      color: var(--muted);
      font-size: 0.9rem;
    }

    /* ── Loading ── */
    .explore-loading {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 12px;
    }

    .skeleton-card {
      height: 180px;
      border-radius: 16px;
      background: linear-gradient(90deg, rgba(214, 169, 74, 0.06), rgba(214, 169, 74, 0.14), rgba(214, 169, 74, 0.06));
      background-size: 200% 100%;
      animation: shimmer 1.5s infinite;
    }

    @keyframes shimmer {
      0% { background-position: 200% 0; }
      100% { background-position: -200% 0; }
    }

    @media (min-width: 768px) {
      .explore-page {
        padding: 24px;
        max-width: 720px;
        margin: 0 auto;
      }
    }
  `]
})
export class ExplorePage implements OnInit {
  readonly areaLabel = signal(localStorage.getItem("aura_customer_area_label") || "Current area");
  readonly currentLocation = signal<{ lat: number; lng: number } | null>(null);
  readonly skeletons = [1, 2, 3];

  readonly greeting = computed(() => {
    const name = this.marketplace.customer()?.name?.trim().split(/\s+/)[0];
    return name ? `Hey ${name}, where to today?` : "Discover salons near you";
  });

  readonly recommendations = computed(() => {
    const businesses = this.marketplace.businesses();
    return businesses.slice(0, 6);
  });

  readonly recentlyViewed = computed(() => {
    try {
      const raw = localStorage.getItem("aura_recently_viewed");
      const history: Array<{ id?: string; slug?: string }> = raw ? JSON.parse(raw) : [];
      const businesses = this.marketplace.businesses();
      return history
        .map((item) => businesses.find((b) => b.id === item.id || b.slug === item.slug))
        .filter((b): b is Business => !!b)
        .slice(0, 4);
    } catch {
      return [];
    }
  });

  readonly recentlyVisited = computed(() => {
    const businesses = this.marketplace.businesses();
    const bookings = this.marketplace.bookings();
    const seen = new Set<string>();
    return bookings
      .filter((b) => !!b.businessId || !!b.businessName)
      .sort((a, b) => new Date(b.startAt || b.displayStartAt || b.startsAt || "").getTime() - new Date(a.startAt || a.displayStartAt || a.startsAt || "").getTime())
      .map((booking) => {
        const business = businesses.find((b) => b.id === booking.businessId || b.businessName === booking.businessName);
        return business ? { business, booking } : null;
      })
      .filter((item): item is { business: Business; booking: typeof bookings[0] } => !!item)
      .filter((item) => {
        if (seen.has(item.business.id)) return false;
        seen.add(item.business.id);
        return true;
      })
      .slice(0, 4);
  });

  constructor(
    readonly marketplace: MarketplaceService,
    private readonly router: Router
  ) {
    addIcons({
      businessOutline,
      chevronForwardOutline,
      locationOutline,
      navigateOutline,
      pricetagOutline,
      ribbonOutline,
      searchOutline,
      timeOutline
    });

    const saved = localStorage.getItem("aura_customer_location");
    if (saved) {
      try { this.currentLocation.set(JSON.parse(saved)); } catch {}
    }
  }

  ngOnInit() {
    void Promise.all([
      this.marketplace.loadPublicBusinesses(),
      this.marketplace.loadCategories(),
      this.marketplace.isAuthenticated() ? this.marketplace.loadCustomer() : Promise.resolve(null),
      this.marketplace.isAuthenticated() ? this.marketplace.loadBookings() : Promise.resolve([]),
      this.marketplace.isAuthenticated() ? this.marketplace.loadMySalons().catch(() => null) : Promise.resolve(null)
    ]).catch(() => undefined);
  }

  openSearch() {
    void this.router.navigate(["/search"]);
  }
}
