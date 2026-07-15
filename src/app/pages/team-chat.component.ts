import { DatePipe } from '@angular/common';
import { Component, ElementRef, OnDestroy, OnInit, ViewChild, computed, effect, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { ApiService } from '../core/api.service';
import { AuthSessionService } from '../core/auth-session.service';
import { WebSocketService } from '../core/websocket.service';

type ChatConversation = {
  id: string;
  type: 'team' | 'private-owner';
  title: string;
  branchId: string;
  messageCount: number;
  lastMessageAt?: string;
  updatedAt: string;
};

type ChatMessage = {
  id: string;
  conversationId: string;
  type: 'team' | 'private-owner';
  senderUserId: string;
  senderName: string;
  body: string;
  createdAt: string;
};

@Component({
  selector: 'app-team-chat',
  standalone: true,
  imports: [DatePipe, FormsModule],
  template: `
    <main class="chat-page">
      <header class="page-header">
        <div>
          <span class="eyebrow">STAFF COMMUNICATIONS</span>
          <h1>Team Chat</h1>
          <p>Speak with your branch team or reply privately to a staff member.</p>
        </div>
        <div class="live-state" [class.connected]="realtime.connected()">
          <span></span>{{ realtime.connected() ? 'Live' : 'Syncing' }}
        </div>
      </header>

      @if (loadError() && !conversations().length) {
        <section class="empty-state error-state" role="alert">
          <strong>Chat could not be loaded</strong>
          <p>{{ loadError() }}</p>
          <button type="button" (click)="loadConversations()">Try again</button>
        </section>
      } @else {
        <section class="chat-shell">
          <aside class="conversation-panel">
            <div class="panel-heading">
              <div><span>CONVERSATIONS</span><h2>Staff inbox</h2></div>
              <b>{{ conversations().length }}</b>
            </div>

            @if (loadingConversations()) {
              <div class="conversation-loading"><i></i><i></i><i></i></div>
            } @else {
              <nav aria-label="Staff conversations">
                @for (conversation of conversations(); track conversation.id) {
                  <button
                    type="button"
                    class="conversation-row"
                    [class.active]="conversation.id === activeConversationId()"
                    (click)="openConversation(conversation.id)"
                  >
                    <span class="avatar" [class.team]="conversation.type === 'team'">{{ conversation.type === 'team' ? 'T' : initials(conversation.title) }}</span>
                    <span class="conversation-copy">
                      <strong>{{ conversation.title }}</strong>
                      <small>{{ conversation.type === 'team' ? 'Everyone in this branch' : 'Private staff conversation' }}</small>
                    </span>
                    <span class="message-count">{{ conversation.messageCount }}</span>
                  </button>
                } @empty {
                  <div class="list-empty"><strong>No conversations yet</strong><p>Staff private chats will appear here.</p></div>
                }
              </nav>
            }
          </aside>

          <section class="message-panel">
            @if (activeConversation(); as active) {
              <header class="thread-header">
                <div class="thread-person">
                  <span class="avatar large" [class.team]="active.type === 'team'">{{ active.type === 'team' ? 'T' : initials(active.title) }}</span>
                  <div><h2>{{ active.title }}</h2><p>{{ active.type === 'team' ? 'Shared branch conversation' : 'Visible only to you and this staff member' }}</p></div>
                </div>
                <span class="privacy-pill" [class.private]="active.type === 'private-owner'">{{ active.type === 'private-owner' ? 'Private' : 'Branch team' }}</span>
              </header>

              @if (actionError()) {
                <div class="inline-error" role="alert">{{ actionError() }}<button type="button" (click)="actionError.set('')">Dismiss</button></div>
              }

              <div #messageViewport class="message-viewport">
                @if (loadingMessages()) {
                  <div class="message-loading"><i></i><i class="mine"></i><i></i></div>
                } @else {
                  <div class="message-list">
                    @for (message of messages(); track message.id) {
                      <article class="message" [class.mine]="message.senderUserId === currentUserId()">
                        <div><strong>{{ message.senderUserId === currentUserId() ? 'You' : (message.senderName || 'Staff member') }}</strong><time [attr.datetime]="message.createdAt">{{ message.createdAt | date:'shortTime' }}</time></div>
                        <p>{{ message.body }}</p>
                      </article>
                    } @empty {
                      <div class="empty-thread"><span>{{ active.type === 'team' ? 'T' : initials(active.title) }}</span><strong>Start the conversation</strong><p>Send a clear update to {{ active.type === 'team' ? 'your branch team' : active.title }}.</p></div>
                    }
                  </div>
                }
              </div>

              <form class="composer" (submit)="send($event)">
                <label for="owner-chat-message">Message {{ active.title }}</label>
                <textarea
                  id="owner-chat-message"
                  name="ownerChatMessage"
                  [(ngModel)]="draft"
                  rows="2"
                  maxlength="4000"
                  [disabled]="sending()"
                  placeholder="Write a message..."
                  (keydown)="onComposerKeydown($event)"
                ></textarea>
                <div><small>Enter to send, Shift+Enter for a new line</small><span>{{ draft.length }}/4000</span><button type="submit" [disabled]="!draft.trim() || sending()">{{ sending() ? 'Sending...' : 'Send message' }}</button></div>
              </form>
            } @else {
              <div class="empty-thread full"><span>TC</span><strong>Select a conversation</strong><p>Choose Team Chat or a private staff conversation.</p></div>
            }
          </section>
        </section>
      }
    </main>
  `,
  styles: [`
    :host { display: block; min-height: 100%; color: var(--text-primary, #17231d); }
    * { box-sizing: border-box; }
    button, textarea { font: inherit; }
    .chat-page { padding: clamp(18px, 2.4vw, 34px); max-width: 1600px; margin: 0 auto; }
    .page-header { display: flex; align-items: flex-end; justify-content: space-between; gap: 20px; margin-bottom: 22px; }
    .eyebrow, .panel-heading span { display: block; color: #23805d; font-size: 11px; font-weight: 800; letter-spacing: .14em; }
    h1 { margin: 6px 0 5px; font: 700 clamp(28px, 3vw, 42px)/1.05 Georgia, serif; letter-spacing: -.035em; }
    .page-header p, .thread-header p, .list-empty p, .empty-thread p { margin: 0; color: #6b766f; }
    .live-state { display: flex; align-items: center; gap: 8px; border: 1px solid #dce4df; border-radius: 999px; padding: 9px 13px; color: #6b766f; background: #fff; font-size: 12px; font-weight: 750; }
    .live-state span { width: 8px; height: 8px; border-radius: 50%; background: #c69443; box-shadow: 0 0 0 4px #f7ead4; }
    .live-state.connected span { background: #2e9b6f; box-shadow: 0 0 0 4px #dff3ea; }
    .chat-shell { display: grid; grid-template-columns: minmax(270px, 340px) 1fr; min-height: min(720px, calc(100vh - 210px)); overflow: hidden; border: 1px solid #dfe6e1; border-radius: 22px; background: #fff; box-shadow: 0 20px 55px rgba(28, 55, 42, .08); }
    .conversation-panel { border-right: 1px solid #e7ece9; background: #f8faf8; }
    .panel-heading { min-height: 86px; display: flex; align-items: center; justify-content: space-between; padding: 20px 22px; border-bottom: 1px solid #e7ece9; }
    .panel-heading h2, .thread-header h2 { margin: 3px 0 0; font-size: 18px; }
    .panel-heading b { min-width: 28px; height: 28px; display: grid; place-items: center; border-radius: 9px; color: #237657; background: #e5f3ec; font-size: 12px; }
    nav { padding: 10px; }
    .conversation-row { width: 100%; display: grid; grid-template-columns: 42px minmax(0, 1fr) auto; align-items: center; gap: 11px; padding: 12px; border: 1px solid transparent; border-radius: 14px; text-align: left; color: inherit; background: transparent; cursor: pointer; transition: .18s ease; }
    .conversation-row:hover { background: #fff; border-color: #e3e9e5; }
    .conversation-row.active { background: #fff; border-color: #cce2d6; box-shadow: 0 8px 24px rgba(25, 77, 52, .07); }
    .avatar { width: 42px; height: 42px; display: grid; place-items: center; flex: 0 0 auto; border-radius: 13px; color: #7f5529; background: #f4e6d5; font-weight: 800; }
    .avatar.team { color: #176c50; background: #dcefe6; }
    .avatar.large { width: 46px; height: 46px; border-radius: 15px; }
    .conversation-copy { min-width: 0; }
    .conversation-copy strong, .conversation-copy small { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .conversation-copy strong { font-size: 13px; }
    .conversation-copy small { margin-top: 4px; color: #7a847e; font-size: 11px; }
    .message-count { min-width: 23px; padding: 4px 6px; border-radius: 8px; text-align: center; color: #708078; background: #edf1ee; font-size: 10px; font-weight: 800; }
    .message-panel { min-width: 0; display: grid; grid-template-rows: auto auto minmax(300px, 1fr) auto; background: linear-gradient(180deg, #fff 0%, #fbfcfb 100%); }
    .thread-header { min-height: 86px; display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 16px 22px; border-bottom: 1px solid #e7ece9; }
    .thread-person { display: flex; align-items: center; gap: 12px; min-width: 0; }
    .thread-header p { margin-top: 4px; font-size: 12px; }
    .privacy-pill { flex: 0 0 auto; padding: 7px 10px; border-radius: 999px; color: #287657; background: #e5f3ec; font-size: 11px; font-weight: 800; }
    .privacy-pill.private { color: #865729; background: #f6eadc; }
    .message-viewport { min-height: 0; overflow-y: auto; padding: 24px clamp(18px, 4vw, 52px); background-image: radial-gradient(#dce5df 0.7px, transparent 0.7px); background-size: 18px 18px; }
    .message-list { display: flex; flex-direction: column; gap: 12px; }
    .message { max-width: min(72%, 640px); align-self: flex-start; padding: 11px 14px; border: 1px solid #e0e7e2; border-radius: 5px 17px 17px 17px; background: #fff; box-shadow: 0 5px 16px rgba(31, 55, 43, .05); }
    .message.mine { align-self: flex-end; border-color: #cde4d8; border-radius: 17px 5px 17px 17px; background: #e9f5ef; }
    .message div { display: flex; justify-content: space-between; gap: 18px; margin-bottom: 5px; color: #6d7972; font-size: 10px; }
    .message div strong { color: #2d5e49; }
    .message p { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; font-size: 13px; line-height: 1.5; }
    .composer { padding: 15px 18px 17px; border-top: 1px solid #e7ece9; background: #fff; }
    .composer label { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0, 0, 0, 0); }
    .composer textarea { width: 100%; resize: none; border: 1px solid #d8e1dc; border-radius: 14px; padding: 12px 14px; color: inherit; background: #fbfcfb; outline: none; }
    .composer textarea:focus { border-color: #57a17f; box-shadow: 0 0 0 3px rgba(64, 148, 107, .12); }
    .composer > div { display: flex; align-items: center; gap: 14px; margin-top: 9px; }
    .composer small { margin-right: auto; color: #7a847e; }
    .composer > div > span { color: #8b948f; font-size: 11px; }
    .composer button, .empty-state button { border: 0; border-radius: 11px; padding: 10px 15px; color: #fff; background: #1f7655; font-weight: 750; cursor: pointer; }
    .composer button:disabled { opacity: .48; cursor: not-allowed; }
    .inline-error { display: flex; justify-content: space-between; gap: 12px; padding: 9px 16px; color: #8b342c; background: #fff0ed; font-size: 12px; }
    .inline-error button { border: 0; color: inherit; background: none; font-weight: 700; cursor: pointer; }
    .empty-thread { min-height: 260px; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 24px; text-align: center; }
    .empty-thread.full { min-height: 100%; }
    .empty-thread > span { width: 54px; height: 54px; display: grid; place-items: center; margin-bottom: 12px; border-radius: 18px; color: #277457; background: #e3f1e9; font-weight: 800; }
    .empty-thread strong { margin-bottom: 5px; }
    .list-empty { padding: 34px 18px; text-align: center; font-size: 12px; }
    .list-empty p { margin-top: 5px; }
    .empty-state { margin: 60px auto; max-width: 460px; padding: 34px; border: 1px solid #ead7d3; border-radius: 18px; text-align: center; background: #fff; }
    .empty-state p { color: #806c67; }
    .conversation-loading, .message-loading { padding: 18px; }
    .conversation-loading i, .message-loading i { display: block; height: 62px; margin-bottom: 10px; border-radius: 13px; background: linear-gradient(100deg, #edf1ee 20%, #f8faf8 45%, #edf1ee 70%); background-size: 220% 100%; animation: shimmer 1.3s infinite; }
    .message-loading i { width: 55%; height: 70px; }
    .message-loading i.mine { margin-left: auto; }
    @keyframes shimmer { to { background-position-x: -220%; } }
    @media (max-width: 820px) {
      .chat-page { padding: 14px; }
      .page-header { align-items: flex-start; }
      .chat-shell { grid-template-columns: 1fr; min-height: auto; overflow: visible; }
      .conversation-panel { border-right: 0; border-bottom: 1px solid #e7ece9; }
      nav { display: flex; gap: 8px; overflow-x: auto; }
      .conversation-row { min-width: 245px; }
      .message-panel { min-height: 620px; }
      .message { max-width: 88%; }
    }
    @media (max-width: 520px) {
      .page-header p, .composer small { display: none; }
      .live-state { padding: 8px 10px; }
      .thread-header { padding: 13px; }
      .thread-header p { display: none; }
      .privacy-pill { font-size: 10px; }
      .message-viewport { padding: 18px 12px; }
      .composer { padding: 10px; }
    }
  `]
})
export class TeamChatComponent implements OnInit, OnDestroy {
  @ViewChild('messageViewport') private messageViewport?: ElementRef<HTMLElement>;

  readonly conversations = signal<ChatConversation[]>([]);
  readonly messages = signal<ChatMessage[]>([]);
  readonly activeConversationId = signal('');
  readonly loadingConversations = signal(true);
  readonly loadingMessages = signal(false);
  readonly sending = signal(false);
  readonly loadError = signal('');
  readonly actionError = signal('');
  readonly activeConversation = computed(() => this.conversations().find((item) => item.id === this.activeConversationId()) || null);
  readonly currentUserId = computed(() => this.auth.currentUser()?.id || '');
  draft = '';

  private pollTimer?: ReturnType<typeof setInterval>;
  private messageRequest = 0;
  private readonly handledRealtimeMessages = new Set<string>();

  constructor(
    private readonly api: ApiService,
    private readonly auth: AuthSessionService,
    readonly realtime: WebSocketService
  ) {
    effect(() => {
      const frames = realtime.events();
      for (const frame of [...frames].reverse()) {
        if (!['staff-self.chat_message', 'team-chat.private-message'].includes(frame.type)) continue;
        const message = (frame.payload as { message?: ChatMessage })?.message;
        if (!message?.id || this.handledRealtimeMessages.has(message.id)) continue;
        this.handledRealtimeMessages.add(message.id);
        if (message.conversationId === this.activeConversationId()) {
          this.messages.update((items) => this.dedupeMessages([...items, message]));
          this.scrollToLatest();
        }
        void this.loadConversations(true);
      }
    });
  }

  ngOnInit(): void {
    this.realtime.connect();
    void this.loadConversations();
    this.pollTimer = setInterval(() => {
      void this.loadConversations(true);
      void this.loadMessages(false);
    }, 15_000);
  }

  ngOnDestroy(): void {
    if (this.pollTimer) clearInterval(this.pollTimer);
  }

  async loadConversations(silent = false): Promise<void> {
    if (!silent) this.loadingConversations.set(true);
    this.loadError.set('');
    try {
      const items = await firstValueFrom(this.api.list<ChatConversation[]>('team-chat/conversations'));
      const sorted = [...items].sort((a, b) => {
        if (a.type === 'team' && b.type !== 'team') return -1;
        if (b.type === 'team' && a.type !== 'team') return 1;
        return String(b.lastMessageAt || b.updatedAt).localeCompare(String(a.lastMessageAt || a.updatedAt));
      });
      this.conversations.set(sorted);
      if (!sorted.some((item) => item.id === this.activeConversationId())) {
        const first = sorted.find((item) => item.type === 'team') || sorted[0];
        if (first) await this.openConversation(first.id);
      }
    } catch (error) {
      if (!silent) this.loadError.set(this.errorMessage(error, 'Check your connection and branch access.'));
    } finally {
      if (!silent) this.loadingConversations.set(false);
    }
  }

  async openConversation(conversationId: string): Promise<void> {
    if (conversationId === this.activeConversationId()) return;
    this.activeConversationId.set(conversationId);
    this.messages.set([]);
    this.actionError.set('');
    await this.loadMessages(true);
  }

  async loadMessages(showLoading = false): Promise<void> {
    const conversationId = this.activeConversationId();
    if (!conversationId) return;
    const request = ++this.messageRequest;
    if (showLoading) this.loadingMessages.set(true);
    try {
      const items = await firstValueFrom(this.api.list<ChatMessage[]>(`team-chat/conversations/${encodeURIComponent(conversationId)}/messages`));
      if (request !== this.messageRequest || conversationId !== this.activeConversationId()) return;
      this.messages.set(this.dedupeMessages(items));
      this.scrollToLatest();
    } catch (error) {
      if (showLoading) this.actionError.set(this.errorMessage(error, 'Messages could not be loaded.'));
    } finally {
      if (request === this.messageRequest) this.loadingMessages.set(false);
    }
  }

  async send(event?: Event): Promise<void> {
    event?.preventDefault();
    const conversationId = this.activeConversationId();
    const body = this.draft.trim();
    if (!conversationId || !body || this.sending()) return;
    this.sending.set(true);
    this.actionError.set('');
    try {
      const message = await firstValueFrom(this.api.postWithHeaders<ChatMessage>(
        `team-chat/conversations/${encodeURIComponent(conversationId)}/messages`,
        { body },
        { 'Idempotency-Key': crypto.randomUUID() }
      ));
      this.messages.update((items) => this.dedupeMessages([...items, message]));
      this.draft = '';
      this.scrollToLatest();
      void this.loadConversations(true);
    } catch (error) {
      this.actionError.set(this.errorMessage(error, 'Message could not be sent. Your draft has been kept.'));
    } finally {
      this.sending.set(false);
    }
  }

  onComposerKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Enter' || event.shiftKey || event.isComposing) return;
    event.preventDefault();
    void this.send();
  }

  initials(title: string): string {
    return String(title || 'Staff').split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase();
  }

  private dedupeMessages(items: ChatMessage[]): ChatMessage[] {
    return [...new Map(items.map((item) => [item.id, item])).values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  private scrollToLatest(): void {
    setTimeout(() => {
      const viewport = this.messageViewport?.nativeElement;
      viewport?.scrollTo({ top: viewport.scrollHeight, behavior: 'smooth' });
    });
  }

  private errorMessage(error: unknown, fallback: string): string {
    const value = error as { error?: { error?: { message?: string }; message?: string }; message?: string };
    return value?.error?.error?.message || value?.error?.message || value?.message || fallback;
  }
}
