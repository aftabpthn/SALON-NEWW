import { DatePipe } from "@angular/common";
import { Component, ElementRef, OnDestroy, OnInit, ViewChild, computed, signal } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { StaffAppService, StaffChatConversation, StaffConversationMessage } from "../../core/staff-app.service";

type RealtimeState = "connecting" | "live" | "polling" | "offline";

@Component({
  standalone: true,
  imports: [DatePipe, FormsModule],
  template: `
    <section class="page chat-page" aria-labelledby="chat-title">
      <header class="page-head chat-page-head">
        <div><p class="eyebrow">Workspace</p><h1 id="chat-title">Chat</h1><p>Keep branch conversations together, with a private line to the owner.</p></div>
        <div class="chat-connection" [attr.data-state]="connectionState()" role="status" aria-live="polite">
          <span aria-hidden="true"></span>{{ connectionLabel() }}
        </div>
      </header>

      @if (!canReadChat()) {
        <section class="notice chat-access-state" role="alert"><div><strong>Chat is unavailable</strong><p>You do not have permission to view branch conversations.</p></div></section>
      } @else if (initialLoading()) {
        <section class="chat-shell chat-shell-loading" aria-label="Loading chat">
          <aside class="chat-sidebar"><div class="chat-skeleton wide"></div><div class="chat-skeleton"></div><div class="chat-skeleton"></div></aside>
          <div class="chat-main"><div class="chat-skeleton heading"></div><div class="chat-skeleton bubble"></div><div class="chat-skeleton bubble mine"></div></div>
        </section>
      } @else if (loadError()) {
        <section class="notice chat-access-state" role="alert"><div><strong>Conversations could not be loaded</strong><p>{{ loadError() }}</p></div><button class="link-button" type="button" (click)="loadConversations()">Try again</button></section>
      } @else {
        <section class="chat-shell">
          <aside class="chat-sidebar" aria-label="Conversations">
            <div class="chat-sidebar-head"><div><p class="eyebrow">Conversations</p><h2>Inbox</h2></div><span>{{ conversations().length }}</span></div>
            <nav class="chat-conversation-list" aria-label="Choose a conversation">
              @for (conversation of conversations(); track conversation.id) {
                <button type="button" class="chat-conversation" [class.active]="conversation.id === activeConversationId()" [class.private]="conversation.type === 'private-owner'" [attr.aria-current]="conversation.id === activeConversationId() ? 'page' : null" (click)="openConversation(conversation.id)">
                  <span class="conversation-mark" aria-hidden="true">{{ conversation.type === 'private-owner' ? 'O' : 'T' }}</span>
                  <span class="conversation-copy"><strong>{{ conversation.title }}</strong><small>{{ conversation.type === 'private-owner' ? 'Private · only participants' : 'Branch team' }}</small></span>
                  <span class="conversation-meta">{{ conversation.messageCount }}</span>
                </button>
              } @empty {
                <p class="chat-list-empty">No conversations are available for this branch.</p>
              }
            </nav>
            @if (canStartPrivateChat()) {
              <div class="start-private-card">
                <span aria-hidden="true">↗</span><div><strong>Need a private word?</strong><p>Only you and the owner can see this conversation.</p></div>
                <button class="button" type="button" [disabled]="startingPrivate() || !online()" (click)="startPrivateChat()">{{ startingPrivate() ? 'Starting…' : 'Start private owner chat' }}</button>
              </div>
            }
          </aside>

          <section class="chat-main" [class.private-chat]="activeConversation()?.type === 'private-owner'" aria-label="Active conversation">
            @if (activeConversation(); as active) {
              <header class="chat-thread-head">
                <div class="thread-identity"><span class="conversation-mark" aria-hidden="true">{{ active.type === 'private-owner' ? 'O' : 'T' }}</span><div><h2>{{ active.title }}</h2><p>{{ active.type === 'private-owner' ? 'Private conversation · visible only to persisted participants' : 'Shared with your branch team' }}</p></div></div>
                <span class="chat-mode-pill" [class.private]="active.type === 'private-owner'">{{ active.type === 'private-owner' ? 'Private' : 'Team' }}</span>
              </header>

              @if (actionError()) { <div class="chat-inline-error" role="alert"><span>{{ actionError() }}</span><button type="button" (click)="clearActionError()" aria-label="Dismiss error">Dismiss</button></div> }
              @if (!online()) { <div class="chat-offline-note" role="status">You’re offline. Messages stay readable, but sending will resume when you reconnect.</div> }
              @if (!canSendChat()) { <div class="chat-offline-note" role="note">Read-only access. You can follow this conversation but cannot send messages.</div> }

              <div #messageViewport class="chat-message-viewport" (scroll)="onMessageScroll()" [attr.aria-busy]="messagesLoading()" aria-live="polite" aria-relevant="additions text">
                @if (messagesLoading()) {
                  <div class="chat-message-loading"><div class="chat-skeleton bubble"></div><div class="chat-skeleton bubble mine"></div></div>
                } @else if (messagesError()) {
                  <div class="chat-thread-state" role="alert"><strong>Messages could not be loaded</strong><p>{{ messagesError() }}</p><button class="link-button" type="button" (click)="refreshMessages(true)">Retry</button></div>
                } @else {
                  <div class="chat-message-list">
                    @for (item of messages(); track item.id) {
                      <article class="chat-message" [class.mine]="item.senderUserId === staff.user()?.id">
                        <div class="message-byline"><strong>{{ item.senderUserId === staff.user()?.id ? 'You' : (item.senderName || 'Team member') }}</strong><time [attr.datetime]="item.createdAt">{{ item.createdAt | date:'shortTime' }}</time></div>
                        <p>{{ item.body }}</p>
                      </article>
                    } @empty {
                      <div class="chat-thread-state"><span class="empty-chat-mark" aria-hidden="true">•••</span><strong>Start the conversation</strong><p>{{ active.type === 'private-owner' ? 'This space is private to you and the owner.' : 'Share the first update with your branch team.' }}</p></div>
                    }
                  </div>
                }
              </div>

              @if (unseenMessageCount()) { <button class="new-message-button" type="button" (click)="scrollToLatest(true)">{{ unseenMessageCount() }} new {{ unseenMessageCount() === 1 ? 'message' : 'messages' }} ↓</button> }

              <form class="chat-composer" (submit)="send($event)">
                <label class="sr-only" for="chat-draft">Message {{ active.title }}</label>
                <textarea id="chat-draft" name="chatDraft" [(ngModel)]="draft" maxlength="4000" rows="1" [disabled]="!canSendChat() || !online() || sending()" [attr.aria-describedby]="'chat-compose-help chat-character-count'" [placeholder]="canSendChat() ? (online() ? 'Write a message…' : 'Reconnect to send a message') : 'Read-only conversation'" (keydown)="onComposerKeydown($event)"></textarea>
                <div class="composer-footer"><span id="chat-compose-help">Enter to send · Shift+Enter for a new line</span><span id="chat-character-count" [class.near-limit]="draft.length > 3600">{{ draft.length }}/4000</span><button class="button primary chat-send" type="submit" [disabled]="!canSubmit()">{{ sending() ? 'Sending…' : 'Send' }} <span aria-hidden="true">↗</span></button></div>
              </form>
            } @else {
              <div class="chat-thread-state"><strong>No conversation selected</strong><p>Choose an available conversation to begin.</p></div>
            }
          </section>
        </section>
      }
    </section>
  `,
  styleUrls: ["./staff-app.styles.css"]
})
export class StaffChatPage implements OnInit, OnDestroy {
  @ViewChild("messageViewport") private messageViewport?: ElementRef<HTMLElement>;
  readonly conversations = signal<StaffChatConversation[]>([]);
  readonly messages = signal<StaffConversationMessage[]>([]);
  readonly activeConversationId = signal("");
  readonly initialLoading = signal(false);
  readonly messagesLoading = signal(false);
  readonly startingPrivate = signal(false);
  readonly sending = signal(false);
  readonly loadError = signal("");
  readonly messagesError = signal("");
  readonly actionError = signal("");
  readonly online = signal(typeof navigator === "undefined" || navigator.onLine);
  readonly connectionState = signal<RealtimeState>(this.online() ? "connecting" : "offline");
  readonly unseenMessageCount = signal(0);
  readonly activeConversation = computed(() => this.conversations().find((item) => item.id === this.activeConversationId()) || null);
  readonly connectionLabel = computed(() => ({ connecting: "Connecting", live: "Live", polling: "Syncing", offline: "Offline" })[this.connectionState()]);
  draft = "";

  private socket: WebSocket | null = null;
  private pollTimer = 0;
  private reconnectTimer = 0;
  private reconnectAttempts = 0;
  private conversationGeneration = 0;
  private messageGeneration = 0;
  private nearBottom = true;
  private destroyed = false;

  constructor(readonly staff: StaffAppService) {}

  ngOnInit(): void {
    if (!this.canReadChat()) return;
    window.addEventListener("online", this.handleOnline);
    window.addEventListener("offline", this.handleOffline);
    void this.loadConversations();
    void this.connectRealtime();
    this.pollTimer = window.setInterval(() => {
      if (this.online() && document.visibilityState === "visible") void this.poll();
    }, 15000);
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    window.removeEventListener("online", this.handleOnline);
    window.removeEventListener("offline", this.handleOffline);
    window.clearInterval(this.pollTimer);
    window.clearTimeout(this.reconnectTimer);
    this.socket?.close();
  }

  canReadChat(): boolean { return this.staff.hasPermission("read:staff"); }
  canSendChat(): boolean { return this.staff.hasPermission("write:appointments"); }
  isOwner(): boolean { return ["owner", "admin", "superadmin"].includes(String(this.staff.user()?.role || "").trim().toLowerCase()); }
  canStartPrivateChat(): boolean { return this.canSendChat() && !this.isOwner() && !this.conversations().some((item) => item.type === "private-owner"); }
  canSubmit(): boolean { return this.canSendChat() && this.online() && !this.sending() && !!this.draft.trim() && this.draft.length <= 4000 && !!this.activeConversationId(); }
  clearActionError(): void { this.actionError.set(""); }

  async loadConversations(silent = false): Promise<void> {
    if (!this.canReadChat()) return;
    const generation = ++this.conversationGeneration;
    if (!silent) this.initialLoading.set(true);
    this.loadError.set("");
    try {
      const conversations = await this.staff.staffChatConversations();
      if (generation !== this.conversationGeneration) return;
      this.conversations.set(this.sortConversations(conversations));
      const currentExists = conversations.some((item) => item.id === this.activeConversationId());
      const defaultConversation = conversations.find((item) => item.type === "team") || conversations[0];
      if (!currentExists && defaultConversation) await this.openConversation(defaultConversation.id);
    } catch {
      if (generation === this.conversationGeneration && !silent) this.loadError.set(this.staff.error() || "Check your connection and try again.");
    } finally {
      if (generation === this.conversationGeneration) this.initialLoading.set(false);
    }
  }

  async openConversation(conversationId: string): Promise<void> {
    if (conversationId === this.activeConversationId() && !this.messagesError()) return;
    this.activeConversationId.set(conversationId);
    this.messages.set([]);
    this.messagesError.set("");
    this.unseenMessageCount.set(0);
    this.nearBottom = true;
    await this.refreshMessages(true);
  }

  async refreshMessages(showLoading = false): Promise<void> {
    const conversationId = this.activeConversationId();
    if (!conversationId || !this.online()) return;
    const generation = ++this.messageGeneration;
    if (showLoading) this.messagesLoading.set(true);
    this.messagesError.set("");
    try {
      const items = await this.staff.staffConversationMessages(conversationId);
      if (generation !== this.messageGeneration || conversationId !== this.activeConversationId()) return;
      const hadMessages = this.messages().length > 0;
      this.messages.set(this.dedupeMessages(items));
      if (!hadMessages || this.nearBottom) this.scrollToLatest(false);
    } catch {
      if (generation === this.messageGeneration && showLoading) this.messagesError.set(this.staff.error() || "Check your connection and retry.");
    } finally {
      if (generation === this.messageGeneration) this.messagesLoading.set(false);
    }
  }

  async startPrivateChat(): Promise<void> {
    if (!this.canStartPrivateChat() || !this.online()) return;
    this.startingPrivate.set(true);
    this.actionError.set("");
    try {
      const conversation = await this.staff.startPrivateOwnerChat(crypto.randomUUID());
      this.conversations.update((items) => this.sortConversations([conversation, ...items.filter((item) => item.id !== conversation.id)]));
      await this.openConversation(conversation.id);
    } catch { this.actionError.set(this.staff.error() || "Private owner chat could not be started."); }
    finally { this.startingPrivate.set(false); }
  }

  async send(event?: Event): Promise<void> {
    event?.preventDefault();
    if (!this.canSubmit()) return;
    const conversationId = this.activeConversationId();
    const body = this.draft.trim();
    this.sending.set(true);
    this.actionError.set("");
    try {
      const message = await this.staff.sendStaffConversationMessage(conversationId, body, crypto.randomUUID());
      this.messages.update((items) => this.dedupeMessages([...items, message]));
      this.draft = "";
      this.nearBottom = true;
      this.scrollToLatest(true);
      void this.loadConversations(true);
    } catch { this.actionError.set(this.staff.error() || "Message could not be sent. Your draft has been kept."); }
    finally { this.sending.set(false); }
  }

  onComposerKeydown(event: KeyboardEvent): void {
    if (event.key !== "Enter" || event.shiftKey || event.isComposing) return;
    event.preventDefault();
    void this.send();
  }

  onMessageScroll(): void {
    const viewport = this.messageViewport?.nativeElement;
    if (!viewport) return;
    this.nearBottom = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight < 80;
    if (this.nearBottom) this.unseenMessageCount.set(0);
  }

  scrollToLatest(smooth: boolean): void {
    this.nearBottom = true;
    this.unseenMessageCount.set(0);
    window.setTimeout(() => this.messageViewport?.nativeElement.scrollTo({ top: this.messageViewport.nativeElement.scrollHeight, behavior: smooth ? "smooth" : "auto" }));
  }

  private readonly handleOnline = (): void => {
    this.online.set(true);
    this.connectionState.set("connecting");
    this.reconnectAttempts = 0;
    void this.poll();
    void this.connectRealtime();
  };

  private readonly handleOffline = (): void => {
    this.online.set(false);
    this.connectionState.set("offline");
    this.socket?.close();
  };

  private async poll(): Promise<void> {
    if (!this.online()) return;
    if (this.connectionState() !== "live") this.connectionState.set("polling");
    await Promise.all([this.loadConversations(true), this.refreshMessages(false)]);
  }

  private async connectRealtime(): Promise<void> {
    if (this.destroyed || !this.online() || this.socket?.readyState === WebSocket.OPEN || this.socket?.readyState === WebSocket.CONNECTING) return;
    this.connectionState.set("connecting");
    try {
      const url = await this.staff.realtimeSocketTicketUrl();
      if (!url || this.destroyed) { this.connectionState.set("polling"); return; }
      const socket = new WebSocket(url);
      this.socket = socket;
      socket.onopen = () => { this.reconnectAttempts = 0; this.connectionState.set("live"); };
      socket.onmessage = (event) => this.handleRealtimeMessage(event.data);
      socket.onerror = () => socket.close();
      socket.onclose = () => {
        if (this.socket === socket) this.socket = null;
        if (!this.destroyed && this.online()) { this.connectionState.set("polling"); this.scheduleReconnect(); }
      };
    } catch {
      this.connectionState.set("polling");
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect(): void {
    window.clearTimeout(this.reconnectTimer);
    const delay = Math.min(15000, 1000 * 2 ** Math.min(this.reconnectAttempts++, 4));
    this.reconnectTimer = window.setTimeout(() => void this.connectRealtime(), delay);
  }

  private handleRealtimeMessage(raw: unknown): void {
    let frame: { type?: string; payload?: { message?: StaffConversationMessage } } = {};
    try { frame = JSON.parse(String(raw)); } catch { return; }
    if (!["staff-self.chat_message", "team-chat.private-message"].includes(frame.type || "") || !frame.payload?.message) return;
    const message = frame.payload.message;
    if (message.conversationId === this.activeConversationId()) {
      const isNew = !this.messages().some((item) => item.id === message.id);
      this.messages.update((items) => this.dedupeMessages([...items, message]));
      if (isNew) {
        if (this.nearBottom) this.scrollToLatest(false);
        else this.unseenMessageCount.update((count) => count + 1);
      }
    }
    void this.loadConversations(true);
  }

  private dedupeMessages(items: StaffConversationMessage[]): StaffConversationMessage[] {
    return [...new Map(items.map((item) => [item.id, item])).values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  private sortConversations(items: StaffChatConversation[]): StaffChatConversation[] {
    return [...items].sort((a, b) => {
      if (a.type === "team" && b.type !== "team") return -1;
      if (b.type === "team" && a.type !== "team") return 1;
      return String(b.lastMessageAt || b.updatedAt).localeCompare(String(a.lastMessageAt || a.updatedAt));
    });
  }
}
