import { CommonModule } from '@angular/common';
import { Component, OnInit, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { DatePickerComponent } from '../../shared/date-picker/date-picker.component';
import { ApiEnvelope, ApiService } from '../../shared/services/api.service';

type Stage = 'New' | 'Contacted' | 'Qualified' | 'Converted';
type Campaign = { id: string; title: string; body: string; metadata?: any; createdAt: string };
type Lead = { id: string; firstName: string; lastName: string; phone: string; email: string; categories: string[]; notes: string };
type MarketingInsights = {
  consent?: { total?: number; whatsapp?: number; sms?: number; email?: number };
  attribution?: { source: string; count: number }[];
  reputation?: { averageRating?: number | null; reviewCount?: number; reviews?: any[] };
};

@Component({
  selector: 'page-marketing-leads',
  standalone: true,
  imports: [CommonModule, FormsModule, DatePickerComponent],
  templateUrl: './marketing-leads-page.component.html',
  styleUrls: ['./marketing-leads-page.component.css'],
})
export class MarketingLeadsPageComponent implements OnInit {
  private readonly api = inject(ApiService);
  readonly stages: Stage[] = ['New', 'Contacted', 'Qualified', 'Converted'];
  campaigns: Campaign[] = [];
  leads: Lead[] = [];
  insights: MarketingInsights = {};
  providers: Record<string, boolean> = {};
  channel = 'all';
  status = 'all';
  loading = true;
  busy = false;
  error = '';
  drawer: 'lead' | 'campaign' | '' = '';
  leadDraft = this.emptyLead();
  campaignDraft = this.emptyCampaign();

  async ngOnInit() { await this.reload(); }

  get filteredCampaigns() {
    return this.campaigns.filter((campaign) =>
      (this.channel === 'all' || campaign.metadata?.channel === this.channel) &&
      (this.status === 'all' || (campaign.metadata?.status || 'draft') === this.status));
  }
  stageLeads(stage: Stage) { return this.leads.filter((lead) => this.stage(lead) === stage); }
  campaignCount(status: string) { return this.campaigns.filter((campaign) => (campaign.metadata?.status || 'draft') === status).length; }

  async reload() {
    this.loading = true;
    this.error = '';
    try {
      const [campaigns, clients, insights, providers] = await Promise.all([
        firstValueFrom(this.api.get<ApiEnvelope<any>>('/notifications?notificationType=marketing_campaign&pageSize=200')),
        firstValueFrom(this.api.get<ApiEnvelope<any[]>>('/clients?page=1&pageSize=100')),
        firstValueFrom(this.api.get<ApiEnvelope<MarketingInsights>>('/notifications/marketing-insights')),
        firstValueFrom(this.api.get<ApiEnvelope<Record<string, boolean>>>('/notifications/provider-status')),
      ]);
      this.campaigns = Array.isArray(campaigns.data?.data) ? campaigns.data.data : [];
      const rows = Array.isArray(clients.data) ? clients.data : [];
      this.leads = rows.map((row) => ({ ...row, categories: this.categories(row.categories) }))
        .filter((row) => row.categories.some((category: string) => category.toLowerCase() === 'lead'));
      this.insights = insights.data || {};
      this.providers = providers.data || {};
    } catch (error) { this.error = this.message(error, 'Marketing workspace could not be loaded'); }
    finally { this.loading = false; }
  }

  openLead() { this.leadDraft = this.emptyLead(); this.drawer = 'lead'; }
  openCampaign() { this.campaignDraft = this.emptyCampaign(); this.drawer = 'campaign'; }
  closeDrawer() { if (!this.busy) this.drawer = ''; }

  async saveLead() {
    const name = this.leadDraft.name.trim().replace(/\s+/g, ' ');
    if (!name || !this.leadDraft.phone.trim()) return;
    const parts = name.split(' ');
    this.busy = true;
    this.error = '';
    try {
      await firstValueFrom(this.api.post('/clients', {
        firstName: this.titleCase(parts.shift() || ''), lastName: this.titleCase(parts.join(' ')),
        phone: this.leadDraft.phone.trim(), email: this.leadDraft.email.trim().toLowerCase(),
        categories: ['Lead', 'Lead:New'],
        notes: this.leadNotes(this.leadDraft.source, this.leadDraft.followUp),
      }));
      this.drawer = '';
      await this.reload();
    } catch (error) { this.error = this.message(error, 'Lead could not be saved'); }
    finally { this.busy = false; }
  }

  async moveLead(lead: Lead, stage: Stage) {
    if (this.stage(lead) === stage) return;
    this.busy = true;
    this.error = '';
    try {
      const categories = lead.categories.filter((category) => !category.toLowerCase().startsWith('lead:'));
      await firstValueFrom(this.api.patch(`/clients/${lead.id}`, { categories: [...categories, `Lead:${stage}`] }));
      await this.reload();
    } catch (error) { this.error = this.message(error, 'Lead stage could not be updated'); }
    finally { this.busy = false; }
  }

  async saveCampaign() {
    if (!this.campaignDraft.name.trim() || !this.campaignDraft.message.trim()) return;
    const scheduledAt = this.campaignSchedule();
    if (this.campaignDraft.scheduledDate && !scheduledAt) { this.error = 'Valid schedule time is required'; return; }
    this.busy = true;
    this.error = '';
    try {
      await firstValueFrom(this.api.post('/notifications', {
        notificationType: 'marketing_campaign', title: this.titleCase(this.campaignDraft.name),
        body: this.campaignDraft.message.trim(), resourceType: 'marketing_campaign',
        metadata: { channel: this.campaignDraft.channel, audience: this.campaignDraft.audience, status: scheduledAt ? 'scheduled' : 'draft', scheduledAt },
      }));
      this.drawer = '';
      await this.reload();
    } catch (error) { this.error = this.message(error, 'Campaign draft could not be saved'); }
    finally { this.busy = false; }
  }

  stage(lead: Lead): Stage {
    const value = lead.categories.find((category) => category.toLowerCase().startsWith('lead:'))?.split(':')[1];
    return this.stages.find((stage) => stage.toLowerCase() === String(value || '').toLowerCase()) || 'New';
  }
  displayName(lead: Lead) { return `${lead.firstName || ''} ${lead.lastName || ''}`.trim(); }
  formatDate(value: string) { const date = new Date(value); return Number.isNaN(date.getTime()) ? '—' : new Intl.DateTimeFormat('en-GB').format(date); }
  formatRating(value: unknown) { const rating = Number(value); return Number.isFinite(rating) ? rating.toFixed(1) : '—'; }
  providerReady(channel: string) { return !!this.providers[`${channel}Delivery`]; }
  private categories(value: unknown): string[] { if (Array.isArray(value)) return value.map(String); try { const parsed = JSON.parse(String(value || '[]')); return Array.isArray(parsed) ? parsed.map(String) : []; } catch { return []; } }
  private leadNotes(source: string, followUp: string) { return [source && `Source: ${source}`, followUp && `Next follow-up: ${followUp}`].filter(Boolean).join(' | '); }
  titleCase(value: string) { return value.trim().toLowerCase().replace(/\b\p{L}/gu, (letter) => letter.toUpperCase()); }
  private campaignSchedule() {
    if (!this.campaignDraft.scheduledDate) return '';
    const value = new Date(`${this.campaignDraft.scheduledDate}T${this.campaignDraft.scheduledTime || '09:00'}:00`);
    return Number.isNaN(value.getTime()) ? '' : value.toISOString();
  }
  private emptyLead() { return { name: '', phone: '', email: '', source: '', followUp: '' }; }
  private emptyCampaign() { return { name: '', channel: 'whatsapp', audience: 'all', message: '', scheduledDate: '', scheduledTime: '09:00' }; }
  private message(error: any, fallback: string) { return error?.error?.error?.message || error?.error?.message || fallback; }
}
