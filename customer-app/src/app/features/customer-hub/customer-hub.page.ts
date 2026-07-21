import { Component, OnInit, computed, signal } from "@angular/core";
import { ActivatedRoute, Router, RouterLink } from "@angular/router";
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
  pricetagOutline,
  ribbonOutline,
  searchOutline,
  shareSocialOutline,
  ticketOutline,
  walletOutline
} from "ionicons/icons";
import {
  CustomerAccountModule,
  CustomerInvoice,
  CustomerMembershipPlan,
  CustomerPackagePlan,
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
  recordType?: string;
  status: string;
  title: string;
  amountPaise?: number;
  date?: string;
  description?: string;
  route?: string;
  reference?: string;
  clientId?: string;
  packageCreditId?: string;
  points?: number;
  canBook?: boolean;
  autoRenew?: boolean;
  autoRenewStatus?: string;
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
  offers: {
    eyebrow: "Recovery offers",
    title: "Active customer offers",
    icon: "pricetag-outline",
    route: "/tabs/offers"
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
                  @if (slug() === "rewards" && record.key === "loyalty-balance" && record.points && record.points > 0) {
                    <ion-button fill="outline" class="secondary-button record-action" (click)="redeemLoyalty(record.points)">
                      Redeem on invoice
                    </ion-button>
                  }
                  @if (slug() === "packages" && record.packageCreditId) {
                    <ion-button fill="outline" class="secondary-button record-action" (click)="bookWithContext({ packageCreditId: record.packageCreditId })">
                      Book with package
                    </ion-button>
                  }
                  @if (slug() === "memberships" && record.key && record.status === "active") {
                    <ion-button fill="outline" class="secondary-button record-action" (click)="freezeMembership(record.key)">
                      Freeze
                    </ion-button>
                    <ion-button fill="outline" class="secondary-button record-action" (click)="updateMembershipAutoRenew(record.key, record.autoRenewStatus === 'active' ? 'paused' : 'active')">
                      {{ record.autoRenewStatus === "active" ? "Pause auto-renew" : "Enable auto-renew" }}
                    </ion-button>
                    <ion-button fill="outline" class="secondary-button record-action" (click)="cancelMembership(record.key)">
                      Cancel
                    </ion-button>
                  }
                  @if (slug() === "memberships" && record.key && record.status === "frozen") {
                    <ion-button fill="outline" class="secondary-button record-action" (click)="resumeMembership(record.key)">
                      Resume
                    </ion-button>
                  }
                  @if (slug() === "invoices" && record.key && record.status !== "paid") {
                    <ion-button fill="outline" class="secondary-button record-action" (click)="createPaymentLink(record.key, record.amountPaise)">
                      Pay full / split
                    </ion-button>
                  }
                  @if (slug() === "gift-cards" && record.reference && record.status === "active" && (record.amountPaise || 0) > 0) {
                    <ion-button fill="outline" class="secondary-button record-action" (click)="redeemGiftCard(record.reference, record.amountPaise || 0)">
                      Redeem on invoice
                    </ion-button>
                    <ion-button fill="outline" class="secondary-button record-action" (click)="shareText('AuraShine gift card', 'Use gift card code ' + record.reference)">
                      Share
                    </ion-button>
                  }
                  @if (slug() === "referrals" && record.reference) {
                    <ion-button fill="outline" class="secondary-button record-action" (click)="shareText('AuraShine referral', 'Use my AuraShine referral code ' + record.reference)">
                      Share invite
                    </ion-button>
                  }
                  @if ((slug() === "family" || slug() === "corporate") && record.clientId && record.canBook !== false) {
                    <ion-button fill="outline" class="secondary-button record-action" (click)="bookWithContext({ clientId: record.clientId })">
                      {{ slug() === "corporate" ? "Book with benefit" : "Book for this profile" }}
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
              <ion-button fill="outline" class="secondary-button" (click)="claimGiftCard()">Claim code</ion-button>
            </section>
          }

          @if (slug() === "packages") {
            <section class="premium-card action-card">
              <div>
                <h2>Package plans</h2>
              </div>
              <ion-button class="primary-gradient" (click)="loadPackagePlans()">Load live packages</ion-button>
            </section>
            @if (marketplace.packagePlans().length) {
              <section class="records-grid" aria-label="Live package plans">
                @for (plan of marketplace.packagePlans(); track plan.id) {
                  <article class="premium-card record-card">
                    <span>{{ plan.validityDays }} days</span>
                    <strong>{{ plan.name }}</strong>
                    <small>{{ money(plan.pricePaise) }}</small>
                    <ion-button fill="outline" class="secondary-button" (click)="buyPackage(plan)">Buy package</ion-button>
                  </article>
                }
              </section>
            }
          }

          @if (slug() === "support") {
            <section class="premium-card action-card">
              <div>
                <h2>Support ticket</h2>
              </div>
              <ion-button class="primary-gradient" (click)="createSupportTicket()">Create ticket</ion-button>
            </section>
          }

          @if (slug() === "referrals") {
            <section class="premium-card action-card">
              <div>
                <h2>Referral code</h2>
              </div>
              <ion-button class="primary-gradient" (click)="createReferralCode()">Create code</ion-button>
            </section>
          }

          @if (slug() === "family") {
            <section class="premium-card action-card">
              <div>
                <h2>Family profile</h2>
              </div>
              <ion-button class="primary-gradient" (click)="createFamilyMember()">Add profile</ion-button>
            </section>
          }

          @if (slug() === "goals") {
            <section class="premium-card action-card">
              <div>
                <h2>Beauty goal</h2>
              </div>
              <ion-button class="primary-gradient" (click)="createGoal()">Add goal</ion-button>
            </section>
          }

          @if (actionMessage()) {
            <section class="premium-card state-card">
              <h2>Updated</h2>
              <p class="muted">{{ actionMessage() }}</p>
              @if (actionUrl()) {
                <ion-button class="primary-gradient" [href]="actionUrl()" target="_blank" rel="noopener">
                  Pay securely
                </ion-button>
              }
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
  readonly records = this.liveRecords;
  readonly recordCount = computed(() => this.records().length);
  readonly actionMessage = signal("");
  readonly actionUrl = signal("");
  readonly hubModules = [
    { slug: "rewards", label: "Rewards", copy: "Points, tier and booking rewards.", icon: "ribbon-outline", route: "/tabs/rewards" },
    { slug: "wallet", label: "Wallet", copy: "Credits, refunds and invoice payments.", icon: "wallet-outline", route: "/tabs/wallet" },
    { slug: "memberships", label: "Memberships", copy: "Active plans and benefit usage.", icon: "heart-circle-outline", route: "/tabs/memberships" },
    { slug: "packages", label: "Packages", copy: "Sessions, balances and redemptions.", icon: "ticket-outline", route: "/tabs/packages" },
    { slug: "gift-cards", label: "Gift cards", copy: "Purchase, redeem and track balances.", icon: "gift-outline", route: "/tabs/gift-cards" },
    { slug: "support", label: "Support", copy: "Tickets, chat and booking help.", icon: "chatbubbles-outline", route: "/tabs/support" },
    { slug: "referrals", label: "Referrals", copy: "Invite friends and track rewards.", icon: "share-social-outline", route: "/tabs/referrals" },
    { slug: "offers", label: "Offers", copy: "Active vouchers and recovery offers.", icon: "pricetag-outline", route: "/tabs/offers" },
    { slug: "gallery", label: "Gallery", copy: "Saved looks and before/after photos.", icon: "images-outline", route: "/tabs/gallery" },
    { slug: "family", label: "Family", copy: "Profiles for shared bookings.", icon: "people-outline", route: "/tabs/family" },
    { slug: "corporate", label: "Corporate", copy: "Workplace benefits and packages.", icon: "briefcase-outline", route: "/tabs/corporate" },
    { slug: "goals", label: "Beauty goals", copy: "Plans, routines and treatment goals.", icon: "color-palette-outline", route: "/tabs/goals" },
    { slug: "payments", label: "Payments", copy: "UPI, card and invoice payment records.", icon: "wallet-outline", route: "/tabs/payments" },
    { slug: "invoices", label: "Invoices", copy: "Bills, balances and payment status.", icon: "ticket-outline", route: "/tabs/invoices" },
    { slug: "notifications", label: "Notifications", copy: "Booking and account updates.", icon: "chatbubbles-outline", route: "/notifications" }
  ];

  constructor(private readonly route: ActivatedRoute, private readonly router: Router, readonly marketplace: MarketplaceService, private readonly alerts: AlertController) {
    addIcons({
      briefcaseOutline,
      calendarOutline,
      chatbubblesOutline,
      colorPaletteOutline,
      giftOutline,
      heartCircleOutline,
      imagesOutline,
      peopleOutline,
      pricetagOutline,
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
    this.actionUrl.set("");
    void Promise.all([
      this.marketplace.loadCustomer(),
      this.marketplace.loadBookings(),
      this.marketplace.loadAccountModule(this.slug())
    ]).catch(() => undefined);
  }

  stateTitle(): string {
    if (this.recordCount() > 0) return "Live records loaded";
    if (this.slug() === "rewards") return "No reward history yet";
    return "No live records available";
  }

  stateCopy(): string {
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
    const branchId = await this.chooseCommerceBranch("Choose membership salon");
    if (!branchId) return;
    await this.marketplace.loadMembershipPlans(branchId);
    if (!this.marketplace.membershipPlans().length) {
      this.actionMessage.set("No active membership plans are currently available for online purchase.");
    }
  }

  async buyPlan(plan: CustomerMembershipPlan) {
    this.actionUrl.set("");
    const checkout = await this.marketplace.buyMembership(plan.id, plan.branchId);
    if (!checkout.paymentRequired) {
      this.actionMessage.set(`${plan.name} is active.`);
      await this.marketplace.loadAccountModule("memberships");
      return;
    }
    const url = checkout.paymentLink?.url || checkout.paymentLink?.shortUrl || "";
    this.actionUrl.set(url);
    this.actionMessage.set(url
      ? `Complete ${this.money(checkout.amountPaise)} payment to activate ${plan.name}.`
      : "Online payment provider activation is required before this membership can be paid.");
  }

  async loadPackagePlans() {
    const branchId = await this.chooseCommerceBranch("Choose package salon");
    if (!branchId) return;
    await this.marketplace.loadPackagePlans(branchId);
    if (!this.marketplace.packagePlans().length) {
      this.actionMessage.set("No active packages are currently available for online purchase.");
    }
  }

  async buyPackage(plan: CustomerPackagePlan) {
    this.actionUrl.set("");
    const checkout = await this.marketplace.buyPackage({ packageId: plan.id, branchId: plan.branchId });
    const url = checkout.paymentLink?.url || checkout.paymentLink?.shortUrl || "";
    this.actionUrl.set(url);
    this.actionMessage.set(url
      ? `Complete ${this.money(checkout.amountPaise)} payment to activate ${plan.name}.`
      : checkout.paymentRequired
        ? "Online payment provider activation is required before this package can be paid."
        : `${plan.name} is active.`);
    await this.marketplace.loadAccountModule("packages").catch(() => null);
  }

  async purchaseGiftCard() {
    const branchId = await this.chooseCommerceBranch("Choose gift card salon");
    if (!branchId) return;
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
            void this.marketplace.purchaseGiftCard({ amountPaise, branchId }).then((checkout) => {
              const url = checkout.paymentLink?.url || checkout.paymentLink?.shortUrl || "";
              this.actionUrl.set(url);
              this.actionMessage.set(url
                ? `Complete ${this.money(checkout.amountPaise)} payment to issue the gift card.`
                : "Online payment provider activation is required before this gift card can be purchased.");
            });
            return true;
          }
        }
      ]
    });
    await alert.present();
  }

  async claimGiftCard() {
    const branchId = await this.chooseCommerceBranch("Choose gift card salon");
    if (!branchId) return;
    const alert = await this.alerts.create({
      header: "Claim gift card",
      inputs: [{ name: "code", type: "text", placeholder: "Gift card code" }],
      buttons: [
        { text: "Cancel", role: "cancel" },
        {
          text: "Claim",
          handler: (data) => {
            const code = String(data.code || "").trim();
            if (!code) return false;
            void this.marketplace.claimGiftCard(code, branchId).then(() => {
              this.actionUrl.set("");
              this.actionMessage.set(`Gift card ${code.toUpperCase()} claimed.`);
            });
            return true;
          }
        }
      ]
    });
    await alert.present();
  }

  async createPaymentLink(invoiceId: string, balancePaise = 0) {
    const maximum = Math.max(0, balancePaise);
    let amountPaise: number | undefined;
    if (maximum > 0) {
      const alert = await this.alerts.create({
        header: "Invoice payment",
        inputs: [{
          name: "amount",
          type: "number",
          min: 1,
          max: maximum / 100,
          value: maximum / 100,
          placeholder: "Amount in rupees"
        }],
        buttons: [
          { text: "Cancel", role: "cancel" },
          { text: "Create link", role: "confirm" }
        ]
      });
      await alert.present();
      const result = await alert.onDidDismiss<{ values?: { amount?: string } }>();
      if (result.role !== "confirm") return;
      const value = Number(result.data?.values?.amount || maximum / 100);
      amountPaise = Math.round(value * 100);
      if (!Number.isInteger(amountPaise) || amountPaise <= 0 || amountPaise > maximum) {
        this.actionMessage.set("Payment amount is invalid.");
        return;
      }
    }
    const link = await this.marketplace.createInvoicePaymentLink(invoiceId, amountPaise);
    const url = link.url || link.shortUrl || "";
    this.actionUrl.set(url);
    this.actionMessage.set(url ? "Secure invoice payment link is ready." : "Payment link created for this invoice.");
  }

  async freezeMembership(id: string) {
    const alert = await this.alerts.create({
      header: "Freeze membership",
      inputs: [
        { name: "days", type: "number", min: 1, max: 366, placeholder: "Days" },
        { name: "reason", type: "textarea", placeholder: "Reason" }
      ],
      buttons: [
        { text: "Cancel", role: "cancel" },
        { text: "Freeze", role: "confirm" }
      ]
    });
    await alert.present();
    const result = await alert.onDidDismiss<{ values?: { days?: string; reason?: string } }>();
    if (result.role !== "confirm") return;
    const days = Number(result.data?.values?.days || 0);
    if (!Number.isInteger(days) || days < 1 || days > 366) {
      this.actionMessage.set("Freeze days must be between 1 and 366.");
      return;
    }
    await this.marketplace.freezeMembership(id, days, String(result.data?.values?.reason || "").trim() || undefined);
    this.actionMessage.set("Membership frozen.");
  }

  async resumeMembership(id: string) {
    await this.marketplace.resumeMembership(id);
    this.actionMessage.set("Membership resumed.");
  }

  async cancelMembership(id: string) {
    const alert = await this.alerts.create({
      header: "Cancel membership",
      inputs: [{ name: "reason", type: "textarea", placeholder: "Reason" }],
      buttons: [
        { text: "Cancel", role: "cancel" },
        { text: "Confirm", role: "confirm" }
      ]
    });
    await alert.present();
    const result = await alert.onDidDismiss<{ values?: { reason?: string } }>();
    if (result.role !== "confirm") return;
    await this.marketplace.cancelMembership(id, String(result.data?.values?.reason || "").trim() || undefined);
    this.actionMessage.set("Membership cancelled.");
  }

  async updateMembershipAutoRenew(id: string, status: "active" | "paused" | "disabled") {
    await this.marketplace.updateMembershipAutoRenew(id, status);
    this.actionMessage.set(status === "active" ? "Auto-renew enabled." : "Auto-renew paused.");
  }

  async redeemGiftCard(code: string, cardBalancePaise: number) {
    const invoices = (await this.marketplace.listCustomerInvoices())
      .filter((invoice) => invoice.balancePaise > 0 && !["paid", "voided", "cancelled"].includes(invoice.status));
    const invoice = await this.choosePayableInvoice(invoices);
    if (!invoice) return;
    const maximumPaise = Math.min(cardBalancePaise, invoice.balancePaise);
    const alert = await this.alerts.create({
      header: "Redeem gift card",
      inputs: [{
        name: "amount",
        type: "number",
        min: 1,
        max: maximumPaise / 100,
        value: maximumPaise / 100,
        placeholder: "Amount in rupees"
      }],
      buttons: [
        { text: "Cancel", role: "cancel" },
        {
          text: "Redeem",
          handler: (data) => {
            const amountPaise = Math.round(Number(data.amount || 0) * 100);
            if (!Number.isInteger(amountPaise) || amountPaise <= 0 || amountPaise > maximumPaise) return false;
            void this.marketplace.redeemGiftCard({ code, invoiceId: invoice.id, amountPaise }).then((result) => {
              this.actionUrl.set("");
              this.actionMessage.set(`${this.money(result.amountPaise)} gift card payment applied.`);
              return this.marketplace.loadAccountModule("gift-cards");
            });
            return true;
          }
        }
      ]
    });
    await alert.present();
  }

  async redeemLoyalty(points: number) {
    const invoices = (await this.marketplace.listCustomerInvoices())
      .filter((invoice) => invoice.balancePaise > 0 && !["paid", "voided", "cancelled"].includes(invoice.status));
    const invoice = await this.choosePayableInvoice(invoices);
    if (!invoice) return;
    const maximumPaise = Math.min(points * 100, invoice.balancePaise);
    const alert = await this.alerts.create({
      header: "Redeem loyalty",
      inputs: [{
        name: "amount",
        type: "number",
        min: 1,
        max: maximumPaise / 100,
        value: maximumPaise / 100,
        placeholder: "Amount in rupees"
      }],
      buttons: [
        { text: "Cancel", role: "cancel" },
        { text: "Redeem", role: "confirm" }
      ]
    });
    await alert.present();
    const result = await alert.onDidDismiss<{ values?: { amount?: string } }>();
    if (result.role !== "confirm") return;
    const amountPaise = Math.round(Number(result.data?.values?.amount || 0) * 100);
    if (!Number.isInteger(amountPaise) || amountPaise <= 0 || amountPaise > maximumPaise) {
      this.actionMessage.set("Reward amount is invalid.");
      return;
    }
    const pointsToRedeem = Math.ceil(amountPaise / 100);
    this.actionUrl.set("");
    const redeemed = await this.marketplace.redeemLoyalty({ invoiceId: invoice.id, points: pointsToRedeem, amountPaise });
    this.actionMessage.set(`${redeemed.points} points applied to ${invoice.invoiceNumber}.`);
  }

  async createSupportTicket() {
    const branchId = await this.chooseCommerceBranch("Choose support salon");
    if (!branchId) return;
    const alert = await this.alerts.create({
      header: "Support ticket",
      inputs: [
        { name: "subject", type: "text", placeholder: "Subject" },
        { name: "body", type: "textarea", placeholder: "Message" }
      ],
      buttons: [
        { text: "Cancel", role: "cancel" },
        {
          text: "Create",
          handler: (data) => {
            const subject = String(data.subject || "").trim();
            const body = String(data.body || "").trim();
            if (!subject) return false;
            void this.marketplace.createSupportTicket({ branchId, subject, body, category: "other", priority: "normal" }).then((ticket) => {
              this.actionUrl.set("");
              this.actionMessage.set(`Ticket ${ticket.subject || ticket.title || ticket.id} created.`);
            });
            return true;
          }
        }
      ]
    });
    await alert.present();
  }

  async createReferralCode() {
    const branchId = await this.chooseCommerceBranch("Choose referral salon");
    if (!branchId) return;
    const code = await this.marketplace.createReferralCode(branchId);
    this.actionUrl.set("");
    this.actionMessage.set(code.code ? `Referral code ${code.code} is ready.` : "Referral code is ready.");
    if (code.code) await this.shareText("AuraShine referral", `Use my AuraShine referral code ${code.code}`);
  }

  async createFamilyMember() {
    const branchId = await this.chooseCommerceBranch("Choose family booking salon");
    if (!branchId) return;
    const alert = await this.alerts.create({
      header: "Family profile",
      inputs: [
        { name: "firstName", type: "text", placeholder: "First name" },
        { name: "lastName", type: "text", placeholder: "Last name" },
        { name: "phone", type: "tel", placeholder: "Phone optional" },
        { name: "relationshipType", type: "text", placeholder: "child, parent, spouse, other" }
      ],
      buttons: [
        { text: "Cancel", role: "cancel" },
        {
          text: "Save",
          handler: (data) => {
            const firstName = String(data.firstName || "").trim();
            if (!firstName) return false;
            const relationshipType = String(data.relationshipType || "other").trim().toLowerCase() as "spouse" | "parent" | "child" | "sibling" | "guardian" | "dependent" | "partner" | "other";
            if (!["spouse", "parent", "child", "sibling", "guardian", "dependent", "partner", "other"].includes(relationshipType)) return false;
            void this.marketplace.createFamilyMember({
              branchId,
              firstName,
              lastName: String(data.lastName || "").trim() || undefined,
              phone: String(data.phone || "").trim() || undefined,
              relationshipType: relationshipType || "other"
            }).then((member) => {
              this.actionUrl.set("");
              this.actionMessage.set(`${member.title || firstName} saved for family booking.`);
            });
            return true;
          }
        }
      ]
    });
    await alert.present();
  }

  async createGoal() {
    const branchId = await this.chooseCommerceBranch("Choose goal salon");
    if (!branchId) return;
    const alert = await this.alerts.create({
      header: "Beauty goal",
      inputs: [
        { name: "title", type: "text", placeholder: "Goal" },
        { name: "targetDate", type: "date" },
        { name: "notes", type: "textarea", placeholder: "Notes" }
      ],
      buttons: [
        { text: "Cancel", role: "cancel" },
        {
          text: "Save",
          handler: (data) => {
            const title = String(data.title || "").trim();
            if (!title) return false;
            void this.marketplace.createGoal({
              branchId,
              title,
              targetDate: String(data.targetDate || "") || undefined,
              notes: String(data.notes || "").trim() || undefined,
              goalType: "other"
            }).then((goal) => {
              this.actionUrl.set("");
              this.actionMessage.set(`${goal.title || title} saved.`);
            });
            return true;
          }
        }
      ]
    });
    await alert.present();
  }

  private async chooseCommerceBranch(header: string): Promise<string> {
    let businesses = this.marketplace.businesses();
    if (!businesses.length) businesses = await this.marketplace.loadPublicBusinesses({ limit: 50 });
    if (!businesses.length) {
      this.actionMessage.set("No active salon is available.");
      return "";
    }
    if (businesses.length === 1) return businesses[0].branchId || businesses[0].id;
    const alert = await this.alerts.create({
      header,
      inputs: businesses.map((business, index) => ({
        type: "radio" as const,
        label: `${business.businessName}${business.address ? ` · ${business.address}` : ""}`,
        value: business.branchId || business.id,
        checked: index === 0
      })),
      buttons: [
        { text: "Cancel", role: "cancel" },
        { text: "Continue", role: "confirm" }
      ]
    });
    await alert.present();
    const result = await alert.onDidDismiss<{ values?: string }>();
    return result.role === "confirm" ? String(result.data?.values || "") : "";
  }

  async shareText(title: string, text: string) {
    const nav = navigator as Navigator & { share?: (data: ShareData) => Promise<void> };
    if (nav.share) {
      await nav.share({ title, text }).catch(() => undefined);
      return;
    }
    await navigator.clipboard?.writeText(text).catch(() => undefined);
    this.actionMessage.set("Share text copied.");
  }

  bookWithContext(context: { clientId?: string; packageCreditId?: string }) {
    localStorage.setItem("auraCustomerBookingContext", JSON.stringify(context));
    this.router.navigateByUrl("/tabs/search");
  }

  private async choosePayableInvoice(invoices: CustomerInvoice[]): Promise<CustomerInvoice | null> {
    if (!invoices.length) {
      this.actionMessage.set("No payable invoice is available.");
      return null;
    }
    if (invoices.length === 1) return invoices[0];
    const alert = await this.alerts.create({
      header: "Choose invoice",
      inputs: invoices.map((invoice, index) => ({
        type: "radio" as const,
        label: `${invoice.invoiceNumber} · ${this.money(invoice.balancePaise)}`,
        value: invoice.id,
        checked: index === 0
      })),
      buttons: [
        { text: "Cancel", role: "cancel" },
        { text: "Continue", role: "confirm" }
      ]
    });
    await alert.present();
    const result = await alert.onDidDismiss<{ values?: string }>();
    const invoiceId = result.role === "confirm" ? String(result.data?.values || "") : "";
    return invoices.find((invoice) => invoice.id === invoiceId) || null;
  }

  private recordsFor(data: CustomerAccountModule | null): HubRecord[] {
    if (!data) return [];
    if (Array.isArray(data)) return data.map((record, index) => this.recordView(record as unknown as Record<string, unknown>, index));
    if (this.isWallet(data)) {
      return [
        {
          key: "wallet-balance",
          status: "Balance",
          title: "Available wallet balance",
          amountPaise: data.balancePaise
        },
        ...data.transactions.map((record, index) => this.recordView(record as unknown as Record<string, unknown>, index))
      ];
    }
    if (this.isRewards(data)) {
      return [
        {
          key: "loyalty-balance",
          status: data.tier || "Loyalty",
          title: "Available loyalty points",
          description: `${data.loyaltyPoints} pts`,
          points: data.loyaltyPoints
        },
        ...data.history.map((record, index) => this.recordView(record as unknown as Record<string, unknown>, index))
      ];
    }
    return [];
  }

  private recordView(record: Record<string, unknown>, index: number): HubRecord {
    const amount = record["amountPaise"] ?? record["balancePaise"] ?? record["pricePaise"] ?? record["totalPaise"] ?? record["remainingLimitPaise"] ?? record["spendingLimitPaise"];
    const credits = Array.isArray(record["serviceCredits"]) ? record["serviceCredits"] as Record<string, unknown>[] : [];
    const packageCredit = credits.find((credit) => Number(credit["remainingQty"] || 0) > 0);
    return {
      key: String(record["id"] || record["code"] || record["invoiceNumber"] || record["type"] || index),
      recordType: String(record["recordType"] || "") || undefined,
      status: String(record["status"] || record["type"] || record["channel"] || "Live record"),
      title: String(record["subject"] || record["planName"] || record["name"] || record["title"] || record["invoiceNumber"] || record["code"] || record["message"] || record["type"] || "Customer record"),
      amountPaise: amount === undefined ? undefined : Number(amount),
      date: String(record["targetDate"] || record["createdAt"] || record["updatedAt"] || record["validityDate"] || record["expiryDate"] || ""),
      description: String(record["benefitLabel"] || record["latestMessage"] || record["freezeReason"] || record["reason"] || record["notes"] || record["relationshipType"] || record["department"] || record["photoType"] || record["goalType"] || "") || undefined,
      reference: String(record["code"] || "") || undefined,
      clientId: String(record["bookingClientId"] || record["relatedClientId"] || record["clientId"] || "") || undefined,
      packageCreditId: packageCredit ? String(packageCredit["id"] || "") : undefined,
      canBook: record["canBook"] === undefined ? undefined : Boolean(record["canBook"]),
      autoRenew: record["autoRenew"] === undefined ? undefined : Boolean(record["autoRenew"]),
      autoRenewStatus: String(record["autoRenewStatus"] || "") || undefined
    };
  }

  private isWallet(data: CustomerAccountModule): data is CustomerWallet {
    return !!data && typeof data === "object" && "transactions" in data;
  }

  private isRewards(data: CustomerAccountModule): data is CustomerRewardSummary {
    return !!data && typeof data === "object" && "loyaltyPoints" in data;
  }
}
