import { CommonModule } from '@angular/common';
import { Component, inject, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink, RouterLinkActive } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { ApiEnvelope, ApiService } from '../../shared/services/api.service';

type DeskTab = 'overview' | 'catalog' | 'active' | 'lifecycle' | 'family' | 'selfService' | 'autoRenew' | 'reminders' | 'commission' | 'risk' | 'rewards' | 'reports' | 'settings';
type PlanType = 'discount' | 'prepaid_credit' | 'visit_pack' | 'service_credit' | 'combo' | 'unlimited' | 'family' | 'corporate' | 'tiered';
type Membership = { id: string; name: string; code: string; planType: PlanType; pricePaise: number; pointsRequired: number; discountPercent: number; validityDays: number; notes: string; serviceIds: string[]; benefitRules: Record<string, unknown>; active: boolean };
type ActiveMembership = { id: string; clientId: string; clientName: string; membershipId: string; membershipName: string; pricePaise: number; discountPercent: number; sourceSaleId: string; assignedAt: string; expiresAt?: string; active: boolean; status: string; remainingCredits: number; autoRenewEnabled: boolean; autoRenewStatus: string; pendingMembershipId?: string; frozenAt?: string; frozenUntil?: string; freezeReason?: string };
type LifecycleRow = { id: string; clientMembershipId: string; clientName: string; membershipName: string; eventType: string; sourceSaleId: string; reason: string; createdAt: string };
type MembershipWalletCredit = { membershipId: string; membershipName: string; serviceId: string; serviceName: string; totalQty: number; remainingQty: number; expiresAt?: string };
type Membership360Overview = { membership: ActiveMembership; client: { id: string; name: string; phone: string; email: string; walletBalancePaise: number }; wallet: MembershipWalletCredit[]; ledger: LifecycleRow[] };
type RenewalRow = { id: string; clientName: string; membershipName: string; expiresAt: string; daysUntilExpiry: number; autoRenewStatus: string; failureCount: number };
type MembershipReport = { activeMembers: number; expiredMembers: number; cancelledMembers: number; creditLiability: number; membershipSalesPaise: number; redeemedCredits: number; atRiskMembers: number; autoRenewFailed: number; commissionPaise: number };
type PlanChange = { id: string; clientName: string; fromMembershipName: string; targetMembershipName: string; changeType: string; effectiveAt: string; chargePaise: number; creditPaise: number; status: string; createdAt: string };
type FamilyMember = { id: string; clientMembershipId: string; ownerName: string; memberName: string; membershipName: string; relationship: string; createdAt: string };
type SelfServiceRequest = { id: string; clientMembershipId: string; clientName: string; membershipName: string; requestType: string; targetMembershipName: string; reason: string; creditDelta: number; serviceId: string; paymentReference: string; status: string; createdAt: string };
type AutoRenewAttempt = { id: string; clientMembershipId: string; clientName: string; membershipName: string; attemptNumber: number; status: string; errorMessage: string; nextRetryAt?: string; createdAt: string };
type CheckoutIntent = { clientId: string; planId: string; pricePaise: number; referenceId: string };
type StatusLink = { token: string };
type MembershipCard = { token: string; statusPath: string; statusUrl: string; clientName: string; membershipName: string; expiresAt?: string; qrSvg: string };
type Service = { id: string; name: string; active: boolean };
type Client = { id: string; firstName: string; lastName: string; phone: string; active: boolean };
type Reminder = { id: string; clientMembershipId?: string; clientId: string; clientName: string; membershipName: string; reminderType: string; dueOn: string; daysBefore: number; status: string; message: string; approvedBy: string; approvedAt?: string; createdAt: string };
type CommissionEntry = { id: string; invoiceNumber: string; staffName: string; clientName: string; membershipName: string; revenuePaise: number; ratePercent: number; commissionPaise: number; createdAt: string };
type CommissionReport = { metrics: { totalRevenuePaise: number; commissionPaise: number; saleCount: number; staffCount: number }; staff: Array<{ staffId: string; staffName: string; revenuePaise: number; commissionPaise: number; saleCount: number }>; entries: CommissionEntry[] };
type RiskSignal = { id: string; code: string; riskLevel: string; riskScore: number; reason: string; membershipId: string; membershipName: string; clientId: string; clientName: string; reviewStatus: string; reviewedBy: string; reviewNote: string };
type RiskReport = { metrics: { total: number; pending: number; reviewed: number; critical: number; high: number; medium: number; low: number }; signals: RiskSignal[] };
type RewardEntry = { id: string; clientId: string; clientName: string; sourceSaleId: string; transactionType: string; points: number; balanceAfter: number; expiresAt?: string; staffId: string; note: string; createdAt: string };
type RewardsRoi = { metrics: { totalRewardClients: number; totalPointsEarned: number; totalPointsRedeemed: number; rewardUsersRevenuePaise: number; nonRewardUsersRevenuePaise: number } };
type LoyaltyTier = { code: string; name: string; minimumPoints: number | string };
type EnterpriseReport = { metrics: { membershipSalesPaise: number; commissionPaise: number; serviceCostPaise: number; redeemedValuePaise: number; netProfitPaise: number; contributionPaise: number; creditLiability: number }; customerSales: Array<{ clientId: string; clientName: string; saleCount: number; revenuePaise: number }>; redemption: Array<{ clientId: string; clientName: string; membershipName: string; serviceName: string; quantity: number; visitCount: number }>; profitability: Array<{ membershipId: string; membershipName: string; soldCount: number; revenuePaise: number; commissionPaise: number; redeemedCredits: number; redeemedValuePaise: number; serviceCostPaise: number; netProfitPaise: number }> };
type MembershipSettings = {
  membershipCatalog: { membershipSalesEnabled: boolean; visibleInPos: boolean; visibleOnline: boolean; freeMembershipEnabled: boolean; paidMembershipEnabled: boolean };
  creditsBenefits: { serviceCreditsEnabled: boolean; walletCreditsEnabled: boolean; rewardPointsEnabled: boolean; rewardPointsPer100Rupees: number | string; rewardPointValuePaise: number | string; discountBenefitsEnabled: boolean; allowBenefitStacking: boolean };
  renewalExpiry: { autoRenewEnabled: boolean; expiryDaysEnabled: boolean; defaultValidityDays: number; renewalReminderDays: number; expiredBenefitAction: string };
  paymentBilling: { allowDueOnMembershipSale: boolean; membershipTaxApplicable: boolean; taxInclusiveMembershipPrice: boolean; invoiceMembershipSnapshot: boolean };
  redemptionRules: { blockRedemptionWhenExpired: boolean; requireStaffConfirmation: boolean; allowPartialCredits: boolean; allowFamilySharing: boolean };
  crossLocation: { enabled: boolean; acceptInbound: boolean; scope: 'tenant' | 'region' | 'zone' | 'cluster'; allowDiscounts: boolean; allowServiceCredits: boolean };
  notificationsRisk: { renewalReminder: boolean; lowCreditReminder: boolean; ownerAlertForHighBalance: boolean; highBalanceThreshold: number };
  loyaltyTiers: { enabled: boolean; tiers: LoyaltyTier[] };
  referrals: { enabled: boolean; referrerRewardPoints: number | string; referredRewardPoints: number | string };
  defaults: { defaultStatus: string; defaultMembershipType: string };
};

@Component({
    selector: 'page-memberships',
    imports: [CommonModule, FormsModule, RouterLink, RouterLinkActive],
    templateUrl: './memberships-page.component.html',
    styleUrls: ['./memberships-page.component.css']
})
export class MembershipsPageComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly router = inject(Router);

  readonly deskTabs: Array<{ key: DeskTab; label: string }> = [
    { key: 'overview', label: 'Overview' },
    { key: 'catalog', label: 'Plans' },
    { key: 'active', label: 'Active Members' },
    { key: 'lifecycle', label: 'Lifecycle' },
    { key: 'family', label: 'Family' },
    { key: 'selfService', label: 'Self-service' },
    { key: 'autoRenew', label: 'Auto-renew' },
    { key: 'reminders', label: 'Reminders' },
    { key: 'commission', label: 'Commission' },
    { key: 'risk', label: 'Risk' },
    { key: 'rewards', label: 'Rewards' },
    { key: 'reports', label: 'Reports' },
    { key: 'settings', label: 'Settings' },
  ];
  readonly planTypes: Array<{ value: PlanType; label: string }> = [
    { value: 'discount', label: 'Discount' }, { value: 'prepaid_credit', label: 'Prepaid credit' },
    { value: 'visit_pack', label: 'Visit pack' }, { value: 'service_credit', label: 'Service credit' },
    { value: 'combo', label: 'Combo' }, { value: 'unlimited', label: 'Unlimited' },
    { value: 'family', label: 'Family' }, { value: 'corporate', label: 'Corporate' },
    { value: 'tiered', label: 'Tiered' },
  ];

  activeDesk: DeskTab = 'active';
  memberships: Membership[] = [];
  activeMemberships: ActiveMembership[] = [];
  lifecycleRows: LifecycleRow[] = [];
  autoRenewRows: RenewalRow[] = [];
  planChanges: PlanChange[] = [];
  familyMembers: FamilyMember[] = [];
  selfServiceRequests: SelfServiceRequest[] = [];
  autoRenewAttempts: AutoRenewAttempt[] = [];
  reminders: Reminder[] = [];
  reminderDays: string | number = 30;
  commission: CommissionReport = { metrics: { totalRevenuePaise: 0, commissionPaise: 0, saleCount: 0, staffCount: 0 }, staff: [], entries: [] };
  risk: RiskReport = { metrics: { total: 0, pending: 0, reviewed: 0, critical: 0, high: 0, medium: 0, low: 0 }, signals: [] };
  rewardLedger: RewardEntry[] = [];
  rewardRoi: RewardsRoi = { metrics: { totalRewardClients: 0, totalPointsEarned: 0, totalPointsRedeemed: 0, rewardUsersRevenuePaise: 0, nonRewardUsersRevenuePaise: 0 } };
  expiringRewards: Array<{ clientName: string; pointsExpiring: number; expiryDate: string; daysLeft: number }> = [];
  rewardAlerts: Array<{ clientName: string; riskLevel: string; alertType: string }> = [];
  settings = this.defaultSettings();
  report: MembershipReport = { activeMembers: 0, expiredMembers: 0, cancelledMembers: 0, creditLiability: 0, membershipSalesPaise: 0, redeemedCredits: 0, atRiskMembers: 0, autoRenewFailed: 0, commissionPaise: 0 };
  enterpriseReport: EnterpriseReport = this.emptyEnterpriseReport();
  services: Service[] = [];
  clients: Client[] = [];
  selectedMember: ActiveMembership | null = null;
  search = '';
  statusFilter = '';
  loading = true;
  drawerOpen = false;
  sellDrawerOpen = false;
  member360Open = false;
  member360Loading = false;
  member360: Membership360Overview | null = null;
  membershipCard: MembershipCard | null = null;
  workflowDrawer: '' | 'change' | 'family' | 'request' | 'freeze' = '';
  saving = false;
  error = '';
  message = '';
  editingId = '';
  form = this.blankForm();
  sellForm = { clientId: '', planId: '' };
  workflowForm = { targetMembershipId: '', effectiveAt: 'now', memberClientId: '', relationship: '', requestType: 'renew', reason: '', creditDelta: '' as string | number, serviceId: '', paymentReference: '', freezeDays: 30 as string | number, freezeReason: '' };
  selfServiceLink = '';

  ngOnInit() { void this.loadWorkspace(); }

  get filteredMemberships() {
    const query = this.search.trim().toLowerCase();
    return !query ? this.memberships : this.memberships.filter((item) => item.name.toLowerCase().includes(query));
  }

  get filteredActiveMemberships() {
    const query = this.search.trim().toLowerCase();
    return this.activeMemberships.filter((item) => {
      const matchesSearch = !query || `${item.clientName} ${item.membershipName}`.toLowerCase().includes(query);
      return matchesSearch && (!this.statusFilter || item.status === this.statusFilter);
    });
  }

  get dashboardExpiringMembers() {
    return this.activeMemberships
      .map((item) => ({ ...item, daysLeft: this.daysUntil(item.expiresAt) }))
      .filter((item) => item.active && item.daysLeft !== null && item.daysLeft >= 0 && item.daysLeft <= 30)
      .sort((left, right) => Number(left.daysLeft) - Number(right.daysLeft))
      .slice(0, 8);
  }

  get dashboardPlans() {
    return this.memberships
      .map((plan) => ({ ...plan, activeMembers: this.activeMemberships.filter((member) => member.active && member.membershipId === plan.id).length }))
      .sort((left, right) => right.activeMembers - left.activeMembers)
      .slice(0, 8);
  }

  setDesk(tab: DeskTab) { this.activeDesk = tab; this.search = ''; this.statusFilter = ''; }
  selectMember(item: ActiveMembership) { this.selectedMember = item; }
  formatDate(value?: string) { if (!value) return '—'; const date = new Date(value); return Number.isNaN(date.getTime()) ? '—' : new Intl.DateTimeFormat('en-GB').format(date); }
  daysUntil(value?: string) { if (!value) return null; const date = new Date(value); if (Number.isNaN(date.getTime())) return null; return Math.ceil((date.getTime() - Date.now()) / 86400000); }
  daysLeftLabel(value?: string) { const days = this.daysUntil(value); if (days === null) return 'No expiry'; if (days < 0) return 'Expired'; if (days === 0) return 'Today'; return `${days} days`; }
  rupees(paise: number) { return `₹${(Number(paise || 0) / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`; }
  planTypeLabel(value: string) { return this.planTypes.find((item) => item.value === value)?.label || value; }

  openCreate() { this.editingId = ''; this.form = this.blankForm(); this.error = ''; this.drawerOpen = true; }
  openSell() { this.sellForm = { clientId: '', planId: '' }; this.error = ''; this.sellDrawerOpen = true; }
  openPlanChange(effectiveAt = 'now') { if (!this.selectedMember) return; this.workflowForm = { ...this.workflowForm, targetMembershipId: '', effectiveAt, reason: '' }; this.workflowDrawer = 'change'; this.error = ''; }
  openFamily() { if (!this.selectedMember) return; this.workflowForm = { ...this.workflowForm, memberClientId: '', relationship: '' }; this.workflowDrawer = 'family'; this.error = ''; }
  openRequest() { if (!this.selectedMember) return; this.workflowForm = { ...this.workflowForm, requestType: 'renew', targetMembershipId: '', reason: '', creditDelta: '', serviceId: '', paymentReference: '' }; this.workflowDrawer = 'request'; this.error = ''; }
  openFreeze() { if (!this.selectedMember) return; this.workflowForm = { ...this.workflowForm, freezeDays: 30, freezeReason: '' }; this.workflowDrawer = 'freeze'; this.error = ''; }
  async openMembership360(item: ActiveMembership) {
    this.selectMember(item); this.member360Open = true; this.member360Loading = true; this.member360 = null; this.error = '';
    try {
      const result = await firstValueFrom(this.api.get<ApiEnvelope<Membership360Overview>>(`/membership-enterprise/memberships/${item.id}/360`));
      if (!result.success || !result.data) throw new Error(result.error?.message || 'Membership 360 failed to load');
      this.member360 = result.data;
    } catch (error) { this.error = error instanceof Error ? error.message : 'Membership 360 failed to load'; }
    finally { this.member360Loading = false; }
  }
  async openMembershipCard() {
    if (!this.selectedMember) return;
    this.error = '';
    try {
      const origin = encodeURIComponent(location.origin);
      const result = await firstValueFrom(this.api.get<ApiEnvelope<MembershipCard>>(`/membership-enterprise/memberships/${this.selectedMember.id}/card?origin=${origin}`));
      if (!result.success || !result.data) throw new Error(result.error?.message || 'Membership card failed to load');
      this.membershipCard = result.data;
    } catch (error) { this.error = error instanceof Error ? error.message : 'Membership card failed to load'; }
  }
  openEdit(item: Membership) {
    this.editingId = item.id;
    const rules = item.benefitRules || {};
    this.form = { name: item.name, code: item.code || '', planType: item.planType, specialOfferPrice: item.pricePaise ? item.pricePaise / 100 : '', actualPrice: Number(rules['actualPricePaise'] || 0) ? Number(rules['actualPricePaise']) / 100 : '', pointsRequired: item.pointsRequired || '', discountPercent: item.discountPercent || '', validityDays: item.validityDays || '', creditAmount: Number(rules['creditAmount'] || 0) || '', familyLimit: Number(rules['familyLimit'] || 0) || '', gstPercent: Number(rules['gstPercent'] || 0) || '', notes: item.notes, serviceIds: [...item.serviceIds], mobileVisible: rules['mobileVisible'] === true, bookingPageVisible: rules['bookingPageVisible'] === true, birthdayBenefit: rules['birthdayBenefit'] === true, anniversaryBenefit: rules['anniversaryBenefit'] === true, priorityBooking: rules['priorityBooking'] === true, active: item.active };
    this.error = ''; this.drawerOpen = true;
  }
  closeDrawer() { this.drawerOpen = false; this.sellDrawerOpen = false; this.member360Open = false; this.member360 = null; this.membershipCard = null; this.workflowDrawer = ''; }
  toggleService(id: string) { this.form.serviceIds = this.form.serviceIds.includes(id) ? this.form.serviceIds.filter((value) => value !== id) : [...this.form.serviceIds, id]; }
  titleCase(value: string) { return value.split(' ').map((word) => word ? word[0].toUpperCase() + word.slice(1).toLowerCase() : word).join(' '); }

  async save() {
    if (!this.form.name.trim()) { this.error = 'Membership name required'; return; }
    this.saving = true; this.error = '';
    const payload = { name: this.form.name.trim(), code: this.editingId ? this.form.code.trim() : undefined, planType: this.form.planType, pricePaise: Math.round(this.number(this.form.specialOfferPrice) * 100), pointsRequired: this.number(this.form.pointsRequired), discountPercent: this.form.planType === 'discount' ? this.number(this.form.discountPercent) : 0, validityDays: this.number(this.form.validityDays), notes: this.form.notes.trim(), serviceIds: this.form.serviceIds, benefitRules: { actualPricePaise: Math.round(this.number(this.form.actualPrice) * 100), creditAmount: this.number(this.form.creditAmount), familyLimit: this.number(this.form.familyLimit), gstPercent: this.number(this.form.gstPercent), mobileVisible: this.form.mobileVisible, bookingPageVisible: this.form.bookingPageVisible, birthdayBenefit: this.form.birthdayBenefit, anniversaryBenefit: this.form.anniversaryBenefit, priorityBooking: this.form.priorityBooking }, active: this.form.active };
    try {
      const result = this.editingId
        ? await firstValueFrom(this.api.patch<ApiEnvelope<Membership>>(`/memberships/${this.editingId}`, payload))
        : await firstValueFrom(this.api.post<ApiEnvelope<Membership>>('/memberships', payload));
      if (!result.success) throw new Error(result.error?.message || result.error || 'Membership save failed');
      await this.loadMemberships(); this.closeDrawer(); this.message = 'Membership saved';
    } catch (error) { this.error = error instanceof Error ? error.message : 'Membership save failed'; }
    finally { this.saving = false; }
  }

  async prepareSale() {
    if (!this.sellForm.clientId || !this.sellForm.planId) { this.error = 'Client and membership required'; return; }
    this.saving = true; this.error = '';
    try {
      const result = await firstValueFrom(this.api.post<ApiEnvelope<CheckoutIntent>>('/membership-enterprise/sell', this.sellForm));
      if (!result.success) throw new Error(result.error?.message || result.error || 'Unable to prepare membership sale');
      this.closeDrawer();
      this.message = 'Membership checkout prepared in POS';
      await this.navigateCheckout(result.data!);
    } catch (error) { this.error = error instanceof Error ? error.message : 'Unable to prepare membership sale'; }
    finally { this.saving = false; }
  }

  async renewSelected() {
    if (!this.selectedMember) return;
    try {
      const result = await firstValueFrom(this.api.post<ApiEnvelope<CheckoutIntent>>(`/membership-enterprise/memberships/${this.selectedMember.id}/renew`, {}));
      if (!result.success) throw new Error(result.error?.message || result.error || 'Unable to prepare renewal');
      this.message = 'Renewal checkout prepared in POS';
      await this.navigateCheckout(result.data!);
    } catch (error) { this.error = error instanceof Error ? error.message : 'Unable to prepare renewal'; }
  }

  async cancelSelected() {
    if (!this.selectedMember || !confirm(`Cancel ${this.selectedMember.membershipName} for ${this.selectedMember.clientName}?`)) return;
    try {
      await firstValueFrom(this.api.post<ApiEnvelope<unknown>>(`/membership-enterprise/active/${this.selectedMember.id}/cancel`, { reason: 'Cancelled from membership workspace' }));
      this.selectedMember = null;
      await Promise.all([this.loadActiveMemberships(), this.loadLifecycle()]);
      this.message = 'Membership cancelled';
    } catch (error) { this.error = error instanceof Error ? error.message : 'Membership cancel failed'; }
  }

  async submitFreeze() {
    if (!this.selectedMember) return;
    const days = Number(this.workflowForm.freezeDays);
    if (!Number.isInteger(days) || days < 1 || days > 366) { this.error = 'Freeze days must be between 1 and 366'; return; }
    this.saving = true; this.error = '';
    try {
      const result = await firstValueFrom(this.api.post<ApiEnvelope<unknown>>(`/membership-enterprise/active/${this.selectedMember.id}/freeze`, { days, reason: this.workflowForm.freezeReason.trim() }));
      if (!result.success) throw new Error(result.error?.message || 'Membership freeze failed');
      const id = this.selectedMember.id;
      await Promise.all([this.loadActiveMemberships(), this.loadLifecycle()]);
      this.selectedMember = this.activeMemberships.find((item) => item.id === id) || null;
      this.closeDrawer(); this.message = 'Membership frozen';
    } catch (error) { this.error = error instanceof Error ? error.message : 'Membership freeze failed'; }
    finally { this.saving = false; }
  }

  async resumeSelected() {
    if (!this.selectedMember) return;
    this.saving = true; this.error = '';
    try {
      const result = await firstValueFrom(this.api.post<ApiEnvelope<unknown>>(`/membership-enterprise/active/${this.selectedMember.id}/resume`, {}));
      if (!result.success) throw new Error(result.error?.message || 'Membership resume failed');
      const id = this.selectedMember.id;
      await Promise.all([this.loadActiveMemberships(), this.loadLifecycle()]);
      this.selectedMember = this.activeMemberships.find((item) => item.id === id) || null;
      this.message = 'Membership resumed';
    } catch (error) { this.error = error instanceof Error ? error.message : 'Membership resume failed'; }
    finally { this.saving = false; }
  }

  async remove(item: Membership) {
    if (!confirm(`Delete ${item.name}?`)) return;
    try { await firstValueFrom(this.api.delete<ApiEnvelope<unknown>>(`/memberships/${item.id}`)); await this.loadMemberships(); }
    catch { this.error = 'Membership delete failed'; }
  }

  async submitPlanChange() {
    if (!this.selectedMember || !this.workflowForm.targetMembershipId) { this.error = 'Target membership required'; return; }
    this.saving = true; this.error = '';
    try {
      const result = await firstValueFrom(this.api.post<ApiEnvelope<{ change: PlanChange; checkout?: CheckoutIntent }>>(`/membership-enterprise/active/${this.selectedMember.id}/change-plan`, { targetMembershipId: this.workflowForm.targetMembershipId, effectiveAt: this.workflowForm.effectiveAt }));
      if (!result.success || !result.data) throw new Error(result.error?.message || 'Plan change failed');
      await this.loadPlanChanges(); this.closeDrawer();
      if (result.data.checkout) await this.navigateCheckout(result.data.checkout); else this.message = 'Plan change scheduled for renewal';
    } catch (error) { this.error = error instanceof Error ? error.message : 'Plan change failed'; }
    finally { this.saving = false; }
  }

  async submitFamilyMember() {
    if (!this.selectedMember || !this.workflowForm.memberClientId) { this.error = 'Family member required'; return; }
    this.saving = true;
    try {
      const result = await firstValueFrom(this.api.post<ApiEnvelope<FamilyMember>>('/membership-enterprise/family', { clientMembershipId: this.selectedMember.id, memberClientId: this.workflowForm.memberClientId, relationship: this.workflowForm.relationship }));
      if (!result.success) throw new Error(result.error?.message || 'Family member add failed');
      await this.loadFamilyMembers(); this.closeDrawer(); this.message = 'Family member added';
    } catch (error) { this.error = error instanceof Error ? error.message : 'Family member add failed'; }
    finally { this.saving = false; }
  }

  async removeFamilyMember(item: FamilyMember) {
    if (!confirm(`Remove ${item.memberName} from this membership?`)) return;
    try { await firstValueFrom(this.api.delete<ApiEnvelope<unknown>>(`/membership-enterprise/family/${item.id}`)); await this.loadFamilyMembers(); }
    catch { this.error = 'Family member remove failed'; }
  }

  async submitSelfServiceRequest() {
    if (!this.selectedMember) return;
    if (this.workflowForm.requestType === 'credit_adjustment' && (!this.workflowForm.serviceId || Number(this.workflowForm.creditDelta) === 0)) { this.error = 'Service and non-zero credit adjustment required'; return; }
    if (this.workflowForm.requestType === 'payment_method_update' && !this.workflowForm.paymentReference.trim()) { this.error = 'Payment reference required'; return; }
    try {
      const result = await firstValueFrom(this.api.post<ApiEnvelope<SelfServiceRequest>>('/membership-enterprise/self-service', { clientMembershipId: this.selectedMember.id, requestType: this.workflowForm.requestType, targetMembershipId: this.workflowForm.targetMembershipId || null, reason: this.workflowForm.reason, creditDelta: Number(this.workflowForm.creditDelta || 0), serviceId: this.workflowForm.serviceId, paymentReference: this.workflowForm.paymentReference.trim() }));
      if (!result.success) throw new Error(result.error?.message || 'Request create failed');
      await this.loadSelfServiceRequests(); this.closeDrawer(); this.message = 'Self-service request created';
    } catch (error) { this.error = error instanceof Error ? error.message : 'Request create failed'; }
  }

  async resolveRequest(item: SelfServiceRequest, status: 'approved' | 'rejected') {
    try { await firstValueFrom(this.api.patch<ApiEnvelope<unknown>>(`/membership-enterprise/self-service/${item.id}`, { status, note: `${status} from membership workspace` })); await this.loadSelfServiceRequests(); }
    catch { this.error = 'Request update failed'; }
  }

  async updateAutoRenew(status: 'active' | 'paused' | 'disabled') {
    if (!this.selectedMember) return;
    try { await firstValueFrom(this.api.patch<ApiEnvelope<unknown>>(`/membership-enterprise/active/${this.selectedMember.id}/auto-renew/status`, { status })); await Promise.all([this.loadActiveMemberships(), this.loadLifecycle()]); this.message = `Auto-renew ${status}`; }
    catch { this.error = 'Auto-renew update failed'; }
  }

  async retryAutoRenew(item: RenewalRow) {
    try {
      const result = await firstValueFrom(this.api.post<ApiEnvelope<{ attempt: AutoRenewAttempt; checkout: CheckoutIntent }>>(`/membership-enterprise/active/${item.id}/auto-renew/retry`, {}));
      if (!result.success || !result.data) throw new Error(result.error?.message || 'Retry failed');
      await this.navigateCheckout(result.data.checkout);
    } catch (error) { this.error = error instanceof Error ? error.message : 'Retry failed'; }
  }
  async processDueAutoRenewals() {
    this.saving = true; this.error = '';
    try { const result = await firstValueFrom(this.api.post<ApiEnvelope<{ processed: number }>>('/membership-enterprise/auto-renew/process-due', {})); this.message = `${result.data?.processed || 0} auto-renewals processed`; await Promise.all([this.loadAutoRenew(), this.loadAutoRenewAttempts()]); }
    catch (error) { this.error = error instanceof Error ? error.message : 'Auto-renew processing failed'; }
    finally { this.saving = false; }
  }
  async createSelfServiceLink(share = false) {
    if (!this.selectedMember) return;
    this.error = '';
    try {
      const result = await firstValueFrom(this.api.post<ApiEnvelope<StatusLink>>(`/membership-enterprise/client/${this.selectedMember.clientId}/self-service/status-link`, { clientMembershipId: this.selectedMember.id }));
      if (!result.data?.token) throw new Error('Status link could not be created');
      this.selfServiceLink = `${location.origin}/membership-status/${result.data.token}`;
      if (share) {
        const phone = this.clients.find((client) => client.id === this.selectedMember?.clientId)?.phone.replace(/\D/g, '') || '';
        window.open(`https://wa.me/${phone}?text=${encodeURIComponent(`Membership status and renewal: ${this.selfServiceLink}`)}`, '_blank', 'noopener');
      } else {
        await navigator.clipboard.writeText(this.selfServiceLink); this.message = 'Membership link copied';
      }
    } catch (error) { this.error = error instanceof Error ? error.message : 'Status link could not be created'; }
  }

  async generateReminders() {
    this.saving = true; this.error = '';
    try {
      const result = await firstValueFrom(this.api.post<ApiEnvelope<{ count: number }>>('/membership-enterprise/reminders/generate', { days: this.number(this.reminderDays) || 30 }));
      if (!result.success) throw new Error(result.error?.message || 'Reminder generation failed');
      await this.loadReminders(); this.message = `${result.data?.count || 0} reminders queued`;
    } catch (error) { this.error = error instanceof Error ? error.message : 'Reminder generation failed'; }
    finally { this.saving = false; }
  }

  async approveReminder(item: Reminder) {
    try {
      const result = await firstValueFrom(this.api.post<ApiEnvelope<unknown>>(`/membership-enterprise/reminders/${item.id}/approve`, {}));
      if (!result.success) throw new Error(result.error?.message || 'Reminder approval failed');
      await this.loadReminders(); this.message = 'Reminder approved';
    } catch (error) { this.error = error instanceof Error ? error.message : 'Reminder approval failed'; }
  }

  async reviewRisk(item: RiskSignal, reviewStatus: 'reviewed' | 'dismissed') {
    try {
      const result = await firstValueFrom(this.api.post<ApiEnvelope<unknown>>(`/membership-enterprise/risk-signals/${encodeURIComponent(item.id)}/review`, { membershipId: item.membershipId, clientId: item.clientId, riskLevel: item.riskLevel, reviewStatus, note: '' }));
      if (!result.success) throw new Error(result.error?.message || 'Risk review failed');
      await this.loadRisk(); this.message = `Risk ${reviewStatus}`;
    } catch (error) { this.error = error instanceof Error ? error.message : 'Risk review failed'; }
  }

  async saveSettings() {
    this.saving = true; this.error = '';
    try {
      const result = await firstValueFrom(this.api.patch<ApiEnvelope<MembershipSettings>>('/membership-enterprise/settings', this.settings));
      if (!result.success || !result.data) throw new Error(result.error?.message || 'Settings save failed');
      this.settings = result.data; this.message = 'Membership settings saved';
    } catch (error) { this.error = error instanceof Error ? error.message : 'Settings save failed'; }
    finally { this.saving = false; }
  }

  addLoyaltyTier() {
    const index = this.settings.loyaltyTiers.tiers.length + 1;
    this.settings.loyaltyTiers.tiers.push({ code: `tier_${index}`, name: `Tier ${index}`, minimumPoints: '' });
  }

  removeLoyaltyTier(index: number) {
    if (this.settings.loyaltyTiers.tiers.length > 1) this.settings.loyaltyTiers.tiers.splice(index, 1);
  }

  async exportReport(format: 'csv' | 'pdf') {
    try {
      const blob = await firstValueFrom(this.api.getBlob(`/membership-enterprise/reports/export?format=${format}`));
      const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = `membership-report.${format}`; link.click(); URL.revokeObjectURL(url);
    } catch { this.error = 'Report export failed'; }
  }

  async loadWorkspace() {
    this.loading = true; this.error = '';
    await Promise.all([this.loadMemberships(), this.loadActiveMemberships(), this.loadLifecycle(), this.loadAutoRenew(), this.loadPlanChanges(), this.loadFamilyMembers(), this.loadSelfServiceRequests(), this.loadAutoRenewAttempts(), this.loadReminders(), this.loadCommission(), this.loadRisk(), this.loadRewards(), this.loadSettings(), this.loadReport(), this.loadEnterpriseReport(), this.loadServices(), this.loadClients()]);
    this.loading = false;
  }

  async loadMemberships() { try { const result = await firstValueFrom(this.api.get<ApiEnvelope<Membership[]>>('/memberships')); this.memberships = result.success && Array.isArray(result.data) ? result.data.map((item) => ({ ...item, code: item.code || '', planType: item.planType || 'discount', pricePaise: Number(item.pricePaise || 0), serviceIds: Array.isArray(item.serviceIds) ? item.serviceIds : [], benefitRules: item.benefitRules && typeof item.benefitRules === 'object' ? item.benefitRules : {} })) : []; } catch { this.memberships = []; } }
  private async loadActiveMemberships() { try { const result = await firstValueFrom(this.api.get<ApiEnvelope<ActiveMembership[]>>('/membership-enterprise/active')); this.activeMemberships = result.success && Array.isArray(result.data) ? result.data : []; } catch { this.activeMemberships = []; } }
  private async loadLifecycle() { try { const result = await firstValueFrom(this.api.get<ApiEnvelope<LifecycleRow[]>>('/membership-enterprise/ledger?limit=250')); this.lifecycleRows = result.success && Array.isArray(result.data) ? result.data : []; } catch { this.lifecycleRows = []; } }
  private async loadAutoRenew() { try { const result = await firstValueFrom(this.api.get<ApiEnvelope<RenewalRow[]>>('/membership-enterprise/auto-renew/queue?days=30')); this.autoRenewRows = result.success && Array.isArray(result.data) ? result.data : []; } catch { this.autoRenewRows = []; } }
  private async loadPlanChanges() { try { const result = await firstValueFrom(this.api.get<ApiEnvelope<PlanChange[]>>('/membership-enterprise/plan-changes')); this.planChanges = result.success && Array.isArray(result.data) ? result.data : []; } catch { this.planChanges = []; } }
  private async loadFamilyMembers() { try { const result = await firstValueFrom(this.api.get<ApiEnvelope<FamilyMember[]>>('/membership-enterprise/family')); this.familyMembers = result.success && Array.isArray(result.data) ? result.data : []; } catch { this.familyMembers = []; } }
  private async loadSelfServiceRequests() { try { const result = await firstValueFrom(this.api.get<ApiEnvelope<SelfServiceRequest[]>>('/membership-enterprise/self-service')); this.selfServiceRequests = result.success && Array.isArray(result.data) ? result.data : []; } catch { this.selfServiceRequests = []; } }
  private async loadAutoRenewAttempts() { try { const result = await firstValueFrom(this.api.get<ApiEnvelope<AutoRenewAttempt[]>>('/membership-enterprise/auto-renew/attempts')); this.autoRenewAttempts = result.success && Array.isArray(result.data) ? result.data : []; } catch { this.autoRenewAttempts = []; } }
  private async loadReminders() { try { const result = await firstValueFrom(this.api.get<ApiEnvelope<Reminder[]>>('/membership-enterprise/reminders')); this.reminders = result.success && Array.isArray(result.data) ? result.data : []; } catch { this.reminders = []; } }
  private async loadCommission() { try { const result = await firstValueFrom(this.api.get<ApiEnvelope<CommissionReport>>('/membership-enterprise/reports/commission')); if (result.success && result.data) this.commission = result.data; } catch { this.commission = { metrics: { totalRevenuePaise: 0, commissionPaise: 0, saleCount: 0, staffCount: 0 }, staff: [], entries: [] }; } }
  private async loadRisk() { try { const result = await firstValueFrom(this.api.get<ApiEnvelope<RiskReport>>('/membership-enterprise/reports/risk')); if (result.success && result.data) this.risk = result.data; } catch { this.risk = { metrics: { total: 0, pending: 0, reviewed: 0, critical: 0, high: 0, medium: 0, low: 0 }, signals: [] }; } }
  private async loadRewards() { try { const [ledger, roi, expiring, alerts] = await Promise.all([firstValueFrom(this.api.get<ApiEnvelope<RewardEntry[]>>('/membership-enterprise/rewards/ledger')), firstValueFrom(this.api.get<ApiEnvelope<RewardsRoi>>('/membership-enterprise/rewards/roi')), firstValueFrom(this.api.get<ApiEnvelope<Array<{ clientName: string; pointsExpiring: number; expiryDate: string; daysLeft: number }>>>('/membership-enterprise/rewards/expiring?days=30')), firstValueFrom(this.api.get<ApiEnvelope<Array<{ clientName: string; riskLevel: string; alertType: string }>>>('/membership-enterprise/rewards/abuse-alerts'))]); this.rewardLedger = ledger.success && Array.isArray(ledger.data) ? ledger.data : []; if (roi.success && roi.data) this.rewardRoi = roi.data; this.expiringRewards = expiring.success && Array.isArray(expiring.data) ? expiring.data : []; this.rewardAlerts = alerts.success && Array.isArray(alerts.data) ? alerts.data : []; } catch { this.rewardLedger = []; this.expiringRewards = []; this.rewardAlerts = []; } }
  private async loadSettings() { try { const result = await firstValueFrom(this.api.get<ApiEnvelope<MembershipSettings>>('/membership-enterprise/settings')); if (result.success && result.data) this.settings = result.data; } catch { this.settings = this.defaultSettings(); } }
  private async loadReport() { try { const result = await firstValueFrom(this.api.get<ApiEnvelope<MembershipReport>>('/membership-enterprise/reports/lifecycle')); if (result.success && result.data) this.report = result.data; } catch { /* empty report stays truthful */ } }
  private async loadEnterpriseReport() { try { const result = await firstValueFrom(this.api.get<ApiEnvelope<EnterpriseReport>>('/membership-enterprise/reports/enterprise')); if (result.success && result.data) this.enterpriseReport = { ...this.emptyEnterpriseReport(), ...result.data, metrics: { ...this.emptyEnterpriseReport().metrics, ...result.data.metrics }, profitability: Array.isArray(result.data.profitability) ? result.data.profitability : [] }; } catch { this.enterpriseReport = this.emptyEnterpriseReport(); } }
  private emptyEnterpriseReport(): EnterpriseReport { return { metrics: { membershipSalesPaise: 0, commissionPaise: 0, serviceCostPaise: 0, redeemedValuePaise: 0, netProfitPaise: 0, contributionPaise: 0, creditLiability: 0 }, customerSales: [], redemption: [], profitability: [] }; }
  private async loadServices() { try { const result = await firstValueFrom(this.api.get<ApiEnvelope<Service[]>>('/services')); this.services = result.success && Array.isArray(result.data) ? result.data.filter((item) => item.active !== false) : []; } catch { this.services = []; } }
  private async loadClients() { try { const result = await firstValueFrom(this.api.get<ApiEnvelope<Client[]>>('/clients?pageSize=500')); this.clients = result.success && Array.isArray(result.data) ? result.data.filter((item) => item.active !== false) : []; } catch { this.clients = []; } }
  private blankForm() { return { name: '', code: '', planType: 'discount' as PlanType, specialOfferPrice: '' as string | number, actualPrice: '' as string | number, pointsRequired: '' as string | number, discountPercent: '' as string | number, validityDays: '' as string | number, creditAmount: '' as string | number, familyLimit: '' as string | number, gstPercent: '' as string | number, notes: '', serviceIds: [] as string[], mobileVisible: false, bookingPageVisible: false, birthdayBenefit: false, anniversaryBenefit: false, priorityBooking: false, active: true }; }
  private defaultSettings(): MembershipSettings { return { membershipCatalog: { membershipSalesEnabled: true, visibleInPos: true, visibleOnline: true, freeMembershipEnabled: true, paidMembershipEnabled: true }, creditsBenefits: { serviceCreditsEnabled: true, walletCreditsEnabled: true, rewardPointsEnabled: true, rewardPointsPer100Rupees: '', rewardPointValuePaise: 100, discountBenefitsEnabled: true, allowBenefitStacking: false }, renewalExpiry: { autoRenewEnabled: false, expiryDaysEnabled: true, defaultValidityDays: 365, renewalReminderDays: 30, expiredBenefitAction: 'block' }, paymentBilling: { allowDueOnMembershipSale: true, membershipTaxApplicable: true, taxInclusiveMembershipPrice: false, invoiceMembershipSnapshot: true }, redemptionRules: { blockRedemptionWhenExpired: true, requireStaffConfirmation: true, allowPartialCredits: true, allowFamilySharing: true }, crossLocation: { enabled: false, acceptInbound: false, scope: 'tenant', allowDiscounts: true, allowServiceCredits: true }, notificationsRisk: { renewalReminder: true, lowCreditReminder: true, ownerAlertForHighBalance: true, highBalanceThreshold: 1000000 }, loyaltyTiers: { enabled: true, tiers: [{ code: 'bronze', name: 'Bronze', minimumPoints: 0 }, { code: 'silver', name: 'Silver', minimumPoints: 1000 }, { code: 'gold', name: 'Gold', minimumPoints: 5000 }] }, referrals: { enabled: true, referrerRewardPoints: 100, referredRewardPoints: 50 }, defaults: { defaultStatus: 'active', defaultMembershipType: 'paid' } }; }
  private navigateCheckout(intent: CheckoutIntent) { return this.router.navigate(['/pos'], { queryParams: { clientId: intent.clientId, membershipId: intent.planId, unitPricePaise: intent.pricePaise, reference: intent.referenceId || null } }); }
  private number(value: string | number) { return Math.max(0, Number(value) || 0); }
}
