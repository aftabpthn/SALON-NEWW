import { CommonModule } from '@angular/common';
import { Component, inject, OnDestroy, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { firstValueFrom, Observable } from 'rxjs';
import { DatePickerComponent } from '../../shared/date-picker/date-picker.component';
import { ApiEnvelope, ApiService } from '../../shared/services/api.service';

type WorkspaceTab = 'Timeline' | 'Profile' | 'Insights' | 'Growth' | 'Clinical' | 'Consent' | 'Forms' | 'Communications' | 'Reports' | 'Masters';
type TimelineType = 'Appointments' | 'Invoices' | 'Services' | 'Payments' | 'Wallet' | 'Loyalty' | 'Memberships' | 'Packages' | 'WhatsApp' | 'Notes' | 'Custom forms' | 'Consent' | 'Reviews' | 'Audit activity';
type DrawerMode = 'client' | 'note' | 'clinical' | 'family' | 'soap' | 'contact-preferences' | 'form-definition' | 'form-submission' | 'photo' | 'review' | 'merge' | 'retention' | 'gift-register' | 'master' | 'discount-rule' | 'discount' | 'win-back' | null;
type RetentionAction = 'wallet-credit' | 'wallet-debit' | 'loyalty-adjust' | 'gift-detail' | 'gift-void' | 'gift-reissue' | 'referral-link' | null;
type FormField = {
  key: string;
  label: string;
  type: 'text' | 'textarea' | 'boolean' | 'date' | 'select';
  required?: boolean;
  options?: string[];
  visibleWhen?: { fieldKey: string; equals: string | boolean | number };
};

type ClientRow = {
  id: string;
  code: string;
  firstName: string;
  lastName: string;
  name: string;
  phone: string;
  normalizedPhone: string;
  email: string;
  lastVisit: string;
  birthday: string;
  anniversary: string;
  membership: string;
  categories: string[];
  center: string;
  notes: string;
  active: boolean;
  duplicateCount: number;
  preferredStaffId: string;
  preferredStaffName: string;
  preferredCommunicationChannel: string;
  whatsappOptIn: boolean | null;
  smsOptIn: boolean | null;
  emailOptIn: boolean | null;
  createdAt: string;
  updatedAt: string;
};

type ClientCredit = { id: string; membershipName?: string; packageName?: string; serviceName: string; pendingQty: number; totalQty: number; expiresAt?: string; unitValuePaise?: number };
type ClientMembership = { id: string; membershipName: string; assignedAt: string; expiresAt?: string; remainingCredits: number; status: string };
type TimelineStep = { label: string; occurredAt: string; icon: string };
type TimelineEvent = { id: string; type: TimelineType; title: string; detail: string; occurredAt: string; icon: string; amountPaise?: number; status?: string; groupId?: string; tipPaise?: number; balancePaise?: number; grouped?: boolean; steps?: TimelineStep[]; children?: TimelineEvent[] };
type RetentionSnapshot = { giftCards: any[]; loyalty: { pointsBalance: number; currentTier: any; nextTier: any; pointsToNextTier: number | null; enabled: boolean }; rewardLedger: any[]; referralCode: any; referrals: any[]; referredBy: any };
type GiftCardRow = { id: string; code: string; clientId: string; clientName: string; initialAmountPaise: number; balancePaise: number; status: string; expiresAt?: string; sourceSaleId: string; createdAt: string };

@Component({
  selector: 'page-clients',
  standalone: true,
  imports: [CommonModule, FormsModule, DatePickerComponent],
  templateUrl: './clients-page.component.html',
  styleUrls: ['./clients-page.component.css'],
})
export class ClientsPageComponent implements OnInit, OnDestroy {
  private readonly api = inject(ApiService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private searchTimer?: ReturnType<typeof setTimeout>;
  private workspaceLoadVersion = 0;
  private timelineLoadVersion = 0;
  private liveSocket: WebSocket | null = null;
  private liveReconnectTimer?: ReturnType<typeof setTimeout>;

  readonly tabs: WorkspaceTab[] = ['Timeline', 'Profile', 'Insights', 'Growth', 'Clinical', 'Consent', 'Forms', 'Communications', 'Reports', 'Masters'];
  readonly clientMasterTypes = [
    { key: 'categories', label: 'Categories' },
    { key: 'sources', label: 'Sources' },
    { key: 'preferences', label: 'Preferences' },
    { key: 'consultation-templates', label: 'Consultation templates' },
    { key: 'feedback-definitions', label: 'Feedback definitions' },
    { key: 'custom-segments', label: 'Custom segments' },
  ];
  readonly eventFilters: Array<{ key: TimelineType; icon: string }> = [
    { key: 'Appointments', icon: 'bi-calendar2-week' },
    { key: 'Invoices', icon: 'bi-receipt' },
    { key: 'Services', icon: 'bi-scissors' },
    { key: 'Payments', icon: 'bi-credit-card' },
    { key: 'Wallet', icon: 'bi-wallet2' },
    { key: 'Loyalty', icon: 'bi-star' },
    { key: 'Memberships', icon: 'bi-gem' },
    { key: 'Packages', icon: 'bi-box-seam' },
    { key: 'WhatsApp', icon: 'bi-whatsapp' },
    { key: 'Notes', icon: 'bi-journal-text' },
    { key: 'Custom forms', icon: 'bi-card-checklist' },
    { key: 'Consent', icon: 'bi-shield-check' },
    { key: 'Reviews', icon: 'bi-patch-check' },
    { key: 'Audit activity', icon: 'bi-clock-history' },
  ];
  readonly clientReportTypes = [
    { key: 'best-clients', label: 'Best clients' },
    { key: 'rfm', label: 'Top RFM clients' },
    { key: 'lapsed', label: 'Lapsed clients' },
    { key: 'new-returning', label: 'New vs returning' },
    { key: 'occasions', label: 'Occasions' },
    { key: 'service-wise', label: 'Service-wise clients' },
    { key: 'revenue', label: 'Client revenue' },
  ];

  clientRows: ClientRow[] = [];
  selectedClient: ClientRow | null = null;
  activeTab: WorkspaceTab = 'Timeline';
  drawerMode: DrawerMode = null;
  editingClientId = '';
  searchTerm = '';
  searchOpen = false;
  dateFrom = '';
  dateTo = '';
  selectedEventTypes = new Set<TimelineType>();
  collapsedPanels = new Set<string>();
  loadingClients = false;
  loadingWorkspace = false;
  loadingMoreTimeline = false;
  savingClient = false;
  savingNote = false;
  savingWorkspace = false;
  clientError = '';
  clientListError = '';
  workspaceError = '';

  appointments: any[] = [];
  salesRows: any[] = [];
  serviceHistory: any[] = [];
  clientNotes: any[] = [];
  familyMembers: any[] = [];
  clinicalProfile: any = null;
  soapNotes: any[] = [];
  formDefinitions: any[] = [];
  formSubmissions: any[] = [];
  treatmentPhotos: any[] = [];
  duplicates: any[] = [];
  consentHistory: any[] = [];
  communications: any[] = [];
  reviews: any[] = [];
  auditEvents: any[] = [];
  staffRows: any[] = [];
  reportRows: any[] = [];
  selectedReportType = 'rfm';
  reportDays = 90;
  reportLimit = 100;
  reportMinLifetimeValue = '';
  reportMinVisits = '';
  reportSegment = '';
  reportMaxChurnRisk = '';
  reportIncludeUnpaid = true;
  loadingReport = false;
  reportError = '';
  growth: any = this.emptyGrowth();
  memoryGraph: any = this.emptyMemoryGraph();
  automations: any[] = [];
  savingRecommendationFeedback = false;
  loadingGrowth = false;
  growthError = '';
  selectedMasterType = 'categories';
  clientMasters: any[] = [];
  clientMasterAudit: any[] = [];
  clientMasterSummary: any[] = [];
  discountRules: any[] = [];
  loadingMasters = false;
  mastersError = '';
  editingMasterId = '';
  editingDiscountRuleId = '';
  masterDraft = this.blankMasterDraft();
  discountRuleDraft = this.blankDiscountRuleDraft();
  discountDraft = { serviceCategory: '', subtotal: '', discountPercent: '' };
  winBackDraft = { decisionId: '', offerCode: '', title: '', discountPercent: '', discountCost: '', returnWindowDays: '' };
  clientSummary: any = {};
  walletTransactions: any[] = [];
  storeCredits: any[] = [];
  retention: RetentionSnapshot = this.emptyRetention();
  giftCardDetail: any = null;
  giftCardRegister: GiftCardRow[] = [];
  giftCardRegisterSearch = '';
  giftCardRegisterStatus = 'all';
  giftCardRegisterLoading = false;
  giftCardRegisterError = '';
  timelineEvents: TimelineEvent[] = [];
  timelineNextCursor = '';
  packages: ClientCredit[] = [];
  memberships: ClientMembership[] = [];
  membershipCredits: ClientCredit[] = [];
  walletBalancePaise = 0;
  unpaidPaise = 0;
  rewardPoints = 0;
  noteDraft = '';
  noteType = 'general';
  clinicalDraft = { allergies: '', preferences: '', expectedVersion: 0 };
  familyDraft = { relatedClientId: '', relationshipType: 'spouse' };
  soapDraft = this.blankSoapDraft();
  definitionDraft = this.blankDefinitionDraft();
  submissionDraft: { definitionId: string; responses: Record<string, any>; signatureName: string; consentAccepted: boolean } = this.blankSubmissionDraft();
  photoCaption = '';
  photoType = 'other';
  selectedPhoto: File | null = null;
  contactDraft = this.blankContactDraft();
  retentionAction: RetentionAction = null;
  retentionDraft = this.blankRetentionDraft();
  reviewDraft = { platform: 'google', externalReviewId: '', rating: '', reviewText: '', reviewedAt: '' };
  mergeTargetId = '';
  kioskAccess: any = null;
  kioskMode = false;
  kioskDraft: { responses: Record<string, any>; signatureName: string; consentAccepted: boolean } = { responses: {}, signatureName: '', consentAccepted: false };
  createGuest = this.blankGuestForm();

  ngOnInit() {
    void this.initializeClients();
  }

  ngOnDestroy() {
    this.disconnectLiveClient();
    if (this.searchTimer) clearTimeout(this.searchTimer);
  }

  get searchResults() {
    return this.clientRows.slice(0, 8);
  }

  get visibleTimeline() {
    const events = this.timelineEvents.filter((event) => {
      if (this.selectedEventTypes.size && !this.selectedEventTypes.has(event.type)) return false;
      const day = this.isoDay(event.occurredAt);
      return (!this.dateFrom || day >= this.dateFrom) && (!this.dateTo || day <= this.dateTo);
    });
    return this.groupTimeline(events);
  }

  get clientHealth() {
    if (!this.selectedClient) return '—';
    if (!this.selectedClient.active) return 'Inactive profile';
    return this.unpaidPaise > 0 ? `${this.money(this.unpaidPaise)} due` : `${Number(this.clientSummary.totalVisits) || 0} visits`;
  }

  get walletLoyalty() {
    return this.selectedClient ? `${this.money(this.walletBalancePaise)} · ${this.rewardPoints} points` : '—';
  }

  get activeGiftCardBalancePaise() {
    return this.retention.giftCards.filter((card) => card.status === 'active').reduce((total, card) => total + (Number(card.balancePaise) || 0), 0);
  }

  get filteredGiftCardRegister() {
    const query = this.giftCardRegisterSearch.trim().toLowerCase();
    return this.giftCardRegister.filter((card) => {
      if (this.giftCardRegisterStatus !== 'all' && card.status !== this.giftCardRegisterStatus) return false;
      return !query || [card.code, card.clientName, card.clientId, card.status].some((value) => value.toLowerCase().includes(query));
    });
  }

  get completedReferralCount() {
    return this.retention.referrals.filter((row) => row.status === 'completed').length;
  }

  get referralClientOptions() {
    return this.clientRows.filter((client) => client.id !== this.selectedClient?.id && client.active);
  }

  get retentionDrawerTitle() {
    return ({ 'wallet-credit': 'Add wallet credit', 'wallet-debit': 'Debit wallet', 'loyalty-adjust': 'Adjust loyalty points', 'gift-detail': 'Gift card details', 'gift-void': 'Void gift card', 'gift-reissue': 'Reissue gift card', 'referral-link': 'Link referral' } as Record<string, string>)[this.retentionAction || ''] || 'Retention action';
  }

  get benefitsSummary() {
    if (!this.selectedClient) return '—';
    const benefits = this.memberships.length + this.packages.length;
    return benefits ? `${this.memberships.length} memberships · ${this.packages.length} packages` : 'No active benefits';
  }

  get nextBestAction() {
    if (!this.selectedClient) return '—';
    if (this.clientSummary.nextBestAction) return String(this.clientSummary.nextBestAction);
    if (this.unpaidPaise > 0) return 'Review outstanding balance';
    const hasUpcoming = this.appointments.some((row) => new Date(row.startAt || row.start_at || 0).getTime() > Date.now() && !['cancelled', 'no-show'].includes(String(row.status || '').toLowerCase()));
    return hasUpcoming ? 'Review upcoming appointment' : 'Book next appointment';
  }

  get consentSummary() {
    if (!this.selectedClient) return '—';
    const latest = this.formSubmissions.find((row) => row.formType === 'consent');
    return latest ? `Signed ${this.formatDate(latest.submittedAt)}` : 'Not recorded';
  }

  get selectedFormDefinition() {
    return this.formDefinitions.find((row) => row.id === this.submissionDraft.definitionId) || null;
  }

  get selectedKioskForm() {
    return this.formDefinitions.find((row) => row.id === this.kioskAccess?.definitionId) || null;
  }

  get familyCandidates() {
    const linked = new Set(this.familyMembers.map((member) => String(member.memberId)));
    return this.clientRows.filter((client) => client.id !== this.selectedClient?.id && !linked.has(client.id));
  }

  get complaintNotes() {
    return this.clientNotes.filter((note) => ['complaint', 'service-recovery'].includes(String(note.noteType)));
  }

  get reportColumns() {
    if (this.selectedReportType === 'best-clients') {
      return [
        'clientName',
        'phone',
        'segment',
        'rfmScore',
        'lifetimeValuePaise',
        'averageSpendPaise',
        'highestBillPaise',
        'totalVisits',
        'lastVisitAt',
        'favouriteService',
        'churnRiskScore',
        'unpaidPaise',
        'invoiceCount',
      ];
    }
    return this.reportRows.length ? Object.keys(this.reportRows[0]) : [];
  }

  get selectedReportLabel() {
    return this.clientReportTypes.find((report) => report.key === this.selectedReportType)?.label || this.selectedReportType;
  }

  get isBestClientsReport() {
    return this.selectedReportType === 'best-clients';
  }

  get selectedMasterLabel() {
    return this.clientMasterTypes.find((type) => type.key === this.selectedMasterType)?.label || this.selectedMasterType;
  }

  get selectedMasterSummary() {
    return this.clientMasterSummary.find((item) => item.key === this.selectedMasterType) || null;
  }

  get usesCustomSegmentRules() {
    return this.selectedMasterType === 'custom-segments';
  }

  formFields(definition: any): FormField[] {
    return Array.isArray(definition?.fieldsJson) ? definition.fieldsJson : [];
  }

  onSearchTerm(value: string) {
    this.searchTerm = value;
    this.searchOpen = true;
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(() => void this.loadClients(value), 250);
  }

  refreshClients() {
    void this.loadClients(this.searchTerm);
  }

  openGiftCardRegister() {
    this.giftCardRegisterSearch = '';
    this.giftCardRegisterStatus = 'all';
    this.drawerMode = 'gift-register';
    void this.loadGiftCardRegister();
  }

  async openGiftCardClient(card: GiftCardRow) {
    this.giftCardRegisterError = '';
    let client = this.clientRows.find((item) => item.id === card.clientId);
    if (!client) {
      try {
        const result = await firstValueFrom(this.api.get<ApiEnvelope<any>>(`/clients/${encodeURIComponent(card.clientId)}`));
        if (!result.success || !result.data) throw new Error(result.error?.message || 'Client could not be loaded');
        client = this.toClientRow(result.data.client || result.data);
      } catch (error) {
        this.giftCardRegisterError = this.errorMessage(error, 'Client could not be loaded');
        return;
      }
    }
    this.drawerMode = null;
    this.selectClient(client);
    this.selectTab('Insights');
  }

  async blockSelectedClient() {
    if (!this.selectedClient) return;
    const active = this.selectedClient.active;
    const action = active ? 'block' : 'unblock';
    if (!window.confirm(`${active ? 'Block' : 'Unblock'} this client?`)) return;
    await this.saveClientStatus(
      this.api.post<ApiEnvelope<any>>(`/clients/${this.selectedClient.id}/${action}`, {}),
      active ? 'Client could not be blocked' : 'Client could not be unblocked',
    );
  }

  async deleteSelectedClient() {
    if (!this.selectedClient || !window.confirm('Delete this client?')) return;
    await this.saveClientStatus(
      this.api.delete<ApiEnvelope<any>>(`/clients/${this.selectedClient.id}`),
      'Client could not be deleted',
      true,
    );
  }

  selectClient(client: ClientRow, updateRoute = true) {
    const currentClientId = this.route.snapshot.paramMap.get('clientId');
    this.selectedClient = client;
    this.searchTerm = client.name;
    this.searchOpen = false;
    this.activeTab = 'Timeline';
    this.workspaceLoadVersion += 1;
    this.timelineLoadVersion += 1;
    this.resetWorkspaceData();
    if (updateRoute && currentClientId !== client.id) {
      void this.router.navigate(['/clients', client.id], { state: { client } });
      if (!currentClientId) return;
    }
    this.connectLiveClient(client.id);
    void this.loadInitialClientView(client.id);
  }

  selectTab(tab: WorkspaceTab) {
    this.activeTab = tab;
    if (tab === 'Reports') void this.loadClientReport();
    if (tab === 'Growth') void this.loadGrowth();
    if (tab === 'Masters') void this.loadClientMasters();
  }

  changeClientReportType() {
    if (this.isBestClientsReport && this.reportDays === 90) this.reportDays = 0;
    if (!this.isBestClientsReport && this.reportDays === 0) this.reportDays = 90;
    void this.loadClientReport();
  }

  clearSelection() {
    this.workspaceLoadVersion += 1;
    this.timelineLoadVersion += 1;
    this.selectedClient = null;
    this.searchTerm = '';
    this.searchOpen = false;
    this.disconnectLiveClient();
    this.resetWorkspaceData();
    if (this.route.snapshot.paramMap.has('clientId')) void this.router.navigate(['/clients']);
  }

  private resetWorkspaceData() {
    this.timelineEvents = [];
    this.timelineNextCursor = '';
    this.loadingMoreTimeline = false;
    this.appointments = [];
    this.salesRows = [];
    this.serviceHistory = [];
    this.clientNotes = [];
    this.familyMembers = [];
    this.clinicalProfile = null;
    this.soapNotes = [];
    this.formDefinitions = [];
    this.formSubmissions = [];
    this.treatmentPhotos = [];
    this.duplicates = [];
    this.consentHistory = [];
    this.communications = [];
    this.reviews = [];
    this.auditEvents = [];
    this.clientSummary = {};
    this.walletTransactions = [];
    this.storeCredits = [];
    this.retention = this.emptyRetention();
    this.growth = this.emptyGrowth();
    this.memoryGraph = this.emptyMemoryGraph();
    this.automations = [];
    this.growthError = '';
    this.giftCardDetail = null;
    this.kioskAccess = null;
    this.kioskMode = false;
    this.packages = [];
    this.memberships = [];
    this.membershipCredits = [];
    this.walletBalancePaise = 0;
    this.unpaidPaise = 0;
    this.rewardPoints = 0;
  }

  toggleEventType(type: TimelineType) {
    this.selectedEventTypes.has(type) ? this.selectedEventTypes.delete(type) : this.selectedEventTypes.add(type);
    this.selectedEventTypes = new Set(this.selectedEventTypes);
  }

  clearFilters() {
    this.dateFrom = '';
    this.dateTo = '';
    this.selectedEventTypes = new Set<TimelineType>();
  }

  togglePanel(panel: string) {
    this.collapsedPanels.has(panel) ? this.collapsedPanels.delete(panel) : this.collapsedPanels.add(panel);
    this.collapsedPanels = new Set(this.collapsedPanels);
  }

  showCreate() {
    this.editingClientId = '';
    this.createGuest = this.blankGuestForm();
    this.clientError = '';
    this.drawerMode = 'client';
  }

  showEdit() {
    if (!this.selectedClient) return;
    const client = this.selectedClient;
    this.editingClientId = client.id;
    this.createGuest = {
      code: client.code,
      firstName: client.firstName,
      lastName: client.lastName,
      phone: client.phone,
      email: client.email,
      birthday: client.birthday,
      anniversary: client.anniversary,
      categories: client.categories.join(', '),
    };
    this.clientError = '';
    this.drawerMode = 'client';
  }

  showNote() {
    if (!this.selectedClient) return;
    this.noteDraft = '';
    this.noteType = 'general';
    this.clientError = '';
    this.drawerMode = 'note';
  }

  showClinicalProfile() {
    if (!this.selectedClient) return;
    this.clinicalDraft = {
      allergies: String(this.clinicalProfile?.allergies || ''),
      preferences: String(this.clinicalProfile?.preferences || ''),
      expectedVersion: Number(this.clinicalProfile?.version) || 0,
    };
    this.clientError = '';
    this.drawerMode = 'clinical';
  }

  showFamilyLink() {
    if (!this.selectedClient) return;
    this.familyDraft = { relatedClientId: '', relationshipType: 'spouse' };
    this.clientError = '';
    this.drawerMode = 'family';
  }

  showSoapNote(note?: any) {
    if (!this.selectedClient) return;
    this.soapDraft = note ? {
      id: String(note.id || ''), appointmentId: String(note.appointmentId || ''),
      subjective: String(note.subjective || ''), objective: String(note.objective || ''),
      assessment: String(note.assessment || ''), plan: String(note.plan || ''),
      status: String(note.status || 'draft'), expectedVersion: Number(note.version) || 1,
    } : this.blankSoapDraft();
    this.clientError = '';
    this.drawerMode = 'soap';
  }

  showContactPreferences() {
    if (!this.selectedClient) return;
    this.contactDraft = {
      preferredStaffId: this.selectedClient.preferredStaffId,
      preferredCommunicationChannel: this.selectedClient.preferredCommunicationChannel || 'none',
      whatsappOptIn: this.consentValue(this.selectedClient.whatsappOptIn),
      smsOptIn: this.consentValue(this.selectedClient.smsOptIn),
      emailOptIn: this.consentValue(this.selectedClient.emailOptIn),
      reason: '',
    };
    this.clientError = '';
    this.drawerMode = 'contact-preferences';
  }

  openRetention(action: Exclude<RetentionAction, null>, record?: any) {
    if (!this.selectedClient) return;
    this.retentionAction = action;
    this.retentionDraft = { ...this.blankRetentionDraft(), giftCardId: String(record?.id || ''), idempotencyKey: this.retentionKey(action) };
    this.clientError = '';
    this.drawerMode = 'retention';
  }

  async openGiftCardDetail(card: any) {
    this.openRetention('gift-detail', card);
    this.giftCardDetail = null;
    this.savingWorkspace = true;
    try {
      const result = await firstValueFrom(this.api.get<ApiEnvelope<any>>(`/retention/gift-cards/${encodeURIComponent(card.id)}`));
      if (!result.success || !result.data) throw new Error(result.error?.message || 'Gift card details could not be loaded');
      this.giftCardDetail = result.data;
    } catch (error) {
      this.clientError = this.errorMessage(error, 'Gift card details could not be loaded');
    } finally {
      this.savingWorkspace = false;
    }
  }

  generateReferralCode() {
    if (!this.selectedClient) return;
    void this.saveWorkspace(this.api.post<ApiEnvelope<any>>(`/retention/clients/${this.selectedClient.id}/referral-code`, {}), 'Referral code could not be created');
  }

  completeReferral(referral: any) {
    if (!this.selectedClient || referral?.status !== 'pending') return;
    void this.saveWorkspace(this.api.post<ApiEnvelope<any>>(`/retention/referrals/${encodeURIComponent(referral.id)}/complete`, {}), 'Referral could not be completed');
  }

  async saveRetentionAction() {
    if (!this.selectedClient || !this.retentionAction) return;
    const clientId = this.selectedClient.id;
    const draft = this.retentionDraft;
    let request: Observable<ApiEnvelope<any>>;
    let fallback = 'Retention action failed';
    if (this.retentionAction === 'wallet-credit' || this.retentionAction === 'wallet-debit') {
      const amountPaise = Math.round((Number(draft.amount) || 0) * 100);
      if (amountPaise <= 0) { this.clientError = 'Amount must be greater than zero'; return; }
      const payload = { transactionType: this.retentionAction === 'wallet-credit' ? 'adjustment_credit' : 'adjustment_debit', amountPaise, idempotencyKey: draft.idempotencyKey, notes: draft.note };
      request = this.api.post<ApiEnvelope<any>>(`/clients/${clientId}/wallet-transactions`, payload);
      fallback = 'Wallet adjustment failed';
    } else if (this.retentionAction === 'loyalty-adjust') {
      const points = Number(draft.points);
      if (!Number.isInteger(points) || points === 0) { this.clientError = 'Points must be a non-zero whole number'; return; }
      if (!draft.note.trim()) { this.clientError = 'Note is required'; return; }
      request = this.api.post<ApiEnvelope<any>>('/membership-enterprise/rewards/ledger', { clientId, points, note: draft.note, idempotencyKey: draft.idempotencyKey });
      fallback = 'Loyalty adjustment failed';
    } else if (this.retentionAction === 'gift-void') {
      if (!draft.note.trim()) { this.clientError = 'Reason is required'; return; }
      request = this.api.post<ApiEnvelope<any>>(`/retention/gift-cards/${encodeURIComponent(draft.giftCardId)}/void`, { reason: draft.note, idempotencyKey: draft.idempotencyKey });
      fallback = 'Gift card could not be voided';
    } else if (this.retentionAction === 'gift-reissue') {
      if (!draft.note.trim()) { this.clientError = 'Reason is required'; return; }
      request = this.api.post<ApiEnvelope<any>>(`/retention/gift-cards/${encodeURIComponent(draft.giftCardId)}/reissue`, { code: draft.code.trim() || undefined, expiresAt: draft.expiresAt || undefined, reason: draft.note, idempotencyKey: draft.idempotencyKey });
      fallback = 'Gift card could not be reissued';
    } else {
      if (!draft.referredClientId) { this.clientError = 'Referred client is required'; return; }
      request = this.api.post<ApiEnvelope<any>>(`/retention/clients/${clientId}/referrals`, { referredClientId: draft.referredClientId, idempotencyKey: draft.idempotencyKey });
      fallback = 'Referral could not be linked';
    }
    await this.saveWorkspace(request, fallback);
  }

  showClientMaster(record?: any) {
    const definition = record?.definitionJson && typeof record.definitionJson === 'object' ? record.definitionJson : {};
    this.editingMasterId = String(record?.id || '');
    this.masterDraft = record ? {
      code: String(record.code || ''), name: String(record.name || ''), description: String(record.description || ''),
      status: String(record.status || 'active'), version: Number(record.version) || 1,
      sortOrder: definition.sortOrder === undefined ? '' : String(definition.sortOrder),
      color: String(definition.color || ''),
      minLifetimeValue: definition.minLifetimeValuePaise === undefined ? '' : String(Number(definition.minLifetimeValuePaise) / 100),
      minRfmScore: definition.minRfmScore === undefined ? '' : String(definition.minRfmScore),
      maxInactiveDays: definition.maxInactiveDays === undefined ? '' : String(definition.maxInactiveDays),
      minChurnRiskScore: definition.minChurnRiskScore === undefined ? '' : String(definition.minChurnRiskScore),
      definitionText: JSON.stringify(definition, null, 2),
    } : this.blankMasterDraft();
    this.clientError = '';
    this.drawerMode = 'master';
  }

  showDiscountRule(record?: any) {
    this.editingDiscountRuleId = String(record?.id || '');
    this.discountRuleDraft = record ? {
      name: String(record.name || ''), segments: Array.isArray(record.segments) ? record.segments.join(', ') : '',
      serviceCategories: Array.isArray(record.serviceCategories) ? record.serviceCategories.join(', ') : '',
      minLifetimeValue: record.minLifetimeValuePaise ? String(Number(record.minLifetimeValuePaise) / 100) : '',
      maxDiscountPercent: record.maxDiscountBps ? String(Number(record.maxDiscountBps) / 100) : '',
      clvBudgetPercent: record.clvBudgetBps ? String(Number(record.clvBudgetBps) / 100) : '',
      approvalAbovePercent: record.approvalAboveBps ? String(Number(record.approvalAboveBps) / 100) : '',
      priority: String(record.priority ?? ''), membershipEligible: record.membershipEligible !== false,
      walletEligible: record.walletEligible !== false, active: record.active !== false, version: Number(record.version) || 1,
    } : this.blankDiscountRuleDraft();
    this.clientError = '';
    this.drawerMode = 'discount-rule';
  }

  showDiscountDecision() {
    if (!this.selectedClient) return;
    this.discountDraft = { serviceCategory: '', subtotal: '', discountPercent: '' };
    this.clientError = '';
    this.drawerMode = 'discount';
  }

  showWinBackOffer(decision?: any) {
    if (!this.selectedClient) return;
    this.winBackDraft = {
      decisionId: String(decision?.id || ''), offerCode: '', title: '',
      discountPercent: decision?.approvedDiscountBps ? String(Number(decision.approvedDiscountBps) / 100) : '',
      discountCost: decision?.discountPaise ? String(Number(decision.discountPaise) / 100) : '', returnWindowDays: '',
    };
    this.clientError = '';
    this.drawerMode = 'win-back';
  }

  async saveClientMaster() {
    const name = this.masterDraft.name.trim();
    const code = this.masterDraft.code.trim().toLowerCase();
    if (!name || !code) { this.clientError = 'Code and name are required'; return; }
    let definition: any;
    try { definition = this.masterDefinitionFromDraft(); } catch (error) { this.clientError = this.errorMessage(error, 'Configuration must be valid'); return; }
    const payload = { code, name, description: this.masterDraft.description.trim(), definition, status: this.masterDraft.status, version: this.editingMasterId ? this.masterDraft.version : undefined };
    this.savingWorkspace = true;
    this.clientError = '';
    try {
      const request = this.editingMasterId
        ? this.api.patch<ApiEnvelope<any>>(`/clients/masters/${this.selectedMasterType}/${this.editingMasterId}`, payload)
        : this.api.post<ApiEnvelope<any>>(`/clients/masters/${this.selectedMasterType}`, payload);
      const result = await firstValueFrom(request);
      if (!result.success) throw new Error(result.error?.message || 'Client master could not be saved');
      this.drawerMode = null;
      await this.loadClientMasters();
    } catch (error) { this.clientError = this.errorMessage(error, 'Client master could not be saved'); }
    finally { this.savingWorkspace = false; }
  }

  async saveDiscountRule() {
    const draft = this.discountRuleDraft;
    const maxDiscountBps = Math.round((Number(draft.maxDiscountPercent) || 0) * 100);
    if (!draft.name.trim() || maxDiscountBps <= 0) { this.clientError = 'Name and maximum discount are required'; return; }
    const payload = {
      name: draft.name.trim(), segments: this.csvValues(draft.segments), serviceCategories: this.csvValues(draft.serviceCategories),
      minLifetimeValuePaise: Math.round((Number(draft.minLifetimeValue) || 0) * 100), maxDiscountBps,
      clvBudgetBps: draft.clvBudgetPercent === '' ? undefined : Math.round((Number(draft.clvBudgetPercent) || 0) * 100), approvalAboveBps: Math.round((Number(draft.approvalAbovePercent) || 0) * 100),
      membershipEligible: draft.membershipEligible, walletEligible: draft.walletEligible, active: draft.active,
      priority: draft.priority === '' ? undefined : Number(draft.priority), version: this.editingDiscountRuleId ? draft.version : undefined,
    };
    this.savingWorkspace = true;
    this.clientError = '';
    try {
      const request = this.editingDiscountRuleId
        ? this.api.patch<ApiEnvelope<any>>(`/clients/discount-rules/${this.editingDiscountRuleId}`, payload)
        : this.api.post<ApiEnvelope<any>>('/clients/discount-rules', payload);
      const result = await firstValueFrom(request);
      if (!result.success) throw new Error(result.error?.message || 'Discount rule could not be saved');
      this.drawerMode = null;
      await this.loadClientMasters();
    } catch (error) { this.clientError = this.errorMessage(error, 'Discount rule could not be saved'); }
    finally { this.savingWorkspace = false; }
  }

  async saveDiscountDecision() {
    if (!this.selectedClient) return;
    const subtotalPaise = Math.round((Number(this.discountDraft.subtotal) || 0) * 100);
    const requestedDiscountBps = Math.round((Number(this.discountDraft.discountPercent) || 0) * 100);
    if (!this.discountDraft.serviceCategory.trim() || subtotalPaise <= 0 || requestedDiscountBps <= 0) { this.clientError = 'Category, subtotal and discount are required'; return; }
    await this.saveGrowthAction(
      this.api.post<ApiEnvelope<any>>(`/clients/${this.selectedClient.id}/discount-decisions`, { serviceCategory: this.discountDraft.serviceCategory.trim(), subtotalPaise, requestedDiscountBps }),
      'Discount decision could not be recorded',
    );
  }

  approveDiscountDecision(decision: any) {
    void this.saveGrowthAction(this.api.post<ApiEnvelope<any>>(`/clients/discount-decisions/${decision.id}/approve`, {}), 'Discount decision could not be approved');
  }

  async saveWinBackOffer() {
    if (!this.selectedClient) return;
    const offeredDiscountBps = Math.round((Number(this.winBackDraft.discountPercent) || 0) * 100);
    if (!this.winBackDraft.title.trim() || offeredDiscountBps <= 0) { this.clientError = 'Title and discount are required'; return; }
    await this.saveGrowthAction(
      this.api.post<ApiEnvelope<any>>(`/clients/${this.selectedClient.id}/win-back-offers`, {
        decisionId: this.winBackDraft.decisionId || undefined, offerCode: this.winBackDraft.offerCode.trim() || undefined,
        title: this.winBackDraft.title.trim(), offeredDiscountBps,
        discountCostPaise: Math.round((Number(this.winBackDraft.discountCost) || 0) * 100),
        returnWindowDays: this.winBackDraft.returnWindowDays === '' ? undefined : Number(this.winBackDraft.returnWindowDays),
      }),
      'Win-back offer could not be issued',
    );
  }

  redeemWinBackOffer(offer: any) {
    if (!this.selectedClient) return;
    void this.saveGrowthAction(this.api.post<ApiEnvelope<any>>(`/clients/${this.selectedClient.id}/win-back-offers/${offer.id}/redeem`, {}), 'Win-back offer could not be redeemed');
  }

  showReviewLink() {
    if (!this.selectedClient) return;
    this.reviewDraft = { platform: 'google', externalReviewId: '', rating: '', reviewText: '', reviewedAt: '' };
    this.clientError = '';
    this.drawerMode = 'review';
  }

  showMerge() {
    if (!this.selectedClient || !this.duplicates.length) return;
    this.mergeTargetId = String(this.duplicates[0]?.id || '');
    this.clientError = '';
    this.drawerMode = 'merge';
  }

  showFormDefinition(definition?: any) {
    this.definitionDraft = definition ? {
      formKey: String(definition.formKey || ''), name: String(definition.name || ''), formType: String(definition.formType || 'consent'),
      body: String(definition.body || ''), questions: this.formFields(definition).map((field) => this.formFieldLine(field)).join('\n'),
      conditions: this.formFields(definition).filter((field) => field.visibleWhen).map((field) => `${field.key} | ${field.visibleWhen?.fieldKey} = ${String(field.visibleWhen?.equals)}`).join('\n'),
      requiresSignature: Boolean(definition.requiresSignature),
    } : this.blankDefinitionDraft();
    this.clientError = '';
    this.drawerMode = 'form-definition';
  }

  showFormSubmission(definition?: any) {
    if (!this.selectedClient || (!definition && !this.formDefinitions.length)) return;
    this.submissionDraft = this.blankSubmissionDraft();
    this.submissionDraft.definitionId = String(definition?.id || this.formDefinitions[0]?.id || '');
    this.clientError = '';
    this.drawerMode = 'form-submission';
  }

  showPhotoUpload() {
    if (!this.selectedClient) return;
    this.photoCaption = '';
    this.photoType = 'other';
    this.selectedPhoto = null;
    this.clientError = '';
    this.drawerMode = 'photo';
  }

  changeSubmissionForm(definitionId: string) {
    this.submissionDraft = { ...this.blankSubmissionDraft(), definitionId };
  }

  isFormFieldVisible(field: FormField) {
    if (!field.visibleWhen) return true;
    return this.submissionDraft.responses[field.visibleWhen.fieldKey] === field.visibleWhen.equals;
  }

  onPhotoSelected(event: Event) {
    this.selectedPhoto = (event.target as HTMLInputElement).files?.[0] || null;
  }

  closeDrawer() {
    this.drawerMode = null;
    this.clientError = '';
  }

  async saveClient() {
    this.clientError = '';
    const firstName = this.createGuest.firstName.trim();
    if (!firstName) {
      this.clientError = 'First name required';
      return;
    }

    this.savingClient = true;
    try {
      const payload = {
        code: this.createGuest.code.trim() || undefined,
        firstName,
        lastName: this.createGuest.lastName.trim(),
        phone: this.createGuest.phone.trim(),
        email: this.createGuest.email.trim(),
        birthday: this.createGuest.birthday || undefined,
        anniversary: this.createGuest.anniversary || undefined,
        categories: this.createGuest.categories.split(',').map((item) => item.trim()).filter(Boolean),
      };
      const result = this.editingClientId
        ? await firstValueFrom(this.api.patch<ApiEnvelope<any>>(`/clients/${this.editingClientId}`, payload))
        : await firstValueFrom(this.api.post<ApiEnvelope<any>>('/clients', payload));
      if (!result.success || !result.data) throw new Error(result?.error?.message || result?.error || 'Client save failed');

      const saved = this.toClientRow(result.data);
      await this.loadClients();
      this.drawerMode = null;
      this.selectClient(saved);
    } catch (error) {
      this.clientError = error instanceof Error ? error.message : 'Client save failed';
    } finally {
      this.savingClient = false;
    }
  }

  async saveNote() {
    if (!this.selectedClient || !this.noteDraft.trim()) {
      this.clientError = 'Note required';
      return;
    }
    this.savingNote = true;
    this.clientError = '';
    try {
      const result = await firstValueFrom(this.api.post<ApiEnvelope<any>>(`/clients/${this.selectedClient.id}/notes`, { noteType: this.noteType, note: this.noteDraft.trim() }));
      if (!result.success) throw new Error(result?.error?.message || result?.error || 'Note save failed');
      this.drawerMode = null;
      await this.refreshClientWorkspace(this.selectedClient.id);
    } catch (error) {
      this.clientError = error instanceof Error ? error.message : 'Note save failed';
    } finally {
      this.savingNote = false;
    }
  }

  async saveClinicalProfile() {
    if (!this.selectedClient) return;
    await this.saveWorkspace(
      this.api.patch<ApiEnvelope<any>>(`/clients/${this.selectedClient.id}/preferences`, this.clinicalDraft),
      'Clinical profile save failed',
    );
  }

  async saveFamilyLink() {
    if (!this.selectedClient || !this.familyDraft.relatedClientId) {
      this.clientError = 'Family member required';
      return;
    }
    await this.saveWorkspace(
      this.api.post<ApiEnvelope<any>>(`/clients/${this.selectedClient.id}/link-member`, this.familyDraft),
      'Family link failed',
    );
  }

  async unlinkFamilyMember(member: any) {
    if (!this.selectedClient || !window.confirm('Unlink this family member?')) return;
    await this.saveWorkspace(
      this.api.delete<ApiEnvelope<any>>(`/clients/${this.selectedClient.id}/family-members/${encodeURIComponent(member.memberId)}`),
      'Family unlink failed',
    );
  }

  async saveSoapNote() {
    if (!this.selectedClient) return;
    const payload = {
      appointmentId: this.soapDraft.appointmentId || undefined,
      subjective: this.soapDraft.subjective.trim(), objective: this.soapDraft.objective.trim(),
      assessment: this.soapDraft.assessment.trim(), plan: this.soapDraft.plan.trim(),
      status: this.soapDraft.status,
      expectedVersion: this.soapDraft.id ? this.soapDraft.expectedVersion : undefined,
    };
    const request = this.soapDraft.id
      ? this.api.patch<ApiEnvelope<any>>(`/clients/${this.selectedClient.id}/soap-notes/${this.soapDraft.id}`, payload)
      : this.api.post<ApiEnvelope<any>>(`/clients/${this.selectedClient.id}/soap-notes`, payload);
    await this.saveWorkspace(request, 'SOAP note save failed');
  }

  async saveContactPreferences() {
    if (!this.selectedClient) return;
    await this.saveWorkspace(
      this.api.patch<ApiEnvelope<any>>(`/clients/${this.selectedClient.id}/contact-preferences`, {
        preferredStaffId: this.contactDraft.preferredStaffId || undefined,
        preferredCommunicationChannel: this.contactDraft.preferredCommunicationChannel,
        whatsappOptIn: this.consentBool(this.contactDraft.whatsappOptIn),
        smsOptIn: this.consentBool(this.contactDraft.smsOptIn),
        emailOptIn: this.consentBool(this.contactDraft.emailOptIn),
        reason: this.contactDraft.reason.trim(),
      }),
      'Communication preferences save failed',
    );
  }

  async saveReviewLink() {
    if (!this.selectedClient) return;
    const rating = Number(this.reviewDraft.rating);
    await this.saveWorkspace(
      this.api.post<ApiEnvelope<any>>(`/clients/${this.selectedClient.id}/reviews`, {
        platform: this.reviewDraft.platform,
        externalReviewId: this.reviewDraft.externalReviewId.trim() || undefined,
        rating: rating >= 1 && rating <= 5 ? rating : undefined,
        reviewText: this.reviewDraft.reviewText.trim() || undefined,
        reviewedAt: this.reviewDraft.reviewedAt ? `${this.reviewDraft.reviewedAt}T00:00:00Z` : undefined,
      }),
      'Review link failed',
    );
  }

  async mergeClient() {
    if (!this.selectedClient || !this.mergeTargetId) return;
    this.savingWorkspace = true;
    this.clientError = '';
    try {
      const result = await firstValueFrom(this.api.post<ApiEnvelope<any>>(`/clients/${this.selectedClient.id}/merge`, { targetClientId: this.mergeTargetId }));
      if (!result.success) throw new Error(result?.error?.message || result?.error || 'Client merge failed');
      this.drawerMode = null;
      await this.loadClients();
      const target = this.clientRows.find((client) => client.id === this.mergeTargetId);
      target ? this.selectClient(target) : this.clearSelection();
    } catch (error) {
      this.clientError = this.errorMessage(error, 'Client merge failed');
    } finally {
      this.savingWorkspace = false;
    }
  }

  async saveFormDefinition() {
    const name = this.definitionDraft.name.trim();
    const formKey = (this.definitionDraft.formKey.trim() || name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')).slice(0, 80);
    if (!name || !formKey) {
      this.clientError = 'Form name required';
      return;
    }
    const fields = this.parseFormFields(this.definitionDraft.questions, this.definitionDraft.conditions);
    if (!fields.length) {
      this.clientError = 'At least one question required';
      return;
    }
    await this.saveWorkspace(
      this.api.post<ApiEnvelope<any>>('/clients/forms/definitions', {
        formKey, name, formType: this.definitionDraft.formType, body: this.definitionDraft.body.trim(), fields,
        requiresSignature: this.definitionDraft.requiresSignature,
      }),
      'Form version save failed',
    );
  }

  async saveFormSubmission() {
    if (!this.selectedClient || !this.submissionDraft.definitionId) return;
    await this.saveWorkspace(
      this.api.post<ApiEnvelope<any>>(`/clients/${this.selectedClient.id}/form-submissions`, this.submissionDraft),
      'Form submission failed',
    );
  }

  async startKiosk(definition: any) {
    if (!this.selectedClient) return;
    this.workspaceError = '';
    try {
      const result = await firstValueFrom(this.api.post<ApiEnvelope<any>>(
        `/clients/${this.selectedClient.id}/forms/${encodeURIComponent(definition.id)}/kiosk-token`,
        {},
      ));
      if (!result.success || !result.data) throw new Error(result?.error?.message || 'Kiosk access failed');
      this.kioskAccess = result.data;
      this.kioskDraft = { responses: {}, signatureName: '', consentAccepted: false };
      this.kioskMode = true;
    } catch (error) {
      this.workspaceError = this.errorMessage(error, 'Kiosk access failed');
    }
  }

  isKioskFieldVisible(field: FormField) {
    if (!field.visibleWhen) return true;
    return this.kioskDraft.responses[field.visibleWhen.fieldKey] === field.visibleWhen.equals;
  }

  closeKiosk() {
    this.kioskMode = false;
    this.kioskAccess = null;
    this.kioskDraft = { responses: {}, signatureName: '', consentAccepted: false };
    this.clientError = '';
  }

  async submitKioskForm() {
    if (!this.selectedClient || !this.kioskAccess?.token || !this.kioskAccess?.endpoint) return;
    this.savingWorkspace = true;
    this.clientError = '';
    try {
      const response = await fetch(`${this.kioskAccess.endpoint}/submissions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-public-booking-token': String(this.kioskAccess.token) },
        body: JSON.stringify(this.kioskDraft),
      });
      const result = await response.json();
      if (!response.ok || !result?.success) throw new Error(result?.message || result?.error?.message || 'Kiosk form submission failed');
      const clientId = this.selectedClient.id;
      this.closeKiosk();
      await this.refreshClientWorkspace(clientId);
    } catch (error) {
      this.clientError = this.errorMessage(error, 'Kiosk form submission failed');
    } finally {
      this.savingWorkspace = false;
    }
  }

  async saveTreatmentPhoto() {
    if (!this.selectedClient || !this.selectedPhoto) {
      this.clientError = 'Photo required';
      return;
    }
    const query = new URLSearchParams({ fileName: this.selectedPhoto.name });
    if (this.photoCaption.trim()) query.set('caption', this.photoCaption.trim());
    query.set('photoType', this.photoType);
    await this.saveWorkspace(
      this.api.post<ApiEnvelope<any>>(`/clients/${this.selectedClient.id}/treatment-photos?${query}`, this.selectedPhoto),
      'Treatment photo upload failed',
    );
  }

  async viewTreatmentPhoto(photo: any) {
    if (!this.selectedClient) return;
    this.workspaceError = '';
    try {
      const blob = await firstValueFrom(this.api.getBlob(`/clients/${this.selectedClient.id}/treatment-photos/${photo.id}/content`));
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank', 'noopener,noreferrer');
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (error) {
      this.workspaceError = this.errorMessage(error, 'Treatment photo could not be loaded');
    }
  }

  async loadClientReport() {
    this.loadingReport = true;
    this.reportError = '';
    try {
      const result = await firstValueFrom(this.api.get<ApiEnvelope<any[]>>(`/clients/reports/${this.selectedReportType}?${this.reportQueryString()}`));
      if (!result.success || !Array.isArray(result.data)) throw new Error(result?.error?.message || 'Client report could not be loaded');
      this.reportRows = result.data;
    } catch (error) {
      this.reportRows = [];
      this.reportError = this.errorMessage(error, 'Client report could not be loaded');
    } finally {
      this.loadingReport = false;
    }
  }

  async loadGrowth() {
    if (!this.selectedClient) { this.growth = this.emptyGrowth(); return; }
    this.loadingGrowth = true;
    this.growthError = '';
    try {
      const result = await firstValueFrom(this.api.get<ApiEnvelope<any>>(`/clients/${this.selectedClient.id}/growth`));
      if (!result.success || !result.data) throw new Error(result.error?.message || 'Client growth data could not be loaded');
      this.growth = { ...this.emptyGrowth(), ...result.data };
    } catch (error) {
      this.growth = this.emptyGrowth();
      this.growthError = this.errorMessage(error, 'Client growth data could not be loaded');
    } finally { this.loadingGrowth = false; }
  }

  async saveRecommendationFeedback(decision: 'accepted' | 'rejected') {
    const recommendation = String(this.memoryGraph.recommendation?.action || this.clientSummary.nextBestAction || '').trim();
    if (!this.selectedClient || !recommendation) return;
    this.savingRecommendationFeedback = true;
    this.growthError = '';
    try {
      const result = await firstValueFrom(this.api.post<ApiEnvelope<any>>(`/clients/${this.selectedClient.id}/recommendation-feedback`, { recommendation, decision }));
      if (!result.success) throw new Error(result.error?.message || 'Recommendation feedback could not be saved');
      await this.refreshClientWorkspace(this.selectedClient.id);
    } catch (error) {
      this.growthError = this.errorMessage(error, 'Recommendation feedback could not be saved');
    } finally {
      this.savingRecommendationFeedback = false;
    }
  }

  async exportClients() {
    this.clientListError = '';
    try {
      const result = await firstValueFrom(this.api.get<ApiEnvelope<any[]>>('/clients/bulk/export?pageSize=5000'));
      if (!result.success || !Array.isArray(result.data)) throw new Error(result.error?.message || 'Client export failed');
      const url = URL.createObjectURL(new Blob([JSON.stringify(result.data, null, 2)], { type: 'application/json' }));
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `clients-${new Date().toISOString().slice(0, 10)}.json`;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      this.clientListError = this.errorMessage(error, 'Client export failed');
    }
  }

  async importClients(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    this.clientListError = '';
    try {
      const parsed = JSON.parse(await file.text());
      const clients = Array.isArray(parsed) ? parsed : parsed?.clients;
      if (!Array.isArray(clients)) throw new Error('Client import file must contain a JSON array');
      const result = await firstValueFrom(this.api.post<ApiEnvelope<any>>('/clients/bulk/import', { clients }));
      if (!result.success) throw new Error(result.error?.message || 'Client import failed');
      await this.loadClients(this.searchTerm);
    } catch (error) {
      this.clientListError = this.errorMessage(error, 'Client import failed');
    } finally {
      input.value = '';
    }
  }

  async loadClientMasters() {
    this.loadingMasters = true;
    this.mastersError = '';
    try {
      const [masters, audit, rules, summary] = await Promise.all([
        firstValueFrom(this.api.get<ApiEnvelope<any[]>>(`/clients/masters/${this.selectedMasterType}`)),
        firstValueFrom(this.api.get<ApiEnvelope<any[]>>(`/clients/master-audit/${this.selectedMasterType}`)),
        firstValueFrom(this.api.get<ApiEnvelope<any[]>>('/clients/discount-rules')),
        firstValueFrom(this.api.get<ApiEnvelope<any>>('/clients/masters/summary')),
      ]);
      if (!masters.success || !audit.success || !rules.success || !summary.success) throw new Error(masters.error?.message || audit.error?.message || rules.error?.message || summary.error?.message || 'Client masters could not be loaded');
      this.clientMasters = Array.isArray(masters.data) ? masters.data : [];
      this.clientMasterAudit = Array.isArray(audit.data) ? audit.data : [];
      this.discountRules = Array.isArray(rules.data) ? rules.data : [];
      this.clientMasterSummary = Array.isArray(summary.data?.kinds) ? summary.data.kinds : [];
    } catch (error) {
      this.clientMasters = [];
      this.clientMasterAudit = [];
      this.clientMasterSummary = [];
      this.discountRules = [];
      this.mastersError = this.errorMessage(error, 'Client masters could not be loaded');
    } finally { this.loadingMasters = false; }
  }

  async exportClient360() {
    if (!this.selectedClient) return;
    this.reportError = '';
    try {
      const blob = await firstValueFrom(this.api.getBlob(`/clients/${this.selectedClient.id}/report/export`));
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `client-${this.selectedClient.id}-360.csv`;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      this.reportError = this.errorMessage(error, 'Client report export failed');
    }
  }

  async exportBestClientsReport() {
    this.reportError = '';
    try {
      const blob = await firstValueFrom(this.api.getBlob(`/clients/reports/best-clients/export?${this.reportQueryString()}`));
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `best-clients-${new Date().toISOString().slice(0, 10)}.csv`;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      this.reportError = this.errorMessage(error, 'Best clients export failed');
    }
  }

  reportHeader(column: string) {
    const labels: Record<string, string> = {
      clientName: 'Client',
      phone: 'Phone',
      segment: 'Segment',
      rfmScore: 'RFM',
      lifetimeValuePaise: 'Lifetime value',
      averageSpendPaise: 'Average spend',
      highestBillPaise: 'Highest bill',
      totalVisits: 'Visits',
      lastVisitAt: 'Last visit',
      favouriteService: 'Favourite service',
      churnRiskScore: 'Churn risk',
      unpaidPaise: 'Unpaid',
      invoiceCount: 'Invoices',
    };
    return labels[column] || column.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, (value) => value.toUpperCase());
  }

  reportValue(column: string, value: unknown) {
    if (value === null || value === undefined || value === '') return '—';
    if (/paise$/i.test(column)) return this.money(Number(value));
    if (/At$|Date$|birthday|anniversary/i.test(column)) return this.formatDateTime(String(value));
    return String(value);
  }

  private reportQueryString() {
    const query = new URLSearchParams();
    query.set('days', String(this.reportDays));
    query.set('limit', String(this.reportLimit));
    if (this.isBestClientsReport) {
      const minLifetimeValuePaise = Math.round((Number(this.reportMinLifetimeValue) || 0) * 100);
      const minVisits = Math.max(0, Math.floor(Number(this.reportMinVisits) || 0));
      const maxChurnRiskScore = Math.floor(Number(this.reportMaxChurnRisk));
      if (minLifetimeValuePaise > 0) query.set('min_lifetime_value_paise', String(minLifetimeValuePaise));
      if (minVisits > 0) query.set('min_visits', String(minVisits));
      if (this.reportSegment.trim()) query.set('segment', this.reportSegment.trim());
      if (Number.isFinite(maxChurnRiskScore)) query.set('max_churn_risk_score', String(Math.min(100, Math.max(0, maxChurnRiskScore))));
      query.set('include_unpaid', String(this.reportIncludeUnpaid));
    }
    return query.toString();
  }

  bookAppointment() {
    if (this.selectedClient) void this.router.navigate(['/appointments'], { queryParams: { clientId: this.selectedClient.id } });
  }

  newSale() {
    if (this.selectedClient) void this.router.navigate(['/pos'], { queryParams: { clientId: this.selectedClient.id } });
  }

  messageClient() {
    if (!this.selectedClient) return;
    if (this.selectedClient.whatsappOptIn !== true) {
      this.showContactPreferences();
      this.clientError = 'WhatsApp opt-in required';
      return;
    }
    void this.router.navigate(['/notifications'], { queryParams: { clientId: this.selectedClient.id } });
  }

  titleCase(value: string) {
    return value.split(' ').map((part) => part ? part[0].toUpperCase() + part.slice(1).toLowerCase() : part).join(' ');
  }

  formatDate(value?: string) {
    if (!value) return '—';
    const iso = String(value).slice(0, 10);
    const match = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (match) return `${match[3]}/${match[2]}/${match[1]}`;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? '—' : new Intl.DateTimeFormat('en-GB').format(date);
  }

  formatDateTime(value?: string) {
    if (!value) return '—';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? this.formatDate(value) : new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
  }

  money(value: number) {
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format((Number(value) || 0) / 100);
  }

  trackByEvent(_index: number, event: TimelineEvent) { return event.id; }
  trackByClient(_index: number, client: ClientRow) { return client.id; }
  trackByGiftCard(_index: number, card: GiftCardRow) { return card.id; }

  async loadGiftCardRegister() {
    this.giftCardRegisterLoading = true;
    this.giftCardRegisterError = '';
    try {
      const result = await firstValueFrom(this.api.get<ApiEnvelope<any[]>>('/retention/gift-cards'));
      if (!result.success || !Array.isArray(result.data)) throw new Error(result.error?.message || 'Gift cards could not be loaded');
      this.giftCardRegister = result.data.map((card) => {
        const clientId = String(card.clientId ?? card.client_id ?? '');
        return {
          id: String(card.id ?? ''),
          code: String(card.code ?? ''),
          clientId,
          clientName: String(card.clientName ?? card.client_name ?? this.clientRows.find((client) => client.id === clientId)?.name ?? clientId),
          initialAmountPaise: Number(card.initialAmountPaise ?? card.initial_amount_paise) || 0,
          balancePaise: Number(card.balancePaise ?? card.balance_paise) || 0,
          status: String(card.status ?? ''),
          expiresAt: card.expiresAt ?? card.expires_at,
          sourceSaleId: String(card.sourceSaleId ?? card.source_sale_id ?? ''),
          createdAt: String(card.createdAt ?? card.created_at ?? ''),
        };
      });
    } catch (error) {
      this.giftCardRegister = [];
      this.giftCardRegisterError = this.errorMessage(error, 'Gift cards could not be loaded');
    } finally {
      this.giftCardRegisterLoading = false;
    }
  }

  private async loadClients(q = '') {
    this.loadingClients = true;
    this.clientListError = '';
    try {
      const suffix = `?pageSize=100${q.trim() ? `&q=${encodeURIComponent(q.trim())}` : ''}`;
      const result = await firstValueFrom(this.api.get<ApiEnvelope<any[]>>(`/clients${suffix}`));
      if (!result.success || !Array.isArray(result.data)) throw new Error(result?.error?.message || 'Clients could not be loaded');
      this.clientRows = result.data.map((client) => this.toClientRow(client));
    } catch (error) {
      this.clientRows = [];
      this.clientListError = this.errorMessage(error, 'Clients could not be loaded');
    } finally {
      this.loadingClients = false;
    }
  }

  private async initializeClients() {
    const clientId = this.route.snapshot.paramMap.get('clientId');
    if (!clientId) {
      await this.loadClients();
      return;
    }

    const routedClient = window.history.state?.client as ClientRow | undefined;
    if (routedClient?.id === clientId) {
      this.selectClient(routedClient, false);
      void this.loadClients();
      return;
    }

    await this.loadClients();

    const listedClient = this.clientRows.find((client) => client.id === clientId);
    if (listedClient) {
      this.selectClient(listedClient, false);
      return;
    }

    try {
      const result = await firstValueFrom(this.api.get<ApiEnvelope<any>>(`/clients/${clientId}`));
      if (!result.success || !result.data) throw new Error(result?.error?.message || 'Client could not be loaded');
      this.selectClient(this.toClientRow(result.data.client || result.data), false);
    } catch (error) {
      this.clientListError = this.errorMessage(error, 'Client could not be loaded');
    }
  }

  private async loadClientWorkspace(clientId: string) {
    const loadVersion = ++this.workspaceLoadVersion;
    const requests = await Promise.allSettled([
      firstValueFrom(this.api.get<ApiEnvelope<any>>(`/clients/${clientId}`)),
      firstValueFrom(this.api.get<ApiEnvelope<any>>(`/clients/${clientId}/wallet`)),
      firstValueFrom(this.api.get<ApiEnvelope<any>>(`/membership-enterprise/client/${clientId}/360`)),
      firstValueFrom(this.api.get<ApiEnvelope<any>>(`/pos/clients/${clientId}/kpi`)),
      firstValueFrom(this.api.get<ApiEnvelope<any[]>>(`/clients/${clientId}/audit`)),
      firstValueFrom(this.api.get<ApiEnvelope<any[]>>('/staff?pageSize=100')),
      firstValueFrom(this.api.get<ApiEnvelope<any[]>>(`/clients/${clientId}/store-credits`)),
      firstValueFrom(this.api.get<ApiEnvelope<any>>(`/retention/clients/${clientId}`)),
      firstValueFrom(this.api.get<ApiEnvelope<any>>(`/clients/${clientId}/memory-graph`)),
      firstValueFrom(this.api.get<ApiEnvelope<any[]>>(`/clients/${clientId}/automations`)),
    ]);

    if (loadVersion !== this.workspaceLoadVersion || this.selectedClient?.id !== clientId) return;
    const core = requests[0];
    if (core.status === 'rejected' || !core.value.success || !core.value.data) {
      this.workspaceError = core.status === 'rejected'
        ? this.errorMessage(core.reason, 'Client data could not be loaded')
        : String(core.value.error?.message || 'Client data could not be loaded');
      return;
    }

    const data = requests.map((result) => result.status === 'fulfilled' && result.value.success ? result.value.data : null);
    if (data[0] && this.selectedClient?.id === clientId) this.selectedClient = this.toClientRow(data[0]);
    this.clientSummary = data[0]?.summary || {};
    this.appointments = Array.isArray(data[0]?.appointments) ? data[0].appointments : [];
    this.salesRows = Array.isArray(data[0]?.invoices) ? data[0].invoices : [];
    this.serviceHistory = Array.isArray(data[0]?.serviceHistory) ? data[0].serviceHistory : [];
    this.clientNotes = Array.isArray(data[0]?.clientNotes) ? data[0].clientNotes : [];
    this.familyMembers = Array.isArray(data[0]?.familyMembers) ? data[0].familyMembers : [];
    this.clinicalProfile = data[0]?.clinicalProfile || null;
    this.soapNotes = Array.isArray(data[0]?.soapNotes) ? data[0].soapNotes : [];
    this.formDefinitions = Array.isArray(data[0]?.formDefinitions) ? data[0].formDefinitions : [];
    this.formSubmissions = Array.isArray(data[0]?.formSubmissions) ? data[0].formSubmissions : [];
    this.treatmentPhotos = Array.isArray(data[0]?.treatmentPhotos) ? data[0].treatmentPhotos : [];
    this.duplicates = Array.isArray(data[0]?.duplicates) ? data[0].duplicates : [];
    this.consentHistory = Array.isArray(data[0]?.consentHistory) ? data[0].consentHistory : [];
    this.communications = Array.isArray(data[0]?.communications) ? data[0].communications : [];
    this.reviews = Array.isArray(data[0]?.reviews) ? data[0].reviews : [];
    this.auditEvents = Array.isArray(data[4]) ? data[4] : [];
    this.staffRows = Array.isArray(data[5]) ? data[5] : this.staffRows;
    this.walletTransactions = Array.isArray(data[1]?.transactions) ? data[1].transactions : [];
    this.storeCredits = Array.isArray(data[6]) ? data[6] : [];
    this.retention = data[7] ? { ...this.emptyRetention(), ...data[7], loyalty: { ...this.emptyRetention().loyalty, ...(data[7].loyalty || {}) }, giftCards: Array.isArray(data[7].giftCards) ? data[7].giftCards : [], rewardLedger: Array.isArray(data[7].rewardLedger) ? data[7].rewardLedger : [], referrals: Array.isArray(data[7].referrals) ? data[7].referrals : [] } : this.emptyRetention();
    this.memoryGraph = data[8] ? { ...this.emptyMemoryGraph(), ...data[8] } : this.emptyMemoryGraph();
    this.automations = Array.isArray(data[9]) ? data[9] : [];
    this.walletBalancePaise = Number(data[1]?.balancePaise ?? data[3]?.walletPaise) || 0;
    this.memberships = Array.isArray(data[2]?.memberships) ? data[2].memberships : [];
    this.membershipCredits = Array.isArray(data[3]?.membershipCredits) ? data[3].membershipCredits : [];
    this.packages = Array.isArray(data[3]?.packageCredits) ? data[3].packageCredits : [];
    this.unpaidPaise = Number(this.clientSummary.amountDuePaise ?? data[3]?.unpaidPaise) || 0;
    this.rewardPoints = Number(this.retention.loyalty.pointsBalance ?? this.clientSummary.rewardPointsBalance ?? data[3]?.rewardPointsBalance) || 0;
  }

  private async loadInitialClientView(clientId: string) {
    await this.loadTimeline(clientId, true);
    if (this.selectedClient?.id === clientId) void this.loadClientWorkspace(clientId);
  }

  async loadMoreTimeline() {
    if (!this.selectedClient || !this.timelineNextCursor || this.loadingMoreTimeline) return;
    await this.loadTimeline(this.selectedClient.id, false);
  }

  private async loadTimeline(clientId: string, reset: boolean) {
    const loadVersion = reset ? ++this.timelineLoadVersion : this.timelineLoadVersion;
    if (reset) {
      this.timelineEvents = [];
      this.timelineNextCursor = '';
      this.loadingWorkspace = true;
      this.workspaceError = '';
    } else {
      this.loadingMoreTimeline = true;
    }
    try {
      const cursor = reset ? '' : `&cursor=${encodeURIComponent(this.timelineNextCursor)}`;
      const result = await firstValueFrom(this.api.get<ApiEnvelope<any>>(`/clients/${clientId}/timeline?limit=30${cursor}`));
      if (loadVersion !== this.timelineLoadVersion || this.selectedClient?.id !== clientId) return;
      if (!result.success || !result.data) throw new Error(result?.error?.message || 'Client timeline could not be loaded');
      const rows = Array.isArray(result.data.items) ? result.data.items.map((row: any) => this.toTimelineEvent(row)) : [];
      if (reset) {
        this.timelineEvents = rows;
      } else {
        const existing = new Set(this.timelineEvents.map((event) => event.id));
        this.timelineEvents = [...this.timelineEvents, ...rows.filter((event: TimelineEvent) => !existing.has(event.id))];
      }
      this.timelineNextCursor = String(result.data.nextCursor || '');
    } catch (error) {
      if (loadVersion === this.timelineLoadVersion && this.selectedClient?.id === clientId) {
        this.workspaceError = this.errorMessage(error, 'Client timeline could not be loaded');
      }
    } finally {
      if (loadVersion === this.timelineLoadVersion) {
        this.loadingWorkspace = false;
        this.loadingMoreTimeline = false;
      }
    }
  }

  private toTimelineEvent(row: any): TimelineEvent {
    const type = this.eventFilters.some((filter) => filter.key === row?.type) ? row.type as TimelineType : 'Audit activity';
    const amount = row?.amountPaise;
    const tip = row?.tipPaise;
    const balance = row?.balancePaise;
    return {
      id: String(row?.id || ''), type, title: String(row?.title || ''), detail: String(row?.detail || ''), occurredAt: String(row?.occurredAt || ''),
      icon: this.eventFilters.find((filter) => filter.key === type)?.icon || 'bi-clock-history',
      amountPaise: amount === null || amount === undefined ? undefined : Number(amount),
      status: row?.status ? String(row.status) : undefined,
      groupId: row?.groupId ? String(row.groupId) : undefined,
      tipPaise: tip === null || tip === undefined ? undefined : Number(tip),
      balancePaise: balance === null || balance === undefined ? undefined : Number(balance),
    };
  }

  private groupTimeline(events: TimelineEvent[]) {
    const groups = new Map<string, TimelineEvent[]>();
    const output: TimelineEvent[] = [];
    for (const event of events) {
      if (!event.groupId || !this.isAppointmentLinked(event)) {
        output.push(event);
        continue;
      }
      const rows = groups.get(event.groupId) || [];
      rows.push(event);
      groups.set(event.groupId, rows);
    }
    for (const rows of groups.values()) output.push(this.toAppointmentTimelineGroup(rows));
    return output.sort((a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime());
  }

  private isAppointmentLinked(event: TimelineEvent) {
    return ['Appointments', 'Invoices', 'Services', 'Payments'].includes(event.type);
  }

  private toAppointmentTimelineGroup(rows: TimelineEvent[]): TimelineEvent {
    if (rows.length === 1 && rows[0].type !== 'Appointments') return rows[0];
    const appointment = rows.find((event) => event.id.startsWith('appointment:')) || rows.find((event) => event.type === 'Appointments') || rows[0];
    const service = rows.find((event) => event.type === 'Services')?.title || appointment.detail || rows.find((event) => event.detail)?.detail || '';
    const invoice = rows.find((event) => event.type === 'Invoices');
    const tipPaise = rows.reduce((sum, event) => sum + (event.type === 'Invoices' ? Number(event.tipPaise) || 0 : 0), 0);
    const balancePaise = rows.reduce((max, event) => Math.max(max, event.type === 'Invoices' ? Number(event.balancePaise) || 0 : 0), 0);
    return {
      ...appointment,
      id: `group:${appointment.groupId || appointment.id}`,
      title: service ? `${service} Appointment` : appointment.title,
      detail: appointment.detail || invoice?.detail || '',
      occurredAt: rows.reduce((latest, event) => new Date(event.occurredAt).getTime() > new Date(latest).getTime() ? event.occurredAt : latest, rows[0].occurredAt),
      amountPaise: invoice?.amountPaise,
      status: appointment.status || invoice?.status,
      tipPaise: tipPaise || undefined,
      balancePaise: balancePaise || undefined,
      grouped: true,
      steps: this.appointmentSteps(rows),
      children: rows.filter((event) => event.type !== 'Appointments'),
    };
  }

  private appointmentSteps(rows: TimelineEvent[]) {
    const seen = new Set<string>();
    return rows
      .filter((event) => event.type === 'Appointments')
      .sort((a, b) => new Date(a.occurredAt).getTime() - new Date(b.occurredAt).getTime())
      .map((event) => ({ label: this.appointmentStepLabel(event), occurredAt: event.occurredAt, icon: event.icon }))
      .filter((step) => {
        const key = step.label.toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
  }

  private appointmentStepLabel(event: TimelineEvent) {
    const text = `${event.title} ${event.status || ''}`.toLowerCase();
    if (text.includes('book')) return 'Booked';
    if (text.includes('arriv')) return 'Arrived';
    if (text.includes('start') || text.includes('service')) return 'Started';
    if (text.includes('complete')) return 'Completed';
    if (text.includes('cancel')) return 'Cancelled';
    if (text.includes('no_show') || text.includes('no-show')) return 'No show';
    if (text.includes('bill') || text.includes('paid')) return 'Billed';
    return 'Edited';
  }

  private async refreshClientWorkspace(clientId: string) {
    await this.loadTimeline(clientId, true);
    if (this.selectedClient?.id === clientId) await this.loadClientWorkspace(clientId);
  }

  private async saveClientStatus(request: Observable<ApiEnvelope<any>>, fallback: string, clearAfter = false) {
    if (!this.selectedClient) return;
    this.clientError = '';
    const clientId = this.selectedClient.id;
    try {
      const result = await firstValueFrom(request);
      if (!result.success || !result.data) throw new Error(result.error?.message || fallback);
      await this.loadClients(this.searchTerm);
      if (clearAfter) {
        this.clearSelection();
      } else {
        const updated = this.toClientRow(result.data);
        this.selectedClient = updated;
        await this.refreshClientWorkspace(clientId);
      }
    } catch (error) {
      this.clientError = this.errorMessage(error, fallback);
    }
  }

  private toClientRow(client: any): ClientRow {
    const firstName = String(client?.firstName || '');
    const lastName = String(client?.lastName || '');
    return {
      id: String(client?.id || ''), code: String(client?.code || ''), firstName, lastName,
      name: `${firstName} ${lastName}`.trim() || String(client?.code || ''), phone: String(client?.phone || ''), email: String(client?.email || ''),
      normalizedPhone: String(client?.normalizedPhone || ''),
      lastVisit: String(client?.lastVisitAt || ''), birthday: String(client?.birthday || ''), anniversary: String(client?.anniversary || ''),
      membership: String(client?.membershipLabel || ''), categories: Array.isArray(client?.categories) ? client.categories.map(String) : [],
      center: String(client?.branchId || ''), notes: String(client?.notes || ''), active: client?.active !== false,
      duplicateCount: Number(client?.duplicateCount) || 0, preferredStaffId: String(client?.preferredStaffId || ''), preferredStaffName: String(client?.preferredStaffName || ''),
      preferredCommunicationChannel: String(client?.preferredCommunicationChannel || 'none'), whatsappOptIn: this.nullableBool(client?.whatsappOptIn), smsOptIn: this.nullableBool(client?.smsOptIn), emailOptIn: this.nullableBool(client?.emailOptIn),
      createdAt: String(client?.createdAt || ''), updatedAt: String(client?.updatedAt || ''),
    };
  }

  private blankGuestForm() {
    return { code: '', firstName: '', lastName: '', phone: '', email: '', birthday: '', anniversary: '', categories: '' };
  }

  private blankDefinitionDraft() {
    return { formKey: '', name: '', formType: 'consent', body: '', questions: '', conditions: '', requiresSignature: true };
  }

  private blankSoapDraft() {
    return { id: '', appointmentId: '', subjective: '', objective: '', assessment: '', plan: '', status: 'draft', expectedVersion: 0 };
  }

  private formFieldLine(field: FormField) {
    const type = field.type === 'select' ? `select:${(field.options || []).join(',')}` : field.type;
    return `${field.label}${field.required ? ' *' : ''} | ${type}`;
  }

  private parseFormFields(questionText: string, conditionText: string): FormField[] {
    const fields = questionText.split('\n').map((line) => line.trim()).filter(Boolean).map((line, index) => {
      const [labelPart = '', typePart = 'text'] = line.split('|').map((value) => value.trim());
      const required = labelPart.endsWith('*');
      const normalizedType = typePart.toLowerCase();
      const type = normalizedType.startsWith('select:') ? 'select' : normalizedType;
      const allowedType = ['text', 'textarea', 'boolean', 'date', 'select'].includes(type) ? type as FormField['type'] : 'text';
      const field: FormField = {
        key: `question_${index + 1}`,
        label: labelPart.replace(/\s*\*$/, '').trim(),
        type: allowedType,
        required,
      };
      if (allowedType === 'select') field.options = typePart.slice(typePart.indexOf(':') + 1).split(',').map((option) => option.trim()).filter(Boolean);
      return field;
    }).filter((field) => field.label);
    const byKey = new Map(fields.map((field) => [field.key, field]));
    for (const line of conditionText.split('\n').map((value) => value.trim()).filter(Boolean)) {
      const [targetKey = '', expression = ''] = line.split('|').map((value) => value.trim());
      const [fieldKey = '', rawEquals = ''] = expression.split('=').map((value) => value.trim());
      const target = byKey.get(targetKey);
      if (!target || !byKey.has(fieldKey) || !rawEquals) continue;
      const equals: string | boolean = rawEquals.toLowerCase() === 'true' ? true : rawEquals.toLowerCase() === 'false' ? false : rawEquals;
      target.visibleWhen = { fieldKey, equals };
    }
    return fields;
  }

  private blankSubmissionDraft() {
    return { definitionId: '', responses: {} as Record<string, any>, signatureName: '', consentAccepted: false };
  }

  private blankContactDraft() {
    return { preferredStaffId: '', preferredCommunicationChannel: 'none', whatsappOptIn: '', smsOptIn: '', emailOptIn: '', reason: '' };
  }

  private masterDefinitionFromDraft() {
    if (this.usesCustomSegmentRules) {
      const definition: Record<string, number> = {};
      if (this.masterDraft.minLifetimeValue !== '') definition.minLifetimeValuePaise = Math.round((Number(this.masterDraft.minLifetimeValue) || 0) * 100);
      if (this.masterDraft.minRfmScore !== '') definition.minRfmScore = Number(this.masterDraft.minRfmScore) || 0;
      if (this.masterDraft.maxInactiveDays !== '') definition.maxInactiveDays = Number(this.masterDraft.maxInactiveDays) || 0;
      if (this.masterDraft.minChurnRiskScore !== '') definition.minChurnRiskScore = Number(this.masterDraft.minChurnRiskScore) || 0;
      return definition;
    }
    const definition = JSON.parse(this.masterDraft.definitionText || '{}');
    if (!definition || typeof definition !== 'object' || Array.isArray(definition)) throw new Error('Configuration must be valid JSON');
    if (this.masterDraft.sortOrder !== '') definition.sortOrder = Number(this.masterDraft.sortOrder) || 0;
    if (this.masterDraft.color.trim()) definition.color = this.masterDraft.color.trim();
    return definition;
  }

  private blankMasterDraft() { return { code: '', name: '', description: '', definitionText: '{}', status: 'active', version: 1, sortOrder: '', color: '', minLifetimeValue: '', minRfmScore: '', maxInactiveDays: '', minChurnRiskScore: '' }; }
  private blankDiscountRuleDraft() { return { name: '', segments: '', serviceCategories: '', minLifetimeValue: '', maxDiscountPercent: '', clvBudgetPercent: '', approvalAbovePercent: '', priority: '', membershipEligible: true, walletEligible: true, active: true, version: 1 }; }
  private emptyGrowth() { return { context: {}, customSegments: [], discountDecisions: [], winBack: { issuedCount: 0, redeemedCount: 0, returnedCount: 0, winBackSuccessRateBps: 0, revenueAfterReturnPaise: 0, discountCostPaise: 0, offerRoiBps: 0 }, offers: [] }; }
  private emptyMemoryGraph() { return { recommendation: {}, segment: { history: [] }, relationships: {} }; }

  private connectLiveClient(clientId: string) {
    this.disconnectLiveClient();
    const token = localStorage.getItem('aurashine_access_token');
    if (!token) return;
    const scheme = window.location.protocol === 'https:' ? 'wss' : 'ws';
    this.liveSocket = new WebSocket(`${scheme}://${window.location.host}/api/v1/realtime/clients/${encodeURIComponent(clientId)}`, ['aurashine-v1', token]);
    this.liveSocket.onmessage = () => {
      if (this.selectedClient?.id === clientId) void this.refreshClientWorkspace(clientId);
    };
    this.liveSocket.onclose = () => {
      this.liveSocket = null;
      if (this.selectedClient?.id === clientId && !this.liveReconnectTimer) {
        this.liveReconnectTimer = setTimeout(() => {
          this.liveReconnectTimer = undefined;
          this.connectLiveClient(clientId);
        }, 3000);
      }
    };
  }

  private disconnectLiveClient() {
    if (this.liveReconnectTimer) clearTimeout(this.liveReconnectTimer);
    this.liveReconnectTimer = undefined;
    if (this.liveSocket) {
      this.liveSocket.onclose = null;
      this.liveSocket.close();
      this.liveSocket = null;
    }
  }

  private blankRetentionDraft() { return { amount: '', points: '', note: '', giftCardId: '', code: '', expiresAt: '', referredClientId: '', idempotencyKey: '' }; }
  private emptyRetention(): RetentionSnapshot { return { giftCards: [], loyalty: { pointsBalance: 0, currentTier: null, nextTier: null, pointsToNextTier: null, enabled: true }, rewardLedger: [], referralCode: null, referrals: [], referredBy: null }; }
  private retentionKey(prefix: string) { return `${prefix}-${globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`}`; }

  private csvValues(value: string) { return value.split(',').map((item) => item.trim()).filter(Boolean); }

  private async saveGrowthAction(request: Observable<ApiEnvelope<any>>, fallback: string) {
    if (!this.selectedClient) return;
    this.savingWorkspace = true;
    this.clientError = '';
    try {
      const result = await firstValueFrom(request);
      if (!result.success) throw new Error(result.error?.message || fallback);
      this.drawerMode = null;
      await this.loadGrowth();
    } catch (error) { this.clientError = this.errorMessage(error, fallback); }
    finally { this.savingWorkspace = false; }
  }

  private nullableBool(value: unknown): boolean | null {
    return typeof value === 'boolean' ? value : null;
  }

  private consentValue(value: boolean | null) {
    return value === true ? 'true' : value === false ? 'false' : '';
  }

  private consentBool(value: string) {
    return value === 'true' ? true : value === 'false' ? false : null;
  }

  private async saveWorkspace(request: Observable<ApiEnvelope<any>>, fallback: string) {
    if (!this.selectedClient) return;
    this.savingWorkspace = true;
    this.clientError = '';
    try {
      const result = await firstValueFrom(request);
      if (!result.success) throw new Error(result?.error?.message || result?.error || fallback);
      this.drawerMode = null;
      await this.refreshClientWorkspace(this.selectedClient.id);
    } catch (error) {
      this.clientError = error instanceof Error ? error.message : fallback;
    } finally {
      this.savingWorkspace = false;
    }
  }

  private errorMessage(error: any, fallback: string) {
    return String(error?.error?.error?.message || error?.error?.message || error?.message || fallback);
  }

  private label(value: unknown) {
    return String(value || '').replace(/[_-]+/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
  }

  private isoDay(value: string) {
    const match = String(value || '').match(/^(\d{4}-\d{2}-\d{2})/);
    return match?.[1] || '';
  }
}
