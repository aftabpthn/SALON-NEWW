import { Component, OnInit, computed, signal } from "@angular/core";
import { ActivatedRoute } from "@angular/router";
import { AlertController, IonBackButton, IonButton, IonButtons, IonContent, IonHeader, IonIcon, IonToolbar } from "@ionic/angular/standalone";
import { addIcons } from "ionicons";
import { cardOutline, checkmarkCircleOutline, locationOutline, timeOutline } from "ionicons/icons";
import { MarketplaceService } from "../../core/marketplace.service";

@Component({
  standalone: true,
  imports: [IonBackButton, IonButton, IonButtons, IonContent, IonHeader, IonIcon, IonToolbar],
  template: `
    <ion-header class="ion-no-border">
      <ion-toolbar>
        <ion-buttons slot="start"><ion-back-button defaultHref="/tabs/bookings"></ion-back-button></ion-buttons>
      </ion-toolbar>
    </ion-header>
    <ion-content>
      @if (booking(); as booking) {
        <main class="page-narrow detail-page">
          <h1 class="page-title">{{ booking.serviceName }}</h1>
          <section class="hero-card premium-card">
            <span class="status-pill" [class.closed]="booking.status === 'cancelled'">{{ booking.status }}</span>
            <h2>{{ booking.businessName }}</h2>
            <p class="muted">Reference {{ booking.reference }}</p>
          </section>

          <section class="timeline premium-card">
            <div><ion-icon name="checkmark-circle-outline"></ion-icon><span>Booking created</span><strong>{{ booking.reference }}</strong></div>
            <div><ion-icon name="time-outline"></ion-icon><span>Appointment time</span><strong>{{ booking.displayStartAt || booking.startsAt || booking.startAt }}</strong></div>
            <div><ion-icon name="location-outline"></ion-icon><span>Venue</span><strong>{{ booking.address }}</strong></div>
            <div><ion-icon name="card-outline"></ion-icon><span>Payment</span><strong>{{ booking.paymentStatus || "Pay at venue" }}</strong></div>
          </section>

          <section class="premium-card policy">
            <h2>Cancellation policy</h2>
            <p class="muted">{{ booking.cancellationPolicy || "The business policy will appear here when returned by the API." }}</p>
          </section>

          <div class="detail-actions">
            <ion-button expand="block" class="primary-gradient" (click)="reschedule()">Reschedule</ion-button>
            <ion-button expand="block" fill="outline" color="danger" (click)="cancel()">Cancel booking</ion-button>
          </div>
        </main>
      } @else {
        <main class="page-narrow detail-page">
          @if (marketplace.loading()) {
            <section class="premium-card hero-card"><h1>Loading booking</h1></section>
          } @else {
            <section class="premium-card hero-card"><h1>Booking unavailable</h1><p class="muted">{{ marketplace.error() || "This booking could not be loaded." }}</p><ion-button class="primary-gradient" (click)="reload()">Retry</ion-button></section>
          }
        </main>
      }
    </ion-content>
  `,
  styles: [`
    .detail-page { display: grid; gap: 14px; }
    .hero-card { padding: 22px; }
    .hero-card h2 { margin: 14px 0 6px; font-size: 1.7rem; letter-spacing: -0.045em; }
    .timeline, .policy { padding: 18px; }
    .timeline { display: grid; gap: 0; }
    .timeline div { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; gap: 12px; align-items: center; padding: 15px 0; border-bottom: 1px solid var(--border); }
    .timeline div:last-child { border-bottom: 0; }
    .timeline ion-icon { color: var(--primary-2); font-size: 1.25rem; }
    .timeline span { color: var(--muted); font-weight: 800; }
    .timeline strong { text-align: right; }
    .policy h2 { margin: 0 0 8px; letter-spacing: -0.04em; }
    .detail-actions { display: grid; gap: 10px; margin-top: 4px; }
  `]
})
export class BookingDetailPage implements OnInit {
  private readonly id = signal(this.route.snapshot.paramMap.get("id"));
  readonly booking = computed(() => this.marketplace.findBooking(this.id()));

  constructor(private readonly route: ActivatedRoute, readonly marketplace: MarketplaceService, private readonly alerts: AlertController) {
    addIcons({ cardOutline, checkmarkCircleOutline, locationOutline, timeOutline });
  }

  ngOnInit() {
    this.reload();
  }

  reload() {
    const id = this.id();
    if (id) void this.marketplace.loadBooking(id).catch(() => undefined);
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
    const alert = await this.alerts.create({
      header: "Reschedule booking",
      message: "Enter the new backend-approved start time.",
      inputs: [
        {
          name: "startAt",
          type: "datetime-local",
          placeholder: "New start time"
        }
      ],
      buttons: [
        { text: "Not now", role: "cancel" },
        {
          text: "Reschedule",
          handler: (value: { startAt?: string }) => {
            if (!value.startAt) return false;
            void this.marketplace.rescheduleBooking(booking.id, { startAt: new Date(value.startAt).toISOString() });
            return true;
          }
        }
      ]
    });
    await alert.present();
  }

}
