import { Component, HostListener, OnInit, computed, signal } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { Router, RouterLink } from "@angular/router";
import { IonButton, IonContent, IonHeader, IonIcon, IonSearchbar, IonToolbar } from "@ionic/angular/standalone";
import { firstValueFrom } from "rxjs";
import { addIcons } from "ionicons";
import { environment } from "../../../environments/environment";
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
  timeOutline
} from "ionicons/icons";
import { BusinessCardComponent } from "../../shared/business-card.component";
import { CustomerApiService } from "../../core/customer-api.service";
import { MarketplaceService } from "../../core/marketplace.service";
import { Booking, Business, LiveConsultationBusinessContext, LiveConsultationPhoto, LiveConsultationResponse } from "../../core/api.types";

interface HomeSearchSuggestion {
  key: string;
  label: string;
  type: "Salon" | "Service" | "Staff" | "Location";
  copy: string;
  query: string;
}

interface ConsultationChatMessage {
  role: "customer" | "assistant";
  text: string;
}

@Component({
  standalone: true,
  imports: [FormsModule, RouterLink, IonButton, IonContent, IonHeader, IonIcon, IonSearchbar, IonToolbar, BusinessCardComponent],
  template: `
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
            @if (!mobileHome()) {
              <ion-button fill="clear" shape="round" class="staff-toolbar-button" [href]="staffAppUrl">Staff?</ion-button>
            }
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
            @if (!mobileHome()) {
              <h1 class="page-title">Find and book your next self-care visit</h1>
            }
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
              <div class="home-control-row" aria-label="Home search controls">
                <button type="button" class="home-control-button" aria-label="Filter salons and services" title="Filter" (click)="openDiscoverPanel('filter')">
                  <ion-icon name="options-outline"></ion-icon>
                  <span>Filter</span>
                </button>
                <button type="button" class="home-control-button" aria-label="Sort search results" title="Sort" (click)="openDiscoverPanel('sort')">
                  <ion-icon name="swap-vertical-outline"></ion-icon>
                  <span>Sort</span>
                </button>
                <button type="button" class="home-control-button map" aria-label="Show salons on map" title="Show map" (click)="openMapSearch()">
                  <ion-icon name="map-outline"></ion-icon>
                  <span>Show map</span>
                </button>
              </div>
              <ion-button class="primary-gradient" (click)="search()">
                <ion-icon name="search-outline" slot="start"></ion-icon>
                Search
              </ion-button>
            </div>
            @if (!mobileHome()) {
            <div class="category-strip hero-category-strip">
              <button class="pill" [class.active]="categoryFilter() === ''" type="button" (click)="setCategory('')">All</button>
              @for (category of marketplace.categories(); track category.id || category.slug) {
                <button class="pill" [class.active]="categoryFilter() === category.slug" type="button" (click)="setCategory(category.slug)">
                  {{ category.label }}
                </button>
              }
            </div>
            }
            @if (!mobileHome() && locationNotice()) {
              <p class="location-notice">{{ locationNotice() }}</p>
            }
          </div>
          @if (!mobileHome()) {
          <aside class="live-consultation-card" aria-label="Live AI consultation">
            <div class="consultation-topline">
              <span><ion-icon name="sparkles-outline"></ion-icon> Live consultation</span>
              <small>{{ consultationResponse()?.mode === "openai" ? "ChatGPT AI live" : "Smart local guide" }}</small>
            </div>
            <h2>Show photos, chat, and get the right salon plan</h2>

            <div class="consultation-goals" aria-label="Consultation goals">
              @for (goal of consultationGoals; track goal) {
                <button type="button" [class.active]="selectedConsultationGoals().includes(goal)" (click)="toggleConsultationGoal(goal)">{{ goal }}</button>
              }
            </div>

            <div class="consultation-chat">
              @for (message of consultationMessages(); track message.text) {
                <div class="consultation-message" [class.customer]="message.role === 'customer'">
                  <strong>{{ message.role === "customer" ? "You" : "Aura AI" }}</strong>
                  <span>{{ message.text }}</span>
                </div>
              }
            </div>

            <label class="consultation-input-label">
              Consultation details
              <textarea
                rows="4"
                [(ngModel)]="consultationText"
                placeholder="Example: I need hair color for wedding next week, budget 3000, near Jubilee Hills, attach current hair photo.">
              </textarea>
            </label>

            <div class="consultation-photo-row">
              <input #consultationPhotoInput type="file" accept="image/*" multiple hidden (change)="addConsultationPhotos($event)" />
              <button type="button" class="consultation-upload" (click)="consultationPhotoInput.click()">
                <ion-icon name="camera-outline"></ion-icon>
                Add photos
              </button>
              <span>{{ consultationPhotos().length }}/5 photos</span>
            </div>

            @if (consultationPhotos().length) {
              <div class="consultation-photo-strip">
                @for (photo of consultationPhotos(); track photo.name) {
                  <button type="button" (click)="removeConsultationPhoto(photo.name)" [title]="'Remove ' + photo.name">
                    <img [src]="photo.dataUrl" [alt]="photo.name" />
                    <span>Remove</span>
                  </button>
                }
              </div>
            }

            @if (consultationError()) {
              <p class="consultation-error">{{ consultationError() }}</p>
            }

            <div class="consultation-actions">
              <button type="button" class="consultation-send" [disabled]="consultationLoading()" (click)="sendConsultation()">
                <ion-icon name="chatbubbles-outline"></ion-icon>
                {{ consultationLoading() ? "Consulting" : "Start consultation" }}
              </button>
              <button type="button" class="consultation-secondary" (click)="useCurrentLocation()">
                <ion-icon name="location-outline"></ion-icon>
                {{ areaLabel() }}
              </button>
            </div>

            @if (consultationResponse(); as response) {
              <div class="consultation-results">
                <div>
                  <strong>Plan</strong>
                  <ol>
                    @for (step of response.actionPlan; track step) {
                      <li>{{ step }}</li>
                    }
                  </ol>
                </div>
                <div>
                  <strong>Best salons</strong>
                  @for (salon of response.recommendedSalons; track salon.slug || salon.businessName) {
                    <button type="button" class="consultation-result-card" (click)="openBusinessSlug(salon.slug)">
                      <span>{{ salon.businessName }}</span>
                      <small>{{ salon.location }} - {{ salon.openStatus || "Check availability" }}</small>
                      <ion-icon name="chevron-forward-outline"></ion-icon>
                    </button>
                  }
                </div>
                <div>
                  <strong>Services</strong>
                  @for (service of response.recommendedServices.slice(0, 3); track service.name + service.businessName) {
                    <button type="button" class="consultation-service-card" (click)="openBusinessSlug(service.slug)">
                      <span>{{ service.name }}</span>
                      <small>{{ service.businessName }} - {{ service.priceLabel }} - {{ service.durationLabel }}</small>
                    </button>
                  }
                </div>
                <p class="consultation-safety">{{ response.safetyNote }}</p>
              </div>
            }
          </aside>
          }
        </section>

        <section class="aura-dashboard" aria-label="Personalized Aura dashboard">
          <article class="welcome-card">
            <h2>{{ greeting() }}</h2>
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

          <nav class="customer-quick-actions" aria-label="Customer quick actions">
            <a routerLink="/tabs/search"><ion-icon name="search-outline"></ion-icon><span>Book now</span><small>Services near you</small></a>
            <a routerLink="/tabs/bookings"><ion-icon name="calendar-outline"></ion-icon><span>My bookings</span><small>Reschedule or cancel</small></a>
            <a routerLink="/tabs/offers"><ion-icon name="pricetag-outline"></ion-icon><span>Offers</span><small>Deals and rewards</small></a>
            <a routerLink="/tabs/profile"><ion-icon name="person-circle-outline"></ion-icon><span>Profile</span><small>Your details</small></a>
          </nav>

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
          <section class="mobile-secondary-section">
          <div class="section-heading priority-heading">
            <div>
              <h2 class="section-title">Book again faster</h2>
            </div>
          </div>
          <div class="visited-rail">
            @for (item of recentlyVisited(); track item.business.id) {
              <button type="button" class="visited-card premium-card" (click)="openBusiness(item.business)">
                @if (businessImage(item.business)) {
                  <img [src]="businessImage(item.business)" [alt]="item.business.businessName + ' cover'" />
                } @else {
                  <b class="visited-fallback" aria-hidden="true">{{ businessInitials(item.business) }}</b>
                }
                <span>{{ item.lastVisitLabel }}</span>
                <strong>{{ item.business.businessName }}</strong>
                <small>{{ item.serviceName || item.business.popularService || item.business.category }}</small>
                <ion-icon name="time-outline"></ion-icon>
              </button>
            }
          </div>
          </section>
        }

        @if (!searchActive() && recentlyViewed().length) {
          <section class="mobile-secondary-section">
          <div class="section-heading">
            <div>
              <h2 class="section-title">Continue where you left off</h2>
            </div>
          </div>
          <div class="business-rail">
            @for (business of recentlyViewed(); track business.id) {
              <aura-business-card [business]="business" [userLocation]="currentLocation()"></aura-business-card>
            }
          </div>
          </section>
        }

        @if (!searchActive()) {
          <div class="section-heading priority-heading">
            <div>
              <h2 class="section-title">Recommendations</h2>
            </div>
            <a routerLink="/tabs/search">Explore all</a>
          </div>
          <div class="business-grid recommended priority-grid">
            @for (business of recommendations(); track business.id) {
              <aura-business-card [business]="business" [userLocation]="currentLocation()"></aura-business-card>
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
              <aura-business-card [business]="business" [userLocation]="currentLocation()"></aura-business-card>
            } @empty {
              <section class="state-card premium-card"><h2>No places found</h2></section>
            }
          </div>
        }

        @if (!searchActive()) {
        <section class="mobile-secondary-section">
        <div class="section-heading">
          <div>
            <h2 class="section-title">Recommended businesses</h2>
          </div>
          <a routerLink="/tabs/search">See all</a>
        </div>
        <div class="business-grid recommended">
          @for (business of recommendedMore(); track business.id) {
            <aura-business-card [business]="business" [userLocation]="currentLocation()"></aura-business-card>
          } @empty {
            <section class="state-card premium-card"><h2>No businesses found</h2></section>
          }
        </div>
        </section>
        }

        @if (!searchActive()) {
        <section class="mobile-secondary-section">
        <div class="section-heading">
          <div>
            <h2 class="section-title">Nearby businesses</h2>
          </div>
          <a routerLink="/tabs/search">View map</a>
        </div>
        <div class="nearby-grid">
          @for (business of nearby(); track business.id) {
            <aura-business-card [business]="business" [userLocation]="currentLocation()"></aura-business-card>
          } @empty {
            <section class="state-card premium-card"><h2>No nearby businesses yet</h2></section>
          }
        </div>
        </section>
        }

        @if (!searchActive()) {
        <section class="mobile-secondary-section">
        <div class="section-heading">
          <div>
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
            <section class="state-card premium-card"><h2>No services published yet</h2></section>
          }
        </div>
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

    .staff-toolbar-button {
      --color: #6E4810;
      --background: rgba(255, 249, 236, 0.96);
      --border-color: rgba(214, 169, 74, 0.34);
      --border-style: solid;
      --border-width: 1px;
      --box-shadow: 0 8px 18px rgba(92, 65, 28, 0.08);
      min-width: 78px;
      font-weight: 950;
      text-transform: none;
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

    .live-consultation-card {
      align-self: stretch;
      display: grid;
      gap: 12px;
      min-width: 0;
      padding: 18px;
      border: 1px solid rgba(214, 169, 74, 0.28);
      border-radius: 28px;
      background: linear-gradient(145deg, rgba(255, 255, 255, 0.94), rgba(255, 249, 236, 0.92));
      box-shadow: 0 28px 60px rgba(92, 65, 28, 0.16), inset 0 1px 0 rgba(255, 255, 255, 0.8);
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
      color: #120D05;
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
      color: #7E6E55;
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
      border: 1px solid rgba(214, 169, 74, 0.34);
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
      color: #120D05;
      background: linear-gradient(135deg, #F4D58D, #D6A94A);
      border-color: rgba(155, 107, 34, 0.4);
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
      border: 1px solid rgba(214, 169, 74, 0.22);
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
      border: 1px solid rgba(214, 169, 74, 0.28);
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
      border-color: rgba(155, 107, 34, 0.46);
      box-shadow: 0 0 0 4px rgba(214, 169, 74, 0.14);
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
      border: 1px solid rgba(214, 169, 74, 0.26);
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
      background: rgba(18, 13, 5, 0.72);
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
      color: #120D05;
      background: linear-gradient(135deg, #F4D58D, #D6A94A, #B77B24);
      font-weight: 1000;
      box-shadow: 0 14px 30px rgba(155, 107, 34, 0.22);
    }

    .consultation-send:disabled {
      opacity: 0.68;
      cursor: wait;
    }

    .consultation-results {
      display: grid;
      gap: 12px;
      border-top: 1px solid rgba(214, 169, 74, 0.22);
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
      color: #5E4C34;
      font-size: 0.9rem;
      line-height: 1.4;
    }

    .consultation-result-card,
    .consultation-service-card {
      position: relative;
      display: grid;
      gap: 3px;
      width: 100%;
      border: 1px solid rgba(214, 169, 74, 0.24);
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
      color: #7E6E55;
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
      box-shadow: 0 24px 54px rgba(92, 65, 28, 0.14), inset 0 1px 0 rgba(255, 255, 255, 0.8);
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
      border: 1px solid rgba(214, 169, 74, 0.28);
      border-radius: 999px;
      color: #5F3F10;
      background: rgba(255, 249, 236, 0.94);
      font-size: 0.88rem;
      font-weight: 900;
      white-space: nowrap;
      box-shadow: 0 10px 22px rgba(92, 65, 28, 0.1);
    }

    .home-control-button.map {
      color: #120D05;
      background: linear-gradient(135deg, rgba(255, 255, 255, 0.98), rgba(244, 213, 141, 0.72));
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
      border: 1px solid rgba(214, 169, 74, 0.2);
      border-radius: 18px;
      color: #281806;
      background: linear-gradient(145deg, #ffffff, #fff4d8);
      box-shadow: 0 12px 28px rgba(92, 65, 28, 0.09);
      text-decoration: none;
    }

    .customer-quick-actions ion-icon {
      width: 22px;
      height: 22px;
      color: #8a5a16;
    }

    .customer-quick-actions span {
      color: #201307;
      font-size: 1.15rem;
      font-weight: 950;
      white-space: nowrap;
    }

    .customer-quick-actions small {
      color: #7e6e55;
      font-size: 0.72rem;
      font-weight: 800;
      line-height: 1.2;
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

    @media (max-width: 767px) {
      .home-toolbar {
        gap: 8px;
        min-height: 54px;
        padding: 8px 14px;
      }

      .location-copy > span,
      .staff-toolbar-button,
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
        color: #2A1A08;
        font-size: 0.82rem;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .toolbar-actions {
        gap: 0;
      }

      .home-page {
        gap: 12px;
        padding-top: 10px;
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
        box-shadow: 0 12px 28px rgba(92, 65, 28, 0.08);
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

    @media (max-width: 767px) {
      .visited-rail {
        grid-auto-columns: 178px;
      }

      .visited-card {
        width: 178px !important;
        min-width: 178px !important;
        height: 68px !important;
        min-height: 68px !important;
        grid-template-columns: 42px minmax(0, 1fr) 26px !important;
        grid-template-rows: auto auto auto !important;
        overflow: hidden;
        padding: 7px !important;
      }

      .visited-card img,
      .visited-fallback {
        width: 42px !important;
        height: 42px !important;
        aspect-ratio: 1 / 1 !important;
      }
    }

    @media (max-width: 599px) {
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
        position: sticky !important;
        top: calc(44px + var(--safe-top)) !important;
        z-index: 30 !important;
        display: block !important;
        margin-inline: 0;
        padding: 0 !important;
        border-radius: 18px !important;
        box-shadow: 0 12px 30px rgba(92, 65, 28, 0.14) !important;
      }
      .home-page .visited-rail {
        grid-auto-columns: calc((100vw - 38px) / 2) !important;
        padding-right: 0 !important;
      }
      .home-page .visited-card {
        width: 100% !important;
        min-width: 0 !important;
      }
      .home-page .home-search-wrap {
        position: relative;
        width: 100%;
        min-width: 0;
        margin-inline: 0;
      }
      .home-page .home-search-wrap ion-searchbar {
        width: 100% !important;
        min-height: 38px !important;
        padding-right: 0 !important;
        --padding-end: 112px !important;
        --background: #ffffff !important;
        --border-radius: 14px !important;
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
        width: 36px !important;
        min-width: 36px !important;
        height: 36px !important;
        min-height: 36px !important;
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

  `]
})
export class HomePage implements OnInit {
  readonly staffAppUrl = environment.staffAppUrl;
  readonly query = signal("");
  readonly activeQuery = signal("");
  readonly categoryFilter = signal("");
  readonly mobileHome = signal(this.isMobileViewport());
  readonly areaLabel = signal(localStorage.getItem("aura_customer_area_label") || "Current area");
  readonly currentLocation = signal<{ lat: number; lng: number } | null>(this.savedLocation());
  readonly locating = signal(false);
  readonly locationNotice = signal("");
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
      timeOutline
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

  openDiscoverPanel(panel: "filter" | "sort") {
    const intent = this.searchIntent(this.query().trim());
    return this.router.navigate(["/tabs/search"], {
      queryParams: {
        q: intent.query || undefined,
        mode: intent.mode,
        panel
      }
    });
  }

  openMapSearch() {
    const intent = this.searchIntent(this.query().trim());
    return this.router.navigate(["/tabs/search"], {
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

