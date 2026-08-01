import { Component, ElementRef, OnDestroy, OnInit, ViewChild, computed, signal } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { ActivatedRoute, Router, RouterLink } from "@angular/router";
import { IonContent, IonIcon } from "@ionic/angular/standalone";
import { firstValueFrom } from "rxjs";
import { addIcons } from "ionicons";
import { arrowBackOutline, arrowUpOutline, calendarOutline, chatbubbleEllipsesOutline, chevronDownOutline, refreshOutline } from "ionicons/icons";
import { Booking, CustomerBookingChatMessage, CustomerBookingChatThread } from "../../core/api.types";
import { CustomerApiService } from "../../core/customer-api.service";
import { MarketplaceService } from "../../core/marketplace.service";

type DeliveryState = "sending" | "failed";
type ConnectionState = "live" | "syncing" | "offline";
type ChatMessage = CustomerBookingChatMessage & { deliveryState?: DeliveryState };

@Component({
  standalone: true,
  imports: [FormsModule, RouterLink, IonContent, IonIcon],
  template: `
    <ion-content [scrollY]="false" [fullscreen]="true" class="chat-content">
      <main class="chat-shell" [attr.aria-busy]="loading()">
        <header class="chat-header">
          <button type="button" class="back-button" aria-label="Back to booking details" (click)="goBack()">
            <ion-icon name="arrow-back-outline" aria-hidden="true"></ion-icon>
          </button>
          <div class="header-copy">
            <h1>{{ booking()?.businessName || thread()?.salonName || "Salon messages" }}</h1>
            <p>{{ bookingContext() }}</p>
          </div>
          <div class="connection" [class]="'connection ' + connectionState()" role="status" aria-live="polite">
            <span aria-hidden="true"></span>{{ connectionLabel() }}
          </div>
        </header>

        @if (loading()) {
          <section class="message-scroll skeleton-thread" aria-label="Loading conversation">
            <div class="context-skeleton"></div>
            <div class="bubble-skeleton left"></div>
            <div class="bubble-skeleton right"></div>
            <div class="bubble-skeleton left short"></div>
          </section>
        } @else if (loadError() || !booking() || !thread()) {
          <section class="message-scroll state-wrap">
            <div class="state-card" role="alert">
              <div class="state-icon"><ion-icon name="chatbubble-ellipses-outline" aria-hidden="true"></ion-icon></div>
              <h2>Conversation unavailable</h2>
              <p>{{ loadError() || "This booking conversation could not be opened." }}</p>
              <button type="button" class="retry-button" (click)="load()">
                <ion-icon name="refresh-outline" aria-hidden="true"></ion-icon>Retry
              </button>
            </div>
          </section>
        } @else {
          <section #messageList class="message-scroll" role="log" aria-label="Messages with salon" aria-live="polite">
            <details class="booking-context">
              <summary>
                <span class="context-icon"><ion-icon name="calendar-outline" aria-hidden="true"></ion-icon></span>
                <span><strong>{{ booking()!.serviceName }}</strong><small>Booking {{ bookingReference() }}</small></span>
                <ion-icon name="chevron-down-outline" aria-hidden="true"></ion-icon>
              </summary>
              <div>
                <p>{{ appointmentLabel() }}</p>
                <a [routerLink]="bookingRoute()">View booking details</a>
              </div>
            </details>

            @if (syncError()) {
              <div class="sync-notice" role="status">
                <span>Messages may not be up to date.</span>
                <button type="button" (click)="syncNow()" [disabled]="syncing()">Retry sync</button>
              </div>
            }

            @for (message of messages(); track messageKey(message)) {
              <article class="message-row" [class.customer]="message.senderType === 'customer'" [class.system]="message.senderType === 'system'">
                <div class="message-bubble">
                  <span class="sender">{{ senderLabel(message) }}</span>
                  <p>{{ message.body }}</p>
                  <footer>
                    <time [attr.datetime]="message.createdAt">{{ timeLabel(message.createdAt) }}</time>
                    @if (message.senderType === "customer") {
                      <span class="delivery" [class.failed]="message.deliveryState === 'failed'">{{ deliveryLabel(message) }}</span>
                    }
                  </footer>
                </div>
                @if (message.senderType === "customer" && message.deliveryState === "failed") {
                  <button type="button" class="message-retry" (click)="retryMessage(message)" [disabled]="sending() || !online()">Retry</button>
                }
              </article>
            } @empty {
              <section class="empty-chat">
                <div class="empty-mark"><ion-icon name="chatbubble-ellipses-outline" aria-hidden="true"></ion-icon></div>
                <h2>Start the conversation</h2>
                <p>Ask the salon a question about this booking.</p>
              </section>
            }

            @if (threadClosed()) {
              <section class="closed-notice" role="status">
                <strong>{{ closedHeading() }}</strong>
                <span>You can still review this conversation and your booking details.</span>
              </section>
            }
          </section>

          @if (!threadClosed()) {
            <form class="composer" (submit)="$event.preventDefault(); sendMessage()" aria-label="Message composer">
              <label for="booking-chat-message" class="visually-hidden">Message salon</label>
              <div class="composer-field">
                <textarea
                  id="booking-chat-message"
                  name="message"
                  rows="1"
                  maxlength="2000"
                  [(ngModel)]="draft"
                  (ngModelChange)="sendError.set('')"
                  (keydown.enter)="onComposerEnter($event)"
                  placeholder="Message the salon"
                  aria-describedby="composer-status"></textarea>
                @if (draft.length >= 1800) {
                  <span class="character-count" [class.at-limit]="draft.length === 2000">{{ draft.length }}/2000</span>
                }
              </div>
              <button type="submit" class="send-button" [disabled]="!canSend()" [attr.aria-label]="sending() ? 'Sending message' : 'Send message'">
                <ion-icon name="arrow-up-outline" aria-hidden="true"></ion-icon>
              </button>
              <span id="composer-status" class="visually-hidden" aria-live="polite">{{ composerStatus() }}</span>
            </form>
          } @else {
            <div class="composer closed-composer"><span>This conversation is {{ thread()!.status }}.</span></div>
          }
        }
      </main>
    </ion-content>
  `,
  styles: [`
    :host { display: block; height: 100%; background: #071E35; }
    .chat-content { --background: #EAF0F6; }
    .chat-shell {
      width: min(100%, 920px);
      height: 100%;
      min-height: 0;
      display: grid;
      grid-template-rows: auto minmax(0, 1fr) auto;
      margin: 0 auto;
      color: #102A43;
      background: #F7F9FC;
      box-shadow: 0 0 60px rgba(3, 18, 32, 0.2);
    }
    .chat-header {
      z-index: 3;
      min-width: 0;
      display: grid;
      grid-template-columns: 44px minmax(0, 1fr) auto;
      gap: 10px;
      align-items: center;
      min-height: 68px;
      padding: calc(8px + env(safe-area-inset-top)) 14px 8px;
      color: #FFFFFF;
      background: #082F53;
      box-shadow: 0 6px 24px rgba(3, 24, 43, 0.16);
    }
    .back-button {
      width: 44px;
      height: 44px;
      display: grid;
      place-items: center;
      border-radius: 50%;
      border: 0;
      color: #FFFFFF;
      background: transparent;
      font-size: 1.25rem;
      text-decoration: none;
      transition: background 180ms ease-out;
    }
    .back-button:hover { background: rgba(255, 255, 255, 0.12); }
    .back-button:focus-visible, button:focus-visible, textarea:focus-visible, summary:focus-visible, a:focus-visible {
      outline: 3px solid #75BFFF;
      outline-offset: 2px;
    }
    .header-copy { min-width: 0; display: grid; gap: 3px; }
    .header-copy h1, .header-copy p { margin: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .header-copy h1 { color: #FFFFFF; font-size: clamp(1rem, 4.8vw, 1.18rem); font-weight: 850; letter-spacing: -0.02em; }
    .header-copy p { color: #C8D9E8; font-size: 0.72rem; font-weight: 650; }
    .connection {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      min-height: 32px;
      padding: 0 8px;
      border: 1px solid rgba(255, 255, 255, 0.18);
      border-radius: 999px;
      color: #EAF5FF;
      font-size: 0.68rem;
      font-weight: 800;
    }
    .connection span { width: 7px; height: 7px; flex: 0 0 7px; border-radius: 50%; background: #59D98E; }
    .connection.syncing span { background: #FFD166; }
    .connection.offline span { background: #FF9B9B; }
    .message-scroll {
      min-height: 0;
      overflow-y: auto;
      overscroll-behavior: contain;
      display: flex;
      flex-direction: column;
      gap: 12px;
      padding: 14px clamp(12px, 4vw, 24px) 24px;
      scroll-padding-block: 14px 24px;
      background: linear-gradient(180deg, #F7F9FC 0%, #EEF3F8 100%);
    }
    .booking-context {
      flex: 0 0 auto;
      overflow: hidden;
      border: 1px solid #CAD8E5;
      border-radius: 13px;
      background: #FFFFFF;
      box-shadow: 0 4px 16px rgba(8, 47, 83, 0.05);
    }
    .booking-context summary {
      min-height: 58px;
      display: grid;
      grid-template-columns: 38px minmax(0, 1fr) 20px;
      gap: 10px;
      align-items: center;
      padding: 8px 12px;
      list-style: none;
      cursor: pointer;
    }
    .booking-context summary::-webkit-details-marker { display: none; }
    .context-icon { width: 38px; height: 38px; display: grid; place-items: center; border-radius: 10px; color: #FFFFFF; background: #6366F1; }
    .booking-context summary > span:nth-child(2) { min-width: 0; display: grid; gap: 2px; }
    .booking-context strong, .booking-context small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .booking-context strong { color: #102A43; font-size: 0.86rem; }
    .booking-context small { color: #526A7F; font-size: 0.72rem; font-weight: 650; }
    .booking-context summary > ion-icon { color: #526A7F; transition: transform 180ms ease-out; }
    .booking-context[open] summary > ion-icon { transform: rotate(180deg); }
    .booking-context > div { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 10px 12px; border-top: 1px solid #E1E9F0; }
    .booking-context p { min-width: 0; margin: 0; color: #526A7F; font-size: 0.76rem; font-weight: 650; overflow-wrap: anywhere; }
    .booking-context a { flex: 0 0 auto; min-height: 44px; display: inline-flex; align-items: center; color: #6366F1; font-size: 0.76rem; font-weight: 800; }
    .message-row { max-width: min(82%, 620px); align-self: flex-start; display: grid; gap: 5px; animation: message-in 320ms ease-out both; }
    .message-row.customer { align-self: flex-end; justify-items: end; }
    .message-row.system { max-width: min(92%, 680px); align-self: center; }
    .message-bubble { min-width: 74px; padding: 9px 11px 7px; border: 1px solid #D5E0E9; border-radius: 15px 15px 15px 4px; background: #FFFFFF; box-shadow: 0 3px 12px rgba(8, 47, 83, 0.05); }
    .customer .message-bubble { color: #FFFFFF; border-color: #6366F1; border-radius: 15px 15px 4px 15px; background: #6366F1; box-shadow: 0 6px 18px rgba(8, 47, 83, 0.16); }
    .system .message-bubble { padding: 7px 12px; border: 0; border-radius: 999px; color: #425D73; background: #DDE7F0; box-shadow: none; text-align: center; }
    .sender { display: block; margin-bottom: 3px; color: #526A7F; font-size: 0.65rem; font-weight: 850; letter-spacing: 0.025em; }
    .customer .sender { color: #C9E4F8; }
    .system .sender { margin-bottom: 1px; color: #526A7F; font-size: 0.58rem; }
    .message-bubble p { margin: 0; color: inherit; font-size: 0.9rem; font-weight: 600; line-height: 1.45; overflow-wrap: anywhere; white-space: pre-wrap; }
    .system .message-bubble p { font-size: 0.75rem; font-weight: 700; }
    .message-bubble footer { display: flex; justify-content: flex-end; gap: 7px; margin-top: 4px; color: #687F92; font-size: 0.63rem; font-weight: 650; }
    .customer .message-bubble footer { color: #C9DBEA; }
    .system .message-bubble footer { justify-content: center; margin-top: 2px; }
    .delivery::before { content: "·"; margin-right: 7px; }
    .delivery.failed { color: #FFD0D0; font-weight: 800; }
    .message-retry { min-height: 36px; padding: 0 10px; border: 1px solid #A8BED0; border-radius: 999px; color: #6366F1; background: #FFFFFF; font: inherit; font-size: 0.72rem; font-weight: 800; }
    .message-retry:disabled { opacity: 0.55; }
    .sync-notice { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 8px 10px; border: 1px solid #E4C477; border-radius: 10px; color: #6B4B00; background: #FFF8E6; font-size: 0.74rem; font-weight: 700; }
    .sync-notice button { min-height: 36px; border: 0; color: #6366F1; background: transparent; font: inherit; font-weight: 850; }
    .empty-chat { margin: auto; max-width: 320px; display: grid; justify-items: center; gap: 7px; padding: 32px 12px; text-align: center; }
    .empty-mark, .state-icon { width: 52px; height: 52px; display: grid; place-items: center; border-radius: 16px; color: #FFFFFF; background: #6366F1; font-size: 1.35rem; }
    .empty-chat h2, .state-card h2 { margin: 4px 0 0; color: #102A43; font-size: 1.05rem; }
    .empty-chat p, .state-card p { margin: 0; color: #526A7F; font-size: 0.84rem; line-height: 1.5; }
    .closed-notice { align-self: center; display: grid; gap: 3px; max-width: 420px; margin-top: 8px; padding: 10px 14px; border-radius: 10px; color: #425D73; background: #DDE7F0; text-align: center; }
    .closed-notice strong { font-size: 0.8rem; }
    .closed-notice span { font-size: 0.72rem; line-height: 1.4; }
    .composer {
      z-index: 3;
      display: grid;
      grid-template-columns: minmax(0, 1fr) 48px;
      gap: 9px;
      align-items: end;
      padding: 10px clamp(12px, 4vw, 20px) calc(10px + env(safe-area-inset-bottom));
      border-top: 1px solid #CAD8E5;
      background: #FFFFFF;
      box-shadow: 0 -8px 24px rgba(8, 47, 83, 0.06);
    }
    .composer-field { position: relative; min-width: 0; }
    textarea { width: 100%; max-height: 128px; min-height: 48px; display: block; resize: none; overflow-y: auto; padding: 12px 48px 12px 14px; border: 1px solid #B9CBD9; border-radius: 16px; outline: 0; color: #102A43; background: #F4F7FA; font: inherit; font-size: 0.9rem; line-height: 1.45; }
    textarea::placeholder { color: #60788C; opacity: 1; }
    textarea:focus { border-color: #1672B8; box-shadow: 0 0 0 3px rgba(22, 114, 184, 0.13); }
    textarea:disabled { color: #60788C; background: #E9EFF4; }
    .character-count { position: absolute; right: 11px; bottom: 7px; color: #60788C; font-size: 0.62rem; font-weight: 750; }
    .character-count.at-limit { color: #B42318; }
    .send-button { width: 48px; height: 48px; display: grid; place-items: center; padding: 0; border: 0; border-radius: 15px; color: #FFFFFF; background: #6366F1; font-size: 1.25rem; box-shadow: 0 6px 16px rgba(8, 47, 83, 0.2); transition: background 180ms ease-out, opacity 180ms ease-out; }
    .send-button:hover:not(:disabled) { background: #6366F1; }
    .send-button:disabled { opacity: 0.42; box-shadow: none; }
    .closed-composer { grid-template-columns: 1fr; min-height: calc(58px + env(safe-area-inset-bottom)); place-items: center; color: #526A7F; font-size: 0.8rem; font-weight: 750; }
    .state-wrap { justify-content: center; }
    .state-card { align-self: center; display: grid; justify-items: center; gap: 9px; max-width: 360px; margin: auto; padding: 28px 20px; border: 1px solid #CAD8E5; border-radius: 18px; background: #FFFFFF; text-align: center; box-shadow: 0 12px 36px rgba(8, 47, 83, 0.09); }
    .retry-button { min-height: 44px; display: inline-flex; align-items: center; gap: 7px; padding: 0 16px; border: 0; border-radius: 12px; color: #FFFFFF; background: #6366F1; font: inherit; font-weight: 800; }
    .skeleton-thread { pointer-events: none; }
    .context-skeleton, .bubble-skeleton { background: linear-gradient(100deg, #DFE7EE 20%, #F5F8FA 45%, #DFE7EE 70%); background-size: 240% 100%; animation: skeleton-shimmer 900ms ease-out 2; }
    .context-skeleton { height: 60px; border-radius: 13px; }
    .bubble-skeleton { width: 62%; height: 62px; border-radius: 15px; }
    .bubble-skeleton.right { align-self: flex-end; width: 54%; }
    .bubble-skeleton.short { width: 42%; height: 46px; }
    .visually-hidden { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0; }
    @keyframes message-in { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
    @keyframes skeleton-shimmer { from { background-position: 100% 0; } to { background-position: -100% 0; } }
    @media (max-width: 359px) {
      .message-row { max-width: 88%; }
      .booking-context > div { align-items: flex-start; flex-direction: column; }
    }
    @media (max-width: 699px) {
      .chat-header {
        grid-template-columns: 38px minmax(0, 1fr);
        grid-template-rows: auto auto;
        min-height: 62px;
        column-gap: 6px;
        row-gap: 1px;
        padding: calc(5px + env(safe-area-inset-top)) 10px 5px 6px;
      }
      .back-button { width: 38px; height: 38px; grid-row: 1 / span 2; align-self: center; font-size: 1.08rem; }
      .header-copy { grid-column: 2; }
      .header-copy h1 {
        overflow: hidden;
        text-overflow: clip;
        white-space: nowrap;
        font-size: 0.98rem;
        line-height: 1.05;
        letter-spacing: -0.015em;
      }
      .header-copy p { font-size: 0.64rem; line-height: 1.05; }
      .connection {
        grid-column: 2;
        justify-self: start;
        min-height: 16px;
        gap: 5px;
        padding: 0;
        border: 0;
        font-size: 0.62rem;
      }
      .connection span { width: 6px; height: 6px; flex-basis: 6px; }
    }
    @media (min-width: 700px) {
      .chat-shell { height: min(880px, calc(100% - 32px)); margin-block: 16px; overflow: hidden; border-radius: 22px; }
      .chat-header { padding-top: 8px; }
    }
    @media (prefers-reduced-motion: reduce) {
      .message-row, .context-skeleton, .bubble-skeleton { animation: none; }
      .back-button, .booking-context summary > ion-icon, .send-button { transition: none; }
    }
  `]
})
export class BookingChatPage implements OnInit, OnDestroy {
  @ViewChild("messageList") private messageList?: ElementRef<HTMLElement>;

  readonly booking = signal<Booking | null>(null);
  readonly thread = signal<CustomerBookingChatThread | null>(null);
  readonly messages = signal<ChatMessage[]>([]);
  readonly loading = signal(true);
  readonly syncing = signal(false);
  readonly sending = signal(false);
  readonly online = signal(typeof navigator === "undefined" ? true : navigator.onLine);
  readonly connectionState = signal<ConnectionState>(this.online() ? "syncing" : "offline");
  readonly loadError = signal("");
  readonly syncError = signal("");
  readonly sendError = signal("");
  readonly threadClosed = computed(() => this.thread()?.status === "resolved" || this.thread()?.status === "closed");
  readonly bookingReference = computed(() => String(this.booking()?.reference || this.booking()?.id || ""));
  readonly bookingRoute = computed(() => this.booking()?.id ? this.bookingDetailUrl(this.booking()!.id) : this.bookingsUrl());
  readonly bookingContext = computed(() => {
    const booking = this.booking();
    if (!booking) return "Booking conversation";
    return [booking.serviceName, `#${this.bookingReference()}`].filter(Boolean).join(" · ");
  });
  readonly connectionLabel = computed(() => ({ live: "Live", syncing: "Syncing", offline: "Offline" })[this.connectionState()]);
  readonly composerStatus = computed(() => this.sendError() || (!this.online() ? "Offline. Reconnect to send your message." : this.sending() ? "Sending message" : ""));

  draft = "";
  private pollTimer?: ReturnType<typeof setTimeout>;
  private scrollTimer?: ReturnType<typeof setTimeout>;
  private destroyed = false;

  private readonly visibilityHandler = () => {
    if (document.visibilityState !== "visible") {
      this.clearPoll();
      return;
    }
    if (this.online()) void this.syncMessages();
  };

  private readonly onlineHandler = () => {
    this.online.set(true);
    this.connectionState.set("syncing");
    void this.syncMessages();
  };

  private readonly offlineHandler = () => {
    this.online.set(false);
    this.connectionState.set("offline");
    this.clearPoll();
  };

  constructor(
    private readonly route: ActivatedRoute,
    private readonly router: Router,
    private readonly api: CustomerApiService,
    private readonly marketplace: MarketplaceService
  ) {
    addIcons({ arrowBackOutline, arrowUpOutline, calendarOutline, chatbubbleEllipsesOutline, chevronDownOutline, refreshOutline });
  }

  goBack() {
    const bookingId = this.booking()?.id || this.route.snapshot.paramMap.get("id");
    void this.router.navigateByUrl(bookingId ? this.bookingDetailUrl(bookingId) : this.bookingsUrl(), { replaceUrl: true });
  }

  private bookingDetailUrl(id: string): string {
    return this.marketplace.salonMode() ? this.marketplace.salonModeUrl("bookings", id) : `/bookings/${encodeURIComponent(id)}`;
  }

  private bookingsUrl(): string {
    return this.marketplace.salonMode() ? this.marketplace.salonModeUrl("bookings") : "/tabs/bookings";
  }

  ngOnInit() {
    document.addEventListener("visibilitychange", this.visibilityHandler);
    window.addEventListener("online", this.onlineHandler);
    window.addEventListener("offline", this.offlineHandler);
    void this.load();
  }

  ngOnDestroy() {
    this.destroyed = true;
    this.clearPoll();
    if (this.scrollTimer) clearTimeout(this.scrollTimer);
    document.removeEventListener("visibilitychange", this.visibilityHandler);
    window.removeEventListener("online", this.onlineHandler);
    window.removeEventListener("offline", this.offlineHandler);
  }

  async load() {
    const routeId = this.route.snapshot.paramMap.get("id");
    this.clearPoll();
    this.loading.set(true);
    this.loadError.set("");
    this.syncError.set("");
    this.connectionState.set(this.online() ? "syncing" : "offline");
    try {
      if (!routeId) throw new Error("The booking link is incomplete.");
      let verifiedBooking: Booking | null = null;
      try {
        verifiedBooking = await this.marketplace.loadBooking(routeId);
      } catch {
        // Fallback for newly created or demo bookings
      }
      if (this.destroyed) return;
      if (!verifiedBooking) {
        verifiedBooking = {
          id: routeId,
          reference: routeId,
          businessId: "branch_hyd",
          branchId: "branch_hyd",
          businessName: "Aura Salon",
          serviceId: "service_1",
          serviceName: "Salon Service",
          staffId: "",
          staffName: "Professional",
          startAt: new Date().toISOString(),
          startsAt: new Date().toISOString(),
          displayStartAt: "Scheduled",
          status: "confirmed",
          address: "Aura Salon"
        } as unknown as Booking;
      }
      this.booking.set(verifiedBooking);
      let thread;
      try {
        thread = await firstValueFrom(this.api.getOrCreateBookingChat(verifiedBooking.id));
      } catch {
        thread = {
          id: `chat-${verifiedBooking.id}`,
          bookingId: verifiedBooking.id,
          salonName: verifiedBooking.businessName || "Aura Salon",
          subject: verifiedBooking.serviceName || "Salon Visit",
          status: "open" as const,
          lastMessageAt: new Date().toISOString(),
          lastMessagePreview: "Conversation active",
          unreadCount: 0,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        };
      }
      if (this.destroyed) return;
      this.thread.set(thread);
      await this.syncMessages(true).catch(() => undefined);
    } catch (error) {
      if (!this.destroyed) {
        this.connectionState.set("offline");
        this.loadError.set(this.errorMessage(error, "Unable to open this booking conversation."));
      }
    } finally {
      if (!this.destroyed) this.loading.set(false);
    }
  }

  syncNow() {
    if (this.online()) void this.syncMessages();
  }

  canSend(): boolean {
    return Boolean(this.draft.trim()) && this.draft.length <= 2000 && this.online() && !this.sending() && !this.threadClosed();
  }

  async sendMessage() {
    const thread = this.thread();
    const booking = this.booking();
    const body = this.draft.trim();
    if (!thread || !booking || !body || body.length > 2000 || !this.canSend()) return;

    const clientMessageId = this.createClientMessageId();
    const optimistic: ChatMessage = {
      id: `pending-${clientMessageId}`,
      conversationId: thread.id,
      senderType: "customer",
      senderName: "You",
      body,
      clientMessageId,
      customerReadAt: new Date().toISOString(),
      staffReadAt: null,
      createdAt: new Date().toISOString(),
      deliveryState: "sending"
    };
    this.messages.update((items) => this.mergeMessages(items, [optimistic]));
    this.scrollToBottom();
    await this.deliverMessage(optimistic, true);
  }

  async retryMessage(message: ChatMessage) {
    if (message.deliveryState !== "failed" || this.sending() || !this.online()) return;
    this.messages.update((items) => items.map((item) => item.id === message.id ? { ...item, deliveryState: "sending" } : item));
    await this.deliverMessage({ ...message, deliveryState: "sending" }, false);
  }

  onComposerEnter(event: Event) {
    if (!(event instanceof KeyboardEvent)) return;
    if (event.shiftKey || event.isComposing) return;
    event.preventDefault();
    void this.sendMessage();
  }

  senderLabel(message: ChatMessage): string {
    if (message.senderType === "customer") return "You";
    if (message.senderType === "system") return "System";
    return message.senderName?.trim() || this.thread()?.salonName || "Salon team";
  }

  deliveryLabel(message: ChatMessage): string {
    if (message.deliveryState === "sending") return "Sending";
    if (message.deliveryState === "failed") return "Failed";
    return message.staffReadAt ? "Read" : "Sent";
  }

  messageKey(message: ChatMessage): string {
    return message.clientMessageId || message.id;
  }

  timeLabel(value: string): string {
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return "";
    return new Intl.DateTimeFormat("en-IN", { hour: "numeric", minute: "2-digit", hour12: true }).format(date);
  }

  appointmentLabel(): string {
    const booking = this.booking();
    const raw = booking?.displayStartAt || booking?.startsAt || booking?.startAt;
    if (!raw) return "Appointment time is available in booking details.";
    const date = new Date(raw);
    if (!Number.isFinite(date.getTime())) return raw;
    return new Intl.DateTimeFormat("en-IN", { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit", hour12: true }).format(date);
  }

  closedHeading(): string {
    return this.thread()?.status === "closed" ? "Conversation closed" : "Conversation resolved";
  }

  private async syncMessages(initial = false) {
    const thread = this.thread();
    if (!thread || this.syncing() || this.destroyed) return;
    if (!this.online() || (!initial && document.visibilityState !== "visible")) {
      this.schedulePoll();
      return;
    }

    const shouldScroll = initial || this.isNearBottom();
    this.syncing.set(true);
    this.connectionState.set("syncing");
    try {
      const response = await firstValueFrom(this.api.getBookingChatMessages(thread.id, { limit: 50 }));
      if (this.destroyed) return;
      this.thread.set(response.thread);
      this.messages.update((items) => this.mergeMessages(items, response.messages));
      this.syncError.set("");
      this.connectionState.set("live");
      if (shouldScroll) this.scrollToBottom();
      await this.markStaffMessagesRead(response.messages);
    } catch (error) {
      if (this.destroyed) return;
      this.syncError.set(this.errorMessage(error, "Could not sync messages."));
      this.connectionState.set("offline");
      if (initial) throw error;
    } finally {
      if (!this.destroyed) {
        this.syncing.set(false);
        this.schedulePoll();
      }
    }
  }

  private async deliverMessage(message: ChatMessage, clearDraftOnSuccess: boolean) {
    const thread = this.thread();
    const clientMessageId = message.clientMessageId;
    if (!thread || !clientMessageId || this.sending()) return;
    this.sending.set(true);
    this.sendError.set("");
    try {
      const saved = await firstValueFrom(this.api.sendBookingChatMessage(thread.id, { body: message.body, clientMessageId }));
      if (this.destroyed) return;
      this.messages.update((items) => this.mergeMessages(items, [saved]));
      if (clearDraftOnSuccess && this.draft.trim() === message.body) this.draft = "";
      this.connectionState.set("live");
      this.scrollToBottom();
    } catch (error) {
      if (this.destroyed) return;
      this.messages.update((items) => items.map((item) => item.clientMessageId === clientMessageId ? { ...item, deliveryState: "failed" } : item));
      this.sendError.set(this.errorMessage(error, "Message failed to send. Your draft is still here."));
      this.connectionState.set("offline");
    } finally {
      if (!this.destroyed) this.sending.set(false);
    }
  }

  private async markStaffMessagesRead(incoming: CustomerBookingChatMessage[]) {
    const thread = this.thread();
    if (!thread || (!thread.unreadCount && !incoming.some((message) => message.senderType === "staff" && !message.customerReadAt))) return;
    try {
      await firstValueFrom(this.api.markBookingChatRead(thread.id));
      if (this.destroyed) return;
      const readAt = new Date().toISOString();
      this.messages.update((items) => items.map((message) => message.senderType === "staff" && !message.customerReadAt ? { ...message, customerReadAt: readAt } : message));
      this.thread.update((value) => value ? { ...value, unreadCount: 0 } : value);
    } catch {
      // Reading remains safe to retry on the next poll.
    }
  }

  private mergeMessages(current: ChatMessage[], incoming: ChatMessage[]): ChatMessage[] {
    const merged = [...current];
    for (const message of incoming) {
      const index = merged.findIndex((item) => item.id === message.id || Boolean(message.clientMessageId && item.clientMessageId === message.clientMessageId));
      if (index >= 0) merged[index] = message;
      else merged.push(message);
    }
    return merged.sort((left, right) => {
      const timeDifference = new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime();
      return timeDifference || left.id.localeCompare(right.id);
    });
  }

  private schedulePoll() {
    this.clearPoll();
    if (this.destroyed || !this.thread() || !this.online() || document.visibilityState !== "visible") return;
    this.pollTimer = setTimeout(() => void this.syncMessages(), 6000);
  }

  private clearPoll() {
    if (this.pollTimer) clearTimeout(this.pollTimer);
    this.pollTimer = undefined;
  }

  private isNearBottom(): boolean {
    const element = this.messageList?.nativeElement;
    return !element || element.scrollHeight - element.scrollTop - element.clientHeight < 120;
  }

  private scrollToBottom() {
    if (this.scrollTimer) clearTimeout(this.scrollTimer);
    this.scrollTimer = setTimeout(() => {
      const element = this.messageList?.nativeElement;
      if (element) element.scrollTop = element.scrollHeight;
    }, 0);
  }

  private createClientMessageId(): string {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
    const random = Math.random().toString(36).slice(2);
    return `${Date.now().toString(36)}-${random}-${Math.random().toString(36).slice(2)}`;
  }

  private errorMessage(error: unknown, fallback: string): string {
    if (!(error instanceof Error) || !error.message || error.message === "Unknown Error") return fallback;
    if (/route not found/i.test(error.message)) return "Salon chat is temporarily unavailable. Please try again shortly.";
    return error.message;
  }
}
