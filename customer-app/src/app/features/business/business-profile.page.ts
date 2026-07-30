import { Component, OnDestroy, OnInit, computed, signal } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { ActivatedRoute, Router, RouterLink } from "@angular/router";
import { IonBackButton, IonButton, IonButtons, IonContent, IonHeader, IonIcon, IonToolbar } from "@ionic/angular/standalone";
import { addIcons } from "ionicons";
import {
  callOutline,
  bookmark,
  bookmarkOutline,
  cardOutline,
  checkmarkCircleOutline,
  clipboardOutline,
  closeCircleOutline,
  heart,
  heartOutline,
  locationOutline,
  navigateOutline,
  peopleOutline,
  pricetagOutline,
  ribbonOutline,
  searchOutline,
  shareOutline,
  sparklesOutline,
  starOutline,
  timeOutline,
  walletOutline
} from "ionicons/icons";
import { PublicOfferItem, ServiceItem } from "../../core/api.types";
import { CustomerFeedbackService } from "../../core/customer-feedback.service";
import { MarketplaceService } from "../../core/marketplace.service";
import { Subscription } from "rxjs";

@Component({
  standalone: true,
  imports: [FormsModule, RouterLink, IonBackButton, IonButton, IonButtons, IonContent, IonHeader, IonIcon, IonToolbar],
  template: `
    <ion-content>
      @if (business()) {
      <main class="profile-page">
        <section class="cover">
          <ion-back-button class="cover-back-button" defaultHref="/tabs/home"></ion-back-button>
          <img [src]="business().coverImage || business().galleryImages[0] || business().logoUrl || 'assets/icons/icon.svg'" [alt]="business().businessName + ' cover image'" />
          <div class="cover-overlay"></div>
          <div class="cover-actions">
            <ion-button fill="clear" shape="round" [class.saved-action]="isSaved()" [disabled]="favoritePending" [attr.aria-label]="isSaved() ? 'Remove from wishlist' : 'Save to wishlist'" (click)="toggleWishlist()">
              <ion-icon [name]="isSaved() ? 'heart' : 'heart-outline'"></ion-icon>
            </ion-button>
            <ion-button fill="clear" shape="round" [class.saved-action]="isSalonSaved()" [disabled]="savedSalonPending" [attr.aria-label]="isSalonSaved() ? 'Remove saved salon' : 'Save salon'" (click)="toggleSavedSalon()">
              <ion-icon [name]="isSalonSaved() ? 'bookmark' : 'bookmark-outline'"></ion-icon>
            </ion-button>
            <ion-button fill="clear" shape="round" aria-label="Share business"><ion-icon name="share-outline"></ion-icon></ion-button>
          </div>
          <div class="cover-copy">
            <div class="hero-business-name" role="heading" aria-level="1">{{ business().businessName }}</div>
            <p>{{ business().area }}, {{ business().city }}</p>
            <span class="hero-open-pill" [class.closed]="!business().isOpen">{{ business().isOpen ? "Open now" : "Closed now" }}</span>
          </div>
        </section>

        <section class="app-container profile-shell">
          <div class="main-column">
            <section class="intro premium-card">
              <div>
                <p class="eyebrow">{{ business().area }}, {{ business().city }}</p>
                <h2>{{ business().description }}</h2>
              </div>
              <div class="stat-grid">
                <span><strong>{{ business().ratingAverage }}</strong> {{ business().ratingCount }} reviews</span>
                <span><strong>{{ business().distanceKm }} km</strong> from you</span>
                <span><strong>{{ business().hoursLabel || business().nextAvailableSlot }}</strong> timing</span>
              </div>
              @if (isAuthenticated()) {
                <div class="primary-salon-strip">
                  @if (isPrimarySalon()) {
                    <div><strong>Your primary salon</strong><span>Quick access enabled</span></div>
                    <button type="button" class="primary-salon-action secondary" (click)="removeAsPrimary()">Change</button>
                  } @else {
                    <div><strong>Make this your primary salon</strong><span>Pin it for faster bookings and rewards</span></div>
                    <button type="button" class="primary-salon-action" (click)="setAsPrimary()">Set primary</button>
                  }
                </div>
              }
              <div class="trust-row">
                <span><ion-icon name="sparkles-outline"></ion-icon>{{ business().services.length }} services</span>
                <span><ion-icon name="people-outline"></ion-icon>{{ business().staff.length }} professionals</span>
                <span><ion-icon name="time-outline"></ion-icon>{{ business().hoursLabel || "Hours published" }}</span>
                <span><ion-icon name="card-outline"></ion-icon>{{ paymentLabel() }}</span>
              </div>
            </section>

            @if (otherBranches().length) {
            <section class="other-branches-section">
              <div class="section-heading">
                <div>
                  <h2 class="section-title">Other branches ({{ otherBranches().length }})</h2>
                  <p class="muted">More locations from this salon group</p>
                </div>
              </div>
              <div class="other-branches-rail" aria-label="Other branches from this salon group">
                @for (branch of otherBranches(); track branch.branchId || branch.id) {
                  <a class="branch-option" [routerLink]="['/business', branch.slug]">
                    <span class="branch-option-mark">{{ branch.businessName.slice(0, 1).toUpperCase() }}</span>
                    <span class="branch-option-copy">
                      <strong>{{ branch.businessName }}</strong>
                      <small>{{ branch.area || branch.city || 'Location details' }} · {{ branch.isOpen ? 'Open' : 'Closed' }}</small>
                    </span>
                    <ion-icon name="location-outline"></ion-icon>
                  </a>
                }
              </div>
            </section>
            }
            <section class="gallery-section">
              <div class="section-heading">
                <div>
                  <h2 class="section-title">Inside the studio</h2>
                </div>
              </div>
              <div class="gallery-strip">
                @for (image of business().galleryImages; track image) {
                  <img [src]="image" [alt]="business().businessName + ' gallery image'" loading="lazy" />
                } @empty {
                  <section class="state-card premium-card"><h2>No gallery available</h2></section>
                }
              </div>
            </section>

            <section class="services-section">
              <div class="section-heading">
                <div>
                  <h2 class="section-title">
                    @if (serviceQuery() || selectedCategory()) {
                      {{ filteredServices().length }} services
                    } @else {
                      {{ filteredServices().length }} services
                    }
                  </h2>
                </div>
                @if (serviceQuery() || selectedCategory()) {
                  <button type="button" class="clear-filter-text-btn" (click)="clearServiceFilters()">Show all</button>
                }
              </div>

              <div class="service-search-box">
                <ion-icon name="search-outline" class="search-icon" aria-hidden="true"></ion-icon>
                <input
                  type="text"
                  class="service-search-input"
                  [ngModel]="serviceQuery()"
                  (ngModelChange)="serviceQuery.set($event)"
                  placeholder="Search services in {{ business().businessName }}..."
                  aria-label="Search salon services" />
                @if (serviceQuery()) {
                  <button type="button" class="clear-search-btn" (click)="serviceQuery.set('')" aria-label="Clear search">
                    <ion-icon name="close-circle-outline" aria-hidden="true"></ion-icon>
                  </button>
                }
              </div>

              @if (availableCategories().length > 1) {
                <div class="category-pills-strip" role="tablist" aria-label="Service category filters">
                  <button
                    type="button"
                    class="category-pill"
                    [class.active]="!selectedCategory()"
                    (click)="selectedCategory.set('')">
                    All ({{ business().services.length }})
                  </button>
                  @for (cat of availableCategories(); track cat) {
                    <button
                      type="button"
                      class="category-pill"
                      [class.active]="selectedCategory() === cat"
                      (click)="selectedCategory.set(cat)">
                      {{ cat }}
                    </button>
                  }
                </div>
              }

              <div class="service-stack">
                @for (service of filteredServices(); track service.id) {
                  <article
                    class="salon-service-item"
                    [class.is-picked]="isServiceSelected(service.id)"
                    role="button"
                    tabindex="0"
                    (click)="openServicePopup(service.id)"
                    (keydown.enter)="openServicePopup(service.id)">
                    <div class="salon-service-copy">
                      @if (service.popular) {
                        <span class="offer-pill">Popular</span>
                      }
                      <h3>{{ service.name }}</h3>
                      <strong>{{ servicePriceLabel(service) }}</strong>
                      @if (service.description) {
                        <p class="service-description" [class.expanded]="expandedServiceId() === service.id">{{ service.description }}</p>
                        @if (isLongDescription(service.description)) {
                          <button type="button" class="service-more" (click)="$event.stopPropagation(); toggleDescription(service.id)">
                            {{ expandedServiceId() === service.id ? "Less" : "More" }}
                          </button>
                        }
                      }
                    </div>
                    <div class="salon-service-action">
                      <div class="salon-service-thumb" [style.background-image]="serviceImageBackground(service, $index)" role="img" [attr.aria-label]="service.name + ' service image'"></div>
                      <button
                        type="button"
                        class="salon-service-add"
                        [class.selected]="isServiceSelected(service.id)"
                        [attr.aria-label]="isServiceSelected(service.id) ? 'Remove service' : 'Add service'"
                        (click)="$event.stopPropagation(); openServicePopup(service.id)">
                        @if (isServiceSelected(service.id)) {
                          <ion-icon name="checkmark-circle-outline" aria-hidden="true"></ion-icon> Added
                        } @else {
                          Add
                        }
                      </button>
                    </div>
                  </article>
                } @empty {
                  <section class="state-card premium-card service-empty-card">
                    <div class="empty-icon"><ion-icon name="search-outline" aria-hidden="true"></ion-icon></div>
                    <h3>No services found</h3>
                    <p>No services match "{{ serviceQuery() }}"{{ selectedCategory() ? ' in ' + selectedCategory() : '' }}.</p>
                    <button type="button" class="primary-gradient reset-search-btn" (click)="clearServiceFilters()">Clear search</button>
                  </section>
                }
              </div>
            </section>

            @if (activeOffers().length > 0) {
            <section class="offers-section">
              <div class="section-heading">
                <div>
                  <h2 class="section-title">Offers & promotions</h2>
                </div>
              </div>
              <div class="offers-stack">
                @for (offer of activeOffers(); track offer.id) {
                  <article class="offer-card premium-card" [class.coupon-offer]="offer.type === 'coupon'" [class.rule-offer]="offer.type === 'discount_rule'" [class.promo-offer]="offer.type === 'calendar_promotion'">
                    <div class="offer-icon">
                      @if (offer.type === 'coupon') {
                        <ion-icon name="pricetag-outline"></ion-icon>
                      } @else if (offer.type === 'discount_rule') {
                        <ion-icon name="clipboard-outline"></ion-icon>
                      } @else {
                        <ion-icon name="time-outline"></ion-icon>
                      }
                    </div>
                    <div class="offer-body">
                      <strong>{{ offer.title }}</strong>
                      <span class="offer-summary">{{ offerSummary(offer) }}</span>
                      @if (offer.type === 'coupon') {
                        <code class="coupon-code">{{ offer.code }}</code>
                      }
                      @if (offerValidity(offer); as validity) {
                        <small class="offer-validity">Valid {{ validity.from }} – {{ validity.to }}</small>
                      }
                    </div>
                  </article>
                }
              </div>
            </section>
            }

            <section class="staff-section">
              <div class="section-heading">
                <div>
                  <h2 class="section-title">Choose your professional</h2>
                </div>
              </div>
              <div class="staff-grid">
                @for (staff of business().staff; track staff.id) {
                  <article class="staff-card premium-card">
                    <img [src]="staff.image || 'assets/icons/icon.svg'" [alt]="staff.name" />
                    <strong>{{ staff.name }}</strong>
                    <span>{{ staff.title }}</span>
                    <small>Star {{ staff.rating }} · {{ staff.specialty }}</small>
                    <em>{{ staff.nextAvailable }}</em>
                    <ion-button size="small" fill="outline" class="secondary-button" [routerLink]="['/business', business().slug, 'book']">Book with {{ staff.name.split(' ')[0] }}</ion-button>
                  </article>
                } @empty {
                  <section class="state-card premium-card"><h2>No staff available</h2></section>
                }
              </div>
            </section>

            <section class="review-section">
              <div class="section-heading">
                <div>
                  <h2 class="section-title">Loved by customers</h2>
                </div>
              </div>
              <div class="review-grid">
                @for (review of business().reviews; track review.id) {
                  <article class="review-card premium-card">
                    <span class="rating-pill">Star {{ review.rating }}</span>
                    <p>{{ review.text }}</p>
                    <strong>{{ review.author }}</strong>
                    <small>{{ review.dateLabel }}</small>
                  </article>
                } @empty {
                  <section class="state-card premium-card"><h2>No reviews yet</h2></section>
                }
              </div>
            </section>

            @if (isAuthenticated()) {
            <section class="loyalty-section">
              <div class="section-heading">
                <div>
                  <h2 class="section-title">Loyalty & rewards</h2>
                </div>
              </div>
              <div class="loyalty-grid">
                <a class="loyalty-card" routerLink="/tabs/wallet">
                  <ion-icon name="wallet-outline"></ion-icon>
                  <div>
                    <strong>Wallet</strong>
                    <span>View credits, balance, and payment history for this salon</span>
                  </div>
                </a>
                <a class="loyalty-card" routerLink="/tabs/rewards">
                  <ion-icon name="ribbon-outline"></ion-icon>
                  <div>
                    <strong>Rewards</strong>
                    <span>Loyalty points, referrals, and redemption options</span>
                  </div>
                </a>
                <a class="loyalty-card" routerLink="/tabs/memberships">
                  <ion-icon name="card-outline"></ion-icon>
                  <div>
                    <strong>Memberships</strong>
                    <span>Exclusive plans and benefits for regular customers</span>
                  </div>
                </a>
              </div>
            </section>
            }

            <section class="info-grid">
              <article class="premium-card info-card">
                <h2>Location</h2>
                <p><ion-icon name="location-outline"></ion-icon>{{ business().address }}</p>
                <div class="info-actions">
                  <ion-button size="small" fill="outline" class="secondary-button" [href]="business().mapsUrl || undefined" target="_blank">
                    <ion-icon name="navigate-outline" slot="start"></ion-icon>
                    Directions
                  </ion-button>
                  <ion-button size="small" fill="outline" class="secondary-button" [href]="phoneHref()">
                    <ion-icon name="call-outline" slot="start"></ion-icon>
                    Call
                  </ion-button>
                </div>
                <span class="muted">{{ business().area }}, {{ business().city }} {{ business().postalCode || "" }}</span>
              </article>
              <article class="premium-card info-card">
                <h2>Hours</h2>
                @for (day of business().businessHours; track day.day) {
                  <p class="hours-row"><strong>{{ day.label }}</strong><span>{{ day.display }}{{ day.note ? " · " + day.note : "" }}</span></p>
                } @empty {
                  <p class="muted">{{ business().hoursLabel || "Business hours have not been published yet." }}</p>
                }
              </article>
              <article class="premium-card info-card">
                <h2>Contact</h2>
                @if (business().phone || business().appointmentNumber || business().mobileNumber) {
                  <p><ion-icon name="call-outline"></ion-icon>{{ business().appointmentNumber || business().mobileNumber || business().phone }}</p>
                }
                @if (business().websiteUrl) {
                  <p><ion-icon name="navigate-outline"></ion-icon>{{ business().websiteUrl }}</p>
                }
                @if (business().instagramUrl) {
                  <p><ion-icon name="sparkles-outline"></ion-icon>{{ business().instagramUrl }}</p>
                }
              </article>
              <article class="premium-card info-card">
                <h2>Policies</h2>
                @for (policy of business().policies; track policy) {
                  <p>{{ policy }}</p>
                } @empty {
                  <p class="muted">No public policies have been published yet.</p>
                }
              </article>
            </section>
          </div>

          <aside class="booking-rail premium-card">
            <span class="rating-pill">Star {{ business().ratingAverage }}</span>
            @if (selectedServices().length) {
              <h2>{{ selectedServices().length }} service{{ selectedServices().length === 1 ? "" : "s" }} selected</h2>
              <p class="muted">{{ selectedServicesLabel() }}</p>
            } @else {
              <h2>Book {{ business().popularService || business().category }}</h2>
              <p class="muted">Starts from {{ money(business().startingPricePaise) }}. Next available {{ business().nextAvailableSlot || "after selecting a service" }}.</p>
            }
            @if (business().hasOffer) {
              <div class="rail-offer">{{ business().offerText }}</div>
            }
            <div class="rail-row"><span><ion-icon name="time-outline"></ion-icon> Next slot</span><strong>{{ business().nextAvailableSlot || "Check availability" }}</strong></div>
            <div class="rail-row"><span><ion-icon name="time-outline"></ion-icon> Hours</span><strong>{{ business().hoursLabel || "Published" }}</strong></div>
            <div class="rail-row"><span><ion-icon name="location-outline"></ion-icon> Area</span><strong>{{ business().area }}</strong></div>
            <div class="rail-row"><span><ion-icon name="card-outline"></ion-icon> Payment</span><strong>{{ paymentLabel() }}</strong></div>
            <ion-button expand="block" size="large" class="primary-gradient" [routerLink]="['/business', business().slug || business().id, 'book']" [queryParams]="bookingQueryParams()">Book now</ion-button>
          </aside>
        </section>
      </main>

      @if (selectedServices().length) {
      <div class="sticky-cta mobile-only">
        <div class="bottom-action-card">
          <div>
            @if (selectedServices().length) {
              <small class="selected-service-name">{{ selectedServices().length }} service{{ selectedServices().length === 1 ? "" : "s" }} selected</small>
              <strong>{{ selectedServicesLabel() }}</strong>
            } @else {
              <small>From {{ money(business().startingPricePaise) }}</small>
              <strong>{{ business().nextAvailableSlot || "Check availability" }}</strong>
            }
          </div>
          <ion-button class="primary-gradient" [routerLink]="['/business', business().slug || business().id, 'book']" [queryParams]="bookingQueryParams()">Book now</ion-button>
        </div>
      </div>
      }
      @if (activeCustomizationService(); as service) {
        <section class="service-popup-backdrop" role="dialog" aria-modal="true" aria-labelledby="service-popup-title" (click)="closeServicePopup()">
          <article class="service-popup-sheet" (click)="$event.stopPropagation()">
            <button type="button" class="service-popup-close" aria-label="Close service customisation" (click)="closeServicePopup()">×</button>
            <div class="service-popup-head">
              <div>
                <small>Customise service</small>
                <h2 id="service-popup-title">{{ service.name }}</h2>
                <strong>{{ servicePriceLabel(service) }}</strong>
              </div>
              <div class="service-popup-thumb" [style.background-image]="serviceImageBackground(service, 0)" aria-hidden="true"></div>
            </div>
            @if (serviceAddOns(service).length) {
              <div class="service-popup-section">
                <h3>Add-on services</h3>
                <div class="service-addon-list popup-list">
                  @for (addon of serviceAddOns(service); track addon.id || addon.name) {
                    <button type="button" class="service-addon-chip">
                      <span>{{ addon.name }}</span>
                      @if (addon.pricePaise) { <small>{{ money(addon.pricePaise) }}</small> }
                    </button>
                  }
                </div>
              </div>
            }
            <div class="service-popup-section">
              <h3>Note for salon</h3>
              <textarea
                class="service-note-input"
                rows="4"
                [ngModel]="serviceNote(service.id)"
                (ngModelChange)="setServiceNote(service.id, $event)"
                placeholder="Add preference, concern, or instruction for this service..."></textarea>
            </div>
            <button type="button" class="service-popup-add" (click)="confirmServiceAdd(service.id)">
              {{ isServiceSelected(service.id) ? "Update added service" : "Add service" }}
            </button>
          </article>
        </section>
      }
      } @else {
        <main class="page-narrow">
          @if (marketplace.loading()) {
            <section class="premium-card state-card"><h1>Loading business</h1></section>
          } @else {
            <section class="premium-card state-card error"><h1>Business unavailable</h1><p>{{ marketplace.error() || "The business profile could not be loaded." }}</p><ion-button class="primary-gradient" (click)="reload()">Retry</ion-button></section>
          }
        </main>
      }
    </ion-content>
  `,
  styles: [`
    .profile-page {
      padding-bottom: calc(100px + env(safe-area-inset-bottom));
    }

    .cover {
      position: relative;
      min-height: clamp(340px, 52vh, 520px);
      display: grid;
      align-items: end;
      overflow: hidden;
      border-radius: 0 0 40px 40px;
      background: var(--surface-soft);
    }

    .cover img,
    .cover-overlay {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
    }

    .cover img {
      object-fit: cover;
    }

    .cover-overlay {
      background: linear-gradient(180deg, rgba(24, 17, 31, 0.08), rgba(24, 17, 31, 0.72));
    }

    .cover-actions {
      position: absolute;
      top: calc(12px + env(safe-area-inset-top));
      right: 10px;
      z-index: 5;
      display: flex;
      gap: 2px;
      --background: transparent;
      --color: #0066ff;
    }

    .cover-actions ion-button {
      width: 36px;
      height: 36px;
      min-width: 36px;
      min-height: 36px;
      margin: 0;
      --padding-start: 0;
      --padding-end: 0;
      --background: transparent;
      --box-shadow: none;
    }

    .cover-copy {
      position: absolute;
      left: 20px;
      right: 20px;
      bottom: 18px;
      z-index: 2;
      display: grid;
      justify-items: start;
      gap: 6px;
      color: #ffffff;
    }

    .hero-open-pill {
      display: inline-flex;
      align-items: center;
      min-height: 24px;
      padding: 5px 10px;
      border: 1px solid rgba(16, 185, 129, 0.38);
      border-radius: 999px;
      color: #047857;
      background: #D1FAE5;
      font-size: 0.72rem;
      font-weight: 950;
      box-shadow: 0 8px 18px rgba(6, 23, 43, 0.12);
    }

    .hero-open-pill.closed {
      color: #991B1B;
      border-color: rgba(248, 113, 113, 0.36);
      background: #FEE2E2;
    }

    .hero-business-name {
      margin: 0;
      max-width: min(620px, 100%);
      color: #0B1F33;
      font-size: clamp(0.98rem, 4vw, 1.65rem);
      font-weight: 900;
      letter-spacing: -0.055em;
      line-height: 0.96;
      text-wrap: balance;
      text-shadow: 0 1px 0 rgba(255, 255, 255, 0.34);
    }

    .cover-copy p {
      margin: 0;
      color: rgba(11, 31, 51, 0.72);
      font-size: 0.82rem;
      font-weight: 900;
      letter-spacing: 0.04em;
      text-transform: uppercase;
    }

    .profile-shell {
      display: grid;
      gap: 22px;
      padding-top: 22px;
    }

    .main-column {
      display: grid;
      grid-template-columns: minmax(0, 1fr);
      gap: 4px;
      min-width: 0;
    }

    .main-column > *,
    .services-section,
    .service-stack {
      min-width: 0;
      max-width: 100%;
    }

    .services-section {
      overflow: hidden;
    }

    .cover-back-button {
      position: absolute;
      top: calc(2px + env(safe-area-inset-top));
      left: 2px;
      z-index: 5;
      width: 34px;
      height: 34px;
      min-width: 34px;
      min-height: 34px;
      margin: 0;
      --color: #0B1F33;
      --background: transparent;
      --box-shadow: none;
      --border-radius: 0;
      --padding-start: 0;
      --padding-end: 0;
      filter: drop-shadow(0 1px 2px rgba(255, 255, 255, 0.55));
    }

    .cover-back-button::part(native) {
      width: 34px;
      height: 34px;
      padding: 0;
      background: transparent;
      box-shadow: none;
    }

    .intro {
      display: grid;
      gap: 20px;
      padding: 22px;
    }

    .intro h2 {
      margin: 0;
      max-width: 760px;
      font-size: clamp(1.4rem, 3vw, 2.2rem);
      letter-spacing: -0.045em;
      line-height: 1.1;
    }

    .stat-grid {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 10px;
    }

    .stat-grid span {
      padding: 14px;
      border-radius: 18px;
      color: var(--muted);
      background: var(--surface-soft);
      font-weight: 800;
    }

    .stat-grid strong {
      display: block;
      color: var(--text);
      font-size: 1.02rem;
    }

    .primary-salon-strip {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding: 12px;
      border: 1px solid rgba(11, 70, 120, 0.14);
      border-radius: 16px;
      background: rgba(255, 255, 255, 0.76);
    }

    .primary-salon-strip div {
      display: grid;
      gap: 2px;
      min-width: 0;
    }

    .primary-salon-strip strong {
      color: var(--text);
      font-size: 0.9rem;
      font-weight: 950;
      line-height: 1.15;
    }

    .primary-salon-strip span {
      color: var(--muted);
      font-size: 0.75rem;
      font-weight: 800;
      line-height: 1.2;
    }

    .primary-salon-action {
      flex: 0 0 auto;
      min-height: 34px;
      padding: 0 12px;
      border: 0;
      border-radius: 999px;
      color: #FFFFFF;
      background: var(--primary);
      font-size: 0.76rem;
      font-weight: 950;
      cursor: pointer;
    }

    .primary-salon-action.secondary {
      color: var(--primary);
      border: 1px solid rgba(11, 70, 120, 0.22);
      background: #FFFFFF;
    }

    .trust-row {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }

    .trust-row span {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      min-height: 34px;
      padding: 7px 11px;
      border-radius: 999px;
      color: var(--primary);
      background: var(--pink-soft);
      font-weight: 900;
    }

    .gallery-strip {
      display: grid;
      grid-auto-flow: column;
      grid-auto-columns: minmax(220px, 320px);
      gap: 12px;
      overflow-x: auto;
      padding-bottom: 8px;
      scrollbar-width: none;
    }

    .gallery-strip::-webkit-scrollbar {
      display: none;
    }

    .service-search-box {
      position: relative;
      margin-bottom: 12px;
      display: flex;
      align-items: center;
    }

    .service-search-box .search-icon {
      position: absolute;
      left: 14px;
      color: var(--primary);
      font-size: 1.15rem;
      pointer-events: none;
    }

    .service-search-input {
      width: 100%;
      height: 46px;
      padding: 0 40px 0 42px;
      border: 1.5px solid var(--border);
      border-radius: 14px;
      outline: none;
      color: var(--text);
      background: var(--surface);
      font-size: 0.88rem;
      font-weight: 600;
      box-shadow: 0 2px 8px rgba(11, 70, 120, 0.04);
      transition: border-color 180ms ease, box-shadow 180ms ease;
    }

    .service-search-input:focus {
      border-color: var(--primary);
      box-shadow: 0 0 0 3.5px rgba(14, 165, 233, 0.15);
    }

    .clear-search-btn {
      position: absolute;
      right: 12px;
      background: transparent;
      border: 0;
      padding: 0;
      color: var(--muted);
      font-size: 1.25rem;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .clear-filter-text-btn {
      background: transparent;
      border: 0;
      color: var(--primary);
      font-size: 0.78rem;
      font-weight: 800;
      cursor: pointer;
      padding: 4px 8px;
    }

    .category-pills-strip {
      display: flex;
      gap: 8px;
      overflow-x: auto;
      padding-bottom: 10px;
      margin-bottom: 8px;
      scrollbar-width: none;
    }
    .category-pills-strip::-webkit-scrollbar { display: none; }

    .category-pill {
      flex: 0 0 auto;
      height: 32px;
      padding: 0 14px;
      border: 1px solid var(--border);
      border-radius: 999px;
      background: var(--surface);
      color: var(--muted);
      font-size: 0.75rem;
      font-weight: 750;
      cursor: pointer;
      transition: all 180ms ease;
    }

    .category-pill.active {
      border-color: var(--primary);
      background: var(--primary);
      color: #ffffff;
      box-shadow: 0 4px 12px rgba(11, 70, 120, 0.18);
    }

    .service-empty-card {
      text-align: center;
      padding: 28px 16px;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 8px;
    }

    .service-empty-card .empty-icon {
      width: 44px;
      height: 44px;
      border-radius: 14px;
      background: rgba(14, 165, 233, 0.1);
      color: var(--primary);
      display: grid;
      place-items: center;
      font-size: 1.2rem;
    }

    .reset-search-btn {
      margin-top: 6px;
      padding: 8px 16px;
      border: 0;
      border-radius: 999px;
      color: #fff;
      font-weight: 800;
      font-size: 0.78rem;
      cursor: pointer;
    }

    .salon-service-item {
      width: 100%;
      box-sizing: border-box;
      display: grid;
      grid-template-columns: minmax(0, 1fr) 112px;
      align-items: start;
      gap: 14px;
      min-height: 132px;
      padding: 16px;
      border: 1px solid rgba(11, 70, 120, 0.16);
      border-radius: 18px;
      color: var(--text);
      background: #FFFFFF;
      box-shadow: 0 8px 22px rgba(6, 23, 43, 0.07);
      text-align: left;
      cursor: pointer;
    }

    .service-custom-card {
      grid-column: 1 / -1;
      display: grid;
      gap: 10px;
      margin-top: 2px;
      padding: 12px;
      border: 1px solid rgba(11, 70, 120, 0.12);
      border-radius: 15px;
      background: rgba(246, 249, 252, 0.88);
    }

    .service-custom-card > strong {
      color: var(--text);
      font-size: 0.86rem;
      font-weight: 900;
    }

    .service-addon-list {
      display: flex;
      gap: 8px;
      overflow-x: auto;
      scrollbar-width: none;
    }

    .service-addon-list::-webkit-scrollbar { display: none; }

    .service-addon-chip {
      flex: 0 0 auto;
      min-height: 34px;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 0 11px;
      border: 1px solid rgba(11, 70, 120, 0.16);
      border-radius: 999px;
      color: var(--brand-800);
      background: #FFFFFF;
      font-size: 0.78rem;
      font-weight: 850;
    }

    .service-addon-chip small {
      color: var(--primary);
      font-weight: 900;
    }

    .service-note-input {
      width: 100%;
      resize: vertical;
      min-height: 118px;
      padding: 14px 13px;
      border: 1px solid rgba(11, 70, 120, 0.16);
      border-radius: 12px;
      outline: none;
      color: var(--text);
      background: #FFFFFF;
      font: inherit;
      font-size: 0.84rem;
      line-height: 1.35;
    }

    .service-note-input::placeholder {
      color: rgba(82, 101, 121, 0.62);
    }

    .service-note-input:focus {
      border-color: rgba(11, 70, 120, 0.42);
      box-shadow: 0 0 0 3px rgba(11, 70, 120, 0.1);
    }

    .service-popup-backdrop {
      position: fixed;
      inset: 0;
      z-index: 1000;
      display: grid;
      align-items: center;
      justify-items: center;
      padding: 16px;
      background: rgba(6, 23, 43, 0.42);
      backdrop-filter: blur(8px);
    }

    .service-popup-sheet {
      position: relative;
      width: min(420px, 100%);
      max-height: min(86vh, 720px);
      margin: 0;
      display: grid;
      gap: 18px;
      overflow: auto;
      padding: 24px 18px 18px;
      border-radius: 26px;
      background: #FFFFFF;
      box-shadow: 0 24px 70px rgba(6, 23, 43, 0.28);
    }

    .service-popup-close {
      position: absolute;
      top: 16px;
      right: 16px;
      width: 34px;
      min-width: 34px;
      height: 34px;
      min-height: 34px;
      border: 0;
      border-radius: 999px;
      color: var(--text);
      background: var(--surface-soft);
      font-size: 1.35rem;
      line-height: 1;
      cursor: pointer;
    }

    .service-popup-head {
      display: grid;
      grid-template-columns: minmax(0, 1fr) 106px;
      gap: 14px;
      align-items: start;
      padding-top: 34px;
    }

    .service-popup-head small {
      color: var(--muted);
      font-size: 0.76rem;
      font-weight: 900;
      text-transform: uppercase;
      letter-spacing: 0.08em;
    }

    .service-popup-head h2 {
      margin: 5px 0 6px;
      color: var(--text);
      font-size: 1.35rem;
      line-height: 1.08;
      letter-spacing: -0.04em;
    }

    .service-popup-head strong {
      color: var(--primary);
      font-weight: 950;
    }

    .service-popup-thumb {
      width: 106px;
      height: 92px;
      border-radius: 20px;
      background-color: #E7F0F8;
      background-position: center;
      background-size: cover;
      box-shadow: 0 12px 28px rgba(6, 23, 43, 0.1);
    }

    .service-popup-section {
      display: grid;
      gap: 10px;
    }

    .service-popup-section h3 {
      margin: 0;
      font-size: 0.95rem;
      letter-spacing: -0.02em;
    }

    .service-addon-list.popup-list {
      flex-wrap: wrap;
      overflow: visible;
    }

    .service-popup-add {
      min-height: 48px;
      border: 0;
      border-radius: 16px;
      color: #FFFFFF;
      background: var(--primary);
      font-size: 0.98rem;
      font-weight: 950;
      cursor: pointer;
      box-shadow: 0 14px 30px rgba(11, 70, 120, 0.22);
    }

    .salon-service-item.is-picked {
      border-color: rgba(16, 185, 129, 0.34);
      background: linear-gradient(145deg, rgba(240, 253, 244, 0.98), #FFFFFF 54%);
    }

    .salon-service-copy {
      display: grid;
      align-content: start;
      gap: 7px;
      min-width: 0;
    }

    .salon-service-copy h3 {
      margin: 0;
      color: var(--text);
      font-size: 1rem;
      font-weight: 850;
      line-height: 1.18;
      overflow-wrap: anywhere;
    }

    .service-description {
      display: -webkit-box;
      margin: 0;
      overflow: hidden;
      color: var(--muted);
      font-size: 0.84rem;
      line-height: 1.35;
      -webkit-line-clamp: 3;
      -webkit-box-orient: vertical;
    }

    .service-description.expanded {
      -webkit-line-clamp: 5;
    }

    .service-more {
      justify-self: start;
      min-width: 0;
      min-height: 0;
      padding: 0;
      border: 0;
      color: var(--primary);
      background: transparent;
      font-size: 0.78rem;
      font-weight: 900;
      cursor: pointer;
    }

    .salon-service-copy strong {
      color: var(--primary);
      font-size: 0.9rem;
      font-weight: 900;
    }

    .salon-service-action {
      width: 112px;
      display: grid;
      justify-items: center;
      gap: 0;
      visibility: visible;
      opacity: 1;
    }

    .salon-service-thumb {
      width: 112px;
      height: 92px;
      display: block;
      border-radius: 18px;
      background-color: #E7F0F8;
      background-position: center;
      background-size: cover;
      background-repeat: no-repeat;
      box-shadow: 0 12px 28px rgba(6, 23, 43, 0.1);
      visibility: visible;
      opacity: 1;
    }

    .salon-service-add {
      min-width: 76px;
      min-height: 34px;
      margin-top: -15px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 4px;
      padding: 0 14px;
      border: 1px solid rgba(11, 70, 120, 0.18);
      border-radius: 12px;
      color: var(--primary);
      background: #FFFFFF;
      font-size: 0.86rem;
      font-weight: 950;
      cursor: pointer;
      box-shadow: 0 10px 20px rgba(6, 23, 43, 0.1);
      visibility: visible;
      opacity: 1;
      z-index: 2;
      transition: color 180ms ease, background 180ms ease, border-color 180ms ease, transform 180ms ease, box-shadow 180ms ease;
    }

    .salon-service-add.selected {
      color: #047857;
      border-color: rgba(16, 185, 129, 0.32);
      background: #D1FAE5;
      box-shadow: none;
    }

    .staff-card img {
      width: 74px;
      height: 74px;
      margin-bottom: 6px;
      border-radius: 24px;
      object-fit: cover;
    }

    .staff-card span,
    .staff-card small,
    .staff-card em {
      color: var(--muted);
      font-style: normal;
      line-height: 1.35;
    }

    .staff-card em {
      color: var(--primary-2);
      font-weight: 900;
    }

    .staff-card ion-button {
      margin-top: 6px;
    }

    .review-card {
      padding: 18px;
    }

    .review-card p {
      margin: 14px 0;
      color: var(--text);
      line-height: 1.5;
    }

    .review-card small {
      display: block;
      margin-top: 3px;
      color: var(--muted);
    }

    .info-card {
      padding: 18px;
    }

    .info-card h2 {
      margin: 0 0 12px;
      letter-spacing: -0.04em;
    }

    .info-card p {
      display: flex;
      align-items: flex-start;
      gap: 8px;
      margin: 0 0 10px;
      color: var(--text);
      line-height: 1.5;
    }

    .info-actions {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin: 12px 0;
    }

    .hours-row {
      justify-content: space-between;
    }

    .hours-row span {
      color: var(--muted);
      font-weight: 800;
      text-align: right;
    }

    .booking-rail {
      display: none;
      align-self: start;
      padding: 20px;
      position: sticky;
      top: 102px;
    }

    .booking-rail h2 {
      margin: 14px 0 8px;
      font-size: 1.45rem;
      letter-spacing: -0.04em;
    }

    .rail-offer {
      margin: 16px 0;
      padding: 13px;
      border-radius: 18px;
      color: #EF4444;
      background: #FDF2F8;
      font-weight: 900;
    }

    .rail-row {
      display: flex;
      justify-content: space-between;
      gap: 14px;
      padding: 13px 0;
      border-top: 1px solid var(--border);
    }

    .rail-row span {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      color: var(--muted);
      font-weight: 800;
    }

    .rail-row strong {
      text-align: right;
    }

    .booking-rail ion-button {
      margin-top: 18px;
    }

    .state-card {
      padding: 24px;
    }

    .state-card h1 {
      margin: 0 0 8px;
      letter-spacing: -0.05em;
    }

    .state-card.error p {
      color: #EF4444;
    }

    .offers-stack {
      display: grid;
      gap: 10px;
    }

    .offer-card {
      display: grid;
      grid-template-columns: auto 1fr;
      gap: 14px;
      align-items: start;
      padding: 16px;
    }

    .offer-icon {
      display: grid;
      place-items: center;
      width: 40px;
      height: 40px;
      border-radius: 14px;
      background: var(--surface-soft);
    }

    .offer-icon ion-icon {
      font-size: 1.15rem;
      color: var(--primary);
    }

    .coupon-offer .offer-icon {
      background: linear-gradient(135deg, rgba(11, 70, 120, 0.12), rgba(7, 90, 156, 0.08));
    }

    .coupon-offer .offer-icon ion-icon {
      color: var(--primary);
    }

    .promo-offer .offer-icon {
      background: linear-gradient(135deg, rgba(245, 158, 11, 0.12), rgba(239, 68, 68, 0.08));
    }

    .promo-offer .offer-icon ion-icon {
      color: #F59E0B;
    }

    .offer-body {
      display: grid;
      gap: 3px;
    }

    .offer-body strong {
      font-size: 0.92rem;
      letter-spacing: -0.02em;
    }

    .offer-summary {
      color: var(--muted);
      font-size: 0.82rem;
      line-height: 1.4;
    }

    .coupon-code {
      display: inline-block;
      margin-top: 4px;
      padding: 4px 10px;
      border-radius: 8px;
      background: var(--surface-soft);
      color: var(--primary-2);
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 0.8rem;
      font-weight: 700;
      letter-spacing: 0.06em;
      width: fit-content;
    }

    .offer-validity {
      margin-top: 2px;
      color: var(--muted);
      font-size: 0.72rem;
    }

    .loyalty-grid {
      display: grid;
      gap: 12px;
    }

    .loyalty-card {
      display: grid;
      grid-template-columns: auto minmax(0, 1fr) auto;
      align-items: center;
      gap: 14px;
      padding: 18px;
      border-radius: 20px;
      background: var(--surface);
      border: 1px solid var(--border);
      text-decoration: none;
      color: inherit;
      cursor: pointer;
      transition: border-color 0.25s ease, box-shadow 0.25s ease;
    }

    .loyalty-card:hover,
    .loyalty-card:focus-visible {
      border-color: var(--primary);
      box-shadow: 0 0 0 1px var(--primary);
    }

    .loyalty-card.primary-card {
      background: linear-gradient(135deg, rgba(11, 70, 120, 0.1), rgba(7, 90, 156, 0.06));
      border-color: rgba(11, 70, 120, 0.25);
    }

    .loyalty-card ion-icon {
      font-size: 1.5rem;
      color: var(--primary);
    }

    .loyalty-card div {
      min-width: 0;
    }

    .loyalty-card strong {
      display: block;
      margin: 0;
      font-size: 0.95rem;
      letter-spacing: -0.02em;
    }

    .loyalty-card span {
      display: block;
      margin: 2px 0 0;
      color: var(--muted);
      font-size: 0.8rem;
      line-height: 1.4;
    }

    .loyalty-card ion-button {
      --padding-start: 12px;
      --padding-end: 12px;
    }

    .loyalty-section {
      margin-top: 4px;
    }

    @media (max-width: 599px) {
      .loyalty-grid {
        gap: 8px;
      }

      .loyalty-card {
        grid-template-columns: auto minmax(0, 1fr);
        gap: 10px;
        padding: 14px;
        border-radius: 16px;
      }

      .loyalty-card ion-button:last-child {
        grid-column: 1 / -1;
        justify-self: start;
      }

      .offer-card {
        gap: 10px;
        padding: 12px;
        border-radius: 16px;
      }

      .offer-icon {
        width: 34px;
        height: 34px;
        border-radius: 11px;
      }
    }

    @media (max-width: 599px) {
      .profile-page {
        padding-bottom: calc(82px + env(safe-area-inset-bottom));
      }

      .cover {
        min-height: 190px;
        border-radius: 0 0 22px 22px;
      }

      .cover-actions {
        top: 8px;
        right: 8px;
      }

      .cover-actions ion-button:last-child,
      .intro h2,
      .trust-row,
      .staff-section,
      .review-section,
      .info-grid {
        display: none;
      }

      .cover-copy {
        left: 18px;
        right: 18px;
        bottom: 16px;
      }

      .hero-business-name {
        margin: 0;
        max-width: calc(100% - 34px);
        font-size: 0.88rem;
        line-height: 0.96;
      }

      .cover-copy p {
        font-size: 0.72rem;
      }

      .hero-open-pill {
        min-height: 22px;
        padding: 4px 9px;
        font-size: 0.68rem;
      }

      .status-pill {
        min-height: 26px;
        padding: 5px 9px;
        font-size: 0.72rem;
      }

      .profile-shell {
        gap: 10px;
        padding-top: 10px;
      }

      .main-column {
        gap: 10px;
      }

      .intro {
        gap: 7px;
        padding: 9px 10px;
        border-radius: 16px;
      }

      .intro .eyebrow {
        margin-bottom: 0;
        font-size: 0.72rem;
      }

      .stat-grid {
        grid-template-columns: 1fr;
      }

      .stat-grid {
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 6px;
      }

      .stat-grid span {
        height: 46px;
        display: grid;
        align-content: center;
        overflow: hidden;
        padding: 4px 5px;
        border-radius: 11px;
        font-size: 0.58rem;
        line-height: 1;
        text-align: center;
      }

      .stat-grid strong {
        font-size: 0.68rem;
        line-height: 1;
      }

      .section-heading {
        margin-top: 0;
      }

      .section-title {
        font-size: 1.08rem;
      }

      .service-stack {
        gap: 8px;
      }

      .salon-service-item {
        grid-template-columns: minmax(0, 1fr) 98px;
        min-height: 128px;
        padding: 13px;
        border-radius: 16px;
      }

      .salon-service-action {
        width: 98px;
      }

      .salon-service-thumb {
        width: 98px;
        height: 82px;
        border-radius: 16px;
      }

      .salon-service-add {
        min-width: 70px;
        min-height: 32px;
        margin-top: -14px;
        font-size: 0.8rem;
      }

      .salon-service-copy h3 {
        font-size: 0.95rem;
      }

      .salon-service-copy strong {
        font-size: 0.82rem;
      }

      .salon-service-item ion-button {
        width: 100%;
        min-height: 38px;
      }

      .bottom-action-card {
        padding: 8px 10px;
        border-radius: 18px;
      }

      .sticky-cta {
        bottom: calc(8px + env(safe-area-inset-bottom)) !important;
      }
    }

    .other-branches-section {
      display: grid;
      gap: 12px;
    }

    .other-branches-rail {
      display: flex;
      gap: 9px;
      overflow-x: auto;
      padding: 2px 1px 7px;
      scrollbar-width: none;
      scroll-snap-type: x proximity;
    }

    .other-branches-rail::-webkit-scrollbar {
      display: none;
    }

    .branch-option {
      display: grid;
      grid-template-columns: 34px minmax(0, 1fr) auto;
      align-items: center;
      gap: 8px;
      flex: 0 0 min(230px, 76vw);
      min-height: 58px;
      padding: 8px 10px;
      border: 1px solid var(--border);
      border-radius: 15px;
      color: var(--text);
      background: rgba(255, 255, 255, 0.82);
      box-shadow: 0 7px 18px rgba(6, 23, 43, 0.07);
      text-decoration: none;
      scroll-snap-align: start;
    }

    .branch-option-mark {
      width: 34px;
      height: 34px;
      display: grid;
      place-items: center;
      border-radius: 11px;
      color: #704812;
      background: rgba(11, 70, 120, 0.14);
      font-size: 0.82rem;
      font-weight: 950;
    }

    .branch-option-copy {
      display: grid;
      gap: 3px;
      min-width: 0;
    }

    .branch-option-copy strong,
    .branch-option-copy small {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .branch-option-copy strong {
      font-size: 0.8rem;
    }

    .branch-option-copy small {
      color: var(--muted);
      font-size: 0.68rem;
      font-weight: 800;
    }

    .branch-option > ion-icon {
      color: #a36d16;
      font-size: 0.95rem;
    }

    @media (min-width: 768px) {
      .staff-grid,
      .review-grid,
      .info-grid,
      .review-grid,
      .info-grid {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }
    }

    @media (min-width: 1024px) {
      .profile-page {
        padding-bottom: 40px;
      }

      .profile-shell {
        grid-template-columns: minmax(0, 1fr) 330px;
        align-items: start;
      }

      .booking-rail {
        display: block;
      }
      .mobile-only {
        display: none;
      }
    }
  `]
})
export class BusinessProfilePage implements OnInit, OnDestroy {
  private readonly slug = signal(this.route.snapshot.paramMap.get("slug"));
  readonly selectedServiceIds = signal<string[]>(this.initialServiceIds());
  readonly expandedServiceId = signal<string>("");
  readonly activeCustomizationServiceId = signal<string>("");
  readonly serviceNotes = signal<Record<string, string>>({});
  readonly serviceQuery = signal<string>("");
  readonly selectedCategory = signal<string>("");

  readonly business = computed(() => this.marketplace.findBusiness(this.slug())!);
  readonly isAuthenticated = computed(() => this.marketplace.isAuthenticated());
  readonly isPrimarySalon = computed(() => {
    const biz = this.business();
    const primary = this.marketplace.primarySalon();
    if (!biz || !primary) return false;
    return primary.branchId === biz.branchId || primary.businessId === biz.id;
  });
  readonly activeOffers = computed(() => this.marketplace.salonOffers()?.offers ?? []);
  readonly selectedService = computed(() => {
    const id = this.selectedServiceIds()[0] ?? "";
    if (!id) return null;
    return this.business()?.services.find((s) => s.id === id) || null;
  });
  readonly selectedServices = computed(() => {
    const ids = new Set(this.selectedServiceIds());
    return this.business()?.services.filter((service) => ids.has(service.id)) ?? [];
  });
  readonly activeCustomizationService = computed(() => {
    const serviceId = this.activeCustomizationServiceId();
    if (!serviceId) return null;
    return this.business()?.services.find((service) => service.id === serviceId) ?? null;
  });

  readonly availableCategories = computed(() => {
    const biz = this.business();
    if (!biz?.services) return [];
    const cats = biz.services.map((s) => s.category).filter((c): c is string => Boolean(c));
    return Array.from(new Set(cats));
  });

  readonly filteredServices = computed(() => {
    const biz = this.business();
    if (!biz?.services) return [];
    const q = this.serviceQuery().trim().toLowerCase();
    const cat = this.selectedCategory();

    return biz.services.filter((service) => {
      const matchCat = !cat || service.category === cat;
      const matchQ = !q || service.name.toLowerCase().includes(q) || (service.description && service.description.toLowerCase().includes(q));
      return matchCat && matchQ;
    });
  });

  clearServiceFilters() {
    this.serviceQuery.set("");
    this.selectedCategory.set("");
  }

  readonly otherBranches = computed(() => {
    const current = this.business();
    if (!current?.tenantId) return [];
    const seen = new Set<string>();
    return this.marketplace.businesses().filter((branch) => {
      if (branch.tenantId !== current.tenantId) return false;
      if (branch.id === current.id || branch.slug === current.slug || (current.branchId && branch.branchId === current.branchId)) return false;
      const key = branch.branchId || branch.id || branch.slug;
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  });
  private routeSubscription?: Subscription;
  favoritePending = false;
  savedSalonPending = false;

  private initialServiceIds(): string[] {
    const multi = this.route.snapshot.queryParamMap.get("serviceIds");
    if (multi) return Array.from(new Set(multi.split(",").map((id) => id.trim()).filter(Boolean)));
    const single = this.route.snapshot.queryParamMap.get("serviceId");
    return single ? [single] : [];
  }

  constructor(private readonly route: ActivatedRoute, private readonly router: Router, readonly marketplace: MarketplaceService, private readonly feedback: CustomerFeedbackService) {
    addIcons({
      callOutline,
      bookmark,
      bookmarkOutline,
      cardOutline,
      checkmarkCircleOutline,
      clipboardOutline,
      closeCircleOutline,
      heart,
      heartOutline,
      locationOutline,
      navigateOutline,
      peopleOutline,
      pricetagOutline,
      ribbonOutline,
      searchOutline,
      shareOutline,
      sparklesOutline,
      starOutline,
      timeOutline,
      walletOutline
    });
  }

  ngOnInit() {
    this.routeSubscription = this.route.paramMap.subscribe((params) => {
      this.slug.set(params.get("slug"));
      this.reload();
    });
    const paramServiceId = this.route.snapshot.queryParamMap.get("serviceId");
    if (paramServiceId) {
      this.selectedServiceIds.set([paramServiceId]);
    }
    void this.marketplace.ensureFavorites().catch(() => undefined);
    void this.marketplace.ensureSavedSalons().catch(() => undefined);
  }

  selectService(serviceId: string) {
    this.selectedServiceIds.update((ids) => ids.includes(serviceId) ? ids.filter((id) => id !== serviceId) : [...ids, serviceId]);
  }

  openServicePopup(serviceId: string) {
    this.activeCustomizationServiceId.set(serviceId);
  }

  closeServicePopup() {
    this.activeCustomizationServiceId.set("");
  }

  confirmServiceAdd(serviceId: string) {
    if (!this.isServiceSelected(serviceId)) {
      this.selectedServiceIds.update((ids) => [...ids, serviceId]);
    }
    this.closeServicePopup();
  }

  isServiceSelected(serviceId: string): boolean {
    return this.selectedServiceIds().includes(serviceId);
  }

  selectedServicesLabel(): string {
    const services = this.selectedServices();
    const total = services.reduce((sum, service) => sum + service.pricePaise, 0);
    const minutes = services.reduce((sum, service) => sum + service.durationMinutes, 0);
    return minutes > 0 ? `${this.money(total)} · ${minutes} min` : this.money(total);
  }

  servicePriceLabel(service: ServiceItem): string {
    return service.durationMinutes > 0 ? `${this.money(service.pricePaise)} · ${service.durationMinutes} min` : this.money(service.pricePaise);
  }

  isLongDescription(description: string): boolean {
    return description.trim().length > 96;
  }

  toggleDescription(serviceId: string) {
    this.expandedServiceId.update((current) => current === serviceId ? "" : serviceId);
  }

  serviceAddOns(service: ServiceItem): { id?: string; name: string; pricePaise?: number }[] {
    const withAddOns = service as ServiceItem & { addOns?: { id?: string; name: string; pricePaise?: number }[]; addons?: { id?: string; name: string; pricePaise?: number }[] };
    return (withAddOns.addOns || withAddOns.addons || []).slice(0, 3);
  }

  serviceNote(serviceId: string): string {
    return this.serviceNotes()[serviceId] || "";
  }

  setServiceNote(serviceId: string, note: string) {
    this.serviceNotes.update((notes) => ({ ...notes, [serviceId]: note }));
  }

  bookingQueryParams(): { serviceIds?: string; serviceId?: string; step: number } {
    const ids = this.selectedServiceIds();
    if (ids.length > 1) return { serviceIds: ids.join(","), step: 2 };
    if (ids.length === 1) return { serviceId: ids[0], step: 2 };
    return { step: 2 };
  }

  serviceImage(service: ServiceItem, index: number): string {
    const withImage = service as ServiceItem & { image?: string; imageUrl?: string; photoUrl?: string; thumbnailUrl?: string };
    return withImage.image || withImage.imageUrl || withImage.photoUrl || withImage.thumbnailUrl || this.business()?.galleryImages[index % Math.max(this.business()?.galleryImages.length || 1, 1)] || this.business()?.coverImage || this.business()?.logoUrl || "assets/icons/icon.svg";
  }

  serviceImageBackground(service: ServiceItem, index: number): string {
    return `linear-gradient(135deg, rgba(231, 240, 248, 0.2), rgba(255, 255, 255, 0.18)), url("${this.serviceImage(service, index)}")`;
  }

  ngOnDestroy() {
    this.routeSubscription?.unsubscribe();
  }

  reload() {
    const slug = this.slug();
    if (slug) {
      void Promise.all([
        this.marketplace.loadBusiness(slug),
        this.marketplace.loadPublicBusinesses()
      ]).then(() => this.loadOffers()).catch(() => undefined);
    }
  }

  private loadOffers() {
    const biz = this.business();
    if (biz?.tenantId && biz?.branchId) {
      void this.marketplace.loadSalonOffers(biz.tenantId, biz.branchId).catch(() => undefined);
    }
  }

  money(pricePaise: number): string {
    return this.marketplace.formatMoney(pricePaise);
  }

  paymentLabel(): string {
    const modes = this.business()?.paymentModes ?? [];
    if (modes.includes("online") && modes.includes("pay_at_venue")) return "Online or venue";
    if (modes.includes("online")) return "Online ready";
    return "Pay at venue";
  }

  phoneHref(): string | undefined {
    const phone = this.business()?.appointmentNumber || this.business()?.mobileNumber || this.business()?.phone || "";
    return phone ? `tel:${phone}` : undefined;
  }

  isSaved(): boolean {
    const business = this.business();
    return business ? this.marketplace.isFavorite(business.id) || this.marketplace.isFavorite(business.slug) : false;
  }

  async toggleWishlist() {
    const business = this.business();
    if (!business || this.favoritePending) return;
    if (!this.marketplace.isAuthenticated()) {
      void this.router.navigate(["/login"], { queryParams: { returnUrl: this.router.url } });
      return;
    }
    this.favoritePending = true;
    try {
      const saved = await this.marketplace.toggleFavorite(business.id);
      await this.feedback.success(saved ? "Added to favorites / wishlist" : "Removed from favorites / wishlist");
    } catch {
      await this.feedback.error(this.marketplace.error() || "Could not update favorites. Please try again.");
    } finally {
      this.favoritePending = false;
    }
  }

  isSalonSaved(): boolean {
    const business = this.business();
    return business ? this.marketplace.isSalonSaved(business.id) : false;
  }

  async toggleSavedSalon() {
    const business = this.business();
    if (!business || this.savedSalonPending) return;
    if (!this.marketplace.isAuthenticated()) {
      void this.router.navigate(["/login"], { queryParams: { returnUrl: this.router.url } });
      return;
    }
    this.savedSalonPending = true;
    try {
      const saved = await this.marketplace.toggleSavedSalon(business.id);
      await this.feedback.success(saved ? "Added to saved salons" : "Removed from saved salons");
    } catch {
      await this.feedback.error(this.marketplace.error() || "Could not update saved salons. Please try again.");
    } finally {
      this.savedSalonPending = false;
    }
  }

  async setAsPrimary() {
    const biz = this.business();
    if (!biz) return;
    if (!biz.tenantId || !biz.branchId) {
      await this.feedback.error("This salon cannot be set as primary yet. Missing salon branch details.");
      return;
    }
    if (!this.isAuthenticated()) {
      void this.router.navigate(["/login"], { queryParams: { returnUrl: this.router.url } });
      return;
    }
    try {
      await this.marketplace.setPrimarySalon(biz.tenantId, biz.branchId, biz.id, biz.businessName);
      await this.feedback.success("Primary salon updated");
    } catch {
      await this.feedback.error(this.marketplace.error() || "Could not set primary salon. Please try again.");
    }
  }

  async removeAsPrimary() {
    try {
      await this.marketplace.removePrimarySalon();
      await this.feedback.success("Primary salon removed");
    } catch {
      await this.feedback.error(this.marketplace.error() || "Could not update primary salon. Please try again.");
    }
  }

  offerSummary(offer: PublicOfferItem): string {
    if ("discountSummary" in offer) return offer.discountSummary || offer.description;
    return offer.description;
  }

  offerValidity(offer: PublicOfferItem): { from: string; to: string } | null {
    if ("validFrom" in offer) return { from: offer.validFrom, to: offer.validTo };
    if ("startDate" in offer) return { from: offer.startDate, to: offer.endDate };
    return null;
  }
}
