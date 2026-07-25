import { CommonModule } from '@angular/common';
import { Component, OnInit, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { AuthService } from '../../../core/services/auth.service';
import { DatePickerComponent } from '../../../shared/date-picker/date-picker.component';
import { ApiEnvelope, ApiService } from '../../../shared/services/api.service';

type Tab = 'overview' | 'plans' | 'subscriptions' | 'billing' | 'usage' | 'support' | 'sla';
type Overview = { activePlans: number; activeSubscriptions: number; pastDueSubscriptions: number; outstandingPaise: number; openTickets: number; breachedTickets: number };
type Sla = { severity: string; firstResponseMinutes: number; resolutionMinutes: number; businessHoursOnly: boolean };
type Plan = { id: string; code: string; name: string; billingInterval: string; basePricePaise: number; includedBranches: number; includedUsers: number; includedAppointments: number; overageBranchPaise: number; overageUserPaise: number; overageAppointmentPaise: number; features: string[]; active: boolean; version: number; sla: Sla[]; activeSubscriptions: number };
type Tenant = { id: string; name: string; slug: string; status: string; branchCount: number; subscriptionStatus: string };
type Subscription = { id: string; tenantId: string; tenantName: string; planId: string; planName: string; status: string; currentPeriodStart: string; currentPeriodEnd: string; trialEndsAt?: string; cancelAtPeriodEnd: boolean; provider: string; providerCustomerRef: string; providerSubscriptionRef: string; version: number };
type Usage = { branchCount: number; activeUserCount: number; appointmentCount: number; apiCalls: number; messages: number; storageMb: number };
type UsageRow = { subscription: Subscription; usage: Usage };
type Invoice = { id: string; tenantId: string; tenantName: string; subscriptionId: string; planName: string; invoiceNumber: string; periodStart: string; periodEnd: string; baseAmountPaise: number; usageAmountPaise: number; taxAmountPaise: number; totalPaise: number; paidPaise: number; status: string; dueAt: string; issuedAt: string; paidAt?: string };
type Ticket = { id: string; tenantId: string; tenantName?: string; branchId: string; ticketNumber: string; subject: string; category: string; severity: string; priority: string; status: string; firstResponseDueAt?: string; resolutionDueAt?: string; firstRespondedAt?: string; resolvedAt?: string; assignedTo?: string; responseBreached?: boolean; resolutionBreached?: boolean; createdAt: string; updatedAt: string };
type Message = { id: string; authorId: string; authorType: string; visibility: string; body: string; createdAt: string };
type TicketDetail = { ticket: Ticket; messages: Message[]; events: Array<{ id: string; eventType: string; fromStatus: string; toStatus: string; actorId: string; createdAt: string }> };
type TenantContext = { subscription?: Subscription; usage?: Usage; invoices: Invoice[]; tickets: Ticket[]; plans: Plan[] };

@Component({
    selector: 'page-saas-admin', imports: [CommonModule, FormsModule, DatePickerComponent],
    templateUrl: './saas-admin-page.component.html', styleUrls: ['./saas-admin-page.component.css']
})
export class SaasAdminPageComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly auth = inject(AuthService);
  readonly isPlatform = this.auth.hasRole('superadmin', 'super-admin');
  readonly platformTabs: Array<{ key: Tab; label: string }> = [
    { key: 'overview', label: 'Overview' }, { key: 'plans', label: 'Plans' }, { key: 'subscriptions', label: 'Subscriptions' },
    { key: 'billing', label: 'Billing' }, { key: 'usage', label: 'Usage' }, { key: 'support', label: 'Support' }, { key: 'sla', label: 'SLA' },
  ];
  readonly tenantTabs: Array<{ key: Tab; label: string }> = [
    { key: 'overview', label: 'Overview' }, { key: 'billing', label: 'Billing' }, { key: 'usage', label: 'Usage' }, { key: 'support', label: 'Support' },
  ];
  readonly statuses = ['trialing', 'active', 'past_due', 'paused', 'cancelled'];
  readonly ticketStatuses = ['open', 'in_progress', 'waiting_customer', 'resolved', 'closed'];
  tab: Tab = 'overview'; loading = true; busy = false; error = ''; message = ''; search = '';
  overview: Overview = { activePlans: 0, activeSubscriptions: 0, pastDueSubscriptions: 0, outstandingPaise: 0, openTickets: 0, breachedTickets: 0 };
  plans: Plan[] = []; tenants: Tenant[] = []; subscriptions: Subscription[] = []; usageRows: UsageRow[] = []; invoices: Invoice[] = []; tickets: Ticket[] = [];
  tenantSubscription?: Subscription; tenantUsage?: Usage; ticketDetail?: TicketDetail;
  drawer: 'plan' | 'subscription' | 'invoice' | 'billingRun' | 'payment' | 'ticket' | 'ticketDetail' | '' = '';
  editingPlanId = ''; editingSubscriptionId = ''; selectedInvoice?: Invoice;
  planDraft = this.emptyPlan(); subscriptionDraft = this.emptySubscription(); invoiceDraft = { subscriptionId: '', taxPercent: '', dueDays: '7' };
  billingRunDraft = { taxPercent: '', dueDays: '7' };
  paymentDraft = { amountRupees: '', paymentMethod: 'bank', reference: '' };
  ticketDraft = { subject: '', category: 'technical', severity: 'medium', priority: 'normal', message: '' };
  replyDraft = { body: '', visibility: 'customer' }; ticketUpdate = { status: 'open', priority: 'normal', assignedTo: '' };

  get tabs() { return this.isPlatform ? this.platformTabs : this.tenantTabs; }
  get filteredPlans() { const q=this.search.trim().toLowerCase(); return this.plans.filter((row)=>!q||`${row.code} ${row.name}`.toLowerCase().includes(q)); }
  get filteredSubscriptions() { const q=this.search.trim().toLowerCase(); return this.subscriptions.filter((row)=>!q||`${row.tenantName} ${row.planName} ${row.status}`.toLowerCase().includes(q)); }
  get filteredInvoices() { const q=this.search.trim().toLowerCase(); return this.invoices.filter((row)=>!q||`${row.invoiceNumber} ${row.tenantName} ${row.status}`.toLowerCase().includes(q)); }
  get filteredTickets() { const q=this.search.trim().toLowerCase(); return this.tickets.filter((row)=>!q||`${row.ticketNumber} ${row.subject} ${row.tenantName || ''}`.toLowerCase().includes(q)); }

  async ngOnInit() { await this.reload(); }
  selectTab(tab: Tab) { this.tab = tab; this.search = ''; }
  async reload() {
    this.loading = true; this.error = '';
    try { if (this.isPlatform) await this.loadPlatform(); else await this.loadTenant(); }
    catch (error) { this.error = this.errorMessage(error, 'SaaS data could not be loaded'); }
    finally { this.loading = false; }
  }
  private async loadPlatform() {
    const [overview, plans, tenants, subscriptions, usage, invoices, tickets] = await Promise.all([
      this.get<Overview>('/platform/saas/overview'), this.get<Plan[]>('/platform/saas/plans?includeInactive=true'), this.get<Tenant[]>('/platform/saas/tenants'),
      this.get<Subscription[]>('/platform/saas/subscriptions'), this.get<UsageRow[]>('/platform/saas/usage'), this.get<Invoice[]>('/platform/saas/invoices'), this.get<Ticket[]>('/platform/saas/tickets'),
    ]);
    this.overview=overview; this.plans=plans; this.tenants=tenants; this.subscriptions=subscriptions; this.usageRows=usage; this.invoices=invoices; this.tickets=tickets;
  }
  private async loadTenant() {
    const data=await this.get<TenantContext>('/saas/context'); this.tenantSubscription=data.subscription; this.tenantUsage=data.usage; this.invoices=data.invoices||[]; this.tickets=data.tickets||[]; this.plans=data.plans||[];
    this.overview={activePlans:this.tenantSubscription?1:0,activeSubscriptions:this.tenantSubscription&&['trialing','active'].includes(this.tenantSubscription.status)?1:0,pastDueSubscriptions:this.tenantSubscription?.status==='past_due'?1:0,outstandingPaise:this.invoices.reduce((sum,row)=>sum+Math.max(row.totalPaise-row.paidPaise,0),0),openTickets:this.tickets.filter((row)=>!['resolved','closed'].includes(row.status)).length,breachedTickets:this.tickets.filter((row)=>row.resolutionBreached).length};
  }

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
  openTicket() { this.ticketDraft={subject:'',category:'technical',severity:'medium',priority:'normal',message:''}; this.drawer='ticket'; }
  async createTicket() { await this.mutate(this.api.post('/saas/tickets',this.ticketDraft),'Support ticket created'); }
  async openTicketDetail(ticket: Ticket) { await this.run(async()=>{this.ticketDetail=await this.get<TicketDetail>(this.isPlatform?`/platform/saas/tickets/${ticket.id}`:`/saas/tickets/${ticket.id}`);this.ticketUpdate={status:this.ticketDetail.ticket.status,priority:this.ticketDetail.ticket.priority,assignedTo:this.ticketDetail.ticket.assignedTo||''};this.replyDraft={body:'',visibility:'customer'};this.drawer='ticketDetail';},'Support ticket could not be loaded'); }
  async reply() { if(!this.ticketDetail)return; const path=this.isPlatform?`/platform/saas/tickets/${this.ticketDetail.ticket.id}/messages`:`/saas/tickets/${this.ticketDetail.ticket.id}/messages`; await this.run(async()=>{this.ticketDetail=await this.post<TicketDetail>(path,this.replyDraft);this.replyDraft={body:'',visibility:'customer'};await this.reload();},'Reply could not be sent'); }
  async updateTicket() { if(!this.ticketDetail||!this.isPlatform)return; await this.run(async()=>{this.ticketDetail=await this.patch<TicketDetail>(`/platform/saas/tickets/${this.ticketDetail!.ticket.id}`,this.ticketUpdate);await this.reload();},'Ticket could not be updated'); }
  closeDrawer() { if(!this.busy){this.drawer='';this.ticketDetail=undefined;this.selectedInvoice=undefined;} }
  planName(id?: string) { return this.plans.find((row)=>row.id===id)?.name||'—'; }
  tenantName(id?: string) { return this.tenants.find((row)=>row.id===id)?.name||id||'—'; }
  label(value?: string) { return value?value.replaceAll('_',' ').replace(/\b\w/g,(letter)=>letter.toUpperCase()):'—'; }
  titleCase(value: string) { return value.replace(/\b\S+/g,(word)=>word.charAt(0).toUpperCase()+word.slice(1).toLowerCase()); }
  money(paise=0) { return new Intl.NumberFormat('en-IN',{style:'currency',currency:'INR'}).format(paise/100); }
  date(value?: string) { return value?new Intl.DateTimeFormat('en-GB',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'}).format(new Date(value)):'—'; }
  minutes(value: number) { if(value%1440===0)return `${value/1440}d`; if(value%60===0)return `${value/60}h`; return `${value}m`; }
  usagePercent(used=0,included=0) { return included>0?Math.min(Math.round((used/included)*100),999):used>0?100:0; }
  remaining(invoice: Invoice) { return Math.max(invoice.totalPaise-invoice.paidPaise,0); }

  private emptyPlan() { return {version:'',code:'',name:'',billingInterval:'monthly',basePriceRupees:'',includedBranches:'',includedUsers:'',includedAppointments:'',overageBranchRupees:'',overageUserRupees:'',overageAppointmentRupees:'',features:'',active:true,sla:['low','medium','high','critical'].map((severity)=>({severity,firstResponseMinutes:'',resolutionMinutes:'',businessHoursOnly:false}))}; }
  private planFrom(plan:Plan) { return {version:String(plan.version),code:plan.code,name:plan.name,billingInterval:plan.billingInterval,basePriceRupees:String(plan.basePricePaise/100),includedBranches:String(plan.includedBranches),includedUsers:String(plan.includedUsers),includedAppointments:String(plan.includedAppointments),overageBranchRupees:String(plan.overageBranchPaise/100),overageUserRupees:String(plan.overageUserPaise/100),overageAppointmentRupees:String(plan.overageAppointmentPaise/100),features:plan.features.join('\n'),active:plan.active,sla:plan.sla.map((row)=>({severity:row.severity,firstResponseMinutes:String(row.firstResponseMinutes),resolutionMinutes:String(row.resolutionMinutes),businessHoursOnly:row.businessHoursOnly}))}; }
  private emptySubscription() { return {tenantId:'',planId:'',status:'active',startsDate:'',startsTime:'09:00',trialDate:'',trialTime:'09:00',provider:'manual',providerCustomerRef:'',providerSubscriptionRef:'',cancelAtPeriodEnd:false,version:''}; }
  private toPaise(value:string) { const n=Number(value||0); return Number.isFinite(n)?Math.round(n*100):0; }
  private async mutate(request:any,success:string) { await this.run(async()=>{await firstValueFrom(request);this.message=success;this.drawer='';await this.reload();},success+' failed'); }
  private async run(action:()=>Promise<void>,fallback:string) { this.busy=true;this.error='';this.message='';try{await action();}catch(error){this.error=this.errorMessage(error,fallback);}finally{this.busy=false;} }
  private async get<T>(path:string) { const response=await firstValueFrom(this.api.get<ApiEnvelope<T>>(path)); if(response.data===undefined)throw new Error(response.error?.message||'API response missing data'); return response.data; }
  private async post<T>(path:string,body:unknown) { const response=await firstValueFrom(this.api.post<ApiEnvelope<T>>(path,body)); if(response.data===undefined)throw new Error(response.error?.message||'API response missing data'); return response.data; }
  private async patch<T>(path:string,body:unknown) { const response=await firstValueFrom(this.api.patch<ApiEnvelope<T>>(path,body)); if(response.data===undefined)throw new Error(response.error?.message||'API response missing data'); return response.data; }
  private errorMessage(error:any,fallback:string) { return error?.error?.error?.message||error?.error?.message||error?.message||fallback; }
}
