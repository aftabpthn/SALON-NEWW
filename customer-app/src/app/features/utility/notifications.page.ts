import { Component, OnInit, computed, signal } from "@angular/core";
import { Router, RouterLink } from "@angular/router";
import { IonBackButton, IonButton, IonButtons, IonContent, IonHeader, IonIcon, IonToolbar } from "@ionic/angular/standalone";
import { addIcons } from "ionicons";
import { calendarOutline, checkmarkDoneOutline, notificationsOutline, pricetagOutline, refreshOutline, walletOutline } from "ionicons/icons";
import { CustomerNotification } from "../../core/api.types";
import { MarketplaceService } from "../../core/marketplace.service";

type NotificationFilter = "all" | "unread" | "bookings" | "payments" | "offers";

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
      <main class="page-narrow notification-page">
        <section class="notification-hero premium-card">
          <div>
            <h1>Customer inbox</h1>
            <p class="muted">{{ unreadCount() }} unread updates from bookings, payments, offers, and account activity.</p>
          </div>
          <span class="unread-badge" aria-label="Unread notifications">{{ unreadCount() }}</span>
        </section>

        <div class="inbox-actions">
          <div class="pill-row" aria-label="Notification filters">
            @for (item of filters; track item.key) {
              <button type="button" class="pill" [class.active]="filter() === item.key" (click)="filter.set(item.key)">
                {{ item.label }}
              </button>
            }
          </div>
          <div class="button-row">
            <ion-button fill="outline" class="secondary-button" (click)="markAllRead()" [disabled]="!unreadCount()">
              <ion-icon name="checkmark-done-outline" slot="start"></ion-icon>
              Mark all read
            </ion-button>
            <ion-button fill="outline" class="secondary-button" (click)="reload()">
              <ion-icon name="refresh-outline" slot="start"></ion-icon>
              Refresh
            </ion-button>
          </div>
        </div>

        @if (marketplace.loading()) {
          <section class="skeleton-list" aria-label="Loading notifications">
            @for (item of [1, 2, 3]; track item) {
              <div class="skeleton-row"></div>
            }
          </section>
        }

        @if (marketplace.error()) {
          <section class="premium-card state-card error">
            <h2>Could not load notifications</h2>
            <p>{{ marketplace.error() }}</p>
            <ion-button class="primary-gradient" (click)="reload()">Retry</ion-button>
          </section>
        }

        <section class="notification-list" aria-label="Notification list">
          @for (item of filteredNotifications(); track item.id) {
            <article class="premium-card notification-card" [class.unread]="isUnread(item)" (click)="openNotification(item)">
              <ion-icon [name]="iconFor(item)"></ion-icon>
              <div>
                <div class="notification-title">
                  <strong>{{ titleFor(item) }}</strong>
                  @if (isUnread(item)) {
                    <span>Unread</span>
                  }
                </div>
                <p>{{ item.message }}</p>
                <small>{{ dateLabel(item.createdAt) }}</small>
              </div>
              <button type="button" class="read-button" (click)="toggleRead(item, $event)">
                {{ isUnread(item) ? "Mark read" : "Unread" }}
              </button>
            </article>
          } @empty {
            <section class="premium-card empty-state">
              <ion-icon name="notifications-outline"></ion-icon>
              <h2>No notifications here</h2>
              <ion-button class="primary-gradient" routerLink="/tabs/search">Discover salons</ion-button>
            </section>
          }
        </section>
      </main>
    </ion-content>
  `,
  styles: [`
    .notification-page {
      display: grid;
      gap: 16px;
    }

    .notification-hero {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 18px;
      padding: 22px;
    }

    .notification-hero h1 {
      margin: 0;
      font-size: clamp(2rem, 6vw, 3.6rem);
      letter-spacing: 0;
      line-height: 1;
    }

    .notification-hero p {
      margin: 8px 0 0;
    }

    .unread-badge {
      min-width: 54px;
      height: 54px;
      display: grid;
      place-items: center;
      border-radius: 999px;
      color: #120D05;
      background: linear-gradient(135deg, #F4D58D, #D6A94A);
      font-size: 1.25rem;
      font-weight: 900;
      box-shadow: 0 16px 34px rgba(214, 169, 74, 0.22);
    }

    .inbox-actions,
    .button-row {
      display: grid;
      gap: 10px;
    }

    .button-row {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }

    .notification-list {
      display: grid;
      gap: 12px;
    }

    .notification-card {
      display: grid;
      grid-template-columns: auto minmax(0, 1fr) auto;
      gap: 12px;
      align-items: center;
      padding: 16px;
      cursor: pointer;
    }

    .notification-card.unread {
      border-color: rgba(214, 169, 74, 0.42) !important;
      background: linear-gradient(145deg, rgba(255, 255, 255, 0.98), rgba(244, 213, 141, 0.2)) !important;
    }

    .notification-card > ion-icon,
    .empty-state ion-icon {
      width: 44px;
      height: 44px;
      padding: 11px;
      border-radius: 16px;
      color: #120D05;
      background: linear-gradient(135deg, #F4D58D, #D6A94A);
    }

    .notification-title {
      display: flex;
      align-items: center;
      gap: 8px;
      justify-content: space-between;
    }

    .notification-title strong {
      font-size: 1rem;
    }

    .notification-title span {
      padding: 4px 8px;
      border-radius: 999px;
      color: #7A5019;
      background: rgba(214, 169, 74, 0.16);
      font-size: 0.7rem;
      font-weight: 900;
    }

    .notification-card p,
    .notification-card small {
      margin: 4px 0 0;
      color: var(--muted);
      font-weight: 800;
      line-height: 1.4;
    }

    .read-button {
      min-height: 36px;
      padding: 0 12px;
      border: 1px solid rgba(214, 169, 74, 0.28);
      border-radius: 999px;
      color: var(--primary);
      background: rgba(255, 249, 236, 0.9);
      font-weight: 900;
    }

    .state-card,
    .empty-state {
      padding: 22px;
    }

    .empty-state {
      display: grid;
      justify-items: start;
      gap: 10px;
    }

    .empty-state h2,
    .state-card h2 {
      margin: 0;
      letter-spacing: 0;
    }

    .empty-state p,
    .state-card p {
      margin: 0;
    }

    .skeleton-list {
      display: grid;
      gap: 12px;
    }

    .skeleton-row {
      height: 88px;
      border-radius: var(--radius-lg);
      background: linear-gradient(90deg, rgba(214, 169, 74, 0.1), rgba(244, 213, 141, 0.22), rgba(214, 169, 74, 0.1));
      animation: pulse 1.15s ease-in-out infinite;
    }

    @keyframes pulse {
      0%, 100% { opacity: 0.58; }
      50% { opacity: 1; }
    }

    @media (max-width: 599px) {
      .notification-hero,
      .notification-card,
      .button-row {
        grid-template-columns: 1fr;
      }

      .notification-hero {
        display: grid;
      }

      .read-button {
        width: 100%;
      }
    }
  `]
})
export class NotificationsPage implements OnInit {
  readonly filter = signal<NotificationFilter>("all");
  readonly readIds = signal(new Set<string>(this.restoreReadIds()));
  readonly filters: Array<{ key: NotificationFilter; label: string }> = [
    { key: "all", label: "All" },
    { key: "unread", label: "Unread" },
    { key: "bookings", label: "Bookings" },
    { key: "payments", label: "Payments" },
    { key: "offers", label: "Offers" }
  ];
  readonly notifications = computed(() => {
    const data = this.marketplace.accountModule();
    return Array.isArray(data) ? data as CustomerNotification[] : [];
  });
  readonly unreadCount = computed(() => this.notifications().filter((item) => this.isUnread(item)).length);
  readonly filteredNotifications = computed(() => this.notifications().filter((item) => this.matchesFilter(item)));

  constructor(readonly marketplace: MarketplaceService, private readonly router: Router) {
    addIcons({ calendarOutline, checkmarkDoneOutline, notificationsOutline, pricetagOutline, refreshOutline, walletOutline });
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
    return item.status !== "read" && !this.readIds().has(item.id);
  }

  markAllRead() {
    const next = new Set(this.readIds());
    this.notifications().forEach((item) => next.add(item.id));
    this.persist(next);
  }

  toggleRead(item: CustomerNotification, event: Event) {
    event.stopPropagation();
    const next = new Set(this.readIds());
    if (next.has(item.id)) next.delete(item.id);
    else next.add(item.id);
    this.persist(next);
  }

  openNotification(item: CustomerNotification) {
    const next = new Set(this.readIds());
    next.add(item.id);
    this.persist(next);
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
    const text = this.searchText(item);
    if (text.includes("payment") || text.includes("invoice") || text.includes("wallet")) return "/tabs/wallet";
    if (text.includes("offer") || text.includes("deal") || text.includes("promo")) return "/tabs/offers";
    if (text.includes("booking") || text.includes("appointment")) return "/tabs/bookings";
    return "/tabs/profile";
  }

  private searchText(item: CustomerNotification): string {
    return `${item.type} ${item.channel} ${item.message} ${item.status}`.toLowerCase();
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
