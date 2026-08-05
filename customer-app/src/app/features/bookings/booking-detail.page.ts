import { Component, OnDestroy, OnInit, computed, signal } from "@angular/core";
import { ActivatedRoute, Router, RouterLink } from "@angular/router";
import { IonButton, IonContent, IonIcon } from "@ionic/angular/standalone";
import { addIcons } from "ionicons";
import { addOutline, alertCircleOutline, calendarOutline, callOutline, cardOutline, chatbubbleEllipsesOutline, checkmarkCircleOutline, checkmarkOutline, chevronForwardOutline, closeCircleOutline, copyOutline, downloadOutline, giftOutline, helpCircleOutline, locationOutline, navigateOutline, personOutline, repeatOutline, settingsOutline, shareSocialOutline, storefrontOutline, swapHorizontalOutline, timeOutline } from "ionicons/icons";
import { Business } from "../../core/api.types";
import { MarketplaceService } from "../../core/marketplace.service";
import { CustomerMobileHeaderComponent } from "../../shared/customer-mobile-header.component";

@Component({
  standalone: true,
  imports: [IonButton, IonContent, IonIcon, RouterLink, CustomerMobileHeaderComponent],
  template: `
    <aura-customer-mobile-header title="Booking details" [subtitle]="booking()?.businessName || ''" [backHref]="backHref()" />
    <ion-content>
      @if (booking(); as booking) {
        <main class="page-narrow detail-page">
          @if (statusNote(); as note) {
            <section class="status-note" role="status">{{ note }}</section>
          }

          <section class="itinerary-card" aria-labelledby="booking-service">
            <div class="summary-top">
              <span class="booking-status-pill" [class.closed]="booking.status === 'cancelled'">{{ statusLabel() }}</span>
              <h1 id="booking-service">{{ booking.serviceName }}</h1>
              <p>{{ booking.businessName }}</p>
            </div>

            <div class="appointment-time">
              <ion-icon name="time-outline" aria-hidden="true"></ion-icon>
              <div>
                <span>Appointment time</span>
                <strong>{{ appointmentDisplay() }}</strong>
              </div>
            </div>

            <dl class="booking-facts">
              <div>
                <dt><ion-icon name="location-outline" aria-hidden="true"></ion-icon>Venue</dt>
                <dd>{{ booking.address || "Venue to be confirmed" }}</dd>
              </div>
              <div>
                <dt><ion-icon name="card-outline" aria-hidden="true"></ion-icon>Payment</dt>
                <dd>{{ paymentDisplay() }}</dd>
              </div>
              <div class="reference-fact">
                <dt><ion-icon name="checkmark-circle-outline" aria-hidden="true"></ion-icon>Booking reference</dt>
                <dd class="reference-value">
                  <span>{{ bookingReference() }}</span>
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
                      <a class="option-row" [href]="phone.href">
                        <ion-icon name="call-outline" aria-hidden="true"></ion-icon>
                        <span>Call salon · {{ phone.label }}</span>
                        <ion-icon class="row-chevron" name="chevron-forward-outline" aria-hidden="true"></ion-icon>
                      </a>
                    }
                  </div>
                }
              </div>

              @if (directionsUrl(); as mapUrl) {
                <a class="primary-action outline" [href]="mapUrl" target="_blank" rel="noopener noreferrer" aria-label="Open venue directions in a new tab">
                  <ion-icon name="navigate-outline" aria-hidden="true"></ion-icon>
                  <span>Directions</span>
                </a>
              } @else {
                <button type="button" class="primary-action outline" disabled>
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
                <span>Download invoice</span>
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
              <ion-button expand="block" class="primary-gradient" (click)="rebook()">Book another appointment</ion-button>
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
              <ion-icon name="help-circle-outline" aria-hidden="true"></ion-icon>
              <span>Request support for this booking</span>
              <ion-icon class="row-chevron" name="chevron-forward-outline" aria-hidden="true"></ion-icon>
            </button>
            <a class="option-row" [routerLink]="helpRoute()" [queryParams]="supportQuery()">
              <ion-icon name="help-circle-outline" aria-hidden="true"></ion-icon>
              <span>Help centre</span>
              <ion-icon class="row-chevron" name="chevron-forward-outline" aria-hidden="true"></ion-icon>
            </a>
          </section>

          <details class="policy-strip">
            <summary>
              <span>Cancellation &amp; rescheduling policy</span>
              <small>Open the full policy for this booking</small>
            </summary>
            <p>{{ booking.cancellationPolicy || "The business policy will appear here when returned by the API." }}</p>
          </details>

          @if (isActive()) {
            <button type="button" class="cancel-link" (click)="cancel()">
              <ion-icon name="close-circle-outline" aria-hidden="true"></ion-icon>
              <span>Cancel booking</span>
            </button>
          }
        </main>

        @if (manageSheetOpen()) {
          <div class="sheet-backdrop" role="presentation" (click)="closeManageSheet()">
            <section class="action-sheet" role="dialog" aria-modal="true" aria-labelledby="manage-sheet-title" (click)="$event.stopPropagation()">
              <h2 id="manage-sheet-title">Manage booking</h2>
              <p class="sheet-subtitle">Choose what you would like to change for this appointment.</p>
              <button type="button" class="option-row" (click)="changeServices()">
                <ion-icon name="swap-horizontal-outline" aria-hidden="true"></ion-icon>
                <span>Change services</span>
                <ion-icon class="row-chevron" name="chevron-forward-outline" aria-hidden="true"></ion-icon>
              </button>
              <button type="button" class="option-row" (click)="changeProfessional()">
                <ion-icon name="person-outline" aria-hidden="true"></ion-icon>
                <span>Change professional</span>
                <ion-icon class="row-chevron" name="chevron-forward-outline" aria-hidden="true"></ion-icon>
              </button>
              <button type="button" class="option-row" (click)="rescheduleFromSheet()">
                <ion-icon name="calendar-outline" aria-hidden="true"></ion-icon>
                <span>Reschedule</span>
                <ion-icon class="row-chevron" name="chevron-forward-outline" aria-hidden="true"></ion-icon>
              </button>
              <button type="button" class="option-row" (click)="addService()">
                <ion-icon name="add-outline" aria-hidden="true"></ion-icon>
                <span>Add a service</span>
                <ion-icon class="row-chevron" name="chevron-forward-outline" aria-hidden="true"></ion-icon>
              </button>
              <button type="button" class="option-row cancel-sheet-row" (click)="cancelFromSheet()">
                <ion-icon name="close-circle-outline" aria-hidden="true"></ion-icon>
                <span>Cancel booking</span>
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
                  <button type="button" class="destructive-confirm" [disabled]="cancelSubmitting()" (click)="confirmCancelBooking(booking.id)">{{ cancelSubmitting() ? "Cancelling…" : "Yes, cancel appointment" }}</button>
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
    .detail-page { display: grid; gap: 12px; max-width: 680px; }

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
      color: #059669;
      border: 1px solid rgba(52, 211, 153, 0.38);
      background: #D1FAE5;
      border-radius: 999px;
      font-size: 0.62rem;
      font-weight: 900;
      line-height: 1;
      text-transform: capitalize;
    }
    .booking-status-pill.closed { color: var(--muted); background: var(--surface-soft); border-color: transparent; }
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
    .appointment-time span { display: block; color: rgba(255, 255, 255, 0.72); font-size: 0.66rem; font-weight: 700; letter-spacing: 0.03em; text-transform: uppercase; }
    .appointment-time strong { display: block; color: #FFFFFF; font-size: 0.95rem; line-height: 1.3; overflow-wrap: anywhere; }
    .booking-facts { display: grid; margin: 0; }
    .booking-facts div { min-width: 0; padding: 8px 16px; border-bottom: 1px solid rgba(255, 255, 255, 0.1); }
    .booking-facts div:last-child { border-bottom: 0; }
    .booking-facts dt { display: flex; align-items: center; gap: 7px; margin: 0 0 2px; color: rgba(255, 255, 255, 0.72); font-size: 0.66rem; font-weight: 750; }
    .booking-facts dt ion-icon { flex: 0 0 auto; font-size: 0.88rem; }
    .booking-facts dd { margin: 0; color: #FFFFFF; font-size: 0.86rem; font-weight: 750; line-height: 1.3; overflow-wrap: anywhere; word-break: break-word; }
    .reference-fact dd { font-size: 0.8rem; }
    .reference-fact dt { color: rgba(255, 255, 255, 0.58); }
    .reference-value { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
    .reference-value > span { min-width: 0; color: rgba(255, 255, 255, 0.82); font-family: ui-monospace, "SFMono-Regular", Consolas, monospace; overflow-wrap: anywhere; }
    .copy-reference {
      display: inline-flex;
      flex: 0 0 auto;
      align-items: center;
      justify-content: center;
      gap: 4px;
      min-height: 32px;
      padding: 6px 8px;
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

    .primary-actions {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 8px;
    }
    .primary-actions .contact-wrap { grid-column: 1 / -1; display: grid; gap: 8px; }
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
      min-height: 38px;
      align-items: center;
      justify-content: center;
      gap: 6px;
      padding: 6px 12px;
      border: 1px solid var(--border-strong);
      border-radius: 999px;
      color: var(--primary);
      background: var(--surface);
      font-family: inherit;
      font-size: 0.78rem;
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
      font-size: 0.66rem;
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
    .option-row > span { min-width: 0; color: inherit; overflow-wrap: anywhere; }
    .row-chevron { color: var(--muted); font-size: 0.95rem; }

    .policy-strip {
      border-block: 1px solid var(--border);
      color: var(--text);
      background: var(--glass);
    }
    .policy-strip summary {
      display: grid;
      grid-template-columns: 14px minmax(0, 1fr);
      align-items: center;
      column-gap: 7px;
      min-height: 44px;
      padding: 12px 4px;
      color: var(--text);
      list-style: none;
      cursor: pointer;
    }
    .policy-strip summary::-webkit-details-marker { display: none; }
    .policy-strip summary::before {
      grid-column: 1;
      grid-row: 1 / span 2;
      content: "›";
      color: var(--primary);
      font-size: 1.05rem;
      font-weight: 900;
      line-height: 1;
      transform: rotate(0deg);
      transition: transform var(--motion-fast);
    }
    .policy-strip[open] summary::before { transform: rotate(90deg); }
    .policy-strip summary span { grid-column: 2; display: block; color: var(--text); font-size: 0.88rem; font-weight: 850; }
    .policy-strip summary small { grid-column: 2; display: block; margin-top: 2px; color: var(--muted); font-size: 0.75rem; font-weight: 650; }
    .policy-strip p { margin: 0; padding: 0 4px 13px; color: var(--text); font-size: 0.9rem; line-height: 1.5; overflow-wrap: anywhere; }
    .policy-strip summary:focus-visible { outline: 3px solid var(--focus); outline-offset: 3px; border-radius: 4px; }

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
      padding: 18px 20px;
      border: 1px solid var(--border);
      border-radius: 24px;
      background: var(--surface);
      box-shadow: 0 24px 60px rgba(28, 28, 28, 0.22);
    }
    .action-sheet h2 { margin: 0; color: var(--text); font-size: 1.18rem; letter-spacing: -0.03em; }
    .action-sheet .sheet-subtitle { margin: 0 0 10px; color: var(--muted); font-size: 0.84rem; line-height: 1.45; }
    .action-sheet .option-row { border-radius: 10px; }
    .cancel-sheet-row { color: #B42318 !important; margin-top: 6px; border-top: 1px solid var(--border); }
    .cancel-sheet-row > ion-icon:first-child { color: #B42318; }
    .cancel-sheet { gap: 12px; }
    .cancel-summary-line { margin: 0; color: var(--text); font-size: 0.9rem; font-weight: 750; line-height: 1.45; overflow-wrap: anywhere; }
    .impact-panel { display: grid; gap: 8px; padding: 12px 14px; border: 1px solid var(--border); border-radius: 14px; background: var(--surface-soft); }
    .impact-primary { margin: 0; color: var(--text); font-size: 0.92rem; font-weight: 900; line-height: 1.4; }
    .impact-row { display: flex; align-items: flex-start; gap: 8px; margin: 0; color: var(--muted); font-size: 0.84rem; font-weight: 650; line-height: 1.45; }
    .impact-row ion-icon { flex: 0 0 auto; margin-top: 2px; color: var(--primary); font-size: 0.95rem; }
    .policy-note { margin: 0; color: var(--muted); font-size: 0.76rem; line-height: 1.4; }
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
  private readonly id = signal(this.route.snapshot.paramMap.get("id"));
  private copyResetTimer: ReturnType<typeof setTimeout> | undefined;
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
  readonly appointmentDisplay = computed(() => this.formatAppointment(this.appointmentStart()));
  readonly paymentDisplay = computed(() => this.paymentLabel(this.booking()?.paymentStatus));
  readonly salonPhone = computed(() => this.resolveSalonPhone(this.resolvedBusiness()));
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
    return !!booking && (booking.status === "pending" || booking.status === "confirmed");
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
  readonly contactExpanded = signal(false);
  readonly cancelDone = signal(false);
  readonly cancelSubmitting = signal(false);

  readonly cancelRefundLine = computed<string | null>(() => {
    const booking = this.booking();
    if (!booking) return null;
    const payment = String(booking.paymentStatus || "").toLowerCase();
    if (["paid", "captured", "payment_received"].includes(payment)) return "Your payment will be refunded to your original payment method.";
    if (["refunded"].includes(payment)) return "Your payment has already been refunded to your original payment method.";
    return "No payment was taken for this appointment, so there is nothing to refund.";
  });

  readonly cancelFeeLine = computed<string | null>(() => {
    const policy = String(this.booking()?.cancellationPolicy || "");
    return /fee|charge|forfeit|deposit|penalty|%|percent/i.test(policy) ? policy : null;
  });

  // Bookings do not carry membership/package usage data today, so the credit
  // consequence row is intentionally omitted until the API exposes that data.
  readonly cancelCreditsLine = computed<string | null>(() => null);

  constructor(private readonly route: ActivatedRoute, private readonly router: Router, readonly marketplace: MarketplaceService) {
    addIcons({ addOutline, alertCircleOutline, calendarOutline, callOutline, cardOutline, chatbubbleEllipsesOutline, checkmarkCircleOutline, checkmarkOutline, chevronForwardOutline, closeCircleOutline, copyOutline, downloadOutline, giftOutline, helpCircleOutline, locationOutline, navigateOutline, personOutline, repeatOutline, settingsOutline, shareSocialOutline, storefrontOutline, swapHorizontalOutline, timeOutline });
  }

  ngOnInit() {
    this.reload();
  }

  ngOnDestroy() {
    if (this.copyResetTimer) clearTimeout(this.copyResetTimer);
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
    void this.router.navigate([this.helpRoute()], { queryParams: this.supportQuery() });
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
    this.manageSheetOpen.set(true);
  }

  closeManageSheet(): void {
    this.manageSheetOpen.set(false);
  }

  rescheduleFromSheet() {
    this.closeManageSheet();
    void this.reschedule();
  }

  cancelFromSheet() {
    this.closeManageSheet();
    this.cancelDone.set(false);
    this.cancelSubmitting.set(false);
    this.cancelSheetOpen.set(true);
  }

  changeServices() {
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

  private resolveSalonPhone(business: Business | null): { label: string; href: string } | null {
    if (!business) return null;
    const value = [business.appointmentNumber, business.mobileNumber, business.phone, business.telephoneNumber]
      .find((phone) => typeof phone === "string" && phone.trim())?.trim();
    if (!value) return null;
    const digits = value.replace(/\D/g, "");
    if (digits.length < 7 || digits.length > 15) return null;
    const dialValue = `${value.startsWith("+") ? "+" : ""}${digits}`;
    return { label: value, href: `tel:${dialValue}` };
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

  private paymentLabel(value: unknown): string {
    const raw = String(value || "").trim();
    if (!raw) return "Pay at salon";
    const normalized = raw.toLowerCase().replace(/[\s-]+/g, "_").replace(/[^a-z0-9_]/g, "");
    if (["paid", "payment_received", "success", "captured"].includes(normalized)) return "Paid online";
    if (["refunded", "refund_completed", "refund_issued"].includes(normalized)) return "Refunded";
    if (["not_required", "no_payment_required"].includes(normalized)) {
      return this.booking()?.status === "completed" ? "No charge" : "Pay at salon";
    }
    if (["pay_at_venue", "pay_on_arrival", "pay_at_salon", "payment_at_venue", "cash_at_venue", "pending", "unpaid", "due"].includes(normalized)) return "Pay at salon";
    const readable = raw.replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim().toLowerCase();
    return readable ? readable.charAt(0).toUpperCase() + readable.slice(1) : raw;
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
    if (!this.booking()) return;
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
