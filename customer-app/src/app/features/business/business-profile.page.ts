import { Component, OnDestroy, OnInit, computed, signal } from "@angular/core";
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
  heart,
  heartOutline,
  locationOutline,
  navigateOutline,
  peopleOutline,
  pricetagOutline,
  ribbonOutline,
  shareOutline,
  sparklesOutline,
  starOutline,
  timeOutline,
  walletOutline
} from "ionicons/icons";
import { PublicOfferItem } from "../../core/api.types";
import { CustomerFeedbackService } from "../../core/customer-feedback.service";
import { MarketplaceService } from "../../core/marketplace.service";
import { Subscription } from "rxjs";

@Component({
  standalone: true,
  imports: [RouterLink, IonBackButton, IonButton, IonButtons, IonContent, IonHeader, IonIcon, IonToolbar],
  template: `
    <ion-header class="ion-no-border">
      <ion-toolbar>
        <ion-buttons slot="start"><ion-back-button defaultHref="/tabs/home"></ion-back-button></ion-buttons>
      </ion-toolbar>
    </ion-header>

    <ion-content>
      @if (business()) {
      <main class="profile-page">
        <section class="cover">
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
          <div class="cover-copy app-container">
            <span class="status-pill" [class.closed]="!business().isOpen">{{ business().isOpen ? "Open now" : "Closed now" }}</span>
            <h1>{{ business().businessName }}</h1>
            <p>{{ business().category }} · {{ business().hoursLabel || "Business hours available" }}</p>
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
                  <h2 class="section-title">{{ business().services.length }} services available</h2>
                </div>
              </div>
              <div class="service-stack">
                @for (service of business().services; track service.id) {
                  <article
                    class="service-card premium-card"
                    [class.selected]="selectedServiceId() === service.id"
                    (click)="selectService(service.id)">
                    <div class="service-details">
                      <div class="service-title-row">
                        <h3>{{ service.name }}</h3>
                        @if (service.popular) { <span class="offer-pill">Popular</span> }
                      </div>
                      @if (service.description) {
                        <p class="muted">{{ service.description }}</p>
                      }
                      <strong>{{ money(service.pricePaise) }} · {{ service.durationMinutes }} min</strong>
                    </div>
                    <button
                      type="button"
                      class="service-select-btn"
                      [class.selected]="selectedServiceId() === service.id"
                      (click)="$event.stopPropagation(); selectService(service.id)">
                      @if (selectedServiceId() === service.id) {
                        <ion-icon name="checkmark-circle-outline" aria-hidden="true"></ion-icon> Selected
                      } @else {
                        + Select
                      }
                    </button>
                  </article>
                } @empty {
                  <section class="state-card premium-card"><h2>No services available</h2></section>
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
                @if (isPrimarySalon()) {
                  <article class="loyalty-card primary-card">
                    <ion-icon name="star-outline"></ion-icon>
                    <div>
                      <strong>Your primary salon</strong>
                      <span>Quick access to bookings, wallet, and rewards for this salon</span>
                    </div>
                    <ion-button size="small" fill="outline" class="secondary-button" (click)="removeAsPrimary()">Change</ion-button>
                  </article>
                } @else {
                  <article class="loyalty-card">
                    <ion-icon name="star-outline"></ion-icon>
                    <div>
                      <strong>Set as your primary salon</strong>
                      <span>Get quick access to booking, wallet, and loyalty rewards</span>
                    </div>
                    <ion-button size="small" class="primary-gradient" (click)="setAsPrimary()">Set primary</ion-button>
                  </article>
                }
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
            @if (selectedService(); as service) {
              <h2>{{ service.name }}</h2>
              <p class="muted">{{ money(service.pricePaise) }} · {{ service.durationMinutes }} minutes</p>
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
            <ion-button expand="block" size="large" class="primary-gradient" [routerLink]="['/business', business().slug || business().id, 'book']" [queryParams]="selectedServiceId() ? { serviceId: selectedServiceId() } : null">Book now</ion-button>
          </aside>
        </section>
      </main>

      <div class="sticky-cta mobile-only">
        <div class="bottom-action-card">
          <div>
            @if (selectedService(); as service) {
              <small class="selected-service-name">{{ service.name }}</small>
              <strong>{{ money(service.pricePaise) }} · {{ service.durationMinutes }} min</strong>
            } @else {
              <small>From {{ money(business().startingPricePaise) }}</small>
              <strong>{{ business().nextAvailableSlot || "Check availability" }}</strong>
            }
          </div>
          <ion-button class="primary-gradient" [routerLink]="['/business', business().slug || business().id, 'book']" [queryParams]="selectedServiceId() ? { serviceId: selectedServiceId() } : null">Book now</ion-button>
        </div>
      </div>
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
      --background: linear-gradient(135deg, var(--primary), var(--primary-2));
      --color: #ffffff;
    }

    .cover-copy {
      position: relative;
      z-index: 2;
      padding-bottom: 34px;
      color: #ffffff;
    }

    .cover-copy h1 {
      margin: 12px 0 8px;
      max-width: 760px;
      font-size: clamp(2.5rem, 8vw, 5.7rem);
      font-weight: 900;
      letter-spacing: -0.06em;
      line-height: 0.9;
    }

    .cover-copy p {
      margin: 0;
      color: rgba(255, 255, 255, 0.82);
      font-size: 1.08rem;
      font-weight: 800;
    }

    .profile-shell {
      display: grid;
      gap: 22px;
      padding-top: 22px;
    }

    .main-column {
      display: grid;
      gap: 4px;
      min-width: 0;
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

    .gallery-strip img {
      width: 100%;
      padding: 16px;
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
      .cover-copy p,
      .intro h2,
      .trust-row,
      .staff-section,
      .review-section,
      .info-grid,
      .service-card p {
        display: none;
      }

      .cover-copy {
        padding: 0 18px 18px;
      }

      .cover-copy h1 {
        margin: 8px 0 0;
        font-size: 1.85rem;
        line-height: 0.96;
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
        gap: 10px;
        padding: 12px;
        border-radius: 18px;
      }

      .intro .eyebrow {
        margin-bottom: 0;
        font-size: 0.72rem;
      }

      .stat-grid,
      .service-card {
        grid-template-columns: 1fr;
      }

      .stat-grid {
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 6px;
      }

      .stat-grid span {
        padding: 8px 6px;
        border-radius: 12px;
        font-size: 0.68rem;
        line-height: 1.15;
        text-align: center;
      }

      .stat-grid strong {
        font-size: 0.78rem;
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

      .service-card {
        gap: 8px;
        padding: 12px;
        border-radius: 16px;
      }

      .service-card h3 {
        font-size: 0.95rem;
      }

      .service-card strong {
        font-size: 0.82rem;
      }

      .service-card ion-button {
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
  readonly selectedServiceId = signal<string>(this.route.snapshot.queryParamMap.get("serviceId") || "");
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
    const id = this.selectedServiceId();
    if (!id) return null;
    return this.business()?.services.find((s) => s.id === id) || null;
  });
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

  constructor(private readonly route: ActivatedRoute, private readonly router: Router, readonly marketplace: MarketplaceService, private readonly feedback: CustomerFeedbackService) {
    addIcons({
      callOutline,
      bookmark,
      bookmarkOutline,
      cardOutline,
      checkmarkCircleOutline,
      clipboardOutline,
      heart,
      heartOutline,
      locationOutline,
      navigateOutline,
      peopleOutline,
      pricetagOutline,
      ribbonOutline,
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
      this.selectedServiceId.set(paramServiceId);
    }
    void this.marketplace.ensureFavorites().catch(() => undefined);
    void this.marketplace.ensureSavedSalons().catch(() => undefined);
  }

  selectService(serviceId: string) {
    if (this.selectedServiceId() === serviceId) {
      this.selectedServiceId.set("");
    } else {
      this.selectedServiceId.set(serviceId);
    }
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

  setAsPrimary() {
    const biz = this.business();
    if (!biz || !biz.tenantId || !biz.branchId) return;
    if (!this.isAuthenticated()) {
      void this.router.navigate(["/login"], { queryParams: { returnUrl: this.router.url } });
      return;
    }
    void this.marketplace.setPrimarySalon(biz.tenantId, biz.branchId, biz.id, biz.businessName).catch(() => undefined);
  }

  removeAsPrimary() {
    void this.marketplace.removePrimarySalon().catch(() => undefined);
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
