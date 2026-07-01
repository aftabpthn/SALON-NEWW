import { Component, computed, signal } from "@angular/core";
import { RouterLink } from "@angular/router";
import { IonBackButton, IonButton, IonButtons, IonContent, IonHeader, IonIcon, IonToolbar } from "@ionic/angular/standalone";
import { addIcons } from "ionicons";
import { calendarOutline, cardOutline, chatbubblesOutline, helpCircleOutline, refreshOutline, shieldCheckmarkOutline } from "ionicons/icons";

interface HelpItem {
  category: "booking" | "payment" | "refund" | "account";
  title: string;
  body: string;
  route?: string;
}

@Component({
  standalone: true,
  imports: [RouterLink, IonBackButton, IonButton, IonButtons, IonContent, IonHeader, IonIcon, IonToolbar],
  template: `
    <ion-header class="ion-no-border">
      <ion-toolbar>
        <ion-buttons slot="start"><ion-back-button defaultHref="/tabs/profile"></ion-back-button></ion-buttons>
      </ion-toolbar>
    </ion-header>
    <ion-content>
      <main class="page-narrow help-page">
        <section class="help-hero premium-card">
          <span><ion-icon name="help-circle-outline"></ion-icon></span>
          <h1>How can we help?</h1>
        </section>

        <section class="quick-grid" aria-label="Support categories">
          @for (category of categories; track category.key) {
            <button type="button" class="premium-card quick-card" [class.active]="activeCategory() === category.key" (click)="activeCategory.set(category.key)">
              <ion-icon [name]="category.icon"></ion-icon>
              <strong>{{ category.label }}</strong>
              <small>{{ category.copy }}</small>
            </button>
          }
        </section>

        <section class="premium-card contact-card">
          <div>
            <h2>Need human help?</h2>
          </div>
          <div class="contact-actions">
            <ion-button class="primary-gradient" routerLink="/tabs/bookings">
              <ion-icon name="calendar-outline" slot="start"></ion-icon>
              Booking issues
            </ion-button>
            <ion-button fill="outline" class="secondary-button" routerLink="/tabs/support">
              <ion-icon name="chatbubbles-outline" slot="start"></ion-icon>
              Support hub
            </ion-button>
          </div>
        </section>

        <section class="faq-list" aria-label="Frequently asked questions">
          <div class="section-heading">
            <div>
              <h2 class="section-title">{{ activeLabel() }}</h2>
            </div>
          </div>
          @for (item of filteredItems(); track item.title) {
            <article class="premium-card faq-card">
              <h3>{{ item.title }}</h3>
              <p class="muted">{{ item.body }}</p>
              @if (item.route) {
                <a [routerLink]="item.route">Open related page</a>
              }
            </article>
          }
        </section>
      </main>
    </ion-content>
  `,
  styles: [`
    .help-page {
      display: grid;
      gap: 16px;
    }

    .help-hero,
    .contact-card,
    .faq-card {
      padding: 22px;
    }

    .help-hero {
      display: grid;
      justify-items: center;
      text-align: center;
    }

    .help-hero span {
      width: 64px;
      height: 64px;
      display: grid;
      place-items: center;
      margin-bottom: 12px;
      border-radius: 22px;
      color: #120D05;
      background: linear-gradient(135deg, #F4D58D, #D6A94A);
      font-size: 1.75rem;
    }

    .help-hero h1,
    .contact-card h2,
    .faq-card h3 {
      margin: 0;
      letter-spacing: 0;
    }

    .help-hero h1 {
      font-size: clamp(2rem, 6vw, 3.8rem);
      line-height: 1;
    }

    .help-hero p,
    .contact-card p,
    .faq-card p {
      margin: 8px 0 0;
    }

    .quick-grid {
      display: grid;
      gap: 12px;
    }

    .quick-card {
      display: grid;
      justify-items: start;
      gap: 7px;
      min-height: 132px;
      padding: 18px;
      border: 1px solid var(--border);
      text-align: left;
      cursor: pointer;
    }

    .quick-card.active {
      color: #120D05 !important;
      background: linear-gradient(135deg, #F4D58D, #D6A94A 58%, #9B6B22) !important;
      box-shadow: 0 18px 44px rgba(214, 169, 74, 0.24) !important;
    }

    .quick-card ion-icon {
      font-size: 1.45rem;
    }

    .quick-card small {
      color: var(--muted);
      font-weight: 800;
      line-height: 1.35;
    }

    .contact-card {
      display: grid;
      gap: 16px;
    }

    .contact-actions {
      display: grid;
      gap: 10px;
    }

    .faq-list {
      display: grid;
      gap: 12px;
    }

    .faq-card a {
      display: inline-flex;
      margin-top: 12px;
      color: var(--primary);
      font-weight: 900;
      text-decoration: none;
    }

    @media (min-width: 600px) {
      .quick-grid {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }

      .contact-card {
        grid-template-columns: minmax(0, 1fr) auto;
        align-items: center;
      }
    }
  `]
})
export class HelpPage {
  readonly activeCategory = signal<HelpItem["category"]>("booking");
  readonly categories = [
    { key: "booking" as const, label: "Booking issues", copy: "Reschedule, cancel, waitlist, and appointment status.", icon: "calendar-outline" },
    { key: "payment" as const, label: "Payment issues", copy: "Online payment, pay-at-venue, invoices, wallet and refunds.", icon: "card-outline" },
    { key: "refund" as const, label: "Cancellation & refunds", copy: "Policy windows, refund timing, and salon rules.", icon: "refresh-outline" },
    { key: "account" as const, label: "Account help", copy: "Login, profile, notifications, privacy, and security.", icon: "shield-checkmark-outline" }
  ];
  readonly helpItems: HelpItem[] = [
    { category: "booking", title: "How do I view a booking?", body: "Open Bookings, choose the appointment, and review service, staff, time, payment status, cancellation policy and support actions.", route: "/tabs/bookings" },
    { category: "booking", title: "Can I join a waitlist?", body: "Use Waitlist on an eligible booking. AuraSalon records your preferred date and note, then suggests earlier slots when the backend returns recommendations.", route: "/tabs/bookings" },
    { category: "booking", title: "How do I reschedule?", body: "Open the booking detail and use Reschedule. The app checks available date/time slots before updating the customer booking." },
    { category: "payment", title: "Which payment options are supported?", body: "Businesses can support pay-at-venue and online payment links. UPI/Razorpay availability depends on the business payment configuration returned by the backend.", route: "/tabs/wallet" },
    { category: "payment", title: "Where are invoices?", body: "Wallet and payments records appear in the customer hub when invoice APIs return customer-owned records.", route: "/tabs/wallet" },
    { category: "refund", title: "How do refunds work?", body: "Refund eligibility follows the business cancellation policy and payment provider state. The app shows the live booking policy where available." },
    { category: "refund", title: "Can I cancel late?", body: "Late cancellation depends on salon policy. Open your booking detail to see the returned rule and cancellation action.", route: "/tabs/bookings" },
    { category: "account", title: "Why do I need mobile verification?", body: "AuraSalon requires a verified mobile number for booking ownership, reminders, OTP security and support handoff.", route: "/tabs/profile/edit/personal" },
    { category: "account", title: "How do I update notifications?", body: "Open profile settings to manage reminders, promotions, loyalty and membership notifications.", route: "/tabs/profile/edit/notifications" }
  ];
  readonly filteredItems = computed(() => this.helpItems.filter((item) => item.category === this.activeCategory()));
  readonly activeLabel = computed(() => this.categories.find((item) => item.key === this.activeCategory())?.label || "FAQs");

  constructor() {
    addIcons({ calendarOutline, cardOutline, chatbubblesOutline, helpCircleOutline, refreshOutline, shieldCheckmarkOutline });
  }
}
