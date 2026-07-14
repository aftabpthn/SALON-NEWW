import { CommonModule } from '@angular/common';
import { Component, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { catchError, forkJoin, of } from 'rxjs';
import { AuthSessionService } from '../core/auth-session.service';
import { grantsAllow, staticGrantsForRole } from '../core/permission.guard';
import { routePermissionForPath } from '../core/access-rules';
import { AppStateService } from '../core/state/app-state.service';
import { ApiRecord, ApiService } from '../core/api.service';
import { StateComponent } from '../shared/ui/state/state.component';
import { AuraMoneyPipe } from '../shared/pipes/aura-money.pipe';

type MatrixCell = { key: string; label: string; tone?: 'section' | 'primary' | 'normal' };
type MatrixColumn = { key: string; label: string; from?: string; to?: string };
type ReportTab = 'summary' | 'payments' | 'daily-sheet' | 'daily-revenue' | 'member-sales' | 'sales-tax' | 'wallet-ledger';
type PaymentDistributionCard = { key: string; filterKey: string; label: string; value: string };
type PaymentDistributionRow = {
  date: string;
  invoiceDateValue: string;
  name: string;
  contact: string;
  invoiceNo: string;
  invoiceId: string;
  price: number;
  paymentMode: string;
  paymentModeKey: string;
  transactionId: string;
  paymentDate: string;
  paymentDateValue: string;
  notes: string;
};
type DailySheetSummary = {
  totalBills: number;
  billAverage: number;
  grossSale: number;
  netSale: number;
  totalReceived: number;
  pendingUnpaid: number;
  discount: number;
  couponDiscount: number;
  membershipDiscount: number;
  gstTax: number;
  expenses: number;
  staffTips: number;
};
type DailyRevenueRow = {
  dateKey: string;
  dateLabel: string;
  totalBillCount: number;
  serviceSale: number;
  productSale: number;
  packageSale: number;
  membershipSale: number;
  giftCardSale: number;
  walletPrepaidUsed: number;
  grossSale: number;
  discount: number;
  couponDiscount: number;
  membershipDiscount: number;
  netSale: number;
  gst: number;
  receivedAmount: number;
  pendingDueAmount: number;
  expenses: number;
  refundReturn: number;
  finalCashInValue: number;
};
type MemberSalesRow = {
  clientId: string;
  clientName: string;
  phone: string;
  membershipStatus: 'Active member' | 'Expired member' | 'Non-member';
  activePlanName: string;
  totalVisits: number;
  totalSale: number;
  paidAmount: number;
  pendingAmount: number;
  discountUsed: number;
  lastVisitDate: string;
  suggestedAction: string;
  isMember: boolean;
  isExpiredMember: boolean;
};
type SalesTaxRow = {
  date: string;
  dateValue: string;
  invoiceNo: string;
  clientName: string;
  phone: string;
  gstin: string;
  staffCashier: string;
  actualPrice: number;
  discount: number;
  couponDiscount: number;
  membershipDiscount: number;
  taxableAmount: number;
  gstRate: number;
  cgst: number;
  sgst: number;
  igst: number;
  totalGst: number;
  invoiceTotal: number;
  paid: number;
  due: number;
  paymentMode: string;
  taxStatus: string;
  itemType: string;
};
type WalletLedgerRow = ApiRecord & {
  id: string;
  date: string;
  time: string;
  clientId: string;
  clientName: string;
  clientPhone: string;
  branchName: string;
  transactionType: string;
  creditAmount: number;
  debitAmount: number;
  balanceAfter: number;
  reason: string;
  referenceLabel: string;
  invoiceId: string;
  invoiceNumber: string;
  paymentMode: string;
  addedBy: string;
  source: string;
};

@Component({
  selector: 'app-financial-summary-report',
  standalone: true,
  imports: [AuraMoneyPipe, CommonModule, FormsModule, RouterLink, StateComponent],
  template: `
    <section class="financial-summary-page inner-page-shell">
      <div class="module-hero financial-hero inner-page-header">
        <div>
          <h2>Financial Summary</h2>
        </div>
        <div class="hero-actions inner-action-bar">
          <a class="ghost-button" routerLink="/reports">Reports</a>
          <a class="ghost-button" routerLink="/reports/invoices">Invoice reports</a>
          <a class="ghost-button" routerLink="/finance">Finance</a>
          <a class="ghost-button" routerLink="/pos/tips">Tip Register</a>
          <button class="ghost-button" type="button" (click)="exportCsv()" [disabled]="exportDisabled()">Export</button>
          <button class="ghost-button icon-action" type="button" (click)="printReport()" title="Print financial summary">Print</button>
        </div>
      </div>

      <div class="report-tabs inner-action-bar" role="tablist" aria-label="Financial report views">
        <button type="button" [class.active]="activeTab === 'summary'" (click)="setActiveTab('summary')">Financial Summary</button>
        <button type="button" [class.active]="activeTab === 'payments'" (click)="setActiveTab('payments')">Payment Distributions</button>
        <button type="button" [class.active]="activeTab === 'daily-sheet'" (click)="setActiveTab('daily-sheet')">Daily Sheet</button>
        <button type="button" [class.active]="activeTab === 'daily-revenue'" (click)="setActiveTab('daily-revenue')">Daily Revenue</button>
        <button type="button" [class.active]="activeTab === 'member-sales'" (click)="setActiveTab('member-sales')">Member vs Non-Member Sales</button>
        <button type="button" [class.active]="activeTab === 'sales-tax'" (click)="setActiveTab('sales-tax')">Sales Tax / GST</button>
        <button type="button" [class.active]="activeTab === 'wallet-ledger'" (click)="setActiveTab('wallet-ledger')">Wallet / Ewallet Ledger</button>
      </div>

      <section class="panel filter-panel">
        <label class="field" *ngIf="activeTab === 'summary'">
          <span>View</span>
          <select [(ngModel)]="periodMode">
            <option value="month">Month</option>
            <option value="quarter">Quarter</option>
          </select>
        </label>
        <label class="field" *ngIf="activeTab === 'payments'">
          <span>Type</span>
          <select [(ngModel)]="paymentTypeFilter">
            <option value="">All Type</option>
            <option *ngFor="let type of paymentTypeOptions()" [value]="type.key">{{ type.label }}</option>
          </select>
        </label>
        <label class="field" *ngIf="activeTab === 'payments'">
          <span>Date basis</span>
          <select [(ngModel)]="paymentDateBasis">
            <option value="payment">By Payment Date</option>
            <option value="invoice">By Invoice Date</option>
          </select>
        </label>
        <label class="field" *ngIf="activeTab === 'daily-sheet'">
          <span>Sheet date</span>
          <input type="date" [(ngModel)]="dailySheetDate" (ngModelChange)="setDailySheetDate($event)" />
        </label>
        <label class="field" *ngIf="activeTab === 'member-sales'">
          <span>Client type</span>
          <select [(ngModel)]="memberClientTypeFilter">
            <option value="all">All</option>
            <option value="members">Members</option>
            <option value="non-members">Non-members</option>
          </select>
        </label>
        <label class="field" *ngIf="activeTab === 'member-sales'">
          <span>Search</span>
          <input type="search" [(ngModel)]="memberSalesSearch" placeholder="Client, phone or membership plan" />
        </label>
        <label class="field" *ngIf="activeTab === 'wallet-ledger'">
          <span>Client</span>
          <input type="search" [(ngModel)]="walletLedgerSearch" placeholder="Client, phone or reference" />
        </label>
        <label class="field" *ngIf="activeTab === 'wallet-ledger'">
          <span>Transaction type</span>
          <select [(ngModel)]="walletLedgerTypeFilter">
            <option value="">All types</option>
            <option value="credit">Credit</option>
            <option value="debit">Debit</option>
            <option value="refund">Refund</option>
            <option value="adjustment">Adjustment</option>
            <option value="overpayment">Overpayment</option>
            <option value="membership_wallet">Membership wallet</option>
          </select>
        </label>
        <label class="field" *ngIf="activeTab === 'wallet-ledger'">
          <span>Source</span>
          <select [(ngModel)]="walletLedgerSourceFilter">
            <option value="">All sources</option>
            <option value="POS">POS</option>
            <option value="manual">Manual</option>
            <option value="membership">Membership</option>
            <option value="package">Package</option>
            <option value="refund">Refund</option>
          </select>
        </label>
        <label class="field" *ngIf="activeTab === 'wallet-ledger'">
          <span>Payment mode</span>
          <select [(ngModel)]="walletLedgerPaymentModeFilter">
            <option value="">All modes</option>
            <option value="cash">Cash</option>
            <option value="upi">UPI</option>
            <option value="card">Card</option>
            <option value="wallet">Wallet</option>
          </select>
        </label>
        <label class="field" *ngIf="activeTab === 'wallet-ledger'">
          <span>Risk level</span>
          <select [(ngModel)]="walletLedgerRiskFilter">
            <option value="">All risks</option>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </select>
        </label>
        <label class="field">
          <span>From</span>
          <input type="date" [(ngModel)]="from" />
        </label>
        <label class="field">
          <span>To</span>
          <input type="date" [(ngModel)]="to" />
        </label>
        <div class="branch-context-card">
          <span>Header branch</span>
          <strong>{{ branchLabel() }}</strong>
        </div>
        <button class="primary-button" type="button" (click)="load()">Go</button>
      </section>

      <app-state [loading]="loading()" [error]="error()"></app-state>

      <ng-container *ngIf="!loading() && !error() && activeTab === 'wallet-ledger'">
        <section class="panel report-section">
          <div class="section-title inner-action-bar">
            <div>
              <h3>Wallet / Ewallet Ledger</h3>
              <p>{{ dateLabel(from) }} to {{ dateLabel(to) }} Â· credit, debit, balance-after and abuse audit.</p>
            </div>
            <div class="hero-actions inner-action-bar">
              <button class="ghost-button" type="button" (click)="exportCsv()" [disabled]="!walletLedgerRows().length">Ledger CSV</button>
              <button class="ghost-button" type="button" (click)="exportWalletOwnerPdf()" [disabled]="!walletLedgerRows().length">Owner PDF</button>
              <button class="ghost-button" type="button" (click)="exportWalletAuditPdf()" [disabled]="!walletLedgerAlerts().length">Audit PDF</button>
            </div>
          </div>

          <div class="summary-strip">
            <article *ngFor="let card of walletLedgerCards()">
              <span>{{ card.label }}</span>
              <strong>{{ card.value }}</strong>
              <small>{{ card.detail }}</small>
            </article>
          </div>

          <div class="financial-table-wrap inner-table-wrap" *ngIf="walletLedgerRows().length; else noWalletLedgerRows">
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Time</th>
                  <th>Client</th>
                  <th>Phone</th>
                  <th>Branch</th>
                  <th>Type</th>
                  <th class="right">Credit</th>
                  <th class="right">Debit</th>
                  <th class="right">Balance after</th>
                  <th>Reason</th>
                  <th>Reference</th>
                  <th>Mode</th>
                  <th>Added by</th>
                  <th>Source</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                <tr *ngFor="let row of walletLedgerRows()">
                  <td>{{ row.date }}</td>
                  <td>{{ row.time }}</td>
                  <td><strong>{{ row.clientName }}</strong></td>
                  <td>{{ row.clientPhone || '-' }}</td>
                  <td>{{ row.branchName || '-' }}</td>
                  <td><span class="badge">{{ row.transactionType }}</span></td>
                  <td class="right">{{ row.creditAmount | auraMoney:'1.0-0' }}</td>
                  <td class="right">{{ row.debitAmount | auraMoney:'1.0-0' }}</td>
                  <td class="right"><strong>{{ row.balanceAfter | auraMoney:'1.0-0' }}</strong></td>
                  <td>{{ row.reason || '-' }}</td>
                  <td>{{ row.referenceLabel || '-' }}</td>
                  <td>{{ row.paymentMode || '-' }}</td>
                  <td>{{ row.addedBy || '-' }}</td>
                  <td>{{ row.source || '-' }}</td>
                  <td>
                    <a class="row-action" *ngIf="row.clientId" [routerLink]="'/clients/' + row.clientId">Client</a>
                    <ng-container *ngIf="canAccessPath('/pos/invoices')">
                      <a class="row-action" *ngIf="row.invoiceId || row.invoiceNumber" routerLink="/pos/invoices" [queryParams]="invoiceQueryParams(row.invoiceNumber || row.invoiceId)">Invoice</a>
                    </ng-container>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <ng-template #noWalletLedgerRows>
            <div class="empty-panel compact-empty">
              <strong>No wallet ledger rows.</strong>
              <span>Selected date/filter range me wallet credit/debit activity nahi mili.</span>
            </div>
          </ng-template>
        </section>

        <section class="panel daily-revenue-alerts">
          <div class="mini-section-title"><span>Abuse / audit alerts</span><strong>Wallet control signals</strong></div>
          <div class="financial-table-wrap inner-table-wrap" *ngIf="walletLedgerAlerts().length; else noWalletAlerts">
            <table>
              <thead>
                <tr>
                  <th>Risk</th>
                  <th>Alert type</th>
                  <th>Client</th>
                  <th class="right">Amount</th>
                  <th>Staff/user</th>
                  <th>Reference</th>
                  <th>Suggested action</th>
                </tr>
              </thead>
              <tbody>
                <tr *ngFor="let alert of walletLedgerAlerts()">
                  <td><span class="badge">{{ alert['riskLevel'] || 'medium' }}</span></td>
                  <td><strong>{{ alert['alertType'] }}</strong></td>
                  <td>{{ alert['clientName'] || '-' }}</td>
                  <td class="right">{{ (+alert['amount'] || 0) | auraMoney:'1.0-0' }}</td>
                  <td>{{ alert['staffUser'] || '-' }}</td>
                  <td>{{ alert['reference'] || '-' }}</td>
                  <td>{{ alert['suggestedAction'] || 'Review wallet ledger' }}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <ng-template #noWalletAlerts>
            <div class="empty-panel compact-empty">
              <strong>No wallet abuse alerts.</strong>
              <span>Manual high credit, negative balance, debit without invoice aur stale wallet risks clear hain.</span>
            </div>
          </ng-template>
        </section>
      </ng-container>

      <ng-container *ngIf="!loading() && !error() && activeTab === 'summary'">
        <div class="summary-strip">
          <article>
            <span>Total Sales</span>
            <strong>{{ totalFor('totalSales') | auraMoney:'1.0-0' }}</strong>
            <small>{{ invoiceCount() }} bills</small>
          </article>
          <article>
            <span>Paid</span>
            <strong>{{ totalFor('paid') | auraMoney:'1.0-0' }}</strong>
          </article>
          <article>
            <span>Balance</span>
            <strong>{{ totalFor('balance') | auraMoney:'1.0-0' }}</strong>
          </article>
          <article>
            <span>Taxes</span>
            <strong>{{ totalFor('taxes') | auraMoney:'1.0-0' }}</strong>
          </article>
          <article>
            <span>Expenses</span>
            <strong>{{ totalFor('expenses') | auraMoney:'1.0-0' }}</strong>
          </article>
          <article>
            <span>Net Cashflow</span>
            <strong>{{ netCashflow() | auraMoney:'1.0-0' }}</strong>
          </article>
        </div>

        <section class="panel matrix-panel">
          <div class="section-title inner-action-bar">
            <div>
              <h2>Sales and collection matrix</h2>
              <p>{{ dateLabel(from) }} to {{ dateLabel(to) }} Â· {{ matrixColumns().length - 1 }} {{ periodMode === 'quarter' ? 'quarter(s)' : 'month(s)' }}</p>
            </div>
            <div class="hero-actions inner-action-bar">
              <span class="badge">{{ branchLabel() }}</span>
              <span class="badge">{{ periodModeLabel() }}</span>
            </div>
          </div>

          <div class="financial-table-wrap inner-table-wrap">
            <table>
              <thead>
                <tr>
                  <th class="row-head">Sales</th>
                  <th *ngFor="let column of matrixColumns()" class="right">{{ column.label }}</th>
                </tr>
              </thead>
              <tbody>
                <tr *ngFor="let row of matrixRows()" [class.section-row]="row.tone === 'section'" [class.primary-row]="row.tone === 'primary'">
                  <td>{{ row.label }}</td>
                  <td *ngFor="let column of matrixColumns()" class="right">{{ valueFor(row.key, column.key) | number: '1.2-2' }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        <section class="panel insight-panel">
          <div class="section-title inner-action-bar">
            <div>
              <h2>Financial control signals</h2>
            </div>
          </div>
          <div class="insight-grid">
            <article>
              <span>Collection rate</span>
              <strong>{{ collectionRate() }}%</strong>
            </article>
            <article>
              <span>Discount leakage</span>
              <strong>{{ discountRate() }}%</strong>
            </article>
            <article>
              <span>Top mode</span>
              <strong>{{ topPaymentMode() }}</strong>
            </article>
            <article>
              <span>Pending risk</span>
              <strong>{{ pendingRiskLabel() }}</strong>
              <small>{{ totalFor('balance') | auraMoney:'1.0-0' }} balance</small>
            </article>
          </div>
        </section>
      </ng-container>

      <ng-container *ngIf="!loading() && !error() && activeTab === 'payments'">
        <section class="payment-distribution-stack">
          <div class="payment-card-strip">
            <button
              type="button"
              *ngFor="let card of paymentDistributionCards()"
              [class.active]="card.filterKey === paymentTypeFilter"
              [attr.aria-pressed]="card.filterKey === paymentTypeFilter"
              (click)="selectPaymentDistributionCard(card)"
            >
              <strong>{{ card.value }}</strong>
              <span>{{ card.label }}</span>
            </button>
          </div>

          <section class="panel payment-table-panel">
            <div class="section-title inner-action-bar">
              <div>
                <h2>{{ selectedPaymentReportTitle() }}</h2>
                <p>{{ dateLabel(from) }} to {{ dateLabel(to) }} Â· {{ paymentDistributionRows().length }} payment row(s)</p>
              </div>
              <div class="payment-actions">
                <label class="search-field">
                  <span class="sr-only">Search payment rows</span>
                  <input [(ngModel)]="paymentSearch" placeholder="Name, phone or invoice" />
                </label>
                <button class="ghost-button" type="button" (click)="exportCsv()" [disabled]="!paymentDistributionRows().length">Download</button>
              </div>
            </div>

            <div class="payment-table-wrap inner-table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Name</th>
                    <th>Contact</th>
                    <th>Invoice No</th>
                    <th class="right">Price</th>
                    <th>Payment Modes</th>
                    <th>Transaction ID</th>
                    <th>Payment Date</th>
                    <th>Notes</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  <tr *ngFor="let row of visiblePaymentDistributionRows()">
                    <td>{{ row.date }}</td>
                    <td>{{ row.name }}</td>
                    <td>{{ row.contact }}</td>
                    <td>{{ row.invoiceNo }}</td>
                    <td class="right">{{ row.price | number: '1.2-2' }}</td>
                    <td><span class="mode-pill">{{ row.paymentMode }}</span></td>
                    <td>{{ row.transactionId || '-' }}</td>
                    <td>{{ row.paymentDate }}</td>
                    <td>{{ row.notes || '-' }}</td>
                    <td>
                      <a class="row-action" routerLink="/pos/invoices" [queryParams]="invoiceQueryParams(row.invoiceNo || row.invoiceId)" *ngIf="canAccessPath('/pos/invoices')">Open</a>
                    </td>
                  </tr>
                  <tr *ngIf="!visiblePaymentDistributionRows().length">
                    <td colspan="10" class="empty-cell">No payment distribution rows found.</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>
        </section>
      </ng-container>

      <ng-container *ngIf="!loading() && !error() && activeTab === 'daily-sheet'">
        <section class="daily-sheet-stack">
          <div class="section-title daily-sheet-title">
            <div>
              <h2>Daily Sheet / EOD Financial Control</h2>
              <p>{{ dateLabel(from) }} to {{ dateLabel(to) }} Â· {{ branchLabel() }}</p>
            </div>
            <div class="hero-actions inner-action-bar">
              <span class="badge">{{ dailySheetSummary().totalBills }} bill(s)</span>
              <button class="ghost-button" type="button" (click)="exportCsv()" [disabled]="!dailySheetSummary().totalBills">Export CSV</button>
              <button class="ghost-button" type="button" (click)="exportDailySheetPdf()" [disabled]="!dailySheetSummary().totalBills">Owner PDF</button>
            </div>
          </div>

          <div class="daily-sheet-kpis">
            <article><span>Total bills</span><strong>{{ dailySheetSummary().totalBills }}</strong></article>
            <article><span>Bill average</span><strong>{{ dailySheetSummary().billAverage | auraMoney:'1.0-0' }}</strong></article>
            <article><span>Gross sale</span><strong>{{ dailySheetSummary().grossSale | auraMoney:'1.0-0' }}</strong></article>
            <article><span>Net sale</span><strong>{{ dailySheetSummary().netSale | auraMoney:'1.0-0' }}</strong></article>
            <article><span>Total received</span><strong>{{ dailySheetSummary().totalReceived | auraMoney:'1.0-0' }}</strong></article>
            <article><span>Pending / unpaid</span><strong>{{ dailySheetSummary().pendingUnpaid | auraMoney:'1.0-0' }}</strong></article>
            <article><span>Discount</span><strong>{{ dailySheetSummary().discount | auraMoney:'1.0-0' }}</strong></article>
            <article><span>Coupon discount</span><strong>{{ dailySheetSummary().couponDiscount | auraMoney:'1.0-0' }}</strong></article>
            <article><span>Membership discount</span><strong>{{ dailySheetSummary().membershipDiscount | auraMoney:'1.0-0' }}</strong></article>
            <article><span>GST / tax</span><strong>{{ dailySheetSummary().gstTax | auraMoney:'1.0-0' }}</strong></article>
            <article><span>Expenses</span><strong>{{ dailySheetSummary().expenses | auraMoney:'1.0-0' }}</strong></article>
            <article><span>Staff tips</span><strong>{{ dailySheetSummary().staffTips | auraMoney:'1.0-0' }}</strong></article>
          </div>

          <div class="daily-sheet-grid">
            <section class="panel daily-sheet-card aura-card">
              <div class="mini-section-title"><span>Item details</span><strong>Sale type breakup</strong></div>
              <table>
                <thead><tr><th>Item name</th><th class="right">Item count</th><th class="right">Received</th><th class="right">Total</th></tr></thead>
                <tbody>
                  <tr *ngFor="let row of dailySheetItemRows()">
                    <td>{{ row['label'] }}</td>
                    <td class="right">{{ row['count'] }}</td>
                    <td class="right">{{ row['received'] | number:'1.2-2' }}</td>
                    <td class="right">{{ row['total'] | number:'1.2-2' }}</td>
                  </tr>
                </tbody>
              </table>
            </section>

            <section class="panel daily-sheet-card aura-card">
              <div class="mini-section-title"><span>Payment mode truth</span><strong>Total received</strong></div>
              <table>
                <thead><tr><th>Mode</th><th class="right">Count</th><th class="right">Amount</th></tr></thead>
                <tbody>
                  <tr *ngFor="let row of dailySheetPaymentRows()">
                    <td>{{ row['label'] }}</td>
                    <td class="right">{{ row['count'] }}</td>
                    <td class="right">{{ row['amount'] | number:'1.2-2' }}</td>
                  </tr>
                </tbody>
              </table>
            </section>

            <section class="panel daily-sheet-card aura-card">
              <div class="mini-section-title"><span>Reconciliation</span><strong>Cash + audit control</strong></div>
              <table>
                <thead><tr><th>Check</th><th class="right">Value</th><th>Note</th></tr></thead>
                <tbody>
                  <tr *ngFor="let row of dailySheetReconciliationRows()">
                    <td>{{ row['label'] }}</td>
                    <td class="right">{{ row['value'] | number:'1.2-2' }}</td>
                    <td>{{ row['note'] }}</td>
                  </tr>
                </tbody>
              </table>
            </section>

            <section class="panel daily-sheet-card aura-card">
              <div class="mini-section-title"><span>Staff-wise daily sheet</span><strong>Accountability</strong></div>
              <table>
                <thead><tr><th>Staff</th><th class="right">Service sale</th><th class="right">Product sale</th><th class="right">Discount</th><th class="right">Tips</th><th class="right">Unpaid</th><th class="right">Commission base</th></tr></thead>
                <tbody>
                  <tr *ngFor="let row of dailySheetStaffRows()">
                    <td>{{ row['staffName'] }}</td>
                    <td class="right">{{ row['serviceSale'] | number:'1.2-2' }}</td>
                    <td class="right">{{ row['productSale'] | number:'1.2-2' }}</td>
                    <td class="right">{{ row['discountGiven'] | number:'1.2-2' }}</td>
                    <td class="right">{{ row['tips'] | number:'1.2-2' }}</td>
                    <td class="right">{{ row['unpaidAmount'] | number:'1.2-2' }}</td>
                    <td class="right">{{ row['commissionBase'] | number:'1.2-2' }}</td>
                  </tr>
                  <tr *ngIf="!dailySheetStaffRows().length">
                    <td colspan="7" class="empty-cell">No staff attribution found for selected day.</td>
                  </tr>
                </tbody>
              </table>
            </section>
          </div>
        </section>
      </ng-container>

      <ng-container *ngIf="!loading() && !error() && activeTab === 'daily-revenue'">
        <section class="daily-revenue-stack">
          <div class="section-title daily-sheet-title">
            <div>
              <h2>Daily Revenue 10x Report</h2>
              <p>{{ dateLabel(from) }} to {{ dateLabel(to) }} Â· revenue, collection, due, discounts and owner alerts.</p>
            </div>
            <div class="hero-actions inner-action-bar">
              <span class="badge">{{ dailyRevenueRows().length }} day(s)</span>
              <button class="ghost-button" type="button" (click)="exportCsv()" [disabled]="!dailyRevenueRows().length">CSV detailed export</button>
              <button class="ghost-button" type="button" (click)="exportDailyRevenueOwnerPdf()" [disabled]="!dailyRevenueRows().length">Owner PDF</button>
              <button class="ghost-button" type="button" (click)="exportDailyRevenueAccountantPdf()" [disabled]="!dailyRevenueRows().length">Accountant PDF</button>
            </div>
          </div>

          <div class="daily-sheet-kpis">
            <article><span>Best revenue day</span><strong>{{ dailyRevenueKpis()['bestRevenueDay'] }}</strong><small>{{ dailyRevenueKpis()['bestRevenueValue'] | auraMoney:'1.0-0' }}</small></article>
            <article><span>Lowest revenue day</span><strong>{{ dailyRevenueKpis()['lowestRevenueDay'] }}</strong><small>{{ dailyRevenueKpis()['lowestRevenueValue'] | auraMoney:'1.0-0' }}</small></article>
            <article><span>Average daily sale</span><strong>{{ dailyRevenueKpis()['averageDailySale'] | auraMoney:'1.0-0' }}</strong></article>
            <article><span>Growth vs previous period</span><strong>{{ dailyRevenueKpis()['growthRate'] | number:'1.1-1' }}%</strong><small>{{ dailyRevenueKpis()['growthLabel'] }}</small></article>
            <article><span>Pending due trend</span><strong>{{ dailyRevenueKpis()['pendingDueTrend'] | auraMoney:'1.0-0' }}</strong><small>{{ dailyRevenueKpis()['pendingDueLabel'] }}</small></article>
            <article><span>Discount leakage %</span><strong>{{ dailyRevenueKpis()['discountLeakageRate'] | number:'1.1-1' }}%</strong></article>
            <article><span>Collection rate %</span><strong>{{ dailyRevenueKpis()['collectionRate'] | number:'1.1-1' }}%</strong></article>
          </div>

          <div class="daily-revenue-charts">
            <section class="panel daily-revenue-chart">
              <div class="mini-section-title"><span>Daily revenue line chart</span><strong>Net sale trend</strong></div>
              <div class="sparkline-bars" aria-label="Daily revenue line chart">
                <span *ngFor="let point of dailyRevenueChart()" [style.height.%]="point['height']" [title]="point['label'] + ': ' + formatMoney(+point['value'])"></span>
              </div>
            </section>

            <section class="panel daily-revenue-chart">
              <div class="mini-section-title"><span>Service vs product revenue stacked chart</span><strong>Mix control</strong></div>
              <div class="stacked-chart">
                <div *ngFor="let point of serviceProductChart()">
                  <label>{{ point['label'] }}</label>
                  <span class="stack-track">
                    <i class="service-stack" [style.width.%]="point['serviceWidth']"></i>
                    <i class="product-stack" [style.width.%]="point['productWidth']"></i>
                  </span>
                </div>
              </div>
            </section>

            <section class="panel daily-revenue-chart">
              <div class="mini-section-title"><span>Payment mode trend</span><strong>Cash / UPI / Card</strong></div>
              <div class="stacked-chart">
                <div *ngFor="let point of paymentModeTrendChart()">
                  <label>{{ point['label'] }}</label>
                  <span class="stack-track">
                    <i class="cash-stack" [style.width.%]="point['cashWidth']"></i>
                    <i class="upi-stack" [style.width.%]="point['upiWidth']"></i>
                    <i class="card-stack" [style.width.%]="point['cardWidth']"></i>
                    <i class="wallet-stack" [style.width.%]="point['walletWidth']"></i>
                  </span>
                </div>
              </div>
            </section>

            <section class="panel daily-revenue-chart">
              <div class="mini-section-title"><span>Discount vs net sale chart</span><strong>Leakage watch</strong></div>
              <div class="stacked-chart">
                <div *ngFor="let point of discountVsNetChart()">
                  <label>{{ point['label'] }}</label>
                  <span class="stack-track">
                    <i class="net-stack" [style.width.%]="point['netWidth']"></i>
                    <i class="discount-stack" [style.width.%]="point['discountWidth']"></i>
                  </span>
                </div>
              </div>
            </section>

            <section class="panel daily-revenue-chart">
              <div class="mini-section-title"><span>Pending due aging trend</span><strong>Open balance risk</strong></div>
              <div class="aging-chart">
                <article *ngFor="let bucket of pendingDueAgingChart()">
                  <span>{{ bucket['label'] }}</span>
                  <strong>{{ bucket['amount'] | auraMoney:'1.0-0' }}</strong>
                  <small>{{ bucket['count'] }} invoice(s)</small>
                </article>
              </div>
            </section>
          </div>

          <section class="panel daily-revenue-alerts">
            <div class="mini-section-title"><span>Owner alerts</span><strong>Revenue control signals</strong></div>
            <div class="alert-grid">
              <article *ngFor="let alert of dailyRevenueAlerts()" [class.warn]="alert['tone'] === 'warn'" [class.danger]="alert['tone'] === 'danger'">
                <span>{{ alert['label'] }}</span>
                <strong>{{ alert['value'] }}</strong>
                <small>{{ alert['detail'] }}</small>
              </article>
            </div>
          </section>

          <section class="panel daily-revenue-table-card">
            <div class="mini-section-title"><span>Daily Revenue Table</span><strong>Click any date for drilldown</strong></div>
            <div class="financial-table-wrap inner-table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Date</th>
                    <th class="right">Total bill count</th>
                    <th class="right">Service sale</th>
                    <th class="right">Product sale</th>
                    <th class="right">Package sale</th>
                    <th class="right">Membership sale</th>
                    <th class="right">Gift card sale</th>
                    <th class="right">Wallet / prepaid used</th>
                    <th class="right">Gross sale</th>
                    <th class="right">Discount</th>
                    <th class="right">Coupon discount</th>
                    <th class="right">Membership discount</th>
                    <th class="right">Net sale</th>
                    <th class="right">GST</th>
                    <th class="right">Received amount</th>
                    <th class="right">Pending / due amount</th>
                    <th class="right">Expenses</th>
                    <th class="right">Refund / return</th>
                    <th class="right">Final cash-in value</th>
                  </tr>
                </thead>
                <tbody>
                  <ng-container *ngFor="let row of dailyRevenueRows()">
                    <tr class="clickable-row" (click)="toggleDailyRevenueDate(row.dateKey)" [class.active-row]="expandedDailyRevenueDate === row.dateKey">
                      <td><strong>{{ row.dateLabel }}</strong></td>
                      <td class="right">{{ row.totalBillCount }}</td>
                      <td class="right">{{ row.serviceSale | number:'1.2-2' }}</td>
                      <td class="right">{{ row.productSale | number:'1.2-2' }}</td>
                      <td class="right">{{ row.packageSale | number:'1.2-2' }}</td>
                      <td class="right">{{ row.membershipSale | number:'1.2-2' }}</td>
                      <td class="right">{{ row.giftCardSale | number:'1.2-2' }}</td>
                      <td class="right">{{ row.walletPrepaidUsed | number:'1.2-2' }}</td>
                      <td class="right">{{ row.grossSale | number:'1.2-2' }}</td>
                      <td class="right">{{ row.discount | number:'1.2-2' }}</td>
                      <td class="right">{{ row.couponDiscount | number:'1.2-2' }}</td>
                      <td class="right">{{ row.membershipDiscount | number:'1.2-2' }}</td>
                      <td class="right">{{ row.netSale | number:'1.2-2' }}</td>
                      <td class="right">{{ row.gst | number:'1.2-2' }}</td>
                      <td class="right">{{ row.receivedAmount | number:'1.2-2' }}</td>
                      <td class="right">{{ row.pendingDueAmount | number:'1.2-2' }}</td>
                      <td class="right">{{ row.expenses | number:'1.2-2' }}</td>
                      <td class="right">{{ row.refundReturn | number:'1.2-2' }}</td>
                      <td class="right"><strong>{{ row.finalCashInValue | number:'1.2-2' }}</strong></td>
                    </tr>
                    <tr *ngIf="expandedDailyRevenueDate === row.dateKey" class="drilldown-row">
                      <td colspan="19">
                        <div class="daily-revenue-drilldown" *ngIf="dailyRevenueDrilldown(row.dateKey) as detail">
                          <article>
                            <span>Us din ke invoices</span>
                            <strong>{{ detail['invoiceCount'] }}</strong>
                            <small>{{ detail['invoiceNumbers'] || 'No invoice' }}</small>
                          </article>
                          <article>
                            <span>Staff-wise sale</span>
                            <strong>{{ detail['topStaff'] || 'Unassigned' }}</strong>
                            <small>{{ detail['staffSummary'] || 'No staff rows' }}</small>
                          </article>
                          <article>
                            <span>Service-wise sale</span>
                            <strong>{{ detail['topService'] || 'No service' }}</strong>
                            <small>{{ detail['serviceSummary'] || 'No service rows' }}</small>
                          </article>
                          <article>
                            <span>Payment mode breakup</span>
                            <strong>{{ detail['topMode'] || 'No payment' }}</strong>
                            <small>{{ detail['paymentModeSummary'] || 'No payments' }}</small>
                          </article>
                          <article>
                            <span>Due/recovered invoices</span>
                            <strong>{{ detail['dueSummary'] }}</strong>
                            <small>{{ detail['recoveredSummary'] }}</small>
                          </article>
                          <article>
                            <span>High discount bills</span>
                            <strong>{{ detail['highDiscountCount'] }}</strong>
                            <small>{{ detail['highDiscountInvoices'] || 'No high discount bill' }}</small>
                          </article>
                          <article>
                            <span>Deleted/edited invoices</span>
                            <strong>{{ detail['auditCount'] }}</strong>
                            <small>{{ detail['auditSummary'] || 'No edit/delete signal' }}</small>
                          </article>
                        </div>
                      </td>
                    </tr>
                  </ng-container>
                  <tr *ngIf="!dailyRevenueRows().length">
                    <td colspan="19" class="empty-cell">No daily revenue rows found for selected date range.</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>
        </section>
      </ng-container>

      <ng-container *ngIf="!loading() && !error() && activeTab === 'member-sales'">
        <section class="member-sales-stack">
          <div class="section-title daily-sheet-title">
            <div>
              <h2>Member vs Non-Member Sales</h2>
              <p>{{ dateLabel(from) }} to {{ dateLabel(to) }} Â· compare revenue, visits, ROI and conversion opportunities.</p>
            </div>
            <div class="hero-actions inner-action-bar">
              <span class="badge">{{ visibleMemberSalesRows().length }} client(s)</span>
              <button class="ghost-button" type="button" (click)="exportCsv()" [disabled]="!visibleMemberSalesRows().length">CSV full report</button>
              <button class="ghost-button" type="button" (click)="exportMemberSalesOwnerPdf()" [disabled]="!visibleMemberSalesRows().length">Owner PDF</button>
              <button class="ghost-button" type="button" (click)="exportMemberConversionPdf()" [disabled]="!memberConversionOpportunities().length">Conversion PDF</button>
            </div>
          </div>

          <div class="daily-sheet-kpis">
            <article><span>Member clients count</span><strong>{{ memberSalesSummary()['memberClients'] }}</strong><small>{{ memberSalesSummary()['memberVisits'] }} visits</small></article>
            <article><span>Non-member clients count</span><strong>{{ memberSalesSummary()['nonMemberClients'] }}</strong><small>{{ memberSalesSummary()['nonMemberVisits'] }} visits</small></article>
            <article><span>Member revenue</span><strong>{{ memberSalesSummary()['memberRevenue'] | auraMoney:'1.0-0' }}</strong><small>{{ memberSalesSummary()['memberRevenueShare'] | number:'1.1-1' }}% share</small></article>
            <article><span>Non-member revenue</span><strong>{{ memberSalesSummary()['nonMemberRevenue'] | auraMoney:'1.0-0' }}</strong><small>{{ memberSalesSummary()['nonMemberRevenueShare'] | number:'1.1-1' }}% share</small></article>
            <article><span>Paid amount</span><strong>{{ memberSalesSummary()['paidAmount'] | auraMoney:'1.0-0' }}</strong></article>
            <article><span>Pending amount</span><strong>{{ memberSalesSummary()['pendingAmount'] | auraMoney:'1.0-0' }}</strong></article>
            <article><span>Collection rate %</span><strong>{{ memberSalesSummary()['collectionRate'] | number:'1.1-1' }}%</strong></article>
          </div>

          <div class="member-sales-grid">
            <section class="panel daily-sheet-card aura-card">
              <div class="mini-section-title"><span>Member vs Non-Member Comparison</span><strong>Revenue quality</strong></div>
              <table>
                <thead><tr><th>Metric</th><th class="right">Members</th><th class="right">Non-members</th></tr></thead>
                <tbody>
                  <tr *ngFor="let row of memberComparisonRows()">
                    <td>{{ row['label'] }}</td>
                    <td class="right">{{ row['member'] }}</td>
                    <td class="right">{{ row['nonMember'] }}</td>
                  </tr>
                </tbody>
              </table>
            </section>

            <section class="panel daily-sheet-card aura-card">
              <div class="mini-section-title"><span>Membership ROI</span><strong>Profitability signal</strong></div>
              <table>
                <thead><tr><th>Metric</th><th class="right">Value</th></tr></thead>
                <tbody>
                  <tr *ngFor="let row of membershipRoiRows()">
                    <td>{{ row['label'] }}</td>
                    <td class="right">{{ row['value'] }}</td>
                  </tr>
                </tbody>
              </table>
            </section>

          </div>

          <section class="panel member-wide-card">
            <div class="mini-section-title"><span>Conversion Opportunity</span><strong>Non-member growth list</strong></div>
            <div class="member-table-wrap inner-table-wrap">
              <table class="member-conversion-table">
                <thead><tr><th>Client</th><th class="right">Sale</th><th class="right">Visits</th><th>Suggested plan</th><th>Action</th></tr></thead>
                <tbody>
                  <tr *ngFor="let row of memberConversionOpportunities()">
                    <td>{{ row['clientName'] }}<br><small>{{ row['phone'] }}</small></td>
                    <td class="right">{{ row['totalSale'] | number:'1.2-2' }}</td>
                    <td class="right">{{ row['totalVisits'] }}</td>
                    <td>{{ row['suggestedPlan'] }}</td>
                    <td>{{ row['followUpAction'] }}</td>
                  </tr>
                  <tr *ngIf="!memberConversionOpportunities().length">
                    <td colspan="5" class="empty-cell">No conversion opportunity found for selected range.</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>

          <section class="panel member-wide-card">
            <div class="mini-section-title"><span>Staff-Wise Impact</span><strong>Conversion accountability</strong></div>
            <div class="member-table-wrap inner-table-wrap">
              <table class="member-staff-table">
                <thead><tr><th>Staff</th><th class="right">Member sale</th><th class="right">Non-member sale</th><th class="right" title="Member conversion count">Conversions</th><th class="right" title="Repeat member visits">Repeat visits</th><th class="right">Member due</th><th class="right">Non-member due</th></tr></thead>
                <tbody>
                  <tr *ngFor="let row of memberStaffImpactRows()">
                    <td>{{ row['staffName'] }}</td>
                    <td class="right">{{ row['memberSales'] | number:'1.2-2' }}</td>
                    <td class="right">{{ row['nonMemberSales'] | number:'1.2-2' }}</td>
                    <td class="right">{{ row['memberConversionCount'] }}</td>
                    <td class="right">{{ row['repeatMemberVisits'] }}</td>
                    <td class="right">{{ row['memberPending'] | number:'1.2-2' }}</td>
                    <td class="right">{{ row['nonMemberPending'] | number:'1.2-2' }}</td>
                  </tr>
                  <tr *ngIf="!memberStaffImpactRows().length">
                    <td colspan="7" class="empty-cell">No staff impact rows found.</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>

          <section class="panel daily-revenue-alerts">
            <div class="mini-section-title"><span>Owner Alerts</span><strong>Membership revenue control</strong></div>
            <div class="alert-grid">
              <article *ngFor="let alert of memberSalesAlerts()" [class.warn]="alert['tone'] === 'warn'" [class.danger]="alert['tone'] === 'danger'">
                <span>{{ alert['label'] }}</span>
                <strong>{{ alert['value'] }}</strong>
                <small>{{ alert['detail'] }}</small>
              </article>
            </div>
          </section>

          <section class="panel daily-revenue-table-card">
            <div class="mini-section-title"><span>Client-level table</span><strong>Renew, upsell, convert or recover due</strong></div>
            <div class="financial-table-wrap inner-table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Client name</th>
                    <th>Phone</th>
                    <th>Membership status</th>
                    <th>Active plan name</th>
                    <th class="right">Total visits</th>
                    <th class="right">Total sale</th>
                    <th class="right">Paid amount</th>
                    <th class="right">Pending amount</th>
                    <th class="right">Discount used</th>
                    <th>Last visit date</th>
                    <th>Suggested action</th>
                  </tr>
                </thead>
                <tbody>
                  <tr *ngFor="let row of visibleMemberSalesRows()">
                    <td><strong>{{ row.clientName }}</strong></td>
                    <td>{{ row.phone }}</td>
                    <td>{{ row.membershipStatus }}</td>
                    <td>{{ row.activePlanName || '-' }}</td>
                    <td class="right">{{ row.totalVisits }}</td>
                    <td class="right">{{ row.totalSale | number:'1.2-2' }}</td>
                    <td class="right">{{ row.paidAmount | number:'1.2-2' }}</td>
                    <td class="right">{{ row.pendingAmount | number:'1.2-2' }}</td>
                    <td class="right">{{ row.discountUsed | number:'1.2-2' }}</td>
                    <td>{{ row.lastVisitDate }}</td>
                    <td><span class="mode-pill">{{ row.suggestedAction }}</span></td>
                  </tr>
                  <tr *ngIf="!visibleMemberSalesRows().length">
                    <td colspan="11" class="empty-cell">No member sales rows found for selected filters.</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>
        </section>
      </ng-container>

      <ng-container *ngIf="!loading() && !error() && activeTab === 'sales-tax'">
        <section class="sales-tax-stack">
          <div class="section-title daily-sheet-title sales-tax-title">
            <div>
              <h2>Sales Tax / GST 10x Report</h2>
              <p>{{ dateLabel(from) }} to {{ dateLabel(to) }} Â· invoice tax register, rate breakup, service/product split and accounting checks.</p>
            </div>
            <div class="hero-actions inner-action-bar">
              <span class="badge">{{ salesTaxRows().length }} bill(s)</span>
              <button class="ghost-button" type="button" (click)="exportCsv()" [disabled]="!salesTaxRows().length">CSV export</button>
              <button class="ghost-button" type="button" (click)="exportSalesTaxOwnerPdf()" [disabled]="!salesTaxRows().length">Owner PDF</button>
              <button class="ghost-button" type="button" (click)="exportSalesTaxAccountantPdf()" [disabled]="!salesTaxRows().length">Accountant PDF</button>
            </div>
          </div>

          <div class="daily-sheet-kpis sales-tax-kpis">
            <article><span>Total bills</span><strong>{{ salesTaxSummary()['totalBills'] }}</strong></article>
            <article><span>Gross sale</span><strong>{{ salesTaxSummary()['grossSale'] | auraMoney:'1.0-0' }}</strong></article>
            <article><span>Net sale</span><strong>{{ salesTaxSummary()['netSale'] | auraMoney:'1.0-0' }}</strong></article>
            <article><span>Taxable amount</span><strong>{{ salesTaxSummary()['taxableAmount'] | auraMoney:'1.0-0' }}</strong></article>
            <article><span>Total GST</span><strong>{{ salesTaxSummary()['totalGst'] | auraMoney:'1.0-0' }}</strong></article>
            <article><span>CGST</span><strong>{{ salesTaxSummary()['cgst'] | auraMoney:'1.0-0' }}</strong></article>
            <article><span>SGST</span><strong>{{ salesTaxSummary()['sgst'] | auraMoney:'1.0-0' }}</strong></article>
            <article><span>IGST</span><strong>{{ salesTaxSummary()['igst'] | auraMoney:'1.0-0' }}</strong></article>
            <article><span>Coupon discount</span><strong>{{ salesTaxSummary()['couponDiscount'] | auraMoney:'1.0-0' }}</strong></article>
            <article><span>Membership discount</span><strong>{{ salesTaxSummary()['membershipDiscount'] | auraMoney:'1.0-0' }}</strong></article>
            <article><span>Tax-exempt sale</span><strong>{{ salesTaxSummary()['taxExemptSale'] | auraMoney:'1.0-0' }}</strong></article>
            <article><span>GST mismatch count</span><strong>{{ salesTaxSummary()['gstMismatchCount'] }}</strong></article>
          </div>

          <div class="sales-tax-grid">
            <section class="panel daily-sheet-card aura-card sales-tax-card">
              <div class="mini-section-title"><span>GST rate breakup</span><strong>0%, 5%, 12%, 18%, 28%</strong></div>
              <table>
                <thead><tr><th>GST rate</th><th class="right">Bills</th><th class="right">Taxable</th><th class="right">GST</th><th class="right">Total</th></tr></thead>
                <tbody>
                  <tr *ngFor="let row of gstRateBreakupRows()">
                    <td>{{ row['rateLabel'] }}</td>
                    <td class="right">{{ row['count'] }}</td>
                    <td class="right">{{ row['taxable'] | number:'1.2-2' }}</td>
                    <td class="right">{{ row['gst'] | number:'1.2-2' }}</td>
                    <td class="right">{{ row['total'] | number:'1.2-2' }}</td>
                  </tr>
                </tbody>
              </table>
            </section>

            <section class="panel daily-sheet-card aura-card sales-tax-card">
              <div class="mini-section-title"><span>Service/product tax split</span><strong>Tax by item type</strong></div>
              <table>
                <thead><tr><th>Type</th><th class="right">Bills</th><th class="right">Taxable</th><th class="right">GST</th><th class="right">Total</th></tr></thead>
                <tbody>
                  <tr *ngFor="let row of salesTaxTypeSplitRows()">
                    <td>{{ row['typeLabel'] }}</td>
                    <td class="right">{{ row['count'] }}</td>
                    <td class="right">{{ row['taxable'] | number:'1.2-2' }}</td>
                    <td class="right">{{ row['gst'] | number:'1.2-2' }}</td>
                    <td class="right">{{ row['total'] | number:'1.2-2' }}</td>
                  </tr>
                </tbody>
              </table>
            </section>

            <section class="panel daily-sheet-card aura-card sales-tax-card sales-tax-checks-card">
              <div class="mini-section-title"><span>Accounting checks</span><strong>Mismatch, missing GST, refund tax</strong></div>
              <table>
                <thead><tr><th>Check</th><th class="right">Count</th><th class="right">Amount</th><th>Action</th></tr></thead>
                <tbody>
                  <tr *ngFor="let row of salesTaxAccountingChecks()">
                    <td>{{ row['label'] }}</td>
                    <td class="right">{{ row['count'] }}</td>
                    <td class="right">{{ row['amount'] | number:'1.2-2' }}</td>
                    <td>{{ row['action'] }}</td>
                  </tr>
                </tbody>
              </table>
            </section>
          </div>

          <section class="panel daily-revenue-table-card sales-tax-register-card">
            <div class="mini-section-title"><span>Invoice-wise tax register</span><strong>Scroll horizontally for full GST audit columns</strong></div>
            <div class="financial-table-wrap inner-table-wrap sales-tax-table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Invoice no</th>
                    <th>Client</th>
                    <th>Phone</th>
                    <th>GSTIN</th>
                    <th>Staff / cashier</th>
                    <th class="right">Actual price</th>
                    <th class="right">Discount</th>
                    <th class="right">Coupon discount</th>
                    <th class="right">Membership discount</th>
                    <th class="right">Taxable amount</th>
                    <th class="right">GST %</th>
                    <th class="right">CGST</th>
                    <th class="right">SGST</th>
                    <th class="right">IGST</th>
                    <th class="right">Total GST</th>
                    <th class="right">Invoice total</th>
                    <th class="right">Paid</th>
                    <th class="right">Due</th>
                    <th>Payment mode</th>
                    <th>Tax status</th>
                  </tr>
                </thead>
                <tbody>
                  <tr *ngFor="let row of salesTaxRows()">
                    <td>{{ row.date }}</td>
                    <td>{{ row.invoiceNo }}</td>
                    <td>{{ row.clientName }}</td>
                    <td>{{ row.phone }}</td>
                    <td>{{ row.gstin || '-' }}</td>
                    <td>{{ row.staffCashier }}</td>
                    <td class="right">{{ row.actualPrice | number:'1.2-2' }}</td>
                    <td class="right">{{ row.discount | number:'1.2-2' }}</td>
                    <td class="right">{{ row.couponDiscount | number:'1.2-2' }}</td>
                    <td class="right">{{ row.membershipDiscount | number:'1.2-2' }}</td>
                    <td class="right">{{ row.taxableAmount | number:'1.2-2' }}</td>
                    <td class="right">{{ row.gstRate | number:'1.0-2' }}%</td>
                    <td class="right">{{ row.cgst | number:'1.2-2' }}</td>
                    <td class="right">{{ row.sgst | number:'1.2-2' }}</td>
                    <td class="right">{{ row.igst | number:'1.2-2' }}</td>
                    <td class="right">{{ row.totalGst | number:'1.2-2' }}</td>
                    <td class="right">{{ row.invoiceTotal | number:'1.2-2' }}</td>
                    <td class="right">{{ row.paid | number:'1.2-2' }}</td>
                    <td class="right">{{ row.due | number:'1.2-2' }}</td>
                    <td><span class="mode-pill">{{ row.paymentMode }}</span></td>
                    <td><span class="mode-pill" [class.warn-pill]="row.taxStatus !== 'Valid'">{{ row.taxStatus }}</span></td>
                  </tr>
                  <tr *ngIf="!salesTaxRows().length">
                    <td colspan="21" class="empty-cell">No Sales Tax / GST rows found for selected date range.</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>
        </section>
      </ng-container>
    </section>
  `,
  styles: [`
    :host {
      display: block;
    }

    .financial-summary-page {
      display: grid;
      gap: 14px;
      color: var(--ink);
    }

    .financial-hero {
      padding: 20px 22px;
    }

    .hero-actions {
      display: flex;
      align-items: center;
      justify-content: flex-end;
      gap: 10px;
      flex-wrap: wrap;
    }

    .report-tabs {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
      width: fit-content;
      max-width: 100%;
      padding: 4px;
      border: 1px solid var(--line);
      border-radius: var(--radius-md);
      background: #fff;
      box-shadow: var(--shadow-sm);
    }

    .report-tabs button {
      border: 0;
      border-radius: 8px;
      padding: 10px 14px;
      color: var(--muted);
      background: transparent;
      font-weight: 900;
      cursor: pointer;
    }

    .report-tabs button.active {
      color: #fff;
      background: #4B1238;
      box-shadow: 0 8px 20px rgba(75, 18, 56, .18);
    }

    .icon-action {
      min-width: 42px;
    }

    .filter-panel {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
      gap: 12px;
      align-items: end;
    }

    .filter-panel .primary-button {
      min-height: 48px;
    }

    .summary-strip {
      display: grid;
      grid-template-columns: repeat(6, minmax(0, 1fr));
      gap: 10px;
    }

    .summary-strip article,
    .insight-grid article {
      display: grid;
      gap: 6px;
      min-width: 0;
      padding: 14px;
      border: 1px solid var(--line);
      border-radius: var(--radius-md);
      background: #fff;
      box-shadow: var(--shadow-sm);
    }

    .summary-strip span,
    .insight-grid span {
      color: var(--muted);
      font-size: 0.72rem;
      font-weight: 900;
      letter-spacing: 0.05em;
      text-transform: uppercase;
    }

    .summary-strip strong {
      font-size: 1.18rem;
      line-height: 1.05;
    }

    .summary-strip small,
    .insight-grid small,
    .section-title p {
      color: var(--muted);
    }

    .matrix-panel,
    .insight-panel {
      display: grid;
      gap: 14px;
    }

    .financial-table-wrap {
      max-height: min(690px, calc(100vh - 260px));
      overflow: auto;
      border: 1px solid var(--line);
      border-radius: var(--radius-md);
      background: #fff;
      box-shadow: var(--shadow-sm);
    }

    table {
      width: 100%;
      min-width: 1040px;
      border-collapse: collapse;
      table-layout: fixed;
      font-size: 0.9rem;
    }

    th,
    td {
      padding: 12px 14px;
      border-bottom: 1px solid var(--line);
      vertical-align: middle;
    }

    th {
      position: sticky;
      top: 0;
      z-index: 2;
      background: #FAF8F6;
      color: var(--muted);
      font-size: 0.74rem;
      font-weight: 900;
      letter-spacing: 0.05em;
      text-transform: uppercase;
    }

    .row-head,
    td:first-child {
      position: sticky;
      left: 0;
      z-index: 1;
      width: 240px;
      background: #fff;
      color: #182335;
      font-weight: 900;
      text-align: left;
    }

    .row-head {
      z-index: 3;
      background: #FAF8F6;
    }

    .right {
      text-align: right;
    }

    tbody tr:hover td {
      background: #f8fbff;
    }

    tbody tr:hover td:first-child {
      background: #f1f8ff;
    }

    .section-row td {
      background: #FAF8F6;
      color: #4b627d;
      font-size: 1rem;
      text-transform: uppercase;
    }

    .section-row td:not(:first-child) {
      color: transparent;
    }

    .primary-row td {
      color: #4B1238;
      font-weight: 900;
    }

    .insight-grid {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 10px;
    }

    .payment-distribution-stack {
      display: grid;
      gap: 14px;
    }

    .payment-card-strip {
      display: grid;
      grid-template-columns: repeat(10, minmax(130px, 1fr));
      gap: 8px;
      overflow-x: auto;
      padding-bottom: 2px;
    }

    .payment-card-strip button {
      min-height: 72px;
      display: grid;
      gap: 8px;
      align-content: center;
      text-align: left;
      padding: 12px;
      border: 1px solid var(--line);
      border-radius: var(--radius-md);
      background: #fff;
      box-shadow: var(--shadow-sm);
      cursor: pointer;
      font: inherit;
      transition: border-color 0.16s ease, box-shadow 0.16s ease, transform 0.16s ease;
    }

    .payment-card-strip button:hover,
    .payment-card-strip button.active {
      border-color: #4B1238;
      box-shadow: 0 12px 26px rgba(200, 125, 75, 0.16);
      transform: translateY(-1px);
    }

    .payment-card-strip button.active {
      background: #F8EEF4;
    }

    .payment-card-strip strong {
      color: var(--ink);
      font-size: 1.08rem;
      line-height: 1.05;
    }

    .payment-card-strip span {
      color: var(--muted);
      font-size: 0.72rem;
      font-weight: 900;
      text-transform: uppercase;
    }

    .payment-table-panel {
      display: grid;
      gap: 12px;
    }

    .payment-actions {
      display: flex;
      align-items: center;
      justify-content: flex-end;
      gap: 10px;
      flex-wrap: wrap;
    }

    .search-field input {
      width: min(260px, 72vw);
      min-height: 42px;
      border: 1px solid var(--line);
      border-radius: 12px;
      padding: 0 14px;
      background: #fff;
      color: var(--ink);
      font: inherit;
    }

    .payment-table-wrap {
      overflow: auto;
      border: 1px solid var(--line);
      border-radius: var(--radius-md);
      background: #fff;
    }

    .payment-table-wrap table {
      min-width: 1180px;
      width: 100%;
      border-collapse: collapse;
      table-layout: auto;
    }

    .payment-table-wrap th,
    .payment-table-wrap td {
      padding: 12px 10px;
      border-bottom: 1px solid var(--line);
      color: var(--ink);
      font-size: 0.82rem;
      text-align: left;
      vertical-align: middle;
    }

    .payment-table-wrap th {
      position: sticky;
      top: 0;
      z-index: 1;
      background: #f8fbfa;
      color: var(--muted);
      font-size: 0.7rem;
      font-weight: 900;
      letter-spacing: 0.04em;
      text-transform: uppercase;
    }

    .mode-pill,
    .row-action {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-height: 28px;
      padding: 4px 10px;
      border-radius: 999px;
      border: 1px solid rgba(75, 18, 56, .22);
      color: #4B1238;
      background: rgba(75, 18, 56, .08);
      font-weight: 900;
      text-decoration: none;
      white-space: nowrap;
    }

    .warn-pill {
      border-color: rgba(194, 65, 12, .26);
      color: #9a3412;
      background: #fff7ed;
    }

    .empty-cell {
      height: 160px;
      text-align: center !important;
      color: var(--muted) !important;
    }

    .daily-sheet-stack {
      display: grid;
      gap: 14px;
    }

    .daily-sheet-title {
      align-items: center;
    }

    .daily-sheet-kpis {
      display: grid;
      grid-template-columns: repeat(6, minmax(0, 1fr));
      gap: 10px;
    }

    .daily-sheet-kpis article {
      min-height: 104px;
      display: grid;
      gap: 6px;
      align-content: center;
      padding: 14px;
      border: 1px solid var(--line);
      border-top: 4px solid #4B1238;
      border-radius: var(--radius-md);
      background: #fff;
      box-shadow: var(--shadow-sm);
    }

    .daily-sheet-kpis span,
    .mini-section-title span {
      color: var(--muted);
      font-size: 0.72rem;
      font-weight: 900;
      letter-spacing: 0.05em;
      text-transform: uppercase;
    }

    .daily-sheet-kpis strong {
      font-size: 1.08rem;
      line-height: 1.05;
    }

    .daily-sheet-kpis small {
      color: var(--muted);
    }

    .daily-sheet-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 14px;
    }

    .daily-sheet-card {
      display: grid;
      gap: 12px;
      min-width: 0;
    }

    .daily-sheet-card table {
      min-width: 760px;
      table-layout: auto;
      border: 1px solid var(--line);
      border-radius: var(--radius-md);
      overflow: hidden;
    }

    .daily-sheet-card th,
    .daily-sheet-card td {
      padding: 10px 12px;
      font-size: 0.82rem;
      overflow-wrap: anywhere;
    }

    .mini-section-title {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      flex-wrap: wrap;
    }

    .daily-revenue-stack,
    .member-sales-stack,
    .sales-tax-stack {
      display: grid;
      gap: 14px;
    }

    .sales-tax-title {
      padding: 16px 18px;
      border: 1px solid var(--line);
      border-radius: var(--radius-md);
      background: #fff;
      box-shadow: var(--shadow-sm);
    }

    .sales-tax-kpis {
      grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
      gap: 8px;
    }

    .sales-tax-kpis article {
      min-height: 88px;
      padding: 12px;
      border-top-width: 3px;
    }

    .sales-tax-kpis strong {
      font-size: 1rem;
      overflow-wrap: anywhere;
    }

    .member-sales-grid,
    .sales-tax-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 14px;
      align-items: start;
    }

    .sales-tax-grid {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }

    .sales-tax-card table {
      min-width: 0;
      width: 100%;
      table-layout: auto;
    }

    .sales-tax-card th,
    .sales-tax-card td {
      padding: 10px 12px;
      white-space: normal;
    }

    .sales-tax-card td:first-child,
    .sales-tax-card th:first-child {
      width: auto;
      min-width: 140px;
    }

    .sales-tax-checks-card {
      grid-column: 1 / -1;
    }

    .sales-tax-checks-card table {
      min-width: 860px;
    }

    .member-sales-grid .daily-sheet-card,
    .member-wide-card {
      align-self: start;
    }

    .member-wide-card {
      display: grid;
      gap: 12px;
      min-width: 0;
    }

    .member-table-wrap {
      max-height: 420px;
      overflow: auto;
      border: 1px solid var(--line);
      border-radius: var(--radius-md);
      background: #fff;
    }

    .member-table-wrap table {
      width: 100%;
      min-width: 920px;
      table-layout: auto;
      border-collapse: collapse;
    }

    .member-table-wrap th,
    .member-table-wrap td {
      padding: 10px 12px;
      font-size: .82rem;
      line-height: 1.28;
      border-bottom: 1px solid var(--line);
      vertical-align: middle;
    }

    .member-table-wrap th {
      position: sticky;
      top: 0;
      z-index: 1;
      background: #FAF8F6;
      color: var(--muted);
      font-size: .72rem;
      font-weight: 900;
      letter-spacing: .04em;
      text-transform: uppercase;
      white-space: nowrap;
    }

    .member-table-wrap td:first-child,
    .member-table-wrap th:first-child {
      position: sticky;
      left: 0;
      z-index: 2;
      background: #fff;
      min-width: 220px;
    }

    .member-table-wrap th:first-child {
      z-index: 3;
      background: #FAF8F6;
    }

    .member-conversion-table {
      min-width: 860px;
    }

    .member-staff-table {
      min-width: 1080px;
    }

    .member-staff-table th,
    .member-staff-table td {
      white-space: nowrap;
    }

    .daily-revenue-charts {
      display: grid;
      grid-template-columns: repeat(5, minmax(210px, 1fr));
      gap: 12px;
    }

    .daily-revenue-chart,
    .daily-revenue-alerts,
    .daily-revenue-table-card {
      display: grid;
      gap: 12px;
      min-width: 0;
    }

    .sparkline-bars {
      height: 150px;
      display: flex;
      align-items: flex-end;
      gap: 5px;
      padding: 10px;
      border: 1px solid var(--line);
      border-radius: var(--radius-md);
      background: linear-gradient(180deg, #f8f5f2, #fff);
    }

    .sparkline-bars span {
      flex: 1;
      min-width: 8px;
      border-radius: 6px 6px 0 0;
      background: #4B1238;
      box-shadow: 0 8px 18px rgba(75, 18, 56, .14);
    }

    .stacked-chart {
      display: grid;
      gap: 8px;
    }

    .stacked-chart div {
      display: grid;
      grid-template-columns: 58px 1fr;
      gap: 8px;
      align-items: center;
    }

    .stacked-chart label {
      color: var(--muted);
      font-size: .72rem;
      font-weight: 900;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .stack-track {
      height: 16px;
      display: flex;
      overflow: hidden;
      border-radius: 999px;
      background: #eef2f7;
    }

    .stack-track i {
      display: block;
      min-width: 2px;
    }

    .service-stack,
    .net-stack {
      background: #4B1238;
    }

    .product-stack,
    .discount-stack {
      background: #c2410c;
    }

    .cash-stack {
      background: #4B1238;
    }

    .upi-stack {
      background: #4B1238;
    }

    .card-stack {
      background: #7c3aed;
    }

    .wallet-stack {
      background: #c2410c;
    }

    .aging-chart,
    .alert-grid,
    .daily-revenue-drilldown {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 10px;
    }

    .aging-chart article,
    .alert-grid article,
    .daily-revenue-drilldown article {
      display: grid;
      gap: 6px;
      min-height: 88px;
      align-content: center;
      padding: 12px;
      border: 1px solid var(--line);
      border-radius: var(--radius-md);
      background: #fff;
    }

    .alert-grid article.warn {
      border-color: rgba(194, 65, 12, .28);
      background: #fff7ed;
    }

    .alert-grid article.danger {
      border-color: rgba(185, 28, 28, .28);
      background: #fef2f2;
    }

    .aging-chart span,
    .alert-grid span,
    .daily-revenue-drilldown span {
      color: var(--muted);
      font-size: .72rem;
      font-weight: 900;
      letter-spacing: .04em;
      text-transform: uppercase;
    }

    .aging-chart small,
    .alert-grid small,
    .daily-revenue-drilldown small {
      color: var(--muted);
      overflow-wrap: anywhere;
    }

    .daily-revenue-table-card table {
      min-width: 2200px;
      table-layout: auto;
    }

    .sales-tax-table-wrap table {
      min-width: 2450px;
      table-layout: auto;
    }

    .sales-tax-register-card {
      overflow: hidden;
    }

    .sales-tax-table-wrap {
      max-height: min(620px, calc(100vh - 280px));
    }

    .sales-tax-table-wrap th,
    .sales-tax-table-wrap td {
      padding: 10px 12px;
      font-size: .8rem;
      line-height: 1.28;
      overflow-wrap: anywhere;
      white-space: normal;
    }

    .sales-tax-table-wrap th:first-child,
    .sales-tax-table-wrap td:first-child {
      width: 116px;
      min-width: 116px;
      max-width: 116px;
    }

    .sales-tax-table-wrap th:nth-child(2),
    .sales-tax-table-wrap td:nth-child(2) {
      min-width: 150px;
    }

    .sales-tax-table-wrap th:nth-child(3),
    .sales-tax-table-wrap td:nth-child(3) {
      min-width: 220px;
    }

    .sales-tax-table-wrap th:nth-child(6),
    .sales-tax-table-wrap td:nth-child(6) {
      min-width: 160px;
    }

    .clickable-row {
      cursor: pointer;
    }

    .clickable-row.active-row td {
      background: #F3EAF0;
    }

    .drilldown-row td {
      position: static;
      background: #FAF8F6 !important;
    }

    .sr-only {
      position: absolute;
      width: 1px;
      height: 1px;
      padding: 0;
      margin: -1px;
      overflow: hidden;
      clip: rect(0, 0, 0, 0);
      white-space: nowrap;
      border: 0;
    }

    @media (max-width: 1180px) {
      .filter-panel,
      .summary-strip,
      .insight-grid,
      .payment-card-strip,
      .daily-sheet-kpis,
      .daily-sheet-grid,
      .daily-revenue-charts,
      .member-sales-grid,
      .sales-tax-grid,
      .aging-chart,
      .alert-grid,
      .daily-revenue-drilldown {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }
    }

    @media (max-width: 720px) {
      .filter-panel,
      .summary-strip,
      .insight-grid,
      .payment-card-strip,
      .daily-sheet-kpis,
      .daily-sheet-grid,
      .daily-revenue-charts,
      .member-sales-grid,
      .sales-tax-grid,
      .aging-chart,
      .alert-grid,
      .daily-revenue-drilldown {
        grid-template-columns: 1fr;
      }

      .financial-hero {
        align-items: flex-start;
      }

      .hero-actions {
        justify-content: flex-start;
      }
    }
  `]
})
export class FinancialSummaryReportComponent implements OnInit {
  readonly loading = signal(false);
  readonly error = signal('');
  readonly invoices = signal<ApiRecord[]>([]);
  readonly payments = signal<ApiRecord[]>([]);
  readonly sales = signal<ApiRecord[]>([]);
  readonly branches = signal<ApiRecord[]>([]);
  readonly walletTransactions = signal<ApiRecord[]>([]);
  readonly walletLedgerReport = signal<ApiRecord>({ summary: {}, rows: [], alerts: [] });
  readonly clients = signal<ApiRecord[]>([]);
  readonly memberships = signal<ApiRecord[]>([]);
  readonly financeExpenses = signal<ApiRecord[]>([]);
  readonly auditLogs = signal<ApiRecord[]>([]);
  readonly cashDrawerReports = signal<ApiRecord[]>([]);
  readonly cashDrawerSessions = signal<ApiRecord[]>([]);
  readonly financeSummary = signal<ApiRecord>({});
  readonly auxiliaryLoading = signal(false);

  activeTab: ReportTab = 'summary';
  periodMode: 'month' | 'quarter' = 'month';
  paymentTypeFilter = '';
  paymentDateBasis: 'payment' | 'invoice' = 'payment';
  paymentSearch = '';
  walletLedgerSearch = '';
  walletLedgerTypeFilter = '';
  walletLedgerSourceFilter = '';
  walletLedgerPaymentModeFilter = '';
  walletLedgerRiskFilter = '';
  memberClientTypeFilter: 'all' | 'members' | 'non-members' = 'all';
  memberSalesSearch = '';
  from = this.defaultFrom();
  to = this.today();
  dailySheetDate = this.today();
  expandedDailyRevenueDate = '';
  private dataVersion = 0;
  private dailyRevenueRowsCache: { key: string; rows: DailyRevenueRow[] } = { key: '', rows: [] };
  private dailyRevenueKpisCache: { key: string; value: ApiRecord } = { key: '', value: {} };
  private dailyRevenueChartCache: { key: string; value: ApiRecord[] } = { key: '', value: [] };
  private serviceProductChartCache: { key: string; value: ApiRecord[] } = { key: '', value: [] };
  private paymentModeTrendChartCache: { key: string; value: ApiRecord[] } = { key: '', value: [] };
  private discountVsNetChartCache: { key: string; value: ApiRecord[] } = { key: '', value: [] };
  private pendingDueAgingChartCache: { key: string; value: ApiRecord[] } = { key: '', value: [] };
  private dailyRevenueAlertsCache: { key: string; value: ApiRecord[] } = { key: '', value: [] };
  private dailyRevenueDrilldownCache = new Map<string, ApiRecord>();
  private salesTaxRowsCache: { key: string; rows: SalesTaxRow[] } = { key: '', rows: [] };
  private salesTaxSummaryCache: { key: string; value: ApiRecord } = { key: '', value: {} };
  private readonly invoiceQueryParamsCache = new Map<string, { q: string }>();
  private salesTaxClientDataLoaded = false;
  private financialControlDataLoaded = false;
  private memberSalesDataLoaded = false;

  readonly baseRows: MatrixCell[] = [
    { key: 'sales', label: 'SALES', tone: 'section' },
    { key: 'totalSales', label: 'Total Sales', tone: 'primary' },
    { key: 'paid', label: 'Paid' },
    { key: 'balance', label: 'Balance' },
    { key: 'discounts', label: 'Discounts' },
    { key: 'couponDiscounts', label: 'Coupon Discounts' },
    { key: 'taxes', label: 'Taxes' },
    { key: 'exCharges', label: 'Ex Charges' },
    { key: 'giftCardsSale', label: 'Gift Cards Sale' },
    { key: 'expenses', label: 'Expenses' },
    { key: 'appointmentsAdvance', label: 'Appointments Advance' },
    { key: 'tips', label: 'Tips' }
  ];

  constructor(
    private readonly api: ApiService,
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
    this.load();
  }

  setActiveTab(tab: ReportTab): void {
    this.activeTab = tab;
    if (tab === 'daily-sheet') this.setDailySheetDate(this.dailySheetDate);
    if (tab !== 'daily-revenue') this.expandedDailyRevenueDate = '';
    if (this.needsFinancialControlData()) this.ensureFinancialControlDataLoaded();
    if (tab === 'member-sales') this.ensureMemberSalesDataLoaded();
    if (tab === 'sales-tax') this.ensureSalesTaxClientDataLoaded();
  }

  load(): void {
    this.loading.set(true);
    this.error.set('');
    forkJoin({
      invoices: this.safeList('invoices', { limit: 10000 }),
      payments: this.safeList('payments', { limit: 10000 }),
      sales: this.safeList('sales', { limit: 10000 }),
      branches: this.safeList('branches', { limit: 1000 }),
      walletTransactions: this.safeList('walletTransactions', { limit: 10000 }),
      walletLedgerReport: this.api.list<ApiRecord>('reports/financial-summary/wallet-ledger', this.walletLedgerParams()).pipe(catchError(() => of({ summary: {}, rows: [], alerts: [] } as ApiRecord))),
      financeSummary: this.api.list<ApiRecord>('finance/summary').pipe(catchError(() => of({} as ApiRecord)))
    }).subscribe({
      next: (data) => {
        this.invoices.set(data.invoices || []);
        this.payments.set(data.payments || []);
        this.sales.set(data.sales || []);
        this.branches.set(data.branches || []);
        this.walletTransactions.set(data.walletTransactions || []);
        this.walletLedgerReport.set(data.walletLedgerReport || { summary: {}, rows: [], alerts: [] });
        this.financeSummary.set(data.financeSummary || {});
        this.invalidateDailyRevenueCache();
        this.loading.set(false);
        if (this.needsFinancialControlData()) {
          this.financialControlDataLoaded = false;
          this.ensureFinancialControlDataLoaded();
        }
        if (this.activeTab === 'member-sales') {
          this.memberSalesDataLoaded = false;
          this.ensureMemberSalesDataLoaded();
        }
        if (this.activeTab === 'sales-tax') {
          this.salesTaxClientDataLoaded = false;
          this.ensureSalesTaxClientDataLoaded();
        }
      },
      error: (error) => {
        this.error.set(this.api.errorText(error, 'Unable to load financial summary'));
        this.loading.set(false);
      }
    });
  }

  matrixColumns(): MatrixColumn[] {
    return [
      { key: 'total', label: 'TOTAL' },
      ...this.periodColumns()
    ];
  }

  matrixRows(): MatrixCell[] {
    const modes = this.paymentModeRows();
    return [
      ...this.baseRows,
      ...modes
    ];
  }

  valueFor(rowKey: string, columnKey: string): number {
    if (rowKey === 'sales') return 0;
    const columns = columnKey === 'total' ? this.periodColumns() : this.periodColumns().filter((column) => column.key === columnKey);
    return this.money(columns.reduce((sum, column) => sum + this.valueForPeriod(rowKey, column), 0));
  }

  totalFor(rowKey: string): number {
    return this.valueFor(rowKey, 'total');
  }

  invoiceCount(): number {
    return this.filteredInvoices().length;
  }

  paymentDistributionCards(): PaymentDistributionCard[] {
    const rows = this.paymentRowsInDateRange();
    const amountFor = (modeKey: string) => rows
      .filter((row) => modeKey === 'all' || row.paymentModeKey === modeKey)
      .reduce((sum, row) => sum + row.price, 0);
    return [
      { key: 'count', filterKey: '', label: 'Payment Count', value: String(rows.length) },
      { key: 'total', filterKey: '', label: 'Total Amount', value: this.money(amountFor('all')).toFixed(2) },
      { key: 'card', filterKey: 'card', label: 'CARD', value: this.money(amountFor('card')).toFixed(2) },
      { key: 'cash', filterKey: 'cash', label: 'CASH', value: this.money(amountFor('cash')).toFixed(2) },
      { key: 'check', filterKey: 'check', label: 'Check', value: this.money(amountFor('check')).toFixed(2) },
      { key: 'dingg_payment', filterKey: 'dingg_payment', label: 'DINGG PAYMENT', value: this.money(amountFor('dingg_payment')).toFixed(2) },
      { key: 'upi', filterKey: 'upi', label: 'UPI', value: this.money(amountFor('upi')).toFixed(2) },
      { key: 'prepaid', filterKey: 'prepaid', label: 'Prepaid', value: this.money(amountFor('prepaid')).toFixed(2) },
      { key: 'reward', filterKey: 'reward', label: 'Reward', value: this.money(amountFor('reward')).toFixed(2) },
      { key: 'giftcard', filterKey: 'giftcard', label: 'Giftcard', value: this.money(amountFor('giftcard')).toFixed(2) }
    ];
  }

  selectPaymentDistributionCard(card: PaymentDistributionCard): void {
    this.paymentTypeFilter = card.filterKey;
    this.paymentSearch = '';
  }

  selectedPaymentReportTitle(): string {
    if (!this.paymentTypeFilter) return 'Payment Distributions';
    const selected = this.paymentTypeOptions().find((type) => type.key === this.paymentTypeFilter);
    return `${selected?.label || this.modeLabel(this.paymentTypeFilter)} Report`;
  }

  paymentTypeOptions(): Array<{ key: string; label: string }> {
    const baseline = new Map<string, string>([
      ['card', 'CARD'],
      ['cash', 'CASH'],
      ['check', 'Check'],
      ['dingg_payment', 'DINGG PAYMENT'],
      ['upi', 'UPI'],
      ['prepaid', 'Prepaid'],
      ['reward', 'Reward'],
      ['giftcard', 'Giftcard']
    ]);
    for (const row of this.paymentRowsInDateRange()) {
      baseline.set(row.paymentModeKey, row.paymentMode);
    }
    return [...baseline.entries()].map(([key, label]) => ({ key, label }));
  }

  paymentDistributionRows(): PaymentDistributionRow[] {
    return this.paymentRowsInDateRange()
      .filter((row) => !this.paymentTypeFilter || row.paymentModeKey === this.paymentTypeFilter)
      .sort((a, b) => this.dateMs(b.paymentDateValue) - this.dateMs(a.paymentDateValue));
  }

  visiblePaymentDistributionRows(): PaymentDistributionRow[] {
    const query = this.paymentSearch.trim().toLowerCase();
    return this.paymentDistributionRows().filter((row) => {
      if (!query) return true;
      return [
        row.name,
        row.contact,
        row.invoiceNo,
        row.paymentMode,
        row.transactionId,
        row.notes
      ].join(' ').toLowerCase().includes(query);
    });
  }

  netCashflow(): number {
    return this.money(this.totalFor('paid') - this.totalFor('expenses'));
  }

  collectionRate(): number {
    const total = this.totalFor('totalSales');
    return total ? this.money((this.totalFor('paid') / total) * 100) : 0;
  }

  discountRate(): number {
    const total = this.totalFor('totalSales');
    return total ? this.money((this.totalFor('discounts') / total) * 100) : 0;
  }

  topPaymentMode(): string {
    const modes = this.paymentModeRows()
      .map((row) => ({ label: row.label, amount: this.totalFor(row.key) }))
      .sort((a, b) => b.amount - a.amount);
    return modes[0]?.amount ? modes[0].label : 'No payment';
  }

  pendingRiskLabel(): string {
    const balance = this.totalFor('balance');
    const sales = this.totalFor('totalSales');
    if (!balance) return 'Clear';
    const rate = sales ? balance / sales : 0;
    if (rate >= 0.15) return 'High';
    if (rate >= 0.05) return 'Watch';
    return 'Low';
  }

  exportDisabled(): boolean {
    if (this.activeTab === 'summary') return !this.matrixColumns().length;
    if (this.activeTab === 'payments') return !this.paymentDistributionRows().length;
    if (this.activeTab === 'daily-sheet') return !this.dailySheetSummary().totalBills;
    if (this.activeTab === 'daily-revenue') return !this.dailyRevenueRows().length;
    if (this.activeTab === 'sales-tax') return !this.salesTaxRows().length;
    if (this.activeTab === 'wallet-ledger') return !this.walletLedgerRows().length;
    return !this.visibleMemberSalesRows().length;
  }

  walletLedgerRows(): WalletLedgerRow[] {
    const rows = this.arrayValue(this.walletLedgerReport()['rows']) as WalletLedgerRow[];
    const search = this.walletLedgerSearch.trim().toLowerCase();
    const type = this.walletLedgerTypeFilter.trim().toLowerCase();
    const source = this.walletLedgerSourceFilter.trim().toLowerCase();
    const paymentMode = this.walletLedgerPaymentModeFilter.trim().toLowerCase();
    return rows.filter((row) => {
      const text = `${row.clientName} ${row.clientPhone} ${row.referenceLabel} ${row.reason}`.toLowerCase();
      return (!search || text.includes(search))
        && (!type || String(row.transactionType || '').toLowerCase().includes(type))
        && (!source || String(row.source || '').toLowerCase().includes(source))
        && (!paymentMode || String(row.paymentMode || '').toLowerCase().includes(paymentMode));
    });
  }

  walletLedgerAlerts(): ApiRecord[] {
    const risk = this.walletLedgerRiskFilter.trim().toLowerCase();
    return this.arrayValue(this.walletLedgerReport()['alerts']).filter((alert) => !risk || String(alert['riskLevel'] || '').toLowerCase() === risk);
  }

  walletLedgerCards(): Array<{ label: string; value: string; detail: string }> {
    const summary = (this.walletLedgerReport()['summary'] || {}) as ApiRecord;
    return [
      { label: 'Total wallet liability', value: this.formatMoney(Number(summary['totalWalletLiability'] || 0)), detail: 'active client wallet balance' },
      { label: 'Wallet transaction count', value: String(this.walletLedgerRows().length), detail: 'filtered ledger rows' },
      { label: 'Total credited', value: this.formatMoney(this.walletLedgerRows().reduce((sum, row) => sum + Number(row.creditAmount || 0), 0)), detail: 'wallet money added' },
      { label: 'Total debited', value: this.formatMoney(this.walletLedgerRows().reduce((sum, row) => sum + Number(row.debitAmount || 0), 0)), detail: 'wallet money used' },
      { label: 'Net wallet movement', value: this.formatMoney(this.walletLedgerRows().reduce((sum, row) => sum + Number(row.creditAmount || 0) - Number(row.debitAmount || 0), 0)), detail: 'credit less debit' },
      { label: 'Clients with wallet balance', value: String(summary['clientsWithWalletBalance'] || 0), detail: 'liability clients' },
      { label: 'Manual adjustments', value: String(summary['manualAdjustments'] || 0), detail: 'manual wallet edits' },
      { label: 'Abuse alerts', value: String(this.walletLedgerAlerts().length), detail: 'needs audit review' }
    ];
  }

  exportWalletLedgerCsv(): void {
    const rows = this.walletLedgerRows();
    const csv = [
      ['Date', 'Time', 'Client name', 'Client phone', 'Branch', 'Transaction type', 'Credit amount', 'Debit amount', 'Balance after', 'Reason', 'Reference', 'Payment mode', 'Added by', 'Source'],
      ...rows.map((row) => [
        row.date,
        row.time,
        row.clientName,
        row.clientPhone,
        row.branchName,
        row.transactionType,
        row.creditAmount,
        row.debitAmount,
        row.balanceAfter,
        row.reason,
        row.referenceLabel,
        row.paymentMode,
        row.addedBy,
        row.source
      ])
    ].map((row) => row.map((cell) => this.csvCell(cell)).join(',')).join('\n');
    this.downloadFile(`wallet-ledger-${Date.now()}.csv`, csv, 'text/csv;charset=utf-8');
  }

  exportWalletOwnerPdf(): void {
    const lines = [
      'Wallet / Ewallet Ledger Owner Summary',
      `Date range: ${this.dateLabel(this.from)} to ${this.dateLabel(this.to)}`,
      `Branch: ${this.branchLabel()}`,
      ...this.walletLedgerCards().map((card) => `${card.label}: ${card.value} - ${card.detail}`),
      'Recent ledger:',
      ...this.walletLedgerRows().slice(0, 25).map((row) => `${row.date} ${row.time} | ${row.clientName} | credit ${this.formatMoney(Number(row.creditAmount || 0))} | debit ${this.formatMoney(Number(row.debitAmount || 0))} | balance ${this.formatMoney(Number(row.balanceAfter || 0))}`)
    ];
    this.downloadFile(`wallet-ledger-owner-${Date.now()}.pdf`, this.simplePdf(lines), 'application/pdf');
  }

  exportWalletAuditPdf(): void {
    const lines = [
      'Wallet / Ewallet Ledger Audit Alerts',
      `Date range: ${this.dateLabel(this.from)} to ${this.dateLabel(this.to)}`,
      `Branch: ${this.branchLabel()}`,
      ...this.walletLedgerAlerts().slice(0, 45).map((alert) => `${alert['riskLevel'] || 'medium'} | ${alert['alertType']} | ${alert['clientName'] || '-'} | ${this.formatMoney(Number(alert['amount'] || 0))} | ${alert['suggestedAction'] || 'Review wallet ledger'}`)
    ];
    this.downloadFile(`wallet-ledger-audit-${Date.now()}.pdf`, this.simplePdf(lines), 'application/pdf');
  }

  private walletLedgerParams(): ApiRecord {
    return {
      fromDate: this.from,
      toDate: this.to,
      client: this.walletLedgerSearch,
      transactionType: this.walletLedgerTypeFilter,
      source: this.walletLedgerSourceFilter,
      paymentMode: this.walletLedgerPaymentModeFilter,
      riskLevel: this.walletLedgerRiskFilter,
      branchId: this.api.selectedBranchId(),
      limit: 5000
    };
  }

  periodModeLabel(): string {
    return this.periodMode === 'quarter' ? 'Quarter view' : 'Month view';
  }

  branchLabel(): string {
    const branchId = this.api.selectedBranchId();
    if (!branchId) return 'All branches';
    return this.branches().find((branch) => String(branch.id) === String(branchId))?.['name'] || branchId;
  }

  invoiceQueryParams(value: unknown): { q: string } {
    const key = String(value || '').trim();
    const cached = this.invoiceQueryParamsCache.get(key);
    if (cached) return cached;
    const params = { q: key };
    this.invoiceQueryParamsCache.set(key, params);
    return params;
  }

  dateLabel(value: string): string {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  }

  compactDateLabel(value: string): string {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value || '-';
    return date.toLocaleDateString('en-IN', { day: '2-digit', month: '2-digit', year: 'numeric' }).replace(/\//g, '-');
  }

  toggleDailyRevenueDate(dateKey: string): void {
    this.expandedDailyRevenueDate = this.expandedDailyRevenueDate === dateKey ? '' : dateKey;
  }

  exportCsv(): void {
    if (this.activeTab === 'daily-sheet') {
      this.exportDailySheetCsv();
      return;
    }
    if (this.activeTab === 'daily-revenue') {
      this.exportDailyRevenueCsv();
      return;
    }
    if (this.activeTab === 'member-sales') {
      this.exportMemberSalesCsv();
      return;
    }
    if (this.activeTab === 'sales-tax') {
      this.exportSalesTaxCsv();
      return;
    }
    if (this.activeTab === 'payments') {
      this.exportPaymentDistributionCsv();
      return;
    }
    if (this.activeTab === 'wallet-ledger') {
      this.exportWalletLedgerCsv();
      return;
    }
    const columns = this.matrixColumns();
    const rows = this.matrixRows();
    const csv = [
      ['Sales', ...columns.map((column) => column.label)].map((cell) => this.csvCell(cell)).join(','),
      ...rows.map((row) => [
        row.label,
        ...columns.map((column) => row.tone === 'section' ? '' : this.valueFor(row.key, column.key).toFixed(2))
      ].map((cell) => this.csvCell(cell)).join(','))
    ].join('\n');
    this.downloadFile(`financial-summary-${Date.now()}.csv`, csv, 'text/csv;charset=utf-8');
  }

  printReport(): void {
    window.print();
  }

  setDailySheetDate(value: string): void {
    if (!value) return;
    this.from = value;
    this.to = value;
  }

  dailySheetSummary(): DailySheetSummary {
    const invoices = this.dailyInvoices();
    const lines = this.linesForInvoices(invoices);
    const grossSale = this.money(lines.reduce((sum, line) => sum + this.lineGross(line), 0) || invoices.reduce((sum, invoice) => sum + this.invoiceTotal(invoice) + this.invoiceDiscount(invoice), 0));
    const netSale = this.money(invoices.reduce((sum, invoice) => sum + this.invoiceTotal(invoice), 0));
    const totalBills = invoices.length;
    return {
      totalBills,
      billAverage: totalBills ? this.money(netSale / totalBills) : 0,
      grossSale,
      netSale,
      totalReceived: this.dailyPayments().reduce((sum, payment) => sum + this.paymentAmount(payment), 0),
      pendingUnpaid: this.money(invoices.reduce((sum, invoice) => sum + this.invoiceBalance(invoice), 0)),
      discount: this.money(invoices.reduce((sum, invoice) => sum + this.invoiceDiscount(invoice), 0)),
      couponDiscount: this.money(invoices.reduce((sum, invoice) => sum + this.couponDiscount(invoice), 0)),
      membershipDiscount: this.money(invoices.reduce((sum, invoice) => sum + this.membershipDiscount(invoice), 0)),
      gstTax: this.money(invoices.reduce((sum, invoice) => sum + this.invoiceTax(invoice), 0)),
      expenses: this.dailyExpensesTotal(),
      staffTips: this.money(invoices.reduce((sum, invoice) => sum + this.invoiceTips(invoice), 0))
    };
  }

  dailySheetItemRows(): ApiRecord[] {
    const invoices = this.dailyInvoices();
    const lines = this.linesForInvoices(invoices);
    const rowFor = (label: string, predicate: (line: ApiRecord) => boolean, receivedFromTotal = false) => {
      const matched = lines.filter(predicate);
      const total = this.money(matched.reduce((sum, line) => sum + this.lineAmount(line), 0));
      return { label, count: matched.length, received: receivedFromTotal ? this.dailySheetSummary().totalReceived : total, total };
    };
    const prepaidPayments = this.dailyPayments().filter((payment) => ['prepaid', 'wallet', 'reward', 'giftcard'].includes(this.modeKey(this.paymentMode(payment))));
    return [
      rowFor('Services', (line) => this.normalizedItemType(line) === 'service'),
      { label: 'Services By Prepaid, giftcard and Rewards', count: prepaidPayments.length, received: this.money(prepaidPayments.reduce((sum, payment) => sum + this.paymentAmount(payment), 0)), total: this.money(prepaidPayments.reduce((sum, payment) => sum + this.paymentAmount(payment), 0)) },
      rowFor('Products', (line) => this.normalizedItemType(line) === 'product'),
      rowFor('Packages', (line) => this.normalizedItemType(line) === 'package'),
      rowFor('Memberships', (line) => this.normalizedItemType(line) === 'membership'),
      rowFor('Gift Cards', (line) => this.normalizedItemType(line) === 'gift_card'),
      { label: 'Appointments Advance', count: this.dailyPayments().filter((payment) => this.isAdvancePayment(payment)).length, received: this.money(this.dailyPayments().filter((payment) => this.isAdvancePayment(payment)).reduce((sum, payment) => sum + this.paymentAmount(payment), 0)), total: this.money(this.dailyPayments().filter((payment) => this.isAdvancePayment(payment)).reduce((sum, payment) => sum + this.paymentAmount(payment), 0)) },
      { label: 'Prepaid/Wallet/Reward Payments', count: prepaidPayments.length, received: this.money(prepaidPayments.reduce((sum, payment) => sum + this.paymentAmount(payment), 0)), total: this.money(prepaidPayments.reduce((sum, payment) => sum + this.paymentAmount(payment), 0)) },
      { label: 'Pending Payments', count: invoices.filter((invoice) => this.invoiceBalance(invoice) > 0).length, received: this.dailySheetSummary().pendingUnpaid, total: this.dailySheetSummary().pendingUnpaid },
      { label: 'Staff Tips', count: invoices.filter((invoice) => this.invoiceTips(invoice) > 0).length, received: this.dailySheetSummary().staffTips, total: this.dailySheetSummary().staffTips },
      { label: 'Discount', count: invoices.filter((invoice) => this.invoiceDiscount(invoice) > 0).length, received: -this.dailySheetSummary().discount, total: -this.dailySheetSummary().discount },
      { label: 'Coupon Discount', count: invoices.filter((invoice) => this.couponDiscount(invoice) > 0).length, received: -this.dailySheetSummary().couponDiscount, total: -this.dailySheetSummary().couponDiscount },
      { label: 'Membership Discount', count: invoices.filter((invoice) => this.membershipDiscount(invoice) > 0).length, received: -this.dailySheetSummary().membershipDiscount, total: -this.dailySheetSummary().membershipDiscount },
      { label: 'Taxes', count: invoices.filter((invoice) => this.invoiceTax(invoice) > 0).length, received: this.dailySheetSummary().gstTax, total: this.dailySheetSummary().gstTax },
      { label: 'Ex Charges', count: invoices.filter((invoice) => this.extraCharges(invoice) > 0).length, received: this.money(invoices.reduce((sum, invoice) => sum + this.extraCharges(invoice), 0)), total: this.money(invoices.reduce((sum, invoice) => sum + this.extraCharges(invoice), 0)) }
    ];
  }

  dailySheetPaymentRows(): ApiRecord[] {
    const rows = this.dailyPayments();
    const expected = ['cash', 'upi', 'card', 'wallet', 'online', 'payment_link', 'prepaid', 'reward', 'giftcard'];
    const labels: Record<string, string> = { online: 'Online/payment link', payment_link: 'Online/payment link' };
    const map = new Map<string, ApiRecord>();
    for (const key of expected) map.set(key, { key, label: labels[key] || this.modeLabel(key), count: 0, amount: 0 });
    for (const payment of rows) {
      const key = this.dailyPaymentModeKey(payment);
      const current = map.get(key) || { key, label: this.modeLabel(key), count: 0, amount: 0 };
      current['count'] = Number(current['count'] || 0) + 1;
      current['amount'] = this.money(Number(current['amount'] || 0) + this.paymentAmount(payment));
      map.set(key, current);
    }
    const dueReceived = rows.filter((payment) => this.isDueReceivedPayment(payment));
    return [
      ...[...map.values()].filter((row) => Number(row['amount'] || 0) > 0 || ['cash', 'upi', 'card', 'wallet', 'online'].includes(String(row['key']))),
      { key: 'due_received', label: 'Due received today', count: dueReceived.length, amount: this.money(dueReceived.reduce((sum, payment) => sum + this.paymentAmount(payment), 0)) },
      { key: 'total_received', label: 'Total received', count: rows.length, amount: this.dailySheetSummary().totalReceived }
    ];
  }

  dailySheetReconciliationRows(): ApiRecord[] {
    const cashAmount = Number(this.dailySheetPaymentRows().find((row) => row['key'] === 'cash')?.['amount'] || 0);
    const expenses = this.dailySheetSummary().expenses;
    const drawer = this.dailyCashDrawerRecord();
    const expectedCash = this.money(this.cashDrawerValue(drawer, ['expectedCashPaise', 'expected_cash_paise'], ['expectedCash', 'expected_cash']) || cashAmount - expenses);
    const actualCash = this.money(this.cashDrawerValue(drawer, ['countedCashPaise', 'counted_cash_paise'], ['countedCash', 'actualCash', 'actual_cash']));
    const cashDifference = actualCash ? this.money(actualCash - expectedCash) : this.money(this.cashDrawerValue(drawer, ['variancePaise', 'variance_paise'], ['variance', 'cashDifference', 'cash_difference']));
    const audit = this.dailyAuditRows();
    return [
      { label: 'Expected cash', value: expectedCash, note: drawer ? 'Cash drawer expected cash' : 'Cash received less expenses fallback' },
      { label: 'Actual cash', value: actualCash, note: actualCash ? 'Cash counted in drawer' : 'Actual cash not captured' },
      { label: 'Cash difference', value: cashDifference, note: cashDifference ? 'Short/excess needs review' : 'No variance linked' },
      { label: 'Refund / return', value: this.dailyRefundAmount(), note: 'Negative/refund payment and return invoice signals' },
      { label: 'Deleted / void invoices', value: this.dailyDeletedVoidCount(), note: 'Audit + invoice status count' },
      { label: 'Edited invoices', value: audit.filter((log) => this.auditText(log).includes('edit')).length, note: 'Invoice edit audit signals' },
      { label: 'High discount alerts', value: this.dailyHighDiscountInvoices().length, note: 'Discount above 20% or >= INR 5,000' }
    ];
  }

  dailySheetStaffRows(): ApiRecord[] {
    const invoices = this.dailyInvoices();
    const linesByStaff = new Map<string, ApiRecord>();
    for (const invoice of invoices) {
      const invoiceLines = this.linesForInvoices([invoice]);
      const invoiceTotal = this.invoiceTotal(invoice);
      const invoiceBalance = this.invoiceBalance(invoice);
      for (const line of invoiceLines.length ? invoiceLines : [{ name: 'Invoice', type: 'service', total: invoiceTotal, staffName: invoice['staffName'] || invoice['staff_name'] }]) {
        const staffName = this.staffNameForLine(line, invoice);
        const current = linesByStaff.get(staffName) || { staffName, serviceSale: 0, productSale: 0, discountGiven: 0, tips: 0, unpaidAmount: 0, commissionBase: 0 };
        const amount = this.lineAmount(line);
        const type = this.normalizedItemType(line);
        if (type === 'product') current['productSale'] = this.money(Number(current['productSale'] || 0) + amount);
        if (type === 'service') current['serviceSale'] = this.money(Number(current['serviceSale'] || 0) + amount);
        current['discountGiven'] = this.money(Number(current['discountGiven'] || 0) + this.lineDiscountAmount(line));
        current['commissionBase'] = this.money(Number(current['commissionBase'] || 0) + Math.max(0, amount - this.lineDiscountAmount(line)));
        if (invoiceTotal > 0) current['unpaidAmount'] = this.money(Number(current['unpaidAmount'] || 0) + (amount / invoiceTotal) * invoiceBalance);
        linesByStaff.set(staffName, current);
      }
      const invoiceStaff = String(invoice['staffName'] || invoice['staff_name'] || 'Unassigned');
      const staffRow = linesByStaff.get(invoiceStaff) || { staffName: invoiceStaff, serviceSale: 0, productSale: 0, discountGiven: 0, tips: 0, unpaidAmount: 0, commissionBase: 0 };
      staffRow['tips'] = this.money(Number(staffRow['tips'] || 0) + this.invoiceTips(invoice));
      linesByStaff.set(invoiceStaff, staffRow);
    }
    return [...linesByStaff.values()].sort((a, b) => Number(b['commissionBase']) - Number(a['commissionBase']));
  }

  dailyRevenueRows(): DailyRevenueRow[] {
    const key = this.dailyRevenueCacheKey();
    if (this.dailyRevenueRowsCache.key !== key) {
      this.dailyRevenueRowsCache = { key, rows: this.dailyRevenueRowsForRange(this.from, this.to) };
    }
    return this.dailyRevenueRowsCache.rows;
  }

  dailyRevenueKpis(): ApiRecord {
    const key = this.dailyRevenueCacheKey();
    if (this.dailyRevenueKpisCache.key === key) return this.dailyRevenueKpisCache.value;
    const rows = this.dailyRevenueRows();
    const totals = this.dailyRevenueTotals(rows);
    const previous = this.previousRevenueRange();
    const previousTotals = this.dailyRevenueTotals(this.dailyRevenueRowsForRange(previous.from, previous.to));
    const sortedBySale = [...rows].sort((a, b) => b.netSale - a.netSale);
    const activeRows = rows.filter((row) => row.totalBillCount || row.netSale || row.receivedAmount || row.expenses);
    const best = sortedBySale[0];
    const lowest = [...activeRows].sort((a, b) => a.netSale - b.netSale)[0];
    const growthRate = previousTotals.netSale ? ((totals.netSale - previousTotals.netSale) / previousTotals.netSale) * 100 : (totals.netSale ? 100 : 0);
    const pendingDueTrend = this.money(totals.pendingDueAmount - previousTotals.pendingDueAmount);
    const value = {
      bestRevenueDay: best?.dateLabel || '-',
      bestRevenueValue: best?.netSale || 0,
      lowestRevenueDay: lowest?.dateLabel || '-',
      lowestRevenueValue: lowest?.netSale || 0,
      averageDailySale: activeRows.length ? this.money(totals.netSale / activeRows.length) : 0,
      growthRate: this.money(growthRate),
      growthLabel: previousTotals.netSale ? 'Compared with previous period' : 'No previous period baseline',
      pendingDueTrend,
      pendingDueLabel: pendingDueTrend > 0 ? 'Due increased vs previous period' : pendingDueTrend < 0 ? 'Due reduced vs previous period' : 'Due stable',
      discountLeakageRate: totals.grossSale ? this.money(((totals.discount + totals.couponDiscount + totals.membershipDiscount) / totals.grossSale) * 100) : 0,
      collectionRate: totals.netSale ? this.money((totals.receivedAmount / totals.netSale) * 100) : 0
    };
    this.dailyRevenueKpisCache = { key, value };
    return value;
  }

  dailyRevenueChart(): ApiRecord[] {
    const key = this.dailyRevenueCacheKey();
    if (this.dailyRevenueChartCache.key === key) return this.dailyRevenueChartCache.value;
    const rows = [...this.dailyRevenueRows()].reverse();
    const max = Math.max(1, ...rows.map((row) => row.netSale));
    const value = rows.map((row) => ({
      label: row.dateLabel,
      value: row.netSale,
      height: Math.max(6, this.money((row.netSale / max) * 100))
    }));
    this.dailyRevenueChartCache = { key, value };
    return value;
  }

  serviceProductChart(): ApiRecord[] {
    const key = this.dailyRevenueCacheKey();
    if (this.serviceProductChartCache.key === key) return this.serviceProductChartCache.value;
    const value = [...this.dailyRevenueRows()].reverse().map((row) => {
      const total = Math.max(1, row.serviceSale + row.productSale);
      return {
        label: row.dateLabel,
        serviceWidth: this.money((row.serviceSale / total) * 100),
        productWidth: this.money((row.productSale / total) * 100)
      };
    });
    this.serviceProductChartCache = { key, value };
    return value;
  }

  paymentModeTrendChart(): ApiRecord[] {
    const key = this.dailyRevenueCacheKey();
    if (this.paymentModeTrendChartCache.key === key) return this.paymentModeTrendChartCache.value;
    const value = [...this.dailyRevenueRows()].reverse().map((row) => {
      const payments = this.paymentsForDateKey(row.dateKey);
      const amountFor = (mode: string) => payments
        .filter((payment) => this.dailyPaymentModeKey(payment) === mode)
        .reduce((sum, payment) => sum + this.paymentAmount(payment), 0);
      const cash = amountFor('cash');
      const upi = amountFor('upi');
      const card = amountFor('card');
      const wallet = payments
        .filter((payment) => ['wallet', 'prepaid', 'reward', 'giftcard', 'online'].includes(this.dailyPaymentModeKey(payment)))
        .reduce((sum, payment) => sum + this.paymentAmount(payment), 0);
      const total = Math.max(1, cash + upi + card + wallet);
      return {
        label: row.dateLabel,
        cashWidth: this.money((cash / total) * 100),
        upiWidth: this.money((upi / total) * 100),
        cardWidth: this.money((card / total) * 100),
        walletWidth: this.money((wallet / total) * 100)
      };
    });
    this.paymentModeTrendChartCache = { key, value };
    return value;
  }

  discountVsNetChart(): ApiRecord[] {
    const key = this.dailyRevenueCacheKey();
    if (this.discountVsNetChartCache.key === key) return this.discountVsNetChartCache.value;
    const value = [...this.dailyRevenueRows()].reverse().map((row) => {
      const discount = row.discount + row.couponDiscount + row.membershipDiscount;
      const total = Math.max(1, row.netSale + discount);
      return {
        label: row.dateLabel,
        netWidth: this.money((row.netSale / total) * 100),
        discountWidth: this.money((discount / total) * 100)
      };
    });
    this.discountVsNetChartCache = { key, value };
    return value;
  }

  pendingDueAgingChart(): ApiRecord[] {
    const key = this.dailyRevenueCacheKey();
    if (this.pendingDueAgingChartCache.key === key) return this.pendingDueAgingChartCache.value;
    const buckets = new Map<string, ApiRecord>([
      ['0-7 days', { label: '0-7 days', count: 0, amount: 0 }],
      ['8-15 days', { label: '8-15 days', count: 0, amount: 0 }],
      ['16-30 days', { label: '16-30 days', count: 0, amount: 0 }],
      ['30+ days', { label: '30+ days', count: 0, amount: 0 }]
    ]);
    const now = this.dateMs(this.to || this.today()) || Date.now();
    for (const invoice of this.filteredInvoices().filter((row) => this.invoiceBalance(row) > 0)) {
      const age = Math.max(0, Math.floor((now - this.dateMs(this.invoiceDate(invoice))) / 86400000));
      const label = age <= 7 ? '0-7 days' : age <= 15 ? '8-15 days' : age <= 30 ? '16-30 days' : '30+ days';
      const bucket = buckets.get(label);
      if (!bucket) continue;
      bucket['count'] = Number(bucket['count'] || 0) + 1;
      bucket['amount'] = this.money(Number(bucket['amount'] || 0) + this.invoiceBalance(invoice));
    }
    const value = [...buckets.values()];
    this.pendingDueAgingChartCache = { key, value };
    return value;
  }

  dailyRevenueAlerts(): ApiRecord[] {
    const key = this.dailyRevenueCacheKey();
    if (this.dailyRevenueAlertsCache.key === key) return this.dailyRevenueAlertsCache.value;
    const rows = this.dailyRevenueRows();
    const totals = this.dailyRevenueTotals(rows);
    const highDiscount = [...rows].sort((a, b) => this.dailyDiscountRate(b) - this.dailyDiscountRate(a))[0];
    const lowCollection = [...rows].filter((row) => row.netSale > 0).sort((a, b) => this.dailyCollectionRate(a) - this.dailyCollectionRate(b))[0];
    const highExpense = [...rows].sort((a, b) => b.expenses - a.expenses)[0];
    const highDue = [...rows].sort((a, b) => b.pendingDueAmount - a.pendingDueAmount)[0];
    const lowProduct = rows.filter((row) => row.netSale > 0 && row.productSale <= 0)[0];
    const cashMismatch = this.dailyRevenueCashMismatch();
    const gstRisk = rows.filter((row) => row.netSale > 0 && row.gst <= 0);
    const value = [
      { label: 'High discount day', value: highDiscount ? `${this.dailyDiscountRate(highDiscount).toFixed(1)}%` : '0%', detail: highDiscount ? highDiscount.dateLabel : 'No discount risk', tone: highDiscount && this.dailyDiscountRate(highDiscount) >= 20 ? 'danger' : 'normal' },
      { label: 'Low collection day', value: lowCollection ? `${this.dailyCollectionRate(lowCollection).toFixed(1)}%` : '100%', detail: lowCollection ? lowCollection.dateLabel : 'No low collection day', tone: lowCollection && this.dailyCollectionRate(lowCollection) < 80 ? 'warn' : 'normal' },
      { label: 'Expenses high day', value: highExpense ? this.formatMoney(highExpense.expenses) : 'â‚¹0', detail: highExpense ? highExpense.dateLabel : 'No expenses', tone: highExpense && totals.netSale && highExpense.expenses / totals.netSale > 0.12 ? 'warn' : 'normal' },
      { label: 'Due unusually high', value: highDue ? this.formatMoney(highDue.pendingDueAmount) : 'â‚¹0', detail: highDue ? highDue.dateLabel : 'No due risk', tone: highDue && highDue.pendingDueAmount > highDue.receivedAmount * 0.2 ? 'danger' : 'normal' },
      { label: 'Product sale low', value: lowProduct ? 'No product sale' : this.formatMoney(totals.productSale), detail: lowProduct ? lowProduct.dateLabel : 'Product revenue present', tone: lowProduct ? 'warn' : 'normal' },
      { label: 'Cash mismatch with drawer', value: this.formatMoney(cashMismatch), detail: cashMismatch ? 'Drawer variance linked' : 'No cash mismatch signal', tone: cashMismatch ? 'danger' : 'normal' },
      { label: 'GST mismatch risk', value: String(gstRisk.length), detail: gstRisk.length ? 'Revenue days without GST signal' : 'GST signal present', tone: gstRisk.length ? 'warn' : 'normal' }
    ];
    this.dailyRevenueAlertsCache = { key, value };
    return value;
  }

  dailyRevenueDrilldown(dateKey: string): ApiRecord {
    const cacheKey = `${this.dailyRevenueCacheKey()}|${dateKey}`;
    const cached = this.dailyRevenueDrilldownCache.get(cacheKey);
    if (cached) return cached;
    const invoices = this.invoicesForDateKey(dateKey);
    const payments = this.paymentsForDateKey(dateKey);
    const lines = this.linesForInvoices(invoices);
    const staffMap = new Map<string, number>();
    const serviceMap = new Map<string, number>();
    const modeMap = new Map<string, number>();
    for (const invoice of invoices) {
      const invoiceLines = this.linesForInvoices([invoice]);
      for (const line of invoiceLines.length ? invoiceLines : [{ name: 'Invoice', type: 'service', total: this.invoiceTotal(invoice), staffName: invoice['staffName'] || invoice['staff_name'] }]) {
        const staff = this.staffNameForLine(line, invoice);
        staffMap.set(staff, this.money((staffMap.get(staff) || 0) + this.lineAmount(line)));
      }
    }
    for (const line of lines.filter((line) => this.normalizedItemType(line) === 'service')) {
      const name = String(line['name'] || line['serviceName'] || line['service_name'] || line['itemName'] || 'Service');
      serviceMap.set(name, this.money((serviceMap.get(name) || 0) + this.lineAmount(line)));
    }
    for (const payment of payments) {
      const mode = this.modeLabel(this.dailyPaymentModeKey(payment));
      modeMap.set(mode, this.money((modeMap.get(mode) || 0) + this.paymentAmount(payment)));
    }
    const dueInvoices = invoices.filter((invoice) => this.invoiceBalance(invoice) > 0);
    const recovered = payments.filter((payment) => this.isDueReceivedPayment(payment));
    const highDiscounts = invoices.filter((invoice) => {
      const discount = this.invoiceDiscount(invoice) + this.couponDiscount(invoice) + this.membershipDiscount(invoice);
      const gross = this.invoiceTotal(invoice) + discount;
      return gross > 0 && (discount / gross) * 100 >= 20;
    });
    const audit = this.auditLogsForDateKey(dateKey).filter((log) => ['edit', 'delete', 'deleted', 'void', 'cancel'].some((token) => this.auditText(log).includes(token)));
    const topStaff = this.topMapEntry(staffMap);
    const topService = this.topMapEntry(serviceMap);
    const topMode = this.topMapEntry(modeMap);
    const value = {
      invoiceCount: invoices.length,
      invoiceNumbers: invoices.slice(0, 8).map((invoice) => invoice['invoiceNumber'] || invoice['invoice_number'] || invoice['number'] || invoice['id']).filter(Boolean).join(', '),
      topStaff: topStaff?.[0] || '',
      staffSummary: this.mapSummary(staffMap),
      topService: topService?.[0] || '',
      serviceSummary: this.mapSummary(serviceMap),
      topMode: topMode?.[0] || '',
      paymentModeSummary: this.mapSummary(modeMap),
      dueSummary: `${dueInvoices.length} pending Â· ${this.formatMoney(dueInvoices.reduce((sum, invoice) => sum + this.invoiceBalance(invoice), 0))}`,
      recoveredSummary: `${recovered.length} recovered payment(s) Â· ${this.formatMoney(recovered.reduce((sum, payment) => sum + this.paymentAmount(payment), 0))}`,
      highDiscountCount: highDiscounts.length,
      highDiscountInvoices: highDiscounts.slice(0, 8).map((invoice) => invoice['invoiceNumber'] || invoice['invoice_number'] || invoice['number'] || invoice['id']).filter(Boolean).join(', '),
      auditCount: audit.length,
      auditSummary: audit.slice(0, 4).map((log) => String(log['action'] || log['event'] || log['type'] || 'audit')).join(', ')
    };
    this.dailyRevenueDrilldownCache.set(cacheKey, value);
    return value;
  }

  memberSalesRows(): MemberSalesRow[] {
    const rowsByClient = new Map<string, MemberSalesRow>();
    const invoices = this.filteredInvoices();
    for (const invoice of invoices) {
      const clientId = this.invoiceClientId(invoice);
      const client = this.clientForInvoice(invoice);
      const key = clientId || this.invoiceClientPhone(invoice) || this.invoiceClientName(invoice);
      const memberships = this.membershipsForClient(clientId, client);
      const activeMembership = memberships.find((membership) => this.isActiveMembership(membership));
      const expiredMembership = !activeMembership && memberships.length > 0;
      const row = rowsByClient.get(key) || {
        clientId,
        clientName: this.invoiceClientName(invoice, client),
        phone: this.invoiceClientPhone(invoice, client),
        membershipStatus: activeMembership ? 'Active member' : expiredMembership ? 'Expired member' : 'Non-member',
        activePlanName: String(activeMembership?.['planName'] || activeMembership?.['plan_name'] || activeMembership?.['name'] || memberships[0]?.['planName'] || ''),
        totalVisits: 0,
        totalSale: 0,
        paidAmount: 0,
        pendingAmount: 0,
        discountUsed: 0,
        lastVisitDate: '',
        suggestedAction: '',
        isMember: !!activeMembership,
        isExpiredMember: expiredMembership
      };
      row.totalVisits += 1;
      row.totalSale = this.money(row.totalSale + this.invoiceTotal(invoice));
      row.paidAmount = this.money(row.paidAmount + this.invoicePaid(invoice));
      row.pendingAmount = this.money(row.pendingAmount + this.invoiceBalance(invoice));
      row.discountUsed = this.money(row.discountUsed + this.invoiceDiscount(invoice) + this.couponDiscount(invoice) + this.membershipDiscount(invoice));
      const invoiceDate = this.invoiceDate(invoice);
      row.lastVisitDate = !row.lastVisitDate || this.dateMs(invoiceDate) > this.dateMs(row.lastVisitDate) ? invoiceDate : row.lastVisitDate;
      row.suggestedAction = this.memberSuggestedAction(row);
      rowsByClient.set(key, row);
    }
    return [...rowsByClient.values()].sort((a, b) => b.totalSale - a.totalSale);
  }

  visibleMemberSalesRows(): MemberSalesRow[] {
    const query = this.memberSalesSearch.trim().toLowerCase();
    return this.memberSalesRows().filter((row) => {
      if (this.memberClientTypeFilter === 'members' && !row.isMember) return false;
      if (this.memberClientTypeFilter === 'non-members' && row.isMember) return false;
      if (!query) return true;
      return [row.clientName, row.phone, row.membershipStatus, row.activePlanName, row.suggestedAction].join(' ').toLowerCase().includes(query);
    });
  }

  memberSalesSummary(): ApiRecord {
    const rows = this.visibleMemberSalesRows();
    const members = rows.filter((row) => row.isMember);
    const nonMembers = rows.filter((row) => !row.isMember);
    const totalRevenue = rows.reduce((sum, row) => sum + row.totalSale, 0);
    const memberRevenue = members.reduce((sum, row) => sum + row.totalSale, 0);
    const nonMemberRevenue = nonMembers.reduce((sum, row) => sum + row.totalSale, 0);
    const paidAmount = rows.reduce((sum, row) => sum + row.paidAmount, 0);
    const pendingAmount = rows.reduce((sum, row) => sum + row.pendingAmount, 0);
    return {
      memberClients: members.length,
      nonMemberClients: nonMembers.length,
      memberRevenue: this.money(memberRevenue),
      nonMemberRevenue: this.money(nonMemberRevenue),
      memberVisits: members.reduce((sum, row) => sum + row.totalVisits, 0),
      nonMemberVisits: nonMembers.reduce((sum, row) => sum + row.totalVisits, 0),
      paidAmount: this.money(paidAmount),
      pendingAmount: this.money(pendingAmount),
      collectionRate: totalRevenue ? this.money((paidAmount / totalRevenue) * 100) : 0,
      memberRevenueShare: totalRevenue ? this.money((memberRevenue / totalRevenue) * 100) : 0,
      nonMemberRevenueShare: totalRevenue ? this.money((nonMemberRevenue / totalRevenue) * 100) : 0
    };
  }

  memberComparisonRows(): ApiRecord[] {
    const rows = this.visibleMemberSalesRows();
    const memberRows = rows.filter((row) => row.isMember);
    const nonMemberRows = rows.filter((row) => !row.isMember);
    const total = (items: MemberSalesRow[], key: keyof MemberSalesRow) => this.money(items.reduce((sum, row) => sum + Number(row[key] || 0), 0));
    const avg = (items: MemberSalesRow[]) => items.length ? this.money(total(items, 'totalSale') / Math.max(1, total(items, 'totalVisits'))) : 0;
    const collection = (items: MemberSalesRow[]) => total(items, 'totalSale') ? this.money((total(items, 'paidAmount') / total(items, 'totalSale')) * 100) : 0;
    const totalRevenue = total(rows, 'totalSale');
    return [
      { label: 'Revenue', member: this.formatMoney(total(memberRows, 'totalSale')), nonMember: this.formatMoney(total(nonMemberRows, 'totalSale')) },
      { label: 'Average bill', member: this.formatMoney(avg(memberRows)), nonMember: this.formatMoney(avg(nonMemberRows)) },
      { label: 'Visit frequency', member: String(total(memberRows, 'totalVisits')), nonMember: String(total(nonMemberRows, 'totalVisits')) },
      { label: 'Paid amount', member: this.formatMoney(total(memberRows, 'paidAmount')), nonMember: this.formatMoney(total(nonMemberRows, 'paidAmount')) },
      { label: 'Pending amount', member: this.formatMoney(total(memberRows, 'pendingAmount')), nonMember: this.formatMoney(total(nonMemberRows, 'pendingAmount')) },
      { label: 'Collection rate %', member: `${collection(memberRows).toFixed(1)}%`, nonMember: `${collection(nonMemberRows).toFixed(1)}%` },
      { label: 'Revenue share %', member: `${(totalRevenue ? this.money((total(memberRows, 'totalSale') / totalRevenue) * 100) : 0).toFixed(1)}%`, nonMember: `${(totalRevenue ? this.money((total(nonMemberRows, 'totalSale') / totalRevenue) * 100) : 0).toFixed(1)}%` }
    ];
  }

  membershipRoiRows(): ApiRecord[] {
    const memberRows = this.visibleMemberSalesRows().filter((row) => row.isMember);
    const membershipSaleAmount = this.money(this.linesForInvoices(this.filteredInvoices()).filter((line) => this.normalizedItemType(line) === 'membership').reduce((sum, line) => sum + this.lineAmount(line), 0));
    const membershipDiscountGiven = this.money(memberRows.reduce((sum, row) => sum + row.discountUsed, 0));
    const memberRevenue = this.money(memberRows.reduce((sum, row) => sum + row.totalSale, 0));
    const repeatMembers = memberRows.filter((row) => row.totalVisits > 1);
    const benefitAbuse = memberRows.filter((row) => row.totalSale > 0 && row.discountUsed / row.totalSale >= 0.25);
    return [
      { label: 'Membership sale amount', value: this.formatMoney(membershipSaleAmount) },
      { label: 'Membership discount given', value: this.formatMoney(membershipDiscountGiven) },
      { label: 'Revenue generated by members', value: this.formatMoney(memberRevenue) },
      { label: 'Repeat visits by members', value: String(repeatMembers.reduce((sum, row) => sum + row.totalVisits, 0)) },
      { label: 'Member retention %', value: `${(memberRows.length ? this.money((repeatMembers.length / memberRows.length) * 100) : 0).toFixed(1)}%` },
      { label: 'Membership payback value', value: this.formatMoney(memberRevenue - membershipDiscountGiven + membershipSaleAmount) },
      { label: 'Benefit abuse / high discount alert', value: String(benefitAbuse.length) }
    ];
  }

  memberConversionOpportunities(): ApiRecord[] {
    return this.visibleMemberSalesRows()
      .filter((row) => !row.isMember && (row.totalSale >= 5000 || row.totalVisits >= 2 || row.pendingAmount > 0))
      .slice(0, 20)
      .map((row) => ({
        ...row,
        suggestedPlan: row.totalSale >= 12000 ? 'Gold membership' : row.totalVisits >= 2 ? 'Visit pack / Silver membership' : 'Starter discount membership',
        potentialRevenue: this.money(row.totalSale * 1.15),
        followUpAction: row.pendingAmount > 0 ? 'Recover due + offer membership' : 'WhatsApp / call / offer'
      }));
  }

  memberStaffImpactRows(): ApiRecord[] {
    const map = new Map<string, ApiRecord>();
    const memberRows = this.memberSalesRows();
    for (const invoice of this.filteredInvoices()) {
      const invoiceClientId = this.invoiceClientId(invoice);
      const invoicePhone = this.invoiceClientPhone(invoice);
      const row = memberRows.find((item) => (!!invoiceClientId && item.clientId === invoiceClientId) || item.phone === invoicePhone);
      const staffName = String(invoice['staffName'] || invoice['staff_name'] || invoice['createdByName'] || invoice['created_by_name'] || 'Unassigned');
      const current = map.get(staffName) || { staffName, memberSales: 0, nonMemberSales: 0, memberConversionCount: new Set<string>(), repeatMemberVisits: 0, memberPending: 0, nonMemberPending: 0 };
      if (row?.isMember) {
        current['memberSales'] = this.money(Number(current['memberSales'] || 0) + this.invoiceTotal(invoice));
        current['memberPending'] = this.money(Number(current['memberPending'] || 0) + this.invoiceBalance(invoice));
        current['repeatMemberVisits'] = Number(current['repeatMemberVisits'] || 0) + (row.totalVisits > 1 ? 1 : 0);
        (current['memberConversionCount'] as Set<string>).add(row.clientId || row.phone);
      } else {
        current['nonMemberSales'] = this.money(Number(current['nonMemberSales'] || 0) + this.invoiceTotal(invoice));
        current['nonMemberPending'] = this.money(Number(current['nonMemberPending'] || 0) + this.invoiceBalance(invoice));
      }
      map.set(staffName, current);
    }
    return [...map.values()]
      .map((row) => ({ ...row, memberConversionCount: (row['memberConversionCount'] as Set<string>).size }) as ApiRecord)
      .sort((a, b) => Number(b['memberSales'] || 0) + Number(b['nonMemberSales'] || 0) - Number(a['memberSales'] || 0) - Number(a['nonMemberSales'] || 0));
  }

  memberSalesAlerts(): ApiRecord[] {
    const rows = this.visibleMemberSalesRows();
    const nonMembers = rows.filter((row) => !row.isMember);
    const members = rows.filter((row) => row.isMember);
    const highValueNonMember = [...nonMembers].sort((a, b) => b.totalSale - a.totalSale)[0];
    const repeatNonMember = nonMembers.find((row) => row.totalVisits >= 2);
    const highDiscountMember = members.find((row) => row.totalSale > 0 && row.discountUsed / row.totalSale >= 0.25);
    const memberDue = members.find((row) => row.pendingAmount > 0);
    const expiredVisitor = rows.find((row) => row.isExpiredMember);
    const lowConversionStaff = this.memberStaffImpactRows().find((row) => Number(row['nonMemberSales'] || 0) > Number(row['memberSales'] || 0) * 2);
    return [
      { label: 'High value non-member', value: highValueNonMember ? this.formatMoney(highValueNonMember.totalSale) : 'â‚¹0', detail: highValueNonMember?.clientName || 'No high value non-member', tone: highValueNonMember && highValueNonMember.totalSale >= 5000 ? 'warn' : 'normal' },
      { label: 'Repeat non-member not converted', value: repeatNonMember ? `${repeatNonMember.totalVisits} visits` : '0', detail: repeatNonMember?.clientName || 'No repeat non-member risk', tone: repeatNonMember ? 'warn' : 'normal' },
      { label: 'Member using high discount', value: highDiscountMember ? this.formatMoney(highDiscountMember.discountUsed) : 'â‚¹0', detail: highDiscountMember?.clientName || 'No benefit abuse signal', tone: highDiscountMember ? 'danger' : 'normal' },
      { label: 'Member pending due', value: memberDue ? this.formatMoney(memberDue.pendingAmount) : 'â‚¹0', detail: memberDue?.clientName || 'No member due', tone: memberDue ? 'danger' : 'normal' },
      { label: 'Expired member still visiting', value: expiredVisitor ? expiredVisitor.clientName : '0', detail: expiredVisitor ? 'Renewal opportunity' : 'No expired visitor', tone: expiredVisitor ? 'warn' : 'normal' },
      { label: 'Staff with low membership conversion', value: String(lowConversionStaff?.['staffName'] || 'Clear'), detail: lowConversionStaff ? 'Non-member sales much higher than member sales' : 'No staff conversion risk', tone: lowConversionStaff ? 'warn' : 'normal' }
    ];
  }

  salesTaxRows(): SalesTaxRow[] {
    const key = this.salesTaxCacheKey();
    if (this.salesTaxRowsCache.key !== key) {
      this.salesTaxRowsCache = { key, rows: this.salesTaxRowsForRange() };
    }
    return this.salesTaxRowsCache.rows;
  }

  salesTaxSummary(): ApiRecord {
    const key = this.salesTaxCacheKey();
    if (this.salesTaxSummaryCache.key === key) return this.salesTaxSummaryCache.value;
    const rows = this.salesTaxRows();
    const summary = {
      totalBills: rows.length,
      grossSale: this.money(rows.reduce((sum, row) => sum + row.actualPrice, 0)),
      netSale: this.money(rows.reduce((sum, row) => sum + row.invoiceTotal, 0)),
      taxableAmount: this.money(rows.reduce((sum, row) => sum + row.taxableAmount, 0)),
      totalGst: this.money(rows.reduce((sum, row) => sum + row.totalGst, 0)),
      cgst: this.money(rows.reduce((sum, row) => sum + row.cgst, 0)),
      sgst: this.money(rows.reduce((sum, row) => sum + row.sgst, 0)),
      igst: this.money(rows.reduce((sum, row) => sum + row.igst, 0)),
      couponDiscount: this.money(rows.reduce((sum, row) => sum + row.couponDiscount, 0)),
      membershipDiscount: this.money(rows.reduce((sum, row) => sum + row.membershipDiscount, 0)),
      taxExemptSale: this.money(rows.filter((row) => row.taxStatus === 'Tax exempt').reduce((sum, row) => sum + row.taxableAmount, 0)),
      gstMismatchCount: rows.filter((row) => row.taxStatus === 'Mismatch' || row.taxStatus === 'Missing GST').length
    };
    this.salesTaxSummaryCache = { key, value: summary };
    return summary;
  }

  gstRateBreakupRows(): ApiRecord[] {
    const buckets = new Map([0, 5, 12, 18, 28].map((rate) => [rate, { rate, rateLabel: `${rate}%`, count: 0, taxable: 0, gst: 0, total: 0 }]));
    for (const row of this.salesTaxRows()) {
      const rate = this.nearestGstRate(row.gstRate);
      const current = buckets.get(rate) || { rate, rateLabel: `${rate}%`, count: 0, taxable: 0, gst: 0, total: 0 };
      current.count += 1;
      current.taxable = this.money(current.taxable + row.taxableAmount);
      current.gst = this.money(current.gst + row.totalGst);
      current.total = this.money(current.total + row.invoiceTotal);
      buckets.set(rate, current);
    }
    return [...buckets.values()];
  }

  salesTaxTypeSplitRows(): ApiRecord[] {
    const map = new Map<string, ApiRecord>();
    for (const invoice of this.taxReportInvoices()) {
      const row = this.salesTaxRowForInvoice(invoice);
      const lines = this.linesForInvoices([invoice]);
      const basis = this.money(lines.reduce((sum, line) => sum + Math.max(0, this.lineAmount(line)), 0));
      const lineRows = lines.length ? lines : [{ type: row.itemType, amount: row.taxableAmount }];
      const countedTypes = new Set<string>();
      for (const line of lineRows) {
        const type = this.normalizedItemType(line);
        const typeLabel = this.itemTypeLabel(type);
        const amount = lines.length && basis > 0 ? this.lineAmount(line) : row.taxableAmount;
        const ratio = lines.length && basis > 0 ? Math.max(0, amount) / basis : 1;
        const current = map.get(type) || { type, typeLabel, count: 0, taxable: 0, gst: 0, total: 0 };
        current['taxable'] = this.money(Number(current['taxable'] || 0) + row.taxableAmount * ratio);
        current['gst'] = this.money(Number(current['gst'] || 0) + row.totalGst * ratio);
        current['total'] = this.money(Number(current['total'] || 0) + row.invoiceTotal * ratio);
        if (!countedTypes.has(type)) {
          current['count'] = Number(current['count'] || 0) + 1;
          countedTypes.add(type);
        }
        map.set(type, current);
      }
    }
    return [...map.values()].sort((a, b) => Number(b['total'] || 0) - Number(a['total'] || 0));
  }

  salesTaxAccountingChecks(): ApiRecord[] {
    const rows = this.salesTaxRows();
    const mismatch = rows.filter((row) => row.taxStatus === 'Mismatch');
    const missing = rows.filter((row) => row.taxStatus === 'Missing GST');
    const refunds = rows.filter((row) => row.taxStatus === 'Refund tax' || row.invoiceTotal < 0 || row.totalGst < 0);
    const excluded = this.filteredInvoices().filter((invoice) => this.isDeletedVoidInvoice(invoice));
    const exempt = rows.filter((row) => row.taxStatus === 'Tax exempt');
    return [
      { label: 'GST mismatch', count: mismatch.length, amount: this.money(mismatch.reduce((sum, row) => sum + Math.abs(row.invoiceTotal - row.taxableAmount - row.totalGst), 0)), action: mismatch.length ? 'Review taxable + GST vs invoice total' : 'Clear' },
      { label: 'Missing GST', count: missing.length, amount: this.money(missing.reduce((sum, row) => sum + row.taxableAmount, 0)), action: missing.length ? 'Add tax rate or mark exempt' : 'Clear' },
      { label: 'Refund tax', count: refunds.length, amount: this.money(refunds.reduce((sum, row) => sum + Math.abs(row.totalGst), 0)), action: refunds.length ? 'Verify credit note / refund GST' : 'Clear' },
      { label: 'Deleted/void excluded', count: excluded.length, amount: this.money(excluded.reduce((sum, invoice) => sum + this.invoiceTotal(invoice), 0)), action: excluded.length ? 'Excluded from GST filing rows' : 'Clear' },
      { label: 'Tax-exempt sale', count: exempt.length, amount: this.money(exempt.reduce((sum, row) => sum + row.taxableAmount, 0)), action: exempt.length ? 'Keep exemption reason ready' : 'Clear' }
    ];
  }

  exportSalesTaxOwnerPdf(): void {
    const summary = this.salesTaxSummary();
    const lines = [
      'Sales Tax / GST Owner Summary',
      `Generated: ${new Date().toLocaleString('en-IN')}`,
      `Date range: ${this.dateLabel(this.from)} to ${this.dateLabel(this.to)}`,
      `Branch: ${this.branchLabel()}`,
      '',
      `Total bills: ${summary['totalBills']}`,
      `Gross sale: ${this.formatMoney(Number(summary['grossSale'] || 0))}`,
      `Net sale: ${this.formatMoney(Number(summary['netSale'] || 0))}`,
      `Taxable amount: ${this.formatMoney(Number(summary['taxableAmount'] || 0))}`,
      `Total GST: ${this.formatMoney(Number(summary['totalGst'] || 0))}`,
      `Coupon discount: ${this.formatMoney(Number(summary['couponDiscount'] || 0))}`,
      `Membership discount: ${this.formatMoney(Number(summary['membershipDiscount'] || 0))}`,
      `Tax-exempt sale: ${this.formatMoney(Number(summary['taxExemptSale'] || 0))}`,
      `GST mismatch count: ${summary['gstMismatchCount']}`,
      '',
      'Accounting checks',
      ...this.salesTaxAccountingChecks().map((row) => `${row['label']}: ${row['count']} row(s), ${this.formatMoney(Number(row['amount'] || 0))} - ${row['action']}`),
      '',
      'Top GST rows',
      ...this.salesTaxRows().slice(0, 12).map((row) => `${row.date} | ${row.invoiceNo} | ${row.clientName} | GST ${this.formatMoney(row.totalGst)} | ${row.taxStatus}`)
    ];
    this.downloadFile(`sales-tax-gst-owner-${Date.now()}.pdf`, this.simplePdf(lines), 'application/pdf');
  }

  exportSalesTaxAccountantPdf(): void {
    const summary = this.salesTaxSummary();
    const lines = [
      'Sales Tax / GST Filing Summary',
      `Generated: ${new Date().toLocaleString('en-IN')}`,
      `Date range: ${this.dateLabel(this.from)} to ${this.dateLabel(this.to)}`,
      `Branch: ${this.branchLabel()}`,
      '',
      `Taxable amount: ${this.formatMoney(Number(summary['taxableAmount'] || 0))}`,
      `CGST: ${this.formatMoney(Number(summary['cgst'] || 0))}`,
      `SGST: ${this.formatMoney(Number(summary['sgst'] || 0))}`,
      `IGST: ${this.formatMoney(Number(summary['igst'] || 0))}`,
      `Total GST: ${this.formatMoney(Number(summary['totalGst'] || 0))}`,
      '',
      'GST rate breakup',
      ...this.gstRateBreakupRows().map((row) => `${row['rateLabel']}: taxable ${this.formatMoney(Number(row['taxable'] || 0))}, GST ${this.formatMoney(Number(row['gst'] || 0))}, bills ${row['count']}`),
      '',
      'Service/product tax split',
      ...this.salesTaxTypeSplitRows().map((row) => `${row['typeLabel']}: taxable ${this.formatMoney(Number(row['taxable'] || 0))}, GST ${this.formatMoney(Number(row['gst'] || 0))}`),
      '',
      'Review rows',
      ...this.salesTaxRows().filter((row) => row.taxStatus !== 'Valid').slice(0, 20).map((row) => `${row.invoiceNo}: ${row.taxStatus}, taxable ${this.formatMoney(row.taxableAmount)}, GST ${this.formatMoney(row.totalGst)}`)
    ];
    this.downloadFile(`sales-tax-gst-accountant-${Date.now()}.pdf`, this.simplePdf(lines), 'application/pdf');
  }

  exportDailySheetPdf(): void {
    const summary = this.dailySheetSummary();
    const lines = [
      'Daily Sheet / EOD Financial Control',
      `Generated: ${new Date().toLocaleString('en-IN')}`,
      `Date range: ${this.dateLabel(this.from)} to ${this.dateLabel(this.to)}`,
      `Branch: ${this.branchLabel()}`,
      '',
      `Total bills: ${summary.totalBills}`,
      `Bill average: ${this.formatMoney(summary.billAverage)}`,
      `Gross sale: ${this.formatMoney(summary.grossSale)}`,
      `Net sale: ${this.formatMoney(summary.netSale)}`,
      `Total received: ${this.formatMoney(summary.totalReceived)}`,
      `Pending/unpaid: ${this.formatMoney(summary.pendingUnpaid)}`,
      `Discount: ${this.formatMoney(summary.discount)}`,
      `Coupon discount: ${this.formatMoney(summary.couponDiscount)}`,
      `Membership discount: ${this.formatMoney(summary.membershipDiscount)}`,
      `GST/tax: ${this.formatMoney(summary.gstTax)}`,
      `Expenses: ${this.formatMoney(summary.expenses)}`,
      `Staff tips: ${this.formatMoney(summary.staffTips)}`,
      '',
      'Payment modes',
      ...this.dailySheetPaymentRows().map((row) => `${row['label']}: ${row['count']} row(s), ${this.formatMoney(Number(row['amount'] || 0))}`),
      '',
      'Reconciliation',
      ...this.dailySheetReconciliationRows().map((row) => `${row['label']}: ${this.formatMoney(Number(row['value'] || 0))} - ${row['note']}`),
      '',
      'Top staff',
      ...this.dailySheetStaffRows().slice(0, 12).map((row, index) => `${index + 1}. ${row['staffName']} | service ${this.formatMoney(Number(row['serviceSale'] || 0))} | product ${this.formatMoney(Number(row['productSale'] || 0))} | unpaid ${this.formatMoney(Number(row['unpaidAmount'] || 0))}`)
    ];
    this.downloadFile(`daily-sheet-eod-${Date.now()}.pdf`, this.simplePdf(lines), 'application/pdf');
  }

  exportDailyRevenueOwnerPdf(): void {
    const kpis = this.dailyRevenueKpis();
    const totals = this.dailyRevenueTotals(this.dailyRevenueRows());
    const lines = [
      'Daily Revenue 10x Owner Summary',
      `Generated: ${new Date().toLocaleString('en-IN')}`,
      `Date range: ${this.dateLabel(this.from)} to ${this.dateLabel(this.to)}`,
      `Branch: ${this.branchLabel()}`,
      '',
      `Best revenue day: ${kpis['bestRevenueDay']} (${this.formatMoney(Number(kpis['bestRevenueValue'] || 0))})`,
      `Lowest revenue day: ${kpis['lowestRevenueDay']} (${this.formatMoney(Number(kpis['lowestRevenueValue'] || 0))})`,
      `Average daily sale: ${this.formatMoney(Number(kpis['averageDailySale'] || 0))}`,
      `Growth vs previous period: ${Number(kpis['growthRate'] || 0).toFixed(1)}%`,
      `Pending due trend: ${this.formatMoney(Number(kpis['pendingDueTrend'] || 0))}`,
      `Discount leakage: ${Number(kpis['discountLeakageRate'] || 0).toFixed(1)}%`,
      `Collection rate: ${Number(kpis['collectionRate'] || 0).toFixed(1)}%`,
      '',
      `Gross sale: ${this.formatMoney(totals.grossSale)}`,
      `Net sale: ${this.formatMoney(totals.netSale)}`,
      `Received amount: ${this.formatMoney(totals.receivedAmount)}`,
      `Pending/due amount: ${this.formatMoney(totals.pendingDueAmount)}`,
      `Expenses: ${this.formatMoney(totals.expenses)}`,
      `Final cash-in value: ${this.formatMoney(totals.finalCashInValue)}`,
      '',
      'Owner alerts',
      ...this.dailyRevenueAlerts().map((alert) => `${alert['label']}: ${alert['value']} - ${alert['detail']}`),
      '',
      'Top days',
      ...this.dailyRevenueRows().slice(0, 12).map((row) => `${row.dateLabel}: bills ${row.totalBillCount}, net ${this.formatMoney(row.netSale)}, received ${this.formatMoney(row.receivedAmount)}, due ${this.formatMoney(row.pendingDueAmount)}`)
    ];
    this.downloadFile(`daily-revenue-owner-${Date.now()}.pdf`, this.simplePdf(lines), 'application/pdf');
  }

  exportDailyRevenueAccountantPdf(): void {
    const totals = this.dailyRevenueTotals(this.dailyRevenueRows());
    const paymentTotals = new Map<string, number>();
    for (const payment of this.payments().filter((row) => this.inDateRange(this.paymentDate(row)))) {
      const label = this.modeLabel(this.dailyPaymentModeKey(payment));
      paymentTotals.set(label, this.money((paymentTotals.get(label) || 0) + this.paymentAmount(payment)));
    }
    const lines = [
      'Daily Revenue Accountant GST Payment Breakup',
      `Generated: ${new Date().toLocaleString('en-IN')}`,
      `Date range: ${this.dateLabel(this.from)} to ${this.dateLabel(this.to)}`,
      `Branch: ${this.branchLabel()}`,
      '',
      `Gross sale: ${this.formatMoney(totals.grossSale)}`,
      `Discount: ${this.formatMoney(totals.discount)}`,
      `Coupon discount: ${this.formatMoney(totals.couponDiscount)}`,
      `Membership discount: ${this.formatMoney(totals.membershipDiscount)}`,
      `Net sale: ${this.formatMoney(totals.netSale)}`,
      `GST: ${this.formatMoney(totals.gst)}`,
      `Received amount: ${this.formatMoney(totals.receivedAmount)}`,
      `Pending/due amount: ${this.formatMoney(totals.pendingDueAmount)}`,
      `Refund/return: ${this.formatMoney(totals.refundReturn)}`,
      '',
      'Payment mode breakup',
      ...[...paymentTotals.entries()].sort((a, b) => b[1] - a[1]).map(([mode, amount]) => `${mode}: ${this.formatMoney(amount)}`),
      '',
      'Date-wise GST rows',
      ...this.dailyRevenueRows().map((row) => `${row.dateLabel}: net ${this.formatMoney(row.netSale)}, GST ${this.formatMoney(row.gst)}, received ${this.formatMoney(row.receivedAmount)}`)
    ];
    this.downloadFile(`daily-revenue-accountant-${Date.now()}.pdf`, this.simplePdf(lines), 'application/pdf');
  }

  exportMemberSalesOwnerPdf(): void {
    const summary = this.memberSalesSummary();
    const lines = [
      'Member vs Non-Member Sales Owner Summary',
      `Generated: ${new Date().toLocaleString('en-IN')}`,
      `Date range: ${this.dateLabel(this.from)} to ${this.dateLabel(this.to)}`,
      `Branch: ${this.branchLabel()}`,
      '',
      `Member clients count: ${summary['memberClients']}`,
      `Non-member clients count: ${summary['nonMemberClients']}`,
      `Member revenue: ${this.formatMoney(Number(summary['memberRevenue'] || 0))}`,
      `Non-member revenue: ${this.formatMoney(Number(summary['nonMemberRevenue'] || 0))}`,
      `Member visits: ${summary['memberVisits']}`,
      `Non-member visits: ${summary['nonMemberVisits']}`,
      `Paid amount: ${this.formatMoney(Number(summary['paidAmount'] || 0))}`,
      `Pending amount: ${this.formatMoney(Number(summary['pendingAmount'] || 0))}`,
      `Collection rate: ${Number(summary['collectionRate'] || 0).toFixed(1)}%`,
      '',
      'Membership ROI',
      ...this.membershipRoiRows().map((row) => `${row['label']}: ${row['value']}`),
      '',
      'Owner alerts',
      ...this.memberSalesAlerts().map((alert) => `${alert['label']}: ${alert['value']} - ${alert['detail']}`)
    ];
    this.downloadFile(`member-vs-non-member-owner-${Date.now()}.pdf`, this.simplePdf(lines), 'application/pdf');
  }

  exportMemberConversionPdf(): void {
    const lines = [
      'Membership Conversion List',
      `Generated: ${new Date().toLocaleString('en-IN')}`,
      `Date range: ${this.dateLabel(this.from)} to ${this.dateLabel(this.to)}`,
      `Branch: ${this.branchLabel()}`,
      '',
      ...this.memberConversionOpportunities().map((row, index) => `${index + 1}. ${row['clientName']} | ${row['phone']} | sale ${this.formatMoney(Number(row['totalSale'] || 0))} | visits ${row['totalVisits']} | plan ${row['suggestedPlan']} | action ${row['followUpAction']}`)
    ];
    this.downloadFile(`membership-conversion-list-${Date.now()}.pdf`, this.simplePdf(lines), 'application/pdf');
  }

  private exportPaymentDistributionCsv(): void {
    const headers = ['Date', 'Name', 'Contact', 'Invoice No', 'Price', 'Payment Modes', 'Transaction ID', 'Payment Date', 'Notes'];
    const csv = [
      headers.map((cell) => this.csvCell(cell)).join(','),
      ...this.visiblePaymentDistributionRows().map((row) => [
        row.date,
        row.name,
        row.contact,
        row.invoiceNo,
        row.price.toFixed(2),
        row.paymentMode,
        row.transactionId,
        row.paymentDate,
        row.notes
      ].map((cell) => this.csvCell(cell)).join(','))
    ].join('\n');
    this.downloadFile(`payment-distributions-${Date.now()}.csv`, csv, 'text/csv;charset=utf-8');
  }

  private exportDailySheetCsv(): void {
    const summary = this.dailySheetSummary();
    const sections = [
      ['Daily Sheet / EOD Financial Control'],
      ['Date range', `${this.dateLabel(this.from)} to ${this.dateLabel(this.to)}`],
      ['Branch', this.branchLabel()],
      [],
      ['Summary', 'Value'],
      ['Total bills', summary.totalBills],
      ['Bill average', summary.billAverage],
      ['Gross sale', summary.grossSale],
      ['Net sale', summary.netSale],
      ['Total received', summary.totalReceived],
      ['Pending/unpaid', summary.pendingUnpaid],
      ['Discount', summary.discount],
      ['Coupon discount', summary.couponDiscount],
      ['Membership discount', summary.membershipDiscount],
      ['GST/tax', summary.gstTax],
      ['Expenses', summary.expenses],
      ['Staff tips', summary.staffTips],
      [],
      ['Item details', 'Count', 'Received', 'Total'],
      ...this.dailySheetItemRows().map((row) => [row['label'], row['count'], row['received'], row['total']]),
      [],
      ['Payment modes', 'Count', 'Amount'],
      ...this.dailySheetPaymentRows().map((row) => [row['label'], row['count'], row['amount']]),
      [],
      ['Reconciliation', 'Value', 'Note'],
      ...this.dailySheetReconciliationRows().map((row) => [row['label'], row['value'], row['note']]),
      [],
      ['Staff', 'Service sale', 'Product sale', 'Discount', 'Tips', 'Unpaid', 'Commission base'],
      ...this.dailySheetStaffRows().map((row) => [row['staffName'], row['serviceSale'], row['productSale'], row['discountGiven'], row['tips'], row['unpaidAmount'], row['commissionBase']])
    ];
    const csv = sections.map((row) => row.map((cell) => this.csvCell(cell)).join(',')).join('\n');
    this.downloadFile(`daily-sheet-eod-${Date.now()}.csv`, csv, 'text/csv;charset=utf-8');
  }

  private exportDailyRevenueCsv(): void {
    const headers = [
      'Date',
      'Total bill count',
      'Service sale',
      'Product sale',
      'Package sale',
      'Membership sale',
      'Gift card sale',
      'Wallet / prepaid used',
      'Gross sale',
      'Discount',
      'Coupon discount',
      'Membership discount',
      'Net sale',
      'GST',
      'Received amount',
      'Pending / due amount',
      'Expenses',
      'Refund / return',
      'Final cash-in value'
    ];
    const rows = this.dailyRevenueRows().map((row) => [
      row.dateLabel,
      row.totalBillCount,
      row.serviceSale,
      row.productSale,
      row.packageSale,
      row.membershipSale,
      row.giftCardSale,
      row.walletPrepaidUsed,
      row.grossSale,
      row.discount,
      row.couponDiscount,
      row.membershipDiscount,
      row.netSale,
      row.gst,
      row.receivedAmount,
      row.pendingDueAmount,
      row.expenses,
      row.refundReturn,
      row.finalCashInValue
    ]);
    const csv = [
      headers.map((cell) => this.csvCell(cell)).join(','),
      ...rows.map((row) => row.map((cell) => this.csvCell(cell)).join(','))
    ].join('\n');
    this.downloadFile(`daily-revenue-${Date.now()}.csv`, csv, 'text/csv;charset=utf-8');
  }

  private exportMemberSalesCsv(): void {
    const headers = ['Client name', 'Phone', 'Membership status', 'Active plan name', 'Total visits', 'Total sale', 'Paid amount', 'Pending amount', 'Discount used', 'Last visit date', 'Suggested action'];
    const csv = [
      headers.map((cell) => this.csvCell(cell)).join(','),
      ...this.visibleMemberSalesRows().map((row) => [
        row.clientName,
        row.phone,
        row.membershipStatus,
        row.activePlanName,
        row.totalVisits,
        row.totalSale,
        row.paidAmount,
        row.pendingAmount,
        row.discountUsed,
        this.compactDateLabel(row.lastVisitDate),
        row.suggestedAction
      ].map((cell) => this.csvCell(cell)).join(','))
    ].join('\n');
    this.downloadFile(`member-vs-non-member-sales-${Date.now()}.csv`, csv, 'text/csv;charset=utf-8');
  }

  private exportSalesTaxCsv(): void {
    const headers = [
      'Date',
      'Invoice no',
      'Client',
      'Phone',
      'GSTIN',
      'Staff / cashier',
      'Actual price',
      'Discount',
      'Coupon discount',
      'Membership discount',
      'Taxable amount',
      'GST %',
      'CGST',
      'SGST',
      'IGST',
      'Total GST',
      'Invoice total',
      'Paid',
      'Due',
      'Payment mode',
      'Tax status'
    ];
    const csv = [
      headers.map((cell) => this.csvCell(cell)).join(','),
      ...this.salesTaxRows().map((row) => [
        row.date,
        row.invoiceNo,
        row.clientName,
        row.phone,
        row.gstin,
        row.staffCashier,
        row.actualPrice,
        row.discount,
        row.couponDiscount,
        row.membershipDiscount,
        row.taxableAmount,
        row.gstRate,
        row.cgst,
        row.sgst,
        row.igst,
        row.totalGst,
        row.invoiceTotal,
        row.paid,
        row.due,
        row.paymentMode,
        row.taxStatus
      ].map((cell) => this.csvCell(cell)).join(','))
    ].join('\n');
    this.downloadFile(`sales-tax-gst-${Date.now()}.csv`, csv, 'text/csv;charset=utf-8');
  }

  private salesTaxRowsForRange(): SalesTaxRow[] {
    return this.taxReportInvoices()
      .map((invoice) => this.salesTaxRowForInvoice(invoice))
      .sort((a, b) => this.dateMs(b.dateValue) - this.dateMs(a.dateValue));
  }

  private taxReportInvoices(): ApiRecord[] {
    return this.filteredInvoices().filter((invoice) => !this.isDeletedVoidInvoice(invoice));
  }

  private salesTaxRowForInvoice(invoice: ApiRecord): SalesTaxRow {
    const client = this.clientForInvoice(invoice);
    const dateValue = this.invoiceDate(invoice);
    const invoiceTotal = this.invoiceTotal(invoice);
    const totalGst = this.invoiceTax(invoice);
    const taxableAmount = this.invoiceTaxableAmount(invoice, invoiceTotal, totalGst);
    const gstRate = this.invoiceGstRate(invoice, taxableAmount, totalGst);
    const split = this.invoiceTaxSplit(invoice, totalGst);
    const discount = this.invoiceDiscount(invoice);
    const coupon = this.couponDiscount(invoice);
    const membership = this.membershipDiscount(invoice);
    const row: SalesTaxRow = {
      date: this.compactDateLabel(dateValue),
      dateValue,
      invoiceNo: this.invoiceNumber(invoice),
      clientName: this.invoiceClientName(invoice, client),
      phone: this.invoiceClientPhone(invoice, client),
      gstin: this.invoiceGstin(invoice, client),
      staffCashier: this.invoiceStaffCashier(invoice),
      actualPrice: this.invoiceActualPrice(invoice, invoiceTotal, discount + coupon + membership),
      discount,
      couponDiscount: coupon,
      membershipDiscount: membership,
      taxableAmount,
      gstRate,
      cgst: split.cgst,
      sgst: split.sgst,
      igst: split.igst,
      totalGst,
      invoiceTotal,
      paid: this.invoicePaid(invoice),
      due: this.invoiceBalance(invoice),
      paymentMode: this.invoicePaymentModeLabel(invoice),
      taxStatus: 'Valid',
      itemType: this.invoiceItemTypeSummary(invoice)
    };
    row.taxStatus = this.invoiceTaxStatus(invoice, row);
    return row;
  }

  private salesTaxCacheKey(): string {
    return [
      this.dataVersion,
      this.from,
      this.to,
      this.invoices().length,
      this.payments().length,
      this.sales().length,
      this.clients().length
    ].join('|');
  }

  private invalidateSalesTaxCache(): void {
    this.salesTaxRowsCache = { key: '', rows: [] };
    this.salesTaxSummaryCache = { key: '', value: {} };
  }

  private invoiceNumber(invoice: ApiRecord): string {
    return String(invoice['invoiceNumber'] || invoice['invoice_number'] || invoice['number'] || invoice['billNo'] || invoice['bill_no'] || invoice['id'] || '-');
  }

  private invoiceGstin(invoice: ApiRecord, client?: ApiRecord): string {
    return String(invoice['gstin'] || invoice['gstIn'] || invoice['gstNumber'] || invoice['gst_number'] || invoice['taxId'] || invoice['tax_id'] || client?.['gstin'] || client?.['gstIn'] || client?.['gstNumber'] || client?.['gst_number'] || client?.['taxId'] || client?.['tax_id'] || '');
  }

  private invoiceStaffCashier(invoice: ApiRecord): string {
    return String(invoice['staffName'] || invoice['staff_name'] || invoice['cashierName'] || invoice['cashier_name'] || invoice['createdByName'] || invoice['created_by_name'] || invoice['addedBy'] || invoice['added_by'] || 'Unassigned');
  }

  private invoiceActualPrice(invoice: ApiRecord, invoiceTotal: number, discountTotal: number): number {
    const lines = this.linesForInvoices([invoice]);
    const gross = this.money(lines.reduce((sum, line) => sum + this.lineGross(line), 0));
    if (gross > 0) return gross;
    const explicit = invoice['actualPrice'] ?? invoice['actual_price'] ?? invoice['grossTotal'] ?? invoice['gross_total'] ?? invoice['subtotal'];
    if (explicit !== undefined && explicit !== null && explicit !== '') return this.money(Number(explicit));
    return this.money(invoiceTotal + discountTotal);
  }

  private invoiceTaxableAmount(invoice: ApiRecord, invoiceTotal: number, totalGst: number): number {
    const explicit = invoice['taxableAmount'] ?? invoice['taxable_amount'] ?? invoice['taxable'] ?? invoice['netTaxable'] ?? invoice['net_taxable'];
    if (explicit !== undefined && explicit !== null && explicit !== '') return this.money(Number(explicit));
    const lines = this.linesForInvoices([invoice]);
    const lineTaxable = this.money(lines.reduce((sum, line) => sum + Number(line['taxableAmount'] || line['taxable_amount'] || 0), 0));
    if (lineTaxable > 0) return lineTaxable;
    return this.money(Math.max(0, invoiceTotal - totalGst));
  }

  private invoiceGstRate(invoice: ApiRecord, taxableAmount: number, totalGst: number): number {
    const explicit = invoice['gstRate'] ?? invoice['gst_rate'] ?? invoice['taxRate'] ?? invoice['tax_rate'];
    if (explicit !== undefined && explicit !== null && explicit !== '') return this.money(Number(explicit));
    const lines = this.linesForInvoices([invoice]);
    const lineRate = lines.find((line) => line['gstRate'] || line['gst_rate'] || line['taxRate'] || line['tax_rate']);
    const rawLineRate = lineRate?.['gstRate'] ?? lineRate?.['gst_rate'] ?? lineRate?.['taxRate'] ?? lineRate?.['tax_rate'];
    if (rawLineRate !== undefined && rawLineRate !== null && rawLineRate !== '') return this.money(Number(rawLineRate));
    return taxableAmount > 0 ? this.money((totalGst / taxableAmount) * 100) : 0;
  }

  private invoiceTaxSplit(invoice: ApiRecord, totalGst: number): { cgst: number; sgst: number; igst: number } {
    const cgst = this.firstMoney(invoice, ['cgst', 'cgstAmount', 'cgst_amount']);
    const sgst = this.firstMoney(invoice, ['sgst', 'sgstAmount', 'sgst_amount']);
    const igst = this.firstMoney(invoice, ['igst', 'igstAmount', 'igst_amount']);
    if (cgst || sgst || igst) return { cgst, sgst, igst };
    return { cgst: this.money(totalGst / 2), sgst: this.money(totalGst / 2), igst: 0 };
  }

  private invoiceTaxStatus(invoice: ApiRecord, row: SalesTaxRow): string {
    const status = String(invoice['status'] || invoice['paymentStatus'] || invoice['payment_status'] || '').toLowerCase();
    if (status.includes('refund') || status.includes('return') || row.invoiceTotal < 0 || row.totalGst < 0) return 'Refund tax';
    const mismatch = Math.abs(this.money(row.taxableAmount + row.totalGst - row.invoiceTotal));
    if (mismatch > 1) return 'Mismatch';
    if (row.taxableAmount > 0 && row.totalGst <= 0) return this.hasExplicitZeroTax(invoice) ? 'Tax exempt' : 'Missing GST';
    return 'Valid';
  }

  private invoiceItemTypeSummary(invoice: ApiRecord): string {
    const types = new Set(this.linesForInvoices([invoice]).map((line) => this.itemTypeLabel(this.normalizedItemType(line))));
    return types.size ? [...types].join(', ') : 'Service';
  }

  private invoicePaymentModeLabel(invoice: ApiRecord): string {
    const ids = this.invoiceIdentifiers(invoice);
    const modes = new Set(this.payments()
      .filter((payment) => ids.has(String(payment['invoiceId'] || payment['invoice_id'] || payment['invoiceNumber'] || payment['invoice_number'] || '')))
      .map((payment) => this.modeLabel(this.paymentMode(payment))));
    const direct = String(invoice['paymentMode'] || invoice['payment_mode'] || invoice['mode'] || '');
    if (direct) modes.add(this.modeLabel(direct));
    return modes.size ? [...modes].join(', ') : '-';
  }

  private invoiceIdentifiers(invoice: ApiRecord): Set<string> {
    return new Set([
      invoice['id'],
      invoice['invoiceId'],
      invoice['invoice_id'],
      invoice['invoiceNumber'],
      invoice['invoice_number'],
      invoice['number']
    ].map((value) => String(value || '')).filter(Boolean));
  }

  private nearestGstRate(rate: number): number {
    const normalized = Number(rate) || 0;
    return [0, 5, 12, 18, 28].reduce((best, item) => Math.abs(item - normalized) < Math.abs(best - normalized) ? item : best, 0);
  }

  private itemTypeLabel(type: string): string {
    const labels: Record<string, string> = {
      service: 'Services',
      product: 'Products',
      package: 'Packages',
      membership: 'Memberships',
      gift_card: 'Gift Cards'
    };
    return labels[type] || 'Services';
  }

  private firstMoney(row: ApiRecord, keys: string[]): number {
    for (const key of keys) {
      const value = row[key];
      if (value !== undefined && value !== null && value !== '') return this.money(Number(value));
    }
    return 0;
  }

  private hasExplicitZeroTax(invoice: ApiRecord): boolean {
    return ['gst', 'gstAmount', 'gst_amount', 'tax', 'taxAmount', 'tax_amount', 'gstRate', 'gst_rate', 'taxRate', 'tax_rate']
      .some((key) => invoice[key] !== undefined && invoice[key] !== null && invoice[key] !== '');
  }

  private isDeletedVoidInvoice(invoice: ApiRecord): boolean {
    const status = String(invoice['status'] || invoice['paymentStatus'] || invoice['payment_status'] || invoice['deletedAt'] || invoice['deleted_at'] || '').toLowerCase();
    return ['deleted', 'void', 'cancel', 'cancelled'].some((token) => status.includes(token));
  }

  private dailyRevenueRowsForRange(from: string, to: string): DailyRevenueRow[] {
    const dateKeys = new Set<string>();
    const inRange = (value: string) => this.inDateWindow(value, from, to);
    for (const invoice of this.invoices().filter((row) => inRange(this.invoiceDate(row)))) dateKeys.add(this.businessDateKey(this.invoiceDate(invoice)));
    for (const payment of this.payments().filter((row) => inRange(this.paymentDate(row)))) dateKeys.add(this.businessDateKey(this.paymentDate(payment)));
    for (const expense of this.financeExpenses().filter((row) => inRange(this.expenseDate(row)))) dateKeys.add(this.businessDateKey(this.expenseDate(expense)));
    for (const key of dateKeys) if (!key) dateKeys.delete(key);
    return [...dateKeys]
      .sort((a, b) => b.localeCompare(a))
      .map((dateKey) => this.dailyRevenueRowForDate(dateKey));
  }

  private dailyRevenueRowForDate(dateKey: string): DailyRevenueRow {
    const invoices = this.invoicesForDateKey(dateKey);
    const payments = this.paymentsForDateKey(dateKey);
    const lines = this.linesForInvoices(invoices);
    const lineSale = (type: string) => this.money(lines.filter((line) => this.normalizedItemType(line) === type).reduce((sum, line) => sum + this.lineAmount(line), 0));
    const discount = this.money(invoices.reduce((sum, invoice) => sum + this.invoiceDiscount(invoice), 0));
    const couponDiscount = this.money(invoices.reduce((sum, invoice) => sum + this.couponDiscount(invoice), 0));
    const membershipDiscount = this.money(invoices.reduce((sum, invoice) => sum + this.membershipDiscount(invoice), 0));
    const grossSale = this.money(lines.reduce((sum, line) => sum + this.lineGross(line), 0) || invoices.reduce((sum, invoice) => sum + this.invoiceTotal(invoice) + this.invoiceDiscount(invoice) + this.couponDiscount(invoice) + this.membershipDiscount(invoice), 0));
    const refundReturn = this.refundAmountForDateKey(dateKey);
    const expenses = this.expensesForDateKey(dateKey);
    const receivedAmount = this.money(payments.reduce((sum, payment) => sum + this.paymentAmount(payment), 0));
    return {
      dateKey,
      dateLabel: this.compactDateLabel(dateKey),
      totalBillCount: invoices.length,
      serviceSale: lines.length ? lineSale('service') : this.money(invoices.reduce((sum, invoice) => sum + this.invoiceTotal(invoice), 0)),
      productSale: lineSale('product'),
      packageSale: lineSale('package'),
      membershipSale: lineSale('membership'),
      giftCardSale: lineSale('gift_card'),
      walletPrepaidUsed: this.money(payments.filter((payment) => ['wallet', 'prepaid', 'reward', 'giftcard'].includes(this.dailyPaymentModeKey(payment))).reduce((sum, payment) => sum + this.paymentAmount(payment), 0)),
      grossSale,
      discount,
      couponDiscount,
      membershipDiscount,
      netSale: this.money(invoices.reduce((sum, invoice) => sum + this.invoiceTotal(invoice), 0)),
      gst: this.money(invoices.reduce((sum, invoice) => sum + this.invoiceTax(invoice), 0)),
      receivedAmount,
      pendingDueAmount: this.money(invoices.reduce((sum, invoice) => sum + this.invoiceBalance(invoice), 0)),
      expenses,
      refundReturn,
      finalCashInValue: this.money(receivedAmount - expenses - refundReturn)
    };
  }

  private dailyRevenueTotals(rows: DailyRevenueRow[]): DailyRevenueRow {
    return rows.reduce((total, row) => ({
      dateKey: 'total',
      dateLabel: 'Total',
      totalBillCount: total.totalBillCount + row.totalBillCount,
      serviceSale: this.money(total.serviceSale + row.serviceSale),
      productSale: this.money(total.productSale + row.productSale),
      packageSale: this.money(total.packageSale + row.packageSale),
      membershipSale: this.money(total.membershipSale + row.membershipSale),
      giftCardSale: this.money(total.giftCardSale + row.giftCardSale),
      walletPrepaidUsed: this.money(total.walletPrepaidUsed + row.walletPrepaidUsed),
      grossSale: this.money(total.grossSale + row.grossSale),
      discount: this.money(total.discount + row.discount),
      couponDiscount: this.money(total.couponDiscount + row.couponDiscount),
      membershipDiscount: this.money(total.membershipDiscount + row.membershipDiscount),
      netSale: this.money(total.netSale + row.netSale),
      gst: this.money(total.gst + row.gst),
      receivedAmount: this.money(total.receivedAmount + row.receivedAmount),
      pendingDueAmount: this.money(total.pendingDueAmount + row.pendingDueAmount),
      expenses: this.money(total.expenses + row.expenses),
      refundReturn: this.money(total.refundReturn + row.refundReturn),
      finalCashInValue: this.money(total.finalCashInValue + row.finalCashInValue)
    }), {
      dateKey: 'total',
      dateLabel: 'Total',
      totalBillCount: 0,
      serviceSale: 0,
      productSale: 0,
      packageSale: 0,
      membershipSale: 0,
      giftCardSale: 0,
      walletPrepaidUsed: 0,
      grossSale: 0,
      discount: 0,
      couponDiscount: 0,
      membershipDiscount: 0,
      netSale: 0,
      gst: 0,
      receivedAmount: 0,
      pendingDueAmount: 0,
      expenses: 0,
      refundReturn: 0,
      finalCashInValue: 0
    });
  }

  private previousRevenueRange(): { from: string; to: string } {
    const from = new Date(this.from || this.defaultFrom());
    const to = new Date(this.to || this.today());
    const days = Math.max(1, Math.round((this.dateMs(to) - this.dateMs(from)) / 86400000) + 1);
    const previousTo = new Date(from);
    previousTo.setDate(previousTo.getDate() - 1);
    const previousFrom = new Date(previousTo);
    previousFrom.setDate(previousFrom.getDate() - days + 1);
    return { from: this.inputDate(previousFrom), to: this.inputDate(previousTo) };
  }

  private dailyDiscountRate(row: DailyRevenueRow): number {
    const discount = row.discount + row.couponDiscount + row.membershipDiscount;
    return row.grossSale ? this.money((discount / row.grossSale) * 100) : 0;
  }

  private dailyCollectionRate(row: DailyRevenueRow): number {
    return row.netSale ? this.money((row.receivedAmount / row.netSale) * 100) : 100;
  }

  private dailyRevenueCashMismatch(): number {
    return this.money([...this.cashDrawerReports(), ...this.cashDrawerSessions()]
      .filter((row) => this.inDateRange(String(row['businessDate'] || row['business_date'] || row['closedAt'] || row['closed_at'] || row['createdAt'] || row['created_at'] || '')))
      .reduce((sum, row) => sum + this.cashDrawerValue(row, ['variancePaise', 'variance_paise'], ['variance', 'cashDifference', 'cash_difference']), 0));
  }

  private invoicesForDateKey(dateKey: string): ApiRecord[] {
    return this.invoices().filter((invoice) => this.businessDateKey(this.invoiceDate(invoice)) === dateKey);
  }

  private paymentsForDateKey(dateKey: string): ApiRecord[] {
    return this.payments().filter((payment) => this.businessDateKey(this.paymentDate(payment)) === dateKey);
  }

  private auditLogsForDateKey(dateKey: string): ApiRecord[] {
    return this.auditLogs().filter((log) => this.businessDateKey(String(log['createdAt'] || log['created_at'] || log['timestamp'] || log['date'] || '')) === dateKey);
  }

  private expensesForDateKey(dateKey: string): number {
    const direct = this.financeExpenses()
      .filter((row) => this.businessDateKey(this.expenseDate(row)) === dateKey)
      .reduce((sum, row) => sum + Number(row['amount'] || row['total'] || row['paidAmount'] || row['paid_amount'] || 0), 0);
    const summary = [
      ...this.arrayValue(this.financeSummary()['expenses']),
      ...this.arrayValue(this.financeSummary()['refunds'])
    ].filter((row) => this.businessDateKey(this.expenseDate(row)) === dateKey)
      .reduce((sum, row) => sum + Number(row['amount'] || row['total'] || 0), 0);
    return this.money(direct || summary);
  }

  private refundAmountForDateKey(dateKey: string): number {
    const refundPayments = this.paymentsForDateKey(dateKey).filter((payment) => this.paymentAmount(payment) < 0 || ['refund', 'return'].some((token) => `${this.paymentMode(payment)} ${payment['reference'] || ''} ${payment['note'] || ''} ${payment['notes'] || ''}`.toLowerCase().includes(token)));
    const returnInvoices = this.invoicesForDateKey(dateKey).filter((invoice) => ['refund', 'return'].some((token) => String(invoice['status'] || '').toLowerCase().includes(token)));
    return this.money(Math.abs(refundPayments.reduce((sum, payment) => sum + this.paymentAmount(payment), 0)) + returnInvoices.reduce((sum, invoice) => sum + this.invoiceTotal(invoice), 0));
  }

  private topMapEntry(map: Map<string, number>): [string, number] | undefined {
    return [...map.entries()].sort((a, b) => b[1] - a[1])[0];
  }

  private mapSummary(map: Map<string, number>): string {
    return [...map.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4)
      .map(([label, amount]) => `${label}: ${this.formatMoney(amount)}`)
      .join(' | ');
  }

  private dailyRevenueCacheKey(): string {
    return [
      this.dataVersion,
      this.from,
      this.to,
      this.invoices().length,
      this.payments().length,
      this.sales().length,
      this.financeExpenses().length,
      this.auditLogs().length,
      this.cashDrawerReports().length,
      this.cashDrawerSessions().length
    ].join('|');
  }

  private invalidateDailyRevenueCache(): void {
    this.dataVersion += 1;
    this.invalidateSalesTaxCache();
    this.dailyRevenueRowsCache = { key: '', rows: [] };
    this.dailyRevenueKpisCache = { key: '', value: {} };
    this.dailyRevenueChartCache = { key: '', value: [] };
    this.serviceProductChartCache = { key: '', value: [] };
    this.paymentModeTrendChartCache = { key: '', value: [] };
    this.discountVsNetChartCache = { key: '', value: [] };
    this.pendingDueAgingChartCache = { key: '', value: [] };
    this.dailyRevenueAlertsCache = { key: '', value: [] };
    this.dailyRevenueDrilldownCache.clear();
  }

  private dailyInvoices(): ApiRecord[] {
    return this.filteredInvoices();
  }

  private dailyPayments(): ApiRecord[] {
    return this.payments().filter((payment) => this.inDateRange(this.paymentDate(payment)));
  }

  private dailyExpensesTotal(): number {
    const direct = this.financeExpenses()
      .filter((row) => this.inDateRange(this.expenseDate(row)))
      .reduce((sum, row) => sum + Number(row['amount'] || row['total'] || row['paidAmount'] || row['paid_amount'] || 0), 0);
    const summary = [
      ...this.arrayValue(this.financeSummary()['expenses']),
      ...this.arrayValue(this.financeSummary()['refunds'])
    ].filter((row) => this.inDateRange(this.expenseDate(row)))
      .reduce((sum, row) => sum + Number(row['amount'] || row['total'] || 0), 0);
    return this.money(direct || summary);
  }

  private dailyCashDrawerRecord(): ApiRecord | undefined {
    const rows = [...this.cashDrawerReports(), ...this.cashDrawerSessions()];
    return rows
      .filter((row) => this.inDateRange(String(row['businessDate'] || row['business_date'] || row['closedAt'] || row['closed_at'] || row['createdAt'] || row['created_at'] || '')))
      .sort((a, b) => this.dateMs(b['closedAt'] || b['closed_at'] || b['updatedAt'] || b['updated_at'] || b['createdAt'] || b['created_at']) - this.dateMs(a['closedAt'] || a['closed_at'] || a['updatedAt'] || a['updated_at'] || a['createdAt'] || a['created_at']))[0];
  }

  private cashDrawerValue(row: ApiRecord | undefined, paiseKeys: string[], amountKeys: string[]): number {
    if (!row) return 0;
    for (const key of paiseKeys) {
      const value = row[key];
      if (value !== undefined && value !== null && value !== '') return this.money(Number(value) / 100);
    }
    for (const key of amountKeys) {
      const value = row[key];
      if (value !== undefined && value !== null && value !== '') return this.money(Number(value));
    }
    return 0;
  }

  private dailyAuditRows(): ApiRecord[] {
    return this.auditLogs().filter((log) => this.inDateRange(String(log['createdAt'] || log['created_at'] || log['timestamp'] || log['date'] || '')));
  }

  private dailyDeletedVoidCount(): number {
    const invoiceCount = this.dailyInvoices().filter((invoice) => ['deleted', 'void', 'cancel'].some((token) => String(invoice['status'] || invoice['payment_status'] || '').toLowerCase().includes(token))).length;
    const auditCount = this.dailyAuditRows().filter((log) => ['delete', 'deleted', 'void', 'cancel'].some((token) => this.auditText(log).includes(token))).length;
    return invoiceCount + auditCount;
  }

  private dailyHighDiscountInvoices(): ApiRecord[] {
    return this.dailyInvoices().filter((invoice) => {
      const discount = this.invoiceDiscount(invoice) + this.couponDiscount(invoice) + this.membershipDiscount(invoice);
      const total = this.invoiceTotal(invoice) + discount;
      const rate = total > 0 ? (discount / total) * 100 : 0;
      return rate >= 20 || discount >= 5000;
    });
  }

  private dailyRefundAmount(): number {
    const refundPayments = this.dailyPayments().filter((payment) => this.paymentAmount(payment) < 0 || ['refund', 'return'].some((token) => `${this.paymentMode(payment)} ${payment['reference'] || ''} ${payment['note'] || ''} ${payment['notes'] || ''}`.toLowerCase().includes(token)));
    const returnInvoices = this.dailyInvoices().filter((invoice) => ['refund', 'return'].some((token) => String(invoice['status'] || '').toLowerCase().includes(token)));
    return this.money(Math.abs(refundPayments.reduce((sum, payment) => sum + this.paymentAmount(payment), 0)) + returnInvoices.reduce((sum, invoice) => sum + this.invoiceTotal(invoice), 0));
  }

  private dailyPaymentModeKey(payment: ApiRecord): string {
    const text = `${this.paymentMode(payment)} ${payment['reference'] || ''} ${payment['referenceNo'] || ''} ${payment['paymentReference'] || ''} ${payment['note'] || ''}`.toLowerCase();
    if (text.includes('payment link') || text.includes('razorpay') || text.includes('online')) return 'online';
    return this.modeKey(this.paymentMode(payment));
  }

  private isDueReceivedPayment(payment: ApiRecord): boolean {
    const text = `${payment['reference'] || ''} ${payment['referenceNo'] || ''} ${payment['paymentReference'] || ''} ${payment['note'] || ''} ${payment['notes'] || ''} ${payment['remarks'] || ''}`.toLowerCase();
    return text.includes('receive due') || text.includes('received due') || text.includes('old unpaid') || text.includes('pos unpaid receive');
  }

  private expenseDate(row: ApiRecord): string {
    return String(row['paidAt'] || row['paid_at'] || row['expenseDate'] || row['expense_date'] || row['createdAt'] || row['created_at'] || row['date'] || row['businessDate'] || row['business_date'] || this.to);
  }

  private normalizedItemType(line: ApiRecord): string {
    const raw = this.itemType(line);
    if (raw.includes('membership')) return 'membership';
    if (raw.includes('package')) return 'package';
    if (raw.includes('gift')) return 'gift_card';
    if (raw.includes('product') || raw.includes('retail')) return 'product';
    return 'service';
  }

  private staffNameForLine(line: ApiRecord, invoice: ApiRecord): string {
    return String(line['staffName'] || line['staff_name'] || line['assignedStaffName'] || line['assigned_staff_name'] || invoice['staffName'] || invoice['staff_name'] || invoice['createdByName'] || invoice['created_by_name'] || 'Unassigned');
  }

  private lineGross(line: ApiRecord): number {
    const explicit = line['gross'] ?? line['grossAmount'] ?? line['gross_amount'] ?? line['subtotal'] ?? line['lineSubtotal'] ?? line['line_subtotal'];
    if (explicit !== undefined && explicit !== null && explicit !== '') return this.money(Number(explicit));
    return this.money(Number(line['rate'] || line['price'] || line['unitPrice'] || line['unit_price'] || 0) * Number(line['quantity'] || line['qty'] || 1));
  }

  private lineDiscountAmount(line: ApiRecord): number {
    return this.money(Number(line['discount'] || line['discountAmount'] || line['discount_amount'] || line['manualDiscount'] || line['manual_discount'] || 0));
  }

  private membershipDiscount(invoice: ApiRecord): number {
    return this.money(Number(invoice['membershipDiscount'] || invoice['membership_discount'] || invoice['loyaltyDiscount'] || invoice['loyalty_discount'] || invoice['loyaltyPointsDiscount'] || invoice['loyalty_points_discount'] || 0));
  }

  private auditText(log: ApiRecord): string {
    return `${log['action'] || ''} ${log['event'] || ''} ${log['type'] || ''} ${log['entityType'] || log['entity_type'] || ''} ${log['message'] || ''} ${log['note'] || ''} ${JSON.stringify(log['details'] || {})}`.toLowerCase();
  }

  formatMoney(value: number): string {
    return `â‚¹${this.money(value).toLocaleString('en-IN')}`;
  }

  private safeList(resource: string, params: ApiRecord = {}) {
    return this.api.list<ApiRecord[]>(resource, params).pipe(catchError(() => of([] as ApiRecord[])));
  }

  private needsFinancialControlData(): boolean {
    return this.activeTab === 'daily-sheet' || this.activeTab === 'daily-revenue';
  }

  private ensureFinancialControlDataLoaded(): void {
    if (this.financialControlDataLoaded || this.auxiliaryLoading()) return;
    this.auxiliaryLoading.set(true);
    forkJoin({
      financeExpenses: this.safeList('financeExpenses', { limit: 10000 }),
      auditLogs: this.safeList('auditLogs', { limit: 10000 }),
      cashDrawerReports: this.safeList('cashDrawerEodReports', { limit: 1000 }),
      cashDrawerSessions: this.safeList('cashDrawerSessions', { limit: 1000 })
    }).subscribe({
      next: (data) => {
        this.financeExpenses.set(data.financeExpenses || []);
        this.auditLogs.set(data.auditLogs || []);
        this.cashDrawerReports.set(data.cashDrawerReports || []);
        this.cashDrawerSessions.set(data.cashDrawerSessions || []);
        this.financialControlDataLoaded = true;
        this.auxiliaryLoading.set(false);
        this.invalidateDailyRevenueCache();
      },
      error: () => {
        this.financialControlDataLoaded = true;
        this.auxiliaryLoading.set(false);
      }
    });
  }

  private ensureMemberSalesDataLoaded(): void {
    if (this.memberSalesDataLoaded || this.auxiliaryLoading()) return;
    this.auxiliaryLoading.set(true);
    forkJoin({
      clients: this.safeList('clients', { limit: 10000, compact: true, includeAllBranches: true }),
      memberships: this.safeList('memberships', { limit: 10000, includeAllBranches: true })
    }).subscribe({
      next: (data) => {
        this.clients.set(data.clients || []);
        this.memberships.set(data.memberships || []);
        this.memberSalesDataLoaded = true;
        this.auxiliaryLoading.set(false);
      },
      error: () => {
        this.memberSalesDataLoaded = true;
        this.auxiliaryLoading.set(false);
      }
    });
  }

  private ensureSalesTaxClientDataLoaded(): void {
    if (this.salesTaxClientDataLoaded || this.clients().length || this.auxiliaryLoading()) return;
    this.auxiliaryLoading.set(true);
    forkJoin({
      clients: this.safeList('clients', { limit: 10000, compact: true, includeAllBranches: true })
    }).subscribe({
      next: (data) => {
        this.clients.set(data.clients || []);
        this.salesTaxClientDataLoaded = true;
        this.auxiliaryLoading.set(false);
        this.invalidateSalesTaxCache();
      },
      error: () => {
        this.salesTaxClientDataLoaded = true;
        this.auxiliaryLoading.set(false);
      }
    });
  }

  private invoiceClientId(invoice: ApiRecord): string {
    return String(invoice['clientId'] || invoice['client_id'] || invoice['customerId'] || invoice['customer_id'] || '');
  }

  private clientForInvoice(invoice: ApiRecord): ApiRecord | undefined {
    const clientId = this.invoiceClientId(invoice);
    const phone = this.invoiceClientPhone(invoice);
    return this.clients().find((client) => String(client['id']) === clientId)
      || this.clients().find((client) => this.phoneDigits(String(client['phone'] || client['mobile'] || '')) === this.phoneDigits(phone));
  }

  private invoiceClientName(invoice: ApiRecord, client?: ApiRecord): string {
    return String(invoice['clientName'] || invoice['client_name'] || invoice['customerName'] || invoice['customer_name'] || client?.['name'] || client?.['fullName'] || 'Walk In');
  }

  private invoiceClientPhone(invoice: ApiRecord, client?: ApiRecord): string {
    return String(invoice['clientPhone'] || invoice['client_phone'] || invoice['phone'] || invoice['customerPhone'] || invoice['customer_phone'] || client?.['phone'] || client?.['mobile'] || '-');
  }

  private membershipsForClient(clientId: string, client?: ApiRecord): ApiRecord[] {
    const ids = new Set([clientId, String(client?.['id'] || ''), String(client?.['membershipId'] || client?.['membership_id'] || '')].filter(Boolean));
    const phone = this.phoneDigits(String(client?.['phone'] || client?.['mobile'] || ''));
    return this.memberships().filter((membership) => {
      const linkedIds = [
        membership['clientId'],
        membership['client_id'],
        membership['customerId'],
        membership['customer_id'],
        membership['id']
      ].map((value) => String(value || '')).filter(Boolean);
      const linkedPhone = this.phoneDigits(String(membership['clientPhone'] || membership['client_phone'] || membership['phone'] || ''));
      return linkedIds.some((id) => ids.has(id)) || (!!phone && linkedPhone === phone);
    });
  }

  private isActiveMembership(membership: ApiRecord): boolean {
    const status = String(membership['status'] || '').toLowerCase();
    const activeFlag = membership['isActive'] === true || membership['isActive'] === 1 || membership['active'] === true || membership['active'] === 1;
    const expiry = String(membership['expiryDate'] || membership['expiry_date'] || membership['expiresAt'] || membership['expires_at'] || membership['validTill'] || membership['valid_till'] || '');
    const notExpired = !expiry || !this.dateMs(expiry) || this.dateMs(expiry) >= this.dateMs(this.from || this.today());
    return notExpired && (activeFlag || status === 'active' || status === 'current');
  }

  private memberSuggestedAction(row: MemberSalesRow): string {
    if (row.pendingAmount > 0) return 'recover due';
    if (row.isExpiredMember) return 'renew';
    if (row.isMember) return row.totalSale >= 10000 ? 'upsell' : 'renew';
    return 'convert';
  }

  private phoneDigits(value: string): string {
    return String(value || '').replace(/\D/g, '');
  }

  private periodColumns(): MatrixColumn[] {
    const start = this.periodStart(new Date(this.from || this.defaultFrom()));
    const end = this.periodStart(new Date(this.to || this.today()));
    const columns: MatrixColumn[] = [];
    const cursor = new Date(end);
    while (cursor.getTime() >= start.getTime()) {
      const from = new Date(cursor);
      const to = this.periodEnd(from);
      columns.push({
        key: this.periodKey(from),
        label: this.periodLabel(from),
        from: from.toISOString(),
        to: to.toISOString()
      });
      if (this.periodMode === 'quarter') {
        cursor.setMonth(cursor.getMonth() - 3);
      } else {
        cursor.setMonth(cursor.getMonth() - 1);
      }
    }
    return columns;
  }

  private valueForPeriod(rowKey: string, column: MatrixColumn): number {
    if (rowKey.startsWith('mode:')) {
      const mode = rowKey.slice(5);
      return this.paymentTotalForMode(column, mode);
    }
    const invoices = this.invoicesForPeriod(column);
    switch (rowKey) {
      case 'totalSales':
        return this.money(invoices.reduce((sum, invoice) => sum + this.invoiceTotal(invoice), 0));
      case 'paid':
        return this.money(invoices.reduce((sum, invoice) => sum + this.invoicePaid(invoice), 0));
      case 'balance':
        return this.money(invoices.reduce((sum, invoice) => sum + this.invoiceBalance(invoice), 0));
      case 'discounts':
        return this.money(invoices.reduce((sum, invoice) => sum + this.invoiceDiscount(invoice), 0));
      case 'couponDiscounts':
        return this.money(invoices.reduce((sum, invoice) => sum + this.couponDiscount(invoice), 0));
      case 'taxes':
        return this.money(invoices.reduce((sum, invoice) => sum + this.invoiceTax(invoice), 0));
      case 'exCharges':
        return this.money(invoices.reduce((sum, invoice) => sum + this.extraCharges(invoice), 0));
      case 'giftCardsSale':
        return this.money(this.linesForInvoices(invoices).filter((line) => this.itemType(line).includes('gift')).reduce((sum, line) => sum + this.lineAmount(line), 0));
      case 'expenses':
        return this.expensesForPeriod(column);
      case 'appointmentsAdvance':
        return this.paymentsForPeriod(column).filter((payment) => this.isAdvancePayment(payment)).reduce((sum, payment) => sum + this.paymentAmount(payment), 0);
      case 'tips':
        return this.money(invoices.reduce((sum, invoice) => sum + this.invoiceTips(invoice), 0));
      default:
        return 0;
    }
  }

  private filteredInvoices(): ApiRecord[] {
    return this.invoices().filter((invoice) => this.inDateRange(this.invoiceDate(invoice)));
  }

  private paymentRowsInDateRange(): PaymentDistributionRow[] {
    return this.paymentDistributionBaseRows().filter((row) => {
      const basisDate = this.paymentDateBasis === 'invoice' ? row.invoiceDateValue : row.paymentDateValue;
      return this.inDateRange(basisDate);
    });
  }

  private paymentDistributionBaseRows(): PaymentDistributionRow[] {
    const invoiceById = new Map<string, ApiRecord>();
    for (const invoice of this.invoices()) {
      const ids = [
        invoice['id'],
        invoice['invoiceId'],
        invoice['invoice_id'],
        invoice['invoiceNumber'],
        invoice['invoice_number'],
        invoice['number']
      ].filter((value) => value !== undefined && value !== null && value !== '');
      for (const id of ids) invoiceById.set(String(id), invoice);
    }

    return this.payments().map((payment) => {
      const invoiceId = String(payment['invoiceId'] || payment['invoice_id'] || payment['invoiceNumber'] || payment['invoice_number'] || '');
      const invoice = invoiceById.get(invoiceId) || {};
      const invoiceDateValue = this.invoiceDate(invoice) || this.paymentDate(payment);
      const paymentDateValue = this.paymentDate(payment) || invoiceDateValue;
      const paymentMode = this.modeLabel(this.paymentMode(payment));
      return {
        date: this.compactDateLabel(invoiceDateValue),
        invoiceDateValue,
        name: String(invoice['clientName'] || invoice['client_name'] || invoice['name'] || payment['clientName'] || payment['client_name'] || 'Walk In'),
        contact: String(invoice['clientPhone'] || invoice['client_phone'] || invoice['phone'] || payment['clientPhone'] || payment['client_phone'] || '-'),
        invoiceNo: String(invoice['invoiceNumber'] || invoice['invoice_number'] || invoice['number'] || payment['invoiceNumber'] || payment['invoice_number'] || invoiceId || '-'),
        invoiceId: String(invoice['id'] || invoiceId || ''),
        price: this.paymentAmount(payment),
        paymentMode,
        paymentModeKey: this.modeKey(paymentMode),
        transactionId: String(payment['transactionId'] || payment['transaction_id'] || payment['paymentId'] || payment['payment_id'] || payment['referenceNo'] || payment['reference_no'] || payment['id'] || ''),
        paymentDate: this.compactDateLabel(paymentDateValue),
        paymentDateValue,
        notes: String(payment['notes'] || payment['note'] || payment['remarks'] || payment['reference'] || payment['paymentReference'] || payment['payment_reference'] || '')
      };
    }).filter((row) => row.price > 0);
  }

  private invoicesForPeriod(column: MatrixColumn): ApiRecord[] {
    return this.filteredInvoices().filter((invoice) => this.inPeriod(this.invoiceDate(invoice), column));
  }

  private paymentsForPeriod(column: MatrixColumn): ApiRecord[] {
    return this.payments().filter((payment) => this.inPeriod(this.paymentDate(payment), column));
  }

  private paymentModeRows(): MatrixCell[] {
    const modes = new Map<string, string>();
    for (const payment of this.payments()) {
      const mode = this.paymentMode(payment);
      if (mode) modes.set(this.modeKey(mode), this.modeLabel(mode));
    }
    for (const mode of ['card', 'cash', 'check', 'upi', 'bank', 'wallet', 'reward']) {
      modes.set(this.modeKey(mode), this.modeLabel(mode));
    }
    return [...modes.entries()]
      .map(([key, label]) => ({ key: `mode:${key}`, label }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }

  private paymentTotalForMode(column: MatrixColumn, modeKey: string): number {
    return this.money(this.paymentsForPeriod(column)
      .filter((payment) => this.modeKey(this.paymentMode(payment)) === modeKey)
      .reduce((sum, payment) => sum + this.paymentAmount(payment), 0));
  }

  private expensesForPeriod(column: MatrixColumn): number {
    const summaryRows = [
      ...this.arrayValue(this.financeSummary()['expenses']),
      ...this.arrayValue(this.financeSummary()['refunds'])
    ];
    return this.money(summaryRows
      .filter((row) => this.inPeriod(String(row['createdAt'] || row['created_at'] || row['date'] || row['businessDate'] || this.to), column))
      .reduce((sum, row) => sum + Number(row['amount'] || row['total'] || 0), 0));
  }

  private linesForInvoices(invoices: ApiRecord[]): ApiRecord[] {
    const saleById = new Map(this.sales().map((sale) => [String(sale['id']), sale]));
    return invoices.flatMap((invoice) => {
      const sale = saleById.get(String(invoice['saleId'] || invoice['sale_id'] || '')) || {};
      const lines = this.arrayValue(invoice['lineItems'] || invoice['line_items'] || sale['items']);
      return lines.length ? lines : [];
    });
  }

  private invoiceDate(invoice: ApiRecord): string {
    return String(invoice['createdAt'] || invoice['created_at'] || invoice['invoiceDate'] || invoice['invoice_date'] || invoice['date'] || '');
  }

  private invoiceTotal(invoice: ApiRecord): number {
    return this.money(Number(invoice['total'] ?? invoice['grandTotal'] ?? invoice['grand_total'] ?? 0));
  }

  private invoicePaid(invoice: ApiRecord): number {
    const explicit = invoice['paid'] ?? invoice['paidAmount'] ?? invoice['paid_amount'];
    if (explicit !== undefined && explicit !== null && explicit !== '') return this.money(Number(explicit));
    return this.money(this.payments()
      .filter((payment) => String(payment['invoiceId'] || payment['invoice_id'] || '') === String(invoice['id']))
      .reduce((sum, payment) => sum + this.paymentAmount(payment), 0));
  }

  private invoiceBalance(invoice: ApiRecord): number {
    const explicit = invoice['balance'] ?? invoice['dueAmount'] ?? invoice['due_amount'];
    if (explicit !== undefined && explicit !== null && explicit !== '') return this.money(Number(explicit));
    return this.money(Math.max(0, this.invoiceTotal(invoice) - this.invoicePaid(invoice)));
  }

  private invoiceDiscount(invoice: ApiRecord): number {
    return this.money(Number(invoice['discount'] || invoice['discountTotal'] || invoice['discount_total'] || invoice['manualDiscount'] || invoice['manual_discount'] || 0));
  }

  private couponDiscount(invoice: ApiRecord): number {
    return this.money(Number(invoice['couponDiscount'] || invoice['coupon_discount'] || 0));
  }

  private invoiceTax(invoice: ApiRecord): number {
    return this.money(Number(invoice['gst'] || invoice['gstAmount'] || invoice['gst_amount'] || invoice['tax'] || invoice['taxAmount'] || invoice['tax_amount'] || 0));
  }

  private extraCharges(invoice: ApiRecord): number {
    return this.money(Number(invoice['extraCharges'] || invoice['extra_charges'] || invoice['serviceCharge'] || invoice['service_charge'] || 0));
  }

  private invoiceTips(invoice: ApiRecord): number {
    return this.money(Number(invoice['tipAmount'] || invoice['tip_amount'] || invoice['tips'] || 0));
  }

  private paymentDate(payment: ApiRecord): string {
    return String(payment['paidAt'] || payment['paid_at'] || payment['paymentDate'] || payment['payment_date'] || payment['createdAt'] || payment['created_at'] || payment['date'] || '');
  }

  private paymentAmount(payment: ApiRecord): number {
    return this.money(Number(payment['amount'] || payment['paidAmount'] || payment['paid_amount'] || 0));
  }

  private paymentMode(payment: ApiRecord): string {
    return String(payment['mode'] || payment['paymentMode'] || payment['payment_mode'] || 'unknown');
  }

  private isAdvancePayment(payment: ApiRecord): boolean {
    const text = `${this.paymentMode(payment)} ${payment['reference'] || ''} ${payment['referenceNo'] || ''} ${payment['note'] || ''} ${payment['notes'] || ''}`.toLowerCase();
    return text.includes('advance') || text.includes('booking') || text.includes('prepaid');
  }

  private itemType(line: ApiRecord): string {
    return String(line['type'] || line['itemType'] || line['kind'] || line['category'] || line['name'] || '').toLowerCase();
  }

  private lineAmount(line: ApiRecord): number {
    return this.money(Number(line['total'] || line['lineTotal'] || line['line_total'] || line['finalAmount'] || line['final_amount'] || line['amount'] || line['price'] || this.lineGross(line) || 0));
  }

  private modeKey(mode: string): string {
    const normalized = String(mode || 'unknown').toLowerCase();
    if (normalized.includes('cash')) return 'cash';
    if (normalized.includes('card')) return 'card';
    if (normalized.includes('upi') || normalized.includes('gpay') || normalized.includes('paytm') || normalized.includes('phonepe')) return 'upi';
    if (normalized.includes('cheque') || normalized.includes('check')) return 'check';
    if (normalized.includes('dingg')) return 'dingg_payment';
    if (normalized.includes('prepaid') || normalized.includes('advance')) return 'prepaid';
    if (normalized.includes('giftcard') || normalized.includes('gift card')) return 'giftcard';
    if (normalized.includes('wallet')) return 'wallet';
    if (normalized.includes('reward')) return 'reward';
    if (normalized.includes('bank') || normalized.includes('neft') || normalized.includes('imps') || normalized.includes('rtgs')) return 'bank';
    return normalized.replace(/[^a-z0-9]+/g, '_') || 'unknown';
  }

  private modeLabel(mode: string): string {
    const key = this.modeKey(mode);
    const labels: Record<string, string> = {
      cash: 'CASH',
      card: 'CARD',
      upi: 'UPI',
      check: 'Check',
      dingg_payment: 'DINGG PAYMENT',
      prepaid: 'Prepaid',
      giftcard: 'Giftcard',
      bank: 'Bank',
      wallet: 'Wallet',
      reward: 'Reward',
      unknown: 'Unknown'
    };
    return labels[key] || key.replace(/_/g, ' ').toUpperCase();
  }

  private periodStart(date: Date): Date {
    const safe = Number.isNaN(date.getTime()) ? new Date() : new Date(date);
    if (this.periodMode === 'quarter') {
      const startMonth = Math.floor(safe.getMonth() / 3) * 3;
      return new Date(safe.getFullYear(), startMonth, 1);
    }
    return new Date(safe.getFullYear(), safe.getMonth(), 1);
  }

  private periodEnd(date: Date): Date {
    const start = this.periodStart(date);
    const end = new Date(start);
    end.setMonth(end.getMonth() + (this.periodMode === 'quarter' ? 3 : 1));
    end.setMilliseconds(end.getMilliseconds() - 1);
    return end;
  }

  private periodKey(date: Date): string {
    const start = this.periodStart(date);
    return `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}`;
  }

  private periodLabel(date: Date): string {
    const start = this.periodStart(date);
    if (this.periodMode === 'quarter') {
      return `Q${Math.floor(start.getMonth() / 3) + 1} ${String(start.getFullYear()).slice(2)}`;
    }
    return start.toLocaleDateString('en-IN', { month: 'short', year: '2-digit' }).toUpperCase();
  }

  private inDateRange(value: string): boolean {
    const time = this.dateMs(value);
    if (!time) return true;
    const from = this.dateMs(this.from);
    const to = this.dateMs(this.to) + 24 * 60 * 60 * 1000 - 1;
    return (!from || time >= from) && (!to || time <= to);
  }

  private inDateWindow(value: string, fromValue: string, toValue: string): boolean {
    const time = this.dateMs(value);
    if (!time) return false;
    const from = this.dateMs(fromValue);
    const to = this.dateMs(toValue) + 24 * 60 * 60 * 1000 - 1;
    return (!from || time >= from) && (!to || time <= to);
  }

  private inPeriod(value: string, column: MatrixColumn): boolean {
    const time = this.dateMs(value);
    const from = this.dateMs(column.from);
    const to = this.dateMs(column.to);
    return !!time && (!from || time >= from) && (!to || time <= to);
  }

  private arrayValue(value: unknown): ApiRecord[] {
    if (Array.isArray(value)) return value as ApiRecord[];
    if (!value) return [];
    try {
      const parsed = JSON.parse(String(value));
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  private dateMs(value: unknown): number {
    if (!value) return 0;
    const date = new Date(String(value));
    return Number.isNaN(date.getTime()) ? 0 : date.getTime();
  }

  private businessDateKey(value: unknown): string {
    if (!value) return '';
    const date = new Date(String(value));
    if (Number.isNaN(date.getTime())) return '';
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Kolkata',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).formatToParts(date);
    const part = (type: string) => parts.find((item) => item.type === type)?.value || '';
    return `${part('year')}-${part('month')}-${part('day')}`;
  }

  private inputDate(date: Date): string {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  }

  private money(value: number): number {
    return Math.round((Number(value) || 0) * 100) / 100;
  }

  private csvCell(value: unknown): string {
    return `"${String(value ?? '').replace(/"/g, '""')}"`;
  }

  private downloadFile(filename: string, content: BlobPart, type: string): void {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
  }

  private simplePdf(lines: string[]): Blob {
    const escaped = lines.flatMap((line) => {
      const text = String(line || '').replace(/[()\\]/g, '\\$&');
      return text.match(/.{1,96}/g) || [''];
    });
    const content = ['BT', '/F1 10 Tf', '40 790 Td', '14 TL', ...escaped.map((line) => `(${line}) Tj T*`), 'ET'].join('\n');
    const objects = [
      '1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj',
      '2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj',
      '3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >> endobj',
      '4 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj',
      `5 0 obj << /Length ${content.length} >> stream\n${content}\nendstream endobj`
    ];
    let pdf = '%PDF-1.4\n';
    const offsets = [0];
    for (const object of objects) {
      offsets.push(pdf.length);
      pdf += `${object}\n`;
    }
    const xref = pdf.length;
    pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
    for (let i = 1; i < offsets.length; i += 1) pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
    pdf += `trailer << /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
    return new Blob([pdf], { type: 'application/pdf' });
  }

  private today(): string {
    return new Date().toISOString().slice(0, 10);
  }

  private defaultFrom(): string {
    const date = new Date();
    date.setMonth(date.getMonth() - 5);
    date.setDate(1);
    return date.toISOString().slice(0, 10);
  }
}

