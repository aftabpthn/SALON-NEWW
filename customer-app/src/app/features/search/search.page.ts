import { AfterViewInit, Component, ElementRef, OnDestroy, OnInit, ViewChild, computed, signal } from "@angular/core";
import { ActivatedRoute } from "@angular/router";
import { RouterLink } from "@angular/router";
import { IonButton, IonContent, IonIcon, IonSearchbar } from "@ionic/angular/standalone";
import { addIcons } from "ionicons";
import { arrowBackOutline, businessOutline, compassOutline, heart, heartOutline, locateOutline, locationOutline, mapOutline, optionsOutline, peopleOutline, pricetagOutline, ribbonOutline, sparklesOutline, swapVerticalOutline } from "ionicons/icons";
import { BusinessCardComponent } from "../../shared/business-card.component";
import { MarketplaceService } from "../../core/marketplace.service";
import { Subscription } from "rxjs";

type FilterKey = "anytime" | "open" | "today" | "morning" | "afternoon" | "evening" | "nearest" | "budget" | "mid" | "premium" | "top" | "reviewed" | "deals" | "offpeak" | "lastminute" | "female" | "male";
type SortKey = "recommended" | "distance" | "earliest" | "price" | "price_desc" | "rating" | "reviews";
type SearchMode = "salons" | "services" | "staff" | "locations";

interface MapTile {
  key: string;
  url: string;
  x: number;
  y: number;
}

interface MapPin {
  key: string;
  label: string;
  x: number;
  y: number;
  count: number;
  business: import("../../core/api.types").Business;
}

interface SearchSuggestion {
  key: string;
  label: string;
  type: string;
  copy: string;
  query: string;
  business: import("../../core/api.types").Business;
}

interface ProfessionalResult {
  key: string;
  staff: import("../../core/api.types").StaffMember;
  business: import("../../core/api.types").Business;
  serviceName: string;
  pricePaise: number;
}

@Component({
  standalone: true,
  imports: [RouterLink, IonButton, IonContent, IonIcon, IonSearchbar, BusinessCardComponent],
  template: `
    <ion-content>
      <main class="page search-page">
        <section class="fresha-search-top">
          <button class="back-button" type="button" routerLink="/tabs/home" aria-label="Back to home">
            <ion-icon name="arrow-back-outline"></ion-icon>
          </button>
          <div>
            <h1>{{ searchTitle() }}</h1>
            <p>Any time · {{ location() ? "Selected area" : "Current location" }}</p>
          </div>
          <button class="map-toggle-button" type="button" (click)="toggleMapPanel()" aria-label="Toggle map">
            <ion-icon name="map-outline"></ion-icon>
          </button>
        </section>

        <section class="sticky-search fresha-search-card">
          <div class="search-input-wrap">
            <ion-searchbar [placeholder]="placeholder()" [value]="query()" (ionInput)="setQuery($any($event.target).value || '')"></ion-searchbar>
            @if (suggestions().length) {
              <div class="suggestion-panel" role="listbox" aria-label="Search suggestions">
                @for (suggestion of suggestions(); track suggestion.key) {
                  <button type="button" role="option" (click)="applySuggestion(suggestion)">
                    <span>
                      <strong>{{ suggestion.label }}</strong>
                      <small>{{ suggestion.type }} · {{ suggestion.copy }}</small>
                    </span>
                    <em>{{ distanceLabel(suggestion.business) }}</em>
                  </button>
                }
              </div>
            }
          </div>
          <div class="fresha-filter-row" aria-label="Search filters and sorting">
            <button type="button" class="control-button" [class.active]="filterPanelOpen() || activeFilterCount()" (click)="toggleFilterPanel()" [attr.aria-expanded]="filterPanelOpen()">
              <ion-icon name="options-outline"></ion-icon>
              <span>Filter{{ activeFilterCount() ? " · " + activeFilterCount() : "" }}</span>
              <small>{{ filterButtonLabel() }}</small>
            </button>
            <button type="button" class="control-button" [class.active]="sortPanelOpen() || sort() !== 'recommended'" (click)="toggleSortPanel()" [attr.aria-expanded]="sortPanelOpen()">
              <ion-icon name="swap-vertical-outline"></ion-icon>
              <span>{{ sort() === "recommended" ? "Sort" : sortButtonLabel() }}</span>
              <small>{{ sortDescription(sort()) }}</small>
            </button>
            <div class="quick-filter-row" aria-label="Quick filters">
              <button type="button" [class.active]="mode() === 'salons'" (click)="applyMode('salons')">Venues</button>
              <button type="button" [class.active]="mode() === 'staff'" (click)="applyMode('staff')">Professionals</button>
              <button type="button" [class.active]="!hasAvailabilityFilter()" (click)="applyAnyTime()">Any time</button>
              @if (hasPriceFilter()) {
                <button type="button" class="active" (click)="toggleFilterPanel()">Price</button>
              }
            </div>
          </div>
          @if (activeFilterSummary().length) {
            <div class="active-summary-row" aria-label="Active filters">
              @for (item of activeFilterSummary(); track item) {
                <span>{{ item }}</span>
              }
              <button type="button" (click)="clearFilters()">Clear all</button>
            </div>
          }
          <div #overlayHost class="search-overlay-host">
          @if (filterPanelOpen()) {
            <div class="sheet-backdrop" (click)="closeSheets()" aria-hidden="true"></div>
            <section class="bottom-sheet" role="dialog" aria-modal="true" aria-label="Filter results">
              <header class="sheet-header">
                <div>
                  <strong>Filters</strong>
                  <span>{{ activeFilterCount() }} selected</span>
                </div>
                <button type="button" (click)="clearDraftFilters()">Clear all</button>
                <button type="button" class="sheet-close" (click)="closeSheets()" aria-label="Close filters">×</button>
              </header>

              <div class="sheet-body">
                <section class="sheet-section">
                  <h3>Looking for</h3>
                  <div class="option-grid">
                    @for (modeOption of filterModes; track modeOption.key) {
                      <button type="button" [class.selected]="draftMode() === modeOption.key" (click)="draftMode.set(modeOption.key)">
                        <span>{{ modeOption.label }}</span>
                        <small>{{ modeOption.copy }}</small>
                      </button>
                    }
                  </div>
                </section>

                @for (section of filterSections; track section.title) {
                  <section class="sheet-section">
                    <h3>{{ section.title }}</h3>
                    <div class="option-grid">
                      @for (option of section.options; track option.key) {
                        <button type="button" [class.selected]="isDraftOptionSelected(option.key)" [disabled]="option.disabled" (click)="toggleDraftFilter(option.key)">
                          <span>{{ option.label }}</span>
                          <small>{{ option.description }}</small>
                        </button>
                      }
                    </div>
                  </section>
                }

                <section class="sheet-section">
                  <h3>Distance range</h3>
                  <label class="range-row">
                    <div class="range-label-row">
                      <span>Within <strong>{{ draftRadiusKm() }} km</strong></span>
                      @if (!location()) {
                        <small class="range-location-hint">Enable location to filter by distance</small>
                      }
                    </div>
                    <input type="range" min="3" max="50" step="1" [value]="draftRadiusKm()" [disabled]="!location()" (input)="draftRadiusKm.set(+$any($event.target).value)" />
                  </label>
                </section>

                <section class="sheet-section">
                  <h3>Custom price range <small style="font-weight:800;opacity:0.7">(₹ INR)</small></h3>
                  <div class="price-inputs">
                    <label>
                      <span>Min price</span>
                      <div class="price-input-wrap">
                        <span class="price-prefix">₹</span>
                        <input type="number" min="0" inputmode="numeric" placeholder="0" [value]="draftMinPrice()" (input)="draftMinPrice.set($any($event.target).value)" />
                      </div>
                    </label>
                    <label>
                      <span>Max price</span>
                      <div class="price-input-wrap">
                        <span class="price-prefix">₹</span>
                        <input type="number" min="0" inputmode="numeric" placeholder="Any" [value]="draftMaxPrice()" (input)="draftMaxPrice.set($any($event.target).value)" />
                      </div>
                    </label>
                  </div>
                </section>
              </div>

              <footer class="sheet-footer">
                <button type="button" class="apply-button" (click)="applyFilters()">Apply filters</button>
              </footer>
            </section>
          }
          @if (sortPanelOpen()) {
            <div class="sheet-backdrop" (click)="closeSheets()" aria-hidden="true"></div>
            <section class="bottom-sheet sort-sheet" role="dialog" aria-modal="true" aria-label="Sort results">
              <header class="sheet-header">
                <div>
                  <strong>Sort by</strong>
                  <span>{{ sortButtonLabel() }}</span>
                </div>
                <button type="button" (click)="setSort('recommended')">Reset</button>
                <button type="button" class="sheet-close" (click)="closeSheets()" aria-label="Close sort">×</button>
              </header>
              <div class="sheet-body">
                @if (!location() && draftSort() === 'distance') {
                  <div class="sort-location-notice">
                    <ion-icon name="locate-outline"></ion-icon>
                    <span>Distance sorting requires your location. It will be requested on apply.</span>
                  </div>
                }
                <div class="option-grid sort-options">
                  @for (option of sortOptions; track option.key) {
                    <button type="button" [class.selected]="draftSort() === option.key" [class.needs-location]="option.key === 'distance' && !location()" (click)="draftSort.set(option.key)">
                      <span>{{ option.label }}</span>
                      <small>{{ sortDescription(option.key) }}{{ option.key === 'distance' && !location() ? ' · needs location' : '' }}</small>
                    </button>
                  }
                </div>
              </div>
              <footer class="sheet-footer">
                <button type="button" class="apply-button" (click)="applySort()">Apply sort</button>
              </footer>
            </section>
          }
          </div>
          @if (location()) {
            <div class="selected-area-row">
              <span><ion-icon name="locate-outline"></ion-icon> Using selected area for distance results</span>
              <button type="button" (click)="clearSelectedArea()">Change area</button>
            </div>
          }
        </section>

        <div class="search-shell">
          <section class="results-panel">
            <div class="result-meta">
              <div>
                <strong>{{ resultCount() }} {{ resultNoun() }}{{ location() ? " within map area" : "" }}</strong>
                <span>{{ filterLabel() }} · {{ modeLabel() }}</span>
              </div>
            </div>

            @if (showMap()) {
              <section class="aura-map-card premium-card" aria-label="Live salon map">
                <div class="map-copy">
                  <div>
                    <p class="eyebrow">Live map</p>
                    <h2>{{ mapPins().length }} mapped choices</h2>
                  </div>
                  <div class="map-actions">
                    <button type="button" (click)="useLocation()">
                      <ion-icon name="locate-outline"></ion-icon>
                      Use my area
                    </button>
                    <button type="button" (click)="toggleMapPickMode()">
                      {{ mapPickMode() ? "Tap map" : "Pick on map" }}
                    </button>
                    <button type="button" (click)="fitToResults()">Fit</button>
                  </div>
                </div>
                <div
                  class="live-map"
                [class.locating]="mapLoading()"
                [class.picking]="mapPickMode()"
                (pointerdown)="startPan($event)"
                (pointermove)="movePan($event)"
                (pointerup)="endPan()"
                (pointerleave)="endPan()"
                (click)="pickMapLocation($event)">
                  <div class="tile-layer" aria-hidden="true">
                    @for (tile of mapTiles(); track tile.key) {
                      <img [src]="tile.url" [style.left.px]="tile.x" [style.top.px]="tile.y" alt="" loading="lazy" />
                    }
                  </div>

                  @if (location(); as userLocation) {
                    <button
                      type="button"
                      class="user-pin"
                      [style.left.px]="userPoint().x"
                      [style.top.px]="userPoint().y"
                      aria-label="Your selected location">
                      <ion-icon name="locate-outline"></ion-icon>
                    </button>
                  }

                  @for (pin of mapPins(); track pin.key) {
                    <button
                      type="button"
                      class="venue-pin"
                      [class.active]="selectedBusiness()?.id === pin.business.id"
                      [class.cluster]="pin.count > 1"
                      [style.left.px]="pin.x"
                      [style.top.px]="pin.y"
                      (click)="selectBusiness(pin.business, $event)"
                      [attr.aria-label]="pin.business.businessName + ' map pin'">
                      {{ pin.count > 1 ? pin.count : pin.label }}
                    </button>
                  }

                  <div class="map-controls" aria-label="Map controls">
                    <button type="button" (click)="zoomIn()" aria-label="Zoom in">+</button>
                    <button type="button" (click)="zoomOut()" aria-label="Zoom out">-</button>
                  </div>

                @if (mapLoading()) {
                  <div class="map-state"><strong>Finding your area</strong><span>{{ locationNotice() }}</span></div>
                } @else if (mapPickMode()) {
                  <div class="map-state compact"><strong>Choose area</strong><span>Tap anywhere on the map to search from that point.</span></div>
                } @else if (mapError()) {
                    <div class="map-state warning">
                      <strong>{{ mapErrorTitle() }}</strong>
                      <span>{{ mapError() }}</span>
                      @if (locationRetryAvailable()) {
                        <ion-button size="small" class="primary-gradient" (click)="useLocation(true)">Retry location</ion-button>
                      }
                    </div>
                  } @else if (!mapPins().length) {
                    <div class="map-state"><strong>No mapped venues</strong><span>Try changing filters or search terms.</span></div>
                  }
                </div>

                @if (selectedBusiness(); as venue) {
                  <article class="map-preview-card">
                    <img [src]="venue.coverImage || 'assets/icons/icon.svg'" [alt]="venue.businessName + ' preview'" />
                    <div>
                      <span class="rating-pill">Star {{ ratingText(venue) }}</span>
                      <h3>{{ venue.businessName }}</h3>
                      <p>{{ venue.address }}</p>
                      <strong>{{ distanceLabel(venue) }}</strong>
                    </div>
                    <ion-button size="small" class="primary-gradient" [routerLink]="['/business', venue.slug]">View</ion-button>
                  </article>
                }
              </section>
            }

            @if (marketplace.loading()) {
              <section class="empty premium-card"><h2>Searching live marketplace</h2><p class="muted">Fetching current business results.</p></section>
            }
            @if (marketplace.error()) {
              <section class="empty premium-card error"><h2>Search failed</h2><p>{{ marketplace.error() }}</p><ion-button class="primary-gradient" (click)="executeSearch()">Retry</ion-button></section>
            }
            <div class="results">
              @if (mode() === "staff") {
                @for (professional of professionalResults(); track professional.key) {
                  <article class="professional-card premium-card" (click)="selectBusiness(professional.business)">
                    <button class="favorite" [class.saved]="marketplace.isFavorite(professional.business.id)" type="button" [attr.aria-label]="marketplace.isFavorite(professional.business.id) ? 'Remove from wishlist' : 'Save to wishlist'" (click)="toggleSaveProfessional($event, professional.business.id)">
                      <ion-icon [name]="marketplace.isFavorite(professional.business.id) ? 'heart' : 'heart-outline'"></ion-icon>
                    </button>
                    <img [src]="professional.staff.image || professional.business.coverImage || 'assets/icons/icon.svg'" [alt]="professional.staff.name" />
                    <div class="professional-copy">
                      <span class="rating-pill">Star {{ professionalRatingText(professional) }} · {{ professional.business.ratingCount || 0 }} reviews</span>
                      <h3>{{ professional.staff.name }}</h3>
                      <p>{{ professional.staff.specialty || professional.staff.title || "Professional" }}</p>
                      <small>{{ professional.business.businessName }}</small>
                      <div class="professional-meta">
                        <span>{{ professionalDistanceLabel(professional.business) }}</span>
                        <span>{{ professional.staff.nextAvailable || professional.business.nextAvailableSlot || "Next slot updating" }}</span>
                        <strong>from {{ money(professional.pricePaise) }}</strong>
                      </div>
                    </div>
                    <ion-button size="small" class="primary-gradient" [routerLink]="['/business', professional.business.slug, 'book']" [queryParams]="{ staffId: professional.staff.id }" (click)="$event.stopPropagation()">Book</ion-button>
                  </article>
                } @empty {
                  <section class="empty premium-card">
                    <h2>No professionals yet</h2>
                    <p class="muted">Try changing filters, search terms, or location.</p>
                    <ion-button class="primary-gradient" (click)="reset()">Reset search</ion-button>
                  </section>
                }
              } @else {
                @for (business of filtered(); track business.id) {
                  <aura-business-card
                    [business]="business"
                    [selectable]="true"
                    [highlighted]="selectedBusiness()?.id === business.id"
                    [displayDistanceKm]="businessDistanceForCard(business)"
                    [userLocation]="location()"
                    (cardSelect)="selectBusiness($event)">
                  </aura-business-card>
                } @empty {
                  <section class="empty premium-card">
                    <h2>No matches yet</h2>
                    <p class="muted">Try searching by salon name, service, area, or remove one of the filters.</p>
                    <ion-button class="primary-gradient" (click)="reset()">Reset search</ion-button>
                  </section>
                }
              }
            </div>
          </section>
        </div>
      </main>
    </ion-content>
  `,
  styles: [`
    .search-hero {
      display: grid;
      gap: 10px;
      margin-bottom: 18px;
    }

    .search-hero .muted {
      max-width: 720px;
      margin: 0;
      font-size: 1.02rem;
    }

    .mode-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 10px;
      margin-top: 8px;
    }

    .mode-grid button,
    .discovery-card {
      border: 1px solid var(--border);
      border-radius: var(--radius-md);
      color: var(--text);
      background: rgba(255, 255, 255, 0.84);
      box-shadow: var(--shadow-soft);
      text-align: left;
    }

    .mode-grid button {
      display: grid;
      grid-template-columns: auto minmax(0, 1fr);
      gap: 3px 10px;
      align-items: center;
      padding: 13px;
    }

    .mode-grid button.active {
      color: #ffffff;
      border-color: transparent;
      background: linear-gradient(135deg, var(--primary), var(--primary-2));
    }

    .mode-grid ion-icon {
      grid-row: span 2;
      font-size: 1.3rem;
    }

    .mode-grid span,
    .discovery-card strong {
      font-weight: 900;
    }

    .mode-grid small,
    .discovery-card span {
      color: inherit;
      opacity: 0.72;
      line-height: 1.35;
    }

    .sticky-search {
      position: sticky;
      top: 8px;
      z-index: 10;
      display: grid;
      gap: 10px;
      padding: 10px;
      margin-bottom: 18px;
    }

    .location-select-row {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 10px;
    }

    .location-select-row label {
      display: grid;
      gap: 5px;
      min-width: 0;
    }

    .location-select-row span {
      color: var(--muted);
      font-size: 0.72rem;
      font-weight: 900;
      text-transform: uppercase;
    }

    .location-select-row ion-select {
      min-height: 46px;
      padding: 0 12px;
      border: 1px solid rgba(139, 92, 246, 0.16);
      border-radius: 999px;
      color: var(--text);
      background: rgba(255, 255, 255, 0.9);
      font-weight: 900;
      box-shadow: 0 8px 18px rgba(139, 92, 246, 0.06);
    }

    .selected-area-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      padding: 12px 14px;
      border: 1px solid rgba(139, 92, 246, 0.16);
      border-radius: 22px;
      color: var(--text);
      background: rgba(245, 243, 255, 0.78);
      font-weight: 900;
    }

    .selected-area-row span,
    .selected-area-row button {
      display: inline-flex;
      align-items: center;
      gap: 7px;
    }

    .selected-area-row button {
      border: 0;
      color: var(--primary);
      background: transparent;
      font: inherit;
      white-space: nowrap;
    }

    .search-input-wrap {
      position: relative;
      min-width: 0;
    }

    .suggestion-panel {
      position: absolute;
      top: calc(100% + 8px);
      right: 0;
      left: 0;
      z-index: 20;
      display: grid;
      gap: 6px;
      padding: 8px;
      border: 1px solid rgba(139, 92, 246, 0.14);
      border-radius: 20px;
      background: rgba(255, 255, 255, 0.98);
      box-shadow: 0 22px 44px rgba(17, 24, 39, 0.12);
      backdrop-filter: blur(18px);
    }

    .suggestion-panel button {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      width: 100%;
      padding: 10px 12px;
      border: 0;
      border-radius: 14px;
      color: var(--text);
      background: transparent;
      text-align: left;
    }

    .suggestion-panel button:hover,
    .suggestion-panel button:focus-visible {
      background: rgba(139, 92, 246, 0.08);
    }

    .suggestion-panel strong,
    .suggestion-panel small {
      display: block;
    }

    .suggestion-panel strong {
      font-weight: 900;
    }

    .suggestion-panel small {
      margin-top: 3px;
      color: var(--muted);
      font-size: 0.78rem;
      font-weight: 800;
    }

    .suggestion-panel em {
      flex: 0 0 auto;
      color: var(--primary);
      font-size: 0.78rem;
      font-style: normal;
      font-weight: 900;
      white-space: nowrap;
    }

    .search-shell {
      display: grid;
      gap: 20px;
    }

    .discovery-row {
      display: grid;
      grid-auto-flow: column;
      grid-auto-columns: minmax(190px, 230px);
      gap: 12px;
      overflow-x: auto;
      padding: 2px 2px 14px;
      scrollbar-width: none;
    }

    .discovery-row::-webkit-scrollbar {
      display: none;
    }

    .discovery-card {
      display: grid;
      gap: 7px;
      padding: 14px;
    }

    .discovery-card ion-icon {
      width: 40px;
      height: 40px;
      padding: 10px;
      border-radius: 16px;
      color: #ffffff;
      background: linear-gradient(135deg, var(--primary), var(--primary-2), var(--accent));
    }

    .chip-row {
      display: flex;
      gap: 10px;
      overflow-x: auto;
      padding: 2px 2px 12px;
      scrollbar-width: none;
    }

    .chip-row::-webkit-scrollbar {
      display: none;
    }

    .result-meta {
      display: grid;
      gap: 12px;
      margin-bottom: 18px;
      padding: 14px;
      border: 1px solid var(--border);
      border-radius: var(--radius-md);
      background: rgba(255, 255, 255, 0.84);
    }

    .result-meta strong,
    .result-meta span {
      display: block;
    }

    .result-meta span {
      margin-top: 4px;
      color: var(--muted);
      font-weight: 800;
    }

    ion-segment {
      --background: var(--surface-soft);
      border-radius: 999px;
      overflow: hidden;
    }

    ion-segment-button {
      --indicator-color: var(--primary);
      --color: var(--muted);
      --color-checked: var(--primary);
      --background-checked: rgba(139, 92, 246, 0.08);
      --background-hover: rgba(139, 92, 246, 0.06);
      --background-focused: rgba(139, 92, 246, 0.08);
      font-size: 0.76rem;
      font-weight: 900;
    }

    ion-segment-button::part(indicator-background) {
      height: 3px;
      border-radius: 999px;
    }

    .aura-map-card {
      display: grid;
      gap: 14px;
      margin-bottom: 18px;
      padding: 18px;
      overflow: hidden;
    }

    .aura-map-card.premium-card,
    .aura-map-card.premium-card:hover,
    .aura-map-card.premium-card:active {
      transform: none !important;
      transform-style: flat !important;
      filter: none !important;
      animation-play-state: paused !important;
      transition:
        border-color 180ms ease,
        box-shadow 180ms ease,
        background 180ms ease !important;
    }

    .aura-map-card.premium-card:hover {
      border-color: var(--border) !important;
      box-shadow: var(--shadow-card) !important;
    }

    .aura-map-card.premium-card:hover ion-icon,
    .aura-map-card.premium-card:active ion-icon {
      transform: none !important;
      animation: none !important;
    }

    .aura-map-card h2,
    .aura-map-card p {
      margin: 0;
    }

    .aura-map-card p:not(.eyebrow) {
      color: var(--muted);
      line-height: 1.5;
    }

    .map-copy {
      display: grid;
      gap: 8px;
    }

    .map-actions {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
      margin-top: 6px;
    }

    .live-map {
      position: relative;
      min-height: 360px;
      overflow: hidden;
      border-radius: 24px;
      background: var(--pink-soft);
      cursor: grab;
      touch-action: none;
      isolation: isolate;
    }

    .live-map,
    .live-map:hover,
    .live-map:active {
      transform: none !important;
      filter: none !important;
    }

    .live-map:active {
      cursor: grabbing;
    }

    .live-map.picking {
      cursor: crosshair;
      outline: 3px solid rgba(139, 92, 246, 0.28);
      outline-offset: -3px;
    }

    .tile-layer,
    .tile-layer img {
      position: absolute;
    }

    .tile-layer {
      inset: 0;
      z-index: 0;
    }

    .tile-layer img {
      width: 256px;
      height: 256px;
      user-select: none;
    }

    .venue-pin,
    .user-pin {
      position: absolute;
      z-index: 2;
      display: grid;
      place-items: center;
      border: 3px solid #ffffff;
      border-radius: 999px;
      transform: translate(-50%, -50%);
      box-shadow: 0 14px 24px rgba(139, 92, 246, 0.28);
    }

    .venue-pin {
      width: 38px;
      height: 38px;
      color: #ffffff;
      background: var(--primary);
      font-size: 0.76rem;
      font-weight: 900;
      cursor: pointer;
    }

    .venue-pin.cluster {
      background: #10B981;
    }

    .venue-pin.active {
      width: 38px;
      height: 38px;
      background: #F472B6;
      outline: 4px solid rgba(244, 114, 182, 0.28);
      outline-offset: 2px;
      box-shadow: 0 18px 32px rgba(251, 113, 133, 0.36);
    }

    .live-map .venue-pin,
    .live-map .venue-pin:hover,
    .live-map .venue-pin:active,
    .live-map .user-pin,
    .live-map .user-pin:hover,
    .live-map .user-pin:active {
      transform: translate(-50%, -50%) !important;
      animation: none !important;
      transition:
        background 160ms ease,
        border-color 160ms ease,
        box-shadow 160ms ease,
        outline-color 160ms ease !important;
    }

    .live-map .map-controls button,
    .live-map .map-controls button:hover,
    .live-map .map-controls button:active,
    .live-map .map-state button,
    .live-map .map-state button:hover,
    .live-map .map-state button:active {
      transform: none !important;
      animation: none !important;
    }

    .live-map button::after {
      display: none !important;
    }

    .user-pin {
      width: 28px;
      height: 28px;
      color: #8B5CF6;
      background: #ffffff;
      pointer-events: none;
    }

    .map-controls {
      position: absolute;
      top: 12px;
      right: 12px;
      z-index: 3;
      display: grid;
      gap: 6px;
    }

    .map-controls button {
      width: 42px;
      height: 42px;
      border: 1px solid rgba(17, 24, 39, 0.16);
      border-radius: 14px;
      color: var(--text);
      background: rgba(255, 255, 255, 0.92);
      box-shadow: var(--shadow-soft);
      font-size: 1.2rem;
      font-weight: 900;
    }

    .map-state {
      position: absolute;
      right: 12px;
      bottom: 12px;
      left: 12px;
      z-index: 3;
      display: grid;
      gap: 4px;
      padding: 12px 14px;
      border: 1px solid rgba(255, 255, 255, 0.72);
      border-radius: 18px;
      color: var(--text);
      background: rgba(255, 255, 255, 0.92);
      box-shadow: var(--shadow-soft);
      backdrop-filter: blur(16px);
    }

    .map-state span {
      color: var(--muted);
      font-weight: 800;
      line-height: 1.35;
    }

    .map-state.warning strong {
      color: #EF4444;
    }

    .map-state.compact {
      right: auto;
      max-width: 320px;
    }

    .map-preview-card {
      display: grid;
      grid-template-columns: 76px minmax(0, 1fr) auto;
      gap: 12px;
      align-items: center;
      padding: 12px;
      border: 1px solid var(--border);
      border-radius: 22px;
      background: rgba(255, 255, 255, 0.9);
      box-shadow: var(--shadow-soft);
    }

    .map-preview-card img {
      width: 76px;
      height: 76px;
      border-radius: 18px;
      object-fit: cover;
      background: var(--surface-soft);
    }

    .map-preview-card h3,
    .map-preview-card p {
      margin: 5px 0;
    }

    .map-preview-card h3 {
      color: var(--text);
      font-size: 1.05rem;
      letter-spacing: 0;
      line-height: 1.1;
    }

    .map-preview-card p {
      color: var(--muted);
      line-height: 1.35;
    }

    .map-preview-card strong {
      color: var(--primary-2);
      font-size: 0.86rem;
    }

    .results {
      display: grid;
      gap: 18px;
    }

    .empty {
      display: grid;
      justify-items: center;
      gap: 10px;
      padding: 34px 22px;
      text-align: center;
    }

    .empty h2 {
      margin: 0;
      letter-spacing: -0.04em;
    }

    @media (min-width: 768px) {
      .sticky-search {
        grid-template-columns: minmax(0, 1fr) auto auto;
        align-items: center;
      }

      .location-select-row {
        grid-column: 1 / -1;
      }

      .mode-grid {
        grid-template-columns: repeat(4, minmax(0, 1fr));
      }

      .result-meta {
        grid-template-columns: minmax(0, 1fr) 360px;
        align-items: center;
      }

      .aura-map-card {
        grid-template-columns: minmax(0, 0.75fr) minmax(360px, 1.25fr);
        align-items: stretch;
      }

      .map-preview-card {
        grid-column: 2;
      }

      .results {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }
    }

    @media (min-width: 1024px) {
      .sticky-search {
        top: 104px;
      }

      .chip-row {
        display: none;
      }

      .results {
        grid-template-columns: repeat(3, minmax(0, 1fr));
      }
    }

    @media (max-width: 599px) {
      .live-map {
        min-height: 300px;
      }

      .map-actions ion-button,
      .map-preview-card ion-button {
        width: 100%;
      }

      .map-preview-card {
        grid-template-columns: 64px minmax(0, 1fr);
      }

      .map-preview-card ion-button {
        grid-column: 1 / -1;
      }

      .map-preview-card img {
        width: 64px;
        height: 64px;
      }

      .location-select-row {
        grid-template-columns: 1fr;
      }
    }

    @media (min-width: 1440px) {
      .results {
        grid-template-columns: repeat(4, minmax(0, 1fr));
      }
    }

    .search-page {
      max-width: 1180px;
      padding-top: 18px;
    }

    .fresha-search-top {
      display: grid;
      grid-template-columns: auto minmax(0, 1fr) auto;
      align-items: center;
      gap: 14px;
      min-height: 64px;
      margin-bottom: 12px;
      padding: 10px 14px;
      border: 1px solid var(--border);
      border-radius: 999px;
      background: rgba(255, 255, 255, 0.96);
      box-shadow: 0 8px 24px rgba(17, 24, 39, 0.06);
    }

    .fresha-search-top h1,
    .fresha-search-top p {
      margin: 0;
    }

    .fresha-search-top h1 {
      overflow: hidden;
      color: var(--text);
      font-size: 1.02rem;
      font-weight: 900;
      letter-spacing: 0;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .fresha-search-top p {
      margin-top: 3px;
      color: var(--muted);
      font-size: 0.86rem;
      font-weight: 700;
    }

    .back-button,
    .map-toggle-button,
    .filter-icon-button {
      display: grid;
      place-items: center;
      width: 44px;
      height: 44px;
      border: 1px solid rgba(17, 24, 39, 0.14);
      border-radius: 999px;
      color: var(--text);
      background: #ffffff;
      font-size: 1.15rem;
    }

    .map-toggle-button {
      border-color: rgba(139, 92, 246, 0.18);
      color: var(--primary);
    }

    .fresha-search-card {
      position: static;
      display: grid;
      grid-template-columns: 1fr;
      gap: 12px;
      margin-bottom: 22px;
      padding: 0;
      border: 0;
      background: transparent;
      box-shadow: none;
    }

    .fresha-search-card ion-searchbar {
      padding: 0;
      min-height: 56px;
      --border-radius: 999px;
      --background: #ffffff;
      --box-shadow: 0 8px 24px rgba(17, 24, 39, 0.08);
      --placeholder-color: #6B7280;
      --color: var(--text);
    }

    .fresha-filter-row {
      display: grid;
      grid-template-columns: minmax(104px, auto) minmax(104px, auto) minmax(0, 1fr);
      align-items: center;
      gap: 10px;
      overflow: visible;
      width: 100%;
      padding: 0 0 2px 18px;
      scrollbar-width: none;
    }

    .fresha-filter-row::-webkit-scrollbar {
      display: none;
    }

    .fresha-filter-row button:not(.filter-icon-button) {
      flex: 0 0 auto;
      min-height: 40px;
      padding: 0 16px;
      border: 1px solid rgba(17, 24, 39, 0.16);
      border-radius: 999px;
      color: var(--text);
      background: #ffffff;
      font-weight: 800;
      white-space: nowrap;
    }

    .fresha-filter-row button.active:not(.filter-icon-button) {
      border-color: rgba(214, 169, 74, 0.5);
      color: #9A6A13;
      background: linear-gradient(135deg, rgba(255, 236, 177, 0.96), rgba(255, 249, 236, 0.92));
    }

    .control-button {
      display: grid;
      grid-template-columns: auto minmax(0, 1fr);
      gap: 0 8px;
      align-items: center;
      min-height: 48px;
      min-width: 108px;
      padding: 6px 14px;
      text-align: left;
    }

    .control-button ion-icon {
      grid-row: span 2;
      font-size: 1.05rem;
    }

    .control-button span,
    .control-button small {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .control-button small {
      color: var(--muted);
      font-size: 0.66rem;
      font-weight: 900;
      letter-spacing: 0;
    }

    .control-button.active small {
      color: inherit;
      opacity: 0.74;
    }

    .quick-filter-row {
      display: flex;
      gap: 8px;
      min-width: 0;
      overflow-x: auto;
      padding: 1px 2px 2px;
      scrollbar-width: none;
    }

    .quick-filter-row::-webkit-scrollbar {
      display: none;
    }

    .quick-filter-row button {
      flex: 0 0 auto;
    }

    .active-summary-row {
      display: flex;
      gap: 8px;
      align-items: center;
      overflow-x: auto;
      padding: 0 2px 4px 18px;
      scrollbar-width: none;
    }

    .active-summary-row::-webkit-scrollbar {
      display: none;
    }

    .active-summary-row span,
    .active-summary-row button {
      flex: 0 0 auto;
      min-height: 32px;
      padding: 0 12px;
      border: 1px solid rgba(214, 169, 74, 0.35);
      border-radius: 999px;
      color: #7A5019;
      background: rgba(255, 249, 236, 0.9);
      font: inherit;
      font-size: 0.74rem;
      font-weight: 900;
    }

    .active-summary-row button {
      color: #9A3412;
      background: rgba(255, 255, 255, 0.9);
    }

    .search-overlay-host {
      display: contents;
    }

    .sheet-backdrop {
      position: fixed;
      inset: 0;
      z-index: 6000;
      background: rgba(35, 25, 13, 0.34);
      backdrop-filter: blur(6px);
    }

    .bottom-sheet {
      position: fixed;
      right: 0;
      bottom: 0;
      left: 0;
      z-index: 6001;
      display: grid;
      grid-template-rows: auto minmax(0, 1fr) auto;
      max-height: min(82vh, 760px);
      border: 1px solid rgba(214, 169, 74, 0.32);
      border-radius: 28px 28px 0 0;
      background: linear-gradient(145deg, rgba(255, 255, 255, 0.98), rgba(255, 246, 224, 0.98));
      box-shadow: 0 -24px 70px rgba(92, 65, 28, 0.24);
      overflow: hidden;
    }

    .sheet-header,
    .sheet-footer {
      position: sticky;
      z-index: 2;
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 14px 18px;
      background: rgba(255, 252, 244, 0.96);
      backdrop-filter: blur(16px);
    }

    .sheet-header {
      top: 0;
      border-bottom: 1px solid rgba(214, 169, 74, 0.18);
    }

    .sheet-header div {
      flex: 1 1 auto;
      display: grid;
      gap: 2px;
    }

    .sheet-header strong {
      color: var(--text);
      font-size: 1.05rem;
      font-weight: 950;
    }

    .sheet-header span {
      color: var(--muted);
      font-size: 0.78rem;
      font-weight: 850;
    }

    .sheet-header button {
      min-height: 36px;
      padding: 0 12px;
      border: 1px solid rgba(214, 169, 74, 0.28);
      border-radius: 999px;
      color: #9A6A13;
      background: rgba(255, 255, 255, 0.88);
      font: inherit;
      font-size: 0.78rem;
      font-weight: 950;
    }

    .sheet-header .sheet-close {
      width: 38px;
      padding: 0;
      color: var(--text);
      font-size: 1.35rem;
    }

    .sheet-body {
      display: grid;
      gap: 18px;
      overflow-y: auto;
      padding: 16px 18px 18px;
    }

    .sheet-section {
      display: grid;
      gap: 10px;
    }

    .sheet-section h3 {
      margin: 0;
      color: var(--text);
      font-size: 0.92rem;
      font-weight: 950;
    }

    .option-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
      gap: 10px;
    }

    .option-grid button {
      display: grid;
      gap: 4px;
      min-height: 72px;
      padding: 12px 14px;
      border: 1px solid rgba(214, 169, 74, 0.2);
      border-radius: 18px;
      color: var(--text);
      background: rgba(255, 255, 255, 0.9);
      text-align: left;
      box-shadow: 0 10px 22px rgba(92, 65, 28, 0.06);
    }

    .option-grid button.selected {
      border-color: rgba(154, 106, 19, 0.52);
      color: #120D05;
      background: linear-gradient(135deg, #FFE08A, #D6A94A, #B87D1E);
      box-shadow: 0 14px 30px rgba(184, 125, 30, 0.24);
    }

    .option-grid button:disabled {
      opacity: 0.42;
      cursor: not-allowed;
      box-shadow: none;
    }

    .option-grid span {
      font-weight: 950;
    }

    .option-grid small {
      color: inherit;
      opacity: 0.68;
      font-weight: 850;
      line-height: 1.3;
    }

    .range-row,
    .price-inputs label {
      display: grid;
      gap: 8px;
      color: var(--text);
      font-weight: 900;
    }

    .range-label-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
    }

    .range-label-row strong {
      color: #B87D1E;
    }

    .range-location-hint {
      color: var(--muted);
      font-size: 0.76rem;
      font-weight: 800;
    }

    .range-row input {
      width: 100%;
      accent-color: #D6A94A;
    }

    .range-row input:disabled {
      opacity: 0.4;
      cursor: not-allowed;
    }

    .price-inputs {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 10px;
    }

    .price-input-wrap {
      position: relative;
      display: flex;
      align-items: center;
    }

    .price-prefix {
      position: absolute;
      left: 12px;
      color: var(--muted);
      font-weight: 900;
      pointer-events: none;
    }

    .price-inputs input {
      width: 100%;
      min-height: 44px;
      padding: 0 12px 0 28px;
      border: 1px solid rgba(214, 169, 74, 0.24);
      border-radius: 14px;
      background: #fff;
      color: var(--text);
      font: inherit;
      font-weight: 900;
    }

    .sheet-footer {
      bottom: 0;
      border-top: 1px solid rgba(214, 169, 74, 0.18);
    }

    .apply-button {
      width: 100%;
      min-height: 50px;
      border: 0;
      border-radius: 999px;
      color: #120D05;
      background: linear-gradient(135deg, #FFE08A, #D6A94A, #B87D1E);
      box-shadow: 0 18px 34px rgba(184, 125, 30, 0.22);
      font: inherit;
      font-weight: 950;
    }

    .sort-location-notice {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 12px 14px;
      border: 1px solid rgba(139, 92, 246, 0.18);
      border-radius: 16px;
      color: var(--primary);
      background: rgba(245, 243, 255, 0.72);
      font-size: 0.84rem;
      font-weight: 850;
    }

    .sort-location-notice ion-icon {
      flex: 0 0 auto;
      font-size: 1.1rem;
    }

    .option-grid button.needs-location {
      opacity: 0.72;
    }

    .option-grid button.needs-location.selected {
      opacity: 1;
      border-color: rgba(139, 92, 246, 0.4);
      background: linear-gradient(135deg, rgba(237, 233, 254, 0.96), rgba(196, 181, 253, 0.72));
      color: #4c1d95;
    }

    .professional-card {
      position: relative;
      display: grid;
      grid-template-columns: 92px minmax(0, 1fr);
      gap: 14px;
      align-items: center;
      padding: 14px;
    }

    .professional-card > img {
      width: 92px;
      height: 92px;
      border-radius: 24px;
      object-fit: cover;
      background: var(--gold-soft);
    }

    .professional-card .favorite {
      position: absolute;
      top: 12px;
      right: 12px;
      display: grid;
      place-items: center;
      width: 40px;
      height: 40px;
      border: 1px solid rgba(214, 169, 74, 0.24);
      border-radius: 999px;
      color: var(--text);
      background: rgba(255, 255, 255, 0.94);
      box-shadow: 0 10px 20px rgba(92, 65, 28, 0.1);
    }

    .professional-card .favorite.saved {
      color: #B87D1E;
    }

    .professional-copy {
      min-width: 0;
      display: grid;
      gap: 4px;
      padding-right: 48px;
    }

    .professional-copy h3,
    .professional-copy p,
    .professional-copy small {
      margin: 0;
    }

    .professional-copy h3 {
      color: var(--text);
      font-size: 1.08rem;
      font-weight: 950;
      letter-spacing: -0.02em;
    }

    .professional-copy p,
    .professional-copy small,
    .professional-meta span {
      color: var(--muted);
      font-weight: 800;
      line-height: 1.35;
    }

    .professional-card .rating-pill {
      position: static;
      width: fit-content;
      font-size: 0.72rem;
    }

    .professional-meta {
      display: flex;
      flex-wrap: wrap;
      gap: 8px 12px;
      align-items: center;
      margin-top: 4px;
    }

    .professional-meta strong {
      color: #B87D1E;
      font-weight: 950;
    }

    .professional-card ion-button {
      grid-column: 1 / -1;
      justify-self: end;
    }

    .filter-popover {
      display: grid;
      gap: 12px;
      padding: 14px;
      border: 1px solid rgba(218, 165, 32, 0.32);
      border-radius: 24px;
      background: linear-gradient(145deg, rgba(255, 255, 255, 0.98), rgba(255, 246, 224, 0.94));
      box-shadow: 0 18px 42px rgba(91, 61, 18, 0.14);
    }

    .filter-popover.compact {
      max-width: 720px;
    }

    .popover-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
    }

    .popover-head strong {
      color: var(--text);
      font-size: 0.92rem;
      font-weight: 950;
    }

    .popover-head button {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      min-height: 34px;
      padding: 0 12px;
      border: 1px solid rgba(196, 139, 28, 0.28);
      border-radius: 999px;
      color: #9a6a13;
      background: rgba(255, 255, 255, 0.82);
      font: inherit;
      font-size: 0.74rem;
      font-weight: 950;
    }

    .popover-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
      gap: 10px;
    }

    .popover-grid button {
      display: grid;
      gap: 4px;
      min-height: 70px;
      padding: 12px 14px;
      border: 1px solid rgba(196, 139, 28, 0.2);
      border-radius: 18px;
      color: var(--text);
      background: rgba(255, 255, 255, 0.76);
      text-align: left;
      box-shadow: 0 10px 24px rgba(91, 61, 18, 0.06);
    }

    .popover-grid button.active {
      border-color: rgba(196, 139, 28, 0.42);
      color: #111827;
      background: linear-gradient(135deg, #FFE08A, #C7891B);
      box-shadow: 0 14px 30px rgba(196, 139, 28, 0.22);
    }

    .popover-grid span {
      font-weight: 950;
    }

    .popover-grid small {
      color: inherit;
      opacity: 0.66;
      font-weight: 850;
      line-height: 1.3;
    }

    @media (min-width: 1024px) {
      .search-shell {
        grid-template-columns: 1fr;
      }

      .results {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }
    }

    .result-meta {
      display: flex;
      justify-content: center;
      margin: 6px 0 22px;
      padding: 0;
      border: 0;
      background: transparent;
      text-align: center;
    }

    .result-meta strong {
      color: var(--muted);
      font-size: 0.95rem;
      font-weight: 700;
      letter-spacing: 0;
    }

    .result-meta span {
      display: none;
    }

    .aura-map-card {
      margin-bottom: 22px;
      border-radius: 28px;
    }

    .sticky-search.fresha-search-card {
      margin-bottom: 18px;
    }

    .sticky-search.fresha-search-card .search-input-wrap {
      width: 100%;
    }

    .fresha-search-card ion-searchbar {
      min-height: 50px;
      --box-shadow: 0 6px 18px rgba(17, 24, 39, 0.06);
      --border-radius: 22px;
    }

    .fresha-filter-row {
      gap: 8px;
      padding-top: 10px;
    }

    .fresha-filter-row {
      grid-template-columns: minmax(104px, auto) minmax(104px, auto) minmax(0, 1fr);
      padding-top: 0;
    }

    .filter-icon-button {
      flex: 0 0 auto;
      width: 48px;
      height: 40px;
      box-shadow: none;
    }

    .filter-icon-button.active {
      border-color: rgba(214, 169, 74, 0.5);
      color: #9A6A13;
      background: linear-gradient(135deg, rgba(255, 236, 177, 0.96), rgba(255, 249, 236, 0.92));
    }

    .fresha-filter-row button:not(.filter-icon-button) {
      min-height: 40px;
      padding: 0 18px;
      box-shadow: none;
      font-size: 0.88rem;
    }

    .aura-map-card {
      gap: 12px;
      padding: 18px;
      border-radius: 24px;
      box-shadow: 0 16px 38px rgba(17, 24, 39, 0.06);
    }

    .map-copy {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 14px;
    }

    .map-copy h2 {
      font-size: 1.05rem;
      letter-spacing: 0;
    }

    .map-copy .eyebrow {
      margin-bottom: 2px;
      font-size: 0.74rem;
    }

    .map-actions {
      flex: 0 0 auto;
      display: flex;
      gap: 8px;
      margin: 0;
    }

    .map-actions button {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      min-height: 36px;
      padding: 0 12px;
      border: 1px solid rgba(124, 58, 237, 0.18);
      border-radius: 999px;
      color: var(--primary);
      background: rgba(255, 255, 255, 0.94);
      font: inherit;
      font-size: 0.78rem;
      font-weight: 900;
      white-space: nowrap;
    }

    .live-map {
      min-height: 320px;
      border-radius: 22px;
    }

    .map-preview-card {
      border-radius: 20px;
      box-shadow: 0 12px 30px rgba(17, 24, 39, 0.06);
    }

    .map-preview-card .rating-pill {
      display: inline-flex;
      width: max-content;
    }

    @media (min-width: 768px) {
      .aura-map-card {
        grid-template-columns: minmax(0, 1fr);
      }

      .map-copy,
      .live-map,
      .map-preview-card {
        grid-column: 1;
      }
    }

    @media (min-width: 1024px) {
      .aura-map-card {
        grid-template-columns: minmax(0, 1fr) minmax(290px, 0.48fr);
        align-items: start;
      }

      .map-copy {
        grid-column: 1 / -1;
      }

      .live-map {
        grid-column: 1;
        min-height: 360px;
      }

      .map-preview-card {
        grid-column: 2;
        align-self: stretch;
        grid-template-columns: 72px minmax(0, 1fr);
      }

      .map-preview-card ion-button {
        grid-column: 1 / -1;
      }
    }

    @media (max-width: 599px) {
      .search-page {
        padding-top: 12px;
      }

      .fresha-search-top {
        border-radius: 28px;
      }

      .fresha-filter-row button:not(.filter-icon-button) {
        min-height: 38px;
        padding-inline: 14px;
      }

      .fresha-filter-row {
        grid-template-columns: minmax(92px, auto) minmax(92px, auto) minmax(0, 1fr);
        gap: 8px;
        padding-left: 8px;
      }

      .control-button {
        min-width: 92px;
        padding-inline: 11px;
      }

      .control-button small {
        max-width: 58px;
      }

      .popover-grid {
        grid-template-columns: 1fr;
      }

      .map-copy {
        align-items: flex-start;
        flex-direction: column;
      }

      .map-actions {
        width: 100%;
        overflow-x: auto;
        padding-bottom: 2px;
      }
    }
  `]
})
export class SearchPage implements AfterViewInit, OnDestroy, OnInit {
  @ViewChild("overlayHost") private overlayHost?: ElementRef<HTMLElement>;
  readonly query = signal("");
  readonly mode = signal<SearchMode>("salons");
  readonly filter = signal<FilterKey>("open");
  readonly sort = signal<SortKey>("recommended");
  readonly activeFilters = signal<FilterKey[]>([]);
  readonly draftFilters = signal<FilterKey[]>([]);
  readonly draftMode = signal<SearchMode>("salons");
  readonly draftSort = signal<SortKey>("recommended");
  readonly radiusKm = signal(25);
  readonly draftRadiusKm = signal(25);
  readonly minPrice = signal("");
  readonly maxPrice = signal("");
  readonly draftMinPrice = signal("");
  readonly draftMaxPrice = signal("");
  readonly filterPanelOpen = signal(false);
  readonly sortPanelOpen = signal(false);
  readonly selectedCountry = signal("");
  readonly selectedState = signal("");
  readonly selectedCity = signal("");
  readonly mapZoom = signal(12);
  readonly mapLoading = signal(false);
  readonly mapErrorTitle = signal("");
  readonly mapError = signal("");
  readonly locationNotice = signal("Your browser may ask for location permission. Choose Allow to show your current area.");
  readonly locationRetryAvailable = signal(false);
  readonly mapPickMode = signal(false);
  readonly mapPanelOpen = signal(false);
  readonly selectedBusiness = signal<import("../../core/api.types").Business | null>(null);
  readonly searchModes: { key: SearchMode; label: string; copy: string; icon: string }[] = [
    { key: "salons", label: "Salons", copy: "Venues near you", icon: "business-outline" },
    { key: "services", label: "Services", copy: "Hair, skin, nails", icon: "sparkles-outline" },
    { key: "staff", label: "Staff", copy: "Find professionals", icon: "people-outline" },
    { key: "locations", label: "Locations", copy: "Area and distance", icon: "location-outline" }
  ];
  readonly filterModes: { key: SearchMode; label: string; copy: string }[] = [
    { key: "salons", label: "Venues", copy: "Salons, spas and clinics" },
    { key: "services", label: "Treatments", copy: "Search by service menu" },
    { key: "staff", label: "Professionals", copy: "Find stylists or therapists" }
  ];
  readonly filterSections: { title: string; options: { key: FilterKey; label: string; description: string; disabled?: boolean }[] }[] = [
    {
      title: "Availability",
      options: [
        { key: "anytime", label: "Any time", description: "No time restriction" },
        { key: "today", label: "Today", description: "Available today" },
        { key: "open", label: "Open now", description: "Currently open venues" },
        { key: "morning", label: "Morning", description: "Before 12 pm" },
        { key: "afternoon", label: "Afternoon", description: "12 pm to 5 pm" },
        { key: "evening", label: "Evening", description: "After 5 pm" }
      ]
    },
    {
      title: "Location",
      options: [
        { key: "nearest", label: "Near me", description: "Use selected area" }
      ]
    },
    {
      title: "Price",
      options: [
        { key: "budget", label: "Low budget", description: "Under Rs 1,000" },
        { key: "mid", label: "Mid range", description: "Rs 1,000 to Rs 2,500" },
        { key: "premium", label: "Premium", description: "Rs 2,500+" }
      ]
    },
    {
      title: "Rating",
      options: [
        { key: "top", label: "Top rated 4.5+", description: "Highest guest scores" },
        { key: "reviewed", label: "Most reviewed", description: "More customer reviews" }
      ]
    },
    {
      title: "Offers",
      options: [
        { key: "deals", label: "Deals", description: "Promos and savings" },
        { key: "offpeak", label: "Off-peak discounts", description: "Lower demand offers", disabled: true },
        { key: "lastminute", label: "Last-minute offers", description: "Late availability deals", disabled: true }
      ]
    },
    {
      title: "Staff preference",
      options: [
        { key: "female", label: "Female staff", description: "When staff data includes it" },
        { key: "male", label: "Male staff", description: "When staff data includes it", disabled: true }
      ]
    }
  ];
  readonly sortOptions: { key: SortKey; label: string }[] = [
    { key: "recommended", label: "Best match" },
    { key: "distance", label: "Nearest" },
    { key: "earliest", label: "Earliest available" },
    { key: "price", label: "Price low to high" },
    { key: "price_desc", label: "Price high to low" },
    { key: "rating", label: "Top rated" },
    { key: "reviews", label: "Most reviewed" }
  ];
  readonly flatFilterOptions = computed(() => this.filterSections.flatMap((section) => section.options));
  readonly activeFilterCount = computed(() => this.activeFilters().length + (this.minPrice() || this.maxPrice() ? 1 : 0));
  readonly filterButtonLabel = computed(() => this.activeFilterCount() ? this.activeFilterSummary().slice(0, 2).join(", ") : "All filters");
  readonly sortButtonLabel = computed(() => this.sortOptions.find((option) => option.key === this.sort())?.label ?? "Best match");
  readonly hasPriceFilter = computed(() => this.activeFilters().some((key) => key === "budget" || key === "mid" || key === "premium") || !!this.minPrice() || !!this.maxPrice());
  readonly hasTimeFilter = computed(() => this.activeFilters().some((key) => key === "today" || key === "morning" || key === "afternoon" || key === "evening"));
  readonly hasAvailabilityFilter = computed(() => this.activeFilters().some((key) => key === "open" || key === "today" || key === "morning" || key === "afternoon" || key === "evening"));
  readonly activeFilterSummary = computed(() => {
    const labels = this.activeFilters()
      .map((key) => this.flatFilterOptions().find((option) => option.key === key)?.label)
      .filter(Boolean) as string[];
    if (this.minPrice() || this.maxPrice()) labels.push(`Rs ${this.minPrice() || "0"} - ${this.maxPrice() || "Any"}`);
    return labels;
  });

  readonly location = signal<{ lat: number; lng: number } | null>(null);
  private readonly defaultCenter = { lat: 20.5937, lng: 78.9629 };
  private readonly locationTimeoutMs = 20000;
  private panStart: { x: number; y: number; center: { lat: number; lng: number } } | null = null;
  private routeSubscription?: Subscription;
  readonly mapCenter = signal<{ lat: number; lng: number }>(this.defaultCenter);
  readonly placeholder = computed(() => {
    if (this.mode() === "services") return "Search haircut, facial, nails";
    if (this.mode() === "staff") return "Search staff name or specialty";
    if (this.mode() === "locations") return "Search area, city or address";
    return "Search salon, spa or clinic";
  });
  readonly modeLabel = computed(() => this.searchModes.find((item) => item.key === this.mode())?.label ?? "Salons");
  readonly searchTitle = computed(() => {
    if (this.query().trim()) return this.query().trim();
    if (this.mode() === "services") return "All treatments and venues";
    if (this.mode() === "staff") return "All professionals";
    if (this.mode() === "locations") return "Places by area";
    return "All treatments and venues";
  });
  readonly resultNoun = computed(() => this.mode() === "staff" ? "professionals found" : this.mode() === "services" ? "services found" : this.mode() === "locations" ? "locations found" : "places found");
  readonly discoveryShortcuts = computed(() => [
    { label: "Trending services", copy: "Popular customer choices", icon: "sparkles-outline", query: this.marketplace.businesses()[0]?.popularService || "", filter: "today" as FilterKey },
    { label: "Top rated", copy: "Highest reviewed venues", icon: "ribbon-outline", query: "", filter: "top" as FilterKey },
    { label: "Offers nearby", copy: "Promos and first visits", icon: "pricetag-outline", query: "", filter: "deals" as FilterKey },
    { label: "Closest slots", copy: "Distance-ready sorting", icon: "compass-outline", query: "", filter: "nearest" as FilterKey }
  ]);
  readonly mapStatus = computed(() => {
    if (this.location()) return `Using your selected area. Distances update from ${this.location()?.lat.toFixed(3)}, ${this.location()?.lng.toFixed(3)}.`;
    return "Live OpenStreetMap tiles are shown with venue pins. Use your area to sort by true distance.";
  });
  readonly mapTiles = computed<MapTile[]>(() => {
    const zoom = this.mapZoom();
    const center = this.latLngToWorld(this.mapCenter().lat, this.mapCenter().lng, zoom);
    const viewport = this.mapViewport();
    const startX = Math.floor((center.x - viewport.width / 2) / 256) - 1;
    const endX = Math.floor((center.x + viewport.width / 2) / 256) + 1;
    const startY = Math.floor((center.y - viewport.height / 2) / 256) - 1;
    const endY = Math.floor((center.y + viewport.height / 2) / 256) + 1;
    const limit = 2 ** zoom;
    const tiles: MapTile[] = [];
    for (let x = startX; x <= endX; x += 1) {
      for (let y = startY; y <= endY; y += 1) {
        if (y < 0 || y >= limit) continue;
        const wrappedX = ((x % limit) + limit) % limit;
        tiles.push({
          key: `${zoom}-${wrappedX}-${y}`,
          url: `https://tile.openstreetmap.org/${zoom}/${wrappedX}/${y}.png`,
          x: x * 256 - center.x + viewport.width / 2,
          y: y * 256 - center.y + viewport.height / 2
        });
      }
    }
    return tiles;
  });
  readonly userPoint = computed(() => this.pointFor(this.location() || this.mapCenter()));
  readonly mapPins = computed<MapPin[]>(() => {
    const pins = this.filtered()
      .map((business, index) => ({ business, index, point: this.pointForBusiness(business) }))
      .filter((item) => item.point);
    const clusters = new Map<string, { items: typeof pins; x: number; y: number }>();
    pins.forEach((item) => {
      const point = item.point as { x: number; y: number };
      const key = `${Math.round(point.x / 42)}:${Math.round(point.y / 42)}`;
      const existing = clusters.get(key);
      if (existing) {
        existing.items.push(item);
        existing.x = (existing.x + point.x) / 2;
        existing.y = (existing.y + point.y) / 2;
        return;
      }
      clusters.set(key, { items: [item], x: point.x, y: point.y });
    });
    return [...clusters.values()].map((cluster) => ({
      key: cluster.items.map((item) => item.business.id).join("-"),
      label: String(cluster.items[0].index + 1),
      x: cluster.x,
      y: cluster.y,
      count: cluster.items.length,
      business: cluster.items[0].business
    }));
  });
  readonly suggestions = computed<SearchSuggestion[]>(() => {
    const query = this.query().trim().toLowerCase();
    if (!query) return [];
    const suggestions: SearchSuggestion[] = [];
    for (const business of this.filtered()) {
      const suggestion = this.bestSuggestionFor(business, query);
      if (suggestion) suggestions.push(suggestion);
      if (suggestions.length >= 6) break;
    }
    return suggestions;
  });
  readonly countryOptions = computed(() => this.uniqueLocationValues("country"));
  readonly stateOptions = computed(() => {
    const country = this.selectedCountry();
    return this.uniqueLocationValues("state", (business) => !country || this.locationMeta(business).country === country);
  });
  readonly cityOptions = computed(() => {
    const country = this.selectedCountry();
    const state = this.selectedState();
    return this.uniqueLocationValues("city", (business) => {
      const meta = this.locationMeta(business);
      return (!country || meta.country === country) && (!state || meta.state === state);
    });
  });
  readonly filtered = computed(() => {
    const query = this.query().trim().toLowerCase();
    const mode = this.mode();
    const filters = this.activeFilters();
    const sort = this.sort();
    const rows = this.marketplace.businesses().filter((business) => {
      const serviceText = business.services.map((service) => [service.name, service.description, service.category].join(" ")).join(" ");
      const staffText = business.staff.map((staff) => [staff.name, staff.title, staff.specialty].join(" ")).join(" ");
      const locationText = [business.area, business.city, business.address].join(" ");
      const salonText = [business.businessName, business.category, business.popularService, ...business.categories].join(" ");
      const meta = this.locationMeta(business);
      const modeText = (mode === "services"
        ? serviceText || salonText
        : mode === "staff"
          ? staffText || salonText
          : mode === "locations"
            ? locationText
            : [salonText, serviceText, staffText, locationText].join(" ")).toLowerCase();
      const searchText = query
        ? [salonText, serviceText, staffText, locationText].join(" ").toLowerCase()
        : modeText;
      if (query && !searchText.includes(query)) return false;
      if (this.selectedCountry() && meta.country !== this.selectedCountry()) return false;
      if (this.selectedState() && meta.state !== this.selectedState()) return false;
      if (this.selectedCity() && business.city !== this.selectedCity()) return false;
      if (filters.includes("open") && !business.isOpen) return false;
      if (filters.includes("top") && business.ratingAverage < 4.5) return false;
      if (filters.includes("reviewed") && Number(business.ratingCount || 0) < 10) return false;
      if ((filters.includes("deals") || filters.includes("offpeak") || filters.includes("lastminute")) && !business.hasOffer) return false;
      if (filters.includes("nearest") && !this.isUsableDistance(business)) return false;
      if (this.location()) {
        const distanceKm = this.businessDistance(business);
        if (distanceKm !== null && distanceKm > this.radiusKm()) return false;
      }
      if (filters.includes("budget") && business.startingPricePaise > 100000) return false;
      if (filters.includes("mid") && (business.startingPricePaise < 100000 || business.startingPricePaise > 250000)) return false;
      if (filters.includes("premium") && business.startingPricePaise < 250000) return false;
      const minPrice = Number(this.minPrice());
      const maxPrice = Number(this.maxPrice());
      if (Number.isFinite(minPrice) && minPrice > 0 && business.startingPricePaise < minPrice * 100) return false;
      if (Number.isFinite(maxPrice) && maxPrice > 0 && business.startingPricePaise > maxPrice * 100) return false;
      if (filters.some((key) => key === "morning" || key === "afternoon" || key === "evening") && !this.matchesTimeFilter(business, filters)) return false;
      return true;
    });

    const sorted = [...rows];
    if (sort === "rating" || filters.includes("top")) {
      sorted.sort((a, b) => b.ratingAverage - a.ratingAverage);
    } else if (sort === "reviews" || filters.includes("reviewed")) {
      sorted.sort((a, b) => Number(b.ratingCount || 0) - Number(a.ratingCount || 0));
    } else if ((sort === "distance" || filters.includes("nearest")) && this.hasUsableLocation()) {
      sorted.sort((a, b) => (this.businessDistance(a) ?? Number.MAX_SAFE_INTEGER) - (this.businessDistance(b) ?? Number.MAX_SAFE_INTEGER));
    } else if (sort === "earliest") {
      sorted.sort((a, b) => this.availabilityRank(a) - this.availabilityRank(b));
    } else if (sort === "price") {
      sorted.sort((a, b) => a.startingPricePaise - b.startingPricePaise);
    } else if (sort === "price_desc") {
      sorted.sort((a, b) => b.startingPricePaise - a.startingPricePaise);
    }
    return sorted;
  });

  readonly professionalResults = computed<ProfessionalResult[]>(() => {
    const query = this.query().trim().toLowerCase();
    const results = this.filtered().flatMap((business) => {
      const service = this.bestPricedService(business);
      return business.staff
        .filter((staff) => {
          if (!query) return true;
          return [staff.name, staff.title, staff.specialty, business.businessName, service?.name].join(" ").toLowerCase().includes(query);
        })
        .map((staff) => ({
          key: `${business.id}-${staff.id}`,
          staff,
          business,
          serviceName: service?.name || business.popularService || business.category,
          pricePaise: service?.pricePaise || business.startingPricePaise
        }));
    });
    if (this.sort() === "price") results.sort((a, b) => a.pricePaise - b.pricePaise);
    if (this.sort() === "price_desc") results.sort((a, b) => b.pricePaise - a.pricePaise);
    if (this.sort() === "rating") results.sort((a, b) => this.professionalRatingNumber(b) - this.professionalRatingNumber(a));
    if (this.sort() === "reviews") results.sort((a, b) => Number(b.business.ratingCount || 0) - Number(a.business.ratingCount || 0));
    if ((this.sort() === "distance" || this.activeFilters().includes("nearest")) && this.hasUsableLocation()) {
      results.sort((a, b) => (this.businessDistance(a.business) ?? Number.MAX_SAFE_INTEGER) - (this.businessDistance(b.business) ?? Number.MAX_SAFE_INTEGER));
    }
    if (this.sort() === "earliest") results.sort((a, b) => this.availabilityRank(a.business) - this.availabilityRank(b.business));
    return results;
  });
  readonly resultCount = computed(() => this.mode() === "staff" ? this.professionalResults().length : this.filtered().length);
  readonly filterLabel = computed(() => this.activeFilterSummary().join(", ") || "all filters");
  readonly showMap = computed(() => this.mapPanelOpen() || this.mapPickMode());

  constructor(readonly marketplace: MarketplaceService, private readonly route: ActivatedRoute) {
    addIcons({ arrowBackOutline, businessOutline, compassOutline, heart, heartOutline, locateOutline, locationOutline, mapOutline, optionsOutline, peopleOutline, pricetagOutline, ribbonOutline, sparklesOutline, swapVerticalOutline });
  }

  ngOnInit() {
    this.routeSubscription = this.route.queryParamMap.subscribe((params) => {
      const intent = this.routeSearchIntent(params.get("q") || "");
      const nextQuery = intent.query;
      const nextMode = this.toSearchMode(params.get("mode")) || intent.mode;
      const nextFilter = this.toFilterKey(params.get("filter"));
      const nextSort = this.toSortKey(params.get("sort"));
      if (this.query() !== nextQuery) this.query.set(nextQuery);
      if (nextMode) this.mode.set(nextMode);
      if (nextFilter) {
        this.filter.set(nextFilter);
        this.activeFilters.set(this.normalizedFilterList([nextFilter]));
      }
      if (nextSort) this.sort.set(nextSort);
      this.selectedCountry.set(params.get("country") || "");
      this.selectedState.set(params.get("state") || "");
      this.selectedCity.set(params.get("city") || "");
      if (params.get("nearMe") === "true" || intent.nearMe) {
        this.useLocation();
        return;
      }
      void this.executeSearch();
    });
  }

  ngAfterViewInit() {
    // Teleport the filter/sort overlay to <body> so position:fixed resolves to the
    // viewport. Inside ion-content the overlay is trapped by ancestor stacking/containing
    // blocks (ion-tabs .tabs-inner uses `contain`, the page has a transform), which hid the
    // sheets. As a direct child of <body> it overlays the whole app, including the tab bar.
    const host = this.overlayHost?.nativeElement;
    if (host && host.parentNode !== document.body) {
      document.body.appendChild(host);
    }
  }

  ngOnDestroy() {
    this.routeSubscription?.unsubscribe();
    const host = this.overlayHost?.nativeElement;
    if (host && host.parentNode) {
      host.parentNode.removeChild(host);
    }
  }

  reset() {
    this.query.set("");
    this.filter.set("open");
    this.sort.set("recommended");
    this.activeFilters.set([]);
    this.draftFilters.set([]);
    this.draftSort.set("recommended");
    this.minPrice.set("");
    this.maxPrice.set("");
    this.draftMinPrice.set("");
    this.draftMaxPrice.set("");
    this.radiusKm.set(25);
    this.draftRadiusKm.set(25);
    this.filterPanelOpen.set(false);
    this.sortPanelOpen.set(false);
    void this.executeSearch();
  }

  setQuery(value: string) {
    this.query.set(value);
    void this.executeSearch();
  }

  setMode(value: SearchMode) {
    this.applyMode(value);
  }

  applyMode(value: SearchMode) {
    this.mode.set(value);
    this.draftMode.set(value);
    this.filterPanelOpen.set(false);
    this.sortPanelOpen.set(false);
    void this.executeSearch();
  }

  setCountry(value: string) {
    this.selectedCountry.set(value);
    const validStates = this.stateOptions();
    if (this.selectedState() && !validStates.includes(this.selectedState())) this.selectedState.set("");
    const validCities = this.cityOptions();
    if (this.selectedCity() && !validCities.includes(this.selectedCity())) this.selectedCity.set("");
    this.mode.set("locations");
    void this.executeSearch();
  }

  setState(value: string) {
    this.selectedState.set(value);
    const validCities = this.cityOptions();
    if (this.selectedCity() && !validCities.includes(this.selectedCity())) this.selectedCity.set("");
    this.mode.set("locations");
    void this.executeSearch();
  }

  setCity(value: string) {
    this.selectedCity.set(value);
    this.mode.set("locations");
    void this.executeSearch();
  }

  clearSelectedArea() {
    this.location.set(null);
    this.mapPickMode.set(false);
    this.locationRetryAvailable.set(false);
    this.mapErrorTitle.set("");
    this.mapError.set("");
    this.removeLocationDependentState();
    void this.executeSearch();
  }

  setSort(value: SortKey) {
    this.sort.set(value);
    this.draftSort.set(value);
    this.filterPanelOpen.set(false);
    this.sortPanelOpen.set(false);
    if (value === "distance" && !this.hasUsableLocation()) {
      this.sort.set("recommended");
      this.draftSort.set("recommended");
      this.useLocation();
      return;
    }
    void this.executeSearch();
  }

  toggleFilterPanel() {
    this.draftMode.set(this.mode());
    this.draftFilters.set([...this.activeFilters()]);
    this.draftRadiusKm.set(this.radiusKm());
    this.draftMinPrice.set(this.minPrice());
    this.draftMaxPrice.set(this.maxPrice());
    this.filterPanelOpen.update((value) => !value);
    if (this.filterPanelOpen()) this.sortPanelOpen.set(false);
  }

  toggleSortPanel() {
    this.draftSort.set(this.sort());
    this.sortPanelOpen.update((value) => !value);
    if (this.sortPanelOpen()) this.filterPanelOpen.set(false);
  }

  sortDescription(value: SortKey): string {
    if (value === "distance") return "Closest results first";
    if (value === "earliest") return "Soonest slot shown first";
    if (value === "price") return "Lowest starting price";
    if (value === "price_desc") return "Highest starting price";
    if (value === "rating") return "Highest rated first";
    if (value === "reviews") return "Most reviewed first";
    return "Recommended for you";
  }

  openFilterSection() {
    this.toggleFilterPanel();
  }

  applyAnyTime() {
    const filters = this.activeFilters().filter((key) => key !== "open" && !this.isTimeFilterKey(key));
    this.activeFilters.set(filters);
    this.draftFilters.set(filters);
    this.filter.set(filters[0] || "open");
    void this.executeSearch();
  }

  closeSheets() {
    this.filterPanelOpen.set(false);
    this.sortPanelOpen.set(false);
  }

  toggleDraftFilter(value: FilterKey) {
    if (value === "anytime") {
      this.draftFilters.update((filters) => filters.filter((item) => !this.isTimeFilterKey(item)));
      return;
    }
    this.draftFilters.update((filters) => {
      const next = filters.includes(value) ? filters.filter((item) => item !== value) : [...filters, value];
      return this.normalizedFilterList(next);
    });
  }

  isDraftOptionSelected(value: FilterKey): boolean {
    if (value === "anytime") return !this.draftFilters().some((key) => this.isTimeFilterKey(key));
    return this.draftFilters().includes(value);
  }

  clearDraftFilters() {
    this.draftFilters.set([]);
    this.draftMode.set("salons");
    this.draftRadiusKm.set(25);
    this.draftMinPrice.set("");
    this.draftMaxPrice.set("");
  }

  clearFilters() {
    this.activeFilters.set([]);
    this.filter.set("open");
    this.minPrice.set("");
    this.maxPrice.set("");
    this.radiusKm.set(25);
    this.draftFilters.set([]);
    this.draftMinPrice.set("");
    this.draftMaxPrice.set("");
    this.draftRadiusKm.set(25);
    this.filterPanelOpen.set(false);
    void this.executeSearch();
  }

  applyFilters() {
    const filters = this.normalizedFilterList(this.draftFilters());
    this.mode.set(this.draftMode());
    this.radiusKm.set(this.draftRadiusKm());
    this.minPrice.set(this.draftMinPrice());
    this.maxPrice.set(this.draftMaxPrice());
    this.filterPanelOpen.set(false);
    if (filters.includes("nearest") && !this.hasUsableLocation()) {
      const withoutNearest = filters.filter((item) => item !== "nearest");
      this.activeFilters.set(withoutNearest);
      this.filter.set(withoutNearest[0] || "open");
      this.useLocation();
      return;
    }
    this.activeFilters.set(filters);
    this.filter.set(filters[0] || "open");
    void this.executeSearch();
  }

  applySort() {
    this.setSort(this.draftSort());
  }

  applyShortcut(query: string, filter: FilterKey) {
    this.query.set(query);
    const filters = this.normalizedFilterList([filter]);
    this.filter.set(filters[0] || "open");
    this.activeFilters.set(filters);
    if (filter === "nearest" && !this.hasUsableLocation()) {
      this.activeFilters.set(filters.filter((item) => item !== "nearest"));
      this.useLocation();
      return;
    }
    void this.executeSearch();
  }

  applySuggestion(suggestion: SearchSuggestion) {
    this.query.set(suggestion.query);
    this.selectedBusiness.set(suggestion.business);
    const coordinates = this.businessCoordinates(suggestion.business);
    if (coordinates) this.mapCenter.set(coordinates);
    void this.executeSearch();
  }

  async executeSearch() {
    const query = this.query().trim();
    const filters = this.activeFilters();
    const shouldSortByDistance = this.hasUsableLocation() && !!query && this.sort() === "recommended";
    await this.marketplace.searchBusinesses({
      q: query,
      city: this.selectedCity() || undefined,
      lat: this.location()?.lat,
      lng: this.location()?.lng,
      radiusKm: this.hasUsableLocation() ? this.radiusKm() : undefined,
      openNow: filters.includes("open") || undefined,
      topRated: filters.includes("top") || undefined,
      offers: filters.some((key) => key === "deals" || key === "offpeak" || key === "lastminute") || undefined,
      availableToday: filters.includes("today") || undefined,
      minPricePaise: this.apiMinPricePaise(),
      maxPricePaise: this.apiMaxPricePaise(),
      staffGender: filters.includes("female") ? "female" : filters.includes("male") ? "male" : undefined,
      sort: this.apiSort(shouldSortByDistance)
    }).then((rows) => {
      if (!this.selectedBusiness() || !rows.some((business) => business.id === this.selectedBusiness()?.id)) {
        this.selectedBusiness.set(rows[0] ?? null);
      }
      this.fitToResults();
    }).catch(() => undefined);
  }

  useLocation(isManualRetry = false) {
    this.mapPanelOpen.set(true);
    this.mapPickMode.set(false);
    this.requestCurrentLocation(isManualRetry ? 2 : 1);
  }

  toggleMapPickMode() {
    this.mapPanelOpen.set(true);
    this.mapPickMode.update((value) => !value);
    this.mapErrorTitle.set("");
    this.mapError.set("");
    this.locationNotice.set("Tap anywhere on the map to choose that area.");
  }

  toggleMapPanel() {
    this.mapPanelOpen.update((value) => !value);
    if (!this.mapPanelOpen()) this.mapPickMode.set(false);
  }

  private requestCurrentLocation(attempt: number) {
    if (!navigator.geolocation) {
      this.mapErrorTitle.set("Location unsupported");
      this.mapError.set("Your browser does not support location. You can still pan, zoom and search the map.");
      this.locationRetryAvailable.set(false);
      this.removeLocationDependentState();
      void this.executeSearch();
      return;
    }
    this.mapLoading.set(true);
    this.locationNotice.set(attempt > 1
      ? "Retrying with more time. Keep this tab active and allow location access if Chrome asks."
      : "Your browser may ask for location permission. Choose Allow to show your current area.");
    this.mapErrorTitle.set("");
    this.mapError.set("");
    this.locationRetryAvailable.set(false);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const currentLocation = { lat: position.coords.latitude, lng: position.coords.longitude };
        this.location.set(currentLocation);
        this.mapCenter.set(currentLocation);
        this.mapZoom.set(Math.max(this.mapZoom(), 13));
        this.filter.set("nearest");
        this.sort.set("distance");
        this.activeFilters.set(this.normalizedFilterList([...this.activeFilters(), "nearest"]));
        this.draftFilters.set(this.activeFilters());
        this.draftSort.set("distance");
        this.mapLoading.set(false);
        this.mapErrorTitle.set("");
        this.mapError.set("");
        this.locationRetryAvailable.set(false);
        void this.executeSearch();
      },
      (error) => {
        if (error.code === 3 && attempt === 1) {
          this.requestCurrentLocation(2);
          return;
        }
        this.mapLoading.set(false);
        this.removeLocationDependentState();
        this.setLocationError(error);
        void this.executeSearch();
      },
      { enableHighAccuracy: true, timeout: this.locationTimeoutMs, maximumAge: 30000 }
    );
  }

  private setLocationError(error: GeolocationPositionError) {
    if (error.code === 1) {
      this.mapErrorTitle.set("Location permission blocked");
      this.mapError.set("Location permission is blocked. Please enable location access in your browser.");
      this.locationRetryAvailable.set(false);
      return;
    }
    if (error.code === 3) {
      this.mapErrorTitle.set("Location timed out");
      this.mapError.set("Location timed out. Please try again. Mapped venues are still visible while you retry.");
      this.locationRetryAvailable.set(true);
      return;
    }
    this.mapErrorTitle.set("Location unavailable");
    this.mapError.set("Unable to get your current location. Please try again. Mapped venues are still visible.");
    this.locationRetryAvailable.set(true);
  }

  selectBusiness(business: import("../../core/api.types").Business, event?: Event) {
    event?.stopPropagation();
    this.selectedBusiness.set(business);
    const coordinates = this.businessCoordinates(business);
    if (coordinates) this.mapCenter.set(coordinates);
  }

  fitToResults() {
    const points = this.filtered().map((business) => this.businessCoordinates(business)).filter(Boolean) as { lat: number; lng: number }[];
    if (this.location()) points.push(this.location() as { lat: number; lng: number });
    if (!points.length) return;
    const lat = points.reduce((sum, point) => sum + point.lat, 0) / points.length;
    const lng = points.reduce((sum, point) => sum + point.lng, 0) / points.length;
    this.mapCenter.set({ lat, lng });
    if (points.length === 1) {
      this.mapZoom.set(13);
      return;
    }
    const viewport = this.mapViewport();
    for (let zoom = 13; zoom >= 4; zoom -= 1) {
      const projected = points.map((point) => this.latLngToWorld(point.lat, point.lng, zoom));
      const xs = projected.map((point) => point.x);
      const ys = projected.map((point) => point.y);
      if (Math.max(...xs) - Math.min(...xs) <= viewport.width - 96 && Math.max(...ys) - Math.min(...ys) <= viewport.height - 96) {
        this.mapZoom.set(zoom);
        return;
      }
    }
    this.mapZoom.set(4);
  }

  zoomIn() {
    this.mapZoom.update((zoom) => Math.min(18, zoom + 1));
  }

  zoomOut() {
    this.mapZoom.update((zoom) => Math.max(4, zoom - 1));
  }

  startPan(event: PointerEvent) {
    const target = event.target as HTMLElement;
    if (target.closest("button")) return;
    this.panStart = { x: event.clientX, y: event.clientY, center: this.mapCenter() };
  }

  movePan(event: PointerEvent) {
    if (!this.panStart) return;
    const zoom = this.mapZoom();
    const startWorld = this.latLngToWorld(this.panStart.center.lat, this.panStart.center.lng, zoom);
    const nextWorld = {
      x: startWorld.x - (event.clientX - this.panStart.x),
      y: startWorld.y - (event.clientY - this.panStart.y)
    };
    this.mapCenter.set(this.worldToLatLng(nextWorld.x, nextWorld.y, zoom));
  }

  endPan() {
    this.panStart = null;
  }

  pickMapLocation(event: MouseEvent) {
    if (!this.mapPickMode()) return;
    const target = event.target as HTMLElement;
    if (target.closest("button")) return;
    const mapElement = event.currentTarget as HTMLElement;
    const rect = mapElement.getBoundingClientRect();
    const zoom = this.mapZoom();
    const center = this.latLngToWorld(this.mapCenter().lat, this.mapCenter().lng, zoom);
    const pickedLocation = this.worldToLatLng(
      center.x + event.clientX - rect.left - rect.width / 2,
      center.y + event.clientY - rect.top - rect.height / 2,
      zoom
    );
    this.location.set(pickedLocation);
    this.mapCenter.set(pickedLocation);
    this.mapPickMode.set(false);
    this.filter.set("nearest");
    this.sort.set("distance");
    this.activeFilters.set(this.normalizedFilterList([...this.activeFilters(), "nearest"]));
    this.draftFilters.set(this.activeFilters());
    this.draftSort.set("distance");
    this.selectedCountry.set("");
    this.selectedState.set("");
    this.selectedCity.set("");
    this.locationNotice.set("Using the area you selected on the map.");
    void this.executeSearch();
  }

  distanceLabel(business: import("../../core/api.types").Business): string {
    const distance = this.businessDistance(business);
    return distance !== null ? `${this.decimalText(distance)} km away` : "Distance available after location";
  }

  businessDistanceForCard(business: import("../../core/api.types").Business): number | null {
    return this.businessDistance(business);
  }

  ratingText(business: import("../../core/api.types").Business): string {
    if (this.isNewForRating(business)) return "New";
    const rating = Number(business.ratingAverage);
    if (!Number.isFinite(rating) || rating <= 0) return "New";
    return this.oneDecimalText(Math.min(5, rating));
  }

  professionalRatingText(professional: ProfessionalResult): string {
    const rating = this.professionalRatingNumber(professional);
    return Number.isFinite(rating) && rating > 0 ? this.oneDecimalText(Math.min(5, rating)) : "New";
  }

  professionalDistanceLabel(business: import("../../core/api.types").Business): string {
    const distance = this.businessDistance(business);
    return distance !== null && distance <= 100 ? `${this.decimalText(distance)} km away` : "Set location to see nearby professionals";
  }

  money(value: number): string {
    return (Number(value || 0) / 100).toLocaleString("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 });
  }

  async toggleSaveProfessional(event: Event, businessId: string) {
    event.stopPropagation();
    await this.marketplace.toggleFavorite(businessId).catch(() => undefined);
  }

  private professionalRatingNumber(professional: ProfessionalResult): number {
    return Number(professional.staff.rating || professional.business.ratingAverage || 0);
  }

  private bestPricedService(business: import("../../core/api.types").Business): import("../../core/api.types").ServiceItem | null {
    return [...business.services].sort((a, b) => Number(a.pricePaise || 0) - Number(b.pricePaise || 0))[0] || null;
  }

  private normalizedFilterList(filters: FilterKey[]): FilterKey[] {
    const unique = [...new Set(filters)].filter((key) => key !== "anytime");
    const timeFilters = unique.filter((key) => this.isTimeFilterKey(key));
    const priceFilters = unique.filter((key) => key === "budget" || key === "mid" || key === "premium");
    const staffFilters = unique.filter((key) => key === "female" || key === "male");
    return unique.filter((key) => {
      if ((key === "today" || key === "morning" || key === "afternoon" || key === "evening") && timeFilters[timeFilters.length - 1] !== key) return false;
      if ((key === "budget" || key === "mid" || key === "premium") && priceFilters[priceFilters.length - 1] !== key) return false;
      if ((key === "female" || key === "male") && staffFilters[staffFilters.length - 1] !== key) return false;
      return true;
    });
  }

  private isTimeFilterKey(key: FilterKey): boolean {
    return key === "today" || key === "morning" || key === "afternoon" || key === "evening";
  }

  private hasUsableLocation(): boolean {
    return !!this.location();
  }

  private removeLocationDependentState() {
    const filters = this.activeFilters().filter((key) => key !== "nearest");
    this.activeFilters.set(filters);
    this.draftFilters.set(this.draftFilters().filter((key) => key !== "nearest"));
    this.filter.set(filters[0] || "open");
    if (this.sort() === "distance") this.sort.set("recommended");
    if (this.draftSort() === "distance") this.draftSort.set("recommended");
  }

  private isUsableDistance(business: import("../../core/api.types").Business): boolean {
    const distance = this.businessDistance(business);
    return distance !== null && distance <= 100;
  }

  private matchesTimeFilter(business: import("../../core/api.types").Business, filters: FilterKey[]): boolean {
    if (filters.includes("today")) return Boolean(business.nextAvailableSlot || business.isOpen);
    const label = `${business.nextAvailableSlot || ""} ${business.hoursLabel || ""}`.toLowerCase();
    const hour = this.extractHour(label);
    if (hour === null) return false;
    if (filters.includes("morning")) return hour < 12;
    if (filters.includes("afternoon")) return hour >= 12 && hour < 17;
    if (filters.includes("evening")) return hour >= 17;
    return true;
  }

  private extractHour(value: string): number | null {
    const match = value.match(/\b(\d{1,2})(?::\d{2})?\s*(am|pm)?\b/i);
    if (!match) return null;
    let hour = Number(match[1]);
    const meridiem = (match[2] || "").toLowerCase();
    if (meridiem === "pm" && hour < 12) hour += 12;
    if (meridiem === "am" && hour === 12) hour = 0;
    return Number.isFinite(hour) ? hour : null;
  }

  private availabilityRank(business: import("../../core/api.types").Business): number {
    const hour = this.extractHour(`${business.nextAvailableSlot || ""} ${business.hoursLabel || ""}`.toLowerCase());
    return hour ?? Number.MAX_SAFE_INTEGER;
  }

  private apiMinPricePaise(): number | undefined {
    const filters = this.activeFilters();
    const custom = Number(this.minPrice());
    if (Number.isFinite(custom) && custom > 0) return custom * 100;
    if (filters.includes("mid")) return 100000;
    if (filters.includes("premium")) return 250000;
    return undefined;
  }

  private apiMaxPricePaise(): number | undefined {
    const filters = this.activeFilters();
    const custom = Number(this.maxPrice());
    if (Number.isFinite(custom) && custom > 0) return custom * 100;
    if (filters.includes("budget")) return 100000;
    if (filters.includes("mid")) return 250000;
    return undefined;
  }

  private apiSort(shouldSortByDistance: boolean): "recommended" | "rating" | "distance" | "price" {
    if ((this.sort() === "distance" || shouldSortByDistance || this.activeFilters().includes("nearest")) && this.hasUsableLocation()) return "distance";
    if (this.sort() === "rating" || this.sort() === "reviews") return "rating";
    if (this.sort() === "price" || this.sort() === "price_desc") return "price";
    return "recommended";
  }

  private businessDistance(business: import("../../core/api.types").Business): number | null {
    if (business.distanceKm !== null && business.distanceKm !== undefined && Number.isFinite(Number(business.distanceKm))) return Number(business.distanceKm);
    const location = this.location();
    const coordinates = this.businessCoordinates(business);
    return location && coordinates ? this.distanceKm(location, coordinates) : null;
  }

  private decimalText(value: number): string {
    return Number(value.toFixed(2)).toString();
  }

  private oneDecimalText(value: number): string {
    return Number(value.toFixed(1)).toString();
  }

  private isNewForRating(business: import("../../core/api.types").Business): boolean {
    const hasEnoughReviews = Number(business.ratingCount || 0) >= 5;
    const createdAt = business.createdAt ? new Date(business.createdAt).getTime() : Number.NaN;
    const isFirstMonth = Number.isFinite(createdAt) && Date.now() - createdAt < 30 * 24 * 60 * 60 * 1000;
    return !hasEnoughReviews || isFirstMonth;
  }

  private businessCoordinates(business: import("../../core/api.types").Business): { lat: number; lng: number } | null {
    const lat = Number(business.latitude);
    const lng = Number(business.longitude);
    return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
  }

  private pointForBusiness(business: import("../../core/api.types").Business): { x: number; y: number } | null {
    const coordinates = this.businessCoordinates(business);
    return coordinates ? this.pointFor(coordinates) : null;
  }

  private uniqueLocationValues(kind: "country" | "state" | "city", predicate: (business: import("../../core/api.types").Business) => boolean = () => true): string[] {
    return [...new Set(this.marketplace.businesses()
      .filter(predicate)
      .map((business) => kind === "city" ? business.city : this.locationMeta(business)[kind])
      .filter(Boolean))]
      .sort((left, right) => left.localeCompare(right));
  }

  private locationMeta(business: import("../../core/api.types").Business): { country: string; state: string } {
    const city = String(business.city || "").trim().toLowerCase();
    const indianStates: Record<string, string> = {
      bengaluru: "Karnataka",
      bangalore: "Karnataka",
      hyderabad: "Telangana",
      mumbai: "Maharashtra",
      pune: "Maharashtra",
      thane: "Maharashtra",
      delhi: "Delhi",
      gurugram: "Haryana",
      gurgaon: "Haryana",
      noida: "Uttar Pradesh",
      chennai: "Tamil Nadu",
      kolkata: "West Bengal",
      ahmedabad: "Gujarat",
      jaipur: "Rajasthan",
      chandigarh: "Chandigarh",
      kochi: "Kerala"
    };
    const state = indianStates[city] || "Other";
    return { country: state === "Other" ? "Other" : "India", state };
  }

  private bestSuggestionFor(business: import("../../core/api.types").Business, query: string): SearchSuggestion | null {
    const contains = (value: string | undefined) => String(value || "").toLowerCase().includes(query);
    const service = business.services.find((item) => contains(item.name) || contains(item.category));
    if (service) {
      return {
        key: `service-${business.id}-${service.id}`,
        label: service.name,
        type: "Service",
        copy: business.businessName,
        query: service.name,
        business
      };
    }
    const staff = business.staff.find((person) => contains(person.name) || contains(person.specialty) || contains(person.title));
    if (staff) {
      return {
        key: `staff-${business.id}-${staff.id}`,
        label: staff.name,
        type: "Staff",
        copy: business.businessName,
        query: staff.name,
        business
      };
    }
    if (contains(business.area) || contains(business.city) || contains(business.address)) {
      return {
        key: `location-${business.id}`,
        label: [business.area, business.city].filter(Boolean).join(", ") || business.address,
        type: "Location",
        copy: business.businessName,
        query: business.area || business.city || business.address,
        business
      };
    }
    if (contains(business.businessName) || contains(business.category) || contains(business.popularService)) {
      return {
        key: `business-${business.id}`,
        label: business.businessName,
        type: "Salon",
        copy: business.area || business.city || business.category,
        query: business.businessName,
        business
      };
    }
    return null;
  }

  private toSearchMode(value: string | null): SearchMode | null {
    return value === "salons" || value === "services" || value === "staff" || value === "locations" ? value : null;
  }

  private toFilterKey(value: string | null): FilterKey | null {
    const key = value === "offers" ? "deals" : value === "price" ? "mid" : value;
    return key === "anytime" || key === "open" || key === "today" || key === "morning" || key === "afternoon" || key === "evening" || key === "nearest" || key === "budget" || key === "mid" || key === "premium" || key === "top" || key === "reviewed" || key === "deals" || key === "offpeak" || key === "lastminute" || key === "female" || key === "male" ? key : null;
  }

  private toSortKey(value: string | null): SortKey | null {
    return value === "recommended" || value === "rating" || value === "distance" || value === "price" || value === "price_desc" || value === "reviews" || value === "earliest" ? value : null;
  }

  private routeSearchIntent(value: string): { query: string; nearMe: boolean; mode: SearchMode | null } {
    const lower = value.toLowerCase();
    const nearMe = /\b(near me|nearby|around me|current location)\b/.test(lower);
    const locationMode = /\b(location|area|city|near this location)\b/.test(lower);
    const staffMode = /\b(staff|artist|professional|barber|stylist)\b/.test(lower);
    const serviceMode = /\b(service|hair|nail|facial|makeup|spa|massage|wax|skin|manicure|pedicure)\b/.test(lower);
    const salonMode = /\b(salon|salons|spa|clinic|barber)\b/.test(lower);
    const cleaned = value
      .replace(/\b(near me|nearby|around me|current location|near this location)\b/gi, "")
      .replace(/\s+/g, " ")
      .trim();
    return {
      query: cleaned || (salonMode ? "salon" : value),
      nearMe,
      mode: locationMode ? "locations" : staffMode ? "staff" : serviceMode ? "services" : salonMode ? "salons" : null
    };
  }

  private pointFor(coordinates: { lat: number; lng: number }): { x: number; y: number } {
    const zoom = this.mapZoom();
    const viewport = this.mapViewport();
    const center = this.latLngToWorld(this.mapCenter().lat, this.mapCenter().lng, zoom);
    const point = this.latLngToWorld(coordinates.lat, coordinates.lng, zoom);
    return {
      x: point.x - center.x + viewport.width / 2,
      y: point.y - center.y + viewport.height / 2
    };
  }

  private mapViewport(): { width: number; height: number } {
    if (window.innerWidth < 560) return { width: Math.min(window.innerWidth - 32, 520), height: 300 };
    if (window.innerWidth < 1024) return { width: Math.min(window.innerWidth - 32, 720), height: 360 };
    return { width: 500, height: 360 };
  }

  private latLngToWorld(lat: number, lng: number, zoom: number): { x: number; y: number } {
    const scale = 256 * 2 ** zoom;
    const sin = Math.sin(lat * Math.PI / 180);
    return {
      x: (lng + 180) / 360 * scale,
      y: (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * scale
    };
  }

  private worldToLatLng(x: number, y: number, zoom: number): { lat: number; lng: number } {
    const scale = 256 * 2 ** zoom;
    const lng = x / scale * 360 - 180;
    const n = Math.PI - 2 * Math.PI * y / scale;
    const lat = 180 / Math.PI * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
    return { lat, lng };
  }

  private distanceKm(from: { lat: number; lng: number }, to: { lat: number; lng: number }): number {
    const toRadians = (value: number) => value * Math.PI / 180;
    const dLat = toRadians(to.lat - from.lat);
    const dLng = toRadians(to.lng - from.lng);
    const lat1 = toRadians(from.lat);
    const lat2 = toRadians(to.lat);
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
    return Math.round((6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))) * 10) / 10;
  }
}
