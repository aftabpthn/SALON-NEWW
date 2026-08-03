import { Component, computed } from "@angular/core";
import { RouterLink } from "@angular/router";
import { IonButton, IonContent, IonIcon } from "@ionic/angular/standalone";
import { addIcons } from "ionicons";
import { calendarOutline, checkmarkDoneOutline, homeOutline } from "ionicons/icons";
import { Booking } from "../../core/api.types";
import { MarketplaceService } from "../../core/marketplace.service";

@Component({
  standalone: true,
  imports: [RouterLink, IonButton, IonContent, IonIcon],
  template: `
    <ion-content>
      <main class="success-page">
        @if (booking(); as booking) {
        <section class="success-card premium-card">
          <header class="success-head">
            <div class="check"><ion-icon name="checkmark-done-outline"></ion-icon></div>
            <div>
              <p class="eyebrow">Booking {{ booking.status }}</p>
              <h1>Appointment confirmed</h1>
              <p class="muted">{{ booking.businessName }}</p>
            </div>
          </header>

          <section class="appointment-group" aria-label="Appointment information">
            <div class="appointment-primary">
              <span>Service</span>
              <strong>{{ booking.serviceName }}</strong>
              <small>with {{ booking.staffName || "Any available professional" }}</small>
            </div>
            <dl class="summary-list">
              <div><dt>Time</dt><dd>{{ booking.displayStartAt || booking.startsAt || booking.startAt }}</dd></div>
              <div><dt>Address</dt><dd>{{ booking.address }}</dd></div>
              <div><dt>Reference</dt><dd>{{ booking.reference }}</dd></div>
            </dl>
          </section>

          <div class="actions">
            <ion-button expand="block" class="primary-gradient" [routerLink]="bookingsLink()">View booking</ion-button>
            <div class="secondary-actions">
              <button type="button" (click)="addToCalendar(booking)">
                <ion-icon name="calendar-outline" aria-hidden="true"></ion-icon>
                Add to calendar
              </button>
              <a [routerLink]="homeLink()">
                <ion-icon name="home-outline" aria-hidden="true"></ion-icon>
                {{ marketplace.salonMode() ? 'My Salon' : 'Home' }}
              </a>
            </div>
          </div>
        </section>
        } @else {
          <section class="success-card premium-card">
            <h1>No booking loaded</h1>
            <ion-button expand="block" class="primary-gradient" [routerLink]="bookingsLink()">View bookings</ion-button>
          </section>
        }
      </main>
    </ion-content>
  `,
  styles: [`
    .success-page {
      min-height: 100%;
      display: grid;
      place-items: center;
      padding: 18px;
      background:
        radial-gradient(circle at 50% 16%, rgba(99, 102, 241, 0.12), transparent 34%),
        transparent;
    }

    .success-card {
      width: min(560px, 100%);
      display: grid;
      gap: 18px;
      padding: 22px;
      text-align: left;
      animation-name: aura-card-in;
      animation-duration: var(--motion-slow);
      animation-iteration-count: 1;
      transform: none;
    }

    .success-head {
      display: grid;
      grid-template-columns: auto minmax(0, 1fr);
      align-items: center;
      gap: 14px;
    }

    .check {
      width: 58px;
      height: 58px;
      display: grid;
      place-items: center;
      margin: 0;
      border-radius: 20px;
      color: #ffffff;
      background: linear-gradient(135deg, #10B981, #059669);
      box-shadow: 0 12px 26px rgba(16, 185, 129, 0.2);
      font-size: 1.7rem;
    }

    h1 {
      margin: 0 0 4px;
      font-size: clamp(1.55rem, 5vw, 2.25rem);
      letter-spacing: -0.055em;
      line-height: 1.02;
    }

    .success-head .muted { margin: 0; }

    .appointment-group {
      display: grid;
      gap: 12px;
      padding: 14px;
      border: 1px solid var(--border);
      border-radius: 20px;
      background: var(--glass);
    }

    .appointment-primary {
      display: grid;
      gap: 3px;
      padding-bottom: 10px;
      border-bottom: 1px solid var(--border);
    }

    .appointment-primary span {
      color: var(--primary);
      font-size: 0.68rem;
      font-weight: 950;
      letter-spacing: 0.08em;
      text-transform: uppercase;
    }

    .appointment-primary strong {
      color: var(--text);
      font-size: 1.08rem;
      line-height: 1.15;
    }

    .appointment-primary small {
      color: var(--muted);
      font-weight: 800;
    }

    .summary-list {
      display: grid;
      gap: 0;
      margin: 0;
      text-align: left;
    }

    .summary-list div {
      display: flex;
      justify-content: space-between;
      gap: 14px;
      padding: 10px 0;
      border-bottom: 1px solid var(--border);
    }

    .summary-list div:last-child { border-bottom: 0; padding-bottom: 0; }

    .summary-list dt {
      color: var(--muted);
      font-weight: 800;
    }

    .summary-list dd {
      margin: 0;
      font-weight: 900;
      text-align: right;
    }

    .actions {
      display: grid;
      gap: 10px;
    }

    .secondary-actions {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 8px;
    }

    .secondary-actions button,
    .secondary-actions a {
      min-height: 42px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      padding: 0 10px;
      border: 1px solid var(--border);
      border-radius: 14px;
      color: var(--primary);
      background: var(--glass);
      font: inherit;
      font-size: 0.84rem;
      font-weight: 900;
      text-decoration: none;
    }

    .secondary-actions ion-icon { font-size: 1rem; }

    .home-button {
      --color: var(--primary);
      --color-activated: var(--brand-900);
      --background-hover: var(--primary-soft);
      --background-activated: rgba(99, 102, 241, 0.16);
      margin-top: 8px;
      font-weight: 900;
      letter-spacing: 0;
    }

    @media (max-width: 430px) {
      .success-page { padding: 12px; }
      .success-card { gap: 14px; padding: 16px; }
      .success-head { gap: 10px; }
      .check { width: 50px; height: 50px; border-radius: 17px; font-size: 1.45rem; }
      .appointment-group { padding: 12px; border-radius: 18px; }
      .secondary-actions { grid-template-columns: 1fr; }
    }

    @media (hover: hover) and (pointer: fine) {
      .success-card:hover {
        transform: none;
        filter: none;
        box-shadow: var(--shadow-soft);
      }
    }
  `]
})
export class BookingSuccessPage {
  readonly booking = computed(() => this.marketplace.latestBooking());

  constructor(readonly marketplace: MarketplaceService) {
    addIcons({ calendarOutline, checkmarkDoneOutline, homeOutline });
  }

  bookingsLink(): string {
    return this.marketplace.salonMode() ? this.marketplace.salonModeUrl("bookings") : "/tabs/bookings";
  }

  homeLink(): string {
    return this.marketplace.salonMode() ? this.marketplace.salonModeUrl() : "/tabs/home";
  }

  addToCalendar(booking: Booking) {
    const start = this.bookingStart(booking);
    if (!start) return;
    const end = this.bookingEnd(booking, start);
    const params = new URLSearchParams({
      action: "TEMPLATE",
      text: `${booking.serviceName || "AuraSalon appointment"} at ${booking.businessName || "AuraSalon"}`,
      dates: `${this.calendarDate(start)}/${this.calendarDate(end)}`,
      details: this.calendarDescription(booking),
      location: booking.address || booking.businessName || ""
    });
    window.open(`https://calendar.google.com/calendar/render?${params.toString()}`, "_blank", "noopener,noreferrer");
  }

  private bookingStart(booking: Booking): Date | null {
    const value = String(booking.startAt || booking.startsAt || "");
    const date = value ? new Date(value) : null;
    return date && !Number.isNaN(date.getTime()) ? date : null;
  }

  private bookingEnd(_booking: Booking, start: Date): Date {
    const explicitEnd = String(_booking.endAt || _booking.endsAt || "");
    const explicitEndDate = explicitEnd ? new Date(explicitEnd) : null;
    if (explicitEndDate && !Number.isNaN(explicitEndDate.getTime()) && explicitEndDate > start) {
      return explicitEndDate;
    }
    const duration = Number(_booking.durationMinutes || _booking.serviceDurationMinutes || 60);
    const safeDuration = Number.isFinite(duration) && duration > 0 ? Math.min(duration, 12 * 60) : 60;
    return new Date(start.getTime() + safeDuration * 60000);
  }

  private calendarDate(date: Date): string {
    return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  }

  private calendarDescription(booking: Booking): string {
    return [
      booking.serviceName ? `Service: ${booking.serviceName}` : "",
      booking.staffName ? `Staff: ${booking.staffName}` : "",
      booking.businessName ? `Salon: ${booking.businessName}` : "",
      booking.reference ? `Reference: ${booking.reference}` : "",
      "Booked with AuraSalon"
    ].filter(Boolean).join("\n");
  }
}
