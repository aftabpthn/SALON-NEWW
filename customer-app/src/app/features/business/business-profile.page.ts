import { Component, OnInit, computed, signal } from "@angular/core";
import { ActivatedRoute, Router, RouterLink } from "@angular/router";
import { IonBackButton, IonButton, IonButtons, IonContent, IonHeader, IonIcon, IonToolbar } from "@ionic/angular/standalone";
import { addIcons } from "ionicons";
import {
  callOutline,
  cardOutline,
  checkmarkCircleOutline,
  heart,
  heartOutline,
  locationOutline,
  navigateOutline,
  peopleOutline,
  shareOutline,
  sparklesOutline,
  timeOutline
} from "ionicons/icons";
import { MarketplaceService } from "../../core/marketplace.service";

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
            <ion-button fill="clear" shape="round" [class.saved-action]="isSaved()" [attr.aria-label]="isSaved() ? 'Remove from wishlist' : 'Save to wishlist'" (click)="toggleWishlist()">
              <ion-icon [name]="isSaved() ? 'heart' : 'heart-outline'"></ion-icon>
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
                  <article class="service-card premium-card">
                    <div>
                      <div class="service-title-row">
                        <h3>{{ service.name }}</h3>
                        @if (service.popular) { <span class="offer-pill">Popular</span> }
                      </div>
                      <p class="muted">{{ service.description }}</p>
                      <strong>{{ money(service.pricePaise) }} · {{ service.durationMinutes }} min</strong>
                    </div>
                    <ion-button size="small" class="primary-gradient" [routerLink]="['/business', business().slug, 'book']" [queryParams]="{ serviceId: service.id }">Select</ion-button>
                  </article>
                } @empty {
                  <section class="state-card premium-card"><h2>No services available</h2></section>
                }
              </div>
            </section>

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
                } @else {
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
            <h2>Book {{ business().popularService || business().category }}</h2>
            <p class="muted">Starts from {{ money(business().startingPricePaise) }}. Next available {{ business().nextAvailableSlot || "after selecting a service" }}.</p>
            @if (business().hasOffer) {
              <div class="rail-offer">{{ business().offerText }}</div>
            }
            <div class="rail-row"><span><ion-icon name="time-outline"></ion-icon> Next slot</span><strong>{{ business().nextAvailableSlot || "Check availability" }}</strong></div>
            <div class="rail-row"><span><ion-icon name="time-outline"></ion-icon> Hours</span><strong>{{ business().hoursLabel || "Published" }}</strong></div>
            <div class="rail-row"><span><ion-icon name="location-outline"></ion-icon> Area</span><strong>{{ business().area }}</strong></div>
            <div class="rail-row"><span><ion-icon name="card-outline"></ion-icon> Payment</span><strong>{{ paymentLabel() }}</strong></div>
            <ion-button expand="block" size="large" class="primary-gradient" [routerLink]="['/business', business().slug, 'book']">Book now</ion-button>
          </aside>
        </section>
      </main>

      <div class="sticky-cta mobile-only">
        <div class="bottom-action-card">
          <div>
            <small>From {{ money(business().startingPricePaise) }}</small>
            <strong>{{ business().nextAvailableSlot || "Check availability" }}</strong>
          </div>
          <ion-button class="primary-gradient" [routerLink]="['/business', business().slug, 'book']">Book now</ion-button>
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
      position: absolute;
      top: 16px;
      right: 16px;
      z-index: 2;
      display: flex;
      gap: 8px;
    }

    .cover-actions ion-button {
      --background: rgba(255, 255, 255, 0.88);
      --color: var(--text);
      --box-shadow: 0 10px 26px rgba(24, 17, 31, 0.16);
    }

    .cover-actions ion-button.saved-action {
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
      color: #8B5CF6;
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
      aspect-ratio: 16 / 10;
      height: auto;
      border-radius: 26px;
      object-fit: cover;
      box-shadow: var(--shadow-soft);
    }

    .service-stack {
      display: grid;
      gap: 12px;
    }

    .service-card {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: 18px;
      align-items: center;
      padding: 18px;
    }

    .service-title-row {
      display: flex;
      align-items: center;
      gap: 10px;
      flex-wrap: wrap;
    }

    .service-card h3 {
      margin: 0;
      font-size: 1.12rem;
      letter-spacing: -0.035em;
    }

    .service-card p {
      margin: 7px 0 10px;
    }

    .service-card strong {
      color: var(--primary-2);
    }

    .staff-grid,
    .review-grid,
    .info-grid {
      display: grid;
      gap: 14px;
    }

    .staff-card {
      display: grid;
      gap: 6px;
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
export class BusinessProfilePage implements OnInit {
  private readonly slug = signal(this.route.snapshot.paramMap.get("slug"));
  readonly business = computed(() => this.marketplace.findBusiness(this.slug())!);

  constructor(private readonly route: ActivatedRoute, private readonly router: Router, readonly marketplace: MarketplaceService) {
    addIcons({
      callOutline,
      cardOutline,
      checkmarkCircleOutline,
      heart,
      heartOutline,
      locationOutline,
      navigateOutline,
      peopleOutline,
      shareOutline,
      sparklesOutline,
      timeOutline
    });
  }

  ngOnInit() {
    this.reload();
    void this.marketplace.ensureFavorites().catch(() => undefined);
  }

  reload() {
    const slug = this.slug();
    if (slug) void this.marketplace.loadBusiness(slug).catch(() => undefined);
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

  toggleWishlist() {
    const business = this.business();
    if (!business) return;
    if (!this.marketplace.isAuthenticated()) {
      void this.router.navigate(["/login"], { queryParams: { returnUrl: this.router.url } });
      return;
    }
    void this.marketplace.toggleFavorite(business.id).catch(() => undefined);
  }
}
