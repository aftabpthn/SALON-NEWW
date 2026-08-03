
import { Component, OnDestroy, OnInit, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { ApiEnvelope, ApiService } from '../../shared/services/api.service';
import { AuthService } from '../../core/services/auth.service';

type InboxMessage = {
  id: string;
  threadKey: string;
  clientId?: string;
  leadId?: string;
  contactName: string;
  channel: string;
  direction: string;
  status: string;
  subject: string;
  body: string;
  occurredAt: string;
  assignedTo: string;
  priority: 'low' | 'normal' | 'high' | 'urgent';
  threadStatus: 'open' | 'assigned' | 'resolved';
  slaDueAt: string;
  firstRespondedAt?: string;
  responseOverdue: boolean;
  appointmentId?: string;
  invoiceId?: string;
  invoiceNumber?: string;
};

type SlaSummary = { openThreads: number; assignedThreads: number; unassignedThreads: number; overdueThreads: number; resolvedToday: number; avgFirstResponseSeconds?: number };
type MessageTemplate = { id: string; name: string; channel: string; body: string; status: string };
type VoiceCall = { id: string; direction: string; callerPhone: string; status: string; startedAt?: string; createdAt: string; conversationDurationSeconds: number; recordingAvailable: boolean; recordingConsentStatus: string; callQueue: string; extension: string; voicemail: boolean; aiSummary: string; clientId?: string; leadId?: string; appointmentId?: string; posSaleId?: string };
type VoiceCallReport = { recentCalls: VoiceCall[]; summary: { totalCalls: number; missedCalls: number; answeredCalls: number; callbackRequired: number; humanHandoffs: number; recordings: number } };
type StaffParticipant = { userId: string; name: string };

type TeamChatMessage = {
  id: string;
  senderUserId: string;
  senderName: string;
  body: string;
  replyToMessageId?: string;
  createdAt: string;
};

type StaffChatConversation = {
  id: string;
  type: 'team' | 'private-owner';
  title: string;
  messageCount: number;
  lastMessageAt?: string;
};

type StaffConversationMessage = {
  id: string;
  conversationId: string;
  type: 'team' | 'private-owner';
  senderUserId: string;
  senderName: string;
  body: string;
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
    imports: [FormsModule],
    templateUrl: './notifications-page.component.html',
    styleUrls: ['./notifications-page.component.css']
})
export class NotificationsPageComponent implements OnInit, OnDestroy {
  private readonly api = inject(ApiService);
  private readonly auth = inject(AuthService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private teamSocket: WebSocket | null = null;
  private reconnectTimer?: ReturnType<typeof setTimeout>;
  messages: InboxMessage[] = [];
  teamMessages: TeamChatMessage[] = [];
  privateConversations: StaffChatConversation[] = [];
  privateMessages: StaffConversationMessage[] = [];
  controlCampaigns: SmsCenterCampaign[] = [];
  templates: MessageTemplate[] = [];
  voiceReport: VoiceCallReport = { recentCalls: [], summary: { totalCalls: 0, missedCalls: 0, answeredCalls: 0, callbackRequired: 0, humanHandoffs: 0, recordings: 0 } };
  participants: StaffParticipant[] = [];
  sla: SlaSummary = { openThreads: 0, assignedThreads: 0, unassignedThreads: 0, overdueThreads: 0, resolvedToday: 0 };
  providerStatus: Record<string, any> = {};
  mode: 'center' | 'client' | 'calls' | 'team' | 'private' = 'center';
  selectedThreadKey = '';
  selectedClientId = '';
  selectedPrivateConversationId = '';
  channel = 'whatsapp';
  reply = '';
  threadStatus: 'open' | 'assigned' | 'resolved' = 'open';
  threadPriority: 'low' | 'normal' | 'high' | 'urgent' = 'normal';
  threadAssignee = '';
  handoverNote = '';
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
    for (const message of this.messages) if (!clients.has(message.threadKey)) clients.set(message.threadKey, message);
    return [...clients.values()];
  }

  get selectedMessages() {
    return this.messages.filter((message) => message.threadKey === this.selectedThreadKey).slice().reverse();
  }

  get selectedThread() { return this.threads.find((thread) => thread.threadKey === this.selectedThreadKey); }
  get approvedTemplates() { return this.templates.filter((template) => template.status === 'active' && template.channel === this.channel); }
  get canManageThreads() { return this.auth.hasRole('owner', 'admin', 'manager', 'frontdesk', 'receptionist') || this.auth.hasPermission('notifications.manage', 'front_desk.write'); }
  get canViewCalls() { return this.auth.hasRole('owner', 'admin', 'manager', 'frontdesk', 'receptionist') || this.auth.hasPermission('ai.concierge.read', 'notifications.read'); }

  async reload() {
    this.loading = true;
    this.error = '';
    try {
      const [inbox, providers, team, control, sla] = await Promise.all([
        firstValueFrom(this.api.get<ApiEnvelope<InboxMessage[]>>('/notifications/inbox')),
        firstValueFrom(this.api.get<ApiEnvelope<Record<string, boolean>>>('/notifications/provider-status')),
        firstValueFrom(this.api.get<ApiEnvelope<TeamChatMessage[]>>('/notifications/team-chat')),
        firstValueFrom(this.api.get<ApiEnvelope<SmsCenterSummary>>(`/notifications/sms-center?audience=${this.controlAudience}&channel=${this.controlChannel}`)),
        firstValueFrom(this.api.get<ApiEnvelope<SlaSummary>>('/notifications/inbox/sla')),
      ]);
      this.messages = Array.isArray(inbox.data) ? inbox.data : [];
      this.providerStatus = providers.data || {};
      this.teamMessages = Array.isArray(team.data) ? team.data : [];
      this.eligibleRecipients = control.data?.eligibleRecipients || 0;
      this.controlCampaigns = Array.isArray(control.data?.campaigns) ? control.data.campaigns : [];
      this.sla = sla.data || this.sla;
      const routeClientId = this.route.snapshot.queryParamMap.get('clientId') || '';
      if (routeClientId && this.threads.some((thread) => thread.clientId === routeClientId)) {
        this.selectedClientId = routeClientId;
        this.selectedThreadKey = `client:${routeClientId}`;
        this.mode = 'client';
      }
      if (!this.threads.some((thread) => thread.threadKey === this.selectedThreadKey)) {
        const first = this.threads[0];
        this.selectedThreadKey = first?.threadKey || '';
        this.selectedClientId = first?.clientId || '';
      }
      this.copySelectedThreadState();
      if (this.canUsePrivateStaffChat) await this.reloadPrivateConversations();
      await this.reloadCommunicationExtras();
    } catch (error) { this.error = this.message(error, 'Message inbox could not be loaded'); }
    finally { this.loading = false; }
  }

  setMode(mode: 'center' | 'client' | 'calls' | 'team' | 'private') {
    this.mode = mode;
    this.error = '';
    if (mode === 'private' && this.selectedPrivateConversationId) void this.loadPrivateConversation(this.selectedPrivateConversationId);
  }

  get canUsePrivateStaffChat() { return this.auth.hasRole('owner', 'super-admin'); }

  get selectedPrivateConversation() {
    return this.privateConversations.find((conversation) => conversation.id === this.selectedPrivateConversationId);
  }

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
    this.selectedThreadKey = thread.threadKey;
    this.selectedClientId = thread.clientId || '';
    this.copySelectedThreadState();
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

  async loadPrivateConversation(conversationId: string) {
    if (!conversationId) return;
    this.selectedPrivateConversationId = conversationId;
    this.error = '';
    try {
      const response = await firstValueFrom(this.api.get<ApiEnvelope<StaffConversationMessage[]>>(`/team-chat/conversations/${encodeURIComponent(conversationId)}/messages`));
      this.privateMessages = Array.isArray(response.data) ? response.data : [];
    } catch (error) { this.error = this.message(error, 'Private staff conversation could not be loaded'); }
  }

  async sendPrivateMessage() {
    const body = this.reply.trim();
    if (!this.selectedPrivateConversationId || !body || this.busy) return;
    this.busy = true;
    this.error = '';
    try {
      await firstValueFrom(this.api.post(`/team-chat/conversations/${encodeURIComponent(this.selectedPrivateConversationId)}/messages`, { body }));
      this.reply = '';
      await Promise.all([this.loadPrivateConversation(this.selectedPrivateConversationId), this.reloadPrivateConversations()]);
    } catch (error) { this.error = this.message(error, 'Private staff message could not be sent'); }
    finally { this.busy = false; }
  }

  useTemplate(body: string) { this.reply = body; }

  async suggestReply() {
    if (!this.selectedThreadKey || this.busy) return;
    this.busy = true;
    this.error = '';
    try {
      const response = await firstValueFrom(this.api.post<ApiEnvelope<{ body: string }>>(`/notifications/inbox/threads/${encodeURIComponent(this.selectedThreadKey)}/suggestion`, {}));
      this.reply = response.data?.body || '';
    } catch (error) { this.error = this.message(error, 'No approved response is available'); }
    finally { this.busy = false; }
  }

  async updateThread() {
    if (!this.selectedThreadKey || !this.canManageThreads || this.busy) return;
    this.busy = true;
    this.error = '';
    try {
      await firstValueFrom(this.api.patch(`/notifications/inbox/threads/${encodeURIComponent(this.selectedThreadKey)}`, {
        status: this.threadStatus,
        priority: this.threadPriority,
        assignedTo: this.threadAssignee || undefined,
        note: this.handoverNote || undefined,
      }));
      this.handoverNote = '';
      await this.reload();
    } catch (error) { this.error = this.message(error, 'Conversation assignment could not be updated'); }
    finally { this.busy = false; }
  }

  bookSelectedClient() {
    if (this.selectedClientId) void this.router.navigate(['/appointments'], { queryParams: { clientId: this.selectedClientId, openBooking: '1' } });
  }

  openLead(leadId?: string) { if (leadId) void this.router.navigate(['/marketing'], { queryParams: { leadId } }); }
  openAppointment(appointmentId?: string) { if (appointmentId) void this.router.navigate(['/appointments'], { queryParams: { appointmentId } }); }
  openInvoice(invoiceId?: string) { if (invoiceId) void this.router.navigate(['/billing/invoices', invoiceId]); }

  isOwnMessage(message: TeamChatMessage) { return message.senderUserId === this.auth.userId; }

  providerReady(channel: string) {
    if (channel === 'whatsapp') return !!this.providerStatus['whatsappDelivery'];
    if (channel === 'email') return !!this.providerStatus['emailDelivery'];
    if (channel === 'voice') return !!this.providerStatus['voiceDelivery'];
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

  formatDuration(seconds?: number) {
    const value = Math.max(0, Number(seconds || 0));
    return `${Math.floor(value / 60)}m ${value % 60}s`;
  }

  maskedPhone(value: string) {
    const digits = String(value || '').replace(/\D/g, '');
    return digits ? `••••${digits.slice(-4)}` : 'Unknown caller';
  }

  private copySelectedThreadState() {
    const thread = this.selectedThread;
    this.threadStatus = thread?.threadStatus || 'open';
    this.threadPriority = thread?.priority || 'normal';
    this.threadAssignee = thread?.assignedTo || '';
  }

  private async reloadCommunicationExtras() {
    const [templates, participants, calls] = await Promise.allSettled([
      firstValueFrom(this.api.get<ApiEnvelope<MessageTemplate[]>>('/message-templates')),
      firstValueFrom(this.api.get<ApiEnvelope<StaffParticipant[]>>('/team-chat/participants')),
      firstValueFrom(this.api.get<ApiEnvelope<VoiceCallReport>>('/ai/concierge/calls/report')),
    ]);
    if (templates.status === 'fulfilled') this.templates = Array.isArray(templates.value.data) ? templates.value.data : [];
    if (participants.status === 'fulfilled') this.participants = Array.isArray(participants.value.data) ? participants.value.data : [];
    if (calls.status === 'fulfilled' && calls.value.data) this.voiceReport = calls.value.data;
  }

  private async reloadPrivateConversations() {
    const response = await firstValueFrom(this.api.get<ApiEnvelope<StaffChatConversation[]>>('/team-chat/conversations'));
    this.privateConversations = (Array.isArray(response.data) ? response.data : []).filter((conversation) => conversation.type === 'private-owner');
    if (!this.privateConversations.some((conversation) => conversation.id === this.selectedPrivateConversationId)) {
      this.selectedPrivateConversationId = this.privateConversations[0]?.id || '';
      this.privateMessages = [];
    }
  }

  private connectTeamChat() {
    const token = this.auth.accessToken || '';
    if (!token || typeof WebSocket === 'undefined') return;
    const scheme = location.protocol === 'https:' ? 'wss' : 'ws';
    this.teamSocket = new WebSocket(`${scheme}://${location.host}/api/v1/realtime/team-chat`, ['aurashine-v1', token]);
    this.teamSocket.onmessage = () => {
      void this.reloadTeamChat();
      if (this.canUsePrivateStaffChat) {
        void this.reloadPrivateConversations();
        if (this.selectedPrivateConversationId) void this.loadPrivateConversation(this.selectedPrivateConversationId);
      }
    };
    this.teamSocket.onclose = () => {
      this.teamSocket = null;
      this.reconnectTimer = setTimeout(() => this.connectTeamChat(), 3000);
    };
  }

  private message(error: any, fallback: string) { return error?.error?.error?.message || error?.error?.message || fallback; }
}
