import { CommonModule } from '@angular/common';
import { Component, OnInit, signal } from '@angular/core';
import { ReactiveFormsModule, UntypedFormBuilder } from '@angular/forms';
import { forkJoin } from 'rxjs';
import { ApiRecord, ApiService } from '../core/api.service';
import { StateComponent } from '../shared/ui/state/state.component';
import { AuraMoneyPipe } from '../shared/pipes/aura-money.pipe';

@Component({
  selector: 'app-profit-intelligence',
  standalone: true,
  imports: [AuraMoneyPipe, CommonModule, ReactiveFormsModule, StateComponent],
  template: `
    <section class="profit-workspace">
      <section class="page-title">
        <div>
          <h1>Profit Intelligence</h1>
        </div>
        <form [formGroup]="filters" (ngSubmit)="load()">
          <label><span>From</span><input type="date" formControlName="from" /></label>
          <label><span>To</span><input type="date" formControlName="to" /></label>
          <button class="primary-button" type="submit">Refresh</button>
        </form>
      </section>

      <app-state [loading]="loading()" [error]="error()"></app-state>

      <section class="metrics-grid" *ngIf="summary()?.metrics as metrics">
        <article>
          <span>Revenue</span>
          <strong>{{ paise(metrics.revenuePaise) | auraMoney:'1.0-0' }}</strong>
        </article>
        <article>
          <span>Product Cost</span>
          <strong>{{ paise(metrics.productCostPaise) | auraMoney:'1.0-0' }}</strong>
        </article>
        <article>
          <span>Gross Profit</span>
          <strong>{{ paise(metrics.grossProfitPaise) | auraMoney:'1.0-0' }}</strong>
          <small>{{ percent(metrics.grossMarginBps) }} gross margin</small>
        </article>
        <article>
          <span>Staff Cost</span>
          <strong>{{ paise(metrics.staffCostPaise) | auraMoney:'1.0-0' }}</strong>
        </article>
        <article>
          <span>Operating Expenses</span>
          <strong>{{ paise(metrics.operatingExpensePaise) | auraMoney:'1.0-0' }}</strong>
        </article>
        <article class="net-card">
          <span>Net Profit</span>
          <strong>{{ paise(metrics.netProfitPaise) | auraMoney:'1.0-0' }}</strong>
          <small>{{ percent(metrics.netMarginBps) }} net margin</small>
        </article>
      </section>

      <section class="ceo-grid" *ngIf="summary()?.ceoKpis as kpis">
        <article>
          <span>Today's Revenue</span>
          <strong>{{ paise(kpis.todayRevenuePaise) | auraMoney:'1.0-0' }}</strong>
        </article>
        <article>
          <span>Today's Profit</span>
          <strong>{{ paise(kpis.todayProfitPaise) | auraMoney:'1.0-0' }}</strong>
        </article>
        <article>
          <span>This Month Profit</span>
          <strong>{{ paise(kpis.monthProfitPaise) | auraMoney:'1.0-0' }}</strong>
        </article>
        <article>
          <span>Gross / Net Margin</span>
          <strong>{{ percent(kpis.grossMarginBps) }} / {{ percent(kpis.netMarginBps) }}</strong>
        </article>
        <article>
          <span>Top Service</span>
          <strong>{{ kpis.topService?.label }}</strong>
          <small>{{ paise(kpis.topService?.amountPaise) | auraMoney:'1.0-0' }} profit</small>
        </article>
        <article>
          <span>Top Staff</span>
          <strong>{{ kpis.topStaff?.label }}</strong>
          <small>{{ paise(kpis.topStaff?.amountPaise) | auraMoney:'1.0-0' }} profit</small>
        </article>
        <article>
          <span>Top Branch</span>
          <strong>{{ kpis.topBranch?.label }}</strong>
          <small>{{ paise(kpis.topBranch?.amountPaise) | auraMoney:'1.0-0' }} profit</small>
        </article>
        <article>
          <span>Top Customer</span>
          <strong>{{ kpis.topCustomer?.label }}</strong>
          <small>{{ paise(kpis.topCustomer?.amountPaise) | auraMoney:'1.0-0' }} profit</small>
        </article>
        <article>
          <span>Highest Expense</span>
          <strong>{{ kpis.highestExpense?.label }}</strong>
          <small>{{ paise(kpis.highestExpense?.amountPaise) | auraMoney:'1.0-0' }}</small>
        </article>
        <article>
          <span>Revenue / Employee</span>
          <strong>{{ paise(kpis.revenuePerEmployeePaise) | auraMoney:'1.0-0' }}</strong>
          <small>{{ kpis.employeeCount || 0 }} active staff</small>
        </article>
        <article>
          <span>Revenue / Chair</span>
          <strong>{{ paise(kpis.revenuePerChairPaise) | auraMoney:'1.0-0' }}</strong>
          <small>{{ kpis.chairCount || 0 }} active chairs</small>
        </article>
        <article>
          <span>Revenue / Hour</span>
          <strong>{{ paise(kpis.revenuePerHourPaise) | auraMoney:'1.0-0' }}</strong>
          <small>{{ kpis.businessHours || 0 }} business hours</small>
        </article>
      </section>

      <section class="digital-twin-grid" *ngIf="summary()?.profitDigitalTwin as twin">
        <article class="panel twin-panel">
          <header>
            <div>
              <h2>What-if simulation</h2>
            </div>
            <span>{{ twin.name }}</span>
          </header>
          <form class="scenario-form" [formGroup]="filters" (ngSubmit)="load()">
            <label><span>Price %</span><input type="number" formControlName="scenarioPriceChangePct" /></label>
            <label><span>Revenue %</span><input type="number" formControlName="scenarioRevenueChangePct" /></label>
            <label><span>Commission %</span><input type="number" formControlName="scenarioCommissionChangePct" /></label>
            <label><span>Wastage Cut %</span><input type="number" formControlName="scenarioWastageReductionPct" min="0" max="80" /></label>
            <label><span>Expense %</span><input type="number" formControlName="scenarioExpenseChangePct" /></label>
            <label><span>Rent Change</span><input type="number" formControlName="scenarioRentChangeRupees" /></label>
            <button class="primary-button" type="submit">Run Simulation</button>
          </form>
        </article>

        <article class="panel twin-result">
          <header>
            <div>
              <h2>Profit impact</h2>
            </div>
            <span>{{ percent(twin.netMarginBps) }} net margin</span>
          </header>
          <div class="twin-metrics">
            <div><span>Base Revenue</span><strong>{{ paise(twin.baseRevenuePaise) | auraMoney:'1.0-0' }}</strong></div>
            <div><span>Sim Revenue</span><strong>{{ paise(twin.simulatedRevenuePaise) | auraMoney:'1.0-0' }}</strong></div>
            <div><span>Base Profit</span><strong>{{ paise(twin.baseNetProfitPaise) | auraMoney:'1.0-0' }}</strong></div>
            <div><span>Sim Profit</span><strong>{{ paise(twin.simulatedNetProfitPaise) | auraMoney:'1.0-0' }}</strong></div>
            <div class="delta"><span>Profit Delta</span><strong>{{ paise(twin.profitDeltaPaise) | auraMoney:'1.0-0' }}</strong></div>
            <div><span>Gross Margin</span><strong>{{ percent(twin.grossMarginBps) }}</strong></div>
          </div>
        </article>

        <article class="panel">
          <header>
            <div>
              <h2>{{ twin.recommendedScenario?.name }}</h2>
            </div>
          </header>
          <div class="rank-list">
            <div>
              <span>Expected profit</span>
              <strong>{{ paise(twin.recommendedScenario?.simulatedNetProfitPaise) | auraMoney:'1.0-0' }}</strong>
            </div>
            <div>
              <span>Profit lift</span>
              <strong>{{ paise(twin.recommendedScenario?.profitDeltaPaise) | auraMoney:'1.0-0' }}</strong>
            </div>
          </div>
        </article>
      </section>

      <section class="booking-grid" *ngIf="bookingRecommendations() as booking">
        <article class="table-panel booking-panel">
          <header>
            <div>
              <h2>Profit ranked slots</h2>
            </div>
            <span>{{ booking.sourceHealth?.appointments || 0 }} appointment signals</span>
          </header>
          <div class="table-wrap">
            <table>
              <thead><tr><th>Service</th><th>Best Slot</th><th>Revenue</th><th>Cost</th><th>Profit</th><th>Margin</th><th>Peak</th><th>Action</th></tr></thead>
              <tbody>
                <tr *ngFor="let row of booking.recommendations || []">
                  <td><strong>{{ row.serviceName }}</strong><span>{{ row.restrictionReason || 'Prime slot candidate' }}</span></td>
                  <td>{{ slotLabel(row.slot) }}</td>
                  <td>{{ paise(row.expectedRevenuePaise) | auraMoney:'1.0-0' }}</td>
                  <td>{{ paise(row.expectedCostPaise) | auraMoney:'1.0-0' }}</td>
                  <td><strong>{{ paise(row.expectedProfitPaise) | auraMoney:'1.0-0' }}</strong></td>
                  <td>{{ percent(row.marginBps) }}</td>
                  <td>{{ row.peakScore || 0 }}</td>
                  <td><span>{{ row.recommendation }}</span><strong *ngIf="row.suggestedPriceUpliftBps">+{{ percent(row.suggestedPriceUpliftBps) }} peak uplift</strong></td>
                </tr>
                <tr *ngIf="!(booking.recommendations || []).length"><td colspan="8" class="empty-cell">No booking profitability signals yet.</td></tr>
              </tbody>
            </table>
          </div>
        </article>
      </section>

      <section class="pricing-grid" *ngIf="summary()?.pricingAutopilot as pricing">
        <article class="table-panel pricing-panel">
          <header>
            <div>
              <h2>Service price recommendations</h2>
            </div>
            <span>{{ percent(pricing.targetMarginBps) }} target margin</span>
          </header>
          <div class="table-wrap">
            <table>
              <thead><tr><th>Service</th><th>Current Price</th><th>Recommended</th><th>Profit Lift</th><th>Current Margin</th><th>Projected</th><th>Demand Risk</th><th>Reason</th></tr></thead>
              <tbody>
                <tr *ngFor="let row of pricing.recommendations || []">
                  <td><strong>{{ row.serviceName }}</strong><span>{{ row.demandVolume || 0 }} sales</span></td>
                  <td>{{ paise(row.currentPricePaise) | auraMoney:'1.0-0' }}</td>
                  <td><strong>{{ paise(row.recommendedPricePaise) | auraMoney:'1.0-0' }}</strong></td>
                  <td>{{ paise(row.expectedProfitLiftPaise) | auraMoney:'1.0-0' }}</td>
                  <td>{{ percent(row.currentMarginBps) }}</td>
                  <td>{{ percent(row.projectedMarginBps) }}</td>
                  <td><strong>{{ row.demandRisk }}</strong></td>
                  <td><span>{{ row.reason }}</span></td>
                </tr>
                <tr *ngIf="!(pricing.recommendations || []).length"><td colspan="8" class="empty-cell">No pricing recommendations yet.</td></tr>
              </tbody>
            </table>
          </div>
        </article>
      </section>

      <section class="wastage-grid" *ngIf="summary()?.recipeVariance as variance">
        <article class="table-panel wastage-panel">
          <header>
            <div>
              <h2>Recipe variance & product overuse</h2>
            </div>
            <span>{{ variance.sourceHealth?.drafts || 0 }} consume drafts</span>
          </header>
          <div class="table-wrap">
            <table>
              <thead><tr><th>Status</th><th>Signal</th><th>Service</th><th>Branch</th><th>Staff</th><th>Expected</th><th>Actual</th><th>Variance</th><th>Action</th></tr></thead>
              <tbody>
                <tr *ngFor="let row of variance.rows || []">
                  <td><strong class="severity-pill" [ngClass]="'severity-' + (row.severity || 'green')">{{ row.severity }}</strong></td>
                  <td><strong>{{ row.dimension }}</strong><span>{{ row.productName || row.draftCount + ' drafts' }}</span></td>
                  <td>{{ row.serviceName || row.serviceId || '-' }}</td>
                  <td>{{ row.branchId || '-' }}</td>
                  <td>{{ row.staffName || row.staffId || '-' }}</td>
                  <td>{{ paise(row.expectedCostPaise) | auraMoney:'1.0-0' }}</td>
                  <td>{{ paise(row.actualCostPaise) | auraMoney:'1.0-0' }}</td>
                  <td><strong>{{ paise(row.variancePaise) | auraMoney:'1.0-0' }}</strong><span>{{ percent(row.varianceBps) }}</span></td>
                  <td><span>{{ row.recommendation }}</span></td>
                </tr>
                <tr *ngIf="!(variance.rows || []).length"><td colspan="9" class="empty-cell">No recipe variance signals yet.</td></tr>
              </tbody>
            </table>
          </div>
        </article>
      </section>

      <section class="leak-grid" *ngIf="summary()?.profitLeaks as leaks">
        <article class="table-panel leak-panel">
          <header>
            <div>
              <h2>Daily leakage alert center</h2>
            </div>
            <span>{{ leaks.length || 0 }} active signals</span>
          </header>
          <div class="table-wrap">
            <table>
              <thead><tr><th>Severity</th><th>Leak Type</th><th>Branch</th><th>Source</th><th>Impact</th><th>Message</th><th>Action</th></tr></thead>
              <tbody>
                <tr *ngFor="let leak of leaks">
                  <td><strong class="severity-pill" [ngClass]="'severity-' + severityClass(leak.severity)">{{ leak.severity }}</strong></td>
                  <td><strong>{{ leak.type }}</strong></td>
                  <td>{{ leak.branchId || '-' }}</td>
                  <td>{{ leak.sourceId || '-' }}</td>
                  <td><strong>{{ paise(leak.estimatedImpactPaise) | auraMoney:'1.0-0' }}</strong></td>
                  <td><span>{{ leak.message }}</span></td>
                  <td><span>{{ leak.recommendedAction }}</span></td>
                </tr>
                <tr *ngIf="!leaks.length"><td colspan="7" class="empty-cell">No profit leaks detected.</td></tr>
              </tbody>
            </table>
          </div>
        </article>
      </section>

      <section class="action-grid">
        <article class="table-panel action-panel">
          <header>
            <div>
              <h2>AI suggestions ready for execution</h2>
            </div>
            <span>{{ actionQueue().length || 0 }} open actions</span>
          </header>
          <div class="table-wrap">
            <table>
              <thead><tr><th>Priority</th><th>Action</th><th>Source</th><th>Expected Impact</th><th>Status</th><th>Controls</th></tr></thead>
              <tbody>
                <tr *ngFor="let action of actionQueue()">
                  <td><strong class="severity-pill" [ngClass]="'severity-' + priorityClass(action.priority)">{{ action.priority }}</strong></td>
                  <td><strong>{{ action.title }}</strong><span>{{ action.message }}</span></td>
                  <td>{{ action.sourceType }}<span>{{ action.sourceId || '-' }}</span></td>
                  <td><strong>{{ paise(action.impactPaise) | auraMoney:'1.0-0' }}</strong></td>
                  <td>{{ action.status }}</td>
                  <td>
                    <div class="action-buttons">
                      <button type="button" (click)="actionTransition(action, 'approve')" [disabled]="actionBusy() === action.id || action.status !== 'pending'">Approve</button>
                      <button type="button" (click)="actionTransition(action, 'complete')" [disabled]="actionBusy() === action.id || action.status === 'completed' || action.status === 'dismissed'">Complete</button>
                      <button type="button" (click)="actionTransition(action, 'dismiss')" [disabled]="actionBusy() === action.id || action.status === 'completed' || action.status === 'dismissed'">Dismiss</button>
                    </div>
                  </td>
                </tr>
                <tr *ngIf="!actionQueue().length"><td colspan="6" class="empty-cell">No profit actions queued yet.</td></tr>
              </tbody>
            </table>
          </div>
        </article>
      </section>

      <section class="governance-grid" *ngIf="summary()?.profitGovernance as governance">
        <article class="table-panel governance-rules-panel">
          <header>
            <div>
              <h2>Governance rules</h2>
            </div>
            <span>{{ governance.rulesActive || 0 }} active</span>
          </header>
          <div class="table-wrap">
            <table>
              <thead><tr><th>Rule</th><th>Min Margin</th><th>Max Discount</th><th>Approval</th><th>Auto Execute</th><th>Audit</th><th>Severity</th></tr></thead>
              <tbody>
                <tr *ngFor="let rule of governanceRules()">
                  <td><strong>{{ rule.title }}</strong><span>{{ rule.description }}</span></td>
                  <td>{{ percent(rule.minMarginBps) }}</td>
                  <td>{{ percent(rule.maxDiscountBps) }}</td>
                  <td>{{ rule.approvalRequired ? 'Required' : 'No' }}</td>
                  <td>{{ rule.autoExecuteAllowed ? 'Allowed' : 'Blocked' }}</td>
                  <td>{{ rule.auditRequired ? 'Required' : 'No' }}</td>
                  <td><strong class="severity-pill" [ngClass]="'severity-' + severityClass(rule.severity)">{{ rule.severity }}</strong></td>
                </tr>
                <tr *ngIf="!governanceRules().length"><td colspan="7" class="empty-cell">No governance rules configured.</td></tr>
              </tbody>
            </table>
          </div>
        </article>

        <article class="panel margin-guard-panel">
          <header>
            <div>
              <h2>Pre-invoice guardrail</h2>
            </div>
            <span>{{ governance.blockedToday || 0 }} blocked today</span>
          </header>
          <form class="guard-form" [formGroup]="filters" (ngSubmit)="evaluateDiscount()">
            <label><span>Gross Amount</span><input type="number" min="0" formControlName="guardGrossAmount" /></label>
            <label><span>Discount</span><input type="number" min="0" formControlName="guardDiscountAmount" /></label>
            <label><span>Product Cost</span><input type="number" min="0" formControlName="guardProductCost" /></label>
            <label><span>Staff Cost</span><input type="number" min="0" formControlName="guardStaffCost" /></label>
            <label><span>Membership Redemption</span><input type="number" min="0" formControlName="guardMembershipRedemption" /></label>
            <button class="primary-button" type="submit" [disabled]="governanceBusy()">Evaluate Discount</button>
          </form>
          <div class="guard-result" *ngIf="governanceDecision() as decision">
            <div><span>Status</span><strong>{{ decision.blocked ? 'Blocked' : decision.requiresApproval ? 'Approval Required' : 'Allowed' }}</strong></div>
            <div><span>Estimated Profit</span><strong>{{ paise(decision.estimatedProfitPaise) | auraMoney:'1.0-0' }}</strong></div>
            <div><span>Margin</span><strong>{{ percent(decision.marginBps) }}</strong></div>
            <div><span>Discount</span><strong>{{ percent(decision.discountBps) }}</strong></div>
            <div><span>Rule Triggered</span><strong>{{ decision.ruleTriggered?.title || 'Within policy' }}</strong></div>
            <div><span>Recommendation</span><strong>{{ decision.recommendedAction }}</strong></div>
          </div>
        </article>

        <article class="table-panel governance-decisions-panel">
          <header>
            <div>
              <h2>Recent audit trail</h2>
            </div>
            <span>{{ governance.auditCount || 0 }} decisions</span>
          </header>
          <div class="table-wrap">
            <table>
              <thead><tr><th>Source</th><th>Decision</th><th>Risk</th><th>Impact</th><th>Message</th></tr></thead>
              <tbody>
                <tr *ngFor="let row of governance.recentDecisions || []">
                  <td><strong>{{ row.sourceType }}</strong><span>{{ row.sourceId || '-' }}</span></td>
                  <td>{{ row.decision }}</td>
                  <td>{{ percent(row.marginBps) }} margin<span>{{ percent(row.discountBps) }} discount</span></td>
                  <td><strong>{{ paise(row.impactPaise) | auraMoney:'1.0-0' }}</strong></td>
                  <td><span>{{ row.message }}</span></td>
                </tr>
                <tr *ngIf="!(governance.recentDecisions || []).length"><td colspan="5" class="empty-cell">No governance decisions yet.</td></tr>
              </tbody>
            </table>
          </div>
        </article>
      </section>

      <section class="pos-guard-grid">
        <article class="panel pos-guard-panel">
          <header>
            <div>
              <h2>Negative margin prevention</h2>
            </div>
            <span>Pre-save check</span>
          </header>
          <form class="pos-guard-form" [formGroup]="filters" (ngSubmit)="checkPosMargin()">
            <label><span>Gross Amount</span><input type="number" min="0" formControlName="posGrossAmount" /></label>
            <label><span>Discount</span><input type="number" min="0" formControlName="posDiscountAmount" /></label>
            <label><span>Product Cost</span><input type="number" min="0" formControlName="posProductCost" /></label>
            <label><span>Staff Cost</span><input type="number" min="0" formControlName="posStaffCost" /></label>
            <label><span>Membership Redemption</span><input type="number" min="0" formControlName="posMembershipRedemption" /></label>
            <button class="primary-button" type="submit" [disabled]="posGuardBusy()">Check Margin</button>
          </form>
        </article>

        <article class="panel pos-result-panel" *ngIf="posMarginDecision() as decision">
          <header>
            <div>
              <h2>{{ decision.blocked ? 'Blocked' : decision.requiresApproval ? 'Approval required' : 'Allowed' }}</h2>
            </div>
            <span>{{ percent(decision.marginBps) }} margin</span>
          </header>
          <div class="guard-result">
            <div><span>Estimated Profit</span><strong>{{ paise(decision.estimatedProfitPaise) | auraMoney:'1.0-0' }}</strong></div>
            <div><span>Discount</span><strong>{{ percent(decision.discountBps) }}</strong></div>
            <div><span>Rule Triggered</span><strong>{{ decision.ruleTriggered?.title || 'Within policy' }}</strong></div>
            <div><span>Recommendation</span><strong>{{ decision.recommendedAction }}</strong></div>
          </div>
          <div class="rank-list suggestion-list">
            <div *ngFor="let reason of decision.reasons || []">
              <span>{{ reason.message }}</span>
              <strong>{{ paise(reason.impactPaise) | auraMoney:'1.0-0' }}</strong>
            </div>
          </div>
        </article>
      </section>

      <section class="copilot-grid" *ngIf="summary() as report">
        <article class="panel copilot-panel">
          <header>
            <div>
              <h2>Owner Q&amp;A</h2>
            </div>
            <span>Rule-based</span>
          </header>
          <form class="copilot-form" [formGroup]="filters" (ngSubmit)="askCopilot()">
            <label>
              <span>Question</span>
              <input type="text" formControlName="copilotQuestion" placeholder="profit kam kyu hai?" />
            </label>
            <button class="primary-button" type="submit" [disabled]="copilotBusy()">Ask</button>
          </form>
          <div class="copilot-answer" *ngIf="copilotResponse() as copilot">
            <strong>{{ copilot.answer }}</strong>
            <div class="mini-table">
              <div *ngFor="let reason of copilot.reasons || []">
                <span>{{ reason.label || reason.type }}</span>
                <strong>{{ paise(reason.impactPaise) | auraMoney:'1.0-0' }}</strong>
                <small>{{ reason.message }}</small>
              </div>
              <div *ngIf="!(copilot.reasons || []).length" class="empty-row">No major reasons detected.</div>
            </div>
            <div class="rank-list suggestion-list">
              <div *ngFor="let action of copilot.recommendedActions || []">
                <span>{{ action.title }}</span>
                <strong>{{ paise(action.impactPaise) | auraMoney:'1.0-0' }}</strong>
              </div>
            </div>
          </div>
        </article>

        <article class="panel board-panel" *ngIf="report.autoBoardReport as board">
          <header>
            <div>
              <h2>Monthly owner preview</h2>
            </div>
            <span>{{ report.period?.from }} to {{ report.period?.to }}</span>
          </header>
          <div class="board-metrics">
            <div><span>Revenue</span><strong>{{ paise(board.revenuePaise) | auraMoney:'1.0-0' }}</strong></div>
            <div><span>Gross Profit</span><strong>{{ paise(board.grossProfitPaise) | auraMoney:'1.0-0' }}</strong><small>{{ percent(board.grossMarginBps) }}</small></div>
            <div><span>Net Profit</span><strong>{{ paise(board.netProfitPaise) | auraMoney:'1.0-0' }}</strong><small>{{ percent(board.marginBps) }}</small></div>
            <div><span>Expected Recovery</span><strong>{{ paise(board.expectedRecoveryProfitPaise) | auraMoney:'1.0-0' }}</strong></div>
          </div>
          <div class="board-lists">
            <div>
              <h3>Top 5 wins</h3>
              <p *ngFor="let item of board.topWins || []">{{ item }}</p>
            </div>
            <div>
              <h3>Top 5 risks</h3>
              <p *ngFor="let item of board.topRisks || []">{{ item }}</p>
            </div>
            <div>
              <h3>Next 5 actions</h3>
              <p *ngFor="let item of board.nextActions || []">{{ item }}</p>
            </div>
          </div>
        </article>
      </section>

      <section class="customer-score-grid" *ngIf="summary() as report">
        <article class="table-panel customer-score-panel">
          <header>
            <div>
              <h2>Profit tier intelligence</h2>
            </div>
            <span>{{ report.customerProfitScore?.length || 0 }} customers</span>
          </header>
          <div class="table-wrap">
            <table>
              <thead><tr><th>Customer</th><th>Profit Tier</th><th>Score</th><th>Revenue</th><th>Profit</th><th>Discount</th><th>Visits</th><th>Action</th></tr></thead>
              <tbody>
                <tr *ngFor="let row of report.customerProfitScore || []">
                  <td><strong>{{ row.clientName }}</strong><span>{{ row.clientId || 'walk-in' }}</span></td>
                  <td><strong>{{ row.tier }}</strong></td>
                  <td>{{ row.profitScore || 0 }}/100</td>
                  <td>{{ paise(row.revenuePaise) | auraMoney:'1.0-0' }}</td>
                  <td><strong>{{ paise(row.profitPaise) | auraMoney:'1.0-0' }}</strong></td>
                  <td>{{ paise(row.discountPaise) | auraMoney:'1.0-0' }}</td>
                  <td>{{ row.visits || 0 }}<span>{{ paise(row.avgBillPaise) | auraMoney:'1.0-0' }} avg bill</span></td>
                  <td><span>{{ row.recommendation }}</span></td>
                </tr>
                <tr *ngIf="!(report.customerProfitScore || []).length"><td colspan="8" class="empty-cell">No customer score signals yet.</td></tr>
              </tbody>
            </table>
          </div>
        </article>

        <article class="table-panel liability-panel">
          <header>
            <div>
              <h2>Future redemption exposure</h2>
            </div>
            <span>{{ report.membershipRisk?.length || 0 }} plans</span>
          </header>
          <div class="table-wrap">
            <table>
              <thead><tr><th>Plan</th><th>Type</th><th>Sold</th><th>Redeemed</th><th>Liability</th><th>Future Cost</th><th>Risk Impact</th><th>Severity</th><th>Action</th></tr></thead>
              <tbody>
                <tr *ngFor="let row of report.membershipRisk || []">
                  <td><strong>{{ row.planName }}</strong></td>
                  <td>{{ row.kind || 'membership' }}</td>
                  <td>{{ paise(row.soldValuePaise) | auraMoney:'1.0-0' }}</td>
                  <td>{{ paise(row.redeemedValuePaise) | auraMoney:'1.0-0' }}</td>
                  <td>{{ paise(row.remainingLiabilityPaise) | auraMoney:'1.0-0' }}</td>
                  <td>{{ paise(row.projectedCostPaise) | auraMoney:'1.0-0' }}</td>
                  <td><strong>{{ paise(row.riskImpactPaise) | auraMoney:'1.0-0' }}</strong></td>
                  <td><strong class="severity-pill" [ngClass]="'severity-' + severityClass(row.severity)">{{ row.severity }}</strong></td>
                  <td><span>{{ row.recommendation }}</span></td>
                </tr>
                <tr *ngIf="!(report.membershipRisk || []).length"><td colspan="9" class="empty-cell">No membership liability risk yet.</td></tr>
              </tbody>
            </table>
          </div>
        </article>
      </section>

      <section class="enterprise-grid" *ngIf="summary()?.enterpriseAnalytics as analytics">
        <article class="panel analytics-card">
          <header>
            <div>
              <h2>Trend & forecast</h2>
            </div>
            <span>{{ analytics.periodGrain }}</span>
          </header>
          <div class="analytics-metrics">
            <div>
              <span>Prev period profit</span>
              <strong>{{ percent(analytics.comparisons?.previousPeriod?.profitChangeBps) }}</strong>
              <small>{{ paise(analytics.comparisons?.previousPeriod?.netProfitPaise) | auraMoney:'1.0-0' }} baseline</small>
            </div>
            <div>
              <span>YoY revenue</span>
              <strong>{{ percent(analytics.comparisons?.previousYear?.revenueChangeBps) }}</strong>
              <small>{{ paise(analytics.comparisons?.previousYear?.revenuePaise) | auraMoney:'1.0-0' }} baseline</small>
            </div>
            <div>
              <span>Next month forecast</span>
              <strong>{{ paise(analytics.forecast?.nextMonthProfitPaise) | auraMoney:'1.0-0' }}</strong>
              <small>{{ analytics.forecast?.basis }}</small>
            </div>
            <div>
              <span>Break-even</span>
              <strong>{{ analytics.breakEven?.breakEvenDays || 0 }} days</strong>
              <small>{{ analytics.breakEven?.status }} - {{ paise(analytics.breakEven?.fixedCostPaise) | auraMoney:'1.0-0' }} fixed</small>
            </div>
          </div>
        </article>

        <article class="panel">
          <header>
            <div>
              <h2>Recent P&amp;L movement</h2>
            </div>
          </header>
          <div class="mini-table">
            <div *ngFor="let row of (analytics.profitTrend || []).slice(-7)">
              <span>{{ row.date }}</span>
              <strong>{{ paise(row.netProfitPaise) | auraMoney:'1.0-0' }}</strong>
              <small>{{ paise(row.revenuePaise) | auraMoney:'1.0-0' }} revenue</small>
            </div>
            <div *ngIf="!(analytics.profitTrend || []).length" class="empty-row">No trend data.</div>
          </div>
        </article>

        <article class="panel">
          <header>
            <div>
              <h2>Best revenue windows</h2>
            </div>
          </header>
          <div class="mini-table">
            <div *ngFor="let row of analytics.revenueHeatmap || []">
              <span>{{ row.weekday }} {{ row.hour }}:00</span>
              <strong>{{ paise(row.revenuePaise) | auraMoney:'1.0-0' }}</strong>
              <small>{{ row.invoiceCount || 0 }} invoices</small>
            </div>
            <div *ngIf="!(analytics.revenueHeatmap || []).length" class="empty-row">No heatmap data.</div>
          </div>
        </article>

        <article class="panel">
          <header>
            <div>
              <h2>AI profit signals</h2>
            </div>
          </header>
          <div class="warnings analytics-warnings" *ngIf="(analytics.alerts || []).length">
            <p *ngFor="let alert of analytics.alerts">{{ alert.message }}</p>
          </div>
          <div class="rank-list suggestion-list">
            <div *ngFor="let suggestion of analytics.suggestions || []">
              <span>{{ suggestion }}</span>
            </div>
          </div>
        </article>
      </section>

      <section class="insight-grid" *ngIf="summary() as report">
        <article class="panel">
          <header>
            <div>
              <h2>Revenue sources</h2>
            </div>
            <span>{{ report.sourceHealth?.invoices || 0 }} invoices</span>
          </header>
          <div class="rank-list">
            <div *ngFor="let item of report.revenueBreakdown || []">
              <span>{{ item.label }}</span>
              <strong>{{ paise(item.amountPaise) | auraMoney:'1.0-0' }}</strong>
            </div>
            <div *ngIf="!(report.revenueBreakdown || []).length" class="empty-row">No revenue rows in this period.</div>
          </div>
        </article>

        <article class="panel">
          <header>
            <div>
              <h2>Top operating lines</h2>
            </div>
            <span>{{ report.sourceHealth?.expenses || 0 }} rows</span>
          </header>
          <div class="rank-list">
            <div *ngFor="let item of report.expenseBreakdown || []">
              <span>{{ item.category }}</span>
              <strong>{{ paise(item.amountPaise) | auraMoney:'1.0-0' }}</strong>
            </div>
            <div *ngIf="!(report.expenseBreakdown || []).length" class="empty-row">No expense rows in this period.</div>
          </div>
        </article>

        <article class="panel source-panel">
          <header>
            <div>
              <h2>Calculation sources</h2>
            </div>
            <span>{{ report.period?.from }} to {{ report.period?.to }}</span>
          </header>
          <div class="source-grid">
            <div><span>COGS</span><strong>{{ report.sourceHealth?.cogsSource }}</strong></div>
            <div><span>Staff cost</span><strong>{{ report.sourceHealth?.staffCostSource }}</strong></div>
            <div><span>Collections</span><strong>{{ paise(report.metrics?.collectionsPaise) | auraMoney:'1.0-0' }}</strong></div>
            <div><span>Refunds</span><strong>{{ paise(report.metrics?.refundPaise) | auraMoney:'1.0-0' }}</strong></div>
          </div>
          <div class="warnings" *ngIf="(report.diagnostics?.warnings || []).length">
            <p *ngFor="let warning of report.diagnostics?.warnings">{{ warning }}</p>
          </div>
        </article>
      </section>

      <section class="drilldown-grid" *ngIf="breakdown() as detail">
        <article class="table-panel">
          <header>
            <div>
              <h2>Service wise margin</h2>
            </div>
          </header>
          <div class="table-wrap">
            <table>
              <thead><tr><th>Service</th><th>Sale</th><th>Product Cost</th><th>Staff Cost</th><th>Profit</th></tr></thead>
              <tbody>
                <tr *ngFor="let row of detail.serviceProfit || []">
                  <td><strong>{{ row.serviceName }}</strong><span>{{ row.category }}</span></td>
                  <td>{{ paise(row.revenuePaise) | auraMoney:'1.0-0' }}</td>
                  <td>{{ paise(row.productCostPaise) | auraMoney:'1.0-0' }}</td>
                  <td>{{ paise(row.staffCostPaise) | auraMoney:'1.0-0' }}</td>
                  <td><strong>{{ paise(row.netProfitPaise) | auraMoney:'1.0-0' }}</strong></td>
                </tr>
                <tr *ngIf="!(detail.serviceProfit || []).length"><td colspan="5" class="empty-cell">No service profit rows.</td></tr>
              </tbody>
            </table>
          </div>
        </article>

        <article class="table-panel">
          <header>
            <div>
              <h2>Staff wise profitability</h2>
            </div>
          </header>
          <div class="table-wrap">
            <table>
              <thead><tr><th>Staff</th><th>Revenue</th><th>Commission</th><th>Product Usage</th><th>Net Profit</th><th>Avg Ticket</th></tr></thead>
              <tbody>
                <tr *ngFor="let row of detail.staffProfit || []">
                  <td><strong>{{ row.staffName }}</strong></td>
                  <td>{{ paise(row.revenuePaise) | auraMoney:'1.0-0' }}</td>
                  <td>{{ paise(row.staffCostPaise) | auraMoney:'1.0-0' }}</td>
                  <td>{{ paise(row.productCostPaise) | auraMoney:'1.0-0' }}</td>
                  <td><strong>{{ paise(row.netProfitPaise) | auraMoney:'1.0-0' }}</strong></td>
                  <td>{{ paise(row.avgTicketPaise) | auraMoney:'1.0-0' }}</td>
                </tr>
                <tr *ngIf="!(detail.staffProfit || []).length"><td colspan="6" class="empty-cell">No staff profit rows.</td></tr>
              </tbody>
            </table>
          </div>
        </article>

        <article class="table-panel">
          <header>
            <div>
              <h2>Branch wise profit</h2>
            </div>
          </header>
          <div class="table-wrap">
            <table>
              <thead><tr><th>Branch</th><th>Revenue</th><th>COGS</th><th>Staff</th><th>Expenses</th><th>Net</th></tr></thead>
              <tbody>
                <tr *ngFor="let row of detail.branchProfit || []">
                  <td><strong>{{ row.branchName }}</strong><span>{{ row.invoiceCount }} invoices</span></td>
                  <td>{{ paise(row.revenuePaise) | auraMoney:'1.0-0' }}</td>
                  <td>{{ paise(row.productCostPaise) | auraMoney:'1.0-0' }}</td>
                  <td>{{ paise(row.staffCostPaise) | auraMoney:'1.0-0' }}</td>
                  <td>{{ paise(row.operatingExpensePaise) | auraMoney:'1.0-0' }}</td>
                  <td><strong>{{ paise(row.netProfitPaise) | auraMoney:'1.0-0' }}</strong></td>
                </tr>
                <tr *ngIf="!(detail.branchProfit || []).length"><td colspan="6" class="empty-cell">No branch profit rows.</td></tr>
              </tbody>
            </table>
          </div>
        </article>

        <article class="table-panel">
          <header>
            <div>
              <h2>Category wise margin</h2>
            </div>
          </header>
          <div class="table-wrap">
            <table>
              <thead><tr><th>Category</th><th>Revenue</th><th>Product Cost</th><th>Staff Cost</th><th>Profit</th><th>Margin</th></tr></thead>
              <tbody>
                <tr *ngFor="let row of detail.categoryProfit || []">
                  <td><strong>{{ row.category }}</strong><span>{{ row.itemCount }} items</span></td>
                  <td>{{ paise(row.revenuePaise) | auraMoney:'1.0-0' }}</td>
                  <td>{{ paise(row.productCostPaise) | auraMoney:'1.0-0' }}</td>
                  <td>{{ paise(row.staffCostPaise) | auraMoney:'1.0-0' }}</td>
                  <td><strong>{{ paise(row.netProfitPaise) | auraMoney:'1.0-0' }}</strong></td>
                  <td>{{ percent(row.netMarginBps) }}</td>
                </tr>
                <tr *ngIf="!(detail.categoryProfit || []).length"><td colspan="6" class="empty-cell">No category profit rows.</td></tr>
              </tbody>
            </table>
          </div>
        </article>
      </section>

      <section class="retention-grid" *ngIf="breakdown() as detail">
        <article class="table-panel">
          <header>
            <div>
              <h2>Customer profitability</h2>
            </div>
          </header>
          <div class="table-wrap">
            <table>
              <thead><tr><th>Customer</th><th>Revenue</th><th>Product Cost</th><th>Discounts</th><th>Profit</th><th>Visits</th><th>Avg Bill</th></tr></thead>
              <tbody>
                <tr *ngFor="let row of detail.customerProfit || []">
                  <td><strong>{{ row.clientName }}</strong><span>Lifetime {{ paise(row.lifetimeRevenuePaise) | auraMoney:'1.0-0' }}</span></td>
                  <td>{{ paise(row.revenuePaise) | auraMoney:'1.0-0' }}</td>
                  <td>{{ paise(row.productCostPaise) | auraMoney:'1.0-0' }}</td>
                  <td>{{ paise(row.discountPaise) | auraMoney:'1.0-0' }}</td>
                  <td><strong>{{ paise(row.netProfitPaise) | auraMoney:'1.0-0' }}</strong></td>
                  <td>{{ row.visits || 0 }}</td>
                  <td>{{ paise(row.avgBillPaise) | auraMoney:'1.0-0' }}</td>
                </tr>
                <tr *ngIf="!(detail.customerProfit || []).length"><td colspan="7" class="empty-cell">No customer profit rows.</td></tr>
              </tbody>
            </table>
          </div>
        </article>

        <article class="table-panel">
          <header>
            <div>
              <h2>Membership value</h2>
            </div>
          </header>
          <div class="table-wrap">
            <table>
              <thead><tr><th>Plan</th><th>Sales</th><th>Redeemed</th><th>Product Cost</th><th>Liability</th><th>Profit</th><th>Sold</th></tr></thead>
              <tbody>
                <tr *ngFor="let row of detail.membershipProfit || []">
                  <td><strong>{{ row.planName }}</strong></td>
                  <td>{{ paise(row.soldValuePaise) | auraMoney:'1.0-0' }}</td>
                  <td>{{ paise(row.redeemedValuePaise) | auraMoney:'1.0-0' }}</td>
                  <td>{{ paise(row.productCostPaise) | auraMoney:'1.0-0' }}</td>
                  <td>{{ paise(row.remainingLiabilityPaise) | auraMoney:'1.0-0' }}</td>
                  <td><strong>{{ paise(row.netProfitPaise) | auraMoney:'1.0-0' }}</strong></td>
                  <td>{{ row.soldCount || 0 }}</td>
                </tr>
                <tr *ngIf="!(detail.membershipProfit || []).length"><td colspan="7" class="empty-cell">No membership profit rows.</td></tr>
              </tbody>
            </table>
          </div>
        </article>

        <article class="table-panel">
          <header>
            <div>
              <h2>Package value</h2>
            </div>
          </header>
          <div class="table-wrap">
            <table>
              <thead><tr><th>Package</th><th>Sold Value</th><th>Redeemed Value</th><th>Product Cost</th><th>Remaining Balance</th><th>Net Profit</th><th>Redeemed</th></tr></thead>
              <tbody>
                <tr *ngFor="let row of detail.packageProfit || []">
                  <td><strong>{{ row.planName }}</strong></td>
                  <td>{{ paise(row.soldValuePaise) | auraMoney:'1.0-0' }}</td>
                  <td>{{ paise(row.redeemedValuePaise) | auraMoney:'1.0-0' }}</td>
                  <td>{{ paise(row.productCostPaise) | auraMoney:'1.0-0' }}</td>
                  <td>{{ paise(row.remainingLiabilityPaise) | auraMoney:'1.0-0' }}</td>
                  <td><strong>{{ paise(row.netProfitPaise) | auraMoney:'1.0-0' }}</strong></td>
                  <td>{{ row.redeemedCount || 0 }}</td>
                </tr>
                <tr *ngIf="!(detail.packageProfit || []).length"><td colspan="7" class="empty-cell">No package profit rows.</td></tr>
              </tbody>
            </table>
          </div>
        </article>
      </section>
    </section>
  `,
  styles: [`
    .profit-workspace { display: grid; gap: 8px; min-height: calc(100vh - 20px); padding: 8px; background: #f0f2f5; color: #1d2430; }
    .page-title { display: flex; align-items: end; justify-content: space-between; gap: 16px; padding: 14px; background: #fff; border: 1px solid #d9e1ea; }
    .page-title h1, h2 { margin: 0; letter-spacing: 0; }
    .page-title p { margin: 6px 0 0; color: #38506d; font-size: 13px; }
    form { display: flex; align-items: end; gap: 8px; flex-wrap: wrap; }
    label { display: grid; gap: 5px; color: #5d6f87; font-size: 11px; font-weight: 900; text-transform: uppercase; }
    input { min-height: 34px; border: 1px solid #bdcfe2; border-radius: 3px; padding: 7px 10px; font: inherit; color: #1d2430; background: #fff; }
    .primary-button { min-height: 34px; border: 1px solid #55173D; border-radius: 3px; padding: 7px 12px; background: #55173D; color: #fff; font-weight: 900; cursor: pointer; }
    app-state { display: block; margin: 12px 14px 0; }
    .metrics-grid { display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)); gap: 0; padding: 0 14px 12px; background: #fff; border-left: 1px solid #d9e1ea; border-right: 1px solid #d9e1ea; border-bottom: 1px solid #d9e1ea; }
    .metrics-grid article { display: grid; gap: 3px; min-height: 76px; padding: 12px 14px; border: 1px solid #d9e1ea; border-left: 0; border-top: 3px solid #0a78b6; }
    .metrics-grid article:first-child { border-left: 1px solid #d9e1ea; }
    .metrics-grid .net-card { border-top-color: #55173D; }
    .metrics-grid span, .metrics-grid small, header > span { color: #64748b; font-size: 12px; font-weight: 800; }
    .metrics-grid strong { font-size: 20px; line-height: 1; white-space: nowrap; }
    .ceo-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px; padding: 12px 14px; background: #eef4f8; border: 1px solid #d9e1ea; }
    .ceo-grid article { display: grid; gap: 4px; min-width: 0; min-height: 88px; padding: 11px 12px; background: #fff; border: 1px solid #d9e1ea; border-top: 3px solid #143d59; }
    .ceo-grid span, .ceo-grid small { color: #64748b; font-size: 12px; font-weight: 800; }
    .ceo-grid strong { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 18px; line-height: 1.1; }
    .digital-twin-grid { display: grid; grid-template-columns: 1.4fr 1fr 0.8fr; gap: 10px; padding: 12px 14px; background: #fff; border: 1px solid #d9e1ea; }
    .twin-panel { border-top: 3px solid #8a6d0f; }
    .scenario-form { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); align-items: end; gap: 8px; }
    .scenario-form .primary-button { width: 100%; }
    .twin-metrics { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
    .twin-metrics div { display: grid; gap: 4px; border: 1px solid #d9e1ea; padding: 10px; }
    .twin-metrics .delta { border-top: 3px solid #55173D; }
    .twin-metrics span { color: #64748b; font-size: 12px; font-weight: 800; }
    .twin-metrics strong { font-size: 18px; white-space: nowrap; }
    .booking-grid { display: grid; grid-template-columns: 1fr; gap: 10px; padding: 12px 14px; background: #eef4f8; border: 1px solid #d9e1ea; }
    .booking-panel { border-top: 3px solid #0a78b6; }
    .booking-panel table { min-width: 980px; }
    .pricing-grid { display: grid; grid-template-columns: 1fr; gap: 10px; padding: 12px 14px; background: #fff; border: 1px solid #d9e1ea; }
    .pricing-panel { border-top: 3px solid #55173D; }
    .pricing-panel table { min-width: 1040px; }
    .wastage-grid { display: grid; grid-template-columns: 1fr; gap: 10px; padding: 12px 14px; background: #eef4f8; border: 1px solid #d9e1ea; }
    .wastage-panel { border-top: 3px solid #9a3412; }
    .wastage-panel table { min-width: 1080px; }
    .leak-grid { display: grid; grid-template-columns: 1fr; gap: 10px; padding: 12px 14px; background: #fff; border: 1px solid #d9e1ea; }
    .leak-panel { border-top: 3px solid #991b1b; }
    .leak-panel table { min-width: 1040px; }
    .action-grid { display: grid; grid-template-columns: 1fr; gap: 10px; padding: 12px 14px; background: #fff; border: 1px solid #d9e1ea; }
    .action-panel { border-top: 3px solid #55173D; }
    .action-panel table { min-width: 1040px; }
    .action-buttons { display: flex; flex-wrap: wrap; gap: 6px; min-width: 210px; }
    .action-buttons button { border: 1px solid #cbd5e1; background: #fff; color: #143d59; padding: 7px 9px; font-weight: 900; cursor: pointer; }
    .action-buttons button:disabled { opacity: 0.45; cursor: not-allowed; }
    .governance-grid { display: grid; grid-template-columns: 1.2fr 0.8fr; gap: 10px; padding: 12px 14px; background: #eef4f8; border: 1px solid #d9e1ea; }
    .governance-rules-panel { border-top: 3px solid #143d59; }
    .margin-guard-panel { border-top: 3px solid #991b1b; }
    .governance-decisions-panel { grid-column: 1 / -1; border-top: 3px solid #8a6d0f; }
    .governance-rules-panel table { min-width: 960px; }
    .governance-decisions-panel table { min-width: 860px; }
    .guard-form { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; align-items: end; }
    .guard-form .primary-button { width: 100%; }
    .guard-result { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
    .guard-result div { display: grid; gap: 4px; border: 1px solid #d9e1ea; padding: 10px; min-width: 0; }
    .guard-result span { color: #64748b; font-size: 12px; font-weight: 800; }
    .guard-result strong { font-size: 13px; overflow-wrap: anywhere; }
    .pos-guard-grid { display: grid; grid-template-columns: 0.85fr 1.15fr; gap: 10px; padding: 12px 14px; background: #fff; border: 1px solid #d9e1ea; }
    .pos-guard-panel { border-top: 3px solid #991b1b; }
    .pos-result-panel { border-top: 3px solid #55173D; }
    .pos-guard-form { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; align-items: end; }
    .pos-guard-form .primary-button { width: 100%; }
    .copilot-grid { display: grid; grid-template-columns: 0.95fr 1.05fr; gap: 10px; padding: 12px 14px; background: #eef4f8; border: 1px solid #d9e1ea; }
    .copilot-panel { border-top: 3px solid #143d59; }
    .board-panel { border-top: 3px solid #8a6d0f; }
    .copilot-form { display: grid; grid-template-columns: 1fr auto; align-items: end; gap: 8px; }
    .copilot-form input { width: 100%; }
    .copilot-answer { display: grid; gap: 10px; }
    .board-metrics { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px; }
    .board-metrics div { display: grid; gap: 4px; border: 1px solid #d9e1ea; padding: 10px; min-width: 0; }
    .board-metrics span, .board-metrics small { color: #64748b; font-size: 12px; font-weight: 800; }
    .board-metrics strong { font-size: 17px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .board-lists { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; }
    .board-lists div { border: 1px solid #d9e1ea; padding: 10px; display: grid; gap: 6px; align-content: start; }
    .board-lists h3 { margin: 0; font-size: 13px; }
    .board-lists p { margin: 0; color: #38506d; font-size: 12px; font-weight: 800; }
    .customer-score-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; padding: 12px 14px; background: #eef4f8; border: 1px solid #d9e1ea; }
    .customer-score-panel { border-top: 3px solid #143d59; }
    .liability-panel { border-top: 3px solid #8a6d0f; }
    .customer-score-panel table { min-width: 1060px; }
    .liability-panel table { min-width: 1080px; }
    .severity-pill { display: inline-flex; min-width: 58px; justify-content: center; border-radius: 3px; padding: 4px 7px; font-size: 11px; text-transform: uppercase; }
    .severity-green { color: #7A4A28; background: #FBF0E8; border: 1px solid #E8C8A8; }
    .severity-amber { color: #92400e; background: #fef3c7; border: 1px solid #fbbf24; }
    .severity-red { color: #991b1b; background: #fee2e2; border: 1px solid #fca5a5; }
    .enterprise-grid { display: grid; grid-template-columns: 1.2fr 1fr 1fr 1fr; gap: 10px; padding: 12px 14px; background: #f6f8fb; border: 1px solid #d9e1ea; }
    .analytics-card { border-top: 3px solid #55173D; }
    .analytics-metrics { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
    .analytics-metrics div { display: grid; gap: 4px; min-width: 0; border: 1px solid #d9e1ea; padding: 10px; }
    .analytics-metrics span, .analytics-metrics small, .mini-table span, .mini-table small { color: #64748b; font-size: 12px; font-weight: 800; }
    .analytics-metrics strong { font-size: 18px; line-height: 1; white-space: nowrap; }
    .mini-table { display: grid; border: 1px solid #d9e1ea; }
    .mini-table > div { display: grid; grid-template-columns: 1fr auto; gap: 2px 10px; padding: 9px 10px; border-bottom: 1px solid #d9e1ea; }
    .mini-table > div:last-child { border-bottom: 0; }
    .mini-table small { grid-column: 1 / -1; }
    .analytics-warnings { margin-bottom: 8px; }
    .suggestion-list > div { display: block; }
    .insight-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; padding: 12px 14px; }
    .drilldown-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; padding: 0 14px 14px; }
    .retention-grid { display: grid; grid-template-columns: 1fr; gap: 10px; padding: 0 14px 14px; }
    .panel { background: #fff; border: 1px solid #d9e1ea; padding: 12px; display: grid; gap: 10px; align-content: start; }
    .table-panel { background: #fff; border: 1px solid #d9e1ea; padding: 12px; display: grid; gap: 10px; align-content: start; min-width: 0; }
    header { display: flex; justify-content: space-between; align-items: start; gap: 12px; }
    .eyebrow { margin: 0 0 4px; color: #5d6f87; font-size: 11px; font-weight: 900; text-transform: uppercase; }
    .rank-list { display: grid; border: 1px solid #d9e1ea; }
    .rank-list > div { display: flex; justify-content: space-between; gap: 12px; padding: 10px 12px; border-bottom: 1px solid #d9e1ea; }
    .rank-list > div:last-child { border-bottom: 0; }
    .rank-list span, .source-grid span { color: #64748b; font-size: 12px; font-weight: 800; }
    .source-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
    .source-grid div { display: grid; gap: 4px; border: 1px solid #d9e1ea; padding: 10px; }
    .warnings { display: grid; gap: 6px; }
    .warnings p, .empty-row { margin: 0; color: #9a3412; background: #fff7ed; border: 1px solid #fed7aa; padding: 9px 10px; font-size: 12px; font-weight: 800; }
    .table-wrap { overflow: auto; border: 1px solid #d9e1ea; }
    table { width: 100%; min-width: 720px; border-collapse: collapse; font-size: 13px; }
    th { background: #f1f5f9; color: #4b5f78; text-align: left; font-size: 11px; text-transform: uppercase; padding: 9px 10px; border-bottom: 1px solid #d9e1ea; }
    td { padding: 10px; border-bottom: 1px solid #d9e1ea; vertical-align: top; }
    td span { display: block; color: #64748b; font-size: 12px; margin-top: 3px; }
    .empty-cell { color: #64748b; text-align: center; font-weight: 800; }
    @media (max-width: 1100px) {
      .metrics-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); }
      .ceo-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); }
      .digital-twin-grid, .governance-grid, .pos-guard-grid, .copilot-grid, .customer-score-grid, .enterprise-grid, .insight-grid, .drilldown-grid, .retention-grid { grid-template-columns: 1fr; }
      .scenario-form, .guard-form, .pos-guard-form { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .board-metrics, .board-lists { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    }
    @media (max-width: 760px) {
      .page-title, header { align-items: flex-start; flex-direction: column; }
      .metrics-grid, .ceo-grid, .source-grid { grid-template-columns: 1fr; }
      .scenario-form, .guard-form, .pos-guard-form, .guard-result, .copilot-form, .twin-metrics, .board-metrics, .board-lists { grid-template-columns: 1fr; }
      .metrics-grid article, .metrics-grid article:first-child { border-left: 1px solid #d9e1ea; }
    }
  `]
})
export class ProfitIntelligenceComponent implements OnInit {
  readonly summary = signal<ApiRecord | null>(null);
  readonly breakdown = signal<ApiRecord | null>(null);
  readonly bookingRecommendations = signal<ApiRecord | null>(null);
  readonly actionQueue = signal<ApiRecord[]>([]);
  readonly governanceRules = signal<ApiRecord[]>([]);
  readonly governanceDecision = signal<ApiRecord | null>(null);
  readonly posMarginDecision = signal<ApiRecord | null>(null);
  readonly copilotResponse = signal<ApiRecord | null>(null);
  readonly loading = signal(false);
  readonly error = signal('');
  readonly actionBusy = signal('');
  readonly governanceBusy = signal(false);
  readonly posGuardBusy = signal(false);
  readonly copilotBusy = signal(false);
  readonly today = new Date().toISOString().slice(0, 10);
  readonly filters = this.fb.group({
    from: [`${this.today.slice(0, 7)}-01`],
    to: [this.today],
    copilotQuestion: ['profit kam kyu hai?'],
    guardGrossAmount: [5000],
    guardDiscountAmount: [500],
    guardProductCost: [900],
    guardStaffCost: [700],
    guardMembershipRedemption: [0],
    posGrossAmount: [5000],
    posDiscountAmount: [500],
    posProductCost: [900],
    posStaffCost: [700],
    posMembershipRedemption: [0],
    scenarioPriceChangePct: [0],
    scenarioRevenueChangePct: [0],
    scenarioCommissionChangePct: [0],
    scenarioWastageReductionPct: [0],
    scenarioExpenseChangePct: [0],
    scenarioRentChangeRupees: [0]
  });

  constructor(private readonly api: ApiService, private readonly fb: UntypedFormBuilder) {}

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.error.set('');
    forkJoin({
      report: this.api.list<ApiRecord>('profit-intelligence/summary', this.filters.value),
      detail: this.api.list<ApiRecord>('profit-intelligence/breakdown', this.filters.value),
      booking: this.api.list<ApiRecord>('profit-intelligence/booking-recommendations', this.filters.value),
      actions: this.api.list<ApiRecord[]>('profit-intelligence/actions', this.filters.value),
      governanceRules: this.api.list<ApiRecord[]>('profit-intelligence/governance/rules', this.filters.value)
    }).subscribe({
      next: ({ report, detail, booking, actions, governanceRules }) => {
        this.summary.set(report);
        this.breakdown.set(detail);
        this.bookingRecommendations.set(booking);
        this.actionQueue.set(actions || []);
        this.governanceRules.set(governanceRules || []);
        this.loading.set(false);
      },
      error: (error) => {
        this.error.set(this.api.errorText(error, 'Unable to load Profit Intelligence'));
        this.loading.set(false);
      }
    });
  }

  evaluateDiscount(): void {
    this.governanceBusy.set(true);
    this.error.set('');
    this.api.post<ApiRecord>('profit-intelligence/governance/evaluate-discount', {
      ...this.filters.value,
      grossAmountPaise: this.inputPaise(this.filters.value.guardGrossAmount),
      discountPaise: this.inputPaise(this.filters.value.guardDiscountAmount),
      productCostPaise: this.inputPaise(this.filters.value.guardProductCost),
      staffCostPaise: this.inputPaise(this.filters.value.guardStaffCost),
      membershipRedemptionPaise: this.inputPaise(this.filters.value.guardMembershipRedemption),
      sourceType: 'margin_safe_discount_simulator',
      sourceId: `sim-${Date.now()}`
    }).subscribe({
      next: (decision) => {
        this.governanceDecision.set(decision);
        this.governanceBusy.set(false);
        this.load();
      },
      error: (error) => {
        this.error.set(this.api.errorText(error, 'Unable to evaluate margin guard'));
        this.governanceBusy.set(false);
      }
    });
  }

  checkPosMargin(): void {
    this.posGuardBusy.set(true);
    this.error.set('');
    this.api.post<ApiRecord>('profit-intelligence/pos-margin-check', {
      ...this.filters.value,
      grossAmountPaise: this.inputPaise(this.filters.value.posGrossAmount),
      discountPaise: this.inputPaise(this.filters.value.posDiscountAmount),
      productCostPaise: this.inputPaise(this.filters.value.posProductCost),
      staffCostPaise: this.inputPaise(this.filters.value.posStaffCost),
      membershipRedemptionPaise: this.inputPaise(this.filters.value.posMembershipRedemption),
      sourceType: 'pos_margin_guard_simulator',
      sourceId: `pos-sim-${Date.now()}`,
      lineItems: [{
        type: 'service',
        name: 'Sample POS invoice',
        amountPaise: this.inputPaise(this.filters.value.posGrossAmount),
        productCostPaise: this.inputPaise(this.filters.value.posProductCost),
        staffCostPaise: this.inputPaise(this.filters.value.posStaffCost)
      }]
    }).subscribe({
      next: (decision) => {
        this.posMarginDecision.set(decision);
        this.posGuardBusy.set(false);
        this.refreshActions();
      },
      error: (error) => {
        this.error.set(this.api.errorText(error, 'Unable to check POS margin'));
        this.posGuardBusy.set(false);
      }
    });
  }

  actionTransition(action: ApiRecord, transition: 'approve' | 'complete' | 'dismiss'): void {
    const id = String(action?.id || '');
    if (!id) return;
    this.actionBusy.set(id);
    this.api.post<ApiRecord>(`profit-intelligence/actions/${id}/${transition}`, {}).subscribe({
      next: () => {
        this.actionBusy.set('');
        this.refreshActions();
      },
      error: (error) => {
        this.actionBusy.set('');
        this.error.set(this.api.errorText(error, 'Unable to update profit action'));
      }
    });
  }

  refreshActions(): void {
    this.api.list<ApiRecord[]>('profit-intelligence/actions', this.filters.value).subscribe({
      next: (actions) => this.actionQueue.set(actions || []),
      error: (error) => this.error.set(this.api.errorText(error, 'Unable to refresh profit actions'))
    });
  }

  askCopilot(): void {
    this.copilotBusy.set(true);
    this.error.set('');
    this.api.post<ApiRecord>('profit-intelligence/copilot', {
      ...this.filters.value,
      question: this.filters.value.copilotQuestion || 'profit kam kyu hai?'
    }).subscribe({
      next: (response) => {
        this.copilotResponse.set(response);
        this.copilotBusy.set(false);
      },
      error: (error) => {
        this.error.set(this.api.errorText(error, 'Unable to ask Profit Copilot'));
        this.copilotBusy.set(false);
      }
    });
  }

  paise(value: unknown): number {
    return Number(value || 0) / 100;
  }

  inputPaise(value: unknown): number {
    return Math.round(Number(value || 0) * 100);
  }

  percent(value: unknown): string {
    return `${(Number(value || 0) / 100).toFixed(1)}%`;
  }

  slotLabel(value: unknown): string {
    const text = String(value || '');
    return text ? text.replace('T', ' ').slice(0, 16) : 'No slot';
  }

  severityClass(value: unknown): string {
    const text = String(value || 'green').toLowerCase();
    return text === 'high' ? 'red' : text === 'medium' ? 'amber' : text === 'low' ? 'green' : text;
  }

  priorityClass(value: unknown): string {
    const text = String(value || 'medium').toLowerCase();
    return text === 'high' ? 'red' : text === 'low' ? 'green' : 'amber';
  }
}
