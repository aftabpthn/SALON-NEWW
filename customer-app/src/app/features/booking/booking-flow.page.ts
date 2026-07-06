import { Component, OnInit, computed, signal } from "@angular/core";
import { ActivatedRoute, Router } from "@angular/router";
import { IonBackButton, IonButton, IonButtons, IonContent, IonHeader, IonIcon, IonToolbar } from "@ionic/angular/standalone";
import { addIcons } from "ionicons";
import { calendarOutline, checkmarkCircleOutline, personOutline, sparklesOutline } from "ionicons/icons";
import { MarketplaceService } from "../../core/marketplace.service";
import { AvailabilityDay } from "../../core/api.types";

@Component({
  standalone: true,
  imports: [IonBackButton, IonButton, IonButtons, IonContent, IonHeader, IonIcon, IonToolbar],
  template: `
    <ion-header class="ion-no-border">
      <ion-toolbar>
        <ion-buttons slot="start"><ion-back-button defaultHref="/tabs/home"></ion-back-button></ion-buttons>
      </ion-toolbar>
    </ion-header>

    <ion-content>
      @if (business(); as business) {
        <main class="page booking-page">
          <section class="booking-hero premium-card">
            <img [src]="business.coverImage || 'assets/icons/icon.svg'" [alt]="business.businessName" />
            <div>
              <h1 class="page-title">Complete your appointment</h1>
              <p class="muted">{{ business.businessName }} · {{ business.area }} · Star {{ business.ratingAverage }}</p>
            </div>
          </section>

          @if (marketplace.error()) {
            <section class="state-card premium-card error"><h2>Booking data unavailable</h2><p>{{ marketplace.error() }}</p><ion-button class="primary-gradient" (click)="reload()">Retry</ion-button></section>
          }

          <div class="stepper" aria-label="Booking progress">
            @for (item of steps; track item.id) {
              <button type="button" [class.active]="step() === item.id" [class.done]="step() > item.id" (click)="step.set(item.id)">
                <ion-icon [name]="item.icon"></ion-icon>
                <span>{{ item.label }}</span>
              </button>
            }
          </div>

          @if (step() === 1) {
            <section class="panel">
              <div class="section-heading"><div><h2 class="section-title">Select service or bundle</h2></div></div>
              <div class="service-list">
                @for (service of business.services; track service.id) {
                  <button class="service-choice premium-card" [class.selected]="selectedServiceId() === service.id" (click)="setService(service.id)">
                    <div>
                      <h3>{{ service.name }}</h3>
                      <p>{{ service.description }}</p>
                      <strong>{{ money(service.pricePaise) }} · {{ service.durationMinutes }} min</strong>
                    </div>
                    @if (service.popular) { <span class="offer-pill">Popular</span> }
                  </button>
                } @empty {
                  <section class="state-card premium-card"><h2>No services available</h2></section>
                }
              </div>
            </section>
          }

          @if (step() === 2) {
            <section class="panel">
              <div class="section-heading"><div><h2 class="section-title">Choose staff</h2></div></div>
              <div class="staff-list">
                <button class="staff-choice premium-card" [class.selected]="selectedStaffId() === null" (click)="setStaff(null)">
                  <div class="any-avatar"><ion-icon name="sparkles-outline"></ion-icon></div>
                  <div><strong>Any available professional</strong></div>
                  <em>Recommended</em>
                </button>
                @for (staff of business.staff; track staff.id) {
                  <article class="staff-choice premium-card" [class.selected]="selectedStaffId() === staff.id" (click)="setStaff(staff.id)">
                    <img [src]="staff.image || 'assets/icons/icon.svg'" [alt]="staff.name" />
                    <div><strong>{{ staff.name }}</strong><span>{{ staff.title }} @if (staff.rating) { · Star {{ staff.rating }} }</span></div>
                    <button type="button" class="check-slots-button" (click)="checkStaffSlots($event, staff.id)">Check slots</button>
                  </article>
                }
              </div>
            </section>
          }

          @if (step() === 3) {
            <section class="panel">
              <div class="section-heading"><div><h2 class="section-title">Pick date, time or waitlist</h2></div></div>
              <article class="selected-staff-card premium-card">
                <div class="any-avatar"><ion-icon name="person-outline"></ion-icon></div>
                <div>
                  <span>Checking slots for</span>
                  <strong>{{ staffName() }}</strong>
                  @if (selectedStaffTitle()) { <small>{{ selectedStaffTitle() }}</small> }
                </div>
              </article>
              @if (marketplace.loading()) {
                <section class="state-card premium-card"><h2>Loading availability</h2></section>
              }
              <div class="date-row">
                @for (date of availabilityDays(); track date.date) {
                  <button class="date-card" [class.selected]="selectedDate() === date.date" [class.availability-full]="dateAvailabilityClass(date) === 'full'" [class.availability-many]="dateAvailabilityClass(date) === 'many'" [class.availability-partial]="dateAvailabilityClass(date) === 'partial'" (click)="setDate(date.date)">
                    <strong>{{ date.dayLabel }}</strong>
                    <span>{{ date.label }}</span>
                    <em>{{ dateAvailabilityLabel(date) }}</em>
                  </button>
                } @empty {
                  <section class="state-card premium-card"><h2>No slots available</h2></section>
                }
              </div>
              <div class="slot-sections">
                @for (group of slotGroups(); track group.label) {
                  <section class="slot-group premium-card">
                    <h3>{{ group.label }}</h3>
                    <div class="slot-grid">
                      @for (slot of group.slots; track slot.startAt) {
                        <button class="slot" [disabled]="!slot.available" [class.selected]="selectedSlotStartAt() === slot.startAt" (click)="selectedSlotStartAt.set(slot.startAt)">
                          {{ slot.displayTime }}
                        </button>
                      }
                    </div>
                  </section>
                } @empty {
                  <section class="state-card premium-card"><h2>No time slots</h2></section>
                }
              </div>
            </section>
          }

          @if (step() === 4) {
            <section class="panel confirm-grid">
              <article class="premium-card confirm-card">
                <h2>Confirm your booking</h2>
                <dl>
                  <div><dt>Business</dt><dd>{{ business.businessName }}</dd></div>
                  <div><dt>Service</dt><dd>{{ selectedService()?.name || "Not selected" }}</dd></div>
                  <div><dt>Staff</dt><dd>{{ staffName() }}</dd></div>
                  <div><dt>Time</dt><dd>{{ selectedSlotLabel() || "Not selected" }}</dd></div>
                  <div><dt>Payment</dt><dd>Pay at venue</dd></div>
                </dl>
              </article>
              <article class="premium-card trust-card">
                <ion-icon name="checkmark-circle-outline"></ion-icon>
                @if (marketplace.isAuthenticated()) {
                  <h3>Ready to book</h3>
                } @else {
                  <h3>Sign in to reserve</h3>
                }
              </article>
            </section>
          }
        </main>

        <div class="sticky-cta">
          <div class="bottom-action-card">
            <div>
              <small>{{ selectedService()?.name || "Select a service" }}</small>
              <strong>{{ bookingTotalLabel() || business.businessName }}</strong>
            </div>
            @if (step() < 4) {
              <ion-button class="primary-gradient" [disabled]="!canContinue()" (click)="next()">Continue</ion-button>
            } @else {
              <ion-button class="primary-gradient" [disabled]="!canConfirm() || marketplace.loading()" (click)="confirmBooking()">
                {{ marketplace.isAuthenticated() ? "Confirm" : "Sign in to book" }}
              </ion-button>
            }
          </div>
        </div>
      } @else {
        <main class="page-narrow">
          @if (marketplace.loading()) {
            <section class="state-card premium-card"><h1>Loading booking flow</h1></section>
          } @else {
            <section class="state-card premium-card error"><h1>Booking unavailable</h1><p>{{ marketplace.error() || "The business could not be loaded." }}</p><ion-button class="primary-gradient" (click)="reload()">Retry</ion-button></section>
          }
        </main>
      }
    </ion-content>
  `,
  styles: [`
    .booking-page { max-width: 980px; padding-bottom: calc(132px + var(--safe-bottom)); }
    .booking-hero { display: grid; gap: 18px; align-items: center; padding: 14px; }
    .booking-hero img { width: 100%; aspect-ratio: 16 / 10; height: auto; border-radius: 24px; object-fit: cover; }
    .booking-hero .page-title { font-size: clamp(2rem, 5vw, 3.6rem); }
    .stepper { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; margin: 20px 0 8px; }
    .stepper button { display: grid; justify-items: center; gap: 6px; padding: 12px 8px; border: 1px solid var(--border); border-radius: 18px; color: var(--muted); background: rgba(255, 249, 236, 0.9); font-weight: 900; }
    .stepper button.active, .stepper button.done { color: #120D05; border-color: transparent; background: linear-gradient(135deg, #F4D58D, #D6A94A); box-shadow: 0 14px 30px rgba(214, 169, 74, 0.2); }
    .stepper ion-icon { font-size: 1.15rem; }
    .booking-intent-row, .resource-grid, .time-mode-row { display: grid; gap: 10px; margin-bottom: 14px; }
    .booking-intent-row { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .booking-intent-row button, .resource-grid button, .time-mode-row button { border: 1px solid var(--border); border-radius: 18px; color: var(--text); background: rgba(255, 249, 236, 0.92); box-shadow: var(--shadow-soft); font-weight: 900; }
    .booking-intent-row button { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 3px 10px; align-items: center; padding: 14px; text-align: left; }
    .booking-intent-row button.active, .resource-grid button.active, .time-mode-row button.active, .addon-grid button.active { color: #120D05; border-color: transparent; background: linear-gradient(135deg, #F4D58D, #D6A94A); }
    .booking-intent-row button:disabled, .resource-grid button:disabled, .time-mode-row button:disabled, .addon-grid button:disabled { cursor: not-allowed; opacity: 0.58; }
    .booking-intent-row ion-icon { grid-row: span 2; font-size: 1.25rem; }
    .booking-intent-row small, .resource-grid small { color: inherit; opacity: 0.72; line-height: 1.35; }
    .readiness-note, .addon-panel, .resource-panel { display: grid; gap: 8px; padding: 16px; margin-bottom: 14px; }
    .readiness-note { border-color: rgba(214, 169, 74, 0.22); background: var(--aura-gold-soft); }
    .readiness-note strong, .readiness-note span, .addon-panel small, .resource-panel small { line-height: 1.45; }
    .readiness-note span, .addon-panel small, .resource-panel small { color: var(--muted); }
    .addon-panel h3, .resource-panel h3 { margin: 0; letter-spacing: 0; }
    .addon-grid { display: grid; gap: 8px; }
    .addon-grid button { display: flex; align-items: center; justify-content: space-between; gap: 12px; min-height: 48px; padding: 10px 12px; border: 1px solid var(--border); border-radius: 16px; color: var(--text); background: rgba(255, 249, 236, 0.92); font-weight: 900; }
    .addon-grid button strong { color: inherit; }
    .resource-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .resource-grid button { display: grid; gap: 4px; justify-items: start; padding: 13px; text-align: left; }
    .resource-grid ion-icon { font-size: 1.25rem; }
    .time-mode-row { grid-template-columns: repeat(3, minmax(0, 1fr)); }
    .time-mode-row button { display: inline-flex; align-items: center; justify-content: center; gap: 7px; min-height: 46px; padding: 10px; }
    .service-list, .staff-list, .slot-sections { display: grid; gap: 12px; }
    .service-choice, .staff-choice { width: 100%; display: grid; gap: 12px; align-items: center; padding: 16px; border-color: var(--border); color: var(--text); text-align: left; }
    .service-choice { grid-template-columns: minmax(0, 1fr) auto; }
    .service-choice.selected, .staff-choice.selected, .date-card.selected, .slot.selected { border-color: rgba(214, 169, 74, 0.48); background: var(--gold-soft); box-shadow: 0 16px 34px rgba(214, 169, 74, 0.14); }
    .service-choice h3 { margin: 0 0 6px; font-size: 1.12rem; letter-spacing: -0.035em; }
    .service-choice p { margin: 0 0 10px; color: var(--muted); line-height: 1.45; }
    .service-choice strong { color: var(--primary-2); }
    .staff-choice { grid-template-columns: auto minmax(0, 1fr) auto; }
    .staff-choice img, .any-avatar { width: 62px; height: 62px; border-radius: 22px; object-fit: cover; }
    .any-avatar { display: grid; place-items: center; color: #120D05; background: linear-gradient(135deg, #F4D58D, #D6A94A, #9B6B22); font-size: 1.35rem; }
    .staff-choice span, .staff-choice em { display: block; color: var(--muted); font-style: normal; line-height: 1.35; }
    .staff-choice em { color: var(--primary-2); font-weight: 900; text-align: right; }
    .check-slots-button { justify-self: end; min-height: 42px; padding: 0 14px; border: 1px solid rgba(214, 169, 74, 0.32); border-radius: 999px; color: var(--primary); background: rgba(255, 249, 236, 0.94); font-weight: 900; white-space: nowrap; }
    .check-slots-button:hover, .check-slots-button:focus-visible { background: var(--gold-soft); }
    .selected-staff-card { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 12px; align-items: center; margin-bottom: 14px; padding: 14px 16px; border-color: rgba(214, 169, 74, 0.28); background: var(--aura-gold-soft); }
    .selected-staff-card span, .selected-staff-card small { display: block; color: var(--muted); line-height: 1.35; }
    .selected-staff-card span { font-size: 0.78rem; font-weight: 900; text-transform: uppercase; letter-spacing: 0.08em; }
    .selected-staff-card strong { display: block; margin-top: 3px; color: var(--text); font-size: 1.02rem; font-weight: 900; }
    .selected-staff-card small { margin-top: 2px; font-weight: 800; }
    .date-row { display: grid; grid-auto-flow: column; grid-auto-columns: minmax(112px, 1fr); gap: 10px; overflow-x: auto; padding-bottom: 12px; scrollbar-width: none; }
    .date-row::-webkit-scrollbar { display: none; }
    .date-card, .slot { border: 1px solid var(--border); border-radius: 18px; background: rgba(255, 249, 236, 0.94); color: var(--text); font-weight: 900; }
    .date-card { position: relative; display: grid; gap: 5px; justify-items: center; padding: 14px 10px; overflow: hidden; }
    .date-card::before { content: ""; position: absolute; inset: 0 auto 0 0; width: 5px; background: rgba(125, 89, 32, 0.18); }
    .date-card.availability-many { border-color: rgba(29, 151, 76, 0.36); background: linear-gradient(145deg, rgba(232, 250, 239, 0.98), rgba(255, 249, 236, 0.96)); }
    .date-card.availability-many::before { background: #21a657; }
    .date-card.availability-partial { border-color: rgba(236, 145, 28, 0.42); background: linear-gradient(145deg, rgba(255, 242, 220, 0.98), rgba(255, 249, 236, 0.96)); }
    .date-card.availability-partial::before { background: #f09a22; }
    .date-card.availability-full { border-color: rgba(212, 62, 62, 0.38); background: linear-gradient(145deg, rgba(255, 232, 232, 0.98), rgba(255, 249, 236, 0.96)); }
    .date-card.availability-full::before { background: #d94141; }
    .date-card span { color: var(--muted); font-size: 0.86rem; }
    .date-card em { color: var(--muted); font-size: 0.72rem; font-style: normal; font-weight: 950; text-transform: uppercase; }
    .date-card.availability-many em { color: #157c40; }
    .date-card.availability-partial em { color: #a96108; }
    .date-card.availability-full em { color: #aa2e2e; }
    .slot-group, .state-card { padding: 16px; }
    .slot-group h3, .state-card h2, .state-card h1 { margin: 0 0 12px; letter-spacing: -0.035em; }
    .state-card.error p { color: #EF4444; }
    .slot-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; }
    .slot { padding: 12px 8px; }
    .slot:disabled { color: rgba(126, 110, 85, 0.42); background: rgba(125, 89, 32, 0.06); text-decoration: line-through; }
    .confirm-grid { display: grid; gap: 14px; }
    .confirm-card, .trust-card { padding: 20px; }
    .confirm-card h2, .trust-card h3 { margin: 0 0 10px; letter-spacing: -0.04em; }
    dl { display: grid; gap: 2px; margin: 18px 0 0; }
    dl div { display: flex; justify-content: space-between; gap: 18px; padding: 14px 0; border-bottom: 1px solid var(--border); }
    dt { color: var(--muted); font-weight: 800; }
    dd { margin: 0; font-weight: 900; text-align: right; }
    .trust-card ion-icon { color: #10B981; font-size: 2rem; }
    .trust-card p { margin: 0; color: var(--muted); line-height: 1.5; }
    .sticky-cta { bottom: calc(24px + env(safe-area-inset-bottom)); }
    @media (max-width: 599px) {
      .stepper button span { display: none; }
      .booking-intent-row, .resource-grid, .time-mode-row { grid-template-columns: 1fr; }
      .service-choice, .staff-choice { grid-template-columns: 1fr; }
      .staff-choice em { text-align: left; }
      .check-slots-button { justify-self: start; }
      .slot-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    }
    @media (min-width: 768px) {
      .booking-hero { grid-template-columns: 260px minmax(0, 1fr); }
      .confirm-grid { grid-template-columns: minmax(0, 1fr) 260px; }
      .addon-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    }
  `]
})
export class BookingFlowPage implements OnInit {
  readonly step = signal(Number(this.route.snapshot.queryParamMap.get("step") || 1));
  readonly selectedServiceId = signal(this.route.snapshot.queryParamMap.get("serviceId") ?? "");
  readonly selectedStaffId = signal<string | null>(this.route.snapshot.queryParamMap.get("staffId") || null);
  readonly selectedDate = signal("");
  readonly selectedSlotStartAt = signal("");
  readonly steps = [
    { id: 1, label: "Service", icon: "sparkles-outline" },
    { id: 2, label: "Staff", icon: "person-outline" },
    { id: 3, label: "Time", icon: "calendar-outline" },
    { id: 4, label: "Confirm", icon: "checkmark-circle-outline" }
  ];
  private readonly slug = signal(this.route.snapshot.paramMap.get("slug"));
  readonly business = computed(() => this.marketplace.findBusiness(this.slug()));
  readonly selectedService = computed(() => this.business()?.services.find((service) => service.id === this.selectedServiceId()) ?? this.business()?.services[0] ?? null);
  readonly selectedStaff = computed(() => this.selectedStaffId() ? this.business()?.staff.find((staff) => staff.id === this.selectedStaffId()) ?? null : null);
  readonly staffName = computed(() => this.selectedStaffId() ? this.business()?.staff.find((staff) => staff.id === this.selectedStaffId())?.name ?? "Selected staff" : "Any available professional");
  readonly selectedStaffTitle = computed(() => this.selectedStaff()?.title ?? "");
  readonly availabilityDays = computed(() => this.marketplace.availability());
  readonly selectedAvailabilityDay = computed(() => this.availabilityDays().find((day) => day.date === this.selectedDate()) ?? this.availabilityDays()[0] ?? null);
  readonly slotGroups = computed(() => this.selectedAvailabilityDay()?.periods ?? []);
  readonly selectedSlotLabel = computed(() => this.slotGroups().flatMap((group) => group.slots).find((slot) => slot.startAt === this.selectedSlotStartAt())?.displayTime ?? "");

  constructor(private readonly route: ActivatedRoute, private readonly router: Router, readonly marketplace: MarketplaceService) {
    addIcons({ calendarOutline, checkmarkCircleOutline, personOutline, sparklesOutline });
  }

  ngOnInit() {
    this.reload();
  }

  async reload() {
    const slug = this.slug();
    if (!slug) return;
    await this.marketplace.loadBusiness(slug).catch(() => undefined);
    if (!this.selectedServiceId() && this.business()?.services[0]) this.selectedServiceId.set(this.business()?.services[0].id ?? "");
    if (this.step() < 1 || this.step() > 4) this.step.set(1);
    await this.reloadAvailability();
  }

  next() {
    this.step.update((value) => Math.min(value + 1, 4));
    if (this.step() === 3) void this.reloadAvailability();
  }

  setService(serviceId: string) {
    this.selectedServiceId.set(serviceId);
    this.selectedSlotStartAt.set("");
    void this.reloadAvailability();
  }

  setStaff(staffId: string | null) {
    this.selectedStaffId.set(staffId);
    this.selectedSlotStartAt.set("");
    void this.reloadAvailability();
  }

  async checkStaffSlots(event: Event, staffId: string) {
    event.preventDefault();
    event.stopPropagation();
    this.selectedStaffId.set(staffId);
    this.selectedSlotStartAt.set("");
    this.step.set(3);
    await this.reloadAvailability();
  }

  setDate(date: string) {
    this.selectedDate.set(date);
    this.selectedSlotStartAt.set("");
    void this.reloadAvailability();
  }

  dateAvailabilityClass(day: AvailabilityDay): "full" | "many" | "partial" {
    const slots = day.periods.flatMap((period) => period.slots);
    if (!slots.length) return "full";
    const available = slots.filter((slot) => slot.available).length;
    if (available === 0) return "full";
    if (available / slots.length >= 0.6) return "many";
    return "partial";
  }

  dateAvailabilityLabel(day: AvailabilityDay): string {
    const slots = day.periods.flatMap((period) => period.slots);
    const available = slots.filter((slot) => slot.available).length;
    if (!slots.length || available === 0) return "Booked";
    if (available / slots.length >= 0.6) return "Available";
    return "Filling fast";
  }

  canContinue(): boolean {
    if (this.step() === 1) return !!this.selectedService();
    if (this.step() === 2) return !!this.selectedService();
    if (this.step() === 3) return !!this.selectedSlotStartAt();
    return true;
  }

  canConfirm(): boolean {
    return !!this.business() && !!this.selectedService() && !!this.selectedSlotStartAt();
  }

  money(pricePaise: number): string {
    return this.marketplace.formatMoney(pricePaise);
  }

  bookingTotalLabel(): string {
    return this.money(this.selectedService()?.pricePaise ?? 0);
  }

  async confirmBooking() {
    const business = this.business();
    const service = this.selectedService();
    if (!business || !service || !this.selectedSlotStartAt()) return;
    if (!this.marketplace.isAuthenticated()) {
      this.router.navigate(["/login"], { queryParams: { returnUrl: this.router.url } });
      return;
    }
    await this.marketplace.createBooking({
      businessSlug: business.slug,
      businessId: business.id,
      serviceId: service.id,
      staffId: this.selectedStaffId() || undefined,
      startAt: this.selectedSlotStartAt(),
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      paymentMode: "pay_at_venue"
    });
    this.router.navigateByUrl("/booking/success");
  }

  private async reloadAvailability() {
    const business = this.business();
    const service = this.selectedService();
    if (!business || !service) return;
    const queryDate = this.selectedDate() || new Date().toISOString().slice(0, 10);
    const days = await this.marketplace.loadAvailability(business.slug, {
      serviceId: service.id,
      staffId: this.selectedStaffId() || undefined,
      date: queryDate,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone
    }).catch(() => []);
    if (!this.selectedDate() && days[0]) this.selectedDate.set(days[0].date);
  }
}
