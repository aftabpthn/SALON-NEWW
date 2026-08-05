import { CommonModule } from '@angular/common';
import { Component, OnInit, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { AuthService } from '../../../core/services/auth.service';
import { DatePickerComponent } from '../../../shared/date-picker/date-picker.component';
import { ApiEnvelope, ApiService } from '../../../shared/services/api.service';

type Tab = 'overview' | 'reports' | 'salons' | 'admins' | 'plans' | 'subscriptions' | 'billing' | 'usage' | 'support' | 'sla';
type Overview = { activePlans: number; activeSubscriptions: number; pastDueSubscriptions: number; outstandingPaise: number; openTickets: number; breachedTickets: number };
type SaasReport = { periodDays: number; periodStart: string; periodEnd: string; mrrPaise: number; arrPaise: number; trialEligible: number; trialConverted: number; trialConversionPercent: number; churnedSubscriptions: number; churnRatePercent: number; renewalRiskCount: number; renewalRiskMrrPaise: number; outstandingInvoiceCount: number; outstandingPaise: number; usageOverageRevenuePaise: number; supportTickets: number; averageFirstResponseMinutes: number; averageResolutionMinutes: number; slaBreachedTickets: number; slaBreachPercent: number; renewalRisk: Array<{ subscriptionId: string; tenantId: string; tenantName: string; planName: string; status: string; periodEnd: string; outstandingPaise: number; mrrPaise: number; riskLevel: string; reason: string }>; supportAgents: Array<{ agentId: string; assignedTickets: number; resolvedTickets: number; averageFirstResponseMinutes: number; averageResolutionMinutes: number; slaBreachPercent: number; csatAverage: number }> };
type Sla = { severity: string; firstResponseMinutes: number; resolutionMinutes: number; businessHoursOnly: boolean };
type Plan = { id: string; code: string; name: string; billingInterval: string; basePricePaise: number; includedBranches: number; includedUsers: number; includedAppointments: number; overageBranchPaise: number; overageUserPaise: number; overageAppointmentPaise: number; features: string[]; active: boolean; version: number; sla: Sla[]; activeSubscriptions: number };
type Tenant = { id: string; name: string; slug: string; status: string; businessType?: string; gracePeriodEndsAt?: string; lifecycleReason?: string; lifecycleVersion?: number; branchCount: number; subBranchCount: number; centralBranchName: string; activeUserCount: number; ownerCount: number; adminCount: number; branchAdminCount: number; staffCount: number; subscriptionStatus: string; subscriptionPlan: string; subscriptionPeriodEnd?: string };
type Subscription = { id: string; tenantId: string; tenantName: string; planId: string; planName: string; status: string; currentPeriodStart: string; currentPeriodEnd: string; trialEndsAt?: string; cancelAtPeriodEnd: boolean; provider: string; providerCustomerRef: string; providerSubscriptionRef: string; providerStatus: string; checkoutUrl: string; pendingPlanId?: string; pendingPlanEffective: string; version: number };
type Usage = { branchCount: number; activeUserCount: number; appointmentCount: number; apiCalls: number; messages: number; storageMb: number; providerCostPaise?: number; communicationCostPaise?: number; quotaOveragePaise?: number };
type UsageRow = { subscription: Subscription; usage: Usage };
type ProviderPayment = { id: string; provider: string; providerPaymentRef: string; amountPaise: number; status: string; reconciliationStatus: string; refundedPaise: number };
type Invoice = { id: string; tenantId: string; tenantName: string; subscriptionId: string; planName: string; invoiceNumber: string; periodStart: string; periodEnd: string; baseAmountPaise: number; usageAmountPaise: number; taxAmountPaise: number; totalPaise: number; paidPaise: number; status: string; dueAt: string; issuedAt: string; paidAt?: string; providerPayments: ProviderPayment[]; creditNotes: Array<{ id: string; creditNoteNumber: string; amountPaise: number; reason: string; issuedAt: string }> };
type Ticket = { id: string; tenantId: string; tenantName?: string; branchId: string; ticketNumber: string; subject: string; category: string; severity: string; priority: string; status: string; source: string; requesterEmail?: string; queueKey: string; escalationLevel: number; reopenedCount: number; csatRequestedAt?: string; csat?: { rating: number; comment: string; submittedAt: string }; firstResponseDueAt?: string; resolutionDueAt?: string; firstRespondedAt?: string; resolvedAt?: string; assignedTo?: string; responseBreached?: boolean; resolutionBreached?: boolean; createdAt: string; updatedAt: string };
type TicketAttachment = { id: string; fileName: string; contentType: string; sizeBytes: number };
type DraftAttachment = { fileName: string; contentType: string; dataBase64: string; sizeBytes: number };
type Message = { id: string; authorId: string; authorType: string; visibility: string; body: string; source: string; senderEmail?: string; attachments: TicketAttachment[]; createdAt: string };
type TicketDetail = { ticket: Ticket; messages: Message[]; events: Array<{ id: string; eventType: string; fromStatus: string; toStatus: string; actorId: string; createdAt: string }> };
type TenantContext = { subscription?: Subscription; usage?: Usage; invoices: Invoice[]; tickets: Ticket[]; plans: Plan[] };
/** A coupon the API confirmed. The discount fields are labels — Razorpay charges the amount. */
type AppliedCoupon = { code: string; description: string; discountHintBps?: number | null; discountHintPaise?: number | null };
type TenantAdmin = { id: string; fullName: string; loginId: string; email: string; active: boolean; mustChangePassword: boolean; branchCount: number; createdAt: string };
type TenantControl = {
  tenant: { id: string; name: string; status: string; businessType: string; gracePeriodEndsAt?: string; lifecycleReason: string; lifecycleVersion: number };
  locations: Array<{ id: string; name: string; code: string; timeZone: string; currencyCode: string }>;
  featureOverrides: Array<{ featureKey: string; enabled: boolean; expiresAt?: string; reason: string; version: number }>;
  usageQuotas: Array<{ id: string; subscriptionId: string; metric: string; includedQuantity: number; hardLimitQuantity?: number; overageUnitPaise: number; version: number }>;
};

@Component({
    selector: 'page-saas-admin', imports: [CommonModule, FormsModule, DatePickerComponent],
    templateUrl: './saas-admin-page.component.html', styleUrls: ['./saas-admin-page.component.css']
})
export class SaasAdminPageComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly auth = inject(AuthService);
  readonly isPlatform = this.auth.hasRole('superadmin', 'super-admin');
  readonly isOwner = this.auth.hasRole('owner');
  readonly platformTabs: Array<{ key: Tab; label: string }> = [
    { key: 'overview', label: 'Overview' }, { key: 'reports', label: 'Reports' }, { key: 'salons', label: 'Salons' }, { key: 'plans', label: 'Plans' }, { key: 'subscriptions', label: 'Subscriptions' },
    { key: 'billing', label: 'Billing' }, { key: 'usage', label: 'Usage' }, { key: 'support', label: 'Support' }, { key: 'sla', label: 'SLA' },
  ];
  readonly tenantTabs: Array<{ key: Tab; label: string }> = [
    { key: 'overview', label: 'Overview' }, { key: 'admins', label: 'Tenant Admins' }, { key: 'billing', label: 'Billing' }, { key: 'usage', label: 'Usage' }, { key: 'support', label: 'Support' },
  ];
  readonly statuses = ['pending', 'trialing', 'active', 'past_due', 'paused', 'cancelled'];
  readonly ticketStatuses = ['open', 'in_progress', 'waiting_customer', 'resolved', 'closed'];
  tab: Tab = 'overview'; loading = true; busy = false; error = ''; message = ''; search = ''; queueFilter = '';
  overview: Overview = { activePlans: 0, activeSubscriptions: 0, pastDueSubscriptions: 0, outstandingPaise: 0, openTickets: 0, breachedTickets: 0 };
  reportDays = 30; report: SaasReport = this.emptyReport();
  plans: Plan[] = []; tenants: Tenant[] = []; tenantAdmins: TenantAdmin[] = []; subscriptions: Subscription[] = []; usageRows: UsageRow[] = []; invoices: Invoice[] = []; tickets: Ticket[] = [];
  tenantSubscription?: Subscription; tenantUsage?: Usage; ticketDetail?: TicketDetail;
  drawer: 'onboarding' | 'tenantAdmin' | 'tenantControl' | 'plan' | 'subscription' | 'invoice' | 'billingRun' | 'payment' | 'refund' | 'ticket' | 'ticketDetail' | '' = '';
  editingPlanId = ''; editingSubscriptionId = ''; selectedInvoice?: Invoice; selectedProviderPayment?: ProviderPayment;
  planDraft = this.emptyPlan(); subscriptionDraft = this.emptySubscription(); invoiceDraft = { subscriptionId: '', taxPercent: '', dueDays: '7' };
  billingRunDraft = { taxPercent: '', dueDays: '7' };
  paymentDraft = { amountRupees: '', paymentMethod: 'bank', reference: '' };
  refundDraft = { amountRupees: '', reason: '' };
  checkoutPlanId = ''; planChangeId = ''; planChangeEffective = 'cycle_end';
  readonly billingIntervals = ['monthly', 'annual'] as const;
  checkoutInterval: 'monthly' | 'annual' = 'monthly';
  couponCode = ''; couponError = ''; appliedCoupon?: AppliedCoupon;
  ticketDraft: { subject: string; category: string; severity: string; priority: string; message: string; attachments: DraftAttachment[] } = this.emptyTicket();
  onboardingDraft = this.emptyOnboarding();
  tenantAdminDraft = { fullName: '', loginId: '', email: '', initialPassword: '' };
  replyDraft: { body: string; visibility: string; attachments: DraftAttachment[] } = this.emptyReply();
  ticketUpdate = { status: 'open', priority: 'normal', assignedTo: '' };
  ticketAction = { action: 'duplicate', targetTicketId: '', reason: '' };
  csatDraft = { rating: '', comment: '' };
  selectedTenant?: Tenant;
  tenantControl?: TenantControl;
  lifecycleDraft = { status: 'active', graceDate: '', graceTime: '23:59', reason: '' };
  featureDraft = { key: '', enabled: true, expiresDate: '', expiresTime: '23:59', reason: '' };
  quotaDraft = { subscriptionId: '', metric: 'api_calls', includedQuantity: '', hardLimitQuantity: '', overageRupees: '' };
  readonly usageMetrics = ['api_calls', 'messages', 'storage_mb', 'provider_units', 'sms', 'whatsapp', 'email', 'ai_tokens', 'custom'];

  get tabs() { return this.isPlatform ? this.platformTabs : this.tenantTabs; }
  get filteredTenants() { const q=this.search.trim().toLowerCase(); return this.tenants.filter((row)=>!q||[row.name,row.slug,row.subscriptionStatus,row.subscriptionPlan].join(' ').toLowerCase().includes(q)); }
  get filteredPlans() { const q=this.search.trim().toLowerCase(); return this.plans.filter((row)=>!q||`${row.code} ${row.name}`.toLowerCase().includes(q)); }
  get filteredSubscriptions() { const q=this.search.trim().toLowerCase(); return this.subscriptions.filter((row)=>!q||`${row.tenantName} ${row.planName} ${row.status}`.toLowerCase().includes(q)); }
  get filteredInvoices() { const q=this.search.trim().toLowerCase(); return this.invoices.filter((row)=>!q||`${row.invoiceNumber} ${row.tenantName} ${row.status}`.toLowerCase().includes(q)); }
  get filteredTickets() { const q=this.search.trim().toLowerCase(); return this.tickets.filter((row)=>(!this.queueFilter||row.queueKey===this.queueFilter)&&(!q||`${row.ticketNumber} ${row.subject} ${row.tenantName || ''} ${row.assignedTo || ''}`.toLowerCase().includes(q))); }
  get queueOptions() { return [...new Set(this.tickets.map((row)=>row.queueKey).filter(Boolean))].sort(); }
  get mergeTargets() { return this.tickets.filter((row)=>row.id!==this.ticketDetail?.ticket.id&&row.tenantId===this.ticketDetail?.ticket.tenantId); }

  async ngOnInit() { await this.reload(); }
  selectTab(tab: Tab) { this.tab = tab; this.search = ''; }
  async reload() {
    this.loading = true; this.error = '';
    try { if (this.isPlatform) await this.loadPlatform(); else await this.loadTenant(); }
    catch (error) { this.error = this.errorMessage(error, 'SaaS data could not be loaded'); }
    finally { this.loading = false; }
  }
  private async loadPlatform() {
    const [overview, report, plans, tenants, subscriptions, usage, invoices, tickets] = await Promise.all([
      this.get<Overview>('/platform/saas/overview'), this.get<SaasReport>(`/platform/saas/reports?days=${this.reportDays}`), this.get<Plan[]>('/platform/saas/plans?includeInactive=true'), this.get<Tenant[]>('/platform/saas/tenants'),
      this.get<Subscription[]>('/platform/saas/subscriptions'), this.get<UsageRow[]>('/platform/saas/usage'), this.get<Invoice[]>('/platform/saas/invoices'), this.get<Ticket[]>('/platform/saas/tickets'),
    ]);
    this.overview=overview; this.report=report; this.plans=plans; this.tenants=tenants; this.subscriptions=subscriptions; this.usageRows=usage; this.invoices=invoices; this.tickets=tickets;
  }
  private async loadTenant() {
    const [data, admins]=await Promise.all([this.get<TenantContext>('/saas/context'),this.get<TenantAdmin[]>('/saas/admins')]); this.tenantAdmins=admins; this.tenantSubscription=data.subscription; this.tenantUsage=data.usage; this.invoices=data.invoices||[]; this.tickets=data.tickets||[]; this.plans=data.plans||[];
    this.overview={activePlans:this.tenantSubscription?1:0,activeSubscriptions:this.tenantSubscription&&['trialing','active'].includes(this.tenantSubscription.status)?1:0,pastDueSubscriptions:this.tenantSubscription?.status==='past_due'?1:0,outstandingPaise:this.invoices.reduce((sum,row)=>sum+Math.max(row.totalPaise-row.paidPaise,0),0),openTickets:this.tickets.filter((row)=>!['resolved','closed'].includes(row.status)).length,breachedTickets:this.tickets.filter((row)=>row.resolutionBreached).length};
  }
  async reloadReport() { await this.run(async()=>{this.report=await this.get<SaasReport>(`/platform/saas/reports?days=${this.reportDays}`);},'SaaS reports could not be loaded'); }

  async openTenantControl(tenant: Tenant) {
    this.selectedTenant=tenant;
    await this.run(async()=>{
      this.tenantControl=await this.get<TenantControl>(`/platform/saas/tenants/${tenant.id}/control-plane`);
      this.lifecycleDraft={status:this.tenantControl.tenant.status,graceDate:this.tenantControl.tenant.gracePeriodEndsAt?.slice(0,10)||'',graceTime:'23:59',reason:''};
      this.featureDraft={key:'',enabled:true,expiresDate:'',expiresTime:'23:59',reason:''};
      this.quotaDraft={subscriptionId:this.subscriptions.find((row)=>row.tenantId===tenant.id)?.id||'',metric:'api_calls',includedQuantity:'',hardLimitQuantity:'',overageRupees:''};
      this.drawer='tenantControl';
    },'Tenant control plane could not be loaded');
  }

  async saveTenantLifecycle() {
    if(!this.selectedTenant||!this.tenantControl)return;
    const gracePeriodEndsAt=this.lifecycleDraft.status==='grace'&&this.lifecycleDraft.graceDate?new Date(`${this.lifecycleDraft.graceDate}T${this.lifecycleDraft.graceTime||'23:59'}:00`).toISOString():null;
    await this.saveTenantControl(()=>this.patch<TenantControl>(`/platform/saas/tenants/${this.selectedTenant!.id}/lifecycle`,{status:this.lifecycleDraft.status,gracePeriodEndsAt,reason:this.lifecycleDraft.reason,expectedVersion:this.tenantControl!.tenant.lifecycleVersion}),'Tenant lifecycle saved');
  }

  async saveTenantFeature() {
    if(!this.selectedTenant||!this.tenantControl)return;
    const current=this.tenantControl.featureOverrides.find((row)=>row.featureKey===this.featureDraft.key);
    const expiresAt=this.featureDraft.expiresDate?new Date(`${this.featureDraft.expiresDate}T${this.featureDraft.expiresTime||'23:59'}:00`).toISOString():null;
    await this.saveTenantControl(()=>this.put<TenantControl>(`/platform/saas/tenants/${this.selectedTenant!.id}/features/${encodeURIComponent(this.featureDraft.key)}`,{enabled:this.featureDraft.enabled,expiresAt,reason:this.featureDraft.reason,expectedVersion:current?.version||0}),'Feature override saved');
  }

  editTenantFeature(row:{featureKey:string;enabled:boolean;expiresAt?:string;reason:string}) { this.featureDraft={key:row.featureKey,enabled:row.enabled,expiresDate:row.expiresAt?.slice(0,10)||'',expiresTime:'23:59',reason:''}; }

  async saveTenantQuota() {
    if(!this.selectedTenant||!this.tenantControl)return;
    const current=this.tenantControl.usageQuotas.find((row)=>row.subscriptionId===this.quotaDraft.subscriptionId&&row.metric===this.quotaDraft.metric);
    await this.saveTenantControl(()=>this.put<TenantControl>(`/platform/saas/tenants/${this.selectedTenant!.id}/usage-quotas`,{subscriptionId:this.quotaDraft.subscriptionId,metric:this.quotaDraft.metric,includedQuantity:Number(this.quotaDraft.includedQuantity),hardLimitQuantity:this.quotaDraft.hardLimitQuantity===''?null:Number(this.quotaDraft.hardLimitQuantity),overageUnitPaise:this.toPaise(this.quotaDraft.overageRupees),expectedVersion:current?.version||0}),'Usage quota saved');
  }

  editTenantQuota(row:{subscriptionId:string;metric:string;includedQuantity:number;hardLimitQuantity?:number;overageUnitPaise:number}) { this.quotaDraft={subscriptionId:row.subscriptionId,metric:row.metric,includedQuantity:String(row.includedQuantity),hardLimitQuantity:row.hardLimitQuantity==null?'':String(row.hardLimitQuantity),overageRupees:String(row.overageUnitPaise/100)}; }

  private async saveTenantControl(action:()=>Promise<TenantControl>,success:string) { await this.run(async()=>{this.tenantControl=await action();if(this.selectedTenant){this.selectedTenant.status=this.tenantControl.tenant.status;this.selectedTenant.businessType=this.tenantControl.tenant.businessType;this.selectedTenant.gracePeriodEndsAt=this.tenantControl.tenant.gracePeriodEndsAt;this.selectedTenant.lifecycleVersion=this.tenantControl.tenant.lifecycleVersion;}this.message=success;},success+' failed'); }

  openOnboarding() { this.onboardingDraft=this.emptyOnboarding(); this.drawer='onboarding'; }
  async onboardSalon() { await this.mutate(this.api.post('/saas/onboarding',{...this.onboardingDraft,idempotencyKey:crypto.randomUUID(),domain:this.onboardingDraft.domain||undefined}),'Salon and initial Owner created'); }
  openTenantAdmin() { this.tenantAdminDraft={fullName:'',loginId:'',email:'',initialPassword:''}; this.drawer='tenantAdmin'; }
  async createTenantAdmin() { await this.mutate(this.api.post('/saas/admins',this.tenantAdminDraft),'Tenant Admin created'); }

  openPlan(plan?: Plan) { this.editingPlanId=plan?.id||''; this.planDraft=plan?this.planFrom(plan):this.emptyPlan(); this.drawer='plan'; }
  async savePlan() {
    const payload={version:this.editingPlanId?Number(this.planDraft.version):undefined,code:this.planDraft.code,name:this.planDraft.name,billingInterval:this.planDraft.billingInterval,basePricePaise:this.toPaise(this.planDraft.basePriceRupees),includedBranches:Number(this.planDraft.includedBranches),includedUsers:Number(this.planDraft.includedUsers),includedAppointments:Number(this.planDraft.includedAppointments),overageBranchPaise:this.toPaise(this.planDraft.overageBranchRupees),overageUserPaise:this.toPaise(this.planDraft.overageUserRupees),overageAppointmentPaise:this.toPaise(this.planDraft.overageAppointmentRupees),features:this.planDraft.features.split('\n').map((v)=>v.trim()).filter(Boolean),active:this.planDraft.active,sla:this.planDraft.sla.map((row)=>({severity:row.severity,firstResponseMinutes:Number(row.firstResponseMinutes),resolutionMinutes:Number(row.resolutionMinutes),businessHoursOnly:row.businessHoursOnly}))};
    await this.mutate(this.editingPlanId?this.api.patch(`/platform/saas/plans/${this.editingPlanId}`,payload):this.api.post('/platform/saas/plans',payload),'Plan saved');
  }
  openSubscription(row?: Subscription) { this.editingSubscriptionId=row?.id||''; this.subscriptionDraft=row?{tenantId:row.tenantId,planId:row.planId,status:row.status,startsDate:'',startsTime:'09:00',trialDate:'',trialTime:'09:00',provider:row.provider,providerCustomerRef:row.providerCustomerRef,providerSubscriptionRef:row.providerSubscriptionRef,cancelAtPeriodEnd:row.cancelAtPeriodEnd,version:String(row.version)}:this.emptySubscription(); this.drawer='subscription'; }
  async saveSubscription() {
    const startsAt=this.subscriptionDraft.startsDate?new Date(`${this.subscriptionDraft.startsDate}T${this.subscriptionDraft.startsTime||'09:00'}:00`).toISOString():undefined; const trialEndsAt=this.subscriptionDraft.trialDate?new Date(`${this.subscriptionDraft.trialDate}T${this.subscriptionDraft.trialTime||'09:00'}:00`).toISOString():undefined;
    const payload=this.editingSubscriptionId?{version:Number(this.subscriptionDraft.version),planId:this.subscriptionDraft.planId,status:this.subscriptionDraft.status,cancelAtPeriodEnd:this.subscriptionDraft.cancelAtPeriodEnd}:{tenantId:this.subscriptionDraft.tenantId,planId:this.subscriptionDraft.planId,status:this.subscriptionDraft.status,startsAt,trialEndsAt,provider:this.subscriptionDraft.provider,providerCustomerRef:this.subscriptionDraft.providerCustomerRef,providerSubscriptionRef:this.subscriptionDraft.providerSubscriptionRef};
    await this.mutate(this.editingSubscriptionId?this.api.patch(`/platform/saas/subscriptions/${this.editingSubscriptionId}`,payload):this.api.post('/platform/saas/subscriptions',payload),'Subscription saved');
  }
  openInvoice(subscription?: Subscription) { this.invoiceDraft={subscriptionId:subscription?.id||'',taxPercent:'',dueDays:'7'}; this.drawer='invoice'; }
  async issueInvoice() { await this.mutate(this.api.post('/platform/saas/invoices/issue',{subscriptionId:this.invoiceDraft.subscriptionId,taxBps:Math.round(Number(this.invoiceDraft.taxPercent||0)*100),dueDays:Number(this.invoiceDraft.dueDays)}),'Invoice issued'); }
  openBillingRun() { this.billingRunDraft={taxPercent:'',dueDays:'7'}; this.drawer='billingRun'; }
  async runBilling() { await this.mutate(this.api.post('/platform/saas/invoices/run',{taxBps:Math.round(Number(this.billingRunDraft.taxPercent||0)*100),dueDays:Number(this.billingRunDraft.dueDays)}),'Due billing completed'); }
  openPayment(invoice: Invoice) { this.selectedInvoice=invoice; this.paymentDraft={amountRupees:'',paymentMethod:'bank',reference:''}; this.drawer='payment'; }
  async recordPayment() { if(!this.selectedInvoice)return; await this.mutate(this.api.post(`/platform/saas/invoices/${this.selectedInvoice.id}/payments`,{amountPaise:this.toPaise(this.paymentDraft.amountRupees),paymentMethod:this.paymentDraft.paymentMethod,reference:this.paymentDraft.reference,idempotencyKey:crypto.randomUUID()}),'Payment recorded'); }
  /** Plans on the selected billing interval. Plans with no interval set stay visible. */
  get checkoutPlans() { return this.plans.filter((plan)=>!plan.billingInterval||plan.billingInterval===this.checkoutInterval); }
  /** The toggle only earns its space when there is something to switch between. */
  get hasBothIntervals() { return this.billingIntervals.every((interval)=>this.plans.some((plan)=>plan.active&&plan.billingInterval===interval)); }
  /**
   * What annual saves against twelve months of the cheapest monthly plan.
   *
   * Rounded down, and only shown when it is a real saving, so the badge never
   * promises more than the plans deliver.
   */
  get annualSavingPercent() {
    const cheapest=(interval:string)=>this.plans.filter((plan)=>plan.active&&plan.billingInterval===interval&&plan.basePricePaise>0).map((plan)=>plan.basePricePaise).sort((a,b)=>a-b)[0];
    const monthly=cheapest('monthly'); const annual=cheapest('annual');
    if(!monthly||!annual)return 0;
    const yearOfMonthly=monthly*12;
    if(annual>=yearOfMonthly)return 0;
    return Math.floor(((yearOfMonthly-annual)/yearOfMonthly)*100);
  }
  selectInterval(interval:'monthly'|'annual') {
    if(this.checkoutInterval===interval)return;
    this.checkoutInterval=interval;
    // The chosen plan and any applied coupon belong to the old interval; a
    // coupon may be restricted to plans that are no longer on screen.
    this.checkoutPlanId=''; this.removeCoupon();
  }
  /** A typed-over code is no longer the one the API confirmed. */
  clearCoupon() { if(this.appliedCoupon){this.appliedCoupon=undefined;} this.couponError=''; }
  removeCoupon() { this.appliedCoupon=undefined; this.couponCode=''; this.couponError=''; }
  async applyCoupon() {
    const code=this.couponCode.trim();
    if(!code||!this.checkoutPlanId)return;
    this.couponError='';
    try {
      this.appliedCoupon=await this.post<AppliedCoupon>('/saas/subscriptions/coupon-preview',{planId:this.checkoutPlanId,couponCode:code});
    } catch(error) {
      this.appliedCoupon=undefined;
      this.couponError=this.errorMessage(error,'Coupon code is not valid');
    }
  }
  /** Label only. Never used to compute a payable amount — Razorpay does that. */
  get couponDiscountLabel() {
    const coupon=this.appliedCoupon;
    if(!coupon)return '';
    if(coupon.discountHintBps)return `${coupon.discountHintBps/100}% off`;
    if(coupon.discountHintPaise)return `${this.money(coupon.discountHintPaise)} off`;
    return '';
  }
  async startCheckout() {
    if(!this.checkoutPlanId)return;
    // Only a confirmed code is sent. Passing raw text would let a typo fail the
    // checkout at the provider instead of at the Apply button.
    const couponCode=this.appliedCoupon?.code;
    await this.run(async()=>{const result=await this.post<{checkoutUrl:string}>('/saas/subscriptions/checkout',{planId:this.checkoutPlanId,idempotencyKey:crypto.randomUUID(),...(couponCode?{couponCode}:{})});if(!result.checkoutUrl)throw new Error('Checkout URL missing');window.location.assign(result.checkoutUrl);},'Razorpay checkout could not be created');
  }
  continueCheckout() { if(this.tenantSubscription?.checkoutUrl)window.location.assign(this.tenantSubscription.checkoutUrl); }
  async runSubscriptionAction(action:'pause'|'resume'|'cancel',cancelAtCycleEnd=false) {
    if(!this.tenantSubscription||!window.confirm(`${this.label(action)} this subscription?`))return;
    await this.run(async()=>{await this.post(`/saas/subscriptions/${this.tenantSubscription!.id}/actions`,{action,cancelAtCycleEnd});this.message='Subscription updated';await this.reload();},'Subscription action failed');
  }
  async changePlan() {
    if(!this.tenantSubscription||!this.planChangeId)return;
    await this.run(async()=>{await this.post(`/saas/subscriptions/${this.tenantSubscription!.id}/change-plan`,{planId:this.planChangeId,effective:this.planChangeEffective});this.message='Plan change scheduled';this.planChangeId='';await this.reload();},'Plan change failed');
  }
  openRefund(invoice:Invoice,payment:ProviderPayment) { this.selectedInvoice=invoice;this.selectedProviderPayment=payment;this.refundDraft={amountRupees:'',reason:''};this.drawer='refund'; }
  async refundPayment() { if(!this.selectedProviderPayment)return;await this.mutate(this.api.post(`/platform/saas/provider-payments/${this.selectedProviderPayment.id}/refunds`,{amountPaise:this.toPaise(this.refundDraft.amountRupees),reason:this.refundDraft.reason,idempotencyKey:crypto.randomUUID()}),'Refund and credit note created'); }
  openTicket() { this.ticketDraft=this.emptyTicket(); this.drawer='ticket'; }
  async createTicket() { await this.mutate(this.api.post('/saas/tickets',this.ticketDraft),'Support ticket created'); }
  async openTicketDetail(ticket: Ticket) { await this.run(async()=>{this.ticketDetail=await this.get<TicketDetail>(this.isPlatform?`/platform/saas/tickets/${ticket.id}`:`/saas/tickets/${ticket.id}`);this.ticketUpdate={status:this.ticketDetail.ticket.status,priority:this.ticketDetail.ticket.priority,assignedTo:this.ticketDetail.ticket.assignedTo||''};this.replyDraft=this.emptyReply();this.ticketAction={action:'duplicate',targetTicketId:'',reason:''};this.csatDraft={rating:'',comment:''};this.drawer='ticketDetail';},'Support ticket could not be loaded'); }
  async reply() { if(!this.ticketDetail)return; const path=this.isPlatform?`/platform/saas/tickets/${this.ticketDetail.ticket.id}/messages`:`/saas/tickets/${this.ticketDetail.ticket.id}/messages`; await this.run(async()=>{this.ticketDetail=await this.post<TicketDetail>(path,this.replyDraft);this.replyDraft=this.emptyReply();await this.reload();},'Reply could not be sent'); }
  async updateTicket() { if(!this.ticketDetail||!this.isPlatform)return; await this.run(async()=>{this.ticketDetail=await this.patch<TicketDetail>(`/platform/saas/tickets/${this.ticketDetail!.ticket.id}`,this.ticketUpdate);await this.reload();},'Ticket could not be updated'); }
  async reopenTicket() { if(!this.ticketDetail||!this.isPlatform)return;this.ticketUpdate.status='open';await this.updateTicket(); }
  async consolidateTicket() { if(!this.ticketDetail||!this.isPlatform||!this.ticketAction.targetTicketId)return;await this.run(async()=>{this.ticketDetail=await this.post<TicketDetail>(`/platform/saas/tickets/${this.ticketDetail!.ticket.id}/actions`,this.ticketAction);this.ticketAction={action:'duplicate',targetTicketId:'',reason:''};this.message='Tickets consolidated';await this.reload();},'Tickets could not be consolidated'); }
  async submitCsat() { if(!this.ticketDetail||this.isPlatform)return;await this.run(async()=>{this.ticketDetail=await this.post<TicketDetail>(`/saas/tickets/${this.ticketDetail!.ticket.id}/csat`,{rating:Number(this.csatDraft.rating),comment:this.csatDraft.comment});this.message='Thank you for your feedback';await this.reload();},'Feedback could not be saved'); }
  async selectAttachments(event:Event,target:'ticket'|'reply') { const files=Array.from((event.target as HTMLInputElement).files||[]);const draft=target==='ticket'?this.ticketDraft.attachments:this.replyDraft.attachments;for(const file of files){if(draft.length>=10||file.size>5*1024*1024){this.error='Up to 10 attachments of 5 MB each are allowed';break;}draft.push({fileName:file.name,contentType:file.type||'application/octet-stream',dataBase64:await this.fileData(file),sizeBytes:file.size});}(event.target as HTMLInputElement).value=''; }
  removeAttachment(target:'ticket'|'reply',index:number) { (target==='ticket'?this.ticketDraft.attachments:this.replyDraft.attachments).splice(index,1); }
  async downloadAttachment(file:TicketAttachment) { if(!this.ticketDetail)return;await this.run(async()=>{const scope=this.isPlatform?'/platform/saas':'/saas';const blob=await firstValueFrom(this.api.getBlob(`${scope}/tickets/${this.ticketDetail!.ticket.id}/attachments/${file.id}`));const url=URL.createObjectURL(blob);const link=document.createElement('a');link.href=url;link.download=file.fileName;link.click();URL.revokeObjectURL(url);},'Attachment could not be downloaded'); }
  closeDrawer() { if(!this.busy){this.drawer='';this.ticketDetail=undefined;this.selectedInvoice=undefined;this.selectedProviderPayment=undefined;this.selectedTenant=undefined;this.tenantControl=undefined;} }
  planName(id?: string) { return this.plans.find((row)=>row.id===id)?.name||'—'; }
  tenantName(id?: string) { return this.tenants.find((row)=>row.id===id)?.name||id||'—'; }
  label(value?: string) { return value?value.replaceAll('_',' ').replace(/\b\w/g,(letter)=>letter.toUpperCase()):'—'; }
  titleCase(value: string) { return value.replace(/\b\S+/g,(word)=>word.charAt(0).toUpperCase()+word.slice(1).toLowerCase()); }
  money(paise=0) { return new Intl.NumberFormat('en-IN',{style:'currency',currency:'INR'}).format(paise/100); }
  date(value?: string) { return value?new Intl.DateTimeFormat('en-GB',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'}).format(new Date(value)):'—'; }
  minutes(value: number) { if(!value)return '—'; if(value%1440===0)return `${value/1440}d`; if(value%60===0)return `${value/60}h`; return `${value}m`; }
  usagePercent(used=0,included=0) { return included>0?Math.min(Math.round((used/included)*100),999):used>0?100:0; }
  remaining(invoice: Invoice) { return Math.max(invoice.totalPaise-invoice.paidPaise,0); }

  private emptyPlan() { return {version:'',code:'',name:'',billingInterval:'monthly',basePriceRupees:'',includedBranches:'',includedUsers:'',includedAppointments:'',overageBranchRupees:'',overageUserRupees:'',overageAppointmentRupees:'',features:'',active:true,sla:['low','medium','high','critical'].map((severity)=>({severity,firstResponseMinutes:'',resolutionMinutes:'',businessHoursOnly:false}))}; }
  private emptyOnboarding() { return {salonName:'',salonSlug:'',planId:'',ownerFullName:'',ownerEmail:'',ownerPassword:'',branchName:'',branchCode:'',branchAddress:'',domain:''}; }
  private planFrom(plan:Plan) { return {version:String(plan.version),code:plan.code,name:plan.name,billingInterval:plan.billingInterval,basePriceRupees:String(plan.basePricePaise/100),includedBranches:String(plan.includedBranches),includedUsers:String(plan.includedUsers),includedAppointments:String(plan.includedAppointments),overageBranchRupees:String(plan.overageBranchPaise/100),overageUserRupees:String(plan.overageUserPaise/100),overageAppointmentRupees:String(plan.overageAppointmentPaise/100),features:plan.features.join('\n'),active:plan.active,sla:plan.sla.map((row)=>({severity:row.severity,firstResponseMinutes:String(row.firstResponseMinutes),resolutionMinutes:String(row.resolutionMinutes),businessHoursOnly:row.businessHoursOnly}))}; }
  private emptySubscription() { return {tenantId:'',planId:'',status:'active',startsDate:'',startsTime:'09:00',trialDate:'',trialTime:'09:00',provider:'manual',providerCustomerRef:'',providerSubscriptionRef:'',cancelAtPeriodEnd:false,version:''}; }
  private emptyTicket() { return {subject:'',category:'technical',severity:'medium',priority:'normal',message:'',attachments:[] as DraftAttachment[]}; }
  private emptyReply() { return {body:'',visibility:'customer',attachments:[] as DraftAttachment[]}; }
  private emptyReport(): SaasReport { return {periodDays:30,periodStart:'',periodEnd:'',mrrPaise:0,arrPaise:0,trialEligible:0,trialConverted:0,trialConversionPercent:0,churnedSubscriptions:0,churnRatePercent:0,renewalRiskCount:0,renewalRiskMrrPaise:0,outstandingInvoiceCount:0,outstandingPaise:0,usageOverageRevenuePaise:0,supportTickets:0,averageFirstResponseMinutes:0,averageResolutionMinutes:0,slaBreachedTickets:0,slaBreachPercent:0,renewalRisk:[],supportAgents:[]}; }
  private fileData(file:File) { return new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result||'').split(',',2)[1]||'');reader.onerror=()=>reject(new Error('File could not be read'));reader.readAsDataURL(file);}); }
  private toPaise(value:string) { const n=Number(value||0); return Number.isFinite(n)?Math.round(n*100):0; }
  private async mutate(request:any,success:string) { await this.run(async()=>{await firstValueFrom(request);this.message=success;this.drawer='';await this.reload();},success+' failed'); }
  private async run(action:()=>Promise<void>,fallback:string) { this.busy=true;this.error='';this.message='';try{await action();}catch(error){this.error=this.errorMessage(error,fallback);}finally{this.busy=false;} }
  private async get<T>(path:string) { const response=await firstValueFrom(this.api.get<ApiEnvelope<T>>(path)); if(response.data===undefined)throw new Error(response.error?.message||'API response missing data'); return response.data; }
  private async post<T>(path:string,body:unknown) { const response=await firstValueFrom(this.api.post<ApiEnvelope<T>>(path,body)); if(response.data===undefined)throw new Error(response.error?.message||'API response missing data'); return response.data; }
  private async patch<T>(path:string,body:unknown) { const response=await firstValueFrom(this.api.patch<ApiEnvelope<T>>(path,body)); if(response.data===undefined)throw new Error(response.error?.message||'API response missing data'); return response.data; }
  private async put<T>(path:string,body:unknown) { const response=await firstValueFrom(this.api.put<ApiEnvelope<T>>(path,body)); if(response.data===undefined)throw new Error(response.error?.message||'API response missing data'); return response.data; }
  private errorMessage(error:any,fallback:string) { return error?.error?.error?.message||error?.error?.message||error?.message||fallback; }
}
