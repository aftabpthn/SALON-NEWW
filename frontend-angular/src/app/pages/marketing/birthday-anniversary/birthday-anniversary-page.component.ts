import { CommonModule } from '@angular/common';
import { Component, HostListener, OnInit, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { DatePickerComponent } from '../../../shared/date-picker/date-picker.component';
import { ApiEnvelope, ApiService } from '../../../shared/services/api.service';

type Tab = 'occasions' | 'reminders' | 'vouchers' | 'campaign';
type Range = 'today' | 'week' | 'month';
type Drawer = 'draft' | 'settings' | 'audit' | 'redeem' | null;

type Settings = {
  workflowMode: string;
  popupEnabled: boolean;
  approvalRequired: boolean;
  autoSendEnabled: boolean;
  defaultSendTime: string;
  timezone: string;
  daysAhead: number;
  channels: string[];
};

type Metrics = {
  todayBirthdays: number;
  todayAnniversaries: number;
  pendingApprovals: number;
  queued: number;
  sent: number;
  giftPrepared: number;
  giftSent: number;
  giftRedeemed: number;
  giftExpired: number;
  giftPreparedValuePaise: number;
  giftRedeemedValuePaise: number;
};

type Occasion = {
  clientId: string;
  firstName: string;
  lastName: string;
  phone: string;
  email: string;
  eventType: string;
  eventDate: string;
  daysUntil: number;
  eventWindow: string;
  reminderId?: string;
  reminderStatus?: string;
  mostUsedServiceName?: string;
  mostUsedServiceVisits?: number;
  giftRecommendation?: GiftRecommendation;
  whatsappOptIn?: boolean;
  smsOptIn?: boolean;
  emailOptIn?: boolean;
};

type Reminder = {
  id: string;
  clientId: string;
  clientName: string;
  eventType: string;
  eventDate: string;
  status: string;
  channels: string[];
  selectedMessage: string;
  couponId?: string;
  couponCode?: string;
  scheduledSendAt?: string;
  failureReason: string;
  version: number;
};

type Voucher = {
  id: string;
  clientName: string;
  couponCode: string;
  status: string;
  expiresAt?: string;
  redeemedSaleId?: string;
};

type Overview = {
  date: string;
  settings: Settings;
  metrics: Metrics;
  today: Occasion[];
  week: Occasion[];
  month: Occasion[];
  clients: Occasion[];
  reminders: Reminder[];
  vouchers: Voucher[];
};

type Coupon = { id: string; code: string; active: boolean; startsAt?: string; endsAt?: string };
type AuditLog = { id: string; clientName: string; action: string; actorUserId: string; createdAt: string };
type GiftRecommendation = { title?: string; description?: string; segment?: string; giftType?: string; valuePaise?: number; serviceName?: string };
type Suggestion = { id: string; text?: string; title?: string; serviceName?: string };
type Campaign = { daysAhead: number; clients: Occasion[]; current: Occasion[]; upcoming: Occasion[]; messageSuggestions: Suggestion[]; offerSuggestions: Suggestion[] };

const emptySettings = (): Settings => ({
  workflowMode: 'legacy_auto', popupEnabled: true, approvalRequired: true,
  autoSendEnabled: false, defaultSendTime: '09:00', timezone: 'Asia/Kolkata',
  daysAhead: 30, channels: ['whatsapp'],
});

@Component({
    selector: 'page-birthday-anniversary',
    imports: [CommonModule, FormsModule, DatePickerComponent],
    templateUrl: './birthday-anniversary-page.component.html',
    styleUrls: ['./birthday-anniversary-page.component.css']
})
export class BirthdayAnniversaryPageComponent implements OnInit {
  private readonly api = inject(ApiService);

  selectedDate = this.isoDate(new Date());
  activeTab: Tab = 'occasions';
  range: Range = 'today';
  eventFilter = '';
  statusFilter = '';
  search = '';
  drawer: Drawer = null;
  loading = true;
  busy = false;
  loaded = false;
  error = '';
  notice = '';
  providerStatus: Record<string, boolean> = {};
  coupons: Coupon[] = [];
  auditLogs: AuditLog[] = [];
  campaign: Campaign = { daysAhead: 30, clients: [], current: [], upcoming: [], messageSuggestions: [], offerSuggestions: [] };
  campaignMode: 'all' | 'today' | 'upcoming' = 'all';
  campaignMessage = '';
  campaignClientId = '';
  campaignCouponId = '';
  campaignChannels = { whatsapp: true, sms: false, email: false };
  redeemVoucher: Voucher | null = null;
  redeemSaleId = '';
  editingReminder: Reminder | null = null;
  overview: Overview = {
    date: this.selectedDate,
    settings: emptySettings(),
    metrics: {
      todayBirthdays: 0,
      todayAnniversaries: 0,
      pendingApprovals: 0,
      queued: 0,
      sent: 0,
      giftPrepared: 0,
      giftSent: 0,
      giftRedeemed: 0,
      giftExpired: 0,
      giftPreparedValuePaise: 0,
      giftRedeemedValuePaise: 0,
    },
    today: [], week: [], month: [], clients: [], reminders: [], vouchers: [],
  };
  settingsDraft = emptySettings();
  draft = this.newDraft();

  async ngOnInit() { await this.refresh(); }

  get dataStatus() { return this.loaded && !this.error ? 'Live data' : this.loading ? 'Loading' : 'Unavailable'; }
  get occasions() {
    const source = this.range === 'today' ? this.overview.today : this.range === 'week' ? this.overview.week : this.overview.month;
    const query = this.search.trim().toLowerCase();
    return source.filter((row) => {
      const status = row.reminderStatus || 'not started';
      return (!this.eventFilter || row.eventType === this.eventFilter)
        && (!this.statusFilter || status === this.statusFilter)
        && (!query || `${this.clientName(row)} ${row.phone} ${row.email}`.toLowerCase().includes(query));
    });
  }
  get reminders() {
    const query = this.search.trim().toLowerCase();
    return this.overview.reminders.filter((row) => (!this.eventFilter || row.eventType === this.eventFilter)
      && (!this.statusFilter || row.status === this.statusFilter)
      && (!query || row.clientName.toLowerCase().includes(query)));
  }
  get campaignClients() {
    return this.campaignMode === 'today' ? this.campaign.current : this.campaignMode === 'upcoming' ? this.campaign.upcoming : this.campaign.clients;
  }
  get activeCoupons() {
    const now = Date.now();
    return this.coupons.filter((coupon) => coupon.active
      && (!coupon.startsAt || new Date(coupon.startsAt).getTime() <= now)
      && (!coupon.endsAt || new Date(coupon.endsAt).getTime() >= now));
  }

  async refresh() {
    this.loading = true;
    this.error = '';
    try {
      const [overview, providers, coupons] = await Promise.all([
        firstValueFrom(this.api.get<ApiEnvelope<Overview>>(`/birthday-anniversary/overview?date=${this.selectedDate}`)),
        firstValueFrom(this.api.get<ApiEnvelope<Record<string, boolean>>>('/notifications/provider-status')),
        firstValueFrom(this.api.get<ApiEnvelope<Coupon[]>>('/pos/coupons')),
      ]);
      if (!overview.data) throw new Error('Birthday and anniversary data is unavailable');
      this.overview = overview.data;
      this.providerStatus = providers.data || {};
      this.coupons = Array.isArray(coupons.data) ? coupons.data : [];
      this.loaded = true;
      if (this.activeTab === 'campaign') await this.loadCampaign();
    } catch (error) {
      this.error = this.errorText(error, 'Birthday and anniversary data could not be loaded');
    } finally { this.loading = false; }
  }

  async setTab(tab: Tab) {
    this.activeTab = tab;
    this.statusFilter = '';
    if (tab === 'campaign' && !this.campaign.clients.length) {
      try { await this.loadCampaign(); } catch (error) { this.error = this.errorText(error, 'Campaign data could not be loaded'); }
    }
  }

  async loadCampaign() {
    const response = await firstValueFrom(this.api.get<ApiEnvelope<Campaign>>(
      `/birthday-campaign/summary?date=${this.selectedDate}&daysAhead=${this.overview.settings.daysAhead}`,
    ));
    this.campaign = response.data || { daysAhead: this.overview.settings.daysAhead, clients: [], current: [], upcoming: [], messageSuggestions: [], offerSuggestions: [] };
    if (!this.campaignClients.some((row) => row.clientId === this.campaignClientId)) this.campaignClientId = this.campaignClients[0]?.clientId || '';
  }

  openDraft(row?: Occasion) {
    this.editingReminder = null;
    this.draft = this.newDraft(row);
    this.drawer = 'draft';
  }

  openApproval(reminder: Reminder) {
    this.editingReminder = reminder;
    const scheduled = reminder.scheduledSendAt ? new Date(reminder.scheduledSendAt) : null;
    this.draft = {
      clientId: reminder.clientId, eventType: reminder.eventType, message: reminder.selectedMessage,
      couponId: reminder.couponId || '', scheduleDate: scheduled ? this.isoDate(scheduled) : '',
      scheduleTime: scheduled ? `${String(scheduled.getHours()).padStart(2, '0')}:${String(scheduled.getMinutes()).padStart(2, '0')}` : '',
      whatsapp: reminder.channels.includes('whatsapp'), sms: reminder.channels.includes('sms'), email: reminder.channels.includes('email'),
    };
    this.drawer = 'draft';
  }

  async saveDraft() {
    const channels = this.channels(this.draft);
    if (!channels.length) return void (this.error = 'Select at least one delivery channel');
    await this.runAction(async () => {
      const scheduledSendAt = this.schedule(this.draft.scheduleDate, this.draft.scheduleTime);
      if (this.editingReminder) {
        if (!this.draft.message.trim()) throw new Error('Message is required before approval');
        await firstValueFrom(this.api.post(`/birthday-anniversary/reminders/${this.editingReminder.id}/approve`, {
          selectedMessage: this.draft.message.trim(), couponId: this.draft.couponId || null,
          scheduledSendAt, expectedVersion: this.editingReminder.version,
        }));
        this.notice = 'Reminder approved';
      } else {
        await firstValueFrom(this.api.post('/birthday-anniversary/drafts', {
          date: this.selectedDate, filters: [this.range], clientId: this.draft.clientId || null,
          eventType: this.draft.eventType || null, channels, selectedMessage: this.draft.message.trim(),
          messageOptions: this.draft.message.trim() ? [{ id: 'custom', source: 'user', text: this.draft.message.trim() }] : [],
          couponId: this.draft.couponId || null, scheduledSendAt,
        }));
        this.notice = 'Drafts saved';
      }
      this.closeDrawer();
      await this.refresh();
    }, 'Reminder draft could not be saved');
  }

  async sendReminder(reminder: Reminder) {
    await this.runAction(async () => {
      await firstValueFrom(this.api.post(`/birthday-anniversary/reminders/${reminder.id}/send`, {}));
      this.notice = 'Reminder queued';
      await this.refresh();
    }, 'Reminder could not be queued');
  }

  async runAutoSend() {
    await this.runAction(async () => {
      const response = await firstValueFrom(this.api.post<ApiEnvelope<{ queued: number; failed: number }>>('/birthday-anniversary/auto-send', {}));
      this.notice = `Auto-send: ${response.data?.queued || 0} queued, ${response.data?.failed || 0} failed`;
      await this.refresh();
    }, 'Auto-send could not run');
  }

  openSettings() {
    this.settingsDraft = { ...this.overview.settings, channels: [...this.overview.settings.channels] };
    this.drawer = 'settings';
  }

  async saveSettings() {
    const channels = this.settingsDraft.channels;
    if (!channels.length) return void (this.error = 'Select at least one default channel');
    await this.runAction(async () => {
      await firstValueFrom(this.api.patch('/birthday-anniversary/settings', this.settingsDraft));
      this.notice = 'Settings saved';
      this.closeDrawer();
      await this.refresh();
    }, 'Settings could not be saved');
  }

  toggleSettingChannel(channel: string) {
    this.settingsDraft.channels = this.settingsDraft.channels.includes(channel)
      ? this.settingsDraft.channels.filter((item) => item !== channel)
      : [...this.settingsDraft.channels, channel];
  }

  async openAudit() {
    this.drawer = 'audit';
    this.auditLogs = [];
    try {
      const response = await firstValueFrom(this.api.get<ApiEnvelope<{ items: AuditLog[] }>>('/birthday-anniversary/audit-logs?limit=100'));
      this.auditLogs = response.data?.items || [];
    } catch (error) { this.error = this.errorText(error, 'Audit log could not be loaded'); }
  }

  openRedeem(voucher: Voucher) {
    this.redeemVoucher = voucher;
    this.redeemSaleId = '';
    this.drawer = 'redeem';
  }

  async redeem() {
    if (!this.redeemVoucher || !this.redeemSaleId.trim()) return void (this.error = 'Sale ID is required');
    if (!window.confirm(`Redeem voucher ${this.redeemVoucher.couponCode} against this sale?`)) return;
    await this.runAction(async () => {
      await firstValueFrom(this.api.post(`/birthday-anniversary/vouchers/${this.redeemVoucher!.id}/redeem`, { saleId: this.redeemSaleId.trim() }));
      this.notice = 'Voucher redeemed';
      this.closeDrawer();
      await this.refresh();
    }, 'Voucher could not be redeemed');
  }

  async sendCampaign(mode?: 'today' | 'upcoming') {
    const message = this.campaignMessage.trim();
    const channels = this.channels(this.campaignChannels);
    if (!message || !channels.length) return void (this.error = 'Message and at least one channel are required');
    if (mode && !window.confirm(`Queue this campaign for ${mode} birthday clients?`)) return;
    await this.runAction(async () => {
      if (mode) {
        await firstValueFrom(this.api.post('/birthday-campaign/send-bulk', {
          mode, daysAhead: this.campaign.daysAhead, limit: 100, message, channels,
          couponId: this.campaignCouponId || null,
        }));
      } else {
        if (!this.campaignClientId) throw new Error('Select a client');
        await firstValueFrom(this.api.post('/birthday-campaign/send', {
          clientId: this.campaignClientId, message, channels, couponId: this.campaignCouponId || null,
        }));
      }
      this.notice = mode ? 'Campaign queued' : 'Client message queued';
      await this.refresh();
    }, 'Campaign could not be queued');
  }

  async prepareMonth() {
    const channels = this.channels(this.campaignChannels);
    if (!channels.length) return void (this.error = 'Select at least one channel');
    await this.runAction(async () => {
      const response = await firstValueFrom(this.api.post<ApiEnvelope<{ prepared: number; updated: number; skipped: number }>>('/birthday-campaign/prepare-month', {
        date: this.selectedDate, channels, couponId: this.campaignCouponId || null,
      }));
      const data = response.data;
      this.notice = `Month prepared: ${data?.prepared || 0} new, ${data?.updated || 0} updated, ${data?.skipped || 0} skipped`;
      await this.refresh();
    }, 'Birthday month could not be prepared');
  }

  closeDrawer() { this.drawer = null; this.editingReminder = null; this.redeemVoucher = null; }
  @HostListener('document:keydown.escape') closeDrawerOnEscape() { if (this.drawer) this.closeDrawer(); }
  clientName(row: Occasion) { return `${row.firstName || ''} ${row.lastName || ''}`.trim() || row.clientId; }
  title(value: string) { return String(value || '').replace(/[-_]/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase()); }
  displayDate(value?: string) {
    const match = String(value || '').slice(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})$/);
    return match ? `${match[3]}/${match[2]}/${match[1]}` : '—';
  }
  displayDateTime(value?: string) { return value ? new Date(value).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) : '—'; }
  reachable(row: Occasion) {
    return [row.whatsappOptIn && row.phone ? 'WhatsApp' : '', row.smsOptIn && row.phone ? 'SMS' : '', row.emailOptIn && row.email ? 'Email' : ''].filter(Boolean).join(', ') || '—';
  }
  providerReady(channel: string) { return !!this.providerStatus[`${channel}Delivery`]; }
  serviceName(row: Occasion) { return row.mostUsedServiceName?.trim() || '—'; }
  giftTitle(row?: Occasion) { return row?.giftRecommendation?.title?.trim() || ''; }
  money(value?: number) { return `₹${Math.round((value || 0) / 100).toLocaleString('en-IN')}`; }
  trackById(_: number, row: { id?: string; clientId?: string }) { return row.id || row.clientId || _; }
  applyCampaignMessage(suggestion: Suggestion) { if (suggestion.text) this.campaignMessage = suggestion.text; }
  applyCampaignOffer(suggestion: Suggestion) {
    if (!suggestion.title) return;
    this.campaignMessage = `Happy birthday! Your ${suggestion.title} is ready. Reply to book your visit.`;
  }
  get draftSuggestions() {
    const row = this.overview.clients.find((item) => item.clientId === this.draft.clientId);
    return this.localSuggestions(row, this.draft.eventType || row?.eventType || 'birthday');
  }
  applyDraftMessage(suggestion: Suggestion) { if (suggestion.text) this.draft.message = suggestion.text; }

  private newDraft(row?: Occasion) {
    const channels = this.overview?.settings?.channels || ['whatsapp'];
    return { clientId: row?.clientId || '', eventType: row?.eventType || '', message: '', couponId: '', scheduleDate: '', scheduleTime: '',
      whatsapp: channels.includes('whatsapp'), sms: channels.includes('sms'), email: channels.includes('email') };
  }
  private channels(value: { whatsapp: boolean; sms: boolean; email: boolean }) {
    return (['whatsapp', 'sms', 'email'] as const).filter((channel) => value[channel]);
  }
  private schedule(date: string, time: string) { return date && time ? new Date(`${date}T${time}:00`).toISOString() : null; }
  private isoDate(date: Date) { return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`; }
  private localSuggestions(row: Occasion | undefined, eventType: string): Suggestion[] {
    const occasion = eventType === 'anniversary' ? 'anniversary' : 'birthday';
    const service = row?.mostUsedServiceName?.trim() || 'favorite service';
    const gift = this.giftTitle(row) || `${service} gift`;
    return [
      `Happy ${occasion}! Your ${gift} is ready for this month.`,
      `Wishing you a happy ${occasion}. Visit us for a special ${service} treat.`,
      `Your ${occasion} gift is waiting: ${gift}.`,
      `Happy ${occasion}! Celebrate with your favourite ${service} at AuraShine.`,
      `This ${occasion} month, enjoy ${gift} from us.`,
      `Best wishes on your ${occasion}. Your ${gift} reward is ready.`,
      `Celebrate your ${occasion} with a special ${service} salon gift.`,
      `A warm ${occasion} wish from AuraShine. Your ${service} benefit is ready.`,
      `Happy ${occasion}! Book your ${service} visit and use your birthday gift.`,
      `Your ${occasion} deserves a glow-up. Your ${service} gift is ready.`,
    ].map((text, index) => ({ id: `draft-${index + 1}`, text, serviceName: service }));
  }
  private async runAction(action: () => Promise<void>, fallback: string) {
    if (this.busy) return;
    this.busy = true;
    this.error = '';
    this.notice = '';
    try { await action(); } catch (error) { this.error = this.errorText(error, fallback); } finally { this.busy = false; }
  }
  private errorText(error: unknown, fallback: string) {
    const value = error as { message?: string; error?: { error?: string | { message?: string }; message?: string } };
    return (typeof value?.error?.error === 'string' ? value.error.error : value?.error?.error?.message) || value?.error?.message || value?.message || fallback;
  }
}
