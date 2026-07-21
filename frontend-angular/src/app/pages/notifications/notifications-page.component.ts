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

type SmsCenterCampaign = {
  id: string;
  title: string;
  body: string;
  metadata: {
    channel?: string;
    audience?: string;
    category?: string;
    status?: string;
    eligibleRecipients?: number;
    recipientCount?: number;
    deliveredCount?: number;
    failedCount?: number;
    blockedCount?: number;
    lastError?: string;
  };
  createdAt: string;
};

type SmsCenterSummary = { eligibleRecipients: number; campaigns: SmsCenterCampaign[] };

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
  controlCampaigns: SmsCenterCampaign[] = [];
  providerStatus: Record<string, boolean> = {};
  mode: 'center' | 'client' | 'team' = 'center';
  selectedClientId = '';
  channel = 'whatsapp';
  reply = '';
  controlChannel = 'sms';
  controlAudience = 'clients_all';
  controlCategory = 'general';
  controlSubject = '';
  controlMessage = '';
  eligibleRecipients = 0;
  sensitiveConfirmed = false;
  readonly emojis = ['😊', '🎉', '✅', '💰', '📦', '📅'];
  readonly audiences = [
    { value: 'clients_all', label: 'Clients - All' },
    { value: 'clients_paid', label: 'Clients - Paid' },
    { value: 'clients_unpaid', label: 'Clients - Unpaid' },
    { value: 'clients_wallet', label: 'Clients - Wallet' },
    { value: 'staff_all', label: 'Staff - All' },
    { value: 'staff_salary', label: 'Staff - Salary' },
  ];
  readonly categories = [
    { value: 'general', label: 'General' },
    { value: 'appointment_confirmation', label: 'Appointment Confirmation' },
    { value: 'appointment_reminder', label: 'Appointment Reminder' },
    { value: 'appointment_reschedule', label: 'Appointment Reschedule' },
    { value: 'appointment_cancellation', label: 'Appointment Cancellation' },
    { value: 'paid_invoice_receipt', label: 'Paid Invoice Receipt' },
    { value: 'unpaid_payment_reminder', label: 'Unpaid Payment Reminder' },
    { value: 'wallet_balance', label: 'Wallet Balance' },
    { value: 'product_offer', label: 'Product Offer' },
    { value: 'inventory_low_stock', label: 'Low-stock Inventory Alert' },
    { value: 'service_promotion', label: 'Service Promotion' },
    { value: 'staff_announcement', label: 'Staff Announcement' },
    { value: 'staff_shift', label: 'Staff Shift' },
    { value: 'staff_attendance', label: 'Staff Attendance' },
    { value: 'salary', label: 'Staff Salary' },
    { value: 'birthday', label: 'Birthday' },
    { value: 'anniversary', label: 'Anniversary' },
    { value: 'membership_renewal', label: 'Membership Renewal' },
    { value: 'package_renewal', label: 'Package Renewal' },
    { value: 'client_follow_up', label: 'Client Follow-up' },
    { value: 'feedback_review', label: 'Feedback / Review' },
    { value: 'festival_campaign', label: 'Festival Campaign' },
  ];
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
      const [inbox, providers, team, control] = await Promise.all([
        firstValueFrom(this.api.get<ApiEnvelope<InboxMessage[]>>('/notifications/inbox')),
        firstValueFrom(this.api.get<ApiEnvelope<Record<string, boolean>>>('/notifications/provider-status')),
        firstValueFrom(this.api.get<ApiEnvelope<TeamChatMessage[]>>('/notifications/team-chat')),
        firstValueFrom(this.api.get<ApiEnvelope<SmsCenterSummary>>(`/notifications/sms-center?audience=${this.controlAudience}&channel=${this.controlChannel}`)),
      ]);
      this.messages = Array.isArray(inbox.data) ? inbox.data : [];
      this.providerStatus = providers.data || {};
      this.teamMessages = Array.isArray(team.data) ? team.data : [];
      this.eligibleRecipients = control.data?.eligibleRecipients || 0;
      this.controlCampaigns = Array.isArray(control.data?.campaigns) ? control.data.campaigns : [];
      if (!this.threads.some((thread) => thread.clientId === this.selectedClientId)) {
        this.selectedClientId = this.threads[0]?.clientId || '';
      }
    } catch (error) { this.error = this.message(error, 'Message inbox could not be loaded'); }
    finally { this.loading = false; }
  }

  setMode(mode: 'center' | 'client' | 'team') { this.mode = mode; this.error = ''; }

  get canManagePayroll() {
    return this.auth.hasRole('owner', 'admin', 'manager') || this.auth.hasPermission('staff.payroll.manage', 'staff.manage', 'management.write');
  }

  get availableAudiences() {
    return this.audiences.filter((item) => item.value !== 'staff_salary' || this.canManagePayroll);
  }

  get availableCategories() {
    return this.categories.filter((item) => item.value !== 'salary' || this.canManagePayroll);
  }

  get isSalaryMessage() { return this.controlAudience === 'staff_salary' || this.controlCategory === 'salary'; }

  async reloadControl() {
    this.error = '';
    try {
      const response = await firstValueFrom(this.api.get<ApiEnvelope<SmsCenterSummary>>(`/notifications/sms-center?audience=${this.controlAudience}&channel=${this.controlChannel}`));
      this.eligibleRecipients = response.data?.eligibleRecipients || 0;
      this.controlCampaigns = Array.isArray(response.data?.campaigns) ? response.data.campaigns : [];
    } catch (error) { this.error = this.message(error, 'SMS Center could not be loaded'); }
  }

  async controlSelectionChanged() {
    if (['inventory_low_stock', 'staff_announcement', 'staff_shift', 'staff_attendance'].includes(this.controlCategory) && !this.controlAudience.startsWith('staff_')) this.controlAudience = 'staff_all';
    if (['paid_invoice_receipt', 'unpaid_payment_reminder', 'wallet_balance'].includes(this.controlCategory) && !this.controlAudience.startsWith('clients_')) {
      this.controlAudience = this.controlCategory === 'paid_invoice_receipt' ? 'clients_paid' : this.controlCategory === 'unpaid_payment_reminder' ? 'clients_unpaid' : 'clients_wallet';
    }
    if (['appointment_confirmation', 'appointment_reminder', 'appointment_reschedule', 'appointment_cancellation', 'product_offer', 'service_promotion', 'birthday', 'anniversary', 'membership_renewal', 'package_renewal', 'client_follow_up', 'feedback_review', 'festival_campaign'].includes(this.controlCategory) && !this.controlAudience.startsWith('clients_')) this.controlAudience = 'clients_all';
    if (this.controlCategory === 'salary') this.controlAudience = 'staff_salary';
    this.sensitiveConfirmed = false;
    await this.reloadControl();
  }

  addEmoji(value: string) { this.controlMessage += value; }

  async sendControlMessage() {
    if (this.busy || !this.controlMessage.trim() || !this.eligibleRecipients || !this.providerReady(this.controlChannel)) return;
    this.busy = true;
    this.error = '';
    try {
      await firstValueFrom(this.api.post('/notifications/sms-center/campaigns', {
        channel: this.controlChannel,
        audience: this.controlAudience,
        category: this.controlCategory,
        subject: this.controlSubject,
        message: this.controlMessage,
        confirmedSensitive: this.sensitiveConfirmed,
        idempotencyKey: crypto.randomUUID(),
      }));
      this.controlSubject = '';
      this.controlMessage = '';
      this.sensitiveConfirmed = false;
      await this.reloadControl();
    } catch (error) { this.error = this.message(error, 'Message campaign could not be queued'); }
    finally { this.busy = false; }
  }

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
    if (channel === 'whatsapp') return !!this.providerStatus['whatsappDelivery'];
    if (channel === 'email') return !!this.providerStatus['emailDelivery'];
    return !!this.providerStatus['smsDelivery'];
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
