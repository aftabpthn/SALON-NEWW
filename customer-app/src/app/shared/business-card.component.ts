import { Component, EventEmitter, Input, OnInit, Output } from "@angular/core";
import { Router, RouterLink } from "@angular/router";
import { IonButton, IonIcon } from "@ionic/angular/standalone";
import { addIcons } from "ionicons";
import { bookmark, bookmarkOutline, heart, heartOutline, locationOutline, timeOutline } from "ionicons/icons";
import { Business } from "../core/api.types";
import { ClockService } from "../core/clock.service";
import { CustomerFeedbackService } from "../core/customer-feedback.service";
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
        <div class="cover-actions">
          <button class="favorite" [class.saved]="isSaved()" type="button" [disabled]="favoritePending" [attr.aria-label]="isSaved() ? 'Remove from wishlist' : 'Save to wishlist'" (click)="toggleSave($event)">
            <ion-icon [name]="isSaved() ? 'heart' : 'heart-outline'"></ion-icon>
          </button>
          <button class="save-salon" [class.saved]="isSalonSaved()" type="button" [disabled]="savedSalonPending" [attr.aria-label]="isSalonSaved() ? 'Remove saved salon' : 'Save salon'" (click)="toggleSavedSalon($event)">
            <ion-icon [name]="isSalonSaved() ? 'bookmark' : 'bookmark-outline'"></ion-icon>
          </button>
        </div>
        @if (business.hasOffer) {
          <span class="offer-pill">{{ business.offerText }}</span>
        }
      </div>

      <div class="content">
        <div class="topline">
          <span class="status-pill" [class.closed]="!isOpenNow()">{{ isOpenNow() ? "Open now" : "Closed" }}</span>
          <span class="countdown-pill" [class.warning]="isClosingSoon()" [class.closed]="!isOpenNow()">{{ timingStatus() }}</span>
        </div>
        <h3>{{ business.businessName }}</h3>
        <p class="business-meta">
          @if (business.category) {
            <span class="business-category">{{ business.category }}</span>
          }
          @if (distanceLabel(); as location) {
            <span class="business-location"><ion-icon name="location-outline"></ion-icon>{{ location }}</span>
          }
        </p>
        <div class="service-row">
          <span>{{ business.popularService || business.categories[0] || "Service" }}</span>
          <strong>from {{ money(business.startingPricePaise) }}</strong>
        </div>
        <div class="footer-row">
          <span><ion-icon name="time-outline"></ion-icon>{{ business.nextAvailableSlot || business.hoursLabel || "Availability updating" }}</span>
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
      background: linear-gradient(145deg, rgba(255, 255, 255, 0.98), rgba(246, 249, 252, 0.96)), var(--surface);
      box-shadow: var(--shadow-soft);
      cursor: pointer;
      transition: transform 180ms ease, box-shadow 180ms ease, border-color 180ms ease;
    }

    .business-card:active {
      transform: scale(0.99);
    }

    .business-card:focus-visible {
      outline: 3px solid rgba(37, 99, 235, 0.4);
      outline-offset: 3px;
    }

    .business-card.highlighted {
      border-color: rgba(11, 70, 120, 0.62);
      box-shadow: 0 24px 54px rgba(6, 23, 43, 0.16), 0 0 36px rgba(11, 70, 120, 0.14);
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
      box-shadow: 0 14px 26px rgba(6, 23, 43, 0.14), inset 0 1px 0 rgba(255, 255, 255, 0.68);
    }

    .cover-actions {
      position: absolute;
      top: 12px;
      right: 12px;
      z-index: 2;
      display: flex;
      align-items: center;
      gap: 6px;
    }

    .favorite,
    .save-salon {
      position: relative;
      inset: auto;
      width: 44px;
      height: 44px;
      display: grid;
      place-items: center;
      border: 1px solid rgba(11, 70, 120, 0.24);
      border-radius: 999px;
      color: var(--text);
      background: rgba(255, 255, 255, 0.88);
      box-shadow: 0 14px 28px rgba(6, 23, 43, 0.14);
      backdrop-filter: blur(14px);
    }

    .favorite.saved {
      color: #FFFFFF;
      border-color: rgba(11, 70, 120, 0.42);
      background: linear-gradient(135deg, var(--brand-600), var(--primary));
    }

    .offer-pill {
      position: absolute;
      bottom: 14px;
      left: 14px;
      z-index: 2;
      box-shadow: 0 10px 24px rgba(6, 23, 43, 0.12);
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
      border: 1px solid rgba(11, 70, 120, 0.22);
      border-radius: 999px;
      color: var(--brand-800);
      background: linear-gradient(135deg, rgba(255, 255, 255, 0.94), rgba(231, 240, 248, 0.9));
      font-size: 0.76rem;
      font-weight: 900;
      white-space: nowrap;
      box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.58);
    }

    .countdown-pill.warning {
      color: var(--primary);
      border-color: rgba(11, 70, 120, 0.3);
      background: linear-gradient(135deg, rgba(255, 255, 255, 0.94), rgba(231, 240, 248, 0.9));
    }

    .countdown-pill.closed {
      color: var(--muted);
      border-color: var(--border);
      background: var(--surface-soft);
    }

    h3 {
      margin: 4px 0 0;
      color: var(--text);
      font-size: 1.22rem;
      font-weight: 900;
      letter-spacing: -0.035em;
      line-height: 1.1;
    }

    .business-meta {
      min-height: 19px;
      display: flex;
      align-items: center;
      gap: 6px;
      margin: 0;
      color: var(--muted);
      font-size: 0.9rem;
      line-height: 1.35;
      overflow: hidden;
      white-space: nowrap;
    }

    .favorite:disabled,
    .save-salon:disabled {
      cursor: wait;
      opacity: 0.7;
    }

    .business-meta > span {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .business-location {
      display: inline-flex;
      align-items: center;
      gap: 4px;
    }

    .business-category + .business-location::before {
      content: "·";
      color: rgba(82, 101, 121, 0.68);
    }

    .business-location ion-icon {
      flex: 0 0 auto;
    }

    .service-row {
      margin-top: 6px;
      padding: 12px;
      border-radius: 18px;
      border: 1px solid rgba(11, 70, 120, 0.14);
      background: rgba(255, 255, 255, 0.94);
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
        border-color: rgba(11, 70, 120, 0.34);
        box-shadow: var(--shadow-card);
      }
    }

    @media (max-width: 599px) {
      :host-context(.business-rail) .business-card {
        grid-template-columns: 42px minmax(0, 1fr) 26px;
        grid-template-rows: auto auto auto !important;
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
      :host-context(.business-rail) .cover-actions,
      :host-context(.business-rail) .offer-pill,
      :host-context(.business-rail) .topline,
      :host-context(.business-rail) .service-row strong,
      :host-context(.business-rail) .footer-row > span {
        display: none;
      }

      :host-context(.business-rail) h3,
      :host-context(.business-rail) .business-meta,
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
        min-height: 0;
        display: block;
        color: var(--text);
        font-size: 0.86rem;
        line-height: 1.05;
      }

      :host-context(.business-rail) .business-meta,
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

      :host-context(.business-rail) .business-location {
        display: none;
      }

      .business-card {
        border-radius: 18px;
      }

      .cover {
        aspect-ratio: auto;
        width: 100%;
        height: 116px;
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

      .cover-actions {
        top: 10px;
        right: 10px;
        gap: 5px;
      }

      .favorite,
      .save-salon {
        width: 44px;
        height: 44px;
        min-width: 44px;
        min-height: 44px;
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
        min-height: 2.1em;
        display: -webkit-box;
        overflow: hidden;
        -webkit-box-orient: vertical;
        -webkit-line-clamp: 2;
      }

      .business-meta {
        font-size: 0.78rem;
        line-height: 1.2;
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

      .footer-row > span {
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
    }

    .save-salon.saved {
      color: #fff;
      border-color: var(--primary);
      background: var(--primary);
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
  favoritePending = false;
  savedSalonPending = false;

  constructor(private readonly marketplace: MarketplaceService, private readonly router: Router, private readonly clock: ClockService, private readonly feedback: CustomerFeedbackService) {
    addIcons({ bookmark, bookmarkOutline, heart, heartOutline, locationOutline, timeOutline });
  }

  ngOnInit() {
    void this.marketplace.ensureFavorites().catch(() => undefined);
    void this.marketplace.ensureSavedSalons().catch(() => undefined);
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
    return String(this.business.area || this.business.city || this.business.address || "").trim();
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

  isSalonSaved(): boolean {
    return this.marketplace.isSalonSaved(this.business.id);
  }

  async toggleSavedSalon(event: Event) {
    event.preventDefault();
    event.stopPropagation();
    if (this.savedSalonPending) return;
    if (!this.marketplace.isAuthenticated()) {
      void this.router.navigate(["/login"], { queryParams: { returnUrl: this.router.url } });
      return;
    }
    this.savedSalonPending = true;
    try {
      const saved = await this.marketplace.toggleSavedSalon(this.business.id);
      await this.feedback.success(saved ? "Added to saved salons" : "Removed from saved salons");
    } catch {
      await this.feedback.error(this.marketplace.error() || "Could not update saved salons. Please try again.");
    } finally {
      this.savedSalonPending = false;
    }
  }

  async toggleSave(event: Event) {
    event.stopPropagation();
    if (this.favoritePending) return;
    if (!this.marketplace.isAuthenticated()) {
      void this.router.navigate(["/login"], { queryParams: { returnUrl: this.router.url } });
      return;
    }
    this.favoritePending = true;
    try {
      const saved = await this.marketplace.toggleFavorite(this.business.id);
      await this.feedback.success(saved ? "Added to favorites / wishlist" : "Removed from favorites / wishlist");
    } catch {
      await this.feedback.error(this.marketplace.error() || "Could not update favorites. Please try again.");
    } finally {
      this.favoritePending = false;
    }
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
