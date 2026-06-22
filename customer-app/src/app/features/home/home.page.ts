import { Component, OnInit, computed, signal } from "@angular/core";
import { Router, RouterLink } from "@angular/router";
import { IonButton, IonContent, IonHeader, IonIcon, IonSearchbar, IonToolbar } from "@ionic/angular/standalone";
import { addIcons } from "ionicons";
import {
  calendarOutline,
  locationOutline,
  navigateOutline,
  notificationsOutline,
  personCircleOutline,
  pricetagOutline,
  ribbonOutline,
  searchOutline,
  sparklesOutline,
  timeOutline
} from "ionicons/icons";
import { BusinessCardComponent } from "../../shared/business-card.component";
import { MarketplaceService } from "../../core/marketplace.service";
import { Booking, Business } from "../../core/api.types";

interface HomeSearchSuggestion {
  key: string;
  label: string;
  type: "Salon" | "Service" | "Staff" | "Location";
  copy: string;
  query: string;
}

@Component({
  standalone: true,
  imports: [RouterLink, IonButton, IonContent, IonHeader, IonIcon, IonSearchbar, IonToolbar, BusinessCardComponent],
  template: `
    <ion-header class="ion-no-border">
      <ion-toolbar>
        <div class="home-toolbar app-container">
          <div class="location-copy">
            <span>Near you</span>
            <div class="location-row">
              <strong><ion-icon name="location-outline"></ion-icon> {{ areaLabel() }}</strong>
              <button type="button" class="near-you-button" [disabled]="locating()" (click)="useCurrentLocation()">
                <ion-icon name="navigate-outline"></ion-icon>
                {{ locating() ? "Detecting" : "Use current location" }}
              </button>
            </div>
          </div>
          <div class="toolbar-actions">
            <ion-button fill="clear" shape="round" routerLink="/notifications" aria-label="Open notifications">
              <ion-icon name="notifications-outline"></ion-icon>
            </ion-button>
            <ion-button fill="clear" shape="round" routerLink="/tabs/profile" aria-label="Open profile">
              <ion-icon name="person-circle-outline"></ion-icon>
            </ion-button>
          </div>
        </div>
      </ion-toolbar>
    </ion-header>

    <ion-content>
      <main class="page home-page">
        <section class="hero">
          <div class="hero-copy">
            <p class="eyebrow">Beauty and wellness marketplace</p>
            <h1 class="page-title">Find and book your next self-care visit</h1>
            <p class="muted">Browse friendly local salons, spas, barbers, nail studios and skin clinics with simple booking and clear prices.</p>
            <div class="search-panel">
              <div class="home-search-wrap">
                <ion-searchbar
                  placeholder="Search services or salons"
                  [value]="query()"
                  (ionInput)="setQuery($any($event.target).value || '')"
                  (ionSearch)="search()">
                </ion-searchbar>
                @if (suggestions().length) {
                  <div class="home-suggestion-panel" role="listbox" aria-label="Home search suggestions">
                    @for (suggestion of suggestions(); track suggestion.key) {
                      <button type="button" role="option" (click)="applySuggestion(suggestion)">
                        <strong>{{ suggestion.label }}</strong>
                        <span>{{ suggestion.type }} · {{ suggestion.copy }}</span>
                      </button>
                    }
                  </div>
                }
              </div>
              <ion-button class="primary-gradient" (click)="search()">
                <ion-icon name="search-outline" slot="start"></ion-icon>
                Search
              </ion-button>
            </div>
            @if (locationNotice()) {
              <p class="location-notice">{{ locationNotice() }}</p>
            }
          </div>
        </section>

        <section class="aura-dashboard" aria-label="Personalized Aura dashboard">
          <article class="welcome-card">
            <p class="eyebrow">Aura Shine customer</p>
            <h2>{{ greeting() }}</h2>
            <p>Book faster, track real appointments, and keep your AuraSalon profile in sync with the SaaS backend.</p>
            <div class="welcome-actions">
              <ion-button class="primary-gradient" routerLink="/tabs/search">
                <ion-icon name="search-outline" slot="start"></ion-icon>
                Discover salons
              </ion-button>
              <ion-button fill="outline" class="secondary-button" routerLink="/tabs/rewards">
                <ion-icon name="ribbon-outline" slot="start"></ion-icon>
                Rewards
              </ion-button>
            </div>
          </article>

          <div class="customer-metrics">
            @for (metric of customerMetrics(); track metric.label) {
              <a class="metric-card" [routerLink]="metric.route">
                <ion-icon [name]="metric.icon"></ion-icon>
                <span>{{ metric.label }}</span>
                <strong>{{ metric.value }}</strong>
                <small>{{ metric.note }}</small>
              </a>
            }
          </div>
        </section>

        @if (!searchActive() && recentlyVisited().length) {
          <div class="section-heading priority-heading">
            <div>
              <p class="eyebrow">Recently visited</p>
              <h2 class="section-title">Book again faster</h2>
            </div>
          </div>
          <div class="visited-rail">
            @for (item of recentlyVisited(); track item.business.id) {
              <button type="button" class="visited-card premium-card" (click)="openBusiness(item.business)">
                <img [src]="item.business.coverImage || item.business.galleryImages[0] || 'assets/icons/icon.svg'" [alt]="item.business.businessName + ' cover'" />
                <span>{{ item.lastVisitLabel }}</span>
                <strong>{{ item.business.businessName }}</strong>
                <small>{{ item.serviceName || item.business.popularService || item.business.category }}</small>
                <ion-icon name="time-outline"></ion-icon>
              </button>
            }
          </div>
        }

        @if (!searchActive()) {
          <div class="section-heading priority-heading">
            <div>
              <p class="eyebrow">Picked for you</p>
              <h2 class="section-title">Recommendations</h2>
            </div>
            <a routerLink="/tabs/search">Explore all</a>
          </div>
          <div class="business-grid recommended priority-grid">
            @for (business of recommendations(); track business.id) {
              <aura-business-card [business]="business" [userLocation]="currentLocation()"></aura-business-card>
            } @empty {
              <section class="state-card premium-card"><h2>No recommendations yet</h2><p class="muted">Browse or book a salon and we will personalize this space.</p></section>
            }
          </div>
        }

        @if (!searchActive() && recentlyViewed().length) {
          <div class="section-heading">
            <div>
              <p class="eyebrow">Recently viewed</p>
              <h2 class="section-title">Continue where you left off</h2>
            </div>
          </div>
          <div class="business-rail">
            @for (business of recentlyViewed(); track business.id) {
              <aura-business-card [business]="business" [userLocation]="currentLocation()"></aura-business-card>
            }
          </div>
        }

        @if (marketplace.loading()) {
          <section class="skeleton-grid" aria-label="Loading businesses">
            @for (item of skeletons; track item) {
              <div class="skeleton-card"></div>
            }
          </section>
        }
        @if (marketplace.error()) {
          <section class="state-card premium-card error"><h2>Could not load marketplace</h2><p>{{ marketplace.error() }}</p><ion-button class="primary-gradient" (click)="reload()">Retry</ion-button></section>
        }

        <div class="category-strip">
          <button class="pill" [class.active]="categoryFilter() === ''" type="button" (click)="setCategory('')">All</button>
          @for (category of marketplace.categories(); track category.id || category.slug) {
            <button class="pill" [class.active]="categoryFilter() === category.slug" type="button" (click)="setCategory(category.slug)">
              {{ category.label }}
            </button>
          }
        </div>

        @if (searchActive()) {
          <div class="section-heading">
            <div>
              <p class="eyebrow">Search results</p>
              <h2 class="section-title">{{ homeResults().length }} places for "{{ activeQuery() }}"</h2>
            </div>
            <button class="section-link clear-search" type="button" (click)="clearSearch()">Clear</button>
          </div>
          <div class="business-grid recommended">
            @for (business of homeResults(); track business.id) {
              <aura-business-card [business]="business" [userLocation]="currentLocation()"></aura-business-card>
            } @empty {
              <section class="state-card premium-card"><h2>No places found</h2><p class="muted">Try salon name, service, staff, area, or city.</p></section>
            }
          </div>
        }

        @if (!searchActive()) {
        <div class="section-heading">
          <div>
            <p class="eyebrow">More to explore</p>
            <h2 class="section-title">Recommended businesses</h2>
          </div>
          <a routerLink="/tabs/search">See all</a>
        </div>
        <div class="business-grid recommended">
          @for (business of recommendedMore(); track business.id) {
            <aura-business-card [business]="business" [userLocation]="currentLocation()"></aura-business-card>
          } @empty {
            <section class="state-card premium-card"><h2>No businesses found</h2><p class="muted">Try a different search or check the marketplace API.</p></section>
          }
        </div>
        }

        @if (!searchActive()) {
        <div class="section-heading">
          <div>
            <p class="eyebrow">Fast slots</p>
            <h2 class="section-title">Nearby businesses</h2>
          </div>
          <a routerLink="/tabs/search">View map</a>
        </div>
        <div class="nearby-grid">
          @for (business of nearby(); track business.id) {
            <aura-business-card [business]="business" [userLocation]="currentLocation()"></aura-business-card>
          } @empty {
            <section class="state-card premium-card"><h2>No nearby businesses yet</h2><p class="muted">Location-aware results will appear once the API returns businesses.</p></section>
          }
        </div>
        }

        @if (!searchActive()) {
        <div class="section-heading">
          <div>
            <p class="eyebrow">Popular now</p>
            <h2 class="section-title">Services customers love</h2>
          </div>
        </div>
        <div class="service-scroller">
          @for (item of popularServices(); track item.label) {
            <a class="service-chip premium-card" [routerLink]="['/business', item.slug]">
              <img [src]="item.image" [alt]="item.label" />
              <span>{{ item.label }}</span>
              <strong>{{ item.price }}</strong>
            </a>
          } @empty {
            <section class="state-card premium-card"><h2>No services published yet</h2><p class="muted">Popular services will appear when businesses publish services through the backend.</p></section>
          }
        </div>
        }
      </main>
    </ion-content>
  `,
  styles: [`
    .home-toolbar {
      display: grid;
      grid-template-columns: 1fr auto;
      align-items: center;
      gap: 18px;
      padding-top: 8px;
      padding-bottom: 8px;
    }

    .location-copy span {
      display: block;
      color: var(--muted);
      font-size: 0.78rem;
      font-weight: 900;
      text-transform: uppercase;
      letter-spacing: 0.08em;
    }

    .location-copy strong,
    .location-row,
    .toolbar-actions {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .location-row {
      flex-wrap: wrap;
    }

    .near-you-button {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      min-height: 32px;
      padding: 0 12px;
      border: 1px solid rgba(214, 169, 74, 0.3);
      border-radius: 999px;
      color: var(--primary);
      background: rgba(255, 249, 236, 0.92);
      font-weight: 900;
      white-space: nowrap;
    }

    .near-you-button:disabled {
      opacity: 0.7;
    }

    .hero {
      position: relative;
      display: grid;
      gap: 22px;
      align-items: stretch;
      min-height: 440px;
      padding: 28px;
      overflow: visible;
      border: 1px solid var(--border);
      border-radius: var(--radius-xl);
      background:
        radial-gradient(circle at 12% 12%, rgba(214, 169, 74, 0.22), transparent 34%),
        linear-gradient(135deg, rgba(255, 251, 241, 0.98), rgba(246, 228, 193, 0.92));
      box-shadow: 0 28px 74px rgba(92, 65, 28, 0.16), inset 0 1px 0 rgba(255, 255, 255, 0.78);
    }

    .location-notice {
      margin: -4px 0 0 10px;
      color: var(--muted);
      font-size: 0.84rem;
      font-weight: 800;
    }

    .hero-copy {
      display: grid;
      align-content: center;
      gap: 16px;
      min-width: 0;
    }

    .hero-copy .muted {
      max-width: 620px;
      margin: 0;
      color: #7E6E55;
      font-size: 1.08rem;
    }

    .search-panel {
      position: relative;
      z-index: 50;
      display: grid;
      gap: 10px;
      max-width: 760px;
      padding: 10px;
      border: 1px solid var(--border);
      border-radius: 30px;
      background: rgba(255, 255, 255, 0.86);
      box-shadow: 0 24px 54px rgba(92, 65, 28, 0.14), inset 0 1px 0 rgba(255, 255, 255, 0.8);
    }

    .home-search-wrap {
      position: relative;
      min-width: 0;
    }

    .home-suggestion-panel {
      position: absolute;
      top: calc(100% + 8px);
      right: 0;
      left: 0;
      z-index: 200;
      max-height: 260px;
      overflow-y: auto;
      display: grid;
      gap: 6px;
      padding: 8px;
      border: 1px solid rgba(214, 169, 74, 0.26);
      border-radius: 20px;
      background: rgba(255, 251, 241, 0.98);
      box-shadow: 0 24px 54px rgba(92, 65, 28, 0.18);
      backdrop-filter: blur(18px);
    }

    .home-suggestion-panel button {
      display: grid;
      gap: 3px;
      width: 100%;
      padding: 11px 12px;
      border: 0;
      border-radius: 14px;
      color: var(--text);
      background: transparent;
      text-align: left;
    }

    .home-suggestion-panel button:hover,
    .home-suggestion-panel button:focus-visible {
      background: rgba(214, 169, 74, 0.12);
    }

    .home-suggestion-panel strong {
      font-weight: 900;
    }

    .home-suggestion-panel span {
      color: var(--muted);
      font-size: 0.8rem;
      font-weight: 800;
    }

    .category-strip {
      display: flex;
      gap: 10px;
      overflow-x: auto;
      padding: 18px 2px 6px;
      scrollbar-width: none;
    }

    .priority-heading {
      margin-top: 22px;
    }

    .priority-grid {
      margin-bottom: 4px;
    }

    .aura-dashboard {
      display: grid;
      gap: 14px;
      margin-top: 18px;
    }

    .welcome-card {
      display: grid;
      gap: 12px;
      padding: 22px;
      border: 1px solid var(--border);
      border-radius: var(--radius-lg);
      background:
        radial-gradient(circle at 10% 10%, rgba(214, 169, 74, 0.18), transparent 34%),
        linear-gradient(135deg, rgba(255, 251, 241, 0.98), rgba(246, 228, 193, 0.9)),
        var(--surface);
      box-shadow: 0 24px 58px rgba(92, 65, 28, 0.14);
    }

    .welcome-card h2,
    .welcome-card p {
      margin: 0;
    }

    .welcome-card h2 {
      font-size: clamp(1.55rem, 4vw, 2.5rem);
      letter-spacing: 0;
      line-height: 1;
      color: var(--text);
    }

    .welcome-card p {
      max-width: 680px;
      color: #7E6E55;
      line-height: 1.5;
    }

    .welcome-actions {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
      margin-top: 4px;
    }

    .customer-metrics {
      display: grid;
      gap: 12px;
    }

    .metric-card {
      display: grid;
      grid-template-columns: auto minmax(0, 1fr);
      gap: 4px 12px;
      padding: 16px;
      border: 1px solid var(--border);
      border-radius: var(--radius-md);
      color: inherit;
      background: linear-gradient(145deg, rgba(255, 255, 255, 0.92), rgba(255, 249, 236, 0.94));
      box-shadow: 0 18px 42px rgba(92, 65, 28, 0.12);
      text-decoration: none;
    }

    .metric-card ion-icon {
      grid-row: span 3;
      width: 46px;
      height: 46px;
      padding: 11px;
      border-radius: 18px;
      color: #120D05;
      background: linear-gradient(135deg, #F4D58D, #D6A94A, #9B6B22);
    }

    .metric-card span,
    .metric-card small {
      color: var(--muted);
      font-weight: 800;
    }

    .metric-card strong {
      color: var(--text);
      font-size: 1.18rem;
      letter-spacing: 0;
    }

    .category-strip::-webkit-scrollbar {
      display: none;
    }

    .clear-search {
      border: 0;
      background: transparent;
      cursor: pointer;
      font: inherit;
    }

    .business-grid,
    .nearby-grid {
      display: grid;
      gap: 18px;
    }

    .business-rail,
    .visited-rail {
      display: grid;
      grid-auto-flow: column;
      grid-auto-columns: minmax(280px, 360px);
      gap: 16px;
      overflow-x: auto;
      padding: 2px 2px 12px;
      scrollbar-width: none;
    }

    .business-rail::-webkit-scrollbar,
    .visited-rail::-webkit-scrollbar {
      display: none;
    }

    .visited-card {
      position: relative;
      display: grid;
      grid-template-columns: 82px minmax(0, 1fr) auto;
      grid-template-rows: auto auto auto;
      gap: 3px 12px;
      align-items: center;
      min-height: 116px;
      padding: 12px;
      border: 1px solid var(--border);
      border-radius: var(--radius-md);
      color: inherit;
      background: linear-gradient(145deg, rgba(255, 255, 255, 0.94), rgba(255, 249, 236, 0.96));
      text-align: left;
      cursor: pointer;
      transition: transform 180ms ease, box-shadow 180ms ease, border-color 180ms ease;
    }

    .visited-card img {
      grid-row: span 3;
      width: 82px;
      height: 82px;
      border-radius: 20px;
      object-fit: cover;
    }

    .visited-card span,
    .visited-card small {
      color: var(--muted);
      font-size: 0.82rem;
      font-weight: 800;
    }

    .visited-card strong {
      min-width: 0;
      color: var(--text);
      font-size: 1.05rem;
      font-weight: 900;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .visited-card ion-icon {
      grid-row: span 3;
      width: 34px;
      height: 34px;
      padding: 9px;
      border-radius: 999px;
      color: #120D05;
      background: linear-gradient(135deg, #F4D58D, #D6A94A);
    }

    @media (hover: hover) and (pointer: fine) {
      .visited-card:hover {
        transform: translateY(-3px);
        border-color: rgba(214, 169, 74, 0.34);
        box-shadow: var(--shadow-card);
      }
    }

    .service-scroller {
      display: grid;
      grid-auto-columns: minmax(220px, 280px);
      grid-auto-flow: column;
      gap: 14px;
      overflow-x: auto;
      padding: 2px 2px 10px;
      scrollbar-width: none;
    }

    .service-scroller::-webkit-scrollbar {
      display: none;
    }

    .service-chip {
      display: grid;
      grid-template-columns: 70px minmax(0, 1fr);
      grid-template-rows: auto auto;
      gap: 4px 12px;
      padding: 12px;
      color: inherit;
      text-decoration: none;
    }

    .service-chip img {
      grid-row: span 2;
      width: 70px;
      height: 70px;
      border-radius: 18px;
      object-fit: cover;
    }

    .service-chip span {
      align-self: end;
      color: var(--text);
      font-weight: 900;
    }

    .service-chip strong {
      color: var(--primary-2);
      font-size: 0.86rem;
    }

    .state-card {
      margin-top: 18px;
      padding: 20px;
    }

    .state-card h2 {
      margin: 0 0 8px;
      letter-spacing: -0.04em;
    }

    .state-card p {
      margin: 0;
    }

    .state-card.error {
      border-color: rgba(244, 114, 182, 0.22);
    }

    .state-card.error p {
      color: #EF4444;
    }

    .skeleton-grid {
      display: grid;
      gap: 18px;
      margin-top: 18px;
    }

    .skeleton-card {
      min-height: 360px;
      border: 1px solid var(--border);
      border-radius: var(--radius-lg);
      background: linear-gradient(90deg, rgba(214, 169, 74, 0.1), rgba(244, 213, 141, 0.16), rgba(214, 169, 74, 0.1));
      animation: pulse 1.15s ease-in-out infinite;
      box-shadow: var(--shadow-soft);
    }

    @keyframes pulse {
      0%, 100% { opacity: 0.58; }
      50% { opacity: 1; }
    }

    @media (max-width: 599px) {
      .home-toolbar {
        width: 100%;
        grid-template-columns: 1fr auto;
        padding-inline: 16px;
      }

      .toolbar-actions ion-button:last-child {
        display: none;
      }

      .near-you-button {
        padding: 0 10px;
      }

      .hero {
        padding: 20px;
        border-radius: 32px;
      }

      .search-panel ion-button {
        width: 100%;
      }

      .welcome-actions ion-button {
        width: 100%;
      }
    }

    @media (min-width: 768px) {
      .aura-dashboard {
        grid-template-columns: minmax(0, 1.25fr) minmax(260px, 0.75fr);
      }

      .customer-metrics {
        grid-template-columns: 1fr;
      }

      .search-panel {
        grid-template-columns: minmax(0, 1fr) auto auto;
        align-items: center;
      }

      .business-grid,
      .nearby-grid,
      .skeleton-grid {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }
    }

    @media (min-width: 1024px) {
      ion-header {
        display: none;
      }

      .hero {
        padding: 34px;
      }

      .business-grid,
      .nearby-grid,
      .skeleton-grid {
        grid-template-columns: repeat(3, minmax(0, 1fr));
      }

    }

    @media (min-width: 1440px) {
      .business-grid.recommended {
        grid-template-columns: repeat(4, minmax(0, 1fr));
      }

      .hero {
        min-height: 500px;
      }
    }

  `]
})
export class HomePage implements OnInit {
  readonly query = signal("");
  readonly activeQuery = signal("");
  readonly categoryFilter = signal("");
  readonly areaLabel = signal(localStorage.getItem("aura_customer_area_label") || "Current area");
  readonly currentLocation = signal<{ lat: number; lng: number } | null>(this.savedLocation());
  readonly locating = signal(false);
  readonly locationNotice = signal("");
  readonly skeletons = [1, 2, 3, 4, 5, 6];
  readonly searchActive = computed(() => !!this.activeQuery().trim());
  readonly homeResults = computed(() => this.filterBusinesses(this.marketplace.businesses()));
  readonly recommendations = computed(() => this.recommendedBusinesses().slice(0, 4));
  readonly recommendedMore = computed(() => this.recommendedBusinesses().slice(4, 10));
  readonly nearby = computed(() => this.homeResults().slice(6, 12));
  readonly recentlyViewed = computed(() => this.recentlyViewedBusinesses());
  readonly recentlyVisited = computed(() => this.recentlyVisitedBusinesses());
  readonly suggestions = computed<HomeSearchSuggestion[]>(() => {
    const query = this.query().trim().toLowerCase();
    if (!query) return [];
    return this.marketplace.businesses()
      .map((business) => this.bestSuggestionFor(business, query))
      .filter((suggestion): suggestion is HomeSearchSuggestion => !!suggestion)
      .slice(0, 6);
  });
  readonly greeting = computed(() => {
    const name = this.marketplace.customer()?.name?.trim().split(/\s+/)[0];
    return name ? `Welcome back, ${name}` : "Welcome to Aura Shine";
  });
  readonly customerMetrics = computed(() => [
    {
      label: "Loyalty",
      value: `${this.marketplace.customer()?.loyaltyPoints ?? 0} pts`,
      note: "From customer profile API",
      icon: "ribbon-outline",
      route: "/tabs/rewards"
    },
    {
      label: "Bookings",
      value: `${this.marketplace.customer()?.bookingCount ?? this.marketplace.bookings().length} visits`,
      note: "From customer bookings API",
      icon: "calendar-outline",
      route: "/tabs/bookings"
    },
    {
      label: "Offers",
      value: `${this.marketplace.businesses().filter((business) => business.hasOffer).length} live`,
      note: "Marketplace offers",
      icon: "pricetag-outline",
      route: "/tabs/offers"
    }
  ]);
  readonly popularServices = computed(() => this.marketplace.businesses()
    .filter((business) => !!business.popularService)
    .slice(0, 8)
    .map((business) => ({
    label: business.popularService,
    price: this.money(business.startingPricePaise),
    image: business.galleryImages[0] || business.coverImage || "assets/icons/icon.svg",
    slug: business.slug
  })));

  constructor(readonly marketplace: MarketplaceService, private readonly router: Router) {
    addIcons({
      calendarOutline,
      locationOutline,
      navigateOutline,
      notificationsOutline,
      personCircleOutline,
      pricetagOutline,
      ribbonOutline,
      searchOutline,
      sparklesOutline,
      timeOutline
    });
  }

  ngOnInit() {
    void Promise.all([
      this.marketplace.loadPublicBusinesses(),
      this.marketplace.loadCategories(),
      this.marketplace.isAuthenticated() ? this.marketplace.loadCustomer() : Promise.resolve(null),
      this.marketplace.isAuthenticated() ? this.marketplace.loadBookings() : Promise.resolve([])
    ]).catch(() => undefined);
  }

  money(pricePaise: number): string {
    return this.marketplace.formatMoney(pricePaise);
  }

  reload() {
    void this.marketplace.searchBusinesses({
      q: this.query().trim() || undefined,
      category: this.categoryFilter() || undefined
    });
  }

  setCategory(category: string) {
    this.categoryFilter.set(category);
    this.reload();
  }

  setQuery(value: string) {
    this.query.set(value);
    if (!value.trim()) this.activeQuery.set("");
  }

  applySuggestion(suggestion: HomeSearchSuggestion) {
    this.query.set(suggestion.query);
    void this.openDiscover(suggestion.query, this.modeForSuggestion(suggestion));
  }

  search() {
    const intent = this.searchIntent(this.query().trim());
    void this.openDiscover(intent.query, intent.mode, intent.nearMe);
  }

  clearSearch() {
    this.query.set("");
    this.activeQuery.set("");
    this.reload();
  }

  openBusiness(business: Business) {
    void this.router.navigate(["/business", business.slug]);
  }

  useCurrentLocation() {
    if (!navigator.geolocation) {
      this.locationNotice.set("Location is not supported in this browser.");
      return;
    }
    this.locating.set(true);
    this.locationNotice.set("Allow location access to detect your area.");
    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const coordinates = { lat: position.coords.latitude, lng: position.coords.longitude };
        const label = await this.resolveAreaLabel(coordinates);
        this.currentLocation.set(coordinates);
        this.areaLabel.set(label);
        localStorage.setItem("aura_customer_area_label", label);
        localStorage.setItem("aura_customer_location", JSON.stringify(coordinates));
        this.locating.set(false);
        this.locationNotice.set(`Showing places near ${label}.`);
      },
      (error) => {
        this.locating.set(false);
        this.locationNotice.set(error.code === 1
          ? "Location permission is blocked. Please enable location access in your browser."
          : "Could not detect your area. Please try again.");
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 }
    );
  }

  private filterBusinesses(businesses: Business[]): Business[] {
    const query = this.query().trim().toLowerCase();
    const category = this.categoryFilter();
    return businesses.filter((business) => {
      const serviceText = business.services.map((service) => [service.name, service.description, service.category].join(" ")).join(" ");
      const staffText = business.staff.map((staff) => [staff.name, staff.title, staff.specialty].join(" ")).join(" ");
      const haystack = [
        business.businessName,
        business.category,
        business.popularService,
        business.area,
        business.city,
        business.address,
        serviceText,
        staffText,
        ...business.categories
      ].join(" ").toLowerCase();
      if (query && !haystack.includes(query)) return false;
      if (category && !business.categories.includes(category)) return false;
      return true;
    });
  }

  private recommendedBusinesses(): Business[] {
    const businesses = this.homeResults();
    const viewed = new Set(this.recentlyViewed().map((business) => business.id));
    const visited = new Set(this.recentlyVisited().map((item) => item.business.id));
    const preferredCategories = new Set([
      ...this.recentlyViewed().flatMap((business) => business.categories),
      ...this.recentlyVisited().flatMap((item) => item.business.categories)
    ]);
    return [...businesses].sort((left, right) => {
      const leftScore = this.recommendationScore(left, viewed, visited, preferredCategories);
      const rightScore = this.recommendationScore(right, viewed, visited, preferredCategories);
      return rightScore - leftScore;
    });
  }

  private recommendationScore(
    business: Business,
    viewed: Set<string>,
    visited: Set<string>,
    preferredCategories: Set<string>
  ): number {
    const categoryMatch = business.categories.some((category) => preferredCategories.has(category)) ? 10 : 0;
    return (visited.has(business.id) ? 40 : 0)
      + (viewed.has(business.id) ? 22 : 0)
      + categoryMatch
      + Number(business.ratingAverage || 0)
      + Math.max(0, 5 - Number(business.distanceKm || 5));
  }

  private recentlyViewedBusinesses(): Business[] {
    const history = this.readRecentlyViewed();
    const businesses = this.marketplace.businesses();
    return history
      .map((item) => businesses.find((business) => business.id === item.id || business.slug === item.slug))
      .filter((business): business is Business => !!business)
      .slice(0, 6);
  }

  private recentlyVisitedBusinesses(): Array<{ business: Business; serviceName: string; lastVisitLabel: string }> {
    const businesses = this.marketplace.businesses();
    const seen = new Set<string>();
    return [...this.marketplace.bookings()]
      .filter((booking) => !!booking.businessId || !!booking.businessName)
      .sort((left, right) => this.bookingTime(right) - this.bookingTime(left))
      .map((booking) => {
        const business = businesses.find((item) => item.id === booking.businessId || item.businessName === booking.businessName);
        return business ? { business, booking } : null;
      })
      .filter((item): item is { business: Business; booking: Booking } => !!item)
      .filter((item) => {
        if (seen.has(item.business.id)) return false;
        seen.add(item.business.id);
        return true;
      })
      .slice(0, 6)
      .map((item) => ({
        business: item.business,
        serviceName: item.booking.serviceName || "",
        lastVisitLabel: this.visitLabel(item.booking)
      }));
  }

  private readRecentlyViewed(): Array<{ id?: string; slug?: string }> {
    try {
      const value = JSON.parse(localStorage.getItem("aura_customer_recently_viewed_businesses") || "[]") as Array<{ id?: string; slug?: string }>;
      return Array.isArray(value) ? value.slice(0, 12) : [];
    } catch {
      return [];
    }
  }

  private bookingTime(booking: { startAt?: string; startsAt?: string }): number {
    const value = booking.startAt || booking.startsAt || "";
    const time = value ? new Date(value).getTime() : 0;
    return Number.isFinite(time) ? time : 0;
  }

  private visitLabel(booking: { startAt?: string; startsAt?: string; displayStartAt?: string }): string {
    if (booking.displayStartAt) return booking.displayStartAt;
    const time = this.bookingTime(booking);
    if (!time) return "Recent visit";
    return new Intl.DateTimeFormat("en-IN", {
      day: "2-digit",
      month: "short",
      hour: "numeric",
      minute: "2-digit",
      hour12: true
    }).format(new Date(time));
  }

  private bestSuggestionFor(business: Business, query: string): HomeSearchSuggestion | null {
    const contains = (value: string | undefined) => String(value || "").toLowerCase().includes(query);
    const service = business.services.find((item) => contains(item.name) || contains(item.category));
    if (service) {
      return { key: `service-${business.id}-${service.id}`, label: service.name, type: "Service", copy: business.businessName, query: service.name };
    }
    if (contains(business.businessName) || contains(business.category) || contains(business.popularService)) {
      return { key: `business-${business.id}`, label: business.businessName, type: "Salon", copy: business.area || business.city || business.category, query: business.businessName };
    }
    if (contains(business.area) || contains(business.city) || contains(business.address)) {
      return { key: `location-${business.id}`, label: [business.area, business.city].filter(Boolean).join(", ") || business.address, type: "Location", copy: business.businessName, query: business.area || business.city || business.address };
    }
    const staff = business.staff.find((person) => contains(person.name) || contains(person.specialty) || contains(person.title));
    if (staff) {
      return { key: `staff-${business.id}-${staff.id}`, label: staff.name, type: "Staff", copy: business.businessName, query: staff.name };
    }
    return null;
  }

  private modeForSuggestion(suggestion: HomeSearchSuggestion): "salons" | "services" | "staff" | "locations" {
    if (suggestion.type === "Service") return "services";
    if (suggestion.type === "Staff") return "staff";
    if (suggestion.type === "Location") return "locations";
    return "salons";
  }

  private searchIntent(value: string): { query: string; mode: "salons" | "services" | "staff" | "locations"; nearMe: boolean } {
    const lower = value.toLowerCase();
    const nearMe = /\b(near me|nearby|around me|current location)\b/.test(lower);
    const locationMode = /\b(location|area|city|near this location)\b/.test(lower);
    const staffMode = /\b(staff|artist|professional|barber|stylist)\b/.test(lower);
    const serviceMode = /\b(service|hair|nail|facial|makeup|spa|massage|wax|skin|manicure|pedicure)\b/.test(lower);
    const salonMode = /\b(salon|salons|spa|clinic|barber)\b/.test(lower);
    const cleaned = value
      .replace(/\b(near me|nearby|around me|current location|near this location)\b/gi, "")
      .replace(/\s+/g, " ")
      .trim();
    return {
      query: cleaned || (salonMode ? "salon" : value),
      mode: locationMode ? "locations" : staffMode ? "staff" : serviceMode ? "services" : "salons",
      nearMe
    };
  }

  private openDiscover(query: string, mode: "salons" | "services" | "staff" | "locations", nearMe = false) {
    return this.router.navigate(["/tabs/search"], {
      queryParams: {
        q: query || undefined,
        mode,
        filter: nearMe ? "nearest" : undefined,
        sort: nearMe ? "distance" : undefined,
        nearMe: nearMe ? true : undefined
      }
    });
  }

  private async resolveAreaLabel(coordinates: { lat: number; lng: number }): Promise<string> {
    const nearest = this.nearestBusiness(coordinates);
    if (nearest) return nearest.area || nearest.city || nearest.businessName;
    try {
      const response = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${coordinates.lat}&lon=${coordinates.lng}`);
      if (!response.ok) throw new Error("reverse geocode failed");
      const data = await response.json() as { address?: Record<string, string>; display_name?: string };
      const address = data.address || {};
      return address["suburb"] || address["neighbourhood"] || address["city_district"] || address["city"] || address["town"] || address["state"] || data.display_name || "Detected area";
    } catch {
      return "Detected area";
    }
  }

  private savedLocation(): { lat: number; lng: number } | null {
    try {
      const parsed = JSON.parse(localStorage.getItem("aura_customer_location") || "null") as { lat?: number; lng?: number } | null;
      const lat = Number(parsed?.lat);
      const lng = Number(parsed?.lng);
      return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
    } catch {
      return null;
    }
  }

  private nearestBusiness(coordinates: { lat: number; lng: number }): Business | null {
    return this.marketplace.businesses()
      .map((business) => {
        const lat = Number(business.latitude);
        const lng = Number(business.longitude);
        return {
          business,
          distance: Number.isFinite(lat) && Number.isFinite(lng)
            ? this.distanceKm(coordinates, { lat, lng })
            : Number.MAX_SAFE_INTEGER
        };
      })
      .filter((item) => item.distance !== Number.MAX_SAFE_INTEGER)
      .sort((left, right) => left.distance - right.distance)[0]?.business ?? null;
  }

  private distanceKm(from: { lat: number; lng: number }, to: { lat: number; lng: number }): number {
    const toRadians = (value: number) => value * Math.PI / 180;
    const dLat = toRadians(to.lat - from.lat);
    const dLng = toRadians(to.lng - from.lng);
    const lat1 = toRadians(from.lat);
    const lat2 = toRadians(to.lat);
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
    return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }
}
