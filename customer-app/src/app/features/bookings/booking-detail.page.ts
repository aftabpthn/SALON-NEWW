import { Component, OnDestroy, OnInit, computed, signal } from "@angular/core";
import { ActivatedRoute, Router, RouterLink } from "@angular/router";
import { AlertController, IonBackButton, IonButton, IonButtons, IonContent, IonHeader, IonIcon, IonTitle, IonToolbar } from "@ionic/angular/standalone";
import { addIcons } from "ionicons";
import { calendarOutline, callOutline, cardOutline, chatbubbleEllipsesOutline, checkmarkCircleOutline, checkmarkOutline, chevronForwardOutline, closeCircleOutline, copyOutline, downloadOutline, helpCircleOutline, locationOutline, navigateOutline, repeatOutline, shareSocialOutline, storefrontOutline, timeOutline } from "ionicons/icons";
import { Business } from "../../core/api.types";
import { MarketplaceService } from "../../core/marketplace.service";

@Component({
  standalone: true,
  imports: [IonBackButton, IonButton, IonButtons, IonContent, IonHeader, IonIcon, IonTitle, IonToolbar, RouterLink],
  template: `
    <ion-header class="ion-no-border detail-header">
      <ion-toolbar>
        <ion-buttons slot="start"><ion-back-button [defaultHref]="backHref()"></ion-back-button></ion-buttons>
        <ion-title>Booking details</ion-title>
      </ion-toolbar>
    </ion-header>
    <ion-content>
      @if (booking(); as booking) {
        <main class="page-narrow detail-page">
          <section class="itinerary-card" aria-labelledby="booking-service">
            <button type="button" class="download-booking" aria-label="Download booking details" (click)="downloadInvoice($event)">
              <ion-icon name="download-outline" aria-hidden="true"></ion-icon>
            </button>
            <div class="summary-top">
              <span class="booking-status-pill" [class.closed]="booking.status === 'cancelled'">{{ booking.status }}</span>
              <h1 id="booking-service">{{ booking.serviceName }}</h1>
              <p>{{ booking.businessName }}</p>
            </div>

            <div class="appointment-time">
              <ion-icon name="time-outline" aria-hidden="true"></ion-icon>
              <span>Appointment time</span>
              <strong>{{ appointmentDisplay() }}</strong>
            </div>

            <dl class="booking-facts">
              <div class="venue-fact">
                <dt><ion-icon name="location-outline" aria-hidden="true"></ion-icon>Venue</dt>
                <dd>{{ booking.address }}</dd>
              </div>
              <div>
                <dt><ion-icon name="card-outline" aria-hidden="true"></ion-icon>Payment</dt>
                <dd>{{ paymentDisplay() }}</dd>
              </div>
              <div>
                <dt><ion-icon name="checkmark-circle-outline" aria-hidden="true"></ion-icon>Booking reference</dt>
                <dd class="reference-value">
                  <span>{{ bookingReference() }}</span>
                  <button
                    type="button"
                    class="copy-reference"
                    [attr.aria-label]="copyState() === 'copied' ? 'Reference copied' : 'Copy booking reference'"
                    (click)="copyReference()"
                  >
                    <ion-icon [name]="copyState() === 'copied' ? 'checkmark-outline' : 'copy-outline'" aria-hidden="true"></ion-icon>
                    {{ copyState() === "copied" ? "Copied" : "Copy" }}
                  </button>
                </dd>
              </div>
            </dl>
          </section>

          <span class="visually-hidden" aria-live="polite">{{ actionFeedback() }}</span>

          <section class="detail-actions" aria-label="Booking actions">
            @if (isActive()) {
              <div class="utility-actions">
                @if (directionsUrl(); as mapUrl) {
                  <a class="utility-action" [href]="mapUrl" target="_blank" rel="noopener noreferrer" aria-label="Open venue directions in a new tab">
                    <ion-icon name="navigate-outline" aria-hidden="true"></ion-icon>
                    <span>Directions</span>
                  </a>
                } @else {
                  <button type="button" class="utility-action" disabled>
                    <ion-icon name="navigate-outline" aria-hidden="true"></ion-icon>
                    <span>Directions</span>
                  </button>
                }
                <button type="button" class="utility-action" [disabled]="!canAddToCalendar()" (click)="addToCalendar()">
                  <ion-icon name="calendar-outline" aria-hidden="true"></ion-icon>
                  <span>Add to calendar</span>
                </button>
              </div>
            } @else {
              <ion-button expand="block" class="primary-gradient" (click)="rebook()">Book again</ion-button>
            }
            @if (!isActive()) {
              <ion-button expand="block" fill="outline" class="secondary-button" (click)="downloadInvoice($event)">
                <ion-icon name="download-outline" slot="start"></ion-icon>
                Download invoice
              </ion-button>
            }

            @if (moreActionCount() >= 3) {
              <details class="more-options">
                <summary>More booking options</summary>
                <div class="option-list">
                  @if (isActive()) {
                    <button type="button" class="option-row" (click)="reschedule()">
                      <ion-icon name="calendar-outline" aria-hidden="true"></ion-icon>
                      <span>Edit appointment</span>
                      <ion-icon class="row-chevron" name="chevron-forward-outline" aria-hidden="true"></ion-icon>
                    </button>
                  }
                  <details class="contact-options">
                    <summary class="option-row">
                      <ion-icon name="chatbubble-ellipses-outline" aria-hidden="true"></ion-icon>
                      <span>Contact salon</span>
                      <ion-icon class="row-chevron" name="chevron-forward-outline" aria-hidden="true"></ion-icon>
                    </summary>
                    <div class="contact-suboptions">
                      <a class="option-row" [routerLink]="bookingChatLink(booking.id)">
                        <ion-icon name="chatbubble-ellipses-outline" aria-hidden="true"></ion-icon>
                        <span>Message salon</span>
                        <ion-icon class="row-chevron" name="chevron-forward-outline" aria-hidden="true"></ion-icon>
                      </a>
                      @if (salonPhone(); as phone) {
                        <a class="option-row" [href]="phone.href">
                          <ion-icon name="call-outline" aria-hidden="true"></ion-icon>
                          <span>Call salon</span>
                          <ion-icon class="row-chevron" name="chevron-forward-outline" aria-hidden="true"></ion-icon>
                        </a>
                      }
                    </div>
                  </details>
                  @if (salonRoute(); as salonLink) {
                    <a class="option-row" [routerLink]="salonLink">
                      <ion-icon name="storefront-outline" aria-hidden="true"></ion-icon>
                      <span>View salon</span>
                      <ion-icon class="row-chevron" name="chevron-forward-outline" aria-hidden="true"></ion-icon>
                    </a>
                  }
                  @if (isActive()) {
                    <button type="button" class="option-row" (click)="rebook()">
                      <ion-icon name="repeat-outline" aria-hidden="true"></ion-icon>
                      <span>Book another appointment</span>
                      <ion-icon class="row-chevron" name="chevron-forward-outline" aria-hidden="true"></ion-icon>
                    </button>
                  }
                  <button type="button" class="option-row" (click)="requestSupport()">
                    <ion-icon name="help-circle-outline" aria-hidden="true"></ion-icon>
                    <span>Request support</span>
                    <ion-icon class="row-chevron" name="chevron-forward-outline" aria-hidden="true"></ion-icon>
                  </button>
                  <button type="button" class="option-row" (click)="shareBooking()">
                    <ion-icon name="share-social-outline" aria-hidden="true"></ion-icon>
                    <span>Share booking</span>
                  </button>
                  @if (isActive()) {
                    <button type="button" class="option-row" (click)="downloadInvoice($event)">
                      <ion-icon name="download-outline" aria-hidden="true"></ion-icon>
                      <span>Download invoice</span>
                    </button>
                  }
                  @if (isActive()) {
                    <div class="option-divider" aria-hidden="true"></div>
                    <button type="button" class="option-row destructive-action" (click)="cancel()">
                      <ion-icon name="close-circle-outline" aria-hidden="true"></ion-icon>
                      <span>Cancel booking</span>
                    </button>
                  }
                </div>
              </details>
            } @else {
              <section class="direct-options" aria-label="More booking options">
                <button type="button" class="option-row" (click)="shareBooking()">
                  <ion-icon name="share-social-outline" aria-hidden="true"></ion-icon>
                  <span>Share booking</span>
                </button>
                <button type="button" class="option-row" (click)="requestSupport()">
                  <ion-icon name="help-circle-outline" aria-hidden="true"></ion-icon>
                  <span>Request support</span>
                  <ion-icon class="row-chevron" name="chevron-forward-outline" aria-hidden="true"></ion-icon>
                </button>
              </section>
            }
          </section>

          <details class="policy-strip">
            <summary>
              <span>Cancellation &amp; rescheduling policy</span>
              <small>Review the policy for booking changes</small>
            </summary>
            <p>{{ booking.cancellationPolicy || "The business policy will appear here when returned by the API." }}</p>
          </details>
          <div class="help-centre">
            <a class="help-link" [routerLink]="helpLink()">Help centre</a>
            <small>General FAQs and account help</small>
          </div>
        </main>
      } @else {
        <main class="page-narrow detail-page" aria-live="polite">
          @if (marketplace.loading()) {
            <section class="state-panel"><h1>Loading booking</h1></section>
          } @else {
            <section class="state-panel"><h1>Booking unavailable</h1><p>{{ marketplace.error() || "This booking could not be loaded." }}</p><ion-button class="primary-gradient" (click)="reload()">Retry</ion-button></section>
          }
        </main>
      }
    </ion-content>
  `,
  styles: [`
    .detail-header ion-toolbar { --min-height: 52px; }
    .detail-header ion-title { font-size: 1rem; font-weight: 850; letter-spacing: -0.015em; }
    .detail-page { display: grid; gap: 12px; max-width: 680px; }
    .itinerary-card {
      position: relative;
      min-width: 0;
      overflow: hidden;
      border: 1px solid rgba(11, 47, 85, 0.24);
      border-radius: var(--radius-md);
      color: #FFFFFF;
      background: var(--brand-900);
      box-shadow: 0 14px 34px rgba(16, 24, 40, 0.15);
    }
    .download-booking {
      position: absolute;
      top: 12px;
      right: 12px;
      z-index: 2;
      width: 38px;
      height: 38px;
      display: grid;
      place-items: center;
      border: 1px solid rgba(255, 255, 255, 0.22);
      border-radius: 13px;
      color: #FFFFFF;
      background: rgba(255, 255, 255, 0.08);
      backdrop-filter: blur(10px);
      font-size: 1.08rem;
      cursor: pointer;
    }
    .download-booking:active { transform: scale(0.97); }
    .summary-top { padding: 16px 16px 12px; }
    .booking-status-pill {
      position: relative;
      top: -16px;
      display: inline-flex;
      align-items: center;
      gap: 3px;
      width: fit-content;
      min-height: 20px;
      padding: 4px 6px;
      color: #059669;
      border-color: rgba(52, 211, 153, 0.38);
      background: #D1FAE5;
      border-radius: 999px;
      font-size: 0.58rem;
      font-weight: 900;
      line-height: 1;
      text-transform: capitalize;
      box-shadow: none;
    }
    .booking-status-pill.closed { color: var(--muted); background: var(--surface-soft); }
    .summary-top h1 {
      margin: 10px 0 3px;
      color: #FFFFFF;
      font-size: clamp(1.35rem, 6.2vw, 1.8rem);
      font-weight: 900;
      letter-spacing: -0.04em;
      line-height: 1.08;
      overflow-wrap: anywhere;
    }
    .summary-top p { margin: 0; color: rgba(255, 255, 255, 0.76); font-size: 0.9rem; font-weight: 600; overflow-wrap: anywhere; }
    .appointment-time {
      display: grid;
      grid-template-columns: 22px minmax(0, 1fr);
      gap: 1px 10px;
      padding: 13px 16px;
      border-block: 1px solid rgba(255, 255, 255, 0.11);
      background: rgba(255, 255, 255, 0.045);
    }
    .appointment-time ion-icon { grid-row: 1 / span 2; align-self: center; color: #FFFFFF; font-size: 1.2rem; }
    .appointment-time span { color: rgba(255, 255, 255, 0.82); font-size: 0.72rem; font-weight: 700; letter-spacing: 0.035em; }
    .appointment-time strong { color: #FFFFFF; font-size: clamp(1rem, 4.5vw, 1.2rem); line-height: 1.3; overflow-wrap: anywhere; }
    .booking-facts { display: grid; margin: 0; background: rgba(99, 102, 241, 0.34); }
    .booking-facts div { min-width: 0; padding: 11px 16px; border-bottom: 1px solid rgba(255, 255, 255, 0.1); }
    .booking-facts div:last-child { border-bottom: 0; }
    .booking-facts dt { display: flex; align-items: center; gap: 7px; margin: 0 0 3px; color: rgba(255, 255, 255, 0.8); font-size: 0.72rem; font-weight: 700; }
    .booking-facts dt ion-icon { flex: 0 0 auto; font-size: 0.95rem; }
    .booking-facts dd { margin: 0; color: #FFFFFF; font-size: 0.88rem; font-weight: 700; line-height: 1.35; overflow-wrap: anywhere; word-break: break-word; }
    .reference-value { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
    .reference-value > span { min-width: 0; color: #FFFFFF; font-family: ui-monospace, "SFMono-Regular", Consolas, monospace; overflow-wrap: anywhere; }
    .copy-reference {
      display: inline-flex;
      flex: 0 0 auto;
      align-items: center;
      justify-content: center;
      gap: 5px;
      min-height: 44px;
      padding: 8px 6px;
      border: 0;
      border-radius: 8px;
      color: #FFFFFF;
      background: transparent;
      font-size: 0.78rem;
      font-weight: 800;
      text-transform: none;
      cursor: pointer;
    }
    .copy-reference:hover { background: rgba(255, 255, 255, 0.09); }
    .detail-actions {
      display: grid;
      gap: 8px;
    }
    .detail-actions ion-button {
      min-height: 44px;
      margin: 0;
      text-transform: none;
    }
    .utility-actions { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
    .utility-action {
      display: inline-flex;
      min-width: 0;
      min-height: 44px;
      align-items: center;
      justify-content: center;
      gap: 6px;
      padding: 8px 9px;
      border: 1px solid var(--border-strong);
      border-radius: 999px;
      color: var(--primary);
      background: var(--surface);
      font-family: inherit;
      font-size: 0.82rem;
      font-weight: 850;
      line-height: 1.15;
      text-align: center;
      text-decoration: none;
      text-transform: none;
      cursor: pointer;
      transition: color var(--motion-fast), border-color var(--motion-fast), background var(--motion-fast);
    }
    .utility-action ion-icon { flex: 0 0 auto; font-size: 1rem; }
    .utility-action span { min-width: 0; color: inherit; overflow-wrap: anywhere; }
    .utility-action:hover { border-color: var(--primary); background: var(--primary-soft); }
    .utility-action:disabled { color: var(--muted); border-color: var(--border); background: var(--surface-soft); cursor: not-allowed; opacity: 0.72; }
    .destructive-action { --color: #B42318; color: #B42318; font-weight: 800; }
    .more-options, .direct-options { border-top: 1px solid var(--border); }
    .more-options > summary {
      display: grid;
      grid-template-columns: 14px auto;
      align-items: center;
      justify-content: center;
      gap: 7px;
      min-height: 44px;
      padding: 10px 4px;
      color: var(--muted);
      list-style: none;
      font-size: 0.82rem;
      font-weight: 800;
      line-height: 24px;
      cursor: pointer;
    }
    .more-options > summary::-webkit-details-marker { display: none; }
    .more-options > summary::before {
      content: "›";
      color: var(--primary);
      font-size: 1.05rem;
      font-weight: 900;
      line-height: 1;
      transform: rotate(0deg);
      transition: transform var(--motion-fast);
    }
    .more-options[open] > summary::before { transform: rotate(90deg); }
    .option-list, .direct-options, .contact-suboptions { display: grid; }
    .option-list { padding-bottom: 4px; }
    .contact-options { min-width: 0; }
    .contact-options > summary { list-style: none; }
    .contact-options > summary::-webkit-details-marker { display: none; }
    .contact-options > summary > span { overflow-wrap: normal; white-space: nowrap; }
    .contact-options > summary .row-chevron { transition: transform var(--motion-fast); }
    .contact-options[open] > summary .row-chevron { transform: rotate(90deg); }
    .contact-suboptions { margin: 0 8px 4px 28px; padding-left: 6px; border-left: 2px solid var(--primary-soft); }
    .contact-suboptions .option-row { font-size: 0.82rem; }
    .option-row {
      width: 100%;
      min-width: 0;
      min-height: 44px;
      display: grid;
      grid-template-columns: 20px minmax(0, 1fr) auto;
      align-items: center;
      gap: 10px;
      padding: 10px 8px;
      border: 0;
      border-radius: 8px;
      color: var(--text);
      background: transparent;
      font-family: inherit;
      font-size: 0.86rem;
      font-weight: 800;
      line-height: 1.25;
      text-align: left;
      text-decoration: none;
      text-transform: none;
      cursor: pointer;
    }
    .option-row:hover { background: var(--primary-soft); }
    .option-row:active { background: rgba(99, 102, 241, 0.12); transform: scale(0.99); }
    .option-row:focus-visible { outline: 3px solid var(--focus); outline-offset: 2px; }
    .option-row > ion-icon:first-child { color: var(--primary); font-size: 1.05rem; }
    .option-row > span { min-width: 0; color: inherit; overflow-wrap: anywhere; }
    .option-row .row-chevron { color: var(--muted); font-size: 0.95rem; }
    .option-row.destructive-action > ion-icon:first-child { color: #B42318; }
    .option-divider { height: 1px; margin: 4px 8px; background: var(--border); }
    .more-options > summary:focus-visible, .policy-strip summary:focus-visible { outline: 3px solid var(--focus); outline-offset: 3px; border-radius: 4px; }
    .policy-strip {
      margin-top: -4px;
      border-block: 1px solid var(--border);
      color: var(--text);
      background: rgba(255, 255, 255, 0.58);
    }
    .policy-strip summary {
      display: grid;
      grid-template-columns: 14px minmax(0, 1fr);
      align-items: center;
      column-gap: 7px;
      min-height: 44px;
      padding: 12px 4px;
      color: var(--text);
      list-style: none;
      cursor: pointer;
    }
    .policy-strip summary::-webkit-details-marker { display: none; }
    .policy-strip summary::before {
      grid-column: 1;
      grid-row: 1 / span 2;
      content: "›";
      color: var(--primary);
      font-size: 1.05rem;
      font-weight: 900;
      line-height: 1;
      transform: rotate(0deg);
      transition: transform var(--motion-fast);
    }
    .policy-strip[open] summary::before { transform: rotate(90deg); }
    .policy-strip summary span { grid-column: 2; display: block; color: var(--text); font-size: 0.88rem; font-weight: 850; }
    .policy-strip summary small { grid-column: 2; display: block; margin-top: 2px; color: #425A70; font-size: 0.75rem; font-weight: 650; }
    .policy-strip p { margin: 0; padding: 0 4px 13px; color: var(--muted); font-size: 0.84rem; line-height: 1.45; overflow-wrap: anywhere; }
    .help-centre { display: grid; gap: 0; width: fit-content; }
    .help-link { width: fit-content; min-height: 44px; display: inline-flex; align-items: center; color: var(--primary); font-size: 0.85rem; font-weight: 800; text-decoration: none; }
    .help-link:hover { text-decoration: underline; text-underline-offset: 3px; }
    .help-link:focus-visible { outline: 3px solid var(--focus); outline-offset: 2px; border-radius: 4px; }
    .help-centre small { color: #425A70; font-size: 0.72rem; font-weight: 600; }
    .visually-hidden { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0; }
    .state-panel { padding: 18px; border: 1px solid var(--border); border-radius: var(--radius-md); background: var(--surface); box-shadow: var(--shadow-soft); }
    .state-panel h1 { margin: 0; font-size: 1.25rem; letter-spacing: -0.03em; }
    .state-panel p { margin: 8px 0 14px; color: var(--muted); line-height: 1.5; overflow-wrap: anywhere; }

    @media (min-width: 480px) {
      .booking-facts { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .booking-facts .venue-fact { grid-column: 1 / -1; }
      .booking-facts div:nth-child(2) { border-right: 1px solid rgba(255, 255, 255, 0.1); border-bottom: 0; }
      .booking-facts div:last-child { border-bottom: 0; }
    }

    @media (min-width: 900px) {
      .summary-top { padding: 20px 22px 15px; }
      .appointment-time { padding: 15px 22px; }
      .booking-facts div { padding: 12px 22px; }
    }

    @media (prefers-reduced-motion: reduce) {
      .detail-page, .itinerary-card, .booking-status-pill, .detail-actions ion-button, .utility-action, .option-row, .contact-options > summary .row-chevron, .more-options > summary::before, .policy-strip summary::before { animation: none; transition: none; }
      .option-row:active { transform: none; }
    }
  `]
})
export class BookingDetailPage implements OnInit, OnDestroy {
  private readonly id = signal(this.route.snapshot.paramMap.get("id"));
  private copyResetTimer: ReturnType<typeof setTimeout> | undefined;
  readonly booking = computed(() => this.marketplace.findBooking(this.id()));
  readonly resolvedBusiness = computed<Business | null>(() => {
    const booking = this.booking();
    if (!booking) return null;
    const selected = this.marketplace.selectedBusiness();
    if (selected?.id === booking.businessId) return selected;
    const byId = booking.businessId ? this.marketplace.findBusiness(booking.businessId) : null;
    if (byId) return byId;
    if (selected && this.sameName(selected.businessName, booking.businessName)) return selected;
    return this.marketplace.businesses().find((business) => this.sameName(business.businessName, booking.businessName)) ?? null;
  });
  readonly bookingReference = computed(() => String(this.booking()?.reference || this.booking()?.id || ""));
  readonly appointmentDisplay = computed(() => this.formatAppointment(this.appointmentStart()));
  readonly paymentDisplay = computed(() => this.paymentLabel(this.booking()?.paymentStatus));
  readonly salonPhone = computed(() => this.resolveSalonPhone(this.resolvedBusiness()));
  readonly salonRoute = computed(() => {
    const slug = this.resolvedBusiness()?.slug;
    return slug ? this.businessProfileUrl(slug) : null;
  });
  readonly directionsUrl = computed(() => this.resolveDirectionsUrl());
  readonly canAddToCalendar = computed(() => this.calendarStart() !== null);
  readonly copyState = signal<"idle" | "copied" | "failed">("idle");
  readonly actionFeedback = signal("");
  readonly isActive = computed(() => {
    const booking = this.booking();
    return !!booking && (booking.status === "pending" || booking.status === "confirmed");
  });
  readonly moreActionCount = computed(() => (this.isActive() ? 7 : 3) + (this.salonRoute() ? 1 : 0));

  constructor(private readonly route: ActivatedRoute, private readonly router: Router, readonly marketplace: MarketplaceService, private readonly alerts: AlertController) {
    addIcons({ calendarOutline, callOutline, cardOutline, chatbubbleEllipsesOutline, checkmarkCircleOutline, checkmarkOutline, chevronForwardOutline, closeCircleOutline, copyOutline, downloadOutline, helpCircleOutline, locationOutline, navigateOutline, repeatOutline, shareSocialOutline, storefrontOutline, timeOutline });
  }

  ngOnInit() {
    this.reload();
  }

  ngOnDestroy() {
    if (this.copyResetTimer) clearTimeout(this.copyResetTimer);
  }

  backHref(): string {
    return this.marketplace.salonMode() ? this.marketplace.salonModeUrl("bookings") : "/tabs/bookings";
  }

  bookingChatLink(id: string): string {
    return this.marketplace.salonMode() ? this.marketplace.salonModeUrl("bookings", id, "chat") : `/bookings/${encodeURIComponent(id)}/chat`;
  }

  helpLink(): string {
    return this.marketplace.salonMode() ? this.marketplace.salonModeUrl("help") : "/help";
  }

  private businessProfileUrl(slug: string): string {
    return this.marketplace.salonMode() ? this.marketplace.salonModeUrl("business", slug) : `/business/${encodeURIComponent(slug)}`;
  }

  private businessBookUrl(slug: string): string {
    return this.marketplace.salonMode() ? this.marketplace.salonModeUrl("business", slug, "book") : `/business/${encodeURIComponent(slug)}/book`;
  }

  async reload() {
    const id = this.id();
    if (!id) return;
    try {
      const booking = await this.marketplace.loadBooking(id);
      if (booking.businessId) await this.marketplace.loadBusiness(booking.businessId).catch(() => undefined);
    } catch {
      return;
    }
  }

  async copyReference() {
    const reference = this.bookingReference();
    if (!reference) return;

    const copied = await this.copyText(reference);
    this.copyState.set(copied ? "copied" : "failed");
    this.setFeedback(copied ? "Booking reference copied" : "Booking reference could not be copied");
  }

  async shareBooking() {
    const booking = this.booking();
    if (!booking) return;
    const heading = [booking.serviceName, booking.businessName].filter(Boolean).join(" at ");
    const venue = this.resolvedBusiness()?.address?.trim() || booking.address?.trim();
    const lines = [heading, this.appointmentDisplay(), venue, this.directionsUrl()].filter(Boolean);
    const text = lines.join("\n");

    if (navigator.share) {
      try {
        await navigator.share({ title: "Booking details", text });
        this.setFeedback("Booking shared");
        return;
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") {
          this.setFeedback("Sharing cancelled");
          return;
        }
      }
    }

    const copied = await this.copyText(text);
    this.setFeedback(copied ? "Booking details copied to clipboard" : "Booking could not be shared");
  }

  rebook() {
    const booking = this.booking();
    if (!booking) return;
    const businessIdentity = this.resolvedBusiness()?.slug || booking.businessId;
    if (businessIdentity) {
      void this.router.navigate([this.businessBookUrl(businessIdentity)], {
        queryParams: {
          serviceId: booking.serviceId || undefined,
          staffId: booking.staffId || undefined,
          rebookFrom: booking.id,
          step: 3
        }
      });
      return;
    }
    void this.router.navigate([this.marketplace.salonMode() ? this.marketplace.salonModeUrl() : "/search"], { queryParams: { q: [booking.businessName, booking.serviceName].filter(Boolean).join(" ") } });
  }

  requestSupport() {
    const booking = this.booking();
    if (!booking) return;
    void this.router.navigate([this.marketplace.salonMode() ? this.marketplace.salonModeUrl("support") : "/tabs/support"], { queryParams: { mode: "booking", bookingId: booking.id } });
  }

  addToCalendar() {
    const booking = this.booking();
    const start = this.calendarStart();
    if (!booking || !start) return;

    const suppliedEnd = this.parseDate(booking.endAt || booking.endsAt);
    const suppliedDuration = booking.durationMinutes || booking.serviceDurationMinutes;
    const durationMinutes = typeof suppliedDuration === "number" && suppliedDuration > 0 ? suppliedDuration : 60;
    const end = suppliedEnd && suppliedEnd.getTime() > start.getTime()
      ? suppliedEnd
      : new Date(start.getTime() + durationMinutes * 60_000);
    const reference = this.bookingReference();
    const summary = [booking.serviceName, booking.businessName].filter(Boolean).join(" at ");
    const lines = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//Aura Salon//Booking//EN",
      "CALSCALE:GREGORIAN",
      "METHOD:PUBLISH",
      "BEGIN:VEVENT",
      `UID:${this.escapeIcs(reference)}@aura-salon`,
      `DTSTAMP:${this.formatIcsDate(new Date())}`,
      `DTSTART:${this.formatIcsDate(start)}`,
      `DTEND:${this.formatIcsDate(end)}`,
      `SUMMARY:${this.escapeIcs(summary)}`,
      `DESCRIPTION:${this.escapeIcs(`Booking reference: ${reference}`)}`
    ];
    if (booking.address?.trim()) lines.push(`LOCATION:${this.escapeIcs(booking.address.trim())}`);
    lines.push("END:VEVENT", "END:VCALENDAR");

    const url = URL.createObjectURL(new Blob([`${lines.join("\r\n")}\r\n`], { type: "text/calendar;charset=utf-8" }));
    const anchor = document.createElement("a");
    const safeReference = reference.replace(/[^a-z0-9_-]+/gi, "-").replace(/^-+|-+$/g, "") || "booking";
    anchor.href = url;
    anchor.download = `aura-booking-${safeReference}.ics`;
    anchor.hidden = true;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  private resolveSalonPhone(business: Business | null): { label: string; href: string } | null {
    if (!business) return null;
    const value = [business.appointmentNumber, business.mobileNumber, business.phone, business.telephoneNumber]
      .find((phone) => typeof phone === "string" && phone.trim())?.trim();
    if (!value) return null;
    const digits = value.replace(/\D/g, "");
    if (digits.length < 7 || digits.length > 15) return null;
    const dialValue = `${value.startsWith("+") ? "+" : ""}${digits}`;
    return { label: value, href: `tel:${dialValue}` };
  }

  private resolveDirectionsUrl(): string {
    const business = this.resolvedBusiness();
    const booking = this.booking();
    const mapsUrl = this.safeHttpUrl(business?.mapsUrl);
    if (mapsUrl) return mapsUrl;
    const businessCoordinates = this.coordinatesUrl(business?.latitude, business?.longitude);
    if (businessCoordinates) return businessCoordinates;
    const bookingCoordinates = this.coordinatesUrl(booking?.latitude, booking?.longitude);
    if (bookingCoordinates) return bookingCoordinates;
    const address = business?.address?.trim() || booking?.address?.trim();
    return address ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}` : "";
  }

  private coordinatesUrl(latitude?: number | null, longitude?: number | null): string {
    if (typeof latitude !== "number" || typeof longitude !== "number" || !Number.isFinite(latitude) || !Number.isFinite(longitude)) return "";
    return `https://www.google.com/maps/search/?api=1&query=${latitude},${longitude}`;
  }

  private safeHttpUrl(value?: string): string {
    if (!value) return "";
    try {
      const url = new URL(value);
      return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : "";
    } catch {
      return "";
    }
  }

  private sameName(first: string, second: string): boolean {
    return first.trim().toLocaleLowerCase() === second.trim().toLocaleLowerCase();
  }

  private async copyText(value: string): Promise<boolean> {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(value);
        return true;
      }
    } catch {
      // Use the local selection fallback below.
    }
    return this.copyWithFallback(value);
  }

  private setFeedback(message: string) {
    this.actionFeedback.set(message);
    if (this.copyResetTimer) clearTimeout(this.copyResetTimer);
    this.copyResetTimer = setTimeout(() => {
      this.copyState.set("idle");
      this.actionFeedback.set("");
    }, 2400);
  }

  private appointmentStart(): string {
    const booking = this.booking();
    return String(booking?.startsAt || booking?.startAt || booking?.displayStartAt || "");
  }

  private calendarStart(): Date | null {
    const booking = this.booking();
    return this.parseDate(booking?.startsAt || booking?.startAt) || this.parseDate(booking?.displayStartAt);
  }

  private formatAppointment(value: string): string {
    const date = this.parseDate(value);
    if (!date) return value;
    try {
      const day = new Intl.DateTimeFormat("en-IN", { weekday: "short", day: "numeric", month: "short", timeZone: "Asia/Kolkata" }).format(date);
      const time = new Intl.DateTimeFormat("en-IN", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: "Asia/Kolkata" }).format(date).toUpperCase();
      return `${day} · ${time}`;
    } catch {
      return value;
    }
  }

  private paymentLabel(value: unknown): string {
    const raw = String(value || "").trim();
    if (!raw) return "Pay at venue";
    const normalized = raw.toLowerCase().replace(/[\s-]+/g, "_").replace(/[^a-z0-9_]/g, "");
    if (["not_required", "no_payment_required"].includes(normalized)) return "No payment required";
    if (["pay_at_venue", "pay_on_arrival", "pay_at_salon", "payment_at_venue", "cash_at_venue"].includes(normalized)) return "Pay at venue";
    const readable = raw.replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim().toLowerCase();
    return readable ? readable.charAt(0).toUpperCase() + readable.slice(1) : raw;
  }

  private parseDate(value?: string): Date | null {
    if (!value) return null;
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? date : null;
  }

  private localDateKey(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  private formatIcsDate(date: Date): string {
    return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  }

  private escapeIcs(value: string): string {
    return value.replace(/\\/g, "\\\\").replace(/\r?\n/g, "\\n").replace(/,/g, "\\,").replace(/;/g, "\\;");
  }

  private copyWithFallback(value: string): boolean {
    const activeElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const textarea = document.createElement("textarea");
    textarea.value = value;
    textarea.readOnly = true;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    try {
      return document.execCommand("copy");
    } catch {
      return false;
    } finally {
      textarea.remove();
      activeElement?.focus();
    }
  }

  downloadInvoice(event: Event) {
    event.stopPropagation();
    const booking = this.booking();
    if (!booking) return;

    const record = booking as unknown as Record<string, unknown>;
    const payment = String(record["paymentStatus"] || record["paymentState"] || "not_required");
    const reference = String(booking.reference || booking.id);
    const appointment = String(booking.displayStartAt || booking.startsAt || booking.startAt || "Not available");
    const venue = String(booking.address || "Not available");
    const status = String(booking.status || "confirmed");
    const service = String(booking.serviceName || "Appointment");
    const salon = String(booking.businessName || "Salon");

    const escapePdf = (value: string) => value.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
    const commands: string[] = [];
    const rect = (x: number, y: number, width: number, height: number, color: string) =>
      commands.push("q " + color + " rg " + x + " " + y + " " + width + " " + height + " re f Q");
    const text = (x: number, y: number, size: number, value: string, color = "0.12 0.10 0.08", font = "F1") =>
      commands.push("BT " + color + " rg /" + font + " " + size + " Tf " + x + " " + y + " Td (" + escapePdf(value) + ") Tj ET");

    rect(0, 0, 612, 792, "0.98 0.97 0.94");
    rect(0, 650, 612, 142, "0.74 0.46 0.08");
    rect(0, 786, 612, 6, "1 0.86 0.40");
    rect(0, 650, 612, 4, "0.96 0.68 0.16");
    rect(402, 650, 5, 142, "0.88 0.58 0.10");
    text(48, 744, 26, "AURA SHINE", "1 1 1", "F2");
    text(48, 708, 13, "BOOKING INVOICE", "1 1 1");
    text(430, 744, 10, "INVOICE", "1 1 1", "F2");
    text(430, 726, 10, reference, "1 1 1");
    rect(430, 674, 122, 26, "0.956 0.835 0.553");
    text(445, 683, 9, status.toUpperCase(), "0.72 0.48 0.08", "F2");

    text(48, 612, 12, "Thank you for choosing Aura Shine", "0.42 0.28 0.08", "F2");
    text(48, 590, 10, "Your appointment details are below.", "0.40 0.36 0.30");

    rect(40, 430, 532, 124, "1 1 1");
    text(58, 526, 10, "APPOINTMENT SUMMARY", "0.72 0.48 0.08", "F2");
    text(58, 494, 11, service, "0.12 0.10 0.08", "F2");
    text(58, 472, 10, salon, "0.35 0.30 0.24");
    text(340, 494, 9, "REFERENCE", "0.48 0.43 0.35", "F2");
    text(340, 474, 10, reference, "0.12 0.10 0.08");

    rect(40, 244, 532, 148, "1 1 1");
    text(58, 364, 10, "APPOINTMENT DETAILS", "0.72 0.48 0.08", "F2");
    text(58, 334, 9, "DATE & TIME", "0.48 0.43 0.35", "F2");
    text(188, 334, 10, appointment, "0.12 0.10 0.08");
    text(58, 304, 9, "VENUE", "0.48 0.43 0.35", "F2");
    text(188, 304, 10, venue, "0.12 0.10 0.08");
    text(58, 274, 9, "STATUS", "0.48 0.43 0.35", "F2");
    text(188, 274, 10, status.toUpperCase(), "0.18 0.48 0.30", "F2");

    rect(40, 164, 532, 52, "0.956 0.835 0.553");
    text(58, 188, 10, "PAYMENT STATUS", "0.72 0.48 0.08", "F2");
    text(420, 188, 10, payment.replace(/_/g, " ").toUpperCase(), "0.12 0.10 0.08", "F2");
    text(48, 90, 10, "Aura Shine", "0.72 0.48 0.08", "F2");
    text(48, 70, 9, "Please keep this invoice for your appointment records.", "0.40 0.36 0.30");
    text(430, 70, 9, "Thank you", "0.40 0.36 0.30");

    const content = commands.join("\n");
    const objects = [
      "<< /Type /Catalog /Pages 2 0 R >>",
      "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
      "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents 6 0 R >>",
      "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
      "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>",
      "<< /Length " + content.length + " >>\nstream\n" + content + "\nendstream"
    ];
    let pdf = "%PDF-1.4\n";
    const offsets = [0];
    objects.forEach((object, index) => {
      offsets.push(pdf.length);
      pdf += (index + 1) + " 0 obj\n" + object + "\nendobj\n";
    });
    const xref = pdf.length;
    pdf += "xref\n0 " + (objects.length + 1) + "\n0000000000 65535 f \n";
    for (let i = 1; i <= objects.length; i++) pdf += String(offsets[i]).padStart(10, "0") + " 00000 n \n";
    pdf += "trailer\n<< /Size " + (objects.length + 1) + " /Root 1 0 R >>\nstartxref\n" + xref + "\n%%EOF";

    const url = URL.createObjectURL(new Blob([pdf], { type: "application/pdf" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "aura-shine-" + reference + ".pdf";
    anchor.click();
    URL.revokeObjectURL(url);
  }

  async cancel() {
    const booking = this.booking();
    if (!booking) return;
    const alert = await this.alerts.create({
      header: "Cancel booking?",
      message: "This will call the customer booking cancellation API.",
      buttons: [
        { text: "Keep booking", role: "cancel" },
        { text: "Cancel booking", role: "destructive", handler: () => void this.marketplace.cancelBooking(booking.id) }
      ]
    });
    await alert.present();
  }

  async reschedule() {
    const booking = this.booking();
    if (!booking) return;
    const businessIdentity = this.resolvedBusiness()?.slug || booking.businessId;
    if (!businessIdentity || !booking.serviceId) {
      this.setFeedback("Rescheduling is unavailable for this booking");
      return;
    }
    await this.router.navigate([this.businessBookUrl(businessIdentity)], {
      queryParams: {
        serviceId: booking.serviceId,
        staffId: booking.staffId || undefined,
        date: this.localDateKey(this.parseDate(booking.startAt || booking.startsAt) || new Date()),
        step: 1,
        rescheduleBookingId: booking.id
      }
    });
  }

}
