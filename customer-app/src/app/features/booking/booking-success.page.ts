import { Component, computed, signal } from "@angular/core";
import { RouterLink } from "@angular/router";
import { IonButton, IonContent, IonIcon } from "@ionic/angular/standalone";
import { addIcons } from "ionicons";
import { calendarOutline, checkmarkDoneOutline, checkmarkOutline, copyOutline, homeOutline, navigateOutline } from "ionicons/icons";
import { Booking } from "../../core/api.types";
import { MarketplaceService } from "../../core/marketplace.service";

interface SuccessServiceRow {
  name: string;
  staff: string;
  durationMinutes: number;
  pricePaise: number;
  startIso: string;
  endIso: string;
  timeLabel: string;
}

interface SuccessContext {
  services: SuccessServiceRow[];
  title: string;
  statusLabel: string;
  address: string;
  reference: string;
  referenceLabel: string;
  visitRange: string;
  dueLabel: string;
  cancellationCutoff: string;
  startIso: string;
  endIso: string;
  businessName: string;
}

interface SuccessState {
  services?: Array<{
    name?: string;
    staff?: string;
    durationMinutes?: number;
    pricePaise?: number;
    startIso?: string;
    endIso?: string;
  }>;
  businessName?: string;
  area?: string;
  city?: string;
  address?: string;
  reference?: string;
  status?: string;
  startIso?: string;
  endIso?: string;
  dueLabel?: string;
  paymentMode?: string;
}

@Component({
  standalone: true,
  imports: [RouterLink, IonButton, IonContent, IonIcon],
  template: `
    <ion-content>
      <main class="success-page">
        @if (display(); as ctx) {
        <section class="success-card premium-card">
          <header class="success-head">
            <div class="check"><ion-icon name="checkmark-done-outline"></ion-icon></div>
            <div>
              <p class="eyebrow">Booking {{ ctx.statusLabel }}</p>
              <h1>Appointment confirmed</h1>
              <p class="muted">{{ ctx.title }}</p>
            </div>
          </header>

          <section class="appointment-group" aria-label="Appointment information">
            @if (ctx.services.length > 1) {
              <div class="multi-service-title">
                <span>Your booked services</span>
                <strong>{{ ctx.services.length }} services · {{ ctx.visitRange }}</strong>
              </div>
              <ol class="service-list">
                @for (service of ctx.services; track service.name + service.startIso; let idx = $index) {
                  <li class="service-row">
                    <span class="seq-num">{{ idx + 1 }}</span>
                    <div class="service-copy">
                      <strong>{{ service.name }}</strong>
                      <small>with {{ service.staff }} · {{ service.durationMinutes }} min</small>
                    </div>
                    <span class="service-time">{{ service.timeLabel }}</span>
                  </li>
                }
              </ol>
            } @else {
              <div class="appointment-primary">
                <span>Service</span>
                <strong>{{ ctx.services[0].name }}</strong>
                <small>with {{ ctx.services[0].staff }} · {{ ctx.services[0].durationMinutes }} min</small>
              </div>
            }
            <dl class="summary-list">
              <div><dt>Time</dt><dd>{{ ctx.visitRange }}</dd></div>
              <div><dt>Address</dt><dd class="address-cell">{{ ctx.address }}</dd></div>
              <div class="ref-row">
                <dt>Reference</dt>
                <dd>
                  <span class="ref-value">{{ ctx.referenceLabel }}</span>
                  <button type="button" class="copy-ref" (click)="copyReference()" [attr.aria-label]="'Copy booking reference'">
                    <ion-icon [name]="copied() ? 'checkmark-outline' : 'copy-outline'" aria-hidden="true"></ion-icon>
                    {{ copied() ? "Copied" : "Copy" }}
                  </button>
                </dd>
              </div>
            </dl>
          </section>

          <section class="info-grid" aria-label="Payment and policies">
            <div class="info-cell">
              <span>Payment</span>
              <strong>{{ ctx.dueLabel || "₹0" }} due at salon</strong>
              <small>Paid online ₹0 · No online payment required</small>
            </div>
            <div class="info-cell">
              <span>Cancellation</span>
              <strong>Free until {{ ctx.cancellationCutoff }}</strong>
              <small>Reschedule free up to 1 hour before</small>
            </div>
          </section>

          <div class="actions">
            <ion-button expand="block" class="primary-gradient" [routerLink]="bookingsLink()">View booking</ion-button>
            <div class="action-grid">
              <button type="button" class="secondary-action" (click)="openDirections(ctx)">
                <ion-icon name="navigate-outline" aria-hidden="true"></ion-icon> Directions
              </button>
              <button type="button" class="secondary-action" (click)="addToCalendar(ctx)">
                <ion-icon name="calendar-outline" aria-hidden="true"></ion-icon> Add to calendar
              </button>
              <button type="button" class="secondary-action" (click)="copyReference()">
                <ion-icon [name]="copied() ? 'checkmark-outline' : 'copy-outline'" aria-hidden="true"></ion-icon>
                {{ copied() ? "Copied" : "Copy reference" }}
              </button>
              <a class="secondary-action" [routerLink]="homeLink()">
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

    .action-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 8px;
    }

    .action-grid button,
    .action-grid a {
      min-height: 44px;
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
      cursor: pointer;
    }

    .action-grid ion-icon { font-size: 1.05rem; }

    .multi-service-title {
      display: grid;
      gap: 2px;
      padding-bottom: 10px;
      border-bottom: 1px solid var(--border);
    }

    .multi-service-title span {
      color: var(--primary);
      font-size: 0.68rem;
      font-weight: 950;
      letter-spacing: 0.08em;
      text-transform: uppercase;
    }

    .multi-service-title strong { font-size: 1.02rem; }

    .service-list {
      display: grid;
      gap: 8px;
      margin: 0;
      padding: 0;
      list-style: none;
    }

    .service-row {
      display: flex;
      align-items: center;
      gap: 10px;
    }

    .seq-num {
      width: 24px;
      height: 24px;
      display: grid;
      place-items: center;
      flex: 0 0 auto;
      border-radius: 999px;
      color: #ffffff;
      background: var(--primary);
      font-size: 0.76rem;
      font-weight: 950;
    }

    .service-copy {
      min-width: 0;
      display: grid;
      gap: 1px;
      flex: 1 1 auto;
    }

    .service-copy strong {
      overflow: hidden;
      font-size: 0.92rem;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .service-copy small { color: var(--muted); font-weight: 800; font-size: 0.78rem; }

    .service-time {
      flex: 0 0 auto;
      font-size: 0.8rem;
      font-weight: 950;
      color: var(--primary);
    }

    .address-cell { line-height: 1.35; }

    .ref-row dd {
      display: inline-flex;
      align-items: center;
      justify-content: flex-end;
      gap: 8px;
    }

    .ref-value { font-size: 0.88rem; }

    .copy-ref {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 4px 10px;
      border: 1px solid var(--border);
      border-radius: 999px;
      color: var(--primary);
      background: var(--glass);
      font: inherit;
      font-size: 0.74rem;
      font-weight: 950;
      cursor: pointer;
    }

    .copy-ref ion-icon { font-size: 0.9rem; }

    .info-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 10px;
    }

    .info-cell {
      display: grid;
      gap: 3px;
      padding: 12px;
      border: 1px solid var(--border);
      border-radius: 16px;
      background: var(--surface-soft);
    }

    .info-cell span {
      color: var(--muted);
      font-size: 0.64rem;
      font-weight: 950;
      letter-spacing: 0.08em;
      text-transform: uppercase;
    }

    .info-cell strong { font-size: 0.92rem; line-height: 1.2; }

    .info-cell small { color: var(--muted); font-size: 0.74rem; font-weight: 800; }

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
      .info-grid { grid-template-columns: 1fr; }
      .action-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .ref-row dd { flex-wrap: wrap; }
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
  readonly copied = signal(false);
  private persistedState: SuccessState | null | undefined;

  constructor(readonly marketplace: MarketplaceService) {
    addIcons({ calendarOutline, checkmarkDoneOutline, checkmarkOutline, copyOutline, homeOutline, navigateOutline });
  }

  /** Router state is lost on refresh; fall back to the session-persisted confirmation context. */
  private readPersistedState(): SuccessState | null {
    if (this.persistedState !== undefined) return this.persistedState;
    try {
      const raw = sessionStorage.getItem("aura_booking_success");
      this.persistedState = raw ? (JSON.parse(raw) as SuccessState) : null;
    } catch {
      this.persistedState = null;
    }
    return this.persistedState;
  }

  /** Full appointment context: router state from the booking flow, with session-persisted and single-booking fallbacks. */
  readonly display = computed<SuccessContext | null>(() => {
    const state = (history.state ?? {}) as SuccessState;
    const persisted = this.readPersistedState();
    const effective = state && Array.isArray(state.services) && state.services.length ? state : persisted;
    if (effective && Array.isArray(effective.services) && effective.services.length) {
      const stateServices = effective.services;
      const services: SuccessServiceRow[] = stateServices.map((row) => ({
        name: row.name || "Service",
        staff: row.staff || "Any available professional",
        durationMinutes: Number(row.durationMinutes ?? 0),
        pricePaise: Number(row.pricePaise ?? 0),
        startIso: row.startIso || "",
        endIso: row.endIso || "",
        timeLabel: this.formatTime(row.startIso || "")
      }));
      const booking = this.booking();
      const businessName = effective.businessName || booking?.businessName || "";
      const area = effective.area || "";
      const city = effective.city || "";
      const address = effective.address || booking?.address || (area ? `${area}${city ? ", " + city : ""}` : businessName || "Salon address");
      const reference = effective.reference || booking?.reference || "";
      const startIso = effective.startIso || services[0]?.startIso || "";
      const endIso = effective.endIso || services[services.length - 1]?.endIso || "";
      const location = area || businessName || "the salon";
      return {
        services,
        title: `${services.length} service${services.length === 1 ? "" : "s"} at ${location}`,
        statusLabel: this.statusLabel(effective.status || booking?.status || "confirmed"),
        address,
        reference,
        referenceLabel: this.referenceLabel(reference),
        visitRange: this.visitRange(startIso, endIso),
        dueLabel: effective.dueLabel || "",
        cancellationCutoff: this.cancellationCutoff(startIso),
        startIso,
        endIso,
        businessName
      };
    }

    const booking = this.booking();
    if (!booking) return null;
    const start = this.bookingStart(booking);
    const startIso = start ? start.toISOString() : "";
    const end = start ? this.bookingEnd(booking, start) : null;
    const endIso = end ? end.toISOString() : "";
    const services: SuccessServiceRow[] = [{
      name: booking.serviceName,
      staff: booking.staffName || "Any available professional",
      durationMinutes: Number(booking.durationMinutes || booking.serviceDurationMinutes || 0),
      pricePaise: 0,
      startIso,
      endIso,
      timeLabel: this.formatTime(startIso)
    }];
    const reference = booking.reference || "";
    return {
      services,
      title: booking.businessName,
      statusLabel: this.statusLabel(booking.status),
      address: booking.address || booking.businessName || "Salon address",
      reference,
      referenceLabel: this.referenceLabel(reference),
      visitRange: this.visitRange(startIso, endIso),
      dueLabel: "",
      cancellationCutoff: this.cancellationCutoff(startIso),
      startIso,
      endIso,
      businessName: booking.businessName
    };
  });

  bookingsLink(): string {
    return this.marketplace.salonMode() ? this.marketplace.salonModeUrl("bookings") : "/tabs/bookings";
  }

  homeLink(): string {
    return this.marketplace.salonMode() ? this.marketplace.salonModeUrl() : "/tabs/home";
  }

  async copyReference() {
    const ctx = this.display();
    if (!ctx?.reference) return;
    try {
      await navigator.clipboard.writeText(ctx.reference);
      this.copied.set(true);
      window.setTimeout(() => this.copied.set(false), 1600);
    } catch {
      this.copied.set(false);
    }
  }

  openDirections(ctx: SuccessContext) {
    const booking = this.booking();
    const lat = booking?.latitude;
    const lng = booking?.longitude;
    const destination = (typeof lat === "number" && typeof lng === "number")
      ? `${lat},${lng}`
      : ctx.address;
    window.open(`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destination)}`, "_blank", "noopener,noreferrer");
  }

  addToCalendar(ctx: SuccessContext) {
    if (!ctx.startIso) return;
    const start = new Date(ctx.startIso);
    if (!Number.isFinite(start.getTime())) return;
    const endDate = new Date(ctx.endIso);
    const end = Number.isFinite(endDate.getTime()) && endDate > start ? endDate : start;
    const params = new URLSearchParams({
      action: "TEMPLATE",
      text: `${ctx.title} at ${ctx.businessName || "AuraSalon"}`,
      dates: `${this.calendarDate(start)}/${this.calendarDate(end)}`,
      details: this.calendarDescription(ctx),
      location: ctx.address || ctx.businessName || ""
    });
    window.open(`https://calendar.google.com/calendar/render?${params.toString()}`, "_blank", "noopener,noreferrer");
  }

  private statusLabel(status: string): string {
    return status ? status.charAt(0).toUpperCase() + status.slice(1) : "Confirmed";
  }

  private referenceLabel(reference: string): string {
    const raw = reference.replace(/^#+/, "").trim();
    return raw ? `Booking #${raw}` : "Booking reference";
  }

  private formatTime(value: string): string {
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return "Time confirmed at salon";
    return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  }

  private visitRange(startIso: string, endIso: string): string {
    const start = new Date(startIso);
    if (!Number.isFinite(start.getTime())) return "Time confirmed at salon";
    const end = new Date(endIso);
    if (!Number.isFinite(end.getTime()) || end <= start) return this.formatTime(startIso);
    if (start.toDateString() === end.toDateString()) {
      return `${this.formatTime(startIso)} – ${this.formatTime(endIso)}`;
    }
    const dayLabel = (date: Date) => date.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });
    return `${dayLabel(start)} ${this.formatTime(startIso)} – ${dayLabel(end)} ${this.formatTime(endIso)}`;
  }

  private cancellationCutoff(startIso: string): string {
    const start = new Date(startIso);
    if (!Number.isFinite(start.getTime())) return "appointment time";
    const cutoff = new Date(start.getTime() - 2 * 60 * 60 * 1000);
    if (cutoff.getTime() <= Date.now()) return "appointment time";
    return `${cutoff.toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" })}, ${this.formatTime(cutoff.toISOString())}`;
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

  private calendarDescription(ctx: SuccessContext): string {
    const serviceLines = ctx.services.map((service, idx) => `${idx + 1}. ${service.name} — ${service.timeLabel} with ${service.staff}`);
    return [
      ...serviceLines,
      ctx.reference ? `Reference: ${ctx.reference}` : "",
      ctx.address ? `Address: ${ctx.address}` : "",
      "Booked with AuraSalon"
    ].filter(Boolean).join("\n");
  }
}
