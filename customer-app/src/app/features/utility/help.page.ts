import { Component, OnInit, computed, signal } from "@angular/core";
import { ActivatedRoute, RouterLink } from "@angular/router";
import { IonBackButton, IonButton, IonButtons, IonContent, IonHeader, IonIcon, IonTitle, IonToolbar } from "@ionic/angular/standalone";
import { addIcons } from "ionicons";
import { calendarOutline, cardOutline, chatbubblesOutline, chevronDownOutline, refreshOutline, searchOutline, shieldCheckmarkOutline } from "ionicons/icons";
import { Booking } from "../../core/api.types";
import { MarketplaceService } from "../../core/marketplace.service";

type HelpCategory = "booking" | "payment" | "refund" | "account";

interface HelpItem {
  id: string;
  category: HelpCategory;
  title: string;
  body: string;
  route?: string;
  actionLabel?: string;
}

@Component({
  standalone: true,
  imports: [RouterLink, IonBackButton, IonButton, IonButtons, IonContent, IonHeader, IonIcon, IonTitle, IonToolbar],
  template: `
    <ion-header class="ion-no-border help-header">
      <ion-toolbar>
        <ion-buttons slot="start">
          <ion-back-button defaultHref="/tabs/profile" aria-label="Back to profile"></ion-back-button>
        </ion-buttons>
        <ion-title>Help &amp; Support</ion-title>
      </ion-toolbar>
    </ion-header>

    <ion-content>
      <main class="page-narrow help-page">
        <section class="search-intro" aria-labelledby="help-heading">
          <p class="eyebrow">Customer care</p>
          <h1 id="help-heading">What can we help with?</h1>
          <p>Search quick answers or choose a topic below.</p>
          <label class="search-label" for="help-search">Search help topics</label>
          <div class="search-field">
            <ion-icon name="search-outline" aria-hidden="true"></ion-icon>
            <input
              id="help-search"
              type="search"
              autocomplete="off"
              placeholder="Try “refund” or “reschedule”"
              [value]="query()"
              (input)="onSearch($event)"
              aria-describedby="search-status"
            />
          </div>
          <p id="search-status" class="search-status" aria-live="polite">
            @if (normalizedQuery()) {
              {{ resultCount() }} {{ resultCount() === 1 ? "answer" : "answers" }} found
            }
          </p>
        </section>

        @if (upcomingBooking(); as booking) {
          <section class="booking-support" aria-labelledby="booking-support-title">
            <div class="booking-icon" aria-hidden="true"><ion-icon name="calendar-outline"></ion-icon></div>
            <div class="booking-copy">
              <span>Upcoming booking</span>
              <h2 id="booking-support-title">{{ booking.serviceName }}</h2>
              <p>{{ booking.businessName }} · {{ bookingDate(booking) }}</p>
            </div>
            <a [routerLink]="['/bookings', booking.id]" [attr.aria-label]="'Get help with ' + booking.serviceName">View</a>
          </section>
        }

        @if (visibleCategories().length) {
          <section class="category-section" aria-labelledby="category-heading">
            <div class="section-copy">
              <h2 id="category-heading">Popular topics</h2>
            </div>
            <div class="category-grid" role="group" aria-label="Help categories">
              @for (category of visibleCategories(); track category.key) {
                <button
                  type="button"
                  class="category-button"
                  [class.active]="activeCategory() === category.key"
                  [attr.aria-pressed]="activeCategory() === category.key"
                  aria-controls="faq-list"
                  (click)="selectCategory(category.key)"
                >
                  <ion-icon [name]="category.icon" aria-hidden="true"></ion-icon>
                  <span>
                    <strong>{{ category.label }}</strong>
                    <small>{{ category.shortCopy }}</small>
                  </span>
                </button>
              }
            </div>
          </section>
        }

        <section id="faq-list" class="faq-section" aria-labelledby="faq-heading">
          <div class="section-copy faq-heading">
            <h2 id="faq-heading">{{ activeLabel() }}</h2>
          </div>

          @if (filteredItems().length) {
            <div class="faq-list">
              @for (item of filteredItems(); track item.id) {
                <article class="faq-item" [class.expanded]="expandedItem() === item.id">
                  <h3>
                    <button
                      type="button"
                      [attr.aria-expanded]="expandedItem() === item.id"
                      [attr.aria-controls]="item.id + '-answer'"
                      (click)="toggleItem(item.id)"
                    >
                      <span>{{ item.title }}</span>
                      <ion-icon name="chevron-down-outline" aria-hidden="true"></ion-icon>
                    </button>
                  </h3>
                  @if (expandedItem() === item.id) {
                    <div class="faq-answer" [id]="item.id + '-answer'">
                      <p>{{ item.body }}</p>
                      @if (item.route && item.actionLabel) {
                        <a [routerLink]="item.route">{{ item.actionLabel }}</a>
                      }
                    </div>
                  }
                </article>
              }
            </div>
          } @else {
            <div class="empty-state" role="status">
              <h3>No matching answers</h3>
              <p>Try a broader search, or contact the support team below.</p>
              <button type="button" (click)="clearSearch()">Clear search</button>
            </div>
          }
        </section>

        <section class="support-escalation" aria-labelledby="human-support-title">
          <div>
            <p class="eyebrow">Still need help?</p>
            <h2 id="human-support-title">Talk to our support team</h2>
            <p>Get help with bookings, payments, refunds, or your account.</p>
          </div>
          <ion-button routerLink="/tabs/support">
            <ion-icon name="chatbubbles-outline" slot="start"></ion-icon>
            Contact support
          </ion-button>
          <ion-button fill="outline" class="security-button" routerLink="/tabs/support">
            <ion-icon name="shield-checkmark-outline" slot="start"></ion-icon>
            Report a security issue
          </ion-button>
        </section>
      </main>
    </ion-content>
  `,
  styles: [`
    .help-header ion-toolbar {
      --min-height: 52px;
    }

    .help-header ion-title {
      font-size: 1rem;
      font-weight: 850;
      letter-spacing: -0.015em;
    }

    .help-page {
      display: grid;
      gap: 20px;
      max-width: 720px;
    }

    .search-intro {
      display: grid;
      gap: 5px;
    }

    .search-intro h1,
    .section-copy h2,
    .booking-copy h2,
    .support-escalation h2,
    .empty-state h3 {
      margin: 0;
      color: var(--text);
    }

    .search-intro h1 {
      max-width: 560px;
      font-size: clamp(1.55rem, 7vw, 1.9rem);
      font-weight: 900;
      line-height: 1.1;
    }

    .search-intro > p:not(.eyebrow):not(.search-status) {
      margin: 0 0 4px;
      font-size: 0.9rem;
      line-height: 1.45;
    }

    .search-label {
      position: absolute;
      width: 1px;
      height: 1px;
      overflow: hidden;
      clip: rect(0 0 0 0);
      clip-path: inset(50%);
      white-space: nowrap;
    }

    .search-field {
      display: grid;
      grid-template-columns: 22px minmax(0, 1fr);
      align-items: center;
      gap: 8px;
      min-height: 48px;
      padding: 0 13px;
      border: 1px solid var(--border-strong);
      border-radius: var(--radius-md);
      background: var(--surface);
      box-shadow: 0 8px 22px rgba(6, 23, 43, 0.07);
      transition: border-color var(--motion-fast), box-shadow var(--motion-fast);
    }

    .search-field:focus-within {
      border-color: var(--focus);
      box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.16), 0 8px 22px rgba(6, 23, 43, 0.08);
    }

    .search-field ion-icon {
      color: var(--primary);
      font-size: 1.2rem;
    }

    .search-field input {
      width: 100%;
      min-width: 0;
      min-height: 46px;
      padding: 0;
      border: 0;
      outline: 0;
      color: var(--text);
      background: transparent;
      font: inherit;
      font-size: 0.94rem;
    }

    .search-field input::placeholder {
      color: var(--muted);
      opacity: 1;
    }

    .search-status {
      margin: 0;
      color: var(--muted);
      font-size: 0.74rem;
      line-height: 1.25;
      font-weight: 700;
    }

    .search-status:empty {
      display: none;
    }

    .booking-support {
      display: grid;
      grid-template-columns: 40px minmax(0, 1fr) auto;
      align-items: center;
      gap: 10px;
      min-width: 0;
      padding: 10px 10px 10px 12px;
      border: 1px solid var(--border);
      border-left: 4px solid var(--brand-600);
      border-radius: var(--radius-md);
      background: var(--surface);
      box-shadow: var(--shadow-soft);
    }

    .booking-icon {
      display: grid;
      place-items: center;
      width: 40px;
      height: 40px;
      border-radius: 12px;
      color: var(--brand-700);
      background: var(--primary-soft);
      font-size: 1.15rem;
    }

    .booking-copy {
      min-width: 0;
    }

    .booking-copy span {
      display: block;
      margin-bottom: 2px;
      color: var(--primary);
      font-size: 0.65rem;
      font-weight: 900;
      letter-spacing: 0.08em;
      text-transform: uppercase;
    }

    .booking-copy h2 {
      overflow: hidden;
      font-size: 0.88rem;
      font-weight: 850;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .booking-copy p {
      overflow: hidden;
      margin: 2px 0 0;
      font-size: 0.74rem;
      line-height: 1.3;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .booking-support > a {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-height: 48px;
      min-width: 48px;
      padding: 0 9px;
      border: 0;
      border-radius: 12px;
      color: var(--brand-700);
      background: var(--primary-soft);
      font-size: 0.78rem;
      font-weight: 850;
      text-decoration: none;
      transition: color var(--motion-fast), background-color var(--motion-fast);
    }

    .booking-support > a:hover {
      color: #FFFFFF;
      background: var(--brand-700);
    }

    .category-section,
    .faq-section {
      display: grid;
      gap: 7px;
    }

    .section-copy {
      display: grid;
      gap: 1px;
    }

    .section-copy .eyebrow,
    .search-intro .eyebrow,
    .support-escalation .eyebrow {
      margin: 0;
      font-size: 0.68rem;
      line-height: 1.3;
    }

    .section-copy h2,
    .support-escalation h2 {
      font-size: 1.08rem;
      font-weight: 850;
      line-height: 1.2;
    }

    .category-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 6px;
    }

    .category-button {
      display: grid;
      grid-template-columns: 22px minmax(0, 1fr);
      align-items: center;
      gap: 6px;
      min-width: 0;
      min-height: 64px;
      padding: 8px 10px;
      border: 1px solid var(--border-strong);
      border-radius: 14px;
      color: var(--text);
      background: var(--surface);
      text-align: left;
      cursor: pointer;
      transition: color var(--motion-fast), border-color var(--motion-fast), background-color var(--motion-fast), box-shadow var(--motion-fast);
    }

    .category-button:hover {
      border-color: var(--brand-600);
      background: var(--primary-soft);
    }

    .category-button.active {
      color: #FFFFFF;
      border-color: var(--brand-900);
      background: var(--brand-900);
      box-shadow: 0 10px 24px rgba(6, 23, 43, 0.16);
    }

    .category-button ion-icon {
      font-size: 1.08rem;
    }

    .category-button span {
      display: grid;
      gap: 2px;
      min-width: 0;
    }

    .category-button strong {
      color: inherit;
      overflow-wrap: anywhere;
      font-size: 0.8rem;
      line-height: 1.18;
    }

    .category-button small {
      display: -webkit-box;
      overflow: hidden;
      color: var(--muted);
      font-size: 0.67rem;
      font-weight: 650;
      line-height: 1.25;
      -webkit-box-orient: vertical;
      -webkit-line-clamp: 2;
    }

    .category-button.active small {
      color: rgba(255, 255, 255, 0.82);
    }

    .faq-list {
      overflow: hidden;
      border: 1px solid var(--border);
      border-radius: var(--radius-md);
      background: var(--surface);
    }

    .faq-item + .faq-item {
      border-top: 1px solid var(--border);
    }

    .faq-item h3 {
      margin: 0;
    }

    .faq-item h3 button {
      display: grid;
      grid-template-columns: minmax(0, 1fr) 24px;
      align-items: center;
      gap: 9px;
      width: 100%;
      min-height: 52px;
      padding: 10px 12px;
      border: 0;
      color: var(--text);
      background: transparent;
      font: inherit;
      font-size: 0.88rem;
      font-weight: 820;
      line-height: 1.35;
      text-align: left;
      cursor: pointer;
      transition: color var(--motion-fast), background-color var(--motion-fast);
    }

    .faq-item h3 button:hover,
    .faq-item.expanded h3 button {
      color: var(--brand-700);
      background: var(--primary-soft);
    }

    .faq-item h3 ion-icon {
      font-size: 1.15rem;
      transition: transform var(--motion-medium);
    }

    .faq-item.expanded h3 ion-icon {
      transform: rotate(180deg);
    }

    .faq-answer {
      padding: 0 12px 12px;
      animation: answer-in var(--motion-medium) both;
    }

    .faq-answer p {
      margin: 0;
      color: var(--muted);
      font-size: 0.84rem;
      line-height: 1.5;
    }

    .faq-answer a {
      display: inline-flex;
      align-items: center;
      min-height: 48px;
      margin-top: 4px;
      color: var(--brand-700);
      font-size: 0.88rem;
      font-weight: 850;
      text-underline-offset: 3px;
    }

    .empty-state {
      padding: 22px;
      border: 1px dashed var(--border-strong);
      border-radius: var(--radius-md);
      background: var(--surface);
    }

    .empty-state p {
      margin: 7px 0 12px;
      line-height: 1.55;
    }

    .empty-state button {
      min-height: 48px;
      padding: 0 16px;
      border: 1px solid var(--brand-700);
      border-radius: 14px;
      color: var(--brand-700);
      background: transparent;
      font: inherit;
      font-weight: 850;
      cursor: pointer;
    }

    .support-escalation {
      display: grid;
      gap: 4px;
      padding: 11px 12px;
      border-top: 2px solid var(--brand-700);
      border-radius: 0 0 var(--radius-md) var(--radius-md);
      color: var(--text);
      background: var(--surface-soft);
    }

    .support-escalation > div > p:last-child {
      margin: 2px 0 0;
      font-size: 0.78rem;
      line-height: 1.35;
    }

    .support-escalation ion-button {
      min-height: 48px;
      margin: 4px 0 0;
      justify-self: start;
      --border-radius: 14px;
      font-size: 0.84rem;
      font-weight: 850;
    }

    .security-button {
      margin-top: 2px;
      --border-color: var(--brand-700);
      --border-radius: 12px;
      --color: var(--brand-700);
      --padding-start: 13px;
      --padding-end: 13px;
      font-size: 0.84rem;
      font-weight: 800;
    }

    @media (max-width: 599px) {
      .support-escalation h2 {
        font-size: 1rem;
      }
    }

    .security-button ion-icon {
      font-size: 1.05rem;
    }

    button:focus-visible,
    a:focus-visible,
    .search-field:has(input:focus-visible) {
      outline: 3px solid var(--focus);
      outline-offset: 3px;
    }

    @keyframes answer-in {
      from { opacity: 0; transform: translateY(-6px); }
      to { opacity: 1; transform: translateY(0); }
    }

    @media (min-width: 600px) {
      .help-page {
        gap: 32px;
      }

      .search-intro {
        gap: 8px;
      }

      .search-intro h1 {
        font-size: clamp(1.75rem, 7vw, 2.65rem);
        line-height: 1.08;
      }

      .search-intro > p:not(.eyebrow):not(.search-status) {
        margin-bottom: 8px;
        font-size: 0.98rem;
        line-height: 1.55;
      }

      .search-field {
        grid-template-columns: 24px minmax(0, 1fr);
        gap: 10px;
        min-height: 52px;
        padding: 0 15px;
      }

      .search-field input {
        min-height: 50px;
        font-size: 1rem;
      }

      .booking-support {
        grid-template-columns: 48px minmax(0, 1fr) auto;
        gap: 12px;
        padding: 16px;
      }

      .booking-icon {
        width: 48px;
        height: 48px;
        border-radius: 14px;
        font-size: 1.35rem;
      }

      .booking-copy span {
        font-size: 0.72rem;
      }

      .booking-copy h2 {
        font-size: 1rem;
      }

      .booking-copy p {
        font-size: 0.82rem;
        line-height: 1.4;
      }

      .booking-support > a {
        grid-column: auto;
        min-width: 152px;
        padding: 0 16px;
        border: 1px solid var(--brand-700);
        border-radius: 14px;
        background: transparent;
        font-size: 0.88rem;
      }

      .category-section,
      .faq-section {
        gap: 14px;
      }

      .section-copy {
        gap: 3px;
      }

      .section-copy .eyebrow,
      .search-intro .eyebrow,
      .support-escalation .eyebrow {
        font-size: inherit;
        line-height: inherit;
      }

      .section-copy h2,
      .support-escalation h2 {
        font-size: 1.25rem;
      }

      .category-button {
        grid-template-columns: 32px minmax(0, 1fr);
        align-items: start;
        gap: 9px;
        min-height: 96px;
        padding: 16px;
      }

      .category-button ion-icon {
        margin-top: 1px;
        font-size: 1.35rem;
      }

      .category-button span {
        gap: 5px;
      }

      .category-button strong {
        font-size: 0.9rem;
        line-height: 1.25;
      }

      .category-button small {
        display: block;
        overflow: visible;
        font-size: 0.74rem;
        line-height: 1.35;
      }

      .faq-item h3 button {
        gap: 12px;
        min-height: 58px;
        padding: 14px 16px;
        font-size: 0.94rem;
      }

      .faq-answer {
        padding: 2px 16px 18px;
      }

      .faq-answer p {
        font-size: 0.9rem;
        line-height: 1.65;
      }

      .support-escalation {
        grid-template-columns: minmax(0, 1fr) auto;
        align-items: center;
        padding: 24px;
      }

      .support-escalation ion-button {
        min-width: 170px;
        font-size: inherit;
      }

      .security-button {
        grid-column: 1 / -1;
        min-width: 0;
      }
    }

    @media (prefers-reduced-motion: reduce) {
      .search-field,
      .booking-support > a,
      .category-button,
      .faq-item h3 button,
      .faq-item h3 ion-icon {
        transition: none;
      }

      .faq-answer {
        animation: none;
      }
    }
  `]
})
export class HelpPage implements OnInit {
  readonly activeCategory = signal<HelpCategory>("booking");
  readonly expandedItem = signal<string | null>("view-booking");
  readonly query = signal("");
  readonly categories = [
    { key: "booking" as const, label: "Bookings", shortCopy: "Manage appointments", searchCopy: "reschedule cancel waitlist appointment status", icon: "calendar-outline" },
    { key: "payment" as const, label: "Payments", shortCopy: "Pay and view invoices", searchCopy: "online payment venue invoice wallet", icon: "card-outline" },
    { key: "refund" as const, label: "Refunds", shortCopy: "Policies and timing", searchCopy: "cancellation refund late policy", icon: "refresh-outline" },
    { key: "account" as const, label: "Account & safety", shortCopy: "Profile and security", searchCopy: "login mobile verification notifications privacy security", icon: "shield-checkmark-outline" }
  ];
  readonly helpItems: HelpItem[] = [
    { id: "view-booking", category: "booking", title: "How do I view a booking?", body: "Open Bookings, choose the appointment, and review the service, staff, time, payment status, cancellation policy, and support actions.", route: "/tabs/bookings", actionLabel: "View my bookings" },
    { id: "join-waitlist", category: "booking", title: "Can I join a waitlist?", body: "Use Waitlist on an eligible booking. AuraSalon records your preferred date and note, then shows earlier slots when recommendations are available.", route: "/tabs/bookings", actionLabel: "Check booking options" },
    { id: "reschedule-booking", category: "booking", title: "How do I reschedule?", body: "Open the booking detail and choose Reschedule. The app checks available dates and times before updating your appointment.", route: "/tabs/bookings", actionLabel: "Manage my appointment" },
    { id: "payment-options", category: "payment", title: "Which payment options are supported?", body: "A business can support pay-at-venue and online payment links. UPI or Razorpay availability depends on that business’s payment configuration.", route: "/tabs/wallet", actionLabel: "View wallet and payments" },
    { id: "find-invoices", category: "payment", title: "Where are my invoices?", body: "Wallet and payment records appear in the customer hub when invoice records are available for your account.", route: "/tabs/wallet", actionLabel: "Find my payment records" },
    { id: "refund-process", category: "refund", title: "How do refunds work?", body: "Refund eligibility follows the business cancellation policy and payment provider status. Check the live policy on your booking when it is available.", route: "/tabs/bookings", actionLabel: "Review booking policy" },
    { id: "late-cancellation", category: "refund", title: "Can I cancel late?", body: "Late cancellation depends on the salon’s policy. Open your booking detail to review the current rule and available cancellation action.", route: "/tabs/bookings", actionLabel: "Check cancellation options" },
    { id: "mobile-verification", category: "account", title: "Why do I need mobile verification?", body: "AuraSalon uses a verified mobile number for booking ownership, reminders, OTP security, and support handoff.", route: "/tabs/profile/edit/personal", actionLabel: "Review personal details" },
    { id: "update-notifications", category: "account", title: "How do I update notifications?", body: "Open profile settings to manage booking reminders, promotions, loyalty, and membership notifications.", route: "/tabs/profile/edit/notifications", actionLabel: "Manage notifications" }
  ];
  readonly normalizedQuery = computed(() => this.query().trim().toLocaleLowerCase());
  readonly visibleCategories = computed(() => {
    const query = this.normalizedQuery();
    if (!query) return this.categories;
    return this.categories.filter((category) => this.categoryMatches(category.key, query)
      || this.helpItems.some((item) => item.category === category.key && this.itemMatches(item, query)));
  });
  readonly filteredItems = computed(() => {
    const query = this.normalizedQuery();
    const categoryMatches = query && this.categoryMatches(this.activeCategory(), query);
    return this.helpItems.filter((item) => item.category === this.activeCategory() && (!query || categoryMatches || this.itemMatches(item, query)));
  });
  readonly resultCount = computed(() => {
    const query = this.normalizedQuery();
    return query
      ? this.helpItems.filter((item) => this.categoryMatches(item.category, query) || this.itemMatches(item, query)).length
      : this.helpItems.length;
  });
  readonly activeLabel = computed(() => {
    const label = this.categories.find((item) => item.key === this.activeCategory())?.label || "Frequently asked questions";
    return this.normalizedQuery() ? `${label} answers` : `${label} questions`;
  });
  readonly upcomingBooking = computed(() => this.marketplace.bookings()
    .filter((booking) => booking.status === "confirmed" || booking.status === "pending")
    .sort((a, b) => this.bookingTimestamp(a) - this.bookingTimestamp(b))[0] ?? null);

  constructor(readonly marketplace: MarketplaceService, private readonly route: ActivatedRoute) {
    addIcons({ calendarOutline, cardOutline, chatbubblesOutline, chevronDownOutline, refreshOutline, searchOutline, shieldCheckmarkOutline });
  }

  ngOnInit() {
    const topic = this.route.snapshot.queryParamMap.get("topic");
    if (topic && this.categories.some((category) => category.key === topic)) {
      this.activeCategory.set(topic as HelpCategory);
      this.expandedItem.set(this.helpItems.find((item) => item.category === topic)?.id ?? null);
    }
    if (!this.upcomingBooking()) {
      void this.marketplace.loadBookings("upcoming").catch(() => undefined);
    }
  }

  onSearch(event: Event) {
    if (!(event.target instanceof HTMLInputElement)) return;
    this.query.set(event.target.value);
    const firstCategory = this.visibleCategories()[0]?.key;
    if (firstCategory && !this.visibleCategories().some((category) => category.key === this.activeCategory())) {
      this.activeCategory.set(firstCategory);
    }
    this.expandedItem.set(null);
  }

  clearSearch() {
    this.query.set("");
    this.activeCategory.set("booking");
    this.expandedItem.set("view-booking");
  }

  selectCategory(category: HelpCategory) {
    this.activeCategory.set(category);
    this.expandedItem.set(null);
  }

  toggleItem(id: string) {
    this.expandedItem.update((current) => current === id ? null : id);
  }

  bookingDate(booking: Booking): string {
    const value = booking.displayStartAt || booking.startsAt || booking.startAt;
    if (!value) return "Time available in booking details";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return new Intl.DateTimeFormat("en-IN", {
      weekday: "short",
      day: "numeric",
      month: "short",
      hour: "numeric",
      minute: "2-digit"
    }).format(date);
  }

  private itemMatches(item: HelpItem, query: string): boolean {
    return `${item.title} ${item.body} ${item.actionLabel || ""}`.toLocaleLowerCase().includes(query);
  }

  private categoryMatches(category: HelpCategory, query: string): boolean {
    const item = this.categories.find((candidate) => candidate.key === category);
    return !!item && `${item.label} ${item.shortCopy} ${item.searchCopy}`.toLocaleLowerCase().includes(query);
  }

  private bookingTimestamp(booking: Booking): number {
    const value = booking.startsAt || booking.startAt || booking.displayStartAt;
    if (!value) return Number.MAX_SAFE_INTEGER;
    const timestamp = new Date(value).getTime();
    return Number.isNaN(timestamp) ? Number.MAX_SAFE_INTEGER : timestamp;
  }
}
