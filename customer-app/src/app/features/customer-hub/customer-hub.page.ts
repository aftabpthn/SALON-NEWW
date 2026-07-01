import { Component, OnInit, computed, signal } from "@angular/core";
import { ActivatedRoute, RouterLink } from "@angular/router";
import { AlertController, IonButton, IonContent, IonIcon } from "@ionic/angular/standalone";
import { addIcons } from "ionicons";
import {
  briefcaseOutline,
  calendarOutline,
  chatbubblesOutline,
  colorPaletteOutline,
  giftOutline,
  heartCircleOutline,
  imagesOutline,
  peopleOutline,
  ribbonOutline,
  searchOutline,
  shareSocialOutline,
  ticketOutline,
  walletOutline
} from "ionicons/icons";
import {
  CustomerAccountModule,
  CustomerMembershipPlan,
  CustomerRewardSummary,
  CustomerWallet
} from "../../core/api.types";
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
  imports: [RouterLink, IonButton, IonContent, IonIcon],
  template: `
    <ion-content>
      <main class="page hub-page">
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

          @if (slug() === "memberships") {
            <section class="premium-card action-card">
              <div>
                <h2>Membership plans</h2>
              </div>
              <ion-button class="primary-gradient" (click)="loadPlans()">Load live plans</ion-button>
            </section>
            @if (marketplace.membershipPlans().length) {
              <section class="records-grid" aria-label="Live membership plans">
                @for (plan of marketplace.membershipPlans(); track plan.id) {
                  <article class="premium-card record-card">
                    <span>{{ plan.validityDays }} days</span>
                    <strong>{{ plan.name }}</strong>
                    <small>{{ money(plan.pricePaise) }}</small>
                    <ion-button fill="outline" class="secondary-button" (click)="buyPlan(plan)">Buy membership</ion-button>
                  </article>
                }
              </section>
            }
          }

          @if (slug() === "gift-cards") {
            <section class="premium-card action-card">
              <div>
                <h2>Purchase gift card</h2>
              </div>
              <ion-button class="primary-gradient" (click)="purchaseGiftCard()">Enter amount</ion-button>
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
      color: #120D05 !important;
      border-color: transparent !important;
      background: linear-gradient(135deg, #F4D58D, #D6A94A 58%, #9B6B22) !important;
      box-shadow: 0 18px 44px rgba(214, 169, 74, 0.24) !important;
    }

    .hub-tile ion-icon {
      width: 44px;
      height: 44px;
      padding: 11px;
      border-radius: 16px;
      color: #120D05;
      background: linear-gradient(135deg, #F4D58D, #D6A94A);
    }

    .hub-tile.active ion-icon {
      background: rgba(255, 249, 236, 0.58);
    }

    .hub-tile small {
      color: var(--muted);
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
      border: 1px solid rgba(214, 169, 74, 0.32);
      border-radius: 999px;
      color: #8A5B08 !important;
      background: rgba(246, 217, 148, 0.34);
      font-size: 0.68rem !important;
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

    @media (max-width: 599px) {
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
    }

    @media (min-width: 768px) {
      .hub-grid {
        grid-template-columns: repeat(4, minmax(0, 1fr));
      }

      .metric-grid {
        grid-template-columns: repeat(3, minmax(0, 1fr));
      }

      .records-grid {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }
    }

    @media (max-width: 1023px) {
      .metric-grid {
        grid-template-columns: 1fr;
      }

      .metric-card {
        min-height: 96px;
      }
    }
  `]
})
export class CustomerHubPage implements OnInit {
  readonly slug = computed(() => this.route.snapshot.data["hub"] as string || "rewards");
  readonly config = computed(() => hubConfigs[this.slug()] ?? hubConfigs["rewards"]);
  readonly customerName = computed(() => this.marketplace.customer()?.name || "Customer");
  readonly liveRecords = computed(() => this.recordsFor(this.marketplace.accountModule()));
  readonly demoMode = computed(() => this.marketplace.isAuthenticated() && !this.marketplace.loading() && this.liveRecords().length === 0);
  readonly records = computed(() => {
    const live = this.liveRecords();
    if (live.length) return live;
    if (!this.marketplace.isAuthenticated() || this.marketplace.loading()) return [];
    return this.demoRecordsFor(this.slug());
  });
  readonly recordCount = computed(() => this.records().length);
  readonly actionMessage = signal("");
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

  constructor(private readonly route: ActivatedRoute, readonly marketplace: MarketplaceService, private readonly alerts: AlertController) {
    addIcons({
      briefcaseOutline,
      calendarOutline,
      chatbubblesOutline,
      colorPaletteOutline,
      giftOutline,
      heartCircleOutline,
      imagesOutline,
      peopleOutline,
      ribbonOutline,
      searchOutline,
      shareSocialOutline,
      ticketOutline,
      walletOutline
    });
  }

  ngOnInit() {
    this.reload();
  }

  reload() {
    if (!this.marketplace.isAuthenticated()) return;
    this.actionMessage.set("");
    void Promise.all([
      this.marketplace.loadCustomer(),
      this.marketplace.loadBookings(),
      this.marketplace.loadAccountModule(this.slug())
    ]).catch(() => undefined);
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
    const link = await this.marketplace.createInvoicePaymentLink(invoiceId);
    this.actionMessage.set(link.url || link.shortUrl ? `Payment link is ready: ${link.url || link.shortUrl}` : "Payment link created for this invoice.");
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
