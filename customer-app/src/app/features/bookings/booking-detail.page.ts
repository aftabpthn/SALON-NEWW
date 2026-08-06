import { Component, OnInit, computed, signal } from "@angular/core";
import { ActivatedRoute, Router } from "@angular/router";
import { AlertController, IonBackButton, IonButton, IonButtons, IonContent, IonHeader, IonIcon, IonToolbar } from "@ionic/angular/standalone";
import { addIcons } from "ionicons";
import { cardOutline, chatbubblesOutline, checkmarkCircleOutline, clipboardOutline, downloadOutline, logInOutline, locationOutline, receiptOutline, repeatOutline, timeOutline, walletOutline } from "ionicons/icons";
import { CustomerBookingCheckInPayload, CustomerProfileExtensionRecord } from "../../core/api.types";
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
            <div><ion-icon name="time-outline"></ion-icon><span>Appointment time</span><strong>{{ dateTimeLabel(booking.displayStartAt || booking.startsAt || booking.startAt) }}</strong></div>
            <div><ion-icon name="location-outline"></ion-icon><span>Venue</span><strong>{{ booking.address }}</strong></div>
            <div><ion-icon name="card-outline"></ion-icon><span>Payment</span><strong>{{ booking.paymentStatus || "Pay at venue" }}</strong></div>
          </section>

          <section class="premium-card policy">
            <h2>Cancellation policy</h2>
            <p class="muted">{{ booking.cancellationPolicy || "The business policy will appear here when returned by the API." }}</p>
          </section>

          <section class="premium-card contactless">
            <h2>Contactless journey</h2>
            <div class="journey-grid">
              <article>
                <span>Consent & safety</span>
                <strong>{{ booking.safetyFormSubmittedAt ? "Submitted" : "Required before sensitive services" }}</strong>
              </article>
              <article>
                <span>Patch/allergy context</span>
                <strong>{{ booking.allergies || booking.preferences ? "Saved" : "Not submitted" }}</strong>
              </article>
              <article>
                <span>Queue</span>
                <strong>{{ booking.queueStatus || "Not checked in" }}</strong>
              </article>
              <article>
                <span>Invoice</span>
                <strong>{{ booking.invoiceNumber || "Not raised yet" }}</strong>
              </article>
              <article>
                <span>Smart rebooking</span>
                <strong>{{ booking.smartRebookAfter ? "Suggested" : "Use quick rebook" }}</strong>
              </article>
            </div>
            @if (booking.invoiceBalancePaise && booking.invoiceBalancePaise > 0) {
              <p class="muted">Balance {{ money(booking.invoiceBalancePaise) }}{{ booking.tipPaise ? " · Tip included " + money(booking.tipPaise) : "" }}</p>
            }
            @if (booking.smartRebookAfter) {
              <p class="muted">Suggested after {{ dateLabel(booking.smartRebookAfter) }}. Final booking still needs a real slot confirmation.</p>
            }
            @if (actionMessage()) {
              <p class="action-message">{{ actionMessage() }}</p>
            }
          </section>

          @if (chatMessages().length) {
            <section class="premium-card booking-chat">
              <h2>Booking chat</h2>
              @for (message of chatMessages(); track message.id) {
                <article [class.customer]="message.authorType === 'customer'">
                  <span>{{ message.authorType || "salon" }}</span>
                  <p>{{ message.body || message.latestMessage || message.title }}</p>
                </article>
              }
            </section>
          }

          <div class="detail-actions">
            @if (booking.paymentStatus === "pending") {
              <ion-button expand="block" class="primary-gradient" (click)="openPayment($event)">
                <ion-icon name="card-outline" slot="start"></ion-icon>
                Pay deposit
              </ion-button>
            }
            <ion-button expand="block" fill="outline" class="secondary-button" (click)="submitContactless()">
              <ion-icon name="clipboard-outline" slot="start"></ion-icon>
              Consent form
            </ion-button>
            <ion-button expand="block" fill="outline" class="secondary-button" (click)="checkIn()">
              <ion-icon name="log-in-outline" slot="start"></ion-icon>
              Check in
            </ion-button>
            @if (booking.invoiceBalancePaise && booking.invoiceBalancePaise > 0) {
              <ion-button expand="block" class="primary-gradient" (click)="selfPay()">
                <ion-icon name="wallet-outline" slot="start"></ion-icon>
                Self-pay
              </ion-button>
            }
            <ion-button expand="block" fill="outline" class="secondary-button" (click)="downloadInvoice($event)">
              <ion-icon name="receipt-outline" slot="start"></ion-icon>
              Digital receipt
            </ion-button>
            <ion-button expand="block" fill="outline" class="secondary-button" (click)="openChat()">
              <ion-icon name="chatbubbles-outline" slot="start"></ion-icon>
              Booking chat
            </ion-button>
            @if (booking.businessId) {
              <ion-button expand="block" fill="outline" class="secondary-button" (click)="rebook()">
                <ion-icon name="repeat-outline" slot="start"></ion-icon>
                Rebook
              </ion-button>
              <ion-button expand="block" fill="outline" class="secondary-button" (click)="smartRebook()">
                <ion-icon name="repeat-outline" slot="start"></ion-icon>
                Smart rebook
              </ion-button>
            }
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
    ion-content { --background: var(--app-bg); }
    .detail-page { display: grid; gap: 14px; }
    .detail-page .premium-card { border-color: var(--border) !important; background: var(--surface) !important; box-shadow: var(--shadow-soft) !important; }
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
    .contactless { padding: 18px; display: grid; gap: 12px; }
    .contactless h2 { margin: 0; letter-spacing: -0.04em; }
    .journey-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
    .journey-grid article { border: 1px solid var(--border); border-radius: 18px; padding: 12px; background: rgba(255,255,255,0.72); }
    .journey-grid span { display: block; color: var(--muted); font-size: 0.78rem; font-weight: 800; }
    .journey-grid strong { display: block; margin-top: 5px; color: var(--ink); font-size: 0.92rem; }
    .action-message { margin: 0; color: var(--primary-2); font-weight: 800; }
    .booking-chat { display: grid; gap: 10px; padding: 18px; }
    .booking-chat h2 { margin: 0; letter-spacing: -0.04em; }
    .booking-chat article { width: fit-content; max-width: 86%; padding: 10px 12px; border: 1px solid var(--border); border-radius: 16px; background: #fff; }
    .booking-chat article.customer { justify-self: end; background: var(--accent-2); }
    .booking-chat span { color: var(--muted); font-size: 0.72rem; font-weight: 900; text-transform: uppercase; }
    .booking-chat p { margin: 4px 0 0; color: var(--ink); font-weight: 700; }
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

      .journey-grid {
        grid-template-columns: 1fr;
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
  readonly actionMessage = signal("");
  readonly chatMessages = signal<CustomerProfileExtensionRecord[]>([]);

  constructor(private readonly route: ActivatedRoute, private readonly router: Router, readonly marketplace: MarketplaceService, private readonly alerts: AlertController) {
    addIcons({ cardOutline, chatbubblesOutline, checkmarkCircleOutline, clipboardOutline, downloadOutline, logInOutline, locationOutline, receiptOutline, repeatOutline, timeOutline, walletOutline });
  }

  ngOnInit() {
    this.reload();
  }

  reload() {
    const id = this.id();
    if (!id) return;
    void this.marketplace.loadContactlessBooking(id)
      .then((booking) => this.loadChatMessages(booking.chatTicketId))
      .catch(() => undefined);
  }

  async openPayment(event: Event) {
    event.stopPropagation();
    const booking = this.booking();
    if (!booking) return;
    const existingUrl = booking.paymentUrl || "";
    const payment = existingUrl ? null : await this.marketplace.createBookingPaymentLink(booking.id).catch(() => null);
    const url = existingUrl || payment?.shortUrl || payment?.url || "";
    if (url) window.open(url, "_blank", "noopener,noreferrer");
  }

  money(value: number | undefined): string {
    return this.marketplace.formatMoney(value || 0);
  }

  dateLabel(value: string | undefined): string {
    if (!value) return "";
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
  }

  async submitContactless() {
    const booking = this.booking();
    if (!booking) return;
    const alert = await this.alerts.create({
      header: "Consent & safety",
      inputs: [
        { name: "allergies", type: "textarea", placeholder: "Allergies, sensitivity, patch-test context", value: booking.allergies || "" },
        { name: "preferences", type: "textarea", placeholder: "Goals, budget, timeframe, pregnancy or care preferences", value: booking.preferences || "" },
        { name: "signatureName", type: "text", placeholder: "Signature name" }
      ],
      buttons: [
        { text: "Cancel", role: "cancel" },
        {
          text: "Submit",
          handler: (value: { allergies?: string; preferences?: string; signatureName?: string }) => {
            if (!String(value.signatureName || "").trim()) return false;
            void this.marketplace.submitBookingContactlessForm(booking.id, {
              allergies: value.allergies || "",
              preferences: value.preferences || "",
              sensitivities: value.allergies || "",
              patchTestNotes: value.allergies || "",
              goals: value.preferences || "",
              consentAccepted: true,
              signatureName: String(value.signatureName || "")
            }).then(() => this.actionMessage.set("Consent and safety context saved."));
            return true;
          }
        }
      ]
    });
    await alert.present();
  }

  async checkIn() {
    const booking = this.booking();
    if (!booking) return;
    const alert = await this.alerts.create({
      header: "Check in",
      message: "Enter ETA in minutes. Use 0 when you have arrived.",
      inputs: [{ name: "etaMinutes", type: "number", placeholder: "ETA minutes", min: 0, max: 240 }],
      buttons: [
        { text: "Cancel", role: "cancel" },
        {
          text: "Check in",
          handler: (value: { etaMinutes?: string }) => {
            const eta = Number(value.etaMinutes || 0);
            if (!Number.isFinite(eta) || eta < 0 || eta > 240) return false;
            void this.checkInWithLocation(booking.id, Math.round(eta))
              .then(() => this.actionMessage.set(eta === 0 ? "You are checked in." : `ETA ${Math.round(eta)} minutes shared with the salon.`));
            return true;
          }
        }
      ]
    });
    await alert.present();
  }

  private async checkInWithLocation(bookingId: string, etaMinutes: number) {
    const payload: CustomerBookingCheckInPayload = { etaMinutes, idempotencyKey: crypto.randomUUID() };
    if (etaMinutes === 0 && "geolocation" in navigator) {
      const position = await new Promise<GeolocationPosition | null>((resolve) => navigator.geolocation.getCurrentPosition(resolve, () => resolve(null), { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 }));
      if (position) Object.assign(payload, { latitude: position.coords.latitude, longitude: position.coords.longitude, accuracyMeters: position.coords.accuracy });
    }
    return this.marketplace.checkInBooking(bookingId, payload);
  }

  async selfPay() {
    const booking = this.booking();
    const balance = booking?.invoiceBalancePaise || 0;
    if (!booking || balance <= 0) {
      this.actionMessage.set("No payable invoice balance is available.");
      return;
    }
    const alert = await this.alerts.create({
      header: "Self-pay",
      message: `Maximum payable balance is ${this.money(balance)}.`,
      inputs: [{ name: "amount", type: "number", placeholder: "Amount in rupees" }],
      buttons: [
        { text: "Cancel", role: "cancel" },
        {
          text: "Create link",
          handler: (value: { amount?: string }) => {
            const rupees = Number(value.amount || 0);
            const amountPaise = rupees > 0 ? Math.round(rupees * 100) : undefined;
            if (amountPaise && amountPaise > balance) return false;
            void this.marketplace.createBookingSelfPayLink(booking.id, { amountPaise }).then((payment) => {
              const url = payment.shortUrl || payment.url || "";
              this.actionMessage.set(url ? "Secure self-pay link is ready." : "Self-pay link created.");
              if (url) window.open(url, "_blank", "noopener,noreferrer");
            });
            return true;
          }
        }
      ]
    });
    await alert.present();
  }

  async openChat() {
    const booking = this.booking();
    if (!booking) return;
    const alert = await this.alerts.create({
      header: "Booking chat",
      inputs: [{ name: "body", type: "textarea", placeholder: "Message to salon" }],
      buttons: [
        { text: "Cancel", role: "cancel" },
        {
          text: "Send",
          handler: (value: { body?: string }) => {
            void this.marketplace.openBookingChat(booking.id, value.body || "")
              .then((ticket) => {
                this.actionMessage.set("Booking chat updated.");
                void this.loadChatMessages(ticket.id || this.booking()?.chatTicketId);
              });
            return true;
          }
        }
      ]
    });
    await alert.present();
  }

  private async loadChatMessages(ticketId: string | undefined) {
    if (!ticketId) {
      this.chatMessages.set([]);
      return;
    }
    const messages = await this.marketplace.listSupportMessages(ticketId).catch(() => []);
    this.chatMessages.set(messages);
  }

  async downloadInvoice(event: Event) {
    event.stopPropagation();
    const booking = this.booking();
    if (!booking) return;
    try {
      const html = await this.marketplace.loadBookingReceiptHtml(booking.id);
      const url = URL.createObjectURL(new Blob([html], { type: "text/html" }));
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = "aura-shine-" + String(booking.reference || booking.id) + ".html";
      anchor.click();
      URL.revokeObjectURL(url);
      this.actionMessage.set("API receipt downloaded.");
      return;
    } catch {
      this.actionMessage.set(this.marketplace.error() || "Digital receipt is unavailable.");
    }
  }

  dateTimeLabel(value: string | undefined): string {
    if (!value) return "";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return `${date.toLocaleDateString("en-IN", { day: "2-digit", month: "2-digit", year: "numeric" })} · ${date.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", hour12: true })}`;
  }

  async cancel() {
    const booking = this.booking();
    if (!booking) return;
    const alert = await this.alerts.create({
      header: "Cancel booking?",
      message: "This will call the customer booking cancellation API.",
      buttons: [
        { text: "Keep booking", role: "cancel" },
        { text: "Cancel booking", role: "destructive", handler: () => void this.confirmCancel(booking.id) }
      ]
    });
    await alert.present();
  }

  rebook() {
    const booking = this.booking();
    if (!booking?.businessId) return;
    void this.router.navigate(["/business", booking.businessId, "book"], {
      queryParams: {
        serviceId: booking.serviceId || undefined,
        staffId: booking.staffId || undefined,
        rebookFrom: booking.id
      }
    });
  }

  smartRebook() {
    const booking = this.booking();
    if (!booking?.businessId) return;
    void this.router.navigate(["/business", booking.businessId, "book"], {
      queryParams: {
        serviceId: booking.serviceId || undefined,
        staffId: booking.staffId || undefined,
        after: booking.smartRebookAfter || undefined,
        rebookFrom: booking.id,
        smart: "1"
      }
    });
  }

  async reschedule() {
    const booking = this.booking();
    if (!booking) return;
    void this.router.navigate(["/tabs/bookings"], { queryParams: { reschedule: booking.id } });
  }

  private async confirmCancel(id: string) {
    try {
      await this.marketplace.cancelBooking(id);
      this.actionMessage.set("Booking cancelled.");
      await this.marketplace.loadBooking(id);
    } catch {
      this.actionMessage.set(this.marketplace.error() || "Unable to cancel booking.");
    }
  }

}
