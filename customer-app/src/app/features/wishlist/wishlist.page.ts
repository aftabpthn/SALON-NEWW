import { Component, OnInit, computed } from "@angular/core";
import { RouterLink } from "@angular/router";
import { IonButton, IonContent, IonIcon } from "@ionic/angular/standalone";
import { addIcons } from "ionicons";
import { heart, locationOutline, searchOutline, trashOutline } from "ionicons/icons";
import { MarketplaceService } from "../../core/marketplace.service";

@Component({
  standalone: true,
  imports: [RouterLink, IonButton, IonContent, IonIcon],
  template: `
    <ion-content>
      <main class="page wishlist-page">
        <section class="wishlist-hero premium-card">
          <div class="hero-icon"><ion-icon name="heart"></ion-icon></div>
          <div>
            <h1>Saved salons</h1>
          </div>
          <ion-button class="primary-gradient" routerLink="/tabs/search">
            <ion-icon name="search-outline" slot="start"></ion-icon>
            Discover more
          </ion-button>
        </section>

        @if (!marketplace.isAuthenticated()) {
          <section class="state-card premium-card">
            <h2>Login to use wishlist</h2>
            <ion-button class="primary-gradient" [routerLink]="['/login']" [queryParams]="{ returnUrl: '/tabs/wishlist' }">Login</ion-button>
          </section>
        } @else {
          @if (marketplace.loading()) {
            <section class="state-card premium-card">
              <h2>Loading wishlist</h2>
            </section>
          }

          @if (marketplace.error()) {
            <section class="state-card premium-card error">
              <h2>Could not load wishlist</h2>
              <p>{{ marketplace.error() }}</p>
              <ion-button class="primary-gradient" (click)="reload()">Retry</ion-button>
            </section>
          }

          <section class="summary-grid">
            <article class="summary-card premium-card">
              <span>Saved</span>
              <strong>{{ savedCount() }}</strong>
            </article>
            <article class="summary-card premium-card">
              <span>Ready to book</span>
              <strong>{{ bookableCount() }}</strong>
            </article>
          </section>

          <section class="wishlist-grid">
            @for (favorite of saved(); track favorite.businessId) {
              @if (favorite.business; as business) {
                <article class="wishlist-card premium-card">
                  <img [src]="business.coverImage || business.galleryImages[0] || 'assets/icons/icon.svg'" [alt]="business.businessName + ' cover'" />
                  <div class="wishlist-copy">
                    <span class="rating-pill">{{ ratingLabel(business) }}</span>
                    <h2>{{ business.businessName }}</h2>
                    <p>{{ business.category }} · {{ business.area || business.city }}</p>
                    <small><ion-icon name="location-outline"></ion-icon>{{ business.address }}</small>
                    <strong>{{ business.popularService || "Services" }} from {{ money(business.startingPricePaise) }}</strong>
                    <div class="wishlist-actions">
                      <ion-button size="small" class="primary-gradient" [routerLink]="['/business', business.slug, 'book']">Book</ion-button>
                      <ion-button size="small" fill="outline" class="secondary-button" [routerLink]="['/business', business.slug]">View</ion-button>
                      <ion-button size="small" fill="clear" color="danger" (click)="remove(business.id)">
                        <ion-icon name="trash-outline" slot="start"></ion-icon>
                        Remove
                      </ion-button>
                    </div>
                  </div>
                </article>
              }
            } @empty {
              <section class="state-card premium-card">
                <h2>No saved salons yet</h2>
                <ion-button class="primary-gradient" routerLink="/tabs/search">Find salons</ion-button>
              </section>
            }
          </section>
        }
      </main>
    </ion-content>
  `,
  styles: [`
    .wishlist-page {
      display: grid;
      gap: 16px;
      padding-bottom: 112px;
    }

    .wishlist-hero {
      display: grid;
      grid-template-columns: auto minmax(0, 1fr) auto;
      gap: 16px;
      align-items: center;
      padding: 22px;
    }

    .hero-icon {
      width: 64px;
      height: 64px;
      display: grid;
      place-items: center;
      border-radius: 22px;
      color: #ffffff;
      background: linear-gradient(135deg, var(--primary), var(--primary-2));
      font-size: 1.7rem;
      box-shadow: 0 16px 32px rgba(139, 92, 246, 0.2);
    }

    h1,
    h2,
    p {
      margin: 0;
    }

    h1 {
      color: var(--text);
      font-size: clamp(2rem, 5vw, 3rem);
      letter-spacing: -0.05em;
      line-height: 1;
    }

    .summary-grid,
    .wishlist-grid {
      display: grid;
      gap: 14px;
    }

    .summary-card {
      display: grid;
      gap: 5px;
      padding: 16px;
    }

    .summary-card span {
      color: var(--muted);
      font-size: 0.78rem;
      font-weight: 900;
      letter-spacing: 0.08em;
      text-transform: uppercase;
    }

    .summary-card strong {
      color: var(--text);
      font-size: 2rem;
      letter-spacing: -0.04em;
      line-height: 1;
    }

    .summary-card small,
    .wishlist-card p,
    .wishlist-card small {
      color: var(--muted);
      line-height: 1.4;
    }

    .wishlist-card {
      display: grid;
      overflow: hidden;
    }

    .wishlist-card img {
      width: 100%;
      aspect-ratio: 16 / 10;
      height: auto;
      object-fit: cover;
      background: var(--surface-soft);
    }

    .wishlist-copy {
      display: grid;
      gap: 8px;
      padding: 16px;
    }

    .wishlist-copy h2 {
      color: var(--text);
      font-size: 1.35rem;
      letter-spacing: -0.04em;
    }

    .wishlist-card small {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      font-weight: 800;
    }

    .wishlist-card strong {
      color: var(--primary-2);
    }

    .wishlist-actions {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin-top: 6px;
    }

    .state-card {
      display: grid;
      gap: 12px;
      padding: 20px;
    }

    .state-card.error p {
      color: #EF4444;
    }

    @media (max-width: 599px) {
      .wishlist-hero {
        grid-template-columns: 1fr;
      }

      .wishlist-actions ion-button,
      .wishlist-hero ion-button {
        width: 100%;
      }
    }

    @media (min-width: 768px) {
      .summary-grid {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }

      .wishlist-card {
        grid-template-columns: 260px minmax(0, 1fr);
      }

      .wishlist-card img {
        height: 100%;
        min-height: 240px;
      }
    }
  `]
})
export class WishlistPage implements OnInit {
  readonly saved = computed(() => this.marketplace.favorites().filter((favorite) => favorite.business));
  readonly savedCount = computed(() => this.saved().length);
  readonly bookableCount = computed(() => this.saved().filter((favorite) => (favorite.business?.services.length || 0) > 0).length);

  constructor(readonly marketplace: MarketplaceService) {
    addIcons({ heart, locationOutline, searchOutline, trashOutline });
  }

  ngOnInit() {
    this.reload();
  }

  reload() {
    void this.marketplace.ensureFavorites().catch(() => undefined);
  }

  money(pricePaise: number): string {
    return this.marketplace.formatMoney(pricePaise);
  }

  ratingLabel(business: { ratingAverage: number; ratingCount: number; createdAt?: string }): string {
    const firstMonth = business.createdAt ? Date.now() - new Date(business.createdAt).getTime() < 30 * 24 * 60 * 60 * 1000 : false;
    if (business.ratingCount < 5 || firstMonth) return "New";
    const rating = Math.min(5, Number(business.ratingAverage || 0));
    return rating > 0 ? `Star ${Number(rating.toFixed(1))}` : "New";
  }

  remove(businessId: string) {
    void this.marketplace.removeFavorite(businessId).catch(() => undefined);
  }
}
