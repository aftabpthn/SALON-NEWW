import { Component, OnInit, computed } from "@angular/core";
import { RouterLink } from "@angular/router";
import { IonButton, IonContent, IonIcon } from "@ionic/angular/standalone";
import { addIcons } from "ionicons";
import { bookmark, searchOutline } from "ionicons/icons";
import { MarketplaceService } from "../../core/marketplace.service";
import { BusinessCardComponent } from "../../shared/business-card.component";

@Component({
  standalone: true,
  imports: [RouterLink, IonButton, IonContent, IonIcon, BusinessCardComponent],
  template: `
    <ion-content>
      <main class="page saved-page">
        <header class="saved-header">
          <span><ion-icon name="bookmark"></ion-icon></span>
          <div><h1>Saved salons</h1><p>Your shortlist for later</p></div>
        </header>

        <section class="saved-grid">
          @for (item of saved(); track item.businessId) {
            @if (item.business; as business) {
              <aura-business-card [business]="business"></aura-business-card>
            }
          } @empty {
            <div class="empty-state">
              <ion-icon name="bookmark"></ion-icon>
              <h2>No saved salons yet</h2>
              <p>Tap the bookmark icon on any salon to save it here.</p>
              <ion-button class="primary-gradient" routerLink="/tabs/search">
                <ion-icon name="search-outline" slot="start"></ion-icon>Explore salons
              </ion-button>
            </div>
          }
        </section>
      </main>
    </ion-content>
  `,
  styles: [`
    .saved-page { display: grid; gap: 18px; padding-bottom: 96px; }
    .saved-header { display: flex; align-items: center; gap: 12px; padding: 8px 2px; }
    .saved-header > span { width: 46px; height: 46px; display: grid; place-items: center; border-radius: 14px; color: #fff; background: #8a5a16; font-size: 1.2rem; }
    h1, h2, p { margin: 0; }
    h1 { color: var(--text); font-size: 1.45rem; letter-spacing: -0.04em; }
    .saved-header p, .empty-state p { color: var(--muted); font-size: 0.82rem; }
    .saved-grid { display: grid; gap: 14px; }
    .empty-state { display: grid; justify-items: center; gap: 10px; padding: 44px 18px; text-align: center; }
    .empty-state > ion-icon { color: #8a5a16; font-size: 2rem; }
    @media (min-width: 680px) { .saved-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
  `]
})
export class SavedSalonsPage implements OnInit {
  readonly saved = computed(() => this.marketplace.savedSalons().filter((item) => item.business));

  constructor(readonly marketplace: MarketplaceService) {
    addIcons({ bookmark, searchOutline });
  }

  ngOnInit() {
    void this.marketplace.ensureSavedSalons().catch(() => undefined);
  }
}
