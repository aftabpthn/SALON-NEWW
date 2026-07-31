import { Component, OnInit, computed, signal } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { ActivatedRoute, RouterLink } from "@angular/router";
import { AlertController, IonBackButton, IonButton, IonContent, IonIcon } from "@ionic/angular/standalone";
import { addIcons } from "ionicons";
import { firstValueFrom } from "rxjs";
import {
  arrowUndoOutline,
  briefcaseOutline,
  calendarOutline,
  cardOutline,
  cashOutline,
  chatbubblesOutline,
  chevronForwardOutline,
  colorPaletteOutline,
  giftOutline,
  heartCircleOutline,
  imagesOutline,
  informationCircleOutline,
  linkOutline,
  peopleOutline,
  phonePortraitOutline,
  receiptOutline,
  ribbonOutline,
  searchOutline,
  shareSocialOutline,
  shieldCheckmarkOutline,
  ticketOutline,
  trendingDownOutline,
  trendingUpOutline,
  walletOutline
} from "ionicons/icons";
import {
  CustomerAccountModule,
  Booking,
  CustomerBookingSupportCategory,
  CustomerBookingSupportPreferredContact,
  CustomerBookingSupportPriority,
  CustomerBookingSupportTicket,
  CustomerInvoice,
  CustomerGiftCard,
  CustomerMembership,
  CustomerMembershipPlan,
  CustomerPackage,
  CustomerPayment,
  CustomerRewardSummary,
  CustomerWallet,
  CustomerWalletTransaction
} from "../../core/api.types";
import { CustomerApiService } from "../../core/customer-api.service";
import { MarketplaceService } from "../../core/marketplace.service";

interface HubConfig {
  eyebrow: string;
  title: string;
  subtitle?: string;
  icon: string;
  route: string;
}

interface HubRecord {
  key: string;
  status: string;
  title: string;
  amountPaise?: number;
  date?: string;
  description?: string;
  route?: string;
  demo?: boolean;
}

const hubConfigs: Record<string, HubConfig> = {
  rewards: {
    eyebrow: "Aura rewards",
    title: "Rewards from your real bookings",
    icon: "ribbon-outline",
    route: "/tabs/rewards"
  },
  wallet: {
    eyebrow: "Aura wallet",
    title: "Wallet records",
    icon: "wallet-outline",
    route: "/tabs/wallet"
  },
  memberships: {
    eyebrow: "Memberships",
    title: "Membership records",
    icon: "heart-circle-outline",
    route: "/tabs/memberships"
  },
  packages: {
    eyebrow: "Packages",
    title: "Package records",
    icon: "ticket-outline",
    route: "/tabs/packages"
  },
  "gift-cards": {
    eyebrow: "Gift cards",
    title: "Gift card records",
    icon: "gift-outline",
    route: "/tabs/gift-cards"
  },
  support: {
    eyebrow: "Support",
    title: "Support records",
    icon: "chatbubbles-outline",
    route: "/tabs/support"
  },
  referrals: {
    eyebrow: "Referrals",
    title: "Referral records",
    icon: "share-social-outline",
    route: "/tabs/referrals"
  },
  gallery: {
    eyebrow: "Gallery",
    title: "Saved inspiration",
    icon: "images-outline",
    route: "/tabs/gallery"
  },
  family: {
    eyebrow: "Family booking",
    title: "Family profiles",
    icon: "people-outline",
    route: "/tabs/family"
  },
  corporate: {
    eyebrow: "Corporate benefits",
    title: "Corporate records",
    icon: "briefcase-outline",
    route: "/tabs/corporate"
  },
  goals: {
    eyebrow: "Beauty goals",
    title: "Beauty goal records",
    icon: "color-palette-outline",
    route: "/tabs/goals"
  },
  payments: {
    eyebrow: "Payments",
    title: "Payment records",
    icon: "wallet-outline",
    route: "/tabs/payments"
  },
  invoices: {
    eyebrow: "Invoices",
    title: "Invoice records",
    icon: "ticket-outline",
    route: "/tabs/invoices"
  },
  notifications: {
    eyebrow: "Notifications",
    title: "Notification records",
    icon: "chatbubbles-outline",
    route: "/notifications"
  }
};

@Component({
  standalone: true,
  imports: [FormsModule, RouterLink, IonBackButton, IonButton, IonContent, IonIcon],
  template: `
    <ion-content>
      <main class="page hub-page" [class.wallet-hub-page]="walletMode() || rewardsMode() || membershipsMode() || packagesMode() || paymentsMode() || familyMode() || referralsMode() || giftCardsMode() || corporateMode() || goalsMode() || slug() === 'support'">
        @if (bookingSupportMode()) {
          <section class="booking-support" aria-labelledby="booking-support-title">
            <header class="support-heading">
              <div class="hero-icon"><ion-icon name="chatbubbles-outline" aria-hidden="true"></ion-icon></div>
              <div>
                <p class="support-eyebrow">Booking support</p>
                <div class="wallet-title-row">
                  <ion-back-button class="content-back-button" [defaultHref]="hubBackHref()" text=""></ion-back-button>
                  <h1 id="booking-support-title">How can we help?</h1>
                </div>
                <span>Send a request linked securely to your booking.</span>
              </div>
            </header>

            <div class="support-status">
              @if (supportLoading()) {
                <section class="support-panel" role="status"><h2>Loading booking</h2><p>Confirming your booking details securely.</p></section>
              } @else if (supportLoadError()) {
                <section class="support-panel support-error" role="alert">
                  <h2>Booking support is unavailable</h2>
                  <p>{{ supportLoadError() }}</p>
                  <div class="support-inline-actions">
                    <ion-button class="primary-gradient" (click)="loadBookingSupportContext()">Retry</ion-button>
                    <ion-button fill="outline" class="secondary-button" routerLink="/help">General help</ion-button>
                  </div>
                </section>
              } @else if (supportTicket(); as ticket) {
                <section class="support-panel support-success" role="status">
                  <span class="status-pill">{{ ticket.status }}</span>
                  <h2>Support request sent</h2>
                  <dl>
                    <div><dt>Ticket ID</dt><dd>{{ ticket.id }}</dd></div>
                    <div><dt>Status</dt><dd>{{ ticket.status }}</dd></div>
                  </dl>
                  <ion-button class="primary-gradient" [routerLink]="['/bookings', ticket.bookingId]">Back to booking</ion-button>
                </section>
              } @else if (supportBooking(); as booking) {
                <section class="support-booking-card" aria-label="Verified booking details">
                  <div>
                    <span class="status-pill" [class.closed]="booking.status === 'cancelled'">{{ booking.status }}</span>
                    <h2>{{ booking.serviceName }}</h2>
                    <p>{{ booking.businessName }}</p>
                  </div>
                  <dl>
                    <div><dt>Appointment</dt><dd>{{ supportAppointmentDisplay() }}</dd></div>
                    <div><dt>Reference</dt><dd>{{ booking.reference || booking.id }}</dd></div>
                  </dl>
                </section>

                <form class="support-form" (submit)="submitBookingSupport($event)" novalidate>
                  <div class="field-group">
                    <label for="support-category">What do you need help with?</label>
                    <select id="support-category" name="supportCategory" [(ngModel)]="supportCategory" required>
                      @for (category of supportCategories; track category.value) {
                        <option [value]="category.value">{{ category.label }}</option>
                      }
                    </select>
                  </div>

                  <div class="field-group">
                    <div class="field-label-row">
                      <label for="support-message">Message</label>
                      <span>{{ supportMessage.length }}/1200</span>
                    </div>
                    <textarea
                      id="support-message"
                      name="supportMessage"
                      [(ngModel)]="supportMessage"
                      maxlength="1200"
                      rows="6"
                      required
                      placeholder="Tell us what happened and how we can help."
                    ></textarea>
                  </div>

                  <div class="support-field-grid">
                    <div class="field-group">
                      <label for="preferred-contact">Preferred contact</label>
                      <select id="preferred-contact" name="preferredContact" [(ngModel)]="preferredContact">
                        <option value="in_app">In-app</option>
                        <option value="phone">Phone</option>
                        <option value="email">Email</option>
                      </select>
                    </div>
                    <div class="field-group">
                      <label for="support-priority">Priority</label>
                      <select id="support-priority" name="supportPriority" [(ngModel)]="supportPriority">
                        <option value="low">Low</option>
                        <option value="medium">Medium</option>
                        <option value="high">High</option>
                      </select>
                    </div>
                  </div>

                  @if (supportSubmitError()) {
                    <p class="form-error" role="alert">{{ supportSubmitError() }}</p>
                  }
                  <span class="support-live" aria-live="polite">{{ supportSubmitting() ? "Sending support request" : "" }}</span>
                  <ion-button type="submit" expand="block" class="primary-gradient" [disabled]="!supportFormValid() || supportSubmitting()">
                    {{ supportSubmitting() ? "Sending request" : "Send support request" }}
                  </ion-button>
                </form>
              }
            </div>
          </section>
        } @else if (walletMode()) {
          <section class="wallet-screen" aria-labelledby="wallet-title">
            <header class="wallet-heading">
              <div>
                <p class="wallet-eyebrow">Aura wallet</p>
                <div class="wallet-title-row">
                  <ion-back-button class="content-back-button" [defaultHref]="hubBackHref()" text=""></ion-back-button>
                  <h1 id="wallet-title">Wallet</h1>
                </div>
                <p class="wallet-intro">Your credits, refunds and wallet activity in one place.</p>
              </div>
              <a class="wallet-header-link" routerLink="/tabs/invoices" aria-label="View invoices">
                <ion-icon class="wallet-header-receipt" name="receipt-outline" aria-hidden="true"></ion-icon>
                <span>View invoices</span>
                <ion-icon class="wallet-header-chevron" name="chevron-forward-outline" aria-hidden="true"></ion-icon>
              </a>
            </header>

            @if (!marketplace.isAuthenticated()) {
              <section class="wallet-state" aria-labelledby="wallet-login-title">
                <div class="wallet-state-icon"><ion-icon name="wallet-outline" aria-hidden="true"></ion-icon></div>
                <h2 id="wallet-login-title">Log in to see your wallet</h2>
                <p>Your wallet balance and transaction history are private to your Aura account.</p>
                <ion-button class="primary-gradient" [routerLink]="['/login']" [queryParams]="{ returnUrl: '/tabs/wallet' }">Log in</ion-button>
              </section>
            } @else if (marketplace.loading()) {
              <section class="wallet-loading" role="status" aria-live="polite">
                <span class="sr-only">Loading your wallet</span>
                <div class="wallet-balance-skeleton skeleton-block"></div>
                <div class="wallet-content-grid">
                  <div class="wallet-list-skeleton">
                    <div class="skeleton-line skeleton-title"></div>
                    @for (item of [1, 2, 3]; track item) {
                      <div class="skeleton-transaction">
                        <span class="skeleton-circle"></span>
                        <span class="skeleton-line"></span>
                        <span class="skeleton-line skeleton-amount"></span>
                      </div>
                    }
                  </div>
                  <div class="wallet-guide-skeleton skeleton-block"></div>
                </div>
              </section>
            } @else if (marketplace.error()) {
              <section class="wallet-state wallet-error" role="alert" aria-labelledby="wallet-error-title">
                <div class="wallet-state-icon"><ion-icon name="information-circle-outline" aria-hidden="true"></ion-icon></div>
                <h2 id="wallet-error-title">We couldn’t load your wallet</h2>
                <p>{{ marketplace.error() }}</p>
                <ion-button class="primary-gradient" (click)="reload()">Try again</ion-button>
              </section>
            } @else if (wallet(); as walletData) {
              <section class="wallet-balance-card" aria-labelledby="available-balance-label">
                <div class="wallet-balance-copy">
                  <div class="wallet-status-row">
                    <span class="wallet-status"><span aria-hidden="true"></span>{{ walletData.balancePaise > 0 ? "Available" : "No credits available" }}</span>
                    <span class="wallet-secure"><ion-icon name="shield-checkmark-outline" aria-hidden="true"></ion-icon>Account protected</span>
                  </div>
                  <p id="available-balance-label">Available balance</p>
                  <strong>{{ money(walletData.balancePaise) }}</strong>
                  <small>Applied only where wallet payment is eligible.</small>
                </div>
                <div class="wallet-actions" aria-label="Wallet actions">
                  <a class="wallet-action wallet-action-primary" routerLink="/tabs/search">
                    <ion-icon name="search-outline" aria-hidden="true"></ion-icon>
                    Explore services
                  </a>
                  <a class="wallet-action wallet-action-secondary" routerLink="/tabs/invoices">
                    <ion-icon name="receipt-outline" aria-hidden="true"></ion-icon>
                    Check invoices
                  </a>
                </div>
              </section>

              <div class="wallet-content-grid">
                <section class="wallet-activity" aria-labelledby="wallet-activity-title">
                  <div class="wallet-section-heading">
                    <div>
                      <p class="wallet-section-kicker">Activity</p>
                      <h2 id="wallet-activity-title">Transaction history</h2>
                    </div>
                    @if (walletData.transactions.length) {
                      <span>{{ walletData.transactions.length }} {{ walletData.transactions.length === 1 ? "record" : "records" }}</span>
                    }
                  </div>

                  @if (walletData.transactions.length) {
                    <div class="wallet-transactions">
                      @for (transaction of walletData.transactions; track transaction.id) {
                        <article class="wallet-transaction">
                          <div class="transaction-icon" [class.transaction-debit]="!walletTransactionIsCredit(transaction)">
                            <ion-icon [name]="walletTransactionIsCredit(transaction) ? 'trending-down-outline' : 'trending-up-outline'" aria-hidden="true"></ion-icon>
                          </div>
                          <div class="transaction-copy">
                            <strong>{{ walletTransactionLabel(transaction.type) }}</strong>
                            <span>{{ walletTransactionDescription(transaction) }}</span>
                            <small>{{ walletTransactionDate(transaction.createdAt) }}</small>
                          </div>
                          <div class="transaction-value" [class.transaction-value-debit]="!walletTransactionIsCredit(transaction)">
                            <strong>{{ money(walletTransactionAmount(transaction.amountPaise)) }}</strong>
                            <small>Balance {{ money(transaction.balanceAfterPaise) }}</small>
                          </div>
                        </article>
                      }
                    </div>
                  } @else {
                    <div class="wallet-empty">
                      <div class="wallet-state-icon"><ion-icon name="receipt-outline" aria-hidden="true"></ion-icon></div>
                      <h3>No wallet activity yet</h3>
                      <p>Credits, eligible refunds and wallet payments will appear here automatically.</p>
                      <a routerLink="/tabs/search">Explore salons <ion-icon name="chevron-forward-outline" aria-hidden="true"></ion-icon></a>
                    </div>
                  }
                </section>

                <aside class="wallet-guide" aria-labelledby="wallet-guide-title">
                  <p class="wallet-section-kicker">How it works</p>
                  <h2 id="wallet-guide-title">Know your wallet</h2>
                  <div class="wallet-guide-list">
                    <div>
                      <span class="guide-number">01</span>
                      <p><strong>Credits</strong><small>Eligible credits are added to your available balance.</small></p>
                    </div>
                    <div>
                      <span class="guide-number">02</span>
                      <p><strong>Refunds</strong><small>Wallet refunds appear in history after they are processed.</small></p>
                    </div>
                    <div>
                      <span class="guide-number">03</span>
                      <p><strong>Payments</strong><small>Wallet use depends on the salon, service and invoice.</small></p>
                    </div>
                  </div>
                  <a class="wallet-help-link" routerLink="/help" [queryParams]="{ topic: 'payment' }">
                    Payment and wallet help
                    <ion-icon name="chevron-forward-outline" aria-hidden="true"></ion-icon>
                  </a>
                </aside>
              </div>
            } @else {
              <section class="wallet-state" aria-labelledby="wallet-unavailable-title">
                <div class="wallet-state-icon"><ion-icon name="wallet-outline" aria-hidden="true"></ion-icon></div>
                <h2 id="wallet-unavailable-title">Wallet details are unavailable</h2>
                <p>We didn’t receive wallet details for this account. Try refreshing the page.</p>
                <ion-button class="primary-gradient" (click)="reload()">Refresh wallet</ion-button>
              </section>
            }
          </section>
        } @else if (invoicesMode()) {
          <section class="wallet-screen" aria-labelledby="invoices-title">
            <header class="wallet-heading">
              <div>
                <p class="wallet-eyebrow">Aura invoices</p>
                <div class="wallet-title-row">
                  <ion-back-button class="content-back-button" [defaultHref]="hubBackHref()" text=""></ion-back-button>
                  <h1 id="invoices-title">Invoices</h1>
                </div>
                <p class="wallet-intro">Track due payments, past invoices and your payment history.</p>
              </div>
              <a class="wallet-header-link" routerLink="/tabs/wallet" aria-label="View wallet">
                <ion-icon class="wallet-header-receipt" name="wallet-outline" aria-hidden="true"></ion-icon>
                <span>View wallet</span>
                <ion-icon class="wallet-header-chevron" name="chevron-forward-outline" aria-hidden="true"></ion-icon>
              </a>
            </header>

            @if (!marketplace.isAuthenticated()) {
              <section class="wallet-state" aria-labelledby="invoices-login-title">
                <div class="wallet-state-icon"><ion-icon name="receipt-outline" aria-hidden="true"></ion-icon></div>
                <h2 id="invoices-login-title">Log in to see your invoices</h2>
                <p>Your invoices and payment records are private to your Aura account.</p>
                <ion-button class="primary-gradient" [routerLink]="['/login']" [queryParams]="{ returnUrl: '/tabs/invoices' }">Log in</ion-button>
              </section>
            } @else if (marketplace.loading()) {
              <section class="wallet-loading" role="status" aria-live="polite">
                <span class="sr-only">Loading invoices</span>
                <div class="wallet-balance-skeleton skeleton-block"></div>
                <div class="wallet-content-grid">
                  <div class="wallet-list-skeleton">
                    <div class="skeleton-line skeleton-title"></div>
                    @for (item of [1, 2, 3]; track item) {
                      <div class="skeleton-transaction">
                        <span class="skeleton-circle"></span>
                        <span class="skeleton-line"></span>
                        <span class="skeleton-line skeleton-amount"></span>
                      </div>
                    }
                  </div>
                  <div class="wallet-guide-skeleton skeleton-block"></div>
                </div>
              </section>
            } @else if (marketplace.error()) {
              <section class="wallet-state wallet-error" role="alert" aria-labelledby="invoices-error-title">
                <div class="wallet-state-icon"><ion-icon name="information-circle-outline" aria-hidden="true"></ion-icon></div>
                <h2 id="invoices-error-title">We couldn’t load your invoices</h2>
                <p>{{ marketplace.error() }}</p>
                <ion-button class="primary-gradient" (click)="reload()">Try again</ion-button>
              </section>
            } @else if (invoices(); as invoiceList) {
              <section class="wallet-balance-card" aria-labelledby="invoices-summary-label">
                <div class="wallet-balance-copy">
                  <div class="wallet-status-row">
                    <span class="wallet-status"><span aria-hidden="true"></span>{{ invoiceList.length }} {{ invoiceList.length === 1 ? "invoice" : "invoices" }} on record</span>
                    <span class="wallet-secure"><ion-icon name="shield-checkmark-outline" aria-hidden="true"></ion-icon>Account protected</span>
                  </div>
                  <p id="invoices-summary-label">Total outstanding</p>
                  <strong>{{ money(invoiceTotalOutstanding()) }}</strong>
                  <small>{{ invoiceDueCount() }} {{ invoiceDueCount() === 1 ? "invoice" : "invoices" }} with balance due</small>
                </div>
                <div class="wallet-actions" aria-label="Invoice actions">
                  <a class="wallet-action wallet-action-primary" routerLink="/tabs/wallet">
                    <ion-icon name="wallet-outline" aria-hidden="true"></ion-icon>
                    View wallet
                  </a>
                  <a class="wallet-action wallet-action-secondary" routerLink="/tabs/search">
                    <ion-icon name="search-outline" aria-hidden="true"></ion-icon>
                    Explore services
                  </a>
                </div>
              </section>

              <div class="wallet-content-grid">
                <section class="wallet-activity" aria-labelledby="invoices-list-title">
                  <div class="wallet-section-heading">
                    <div>
                      <p class="wallet-section-kicker">History</p>
                      <h2 id="invoices-list-title">Invoices</h2>
                    </div>
                    @if (invoiceList.length) {
                      <span>{{ invoiceDueCount() }} pending</span>
                    }
                  </div>

                  @if (invoiceList.length) {
                    <div class="wallet-transactions">
                      @for (invoice of invoiceList; track invoice.id) {
                        <article class="wallet-transaction" [class.invoice-due]="invoice.balancePaise > 0">
                          <div class="transaction-icon" [class.transaction-debit]="invoice.status === 'paid'">
                            <ion-icon name="receipt-outline" aria-hidden="true"></ion-icon>
                          </div>
                          <div class="transaction-copy">
                            <strong>{{ invoice.invoiceNumber || invoice.id }}</strong>
                            <span>{{ invoice.status }}</span>
                            <small>{{ invoiceDateLabel(invoice.createdAt) }}</small>
                          </div>
                          <div class="invoice-amount-group">
                            <div class="transaction-value">
                              <strong [class.text-danger]="invoice.balancePaise > 0">{{ money(invoice.totalPaise) }}</strong>
                              @if (invoice.balancePaise > 0) {
                                <small class="invoice-due-label">{{ money(invoice.balancePaise) }} due</small>
                              } @else {
                                <small>Paid</small>
                              }
                            </div>
                            @if (invoice.balancePaise > 0) {
                              <button type="button" class="invoice-pay-button" (click)="createPaymentLink(invoice.id)" [disabled]="actionLoading()">
                                <ion-icon name="card-outline" aria-hidden="true"></ion-icon>
                                Pay
                              </button>
                            }
                          </div>
                        </article>
                      }
                    </div>
                  } @else {
                    <div class="wallet-empty">
                      <div class="wallet-state-icon"><ion-icon name="receipt-outline" aria-hidden="true"></ion-icon></div>
                      <h3>No invoices yet</h3>
                      <p>Your booking invoices will appear here automatically after each completed visit.</p>
                      <a routerLink="/tabs/search">Book a service <ion-icon name="chevron-forward-outline" aria-hidden="true"></ion-icon></a>
                    </div>
                  }
                </section>

                <aside class="wallet-guide" aria-labelledby="invoices-guide-title">
                  <p class="wallet-section-kicker">Payment guide</p>
                  <h2 id="invoices-guide-title">Know your invoices</h2>
                  <div class="wallet-guide-list">
                    <div>
                      <span class="guide-number">01</span>
                      <p><strong>Invoice generation</strong><small>Invoices are created after a completed booking with a billable service.</small></p>
                    </div>
                    <div>
                      <span class="guide-number">02</span>
                      <p><strong>Payment options</strong><small>Use wallet, UPI, or invoice payment link to settle balances.</small></p>
                    </div>
                    <div>
                      <span class="guide-number">03</span>
                      <p><strong>Due invoices</strong><small>Payments can be split across multiple visits and invoices.</small></p>
                    </div>
                  </div>
                  <a class="wallet-help-link" routerLink="/help" [queryParams]="{ topic: 'payment' }">
                    Invoice and payment help
                    <ion-icon name="chevron-forward-outline" aria-hidden="true"></ion-icon>
                  </a>
                </aside>
              </div>
            } @else {
              <section class="wallet-state" aria-labelledby="invoices-unavailable-title">
                <div class="wallet-state-icon"><ion-icon name="receipt-outline" aria-hidden="true"></ion-icon></div>
                <h2 id="invoices-unavailable-title">Invoice details are unavailable</h2>
                <p>We didn’t receive invoice data for this account. Try refreshing the page.</p>
                <ion-button class="primary-gradient" (click)="reload()">Refresh invoices</ion-button>
              </section>
            }
          </section>
        } @else if (paymentsMode()) {
          <section class="wallet-screen" aria-labelledby="payments-title">
            <header class="wallet-heading">
              <div>
                <p class="wallet-eyebrow">Aura payments</p>
                <div class="wallet-title-row">
                  <ion-back-button class="content-back-button" [defaultHref]="hubBackHref()" text=""></ion-back-button>
                  <h1 id="payments-title">Payments</h1>
                </div>
                <p class="wallet-intro">Every payment across your bookings and invoices, in one secure place.</p>
              </div>
              <a class="wallet-header-link" routerLink="/tabs/invoices" aria-label="View invoices">
                <ion-icon class="wallet-header-receipt" name="receipt-outline" aria-hidden="true"></ion-icon>
                <span>View invoices</span>
                <ion-icon class="wallet-header-chevron" name="chevron-forward-outline" aria-hidden="true"></ion-icon>
              </a>
            </header>

            @if (!marketplace.isAuthenticated()) {
              <section class="wallet-state" aria-labelledby="payments-login-title">
                <div class="wallet-state-icon"><ion-icon name="card-outline" aria-hidden="true"></ion-icon></div>
                <h2 id="payments-login-title">Log in to see your payments</h2>
                <p>Your payment history is private to your Aura account.</p>
                <ion-button class="primary-gradient" [routerLink]="['/login']" [queryParams]="{ returnUrl: '/tabs/payments' }">Log in</ion-button>
              </section>
            } @else if (marketplace.loading()) {
              <section class="wallet-loading" role="status" aria-live="polite">
                <span class="sr-only">Loading your payments</span>
                <div class="wallet-balance-skeleton skeleton-block"></div>
                <div class="wallet-content-grid">
                  <div class="wallet-list-skeleton">
                    <div class="skeleton-line skeleton-title"></div>
                    @for (item of [1, 2, 3]; track item) {
                      <div class="skeleton-transaction">
                        <span class="skeleton-circle"></span>
                        <span class="skeleton-line"></span>
                        <span class="skeleton-line skeleton-amount"></span>
                      </div>
                    }
                  </div>
                  <div class="wallet-guide-skeleton skeleton-block"></div>
                </div>
              </section>
            } @else if (marketplace.error()) {
              <section class="wallet-state wallet-error" role="alert" aria-labelledby="payments-error-title">
                <div class="wallet-state-icon"><ion-icon name="information-circle-outline" aria-hidden="true"></ion-icon></div>
                <h2 id="payments-error-title">We couldn’t load your payments</h2>
                <p>{{ marketplace.error() }}</p>
                <ion-button class="primary-gradient" (click)="reload()">Try again</ion-button>
              </section>
            } @else if (paymentsList(); as paymentList) {
              <section class="wallet-balance-card" aria-labelledby="payments-summary-label">
                <div class="wallet-balance-copy">
                  <div class="wallet-status-row">
                    <span class="wallet-status"><span aria-hidden="true"></span>{{ paymentList.length }} {{ paymentList.length === 1 ? "payment" : "payments" }} on record</span>
                    <span class="wallet-secure"><ion-icon name="shield-checkmark-outline" aria-hidden="true"></ion-icon>Account protected</span>
                  </div>
                  <p id="payments-summary-label">Total paid</p>
                  <strong>{{ money(paymentTotalPaid()) }}</strong>
                  <small>{{ paymentLatestLabel() }}</small>
                </div>
                <div class="wallet-actions" aria-label="Payment actions">
                  <a class="wallet-action wallet-action-primary" routerLink="/tabs/invoices">
                    <ion-icon name="receipt-outline" aria-hidden="true"></ion-icon>
                    View invoices
                  </a>
                  <a class="wallet-action wallet-action-secondary" routerLink="/tabs/search">
                    <ion-icon name="search-outline" aria-hidden="true"></ion-icon>
                    Explore services
                  </a>
                </div>
              </section>

              <div class="wallet-content-grid">
                <section class="wallet-activity" aria-labelledby="payments-history-title">
                  <div class="wallet-section-heading">
                    <div>
                      <p class="wallet-section-kicker">History</p>
                      <h2 id="payments-history-title">Payment activity</h2>
                    </div>
                    @if (paymentList.length) {
                      <span>{{ paymentList.length }} {{ paymentList.length === 1 ? "record" : "records" }}</span>
                    }
                  </div>

                  @if (paymentList.length) {
                    <div class="wallet-transactions">
                      @for (payment of paymentList; track payment.id) {
                        <article class="wallet-transaction">
                          <div class="transaction-icon transaction-debit">
                            <ion-icon [name]="paymentModeIcon(payment.mode)" aria-hidden="true"></ion-icon>
                          </div>
                          <div class="transaction-copy">
                            <strong>{{ paymentModeLabel(payment.mode) }}</strong>
                            <span>{{ paymentReferenceLabel(payment) }}</span>
                            <small>{{ paymentDateLabel(payment.createdAt) }}</small>
                          </div>
                          <div class="transaction-value">
                            <strong>{{ paymentAmount(payment.amountPaise) }}</strong>
                            <small>{{ payment.invoiceNumber ? 'Invoice ' + payment.invoiceNumber : 'Booking payment' }}</small>
                          </div>
                        </article>
                      }
                    </div>
                  } @else {
                    <div class="wallet-empty">
                      <div class="wallet-state-icon"><ion-icon name="card-outline" aria-hidden="true"></ion-icon></div>
                      <h3>No payments yet</h3>
                      <p>Your booking and invoice payments will appear here automatically after each settlement.</p>
                      <a routerLink="/tabs/search">Book a service <ion-icon name="chevron-forward-outline" aria-hidden="true"></ion-icon></a>
                    </div>
                  }
                </section>

                <aside class="wallet-guide" aria-labelledby="payments-guide-title">
                  <p class="wallet-section-kicker">Payment guide</p>
                  <h2 id="payments-guide-title">Know your payments</h2>
                  <div class="wallet-guide-list">
                    <div>
                      <span class="guide-number">01</span>
                      <p><strong>Payment methods</strong><small>UPI, card, wallet and cash are accepted wherever the salon enables them.</small></p>
                    </div>
                    <div>
                      <span class="guide-number">02</span>
                      <p><strong>Payment links</strong><small>Invoice balances can be settled anytime from a secure payment link.</small></p>
                    </div>
                    <div>
                      <span class="guide-number">03</span>
                      <p><strong>Refunds</strong><small>Eligible refunds move back to your wallet and appear in history here.</small></p>
                    </div>
                  </div>
                  <a class="wallet-help-link" routerLink="/help" [queryParams]="{ topic: 'payment' }">
                    Payment and wallet help
                    <ion-icon name="chevron-forward-outline" aria-hidden="true"></ion-icon>
                  </a>
                </aside>
              </div>
            } @else {
              <section class="wallet-state" aria-labelledby="payments-unavailable-title">
                <div class="wallet-state-icon"><ion-icon name="card-outline" aria-hidden="true"></ion-icon></div>
                <h2 id="payments-unavailable-title">Payment details are unavailable</h2>
                <p>We didn’t receive payment data for this account. Try refreshing the page.</p>
                <ion-button class="primary-gradient" (click)="reload()">Refresh payments</ion-button>
              </section>
            }
          </section>
        } @else if (rewardsMode()) {
          <section class="wallet-screen" aria-labelledby="rewards-title">
            <header class="wallet-heading">
              <div>
                <p class="wallet-eyebrow">Aura rewards</p>
                <div class="wallet-title-row">
                  <ion-back-button class="content-back-button" [defaultHref]="hubBackHref()" text=""></ion-back-button>
                  <h1 id="rewards-title">Rewards</h1>
                </div>
                <p class="wallet-intro">Points, tier and booking rewards from your activity.</p>
              </div>
              <a class="wallet-header-link" routerLink="/tabs/search" aria-label="Book a service">
                <ion-icon name="search-outline" aria-hidden="true"></ion-icon>
                <span>Book now</span>
              </a>
            </header>

            @if (rewardsData(); as rewards) {
              <section class="wallet-balance-card" aria-labelledby="rewards-balance-label">
                <div class="wallet-balance-copy">
                  <p id="rewards-balance-label">Loyalty points</p>
                  <strong>{{ rewards.loyaltyPoints }}</strong>
                  <small><span class="wallet-status"><span aria-hidden="true"></span>{{ rewards.tier }} tier</span></small>
                </div>
                <div class="wallet-actions" aria-label="Reward actions">
                  <a class="wallet-action wallet-action-primary" routerLink="/tabs/home">
                    <ion-icon name="ribbon-outline" aria-hidden="true"></ion-icon>
                    View tier benefits
                  </a>
                  <a class="wallet-action wallet-action-secondary" routerLink="/tabs/search">
                    <ion-icon name="search-outline" aria-hidden="true"></ion-icon>
                    Book & earn
                  </a>
                </div>
              </section>

              <div class="wallet-content-grid">
                <section class="wallet-activity" aria-labelledby="rewards-history-title">
                  <div class="wallet-section-heading">
                    <div>
                      <p class="wallet-section-kicker">History</p>
                      <h2 id="rewards-history-title">Reward activity</h2>
                    </div>
                    @if (rewards.history.length) {
                      <span>{{ rewards.history.length }} entries</span>
                    }
                  </div>

                  @if (rewards.history.length) {
                    <div class="wallet-transactions">
                      @for (item of rewards.history; track item.id) {
                        <article class="wallet-transaction">
                          <div class="transaction-icon" [class.transaction-debit]="item.points < 0">
                            <ion-icon name="ribbon-outline" aria-hidden="true"></ion-icon>
                          </div>
                          <div class="transaction-copy">
                            <strong>{{ item.type }}</strong>
                            <span>{{ item.description }}</span>
                            <small>{{ walletTransactionDate(item.createdAt) }}</small>
                          </div>
                          <div class="transaction-value">
                            <strong [class.text-danger]="item.points < 0">{{ item.points > 0 ? '+' : '' }}{{ item.points }}</strong>
                            <small>pts</small>
                          </div>
                        </article>
                      }
                    </div>
                  } @else {
                    <div class="wallet-empty">
                      <div class="wallet-state-icon"><ion-icon name="ribbon-outline" aria-hidden="true"></ion-icon></div>
                      <h3>No reward activity yet</h3>
                      <p>Points are earned from completed bookings and referrals. They will appear here automatically.</p>
                      <a routerLink="/tabs/search">Book a service <ion-icon name="chevron-forward-outline" aria-hidden="true"></ion-icon></a>
                    </div>
                  }
                </section>

                <aside class="wallet-guide" aria-labelledby="rewards-guide-title">
                  <p class="wallet-section-kicker">How it works</p>
                  <h2 id="rewards-guide-title">About rewards</h2>
                  <div class="wallet-guide-list">
                    <div>
                      <span class="guide-number">01</span>
                      <p><strong>Earn points</strong><small>Every completed booking earns loyalty points. Higher tiers earn more per visit.</small></p>
                    </div>
                    <div>
                      <span class="guide-number">02</span>
                      <p><strong>Tiers & benefits</strong><small>Progress through Bronze, Silver and Gold tiers to unlock exclusive perks and discounts.</small></p>
                    </div>
                    <div>
                      <span class="guide-number">03</span>
                      <p><strong>Referral rewards</strong><small>Invite friends to earn bonus points when they complete their first booking.</small></p>
                    </div>
                    <div>
                      <span class="guide-number">04</span>
                      <p><strong>Points expiry</strong><small>Points are valid for 12 months from the date they are earned.</small></p>
                    </div>
                  </div>
                  <a class="wallet-help-link" routerLink="/help" [queryParams]="{ topic: 'rewards' }">
                    <ion-icon name="information-circle-outline" aria-hidden="true"></ion-icon>
                    Help with rewards
                  </a>
                </aside>
              </div>
            } @else if (marketplace.loading()) {
              <div class="wallet-loading" role="status">
                <div class="wallet-skeleton">
                  <div class="skeleton-block skeleton-balance"></div>
                  <div class="skeleton-transactions">
                    <div class="skeleton-line skeleton-title"></div>
                    @for (item of [1, 2, 3]; track item) {
                      <div class="skeleton-transaction">
                        <span class="skeleton-circle"></span>
                        <span class="skeleton-line"></span>
                        <span class="skeleton-line skeleton-amount"></span>
                      </div>
                    }
                  </div>
                  <div class="wallet-guide-skeleton skeleton-block"></div>
                </div>
              </div>
            } @else if (marketplace.error()) {
              <section class="wallet-state wallet-error" role="alert" aria-labelledby="rewards-error-title">
                <div class="wallet-state-icon"><ion-icon name="information-circle-outline" aria-hidden="true"></ion-icon></div>
                <h2 id="rewards-error-title">We couldn&rsquo;t load your rewards</h2>
                <p>{{ marketplace.error() }}</p>
                <ion-button class="primary-gradient" (click)="reload()">Try again</ion-button>
              </section>
            } @else {
              <section class="wallet-state" aria-labelledby="rewards-unavailable-title">
                <div class="wallet-state-icon"><ion-icon name="ribbon-outline" aria-hidden="true"></ion-icon></div>
                <h2 id="rewards-unavailable-title">Rewards are unavailable</h2>
                <p>We didn&rsquo;t receive reward data for this account. Try refreshing the page.</p>
                <ion-button class="primary-gradient" (click)="reload()">Refresh rewards</ion-button>
              </section>
            }
          </section>
        } @else if (membershipsMode()) {
          <section class="wallet-screen" aria-labelledby="memberships-title">
            <header class="wallet-heading">
              <div>
                <p class="wallet-eyebrow">Aura memberships</p>
                <div class="wallet-title-row">
                  <ion-back-button class="content-back-button" [defaultHref]="hubBackHref()" text=""></ion-back-button>
                  <h1 id="memberships-title">Memberships</h1>
                </div>
                <p class="wallet-intro">Active plans, benefits and available memberships.</p>
              </div>
              <a class="wallet-header-link" routerLink="/tabs/search" aria-label="Book a service">
                <ion-icon name="search-outline" aria-hidden="true"></ion-icon>
                <span>Book now</span>
              </a>
            </header>

            @if (marketplace.loading()) {
              <div class="wallet-loading" role="status">
                <div class="wallet-skeleton">
                  <div class="skeleton-block skeleton-balance"></div>
                  <div class="skeleton-transactions">
                    <div class="skeleton-line skeleton-title"></div>
                    @for (item of [1, 2, 3]; track item) {
                      <div class="skeleton-transaction">
                        <span class="skeleton-circle"></span>
                        <span class="skeleton-line"></span>
                        <span class="skeleton-line skeleton-amount"></span>
                      </div>
                    }
                  </div>
                  <div class="wallet-guide-skeleton skeleton-block"></div>
                </div>
              </div>
            } @else if (marketplace.error()) {
              <section class="wallet-state wallet-error" role="alert" aria-labelledby="memberships-error-title">
                <div class="wallet-state-icon"><ion-icon name="information-circle-outline" aria-hidden="true"></ion-icon></div>
                <h2 id="memberships-error-title">We couldn&rsquo;t load your memberships</h2>
                <p>{{ marketplace.error() }}</p>
                <ion-button class="primary-gradient" (click)="reload()">Try again</ion-button>
              </section>
            } @else {
              @if (membershipsList(); as membershipList) {
                @if (membershipList.length) {
                  <section class="wallet-balance-card" aria-labelledby="memberships-count-label">
                    <div class="wallet-balance-copy">
                      <p id="memberships-count-label">Active memberships</p>
                      <strong>{{ membershipList.length }}</strong>
                      <small><span class="wallet-status"><span aria-hidden="true"></span>{{ membershipList[0].status }}</span></small>
                    </div>
                    <div class="wallet-actions" aria-label="Membership actions">
                      <a class="wallet-action wallet-action-primary" routerLink="/tabs/search">
                        <ion-icon name="heart-circle-outline" aria-hidden="true"></ion-icon>
                        Explore plans
                      </a>
                      <a class="wallet-action wallet-action-secondary" routerLink="/help" [queryParams]="{ topic: 'memberships' }">
                        <ion-icon name="information-circle-outline" aria-hidden="true"></ion-icon>
                        Help
                      </a>
                    </div>
                  </section>
                }

                <div class="wallet-content-grid">
                  <section class="wallet-activity" aria-labelledby="memberships-list-title">
                    <div class="wallet-section-heading">
                      <div>
                        <p class="wallet-section-kicker">Your plans</p>
                        <h2 id="memberships-list-title">Memberships</h2>
                      </div>
                      @if (membershipList.length) {
                        <span>{{ membershipList.length }} active</span>
                      }
                    </div>

                    @if (membershipList.length) {
                      <div class="wallet-transactions">
                        @for (item of membershipList; track item.id) {
                          <article class="wallet-transaction">
                            <div class="transaction-icon">
                              <ion-icon name="heart-circle-outline" aria-hidden="true"></ion-icon>
                            </div>
                            <div class="transaction-copy">
                              <strong>{{ item.planName }}</strong>
                              <span>{{ item.status }} &middot; {{ item.creditsRemaining }}/{{ item.planCredits }} credits</span>
                              <small>Bought {{ walletTransactionDate(item.createdAt) }}</small>
                            </div>
                            <div class="transaction-value">
                              <strong>{{ money(item.pricePaise) }}</strong>
                              @if (item.autoRenew) {
                                <small>Auto-renew</small>
                              }
                            </div>
                          </article>
                        }
                      </div>
                    } @else {
                      <div class="wallet-empty">
                        <div class="wallet-state-icon"><ion-icon name="heart-circle-outline" aria-hidden="true"></ion-icon></div>
                        <h3>No memberships yet</h3>
                        <p>Purchase a membership plan to unlock exclusive benefits, discounts and credits.</p>
                        <a routerLink="/tabs/search">Browse plans <ion-icon name="chevron-forward-outline" aria-hidden="true"></ion-icon></a>
                      </div>
                    }
                  </section>

                  <aside class="wallet-guide" aria-labelledby="memberships-guide-title">
                    <p class="wallet-section-kicker">Plans & benefits</p>
                    <h2 id="memberships-guide-title">Available plans</h2>

                    @if (actionMessage()) {
                      <div class="wallet-state" style="padding:12px 0">
                        <p style="font-size:0.84rem;color:var(--success);font-weight:600">{{ actionMessage() }}</p>
                      </div>
                    }

                    <ion-button class="primary-gradient" expand="block" (click)="loadPlans()" style="margin-bottom:12px">
                      <ion-icon name="heart-circle-outline" slot="start"></ion-icon>
                      Load live plans
                    </ion-button>

                    @if (marketplace.membershipPlans().length) {
                      <div class="wallet-guide-list">
                        @for (plan of marketplace.membershipPlans(); track plan.id) {
                          <div>
                            <span class="guide-number">{{ $index + 1 }}</span>
                            <p>
                              <strong>{{ plan.name }}</strong>
                              <small>{{ plan.validityDays }} days &middot; {{ money(plan.pricePaise) }} &middot; {{ plan.description }}</small>
                              <ion-button fill="outline" size="small" class="secondary-button" (click)="buyPlan(plan)" style="margin-top:6px">Buy membership</ion-button>
                            </p>
                          </div>
                        }
                      </div>
                    }

                    <div class="wallet-guide-list" style="margin-top:16px">
                      <div>
                        <span class="guide-number">01</span>
                        <p><strong>Choose a plan</strong><small>Browse membership options with credits, discounts and exclusive perks.</small></p>
                      </div>
                      <div>
                        <span class="guide-number">02</span>
                        <p><strong>Credits & usage</strong><small>Each membership includes plan credits you can redeem against services.</small></p>
                      </div>
                      <div>
                        <span class="guide-number">03</span>
                        <p><strong>Auto-renew</strong><small>Memberships can be set to auto-renew so you never lose your benefits.</small></p>
                      </div>
                    </div>
                    <a class="wallet-help-link" routerLink="/help" [queryParams]="{ topic: 'memberships' }">
                      <ion-icon name="information-circle-outline" aria-hidden="true"></ion-icon>
                      Help with memberships
                    </a>
                  </aside>
                </div>
              }
            }
          </section>
        } @else if (familyMode()) {
          <section class="wallet-screen" aria-labelledby="family-title">
            <header class="wallet-heading">
              <div>
                <p class="wallet-eyebrow family-eyebrow">Family booking</p>
                <div class="wallet-title-row">
                  <ion-back-button class="content-back-button" [defaultHref]="hubBackHref()" text=""></ion-back-button>
                  <h1 id="family-title">Family profiles</h1>
                </div>
                <p class="wallet-intro">Profiles, preferences and shared bookings for your family.</p>
              </div>
              <a class="wallet-header-link" routerLink="/tabs/search" aria-label="Book a service">
                <ion-icon name="search-outline" aria-hidden="true"></ion-icon>
                <span>Book now</span>
              </a>
            </header>

            <div class="wallet-content-grid">
              <section class="wallet-activity" aria-labelledby="family-profiles-title">
                <div class="wallet-section-heading">
                  <div>
                    <p class="wallet-section-kicker">Your family</p>
                    <h2 id="family-profiles-title">Profiles</h2>
                  </div>
                  <span>3 members</span>
                </div>

                <div class="wallet-transactions">
                  <article class="wallet-transaction">
                    <div class="transaction-icon">
                      <ion-icon name="people-outline" aria-hidden="true"></ion-icon>
                    </div>
                    <div class="transaction-copy">
                      <strong>Mom profile</strong>
                      <span>Primary contact set</span>
                      <small>Shared profile with preferred salon notes</small>
                    </div>
                  </article>
                  <article class="wallet-transaction">
                    <div class="transaction-icon">
                      <ion-icon name="people-outline" aria-hidden="true"></ion-icon>
                    </div>
                    <div class="transaction-copy">
                      <strong>Kids haircut preferences</strong>
                      <span>Updated today</span>
                      <small>Clipper length and appointment reminders saved</small>
                    </div>
                  </article>
                  <article class="wallet-transaction">
                    <div class="transaction-icon">
                      <ion-icon name="people-outline" aria-hidden="true"></ion-icon>
                    </div>
                    <div class="transaction-copy">
                      <strong>Family grooming visit</strong>
                      <span>3 guests</span>
                      <small>Multi-person booking draft for the weekend</small>
                    </div>
                    <div class="transaction-value">
                      <strong>{{ money(420000) }}</strong>
                    </div>
                  </article>
                </div>
              </section>

              <aside class="wallet-guide" aria-labelledby="family-guide-title">
                <p class="wallet-section-kicker">Getting started</p>
                <h2 id="family-guide-title">Family & shared bookings</h2>
                <div class="wallet-guide-list">
                  <div>
                    <span class="guide-number">01</span>
                    <p><strong>Add a profile</strong><small>Create profiles for each family member with their service preferences and notes.</small></p>
                  </div>
                  <div>
                    <span class="guide-number">02</span>
                    <p><strong>Book together</strong><small>Schedule multi-person appointments in a single booking for the same time slot.</small></p>
                  </div>
                  <div>
                    <span class="guide-number">03</span>
                    <p><strong>Shared history</strong><small>View past visits and preferences for every family member from one account.</small></p>
                  </div>
                </div>
                <a class="wallet-help-link" routerLink="/help" [queryParams]="{ topic: 'family' }">
                  <ion-icon name="information-circle-outline" aria-hidden="true"></ion-icon>
                  Help with family bookings
                </a>
              </aside>
            </div>
          </section>
        } @else if (referralsMode()) {
          <section class="wallet-screen" aria-labelledby="referrals-title">
            <header class="wallet-heading">
              <div>
                <p class="wallet-eyebrow">Refer & earn</p>
                <div class="wallet-title-row">
                  <ion-back-button class="content-back-button" [defaultHref]="hubBackHref()" text=""></ion-back-button>
                  <h1 id="referrals-title">Referrals</h1>
                </div>
                <p class="wallet-intro">Invite friends and earn rewards when they book.</p>
              </div>
              <a class="wallet-header-link" routerLink="/tabs/search" aria-label="Invite friends">
                <ion-icon name="share-social-outline" aria-hidden="true"></ion-icon>
                <span>Invite now</span>
              </a>
            </header>

            <section class="wallet-balance-card" aria-labelledby="referrals-balance-label">
              <div class="wallet-balance-copy">
                <p id="referrals-balance-label">Your referral code</p>
                <strong>AURA-SHINE</strong>
                <small><span class="wallet-status"><span aria-hidden="true"></span>Share with friends to unlock booking rewards</span></small>
              </div>
              <div class="wallet-actions" aria-label="Referral actions">
                <a class="wallet-action wallet-action-primary" routerLink="/tabs/search">
                  <ion-icon name="share-social-outline" aria-hidden="true"></ion-icon>
                  Share code
                </a>
                <a class="wallet-action wallet-action-secondary" routerLink="/help" [queryParams]="{ topic: 'referrals' }">
                  <ion-icon name="information-circle-outline" aria-hidden="true"></ion-icon>
                  How it works
                </a>
              </div>
            </section>

            <div class="wallet-content-grid">
              <section class="wallet-activity" aria-labelledby="referrals-history-title">
                <div class="wallet-section-heading">
                  <div>
                    <p class="wallet-section-kicker">Activity</p>
                    <h2 id="referrals-history-title">Referral history</h2>
                  </div>
                  <span>5 referrals</span>
                </div>

                <div class="wallet-transactions">
                  <article class="wallet-transaction">
                    <div class="transaction-icon transaction-debit">
                      <ion-icon name="share-social-outline" aria-hidden="true"></ion-icon>
                    </div>
                    <div class="transaction-copy">
                      <strong>Ready</strong>
                      <span>Invite code AURA-SHINE sent</span>
                      <small>Share with friends to unlock booking rewards</small>
                    </div>
                    <div class="transaction-value">
                      <small>Reusable code</small>
                    </div>
                  </article>
                  <article class="wallet-transaction">
                    <div class="transaction-icon">
                      <ion-icon name="share-social-outline" aria-hidden="true"></ion-icon>
                    </div>
                    <div class="transaction-copy">
                      <strong>Pending</strong>
                      <span>Riya's first booking</span>
                      <small>Reward unlocks when the referred booking is completed</small>
                    </div>
                    <div class="transaction-value">
                      <strong>{{ money(20000) }}</strong>
                      <small>Referral bonus</small>
                    </div>
                  </article>
                  <article class="wallet-transaction">
                    <div class="transaction-icon">
                      <ion-icon name="share-social-outline" aria-hidden="true"></ion-icon>
                    </div>
                    <div class="transaction-copy">
                      <strong>Earned</strong>
                      <span>Referral credit added</span>
                      <small>Credit added after a successful referral</small>
                    </div>
                    <div class="transaction-value">
                      <strong>{{ money(30000) }}</strong>
                      <small>12 Jun 2026</small>
                    </div>
                  </article>
                </div>
              </section>

              <aside class="wallet-guide" aria-labelledby="referrals-guide-title">
                <p class="wallet-section-kicker">How it works</p>
                <h2 id="referrals-guide-title">Referral rewards</h2>
                <div class="wallet-guide-list">
                  <div>
                    <span class="guide-number">01</span>
                    <p><strong>Share your code</strong><small>Send your unique referral code AURA-SHINE to friends and family.</small></p>
                  </div>
                  <div>
                    <span class="guide-number">02</span>
                    <p><strong>They book</strong><small>When a referred friend completes their first booking, you earn a reward.</small></p>
                  </div>
                  <div>
                    <span class="guide-number">03</span>
                    <p><strong>Get rewarded</strong><small>Credits are added to your wallet automatically once the booking is completed.</small></p>
                  </div>
                </div>
                <a class="wallet-help-link" routerLink="/help" [queryParams]="{ topic: 'referrals' }">
                  <ion-icon name="information-circle-outline" aria-hidden="true"></ion-icon>
                  Help with referrals
                </a>
              </aside>
            </div>
          </section>
        } @else if (giftCardsMode()) {
          <section class="wallet-screen" aria-labelledby="giftcards-title">
            <header class="wallet-heading">
              <div>
                <p class="wallet-eyebrow">Gift cards</p>
                <div class="wallet-title-row">
                  <ion-back-button class="content-back-button" [defaultHref]="hubBackHref()" text=""></ion-back-button>
                  <h1 id="giftcards-title">Gift cards</h1>
                </div>
                <p class="wallet-intro">Purchase, redeem and track your gift card balances.</p>
              </div>
              <a class="wallet-header-link" routerLink="/tabs/search" aria-label="Browse services">
                <ion-icon name="gift-outline" aria-hidden="true"></ion-icon>
                <span>Buy a gift card</span>
              </a>
            </header>

            @if (marketplace.loading()) {
              <div class="wallet-loading" role="status">
                <div class="wallet-skeleton">
                  <div class="skeleton-block skeleton-balance"></div>
                  <div class="skeleton-transactions">
                    <div class="skeleton-line skeleton-title"></div>
                    @for (item of [1, 2, 3]; track item) {
                      <div class="skeleton-transaction">
                        <span class="skeleton-circle"></span>
                        <span class="skeleton-line"></span>
                        <span class="skeleton-line skeleton-amount"></span>
                      </div>
                    }
                  </div>
                  <div class="wallet-guide-skeleton skeleton-block"></div>
                </div>
              </div>
            } @else if (marketplace.error()) {
              <section class="wallet-state wallet-error" role="alert" aria-labelledby="giftcards-error-title">
                <div class="wallet-state-icon"><ion-icon name="information-circle-outline" aria-hidden="true"></ion-icon></div>
                <h2 id="giftcards-error-title">We couldn&rsquo;t load your gift cards</h2>
                <p>{{ marketplace.error() }}</p>
                <ion-button class="primary-gradient" (click)="reload()">Try again</ion-button>
              </section>
            } @else {
              @if (giftCardsList(); as gcList) {
                @if (gcList.length) {
                  <section class="wallet-balance-card" aria-labelledby="giftcards-balance-label">
                    <div class="wallet-balance-copy">
                      <p id="giftcards-balance-label">Gift cards</p>
                      <strong>{{ gcList.length }}</strong>
                      <small><span class="wallet-status"><span aria-hidden="true"></span>{{ gcList[0].status }}</span></small>
                    </div>
                    <div class="wallet-actions" aria-label="Gift card actions">
                      <a class="wallet-action wallet-action-primary" (click)="purchaseGiftCard()">
                        <ion-icon name="gift-outline" aria-hidden="true"></ion-icon>
                        Buy new
                      </a>
                      <a class="wallet-action wallet-action-secondary" routerLink="/help" [queryParams]="{ topic: 'gift-cards' }">
                        <ion-icon name="information-circle-outline" aria-hidden="true"></ion-icon>
                        Help
                      </a>
                    </div>
                  </section>
                }

                <div class="wallet-content-grid">
                  <section class="wallet-activity" aria-labelledby="giftcards-list-title">
                    <div class="wallet-section-heading">
                      <div>
                        <p class="wallet-section-kicker">Your cards</p>
                        <h2 id="giftcards-list-title">Gift cards</h2>
                      </div>
                      @if (gcList.length) {
                        <span>{{ gcList.length }} card{{ gcList.length === 1 ? '' : 's' }}</span>
                      }
                    </div>

                    @if (gcList.length) {
                      <div class="wallet-transactions">
                        @for (card of gcList; track card.id) {
                          <article class="wallet-transaction">
                            <div class="transaction-icon">
                              <ion-icon name="gift-outline" aria-hidden="true"></ion-icon>
                            </div>
                            <div class="transaction-copy">
                              <strong>{{ card.code }}</strong>
                              <span>{{ card.status }}</span>
                              <small>Expires {{ walletTransactionDate(card.expiryDate) }}</small>
                            </div>
                            <div class="transaction-value">
                              <strong>{{ money(card.balancePaise) }}</strong>
                              <small>{{ money(card.initialValuePaise) }} issued</small>
                            </div>
                          </article>
                        }
                      </div>
                    } @else {
                      <div class="wallet-empty">
                        <div class="wallet-state-icon"><ion-icon name="gift-outline" aria-hidden="true"></ion-icon></div>
                        <h3>No gift cards yet</h3>
                        <p>Gift cards can be purchased for yourself or as a gift for someone else.</p>
                        <a (click)="purchaseGiftCard()">Buy a gift card <ion-icon name="chevron-forward-outline" aria-hidden="true"></ion-icon></a>
                      </div>
                    }
                  </section>

                  <aside class="wallet-guide" aria-labelledby="giftcards-guide-title">
                    <p class="wallet-section-kicker">About gift cards</p>
                    <h2 id="giftcards-guide-title">How gift cards work</h2>
                    <div class="wallet-guide-list">
                      <div>
                        <span class="guide-number">01</span>
                        <p><strong>Purchase</strong><small>Buy a gift card for any amount starting from &rsquo;100. Instant digital delivery.</small></p>
                      </div>
                      <div>
                        <span class="guide-number">02</span>
                        <p><strong>Redeem</strong><small>Use the gift card code at checkout when booking services or buying products.</small></p>
                      </div>
                      <div>
                        <span class="guide-number">03</span>
                        <p><strong>Track balance</strong><small>Your remaining balance and transaction history are always visible here.</small></p>
                      </div>
                    </div>
                    <a class="wallet-help-link" routerLink="/help" [queryParams]="{ topic: 'gift-cards' }">
                      <ion-icon name="information-circle-outline" aria-hidden="true"></ion-icon>
                      Help with gift cards
                    </a>
                  </aside>
                </div>
              }
            }
          </section>
        } @else if (corporateMode()) {
          <section class="wallet-screen" aria-labelledby="corporate-title">
            <header class="wallet-heading">
              <div>
                <p class="wallet-eyebrow">Corporate benefits</p>
                <div class="wallet-title-row">
                  <ion-back-button class="content-back-button" [defaultHref]="hubBackHref()" text=""></ion-back-button>
                  <h1 id="corporate-title">Corporate</h1>
                </div>
                <p class="wallet-intro">Workplace benefits, packages and reimbursements.</p>
              </div>
              <a class="wallet-header-link" routerLink="/tabs/search" aria-label="Browse services">
                <ion-icon name="briefcase-outline" aria-hidden="true"></ion-icon>
                <span>Explore</span>
              </a>
            </header>

            <div class="wallet-content-grid">
              <section class="wallet-activity" aria-labelledby="corporate-list-title">
                <div class="wallet-section-heading">
                  <div>
                    <p class="wallet-section-kicker">Benefits</p>
                    <h2 id="corporate-list-title">Corporate records</h2>
                  </div>
                  <span>3 items</span>
                </div>

                <div class="wallet-transactions">
                  <article class="wallet-transaction">
                    <div class="transaction-icon">
                      <ion-icon name="briefcase-outline" aria-hidden="true"></ion-icon>
                    </div>
                    <div class="transaction-copy">
                      <strong>Aura Corporate Wellness</strong>
                      <span>Employee verified</span>
                      <small>Company benefit active for grooming and wellness bookings</small>
                    </div>
                  </article>
                  <article class="wallet-transaction">
                    <div class="transaction-icon">
                      <ion-icon name="briefcase-outline" aria-hidden="true"></ion-icon>
                    </div>
                    <div class="transaction-copy">
                      <strong>Monthly team grooming pass</strong>
                      <span>1 pass left</span>
                      <small>One subsidized appointment available this month</small>
                    </div>
                    <div class="transaction-value">
                      <strong>{{ money(120000) }}</strong>
                    </div>
                  </article>
                  <article class="wallet-transaction">
                    <div class="transaction-icon">
                      <ion-icon name="briefcase-outline" aria-hidden="true"></ion-icon>
                    </div>
                    <div class="transaction-copy">
                      <strong>HR reimbursement pending</strong>
                      <span>Pending approval</span>
                      <small>Corporate invoice can be shared with the company admin</small>
                    </div>
                    <div class="transaction-value">
                      <strong>{{ money(280000) }}</strong>
                    </div>
                  </article>
                </div>
              </section>

              <aside class="wallet-guide" aria-labelledby="corporate-guide-title">
                <p class="wallet-section-kicker">How it works</p>
                <h2 id="corporate-guide-title">Corporate benefits</h2>
                <div class="wallet-guide-list">
                  <div>
                    <span class="guide-number">01</span>
                    <p><strong>Verify eligibility</strong><small>Confirm your corporate benefit through your employer&rsquo;s wellness program.</small></p>
                  </div>
                  <div>
                    <span class="guide-number">02</span>
                    <p><strong>Use your benefits</strong><small>Redeem subsidized appointments and packages as part of your corporate plan.</small></p>
                  </div>
                  <div>
                    <span class="guide-number">03</span>
                    <p><strong>Reimbursements</strong><small>Submit invoices for HR reimbursement directly from the app.</small></p>
                  </div>
                </div>
                <a class="wallet-help-link" routerLink="/help" [queryParams]="{ topic: 'corporate' }">
                  <ion-icon name="information-circle-outline" aria-hidden="true"></ion-icon>
                  Help with corporate benefits
                </a>
              </aside>
            </div>
          </section>
        } @else if (goalsMode()) {
          <section class="wallet-screen" aria-labelledby="goals-title">
            <header class="wallet-heading">
              <div>
                <p class="wallet-eyebrow">Beauty goals</p>
                <div class="wallet-title-row">
                  <ion-back-button class="content-back-button" [defaultHref]="hubBackHref()" text=""></ion-back-button>
                  <h1 id="goals-title">Goals</h1>
                </div>
                <p class="wallet-intro">Track your treatment plans, routines and progress.</p>
              </div>
              <a class="wallet-header-link" routerLink="/tabs/search" aria-label="Find services">
                <ion-icon name="color-palette-outline" aria-hidden="true"></ion-icon>
                <span>Discover</span>
              </a>
            </header>

            <div class="wallet-content-grid">
              <section class="wallet-activity" aria-labelledby="goals-list-title">
                <div class="wallet-section-heading">
                  <div>
                    <p class="wallet-section-kicker">Your goals</p>
                    <h2 id="goals-list-title">Beauty goals</h2>
                  </div>
                  <span>3 goals</span>
                </div>

                <div class="wallet-transactions">
                  <article class="wallet-transaction">
                    <div class="transaction-icon">
                      <ion-icon name="color-palette-outline" aria-hidden="true"></ion-icon>
                    </div>
                    <div class="transaction-copy">
                      <strong>Hair repair plan</strong>
                      <span>Week 2</span>
                      <small>Four-week routine with hydration and trim reminders</small>
                    </div>
                  </article>
                  <article class="wallet-transaction">
                    <div class="transaction-icon">
                      <ion-icon name="color-palette-outline" aria-hidden="true"></ion-icon>
                    </div>
                    <div class="transaction-copy">
                      <strong>Pre-event glow plan</strong>
                      <span>Next step due</span>
                      <small>Recommended facial schedule and product reminders</small>
                    </div>
                    <div class="transaction-value">
                      <strong>{{ money(520000) }}</strong>
                    </div>
                  </article>
                  <article class="wallet-transaction">
                    <div class="transaction-icon transaction-debit">
                      <ion-icon name="color-palette-outline" aria-hidden="true"></ion-icon>
                    </div>
                    <div class="transaction-copy">
                      <strong>Consistency streak</strong>
                      <span>3 of 3</span>
                      <small>Three planned self-care visits completed this quarter</small>
                    </div>
                  </article>
                </div>
              </section>

              <aside class="wallet-guide" aria-labelledby="goals-guide-title">
                <p class="wallet-section-kicker">Getting started</p>
                <h2 id="goals-guide-title">Set your goals</h2>
                <div class="wallet-guide-list">
                  <div>
                    <span class="guide-number">01</span>
                    <p><strong>Define a goal</strong><small>Choose a beauty or wellness target like hair repair, skin glow or fitness.</small></p>
                  </div>
                  <div>
                    <span class="guide-number">02</span>
                    <p><strong>Follow the plan</strong><small>Get a curated routine with recommended services and product reminders.</small></p>
                  </div>
                  <div>
                    <span class="guide-number">03</span>
                    <p><strong>Track progress</strong><small>Mark visits as completed and watch your goal progress grow over time.</small></p>
                  </div>
                </div>
                <a class="wallet-help-link" routerLink="/help" [queryParams]="{ topic: 'goals' }">
                  <ion-icon name="information-circle-outline" aria-hidden="true"></ion-icon>
                  Help with beauty goals
                </a>
              </aside>
            </div>
          </section>
        } @else if (packagesMode()) {
          <section class="wallet-screen" aria-labelledby="packages-title">
            <header class="wallet-heading">
              <div>
                <p class="wallet-eyebrow">Aura packages</p>
                <div class="wallet-title-row">
                  <ion-back-button class="content-back-button" [defaultHref]="hubBackHref()" text=""></ion-back-button>
                  <h1 id="packages-title">Packages</h1>
                </div>
                <p class="wallet-intro">Sessions, balances and package redemptions.</p>
              </div>
              <a class="wallet-header-link" routerLink="/tabs/search" aria-label="Book a service">
                <ion-icon name="search-outline" aria-hidden="true"></ion-icon>
                <span>Book now</span>
              </a>
            </header>

            @if (marketplace.loading()) {
              <div class="wallet-loading" role="status">
                <div class="wallet-skeleton">
                  <div class="skeleton-block skeleton-balance"></div>
                  <div class="skeleton-transactions">
                    <div class="skeleton-line skeleton-title"></div>
                    @for (item of [1, 2, 3]; track item) {
                      <div class="skeleton-transaction">
                        <span class="skeleton-circle"></span>
                        <span class="skeleton-line"></span>
                        <span class="skeleton-line skeleton-amount"></span>
                      </div>
                    }
                  </div>
                  <div class="wallet-guide-skeleton skeleton-block"></div>
                </div>
              </div>
            } @else if (marketplace.error()) {
              <section class="wallet-state wallet-error" role="alert" aria-labelledby="packages-error-title">
                <div class="wallet-state-icon"><ion-icon name="information-circle-outline" aria-hidden="true"></ion-icon></div>
                <h2 id="packages-error-title">We couldn&rsquo;t load your packages</h2>
                <p>{{ marketplace.error() }}</p>
                <ion-button class="primary-gradient" (click)="reload()">Try again</ion-button>
              </section>
            } @else {
              @if (packagesList(); as packageList) {
                @if (packageList.length) {
                  <section class="wallet-balance-card" aria-labelledby="packages-count-label">
                    <div class="wallet-balance-copy">
                      <p id="packages-count-label">Active packages</p>
                      <strong>{{ packageList.length }}</strong>
                      <small><span class="wallet-status"><span aria-hidden="true"></span>{{ packageList[0].status }}</span></small>
                    </div>
                    <div class="wallet-actions" aria-label="Package actions">
                      <a class="wallet-action wallet-action-primary" routerLink="/tabs/search">
                        <ion-icon name="ticket-outline" aria-hidden="true"></ion-icon>
                        Browse packages
                      </a>
                      <a class="wallet-action wallet-action-secondary" routerLink="/help" [queryParams]="{ topic: 'packages' }">
                        <ion-icon name="information-circle-outline" aria-hidden="true"></ion-icon>
                        Help
                      </a>
                    </div>
                  </section>
                }

                <div class="wallet-content-grid">
                  <section class="wallet-activity" aria-labelledby="packages-list-title">
                    <div class="wallet-section-heading">
                      <div>
                        <p class="wallet-section-kicker">Your packages</p>
                        <h2 id="packages-list-title">Packages</h2>
                      </div>
                      @if (packageList.length) {
                        <span>{{ packageList.length }} active</span>
                      }
                    </div>

                    @if (packageList.length) {
                      <div class="wallet-transactions">
                        @for (item of packageList; track item.id) {
                          <article class="wallet-transaction">
                            <div class="transaction-icon">
                              <ion-icon name="ticket-outline" aria-hidden="true"></ion-icon>
                            </div>
                            <div class="transaction-copy">
                              <strong>{{ item.name }}</strong>
                              <span>{{ item.status }}</span>
                              @if (item.createdAt) {
                                <small>Bought {{ walletTransactionDate(item.createdAt) }}</small>
                              }
                            </div>
                            <div class="transaction-value">
                              <strong>{{ money(item.pricePaise) }}</strong>
                              @if (item.creditsRemaining !== undefined) {
                                <small>{{ item.creditsRemaining }} credits left</small>
                              }
                            </div>
                          </article>
                        }
                      </div>
                    } @else {
                      <div class="wallet-empty">
                        <div class="wallet-state-icon"><ion-icon name="ticket-outline" aria-hidden="true"></ion-icon></div>
                        <h3>No packages yet</h3>
                        <p>Purchase a service package for discounted rates on your favourite treatments.</p>
                        <a routerLink="/tabs/search">Browse packages <ion-icon name="chevron-forward-outline" aria-hidden="true"></ion-icon></a>
                      </div>
                    }
                  </section>

                  <aside class="wallet-guide" aria-labelledby="packages-guide-title">
                    <p class="wallet-section-kicker">How it works</p>
                    <h2 id="packages-guide-title">About packages</h2>
                    <div class="wallet-guide-list">
                      <div>
                        <span class="guide-number">01</span>
                        <p><strong>Choose a package</strong><small>Select from available service bundles with prepaid credits at discounted rates.</small></p>
                      </div>
                      <div>
                        <span class="guide-number">02</span>
                        <p><strong>Redeem credits</strong><small>Credits are automatically applied when you book a service covered by the package.</small></p>
                      </div>
                      <div>
                        <span class="guide-number">03</span>
                        <p><strong>Track balance</strong><small>Your remaining credits and package status are always visible in this section.</small></p>
                      </div>
                    </div>
                    <a class="wallet-help-link" routerLink="/help" [queryParams]="{ topic: 'packages' }">
                      <ion-icon name="information-circle-outline" aria-hidden="true"></ion-icon>
                      Help with packages
                    </a>
                  </aside>
                </div>
              }
            }
          </section>
        } @else if (slug() === "support") {
          <section class="wallet-screen" aria-labelledby="support-title">
            <header class="wallet-heading">
              <div>
                <p class="wallet-eyebrow">Aura support</p>
                <div class="wallet-title-row">
                  <ion-back-button class="content-back-button" [defaultHref]="hubBackHref()" text=""></ion-back-button>
                  <h1 id="support-title">Help & support</h1>
                </div>
                <p class="wallet-intro">Your support tickets and help resources.</p>
              </div>
              <a class="wallet-header-link" routerLink="/help" aria-label="Help centre">
                <ion-icon name="information-circle-outline" aria-hidden="true"></ion-icon>
                <span>Help centre</span>
                <ion-icon name="chevron-forward-outline" aria-hidden="true"></ion-icon>
              </a>
            </header>

            @if (!marketplace.isAuthenticated()) {
              <section class="wallet-state" aria-labelledby="support-login-title">
                <div class="wallet-state-icon"><ion-icon name="chatbubbles-outline" aria-hidden="true"></ion-icon></div>
                <h2 id="support-login-title">Login required</h2>
                <p>Sign in to view your support tickets and contact history.</p>
                <ion-button class="primary-gradient" [routerLink]="['/login']" [queryParams]="{ returnUrl: '/tabs/support' }">Log in</ion-button>
              </section>
            } @else if (marketplace.loading()) {
              <div class="wallet-loading" role="status">
                <div class="wallet-skeleton">
                  <div class="skeleton-block skeleton-balance"></div>
                  <div class="skeleton-transactions">
                    <div class="skeleton-line skeleton-title"></div>
                    @for (item of [1, 2]; track item) {
                      <div class="skeleton-transaction">
                        <span class="skeleton-circle"></span>
                        <span class="skeleton-line"></span>
                        <span class="skeleton-line skeleton-amount"></span>
                      </div>
                    }
                  </div>
                  <div class="wallet-guide-skeleton skeleton-block"></div>
                </div>
              </div>
            } @else if (marketplace.error()) {
              <section class="wallet-state wallet-error" role="alert" aria-labelledby="support-error-title">
                <div class="wallet-state-icon"><ion-icon name="information-circle-outline" aria-hidden="true"></ion-icon></div>
                <h2 id="support-error-title">Could not load support data</h2>
                <p>{{ marketplace.error() }}</p>
                <ion-button class="primary-gradient" (click)="reload()">Try again</ion-button>
              </section>
            } @else {
              <div class="wallet-content-grid">
                <section class="wallet-activity" aria-labelledby="tickets-list-title">
                  <div class="wallet-section-heading">
                    <div>
                      <p class="wallet-section-kicker">Your requests</p>
                      <h2 id="tickets-list-title">Support tickets</h2>
                    </div>
                    @if (supportTickets().length) {
                      <span>{{ supportTickets().length }} total</span>
                    }
                  </div>

                  @if (supportHistoryLoading()) {
                    <div class="wallet-loading" role="status">
                      <div class="wallet-skeleton">
                        @for (item of [1, 2]; track item) {
                          <div class="skeleton-transaction">
                            <span class="skeleton-circle"></span>
                            <span class="skeleton-line"></span>
                          </div>
                        }
                      </div>
                    </div>
                  } @else if (supportHistoryError()) {
                    <div class="wallet-state wallet-error" role="alert">
                      <h3>Could not load tickets</h3>
                      <p>{{ supportHistoryError() }}</p>
                      <ion-button fill="outline" class="secondary-button" (click)="loadSupportHistory()">Retry</ion-button>
                    </div>
                  } @else if (supportTickets().length) {
                    <div class="wallet-transactions">
                      @for (ticket of supportTickets(); track ticket.id) {
                        <article class="wallet-transaction" [routerLink]="ticket.bookingId ? ['/bookings', ticket.bookingId] : undefined">
                          <div class="transaction-icon">
                            <ion-icon name="chatbubbles-outline" aria-hidden="true"></ion-icon>
                          </div>
                          <div class="transaction-copy">
                            <strong>{{ supportCategoryLabel(ticket.category) }}</strong>
                            <span>{{ ticket.status }}</span>
                            <small>{{ supportTicketDate(ticket.updatedAt || ticket.createdAt) }}</small>
                          </div>
                          <div class="transaction-value">
                            <small>{{ ticket.id }}</small>
                          </div>
                        </article>
                      }
                    </div>
                  } @else {
                    <div class="wallet-empty">
                      <div class="wallet-state-icon"><ion-icon name="chatbubbles-outline" aria-hidden="true"></ion-icon></div>
                      <h3>No support tickets</h3>
                      <p>You haven&rsquo;t submitted any support requests yet. Visit a booking to get help.</p>
                      <a routerLink="/tabs/bookings">View my bookings <ion-icon name="chevron-forward-outline" aria-hidden="true"></ion-icon></a>
                    </div>
                  }

                  @if (supportTickets().length > 0) {
                    <div class="wallet-empty" style="margin-top:12px">
                      <p>Need help with a specific booking? Use the help option on any booking detail page.</p>
                      <a routerLink="/tabs/bookings">Go to bookings <ion-icon name="chevron-forward-outline" aria-hidden="true"></ion-icon></a>
                    </div>
                  }
                </section>

                <aside class="wallet-guide" aria-labelledby="support-guide-title">
                  <p class="wallet-section-kicker">How it works</p>
                  <h2 id="support-guide-title">Getting help</h2>
                  <div class="wallet-guide-list">
                    <div>
                      <span class="guide-number">01</span>
                      <p><strong>From a booking</strong><small>Open any booking and choose the support option to send a request linked to that appointment.</small></p>
                    </div>
                    <div>
                      <span class="guide-number">02</span>
                      <p><strong>Track your ticket</strong><small>Every request creates a ticket you can follow here. Check status and updates in real time.</small></p>
                    </div>
                    <div>
                      <span class="guide-number">03</span>
                      <p><strong>Help centre</strong><small>Browse FAQs and guides for common topics like payments, cancellations and account management.</small></p>
                    </div>
                  </div>
                  <a class="wallet-help-link" routerLink="/help">
                    <ion-icon name="information-circle-outline" aria-hidden="true"></ion-icon>
                    Visit help centre
                  </a>
                  <a class="wallet-help-link" routerLink="/tabs/bookings" style="margin-top:6px">
                    <ion-icon name="calendar-outline" aria-hidden="true"></ion-icon>
                    View my bookings
                  </a>
                </aside>
              </div>
            }
          </section>
        } @else {
          <section class="hub-hero">
          <div class="hero-icon"><ion-icon [name]="config().icon"></ion-icon></div>
          <p>{{ config().eyebrow }}</p>
          <h1>{{ config().title }}</h1>
          <span>{{ config().subtitle }}</span>
          <div class="hero-actions">
            <ion-button class="primary-gradient" routerLink="/tabs/search">
              <ion-icon name="search-outline" slot="start"></ion-icon>
              Discover salons
            </ion-button>
            <ion-button fill="outline" class="secondary-button" routerLink="/tabs/home">Back to home</ion-button>
          </div>
        </section>

        <section class="hub-grid" aria-label="Customer hub sections">
          @for (item of hubModules; track item.route) {
            <a class="premium-card hub-tile" [class.active]="slug() === item.slug" [routerLink]="item.route">
              <ion-icon [name]="item.icon"></ion-icon>
              <strong>{{ item.label }}</strong>
              <small>{{ item.copy }}</small>
            </a>
          }
        </section>

        @if (!marketplace.isAuthenticated()) {
          <section class="premium-card state-card">
            <h2>Login required</h2>
            <ion-button class="primary-gradient" [routerLink]="['/login']" [queryParams]="{ returnUrl: config().route }">Log in</ion-button>
          </section>
        } @else {
          @if (marketplace.loading()) {
            <section class="premium-card state-card">
              <h2>Loading live data</h2>
            </section>
          }

          @if (marketplace.error()) {
            <section class="premium-card state-card error">
              <h2>Could not load this section</h2>
              <p>{{ marketplace.error() }}</p>
              <ion-button class="primary-gradient" (click)="reload()">Retry</ion-button>
            </section>
          }

          <section class="metric-grid" aria-label="Customer account summary">
            <article class="metric-card customer-metric premium-card">
              <span>Customer</span>
              <strong>{{ customerName() }}</strong>
            </article>
            <article class="metric-card count-metric premium-card">
              <span>Bookings</span>
              <strong>{{ marketplace.bookings().length }}</strong>
            </article>
            <article class="metric-card count-metric premium-card">
              <span>Loyalty</span>
              <strong>{{ marketplace.customer()?.loyaltyPoints ?? 0 }} pts</strong>
            </article>
          </section>

          @if (recordCount() > 0) {
            <section class="records-grid" aria-label="Live customer records">
              @for (record of records(); track record.key) {
                <article class="premium-card record-card">
                  <div class="record-label-row">
                    <span>{{ record.status }}</span>
                    @if (record.demo) {
                      <small class="demo-chip">Demo</small>
                    }
                  </div>
                  <strong>{{ record.title }}</strong>
                  @if (record.description) {
                    <p class="record-copy">{{ record.description }}</p>
                  }
                  @if (record.amountPaise !== undefined) {
                    <small>{{ money(record.amountPaise) }}</small>
                  }
                  @if (record.date) {
                    <small>{{ record.date }}</small>
                  }
                  @if (record.route) {
                    <ion-button fill="outline" class="secondary-button record-action" [routerLink]="record.route">
                      Open section
                    </ion-button>
                  }
                  @if (slug() === "invoices" && record.key && record.status !== "paid" && !record.demo) {
                    <ion-button fill="outline" class="secondary-button record-action" (click)="createPaymentLink(record.key)">
                      Create payment link
                    </ion-button>
                  }
                </article>
              }
            </section>
          }

          @if (slug() === "support" && supportHistoryLoading()) {
            <section class="premium-card state-card" role="status"><h2>Loading support requests</h2></section>
          }
          @if (slug() === "support" && supportHistoryError()) {
            <section class="premium-card state-card error" role="alert">
              <h2>Could not load support requests</h2>
              <p>{{ supportHistoryError() }}</p>
              <ion-button class="primary-gradient" (click)="loadSupportHistory()">Retry</ion-button>
            </section>
          }

          @if (actionMessage()) {
            <section class="premium-card state-card">
              <h2>Updated</h2>
              <p class="muted">{{ actionMessage() }}</p>
            </section>
          }

          <section class="premium-card state-card">
            <ion-icon [name]="config().icon"></ion-icon>
            <div>
              <h2>{{ stateTitle() }}</h2>
              <p class="muted">{{ stateCopy() }}</p>
            </div>
          </section>
        }
        }
      </main>
    </ion-content>
  `,
  styles: [`
    .hub-page {
      display: grid;
      gap: 18px;
    }

    .hub-hero {
      min-height: 330px;
      display: grid;
      align-content: end;
      gap: 12px;
      padding: 26px;
      border-radius: var(--radius-xl);
      color: #ffffff;
      background: linear-gradient(135deg, var(--primary), var(--primary-2), var(--accent));
      box-shadow: var(--shadow-card);
    }

    .hero-icon {
      width: 64px;
      height: 64px;
      display: grid;
      place-items: center;
      border: 1px solid rgba(255, 255, 255, 0.42);
      border-radius: 22px;
      background: rgba(255, 255, 255, 0.18);
      font-size: 1.8rem;
      backdrop-filter: blur(18px);
    }

    .hub-hero p,
    .hub-hero h1,
    .hub-hero span {
      margin: 0;
    }

    .hub-hero p {
      color: rgba(255, 255, 255, 0.76);
      font-size: 0.78rem;
      font-weight: 900;
      letter-spacing: 0.12em;
      text-transform: uppercase;
    }

    .hub-hero h1 {
      max-width: 760px;
      color: #1E1306;
      font-size: clamp(2.35rem, 6.5vw, 4.55rem);
      font-weight: 900;
      letter-spacing: 0;
      line-height: 1;
    }

    .hub-hero span {
      max-width: 650px;
      color: rgba(255, 255, 255, 0.92);
      font-weight: 800;
      line-height: 1.55;
    }

    .hero-actions {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
      margin-top: 8px;
    }

    .metric-grid {
      display: grid;
      gap: 12px;
    }

    .hub-grid {
      display: grid;
      gap: 12px;
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }

    .hub-tile {
      display: grid;
      gap: 7px;
      min-height: 132px;
      padding: 16px;
      color: inherit;
      text-decoration: none;
    }

    .hub-tile.active {
      color: #FFFFFF;
      border-color: transparent;
      background: linear-gradient(135deg, var(--brand-600), var(--primary) 58%, var(--brand-800));
      box-shadow: 0 18px 44px rgba(11, 70, 120, 0.24);
    }

    .hub-tile ion-icon {
      width: 44px;
      height: 44px;
      padding: 11px;
      border-radius: 16px;
      color: #FFFFFF;
      background: linear-gradient(135deg, var(--brand-600), var(--primary));
    }

    .hub-tile.active ion-icon {
      color: var(--primary);
      background: rgba(255, 255, 255, 0.68);
    }

    .hub-tile small {
      color: inherit;
      opacity: 0.72;
      font-weight: 800;
      line-height: 1.35;
    }

    .records-grid {
      display: grid;
      gap: 12px;
    }

    .metric-card,
    .record-card {
      display: grid;
      gap: 5px;
      padding: 16px;
      min-width: 0;
    }

    .record-label-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      min-width: 0;
    }

    .metric-card {
      align-content: start;
      min-height: 112px;
      overflow: hidden;
    }

    .metric-card span,
    .record-card span {
      color: var(--muted);
      font-size: 0.78rem;
      font-weight: 900;
      letter-spacing: 0.08em;
      text-transform: uppercase;
    }

    .metric-card strong,
    .record-card strong {
      display: block;
      min-width: 0;
      color: var(--text);
      font-size: clamp(1.4rem, 4vw, 2.2rem);
      letter-spacing: 0;
      line-height: 1.06;
      overflow-wrap: anywhere;
      word-break: break-word;
    }

    .customer-metric strong {
      font-size: clamp(1.25rem, 2.6vw, 1.85rem);
      line-height: 1.08;
    }

    .count-metric strong {
      white-space: nowrap;
    }

    .metric-card small,
    .record-card small,
    .state-card p {
      color: var(--muted);
      font-size: 0.78rem;
      font-weight: 800;
      line-height: 1.4;
    }

    .demo-chip {
      width: fit-content;
      padding: 4px 9px;
      border: 1px solid rgba(11, 70, 120, 0.32);
      border-radius: 999px;
      color: #8A5B08;
      background: rgba(246, 217, 148, 0.34);
      font-size: 0.68rem;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      white-space: nowrap;
    }

    .record-copy {
      margin: 0;
      color: var(--muted);
      font-size: 0.9rem;
      font-weight: 700;
      line-height: 1.42;
    }

    .record-action {
      width: fit-content;
      margin-top: 4px;
    }

    .state-card {
      display: grid;
      grid-template-columns: auto minmax(0, 1fr);
      align-items: center;
      gap: 12px;
      padding: 20px;
    }

    .state-card h2 {
      font-size: clamp(1.25rem, 3vw, 1.55rem);
      line-height: 1.12;
    }

    .action-card {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 14px;
      padding: 18px;
    }

    .action-card h2,
    .action-card p {
      margin: 0;
    }

    .state-card ion-icon {
      color: var(--primary-2);
      font-size: 1.8rem;
    }

    .state-card h2,
    .state-card p {
      margin: 0;
    }

    .state-card.error p {
      color: var(--danger);
    }

    .wallet-screen {
      display: grid;
      gap: clamp(18px, 3vw, 28px);
      color: var(--text);
    }

    .wallet-heading {
      display: flex;
      align-items: end;
      justify-content: space-between;
      gap: 20px;
      padding: 4px 2px 0;
    }

    .wallet-heading p,
    .wallet-heading h1 {
      margin: 0;
    }

    .wallet-eyebrow,
    .wallet-section-kicker {
      color: var(--primary);
      font-size: 0.72rem;
      font-weight: 900;
      letter-spacing: 0.12em;
      text-transform: uppercase;
    }

    .wallet-heading h1 {
      margin-top: 5px;
      color: var(--brand-950);
      font-size: clamp(2.35rem, 7vw, 4.4rem);
      font-weight: 900;
      letter-spacing: -0.055em;
      line-height: 0.95;
    }

    .wallet-title-row {
      position: relative;
      display: flex;
      align-items: center;
      gap: 10px;
      margin-top: 0;
      margin-left: 30px;
    }

    .wallet-title-row h1 {
      margin-top: 0;
    }

    .wallet-heading .wallet-eyebrow {
      margin-left: 30px;
      line-height: 1;
    }

    .content-back-button {
      position: absolute;
      left: -44px;
      top: -21px;
      width: 38px;
      height: 38px;
      min-width: 38px;
      --color: var(--brand-950);
      --icon-font-size: 25px;
      --background: transparent;
      --border-radius: 12px;
      --padding-start: 0;
      --padding-end: 0;
      filter: drop-shadow(0.45px 0 0 var(--brand-950));
    }

    .wallet-heading .wallet-intro {
      max-width: 580px;
      margin-top: 10px;
      color: var(--muted);
      font-size: clamp(0.95rem, 2vw, 1.06rem);
      line-height: 1.55;
    }

    .wallet-header-link,
    .wallet-help-link {
      min-height: 44px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 7px;
      color: var(--primary);
      font-size: 0.88rem;
      font-weight: 850;
      text-decoration: none;
    }

    .wallet-header-link ion-icon,
    .wallet-help-link ion-icon,
    .wallet-empty a ion-icon {
      flex: 0 0 auto;
      font-size: 1rem;
      transition: transform var(--motion-fast);
    }

    .wallet-header-receipt {
      display: none;
    }

    .wallet-balance-card {
      position: relative;
      isolation: isolate;
      overflow: hidden;
      display: grid;
      gap: 28px;
      padding: clamp(22px, 4vw, 38px);
      border: 1px solid rgba(255, 255, 255, 0.12);
      border-radius: clamp(22px, 4vw, 32px);
      color: #FFFFFF;
      background: var(--brand-900);
      box-shadow: 0 24px 54px rgba(6, 23, 43, 0.2);
    }

    .wallet-balance-card::after {
      position: absolute;
      z-index: -1;
      top: -90px;
      right: -55px;
      width: 250px;
      height: 250px;
      border: 44px solid rgba(255, 255, 255, 0.045);
      border-radius: 50%;
      content: "";
      pointer-events: none;
    }

    .wallet-balance-copy {
      min-width: 0;
    }

    .wallet-status-row {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      margin-bottom: clamp(24px, 5vw, 42px);
    }

    .wallet-status,
    .wallet-secure {
      display: inline-flex;
      align-items: center;
      gap: 7px;
      color: rgba(255, 255, 255, 0.78);
      font-size: 0.78rem;
      font-weight: 800;
    }

    .wallet-status > span {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: #5EE2A0;
      box-shadow: 0 0 0 4px rgba(94, 226, 160, 0.12);
    }

    .wallet-secure ion-icon {
      font-size: 1rem;
    }

    .wallet-balance-copy > p,
    .wallet-balance-copy > small {
      margin: 0;
      color: rgba(255, 255, 255, 0.68);
      font-weight: 750;
    }

    .wallet-balance-copy > p {
      font-size: 0.84rem;
      letter-spacing: 0.025em;
    }

    .wallet-balance-copy > strong {
      display: block;
      margin: 7px 0 10px;
      color: #FFFFFF;
      font-size: clamp(2.65rem, 8vw, 5.4rem);
      font-weight: 850;
      letter-spacing: -0.065em;
      line-height: 0.95;
      overflow-wrap: anywhere;
    }

    .wallet-balance-copy > small {
      display: block;
      font-size: 0.78rem;
      line-height: 1.45;
    }

    .wallet-actions {
      display: flex;
      flex-wrap: wrap;
      align-items: end;
      gap: 10px;
    }

    .wallet-action {
      min-height: 48px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      padding: 0 17px;
      border: 1px solid transparent;
      border-radius: 999px;
      font-size: 0.88rem;
      font-weight: 850;
      text-decoration: none;
      transition: background var(--motion-fast), border-color var(--motion-fast), color var(--motion-fast), transform var(--motion-fast);
    }

    .wallet-action ion-icon {
      font-size: 1rem;
    }

    .wallet-action-primary {
      color: var(--brand-950);
      background: #FFFFFF;
    }

    .wallet-action-secondary {
      color: #FFFFFF;
      border-color: rgba(255, 255, 255, 0.28);
      background: rgba(255, 255, 255, 0.06);
    }

    .wallet-content-grid {
      display: grid;
      gap: 16px;
      align-items: start;
      min-width: 0;
    }

    .wallet-activity,
    .wallet-guide,
    .wallet-state,
    .wallet-list-skeleton,
    .wallet-guide-skeleton {
      min-width: 0;
      border: 1px solid var(--border);
      border-radius: var(--radius-lg);
      background: #FFFFFF;
      box-shadow: 0 14px 36px rgba(6, 23, 43, 0.08);
    }

    .wallet-activity {
      overflow: hidden;
    }

    .wallet-section-heading {
      display: flex;
      align-items: end;
      justify-content: space-between;
      gap: 16px;
      padding: clamp(18px, 3vw, 26px);
      border-bottom: 1px solid var(--border);
    }

    .wallet-section-heading p,
    .wallet-section-heading h2,
    .wallet-guide > p,
    .wallet-guide > h2 {
      margin: 0;
    }

    .wallet-section-heading h2,
    .wallet-guide > h2 {
      margin-top: 4px;
      color: var(--brand-950);
      font-size: clamp(1.25rem, 3vw, 1.65rem);
      font-weight: 900;
      letter-spacing: -0.035em;
      line-height: 1.1;
    }

    .wallet-section-heading > span {
      flex: 0 0 auto;
      color: var(--muted);
      font-size: 0.76rem;
      font-weight: 800;
    }

    .wallet-transactions {
      display: grid;
    }

    .wallet-transaction {
      min-width: 0;
      display: grid;
      grid-template-columns: 44px minmax(0, 1fr);
      align-items: center;
      gap: 12px;
      padding: 17px clamp(16px, 3vw, 26px);
    }

    .wallet-transaction + .wallet-transaction {
      border-top: 1px solid rgba(203, 213, 225, 0.74);
    }

    .transaction-icon {
      width: 44px;
      height: 44px;
      display: grid;
      place-items: center;
      border-radius: 14px;
      color: #087443;
      background: #E8F8F0;
      font-size: 1.12rem;
    }

    .transaction-icon.transaction-debit {
      color: var(--brand-700);
      background: var(--primary-soft);
    }

    .transaction-copy,
    .transaction-value {
      min-width: 0;
      display: grid;
      gap: 3px;
    }

    .transaction-copy strong,
    .transaction-value strong {
      color: var(--text);
      font-size: 0.9rem;
      font-weight: 850;
      line-height: 1.25;
      overflow-wrap: anywhere;
    }

    .transaction-copy span,
    .transaction-copy small,
    .transaction-value small {
      color: var(--muted);
      font-size: 0.73rem;
      font-weight: 700;
      line-height: 1.35;
      overflow-wrap: anywhere;
    }

    .transaction-value {
      grid-column: 2;
      justify-items: start;
    }

    .transaction-value strong {
      color: #087443;
      white-space: nowrap;
    }

    .transaction-value.transaction-value-debit strong {
      color: var(--text);
    }

    .wallet-guide {
      padding: clamp(20px, 3vw, 26px);
    }

    .wallet-guide-list {
      display: grid;
      margin-top: 22px;
    }

    .wallet-guide-list > div {
      display: grid;
      grid-template-columns: 34px minmax(0, 1fr);
      gap: 12px;
      padding: 15px 0;
      border-top: 1px solid var(--border);
    }

    .guide-number {
      color: var(--primary);
      font-size: 0.72rem;
      font-weight: 900;
      letter-spacing: 0.06em;
    }

    .wallet-guide-list p,
    .wallet-guide-list strong,
    .wallet-guide-list small {
      margin: 0;
    }

    .wallet-guide-list p {
      display: grid;
      gap: 4px;
    }

    .wallet-guide-list strong {
      color: var(--text);
      font-size: 0.9rem;
      font-weight: 850;
    }

    .wallet-guide-list small {
      color: var(--muted);
      font-size: 0.78rem;
      line-height: 1.45;
    }

    .wallet-help-link {
      justify-content: space-between;
      width: 100%;
      margin-top: 6px;
      padding-top: 10px;
      border-top: 1px solid var(--border);
    }

    .wallet-empty,
    .wallet-state {
      display: grid;
      justify-items: start;
    }

    .wallet-empty {
      padding: clamp(28px, 6vw, 54px) clamp(18px, 4vw, 30px);
    }

    .wallet-state {
      justify-items: center;
      padding: clamp(32px, 7vw, 68px) clamp(20px, 5vw, 40px);
      text-align: center;
    }

    .wallet-state-icon {
      width: 52px;
      height: 52px;
      display: grid;
      place-items: center;
      border-radius: 17px;
      color: var(--primary);
      background: var(--primary-soft);
      font-size: 1.35rem;
    }

    .wallet-empty h3,
    .wallet-empty p,
    .wallet-state h2,
    .wallet-state p {
      margin: 0;
    }

    .wallet-empty h3,
    .wallet-state h2 {
      margin-top: 17px;
      color: var(--brand-950);
      font-size: clamp(1.2rem, 3vw, 1.55rem);
      font-weight: 900;
      letter-spacing: -0.03em;
    }

    .wallet-empty p,
    .wallet-state p {
      max-width: 520px;
      margin-top: 7px;
      color: var(--muted);
      font-size: 0.88rem;
      line-height: 1.55;
    }

    .wallet-empty a {
      min-height: 44px;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      margin-top: 12px;
      color: var(--primary);
      font-size: 0.86rem;
      font-weight: 850;
      text-decoration: none;
    }

    .wallet-state ion-button {
      margin-top: 18px;
    }

    .wallet-error .wallet-state-icon {
      color: #B42318;
      background: #FEECE9;
    }

    .wallet-loading {
      display: grid;
      gap: 16px;
    }

    .wallet-balance-skeleton {
      min-height: 300px;
      border-radius: clamp(22px, 4vw, 32px);
    }

    .wallet-list-skeleton {
      display: grid;
      gap: 18px;
      padding: 24px;
    }

    .wallet-guide-skeleton {
      min-height: 300px;
    }

    .skeleton-block,
    .skeleton-line,
    .skeleton-circle {
      background: #E8EEF4;
      animation: wallet-skeleton 1.4s ease-in-out infinite;
    }

    .skeleton-line {
      width: 56%;
      height: 12px;
      border-radius: 999px;
    }

    .skeleton-title {
      width: 42%;
      height: 20px;
    }

    .skeleton-transaction {
      display: grid;
      grid-template-columns: 44px minmax(0, 1fr) minmax(60px, 0.25fr);
      align-items: center;
      gap: 12px;
    }

    .skeleton-circle {
      width: 44px;
      height: 44px;
      border-radius: 14px;
    }

    .skeleton-transaction .skeleton-line {
      width: 72%;
    }

    .skeleton-transaction .skeleton-amount {
      width: 100%;
    }

    .sr-only {
      position: absolute;
      width: 1px;
      height: 1px;
      padding: 0;
      margin: -1px;
      overflow: hidden;
      clip: rect(0, 0, 0, 0);
      white-space: nowrap;
      border: 0;
    }

    @keyframes wallet-skeleton {
      0%, 100% { opacity: 0.58; }
      50% { opacity: 1; }
    }

    @media (hover: hover) and (pointer: fine) {
      .wallet-header-link:hover ion-icon,
      .wallet-help-link:hover ion-icon,
      .wallet-empty a:hover ion-icon {
        transform: translateX(3px);
      }

      .wallet-action-primary:hover {
        background: #EAF2F8;
      }

      .wallet-action-secondary:hover {
        border-color: rgba(255, 255, 255, 0.48);
        background: rgba(255, 255, 255, 0.12);
      }
    }

    .invoice-amount-group {
      grid-column: 2;
      display: flex;
      align-items: center;
      gap: 6px;
    }

    .invoice-pay-button {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 5px;
      width: 44px;
      height: 44px;
      flex: 0 0 44px;
      border: 1px solid var(--border-strong);
      border-radius: 999px;
      color: var(--primary);
      background: var(--surface);
      font-size: 0.78rem;
      font-weight: 850;
      cursor: pointer;
    }

    .invoice-pay-button:disabled {
      opacity: 0.55;
      cursor: not-allowed;
    }

    .invoice-pay-button ion-icon {
      font-size: 1rem;
    }

    .invoice-due-label {
      color: #B42318;
    }

    .text-danger {
      color: #B42318;
    }

    .invoice-due .transaction-icon {
      color: #B42318;
      background: #FEECE9;
    }

    .booking-support {
      width: min(100%, 680px);
      display: grid;
      gap: 14px;
      margin-inline: auto;
    }

    .support-heading {
      display: grid;
      grid-template-columns: auto minmax(0, 1fr);
      align-items: center;
      gap: 14px;
      padding: 18px;
      border-radius: var(--radius-lg);
      color: #FFFFFF;
      background: linear-gradient(145deg, var(--brand-900), var(--brand-800));
      box-shadow: 0 14px 34px rgba(6, 23, 43, 0.15);
    }

    .support-heading .hero-icon { width: 52px; height: 52px; border-radius: 18px; font-size: 1.4rem; }
    .support-heading h1, .support-heading p, .support-heading span { margin: 0; color: #FFFFFF; }
    .support-heading h1 { font-size: clamp(1.45rem, 6vw, 2rem); letter-spacing: -0.04em; line-height: 1.08; }
    .support-heading span { display: block; margin-top: 4px; color: rgba(255, 255, 255, 0.78); font-size: 0.86rem; line-height: 1.4; }
    .support-heading .support-eyebrow { margin-bottom: 4px; color: rgba(255, 255, 255, 0.82); font-size: 0.72rem; font-weight: 850; letter-spacing: 0.06em; text-transform: uppercase; }
    .support-status { display: grid; gap: 12px; }
    .support-panel, .support-form {
      padding: 18px;
      border: 1px solid var(--border);
      border-radius: var(--radius-md);
      background: var(--surface);
      box-shadow: var(--shadow-soft);
    }
    .support-panel h2, .support-panel p { margin: 0; }
    .support-panel h2 { font-size: 1.2rem; letter-spacing: -0.025em; }
    .support-panel p { margin-top: 7px; color: var(--muted); line-height: 1.5; }
    .support-error { border-color: rgba(180, 35, 24, 0.28); }
    .support-inline-actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 14px; }
    .support-inline-actions ion-button { min-height: 44px; margin: 0; text-transform: none; }
    .support-success { display: grid; gap: 12px; }
    .support-success dl { display: grid; gap: 8px; margin: 0; }
    .support-success dl div { display: grid; grid-template-columns: 80px minmax(0, 1fr); gap: 10px; }
    .support-success dt { color: var(--muted); font-size: 0.8rem; font-weight: 800; }
    .support-success dd { margin: 0; overflow-wrap: anywhere; }
    .support-booking-card {
      overflow: hidden;
      border: 1px solid rgba(11, 47, 85, 0.24);
      border-radius: var(--radius-md);
      color: #FFFFFF;
      background: var(--brand-900);
      box-shadow: 0 14px 34px rgba(6, 23, 43, 0.14);
    }
    .support-booking-card > div { padding: 15px 16px 12px; }
    .support-booking-card h2 { margin: 9px 0 3px; color: #FFFFFF; font-size: 1.25rem; letter-spacing: -0.035em; overflow-wrap: anywhere; }
    .support-booking-card p { margin: 0; color: rgba(255, 255, 255, 0.78); overflow-wrap: anywhere; }
    .support-booking-card dl { display: grid; margin: 0; background: rgba(11, 70, 120, 0.36); }
    .support-booking-card dl div { min-width: 0; padding: 11px 16px; border-top: 1px solid rgba(255, 255, 255, 0.1); }
    .support-booking-card dt { color: rgba(255, 255, 255, 0.8); font-size: 0.72rem; font-weight: 800; }
    .support-booking-card dd { margin: 3px 0 0; color: #FFFFFF; font-size: 0.88rem; font-weight: 750; overflow-wrap: anywhere; }
    .support-booking-card .status-pill { color: var(--brand-900); background: #FFFFFF; text-transform: capitalize; }
    .support-booking-card .status-pill.closed { color: var(--muted); background: var(--surface-soft); }
    .support-form { display: grid; gap: 15px; }
    .field-group { min-width: 0; display: grid; gap: 7px; }
    .field-group label { color: var(--text); font-size: 0.84rem; font-weight: 850; }
    .field-label-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
    .field-label-row span { color: var(--muted); font-size: 0.75rem; font-weight: 750; }
    .field-group select, .field-group textarea {
      width: 100%;
      min-width: 0;
      min-height: 44px;
      padding: 11px 12px;
      border: 1px solid var(--border-strong);
      border-radius: var(--radius-sm);
      color: var(--text);
      background: var(--surface);
      font: inherit;
      line-height: 1.4;
    }
    .field-group textarea { min-height: 132px; resize: vertical; }
    .field-group select:focus-visible, .field-group textarea:focus-visible { outline: 3px solid var(--focus); outline-offset: 2px; border-color: var(--focus); }
    .support-field-grid { display: grid; gap: 12px; }
    .support-form ion-button { min-height: 46px; margin: 0; text-transform: none; }
    .form-error { margin: -3px 0 0; color: #B42318; font-size: 0.84rem; font-weight: 750; line-height: 1.4; }
    .support-live { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0; }

    @media (max-width: 599px) {
      .wallet-hub-page {
        padding-top: calc(14px + env(safe-area-inset-top));
      }

      .wallet-screen {
        gap: 10px;
      }

      .wallet-heading {
        align-items: start;
        gap: 10px;
        padding-top: 0;
      }

      .wallet-eyebrow,
      .wallet-section-kicker {
        font-size: 0.62rem;
      }

      .wallet-heading h1 {
        margin-top: 3px;
        font-size: 1.55rem;
        line-height: 1;
      }

      .wallet-heading .wallet-intro {
        margin-top: 5px;
        font-size: 0.72rem;
        line-height: 1.35;
      }

      .wallet-header-link {
        width: 40px;
        height: 40px;
        min-height: 40px;
        flex: 0 0 40px;
        border: 1px solid var(--border);
        border-radius: 12px;
        background: #FFFFFF;
      }

      .wallet-header-link span {
        position: absolute;
        width: 1px;
        height: 1px;
        overflow: hidden;
        clip: rect(0, 0, 0, 0);
      }

      .wallet-header-receipt {
        display: block;
        font-size: 1.05rem;
      }

      .wallet-header-chevron {
        display: none;
      }

      .wallet-status-row {
        margin-bottom: 12px;
        gap: 8px;
      }

      .wallet-status,
      .wallet-secure {
        font-size: 0.67rem;
      }

      .wallet-balance-card {
        gap: 12px;
        padding: 14px;
        border-radius: 19px;
      }

      .wallet-balance-copy > strong {
        margin-block: 3px 0;
        font-size: 2rem;
      }

      .wallet-balance-copy > p {
        font-size: 0.7rem;
      }

      .wallet-balance-copy > small {
        display: none;
      }

      .wallet-actions {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        width: 100%;
        gap: 8px;
      }

      .wallet-action {
        min-height: 38px;
        padding-inline: 7px;
        font-size: 0.68rem;
        white-space: nowrap;
      }

      .wallet-section-heading {
        padding: 12px 14px;
      }

      .wallet-section-heading h2,
      .wallet-guide > h2 {
        font-size: 1rem;
      }

      .wallet-transaction {
        grid-template-columns: 38px minmax(0, 1fr);
        gap: 10px;
        padding: 13px 15px;
      }

      .transaction-icon {
        width: 38px;
        height: 38px;
        border-radius: 12px;
      }

      .transaction-copy strong,
      .transaction-value strong {
        font-size: 0.8rem;
      }

      .transaction-copy span,
      .transaction-copy small,
      .transaction-value small {
        font-size: 0.65rem;
      }

      .wallet-guide {
        padding: 14px;
      }

      .wallet-guide-list {
        margin-top: 10px;
      }

      .wallet-guide-list > div {
        grid-template-columns: 28px minmax(0, 1fr);
        gap: 8px;
        padding: 8px 0;
      }

      .wallet-guide-list strong {
        font-size: 0.78rem;
      }

      .wallet-guide-list small {
        font-size: 0.66rem;
        line-height: 1.35;
      }

      .wallet-empty,
      .wallet-state {
        padding: 20px 16px;
      }

      .wallet-empty .wallet-state-icon,
      .wallet-state .wallet-state-icon {
        width: 42px;
        height: 42px;
        border-radius: 13px;
        font-size: 1.1rem;
      }

      .wallet-empty h3,
      .wallet-state h2 {
        margin-top: 11px;
        font-size: 1rem;
      }

      .wallet-empty p,
      .wallet-state p {
        margin-top: 5px;
        font-size: 0.74rem;
        line-height: 1.4;
      }

      .wallet-empty a {
        min-height: 38px;
        margin-top: 6px;
        font-size: 0.74rem;
      }

      .wallet-help-link {
        min-height: 38px;
        padding-top: 6px;
        font-size: 0.74rem;
      }

      .hub-hero {
        min-height: 310px;
        padding: 22px;
      }

      .hub-hero h1 {
        font-size: clamp(2.15rem, 12vw, 3.25rem);
      }

      .hero-actions ion-button {
        width: 100%;
      }

      .action-card {
        display: grid;
      }

      .invoice-amount-group {
        gap: 4px;
      }

      .invoice-pay-button {
        width: 38px;
        height: 38px;
        flex: 0 0 38px;
        font-size: 0.7rem;
      }
    }

    @media (min-width: 768px) {
      .wallet-balance-card {
        grid-template-columns: minmax(0, 1fr) auto;
        align-items: end;
      }

      .wallet-transaction {
        grid-template-columns: 44px minmax(0, 1fr) auto;
      }

      .transaction-value {
        grid-column: auto;
        justify-items: end;
        text-align: right;
      }

      .hub-grid {
        grid-template-columns: repeat(4, minmax(0, 1fr));
      }

      .metric-grid {
        grid-template-columns: repeat(3, minmax(0, 1fr));
      }

      .records-grid {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }

      .support-booking-card dl, .support-field-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .support-booking-card dl div + div { border-left: 1px solid rgba(255, 255, 255, 0.1); }
    }

    @media (max-width: 1023px) {
      .metric-grid {
        grid-template-columns: 1fr;
      }

      .metric-card {
        min-height: 96px;
      }
    }

    @media (min-width: 1024px) {
      .wallet-content-grid {
        grid-template-columns: minmax(0, 1.75fr) minmax(280px, 0.75fr);
      }

      .wallet-guide {
        position: sticky;
        top: calc(var(--page-top) + 8px);
      }
    }

    @media (prefers-reduced-motion: reduce) {
      .booking-support, .support-panel, .support-form, .support-booking-card, .skeleton-block, .skeleton-line, .skeleton-circle { animation: none; transition: none; }
    }
  `]
})
export class CustomerHubPage implements OnInit {
  readonly slug = computed(() => this.route.snapshot.data["hub"] as string || "rewards");
  readonly walletMode = computed(() => this.slug() === "wallet");
  readonly invoicesMode = computed(() => this.slug() === "invoices");
  readonly paymentsMode = computed(() => this.slug() === "payments");
  readonly hubBackHref = computed(() => (this.marketplace.salonMode() ? "/tabs/my-salon" : "/tabs/profile"));
  readonly rewardsMode = computed(() => this.slug() === "rewards");
  readonly membershipsMode = computed(() => this.slug() === "memberships");
  readonly packagesMode = computed(() => this.slug() === "packages");
  readonly familyMode = computed(() => this.slug() === "family");
  readonly referralsMode = computed(() => this.slug() === "referrals");
  readonly giftCardsMode = computed(() => this.slug() === "gift-cards");
  readonly corporateMode = computed(() => this.slug() === "corporate");
  readonly goalsMode = computed(() => this.slug() === "goals");
  readonly bookingSupportMode = computed(() => this.slug() === "support" && this.route.snapshot.queryParamMap.get("mode") === "booking" && !!this.route.snapshot.queryParamMap.get("bookingId"));
  readonly config = computed(() => hubConfigs[this.slug()] ?? hubConfigs["rewards"]);
  readonly customerName = computed(() => this.marketplace.customer()?.name || "Customer");
  readonly wallet = computed<CustomerWallet | null>(() => {
    const data = this.marketplace.accountModule();
    return data && this.isWallet(data) ? data : null;
  });
  readonly invoices = computed<CustomerInvoice[]>(() => {
    const data = this.marketplace.accountModule();
    if (Array.isArray(data) && data.length && typeof data[0] === "object" && "invoiceNumber" in data[0]) return data as CustomerInvoice[];
    return [];
  });
  readonly invoiceTotalOutstanding = computed(() => this.invoices().reduce((sum, inv) => sum + (inv.balancePaise || 0), 0));
  readonly invoiceDueCount = computed(() => this.invoices().filter((inv) => inv.balancePaise > 0).length);
  readonly paymentsList = computed<CustomerPayment[]>(() => {
    const data = this.marketplace.accountModule();
    if (Array.isArray(data) && data.length && typeof data[0] === "object" && "invoiceId" in data[0] && "amountPaise" in data[0]) return data as CustomerPayment[];
    return [];
  });
  readonly paymentTotalPaid = computed(() => this.paymentsList().reduce((sum, payment) => sum + (Number(payment.amountPaise) || 0), 0));
  readonly paymentLatest = computed<CustomerPayment | null>(() =>
    this.paymentsList().reduce<CustomerPayment | null>(
      (latest, payment) => !latest || this.paymentDateValue(payment.createdAt) > this.paymentDateValue(latest.createdAt) ? payment : latest,
      null
    )
  );
  readonly rewardsData = computed<CustomerRewardSummary | null>(() => {
    const data = this.marketplace.accountModule();
    return data && this.isRewards(data) ? data : null;
  });
  readonly membershipsList = computed<CustomerMembership[]>(() => {
    const data = this.marketplace.accountModule();
    if (Array.isArray(data) && data.length && typeof data[0] === "object" && "planName" in data[0]) return data as CustomerMembership[];
    return [];
  });
  readonly packagesList = computed<CustomerPackage[]>(() => {
    const data = this.marketplace.accountModule();
    if (Array.isArray(data) && data.length && typeof data[0] === "object" && "name" in data[0] && "pricePaise" in data[0] && !("planName" in data[0])) return data as CustomerPackage[];
    return [];
  });
  readonly giftCardsList = computed<CustomerGiftCard[]>(() => {
    const data = this.marketplace.accountModule();
    if (Array.isArray(data) && data.length && typeof data[0] === "object" && "initialValuePaise" in data[0]) return data as CustomerGiftCard[];
    return [];
  });
  readonly liveRecords = computed(() => this.recordsFor(this.marketplace.accountModule()));
  readonly supportTickets = signal<CustomerBookingSupportTicket[]>([]);
  readonly supportHistoryLoading = signal(false);
  readonly supportHistoryError = signal("");
  readonly supportRecords = computed<HubRecord[]>(() => this.supportTickets().map((ticket) => ({
    key: ticket.id,
    status: ticket.status,
    title: this.supportCategoryLabel(ticket.category),
    description: ticket.message,
    date: this.supportTicketDate(ticket.updatedAt || ticket.createdAt),
    route: ticket.bookingId ? `/bookings/${ticket.bookingId}` : undefined
  })));
  readonly demoMode = computed(() => this.slug() !== "support" && this.marketplace.isAuthenticated() && !this.marketplace.loading() && this.liveRecords().length === 0);
  readonly records = computed(() => {
    if (this.slug() === "support") return this.supportRecords();
    const live = this.liveRecords();
    if (live.length) return live;
    if (!this.marketplace.isAuthenticated() || this.marketplace.loading()) return [];
    return this.demoRecordsFor(this.slug());
  });
  readonly recordCount = computed(() => this.records().length);
  readonly actionMessage = signal("");
  readonly actionLoading = signal(false);
  readonly supportBooking = signal<Booking | null>(null);
  readonly supportTicket = signal<CustomerBookingSupportTicket | null>(null);
  readonly supportLoading = signal(false);
  readonly supportSubmitting = signal(false);
  readonly supportLoadError = signal("");
  readonly supportSubmitError = signal("");
  supportCategory: CustomerBookingSupportCategory = "other";
  supportMessage = "";
  preferredContact: CustomerBookingSupportPreferredContact = "in_app";
  supportPriority: CustomerBookingSupportPriority = "medium";
  readonly supportCategories: { value: CustomerBookingSupportCategory; label: string }[] = [
    { value: "reschedule", label: "Edit appointment" },
    { value: "cancellation", label: "Cancellation" },
    { value: "payment", label: "Payment" },
    { value: "salon_unavailable", label: "Salon unavailable" },
    { value: "other", label: "Other" }
  ];
  readonly hubModules = [
    { slug: "rewards", label: "Rewards", copy: "Points, tier and booking rewards.", icon: "ribbon-outline", route: "/tabs/rewards" },
    { slug: "wallet", label: "Wallet", copy: "Credits, refunds and invoice payments.", icon: "wallet-outline", route: "/tabs/wallet" },
    { slug: "memberships", label: "Memberships", copy: "Active plans and benefit usage.", icon: "heart-circle-outline", route: "/tabs/memberships" },
    { slug: "packages", label: "Packages", copy: "Sessions, balances and redemptions.", icon: "ticket-outline", route: "/tabs/packages" },
    { slug: "gift-cards", label: "Gift cards", copy: "Purchase, redeem and track balances.", icon: "gift-outline", route: "/tabs/gift-cards" },
    { slug: "support", label: "Support", copy: "Tickets, chat and booking help.", icon: "chatbubbles-outline", route: "/tabs/support" },
    { slug: "referrals", label: "Referrals", copy: "Invite friends and track rewards.", icon: "share-social-outline", route: "/tabs/referrals" },
    { slug: "gallery", label: "Gallery", copy: "Saved looks and before/after photos.", icon: "images-outline", route: "/tabs/gallery" },
    { slug: "family", label: "Family", copy: "Profiles for shared bookings.", icon: "people-outline", route: "/tabs/family" },
    { slug: "corporate", label: "Corporate", copy: "Workplace benefits and packages.", icon: "briefcase-outline", route: "/tabs/corporate" },
    { slug: "goals", label: "Beauty goals", copy: "Plans, routines and treatment goals.", icon: "color-palette-outline", route: "/tabs/goals" },
    { slug: "payments", label: "Payments", copy: "UPI, card and invoice payment records.", icon: "wallet-outline", route: "/tabs/payments" },
    { slug: "invoices", label: "Invoices", copy: "Bills, balances and payment status.", icon: "ticket-outline", route: "/tabs/invoices" },
    { slug: "notifications", label: "Notifications", copy: "Booking and account updates.", icon: "chatbubbles-outline", route: "/notifications" }
  ];

  constructor(private readonly route: ActivatedRoute, readonly marketplace: MarketplaceService, private readonly alerts: AlertController, private readonly api: CustomerApiService) {
    addIcons({
      arrowUndoOutline,
      briefcaseOutline,
      calendarOutline,
      cardOutline,
      cashOutline,
      chatbubblesOutline,
      chevronForwardOutline,
      colorPaletteOutline,
      giftOutline,
      heartCircleOutline,
      imagesOutline,
      informationCircleOutline,
      linkOutline,
      peopleOutline,
      phonePortraitOutline,
      receiptOutline,
      ribbonOutline,
      searchOutline,
      shareSocialOutline,
      shieldCheckmarkOutline,
      ticketOutline,
      trendingDownOutline,
      trendingUpOutline,
      walletOutline
    });
  }

  ngOnInit() {
    this.reload();
  }

  reload() {
    if (this.bookingSupportMode()) {
      void this.loadBookingSupportContext();
      return;
    }
    if (!this.marketplace.isAuthenticated()) return;
    this.actionMessage.set("");
    void Promise.all([
      this.marketplace.loadCustomer(),
      this.marketplace.loadBookings(),
      this.marketplace.loadAccountModule(this.slug()),
      this.slug() === "support" ? this.loadSupportHistory() : Promise.resolve()
    ]).catch(() => undefined);
  }

  async loadSupportHistory() {
    if (!this.marketplace.isAuthenticated()) return;
    this.supportHistoryLoading.set(true);
    this.supportHistoryError.set("");
    try {
      this.supportTickets.set(await firstValueFrom(this.api.listCustomerSupportTickets({ limit: 20 })));
    } catch {
      this.supportHistoryError.set("Your support history could not be loaded. Please try again.");
    } finally {
      this.supportHistoryLoading.set(false);
    }
  }

  async loadBookingSupportContext() {
    const bookingId = this.route.snapshot.queryParamMap.get("bookingId");
    this.supportBooking.set(null);
    this.supportTicket.set(null);
    this.supportLoadError.set("");
    this.supportSubmitError.set("");
    if (!bookingId) {
      this.supportLoadError.set("We couldn't verify a booking for this support request. Please use general help instead.");
      return;
    }
    this.supportLoading.set(true);
    try {
      this.supportBooking.set(await this.marketplace.loadBooking(bookingId));
    } catch {
      this.supportLoadError.set("We couldn't verify this booking. Please retry or use general help.");
    } finally {
      this.supportLoading.set(false);
    }
  }

  supportFormValid(): boolean {
    const length = this.supportMessage.trim().length;
    return !!this.supportBooking() && length > 0 && length <= 1200;
  }

  async submitBookingSupport(event: Event) {
    event.preventDefault();
    const booking = this.supportBooking();
    if (!booking || !this.supportFormValid() || this.supportSubmitting()) return;
    this.supportSubmitting.set(true);
    this.supportSubmitError.set("");
    try {
      const ticket = await firstValueFrom(this.api.createBookingSupportTicket(booking.id, {
        category: this.supportCategory,
        message: this.supportMessage.trim(),
        preferredContact: this.preferredContact,
        priority: this.supportPriority
      }));
      this.supportTicket.set(ticket);
      this.supportTickets.update((items) => [ticket, ...items.filter((item) => item.id !== ticket.id)]);
    } catch {
      this.supportSubmitError.set("Your support request could not be sent. Review the details and try again.");
    } finally {
      this.supportSubmitting.set(false);
    }
  }

  supportCategoryLabel(category: CustomerBookingSupportCategory): string {
    return this.supportCategories.find((item) => item.value === category)?.label || "Booking support";
  }

  supportTicketDate(value: string): string {
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return value;
    return new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric" }).format(date);
  }

  supportAppointmentDisplay(): string {
    const booking = this.supportBooking();
    const raw = String(booking?.displayStartAt || booking?.startsAt || booking?.startAt || "");
    const date = raw ? new Date(raw) : null;
    if (!date || !Number.isFinite(date.getTime())) return raw;
    try {
      const day = new Intl.DateTimeFormat("en-IN", { weekday: "short", day: "numeric", month: "short" }).format(date);
      const time = new Intl.DateTimeFormat("en-IN", { hour: "numeric", minute: "2-digit", hour12: true }).format(date).toUpperCase();
      return `${day} · ${time}`;
    } catch {
      return raw;
    }
  }

  stateTitle(): string {
    if (this.demoMode()) return "Demo records ready for testing";
    if (this.recordCount() > 0) return "Live records loaded";
    if (this.slug() === "rewards") return "No reward history yet";
    return "No live records available";
  }

  stateCopy(): string {
    if (this.demoMode()) {
      return "The live API returned no records for this section, so local demo records are shown only for UI testing. Real customer records replace these automatically.";
    }
    if (this.recordCount() > 0) {
      return "These records are returned by the AuraSalon SaaS backend for your authenticated customer profile.";
    }
    if (this.slug() === "rewards") {
      return "Reward activity will update after completed bookings are returned by the backend.";
    }
    return "AuraSalon is showing only backend-owned records here. Data will appear after the matching SaaS endpoint returns customer-owned records.";
  }

  money(pricePaise: number): string {
    return this.marketplace.formatMoney(pricePaise);
  }

  walletTransactionAmount(amountPaise: number): number {
    return Math.abs(amountPaise);
  }

  walletTransactionIsCredit(transaction: CustomerWalletTransaction): boolean {
    if (transaction.amountPaise < 0) return false;
    return !/(?:debit|payment|paid|purchase|redeem|spend|charge|used)/i.test(transaction.type);
  }

  walletTransactionLabel(type: string): string {
    const label = type.replace(/[_-]+/g, " ").trim();
    return label ? label.replace(/\b\w/g, (character) => character.toUpperCase()) : "Wallet activity";
  }

  walletTransactionDescription(transaction: CustomerWalletTransaction): string {
    if (transaction.notes?.trim()) return transaction.notes.trim();
    if (transaction.referenceType && transaction.referenceId) {
      return `${this.walletTransactionLabel(transaction.referenceType)} · ${transaction.referenceId}`;
    }
    if (transaction.referenceId) return `Reference · ${transaction.referenceId}`;
    return "Wallet balance updated";
  }

  walletTransactionDate(value: string): string {
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return value;
    return new Intl.DateTimeFormat("en-IN", {
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12: true
    }).format(date);
  }

  async loadPlans() {
    await this.marketplace.loadMembershipPlans();
    if (!this.marketplace.membershipPlans().length) {
      this.actionMessage.set("No active membership plans are currently available for online purchase.");
    }
  }

  async buyPlan(plan: CustomerMembershipPlan) {
    await this.marketplace.buyMembership(plan.id, plan.branchId);
    this.actionMessage.set(`${plan.name} was added to your memberships as pending payment.`);
    await this.marketplace.loadAccountModule("memberships");
  }

  async purchaseGiftCard() {
    const alert = await this.alerts.create({
      header: "Gift card amount",
      inputs: [
        {
          name: "amount",
          type: "number",
          min: 100,
          placeholder: "Amount in rupees"
        }
      ],
      buttons: [
        { text: "Cancel", role: "cancel" },
        {
          text: "Create",
          handler: (data) => {
            const amountPaise = Math.round(Number(data.amount || 0) * 100);
            if (!Number.isInteger(amountPaise) || amountPaise <= 0) return false;
            void this.marketplace.purchaseGiftCard({ amountPaise }).then(() => {
              this.actionMessage.set("Gift card created as a pending payment record.");
              return this.marketplace.loadAccountModule("gift-cards");
            });
            return true;
          }
        }
      ]
    });
    await alert.present();
  }

  async createPaymentLink(invoiceId: string) {
    if (this.actionLoading()) return;
    this.actionLoading.set(true);
    try {
      const link = await this.marketplace.createInvoicePaymentLink(invoiceId);
      this.actionMessage.set(link.url || link.shortUrl ? `Payment link is ready: ${link.url || link.shortUrl}` : "Payment link created for this invoice.");
    } finally {
      this.actionLoading.set(false);
    }
  }

  invoiceDateLabel(value: string): string {
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return value;
    return new Intl.DateTimeFormat("en-IN", {
      day: "numeric",
      month: "short",
      year: "numeric"
    }).format(date);
  }

  paymentAmount(paise: number): string {
    const amount = Number(paise);
    return Number.isFinite(amount) ? this.money(amount) : "—";
  }

  paymentModeLabel(mode: string | null | undefined): string {
    const key = String(mode || "").toLowerCase();
    const labels: Record<string, string> = {
      upi: "UPI",
      card: "Card",
      netbanking: "Net banking",
      wallet: "Wallet",
      cash: "Cash",
      "payment_link": "Payment link",
      link: "Payment link",
      emi: "EMI"
    };
    if (labels[key]) return labels[key];
    if (!key) return "Payment";
    return key.replace(/[_-]+/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
  }

  paymentModeIcon(mode: string | null | undefined): string {
    const key = String(mode || "").toLowerCase();
    if (key === "cash") return "cash-outline";
    if (key === "upi" || key === "wallet") return "phone-portrait-outline";
    if (key === "link" || key === "payment_link") return "link-outline";
    return "card-outline";
  }

  paymentReferenceLabel(payment: CustomerPayment): string {
    if (payment.reference && String(payment.reference).trim()) return "Ref · " + String(payment.reference).trim();
    if (payment.invoiceNumber && String(payment.invoiceNumber).trim()) return "Invoice " + String(payment.invoiceNumber).trim();
    return "Payment recorded";
  }

  paymentDateLabel(value: string): string {
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return value;
    return new Intl.DateTimeFormat("en-IN", {
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit"
    }).format(date);
  }

  private paymentDateValue(value: string): number {
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? date.getTime() : 0;
  }

  paymentLatestLabel(): string {
    const latest = this.paymentLatest();
    return latest ? "Latest payment · " + this.paymentDateLabel(latest.createdAt) : "Payments appear here after each booking settlement";
  }

  private recordsFor(data: CustomerAccountModule | null): HubRecord[] {
    if (!data) return [];
    if (Array.isArray(data)) return data.map((record, index) => this.recordView(record as unknown as Record<string, unknown>, index));
    if (this.isWallet(data)) return data.transactions.map((record, index) => this.recordView(record as unknown as Record<string, unknown>, index));
    if (this.isRewards(data)) return data.history.map((record, index) => this.recordView(record as unknown as Record<string, unknown>, index));
    return [];
  }

  private recordView(record: Record<string, unknown>, index: number): HubRecord {
    const amount = record["amountPaise"] ?? record["balancePaise"] ?? record["pricePaise"] ?? record["totalPaise"];
    return {
      key: String(record["id"] || record["code"] || record["invoiceNumber"] || record["type"] || index),
      status: String(record["status"] || record["type"] || record["channel"] || "Live record"),
      title: String(record["planName"] || record["name"] || record["invoiceNumber"] || record["code"] || record["message"] || record["type"] || "Customer record"),
      amountPaise: amount === undefined ? undefined : Number(amount),
      date: String(record["createdAt"] || record["updatedAt"] || record["validityDate"] || record["expiryDate"] || "")
    };
  }

  private demoRecordsFor(slug: string): HubRecord[] {
    const route = hubConfigs[slug]?.route || "/tabs/hub";
    const record = (status: string, title: string, description: string, amountPaise?: number, date?: string): HubRecord => ({
      key: `demo-${slug}-${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
      status,
      title,
      description,
      amountPaise,
      date,
      route,
      demo: true
    });

    const records: Record<string, HubRecord[]> = {
      rewards: [
        record("Bronze tier", "150 loyalty points", "Points earned from completed bookings and referrals.", undefined, "Updated today"),
        record("Birthday bonus", "₹250 reward credit", "Unlocked automatically during the customer's birthday month.", 25000, "Expires 30 Jun 2026"),
        record("Referral bonus", "Invite reward pending", "Reward becomes active after the referred customer's first completed booking.", 15000, "Pending")
      ],
      wallet: [
        record("Available", "Wallet balance", "Usable for eligible bookings, add-ons and invoices.", 125000, "Synced today"),
        record("Refund", "Hair spa booking refund", "Refund credit from a cancelled booking.", 45000, "18 Jun 2026"),
        record("Cashback", "Glow offer cashback", "Promotional cashback reserved for the next online booking.", 20000, "Valid this week")
      ],
      memberships: [
        record("Active", "Glow Plus Membership", "Includes monthly facial benefits and priority slots.", 249900, "Renews 20 Jul 2026"),
        record("Benefit", "Hair spa discount", "One discounted hair spa session remains in this cycle.", 50000, "1 of 2 used"),
        record("Renewal", "Premium plan reminder", "Renewal can be paid from wallet, UPI or invoice payment link.", 349900, "Due in 12 days")
      ],
      packages: [
        record("Active", "6 Session Facial Package", "Four sessions remaining across selected Aura branches.", 720000, "4 of 6 left"),
        record("Redeemed", "Hair repair package", "Last redemption used with Aura Beach Panjim.", 180000, "15 Jun 2026"),
        record("Expiring", "Massage therapy pack", "Two sessions should be scheduled before expiry.", 300000, "Expires 30 Jun 2026")
      ],
      "gift-cards": [
        record("Available", "₹2,000 gift card", "Ready to share or redeem against eligible services.", 200000, "Code GC-DEMO-24"),
        record("Sent", "Birthday salon gift", "Sent to a family member with a personal note.", 150000, "19 Jun 2026"),
        record("Redeemed", "Festive glow card", "Partially used on a facial booking.", 65000, "Balance left")
      ],
      support: [
        record("Open", "Booking time change request", "Support ticket for changing an upcoming visit.", undefined, "Reply due today"),
        record("Live chat", "Payment confirmation chat", "Conversation linked to an invoice payment status.", undefined, "Agent assigned"),
        record("Resolved", "Refund status answered", "Customer support shared the refund timeline.", undefined, "17 Jun 2026")
      ],
      referrals: [
        record("Ready", "Invite code AURA-SHINE", "Share with friends to unlock booking rewards.", 0, "Reusable code"),
        record("Pending", "Riya's first booking", "Reward unlocks when the referred booking is completed.", 20000, "Booked"),
        record("Earned", "Referral credit added", "Credit added after a successful referral.", 30000, "12 Jun 2026")
      ],
      gallery: [
        record("Saved", "Bridal hair inspiration", "Reference look saved for your next stylist consultation.", undefined, "3 photos"),
        record("Before/after", "Skin glow transformation", "Treatment progress photos attached to your profile.", undefined, "2 photos"),
        record("Favorite", "Nail art moodboard", "Saved inspiration for an upcoming nail booking.", undefined, "5 ideas")
      ],
      family: [
        record("Family member", "Mom profile", "Shared profile with preferred salon notes.", undefined, "Primary contact set"),
        record("Child profile", "Kids haircut preferences", "Saved notes for clipper length and appointment reminders.", undefined, "Updated today"),
        record("Group booking", "Family grooming visit", "Multi-person booking draft for the weekend.", 420000, "3 guests")
      ],
      corporate: [
        record("Eligible", "Aura Corporate Wellness", "Company benefit active for grooming and wellness bookings.", 0, "Employee verified"),
        record("Package", "Monthly team grooming pass", "One subsidized appointment available this month.", 120000, "1 pass left"),
        record("Invoice", "HR reimbursement pending", "Corporate invoice can be shared with the company admin.", 280000, "Pending approval")
      ],
      goals: [
        record("Active goal", "Hair repair plan", "Four-week routine with hydration and trim reminders.", undefined, "Week 2"),
        record("Skin goal", "Pre-event glow plan", "Recommended facial schedule and product reminders.", 520000, "Next step due"),
        record("Completed", "Consistency streak", "Three planned self-care visits completed this quarter.", undefined, "3 of 3")
      ],
      payments: [
        record("Pending", "UPI payment request", "Payment link generated for an upcoming booking.", 240000, "Expires tonight"),
        record("Paid", "Razorpay card payment", "Payment captured for Aura Family Salon Thane.", 180000, "19 Jun 2026"),
        record("Refunding", "Wallet refund in progress", "Refund is moving back to the customer wallet.", 75000, "ETA 2 days")
      ],
      invoices: [
        record("Pending", "INV-DEMO-1001", "Booking invoice awaiting payment confirmation.", 240000, "Due today"),
        record("Paid", "INV-DEMO-1002", "Paid invoice with GST and service breakdown.", 360000, "18 Jun 2026"),
        record("Part-paid", "INV-DEMO-1003", "Partial wallet adjustment applied; remaining balance is visible.", 90000, "Balance due")
      ],
      notifications: [
        record("Unread", "Appointment reminder", "Your visit starts tomorrow. Tap to review booking details.", undefined, "Today"),
        record("Offer", "Weekday glow offer", "New off-peak discount available near your area.", undefined, "New"),
        record("Payment", "Invoice payment updated", "Payment status changed after gateway confirmation.", undefined, "19 Jun 2026")
      ]
    };

    return records[slug] || records["rewards"];
  }

  private isWallet(data: CustomerAccountModule): data is CustomerWallet {
    return !!data && typeof data === "object" && "transactions" in data;
  }

  private isRewards(data: CustomerAccountModule): data is CustomerRewardSummary {
    return !!data && typeof data === "object" && "loyaltyPoints" in data;
  }
}
