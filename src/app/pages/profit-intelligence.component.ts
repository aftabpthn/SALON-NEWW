import { CommonModule, CurrencyPipe } from '@angular/common';
import { Component, OnInit, signal } from '@angular/core';
import { ReactiveFormsModule, UntypedFormBuilder } from '@angular/forms';
import { forkJoin } from 'rxjs';
import { ApiRecord, ApiService } from '../core/api.service';
import { StateComponent } from '../shared/ui/state/state.component';

@Component({
  selector: 'app-profit-intelligence',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, CurrencyPipe, StateComponent],
  template: `
    <section class="profit-workspace">
      <section class="page-title">
        <div>
          <h1>Profit Intelligence</h1>
          <p>Finance &gt; P&amp;L foundation with revenue, COGS, staff cost, expenses and net profit</p>
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
          <strong>{{ paise(metrics.revenuePaise) | currency: 'INR':'symbol':'1.0-0' }}</strong>
          <small>Invoice booked revenue</small>
        </article>
        <article>
          <span>Product Cost</span>
          <strong>{{ paise(metrics.productCostPaise) | currency: 'INR':'symbol':'1.0-0' }}</strong>
          <small>COGS / product consume</small>
        </article>
        <article>
          <span>Gross Profit</span>
          <strong>{{ paise(metrics.grossProfitPaise) | currency: 'INR':'symbol':'1.0-0' }}</strong>
          <small>{{ percent(metrics.grossMarginBps) }} gross margin</small>
        </article>
        <article>
          <span>Staff Cost</span>
          <strong>{{ paise(metrics.staffCostPaise) | currency: 'INR':'symbol':'1.0-0' }}</strong>
          <small>Payroll, payout or commission</small>
        </article>
        <article>
          <span>Operating Expenses</span>
          <strong>{{ paise(metrics.operatingExpensePaise) | currency: 'INR':'symbol':'1.0-0' }}</strong>
          <small>Rent, utilities, marketing</small>
        </article>
        <article class="net-card">
          <span>Net Profit</span>
          <strong>{{ paise(metrics.netProfitPaise) | currency: 'INR':'symbol':'1.0-0' }}</strong>
          <small>{{ percent(metrics.netMarginBps) }} net margin</small>
        </article>
      </section>

      <section class="ceo-grid" *ngIf="summary()?.ceoKpis as kpis">
        <article>
          <span>Today's Revenue</span>
          <strong>{{ paise(kpis.todayRevenuePaise) | currency: 'INR':'symbol':'1.0-0' }}</strong>
          <small>Live invoice revenue</small>
        </article>
        <article>
          <span>Today's Profit</span>
          <strong>{{ paise(kpis.todayProfitPaise) | currency: 'INR':'symbol':'1.0-0' }}</strong>
          <small>After COGS, staff and expenses</small>
        </article>
        <article>
          <span>This Month Profit</span>
          <strong>{{ paise(kpis.monthProfitPaise) | currency: 'INR':'symbol':'1.0-0' }}</strong>
          <small>Month to date net profit</small>
        </article>
        <article>
          <span>Gross / Net Margin</span>
          <strong>{{ percent(kpis.grossMarginBps) }} / {{ percent(kpis.netMarginBps) }}</strong>
          <small>Current filter margin</small>
        </article>
        <article>
          <span>Top Service</span>
          <strong>{{ kpis.topService?.label }}</strong>
          <small>{{ paise(kpis.topService?.amountPaise) | currency: 'INR':'symbol':'1.0-0' }} profit</small>
        </article>
        <article>
          <span>Top Staff</span>
          <strong>{{ kpis.topStaff?.label }}</strong>
          <small>{{ paise(kpis.topStaff?.amountPaise) | currency: 'INR':'symbol':'1.0-0' }} profit</small>
        </article>
        <article>
          <span>Top Branch</span>
          <strong>{{ kpis.topBranch?.label }}</strong>
          <small>{{ paise(kpis.topBranch?.amountPaise) | currency: 'INR':'symbol':'1.0-0' }} profit</small>
        </article>
        <article>
          <span>Top Customer</span>
          <strong>{{ kpis.topCustomer?.label }}</strong>
          <small>{{ paise(kpis.topCustomer?.amountPaise) | currency: 'INR':'symbol':'1.0-0' }} profit</small>
        </article>
        <article>
          <span>Highest Expense</span>
          <strong>{{ kpis.highestExpense?.label }}</strong>
          <small>{{ paise(kpis.highestExpense?.amountPaise) | currency: 'INR':'symbol':'1.0-0' }}</small>
        </article>
        <article>
          <span>Revenue / Employee</span>
          <strong>{{ paise(kpis.revenuePerEmployeePaise) | currency: 'INR':'symbol':'1.0-0' }}</strong>
          <small>{{ kpis.employeeCount || 0 }} active staff</small>
        </article>
        <article>
          <span>Revenue / Chair</span>
          <strong>{{ paise(kpis.revenuePerChairPaise) | currency: 'INR':'symbol':'1.0-0' }}</strong>
          <small>{{ kpis.chairCount || 0 }} active chairs</small>
        </article>
        <article>
          <span>Revenue / Hour</span>
          <strong>{{ paise(kpis.revenuePerHourPaise) | currency: 'INR':'symbol':'1.0-0' }}</strong>
          <small>{{ kpis.businessHours || 0 }} business hours</small>
        </article>
      </section>

      <section class="digital-twin-grid" *ngIf="summary()?.profitDigitalTwin as twin">
        <article class="panel twin-panel">
          <header>
            <div>
              <p class="eyebrow">Profit Digital Twin</p>
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
              <p class="eyebrow">Before vs after</p>
              <h2>Profit impact</h2>
            </div>
            <span>{{ percent(twin.netMarginBps) }} net margin</span>
          </header>
          <div class="twin-metrics">
            <div><span>Base Revenue</span><strong>{{ paise(twin.baseRevenuePaise) | currency: 'INR':'symbol':'1.0-0' }}</strong></div>
            <div><span>Sim Revenue</span><strong>{{ paise(twin.simulatedRevenuePaise) | currency: 'INR':'symbol':'1.0-0' }}</strong></div>
            <div><span>Base Profit</span><strong>{{ paise(twin.baseNetProfitPaise) | currency: 'INR':'symbol':'1.0-0' }}</strong></div>
            <div><span>Sim Profit</span><strong>{{ paise(twin.simulatedNetProfitPaise) | currency: 'INR':'symbol':'1.0-0' }}</strong></div>
            <div class="delta"><span>Profit Delta</span><strong>{{ paise(twin.profitDeltaPaise) | currency: 'INR':'symbol':'1.0-0' }}</strong></div>
            <div><span>Gross Margin</span><strong>{{ percent(twin.grossMarginBps) }}</strong></div>
          </div>
        </article>

        <article class="panel">
          <header>
            <div>
              <p class="eyebrow">Recommended scenario</p>
              <h2>{{ twin.recommendedScenario?.name }}</h2>
            </div>
          </header>
          <div class="rank-list">
            <div>
              <span>Expected profit</span>
              <strong>{{ paise(twin.recommendedScenario?.simulatedNetProfitPaise) | currency: 'INR':'symbol':'1.0-0' }}</strong>
            </div>
            <div>
              <span>Profit lift</span>
              <strong>{{ paise(twin.recommendedScenario?.profitDeltaPaise) | currency: 'INR':'symbol':'1.0-0' }}</strong>
            </div>
          </div>
        </article>
      </section>

      <section class="enterprise-grid" *ngIf="summary()?.enterpriseAnalytics as analytics">
        <article class="panel analytics-card">
          <header>
            <div>
              <p class="eyebrow">Enterprise analytics</p>
              <h2>Trend & forecast</h2>
            </div>
            <span>{{ analytics.periodGrain }}</span>
          </header>
          <div class="analytics-metrics">
            <div>
              <span>Prev period profit</span>
              <strong>{{ percent(analytics.comparisons?.previousPeriod?.profitChangeBps) }}</strong>
              <small>{{ paise(analytics.comparisons?.previousPeriod?.netProfitPaise) | currency: 'INR':'symbol':'1.0-0' }} baseline</small>
            </div>
            <div>
              <span>YoY revenue</span>
              <strong>{{ percent(analytics.comparisons?.previousYear?.revenueChangeBps) }}</strong>
              <small>{{ paise(analytics.comparisons?.previousYear?.revenuePaise) | currency: 'INR':'symbol':'1.0-0' }} baseline</small>
            </div>
            <div>
              <span>Next month forecast</span>
              <strong>{{ paise(analytics.forecast?.nextMonthProfitPaise) | currency: 'INR':'symbol':'1.0-0' }}</strong>
              <small>{{ analytics.forecast?.basis }}</small>
            </div>
            <div>
              <span>Break-even</span>
              <strong>{{ analytics.breakEven?.breakEvenDays || 0 }} days</strong>
              <small>{{ analytics.breakEven?.status }} - {{ paise(analytics.breakEven?.fixedCostPaise) | currency: 'INR':'symbol':'1.0-0' }} fixed</small>
            </div>
          </div>
        </article>

        <article class="panel">
          <header>
            <div>
              <p class="eyebrow">Profit trend</p>
              <h2>Recent P&amp;L movement</h2>
            </div>
          </header>
          <div class="mini-table">
            <div *ngFor="let row of (analytics.profitTrend || []).slice(-7)">
              <span>{{ row.date }}</span>
              <strong>{{ paise(row.netProfitPaise) | currency: 'INR':'symbol':'1.0-0' }}</strong>
              <small>{{ paise(row.revenuePaise) | currency: 'INR':'symbol':'1.0-0' }} revenue</small>
            </div>
            <div *ngIf="!(analytics.profitTrend || []).length" class="empty-row">No trend data.</div>
          </div>
        </article>

        <article class="panel">
          <header>
            <div>
              <p class="eyebrow">Revenue heatmap</p>
              <h2>Best revenue windows</h2>
            </div>
          </header>
          <div class="mini-table">
            <div *ngFor="let row of analytics.revenueHeatmap || []">
              <span>{{ row.weekday }} {{ row.hour }}:00</span>
              <strong>{{ paise(row.revenuePaise) | currency: 'INR':'symbol':'1.0-0' }}</strong>
              <small>{{ row.invoiceCount || 0 }} invoices</small>
            </div>
            <div *ngIf="!(analytics.revenueHeatmap || []).length" class="empty-row">No heatmap data.</div>
          </div>
        </article>

        <article class="panel">
          <header>
            <div>
              <p class="eyebrow">Alerts & suggestions</p>
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
              <p class="eyebrow">Income mix</p>
              <h2>Revenue sources</h2>
            </div>
            <span>{{ report.sourceHealth?.invoices || 0 }} invoices</span>
          </header>
          <div class="rank-list">
            <div *ngFor="let item of report.revenueBreakdown || []">
              <span>{{ item.label }}</span>
              <strong>{{ paise(item.amountPaise) | currency: 'INR':'symbol':'1.0-0' }}</strong>
            </div>
            <div *ngIf="!(report.revenueBreakdown || []).length" class="empty-row">No revenue rows in this period.</div>
          </div>
        </article>

        <article class="panel">
          <header>
            <div>
              <p class="eyebrow">Expense control</p>
              <h2>Top operating lines</h2>
            </div>
            <span>{{ report.sourceHealth?.expenses || 0 }} rows</span>
          </header>
          <div class="rank-list">
            <div *ngFor="let item of report.expenseBreakdown || []">
              <span>{{ item.category }}</span>
              <strong>{{ paise(item.amountPaise) | currency: 'INR':'symbol':'1.0-0' }}</strong>
            </div>
            <div *ngIf="!(report.expenseBreakdown || []).length" class="empty-row">No expense rows in this period.</div>
          </div>
        </article>

        <article class="panel source-panel">
          <header>
            <div>
              <p class="eyebrow">Data health</p>
              <h2>Calculation sources</h2>
            </div>
            <span>{{ report.period?.from }} to {{ report.period?.to }}</span>
          </header>
          <div class="source-grid">
            <div><span>COGS</span><strong>{{ report.sourceHealth?.cogsSource }}</strong></div>
            <div><span>Staff cost</span><strong>{{ report.sourceHealth?.staffCostSource }}</strong></div>
            <div><span>Collections</span><strong>{{ paise(report.metrics?.collectionsPaise) | currency: 'INR':'symbol':'1.0-0' }}</strong></div>
            <div><span>Refunds</span><strong>{{ paise(report.metrics?.refundPaise) | currency: 'INR':'symbol':'1.0-0' }}</strong></div>
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
              <p class="eyebrow">Service profit</p>
              <h2>Service wise margin</h2>
            </div>
          </header>
          <div class="table-wrap">
            <table>
              <thead><tr><th>Service</th><th>Sale</th><th>Product Cost</th><th>Staff Cost</th><th>Profit</th></tr></thead>
              <tbody>
                <tr *ngFor="let row of detail.serviceProfit || []">
                  <td><strong>{{ row.serviceName }}</strong><span>{{ row.category }}</span></td>
                  <td>{{ paise(row.revenuePaise) | currency: 'INR':'symbol':'1.0-0' }}</td>
                  <td>{{ paise(row.productCostPaise) | currency: 'INR':'symbol':'1.0-0' }}</td>
                  <td>{{ paise(row.staffCostPaise) | currency: 'INR':'symbol':'1.0-0' }}</td>
                  <td><strong>{{ paise(row.netProfitPaise) | currency: 'INR':'symbol':'1.0-0' }}</strong></td>
                </tr>
                <tr *ngIf="!(detail.serviceProfit || []).length"><td colspan="5" class="empty-cell">No service profit rows.</td></tr>
              </tbody>
            </table>
          </div>
        </article>

        <article class="table-panel">
          <header>
            <div>
              <p class="eyebrow">Staff profit</p>
              <h2>Staff wise profitability</h2>
            </div>
          </header>
          <div class="table-wrap">
            <table>
              <thead><tr><th>Staff</th><th>Revenue</th><th>Commission</th><th>Product Usage</th><th>Net Profit</th><th>Avg Ticket</th></tr></thead>
              <tbody>
                <tr *ngFor="let row of detail.staffProfit || []">
                  <td><strong>{{ row.staffName }}</strong></td>
                  <td>{{ paise(row.revenuePaise) | currency: 'INR':'symbol':'1.0-0' }}</td>
                  <td>{{ paise(row.staffCostPaise) | currency: 'INR':'symbol':'1.0-0' }}</td>
                  <td>{{ paise(row.productCostPaise) | currency: 'INR':'symbol':'1.0-0' }}</td>
                  <td><strong>{{ paise(row.netProfitPaise) | currency: 'INR':'symbol':'1.0-0' }}</strong></td>
                  <td>{{ paise(row.avgTicketPaise) | currency: 'INR':'symbol':'1.0-0' }}</td>
                </tr>
                <tr *ngIf="!(detail.staffProfit || []).length"><td colspan="6" class="empty-cell">No staff profit rows.</td></tr>
              </tbody>
            </table>
          </div>
        </article>

        <article class="table-panel">
          <header>
            <div>
              <p class="eyebrow">Branch P&amp;L</p>
              <h2>Branch wise profit</h2>
            </div>
          </header>
          <div class="table-wrap">
            <table>
              <thead><tr><th>Branch</th><th>Revenue</th><th>COGS</th><th>Staff</th><th>Expenses</th><th>Net</th></tr></thead>
              <tbody>
                <tr *ngFor="let row of detail.branchProfit || []">
                  <td><strong>{{ row.branchName }}</strong><span>{{ row.invoiceCount }} invoices</span></td>
                  <td>{{ paise(row.revenuePaise) | currency: 'INR':'symbol':'1.0-0' }}</td>
                  <td>{{ paise(row.productCostPaise) | currency: 'INR':'symbol':'1.0-0' }}</td>
                  <td>{{ paise(row.staffCostPaise) | currency: 'INR':'symbol':'1.0-0' }}</td>
                  <td>{{ paise(row.operatingExpensePaise) | currency: 'INR':'symbol':'1.0-0' }}</td>
                  <td><strong>{{ paise(row.netProfitPaise) | currency: 'INR':'symbol':'1.0-0' }}</strong></td>
                </tr>
                <tr *ngIf="!(detail.branchProfit || []).length"><td colspan="6" class="empty-cell">No branch profit rows.</td></tr>
              </tbody>
            </table>
          </div>
        </article>

        <article class="table-panel">
          <header>
            <div>
              <p class="eyebrow">Category profit</p>
              <h2>Category wise margin</h2>
            </div>
          </header>
          <div class="table-wrap">
            <table>
              <thead><tr><th>Category</th><th>Revenue</th><th>Product Cost</th><th>Staff Cost</th><th>Profit</th><th>Margin</th></tr></thead>
              <tbody>
                <tr *ngFor="let row of detail.categoryProfit || []">
                  <td><strong>{{ row.category }}</strong><span>{{ row.itemCount }} items</span></td>
                  <td>{{ paise(row.revenuePaise) | currency: 'INR':'symbol':'1.0-0' }}</td>
                  <td>{{ paise(row.productCostPaise) | currency: 'INR':'symbol':'1.0-0' }}</td>
                  <td>{{ paise(row.staffCostPaise) | currency: 'INR':'symbol':'1.0-0' }}</td>
                  <td><strong>{{ paise(row.netProfitPaise) | currency: 'INR':'symbol':'1.0-0' }}</strong></td>
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
              <p class="eyebrow">Customer profit</p>
              <h2>Customer profitability</h2>
            </div>
          </header>
          <div class="table-wrap">
            <table>
              <thead><tr><th>Customer</th><th>Revenue</th><th>Product Cost</th><th>Discounts</th><th>Profit</th><th>Visits</th><th>Avg Bill</th></tr></thead>
              <tbody>
                <tr *ngFor="let row of detail.customerProfit || []">
                  <td><strong>{{ row.clientName }}</strong><span>Lifetime {{ paise(row.lifetimeRevenuePaise) | currency: 'INR':'symbol':'1.0-0' }}</span></td>
                  <td>{{ paise(row.revenuePaise) | currency: 'INR':'symbol':'1.0-0' }}</td>
                  <td>{{ paise(row.productCostPaise) | currency: 'INR':'symbol':'1.0-0' }}</td>
                  <td>{{ paise(row.discountPaise) | currency: 'INR':'symbol':'1.0-0' }}</td>
                  <td><strong>{{ paise(row.netProfitPaise) | currency: 'INR':'symbol':'1.0-0' }}</strong></td>
                  <td>{{ row.visits || 0 }}</td>
                  <td>{{ paise(row.avgBillPaise) | currency: 'INR':'symbol':'1.0-0' }}</td>
                </tr>
                <tr *ngIf="!(detail.customerProfit || []).length"><td colspan="7" class="empty-cell">No customer profit rows.</td></tr>
              </tbody>
            </table>
          </div>
        </article>

        <article class="table-panel">
          <header>
            <div>
              <p class="eyebrow">Membership profit</p>
              <h2>Membership value</h2>
            </div>
          </header>
          <div class="table-wrap">
            <table>
              <thead><tr><th>Plan</th><th>Sales</th><th>Redeemed</th><th>Product Cost</th><th>Liability</th><th>Profit</th><th>Sold</th></tr></thead>
              <tbody>
                <tr *ngFor="let row of detail.membershipProfit || []">
                  <td><strong>{{ row.planName }}</strong></td>
                  <td>{{ paise(row.soldValuePaise) | currency: 'INR':'symbol':'1.0-0' }}</td>
                  <td>{{ paise(row.redeemedValuePaise) | currency: 'INR':'symbol':'1.0-0' }}</td>
                  <td>{{ paise(row.productCostPaise) | currency: 'INR':'symbol':'1.0-0' }}</td>
                  <td>{{ paise(row.remainingLiabilityPaise) | currency: 'INR':'symbol':'1.0-0' }}</td>
                  <td><strong>{{ paise(row.netProfitPaise) | currency: 'INR':'symbol':'1.0-0' }}</strong></td>
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
              <p class="eyebrow">Package profit</p>
              <h2>Package value</h2>
            </div>
          </header>
          <div class="table-wrap">
            <table>
              <thead><tr><th>Package</th><th>Sold Value</th><th>Redeemed Value</th><th>Product Cost</th><th>Remaining Balance</th><th>Net Profit</th><th>Redeemed</th></tr></thead>
              <tbody>
                <tr *ngFor="let row of detail.packageProfit || []">
                  <td><strong>{{ row.planName }}</strong></td>
                  <td>{{ paise(row.soldValuePaise) | currency: 'INR':'symbol':'1.0-0' }}</td>
                  <td>{{ paise(row.redeemedValuePaise) | currency: 'INR':'symbol':'1.0-0' }}</td>
                  <td>{{ paise(row.productCostPaise) | currency: 'INR':'symbol':'1.0-0' }}</td>
                  <td>{{ paise(row.remainingLiabilityPaise) | currency: 'INR':'symbol':'1.0-0' }}</td>
                  <td><strong>{{ paise(row.netProfitPaise) | currency: 'INR':'symbol':'1.0-0' }}</strong></td>
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
    .profit-workspace { display: grid; gap: 0; min-height: calc(100vh - 20px); background: #f6f8fb; color: #1d2430; }
    .page-title { display: flex; align-items: end; justify-content: space-between; gap: 16px; padding: 14px; background: #fff; border-bottom: 1px solid #d9e1ea; }
    .page-title h1, h2 { margin: 0; letter-spacing: 0; }
    .page-title p { margin: 6px 0 0; color: #38506d; font-size: 13px; }
    form { display: flex; align-items: end; gap: 8px; flex-wrap: wrap; }
    label { display: grid; gap: 5px; color: #5d6f87; font-size: 11px; font-weight: 900; text-transform: uppercase; }
    input { min-height: 34px; border: 1px solid #bdcfe2; border-radius: 3px; padding: 7px 10px; font: inherit; color: #1d2430; background: #fff; }
    .primary-button { min-height: 34px; border: 1px solid #0f8a7d; border-radius: 3px; padding: 7px 12px; background: #0f8a7d; color: #fff; font-weight: 900; cursor: pointer; }
    app-state { display: block; margin: 12px 14px 0; }
    .metrics-grid { display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)); gap: 0; padding: 0 14px 12px; background: #fff; border-bottom: 1px solid #d9e1ea; }
    .metrics-grid article { display: grid; gap: 3px; min-height: 76px; padding: 12px 14px; border: 1px solid #d9e1ea; border-left: 0; border-top: 3px solid #0a78b6; }
    .metrics-grid article:first-child { border-left: 1px solid #d9e1ea; }
    .metrics-grid .net-card { border-top-color: #0f8a7d; }
    .metrics-grid span, .metrics-grid small, header > span { color: #64748b; font-size: 12px; font-weight: 800; }
    .metrics-grid strong { font-size: 20px; line-height: 1; white-space: nowrap; }
    .ceo-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px; padding: 12px 14px; background: #eef4f8; border-bottom: 1px solid #d9e1ea; }
    .ceo-grid article { display: grid; gap: 4px; min-width: 0; min-height: 88px; padding: 11px 12px; background: #fff; border: 1px solid #d9e1ea; border-top: 3px solid #143d59; }
    .ceo-grid span, .ceo-grid small { color: #64748b; font-size: 12px; font-weight: 800; }
    .ceo-grid strong { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 18px; line-height: 1.1; }
    .digital-twin-grid { display: grid; grid-template-columns: 1.4fr 1fr 0.8fr; gap: 10px; padding: 12px 14px; background: #fff; border-bottom: 1px solid #d9e1ea; }
    .twin-panel { border-top: 3px solid #8a6d0f; }
    .scenario-form { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); align-items: end; gap: 8px; }
    .scenario-form .primary-button { width: 100%; }
    .twin-metrics { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
    .twin-metrics div { display: grid; gap: 4px; border: 1px solid #d9e1ea; padding: 10px; }
    .twin-metrics .delta { border-top: 3px solid #0f8a7d; }
    .twin-metrics span { color: #64748b; font-size: 12px; font-weight: 800; }
    .twin-metrics strong { font-size: 18px; white-space: nowrap; }
    .enterprise-grid { display: grid; grid-template-columns: 1.2fr 1fr 1fr 1fr; gap: 10px; padding: 12px 14px; background: #f6f8fb; border-bottom: 1px solid #d9e1ea; }
    .analytics-card { border-top: 3px solid #0f8a7d; }
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
      .digital-twin-grid, .enterprise-grid, .insight-grid, .drilldown-grid, .retention-grid { grid-template-columns: 1fr; }
      .scenario-form { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    }
    @media (max-width: 760px) {
      .page-title, header { align-items: flex-start; flex-direction: column; }
      .metrics-grid, .ceo-grid, .source-grid { grid-template-columns: 1fr; }
      .scenario-form, .twin-metrics { grid-template-columns: 1fr; }
      .metrics-grid article, .metrics-grid article:first-child { border-left: 1px solid #d9e1ea; }
    }
  `]
})
export class ProfitIntelligenceComponent implements OnInit {
  readonly summary = signal<ApiRecord | null>(null);
  readonly breakdown = signal<ApiRecord | null>(null);
  readonly loading = signal(false);
  readonly error = signal('');
  readonly today = new Date().toISOString().slice(0, 10);
  readonly filters = this.fb.group({
    from: [`${this.today.slice(0, 7)}-01`],
    to: [this.today],
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
      detail: this.api.list<ApiRecord>('profit-intelligence/breakdown', this.filters.value)
    }).subscribe({
      next: ({ report, detail }) => {
        this.summary.set(report);
        this.breakdown.set(detail);
        this.loading.set(false);
      },
      error: (error) => {
        this.error.set(this.api.errorText(error, 'Unable to load Profit Intelligence'));
        this.loading.set(false);
      }
    });
  }

  paise(value: unknown): number {
    return Number(value || 0) / 100;
  }

  percent(value: unknown): string {
    return `${(Number(value || 0) / 100).toFixed(1)}%`;
  }
}
