import { DatePipe } from "@angular/common";
import { Component, OnDestroy, OnInit, signal } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { IonSpinner } from "@ionic/angular/standalone";
import { StaffAppService, StaffChatMessage, StaffChatThread, StaffEnterpriseOs } from "../../core/staff-app.service";

@Component({ standalone: true, imports: [DatePipe, FormsModule, IonSpinner], template: `
  <section class="page"><header class="page-head"><div><p class="eyebrow">Chat</p><h1>Team chat</h1><p>Dedicated communication workspace for staff updates.</p></div><div class="row-actions"><button class="link-button" [class.active-toggle]="filter() === 'all'" type="button" (click)="filter.set('all')">All</button><button class="link-button" [class.active-toggle]="filter() === 'unread'" type="button" (click)="filter.set('unread')">Unread</button><button class="link-button" [class.active-toggle]="filter() === 'system'" type="button" (click)="filter.set('system')">System</button></div></header>
  @if (!canReadChat()) { <section class="notice">You do not have permission to view team chat.</section> }
  @if (loading()) { <section class="state"><ion-spinner name="crescent" /> Loading chat workspace...</section> } @if (staff.error()) { <section class="notice">{{ staff.error() }}</section> }
  @if (message()) { <section class="notice success">{{ message() }}</section> }
  @if (canReadChat() && os(); as data) { <section class="grid two chat-layout"><article class="panel"><div class="panel-title"><h2>Threads</h2><span>{{ threads().length }}</span></div><div class="list">@for (thread of threads(); track thread.id) { <button type="button" class="thread-row" [class.active-toggle]="thread.id === activeThreadId()" (click)="openThread(thread.id)"><strong>{{ thread.title }}</strong><small>{{ thread.messageCount || 0 }} messages · {{ thread.channel }}</small></button> } @empty { <p class="empty">No chat threads yet.</p> }</div><div class="panel-title mini"><h2>System feed</h2><span>{{ filteredNotifications().length }}</span></div><div class="list">@for (note of filteredNotifications().slice(0, 4); track note.id) { <div class="row"><div class="row-main"><strong>{{ note.title }}</strong><small>{{ note.createdAt ? (note.createdAt | date:'short') : '' }} · {{ note.body || note.status }}</small></div></div> }</div></article><article class="panel chat-panel"><div class="panel-title"><h2>Branch channel</h2><span>{{ canSendChat() ? 'send enabled' : 'read only' }}</span></div>@if (!canSendChat()) { <p class="muted">You can read team chat, but cannot send messages.</p> }<div class="chat-messages">@for (message of messages(); track message.id) { <article [class.mine]="message.senderStaffId === staff.user()?.staffId"><strong>{{ message.senderName || 'Staff' }}</strong><p>{{ message.body }}</p><small>{{ message.createdAt | date:'short' }}</small></article> } @empty { <p class="empty">No messages yet. Start the thread.</p> }</div><div class="chat-compose"><input [(ngModel)]="draft" [disabled]="!canSendChat()" placeholder="Message your team..." /><button class="link-button" type="button" [disabled]="!canSendChat()" (click)="send()">Send</button></div>@for (card of data.aiCoach.slice(0, 2); track card.title) { <p class="insight"><b>{{ card.title }}</b>: {{ card.action }}</p> }</article></section> }
  </section>`, styleUrls: ["./staff-app.styles.css"] })
export class StaffChatPage implements OnInit, OnDestroy {
  readonly os = signal<StaffEnterpriseOs | null>(null);
  readonly threads = signal<StaffChatThread[]>([]);
  readonly messages = signal<StaffChatMessage[]>([]);
  readonly activeThreadId = signal("");
  readonly loading = signal(false);
  readonly message = signal("");
  readonly filter = signal<"all" | "unread" | "system">("all");
  draft = "";
  private pollTimer = 0;
  private socket: WebSocket | null = null;

  constructor(readonly staff: StaffAppService) {}

  ngOnInit() {
    if (!this.canReadChat()) return;
    void this.load();
    this.connectRealtime();
    this.pollTimer = window.setInterval(() => { if (document.visibilityState === "visible" && this.activeThreadId()) void this.refreshMessages(); }, 12000);
  }

  ngOnDestroy() { window.clearInterval(this.pollTimer); this.socket?.close(); }

  async load() { if (!this.canReadChat()) return; this.loading.set(true); try { const [os, threads] = await Promise.all([this.staff.enterpriseOs(), this.staff.chatThreads()]); this.os.set(os); this.threads.set(threads); if (threads[0]?.id) await this.openThread(threads[0].id); } finally { this.loading.set(false); } }
  async openThread(threadId: string) { this.activeThreadId.set(threadId); await this.refreshMessages(); }
  async refreshMessages() { if (!this.canReadChat() || !this.activeThreadId()) return; this.messages.set(await this.staff.chatMessages(this.activeThreadId())); }
  async send() { this.message.set(""); if (!this.canSendChat()) { this.message.set("You do not have permission to send chat messages."); return; } const body = this.draft.trim(); if (!body || !this.activeThreadId()) return; const message = await this.staff.sendChatMessage(this.activeThreadId(), body); this.messages.update((items) => items.some((item) => item.id === message.id) ? items : [...items, message]); this.draft = ""; this.message.set("Message sent."); }
  filteredNotifications() { const notes = this.os()?.notifications || []; if (this.filter() === "unread") return notes.filter((note) => String(note.status || "unread") !== "read"); if (this.filter() === "system") return notes.filter((note) => /system|staff|notification/i.test(`${note.title} ${note.body}`)); return notes; }

  canReadChat(): boolean { return this.staff.hasPermission("read:staff"); }
  canSendChat(): boolean { return this.staff.hasAnyPermission(["write:staff", "update:staff"]); }

  private connectRealtime() {
    const url = this.staff.realtimeSocketUrl();
    if (!url) return;
    const socket = new WebSocket(url);
    this.socket = socket;
    socket.onmessage = (event) => this.handleRealtimeMessage(event.data);
    socket.onerror = () => socket.close();
  }

  private handleRealtimeMessage(raw: unknown) {
    let frame: { type?: string; payload?: { message?: StaffChatMessage } } = {};
    try { frame = JSON.parse(String(raw)); } catch { return; }
    if (frame.type !== "staff-self.chat_message" || !frame.payload?.message) return;
    const message = frame.payload.message;
    if (message.threadId === this.activeThreadId()) this.messages.update((items) => items.some((item) => item.id === message.id) ? items : [...items, message]);
    void Promise.all([this.staff.enterpriseOs(), this.staff.chatThreads()]).then(([os, threads]) => { this.os.set(os); this.threads.set(threads); });
  }
}
