import { Component, OnInit, computed, signal } from "@angular/core";
import { ActivatedRoute, Router } from "@angular/router";
import { IonBackButton, IonButton, IonButtons, IonContent, IonHeader, IonIcon, IonToolbar } from "@ionic/angular/standalone";
import { addIcons } from "ionicons";
import { calendarOutline, checkmarkCircleOutline, personOutline, sparklesOutline } from "ionicons/icons";
import { MarketplaceService } from "../../core/marketplace.service";
import { AvailabilityDay, CustomerProfileExtensionRecord, ServiceItem } from "../../core/api.types";
import { CustomerApiService } from "../../core/customer-api.service";

const PENDING_BOOKING_INTENT_KEY = "auraCustomerPendingBookingIntent";
const BOOKING_CONTEXT_KEY = "auraCustomerBookingContext";

type PendingBookingIntent = {
  slug: string;
  serviceId: string;
  serviceIds?: string[];
  addonIdsByService?: Record<string, string[]>;
  clientId?: string;
  additionalClientIds?: string[];
  packageCreditId?: string;
  staffId: string | null;
  date: string;
  slotStartAt: string;
  paymentMode?: "pay_at_venue" | "online";
  cardGuaranteeAccepted?: boolean;
  step: number;
  savedAt: number;
};

function splitServiceIds(value: string | null): string[] {
  return String(value || "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
}

function bookingDate(value: string | null): string {
  const date = new Date(String(value || ""));
  return Number.isNaN(date.getTime()) ? "" : date.toISOString().slice(0, 10);
}

function localDate(): string {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

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
              <h1>{{ business.businessName }}</h1>
              <p class="muted">{{ business.category }} @if (business.area) { · {{ business.area }} } @if (business.ratingCount) { · {{ business.ratingAverage }} rating }</p>
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
              <div class="section-heading"><div><h2 class="section-title">Select services</h2></div></div>
              @if (selectedServices().length) {
                <article class="service-cart premium-card">
                  <div>
                    <span>{{ selectedServices().length }} selected</span>
                    <strong>{{ bookingTotalLabel() }} · {{ bookingDurationMinutes() }} min</strong>
                  </div>
                  <small>{{ selectedAddons().length ? selectedAddons().length + " add-on selected" : "Availability includes all selected services." }}</small>
                </article>
              }
              @if (selectedServicesWithAddons().length) {
                @for (service of selectedServicesWithAddons(); track service.id) {
                  <article class="addon-panel premium-card">
                    <h3>{{ service.name }} add-ons</h3>
                    <small>Optional extras update total duration and deposit before booking.</small>
                    <div class="addon-grid">
                      @for (addon of service.addons || []; track addon.id) {
                        <button type="button" [class.active]="isAddonSelected(service.id, addon.id)" (click)="toggleAddon(service.id, addon.id)">
                          <span>{{ addon.name }}</span>
                          <strong>+{{ money(addon.pricePaise) }} · {{ addon.durationMinutes }} min</strong>
                        </button>
                      }
                    </div>
                  </article>
                }
              }
              <div class="service-list">
                @for (service of business.services; track service.id) {
                  <button class="service-choice premium-card" [class.selected]="isServiceSelected(service.id)" (click)="toggleService(service.id)">
                    <div>
                      <h3>{{ service.name }}</h3>
                      <p>{{ service.description }}</p>
                      <strong>{{ money(service.pricePaise) }} · {{ service.durationMinutes }} min</strong>
                    </div>
                    <span class="offer-pill">{{ serviceBadge(service) }}</span>
                  </button>
                } @empty {
                  <section class="state-card premium-card"><h2>No services available</h2></section>
                }
              </div>
            </section>
          }

          @if (step() === 2) {
            <section class="panel">
              <div class="section-heading"><div><h2 class="section-title">Choose a professional</h2></div></div>
              <div class="staff-list">
                <button class="staff-choice premium-card" [class.selected]="selectedStaffId() === null" (click)="setStaff(null)">
                  <div class="any-avatar"><ion-icon name="sparkles-outline"></ion-icon></div>
                  <div><strong>Any available professional</strong></div>
                  <em>Recommended</em>
                </button>
                @for (staff of business.staff; track staff.id) {
                  <article class="staff-choice premium-card" [class.selected]="selectedStaffId() === staff.id" (click)="setStaff(staff.id)">
                    <img [src]="staff.image || 'assets/icons/icon.svg'" [alt]="staff.name" />
                    <div><strong>{{ staff.name }}</strong><span>{{ staff.title }} @if (staff.rating) { · {{ staff.rating }} rating }</span></div>
                    <button type="button" class="check-slots-button" (click)="checkStaffSlots($event, staff.id)">Check slots</button>
                  </article>
                }
              </div>
              @if (groupProfiles().length) {
                <fieldset class="group-profiles">
                  <legend>Add family profiles</legend>
                  @if (!groupBookingAvailable()) {
                    <small>Choose one service to add family profiles.</small>
                  }
                  @for (profile of groupProfiles(); track profile.id) {
                    <label>
                      <input type="checkbox" [disabled]="!groupBookingAvailable()" [checked]="additionalClientIds().includes(profile.bookingClientId || '')" (change)="toggleGroupProfile(profile.bookingClientId || '', $any($event.target).checked)" />
                      <span>{{ profile.title }} · {{ profile.relationshipType || "family" }}</span>
                    </label>
                  }
                </fieldset>
              }
            </section>
          }

          @if (step() === 3) {
            <section class="panel">
              <div class="section-heading"><div><h2 class="section-title">Pick date and time</h2></div></div>
              <article class="selected-staff-card premium-card">
                <div class="any-avatar"><ion-icon name="person-outline"></ion-icon></div>
                <div>
                  <span>Available times with</span>
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
                  <div><dt>Salon</dt><dd>{{ business.businessName }}</dd></div>
                  <div><dt>Services</dt><dd>{{ selectedServicesLabel() }}</dd></div>
                  @if (selectedClientId()) {
                    <div><dt>Booking for</dt><dd>Selected family profile</dd></div>
                  }
                  @if (additionalClientIds().length) {
                    <div><dt>Booking type</dt><dd>{{ additionalClientIds().length === 1 ? "Couple" : "Group" }} · {{ additionalClientIds().length + 1 }} guests</dd></div>
                  }
                  @if (selectedPackageCreditId()) {
                    <div><dt>Package</dt><dd>Package credit selected</dd></div>
                  }
                  <div><dt>Duration</dt><dd>{{ bookingDurationMinutes() }} min</dd></div>
                  @if (selectedAddonsLabel()) {
                    <div><dt>Add-ons</dt><dd>{{ selectedAddonsLabel() }}</dd></div>
                  }
                  <div><dt>Staff</dt><dd>{{ staffName() }}</dd></div>
                  <div><dt>Time</dt><dd>{{ selectedSlotLabel() || "Not selected" }}</dd></div>
                  <div><dt>Payment</dt><dd>{{ paymentModeLabel() }}</dd></div>
                </dl>
                @if (onlinePaymentAvailable()) {
                  <div class="payment-options" aria-label="Payment method">
                    <button type="button" [class.active]="paymentMode() === 'online'" (click)="setPaymentMode('online')">Pay deposit online</button>
                    <button type="button" [class.active]="paymentMode() === 'pay_at_venue'" (click)="setPaymentMode('pay_at_venue')">Pay at salon</button>
                  </div>
                }
                @if (paymentMode() === "online") {
                  <label class="guarantee-check">
                    <input type="checkbox" [checked]="cardGuaranteeAccepted()" (change)="cardGuaranteeAccepted.set($any($event.target).checked)" />
                    <span>I confirm the deposit/card guarantee and cancellation policy.</span>
                  </label>
                }
                @if (business.policies?.length) {
                  <div class="policy-note">
                    <strong>Cancellation policy</strong>
                    @for (policy of business.policies?.slice(0, 2); track policy) {
                      <p>{{ policy }}</p>
                    }
                  </div>
                }
              </article>
              <article class="premium-card trust-card">
                <ion-icon name="checkmark-circle-outline"></ion-icon>
                @if (marketplace.isAuthenticated()) {
                  <h3>Ready to book</h3>
                } @else {
                  <h3>Sign in to reserve</h3>
                }
                @if (business.ratingCount || business.reviews.length) {
                  <p>{{ business.ratingAverage }} rating · {{ business.ratingCount }} reviews</p>
                }
                @if (business.reviews.length) {
                  <small>Latest review</small>
                  <p>{{ business.reviews[0].text }}</p>
                }
                @if (paymentMode() === "online") {
                  <small>Card guarantee</small>
                  <p>Deposit {{ depositAmountLabel() }}{{ participantCount() > 1 ? " per guest" : "" }} is requested through the secure payment link. Final payment stays with the salon.</p>
                }
              </article>
            </section>
          }
        </main>

        <div class="booking-cta">
          <div class="bottom-action-card">
            <div>
              <small>{{ selectedServices().length ? selectedServices().length + " service selected" : "Select a service" }}</small>
              <strong>{{ bookingTotalLabel() || business.businessName }}</strong>
            </div>
            @if (step() < 4) {
              <ion-button class="primary-gradient" [disabled]="!canContinue()" (click)="next()">Continue</ion-button>
            } @else {
              <ion-button class="primary-gradient" [disabled]="!canConfirm() || marketplace.loading()" (click)="confirmBooking()">
                {{ marketplace.isAuthenticated() ? "Confirm booking" : "Sign in to book" }}
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
    ion-content { --background: var(--app-bg); }
    ion-toolbar { --background: var(--surface); --color: var(--text); }
    .booking-page { max-width: 980px; padding-bottom: 14px; }
    .booking-page .premium-card, .booking-page .service-choice, .booking-page .staff-choice, .booking-page .date-card, .booking-page .slot, .bottom-action-card { border-color: var(--border) !important; background: var(--surface) !important; box-shadow: var(--shadow-soft) !important; }
    .booking-page .service-cart, .booking-page .selected-staff-card { border-color: var(--control-border) !important; background: var(--accent-2) !important; }
    .booking-page .service-choice.selected, .booking-page .staff-choice.selected, .booking-page .date-card.selected, .booking-page .slot.selected { color: var(--text) !important; border-color: var(--primary) !important; background: var(--accent-2) !important; box-shadow: 0 16px 34px rgba(11, 79, 138, 0.14) !important; }
    .booking-page .offer-pill { color: var(--primary) !important; border-color: var(--control-border) !important; background: var(--accent-2) !important; }
    ion-button.primary-gradient { --background: linear-gradient(135deg, var(--primary), var(--accent)) !important; --background-hover: linear-gradient(135deg, var(--primary-2), var(--primary)) !important; --background-focused: linear-gradient(135deg, var(--primary), var(--accent)) !important; --background-activated: var(--primary-2) !important; --color: #fff !important; --color-activated: #fff !important; --box-shadow: 0 14px 30px rgba(11, 79, 138, 0.22) !important; }
    .booking-cta { width: min(980px, calc(100% - 32px)); margin: 14px auto calc(24px + env(safe-area-inset-bottom)); }
    .booking-hero { display: grid; grid-template-columns: 58px minmax(0, 1fr); gap: 12px; align-items: center; padding: 12px; }
    .booking-hero img { width: 58px; height: 58px; border-radius: 16px; object-fit: cover; }
    .booking-hero h1 { margin: 0; font-size: 1.08rem; letter-spacing: -0.02em; }
    .booking-hero p { margin: 4px 0 0; }
    .stepper { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; margin: 20px 0 8px; }
    .stepper button { display: grid; justify-items: center; gap: 6px; padding: 12px 8px; border: 1px solid var(--border); border-radius: 18px; color: var(--muted); background: var(--surface); font-weight: 900; }
    .stepper button.active, .stepper button.done { color: #fff; border-color: transparent; background: linear-gradient(135deg, var(--primary), var(--accent)); box-shadow: 0 14px 30px rgba(11, 79, 138, 0.2); }
    .stepper ion-icon { font-size: 1.15rem; }
    .payment-options { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; margin-top: 14px; }
    .payment-options button { min-height: 44px; padding: 9px 12px; border: 1px solid var(--border); border-radius: 14px; color: var(--text); background: #fff; font-weight: 900; }
    .payment-options button.active { border-color: var(--primary); background: var(--accent-2); color: var(--primary-2); }
    .guarantee-check { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 10px; align-items: start; margin-top: 12px; padding: 12px; border: 1px solid var(--control-border); border-radius: 16px; background: var(--accent-2); color: var(--text); font-weight: 850; line-height: 1.35; }
    .guarantee-check input { width: 18px; height: 18px; margin-top: 1px; accent-color: var(--primary); }
    .policy-note { display: grid; gap: 6px; margin-top: 14px; padding-top: 14px; border-top: 1px solid var(--border); }
    .policy-note strong, .trust-card small { color: var(--text); font-weight: 900; }
    .policy-note p { margin: 0; color: var(--muted); line-height: 1.45; }
    .booking-intent-row, .resource-grid, .time-mode-row { display: grid; gap: 10px; margin-bottom: 14px; }
    .booking-intent-row { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .booking-intent-row button, .resource-grid button, .time-mode-row button { border: 1px solid var(--border); border-radius: 18px; color: var(--text); background: var(--surface); box-shadow: var(--shadow-soft); font-weight: 900; }
    .booking-intent-row button { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 3px 10px; align-items: center; padding: 14px; text-align: left; }
    .booking-intent-row button.active, .resource-grid button.active, .time-mode-row button.active, .addon-grid button.active { color: #fff; border-color: transparent; background: linear-gradient(135deg, var(--primary), var(--accent)); }
    .booking-intent-row button:disabled, .resource-grid button:disabled, .time-mode-row button:disabled, .addon-grid button:disabled { cursor: not-allowed; opacity: 0.58; }
    .booking-intent-row ion-icon { grid-row: span 2; font-size: 1.25rem; }
    .booking-intent-row small, .resource-grid small { color: inherit; opacity: 0.72; line-height: 1.35; }
    .readiness-note, .addon-panel, .resource-panel { display: grid; gap: 8px; padding: 16px; margin-bottom: 14px; }
    .readiness-note { border-color: var(--control-border); background: var(--accent-2); }
    .readiness-note strong, .readiness-note span, .addon-panel small, .resource-panel small { line-height: 1.45; }
    .readiness-note span, .addon-panel small, .resource-panel small { color: var(--muted); }
    .addon-panel h3, .resource-panel h3 { margin: 0; letter-spacing: 0; }
    .addon-grid { display: grid; gap: 8px; }
    .addon-grid button { display: flex; align-items: center; justify-content: space-between; gap: 12px; min-height: 48px; padding: 10px 12px; border: 1px solid var(--border); border-radius: 16px; color: var(--text); background: var(--surface); font-weight: 900; }
    .addon-grid button strong { color: inherit; }
    .resource-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .resource-grid button { display: grid; gap: 4px; justify-items: start; padding: 13px; text-align: left; }
    .resource-grid ion-icon { font-size: 1.25rem; }
    .time-mode-row { grid-template-columns: repeat(3, minmax(0, 1fr)); }
    .time-mode-row button { display: inline-flex; align-items: center; justify-content: center; gap: 7px; min-height: 46px; padding: 10px; }
    .service-cart { display: flex; align-items: center; justify-content: space-between; gap: 14px; margin-bottom: 12px; padding: 14px 16px; border-color: var(--control-border); background: var(--accent-2); }
    .service-cart span, .service-cart small { display: block; color: var(--muted); font-weight: 850; line-height: 1.35; }
    .service-cart strong { display: block; margin-top: 3px; color: var(--text); font-weight: 950; }
    .service-cart small { text-align: right; }
    .service-list, .staff-list, .slot-sections { display: grid; gap: 12px; }
    .service-choice, .staff-choice { width: 100%; display: grid; gap: 12px; align-items: center; padding: 16px; border-color: var(--border); color: var(--text); text-align: left; }
    .service-choice { grid-template-columns: minmax(0, 1fr) auto; }
    .service-choice.selected, .staff-choice.selected, .date-card.selected, .slot.selected { border-color: var(--primary); background: var(--accent-2); box-shadow: 0 16px 34px rgba(11, 79, 138, 0.14); }
    .service-choice h3 { margin: 0 0 6px; font-size: 1.12rem; letter-spacing: -0.035em; }
    .service-choice p { margin: 0 0 10px; color: var(--muted); line-height: 1.45; }
    .service-choice strong { color: var(--primary-2); }
    .staff-choice { grid-template-columns: auto minmax(0, 1fr) auto; }
    .staff-choice img, .any-avatar { width: 62px; height: 62px; border-radius: 22px; object-fit: cover; }
    .any-avatar { display: grid; place-items: center; color: #fff; background: linear-gradient(135deg, var(--primary), var(--accent)); font-size: 1.35rem; }
    .staff-choice span, .staff-choice em { display: block; color: var(--muted); font-style: normal; line-height: 1.35; }
    .staff-choice em { color: var(--primary-2); font-weight: 900; text-align: right; }
    .check-slots-button { justify-self: end; min-height: 42px; padding: 0 14px; border: 1px solid var(--control-border); border-radius: 999px; color: var(--primary); background: var(--surface); font-weight: 900; white-space: nowrap; }
    .check-slots-button:hover, .check-slots-button:focus-visible { background: var(--accent-2); border-color: var(--primary); }
    .selected-staff-card { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 12px; align-items: center; margin-bottom: 14px; padding: 14px 16px; border-color: var(--control-border); background: var(--accent-2); }
    .selected-staff-card span, .selected-staff-card small { display: block; color: var(--muted); line-height: 1.35; }
    .selected-staff-card span { font-size: 0.78rem; font-weight: 900; text-transform: uppercase; letter-spacing: 0.08em; }
    .selected-staff-card strong { display: block; margin-top: 3px; color: var(--text); font-size: 1.02rem; font-weight: 900; }
    .selected-staff-card small { margin-top: 2px; font-weight: 800; }
    .date-row { display: grid; grid-auto-flow: column; grid-auto-columns: minmax(112px, 1fr); gap: 10px; overflow-x: auto; padding-bottom: 12px; scrollbar-width: none; }
    .date-row::-webkit-scrollbar { display: none; }
    .date-card, .slot { border: 1px solid var(--border); border-radius: 18px; background: var(--surface); color: var(--text); font-weight: 900; }
    .date-card { position: relative; display: grid; gap: 5px; justify-items: center; padding: 14px 10px; overflow: hidden; }
    .date-card::before { content: ""; position: absolute; inset: 0 auto 0 0; width: 5px; background: var(--border); }
    .booking-page .date-card.availability-many { border-color: rgba(29, 151, 76, 0.36) !important; background: linear-gradient(145deg, rgba(232, 250, 239, 0.98), var(--surface)) !important; }
    .date-card.availability-many::before { background: #21a657; }
    .booking-page .date-card.availability-partial { border-color: rgba(236, 145, 28, 0.42) !important; background: linear-gradient(145deg, rgba(255, 242, 220, 0.98), var(--surface)) !important; }
    .date-card.availability-partial::before { background: #f09a22; }
    .booking-page .date-card.availability-full { border-color: rgba(212, 62, 62, 0.38) !important; background: linear-gradient(145deg, rgba(255, 232, 232, 0.98), var(--surface)) !important; }
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
    .booking-page .slot:disabled { color: rgba(107, 114, 128, 0.52) !important; background: var(--surface-elevated) !important; text-decoration: line-through; }
    .confirm-grid { display: grid; gap: 14px; }
    .confirm-card, .trust-card { padding: 20px; }
    .confirm-card h2, .trust-card h3 { margin: 0 0 10px; letter-spacing: -0.04em; }
    dl { display: grid; gap: 2px; margin: 18px 0 0; }
    dl div { display: flex; justify-content: space-between; gap: 18px; padding: 14px 0; border-bottom: 1px solid var(--border); }
    dt { color: var(--muted); font-weight: 800; }
    dd { margin: 0; font-weight: 900; text-align: right; }
    .trust-card ion-icon { color: #10B981; font-size: 2rem; }
    .trust-card p { margin: 0; color: var(--muted); line-height: 1.5; }
    .group-profiles { display: grid; gap: 8px; margin: 18px 0; padding: 14px; border: 1px solid var(--border); border-radius: 16px; }
    .group-profiles legend { padding: 0 6px; font-weight: 900; }
    .group-profiles small { color: var(--muted); }
    .group-profiles label { display: flex; align-items: center; gap: 9px; font-weight: 800; }
      .sticky-cta { bottom: calc(24px + env(safe-area-inset-bottom)); }
      .sticky-cta--confirm { bottom: calc(8px + env(safe-area-inset-bottom)); }
    @media (max-width: 599px) {
      .booking-page {
        padding-bottom: calc(196px + var(--safe-bottom));
      }

      .sticky-cta {
        bottom: calc(14px + env(safe-area-inset-bottom));
      }

      .sticky-cta--confirm {
        bottom: calc(2px + env(safe-area-inset-bottom));
      }

      .bottom-action-card {
        padding: 10px 12px;
        border-radius: 20px;
      }

      .bottom-action-card ion-button {
        min-width: 112px;
      }

      .stepper { gap: 6px; }
      .stepper button { padding: 10px 4px; font-size: 0.7rem; }
      .stepper button span { display: block; }
      .booking-intent-row, .resource-grid, .time-mode-row { grid-template-columns: 1fr; }
      .service-cart { align-items: flex-start; flex-direction: column; }
      .service-cart small { text-align: left; }
      .service-choice, .staff-choice { grid-template-columns: 1fr; }
      .staff-choice em { text-align: left; }
      .check-slots-button { justify-self: start; }
      .slot-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    }
    @media (min-width: 768px) {
      .confirm-grid { grid-template-columns: minmax(0, 1fr) 260px; }
      .addon-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    }
  `]
})
export class BookingFlowPage implements OnInit {
  readonly step = signal(Number(this.route.snapshot.queryParamMap.get("step") || (this.route.snapshot.queryParamMap.get("smart") ? 3 : 1)));
  readonly selectedServiceId = signal(this.route.snapshot.queryParamMap.get("serviceId") ?? "");
  readonly selectedServiceIds = signal<string[]>(this.initialServiceIds());
  readonly selectedAddonIds = signal<Record<string, string[]>>({});
  readonly selectedClientId = signal(this.initialBookingContext().clientId);
  readonly additionalClientIds = signal<string[]>([]);
  readonly familyProfiles = signal<CustomerProfileExtensionRecord[]>([]);
  readonly selectedPackageCreditId = signal(this.initialBookingContext().packageCreditId);
  readonly selectedStaffId = signal<string | null>(this.route.snapshot.queryParamMap.get("staffId") || null);
  readonly selectedDate = signal(bookingDate(this.route.snapshot.queryParamMap.get("after")));
  readonly rebookFromBookingId = signal(this.route.snapshot.queryParamMap.get("rebookFrom") || "");
  readonly selectedSlotStartAt = signal("");
  readonly paymentMode = signal<"pay_at_venue" | "online">("pay_at_venue");
  readonly cardGuaranteeAccepted = signal(false);
  readonly steps = [
    { id: 1, label: "Service", icon: "sparkles-outline" },
    { id: 2, label: "Pro", icon: "person-outline" },
    { id: 3, label: "Time", icon: "calendar-outline" },
    { id: 4, label: "Confirm", icon: "checkmark-circle-outline" }
  ];
  private readonly slug = signal(this.route.snapshot.paramMap.get("slug"));
  readonly business = computed(() => this.marketplace.findBusiness(this.slug()));
  readonly selectedServices = computed(() => {
    const business = this.business();
    if (!business) return [];
    const ids = this.selectedServiceIds();
    return ids
      .map((id) => business.services.find((service) => service.id === id))
      .filter((service): service is ServiceItem => Boolean(service));
  });
  readonly selectedService = computed(() => this.selectedServices()[0] ?? this.business()?.services.find((service) => service.id === this.selectedServiceId()) ?? this.business()?.services[0] ?? null);
  readonly selectedServicesWithAddons = computed(() => this.selectedServices().filter((service) => (service.addons ?? []).some((addon) => addon.active ?? true)));
  readonly selectedAddons = computed(() => this.selectedServices().flatMap((service) => {
    const selectedIds = new Set(this.selectedAddonIds()[service.id] ?? []);
    return (service.addons ?? []).filter((addon) => selectedIds.has(addon.id));
  }));
  readonly selectedStaff = computed(() => this.selectedStaffId() ? this.business()?.staff.find((staff) => staff.id === this.selectedStaffId()) ?? null : null);
  readonly groupProfiles = computed(() => this.familyProfiles().filter((profile) => profile.bookingClientId && profile.bookingClientId !== this.selectedClientId()));
  readonly staffName = computed(() => this.selectedStaffId() ? this.business()?.staff.find((staff) => staff.id === this.selectedStaffId())?.name ?? "Selected staff" : "Any available professional");
  readonly selectedStaffTitle = computed(() => this.selectedStaff()?.title ?? "");
  readonly availabilityDays = computed(() => this.marketplace.availability());
  readonly selectedAvailabilityDay = computed(() => this.availabilityDays().find((day) => day.date === this.selectedDate()) ?? this.availabilityDays()[0] ?? null);
  readonly slotGroups = computed(() => this.selectedAvailabilityDay()?.periods ?? []);
  readonly selectedSlot = computed(() => this.slotGroups().flatMap((group) => group.slots).find((slot) => slot.startAt === this.selectedSlotStartAt()) ?? null);
  readonly selectedSlotLabel = computed(() => this.slotGroups().flatMap((group) => group.slots).find((slot) => slot.startAt === this.selectedSlotStartAt())?.displayTime ?? "");
  readonly onlinePaymentAvailable = computed(() => this.business()?.paymentModes?.includes("online") ?? false);
  readonly groupBookingAvailable = computed(() => this.selectedServices().length === 1);
  readonly participantCount = computed(() => this.additionalClientIds().length + 1);
  readonly bookingDurationMinutes = computed(() => this.selectedServices().reduce((total, service) => total + service.durationMinutes, 0) + this.selectedAddons().reduce((total, addon) => total + addon.durationMinutes, 0));
  readonly bookingTotalPaise = computed(() => this.selectedServices().reduce((total, service) => total + service.pricePaise, 0) + this.selectedAddons().reduce((total, addon) => total + addon.pricePaise, 0));
  readonly depositAmountPaise = computed(() => Math.ceil(this.bookingTotalPaise() * (this.business()?.bookingDepositPercent || 0) / 100));
  readonly paymentModeLabel = computed(() => this.paymentMode() === "online" ? `Online deposit ${this.depositAmountLabel()}${this.participantCount() > 1 ? " per guest" : ""} (${this.business()?.bookingDepositPercent || 0}%)` : "Pay at salon");

  constructor(private readonly route: ActivatedRoute, private readonly router: Router, readonly marketplace: MarketplaceService, private readonly api: CustomerApiService) {
    addIcons({ calendarOutline, checkmarkCircleOutline, personOutline, sparklesOutline });
  }

  ngOnInit() {
    const source = this.route.snapshot.queryParamMap.get("source")?.split(":") ?? [];
    if (source.length === 3 && source[0] === "marketing_offer") {
      this.api.trackMarketingOfferClick(source[1], source[2]).subscribe({ error: () => undefined });
    }
    this.reload();
    if (this.marketplace.isAuthenticated()) {
      this.api.listFamily().subscribe({ next: (profiles) => this.familyProfiles.set(profiles), error: () => undefined });
    }
  }

  async reload() {
    const slug = this.slug();
    if (!slug) return;
    await this.marketplace.loadBusiness(slug).catch(() => undefined);
    this.restorePendingIntent();
    this.ensureServiceSelection();
    if (this.step() < 1 || this.step() > 4) this.step.set(1);
    await this.reloadAvailability();
  }

  next() {
    this.step.update((value) => Math.min(value + 1, 4));
    if (this.step() === 3) void this.reloadAvailability();
  }

  toggleService(serviceId: string) {
    const ids = this.selectedServiceIds();
    const next = ids.includes(serviceId)
      ? ids.length > 1 ? ids.filter((id) => id !== serviceId) : ids
      : [...ids, serviceId];
    this.selectedServiceIds.set(next);
    if (next.length > 1) this.additionalClientIds.set([]);
    this.selectedAddonIds.update((rows) => Object.fromEntries(Object.entries(rows).filter(([id]) => next.includes(id))));
    this.selectedServiceId.set(next[0] || serviceId);
    this.selectedSlotStartAt.set("");
    void this.reloadAvailability();
  }

  toggleAddon(serviceId: string, addonId: string) {
    this.selectedAddonIds.update((rows) => {
      const selected = new Set(rows[serviceId] ?? []);
      if (selected.has(addonId)) selected.delete(addonId);
      else selected.add(addonId);
      return { ...rows, [serviceId]: [...selected] };
    });
    this.selectedSlotStartAt.set("");
    void this.reloadAvailability();
  }

  isServiceSelected(serviceId: string): boolean {
    return this.selectedServiceIds().includes(serviceId);
  }

  isAddonSelected(serviceId: string, addonId: string): boolean {
    return (this.selectedAddonIds()[serviceId] ?? []).includes(addonId);
  }

  serviceBadge(service: ServiceItem): string {
    if (this.selectedServiceId() === service.id) return "Primary";
    if (this.isServiceSelected(service.id)) return "Added";
    return service.popular ? "Popular" : "Add";
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
    if (this.step() === 1) return this.selectedServices().length > 0;
    if (this.step() === 2) return this.selectedServices().length > 0;
    if (this.step() === 3) return !!this.selectedSlotStartAt();
    return true;
  }

  canConfirm(): boolean {
    return !!this.business()
      && this.selectedServices().length > 0
      && !!this.selectedSlotStartAt()
      && !!(this.selectedStaffId() || this.selectedSlot()?.staffId)
      && (this.additionalClientIds().length === 0 || this.groupBookingAvailable())
      && (this.paymentMode() !== "online" || this.cardGuaranteeAccepted());
  }

  money(pricePaise: number): string {
    return this.marketplace.formatMoney(pricePaise);
  }

  bookingTotalLabel(): string {
    return this.bookingTotalPaise() > 0 ? `${this.money(this.bookingTotalPaise())}${this.participantCount() > 1 ? " per guest" : ""}` : "";
  }

  depositAmountLabel(): string {
    return this.money(this.depositAmountPaise());
  }

  setPaymentMode(mode: "pay_at_venue" | "online") {
    this.paymentMode.set(mode);
    if (mode !== "online") this.cardGuaranteeAccepted.set(false);
  }

  selectedServicesLabel(): string {
    const names = this.selectedServices().map((service) => service.name);
    return names.length ? names.join(", ") : "Not selected";
  }

  selectedAddonsLabel(): string {
    return this.selectedAddons().map((addon) => addon.name).join(", ");
  }

  async confirmBooking() {
    const business = this.business();
    const services = this.selectedServices();
    if (!business || !services.length || !this.selectedSlotStartAt()) return;
    this.savePendingIntent();
    if (!this.marketplace.isAuthenticated()) {
      this.router.navigate(["/login"], { queryParams: { returnUrl: this.router.url } });
      return;
    }
    const customer = this.marketplace.customer();
    if (customer && !this.profileComplete(customer)) {
      this.router.navigate(["/login"], { queryParams: { returnUrl: this.router.url, complete: "profile" } });
      return;
    }
    const slotStillAvailable = await this.revalidateSelectedSlot();
    if (!slotStillAvailable) return;
    const startAt = this.selectedSlotStartAt();
    const durationMinutes = this.bookingDurationMinutes() || services[0].durationMinutes;
    const endAt = new Date(new Date(startAt).getTime() + durationMinutes * 60_000).toISOString();
    const booking = await this.marketplace.createBooking({
      tenantId: business.tenantId || "",
      branchId: business.branchId || business.id,
      serviceIds: services.map((service) => service.id),
      serviceSelections: services.map((service) => ({
        serviceId: service.id,
        addonIds: (this.selectedAddonIds()[service.id] ?? []).filter((addonId) => (service.addons ?? []).some((addon) => addon.id === addonId))
      })),
      clientId: this.selectedClientId() || undefined,
      additionalClientIds: this.additionalClientIds(),
      packageCreditId: this.selectedPackageCreditId() || undefined,
      staffId: this.selectedStaffId() || this.selectedSlot()?.staffId || undefined,
      startAt,
      endAt,
      rebookFromBookingId: this.rebookFromBookingId() || undefined,
      source: this.route.snapshot.queryParamMap.get("source") || undefined,
      offerCode: this.route.snapshot.queryParamMap.get("offer") || undefined,
      paymentMode: this.onlinePaymentAvailable() ? this.paymentMode() : "pay_at_venue",
      cardGuaranteeAccepted: this.paymentMode() === "online" && this.cardGuaranteeAccepted()
    }).catch(() => null);
    if (!booking) return;
    this.clearPendingIntent();
    this.router.navigate(["/booking/success"], { queryParams: { id: booking.id } });
  }

  private async revalidateSelectedSlot(): Promise<boolean> {
    const slot = this.selectedSlotStartAt();
    if (!await this.reloadAvailability()) return false;
    const available = this.marketplace.availability()
      .flatMap((day) => day.periods)
      .flatMap((period) => period.slots)
      .some((item) => item.startAt === slot && item.available);
    if (!available) {
      this.selectedSlotStartAt.set("");
      this.step.set(3);
      this.marketplace.error.set("That slot was just taken. Please choose another time.");
    }
    return available;
  }

  private async reloadAvailability(): Promise<boolean> {
    const business = this.business();
    const services = this.selectedServices();
    if (!business || !services.length) return false;
    const queryDate = this.selectedDate() || localDate();
    const days = await this.marketplace.loadAvailability(business.slug, {
      serviceId: services[0].id,
      serviceIds: services.map((service) => service.id),
      staffId: this.selectedStaffId() || undefined,
      date: queryDate,
      days: 7,
      durationMinutes: this.bookingDurationMinutes(),
      participants: this.groupBookingAvailable() ? this.participantCount() : 1,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone
    }).catch(() => null);
    if (!days) return false;
    if (!this.selectedDate() && days[0]) this.selectedDate.set(days[0].date);
    return true;
  }

  private initialServiceIds(): string[] {
    const ids = splitServiceIds(this.route.snapshot.queryParamMap.get("serviceIds"));
    const serviceId = this.route.snapshot.queryParamMap.get("serviceId");
    return ids.length ? ids : serviceId ? [serviceId] : [];
  }

  private ensureServiceSelection() {
    const business = this.business();
    if (!business) return;
    const availableIds = new Set(business.services.map((service) => service.id));
    const selectedIds = this.selectedServiceIds().filter((id) => availableIds.has(id));
    if (!selectedIds.length && this.selectedServiceId() && availableIds.has(this.selectedServiceId())) {
      selectedIds.push(this.selectedServiceId());
    }
    if (!selectedIds.length && business.services[0]) selectedIds.push(business.services[0].id);
    this.selectedServiceIds.set(selectedIds);
    this.selectedServiceId.set(selectedIds[0] || "");
    if (selectedIds.length > 1) this.additionalClientIds.set([]);
  }

  private savePendingIntent() {
    const slug = this.slug();
    if (!slug) return;
    const intent: PendingBookingIntent = {
      slug,
      serviceId: this.selectedServiceId(),
      serviceIds: this.selectedServiceIds(),
      addonIdsByService: this.selectedAddonIds(),
      clientId: this.selectedClientId(),
      additionalClientIds: this.additionalClientIds(),
      packageCreditId: this.selectedPackageCreditId(),
      staffId: this.selectedStaffId(),
      date: this.selectedDate(),
      slotStartAt: this.selectedSlotStartAt(),
      paymentMode: this.paymentMode(),
      cardGuaranteeAccepted: this.cardGuaranteeAccepted(),
      step: this.step(),
      savedAt: Date.now()
    };
    try {
      localStorage.setItem(PENDING_BOOKING_INTENT_KEY, JSON.stringify(intent));
    } catch {
      // Booking can continue without local draft persistence.
    }
  }

  private restorePendingIntent() {
    try {
      const raw = localStorage.getItem(PENDING_BOOKING_INTENT_KEY);
      if (!raw) return;
      const intent = JSON.parse(raw) as PendingBookingIntent;
      if (intent.slug !== this.slug()) return;
      if (Date.now() - Number(intent.savedAt || 0) > 30 * 60 * 1000) {
        this.clearPendingIntent();
        return;
      }
      const serviceIds = Array.isArray(intent.serviceIds) && intent.serviceIds.length ? intent.serviceIds : intent.serviceId ? [intent.serviceId] : [];
      if (serviceIds.length) {
        this.selectedServiceIds.set(serviceIds);
        this.selectedServiceId.set(serviceIds[0]);
      }
      if (intent.addonIdsByService && typeof intent.addonIdsByService === "object") this.selectedAddonIds.set(intent.addonIdsByService);
      if (intent.clientId) this.selectedClientId.set(intent.clientId);
      if (Array.isArray(intent.additionalClientIds)) this.additionalClientIds.set(intent.additionalClientIds.slice(0, 5));
      if (intent.packageCreditId) this.selectedPackageCreditId.set(intent.packageCreditId);
      this.selectedStaffId.set(intent.staffId || null);
      if (intent.date) this.selectedDate.set(intent.date);
      if (intent.slotStartAt) this.selectedSlotStartAt.set(intent.slotStartAt);
      const online = intent.paymentMode === "online" && this.onlinePaymentAvailable();
      this.paymentMode.set(online ? "online" : "pay_at_venue");
      this.cardGuaranteeAccepted.set(online && Boolean(intent.cardGuaranteeAccepted));
      if (intent.step >= 1 && intent.step <= 4) this.step.set(intent.step);
    } catch {
      this.clearPendingIntent();
    }
  }

  private clearPendingIntent() {
    try {
      localStorage.removeItem(PENDING_BOOKING_INTENT_KEY);
      localStorage.removeItem(BOOKING_CONTEXT_KEY);
    } catch {
      // Ignore unavailable storage.
    }
  }

  toggleGroupProfile(clientId: string, checked: boolean) {
    if (!clientId) return;
    this.additionalClientIds.update((ids) => checked
      ? ids.includes(clientId) || ids.length >= 5 ? ids : [...ids, clientId]
      : ids.filter((id) => id !== clientId));
    this.selectedSlotStartAt.set("");
  }

  private profileComplete(customer: { profileComplete?: boolean; firstName?: string; lastName?: string; email?: string; phone?: string }): boolean {
    return Boolean(customer.profileComplete)
      || (!!String(customer.firstName || "").trim()
        && !!String(customer.lastName || "").trim()
        && !!String(customer.email || "").trim()
        && !!String(customer.phone || "").trim());
  }

  private initialBookingContext(): { clientId: string; packageCreditId: string } {
    const fromQuery = {
      clientId: this.route.snapshot.queryParamMap.get("clientId") || "",
      packageCreditId: this.route.snapshot.queryParamMap.get("packageCreditId") || ""
    };
    if (fromQuery.clientId || fromQuery.packageCreditId) return fromQuery;
    try {
      const raw = localStorage.getItem(BOOKING_CONTEXT_KEY);
      const value = raw ? JSON.parse(raw) as { clientId?: string; packageCreditId?: string } : {};
      return { clientId: value.clientId || "", packageCreditId: value.packageCreditId || "" };
    } catch {
      return { clientId: "", packageCreditId: "" };
    }
  }
}
