import { Component, OnInit, computed, signal } from "@angular/core";
import { ActivatedRoute, RouterLink } from "@angular/router";
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
          <div class="check"><ion-icon name="checkmark-done-outline"></ion-icon></div>
          <p class="eyebrow">Booking {{ booking.status }}</p>
          <h1>{{ booking.businessName }}</h1>
          <p class="muted">{{ booking.serviceName }} with {{ booking.staffName }}</p>
          <div class="summary-list">
            <div><span>Time</span><strong>{{ booking.displayStartAt || booking.startsAt || booking.startAt }}</strong></div>
            <div><span>Address</span><strong>{{ booking.address }}</strong></div>
            <div><span>Reference</span><strong>{{ booking.reference }}</strong></div>
          </div>
          <div class="actions">
            @if (booking.paymentStatus === 'pending') {
              <ion-button expand="block" class="primary-gradient" [disabled]="marketplace.loading()" (click)="openPayment(booking)">Pay deposit</ion-button>
            }
            <ion-button expand="block" class="primary-gradient" [routerLink]="['/bookings', booking.id]">View booking</ion-button>
            <ion-button expand="block" fill="outline" class="secondary-button" (click)="addToCalendar(booking)">
              <ion-icon name="calendar-outline" slot="start"></ion-icon>
              Add to Google Calendar
            </ion-button>
            <ion-button expand="block" fill="clear" class="home-button" routerLink="/tabs/home">
              <ion-icon name="home-outline" slot="start"></ion-icon>
              Back home
            </ion-button>
          </div>
        </section>
        } @else if (marketplace.loading()) {
          <section class="success-card premium-card"><h1>Loading booking</h1></section>
        } @else {
          <section class="success-card premium-card">
            <h1>Booking unavailable</h1>
            <p class="muted">{{ actionError() || marketplace.error() || "This booking could not be loaded." }}</p>
            @if (bookingId()) {
              <ion-button expand="block" class="primary-gradient" (click)="reload()">Retry</ion-button>
            }
            <ion-button expand="block" class="primary-gradient" routerLink="/tabs/bookings">View bookings</ion-button>
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
      padding: 24px;
      background: var(--app-bg);
    }

    .success-card {
      width: min(560px, 100%);
      padding: 24px;
      border-color: var(--border) !important;
      background: var(--surface) !important;
      box-shadow: var(--shadow-soft) !important;
      text-align: center;
      animation-name: aura-card-in;
      animation-duration: var(--motion-slow);
      animation-iteration-count: 1;
      transform: none !important;
    }

    .check {
      width: 86px;
      height: 86px;
      display: grid;
      place-items: center;
      margin: 0 auto 18px;
      border-radius: 24px;
      color: #ffffff;
      background: linear-gradient(135deg, var(--primary), var(--accent));
      box-shadow: 0 16px 34px rgba(11, 79, 138, 0.22);
      font-size: 2.35rem;
    }

    h1 {
      margin: 0 0 8px;
      font-size: clamp(1.65rem, 5vw, 2.5rem);
      letter-spacing: -0.04em;
      line-height: 1.05;
    }

    .summary-list {
      display: grid;
      gap: 0;
      margin: 22px 0;
      text-align: left;
    }

    .summary-list div {
      display: flex;
      justify-content: space-between;
      gap: 18px;
      padding: 15px 0;
      border-bottom: 1px solid var(--border);
    }

    .summary-list span {
      color: var(--muted);
      font-weight: 800;
    }

    .summary-list strong {
      text-align: right;
    }

    .actions {
      display: grid;
      gap: 8px;
    }

    .home-button {
      --color: var(--primary);
      --color-activated: var(--primary-2);
      --background-hover: var(--accent-2);
      --background-activated: var(--accent-2);
      margin-top: 8px;
      font-weight: 900;
      letter-spacing: 0;
    }

    @media (hover: hover) and (pointer: fine) {
      .success-card:hover {
        transform: none !important;
        filter: none !important;
        box-shadow: var(--shadow-soft) !important;
      }
    }
  `]
})
export class BookingSuccessPage implements OnInit {
  readonly bookingId = signal(this.route.snapshot.queryParamMap.get("id") || "");
  readonly booking = computed(() => this.marketplace.findBooking(this.bookingId() || null));
  readonly actionError = signal("");

  constructor(private readonly route: ActivatedRoute, readonly marketplace: MarketplaceService) {
    addIcons({ calendarOutline, checkmarkDoneOutline, homeOutline });
  }

  ngOnInit() {
    void this.reload();
  }

  async reload() {
    const id = this.bookingId();
    if (!id || this.booking()?.id === id) return;
    this.actionError.set("");
    await this.marketplace.loadBooking(id).catch(() => undefined);
  }

  async openPayment(booking: Booking) {
    this.actionError.set("");
    let url = booking.paymentUrl || "";
    if (!url) {
      const payment = await this.marketplace.createBookingPaymentLink(booking.id).catch(() => null);
      url = payment?.url || payment?.shortUrl || "";
    }
    if (!url) {
      this.actionError.set(this.marketplace.error() || "Secure payment link is unavailable.");
      return;
    }
    window.open(url, "_blank", "noopener,noreferrer");
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
