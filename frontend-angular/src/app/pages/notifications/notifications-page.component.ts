import { CommonModule } from '@angular/common';
import { Component, OnDestroy, OnInit, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { ApiEnvelope, ApiService } from '../../shared/services/api.service';
import { AuthService } from '../../core/services/auth.service';

type InboxMessage = {
  id: string;
  clientId: string;
  clientName: string;
  channel: string;
  direction: string;
  status: string;
  subject: string;
  body: string;
  occurredAt: string;
};

type TeamChatMessage = {
  id: string;
  senderUserId: string;
  senderName: string;
  body: string;
  replyToMessageId?: string;
  createdAt: string;
};

@Component({
  selector: 'page-notifications',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './notifications-page.component.html',
  styleUrls: ['./notifications-page.component.css'],
})
export class NotificationsPageComponent implements OnInit, OnDestroy {
  private readonly api = inject(ApiService);
  private readonly auth = inject(AuthService);
  private teamSocket: WebSocket | null = null;
  private reconnectTimer?: ReturnType<typeof setTimeout>;
  messages: InboxMessage[] = [];
  teamMessages: TeamChatMessage[] = [];
  providerStatus: Record<string, boolean> = {};
  mode: 'client' | 'team' = 'client';
  selectedClientId = '';
  channel = 'whatsapp';
  reply = '';
  loading = true;
  busy = false;
  error = '';

  async ngOnInit() { await this.reload(); this.connectTeamChat(); }

  ngOnDestroy() {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.teamSocket?.close();
  }

  get threads() {
    const clients = new Map<string, InboxMessage>();
    for (const message of this.messages) if (!clients.has(message.clientId)) clients.set(message.clientId, message);
    return [...clients.values()];
  }

  get selectedMessages() {
    return this.messages.filter((message) => message.clientId === this.selectedClientId).slice().reverse();
  }

  get selectedThread() { return this.threads.find((thread) => thread.clientId === this.selectedClientId); }

  async reload() {
    this.loading = true;
    this.error = '';
    try {
      const [inbox, providers, team] = await Promise.all([
        firstValueFrom(this.api.get<ApiEnvelope<InboxMessage[]>>('/notifications/inbox')),
        firstValueFrom(this.api.get<ApiEnvelope<Record<string, boolean>>>('/notifications/provider-status')),
        firstValueFrom(this.api.get<ApiEnvelope<TeamChatMessage[]>>('/notifications/team-chat')),
      ]);
      this.messages = Array.isArray(inbox.data) ? inbox.data : [];
      this.providerStatus = providers.data || {};
      this.teamMessages = Array.isArray(team.data) ? team.data : [];
      if (!this.threads.some((thread) => thread.clientId === this.selectedClientId)) {
        this.selectedClientId = this.threads[0]?.clientId || '';
      }
    } catch (error) { this.error = this.message(error, 'Message inbox could not be loaded'); }
    finally { this.loading = false; }
  }

  setMode(mode: 'client' | 'team') { this.mode = mode; this.error = ''; }

  selectThread(thread: InboxMessage) {
    this.selectedClientId = thread.clientId;
    if (thread.channel === 'sms' || thread.channel === 'whatsapp') this.channel = thread.channel;
  }

  async sendReply() {
    const body = this.reply.trim();
    if (!this.selectedClientId || !body || this.busy) return;
    this.busy = true;
    this.error = '';
    try {
      await firstValueFrom(this.api.post(`/notifications/inbox/${this.selectedClientId}/reply`, { channel: this.channel, body }));
      this.reply = '';
      await this.reload();
    } catch (error) { this.error = this.message(error, 'Reply could not be queued'); }
    finally { this.busy = false; }
  }

  async sendTeamMessage() {
    const body = this.reply.trim();
    if (!body || this.busy) return;
    this.busy = true;
    this.error = '';
    try {
      await firstValueFrom(this.api.post('/notifications/team-chat', { body, idempotencyKey: crypto.randomUUID() }));
      this.reply = '';
      await this.reloadTeamChat();
    } catch (error) { this.error = this.message(error, 'Team message could not be sent'); }
    finally { this.busy = false; }
  }

  isOwnMessage(message: TeamChatMessage) { return message.senderUserId === this.auth.userId; }

  providerReady(channel: string) {
    return channel === 'whatsapp' ? !!this.providerStatus['whatsappDelivery'] : !!this.providerStatus['smsDelivery'];
  }

  formatDateTime(value: string) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? '—' : new Intl.DateTimeFormat('en-GB', { dateStyle: 'short', timeStyle: 'short' }).format(date);
  }

  private async reloadTeamChat() {
    const response = await firstValueFrom(this.api.get<ApiEnvelope<TeamChatMessage[]>>('/notifications/team-chat'));
    this.teamMessages = Array.isArray(response.data) ? response.data : [];
  }

  private connectTeamChat() {
    const token = this.auth.accessToken || '';
    if (!token || typeof WebSocket === 'undefined') return;
    const scheme = location.protocol === 'https:' ? 'wss' : 'ws';
    this.teamSocket = new WebSocket(`${scheme}://${location.host}/api/v1/realtime/team-chat`, ['aurashine-v1', token]);
    this.teamSocket.onmessage = () => { void this.reloadTeamChat(); };
    this.teamSocket.onclose = () => {
      this.teamSocket = null;
      this.reconnectTimer = setTimeout(() => this.connectTeamChat(), 3000);
    };
  }

  private message(error: any, fallback: string) { return error?.error?.error?.message || error?.error?.message || fallback; }
}
