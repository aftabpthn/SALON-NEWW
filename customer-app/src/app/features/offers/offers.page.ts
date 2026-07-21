import { Component, OnInit, computed } from "@angular/core";
import { RouterLink } from "@angular/router";
import { IonButton, IonContent } from "@ionic/angular/standalone";
import { BusinessCardComponent } from "../../shared/business-card.component";
import { MarketplaceService } from "../../core/marketplace.service";

@Component({
  standalone: true,
  imports: [RouterLink, IonButton, IonContent, BusinessCardComponent],
  template: `
    <ion-content>
      <main class="page offers-page">
        <section class="hero-offer">
          <div>
            <span>Live offers</span>
            <h1>Current marketplace promotions</h1>
          </div>
          <ion-button fill="light" routerLink="/tabs/search">Find offers</ion-button>
        </section>

        <div class="section-heading">
          <div>
            <h2 class="section-title">Save on your next appointment</h2>
          </div>
        </div>
        @if (marketplace.loading()) {
          <section class="state-card premium-card"><h2>Loading offers</h2></section>
        }
        @if (marketplace.error()) {
          <section class="state-card premium-card error"><h2>Could not load offers</h2><p>{{ marketplace.error() }}</p><ion-button class="primary-gradient" (click)="reload()">Retry</ion-button></section>
        }
        <div class="offer-grid">
          @for (business of offerBusinesses(); track business.id) {
            <aura-business-card [business]="business"></aura-business-card>
          } @empty {
            <section class="state-card premium-card"><h2>No offers available</h2></section>
          }
        </div>
      </main>
    </ion-content>
  `,
  styles: [`
    .hero-offer {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 18px;
      min-height: 260px;
      padding: 28px;
      border-radius: var(--radius-xl);
      color: #ffffff;
      background: linear-gradient(135deg, var(--primary), var(--primary-2), var(--accent));
      box-shadow: var(--shadow-card);
    }

    .hero-offer span {
      color: rgba(255, 255, 255, 0.74);
      font-size: 0.8rem;
      font-weight: 900;
      letter-spacing: 0.1em;
      text-transform: uppercase;
    }

    .hero-offer h1 {
      margin: 8px 0 10px;
      max-width: 660px;
      font-size: clamp(2.2rem, 6vw, 4.8rem);
      letter-spacing: -0.06em;
      line-height: 0.92;
    }

    .hero-offer p {
      max-width: 560px;
      margin: 0;
      color: rgba(255, 255, 255, 0.78);
      line-height: 1.55;
    }

    .offer-grid {
      display: grid;
      gap: 18px;
    }

    .state-card {
      padding: 20px;
    }

    .state-card h2 {
      margin: 0 0 8px;
      letter-spacing: -0.04em;
    }

    .state-card.error p {
      color: #EF4444;
    }

    @media (max-width: 599px) {
      .hero-offer {
        align-items: stretch;
        flex-direction: column;
      }
    }

    @media (min-width: 768px) {
      .offer-grid {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }
    }

    @media (min-width: 1024px) {
      .offer-grid {
        grid-template-columns: repeat(3, minmax(0, 1fr));
      }
    }

    @media (min-width: 1440px) {
      .offer-grid {
        grid-template-columns: repeat(4, minmax(0, 1fr));
      }
    }
  `]
})
export class OffersPage implements OnInit {
  readonly offerBusinesses = computed(() => this.marketplace.businesses());

  constructor(readonly marketplace: MarketplaceService) {}

  ngOnInit() {
    this.reload();
  }

  reload() {
    void this.marketplace.loadPublicBusinesses({ offers: true }).catch(() => undefined);
  }
}
