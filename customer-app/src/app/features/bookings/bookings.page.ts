import { Component, OnDestroy, OnInit, ViewChild, computed, signal } from "@angular/core";
import { Router, RouterLink } from "@angular/router";
import { IonButton, IonContent, IonIcon, IonRefresher, IonRefresherContent, IonSegment, IonSegmentButton, ToastController } from "@ionic/angular/standalone";
import { addIcons } from "ionicons";
import { cardOutline, checkmarkCircleOutline, chevronForwardOutline, helpCircleOutline, locationOutline, repeatOutline, timeOutline } from "ionicons/icons";
import { MarketplaceService } from "../../core/marketplace.service";
import { Booking } from "../../core/api.types";

type BookingTab = "upcoming" | "past" | "cancelled";
type BookingGroup = { key: string; label: string; countLabel: string; items: Booking[] };
type PaymentTone = "paid" | "pending" | "refunded" | "default";
type EffectiveBookingStatus = Booking["status"] | "no_show";
type CheckInState = { kind: "available" | "checked_in" | "unavailable" | "hidden"; reason?: string };

@Component({
  standalone: true,
  imports: [RouterLink, IonButton, IonContent, IonIcon, IonRefresher, IonRefresherContent, IonSegment, IonSegmentButton],
  template: `
    <ion-content #bookingsContent>
      <ion-refresher slot="fixed" (ionRefresh)="onPullRefresh($event)">
        <ion-refresher-content pullingIcon="crescent" pullingText="Refreshing bookings..." refreshingSpinner="crescent"></ion-refresher-content>
      </ion-refresher>
      <main class="page bookings-page">
        <section class="bookings-hero">
          <div class="header-actions-row">
            <a class="support-link" [routerLink]="supportLink()" aria-label="Open booking support">
              <ion-icon name="help-circle-outline" aria-hidden="true"></ion-icon>
              <span>Support</span>
            </a>
          </div>
          <div class="content-title-row">
            <h1 class="page-title">My bookings</h1>
          </div>
        </section>

        <div class="booking-tabs-shell">
          <ion-segment [value]="tab()" (ionChange)="setTab($any($event.detail.value) || 'upcoming')">
            <ion-segment-button value="upcoming">Upcoming</ion-segment-button>
            <ion-segment-button value="past">Past</ion-segment-button>
            <ion-segment-button value="cancelled">Cancelled</ion-segment-button>
          </ion-segment>
        </div>

        @if (showTopProgress()) {
          <div class="refresh-strip" role="status" aria-label="Updating bookings"><span></span></div>
        }

        @if (tabLoaded()[tab()]) {
          @if (filtered().length) {
            @for (group of groups(); track group.key) {
              <section class="date-group" [attr.aria-label]="group.label || undefined">
                @if (group.label) {
                  <h2 class="date-group-label">{{ group.label }}@if (group.countLabel) { <span>{{ group.countLabel }}</span> }</h2>
                }
                <div class="booking-stack">
                  @for (booking of group.items; track booking.id) {
                    <article
                      class="booking-card premium-card"
                      [class.cancelled]="booking.status === 'cancelled'"
                      [attr.data-booking-id]="booking.id"
                      role="button"
                      tabindex="0"
                      [attr.aria-label]="cardLabel(booking)"
                      (click)="openBooking(booking)"
                      (keydown)="handleBookingKeydown($event, booking)"
                    >
                      <div class="date-block" aria-hidden="true">
                        <span>{{ dateParts(booking).month }}</span>
                        <strong>{{ dateParts(booking).day }}</strong>
                      </div>
                      <div class="booking-content">
                        <div class="booking-main">
                          <h2 class="booking-service">{{ bookingTitle(booking) }}</h2>
                          @if (serviceCount(booking) > 1) {
                            <p class="service-subtitle">Includes {{ booking.serviceName }}</p>
                          }
                          <p class="salon-name">{{ booking.businessName }}</p>
                          <div class="booking-meta">
                            <span class="meta-line">
                              <ion-icon name="time-outline" aria-hidden="true"></ion-icon>
                              <span class="meta-text">{{ bookingDateTimeLabel(booking) }}</span>
                            </span>
                            @if (compactProfessionalLine(booking); as professional) {
                              <span class="meta-line compact-line">
                                <span class="meta-dot" aria-hidden="true"></span>
                                <span class="meta-text">{{ professional }}</span>
                              </span>
                            }
                            <span class="meta-line">
                              <ion-icon name="location-outline" aria-hidden="true"></ion-icon>
                              <span class="meta-text" [title]="booking.address || 'Venue to be confirmed'">{{ booking.address || "Venue to be confirmed" }}</span>
                            </span>
                            @if (paymentMetaLabel(booking); as payment) {
                              <span class="meta-line tone-{{ payment.tone }}">
                                <ion-icon name="card-outline" aria-hidden="true"></ion-icon>
                                <span class="meta-text">{{ payment.label }}</span>
                              </span>
                            }
                          </div>
                        </div>
                        <div class="booking-footer">
                          <span class="status-pill status-{{ effectiveStatus(booking) }}" role="status">{{ statusLabel(effectiveStatus(booking)) }}</span>
                          <div class="footer-actions">
                            @if (showCheckIn(booking)) {
                              <button type="button" class="card-action checkin" (click)="checkIn($event, booking)">
                                <ion-icon name="checkmark-circle-outline" aria-hidden="true"></ion-icon>
                                Check-in
                              </button>
                            }
                            @if (showRebook(booking)) {
                              <button type="button" class="card-action rebook" (click)="rebook($event, booking)">
                                <ion-icon name="repeat-outline" aria-hidden="true"></ion-icon>
                                Book again
                              </button>
                            }
                          </div>
                          <span class="card-chevron-hit" aria-hidden="true"><ion-icon class="card-chevron" name="chevron-forward-outline"></ion-icon></span>
                        </div>
                      </div>
                    </article>
                  }
                </div>
              </section>
            }
          } @else {
            <section class="empty premium-card">
              <h2>{{ emptyTitle() }}</h2>
              <ion-button class="primary-gradient" [routerLink]="discoverLink()">{{ emptyActionLabel() }}</ion-button>
            </section>
          }
        } @else if (tabBusy()[tab()]) {
          <section class="empty premium-card"><h2>Loading bookings</h2></section>
        } @else if (marketplace.error()) {
          <section class="empty premium-card error">
            <h2>Could not load bookings</h2>
            <p>{{ marketplace.error() }}</p>
            <ion-button class="primary-gradient" (click)="reload()">Retry</ion-button>
          </section>
        }
      </main>

      @if (cancelDialog(); as booking) {
        <div class="cancel-backdrop" role="presentation" (click)="closeCancelDialog()">
          <section class="cancel-sheet" role="dialog" aria-modal="true" aria-labelledby="cancel-booking-title" (click)="$event.stopPropagation()">
            <div>
              <h2 id="cancel-booking-title">Cancel this booking?</h2>
              <p>{{ booking.serviceName }} at {{ booking.businessName }} will be cancelled. The salon may apply its cancellation policy.</p>
            </div>
            <div class="cancel-actions">
              <button type="button" class="neutral-action" (click)="closeCancelDialog()">Keep booking</button>
              <button type="button" class="destructive-action" (click)="confirmCancel(booking.id)">Cancel booking</button>
            </div>
          </section>
        </div>
      }
    </ion-content>
  `,
  styles: [`
    .bookings-page {
      max-width: 1180px;
      padding-top: 0;
      scroll-padding-top: calc(174px + env(safe-area-inset-top));
    }

    .bookings-hero {
      position: sticky;
      top: 0;
      z-index: 20;
      display: grid;
      gap: 10px;
      margin: 0 calc(var(--page-x, 0px) * -1) 18px;
      padding: calc(12px + env(safe-area-inset-top)) var(--page-x, 0px) 12px;
      background: linear-gradient(180deg, rgba(255, 250, 246, 0.98), rgba(255, 250, 246, 0.94));
      backdrop-filter: blur(18px);
    }

    .header-actions-row {
      display: flex;
      justify-content: flex-end;
      min-height: 44px;
    }

    .content-title-row {
      display: flex;
      align-items: center;
      gap: 10px;
    }

    .content-title-row .page-title {
      margin: 0;
    }

    .support-link {
      margin-left: auto;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      min-width: 44px;
      min-height: 44px;
      padding: 0 14px;
      border: 1px solid var(--border);
      border-radius: 999px;
      color: var(--text);
      background: var(--surface);
      font-size: 0.9rem;
      font-weight: 900;
      text-decoration: none;
      white-space: nowrap;
      transition: color var(--motion-fast), border-color var(--motion-fast), background var(--motion-fast);
    }

    .support-link ion-icon {
      flex: 0 0 auto;
      font-size: 1.1rem;
    }

    .support-link:hover {
      color: var(--primary);
      border-color: rgba(99, 102, 241, 0.35);
      background: var(--primary-soft);
    }

    .support-link:focus-visible {
      outline: 3px solid var(--focus);
      outline-offset: 2px;
      border-radius: 999px;
    }

    .booking-tabs-shell {
      position: sticky;
      top: calc(96px + env(safe-area-inset-top));
      z-index: 19;
      margin: 0 calc(var(--page-x, 0px) * -1) 18px;
      padding: 0 var(--page-x, 0px) 10px;
      background: linear-gradient(180deg, rgba(255, 250, 246, 0.94), rgba(255, 250, 246, 0.88));
      backdrop-filter: blur(18px);
    }

    ion-segment {
      --background: var(--glass);
      margin-bottom: 0;
      border: 1px solid var(--border);
      border-radius: 999px;
      overflow: hidden;
    }

    ion-segment-button {
      --indicator-color: var(--primary);
      --background-checked: var(--primary-soft);
      --color: var(--muted);
      --color-checked: var(--primary);
      min-height: 48px;
      font-weight: 900;
    }

    ion-segment-button::part(indicator-background) {
      height: 3px;
      border-radius: 999px 999px 0 0;
      background: var(--primary);
    }

    .refresh-strip {
      position: relative;
      height: 3px;
      margin: -10px 2px 12px;
      overflow: hidden;
      border-radius: 999px;
      background: rgba(99, 102, 241, 0.14);
    }

    .refresh-strip span {
      position: absolute;
      inset: 0;
      width: 42%;
      border-radius: 999px;
      background: linear-gradient(90deg, transparent, var(--primary), transparent);
      animation: strip-slide 1.1s ease-in-out infinite;
    }

    @keyframes strip-slide {
      from { transform: translateX(-110%); }
      to { transform: translateX(360%); }
    }

    .date-group {
      display: grid;
      gap: 8px;
    }

    .date-group + .date-group {
      margin-top: 18px;
    }

    .date-group-label {
      display: flex;
      align-items: baseline;
      gap: 8px;
      margin: 2px 4px 0;
      color: var(--muted);
      font-size: 0.78rem;
      font-weight: 950;
      letter-spacing: 0.09em;
      text-transform: uppercase;
    }

    .date-group-label span {
      color: var(--muted);
      opacity: 0.75;
      font-size: 0.74rem;
      font-weight: 800;
      letter-spacing: 0.04em;
      text-transform: none;
    }

    .booking-stack {
      display: grid;
      gap: 12px;
    }

    .booking-card {
      display: grid;
      grid-template-columns: 54px minmax(0, 1fr);
      gap: 12px;
      align-items: stretch;
      min-height: 128px;
      padding: 12px 12px 12px 10px;
      color: inherit;
      text-decoration: none;
      cursor: pointer;
      transition: transform 180ms ease, box-shadow 180ms ease, opacity 180ms ease;
    }

    .booking-card.cancelled {
      opacity: 0.82;
    }

    .date-block {
      min-height: 70px;
      display: grid;
      place-items: center;
      align-content: center;
      border-radius: 16px;
      color: #ffffff;
      background: var(--primary);
    }

    .date-block span {
      font-size: 0.72rem;
      font-weight: 900;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      opacity: 0.8;
    }

    .date-block strong {
      font-size: 1.45rem;
      line-height: 1;
    }

    .booking-content {
      display: flex;
      flex-direction: column;
      min-width: 0;
    }

    .booking-service {
      margin: 0;
      color: var(--text);
      font-size: 1.02rem;
      font-weight: 950;
      letter-spacing: -0.03em;
      line-height: 1.25;
      overflow-wrap: anywhere;
    }

    .service-subtitle {
      margin: 2px 0 0;
      color: var(--muted);
      font-size: 0.82rem;
      font-weight: 800;
      line-height: 1.25;
    }

    .service-count {
      display: inline-flex;
      align-items: center;
      margin-left: 8px;
      padding: 2px 8px;
      border-radius: 999px;
      color: var(--primary);
      background: var(--primary-soft, rgba(99, 102, 241, 0.1));
      font-size: 0.74rem;
      font-weight: 900;
      letter-spacing: 0.02em;
      white-space: nowrap;
      vertical-align: middle;
    }

    .salon-name {
      margin: 3px 0 0;
      color: var(--muted);
      font-size: 0.84rem;
      font-weight: 800;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .booking-meta {
      display: grid;
      gap: 4px;
      margin-top: 7px;
      color: var(--muted);
      font-size: 0.82rem;
      font-weight: 750;
    }

    .meta-line {
      display: flex;
      align-items: center;
      gap: 7px;
      min-width: 0;
    }

    .meta-line ion-icon {
      flex: 0 0 auto;
      font-size: 0.92rem;
      color: var(--primary);
    }

    .meta-dot {
      width: 4px;
      height: 4px;
      flex: 0 0 auto;
      margin-left: 5px;
      border-radius: 999px;
      background: var(--primary);
      opacity: 0.72;
    }

    .compact-line {
      font-size: 0.80rem;
    }

    .meta-line .meta-text {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .meta-line.tone-paid { color: #047857; }
    .meta-line.tone-pending { color: #B45309; }
    .meta-line.tone-refunded { color: #1D4ED8; }

    .booking-footer {
      display: flex;
      align-items: center;
      gap: 10px;
      margin-top: auto;
      padding-top: 8px;
    }

    .status-pill {
      flex: 0 0 auto;
      display: inline-flex;
      align-items: center;
      min-height: 24px;
      padding: 3px 10px;
      border: 1px solid;
      border-radius: 999px;
      font-size: 0.80rem;
      font-weight: 850;
      letter-spacing: 0.01em;
      text-transform: capitalize;
      white-space: nowrap;
    }

    .status-pill.status-pending {
      color: #92600A;
      border-color: rgba(217, 119, 6, 0.35);
      background: rgba(251, 191, 36, 0.14);
    }

    .status-pill.status-confirmed {
      color: #047857;
      border-color: rgba(16, 185, 129, 0.4);
      background: rgba(16, 185, 129, 0.13);
    }

    .status-pill.status-completed {
      color: #1D4ED8;
      border-color: rgba(59, 130, 246, 0.36);
      background: rgba(59, 130, 246, 0.12);
    }

    .status-pill.status-cancelled {
      color: #991B1B;
      border-color: rgba(153, 27, 27, 0.28);
      background: rgba(239, 68, 68, 0.1);
    }

    .status-pill.status-no_show {
      color: #7C2D12;
      border-color: rgba(234, 88, 12, 0.36);
      background: rgba(251, 146, 60, 0.14);
    }

    .footer-actions {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-left: auto;
    }

    .card-action {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      min-height: 44px;
      padding: 0 12px;
      border: 1px solid;
      border-radius: 999px;
      font-family: inherit;
      font-size: 0.80rem;
      font-weight: 850;
      white-space: nowrap;
      cursor: pointer;
      transition: color var(--motion-fast), background var(--motion-fast), border-color var(--motion-fast), box-shadow var(--motion-fast);
    }

    .card-action ion-icon {
      font-size: 0.9rem;
    }

    .card-action.checkin {
      color: #ffffff;
      border-color: transparent;
      background: var(--primary);
      box-shadow: 0 6px 14px rgba(99, 102, 241, 0.22);
    }

    .card-action.rebook {
      color: var(--primary);
      border-color: rgba(99, 102, 241, 0.22);
      background: var(--primary-soft, rgba(99, 102, 241, 0.08));
    }

    .card-action:focus-visible {
      outline: 3px solid var(--focus);
      outline-offset: 2px;
    }

    .card-chevron-hit {
      flex: 0 0 auto;
      width: 44px;
      min-width: 44px;
      height: 44px;
      display: grid;
      place-items: center;
      margin-right: -10px;
      border-radius: 999px;
    }

    .card-chevron {
      color: var(--muted);
      font-size: 1rem;
    }

    .booking-card:focus-visible {
      outline: 3px solid var(--focus);
      outline-offset: 2px;
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

    .cancel-backdrop {
      position: fixed;
      inset: 0;
      z-index: 3000;
      display: grid;
      align-items: end;
      padding: 16px 16px calc(16px + env(safe-area-inset-bottom));
      background: rgba(17, 24, 39, 0.42);
    }
    .cancel-sheet {
      width: min(100%, 520px);
      display: grid;
      gap: 16px;
      margin: 0 auto;
      padding: 20px;
      border: 1px solid rgba(180, 35, 24, 0.16);
      border-radius: 24px;
      background: var(--surface);
      box-shadow: 0 24px 60px rgba(28, 28, 28, 0.22);
    }
    .cancel-sheet h2 { margin: 0; color: var(--text); font-size: 1.18rem; letter-spacing: -0.03em; }
    .cancel-sheet p { margin: 8px 0 0; color: var(--muted); font-size: 0.9rem; line-height: 1.45; }
    .cancel-actions { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
    .cancel-actions button { min-height: 48px; border-radius: 999px; font-family: inherit; font-size: 0.9rem; font-weight: 900; }
    .cancel-actions .neutral-action { border: 1px solid var(--border); color: var(--text); background: var(--surface); }
    .cancel-actions .destructive-action { border: 1px solid #B42318; color: #FFFFFF; background: #B42318; }

    @media (hover: hover) and (pointer: fine) {
      .booking-card:hover {
        transform: translateY(-3px);
        box-shadow: var(--shadow-card);
      }
    }

    @media (max-width: 599px) {
      .bookings-page {
        --page-x: 16px;
        padding-top: 0;
      }

      .bookings-hero {
        gap: 8px;
        margin-bottom: 12px;
        padding-bottom: 10px;
      }

      .bookings-hero .page-title {
        margin-bottom: 0;
        font-size: 1.65rem;
        line-height: 1;
      }

      .support-link {
        min-height: 44px;
        padding: 0 14px;
        font-size: 0.9rem;
      }

      ion-segment {
        margin-bottom: 0;
      }

      ion-segment-button {
        min-height: 44px;
        font-size: 0.82rem;
      }

      .booking-card {
        grid-template-columns: 44px minmax(0, 1fr);
        gap: 9px;
        min-height: 118px;
        padding: 9px 10px 9px 8px;
        border-radius: 16px;
      }

      .date-block {
        min-height: 62px;
        border-radius: 14px;
      }

      .date-block span {
        font-size: 0.76rem;
      }

      .date-block strong {
        font-size: 1.24rem;
      }

      .booking-service {
        font-size: 0.96rem;
      }

      .service-subtitle { font-size: 0.78rem; }

      .salon-name {
        margin-top: 2px;
        font-size: 0.8rem;
      }

      .booking-meta {
        gap: 4px;
        margin-top: 5px;
        font-size: 0.84rem;
      }

      .booking-footer {
        flex-wrap: wrap;
        gap: 8px;
        padding-top: 6px;
      }

      .footer-actions {
        gap: 6px;
      }

      .card-action {
        min-height: 32px;
        padding: 0 10px;
        font-size: 0.78rem;
      }

      .status-pill {
        min-height: 22px;
        padding: 2px 8px;
        font-size: 0.78rem;
      }
    }

    @media (min-width: 1024px) {
      .booking-stack {
        grid-template-columns: repeat(2, minmax(0, 1fr));
        align-items: start;
      }
    }

    @media (prefers-reduced-motion: reduce) {
      .refresh-strip span {
        animation: none;
      }

      .booking-card,
      .card-action,
      .status-pill,
      .support-link {
        transition: none;
      }
    }
  `]
})
export class BookingsPage implements OnDestroy, OnInit {
  private static readonly TAB_STORAGE_KEY = "aura_bookings_tab";
  private static readonly SCROLL_STORAGE_KEY = "aura_bookings_scroll_top";
  @ViewChild("bookingsContent") private bookingsContent?: IonContent;
  readonly tab = signal<BookingTab>("upcoming");
  readonly cancelDialog = signal<Booking | null>(null);
  private readonly allBookings = signal<Booking[]>([]);
  private readonly tabResults = signal<Record<BookingTab, Booking[]>>({ upcoming: [], past: [], cancelled: [] });
  readonly tabLoaded = signal<Record<BookingTab, boolean>>({ upcoming: false, past: false, cancelled: false });
  readonly tabBusy = signal<Record<BookingTab, boolean>>({ upcoming: false, past: false, cancelled: false });
  readonly filtered = computed(() => this.tabResults()[this.tab()]);
  readonly showTopProgress = computed(() => this.tabBusy()[this.tab()] && this.tabLoaded()[this.tab()]);
  readonly groups = computed<BookingGroup[]>(() => {
    const rows = this.filtered();
    const grouped = new Map<string, Booking[]>();
    for (const booking of rows) {
      const key = this.bookingDateKey(booking);
      const list = grouped.get(key) ?? [];
      list.push(booking);
      grouped.set(key, list);
    }
    const direction = this.tab() === "upcoming" ? 1 : -1;
    return [...grouped.entries()]
      .sort((a, b) => direction * a[0].localeCompare(b[0]))
      .map(([key, items]) => {
        const sorted = [...items].sort((a, b) => direction * (this.bookingTimeValue(a) - this.bookingTimeValue(b)));
        return { key, label: this.groupLabel(key), countLabel: this.appointmentCountLabel(sorted.length), items: sorted };
      });
  });
  readonly emptyTitle = computed(() => {
    switch (this.tab()) {
      case "past": return "No past bookings yet";
      case "cancelled": return "No cancelled bookings";
      default: return "No upcoming bookings";
    }
  });
  readonly emptyActionLabel = computed(() => this.tab() === "upcoming" ? "Find a place" : "Book a visit");
  private midnightRefreshId: ReturnType<typeof setTimeout> | null = null;

  constructor(readonly marketplace: MarketplaceService, private readonly router: Router, private readonly toasts: ToastController) {
    addIcons({ cardOutline, checkmarkCircleOutline, chevronForwardOutline, helpCircleOutline, locationOutline, repeatOutline, timeOutline });
  }

  ngOnInit() {
    this.tab.set(this.readSavedTab());
    this.ensureTab("upcoming");
    this.ensureTab("past");
    this.ensureTab("cancelled");
    this.scheduleMidnightRefresh();
  }

  ionViewWillEnter() {
    this.tab.set(this.readSavedTab());
    this.ensureTab(this.tab());
    window.setTimeout(() => this.restoreScrollPosition(), 80);
  }

  ngOnDestroy() {
    if (this.midnightRefreshId) clearTimeout(this.midnightRefreshId);
  }

  setTab(tab: BookingTab) {
    if (this.tab() === tab) return;
    this.tab.set(tab);
    this.saveTab(tab);
    this.ensureTab(tab);
  }

  async openBooking(booking: Booking) {
    await this.saveScrollPosition();
    void this.router.navigateByUrl(this.bookingDetailUrl(booking.id));
  }

  handleBookingKeydown(event: KeyboardEvent, booking: Booking) {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    this.openBooking(booking);
  }

  backHref(): string {
    return this.marketplace.salonMode() ? this.marketplace.salonModeUrl() : "/tabs/profile";
  }

  discoverLink(): string {
    return this.marketplace.salonMode() ? this.marketplace.salonModeUrl() : "/tabs/search";
  }

  supportLink(): string {
    return this.marketplace.salonMode() ? this.marketplace.salonModeUrl("support") : "/tabs/support";
  }

  private bookingDetailUrl(id: string): string {
    return this.marketplace.salonMode() ? this.marketplace.salonModeUrl("bookings", id) : `/bookings/${encodeURIComponent(id)}`;
  }

  private businessBookUrl(slugOrId: string): string {
    return this.marketplace.salonMode() ? this.marketplace.salonModeUrl("business", slugOrId, "book") : `/business/${encodeURIComponent(slugOrId)}/book`;
  }

  reload() {
    if (!this.marketplace.isAuthenticated()) {
      void this.router.navigateByUrl("/login");
      return;
    }
    this.ensureTab(this.tab(), true);
  }

  private ensureTab(tab: BookingTab, force = false) {
    if (this.tabBusy()[tab]) return;
    void this.loadTab(tab, force);
  }

  private async loadTab(tab: BookingTab, force = false) {
    if (this.tabBusy()[tab]) return;
    this.tabBusy.update((state) => ({ ...state, [tab]: true }));
    try {
      const rows = await this.marketplace.loadBookings(tab, force);
      this.mergeBookings(rows);
      this.reclassifyBookings();
      this.tabLoaded.update((state) => ({ ...state, [tab]: true }));
    } catch {
      // The failure is surfaced through marketplace.error(); cached content, if any, stays visible.
    } finally {
      this.tabBusy.update((state) => ({ ...state, [tab]: false }));
    }
  }

  private readSavedTab(): BookingTab {
    try {
      const value = sessionStorage.getItem(BookingsPage.TAB_STORAGE_KEY);
      return value === "past" || value === "cancelled" || value === "upcoming" ? value : "upcoming";
    } catch {
      return "upcoming";
    }
  }

  private saveTab(tab: BookingTab) {
    try {
      sessionStorage.setItem(BookingsPage.TAB_STORAGE_KEY, tab);
    } catch {
      // Optional navigation state only.
    }
  }

  private async saveScrollPosition() {
    try {
      const element = await this.bookingsContent?.getScrollElement();
      sessionStorage.setItem(BookingsPage.SCROLL_STORAGE_KEY, String(element?.scrollTop || 0));
    } catch {
      // Optional navigation state only.
    }
  }

  private restoreScrollPosition() {
    try {
      const value = Number(sessionStorage.getItem(BookingsPage.SCROLL_STORAGE_KEY) || 0);
      if (!Number.isFinite(value) || value <= 0) return;
      void this.bookingsContent?.scrollToPoint(0, value, 0);
    } catch {
      // Optional navigation state only.
    }
  }

  async onPullRefresh(event: Event) {
    const refresher = event.target as unknown as { complete(): Promise<void> };
    try {
      const rows = await this.marketplace.loadBookings(this.tab(), true);
      this.mergeBookings(rows);
      this.reclassifyBookings();
      this.tabLoaded.update((state) => ({ ...state, [this.tab()]: true }));
    } catch {
      // handled through marketplace.error()
    } finally {
      await refresher.complete();
    }
  }

  dateParts(booking: Booking) {
    const label = booking.displayStartAt || booking.startsAt || booking.startAt || "";
    if (label.toLowerCase().includes("today")) return { month: "Today", day: "Now" };
    const match = label.match(/(\d{1,2})\s+([A-Za-z]{3})/);
    return { month: match?.[2] ?? "Soon", day: match?.[1] ?? "Next" };
  }

  bookingTimeLabel(booking: Booking): string {
    const raw = booking.startsAt || booking.startAt || "";
    const date = this.parseBookingTime(raw);
    if (date && Number.isFinite(date.getTime())) {
      return new Intl.DateTimeFormat("en-IN", {
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
        timeZone: "Asia/Kolkata"
      }).format(date).toUpperCase();
    }
    return booking.displayStartAt?.match(/\d{1,2}:\d{2}\s*[AP]M/i)?.[0].toUpperCase() || "Time to be confirmed";
  }

  bookingDateTimeLabel(booking: Booking): string {
    const raw = booking.startsAt || booking.startAt || "";
    const date = this.parseBookingTime(raw);
    if (date && Number.isFinite(date.getTime())) {
      try {
        const day = new Intl.DateTimeFormat("en-IN", { weekday: "short", day: "numeric", month: "short", timeZone: "Asia/Kolkata" }).format(date);
        const time = new Intl.DateTimeFormat("en-IN", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: "Asia/Kolkata" }).format(date).toUpperCase();
        return `${day} · ${time}`;
      } catch {
        return this.bookingTimeLabel(booking);
      }
    }
    const label = String(booking.displayStartAt || "");
    const timeMatch = label.match(/\d{1,2}:\d{2}\s*[AP]M/i)?.[0].toUpperCase();
    if (label.toLowerCase().includes("today")) return timeMatch ? `Today · ${timeMatch}` : "Today";
    return [label, timeMatch].filter(Boolean).join(" · ") || "Time to be confirmed";
  }

  serviceCount(booking: Booking): number {
    const reference = booking.reference;
    if (!reference) return 1;
    const count = this.filtered().filter((row) => row.reference === reference).length;
    return count > 1 ? count : 1;
  }

  bookingTitle(booking: Booking): string {
    const count = this.serviceCount(booking);
    return count > 1 ? `${count} services` : booking.serviceName;
  }

  compactProfessionalLine(booking: Booking): string {
    const parts = [booking.staffName, this.durationLabel(booking)].filter(Boolean);
    return parts.join(" · ");
  }

  private durationLabel(booking: Booking): string {
    const minutes = Number(booking.durationMinutes || booking.serviceDurationMinutes || 0);
    if (!Number.isFinite(minutes) || minutes <= 0) return "";
    return `${minutes} min`;
  }

  statusLabel(status: EffectiveBookingStatus): string {
    switch (status) {
      case "pending": return "Pending";
      case "confirmed": return "Confirmed";
      case "completed": return "Completed";
      case "cancelled": return "Cancelled";
      case "no_show": return "No-show";
      default: return String(status || "").charAt(0).toUpperCase() + String(status || "").slice(1);
    }
  }

  cardLabel(booking: Booking): string {
    return `View details — ${booking.serviceName} at ${booking.businessName}, ${this.bookingDateTimeLabel(booking)}, status ${this.statusLabel(this.effectiveStatus(booking))}`;
  }

  paymentMetaLabel(booking: Booking): { label: string; tone: PaymentTone } | null {
    const value = String(booking.paymentStatus || "").trim().toLowerCase().replace(/[\s-]+/g, "_");
    if (["paid", "payment_received", "success", "captured"].includes(value)) return { label: "Paid", tone: "paid" };
    if (["refunded", "refund_completed", "refund_issued"].includes(value)) return { label: "Refunded", tone: "refunded" };
    if (["pending", "unpaid", "due", "awaiting_payment"].includes(value)) return { label: "Payment pending", tone: "pending" };
    if (booking.status === "cancelled" && (!value || value === "not_required" || value === "no_payment_required")) {
      return { label: "No payment required", tone: "default" };
    }
    return null;
  }

  showCheckIn(booking: Booking): boolean {
    return this.checkInState(booking).kind === "available";
  }

  checkInState(booking: Booking): CheckInState {
    const status = this.effectiveStatus(booking);
    if (status === "cancelled" || status === "completed" || status === "no_show") return { kind: "hidden" };
    if (this.isCheckedIn(booking)) return { kind: "checked_in" };
    const start = this.appointmentStartDate(booking)?.getTime() ?? null;
    if (!start) return { kind: "unavailable", reason: "Time unavailable" };
    const now = Date.now();
    const opensAt = start - 30 * 60 * 1000;
    const closesAt = start + 15 * 60 * 1000;
    if (now < opensAt) return { kind: "unavailable", reason: "Opens 30 min before" };
    if (now > closesAt || this.hasAppointmentEnded(booking)) return { kind: "hidden" };
    if (this.hasConflictingCheckedInBooking(booking)) return { kind: "unavailable", reason: "Another check-in active" };
    return { kind: "available" };
  }

  showRebook(booking: Booking): boolean {
    return this.effectiveStatus(booking) === "completed" || this.effectiveStatus(booking) === "no_show";
  }

  checkIn(event: Event, booking: Booking) {
    event.preventDefault();
    event.stopPropagation();
    void this.router.navigateByUrl(this.bookingDetailUrl(booking.id));
  }

  closeCancelDialog(): void {
    this.cancelDialog.set(null);
  }

  async confirmCancel(id: string) {
    this.cancelDialog.set(null);
    await this.marketplace.cancelBooking(id).catch(() => undefined);
    // Re-fetch so a cancelled booking drops out of the Upcoming list immediately.
    this.reload();
  }

  rebook(event: Event, booking: Booking) {
    event.preventDefault();
    event.stopPropagation();
    if (booking.businessId) {
      void this.router.navigate([this.businessBookUrl(booking.businessId)], {
        queryParams: {
          serviceId: booking.serviceId || undefined,
          staffId: booking.staffId || undefined,
          rebookFrom: booking.id,
          step: 3
        }
      });
      return;
    }
    void this.router.navigateByUrl(this.discoverLink());
  }

  private istDateKey(date: Date): string {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
    const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value || "";
    return `${get("year")}-${get("month")}-${get("day")}`;
  }

  private istTodayKey(): string {
    return this.istDateKey(new Date());
  }

  private tomorrowKey(): string {
    const [year, month, day] = this.istTodayKey().split("-").map(Number);
    return this.istDateKey(new Date(Date.UTC(year, month - 1, day + 1)));
  }

  private bookingDateKey(booking: Booking): string {
    const date = this.appointmentStartDate(booking);
    if (date && Number.isFinite(date.getTime())) return this.istDateKey(date);
    return String(booking.displayStartAt || "").toLowerCase().includes("today") ? this.istTodayKey() : "9999-12-31";
  }

  private bookingTimeValue(booking: Booking): number {
    const date = this.appointmentStartDate(booking);
    return date && Number.isFinite(date.getTime()) ? date.getTime() : Number.MAX_SAFE_INTEGER;
  }

  private groupLabel(key: string): string {
    if (key === this.istTodayKey()) return `Today · ${this.formatDateGroupKey(key)}`;
    if (key === this.tomorrowKey()) return "Tomorrow";
    return this.formatDateGroupKey(key);
  }

  private formatDateGroupKey(key: string): string {
    const [year, month, day] = key.split("-").map(Number);
    const date = new Date(Date.UTC(year, month - 1, day));
    try {
      return new Intl.DateTimeFormat("en-IN", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }).format(date);
    } catch {
      return key;
    }
  }

  private appointmentCountLabel(count: number): string {
    return `${count} ${count === 1 ? "appointment" : "appointments"}`;
  }

  private isTodayBooking(booking: Booking): boolean {
    const date = this.appointmentStartDate(booking);
    if (date && Number.isFinite(date.getTime())) return this.istDateKey(date) === this.istTodayKey();
    return String(booking.displayStartAt || "").toLowerCase().includes("today");
  }

  effectiveStatus(booking: Booking): EffectiveBookingStatus {
    const rawStatus = String(booking.status || "") as EffectiveBookingStatus;
    if (rawStatus === "cancelled" || rawStatus === "completed" || rawStatus === "no_show") return rawStatus;
    if (!this.hasAppointmentEnded(booking)) return booking.status;
    return rawStatus === "pending" ? "no_show" : "completed";
  }

  private mergeBookings(rows: Booking[]) {
    const byId = new Map<string, Booking>();
    for (const booking of this.allBookings()) byId.set(booking.id, booking);
    for (const booking of rows) byId.set(booking.id, booking);
    this.allBookings.set([...byId.values()]);
  }

  private reclassifyBookings() {
    const next: Record<BookingTab, Booking[]> = { upcoming: [], past: [], cancelled: [] };
    for (const booking of this.allBookings()) {
      const bucket = this.bookingBucket(booking);
      next[bucket].push(booking);
    }
    next.upcoming.sort((a, b) => this.bookingTimeValue(a) - this.bookingTimeValue(b));
    next.past.sort((a, b) => this.bookingTimeValue(b) - this.bookingTimeValue(a));
    next.cancelled.sort((a, b) => this.bookingTimeValue(b) - this.bookingTimeValue(a));
    this.tabResults.set(next);
  }

  private bookingBucket(booking: Booking): BookingTab {
    if (String(booking.status) === "cancelled") return "cancelled";
    return this.hasAppointmentEnded(booking) ? "past" : "upcoming";
  }

  private hasAppointmentEnded(booking: Booking): boolean {
    const end = this.appointmentEndTime(booking);
    return end !== null && end <= Date.now();
  }

  private isCheckedIn(booking: Booking): boolean {
    const row = booking as Booking & { checkedInAt?: string; checkInAt?: string; attendanceStatus?: string; checkInStatus?: string };
    const status = String(row.attendanceStatus || row.checkInStatus || "").toLowerCase().replace(/[\s-]+/g, "_");
    return Boolean(row.checkedInAt || row.checkInAt || status === "checked_in" || status === "arrived");
  }

  private hasConflictingCheckedInBooking(booking: Booking): boolean {
    const start = this.appointmentStartDate(booking)?.getTime() ?? null;
    const end = this.appointmentEndTime(booking);
    if (start === null || end === null) return false;
    return this.allBookings().some((candidate) => {
      if (candidate.id === booking.id || !this.isCheckedIn(candidate)) return false;
      if (this.effectiveStatus(candidate) === "cancelled") return false;
      const candidateStart = this.appointmentStartDate(candidate)?.getTime() ?? null;
      const candidateEnd = this.appointmentEndTime(candidate);
      return candidateStart !== null && candidateEnd !== null && candidateStart < end && candidateEnd > start;
    });
  }

  private appointmentEndTime(booking: Booking): number | null {
    const explicitEnd = this.parseBookingTime(booking.endsAt || booking.endAt || "");
    if (explicitEnd) return explicitEnd.getTime();
    const start = this.appointmentStartDate(booking);
    if (!start) return null;
    const duration = Number(booking.durationMinutes || booking.serviceDurationMinutes || 60);
    return start.getTime() + Math.max(1, Number.isFinite(duration) ? duration : 60) * 60 * 1000;
  }

  private parseBookingTime(value: string): Date | null {
    const raw = String(value || "").trim();
    if (!raw) return null;
    const normalized = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}/.test(raw) && !/(?:Z|[+-]\d{2}:?\d{2})$/i.test(raw)
      ? `${raw.replace(" ", "T")}+05:30`
      : raw;
    const date = new Date(normalized);
    return Number.isFinite(date.getTime()) ? date : null;
  }

  private appointmentStartDate(booking: Booking): Date | null {
    return this.parseBookingTime(booking.startsAt || booking.startAt || "") || this.parseDisplayStartAt(booking.displayStartAt || "");
  }

  private parseDisplayStartAt(value: string): Date | null {
    const raw = String(value || "").trim();
    if (!raw) return null;
    const lower = raw.toLowerCase();
    const time = raw.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)/i);
    const hour12 = Number(time?.[1] || 9);
    const minute = Number(time?.[2] || 0);
    const period = String(time?.[3] || "AM").toUpperCase();
    const hour = period === "PM" && hour12 < 12 ? hour12 + 12 : period === "AM" && hour12 === 12 ? 0 : hour12;
    const today = new Date();
    const todayParts = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(today);
    const part = (type: Intl.DateTimeFormatPartTypes) => Number(todayParts.find((item) => item.type === type)?.value || 0);
    if (lower.includes("today")) return new Date(`${part("year")}-${String(part("month")).padStart(2, "0")}-${String(part("day")).padStart(2, "0")}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00+05:30`);
    const monthMap: Record<string, number> = { jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5, jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9, oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12 };
    const match = raw.match(/(\d{1,2})\s+([A-Za-z]{3,9})(?:\s+(\d{4}))?/);
    if (!match) return null;
    const day = Number(match[1]);
    const month = monthMap[match[2].toLowerCase()];
    const year = Number(match[3] || part("year"));
    if (!month || !day) return null;
    return new Date(`${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00+05:30`);
  }

  private scheduleMidnightRefresh() {
    if (this.midnightRefreshId) clearTimeout(this.midnightRefreshId);
    const now = new Date();
    const nextMidnight = new Date(now);
    nextMidnight.setHours(24, 0, 5, 0);
    this.midnightRefreshId = setTimeout(() => {
      this.reload();
      this.scheduleMidnightRefresh();
    }, Math.max(1000, nextMidnight.getTime() - now.getTime()));
  }

  private async presentToast(message: string, color: "success" | "warning" | "danger" = "success") {
    const toast = await this.toasts.create({
      message,
      color,
      duration: 2600,
      position: "top"
    });
    await toast.present();
  }
}
