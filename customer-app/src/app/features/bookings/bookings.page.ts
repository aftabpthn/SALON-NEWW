import { Component, OnDestroy, OnInit, computed, signal } from "@angular/core";
import { Router, RouterLink } from "@angular/router";
import { AlertController, IonButton, IonContent, IonIcon, IonSegment, IonSegmentButton, ToastController } from "@ionic/angular/standalone";
import { FormsModule } from "@angular/forms";
import { addIcons } from "ionicons";
import { calendarOutline, chatbubblesOutline, checkmarkCircleOutline, heartCircleOutline, hourglassOutline, locationOutline, navigateOutline, repeatOutline, receiptOutline, timeOutline } from "ionicons/icons";
import { MarketplaceService } from "../../core/marketplace.service";
import { AvailabilitySlot, Booking } from "../../core/api.types";

type BookingTab = "upcoming" | "past";
type RescheduleDateOption = { date: string; day: string; label: string; short: string };
type RescheduleDialog = {
  booking: Booking;
  businessSlug: string;
  dates: RescheduleDateOption[];
  selectedDate: string;
  slots: AvailabilitySlot[];
  selectedStartAt: string;
  loading: boolean;
  error: string;
};
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
                [class.expanded]="expandedBookingId() === booking.id"
                [attr.data-booking-id]="booking.id"
                role="button"
                tabindex="0"
                aria-label="Booking actions"
                [attr.aria-expanded]="expandedBookingId() === booking.id"
                (click)="openBooking(booking)"
                (keydown)="handleBookingKeydown($event, booking)"
              >
                <div class="date-block">
                  <span>{{ dateParts(booking).month }}</span>
                  <strong>{{ dateParts(booking).day }}</strong>
                </div>
                <div class="booking-content">
                  <span class="status-pill" [class.closed]="booking.status === 'cancelled'">{{ booking.status }}</span>
                  <h2>{{ booking.serviceName }}</h2>
                  <p>{{ booking.businessName }}</p>
                  <div class="booking-meta">
                    <span><ion-icon name="time-outline"></ion-icon>{{ booking.displayStartAt || booking.startsAt || booking.startAt }}</span>
                    <span><ion-icon name="location-outline"></ion-icon>{{ booking.address }}</span>
                  </div>
                  <div class="actions">
                    @if (canRebook(booking)) {
                      <ion-button size="small" fill="outline" class="secondary-button" [disabled]="!!actionLoading()" (click)="rebook($event, booking)">
                        <ion-icon name="repeat-outline" slot="start"></ion-icon>
                        Rebook
                      </ion-button>
                    }
                    @if (canManageUpcoming(booking)) {
                      <ion-button size="small" fill="outline" class="secondary-button" [disabled]="!!actionLoading()" (click)="reschedule($event, booking.id)">Reschedule</ion-button>
                      <ion-button size="small" fill="outline" class="secondary-button" [disabled]="!!actionLoading()" (click)="joinWaitlist($event)">
                        <ion-icon name="hourglass-outline" slot="start"></ion-icon>
                        Waitlist
                      </ion-button>
                    }
                    <ion-button size="small" fill="outline" class="secondary-button" [disabled]="!!actionLoading()" (click)="directions($event, booking)">
                      <ion-icon name="navigate-outline" slot="start"></ion-icon>
                      Directions
                    </ion-button>
                    <ion-button size="small" fill="outline" class="secondary-button" (click)="$event.stopPropagation(); openBookingDetails(booking)">
                      <ion-icon name="receipt-outline" slot="start"></ion-icon>
                      View invoice
                    </ion-button>
                    @if (canManageUpcoming(booking)) {
                      <ion-button size="small" fill="clear" color="danger" (click)="cancel($event, booking.id)">Cancel</ion-button>
                    }
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

      @if (rescheduleDialog(); as dialog) {
        <div class="reschedule-backdrop" role="presentation" (click)="closeReschedule()">
          <section class="reschedule-sheet" role="dialog" aria-modal="true" aria-label="Choose new appointment date and time" (click)="$event.stopPropagation()">
            <div class="sheet-head">
              <div>
                <h2>Choose new date & time</h2>
                <p>{{ dialog.booking.serviceName }} at {{ dialog.booking.businessName }}</p>
              </div>
              <button type="button" class="close-button" aria-label="Close reschedule picker" (click)="closeReschedule()">x</button>
            </div>

            <div class="calendar-strip" aria-label="Available dates" (wheel)="scrollDateStrip($event)" (pointerdown)="startDateSwipe($event)" (pointerup)="finishDateSwipe($event)" (pointercancel)="cancelDateSwipe()">
              @for (date of dialog.dates; track date.date) {
                <button type="button" class="date-pill" [class.active]="dialog.selectedDate === date.date" (click)="selectRescheduleDate(date.date)">
                  <span>{{ date.day }}</span>
                  <strong>{{ date.label }}</strong>
                  <small>{{ date.short }}</small>
                </button>
              }
            </div>

            @if (dialog.loading) {
              <div class="slot-state">Loading live slots...</div>
            } @else if (dialog.error) {
              <div class="slot-state error">{{ dialog.error }}</div>
            } @else {
              <div class="slot-grid-picker" aria-label="Available times">
                @for (slot of dialog.slots; track slot.startAt) {
                  <button type="button" class="time-pill" [class.active]="dialog.selectedStartAt === slot.startAt" (click)="selectRescheduleSlot(slot.startAt)">
                    {{ slot.displayTime }}
                  </button>
                } @empty {
                  <div class="slot-state">No slots on this date. Choose another date or join waitlist.</div>
                }
              </div>
            }

            <div class="sheet-actions">
              <ion-button fill="clear" (click)="closeReschedule()">Cancel</ion-button>
              <ion-button class="primary-gradient" [disabled]="!dialog.selectedStartAt || dialog.loading || !!actionLoading()" (click)="confirmReschedule()">
                Reschedule
              </ion-button>
            </div>
          </section>
        </div>
      }

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
      --background-checked: rgba(139, 92, 246, 0.08);
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
      margin: 10px 0 5px;
      letter-spacing: -0.04em;
    }

    .booking-content p {
      margin: 0 0 10px;
      color: var(--muted);
      font-weight: 800;
    }

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

    .reschedule-sheet {
      width: min(100%, 520px);
      max-height: min(760px, calc(100vh - 36px));
      display: grid;
      grid-template-rows: auto auto minmax(120px, 1fr) auto;
      overflow: hidden;
      border: 1px solid rgba(17, 24, 39, 0.12);
      border-radius: 28px;
      background: #ffffff;
      box-shadow: 0 28px 70px rgba(17, 24, 39, 0.24);
    }

    .waitlist-sheet {
      width: min(100%, 560px);
      max-height: min(820px, calc(100vh - 36px));
      display: grid;
      grid-template-rows: auto minmax(0, 1fr) auto;
      overflow: hidden;
      border: 1px solid rgba(214, 169, 74, 0.24);
      border-radius: 28px;
      background:
        linear-gradient(145deg, rgba(255, 255, 255, 0.98), rgba(255, 249, 236, 0.98) 48%, rgba(246, 228, 193, 0.92)),
        #FFF9EC;
      box-shadow: 0 28px 70px rgba(92, 65, 28, 0.24);
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
      border: 1px solid rgba(214, 169, 74, 0.22);
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
      box-shadow: 0 12px 24px rgba(122, 80, 25, 0.14);
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
      border: 1px solid rgba(214, 169, 74, 0.24);
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
      border-color: rgba(214, 169, 74, 0.56);
      box-shadow: 0 0 0 4px rgba(214, 169, 74, 0.14);
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
      border: 1px solid rgba(214, 169, 74, 0.24);
      border-radius: 999px;
      color: #7A5019;
      background: rgba(255, 255, 255, 0.78);
      font-weight: 900;
    }

    .waitlist-options button.active {
      border-color: transparent;
      color: #ffffff;
      background: linear-gradient(135deg, var(--primary), var(--primary-2));
      box-shadow: 0 12px 24px rgba(122, 80, 25, 0.15);
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

    .calendar-strip {
      display: flex;
      gap: 10px;
      overflow-x: auto;
      overflow-y: hidden;
      padding: 10px 22px 16px;
      border-bottom: 1px solid var(--border);
      scrollbar-width: none;
      touch-action: pan-x;
      -webkit-overflow-scrolling: touch;
      scroll-snap-type: x mandatory;
    }

    .calendar-strip::-webkit-scrollbar {
      display: none;
    }

    .date-pill {
      flex: 0 0 86px;
      min-height: 92px;
      display: grid;
      align-content: center;
      justify-items: center;
      gap: 5px;
      padding: 10px 8px;
      border: 1px solid var(--border);
      border-radius: 20px;
      color: var(--text);
      background: var(--surface);
      font-weight: 900;
      scroll-snap-align: start;
    }

    .date-pill span,
    .date-pill small {
      color: var(--muted);
      font-size: 0.74rem;
      text-transform: uppercase;
      letter-spacing: 0.08em;
    }

    .date-pill strong {
      font-size: 1.45rem;
      line-height: 1;
    }

    .date-pill.active {
      border-color: transparent;
      color: #ffffff;
      background: linear-gradient(135deg, var(--primary), var(--accent));
      box-shadow: 0 14px 28px rgba(139, 92, 246, 0.22);
    }

    .date-pill.active span,
    .date-pill.active small {
      color: rgba(255, 255, 255, 0.84);
    }

    .slot-grid-picker {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 10px;
      overflow-y: auto;
      padding: 18px 22px;
    }

    .time-pill {
      min-height: 48px;
      border: 1px solid var(--border);
      border-radius: 999px;
      color: var(--text);
      background: #ffffff;
      font-weight: 900;
    }

    .time-pill.active {
      border-color: transparent;
      color: #ffffff;
      background: linear-gradient(135deg, var(--primary), var(--accent));
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

      .slot-grid-picker {
        grid-template-columns: repeat(2, minmax(0, 1fr));
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
        gap: 8px;
        margin-top: 4px;
      }

      .command-card {
        min-height: 0;
        gap: 3px;
        padding: 10px;
        border-radius: 16px !important;
      }

      .command-card ion-icon {
        width: 34px;
        height: 34px;
        padding: 8px;
        border-radius: 12px;
      }

      .command-card strong {
        font-size: 0.86rem;
        line-height: 1.05;
      }

      .command-card span {
        font-size: 0.72rem;
        line-height: 1.2;
      }

      ion-segment {
        margin-bottom: 10px;
      }

      ion-segment-button {
        min-height: 38px;
        font-size: 0.78rem;
      }

      .booking-stack {
        gap: 10px;
      }

      .booking-card {
        grid-template-columns: 1fr;
        gap: 8px;
        padding: 10px;
        border-radius: 16px !important;
      }

      .date-block {
        min-height: 54px;
        grid-template-columns: auto auto;
        justify-content: start;
        gap: 8px;
        padding: 0 14px;
        border-radius: 16px;
      }

      .date-block span {
        font-size: 0.7rem;
      }

      .date-block strong {
        font-size: 1.55rem;
      }

      .booking-content h2 {
        margin: 5px 0 2px;
        font-size: 1.2rem;
        line-height: 1.05;
      }

      .booking-content p {
        margin: 0 0 5px;
        font-size: 0.86rem;
      }

      .booking-meta {
        gap: 3px;
        font-size: 0.76rem;
        line-height: 1.15;
      }

      .actions {
        display: none;
        gap: 5px;
        margin-top: 8px;
      }

      .booking-card.expanded .actions {
        display: flex;
      }

      .booking-card {
        cursor: pointer;
      }

      .booking-card:focus-visible {
        outline: 3px solid rgba(214, 169, 74, 0.6);
        outline-offset: 2px;
      }

      .actions ion-button {
        min-height: 32px;
        margin: 0;
        font-size: 0.7rem;
        --padding-start: 10px;
        --padding-end: 10px;
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
  readonly expandedBookingId = signal<string | null>(null);
  readonly actionLoading = signal("");
  readonly rescheduleDialog = signal<RescheduleDialog | null>(null);
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
  private dateSwipeStartX = 0;
  private dateSwipeStartY = 0;

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
    this.expandedBookingId.set(null);
    this.reload();
  }

  openBooking(booking: Booking) {
    if (window.matchMedia("(max-width: 599px)").matches) {
      this.expandedBookingId.update((id) => id === booking.id ? null : booking.id);
      return;
    }
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
    await this.openRescheduleSlots(booking);
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

  private async openRescheduleSlots(booking: Booking) {
    if (!booking.businessId || !booking.serviceId) {
      await this.presentToast("This booking cannot be rescheduled because service details are missing.", "danger");
      return;
    }
    this.actionLoading.set(`reschedule:${booking.id}`);
    try {
      const business = await this.marketplace.loadBusiness(booking.businessId);
      const dates = this.rescheduleDates(booking);
      const selectedDate = dates.find((item) => item.date === this.dateValue(booking))?.date || dates[0]?.date || this.localDateKey(new Date());
      this.rescheduleDialog.set({
        booking,
        businessSlug: business.slug,
        dates,
        selectedDate,
        slots: [],
        selectedStartAt: "",
        loading: true,
        error: ""
      });
      await this.loadRescheduleSlots(selectedDate);
    } catch {
      await this.presentToast(this.marketplace.error() || "Could not load reschedule slots.", "danger");
    } finally {
      this.actionLoading.set("");
    }
  }

  closeReschedule() {
    this.rescheduleDialog.set(null);
  }

  selectRescheduleSlot(startAt: string) {
    this.rescheduleDialog.update((current) => current ? { ...current, selectedStartAt: startAt } : current);
  }

  scrollDateStrip(event: WheelEvent) {
    const strip = event.currentTarget as HTMLElement | null;
    if (!strip) return;
    const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
    if (!delta) return;
    strip.scrollLeft += delta;
    event.preventDefault();
  }

  startDateSwipe(event: PointerEvent) {
    this.dateSwipeStartX = event.clientX;
    this.dateSwipeStartY = event.clientY;
  }

  finishDateSwipe(event: PointerEvent) {
    const deltaX = event.clientX - this.dateSwipeStartX;
    const deltaY = event.clientY - this.dateSwipeStartY;
    this.cancelDateSwipe();
    if (Math.abs(deltaX) < 50 || Math.abs(deltaX) < Math.abs(deltaY)) return;
    void this.moveRescheduleDate(deltaX < 0 ? 1 : -1);
  }

  cancelDateSwipe() {
    this.dateSwipeStartX = 0;
    this.dateSwipeStartY = 0;
  }

  async selectRescheduleDate(date: string) {
    await this.loadRescheduleSlots(date);
  }

  async moveRescheduleDate(offset: -1 | 1) {
    const dialog = this.rescheduleDialog();
    if (!dialog) return;
    const currentIndex = Math.max(0, dialog.dates.findIndex((item) => item.date === dialog.selectedDate));
    const nextIndex = Math.min(dialog.dates.length - 1, Math.max(0, currentIndex + offset));
    const nextDate = dialog.dates[nextIndex]?.date;
    if (!nextDate || nextDate === dialog.selectedDate) return;
    await this.loadRescheduleSlots(nextDate);
  }

  async confirmReschedule() {
    const dialog = this.rescheduleDialog();
    if (!dialog?.selectedStartAt) return;
    const slot = dialog.slots.find((item) => item.startAt === dialog.selectedStartAt);
    await this.rescheduleToSlot(dialog.booking, dialog.selectedStartAt, slot);
  }

  private async loadRescheduleSlots(date: string) {
    const dialog = this.rescheduleDialog();
    if (!dialog?.booking.serviceId) return;
    this.rescheduleDialog.update((current) => current ? { ...current, selectedDate: date, slots: [], selectedStartAt: "", loading: true, error: "" } : current);
    try {
      const days = await this.marketplace.loadAvailability(dialog.businessSlug, {
        serviceId: dialog.booking.serviceId,
        staffId: dialog.booking.staffId || undefined,
        date,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone
      });
      const slots = days.flatMap((day) => day.periods.flatMap((period) => period.slots)).filter((slot) => slot.available).slice(0, 18);
      this.rescheduleDialog.update((current) => current ? { ...current, slots, selectedStartAt: slots[0]?.startAt || "", loading: false, error: "" } : current);
    } catch {
      this.rescheduleDialog.update((current) => current ? { ...current, loading: false, error: this.marketplace.error() || "Could not load slots for this date." } : current);
    }
  }

  private async rescheduleToSlot(booking: Booking, startAt: string, slot?: AvailabilitySlot) {
    this.actionLoading.set(`reschedule:${booking.id}`);
    try {
      await this.marketplace.rescheduleBooking(booking.id, { startAt, staffId: slot?.staffId || booking.staffId || undefined });
      await this.presentToast("Booking rescheduled successfully.", "success");
      this.closeReschedule();
      await this.reload();
    } catch {
      await this.presentToast(this.marketplace.error() || "Unable to reschedule booking.", "danger");
    } finally {
      this.actionLoading.set("");
    }
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

  private rescheduleDates(booking: Booking): RescheduleDateOption[] {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const bookingDate = this.localDateFromKey(this.dateValue(booking));
    bookingDate.setHours(0, 0, 0, 0);
    const selected = bookingDate.getTime() >= today.getTime() ? bookingDate : today;
    const dates: Date[] = [];
    const endDate = new Date(today);
    endDate.setMonth(endDate.getMonth() + 1);
    const dayCount = Math.max(1, Math.round((endDate.getTime() - today.getTime()) / 86400000) + 1);
    for (let index = 0; index < dayCount; index += 1) {
      const date = new Date(today);
      date.setDate(today.getDate() + index);
      dates.push(date);
    }
    if (!dates.some((date) => this.localDateKey(date) === this.localDateKey(selected))) {
      dates.unshift(selected);
    }
    return dates.map((date) => ({
      date: this.localDateKey(date),
      day: new Intl.DateTimeFormat("en-IN", { weekday: "short" }).format(date),
      label: new Intl.DateTimeFormat("en-IN", { day: "2-digit" }).format(date),
      short: new Intl.DateTimeFormat("en-IN", { month: "short" }).format(date)
    }));
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

  private localDateFromKey(value: string): Date {
    const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return new Date();
    return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  }

  private scheduleMidnightRefresh() {
    if (this.midnightRefreshId) clearTimeout(this.midnightRefreshId);
    const now = new Date();
    const nextMidnight = new Date(now);
    nextMidnight.setHours(24, 0, 5, 0);
    this.midnightRefreshId = setTimeout(() => {
      const dialog = this.rescheduleDialog();
      if (dialog) {
        const dates = this.rescheduleDates(dialog.booking);
        const selectedDate = dates.some((date) => date.date === dialog.selectedDate) ? dialog.selectedDate : dates[0]?.date || "";
        this.rescheduleDialog.set({ ...dialog, dates, selectedDate });
        if (selectedDate) void this.loadRescheduleSlots(selectedDate);
      }
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
