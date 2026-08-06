import { Component, OnDestroy, OnInit, ViewChild, computed, signal } from "@angular/core";
import { ActivatedRoute, Router, RouterLink } from "@angular/router";
import { Subscription } from "rxjs";
import { IonButton, IonContent, IonIcon } from "@ionic/angular/standalone";
import { addIcons } from "ionicons";
import { addOutline, alertCircleOutline, calendarOutline, callOutline, cardOutline, chatbubbleEllipsesOutline, checkmarkCircleOutline, checkmarkOutline, chevronForwardOutline, closeCircleOutline, copyOutline, downloadOutline, giftOutline, helpCircleOutline, locationOutline, navigateOutline, personOutline, repeatOutline, settingsOutline, shareSocialOutline, storefrontOutline, swapHorizontalOutline, timeOutline } from "ionicons/icons";
import { Booking, Business } from "../../core/api.types";
import { MarketplaceService } from "../../core/marketplace.service";
import { CustomerMobileHeaderComponent } from "../../shared/customer-mobile-header.component";

@Component({
  standalone: true,
  imports: [IonButton, IonContent, IonIcon, RouterLink, CustomerMobileHeaderComponent],
  template: `
    <aura-customer-mobile-header title="Booking details" [subtitle]="booking()?.businessName || ''" [backHref]="backHref()" />
    <ion-content #detailContent>
      @if (booking(); as booking) {
        <main class="page-narrow detail-page">
          @if (statusNote(); as note) {
            <section class="status-note" role="status">{{ note }}</section>
          }

          <section class="itinerary-card" aria-labelledby="booking-service">
            <div class="summary-top">
              <span class="booking-status-pill status-{{ booking.status }}" role="status">{{ statusLabel() }}</span>
              <h1 id="booking-service">{{ booking.serviceName }}</h1>
              <p>{{ branchName() }}</p>
            </div>

            <div class="appointment-time">
              <ion-icon name="time-outline" aria-hidden="true"></ion-icon>
              <div>
                <span>Appointment time</span>
                <strong>{{ appointmentWindowDisplay() }}</strong>
              </div>
            </div>

            <dl class="booking-facts">
              <div>
                <dt><ion-icon name="time-outline" aria-hidden="true"></ion-icon>Duration</dt>
                <dd>{{ durationDisplay() }}</dd>
              </div>
              <div>
                <dt><ion-icon name="person-outline" aria-hidden="true"></ion-icon>Professional</dt>
                <dd>{{ professionalDisplay() }}</dd>
              </div>
              <div>
                <dt><ion-icon name="location-outline" aria-hidden="true"></ion-icon>Venue</dt>
                <dd>{{ venueDisplay() }}</dd>
              </div>
              <div>
                <dt><ion-icon name="card-outline" aria-hidden="true"></ion-icon>Payment</dt>
                <dd>{{ paymentDisplay() }}</dd>
              </div>
              <div class="reference-fact">
                <dt><ion-icon name="checkmark-circle-outline" aria-hidden="true"></ion-icon>Booking reference</dt>
                <dd class="reference-value">
                  <span>{{ readableBookingReference() }}</span>
                  <button
                    type="button"
                    class="copy-reference"
                    [attr.aria-label]="copyState() === 'copied' ? 'Reference copied' : 'Copy booking reference'"
                    (click)="copyReference()"
                  >
                    <ion-icon [name]="copyState() === 'copied' ? 'checkmark-outline' : 'copy-outline'" aria-hidden="true"></ion-icon>
                    {{ copyState() === "copied" ? "Copied" : "Copy" }}
                  </button>
                </dd>
              </div>
            </dl>

            @if (serviceTimeline().length > 1) {
              <section class="service-timeline" aria-label="Service timeline">
                <h2>Service timeline</h2>
                @for (item of serviceTimeline(); track item.index) {
                  <div class="timeline-row">
                    <span>{{ item.index }}</span>
                    <div>
                      <strong>{{ item.name }}</strong>
                      <small>{{ item.meta }}</small>
                    </div>
                  </div>
                }
              </section>
            }
          </section>

          <span class="visually-hidden" aria-live="polite">{{ actionFeedback() }}</span>

          @if (isActive()) {
            <section class="primary-actions" aria-label="Booking actions">
              @if (canReschedule()) {
                <button type="button" class="primary-action reschedule" (click)="reschedule()">
                  <ion-icon name="calendar-outline" aria-hidden="true"></ion-icon>
                  <span>Reschedule</span>
                </button>
              } @else {
                <button type="button" class="primary-action reschedule" disabled title="Rescheduling is unavailable for this booking">
                  <ion-icon name="calendar-outline" aria-hidden="true"></ion-icon>
                  <span>Reschedule unavailable</span>
                </button>
              }

              <div class="contact-wrap" [class.expanded]="contactExpanded()">
                <button
                  type="button"
                  class="primary-action contact"
                  [attr.aria-expanded]="contactExpanded()"
                  (click)="toggleContact()"
                >
                  <ion-icon name="chatbubble-ellipses-outline" aria-hidden="true"></ion-icon>
                  <span>Contact salon</span>
                  <ion-icon class="contact-chevron" name="chevron-forward-outline" aria-hidden="true"></ion-icon>
                </button>
                @if (contactExpanded()) {
                  <div class="contact-panel" role="group" aria-label="Contact salon options">
                    <a class="option-row" [routerLink]="bookingChatLink(booking.id)">
                      <ion-icon name="chatbubble-ellipses-outline" aria-hidden="true"></ion-icon>
                      <span>Message salon</span>
                      <ion-icon class="row-chevron" name="chevron-forward-outline" aria-hidden="true"></ion-icon>
                    </a>
                    @if (salonPhone(); as phone) {
                      <a class="option-row" [href]="phone.href" [attr.aria-label]="'Call salon at ' + phone.label">
                        <ion-icon name="call-outline" aria-hidden="true"></ion-icon>
                        <span>Call salon · {{ phone.label }}</span>
                        <ion-icon class="row-chevron" name="chevron-forward-outline" aria-hidden="true"></ion-icon>
                      </a>
                    }
                    @if (salonMayReplyTomorrow()) {
                      <p class="contact-note"><ion-icon name="time-outline" aria-hidden="true"></ion-icon><span>Salon may reply tomorrow</span></p>
                    }
                  </div>
                }
              </div>

              @if (directionsUrl(); as mapUrl) {
                <a class="primary-action outline secondary-action" [href]="mapUrl" target="_blank" rel="noopener noreferrer" aria-label="Open venue directions in a new tab">
                  <ion-icon name="navigate-outline" aria-hidden="true"></ion-icon>
                  <span>Directions</span>
                </a>
              } @else {
                <button type="button" class="primary-action outline secondary-action" disabled>
                  <ion-icon name="navigate-outline" aria-hidden="true"></ion-icon>
                  <span>Directions</span>
                </button>
              }
            </section>

            <button type="button" class="manage-row" (click)="openManageSheet()">
              <ion-icon name="settings-outline" aria-hidden="true"></ion-icon>
              <span>Manage booking</span>
              <ion-icon class="row-chevron" name="chevron-forward-outline" aria-hidden="true"></ion-icon>
            </button>
          }

          <section class="utility-row" aria-label="Booking utilities">
            <button type="button" class="utility-action" [disabled]="!canAddToCalendar()" (click)="addToCalendar()">
              <ion-icon name="calendar-outline" aria-hidden="true"></ion-icon>
              <span>Add to calendar</span>
            </button>
            <button type="button" class="utility-action" (click)="shareBooking()">
              <ion-icon name="share-social-outline" aria-hidden="true"></ion-icon>
              <span>Share booking</span>
            </button>
            @if (invoiceAvailable()) {
              <button type="button" class="utility-action" (click)="downloadInvoice($event)">
                <ion-icon name="download-outline" aria-hidden="true"></ion-icon>
                <span>View receipt/invoice</span>
              </button>
            }
          </section>

          @if (!isActive()) {
            <section class="book-again-section" aria-labelledby="book-again-title">
              <div class="book-again-copy">
                <ion-icon name="repeat-outline" aria-hidden="true"></ion-icon>
                <div>
                  <h2 id="book-again-title">Book again</h2>
                  <p>{{ booking.status === "cancelled" ? "Ready for another visit? Start a fresh booking with this salon." : "Loved your visit? Book the same service or something new." }}</p>
                </div>
              </div>
              <ion-button expand="block" class="primary-gradient" (click)="rebook()">{{ booking.status === "cancelled" ? "Rebook" : "Book again" }}</ion-button>
            </section>
          }

          <section class="help-salon" aria-labelledby="help-salon-title">
            <h2 id="help-salon-title">Help &amp; salon</h2>
            @if (salonRoute(); as salonLink) {
              <a class="option-row" [routerLink]="salonLink">
                <ion-icon name="storefront-outline" aria-hidden="true"></ion-icon>
                <span>View salon</span>
                <ion-icon class="row-chevron" name="chevron-forward-outline" aria-hidden="true"></ion-icon>
              </a>
            }
            <button type="button" class="option-row" (click)="requestSupport()">
              <ion-icon name="chatbubbles-outline" aria-hidden="true"></ion-icon>
              <span>Request support for this booking</span>
              <ion-icon class="row-chevron" name="chevron-forward-outline" aria-hidden="true"></ion-icon>
            </button>
            <a class="option-row" [routerLink]="helpRoute()">
              <ion-icon name="information-circle-outline" aria-hidden="true"></ion-icon>
              <span>General Help Centre</span>
              <ion-icon class="row-chevron" name="chevron-forward-outline" aria-hidden="true"></ion-icon>
            </a>
          </section>

          <section class="policy-strip" aria-labelledby="policy-title">
            <header>
              <span id="policy-title">Cancellation policy</span>
              <small>{{ isActive() ? "Review impact before cancelling" : "Cancellation is not available for this booking" }}</small>
            </header>
            <div class="policy-impact-list">
              <p><strong>Cutoff</strong><span>{{ cancellationCutoffLine() }}</span></p>
              <p><strong>Cancellation fee</strong><span>{{ cancelFeeLine() }}</span></p>
              <p><strong>Refund before cancellation</strong><span>{{ cancelRefundLine() }}</span></p>
              <p><strong>Package/membership credits</strong><span>{{ cancelCreditsLine() }}</span></p>
            </div>
            @if (booking.cancellationPolicy) {
              <p class="policy-note">Policy: {{ booking.cancellationPolicy }}</p>
            }
            @if (isActive()) {
              <button type="button" class="cancel-link" [disabled]="!canCancelBooking()" (click)="cancel()">
                <ion-icon name="close-circle-outline" aria-hidden="true"></ion-icon>
                <span>{{ canCancelBooking() ? "Cancel booking" : cancelDisabledReason() }}</span>
              </button>
            }
          </section>
        </main>

        @if (manageSheetOpen()) {
          <div class="sheet-backdrop" role="presentation" (click)="closeManageSheet()">
            <section class="action-sheet" role="dialog" aria-modal="true" aria-labelledby="manage-sheet-title" (click)="$event.stopPropagation()">
              <div class="sheet-handle" aria-hidden="true"></div>
              <div class="sheet-title-row">
                <h2 id="manage-sheet-title">Manage booking</h2>
                <button type="button" class="sheet-close" aria-label="Close manage booking" (click)="closeManageSheet()">
                  <ion-icon name="close-circle-outline" aria-hidden="true"></ion-icon>
                </button>
              </div>
              <p class="sheet-subtitle">Choose what you would like to change for this appointment.</p>
              <button type="button" class="option-row sheet-option" [disabled]="!canChangeServices()" (click)="changeServices()">
                <ion-icon name="swap-horizontal-outline" aria-hidden="true"></ion-icon>
                <span><strong>Change services</strong><small>{{ canChangeServices() ? "Replace or remove existing services. Staff, time and price will be recalculated before confirmation." : manageActionReason() }}</small></span>
                <ion-icon class="row-chevron" name="chevron-forward-outline" aria-hidden="true"></ion-icon>
              </button>
              <button type="button" class="option-row sheet-option" [disabled]="!canChangeProfessional()" (click)="changeProfessional()">
                <ion-icon name="person-outline" aria-hidden="true"></ion-icon>
                <span><strong>Change professional</strong><small>{{ canChangeProfessional() ? "Pick another professional. The slot will be revalidated before confirmation." : manageActionReason() }}</small></span>
                <ion-icon class="row-chevron" name="chevron-forward-outline" aria-hidden="true"></ion-icon>
              </button>
              <button type="button" class="option-row sheet-option" [disabled]="!canReschedule()" (click)="rescheduleFromSheet()">
                <ion-icon name="calendar-outline" aria-hidden="true"></ion-icon>
                <span><strong>Reschedule</strong><small>{{ canReschedule() ? "Keep the current services and professional, then choose a new valid time." : manageActionReason() }}</small></span>
                <ion-icon class="row-chevron" name="chevron-forward-outline" aria-hidden="true"></ion-icon>
              </button>
              <button type="button" class="option-row sheet-option" [disabled]="!canAddServiceToBooking()" (click)="addService()">
                <ion-icon name="add-outline" aria-hidden="true"></ion-icon>
                <span><strong>Add a service</strong><small>{{ canAddServiceToBooking() ? "Append another service to this booking. Price difference shows before confirmation." : manageActionReason() }}</small></span>
                <ion-icon class="row-chevron" name="chevron-forward-outline" aria-hidden="true"></ion-icon>
              </button>
              <button type="button" class="option-row sheet-option cancel-sheet-row" [disabled]="!canCancelBooking()" (click)="cancelFromSheet()">
                <ion-icon name="close-circle-outline" aria-hidden="true"></ion-icon>
                <span><strong>Cancel booking</strong><small>{{ canCancelBooking() ? "Review cutoff, fee and refund before cancelling." : cancelDisabledReason() }}</small></span>
                <ion-icon class="row-chevron" name="chevron-forward-outline" aria-hidden="true"></ion-icon>
              </button>
            </section>
          </div>
        }

        @if (cancelSheetOpen()) {
          <div class="sheet-backdrop" role="presentation" (click)="closeCancelSheet()">
            <section class="action-sheet cancel-sheet" role="dialog" aria-modal="true" aria-labelledby="cancel-sheet-title" (click)="$event.stopPropagation()">
              @if (cancelDone()) {
                <div class="cancel-success" role="status">
                  <ion-icon class="success-icon" name="checkmark-circle-outline" aria-hidden="true"></ion-icon>
                  <h2 id="cancel-sheet-title">Appointment cancelled</h2>
                  <p class="cancel-summary-line">{{ booking.serviceName }} · {{ booking.businessName }} · {{ appointmentDisplay() }}</p>
                  @if (cancelRefundLine(); as refund) {
                    <p class="cancel-refund-note">{{ refund }}</p>
                  }
                  <ion-button expand="block" class="primary-gradient" (click)="closeCancelSheet()">Done</ion-button>
                </div>
              } @else {
                <h2 id="cancel-sheet-title">Cancel this appointment?</h2>
                <p class="cancel-summary-line">{{ booking.serviceName }} · {{ booking.businessName }} · {{ appointmentDisplay() }}</p>

                <div class="impact-panel" aria-label="What happens after cancellation">
                  <p class="impact-primary">This appointment will be cancelled.</p>
                  @if (cancelRefundLine(); as refund) {
                    <p class="impact-row"><ion-icon name="card-outline" aria-hidden="true"></ion-icon><span>{{ refund }}</span></p>
                  }
                  @if (cancelFeeLine(); as fee) {
                    <p class="impact-row"><ion-icon name="alert-circle-outline" aria-hidden="true"></ion-icon><span>{{ fee }}</span></p>
                  }
                  @if (cancelCreditsLine(); as credits) {
                    <p class="impact-row"><ion-icon name="gift-outline" aria-hidden="true"></ion-icon><span>{{ credits }}</span></p>
                  }
                </div>

                @if (booking.cancellationPolicy) {
                  <p class="policy-note">Policy: {{ booking.cancellationPolicy }}</p>
                }

                <div class="cancel-sheet-actions">
                  <button type="button" class="neutral-action" (click)="closeCancelSheet()">Keep appointment</button>
                  <button type="button" class="destructive-confirm" [disabled]="cancelSubmitting() || !canCancelBooking()" (click)="confirmCancelBooking(booking.id)">{{ cancelSubmitting() ? "Cancelling…" : "Yes, cancel appointment" }}</button>
                </div>

                @if (canReschedule()) {
                  <button type="button" class="reschedule-offer" (click)="rescheduleInstead()">Would you prefer to reschedule instead?</button>
                }
              }
            </section>
          </div>
        }
      } @else {
        <main class="page-narrow detail-page" aria-live="polite">
          @if (marketplace.loading()) {
            <section class="state-panel"><h1>Loading booking</h1></section>
          } @else {
            <section class="state-panel"><h1>Booking unavailable</h1><p>{{ marketplace.error() || "This booking could not be loaded." }}</p><ion-button class="primary-gradient" (click)="reload()">Retry</ion-button></section>
          }
        </main>
      }
    </ion-content>
  `,
  styles: [`
    .detail-header ion-toolbar { --min-height: 52px; }
    .detail-header ion-title { font-size: 1rem; font-weight: 850; letter-spacing: -0.015em; }
    ion-content::part(scroll) { scroll-padding-top: calc(76px + env(safe-area-inset-top)); }
    .detail-page { display: grid; gap: 12px; max-width: 680px; padding-top: calc(10px + env(safe-area-inset-top)); }

    .status-note {
      padding: 10px 14px;
      border: 1px solid var(--border);
      border-radius: 14px;
      color: var(--muted);
      background: var(--surface-soft);
      font-size: 0.85rem;
      font-weight: 700;
      line-height: 1.4;
    }

    .itinerary-card {
      min-width: 0;
      overflow: hidden;
      border: 1px solid rgba(11, 47, 85, 0.24);
      border-radius: var(--radius-md);
      color: #FFFFFF;
      background: var(--brand-900);
      box-shadow: 0 14px 34px rgba(28, 28, 28, 0.15);
    }
    .summary-top { padding: 13px 16px 9px; }
    .booking-status-pill {
      display: inline-flex;
      align-items: center;
      width: fit-content;
      min-height: 20px;
      padding: 4px 9px;
      border: 1px solid transparent;
      border-radius: 999px;
      font-size: 0.74rem;
      font-weight: 900;
      line-height: 1;
      text-transform: capitalize;
    }
    .booking-status-pill.status-pending { color: #92600A; border-color: rgba(217, 119, 6, 0.35); background: rgba(251, 191, 36, 0.14); }
    .booking-status-pill.status-confirmed { color: #047857; border-color: rgba(16, 185, 129, 0.4); background: rgba(16, 185, 129, 0.13); }
    .booking-status-pill.status-completed { color: #1D4ED8; border-color: rgba(59, 130, 246, 0.36); background: rgba(59, 130, 246, 0.12); }
    .booking-status-pill.status-cancelled { color: #B91C1C; border-color: rgba(239, 68, 68, 0.38); background: rgba(239, 68, 68, 0.11); }
    .summary-top h1 {
      margin: 8px 0 2px;
      color: #FFFFFF;
      font-size: clamp(1.12rem, 5.4vw, 1.35rem);
      font-weight: 900;
      letter-spacing: -0.03em;
      line-height: 1.15;
      overflow-wrap: anywhere;
    }
    .summary-top p { margin: 0; color: rgba(255, 255, 255, 0.78); font-size: 0.86rem; font-weight: 700; overflow-wrap: anywhere; }
    .appointment-time {
      display: grid;
      grid-template-columns: 20px minmax(0, 1fr);
      gap: 0 10px;
      align-items: center;
      padding: 9px 16px;
      border-block: 1px solid rgba(255, 255, 255, 0.11);
      background: rgba(255, 255, 255, 0.045);
    }
    .appointment-time ion-icon { color: #FFFFFF; font-size: 1.05rem; }
    .appointment-time span { display: block; color: rgba(255, 255, 255, 0.72); font-size: 0.76rem; font-weight: 700; letter-spacing: 0.03em; text-transform: uppercase; }
    .appointment-time strong { display: block; color: #FFFFFF; font-size: 0.95rem; line-height: 1.3; overflow-wrap: anywhere; }
    .booking-facts { display: grid; margin: 0; }
    .booking-facts div { min-width: 0; padding: 8px 16px; border-bottom: 1px solid rgba(255, 255, 255, 0.1); }
    .booking-facts div:last-child { border-bottom: 0; }
    .booking-facts dt { display: flex; align-items: center; gap: 7px; margin: 0 0 2px; color: rgba(255, 255, 255, 0.72); font-size: 0.76rem; font-weight: 750; }
    .booking-facts dt ion-icon { flex: 0 0 auto; font-size: 0.88rem; }
    .booking-facts dd { margin: 0; color: #FFFFFF; font-size: 0.86rem; font-weight: 750; line-height: 1.3; overflow-wrap: anywhere; word-break: break-word; }
    .reference-fact dd { font-size: 0.8rem; }
    .reference-fact dt { color: rgba(255, 255, 255, 0.58); }
    .reference-value { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
    .reference-value > span { min-width: 0; color: rgba(255, 255, 255, 0.82); font-family: ui-monospace, "SFMono-Regular", Consolas, monospace; overflow-wrap: anywhere; }
    .service-timeline {
      display: grid;
      gap: 8px;
      padding: 10px 16px 14px;
      border-top: 1px solid rgba(255, 255, 255, 0.1);
      background: rgba(255, 255, 255, 0.035);
    }
    .service-timeline h2 { margin: 0; color: rgba(255, 255, 255, 0.72); font-size: 0.76rem; font-weight: 850; text-transform: uppercase; letter-spacing: 0.05em; }
    .timeline-row { display: grid; grid-template-columns: 24px minmax(0, 1fr); gap: 9px; align-items: start; }
    .timeline-row > span { width: 24px; height: 24px; display: grid; place-items: center; border-radius: 999px; color: var(--brand-900); background: rgba(255, 255, 255, 0.9); font-size: 0.74rem; font-weight: 950; }
    .timeline-row strong { display: block; color: #fff; font-size: 0.86rem; line-height: 1.25; }
    .timeline-row small { display: block; margin-top: 2px; color: rgba(255, 255, 255, 0.72); font-size: 0.78rem; line-height: 1.25; }
    .copy-reference {
      display: inline-flex;
      flex: 0 0 auto;
      align-items: center;
      justify-content: center;
      gap: 4px;
      min-width: 44px;
      min-height: 48px;
      padding: 8px 11px;
      border: 0;
      border-radius: 8px;
      color: rgba(255, 255, 255, 0.9);
      background: transparent;
      font-size: 0.7rem;
      font-weight: 800;
      cursor: pointer;
    }
    .copy-reference:hover { background: rgba(255, 255, 255, 0.1); }
    .copy-reference:focus-visible { outline: 3px solid var(--focus); outline-offset: 2px; }

    .primary-actions { display: grid; gap: 8px; }
    .primary-actions .contact-wrap { display: grid; gap: 8px; }
    .primary-action {
      display: inline-flex;
      min-width: 0;
      min-height: 46px;
      align-items: center;
      justify-content: center;
      gap: 7px;
      padding: 8px 12px;
      border: 1px solid transparent;
      border-radius: 999px;
      font-family: inherit;
      font-size: 0.84rem;
      font-weight: 900;
      line-height: 1.15;
      text-align: center;
      text-decoration: none;
      cursor: pointer;
      transition: transform var(--motion-fast), box-shadow var(--motion-fast), border-color var(--motion-fast), background var(--motion-fast);
    }
    .primary-action ion-icon { flex: 0 0 auto; font-size: 1rem; }
    .primary-action span { min-width: 0; overflow-wrap: anywhere; }
    .primary-action.reschedule {
      color: #FFFFFF;
      background: var(--primary);
      box-shadow: 0 8px 18px rgba(99, 102, 241, 0.24);
    }
    .primary-action.contact, .primary-action.outline {
      color: var(--primary);
      border-color: var(--border-strong);
      background: var(--surface);
    }
    .primary-action:hover { transform: translateY(-1px); }
    .primary-action:disabled { color: var(--muted); border-color: var(--border); background: var(--surface-soft); cursor: not-allowed; opacity: 0.72; transform: none; box-shadow: none; }
    .primary-action:focus-visible { outline: 3px solid var(--focus); outline-offset: 2px; }
    .secondary-action { min-height: 46px; }
    .contact-chevron { margin-left: auto; font-size: 0.9rem; transition: transform var(--motion-fast); }
    .contact-wrap.expanded .contact-chevron { transform: rotate(90deg); }
    .contact-wrap.expanded .primary-action.contact { border-color: var(--primary); background: var(--primary-soft); }
    .contact-panel {
      display: grid;
      gap: 2px;
      padding: 6px;
      border: 1px solid var(--border);
      border-radius: 14px;
      background: var(--glass);
    }
    .contact-note {
      display: flex;
      align-items: center;
      gap: 7px;
      margin: 4px 2px 0;
      padding: 8px 10px;
      border-radius: 10px;
      color: var(--muted);
      background: var(--surface-soft);
      font-size: 0.8rem;
      font-weight: 750;
      line-height: 1.3;
    }
    .contact-note ion-icon { flex: 0 0 auto; color: var(--primary); font-size: 0.95rem; }

    .manage-row {
      width: 100%;
      min-height: 46px;
      display: grid;
      grid-template-columns: 20px minmax(0, 1fr) auto;
      align-items: center;
      gap: 10px;
      padding: 10px 14px;
      border: 1px solid var(--border);
      border-radius: 14px;
      color: var(--text);
      background: var(--surface);
      font-family: inherit;
      font-size: 0.86rem;
      font-weight: 850;
      text-align: left;
      cursor: pointer;
      transition: border-color var(--motion-fast), background var(--motion-fast);
    }
    .manage-row > ion-icon:first-child { color: var(--primary); font-size: 1.05rem; }
    .manage-row:hover { border-color: var(--primary); background: var(--primary-soft); }
    .manage-row:focus-visible { outline: 3px solid var(--focus); outline-offset: 2px; }

    .utility-row { display: flex; flex-wrap: wrap; gap: 8px; }
    .utility-action {
      display: inline-flex;
      min-width: 0;
      min-height: 40px;
      align-items: center;
      justify-content: center;
      gap: 6px;
      padding: 6px 12px;
      border: 1px solid var(--border-strong);
      border-radius: 999px;
      color: var(--primary);
      background: var(--surface);
      font-family: inherit;
      font-size: 0.84rem;
      font-weight: 850;
      line-height: 1.15;
      cursor: pointer;
      transition: color var(--motion-fast), border-color var(--motion-fast), background var(--motion-fast);
    }
    .utility-action ion-icon { flex: 0 0 auto; font-size: 0.95rem; }
    .utility-action:hover { border-color: var(--primary); background: var(--primary-soft); }
    .utility-action:disabled { color: var(--muted); border-color: var(--border); background: var(--surface-soft); cursor: not-allowed; opacity: 0.72; }
    .utility-action:focus-visible { outline: 3px solid var(--focus); outline-offset: 2px; }

    .book-again-section {
      display: grid;
      gap: 12px;
      padding: 16px;
      border: 1px solid var(--border);
      border-radius: 16px;
      background: var(--surface);
    }
    .book-again-copy { display: flex; align-items: flex-start; gap: 12px; }
    .book-again-copy > ion-icon { flex: 0 0 auto; margin-top: 2px; color: var(--primary); font-size: 1.3rem; }
    .book-again-copy h2 { margin: 0; font-size: 1rem; letter-spacing: -0.02em; }
    .book-again-copy p { margin: 3px 0 0; color: var(--muted); font-size: 0.82rem; line-height: 1.45; }
    .book-again-section ion-button { min-height: 44px; margin: 0; text-transform: none; }

    .help-salon {
      display: grid;
      gap: 2px;
      padding: 6px 0 0;
      border-top: 1px solid var(--border);
    }
    .help-salon h2 {
      margin: 0 8px 4px;
      color: var(--muted);
      font-size: 0.76rem;
      font-weight: 950;
      letter-spacing: 0.08em;
      text-transform: uppercase;
    }
    .option-row {
      width: 100%;
      min-width: 0;
      min-height: 44px;
      display: grid;
      grid-template-columns: 20px minmax(0, 1fr) auto;
      align-items: center;
      gap: 10px;
      padding: 10px 8px;
      border: 0;
      border-radius: 8px;
      color: var(--text);
      background: transparent;
      font-family: inherit;
      font-size: 0.86rem;
      font-weight: 800;
      line-height: 1.25;
      text-align: left;
      text-decoration: none;
      cursor: pointer;
    }
    .option-row:hover { background: var(--primary-soft); }
    .option-row:active { background: rgba(99, 102, 241, 0.12); transform: scale(0.99); }
    .option-row:focus-visible { outline: 3px solid var(--focus); outline-offset: 2px; }
    .option-row > ion-icon:first-child { color: var(--primary); font-size: 1.05rem; }
    .help-salon .option-row { grid-template-columns: 28px minmax(0, 1fr) auto; }
    .help-salon .option-row > ion-icon:first-child {
      width: 28px;
      height: 28px;
      display: grid;
      place-items: center;
      border-radius: 999px;
      color: var(--primary);
      background: var(--primary-soft);
      font-size: 1rem;
    }
    .option-row > span { min-width: 0; color: inherit; overflow-wrap: anywhere; }
    .row-chevron { color: var(--muted); font-size: 0.95rem; }

    .policy-strip {
      display: grid;
      gap: 10px;
      padding: 12px 4px;
      border-block: 1px solid var(--border);
      color: var(--text);
      background: var(--glass);
    }
    .policy-strip header { display: grid; gap: 2px; padding: 0 4px; }
    .policy-strip header span { display: block; color: var(--text); font-size: 0.88rem; font-weight: 850; }
    .policy-strip header small { display: block; color: var(--muted); font-size: 0.82rem; font-weight: 650; }
    .policy-impact-list { display: grid; gap: 8px; }
    .policy-impact-list p {
      display: grid;
      grid-template-columns: minmax(118px, 0.42fr) minmax(0, 1fr);
      gap: 10px;
      margin: 0;
      padding: 9px 10px;
      border: 1px solid var(--border);
      border-radius: 12px;
      background: var(--surface);
      color: var(--text);
      font-size: 0.84rem;
      line-height: 1.4;
      overflow-wrap: anywhere;
    }
    .policy-impact-list strong { color: var(--muted); font-size: 0.76rem; font-weight: 850; text-transform: uppercase; letter-spacing: 0.04em; }
    .policy-impact-list span { font-weight: 780; }

    .cancel-link {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 7px;
      min-height: 44px;
      padding: 8px 14px;
      border: 0;
      border-radius: 10px;
      color: #B42318;
      background: transparent;
      font-family: inherit;
      font-size: 0.86rem;
      font-weight: 850;
      cursor: pointer;
      justify-self: center;
    }
    .cancel-link ion-icon { font-size: 1rem; }
    .cancel-link:hover { background: rgba(180, 35, 24, 0.07); }
    .cancel-link:disabled { color: var(--muted); cursor: not-allowed; opacity: 0.76; }
    .cancel-link:disabled:hover { background: transparent; }
    .cancel-link:focus-visible { outline: 3px solid var(--focus); outline-offset: 2px; }

    .visually-hidden { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0; }
    .state-panel { padding: 18px; border: 1px solid var(--border); border-radius: var(--radius-md); background: var(--surface); box-shadow: var(--shadow-soft); }
    .state-panel h1 { margin: 0; font-size: 1.25rem; letter-spacing: -0.03em; }
    .state-panel p { margin: 8px 0 14px; color: var(--muted); line-height: 1.5; overflow-wrap: anywhere; }

    .sheet-backdrop {
      position: fixed;
      inset: 0;
      z-index: 1000;
      display: grid;
      align-items: end;
      padding: 16px 16px calc(16px + env(safe-area-inset-bottom));
      background: rgba(28, 28, 28, 0.42);
    }
    .action-sheet {
      width: min(100%, 520px);
      display: grid;
      gap: 2px;
      margin: 0 auto;
      padding: 10px 20px calc(18px + env(safe-area-inset-bottom));
      border: 1px solid var(--border);
      border-radius: 24px;
      background: var(--surface);
      box-shadow: 0 24px 60px rgba(28, 28, 28, 0.22);
    }
    .sheet-handle { justify-self: center; width: 42px; height: 4px; margin: 0 0 10px; border-radius: 999px; background: var(--border-strong); opacity: 0.7; }
    .sheet-title-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
    .action-sheet h2 { margin: 0; color: var(--text); font-size: 1.18rem; letter-spacing: -0.03em; }
    .sheet-close { width: 40px; height: 40px; display: grid; place-items: center; border: 0; border-radius: 999px; color: var(--muted); background: transparent; cursor: pointer; }
    .sheet-close ion-icon { font-size: 1.35rem; }
    .sheet-close:hover { background: var(--surface-soft); }
    .sheet-close:focus-visible { outline: 3px solid var(--focus); outline-offset: 2px; }
    .action-sheet .sheet-subtitle { margin: 0 0 10px; color: var(--muted); font-size: 0.84rem; line-height: 1.45; }
    .action-sheet .option-row { border-radius: 10px; }
    .sheet-option { grid-template-columns: 24px minmax(0, 1fr) auto; min-height: 58px; align-items: center; }
    .sheet-option > span { display: grid; gap: 2px; }
    .sheet-option strong { color: inherit; font-size: 0.86rem; line-height: 1.2; }
    .sheet-option small { color: var(--muted); font-size: 0.76rem; font-weight: 700; line-height: 1.32; }
    .sheet-option:disabled { color: var(--muted); background: var(--surface-soft); cursor: not-allowed; opacity: 0.78; }
    .sheet-option:disabled > ion-icon:first-child, .sheet-option:disabled .row-chevron { color: var(--muted); }
    .cancel-sheet-row { color: #B42318 !important; margin-top: 6px; border-top: 1px solid var(--border); }
    .cancel-sheet-row > ion-icon:first-child { color: #B42318; }
    .cancel-sheet { gap: 12px; }
    .cancel-summary-line { margin: 0; color: var(--text); font-size: 0.9rem; font-weight: 750; line-height: 1.45; overflow-wrap: anywhere; }
    .impact-panel { display: grid; gap: 8px; padding: 12px 14px; border: 1px solid var(--border); border-radius: 14px; background: var(--surface-soft); }
    .impact-primary { margin: 0; color: var(--text); font-size: 0.92rem; font-weight: 900; line-height: 1.4; }
    .impact-row { display: flex; align-items: flex-start; gap: 8px; margin: 0; color: var(--muted); font-size: 0.84rem; font-weight: 650; line-height: 1.45; }
    .impact-row ion-icon { flex: 0 0 auto; margin-top: 2px; color: var(--primary); font-size: 0.95rem; }
    .policy-note { margin: 0; color: var(--muted); font-size: 0.84rem; line-height: 1.4; }
    .reschedule-offer {
      width: 100%;
      min-height: 44px;
      border: 0;
      border-radius: 10px;
      color: var(--primary);
      background: var(--primary-soft);
      font-family: inherit;
      font-size: 0.84rem;
      font-weight: 850;
      cursor: pointer;
    }
    .reschedule-offer:hover { background: rgba(99, 102, 241, 0.16); }
    .reschedule-offer:focus-visible { outline: 3px solid var(--focus); outline-offset: 2px; }
    .cancel-success { display: grid; gap: 10px; justify-items: center; padding: 8px 0 4px; text-align: center; }
    .cancel-success .success-icon { font-size: 2.5rem; color: #059669; }
    .cancel-success h2 { margin: 0; color: var(--text); font-size: 1.18rem; letter-spacing: -0.03em; }
    .cancel-refund-note { margin: 0; color: var(--muted); font-size: 0.86rem; line-height: 1.45; }
    .cancel-success ion-button { width: 100%; min-height: 48px; margin: 6px 0 0; text-transform: none; }
    .cancel-sheet .cancel-sheet-actions { margin-top: 4px; }
    .cancel-sheet-actions button:disabled { opacity: 0.6; cursor: not-allowed; }
    .cancel-sheet-actions { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-top: 10px; }
    .cancel-sheet-actions button { min-height: 48px; border-radius: 999px; font-family: inherit; font-size: 0.9rem; font-weight: 900; }
    .neutral-action { border: 1px solid var(--border); color: var(--text); background: var(--surface); }
    .destructive-confirm { border: 1px solid #B42318; color: #FFFFFF; background: #B42318; }

    @media (min-width: 560px) {
      .primary-actions { grid-template-columns: repeat(3, minmax(0, 1fr)); }
      .primary-actions .contact-wrap { grid-column: auto; }
      .itinerary-card .booking-facts { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .itinerary-card .booking-facts .reference-fact { grid-column: 1 / -1; }
    }

    @media (prefers-reduced-motion: reduce) {
      .detail-page, .itinerary-card, .primary-action, .manage-row, .utility-action, .option-row, .cancel-link, .contact-chevron, .policy-strip summary::before { transition: none; }
      .option-row:active, .primary-action:hover { transform: none; }
    }
  `]
})
export class BookingDetailPage implements OnInit, OnDestroy {
  @ViewChild("detailContent") private detailContent?: IonContent;
  private readonly id = signal(this.route.snapshot.paramMap.get("id"));
  private copyResetTimer: ReturnType<typeof setTimeout> | undefined;
  private routeSubscription?: Subscription;
  private lastOpenedId = this.id() || "";
  readonly booking = computed(() => this.marketplace.findBooking(this.id()));
  readonly resolvedBusiness = computed<Business | null>(() => {
    const booking = this.booking();
    if (!booking) return null;
    const selected = this.marketplace.selectedBusiness();
    if (selected?.id === booking.businessId) return selected;
    const byId = booking.businessId ? this.marketplace.findBusiness(booking.businessId) : null;
    if (byId) return byId;
    if (selected && this.sameName(selected.businessName, booking.businessName)) return selected;
    return this.marketplace.businesses().find((business) => this.sameName(business.businessName, booking.businessName)) ?? null;
  });
  readonly bookingReference = computed(() => String(this.booking()?.reference || this.booking()?.id || ""));
  readonly readableBookingReference = computed(() => this.formatBookingReference(this.bookingReference()));
  readonly appointmentDisplay = computed(() => this.formatAppointment(this.appointmentStart()));
  readonly appointmentWindowDisplay = computed(() => this.formatAppointmentWindow());
  readonly durationDisplay = computed(() => this.formatDuration(this.bookingDurationMinutes()));
  readonly professionalDisplay = computed(() => String(this.booking()?.staffName || "Professional to be assigned"));
  readonly branchName = computed(() => this.resolvedBusiness()?.businessName || this.booking()?.businessName || "Salon branch");
  readonly venueDisplay = computed(() => this.resolvedBusiness()?.address?.trim() || this.booking()?.address?.trim() || "Venue to be confirmed");
  readonly paymentDisplay = computed(() => this.paymentLabel(this.booking()?.paymentStatus));
  readonly serviceTimeline = computed(() => this.extractServiceTimeline());
  readonly salonPhone = computed(() => this.resolveSalonPhone(this.resolvedBusiness()));
  readonly salonMayReplyTomorrow = computed(() => this.resolvedBusiness()?.isOpen === false);
  readonly salonRoute = computed(() => {
    const slug = this.resolvedBusiness()?.slug;
    return slug ? this.businessProfileUrl(slug) : null;
  });
  readonly directionsUrl = computed(() => this.resolveDirectionsUrl());
  readonly canAddToCalendar = computed(() => this.calendarStart() !== null);
  readonly copyState = signal<"idle" | "copied" | "failed">("idle");
  readonly actionFeedback = signal("");
  readonly isActive = computed(() => {
    const booking = this.booking();
    return !!booking && (booking.status === "pending" || booking.status === "confirmed") && !this.isPastBooking(booking);
  });
  readonly canReschedule = computed(() => {
    const booking = this.booking();
    if (!booking) return false;
    const identity = this.resolvedBusiness()?.slug || booking.businessId;
    return this.isActive() && !!identity && !!booking.serviceId;
  });
  readonly invoiceAvailable = computed(() => {
    const booking = this.booking();
    if (!booking) return false;
    return booking.status === "completed" && (booking.paymentStatus === "paid" || booking.paymentStatus === "refunded");
  });
  readonly statusNote = computed<string | null>(() => {
    const status = this.booking()?.status;
    if (status === "cancelled") return "This booking was cancelled.";
    if (status === "completed") return "This visit is complete.";
    return null;
  });

  readonly cancelSheetOpen = signal(false);
  readonly manageSheetOpen = signal(false);
  readonly manageSheetDirty = signal(false);
  readonly contactExpanded = signal(false);
  readonly cancelDone = signal(false);
  readonly cancelSubmitting = signal(false);

  readonly cancellationCutoffLine = computed<string>(() => {
    const explicit = this.cancellationCutoffDate();
    if (explicit) return `Free cancellation until ${this.formatShortDateTime(explicit)}`;
    if (this.booking()?.cancellationPolicy) return "Check the salon policy text below for the cutoff.";
    return "Salon has not shared a cancellation cutoff yet.";
  });

  readonly cancelRefundLine = computed<string | null>(() => {
    const booking = this.booking();
    if (!booking) return null;
    const paid = this.bookingPaidPaise() || (String(booking.paymentStatus || "").toLowerCase() === "paid" ? this.bookingAmountPaise() : 0);
    const refund = Math.max(0, paid - this.cancellationFeePaise());
    const payment = String(booking.paymentStatus || "").toLowerCase();
    if (["refunded"].includes(payment)) return "Already refunded to your original payment method.";
    if (paid > 0) return `${this.money(refund)} estimated refund before cancellation.`;
    return "No online payment found, so refund amount is Rs 0.";
  });

  readonly cancelFeeLine = computed<string | null>(() => {
    const fee = this.cancellationFeePaise();
    if (fee > 0) return `${this.money(fee)} may be deducted.`;
    const policy = String(this.booking()?.cancellationPolicy || "").trim();
    if (/fee|charge|forfeit|deposit|penalty|%|percent/i.test(policy)) return policy;
    return "No cancellation fee shown for this booking.";
  });

  readonly cancelCreditsLine = computed<string | null>(() => {
    const booking = this.booking() as Record<string, unknown> | null;
    if (!booking) return null;
    const direct = String(booking["packageCreditImpact"] || booking["membershipCreditImpact"] || booking["creditImpact"] || "").trim();
    if (direct) return direct;
    const packageCredits = Number(booking["packageCreditsUsed"] || booking["packageCredits"] || 0);
    const membershipCredits = Number(booking["membershipCreditsUsed"] || booking["membershipCredits"] || 0);
    const totalCredits = Number(booking["creditsUsed"] || 0) + (Number.isFinite(packageCredits) ? packageCredits : 0) + (Number.isFinite(membershipCredits) ? membershipCredits : 0);
    if (totalCredits > 0) return `${totalCredits} package/membership credit${totalCredits === 1 ? "" : "s"} will be returned if policy allows.`;
    return "No package or membership credits are linked to this booking.";
  });

  readonly canCancelBooking = computed(() => this.isActive() && !this.cancellationCutoffExpired());

  constructor(private readonly route: ActivatedRoute, private readonly router: Router, readonly marketplace: MarketplaceService) {
    addIcons({ addOutline, alertCircleOutline, calendarOutline, callOutline, cardOutline, chatbubbleEllipsesOutline, checkmarkCircleOutline, checkmarkOutline, chevronForwardOutline, closeCircleOutline, copyOutline, downloadOutline, giftOutline, helpCircleOutline, locationOutline, navigateOutline, personOutline, repeatOutline, settingsOutline, shareSocialOutline, storefrontOutline, swapHorizontalOutline, timeOutline });
  }

  ngOnInit() {
    this.routeSubscription = this.route.paramMap.subscribe((params) => {
      const id = params.get("id") || "";
      if (!id || id === this.lastOpenedId) return;
      this.lastOpenedId = id;
      this.id.set(id);
      this.resetDetailScroll();
      void this.reload();
    });
    this.resetDetailScroll();
    this.reload();
  }

  ionViewWillEnter() {
    this.resetDetailScroll();
  }

  ngOnDestroy() {
    if (this.copyResetTimer) clearTimeout(this.copyResetTimer);
    this.routeSubscription?.unsubscribe();
  }

  backHref(): string {
    return this.marketplace.salonMode() ? this.marketplace.salonModeUrl("bookings") : "/tabs/bookings";
  }

  statusLabel(): string {
    const status = this.booking()?.status || "";
    return status ? status.charAt(0).toUpperCase() + status.slice(1) : "Booking";
  }

  bookingChatLink(id: string): string {
    return this.marketplace.salonMode() ? this.marketplace.salonModeUrl("bookings", id, "chat") : `/bookings/${encodeURIComponent(id)}/chat`;
  }

  helpRoute(): string {
    return this.marketplace.salonMode() ? this.marketplace.salonModeUrl("support") : "/tabs/support";
  }

  bookingSupportRoute(): string {
    return this.marketplace.salonMode() ? this.marketplace.salonModeUrl("support") : "/support";
  }

  supportQuery(): { mode: string; bookingId: string } {
    const id = this.booking()?.id;
    return { mode: "booking", bookingId: id || "" };
  }

  private businessProfileUrl(slug: string): string {
    return this.marketplace.salonMode() ? this.marketplace.salonModeUrl("business", slug) : `/business/${encodeURIComponent(slug)}`;
  }

  private businessBookUrl(slug: string): string {
    return this.marketplace.salonMode() ? this.marketplace.salonModeUrl("business", slug, "book") : `/business/${encodeURIComponent(slug)}/book`;
  }

  async reload() {
    const id = this.id();
    if (!id) return;
    try {
      const booking = await this.marketplace.loadBooking(id);
      if (booking.businessId) await this.marketplace.loadBusiness(booking.businessId).catch(() => undefined);
    } catch {
      return;
    }
  }

  private resetDetailScroll() {
    window.setTimeout(() => void this.detailContent?.scrollToTop(0), 0);
    window.setTimeout(() => void this.detailContent?.scrollToTop(0), 80);
  }

  async copyReference() {
    const reference = this.bookingReference();
    if (!reference) return;

    const copied = await this.copyText(reference);
    this.copyState.set(copied ? "copied" : "failed");
    this.setFeedback(copied ? "Booking reference copied" : "Booking reference could not be copied");
  }

  async shareBooking() {
    const booking = this.booking();
    if (!booking) return;
    const heading = [booking.serviceName, booking.businessName].filter(Boolean).join(" at ");
    const venue = this.resolvedBusiness()?.address?.trim() || booking.address?.trim();
    const lines = [heading, this.appointmentDisplay(), venue, this.directionsUrl()].filter(Boolean);
    const text = lines.join("\n");

    if (navigator.share) {
      try {
        await navigator.share({ title: "Booking details", text });
        this.setFeedback("Booking shared");
        return;
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") {
          this.setFeedback("Sharing cancelled");
          return;
        }
      }
    }

    const copied = await this.copyText(text);
    this.setFeedback(copied ? "Booking details copied to clipboard" : "Booking could not be shared");
  }

  rebook() {
    const booking = this.booking();
    if (!booking) return;
    const businessIdentity = this.resolvedBusiness()?.slug || booking.businessId;
    if (businessIdentity) {
      void this.router.navigate([this.businessBookUrl(businessIdentity)], {
        queryParams: {
          serviceId: booking.serviceId || undefined,
          staffId: booking.staffId || undefined,
          rebookFrom: booking.id,
          step: 3
        }
      });
      return;
    }
    void this.router.navigate([this.marketplace.salonMode() ? this.marketplace.salonModeUrl() : "/search"], { queryParams: { q: [booking.businessName, booking.serviceName].filter(Boolean).join(" ") } });
  }

  requestSupport() {
    const booking = this.booking();
    if (!booking) return;
    void this.router.navigate([this.bookingSupportRoute()], { queryParams: this.supportQuery() });
  }

  addToCalendar() {
    const booking = this.booking();
    const start = this.calendarStart();
    if (!booking || !start) return;

    const suppliedEnd = this.parseDate(booking.endAt || booking.endsAt);
    const suppliedDuration = booking.durationMinutes || booking.serviceDurationMinutes;
    const durationMinutes = typeof suppliedDuration === "number" && suppliedDuration > 0 ? suppliedDuration : 60;
    const end = suppliedEnd && suppliedEnd.getTime() > start.getTime()
      ? suppliedEnd
      : new Date(start.getTime() + durationMinutes * 60_000);
    const reference = this.bookingReference();
    const summary = [booking.serviceName, booking.businessName].filter(Boolean).join(" at ");
    const lines = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//Aura Salon//Booking//EN",
      "CALSCALE:GREGORIAN",
      "METHOD:PUBLISH",
      "BEGIN:VEVENT",
      `UID:${this.escapeIcs(reference)}@aura-salon`,
      `DTSTAMP:${this.formatIcsDate(new Date())}`,
      `DTSTART:${this.formatIcsDate(start)}`,
      `DTEND:${this.formatIcsDate(end)}`,
      `SUMMARY:${this.escapeIcs(summary)}`,
      `DESCRIPTION:${this.escapeIcs(`Booking reference: ${reference}`)}`
    ];
    if (booking.address?.trim()) lines.push(`LOCATION:${this.escapeIcs(booking.address.trim())}`);
    lines.push("END:VEVENT", "END:VCALENDAR");

    const url = URL.createObjectURL(new Blob([`${lines.join("\r\n")}\r\n`], { type: "text/calendar;charset=utf-8" }));
    const anchor = document.createElement("a");
    const safeReference = reference.replace(/[^a-z0-9_-]+/gi, "-").replace(/^-+|-+$/g, "") || "booking";
    anchor.href = url;
    anchor.download = `aura-booking-${safeReference}.ics`;
    anchor.hidden = true;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  toggleContact() {
    this.contactExpanded.update((open) => !open);
  }

  openManageSheet() {
    if (!this.isActive()) return;
    this.manageSheetOpen.set(true);
  }

  closeManageSheet(): void {
    if (this.manageSheetDirty() && !window.confirm("Discard changes in this manage booking sheet?")) return;
    this.manageSheetDirty.set(false);
    this.manageSheetOpen.set(false);
  }

  rescheduleFromSheet() {
    this.closeManageSheet();
    void this.reschedule();
  }

  cancelFromSheet() {
    if (!this.canCancelBooking()) return;
    this.closeManageSheet();
    this.cancelDone.set(false);
    this.cancelSubmitting.set(false);
    this.cancelSheetOpen.set(true);
  }

  changeServices() {
    if (!this.canChangeServices()) return;
    const booking = this.booking();
    const identity = this.resolvedBusiness()?.slug || booking?.businessId;
    if (!booking || !identity) {
      this.setFeedback("This booking cannot be changed because the salon details are missing.");
      return;
    }
    this.closeManageSheet();
    void this.router.navigate([this.businessBookUrl(identity)], {
      queryParams: { serviceId: booking.serviceId || undefined, staffId: booking.staffId || undefined, step: 1 }
    });
  }

  changeProfessional() {
    if (!this.canChangeProfessional()) return;
    const booking = this.booking();
    const identity = this.resolvedBusiness()?.slug || booking?.businessId;
    if (!booking || !identity) {
      this.setFeedback("This booking cannot be changed because the salon details are missing.");
      return;
    }
    this.closeManageSheet();
    void this.router.navigate([this.businessBookUrl(identity)], {
      queryParams: {
        serviceId: booking.serviceId || undefined,
        staffId: booking.staffId || undefined,
        date: this.localDateKey(this.parseDate(booking.startAt || booking.startsAt) || new Date()),
        slotStartAt: booking.startAt || booking.startsAt || undefined,
        step: 2
      }
    });
  }

  addService() {
    if (!this.canAddServiceToBooking()) return;
    const booking = this.booking();
    const identity = this.resolvedBusiness()?.slug || booking?.businessId;
    if (!booking || !identity) {
      this.setFeedback("This booking cannot be changed because the salon details are missing.");
      return;
    }
    this.closeManageSheet();
    void this.router.navigate([this.businessBookUrl(identity)], {
      queryParams: { serviceId: booking.serviceId || undefined, staffId: booking.staffId || undefined, step: 1 }
    });
  }

  canChangeServices(): boolean {
    const booking = this.booking();
    return this.isActive() && !!booking?.serviceId && !!(this.resolvedBusiness()?.slug || booking.businessId);
  }

  canChangeProfessional(): boolean {
    const booking = this.booking();
    return this.isActive() && !!booking?.serviceId && !!(this.resolvedBusiness()?.slug || booking.businessId);
  }

  canAddServiceToBooking(): boolean {
    const booking = this.booking();
    return this.isActive() && !!(this.resolvedBusiness()?.slug || booking?.businessId);
  }

  manageActionReason(): string {
    if (!this.isActive()) return "Past or completed bookings cannot be changed.";
    const booking = this.booking();
    if (!booking || !(this.resolvedBusiness()?.slug || booking.businessId)) return "Salon details are missing for this booking.";
    if (!booking.serviceId) return "Original service details are missing for this booking.";
    return "This action is unavailable for this booking.";
  }

  cancelDisabledReason(): string {
    if (!this.isActive()) return "Past bookings cannot be cancelled.";
    if (this.cancellationCutoffExpired()) return "Cancellation cutoff has expired.";
    return "Cancellation is unavailable for this booking.";
  }

  private resolveSalonPhone(business: Business | null): { label: string; href: string } | null {
    if (!business) return null;
    const value = [business.appointmentNumber, business.mobileNumber, business.phone, business.telephoneNumber]
      .find((phone) => typeof phone === "string" && phone.trim())?.trim();
    if (!value) return null;
    const digits = value.replace(/\D/g, "");
    if (digits.length < 7 || digits.length > 15) return null;
    const dialValue = `${value.startsWith("+") ? "+" : ""}${digits}`;
    return { label: this.formatPhoneLabel(value, digits), href: `tel:${dialValue}` };
  }

  private formatPhoneLabel(raw: string, digits: string): string {
    if (raw.trim().startsWith("+")) {
      const country = digits.length > 10 ? digits.slice(0, digits.length - 10) : "";
      const local = digits.length > 10 ? digits.slice(-10) : digits;
      return country ? `+${country} ${local.slice(0, 5)} ${local.slice(5)}` : raw.trim();
    }
    if (digits.length === 10) return `${digits.slice(0, 5)} ${digits.slice(5)}`;
    return raw.trim();
  }

  private resolveDirectionsUrl(): string {
    const business = this.resolvedBusiness();
    const booking = this.booking();
    const mapsUrl = this.safeHttpUrl(business?.mapsUrl);
    if (mapsUrl) return mapsUrl;
    const businessCoordinates = this.coordinatesUrl(business?.latitude, business?.longitude);
    if (businessCoordinates) return businessCoordinates;
    const bookingCoordinates = this.coordinatesUrl(booking?.latitude, booking?.longitude);
    if (bookingCoordinates) return bookingCoordinates;
    const address = business?.address?.trim() || booking?.address?.trim();
    return address ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}` : "";
  }

  private coordinatesUrl(latitude?: number | null, longitude?: number | null): string {
    if (typeof latitude !== "number" || typeof longitude !== "number" || !Number.isFinite(latitude) || !Number.isFinite(longitude)) return "";
    return `https://www.google.com/maps/search/?api=1&query=${latitude},${longitude}`;
  }

  private safeHttpUrl(value?: string): string {
    if (!value) return "";
    try {
      const url = new URL(value);
      return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : "";
    } catch {
      return "";
    }
  }

  private sameName(first: string, second: string): boolean {
    return first.trim().toLocaleLowerCase() === second.trim().toLocaleLowerCase();
  }

  private async copyText(value: string): Promise<boolean> {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(value);
        return true;
      }
    } catch {
      // Use the local selection fallback below.
    }
    return this.copyWithFallback(value);
  }

  private setFeedback(message: string) {
    this.actionFeedback.set(message);
    if (this.copyResetTimer) clearTimeout(this.copyResetTimer);
    this.copyResetTimer = setTimeout(() => {
      this.copyState.set("idle");
      this.actionFeedback.set("");
    }, 2400);
  }

  private appointmentStart(): string {
    const booking = this.booking();
    return String(booking?.startsAt || booking?.startAt || booking?.displayStartAt || "");
  }

  private calendarStart(): Date | null {
    const booking = this.booking();
    return this.parseDate(booking?.startsAt || booking?.startAt) || this.parseDate(booking?.displayStartAt);
  }

  private formatAppointment(value: string): string {
    const date = this.parseDate(value);
    if (!date) return value;
    try {
      const day = new Intl.DateTimeFormat("en-IN", { weekday: "short", day: "numeric", month: "short", timeZone: "Asia/Kolkata" }).format(date);
      const time = new Intl.DateTimeFormat("en-IN", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: "Asia/Kolkata" }).format(date).toUpperCase();
      return `${day} · ${time}`;
    } catch {
      return value;
    }
  }

  private formatAppointmentWindow(): string {
    const start = this.calendarStart();
    if (!start) return this.appointmentStart() || "Time to be confirmed";
    const end = this.appointmentEnd(start);
    const day = new Intl.DateTimeFormat("en-IN", { weekday: "short", day: "numeric", month: "short", timeZone: "Asia/Kolkata" }).format(start);
    const timeFormatter = new Intl.DateTimeFormat("en-IN", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: "Asia/Kolkata" });
    return `${day} · ${timeFormatter.format(start).toUpperCase()}–${timeFormatter.format(end).toUpperCase()}`;
  }

  private appointmentEnd(start: Date): Date {
    const booking = this.booking();
    const explicit = this.parseDate(booking?.endsAt || booking?.endAt);
    if (explicit) return explicit;
    return new Date(start.getTime() + this.bookingDurationMinutes() * 60_000);
  }

  private isPastBooking(booking: Booking): boolean {
    const start = this.parseDate(booking.startsAt || booking.startAt || booking.displayStartAt);
    if (!start) return false;
    const explicitEnd = this.parseDate(booking.endsAt || booking.endAt);
    const duration = Number(booking.durationMinutes || booking.serviceDurationMinutes || 60);
    const end = explicitEnd && explicitEnd.getTime() > start.getTime()
      ? explicitEnd
      : new Date(start.getTime() + (Number.isFinite(duration) && duration > 0 ? duration : 60) * 60_000);
    return end.getTime() <= Date.now();
  }

  private bookingDurationMinutes(): number {
    const booking = this.booking();
    const minutes = Number(booking?.durationMinutes || booking?.serviceDurationMinutes || 60);
    return Number.isFinite(minutes) && minutes > 0 ? minutes : 60;
  }

  private formatDuration(minutes: number): string {
    const hours = Math.floor(minutes / 60);
    const rest = minutes % 60;
    if (hours && rest) return `${hours}h ${rest}m`;
    if (hours) return `${hours}h`;
    return `${minutes} min`;
  }

  private paymentLabel(value: unknown): string {
    const amount = this.bookingAmountPaise();
    const paid = this.bookingPaidPaise();
    const balance = Math.max(0, amount - paid);
    const raw = String(value || "").trim();
    if (!raw) return amount > 0 ? `${this.money(amount)} payable at salon` : "Payment due at salon";
    const normalized = raw.toLowerCase().replace(/[\s-]+/g, "_").replace(/[^a-z0-9_]/g, "");
    if (["paid", "payment_received", "success", "captured"].includes(normalized)) return amount > 0 ? `Paid ${this.money(amount)}` : "Paid";
    if (["partial", "part_paid", "partially_paid", "advance_paid"].includes(normalized)) return paid > 0 && balance > 0 ? `Paid ${this.money(paid)} · ${this.money(balance)} balance` : "Part payment received";
    if (["refunded", "refund_completed", "refund_issued"].includes(normalized)) return "Refunded";
    if (["not_required", "no_payment_required"].includes(normalized)) {
      return amount > 0 ? `${this.money(amount)} payable at salon` : (this.booking()?.status === "completed" ? "No charge" : "Payment due at salon");
    }
    if (["pay_at_venue", "pay_on_arrival", "pay_at_salon", "payment_at_venue", "cash_at_venue", "pending", "unpaid", "due"].includes(normalized)) return amount > 0 ? `${this.money(amount)} payable at salon` : "Payment due at salon";
    const readable = raw.replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim().toLowerCase();
    return readable ? readable.charAt(0).toUpperCase() + readable.slice(1) : raw;
  }

  private bookingAmountPaise(): number {
    const record = this.booking() as Record<string, unknown> | null;
    return this.firstMoneyPaise(record, ["totalAmountPaise", "amountPaise", "totalPaise", "payablePaise", "pricePaise", "totalAmount", "amount", "payableAmount"]);
  }

  private bookingPaidPaise(): number {
    const record = this.booking() as Record<string, unknown> | null;
    return this.firstMoneyPaise(record, ["paidAmountPaise", "amountPaidPaise", "advancePaidPaise", "paidPaise", "paidAmount", "amountPaid", "advancePaid"]);
  }

  private cancellationFeePaise(): number {
    const record = this.booking() as Record<string, unknown> | null;
    const explicit = this.firstMoneyPaise(record, ["cancellationFeePaise", "cancelFeePaise", "cancellationChargePaise", "cancellationPenaltyPaise", "cancellationFee", "cancelFee", "cancellationCharge", "cancellationPenalty"]);
    if (explicit > 0) return explicit;
    const policy = String(record?.["cancellationPolicy"] || "");
    const percent = policy.match(/(\d+(?:\.\d+)?)\s*(?:%|percent)/i);
    if (percent) return Math.round(this.bookingAmountPaise() * Number(percent[1]) / 100);
    return 0;
  }

  private cancellationCutoffDate(): Date | null {
    const record = this.booking() as Record<string, unknown> | null;
    const explicit = ["cancellationCutoffAt", "cancellationDeadlineAt", "cancellableUntil", "cancelUntil", "freeCancellationUntil"]
      .map((key) => this.parseDate(String(record?.[key] || "")))
      .find((date): date is Date => !!date);
    if (explicit) return explicit;

    const start = this.calendarStart();
    const policy = String(record?.["cancellationPolicy"] || "");
    const hours = policy.match(/(\d+(?:\.\d+)?)\s*(?:hours?|hrs?|h)\b/i);
    if (start && hours) return new Date(start.getTime() - Number(hours[1]) * 60 * 60_000);
    return null;
  }

  private cancellationCutoffExpired(): boolean {
    const cutoff = this.cancellationCutoffDate();
    return !!cutoff && cutoff.getTime() <= Date.now();
  }

  private firstMoneyPaise(record: Record<string, unknown> | null, keys: string[]): number {
    if (!record) return 0;
    for (const key of keys) {
      const value = Number(record[key] || 0);
      if (Number.isFinite(value) && value > 0) return key.toLowerCase().endsWith("paise") ? Math.round(value) : Math.round(value * 100);
    }
    return 0;
  }

  private money(paise: number): string {
    return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(Math.max(0, paise) / 100);
  }

  private formatShortDateTime(date: Date): string {
    return new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", hour12: true, timeZone: "Asia/Kolkata" }).format(date);
  }

  private formatBookingReference(value: string): string {
    const raw = String(value || "").trim();
    if (!raw) return "Booking reference pending";
    const cleaned = raw.replace(/^booking[-_#\s]*/i, "").replace(/_/g, "-").toUpperCase();
    return `Booking #${cleaned}`;
  }

  private extractServiceTimeline(): Array<{ index: number; name: string; meta: string }> {
    const booking = this.booking() as (Record<string, unknown> & { serviceName?: string; staffName?: string }) | null;
    if (!booking) return [];
    const rows = ["services", "serviceItems", "items", "lineItems"]
      .map((key) => booking[key])
      .find((value): value is unknown[] => Array.isArray(value)) || [];
    if (rows.length <= 1) return [];
    return rows.map((row, index) => {
      const item = row as Record<string, unknown>;
      const name = String(item["name"] || item["serviceName"] || item["title"] || `Service ${index + 1}`);
      const staff = String(item["staffName"] || item["professionalName"] || booking.staffName || "").trim();
      const minutes = Number(item["durationMinutes"] || item["serviceDurationMinutes"] || 0);
      const price = this.firstMoneyPaise(item, ["pricePaise", "amountPaise", "totalPaise", "price", "amount"]);
      const meta = [staff, Number.isFinite(minutes) && minutes > 0 ? this.formatDuration(minutes) : "", price > 0 ? this.money(price) : ""].filter(Boolean).join(" · ") || "Included in booking";
      return { index: index + 1, name, meta };
    });
  }

  private parseDate(value?: string): Date | null {
    if (!value) return null;
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? date : null;
  }

  private localDateKey(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  private formatIcsDate(date: Date): string {
    return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  }

  private escapeIcs(value: string): string {
    return value.replace(/\\/g, "\\\\").replace(/\r?\n/g, "\\n").replace(/,/g, "\\,").replace(/;/g, "\\;");
  }

  private copyWithFallback(value: string): boolean {
    const activeElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const textarea = document.createElement("textarea");
    textarea.value = value;
    textarea.readOnly = true;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    try {
      return document.execCommand("copy");
    } catch {
      return false;
    } finally {
      textarea.remove();
      activeElement?.focus();
    }
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
    if (!this.booking() || !this.canCancelBooking()) return;
    this.cancelDone.set(false);
    this.cancelSubmitting.set(false);
    this.cancelSheetOpen.set(true);
  }

  closeCancelSheet(): void {
    this.cancelSheetOpen.set(false);
    this.cancelDone.set(false);
  }

  rescheduleInstead() {
    this.closeCancelSheet();
    void this.reschedule();
  }

  async confirmCancelBooking(id: string) {
    if (this.cancelSubmitting()) return;
    this.cancelSubmitting.set(true);
    try {
      await this.marketplace.cancelBooking(id);
      this.cancelDone.set(true);
    } catch {
      // The error is surfaced through marketplace.error(); keep the sheet open.
    } finally {
      this.cancelSubmitting.set(false);
    }
  }

  async reschedule() {
    const booking = this.booking();
    if (!booking) return;
    const businessIdentity = this.resolvedBusiness()?.slug || booking.businessId;
    if (!businessIdentity || !booking.serviceId) {
      this.setFeedback("Rescheduling is unavailable for this booking");
      return;
    }
    await this.router.navigate([this.businessBookUrl(businessIdentity)], {
      queryParams: {
        serviceId: booking.serviceId,
        staffId: booking.staffId || undefined,
        date: this.localDateKey(this.parseDate(booking.startAt || booking.startsAt) || new Date()),
        slotStartAt: booking.startAt || booking.startsAt || undefined,
        step: 3,
        rescheduleBookingId: booking.id
      }
    });
  }

}
