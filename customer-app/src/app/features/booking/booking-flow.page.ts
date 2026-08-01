import { Component, OnInit, computed, signal } from "@angular/core";
import { ActivatedRoute, Router } from "@angular/router";
import { IonBackButton, IonButton, IonButtons, IonContent, IonHeader, IonIcon, IonTitle, IonToolbar } from "@ionic/angular/standalone";
import { addIcons } from "ionicons";
import { calendarOutline, checkmarkCircleOutline, personOutline, sparklesOutline } from "ionicons/icons";
import { MarketplaceService } from "../../core/marketplace.service";
import { AvailabilityDay, AvailabilitySlot, ServiceItem, StaffMember } from "../../core/api.types";
import { BookingProgressComponent, BookingProgressStepId } from "./booking-progress.component";

const PENDING_BOOKING_INTENT_KEY = "auraCustomerPendingBookingIntent";

type PendingBookingIntent = {
  slug: string;
  items?: BookingFlowItem[];
  serviceId?: string;
  staffId?: string | null;
  date: string;
  slotStartAt?: string;
  activeItemIndex?: number;
  step: number;
  savedAt: number;
};

type BookingFlowItem = {
  serviceId: string;
  staffId: string | null;
  date: string;
  slotStartAt: string;
};

@Component({
  standalone: true,
  imports: [IonBackButton, IonButton, IonButtons, IonContent, IonHeader, IonIcon, IonTitle, IonToolbar, BookingProgressComponent],
  template: `
    <ion-header class="ion-no-border">
      <ion-toolbar>
        <ion-buttons slot="start"><ion-back-button [defaultHref]="backHref()"></ion-back-button></ion-buttons>
        @if (isRescheduling()) {
          <ion-title class="edit-toolbar-title">Edit appointment</ion-title>
        }
      </ion-toolbar>
    </ion-header>

    <ion-content>
      @if (business(); as business) {
        <main class="page booking-page" [class.editing]="isRescheduling()">
          @if (!isRescheduling()) {
            <section class="booking-hero premium-card">
              <img [src]="business.coverImage || 'assets/icons/icon.svg'" [alt]="business.businessName" />
              <div>
                <h1 class="page-title">Book your visit</h1>
                <p class="muted">{{ business.businessName }} · {{ business.area }} · {{ business.ratingAverage }} rating</p>
              </div>
            </section>
          }

          @if (marketplace.error()) {
            <section class="state-card premium-card error"><h2>Booking data unavailable</h2><p>{{ marketplace.error() }}</p><ion-button class="primary-gradient" (click)="reload()">Retry</ion-button></section>
          }

          <app-booking-progress [currentStep]="currentBookingStep()" (stepSelect)="goToStep($event)" />

          @if (currentBookingStep() === 1) {
            <section class="panel">
              <div class="section-heading"><div><h2 class="section-title">Choose a service</h2></div></div>
              <div class="service-list">
                @for (service of business.services; track service.id) {
                  <button class="service-choice premium-card" [class.selected]="isServiceSelected(service.id)" (click)="toggleService(service.id)">
                    <div>
                      <h3>{{ service.name }}</h3>
                      <p>{{ service.description }}</p>
                      <strong>{{ servicePriceLabel(service) }}</strong>
                    </div>
                    <span class="flow-service-media">
                      <img [src]="serviceImage(service, $index)" [alt]="service.name + ' service image'" loading="lazy" />
                      <span class="choice-action">{{ isServiceSelected(service.id) ? "Added" : "Add" }}</span>
                    </span>
                    @if (service.popular) { <span class="offer-pill">Popular</span> }
                  </button>
                } @empty {
                  <section class="state-card premium-card"><h2>No services available</h2></section>
                }
              </div>
            </section>
          }

          @if (currentBookingStep() === 2) {
            <section class="panel">
              <div class="section-heading">
                <div>
                  <h2 class="section-title">Choose professionals</h2>
                  <p class="muted">
                    @if (bookingItems().length > 1) {
                      Select professional for <strong>Service {{ activeItemIndex() + 1 }} of {{ bookingItems().length }}</strong> ({{ activeService()?.name }}).
                    } @else {
                      Pick staff for your selected service.
                    }
                  </p>
                </div>
              </div>

              @if (bookingItems().length > 1) {
                <div class="multi-service-progress-banner staff-banner">
                  <p>Service {{ activeItemIndex() + 1 }} of {{ bookingItems().length }}: Pick staff for <strong>{{ activeService()?.name }}</strong></p>
                  <small>{{ staffSelectedSummary() }}</small>
                </div>

                <div class="booking-item-tabs" aria-label="Selected services staff">
                  @for (item of bookingItems(); track item.serviceId; let itemIndex = $index) {
                    @if (serviceById(item.serviceId); as service) {
                      <button type="button" [class.active]="activeItemIndex() === itemIndex" [class.done]="item.staffId !== undefined" (click)="setActiveItem(itemIndex)">
                        <span>{{ itemIndex + 1 }}</span>
                        <strong>{{ service.name }}</strong>
                        <small>{{ itemStaffName(item) }}</small>
                      </button>
                    }
                  }
                </div>

                <div class="multi-staff-quick-bar">
                  <button type="button" class="quick-staff-btn" (click)="assignAnyStaffToAll()">
                    <ion-icon name="sparkles-outline"></ion-icon>
                    Assign Any Professional to all {{ bookingItems().length }} services
                  </button>
                </div>
              }

              <div class="multi-service-stack">
                @if (activeItem(); as item) {
                  @if (serviceById(item.serviceId); as service) {
                    <section class="service-schedule-card premium-card">
                      <div class="service-schedule-head">
                        <div>
                          <h3>{{ service.name }}</h3>
                          <small>{{ servicePriceLabel(service) }}</small>
                        </div>
                        <span>{{ activeItemIndex() + 1 }} of {{ bookingItems().length }}</span>
                      </div>
                      <div class="staff-list compact">
                        <button class="staff-choice premium-card" [class.selected]="item.staffId === null" (click)="setItemStaff(activeItemIndex(), null)">
                          <div class="any-avatar"><ion-icon name="sparkles-outline"></ion-icon></div>
                          <div>
                            <strong>Any available professional</strong>
                            <span>Auto-matches top available specialist</span>
                          </div>
                          <em>Recommended</em>
                        </button>
                        @for (staff of staffForService(service); track staff.id) {
                          <article class="staff-choice premium-card" [class.selected]="item.staffId === staff.id" (click)="setItemStaff(activeItemIndex(), staff.id)">
                            <img [src]="staff.image || 'assets/icons/icon.svg'" [alt]="staff.name" />
                            <div>
                              <strong>{{ staff.name }}</strong>
                              <span>{{ staff.title }} @if (staff.rating) { · {{ staff.rating }} rating }</span>
                            </div>
                            <button type="button" class="check-slots-button" (click)="checkItemSlots($event, activeItemIndex(), staff.id)">Pick Time</button>
                          </article>
                        } @empty {
                          <p class="muted">Any available professional will be assigned.</p>
                        }
                      </div>
                    </section>
                  }
                }
              </div>
            </section>
          }

          @if (currentBookingStep() === 3) {
            <section class="panel">
              <div class="section-heading"><div><h2 class="section-title">Pick date and time</h2><p class="muted">Each service needs its own non-overlapping slot.</p></div></div>
              @if (bookingItems().length > 1) {
                <div class="multi-service-progress-banner">
                  <p>Step 3: Selecting slot for <strong>Service {{ activeItemIndex() + 1 }} of {{ bookingItems().length }}</strong> ({{ activeService()?.name }})</p>
                  <small>{{ slotsSelectedSummary() }}</small>
                </div>
              }
              <div class="booking-item-tabs" aria-label="Selected services">
                @for (item of bookingItems(); track item.serviceId; let itemIndex = $index) {
                  @if (serviceById(item.serviceId); as service) {
                    <button type="button" [class.active]="activeItemIndex() === itemIndex" [class.done]="!!item.slotStartAt" (click)="setActiveItem(itemIndex)">
                      <span>{{ itemIndex + 1 }}</span>
                      <strong>{{ service.name }}</strong>
                      <small>{{ itemSlotLabel(itemIndex) || "Choose time" }}</small>
                    </button>
                  }
                }
              </div>
              <article class="selected-staff-card premium-card">
                <div class="any-avatar"><ion-icon name="person-outline"></ion-icon></div>
                <div>
                  <span>Available times for {{ activeService()?.name }}</span>
                  <strong>{{ activeStaffName() }}</strong>
                  @if (activeService(); as service) { <small>{{ activeServiceLabel(service) }}</small> }
                </div>
              </article>
              @if (marketplace.loading()) {
                <section class="state-card premium-card"><h2>Loading availability</h2></section>
              }
              <div class="date-row">
                @for (date of availabilityDays(); track date.date) {
                  <button class="date-card" [class.selected]="activeItem().date === date.date" [class.availability-full]="dateAvailabilityClass(date) === 'full'" [class.availability-many]="dateAvailabilityClass(date) === 'many'" [class.availability-partial]="dateAvailabilityClass(date) === 'partial'" (click)="setDate(date.date)">
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
                        <button class="slot" [disabled]="!isSlotSelectable(slot)" [class.selected]="activeItem().slotStartAt === slot.startAt" (click)="selectActiveSlot(slot)">
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

          @if (currentBookingStep() === 4) {
            <section class="panel confirm-grid">
              <article class="premium-card confirm-card">
                <h2>{{ isRescheduling() ? "Confirm your changes" : "Confirm your booking" }}</h2>
                <dl class="multi-service-summary-dl">
                  <div><dt>Salon</dt><dd>{{ business.businessName }}</dd></div>
                  <div><dt>Selected Services</dt><dd>{{ selectedServices().length }} service{{ selectedServices().length === 1 ? "" : "s" }} ({{ bookingTotalLabel() }})</dd></div>
                  @for (item of bookingItems(); track item.serviceId; let itemIndex = $index) {
                    @if (serviceById(item.serviceId); as service) {
                      <div class="confirm-service-row">
                        <dt>
                          <span><span class="step-num">{{ itemIndex + 1 }}</span><strong>{{ service.name }}</strong></span>
                          <small>{{ servicePriceLabel(service) }}</small>
                        </dt>
                        <dd>
                          <span><ion-icon name="person-outline"></ion-icon> {{ itemStaffName(item) }}</span>
                          <span><ion-icon name="time-outline"></ion-icon> {{ itemSlotLabel(itemIndex) || "No time selected" }}</span>
                        </dd>
                      </div>
                    }
                  }
                  <div><dt>Payment</dt><dd>Pay at salon</dd></div>
                </dl>
              </article>
              <article class="premium-card trust-card">
                <ion-icon name="checkmark-circle-outline"></ion-icon>
                @if (marketplace.isAuthenticated()) {
                  <h3>Ready to book</h3>
                  <p>Your {{ selectedServices().length }} appointment{{ selectedServices().length === 1 ? '' : 's' }} will be reserved immediately.</p>
                } @else {
                  <h3>Sign in to reserve</h3>
                }
              </article>
            </section>
          }
        </main>

        <div class="booking-cta sticky-cta">
          <div class="bottom-action-card">
            <div>
              <small>{{ selectedServicesSummary() || "Select services" }}</small>
              <strong>{{ bookingTotalLabel() || business.businessName }}</strong>
            </div>
            @if (currentBookingStep() < 4) {
              <ion-button class="primary-gradient" [disabled]="!canContinue()" (click)="next()">Continue</ion-button>
            } @else {
              <ion-button class="primary-gradient" [disabled]="!canConfirm() || marketplace.loading()" (click)="confirmBooking()">
                  {{ isRescheduling() ? "Save changes" : (marketplace.isAuthenticated() ? "Confirm booking" : "Sign in to book") }}
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
    .booking-page { max-width: 980px; padding-bottom: 14px; }
    .edit-toolbar-title {
      padding-inline: 0 16px;
      color: var(--text);
      text-align: left;
      font-size: 1.08rem;
      font-weight: 900;
      letter-spacing: -0.025em;
    }
    .booking-page.editing { padding-top: 8px; }
    .booking-page.editing app-booking-progress { display: block; margin-top: 2px; }
    .booking-cta { width: min(980px, calc(100% - 32px)); margin: 14px auto calc(24px + env(safe-area-inset-bottom)); }
    .booking-cta.sticky-cta { bottom: calc(-30px + env(safe-area-inset-bottom)); }
    .booking-hero { display: grid; gap: 10px; align-items: center; padding: 10px; }
    .booking-hero img { width: 100%; aspect-ratio: 16 / 7; max-height: 150px; height: auto; border-radius: 20px; object-fit: cover; }
    .booking-hero .page-title { font-size: clamp(1.45rem, 4vw, 2.7rem); }
    .booking-intent-row, .resource-grid, .time-mode-row { display: grid; gap: 10px; margin-bottom: 14px; }
    .booking-intent-row { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .booking-intent-row button, .resource-grid button, .time-mode-row button { border: 1px solid var(--border); border-radius: 18px; color: var(--text); background: var(--surface); box-shadow: var(--shadow-soft); font-weight: 900; }
    .booking-intent-row button { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 3px 10px; align-items: center; padding: 14px; text-align: left; }
    .booking-intent-row button.active, .resource-grid button.active, .time-mode-row button.active, .addon-grid button.active { color: #FFFFFF; border-color: transparent; background: var(--primary); }
    .booking-intent-row button:disabled, .resource-grid button:disabled, .time-mode-row button:disabled, .addon-grid button:disabled { cursor: not-allowed; opacity: 0.58; }
    .booking-intent-row ion-icon { grid-row: span 2; font-size: 1.25rem; }
    .booking-intent-row small, .resource-grid small { color: inherit; opacity: 0.72; line-height: 1.35; }
    .readiness-note, .addon-panel, .resource-panel { display: grid; gap: 8px; padding: 16px; margin-bottom: 14px; }
    .readiness-note { border-color: rgba(99, 102, 241, 0.22); background: var(--primary-soft); }
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
    .service-list, .staff-list, .slot-sections { display: grid; gap: 12px; }
    .service-choice, .staff-choice { width: 100%; display: grid; gap: 12px; align-items: center; padding: 16px; border-color: var(--border); color: var(--text); text-align: left; }
    .service-choice { grid-template-columns: minmax(0, 1fr) 112px; align-items: start; }
    .flow-service-media { display: grid; justify-items: center; color: inherit; }
    .flow-service-media img { width: 108px; height: 88px; border-radius: 17px; object-fit: cover; background: var(--surface-soft); box-shadow: 0 10px 22px rgba(16, 24, 40, 0.1); }
    .choice-action { min-width: 76px; min-height: 34px; margin-top: -14px; display: inline-flex; align-items: center; justify-content: center; padding: 0 13px; border: 1px solid rgba(99, 102, 241, 0.2); border-radius: 12px; color: var(--primary); background: #FFFFFF; font-size: 0.82rem; font-weight: 950; box-shadow: 0 8px 18px rgba(16, 24, 40, 0.1); }
    .service-choice.selected .choice-action { color: #059669; border-color: rgba(16, 185, 129, 0.32); background: #D1FAE5; }
    .service-choice.selected, .staff-choice.selected, .date-card.selected, .slot.selected { border-color: rgba(99, 102, 241, 0.48); background: var(--primary-soft); box-shadow: 0 16px 34px rgba(99, 102, 241, 0.14); }
    .service-choice h3 { margin: 0 0 6px; font-size: 1.12rem; letter-spacing: -0.035em; }
    .service-choice p { margin: 0 0 10px; color: var(--muted); line-height: 1.45; }
    .service-choice strong { color: var(--primary-2); }
    .staff-choice { grid-template-columns: auto minmax(0, 1fr) auto; }
    .staff-choice img, .any-avatar { width: 62px; height: 62px; border-radius: 22px; object-fit: cover; }
    .any-avatar { display: grid; place-items: center; color: #FFFFFF; background: linear-gradient(135deg, var(--brand-600), var(--primary), var(--brand-800)); font-size: 1.35rem; }
    .staff-choice span, .staff-choice em { display: block; color: var(--muted); font-style: normal; line-height: 1.35; }
    .staff-choice em { color: var(--primary-2); font-weight: 900; text-align: right; }
    .check-slots-button { justify-self: end; min-height: 42px; padding: 0 14px; border: 1px solid rgba(99, 102, 241, 0.32); border-radius: 999px; color: var(--primary); background: var(--surface); font-weight: 900; white-space: nowrap; }
    .check-slots-button:hover, .check-slots-button:focus-visible { background: var(--gold-soft); }
    .multi-service-stack { display: grid; gap: 14px; }
    .service-schedule-card { display: grid; gap: 12px; padding: 16px; }
    .service-schedule-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
    .service-schedule-head h3 { margin: 0 0 3px; font-size: 1rem; letter-spacing: -0.025em; }
    .service-schedule-head small { color: var(--muted); font-weight: 850; }
    .service-schedule-head > span { width: 28px; height: 28px; display: grid; place-items: center; border-radius: 999px; color: #FFFFFF; background: var(--primary); font-weight: 950; }
    .staff-list.compact { gap: 8px; }
    .staff-list.compact .staff-choice { padding: 11px; border-radius: 16px; }
    .staff-list.compact .staff-choice img, .staff-list.compact .any-avatar { width: 44px; height: 44px; border-radius: 15px; }
    .booking-item-tabs { display: grid; gap: 8px; margin-bottom: 14px; }
    .booking-item-tabs button { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 2px 10px; align-items: center; padding: 12px; border: 1px solid var(--border); border-radius: 16px; color: var(--text); background: var(--surface); text-align: left; box-shadow: var(--shadow-soft); }
    .booking-item-tabs button > span { grid-row: span 2; width: 28px; height: 28px; display: grid; place-items: center; border-radius: 999px; color: var(--primary); background: var(--primary-soft); font-weight: 950; }
    .booking-item-tabs button strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .booking-item-tabs button small { color: var(--muted); font-weight: 800; }
    .booking-item-tabs button.active { border-color: rgba(99, 102, 241, 0.44); background: var(--primary-soft); }
    .booking-item-tabs button.done > span { color: #059669; background: #D1FAE5; }
    .selected-staff-card { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 12px; align-items: center; margin-bottom: 14px; padding: 14px 16px; border-color: rgba(99, 102, 241, 0.28); background: var(--primary-soft); }
    .selected-staff-card span, .selected-staff-card small { display: block; color: var(--muted); line-height: 1.35; }
    .selected-staff-card span { font-size: 0.78rem; font-weight: 900; text-transform: uppercase; letter-spacing: 0.08em; }
    .selected-staff-card strong { display: block; margin-top: 3px; color: var(--text); font-size: 1.02rem; font-weight: 900; }
    .selected-staff-card small { margin-top: 2px; font-weight: 800; }
    .date-row { display: grid; grid-auto-flow: column; grid-auto-columns: minmax(112px, 1fr); gap: 10px; overflow-x: auto; padding-bottom: 12px; scrollbar-width: none; }
    .date-row::-webkit-scrollbar { display: none; }
    .date-card, .slot { border: 1px solid var(--border); border-radius: 18px; background: var(--surface); color: var(--text); font-weight: 900; }
    .date-card { position: relative; display: grid; gap: 5px; justify-items: center; padding: 14px 10px; overflow: hidden; }
    .date-card::before { content: ""; position: absolute; inset: 0 auto 0 0; width: 5px; background: var(--border-strong); }
    .date-card.availability-many { border-color: rgba(29, 151, 76, 0.36); background: linear-gradient(145deg, rgba(232, 250, 239, 0.98), rgba(255, 255, 255, 0.96)); }
    .date-card.availability-many::before { background: #21a657; }
    .date-card.availability-partial { border-color: rgba(236, 145, 28, 0.42); background: linear-gradient(145deg, rgba(255, 242, 220, 0.98), rgba(255, 255, 255, 0.96)); }
    .date-card.availability-partial::before { background: #f09a22; }
    .date-card.availability-full { border-color: rgba(212, 62, 62, 0.38); background: linear-gradient(145deg, rgba(255, 232, 232, 0.98), rgba(255, 255, 255, 0.96)); }
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
    .slot:disabled { color: rgba(82, 101, 121, 0.48); background: var(--surface-soft); text-decoration: line-through; }
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

      .booking-intent-row, .resource-grid, .time-mode-row { grid-template-columns: 1fr; }
      .service-choice { grid-template-columns: minmax(0, 1fr) 98px; }
      .flow-service-media img { width: 94px; height: 78px; border-radius: 15px; }
      .choice-action { min-width: 68px; min-height: 31px; font-size: 0.78rem; }
      .staff-choice { grid-template-columns: 1fr; }
      .staff-choice em { text-align: left; }
      .check-slots-button { justify-self: start; }
      .slot-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    }
    @media (min-width: 768px) {
      .booking-hero { grid-template-columns: 180px minmax(0, 1fr); }
      .staff-choice em { text-align: left; }
      .check-slots-button { justify-self: start; }
      .slot-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    }
    .multi-staff-quick-bar { margin-bottom: 12px; }
    .quick-staff-btn { display: inline-flex; align-items: center; gap: 8px; padding: 10px 14px; border: 1px solid rgba(99, 102, 241, 0.28); border-radius: 999px; color: var(--primary); background: var(--primary-soft); font-size: 0.84rem; font-weight: 900; }
    .multi-service-progress-banner { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 12px 16px; margin-bottom: 12px; border-radius: 18px; color: #FFFFFF; background: linear-gradient(135deg, var(--brand-700, #0F4C81), var(--primary, #6366F1)); }
    .multi-service-progress-banner p { margin: 0; font-size: 0.88rem; }
    .multi-service-progress-banner small { opacity: 0.88; font-weight: 850; font-size: 0.78rem; }
    .confirm-service-row { display: grid !important; grid-template-columns: minmax(0, 1fr) auto !important; align-items: start !important; gap: 8px !important; }
    .confirm-service-row dt { display: grid; gap: 2px; text-align: left; }
    .confirm-service-row dt .step-num { width: 22px; height: 22px; display: inline-grid; place-items: center; border-radius: 999px; color: #fff; background: var(--primary); font-size: 0.72rem; font-weight: 950; margin-right: 6px; }
    .confirm-service-row dd { display: grid; gap: 4px; justify-items: end; text-align: right; font-size: 0.84rem; }
    .confirm-service-row dd ion-icon { vertical-align: middle; margin-right: 2px; }
  `]
})
export class BookingFlowPage implements OnInit {
  readonly step = signal(Number(this.route.snapshot.queryParamMap.get("step") || (this.initialServiceIds().length ? 2 : 1)));
  readonly bookingItems = signal<BookingFlowItem[]>(this.initialServiceIds().map((serviceId) => ({
    serviceId,
    staffId: this.route.snapshot.queryParamMap.get("staffId") || null,
    date: this.route.snapshot.queryParamMap.get("date") ?? "",
    slotStartAt: ""
  })));
  readonly activeItemIndex = signal(0);
  readonly rescheduleBookingId = this.route.snapshot.queryParamMap.get("rescheduleBookingId") ?? "";
  private readonly slug = signal(this.route.snapshot.paramMap.get("slug"));
  readonly business = computed(() => this.marketplace.findBusiness(this.slug()));
  readonly selectedServices = computed(() => this.bookingItems().map((item) => this.serviceById(item.serviceId)).filter((service): service is ServiceItem => !!service));
  readonly selectedService = computed(() => this.activeService() ?? this.selectedServices()[0] ?? null);
  readonly activeItem = computed(() => this.bookingItems()[this.activeItemIndex()] ?? null);
  readonly activeService = computed(() => this.activeItem() ? this.serviceById(this.activeItem()!.serviceId) : null);
  readonly activeStaff = computed(() => this.activeItem()?.staffId ? this.business()?.staff.find((staff) => staff.id === this.activeItem()?.staffId) ?? null : null);
  readonly availabilityDays = computed(() => this.marketplace.availability());
  readonly selectedAvailabilityDay = computed(() => this.availabilityDays().find((day) => day.date === (this.activeItem()?.date || "")) ?? this.availabilityDays()[0] ?? null);
  readonly slotGroups = computed(() => this.selectedAvailabilityDay()?.periods ?? []);
  readonly currentBookingStep = computed(() => this.normalizedStep(this.step()));

  isRescheduling(): boolean {
    return !!this.rescheduleBookingId;
  }

  constructor(private readonly route: ActivatedRoute, private readonly router: Router, readonly marketplace: MarketplaceService) {
    addIcons({ calendarOutline, checkmarkCircleOutline, personOutline, sparklesOutline });
  }

  ngOnInit() {
    this.reload();
  }

  async reload() {
    const slug = await this.resolveBusinessSlug();
    if (!slug) return;
    this.slug.set(slug);
    await this.marketplace.loadBusiness(slug).catch(async () => {
      const fallbackSlug = await this.mySalonBusinessSlug();
      if (!fallbackSlug || fallbackSlug === slug) return;
      this.slug.set(fallbackSlug);
      await this.marketplace.loadBusiness(fallbackSlug).catch(() => undefined);
    });
    if (!this.isRescheduling()) this.restorePendingIntent();
    if (!this.route.snapshot.queryParamMap.has("step")) {
      this.step.set(this.bookingItems().length ? 2 : 1);
    } else if (this.step() < 1 || this.step() > 4) {
      this.step.set(1);
    }
    await this.reloadAvailability();
  }

  private async resolveBusinessSlug(): Promise<string> {
    return this.slug() || await this.mySalonBusinessSlug();
  }

  private async mySalonBusinessSlug(): Promise<string> {
    if (!this.marketplace.salonMode()) return "";
    const existing = this.marketplace.mySalonDashboard()?.salon?.slug || "";
    if (existing) return existing;
    const dashboard = await this.marketplace.loadMySalonDashboard().catch(() => null);
    return dashboard?.salon?.slug || "";
  }

  next() {
    const nextStep = Math.min(this.currentBookingStep() + 1, 4) as BookingProgressStepId;
    this.step.set(nextStep);
    if (nextStep === 3) void this.reloadAvailability();
  }

  goToStep(stepId: BookingProgressStepId) {
    if (stepId > this.currentBookingStep()) return;
    this.step.set(stepId);
    if (stepId === 3) void this.reloadAvailability();
  }

  toggleService(serviceId: string) {
    this.bookingItems.update((items) => {
      if (items.some((item) => item.serviceId === serviceId)) return items.filter((item) => item.serviceId !== serviceId);
      return [...items, { serviceId, staffId: null, date: "", slotStartAt: "" }];
    });
    if (this.activeItemIndex() >= this.bookingItems().length) this.activeItemIndex.set(Math.max(this.bookingItems().length - 1, 0));
    void this.reloadAvailability();
  }

  isServiceSelected(serviceId: string): boolean {
    return this.bookingItems().some((item) => item.serviceId === serviceId);
  }

  setItemStaff(index: number, staffId: string | null) {
    this.bookingItems.update((items) => items.map((item, itemIndex) => itemIndex === index ? { ...item, staffId, slotStartAt: "" } : item));
    if (this.bookingItems().length > 1) {
      const nextIndex = index + 1;
      if (nextIndex < this.bookingItems().length) {
        this.activeItemIndex.set(nextIndex);
      } else {
        this.activeItemIndex.set(index);
      }
    } else {
      this.activeItemIndex.set(index);
    }
    void this.reloadAvailability();
  }

  staffSelectedSummary(): string {
    const total = this.bookingItems().length;
    if (!total) return "";
    return `Service ${this.activeItemIndex() + 1} of ${total}`;
  }

  async checkItemSlots(event: Event, index: number, staffId: string) {
    event.preventDefault();
    event.stopPropagation();
    this.bookingItems.update((items) => items.map((item, itemIndex) => itemIndex === index ? { ...item, staffId, slotStartAt: "" } : item));
    this.activeItemIndex.set(index);
    this.step.set(3);
    await this.reloadAvailability();
  }

  setDate(date: string) {
    this.bookingItems.update((items) => items.map((item) => ({ ...item, date, slotStartAt: "" })));
    void this.reloadAvailability();
  }

  setActiveItem(index: number) {
    this.activeItemIndex.set(index);
    void this.reloadAvailability();
  }

  assignAnyStaffToAll() {
    this.bookingItems.update((items) => items.map((item) => ({ ...item, staffId: null, slotStartAt: "" })));
    void this.reloadAvailability();
  }

  slotsSelectedSummary(): string {
    const selected = this.bookingItems().filter((item) => !!item.slotStartAt).length;
    const total = this.bookingItems().length;
    return `${selected} of ${total} slots chosen`;
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
    if (this.currentBookingStep() === 1) return this.bookingItems().length > 0;
    if (this.currentBookingStep() === 2) return this.bookingItems().length > 0;
    if (this.currentBookingStep() === 3) return this.bookingItems().length > 0 && this.bookingItems().every((item) => !!item.slotStartAt);
    return true;
  }

  canConfirm(): boolean {
    return !!this.business() && this.bookingItems().length > 0 && this.bookingItems().every((item) => !!this.serviceById(item.serviceId) && !!item.slotStartAt);
  }

  private normalizedStep(step: number): BookingProgressStepId {
    const clamped = Math.min(Math.max(Math.trunc(step) || 1, 1), 4) as BookingProgressStepId;
    if (!this.bookingItems().length) return 1;
    if (clamped === 4 && !this.canConfirm()) return 3;
    return clamped;
  }

  money(pricePaise: number): string {
    return this.marketplace.formatMoney(pricePaise);
  }

  bookingTotalLabel(): string {
    const total = this.selectedServices().reduce((sum, service) => sum + service.pricePaise, 0);
    const minutes = this.selectedServices().reduce((sum, service) => sum + service.durationMinutes, 0);
    if (!total) return "";
    return minutes > 0 ? `${this.money(total)} · Total ${minutes} min` : this.money(total);
  }

  servicePriceLabel(service: ServiceItem): string {
    return service.durationMinutes > 0 ? `${this.money(service.pricePaise)} · ${service.durationMinutes} min` : this.money(service.pricePaise);
  }

  activeServiceLabel(service: ServiceItem): string {
    return service.durationMinutes > 0 ? `${service.name} · ${service.durationMinutes} min` : service.name;
  }

  selectedServicesSummary(): string {
    const count = this.selectedServices().length;
    if (!count) return "";
    if (this.currentBookingStep() === 3 && count > 1) {
      const set = this.bookingItems().filter((item) => !!item.slotStartAt).length;
      if (set < count) return `${set} of ${count} slots chosen — Select time for next service`;
      return `All ${count} slots selected`;
    }
    return `${count} service${count === 1 ? "" : "s"} selected`;
  }

  serviceImage(service: ServiceItem, index: number): string {
    const withImage = service as ServiceItem & { image?: string; imageUrl?: string; photoUrl?: string; thumbnailUrl?: string };
    const business = this.business();
    return withImage.image || withImage.imageUrl || withImage.photoUrl || withImage.thumbnailUrl || business?.galleryImages?.[index % Math.max(business.galleryImages.length, 1)] || business?.coverImage || "assets/icons/icon.svg";
  }

  async confirmBooking() {
    const business = this.business();
    const items = this.bookingItems();
    if (!business || !items.length || !this.canConfirm()) return;
    if (!this.isRescheduling()) this.savePendingIntent();
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
    if (this.rescheduleBookingId) {
      const item = items[0];
      await this.marketplace.rescheduleBooking(this.rescheduleBookingId, {
        startAt: item.slotStartAt,
        staffId: item.staffId || undefined,
        serviceId: item.serviceId
      });
      await this.router.navigateByUrl(this.bookingDetailUrl(this.rescheduleBookingId), { replaceUrl: true });
      return;
    }
    for (const item of items) {
      await this.marketplace.createBooking({
        businessSlug: business.slug,
        businessId: business.id,
        serviceId: item.serviceId,
        staffId: item.staffId || undefined,
        startAt: item.slotStartAt,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        paymentMode: "pay_at_venue"
      });
    }
    this.clearPendingIntent();
    this.router.navigateByUrl(this.marketplace.salonMode() ? this.marketplace.salonModeUrl("booking", "success") : "/booking/success");
  }

  backHref(): string {
    return this.marketplace.salonMode() ? this.marketplace.salonModeUrl() : "/tabs/home";
  }

  private bookingDetailUrl(id: string): string {
    return this.marketplace.salonMode() ? this.marketplace.salonModeUrl("bookings", id) : `/bookings/${encodeURIComponent(id)}`;
  }

  private async revalidateSelectedSlot(): Promise<boolean> {
    for (let index = 0; index < this.bookingItems().length; index += 1) {
      this.activeItemIndex.set(index);
      const item = this.bookingItems()[index];
      await this.reloadAvailability();
      const available = this.marketplace.availability()
        .flatMap((day) => day.periods)
        .flatMap((period) => period.slots)
        .some((slot) => slot.startAt === item.slotStartAt && this.isSlotSelectable(slot));
      if (!available) {
        this.bookingItems.update((items) => items.map((row, rowIndex) => rowIndex === index ? { ...row, slotStartAt: "" } : row));
        this.step.set(3);
        this.marketplace.error.set("One selected slot was just taken or overlaps another service. Please choose another time.");
        return false;
      }
    }
    return true;
  }

  private async reloadAvailability() {
    const business = this.business();
    const item = this.activeItem();
    const service = this.activeService();
    if (!business || !service) return;
    const queryDate = item?.date || this.bookingItems().find((row) => row.date)?.date || new Date().toISOString().slice(0, 10);
    const days = await this.marketplace.loadAvailability(business.slug, {
      serviceId: service.id,
      staffId: item?.staffId || undefined,
      date: queryDate,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone
    }).catch(() => []);
    if (days[0]?.date) {
      const activeIdx = this.activeItemIndex();
      this.bookingItems.update((items) => items.map((row, rowIndex) => {
        if (!row.date || rowIndex === activeIdx) return { ...row, date: row.date || days[0].date };
        return row;
      }));
    }
  }

  serviceById(serviceId: string): ServiceItem | null {
    return this.business()?.services.find((service) => service.id === serviceId) ?? null;
  }

  staffForService(service: ServiceItem): StaffMember[] {
    return this.business()?.staff.filter((staff) => !staff.bookableServiceIds?.length || staff.bookableServiceIds.includes(service.id)) ?? [];
  }

  itemStaffName(item: BookingFlowItem): string {
    return item.staffId ? this.business()?.staff.find((staff) => staff.id === item.staffId)?.name ?? "Selected staff" : "Any professional";
  }

  activeStaffName(): string {
    const item = this.activeItem();
    return item ? this.itemStaffName(item) : "Any available professional";
  }

  itemSlotLabel(index: number): string {
    const item = this.bookingItems()[index];
    if (!item?.slotStartAt) return "";
    const slot = this.availabilityDays().flatMap((day) => day.periods).flatMap((period) => period.slots).find((row) => row.startAt === item.slotStartAt);
    return slot?.displayTime ?? this.formatSlotTime(item.slotStartAt);
  }

  selectActiveSlot(slot: AvailabilitySlot) {
    if (!this.isSlotSelectable(slot)) return;
    const currentIndex = this.activeItemIndex();
    const selectedDate = this.activeItem()?.date || "";

    this.bookingItems.update((items) => items.map((item, index) => {
      if (index === currentIndex) return { ...item, slotStartAt: slot.startAt };
      if (!item.date && selectedDate) return { ...item, date: selectedDate };
      return item;
    }));

    const nextUnsetIndex = this.bookingItems().findIndex((item, index) => index > currentIndex && !item.slotStartAt);
    const anyUnsetIndex = this.bookingItems().findIndex((item) => !item.slotStartAt);

    if (nextUnsetIndex !== -1) {
      this.activeItemIndex.set(nextUnsetIndex);
      void this.reloadAvailability();
    } else if (anyUnsetIndex !== -1 && anyUnsetIndex !== currentIndex) {
      this.activeItemIndex.set(anyUnsetIndex);
      void this.reloadAvailability();
    }
  }

  isSlotSelectable(slot: AvailabilitySlot): boolean {
    if (!slot.available) return false;
    const activeService = this.activeService();
    if (!activeService) return false;
    const candidateStart = new Date(slot.startAt).getTime();
    const candidateEnd = new Date(slot.endAt || new Date(candidateStart + activeService.durationMinutes * 60000).toISOString()).getTime();
    if (!Number.isFinite(candidateStart) || !Number.isFinite(candidateEnd)) return false;
    return !this.bookingItems().some((item, index) => {
      if (index === this.activeItemIndex() || !item.slotStartAt) return false;
      const service = this.serviceById(item.serviceId);
      if (!service) return false;
      const start = new Date(item.slotStartAt).getTime();
      const end = start + service.durationMinutes * 60000;
      return candidateStart < end && start < candidateEnd;
    });
  }

  private formatSlotTime(value: string): string {
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return "Selected";
    return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  }

  private initialServiceIds(): string[] {
    const multi = this.route.snapshot.queryParamMap.get("serviceIds");
    const ids = multi ? multi.split(",") : [this.route.snapshot.queryParamMap.get("serviceId") || ""];
    return Array.from(new Set(ids.map((id) => id.trim()).filter(Boolean)));
  }

  private savePendingIntent() {
    const slug = this.slug();
    if (!slug) return;
    const intent: PendingBookingIntent = {
      slug,
      items: this.bookingItems(),
      activeItemIndex: this.activeItemIndex(),
      date: this.activeItem()?.date || "",
      step: this.currentBookingStep(),
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
      if (intent.items?.length) {
        this.bookingItems.set(intent.items);
        this.activeItemIndex.set(Math.min(intent.activeItemIndex ?? 0, intent.items.length - 1));
      } else if (intent.serviceId) {
        this.bookingItems.set([{ serviceId: intent.serviceId, staffId: intent.staffId || null, date: intent.date || "", slotStartAt: intent.slotStartAt || "" }]);
      }
      if (intent.step >= 1 && intent.step <= 4) this.step.set(intent.step);
    } catch {
      this.clearPendingIntent();
    }
  }

  private clearPendingIntent() {
    try {
      localStorage.removeItem(PENDING_BOOKING_INTENT_KEY);
    } catch {
      // Ignore unavailable storage.
    }
  }

  private profileComplete(customer: { profileComplete?: boolean; firstName?: string; lastName?: string; email?: string; phone?: string }): boolean {
    return Boolean(customer.profileComplete)
      || (!!String(customer.firstName || "").trim()
        && !!String(customer.lastName || "").trim()
        && !!String(customer.email || "").trim()
        && !!String(customer.phone || "").trim());
  }
}
