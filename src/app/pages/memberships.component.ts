import { CommonModule, CurrencyPipe, DatePipe } from '@angular/common';
import { Component, OnInit, signal } from '@angular/core';
import { FormsModule, ReactiveFormsModule, UntypedFormBuilder, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { Observable, catchError, forkJoin, of } from 'rxjs';
import { ApiRecord, ApiService } from '../core/api.service';
import { PosMembershipPlan, PosSettingsService } from '../core/pos-settings.service';
import { StateComponent } from '../shared/ui/state/state.component';

type MembershipReport = {
  metrics?: {
    totalMemberships?: number;
    totalMembers?: number;
    active?: number;
    activeMembers?: number;
    expired?: number;
    soldRevenue?: number;
    redeemedDiscount?: number;
    pendingLiability?: number;
    creditsRemaining?: number;
    renewalRate?: number;
  };
  expiringSoon?: ApiRecord[];
  ledger?: ApiRecord[];
};

type MembershipCommissionReport = {
  metrics?: ApiRecord;
  staff?: ApiRecord[];
  entries?: ApiRecord[];
  cancellationImpact?: ApiRecord[];
  commissionPreviewIntegration?: ApiRecord;
};

type MembershipRiskReport = {
  metrics?: ApiRecord;
  byLevel?: ApiRecord;
  signals?: ApiRecord[];
};

type MembershipEnterpriseReport = {
  generatedAt?: string;
  filters?: ApiRecord;
  metrics?: ApiRecord;
  reports?: Record<string, ApiRecord[]>;
  exportRows?: ApiRecord[];
};

type MembershipDeskTab = 'overview' | 'plans' | 'sell' | 'active' | 'audit' | 'commission' | 'risk' | 'reports' | 'selfService' | 'reminders' | 'autoRenew' | 'giftcards';
type LifecycleAction = 'renew' | 'upgrade' | 'downgrade' | 'cancel';
type PlanLifecycleDialog = {
  action: Exclude<LifecycleAction, 'renew'>;
  membership: ApiRecord;
  targetPlan: PosMembershipPlan | null;
  summary: ApiRecord;
};

@Component({
  selector: 'app-memberships',
  standalone: true,
  imports: [CommonModule, FormsModule, ReactiveFormsModule, RouterLink, CurrencyPipe, DatePipe, StateComponent],
  template: `
    <section class="page-stack memberships-page">
      <div class="module-hero membership-hero membership-action-bar">
        <div class="hero-actions membership-quick-actions">
          <a class="ghost-button" routerLink="/pos">Sell in POS</a>
          <a class="ghost-button" routerLink="/packages">Packages</a>
          <button class="ghost-button" type="button" (click)="generateReminders()">Generate reminders</button>
        </div>
      </div>

      <app-state [loading]="loading()" [error]="error()"></app-state>
      <div class="state success" *ngIf="message()">{{ message() }}</div>

      <nav class="membership-tabs" aria-label="Membership workspace">
        <button type="button" [class.active]="activeTab() === 'overview'" (click)="setTab('overview')">
          Overview <span>{{ activeMemberships().length }}</span>
        </button>
        <button type="button" [class.active]="activeTab() === 'plans'" (click)="setTab('plans')">
          Plans <span>{{ membershipPlans().length }}</span>
        </button>
        <button type="button" [class.active]="activeTab() === 'sell'" (click)="setTab('sell')">
          Sell
        </button>
        <button type="button" [class.active]="activeTab() === 'active'" (click)="setTab('active')">
          All members <span>{{ memberships().length }}</span>
        </button>
        <button type="button" [class.active]="activeTab() === 'audit'" (click)="setTab('audit')">
          Audit ledger <span>{{ ledger().length }}</span>
        </button>
        <button type="button" [class.active]="activeTab() === 'commission'" (click)="setTab('commission')">
          Commission <span>{{ commissionReport().staff?.length || 0 }}</span>
        </button>
        <button type="button" [class.active]="activeTab() === 'risk'" (click)="setTab('risk')">
          Risk <span>{{ riskReport().metrics?.['pending'] || 0 }}</span>
        </button>
        <button type="button" [class.active]="activeTab() === 'reports'" (click)="setTab('reports')">
          Reports <span>{{ enterpriseReport().exportRows?.length || 0 }}</span>
        </button>
        <button type="button" [class.active]="activeTab() === 'selfService'" (click)="setTab('selfService')">
          Self-service <span>{{ selfServiceRequests().length }}</span>
        </button>
        <button type="button" [class.active]="activeTab() === 'reminders'" (click)="setTab('reminders')">
          Reminders <span>{{ reminders().length }}</span>
        </button>
        <button type="button" [class.active]="activeTab() === 'autoRenew'" (click)="setTab('autoRenew')">
          Auto-renew <span>{{ autoRenewQueue().length }}</span>
        </button>
        <button type="button" [class.active]="activeTab() === 'giftcards'" (click)="setTab('giftcards')">
          Gift cards <span>{{ giftCards().length }}</span>
        </button>
        <button class="refresh-tab" type="button" (click)="load()">Refresh</button>
      </nav>

      <section class="member-count-strip" aria-label="Membership totals">
        <article>
          <span>Total members</span>
          <strong>{{ totalMemberCount() }}</strong>
          <small>{{ report().metrics?.totalMemberships || memberships().length }} total memberships</small>
        </article>
        <article>
          <span>Active members</span>
          <strong>{{ activeMemberCount() }}</strong>
          <small>{{ report().metrics?.active || activeMemberships().length }} active plans</small>
        </article>
        <article>
          <span>Revenue</span>
          <strong>{{ (report().metrics?.soldRevenue || 0) | currency: 'INR':'symbol':'1.0-0' }}</strong>
          <small>Sold and renewed</small>
        </article>
        <article>
          <span>Renewal risk</span>
          <strong>{{ report().expiringSoon?.length || 0 }}</strong>
          <small>Expiring in 30 days</small>
        </article>
      </section>

      <section class="membership-overview-grid" *ngIf="activeTab() === 'overview'">
        <article class="overview-card primary">
          <div>
            <span class="eyebrow">Today focus</span>
            <h3>{{ report().expiringSoon?.length || 0 }} renewal follow-ups</h3>
            <p>Manage expiring plans, POS eligibility and renewal WhatsApp queue in one place.</p>
          </div>
          <div class="overview-actions">
            <button class="primary-button" type="button" (click)="setTab('sell')">Sell membership</button>
            <button class="ghost-button" type="button" (click)="setTab('reminders')">Open reminders</button>
          </div>
        </article>

        <article class="overview-card">
          <span class="eyebrow">Best plan visibility</span>
          <h3>{{ activeMembershipPlans()[0]?.name || 'No active plan yet' }}</h3>
          <p>{{ activeMembershipPlans()[0]?.discountPercent || 0 }}% service discount · {{ activeMembershipPlans()[0]?.validityDays || 0 }} days validity.</p>
          <button class="ghost-button mini" type="button" (click)="setTab('plans')">Manage plans</button>
        </article>

        <article class="overview-card">
          <span class="eyebrow">Liability</span>
          <h3>{{ (report().metrics?.pendingLiability || 0) | currency: 'INR':'symbol':'1.0-0' }}</h3>
          <p>{{ report().metrics?.creditsRemaining || 0 }} credits still available for redemption.</p>
        </article>
      </section>

      <div class="two-grid compact-workbench" *ngIf="activeTab() === 'plans'">
        <section class="form-panel sticky-panel">
          <div class="section-title compact-title">
            <div>
              <span class="eyebrow">{{ editingPlanId() ? 'Edit plan' : 'Plan master' }}</span>
              <h2>{{ editingPlanId() ? 'Update membership plan' : 'Create membership plan' }}</h2>
            </div>
            <button class="ghost-button mini" type="button" *ngIf="editingPlanId()" (click)="resetPlanForm()">New plan</button>
          </div>
          <form [formGroup]="planForm" (ngSubmit)="savePlan()">
            <label class="field"><span>Plan name</span><input formControlName="name" placeholder="Aura Gold 30%" /></label>
            <label class="field"><span>Plan code</span><input formControlName="code" placeholder="aura_gold" /></label>
            <label class="field"><span>Selling price</span><input type="number" formControlName="price" /></label>
            <label class="field"><span>Service discount %</span><input type="number" formControlName="discountPercent" /></label>
            <label class="field"><span>Product discount %</span><input type="number" formControlName="productDiscountPercent" /></label>
            <label class="field"><span>GST %</span><input type="number" formControlName="gstRate" /></label>
            <label class="field"><span>Validity days</span><input type="number" formControlName="validityDays" /></label>
            <label class="field">
              <span>Status</span>
              <select formControlName="status">
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </select>
            </label>
            <label class="field full"><span>Description</span><textarea formControlName="description"></textarea></label>
            <label class="field full"><span>Included services JSON</span><textarea formControlName="includedServicesText" placeholder='[{"serviceId":"svc_1","credits":1}]'></textarea></label>
            <label class="field full"><span>Benefit rules JSON</span><textarea formControlName="benefitRulesText" placeholder='{"maxDiscount":1000,"blackoutDates":[]}'></textarea></label>
            <button class="primary-button" type="submit" [disabled]="planForm.invalid || saving()">{{ editingPlanId() ? 'Save changes' : 'Save plan' }}</button>
          </form>
        </section>

        <section class="panel compact-panel">
          <div class="section-title">
            <div>
              <span class="eyebrow">Plans visible in POS</span>
              <h2>Membership plan master</h2>
            </div>
          </div>
          <div class="quick-grid plan-grid">
            <article class="action-card plan-card" *ngFor="let plan of membershipPlans()">
              <div>
                <strong>{{ plan.name }}</strong>
                <span>{{ plan.price | currency: 'INR':'symbol':'1.0-0' }} · {{ plan.discountPercent }}% service · {{ plan.productDiscountPercent || 0 }}% product</span>
              </div>
              <div class="plan-meta">
                <span>{{ plan.validityDays }} days</span>
                <span>{{ plan.status || (plan.active ? 'active' : 'inactive') }}</span>
                <span>v{{ plan.version || 1 }}</span>
              </div>
              <div class="inline-actions">
                <button class="ghost-button mini" type="button" (click)="editPlan(plan)">Edit</button>
                <a class="ghost-button mini" [routerLink]="['/memberships', plan.id]">360</a>
              </div>
            </article>
          </div>
        </section>
      </div>

      <div class="two-grid compact-workbench" *ngIf="activeTab() === 'sell'">
        <section class="form-panel sticky-panel">
          <div class="section-title compact-title">
            <div>
              <span class="eyebrow">Client membership ledger</span>
              <h2>Sell membership to client</h2>
            </div>
          </div>
          <form [formGroup]="membershipForm" (ngSubmit)="sellMembership()">
            <label class="field">
              <span>Client</span>
              <select formControlName="clientId" (change)="loadClientEligibility(membershipForm.value.clientId || '')">
                <option value="">Select client</option>
                <option *ngFor="let client of clients()" [value]="client.id">{{ clientWalletOption(client) }}</option>
              </select>
            </label>
            <label class="field">
              <span>Membership plan</span>
              <select formControlName="planId">
                <option value="">Select plan</option>
                <option *ngFor="let plan of activeMembershipPlans()" [value]="plan.id">{{ plan.name }} · {{ plan.price | currency: 'INR':'symbol':'1.0-0' }} · {{ plan.discountPercent }}%</option>
              </select>
            </label>
            <label class="field">
              <span>Sale staff</span>
              <select formControlName="staffId">
                <option value="">Counter / system</option>
                <option *ngFor="let staff of staffMembers()" [value]="staff.id">{{ staffOption(staff) }}</option>
              </select>
            </label>
            <label class="field"><span>Paid amount</span><input type="number" formControlName="paidAmount" /></label>
            <label class="field"><span>Membership taken date</span><input type="date" formControlName="takenDate" /></label>
            <label class="field"><span>Manual expiry date</span><input type="date" formControlName="validityDate" /></label>
            <label class="field"><span>Credits</span><input type="number" formControlName="planCredits" /></label>
            <label class="field check-line"><input type="checkbox" formControlName="autoRenew" /><span>Auto-renewal flag</span></label>
            <label class="field full"><span>Note</span><textarea formControlName="note"></textarea></label>
            <button class="primary-button" type="submit" [disabled]="membershipForm.invalid || saving()">Sell membership</button>
          </form>

          <div class="action-card" *ngIf="eligibility() as eligibilityState">
            <strong>POS eligibility</strong>
            <span>{{ eligibilityState.explanation || 'No eligibility loaded' }}</span>
            <span *ngIf="eligibilityState.recommendations?.length">Suggestion: {{ eligibilityState.recommendations.join(' ') }}</span>
          </div>
        </section>

        <section class="panel compact-panel">
          <div class="section-title">
            <div>
              <span class="eyebrow">Selected client only</span>
              <h2>Client membership preview</h2>
            </div>
          </div>

          <ng-container *ngIf="selectedClient() as client; else selectClientPreview">
            <article class="action-card selected-client-card">
              <strong>{{ client.name || client.fullName || client.id }}</strong>
              <span>{{ client.phone || client.email || 'No phone/email saved' }}</span>
              <span>{{ selectedClientBenefitsLabel() }}</span>
            </article>

            <article class="action-card wallet-panel" *ngIf="membershipWallet() as wallet">
              <strong>Membership Wallet</strong>
              <span>{{ wallet.activePlanName || 'No active benefits' }}</span>
              <div class="wallet-snapshot-grid">
                <div><span>Wallet balance</span><b>{{ wallet.walletBalance | currency: 'INR':'symbol':'1.0-0' }}</b></div>
                <div><span>Service credits</span><b>{{ wallet.serviceCredits?.remaining || 0 }} left / {{ wallet.serviceCredits?.used || 0 }} used</b></div>
                <div><span>Active packages</span><b>{{ wallet.packageSummary?.activeCount || 0 }}</b></div>
                <div><span>Package credits</span><b>{{ wallet.packageSummary?.creditsRemaining || 0 }}</b></div>
                <div><span>Product discount</span><b>{{ wallet.productDiscount || wallet.productDiscountPercent || 0 }}%</b></div>
                <div><span>Expiry</span><b>{{ wallet.expiryDate || '-' }}</b></div>
                <div><span>Auto-renew</span><b>{{ wallet.autoRenew ? 'On' : 'Off' }}</b></div>
                <div><span>Family sharing</span><b>{{ wallet.familySharing?.status || 'not_shared' }}</b></div>
              </div>
              <span>{{ wallet.walletConnection?.source || 'wallet balance' }} · {{ wallet.planBenefits?.serviceDiscountPercent || 0 }}% service benefit · {{ packageNamesLabel(wallet) }}</span>
            </article>

            <div class="mini-membership-list" *ngIf="selectedClientMemberships().length; else noClientMemberships">
              <article *ngFor="let membership of selectedClientMemberships()">
                <div>
                  <strong>{{ membership.planName }} <small>({{ membershipBenefitTypeLabel(membership) }})</small></strong>
                  <span>{{ membershipDaysLeftLabel(membership) }} · {{ membership.creditsRemaining || 0 }} credits left</span>
                </div>
                <b>{{ membershipDiscount(membership) }}%</b>
              </article>
            </div>

            <ng-template #noClientMemberships>
              <div class="empty-panel compact-empty">
                <strong>No active membership or package for this client.</strong>
                <span>This client's live benefit record updates after selling.</span>
              </div>
            </ng-template>
          </ng-container>

          <ng-template #selectClientPreview>
            <div class="empty-panel compact-empty">
              <strong>Select client to preview membership.</strong>
              <span>All members list ab sirf All members tab me dikhegi.</span>
            </div>
          </ng-template>

          <article class="action-card selected-client-card" *ngIf="selectedPlan() as plan">
            <strong>{{ plan.name }}</strong>
            <span>{{ plan.price | currency: 'INR':'symbol':'1.0-0' }} · {{ plan.discountPercent }}% service · {{ plan.productDiscountPercent || 0 }}% product</span>
            <span>{{ plan.validityDays }} days validity</span>
          </article>
        </section>
      </div>

      <section class="panel" *ngIf="activeTab() === 'active'">
        <div class="section-title">
          <div>
            <span class="eyebrow">Lifecycle controls</span>
            <h2>All members and active memberships</h2>
          </div>
          <div class="inline-actions">
            <select [(ngModel)]="quickLifecyclePlanId">
              <option value="">Plan for upgrade/downgrade</option>
              <option *ngFor="let plan of activeMembershipPlans()" [value]="plan.id">{{ plan.name }}</option>
            </select>
          </div>
        </div>
        <div class="table-wrap compact-table">
          <table>
            <thead>
              <tr>
                <th>Client</th>
                <th>Plan</th>
                <th>Taken on</th>
                <th>Expires on</th>
                <th>Days left</th>
                <th>Credits</th>
                <th>Discount</th>
                <th>Auto-renew</th>
                <th>Price</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              <tr *ngFor="let membership of memberships()">
                <td>{{ clientName(membership.clientId) }}</td>
                <td><strong>{{ membership.planName }}</strong><small>{{ membership.status }}</small></td>
                <td>{{ membershipTakenDate(membership) | date: 'mediumDate' }}</td>
                <td>{{ membership.validityDate ? (membership.validityDate | date: 'mediumDate') : 'No expiry' }}</td>
                <td>
                  <span class="badge" [class.danger]="membershipDaysLeft(membership) < 0">
                    {{ membershipDaysLeftLabel(membership) }}
                  </span>
                </td>
                <td>{{ membership.creditsRemaining || 0 }} / {{ membership.planCredits || 0 }}</td>
                <td>{{ membershipDiscount(membership) }}%</td>
                <td>{{ membership.autoRenew ? 'Yes' : 'No' }}</td>
                <td>{{ membership.price | currency: 'INR':'symbol':'1.0-0' }}</td>
                <td>
                  <div class="inline-actions">
                    <button class="ghost-button mini" type="button" (click)="renewMembership(membership)">Renew</button>
                    <button class="ghost-button mini" type="button" [disabled]="!quickLifecyclePlanId" (click)="openPlanLifecycleDialog(membership, 'upgrade')">Upgrade</button>
                    <button class="ghost-button mini" type="button" [disabled]="!quickLifecyclePlanId" (click)="openPlanLifecycleDialog(membership, 'downgrade')">Downgrade</button>
                    <a class="ghost-button mini" [routerLink]="['/memberships', membership.id]">360</a>
                    <button class="ghost-button mini danger-text" type="button" (click)="cancelMembership(membership)">Cancel</button>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <div class="two-grid compact-workbench" *ngIf="activeTab() === 'reminders'">
        <section class="form-panel">
          <h3>Family membership sharing</h3>
          <form [formGroup]="familyForm" (ngSubmit)="saveFamilyMember()">
            <label class="field"><span>Primary client</span><select formControlName="primaryClientId"><option value="">Select primary</option><option *ngFor="let client of clients()" [value]="client.id">{{ client.name }}</option></select></label>
            <label class="field"><span>Family member</span><select formControlName="memberClientId"><option value="">Select member</option><option *ngFor="let client of clients()" [value]="client.id">{{ client.name }}</option></select></label>
            <label class="field"><span>Relationship</span><input formControlName="relationship" placeholder="spouse, child, parent" /></label>
            <label class="field check-line"><input type="checkbox" formControlName="shareBenefits" /><span>Share membership benefits</span></label>
            <button class="primary-button" type="submit" [disabled]="familyForm.invalid || saving()">Link member</button>
          </form>
        </section>

        <section class="form-panel">
          <h3>WhatsApp renewal queue</h3>
          <div class="quick-grid">
            <article class="action-card" *ngFor="let reminder of reminders()">
              <strong>{{ clientName(reminder.clientId) }}</strong>
              <span>{{ reminder.message }}</span>
              <span>Due {{ reminder.dueOn }} · {{ reminder.status }}</span>
              <button class="ghost-button mini" type="button" *ngIf="reminder.status === 'queued'" (click)="approveReminder(reminder)">Approve</button>
            </article>
          </div>
        </section>
      </div>

      <section class="panel" *ngIf="activeTab() === 'autoRenew'">
        <div class="section-title">
          <div>
            <span class="eyebrow">Payment-safe engine</span>
            <h2>Auto-renew queue</h2>
          </div>
          <button class="ghost-button mini" type="button" (click)="load()">Refresh queue</button>
        </div>

        <section class="member-count-strip compact-count-strip">
          <article><span>Due today</span><strong>{{ autoRenewSummary().dueToday || 0 }}</strong><small>Needs manual review</small></article>
          <article><span>Due in 7 days</span><strong>{{ autoRenewSummary().dueIn7Days || 0 }}</strong><small>Upcoming renewal window</small></article>
          <article><span>Failed payment</span><strong>{{ autoRenewSummary().failedPayment || 0 }}</strong><small>Membership not extended</small></article>
          <article><span>Missing method</span><strong>{{ autoRenewSummary().paymentMethodMissing || 0 }}</strong><small>Reminder required</small></article>
        </section>

        <div class="quick-grid auto-renew-grid" *ngIf="autoRenewQueue().length; else noAutoRenewQueue">
          <article class="action-card auto-renew-card" *ngFor="let item of autoRenewQueue()">
            <div class="auto-renew-card-header">
              <div>
                <strong>{{ item.clientName || clientName(item.clientId) }}</strong>
                <span>{{ item.planName }} · expires {{ item.expiresOn || '-' }}</span>
              </div>
              <span class="badge" [class.danger]="item.failedPayment || item.status === 'payment_method_missing'">{{ autoRenewStatusLabel(item) }}</span>
            </div>
            <div class="wallet-snapshot-grid">
              <div><span>Retry count</span><b>{{ item.retryCount || 0 }}</b></div>
              <div><span>Next retry</span><b>{{ item.nextRetryAt ? (item.nextRetryAt | date: 'short') : '-' }}</b></div>
              <div><span>Payment method</span><b>{{ item.paymentMethod?.label || 'Missing' }}</b></div>
              <div><span>WhatsApp</span><b>{{ item.whatsappReminderStatus || 'not_queued' }}</b></div>
            </div>
            <span>{{ item.suggestedAction }}</span>
            <div class="inline-actions">
              <button class="ghost-button mini" type="button" [disabled]="item.paused" (click)="retryAutoRenew(item)">Manual retry</button>
              <button class="ghost-button mini danger-text" type="button" *ngIf="!item.paused" (click)="pauseAutoRenew(item)">Pause</button>
              <button class="ghost-button mini" type="button" *ngIf="item.paused" (click)="resumeAutoRenew(item)">Resume</button>
            </div>
          </article>
        </div>
        <ng-template #noAutoRenewQueue>
          <div class="empty-panel compact-empty">
            <strong>No auto-renew action due.</strong>
            <span>Auto-renew enabled memberships due within 7 days or failed retries appear here.</span>
          </div>
        </ng-template>
      </section>

      <section class="panel" *ngIf="activeTab() === 'audit'">
        <div class="section-title"><h2>Membership audit ledger</h2></div>
        <div class="table-wrap compact-table">
          <table>
            <thead><tr><th>When</th><th>Client</th><th>Action</th><th>Amount</th><th>Discount</th><th>Credits</th><th>Payment</th><th>Invoice</th><th>Note</th></tr></thead>
            <tbody>
              <tr *ngFor="let row of ledger()">
                <td>{{ row.createdAt | date: 'short' }}</td>
                <td>{{ clientName(row.clientId) }}</td>
                <td>{{ row.action }}</td>
                <td>{{ (row.paidAmount || row.amount) | currency: 'INR':'symbol':'1.0-0' }}</td>
                <td>{{ row.discountAmount | currency: 'INR':'symbol':'1.0-0' }}</td>
                <td>{{ row.creditsBefore }} → {{ row.creditsAfter }}</td>
                <td>{{ paymentLabel(row) }}</td>
                <td>{{ row.invoiceId || '-' }}</td>
                <td>{{ row.note || '-' }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section class="panel" *ngIf="activeTab() === 'commission'">
        <div class="section-title">
          <div>
            <span class="eyebrow">Phase 6 commission integration</span>
            <h2>Membership commission center</h2>
          </div>
          <a class="ghost-button mini" routerLink="/reports/commission-preview">Commission preview</a>
        </div>

        <section class="member-count-strip compact-count-strip">
          <article><span>Sale revenue</span><strong>{{ commissionMetric('saleRevenue') | currency: 'INR':'symbol':'1.0-0' }}</strong><small>Membership sale commission base</small></article>
          <article><span>Renewal revenue</span><strong>{{ commissionMetric('renewalRevenue') | currency: 'INR':'symbol':'1.0-0' }}</strong><small>Renewal commission base</small></article>
          <article><span>Upgrade revenue</span><strong>{{ commissionMetric('upgradeRevenue') | currency: 'INR':'symbol':'1.0-0' }}</strong><small>Upgrade commission base</small></article>
          <article><span>Commission preview</span><strong>{{ commissionMetric('commissionPreview') | currency: 'INR':'symbol':'1.0-0' }}</strong><small>{{ commissionReport().metrics?.['doubleCountGuardedRows'] || 0 }} duplicate guarded</small></article>
        </section>

        <div class="two-grid compact-workbench">
          <section class="form-panel">
            <div class="section-title compact-title">
              <div>
                <span class="eyebrow">Staff membership sales</span>
                <h3>Staff-wise revenue and retention</h3>
              </div>
            </div>
            <div class="table-wrap compact-table" *ngIf="commissionReport().staff?.length; else noCommissionStaff">
              <table>
                <thead><tr><th>Staff</th><th>Sale</th><th>Renewal</th><th>Upgrade</th><th>Retention</th><th>Preview</th><th>Reversal</th></tr></thead>
                <tbody>
                  <tr *ngFor="let row of commissionReport().staff">
                    <td><strong>{{ row['staffName'] || 'System' }}</strong><small>{{ row['role'] || row['staffId'] || '-' }}</small></td>
                    <td>{{ row['saleRevenue'] | currency: 'INR':'symbol':'1.0-0' }}</td>
                    <td>{{ row['renewalRevenue'] | currency: 'INR':'symbol':'1.0-0' }}</td>
                    <td>{{ row['upgradeRevenue'] | currency: 'INR':'symbol':'1.0-0' }}</td>
                    <td>{{ row['retentionRate'] || 0 }}%</td>
                    <td>{{ row['commissionPreview'] | currency: 'INR':'symbol':'1.0-0' }}</td>
                    <td><span class="badge" [class.danger]="row['reversalFlags']">{{ row['reversalFlags'] || 0 }}</span></td>
                  </tr>
                </tbody>
              </table>
            </div>
            <ng-template #noCommissionStaff>
              <div class="empty-panel compact-empty">
                <strong>No commission activity yet.</strong>
                <span>Membership sale, renewal, upgrade ya cancellation ke baad staff-wise report live ho jayega.</span>
              </div>
            </ng-template>
          </section>

          <section class="form-panel">
            <div class="section-title compact-title">
              <div>
                <span class="eyebrow">Cancellation impact on commission</span>
                <h3>Reversal and audit flags</h3>
              </div>
            </div>
            <div class="quick-grid" *ngIf="commissionReport().cancellationImpact?.length; else noCommissionImpact">
              <article class="action-card" *ngFor="let item of commissionReport().cancellationImpact">
                <strong>{{ clientName(item['clientId']) }}</strong>
                <span>{{ item['action'] }} · {{ item['commissionImpact'] | currency: 'INR':'symbol':'1.0-0' }} impact</span>
                <span>{{ item['reversalReason'] || 'Commission reversal requires review.' }}</span>
                <span>Audit: {{ item['auditStatus'] || 'missing' }}</span>
              </article>
            </div>
            <ng-template #noCommissionImpact>
              <div class="empty-panel compact-empty">
                <strong>No cancellation impact.</strong>
                <span>Cancelled or refunded membership commission flags appear here.</span>
              </div>
            </ng-template>
          </section>
        </div>

        <div class="table-wrap compact-table">
          <table>
            <thead><tr><th>When</th><th>Staff</th><th>Client</th><th>Action</th><th>Revenue</th><th>Rate</th><th>Commission</th><th>Audit</th><th>Status</th></tr></thead>
            <tbody>
              <tr *ngFor="let entry of commissionReport().entries">
                <td>{{ entry['createdAt'] | date: 'short' }}</td>
                <td>{{ entry['staffName'] || 'System' }}</td>
                <td>{{ clientName(entry['clientId']) }}</td>
                <td>{{ entry['action'] }}</td>
                <td>{{ entry['revenue'] | currency: 'INR':'symbol':'1.0-0' }}</td>
                <td>{{ ((entry['commissionRate'] || 0) * 100) | number: '1.1-1' }}%</td>
                <td>{{ entry['commissionImpact'] | currency: 'INR':'symbol':'1.0-0' }}</td>
                <td><span class="badge" [class.danger]="entry['auditRequired']">{{ entry['auditStatus'] }}</span></td>
                <td>{{ entry['status'] }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section class="panel" *ngIf="activeTab() === 'risk'">
        <div class="section-title">
          <div>
            <span class="eyebrow">Phase 7 risk and leakage detection</span>
            <h2>Membership risk center</h2>
          </div>
          <div class="inline-actions">
            <select [(ngModel)]="riskFilter">
              <option value="all">All risks</option>
              <option value="critical">Critical</option>
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
            </select>
            <button class="ghost-button mini" type="button" (click)="load()">Refresh risk</button>
          </div>
        </div>

        <section class="member-count-strip compact-count-strip">
          <article><span>Critical</span><strong>{{ riskMetric('critical') }}</strong><small>Immediate owner review</small></article>
          <article><span>High</span><strong>{{ riskMetric('high') }}</strong><small>Manager investigation</small></article>
          <article><span>Pending review</span><strong>{{ riskMetric('pending') }}</strong><small>Risk signals open</small></article>
          <article><span>Reviewed</span><strong>{{ riskMetric('reviewed') }}</strong><small>Audit logged</small></article>
        </section>

        <div class="quick-grid risk-grid" *ngIf="filteredRiskSignals().length; else noMembershipRisk">
          <article class="action-card risk-card" *ngFor="let signal of filteredRiskSignals()">
            <div class="auto-renew-card-header">
              <div>
                <strong>{{ riskTitle(signal) }}</strong>
                <span>{{ clientName(signal['clientId']) }} · {{ signal['staffName'] || 'System' }}</span>
              </div>
              <span class="badge" [ngClass]="riskBadgeClass(signal['riskLevel'])">{{ signal['riskLevel'] }} · {{ signal['riskScore'] || 0 }}</span>
            </div>
            <span>{{ signal['reason'] || riskReason(signal) }}</span>
            <span>Evidence: {{ riskEvidenceLabel(signal) }}</span>
            <span>Suggested: {{ signal['suggestedAction'] }}</span>
            <div class="inline-actions">
              <span class="badge" [class.danger]="signal['reviewStatus'] === 'pending'">{{ signal['reviewStatus'] || 'pending' }}</span>
              <button class="ghost-button mini" type="button" [disabled]="signal['reviewStatus'] === 'reviewed' || saving()" (click)="reviewRiskSignal(signal)">Review</button>
              <a class="ghost-button mini" *ngIf="signal['membershipId']" [routerLink]="['/memberships', signal['membershipId']]">360</a>
            </div>
          </article>
        </div>
        <ng-template #noMembershipRisk>
          <div class="empty-panel compact-empty">
            <strong>No matching risk signals.</strong>
            <span>Free renewal, expiry abuse, downgrade/refund leakage and credit mismatch appear here.</span>
          </div>
        </ng-template>
      </section>

      <section class="panel" *ngIf="activeTab() === 'reports'">
        <div class="section-title">
          <div>
            <span class="eyebrow">Phase 8 reports</span>
            <h2>Membership reports center</h2>
          </div>
          <div class="inline-actions">
            <button class="ghost-button mini" type="button" (click)="loadEnterpriseReports()" [disabled]="saving()">Apply filters</button>
            <button class="ghost-button mini" type="button" (click)="exportMembershipReportsCsv()">Export CSV</button>
            <button class="ghost-button mini" type="button" (click)="exportMembershipReportsPdf()">Export PDF</button>
          </div>
        </div>

        <section class="report-filter-grid">
          <label class="field"><span>From date</span><input type="date" [(ngModel)]="reportFilters.fromDate" /></label>
          <label class="field"><span>To date</span><input type="date" [(ngModel)]="reportFilters.toDate" /></label>
          <label class="field">
            <span>Branch</span>
            <select [(ngModel)]="reportFilters.branchId">
              <option value="">All branches</option>
              <option *ngFor="let branch of branchOptions()" [value]="branch">{{ branch }}</option>
            </select>
          </label>
          <label class="field">
            <span>Plan</span>
            <select [(ngModel)]="reportFilters.planId">
              <option value="">All plans</option>
              <option *ngFor="let plan of membershipPlans()" [value]="plan.id">{{ plan.name }}</option>
            </select>
          </label>
          <label class="field">
            <span>Staff</span>
            <select [(ngModel)]="reportFilters.staffId">
              <option value="">All staff</option>
              <option *ngFor="let staff of staffMembers()" [value]="staff.id || staff['staffId']">{{ staffOption(staff) }}</option>
            </select>
          </label>
          <label class="field">
            <span>Client</span>
            <select [(ngModel)]="reportFilters.clientId">
              <option value="">All clients</option>
              <option *ngFor="let client of clients()" [value]="client.id">{{ client.name || client['fullName'] || client.id }}</option>
            </select>
          </label>
          <label class="field">
            <span>Status</span>
            <select [(ngModel)]="reportFilters.status">
              <option value="">All statuses</option>
              <option value="active">Active</option>
              <option value="cancelled">Cancelled</option>
              <option value="expired">Expired</option>
            </select>
          </label>
          <label class="field">
            <span>Payment mode</span>
            <select [(ngModel)]="reportFilters.paymentMode">
              <option value="">All modes</option>
              <option value="cash">Cash</option>
              <option value="upi">UPI</option>
              <option value="card">Card</option>
              <option value="bank_transfer">Bank transfer</option>
              <option value="wallet">Wallet</option>
              <option value="credit_due">Credit / due</option>
            </select>
          </label>
          <label class="field">
            <span>Risk level</span>
            <select [(ngModel)]="reportFilters.riskLevel">
              <option value="all">All risks</option>
              <option value="critical">Critical</option>
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
            </select>
          </label>
        </section>

        <section class="member-count-strip compact-count-strip">
          <article><span>Active members</span><strong>{{ reportMetric('activeMembers') }}</strong><small>Live active ledger</small></article>
          <article><span>Expiring soon</span><strong>{{ reportMetric('expiringSoon') }}</strong><small>30-day renewal queue</small></article>
          <article><span>Renewal revenue</span><strong>{{ reportMetric('renewalRevenue') | currency: 'INR':'symbol':'1.0-0' }}</strong><small>Filtered renewals</small></article>
          <article><span>Credit liability</span><strong>{{ reportMetric('creditLiability') | currency: 'INR':'symbol':'1.0-0' }}</strong><small>Unused credit value</small></article>
          <article><span>Discount leakage</span><strong>{{ reportMetric('discountLeakage') | currency: 'INR':'symbol':'1.0-0' }}</strong><small>Membership discount audit</small></article>
          <article><span>Action queue</span><strong>{{ reportMetric('actionQueue') }}</strong><small>Renewal, wallet and plan tasks</small></article>
        </section>

        <section class="form-panel report-card action-queue-card">
          <div class="section-title compact-section-title">
            <div>
              <span class="eyebrow">Advanced queue</span>
              <h3>Membership action queue</h3>
            </div>
            <span class="badge" [class.danger]="reportMetric('actionQueue') > 0">{{ reportMetric('actionQueue') }} open</span>
          </div>
          <div class="table-wrap compact-table" *ngIf="reportSet('actionQueue').length; else noMembershipActionQueue">
            <table><thead><tr><th>Priority</th><th>Type</th><th>Client / plan</th><th>Value</th><th>Next action</th></tr></thead>
              <tbody><tr *ngFor="let row of reportSet('actionQueue').slice(0, 10)">
                <td><span class="badge" [ngClass]="riskBadgeClass(row['priority'])">{{ row['priority'] }}</span></td>
                <td>{{ actionQueueTypeLabel(row['queueType']) }}</td>
                <td>{{ row['primary'] || row['clientName'] || row['planName'] || '-' }}<small>{{ row['dueOn'] || row['planName'] || '' }}</small></td>
                <td>{{ actionQueueValue(row) }}</td>
                <td>{{ row['suggestedAction'] }}</td>
              </tr></tbody></table>
          </div>
          <ng-template #noMembershipActionQueue><div class="empty-panel compact-empty"><strong>No membership action queue.</strong><span>Expiry alerts, auto-renew recovery, wallet liability and package profitability tasks will appear here.</span></div></ng-template>
        </section>

        <div class="report-grid">
          <section class="form-panel report-card">
            <h3>Active members</h3>
            <div class="table-wrap compact-table" *ngIf="reportSet('activeMembers').length; else noActiveReport">
              <table><thead><tr><th>Client</th><th>Plan</th><th>Expiry</th><th>Credits</th><th>Price</th></tr></thead>
                <tbody><tr *ngFor="let row of reportSet('activeMembers').slice(0, 8)">
                  <td>{{ row['clientName'] }}</td><td>{{ row['planName'] }}</td><td>{{ row['expiresOn'] || '-' }}</td><td>{{ row['creditsRemaining'] || 0 }} / {{ row['planCredits'] || 0 }}</td><td>{{ row['price'] | currency: 'INR':'symbol':'1.0-0' }}</td>
                </tr></tbody></table>
            </div>
            <ng-template #noActiveReport><div class="empty-panel compact-empty"><strong>No active members.</strong></div></ng-template>
          </section>

          <section class="form-panel report-card">
            <h3>Expiring soon</h3>
            <div class="table-wrap compact-table" *ngIf="reportSet('expiringSoon').length; else noExpiryReport">
              <table><thead><tr><th>Client</th><th>Plan</th><th>Days</th><th>Auto-renew</th></tr></thead>
                <tbody><tr *ngFor="let row of reportSet('expiringSoon').slice(0, 8)">
                  <td>{{ row['clientName'] }}</td><td>{{ row['planName'] }}</td><td><span class="badge" [class.danger]="row['daysLeft'] <= 7">{{ row['daysLeft'] }}d</span></td><td>{{ row['autoRenew'] ? 'Yes' : 'No' }}</td>
                </tr></tbody></table>
            </div>
            <ng-template #noExpiryReport><div class="empty-panel compact-empty"><strong>No expiring memberships.</strong></div></ng-template>
          </section>

          <section class="form-panel report-card">
            <h3>Renewal revenue</h3>
            <div class="table-wrap compact-table" *ngIf="reportSet('renewalRevenue').length; else noRenewalReport">
              <table><thead><tr><th>Date</th><th>Revenue</th><th>Count</th><th>Staff</th></tr></thead>
                <tbody><tr *ngFor="let row of reportSet('renewalRevenue').slice(0, 8)">
                  <td>{{ row['date'] }}</td><td>{{ row['revenue'] | currency: 'INR':'symbol':'1.0-0' }}</td><td>{{ row['count'] }}</td><td>{{ row['staffCount'] }}</td>
                </tr></tbody></table>
            </div>
            <ng-template #noRenewalReport><div class="empty-panel compact-empty"><strong>No renewal revenue.</strong></div></ng-template>
          </section>

          <section class="form-panel report-card">
            <h3>Cancelled memberships</h3>
            <div class="table-wrap compact-table" *ngIf="reportSet('cancelledMemberships').length; else noCancelledReport">
              <table><thead><tr><th>Client</th><th>Plan</th><th>Amount</th><th>When</th></tr></thead>
                <tbody><tr *ngFor="let row of reportSet('cancelledMemberships').slice(0, 8)">
                  <td>{{ row['clientName'] }}</td><td>{{ row['planName'] || row['planId'] }}</td><td>{{ (row['amount'] || row['price'] || 0) | currency: 'INR':'symbol':'1.0-0' }}</td><td>{{ row['createdAt'] || row['takenOn'] || '-' }}</td>
                </tr></tbody></table>
            </div>
            <ng-template #noCancelledReport><div class="empty-panel compact-empty"><strong>No cancellations.</strong></div></ng-template>
          </section>

          <section class="form-panel report-card">
            <h3>Staff-wise sales</h3>
            <div class="table-wrap compact-table" *ngIf="reportSet('staffWiseSales').length; else noStaffReport">
              <table><thead><tr><th>Staff</th><th>Sale</th><th>Renewal</th><th>Upgrade</th><th>Commission</th></tr></thead>
                <tbody><tr *ngFor="let row of reportSet('staffWiseSales').slice(0, 8)">
                  <td>{{ row['staffName'] || 'System' }}</td><td>{{ row['saleRevenue'] | currency: 'INR':'symbol':'1.0-0' }}</td><td>{{ row['renewalRevenue'] | currency: 'INR':'symbol':'1.0-0' }}</td><td>{{ row['upgradeRevenue'] | currency: 'INR':'symbol':'1.0-0' }}</td><td>{{ row['commissionPreview'] | currency: 'INR':'symbol':'1.0-0' }}</td>
                </tr></tbody></table>
            </div>
            <ng-template #noStaffReport><div class="empty-panel compact-empty"><strong>No staff sales rows.</strong></div></ng-template>
          </section>

          <section class="form-panel report-card">
            <h3>Plan-wise profitability</h3>
            <div class="table-wrap compact-table" *ngIf="reportSet('planWiseProfitability').length; else noPlanReport">
              <table><thead><tr><th>Plan</th><th>Revenue</th><th>Leakage</th><th>Liability</th><th>Margin</th></tr></thead>
                <tbody><tr *ngFor="let row of reportSet('planWiseProfitability').slice(0, 8)">
                  <td>{{ row['planName'] }}</td><td>{{ row['revenue'] | currency: 'INR':'symbol':'1.0-0' }}</td><td>{{ row['discountLeakage'] | currency: 'INR':'symbol':'1.0-0' }}</td><td>{{ row['creditLiability'] | currency: 'INR':'symbol':'1.0-0' }}</td><td>{{ row['marginPercent'] || 0 }}%</td>
                </tr></tbody></table>
            </div>
            <ng-template #noPlanReport><div class="empty-panel compact-empty"><strong>No plan profitability rows.</strong></div></ng-template>
          </section>

          <section class="form-panel report-card">
            <h3>Credit liability</h3>
            <div class="table-wrap compact-table" *ngIf="reportSet('creditLiability').length; else noCreditReport">
              <table><thead><tr><th>Client</th><th>Plan</th><th>Credits</th><th>Value</th></tr></thead>
                <tbody><tr *ngFor="let row of reportSet('creditLiability').slice(0, 8)">
                  <td>{{ row['clientName'] }}</td><td>{{ row['planName'] }}</td><td>{{ row['creditsRemaining'] }}</td><td>{{ row['liabilityValue'] | currency: 'INR':'symbol':'1.0-0' }}</td>
                </tr></tbody></table>
            </div>
            <ng-template #noCreditReport><div class="empty-panel compact-empty"><strong>No credit liability.</strong></div></ng-template>
          </section>

          <section class="form-panel report-card">
            <h3>Auto-renew failed payments</h3>
            <div class="table-wrap compact-table" *ngIf="reportSet('autoRenewFailedPayments').length; else noAutoFailedReport">
              <table><thead><tr><th>Client</th><th>Plan</th><th>Status</th><th>Retry</th></tr></thead>
                <tbody><tr *ngFor="let row of reportSet('autoRenewFailedPayments').slice(0, 8)">
                  <td>{{ row['clientName'] || clientName(row['clientId']) }}</td><td>{{ row['planName'] || row['planId'] }}</td><td><span class="badge danger">{{ row['status'] }}</span></td><td>{{ row['retryCount'] || 0 }}</td>
                </tr></tbody></table>
            </div>
            <ng-template #noAutoFailedReport><div class="empty-panel compact-empty"><strong>No failed auto-renew payments.</strong></div></ng-template>
          </section>

          <section class="form-panel report-card">
            <h3>Upgrade / downgrade</h3>
            <div class="table-wrap compact-table" *ngIf="reportSet('upgradeDowngrade').length; else noLifecycleReport">
              <table><thead><tr><th>Client</th><th>Action</th><th>Amount</th><th>Staff</th></tr></thead>
                <tbody><tr *ngFor="let row of reportSet('upgradeDowngrade').slice(0, 8)">
                  <td>{{ row['clientName'] }}</td><td>{{ row['action'] }}</td><td>{{ (row['amount'] || row['refundAmount'] || 0) | currency: 'INR':'symbol':'1.0-0' }}</td><td>{{ row['staffName'] || 'System' }}</td>
                </tr></tbody></table>
            </div>
            <ng-template #noLifecycleReport><div class="empty-panel compact-empty"><strong>No upgrade or downgrade rows.</strong></div></ng-template>
          </section>

          <section class="form-panel report-card">
            <h3>Discount leakage</h3>
            <div class="table-wrap compact-table" *ngIf="reportSet('discountLeakage').length; else noDiscountReport">
              <table><thead><tr><th>Invoice</th><th>Plan</th><th>Discount</th><th>Risk</th></tr></thead>
                <tbody><tr *ngFor="let row of reportSet('discountLeakage').slice(0, 8)">
                  <td>{{ row['invoiceId'] || '-' }}</td><td>{{ row['planName'] || row['planId'] }}</td><td>{{ row['discountAmount'] | currency: 'INR':'symbol':'1.0-0' }}</td><td><span class="badge" [ngClass]="riskBadgeClass(row['riskLevel'])">{{ row['riskLevel'] }}</span></td>
                </tr></tbody></table>
            </div>
            <ng-template #noDiscountReport><div class="empty-panel compact-empty"><strong>No discount leakage.</strong></div></ng-template>
          </section>
        </div>
      </section>

      <section class="panel" *ngIf="activeTab() === 'selfService'">
        <div class="section-title">
          <div>
            <span class="eyebrow">Phase 9 client self-service</span>
            <h2>Membership self-service control center</h2>
          </div>
          <div class="inline-actions">
            <button class="ghost-button mini" type="button" (click)="loadSelfServiceSummary()" [disabled]="saving()">Load summary</button>
            <button class="ghost-button mini" type="button" (click)="refreshSelfServiceRequests()" [disabled]="saving()">Refresh requests</button>
          </div>
        </div>

        <section class="report-filter-grid self-service-filter-grid">
          <label class="field">
            <span>Client</span>
            <select [(ngModel)]="selfServiceClientId" (ngModelChange)="onSelfServiceClientChanged()">
              <option value="">Select client</option>
              <option *ngFor="let client of clients()" [value]="client.id">{{ clientWalletOption(client) }}</option>
            </select>
          </label>
          <label class="field">
            <span>Membership</span>
            <select [(ngModel)]="selfServiceMembershipId">
              <option value="">Auto active membership</option>
              <option *ngFor="let membership of selectedSelfServiceClientMemberships()" [value]="membership.id">
                {{ membership['planName'] || membership['planId'] || membership.id }} · {{ membershipDaysLeftLabel(membership) }}
              </option>
            </select>
          </label>
          <label class="field full">
            <span>Generated status link</span>
            <input [value]="selfServiceLastLink || selfServiceSummary()?.['statusLink']?.['link'] || ''" readonly placeholder="Generate status link for client" />
          </label>
        </section>

        <div class="self-service-grid">
          <section class="form-panel report-card">
            <h3>Remaining credits view</h3>
            <div class="wallet-snapshot-grid" *ngIf="selfServiceSummary() as summary; else noSelfServiceSummary">
              <div><span>Client</span><b>{{ summary['client']?.['name'] || summary['client']?.['id'] || '-' }}</b></div>
              <div><span>Active plan</span><b>{{ summary['wallet']?.['activePlanName'] || 'None' }}</b></div>
              <div><span>Remaining credits</span><b>{{ summary['remainingCredits'] || 0 }}</b></div>
              <div><span>Expiry</span><b>{{ summary['expiryDate'] || '-' }} · {{ summary['daysLeft'] ?? '-' }}d</b></div>
              <div><span>Wallet balance</span><b>{{ (summary['wallet']?.['walletBalance'] || 0) | currency: 'INR':'symbol':'1.0-0' }}</b></div>
              <div><span>Provider readiness</span><b>{{ summary['providerReadiness']?.['paymentProviderConfigured'] ? 'Configured' : 'Placeholder only' }}</b></div>
            </div>
            <ng-template #noSelfServiceSummary>
              <div class="empty-panel compact-empty">
                <strong>No client loaded.</strong>
                <span>Select a client and load summary to show membership status, wallet and credits.</span>
              </div>
            </ng-template>
          </section>

          <section class="form-panel report-card">
            <h3>Client-ready actions</h3>
            <div class="quick-grid">
              <article class="action-card">
                <strong>Status link</strong>
                <span>Creates a client membership status link record with token and expiry.</span>
                <button class="ghost-button mini" type="button" (click)="createSelfServiceStatusLink()" [disabled]="saving() || !selfServiceClientId">Generate link</button>
              </article>
              <article class="action-card">
                <strong>WhatsApp summary</strong>
                <span>Prepares manual-copy WhatsApp membership summary. No provider send unless configured.</span>
                <button class="ghost-button mini" type="button" (click)="createWhatsAppSummary()" [disabled]="saving() || !selfServiceClientId">Prepare summary</button>
              </article>
              <article class="action-card">
                <strong>Renew payment link</strong>
                <span>Creates provider placeholder request only. Membership is not extended.</span>
                <button class="ghost-button mini" type="button" (click)="createSelfServiceRenewLink()" [disabled]="saving() || !selfServiceMembershipId">Create request</button>
              </article>
              <article class="action-card">
                <strong>Payment method update</strong>
                <span>Creates a vault placeholder request. No card/bank data is stored.</span>
                <button class="ghost-button mini" type="button" (click)="createSelfServicePaymentMethodUpdate()" [disabled]="saving() || !selfServiceMembershipId">Create request</button>
              </article>
            </div>
            <div class="enterprise-control-box">
              <span class="eyebrow">Enterprise controls</span>
              <strong>Manual credit adjustment</strong>
              <div class="inline-form control-inline-form">
                <label class="field">
                  <span>Credit delta</span>
                  <input type="number" [(ngModel)]="selfServiceCreditDelta" />
                </label>
                <label class="field">
                  <span>Reason</span>
                  <input [(ngModel)]="selfServiceCreditReason" placeholder="Mandatory approval reason" />
                </label>
                <button class="ghost-button mini" type="button" (click)="createManualCreditAdjustmentRequest()" [disabled]="saving() || !selfServiceMembershipId || !selfServiceCreditReason.trim()">Request approval</button>
              </div>
            </div>
            <label class="field">
              <span>Cancellation reason</span>
              <textarea [(ngModel)]="selfServiceCancelReason" placeholder="Reason is mandatory. Approval required before cancellation/refund."></textarea>
            </label>
            <button class="ghost-button danger-text" type="button" (click)="createSelfServiceCancelRequest()" [disabled]="saving() || !selfServiceMembershipId || !selfServiceCancelReason.trim()">Request cancellation approval</button>
          </section>

          <section class="form-panel report-card">
            <h3>Expiry reminders</h3>
            <div class="quick-grid" *ngIf="selfServiceSummary()?.['expiryReminders']?.length; else noSelfServiceReminders">
              <article class="action-card" *ngFor="let reminder of selfServiceSummary()?.['expiryReminders']">
                <strong>{{ reminder['reminderType'] || 'reminder' }}</strong>
                <span>{{ reminder['dueOn'] || '-' }} · {{ reminder['status'] || 'queued' }}</span>
              </article>
            </div>
            <ng-template #noSelfServiceReminders>
              <div class="empty-panel compact-empty"><strong>No expiry reminders.</strong><span>Generate reminders from the reminders tab to populate this queue.</span></div>
            </ng-template>
          </section>

          <section class="form-panel report-card">
            <h3>WhatsApp preview</h3>
            <textarea class="readonly-textarea" readonly [value]="selfServiceSummary()?.['whatsappSummary'] || 'Load a client summary to preview WhatsApp text.'"></textarea>
          </section>
        </div>

        <section class="form-panel report-card request-queue-card">
          <h3>Self-service request queue</h3>
          <div class="table-wrap compact-table" *ngIf="selfServiceRequests().length; else noSelfServiceRequests">
            <table>
              <thead><tr><th>When</th><th>Client</th><th>Type</th><th>Status</th><th>Approval</th><th>Reason</th><th>Action</th></tr></thead>
              <tbody>
                <tr *ngFor="let request of selfServiceRequests()">
                  <td>{{ request['createdAt'] | date: 'short' }}</td>
                  <td>{{ clientName(request['clientId']) }}</td>
                  <td>{{ selfServiceLabel(request['requestType']) }}</td>
                  <td><span class="badge" [class.danger]="request['status'] === 'pending_approval'">{{ selfServiceLabel(request['status']) }}</span></td>
                  <td>{{ request['approvalRequired'] ? 'Owner/manager' : 'Not required' }}</td>
                  <td>{{ request['reason'] || '-' }}<small *ngIf="request['requestPayload']?.['controls']?.length">{{ request['requestPayload']['controls'][0]?.label }}</small></td>
                  <td>
                    <div class="inline-actions">
                      <button class="ghost-button mini" type="button" (click)="approveSelfServiceRequest(request)" [disabled]="saving() || request['status'] !== 'pending_approval'">Approve</button>
                      <button class="ghost-button mini danger-text" type="button" (click)="rejectSelfServiceRequest(request)" [disabled]="saving() || request['status'] !== 'pending_approval'">Reject</button>
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <ng-template #noSelfServiceRequests>
            <div class="empty-panel compact-empty"><strong>No self-service requests yet.</strong><span>Status links, renewal placeholders, payment updates and cancellation approvals will appear here.</span></div>
          </ng-template>
        </section>
      </section>

      <section class="panel" *ngIf="activeTab() === 'giftcards'">
        <div class="section-title"><h2>Gift cards</h2></div>
        <form class="form-panel inline-form" [formGroup]="giftForm" (ngSubmit)="saveGiftCard()">
          <label class="field"><span>Code</span><input formControlName="code" /></label>
          <label class="field"><span>Initial value</span><input type="number" formControlName="initialValue" /></label>
          <label class="field"><span>Expiry</span><input type="date" formControlName="expiryDate" /></label>
          <button class="primary-button" type="submit" [disabled]="giftForm.invalid || saving()">Create gift card</button>
        </form>
        <div class="quick-grid">
          <article class="action-card" *ngFor="let card of giftCards()">
            <strong>{{ card.code }}</strong>
            <span>{{ card.balance | currency: 'INR':'symbol':'1.0-0' }} balance · expires {{ card.expiryDate }}</span>
          </article>
        </div>
      </section>

      <div class="modal-backdrop" *ngIf="renewalMembership() as renewal" (click)="closeRenewalDialog()">
        <section class="renewal-modal" role="dialog" aria-modal="true" aria-labelledby="renewalTitle" (click)="$event.stopPropagation()">
          <div class="section-title compact-title">
            <div>
              <span class="eyebrow">Payment required</span>
              <h2 id="renewalTitle">Renew membership</h2>
            </div>
            <button class="ghost-button mini" type="button" (click)="closeRenewalDialog()">Close</button>
          </div>

          <div class="renewal-summary">
            <article>
              <span>Client</span>
              <strong>{{ clientName(renewal.clientId) }}</strong>
            </article>
            <article>
              <span>Plan</span>
              <strong>{{ renewal.planName || 'Membership' }}</strong>
            </article>
            <article>
              <span>Current expiry</span>
              <strong>{{ renewal.validityDate ? (renewal.validityDate | date: 'mediumDate') : 'No expiry' }}</strong>
            </article>
          </div>

          <form class="renewal-form" [formGroup]="renewalForm" (ngSubmit)="confirmRenewal()">
            <label class="field">
              <span>Renewal amount</span>
              <input type="number" formControlName="paidAmount" />
            </label>
            <label class="field">
              <span>Payment mode</span>
              <select formControlName="paymentMode">
                <option value="cash">Cash</option>
                <option value="upi">UPI</option>
                <option value="card">Card</option>
                <option value="bank_transfer">Bank transfer</option>
                <option value="wallet">Wallet</option>
                <option value="credit_due">Credit / due</option>
              </select>
            </label>
            <label class="field">
              <span>Renewal staff</span>
              <select formControlName="staffId">
                <option value="">Counter / system</option>
                <option *ngFor="let staff of staffMembers()" [value]="staff.id">{{ staffOption(staff) }}</option>
              </select>
            </label>
            <label class="field">
              <span>Reference no.</span>
              <input formControlName="referenceNo" placeholder="UPI/Card/receipt ref" />
            </label>
            <label class="field">
              <span>Validity days</span>
              <input type="number" formControlName="validityDays" />
            </label>
            <label class="field">
              <span>Manual expiry date</span>
              <input type="date" formControlName="validityDate" />
            </label>
            <label class="field">
              <span>Add credits</span>
              <input type="number" formControlName="addCredits" />
            </label>
            <label class="field full" *ngIf="isRenewalZeroAmount()">
              <span>Zero amount reason</span>
              <textarea formControlName="zeroReason" placeholder="Required for ₹0 renewal"></textarea>
            </label>
            <label class="field full">
              <span>Note</span>
              <textarea formControlName="note"></textarea>
            </label>
            <div class="renewal-actions">
              <button class="ghost-button" type="button" (click)="closeRenewalDialog()">Cancel</button>
              <button class="primary-button" type="submit" [disabled]="renewalForm.invalid || saving()">Confirm payment & renew</button>
            </div>
          </form>
        </section>
      </div>

      <div class="modal-backdrop" *ngIf="lifecycleDialog() as dialog" (click)="closeLifecycleDialog()">
        <section class="renewal-modal" role="dialog" aria-modal="true" aria-labelledby="lifecycleTitle" (click)="$event.stopPropagation()">
          <div class="section-title compact-title">
            <div>
              <span class="eyebrow">Payment-safe lifecycle</span>
              <h2 id="lifecycleTitle">{{ lifecycleTitle(dialog.action) }}</h2>
            </div>
            <button class="ghost-button mini" type="button" (click)="closeLifecycleDialog()">Close</button>
          </div>

          <div class="renewal-summary">
            <article>
              <span>Client</span>
              <strong>{{ clientName(dialog.membership.clientId) }}</strong>
            </article>
            <article>
              <span>Current plan</span>
              <strong>{{ dialog.summary.currentPlan?.name || dialog.membership.planName || 'Membership' }}</strong>
            </article>
            <article>
              <span>Target plan</span>
              <strong>{{ dialog.summary.targetPlan?.name || dialog.targetPlan?.name || (dialog.action === 'cancel' ? 'Cancel membership' : 'Select plan') }}</strong>
            </article>
            <article>
              <span>Current expiry</span>
              <strong>{{ dialog.summary.currentExpiry || dialog.membership.validityDate || 'No expiry' }}</strong>
            </article>
            <article>
              <span>Remaining days</span>
              <strong>{{ dialog.summary.remainingDays || 0 }}</strong>
            </article>
            <article>
              <span>Used days</span>
              <strong>{{ dialog.summary.usedDays || 0 }}</strong>
            </article>
            <article>
              <span>Old price</span>
              <strong>{{ dialog.summary.oldPrice | currency: 'INR':'symbol':'1.0-0' }}</strong>
            </article>
            <article>
              <span>Unused value</span>
              <strong>{{ dialog.summary.unusedValue | currency: 'INR':'symbol':'1.0-0' }}</strong>
            </article>
            <article>
              <span>Target value</span>
              <strong>{{ (dialog.summary.targetValue || dialog.summary.newPrice) | currency: 'INR':'symbol':'1.0-0' }}</strong>
            </article>
            <article>
              <span>Payable difference</span>
              <strong>{{ lifecyclePayableAmount() | currency: 'INR':'symbol':'1.0-0' }}</strong>
            </article>
            <article>
              <span>Credit note</span>
              <strong>{{ (dialog.summary.creditNoteAmount || lifecycleRefundAmount()) | currency: 'INR':'symbol':'1.0-0' }}</strong>
            </article>
            <article>
              <span>Refund amount</span>
              <strong>{{ lifecycleRefundAmount() | currency: 'INR':'symbol':'1.0-0' }}</strong>
            </article>
            <article>
              <span>New expiry</span>
              <strong>{{ dialog.summary.newExpiryDate || dialog.membership.validityDate || 'No expiry' }}</strong>
            </article>
          </div>
          <article class="action-card" *ngIf="dialog.action !== 'cancel'">
            <span>Proration engine</span>
            <strong>{{ prorationLoading() ? 'Calculating live preview...' : (dialog.summary.suggestedAction || 'Preview ready') }}</strong>
            <p *ngIf="dialog.summary.creditCarryForward?.rule">{{ dialog.summary.creditCarryForward.rule }} Credits: {{ dialog.summary.creditCarryForward.carryForwardCredits || 0 }}</p>
            <p *ngIf="dialog.summary.creditNoteSuggestion">{{ dialog.summary.creditNoteSuggestion }}</p>
            <p *ngIf="dialog.summary.warnings?.length">Warnings: {{ dialog.summary.warnings.join(' | ') }}</p>
          </article>

          <form class="renewal-form" [formGroup]="lifecycleForm" (ngSubmit)="confirmLifecycleAction()">
            <label class="field" *ngIf="dialog.action !== 'cancel'">
              <span>Target plan</span>
              <select formControlName="targetPlanId" (change)="syncLifecycleTargetPlan()">
                <option value="">Select target plan</option>
                <option *ngFor="let plan of activeMembershipPlans()" [value]="plan.id">{{ plan.name }} · {{ plan.price | currency: 'INR':'symbol':'1.0-0' }}</option>
              </select>
            </label>
            <label class="field">
              <span>Payment mode</span>
              <select formControlName="paymentMode">
                <option value="cash">Cash</option>
                <option value="upi">UPI</option>
                <option value="card">Card</option>
                <option value="bank_transfer">Bank transfer</option>
                <option value="wallet">Wallet</option>
                <option value="credit_due">Credit / due</option>
                <option value="credit_note">Credit note</option>
                <option value="no_payment">No payment</option>
              </select>
            </label>
            <label class="field">
              <span>Action staff</span>
              <select formControlName="staffId">
                <option value="">Counter / system</option>
                <option *ngFor="let staff of staffMembers()" [value]="staff.id">{{ staffOption(staff) }}</option>
              </select>
            </label>
            <label class="field" *ngIf="dialog.action !== 'downgrade'">
              <span>Payable amount</span>
              <input type="number" formControlName="payableAmount" />
            </label>
            <label class="field" *ngIf="dialog.action !== 'upgrade'">
              <span>Refund / credit note amount</span>
              <input type="number" formControlName="refundAmount" />
            </label>
            <label class="field">
              <span>Reference no.</span>
              <input formControlName="referenceNo" placeholder="Payment, refund or approval ref" />
            </label>
            <label class="field">
              <span>Effective date</span>
              <input type="date" formControlName="effectiveDate" (change)="refreshProrationPreview()" />
            </label>
            <label class="field" *ngIf="dialog.action !== 'cancel'">
              <span>Validity days</span>
              <input type="number" formControlName="validityDays" (change)="refreshProrationPreview()" />
            </label>
            <label class="field" *ngIf="dialog.action !== 'cancel'">
              <span>Add credits</span>
              <input type="number" formControlName="addCredits" (change)="refreshProrationPreview()" />
            </label>
            <label class="field full" *ngIf="dialog.action === 'cancel'">
              <span>Cancel reason</span>
              <textarea formControlName="reason" placeholder="Required before cancellation"></textarea>
            </label>
            <label class="field full" *ngIf="requiresLifecycleZeroReason(dialog.action)">
              <span>Zero amount reason</span>
              <textarea formControlName="zeroReason" placeholder="Required for ₹0 upgrade"></textarea>
            </label>
            <label class="field full">
              <span>Note</span>
              <textarea formControlName="note"></textarea>
            </label>
            <div class="renewal-actions">
              <button class="ghost-button" type="button" (click)="closeLifecycleDialog()">Cancel</button>
              <button class="primary-button" type="submit" [disabled]="lifecycleForm.invalid || saving()">{{ lifecycleConfirmLabel(dialog.action) }}</button>
            </div>
          </form>
        </section>
      </div>
    </section>
  `,
  styles: [`
    .memberships-page {
      gap: 18px;
    }

    .membership-hero {
      align-items: center;
      justify-content: flex-end;
      min-height: auto;
      padding: 10px 18px;
      border: 1px solid rgba(15, 23, 42, 0.08);
      box-shadow: 0 18px 45px rgba(15, 23, 42, 0.06);
    }

    .membership-action-bar {
      margin-bottom: -4px;
    }

    .membership-quick-actions {
      display: flex;
      flex-wrap: wrap;
      justify-content: flex-end;
      gap: 10px;
      width: 100%;
    }

    .membership-tabs {
      position: sticky;
      top: 0;
      z-index: 8;
      display: flex;
      gap: 8px;
      align-items: center;
      padding: 10px;
      overflow-x: auto;
      border: 1px solid rgba(15, 23, 42, 0.08);
      border-radius: 16px;
      background: rgba(255, 255, 255, 0.92);
      box-shadow: 0 12px 32px rgba(15, 23, 42, 0.06);
      backdrop-filter: blur(16px);
    }

    .membership-tabs button {
      border: 1px solid transparent;
      border-radius: 999px;
      background: transparent;
      color: #475569;
      cursor: pointer;
      font: inherit;
      font-size: 0.92rem;
      font-weight: 700;
      padding: 9px 13px;
      white-space: nowrap;
      transition: background 120ms ease, border-color 120ms ease, color 120ms ease;
    }

    .membership-tabs button:hover {
      background: #eef7f5;
      color: #0f766e;
    }

    .membership-tabs button.active {
      border-color: rgba(15, 118, 110, 0.28);
      background: #0f766e;
      color: #fff;
      box-shadow: 0 8px 20px rgba(15, 118, 110, 0.18);
    }

    .membership-tabs span {
      display: inline-grid;
      min-width: 22px;
      min-height: 22px;
      margin-left: 6px;
      place-items: center;
      border-radius: 999px;
      background: rgba(15, 23, 42, 0.08);
      font-size: 0.78rem;
      font-variant-numeric: tabular-nums;
    }

    .membership-tabs button.active span {
      background: rgba(255, 255, 255, 0.2);
    }

    .membership-tabs .refresh-tab {
      margin-left: auto;
      border-color: rgba(15, 23, 42, 0.12);
      background: #fff;
      color: #0f172a;
    }

    .member-count-strip {
      width: 100%;
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 12px;
      align-items: stretch;
      padding: 0;
      border: none;
      border-radius: 0;
      background: none;
      box-shadow: none;
    }

    .member-count-strip article {
      display: flex;
      flex-direction: column;
      justify-content: center;
      min-height: 82px;
      padding: 14px 16px;
      border-radius: 14px;
      background: #fff;
      border: 1px solid rgba(79, 70, 229, 0.1);
      box-shadow: 0 4px 14px rgba(79, 70, 229, 0.06);
    }

    .member-count-strip span,
    .member-count-strip small {
      color: #64748b;
      font-size: 0.7rem;
      font-weight: 750;
    }

    .member-count-strip strong {
      color: #4f46e5;
      font-size: 1.25rem;
      font-variant-numeric: tabular-nums;
      line-height: 1.2;
    }

    .membership-overview-grid {
      display: grid;
      grid-template-columns: minmax(0, 1.35fr) repeat(2, minmax(240px, 0.6fr));
      gap: 14px;
    }

    .overview-card {
      display: flex;
      min-height: 170px;
      flex-direction: column;
      justify-content: space-between;
      padding: 22px;
      border: 1px solid rgba(15, 23, 42, 0.08);
      border-radius: 16px;
      background: #fff;
      box-shadow: 0 16px 36px rgba(15, 23, 42, 0.05);
    }

    .overview-card.primary {
      color: #fff;
      background:
        linear-gradient(135deg, rgba(15, 118, 110, 0.96), rgba(20, 83, 45, 0.92)),
        #0f766e;
    }

    .overview-card.primary .eyebrow,
    .overview-card.primary p {
      color: rgba(255, 255, 255, 0.78);
    }

    .overview-card h3 {
      margin: 6px 0;
      font-size: 1.35rem;
      line-height: 1.2;
    }

    .overview-card p {
      margin: 0;
      color: #64748b;
      line-height: 1.55;
    }

    .overview-actions {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
      margin-top: 18px;
    }

    .compact-workbench {
      align-items: stretch;
      grid-template-columns: minmax(320px, 0.8fr) minmax(0, 1.25fr);
      gap: 24px;
    }

    .sticky-panel {
      align-self: start;
      max-height: calc(100vh - 160px);
      overflow-y: auto;
    }

    .form-panel,
    .panel,
    .action-card,
    .metric-card {
      border-radius: 16px;
    }

    .sticky-panel {
      padding: 12px 14px;
    }

    .form-panel form {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 10px;
    }

    .form-panel .full,
    .form-panel button[type='submit'] {
      grid-column: 1 / -1;
    }

    .sticky-panel .field { gap: 2px; }
    .sticky-panel .field input,
    .sticky-panel .field select { padding: 5px 8px; min-height: 30px; }
    .sticky-panel > :last-child { margin-bottom: 0; }
    .sticky-panel form { margin-bottom: 0; }
    .sticky-panel .action-card { padding: 10px 12px; margin-top: 10px; }

    .field textarea {
      min-height: 60px;
      resize: vertical;
    }

    .compact-panel {
      padding: 16px 20px;
      display: flex;
      flex-direction: column;
      gap: 14px;
    }
    .compact-panel .section-title { margin-bottom: 0; }

    .plan-grid {
      grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
    }

    .plan-card {
      min-height: 130px;
      justify-content: space-between;
      padding: 14px 16px;
      gap: 8px;
    }
    .plan-card strong { font-size: 0.94rem; }
    .plan-card > div:first-child { display: flex; flex-direction: column; gap: 4px; }
    .plan-card > div:first-child span { font-size: 0.8rem; opacity: 0.7; }

    .plan-meta {
      display: flex;
      flex-wrap: wrap;
      gap: 4px;
    }

    .plan-meta span,
    .badge {
      display: inline-flex;
      align-items: center;
      border-radius: 999px;
      background: #eaf7f4;
      color: #0f766e;
      font-size: 0.72rem;
      font-weight: 800;
      padding: 3px 7px;
    }

    .badge.danger {
      background: #fee2e2;
      color: #b91c1c;
    }

    .report-filter-grid {
      display: grid;
      grid-template-columns: repeat(5, minmax(150px, 1fr));
      gap: 12px;
      margin-bottom: 14px;
      padding: 14px;
      border: 1px solid rgba(15, 23, 42, 0.08);
      border-radius: 14px;
      background: #f8fbfb;
    }

    .report-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 14px;
      margin-top: 14px;
    }

    .self-service-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 14px;
      margin-top: 14px;
    }

    .self-service-filter-grid .full,
    .request-queue-card {
      grid-column: 1 / -1;
    }

    .report-card {
      min-width: 0;
    }

    .report-card h3 {
      margin: 0 0 12px;
      color: #0f172a;
      font-size: 1rem;
      line-height: 1.2;
    }

    .mini-membership-list {
      display: grid;
      gap: 10px;
    }

    .selected-client-card {
      margin-bottom: 0;
      padding: 12px 16px;
      display: flex;
      flex-direction: column;
      gap: 3px;
    }
    .selected-client-card strong { font-size: 0.94rem; }
    .selected-client-card span { font-size: 0.8rem; opacity: 0.7; }

    .wallet-panel {
      margin-bottom: 0;
      padding: 14px 16px;
    }
    .wallet-panel > strong { font-size: 0.88rem; display: block; margin-bottom: 2px; }
    .wallet-panel > span { font-size: 0.78rem; opacity: 0.7; }

    .wallet-snapshot-grid {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 6px;
      margin: 10px 0;
    }

    .wallet-snapshot-grid div {
      padding: 8px 10px;
      border: 1px solid rgba(15, 23, 42, 0.06);
      border-radius: 10px;
      background: #f8fbfb;
    }
    .wallet-snapshot-grid div:has(b:empty) { display: none; }

    .wallet-snapshot-grid span,
    .wallet-snapshot-grid b {
      display: block;
    }
    .wallet-snapshot-grid span { font-size: 0.68rem; opacity: 0.6; text-transform: uppercase; letter-spacing: 0.03em; }
    .wallet-snapshot-grid b {
      margin-top: 2px;
      color: #0f172a;
      font-size: 0.85rem;
    }

    .mini-membership-list article {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 10px 14px;
      border: 1px solid rgba(15, 23, 42, 0.06);
      border-radius: 12px;
      background: #f8fbfb;
      gap: 12px;
    }
    .mini-membership-list article > div {
      display: flex;
      flex-direction: column;
      gap: 2px;
    }
    .mini-membership-list article strong { font-size: 0.88rem; }
    .mini-membership-list article strong small { font-weight: 400; opacity: 0.6; font-size: 0.78rem; }
    .mini-membership-list article span { font-size: 0.78rem; opacity: 0.7; }
    .mini-membership-list article b { font-size: 1rem; color: #4f46e5; white-space: nowrap; }

    .compact-empty {
      padding: 24px 16px;
      text-align: center;
      gap: 6px;
    }
    .compact-empty strong { font-size: 0.9rem; }
    .compact-empty span { font-size: 0.8rem; opacity: 0.6; }

    .compact-count-strip {
      margin-bottom: 16px;
    }

    .auto-renew-grid {
      grid-template-columns: repeat(auto-fill, minmax(360px, 1fr));
    }

    .auto-renew-card {
      gap: 12px;
    }

    .auto-renew-card-header {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 12px;
    }

    .compact-empty {
      display: grid;
      gap: 6px;
      padding: 16px;
      border: 1px dashed rgba(15, 23, 42, 0.16);
      border-radius: 14px;
      background: #f8fbfb;
      color: #475569;
    }

    .compact-empty strong {
      color: #0f172a;
    }

    .compact-empty span {
      color: #64748b;
      font-size: 0.9rem;
    }

    .modal-backdrop {
      position: fixed;
      inset: 0;
      z-index: 60;
      display: grid;
      place-items: center;
      padding: 24px;
      background: rgba(15, 23, 42, 0.34);
      backdrop-filter: blur(6px);
    }

    .renewal-modal {
      width: min(760px, 100%);
      max-height: min(86vh, 760px);
      overflow: auto;
      border: 1px solid rgba(15, 23, 42, 0.1);
      border-radius: 18px;
      background: #ffffff;
      box-shadow: 0 28px 80px rgba(15, 23, 42, 0.24);
      padding: 20px;
    }

    .renewal-summary {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 12px;
      margin: 14px 0;
    }

    .renewal-summary article {
      padding: 12px;
      border: 1px solid rgba(15, 23, 42, 0.08);
      border-radius: 14px;
      background: #f8fbfb;
    }

    .renewal-summary span {
      display: block;
      color: #64748b;
      font-size: 0.8rem;
      font-weight: 800;
      text-transform: uppercase;
    }

    .renewal-form {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 12px;
    }

    .renewal-form .full,
    .renewal-actions {
      grid-column: 1 / -1;
    }

    .renewal-actions {
      display: flex;
      justify-content: flex-end;
      gap: 10px;
      margin-top: 4px;
    }

    .mini-membership-list article {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding: 14px;
      border: 1px solid rgba(15, 23, 42, 0.08);
      border-radius: 14px;
      background: #fbfefd;
    }

    .mini-membership-list span,
    .action-card span,
    td small {
      display: block;
      color: #64748b;
      font-size: 0.85rem;
      line-height: 1.45;
    }

    .compact-table {
      max-height: 58vh;
      overflow: auto;
    }

    .compact-table table {
      min-width: 1040px;
    }

    .compact-table thead th {
      position: sticky;
      top: 0;
      z-index: 1;
      background: #f8fbfb;
    }

    .inline-actions {
      flex-wrap: wrap;
    }

    .inline-form {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 12px;
      padding: 14px;
      margin-bottom: 14px;
      background: #f8fbfb;
    }

    .inline-form button {
      align-self: end;
    }

    .enterprise-control-box {
      display: grid;
      gap: 8px;
      margin: 14px 0;
      padding: 14px;
      border: 1px solid rgba(180, 83, 9, 0.18);
      border-radius: 14px;
      background: #fffbeb;
    }

    .enterprise-control-box strong {
      color: #0f172a;
    }

    .control-inline-form {
      margin: 0;
      padding: 0;
      border: 0;
      background: transparent;
      grid-template-columns: minmax(120px, 0.4fr) minmax(180px, 1fr) auto;
    }

    .readonly-textarea {
      width: 100%;
      min-height: 220px;
      border: 1px solid rgba(15, 23, 42, 0.1);
      border-radius: 14px;
      background: #f8fbfb;
      color: #0f172a;
      font: inherit;
      line-height: 1.45;
      padding: 12px;
      resize: vertical;
    }

    @media (max-width: 1180px) {
      .member-count-strip {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }
      .membership-overview-grid,
      .report-filter-grid,
      .report-grid,
      .self-service-grid,
      .compact-workbench {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }
    }

    @media (max-width: 780px) {
      .membership-hero,
      .section-title {
        align-items: flex-start;
        flex-direction: column;
      }

      .hero-actions,
      .overview-actions {
        width: 100%;
      }

      .membership-overview-grid,
      .compact-workbench,
      .report-filter-grid,
      .report-grid,
      .self-service-grid,
      .form-panel form,
      .renewal-summary,
      .renewal-form,
      .inline-form {
        grid-template-columns: 1fr;
      }

      .member-count-strip {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }

      .sticky-panel {
        align-self: auto;
        max-height: none;
        overflow-y: visible;
        padding: 16px;
      }

      .membership-tabs {
        top: 0;
      }

      .membership-tabs .refresh-tab {
        margin-left: 0;
      }

      .wallet-snapshot-grid {
        grid-template-columns: repeat(2, 1fr);
      }
    }

    @media (max-width: 520px) {
      .member-count-strip {
        grid-template-columns: 1fr;
      }
    }
  `]
})
export class MembershipsComponent implements OnInit {
  readonly membershipPlans = signal<PosMembershipPlan[]>([]);
  readonly memberships = signal<ApiRecord[]>([]);
  readonly clients = signal<ApiRecord[]>([]);
  readonly staffMembers = signal<ApiRecord[]>([]);
  readonly giftCards = signal<ApiRecord[]>([]);
  readonly ledger = signal<ApiRecord[]>([]);
  readonly reminders = signal<ApiRecord[]>([]);
  readonly autoRenewQueue = signal<ApiRecord[]>([]);
  readonly autoRenewSummary = signal<ApiRecord>({});
  readonly report = signal<MembershipReport>({});
  readonly commissionReport = signal<MembershipCommissionReport>({});
  readonly riskReport = signal<MembershipRiskReport>({});
  readonly enterpriseReport = signal<MembershipEnterpriseReport>({});
  readonly selfServiceSummary = signal<ApiRecord | null>(null);
  readonly selfServiceRequests = signal<ApiRecord[]>([]);
  readonly eligibility = signal<ApiRecord | null>(null);
  readonly membershipWallet = signal<ApiRecord | null>(null);
  readonly editingPlanId = signal('');
  readonly loading = signal(true);
  readonly saving = signal(false);
  readonly error = signal('');
  readonly message = signal('');
  readonly activeTab = signal<MembershipDeskTab>('overview');
  readonly renewalMembership = signal<ApiRecord | null>(null);
  readonly lifecycleDialog = signal<PlanLifecycleDialog | null>(null);
  readonly prorationLoading = signal(false);
  quickLifecyclePlanId = '';
  riskFilter = 'all';
  selfServiceClientId = '';
  selfServiceMembershipId = '';
  selfServiceCancelReason = '';
  selfServiceCreditDelta = 0;
  selfServiceCreditReason = '';
  selfServiceLastLink = '';
  reportFilters = {
    fromDate: '',
    toDate: '',
    branchId: '',
    planId: '',
    staffId: '',
    clientId: '',
    status: '',
    paymentMode: '',
    riskLevel: 'all'
  };

  readonly planForm = this.fb.group({
    id: [''],
    version: [1],
    code: [''],
    name: ['Aura Gold 30%', Validators.required],
    description: ['Every bill discount plan'],
    price: [2999, Validators.required],
    discountPercent: [30, Validators.required],
    productDiscountPercent: [0],
    gstRate: [18],
    validityDays: [365, Validators.required],
    includedServicesText: ['[]'],
    benefitRulesText: ['{"maxDiscount":0,"blackoutDates":[]}'],
    status: ['active']
  });
  readonly membershipForm = this.fb.group({
    clientId: ['', Validators.required],
    planId: ['', Validators.required],
    staffId: [''],
    paidAmount: [0],
    takenDate: [new Date().toISOString().slice(0, 10)],
    validityDate: [''],
    planCredits: [0],
    autoRenew: [true],
    note: ['Sold from membership desk']
  });
  readonly familyForm = this.fb.group({
    primaryClientId: ['', Validators.required],
    memberClientId: ['', Validators.required],
    relationship: ['family'],
    shareBenefits: [true]
  });
  readonly giftForm = this.fb.group({
    code: ['', Validators.required],
    initialValue: [1000, Validators.required],
    expiryDate: ['2026-12-31']
  });
  readonly renewalForm = this.fb.group({
    paidAmount: [0, Validators.required],
    paymentMode: ['cash', Validators.required],
    staffId: [''],
    referenceNo: [''],
    validityDays: [365, Validators.required],
    validityDate: [''],
    addCredits: [0],
    zeroReason: [''],
    note: ['Renewed from membership desk']
  });
  readonly lifecycleForm = this.fb.group({
    targetPlanId: [''],
    payableAmount: [0],
    refundAmount: [0],
    paymentMode: ['cash', Validators.required],
    staffId: [''],
    referenceNo: [''],
    effectiveDate: [new Date().toISOString().slice(0, 10), Validators.required],
    validityDays: [365, Validators.required],
    addCredits: [0],
    reason: [''],
    zeroReason: [''],
    note: ['']
  });

  constructor(private readonly api: ApiService, private readonly fb: UntypedFormBuilder, private readonly posSettings: PosSettingsService) {}

  ngOnInit(): void {
    this.membershipPlans.set(this.posSettings.loadMembershipPlans());
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.error.set('');
    forkJoin({
      plans: this.safeList<PosMembershipPlan[]>('membership-enterprise/plans'),
      memberships: this.safeList<ApiRecord[]>('memberships', { limit: 1000 }),
      clients: this.safeList<ApiRecord[]>('clients', { limit: 1000 }),
      staff: this.quietList<ApiRecord[]>('staff', { limit: 1000 }),
      giftCards: this.safeList<ApiRecord[]>('giftCards', { limit: 1000 }),
      ledger: this.safeList<ApiRecord[]>('membership-enterprise/ledger', { limit: 200 }),
      reminders: this.safeList<ApiRecord[]>('membership-enterprise/reminders', { limit: 100 }),
      autoRenew: this.safeList<ApiRecord>('membership-enterprise/auto-renew/queue', { limit: 100 }),
      report: this.safeList<MembershipReport>('membership-enterprise/reports/revenue'),
      commission: this.safeList<MembershipCommissionReport>('membership-enterprise/reports/commission'),
      risk: this.safeList<MembershipRiskReport>('membership-enterprise/reports/risk'),
      enterpriseReport: this.safeList<MembershipEnterpriseReport>('membership-enterprise/reports/enterprise', this.reportFilterParams()),
      selfServiceRequests: this.safeList<ApiRecord[]>('membership-enterprise/self-service/requests', { limit: 100 })
    }).subscribe(({ plans, memberships, clients, staff, giftCards, ledger, reminders, autoRenew, report, commission, risk, enterpriseReport, selfServiceRequests }) => {
      const livePlans = (plans || []).map((plan) => this.normalizePlan(plan));
      if (livePlans.length) {
        this.membershipPlans.set(livePlans);
        this.posSettings.saveMembershipPlans(livePlans);
      }
      this.memberships.set(memberships || []);
      this.clients.set(clients || []);
      this.staffMembers.set(staff || []);
      this.giftCards.set(giftCards || []);
      this.ledger.set(ledger || []);
      this.reminders.set(reminders || []);
      this.autoRenewQueue.set((autoRenew?.['items'] as ApiRecord[]) || []);
      this.autoRenewSummary.set((autoRenew?.['metrics'] as ApiRecord) || {});
      this.report.set(report || {});
      this.commissionReport.set(commission || {});
      this.riskReport.set(risk || {});
      this.enterpriseReport.set(enterpriseReport || {});
      this.selfServiceRequests.set(selfServiceRequests || []);
      this.ensureSelfServiceDefaults();
      this.loading.set(false);
    });
  }

  setTab(tab: MembershipDeskTab): void {
    this.activeTab.set(tab);
  }

  savePlan(): void {
    if (this.planForm.invalid) return;
    this.saving.set(true);
    this.error.set('');
    let includedServices: unknown[] = [];
    let benefitRules: Record<string, unknown> = {};
    try {
      includedServices = JSON.parse(this.planForm.value.includedServicesText || '[]');
      benefitRules = JSON.parse(this.planForm.value.benefitRulesText || '{}');
    } catch {
      this.error.set('Included services or benefit rules must be valid JSON.');
      this.saving.set(false);
      return;
    }
    const payload = {
      code: this.planForm.value.code,
      name: this.planForm.value.name,
      description: this.planForm.value.description,
      price: Number(this.planForm.value.price || 0),
      discountPercent: Number(this.planForm.value.discountPercent || 0),
      productDiscountPercent: Number(this.planForm.value.productDiscountPercent || 0),
      gstRate: Number(this.planForm.value.gstRate || 18),
      validityDays: Number(this.planForm.value.validityDays || 365),
      includedServices,
      benefitRules,
      status: this.planForm.value.status || 'active',
      version: Number(this.planForm.value.version || 1)
    };
    const request = this.editingPlanId()
      ? this.api.patch<PosMembershipPlan>(`membership-enterprise/plans/${this.editingPlanId()}`, payload)
      : this.api.create<PosMembershipPlan>('membership-enterprise/plans', payload);
    request.subscribe({
      next: () => {
        this.saving.set(false);
        this.message.set(this.editingPlanId() ? 'Membership plan updated.' : 'Membership plan created.');
        this.resetPlanForm();
        this.load();
      },
      error: (error) => {
        this.error.set(error?.error?.error || error?.message || 'Unable to save membership plan');
        this.saving.set(false);
      }
    });
  }

  editPlan(plan: PosMembershipPlan): void {
    this.editingPlanId.set(plan.id);
    this.planForm.patchValue({
      id: plan.id,
      version: plan.version || 1,
      code: plan.code || '',
      name: plan.name,
      description: plan.description || '',
      price: plan.price,
      discountPercent: plan.discountPercent,
      productDiscountPercent: plan.productDiscountPercent || 0,
      gstRate: plan.gstRate || 18,
      validityDays: plan.validityDays,
      includedServicesText: JSON.stringify(plan.includedServices || [], null, 2),
      benefitRulesText: JSON.stringify(plan.benefitRules || {}, null, 2),
      status: plan.status || (plan.active ? 'active' : 'inactive')
    });
  }

  resetPlanForm(): void {
    this.editingPlanId.set('');
    this.planForm.reset({
      id: '',
      version: 1,
      code: '',
      name: 'Aura Gold 30%',
      description: 'Every bill discount plan',
      price: 2999,
      discountPercent: 30,
      productDiscountPercent: 0,
      gstRate: 18,
      validityDays: 365,
      includedServicesText: '[]',
      benefitRulesText: '{"maxDiscount":0,"blackoutDates":[]}',
      status: 'active'
    });
  }

  sellMembership(): void {
    if (this.membershipForm.invalid) return;
    this.saving.set(true);
    const value = this.membershipForm.value;
    const plan = this.membershipPlans().find((item) => item.id === value.planId);
    const staff = this.staffById(String(value.staffId || ''));
    this.api.post('membership-enterprise/sell', {
      ...value,
      staffName: staff ? this.staffName(staff.id) : '',
      price: plan?.price || 0,
      paidAmount: Number(value.paidAmount || plan?.price || 0)
    }).subscribe({
      next: (result) => {
        this.message.set('Client membership ledger saved and POS eligibility updated.');
        this.eligibility.set((result as ApiRecord)?.eligibility || null);
        this.membershipWallet.set(((result as ApiRecord)?.eligibility as ApiRecord | undefined)?.['wallet'] || null);
        this.saving.set(false);
        this.load();
      },
      error: (error) => {
        this.error.set(error?.error?.error || 'Unable to sell membership');
        this.saving.set(false);
      }
    });
  }

  renewMembership(membership: ApiRecord): void {
    this.openRenewalDialog(membership);
  }

  openRenewalDialog(membership: ApiRecord): void {
    this.lifecycleDialog.set(null);
    this.renewalMembership.set(membership);
    this.renewalForm.reset({
      paidAmount: Number(membership.price || 0),
      paymentMode: 'cash',
      staffId: '',
      referenceNo: '',
      validityDays: 365,
      validityDate: '',
      addCredits: Number(membership.planCredits || 0),
      zeroReason: '',
      note: 'Renewed from membership desk'
    });
  }

  closeRenewalDialog(): void {
    if (this.saving()) return;
    this.renewalMembership.set(null);
  }

  confirmRenewal(): void {
    const membership = this.renewalMembership();
    if (!membership || this.renewalForm.invalid) return;
    const value = this.renewalForm.value;
    const paidAmount = Number(value.paidAmount || 0);
    if (paidAmount <= 0 && !String(value.zeroReason || '').trim()) {
      this.error.set('Reason is required for ₹0 renewal.');
      return;
    }
    this.lifecycle(membership, 'renew', {
      confirmed: true,
      validityDays: Number(value.validityDays || 365),
      validityDate: value.validityDate || '',
      addCredits: Number(value.addCredits || 0),
      renewalAmount: paidAmount,
      amount: paidAmount,
      paidAmount,
      paymentMode: value.paymentMode || 'cash',
      staffId: value.staffId || '',
      staffName: this.staffName(String(value.staffId || '')),
      referenceNo: value.referenceNo || '',
      zeroReason: value.zeroReason || '',
      note: value.note || 'Renewed from membership desk'
    });
  }

  changeMembershipPlan(membership: ApiRecord, action: 'upgrade' | 'downgrade'): void {
    this.openPlanLifecycleDialog(membership, action);
  }

  openPlanLifecycleDialog(membership: ApiRecord, action: 'upgrade' | 'downgrade'): void {
    const plan = this.membershipPlans().find((item) => item.id === this.quickLifecyclePlanId);
    if (!plan) {
      this.error.set('Select a target plan for upgrade or downgrade.');
      return;
    }
    this.renewalMembership.set(null);
    const summary = this.buildLifecycleSummary(membership, plan, action);
    this.lifecycleForm.reset({
      targetPlanId: plan.id,
      payableAmount: Number(summary.payableAmount || 0),
      refundAmount: Number(summary.refundAmount || 0),
      paymentMode: action === 'downgrade' ? 'credit_note' : 'cash',
      staffId: '',
      referenceNo: '',
      effectiveDate: new Date().toISOString().slice(0, 10),
      validityDays: Number(plan.validityDays || 365),
      addCredits: 0,
      reason: '',
      zeroReason: '',
      note: `${action} to ${plan.name}`
    });
    this.lifecycleDialog.set({ action, membership, targetPlan: plan, summary });
    this.refreshProrationPreview();
  }

  cancelMembership(membership: ApiRecord): void {
    this.renewalMembership.set(null);
    const summary = this.buildLifecycleSummary(membership, null, 'cancel');
    this.lifecycleForm.reset({
      targetPlanId: '',
      payableAmount: 0,
      refundAmount: 0,
      paymentMode: 'no_payment',
      staffId: '',
      referenceNo: '',
      effectiveDate: new Date().toISOString().slice(0, 10),
      validityDays: 0,
      addCredits: 0,
      reason: '',
      zeroReason: '',
      note: 'Cancelled from membership desk'
    });
    this.lifecycleDialog.set({ action: 'cancel', membership, targetPlan: null, summary });
  }

  closeLifecycleDialog(): void {
    if (this.saving()) return;
    this.lifecycleDialog.set(null);
  }

  syncLifecycleTargetPlan(): void {
    const dialog = this.lifecycleDialog();
    if (!dialog || dialog.action === 'cancel') return;
    const plan = this.membershipPlans().find((item) => item.id === this.lifecycleForm.value.targetPlanId);
    if (!plan) return;
    const summary = this.buildLifecycleSummary(dialog.membership, plan, dialog.action);
    this.lifecycleForm.patchValue({
      payableAmount: Number(summary.payableAmount || 0),
      refundAmount: Number(summary.refundAmount || 0),
      validityDays: Number(plan.validityDays || 365),
      note: `${dialog.action} to ${plan.name}`
    });
    this.lifecycleDialog.set({ ...dialog, targetPlan: plan, summary });
    this.refreshProrationPreview();
  }

  refreshProrationPreview(): void {
    const dialog = this.lifecycleDialog();
    if (!dialog || dialog.action === 'cancel') return;
    const targetPlanId = String(this.lifecycleForm.value.targetPlanId || dialog.targetPlan?.id || '');
    if (!targetPlanId) return;
    const request = {
      action: dialog.action,
      targetPlanId,
      effectiveDate: this.lifecycleForm.value.effectiveDate || new Date().toISOString().slice(0, 10),
      validityDays: Number(this.lifecycleForm.value.validityDays || dialog.targetPlan?.validityDays || 365),
      addCredits: Number(this.lifecycleForm.value.addCredits || 0)
    };
    this.prorationLoading.set(true);
    this.api.post<ApiRecord>(`membership-enterprise/memberships/${dialog.membership.id}/proration-preview`, request).subscribe({
      next: (preview) => {
        const active = this.lifecycleDialog();
        if (!active || active.membership.id !== dialog.membership.id || active.action !== dialog.action) {
          this.prorationLoading.set(false);
          return;
        }
        const refundAmount = Number(preview['refundAmount'] || preview['creditNoteAmount'] || 0);
        this.lifecycleForm.patchValue({
          payableAmount: Number(preview['payableAmount'] || 0),
          refundAmount
        });
        this.lifecycleDialog.set({ ...active, summary: preview });
        this.prorationLoading.set(false);
      },
      error: (error) => {
        this.error.set(error?.error?.error || 'Unable to calculate membership proration');
        this.prorationLoading.set(false);
      }
    });
  }

  confirmLifecycleAction(): void {
    const dialog = this.lifecycleDialog();
    if (!dialog || this.lifecycleForm.invalid) return;
    if (dialog.action !== 'cancel' && !dialog.targetPlan) {
      this.error.set('Target plan required hai.');
      return;
    }
    const value = this.lifecycleForm.value;
    const payableAmount = Number(dialog.summary.payableAmount ?? value.payableAmount ?? 0);
    const refundAmount = Number(dialog.summary.refundAmount ?? dialog.summary.creditNoteAmount ?? value.refundAmount ?? 0);
    const reason = String(value.reason || '').trim();
    const zeroReason = String(value.zeroReason || '').trim();
    if (dialog.action === 'cancel' && !reason) {
      this.error.set('Cancel reason required hai.');
      return;
    }
    if (dialog.action === 'upgrade' && payableAmount <= 0 && !zeroReason) {
      this.error.set('Reason is required for ₹0 upgrade.');
      return;
    }
    const plan = dialog.targetPlan;
    const payload: ApiRecord = {
      confirmed: true,
      paymentMode: value.paymentMode || (dialog.action === 'cancel' ? 'no_payment' : 'cash'),
      staffId: value.staffId || '',
      staffName: this.staffName(String(value.staffId || '')),
      referenceNo: value.referenceNo || '',
      effectiveDate: value.effectiveDate || new Date().toISOString().slice(0, 10),
      reason,
      zeroReason,
      note: value.note || (dialog.action === 'cancel' ? 'Cancelled from membership desk' : `${dialog.action} to ${plan?.name || 'plan'}`),
      amount: dialog.action === 'downgrade' ? refundAmount : payableAmount,
      paidAmount: dialog.action === 'downgrade' ? 0 : payableAmount,
      payableAmount,
      refundAmount,
      creditNoteAmount: refundAmount,
      validityDays: Number(value.validityDays || dialog.summary.targetPlan?.validityDays || plan?.validityDays || 365),
      validityDate: dialog.summary.newExpiryDate || '',
      addCredits: Number(value.addCredits || 0),
      quote: dialog.summary
    };
    if (plan) {
      payload['planId'] = plan.id;
      payload['targetPlanId'] = plan.id;
      payload['planName'] = plan.name;
      payload['price'] = plan.price;
      payload['discountPercent'] = plan.discountPercent;
      payload['serviceCredits'] = [{ type: 'bill_discount', percent: plan.discountPercent, planId: plan.id }];
    }
    this.lifecycle(dialog.membership, dialog.action, payload);
  }

  lifecycle(membership: ApiRecord, action: LifecycleAction, payload: ApiRecord): void {
    this.saving.set(true);
    this.api.post(`membership-enterprise/memberships/${membership.id}/${action}`, payload).subscribe({
      next: (result) => {
        const response = result as ApiRecord;
        if (response?.['pendingApproval']) {
          this.message.set(response['message'] || `Membership ${action} approval request created. Membership has not changed yet.`);
        } else {
          this.message.set(`Membership ${action} completed.`);
        }
        this.saving.set(false);
        if (action === 'renew') this.renewalMembership.set(null);
        if (action !== 'renew') this.lifecycleDialog.set(null);
        this.load();
      },
      error: (error) => {
        this.error.set(error?.error?.error || `Unable to ${action} membership`);
        this.saving.set(false);
      }
    });
  }

  lifecycleTitle(action: Exclude<LifecycleAction, 'renew'>): string {
    const labels: Record<Exclude<LifecycleAction, 'renew'>, string> = {
      upgrade: 'Upgrade membership',
      downgrade: 'Downgrade membership',
      cancel: 'Cancel membership'
    };
    return labels[action];
  }

  lifecycleConfirmLabel(action: Exclude<LifecycleAction, 'renew'>): string {
    if (action === 'cancel') return 'Confirm cancellation';
    return action === 'upgrade' ? 'Confirm payment & upgrade' : 'Confirm downgrade';
  }

  lifecyclePayableAmount(): number {
    return Number(this.lifecycleForm.value.payableAmount || 0);
  }

  lifecycleRefundAmount(): number {
    return Number(this.lifecycleForm.value.refundAmount || 0);
  }

  isRenewalZeroAmount(): boolean {
    return Number(this.renewalForm.value.paidAmount || 0) <= 0;
  }

  requiresLifecycleZeroReason(action: Exclude<LifecycleAction, 'renew'>): boolean {
    return action === 'upgrade' && this.lifecyclePayableAmount() <= 0;
  }

  buildLifecycleSummary(membership: ApiRecord, plan: PosMembershipPlan | null, action: Exclude<LifecycleAction, 'renew'>): ApiRecord {
    const today = new Date().toISOString().slice(0, 10);
    const dateOnly = (value: unknown) => String(value || today).slice(0, 10);
    const daysBetween = (startDate: string, endDate: string) => {
      const start = new Date(`${dateOnly(startDate)}T00:00:00.000Z`).getTime();
      const end = new Date(`${dateOnly(endDate)}T00:00:00.000Z`).getTime();
      if (Number.isNaN(start) || Number.isNaN(end)) return 0;
      return Math.max(Math.ceil((end - start) / 86400000), 0);
    };
    const addDays = (baseDate: string, days: number) => {
      const date = new Date(`${dateOnly(baseDate)}T00:00:00.000Z`);
      date.setUTCDate(date.getUTCDate() + Number(days || 0));
      return date.toISOString().slice(0, 10);
    };
    const oldPrice = this.roundMoney(Number(membership.price || 0));
    const newPrice = this.roundMoney(Number(plan?.price || 0));
    const priceDifference = this.roundMoney(newPrice - oldPrice);
    const effectiveDate = dateOnly(this.lifecycleForm.value.effectiveDate || today);
    const currentExpiry = membership.validityDate ? dateOnly(membership.validityDate) : '';
    const startDate = dateOnly(this.membershipTakenDate(membership) || membership.createdAt || today);
    const fallbackDays = Math.max(Number(plan?.validityDays || 365), 1);
    const usedDays = currentExpiry ? daysBetween(startDate, effectiveDate) : 0;
    const remainingDays = currentExpiry ? daysBetween(effectiveDate, currentExpiry) : 0;
    const totalDays = Math.max(currentExpiry ? daysBetween(startDate, currentExpiry) : fallbackDays, usedDays + remainingDays, fallbackDays, 1);
    const unusedValue = currentExpiry ? this.roundMoney(oldPrice * (remainingDays / totalDays)) : 0;
    const targetValue = newPrice;
    const proratedAdjustment = this.roundMoney(targetValue - unusedValue);
    const payableAmount = action === 'downgrade' ? Math.max(proratedAdjustment, 0) : Math.max(proratedAdjustment, 0);
    const creditNoteAmount = action === 'downgrade' ? Math.max(this.roundMoney(-proratedAdjustment), 0) : 0;
    const refundAmount = creditNoteAmount;
    const validityDays = Math.max(Number(plan?.validityDays || 365), 1);
    return {
      action,
      currentPlan: {
        id: '',
        name: membership.planName || 'Membership',
        price: oldPrice,
        validityDays: totalDays,
        discountPercent: this.membershipDiscount(membership)
      },
      targetPlan: plan,
      currentExpiry,
      effectiveDate,
      startDate,
      oldPrice,
      newPrice,
      priceDifference,
      usedDays,
      remainingDays,
      totalDays,
      unusedValue,
      targetValue,
      proratedAdjustment,
      payableAmount,
      creditNoteAmount,
      refundAmount,
      newExpiryDate: addDays(effectiveDate, validityDays),
      creditCarryForward: {
        existingCredits: Number(membership.creditsRemaining || 0),
        addCredits: 0,
        carryForwardCredits: Number(membership.creditsRemaining || 0),
        rule: 'Unused active credits carry forward into the new membership state.'
      },
      suggestedAction: action === 'downgrade' ? 'Approve credit note/refund before downgrading.' : 'Collect payable difference before upgrading.',
      warnings: []
    };
  }

  roundMoney(value: number): number {
    return Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
  }

  saveFamilyMember(): void {
    if (this.familyForm.invalid) return;
    this.saving.set(true);
    this.api.post('membership-enterprise/family', this.familyForm.value).subscribe({
      next: () => {
        this.message.set('Family membership link saved.');
        this.saving.set(false);
        this.load();
      },
      error: (error) => {
        this.error.set(error?.error?.error || 'Unable to link family member');
        this.saving.set(false);
      }
    });
  }

  generateReminders(): void {
    this.api.post('membership-enterprise/reminders/generate', {}).subscribe({
      next: (result) => {
        this.message.set(`${(result as ApiRecord)?.count || 0} renewal reminders queued.`);
        this.load();
      },
      error: (error) => this.error.set(error?.error?.error || 'Unable to generate reminders')
    });
  }

  approveReminder(reminder: ApiRecord): void {
    this.api.post(`membership-enterprise/reminders/${reminder.id}/approve`, {}).subscribe({
      next: () => {
      this.message.set('Reminder approved. It can be sent from the WhatsApp queue when the provider is configured.');
        this.load();
      },
      error: (error) => this.error.set(error?.error?.error || 'Unable to approve reminder')
    });
  }

  retryAutoRenew(item: ApiRecord): void {
    this.saving.set(true);
    this.api.post(`membership-enterprise/auto-renew/${item['membershipId']}/retry`, {
      note: 'Manual auto-renew retry from membership desk'
    }).subscribe({
      next: (result) => {
        const retry = (result as ApiRecord)?.['retry'] as ApiRecord | undefined;
        this.message.set(`Auto-renew retry logged: ${retry?.['failureReason'] || 'provider confirmation required'}. Membership was not extended.`);
        this.saving.set(false);
        this.load();
      },
      error: (error) => {
        this.error.set(error?.error?.error || 'Unable to retry auto-renew');
        this.saving.set(false);
      }
    });
  }

  pauseAutoRenew(item: ApiRecord): void {
    this.saving.set(true);
    this.api.post(`membership-enterprise/auto-renew/${item['membershipId']}/pause`, {
      reason: 'Paused from membership desk'
    }).subscribe({
      next: () => {
        this.message.set('Auto-renew paused. Membership data safe hai.');
        this.saving.set(false);
        this.load();
      },
      error: (error) => {
        this.error.set(error?.error?.error || 'Unable to pause auto-renew');
        this.saving.set(false);
      }
    });
  }

  resumeAutoRenew(item: ApiRecord): void {
    this.saving.set(true);
    this.api.post(`membership-enterprise/auto-renew/${item['membershipId']}/resume`, {
      note: 'Resumed from membership desk'
    }).subscribe({
      next: () => {
        this.message.set('Auto-renew resumed. If payment method is missing, it moved to the reminder queue.');
        this.saving.set(false);
        this.load();
      },
      error: (error) => {
        this.error.set(error?.error?.error || 'Unable to resume auto-renew');
        this.saving.set(false);
      }
    });
  }

  reviewRiskSignal(signal: ApiRecord): void {
    const id = String(signal['id'] || '');
    if (!id) return;
    this.saving.set(true);
    this.api.post(`membership-enterprise/risk-signals/${id}/review`, {
      reviewStatus: 'reviewed',
      note: `Reviewed ${signal['code'] || 'membership risk'} from membership desk`,
      riskLevel: signal['riskLevel'] || '',
      branchId: signal['branchId'] || '',
      membershipId: signal['membershipId'] || '',
      clientId: signal['clientId'] || ''
    }).subscribe({
      next: () => {
        this.message.set('Membership risk signal reviewed and audit log created.');
        this.saving.set(false);
        this.load();
      },
      error: (error) => {
        this.error.set(error?.error?.error || 'Unable to review membership risk');
        this.saving.set(false);
      }
    });
  }

  loadClientEligibility(clientId: string): void {
    if (!clientId) {
      this.eligibility.set(null);
      this.membershipWallet.set(null);
      return;
    }
    forkJoin({
      eligibility: this.api.list<ApiRecord>(`membership-enterprise/client/${clientId}/eligibility`).pipe(catchError(() => of(null))),
      wallet: this.api.list<ApiRecord>(`membership-enterprise/client/${clientId}/wallet`).pipe(catchError(() => of(null)))
    }).subscribe({
      next: ({ eligibility, wallet }) => {
        this.eligibility.set(eligibility);
        this.membershipWallet.set(wallet || (eligibility?.['wallet'] as ApiRecord | null) || null);
      },
      error: () => {
        this.eligibility.set(null);
        this.membershipWallet.set(null);
      }
    });
  }

  saveGiftCard(): void {
    if (this.giftForm.invalid) return;
    this.saving.set(true);
    const value = this.giftForm.value;
    this.api.create('giftCards', { ...value, balance: value.initialValue, redeemHistory: [] }).subscribe({
      next: () => {
        this.saving.set(false);
        this.message.set('Gift card saved.');
        this.load();
      },
      error: (error) => {
        this.error.set(error?.error?.error || 'Unable to save gift card');
        this.saving.set(false);
      }
    });
  }

  activeMembershipPlans(): PosMembershipPlan[] {
    return this.membershipPlans().filter((plan) => plan.active && plan.status !== 'inactive');
  }

  activeMemberships(): ApiRecord[] {
    const today = new Date().toISOString().slice(0, 10);
    return this.memberships().filter((membership) => membership.status === 'active' && (!membership.validityDate || membership.validityDate >= today));
  }

  selectedClient(): ApiRecord | null {
    const clientId = String(this.membershipForm.value.clientId || '');
    if (!clientId) return null;
    return this.clients().find((client) => client.id === clientId) || null;
  }

  selectedPlan(): PosMembershipPlan | null {
    const planId = String(this.membershipForm.value.planId || '');
    if (!planId) return null;
    return this.membershipPlans().find((plan) => plan.id === planId) || null;
  }

  selectedClientMemberships(): ApiRecord[] {
    const clientId = String(this.membershipForm.value.clientId || '');
    if (!clientId) return [];
    return this.activeMemberships().filter((membership) => membership.clientId === clientId);
  }

  selectedClientBenefitsLabel(): string {
    const rows = this.selectedClientMemberships();
    const membershipCount = rows.filter((membership) => this.membershipBenefitType(membership) === 'membership').length;
    const packageCount = rows.filter((membership) => this.membershipBenefitType(membership) === 'package').length;
    const parts = [];
    if (membershipCount) parts.push(`${membershipCount} active membership${membershipCount === 1 ? '' : 's'}`);
    if (packageCount) parts.push(`${packageCount} active package${packageCount === 1 ? '' : 's'}`);
    return parts.join(' · ') || 'No active benefits';
  }

  totalMemberCount(): number {
    const reported = Number(this.report().metrics?.totalMembers || 0);
    if (reported) return reported;
    return new Set(this.memberships().map((membership) => membership.clientId).filter(Boolean)).size || this.memberships().length;
  }

  activeMemberCount(): number {
    const reported = Number(this.report().metrics?.activeMembers || 0);
    if (reported) return reported;
    return new Set(this.activeMemberships().map((membership) => membership.clientId).filter(Boolean)).size || this.activeMemberships().length;
  }

  clientName(id: string): string {
    return this.clients().find((client) => client.id === id)?.name || id;
  }

  staffById(id: string): ApiRecord | null {
    if (!id) return null;
    return this.staffMembers().find((staff) => staff.id === id || staff['staffId'] === id) || null;
  }

  staffName(id: string): string {
    const staff = this.staffById(id);
    return String(staff?.['name'] || staff?.['fullName'] || [staff?.['firstName'], staff?.['lastName']].filter(Boolean).join(' ') || id || '');
  }

  staffOption(staff: ApiRecord): string {
    const name = this.staffName(String(staff.id || staff['staffId'] || ''));
    const role = staff['role'] || staff['designation'] || staff['category'] || '';
    return role ? `${name} · ${role}` : name;
  }

  branchOptions(): string[] {
    const branchIds = [
      ...this.memberships().map((membership) => membership.branchId),
      ...this.ledger().map((row) => row.branchId),
      ...this.autoRenewQueue().map((row) => row.branchId),
      ...this.membershipPlans().map((plan) => (plan as ApiRecord)['branchId'])
    ].filter(Boolean).map(String);
    return [...new Set(branchIds)].sort((a, b) => a.localeCompare(b));
  }

  reportMetric(key: string): number {
    return Number(this.enterpriseReport().metrics?.[key] || 0);
  }

  reportSet(key: string): ApiRecord[] {
    return this.enterpriseReport().reports?.[key] || [];
  }

  reportFilterParams(): ApiRecord {
    return {
      fromDate: this.reportFilters.fromDate || '',
      toDate: this.reportFilters.toDate || '',
      branchId: this.reportFilters.branchId || '',
      planId: this.reportFilters.planId || '',
      staffId: this.reportFilters.staffId || '',
      clientId: this.reportFilters.clientId || '',
      status: this.reportFilters.status || '',
      paymentMode: this.reportFilters.paymentMode || '',
      riskLevel: this.reportFilters.riskLevel === 'all' ? '' : this.reportFilters.riskLevel
    };
  }

  loadEnterpriseReports(): void {
    this.saving.set(true);
    this.error.set('');
    this.api.list<MembershipEnterpriseReport>('membership-enterprise/reports/enterprise', this.reportFilterParams()).pipe(
      catchError((error) => {
        this.error.set(error?.error?.error || error?.message || 'Unable to load membership reports');
        return of({} as MembershipEnterpriseReport);
      })
    ).subscribe((report) => {
      this.enterpriseReport.set(report || {});
      this.saving.set(false);
      if (report?.generatedAt) this.message.set('Membership reports refreshed.');
    });
  }

  exportMembershipReportsCsv(): void {
    const rows = this.membershipReportRowsForExport();
    const headers = Object.keys(rows[0] || { report: '', note: '' });
    const csv = [
      headers.join(','),
      ...rows.map((row) => headers.map((header) => this.csvCell(row[header])).join(','))
    ].join('\n');
    this.downloadFile(`membership-enterprise-reports-${this.exportDateKey()}.csv`, csv, 'text/csv;charset=utf-8');
  }

  exportMembershipReportsPdf(): void {
    const metrics = this.enterpriseReport().metrics || {};
    const rows = this.membershipReportRowsForExport().slice(0, 42);
    const lines = [
      'AuraShine Membership Enterprise Reports',
      `Generated: ${this.enterpriseReport().generatedAt || new Date().toISOString()}`,
      `Active members: ${metrics['activeMembers'] || 0}`,
      `Expiring soon: ${metrics['expiringSoon'] || 0}`,
      `Renewal revenue: Rs ${metrics['renewalRevenue'] || 0}`,
      `Cancelled memberships: ${metrics['cancelledMemberships'] || 0}`,
      `Staff-wise sales: ${metrics['staffWiseSales'] || 0}`,
      `Plan profitability rows: ${metrics['planWiseProfitability'] || 0}`,
      `Credit liability: Rs ${metrics['creditLiability'] || 0}`,
      `Auto-renew failed payments: ${metrics['autoRenewFailedPayments'] || 0}`,
      `Action queue: ${metrics['actionQueue'] || 0}`,
      `Upgrade/downgrade rows: ${metrics['upgradeDowngrade'] || 0}`,
      `Discount leakage: Rs ${metrics['discountLeakage'] || 0}`,
      ...rows.map((row) => `${row['report']}: ${row['primary'] || row['clientName'] || row['planName'] || row['staffName'] || ''} ${row['amount'] || row['value'] || ''}`)
    ];
    this.downloadFile(`membership-enterprise-reports-${this.exportDateKey()}.pdf`, this.simplePdf(lines), 'application/pdf');
  }

  commissionMetric(key: string): number {
    return Number(this.commissionReport().metrics?.[key] || 0);
  }

  riskMetric(key: string): number {
    return Number(this.riskReport().metrics?.[key] || 0);
  }

  filteredRiskSignals(): ApiRecord[] {
    const signals = this.riskReport().signals || [];
    if (this.riskFilter === 'all') return signals;
    return signals.filter((signal) => signal['riskLevel'] === this.riskFilter);
  }

  riskBadgeClass(level: string): string {
    return `risk-badge risk-${level || 'low'}${level === 'critical' || level === 'high' ? ' danger' : ''}`;
  }

  actionQueueTypeLabel(type: string): string {
    const labels: Record<string, string> = {
      expiry_alert: 'Expiry alert',
      auto_renew_recovery: 'Auto-renew recovery',
      credit_liability: 'Wallet liability',
      package_profitability: 'Package profitability',
      risk_review: 'Risk review'
    };
    return labels[type] || type || 'Action';
  }

  actionQueueValue(row: ApiRecord): string {
    if (row['queueType'] === 'credit_liability' || row['queueType'] === 'package_profitability') {
      return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(Number(row['amount'] || 0));
    }
    if (row['queueType'] === 'expiry_alert') return `${row['value'] ?? '-'} days`;
    if (row['queueType'] === 'auto_renew_recovery') return `${row['value'] || 0} retries`;
    if (row['queueType'] === 'risk_review') return `${row['value'] || 0} score`;
    return String(row['value'] ?? row['amount'] ?? '-');
  }

  riskTitle(signal: ApiRecord): string {
    return String(signal['code'] || 'membership_risk').replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
  }

  riskReason(signal: ApiRecord): string {
    const reasons = signal['reasons'];
    return Array.isArray(reasons) ? reasons.join(' ') : String(signal['reason'] || '');
  }

  riskEvidenceLabel(signal: ApiRecord): string {
    const evidence = signal['evidence'] as ApiRecord | ApiRecord[] | undefined;
    if (Array.isArray(evidence)) return `${evidence.length} related events`;
    if (evidence?.['invoiceId']) return `Invoice ${evidence['invoiceId']}`;
    if (evidence?.['membershipId']) return `Membership ${evidence['membershipId']}`;
    if (signal['membershipId']) return `Membership ${signal['membershipId']}`;
    return signal['code'] || 'risk evidence';
  }

  clientWalletOption(client: ApiRecord): string {
    const active = this.activeMemberships().find((membership) => membership.clientId === client.id);
    const walletBalance = Number(client.walletBalance || 0);
    const plan = active?.['planName'] ? ` · ${active['planName']}` : ' · No active benefits';
    const credits = active ? ` · ${Number(active['creditsRemaining'] || 0)} cr` : '';
    return `${client.name || client.fullName || client.id} · ${client.phone || client.email || client.id} · Wallet ₹${walletBalance}${plan}${credits}`;
  }

  membershipBenefitType(membership: ApiRecord): 'membership' | 'package' {
    const history = Array.isArray(membership.redeemHistory) ? membership.redeemHistory : [];
    if (history.some((item) => item?.type === 'package_sale' || item?.packageId)) return 'package';
    if (String(membership.planName || '').trim().toLowerCase().startsWith('package:')) return 'package';
    const credits = Array.isArray(membership.serviceCredits) ? membership.serviceCredits : [];
    if (credits.some((item) => item?.packageId)) return 'package';
    return 'membership';
  }

  membershipBenefitTypeLabel(membership: ApiRecord): string {
    return this.membershipBenefitType(membership) === 'package' ? 'Package' : 'Membership';
  }

  packageNamesLabel(wallet: ApiRecord): string {
    const names = Array.isArray(wallet?.['packageSummary']?.['names']) ? wallet['packageSummary']['names'].filter(Boolean) : [];
    if (!names.length) return 'No active package';
    return names.slice(0, 2).join(', ');
  }

  membershipDiscount(membership: ApiRecord): number {
    const credits = Array.isArray(membership.serviceCredits) ? membership.serviceCredits : [];
    const benefit = credits.find((item) => item?.type === 'bill_discount');
    return Number(benefit?.percent || 0);
  }

  membershipTakenDate(membership: ApiRecord): string {
    const history = Array.isArray(membership.redeemHistory) ? membership.redeemHistory : [];
    const sold = history.find((item) => item?.type === 'membership_sale' || item?.type === 'package_sale' || item?.type === 'manual_membership_assignment');
    return sold?.date || membership.createdAt || '';
  }

  membershipDaysLeft(membership: ApiRecord): number {
    if (!membership.validityDate) return 99999;
    const expiry = new Date(String(membership.validityDate)).getTime();
    const todayMs = new Date(new Date().toISOString().slice(0, 10)).getTime();
    if (Number.isNaN(expiry)) return 99999;
    return Math.ceil((expiry - todayMs) / 86400000);
  }

  membershipDaysLeftLabel(membership: ApiRecord): string {
    if (!membership.validityDate) return 'No expiry';
    const days = this.membershipDaysLeft(membership);
    if (days < 0) return `Expired ${Math.abs(days)}d ago`;
    if (days === 0) return 'Expires today';
    return `${days}d left`;
  }

  paymentLabel(row: ApiRecord): string {
    const payment = (row.snapshot as ApiRecord | undefined)?.['payment'] as ApiRecord | undefined;
    const mode = String(payment?.['mode'] || '').replace(/_/g, ' ');
    const ref = payment?.['referenceNo'] ? ` · ${payment['referenceNo']}` : '';
    return mode ? `${mode}${ref}` : '-';
  }

  autoRenewStatusLabel(item: ApiRecord): string {
    const label = String(item['status'] || '').replace(/_/g, ' ');
    if (item['failedPayment']) return 'failed payment';
    return label || 'pending';
  }

  onSelfServiceClientChanged(): void {
    const memberships = this.selectedSelfServiceClientMemberships();
    this.selfServiceMembershipId = String(memberships[0]?.id || '');
    this.selfServiceSummary.set(null);
    this.selfServiceLastLink = '';
  }

  selectedSelfServiceClientMemberships(): ApiRecord[] {
    if (!this.selfServiceClientId) return [];
    return this.memberships().filter((membership) => String(membership.clientId || '') === String(this.selfServiceClientId));
  }

  loadSelfServiceSummary(): void {
    if (!this.selfServiceClientId) {
      this.error.set('Select a client for self-service.');
      return;
    }
    this.saving.set(true);
    this.error.set('');
    this.api.list<ApiRecord>(`membership-enterprise/client/${this.selfServiceClientId}/self-service`, {
      membershipId: this.selfServiceMembershipId || ''
    }).pipe(
      catchError((error) => {
        this.error.set(error?.error?.error || error?.message || 'Unable to load self-service summary');
        return of(null);
      })
    ).subscribe((summary) => {
      this.saving.set(false);
      this.selfServiceSummary.set(summary);
      if (summary?.['membershipId'] && !this.selfServiceMembershipId) this.selfServiceMembershipId = String(summary['membershipId']);
      this.message.set(summary ? 'Client self-service summary loaded.' : '');
    });
  }

  createSelfServiceStatusLink(): void {
    if (!this.selfServiceClientId) {
      this.error.set('Select a client for status link.');
      return;
    }
    const baseUrl = window.location.origin;
    this.selfServiceMutation(
      this.api.post<ApiRecord>(`membership-enterprise/client/${this.selfServiceClientId}/self-service/status-link`, {
        membershipId: this.selfServiceMembershipId || '',
        baseUrl
      }),
      'Membership status link generated.',
      (result) => {
        this.selfServiceLastLink = String(result['link'] || '');
        this.selfServiceSummary.set((result['summary'] as ApiRecord) || this.selfServiceSummary());
      }
    );
  }

  createWhatsAppSummary(): void {
    if (!this.selfServiceClientId) {
      this.error.set('Select a client for WhatsApp summary.');
      return;
    }
    this.selfServiceMutation(
      this.api.post<ApiRecord>(`membership-enterprise/client/${this.selfServiceClientId}/self-service/whatsapp-summary`, {
        membershipId: this.selfServiceMembershipId || ''
      }),
      'WhatsApp membership summary prepared. Provider send is still manual/placeholder.',
      (result) => {
        const previous = this.selfServiceSummary() || {};
        this.selfServiceSummary.set({ ...previous, whatsappSummary: result['message'] || previous['whatsappSummary'] });
      }
    );
  }

  createSelfServiceRenewLink(): void {
    if (!this.selfServiceMembershipId) {
      this.error.set('Select a membership for renew link.');
      return;
    }
    this.selfServiceMutation(
      this.api.post<ApiRecord>(`membership-enterprise/memberships/${this.selfServiceMembershipId}/self-service/renew-link`, {}),
      'Renew payment link placeholder request created. No membership extension applied.'
    );
  }

  createSelfServicePaymentMethodUpdate(): void {
    if (!this.selfServiceMembershipId) {
      this.error.set('Select a membership to update payment method.');
      return;
    }
    this.selfServiceMutation(
      this.api.post<ApiRecord>(`membership-enterprise/memberships/${this.selfServiceMembershipId}/self-service/payment-method-update`, {
        reason: 'Membership desk requested payment method update placeholder'
      }),
      'Payment method update placeholder request created. No payment data stored.'
    );
  }

  createSelfServiceCancelRequest(): void {
    if (!this.selfServiceMembershipId || !this.selfServiceCancelReason.trim()) {
      this.error.set('Membership and reason are required for cancellation request.');
      return;
    }
    this.selfServiceMutation(
      this.api.post<ApiRecord>(`membership-enterprise/memberships/${this.selfServiceMembershipId}/self-service/cancel-request`, {
        reason: this.selfServiceCancelReason.trim()
      }),
      'Cancellation request has been created for approval. Membership is not cancelled yet.'
    );
  }

  createManualCreditAdjustmentRequest(): void {
    if (!this.selfServiceMembershipId || !this.selfServiceCreditReason.trim()) {
      this.error.set('Membership and reason are required for manual credit adjustment.');
      return;
    }
    this.selfServiceMutation(
      this.api.post<ApiRecord>(`membership-enterprise/memberships/${this.selfServiceMembershipId}/credit-adjustment-request`, {
        creditDelta: Number(this.selfServiceCreditDelta || 0),
        reason: this.selfServiceCreditReason.trim()
      }),
      'Manual credit adjustment has been created for approval. Credits are not changed yet.'
    );
  }

  approveSelfServiceRequest(request: ApiRecord): void {
    this.selfServiceMutation(
      this.api.post<ApiRecord>(`membership-enterprise/self-service/requests/${request['id']}/approve`, {
        reason: 'Approved from membership desk'
      }),
      'Self-service request approved.'
    );
  }

  rejectSelfServiceRequest(request: ApiRecord): void {
    this.selfServiceMutation(
      this.api.post<ApiRecord>(`membership-enterprise/self-service/requests/${request['id']}/reject`, {
        rejectionReason: 'Rejected from membership desk'
      }),
      'Self-service request rejected without changing membership.'
    );
  }

  refreshSelfServiceRequests(): void {
    this.saving.set(true);
    this.api.list<ApiRecord[]>('membership-enterprise/self-service/requests', { limit: 100 }).pipe(
      catchError((error) => {
        this.error.set(error?.error?.error || error?.message || 'Unable to load self-service requests');
        return of([] as ApiRecord[]);
      })
    ).subscribe((requests) => {
      this.selfServiceRequests.set(requests || []);
      this.saving.set(false);
    });
  }

  selfServiceLabel(value: string): string {
    return String(value || '').replace(/_/g, ' ');
  }

  private ensureSelfServiceDefaults(): void {
    if (!this.selfServiceClientId && this.clients().length) {
      this.selfServiceClientId = String(this.clients()[0].id || '');
    }
    if (!this.selfServiceMembershipId) {
      const clientMembership = this.selectedSelfServiceClientMemberships()[0];
      const fallbackMembership = this.activeMemberships()[0] || this.memberships()[0];
      this.selfServiceMembershipId = String(clientMembership?.id || fallbackMembership?.id || '');
      if (!this.selfServiceClientId && fallbackMembership?.clientId) {
        this.selfServiceClientId = String(fallbackMembership.clientId);
      }
    }
  }

  private selfServiceMutation(request: Observable<ApiRecord>, success: string, afterSuccess?: (result: ApiRecord) => void): void {
    this.saving.set(true);
    this.error.set('');
    request.pipe(
      catchError((error) => {
        this.error.set(error?.error?.error || error?.message || 'Unable to process self-service request');
        return of(null);
      })
    ).subscribe((result) => {
      this.saving.set(false);
      if (!result) return;
      afterSuccess?.(result);
      this.message.set(success);
      this.refreshSelfServiceRequests();
      if (this.selfServiceClientId) this.loadSelfServiceSummary();
    });
  }

  private membershipReportRowsForExport(): ApiRecord[] {
    const rows = this.enterpriseReport().exportRows || [];
    if (rows.length) return rows;
    return [{
      report: 'membership_reports',
      primary: 'No rows for selected filters',
      activeMembers: this.reportMetric('activeMembers'),
      expiringSoon: this.reportMetric('expiringSoon'),
      renewalRevenue: this.reportMetric('renewalRevenue'),
      creditLiability: this.reportMetric('creditLiability'),
      discountLeakage: this.reportMetric('discountLeakage'),
      generatedAt: this.enterpriseReport().generatedAt || new Date().toISOString()
    }];
  }

  private csvCell(value: unknown): string {
    return `"${String(value ?? '').replace(/"/g, '""')}"`;
  }

  private downloadFile(filename: string, content: string, type: string): void {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  }

  private exportDateKey(): string {
    return new Date().toISOString().slice(0, 10);
  }

  private simplePdf(lines: string[]): string {
    const safeLines = lines.slice(0, 90).map((line) => this.pdfText(line).slice(0, 115));
    const stream = [
      'BT',
      '/F1 11 Tf',
      '50 780 Td',
      '14 TL',
      ...safeLines.flatMap((line) => [`(${line}) Tj`, 'T*']),
      'ET'
    ].join('\n');
    const objects = [
      '<< /Type /Catalog /Pages 2 0 R >>\n',
      '<< /Type /Pages /Kids [3 0 R] /Count 1 >>\n',
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>\n',
      `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream\n`,
      '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\n'
    ];
    let pdf = '%PDF-1.4\n';
    const offsets: number[] = [];
    objects.forEach((object, index) => {
      offsets.push(pdf.length);
      pdf += `${index + 1} 0 obj\n${object}endobj\n`;
    });
    const xrefOffset = pdf.length;
    pdf += `xref\n0 ${objects.length + 1}\n`;
    pdf += '0000000000 65535 f \n';
    pdf += offsets.map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
    pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
    return pdf;
  }

  private pdfText(value: unknown): string {
    return String(value ?? '').replace(/[()\\]/g, ' ').replace(/[^\x20-\x7E]/g, ' ');
  }

  private normalizePlan(plan: PosMembershipPlan): PosMembershipPlan {
    return {
      ...plan,
      price: Number(plan.price || 0),
      discountPercent: Number(plan.discountPercent || 0),
      productDiscountPercent: Number(plan.productDiscountPercent || 0),
      gstRate: Number(plan.gstRate || 18),
      validityDays: Number(plan.validityDays || 365),
      status: plan.status || (plan.active === false ? 'inactive' : 'active'),
      active: plan.active !== false && plan.status !== 'inactive',
      createdAt: plan.createdAt || new Date().toISOString()
    };
  }

  private safeList<T>(resource: string, params: ApiRecord = {}) {
    return this.api.list<T>(resource, params).pipe(
      catchError((error) => {
        if (!this.error()) this.error.set(error?.error?.error || error?.message || `Unable to load ${resource}`);
        return of([] as T);
      })
    );
  }

  private quietList<T>(resource: string, params: ApiRecord = {}) {
    return this.api.list<T>(resource, params).pipe(catchError(() => of([] as T)));
  }
}
