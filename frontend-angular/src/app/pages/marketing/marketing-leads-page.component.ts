
import { Component, OnInit, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { ActivatedRoute } from '@angular/router';
import { DatePickerComponent } from '../../shared/date-picker/date-picker.component';
import { ApiEnvelope, ApiService } from '../../shared/services/api.service';
import { BranchNamePipe } from '../../shared/pipes/branch-name.pipe';
import { AuthService } from '../../core/services/auth.service';

type Stage = 'New' | 'Contacted' | 'Qualified' | 'Converted' | 'Lost';
type Campaign = { id: string; title: string; body: string; metadata?: any; createdAt: string };
type WhatsAppCampaignPlan = { id: string; campaignType: string; title: string; objective: string; messageText: string; segmentKey: string; criteriaJson: any; status: string; scheduledFor?: string; version: number; createdAt: string; updatedAt: string };
type Lead = { id: string; firstName: string; lastName: string; phone: string; email: string; source: string; stage: string; qualificationStatus: string; score: number; ownerUserId: string; nextFollowUpDate?: string; clientId?: string; convertedAppointmentId?: string; notes: string; captureChannel: string; externalSourceId: string; slaDueAt: string; firstContactedAt?: string };
type LeadOwner = { id: string; name: string; roleName: string };
type LeadActivity = { id: string; leadId: string; activityType: string; body: string; nextFollowUpDate?: string; createdBy: string; createdAt: string };
type MarketingInsights = {
  consent?: { total?: number; whatsapp?: number; sms?: number; email?: number };
  attribution?: { source: string; count: number }[];
  reputation?: { averageRating?: number | null; reviewCount?: number; reviews?: any[] };
};
type WinBackClient = { clientId: string; clientName: string; lastVisitAt?: string; inactiveDays: number; lastService: string; visitFrequencyDays?: number; aiReason: string; recommendedOffer: string; avoidOffer: string; preferredChannel: string; consented: boolean };
type WinBackResults = { sent: number; booked: number; revenuePaise: number; optOuts: number };
type ClientIntelligence = { clientId: string; clientName: string; lastVisitAt?: string; inactiveDays: number; visitFrequencyDays?: number; lastService: string; favouriteServices: string; averageSpendPaise: number; lifetimeValuePaise: number; noShowRateBps: number; cancellationRateBps: number; preferredStaffName: string; preferredChannel: string; consentStatus: string; upcomingAppointmentAt?: string; membershipStatus: string; loyaltyPoints: number; previousOfferCount: number; campaignSentCount: number; campaignResponseCount: number; churnRiskScore: number; nextBestAction: string; nextBestActionReason: string; segmentKeys: string[] };
type MarketingAdvisor = { source: string; scope: 'client' | 'segment'; scopeId: string; probableReason: string; dueService: string; recommendedOffer: string; avoidOffer: string; safeDiscountBps: number; benefitType: string; bestChannel: string; bestSendingTime: string; suggestedMessage: string; expectedOutcome: string; evidence: string[]; requiresApproval: boolean };
type MarketingOffer = { id: string; code: string; title: string; customerDescription: string; staffInstructions: string; benefitType: string; benefitValue: number; targetClientId?: string; complimentaryServiceId?: string; targetServiceIds: string[]; targetPackageIds: string[]; startsAt?: string; endsAt?: string; minimumBillPaise: number; usageLimit?: number; usedCount: number; perClientLimit: number; approvalStatus: string; lifecycleStatus: string; active: boolean; allowMembershipStacking: boolean; allowPackageStacking: boolean; showInStaffApp: boolean; showInCustomerApp: boolean; hasCreative: boolean; creativePath?: string };
type MarketingOfferCreated = { id: string; approvalStatus: string };
type OfferOption = { id: string; name: string; active?: boolean };
type OfferClientOption = { id: string; firstName?: string; lastName?: string; code?: string; active?: boolean };
type OfferSharePack = { offerId: string; title: string; caption: string; instagramBookingUrl: string; whatsappBookingUrl: string; creativeDownloadPath?: string; trackedBookings: number; whatsappPolicy: { consentRequired: boolean; frequencyCapDays: number; consentedClients: number; eligibleClients: number } };
type OfferPerformanceRow = { offerId: string; code: string; title: string; branchId: string; branchName: string; lifecycleStatus: string; endsAt?: string; appViews: number; linkClicks: number; bookings: number; posRedemptions: number; discountPaise: number; revenueAfterDiscountPaise: number };
type OfferBranchResult = Omit<OfferPerformanceRow, 'offerId' | 'code' | 'title' | 'lifecycleStatus' | 'endsAt'>;
type OfferPerformance = { offers: OfferPerformanceRow[]; branchResults: OfferBranchResult[] };
type ConsentCoverage = { audienceCount: number; whatsapp: number; sms: number; email: number };
type MarketingAutomation = { id: string; name: string; trigger: string; status: 'active' | 'paused'; template: string; config: { conditions: string[]; exclusions: string[]; offerId?: string; channels: string[]; sendTime: string; frequencyCapDays: number; approvalMode: 'automatic' | 'manual' }; performance: { sent: number; failed: number; blocked: number } };
type MessageTemplate = { id: string; templateKey: string; name: string; channel: string; audience: string; eventKey: string; body: string; language: string; serviceId: string; occasionKey: string; offerId: string; status: string };
type CampaignAttribution = { id: string; title: string; audienceName: string; audience: number; controlGroupCount: number; attributionWindowDays: number; sent: number; delivered: number; failed: number; opened: number; clicked: number; bookings: number; completedAppointments: number; revenuePaise: number; discountCostPaise: number; netIncrementalRevenuePaise: number; offerRedemptions: number; conversionRateBps: number; reactivationRateBps: number; roiBps: number; optOuts: number; bestService: string; bestChannel: string; bestTime: string };
type BranchAttribution = { branchId: string; audience: number; bookings: number; revenuePaise: number; roiBps: number };
type MarketingAttribution = { campaigns: CampaignAttribution[]; branchPerformance: BranchAttribution[] };
type LeadAdvice = { leadId: string; leadName: string; stage: string; priorityScore: number; reason: string; bestChannel: string; suggestedMessage: string; nextFollowUpDate: string; clientId: string; appointmentId: string; activityCount: number; source: string };
type MarketingGovernance = { settings: { frequencyCapDays: number; quietStart: string; quietEnd: string; timezone: string; offerApprovalThresholdBps: number; controlGroupBps: number; attributionWindowDays: number }; exclusions: { clientId: string; clientName: string }[] };
type MarketingOutboxItem = { id: string; campaignId: string; clientId: string; channel: string; status: string; attempts: number; maxAttempts: number; lastError: string; nextAttemptAt: string; deadLetteredAt?: string; updatedAt?: string };

@Component({
    selector: 'page-marketing-leads',
    imports: [FormsModule, DatePickerComponent, BranchNamePipe],
    templateUrl: './marketing-leads-page.component.html',
    styleUrls: ['./marketing-leads-page.component.css']
})
export class MarketingLeadsPageComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly auth = inject(AuthService);
  private readonly route = inject(ActivatedRoute);
  readonly stages: Stage[] = ['New', 'Contacted', 'Qualified', 'Converted', 'Lost'];
  readonly segmentDefinitions = [
    ['inactive_30', '30+ days inactive'], ['inactive_60', '60+ days inactive'], ['inactive_90', '90+ days inactive'], ['service_due', 'Service due'], ['hair_colour_due', 'Hair colour / root touch-up due'], ['no_upcoming', 'No upcoming appointment'], ['new_without_second_visit', 'New client without second visit'], ['high_value_vip', 'High-value / VIP'], ['lost_client', 'Lost client'], ['frequent_cancellation_no_show', 'Frequent cancellation / no-show'], ['membership_expiring', 'Membership expiring'], ['package_balance_pending', 'Package balance pending'], ['birthday_anniversary', 'Birthday / anniversary'], ['loyalty_milestone', 'Loyalty milestone'], ['negative_review_recovery', 'Negative review recovery'], ['wallet_balance_unused', 'Wallet balance unused'], ['slow_day_eligible', 'Slow-day eligible'],
  ] as const;
  campaigns: Campaign[] = [];
  whatsappPlans: WhatsAppCampaignPlan[] = [];
  leads: Lead[] = [];
  leadAdvice: LeadAdvice[] = [];
  owners: LeadOwner[] = [];
  activities: LeadActivity[] = [];
  selectedLead?: Lead;
  insights: MarketingInsights = {};
  providers: Record<string, boolean> = {};
  winBackClients: WinBackClient[] = [];
  winBackResults: WinBackResults = { sent: 0, booked: 0, revenuePaise: 0, optOuts: 0 };
  selectedClient?: WinBackClient;
  clientIntelligence: ClientIntelligence[] = [];
  selectedIntelligence?: ClientIntelligence;
  advisor?: MarketingAdvisor;
  advisorScope?: { scope: 'client' | 'segment'; scopeId: string };
  advisorReview = '';
  advisorLoading = false;
  offers: MarketingOffer[] = [];
  offerPerformance: OfferPerformance = { offers: [], branchResults: [] };
  coverage: ConsentCoverage = { audienceCount: 0, whatsapp: 0, sms: 0, email: 0 };
  testQueued = false;
  automations: MarketingAutomation[] = [];
  selectedAutomation?: MarketingAutomation;
  templates: MessageTemplate[] = [];
  attribution: MarketingAttribution = { campaigns: [], branchPerformance: [] };
  governance: MarketingGovernance = { settings: { frequencyCapDays: 7, quietStart: '20:00', quietEnd: '09:00', timezone: 'Asia/Kolkata', offerApprovalThresholdBps: 1000, controlGroupBps: 0, attributionWindowDays: 30 }, exclusions: [] };
  marketingOutbox: MarketingOutboxItem[] = [];
  exclusionClientId = '';
  templateChannel = 'all';
  templateLanguage = 'all';
  selectedSegment = 'inactive_30';
  segmentStaff = 'all';
  segmentService = 'all';
  activeSection: 'overview' | 'opportunities' | 'segments' | 'campaigns' | 'automations' | 'offers' | 'templates' | 'outbox' | 'leads' | 'analytics' | 'governance' = 'overview';
  leadSection: 'pipeline' | 'priority' | 'followups' | 'sources' = 'pipeline';
  inactivityDays = 60;
  clientSearch = '';
  channel = 'all';
  status = 'all';
  loading = true;
  busy = false;
  error = '';
  drawer: 'lead' | 'campaign' | 'whatsapp-plan' | 'activity' | 'offer' | 'offer-share' | 'automation' | 'template' | '' = '';
  leadDraft = this.emptyLead();
  campaignDraft = this.emptyCampaign();
  whatsappPlanDraft = this.emptyWhatsAppPlan();
  editingWhatsAppPlanId = '';
  activityDraft = this.emptyActivity();
  offerDraft = this.emptyOffer();
  editingOfferId = '';
  offerServices: OfferOption[] = [];
  offerPackages: OfferOption[] = [];
  offerClients: OfferOption[] = [];
  offerOptionsLoading = false;
  offerOptionsError = '';
  private offerOptionsLoaded = false;
  offerCreative?: File;
  offerCreativePreview = '';
  offerShare?: OfferSharePack;
  offerShareStatus = '';
  automationDraft = this.emptyAutomation();
  templateDraft = this.emptyTemplate();
  conversionClientId = '';
  conversionAppointmentId = '';

  async ngOnInit() { await this.reload(); }

  get filteredCampaigns() {
    return this.campaigns.filter((campaign) =>
      (this.channel === 'all' || campaign.metadata?.channel === this.channel || campaign.metadata?.channels?.includes(this.channel)) &&
      (this.status === 'all' || (campaign.metadata?.status || 'draft') === this.status));
  }
  get canManageCampaigns() { return this.auth.hasAccess(['owner', 'admin', 'manager'], ['marketing.manage', 'management.write']); }
  get canApproveCampaigns() { return this.canManageCampaigns || this.auth.hasPermission('marketing.approve'); }
  get canSendCampaigns() { return this.canManageCampaigns || this.auth.hasPermission('marketing.send'); }
  stageLeads(stage: Stage) { return this.leads.filter((lead) => this.stage(lead) === stage); }
  campaignCount(status: string) { return this.campaigns.filter((campaign) => (campaign.metadata?.status || 'draft') === status).length; }
  get followUpLeads() { return this.leads.filter((lead) => !!lead.nextFollowUpDate).sort((a, b) => (a.nextFollowUpDate || '').localeCompare(b.nextFollowUpDate || '')); }
  get leadSources() {
    const counts = new Map<string, number>();
    for (const lead of this.leads) counts.set(lead.source || 'other', (counts.get(lead.source || 'other') || 0) + 1);
    return [...counts].map(([source, count]) => ({ source, count })).sort((a, b) => b.count - a.count);
  }
  get consentedWinBackCount() { return this.winBackClients.filter((client) => client.consented).length; }
  segmentCount(key: string) { return this.clientIntelligence.filter((client) => client.segmentKeys?.includes(key)).length; }
  get segmentStaffOptions() { return [...new Set(this.clientIntelligence.map((client) => client.preferredStaffName).filter(Boolean))].sort(); }
  get segmentServiceOptions() { return [...new Set(this.clientIntelligence.flatMap((client) => client.favouriteServices.split(',').map((service) => service.trim())).filter(Boolean))].sort(); }
  get selectedSegmentLabel() { return this.segmentDefinitions.find((segment) => segment[0] === this.selectedSegment)?.[1] || 'Segment audience'; }
  get segmentClients() { return this.clientIntelligence.filter((client) => client.segmentKeys?.includes(this.selectedSegment) && (this.segmentStaff === 'all' || client.preferredStaffName === this.segmentStaff) && (this.segmentService === 'all' || client.favouriteServices.split(',').map((service) => service.trim()).includes(this.segmentService))); }
  attributionTotal(field: keyof CampaignAttribution) { return this.attribution.campaigns.reduce((sum, campaign) => sum + (typeof campaign[field] === 'number' ? Number(campaign[field]) : 0), 0); }

  async reload() {
    this.loading = true;
    this.error = '';
    try {
      const [campaigns, leads, owners, insights, providers, winBack, results, intelligence, offers, offerPerformance, automations, templates, attribution, leadAdvice, governance, whatsappPlans, marketingOutbox] = await Promise.all([
        firstValueFrom(this.api.get<ApiEnvelope<any>>('/notifications?notificationType=marketing_campaign&pageSize=200')),
        firstValueFrom(this.api.get<ApiEnvelope<Lead[]>>('/marketing/leads?page=1&pageSize=200')),
        firstValueFrom(this.api.get<ApiEnvelope<LeadOwner[]>>('/marketing/leads/owners')),
        firstValueFrom(this.api.get<ApiEnvelope<MarketingInsights>>('/notifications/marketing-insights')),
        firstValueFrom(this.api.get<ApiEnvelope<Record<string, boolean>>>('/notifications/provider-status')),
        firstValueFrom(this.api.get<ApiEnvelope<WinBackClient[]>>(`/marketing/win-back?inactiveDays=${this.inactivityDays}&q=${encodeURIComponent(this.clientSearch.trim())}`)).catch(() => ({ data: [] as WinBackClient[] })),
        firstValueFrom(this.api.get<ApiEnvelope<WinBackResults>>('/marketing/win-back/results')).catch(() => ({ data: this.winBackResults })),
        firstValueFrom(this.api.get<ApiEnvelope<ClientIntelligence[]>>(`/marketing/client-intelligence?q=${encodeURIComponent(this.clientSearch.trim())}&limit=200`)).catch(() => ({ data: [] as ClientIntelligence[] })),
        firstValueFrom(this.api.get<ApiEnvelope<MarketingOffer[]>>('/marketing/offers')).catch(() => ({ data: [] as MarketingOffer[] })),
        firstValueFrom(this.api.get<ApiEnvelope<OfferPerformance>>('/marketing/offers/performance')).catch(() => ({ data: this.offerPerformance })),
        firstValueFrom(this.api.get<ApiEnvelope<MarketingAutomation[]>>('/marketing/automations')).catch(() => ({ data: [] as MarketingAutomation[] })),
        firstValueFrom(this.api.get<ApiEnvelope<MessageTemplate[]>>('/message-templates')).catch(() => ({ data: [] as MessageTemplate[] })),
        firstValueFrom(this.api.get<ApiEnvelope<MarketingAttribution>>('/marketing/attribution')).catch(() => ({ data: this.attribution })),
        firstValueFrom(this.api.get<ApiEnvelope<LeadAdvice[]>>('/marketing/leads/advice')).catch(() => ({ data: [] as LeadAdvice[] })),
        firstValueFrom(this.api.get<ApiEnvelope<MarketingGovernance>>('/marketing/governance')).catch(() => ({ data: this.governance })),
        firstValueFrom(this.api.get<ApiEnvelope<WhatsAppCampaignPlan[]>>('/whatsapp-campaign-planner/plans')).catch(() => ({ data: [] as WhatsAppCampaignPlan[] })),
        firstValueFrom(this.api.get<ApiEnvelope<MarketingOutboxItem[]>>('/notifications/marketing-outbox')).catch(() => ({ data: [] as MarketingOutboxItem[] })),
      ]);
      this.campaigns = Array.isArray(campaigns.data?.data) ? campaigns.data.data : [];
      this.leads = Array.isArray(leads.data) ? leads.data : [];
      this.owners = Array.isArray(owners.data) ? owners.data : [];
      this.insights = insights.data || {};
      this.providers = providers.data || {};
      this.winBackClients = Array.isArray(winBack.data) ? winBack.data : [];
      this.winBackResults = results.data || this.winBackResults;
      this.clientIntelligence = Array.isArray(intelligence.data) ? intelligence.data : [];
      this.offers = Array.isArray(offers.data) ? offers.data : [];
      this.offerPerformance = offerPerformance.data || this.offerPerformance;
      this.automations = Array.isArray(automations.data) ? automations.data : [];
      this.templates = Array.isArray(templates.data) ? templates.data : [];
      this.attribution = attribution.data || this.attribution;
      this.leadAdvice = Array.isArray(leadAdvice.data) ? leadAdvice.data : [];
      this.governance = governance.data || this.governance;
      this.whatsappPlans = Array.isArray(whatsappPlans.data) ? whatsappPlans.data : [];
      this.marketingOutbox = Array.isArray(marketingOutbox.data) ? marketingOutbox.data : [];
      const routeLead = this.leads.find((lead) => lead.id === this.route.snapshot.queryParamMap.get('leadId'));
      if (routeLead && this.selectedLead?.id !== routeLead.id) {
        this.activeSection = 'leads';
        void this.openActivity(routeLead);
      }
      if (this.selectedIntelligence) this.selectedIntelligence = this.clientIntelligence.find((client) => client.clientId === this.selectedIntelligence?.clientId);
      if (this.selectedClient) this.selectedClient = this.winBackClients.find((client) => client.clientId === this.selectedClient?.clientId);
    } catch (error) { this.error = this.message(error, 'Marketing workspace could not be loaded'); }
    finally { this.loading = false; }
  }

  openLead() { this.leadDraft = this.emptyLead(); this.drawer = 'lead'; }
  openOffer() {
    this.editingOfferId = '';
    this.offerDraft = this.emptyOffer();
    this.offerCreative = undefined;
    this.clearOfferCreativePreview();
    this.drawer = 'offer';
    void this.loadOfferOptions();
  }
  editOffer(offer: MarketingOffer) {
    if (offer.active || this.busy) return;
    this.editingOfferId = offer.id;
    this.offerDraft = {
      title: offer.title, code: offer.code, customerDescription: offer.customerDescription || '', staffInstructions: offer.staffInstructions || '',
      benefitType: offer.benefitType, benefitValue: String(offer.benefitType === 'percentage_discount' ? offer.benefitValue / 100 : offer.benefitValue),
      targetClientId: offer.targetClientId || '', complimentaryServiceId: offer.complimentaryServiceId || '', serviceIds: [...(offer.targetServiceIds || [])], packageIds: [...(offer.targetPackageIds || [])],
      startsAt: offer.startsAt ? this.formatDate(offer.startsAt) : '', endsAt: offer.endsAt ? this.formatDate(offer.endsAt) : '',
      minimumBill: offer.minimumBillPaise ? String(offer.minimumBillPaise / 100) : '', usageLimit: offer.usageLimit ? String(offer.usageLimit) : '', perClientLimit: String(offer.perClientLimit || 1),
      allowMembershipStacking: offer.allowMembershipStacking, allowPackageStacking: offer.allowPackageStacking, showInStaffApp: offer.showInStaffApp, showInCustomerApp: offer.showInCustomerApp,
    };
    this.offerCreative = undefined;
    this.clearOfferCreativePreview();
    this.drawer = 'offer';
    void this.loadOfferOptions();
  }
  get offerBranchName() { return this.auth.branchName || this.auth.branchId || 'No branch selected'; }
  openAutomation(rule: MarketingAutomation) {
    this.selectedAutomation = rule;
    this.automationDraft = { conditions: rule.config.conditions.join(', '), exclusions: rule.config.exclusions.join(', '), offerId: rule.config.offerId || '', whatsapp: rule.config.channels.includes('whatsapp'), sms: rule.config.channels.includes('sms'), email: rule.config.channels.includes('email'), sendTime: rule.config.sendTime, frequencyCapDays: String(rule.config.frequencyCapDays), approvalMode: rule.config.approvalMode };
    this.drawer = 'automation';
  }
  openTemplate() { this.templateDraft = this.emptyTemplate(); this.drawer = 'template'; }
  get filteredTemplates() { return this.templates.filter((template) => (this.templateChannel === 'all' || template.channel === this.templateChannel) && (this.templateLanguage === 'all' || template.language === this.templateLanguage)); }
  openCampaign(client?: WinBackClient) {
    if (client) this.selectedClient = client;
    this.campaignDraft = this.emptyCampaign();
    this.campaignDraft.audience = `win-back-${this.inactivityDays}`;
    if (this.selectedClient) {
      this.campaignDraft.whatsapp = (this.selectedClient.preferredChannel || 'whatsapp') === 'whatsapp';
      this.campaignDraft.sms = this.selectedClient.preferredChannel === 'sms';
      this.campaignDraft.email = this.selectedClient.preferredChannel === 'email';
      this.campaignDraft.name = `${this.selectedClient.lastService || 'Client'} Win Back`;
      this.campaignDraft.message = `Hi ${this.selectedClient.clientName}, we would love to welcome you back for ${this.selectedClient.lastService || 'your next appointment'}. Contact us to reserve your preferred time.`;
    }
    this.drawer = 'campaign';
    void this.loadCoverage();
  }
  openWhatsAppPlan(plan?: WhatsAppCampaignPlan) {
    this.editingWhatsAppPlanId = plan?.id || '';
    this.whatsappPlanDraft = plan ? { campaignType: plan.campaignType, title: plan.title, objective: plan.objective || '', messageText: plan.messageText, segmentKey: plan.segmentKey || '', criteria: plan.criteriaJson || {}, version: plan.version } : this.emptyWhatsAppPlan();
    this.drawer = 'whatsapp-plan';
  }
  async saveWhatsAppPlan() {
    const draft = this.whatsappPlanDraft;
    if (this.busy || !draft.title.trim() || !draft.messageText.trim()) return;
    this.busy = true; this.error = '';
    const payload = { ...draft, title: this.titleCase(draft.title), objective: draft.objective.trim(), messageText: draft.messageText.trim(), segmentKey: draft.segmentKey.trim() };
    try {
      await firstValueFrom(this.editingWhatsAppPlanId ? this.api.patch(`/whatsapp-campaign-planner/plans/${this.editingWhatsAppPlanId}`, payload) : this.api.post('/whatsapp-campaign-planner/plans', payload));
      this.editingWhatsAppPlanId = ''; this.drawer = ''; await this.reload();
    } catch (error) { this.error = this.message(error, 'WhatsApp campaign plan could not be saved'); }
    finally { this.busy = false; }
  }
  async whatsappPlanAction(plan: WhatsAppCampaignPlan, action: 'submit' | 'approve' | 'reject' | 'schedule' | 'stop' | 'archive' | 'restore') {
    if (this.busy) return;
    if (['reject', 'stop', 'archive'].includes(action) && !confirm(`${this.titleCase(action)} ${plan.title}?`)) return;
    this.busy = true; this.error = '';
    try {
      const body = action === 'schedule' ? { version: plan.version, scheduledFor: new Date(Date.now() + 60_000).toISOString() } : { version: plan.version };
      await firstValueFrom(this.api.post(`/whatsapp-campaign-planner/plans/${plan.id}/${action}`, body));
      await this.reload();
    } catch (error) { this.error = this.message(error, `WhatsApp campaign could not be ${action}ed`); }
    finally { this.busy = false; }
  }
  selectClient(client: WinBackClient) { this.selectedClient = client; }
  selectIntelligence(client: ClientIntelligence) { this.selectedIntelligence = client; }
  async applyWinBackFilters(days = this.inactivityDays) { this.inactivityDays = days; await this.reload(); }
  async generateAdvisor(scope: 'client' | 'segment', scopeId: string, keepDrawer = false) {
    if (!scopeId || this.advisorLoading) return;
    this.advisorLoading = true; this.advisorReview = ''; this.error = '';
    try {
      const response = await firstValueFrom(this.api.post<ApiEnvelope<MarketingAdvisor>>('/marketing/advisor/recommend', { scope, scopeId }));
      const advisor = response.data;
      if (!advisor) throw new Error('Recommendation was empty');
      this.advisor = advisor; this.advisorScope = { scope, scopeId };
      if (!keepDrawer) this.activeSection = 'opportunities';
      else { this.campaignDraft.message = advisor.suggestedMessage; this.campaignDraft.name ||= advisor.recommendedOffer; }
    } catch (error) { this.error = this.message(error, 'AI marketing recommendation could not be generated'); }
    finally { this.advisorLoading = false; }
  }
  async reviewAdvisor(decision: 'accepted' | 'rejected') {
    if (!this.advisor || !this.advisorScope || this.busy) return;
    this.busy = true; this.error = '';
    try {
      await firstValueFrom(this.api.post('/marketing/advisor/review', { ...this.advisorScope, decision, recommendation: this.advisor.recommendedOffer }));
      this.advisorReview = decision;
    } catch (error) { this.error = this.message(error, 'AI recommendation review could not be saved'); }
    finally { this.busy = false; }
  }
  async saveOffer(submitForApproval: boolean) {
    if (!this.offerDraft.title.trim() || !this.offerDraft.code.trim() || !this.offerDraft.benefitType || this.busy || this.offerOptionsLoading || this.offerOptionsError) return;
    this.busy = true; this.error = '';
    try {
      const payload = {
        code: this.offerDraft.code.trim().toUpperCase(), benefitType: this.offerDraft.benefitType,
        title: this.titleCase(this.offerDraft.title),
        customerDescription: this.offerDraft.customerDescription.trim(),
        staffInstructions: this.offerDraft.staffInstructions.trim(),
        benefitValue: this.offerDraft.benefitValue === '' ? undefined : this.offerDraft.benefitType === 'percentage_discount' ? Math.round(Number(this.offerDraft.benefitValue) * 100) : Number(this.offerDraft.benefitValue),
        targetClientId: this.offerDraft.targetClientId.trim() || undefined,
        complimentaryServiceId: this.offerDraft.complimentaryServiceId.trim() || undefined,
        targetServiceIds: this.offerDraft.serviceIds,
        targetPackageIds: this.offerDraft.packageIds,
        startsAt: this.offerDate(this.offerDraft.startsAt), endsAt: this.offerDate(this.offerDraft.endsAt, true),
        minimumBillPaise: this.offerDraft.minimumBill === '' ? undefined : Math.round(Number(this.offerDraft.minimumBill) * 100),
        usageLimit: this.offerDraft.usageLimit === '' ? undefined : Number(this.offerDraft.usageLimit),
        perClientLimit: this.offerDraft.perClientLimit === '' ? 1 : Number(this.offerDraft.perClientLimit),
        allowMembershipStacking: this.offerDraft.allowMembershipStacking, allowPackageStacking: this.offerDraft.allowPackageStacking,
        showInStaffApp: this.offerDraft.showInStaffApp,
        showInCustomerApp: this.offerDraft.showInCustomerApp,
        submitForApproval: false,
      };
      const response = await firstValueFrom(this.editingOfferId
        ? this.api.patch<ApiEnvelope<MarketingOfferCreated>>(`/marketing/offers/${this.editingOfferId}`, payload)
        : this.api.post<ApiEnvelope<MarketingOfferCreated>>('/marketing/offers', payload));
      const offerId = response.data?.id;
      if (!offerId) throw new Error('Offer ID was not returned');
      if (this.offerCreative) {
        await firstValueFrom(this.api.putBytes(
          `/marketing/offers/${offerId}/creative?fileName=${encodeURIComponent(this.offerCreative.name)}`,
          this.offerCreative,
        ));
      }
      if (submitForApproval) await firstValueFrom(this.api.post(`/marketing/offers/${offerId}/submit`, {}));
      this.clearOfferCreativePreview();
      this.editingOfferId = ''; this.drawer = ''; await this.reload();
    } catch (error) { this.error = this.message(error, 'Offer could not be saved'); }
    finally { this.busy = false; }
  }
  async submitOffer(offer: MarketingOffer) {
    if (this.busy || offer.approvalStatus !== 'draft') return;
    this.busy = true; this.error = '';
    try { await firstValueFrom(this.api.post(`/marketing/offers/${offer.id}/submit`, {})); await this.reload(); }
    catch (error) { this.error = this.message(error, 'Offer could not be submitted'); }
    finally { this.busy = false; }
  }
  selectOfferCreative(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    this.error = '';
    if (!file) return;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 5 * 1024 * 1024) {
      input.value = '';
      this.error = 'Creative must be a JPG, PNG or WebP file up to 5 MB';
      return;
    }
    this.offerCreative = file;
    this.clearOfferCreativePreview();
    this.offerCreativePreview = URL.createObjectURL(file);
  }
  async loadOfferOptions() {
    if (this.offerOptionsLoaded || this.offerOptionsLoading) return;
    this.offerOptionsLoading = true; this.offerOptionsError = '';
    const [services, packages, clients] = await Promise.all([
      firstValueFrom(this.api.get<ApiEnvelope<OfferOption[]>>('/services')).catch(() => null),
      firstValueFrom(this.api.get<ApiEnvelope<OfferOption[]>>('/packages')).catch(() => null),
      firstValueFrom(this.api.get<ApiEnvelope<OfferClientOption[]>>('/clients?pageSize=200')).catch(() => null),
    ]);
    this.offerServices = (Array.isArray(services?.data) ? services.data : []).filter((item) => item.active !== false).sort((a, b) => a.name.localeCompare(b.name));
    this.offerPackages = (Array.isArray(packages?.data) ? packages.data : []).filter((item) => item.active !== false).sort((a, b) => a.name.localeCompare(b.name));
    this.offerClients = (Array.isArray(clients?.data) ? clients.data : []).filter((item) => item.active !== false).map((item) => ({ id: item.id, name: `${item.firstName || ''} ${item.lastName || ''}`.trim() || item.code || item.id })).sort((a, b) => a.name.localeCompare(b.name));
    this.offerOptionsLoaded = !!services && !!packages && !!clients;
    if (!this.offerOptionsLoaded) this.offerOptionsError = 'Services, packages or clients could not be loaded. Retry before saving.';
    this.offerOptionsLoading = false;
  }
  async approveOffer(offer: MarketingOffer) {
    if (this.busy || offer.approvalStatus !== 'pending') return;
    this.busy = true; this.error = '';
    try { await firstValueFrom(this.api.post(`/marketing/offers/${offer.id}/approve`, {})); await this.reload(); }
    catch (error) { this.error = this.message(error, 'Offer could not be approved'); }
    finally { this.busy = false; }
  }
  async stopOffer(offer: MarketingOffer) {
    if (this.busy || !offer.active || !confirm(`Stop ${offer.title || offer.code}? It will disappear from Staff and Customer apps.`)) return;
    this.busy = true; this.error = '';
    try { await firstValueFrom(this.api.post(`/marketing/offers/${offer.id}/stop`, {})); await this.reload(); }
    catch (error) { this.error = this.message(error, 'Offer could not be stopped'); }
    finally { this.busy = false; }
  }
  async deleteOffer(offer: MarketingOffer) {
    if (this.busy || offer.active || !confirm(`Delete ${offer.title || offer.code}? This cannot be undone.`)) return;
    this.busy = true; this.error = '';
    try { await firstValueFrom(this.api.delete(`/marketing/offers/${offer.id}`)); await this.reload(); }
    catch (error) { this.error = this.message(error, 'Offer could not be deleted'); }
    finally { this.busy = false; }
  }
  async openOfferShare(offer: MarketingOffer) {
    if (this.busy || offer.lifecycleStatus !== 'live') return;
    this.busy = true; this.error = ''; this.offerShareStatus = '';
    try {
      const response = await firstValueFrom(this.api.get<ApiEnvelope<OfferSharePack>>(`/marketing/offers/${offer.id}/share-pack`));
      if (!response.data) throw new Error('Offer share pack was empty');
      this.offerShare = response.data;
      this.drawer = 'offer-share';
    } catch (error) { this.error = this.message(error, 'Offer sharing details could not be loaded'); }
    finally { this.busy = false; }
  }
  async copyOfferCaption() {
    if (!this.offerShare) return;
    await this.copyText(`${this.offerShare.caption}\n${this.offerShare.instagramBookingUrl}`);
    this.offerShareStatus = 'Caption copied';
  }
  shareOfferWhatsApp() {
    if (!this.offerShare) return;
    const message = encodeURIComponent(`${this.offerShare.caption}\n${this.offerShare.whatsappBookingUrl}`);
    window.open(`https://wa.me/?text=${message}`, '_blank', 'noopener,noreferrer');
  }
  async shareOfferInstagram() {
    if (!this.offerShare) return;
    window.open('https://www.instagram.com/', '_blank', 'noopener,noreferrer');
    await this.copyText(`${this.offerShare.caption}\n${this.offerShare.instagramBookingUrl}`);
    this.offerShareStatus = 'Caption copied';
  }
  async downloadOfferCreative() {
    if (!this.offerShare?.creativeDownloadPath) return;
    try {
      const blob = await firstValueFrom(this.api.getBlob(this.offerShare.creativeDownloadPath));
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${this.offerShare.title.replace(/[^a-z0-9._-]+/gi, '-') || 'offer'}.${blob.type === 'image/png' ? 'png' : blob.type === 'image/webp' ? 'webp' : 'jpg'}`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (error) { this.error = this.message(error, 'Offer creative could not be downloaded'); }
  }
  closeDrawer() { if (!this.busy) { if (this.drawer === 'offer') this.editingOfferId = ''; if (this.drawer === 'whatsapp-plan') this.editingWhatsAppPlanId = ''; this.drawer = ''; } }

  async saveLead() {
    const name = this.leadDraft.name.trim().replace(/\s+/g, ' ');
    if (!name || (!this.leadDraft.phone.trim() && !this.leadDraft.email.trim() && !this.leadDraft.externalSourceId.trim())) return;
    const parts = name.split(' ');
    this.busy = true;
    this.error = '';
    try {
      await firstValueFrom(this.api.post('/marketing/leads', {
        firstName: this.titleCase(parts.shift() || ''), lastName: this.titleCase(parts.join(' ')),
        phone: this.leadDraft.phone.trim(), email: this.leadDraft.email.trim().toLowerCase(),
        source: this.leadDraft.source || 'other', ownerUserId: this.leadDraft.ownerUserId,
        captureChannel: this.leadDraft.captureChannel,
        externalSourceId: this.leadDraft.externalSourceId.trim() || undefined,
        slaHours: Number(this.leadDraft.slaHours),
        qualificationStatus: this.leadDraft.qualificationStatus,
        score: this.leadDraft.score === '' ? undefined : Number(this.leadDraft.score),
        nextFollowUpDate: this.toIsoDate(this.leadDraft.followUp),
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
      await firstValueFrom(this.api.patch(`/marketing/leads/${lead.id}`, { stage: stage.toLowerCase() }));
      await this.reload();
    } catch (error) { this.error = this.message(error, 'Lead stage could not be updated'); }
    finally { this.busy = false; }
  }

  async changeOwner(lead: Lead, ownerUserId: string) {
    if (lead.ownerUserId === ownerUserId || this.busy) return;
    this.busy = true;
    this.error = '';
    try { await firstValueFrom(this.api.patch(`/marketing/leads/${lead.id}`, { ownerUserId })); await this.reload(); }
    catch (error) { this.error = this.message(error, 'Lead owner could not be updated'); }
    finally { this.busy = false; }
  }

  async openActivity(lead: Lead) {
    this.selectedLead = lead;
    this.activities = [];
    this.activityDraft = this.emptyActivity();
    this.conversionClientId = '';
    this.conversionAppointmentId = '';
    this.drawer = 'activity';
    try {
      const response = await firstValueFrom(this.api.get<ApiEnvelope<LeadActivity[]>>(`/marketing/leads/${lead.id}/activities`));
      this.activities = Array.isArray(response.data) ? response.data : [];
    } catch (error) { this.error = this.message(error, 'Lead activity could not be loaded'); }
  }

  openLeadAdvice(item: LeadAdvice) {
    const lead = this.leads.find((candidate) => candidate.id === item.leadId);
    if (lead) void this.openActivity(lead);
  }

  async saveActivity() {
    const lead = this.selectedLead;
    if (!lead || !this.activityDraft.body.trim() || this.busy) return;
    this.busy = true;
    this.error = '';
    try {
      await firstValueFrom(this.api.post(`/marketing/leads/${lead.id}/activities`, {
        activityType: this.activityDraft.activityType,
        body: this.activityDraft.body.trim(),
        nextFollowUpDate: this.toIsoDate(this.activityDraft.nextFollowUpDate),
      }));
      await this.openActivity(lead);
      await this.reload();
    } catch (error) { this.error = this.message(error, 'Lead activity could not be saved'); }
    finally { this.busy = false; }
  }

  async convertLead() {
    if (!this.selectedLead || this.busy) return;
    this.busy = true;
    this.error = '';
    try {
      await firstValueFrom(this.api.post(`/marketing/leads/${this.selectedLead.id}/convert`, { clientId: this.conversionClientId.trim() || undefined, appointmentId: this.conversionAppointmentId.trim() || undefined }));
      this.drawer = '';
      await this.reload();
    } catch (error) { this.error = this.message(error, 'Lead conversion could not be completed'); }
    finally { this.busy = false; }
  }

  async saveCampaign() {
    if (!this.campaignDraft.name.trim() || !this.campaignDraft.message.trim()) return;
    const scheduledAt = this.campaignSchedule();
    if (!scheduledAt || !this.campaignChannels().length) { this.error = 'Channel and valid schedule time are required'; return; }
    this.busy = true;
    this.error = '';
    try {
      await firstValueFrom(this.api.post('/notifications', {
        notificationType: 'marketing_campaign', title: this.titleCase(this.campaignDraft.name),
        body: this.campaignDraft.message.trim(), resourceType: 'marketing_campaign',
        metadata: { goal: this.campaignDraft.goal, channels: this.campaignChannels(), audience: this.campaignDraft.audience, offerId: this.campaignDraft.offerId || undefined, status: 'draft', approvalStatus: 'pending', scheduledAt, recurrence: this.campaignDraft.recurrence, deliveryMode: this.campaignDraft.deliveryMode, smsFallback: this.campaignDraft.smsFallback, controlGroupBps: Number(this.campaignDraft.controlGroupPercent) * 100, attributionWindowDays: Number(this.campaignDraft.attributionWindowDays) },
      }));
      this.drawer = '';
      await this.reload();
    } catch (error) { this.error = this.message(error, 'Campaign draft could not be saved'); }
    finally { this.busy = false; }
  }
  async approveCampaign(campaign: Campaign) {
    if (this.busy || campaign.metadata?.approvalStatus !== 'pending') return;
    this.busy = true; this.error = '';
    try { await firstValueFrom(this.api.post(`/notifications/${campaign.id}/campaign-approval`, {})); await this.reload(); }
    catch (error) { this.error = this.message(error, 'Campaign could not be approved'); }
    finally { this.busy = false; }
  }

  async sendCampaign(campaign: Campaign) {
    if (this.busy || campaign.metadata?.approvalStatus !== 'approved' || campaign.metadata?.status !== 'approved') return;
    this.busy = true;
    this.error = '';
    try { await firstValueFrom(this.api.post(`/notifications/${campaign.id}/campaign-send`, {})); await this.reload(); }
    catch (error) { this.error = this.message(error, 'Campaign could not be scheduled for delivery'); }
    finally { this.busy = false; }
  }

  async saveGovernance() {
    if (this.busy) return;
    this.busy = true; this.error = '';
    try { await firstValueFrom(this.api.patch('/marketing/governance', this.governance.settings)); await this.reload(); }
    catch (error) { this.error = this.message(error, 'Marketing governance could not be saved'); }
    finally { this.busy = false; }
  }

  async setMarketingExclusion(clientId: string, excluded: boolean) {
    if (!clientId.trim() || this.busy) return;
    this.busy = true; this.error = '';
    try { await firstValueFrom(this.api.patch(`/marketing/governance/exclusions/${clientId.trim()}`, { excluded })); this.exclusionClientId = ''; await this.reload(); }
    catch (error) { this.error = this.message(error, 'Sensitive-client exclusion could not be updated'); }
    finally { this.busy = false; }
  }
  async saveAutomation(status = this.selectedAutomation?.status || 'paused') {
    if (!this.selectedAutomation || this.busy) return;
    const channels = [this.automationDraft.whatsapp && 'whatsapp', this.automationDraft.sms && 'sms', this.automationDraft.email && 'email'].filter(Boolean);
    if (!channels.length) { this.error = 'At least one channel is required'; return; }
    this.busy = true; this.error = '';
    try {
      await firstValueFrom(this.api.patch(`/marketing/automations/${this.selectedAutomation.id}`, { status, config: { conditions: this.splitList(this.automationDraft.conditions), exclusions: this.splitList(this.automationDraft.exclusions), offerId: this.automationDraft.offerId || undefined, channels, sendTime: this.automationDraft.sendTime.trim(), frequencyCapDays: Number(this.automationDraft.frequencyCapDays), approvalMode: this.automationDraft.approvalMode } }));
      this.drawer = ''; await this.reload();
    } catch (error) { this.error = this.message(error, 'Automation could not be updated'); }
    finally { this.busy = false; }
  }
  async toggleAutomation(rule: MarketingAutomation) { this.selectedAutomation = rule; this.automationDraft = { conditions: rule.config.conditions.join(', '), exclusions: rule.config.exclusions.join(', '), offerId: rule.config.offerId || '', whatsapp: rule.config.channels.includes('whatsapp'), sms: rule.config.channels.includes('sms'), email: rule.config.channels.includes('email'), sendTime: rule.config.sendTime, frequencyCapDays: String(rule.config.frequencyCapDays), approvalMode: rule.config.approvalMode }; await this.saveAutomation(rule.status === 'active' ? 'paused' : 'active'); }
  async loadCoverage() {
    const channels = this.campaignChannels();
    if (!channels.length) { this.coverage = { audienceCount: 0, whatsapp: 0, sms: 0, email: 0 }; return; }
    try { const response = await firstValueFrom(this.api.get<ApiEnvelope<ConsentCoverage>>(`/notifications/marketing-coverage?audience=${encodeURIComponent(this.campaignDraft.audience)}&channels=${channels.join(',')}`)); this.coverage = response.data || { audienceCount: 0, whatsapp: 0, sms: 0, email: 0 }; }
    catch { this.coverage = { audienceCount: 0, whatsapp: 0, sms: 0, email: 0 }; }
  }
  async sendTestCampaign() {
    const channel = this.campaignChannels()[0];
    if (!channel || !this.campaignDraft.testClientId.trim() || !this.campaignDraft.message.trim() || this.busy) return;
    this.busy = true; this.testQueued = false; this.error = '';
    try { await firstValueFrom(this.api.post('/notifications/marketing-test', { clientId: this.campaignDraft.testClientId.trim(), channel, subject: this.campaignDraft.name.trim() || 'Campaign test', message: this.campaignDraft.message.trim() })); this.testQueued = true; }
    catch (error) { this.error = this.message(error, 'Test message could not be queued'); }
    finally { this.busy = false; }
  }
  async generateTemplateAI() {
    if (this.advisorLoading) return;
    this.advisorLoading = true; this.error = '';
    try { const response = await firstValueFrom(this.api.post<ApiEnvelope<MarketingAdvisor>>('/marketing/advisor/recommend', { scope: 'segment', scopeId: this.templateDraft.segment })); const advisor = response.data; if (!advisor) throw new Error('Recommendation was empty'); this.templateDraft.body = advisor.suggestedMessage; }
    catch (error) { this.error = this.message(error, 'AI template could not be generated'); }
    finally { this.advisorLoading = false; }
  }
  async saveTemplate() {
    if (!this.templateDraft.name.trim() || !this.templateDraft.body.trim() || this.busy) return;
    this.busy = true; this.error = '';
    try {
      await firstValueFrom(this.api.post('/message-templates', { templateKey: this.templateDraft.key.trim() || `${this.templateDraft.channel}_${Date.now()}`, name: this.titleCase(this.templateDraft.name), channel: this.templateDraft.channel, audience: this.templateDraft.segment, eventKey: this.templateDraft.occasionKey || 'custom', body: this.templateDraft.body.trim(), language: this.templateDraft.language, branchSpecific: this.templateDraft.branchSpecific, serviceId: this.templateDraft.serviceId.trim() || undefined, occasionKey: this.templateDraft.occasionKey.trim() || undefined, offerId: this.templateDraft.offerId || undefined, targetClientId: this.templateDraft.targetClientId.trim() || undefined }));
      this.drawer = ''; await this.reload();
    } catch (error) { this.error = this.message(error, 'Template could not be saved'); }
    finally { this.busy = false; }
  }

  stage(lead: Lead): Stage {
    return this.stages.find((stage) => stage.toLowerCase() === lead.stage.toLowerCase()) || 'New';
  }
  displayName(lead: Lead) { return `${lead.firstName || ''} ${lead.lastName || ''}`.trim(); }
  formatDate(value: string) { const date = new Date(value); return Number.isNaN(date.getTime()) ? '—' : new Intl.DateTimeFormat('en-GB').format(date); }
  formatRating(value: unknown) { const rating = Number(value); return Number.isFinite(rating) ? rating.toFixed(1) : '—'; }
  formatInterval(value?: number) { return value && Number.isFinite(value) ? `Every ${Math.round(value)} days` : 'Not established'; }
  percent(value: number) { return `${(value / 100).toFixed(1)}%`; }
  result(value: number) { return value > 0 ? value.toLocaleString('en-IN') : '—'; }
  money(value: number) { return value > 0 ? new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(value / 100) : '—'; }
  providerReady(channel: string) { return !!this.providers[`${channel}Delivery`]; }
  private leadNotes(source: string, followUp: string) { return [source && `Source: ${source}`, followUp && `Next follow-up: ${followUp}`].filter(Boolean).join(' | '); }
  private toIsoDate(value: string) { const match = value.match(/^(\d{2})\/(\d{2})\/(\d{4})$/); return match ? `${match[3]}-${match[2]}-${match[1]}` : value || undefined; }
  titleCase(value: string) { return value.replace(/\S+/gu, (word) => word[0].toLocaleUpperCase() + word.slice(1).toLocaleLowerCase()); }
  private campaignSchedule() {
    if (!this.campaignDraft.scheduledDate) return '';
    const value = new Date(`${this.toIsoDate(this.campaignDraft.scheduledDate)}T${this.campaignDraft.scheduledTime || '09:00'}:00`);
    return Number.isNaN(value.getTime()) ? '' : value.toISOString();
  }
  private emptyLead() { return { name: '', phone: '', email: '', source: '', captureChannel: 'other', externalSourceId: '', slaHours: '24', followUp: '', ownerUserId: '', qualificationStatus: 'unqualified', score: '' }; }
  private emptyCampaign() { return { name: '', goal: 'win_back', whatsapp: true, sms: false, email: false, audience: 'inactive_60', offerId: '', message: '', scheduledDate: '', scheduledTime: '09:00', recurrence: 'once', deliveryMode: 'or', smsFallback: true, controlGroupPercent: String(this.governance.settings.controlGroupBps / 100), attributionWindowDays: String(this.governance.settings.attributionWindowDays), testClientId: '' }; }
  private emptyWhatsAppPlan() { return { campaignType: 'empty_slot_fill', title: '', objective: '', messageText: '', segmentKey: '', criteria: { consentRequired: true, optOutAware: true }, version: 1 }; }
  private campaignChannels() { return [this.campaignDraft.whatsapp && 'whatsapp', this.campaignDraft.sms && 'sms', this.campaignDraft.email && 'email'].filter(Boolean) as string[]; }
  private emptyActivity() { return { activityType: 'note', body: '', nextFollowUpDate: '' }; }
  private emptyOffer() { return { title: '', code: '', customerDescription: '', staffInstructions: '', benefitType: 'percentage_discount', benefitValue: '', targetClientId: '', complimentaryServiceId: '', serviceIds: [] as string[], packageIds: [] as string[], startsAt: '', endsAt: '', minimumBill: '', usageLimit: '', perClientLimit: '1', allowMembershipStacking: false, allowPackageStacking: false, showInStaffApp: true, showInCustomerApp: true }; }
  private emptyAutomation() { return { conditions: '', exclusions: '', offerId: '', whatsapp: true, sms: false, email: false, sendTime: '09:00', frequencyCapDays: '7', approvalMode: 'manual' as 'automatic' | 'manual' }; }
  private emptyTemplate() { return { key: '', name: '', channel: 'whatsapp', language: 'english', branchSpecific: true, segment: 'all', serviceId: '', occasionKey: '', offerId: '', targetClientId: '', body: '' }; }
  private splitList(value: string) { return value.split(',').map((item) => item.trim()).filter(Boolean); }
  private offerDate(value: string, end = false) { const iso = this.toIsoDate(value); return iso ? new Date(`${iso}T${end ? '23:59:59' : '00:00:00'}`).toISOString() : undefined; }
  private clearOfferCreativePreview() { if (this.offerCreativePreview) URL.revokeObjectURL(this.offerCreativePreview); this.offerCreativePreview = ''; }
  private async copyText(value: string) {
    if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(value); return; }
    const input = document.createElement('textarea'); input.value = value; input.style.position = 'fixed'; input.style.opacity = '0';
    document.body.appendChild(input); input.select(); document.execCommand('copy'); input.remove();
  }
  private message(error: any, fallback: string) { return error?.error?.error?.message || error?.error?.message || error?.message || fallback; }
}
