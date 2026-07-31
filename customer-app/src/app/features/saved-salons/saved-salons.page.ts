import { Component, OnInit, computed, signal } from "@angular/core";
import { RouterLink } from "@angular/router";
import { AlertController, IonBackButton, IonButton, IonContent, IonIcon } from "@ionic/angular/standalone";
import { addIcons } from "ionicons";
import { bookmark, locationOutline, searchOutline, star, storefrontOutline } from "ionicons/icons";
import { Business } from "../../core/api.types";
import { CustomerFeedbackService } from "../../core/customer-feedback.service";
import { MarketplaceService } from "../../core/marketplace.service";

@Component({
  standalone: true,
  imports: [RouterLink, IonBackButton, IonButton, IonContent, IonIcon],
  template: `
    <ion-content>
      <main class="page saved-page">
        <header class="saved-header">
          <div class="header-copy">
            <div class="content-title-row">
              <ion-back-button class="content-back-button" defaultHref="/tabs/profile" text=""></ion-back-button>
              <h1>Saved salons</h1>
            </div>
            <p>{{ savedCount() }} {{ savedCount() === 1 ? "salon" : "salons" }} shortlisted for later</p>
          </div>
          <a class="discover-action" routerLink="/tabs/search">
            <ion-icon name="search-outline" aria-hidden="true"></ion-icon>
            <span>Discover</span>
          </a>
        </header>

        @if (!marketplace.isAuthenticated()) {
          <section class="state-card" aria-labelledby="login-title">
            <div class="state-icon"><ion-icon name="bookmark"></ion-icon></div>
            <div>
              <h2 id="login-title">Login to see saved salons</h2>
              <p>Shortlist and keep track of your favorite salons.</p>
            </div>
            <ion-button class="primary-gradient" [routerLink]="['/login']" [queryParams]="{ returnUrl: '/tabs/saved-salons' }">Login</ion-button>
          </section>
        } @else {
          @if (marketplace.loading() && savedCount() === 0) {
            <section class="loading-state" aria-live="polite" aria-busy="true">
              <span class="sr-only">Loading saved salons</span>
              @for (item of loadingItems; track item) {
                <div class="skeleton-card" aria-hidden="true">
                  <div class="skeleton-image"></div>
                  <div class="skeleton-copy">
                    <span class="skeleton-line title"></span>
                    <span class="skeleton-line meta"></span>
                    <span class="skeleton-line service"></span>
                    <span class="skeleton-line actions"></span>
                  </div>
                </div>
              }
            </section>
          } @else if (marketplace.error() && savedCount() === 0) {
            <section class="state-card error" role="alert">
              <div class="state-icon"><ion-icon name="storefront-outline"></ion-icon></div>
              <h2>Could not load saved salons</h2>
              <p>{{ marketplace.error() }}</p>
              <ion-button class="primary-gradient" (click)="reload()">Retry</ion-button>
            </section>
          } @else {
            <section class="saved-grid" aria-label="Saved salons">
              @for (item of saved(); track item.businessId) {
                @if (item.business; as business) {
                  <article class="saved-card">
                    <div class="salon-image">
                      @if (displayImage(business); as image) {
                        <img [src]="image" [alt]="business.businessName + ' cover'" loading="lazy" (error)="markImageFailed(business.id)" />
                      } @else {
                        <div class="image-fallback" aria-hidden="true">
                          <span>{{ businessInitials(business) }}</span>
                          <ion-icon name="storefront-outline"></ion-icon>
                        </div>
                      }
                    </div>

                    <div class="saved-copy">
                      <div class="salon-heading">
                        <h2>{{ business.businessName }}</h2>
                        <button
                          class="remove-action"
                          type="button"
                          [disabled]="isRemoving(business.id)"
                          [attr.aria-label]="'Remove ' + business.businessName + ' from saved salons'"
                          (click)="remove(business)">
                          <ion-icon name="bookmark" aria-hidden="true"></ion-icon>
                        </button>
                      </div>

                      <div class="metadata">
                        @if (business.category) {
                          <span class="category">{{ business.category }}</span>
                        }
                        @if (locationLabel(business); as location) {
                          <span><ion-icon name="location-outline" aria-hidden="true"></ion-icon>{{ location }}</span>
                        }
                        @if (distanceLabel(business); as distance) {
                          <span>{{ distance }}</span>
                        }
                        @if (ratingLabel(business); as rating) {
                          <span><ion-icon name="star" aria-hidden="true"></ion-icon>{{ rating }}</span>
                        }
                      </div>

                      @if (serviceLabel(business); as service) {
                        <p class="service-line">
                          <span>{{ service }}</span>
                          @if (hasStartingPrice(business)) {
                            <strong>From {{ money(business.startingPricePaise) }}</strong>
                          }
                        </p>
                      } @else if (hasStartingPrice(business)) {
                        <p class="service-line"><span>Services</span><strong>From {{ money(business.startingPricePaise) }}</strong></p>
                      } @else {
                        <p class="service-line unavailable">Service details unavailable</p>
                      }

                      <div class="saved-actions">
                        <a class="card-action primary" [routerLink]="['/business', business.slug || business.id || business.branchId, 'book']">Book</a>
                        <a class="card-action secondary" [routerLink]="['/business', business.slug || business.id || business.branchId]">View</a>
                      </div>
                    </div>
                  </article>
                }
              } @empty {
                <section class="state-card empty-state">
                  <div class="state-icon gold"><ion-icon name="bookmark"></ion-icon></div>
                  <div>
                    <h2>No saved salons yet</h2>
                    <p>Tap the bookmark icon on any salon to save it to your shortlist.</p>
                  </div>
                  <ion-button class="primary-gradient" routerLink="/tabs/search">
                    <ion-icon name="search-outline" slot="start"></ion-icon>
                    Explore salons
                  </ion-button>
                </section>
              }
            </section>
          }
        }
      </main>
    </ion-content>
  `,
  styles: [`
    :host {
      display: block;
    }

    .saved-page {
      display: grid;
      gap: 12px;
      max-width: 980px;
      padding-bottom: 112px;
    }

    .saved-header {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: 10px;
      align-items: center;
      min-width: 0;
      padding: 2px 0 8px;
      border-bottom: 1px solid var(--border);
    }

    .header-identity,
    .state-icon {
      display: grid;
      place-items: center;
      color: var(--primary);
      background: var(--primary-soft);
    }

    .header-identity {
      width: 36px;
      height: 36px;
      border-radius: 12px;
      font-size: 1rem;
    }

    .header-copy {
      min-width: 0;
    }

    h1,
    h2,
    p {
      margin: 0;
    }

    h1 {
      color: var(--text);
      font-size: clamp(1.2rem, 5vw, 1.45rem);
      font-weight: 900;
      letter-spacing: -0.035em;
      line-height: 1.08;
    }

    .content-title-row {
      display: flex;
      align-items: center;
      gap: 10px;
    }

    .content-back-button {
      width: 38px;
      height: 38px;
      min-width: 38px;
      margin-left: -8px;
      --color: var(--brand-950);
      --icon-font-size: 25px;
      --background: transparent;
      --border-radius: 12px;
      --padding-start: 0;
      --padding-end: 0;
      filter: drop-shadow(0.45px 0 0 var(--brand-950));
    }

    .header-copy p {
      margin-top: 2px;
      color: var(--muted);
      font-size: 0.74rem;
      font-weight: 700;
    }

    .discover-action {
      min-height: 34px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 5px;
      padding: 0 10px;
      border: 1px solid var(--border);
      border-radius: 10px;
      color: var(--primary);
      background: var(--surface);
      font-size: 0.74rem;
      font-weight: 850;
      text-decoration: none;
      transition: color 180ms ease, background 180ms ease, border-color 180ms ease, transform 180ms ease;
    }

    .discover-action ion-icon {
      font-size: 0.9rem;
    }

    .saved-grid,
    .loading-state {
      display: grid;
      gap: 8px;
    }

    .saved-card,
    .skeleton-card {
      display: grid;
      grid-template-columns: 78px minmax(0, 1fr);
      min-width: 0;
      overflow: hidden;
      border: 1px solid var(--border);
      border-radius: 14px;
      background: var(--surface);
      box-shadow: 0 4px 14px rgba(6, 23, 43, 0.04);
      transition: border-color 200ms ease, box-shadow 200ms ease, transform 180ms ease;
    }

    .salon-image,
    .skeleton-image {
      min-height: 106px;
      background: var(--surface-soft);
    }

    .salon-image {
      position: relative;
      overflow: hidden;
    }

    .salon-image img {
      width: 100%;
      height: 100%;
      display: block;
      object-fit: cover;
      transition: transform 450ms ease-out;
    }

    .image-fallback {
      position: absolute;
      inset: 0;
      display: grid;
      place-content: center;
      justify-items: center;
      gap: 4px;
      color: #0f4f65;
      background: linear-gradient(145deg, #e8f5fa, #c8e9f3 52%, #a8dbe9);
    }

    .image-fallback span {
      width: 36px;
      height: 36px;
      display: grid;
      place-items: center;
      border: 1px solid rgba(255, 255, 255, 0.76);
      border-radius: 11px;
      background: rgba(255, 255, 255, 0.82);
      box-shadow: 0 4px 12px rgba(15, 79, 101, 0.08);
      font-size: 0.86rem;
      font-weight: 950;
      letter-spacing: -0.04em;
    }

    .image-fallback ion-icon {
      font-size: 0.78rem;
      opacity: 0.72;
    }

    .saved-copy {
      display: grid;
      grid-template-rows: auto auto minmax(14px, auto) auto;
      gap: 4px;
      min-width: 0;
      padding: 7px 9px;
    }

    .salon-heading {
      display: grid;
      grid-template-columns: minmax(0, 1fr) 30px;
      gap: 4px;
      align-items: start;
    }

    .saved-copy h2 {
      display: -webkit-box;
      overflow: hidden;
      -webkit-box-orient: vertical;
      -webkit-line-clamp: 1;
      color: var(--text);
      font-size: 0.9rem;
      font-weight: 850;
      letter-spacing: -0.02em;
      line-height: 1.15;
      overflow-wrap: anywhere;
    }

    .remove-action {
      width: 30px;
      height: 30px;
      margin: -4px -4px 0 0;
      display: grid;
      place-items: center;
      border: 0;
      border-radius: 8px;
      color: #c0264d;
      background: transparent;
      cursor: pointer;
      transition: color 180ms ease, background 180ms ease, transform 180ms ease, opacity 180ms ease;
    }

    .remove-action ion-icon {
      font-size: 1.05rem;
    }

    .remove-action:disabled {
      cursor: wait;
      opacity: 0.42;
    }

    .metadata {
      display: flex;
      align-items: center;
      gap: 3px 6px;
      min-width: 0;
      overflow: hidden;
      color: var(--muted);
      font-size: 0.65rem;
      font-weight: 750;
      white-space: nowrap;
    }

    .metadata span {
      display: inline-flex;
      align-items: center;
      gap: 2.5px;
      min-width: 0;
    }

    .metadata span:not(.category) {
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .metadata ion-icon {
      flex: 0 0 auto;
      color: var(--primary);
      font-size: 0.68rem;
    }

    .category {
      flex: 0 1 auto;
      overflow: hidden;
      padding: 1.5px 5px;
      border-radius: 4px;
      color: var(--primary);
      background: var(--primary-soft);
      text-overflow: ellipsis;
    }

    .service-line {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      gap: 4px;
      min-width: 0;
      color: var(--muted);
      font-size: 0.66rem;
      line-height: 1.2;
    }

    .service-line span {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .service-line strong {
      flex: 0 0 auto;
      color: var(--primary-2);
      font-size: 0.68rem;
      white-space: nowrap;
    }

    .service-line.unavailable {
      font-style: italic;
    }

    .saved-actions {
      display: flex;
      align-items: center;
      gap: 5px;
      margin-top: auto;
    }

    .card-action {
      min-height: 28px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      padding: 0 10px;
      border: 1px solid transparent;
      border-radius: 8px;
      font-size: 0.7rem;
      font-weight: 850;
      line-height: 1;
      text-decoration: none;
      transition: color 180ms ease, background 180ms ease, border-color 180ms ease, transform 180ms ease;
    }

    .card-action.primary {
      color: #fff;
      background: var(--primary);
      box-shadow: 0 4px 10px rgba(11, 70, 120, 0.14);
    }

    .card-action.secondary {
      color: var(--primary);
      border-color: var(--border);
      background: var(--surface);
    }

    .state-card {
      display: grid;
      justify-items: start;
      gap: 10px;
      padding: 22px;
      border: 1px solid var(--border);
      border-radius: 18px;
      background: var(--surface);
      box-shadow: 0 8px 22px rgba(6, 23, 43, 0.05);
    }

    .state-card h2 {
      color: var(--text);
      font-size: 1.05rem;
      font-weight: 900;
      letter-spacing: -0.025em;
    }

    .state-card p {
      margin-top: 3px;
      color: var(--muted);
      font-size: 0.82rem;
      line-height: 1.45;
    }

    .state-icon {
      width: 40px;
      height: 40px;
      border-radius: 13px;
      font-size: 1.05rem;
    }

    .state-icon.gold {
      color: var(--primary);
      background: var(--primary-soft);
    }

    .state-card.error p {
      color: var(--error);
    }

    .empty-state {
      justify-items: center;
      padding: 28px 20px;
      text-align: center;
    }

    .skeleton-card {
      pointer-events: none;
    }

    .skeleton-copy {
      display: grid;
      align-content: center;
      gap: 10px;
      padding: 12px;
    }

    .skeleton-line {
      height: 9px;
      border-radius: 999px;
      background: linear-gradient(90deg, var(--surface-soft) 20%, var(--surface-elevated) 50%, var(--surface-soft) 80%);
      background-size: 220% 100%;
      animation: skeleton-shimmer 1.35s ease-in-out infinite;
    }

    .skeleton-line.title { width: 72%; height: 13px; }
    .skeleton-line.meta { width: 88%; }
    .skeleton-line.service { width: 64%; }
    .skeleton-line.actions { width: 48%; height: 28px; border-radius: 8px; }

    .sr-only {
      position: absolute;
      width: 1px;
      height: 1px;
      padding: 0;
      margin: -1px;
      overflow: hidden;
      clip: rect(0, 0, 0, 0);
      white-space: nowrap;
      border: 0;
    }

    .discover-action:focus-visible,
    .card-action:focus-visible,
    .remove-action:focus-visible {
      outline: 3px solid color-mix(in srgb, var(--focus) 42%, transparent);
      outline-offset: 2px;
    }

    .discover-action:active,
    .card-action:active,
    .remove-action:active {
      transform: scale(0.97);
    }

    @keyframes skeleton-shimmer {
      from { background-position: 100% 0; }
      to { background-position: -100% 0; }
    }

    @media (hover: hover) and (pointer: fine) {
      .saved-card:hover {
        border-color: var(--border-strong);
        box-shadow: 0 8px 22px rgba(6, 23, 43, 0.08);
      }

      .saved-card:hover .salon-image img {
        transform: scale(1.035);
      }

      .discover-action:hover,
      .card-action.secondary:hover,
      .remove-action:hover {
        background: var(--primary-soft);
      }

      .card-action.primary:hover {
        background: var(--primary-hover);
      }
    }

    @media (min-width: 768px) {
      .saved-grid,
      .loading-state {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }

      .saved-header {
        padding-bottom: 12px;
      }
    }

    @media (max-width: 359px) {
      .saved-page {
        gap: 10px;
      }

      .saved-card,
      .skeleton-card {
        grid-template-columns: 72px minmax(0, 1fr);
      }

      .saved-copy {
        padding: 6px 7px;
      }

      .card-action {
        padding-inline: 8px;
      }
    }

    @media (prefers-reduced-motion: reduce) {
      .saved-card,
      .salon-image img,
      .discover-action,
      .card-action,
      .remove-action,
      .skeleton-line {
        animation: none;
        transition: none;
      }
    }
  `]
})
export class SavedSalonsPage implements OnInit {
  readonly saved = computed(() => this.marketplace.savedSalons().filter((favorite) => favorite.business));
  readonly savedCount = computed(() => this.saved().length);
  readonly failedImages = signal<ReadonlySet<string>>(new Set());
  readonly removingIds = signal<ReadonlySet<string>>(new Set());
  readonly loadingItems = [1, 2, 3];

  constructor(
    readonly marketplace: MarketplaceService,
    private readonly alerts: AlertController,
    private readonly feedback: CustomerFeedbackService
  ) {
    addIcons({ bookmark, locationOutline, searchOutline, star, storefrontOutline });
  }

  ngOnInit() {
    this.reload();
  }

  reload() {
    void this.marketplace.ensureSavedSalons().catch(() => undefined);
  }

  money(pricePaise: number): string {
    return this.marketplace.formatMoney(pricePaise);
  }

  displayImage(business: Business): string {
    if (this.failedImages().has(business.id)) return "";
    const image = String(business.coverImage || business.galleryImages?.[0] || business.logoUrl || "").trim();
    const normalized = image.toLowerCase();
    return normalized.endsWith("assets/icons/icon.svg") || normalized.endsWith("/assets/icons/icon.svg") ? "" : image;
  }

  markImageFailed(businessId: string) {
    this.failedImages.update((current) => new Set([...current, businessId]));
  }

  businessInitials(business: Business): string {
    const words = String(business.businessName || "Aura").trim().split(/\s+/).filter(Boolean).slice(0, 2);
    return words.map((word) => word.charAt(0).toUpperCase()).join("") || "A";
  }

  locationLabel(business: Business): string {
    const parts = [business.area, business.city].map((part) => String(part || "").trim()).filter(Boolean);
    return [...new Set(parts)].join(", ") || String(business.address || "").trim();
  }

  distanceLabel(business: Business): string {
    const distance = Number(business.distanceKm);
    if (!Number.isFinite(distance) || distance < 0) return "";
    return `${Number(distance.toFixed(distance < 10 ? 1 : 0))} km`;
  }

  ratingLabel(business: Business): string {
    const rating = Number(business.ratingAverage);
    const count = Number(business.ratingCount);
    if (!Number.isFinite(rating) || rating <= 0 || !Number.isFinite(count) || count <= 0) return "";
    return `${Number(Math.min(5, rating).toFixed(1))} (${count})`;
  }

  serviceLabel(business: Business): string {
    return String(business.popularService || business.services?.[0]?.name || business.categories?.[0] || "").trim();
  }

  hasStartingPrice(business: Business): boolean {
    return Number.isFinite(Number(business.startingPricePaise)) && Number(business.startingPricePaise) > 0;
  }

  isRemoving(businessId: string): boolean {
    return this.removingIds().has(businessId);
  }

  async remove(business: Business) {
    const alert = await this.alerts.create({
      header: "Remove saved salon?",
      message: `${business.businessName} will be removed from your saved salons shortlist.`,
      buttons: [
        { text: "Keep", role: "cancel" },
        { text: "Remove", role: "destructive", handler: () => void this.confirmRemove(business) }
      ]
    });
    await alert.present();
  }

  private async confirmRemove(business: Business) {
    this.removingIds.update((current) => new Set([...current, business.id]));
    try {
      await this.marketplace.toggleSavedSalon(business.id);
      await this.feedback.success(`${business.businessName} removed from saved salons.`);
    } catch {
      await this.feedback.error(this.marketplace.error() || "Unable to remove saved salon.");
    } finally {
      this.removingIds.update((current) => {
        const next = new Set(current);
        next.delete(business.id);
        return next;
      });
    }
  }
}
