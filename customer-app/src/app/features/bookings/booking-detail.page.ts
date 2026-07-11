import { Component, OnInit, computed, signal } from "@angular/core";
import { ActivatedRoute } from "@angular/router";
import { AlertController, IonBackButton, IonButton, IonButtons, IonContent, IonHeader, IonIcon, IonToolbar } from "@ionic/angular/standalone";
import { addIcons } from "ionicons";
import { cardOutline, checkmarkCircleOutline, downloadOutline, locationOutline, timeOutline } from "ionicons/icons";
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
            <ion-button expand="block" fill="outline" class="secondary-button" (click)="downloadInvoice($event)">
              <ion-icon name="download-outline" slot="start"></ion-icon>
              Download invoice
            </ion-button>
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
    .detail-actions {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 10px;
      margin-top: 4px;
    }

    .detail-actions ion-button {
      min-height: 46px;
      margin: 0;
    }

    @media (max-width: 599px) {
      .detail-actions {
        grid-template-columns: 1fr;
        gap: 8px;
      }

      .detail-actions ion-button {
        width: 100%;
      }
    }

    @media (min-width: 900px) {
      .detail-page {
        max-width: 760px;
      }

      .detail-actions {
        grid-template-columns: repeat(3, minmax(0, 1fr));
      }
    }
  `]
})
export class BookingDetailPage implements OnInit {
  private readonly id = signal(this.route.snapshot.paramMap.get("id"));
  readonly booking = computed(() => this.marketplace.findBooking(this.id()));

  constructor(private readonly route: ActivatedRoute, readonly marketplace: MarketplaceService, private readonly alerts: AlertController) {
    addIcons({ cardOutline, checkmarkCircleOutline, downloadOutline, locationOutline, timeOutline });
  }

  ngOnInit() {
    this.reload();
  }

  reload() {
    const id = this.id();
    if (id) void this.marketplace.loadBooking(id).catch(() => undefined);
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
