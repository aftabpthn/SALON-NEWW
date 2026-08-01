import { Component, OnInit, computed, signal } from "@angular/core";
import { ActivatedRoute, Router, RouterLink } from "@angular/router";
import { IonButton, IonContent, IonIcon } from "@ionic/angular/standalone";
import { addIcons } from "ionicons";
import {
  arrowBackOutline,
  calendarOutline,
  callOutline,
  cardOutline,
  cashOutline,
  chatbubbleEllipsesOutline,
  checkmarkCircleOutline,
  chevronForwardOutline,
  documentTextOutline,
  giftOutline,
  heartOutline,
  helpCircleOutline,
  informationCircleOutline,
  locationOutline,
  notificationsOutline,
  optionsOutline,
  peopleOutline,
  pricetagOutline,
  receiptOutline,
  refreshOutline,
  ribbonOutline,
  shieldCheckmarkOutline,
  sparklesOutline,
  starOutline,
  storefrontOutline,
  swapHorizontalOutline,
  timeOutline,
  walletOutline
} from "ionicons/icons";
import { MarketplaceService } from "../../core/marketplace.service";
import { AuthService } from "../../core/auth.service";
import { CustomerSalonRelationship, MySalonDashboard } from "../../core/api.types";

@Component({
  standalone: true,
  imports: [RouterLink, IonButton, IonContent, IonIcon],
  template: `
    <ion-content class="ms-content">
      <main
        class="ms-page"
        [style.--ms-accent]="salonAccent()"
        [style.--ms-accent-soft]="salonAccentSoft()">

        <!-- ─── TOP TOOLBAR HEADER ─── -->
        <header class="ms-toolbar">
          <button type="button" class="ms-icon-button" (click)="exitSalonMode()" aria-label="Exit My Salon Mode">
            <ion-icon name="arrow-back-outline" aria-hidden="true"></ion-icon>
          </button>
          
          <div class="ms-toolbar-title">
            <span class="ms-toolbar-kicker">My Salon Mode</span>
            <strong>{{ dash()?.salon?.name || 'Your Selected Salon' }}</strong>
          </div>

          @if (salonChoices().length > 1 || !dash()?.hasPrimarySalon) {
            <button
              type="button"
              class="ms-switch-button"
              (click)="toggleSalonPicker()"
              [attr.aria-expanded]="salonPickerOpen()"
              aria-controls="salon-picker">
              <ion-icon name="swap-horizontal-outline" aria-hidden="true"></ion-icon>
              <span>Switch Salon ({{ salonChoices().length }})</span>
            </button>
          } @else {
            <span class="ms-toolbar-spacer" aria-hidden="true"></span>
          }
        </header>

        <!-- ─── SALON PICKER DRAWER / MODAL ─── -->
        @if (salonPickerOpen()) {
          <section id="salon-picker" class="ms-picker" aria-labelledby="salon-picker-title">
            <div class="ms-picker-head">
              <div>
                <span class="ms-kicker">Multi-Salon Switcher</span>
                <h2 id="salon-picker-title">Select your active salon</h2>
              </div>
              <span class="ms-picker-count">{{ salonChoices().length }} connected</span>
            </div>
            <p class="ms-picker-note">
              Switching loads isolated wallet balance, loyalty points, active membership, package credits, Happy Hours offers and visit history for that specific salon.
            </p>

            @if (salonChoices().length) {
              <div class="ms-choice-list">
                @for (salon of salonChoices(); track salon.tenantId + ':' + salon.branchId) {
                  <button
                    type="button"
                    class="ms-choice"
                    [class.selected]="isSelectedSalon(salon)"
                    (click)="selectSalon(salon)"
                    [disabled]="selectingSalon()"
                    [attr.aria-pressed]="isSelectedSalon(salon)">
                    <span class="ms-choice-avatar" aria-hidden="true">{{ salonInitials(salon.businessName) }}</span>
                    <span class="ms-choice-copy">
                      <strong>{{ salon.businessName }}</strong>
                      <small>
                        {{ salonVisitLabel(salon) }}
                        @if (salon.lastVisitAt) { <span> · Last {{ formatDate(salon.lastVisitAt) }}</span> }
                      </small>
                    </span>
                    <span class="ms-choice-badge" [class.is-active]="isSelectedSalon(salon)">
                      {{ isSelectedSalon(salon) ? 'Active Salon' : 'Switch' }}
                    </span>
                  </button>
                }
              </div>
            } @else {
              <div class="ms-inline-empty">
                <p>You haven't visited or booked at another salon yet.</p>
                <button type="button" class="ms-text-action" (click)="exitSalonMode()">Exit My Salon</button>
              </div>
            }
          </section>
        }

        <!-- ─── LOADING STATE ─── -->
        @if (loading()) {
          <section class="ms-loading" aria-label="Loading salon dashboard" aria-live="polite" aria-busy="true">
            <div class="ms-skeleton ms-skeleton-hero" aria-hidden="true"></div>
            <div class="ms-skeleton-grid" aria-hidden="true">
              @for (item of [1, 2, 3, 4]; track item) { <div class="ms-skeleton"></div> }
            </div>
            <div class="ms-skeleton ms-skeleton-wide" aria-hidden="true"></div>
          </section>
        } 
        
        <!-- ─── ERROR STATE ─── -->
        @else if (loadError()) {
          <section class="ms-state" role="alert">
            <span class="ms-state-icon"><ion-icon name="refresh-outline" aria-hidden="true"></ion-icon></span>
            <span class="ms-kicker">Connection Error</span>
            <h1>Could not load salon data</h1>
            <p>{{ loadError() }}</p>
            <ion-button class="ms-primary-button" (click)="loadDashboard()">Retry Loading</ion-button>
          </section>
        } 
        
        <!-- ─── MAIN DASHBOARD CONTENT ─── -->
        @else if (dash(); as d) {
          @if (d.salon) {

            <!-- 1. SALON HERO HEADER CARD -->
            <section class="ms-hero" aria-labelledby="salon-title">
              <div class="ms-hero-main">
                <div class="ms-salon-mark" aria-hidden="true">
                  @if (d.salon.logoImage) {
                    <img [src]="d.salon.logoImage" [alt]="d.salon.name" class="ms-salon-mark-img" />
                  } @else {
                    <span>{{ salonInitials(d.salon.name) }}</span>
                  }
                </div>
                <div class="ms-hero-copy">
                  <span class="ms-kicker">Your Personal Salon Experience</span>
                  <h1 id="salon-title">{{ d.salon.name }}</h1>
                  
                  <div class="ms-status-line">
                    <span class="ms-status" [class.is-open]="d.salon.isOpen">
                      <span class="ms-dot" aria-hidden="true"></span>
                      {{ d.salon.isOpen ? 'Open Now' : 'Closed Now' }}
                    </span>
                    @if (d.salon.hoursLabel) {
                      <span class="ms-hours-chip"><ion-icon name="time-outline" aria-hidden="true"></ion-icon> {{ d.salon.hoursLabel }}</span>
                    }
                  </div>
                </div>
              </div>

              <div class="ms-contact-list">
                @if (d.salon.address || d.salon.city) {
                  <div class="ms-contact-item">
                    <ion-icon name="location-outline" aria-hidden="true"></ion-icon>
                    <span>
                      {{ d.salon.address }}
                      @if (d.salon.address && d.salon.city) { <span>, </span> }
                      {{ d.salon.city }}
                    </span>
                  </div>
                }
                @if (d.salon.phone) {
                  <a class="ms-contact-item ms-link" [href]="'tel:' + d.salon.phone">
                    <ion-icon name="call-outline" aria-hidden="true"></ion-icon>
                    <span>{{ d.salon.phone }}</span>
                  </a>
                }
                @if (safeRating(d.salon.ratingAverage, d.salon.ratingCount); as rating) {
                  <div class="ms-contact-item">
                    <ion-icon name="star-outline" class="ms-star-icon" aria-hidden="true"></ion-icon>
                    <span><strong>{{ rating }}</strong> · {{ d.salon.ratingCount }} verified customer reviews</span>
                  </div>
                }
              </div>

              <div class="ms-hero-actions">
                <a class="ms-book-button" [routerLink]="salonBookLink(d.salon)">
                  <ion-icon name="calendar-outline" aria-hidden="true"></ion-icon>
                  Book Appointment
                </a>
                <a class="ms-profile-button" [routerLink]="salonProfileLink(d.salon)">
                  Salon Details
                  <ion-icon name="chevron-forward-outline" aria-hidden="true"></ion-icon>
                </a>
              </div>
            </section>

            <!-- 2. QUICK ACTION SHORTCUT STRIP -->
            <nav class="ms-quick-actions" aria-label="Salon quick navigation">
              <a [routerLink]="salonBookLink(d.salon)">
                <ion-icon name="calendar-outline" aria-hidden="true"></ion-icon><span>Book</span>
              </a>
              <a [routerLink]="scopedLink('wallet')">
                <ion-icon name="wallet-outline" aria-hidden="true"></ion-icon><span>Wallet</span>
              </a>
              <a [routerLink]="scopedLink('rewards')">
                <ion-icon name="ribbon-outline" aria-hidden="true"></ion-icon><span>Loyalty</span>
              </a>
              <a [routerLink]="scopedLink('memberships')">
                <ion-icon name="sparkles-outline" aria-hidden="true"></ion-icon><span>Membership</span>
              </a>
              <a [routerLink]="scopedLink('packages')">
                <ion-icon name="gift-outline" aria-hidden="true"></ion-icon><span>Packages</span>
              </a>
              <a [routerLink]="scopedLink('notifications')">
                <ion-icon name="notifications-outline" aria-hidden="true"></ion-icon><span>Updates</span>
              </a>
            </nav>

            <!-- 3. RELATIONSHIP & ACCOUNT SNAPSHOT (4 METRICS) -->
            <section class="ms-section ms-relationship" aria-labelledby="relationship-title">
              <div class="ms-section-head">
                <div>
                  <span class="ms-kicker">Salon Relationship & Balances</span>
                  <h2 id="relationship-title">Your Account Snapshot</h2>
                </div>
                @if (d.relationship) {
                  <span class="ms-relationship-label">{{ relationshipLabel(d.relationship.type) }}</span>
                }
              </div>

              <div class="ms-snapshot">
                <!-- Membership -->
                <a [routerLink]="scopedLink('memberships')" class="ms-snapshot-item">
                  <div class="ms-snap-top">
                    <span>Membership</span>
                    <ion-icon name="ribbon-outline" aria-hidden="true"></ion-icon>
                  </div>
                  <strong>{{ d.membership?.planName || 'Not Enrolled' }}</strong>
                  <small>{{ d.membership ? safeCount(d.membership.creditsRemaining) + ' service credits left' : 'No active plan' }}</small>
                </a>

                <!-- Salon Wallet -->
                <a [routerLink]="scopedLink('wallet')" class="ms-snapshot-item">
                  <div class="ms-snap-top">
                    <span>Salon Wallet</span>
                    <ion-icon name="wallet-outline" aria-hidden="true"></ion-icon>
                  </div>
                  <strong class="ms-currency">{{ d.wallet ? formatMoney(d.wallet.balancePaise) : '₹0' }}</strong>
                  <small>{{ walletTxCount(d.wallet) }}</small>
                </a>

                <!-- Loyalty Points -->
                <a [routerLink]="scopedLink('rewards')" class="ms-snapshot-item">
                  <div class="ms-snap-top">
                    <span>{{ d.loyalty?.tier || 'Loyalty Tier' }}</span>
                    <ion-icon name="star-outline" aria-hidden="true"></ion-icon>
                  </div>
                  <strong>{{ d.loyalty ? formatNumber(d.loyalty.points) + ' pts' : '0 pts' }}</strong>
                  <small>{{ d.loyalty ? 'Points for discounts' : 'Earn on every visit' }}</small>
                </a>

                <!-- Active Package Credits -->
                <a [routerLink]="scopedLink('packages')" class="ms-snapshot-item">
                  <div class="ms-snap-top">
                    <span>Package Credits</span>
                    <ion-icon name="gift-outline" aria-hidden="true"></ion-icon>
                  </div>
                  <strong>{{ d.packages.length ? packageCredits() + ' sessions' : 'No Package' }}</strong>
                  <small>{{ d.packages.length ? d.packages.length + ' active package' + (d.packages.length === 1 ? '' : 's') : 'Save on bundled visits' }}</small>
                </a>
              </div>
            </section>

            <!-- 4. UPCOMING APPOINTMENTS & REBOOKING CANDIDATE -->
            <section class="ms-section" aria-labelledby="upcoming-title">
              <div class="ms-section-head">
                <div>
                  <span class="ms-kicker">Schedule & Visits</span>
                  <h2 id="upcoming-title">Upcoming Appointment</h2>
                </div>
                <a [routerLink]="scopedLink('bookings')">View All Bookings</a>
              </div>

              @if (upcomingBooking(); as booking) {
                <article class="ms-appointment">
                  <div class="ms-date-tile" aria-hidden="true">
                    <span>{{ datePart(booking.startAt, 'month') }}</span>
                    <strong>{{ datePart(booking.startAt, 'day') }}</strong>
                  </div>
                  <div class="ms-appointment-copy">
                    <span class="ms-status-chip">{{ statusLabel(booking.status) }}</span>
                    <h3>{{ booking.serviceName }}</h3>
                    <p><ion-icon name="people-outline" aria-hidden="true"></ion-icon> {{ booking.staffName || 'Professional to be confirmed' }} · {{ formatTime(booking.startAt) }}</p>
                    @if (validPrice(booking.totalPricePaise)) {
                      <strong class="ms-price">{{ formatMoney(booking.totalPricePaise) }}</strong>
                    }
                  </div>
                  <a class="ms-arrow-link" [routerLink]="scopedLink('bookings', booking.id)" aria-label="View appointment details">
                    <ion-icon name="chevron-forward-outline" aria-hidden="true"></ion-icon>
                  </a>
                </article>
              } @else {
                <div class="ms-empty-panel">
                  <span class="ms-empty-icon"><ion-icon name="calendar-outline" aria-hidden="true"></ion-icon></span>
                  <div>
                    <h3>No upcoming appointments</h3>
                    <p>Ready for a fresh haircut, facial, or styling session? Book a time at {{ d.salon.name }}.</p>
                  </div>
                  <a [routerLink]="salonBookLink(d.salon)">Book New Appointment</a>
                </div>
              }

              <!-- Rebook Candidate Banner -->
              @if (rebookCandidate(); as booking) {
                <div class="ms-rebook-card">
                  <div class="ms-rebook-info">
                    <span class="ms-rebook-tag">Quick Rebook</span>
                    <strong>{{ booking.serviceName }}</strong>
                    <small>With {{ booking.staffName || 'Salon Professional' }}</small>
                  </div>
                  <a class="ms-rebook-action" [routerLink]="salonBookLink(d.salon)">
                    Rebook Service <ion-icon name="chevron-forward-outline" aria-hidden="true"></ion-icon>
                  </a>
                </div>
              }
            </section>

            <!-- 5. HAPPY HOURS & SALON OFFERS -->
            <section class="ms-section" aria-labelledby="offers-title">
              <div class="ms-section-head">
                <div>
                  <span class="ms-kicker">Happy Hours & Savings</span>
                  <h2 id="offers-title">Exclusive Salon Offers</h2>
                </div>
                <a [routerLink]="scopedLink()">All Offers</a>
              </div>

              @if (d.offers.length) {
                <div class="ms-offer-rail">
                  @for (offer of d.offers; track offer.id) {
                    <article class="ms-offer">
                      <span class="ms-offer-value">{{ offerDiscount(offer.discountType, offer.discountValue) }}</span>
                      <h3>{{ offer.title }}</h3>
                      @if (offer.description) { <p>{{ offer.description }}</p> }
                      <div class="ms-offer-footer">
                        <small>Valid {{ formatDate(offer.validFrom) }} – {{ formatDate(offer.validTo) }}</small>
                        <a class="ms-offer-book" [routerLink]="salonBookLink(d.salon)">Claim Offer</a>
                      </div>
                    </article>
                  }
                </div>
              } @else {
                <div class="ms-empty-line">
                  <span>No active Happy Hours or offers for this salon today.</span>
                  <a [routerLink]="scopedLink()">Check Public Coupons</a>
                </div>
              }
            </section>

            <!-- 6. FEATURED SERVICES & PRICING MENU -->
            <section class="ms-section" aria-labelledby="services-title">
              <div class="ms-section-head">
                <div>
                  <span class="ms-kicker">Salon Menu</span>
                  <h2 id="services-title">Services & Pricing</h2>
                </div>
                <a [routerLink]="salonProfileLink(d.salon)">Full Menu</a>
              </div>

              <!-- Category Filter Pills -->
              @if (categories().length > 1) {
                <div class="ms-cat-pills">
                  @for (cat of categories(); track cat) {
                    <button
                      type="button"
                      class="ms-cat-pill"
                      [class.active]="activeCategory() === cat"
                      (click)="setCategory(cat)">
                      {{ cat }}
                    </button>
                  }
                </div>
              }

              @if (filteredServices().length) {
                <div class="ms-service-list">
                  @for (service of filteredServices().slice(0, 8); track service.id) {
                    <div class="ms-service">
                      <span class="ms-service-index" aria-hidden="true">{{ serviceIndex($index) }}</span>
                      <div class="ms-service-copy">
                        <strong>{{ service.name }}</strong>
                        <small>{{ service.category || 'Salon Service' }} · {{ safeDuration(service.durationMinutes) }}</small>
                      </div>
                      <div class="ms-service-right">
                        <span class="ms-service-price">{{ formatMoney(service.pricePaise) }}</span>
                        <a class="ms-service-book-btn" [routerLink]="salonBookLink(d.salon)">Book</a>
                      </div>
                    </div>
                  }
                </div>
              } @else {
                <div class="ms-empty-line">
                  <span>No services available for this category.</span>
                  <a [routerLink]="salonProfileLink(d.salon)">View Profile</a>
                </div>
              }
            </section>

            <!-- 7. STAFF MEMBERS & AVAILABILITY -->
            <section class="ms-section" aria-labelledby="staff-title">
              <div class="ms-section-head">
                <div>
                  <span class="ms-kicker">Our Professionals</span>
                  <h2 id="staff-title">Salon Team</h2>
                </div>
                <a [routerLink]="salonBookLink(d.salon)">Check Availability</a>
              </div>

              @if (d.staff.length) {
                <div class="ms-staff-rail">
                  @for (staff of d.staff; track staff.id) {
                    <a class="ms-staff" [routerLink]="salonBookLink(d.salon)">
                      <span class="ms-staff-avatar" aria-hidden="true">{{ staffInitials(staff.name) }}</span>
                      <strong>{{ staff.name }}</strong>
                      <small>{{ staff.specialty || staff.title || 'Salon Specialist' }}</small>
                      <span class="ms-staff-action">Book with {{ staff.name.split(' ')[0] }}</span>
                    </a>
                  }
                </div>
              } @else {
                <div class="ms-empty-line">
                  <span>Staff profiles are not published for this salon yet.</span>
                </div>
              }
            </section>

            <!-- 8. ACTIVE BENEFITS & PACKAGES -->
            @if (d.packages.length || d.membership) {
              <section class="ms-section" aria-labelledby="active-benefits-title">
                <div class="ms-section-head">
                  <div>
                    <span class="ms-kicker">Subscribed Perks</span>
                    <h2 id="active-benefits-title">Active Membership & Packages</h2>
                  </div>
                </div>

                <div class="ms-benefit-grid">
                  @if (d.membership) {
                    <article class="ms-benefit ms-membership">
                      <span class="ms-benefit-chip">{{ statusLabel(d.membership.status) }}</span>
                      <h3>{{ d.membership.planName }}</h3>
                      <strong>{{ safeCount(d.membership.creditsRemaining) }} credits remaining</strong>
                      <small>Valid through {{ formatDate(d.membership.validityDate) }}</small>
                    </article>
                  }
                  @for (pkg of d.packages; track pkg.id) {
                    <article class="ms-benefit">
                      <span class="ms-benefit-chip ms-pkg-chip">Package</span>
                      <h3>{{ pkg.name }}</h3>
                      <strong>{{ remainingSessions(pkg.sessionsTotal, pkg.sessionsUsed) }} of {{ safeCount(pkg.sessionsTotal) }} sessions left</strong>
                      <div class="ms-progress" role="progressbar" [attr.aria-label]="pkg.name + ' usage'" [attr.aria-valuemin]="0" [attr.aria-valuemax]="safeCount(pkg.sessionsTotal)" [attr.aria-valuenow]="safeCount(pkg.sessionsUsed)">
                        <span [style.width.%]="packageProgress(pkg.sessionsTotal, pkg.sessionsUsed)"></span>
                      </div>
                    </article>
                  }
                </div>
              </section>
            }

            <!-- 9. SALON WALLET & GIFT CARDS SECTION -->
            @if (d.wallet || (d.giftCards && d.giftCards.length)) {
              <section class="ms-section" aria-labelledby="wallet-title">
                <div class="ms-section-head">
                  <div>
                    <span class="ms-kicker">Prepaid & Gift Balances</span>
                    <h2 id="wallet-title">Salon Wallet & Gift Cards</h2>
                  </div>
                  <a [routerLink]="scopedLink('wallet')">Manage Wallet</a>
                </div>

                <div class="ms-wallet-container">
                  @if (d.wallet) {
                    <div class="ms-wallet-card">
                      <div class="ms-wallet-top">
                        <span>Salon Wallet Balance</span>
                        <strong class="ms-wallet-amount">{{ formatMoney(d.wallet.balancePaise) }}</strong>
                      </div>
                      @if (d.wallet.transactions.length) {
                        <div class="ms-tx-list">
                          <small class="ms-tx-head">Recent Wallet Transactions</small>
                          @for (tx of d.wallet.transactions.slice(0, 3); track tx.id) {
                            <div class="ms-tx-item">
                              <span>{{ tx.notes || tx.description || tx.type }}</span>
                              <strong [class.is-credit]="tx.amountPaise > 0">{{ formatMoney(tx.amountPaise) }}</strong>
                            </div>
                          }
                        </div>
                      } @else {
                        <p class="ms-wallet-hint">Use wallet balance for 1-click payment at venue or booking online.</p>
                      }
                    </div>
                  }

                  @if (d.giftCards && d.giftCards.length) {
                    <div class="ms-gift-cards-list">
                      @for (card of d.giftCards; track card.id) {
                        <div class="ms-gift-card">
                          <ion-icon name="gift-outline" aria-hidden="true"></ion-icon>
                          <div>
                            <strong>Card Code: {{ card.code }}</strong>
                            <small>Balance: {{ formatMoney(card.balancePaise) }} · Exp {{ formatDate(card.expiryDate) }}</small>
                          </div>
                          <span class="ms-gift-status">{{ card.status }}</span>
                        </div>
                      }
                    </div>
                  }
                </div>
              </section>
            }

            <!-- 10. VISIT & SERVICE HISTORY -->
            <section class="ms-section" aria-labelledby="history-title">
              <div class="ms-section-head">
                <div>
                  <span class="ms-kicker">Past Experience</span>
                  <h2 id="history-title">Visit History</h2>
                </div>
                <a [routerLink]="scopedLink('bookings')">Full History</a>
              </div>

              @if (d.recentBookings.length) {
                <div class="ms-history-list">
                  @for (booking of d.recentBookings.slice(0, 5); track booking.id) {
                    <a [routerLink]="scopedLink('bookings', booking.id)" class="ms-history-item">
                      <span class="ms-history-date">{{ formatDate(booking.startAt) }}</span>
                      <div class="ms-history-copy">
                        <strong>{{ booking.serviceName }}</strong>
                        <small>{{ booking.staffName || 'Salon Professional' }} · {{ statusLabel(booking.status) }}</small>
                      </div>
                      @if (validPrice(booking.totalPricePaise)) {
                        <strong class="ms-history-price">{{ formatMoney(booking.totalPricePaise) }}</strong>
                      }
                      <ion-icon name="chevron-forward-outline" aria-hidden="true"></ion-icon>
                    </a>
                  }
                </div>
              } @else {
                <div class="ms-empty-line">
                  <span>Your visit history at this salon will appear here after your first appointment.</span>
                </div>
              }
            </section>

            <!-- 11. INVOICES & PAYMENTS SUMMARY -->
            @if (d.invoices && d.invoices.length) {
              <section class="ms-section" aria-labelledby="invoices-title">
                <div class="ms-section-head">
                  <div>
                    <span class="ms-kicker">Billing & Receipts</span>
                    <h2 id="invoices-title">Invoices & Payments</h2>
                  </div>
                  <a [routerLink]="scopedLink('invoices')">View All Invoices</a>
                </div>

                <div class="ms-invoice-list">
                  @for (inv of d.invoices; track inv.id) {
                    <a [routerLink]="scopedLink('invoices')" class="ms-invoice-item">
                      <ion-icon name="receipt-outline" aria-hidden="true"></ion-icon>
                      <div class="ms-invoice-copy">
                        <strong>Invoice #{{ inv.invoiceNumber }}</strong>
                        <small>{{ formatDate(inv.createdAt) }}</small>
                      </div>
                      <div class="ms-invoice-right">
                        <strong>{{ formatMoney(inv.totalPaise) }}</strong>
                        <span class="ms-inv-status">{{ inv.status }}</span>
                      </div>
                    </a>
                  }
                </div>
              </section>
            }

            <!-- 12. SALON NOTIFICATIONS & ANNOUNCEMENTS -->
            @if (d.notifications && d.notifications.length) {
              <section class="ms-section" aria-labelledby="notif-title">
                <div class="ms-section-head">
                  <div>
                    <span class="ms-kicker">Direct Updates</span>
                    <h2 id="notif-title">Salon Notifications</h2>
                  </div>
                  <a [routerLink]="scopedLink('notifications')">All Notifications</a>
                </div>

                <div class="ms-notif-list">
                  @for (n of d.notifications; track n.id) {
                    <div class="ms-notif-item">
                      <ion-icon name="notifications-outline" aria-hidden="true"></ion-icon>
                      <div>
                        <strong>{{ n.title || 'Salon Announcement' }}</strong>
                        <p>{{ n.message }}</p>
                        <small>{{ formatDate(n.createdAt) }}</small>
                      </div>
                    </div>
                  }
                </div>
              </section>
            }

            <!-- 13. POLICIES & SUPPORT HUB -->
            <section class="ms-section ms-more" aria-labelledby="more-title">
              <div class="ms-section-head">
                <div>
                  <span class="ms-kicker">Help & Policies</span>
                  <h2 id="more-title">Salon Support & Policies</h2>
                </div>
              </div>

              <div class="ms-more-grid">
                <a [routerLink]="scopedLink('support')">
                  <ion-icon name="help-circle-outline" aria-hidden="true"></ion-icon>
                  <span><strong>Customer Support</strong><small>Get help with bookings or billing</small></span>
                </a>
                <a [routerLink]="salonProfileLink(d.salon)">
                  <ion-icon name="document-text-outline" aria-hidden="true"></ion-icon>
                  <span><strong>Booking Policies</strong><small>Cancellation & venue terms</small></span>
                </a>
                <a [routerLink]="salonProfileLink(d.salon)">
                  <ion-icon name="star-outline" aria-hidden="true"></ion-icon>
                  <span><strong>Salon Reviews</strong><small>Ratings & community feedback</small></span>
                </a>
                <a [routerLink]="scopedLink()">
                  <ion-icon name="heart-outline" aria-hidden="true"></ion-icon>
                  <span><strong>Favorites</strong><small>Saved salons & staff</small></span>
                </a>
              </div>
            </section>

          } @else {
            <!-- ONBOARDING STATE: NO PRIMARY SALON SELECTED -->
            <section class="ms-state ms-onboarding-state">
              <span class="ms-state-icon"><ion-icon name="sparkles-outline" aria-hidden="true"></ion-icon></span>
              <span class="ms-kicker">Personalized Salon Space</span>
              <h1>Choose Your Active Salon</h1>
              <p>
                Select a salon you have visited or booked with. Your membership, wallet, loyalty points, package credits, Happy Hours offers and history will automatically load for that salon.
              </p>
              @if (salonChoices().length) {
                <div class="ms-choice-list">
                  @for (salon of salonChoices(); track salon.tenantId + ':' + salon.branchId) {
                    <button type="button" class="ms-choice" (click)="selectSalon(salon)" [disabled]="selectingSalon()">
                      <span class="ms-choice-avatar" aria-hidden="true">{{ salonInitials(salon.businessName) }}</span>
                      <span class="ms-choice-copy">
                        <strong>{{ salon.businessName }}</strong>
                        <small>{{ salonVisitLabel(salon) }}</small>
                      </span>
                      <ion-icon name="chevron-forward-outline" aria-hidden="true"></ion-icon>
                    </button>
                  }
                </div>
              } @else {
                <ion-button class="ms-primary-button" (click)="exitSalonMode()">Exit My Salon</ion-button>
              }
            </section>
          }
        }
      </main>
    </ion-content>
  `,
  styles: [`
    :host {
      --ms-ink: #191817;
      --ms-muted: #68635e;
      --ms-ivory: #fbf8f2;
      --ms-line: rgba(36, 32, 29, .12);
      --ms-emerald: #10b981;
      --ms-rose: #f43f5e;
    }
    .ms-content {
      --background: linear-gradient(180deg, #fcfaf6 0%, #f5f2ec 62%, #f8f7f4 100%);
    }
    .ms-page {
      width: min(100%, 1120px);
      min-height: 100%;
      margin: 0 auto;
      padding: 0 16px calc(48px + var(--safe-bottom));
      color: var(--ms-ink);
    }
    .ms-toolbar {
      position: sticky;
      top: 0;
      z-index: 20;
      display: grid;
      grid-template-columns: 44px minmax(0, 1fr) auto;
      align-items: center;
      gap: 10px;
      min-height: 64px;
      margin-inline: -16px;
      padding: 8px 16px;
      border-bottom: 1px solid rgba(36, 32, 29, .08);
      background: rgba(252, 250, 246, .92);
      backdrop-filter: blur(18px);
    }
    .ms-icon-button, .ms-switch-button {
      min-width: 44px;
      min-height: 44px;
      border: 1px solid var(--ms-line);
      border-radius: 999px;
      color: var(--ms-ink);
      background: rgba(255,255,255,.85);
      text-decoration: none;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
    }
    .ms-icon-button ion-icon { font-size: 20px; }
    .ms-switch-button { gap: 6px; padding: 0 14px; font: inherit; font-size: .78rem; font-weight: 750; }
    .ms-switch-button ion-icon { font-size: 17px; color: var(--ms-accent); }
    .ms-toolbar-title { min-width: 0; display: grid; gap: 1px; }
    .ms-toolbar-kicker { color: var(--ms-accent); font-size: .66rem; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; }
    .ms-toolbar-title strong { overflow: hidden; font-size: .94rem; text-overflow: ellipsis; white-space: nowrap; }
    .ms-toolbar-spacer { width: 44px; }
    .ms-kicker { color: var(--ms-accent); font-size: .7rem; font-weight: 800; letter-spacing: .12em; text-transform: uppercase; }
    .ms-section { display: grid; gap: 14px; margin-top: 36px; }
    .ms-section-head, .ms-picker-head { display: flex; align-items: flex-end; justify-content: space-between; gap: 12px; }
    .ms-section-head > div, .ms-picker-head > div { display: grid; gap: 4px; }
    .ms-section-head h2, .ms-picker-head h2 { margin: 0; color: var(--ms-ink); font-size: clamp(1.35rem, 5vw, 1.8rem); font-weight: 700; letter-spacing: -.035em; line-height: 1.1; }
    .ms-section-head > a { min-height: 44px; color: var(--ms-accent); display: inline-flex; align-items: center; font-size: .8rem; font-weight: 760; text-decoration: none; }
    .ms-picker-count { color: var(--ms-accent); font-size: .78rem; font-weight: 760; }

    /* Picker Drawer */
    .ms-picker { position: relative; z-index: 15; display: grid; gap: 14px; margin: 10px 0 18px; padding: 20px; border: 1px solid var(--ms-line); border-radius: 24px; background: rgba(255,255,255,.96); box-shadow: 0 20px 50px rgba(41,34,29,.14); }
    .ms-picker-note { margin: 0; color: var(--ms-muted); font-size: .78rem; line-height: 1.45; }
    .ms-text-action { width: fit-content; border: 0; color: var(--ms-accent); background: transparent; font-weight: 900; text-decoration: underline; cursor: pointer; }
    .ms-choice-list { display: grid; gap: 8px; width: 100%; }
    .ms-choice { width: 100%; min-height: 64px; display: grid; grid-template-columns: 46px minmax(0,1fr) auto; align-items: center; gap: 12px; padding: 10px; border: 1px solid var(--ms-line); border-radius: 18px; color: var(--ms-ink); background: rgba(255,255,255,.7); font: inherit; text-align: left; cursor: pointer; transition: all .2s ease; }
    .ms-choice.selected { border-color: var(--ms-accent); background: var(--ms-accent-soft); box-shadow: 0 4px 14px rgba(0,0,0,.04); }
    .ms-choice:disabled { cursor: wait; opacity: .55; }
    .ms-choice-avatar, .ms-salon-mark, .ms-staff-avatar { display: grid; place-items: center; color: white; background: var(--ms-accent); font-weight: 780; letter-spacing: -.03em; }
    .ms-choice-avatar { width: 46px; height: 46px; border-radius: 16px; font-size: .84rem; }
    .ms-choice-copy { min-width: 0; display: grid; gap: 3px; }
    .ms-choice-copy strong, .ms-choice-copy small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .ms-choice-copy strong { font-size: .9rem; }
    .ms-choice-copy small { color: var(--ms-muted); font-size: .72rem; }
    .ms-choice-badge { padding: 6px 12px; border-radius: 999px; color: var(--ms-muted); background: #eee; font-size: .72rem; font-weight: 760; }
    .ms-choice-badge.is-active { color: #fff; background: var(--ms-accent); }

    /* Salon Hero Card */
    .ms-hero { position: relative; overflow: hidden; display: grid; gap: 22px; margin-top: 16px; padding: 24px 20px 22px; border-radius: 26px; color: #fff; background: linear-gradient(145deg, #1b1b1a 0%, #292724 65%, color-mix(in srgb, var(--ms-accent) 45%, #191817)); box-shadow: 0 24px 60px rgba(31,27,24,.2); }
    .ms-hero::after { content: ""; position: absolute; width: 220px; height: 220px; right: -90px; top: -100px; border: 1px solid rgba(255,255,255,.16); border-radius: 50%; box-shadow: 0 0 0 30px rgba(255,255,255,.025); pointer-events: none; }
    .ms-hero-main { position: relative; z-index: 1; display: grid; grid-template-columns: 62px minmax(0,1fr); align-items: center; gap: 14px; }
    .ms-salon-mark { width: 62px; height: 62px; overflow: hidden; border: 1px solid rgba(255,255,255,.24); border-radius: 20px; box-shadow: inset 0 1px rgba(255,255,255,.25); }
    .ms-salon-mark-img { width: 100%; height: 100%; object-fit: cover; }
    .ms-hero-copy { min-width: 0; display: grid; gap: 4px; }
    .ms-hero .ms-kicker { color: rgba(255,255,255,.7); }
    .ms-hero h1 { margin: 0; overflow-wrap: anywhere; font-size: clamp(1.75rem, 7vw, 2.5rem); font-weight: 700; letter-spacing: -.04em; line-height: 1.02; }
    .ms-status-line { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; color: rgba(255,255,255,.76); font-size: .75rem; margin-top: 2px; }
    .ms-status { display: inline-flex; align-items: center; gap: 6px; font-weight: 700; }
    .ms-dot { width: 8px; height: 8px; border-radius: 50%; background: #f43f5e; box-shadow: 0 0 0 3px rgba(244,63,94,.2); }
    .ms-status.is-open .ms-dot { background: #10b981; box-shadow: 0 0 0 3px rgba(16,185,129,.25); }
    .ms-hours-chip { display: inline-flex; align-items: center; gap: 4px; color: rgba(255,255,255,.8); font-size: .74rem; }
    .ms-contact-list { position: relative; z-index: 1; display: grid; gap: 8px; }
    .ms-contact-item { min-width: 0; display: flex; align-items: flex-start; gap: 10px; color: rgba(255,255,255,.76); font-size: .8rem; line-height: 1.4; text-decoration: none; }
    .ms-contact-item.ms-link:hover { color: #fff; }
    .ms-contact-item ion-icon { flex: 0 0 16px; margin-top: 2px; color: rgba(255,255,255,.9); font-size: 17px; }
    .ms-star-icon { color: #f59e0b !important; }
    .ms-hero-actions { position: relative; z-index: 1; display: grid; grid-template-columns: 1fr; gap: 10px; }
    .ms-book-button, .ms-profile-button { min-height: 48px; border-radius: 999px; display: inline-flex; align-items: center; justify-content: center; gap: 8px; font-size: .86rem; font-weight: 780; text-decoration: none; }
    .ms-book-button { color: #171614; background: #fff; box-shadow: 0 10px 28px rgba(0,0,0,.2); }
    .ms-profile-button { border: 1px solid rgba(255,255,255,.24); color: #fff; background: rgba(255,255,255,.1); }

    /* Quick Shortcuts Bar */
    .ms-quick-actions { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; margin-top: 14px; padding: 10px 2px 12px; border-bottom: 1px solid var(--ms-line); overflow: visible; }
    .ms-quick-actions::-webkit-scrollbar { display: none; }
    .ms-quick-actions a { min-width: 0; min-height: 62px; display: grid; justify-items: center; align-content: center; gap: 5px; padding: 6px 4px; border-radius: 16px; color: var(--ms-ink); font-size: .68rem; font-weight: 750; text-align: center; text-decoration: none; white-space: normal; transition: background .15s ease; }
    .ms-quick-actions a:hover { background: rgba(0,0,0,.03); }
    .ms-quick-actions ion-icon { color: var(--ms-accent); font-size: 21px; }

    /* Relationship Snapshot Cards */
    .ms-relationship { margin-top: 32px; }
    .ms-relationship-label { padding: 6px 12px; border-radius: 999px; color: var(--ms-accent); background: var(--ms-accent-soft); font-size: .74rem; font-weight: 780; text-transform: capitalize; }
    .ms-snapshot { display: grid; grid-template-columns: repeat(2, minmax(0,1fr)); gap: 10px; margin-top: 4px; }
    .ms-snapshot-item { min-width: 0; min-height: 114px; display: grid; align-content: space-between; gap: 6px; padding: 16px; border: 1px solid var(--ms-line); border-radius: 20px; color: inherit; background: rgba(255,255,255,.75); text-decoration: none; transition: transform .2s ease, box-shadow .2s ease; }
    .ms-snapshot-item:hover { transform: translateY(-2px); box-shadow: 0 10px 25px rgba(0,0,0,.05); }
    .ms-snap-top { display: flex; align-items: center; justify-content: space-between; color: var(--ms-muted); font-size: .7rem; font-weight: 750; text-transform: uppercase; }
    .ms-snap-top ion-icon { color: var(--ms-accent); font-size: 17px; }
    .ms-snapshot-item strong { overflow: hidden; font-size: 1.25rem; letter-spacing: -.03em; text-overflow: ellipsis; white-space: nowrap; }
    .ms-snapshot-item small { color: var(--ms-muted); font-size: .7rem; line-height: 1.25; }
    .ms-currency { color: var(--ms-accent); }

    /* Appointments & Rebooking */
    .ms-appointment { display: grid; grid-template-columns: 60px minmax(0,1fr) 44px; align-items: center; gap: 14px; padding: 18px 14px 18px 18px; border: 1px solid color-mix(in srgb, var(--ms-accent) 24%, var(--ms-line)); border-radius: 22px; background: #fff; box-shadow: 0 14px 36px rgba(37,31,27,.07); }
    .ms-date-tile { width: 60px; height: 70px; display: grid; place-items: center; align-content: center; border-radius: 18px; color: #fff; background: var(--ms-accent); }
    .ms-date-tile span { font-size: .66rem; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; }
    .ms-date-tile strong { font-size: 1.6rem; line-height: 1; }
    .ms-appointment-copy { min-width: 0; display: grid; gap: 4px; }
    .ms-status-chip { width: max-content; color: var(--ms-accent); font-size: .66rem; font-weight: 800; text-transform: uppercase; }
    .ms-appointment h3, .ms-empty-panel h3 { margin: 0; font-size: 1.05rem; letter-spacing: -.02em; }
    .ms-appointment p, .ms-empty-panel p { margin: 0; color: var(--ms-muted); font-size: .75rem; line-height: 1.35; display: flex; align-items: center; gap: 5px; }
    .ms-price { font-size: .84rem; color: var(--ms-accent); }
    .ms-arrow-link { width: 44px; height: 44px; display: grid; place-items: center; border-radius: 50%; color: var(--ms-ink); background: #f4f1ec; text-decoration: none; }
    .ms-empty-panel { display: grid; grid-template-columns: 48px minmax(0,1fr); gap: 14px; padding: 20px; border: 1px dashed rgba(36,32,29,.2); border-radius: 22px; background: rgba(255,255,255,.5); }
    .ms-empty-icon { width: 48px; height: 48px; display: grid; place-items: center; border-radius: 16px; color: var(--ms-accent); background: var(--ms-accent-soft); font-size: 22px; }
    .ms-empty-panel > a { grid-column: 1 / -1; min-height: 46px; display: inline-flex; align-items: center; justify-content: center; border-radius: 999px; color: white; background: var(--ms-accent); font-size: .82rem; font-weight: 780; text-decoration: none; }
    
    .ms-rebook-card { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 14px 18px; border: 1px solid var(--ms-line); border-radius: 18px; background: rgba(255,255,255,.8); }
    .ms-rebook-info { display: grid; gap: 2px; }
    .ms-rebook-tag { color: var(--ms-accent); font-size: .64rem; font-weight: 800; text-transform: uppercase; }
    .ms-rebook-info strong { font-size: .86rem; }
    .ms-rebook-info small { color: var(--ms-muted); font-size: .7rem; }
    .ms-rebook-action { min-height: 38px; padding: 0 14px; border-radius: 999px; display: inline-flex; align-items: center; gap: 4px; color: var(--ms-accent); background: var(--ms-accent-soft); font-size: .76rem; font-weight: 780; text-decoration: none; }

    /* Happy Hours & Offers Rail */
    .ms-offer-rail, .ms-staff-rail { display: grid; grid-auto-flow: column; overflow-x: auto; overscroll-behavior-inline: contain; scrollbar-width: none; scroll-snap-type: x proximity; }
    .ms-offer-rail::-webkit-scrollbar, .ms-staff-rail::-webkit-scrollbar { display: none; }
    .ms-offer-rail { grid-auto-columns: minmax(260px, 82vw); gap: 12px; margin-inline: -16px; padding: 2px 16px 8px; }
    .ms-offer { min-height: 180px; scroll-snap-align: start; display: grid; align-content: space-between; gap: 8px; padding: 20px; border-radius: 24px; color: #fff; background: linear-gradient(145deg, var(--ms-accent), color-mix(in srgb, var(--ms-accent) 70%, #1c1a18)); box-shadow: 0 14px 30px color-mix(in srgb, var(--ms-accent) 20%, transparent); }
    .ms-offer:nth-child(even) { color: var(--ms-ink); background: var(--ms-accent-soft); box-shadow: none; }
    .ms-offer-value { width: max-content; padding: 5px 10px; border: 1px solid currentColor; border-radius: 999px; font-size: .66rem; font-weight: 850; }
    .ms-offer h3 { margin: 4px 0 0; font-size: 1.15rem; letter-spacing: -.03em; }
    .ms-offer p { display: -webkit-box; margin: 0; overflow: hidden; font-size: .78rem; line-height: 1.4; opacity: .88; -webkit-box-orient: vertical; -webkit-line-clamp: 2; }
    .ms-offer-footer { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-top: 8px; }
    .ms-offer-footer small { font-size: .68rem; opacity: .8; }
    .ms-offer-book { padding: 6px 12px; border-radius: 999px; color: var(--ms-ink); background: #fff; font-size: .72rem; font-weight: 780; text-decoration: none; }
    .ms-empty-line { min-height: 64px; display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 14px; border: 1px solid var(--ms-line); border-radius: 18px; background: rgba(255,255,255,.5); color: var(--ms-muted); font-size: .8rem; }
    .ms-empty-line a { color: var(--ms-accent); font-weight: 760; text-decoration: none; }

    /* Category Filter & Service Menu */
    .ms-cat-pills { display: flex; gap: 8px; overflow-x: auto; scrollbar-width: none; padding-bottom: 4px; }
    .ms-cat-pills::-webkit-scrollbar { display: none; }
    .ms-cat-pill { padding: 7px 14px; border: 1px solid var(--ms-line); border-radius: 999px; color: var(--ms-ink); background: rgba(255,255,255,.7); font: inherit; font-size: .75rem; font-weight: 740; cursor: pointer; white-space: nowrap; }
    .ms-cat-pill.active { border-color: var(--ms-accent); color: #fff; background: var(--ms-accent); }
    .ms-service-list { display: grid; gap: 8px; border-top: 1px solid var(--ms-line); }
    .ms-service { min-height: 68px; display: grid; grid-template-columns: 28px minmax(0,1fr) auto; align-items: center; gap: 12px; padding: 12px 4px; border-bottom: 1px solid var(--ms-line); color: inherit; }
    .ms-service-index { color: var(--ms-accent); font-size: .72rem; font-weight: 800; }
    .ms-service-copy { min-width: 0; display: grid; gap: 3px; }
    .ms-service-copy strong { overflow: hidden; font-size: .9rem; text-overflow: ellipsis; white-space: nowrap; }
    .ms-service-copy small { overflow: hidden; color: var(--ms-muted); font-size: .7rem; text-overflow: ellipsis; white-space: nowrap; }
    .ms-service-right { display: flex; align-items: center; gap: 10px; }
    .ms-service-price { font-size: .84rem; font-weight: 780; color: var(--ms-ink); }
    .ms-service-book-btn { padding: 6px 14px; border-radius: 999px; color: #fff; background: var(--ms-accent); font-size: .74rem; font-weight: 760; text-decoration: none; }

    /* Staff Rail */
    .ms-staff-rail { grid-auto-columns: 140px; gap: 10px; margin-inline: -16px; padding: 2px 16px 8px; }
    .ms-staff { min-height: 180px; scroll-snap-align: start; display: grid; justify-items: center; align-content: space-between; gap: 6px; padding: 16px 10px; border: 1px solid var(--ms-line); border-radius: 22px; color: inherit; background: rgba(255,255,255,.75); text-align: center; text-decoration: none; transition: transform .2s ease; }
    .ms-staff:hover { transform: translateY(-2px); }
    .ms-staff-avatar { width: 56px; height: 56px; border-radius: 20px; font-size: .9rem; }
    .ms-staff strong, .ms-staff small { max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .ms-staff strong { font-size: .84rem; }
    .ms-staff small { color: var(--ms-muted); font-size: .68rem; }
    .ms-staff-action { padding: 4px 10px; border-radius: 999px; color: var(--ms-accent); background: var(--ms-accent-soft); font-size: .68rem; font-weight: 780; }

    /* Benefits Grid */
    .ms-benefit-grid { display: grid; gap: 12px; }
    .ms-benefit { min-height: 148px; display: grid; align-content: start; gap: 6px; padding: 20px; border: 1px solid var(--ms-line); border-radius: 24px; background: rgba(255,255,255,.8); }
    .ms-benefit.ms-membership { color: #fff; border-color: transparent; background: linear-gradient(145deg, #282622, #171716); }
    .ms-benefit-chip { width: max-content; padding: 4px 10px; border-radius: 999px; color: var(--ms-accent); background: var(--ms-accent-soft); font-size: .64rem; font-weight: 800; text-transform: uppercase; }
    .ms-pkg-chip { color: #3b82f6; background: #eff6ff; }
    .ms-benefit h3 { margin: 4px 0 0; font-size: 1.05rem; }
    .ms-benefit > strong { font-size: .8rem; }
    .ms-benefit > small { color: var(--ms-muted); font-size: .7rem; }
    .ms-membership > small { color: rgba(255,255,255,.7); }
    .ms-progress { height: 6px; margin-top: 8px; overflow: hidden; border-radius: 999px; background: rgba(36,32,29,.1); }
    .ms-progress span { display: block; height: 100%; border-radius: inherit; background: var(--ms-accent); transition: width .4s ease; }

    /* Wallet & Gift Cards */
    .ms-wallet-container { display: grid; gap: 12px; }
    .ms-wallet-card { padding: 20px; border: 1px solid var(--ms-line); border-radius: 24px; background: #fff; box-shadow: 0 10px 30px rgba(0,0,0,.04); }
    .ms-wallet-top { display: flex; align-items: center; justify-content: space-between; }
    .ms-wallet-top span { color: var(--ms-muted); font-size: .76rem; font-weight: 750; text-transform: uppercase; }
    .ms-wallet-amount { font-size: 1.5rem; color: var(--ms-accent); font-weight: 800; }
    .ms-wallet-hint { margin: 10px 0 0; color: var(--ms-muted); font-size: .76rem; }
    .ms-tx-list { margin-top: 14px; padding-top: 12px; border-top: 1px solid var(--ms-line); display: grid; gap: 8px; }
    .ms-tx-head { color: var(--ms-muted); font-size: .68rem; font-weight: 780; text-transform: uppercase; }
    .ms-tx-item { display: flex; align-items: center; justify-content: space-between; font-size: .78rem; }
    .ms-tx-item strong.is-credit { color: var(--ms-emerald); }

    .ms-gift-cards-list { display: grid; gap: 8px; }
    .ms-gift-card { display: grid; grid-template-columns: 36px minmax(0,1fr) auto; align-items: center; gap: 12px; padding: 14px; border: 1px solid var(--ms-line); border-radius: 18px; background: rgba(255,255,255,.7); }
    .ms-gift-card ion-icon { color: var(--ms-accent); font-size: 22px; }
    .ms-gift-card strong { display: block; font-size: .84rem; }
    .ms-gift-card small { color: var(--ms-muted); font-size: .7rem; }
    .ms-gift-status { padding: 4px 8px; border-radius: 999px; background: var(--ms-accent-soft); color: var(--ms-accent); font-size: .66rem; font-weight: 800; text-transform: uppercase; }

    /* History & Invoices */
    .ms-history-list, .ms-invoice-list, .ms-notif-list { display: grid; gap: 6px; border-top: 1px solid var(--ms-line); }
    .ms-history-item, .ms-invoice-item { min-height: 66px; display: grid; grid-template-columns: 50px minmax(0,1fr) auto 18px; align-items: center; gap: 10px; padding: 10px 4px; border-bottom: 1px solid var(--ms-line); color: inherit; text-decoration: none; }
    .ms-history-date { color: var(--ms-muted); font-size: .7rem; font-weight: 740; }
    .ms-history-copy, .ms-invoice-copy { min-width: 0; display: grid; gap: 3px; }
    .ms-history-copy strong, .ms-invoice-copy strong { overflow: hidden; font-size: .84rem; text-overflow: ellipsis; white-space: nowrap; }
    .ms-history-copy small, .ms-invoice-copy small { color: var(--ms-muted); font-size: .68rem; }
    .ms-history-price { font-size: .82rem; }
    .ms-invoice-item ion-icon { color: var(--ms-accent); font-size: 20px; }
    .ms-invoice-right { display: grid; justify-items: end; gap: 2px; }
    .ms-inv-status { color: var(--ms-emerald); font-size: .64rem; font-weight: 800; text-transform: uppercase; }

    /* Notifications */
    .ms-notif-item { display: grid; grid-template-columns: 36px minmax(0,1fr); gap: 12px; padding: 12px 4px; border-bottom: 1px solid var(--ms-line); }
    .ms-notif-item ion-icon { color: var(--ms-accent); font-size: 20px; margin-top: 2px; }
    .ms-notif-item strong { display: block; font-size: .84rem; }
    .ms-notif-item p { margin: 2px 0 4px; color: var(--ms-muted); font-size: .76rem; line-height: 1.35; }
    .ms-notif-item small { color: var(--ms-muted); font-size: .66rem; }

    /* More & Support Grid */
    .ms-more { margin-bottom: 24px; }
    .ms-more-grid { display: grid; grid-template-columns: repeat(2, minmax(0,1fr)); gap: 10px; }
    .ms-more-grid a { min-height: 110px; display: grid; align-content: space-between; gap: 10px; padding: 16px; border: 1px solid var(--ms-line); border-radius: 20px; color: inherit; background: rgba(255,255,255,.6); text-decoration: none; transition: transform .2s ease; }
    .ms-more-grid a:hover { transform: translateY(-2px); }
    .ms-more-grid ion-icon { color: var(--ms-accent); font-size: 22px; }
    .ms-more-grid strong { display: block; font-size: .84rem; }
    .ms-more-grid small { color: var(--ms-muted); font-size: .68rem; line-height: 1.3; }

    /* States & Skeletons */
    .ms-state { min-height: 60vh; display: grid; place-items: center; align-content: center; gap: 12px; padding: 40px 16px; text-align: center; }
    .ms-state-icon { width: 64px; height: 64px; display: grid; place-items: center; margin-bottom: 4px; border-radius: 22px; color: var(--ms-accent); background: var(--ms-accent-soft); font-size: 26px; }
    .ms-state h1 { margin: 0; font-size: 1.75rem; letter-spacing: -.04em; }
    .ms-state p { max-width: 480px; margin: 0; color: var(--ms-muted); font-size: .86rem; line-height: 1.55; }
    .ms-state .ms-choice-list { max-width: 480px; margin-top: 14px; text-align: left; }
    .ms-primary-button { min-height: 48px; margin-top: 10px; --background: var(--ms-accent); --background-hover: var(--ms-accent); --border-radius: 999px; --box-shadow: none; }
    .ms-loading { display: grid; gap: 14px; padding-top: 16px; }
    .ms-skeleton { min-height: 96px; border-radius: 22px; background: linear-gradient(100deg, #ebe7df 20%, #f7f4ef 38%, #ebe7df 58%); background-size: 220% 100%; animation: ms-shimmer 1.4s ease-in-out infinite; }
    .ms-skeleton-hero { min-height: 280px; border-radius: 26px; }
    .ms-skeleton-grid { display: grid; grid-template-columns: repeat(2,1fr); gap: 10px; }
    .ms-skeleton-wide { min-height: 150px; }

    @media (min-width: 430px) {
      .ms-hero-actions { grid-template-columns: 1.15fr .85fr; }
    }
    @media (min-width: 700px) {
      .ms-page { padding-inline: 28px; }
      .ms-toolbar { margin-inline: -28px; padding-inline: 28px; }
      .ms-hero { grid-template-columns: minmax(0,1.2fr) minmax(260px,.8fr); align-items: center; padding: 32px; }
      .ms-hero-main { grid-column: 1; }
      .ms-contact-list { grid-column: 1; }
      .ms-hero-actions { grid-column: 2; grid-row: 1 / span 2; grid-template-columns: 1fr; align-self: stretch; align-content: end; }
      .ms-quick-actions { grid-template-columns: repeat(6, minmax(0,1fr)); }
      .ms-snapshot { grid-template-columns: repeat(4, minmax(0,1fr)); }
      .ms-offer-rail { grid-auto-columns: minmax(280px, 38%); margin-inline: 0; padding-inline: 0; }
      .ms-staff-rail { margin-inline: 0; padding-inline: 0; }
      .ms-benefit-grid { grid-template-columns: repeat(2, minmax(0,1fr)); }
      .ms-more-grid { grid-template-columns: repeat(4, minmax(0,1fr)); }
    }
    @media (min-width: 1024px) {
      .ms-page { padding-top: 0; padding-bottom: 70px; }
      .ms-service-list { display: grid; grid-template-columns: repeat(2,minmax(0,1fr)); column-gap: 32px; }
    }
    @keyframes ms-shimmer { from { background-position: 120% 0; } to { background-position: -120% 0; } }
  `]
})
export class MySalonPage implements OnInit {
  readonly dash = signal<MySalonDashboard | null>(null);
  readonly loading = signal(true);
  readonly loadError = signal("");
  readonly selectingSalon = signal(false);
  readonly salonPickerOpen = signal(false);
  readonly activeCategory = signal<string>("All");

  readonly salonChoices = computed(() => {
    const choices = new Map<string, CustomerSalonRelationship>();
    const add = (salon: CustomerSalonRelationship | null | undefined) => {
      if (!salon?.tenantId || !salon.branchId || !salon.businessId) return;
      choices.set(`${salon.tenantId}:${salon.branchId}`, salon);
    };
    add(this.marketplace.suggestedSalon());
    this.marketplace.mySalons().forEach(add);
    return [...choices.values()].sort((left, right) => {
      const visits = this.safeCount(right.visitCount) - this.safeCount(left.visitCount);
      if (visits !== 0) return visits;
      return this.dateValue(right.lastVisitAt) - this.dateValue(left.lastVisitAt);
    });
  });

  readonly upcomingBooking = computed(() => {
    const now = Date.now();
    return this.dash()?.recentBookings
      .filter((booking) => this.dateValue(booking.startAt) >= now && !this.isClosedBooking(booking.status))
      .sort((left, right) => this.dateValue(left.startAt) - this.dateValue(right.startAt))[0] ?? null;
  });

  readonly rebookCandidate = computed(() => this.dash()?.recentBookings
    .filter((booking) => this.dateValue(booking.startAt) < Date.now() || booking.status.toLowerCase() === "completed")
    .sort((left, right) => this.dateValue(right.startAt) - this.dateValue(left.startAt))[0] ?? null);

  readonly packageCredits = computed(() => this.dash()?.packages.reduce(
    (total, item) => total + this.remainingSessions(item.sessionsTotal, item.sessionsUsed), 0
  ) ?? 0);

  readonly categories = computed(() => {
    const set = new Set<string>();
    this.dash()?.services.forEach((s) => {
      if (s.category) set.add(s.category);
    });
    return ["All", ...Array.from(set)];
  });

  readonly filteredServices = computed(() => {
    const cat = this.activeCategory();
    const services = this.dash()?.services || [];
    if (cat === "All") return services;
    return services.filter((s) => s.category === cat);
  });

  readonly salonAccent = computed(() => this.salonPalette(this.dash()?.salon?.name).accent);
  readonly salonAccentSoft = computed(() => this.salonPalette(this.dash()?.salon?.name).soft);

  constructor(
    private readonly marketplace: MarketplaceService,
    private readonly auth: AuthService,
    private readonly router: Router,
    private readonly route: ActivatedRoute
  ) {
    addIcons({
      arrowBackOutline,
      calendarOutline,
      callOutline,
      cardOutline,
      cashOutline,
      chatbubbleEllipsesOutline,
      checkmarkCircleOutline,
      chevronForwardOutline,
      documentTextOutline,
      giftOutline,
      heartOutline,
      helpCircleOutline,
      informationCircleOutline,
      locationOutline,
      notificationsOutline,
      optionsOutline,
      peopleOutline,
      pricetagOutline,
      receiptOutline,
      refreshOutline,
      ribbonOutline,
      shieldCheckmarkOutline,
      sparklesOutline,
      starOutline,
      storefrontOutline,
      swapHorizontalOutline,
      timeOutline,
      walletOutline
    });
  }

  ngOnInit(): void {
    if (!this.auth.isAuthenticated()) {
      void this.router.navigate(["/login"]);
      return;
    }
    this.syncRouteSalonContext();
    this.marketplace.enterSalonMode(this.currentSalonContext());
    void this.loadDashboard();
  }

  async loadDashboard(): Promise<void> {
    this.loading.set(true);
    this.loadError.set("");
    let lastError = "";
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        await Promise.all([
          this.marketplace.loadMySalons().catch(() => undefined),
          this.marketplace.loadBookings().catch(() => undefined)
        ]);
        const dashboard = await this.marketplace.loadMySalonDashboard();
        this.dash.set(dashboard);
        if (!dashboard) this.loadError.set("This salon space is currently unavailable.");
        if (this.dash()?.salon) this.marketplace.enterSalonMode(this.currentSalonContext());
        this.loading.set(false);
        return;
      } catch {
        lastError = this.marketplace.error() || "Please check your network connection and try again.";
        if (this.isAuthFailure(lastError)) {
          this.marketplace.exitSalonMode();
          this.loading.set(false);
          this.loadError.set("Please sign in again to open My Salon.");
          void this.router.navigate(["/login"]);
          return;
        }
        if (attempt < 3) await this.sleep(450 * attempt);
      }
    }
    this.dash.set(null);
    this.loadError.set(lastError);
    this.loading.set(false);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private isAuthFailure(message: string): boolean {
    return /session expired|sign in|unauthorized|reconnect to your session/i.test(message);
  }

  exitSalonMode(): void {
    this.marketplace.exitSalonMode();
    void this.router.navigateByUrl("/tabs/home");
  }

  toggleSalonPicker(): void {
    this.salonPickerOpen.update((open) => !open);
  }

  setCategory(cat: string): void {
    this.activeCategory.set(cat);
  }

  async selectSalon(salon: CustomerSalonRelationship): Promise<void> {
    if (this.selectingSalon() || this.isSelectedSalon(salon)) {
      this.salonPickerOpen.set(false);
      return;
    }
    this.selectingSalon.set(true);
    this.loadError.set("");
    try {
      await this.marketplace.setPrimarySalon(salon.tenantId, salon.branchId, salon.businessId, salon.businessName);
      this.dash.set(null);
      this.salonPickerOpen.set(false);
      this.activeCategory.set("All");
      await this.loadDashboard();
      await this.router.navigateByUrl(this.scopedUrl());
    } catch {
      this.loadError.set(this.marketplace.error() || "Could not switch salon. Please try again.");
    } finally {
      this.selectingSalon.set(false);
    }
  }

  isSelectedSalon(salon: CustomerSalonRelationship): boolean {
    const primary = this.marketplace.primarySalon();
    return primary?.tenantId === salon.tenantId && primary.branchId === salon.branchId;
  }

  scopedLink(...segments: Array<string | number | null | undefined>): string {
    return this.scopedUrl(...segments.filter((segment): segment is string | number => segment !== null && segment !== undefined));
  }

  salonBookLink(salon: MySalonDashboard["salon"]): string {
    return salon?.slug ? this.scopedLink("business", salon.slug, "book") : this.scopedLink();
  }

  salonProfileLink(salon: MySalonDashboard["salon"]): string {
    return salon?.slug ? this.scopedLink("business", salon.slug) : this.scopedLink();
  }

  private scopedUrl(...segments: Array<string | number>): string {
    const context = this.currentSalonContext();
    const encoded = segments.map((segment) => encodeURIComponent(String(segment))).join("/");
    return `/my-salon/${encodeURIComponent(context.tenantId)}/${encodeURIComponent(context.branchId)}${encoded ? `/${encoded}` : ""}`;
  }

  private currentSalonContext(): { tenantId: string; branchId: string; businessId?: string; businessName?: string } {
    const salon = this.dash()?.salon;
    const primary = this.marketplace.primarySalon();
    const stored = this.marketplace.salonModeContext();
    const tenantId = salon?.tenantId || primary?.tenantId || this.route.snapshot.paramMap.get("tenantId") || stored?.tenantId || "default";
    const branchId = salon?.branchId || primary?.branchId || this.route.snapshot.paramMap.get("branchId") || stored?.branchId || "default";
    return {
      tenantId,
      branchId,
      businessId: primary?.businessId || stored?.businessId,
      businessName: salon?.name || primary?.businessName || stored?.businessName
    };
  }

  private syncRouteSalonContext(): void {
    const tenantId = this.route.snapshot.paramMap.get("tenantId");
    const branchId = this.route.snapshot.paramMap.get("branchId");
    if (!tenantId || !branchId) return;
    this.marketplace.syncSalonModeContext({ tenantId, branchId });
  }

  salonInitials(name: string): string {
    const words = String(name || "Salon").trim().split(/\s+/).filter(Boolean);
    return words.slice(0, 2).map((word) => word[0]).join("").toUpperCase() || "S";
  }

  staffInitials(name: string): string {
    return this.salonInitials(name);
  }

  formatMoney(paise: number): string {
    const amount = Number(paise);
    if (!Number.isFinite(amount)) return "Price unavailable";
    return (amount / 100).toLocaleString("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 });
  }

  formatNumber(value: number): string {
    const number = Number(value);
    return Number.isFinite(number) ? number.toLocaleString("en-IN") : "0";
  }

  formatDate(iso: string): string {
    const date = this.validDate(iso);
    return date ? date.toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "Asia/Kolkata" }) : "Date unavailable";
  }

  formatTime(iso: string): string {
    const date = this.validDate(iso);
    return date ? date.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" }) : "Time unavailable";
  }

  datePart(iso: string, part: "day" | "month"): string {
    const date = this.validDate(iso);
    if (!date) return "—";
    return date.toLocaleDateString("en-IN", part === "day"
      ? { day: "numeric", timeZone: "Asia/Kolkata" }
      : { month: "short", timeZone: "Asia/Kolkata" });
  }

  safeRating(average: number, count: number): string | null {
    const rating = Number(average);
    return Number.isFinite(rating) && this.safeCount(count) > 0 ? rating.toFixed(1) : null;
  }

  validPrice(value: number): boolean {
    return Number.isFinite(Number(value)) && Number(value) >= 0;
  }

  safeDuration(minutes: number): string {
    const value = this.safeCount(minutes);
    return value > 0 ? `${value} min` : "Duration on request";
  }

  safeCount(value: number): number {
    const count = Number(value);
    return Number.isFinite(count) && count > 0 ? Math.floor(count) : 0;
  }

  remainingSessions(total: number, used: number): number {
    return Math.max(0, this.safeCount(total) - this.safeCount(used));
  }

  packageProgress(total: number, used: number): number {
    const safeTotal = this.safeCount(total);
    return safeTotal ? Math.min(100, (this.safeCount(used) / safeTotal) * 100) : 0;
  }

  serviceIndex(index: number): string {
    return String(index + 1).padStart(2, "0");
  }

  statusLabel(status: string): string {
    const value = String(status || "Available").replace(/[_-]+/g, " ").trim();
    return value ? value.charAt(0).toUpperCase() + value.slice(1) : "Available";
  }

  relationshipLabel(type: string): string {
    const labels: Record<string, string> = { guest: "New guest", returning: "Returning", regular: "Regular Client", loyal: "Loyal Client", booked: "Booked" };
    return labels[type] || this.statusLabel(type || "Your salon");
  }

  salonVisitLabel(salon: CustomerSalonRelationship): string {
    const visits = this.safeCount(salon.visitCount);
    if (!visits) return "Connected salon";
    return `${visits} visit${visits === 1 ? "" : "s"}`;
  }

  walletTxCount(wallet: MySalonDashboard["wallet"]): string {
    if (!wallet?.transactions?.length) return "Salon prepaid balance";
    const count = wallet.transactions.length;
    return `${count} transaction${count === 1 ? "" : "s"}`;
  }

  offerDiscount(type: string, value: number): string {
    const amount = Number(value);
    if (!Number.isFinite(amount) || amount <= 0) return "Salon Offer";
    if (type === "percentage") return `${amount.toLocaleString("en-IN", { maximumFractionDigits: 1 })}% OFF`;
    return `${this.formatMoney(amount * 100)} OFF`;
  }

  private isClosedBooking(status: string): boolean {
    return ["cancelled", "canceled", "completed", "no_show"].includes(String(status || "").toLowerCase());
  }

  private dateValue(iso: string): number {
    return this.validDate(iso)?.getTime() ?? 0;
  }

  private validDate(iso: string): Date | null {
    if (!iso) return null;
    const date = new Date(iso);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  private salonPalette(name = ""): { accent: string; soft: string } {
    const palettes = [
      { accent: "#8a4f5e", soft: "#f5e9ec" },
      { accent: "#6f5a46", soft: "#f1ebe3" },
      { accent: "#4d6a62", soft: "#e6efec" },
      { accent: "#66567d", soft: "#eee9f4" },
      { accent: "#8a5a3b", soft: "#f5ebe3" }
    ];
    const hash = [...String(name)].reduce((total, character) => total + character.charCodeAt(0), 0);
    return palettes[hash % palettes.length];
  }
}
