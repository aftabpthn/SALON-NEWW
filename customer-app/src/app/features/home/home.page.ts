import { Component, HostListener, OnInit, computed, signal } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { Router, RouterLink } from "@angular/router";
import { IonButton, IonContent, IonHeader, IonIcon, IonSearchbar, IonToolbar } from "@ionic/angular/standalone";
import { firstValueFrom } from "rxjs";
import { addIcons } from "ionicons";
import {
  calendarOutline,
  cameraOutline,
  chatbubblesOutline,
  chevronForwardOutline,
  locationOutline,
  mapOutline,
  navigateOutline,
  notificationsOutline,
  optionsOutline,
  personCircleOutline,
  pricetagOutline,
  ribbonOutline,
  searchOutline,
  sparklesOutline,
  swapVerticalOutline,
  timeOutline,
  walletOutline
} from "ionicons/icons";
import { BusinessCardComponent } from "../../shared/business-card.component";
import { MySalonCardComponent } from "../../shared/my-salon-card.component";
import { CustomerApiService } from "../../core/customer-api.service";
import { MarketplaceService } from "../../core/marketplace.service";
import { Booking, Business, CustomerSalonRelationship, LiveConsultationBusinessContext, LiveConsultationPhoto, LiveConsultationResponse } from "../../core/api.types";

interface HomeSearchSuggestion {
  key: string;
  label: string;
  type: "Salon" | "Service" | "Staff" | "Location";
  copy: string;
  query: string;
}

interface HomeRecentSearch {
  query: string;
  mode: "salons" | "services" | "staff" | "locations";
}

interface HomeVisitedBusiness {
  business: Business;
  serviceName: string;
  serviceId?: string;
  lastVisitLabel: string;
}

interface ConsultationChatMessage {
  role: "customer" | "assistant";
  text: string;
}

@Component({
  standalone: true,
  imports: [FormsModule, RouterLink, IonButton, IonContent, IonHeader, IonIcon, IonSearchbar, IonToolbar, BusinessCardComponent, MySalonCardComponent],
  template: `
    <ion-content>
      <ion-header class="ion-no-border">
        <ion-toolbar>
          <div class="home-toolbar app-container">
            <span class="aura-shine-brand" aria-label="Aura Shine"><img src="assets/branding/aurashine-logo.png" alt="Aura Shine" /></span>
            <div class="location-copy">
              <span>Near you</span>
              <div class="location-row">
                <strong><ion-icon name="location-outline"></ion-icon> {{ areaLabel() }}</strong>
                @if (!mobileHome()) {
                <button type="button" class="near-you-button" [disabled]="locating()" (click)="useCurrentLocation()">
                  <ion-icon name="navigate-outline"></ion-icon>
                  {{ locating() ? "Detecting" : "Use current location" }}
                </button>
                }
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

      <main class="page home-page">
        <section class="hero dashboard-hero">
          <div class="hero-copy">
            <span class="eyebrow">Your day, beautifully planned</span>
            <h1 class="page-title">{{ greeting() }}</h1>
            <div class="search-panel">
              <div class="home-search-wrap">
                <ion-searchbar
                  placeholder="Search services or salons"
                  [value]="query()"
                  (ionFocus)="openExploreFromSearch()"
                  (click)="openExploreFromSearch()"
                  (ionInput)="setQuery($any($event.target).value || '')"
                  (ionSearch)="search()">
                </ion-searchbar>
                @if (suggestions().length) {
                  <div class="home-suggestion-panel" aria-label="Home search suggestions">
                    @for (suggestion of suggestions(); track suggestion.key) {
                      <button type="button" (click)="applySuggestion(suggestion)">
                        <strong>{{ suggestion.label }}</strong>
                        <span>{{ suggestion.type }} · {{ suggestion.copy }}</span>
                      </button>
                    }
                  </div>
                }
              </div>
              <ion-button class="primary-gradient" aria-label="Open full search" (click)="search()">
                <ion-icon name="search-outline" slot="start"></ion-icon>
                Search
              </ion-button>
            </div>
            @if (recentSearches().length) {
              <nav class="recent-searches" aria-label="Recently searched">
                <span>Recent</span>
                @for (item of recentSearches(); track item.query + item.mode) {
                  <button type="button" (click)="repeatSearch(item)">{{ item.query }}</button>
                }
              </nav>
            }
            @if (!mobileHome() && locationNotice()) {
              <p class="location-notice">{{ locationNotice() }}</p>
            }
          </div>
          @if (nextAppointment(); as booking) {
            <article class="next-appointment" aria-labelledby="next-appointment-title">
              <div class="appointment-date" aria-hidden="true">
                <span>{{ appointmentMonth(booking) }}</span>
                <strong>{{ appointmentDay(booking) }}</strong>
              </div>
              <div class="appointment-copy">
                <span class="eyebrow">Up next</span>
                <h2 id="next-appointment-title">{{ booking.serviceName }}</h2>
                <p>{{ booking.businessName }} · {{ appointmentTime(booking) }}</p>
              </div>
              <a [routerLink]="['/bookings', booking.id]" aria-label="View upcoming appointment">
                View
                <ion-icon name="chevron-forward-outline"></ion-icon>
              </a>
            </article>
          } @else {
            <article class="next-appointment empty-appointment">
              <div class="appointment-date"><ion-icon name="calendar-outline"></ion-icon></div>
              <div class="appointment-copy"><span class="eyebrow">Your next visit</span><h2>Make time for yourself</h2><p>Find a service that fits your day.</p></div>
              <a routerLink="/tabs/search">Explore <ion-icon name="chevron-forward-outline"></ion-icon></a>
            </article>
          }
        </section>

        @if (marketplace.isAuthenticated()) {
          <section class="aura-dashboard" aria-label="Personalized Aura dashboard">
            <aura-my-salon-card
              [primarySalon]="marketplace.primarySalon()"
              [suggestedSalon]="primarySalonSuggestion()"
              (openSalonPicker)="openSalonPicker()"
              (dismissPrompt)="dismissPrimaryPrompt()"
              (setPrimary)="onSetPrimarySalon($event)">
            </aura-my-salon-card>
          </section>
        }

        <!-- Book Again faster (shown when authenticated with visit history) -->
        @if (!searchActive() && recentlyVisited().length) {
          <section class="mobile-secondary-section">
          <div class="section-heading priority-heading">
            <div>
               <span class="section-kicker">From your visits</span>
               <h2 class="section-title">Book again</h2>
            </div>
          </div>
          <div class="visited-rail">
            @for (item of recentlyVisited(); track item.business.id) {
               <button type="button" class="visited-card premium-card" (click)="bookAgain(item)">
                @if (businessImage(item.business)) {
                  <img [src]="businessImage(item.business)" [alt]="item.business.businessName + ' cover'" />
                } @else {
                  <b class="visited-fallback" aria-hidden="true">{{ businessInitials(item.business) }}</b>
                }
                <span>{{ item.lastVisitLabel }}</span>
                <strong>{{ item.business.businessName }}</strong>
                <small>{{ item.serviceName || item.business.popularService || item.business.category }}</small>
                 <ion-icon name="chevron-forward-outline"></ion-icon>
              </button>
            }
          </div>
          </section>
        }

        @if (!searchActive() && recentlyViewed().length) {
          <section class="mobile-secondary-section">
            <div class="section-heading">
              <div><span class="section-kicker">Recently viewed</span><h2 class="section-title">Continue where you left off</h2></div>
            </div>
            <div class="business-rail continue-rail">
              @for (business of recentlyViewed(); track business.id) {
                <aura-business-card variant="personal" [business]="business" [userLocation]="currentLocation()"></aura-business-card>
              }
            </div>
          </section>
        }

        @if (!searchActive() && marketplace.isAuthenticated()) {
          <section class="mobile-secondary-section">
            <div class="section-heading"><div><span class="section-kicker">Saved by you</span><h2 class="section-title">Favourites</h2></div><a routerLink="/tabs/wishlist">View all</a></div>
            @if (favoriteBusinesses().length) {
              <div class="business-rail favourites-rail">
                @for (business of favoriteBusinesses(); track business.id) {
                  <a class="favourite-mini-card" [routerLink]="['/business', business.slug]">
                    @if (businessImage(business)) {
                      <img [src]="businessImage(business)" [alt]="business.businessName + ' cover'" loading="lazy" />
                    } @else {
                      <b aria-hidden="true">{{ businessInitials(business) }}</b>
                    }
                    <span>
                      <strong>{{ business.businessName }}</strong>
                      <small>{{ business.category || business.popularService || 'Salon' }}</small>
                    </span>
                  </a>
                }
              </div>
            } @else {
              <a class="favourites-empty" routerLink="/tabs/wishlist"><span>Keep your shortlist close</span><strong>Browse saved salons <ion-icon name="chevron-forward-outline"></ion-icon></strong></a>
            }
          </section>
        }

        @if (!searchActive() && relevantOffers().length) {
          <section class="mobile-secondary-section">
            <div class="section-heading"><div><span class="section-kicker">Available now</span><h2 class="section-title">Offers from relevant salons</h2></div><a routerLink="/tabs/offers">All offers</a></div>
            <div class="business-rail">
              @for (business of relevantOffers(); track business.id) {
                <aura-business-card variant="personal" [business]="business" [userLocation]="currentLocation()"></aura-business-card>
              }
            </div>
          </section>
        }

        @if (!searchActive()) {
          <nav class="account-shortcuts" aria-label="Balance and benefits">
            <a routerLink="/tabs/wallet"><ion-icon name="wallet-outline"></ion-icon><span>Wallet</span></a>
            <a routerLink="/tabs/memberships"><ion-icon name="ribbon-outline"></ion-icon><span>Membership</span></a>
            <a routerLink="/tabs/rewards"><ion-icon name="pricetag-outline"></ion-icon><span>Rewards</span><strong>{{ marketplace.customer()?.loyaltyPoints ?? 0 }} pts</strong></a>
          </nav>
        }

        @if (!searchActive()) {
          <div class="section-heading priority-heading">
            <div>
              <span class="section-kicker">{{ recommendationKicker() }}</span>
              <h2 class="section-title">Picked for you</h2>
            </div>
            <a routerLink="/tabs/search">Explore</a>
          </div>
          <div class="business-grid recommended priority-grid">
            @for (business of recommendations(); track business.id) {
              <aura-business-card variant="personal" [business]="business" [userLocation]="currentLocation()"></aura-business-card>
            } @empty {
              <section class="state-card premium-card"><h2>No recommendations yet</h2></section>
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

        @if (searchActive()) {
          <div class="section-heading">
            <div>
              <h2 class="section-title">{{ homeResults().length }} places for "{{ activeQuery() }}"</h2>
            </div>
            <button class="section-link clear-search" type="button" (click)="clearSearch()">Clear</button>
          </div>
          <div class="business-grid recommended">
            @for (business of homeResults(); track business.id) {
              <aura-business-card variant="personal" [business]="business" [userLocation]="currentLocation()"></aura-business-card>
            } @empty {
              <section class="state-card premium-card"><h2>No places found</h2></section>
            }
          </div>
        }

        @if (!searchActive()) {
        <section class="mobile-secondary-section">
        <div class="section-heading">
          <div>
            <span class="section-kicker">{{ nearbyContextLabel() }}</span>
            <h2 class="section-title">Nearby for you</h2>
          </div>
          <a routerLink="/search" [queryParams]="{ filter: 'nearest', sort: 'distance', nearMe: true, map: true }">View map</a>
        </div>
        <div class="nearby-grid">
          @for (business of nearby(); track business.id) {
            <aura-business-card variant="personal" [business]="business" [userLocation]="currentLocation()"></aura-business-card>
          } @empty {
            <section class="state-card premium-card"><h2>No nearby businesses yet</h2></section>
          }
        </div>
        </section>
        }

        @if (!searchActive()) {
          <section class="lower-actions">
            <div class="section-heading"><div><span class="section-kicker">More to do</span><h2 class="section-title">Quick actions</h2></div></div>
            <nav class="customer-quick-actions" aria-label="Quick actions">
              <a routerLink="/tabs/bookings"><ion-icon name="calendar-outline"></ion-icon><span>Bookings</span><small>Manage visits</small></a>
              <a routerLink="/tabs/offers"><ion-icon name="pricetag-outline"></ion-icon><span>Offers</span><small>Browse live deals</small></a>
            </nav>
          </section>
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

    .aura-shine-brand {
      display: none;
      width: 54px;
      height: 38px;
      align-items: center;
      justify-content: center;
      overflow: hidden;
      flex: 0 0 auto;
    }

    .aura-shine-brand img {
      display: block;
      width: 100%;
      height: 100%;
      max-width: 100%;
      max-height: 100%;
      object-fit: contain;
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
      border: 1px solid rgba(11, 70, 120, 0.3);
      border-radius: 999px;
      color: var(--primary);
      background: rgba(255, 255, 255, 0.94);
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
        radial-gradient(circle at 12% 12%, rgba(11, 70, 120, 0.16), transparent 34%),
        linear-gradient(135deg, rgba(255, 255, 255, 0.98), rgba(231, 240, 248, 0.92));
      box-shadow: 0 28px 74px rgba(6, 23, 43, 0.14), inset 0 1px 0 rgba(255, 255, 255, 0.78);
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
      color: var(--muted);
      font-size: 1.08rem;
    }

    .live-consultation-card {
      align-self: stretch;
      display: grid;
      gap: 12px;
      min-width: 0;
      padding: 18px;
      border: 1px solid rgba(11, 70, 120, 0.28);
      border-radius: 28px;
      background: linear-gradient(145deg, rgba(255, 255, 255, 0.98), rgba(246, 249, 252, 0.94));
      box-shadow: 0 28px 60px rgba(6, 23, 43, 0.14), inset 0 1px 0 rgba(255, 255, 255, 0.8);
    }

    .consultation-topline,
    .consultation-actions,
    .consultation-photo-row {
      display: flex;
      align-items: center;
      gap: 10px;
      flex-wrap: wrap;
    }

    .consultation-topline {
      justify-content: space-between;
    }

    .consultation-topline span,
    .consultation-topline small {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      border-radius: 999px;
      font-size: 0.75rem;
      font-weight: 900;
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }

    .consultation-topline span {
      color: var(--text);
    }

    .consultation-topline small {
      padding: 6px 9px;
      color: #0F766E;
      background: rgba(15, 118, 110, 0.1);
    }

    .live-consultation-card h2,
    .consultation-copy,
    .consultation-input-label {
      margin: 0;
    }

    .live-consultation-card h2 {
      color: var(--text);
      font-size: clamp(1.28rem, 2.3vw, 2rem);
      line-height: 1.02;
      letter-spacing: 0;
    }

    .consultation-copy {
      color: var(--muted);
      line-height: 1.45;
      font-size: 0.95rem;
    }

    .consultation-goals {
      display: flex;
      gap: 8px;
      overflow-x: auto;
      padding-bottom: 2px;
      scrollbar-width: none;
    }

    .consultation-goals::-webkit-scrollbar {
      display: none;
    }

    .consultation-goals button,
    .consultation-secondary,
    .consultation-upload {
      min-height: 38px;
      border: 1px solid rgba(11, 70, 120, 0.34);
      border-radius: 999px;
      color: var(--text);
      background: rgba(255, 255, 255, 0.72);
      font-weight: 900;
      white-space: nowrap;
    }

    .consultation-goals button {
      padding: 0 12px;
    }

    .consultation-goals button.active {
      color: #FFFFFF;
      background: linear-gradient(135deg, var(--brand-600), var(--primary));
      border-color: rgba(11, 70, 120, 0.4);
    }

    .consultation-chat {
      display: grid;
      gap: 8px;
      max-height: 190px;
      overflow-y: auto;
      padding: 2px;
    }

    .consultation-message {
      display: grid;
      gap: 4px;
      width: min(100%, 92%);
      padding: 10px 12px;
      border-radius: 16px 16px 16px 6px;
      color: var(--text);
      background: rgba(255, 255, 255, 0.78);
      border: 1px solid rgba(11, 70, 120, 0.22);
    }

    .consultation-message.customer {
      justify-self: end;
      border-radius: 16px 16px 6px 16px;
      color: #fff;
      background: #0F766E;
      border-color: #0F766E;
    }

    .consultation-message strong {
      font-size: 0.74rem;
      text-transform: uppercase;
      letter-spacing: 0.06em;
    }

    .consultation-message span {
      font-size: 0.92rem;
      line-height: 1.42;
    }

    .consultation-input-label {
      display: grid;
      gap: 7px;
      color: var(--text);
      font-size: 0.86rem;
      font-weight: 900;
    }

    .consultation-input-label textarea {
      width: 100%;
      min-height: 104px;
      border: 1px solid rgba(11, 70, 120, 0.28);
      border-radius: 18px;
      padding: 13px 14px;
      color: var(--text);
      background: rgba(255, 255, 255, 0.84);
      font: inherit;
      line-height: 1.45;
      resize: vertical;
      outline: 0;
    }

    .consultation-input-label textarea:focus {
      border-color: rgba(11, 70, 120, 0.46);
      box-shadow: 0 0 0 4px rgba(37, 99, 235, 0.18);
    }

    .consultation-upload,
    .consultation-secondary,
    .consultation-send {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      padding: 0 14px;
      cursor: pointer;
    }

    .consultation-photo-row span {
      color: var(--muted);
      font-size: 0.82rem;
      font-weight: 900;
    }

    .consultation-photo-strip {
      display: grid;
      grid-auto-flow: column;
      grid-auto-columns: 74px;
      gap: 8px;
      overflow-x: auto;
      padding-bottom: 2px;
      scrollbar-width: none;
    }

    .consultation-photo-strip button {
      position: relative;
      width: 74px;
      height: 74px;
      overflow: hidden;
      border: 1px solid rgba(11, 70, 120, 0.26);
      border-radius: 18px;
      padding: 0;
      background: #fff;
      cursor: pointer;
    }

    .consultation-photo-strip img {
      width: 100%;
      height: 100%;
      object-fit: cover;
    }

    .consultation-photo-strip span {
      position: absolute;
      right: 4px;
      bottom: 4px;
      left: 4px;
      border-radius: 999px;
      padding: 3px;
      color: #fff;
      background: rgba(6, 23, 43, 0.78);
      font-size: 0.62rem;
      font-weight: 900;
      text-align: center;
    }

    .consultation-error {
      margin: 0;
      border: 1px solid rgba(239, 68, 68, 0.22);
      border-radius: 14px;
      padding: 9px 11px;
      color: #B42318;
      background: rgba(255, 241, 240, 0.9);
      font-size: 0.84rem;
      font-weight: 800;
    }

    .consultation-actions {
      justify-content: space-between;
    }

    .consultation-send {
      min-height: 44px;
      border: 0;
      border-radius: 999px;
      color: #FFFFFF;
      background: linear-gradient(135deg, var(--brand-600), var(--primary), var(--brand-800));
      font-weight: 1000;
      box-shadow: 0 14px 30px rgba(11, 70, 120, 0.22);
    }

    .consultation-send:disabled {
      opacity: 0.68;
      cursor: wait;
    }

    .consultation-results {
      display: grid;
      gap: 12px;
      border-top: 1px solid rgba(11, 70, 120, 0.22);
      padding-top: 12px;
    }

    .consultation-results > div {
      display: grid;
      gap: 8px;
    }

    .consultation-results strong {
      color: var(--text);
      font-size: 0.84rem;
      font-weight: 1000;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }

    .consultation-results ol {
      display: grid;
      gap: 6px;
      margin: 0;
      padding-left: 18px;
      color: var(--muted);
      font-size: 0.9rem;
      line-height: 1.4;
    }

    .consultation-result-card,
    .consultation-service-card {
      position: relative;
      display: grid;
      gap: 3px;
      width: 100%;
      border: 1px solid rgba(11, 70, 120, 0.24);
      border-radius: 16px;
      padding: 10px 42px 10px 12px;
      color: var(--text);
      background: rgba(255, 255, 255, 0.76);
      text-align: left;
      cursor: pointer;
    }

    .consultation-result-card span,
    .consultation-service-card span {
      min-width: 0;
      font-weight: 1000;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .consultation-result-card small,
    .consultation-service-card small {
      color: var(--muted);
      font-weight: 800;
      line-height: 1.35;
    }

    .consultation-result-card ion-icon {
      position: absolute;
      top: 50%;
      right: 12px;
      transform: translateY(-50%);
    }

    .consultation-safety {
      margin: 0;
      color: var(--muted);
      font-size: 0.78rem;
      font-weight: 800;
      line-height: 1.38;
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
      box-shadow: 0 24px 54px rgba(6, 23, 43, 0.12), inset 0 1px 0 rgba(255, 255, 255, 0.8);
    }

    .home-search-wrap {
      position: relative;
      min-width: 0;
    }


    .home-control-row {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      align-items: center;
    }

    .home-control-button {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 7px;
      min-height: 44px;
      padding: 0 13px;
      border: 1px solid rgba(11, 70, 120, 0.28);
      border-radius: 999px;
      color: var(--primary);
      background: rgba(255, 255, 255, 0.94);
      font-size: 0.88rem;
      font-weight: 900;
      white-space: nowrap;
      box-shadow: 0 10px 22px rgba(6, 23, 43, 0.08);
    }

    .home-control-button.map {
      color: var(--brand-800);
      background: linear-gradient(135deg, rgba(255, 255, 255, 0.98), rgba(231, 240, 248, 0.84));
    }

    .home-control-button ion-icon {
      font-size: 1.05rem;
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
      border: 1px solid rgba(11, 70, 120, 0.26);
      border-radius: 20px;
      background: rgba(255, 255, 255, 0.98);
      box-shadow: 0 24px 54px rgba(6, 23, 43, 0.14);
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
      background: var(--primary-soft);
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
        radial-gradient(circle at 10% 10%, rgba(11, 70, 120, 0.14), transparent 34%),
        linear-gradient(135deg, rgba(255, 255, 255, 0.98), rgba(231, 240, 248, 0.9)),
        var(--surface);
      box-shadow: 0 24px 58px rgba(6, 23, 43, 0.12);
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
      color: var(--muted);
      line-height: 1.5;
    }

    .welcome-actions {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
      margin-top: 4px;
    }

    .customer-quick-actions {
      display: grid;
      grid-template-columns: repeat(4, minmax(124px, 1fr));
      gap: 10px;
      overflow-x: auto;
      padding: 2px 2px 8px;
      scrollbar-width: none;
    }

    .customer-quick-actions::-webkit-scrollbar {
      display: none;
    }

    .customer-quick-actions a {
      display: grid;
      gap: 4px;
      min-width: 124px;
      padding: 13px 12px;
      border: 1px solid rgba(11, 70, 120, 0.2);
      border-radius: 18px;
      color: var(--text);
      background: linear-gradient(145deg, #ffffff, var(--primary-soft));
      box-shadow: 0 12px 28px rgba(6, 23, 43, 0.08);
      text-decoration: none;
    }

    .customer-quick-actions ion-icon {
      width: 22px;
      height: 22px;
      color: var(--primary);
    }

    .customer-quick-actions span {
      color: var(--text);
      font-size: 1.15rem;
      font-weight: 950;
      white-space: nowrap;
    }

    .customer-quick-actions small {
      color: var(--muted);
      font-size: 0.72rem;
      font-weight: 800;
      line-height: 1.2;
    }

    .customer-quick-actions.primary-salon-actions a {
      border-color: rgba(15, 118, 110, 0.2);
      background: linear-gradient(145deg, #ffffff, rgba(15, 118, 110, 0.06));
    }

    .customer-quick-actions.primary-salon-actions ion-icon {
      color: #0F766E;
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
      background: linear-gradient(145deg, rgba(255, 255, 255, 0.96), rgba(246, 249, 252, 0.94));
      box-shadow: 0 18px 42px rgba(6, 23, 43, 0.1);
      text-decoration: none;
    }

    .metric-card ion-icon {
      grid-row: span 3;
      width: 46px;
      height: 46px;
      padding: 11px;
      border-radius: 18px;
      color: #FFFFFF;
      background: linear-gradient(135deg, var(--brand-600), var(--primary), var(--brand-800));
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
      background: linear-gradient(145deg, rgba(255, 255, 255, 0.98), rgba(246, 249, 252, 0.96));
      text-align: left;
      cursor: pointer;
      transition: transform 180ms ease, box-shadow 180ms ease, border-color 180ms ease;
    }

    .visited-card img,
    .visited-fallback {
      grid-row: span 3;
      width: 82px;
      height: 82px;
      border-radius: 20px;
    }

    .visited-card img {
      object-fit: cover;
    }

    .visited-fallback {
      display: grid;
      place-items: center;
      color: #0f4f65;
      background: linear-gradient(145deg, #dff3fb, #bde6f7 42%, #7cd0e8 100%);
      font-size: 1.2rem;
      font-weight: 1000;
      letter-spacing: -0.04em;
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
      color: #FFFFFF;
      background: linear-gradient(135deg, var(--brand-600), var(--primary));
    }

    @media (hover: hover) and (pointer: fine) {
      .visited-card:hover {
        transform: translateY(-3px);
        border-color: rgba(11, 70, 120, 0.34);
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
      background: linear-gradient(90deg, rgba(11, 70, 120, 0.08), rgba(7, 90, 156, 0.14), rgba(11, 70, 120, 0.08));
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
        display: none;
      }

      .hero {
        min-height: auto;
        padding: 14px 14px 16px;
        border-radius: 32px;
      }

      .hero-copy {
        align-content: start;
        gap: 10px;
      }

      .page-title {
        display: none;
        margin: 0;
        font-size: clamp(1.7rem, 8vw, 2.35rem);
        line-height: 0.98;
      }


      .search-panel {
        margin-top: 0;
      }

      .home-search-wrap {
        position: relative;
      }

      .home-search-wrap ion-searchbar {
        width: 100% !important;
        padding-right: 0 !important;
      }

      .live-consultation-card {
        border-radius: 26px;
        padding: 16px;
      }

      .consultation-actions,
      .consultation-photo-row {
        align-items: stretch;
        flex-direction: column;
      }

      .consultation-send,
      .consultation-secondary,
      .consultation-upload {
        width: 100%;
      }

      .search-panel ion-button {
        width: 100%;
      }



      .welcome-actions ion-button {
        width: 100%;
      }
    }

    @media (max-width: 900px) {
      .home-toolbar {
        gap: 8px;
        min-height: 54px;
        padding: 8px 14px;
      }

      .location-copy > span,
      .toolbar-actions ion-button:last-child,
      .near-you-button,
      .page-title,
      .hero-category-strip,
      .location-notice,
      .live-consultation-card {
        display: none !important;
      }

      .location-row {
        gap: 0;
      }

      .location-copy strong {
        max-width: 220px;
        color: var(--text);
        font-size: 0.82rem;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .toolbar-actions {
        gap: 0;
      }

      .home-page {
        gap: 24px;
        padding-top: 10px;
        padding-inline: 16px;
        padding-bottom: calc(156px + env(safe-area-inset-bottom));
        scroll-padding-bottom: calc(156px + env(safe-area-inset-bottom));
      }

      .hero {
        min-height: 0;
        padding: 0;
        border: 0;
        border-radius: 0;
        background: transparent;
        box-shadow: none;
      }

      .hero-copy {
        gap: 0;
      }


      .search-panel {
        gap: 10px;
        padding: 12px;
        border-radius: 22px;
        background: rgba(255, 255, 255, 0.9);
        box-shadow: 0 12px 28px rgba(6, 23, 43, 0.08);
      }

      .home-search-wrap ion-searchbar {
        width: 100% !important;
        padding: 0 !important;
        --border-radius: 18px;
        --box-shadow: none;
      }

      .search-panel ion-button {
        min-height: 44px;
        margin: 0;
      }

      .section-heading.priority-heading {
        margin-top: 8px;
      }

      .business-grid,
      .business-grid.recommended,
      .nearby-grid {
        grid-template-columns: minmax(0, 1fr) !important;
      }

      .mobile-secondary-section {
        display: grid;
        gap: 12px;
        min-width: 0;
      }

      .section-heading {
        align-items: end;
        gap: 12px;
        min-width: 0;
      }

      .section-heading > div { min-width: 0; }
      .section-heading a { flex: 0 0 auto; min-height: 44px; display: inline-flex; align-items: center; white-space: nowrap; }
      .section-title { overflow-wrap: anywhere; }
    }

    @media (min-width: 768px) {
      .aura-dashboard {
        grid-template-columns: minmax(0, 1.25fr) minmax(260px, 0.75fr);
      }

      .customer-quick-actions {
        display: none;
      }

      .customer-metrics {
        grid-template-columns: 1fr;
      }


      .search-panel {
        grid-template-columns: minmax(0, 1fr) auto auto;
        align-items: center;
      }

      .home-control-row {
        flex-wrap: nowrap;
      }

      .business-grid,
      .nearby-grid,
      .skeleton-grid {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }
    }

    @media (max-width: 900px) {
      .home-page .business-rail,
      .home-page .visited-rail {
        grid-auto-flow: row;
        grid-auto-columns: initial;
        grid-template-columns: minmax(0, 1fr);
        gap: 10px;
        overflow: visible;
        padding: 0;
      }

      .home-page .business-rail aura-business-card { display: block; width: 100%; min-width: 0; }
      .home-page .business-rail aura-business-card:nth-child(n + 3),
      .home-page .visited-rail .visited-card:nth-child(n + 3) { display: none; }
      .home-page .visited-card {
        grid-template-columns: 68px minmax(0, 1fr) 40px;
        grid-template-rows: auto auto auto;
        gap: 3px 9px;
        width: 100%;
        min-width: 0;
        height: auto;
        min-height: 92px;
        padding: 8px;
        overflow: visible;
        border-radius: 16px;
      }
      .home-page .visited-card img,
      .home-page .visited-fallback {
        width: 68px;
        height: 68px;
        aspect-ratio: 1 / 1;
        border-radius: 14px;
      }
      .home-page .visited-card span,
      .home-page .visited-card strong,
      .home-page .visited-card small {
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .home-page .visited-card span { font-size: 0.72rem; line-height: 1.25; }
      .home-page .visited-card strong { font-size: 0.96rem; line-height: 1.15; }
      .home-page .visited-card small { font-size: 0.74rem; line-height: 1.25; }
      .home-page .visited-card ion-icon { width: 40px; height: 40px; padding: 11px; }
    }

    @media (max-width: 599px) {
      .home-page { scroll-padding-top: 54px; }
      ion-header { height: 44px !important; }
      ion-toolbar { height: 44px !important; --min-height: 44px !important; }
      .home-toolbar { grid-template-columns: auto 1fr !important; }
      .aura-shine-brand { display: inline-flex !important; align-self: center; margin-top: 0; }
      .location-copy { justify-self: end; text-align: right; }
      .location-row { justify-content: flex-end; }
      .home-page .home-toolbar { min-height: 44px !important; padding-block: 2px !important; }
      .home-page .location-row strong { font-size: 0.78rem !important; }
      .home-page .hero { margin-top: 0; }
      .home-page .search-panel {
        position: relative !important;
        top: auto !important;
        z-index: 2 !important;
        display: block !important;
        margin-inline: 0;
        padding: 0 !important;
        border-radius: 16px !important;
        box-shadow: 0 7px 18px rgba(6, 23, 43, 0.08) !important;
      }
      .home-page .home-search-wrap {
        position: relative;
        width: 100%;
        min-width: 0;
        margin-inline: 0;
      }
      .home-page .home-search-wrap ion-searchbar {
        width: 100% !important;
        height: 42px !important;
        min-height: 42px !important;
        padding: 0 !important;
        padding-right: 0 !important;
        --padding-end: 112px !important;
        --background: #ffffff !important;
        --border-radius: 13px !important;
        --box-shadow: none !important;
        --icon-color: #6B7C8E;
        --placeholder-color: #8493A3;
        font-size: 0.82rem;
      }
      .home-page .home-control-row {
        position: absolute !important;
        top: 50%;
        right: 8px;
        z-index: 2;
        display: flex !important;
        flex-wrap: nowrap !important;
        gap: 0 !important;
        padding: 0 !important;
        border-radius: 22px;
        background: #ffffff;
        transform: translateY(-50%);
      }
      .home-page .home-control-button {
        width: 34px !important;
        min-width: 34px !important;
        height: 34px !important;
        min-height: 34px !important;
        padding: 0 !important;
        border-radius: 50% !important;
        background: transparent !important;
        border: 0 !important;
        box-shadow: none !important;
      }
      .home-page .home-control-button span { display: none !important; }
      .home-page .home-control-button ion-icon {
        width: 14px !important;
        height: 14px !important;
        margin: 0 !important;
        font-size: 14px !important;
        opacity: 0.64;
      }
      .home-page .home-suggestion-panel {
        left: 0 !important;
        right: 0 !important;
        width: auto !important;
      }
    }
      .home-page .business-grid.recommended aura-business-card { --card-image-ratio: 1.65; }
      .home-page .business-grid.recommended { gap: 10px !important; }

    @media (min-width: 1024px) {
      ion-header {
        display: none;
      }

      .hero {
        grid-template-columns: minmax(0, 1fr) minmax(390px, 0.62fr);
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

    .dashboard-hero {
      min-height: 0;
      grid-template-columns: minmax(0, 1.15fr) minmax(300px, 0.85fr);
      align-items: center;
      padding: clamp(22px, 4vw, 42px);
      overflow: visible;
    }

    .dashboard-hero .hero-copy {
      align-content: center;
    }

    .dashboard-hero .page-title {
      display: block;
      max-width: 640px;
      margin: 0;
      color: var(--text);
      font-size: clamp(2rem, 5vw, 4.4rem);
      line-height: 0.96;
      letter-spacing: -0.055em;
    }

    .eyebrow,
    .section-kicker {
      display: block;
      color: var(--primary);
      font-size: 0.72rem;
      font-weight: 950;
      letter-spacing: 0.1em;
      text-transform: uppercase;
    }

    .recent-searches {
      display: flex;
      align-items: center;
      gap: 8px;
      overflow-x: auto;
      padding: 2px;
      scrollbar-width: none;
    }

    .recent-searches > span {
      color: var(--muted);
      font-size: 0.76rem;
      font-weight: 900;
    }

    .recent-searches button {
      flex: 0 0 auto;
      min-height: 44px;
      padding: 0 14px;
      border: 1px solid var(--border);
      border-radius: 999px;
      color: var(--text);
      background: var(--surface);
      font: inherit;
      font-size: 0.8rem;
      font-weight: 850;
    }

    .next-appointment {
      display: grid;
      grid-template-columns: auto minmax(0, 1fr) auto;
      align-items: center;
      gap: 14px;
      min-width: 0;
      padding: 18px;
      border: 1px solid rgba(255, 255, 255, 0.18);
      border-radius: 26px;
      color: #fff;
      background: linear-gradient(145deg, var(--brand-800), var(--primary));
      box-shadow: 0 24px 54px rgba(6, 23, 43, 0.22);
    }

    .appointment-date {
      display: grid;
      place-items: center;
      width: 66px;
      min-width: 66px;
      height: 72px;
      border-radius: 20px;
      background: rgba(255, 255, 255, 0.12);
    }

    .appointment-date span {
      align-self: end;
      font-size: 0.68rem;
      font-weight: 950;
      letter-spacing: 0.08em;
      text-transform: uppercase;
    }

    .appointment-date strong {
      align-self: start;
      font-size: 1.75rem;
      line-height: 1;
    }

    .appointment-date ion-icon { font-size: 1.5rem; }

    .appointment-copy { min-width: 0; }
    .appointment-copy .eyebrow { color: rgba(255, 255, 255, 0.84); }
    .appointment-copy h2 { margin: 4px 0; color: #fff; font-size: clamp(1.1rem, 2vw, 1.45rem); line-height: 1.1; }
    .appointment-copy p { margin: 0; color: rgba(255, 255, 255, 0.88); font-size: 0.82rem; font-weight: 750; line-height: 1.4; }
    .next-appointment > a {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 4px;
      min-height: 44px;
      padding: 0 12px;
      border-radius: 999px;
      color: var(--brand-800);
      background: #fff;
      font-size: 0.78rem;
      font-weight: 950;
      text-decoration: none;
    }

    .aura-dashboard { grid-template-columns: minmax(0, 1fr); }

    .account-shortcuts {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 10px;
    }

    .account-shortcuts a {
      display: grid;
      grid-template-columns: auto minmax(0, 1fr);
      align-items: center;
      gap: 2px 10px;
      min-height: 64px;
      padding: 10px 12px;
      border: 1px solid var(--border);
      border-radius: 18px;
      color: var(--text);
      background: var(--surface);
      text-decoration: none;
      box-shadow: 0 10px 24px rgba(6, 23, 43, 0.06);
    }

    .account-shortcuts ion-icon { grid-row: span 2; color: var(--primary); font-size: 1.2rem; }
    .account-shortcuts span { min-width: 0; font-size: 0.8rem; font-weight: 900; overflow: hidden; text-overflow: ellipsis; }
    .account-shortcuts strong { color: var(--muted); font-size: 0.7rem; }
    .favourites-empty {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      min-height: 72px;
      padding: 14px 16px;
      border: 1px dashed var(--border-strong);
      border-radius: 18px;
      color: var(--muted);
      background: var(--surface);
      font-size: 0.82rem;
      font-weight: 800;
      text-decoration: none;
    }
    .favourites-empty strong { display: inline-flex; align-items: center; gap: 4px; color: var(--primary); white-space: nowrap; }
    .favourite-mini-card {
      display: grid;
      grid-template-columns: 72px minmax(0, 1fr);
      align-items: center;
      gap: 12px;
      min-height: 96px;
      padding: 10px;
      overflow: hidden;
      border: 1px solid var(--border);
      border-radius: 18px;
      color: var(--text);
      background: var(--surface);
      box-shadow: 0 10px 24px rgba(6, 23, 43, 0.07);
      text-decoration: none;
    }
    .favourite-mini-card img,
    .favourite-mini-card > b {
      width: 72px;
      height: 76px;
      border-radius: 14px;
    }
    .favourite-mini-card img { display: block; object-fit: cover; }
    .favourite-mini-card > b {
      display: grid;
      place-items: center;
      color: #0b4678;
      background: linear-gradient(145deg, #dff3fb, #bde6f7 45%, #8bd4e8);
      font-size: 1rem;
      font-weight: 950;
    }
    .favourite-mini-card > span { display: grid; gap: 5px; min-width: 0; }
    .favourite-mini-card strong {
      display: -webkit-box;
      overflow: hidden;
      font-size: 0.88rem;
      line-height: 1.15;
      -webkit-box-orient: vertical;
      -webkit-line-clamp: 2;
    }
    .favourite-mini-card small {
      overflow: hidden;
      color: var(--muted);
      font-size: 0.7rem;
      font-weight: 750;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .section-heading { align-items: end; }
    .section-title { margin-top: 3px; }
    .lower-actions { display: grid; gap: 12px; margin-top: 16px; opacity: 0.9; }
    .lower-actions .customer-quick-actions { display: grid; }

    button:focus-visible,
    a:focus-visible {
      outline: 3px solid rgba(37, 99, 235, 0.42);
      outline-offset: 3px;
    }

    ion-content::part(scroll) { scroll-padding-bottom: calc(156px + env(safe-area-inset-bottom)); }

    @media (max-width: 900px) {
      .home-page .business-rail,
      .home-page .visited-rail {
        grid-auto-flow: row !important;
        grid-auto-columns: minmax(0, 1fr) !important;
        grid-template-columns: minmax(0, 1fr) !important;
        width: 100%;
        min-width: 0;
        overflow: visible !important;
      }
      .home-page .business-rail aura-business-card {
        display: block !important;
        width: 100% !important;
        min-width: 0 !important;
      }
      .dashboard-hero {
        display: grid;
        grid-template-columns: minmax(0, 1fr);
        gap: 12px;
        padding: 0;
      }
      .dashboard-hero .eyebrow,
      .dashboard-hero .page-title { display: none; }
      .dashboard-hero .search-panel { display: grid !important; grid-template-columns: minmax(0, 1fr) auto; align-items: center; padding: 6px !important; }
      .dashboard-hero .search-panel ion-button { width: 44px; min-width: 44px; height: 44px; font-size: 0; --padding-start: 0; --padding-end: 0; }
      .next-appointment {
        grid-template-columns: 54px minmax(0, 1fr) auto;
        gap: 10px;
        width: 100%;
        padding: 12px;
        border-radius: 20px;
        background: linear-gradient(145deg, var(--brand-900), var(--brand-700));
        box-shadow: 0 14px 32px rgba(6, 23, 43, 0.18);
      }
      .next-appointment > a { grid-column: auto; justify-self: end; min-width: 60px; margin: 0; padding-inline: 10px; }
      .appointment-date { width: 54px; min-width: 54px; height: 58px; border-radius: 15px; background: rgba(255, 255, 255, 0.14); }
      .appointment-date span { color: #fff; }
      .appointment-date strong { color: #fff; font-size: 1.55rem; }
      .appointment-copy h2 { margin-block: 2px; color: #fff; font-size: 1rem; }
      .appointment-copy p { color: rgba(255, 255, 255, 0.88); font-size: 0.74rem; line-height: 1.25; }
      .account-shortcuts { grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; overflow: visible; padding: 0; }
      .account-shortcuts a {
        grid-template-columns: minmax(0, 1fr);
        justify-items: center;
        align-content: center;
        gap: 5px;
        min-width: 0;
        min-height: 78px;
        padding: 9px 4px;
        text-align: center;
      }
      .account-shortcuts ion-icon { grid-row: auto; font-size: 1.25rem; }
      .account-shortcuts span { width: 100%; font-size: 0.72rem; line-height: 1.15; text-overflow: clip; white-space: nowrap; }
      .account-shortcuts strong { font-size: 0.66rem; line-height: 1.1; white-space: nowrap; }
      .customer-quick-actions { display: grid; }
    }

    @media (max-width: 599px) {
      .home-page .visited-rail {
        grid-template-columns: repeat(2, minmax(0, 1fr)) !important;
        gap: 8px;
        align-items: stretch;
      }
      .home-page .visited-rail .visited-card:nth-child(-n + 4) { display: grid !important; }
      .home-page .visited-rail .visited-card:nth-child(n + 5) { display: none !important; }
      .home-page .visited-rail .visited-card {
        grid-template-columns: 52px minmax(0, 1fr);
        grid-template-rows: auto auto;
        align-content: center;
        gap: 3px 7px;
        min-height: 74px;
        max-height: 74px;
        padding: 6px;
        overflow: hidden;
        border-radius: 14px;
      }
      .home-page .visited-rail .visited-card img,
      .home-page .visited-rail .visited-fallback {
        grid-row: span 2;
        width: 52px;
        height: 62px;
        border-radius: 12px;
      }
      .home-page .visited-rail .visited-card > span,
      .home-page .visited-rail .visited-card ion-icon { display: none; }
      .home-page .visited-rail .visited-card strong {
        grid-column: 2;
        font-size: 0.78rem;
        line-height: 1.1;
      }
      .home-page .visited-rail .visited-card small {
        grid-column: 2;
        font-size: 0.62rem;
        line-height: 1.15;
      }

      .home-page .business-rail.continue-rail,
      .home-page .business-rail.favourites-rail {
        grid-template-columns: repeat(2, minmax(0, 1fr)) !important;
        gap: 8px;
        align-items: stretch;
        margin-bottom: 4px;
      }
      .home-page :is(.continue-rail, .favourites-rail) aura-business-card:nth-child(-n + 4) { display: block !important; }
      .home-page :is(.continue-rail, .favourites-rail) aura-business-card:nth-child(n + 5) { display: none !important; }
      .home-page .favourites-rail .favourite-mini-card {
        grid-template-columns: 52px minmax(0, 1fr);
        gap: 8px;
        min-width: 0;
        min-height: 82px;
        padding: 6px;
        border-radius: 15px;
      }
      .home-page .favourites-rail .favourite-mini-card img,
      .home-page .favourites-rail .favourite-mini-card > b {
        width: 52px;
        height: 68px;
        border-radius: 11px;
      }
      .home-page .favourites-rail .favourite-mini-card strong { font-size: 0.76rem; }
      .home-page .favourites-rail .favourite-mini-card small { font-size: 0.61rem; }
      .home-page .favourites-rail .favourite-mini-card:nth-child(n + 5) { display: none; }

      .home-page .lower-actions {
        gap: 8px;
        margin-top: 8px;
      }
      .home-page .lower-actions .section-kicker { font-size: 0.62rem; }
      .home-page .lower-actions .section-title { font-size: 1rem; }
      .home-page .lower-actions .customer-quick-actions {
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 8px;
        overflow: visible;
        padding: 0;
      }
      .home-page .lower-actions .customer-quick-actions a {
        grid-template-columns: 20px minmax(0, 1fr);
        align-items: center;
        gap: 3px 8px;
        min-width: 0;
        min-height: 62px;
        padding: 8px 10px;
        border-radius: 14px;
      }
      .home-page .lower-actions .customer-quick-actions ion-icon {
        grid-row: 1;
        width: 20px;
        height: 20px;
      }
      .home-page .lower-actions .customer-quick-actions span {
        min-width: 0;
        overflow: hidden;
        font-size: 0.82rem;
        line-height: 1.1;
        text-overflow: ellipsis;
      }
      .home-page .lower-actions .customer-quick-actions small { display: none; }
    }

    @media (max-width: 349px) {
      .next-appointment { grid-template-columns: 52px minmax(0, 1fr); }
      .next-appointment > a { grid-column: 1 / -1; width: 100%; justify-self: stretch; }
      .appointment-date { width: 52px; min-width: 52px; }
      .account-shortcuts { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .account-shortcuts a:last-child { grid-column: 1 / -1; }
      .favourites-empty { align-items: flex-start; flex-direction: column; gap: 8px; }
    }

    @media (prefers-reduced-motion: reduce) {
      .skeleton-card { animation: none; }
      .visited-card { transition: none; }
    }

  `]
})
export class HomePage implements OnInit {
  readonly query = signal("");
  readonly activeQuery = signal("");
  readonly categoryFilter = signal("");
  readonly mobileHome = signal(this.isMobileViewport());
  readonly areaLabel = signal(localStorage.getItem("aura_customer_area_label") || "Current area");
  readonly currentLocation = signal<{ lat: number; lng: number } | null>(this.savedLocation());
  readonly locating = signal(false);
  readonly locationNotice = signal("");
  readonly recentSearches = signal<HomeRecentSearch[]>(this.readRecentSearches());
  readonly consultationLoading = signal(false);
  readonly consultationError = signal("");
  readonly consultationPhotos = signal<LiveConsultationPhoto[]>([]);
  readonly consultationMessages = signal<ConsultationChatMessage[]>([
    {
      role: "assistant",
      text: "Tell me what you need, add photos if useful, and I will suggest services, salons, location details and booking steps."
    }
  ]);
  readonly consultationResponse = signal<LiveConsultationResponse | null>(null);
  readonly selectedConsultationGoals = signal<string[]>(["Hair", "Near me"]);
  consultationText = "";
  readonly consultationGoals = ["Hair", "Skin", "Nails", "Spa", "Bridal", "Barber", "Budget", "Near me"];
  readonly skeletons = [1, 2, 3, 4, 5, 6];
  readonly hasPrimarySalon = computed(() => !!this.marketplace.primarySalon());
  readonly searchActive = computed(() => !!this.activeQuery().trim());
  readonly homeResults = computed(() => this.filterBusinesses(this.marketplace.businesses()));
  readonly recommendations = computed(() => this.uniqueBusinesses(this.recommendedBusinesses()).slice(0, 4));
  readonly recommendedMore = computed(() => {
    const recommendationIds = new Set(this.recommendations().map((business) => business.id));
    return this.uniqueBusinesses(this.recommendedBusinesses())
      .filter((business) => !recommendationIds.has(business.id))
      .slice(0, 6);
  });
  readonly nearby = computed(() => {
    const usedIds = new Set(this.recommendations().map((business) => business.id));
    const preferredCategories = new Set([
      ...this.recentlyViewed().flatMap((business) => business.categories),
      ...this.recentlyVisited().flatMap((item) => item.business.categories)
    ]);
    const score = (business: Business) => (business.categories.some((category) => preferredCategories.has(category)) ? 20 : 0)
      - Number(business.distanceKm || 10);
    return this.uniqueBusinesses(this.homeResults())
      .filter((business) => !usedIds.has(business.id))
      .sort((left, right) => score(right) - score(left))
      .slice(0, 6);
  });
  readonly recentlyViewed = computed(() => this.recentlyViewedBusinesses());
  readonly recentlyVisited = computed(() => this.recentlyVisitedBusinesses());
  readonly primarySalonSuggestion = computed<CustomerSalonRelationship | null>(() => {
    if (this.marketplace.primarySalon()) return null;

    const backendSuggestion = this.marketplace.suggestedSalon();
    if (backendSuggestion) return backendSuggestion;

    const visitedSalon = [...this.marketplace.mySalons()]
      .filter((salon) => Number(salon.visitCount || 0) >= 1)
      .sort((left, right) => Number(right.visitCount || 0) - Number(left.visitCount || 0))[0];
    if (visitedSalon) return visitedSalon;

    const booking = [...this.marketplace.bookings()]
      .filter((item) => item.status !== "cancelled" && (!!item.businessId || !!item.businessName))
      .sort((left, right) => this.bookingTime(right) - this.bookingTime(left))[0];
    if (!booking) return null;

    const business = this.marketplace.businesses().find((item) => item.id === booking.businessId || item.businessName === booking.businessName);
    if (!business?.tenantId || !business.branchId) return null;

    const bookingDate = new Date(this.bookingTime(booking) || Date.now()).toISOString();
    return {
      id: `booking-${booking.id}`,
      customerId: String(this.marketplace.customer()?.id || ""),
      tenantId: business.tenantId,
      branchId: business.branchId,
      businessId: business.id,
      businessName: business.businessName,
      relationshipType: "booked",
      visitCount: 1,
      lastVisitAt: bookingDate,
      isFavorite: 0,
      createdAt: bookingDate,
      updatedAt: bookingDate
    };
  });
  readonly recommendationKicker = computed(() => this.recentlyViewed().length || this.recentlyVisited().length
    ? "Based on your activity"
    : "Selected by rating and distance");
  readonly nextAppointment = computed(() => [...this.marketplace.bookings()]
    .filter((booking) => booking.status !== "cancelled" && booking.status !== "completed" && this.bookingTime(booking) >= Date.now())
    .sort((left, right) => this.bookingTime(left) - this.bookingTime(right))[0] ?? null);
  readonly favoriteBusinesses = computed(() => {
    const favorites = this.marketplace.favorites();
    const allBusinesses = this.marketplace.businesses();

    const resolved = favorites
      .map((fav) => {
        if (fav.business && fav.business.businessName) {
          return fav.business;
        }
        const targetId = fav.businessId || fav.business?.id || fav.business?.slug;
        if (targetId) {
          const found = allBusinesses.find(
            (b) => b.id === targetId || b.slug === targetId || b.branchId === targetId
          );
          if (found) return found;
        }
        return null;
      })
      .filter((b): b is Business => !!b && Boolean(b.businessName));

    if (resolved.length < favorites.length) {
      for (const biz of allBusinesses) {
        if (!resolved.some((r) => r.id === biz.id || r.slug === biz.slug)) {
          resolved.push(biz);
          if (resolved.length >= Math.min(4, favorites.length)) break;
        }
      }
    }

    return this.uniqueBusinesses(resolved).slice(0, 4);
  });
  readonly relevantOffers = computed(() => {
    const preferredCategories = new Set([
      ...this.recentlyViewed().flatMap((business) => business.categories),
      ...this.recentlyVisited().flatMap((item) => item.business.categories)
    ]);
    const score = (business: Business) => (business.categories.some((category) => preferredCategories.has(category)) ? 20 : 0)
      + Math.max(0, 8 - Number(business.distanceKm || 8))
      + Number(business.ratingAverage || 0);
    return this.uniqueBusinesses(this.marketplace.businesses().filter((business) => business.hasOffer))
      .sort((left, right) => score(right) - score(left))
      .slice(0, 4);
  });
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

  constructor(readonly marketplace: MarketplaceService, private readonly router: Router, private readonly api: CustomerApiService) {
    addIcons({
      calendarOutline,
      cameraOutline,
      chatbubblesOutline,
      chevronForwardOutline,
      locationOutline,
      mapOutline,
      navigateOutline,
      notificationsOutline,
      optionsOutline,
      personCircleOutline,
      pricetagOutline,
      ribbonOutline,
      searchOutline,
      sparklesOutline,
      swapVerticalOutline,
      timeOutline,
      walletOutline
    });
  }

  @HostListener("window:resize")
  onResize(): void {
    this.mobileHome.set(this.isMobileViewport());
  }

  ngOnInit() {
    void Promise.all([
      this.marketplace.loadPublicBusinesses(),
      this.marketplace.loadCategories(),
      this.marketplace.isAuthenticated() ? this.marketplace.loadCustomer() : Promise.resolve(null),
      this.marketplace.isAuthenticated() ? this.marketplace.loadBookings() : Promise.resolve([]),
      this.marketplace.isAuthenticated() ? this.marketplace.loadMySalons().catch(() => null) : Promise.resolve(null),
      this.marketplace.isAuthenticated() ? this.marketplace.ensureFavorites().catch(() => []) : Promise.resolve([])
    ]).catch(() => undefined);
  }

  openSalonPicker() {
    void this.router.navigate(["/tabs/profile"]);
  }

  dismissPrimaryPrompt() {
    this.marketplace.shouldPromptPrimary.set(false);
    this.marketplace.suggestedSalon.set(null);
  }

  async onSetPrimarySalon(salon: CustomerSalonRelationship) {
    try {
      await this.marketplace.setPrimarySalon(salon.tenantId, salon.branchId, salon.businessId, salon.businessName);
    } catch {
      // error is handled by marketplace service
    }
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

  repeatSearch(item: HomeRecentSearch) {
    this.query.set(item.query);
    void this.openDiscover(item.query, item.mode);
  }

  search() {
    const intent = this.searchIntent(this.query().trim());
    void this.openDiscover(intent.query, intent.mode, intent.nearMe);
  }

  openDiscoverPanel(panel: "filter" | "sort") {
    const intent = this.searchIntent(this.query().trim());
    return this.router.navigate(["/search"], {
      queryParams: {
        q: intent.query || undefined,
        mode: intent.mode,
        panel
      }
    });
  }

  openMapSearch() {
    const intent = this.searchIntent(this.query().trim());
    return this.router.navigate(["/search"], {
      queryParams: {
        q: intent.query || undefined,
        mode: "locations",
        filter: "nearest",
        sort: "distance",
        nearMe: true,
        map: true
      }
    });
  }

  clearSearch() {
    this.query.set("");
    this.activeQuery.set("");
    this.reload();
  }

  openBusiness(business: Business) {
    void this.router.navigate(["/business", business.slug]);
  }

  openExploreFromSearch() {
    void this.router.navigate(["/search"]);
  }

  bookAgain(item: HomeVisitedBusiness) {
    void this.router.navigate(["/business", item.business.slug, "book"], {
      queryParams: { serviceId: item.serviceId || undefined }
    });
  }

  appointmentMonth(booking: Booking): string {
    const time = this.bookingTime(booking);
    return time ? new Intl.DateTimeFormat("en-IN", { month: "short" }).format(new Date(time)) : "Next";
  }

  appointmentDay(booking: Booking): string {
    const time = this.bookingTime(booking);
    return time ? new Intl.DateTimeFormat("en-IN", { day: "2-digit" }).format(new Date(time)) : "·";
  }

  appointmentTime(booking: Booking): string {
    const time = this.bookingTime(booking);
    return time
      ? new Intl.DateTimeFormat("en-IN", { weekday: "short", hour: "numeric", minute: "2-digit", hour12: true }).format(new Date(time))
      : (booking.displayStartAt || "Time to be confirmed");
  }

  nearbyContextLabel(): string {
    const history = [...this.recentlyViewed(), ...this.recentlyVisited().map((item) => item.business)];
    const category = history.flatMap((business) => business.categories).find(Boolean);
    return category ? `Near ${this.areaLabel()} · inspired by ${category}` : `Near ${this.areaLabel()}`;
  }

  businessImage(business: Business): string {
    const image = business.coverImage || business.galleryImages?.[0] || "";
    return this.isPlaceholderImage(image) ? "" : image;
  }

  businessInitials(business: Business): string {
    return String(business.businessName || "Aura")
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((word) => word.charAt(0).toUpperCase())
      .join("") || "A";
  }

  private isPlaceholderImage(image: string): boolean {
    const normalized = String(image || "").trim().toLowerCase();
    return !normalized || normalized.endsWith("assets/icons/icon.svg") || normalized.endsWith("/assets/icons/icon.svg");
  }

  openBusinessSlug(slug: string) {
    if (!slug) return;
    void this.router.navigate(["/business", slug]);
  }

  toggleConsultationGoal(goal: string) {
    const current = new Set(this.selectedConsultationGoals());
    current.has(goal) ? current.delete(goal) : current.add(goal);
    this.selectedConsultationGoals.set([...current]);
  }

  async addConsultationPhotos(event: Event) {
    const input = event.target as HTMLInputElement;
    const files = Array.from(input.files || []);
    input.value = "";
    if (!files.length) return;
    this.consultationError.set("");
    const existing = this.consultationPhotos();
    const remaining = Math.max(0, 5 - existing.length);
    if (!remaining) {
      this.consultationError.set("Maximum 5 photos allowed in one consultation.");
      return;
    }
    const accepted: LiveConsultationPhoto[] = [];
    for (const file of files.slice(0, remaining)) {
      if (!file.type.startsWith("image/")) {
        this.consultationError.set("Only photo files are allowed.");
        continue;
      }
      const totalSize = [...existing, ...accepted].reduce((sum, photo) => sum + photo.sizeBytes, 0) + file.size;
      if (file.size > 2 * 1024 * 1024) {
        this.consultationError.set("Each photo must be under 2 MB for AI consultation.");
        continue;
      }
      if (totalSize > 5 * 1024 * 1024) {
        this.consultationError.set("Photo upload total must stay under 5 MB for this consultation.");
        continue;
      }
      accepted.push({
        name: `${Date.now()}-${file.name}`,
        type: file.type || "image/jpeg",
        sizeBytes: file.size,
        dataUrl: await this.readPhotoDataUrl(file)
      });
    }
    this.consultationPhotos.set([...existing, ...accepted].slice(0, 5));
  }

  removeConsultationPhoto(name: string) {
    this.consultationPhotos.set(this.consultationPhotos().filter((photo) => photo.name !== name));
  }

  async sendConsultation() {
    const message = this.consultationText.trim();
    const goals = this.selectedConsultationGoals();
    if (!message && !goals.length && !this.consultationPhotos().length) {
      this.consultationError.set("Write a consultation question, choose a goal, or add a photo.");
      return;
    }
    this.consultationLoading.set(true);
    this.consultationError.set("");
    this.consultationMessages.update((items) => [...items, {
      role: "customer",
      text: message || `Need help with ${goals.join(", ")}`
    }]);
    try {
      const response = await firstValueFrom(this.api.createLiveConsultation({
        message,
        goals,
        location: this.currentLocation() ? { ...this.currentLocation(), label: this.areaLabel() } : { label: this.areaLabel() },
        photos: this.consultationPhotos(),
        businesses: this.consultationBusinessContext()
      }));
      this.consultationResponse.set(response);
      this.consultationMessages.update((items) => [...items, { role: "assistant", text: response.answer }]);
      this.consultationText = "";
    } catch (error) {
      this.consultationError.set(error instanceof Error ? error.message : "Unable to start live consultation.");
    } finally {
      this.consultationLoading.set(false);
    }
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

  private readPhotoDataUrl(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = () => reject(reader.error || new Error("Unable to read photo"));
      reader.readAsDataURL(file);
    });
  }

  private consultationBusinessContext(): LiveConsultationBusinessContext[] {
    const preferred = this.recommendations().length ? this.recommendations() : this.homeResults();
    return preferred.slice(0, 12).map((business) => ({
      id: business.id,
      slug: business.slug,
      businessName: business.businessName,
      category: business.category,
      description: business.description,
      address: business.address,
      area: business.area,
      city: business.city,
      state: business.state,
      country: business.country,
      phone: business.phone || business.mobileNumber || business.appointmentNumber,
      mapsUrl: business.mapsUrl,
      ratingAverage: business.ratingAverage,
      ratingCount: business.ratingCount,
      distanceKm: business.distanceKm,
      isOpen: business.isOpen,
      hoursLabel: business.hoursLabel,
      nextAvailableSlot: business.nextAvailableSlot,
      startingPricePaise: business.startingPricePaise,
      popularService: business.popularService,
      services: business.services.slice(0, 8).map((service) => ({
        id: service.id,
        name: service.name,
        category: service.category,
        description: service.description,
        pricePaise: service.pricePaise,
        durationMinutes: service.durationMinutes
      }))
    }));
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

  private recentlyVisitedBusinesses(): HomeVisitedBusiness[] {
    const businesses = this.marketplace.businesses();
    const seen = new Set<string>();
    return [...this.marketplace.bookings()]
      .filter((booking) => (booking.status === "completed" || this.bookingTime(booking) < Date.now()) && booking.status !== "cancelled")
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
        serviceId: item.booking.serviceId,
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

  private bookingTime(booking: { startAt?: string; displayStartAt?: string; startsAt?: string }): number {
    const value = booking.startAt || booking.displayStartAt || booking.startsAt || "";
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
    this.recordRecentSearch(query, mode);
    return this.router.navigate(["/search"], {
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

  private isMobileViewport(): boolean {
    return typeof window !== "undefined" && window.innerWidth <= 900;
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

  private readRecentSearches(): HomeRecentSearch[] {
    try {
      const value = JSON.parse(localStorage.getItem("aura_customer_recent_searches") || "[]") as HomeRecentSearch[];
      return Array.isArray(value) ? value.filter((item) => !!item?.query && !!item?.mode).slice(0, 5) : [];
    } catch {
      return [];
    }
  }

  private recordRecentSearch(query: string, mode: HomeRecentSearch["mode"]) {
    const normalized = query.trim();
    if (!normalized) return;
    const next = [{ query: normalized, mode }, ...this.recentSearches().filter((item) => item.query.toLowerCase() !== normalized.toLowerCase())].slice(0, 5);
    this.recentSearches.set(next);
    try {
      localStorage.setItem("aura_customer_recent_searches", JSON.stringify(next));
    } catch {
      // Search history is optional when browser storage is unavailable.
    }
  }

  private uniqueBusinesses(rows: Business[]): Business[] {
    const seen = new Set<string>();
    return rows.filter((business) => {
      const key = business.id || business.slug;
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
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

