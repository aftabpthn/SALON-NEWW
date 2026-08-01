import { Component, OnInit, computed, signal } from "@angular/core";
import { Router, RouterLink } from "@angular/router";
import { IonBackButton, IonButton, IonContent, IonIcon } from "@ionic/angular/standalone";
import { addIcons } from "ionicons";
import { calendarOutline, ellipsisVerticalOutline, notificationsOutline, pricetagOutline, walletOutline } from "ionicons/icons";
import { CustomerNotification } from "../../core/api.types";
import { MarketplaceService } from "../../core/marketplace.service";
import { CustomerApiService } from "../../core/customer-api.service";

type NotificationFilter = "all" | "unread" | "bookings" | "payments" | "offers";

@Component({
  standalone: true,
  imports: [RouterLink, IonBackButton, IonButton, IonContent, IonIcon],
  template: `
    <ion-content>
      <main class="page-narrow notification-page">
        <section class="wallet-screen" aria-labelledby="notifications-title">
          <header class="wallet-heading">
            <div>
              <p class="wallet-eyebrow">Aura inbox</p>
              <div class="wallet-title-row">
                <ion-back-button class="content-back-button" [defaultHref]="backHref()" text=""></ion-back-button>
                <h1 id="notifications-title">Notifications</h1>
              </div>
              <p class="wallet-intro">{{ unreadCount() }} unread &mdash; booking updates, payments, offers and account activity.</p>
            </div>
            <div class="notif-header-actions">
              <details class="notif-menu">
                <summary aria-label="Notification actions"><ion-icon name="ellipsis-vertical-outline" aria-hidden="true"></ion-icon></summary>
                <div class="notif-menu-panel">
                  <button type="button" (click)="markAllRead()" [disabled]="!unreadCount()">Mark all read</button>
                  <button type="button" (click)="markAllUnread()" [disabled]="!notifications().length">Mark all unread</button>
                </div>
              </details>
            </div>
          </header>

          @if (!marketplace.isAuthenticated()) {
            <section class="wallet-state" aria-labelledby="notif-login-title">
              <div class="wallet-state-icon"><ion-icon name="notifications-outline" aria-hidden="true"></ion-icon></div>
              <h2 id="notif-login-title">Login required</h2>
              <p>Sign in to see your notifications.</p>
              <ion-button class="primary-gradient" [routerLink]="['/login']" [queryParams]="{ returnUrl: '/notifications' }">Log in</ion-button>
            </section>
          } @else if (marketplace.loading()) {
            <div class="wallet-loading" role="status">
              <div class="wallet-skeleton">
                <div class="skeleton-block skeleton-balance"></div>
                <div class="skeleton-transactions">
                  @for (item of [1, 2, 3]; track item) {
                    <div class="skeleton-transaction">
                      <span class="skeleton-circle"></span>
                      <span class="skeleton-line"></span>
                      <span class="skeleton-line skeleton-amount"></span>
                    </div>
                  }
                </div>
              </div>
            </div>
          } @else if (marketplace.error()) {
            <section class="wallet-state wallet-error" role="alert" aria-labelledby="notif-error-title">
              <div class="wallet-state-icon"><ion-icon name="information-circle-outline" aria-hidden="true"></ion-icon></div>
              <h2 id="notif-error-title">Could not load notifications</h2>
              <p>{{ marketplace.error() }}</p>
              <ion-button class="primary-gradient" (click)="reload()">Try again</ion-button>
            </section>
          } @else {
            <div class="wallet-content-grid">
              <section class="wallet-activity" aria-labelledby="notif-list-title">
                <div class="wallet-section-heading">
                  <div>
                    <p class="wallet-section-kicker">Your updates</p>
                    <h2 id="notif-list-title">{{ unreadNotifications().length ? unreadNotifications().length + " unread notification" + (unreadNotifications().length === 1 ? "" : "s") : "Recent notifications" }}</h2>
                  </div>
                  <span class="unread-badge section-unread-badge" aria-label="Unread count">{{ unreadCount() }}</span>
                </div>

                @if (visibleNotifications().length) {
                  <div class="wallet-transactions">
                    @for (item of visibleNotifications(); track item.id) {
                      <article class="wallet-transaction" [class.unread]="isUnread(item)" (click)="openNotification(item)">
                        <div class="transaction-icon">
                          <ion-icon [name]="iconFor(item)" aria-hidden="true"></ion-icon>
                        </div>
                        <div class="transaction-copy">
                          <strong>{{ titleFor(item) }}</strong>
                          <span>{{ item.message }}</span>
                          <small>{{ dateLabel(item.scheduledAt || item.createdAt) }}</small>
                        </div>
                        @if (isUnread(item)) {
                          <button type="button" class="read-button" (click)="toggleRead(item, $event)">Mark read</button>
                        } @else {
                          <button type="button" class="read-button" (click)="toggleRead(item, $event)">Unread</button>
                        }
                      </article>
                    }
                  </div>
                } @else {
                  <div class="wallet-empty">
                    <div class="wallet-state-icon"><ion-icon name="notifications-outline" aria-hidden="true"></ion-icon></div>
                    <h3>No notifications</h3>
                    <p>New booking, payment and offer updates will appear here.</p>
                    <a [routerLink]="discoverLink()">Discover salons <ion-icon name="chevron-forward-outline" aria-hidden="true"></ion-icon></a>
                  </div>
                }
              </section>

              <aside class="wallet-guide" aria-labelledby="notif-guide-title">
                <p class="wallet-section-kicker">Stay updated</p>
                <h2 id="notif-guide-title">About notifications</h2>
                <div class="wallet-guide-list">
                  <div>
                    <span class="guide-number">01</span>
                    <p><strong>Booking updates</strong><small>Appointment confirmations, reminders, cancellations and reschedules.</small></p>
                  </div>
                  <div>
                    <span class="guide-number">02</span>
                    <p><strong>Payments & wallet</strong><small>Invoice payments, refunds, wallet credits and gift card activity.</small></p>
                  </div>
                  <div>
                    <span class="guide-number">03</span>
                    <p><strong>Offers & promotions</strong><small>Personalised deals, loyalty rewards and membership benefits.</small></p>
                  </div>
                </div>
                <p class="wallet-guide-note">Notification preferences can be managed from your profile settings.</p>
                <a class="wallet-help-link" [routerLink]="settingsLink()">
                  <ion-icon name="shield-checkmark-outline" aria-hidden="true"></ion-icon>
                  Manage preferences
                </a>
              </aside>
            </div>
          }
        </section>
      </main>
    </ion-content>
  `,
  styles: [`
    .notification-page .wallet-screen { display: grid; gap: 14px; color: var(--text); }

    .wallet-heading { position: relative; display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 2px 0 0; }
    .wallet-heading p, .wallet-heading h1 { margin: 0; }
    .wallet-eyebrow, .wallet-section-kicker { color: var(--primary); font-size: 0.72rem; font-weight: 900; letter-spacing: 0.12em; text-transform: uppercase; }
    .wallet-heading h1 { margin-top: 5px; color: var(--brand-950); font-size: clamp(1.7rem, 7vw, 2.45rem); font-weight: 900; letter-spacing: -0.045em; line-height: 0.98; }
    .wallet-heading .wallet-intro { max-width: 290px; margin-top: 8px; color: var(--muted); font-size: 0.82rem; line-height: 1.45; }
    .wallet-heading .wallet-eyebrow { margin-left: 30px; line-height: 1; }
    .wallet-title-row { display: flex; align-items: center; gap: 6px; margin-top: 0; }
    .wallet-title-row h1 { margin-top: 0; }
    .content-back-button {
      width: 38px;
      height: 38px;
      min-width: 38px;
      margin-left: -8px;
      --color: var(--brand-950);
      --icon-font-size: 25px;
      --background: transparent;
      --border-radius: 12px;
      --padding-start: 0;
      --padding-end: 0;
      filter: drop-shadow(0.45px 0 0 var(--brand-950));
    }

    .notif-header-actions { position: absolute; top: 0; right: -8px; display: flex; align-items: center; gap: 8px; }
    .unread-badge { width: 44px; height: 44px; flex: 0 0 44px; display: grid; place-items: center; border-radius: 999px; color: #FFFFFF; background: linear-gradient(135deg, var(--brand-600), var(--primary)); font-size: 0.96rem; font-weight: 900; box-shadow: 0 12px 24px rgba(99, 102, 241, 0.2); }
    .section-unread-badge { width: 34px; height: 34px; flex-basis: 34px; transform: translate(22px, -24px); font-size: 0.78rem; box-shadow: 0 8px 18px rgba(99, 102, 241, 0.18); }
    .notif-menu { position: relative; }
    .notif-menu summary { width: 38px; height: 38px; display: grid; place-items: center; border: 0; border-radius: 0; color: #06172b; background: transparent; cursor: pointer; list-style: none; box-shadow: none; }
    .notif-menu summary::-webkit-details-marker { display: none; }
    .notif-menu ion-icon { font-size: 1.18rem; filter: drop-shadow(0.7px 0 0 #06172b); }
    .notif-menu-panel { position: absolute; z-index: 10; top: calc(100% + 8px); right: 0; width: 170px; overflow: hidden; border: 1px solid var(--border); border-radius: 16px; background: #FFFFFF; box-shadow: 0 18px 40px rgba(16, 24, 40, 0.14); }
    .notif-menu-panel button { width: 100%; min-height: 42px; padding: 0 14px; border: 0; border-bottom: 1px solid var(--border); color: var(--brand-950); background: #FFFFFF; font-size: 0.8rem; font-weight: 850; text-align: left; }
    .notif-menu-panel button:last-child { border-bottom: 0; }
    .notif-menu-panel button:disabled { color: var(--muted); opacity: 0.55; }

    .inbox-actions { display: grid; gap: 10px; }
    .pill-row { display: flex; flex-wrap: wrap; gap: 7px; }
    .pill { min-height: 34px; padding: 0 15px; border: 1px solid rgba(99, 102, 241, 0.18); border-radius: 999px; color: var(--muted); background: #FFFFFF; font-size: 0.74rem; font-weight: 850; cursor: pointer; }
    .pill.active { color: #FFFFFF; background: linear-gradient(135deg, var(--brand-600), var(--primary)); border-color: transparent; }
    .button-row { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
    .button-row ion-button { min-height: 40px; margin: 0; font-size: 0.76rem; --border-radius: 999px; }

    .wallet-content-grid { display: grid; gap: 16px; align-items: start; min-width: 0; }
    .wallet-activity, .wallet-guide, .wallet-state { min-width: 0; border: 1px solid var(--border); border-radius: var(--radius-lg); background: #FFFFFF; box-shadow: 0 14px 36px rgba(16, 24, 40, 0.08); }
    .wallet-activity { overflow: hidden; }
    .wallet-section-heading { display: flex; align-items: end; justify-content: space-between; gap: 16px; padding: clamp(18px, 3vw, 26px); border-bottom: 1px solid var(--border); }
    .wallet-section-heading p, .wallet-section-heading h2 { margin: 0; }
    .wallet-section-heading h2 { margin-top: 4px; color: var(--brand-950); font-size: clamp(1.25rem, 3vw, 1.65rem); font-weight: 900; letter-spacing: -0.035em; line-height: 1.1; }
    .wallet-transactions { display: grid; }
    .wallet-transaction { min-width: 0; display: grid; grid-template-columns: 44px minmax(0, 1fr) auto; align-items: center; gap: 12px; padding: 17px clamp(16px, 3vw, 26px); cursor: pointer; }
    .wallet-transaction + .wallet-transaction { border-top: 1px solid rgba(203, 213, 225, 0.74); }
    .wallet-transaction.unread { background: linear-gradient(145deg, rgba(255,255,255,0.98), rgba(231,240,248,0.9)); }
    .transaction-icon { width: 44px; height: 44px; display: grid; place-items: center; border-radius: 14px; color: #087443; background: #E8F8F0; font-size: 1.12rem; }
    .transaction-copy { min-width: 0; display: grid; gap: 3px; }
    .transaction-copy strong { color: var(--text); font-size: 0.9rem; font-weight: 850; line-height: 1.25; overflow-wrap: anywhere; }
    .transaction-copy span, .transaction-copy small { color: var(--muted); font-size: 0.73rem; font-weight: 700; line-height: 1.35; overflow-wrap: anywhere; }

    .read-button { min-height: 36px; padding: 0 12px; border: 1px solid rgba(99, 102, 241, 0.28); border-radius: 999px; color: var(--primary); background: rgba(255, 255, 255, 0.94); font-weight: 900; flex: 0 0 auto; }

    .wallet-empty, .wallet-state { display: grid; justify-items: center; padding: clamp(32px, 7vw, 68px) clamp(20px, 5vw, 40px); text-align: center; }
    .wallet-empty { padding: clamp(28px, 6vw, 54px) clamp(18px, 4vw, 30px); }
    .wallet-state-icon { width: 52px; height: 52px; display: grid; place-items: center; border-radius: 17px; color: var(--primary); background: var(--primary-soft); font-size: 1.35rem; }
    .wallet-empty h3, .wallet-empty p, .wallet-state h2, .wallet-state p { margin: 0; }
    .wallet-empty h3, .wallet-state h2 { margin-top: 17px; color: var(--brand-950); font-size: clamp(1.2rem, 3vw, 1.55rem); font-weight: 900; letter-spacing: -0.03em; }
    .wallet-empty p, .wallet-state p { max-width: 520px; margin-top: 7px; color: var(--muted); font-size: 0.88rem; line-height: 1.55; }
    .wallet-empty a { min-height: 44px; display: inline-flex; align-items: center; gap: 6px; margin-top: 12px; color: var(--primary); font-size: 0.86rem; font-weight: 850; text-decoration: none; }
    .wallet-state ion-button { margin-top: 18px; }
    .wallet-error .wallet-state-icon { color: #B42318; background: #FEECE9; }

    .wallet-loading { display: grid; gap: 16px; }
    .wallet-skeleton { display: grid; gap: 18px; padding: 24px; border: 1px solid var(--border); border-radius: var(--radius-lg); background: #FFFFFF; box-shadow: 0 14px 36px rgba(16, 24, 40, 0.08); }
    .skeleton-block { background: #E8EEF4; animation: wallet-skeleton 1.4s ease-in-out infinite; }
    .skeleton-balance { min-height: 180px; border-radius: clamp(18px, 4vw, 26px); }
    .skeleton-transactions { display: grid; gap: 14px; }
    .skeleton-transaction { display: grid; grid-template-columns: 44px minmax(0, 1fr) minmax(60px, 0.25fr); align-items: center; gap: 12px; }
    .skeleton-line { width: 56%; height: 12px; border-radius: 999px; background: #E8EEF4; animation: wallet-skeleton 1.4s ease-in-out infinite; }
    .skeleton-circle { width: 44px; height: 44px; border-radius: 14px; background: #E8EEF4; animation: wallet-skeleton 1.4s ease-in-out infinite; }
    .skeleton-title { width: 42%; height: 20px; }
    .skeleton-amount { width: 28%; }
    .wallet-guide-skeleton { min-height: 300px; }
    @keyframes wallet-skeleton { 0%, 100% { opacity: 0.58; } 50% { opacity: 1; } }

    .wallet-guide { padding: clamp(20px, 3vw, 26px); }
    .wallet-guide > p, .wallet-guide > h2 { margin: 0; }
    .wallet-guide > h2 { margin-top: 4px; color: var(--brand-950); font-size: clamp(1.25rem, 3vw, 1.65rem); font-weight: 900; letter-spacing: -0.035em; line-height: 1.1; }
    .wallet-guide-list { display: grid; margin-top: 22px; }
    .wallet-guide-list > div { display: grid; grid-template-columns: 34px minmax(0, 1fr); gap: 12px; padding: 15px 0; border-top: 1px solid var(--border); }
    .guide-number { color: var(--primary); font-size: 0.72rem; font-weight: 900; letter-spacing: 0.06em; }
    .wallet-guide-list p, .wallet-guide-list strong, .wallet-guide-list small { margin: 0; }
    .wallet-guide-list p { display: grid; gap: 4px; }
    .wallet-guide-list strong { color: var(--text); font-size: 0.9rem; font-weight: 850; }
    .wallet-guide-list small { color: var(--muted); font-size: 0.78rem; line-height: 1.45; }
    .wallet-guide-note { margin: 16px 0 0; color: var(--muted); font-size: 0.78rem; line-height: 1.5; font-weight: 700; }
    .wallet-help-link { min-height: 44px; display: inline-flex; align-items: center; justify-content: space-between; gap: 7px; width: 100%; margin-top: 6px; padding-top: 10px; border-top: 1px solid var(--border); color: var(--primary); font-size: 0.88rem; font-weight: 850; text-decoration: none; }

    @media (min-width: 800px) {
      .wallet-content-grid { grid-template-columns: 1fr 280px; }
    }
    @media (max-width: 599px) {
      .wallet-transaction { grid-template-columns: 44px minmax(0, 1fr); }
      .wallet-transaction .read-button { grid-column: 1 / -1; justify-self: start; }
      .button-row { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    }
  `]
})
export class NotificationsPage implements OnInit {
  readonly filter = signal<NotificationFilter>("all");
  readonly readIds = signal(new Set<string>(this.restoreReadIds()));
  readonly unreadIds = signal(new Set<string>());
  readonly filters: Array<{ key: NotificationFilter; label: string }> = [
    { key: "all", label: "All" },
    { key: "unread", label: "Unread" },
    { key: "bookings", label: "Bookings" },
    { key: "payments", label: "Payments" },
    { key: "offers", label: "Offers" }
  ];
  readonly notifications = computed(() => {
    const data = this.marketplace.accountModule();
    return Array.isArray(data)
      ? data.filter((item): item is CustomerNotification => Boolean(item && typeof item === "object" && "id" in item && "type" in item && "message" in item))
      : [];
  });
  readonly unreadCount = computed(() => this.notifications().filter((item) => this.isUnread(item)).length);
  readonly unreadNotifications = computed(() => this.notifications().filter((item) => this.isUnread(item)));
  readonly visibleNotifications = computed(() => {
    const unread = this.unreadNotifications();
    return unread.length ? unread : this.notifications().slice(0, 3);
  });
  readonly filteredNotifications = computed(() => this.notifications().filter((item) => this.matchesFilter(item)));

  constructor(readonly marketplace: MarketplaceService, private readonly router: Router, private readonly api: CustomerApiService) {
    addIcons({ calendarOutline, ellipsisVerticalOutline, notificationsOutline, pricetagOutline, walletOutline });
  }

  backHref(): string {
    return this.marketplace.salonMode() ? this.marketplace.salonModeUrl() : "/tabs/profile";
  }

  discoverLink(): string {
    return this.marketplace.salonMode() ? this.marketplace.salonModeUrl() : "/tabs/search";
  }

  settingsLink(): string {
    return this.marketplace.salonMode() ? this.marketplace.salonModeUrl("settings") : "/settings";
  }

  ngOnInit() {
    this.reload();
  }

  reload() {
    if (this.marketplace.isAuthenticated()) {
      void this.marketplace.loadAccountModule("notifications").catch(() => undefined);
    }
  }

  isUnread(item: CustomerNotification): boolean {
    return this.unreadIds().has(item.id) || (item.status !== "read" && !this.readIds().has(item.id));
  }

  markAllRead() {
    const previous = new Set(this.readIds());
    const next = new Set(this.readIds());
    this.notifications().forEach((item) => next.add(item.id));
    this.unreadIds.set(new Set());
    this.persist(next);
    this.api.markAllNotificationsRead().subscribe({ error: () => { this.persist(previous); this.reload(); } });
  }

  markAllUnread() {
    const previousRead = new Set(this.readIds());
    const previousUnread = new Set(this.unreadIds());
    const unread = new Set(this.notifications().map((item) => item.id));
    this.unreadIds.set(unread);
    this.persist(new Set());
    this.notifications().forEach((item) => {
      this.api.updateNotificationStatus(item.id, "unread").subscribe({
        error: () => {
          this.unreadIds.set(previousUnread);
          this.persist(previousRead);
          this.reload();
        }
      });
    });
  }

  toggleRead(item: CustomerNotification, event: Event) {
    event.stopPropagation();
    const wasUnread = this.isUnread(item);
    const previousRead = new Set(this.readIds());
    const previousUnread = new Set(this.unreadIds());
    const next = new Set(this.readIds());
    const unread = new Set(this.unreadIds());
    if (wasUnread) {
      next.add(item.id);
      unread.delete(item.id);
    } else {
      next.delete(item.id);
      unread.add(item.id);
    }
    this.unreadIds.set(unread);
    this.persist(next);
    this.api.updateNotificationStatus(item.id, wasUnread ? "read" : "unread").subscribe({
      error: () => {
        this.unreadIds.set(previousUnread);
        this.persist(previousRead);
        this.reload();
      }
    });
  }

  openNotification(item: CustomerNotification) {
    const next = new Set(this.readIds());
    next.add(item.id);
    const unread = new Set(this.unreadIds());
    unread.delete(item.id);
    this.unreadIds.set(unread);
    this.persist(next);
    if (item.status !== "read") this.api.updateNotificationStatus(item.id, "read").subscribe({ error: () => undefined });
    void this.router.navigateByUrl(this.deepLinkFor(item));
  }

  iconFor(item: CustomerNotification): string {
    const text = this.searchText(item);
    if (text.includes("payment") || text.includes("invoice") || text.includes("wallet")) return "wallet-outline";
    if (text.includes("offer") || text.includes("deal") || text.includes("promo")) return "pricetag-outline";
    if (text.includes("booking") || text.includes("appointment")) return "calendar-outline";
    return "notifications-outline";
  }

  titleFor(item: CustomerNotification): string {
    if (item.title) return item.title;
    if (item.type) return this.titleCase(item.type);
    if (item.channel) return this.titleCase(item.channel);
    return "AuraSalon update";
  }

  dateLabel(value: string): string {
    const time = value ? new Date(value).getTime() : 0;
    if (!Number.isFinite(time) || !time) return "Just now";
    return new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short", hour: "numeric", minute: "2-digit", hour12: true }).format(new Date(time));
  }

  private matchesFilter(item: CustomerNotification): boolean {
    const filter = this.filter();
    if (filter === "all") return true;
    if (filter === "unread") return this.isUnread(item);
    const text = this.searchText(item);
    if (filter === "bookings") return text.includes("booking") || text.includes("appointment");
    if (filter === "payments") return text.includes("payment") || text.includes("invoice") || text.includes("wallet");
    return text.includes("offer") || text.includes("deal") || text.includes("promo");
  }

  private deepLinkFor(item: CustomerNotification): string {
    if (item.deepLink && this.isSafeDeepLink(item.deepLink)) return this.scopeDeepLink(item.deepLink);
    const text = this.searchText(item);
    if (text.includes("payment") || text.includes("invoice") || text.includes("wallet")) return this.scopeDeepLink("/tabs/wallet");
    if (text.includes("offer") || text.includes("deal") || text.includes("promo")) return this.scopeDeepLink("/tabs/offers");
    if (text.includes("booking") || text.includes("appointment")) return this.scopeDeepLink("/tabs/bookings");
    return this.scopeDeepLink("/tabs/profile");
  }

  private scopeDeepLink(value: string): string {
    if (!this.marketplace.salonMode()) return value;
    if (value.startsWith("/bookings/")) return this.marketplace.salonModeUrl("bookings", value.slice("/bookings/".length));
    if (value.startsWith("/tabs/")) {
      const segment = value.slice("/tabs/".length);
      return segment === "profile" || segment === "search" || segment === "offers" ? this.marketplace.salonModeUrl() : this.marketplace.salonModeUrl(segment);
    }
    if (value === "/notifications") return this.marketplace.salonModeUrl("notifications");
    return value;
  }

  private searchText(item: CustomerNotification): string {
    return `${item.type} ${item.channel} ${item.title || ""} ${item.message} ${item.status}`.toLowerCase();
  }

  private isSafeDeepLink(value: string): boolean {
    return /^(?:\/bookings\/[A-Za-z0-9_-]+(?:\/chat)?|\/tabs\/(?:bookings|wallet|offers|rewards|memberships|profile)|\/notifications)$/.test(value);
  }

  private persist(ids: Set<string>) {
    this.readIds.set(ids);
    localStorage.setItem("aura_customer_read_notifications", JSON.stringify([...ids]));
  }

  private restoreReadIds(): string[] {
    try {
      const value = JSON.parse(localStorage.getItem("aura_customer_read_notifications") || "[]") as string[];
      return Array.isArray(value) ? value : [];
    } catch {
      return [];
    }
  }

  private titleCase(value: string): string {
    return value.replace(/[_-]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
  }
}
