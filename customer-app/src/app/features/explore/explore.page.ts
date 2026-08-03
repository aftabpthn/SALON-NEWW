import { Component, OnInit, computed, signal } from "@angular/core";
import { Router, RouterLink } from "@angular/router";
import { IonContent, IonIcon } from "@ionic/angular/standalone";
import { addIcons } from "ionicons";
import {
  businessOutline,
  chevronForwardOutline,
  locationOutline,
  mapOutline,
  navigateOutline,
  optionsOutline,
  pricetagOutline,
  ribbonOutline,
  searchOutline,
  sparklesOutline,
  swapVerticalOutline,
  timeOutline
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
          <p><ion-icon name="location-outline"></ion-icon><span>Discovering around <strong>{{ areaLabel() }}</strong></span></p>
        </header>

        <section class="search-command" aria-labelledby="search-command-title">
          <button type="button" class="explore-search-bar" (click)="openSearch()">
            <ion-icon name="search-outline"></ion-icon>
            <span><strong id="search-command-title">What are you looking for?</strong><small>Salons, services, professionals or an area</small></span>
            <ion-icon name="chevron-forward-outline"></ion-icon>
          </button>
          <nav class="search-tools" aria-label="Search tools">
            <a routerLink="/search" [queryParams]="{ panel: 'filter' }"><ion-icon name="options-outline"></ion-icon><span>Filter</span></a>
            <a routerLink="/search" [queryParams]="{ panel: 'sort' }"><ion-icon name="swap-vertical-outline"></ion-icon><span>Sort</span></a>
            <a routerLink="/search" [queryParams]="{ mode: 'locations', filter: 'nearest', sort: 'distance', nearMe: true, map: true }"><ion-icon name="map-outline"></ion-icon><span>Map</span></a>
          </nav>
        </section>

        <nav class="explore-chips" aria-label="Discovery shortcuts">
          <a routerLink="/search" [queryParams]="{ filter: 'nearest', sort: 'distance', nearMe: true }" class="chip"><ion-icon name="navigate-outline"></ion-icon> Near me</a>
          <a routerLink="/search" [queryParams]="{ filter: 'open' }" class="chip">Open now</a>
          <a routerLink="/search" [queryParams]="{ filter: 'top', sort: 'rating' }" class="chip">Top rated</a>
          <a routerLink="/search" [queryParams]="{ filter: 'deals' }" class="chip"><ion-icon name="pricetag-outline"></ion-icon> Offers</a>
        </nav>

        <section class="explore-section">
          <div class="explore-section-head"><div><span>Find your treatment</span><h2>Browse categories</h2></div></div>
          <div class="explore-categories">
            @for (cat of featuredCategories(); track cat.slug) {
              <a routerLink="/search" [queryParams]="{ q: cat.label, mode: 'services' }" class="category-card"><b aria-hidden="true">{{ cat.label.slice(0, 1) }}</b><span>{{ cat.label }}</span></a>
            }
            @if (!showAllCategories()) {
              <button type="button" class="category-card category-view-all" (click)="showAllCategories.set(true)"><b aria-hidden="true">+</b><span>View all</span></button>
            } @else {
              <button type="button" class="category-card category-view-all" (click)="showAllCategories.set(false)"><b aria-hidden="true">−</b><span>View less</span></button>
            }
          </div>
        </section>

        <section class="discovery-feature" aria-labelledby="discovery-feature-title">
          @if (editorialCollections()[0]; as collection) {
            <a routerLink="/search" [queryParams]="collection.queryParams" class="feature-primary">
              <span>Around {{ areaLabel() }}</span>
              <h2 id="discovery-feature-title">{{ collection.title }}</h2>
              <p>{{ collection.description }}</p>
              <strong>Browse open salons <ion-icon name="chevron-forward-outline"></ion-icon></strong>
            </a>
          }
          <nav class="collection-actions" aria-label="Curated collections">
            @if (editorialCollections()[1]; as collection) {
              <a routerLink="/search" [queryParams]="collection.queryParams"><span>{{ collection.title }}</span><ion-icon name="chevron-forward-outline"></ion-icon></a>
            }
            <a routerLink="/search" [queryParams]="{ filter: 'today', sort: 'earliest' }"><span>Available today</span><ion-icon name="chevron-forward-outline"></ion-icon></a>
            <a routerLink="/search" [queryParams]="{ filter: 'top', sort: 'rating' }"><span>Top rated</span><ion-icon name="chevron-forward-outline"></ion-icon></a>
          </nav>
          <a routerLink="/tabs/consultation" class="concierge-callout">
            <ion-icon name="sparkles-outline"></ion-icon>
            <div><h2>Aura Concierge</h2><p>Not sure what to book? Build a guided salon plan.</p></div>
            <b>Start <ion-icon name="chevron-forward-outline"></ion-icon></b>
          </a>
        </section>

        @if (trending().length) {
          <section class="explore-section salon-group"><div class="explore-section-head"><div><span>Rating meets review momentum</span><h2>Trending now</h2></div><a routerLink="/search" [queryParams]="{ sort: 'reviews' }">See all</a></div><div class="salon-previews">@for (biz of trending(); track biz.id) { <aura-business-card variant="discovery" [business]="biz" [userLocation]="currentLocation()"></aura-business-card> }</div></section>
        }
        @if (newOpenings().length) {
          <section class="explore-section salon-group"><div class="explore-section-head"><div><span>Joined in the last 90 days</span><h2>New &amp; noteworthy</h2></div><a routerLink="/search" [queryParams]="{ sort: 'recommended' }">See all</a></div><div class="salon-previews">@for (biz of newOpenings(); track biz.id) { <aura-business-card variant="discovery" [business]="biz" [userLocation]="currentLocation()"></aura-business-card> }</div></section>
        } @else if (premium().length) {
          <section class="explore-section salon-group"><div class="explore-section-head"><div><span>Higher prices with ratings of 4.2+</span><h2>Premium edit</h2></div><a routerLink="/search" [queryParams]="{ filter: 'premium', sort: 'rating' }">See all</a></div><div class="salon-previews">@for (biz of premium(); track biz.id) { <aura-business-card variant="discovery" [business]="biz" [userLocation]="currentLocation()"></aura-business-card> }</div></section>
        }
        @if (offers().length) {
          <section class="explore-section salon-group"><div class="explore-section-head"><div><span>Published by participating salons</span><h2>Offers worth exploring</h2></div><a routerLink="/search" [queryParams]="{ filter: 'deals' }">See all</a></div><div class="salon-previews">@for (biz of offers(); track biz.id) { <aura-business-card variant="discovery" [business]="biz" [userLocation]="currentLocation()"></aura-business-card> }</div></section>
        }

        @if (popularServices().length) {
          <section class="explore-section"><div class="explore-section-head"><div><span>Popular on salon menus</span><h2>Services to discover</h2></div><a routerLink="/search" [queryParams]="{ mode: 'services' }">See all</a></div><div class="service-grid">@for (item of popularServices(); track item.business.id + item.name) { <a routerLink="/search" [queryParams]="{ q: item.name, mode: 'services' }"><span>{{ item.business.category }}</span><h3>{{ item.name }}</h3><p>{{ item.business.businessName }}</p><strong>From {{ money(item.business.startingPricePaise) }}</strong></a> }</div></section>
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
      padding: 18px 16px calc(156px + env(safe-area-inset-bottom));
      overflow-x: clip;
      scroll-padding-bottom: calc(156px + env(safe-area-inset-bottom));
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
      gap: 5px;
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

    .explore-header p {
      display: flex;
      align-items: center;
      gap: 6px;
      min-width: 0;
      margin: 0;
      color: var(--muted);
      font-size: 0.82rem;
      line-height: 1.35;
    }

    .explore-header p span {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .explore-header p strong { color: var(--text); font-weight: 850; }
    .explore-header p ion-icon { flex: 0 0 auto; color: var(--primary); }

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
      min-height: 62px;
      gap: 10px;
      padding: 10px 12px;
      border: 0;
      border-radius: 16px;
      color: var(--muted);
      background: var(--surface-soft);
      font: inherit;
      font-weight: 800;
      text-align: left;
      cursor: pointer;
      transition: border-color 160ms ease, box-shadow 160ms ease;
    }

    .explore-search-bar > span { display: grid; flex: 1; gap: 2px; min-width: 0; }
    .explore-search-bar strong { color: var(--text); font-size: 0.94rem; }
    .explore-search-bar small { overflow: hidden; color: var(--muted); font-size: 0.76rem; line-height: 1.35; text-overflow: ellipsis; white-space: nowrap; }
    .explore-search-bar ion-icon { flex: 0 0 auto; color: var(--primary); font-size: 1.1rem; }

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
      font-size: 0.76rem;
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
      font-size: 0.78rem;
      font-weight: 900;
      text-decoration: none;
      transition: border-color 160ms ease, background 160ms ease;
      white-space: nowrap;
    }
    .chip ion-icon { color: var(--primary); font-size: 0.9rem; }

    .explore-section { display: grid; gap: 12px; }
    .explore-section-head { display: flex; align-items: end; justify-content: space-between; gap: 12px; }
    .explore-section-head > div { min-width: 0; }
    .explore-section-head > div > span {
      display: block;
      color: var(--muted);
      font-size: 0.72rem;
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
      font-size: 0.78rem;
      font-weight: 900;
      text-decoration: none;
      white-space: nowrap;
    }

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
      font-size: 0.74rem;
      font-family: inherit;
      font-weight: 900;
      text-decoration: none;
      transition: border-color 160ms ease;
      white-space: normal;
      cursor: pointer;
    }

    .category-card b {
      display: grid;
      place-items: center;
      width: 38px;
      height: 38px;
      border-radius: 12px;
      color: #fff;
      background: linear-gradient(145deg, var(--brand-600), var(--brand-800));
      font-size: 1rem;
    }

    .category-card span {
      display: -webkit-box;
      width: 100%;
      min-width: 0;
      min-height: 2.4em;
      overflow: hidden;
      color: var(--text);
      font-size: 0.68rem;
      line-height: 1.2;
      text-align: center;
      overflow-wrap: anywhere;
      -webkit-box-orient: vertical;
      -webkit-line-clamp: 2;
    }

    .category-view-all {
      border-color: rgba(99, 102, 241, 0.26);
      background: var(--primary-soft);
    }

    .category-view-all b {
      background: var(--primary);
    }

    .discovery-feature {
      display: grid;
      gap: 10px;
    }

    .feature-primary {
      display: grid;
      align-content: end;
      min-height: 184px;
      padding: 20px;
      overflow: hidden;
      border-radius: 24px;
      color: #fff;
      background:
        radial-gradient(circle at 90% 8%, rgba(255, 255, 255, 0.15), transparent 34%),
        linear-gradient(145deg, var(--brand-800), var(--primary));
      text-decoration: none;
      box-shadow: 0 16px 34px rgba(28, 28, 28, 0.14);
    }

    .feature-primary > span {
      color: rgba(255, 255, 255, 0.76);
      font-size: 0.74rem;
      font-weight: 800;
    }

    .feature-primary h2 {
      margin: 5px 0 6px;
      color: #fff;
      font-size: clamp(1.45rem, 7vw, 2rem);
      letter-spacing: -0.04em;
      line-height: 1;
    }

    .feature-primary p {
      max-width: 460px;
      margin: 0 0 14px;
      color: rgba(255, 255, 255, 0.78);
      font-size: 0.82rem;
      line-height: 1.45;
    }

    .feature-primary strong,
    .concierge-callout b {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      color: #fff;
      font-size: 0.8rem;
      font-weight: 900;
    }

    .collection-actions {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 8px;
    }

    .collection-actions a {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      align-items: center;
      gap: 3px;
      min-width: 0;
      min-height: 58px;
      padding: 9px 8px;
      border: 1px solid var(--border);
      border-radius: 15px;
      color: var(--text);
      background: var(--surface);
      font-size: 0.69rem;
      font-weight: 850;
      line-height: 1.2;
      text-decoration: none;
    }

    .collection-actions span { min-width: 0; overflow-wrap: anywhere; }
    .collection-actions ion-icon { flex: 0 0 auto; color: var(--primary); font-size: 0.82rem; }

    .concierge-callout {
      display: grid;
      grid-template-columns: 44px minmax(0, 1fr) auto;
      align-items: center;
      gap: 10px;
      min-height: 78px;
      padding: 12px;
      border: 1px solid rgba(99, 102, 241, 0.24);
      border-radius: 19px;
      color: #fff;
      background: var(--brand-900);
      text-decoration: none;
    }

    .concierge-callout > ion-icon {
      width: 44px;
      height: 44px;
      padding: 11px;
      border-radius: 14px;
      color: #fff;
      background: rgba(255, 255, 255, 0.1);
    }

    .concierge-callout > div { display: grid; gap: 2px; min-width: 0; }
    .concierge-callout h2 { margin: 0; color: #fff; font-size: 0.88rem; line-height: 1.2; }
    .concierge-callout p { margin: 0; color: rgba(255, 255, 255, 0.76); font-size: 0.7rem; line-height: 1.35; }
    .concierge-callout b { white-space: nowrap; }

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
    .service-grid span { color: var(--primary); font-size: 0.65rem; font-weight: 850; line-height: 1.2; }
    .service-grid h3 { display: -webkit-box; margin: 6px 0 3px; overflow: hidden; font-size: 0.9rem; line-height: 1.18; -webkit-box-orient: vertical; -webkit-line-clamp: 2; }
    .service-grid p { min-width: 0; margin: 0; overflow: hidden; color: var(--muted); font-size: 0.7rem; line-height: 1.25; text-overflow: ellipsis; white-space: nowrap; }
    .service-grid strong { align-self: end; margin-top: 12px; color: var(--primary); font-size: 0.74rem; }

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
    .professional-list p { margin: 0; overflow: hidden; color: var(--muted); font-size: 0.7rem; line-height: 1.3; text-overflow: ellipsis; white-space: nowrap; }
    .professional-list > a > ion-icon { color: var(--primary); }

    .explore-loading { display: grid; grid-template-columns: minmax(0, 1fr); gap: 12px; }
    .skeleton-card { height: 260px; border-radius: 16px; background: linear-gradient(90deg, rgba(99, 102, 241, 0.06), rgba(99, 102, 241, 0.14), rgba(99, 102, 241, 0.06)); background-size: 200% 100%; animation: shimmer 1.5s infinite; }
    .explore-state { display: grid; justify-items: start; gap: 8px; padding: 22px; border: 1px solid var(--border); border-radius: 22px; background: var(--surface); }
    .explore-state h2, .explore-state p { margin: 0; }
    .explore-state h2 { color: var(--text); font-size: 1.2rem; }
    .explore-state p { color: var(--muted); line-height: 1.5; }
    .explore-state button { min-height: 44px; margin-top: 4px; padding: 0 18px; border: 0; border-radius: 999px; color: #fff; background: var(--primary); font: inherit; font-weight: 900; }
    ion-content::part(scroll) { scroll-padding-bottom: calc(156px + env(safe-area-inset-bottom)); }

    @keyframes shimmer {
      0% { background-position: 200% 0; }
      100% { background-position: -200% 0; }
    }

    @media (hover: hover) and (pointer: fine) {
      .explore-search-bar:hover { border-color: rgba(99, 102, 241, 0.4); box-shadow: 0 12px 28px rgba(28, 28, 28, 0.09); }
      .chip:hover { border-color: rgba(99, 102, 241, 0.4); background: var(--primary-soft); }
      .category-card:hover { border-color: rgba(99, 102, 241, 0.4); }
    }

    a:focus-visible, button:focus-visible { outline: 3px solid rgba(99, 102, 241, 0.42); outline-offset: 3px; }

    @media (max-width: 349px) {
      .explore-categories { grid-template-columns: repeat(3, minmax(0, 1fr)); }
      .service-grid { grid-template-columns: minmax(0, 1fr); }
      .collection-actions { grid-template-columns: minmax(0, 1fr); }
      .collection-actions a { min-height: 44px; }
      .concierge-callout { grid-template-columns: 44px minmax(0, 1fr); }
      .concierge-callout b { grid-column: 2; }
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
      .discovery-feature { grid-template-columns: minmax(0, 1.35fr) minmax(280px, 0.65fr); }
      .feature-primary { grid-row: span 2; min-height: 260px; }
      .collection-actions { grid-template-columns: minmax(0, 1fr); }
      .collection-actions a { min-height: 52px; }
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
      .explore-search-bar, .chip, .category-card { transition: none; }
    }
  `]
})
export class ExplorePage implements OnInit {
  readonly areaLabel = signal(localStorage.getItem("aura_customer_area_label") || "Current area");
  readonly currentLocation = signal<{ lat: number; lng: number } | null>(null);
  readonly skeletons = [1, 2, 3];
  readonly showAllCategories = signal(false);

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
        // Uncategorized → show raw label as-is (first word only if long)
        const label = cat.label.length > 16 ? cat.label.split(/\s+/)[0] : cat.label;
        if (!grouped.has(label)) {
          grouped.set(label, cat.slug);
        }
      }
    }
    return Array.from(grouped, ([label, slug]) => ({ label, slug }));
  });

  readonly featuredCategories = computed(() => this.showAllCategories() ? this.mainCategories() : this.mainCategories().slice(0, 7));

  readonly greeting = computed(() => {
    const name = this.marketplace.customer()?.name?.trim().split(/\s+/)[0];
    return name ? `Hey ${name}, where to today?` : "Discover salons near you";
  });

  readonly recommendations = computed(() => {
    const businesses = this.marketplace.businesses();
    return businesses.slice(0, 6);
  });

  readonly trending = computed(() => [...this.marketplace.businesses()]
    .filter((business) => Number(business.ratingCount || 0) > 0)
    .sort((left, right) => this.trendingScore(right) - this.trendingScore(left))
    .slice(0, 4));

  readonly topRated = computed(() => [...this.marketplace.businesses()]
    .filter((business) => Number(business.ratingCount || 0) > 0 && Number(business.ratingAverage || 0) > 0)
    .sort((left, right) => Number(right.ratingAverage) - Number(left.ratingAverage) || Number(right.ratingCount) - Number(left.ratingCount))
    .slice(0, 4));

  readonly newOpenings = computed(() => {
    const now = Date.now();
    const ninetyDays = 90 * 24 * 60 * 60 * 1000;
    return [...this.marketplace.businesses()]
      .filter((business) => {
        const createdAt = business.createdAt ? new Date(business.createdAt).getTime() : Number.NaN;
        return Number.isFinite(createdAt) && createdAt <= now && now - createdAt <= ninetyDays;
      })
      .sort((left, right) => new Date(right.createdAt || 0).getTime() - new Date(left.createdAt || 0).getTime())
      .slice(0, 4);
  });

  readonly premium = computed(() => {
    const priced = this.marketplace.businesses().filter((business) => Number(business.startingPricePaise || 0) > 0);
    const prices = priced.map((business) => business.startingPricePaise).sort((left, right) => left - right);
    const threshold = prices[Math.floor((prices.length - 1) * 0.65)] || 0;
    return priced
      .filter((business) => business.startingPricePaise >= threshold && Number(business.ratingAverage || 0) >= 4.2)
      .sort((left, right) => Number(right.ratingAverage) - Number(left.ratingAverage) || right.startingPricePaise - left.startingPricePaise)
      .slice(0, 4);
  });

  readonly offers = computed(() => this.marketplace.businesses().filter((business) => business.hasOffer).slice(0, 4));

  readonly popularServices = computed(() => this.marketplace.businesses().flatMap((business) => {
    const published = business.services.filter((service) => service.popular).map((service) => service.name);
    const names = business.popularService ? [business.popularService, ...published] : published;
    return [...new Set(names.filter(Boolean))].map((name) => ({ name, business }));
  }).slice(0, 8));

  readonly professionals = computed(() => this.marketplace.businesses()
    .flatMap((business) => business.staff.map((staff) => ({ staff, business })))
    .slice(0, 10));

  readonly editorialCollections = computed(() => {
    const businesses = this.marketplace.businesses();
    const openCount = businesses.filter((business) => business.isOpen).length;
    const offerCount = businesses.filter((business) => business.hasOffer).length;
    return [
      {
        kicker: "Live marketplace view",
        title: "Open around you",
        description: `${openCount} ${openCount === 1 ? "business is" : "businesses are"} currently marked open in the marketplace.`,
        queryParams: { filter: "open", sort: "distance", nearMe: true }
      },
      {
        kicker: "Published salon offers",
        title: "Explore current offers",
        description: `${offerCount} ${offerCount === 1 ? "business has" : "businesses have"} an offer available to browse.`,
        queryParams: { filter: "deals" }
      }
    ];
  });

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

  readonly recentlyVisited = computed(() => {
    const businesses = this.marketplace.businesses();
    const bookings = this.marketplace.bookings();
    const seen = new Set<string>();
    return bookings
      .filter((b) => !!b.businessId || !!b.businessName)
      .sort((a, b) => new Date(b.startAt || b.displayStartAt || b.startsAt || "").getTime() - new Date(a.startAt || a.displayStartAt || a.startsAt || "").getTime())
      .map((booking) => {
        const business = businesses.find((b) => b.id === booking.businessId || b.businessName === booking.businessName);
        return business ? { business, booking } : null;
      })
      .filter((item): item is { business: Business; booking: typeof bookings[0] } => !!item)
      .filter((item) => {
        if (seen.has(item.business.id)) return false;
        seen.add(item.business.id);
        return true;
      })
      .slice(0, 4);
  });

  constructor(
    readonly marketplace: MarketplaceService,
    private readonly router: Router
  ) {
    addIcons({
      businessOutline,
      chevronForwardOutline,
      locationOutline,
      mapOutline,
      navigateOutline,
      optionsOutline,
      pricetagOutline,
      ribbonOutline,
      searchOutline,
      sparklesOutline,
      swapVerticalOutline,
      timeOutline
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

  initials(name: string): string {
    return String(name || "Aura").trim().split(/\s+/).filter(Boolean).slice(0, 2).map((word) => word.charAt(0).toUpperCase()).join("") || "A";
  }

  private trendingScore(business: Business): number {
    return Number(business.ratingAverage || 0) * Math.log2(Number(business.ratingCount || 0) + 1);
  }

  openSearch() {
    void this.router.navigate(["/search"]);
  }

  reload() {
    void Promise.all([this.marketplace.loadPublicBusinesses(), this.marketplace.loadCategories()]).catch(() => undefined);
  }
}
