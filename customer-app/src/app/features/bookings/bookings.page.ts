import { Component, OnDestroy, OnInit, computed, signal } from "@angular/core";
import { Router, RouterLink } from "@angular/router";
import { AlertController, IonButton, IonContent, IonIcon, IonSegment, IonSegmentButton, ToastController } from "@ionic/angular/standalone";
import { FormsModule } from "@angular/forms";
import { addIcons } from "ionicons";
import { calendarOutline, chatbubblesOutline, checkmarkCircleOutline, chevronForwardOutline, heartCircleOutline, hourglassOutline, locationOutline, navigateOutline, repeatOutline, receiptOutline, timeOutline } from "ionicons/icons";
import { MarketplaceService } from "../../core/marketplace.service";
import { Booking } from "../../core/api.types";

type BookingTab = "upcoming" | "past";
type WaitlistDialog = {
  booking: Booking;
  preferredDate: string;
  preferredTime: "any" | "morning" | "afternoon" | "evening";
  priority: "normal" | "high";
  reason: string;
  error: string;
};

@Component({
  standalone: true,
  imports: [FormsModule, RouterLink, IonButton, IonContent, IonIcon, IonSegment, IonSegmentButton],
  template: `
    <ion-content>
      <main class="page bookings-page">
        <section class="bookings-hero">
          <h1 class="page-title">My bookings</h1>
          <div class="booking-command-grid">
            @for (item of bookingCommands; track item.label) {
              <article class="command-card premium-card">
                <ion-icon [name]="item.icon"></ion-icon>
                <strong>{{ item.label }}</strong>
                <span>{{ item.copy }}</span>
              </article>
            }
          </div>
        </section>

        <ion-segment [value]="tab()" (ionChange)="setTab($any($event.detail.value) || 'upcoming')">
          <ion-segment-button value="upcoming">Upcoming</ion-segment-button>
          <ion-segment-button value="past">Past</ion-segment-button>
        </ion-segment>

        @if (marketplace.loading()) {
          <section class="empty premium-card"><h2>Loading bookings</h2></section>
        } @else if (marketplace.error()) {
          <section class="empty premium-card error"><h2>Could not load bookings</h2><p>{{ marketplace.error() }}</p><ion-button class="primary-gradient" (click)="reload()">Retry</ion-button></section>
        } @else {
          <div class="booking-stack">
            @for (booking of filtered(); track booking.id) {
              <article
                class="booking-card premium-card"
                [attr.data-booking-id]="booking.id"
                role="button"
                tabindex="0"
                aria-label="View booking details"
                (click)="openBooking(booking)"
                (keydown)="handleBookingKeydown($event, booking)"
              >
                <div class="date-block">
                  <span>{{ dateParts(booking).month }}</span>
                  <strong>{{ dateParts(booking).day }}</strong>
                </div>
                <div class="booking-content">
                  <div class="booking-title-row">
                    <h2>{{ booking.serviceName }}</h2>
                    <span class="status-pill" [class.closed]="booking.status === 'cancelled'">{{ booking.status }}</span>
                  </div>
                  <p>{{ booking.businessName }}</p>
                  <div class="booking-bottom-row">
                    <div class="booking-meta">
                      <span><ion-icon name="time-outline"></ion-icon>{{ bookingTimeLabel(booking) }}</span>
                      <span><ion-icon name="location-outline"></ion-icon>{{ booking.address || "Venue to be confirmed" }}</span>
                    </div>
                    <span class="view-details-btn">
                      <span>View details</span>
                      <ion-icon name="chevron-forward-outline" aria-hidden="true"></ion-icon>
                    </span>
                  </div>
                </div>
              </article>
            } @empty {
              <section class="empty premium-card">
                <h2>No bookings yet</h2>
                <ion-button class="primary-gradient" routerLink="/tabs/search">Find a place</ion-button>
              </section>
            }
          </div>
        }
      </main>

      @if (waitlistDialog(); as dialog) {
        <div class="reschedule-backdrop" role="presentation" (click)="closeWaitlist()">
          <section class="waitlist-sheet" role="dialog" aria-modal="true" aria-label="Join appointment waitlist" (click)="$event.stopPropagation()">
            <div class="sheet-head waitlist-head">
              <div>
                <h2>Join smart waitlist</h2>
                <p>{{ dialog.booking.serviceName }} at {{ dialog.booking.businessName }}</p>
              </div>
              <button type="button" class="close-button" aria-label="Close waitlist" (click)="closeWaitlist()">x</button>
            </div>

            <div class="waitlist-body">
              <div class="waitlist-summary">
                <ion-icon name="hourglass-outline"></ion-icon>
                <div>
                  <strong>Auto-fill queue</strong>
                  <span>We will look for earlier or backup slots and share the best match.</span>
                </div>
              </div>

              <label class="waitlist-field">
                <span>Preferred date</span>
                <input type="date" [min]="todayKey()" [(ngModel)]="dialog.preferredDate" name="waitlistDate" (ngModelChange)="updateWaitlist({ preferredDate: $event })" />
              </label>

              <div class="waitlist-field">
                <span>Preferred time</span>
                <div class="waitlist-options" role="radiogroup" aria-label="Preferred waitlist time">
                  @for (option of waitlistTimeOptions; track option.value) {
                    <button type="button" [class.active]="dialog.preferredTime === option.value" (click)="updateWaitlist({ preferredTime: option.value })">{{ option.label }}</button>
                  }
                </div>
              </div>

              <div class="waitlist-field">
                <span>Priority</span>
                <div class="waitlist-options two" role="radiogroup" aria-label="Waitlist priority">
                  <button type="button" [class.active]="dialog.priority === 'normal'" (click)="updateWaitlist({ priority: 'normal' })">Normal</button>
                  <button type="button" [class.active]="dialog.priority === 'high'" (click)="updateWaitlist({ priority: 'high' })">Urgent</button>
                </div>
              </div>

              <label class="waitlist-field">
                <span>Note for the salon</span>
                <textarea rows="3" maxlength="180" placeholder="Preferred staff, time window, or special request" [(ngModel)]="dialog.reason" name="waitlistReason" (ngModelChange)="updateWaitlist({ reason: $event })"></textarea>
              </label>

              @if (dialog.error) {
                <p class="waitlist-error">{{ dialog.error }}</p>
              }
            </div>

            <div class="sheet-actions">
              <ion-button fill="clear" (click)="closeWaitlist()">Not now</ion-button>
              <ion-button class="primary-gradient" [disabled]="!!actionLoading()" (click)="submitWaitlist()">
                {{ actionLoading() === "waitlist:" + dialog.booking.id ? "Joining..." : "Join waitlist" }}
              </ion-button>
            </div>
          </section>
        </div>
      }
    </ion-content>
  `,
  styles: [`
    .bookings-page {
      max-width: 1180px;
    }

    .bookings-hero {
      display: grid;
      gap: 10px;
      margin-bottom: 18px;
    }

    .bookings-hero .muted {
      max-width: 680px;
      margin: 0;
    }

    .booking-command-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 10px;
      margin-top: 8px;
    }

    .command-card {
      display: grid;
      gap: 6px;
      padding: 14px;
    }

    .command-card ion-icon {
      width: 42px;
      height: 42px;
      padding: 10px;
      border-radius: 16px;
      color: #ffffff;
      background: linear-gradient(135deg, var(--primary), var(--primary-2), var(--accent));
    }

    .command-card strong {
      color: var(--text);
    }

    .command-card span {
      color: var(--muted);
      line-height: 1.35;
      font-size: 0.88rem;
    }

    ion-segment {
      --background: rgba(255, 255, 255, 0.86);
      margin-bottom: 18px;
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
      background: linear-gradient(135deg, var(--primary), var(--accent));
    }

    .booking-stack {
      display: grid;
      gap: 14px;
    }

    .booking-card {
      display: grid;
      grid-template-columns: 86px minmax(0, 1fr);
      gap: 16px;
      padding: 16px;
      color: inherit;
      text-decoration: none;
      transition: transform 180ms ease, box-shadow 180ms ease;
    }

    .date-block {
      min-height: 96px;
      display: grid;
      place-items: center;
      align-content: center;
      border-radius: 24px;
      color: #ffffff;
      background: linear-gradient(135deg, var(--primary), var(--primary-2), var(--accent));
    }

    .date-block span {
      font-size: 0.78rem;
      font-weight: 900;
      letter-spacing: 0.1em;
      text-transform: uppercase;
      opacity: 0.8;
    }

    .date-block strong {
      font-size: 2rem;
      line-height: 1;
    }

    .booking-content h2 {
      margin: 0;
      letter-spacing: -0.04em;
    }

    .booking-title-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      margin: 2px 0 5px;
    }

    .booking-title-row h2 { min-width: 0; }
    .booking-title-row .status-pill {
      flex: 0 0 auto !important;
      min-height: 18px !important;
      padding: 2px 7px !important;
      border: 1px solid rgba(16, 185, 129, 0.42) !important;
      border-radius: 999px !important;
      color: #047857 !important;
      background: rgba(16, 185, 129, 0.14) !important;
      font-size: 0.60rem !important;
      font-weight: 850 !important;
      letter-spacing: 0.01em !important;
      text-transform: lowercase !important;
      box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.6) !important;
    }
    .booking-title-row .status-pill.closed {
      color: #dc2626 !important;
      border-color: rgba(239, 68, 68, 0.35) !important;
      background: rgba(239, 68, 68, 0.12) !important;
    }
    .booking-bottom-row {
      display: flex;
      align-items: flex-end;
      justify-content: space-between;
      gap: 10px;
      margin-top: 4px;
    }
    .booking-bottom-row .booking-meta { flex: 1 1 auto; min-width: 0; }
    .view-details-btn {
      flex: 0 0 auto;
      display: inline-flex;
      align-items: center;
      gap: 3px;
      padding: 3px 9px;
      border: 1px solid rgba(11, 70, 120, 0.22);
      border-radius: 999px;
      color: var(--primary);
      background: var(--primary-soft, rgba(11, 70, 120, 0.08));
      font-size: 0.68rem;
      font-weight: 850;
      letter-spacing: -0.01em;
      white-space: nowrap;
      transition: color 160ms ease, background 160ms ease, border-color 160ms ease, transform 160ms ease;
    }
    .view-details-btn ion-icon { font-size: 0.72rem; transition: transform 160ms ease; }
    .booking-card:hover .view-details-btn {
      color: #ffffff;
      border-color: transparent;
      background: linear-gradient(135deg, var(--primary), var(--brand-800, #0B4678));
      box-shadow: 0 4px 12px rgba(11, 70, 120, 0.25);
    }
    .booking-card:hover .view-details-btn ion-icon { transform: translateX(2px); }

    .booking-meta {
      display: grid;
      gap: 6px;
      color: var(--muted);
      font-size: 0.9rem;
      font-weight: 800;
    }

    .booking-meta span {
      display: flex;
      gap: 7px;
      align-items: flex-start;
    }

    .actions {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin-top: 14px;
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

    .reschedule-backdrop {
      position: fixed;
      inset: 0;
      z-index: 3000;
      display: grid;
      place-items: center;
      padding: 18px;
      background: rgba(17, 24, 39, 0.42);
      backdrop-filter: blur(5px);
    }

    .waitlist-sheet {
      width: min(100%, 560px);
      max-height: min(820px, calc(100vh - 36px));
      display: grid;
      grid-template-rows: auto minmax(0, 1fr) auto;
      overflow: hidden;
      border: 1px solid rgba(11, 70, 120, 0.24);
      border-radius: 28px;
      background:
        linear-gradient(145deg, rgba(255, 255, 255, 0.98), rgba(246, 249, 252, 0.98) 48%, rgba(231, 240, 248, 0.92)),
        #FFFFFF;
      box-shadow: 0 28px 70px rgba(6, 23, 43, 0.2);
    }

    .sheet-head {
      display: flex;
      justify-content: space-between;
      gap: 14px;
      padding: 22px 22px 12px;
    }

    .sheet-head h2 {
      margin: 0 0 8px;
      color: var(--text);
      font-size: 1.45rem;
      letter-spacing: -0.035em;
    }

    .sheet-head p:not(.eyebrow) {
      margin: 0;
      color: var(--muted);
      line-height: 1.4;
      font-weight: 800;
    }

    .waitlist-head {
      padding-bottom: 8px;
    }

    .waitlist-body {
      display: grid;
      gap: 14px;
      overflow-y: auto;
      padding: 10px 22px 18px;
    }

    .waitlist-summary {
      display: grid;
      grid-template-columns: 48px minmax(0, 1fr);
      gap: 12px;
      align-items: center;
      padding: 14px;
      border: 1px solid rgba(11, 70, 120, 0.22);
      border-radius: 20px;
      background: rgba(255, 255, 255, 0.72);
    }

    .waitlist-summary ion-icon {
      width: 28px;
      height: 28px;
      padding: 10px;
      border-radius: 16px;
      color: #ffffff;
      background: linear-gradient(135deg, var(--primary), var(--primary-2), var(--accent));
      box-shadow: 0 12px 24px rgba(11, 70, 120, 0.14);
    }

    .waitlist-summary strong,
    .waitlist-field span {
      display: block;
      color: var(--text);
      font-weight: 900;
    }

    .waitlist-summary span {
      display: block;
      margin-top: 3px;
      color: var(--muted);
      line-height: 1.35;
      font-size: 0.88rem;
      font-weight: 700;
    }

    .waitlist-field {
      display: grid;
      gap: 8px;
    }

    .waitlist-field input,
    .waitlist-field textarea {
      width: 100%;
      border: 1px solid rgba(11, 70, 120, 0.24);
      border-radius: 18px;
      color: var(--text);
      background: rgba(255, 255, 255, 0.88);
      font: inherit;
      font-weight: 800;
      outline: none;
    }

    .waitlist-field input {
      min-height: 52px;
      padding: 0 14px;
    }

    .waitlist-field textarea {
      resize: vertical;
      min-height: 92px;
      padding: 12px 14px;
      line-height: 1.45;
    }

    .waitlist-field input:focus,
    .waitlist-field textarea:focus {
      border-color: rgba(11, 70, 120, 0.56);
      box-shadow: 0 0 0 4px rgba(37, 99, 235, 0.18);
    }

    .waitlist-options {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 8px;
    }

    .waitlist-options.two {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }

    .waitlist-options button {
      min-height: 44px;
      border: 1px solid rgba(11, 70, 120, 0.24);
      border-radius: 999px;
      color: var(--primary);
      background: rgba(255, 255, 255, 0.78);
      font-weight: 900;
    }

    .waitlist-options button.active {
      border-color: transparent;
      color: #ffffff;
      background: linear-gradient(135deg, var(--primary), var(--primary-2));
      box-shadow: 0 12px 24px rgba(11, 70, 120, 0.15);
    }

    .waitlist-error {
      margin: 0;
      padding: 10px 12px;
      border: 1px solid rgba(239, 68, 68, 0.24);
      border-radius: 14px;
      color: #B91C1C;
      background: rgba(254, 226, 226, 0.72);
      font-size: 0.88rem;
      font-weight: 800;
    }

    .close-button {
      flex: 0 0 auto;
      width: 42px;
      height: 42px;
      min-height: 42px;
      border: 1px solid var(--border);
      border-radius: 999px;
      color: var(--text);
      background: #ffffff;
      font-size: 1.55rem;
      line-height: 1;
    }

    .slot-state {
      align-self: center;
      padding: 26px 22px;
      color: var(--muted);
      text-align: center;
      font-weight: 900;
    }

    .slot-state.error {
      color: #EF4444;
    }

    .sheet-actions {
      display: flex;
      justify-content: flex-end;
      gap: 10px;
      padding: 14px 18px;
      border-top: 1px solid var(--border);
      background: rgba(255, 255, 255, 0.94);
    }

    @media (hover: hover) and (pointer: fine) {
      .booking-card:hover {
        transform: translateY(-3px);
        box-shadow: var(--shadow-card);
      }
    }

    @media (max-width: 599px) {
      .booking-card {
        grid-template-columns: 1fr;
      }

      .date-block {
        min-height: 74px;
        grid-template-columns: auto auto;
        justify-content: start;
        gap: 8px;
        padding: 0 18px;
      }

      .sheet-actions {
        gap: 6px;
        padding: 10px 12px;
        padding-bottom: max(10px, env(safe-area-inset-bottom));
      }

      .waitlist-options {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }
    }

    @media (max-width: 599px) {
      .bookings-page {
        padding-top: 4px !important;
      }

      .bookings-hero {
        gap: 6px;
        margin-bottom: 10px;
      }

      .bookings-hero .page-title {
        margin-bottom: 0 !important;
        font-size: 1.65rem !important;
        line-height: 1 !important;
      }

      .booking-command-grid {
        grid-template-columns: repeat(4, minmax(0, 1fr));
        gap: 6px;
        margin-top: 2px;
      }

      .command-card {
        min-height: 0;
        justify-items: center;
        align-content: center;
        gap: 4px;
        padding: 7px 3px 6px;
        border-radius: 14px !important;
        text-align: center;
      }

      .command-card ion-icon {
        width: 28px;
        height: 28px;
        padding: 7px;
        border-radius: 11px;
      }

      .command-card strong {
        max-width: 100%;
        font-size: 0.64rem;
        line-height: 1.08;
        overflow-wrap: anywhere;
      }

      .command-card span {
        display: none;
      }

      ion-segment {
        margin-bottom: 8px;
      }

      ion-segment-button {
        min-height: 36px;
        font-size: 0.74rem;
      }

      .booking-stack {
        gap: 8px;
      }

      .booking-card {
        grid-template-columns: 48px minmax(0, 1fr);
        align-items: stretch;
        gap: 8px;
        min-height: 84px;
        padding: 6px;
        border-radius: 14px !important;
      }

      .date-block {
        width: 48px;
        min-height: 72px;
        grid-template-columns: 1fr;
        grid-template-rows: auto auto;
        justify-content: center;
        gap: 2px;
        padding: 7px 3px;
        border-radius: 11px;
      }

      .date-block span {
        font-size: 0.56rem;
        letter-spacing: 0.06em;
      }

      .date-block strong {
        font-size: 1.24rem;
      }

      .booking-content { min-width: 0; align-self: center; overflow: hidden; }
      .booking-title-row { gap: 6px; margin: 0 0 2px; }
      .booking-content .status-pill { min-height: 16px !important; padding: 1px 5px !important; font-size: 0.52rem !important; }
      .booking-bottom-row { display: flex !important; align-items: flex-end !important; justify-content: space-between !important; gap: 6px !important; margin-top: 2px !important; }
      .view-details-btn { padding: 2px 6px !important; font-size: 0.58rem !important; gap: 2px !important; }
      .view-details-btn ion-icon { font-size: 0.60rem !important; }

      .booking-content h2 {
        margin: 0;
        overflow: hidden;
        font-size: 0.88rem;
        line-height: 1.05;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .booking-content p {
        margin: 0 0 3px;
        overflow: hidden;
        font-size: 0.68rem;
        line-height: 1.08;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .booking-meta {
        gap: 1px;
        min-width: 0;
        font-size: 0.61rem;
        line-height: 1.08;
      }

      .booking-meta span {
        min-width: 0;
        gap: 4px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .booking-meta ion-icon {
        flex: 0 0 auto;
        font-size: 0.66rem;
      }

      .actions {
        display: none;
        flex-wrap: nowrap;
        gap: 4px;
        margin-top: 6px;
        padding: 1px 0 2px;
        overflow-x: auto;
        overscroll-behavior-inline: contain;
        scrollbar-width: none;
      }

      .actions::-webkit-scrollbar { display: none; }

      .booking-card.expanded .actions {
        display: flex;
      }

      .booking-card.expanded {
        min-height: 0;
      }

      .booking-card {
        cursor: pointer;
      }

      .booking-card:focus-visible {
        outline: 3px solid var(--focus);
        outline-offset: 2px;
      }

      .actions ion-button {
        flex: 0 0 auto;
        min-height: 34px;
        margin: 0;
        font-size: 0.64rem;
        --padding-start: 9px;
        --padding-end: 9px;
      }
    }
    @media (min-width: 1024px) {
      .booking-stack {
        grid-template-columns: repeat(2, minmax(0, 1fr));
        align-items: start;
      }

      .booking-command-grid {
        grid-template-columns: repeat(4, minmax(0, 1fr));
      }
    }
  `]
})
export class BookingsPage implements OnDestroy, OnInit {
  readonly tab = signal<BookingTab>("upcoming");
  readonly actionLoading = signal("");
  readonly waitlistDialog = signal<WaitlistDialog | null>(null);
  readonly filtered = computed(() => this.marketplace.bookings());
  readonly waitlistTimeOptions: Array<{ value: WaitlistDialog["preferredTime"]; label: string }> = [
    { value: "any", label: "Any time" },
    { value: "morning", label: "Morning" },
    { value: "afternoon", label: "Afternoon" },
    { value: "evening", label: "Evening" }
  ];
  readonly bookingCommands = [
    { label: "Rebooking", copy: "Repeat past visits faster", icon: "repeat-outline" },
    { label: "Waitlist", copy: "Join auto-fill queues", icon: "hourglass-outline" },
    { label: "Digital check-in", copy: "Arrival and consent ready", icon: "checkmark-circle-outline" },
    { label: "Support", copy: "Chat and ticket handoff", icon: "chatbubbles-outline" }
  ];
  private midnightRefreshId: ReturnType<typeof setTimeout> | null = null;

  constructor(readonly marketplace: MarketplaceService, private readonly alerts: AlertController, private readonly router: Router, private readonly toasts: ToastController) {
    addIcons({ calendarOutline, chatbubblesOutline, checkmarkCircleOutline, heartCircleOutline, hourglassOutline, locationOutline, navigateOutline, repeatOutline, receiptOutline, timeOutline });
  }

  ngOnInit() {
    this.reload();
    this.scheduleMidnightRefresh();
  }

  ngOnDestroy() {
    if (this.midnightRefreshId) clearTimeout(this.midnightRefreshId);
  }

  setTab(tab: BookingTab) {
    this.tab.set(tab);
    this.reload();
  }

  openBooking(booking: Booking) {
    void this.router.navigate(["/bookings", booking.id]);
  }

  openBookingDetails(booking: Booking) {
    void this.router.navigate(["/bookings", booking.id]);
  }

  handleBookingKeydown(event: KeyboardEvent, booking: Booking) {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    this.openBooking(booking);
  }

  reload() {
    if (!this.marketplace.isAuthenticated()) {
      void this.router.navigateByUrl("/login");
      return;
    }
    void this.marketplace.loadBookings(this.tab()).catch(() => undefined);
  }

  dateParts(booking: Booking) {
    const label = booking.displayStartAt || booking.startsAt || booking.startAt || "";
    if (label.toLowerCase().includes("today")) return { month: "Today", day: "Now" };
    const match = label.match(/(\d{1,2})\s+([A-Za-z]{3})/);
    return { month: match?.[2] ?? "Soon", day: match?.[1] ?? "Next" };
  }

  bookingTimeLabel(booking: Booking): string {
    const raw = booking.startsAt || booking.startAt || "";
    const date = raw ? new Date(raw) : null;
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

  async cancel(event: Event, id: string) {
    event.preventDefault();
    event.stopPropagation();
    const alert = await this.alerts.create({
      header: "Cancel booking?",
      message: "This will request cancellation from the booking API.",
      buttons: [
        { text: "Keep booking", role: "cancel" },
        { text: "Cancel booking", role: "destructive", handler: () => void this.confirmCancel(id) }
      ]
    });
    await alert.present();
  }

  private async confirmCancel(id: string) {
    await this.marketplace.cancelBooking(id).catch(() => undefined);
    // Re-fetch so a cancelled booking drops out of the Upcoming list immediately.
    this.reload();
  }

  rebook(event: Event, booking: Booking) {
    event.preventDefault();
    event.stopPropagation();
    if (booking.businessId) {
      void this.router.navigate(["/business", booking.businessId, "book"], {
        queryParams: {
          serviceId: booking.serviceId || undefined,
          staffId: booking.staffId || undefined,
          rebookFrom: booking.id,
          step: 3
        }
      });
      return;
    }
    void this.router.navigateByUrl("/tabs/search");
  }

  canRebook(booking: Booking): boolean {
    return this.tab() === "past" || booking.status === "completed" || booking.status === "cancelled";
  }

  canManageUpcoming(booking: Booking): boolean {
    return this.tab() === "upcoming" && booking.status !== "cancelled" && booking.status !== "completed";
  }

  async joinWaitlist(event: Event) {
    event.preventDefault();
    event.stopPropagation();
    const booking = this.bookingFromEvent(event);
    if (!booking) return;
    this.waitlistDialog.set({
      booking,
      preferredDate: this.dateValue(booking),
      preferredTime: "any",
      priority: "normal",
      reason: "",
      error: ""
    });
  }

  updateWaitlist(patch: Partial<Omit<WaitlistDialog, "booking">>) {
    this.waitlistDialog.update((current) => current ? { ...current, ...patch, error: "" } : current);
  }

  closeWaitlist() {
    this.waitlistDialog.set(null);
  }

  async submitWaitlist() {
    const dialog = this.waitlistDialog();
    if (!dialog) return;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dialog.preferredDate)) {
      this.updateWaitlist({ error: "Choose a valid preferred date." });
      return;
    }
    if (dialog.preferredDate < this.todayKey()) {
      this.updateWaitlist({ error: "Preferred date cannot be in the past." });
      return;
    }
    await this.joinWaitlistForBooking(dialog.booking, {
      preferredDate: dialog.preferredDate,
      preferredTime: dialog.preferredTime,
      priority: dialog.priority,
      reason: dialog.reason
    });
  }

  async reschedule(event: Event, id: string) {
    event.preventDefault();
    event.stopPropagation();
    const booking = this.marketplace.bookings().find((item) => item.id === id);
    if (!booking) return;
    if (!booking.businessId || !booking.serviceId) {
      await this.presentToast("This booking cannot be rescheduled because service details are missing.", "danger");
      return;
    }
    this.actionLoading.set(`reschedule:${booking.id}`);
    try {
      const business = await this.marketplace.loadBusiness(booking.businessId);
      await this.router.navigate(["/business", business.slug, "book"], {
        queryParams: {
          serviceId: booking.serviceId,
          staffId: booking.staffId || undefined,
          date: this.dateValue(booking),
          step: 1,
          rescheduleBookingId: booking.id
        }
      });
    } catch {
      await this.presentToast(this.marketplace.error() || "Could not open rescheduling.", "danger");
    } finally {
      this.actionLoading.set("");
    }
  }

  directions(event: Event, booking: Booking) {
    event.preventDefault();
    event.stopPropagation();
    const hasCoordinates = booking.latitude !== undefined && booking.latitude !== null && booking.longitude !== undefined && booking.longitude !== null;
    const query = hasCoordinates
      ? `${booking.latitude},${booking.longitude}`
      : encodeURIComponent([booking.businessName, booking.address].filter(Boolean).join(", "));
    window.open(`https://www.google.com/maps/search/?api=1&query=${query}`, "_blank", "noopener,noreferrer");
  }

  private async joinWaitlistForBooking(booking: Booking, value: { preferredDate?: string; preferredTime?: WaitlistDialog["preferredTime"]; priority?: "normal" | "high"; reason?: string }) {
    this.actionLoading.set(`waitlist:${booking.id}`);
    try {
      const timeNote = value.preferredTime && value.preferredTime !== "any" ? `Preferred time: ${value.preferredTime}.` : "Preferred time: any.";
      const customerNote = String(value.reason || "").trim();
      const result = await this.marketplace.joinBookingWaitlist(booking.id, {
        preferredDate: value.preferredDate || this.dateValue(booking),
        reason: [timeNote, customerNote || "Customer wants an earlier or backup slot"].join(" "),
        priority: value.priority || "normal",
        serviceId: booking.serviceId || undefined,
        staffId: booking.staffId || undefined
      });
      const recommendation = result.recommendations[0]?.displayTime ? ` First suggestion: ${result.recommendations[0].displayTime}.` : "";
      await this.presentToast(`Waitlist joined successfully.${recommendation}`, "success");
      this.closeWaitlist();
      await this.reload();
    } catch {
      const message = this.marketplace.error() || "Unable to join waitlist.";
      this.updateWaitlist({ error: message });
      await this.presentToast(message, "danger");
    } finally {
      this.actionLoading.set("");
    }
  }

  private bookingFromEvent(event: Event): Booking | null {
    const element = event.currentTarget as HTMLElement | null;
    const card = element?.closest("[data-booking-id]");
    const id = card?.getAttribute("data-booking-id") || "";
    return this.marketplace.bookings().find((booking) => booking.id === id) ?? null;
  }

  private dateValue(booking: Booking): string {
    const source = booking.startAt || booking.startsAt || "";
    if (/^\d{4}-\d{2}-\d{2}$/.test(source)) return source;
    const date = source ? new Date(source) : new Date();
    return Number.isNaN(date.getTime()) ? this.localDateKey(new Date()) : this.localDateKey(date);
  }

  private localDateKey(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  todayKey(): string {
    return this.localDateKey(new Date());
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
