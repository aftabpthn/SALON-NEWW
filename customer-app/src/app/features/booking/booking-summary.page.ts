import { Component, computed } from "@angular/core";
import { RouterLink } from "@angular/router";
import { IonButton, IonContent, IonIcon } from "@ionic/angular/standalone";
import { addIcons } from "ionicons";
import { calendarOutline, checkmarkDoneOutline, shareSocialOutline, ticketOutline } from "ionicons/icons";
import { Booking, ServiceItem } from "../../core/api.types";
import { MarketplaceService } from "../../core/marketplace.service";

@Component({
  standalone: true,
  imports: [RouterLink, IonButton, IonContent, IonIcon],
  template: `
    <ion-content>
      <main class="page-narrow summary-page">
        <section class="summary-hero premium-card">
          <span class="hero-icon"><ion-icon name="checkmark-done-outline"></ion-icon></span>
          <h1>Review your appointment</h1>
        </section>

        @if (booking(); as booking) {
          <section class="premium-card summary-card">
            <div class="summary-heading">
              <div>
                <h2>{{ booking.businessName }}</h2>
                <p class="muted">{{ booking.serviceName }} with {{ booking.staffName || "Any available professional" }}</p>
              </div>
              <span class="status-pill">{{ booking.status }}</span>
            </div>

            <dl class="summary-list">
              <div><dt>Business</dt><dd>{{ booking.businessName }}</dd></div>
              <div><dt>Service</dt><dd>{{ booking.serviceName }}</dd></div>
              <div><dt>Staff</dt><dd>{{ booking.staffName || "Any available professional" }}</dd></div>
              <div><dt>Date & time</dt><dd>{{ displayTime(booking) }}</dd></div>
              <div><dt>Address</dt><dd>{{ booking.address || "Address will appear after confirmation" }}</dd></div>
              <div><dt>Booking ID</dt><dd>{{ booking.reference || booking.id }}</dd></div>
              <div><dt>Payment status</dt><dd>{{ paymentLabel(booking.paymentStatus) }}</dd></div>
            </dl>
          </section>

          <section class="premium-card price-card">
            <div><span>Service price</span><strong>{{ money(servicePricePaise()) }}</strong></div>
            <div><span>Estimated taxes</span><strong>{{ taxLabel() }}</strong></div>
            <div class="total-row"><span>Estimated total</span><strong>{{ money(totalPaise()) }}</strong></div>
          </section>

          <section class="premium-card policy-card">
            <ion-icon name="ticket-outline"></ion-icon>
            <div>
              <h2>Cancellation policy</h2>
              <p class="muted">{{ booking.cancellationPolicy || "Free cancellation and reschedule rules depend on the business policy returned with this booking." }}</p>
            </div>
          </section>

          <section class="summary-actions" aria-label="Booking actions">
            <ion-button expand="block" class="primary-gradient" [routerLink]="['/bookings', booking.id]">View booking</ion-button>
            <ion-button expand="block" fill="outline" class="secondary-button" (click)="addToCalendar(booking)">
              <ion-icon name="calendar-outline" slot="start"></ion-icon>
              Add to calendar
            </ion-button>
            <ion-button expand="block" fill="outline" class="secondary-button" (click)="shareBooking(booking)">
              <ion-icon name="share-social-outline" slot="start"></ion-icon>
              Share
            </ion-button>
          </section>
        } @else {
          <section class="premium-card empty-state">
            <h2>No booking loaded</h2>
            <ion-button class="primary-gradient" routerLink="/tabs/search">Discover salons</ion-button>
          </section>
        }
      </main>
    </ion-content>
  `,
  styles: [`
    .summary-page {
      display: grid;
      gap: 14px;
    }

    .summary-hero,
    .summary-card,
    .price-card,
    .policy-card,
    .empty-state {
      padding: 22px;
    }

    .summary-hero {
      display: grid;
      justify-items: center;
      text-align: center;
    }

    .hero-icon {
      width: 68px;
      height: 68px;
      display: grid;
      place-items: center;
      margin-bottom: 12px;
      border-radius: 24px;
      color: #120D05;
      background: linear-gradient(135deg, #F4D58D, #D6A94A, #9B6B22);
      font-size: 1.8rem;
      box-shadow: 0 18px 38px rgba(214, 169, 74, 0.26);
    }

    .summary-hero h1,
    .summary-heading h2,
    .policy-card h2,
    .empty-state h2 {
      margin: 0;
      letter-spacing: 0;
    }

    .summary-hero h1 {
      font-size: clamp(2rem, 6vw, 3.8rem);
      line-height: 0.98;
    }

    .summary-heading {
      display: flex;
      align-items: start;
      justify-content: space-between;
      gap: 14px;
      margin-bottom: 10px;
    }

    .summary-heading .muted,
    .summary-hero .muted,
    .policy-card p,
    .empty-state p {
      margin: 8px 0 0;
    }

    .summary-list {
      display: grid;
      margin: 0;
    }

    .summary-list div,
    .price-card div {
      display: grid;
      grid-template-columns: minmax(110px, 0.8fr) minmax(0, 1.2fr);
      gap: 14px;
      padding: 14px 0;
      border-bottom: 1px solid var(--border);
    }

    .summary-list div:last-child,
    .price-card div:last-of-type {
      border-bottom: 0;
    }

    dt,
    .price-card span {
      color: var(--muted);
      font-weight: 900;
    }

    dd,
    .price-card strong {
      margin: 0;
      color: var(--text);
      font-weight: 900;
      text-align: right;
      overflow-wrap: anywhere;
    }

    .total-row {
      font-size: 1.15rem;
    }

    .price-card p {
      margin: 10px 0 0;
      font-size: 0.86rem;
    }

    .policy-card {
      display: grid;
      grid-template-columns: auto minmax(0, 1fr);
      gap: 14px;
      align-items: start;
    }

    .policy-card ion-icon {
      width: 48px;
      height: 48px;
      padding: 12px;
      border-radius: 18px;
      color: #120D05;
      background: linear-gradient(135deg, #F4D58D, #D6A94A);
    }

    .summary-actions {
      display: grid;
      gap: 10px;
    }

    @media (max-width: 599px) {
      .summary-heading,
      .summary-list div,
      .price-card div {
        grid-template-columns: 1fr;
      }

      dd,
      .price-card strong {
        text-align: left;
      }
    }
  `]
})
export class BookingSummaryPage {
  readonly booking = computed(() => this.marketplace.latestBooking());
  readonly service = computed(() => this.findService(this.booking()));
  readonly servicePricePaise = computed(() => this.service()?.pricePaise ?? 0);
  readonly taxPaise = computed(() => this.servicePricePaise() > 0 ? Math.round(this.servicePricePaise() * 0.18) : 0);
  readonly totalPaise = computed(() => this.servicePricePaise() + this.taxPaise());

  constructor(private readonly marketplace: MarketplaceService) {
    addIcons({ calendarOutline, checkmarkDoneOutline, shareSocialOutline, ticketOutline });
  }

  displayTime(booking: Booking): string {
    return booking.displayStartAt || booking.startsAt || booking.startAt || "Time will appear after confirmation";
  }

  paymentLabel(status: Booking["paymentStatus"]): string {
    if (status === "paid") return "Paid";
    if (status === "pending") return "Payment pending";
    if (status === "refunded") return "Refunded";
    return "Pay at venue";
  }

  taxLabel(): string {
    return this.taxPaise() > 0 ? this.money(this.taxPaise()) : "Calculated at checkout";
  }

  money(pricePaise: number): string {
    return pricePaise > 0 ? this.marketplace.formatMoney(pricePaise) : "Shown at checkout";
  }

  addToCalendar(booking: Booking) {
    const start = this.dateForCalendar(booking.startAt || booking.startsAt);
    const end = this.dateForCalendar(booking.endAt || booking.endsAt) || this.dateForCalendar(booking.startAt || booking.startsAt, booking.durationMinutes || booking.serviceDurationMinutes || 60);
    const params = new URLSearchParams({
      action: "TEMPLATE",
      text: `${booking.serviceName} at ${booking.businessName}`,
      details: `Booking reference: ${booking.reference || booking.id}\nStaff: ${booking.staffName || "Any available professional"}\nPayment: ${this.paymentLabel(booking.paymentStatus)}`,
      location: booking.address || booking.businessName
    });
    if (start && end) params.set("dates", `${start}/${end}`);
    window.open(`https://calendar.google.com/calendar/render?${params.toString()}`, "_blank", "noopener,noreferrer");
  }

  async shareBooking(booking: Booking) {
    const text = `${booking.serviceName} at ${booking.businessName} on ${this.displayTime(booking)}. Reference ${booking.reference || booking.id}.`;
    if (navigator.share) {
      await navigator.share({ title: "AuraSalon booking", text }).catch(() => undefined);
      return;
    }
    await navigator.clipboard?.writeText(text).catch(() => undefined);
  }

  private findService(booking: Booking | null): ServiceItem | null {
    if (!booking?.serviceId) return null;
    return this.marketplace.selectedBusiness()?.services.find((service) => service.id === booking.serviceId) ?? null;
  }

  private dateForCalendar(value?: string, addMinutes = 0): string {
    if (!value) return "";
    const time = new Date(value).getTime();
    if (!Number.isFinite(time)) return "";
    const date = new Date(time + addMinutes * 60_000);
    return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  }
}
