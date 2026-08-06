import { Component, EventEmitter, Input, OnInit, Output } from "@angular/core";
import { Router, RouterLink } from "@angular/router";
import { IonButton, IonIcon } from "@ionic/angular/standalone";
import { addIcons } from "ionicons";
import { bookmark, bookmarkOutline, globeOutline, heart, heartOutline, locationOutline, star, timeOutline } from "ionicons/icons";
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
      [class.variant-personal]="variant === 'personal'"
      [class.variant-discovery]="variant === 'discovery'"
      [class.variant-rail]="variant === 'rail' || variant === 'miniRail'"
      [class.variant-mini-rail]="variant === 'miniRail'"
      tabindex="0"
      (click)="openCard()"
      (keydown.enter)="openCard()"
      (keydown.space)="$event.preventDefault(); openCard()">
      <div class="cover">
        @if (displayImage()) {
          <img class="image-fill" [src]="displayImage()" [alt]="business.businessName + ' salon interior'" loading="lazy" (error)="markImageFailed()" />
        } @else {
          <div class="cover-fallback" aria-hidden="true">
            <span>{{ businessInitials() }}</span>
            <small>{{ business.category || 'Salon' }}</small>
          </div>
        }
        <span class="rating-pill">{{ ratingText() }}{{ ratingCountText() }}</span>
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
        </div>
        <h3>{{ business.businessName }}</h3>
        <p class="business-meta">
          @if (variant !== 'miniRail' && variant !== 'rail') {
            @if (ratingText() === 'New') {
              <span class="business-rating is-new">New</span>
            } @else {
              <span class="business-rating"><ion-icon name="star"></ion-icon>{{ ratingText() }}{{ ratingCountText() }}</span>
            }
          }
          @if (variant === 'miniRail' && business.popularService) {
            <span class="business-category">{{ business.popularService }}</span>
          } @else if (business.category) {
            <span class="business-category">{{ business.category }}</span>
          }
          @if (distanceLabel(); as location) {
            <span class="business-location"><ion-icon name="location-outline"></ion-icon>{{ location }}</span>
          }
        </p>
        <div class="service-row">
          <span>{{ business.popularService || business.categories[0] || "Service" }}</span>
          <strong>{{ priceLabel() }}</strong>
        </div>
        <div class="booking-row">
          <ion-icon name="time-outline"></ion-icon>
          <span class="booking-status" [class.warning]="isClosingSoon()" [class.closed]="!isOpenNow()">{{ timingStatus() }}</span>
          @if (supportsOnlineBooking()) {
            <span class="booking-online"><ion-icon name="globe-outline"></ion-icon>Online booking</span>
          }
        </div>
        <div class="footer-row">
          <span>{{ business.nextAvailableSlot || business.hoursLabel || "Availability updating" }}</span>
          <ion-button size="small" class="primary-gradient" [routerLink]="['/business', business.slug, 'book']" (click)="$event.stopPropagation()">Book now</ion-button>
        </div>
      </div>
    </article>
  `,
  styles: [`
    .business-card {
      display: grid;
      grid-template-columns: 112px minmax(0, 1fr);
      grid-template-rows: auto;
      align-items: stretch;
      min-height: 132px;
      overflow: hidden;
      border: 1px solid var(--border);
      border-radius: var(--radius-lg);
      background: var(--surface);
      box-shadow: 0 8px 24px rgba(28, 28, 28, 0.05);
      cursor: pointer;
      transition: transform 180ms ease, box-shadow 180ms ease, border-color 180ms ease;
    }

    .business-card:active {
      transform: scale(0.99);
    }

    .business-card:focus-visible {
      outline: 3px solid rgba(99, 102, 241, 0.4);
      outline-offset: 3px;
    }

    .business-card.highlighted {
      border-color: rgba(99, 102, 241, 0.62);
      box-shadow: 0 24px 54px rgba(28, 28, 28, 0.16), 0 0 36px rgba(99, 102, 241, 0.14);
    }

    .cover {
      position: relative;
      overflow: hidden;
      width: 112px;
      height: 100%;
      min-height: 132px;
      aspect-ratio: auto;
      background: var(--surface-soft);
    }

    .business-card.variant-rail,
    .business-card.variant-mini-rail {
      grid-template-columns: 1fr;
      grid-template-rows: auto minmax(0, 1fr);
      min-height: 0;
    }

    .business-card.variant-rail .cover,
    .business-card.variant-mini-rail .cover {
      width: 100%;
      height: auto;
      min-height: 0;
      aspect-ratio: var(--card-image-ratio);
    }

    .cover::after {
      position: absolute;
      inset: 0;
      content: "";
      background: linear-gradient(180deg, rgba(28, 28, 28, 0.02), rgba(28, 28, 28, 0.28));
      pointer-events: none;
    }

    .business-card:not(.variant-rail):not(.variant-mini-rail) .cover::after,
    .business-card:not(.variant-rail):not(.variant-mini-rail) .rating-pill,
    .business-card:not(.variant-rail):not(.variant-mini-rail) .cover-actions,
    .business-card:not(.variant-rail):not(.variant-mini-rail) .offer-pill,
    .business-card:not(.variant-rail):not(.variant-mini-rail) .topline {
      display: none;
    }

    .business-card.variant-personal {
      box-shadow: 0 8px 22px rgba(28, 28, 28, 0.05);
    }

    .business-card.variant-discovery {
      border-color: rgba(99, 102, 241, 0.2);
      box-shadow: 0 18px 42px rgba(28, 28, 28, 0.11);
    }

    .cover-fallback {
      position: absolute;
      inset: 0;
      display: grid;
      place-items: center;
      gap: 4px;
      text-align: center;
      background: linear-gradient(135deg, #eef0ff 0%, #d9dcfb 50%, #b8bcf8 100%);
      color: var(--primary-2);
    }

    .cover-fallback span {
      width: 40px;
      height: 40px;
      display: grid;
      place-items: center;
      border-radius: 12px;
      background: var(--surface);
      box-shadow: 0 4px 12px rgba(99, 102, 241, 0.14);
      color: var(--primary-2);
      font-size: 1rem;
      font-weight: 900;
      letter-spacing: -0.02em;
    }

    .cover-fallback small {
      padding: 0 14px;
      color: rgba(67, 56, 202, 0.82);
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
      box-shadow: 0 6px 16px rgba(28, 28, 28, 0.1);
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
      border: 1px solid rgba(99, 102, 241, 0.24);
      border-radius: 999px;
      color: var(--text);
      background: var(--glass);
      box-shadow: 0 6px 16px rgba(28, 28, 28, 0.1);
      backdrop-filter: none;
    }

    .favorite.saved {
      color: #FFFFFF;
      border-color: rgba(99, 102, 241, 0.42);
      background: linear-gradient(135deg, var(--brand-600), var(--primary));
    }

    .offer-pill {
      position: absolute;
      bottom: 14px;
      left: 14px;
      z-index: 2;
      box-shadow: 0 6px 16px rgba(28, 28, 28, 0.1);
    }

    .content {
      display: grid;
      gap: 8px;
      align-content: center;
      min-width: 0;
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

    .booking-row {
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: 6px;
      min-width: 0;
    }

    .booking-row > ion-icon {
      flex: 0 0 auto;
      color: var(--primary);
      font-size: 0.9rem;
    }

    .booking-status {
      min-width: 0;
      color: var(--brand-800);
      font-size: 0.78rem;
      font-weight: 850;
      line-height: 1.25;
    }

    .booking-status.warning {
      color: var(--primary);
    }

    .booking-status.closed {
      color: var(--muted);
    }

    .booking-online {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      min-height: 24px;
      padding: 0 9px;
      border: 1px solid rgba(99, 102, 241, 0.22);
      border-radius: 999px;
      color: var(--primary-2);
      background: var(--primary-soft);
      font-size: 0.68rem;
      font-weight: 900;
      white-space: nowrap;
    }

    h3 {
      margin: 0;
      color: var(--text);
      font-size: 1.02rem;
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

    .business-rating {
      display: inline-flex;
      flex: 0 0 auto;
      align-items: center;
      gap: 3px;
      color: var(--primary-2);
      font-size: 0.8rem;
      font-weight: 900;
      white-space: nowrap;
    }

    .business-rating.is-new {
      color: var(--muted);
      font-size: 0.72rem;
      font-weight: 850;
      letter-spacing: 0.02em;
    }

    .business-rating ion-icon { color: var(--primary); font-size: 0.8rem; }

    .business-location {
      display: inline-flex;
      align-items: center;
      gap: 4px;
    }

    .business-category + .business-location::before {
      content: "·";
      color: rgba(82, 101, 121, 0.68);
    }

    .business-rating + .business-category::before,
    .business-rating + .business-location::before {
      content: "·";
      color: rgba(82, 101, 121, 0.68);
    }

    .business-location ion-icon {
      flex: 0 0 auto;
    }

    .service-row {
      margin-top: 0;
      padding: 0;
      border: 0;
      border-radius: 0;
      background: transparent;
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
      padding-top: 0;
    }

    .footer-row ion-button {
      min-width: 84px;
      height: 44px;
      min-height: 44px;
      --padding-start: 14px;
      --padding-end: 14px;
      font-size: 0.78rem;
    }

    @media (hover: hover) and (pointer: fine) {
      .business-card:hover {
        transform: translateY(-4px);
        border-color: rgba(99, 102, 241, 0.34);
        box-shadow: var(--shadow-card);
      }
    }

    @media (max-width: 599px) {
      .business-card:not(.variant-rail):not(.variant-mini-rail) {
        grid-template-columns: 96px minmax(0, 1fr);
        grid-template-rows: auto;
        align-items: stretch;
        min-height: 118px;
        border-radius: 18px;
      }

      .business-card:not(.variant-rail):not(.variant-mini-rail) .cover {
        width: 96px;
        height: 100%;
        min-height: 118px;
        aspect-ratio: auto;
      }

      .business-card:not(.variant-rail):not(.variant-mini-rail) .cover::after,
      .business-card:not(.variant-rail):not(.variant-mini-rail) .rating-pill,
      .business-card:not(.variant-rail):not(.variant-mini-rail) .cover-actions,
      .business-card:not(.variant-rail):not(.variant-mini-rail) .offer-pill,
      .business-card:not(.variant-rail):not(.variant-mini-rail) .topline {
        display: none;
      }

      .business-card:not(.variant-rail):not(.variant-mini-rail) .content {
        align-content: center;
        min-width: 0;
        padding: 10px 10px 10px 12px;
      }

      .business-card:not(.variant-rail):not(.variant-mini-rail) h3 {
        font-size: 0.98rem;
        line-height: 1.15;
        -webkit-line-clamp: 1;
      }

      .business-card:not(.variant-rail):not(.variant-mini-rail) .service-row {
        grid-template-columns: minmax(0, 1fr) auto;
        gap: 8px;
        margin-top: 2px;
        padding: 0;
        border: 0;
        background: transparent;
      }

      .business-card:not(.variant-rail):not(.variant-mini-rail) .service-row span,
      .business-card:not(.variant-rail):not(.variant-mini-rail) .footer-row > span {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .business-card:not(.variant-rail):not(.variant-mini-rail) .footer-row {
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto;
        padding-top: 0;
      }

      .business-card:not(.variant-rail):not(.variant-mini-rail) .footer-row ion-button {
        min-width: 84px;
        height: 44px;
        min-height: 44px;
      }

      .business-card.variant-rail {
        grid-template-columns: 68px minmax(0, 1fr) 44px;
        grid-template-rows: auto auto auto;
        gap: 3px 8px;
        align-items: center;
        width: 100%;
        min-width: 0;
        height: auto;
        min-height: 92px;
        padding: 8px;
        border-radius: 16px;
      }

      .business-card.variant-rail .cover {
        grid-row: span 3;
        width: 68px;
        height: 68px;
        border-radius: 14px;
      }

      .business-card.variant-rail .content {
        display: contents;
      }

      .business-card.variant-rail .rating-pill,
      .business-card.variant-rail .cover-actions,
      .business-card.variant-rail .offer-pill,
      .business-card.variant-rail .topline,
      .business-card.variant-rail .booking-row,
      .business-card.variant-rail .service-row strong,
      .business-card.variant-rail .footer-row > span {
        display: none;
      }

      .business-card.variant-rail h3,
      .business-card.variant-rail .business-meta,
      .business-card.variant-rail .service-row {
        min-width: 0;
        margin: 0;
        padding: 0;
        border: 0;
        background: transparent;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .business-card.variant-rail h3 {
        grid-column: 2;
        min-height: 0;
        display: block;
        color: var(--text);
        font-size: 0.86rem;
        line-height: 1.05;
      }

      .business-card.variant-rail .business-meta,
      .business-card.variant-rail .service-row span {
        color: var(--muted);
        font-size: 0.72rem;
        font-weight: 900;
      }

      .business-card.variant-rail .footer-row {
        grid-column: 3;
        grid-row: 1 / span 3;
        display: grid;
        padding: 0;
      }

      .business-card.variant-rail .footer-row ion-button {
        width: 44px;
        min-width: 44px;
        height: 44px;
        min-height: 44px;
        --padding-start: 0;
        --padding-end: 0;
        font-size: 0;
      }

      .business-card.variant-rail .business-location {
        display: none;
      }

      .business-card {
        border-radius: 16px;
      }

      .cover {
        aspect-ratio: auto;
        width: 100%;
        height: 92px;
      }

      .cover-fallback span {
        width: 52px;
        height: 52px;
        border-radius: 18px;
        font-size: 1.12rem;
      }

      .cover-fallback small {
        font-size: 0.62rem;
      }

      .cover img,
      .cover .image-fill {
        width: 100%;
        height: 100%;
        object-fit: cover;
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
        gap: 4px;
        padding: 8px 10px 10px;
      }

      .topline {
        gap: 6px;
      }

      .status-pill,
      .countdown-pill,
      .rating-pill,
      .offer-pill {
        min-height: 24px;
        padding-inline: 8px;
        font-size: 0.68rem;
      }

      h3 {
        margin-top: 0;
        font-size: 0.98rem;
        min-height: 0;
        display: -webkit-box;
        overflow: hidden;
        -webkit-box-orient: vertical;
        -webkit-line-clamp: 2;
      }

      .business-meta {
        font-size: 0.72rem;
        line-height: 1.2;
      }

      .service-row {
        margin-top: 3px;
        padding: 7px 9px;
        border-radius: 12px;
      }

      .service-row strong {
        font-size: 0.78rem;
      }

      .service-row span {
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .footer-row {
        align-items: center;
        flex-direction: row;
        gap: 6px;
        padding-top: 2px;
      }

      .footer-row ion-button {
        width: auto;
        min-width: 76px;
        min-height: 44px;
        margin: 0;
      }

      .footer-row > span {
        min-width: 0;
        font-size: 0.72rem;
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

    @media (min-width: 600px) and (max-width: 900px) {
      .business-card.variant-rail {
        grid-template-rows: minmax(104px, auto);
        grid-template-columns: 76px minmax(0, 1fr);
        align-items: stretch;
        width: 100%;
        min-width: 0;
        height: auto;
        min-height: 104px;
        padding: 0;
        overflow: hidden;
        border-radius: 16px;
      }

      .business-card.variant-rail .cover {
        grid-row: 1;
        width: 76px;
        height: 100%;
        min-height: 104px;
        aspect-ratio: auto;
        border-radius: 0;
      }

      .business-card.variant-rail .content {
        display: grid;
        align-content: center;
        gap: 4px;
        min-width: 0;
        padding: 8px 9px;
      }

      .business-card.variant-rail .rating-pill,
      .business-card.variant-rail .cover-actions,
      .business-card.variant-rail .offer-pill,
      .business-card.variant-rail .topline,
      .business-card.variant-rail .booking-row {
        display: none;
      }

      .business-card.variant-rail h3 {
        display: block;
        grid-column: auto;
        min-height: 0;
        margin: 0;
        overflow: hidden;
        font-size: 0.9rem;
        line-height: 1.2;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .business-card.variant-rail .business-meta {
        display: flex;
        margin: 0;
        overflow: hidden;
        font-size: 0.68rem;
        line-height: 1.2;
        white-space: nowrap;
      }

      .business-card.variant-rail .service-row span,
      .business-card.variant-rail .footer-row > span {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .business-card.variant-rail .footer-row {
        display: grid;
        grid-column: auto;
        grid-row: auto;
        grid-template-columns: minmax(0, 1fr) auto;
        align-items: center;
        gap: 5px;
        padding-top: 0;
      }

      .business-card.variant-rail .service-row {
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto;
        gap: 5px;
        margin-top: 0;
        padding: 0;
        border: 0;
        background: transparent;
        font-size: 0.68rem;
      }

      .business-card.variant-rail .service-row strong,
      .business-card.variant-rail .footer-row > span {
        display: inline-flex;
      }

      .business-card.variant-rail .footer-row ion-button {
        width: 68px;
        min-width: 68px;
        height: 44px;
        min-height: 44px;
        margin: 0;
        --padding-start: 9px;
        --padding-end: 9px;
        font-size: 0.72rem;
      }

    }

    @media (max-width: 599px) {

      .business-card.variant-discovery {
        width: 100%;
        min-width: 0;
        border-radius: 18px;
        box-shadow: 0 8px 22px rgba(28, 28, 28, 0.08);
      }

      .business-card.variant-discovery .cover {
        height: 124px;
      }

      .business-card.variant-discovery .content {
        gap: 5px;
        padding: 10px 12px 12px;
      }

      .business-card.variant-discovery .booking-status {
        font-size: 0.72rem;
      }

      .business-card.variant-discovery h3 {
        min-height: 0;
        margin-top: 0;
        font-size: 1.02rem;
        line-height: 1.12;
      }

      .business-card.variant-discovery .business-meta {
        font-size: 0.76rem;
      }

      .business-card.variant-discovery .service-row {
        margin-top: 2px;
        padding: 8px 10px;
        border-radius: 13px;
      }

      .business-card.variant-discovery .footer-row {
        gap: 8px;
        padding-top: 2px;
      }

      .business-card.variant-discovery .content,
      .business-card.variant-discovery .topline,
      .business-card.variant-discovery h3,
      .business-card.variant-discovery .business-meta,
      .business-card.variant-discovery .service-row,
      .business-card.variant-discovery .footer-row,
      .business-card.variant-discovery .service-row span,
      .business-card.variant-discovery .footer-row > span {
        min-width: 0;
      }

      .business-card.variant-discovery .service-row,
      .business-card.variant-discovery .footer-row {
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto;
        align-items: center;
      }

      .business-card.variant-discovery .service-row span,
      .business-card.variant-discovery .footer-row > span {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .business-card.variant-discovery .service-row strong {
        width: auto;
        min-width: max-content;
        max-width: 100%;
      }

      .business-card.variant-discovery .footer-row ion-button {
        width: 92px;
        min-width: 92px;
        max-width: 100%;
        min-height: 44px;
        margin: 0;
      }

      .business-card.variant-mini-rail {
        grid-template-columns: 52px minmax(0, 1fr);
        grid-template-rows: 74px;
        align-items: stretch;
        min-height: 74px;
        max-height: 74px;
        border-radius: 14px;
      }

      .business-card.variant-mini-rail .cover {
        grid-row: 1;
        width: 52px;
        height: 74px;
        min-height: 0;
      }

      .business-card.variant-mini-rail .content {
        align-content: center;
        gap: 3px;
        padding: 7px 8px;
      }

      .business-card.variant-mini-rail h3 {
        display: -webkit-box;
        overflow: hidden;
        font-size: 0.78rem;
        line-height: 1.12;
        white-space: normal;
        -webkit-box-orient: vertical;
        -webkit-line-clamp: 2;
      }

      .business-card.variant-mini-rail .business-meta {
        display: block;
        overflow: hidden;
        font-size: 0.61rem;
        line-height: 1.15;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .business-card.variant-mini-rail .rating-pill,
      .business-card.variant-mini-rail .cover-actions,
      .business-card.variant-mini-rail .offer-pill,
      .business-card.variant-mini-rail .topline,
      .business-card.variant-mini-rail .booking-row,
      .business-card.variant-mini-rail .service-row,
      .business-card.variant-mini-rail .footer-row {
        display: none;
      }

      .business-card.variant-mini-rail .cover-fallback {
        width: 100%;
        height: 100%;
        border-radius: 12px;
        padding: 0;
      }

      .business-card.variant-mini-rail .cover-fallback span {
        width: 36px;
        height: 36px;
        border-radius: 10px;
        font-size: 0.85rem;
      }

      .business-card.variant-mini-rail .cover-fallback small {
        display: none;
      }
    }

    @media (prefers-reduced-motion: reduce) {
      .business-card { transition: none; }
    }
  `]
})
export class BusinessCardComponent implements OnInit {
  @Input({ required: true }) business!: Business;
  @Input() featured = false;
  @Input() selectable = false;
  @Input() highlighted = false;
  @Input() variant: "default" | "personal" | "discovery" | "rail" | "miniRail" = "default";
  @Input() displayDistanceKm: number | null | undefined = undefined;
  @Input() userLocation: { lat: number; lng: number } | null = null;
  @Output() cardSelect = new EventEmitter<Business>();
  private readonly savedUserLocation = this.savedLocation();
  private imageFailed = false;
  favoritePending = false;
  savedSalonPending = false;

  constructor(private readonly marketplace: MarketplaceService, private readonly router: Router, private readonly clock: ClockService, private readonly feedback: CustomerFeedbackService) {
    addIcons({ bookmark, bookmarkOutline, globeOutline, heart, heartOutline, locationOutline, star, timeOutline });
  }

  ngOnInit() {
    void this.marketplace.ensureFavorites().catch(() => undefined);
    void this.marketplace.ensureSavedSalons().catch(() => undefined);
  }

  money(pricePaise: number): string {
    return this.marketplace.formatMoney(pricePaise);
  }

  /** Never surface "from ₹0" — hide the price until a real starting price exists. */
  priceLabel(): string {
    const price = Number(this.business.startingPricePaise);
    return price > 0 ? `from ${this.money(price)}` : "View prices";
  }

  /** Review count beside the rating, e.g. "4.5 · 120". */
  ratingCountText(): string {
    if (this.ratingText() === "New") return "";
    const count = Number(this.business.ratingCount || 0);
    return count > 0 ? ` · ${count}` : "";
  }

  supportsOnlineBooking(): boolean {
    return Array.isArray(this.business.paymentModes) && this.business.paymentModes.includes("online");
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

}
