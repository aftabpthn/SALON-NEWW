import { Component, OnInit, computed, signal } from "@angular/core";
import { ActivatedRoute, Router } from "@angular/router";
import { IonButton, IonContent, IonIcon } from "@ionic/angular/standalone";
import { addIcons } from "ionicons";
import { calendarOutline, checkmarkCircleOutline, personOutline, sparklesOutline } from "ionicons/icons";
import { MarketplaceService } from "../../core/marketplace.service";
import { AvailabilityDay, AvailabilitySlot, ServiceItem, StaffMember } from "../../core/api.types";
import { BookingProgressComponent, BookingProgressStepId } from "./booking-progress.component";
import { CustomerMobileHeaderComponent } from "../../shared/customer-mobile-header.component";

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
  imports: [IonButton, IonContent, IonIcon, BookingProgressComponent, CustomerMobileHeaderComponent],
  template: `
    <aura-customer-mobile-header
      [title]="isRescheduling() ? 'Edit appointment' : 'Book appointment'"
      [subtitle]="business()?.businessName || 'Select your service'"
      [backHref]="backHref()" />

    <ion-content>
      @if (business(); as business) {
        <main class="page booking-page" [class.editing]="isRescheduling()">
          @if (!isRescheduling()) {
            <section class="booking-hero premium-card">
              <div>
                <h1 class="page-title">Book your visit</h1>
                <p class="muted">{{ business.businessName }} · {{ business.area }} · {{ business.ratingAverage }} rating</p>
              </div>
            </section>
          }

          @if (marketplace.error()) {
            <section class="state-card premium-card error"><h2>Booking data unavailable</h2><p>{{ marketplace.error() }}</p><ion-button class="primary-gradient" (click)="reload()">Retry</ion-button></section>
          }

          @if (isRescheduling()) {
            <section class="edit-context-card premium-card" aria-label="Current appointment being edited">
              <span>Edit appointment</span>
              <strong>{{ activeService()?.name || selectedServices()[0]?.name || 'Selected service' }}</strong>
              <small>{{ itemSlotLabel(0) || 'Current time will be preserved until changed' }} · {{ activeStaffName() }}</small>
            </section>
          }

          <app-booking-progress [currentStep]="currentBookingStep()" (stepSelect)="goToStep($event)" />

          @if (currentBookingStep() === 1) {
            <section class="panel">
              <div class="section-heading"><div><h2 class="section-title">Choose a service</h2></div></div>
              <div class="service-list">
                @for (service of business.services; track service.id) {
                  <button class="service-choice premium-card" [class.selected]="isServiceSelected(service.id)" (click)="toggleService(service.id)">
                    <div class="service-choice-copy">
                      <h3>{{ service.name }}</h3>
                      @if (service.description) { <p>{{ service.description }}</p> }
                      <span>{{ service.durationMinutes || 0 }} min</span>
                    </div>
                    <span class="service-choice-side">
                      <strong>{{ money(service.pricePaise) }}</strong>
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
                          <em>{{ item.staffId === null ? "Selected" : "Recommended" }}</em>
                        </button>
                        @for (staff of staffForService(service); track staff.id) {
                          <button type="button" class="staff-choice premium-card" [class.selected]="item.staffId === staff.id" (click)="setItemStaff(activeItemIndex(), staff.id)">
                            <img [src]="staff.image || 'assets/icons/icon.svg'" [alt]="staff.name" />
                            <div>
                              <strong>{{ staff.name }}</strong>
                              <span>{{ staff.title }} @if (staff.rating) { · {{ staff.rating }} rating }</span>
                            </div>
                            <em>{{ item.staffId === staff.id ? "Selected" : "Select" }}</em>
                          </button>
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
                <article class="schedule-context-card premium-card" aria-live="polite">
                  <div class="schedule-context-count">
                     <span>Service {{ activeItemIndex() + 1 }} of {{ bookingItems().length }}</span>
                  </div>
                  <div class="schedule-context-copy">
                     <strong>{{ activeService()?.name }}</strong>
                     <span>{{ activeStaffName() }} @if (activeService(); as service) { · {{ service.durationMinutes || 0 }} min }</span>
                  </div>
                </article>
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
              @if (scheduledServiceSummaries().length) {
                <section class="scheduled-services-card premium-card" aria-label="Scheduled services">
                  <span>Already scheduled</span>
                  <div>
                    @for (scheduled of scheduledServiceSummaries(); track scheduled.index) {
                      <button type="button" [class.active]="scheduled.active" (click)="setActiveItem(scheduled.index)">
                        <strong>{{ scheduled.index + 1 }}. {{ scheduled.name }}</strong>
                        <small>{{ scheduled.time }} · {{ scheduled.staff }}</small>
                      </button>
                    }
                  </div>
                </section>
              }
              <article class="selected-staff-card premium-card">
                <div class="any-avatar"><ion-icon name="person-outline"></ion-icon></div>
                <div>
                  <span>Available times for {{ activeService()?.name }}</span>
                  <strong>{{ activeStaffName() }}</strong>
                  @if (activeService(); as service) { <small>{{ activeServiceLabel(service) }}</small> }
                  <small class="selected-slot-note">{{ activeSlotStatusLabel() }}</small>
                </div>
              </article>
              <div class="date-row">
                @if (marketplace.loading() && !availabilityDays().length) {
                  @for (item of [1, 2, 3, 4, 5]; track item) {
                    <div class="date-card skeleton-date" aria-hidden="true">
                      <span class="skeleton-line short"></span>
                      <span class="skeleton-line"></span>
                      <span class="skeleton-line mini"></span>
                    </div>
                  }
                } @else {
                  @for (date of availabilityDays(); track date.date) {
                    <button
                      class="date-card"
                      [class.selected]="activeItem().date === date.date"
                      [disabled]="dateAvailabilityClass(date) === 'full'"
                      [attr.aria-label]="dateCardLabel(date)"
                      [attr.aria-pressed]="activeItem().date === date.date"
                      (click)="setDate(date.date)">
                      <strong>{{ date.dayLabel }}</strong>
                      <span>{{ date.label }}</span>
                      <em aria-hidden="true"></em>
                    </button>
                  } @empty {
                    <section class="state-card premium-card stable-state"><h2>No slots available</h2></section>
                  }
                }
              </div>
              <div class="slot-sections">
                @if (marketplace.loading() && !slotGroups().length) {
                  <section class="slot-group premium-card skeleton-slot-group" aria-label="Loading time slots" aria-busy="true">
                    <span class="skeleton-line heading"></span>
                    <div class="slot-grid">
                      @for (item of [1, 2, 3, 4, 5, 6]; track item) {
                        <span class="slot skeleton-slot" aria-hidden="true"></span>
                      }
                    </div>
                  </section>
                } @else {
                  @for (group of slotGroups(); track group.label) {
                    <section class="slot-group premium-card">
                      <h3>{{ group.label }}</h3>
                      <div class="slot-grid">
                        @for (slot of group.slots; track slot.startAt) {
                          <button
                            class="slot"
                            [disabled]="!isSlotSelectable(slot) || activeItem().slotStartAt === slot.startAt"
                            [class.selected]="activeItem().slotStartAt === slot.startAt"
                            [attr.aria-pressed]="activeItem().slotStartAt === slot.startAt"
                            (click)="selectActiveSlot(slot)">
                            {{ slot.displayTime }}
                          </button>
                        }
                      </div>
                    </section>
                  } @empty {
                    <section class="state-card premium-card stable-state"><h2>No time slots</h2></section>
                  }
                }
              </div>
            </section>
          }

          @if (currentBookingStep() === 4) {
            <section class="panel confirm-grid">
              <article class="premium-card confirm-card">
                <h2>{{ isRescheduling() ? "Confirm your changes" : "Confirm your booking" }}</h2>
                <section class="review-group review-priority-group" aria-label="Booking summary">
                  <div class="review-summary-strip">
                    <span><small>Services</small><strong>{{ serviceCountLabel() }}</strong></span>
                    <span><small>Duration</small><strong>{{ durationLabel() }}</strong></span>
                    <span class="review-total"><small>Total</small><strong>{{ totalPriceLabel() }}</strong></span>
                  </div>
                </section>

                <section class="review-group" aria-label="Services and times">
                  <h3>Services & times</h3>
                  <dl class="multi-service-summary-dl">
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
                  </dl>
                </section>

                <section class="review-group" aria-label="Salon and payment">
                  <h3>Salon & payment</h3>
                  <dl class="review-meta-dl">
                    <div><dt>Salon</dt><dd>{{ business.businessName }}</dd></div>
                    <div><dt>Payment</dt><dd>Pay at salon</dd></div>
                  </dl>
                </section>
              </article>
            </section>
          }
        </main>

        <div class="booking-cta sticky-cta">
          <div class="bottom-action-card">
            <div class="booking-summary-metrics" aria-label="Booking summary">
              <strong>{{ serviceCountLabel() }} · {{ durationLabel() }}</strong>
              <span>{{ totalPriceLabel() }}</span>
            </div>
            @if (currentBookingStep() < 4) {
              <ion-button class="primary-gradient" [disabled]="!canContinue()" (click)="next()">Continue</ion-button>
            } @else {
              <ion-button class="primary-gradient" [disabled]="!canConfirm() || marketplace.loading()" (click)="confirmBooking()">
                  @if (marketplace.loading()) { <span class="button-spinner" aria-hidden="true"></span> }
                  <span>{{ isRescheduling() ? "Save changes" : (marketplace.isAuthenticated() ? "Confirm booking" : "Sign in to book") }}</span>
              </ion-button>
            }
          </div>
        </div>
      } @else {
        <main class="page-narrow">
          @if (marketplace.loading()) {
            <section class="state-card premium-card booking-flow-skeleton" aria-label="Loading booking flow" aria-busy="true">
              <span class="skeleton-line title"></span>
              <span class="skeleton-line wide"></span>
              <span class="skeleton-line"></span>
              <div class="slot-grid">
                @for (item of [1, 2, 3, 4, 5, 6]; track item) {
                  <span class="slot skeleton-slot" aria-hidden="true"></span>
                }
              </div>
            </section>
          } @else {
            <section class="state-card premium-card error"><h1>Booking unavailable</h1><p>{{ marketplace.error() || "The business could not be loaded." }}</p><ion-button class="primary-gradient" (click)="reload()">Retry</ion-button></section>
          }
        </main>
      }
    </ion-content>
  `,
  styles: [`
    :host { --booking-footer-height: 88px; --booking-footer-gap: 16px; }
    .booking-page { max-width: 980px; padding-bottom: calc(var(--booking-footer-height) + var(--booking-footer-gap) + env(safe-area-inset-bottom)); }
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
    .booking-cta { width: min(980px, calc(100% - 24px)); margin: 0 auto; }
    .booking-cta.sticky-cta { bottom: calc(8px + env(safe-area-inset-bottom)); }
    .booking-cta .bottom-action-card { height: var(--booking-footer-height); display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 12px; padding: 12px; overflow: hidden; }
    .booking-summary-metrics { min-width: 0; display: grid; gap: 4px; }
    .booking-summary-metrics strong, .booking-summary-metrics span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .booking-summary-metrics strong { color: var(--text); font-size: 0.88rem; font-weight: 900; line-height: 1.15; }
    .booking-summary-metrics span { color: var(--primary); font-size: 1rem; font-weight: 950; line-height: 1.1; }
    .booking-cta .bottom-action-card ion-button { min-width: 128px; height: 48px; margin: 0; }
    .button-spinner { width: 16px; height: 16px; display: inline-block; margin-right: 8px; border: 2px solid rgba(255,255,255,.5); border-top-color: #fff; border-radius: 999px; animation: button-spin 700ms linear infinite; vertical-align: -3px; }
    .booking-hero { display: grid; gap: 4px; align-items: center; padding: 16px; }
    .booking-hero .page-title { font-size: clamp(1.45rem, 4vw, 2.7rem); }
    .edit-context-card { display: grid; gap: 4px; padding: 12px 16px; border-color: rgba(99, 102, 241, 0.24); background: var(--primary-soft); }
    .edit-context-card span { color: var(--primary); font-size: 0.76rem; font-weight: 900; }
    .edit-context-card strong, .edit-context-card small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .edit-context-card strong { color: var(--text); font-size: 0.96rem; }
    .edit-context-card small { color: var(--muted); font-size: 0.82rem; font-weight: 800; }
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
    .service-choice { grid-template-columns: minmax(0, 1fr) auto; align-items: center; min-height: 76px; gap: 12px; padding: 12px; transition: none; }
    .service-choice-copy { min-width: 0; display: grid; gap: 4px; }
    .service-choice-side { display: grid; justify-items: end; gap: 8px; color: inherit; }
    .choice-action { min-width: 72px; min-height: 36px; display: inline-flex; align-items: center; justify-content: center; padding: 0 12px; border: 1px solid rgba(99, 102, 241, 0.24); border-radius: 999px; color: var(--primary); background: var(--surface); font-size: 0.8rem; font-weight: 950; }
    .service-choice.selected .choice-action { color: #FFFFFF; border-color: transparent; background: var(--primary); }
    .service-choice.selected, .staff-choice.selected { border-color: rgba(99, 102, 241, 0.48); background: var(--primary-soft); box-shadow: 0 12px 24px rgba(99, 102, 241, 0.12); }
    .service-choice h3 { margin: 0 0 4px; font-size: 1.06rem; letter-spacing: -0.035em; line-height: 1.15; }
    .service-choice p { display: -webkit-box; margin: 0; overflow: hidden; color: var(--muted); font-size: 0.82rem; line-height: 1.3; -webkit-box-orient: vertical; -webkit-line-clamp: 1; }
    .service-choice-copy span { color: var(--muted); font-size: 0.78rem; font-weight: 800; }
    .service-choice strong { color: var(--primary); font-size: 0.92rem; }
    .staff-choice { position: relative; grid-template-columns: auto minmax(0, 1fr) auto; min-height: 76px; gap: 10px; padding: 12px 14px; transition: none; }
    .staff-choice.selected { outline: 2px solid rgba(99, 102, 241, 0.28); outline-offset: 2px; }
    .staff-choice img, .any-avatar { width: 54px; height: 54px; border-radius: 18px; object-fit: cover; }
    .any-avatar { display: grid; place-items: center; color: #FFFFFF; background: var(--primary); font-size: 1.35rem; }
    .staff-choice strong { display: block; line-height: 1.15; }
    .staff-choice span, .staff-choice em { display: block; color: var(--muted); font-style: normal; line-height: 1.25; }
    .staff-choice em { min-width: 68px; min-height: 36px; display: inline-flex; align-items: center; justify-content: center; padding: 0 12px; border-radius: 999px; color: var(--primary); background: var(--surface); font-size: 0.78rem; font-weight: 900; text-align: center; }
    .staff-choice.selected em { color: #FFFFFF; background: var(--primary); }
    .check-slots-button { justify-self: end; min-height: 40px; padding: 0 13px; border: 1px solid rgba(99, 102, 241, 0.32); border-radius: 999px; color: var(--primary); background: var(--surface); font-size: 0.8rem; font-weight: 900; white-space: nowrap; }
    .check-slots-button:hover, .check-slots-button:focus-visible { background: var(--gold-soft); }
    .multi-service-stack { display: grid; gap: 14px; }
    .service-schedule-card { display: grid; gap: 12px; padding: 16px; }
    .service-schedule-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
    .service-schedule-head h3 { margin: 0 0 3px; font-size: 1rem; letter-spacing: -0.025em; }
    .service-schedule-head small { color: var(--muted); font-weight: 850; }
    .service-schedule-head > span { width: 28px; height: 28px; display: grid; place-items: center; border-radius: 999px; color: #FFFFFF; background: var(--primary); font-weight: 950; }
    .schedule-context-card { position: sticky; top: 0; z-index: 16; display: grid; gap: 4px; align-items: center; margin-bottom: 12px; padding: 12px 14px; border-color: rgba(99, 102, 241, 0.24); background: var(--glass); backdrop-filter: blur(14px); }
    .schedule-context-count span { color: var(--primary); font-size: 0.76rem; font-weight: 900; line-height: 1.2; }
    .schedule-context-copy { min-width: 0; display: grid; gap: 3px; }
    .schedule-context-copy strong, .schedule-context-copy span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .schedule-context-copy strong { color: var(--text); font-size: 1rem; line-height: 1.12; }
    .schedule-context-copy span { color: var(--muted); font-size: 0.82rem; font-weight: 800; }
    .scheduled-services-card { display: grid; gap: 8px; margin-bottom: 12px; padding: 12px; }
    .scheduled-services-card > span { color: var(--muted); font-size: 0.68rem; font-weight: 950; letter-spacing: 0.08em; text-transform: uppercase; }
    .scheduled-services-card > div { display: grid; gap: 7px; }
    .scheduled-services-card button { display: grid; grid-template-columns: minmax(0, 1fr); gap: 2px; min-height: 48px; padding: 9px 10px; border: 1px solid var(--border); border-radius: 14px; color: var(--text); background: var(--surface); text-align: left; }
    .scheduled-services-card button.active { border-color: rgba(99, 102, 241, 0.4); background: var(--primary-soft); }
    .scheduled-services-card strong, .scheduled-services-card small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .scheduled-services-card strong { font-size: 0.82rem; }
    .scheduled-services-card small { color: var(--muted); font-size: 0.74rem; font-weight: 800; }
    .staff-list.compact { gap: 8px; }
    .staff-list.compact .staff-choice { min-height: 68px; padding: 9px 10px; border-radius: 16px; }
    .staff-list.compact .staff-choice img, .staff-list.compact .any-avatar { width: 42px; height: 42px; border-radius: 14px; }
    .booking-item-tabs { display: grid; gap: 8px; margin-bottom: 14px; }
    .booking-item-tabs button { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 2px 10px; align-items: center; padding: 12px; border: 1px solid var(--border); border-radius: 16px; color: var(--text); background: var(--surface); text-align: left; box-shadow: var(--shadow-soft); }
    .booking-item-tabs button > span { grid-row: span 2; width: 28px; height: 28px; display: grid; place-items: center; border-radius: 999px; color: var(--primary); background: var(--primary-soft); font-weight: 950; }
    .booking-item-tabs button strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .booking-item-tabs button small { color: var(--muted); font-weight: 800; }
    .booking-item-tabs button.active { border-color: rgba(99, 102, 241, 0.44); background: var(--primary-soft); }
    .booking-item-tabs button.done > span { color: #059669; background: #D1FAE5; }
    .selected-staff-card { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 12px; align-items: center; margin-bottom: 14px; padding: 14px 16px; border-color: rgba(99, 102, 241, 0.28); background: var(--primary-soft); }
    .selected-staff-card span, .selected-staff-card small { display: block; color: var(--muted); line-height: 1.35; }
    .selected-staff-card span { font-size: 0.78rem; font-weight: 900; letter-spacing: 0; }
    .selected-staff-card strong { display: block; margin-top: 3px; color: var(--text); font-size: 1.02rem; font-weight: 900; }
    .selected-staff-card small { margin-top: 2px; font-weight: 800; }
    .selected-staff-card .selected-slot-note { color: var(--primary); }
    .date-row { display: grid; grid-auto-flow: column; grid-auto-columns: minmax(98px, 1fr); gap: 8px; overflow-x: auto; padding: 2px 1px 12px; overscroll-behavior-x: contain; scroll-snap-type: x proximity; scrollbar-width: none; -webkit-overflow-scrolling: touch; }
    .date-row::-webkit-scrollbar { display: none; }
    .date-card, .slot { border: 1px solid var(--border); border-radius: 18px; background: var(--surface); color: var(--text); font-weight: 900; }
    .date-card { position: relative; display: grid; gap: 4px; justify-items: center; min-height: 78px; padding: 12px 10px 10px; overflow: hidden; scroll-snap-align: start; }
    .date-card.selected { color: #FFFFFF; border-color: transparent; background: var(--primary); box-shadow: 0 10px 24px rgba(99, 102, 241, 0.16); }
    .date-card.selected span { color: rgba(255,255,255,.82); }
    .date-card:disabled { color: var(--muted); border-color: var(--border); background: var(--surface-soft); opacity: .58; box-shadow: none; }
    .date-card strong { line-height: 1.05; }
    .date-card span { color: var(--muted); font-size: 0.78rem; line-height: 1.05; }
    .date-card em { display: none; }
    .skeleton-line { display: block; width: 100%; height: 12px; border-radius: 999px; background: linear-gradient(90deg, rgba(232, 232, 232, 0.92), rgba(244, 244, 242, 0.98), rgba(232, 232, 232, 0.92)); background-size: 220% 100%; animation: booking-skeleton 1.15s ease-in-out infinite; }
    .skeleton-line.title { width: min(260px, 75%); height: 28px; border-radius: 12px; }
    .skeleton-line.heading { width: 112px; height: 18px; margin-bottom: 12px; border-radius: 10px; }
    .skeleton-line.wide { width: min(520px, 100%); }
    .skeleton-line.short { width: 58%; }
    .skeleton-line.mini { width: 42%; height: 9px; }
    .date-card.skeleton-date { min-height: 89px; align-content: center; gap: 8px; pointer-events: none; }
    .slot-group, .state-card { padding: 16px; }
    .slot-group h3, .state-card h2, .state-card h1 { margin: 0 0 12px; letter-spacing: -0.035em; }
    .state-card.error p { color: #EF4444; }
    .state-card.stable-state { min-height: 96px; display: grid; align-content: center; }
    .booking-flow-skeleton { min-height: 320px; display: grid; align-content: start; gap: 14px; }
    .skeleton-slot-group { min-height: 158px; }
    .slot-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; }
    .slot { min-height: 46px; display: inline-flex; align-items: center; justify-content: center; padding: 0 8px; border-color: var(--border); color: var(--text); background: var(--surface); font-size: 0.9rem; line-height: 1; transition: none; }
    .slot:not(:disabled):not(.selected):hover, .slot:not(:disabled):not(.selected):focus-visible { border-color: rgba(99, 102, 241, 0.42); }
    .slot.skeleton-slot { min-height: 45px; border-color: transparent; background: linear-gradient(90deg, rgba(232, 232, 232, 0.92), rgba(244, 244, 242, 0.98), rgba(232, 232, 232, 0.92)); background-size: 220% 100%; animation: booking-skeleton 1.15s ease-in-out infinite; pointer-events: none; }
    .slot.selected { position: relative; color: #FFFFFF; border-color: transparent; background: var(--primary); box-shadow: 0 14px 28px rgba(99, 102, 241, 0.22); text-decoration: none; opacity: 1; }
    .slot.selected::after { content: none; }
    .slot:disabled:not(.selected) { color: rgba(105, 105, 105, 0.45); border-color: rgba(232, 232, 232, 0.9); background: var(--surface-soft); text-decoration: none; box-shadow: none; }
    .confirm-grid { display: grid; gap: 12px; }
    .confirm-card, .trust-card { padding: 16px; }
    .confirm-card h2, .trust-card h3 { margin: 0 0 10px; letter-spacing: -0.04em; }
    .review-group { display: grid; gap: 10px; padding-top: 12px; margin-top: 12px; border-top: 1px solid var(--border); }
    .review-priority-group { padding-top: 0; margin-top: 0; border-top: 0; }
    .review-group h3 { margin: 0; color: var(--muted); font-size: 0.74rem; font-weight: 950; letter-spacing: 0.08em; text-transform: uppercase; }
    .review-summary-strip { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; }
    .review-summary-strip span { min-width: 0; display: grid; gap: 3px; padding: 11px 10px; border: 1px solid var(--border); border-radius: 16px; background: var(--surface); }
    .review-summary-strip small { color: var(--muted); font-size: 0.64rem; font-weight: 950; letter-spacing: 0.08em; text-transform: uppercase; }
    .review-summary-strip strong { overflow: hidden; color: var(--text); font-size: 0.92rem; font-weight: 950; line-height: 1.1; text-overflow: ellipsis; white-space: nowrap; }
    .review-summary-strip .review-total { border-color: rgba(99, 102, 241, 0.34); background: var(--primary-soft); }
    .review-summary-strip .review-total strong { color: var(--primary); font-size: 1.08rem; }
    dl { display: grid; gap: 2px; margin: 0; }
    dl div { display: flex; justify-content: space-between; gap: 18px; padding: 10px 0; border-bottom: 1px solid var(--border); }
    dt { color: var(--muted); font-weight: 800; }
    dd { margin: 0; font-weight: 900; text-align: right; }
    .trust-card { display: grid; gap: 6px; align-content: start; }
    .trust-card ion-icon { color: #10B981; font-size: 1.55rem; }
    .trust-card h3 { margin-bottom: 0; }
    .trust-card p { margin: 0; color: var(--muted); line-height: 1.38; }
      .sticky-cta { bottom: calc(24px + env(safe-area-inset-bottom)); }
      .sticky-cta--confirm { bottom: calc(8px + env(safe-area-inset-bottom)); }
    @media (max-width: 599px) {
      .booking-page { padding-bottom: calc(var(--booking-footer-height) + 24px + env(safe-area-inset-bottom)); }

      .sticky-cta { bottom: calc(10px + env(safe-area-inset-bottom)); }

      .sticky-cta--confirm {
        bottom: calc(2px + env(safe-area-inset-bottom));
      }

      .booking-cta { width: min(100% - 16px, 980px); }
      .booking-cta .bottom-action-card { height: var(--booking-footer-height); gap: 8px; padding: 12px; border-radius: 20px; }
      .booking-summary-metrics strong { font-size: 0.82rem; }
      .booking-summary-metrics span { font-size: 0.94rem; }

      .booking-cta .bottom-action-card ion-button { min-width: 112px; height: 44px; }

      .booking-intent-row, .resource-grid, .time-mode-row { grid-template-columns: 1fr; }
      .service-list { gap: 8px; }
      .service-choice { grid-template-columns: minmax(0, 1fr) auto; min-height: 72px; gap: 8px; padding: 10px 12px; border-radius: 18px; }
      .service-choice h3 { margin-bottom: 3px; font-size: 0.98rem; line-height: 1.12; }
      .service-choice p { margin-bottom: 6px; font-size: 0.82rem; line-height: 1.28; }
      .service-choice strong { font-size: 0.84rem; }
      .choice-action { min-width: 64px; min-height: 34px; padding-inline: 10px; font-size: 0.76rem; }
      .staff-choice { grid-template-columns: 44px minmax(0, 1fr) auto; min-height: 64px; gap: 9px; padding: 9px 10px; }
      .staff-choice img, .any-avatar { width: 44px; height: 44px; border-radius: 14px; }
      .staff-choice strong { font-size: 0.92rem; }
      .staff-choice span { font-size: 0.78rem; }
      .staff-choice em { font-size: 0.72rem; text-align: right; }
      .check-slots-button { justify-self: end; min-height: 38px; padding-inline: 10px; font-size: 0.74rem; }
      .schedule-context-card { gap: 4px; padding: 10px 12px; border-radius: 18px; }
      .schedule-context-copy strong { font-size: 0.92rem; }
      .schedule-context-copy span { font-size: 0.76rem; }
      .scheduled-services-card { padding: 10px; }
      .scheduled-services-card button { min-height: 44px; padding: 8px 9px; }
      .date-row { grid-auto-columns: minmax(88px, 31%); gap: 7px; }
      .date-card { min-height: 76px; padding: 11px 8px 9px; border-radius: 16px; }
      .slot-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 9px; }
      .slot { min-height: 44px; font-size: 0.84rem; }
      .confirm-card, .trust-card { padding: 14px; }
      .review-summary-strip { gap: 6px; }
      .review-summary-strip span { padding: 9px 8px; border-radius: 14px; }
      .review-summary-strip small { font-size: 0.56rem; }
      .review-summary-strip strong { font-size: 0.78rem; }
      .review-summary-strip .review-total strong { font-size: 0.94rem; }
      dl div { padding: 9px 0; gap: 10px; }
    }
    @media (min-width: 768px) {
      .booking-hero { grid-template-columns: 180px minmax(0, 1fr); }
      .staff-choice em { text-align: left; }
      .check-slots-button { justify-self: start; }
      .slot-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    }
    .multi-staff-quick-bar { margin-bottom: 12px; }
    .quick-staff-btn { display: inline-flex; align-items: center; gap: 8px; padding: 10px 14px; border: 1px solid rgba(99, 102, 241, 0.28); border-radius: 999px; color: var(--primary); background: var(--primary-soft); font-size: 0.84rem; font-weight: 900; }
    .multi-service-progress-banner { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 12px 16px; margin-bottom: 12px; border: 1px solid rgba(99, 102, 241, 0.24); border-radius: 18px; color: var(--text); background: var(--primary-soft); }
    .multi-service-progress-banner p { margin: 0; font-size: 0.88rem; }
    .multi-service-progress-banner small { opacity: 0.88; font-weight: 850; font-size: 0.78rem; }
    .confirm-service-row { display: grid !important; grid-template-columns: minmax(0, 1fr) auto !important; align-items: start !important; gap: 8px !important; }
    .confirm-service-row dt { display: grid; gap: 2px; text-align: left; }
    .confirm-service-row dt .step-num { width: 22px; height: 22px; display: inline-grid; place-items: center; border-radius: 999px; color: #fff; background: var(--primary); font-size: 0.72rem; font-weight: 950; margin-right: 6px; }
    .confirm-service-row dd { display: grid; gap: 4px; justify-items: end; text-align: right; font-size: 0.84rem; }
    .confirm-service-row dd ion-icon { vertical-align: middle; margin-right: 2px; }
    @media (prefers-reduced-motion: reduce) {
      .skeleton-line, .slot.skeleton-slot { animation: none; }
    }
    @keyframes booking-skeleton { from { background-position: 120% 0; } to { background-position: -120% 0; } }
    @keyframes button-spin { to { transform: rotate(360deg); } }
  `]
})
export class BookingFlowPage implements OnInit {
  readonly step = signal(Number(this.route.snapshot.queryParamMap.get("step") || (this.initialServiceIds().length ? 2 : 1)));
  readonly bookingItems = signal<BookingFlowItem[]>(this.initialServiceIds().map((serviceId) => ({
    serviceId,
    staffId: this.route.snapshot.queryParamMap.get("staffId") || null,
    date: this.route.snapshot.queryParamMap.get("date") ?? "",
    slotStartAt: this.route.snapshot.queryParamMap.get("slotStartAt") ?? ""
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
  readonly scheduledServiceSummaries = computed(() => this.bookingItems()
    .map((item, index) => ({
      index,
      active: index === this.activeItemIndex(),
      name: this.serviceById(item.serviceId)?.name || `Service ${index + 1}`,
      staff: this.itemStaffName(item),
      time: this.itemSlotLabel(index),
      scheduled: !!item.slotStartAt
    }))
    .filter((item) => item.scheduled));

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
    const currentIndex = this.activeItemIndex();
    this.bookingItems.update((items) => items.map((item, index) => index === currentIndex ? { ...item, date, slotStartAt: "" } : item));
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

  dateCardLabel(day: AvailabilityDay): string {
    const selected = this.activeItem()?.date === day.date ? "Selected, " : "";
    return `${selected}${day.dayLabel}, ${day.label}, ${this.dateAvailabilityLabel(day)}`;
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

  serviceCountLabel(): string {
    const count = this.selectedServices().length;
    return `${count} service${count === 1 ? "" : "s"}`;
  }

  durationLabel(): string {
    const minutes = this.selectedServices().reduce((sum, service) => sum + service.durationMinutes, 0);
    return minutes ? `${minutes} min` : "0 min";
  }

  totalPriceLabel(): string {
    const total = this.selectedServices().reduce((sum, service) => sum + service.pricePaise, 0);
    return total ? this.money(total) : this.money(0);
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
    let createdCount = 0;
    try {
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
        createdCount += 1;
      }
    } catch {
      const remaining = items.length - createdCount;
      this.marketplace.error.set(createdCount > 0
        ? `${createdCount} service${createdCount === 1 ? "" : "s"} were booked, but ${remaining} could not be completed. Please check My bookings before trying again.`
        : this.marketplace.error() || "Could not complete booking. Please try again.");
      this.step.set(4);
      return;
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

  staffActionLabel(item: BookingFlowItem, staff: StaffMember): string {
    if (item.staffId !== staff.id) return "Select";
    return item.slotStartAt ? "Change time" : "Choose time";
  }

  activeStaffName(): string {
    const item = this.activeItem();
    return item ? this.itemStaffName(item) : "Any available professional";
  }

  activeSlotStatusLabel(): string {
    const label = this.itemSlotLabel(this.activeItemIndex());
    return label ? `Selected time: ${label}` : "Choose a time";
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
      if (this.hasExplicitBookingIntent()) {
        this.clearPendingIntent();
        return;
      }
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

  private hasExplicitBookingIntent(): boolean {
    const params = this.route.snapshot.queryParamMap;
    return ["serviceId", "serviceIds", "staffId", "date", "slotStartAt", "rescheduleBookingId", "rebookFrom"].some((key) => params.has(key));
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
