import { Component, EventEmitter, Input, OnInit, Output } from "@angular/core";
import { Router, RouterLink } from "@angular/router";
import { IonButton, IonIcon } from "@ionic/angular/standalone";
import { addIcons } from "ionicons";
import { heart, heartOutline, locationOutline, timeOutline } from "ionicons/icons";
import { Business } from "../core/api.types";
import { ClockService } from "../core/clock.service";
import { MarketplaceService } from "../core/marketplace.service";

@Component({
  selector: "aura-business-card",
  standalone: true,
  imports: [RouterLink, IonButton, IonIcon],
  template: `
    <article
      class="business-card"
      [class.featured]="featured"
      [class.highlighted]="highlighted"
      tabindex="0"
      (click)="openCard()"
      (keydown.enter)="openCard()"
      (keydown.space)="openCard()">
      <div class="cover">
        @if (displayImage()) {
          <img class="image-fill" [src]="displayImage()" [alt]="business.businessName + ' salon interior'" loading="lazy" (error)="markImageFailed()" />
        } @else {
          <div class="cover-fallback" aria-hidden="true">
            <span>{{ businessInitials() }}</span>
            <small>{{ business.category || 'Salon' }}</small>
          </div>
        }
        <span class="rating-pill">Star {{ ratingText() }}</span>
        <button class="favorite" [class.saved]="isSaved()" type="button" [attr.aria-label]="isSaved() ? 'Remove from wishlist' : 'Save to wishlist'" (click)="toggleSave($event)">
          <ion-icon [name]="isSaved() ? 'heart' : 'heart-outline'"></ion-icon>
        </button>
        @if (business.hasOffer) {
          <span class="offer-pill">{{ business.offerText }}</span>
        }
      </div>

      <div class="content">
        <div class="topline">
          <span class="status-pill" [class.closed]="!isOpenNow()">{{ isOpenNow() ? "Open now" : "Closed" }}</span>
          <span class="countdown-pill" [class.warning]="isClosingSoon()" [class.closed]="!isOpenNow()">{{ timingStatus() }}</span>
          <span><ion-icon name="location-outline"></ion-icon>{{ distanceLabel() }}</span>
        </div>
        <h3>{{ business.businessName }}</h3>
        <p class="category">{{ business.category }}</p>
        <p class="address">{{ business.address }}</p>
        <div class="service-row">
          <span>{{ business.popularService || business.categories[0] || "Service" }}</span>
          <strong>from {{ money(business.startingPricePaise) }}</strong>
        </div>
        <div class="footer-row">
          <span><ion-icon name="time-outline"></ion-icon>{{ business.hoursLabel || business.nextAvailableSlot || "Hours updating" }}</span>
          <ion-button size="small" class="primary-gradient" [routerLink]="['/business', business.slug, 'book']" (click)="$event.stopPropagation()">Book</ion-button>
        </div>
      </div>
    </article>
  `,
  styles: [`
    .business-card {
      display: grid;
      grid-template-rows: auto minmax(0, 1fr);
      overflow: hidden;
      border: 1px solid var(--border);
      border-radius: var(--radius-lg);
      background: linear-gradient(145deg, rgba(255, 255, 255, 0.94), rgba(255, 249, 236, 0.96)), var(--surface);
      box-shadow: var(--shadow-soft);
      cursor: pointer;
      transition: transform 180ms ease, box-shadow 180ms ease, border-color 180ms ease;
    }

    .business-card:active {
      transform: scale(0.99);
    }

    .business-card.highlighted {
      border-color: rgba(214, 169, 74, 0.72);
      box-shadow: 0 24px 54px rgba(92, 65, 28, 0.18), 0 0 36px rgba(214, 169, 74, 0.16);
    }

    .cover {
      position: relative;
      overflow: hidden;
      aspect-ratio: var(--card-image-ratio);
      background: var(--surface-soft);
    }

    .cover::after {
      position: absolute;
      inset: 0;
      content: "";
      background: linear-gradient(180deg, rgba(35, 25, 13, 0.02), rgba(35, 25, 13, 0.38));
      pointer-events: none;
    }

    .cover-fallback {
      position: absolute;
      inset: 0;
      display: grid;
      place-items: center;
      gap: 8px;
      text-align: center;
      background:
        radial-gradient(circle at 50% 22%, rgba(255,255,255,0.56), transparent 24%),
        linear-gradient(145deg, #dff3fb, #bde6f7 42%, #7cd0e8 100%);
      color: #0f4f65;
    }

    .cover-fallback span {
      width: 88px;
      height: 88px;
      display: grid;
      place-items: center;
      border-radius: 28px;
      background: rgba(255,255,255,0.82);
      box-shadow: 0 18px 34px rgba(15, 79, 101, 0.12);
      font-size: 1.9rem;
      font-weight: 1000;
      letter-spacing: -0.04em;
    }

    .cover-fallback small {
      padding: 0 14px;
      color: rgba(15, 79, 101, 0.84);
      font-size: 0.74rem;
      font-weight: 950;
      letter-spacing: 0.12em;
      text-transform: uppercase;
    }

    .rating-pill {
      position: absolute;
      top: 14px;
      left: 14px;
      z-index: 2;
      box-shadow: 0 14px 26px rgba(92, 65, 28, 0.18), inset 0 1px 0 rgba(255, 255, 255, 0.68);
    }

    .favorite {
      position: absolute;
      top: 12px;
      right: 12px;
      z-index: 2;
      width: 44px;
      height: 44px;
      display: grid;
      place-items: center;
      border: 1px solid rgba(244, 213, 141, 0.32);
      border-radius: 999px;
      color: var(--text);
      background: rgba(255, 249, 236, 0.84);
      box-shadow: 0 14px 28px rgba(92, 65, 28, 0.18);
      backdrop-filter: blur(14px);
    }

    .favorite.saved {
      color: #120D05;
      border-color: rgba(244, 213, 141, 0.42);
      background: linear-gradient(135deg, #F4D58D, #D6A94A);
    }

    .offer-pill {
      position: absolute;
      bottom: 14px;
      left: 14px;
      z-index: 2;
      box-shadow: 0 10px 24px rgba(92, 65, 28, 0.16);
    }

    .content {
      display: grid;
      gap: 8px;
      padding: 16px;
    }

    .topline,
    .footer-row,
    .service-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
    }

    .topline {
      flex-wrap: wrap;
      justify-content: flex-start;
    }

    .topline > span:not(.status-pill):not(.countdown-pill),
    .footer-row > span {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      color: var(--muted);
      font-size: 0.82rem;
      font-weight: 800;
    }

    .countdown-pill {
      display: inline-flex;
      align-items: center;
      min-height: 28px;
      padding: 0 10px;
      border: 1px solid rgba(214, 169, 74, 0.22);
      border-radius: 999px;
      color: #6D4915;
      background: linear-gradient(135deg, rgba(255, 249, 236, 0.9), rgba(214, 169, 74, 0.14));
      font-size: 0.76rem;
      font-weight: 900;
      white-space: nowrap;
      box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.58);
    }

    .countdown-pill.warning {
      color: #7A5019;
      border-color: rgba(214, 169, 74, 0.3);
      background: linear-gradient(135deg, rgba(255, 249, 236, 0.92), rgba(244, 213, 141, 0.24));
    }

    .countdown-pill.closed {
      color: #7A5019;
      border-color: rgba(125, 89, 32, 0.18);
      background: rgba(125, 89, 32, 0.08);
    }

    h3 {
      margin: 4px 0 0;
      color: var(--text);
      font-size: 1.22rem;
      font-weight: 900;
      letter-spacing: -0.035em;
      line-height: 1.1;
    }

    .category,
    .address {
      margin: 0;
      color: var(--muted);
      font-size: 0.9rem;
      line-height: 1.35;
    }

    .service-row {
      margin-top: 6px;
      padding: 12px;
      border-radius: 18px;
      border: 1px solid rgba(214, 169, 74, 0.14);
      background: rgba(255, 249, 236, 0.9);
    }

    .service-row span {
      min-width: 0;
      color: var(--text);
      font-weight: 900;
    }

    .service-row strong {
      flex: 0 0 auto;
      color: var(--primary-2);
      font-size: 0.88rem;
    }

    .footer-row {
      padding-top: 6px;
    }

    ion-button {
      min-width: 86px;
    }

    @media (hover: hover) and (pointer: fine) {
      .business-card:hover {
        transform: translateY(-4px);
        border-color: rgba(214, 169, 74, 0.34);
        box-shadow: var(--shadow-card);
      }
    }

    @media (max-width: 599px) {
      :host-context(.business-rail) .business-card {
        grid-template-columns: 42px minmax(0, 1fr) 26px;
        grid-template-rows: auto auto auto;
        gap: 3px 8px;
        align-items: center;
        width: min(178px, 47vw);
        height: 68px;
        min-height: 68px;
        padding: 7px;
        border-radius: 14px;
      }

      :host-context(.business-rail) .cover {
        grid-row: span 3;
        width: 42px;
        height: 42px;
        border-radius: 14px;
      }

      :host-context(.business-rail) .content {
        display: contents;
      }

      :host-context(.business-rail) .rating-pill,
      :host-context(.business-rail) .favorite,
      :host-context(.business-rail) .offer-pill,
      :host-context(.business-rail) .topline,
      :host-context(.business-rail) .address,
      :host-context(.business-rail) .service-row strong,
      :host-context(.business-rail) .footer-row > span {
        display: none;
      }

      :host-context(.business-rail) h3,
      :host-context(.business-rail) .category,
      :host-context(.business-rail) .service-row {
        min-width: 0;
        margin: 0;
        padding: 0;
        border: 0;
        background: transparent;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      :host-context(.business-rail) h3 {
        grid-column: 2;
        color: var(--text);
        font-size: 0.86rem;
        line-height: 1.05;
      }

      :host-context(.business-rail) .category,
      :host-context(.business-rail) .service-row span {
        color: var(--muted);
        font-size: 0.72rem;
        font-weight: 900;
      }

      :host-context(.business-rail) .footer-row {
        grid-column: 3;
        grid-row: 1 / span 3;
        display: grid;
        padding: 0;
      }

      :host-context(.business-rail) .footer-row ion-button {
        width: 26px;
        min-width: 26px;
        height: 26px;
        min-height: 26px;
        --padding-start: 0;
        --padding-end: 0;
        font-size: 0;
      }

      .business-card {
        border-radius: 18px;
      }

      .cover {
        aspect-ratio: auto;
        width: 100%;
        height: 138px;
      }

      .cover-fallback span {
        width: 60px;
        height: 60px;
        border-radius: 20px;
        font-size: 1.25rem;
      }

      .cover-fallback small {
        font-size: 0.62rem;
      }

      .cover img,
      .cover .image-fill {
        width: 100% !important;
        height: 100% !important;
        object-fit: cover !important;
      }

      .rating-pill {
        top: 10px;
        left: 10px;
      }

      .favorite {
        top: 10px;
        right: 10px;
        width: 36px;
        height: 36px;
      }

      .content {
        gap: 5px;
        padding: 10px 12px 12px;
      }

      .topline {
        gap: 6px;
      }

      h3 {
        margin-top: 2px;
        font-size: 1.05rem;
      }

      .category,
      .address {
        font-size: 0.78rem;
        line-height: 1.2;
      }

      .address {
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .service-row {
        margin-top: 4px;
        padding: 9px 10px;
        border-radius: 14px;
      }

      .service-row span {
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .footer-row {
        align-items: center;
        flex-direction: row;
        gap: 8px;
        padding-top: 4px;
      }

      .footer-row ion-button {
        width: auto;
        min-width: 92px;
        min-height: 36px;
        margin: 0;
      }
    }

    @media (min-width: 1024px) {
      .business-card.featured {
        grid-template-rows: none;
        grid-template-columns: 44% minmax(0, 1fr);
        min-height: 320px;
      }

      .business-card.featured .cover {
        min-height: 100%;
      }

      .business-card.featured .content {
        align-content: center;
        padding: 24px;
      }
    }
  `]
})
export class BusinessCardComponent implements OnInit {
  @Input({ required: true }) business!: Business;
  @Input() featured = false;
  @Input() selectable = false;
  @Input() highlighted = false;
  @Input() displayDistanceKm: number | null | undefined = undefined;
  @Input() userLocation: { lat: number; lng: number } | null = null;
  @Output() cardSelect = new EventEmitter<Business>();
  private readonly savedUserLocation = this.savedLocation();
  private imageFailed = false;

  constructor(private readonly marketplace: MarketplaceService, private readonly router: Router, private readonly clock: ClockService) {
    addIcons({ heart, heartOutline, locationOutline, timeOutline });
  }

  ngOnInit() {
    void this.marketplace.ensureFavorites().catch(() => undefined);
  }

  money(pricePaise: number): string {
    return this.marketplace.formatMoney(pricePaise);
  }

  private get now(): number {
    return this.clock.now();
  }

  displayImage(): string {
    if (this.imageFailed) return "";
    const image = this.business.coverImage || this.business.galleryImages?.[0] || this.business.logoUrl || "";
    return this.isPlaceholderImage(image) ? "" : image;
  }

  private isPlaceholderImage(image: string): boolean {
    const normalized = String(image || "").trim().toLowerCase();
    return !normalized || normalized.endsWith("assets/icons/icon.svg") || normalized.endsWith("/assets/icons/icon.svg");
  }

  markImageFailed() {
    this.imageFailed = true;
  }

  businessInitials(): string {
    const words = String(this.business.businessName || "Aura").trim().split(/\s+/).filter(Boolean).slice(0, 2);
    return words.map((word) => word.charAt(0).toUpperCase()).join("") || "A";
  }

  isOpenNow(): boolean {
    const closeAt = this.timestamp(this.business.nextCloseAt);
    if (closeAt && this.now >= closeAt) return false;
    const openAt = this.timestamp(this.business.nextOpenAt);
    if (!this.business.isOpen && openAt && this.now < openAt) return false;
    return Boolean(this.business.isOpen);
  }

  isClosingSoon(): boolean {
    const closeAt = this.timestamp(this.business.nextCloseAt);
    return this.isOpenNow() && closeAt !== null && closeAt > this.now && closeAt - this.now <= 2 * 60 * 60 * 1000;
  }

  timingStatus(): string {
    if (this.isOpenNow()) {
      const closeAt = this.timestamp(this.business.nextCloseAt);
      if (closeAt && closeAt > this.now && closeAt - this.now <= 2 * 60 * 60 * 1000) {
        return `Closing in ${this.durationLabel(closeAt - this.now)}`;
      }
      return "Taking bookings";
    }
    const openAt = this.nextOpeningTimestamp();
    return openAt && openAt > this.now ? `Opening in ${this.durationLabel(openAt - this.now)}` : "Closed now";
  }

  distanceLabel(): string {
    const distance = this.realDistanceKm();
    if (distance !== null) return `${this.decimalText(distance)} km`;
    return this.business.area || this.business.city || this.business.address || "Location unavailable";
  }

  ratingText(): string {
    if (this.isNewForRating()) return "New";
    const rating = Number(this.business.ratingAverage);
    if (!Number.isFinite(rating) || rating <= 0) return "New";
    return this.oneDecimalText(Math.min(5, rating));
  }

  private decimalText(value: number): string {
    return Number(value.toFixed(2)).toString();
  }

  private oneDecimalText(value: number): string {
    return Number(value.toFixed(1)).toString();
  }

  private isNewForRating(): boolean {
    const hasEnoughReviews = Number(this.business.ratingCount || 0) >= 5;
    const createdAt = this.timestamp(this.business.createdAt);
    const isFirstMonth = createdAt !== null && this.now - createdAt < 30 * 24 * 60 * 60 * 1000;
    return !hasEnoughReviews || isFirstMonth;
  }

  private realDistanceKm(): number | null {
    if (this.displayDistanceKm !== null && this.displayDistanceKm !== undefined && Number.isFinite(Number(this.displayDistanceKm))) {
      return Number(this.displayDistanceKm);
    }
    if (this.business.distanceKm !== null && this.business.distanceKm !== undefined && Number.isFinite(Number(this.business.distanceKm))) {
      return Number(this.business.distanceKm);
    }
    const userLocation = this.userLocation || this.savedUserLocation;
    if (!userLocation) return null;
    const lat = Number(this.business.latitude);
    const lng = Number(this.business.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    return this.distanceKm(userLocation, { lat, lng });
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

  private distanceKm(from: { lat: number; lng: number }, to: { lat: number; lng: number }): number {
    const toRadians = (value: number) => value * Math.PI / 180;
    const dLat = toRadians(to.lat - from.lat);
    const dLng = toRadians(to.lng - from.lng);
    const lat1 = toRadians(from.lat);
    const lat2 = toRadians(to.lat);
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
    return Math.round((6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))) * 100) / 100;
  }

  private timestamp(value?: string): number | null {
    const time = value ? new Date(value).getTime() : Number.NaN;
    return Number.isFinite(time) ? time : null;
  }

  private nextOpeningTimestamp(): number | null {
    const openAt = this.timestamp(this.business.nextOpenAt);
    if (!openAt) return null;
    if (openAt > this.now) return openAt;
    const dayMs = 24 * 60 * 60 * 1000;
    return openAt + Math.ceil((this.now - openAt + 1) / dayMs) * dayMs;
  }

  private durationLabel(ms: number): string {
    const totalMinutes = Math.max(0, Math.ceil(ms / 60000));
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    if (hours && minutes) return `${hours}h ${minutes}m`;
    if (hours) return `${hours}h`;
    return `${minutes}m`;
  }

  openCard() {
    this.recordRecentlyViewed();
    if (this.selectable) {
      this.cardSelect.emit(this.business);
      return;
    }
    void this.router.navigate(["/business", this.business.slug]);
  }

  isSaved(): boolean {
    return this.marketplace.isFavorite(this.business.id) || this.marketplace.isFavorite(this.business.slug);
  }

  toggleSave(event: Event) {
    event.stopPropagation();
    if (!this.marketplace.isAuthenticated()) {
      void this.router.navigate(["/login"], { queryParams: { returnUrl: this.router.url } });
      return;
    }
    void this.marketplace.toggleFavorite(this.business.id).catch(() => undefined);
  }

  private recordRecentlyViewed() {
    try {
      const key = "aura_customer_recently_viewed_businesses";
      const current = JSON.parse(localStorage.getItem(key) || "[]") as Array<{ id?: string; slug?: string }>;
      const next = [
        {
          id: this.business.id,
          slug: this.business.slug,
          viewedAt: new Date().toISOString()
        },
        ...current.filter((item) => item.id !== this.business.id && item.slug !== this.business.slug)
      ].slice(0, 12);
      localStorage.setItem(key, JSON.stringify(next));
    } catch {
      // Browsing history is optional; booking and search must still work if storage is blocked.
    }
  }
}
