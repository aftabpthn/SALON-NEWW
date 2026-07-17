import { CommonModule } from '@angular/common';
import { Component, OnDestroy, OnInit, computed, signal } from '@angular/core';
import { FormsModule, ReactiveFormsModule, UntypedFormBuilder, Validators } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { Observable, catchError, forkJoin, of } from 'rxjs';
import { AuthSessionService } from '../core/auth-session.service';
import { grantsAllow, staticGrantsForRole } from '../core/permission.guard';
import { routePermissionForPath } from '../core/access-rules';
import { AppStateService } from '../core/state/app-state.service';
import { ApiRecord, ApiService } from '../core/api.service';
import { PosMembershipPlan, PosSettingsService } from '../core/pos-settings.service';
import { StateComponent } from '../shared/ui/state/state.component';
import { AuraMoneyPipe } from '../shared/pipes/aura-money.pipe';
import { AuraDatePipe } from '../shared/pipes/aura-date.pipe';

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

type RewardReport = {
  ledger?: ApiRecord[];
  roi?: ApiRecord;
  expiring?: ApiRecord[];
  abuseAlerts?: ApiRecord[];
};

type MembershipDeskTab = 'overview' | 'plans' | 'active' | 'audit' | 'commission' | 'risk' | 'reports' | 'rewards' | 'reminders' | 'autoRenew';
type MembershipListFilter = 'all' | 'active' | 'renewalRisk';
type MembershipKpiTarget = MembershipListFilter | 'plans';
type PlanWorkspaceView = 'plans' | 'packages' | 'giftcards';
type MembershipReportTab = 'actionQueue' | 'activeMembers' | 'expiringSoon' | 'renewalRevenue' | 'cancelledMemberships' | 'staffWiseSales' | 'planWiseProfitability' | 'creditLiability' | 'autoRenewFailedPayments' | 'upgradeDowngrade' | 'discountLeakage' | 'membershipRedeem' | 'membershipSalesByCustomer';
type RewardDeskTab = 'ledger' | 'roi' | 'expiring' | 'abuse';
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
  imports: [AuraDatePipe, AuraMoneyPipe, CommonModule, FormsModule, ReactiveFormsModule, RouterLink, StateComponent],
  template: `
    <section class="page-stack memberships-page inner-page-shell">
      <div class="module-hero membership-hero membership-action-bar inner-page-header">
        <div class="hero-actions membership-quick-actions">
          <a class="ghost-button" routerLink="/pos" *ngIf="canAccessPath('/pos')">Sell in POS</a>
          <button class="ghost-button" type="button" (click)="openPlanWorkspace('packages')">Packages</button>
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
        <button type="button" [class.active]="activeTab() === 'rewards'" (click)="setTab('rewards')">
          Rewards <span>{{ rewardLedgerRows().length }}</span>
        </button>
        <button type="button" [class.active]="activeTab() === 'reminders'" (click)="setTab('reminders')">
          Reminders <span>{{ reminders().length }}</span>
        </button>
        <button type="button" [class.active]="activeTab() === 'autoRenew'" (click)="setTab('autoRenew')">
          Auto-renew <span>{{ autoRenewQueue().length }}</span>
        </button>
        <button class="refresh-tab" type="button" (click)="load()">Refresh</button>
      </nav>

      <section class="member-count-strip membership-summary-strip" aria-label="Membership totals">
        <button type="button" [class.active]="membershipListFilter() === 'all' && activeTab() === 'active'" (click)="openMembershipKpi('all')">
          <span>Total members</span>
          <strong>{{ totalMemberCount() }}</strong>
          <small>{{ report().metrics?.totalMemberships || memberships().length }} total memberships</small>
        </button>
        <button type="button" [class.active]="membershipListFilter() === 'active' && activeTab() === 'active'" (click)="openMembershipKpi('active')">
          <span>Active members</span>
          <strong>{{ activeMemberCount() }}</strong>
          <small>{{ report().metrics?.active || activeMemberships().length }} active plans</small>
        </button>
        <button type="button" [class.active]="activeTab() === 'plans'" (click)="openMembershipKpi('plans')">
          <span>Plans</span>
          <strong>{{ membershipPlans().length }}</strong>
          <small>{{ activeMembershipPlans().length }} visible in POS</small>
        </button>
        <button type="button" [class.active]="membershipListFilter() === 'renewalRisk' && activeTab() === 'active'" (click)="openMembershipKpi('renewalRisk')">
          <span>Renewal risk</span>
          <strong>{{ report().expiringSoon?.length || 0 }}</strong>
        </button>
      </section>

      <section class="stats-grid membership-stats inner-stats-grid" *ngIf="activeTab() === 'overview'">
        <article class="metric-card">
          <span>Total members</span>
          <strong>{{ totalMemberCount() }}</strong>
          <small>{{ activeMemberCount() }} active members</small>
        </article>
        <article class="metric-card">
          <span>Membership revenue</span>
          <strong>{{ (report().metrics?.soldRevenue || 0) | auraMoney:'1.0-0' }}</strong>
        </article>
        <article class="metric-card">
          <span>Redeemed discount</span>
          <strong>{{ (report().metrics?.redeemedDiscount || 0) | auraMoney:'1.0-0' }}</strong>
        </article>
        <article class="metric-card">
          <span>Renewal risk</span>
          <strong>{{ report().expiringSoon?.length || 0 }}</strong>
        </article>
      </section>

      <section class="membership-overview-grid" *ngIf="activeTab() === 'overview'">
        <article class="overview-card primary">
          <div>
            <h3>{{ report().expiringSoon?.length || 0 }} renewal follow-ups</h3>
          </div>
          <div class="overview-actions">
            <a class="primary-button" routerLink="/pos" *ngIf="canAccessPath('/pos')">Sell membership in POS</a>
            <button class="ghost-button" type="button" (click)="setTab('reminders')">Open reminders</button>
          </div>
        </article>

        <article class="overview-card">
          <h3>{{ activeMembershipPlans()[0]?.name || 'No active plan yet' }}</h3>
          <p>{{ activeMembershipPlans()[0]?.discountPercent || 0 }}% service discount Â· {{ activeMembershipPlans()[0]?.validityDays || 0 }} days validity.</p>
          <button class="ghost-button mini" type="button" (click)="setTab('plans')">Manage plans</button>
        </article>

        <article class="overview-card">
          <h3>{{ (report().metrics?.pendingLiability || 0) | auraMoney:'1.0-0' }}</h3>
          <p>{{ report().metrics?.creditsRemaining || 0 }} credits still available for redemption.</p>
        </article>

        <article class="overview-card">
          <h3>{{ selectedClientBenefitsLabel() }}</h3>
        </article>

        <article class="overview-card">
          <h3>{{ report().metrics?.creditsRemaining || 0 }} credits</h3>
        </article>
      </section>

      <section class="plan-reference-layout" *ngIf="activeTab() === 'plans'">
        <button class="floating-add" type="button" *ngIf="planWorkspaceView() === 'plans'" (click)="openPlanDrawer()" aria-label="Add membership plan">+</button>
        <header class="plans-title">
          <h1>Plans</h1>
        </header>

        <div class="plan-switch-grid" aria-label="Plan workspace selector">
          <button type="button" [class.active]="planWorkspaceView() === 'plans'" (click)="planWorkspaceView.set('plans')">
            <span>Membership plans</span>
            <strong>{{ membershipPlans().length }}</strong>
          </button>
          <button type="button" [class.active]="planWorkspaceView() === 'packages'" (click)="planWorkspaceView.set('packages')">
            <span>Service packages</span>
            <strong>{{ packageRecords().length }}</strong>
          </button>
          <button type="button" [class.active]="planWorkspaceView() === 'giftcards'" (click)="planWorkspaceView.set('giftcards')">
            <span>Gift cards</span>
            <strong>{{ giftCards().length }}</strong>
          </button>
        </div>

        <div class="list-controls" *ngIf="planWorkspaceView() === 'plans'">
          <label class="show-control">
            <span>Show</span>
            <select [ngModel]="planShowLimit()" (ngModelChange)="planShowLimit.set(numberValue($event))">
              <option [ngValue]="10">10</option>
              <option [ngValue]="25">25</option>
              <option [ngValue]="50">50</option>
            </select>
          </label>
          <label class="search-pill">
            <span class="sr-only">Search plans</span>
            <input [ngModel]="planQuery()" (ngModelChange)="planQuery.set($event)" placeholder="Search" />
          </label>
        </div>

        <div class="plan-table-wrap inner-table-wrap" *ngIf="planWorkspaceView() === 'plans'">
          <table class="plan-table">
            <thead>
              <tr>
                <th class="check-col"><input type="checkbox" aria-label="Select all plans" /></th>
                <th>Name</th>
                <th>Price</th>
                <th>Sold</th>
                <th>Status</th>
                <th class="action-col">Action</th>
              </tr>
            </thead>
            <tbody>
              <tr *ngFor="let plan of visibleMembershipPlans()">
                <td class="check-col"><input type="checkbox" [attr.aria-label]="'Select ' + plan.name" /></td>
                <td>
                  <div class="plan-name-cell">
                    <span class="plan-avatar">{{ planInitial(plan) }}</span>
                    <div>
                      <strong>{{ plan.name }}</strong>
                      <small>{{ planSummary(plan) }}</small>
                    </div>
                  </div>
                </td>
                <td>{{ plan.price | auraMoney:'1.0-0' }}</td>
                <td>{{ planSoldCount(plan) }}</td>
                <td><span class="status-pill">{{ plan.status || (plan.active ? 'Active' : 'Inactive') }}</span></td>
                <td class="action-cell">
                  <button class="dots-button" type="button" (click)="togglePlanAction(plan, $event)" aria-label="Plan actions">...</button>
                  <div class="action-menu" *ngIf="openPlanActionId() === plan.id">
                    <button type="button" (click)="editPlan(plan)">Edit</button>
                    <a [routerLink]="['/memberships', plan.id]" (click)="openPlanActionId.set('')">360</a>
                    <button type="button" (click)="markPlanInactive(plan)">Inactive Status</button>
                  </div>
                </td>
              </tr>
              <tr *ngIf="!visibleMembershipPlans().length">
                <td class="empty-row" colspan="6">No plan found. Plus button se discount ya prepaid credit plan banao.</td>
              </tr>
            </tbody>
          </table>
        </div>

        <footer class="list-footer" *ngIf="planWorkspaceView() === 'plans'">
          <span>Showing 1 to {{ visibleMembershipPlans().length }} of {{ filteredMembershipPlans().length }} Entries</span>
          <div class="pager">
            <button type="button" disabled>Previous</button>
            <button class="active" type="button">1</button>
            <button type="button" disabled>Next</button>
          </div>
        </footer>

        <div class="plan-table-wrap inner-table-wrap" *ngIf="planWorkspaceView() === 'packages'">
          <table class="plan-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Price</th>
                <th>Sold</th>
                <th>Credits</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              <tr *ngFor="let item of packageRecords()" (click)="selectPackage(item)" [class.active-row]="packageRecordId(selectedPackage()) === packageRecordId(item)">
                <td>
                  <div class="plan-name-cell">
                    <span class="plan-avatar">{{ packageInitial(item) }}</span>
                    <div>
                      <strong>{{ packageName(item) }}</strong>
                      <small>{{ packageRuleText(item) }}</small>
                    </div>
                  </div>
                </td>
                <td>{{ packagePrice(item) | auraMoney:'1.0-0' }}</td>
                <td>{{ packageSoldCount(item) }}</td>
                <td>{{ packageTotalCredits(item) }}</td>
                <td><span class="status-pill">{{ packageStatus(item) }}</span></td>
              </tr>
              <tr *ngIf="!packageRecords().length">
                <td class="empty-row" colspan="5">No package found. Packages button se service package banao.</td>
              </tr>
            </tbody>
          </table>
          <div class="package-detail-card" *ngIf="selectedPackage() as pkg">
            <div>
              <h3>{{ packageName(pkg) }}</h3>
              <p>{{ packageRuleText(pkg) }}</p>
            </div>
            <div class="mini-stats">
              <article><span>Price</span><strong>{{ packagePrice(pkg) | auraMoney:'1.0-0' }}</strong></article>
              <article><span>Credits</span><strong>{{ packageTotalCredits(pkg) }}</strong></article>
              <article><span>Sold</span><strong>{{ packageSoldCount(pkg) }}</strong></article>
            </div>
            <a class="ghost-button mini" routerLink="/packages">Open package manager</a>
          </div>
        </div>

        <div class="giftcard-workspace" *ngIf="planWorkspaceView() === 'giftcards'">
          <form class="form-panel inline-form inner-form-grid" [formGroup]="giftForm" (ngSubmit)="saveGiftCard()">
            <label class="field"><span>Code</span><input formControlName="code" /></label>
            <label class="field"><span>Initial value</span><input type="number" formControlName="initialValue" /></label>
            <label class="field"><span>Expiry</span><input type="date" formControlName="expiryDate" /></label>
            <button class="primary-button" type="submit" [disabled]="giftForm.invalid || saving()">Create gift card</button>
          </form>
          <div class="quick-grid">
            <article class="action-card selectable-card" *ngFor="let card of giftCards()" (click)="selectGiftCard(card)" tabindex="0" (keydown.enter)="selectGiftCard(card)">
              <strong>{{ card.code }}</strong>
              <span>{{ giftCardBalance(card) | auraMoney:'1.0-0' }} balance · expires {{ card.expiryDate || card['expiry_date'] || 'not set' }}</span>
              <small>{{ card.originalSystem || 'Aura' }} · {{ card.status || 'active' }}</small>
            </article>
            <article class="action-card" *ngIf="!giftCards().length">
              <strong>No gift card yet.</strong>
              <span>Create gift card from this same page.</span>
            </article>
          </div>
          <section class="giftcard-detail" *ngIf="selectedGiftCard() as detail">
            <div class="section-title compact-title"><div><h3>{{ detail['card']?.code }} transaction history</h3></div><span class="badge">{{ giftCardTransactions().length }} row(s)</span></div>
            <div class="mini-stats">
              <article><span>Recovered initial value</span><strong>{{ giftCardInitialValue(detail['card']) | auraMoney:'1.0-0' }}</strong></article>
              <article><span>Current balance</span><strong>{{ giftCardBalance(detail['card']) | auraMoney:'1.0-0' }}</strong></article>
              <article><span>Source</span><strong>{{ detail['card']?.originalSystem || 'Aura' }}</strong></article>
            </div>
            <div class="table-wrap inner-table-wrap">
              <table><thead><tr><th>When</th><th>Type</th><th>Amount</th><th>Balance after</th><th>Invoice / source</th></tr></thead>
                <tbody><tr *ngFor="let tx of giftCardTransactions()"><td>{{ tx['createdAt'] | auraDate:'date' }}</td><td>{{ tx['type'] }}</td><td>{{ giftCardTransactionAmount(tx) | auraMoney:'1.0-0' }}</td><td>{{ giftCardTransactionBalance(tx) | auraMoney:'1.0-0' }}</td><td>{{ tx['invoiceId'] || tx['originalRecordId'] || '-' }}</td></tr></tbody>
              </table>
            </div>
          </section>
        </div>
      </section>

      <div class="plan-drawer-shell" *ngIf="showPlanDrawer()">
        <button class="drawer-scrim" type="button" (click)="closePlanDrawer()" aria-label="Close plan drawer"></button>
        <aside class="plan-drawer">
          <div class="drawer-title">
            <button class="icon-button" type="button" (click)="closePlanDrawer()">Ã—</button>
            <h2>{{ editingPlanId() ? 'Update Plan' : 'Add New Plan' }}</h2>
          </div>
          <form [formGroup]="planForm" (ngSubmit)="savePlan()">
            <label class="field">
              <span>Membership type</span>
              <select formControlName="planType">
                <option value="discount">Discount card</option>
                <option value="prepaid_credit">Prepaid value credit</option>
                <option value="visit_pack">Visit pack</option>
                <option value="service_credit">Service credit</option>
                <option value="combo">Combo package</option>
                <option value="unlimited">Unlimited with fair usage</option>
                <option value="family">Family membership</option>
                <option value="corporate">Corporate membership</option>
                <option value="tiered">Tiered loyalty level</option>
              </select>
            </label>
            <label class="field"><span>Plan name</span><input formControlName="name" placeholder="Aura Gold 30%" /></label>
            <label class="field"><span>Plan code</span><input formControlName="code" placeholder="aura_gold" /></label>
            <label class="field"><span>{{ isPrepaidPlanForm() ? 'You pay' : 'Selling price' }}</span><input type="number" formControlName="price" /></label>
            <label class="field" *ngIf="usesDiscountFields()"><span>Service discount %</span><input type="number" formControlName="discountPercent" /></label>
            <label class="field" *ngIf="usesDiscountFields()"><span>Product discount %</span><input type="number" formControlName="productDiscountPercent" /></label>
            <ng-container *ngIf="isPrepaidPlanForm()">
              <label class="field"><span>We add</span><input type="number" formControlName="bonusAmount" /></label>
              <label class="field"><span>You get credit</span><input type="number" formControlName="creditAmount" /></label>
              <label class="field"><span>Benefit %</span><input type="number" formControlName="benefitPercent" /></label>
              <label class="field">
                <span>Per visit limit</span>
                <select formControlName="perVisitLimitType">
                  <option value="none">No limit</option>
                  <option value="fixed">Fixed amount</option>
                  <option value="bill_percent">% of eligible bill</option>
                </select>
              </label>
              <label class="field" *ngIf="planForm.value.perVisitLimitType !== 'none'">
                <span>Limit value</span>
                <input type="number" formControlName="perVisitLimitValue" />
              </label>
              <label class="field">
                <span>Service restriction</span>
                <select formControlName="serviceRestrictionType">
                  <option value="all">All services</option>
                  <option value="category">Category wise</option>
                  <option value="selected_services">Selected services</option>
                </select>
              </label>
              <label class="field" *ngIf="planForm.value.serviceRestrictionType !== 'all'">
                <span>Allowed categories / service names</span>
                <input formControlName="serviceRestrictionValue" placeholder="Hair, Facial or service IDs" />
              </label>
              <label class="field checkbox-field">
                <span>Product redeem</span>
                <input type="checkbox" formControlName="allowProductRedeem" />
              </label>
              <div class="field full wallet-preview">
                <strong>{{ prepaidPlanCreditPreview() }}</strong>
                <span>{{ prepaidPlanRulePreview() }}</span>
              </div>
              <div class="field full inline-actions">
                <button class="ghost-button mini" type="button" (click)="applyPrepaidPreset(20000, 4800, 150)">20k -> 24.8k</button>
                <button class="ghost-button mini" type="button" (click)="applyPrepaidPreset(30000, 8700, 210)">30k -> 38.7k</button>
                <button class="ghost-button mini" type="button" (click)="applyPrepaidPreset(40000, 13600, 270)">40k -> 53.6k</button>
                <button class="ghost-button mini" type="button" (click)="applyPrepaidPreset(50000, 20000, 365)">50k -> 70k</button>
              </div>
            </ng-container>
            <ng-container *ngIf="isServiceCreditPlanForm()">
              <label class="field">
                <span>Credit unit</span>
                <select formControlName="creditUnit">
                  <option value="visit">Visits</option>
                  <option value="service">Service credits</option>
                </select>
              </label>
              <label class="field"><span>Credits / visits</span><input type="number" formControlName="creditAmount" /></label>
              <label class="field full"><span>Included services</span><input formControlName="includedServicesValue" placeholder="Haircut, Facial or service IDs, comma separated" /></label>
            </ng-container>
            <ng-container *ngIf="isUnlimitedPlanForm()">
              <label class="field"><span>Monthly fair usage cap</span><input type="number" formControlName="monthlyCap" /></label>
              <label class="field full"><span>Unlimited services</span><input formControlName="includedServicesValue" placeholder="Haircut, Hair Wash or service IDs" /></label>
            </ng-container>
            <ng-container *ngIf="isFamilyPlanForm()">
              <label class="field"><span>Family member limit</span><input type="number" formControlName="familyMemberLimit" /></label>
              <label class="field checkbox-field"><span>Share benefits</span><input type="checkbox" formControlName="familyShareBenefits" /></label>
            </ng-container>
            <ng-container *ngIf="isCorporatePlanForm()">
              <label class="field"><span>Company label</span><input formControlName="corporateLabel" placeholder="TCS / Infosys" /></label>
              <label class="field"><span>Email domain</span><input formControlName="corporateDomain" placeholder="company.com" /></label>
              <label class="field checkbox-field"><span>Employee ID required</span><input type="checkbox" formControlName="corporateEmployeeIdRequired" /></label>
            </ng-container>
            <ng-container *ngIf="isTieredPlanForm()">
              <label class="field"><span>Tier name</span><input formControlName="tierName" placeholder="Gold" /></label>
              <label class="field"><span>Spend threshold</span><input type="number" formControlName="tierSpendThreshold" /></label>
              <label class="field"><span>Visit threshold</span><input type="number" formControlName="tierVisitThreshold" /></label>
            </ng-container>
            <div class="field full plan-type-preview" *ngIf="!isPrepaidPlanForm()">
              <strong>{{ structuredPlanPreview() }}</strong>
              <span>{{ structuredPlanRulePreview() }}</span>
            </div>
            <label class="field checkbox-field">
              <span>Birthday benefit</span>
              <input type="checkbox" formControlName="birthdayBenefit" />
            </label>
            <label class="field checkbox-field">
              <span>Anniversary benefit</span>
              <input type="checkbox" formControlName="anniversaryBenefit" />
            </label>
            <label class="field checkbox-field">
              <span>Priority booking</span>
              <input type="checkbox" formControlName="priorityBooking" />
            </label>
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
            <label class="field full"><span>Advanced included services JSON</span><textarea formControlName="includedServicesText" placeholder='[{"serviceId":"svc_1","credits":1}]'></textarea></label>
            <label class="field full"><span>Advanced benefit rules JSON</span><textarea formControlName="benefitRulesText" placeholder='{"maxDiscount":1000,"blackoutDates":[]}'></textarea></label>
            <button class="primary-button" type="submit" [disabled]="planForm.invalid || saving()">{{ editingPlanId() ? 'Save changes' : 'Save plan' }}</button>
          </form>
        </aside>
      </div>

      <section class="panel inner-page-card" *ngIf="activeTab() === 'active'">
        <div class="section-title">
          <div>
            <h2>{{ memberListTitle() }}</h2>
          </div>
          <div class="inline-actions">
            <span class="badge">{{ visibleMemberships().length }} row(s)</span>
            <select [(ngModel)]="quickLifecyclePlanId">
              <option value="">Plan for upgrade/downgrade</option>
              <option *ngFor="let plan of activeMembershipPlans()" [value]="plan.id">{{ plan.name }}</option>
            </select>
          </div>
        </div>
        <div class="table-wrap compact-table inner-table-wrap">
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
                <th>Sold by</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              <tr *ngFor="let membership of visibleMemberships()">
                <td>{{ clientName(membership.clientId) }}</td>
                <td><strong>{{ membership.planName }}</strong><small>{{ membership.status }}</small></td>
                <td>{{ membershipTakenDate(membership) | auraDate:'date' }}</td>
                <td>{{ membership.validityDate ? (membership.validityDate | auraDate:'date') : 'No expiry' }}</td>
                <td>
                  <span class="badge" [class.danger]="membershipDaysLeft(membership) < 0">
                    {{ membershipDaysLeftLabel(membership) }}
                  </span>
                </td>
                <td>{{ membership.creditsRemaining || 0 }} / {{ membership.planCredits || 0 }}</td>
                <td>{{ membershipDiscount(membership) }}%</td>
                <td>{{ membership.autoRenew ? 'Yes' : 'No' }}</td>
                <td>{{ membership.price | auraMoney:'1.0-0' }}</td>
                <td>{{ membership.soldByStaffName || staffName(membership.soldByStaffId) || 'Not recorded' }}</td>
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
              <tr *ngIf="!visibleMemberships().length">
                <td class="empty-row" colspan="11">No memberships found for selected KPI.</td>
              </tr>
            </tbody>
          </table>
        </div>

        <div class="two-grid compact-workbench self-service-grid">
          <section class="form-panel inner-form-grid">
            <div class="section-title compact-title">
              <div>
                <h3>Membership self-service control center</h3>
              </div>
              <button class="ghost-button mini" type="button" (click)="loadSelfServiceSummary()">Load summary</button>
            </div>
            <div class="self-service-filter-grid">
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
                  <option value="">Select membership</option>
                  <option *ngFor="let membership of selectedSelfServiceClientMemberships()" [value]="membership.id">{{ membership.planName || membership.id }}</option>
                </select>
              </label>
              <label class="field full">
                <span>Cancellation reason</span>
                <textarea [(ngModel)]="selfServiceCancelReason" placeholder="Reason required before request"></textarea>
              </label>
            </div>
            <div class="inline-actions">
              <button class="ghost-button mini" type="button" (click)="createSelfServiceStatusLink()">Status link</button>
              <button class="ghost-button mini" type="button" (click)="createWhatsAppSummary()">WhatsApp summary</button>
              <button class="ghost-button mini" type="button" (click)="createSelfServiceRenewLink()">Renew link</button>
              <button class="ghost-button mini danger-text" type="button" (click)="createSelfServiceCancelRequest()">Request cancellation approval</button>
            </div>
            <p class="inline-hint" *ngIf="selfServiceLastLink">{{ selfServiceLastLink }}</p>
          </section>

          <section class="form-panel inner-form-grid">
            <div class="section-title compact-title">
              <div>
                <h3>Manual credit adjustment</h3>
              </div>
              <button class="ghost-button mini" type="button" (click)="refreshSelfServiceRequests()">Pending approval</button>
            </div>
            <div class="self-service-filter-grid">
              <label class="field">
                <span>Credit delta</span>
                <input type="number" [(ngModel)]="selfServiceCreditDelta" />
              </label>
              <label class="field full">
                <span>Reason</span>
                <textarea [(ngModel)]="selfServiceCreditReason" placeholder="Required for manual credit adjustment"></textarea>
              </label>
            </div>
            <div class="inline-actions">
              <button class="ghost-button mini" type="button" (click)="createSelfServicePaymentMethodUpdate()">Payment method update</button>
              <button class="primary-button mini" type="button" (click)="createManualCreditAdjustmentRequest()">Create pending approval</button>
            </div>
            <div class="quick-grid" *ngIf="selfServiceRequests().length">
              <article class="action-card" *ngFor="let request of selfServiceRequests().slice(0, 4)">
                <strong>{{ selfServiceLabel(request['requestType']) }}</strong>
                <span>{{ request['status'] || 'pending approval' }}</span>
                <div class="inline-actions">
                  <button class="ghost-button mini" type="button" (click)="approveSelfServiceRequest(request)">Approve</button>
                  <button class="ghost-button mini danger-text" type="button" (click)="rejectSelfServiceRequest(request)">Reject</button>
                </div>
              </article>
            </div>
          </section>
        </div>
      </section>

      <div class="two-grid compact-workbench" *ngIf="activeTab() === 'reminders'">
        <section class="form-panel inner-form-grid">
          <h3>Family membership sharing</h3>
          <form [formGroup]="familyForm" (ngSubmit)="saveFamilyMember()">
            <label class="field"><span>Primary client</span><select formControlName="primaryClientId"><option value="">Select primary</option><option *ngFor="let client of clients()" [value]="client.id">{{ client.name }}</option></select></label>
            <label class="field"><span>Family member</span><select formControlName="memberClientId"><option value="">Select member</option><option *ngFor="let client of clients()" [value]="client.id">{{ client.name }}</option></select></label>
            <label class="field"><span>Relationship</span><input formControlName="relationship" placeholder="spouse, child, parent" /></label>
            <label class="field check-line"><input type="checkbox" formControlName="shareBenefits" /><span>Share membership benefits</span></label>
            <button class="primary-button" type="submit" [disabled]="familyForm.invalid || saving()">Link member</button>
          </form>
        </section>

        <section class="form-panel inner-form-grid">
          <h3>WhatsApp renewal queue</h3>
          <div class="quick-grid">
            <article class="action-card" *ngFor="let reminder of reminders()">
              <strong>{{ clientName(reminder.clientId) }}</strong>
              <span>{{ reminder.message }}</span>
              <span>Due {{ reminder.dueOn }} Â· {{ reminder.status }}</span>
              <button class="ghost-button mini" type="button" *ngIf="reminder.status === 'queued'" (click)="approveReminder(reminder)">Approve</button>
            </article>
          </div>
        </section>
      </div>

      <section class="panel inner-page-card" *ngIf="activeTab() === 'autoRenew'">
        <div class="section-title">
          <div>
            <h2>Auto-renew queue</h2>
          </div>
          <button class="ghost-button mini" type="button" (click)="load()">Refresh queue</button>
        </div>

        <section class="member-count-strip compact-count-strip">
          <article><span>Due today</span><strong>{{ autoRenewSummary().dueToday || 0 }}</strong></article>
          <article><span>Due in 7 days</span><strong>{{ autoRenewSummary().dueIn7Days || 0 }}</strong></article>
          <article><span>Failed payment</span><strong>{{ autoRenewSummary().failedPayment || 0 }}</strong></article>
          <article><span>Missing method</span><strong>{{ autoRenewSummary().paymentMethodMissing || 0 }}</strong></article>
        </section>

        <div class="quick-grid auto-renew-grid" *ngIf="autoRenewQueue().length; else noAutoRenewQueue">
          <article class="action-card auto-renew-card" *ngFor="let item of autoRenewQueue()">
            <div class="auto-renew-card-header">
              <div>
                <strong>{{ item.clientName || clientName(item.clientId) }}</strong>
                <span>{{ item.planName }} Â· expires {{ item.expiresOn || '-' }}</span>
              </div>
              <span class="badge" [class.danger]="item.failedPayment || item.status === 'payment_method_missing'">{{ autoRenewStatusLabel(item) }}</span>
            </div>
            <div class="wallet-snapshot-grid">
              <div><span>Retry count</span><b>{{ item.retryCount || 0 }}</b></div>
              <div><span>Next retry</span><b>{{ item.nextRetryAt ? (item.nextRetryAt | auraDate:'date') : '-' }}</b></div>
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

      <section class="panel inner-page-card" *ngIf="activeTab() === 'audit'">
        <div class="section-title">
          <div>
            <h2>Membership audit ledger</h2>
            <p>{{ ledger().length }} backend-filtered row(s)</p>
          </div>
          <div class="inline-actions audit-search-actions">
            <input
              type="search"
              [(ngModel)]="auditLedgerSearchDraft"
              (keydown.enter)="searchAuditLedger()"
              placeholder="Search client, action, invoice, payment or note"
              aria-label="Search membership audit ledger"
            />
            <button class="ghost-button mini" type="button" (click)="searchAuditLedger()" [disabled]="saving()">Search</button>
            <button class="ghost-button mini" type="button" (click)="clearAuditLedgerSearch()" [disabled]="saving() || (!auditLedgerSearch && !auditLedgerSearchDraft)">Clear</button>
          </div>
        </div>
        <div class="table-wrap compact-table inner-table-wrap">
          <table>
            <thead><tr><th>When</th><th>Client</th><th>Action</th><th>Amount</th><th>Discount</th><th>Credits</th><th>Payment</th><th>Invoice</th><th>Note</th></tr></thead>
            <tbody>
              <tr *ngFor="let row of ledger()">
                <td>{{ row.createdAt | auraDate:'date' }}</td>
                <td>{{ clientName(row.clientId) }}</td>
                <td>{{ row.action }}</td>
                <td>{{ (row.paidAmount || row.amount) | auraMoney:'1.0-0' }}</td>
                <td>{{ row.discountAmount | auraMoney:'1.0-0' }}</td>
                <td>{{ row.creditsBefore }} â†’ {{ row.creditsAfter }}</td>
                <td>{{ paymentLabel(row) }}</td>
                <td>{{ row.invoiceId || '-' }}</td>
                <td>{{ row.note || '-' }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section class="panel inner-page-card" *ngIf="activeTab() === 'commission'">
        <div class="section-title">
          <div>
            <h2>Membership commission center</h2>
          </div>
          <a class="ghost-button mini" routerLink="/reports/commission-preview">Commission preview</a>
        </div>

        <section class="member-count-strip compact-count-strip">
          <article><span>Sale revenue</span><strong>{{ commissionMetric('saleRevenue') | auraMoney:'1.0-0' }}</strong></article>
          <article><span>Renewal revenue</span><strong>{{ commissionMetric('renewalRevenue') | auraMoney:'1.0-0' }}</strong></article>
          <article><span>Upgrade revenue</span><strong>{{ commissionMetric('upgradeRevenue') | auraMoney:'1.0-0' }}</strong></article>
          <article><span>Commission preview</span><strong>{{ commissionMetric('commissionPreview') | auraMoney:'1.0-0' }}</strong><small>{{ commissionReport().metrics?.['doubleCountGuardedRows'] || 0 }} duplicate guarded</small></article>
        </section>

        <div class="two-grid compact-workbench">
          <section class="form-panel inner-form-grid">
            <div class="section-title compact-title">
              <div>
                <h3>Staff-wise revenue and retention</h3>
              </div>
            </div>
            <div class="table-wrap compact-table inner-table-wrap" *ngIf="commissionReport().staff?.length; else noCommissionStaff">
              <table>
                <thead><tr><th>Staff</th><th>Sale</th><th>Renewal</th><th>Upgrade</th><th>Retention</th><th>Preview</th><th>Reversal</th></tr></thead>
                <tbody>
                  <tr *ngFor="let row of commissionReport().staff">
                    <td><strong>{{ row['staffName'] || 'System' }}</strong><small>{{ row['role'] || row['staffId'] || '-' }}</small></td>
                    <td>{{ row['saleRevenue'] | auraMoney:'1.0-0' }}</td>
                    <td>{{ row['renewalRevenue'] | auraMoney:'1.0-0' }}</td>
                    <td>{{ row['upgradeRevenue'] | auraMoney:'1.0-0' }}</td>
                    <td>{{ row['retentionRate'] || 0 }}%</td>
                    <td>{{ row['commissionPreview'] | auraMoney:'1.0-0' }}</td>
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

          <section class="form-panel inner-form-grid">
            <div class="section-title compact-title">
              <div>
                <h3>Reversal and audit flags</h3>
              </div>
            </div>
            <div class="quick-grid" *ngIf="commissionReport().cancellationImpact?.length; else noCommissionImpact">
              <article class="action-card" *ngFor="let item of commissionReport().cancellationImpact">
                <strong>{{ clientName(item['clientId']) }}</strong>
                <span>{{ item['action'] }} Â· {{ item['commissionImpact'] | auraMoney:'1.0-0' }} impact</span>
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

        <div class="table-wrap compact-table inner-table-wrap">
          <table>
            <thead><tr><th>When</th><th>Staff</th><th>Client</th><th>Action</th><th>Revenue</th><th>Rate</th><th>Commission</th><th>Audit</th><th>Status</th></tr></thead>
            <tbody>
              <tr *ngFor="let entry of commissionReport().entries">
                <td>{{ entry['createdAt'] | auraDate:'date' }}</td>
                <td>{{ entry['staffName'] || 'System' }}</td>
                <td>{{ clientName(entry['clientId']) }}</td>
                <td>{{ entry['action'] }}</td>
                <td>{{ entry['revenue'] | auraMoney:'1.0-0' }}</td>
                <td>{{ ((entry['commissionRate'] || 0) * 100) | number: '1.1-1' }}%</td>
                <td>{{ entry['commissionImpact'] | auraMoney:'1.0-0' }}</td>
                <td><span class="badge" [class.danger]="entry['auditRequired']">{{ entry['auditStatus'] }}</span></td>
                <td>{{ entry['status'] }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section class="panel inner-page-card" *ngIf="activeTab() === 'risk'">
        <div class="section-title">
          <div>
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
          <article><span>Critical</span><strong>{{ riskMetric('critical') }}</strong></article>
          <article><span>High</span><strong>{{ riskMetric('high') }}</strong></article>
          <article><span>Pending review</span><strong>{{ riskMetric('pending') }}</strong></article>
          <article><span>Reviewed</span><strong>{{ riskMetric('reviewed') }}</strong></article>
        </section>

        <div class="quick-grid risk-grid" *ngIf="filteredRiskSignals().length; else noMembershipRisk">
          <article class="action-card risk-card" *ngFor="let signal of filteredRiskSignals()">
            <div class="auto-renew-card-header">
              <div>
                <strong>{{ riskTitle(signal) }}</strong>
                <span>{{ clientName(signal['clientId']) }} Â· {{ signal['staffName'] || 'System' }}</span>
              </div>
              <span class="badge" [ngClass]="riskBadgeClass(signal['riskLevel'])">{{ signal['riskLevel'] }} Â· {{ signal['riskScore'] || 0 }}</span>
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

      <section class="panel inner-page-card" *ngIf="activeTab() === 'reports'">
        <div class="section-title">
          <div>
            <h2>Membership reports center</h2>
          </div>
          <div class="inline-actions">
            <button class="ghost-button mini" type="button" (click)="loadEnterpriseReports()" [disabled]="saving()">Apply filters</button>
            <button class="ghost-button mini" type="button" (click)="exportMembershipReportsCsv()">Export CSV</button>
            <button class="ghost-button mini" type="button" (click)="exportMembershipReportsPdf()">Export PDF</button>
          </div>
        </div>

        <section class="report-filter-grid">
          <label class="field"><span>From date</span><input type="date" [(ngModel)]="reportFilters.fromDate" (ngModelChange)="onReportFilterChanged()" /></label>
          <label class="field"><span>To date</span><input type="date" [(ngModel)]="reportFilters.toDate" (ngModelChange)="onReportFilterChanged()" /></label>
          <label class="field">
            <span>Branch</span>
            <select [(ngModel)]="reportFilters.branchId" (ngModelChange)="onReportFilterChanged()">
              <option value="">All branches</option>
              <option *ngFor="let branch of branchOptions()" [value]="branch">{{ branch }}</option>
            </select>
          </label>
          <label class="field">
            <span>Plan</span>
            <select [(ngModel)]="reportFilters.planId" (ngModelChange)="onReportFilterChanged()">
              <option value="">All plans</option>
              <option *ngFor="let plan of membershipPlans()" [value]="plan.id">{{ plan.name }}</option>
            </select>
          </label>
          <label class="field">
            <span>Client search</span>
            <input type="search" placeholder="Name, phone, invoice" [(ngModel)]="reportFilters.clientSearch" (ngModelChange)="onReportFilterChanged()" />
          </label>
          <label class="field">
            <span>Plan type</span>
            <select [(ngModel)]="reportFilters.planType" (ngModelChange)="onReportFilterChanged()">
              <option value="">All plan types</option>
              <option value="discount">Discount</option>
              <option value="prepaid_credit">Prepaid credit</option>
              <option value="visit_pack">Visit pack</option>
              <option value="service_credit">Service credit</option>
              <option value="combo">Combo</option>
              <option value="unlimited">Unlimited</option>
              <option value="family">Family</option>
              <option value="corporate">Corporate</option>
              <option value="tiered">Tiered</option>
            </select>
          </label>
          <label class="field">
            <span>Staff</span>
            <select [(ngModel)]="reportFilters.staffId" (ngModelChange)="onReportFilterChanged()">
              <option value="">All staff</option>
              <option *ngFor="let staff of staffMembers()" [value]="staff.id || staff['staffId']">{{ staffOption(staff) }}</option>
            </select>
          </label>
          <label class="field">
            <span>Client</span>
            <select [(ngModel)]="reportFilters.clientId" (ngModelChange)="onReportFilterChanged()">
              <option value="">All clients</option>
              <option *ngFor="let client of clients()" [value]="client.id">{{ client.name || client['fullName'] || client.id }}</option>
            </select>
          </label>
          <label class="field">
            <span>Status</span>
            <select [(ngModel)]="reportFilters.status" (ngModelChange)="onReportFilterChanged()">
              <option value="">All statuses</option>
              <option value="active">Active</option>
              <option value="cancelled">Cancelled</option>
              <option value="expired">Expired</option>
            </select>
          </label>
          <label class="field">
            <span>Sale type</span>
            <select [(ngModel)]="reportFilters.saleType" (ngModelChange)="onReportFilterChanged()">
              <option value="">New / renewal / all</option>
              <option value="new">New Sale</option>
              <option value="renewal">Renewal</option>
            </select>
          </label>
          <label class="field">
            <span>Payment mode</span>
            <select [(ngModel)]="reportFilters.paymentMode" (ngModelChange)="onReportFilterChanged()">
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
            <select [(ngModel)]="reportFilters.riskLevel" (ngModelChange)="onReportFilterChanged()">
              <option value="all">All risks</option>
              <option value="critical">Critical</option>
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
            </select>
          </label>
          <label class="field">
            <span>Redeem status</span>
            <select [(ngModel)]="reportFilters.redeemStatus" (ngModelChange)="onReportFilterChanged()">
              <option value="">Redeemed / not redeemed</option>
              <option value="redeemed">Redeemed</option>
              <option value="not_redeemed">Not redeemed</option>
            </select>
          </label>
          <label class="field">
            <span>Wallet balance</span>
            <select [(ngModel)]="reportFilters.walletBalance" (ngModelChange)="onReportFilterChanged()">
              <option value="">All wallet balances</option>
              <option value="positive">Positive</option>
              <option value="zero">Zero</option>
            </select>
          </label>
        </section>

        <section class="member-count-strip compact-count-strip">
          <article role="button" tabindex="0" (click)="setReportTab('activeMembers')" (keydown.enter)="setReportTab('activeMembers')"><span>Active members</span><strong>{{ reportMetric('activeMembers') }}</strong></article>
          <article role="button" tabindex="0" (click)="setReportTab('expiringSoon')" (keydown.enter)="setReportTab('expiringSoon')"><span>Expiring soon</span><strong>{{ reportMetric('expiringSoon') }}</strong></article>
          <article role="button" tabindex="0" (click)="setReportTab('renewalRevenue')" (keydown.enter)="setReportTab('renewalRevenue')"><span>Renewal revenue</span><strong>{{ reportMetric('renewalRevenue') | auraMoney:'1.0-0' }}</strong></article>
          <article role="button" tabindex="0" (click)="setReportTab('creditLiability')" (keydown.enter)="setReportTab('creditLiability')"><span>Credit liability</span><strong>{{ reportMetric('creditLiability') | auraMoney:'1.0-0' }}</strong></article>
          <article role="button" tabindex="0" (click)="setReportTab('discountLeakage')" (keydown.enter)="setReportTab('discountLeakage')"><span>Discount leakage</span><strong>{{ reportMetric('discountLeakage') | auraMoney:'1.0-0' }}</strong></article>
          <article role="button" tabindex="0" (click)="setReportTab('membershipRedeem')" (keydown.enter)="setReportTab('membershipRedeem')"><span>Membership redeem</span><strong>{{ reportMetric('totalRedeemed') | auraMoney:'1.0-0' }}</strong><small>{{ reportMetric('redeemCount') }} redemptions</small></article>
          <article role="button" tabindex="0" (click)="setReportTab('membershipSalesByCustomer')" (keydown.enter)="setReportTab('membershipSalesByCustomer')"><span>Customer sales</span><strong>{{ reportMetric('membershipSalesOfferPrice') | auraMoney:'1.0-0' }}</strong><small>{{ reportMetric('membershipSalesTotalCount') }} sale rows</small></article>
          <article role="button" tabindex="0" (click)="setReportTab('actionQueue')" (keydown.enter)="setReportTab('actionQueue')"><span>Action queue</span><strong>{{ reportMetric('actionQueue') }}</strong></article>
        </section>

        <nav class="report-section-tabs" aria-label="Membership report sections">
          <button type="button" [class.active]="activeReportTab() === 'actionQueue'" (click)="setReportTab('actionQueue')">Action queue <span>{{ reportMetric('actionQueue') }}</span></button>
          <button type="button" [class.active]="activeReportTab() === 'activeMembers'" (click)="setReportTab('activeMembers')">Active members <span>{{ reportSet('activeMembers').length }}</span></button>
          <button type="button" [class.active]="activeReportTab() === 'expiringSoon'" (click)="setReportTab('expiringSoon')">Expiring soon <span>{{ reportSet('expiringSoon').length }}</span></button>
          <button type="button" [class.active]="activeReportTab() === 'renewalRevenue'" (click)="setReportTab('renewalRevenue')">Renewal revenue <span>{{ reportSet('renewalRevenue').length }}</span></button>
          <button type="button" [class.active]="activeReportTab() === 'cancelledMemberships'" (click)="setReportTab('cancelledMemberships')">Cancelled <span>{{ reportSet('cancelledMemberships').length }}</span></button>
          <button type="button" [class.active]="activeReportTab() === 'staffWiseSales'" (click)="setReportTab('staffWiseSales')">Staff sales <span>{{ reportSet('staffWiseSales').length }}</span></button>
          <button type="button" [class.active]="activeReportTab() === 'planWiseProfitability'" (click)="setReportTab('planWiseProfitability')">Plan profit <span>{{ reportSet('planWiseProfitability').length }}</span></button>
          <button type="button" [class.active]="activeReportTab() === 'creditLiability'" (click)="setReportTab('creditLiability')">Credit liability <span>{{ reportSet('creditLiability').length }}</span></button>
          <button type="button" [class.active]="activeReportTab() === 'autoRenewFailedPayments'" (click)="setReportTab('autoRenewFailedPayments')">Auto-renew failed <span>{{ reportSet('autoRenewFailedPayments').length }}</span></button>
          <button type="button" [class.active]="activeReportTab() === 'upgradeDowngrade'" (click)="setReportTab('upgradeDowngrade')">Upgrade / downgrade <span>{{ reportSet('upgradeDowngrade').length }}</span></button>
          <button type="button" [class.active]="activeReportTab() === 'discountLeakage'" (click)="setReportTab('discountLeakage')">Discount leakage <span>{{ reportSet('discountLeakage').length }}</span></button>
          <button type="button" [class.active]="activeReportTab() === 'membershipRedeem'" (click)="setReportTab('membershipRedeem')">Membership Redeem <span>{{ reportSet('membershipRedeem').length }}</span></button>
          <button type="button" [class.active]="activeReportTab() === 'membershipSalesByCustomer'" (click)="setReportTab('membershipSalesByCustomer')">Membership Sales By Customer <span>{{ reportSet('membershipSalesByCustomer').length }}</span></button>
        </nav>

        <section class="form-panel report-card action-queue-card report-detail-card inner-form-grid inner-page-card" *ngIf="activeReportTab() === 'actionQueue'">
          <div class="section-title compact-section-title">
            <div>
              <h3>Membership action queue</h3>
            </div>
            <span class="badge" [class.danger]="reportMetric('actionQueue') > 0">{{ reportMetric('actionQueue') }} open</span>
          </div>
          <div class="table-wrap compact-table inner-table-wrap" *ngIf="reportSet('actionQueue').length; else noMembershipActionQueue">
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
          <section class="form-panel report-card report-detail-card inner-form-grid inner-page-card" *ngIf="activeReportTab() === 'activeMembers'">
            <h3>Active members</h3>
            <div class="table-wrap compact-table inner-table-wrap" *ngIf="reportSet('activeMembers').length; else noActiveReport">
              <table><thead><tr><th>Client</th><th>Plan</th><th>Expiry</th><th>Credits</th><th>Price</th></tr></thead>
                <tbody><tr *ngFor="let row of reportSet('activeMembers').slice(0, 8)">
                  <td>{{ row['clientName'] }}</td><td>{{ row['planName'] }}</td><td>{{ row['expiresOn'] || '-' }}</td><td>{{ row['creditsRemaining'] || 0 }} / {{ row['planCredits'] || 0 }}</td><td>{{ row['price'] | auraMoney:'1.0-0' }}</td>
                </tr></tbody></table>
            </div>
            <ng-template #noActiveReport><div class="empty-panel compact-empty"><strong>No active members.</strong></div></ng-template>
          </section>

          <section class="form-panel report-card report-detail-card inner-form-grid inner-page-card" *ngIf="activeReportTab() === 'expiringSoon'">
            <h3>Expiring soon</h3>
            <div class="table-wrap compact-table inner-table-wrap" *ngIf="reportSet('expiringSoon').length; else noExpiryReport">
              <table><thead><tr><th>Client</th><th>Plan</th><th>Days</th><th>Auto-renew</th></tr></thead>
                <tbody><tr *ngFor="let row of reportSet('expiringSoon').slice(0, 8)">
                  <td>{{ row['clientName'] }}</td><td>{{ row['planName'] }}</td><td><span class="badge" [class.danger]="row['daysLeft'] <= 7">{{ row['daysLeft'] }}d</span></td><td>{{ row['autoRenew'] ? 'Yes' : 'No' }}</td>
                </tr></tbody></table>
            </div>
            <ng-template #noExpiryReport><div class="empty-panel compact-empty"><strong>No expiring memberships.</strong></div></ng-template>
          </section>

          <section class="form-panel report-card report-detail-card inner-form-grid inner-page-card" *ngIf="activeReportTab() === 'renewalRevenue'">
            <h3>Renewal revenue</h3>
            <div class="table-wrap compact-table inner-table-wrap" *ngIf="reportSet('renewalRevenue').length; else noRenewalReport">
              <table><thead><tr><th>Date</th><th>Revenue</th><th>Count</th><th>Staff</th></tr></thead>
                <tbody><tr *ngFor="let row of reportSet('renewalRevenue').slice(0, 8)">
                  <td>{{ row['date'] }}</td><td>{{ row['revenue'] | auraMoney:'1.0-0' }}</td><td>{{ row['count'] }}</td><td>{{ row['staffCount'] }}</td>
                </tr></tbody></table>
            </div>
            <ng-template #noRenewalReport><div class="empty-panel compact-empty"><strong>No renewal revenue.</strong></div></ng-template>
          </section>

          <section class="form-panel report-card report-detail-card inner-form-grid inner-page-card" *ngIf="activeReportTab() === 'cancelledMemberships'">
            <h3>Cancelled memberships</h3>
            <div class="table-wrap compact-table inner-table-wrap" *ngIf="reportSet('cancelledMemberships').length; else noCancelledReport">
              <table><thead><tr><th>Client</th><th>Plan</th><th>Amount</th><th>When</th></tr></thead>
                <tbody><tr *ngFor="let row of reportSet('cancelledMemberships').slice(0, 8)">
                  <td>{{ row['clientName'] }}</td><td>{{ row['planName'] || row['planId'] }}</td><td>{{ (row['amount'] || row['price'] || 0) | auraMoney:'1.0-0' }}</td><td>{{ row['createdAt'] || row['takenOn'] || '-' }}</td>
                </tr></tbody></table>
            </div>
            <ng-template #noCancelledReport><div class="empty-panel compact-empty"><strong>No cancellations.</strong></div></ng-template>
          </section>

          <section class="form-panel report-card report-detail-card inner-form-grid inner-page-card" *ngIf="activeReportTab() === 'staffWiseSales'">
            <h3>Staff-wise sales</h3>
            <div class="table-wrap compact-table inner-table-wrap" *ngIf="reportSet('staffWiseSales').length; else noStaffReport">
              <table><thead><tr><th>Staff</th><th>Sale</th><th>Renewal</th><th>Upgrade</th><th>Commission</th></tr></thead>
                <tbody><tr *ngFor="let row of reportSet('staffWiseSales').slice(0, 8)">
                  <td>{{ row['staffName'] || 'System' }}</td><td>{{ row['saleRevenue'] | auraMoney:'1.0-0' }}</td><td>{{ row['renewalRevenue'] | auraMoney:'1.0-0' }}</td><td>{{ row['upgradeRevenue'] | auraMoney:'1.0-0' }}</td><td>{{ row['commissionPreview'] | auraMoney:'1.0-0' }}</td>
                </tr></tbody></table>
            </div>
            <ng-template #noStaffReport><div class="empty-panel compact-empty"><strong>No staff sales rows.</strong></div></ng-template>
          </section>

          <section class="form-panel report-card report-detail-card inner-form-grid inner-page-card" *ngIf="activeReportTab() === 'planWiseProfitability'">
            <h3>Plan-wise profitability</h3>
            <div class="table-wrap compact-table inner-table-wrap" *ngIf="reportSet('planWiseProfitability').length; else noPlanReport">
              <table><thead><tr><th>Plan</th><th>Revenue</th><th>Leakage</th><th>Liability</th><th>Margin</th></tr></thead>
                <tbody><tr *ngFor="let row of reportSet('planWiseProfitability').slice(0, 8)">
                  <td>{{ row['planName'] }}</td><td>{{ row['revenue'] | auraMoney:'1.0-0' }}</td><td>{{ row['discountLeakage'] | auraMoney:'1.0-0' }}</td><td>{{ row['creditLiability'] | auraMoney:'1.0-0' }}</td><td>{{ row['marginPercent'] || 0 }}%</td>
                </tr></tbody></table>
            </div>
            <ng-template #noPlanReport><div class="empty-panel compact-empty"><strong>No plan profitability rows.</strong></div></ng-template>
          </section>

          <section class="form-panel report-card report-detail-card inner-form-grid inner-page-card" *ngIf="activeReportTab() === 'creditLiability'">
            <h3>Credit liability</h3>
            <div class="table-wrap compact-table inner-table-wrap" *ngIf="reportSet('creditLiability').length; else noCreditReport">
              <table><thead><tr><th>Client</th><th>Plan</th><th>Credits</th><th>Value</th></tr></thead>
                <tbody><tr *ngFor="let row of reportSet('creditLiability').slice(0, 8)">
                  <td>{{ row['clientName'] }}</td><td>{{ row['planName'] }}</td><td>{{ row['creditsRemaining'] }}</td><td>{{ row['liabilityValue'] | auraMoney:'1.0-0' }}</td>
                </tr></tbody></table>
            </div>
            <ng-template #noCreditReport><div class="empty-panel compact-empty"><strong>No credit liability.</strong></div></ng-template>
          </section>

          <section class="form-panel report-card report-detail-card inner-form-grid inner-page-card" *ngIf="activeReportTab() === 'autoRenewFailedPayments'">
            <h3>Auto-renew failed payments</h3>
            <div class="table-wrap compact-table inner-table-wrap" *ngIf="reportSet('autoRenewFailedPayments').length; else noAutoFailedReport">
              <table><thead><tr><th>Client</th><th>Plan</th><th>Status</th><th>Retry</th></tr></thead>
                <tbody><tr *ngFor="let row of reportSet('autoRenewFailedPayments').slice(0, 8)">
                  <td>{{ row['clientName'] || clientName(row['clientId']) }}</td><td>{{ row['planName'] || row['planId'] }}</td><td><span class="badge danger">{{ row['status'] }}</span></td><td>{{ row['retryCount'] || 0 }}</td>
                </tr></tbody></table>
            </div>
            <ng-template #noAutoFailedReport><div class="empty-panel compact-empty"><strong>No failed auto-renew payments.</strong></div></ng-template>
          </section>

          <section class="form-panel report-card report-detail-card inner-form-grid inner-page-card" *ngIf="activeReportTab() === 'upgradeDowngrade'">
            <h3>Upgrade / downgrade</h3>
            <div class="table-wrap compact-table inner-table-wrap" *ngIf="reportSet('upgradeDowngrade').length; else noLifecycleReport">
              <table><thead><tr><th>Client</th><th>Action</th><th>Amount</th><th>Staff</th></tr></thead>
                <tbody><tr *ngFor="let row of reportSet('upgradeDowngrade').slice(0, 8)">
                  <td>{{ row['clientName'] }}</td><td>{{ row['action'] }}</td><td>{{ (row['amount'] || row['refundAmount'] || 0) | auraMoney:'1.0-0' }}</td><td>{{ row['staffName'] || 'System' }}</td>
                </tr></tbody></table>
            </div>
            <ng-template #noLifecycleReport><div class="empty-panel compact-empty"><strong>No upgrade or downgrade rows.</strong></div></ng-template>
          </section>

          <section class="form-panel report-card report-detail-card inner-form-grid inner-page-card" *ngIf="activeReportTab() === 'discountLeakage'">
            <h3>Discount leakage</h3>
            <div class="table-wrap compact-table inner-table-wrap" *ngIf="reportSet('discountLeakage').length; else noDiscountReport">
              <table><thead><tr><th>Invoice</th><th>Plan</th><th>Discount</th><th>Risk</th></tr></thead>
                <tbody><tr *ngFor="let row of reportSet('discountLeakage').slice(0, 8)">
                  <td>{{ row['invoiceId'] || '-' }}</td><td>{{ row['planName'] || row['planId'] }}</td><td>{{ row['discountAmount'] | auraMoney:'1.0-0' }}</td><td><span class="badge" [ngClass]="riskBadgeClass(row['riskLevel'])">{{ row['riskLevel'] }}</span></td>
                </tr></tbody></table>
            </div>
            <ng-template #noDiscountReport><div class="empty-panel compact-empty"><strong>No discount leakage.</strong></div></ng-template>
          </section>

          <section class="form-panel report-card report-detail-card wide-report-card inner-form-grid inner-page-card" *ngIf="activeReportTab() === 'membershipSalesByCustomer'">
            <div class="section-title compact-section-title">
              <div>
                <h3>Membership Sales By Customer</h3>
              </div>
              <span class="badge">{{ reportSet('membershipSalesByCustomer').length }} rows</span>
            </div>
            <section class="member-count-strip compact-count-strip">
              <article><span>Total Count</span><strong>{{ reportMetric('membershipSalesTotalCount') }}</strong></article>
              <article><span>Total Offer Price</span><strong>{{ reportMetric('membershipSalesOfferPrice') | auraMoney:'1.0-0' }}</strong></article>
              <article><span>Total Ewallet</span><strong>{{ reportMetric('membershipSalesTotalEwallet') | auraMoney:'1.0-0' }}</strong></article>
              <article><span>Pending Ewallet</span><strong>{{ reportMetric('membershipSalesPendingEwallet') | auraMoney:'1.0-0' }}</strong></article>
              <article><span>Total Redeemed</span><strong>{{ reportMetric('membershipSalesTotalRedeemed') | auraMoney:'1.0-0' }}</strong></article>
              <article><span>Renewal Count</span><strong>{{ reportMetric('membershipSalesRenewalCount') }}</strong></article>
              <article><span>Active Memberships</span><strong>{{ reportMetric('membershipSalesActiveMemberships') }}</strong></article>
              <article><span>Expired Memberships</span><strong>{{ reportMetric('membershipSalesExpiredMemberships') }}</strong></article>
            </section>
            <div class="table-wrap compact-table inner-table-wrap" *ngIf="reportSet('membershipSalesByCustomer').length; else noMembershipSalesByCustomer">
              <table><thead><tr><th>Name</th><th>Contact</th><th>Membership / Plan</th><th>Plan Type</th><th>Sale Type</th><th>Offer Price</th><th>Paid</th><th>Due</th><th>Total Ewallet</th><th>Pending Ewallet</th><th>Redeemed</th><th>Staff</th><th>Invoice No</th><th>Branch</th><th>Expiry</th><th>Status</th><th>Date</th><th>Action</th></tr></thead>
                <tbody><tr *ngFor="let row of reportSet('membershipSalesByCustomer').slice(0, 30)">
                  <td>{{ row['clientName'] }}</td>
                  <td>{{ row['phone'] || '-' }}</td>
                  <td>{{ row['planName'] }}<small>{{ row['businessLabel'] || '' }}</small></td>
                  <td>{{ row['planType'] || '-' }}</td>
                  <td><span class="badge">{{ row['saleType'] || 'New Sale' }}</span></td>
                  <td>{{ row['offerPrice'] | auraMoney:'1.0-0' }}</td>
                  <td>{{ row['paidAmount'] | auraMoney:'1.0-0' }}</td>
                  <td>{{ row['dueAmount'] | auraMoney:'1.0-0' }}</td>
                  <td>{{ row['totalEwallet'] | auraMoney:'1.0-0' }}</td>
                  <td>{{ row['pendingEwallet'] | auraMoney:'1.0-0' }}</td>
                  <td>{{ row['redeemedAmount'] | auraMoney:'1.0-0' }}</td>
                  <td>{{ row['staffName'] || 'System' }}</td>
                  <td>{{ row['invoiceNumber'] || row['invoiceId'] || '-' }}</td>
                  <td>{{ row['branchId'] || '-' }}</td>
                  <td>{{ row['expiryDate'] || '-' }}</td>
                  <td><span class="badge" [class.danger]="row['status'] === 'expired' || row['status'] === 'cancelled'">{{ row['status'] || '-' }}</span></td>
                  <td>{{ row['date'] || '-' }}</td>
                  <td class="inline-actions">
                    <a class="ghost-button mini" *ngIf="row['clientId']" [routerLink]="['/clients', row['clientId']]">Client 360</a>
                    <a class="ghost-button mini" *ngIf="row['membershipId']" [routerLink]="['/memberships', row['membershipId']]">Membership 360</a>
                    <ng-container *ngIf="canAccessPath('/pos/invoices')">
                      <a class="ghost-button mini" *ngIf="row['invoiceId']" [routerLink]="['/pos/invoices']" [queryParams]="{ invoice: row['invoiceId'] }">Invoice</a>
                    </ng-container>
                  </td>
                </tr></tbody></table>
            </div>
            <ng-template #noMembershipSalesByCustomer><div class="empty-panel compact-empty"><strong>No membership customer sales rows.</strong><span>Membership sales, renewals, wallet liability and invoice references will appear here.</span></div></ng-template>
          </section>

          <section class="form-panel report-card report-detail-card wide-report-card inner-form-grid inner-page-card" *ngIf="activeReportTab() === 'membershipRedeem'">
            <div class="section-title compact-section-title">
              <div>
                <h3>Membership Redeem</h3>
              </div>
              <span class="badge">{{ reportSet('membershipRedeem').length }} rows</span>
            </div>
            <section class="member-count-strip compact-count-strip">
              <article><span>Total Membership</span><strong>{{ reportMetric('totalMembership') }}</strong></article>
              <article><span>Total Ewallet</span><strong>{{ reportMetric('totalEwallet') | auraMoney:'1.0-0' }}</strong></article>
              <article><span>Total Redeemed</span><strong>{{ reportMetric('totalRedeemed') | auraMoney:'1.0-0' }}</strong></article>
              <article><span>Redeem Count</span><strong>{{ reportMetric('redeemCount') }}</strong></article>
              <article><span>Active Wallet Clients</span><strong>{{ reportMetric('clientsWithActiveWallet') }}</strong></article>
              <article><span>Last Redeemed Today</span><strong>{{ reportMetric('lastRedeemedToday') }}</strong></article>
            </section>
            <div class="table-wrap compact-table inner-table-wrap" *ngIf="reportSet('membershipRedeem').length; else noRedeemReport">
              <table><thead><tr><th>Name</th><th>Contact</th><th>Membership / Plan</th><th>Ewallet</th><th>Last redeemed</th><th>Date</th><th>Time</th><th>Invoice / POS</th><th>Branch</th><th>Action</th></tr></thead>
                <tbody><tr *ngFor="let row of reportSet('membershipRedeem').slice(0, 30)">
                  <td>{{ row['clientName'] }}</td>
                  <td>{{ row['phone'] || '-' }}</td>
                  <td>{{ row['planName'] }}<small>{{ row['businessLabel'] || row['planType'] || '' }}</small></td>
                  <td>{{ row['ewalletBalance'] | auraMoney:'1.0-0' }}</td>
                  <td>{{ row['lastRedeemedAmount'] | auraMoney:'1.0-0' }}</td>
                  <td>{{ row['lastRedeemedDate'] || '-' }}</td>
                  <td>{{ row['lastRedeemedTime'] || '-' }}</td>
                  <td>{{ row['posReference'] || '-' }}</td>
                  <td>{{ row['branchId'] || '-' }}</td>
                  <td class="inline-actions">
                    <a class="ghost-button mini" *ngIf="row['clientId']" [routerLink]="['/clients', row['clientId']]">Client 360</a>
                    <a class="ghost-button mini" *ngIf="row['membershipId']" [routerLink]="['/memberships', row['membershipId']]">Membership 360</a>
                  </td>
                </tr></tbody></table>
            </div>
            <ng-template #noRedeemReport><div class="empty-panel compact-empty"><strong>No membership redeem rows.</strong><span>Redeem history, client membership ledger and POS snapshots will appear here.</span></div></ng-template>
          </section>
        </div>
      </section>

      <section class="panel rewards-panel inner-page-card" *ngIf="activeTab() === 'rewards'">
        <div class="section-title">
          <div>
            <h2>Rewards Ledger + ROI</h2>
          </div>
          <div class="inline-actions">
            <button class="ghost-button mini" type="button" (click)="loadRewards()" [disabled]="saving()">Apply filters</button>
            <button class="ghost-button mini" type="button" (click)="exportRewardsLedgerCsv()">Ledger CSV</button>
            <button class="ghost-button mini" type="button" (click)="exportRewardsRoiPdf()">ROI PDF</button>
            <button class="ghost-button mini" type="button" (click)="exportRewardAbusePdf()">Audit PDF</button>
          </div>
        </div>

        <section class="report-filter-grid reward-filter-grid">
          <label class="field"><span>From date</span><input type="date" [(ngModel)]="rewardFilters.fromDate" /></label>
          <label class="field"><span>To date</span><input type="date" [(ngModel)]="rewardFilters.toDate" /></label>
          <label class="field">
            <span>Client</span>
            <select [(ngModel)]="rewardFilters.clientId">
              <option value="">All clients</option>
              <option *ngFor="let client of clients()" [value]="client.id">{{ client.name || client['fullName'] || client.id }}</option>
            </select>
          </label>
          <label class="field">
            <span>Transaction type</span>
            <select [(ngModel)]="rewardFilters.transactionType">
              <option value="">All types</option>
              <option value="earned">Earned</option>
              <option value="redeemed">Redeemed</option>
              <option value="expired">Expired</option>
              <option value="reversed">Reversed</option>
              <option value="adjusted">Adjusted</option>
            </select>
          </label>
          <label class="field">
            <span>Staff / user</span>
            <select [(ngModel)]="rewardFilters.staffId">
              <option value="">All staff</option>
              <option *ngFor="let staff of staffMembers()" [value]="staff.id || staff['staffId']">{{ staffOption(staff) }}</option>
            </select>
          </label>
          <label class="field">
            <span>Branch</span>
            <select [(ngModel)]="rewardFilters.branchId">
              <option value="">All branches</option>
              <option *ngFor="let branch of branchOptions()" [value]="branch">{{ branch }}</option>
            </select>
          </label>
          <label class="field">
            <span>Risk level</span>
            <select [(ngModel)]="rewardFilters.riskLevel">
              <option value="all">All risks</option>
              <option value="critical">Critical</option>
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
            </select>
          </label>
          <label class="field">
            <span>Reward status</span>
            <select [(ngModel)]="rewardFilters.rewardStatus">
              <option value="">All statuses</option>
              <option value="active">Active balance</option>
              <option value="redeemed">Redeemed</option>
              <option value="expired">Expired</option>
              <option value="reversed">Reversed</option>
            </select>
          </label>
        </section>

        <section class="member-count-strip compact-count-strip rewards-kpis">
          <article><span>Reward clients</span><strong>{{ rewardMetric('totalRewardClients') }}</strong></article>
          <article><span>Points earned</span><strong>{{ rewardMetric('totalPointsEarned') }}</strong></article>
          <article><span>Points redeemed</span><strong>{{ rewardMetric('totalPointsRedeemed') }}</strong></article>
          <article><span>Reward revenue</span><strong>{{ rewardMetric('revenueFromRewardUsers') | auraMoney:'1.0-0' }}</strong></article>
          <article><span>Repeat rate</span><strong>{{ rewardMetric('repeatVisitRate') }}%</strong></article>
          <article><span>Abuse alerts</span><strong>{{ rewardAbuseRows().length }}</strong></article>
        </section>

        <nav class="report-section-tabs" aria-label="Reward report sections">
          <button type="button" [class.active]="activeRewardTab() === 'ledger'" (click)="setRewardTab('ledger')">Rewards Ledger <span>{{ rewardLedgerRows().length }}</span></button>
          <button type="button" [class.active]="activeRewardTab() === 'roi'" (click)="setRewardTab('roi')">Reward ROI <span>{{ rewardRoiRows().length }}</span></button>
          <button type="button" [class.active]="activeRewardTab() === 'expiring'" (click)="setRewardTab('expiring')">Expiring Rewards <span>{{ expiringRewardRows().length }}</span></button>
          <button type="button" [class.active]="activeRewardTab() === 'abuse'" (click)="setRewardTab('abuse')">Abuse Alerts <span>{{ rewardAbuseRows().length }}</span></button>
        </nav>

        <section class="form-panel report-card report-detail-card inner-form-grid inner-page-card" *ngIf="activeRewardTab() === 'ledger'">
          <h3>Reward Ledger</h3>
          <div class="table-wrap compact-table reward-ledger-table" *ngIf="rewardLedgerRows().length; else noRewardLedger">
            <table>
              <thead><tr><th>Date</th><th>Time</th><th>Client</th><th>Phone</th><th>Invoice / appointment</th><th>Type</th><th>Earned</th><th>Redeemed</th><th>Expired</th><th>Balance</th><th>Reason</th><th>Created by</th><th>Branch</th><th>Action</th></tr></thead>
              <tbody><tr *ngFor="let row of rewardLedgerRows().slice(0, 120)">
                <td>{{ row['date'] }}</td><td>{{ row['time'] || '-' }}</td>
                <td>{{ row['clientName'] }}</td><td>{{ row['clientPhone'] || '-' }}</td>
                <td><strong>{{ row['invoiceNumber'] || row['invoiceId'] || '-' }}</strong><small>{{ row['appointmentId'] || row['invoiceStatus'] || '' }}</small></td>
                <td><span class="badge" [class.danger]="row['transactionType'] === 'reversed'">{{ row['transactionType'] }}</span></td>
                <td>{{ row['earnedPoints'] || 0 }}</td><td>{{ row['redeemedPoints'] || 0 }}</td><td>{{ row['expiredPoints'] || 0 }}</td><td>{{ row['balanceAfter'] || 0 }}</td>
                <td>{{ row['reason'] || '-' }}</td><td>{{ row['createdBy'] || 'system' }}</td><td>{{ row['branch'] || row['branchId'] || '-' }}</td>
                <td><a class="ghost-button mini" [routerLink]="['/clients', row['clientId']]">Client</a><ng-container *ngIf="canAccessPath('/pos/invoices')"><a class="ghost-button mini" *ngIf="row['invoiceId']" routerLink="/pos/invoices">Invoice</a></ng-container></td>
              </tr></tbody>
            </table>
          </div>
          <ng-template #noRewardLedger><div class="empty-panel compact-empty"><strong>No reward ledger rows.</strong><span>Earn, redeem, expiry, reversal and adjustment entries will appear here.</span></div></ng-template>
        </section>

        <section class="form-panel report-card report-detail-card inner-form-grid inner-page-card" *ngIf="activeRewardTab() === 'roi'">
          <h3>Reward ROI</h3>
          <div class="table-wrap compact-table inner-table-wrap" *ngIf="rewardRoiRows().length; else noRewardRoi">
            <table><thead><tr><th>Client</th><th>Visits</th><th>Total sale</th><th>Earned</th><th>Redeemed</th><th>Balance</th><th>Repeat revenue</th><th>Suggested action</th></tr></thead>
              <tbody><tr *ngFor="let row of rewardRoiRows().slice(0, 80)">
                <td>{{ row['clientName'] || clientName(row['clientId']) }}<small>{{ row['clientPhone'] || '' }}</small></td>
                <td>{{ row['visits'] || 0 }}</td><td>{{ row['totalSale'] | auraMoney:'1.0-0' }}</td><td>{{ row['rewardEarned'] || 0 }}</td><td>{{ row['rewardRedeemed'] || 0 }}</td><td>{{ row['pendingRewardBalance'] || 0 }}</td><td>{{ row['repeatRevenue'] | auraMoney:'1.0-0' }}</td><td>{{ row['suggestedAction'] }}</td>
              </tr></tbody></table>
          </div>
          <ng-template #noRewardRoi><div class="empty-panel compact-empty"><strong>No reward ROI rows.</strong><span>Reward users vs non-reward revenue appears after loyalty activity starts.</span></div></ng-template>
        </section>

        <section class="form-panel report-card report-detail-card inner-form-grid inner-page-card" *ngIf="activeRewardTab() === 'expiring'">
          <h3>Expiring Rewards</h3>
          <div class="table-wrap compact-table inner-table-wrap" *ngIf="expiringRewardRows().length; else noExpiringRewards">
            <table><thead><tr><th>Client</th><th>Phone</th><th>Points expiring</th><th>Expiry date</th><th>Days left</th><th>Value</th><th>Last visit</th><th>Reminder</th></tr></thead>
              <tbody><tr *ngFor="let row of expiringRewardRows().slice(0, 80)">
                <td>{{ row['clientName'] }}</td><td>{{ row['phone'] || '-' }}</td><td>{{ row['pointsExpiring'] || 0 }}</td><td>{{ row['expiryDate'] }}</td><td><span class="badge" [class.danger]="row['daysLeft'] <= 7">{{ row['daysLeft'] }}d</span></td><td>{{ row['estimatedValue'] | auraMoney:'1.0-0' }}</td><td>{{ row['lastVisitDate'] || '-' }}</td>
                <td><button class="ghost-button mini" type="button" [disabled]="saving()" (click)="sendRewardExpiryReminder(row)">Send WhatsApp</button><small>{{ row['reminderStatus']?.['status'] || 'not_sent' }}</small></td>
              </tr></tbody></table>
          </div>
          <ng-template #noExpiringRewards><div class="empty-panel compact-empty"><strong>No rewards expiring in this window.</strong><span>Clients with active points expiring in 30 days appear here.</span></div></ng-template>
        </section>

        <section class="form-panel report-card report-detail-card inner-form-grid inner-page-card" *ngIf="activeRewardTab() === 'abuse'">
          <h3>Abuse Alerts</h3>
          <div class="table-wrap compact-table inner-table-wrap" *ngIf="rewardAbuseRows().length; else noRewardAbuse">
            <table><thead><tr><th>Alert type</th><th>Client</th><th>Invoice / ref</th><th>Points</th><th>Staff/user</th><th>Risk</th><th>Suggested action</th></tr></thead>
              <tbody><tr *ngFor="let row of rewardAbuseRows().slice(0, 100)">
                <td>{{ row['alertType'] }}</td><td>{{ row['client'] || clientName(row['clientId']) }}</td><td>{{ row['invoiceReference'] || '-' }}</td><td>{{ row['points'] || row['amount'] || 0 }}</td><td>{{ row['staffUser'] || 'system' }}</td><td><span class="badge" [ngClass]="riskBadgeClass(row['riskLevel'])">{{ row['riskLevel'] }}</span></td><td>{{ row['suggestedAction'] }}</td>
              </tr></tbody></table>
          </div>
          <ng-template #noRewardAbuse><div class="empty-panel compact-empty"><strong>No reward abuse alerts.</strong><span>Cancelled invoice reward, unmatched redemption, high redemption and negative balance risks appear here.</span></div></ng-template>
        </section>
      </section>

      <div class="modal-backdrop" *ngIf="renewalMembership() as renewal" (click)="closeRenewalDialog()">
        <section class="renewal-modal" role="dialog" aria-modal="true" aria-labelledby="renewalTitle" (click)="$event.stopPropagation()">
          <div class="section-title compact-title">
            <div>
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
              <strong>{{ renewal.validityDate ? (renewal.validityDate | auraDate:'date') : 'No expiry' }}</strong>
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
              <textarea formControlName="zeroReason" placeholder="Required for â‚¹0 renewal"></textarea>
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
              <strong>{{ dialog.summary.oldPrice | auraMoney:'1.0-0' }}</strong>
            </article>
            <article>
              <span>Unused value</span>
              <strong>{{ dialog.summary.unusedValue | auraMoney:'1.0-0' }}</strong>
            </article>
            <article>
              <span>Target value</span>
              <strong>{{ (dialog.summary.targetValue || dialog.summary.newPrice) | auraMoney:'1.0-0' }}</strong>
            </article>
            <article>
              <span>Payable difference</span>
              <strong>{{ lifecyclePayableAmount() | auraMoney:'1.0-0' }}</strong>
            </article>
            <article>
              <span>Credit note</span>
              <strong>{{ (dialog.summary.creditNoteAmount || lifecycleRefundAmount()) | auraMoney:'1.0-0' }}</strong>
            </article>
            <article>
              <span>Refund amount</span>
              <strong>{{ lifecycleRefundAmount() | auraMoney:'1.0-0' }}</strong>
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
                <option *ngFor="let plan of activeMembershipPlans()" [value]="plan.id">{{ plan.name }} Â· {{ plan.price | auraMoney:'1.0-0' }}</option>
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
              <textarea formControlName="zeroReason" placeholder="Required for â‚¹0 upgrade"></textarea>
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
      flex-wrap: wrap;
      gap: 8px;
      align-items: center;
      padding: 10px;
      overflow: visible;
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
      flex: 0 1 auto;
      transition: background 120ms ease, border-color 120ms ease, color 120ms ease;
    }

    .membership-tabs button:hover {
      background: #eef7f5;
      color: #4B1238;
    }

    .membership-tabs button.active {
      border-color: rgba(75, 18, 56, 0.28);
      background: #4B1238;
      color: #fff;
      box-shadow: 0 8px 20px rgba(75, 18, 56, 0.18);
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
      margin-left: 0;
      border-color: rgba(15, 23, 42, 0.12);
      background: #fff;
      color: #0f172a;
    }

    .member-count-strip {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
      gap: 10px;
      padding: 10px;
      border: 1px solid rgba(15, 23, 42, 0.08);
      border-radius: 16px;
      background: #fff;
      box-shadow: 0 12px 30px rgba(15, 23, 42, 0.045);
    }

    .member-count-strip article,
    .member-count-strip button {
      display: grid;
      gap: 2px;
      min-height: 76px;
      padding: 12px 14px;
      border-radius: 12px;
      background: #f8fbfb;
      border: 1px solid rgba(15, 23, 42, 0.06);
      color: inherit;
      font: inherit;
      text-align: left;
    }

    .member-count-strip button {
      cursor: pointer;
      transition: border-color 0.18s ease, box-shadow 0.18s ease, transform 0.18s ease, background 0.18s ease;
    }

    .membership-summary-strip button:hover,
    .membership-summary-strip button:focus-visible,
    .membership-summary-strip button.active {
      border-color: rgba(109, 27, 77, 0.42);
      background: #F3EAF0;
      box-shadow: 0 10px 22px rgba(109, 27, 77, 0.12);
      outline: none;
      transform: translateY(-1px);
    }

    .compact-count-strip article {
      cursor: pointer;
      transition: border-color 0.18s ease, box-shadow 0.18s ease, transform 0.18s ease;
    }

    .compact-count-strip article:hover,
    .compact-count-strip article:focus-visible {
      border-color: rgba(109, 27, 77, 0.42);
      box-shadow: 0 10px 22px rgba(109, 27, 77, 0.12);
      outline: none;
      transform: translateY(-1px);
    }

    .member-count-strip span,
    .member-count-strip small {
      color: #64748b;
      font-size: 0.78rem;
      font-weight: 800;
    }

    .member-count-strip strong {
      color: #0f172a;
      font-size: 1.45rem;
      font-variant-numeric: tabular-nums;
      line-height: 1.05;
    }

    .membership-stats {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 12px;
    }

    .membership-stats .metric-card {
      min-height: 112px;
      border-top: 3px solid #4B1238;
      box-shadow: 0 14px 32px rgba(15, 23, 42, 0.05);
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
        linear-gradient(135deg, rgba(75, 18, 56, 0.92), rgba(75, 18, 56, 0.85)),
        #4B1238;
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

    .plan-reference-layout {
      position: relative;
      min-height: calc(100vh - 260px);
      padding: 18px 24px 28px;
      border-radius: 8px;
      background: #fff;
      box-shadow: 0 1px 0 rgba(15, 23, 42, 0.04);
    }

    .plans-title h1 {
      margin: 0 0 8px;
      color: #111827;
      font-size: 28px;
      line-height: 1.15;
    }

    .plans-title p {
      max-width: 780px;
      margin: 0;
      color: #4b5563;
      font-size: 14px;
      line-height: 1.5;
    }

    .plan-switch-grid {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 12px;
      margin: 26px 0 6px;
    }

    .plan-switch-grid button {
      display: grid;
      gap: 5px;
      min-height: 98px;
      border: 1px solid #d7ebe7;
      border-radius: 8px;
      background: #fff;
      color: #0f172a;
      padding: 14px 16px;
      text-align: left;
      cursor: pointer;
    }

    .plan-switch-grid button.active {
      border-color: #4B1238;
      background: #F3EAF0;
      box-shadow: 0 12px 28px rgba(75, 18, 56, 0.12);
    }

    .plan-switch-grid span,
    .plan-switch-grid small {
      color: #64748b;
      font-size: 0.82rem;
      font-weight: 800;
    }

    .plan-switch-grid strong {
      font-size: 1.55rem;
      line-height: 1;
    }

    .plan-table tr.active-row td {
      background: #F3EAF0;
    }

    .package-detail-card {
      display: grid;
      grid-template-columns: minmax(0, 1fr) minmax(320px, 0.7fr) auto;
      gap: 16px;
      align-items: center;
      margin-top: 16px;
      border: 1px solid #d7ebe7;
      border-radius: 8px;
      background: #f8fdfb;
      padding: 16px;
    }

    .package-detail-card h3,
    .package-detail-card p {
      margin: 0;
    }

    .mini-stats {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 10px;
    }

    .mini-stats article {
      border: 1px solid #d7ebe7;
      border-radius: 8px;
      background: #fff;
      padding: 12px;
    }

    .mini-stats span {
      display: block;
      color: #64748b;
      font-size: 0.75rem;
      font-weight: 800;
    }

    .mini-stats strong {
      display: block;
      margin-top: 4px;
      font-size: 1.05rem;
    }

    .giftcard-workspace {
      display: grid;
      gap: 16px;
      margin-top: 20px;
    }

    .floating-add {
      position: absolute;
      top: 22px;
      right: 28px;
      width: 44px;
      height: 44px;
      border: 0;
      border-radius: 50%;
      background: #24262b;
      color: #fff;
      font-size: 30px;
      line-height: 1;
      box-shadow: 0 14px 24px rgba(15, 23, 42, 0.2);
      cursor: pointer;
    }

    .list-controls,
    .list-footer,
    .pager,
    .plan-name-cell,
    .action-cell {
      display: flex;
      align-items: center;
    }

    .list-controls {
      justify-content: space-between;
      gap: 16px;
      margin: 42px 0 18px;
    }

    .show-control {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      color: #6b7280;
      font-size: 14px;
    }

    .show-control select {
      width: 72px;
      min-height: 36px;
      border-color: #d1d5db;
      border-radius: 4px;
      padding: 6px 28px 6px 10px;
    }

    .search-pill {
      width: min(100%, 250px);
    }

    .search-pill input {
      min-height: 38px;
      border-color: #d1d5db;
      border-radius: 999px;
      padding: 8px 34px 8px 14px;
      background: #fff;
    }

    .audit-search-actions input {
      width: min(360px, 64vw);
      min-height: 38px;
      border: 1px solid #d1d5db;
      border-radius: 999px;
      padding: 8px 14px;
      background: #fff;
      color: #0f172a;
      font: inherit;
    }

    .plan-table-wrap {
      overflow: visible;
      border-top: 1px solid #e5e7eb;
    }

    .plan-table {
      width: 100%;
      min-width: 820px;
      border-collapse: collapse;
      table-layout: fixed;
    }

    .plan-table th,
    .plan-table td {
      border-bottom: 1px solid #e5e7eb;
      padding: 12px 14px;
      background: #fff;
      color: #111827;
      text-align: left;
      vertical-align: middle;
    }

    .plan-table th {
      font-size: 13px;
      font-weight: 800;
      text-transform: none;
    }

    .plan-table .check-col {
      width: 42px;
      text-align: center;
    }

    .plan-table .action-col {
      width: 128px;
      text-align: right;
    }

    .plan-table th:last-child,
    .plan-table td:last-child {
      padding-right: 32px;
    }

    .plan-table input[type="checkbox"] {
      width: 15px;
      min-height: 15px;
      padding: 0;
      border-radius: 2px;
    }

    .plan-name-cell {
      gap: 12px;
      min-width: 0;
    }

    .plan-avatar {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 34px;
      height: 34px;
      flex: 0 0 34px;
      border-radius: 50%;
      background: #111827;
      color: #fff;
      font-size: 14px;
      font-weight: 900;
    }

    .plan-name-cell strong,
    .plan-name-cell small {
      display: block;
    }

    .plan-name-cell small {
      max-width: 560px;
      color: #6b7280;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .status-pill {
      display: inline-flex;
      min-width: 96px;
      justify-content: center;
      border-radius: 3px;
      background: #79cfad;
      color: #fff;
      padding: 6px 14px;
      font-size: 13px;
      font-weight: 800;
      text-transform: capitalize;
    }

    .action-cell {
      position: relative;
      justify-content: flex-end;
    }

    .dots-button {
      width: 34px;
      height: 30px;
      border: 1px solid #d1d5db;
      border-radius: 4px;
      background: #fff;
      color: #111827;
      font-size: 18px;
      font-weight: 900;
      line-height: 1;
      cursor: pointer;
    }

    .action-menu {
      position: absolute;
      top: 34px;
      right: 32px;
      z-index: 5;
      min-width: 150px;
      border: 1px solid #e5e7eb;
      border-radius: 4px;
      background: #fff;
      box-shadow: 0 16px 34px rgba(15, 23, 42, 0.18);
      padding: 4px 0;
    }

    .action-menu button,
    .action-menu a {
      display: block;
      width: 100%;
      min-height: 34px;
      border: 0;
      background: #fff;
      color: #111827;
      font: inherit;
      font-size: 13px;
      text-align: left;
      text-decoration: none;
      padding: 8px 12px;
      cursor: pointer;
    }

    .action-menu button:hover,
    .action-menu a:hover {
      background: #f3f4f6;
    }

    .empty-row {
      text-align: center;
      color: #6b7280;
      height: 90px;
    }

    .list-footer {
      justify-content: space-between;
      gap: 14px;
      margin-top: 18px;
      color: #6b7280;
      font-size: 14px;
    }

    .pager {
      gap: 8px;
    }

    .pager button {
      min-width: 42px;
      min-height: 36px;
      border: 1px solid #d1d5db;
      border-radius: 4px;
      background: #fff;
      color: #6b7280;
      font: inherit;
    }

    .pager button.active {
      border-color: #111827;
      color: #111827;
      font-weight: 800;
    }

    .sr-only {
      position: absolute;
      width: 1px;
      height: 1px;
      overflow: hidden;
      clip: rect(0, 0, 0, 0);
    }

    .plan-drawer-shell {
      position: fixed;
      inset: 0;
      z-index: 1000;
      display: flex;
      justify-content: flex-end;
    }

    .drawer-scrim {
      position: absolute;
      inset: 0;
      border: 0;
      background: rgba(15, 23, 42, 0.62);
    }

    .plan-drawer {
      position: relative;
      z-index: 1;
      width: min(100%, 500px);
      min-height: 100vh;
      overflow: auto;
      padding: 18px;
      background: #fff;
      box-shadow: -24px 0 60px rgba(15, 23, 42, 0.22);
    }

    .drawer-title {
      display: flex;
      align-items: center;
      gap: 12px;
      margin-bottom: 16px;
    }

    .drawer-title h2 {
      margin: 0;
      font-size: 22px;
    }

    .icon-button {
      border: 0;
      background: transparent;
      color: #111827;
      font: inherit;
      font-size: 28px;
      font-weight: 900;
      line-height: 1;
      cursor: pointer;
    }

    .drawer-help {
      margin: 0 0 14px;
      padding: 12px;
      background: #f3f4f6;
      color: #374151;
      font-size: 13px;
      line-height: 1.5;
    }

    .plan-drawer form {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 12px;
    }

    .plan-drawer .full,
    .plan-drawer button[type='submit'] {
      grid-column: 1 / -1;
    }

    .checkbox-field input {
      width: 22px;
      min-height: 22px;
    }

    .wallet-preview {
      border: 1px solid #FBF0E8;
      background: #FBF0E8;
      color: #7A4A28;
      gap: 4px;
    }

    .wallet-preview span {
      color: #7A4A28;
      font-size: 12px;
      font-weight: 700;
    }

    .compact-workbench {
      align-items: start;
      grid-template-columns: minmax(320px, 0.8fr) minmax(0, 1.25fr);
    }

    .sticky-panel {
      position: sticky;
      top: 78px;
    }

    .form-panel,
    .panel,
    .action-card,
    .metric-card {
      border-radius: 16px;
    }

    .form-panel form {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 12px;
    }

    .form-panel .full,
    .form-panel button[type='submit'] {
      grid-column: 1 / -1;
    }

    .field textarea {
      min-height: 78px;
      resize: vertical;
    }

    .compact-panel {
      min-height: 100%;
    }

    .plan-grid {
      grid-template-columns: repeat(auto-fill, minmax(230px, 1fr));
    }

    .plan-card {
      min-height: 160px;
      justify-content: space-between;
    }

    .plan-meta {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      margin: 8px 0;
    }

    .plan-meta span,
    .badge {
      display: inline-flex;
      align-items: center;
      border-radius: 999px;
      background: #EEE3EB;
      color: #4B1238;
      font-size: 0.78rem;
      font-weight: 800;
      padding: 5px 8px;
    }

    .badge.danger {
      background: #fee2e2;
      color: #b91c1c;
    }

    .report-filter-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
      gap: 12px;
      margin-bottom: 14px;
      padding: 14px;
      border: 1px solid rgba(15, 23, 42, 0.08);
      border-radius: 14px;
      background: #f8fbfb;
    }

    .report-grid {
      display: grid;
      grid-template-columns: minmax(0, 1fr);
      gap: 14px;
      margin-top: 14px;
    }

    .report-section-tabs {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin: 0 0 14px;
      padding: 10px;
      border: 1px solid rgba(15, 23, 42, 0.08);
      border-radius: 16px;
      background: #fff;
      overflow: visible;
      box-shadow: 0 12px 28px rgba(15, 23, 42, 0.06);
    }

    .report-section-tabs button {
      border: 0;
      border-radius: 999px;
      background: #f4f7f7;
      color: #334155;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      flex: 1 1 190px;
      font-weight: 900;
      padding: 10px 14px;
      white-space: nowrap;
    }

    .report-section-tabs button.active {
      background: #4B1238;
      color: #fff;
      box-shadow: 0 14px 26px rgba(75, 18, 56, 0.22);
    }

    .report-section-tabs span {
      border-radius: 999px;
      background: rgba(15, 23, 42, 0.08);
      font-size: 0.76rem;
      min-width: 24px;
      padding: 3px 7px;
      text-align: center;
    }

    .report-section-tabs button.active span {
      background: rgba(255, 255, 255, 0.22);
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

    .report-detail-card {
      min-height: 0;
    }

    .report-detail-card .compact-table {
      overflow-x: visible;
    }

    .report-detail-card .compact-table table {
      min-width: 0;
      width: 100%;
      table-layout: auto;
    }

    .report-detail-card .compact-table th,
    .report-detail-card .compact-table td {
      white-space: normal;
      overflow-wrap: anywhere;
      vertical-align: top;
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
      margin-bottom: 12px;
    }

    .wallet-panel {
      margin-bottom: 12px;
    }

    .wallet-snapshot-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 10px;
      margin: 12px 0;
    }

    .wallet-snapshot-grid div {
      min-height: 72px;
      padding: 12px;
      border: 1px solid rgba(15, 23, 42, 0.08);
      border-radius: 14px;
      background: #f8fbfb;
    }

    .wallet-snapshot-grid span,
    .wallet-snapshot-grid b {
      display: block;
    }

    .wallet-snapshot-grid b {
      margin-top: 4px;
      color: #0f172a;
      font-size: 0.94rem;
    }

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
      .membership-stats,
      .member-count-strip,
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

      .membership-stats,
      .member-count-strip,
      .membership-overview-grid,
      .plan-switch-grid,
      .package-detail-card,
      .mini-stats,
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

      .sticky-panel {
        position: static;
      }

      .membership-tabs {
        top: 0;
      }

      .membership-tabs .refresh-tab {
        margin-left: 0;
      }
    }
  `]
})
export class MembershipsComponent implements OnInit, OnDestroy {
  readonly membershipPlans = signal<PosMembershipPlan[]>([]);
  readonly packageRecords = signal<ApiRecord[]>([]);
  readonly memberships = signal<ApiRecord[]>([]);
  readonly clients = signal<ApiRecord[]>([]);
  readonly staffMembers = signal<ApiRecord[]>([]);
  readonly giftCards = signal<ApiRecord[]>([]);
  readonly selectedGiftCard = signal<ApiRecord | null>(null);
  readonly ledger = signal<ApiRecord[]>([]);
  readonly reminders = signal<ApiRecord[]>([]);
  readonly autoRenewQueue = signal<ApiRecord[]>([]);
  readonly autoRenewSummary = signal<ApiRecord>({});
  readonly report = signal<MembershipReport>({});
  readonly commissionReport = signal<MembershipCommissionReport>({});
  readonly riskReport = signal<MembershipRiskReport>({});
  readonly enterpriseReport = signal<MembershipEnterpriseReport>({});
  readonly rewardReport = signal<RewardReport>({});
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
  readonly membershipListFilter = signal<MembershipListFilter>('all');
  readonly activeReportTab = signal<MembershipReportTab>('actionQueue');
  readonly activeRewardTab = signal<RewardDeskTab>('ledger');
  readonly planWorkspaceView = signal<PlanWorkspaceView>('plans');
  readonly showPlanDrawer = signal(false);
  readonly planQuery = signal('');
  readonly planShowLimit = signal(10);
  readonly openPlanActionId = signal('');
  readonly selectedPackageId = signal('');
  readonly renewalMembership = signal<ApiRecord | null>(null);
  readonly lifecycleDialog = signal<PlanLifecycleDialog | null>(null);
  readonly prorationLoading = signal(false);
  quickLifecyclePlanId = '';
  riskFilter = 'all';
  auditLedgerSearch = '';
  auditLedgerSearchDraft = '';
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
    planType: '',
    staffId: '',
    clientId: '',
    clientSearch: '',
    status: '',
    saleType: '',
    redeemStatus: '',
    walletBalance: '',
    paymentMode: '',
    riskLevel: 'all'
  };
  rewardFilters = {
    fromDate: '',
    toDate: '',
    clientId: '',
    transactionType: '',
    staffId: '',
    branchId: '',
    riskLevel: 'all',
    rewardStatus: ''
  };
  private reportRefreshTimer: ReturnType<typeof setInterval> | null = null;
  private enterpriseReportLoading = false;
  private enterpriseReportRefreshQueued = false;

  readonly planForm = this.fb.group({
    id: [''],
    version: [1],
    planType: ['discount'],
    code: [''],
    name: ['Aura Gold 30%', Validators.required],
    description: ['Every bill discount plan'],
    price: [2999, Validators.required],
    discountPercent: [30, Validators.required],
    productDiscountPercent: [0],
    creditAmount: [0],
    creditUnit: ['amount'],
    bonusAmount: [0],
    benefitPercent: [0],
    perVisitLimitType: ['none'],
    perVisitLimitValue: [0],
    serviceRestrictionType: ['all'],
    serviceRestrictionValue: [''],
    includedServicesValue: [''],
    monthlyCap: [4],
    familyMemberLimit: [4],
    familyShareBenefits: [true],
    corporateLabel: [''],
    corporateDomain: [''],
    corporateEmployeeIdRequired: [true],
    tierName: ['Gold'],
    tierSpendThreshold: [50000],
    tierVisitThreshold: [0],
    birthdayBenefit: [false],
    anniversaryBenefit: [false],
    priorityBooking: [false],
    allowProductRedeem: [false],
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

  readonly filteredMembershipPlans = computed(() => {
    const term = this.planQuery().trim().toLowerCase();
    const rows = [...this.membershipPlans()].sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
    if (!term) return rows;
    return rows.filter((plan) => [
      plan.name,
      plan.code,
      this.planSummary(plan),
      plan.status || (plan.active ? 'active' : 'inactive')
    ].join(' ').toLowerCase().includes(term));
  });
  readonly visibleMembershipPlans = computed(() => this.filteredMembershipPlans().slice(0, Math.max(1, this.planShowLimit())));
  readonly visibleMemberships = computed(() => {
    const filter = this.membershipListFilter();
    if (filter === 'active') return this.memberships().filter((membership) => this.isActiveMembershipRecord(membership));
    if (filter === 'renewalRisk') return this.memberships().filter((membership) => this.isRenewalRiskMembership(membership));
    return this.memberships();
  });
  readonly rewardLedgerRows = computed(() => this.rewardReport().ledger || []);
  readonly rewardRoiRows = computed(() => ((this.rewardReport().roi as ApiRecord | undefined)?.['rows'] as ApiRecord[] | undefined) || []);
  readonly expiringRewardRows = computed(() => this.rewardReport().expiring || []);
  readonly rewardAbuseRows = computed(() => this.rewardReport().abuseAlerts || []);

  constructor(
    private readonly api: ApiService,
    private readonly fb: UntypedFormBuilder,
    private readonly posSettings: PosSettingsService,
    private readonly route: ActivatedRoute,
    private readonly state: AppStateService,
    private readonly session: AuthSessionService
  ) {}

  canAccessPath(path: string): boolean {
    const permission = routePermissionForPath(path);
    if (!permission || (Array.isArray(permission) && !permission.length)) return true;
    const permissions = Array.isArray(permission) ? permission : [permission];
    const dynamicGrants = this.session.currentUser()?.permissions || [];
    const grants = Array.from(new Set([...staticGrantsForRole(this.state.userRole()), ...dynamicGrants]));
    return permissions.some((item) => grantsAllow(grants, item));
  }

  ngOnInit(): void {
    this.applyQueryParams();
    this.membershipPlans.set(this.posSettings.loadMembershipPlans());
    this.load();
    if (this.activeTab() === 'reports') this.startReportLiveRefresh();
  }

  private applyQueryParams(): void {
    const params = this.route.snapshot.queryParamMap;
    const tab = params.get('tab') || '';
    const report = params.get('report') || '';
    const tabs: MembershipDeskTab[] = ['overview', 'plans', 'active', 'audit', 'commission', 'risk', 'reports', 'rewards', 'reminders', 'autoRenew'];
    const reports: MembershipReportTab[] = ['actionQueue', 'activeMembers', 'expiringSoon', 'renewalRevenue', 'cancelledMemberships', 'staffWiseSales', 'planWiseProfitability', 'creditLiability', 'autoRenewFailedPayments', 'upgradeDowngrade', 'discountLeakage', 'membershipRedeem', 'membershipSalesByCustomer'];
    if (tabs.includes(tab as MembershipDeskTab)) this.activeTab.set(tab as MembershipDeskTab);
    if (reports.includes(report as MembershipReportTab)) this.activeReportTab.set(report as MembershipReportTab);
  }

  ngOnDestroy(): void {
    this.stopReportLiveRefresh();
  }

  load(): void {
    this.loading.set(true);
    this.error.set('');
    forkJoin({
      plans: this.safeList<PosMembershipPlan[]>('membership-enterprise/plans'),
      packages: this.safeList<ApiRecord[]>('packages', { limit: 1000, includeAllBranches: true }),
      memberships: this.safeList<ApiRecord[]>('memberships', { limit: 1000 }),
      clients: this.safeList<ApiRecord[]>('clients', { limit: 1000 }),
      membershipLabels: this.safeList<ApiRecord[]>('visibility/membership-client-labels'),
      staff: this.quietList<ApiRecord[]>('staff', { limit: 1000 }),
      giftCards: this.safeList<ApiRecord[]>('giftCards', { limit: 1000 }),
      ledger: this.safeList<ApiRecord[]>('membership-enterprise/ledger', this.auditLedgerParams()),
      reminders: this.safeList<ApiRecord[]>('membership-enterprise/reminders', { limit: 100 }),
      autoRenew: this.safeList<ApiRecord>('membership-enterprise/auto-renew/queue', { limit: 100 }),
      report: this.safeList<MembershipReport>('membership-enterprise/reports/revenue'),
      commission: this.safeList<MembershipCommissionReport>('membership-enterprise/reports/commission'),
      risk: this.safeList<MembershipRiskReport>('membership-enterprise/reports/risk'),
      enterpriseReport: this.safeList<MembershipEnterpriseReport>('membership-enterprise/reports/enterprise', this.reportFilterParams()),
      rewardsLedger: this.safeList<ApiRecord[]>('membership-enterprise/rewards/ledger', this.rewardFilterParams()),
      rewardsRoi: this.safeList<ApiRecord>('membership-enterprise/rewards/roi', this.rewardFilterParams()),
      rewardsExpiring: this.safeList<ApiRecord[]>('membership-enterprise/rewards/expiring', this.rewardFilterParams()),
      rewardsAbuse: this.safeList<ApiRecord[]>('membership-enterprise/rewards/abuse-alerts', this.rewardFilterParams())
    }).subscribe(({ plans, packages, memberships, clients, membershipLabels, staff, giftCards, ledger, reminders, autoRenew, report, commission, risk, enterpriseReport, rewardsLedger, rewardsRoi, rewardsExpiring, rewardsAbuse }) => {
      const livePlans = (plans || []).map((plan) => this.normalizePlan(plan));
      if (livePlans.length) {
        this.membershipPlans.set(livePlans);
        this.posSettings.saveMembershipPlans(livePlans);
      }
      const livePackages = Array.isArray(packages) ? packages : [];
      this.packageRecords.set(livePackages);
      if (!this.selectedPackageId() && livePackages.length) this.selectedPackageId.set(String(livePackages[0].id || livePackages[0]['packageId'] || ''));
      this.memberships.set(memberships || []);
      const clientMap = new Map([...(clients || []), ...(membershipLabels || [])].map((client) => [String(client.id), client]));
      this.clients.set([...clientMap.values()]);
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
      this.rewardReport.set({
        ledger: rewardsLedger || [],
        roi: rewardsRoi || {},
        expiring: rewardsExpiring || [],
        abuseAlerts: rewardsAbuse || []
      });
      this.loading.set(false);
    });
  }

  setTab(tab: MembershipDeskTab): void {
    this.activeTab.set(tab);
    if (tab === 'reports') {
      this.loadEnterpriseReports({ silent: true });
      this.startReportLiveRefresh();
    } else if (tab === 'rewards') {
      this.loadRewards({ silent: true });
      this.stopReportLiveRefresh();
    } else {
      this.stopReportLiveRefresh();
    }
  }

  openPlanWorkspace(view: PlanWorkspaceView): void {
    this.activeTab.set('plans');
    this.planWorkspaceView.set(view);
    this.stopReportLiveRefresh();
  }

  openMembershipKpi(target: MembershipKpiTarget): void {
    if (target === 'plans') {
      this.setTab('plans');
      return;
    }
    this.membershipListFilter.set(target);
    this.setTab('active');
  }

  memberListTitle(): string {
    if (this.membershipListFilter() === 'active') return 'Active members';
    if (this.membershipListFilter() === 'renewalRisk') return 'Renewal risk members';
    return 'All members and active memberships';
  }

  setReportTab(tab: MembershipReportTab): void {
    this.activeReportTab.set(tab);
    if (this.activeTab() === 'reports') this.loadEnterpriseReports({ silent: true });
  }

  setRewardTab(tab: RewardDeskTab): void {
    this.activeRewardTab.set(tab);
    if (this.activeTab() === 'rewards') this.loadRewards({ silent: true });
  }

  openPlanDrawer(): void {
    this.resetPlanForm();
    this.showPlanDrawer.set(true);
  }

  closePlanDrawer(): void {
    this.showPlanDrawer.set(false);
    this.openPlanActionId.set('');
    if (!this.editingPlanId()) this.resetPlanForm();
  }

  private advancedPlanJson(): { includedServices: unknown[]; benefitRules: Record<string, unknown> } | null {
    try {
      return {
        includedServices: JSON.parse(this.planForm.value.includedServicesText || '[]'),
        benefitRules: JSON.parse(this.planForm.value.benefitRulesText || '{}')
      };
    } catch {
      this.error.set('Advanced included services or benefit rules must be valid JSON.');
      return null;
    }
  }

  private structuredIncludedServices(base: unknown[]): unknown[] {
    const structured = this.parseServiceList(this.planForm.value.includedServicesValue || '').map((value) => ({
      serviceId: value,
      serviceName: value,
      credits: Math.max(1, Math.floor(Number(this.planForm.value.creditAmount || 1)))
    }));
    if (!structured.length) return base;
    const existing = new Set(base.map((item: unknown) => String((item as ApiRecord)?.['serviceId'] || item || '').toLowerCase()));
    return [...base, ...structured.filter((item) => !existing.has(String(item.serviceId).toLowerCase()))];
  }

  private buildStructuredBenefitRules(baseRules: Record<string, unknown>): Record<string, unknown> {
    const planType = String(this.planForm.value.planType || 'discount');
    const price = Number(this.planForm.value.price || 0);
    const creditAmount = Math.max(0, Number(this.planForm.value.creditAmount || 0));
    const bonusAmount = Math.max(0, Number(this.planForm.value.bonusAmount || 0));
    const creditValue = planType === 'prepaid_credit'
      ? Math.max(0, creditAmount || price + bonusAmount)
      : creditAmount;
    const serviceRestrictionType = String(this.planForm.value.serviceRestrictionType || 'all');
    const serviceRestrictionValue = String(this.planForm.value.serviceRestrictionValue || this.planForm.value.includedServicesValue || '').trim();
    const perVisitLimitType = String(this.planForm.value.perVisitLimitType || 'none');
    const perVisitLimitValue = Math.max(0, Number(this.planForm.value.perVisitLimitValue || 0));
    const occasionBenefits = {
      birthday: Boolean(this.planForm.value.birthdayBenefit),
      anniversary: Boolean(this.planForm.value.anniversaryBenefit),
      freeService: Boolean(this.planForm.value.birthdayBenefit || this.planForm.value.anniversaryBenefit)
    };
    return {
      ...baseRules,
      planType,
      prepaidCredit: planType === 'prepaid_credit',
      creditAmount: creditValue,
      creditUnit: this.planCreditUnit(planType),
      bonusAmount: planType === 'prepaid_credit' ? Math.max(0, creditValue - price || bonusAmount) : bonusAmount,
      benefitPercent: Number(this.planForm.value.benefitPercent || 0) || (price > 0 ? Math.round((Math.max(0, creditValue - price) / price) * 100) : 0),
      redemptionMode: planType === 'prepaid_credit' ? 'prepaid_credit' : this.planRedemptionMode(planType),
      allowProductRedeem: !!this.planForm.value.allowProductRedeem,
      perVisitLimit: {
        type: perVisitLimitType,
        value: perVisitLimitType === 'none' ? 0 : perVisitLimitValue
      },
      serviceRestriction: {
        type: serviceRestrictionType,
        value: serviceRestrictionType === 'all' ? '' : serviceRestrictionValue
      },
      fairUsage: {
        monthlyCap: this.isUnlimitedPlanForm() ? Math.max(1, Math.floor(Number(this.planForm.value.monthlyCap || 4))) : 0
      },
      family: {
        memberLimit: this.isFamilyPlanForm() ? Math.max(1, Math.floor(Number(this.planForm.value.familyMemberLimit || 1))) : 0,
        shareBenefits: Boolean(this.planForm.value.familyShareBenefits)
      },
      corporate: {
        label: String(this.planForm.value.corporateLabel || '').trim(),
        domain: String(this.planForm.value.corporateDomain || '').trim(),
        employeeIdRequired: Boolean(this.planForm.value.corporateEmployeeIdRequired)
      },
      tier: {
        name: String(this.planForm.value.tierName || '').trim(),
        spendThreshold: Math.max(0, Number(this.planForm.value.tierSpendThreshold || 0)),
        visitThreshold: Math.max(0, Number(this.planForm.value.tierVisitThreshold || 0))
      },
      occasionBenefits,
      priorityBooking: Boolean(this.planForm.value.priorityBooking)
    };
  }

  savePlan(): void {
    if (this.planForm.invalid) return;
    this.saving.set(true);
    this.error.set('');
    const advanced = this.advancedPlanJson();
    if (!advanced) {
      this.saving.set(false);
      return;
    }
    const includedServices = this.structuredIncludedServices(advanced.includedServices);
    const benefitRules = this.buildStructuredBenefitRules(advanced.benefitRules);
    const planType = String(this.planForm.value.planType || 'discount');
    const price = Number(this.planForm.value.price || 0);
    const payload = {
      code: this.planForm.value.code,
      name: this.planForm.value.name,
      description: this.planForm.value.description,
      price,
      discountPercent: this.planUsesCreditOnly(planType) ? 0 : Number(this.planForm.value.discountPercent || 0),
      productDiscountPercent: this.planUsesCreditOnly(planType) ? 0 : Number(this.planForm.value.productDiscountPercent || 0),
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
        this.showPlanDrawer.set(false);
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
    this.openPlanActionId.set('');
    this.showPlanDrawer.set(true);
    this.editingPlanId.set(plan.id);
    const planType = this.membershipPlanType(plan);
    const perVisitLimit = (plan.benefitRules?.['perVisitLimit'] || {}) as ApiRecord;
    const serviceRestriction = (plan.benefitRules?.['serviceRestriction'] || {}) as ApiRecord;
    const fairUsage = (plan.benefitRules?.['fairUsage'] || {}) as ApiRecord;
    const family = (plan.benefitRules?.['family'] || {}) as ApiRecord;
    const corporate = (plan.benefitRules?.['corporate'] || {}) as ApiRecord;
    const tier = (plan.benefitRules?.['tier'] || {}) as ApiRecord;
    const occasionBenefits = (plan.benefitRules?.['occasionBenefits'] || {}) as ApiRecord;
    this.planForm.patchValue({
      id: plan.id,
      version: plan.version || 1,
      planType,
      code: plan.code || '',
      name: plan.name,
      description: plan.description || '',
      price: plan.price,
      discountPercent: plan.discountPercent,
      productDiscountPercent: plan.productDiscountPercent || 0,
      creditAmount: plan.creditAmount || 0,
      creditUnit: String(plan.benefitRules?.['creditUnit'] || this.planCreditUnit(planType)),
      bonusAmount: plan.bonusAmount || 0,
      benefitPercent: plan.benefitPercent || 0,
      perVisitLimitType: String(perVisitLimit['type'] || plan.perVisitLimitType || 'none'),
      perVisitLimitValue: Number(perVisitLimit['value'] || plan.perVisitLimitValue || 0),
      serviceRestrictionType: String(serviceRestriction['type'] || plan.serviceRestrictionType || 'all'),
      serviceRestrictionValue: String(serviceRestriction['value'] || plan.serviceRestrictionValue || ''),
      includedServicesValue: this.includedServicesText(plan.includedServices || []),
      monthlyCap: Number(fairUsage['monthlyCap'] || 4),
      familyMemberLimit: Number(family['memberLimit'] || 4),
      familyShareBenefits: family['shareBenefits'] !== false,
      corporateLabel: String(corporate['label'] || ''),
      corporateDomain: String(corporate['domain'] || ''),
      corporateEmployeeIdRequired: corporate['employeeIdRequired'] !== false,
      tierName: String(tier['name'] || 'Gold'),
      tierSpendThreshold: Number(tier['spendThreshold'] || 50000),
      tierVisitThreshold: Number(tier['visitThreshold'] || 0),
      birthdayBenefit: Boolean(occasionBenefits['birthday']),
      anniversaryBenefit: Boolean(occasionBenefits['anniversary']),
      priorityBooking: Boolean(plan.benefitRules?.['priorityBooking']),
      allowProductRedeem: Boolean(plan.benefitRules?.['allowProductRedeem'] || plan.allowProductRedeem),
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
      planType: 'discount',
      code: '',
      name: 'Aura Gold 30%',
      description: 'Every bill discount plan',
      price: 2999,
      discountPercent: 30,
      productDiscountPercent: 0,
      creditAmount: 0,
      creditUnit: 'amount',
      bonusAmount: 0,
      benefitPercent: 0,
      perVisitLimitType: 'none',
      perVisitLimitValue: 0,
      serviceRestrictionType: 'all',
      serviceRestrictionValue: '',
      includedServicesValue: '',
      monthlyCap: 4,
      familyMemberLimit: 4,
      familyShareBenefits: true,
      corporateLabel: '',
      corporateDomain: '',
      corporateEmployeeIdRequired: true,
      tierName: 'Gold',
      tierSpendThreshold: 50000,
      tierVisitThreshold: 0,
      birthdayBenefit: false,
      anniversaryBenefit: false,
      priorityBooking: false,
      allowProductRedeem: false,
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
    const planCredits = this.membershipPlanCreditAmount(plan) || Number(value.planCredits || 0);
    const serviceCredits = this.planServiceCredits(plan, planCredits);
    this.api.post('membership-enterprise/sell', {
      ...value,
      staffName: staff ? this.staffName(staff.id) : '',
      price: plan?.price || 0,
      paidAmount: Number(value.paidAmount || plan?.price || 0),
      planCredits,
      planType: this.membershipPlanType(plan),
      serviceCredits
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
      this.error.set('Reason is required for â‚¹0 renewal.');
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
      this.error.set('Reason is required for â‚¹0 upgrade.');
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
    const initialValuePaise = Math.round(Number(value.initialValue || 0) * 100);
    this.api.create('giftCards', { ...value, balance: value.initialValue, initialValuePaise, balancePaise: initialValuePaise, redeemHistory: [] }).subscribe({
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

  selectGiftCard(card: ApiRecord): void {
    const id = String(card.id || card.code || '');
    if (!id) return;
    this.api.list<ApiRecord>(`visibility/gift-cards/${encodeURIComponent(id)}`, { limit: 100 }).subscribe({
      next: (detail) => this.selectedGiftCard.set(detail),
      error: (error) => this.error.set(this.api.errorText(error, 'Unable to load gift card history'))
    });
  }

  giftCardTransactions(): ApiRecord[] {
    return (this.selectedGiftCard()?.['transactions'] as ApiRecord[]) || [];
  }

  giftCardBalance(card: ApiRecord | null | undefined): number {
    if (!card) return 0;
    return card['balancePaise'] !== undefined && (Number(card['balancePaise']) !== 0 || card['originalSystem']) ? Number(card['balancePaise']) / 100 : Number(card['balance'] || 0);
  }

  giftCardInitialValue(card: ApiRecord | null | undefined): number {
    if (!card) return 0;
    return card['initialValuePaise'] !== undefined && (Number(card['initialValuePaise']) !== 0 || card['originalSystem']) ? Number(card['initialValuePaise']) / 100 : Number(card['initialValue'] || card['initial_value'] || 0);
  }

  giftCardTransactionAmount(transaction: ApiRecord): number {
    return transaction['amountPaise'] !== undefined && (Number(transaction['amountPaise']) !== 0 || transaction['originalSystem']) ? Number(transaction['amountPaise']) / 100 : Number(transaction['amount'] || 0);
  }

  giftCardTransactionBalance(transaction: ApiRecord): number {
    return transaction['balanceAfterPaise'] !== undefined && (Number(transaction['balanceAfterPaise']) !== 0 || transaction['originalSystem']) ? Number(transaction['balanceAfterPaise']) / 100 : Number(transaction['balanceAfter'] || 0);
  }

  activeMembershipPlans(): PosMembershipPlan[] {
    return this.membershipPlans().filter((plan) => plan.active && plan.status !== 'inactive');
  }

  activeMemberships(): ApiRecord[] {
    const today = new Date().toISOString().slice(0, 10);
    return this.memberships().filter((membership) => this.isActiveMembershipRecord(membership, today));
  }

  isActiveMembershipRecord(membership: ApiRecord, today = new Date().toISOString().slice(0, 10)): boolean {
    const status = String(membership['status'] || '').toLowerCase();
    const validityDate = String(membership['validityDate'] || membership['validity_date'] || '');
    return status === 'active' && (!validityDate || validityDate >= today);
  }

  isRenewalRiskMembership(membership: ApiRecord): boolean {
    const status = String(membership['status'] || '').toLowerCase();
    if (status.includes('cancel')) return false;
    const validityDate = String(membership['validityDate'] || membership['validity_date'] || '');
    if (!validityDate) return false;
    return this.membershipDaysLeft(membership) <= 30;
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
    return parts.join(' Â· ') || 'No active benefits';
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
    return role ? `${name} Â· ${role}` : name;
  }

  branchOptions(): string[] {
    const branchIds = [
      ...this.memberships().map((membership) => membership.branchId),
      ...this.ledger().map((row) => row.branchId),
      ...this.autoRenewQueue().map((row) => row.branchId),
      ...this.rewardLedgerRows().map((row) => row['branchId']),
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

  searchAuditLedger(): void {
    this.auditLedgerSearch = this.auditLedgerSearchDraft.trim();
    this.loadAuditLedger();
  }

  clearAuditLedgerSearch(): void {
    this.auditLedgerSearch = '';
    this.auditLedgerSearchDraft = '';
    this.loadAuditLedger();
  }

  loadAuditLedger(): void {
    this.saving.set(true);
    this.error.set('');
    this.api.list<ApiRecord[]>('membership-enterprise/ledger', this.auditLedgerParams()).pipe(
      catchError((error) => {
        this.error.set(error?.error?.error || error?.message || 'Unable to search membership audit ledger');
        return of([] as ApiRecord[]);
      })
    ).subscribe((rows) => {
      this.ledger.set(rows || []);
      this.saving.set(false);
    });
  }

  rewardMetric(key: string): number {
    return Number(((this.rewardReport().roi as ApiRecord | undefined)?.['metrics'] as ApiRecord | undefined)?.[key] || 0);
  }

  reportFilterParams(): ApiRecord {
    return {
      fromDate: this.reportFilters.fromDate || '',
      toDate: this.reportFilters.toDate || '',
      branchId: this.reportFilters.branchId || '',
      planId: this.reportFilters.planId || '',
      planType: this.reportFilters.planType || '',
      staffId: this.reportFilters.staffId || '',
      clientId: this.reportFilters.clientId || '',
      clientSearch: this.reportFilters.clientSearch || '',
      status: this.reportFilters.status || '',
      saleType: this.reportFilters.saleType || '',
      redeemStatus: this.reportFilters.redeemStatus || '',
      walletBalance: this.reportFilters.walletBalance || '',
      paymentMode: this.reportFilters.paymentMode || '',
      riskLevel: this.reportFilters.riskLevel === 'all' ? '' : this.reportFilters.riskLevel
    };
  }

  private auditLedgerParams(): ApiRecord {
    return {
      limit: 200,
      search: this.auditLedgerSearch || ''
    };
  }

  rewardFilterParams(): ApiRecord {
    return {
      fromDate: this.rewardFilters.fromDate || '',
      toDate: this.rewardFilters.toDate || '',
      clientId: this.rewardFilters.clientId || '',
      transactionType: this.rewardFilters.transactionType || '',
      staffId: this.rewardFilters.staffId || '',
      branchId: this.rewardFilters.branchId || '',
      riskLevel: this.rewardFilters.riskLevel === 'all' ? '' : this.rewardFilters.riskLevel,
      rewardStatus: this.rewardFilters.rewardStatus || ''
    };
  }

  onReportFilterChanged(): void {
    if (this.activeTab() === 'reports') this.loadEnterpriseReports({ silent: true });
  }

  startReportLiveRefresh(): void {
    if (this.reportRefreshTimer) return;
    this.reportRefreshTimer = setInterval(() => {
      if (this.activeTab() === 'reports') this.loadEnterpriseReports({ silent: true });
    }, 30000);
  }

  stopReportLiveRefresh(): void {
    if (!this.reportRefreshTimer) return;
    clearInterval(this.reportRefreshTimer);
    this.reportRefreshTimer = null;
  }

  loadEnterpriseReports(options: { silent?: boolean } = {}): void {
    if (this.enterpriseReportLoading) {
      this.enterpriseReportRefreshQueued = true;
      return;
    }
    this.enterpriseReportLoading = true;
    if (!options.silent) this.saving.set(true);
    this.error.set('');
    this.api.list<MembershipEnterpriseReport>('membership-enterprise/reports/enterprise', this.reportFilterParams()).pipe(
      catchError((error) => {
        this.error.set(error?.error?.error || error?.message || 'Unable to load membership reports');
        return of({} as MembershipEnterpriseReport);
      })
    ).subscribe((report) => {
      this.enterpriseReport.set(report || {});
      this.enterpriseReportLoading = false;
      if (!options.silent) this.saving.set(false);
      if (report?.generatedAt && !options.silent) this.message.set('Membership reports refreshed.');
      if (this.enterpriseReportRefreshQueued) {
        this.enterpriseReportRefreshQueued = false;
        this.loadEnterpriseReports({ silent: true });
      }
    });
  }

  loadRewards(options: { silent?: boolean } = {}): void {
    if (!options.silent) this.saving.set(true);
    this.error.set('');
    forkJoin({
      ledger: this.safeList<ApiRecord[]>('membership-enterprise/rewards/ledger', this.rewardFilterParams()),
      roi: this.safeList<ApiRecord>('membership-enterprise/rewards/roi', this.rewardFilterParams()),
      expiring: this.safeList<ApiRecord[]>('membership-enterprise/rewards/expiring', this.rewardFilterParams()),
      abuseAlerts: this.safeList<ApiRecord[]>('membership-enterprise/rewards/abuse-alerts', this.rewardFilterParams())
    }).subscribe({
      next: (report) => {
        this.rewardReport.set(report);
        this.saving.set(false);
      },
      error: (error) => {
        this.error.set(error?.error?.error || error?.message || 'Unable to load rewards report');
        this.saving.set(false);
      }
    });
  }

  sendRewardExpiryReminder(row: ApiRecord): void {
    const clientId = String(row['clientId'] || '');
    if (!clientId) return;
    this.saving.set(true);
    this.api.post<ApiRecord>(`membership-enterprise/rewards/${clientId}/send-expiry-reminder`, {
      points: row['pointsExpiring'] || 0,
      expiryDate: row['expiryDate'] || '',
      channel: 'whatsapp'
    }).subscribe({
      next: () => {
        this.message.set('Reward expiry WhatsApp reminder queued.');
        this.saving.set(false);
        this.loadRewards({ silent: true });
      },
      error: (error) => {
        this.error.set(error?.error?.error || 'Unable to queue reward reminder');
        this.saving.set(false);
      }
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
      `Membership sales by customer: ${metrics['membershipSalesTotalCount'] || 0}`,
      `Membership sales offer price: Rs ${metrics['membershipSalesOfferPrice'] || 0}`,
      ...rows.map((row) => `${row['report']}: ${row['primary'] || row['clientName'] || row['planName'] || row['staffName'] || ''} ${row['amount'] || row['value'] || ''}`)
    ];
    this.downloadFile(`membership-enterprise-reports-${this.exportDateKey()}.pdf`, this.simplePdf(lines), 'application/pdf');
  }

  exportRewardsLedgerCsv(): void {
    const rows = this.rewardLedgerRows();
    const headers = rows.length ? Object.keys(rows[0]) : ['date', 'clientName', 'transactionType', 'balanceAfter'];
    const bodyRows = rows.length ? rows : [{ date: '', clientName: 'No reward rows', transactionType: '', balanceAfter: 0 }];
    const csv = [
      headers.join(','),
      ...bodyRows.map((row) => headers.map((header) => this.csvCell(row[header])).join(','))
    ].join('\n');
    this.downloadFile(`rewards-ledger-${this.exportDateKey()}.csv`, csv, 'text/csv;charset=utf-8');
  }

  exportRewardsRoiPdf(): void {
    const metrics = ((this.rewardReport().roi as ApiRecord | undefined)?.['metrics'] as ApiRecord | undefined) || {};
    const lines = [
      'AuraShine Rewards ROI',
      `Generated: ${new Date().toISOString()}`,
      `Reward clients: ${metrics['totalRewardClients'] || 0}`,
      `Points earned: ${metrics['totalPointsEarned'] || 0}`,
      `Points redeemed: ${metrics['totalPointsRedeemed'] || 0}`,
      `Reward revenue: Rs ${metrics['revenueFromRewardUsers'] || 0}`,
      `Repeat revenue: Rs ${metrics['repeatRevenueFromRewardUsers'] || 0}`,
      `Repeat visit rate: ${metrics['repeatVisitRate'] || 0}%`,
      ...this.rewardRoiRows().slice(0, 45).map((row) => `${row['clientName'] || row['clientId']}: sale Rs ${row['totalSale'] || 0}, balance ${row['pendingRewardBalance'] || 0}`)
    ];
    this.downloadFile(`rewards-roi-${this.exportDateKey()}.pdf`, this.simplePdf(lines), 'application/pdf');
  }

  exportRewardAbusePdf(): void {
    const lines = [
      'AuraShine Reward Abuse Audit',
      `Generated: ${new Date().toISOString()}`,
      `Alerts: ${this.rewardAbuseRows().length}`,
      ...this.rewardAbuseRows().slice(0, 60).map((row) => `${row['riskLevel']}: ${row['alertType']} - ${row['client'] || row['clientId']} ${row['invoiceReference'] || ''}`)
    ];
    this.downloadFile(`rewards-abuse-audit-${this.exportDateKey()}.pdf`, this.simplePdf(lines), 'application/pdf');
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
    const plan = active?.['planName'] ? ` Â· ${active['planName']}` : ' Â· No active benefits';
    const credits = active ? ` Â· ${Number(active['creditsRemaining'] || 0)} cr` : '';
    return `${client.name || client.fullName || client.id} Â· ${client.phone || client.email || client.id} Â· Wallet â‚¹${walletBalance}${plan}${credits}`;
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
    const ref = payment?.['referenceNo'] ? ` Â· ${payment['referenceNo']}` : '';
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

  togglePlanAction(plan: PosMembershipPlan, event: Event): void {
    event.stopPropagation();
    this.openPlanActionId.set(this.openPlanActionId() === plan.id ? '' : plan.id);
  }

  markPlanInactive(plan: PosMembershipPlan): void {
    this.openPlanActionId.set('');
    this.api.patch<PosMembershipPlan>(`membership-enterprise/plans/${plan.id}`, {
      ...plan,
      status: 'inactive',
      active: false
    }).subscribe({
      next: () => {
        this.message.set(`${plan.name} inactive ho gaya.`);
        this.load();
      },
      error: (error) => this.error.set(error?.error?.error || error?.message || 'Unable to update plan status')
    });
  }

  planInitial(plan: PosMembershipPlan): string {
    return String(plan.name || 'P').trim().charAt(0).toUpperCase() || 'P';
  }

  planSoldCount(plan: PosMembershipPlan): number {
    return this.memberships().filter((membership) => {
      const planId = String(membership['planId'] || membership['membershipPlanId'] || membership['plan_id'] || '');
      const planName = String(membership['planName'] || membership['name'] || '').toLowerCase();
      return planId === plan.id || (!!planName && planName === String(plan.name || '').toLowerCase());
    }).length;
  }

  packageRecordId(item: ApiRecord | null | undefined): string {
    return String(item?.id || item?.['packageId'] || '');
  }

  packageName(item: ApiRecord): string {
    return String(item['name'] || item['packageName'] || 'Package');
  }

  packageInitial(item: ApiRecord): string {
    return this.packageName(item).trim().charAt(0).toUpperCase() || 'P';
  }

  packagePrice(item: ApiRecord): number {
    return this.numberValue(item['price'] ?? item['sellingPrice'] ?? item['specialPrice'] ?? 0);
  }

  packageStatus(item: ApiRecord): string {
    return String(item['status'] || 'Active');
  }

  packageRuleText(item: ApiRecord): string {
    const rules = this.packageObject(item['rules']);
    const firstCredit = this.packageServiceCredits(item)[0] || {};
    const paid = this.numberValue(rules['paidSessions'] ?? firstCredit['paidSessions'] ?? 0);
    const free = this.numberValue(rules['freeSessions'] ?? firstCredit['freeSessions'] ?? 0);
    const serviceName = String(rules['serviceName'] || firstCredit['serviceName'] || 'service');
    const total = paid + free || this.packageTotalCredits(item);
    return total ? `${serviceName}: pay ${paid || total}, get ${total}` : `${serviceName}: ${this.packageTotalCredits(item)} credit(s)`;
  }

  packageTotalCredits(item: ApiRecord): number {
    const credits = this.packageServiceCredits(item);
    if (credits.length) return credits.reduce((sum, credit) => sum + this.numberValue(credit['credits'] ?? credit['quantity'] ?? credit['total'] ?? 0), 0);
    const rules = this.packageObject(item['rules']);
    return this.numberValue(rules['totalSessions'] || rules['credits'] || 0);
  }

  packageSoldCount(item: ApiRecord): number {
    return this.packageMembers(item).length;
  }

  selectPackage(item: ApiRecord): void {
    this.selectedPackageId.set(this.packageRecordId(item));
  }

  selectedPackage(): ApiRecord | null {
    const selectedId = this.selectedPackageId();
    return this.packageRecords().find((item) => this.packageRecordId(item) === selectedId) || this.packageRecords()[0] || null;
  }

  packageMembers(item: ApiRecord): ApiRecord[] {
    return this.memberships().filter((membership) => this.isPackageMembership(membership) && this.packageMatchesMembership(item, membership));
  }

  private packageMatchesMembership(item: ApiRecord, membership: ApiRecord): boolean {
    const packageId = this.packageRecordId(item);
    const packageName = this.packageName(item).toLowerCase();
    const memberName = String(membership['planName'] || membership['name'] || '').replace(/^Package:\s*/i, '').trim().toLowerCase();
    if (String(membership['packageId'] || membership['package_id'] || '') === packageId) return true;
    if (memberName && memberName === packageName) return true;
    return this.packageServiceCredits(membership).some((credit) => String(credit['packageId'] || '') === packageId);
  }

  private isPackageMembership(membership: ApiRecord): boolean {
    const planName = String(membership['planName'] || membership['name'] || '').trim().toLowerCase();
    if (planName.startsWith('package:')) return true;
    return this.packageServiceCredits(membership).some((credit) => credit['packageId'] || credit['serviceId']);
  }

  private packageServiceCredits(item: ApiRecord): ApiRecord[] {
    return [
      ...this.packageReadList(item['serviceCredits'] || item['service_credits']),
      ...this.packageReadList(item['packageCredits'] || item['package_credits'])
    ];
  }

  private packageReadList(value: unknown): ApiRecord[] {
    if (Array.isArray(value)) return value.filter((item): item is ApiRecord => !!item && typeof item === 'object' && !Array.isArray(item));
    if (typeof value !== 'string') return [];
    try {
      const parsed = JSON.parse(value || '[]');
      return Array.isArray(parsed) ? parsed.filter((item): item is ApiRecord => !!item && typeof item === 'object' && !Array.isArray(item)) : [];
    } catch {
      return [];
    }
  }

  private packageObject(value: unknown): ApiRecord {
    if (value && typeof value === 'object' && !Array.isArray(value)) return value as ApiRecord;
    if (typeof value !== 'string') return {};
    try {
      const parsed = JSON.parse(value || '{}');
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as ApiRecord : {};
    } catch {
      return {};
    }
  }

  numberValue(value: unknown): number {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  isPrepaidPlanForm(): boolean {
    return String(this.planForm.value.planType || 'discount') === 'prepaid_credit';
  }

  isServiceCreditPlanForm(): boolean {
    return ['visit_pack', 'service_credit', 'combo'].includes(String(this.planForm.value.planType || 'discount'));
  }

  isUnlimitedPlanForm(): boolean {
    return String(this.planForm.value.planType || 'discount') === 'unlimited';
  }

  isFamilyPlanForm(): boolean {
    return String(this.planForm.value.planType || 'discount') === 'family';
  }

  isCorporatePlanForm(): boolean {
    return String(this.planForm.value.planType || 'discount') === 'corporate';
  }

  isTieredPlanForm(): boolean {
    return String(this.planForm.value.planType || 'discount') === 'tiered';
  }

  usesDiscountFields(): boolean {
    return !['prepaid_credit', 'visit_pack', 'service_credit', 'combo', 'unlimited'].includes(String(this.planForm.value.planType || 'discount'));
  }

  private planUsesCreditOnly(planType: string): boolean {
    return ['prepaid_credit', 'visit_pack', 'service_credit', 'combo', 'unlimited'].includes(planType);
  }

  private planCreditUnit(planType: string): string {
    if (planType === 'prepaid_credit') return 'amount';
    if (planType === 'visit_pack') return 'visit';
    if (planType === 'unlimited') return 'unlimited';
    return 'service';
  }

  private planRedemptionMode(planType: string): string {
    if (planType === 'visit_pack') return 'visit_credit';
    if (planType === 'unlimited') return 'unlimited_fair_usage';
    if (planType === 'service_credit' || planType === 'combo') return 'service_credit';
    return 'discount';
  }

  private parseServiceList(value: unknown): string[] {
    return String(value || '')
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
  }

  private includedServicesText(value: unknown[]): string {
    return (value || [])
      .map((item: unknown) => String((item as ApiRecord)?.['serviceName'] || (item as ApiRecord)?.['serviceId'] || item || '').trim())
      .filter(Boolean)
      .join(', ');
  }

  applyPrepaidPreset(price: number, bonusAmount: number, validityDays: number): void {
    this.planForm.patchValue({
      planType: 'prepaid_credit',
      creditUnit: 'amount',
      price,
      bonusAmount,
      creditAmount: price + bonusAmount,
      benefitPercent: price > 0 ? Math.round((bonusAmount / price) * 100) : 0,
      discountPercent: 0,
      productDiscountPercent: 0,
      validityDays
    });
  }

  prepaidPlanCreditPreview(): string {
    const price = Number(this.planForm.value.price || 0);
    const creditAmount = Number(this.planForm.value.creditAmount || 0) || price + Number(this.planForm.value.bonusAmount || 0);
    return `Client pays ${this.moneyLabel(price)} and gets ${this.moneyLabel(creditAmount)} service credit.`;
  }

  prepaidPlanRulePreview(): string {
    const limitType = String(this.planForm.value.perVisitLimitType || 'none');
    const limitValue = Number(this.planForm.value.perVisitLimitValue || 0);
    const restrictionType = String(this.planForm.value.serviceRestrictionType || 'all');
    const limit = limitType === 'fixed'
      ? `Per visit max ${this.moneyLabel(limitValue)}`
      : limitType === 'bill_percent'
        ? `Per visit max ${limitValue}% of eligible bill`
        : 'No per visit cap';
    const restriction = restrictionType === 'all'
      ? 'all services'
      : `${restrictionType.replace('_', ' ')}: ${this.planForm.value.serviceRestrictionValue || '-'}`;
    return `${limit} Â· applies on ${restriction}${this.planForm.value.allowProductRedeem ? ' Â· products allowed' : ''}.`;
  }

  structuredPlanPreview(): string {
    const planType = String(this.planForm.value.planType || 'discount');
    const credits = Math.max(0, Number(this.planForm.value.creditAmount || 0));
    if (planType === 'visit_pack') return `${credits || 10} visits`;
    if (planType === 'service_credit') return `${credits || 3} service credits`;
    if (planType === 'combo') return `${credits || 3} combo service credits`;
    if (planType === 'unlimited') return `Unlimited services, ${Number(this.planForm.value.monthlyCap || 4)} / month`;
    if (planType === 'family') return `Family plan ${Number(this.planForm.value.familyMemberLimit || 4)} members`;
    if (planType === 'corporate') return `Corporate ${this.planForm.value.corporateLabel || 'company'} ${Number(this.planForm.value.discountPercent || 0)}%`;
    if (planType === 'tiered') return `Tier ${this.planForm.value.tierName || 'Gold'} after ${this.moneyLabel(Number(this.planForm.value.tierSpendThreshold || 0))}`;
    return `${Number(this.planForm.value.discountPercent || 0)}% service discount`;
  }

  structuredPlanRulePreview(): string {
    const services = this.planForm.value.includedServicesValue ? `Services: ${this.planForm.value.includedServicesValue}` : 'All eligible services';
    const occasion = [this.planForm.value.birthdayBenefit ? 'birthday' : '', this.planForm.value.anniversaryBenefit ? 'anniversary' : ''].filter(Boolean).join(' + ');
    const priority = this.planForm.value.priorityBooking ? 'priority booking' : '';
    return [services, occasion ? `Occasion: ${occasion}` : '', priority].filter(Boolean).join(' Â· ') || 'Standard membership rules';
  }

  planSummary(plan: PosMembershipPlan): string {
    const planType = this.membershipPlanType(plan);
    const rules = plan.benefitRules || {};
    if (planType === 'prepaid_credit') {
      return `Pay ${this.moneyLabel(plan.price)} Â· Get ${this.moneyLabel(this.membershipPlanCreditAmount(plan))} credit Â· ${plan.benefitPercent || 0}% bonus`;
    }
    if (planType === 'visit_pack') return `${this.membershipPlanCreditAmount(plan)} visits Â· ${plan.validityDays} days`;
    if (planType === 'service_credit' || planType === 'combo') return `${this.membershipPlanCreditAmount(plan)} ${planType === 'combo' ? 'combo' : 'service'} credits Â· ${this.includedServicesText(plan.includedServices || []) || 'selected services'}`;
    if (planType === 'unlimited') return `Unlimited Â· ${Number(((rules['fairUsage'] || {}) as ApiRecord)['monthlyCap'] || 4)} / month`;
    if (planType === 'family') return `Family ${Number(((rules['family'] || {}) as ApiRecord)['memberLimit'] || 4)} members`;
    if (planType === 'corporate') return `Corporate ${String(((rules['corporate'] || {}) as ApiRecord)['label'] || plan.name)} Â· ${plan.discountPercent}%`;
    if (planType === 'tiered') return `Tier ${String(((rules['tier'] || {}) as ApiRecord)['name'] || plan.name)} after ${this.moneyLabel(Number(((rules['tier'] || {}) as ApiRecord)['spendThreshold'] || 0))}`;
    return `${this.moneyLabel(plan.price)} Â· ${plan.discountPercent}% service Â· ${plan.productDiscountPercent || 0}% product`;
  }

  private membershipPlanType(plan: PosMembershipPlan | null | undefined): string {
    const rules = plan?.benefitRules || {};
    return String(plan?.planType || rules['planType'] || (rules['prepaidCredit'] ? 'prepaid_credit' : 'discount'));
  }

  private membershipPlanCreditAmount(plan: PosMembershipPlan | null | undefined): number {
    const rules = plan?.benefitRules || {};
    const planType = this.membershipPlanType(plan);
    if (planType === 'unlimited') return Math.max(1, Number(((rules['fairUsage'] || {}) as ApiRecord)['monthlyCap'] || 4));
    return Math.max(0, Number(plan?.creditAmount || rules['creditAmount'] || rules['credits'] || 0));
  }

  private membershipPlanBonusAmount(plan: PosMembershipPlan | null | undefined): number {
    const rules = plan?.benefitRules || {};
    return Math.max(0, Number(plan?.bonusAmount || rules['bonusAmount'] || Math.max(0, this.membershipPlanCreditAmount(plan) - Number(plan?.price || 0))));
  }

  private planServiceCredits(plan: PosMembershipPlan | undefined, planCredits: number): ApiRecord[] | undefined {
    if (!plan) return undefined;
    const planType = this.membershipPlanType(plan);
    const rules = plan.benefitRules || {};
    if (planType === 'prepaid_credit') {
      return [{ type: 'prepaid_credit', credits: planCredits, remaining: planCredits, planId: plan.id || '', bonusAmount: this.membershipPlanBonusAmount(plan), benefitPercent: plan.benefitPercent || 0, benefitRules: rules }];
    }
    if (planType === 'visit_pack' || planType === 'service_credit' || planType === 'combo') {
      const included = Array.isArray(plan.includedServices) && plan.includedServices.length ? plan.includedServices : this.parseServiceList(plan.serviceRestrictionValue || '').map((name) => ({ serviceId: name, serviceName: name }));
      if (!included.length) return [{ type: planType, credits: planCredits, remaining: planCredits, planId: plan.id || '', benefitRules: rules }];
      return included.map((item: unknown) => ({
        type: planType,
        serviceId: String((item as ApiRecord)?.['serviceId'] || ''),
        serviceName: String((item as ApiRecord)?.['serviceName'] || (item as ApiRecord)?.['name'] || (item as ApiRecord)?.['serviceId'] || 'Service credit'),
        credits: Number((item as ApiRecord)?.['credits'] || planCredits || 1),
        remaining: Number((item as ApiRecord)?.['credits'] || planCredits || 1),
        planId: plan.id || '',
        benefitRules: rules
      }));
    }
    if (planType === 'unlimited') {
      return [{ type: 'unlimited_service', credits: planCredits, remaining: planCredits, planId: plan.id || '', fairUsage: rules['fairUsage'] || {}, benefitRules: rules }];
    }
    return undefined;
  }

  private moneyLabel(value: number): string {
    return `â‚¹${Math.round(Number(value || 0)).toLocaleString('en-IN')}`;
  }

  private normalizePlan(plan: PosMembershipPlan): PosMembershipPlan {
    const benefitRules = plan.benefitRules || {};
    const planType = String(plan.planType || benefitRules['planType'] || (benefitRules['prepaidCredit'] ? 'prepaid_credit' : 'discount'));
    const price = Number(plan.price || 0);
    const creditAmount = Math.max(0, Number(plan.creditAmount || benefitRules['creditAmount'] || 0));
    const bonusAmount = Math.max(0, Number(plan.bonusAmount || benefitRules['bonusAmount'] || Math.max(0, creditAmount - price)));
    const perVisitLimit = (benefitRules['perVisitLimit'] || {}) as ApiRecord;
    const serviceRestriction = (benefitRules['serviceRestriction'] || {}) as ApiRecord;
    return {
      ...plan,
      price,
      discountPercent: Number(plan.discountPercent || 0),
      productDiscountPercent: Number(plan.productDiscountPercent || 0),
      planType,
      creditAmount,
      creditUnit: String(benefitRules['creditUnit'] || this.planCreditUnit(planType)),
      bonusAmount,
      benefitPercent: Number(plan.benefitPercent || benefitRules['benefitPercent'] || (price > 0 ? Math.round((bonusAmount / price) * 100) : 0)),
      perVisitLimitType: String(plan.perVisitLimitType || perVisitLimit['type'] || 'none'),
      perVisitLimitValue: Number(plan.perVisitLimitValue || perVisitLimit['value'] || 0),
      serviceRestrictionType: String(plan.serviceRestrictionType || serviceRestriction['type'] || 'all'),
      serviceRestrictionValue: String(plan.serviceRestrictionValue || serviceRestriction['value'] || ''),
      allowProductRedeem: Boolean(plan.allowProductRedeem || benefitRules['allowProductRedeem']),
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
