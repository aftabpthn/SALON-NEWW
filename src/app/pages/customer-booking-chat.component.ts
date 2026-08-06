import { DatePipe } from '@angular/common';
import { Component, ElementRef, OnDestroy, OnInit, ViewChild, computed, effect, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { ApiService } from '../core/api.service';
import { AuthSessionService } from '../core/auth-session.service';
import { grantsAllow, staticGrantsForRole } from '../core/permission.guard';
import { AppStateService } from '../core/state/app-state.service';
import { RealtimeFrame, WebSocketService } from '../core/websocket.service';

type ConversationStatus = 'open' | 'waiting_for_salon' | 'waiting_for_customer' | 'resolved' | 'closed';

type BookingChatThread = {
  id: string;
  branchId: string;
  customerId: string;
  bookingId: string;
  salonName: string;
  subject: string;
  status: ConversationStatus;
  assignedUserId: string;
  lastMessageAt: string;
  lastMessagePreview: string;
  unreadCount: number;
  createdAt: string;
  updatedAt: string;
};

type BookingChatMessage = {
  id: string;
  conversationId: string;
  senderType: 'customer' | 'staff';
  senderName: string;
  body: string;
  clientMessageId: string;
  customerReadAt: string | null;
  staffReadAt: string | null;
  createdAt: string;
  delivery?: 'sending' | 'failed';
};

type ConversationListResponse = { conversations: BookingChatThread[] };
type ConversationDetailResponse = { thread: BookingChatThread; messages: BookingChatMessage[] };
type RealtimePayload = { thread?: BookingChatThread; message?: BookingChatMessage };

@Component({
  selector: 'app-customer-booking-chat',
  standalone: true,
  imports: [DatePipe, FormsModule, RouterLink],
  template: `
    <main class="inbox-page">
      <header class="page-header">
        <div>
          <span class="eyebrow">CUSTOMER COMMUNICATIONS</span>
          <h1>Booking inbox</h1>
          <p>Reply to customer questions linked to online bookings.</p>
        </div>
        <div class="live-state" [class.connected]="realtime.connected()">
          <span aria-hidden="true"></span>{{ realtime.connected() ? 'Live' : 'Polling' }}
        </div>
      </header>

      @if (loadError() && !conversations().length) {
        <section class="page-state error-state" role="alert">
          <strong>Booking inbox could not be loaded</strong>
          <p>{{ loadError() }}</p>
          <button type="button" (click)="loadConversations()">Try again</button>
        </section>
      } @else {
        <section class="inbox-shell" [class.thread-open]="activeThread()">
          <aside class="conversation-panel">
            <div class="panel-heading">
              <div><span>CONVERSATIONS</span><h2>Customer chat</h2></div>
              <b [attr.aria-label]="unreadTotal() + ' unread messages'">{{ unreadTotal() }}</b>
            </div>
            <label class="status-filter">
              <span>Filter by status</span>
              <select [ngModel]="statusFilter()" (ngModelChange)="changeFilter($event)">
                <option value="">All statuses</option>
                @for (option of statuses; track option.value) {
                  <option [value]="option.value">{{ option.label }}</option>
                }
              </select>
            </label>

            @if (loadingConversations()) {
              <div class="conversation-loading" aria-label="Loading conversations"><i></i><i></i><i></i></div>
            } @else {
              <nav aria-label="Customer booking conversations">
                @for (thread of conversations(); track thread.id) {
                  <button
                    type="button"
                    class="conversation-row"
                    [class.active]="thread.id === activeConversationId()"
                    [attr.aria-current]="thread.id === activeConversationId() ? 'true' : null"
                    (click)="openConversation(thread.id)"
                  >
                    <span class="avatar" aria-hidden="true">BC</span>
                    <span class="conversation-copy">
                      <span class="row-title"><strong>{{ threadTitle(thread) }}</strong><time [attr.datetime]="thread.lastMessageAt">{{ thread.lastMessageAt | date:'shortTime' }}</time></span>
                      <small>{{ thread.lastMessagePreview || statusLabel(thread.status) }}</small>
                      <span class="row-meta">
                        @if (thread.bookingId) { <span>Booking {{ thread.bookingId }}</span> }
                        <span>{{ statusLabel(thread.status) }}</span>
                      </span>
                    </span>
                    @if (thread.unreadCount > 0) { <b class="unread-badge">{{ thread.unreadCount > 99 ? '99+' : thread.unreadCount }}</b> }
                  </button>
                } @empty {
                  <div class="list-empty"><strong>No customer chats</strong><p>Booking conversations for this branch will appear here.</p></div>
                }
              </nav>
            }
          </aside>

          <section class="message-panel">
            @if (activeThread(); as thread) {
              <header class="thread-header">
                <button #mobileBack class="mobile-back" type="button" (click)="closeMobileThread()" aria-label="Back to conversations">&larr;</button>
                <div class="thread-copy">
                  <h2>{{ threadTitle(thread) }}</h2>
                  <p>
                    @if (thread.salonName) { <span>{{ thread.salonName }}</span> }
                    @if (thread.bookingId) { <span>Booking {{ thread.bookingId }}</span> }
                  </p>
                </div>
                <div class="thread-actions">
                  @if (thread.bookingId) {
                    <a [routerLink]="['/appointments']" [queryParams]="{ appointmentId: thread.bookingId }">Open appointment</a>
                  }
                  <label>
                    <span>Status</span>
                    <select [ngModel]="thread.status" (ngModelChange)="updateStatus($event)" [disabled]="statusSaving() || !canWrite()">
                      @for (option of statuses; track option.value) {
                        <option [value]="option.value">{{ option.label }}</option>
                      }
                    </select>
                  </label>
                </div>
              </header>

              @if (actionError()) {
                <div class="inline-error" role="alert"><span>{{ actionError() }}</span><button type="button" (click)="actionError.set('')">Dismiss</button></div>
              }
              @if (!canWrite()) {
                <div class="read-only" role="status">Read-only access. You can view and mark customer messages as read, but replies and status changes require appointment write access.</div>
              }

              <div #messageViewport class="message-viewport">
                @if (loadingMessages()) {
                  <div class="message-loading" aria-label="Loading messages"><i></i><i class="outbound"></i><i></i></div>
                } @else if (messageError() && !messages().length) {
                  <div class="empty-thread error-thread" role="alert"><strong>Messages could not be loaded</strong><p>{{ messageError() }}</p><button type="button" (click)="loadMessages(true)">Try again</button></div>
                } @else {
                  <div class="message-list" aria-live="polite">
                    @for (message of messages(); track message.id) {
                      <article class="message" [class.outbound]="message.senderType === 'staff'" [class.failed]="message.delivery === 'failed'">
                        <div class="message-meta">
                          <strong>{{ message.senderName || (message.senderType === 'customer' ? 'Customer' : 'Salon staff') }}</strong>
                          <time [attr.datetime]="message.createdAt">{{ message.createdAt | date:'shortTime' }}</time>
                        </div>
                        <p>{{ message.body }}</p>
                        @if (message.delivery) {
                          <div class="delivery-state">
                            <span>{{ message.delivery === 'sending' ? 'Sending...' : 'Not sent' }}</span>
                            @if (message.delivery === 'failed') { <button type="button" (click)="retry(message)" [disabled]="sending()">Retry</button> }
                          </div>
                        }
                      </article>
                    } @empty {
                      <div class="empty-thread"><span aria-hidden="true">BC</span><strong>No messages yet</strong><p>The customer has not sent a message in this booking conversation.</p></div>
                    }
                  </div>
                }
              </div>

              <form class="composer" (submit)="send($event)">
                <label for="booking-chat-message">Reply to this booking conversation</label>
                <textarea
                  #composerInput
                  id="booking-chat-message"
                  name="bookingChatMessage"
                  [(ngModel)]="draft"
                  rows="2"
                  maxlength="2000"
                  [disabled]="sending() || !canWrite()"
                  [placeholder]="canWrite() ? 'Write a reply...' : 'Read-only access'"
                  (keydown)="onComposerKeydown($event)"
                ></textarea>
                <div><small>Enter to send, Shift+Enter for a new line</small><span>{{ draft.length }}/2000</span><button type="submit" [disabled]="!validDraft() || sending() || !canWrite()">{{ sending() ? 'Sending...' : 'Send reply' }}</button></div>
              </form>
            } @else {
              <div class="empty-thread full"><span aria-hidden="true">BI</span><strong>Select a booking conversation</strong><p>Choose a customer chat to read and reply.</p></div>
            }
          </section>
        </section>
      }
    </main>
  `,
  styles: [`
    :host { display: block; min-height: 100%; color: var(--text-primary, #12243a); }
    * { box-sizing: border-box; }
    button, select, textarea { font: inherit; }
    button, a, select { min-height: 44px; }
    .inbox-page { max-width: 1600px; margin: 0 auto; padding: clamp(16px, 2.4vw, 32px); }
    .page-header { display: flex; align-items: flex-end; justify-content: space-between; gap: 20px; margin-bottom: 20px; }
    .eyebrow, .panel-heading span, .status-filter > span { display: block; color: #275f96; font-size: 11px; font-weight: 800; letter-spacing: .12em; }
    h1 { margin: 5px 0; color: #0b2340; font-size: clamp(28px, 3vw, 40px); line-height: 1.08; letter-spacing: -.03em; }
    .page-header p, .thread-header p, .list-empty p, .empty-thread p { margin: 0; color: #64748b; }
    .live-state { display: flex; align-items: center; gap: 8px; min-height: 38px; padding: 8px 13px; border: 1px solid #d9e2ec; border-radius: 999px; color: #52657a; background: #fff; font-size: 12px; font-weight: 750; }
    .live-state span { width: 8px; height: 8px; border-radius: 50%; background: #d0993f; box-shadow: 0 0 0 4px #f8ead2; }
    .live-state.connected span { background: #21875e; box-shadow: 0 0 0 4px #d9f2e7; }
    .inbox-shell { display: grid; grid-template-columns: minmax(290px, 370px) minmax(0, 1fr); min-height: min(720px, calc(100vh - 200px)); overflow: hidden; border: 1px solid #d9e2ec; border-radius: 18px; background: #fff; box-shadow: 0 18px 48px rgba(11, 35, 64, .09); }
    .conversation-panel { min-width: 0; border-right: 1px solid #e3eaf1; background: #f7f9fc; overflow-y: auto; }
    .panel-heading { min-height: 82px; display: flex; align-items: center; justify-content: space-between; padding: 18px 20px; border-bottom: 1px solid #e3eaf1; }
    .panel-heading h2, .thread-header h2 { margin: 3px 0 0; color: #102a48; font-size: 18px; }
    .panel-heading > b { min-width: 28px; height: 28px; display: grid; place-items: center; padding: 0 7px; border-radius: 9px; color: #fff; background: #174e82; font-size: 12px; }
    .status-filter { display: block; padding: 12px 14px; border-bottom: 1px solid #e3eaf1; }
    .status-filter > span { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0, 0, 0, 0); }
    select { border: 1px solid #cdd8e4; border-radius: 9px; padding: 8px 32px 8px 10px; color: #173451; background: #fff; }
    .status-filter select { width: 100%; }
    nav { padding: 8px; }
    .conversation-row { width: 100%; min-height: 88px; display: grid; grid-template-columns: 42px minmax(0, 1fr) auto; align-items: center; gap: 10px; padding: 11px; border: 1px solid transparent; border-radius: 12px; text-align: left; color: inherit; background: transparent; cursor: pointer; transition: background-color .16s ease, border-color .16s ease, box-shadow .16s ease; }
    .conversation-row:hover { border-color: #dce5ee; background: #fff; }
    .conversation-row.active { border-color: #abc4dc; background: #fff; box-shadow: 0 7px 20px rgba(15, 58, 99, .08); }
    .avatar { width: 42px; height: 42px; display: grid; place-items: center; border-radius: 12px; color: #fff; background: #123f6c; font-size: 12px; font-weight: 850; }
    .conversation-copy { min-width: 0; }
    .row-title { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; }
    .row-title strong, .conversation-copy > small { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .row-title strong { color: #173451; font-size: 13px; }
    .row-title time { flex: none; color: #77889a; font-size: 10px; }
    .conversation-copy > small { margin-top: 5px; color: #66788b; font-size: 11px; }
    .row-meta { display: flex; gap: 8px; margin-top: 6px; color: #46627e; font-size: 10px; font-weight: 700; }
    .row-meta span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .unread-badge { min-width: 24px; height: 24px; display: grid; place-items: center; padding: 0 6px; border-radius: 999px; color: #fff; background: #b63d51; font-size: 10px; }
    .message-panel { min-width: 0; display: grid; grid-template-rows: auto auto auto minmax(280px, 1fr) auto; background: #fff; }
    .thread-header { min-height: 82px; display: flex; align-items: center; gap: 14px; padding: 13px 18px; border-bottom: 1px solid #e3eaf1; }
    .thread-copy { min-width: 0; margin-right: auto; }
    .thread-copy h2 { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .thread-copy p { display: flex; gap: 10px; margin-top: 4px; font-size: 11px; }
    .thread-actions { display: flex; align-items: center; gap: 10px; }
    .thread-actions a { display: inline-flex; align-items: center; padding: 0 12px; border: 1px solid #b7c9da; border-radius: 9px; color: #174e82; text-decoration: none; font-size: 12px; font-weight: 750; }
    .thread-actions label { display: grid; gap: 2px; color: #5f7183; font-size: 10px; }
    .thread-actions select { min-height: 34px; }
    .mobile-back { display: none; border: 0; color: #153b61; background: transparent; font-size: 22px; cursor: pointer; }
    .inline-error, .read-only { padding: 9px 15px; font-size: 12px; }
    .inline-error { display: flex; justify-content: space-between; gap: 12px; color: #8d2f3e; background: #fff0f2; }
    .inline-error button { min-height: auto; border: 0; color: inherit; background: none; font-weight: 750; cursor: pointer; }
    .read-only { color: #6d531e; background: #fff8e6; }
    .message-viewport { min-height: 0; overflow-y: auto; padding: 24px clamp(14px, 4vw, 48px); background: #f5f8fc; background-image: radial-gradient(#d4deea .7px, transparent .7px); background-size: 18px 18px; }
    .message-list { display: flex; flex-direction: column; gap: 11px; }
    .message { max-width: min(74%, 640px); align-self: flex-start; padding: 11px 14px; border: 1px solid #dce5ee; border-radius: 5px 16px 16px 16px; background: #fff; box-shadow: 0 4px 14px rgba(17, 48, 78, .05); }
    .message.outbound { align-self: flex-end; border-color: #abc5de; border-radius: 16px 5px 16px 16px; color: #fff; background: #123f6c; }
    .message.failed { border-color: #d88692; background: #7b2937; }
    .message-meta { display: flex; justify-content: space-between; gap: 18px; margin-bottom: 5px; color: #66788b; font-size: 10px; }
    .message.outbound .message-meta { color: #c8d9e9; }
    .message p { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; font-size: 13px; line-height: 1.5; }
    .delivery-state { display: flex; align-items: center; justify-content: flex-end; gap: 8px; margin-top: 7px; color: #d7e4ef; font-size: 10px; }
    .delivery-state button { min-height: 28px; padding: 2px 8px; border: 1px solid currentColor; border-radius: 7px; color: #fff; background: transparent; cursor: pointer; }
    .composer { padding: 13px 16px 15px; border-top: 1px solid #e3eaf1; background: #fff; }
    .composer > label { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0, 0, 0, 0); }
    .composer textarea { width: 100%; resize: vertical; min-height: 62px; max-height: 160px; border: 1px solid #cbd7e3; border-radius: 12px; padding: 11px 13px; color: #142f4b; background: #fafcff; outline: none; }
    .composer textarea:focus, select:focus, button:focus-visible, a:focus-visible { outline: 3px solid rgba(38, 112, 177, .23); outline-offset: 2px; }
    .composer > div { display: flex; align-items: center; gap: 12px; margin-top: 8px; }
    .composer small { margin-right: auto; color: #718295; }
    .composer > div > span { color: #718295; font-size: 11px; }
    .composer button, .page-state button, .empty-thread button { padding: 9px 14px; border: 0; border-radius: 9px; color: #fff; background: #123f6c; font-weight: 750; cursor: pointer; }
    button:disabled, select:disabled, textarea:disabled { opacity: .5; cursor: not-allowed; }
    .empty-thread { min-height: 260px; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 24px; text-align: center; }
    .empty-thread.full { min-height: 100%; }
    .empty-thread > span { width: 54px; height: 54px; display: grid; place-items: center; margin-bottom: 12px; border-radius: 17px; color: #fff; background: #174e82; font-weight: 800; }
    .empty-thread strong, .page-state strong { margin-bottom: 5px; color: #173451; }
    .error-thread p { margin: 5px 0 14px; }
    .list-empty { padding: 32px 18px; text-align: center; font-size: 12px; }
    .list-empty p { margin-top: 5px; }
    .page-state { max-width: 480px; margin: 56px auto; padding: 30px; border: 1px solid #e2c7cc; border-radius: 16px; text-align: center; background: #fff; }
    .page-state p { margin: 6px 0 16px; color: #765c61; }
    .conversation-loading, .message-loading { padding: 16px; }
    .conversation-loading i, .message-loading i { display: block; height: 68px; margin-bottom: 9px; border-radius: 12px; background: linear-gradient(100deg, #e9eef4 20%, #f8fafc 45%, #e9eef4 70%); background-size: 220% 100%; animation: shimmer 1.3s infinite; }
    .message-loading i { width: 55%; }
    .message-loading i.outbound { margin-left: auto; }
    @keyframes shimmer { to { background-position-x: -220%; } }
    @media (max-width: 760px) {
      .inbox-page { padding: 12px; }
      .page-header { align-items: flex-start; }
      .page-header p { display: none; }
      .inbox-shell { display: block; min-height: calc(100dvh - 160px); border-radius: 14px; }
      .conversation-panel, .message-panel { min-height: calc(100dvh - 160px); }
      .inbox-shell:not(.thread-open) .message-panel { display: none; }
      .inbox-shell.thread-open .conversation-panel { display: none; }
      .message-panel { grid-template-rows: auto auto auto minmax(300px, 1fr) auto; }
      .mobile-back { display: inline-grid; place-items: center; flex: 0 0 44px; }
      .thread-header { padding: 10px 8px; }
      .thread-actions a { width: 44px; padding: 0; justify-content: center; overflow: hidden; color: transparent; }
      .thread-actions a::after { content: 'View'; color: #174e82; font-size: 11px; }
      .thread-actions label > span { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0, 0, 0, 0); }
      .thread-actions select { width: 104px; padding-left: 6px; }
      .message { max-width: 88%; }
      .message-viewport { padding: 18px 11px; }
      .composer { padding: 10px; }
      .composer small { display: none; }
    }
    @media (max-width: 380px) {
      .inbox-page { padding: 8px; }
      .page-header { gap: 8px; }
      .live-state { padding: 7px 9px; }
      .thread-copy p, .thread-actions a { display: none; }
      .thread-actions select { width: 98px; }
    }
    @media (prefers-reduced-motion: reduce) {
      *, *::before, *::after { scroll-behavior: auto !important; transition: none !important; animation: none !important; }
    }
  `]
})
export class CustomerBookingChatComponent implements OnInit, OnDestroy {
  @ViewChild('messageViewport') private messageViewport?: ElementRef<HTMLElement>;
  @ViewChild('composerInput') private composerInput?: ElementRef<HTMLTextAreaElement>;

  readonly statuses: ReadonlyArray<{ value: ConversationStatus; label: string }> = [
    { value: 'open', label: 'Open' },
    { value: 'waiting_for_salon', label: 'Waiting for salon' },
    { value: 'waiting_for_customer', label: 'Waiting for customer' },
    { value: 'resolved', label: 'Resolved' },
    { value: 'closed', label: 'Closed' }
  ];
  readonly conversations = signal<BookingChatThread[]>([]);
  readonly messages = signal<BookingChatMessage[]>([]);
  readonly activeConversationId = signal('');
  readonly statusFilter = signal('');
  readonly loadingConversations = signal(true);
  readonly loadingMessages = signal(false);
  readonly sending = signal(false);
  readonly statusSaving = signal(false);
  readonly loadError = signal('');
  readonly messageError = signal('');
  readonly actionError = signal('');
  readonly activeThread = computed(() => this.conversations().find((item) => item.id === this.activeConversationId()) || null);
  readonly unreadTotal = computed(() => this.conversations().reduce((total, item) => total + Number(item.unreadCount || 0), 0));
  readonly canWrite = computed(() => {
    const dynamic = this.auth.currentUser()?.permissions || [];
    const grants = Array.from(new Set([...staticGrantsForRole(this.state.userRole()), ...dynamic]));
    return grantsAllow(grants, 'write:appointments');
  });
  draft = '';

  private pollTimer?: ReturnType<typeof setInterval>;
  private messageRequest = 0;
  private readonly handledRealtimeFrames = new Set<string>();
  private readonly onVisibilityChange = () => {
    if (document.visibilityState !== 'visible') return;
    void this.poll();
  };

  constructor(
    private readonly api: ApiService,
    private readonly auth: AuthSessionService,
    private readonly state: AppStateService,
    readonly realtime: WebSocketService
  ) {
    effect(() => this.handleRealtimeFrames(realtime.events()));
  }

  ngOnInit(): void {
    this.realtime.connect();
    void this.loadConversations();
    document.addEventListener('visibilitychange', this.onVisibilityChange);
    this.pollTimer = setInterval(() => {
      if (document.visibilityState === 'visible') void this.poll();
    }, 15_000);
  }

  ngOnDestroy(): void {
    if (this.pollTimer) clearInterval(this.pollTimer);
    document.removeEventListener('visibilitychange', this.onVisibilityChange);
    this.messageRequest += 1;
  }

  async loadConversations(silent = false): Promise<void> {
    if (!silent) this.loadingConversations.set(true);
    this.loadError.set('');
    try {
      const response = await firstValueFrom(this.api.list<ConversationListResponse>('salon-chat/conversations', {
        status: this.statusFilter(),
        limit: 100
      }));
      const rows = [...(response?.conversations || [])].sort((a, b) => String(b.lastMessageAt || b.updatedAt).localeCompare(String(a.lastMessageAt || a.updatedAt)));
      this.conversations.set(rows);
      if (!rows.some((item) => item.id === this.activeConversationId())) {
        this.activeConversationId.set('');
        this.messages.set([]);
      }
    } catch (error) {
      if (!silent) this.loadError.set(this.requestError(error, 'Check your connection and selected branch.'));
    } finally {
      if (!silent) this.loadingConversations.set(false);
    }
  }

  async changeFilter(status: string): Promise<void> {
    this.statusFilter.set(status);
    await this.loadConversations();
  }

  async openConversation(conversationId: string): Promise<void> {
    if (conversationId === this.activeConversationId() && this.messages().length) return;
    this.activeConversationId.set(conversationId);
    this.messages.set([]);
    this.actionError.set('');
    this.messageError.set('');
    await this.loadMessages(true);
    queueMicrotask(() => this.composerInput?.nativeElement.focus());
  }

  closeMobileThread(): void {
    this.activeConversationId.set('');
    this.messages.set([]);
  }

  async loadMessages(showLoading = false): Promise<void> {
    const conversationId = this.activeConversationId();
    if (!conversationId) return;
    const request = ++this.messageRequest;
    if (showLoading) this.loadingMessages.set(true);
    this.messageError.set('');
    try {
      const response = await firstValueFrom(this.api.list<ConversationDetailResponse>(`salon-chat/conversations/${encodeURIComponent(conversationId)}/messages`, { limit: 100 }));
      if (request !== this.messageRequest || conversationId !== this.activeConversationId()) return;
      this.mergeThread(response.thread);
      this.messages.set(this.dedupeMessages(response.messages || []));
      this.scrollToLatest();
      if (response.thread.unreadCount > 0 || response.messages.some((message) => message.senderType === 'customer' && !message.staffReadAt)) {
        await this.markRead(conversationId);
      }
    } catch (error) {
      if (request === this.messageRequest) this.messageError.set(this.requestError(error, 'Messages could not be loaded.'));
    } finally {
      if (request === this.messageRequest) this.loadingMessages.set(false);
    }
  }

  async send(event?: Event): Promise<void> {
    event?.preventDefault();
    const conversationId = this.activeConversationId();
    const body = this.draft.trim();
    if (!conversationId || body.length < 1 || body.length > 2000 || this.sending()) return;
    const clientMessageId = this.newClientMessageId();
    this.draft = '';
    await this.sendMessage({
      id: `pending-${clientMessageId}`,
      conversationId,
      senderType: 'staff',
      senderName: '',
      body,
      clientMessageId,
      customerReadAt: null,
      staffReadAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      delivery: 'sending'
    });
  }

  async retry(message: BookingChatMessage): Promise<void> {
    if (message.delivery !== 'failed' || this.sending()) return;
    await this.sendMessage({ ...message, delivery: 'sending' });
  }

  async updateStatus(status: ConversationStatus): Promise<void> {
    const conversationId = this.activeConversationId();
    if (!conversationId || !this.canWrite() || this.statusSaving()) return;
    this.statusSaving.set(true);
    this.actionError.set('');
    try {
      const thread = await firstValueFrom(this.api.patch<BookingChatThread>(`salon-chat/conversations/${encodeURIComponent(conversationId)}`, { status }));
      this.mergeThread(thread);
    } catch (error) {
      this.actionError.set(this.requestError(error, 'Status could not be updated.'));
    } finally {
      this.statusSaving.set(false);
    }
  }

  onComposerKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Enter' || event.shiftKey || event.isComposing) return;
    event.preventDefault();
    void this.send();
  }

  threadTitle(thread: BookingChatThread): string {
    return thread.subject || thread.bookingId || 'Booking conversation';
  }

  statusLabel(status: ConversationStatus): string {
    return this.statuses.find((item) => item.value === status)?.label || status;
  }

  validDraft(): boolean {
    const length = this.draft.trim().length;
    return length >= 1 && length <= 2000;
  }

  private async sendMessage(optimistic: BookingChatMessage): Promise<void> {
    this.sending.set(true);
    this.actionError.set('');
    this.messages.update((items) => this.dedupeMessages([...items.filter((item) => item.clientMessageId !== optimistic.clientMessageId), optimistic]));
    this.scrollToLatest();
    try {
      const message = await firstValueFrom(this.api.postWithHeaders<BookingChatMessage>(
        `salon-chat/conversations/${encodeURIComponent(optimistic.conversationId)}/messages`,
        { body: optimistic.body, clientMessageId: optimistic.clientMessageId }
      ));
      if (optimistic.conversationId !== this.activeConversationId()) return;
      this.messages.update((items) => this.dedupeMessages([...items, message]));
      await this.loadMessages(false);
      await this.loadConversations(true);
    } catch (error) {
      this.messages.update((items) => items.map((item) => item.clientMessageId === optimistic.clientMessageId ? { ...item, delivery: 'failed' } : item));
      this.actionError.set(this.requestError(error, 'Reply could not be sent. Retry when you are ready.'));
    } finally {
      this.sending.set(false);
    }
  }

  private async markRead(conversationId: string): Promise<void> {
    if (conversationId !== this.activeConversationId()) return;
    try {
      await firstValueFrom(this.api.postWithHeaders<{ ok: true }>(`salon-chat/conversations/${encodeURIComponent(conversationId)}/read`, {}));
      this.conversations.update((items) => items.map((item) => item.id === conversationId ? { ...item, unreadCount: 0 } : item));
    } catch (error) {
      this.actionError.set(this.requestError(error, 'Customer messages could not be marked as read.'));
    }
  }

  private async poll(): Promise<void> {
    await this.loadConversations(true);
    await this.loadMessages(false);
  }

  private handleRealtimeFrames(frames: RealtimeFrame[]): void {
    for (const frame of [...frames].reverse()) {
      if (!['customer-salon-chat.conversation-created', 'customer-salon-chat.conversation-updated', 'customer-salon-chat.message-created'].includes(frame.type)) continue;
      const payload = (frame.payload || {}) as RealtimePayload;
      const key = frame.meta?.eventId || `${frame.type}:${payload.thread?.id || payload.message?.id || ''}:${payload.thread?.updatedAt || payload.message?.createdAt || ''}`;
      if (!key || this.handledRealtimeFrames.has(key)) continue;
      this.handledRealtimeFrames.add(key);
      if (this.handledRealtimeFrames.size > 300) this.handledRealtimeFrames.delete(this.handledRealtimeFrames.values().next().value as string);
      if (payload.thread) this.mergeThread(payload.thread);
      if (payload.message?.conversationId === this.activeConversationId()) {
        this.messages.update((items) => this.dedupeMessages([...items, payload.message as BookingChatMessage]));
        this.scrollToLatest();
        if (payload.message.senderType === 'customer' && document.visibilityState === 'visible') void this.markRead(payload.message.conversationId);
      }
    }
  }

  private mergeThread(thread: BookingChatThread): void {
    if (!thread?.id) return;
    if (this.statusFilter() && thread.status !== this.statusFilter()) {
      this.conversations.update((items) => items.filter((item) => item.id !== thread.id));
      return;
    }
    this.conversations.update((items) => {
      const next = items.some((item) => item.id === thread.id)
        ? items.map((item) => item.id === thread.id ? { ...item, ...thread } : item)
        : [thread, ...items];
      return next.sort((a, b) => String(b.lastMessageAt || b.updatedAt).localeCompare(String(a.lastMessageAt || a.updatedAt)));
    });
  }

  private dedupeMessages(items: BookingChatMessage[]): BookingChatMessage[] {
    const deduped = new Map<string, BookingChatMessage>();
    for (const item of items) deduped.set(item.clientMessageId || item.id, item);
    return [...deduped.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  }

  private scrollToLatest(): void {
    setTimeout(() => {
      const viewport = this.messageViewport?.nativeElement;
      if (!viewport) return;
      const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
      viewport.scrollTo({ top: viewport.scrollHeight, behavior: reducedMotion ? 'auto' : 'smooth' });
    });
  }

  private requestError(error: unknown, fallback: string): string {
    const status = Number((error as { status?: number })?.status || 0);
    if (status === 403) return 'Read-only access: appointment write permission is required for this action.';
    return this.api.errorText(error, fallback);
  }

  private newClientMessageId(): string {
    return globalThis.crypto?.randomUUID?.() || `chat-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }
}
