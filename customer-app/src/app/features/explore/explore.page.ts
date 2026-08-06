import { Component, OnInit, computed, signal } from "@angular/core";
import { Router, RouterLink } from "@angular/router";
import { IonContent, IonIcon } from "@ionic/angular/standalone";
import { addIcons } from "ionicons";
import {
  bagHandleOutline,
  barbellOutline,
  bodyOutline,
  brushOutline,
  chevronForwardOutline,
  colorPaletteOutline,
  colorWandOutline,
  cutOutline,
  flashOutline,
  flowerOutline,
  leafOutline,
  locationOutline,
  mapOutline,
  medkitOutline,
  navigateOutline,
  optionsOutline,
  pricetagOutline,
  searchOutline,
  sparklesOutline,
  swapVerticalOutline,
  timeOutline,
  waterOutline
} from "ionicons/icons";
import { BusinessCardComponent } from "../../shared/business-card.component";
import { MarketplaceService } from "../../core/marketplace.service";
import { Business } from "../../core/api.types";

@Component({
  standalone: true,
  imports: [RouterLink, IonContent, IonIcon, BusinessCardComponent],
  template: `
    <ion-content>
      <main class="page explore-page">
        <header class="explore-header">
          <h1>Explore</h1>
          <button type="button" class="location-line" (click)="chooseLocation()">
            <ion-icon name="location-outline"></ion-icon>
            <span>{{ locationLabel() }}</span>
            <ion-icon name="chevron-forward-outline"></ion-icon>
          </button>
        </header>

        <section class="search-command" aria-labelledby="search-command-title">
          <button type="button" class="explore-search-bar" (click)="openSearch()">
            <ion-icon name="search-outline"></ion-icon>
            <span id="search-command-title" class="search-placeholder">Search salons, services or professionals</span>
            <ion-icon name="chevron-forward-outline"></ion-icon>
          </button>
          <nav class="search-tools" aria-label="Search tools">
            <a routerLink="/search" [queryParams]="{ panel: 'filter' }"><ion-icon name="options-outline"></ion-icon><span>Filter</span></a>
            <a routerLink="/search" [queryParams]="{ panel: 'sort' }"><ion-icon name="swap-vertical-outline"></ion-icon><span>Sort</span></a>
            <a routerLink="/search" [queryParams]="{ mode: 'locations', filter: 'nearest', sort: 'distance', nearMe: true, map: true }"><ion-icon name="map-outline"></ion-icon><span>Map</span></a>
          </nav>
        </section>

        <nav class="explore-chips" aria-label="Discovery shortcuts">
          <a routerLink="/search" [queryParams]="{ filter: 'nearest', sort: 'distance', nearMe: true }" class="chip" [class.active]="activeQuickFilter() === 'nearest'" (click)="rememberQuickFilter('nearest')"><ion-icon name="navigate-outline"></ion-icon> Near me</a>
          <a routerLink="/search" [queryParams]="{ filter: 'open' }" class="chip" [class.active]="activeQuickFilter() === 'open'" (click)="rememberQuickFilter('open')">Open now</a>
          <a routerLink="/search" [queryParams]="{ filter: 'top', sort: 'rating' }" class="chip" [class.active]="activeQuickFilter() === 'top'" (click)="rememberQuickFilter('top')">Top rated</a>
          <a routerLink="/search" [queryParams]="{ filter: 'deals' }" class="chip" [class.active]="activeQuickFilter() === 'deals'" (click)="rememberQuickFilter('deals')"><ion-icon name="pricetag-outline"></ion-icon> Offers</a>
        </nav>

        @if (nearby().length) {
          <section class="explore-section salon-group">
            <div class="explore-section-head"><div><span>{{ nearYouKicker() }}</span><h2>{{ nearbyHeading() }}</h2></div><a routerLink="/search" [queryParams]="{ filter: currentLocation() ? 'nearest' : undefined, sort: currentLocation() ? 'distance' : undefined, nearMe: currentLocation() ? true : undefined }">See all</a></div>
            <div class="salon-previews">@for (biz of nearby(); track biz.id) { <aura-business-card variant="discovery" [business]="biz" [userLocation]="currentLocation()"></aura-business-card> }</div>
          </section>
        }

        @if (openBusinessCount() > 0) {
          <a routerLink="/search" [queryParams]="{ filter: 'open', sort: currentLocation() ? 'distance' : undefined, nearMe: currentLocation() ? true : undefined }" class="open-banner">
            <span class="open-banner-icon"><ion-icon name="time-outline"></ion-icon></span>
            <span class="open-banner-copy"><strong>{{ openBusinessCount() }} {{ openBusinessCount() === 1 ? "salon" : "salons" }} open now</strong><small>{{ openBannerCopy() }}</small></span>
            <span class="open-banner-arrow"><ion-icon name="chevron-forward-outline"></ion-icon></span>
          </a>
        }

        <section class="explore-section">
          <div class="explore-section-head"><div><span>Find your treatment</span><h2>Browse categories</h2></div><a routerLink="/search">View all</a></div>
          <div class="explore-categories">
            @for (cat of mainCategories(); track cat.slug) {
              <a routerLink="/search" [queryParams]="{ q: cat.label, mode: 'services' }" class="category-card"><ion-icon [name]="categoryIcon(cat.label)" aria-hidden="true"></ion-icon><span>{{ cat.label }}</span></a>
            }
          </div>
        </section>

        @if (offers().length) {
          <section class="explore-section salon-group"><div class="explore-section-head"><div><span>Published by participating salons</span><h2>Offers worth exploring</h2></div><a routerLink="/search" [queryParams]="{ filter: 'deals' }">See all</a></div><div class="salon-previews">@for (biz of offers(); track biz.id) { <aura-business-card variant="discovery" [business]="biz" [userLocation]="currentLocation()"></aura-business-card> }</div></section>
        }

        <a routerLink="/tabs/consultation" class="concierge-card">
          <ion-icon name="sparkles-outline"></ion-icon>
          <div><h2>Aura Concierge</h2><p>Not sure what to book? Build a guided salon plan.</p></div>
          <b>Start <ion-icon name="chevron-forward-outline"></ion-icon></b>
        </a>

        @if (trending().length) {
          <section class="explore-section salon-group"><div class="explore-section-head"><div><span>Rating meets review momentum</span><h2>Trending now</h2></div><a routerLink="/search" [queryParams]="{ sort: 'reviews' }">See all</a></div><div class="salon-previews">@for (biz of trending(); track biz.id) { <aura-business-card variant="discovery" [business]="biz" [userLocation]="currentLocation()"></aura-business-card> }</div></section>
        }
        @if (newOpenings().length) {
          <section class="explore-section salon-group"><div class="explore-section-head"><div><span>Joined in the last 90 days</span><h2>New &amp; noteworthy</h2></div><a routerLink="/search" [queryParams]="{ sort: 'recommended' }">See all</a></div><div class="salon-previews">@for (biz of newOpenings(); track biz.id) { <aura-business-card variant="discovery" [business]="biz" [userLocation]="currentLocation()"></aura-business-card> }</div></section>
        } @else if (premium().length) {
          <section class="explore-section salon-group"><div class="explore-section-head"><div><span>Higher prices with ratings of 4.2+</span><h2>Premium edit</h2></div><a routerLink="/search" [queryParams]="{ filter: 'premium', sort: 'rating' }">See all</a></div><div class="salon-previews">@for (biz of premium(); track biz.id) { <aura-business-card variant="discovery" [business]="biz" [userLocation]="currentLocation()"></aura-business-card> }</div></section>
        }

        @if (popularServices().length) {
          <section class="explore-section"><div class="explore-section-head"><div><span>Popular on salon menus</span><h2>Services to discover</h2></div><a routerLink="/search" [queryParams]="{ mode: 'services' }">See all</a></div><div class="service-grid">@for (item of popularServices(); track item.business.id + item.name) { <a routerLink="/search" [queryParams]="{ q: item.name, mode: 'services' }"><span>{{ item.business.category }}</span><h3>{{ item.name }}</h3><p>{{ item.business.businessName }}</p><strong>{{ servicePriceLabel(item.business) }}</strong></a> }</div></section>
        }

        @if (professionals().length) {
          <section class="explore-section"><div class="explore-section-head"><div><span>Published team profiles</span><h2>Meet professionals</h2></div><a routerLink="/search" [queryParams]="{ mode: 'staff' }">See all</a></div><div class="professional-list">@for (item of professionals(); track item.staff.id + item.business.id) { <a routerLink="/search" [queryParams]="{ q: item.staff.name, mode: 'staff' }"><span class="professional-avatar">{{ initials(item.staff.name) }}</span><div><h3>{{ item.staff.name }}</h3><p>{{ item.staff.title || item.staff.specialty || 'Professional' }} · {{ item.business.businessName }}</p></div><ion-icon name="chevron-forward-outline"></ion-icon></a> }</div></section>
        }

        <!-- Loading -->
        @if (marketplace.loading()) {
        <section class="explore-loading">
          @for (i of [1,2,3]; track i) {
          <div class="skeleton-card"></div>
          }
        </section>
        }
        @if (!marketplace.loading() && marketplace.error()) {
          <section class="explore-state" role="alert"><h2>Discovery is taking a moment</h2><p>{{ marketplace.error() }}</p><button type="button" (click)="reload()">Try again</button></section>
        } @else if (!marketplace.loading() && !marketplace.businesses().length) {
          <section class="explore-state"><h2>No places to explore yet</h2><p>Try again when marketplace listings are available.</p></section>
        }
      </main>
    </ion-content>
  `,
  styles: [`
    /* Explore */
    .explore-page {
      display: grid;
      width: 100%;
      max-width: 1240px;
      gap: 28px;
      margin: 0 auto;
      padding: 18px 16px calc(76px + env(safe-area-inset-bottom));
      overflow-x: clip;
      scroll-padding-bottom: calc(76px + env(safe-area-inset-bottom));
    }

    .explore-page > *,
    .explore-section,
    .salon-previews,
    .service-grid,
    .professional-list {
      min-width: 0;
      max-width: 100%;
    }

    .explore-header {
      display: grid;
      gap: 2px;
      padding-top: 2px;
    }

    .explore-header h1 {
      margin: 0;
      color: var(--text);
      font-size: clamp(1.75rem, 8vw, 2.2rem);
      font-weight: 950;
      letter-spacing: -0.045em;
      line-height: 1;
    }

    .location-line {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      justify-self: start;
      min-width: 0;
      min-height: 44px;
      max-width: 100%;
      margin: 0;
      padding: 0 4px 0 2px;
      border: 0;
      border-radius: 12px;
      color: var(--muted);
      background: transparent;
      font: inherit;
      font-size: 0.82rem;
      font-weight: 800;
      line-height: 1.35;
      text-align: left;
      cursor: pointer;
      transition: background 160ms ease;
    }

    .location-line span {
      min-width: 0;
      overflow: hidden;
      color: var(--text);
      font-weight: 850;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .location-line ion-icon:first-child { flex: 0 0 auto; color: var(--primary); }
    .location-line ion-icon:last-child { flex: 0 0 auto; color: var(--muted); font-size: 0.72rem; }

    .search-command {
      display: grid;
      gap: 8px;
      padding: 8px;
      border: 1px solid var(--border);
      border-radius: 22px;
      background: var(--surface);
      box-shadow: 0 12px 30px rgba(28, 28, 28, 0.08);
    }

    .explore-search-bar {
      display: flex;
      align-items: center;
      width: 100%;
      min-height: 56px;
      gap: 10px;
      padding: 0 14px;
      border: 0;
      border-radius: 16px;
      color: var(--muted);
      background: var(--surface-soft);
      font: inherit;
      font-size: 0.9rem;
      font-weight: 800;
      text-align: left;
      cursor: pointer;
      transition: border-color 160ms ease, box-shadow 160ms ease;
    }

    .explore-search-bar .search-placeholder {
      flex: 1;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .explore-search-bar ion-icon { flex: 0 0 auto; color: var(--primary); font-size: 1.05rem; }

    .search-tools { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 6px; }
    .search-tools a {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      min-width: 0;
      min-height: 44px;
      padding: 0 8px;
      border: 1px solid var(--border);
      border-radius: 13px;
      color: var(--text);
      background: var(--surface);
      font-size: 0.84rem;
      font-weight: 900;
      text-decoration: none;
    }
    .search-tools ion-icon { color: var(--primary); }

    .explore-chips {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 8px;
      padding: 0;
    }

    .chip {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      justify-content: center;
      width: 100%;
      min-width: 0;
      min-height: 44px;
      padding: 0 10px;
      border: 1px solid var(--border);
      border-radius: 999px;
      color: var(--text);
      background: var(--surface);
      font-size: 0.84rem;
      font-weight: 900;
      text-decoration: none;
      transition: border-color 160ms ease, background 160ms ease;
      white-space: nowrap;
    }
    .chip ion-icon { color: var(--primary); font-size: 0.9rem; }
    .chip.active {
      color: #fff;
      border-color: var(--primary);
      background: var(--primary);
    }
    .chip.active ion-icon { color: #fff; }

    .explore-section { display: grid; gap: 12px; }
    .explore-section-head { display: flex; align-items: end; justify-content: space-between; gap: 12px; }
    .explore-section-head > div { min-width: 0; }
    .explore-section-head > div > span {
      display: block;
      color: var(--muted);
      font-size: 0.8rem;
      font-weight: 750;
      letter-spacing: 0;
      line-height: 1.3;
      text-transform: none;
    }

    .explore-section-head h2 {
      margin: 3px 0 0;
      color: var(--text);
      font-size: clamp(1.2rem, 5.4vw, 1.5rem);
      font-weight: 950;
      letter-spacing: -0.03em;
      line-height: 1.08;
    }

    .explore-section-head a {
      display: inline-flex;
      flex: 0 0 auto;
      align-items: center;
      min-height: 44px;
      padding-inline: 4px;
      color: var(--primary);
      font-size: 0.84rem;
      font-weight: 900;
      text-decoration: none;
      white-space: nowrap;
    }

    .open-banner {
      display: grid;
      grid-template-columns: 40px minmax(0, 1fr) auto;
      align-items: center;
      gap: 12px;
      min-height: 64px;
      padding: 10px 14px;
      border: 1px solid rgba(99, 102, 241, 0.2);
      border-radius: 18px;
      color: var(--text);
      background: linear-gradient(135deg, var(--primary-soft), var(--surface));
      text-decoration: none;
      transition: border-color 160ms ease, box-shadow 160ms ease;
    }

    .open-banner-icon {
      display: grid;
      place-items: center;
      width: 40px;
      height: 40px;
      border-radius: 13px;
      color: #fff;
      background: var(--primary);
    }

    .open-banner-copy { display: grid; gap: 2px; min-width: 0; }
    .open-banner-copy strong { font-size: 0.86rem; line-height: 1.2; }
    .open-banner-copy small { color: var(--muted); font-size: 0.78rem; line-height: 1.3; }
    .open-banner-arrow { color: var(--primary); }

    .explore-categories {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 8px;
      padding: 0;
    }

    .category-card {
      display: grid;
      align-content: center;
      justify-items: center;
      gap: 6px;
      width: 100%;
      min-width: 0;
      min-height: 82px;
      padding: 9px 4px 8px;
      border: 1px solid var(--border);
      border-radius: 16px;
      color: var(--text);
      background: var(--surface);
      box-shadow: none;
      font-size: 0.82rem;
      font-family: inherit;
      font-weight: 900;
      text-decoration: none;
      transition: border-color 160ms ease;
      white-space: normal;
      cursor: pointer;
    }

    .category-card ion-icon {
      width: 38px;
      height: 38px;
      padding: 10px;
      border-radius: 12px;
      color: #fff;
      background: linear-gradient(145deg, var(--brand-600), var(--brand-800));
      font-size: 1.05rem;
    }

    .category-card span {
      display: -webkit-box;
      width: 100%;
      min-width: 0;
      min-height: 2.4em;
      overflow: hidden;
      color: var(--text);
      font-size: 0.76rem;
      line-height: 1.2;
      text-align: center;
      overflow-wrap: anywhere;
      -webkit-box-orient: vertical;
      -webkit-line-clamp: 2;
    }

    .concierge-card {
      display: grid;
      grid-template-columns: 44px minmax(0, 1fr) auto;
      align-items: center;
      gap: 12px;
      min-height: 82px;
      padding: 14px;
      border: 1px solid rgba(99, 102, 241, 0.22);
      border-radius: 20px;
      color: var(--text);
      background: var(--surface);
      box-shadow: 0 10px 26px rgba(28, 28, 28, 0.07);
      text-decoration: none;
      transition: border-color 160ms ease, box-shadow 160ms ease;
    }

    .concierge-card > ion-icon {
      width: 44px;
      height: 44px;
      padding: 11px;
      border-radius: 14px;
      color: #fff;
      background: linear-gradient(145deg, var(--brand-600), var(--primary));
    }

    .concierge-card > div { display: grid; gap: 2px; min-width: 0; }
    .concierge-card h2 { margin: 0; font-size: 0.9rem; line-height: 1.2; }
    .concierge-card p { margin: 0; color: var(--muted); font-size: 0.8rem; line-height: 1.35; }
    .concierge-card b { display: inline-flex; align-items: center; gap: 4px; color: var(--primary); font-size: 0.84rem; font-weight: 900; white-space: nowrap; }

    .salon-group { gap: 14px; }
    .salon-previews {
      display: grid;
      grid-template-columns: minmax(0, 1fr);
      gap: 12px;
    }

    .salon-previews aura-business-card {
      display: block;
      width: 100%;
      min-width: 0;
    }

    .salon-previews aura-business-card:nth-child(n + 3) { display: none; }

    .service-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 8px;
    }

    .service-grid > a {
      display: grid;
      align-content: start;
      min-width: 0;
      min-height: 132px;
      padding: 13px;
      border: 1px solid var(--border);
      border-radius: 17px;
      color: var(--text);
      background: var(--surface);
      text-decoration: none;
    }

    .service-grid > a:nth-child(n + 5) { display: none; }
    .service-grid span { color: var(--primary); font-size: 0.74rem; font-weight: 850; line-height: 1.2; }
    .service-grid h3 { display: -webkit-box; margin: 6px 0 3px; overflow: hidden; font-size: 0.9rem; line-height: 1.18; -webkit-box-orient: vertical; -webkit-line-clamp: 2; }
    .service-grid p { min-width: 0; margin: 0; overflow: hidden; color: var(--muted); font-size: 0.78rem; line-height: 1.25; text-overflow: ellipsis; white-space: nowrap; }
    .service-grid strong { align-self: end; margin-top: 12px; color: var(--primary); font-size: 0.82rem; }

    .professional-list {
      display: grid;
      grid-template-columns: minmax(0, 1fr);
      gap: 8px;
    }

    .professional-list > a {
      display: grid;
      grid-template-columns: 46px minmax(0, 1fr) auto;
      align-items: center;
      gap: 10px;
      width: 100%;
      min-width: 0;
      min-height: 72px;
      padding: 10px 12px;
      border: 1px solid var(--border);
      border-radius: 17px;
      color: var(--text);
      background: var(--surface);
      text-decoration: none;
    }

    .professional-list > a:nth-child(n + 5) { display: none; }
    .professional-list > a > div { min-width: 0; }
    .professional-list .professional-avatar { display: grid; place-items: center; width: 46px; height: 46px; border-radius: 14px; color: #fff; background: linear-gradient(145deg, var(--brand-600), var(--brand-800)); font-size: 0.78rem; font-weight: 950; }
    .professional-list h3 { margin: 0 0 3px; overflow: hidden; font-size: 0.9rem; text-overflow: ellipsis; white-space: nowrap; }
    .professional-list p { margin: 0; overflow: hidden; color: var(--muted); font-size: 0.78rem; line-height: 1.3; text-overflow: ellipsis; white-space: nowrap; }
    .professional-list > a > ion-icon { color: var(--primary); }

    .explore-loading { display: grid; grid-template-columns: minmax(0, 1fr); gap: 12px; }
    .skeleton-card { height: 260px; border-radius: 16px; background: linear-gradient(90deg, rgba(99, 102, 241, 0.06), rgba(99, 102, 241, 0.14), rgba(99, 102, 241, 0.06)); background-size: 200% 100%; animation: shimmer 1.5s infinite; }
    .explore-state { display: grid; justify-items: start; gap: 8px; padding: 22px; border: 1px solid var(--border); border-radius: 22px; background: var(--surface); }
    .explore-state h2, .explore-state p { margin: 0; }
    .explore-state h2 { color: var(--text); font-size: 1.2rem; }
    .explore-state p { color: var(--muted); line-height: 1.5; }
    .explore-state button { min-height: 44px; margin-top: 4px; padding: 0 18px; border: 0; border-radius: 999px; color: #fff; background: var(--primary); font: inherit; font-weight: 900; }
    ion-content::part(scroll) { scroll-padding-bottom: calc(76px + env(safe-area-inset-bottom)); }

    @keyframes shimmer {
      0% { background-position: 200% 0; }
      100% { background-position: -200% 0; }
    }

    @media (hover: hover) and (pointer: fine) {
      .location-line:hover { background: var(--surface-soft); }
      .explore-search-bar:hover { border-color: rgba(99, 102, 241, 0.4); box-shadow: 0 12px 28px rgba(28, 28, 28, 0.09); }
      .chip:hover { border-color: rgba(99, 102, 241, 0.4); background: var(--primary-soft); }
      .chip.active:hover { border-color: var(--primary); background: var(--primary); }
      .category-card:hover { border-color: rgba(99, 102, 241, 0.4); }
      .open-banner:hover { border-color: rgba(99, 102, 241, 0.4); box-shadow: 0 14px 30px rgba(28, 28, 28, 0.09); }
      .concierge-card:hover { border-color: rgba(99, 102, 241, 0.4); box-shadow: 0 16px 34px rgba(28, 28, 28, 0.11); }
    }

    a:focus-visible, button:focus-visible { outline: 3px solid rgba(99, 102, 241, 0.42); outline-offset: 3px; }

    @media (max-width: 349px) {
      .explore-categories { grid-template-columns: repeat(3, minmax(0, 1fr)); }
      .service-grid { grid-template-columns: minmax(0, 1fr); }
      .concierge-card { grid-template-columns: 44px minmax(0, 1fr); }
      .concierge-card b { grid-column: 2; }
    }

    @media (min-width: 600px) {
      .explore-page { gap: 36px; padding-inline: 22px; }
      .explore-chips { display: flex; flex-wrap: wrap; }
      .chip { width: auto; padding-inline: 16px; }
      .explore-categories { grid-template-columns: repeat(6, minmax(0, 1fr)); }
      .salon-previews { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .salon-previews aura-business-card:nth-child(n + 3) { display: block; }
      .service-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .service-grid > a:nth-child(n + 5),
      .professional-list > a:nth-child(n + 5) { display: grid; }
      .professional-list { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .explore-loading { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    }

    @media (min-width: 700px) {
      .search-command { grid-template-columns: minmax(0, 1fr) auto; align-items: center; }
      .search-tools { min-width: 260px; }
    }

    @media (min-width: 900px) {
      .explore-page { padding-inline: 28px; }
      .explore-categories { grid-template-columns: repeat(8, minmax(0, 1fr)); }
      .salon-previews { grid-template-columns: repeat(3, minmax(0, 1fr)); }
      .service-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); }
      .professional-list { grid-template-columns: repeat(3, minmax(0, 1fr)); }
    }

    @media (min-width: 1200px) {
      .salon-previews { grid-template-columns: repeat(4, minmax(0, 1fr)); }
    }

    @media (prefers-reduced-motion: reduce) {
      .skeleton-card { animation: none; }
      .explore-search-bar, .chip, .category-card, .open-banner, .concierge-card { transition: none; }
    }
  `]
})
export class ExplorePage implements OnInit {
  private static readonly FILTER_STORAGE_KEY = "aura_explore_last_filter";

  readonly areaLabel = signal(this.savedAreaLabel());
  readonly locationLabel = computed(() => this.areaLabel() || "Choose location");
  readonly activeQuickFilter = signal(this.lastQuickFilter());
  readonly currentLocation = signal<{ lat: number; lng: number } | null>(null);
  readonly skeletons = [1, 2, 3];

  /** Keyword map: if raw category contains any keyword → it belongs to that main bucket */
  private static readonly GROUP_MAP: Array<{ main: string; keywords: string[] }> = [
    { main: "Hair",       keywords: ["hair", "shampoo", "conditioning", "keratin", "smoothen", "straighten", "curl", "rebond", "scalp", "hair spa", "head massage"] },
    { main: "Skin",       keywords: ["skin", "facial", "peel", "glow", "acne", "pigment", "brighten", "derma", "anti aging", "blemish", "tan removal", "bleach"] },
    { main: "Nails",      keywords: ["nail", "manicure", "pedicure", "gel", "acrylic", "nail art"] },
    { main: "Makeup",     keywords: ["makeup", "bridal", "party makeup", "base", "contour", "foundation"] },
    { main: "Massage",    keywords: ["massage", "body massage", "aroma", "deep tissue", "swedish", "thai", "balinese"] },
    { main: "Waxing",     keywords: ["wax", "waxing", "strip", " Rica", "sugaring", "threading", "epil"] },
    { main: "Shaving",    keywords: ["shav", "beard", "trim", "razor"] },
    { main: "Spa",        keywords: ["spa", "steam", "sauna", "wrap", "scrub", "polish", "body polish"] },
    { main: "Fitness",    keywords: ["fitness", "gym", "yoga", "pilates", " workout"] },
    { main: "Tattoo",     keywords: ["tattoo", "pierc", "ink"] },
    { main: "Extensions", keywords: ["extension", "weave", "wig", "toupee"] },
    { main: "Therapy",    keywords: ["therap", "ayurveda", "acupressure", "reflexology", "physio"] },
  ];

  /** Icons for the same main buckets; unmatched labels fall back to sparkles. */
  private static readonly ICON_MAP: Array<{ keywords: string[]; icon: string }> = [
    { keywords: ["hair", "shampoo", "scalp", "keratin"], icon: "cut-outline" },
    { keywords: ["skin", "facial", "glow", "derma", "bleach", "tan"], icon: "flower-outline" },
    { keywords: ["nail", "manicure", "pedicure", "gel", "acrylic"], icon: "color-palette-outline" },
    { keywords: ["makeup", "bridal", "foundation", "contour"], icon: "brush-outline" },
    { keywords: ["massage"], icon: "body-outline" },
    { keywords: ["wax", "sugaring", "threading", "epil"], icon: "leaf-outline" },
    { keywords: ["shav", "beard", "trim", "razor"], icon: "flash-outline" },
    { keywords: ["spa", "steam", "scrub", "polish", "wrap"], icon: "water-outline" },
    { keywords: ["fitness", "gym", "yoga", "pilates"], icon: "barbell-outline" },
    { keywords: ["tattoo", "pierc", "ink"], icon: "color-wand-outline" },
    { keywords: ["extension", "weave", "wig"], icon: "bag-handle-outline" },
    { keywords: ["therap", "ayurveda", "acupressure", "reflexology", "physio"], icon: "medkit-outline" },
  ];

  /** Words that read as filler when they lead an uncategorized label ("Complementary therapies"). */
  private static readonly LABEL_FILLERS = new Set(["complementary", "advanced", "premium", "signature", "luxury", "classic", "exclusive", "special", "modern", "professional"]);

  readonly mainCategories = computed(() => {
    const raw = this.marketplace.categories();
    const grouped = new Map<string, string>(); // mainLabel → first matching raw slug for query
    for (const cat of raw) {
      const lower = cat.label.toLowerCase();
      let matched = false;
      for (const group of ExplorePage.GROUP_MAP) {
        if (group.keywords.some((kw) => lower.includes(kw))) {
          if (!grouped.has(group.main)) {
            grouped.set(group.main, cat.slug);
          }
          matched = true;
          break;
        }
      }
      if (!matched) {
        grouped.set(this.shortLabel(cat.label), cat.slug);
      }
    }
    return Array.from(grouped, ([label, slug]) => ({ label, slug })).slice(0, 8);
  });

  readonly nearYouKicker = computed(() =>
    this.currentLocation() && this.marketplace.businesses().some((business) => business.distanceKm != null && Number(business.distanceKm) > 0)
      ? "Sorted by distance"
      : "Recommended for you"
  );

  readonly nearbyHeading = computed(() => this.currentLocation() ? `Salons near ${this.locationLabel()}` : "Recommended salons");
  readonly openBannerCopy = computed(() => this.currentLocation() ? `Currently taking bookings near ${this.locationLabel()}` : "Currently taking bookings");

  readonly nearby = computed(() => {
    const businesses = this.marketplace.businesses();
    const located = businesses
      .filter((business) => business.distanceKm != null && Number(business.distanceKm) > 0)
      .sort((left, right) => Number(left.distanceKm) - Number(right.distanceKm));
    if (located.length >= 3) return located.slice(0, 4);
    return [...businesses]
      .filter((business) => Number(business.ratingCount || 0) > 0)
      .sort((left, right) => Number(right.ratingAverage || 0) - Number(left.ratingAverage || 0) || Number(right.ratingCount || 0) - Number(left.ratingCount || 0))
      .slice(0, 4);
  });

  readonly openBusinessCount = computed(() => this.marketplace.businesses().filter((business) => business.isOpen).length);

  readonly offers = computed(() => this.takeWithExclusions(
    this.marketplace.businesses().filter((business) => business.hasOffer),
    this.nearby(),
    4
  ));

  readonly trending = computed(() => this.takeWithExclusions(
    [...this.marketplace.businesses()]
      .filter((business) => Number(business.ratingCount || 0) > 0)
      .sort((left, right) => this.trendingScore(right) - this.trendingScore(left)),
    [...this.nearby(), ...this.offers()],
    4
  ));

  readonly topRated = computed(() => [...this.marketplace.businesses()]
    .filter((business) => Number(business.ratingCount || 0) > 0 && Number(business.ratingAverage || 0) > 0)
    .sort((left, right) => Number(right.ratingAverage) - Number(left.ratingAverage) || Number(right.ratingCount) - Number(left.ratingCount))
    .slice(0, 4));

  readonly newOpenings = computed(() => {
    const now = Date.now();
    const ninetyDays = 90 * 24 * 60 * 60 * 1000;
    const recent = [...this.marketplace.businesses()]
      .filter((business) => {
        const createdAt = business.createdAt ? new Date(business.createdAt).getTime() : Number.NaN;
        return Number.isFinite(createdAt) && createdAt <= now && now - createdAt <= ninetyDays;
      })
      .sort((left, right) => new Date(right.createdAt || 0).getTime() - new Date(left.createdAt || 0).getTime());
    return this.takeWithExclusions(recent, [...this.nearby(), ...this.offers(), ...this.trending()], 4);
  });

  readonly premium = computed(() => {
    const priced = this.marketplace.businesses().filter((business) => Number(business.startingPricePaise || 0) > 0);
    const prices = priced.map((business) => business.startingPricePaise).sort((left, right) => left - right);
    const threshold = prices[Math.floor((prices.length - 1) * 0.65)] || 0;
    const candidates = priced
      .filter((business) => business.startingPricePaise >= threshold && Number(business.ratingAverage || 0) >= 4.2)
      .sort((left, right) => Number(right.ratingAverage) - Number(left.ratingAverage) || right.startingPricePaise - left.startingPricePaise);
    return this.takeWithExclusions(candidates, [...this.nearby(), ...this.offers(), ...this.trending(), ...this.newOpenings()], 4);
  });

  readonly popularServices = computed(() => this.marketplace.businesses().flatMap((business) => {
    const published = business.services.filter((service) => service.popular).map((service) => service.name);
    const names = business.popularService ? [business.popularService, ...published] : published;
    return [...new Set(names.filter(Boolean))].map((name) => ({ name, business }));
  }).slice(0, 8));

  readonly professionals = computed(() => this.marketplace.businesses()
    .flatMap((business) => business.staff.map((staff) => ({ staff, business })))
    .slice(0, 10));

  readonly recentlyViewed = computed(() => {
    try {
      const raw = localStorage.getItem("aura_recently_viewed");
      const history: Array<{ id?: string; slug?: string }> = raw ? JSON.parse(raw) : [];
      const businesses = this.marketplace.businesses();
      return history
        .map((item) => businesses.find((b) => b.id === item.id || b.slug === item.slug))
        .filter((b): b is Business => !!b)
        .slice(0, 4);
    } catch {
      return [];
    }
  });

  constructor(
    readonly marketplace: MarketplaceService,
    private readonly router: Router
  ) {
    addIcons({
      bagHandleOutline,
      barbellOutline,
      bodyOutline,
      brushOutline,
      chevronForwardOutline,
      colorPaletteOutline,
      colorWandOutline,
      cutOutline,
      flashOutline,
      flowerOutline,
      leafOutline,
      locationOutline,
      mapOutline,
      medkitOutline,
      navigateOutline,
      optionsOutline,
      pricetagOutline,
      searchOutline,
      sparklesOutline,
      swapVerticalOutline,
      timeOutline,
      waterOutline
    });

    const saved = localStorage.getItem("aura_customer_location");
    if (saved) {
      try { this.currentLocation.set(JSON.parse(saved)); } catch {}
    }
  }

  ngOnInit() {
    void Promise.all([
      this.marketplace.loadPublicBusinesses(),
      this.marketplace.loadCategories(),
      this.marketplace.isAuthenticated() ? this.marketplace.loadCustomer() : Promise.resolve(null),
      this.marketplace.isAuthenticated() ? this.marketplace.loadBookings() : Promise.resolve([]),
      this.marketplace.isAuthenticated() ? this.marketplace.loadMySalons().catch(() => null) : Promise.resolve(null)
    ]).catch(() => undefined);
  }

  money(pricePaise: number): string {
    return this.marketplace.formatMoney(pricePaise);
  }

  /** Never surface "from ₹0" — hide the price until a real starting price exists. */
  servicePriceLabel(business: Business): string {
    const price = Number(business.startingPricePaise);
    return price > 0 ? `From ${this.money(price)}` : "View prices";
  }

  initials(name: string): string {
    return String(name || "Aura").trim().split(/\s+/).filter(Boolean).slice(0, 2).map((word) => word.charAt(0).toUpperCase()).join("") || "A";
  }

  categoryIcon(label: string): string {
    const lower = label.toLowerCase();
    for (const map of ExplorePage.ICON_MAP) {
      if (map.keywords.some((keyword) => lower.includes(keyword))) return map.icon;
    }
    return "sparkles-outline";
  }

  rememberQuickFilter(key: string) {
    this.activeQuickFilter.set(key);
    try { window.sessionStorage.setItem(ExplorePage.FILTER_STORAGE_KEY, key); } catch {}
  }

  openSearch() {
    void this.router.navigate(["/search"]);
  }

  chooseLocation() {
    void this.router.navigate(["/search"], { queryParams: { mode: "locations", nearMe: true } });
  }

  reload() {
    void Promise.all([this.marketplace.loadPublicBusinesses(), this.marketplace.loadCategories()]).catch(() => undefined);
  }

  private lastQuickFilter(): string | null {
    try { return window.sessionStorage.getItem(ExplorePage.FILTER_STORAGE_KEY); } catch { return null; }
  }

  private shortLabel(label: string): string {
    const words = String(label || "").split(/\s+/).filter(Boolean);
    if (!words.length) return label || "Other";
    if (words.length === 1) return words[0].slice(0, 16);
    const first = words[0];
    const candidate = ExplorePage.LABEL_FILLERS.has(first.toLowerCase()) ? words[words.length - 1] : first;
    return candidate.length <= 16 ? candidate : candidate.slice(0, 16);
  }

  private savedAreaLabel(): string {
    try {
      if (!localStorage.getItem("aura_customer_location")) return "";
      const label = String(localStorage.getItem("aura_customer_area_label") || "").trim();
      return label && !/^(near me|near you|current location|choose location)$/i.test(label) ? label : "Detected area";
    } catch {
      return "";
    }
  }

  /** Returns the first `limit` items not already present in `excluded` (matched by id). */
  private takeWithExclusions<T extends { id?: string }>(items: T[], excluded: Array<{ id?: string }>, limit: number): T[] {
    const seen = new Set<string>();
    for (const item of excluded) {
      if (item.id) seen.add(item.id);
    }
    const result: T[] = [];
    for (const item of items) {
      if (result.length >= limit) break;
      if (item.id && seen.has(item.id)) continue;
      result.push(item);
      if (item.id) seen.add(item.id);
    }
    return result;
  }

  private trendingScore(business: Business): number {
    return Number(business.ratingAverage || 0) * Math.log2(Number(business.ratingCount || 0) + 1);
  }
}
