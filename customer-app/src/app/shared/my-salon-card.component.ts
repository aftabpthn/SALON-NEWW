import { Component, EventEmitter, Input, Output } from "@angular/core";
import { Router, RouterLink } from "@angular/router";
import { IonButton, IonIcon } from "@ionic/angular/standalone";
import { addIcons } from "ionicons";
import { chevronForwardOutline, ribbonOutline, walletOutline, calendarOutline } from "ionicons/icons";
import { CustomerPrimarySalon, CustomerSalonRelationship } from "../core/api.types";
import { MarketplaceService } from "../core/marketplace.service";

@Component({
  selector: "aura-my-salon-card",
  standalone: true,
  imports: [RouterLink, IonButton, IonIcon],
  template: `
    <article class="my-salon-card" [class.has-primary]="!!primarySalon" tabindex="0">
      @if (primarySalon) {
        <div class="salon-header">
          <div class="salon-initials" aria-hidden="true">{{ salonInitials(primarySalon.businessName) }}</div>
          <div class="salon-info">
            <span class="label">Your primary salon</span>
            <h3>{{ primarySalon.businessName }}</h3>
            <small>Set {{ formatTimeAgo(primarySalon.setAt) }}</small>
          </div>
          <button
            type="button"
            class="change-salon"
            (click)="openSalonPicker.emit()"
            aria-label="Change primary salon">
            <ion-icon name="chevron-forward-outline"></ion-icon>
          </button>
        </div>
        <nav class="salon-actions" aria-label="Quick actions for your primary salon">
          <a [routerLink]="['/business', primarySalon.businessId, 'book']" class="action-pill">
            <ion-icon name="calendar-outline"></ion-icon>
            <span>Book</span>
          </a>
          <a routerLink="/tabs/rewards" class="action-pill">
            <ion-icon name="ribbon-outline"></ion-icon>
            <span>Rewards</span>
          </a>
          <a routerLink="/tabs/profile" class="action-pill">
            <ion-icon name="wallet-outline"></ion-icon>
            <span>Wallet</span>
          </a>
        </nav>
      } @else if (suggestedSalon) {
        <div class="prompt-card">
          <div class="salon-initials" aria-hidden="true">{{ salonInitials(suggestedSalon.businessName) }}</div>
          <div class="prompt-content">
            <h3>Make {{ suggestedSalon.businessName }} your primary salon?</h3>
            <p>You've visited {{ suggestedSalon.visitCount }} times. Set as primary for quick access.</p>
            <div class="prompt-actions">
              <ion-button size="small" class="primary-gradient" (click)="confirmSetPrimary(suggestedSalon)">Set as primary</ion-button>
              <ion-button size="small" fill="clear" (click)="dismissPrompt.emit()">Not now</ion-button>
            </div>
          </div>
        </div>
      }
    </article>
  `,
  styles: [`
    .my-salon-card {
      display: grid;
      gap: 12px;
      padding: 16px;
      border: 1px solid var(--border);
      border-radius: var(--radius-lg);
      background: linear-gradient(145deg, rgba(255, 251, 241, 0.98), rgba(246, 228, 193, 0.9));
      box-shadow: 0 18px 42px rgba(92, 65, 28, 0.12);
    }

    .salon-header {
      display: grid;
      grid-template-columns: 48px minmax(0, 1fr) auto;
      gap: 12px;
      align-items: center;
    }

    .salon-initials {
      width: 48px;
      height: 48px;
      border-radius: 14px;
      display: grid;
      place-items: center;
      color: #120D05;
      background: linear-gradient(135deg, #F4D58D, #D6A94A, #9B6B22);
      font-weight: 1000;
      font-size: 1.05rem;
      letter-spacing: -0.03em;
    }

    .salon-info {
      display: grid;
      gap: 2px;
      min-width: 0;
    }

    .salon-info .label {
      color: var(--muted);
      font-size: 0.72rem;
      font-weight: 900;
      text-transform: uppercase;
      letter-spacing: 0.06em;
    }

    .salon-info h3 {
      margin: 0;
      color: var(--text);
      font-size: 1.1rem;
      font-weight: 950;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .salon-info small {
      color: var(--muted);
      font-size: 0.78rem;
      font-weight: 800;
    }

    .change-salon {
      width: 36px;
      height: 36px;
      border-radius: 12px;
      border: 1px solid rgba(214, 169, 74, 0.24);
      background: rgba(255, 255, 255, 0.7);
      color: var(--text);
      display: grid;
      place-items: center;
      cursor: pointer;
    }

    .salon-actions {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 8px;
    }

    .action-pill {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      padding: 10px 12px;
      border: 1px solid rgba(214, 169, 74, 0.22);
      border-radius: 14px;
      color: #201307;
      background: rgba(255, 255, 255, 0.72);
      font-size: 0.84rem;
      font-weight: 900;
      text-decoration: none;
      transition: transform 160ms ease, border-color 160ms ease;
    }

    .action-pill ion-icon {
      width: 16px;
      height: 16px;
      color: #8a5a16;
    }

    @media (hover: hover) and (pointer: fine) {
      .action-pill:hover {
        transform: translateY(-2px);
        border-color: rgba(214, 169, 74, 0.42);
      }
    }

    /* Prompt card */
    .prompt-card {
      display: grid;
      grid-template-columns: 48px minmax(0, 1fr);
      gap: 12px;
      align-items: start;
    }

    .prompt-content {
      display: grid;
      gap: 4px;
    }

    .prompt-content h3 {
      margin: 0;
      color: var(--text);
      font-size: 1rem;
      font-weight: 950;
      line-height: 1.25;
    }

    .prompt-content p {
      margin: 0;
      color: var(--muted);
      font-size: 0.84rem;
      line-height: 1.35;
    }

    .prompt-actions {
      display: flex;
      gap: 8px;
      margin-top: 4px;
    }
  `]
})
export class MySalonCardComponent {
  @Input() primarySalon: CustomerPrimarySalon | null = null;
  @Input() suggestedSalon: CustomerSalonRelationship | null = null;
  @Output() openSalonPicker = new EventEmitter<void>();
  @Output() dismissPrompt = new EventEmitter<void>();
  @Output() setPrimary = new EventEmitter<CustomerSalonRelationship>();

  constructor(private readonly marketplace: MarketplaceService, private readonly router: Router) {
    addIcons({ chevronForwardOutline, ribbonOutline, walletOutline, calendarOutline });
  }

  salonInitials(name: string): string {
    if (!name) return "S";
    const words = name.trim().split(/\s+/);
    if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
    return (words[0][0] + words[1][0]).toUpperCase();
  }

  formatTimeAgo(iso: string): string {
    if (!iso) return "";
    const diff = Date.now() - new Date(iso).getTime();
    const days = Math.floor(diff / 86400000);
    if (days === 0) return "today";
    if (days === 1) return "yesterday";
    if (days < 30) return `${days}d ago`;
    return `${Math.floor(days / 30)}mo ago`;
  }

  confirmSetPrimary(salon: import("../core/api.types").CustomerSalonRelationship): void {
    this.setPrimary.emit(salon);
  }
}
