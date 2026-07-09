import { CommonModule } from '@angular/common';
import { Component, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ApiRecord, ApiService } from '../core/api.service';
import { AppStateService } from '../core/state/app-state.service';
import { DATE_RANGE_PRESETS, DateRangePreset, dateRangeParams, rangeForPreset, todayKey } from '../shared/date-range-presets';
import { StateComponent } from '../shared/ui/state/state.component';

type InvoiceActivityKind = 'edited' | 'deleted' | 'restored' | 'payment_updated';
type InvoicePaymentStatus = 'all' | 'paid' | 'partial' | 'due';
type InvoiceRiskLevel = 'low' | 'medium' | 'high' | 'critical';
type InvoiceActivityView = 'activity' | 'cancelled' | 'reports';

interface InvoiceActivityChange {
  category: string;
  field: string;
  oldValue: string;
  newValue: string;
}

interface InvoiceFinanceImpact {
  originalTotal: number;
  updatedTotal: number;
  amountDifference: number;
  paymentDifference: number;
  gstDifference: number;
  dueDifference: number;
  walletImpact: number;
  loyaltyImpact: number;
  stockImpact: string;
  statusBefore: string;
  statusAfter: string;
}

interface InvoiceActivityApiRow {
  id?: string | number | null;
  actionType?: string | null;
  invoiceId?: string | null;
  invoiceNumber?: string | null;
  clientName?: string | null;
  clientPhone?: string | null;
  staffName?: string | null;
  branchId?: string | null;
  branchName?: string | null;
  actionByUser?: string | null;
  invoiceCreatedAt?: string | null;
  actionTime?: string | null;
  status?: string | null;
  total?: number | string | null;
  paid?: number | string | null;
  balance?: number | string | null;
  advanceAdjusted?: number | string | null;
  counterPaid?: number | string | null;
  paymentModes?: string[] | string | null;
  changes?: InvoiceActivityChange[] | string | null;
  financeImpact?: Partial<InvoiceFinanceImpact> | string | null;
  approvalRequired?: boolean | string | number | null;
  approvalStatus?: string | null;
  requestedBy?: string | null;
  requestedRole?: string | null;
  requestedAt?: string | null;
  approvedBy?: string | null;
  approvedRole?: string | null;
  approvalTime?: string | null;
  rejectedBy?: string | null;
  rejectedRole?: string | null;
  rejectionTime?: string | null;
  rejectionReason?: string | null;
  approvalReason?: string | null;
  deleteReason?: string | null;
  auditRole?: string | null;
  auditBranchId?: string | null;
  auditTimestamp?: string | null;
  riskLevel?: string | null;
  riskScore?: number | string | null;
  riskReasons?: string[] | string | null;
  riskReason?: string | null;
  suggestedAction?: string | null;
}

interface InvoiceActivityResponse {
  rows?: InvoiceActivityApiRow[];
  total?: number;
}

interface TodayInvoiceSummary {
  count: number;
  billed: number;
}

interface InvoiceReportSummary {
  totalActivities: number;
  edits: number;
  deletions: number;
  restorations: number;
  paymentUpdates: number;
  highRiskActivities: number;
  criticalRiskActivities: number;
  totalAmount: number;
}

interface DailyEditDeleteReportRow {
  date: string;
  edits: number;
  deletions: number;
  totalAmount: number;
}

interface StaffSuspiciousReportRow {
  staffName: string;
  edits: number;
  deletions: number;
  paymentUpdates: number;
  highAmountChanges: number;
  totalAmount: number;
  suspiciousScore: number;
  riskLevel: InvoiceRiskLevel;
  riskReason: string;
  suggestedAction: string;
}

interface PaymentAdjustmentReportRow {
  paymentMode: string;
  count: number;
  totalAmount: number;
  paymentDifference: number;
}

interface InvoiceActivityActionReportRow {
  date: string;
  invoiceNumber: string;
  clientName: string;
  clientPhone: string;
  staffName: string;
  branchName: string;
  amount: number;
  paid: number;
  due: number;
  advanceAdjusted: number;
  counterPaid: number;
  status: string;
  actionByUser: string;
  riskLevel: InvoiceRiskLevel;
  riskReason: string;
  suggestedAction: string;
}

interface CancelledVoidBillReportRow {
  date: string;
  time: string;
  invoiceNumber: string;
  invoiceId: string;
  clientName: string;
  clientPhone: string;
  staffName: string;
  amount: number;
  paid: number;
  due: number;
  status: string;
  reason: string;
  actionByUser: string;
  actionTime: string;
}

interface CancelledVoidBillSummary {
  totalBill: number;
  totalSale: number;
  receivedAmount: number;
  pendingAmount: number;
}

interface InvoiceActivityExportRow {
  [key: string]: string | number | boolean | null | undefined;
}

interface InvoiceActivityReportResponse {
  generatedAt?: string;
  summary?: Partial<InvoiceReportSummary>;
  dailyEditDeleteReport?: DailyEditDeleteReportRow[];
  staffWiseSuspiciousChanges?: StaffSuspiciousReportRow[];
  paymentAdjustmentReport?: PaymentAdjustmentReportRow[];
  deletedInvoiceReport?: InvoiceActivityActionReportRow[];
  restoredInvoiceReport?: InvoiceActivityActionReportRow[];
  paymentUpdateReport?: InvoiceActivityActionReportRow[];
  exportRows?: InvoiceActivityExportRow[];
}

interface InvoiceActivityRow {
  id: string;
  actionType: InvoiceActivityKind;
  invoiceId: string;
  invoiceNumber: string;
  clientName: string;
  clientPhone: string;
  staffName: string;
  branchId: string;
  branchName: string;
  actionByUser: string;
  invoiceCreatedAt: string;
  actionTime: string;
  status: string;
  total: number;
  paid: number;
  balance: number;
  advanceAdjusted: number;
  counterPaid: number;
  paymentModes: string[];
  changes: InvoiceActivityChange[];
  financeImpact: InvoiceFinanceImpact;
  approvalRequired: boolean;
  approvalStatus: string;
  requestedBy: string;
  requestedRole: string;
  requestedAt: string;
  approvedBy: string;
  approvedRole: string;
  approvalTime: string;
  rejectedBy: string;
  rejectedRole: string;
  rejectionTime: string;
  rejectionReason: string;
  approvalReason: string;
  deleteReason: string;
  auditRole: string;
  auditBranchId: string;
  auditTimestamp: string;
  riskLevel: InvoiceRiskLevel;
  riskScore: number;
  riskReasons: string[];
  riskReason: string;
  suggestedAction: string;
}

@Component({
  selector: 'app-pos-invoice-activity',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, StateComponent],
  template: `
    <section class="page-stack invoice-activity-page inner-page-shell">
      <div class="module-hero invoice-activity-hero inner-page-header">
        <div>
          <h2>Invoice Audit Center</h2>
        </div>
        <div class="hero-actions">
          <a class="ghost-button" routerLink="/pos/invoices">Back to invoices</a>
          <a class="ghost-button" routerLink="/pos">Back to POS</a>
          <button class="primary-button" type="button" (click)="refreshAll()">Refresh</button>
        </div>
      </div>

      <app-state [loading]="loading()" [error]="error()"></app-state>

      <div class="metrics-grid inner-stats-grid" *ngIf="!loading() && !error()">
        <article class="metric-card teal">
          <span>Today invoices</span>
          <strong>{{ todayInvoices().count }}</strong>
          <small>{{ currency(todayInvoices().billed) }} billed today</small>
        </article>
        <article class="metric-card blue">
          <span>Edited invoices</span>
          <strong>{{ count('edited') }}</strong>
        </article>
        <article class="metric-card red">
          <span>Deleted invoices</span>
          <strong>{{ count('deleted') }}</strong>
        </article>
        <article class="metric-card amber">
          <span>Payment updates</span>
          <strong>{{ count('payment_updated') }}</strong>
        </article>
        <article class="metric-card teal">
          <span>Restored invoices</span>
          <strong>{{ count('restored') }}</strong>
        </article>
        <article class="metric-card amber">
          <span>Pending approvals</span>
          <strong>{{ pendingApprovalCount() }}</strong>
        </article>
        <article class="metric-card red">
          <span>High-risk activities</span>
          <strong>{{ highRiskCount() }}</strong>
        </article>
      </div>

      <div class="invoice-activity-tabs" *ngIf="!loading() && !error()">
        <button type="button" [class.active]="activityView === 'activity'" (click)="setActivityView('activity')">
          <span>Activity log</span>
          <strong>{{ filteredRowsCache.length }}</strong>
        </button>
        <button type="button" [class.active]="activityView === 'cancelled'" (click)="setActivityView('cancelled')">
          <span>Cancelled / Void</span>
          <strong>{{ cancelledVoidRowsCache.length }}</strong>
        </button>
        <button type="button" [class.active]="activityView === 'reports'" (click)="setActivityView('reports')">
          <span>Reports</span>
          <strong>{{ reports()?.summary?.totalActivities || 0 }}</strong>
        </button>
      </div>

      <div class="panel invoice-activity-shell inner-page-card" *ngIf="!loading() && !error()">
        <div class="section-title invoice-activity-title">
          <div>
            <h3>Search & filter activity</h3>
          </div>
          <div class="invoice-activity-filter-actions">
            <span>{{ filteredRowsCache.length }} shown</span>
            <button class="ghost-button mini" type="button" (click)="resetFilters()">Reset</button>
            <button class="ghost-button mini" type="button" (click)="refreshAll()">Apply server filter</button>
          </div>
        </div>

        <div class="invoice-activity-filter-grid">
          <label class="field span-2">
            <span>Search invoice, client, phone or staff</span>
            <input [(ngModel)]="search" (ngModelChange)="applyLocalFilters()" placeholder="AURA-2026, client name, phone, staff" />
          </label>
          <label class="field">
            <span>Client search</span>
            <input [(ngModel)]="clientSearch" (ngModelChange)="applyLocalFilters()" placeholder="Client name or phone" />
          </label>
          <label class="field">
            <span>Staff</span>
            <select [(ngModel)]="staffFilter" (ngModelChange)="applyLocalFilters()">
              <option value="all">All staff</option>
              <option *ngFor="let staff of staffOptionsCache" [value]="staff">{{ staff }}</option>
            </select>
          </label>
          <label class="field">
            <span>Action type</span>
            <select [(ngModel)]="actionFilter" (ngModelChange)="applyLocalFilters()">
              <option value="all">All activity</option>
              <option value="edited">Edited</option>
              <option value="deleted">Deleted</option>
              <option value="restored">Restored</option>
              <option value="payment_updated">Payment updated</option>
            </select>
          </label>
          <label class="field">
            <span>Payment mode</span>
            <select [(ngModel)]="paymentModeFilter" (ngModelChange)="applyLocalFilters()">
              <option value="all">All modes</option>
              <option value="cash">Cash</option>
              <option value="card">Card</option>
              <option value="upi">UPI</option>
              <option value="wallet">Wallet</option>
              <option value="bank">Bank transfer</option>
            </select>
          </label>
          <label class="field">
            <span>Invoice status</span>
            <select [(ngModel)]="statusFilter" (ngModelChange)="applyLocalFilters()">
              <option value="all">All status</option>
              <option value="paid">Paid</option>
              <option value="partial">Partial</option>
              <option value="due">Due</option>
            </select>
          </label>
          <label class="field">
            <span>Branch</span>
            <select [(ngModel)]="branchFilter" (ngModelChange)="applyLocalFilters()">
              <option value="all">All branches</option>
              <option *ngFor="let branch of branchOptionsCache" [value]="branch.id">{{ branch.name }}</option>
            </select>
          </label>
          <label class="field" *ngIf="datePreset !== 'all'">
            <span>From date</span>
            <input type="date" [ngModel]="fromDate" (ngModelChange)="updateCustomDate('from', $event)" />
          </label>
          <label class="field" *ngIf="datePreset !== 'today' && datePreset !== 'all'">
            <span>To date</span>
            <input type="date" [ngModel]="toDate" (ngModelChange)="updateCustomDate('to', $event)" />
          </label>
          <div class="invoice-activity-filter-actions">
            <button
              class="ghost-button mini"
              type="button"
              *ngFor="let preset of datePresets"
              [class.active-filter-card]="datePreset === preset.value"
              (click)="applyDatePreset(preset.value)"
            >
              {{ preset.label }}
            </button>
          </div>
          <label class="field">
            <span>Min amount</span>
            <input type="number" min="0" [(ngModel)]="minAmount" (ngModelChange)="applyLocalFilters()" placeholder="0" />
          </label>
          <label class="field">
            <span>Max amount</span>
            <input type="number" min="0" [(ngModel)]="maxAmount" (ngModelChange)="applyLocalFilters()" placeholder="No limit" />
          </label>
        </div>

        <section class="report-center" *ngIf="activityView !== 'activity'">
          <div class="section-title invoice-activity-title">
            <div>
              <span class="eyebrow">{{ activityView === 'cancelled' ? 'Cancelled bill control' : 'Level 7 reports' }}</span>
              <h3>{{ activityView === 'cancelled' ? 'Cancelled / Void-ed Bill' : 'Invoice activity reports' }}</h3>
            </div>
            <div class="invoice-activity-filter-actions">
              <span *ngIf="reports() as report">Generated {{ formatDateTime(report.generatedAt || '') }}</span>
              <button class="ghost-button mini" type="button" (click)="loadReports()" [disabled]="reportLoading()">Refresh reports</button>
              <button class="ghost-button mini" type="button" (click)="exportCsv()" [disabled]="!reportExportRowsCache.length">Export CSV</button>
              <button class="ghost-button mini" type="button" (click)="exportPdf()" [disabled]="!reports()">Export PDF</button>
            </div>
          </div>

          <app-state [loading]="reportLoading()" [error]="reportError()"></app-state>

          <ng-container *ngIf="reports() as report">
            <div class="report-summary-grid" *ngIf="activityView === 'reports'">
              <article>
                <span>Total activity</span>
                <strong>{{ report.summary?.totalActivities || 0 }}</strong>
                <small>{{ currency(report.summary?.totalAmount || 0) }} audited value</small>
              </article>
              <article>
                <span>Edit/delete</span>
                <strong>{{ report.summary?.edits || 0 }} / {{ report.summary?.deletions || 0 }}</strong>
              </article>
              <article>
                <span>Restored</span>
                <strong>{{ report.summary?.restorations || 0 }}</strong>
              </article>
              <article>
                <span>Payments</span>
                <strong>{{ report.summary?.paymentUpdates || 0 }}</strong>
              </article>
              <article>
                <span>Risk</span>
                <strong>{{ report.summary?.highRiskActivities || 0 }}</strong>
                <small>{{ report.summary?.criticalRiskActivities || 0 }} critical activity</small>
              </article>
            </div>

            <section class="cancelled-void-panel" *ngIf="activityView === 'cancelled'">
              <div class="section-title invoice-activity-title">
                <div>
                  <h3>Cancelled and soft-deleted bill register</h3>
                </div>
                <div class="invoice-activity-filter-actions">
                  <button class="ghost-button mini" type="button" (click)="exportCancelledVoidCsv()" [disabled]="!cancelledVoidRowsCache.length">Download CSV</button>
                  <button class="ghost-button mini" type="button" (click)="exportCancelledVoidPdf()" [disabled]="!cancelledVoidRowsCache.length">Download PDF</button>
                </div>
              </div>

              <div class="cancelled-void-summary">
                <article>
                  <span>Total Bill</span>
                  <strong>{{ cancelledVoidSummaryCache.totalBill }}</strong>
                </article>
                <article>
                  <span>Total Sale</span>
                  <strong>{{ currency(cancelledVoidSummaryCache.totalSale) }}</strong>
                </article>
                <article>
                  <span>Received Amount</span>
                  <strong>{{ currency(cancelledVoidSummaryCache.receivedAmount) }}</strong>
                </article>
                <article>
                  <span>Pending Amount</span>
                  <strong>{{ currency(cancelledVoidSummaryCache.pendingAmount) }}</strong>
                </article>
              </div>

              <div class="cancelled-void-toolbar">
                <label class="field cancelled-void-search">
                  <span>Search</span>
                  <input
                    [(ngModel)]="cancelledVoidSearch"
                    (ngModelChange)="rebuildCancelledVoidViewModel()"
                    placeholder="Name, phone or invoice"
                  />
                </label>
                <span>{{ cancelledVoidRowsCache.length }} matched</span>
              </div>

              <div class="table-wrap cancelled-void-table" *ngIf="cancelledVoidRowsCache.length; else noCancelledVoidBills">
                <table>
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Contact</th>
                      <th>Invoice No</th>
                      <th>Price</th>
                      <th>Paid</th>
                      <th>Balance</th>
                      <th>Date</th>
                      <th>Reason</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr *ngFor="let row of cancelledVoidRowsPreview">
                      <td>{{ row.clientName }}</td>
                      <td>{{ row.clientPhone }}</td>
                      <td>
                        <strong>{{ row.invoiceNumber }}</strong>
                        <small>{{ statusLabel(row.status) }}</small>
                      </td>
                      <td>{{ currency(row.amount) }}</td>
                      <td>{{ currency(row.paid) }}</td>
                      <td>{{ currency(row.due) }}</td>
                      <td>
                        <strong>{{ row.date }}</strong>
                        <small>{{ row.time }}</small>
                      </td>
                      <td>
                        <strong>{{ row.reason }}</strong>
                        <small>{{ row.staffName }} / {{ row.actionByUser }}</small>
                      </td>
                      <td>
                        <div class="review-actions">
                          <a
                            class="ghost-button mini edit-action"
                            routerLink="/pos/invoices"
                            [queryParams]="{ invoice: row.invoiceId || row.invoiceNumber }"
                          >
                            Open invoice
                          </a>
                          <button type="button" class="ghost-button mini" (click)="reviewCancelledVoidBill(row)">Review</button>
                        </div>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <ng-template #noCancelledVoidBills>
                <div class="empty-state compact">
                  <strong>No cancelled/voided bills found</strong>
                  <span>Change filters or run report after soft-delete/void activity.</span>
                </div>
              </ng-template>
            </section>

            <div class="report-grid" *ngIf="activityView === 'reports'">
              <article class="report-card">
                <div class="report-card-title">
                  <span>Daily invoice edit/delete report</span>
                  <strong>{{ dailyReportRowsCache.length }}</strong>
                </div>
                <table *ngIf="dailyReportRowsCache.length; else noDailyReport">
                  <thead>
                    <tr><th>Date</th><th>Edits</th><th>Deletes</th><th>Amount</th></tr>
                  </thead>
                  <tbody>
                    <tr *ngFor="let row of dailyReportRowsPreview">
                      <td>{{ row.date }}</td>
                      <td>{{ row.edits }}</td>
                      <td>{{ row.deletions }}</td>
                      <td>{{ currency(row.totalAmount) }}</td>
                    </tr>
                  </tbody>
                </table>
                <ng-template #noDailyReport><div class="empty-state compact"><strong>No daily edit/delete activity</strong></div></ng-template>
              </article>

              <article class="report-card">
                <div class="report-card-title">
                  <span>Staff-wise suspicious changes</span>
                  <strong>{{ staffSuspiciousRowsCache.length }}</strong>
                </div>
                <table *ngIf="staffSuspiciousRowsCache.length; else noStaffReport">
                  <thead>
                    <tr><th>Staff</th><th>Score</th><th>Changes</th><th>Reason</th></tr>
                  </thead>
                  <tbody>
                    <tr *ngFor="let row of staffSuspiciousRowsPreview">
                      <td>{{ row.staffName }}</td>
                      <td><span class="badge" [ngClass]="riskBadgeClass(row.riskLevel)">{{ row.suspiciousScore }}</span></td>
                      <td>{{ row.edits }} edit / {{ row.deletions }} delete / {{ row.paymentUpdates }} payment</td>
                      <td>
                        <strong>{{ riskLabel(row.riskLevel) }}</strong>
                        <small>{{ row.riskReason }}</small>
                      </td>
                    </tr>
                  </tbody>
                </table>
                <ng-template #noStaffReport><div class="empty-state compact"><strong>No staff risk pattern</strong></div></ng-template>
              </article>

              <article class="report-card">
                <div class="report-card-title">
                  <span>Cash/Card/UPI adjustment report</span>
                  <strong>{{ paymentAdjustmentRowsCache.length }}</strong>
                </div>
                <table *ngIf="paymentAdjustmentRowsCache.length; else noPaymentReport">
                  <thead>
                    <tr><th>Mode</th><th>Count</th><th>Amount</th><th>Diff</th></tr>
                  </thead>
                  <tbody>
                    <tr *ngFor="let row of paymentAdjustmentRowsPreview">
                      <td>{{ paymentModeLabel(row.paymentMode) }}</td>
                      <td>{{ row.count }}</td>
                      <td>{{ currency(row.totalAmount) }}</td>
                      <td>{{ currency(row.paymentDifference) }}</td>
                    </tr>
                  </tbody>
                </table>
                <ng-template #noPaymentReport><div class="empty-state compact"><strong>No payment adjustments</strong></div></ng-template>
              </article>

              <article class="report-card">
                <div class="report-card-title">
                  <span>Deleted invoice report</span>
                  <strong>{{ deletedReportRowsCache.length }}</strong>
                </div>
                <table *ngIf="deletedReportRowsCache.length; else noDeletedReport">
                  <thead>
                    <tr><th>Invoice</th><th>Client</th><th>Staff</th><th>Amount</th></tr>
                  </thead>
                  <tbody>
                    <tr *ngFor="let row of deletedReportRowsPreview">
                      <td>{{ row.invoiceNumber }}</td>
                      <td>{{ row.clientName }}</td>
                      <td>{{ row.staffName }}</td>
                      <td>{{ currency(row.amount) }}</td>
                    </tr>
                  </tbody>
                </table>
                <ng-template #noDeletedReport><div class="empty-state compact"><strong>No deleted invoices</strong></div></ng-template>
              </article>

              <article class="report-card">
                <div class="report-card-title">
                  <span>Restored invoice report</span>
                  <strong>{{ restoredReportRowsCache.length }}</strong>
                </div>
                <table *ngIf="restoredReportRowsCache.length; else noRestoredReport">
                  <thead>
                    <tr><th>Invoice</th><th>Client</th><th>Staff</th><th>Amount</th></tr>
                  </thead>
                  <tbody>
                    <tr *ngFor="let row of restoredReportRowsPreview">
                      <td>{{ row.invoiceNumber }}</td>
                      <td>{{ row.clientName }}</td>
                      <td>{{ row.staffName }}</td>
                      <td>{{ currency(row.amount) }}</td>
                    </tr>
                  </tbody>
                </table>
                <ng-template #noRestoredReport><div class="empty-state compact"><strong>No restored invoices</strong></div></ng-template>
              </article>

              <article class="report-card">
                <div class="report-card-title">
                  <span>Payment update report</span>
                  <strong>{{ paymentUpdateReportRowsCache.length }}</strong>
                </div>
                <table *ngIf="paymentUpdateReportRowsCache.length; else noPaymentUpdateReport">
                  <thead>
                    <tr><th>Invoice</th><th>Client</th><th>Advance adjusted</th><th>Counter paid</th><th>Status</th><th>Due</th></tr>
                  </thead>
                  <tbody>
                    <tr *ngFor="let row of paymentUpdateReportRowsPreview">
                      <td>{{ row.invoiceNumber }}</td>
                      <td>{{ row.clientName }}</td>
                      <td>{{ currency(row.advanceAdjusted || 0) }}</td>
                      <td>{{ currency(row.counterPaid || 0) }}</td>
                      <td>{{ statusLabel(row.status) }}</td>
                      <td>{{ currency(row.due) }}</td>
                    </tr>
                  </tbody>
                </table>
                <ng-template #noPaymentUpdateReport><div class="empty-state compact"><strong>No payment updates</strong></div></ng-template>
              </article>
            </div>
          </ng-container>
        </section>

        <ng-container *ngIf="activityView === 'activity'">
        <div class="table-wrap invoice-activity-table" *ngIf="filteredRowsCache.length; else noActivity">
          <table>
            <thead>
              <tr>
                <th>Activity</th>
                <th>Invoice & client</th>
                <th>Staff / branch</th>
                <th>Payment</th>
                <th>Financial impact</th>
                <th>Audit user</th>
                <th>Risk</th>
                <th>Review</th>
              </tr>
            </thead>
            <tbody>
              <tr
                *ngFor="let row of filteredRowsCache; trackBy: trackByRow"
                [class.selected-row]="selectedRow()?.id === row.id"
              >
                <td>
                  <strong>{{ formatDate(row.actionTime) }}</strong>
                  <small>{{ formatTime(row.actionTime) }}</small>
                  <span class="badge" [ngClass]="actionBadgeClass(row.actionType)">{{ actionLabel(row.actionType) }}</span>
                </td>
                <td>
                  <strong>{{ row.invoiceNumber }}</strong>
                  <small *ngIf="row.invoiceId">{{ row.invoiceId }}</small>
                  <small>{{ row.clientName }} / {{ row.clientPhone }}</small>
                </td>
                <td>
                  <strong>{{ row.staffName }}</strong>
                  <small>{{ row.branchName }}</small>
                </td>
                <td>
                  <strong>{{ paymentModesLabel(row) }}</strong>
                  <small>{{ statusLabel(row.status) }}</small>
                </td>
                <td>
                  <strong>{{ currency(row.total) }}</strong>
                  <small>Paid {{ currency(row.paid) }} / Due {{ currency(row.balance) }}</small>
                  <small>
                    <b [class.amount-down]="row.financeImpact.amountDifference < 0" [class.amount-up]="row.financeImpact.amountDifference > 0">{{ signedCurrency(row.financeImpact.amountDifference) }}</b>
                    · Adv {{ currency(row.advanceAdjusted) }} · Counter {{ currency(row.counterPaid) }}
                  </small>
                </td>
                <td>
                  <strong>{{ row.actionByUser }}</strong>
                  <small>Created {{ formatTime(row.invoiceCreatedAt || row.actionTime) }}</small>
                  <small>Changed {{ formatTime(row.actionTime) }}</small>
                </td>
                <td>
                  <span class="badge" [ngClass]="riskBadgeClass(row.riskLevel)">{{ riskLabel(row.riskLevel) }}</span>
                  <small class="risk-copy">{{ row.riskReason }}</small>
                </td>
                <td>
                  <div class="review-actions">
                    <a
                      *ngIf="row.invoiceId"
                      class="ghost-button mini edit-action"
                      routerLink="/pos/invoices"
                      [queryParams]="{ invoice: row.invoiceId }"
                    >
                      Edit invoice
                    </a>
                    <button type="button" class="ghost-button mini" (click)="reviewNow(row)">View details</button>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        </ng-container>

        <aside class="activity-detail-drawer" *ngIf="selectedRow() as selected">
          <div class="drawer-header">
            <div>
              <h3>{{ selected.invoiceNumber }}</h3>
              <p>{{ actionLabel(selected.actionType) }} by {{ selected.actionByUser }} on {{ formatDate(selected.actionTime) }} at {{ formatTime(selected.actionTime) }}</p>
            </div>
            <div class="review-actions">
              <a
                *ngIf="selected.invoiceId"
                class="ghost-button mini edit-action"
                routerLink="/pos/invoices"
                [queryParams]="{ invoice: selected.invoiceId }"
              >
                Edit invoice
              </a>
              <button type="button" class="ghost-button mini" (click)="closeDetail()">Close</button>
            </div>
          </div>

          <div class="invoice-summary-grid">
            <article>
              <span>Client</span>
              <strong>{{ selected.clientName }}</strong>
              <small>{{ selected.clientPhone }}</small>
            </article>
            <article>
              <span>Staff</span>
              <strong>{{ selected.staffName }}</strong>
              <small>{{ selected.branchName }}</small>
            </article>
            <article>
              <span>Total</span>
              <strong>{{ currency(selected.total) }}</strong>
              <small>Paid {{ currency(selected.paid) }} / Due {{ currency(selected.balance) }}</small>
            </article>
            <article>
              <span>Created / changed</span>
              <strong>{{ formatDateTime(selected.invoiceCreatedAt || selected.actionTime) }}</strong>
              <small>Changed {{ formatDateTime(selected.actionTime) }}</small>
            </article>
            <article>
              <span>Status</span>
              <strong>{{ statusLabel(selected.status) }}</strong>
              <small>{{ selected.changes.length }} change{{ selected.changes.length === 1 ? '' : 's' }}</small>
            </article>
          </div>

          <section class="finance-impact-panel">
            <div class="section-title invoice-activity-title">
              <div>
                <h3>Before and after impact</h3>
              </div>
              <span class="badge" [ngClass]="statusBadgeClass(selected.financeImpact.statusAfter)">{{ statusLabel(selected.financeImpact.statusAfter) }}</span>
            </div>
            <div class="finance-impact-grid">
              <article>
                <span>Original total</span>
                <strong>{{ currency(selected.financeImpact.originalTotal) }}</strong>
              </article>
              <article>
                <span>Updated total</span>
                <strong>{{ currency(selected.financeImpact.updatedTotal) }}</strong>
              </article>
              <article>
                <span>Amount difference</span>
                <strong [class.amount-down]="selected.financeImpact.amountDifference < 0" [class.amount-up]="selected.financeImpact.amountDifference > 0">{{ signedCurrency(selected.financeImpact.amountDifference) }}</strong>
                <small>{{ currency(selected.financeImpact.originalTotal) }} -> {{ currency(selected.financeImpact.updatedTotal) }}</small>
              </article>
              <article>
                <span>Payment difference</span>
                <strong>{{ signedCurrency(selected.financeImpact.paymentDifference) }}</strong>
                <small>{{ statusLabel(selected.financeImpact.statusBefore) }} -> {{ statusLabel(selected.financeImpact.statusAfter) }}</small>
              </article>
              <article>
                <span>GST difference</span>
                <strong>{{ signedCurrency(selected.financeImpact.gstDifference) }}</strong>
              </article>
              <article>
                <span>Due difference</span>
                <strong>{{ signedCurrency(selected.financeImpact.dueDifference) }}</strong>
              </article>
              <article>
                <span>Wallet impact</span>
                <strong>{{ signedCurrency(selected.financeImpact.walletImpact) }}</strong>
                <small>Loyalty {{ signedNumber(selected.financeImpact.loyaltyImpact) }}</small>
              </article>
              <article class="span-2">
                <span>Stock impact</span>
                <strong>{{ selected.financeImpact.stockImpact }}</strong>
              </article>
            </div>
          </section>

          <section class="risk-review-panel" [ngClass]="riskBadgeClass(selected.riskLevel)">
            <div class="section-title invoice-activity-title">
              <div>
                <h3>{{ riskLabel(selected.riskLevel) }} risk</h3>
              </div>
              <span class="badge" [ngClass]="riskBadgeClass(selected.riskLevel)">Score {{ selected.riskScore }}</span>
            </div>
            <div class="risk-review-grid">
              <article>
                <span>Risk reason</span>
                <strong>{{ selected.riskReason }}</strong>
              </article>
              <article>
                <span>Suggested action</span>
                <strong>{{ selected.suggestedAction }}</strong>
              </article>
            </div>
          </section>

          <section class="audit-trail-panel">
            <div class="section-title invoice-activity-title">
              <div>
                <h3>User, role, branch and timestamp</h3>
              </div>
              <span class="badge info">{{ selected.auditRole || 'Role captured' }}</span>
            </div>
            <div class="audit-trail-grid">
              <article>
                <span>Action by</span>
                <strong>{{ selected.actionByUser }}</strong>
                <small>{{ selected.auditRole || '-' }}</small>
              </article>
              <article>
                <span>Action time</span>
                <strong>{{ formatDateTime(selected.auditTimestamp || selected.actionTime) }}</strong>
              </article>
              <article>
                <span>Branch</span>
                <strong>{{ selected.branchName }}</strong>
                <small>{{ selected.auditBranchId || selected.branchId }}</small>
              </article>
              <article>
                <span>Payment</span>
                <strong>{{ paymentModesLabel(selected) }}</strong>
                <small>{{ selected.actionType === 'payment_updated' ? 'Payment update' : 'Invoice activity' }}</small>
              </article>
              <article *ngIf="selected.requestedBy">
                <span>Requested by</span>
                <strong>{{ selected.requestedBy }}</strong>
                <small>{{ selected.requestedRole || formatDateTime(selected.requestedAt) }}</small>
              </article>
              <article *ngIf="selected.approvedBy">
                <span>Approved by</span>
                <strong>{{ selected.approvedBy }}</strong>
                <small>{{ selected.approvedRole || formatDateTime(selected.approvalTime) }}</small>
              </article>
              <article *ngIf="selected.rejectedBy">
                <span>Rejected by</span>
                <strong>{{ selected.rejectedBy }}</strong>
                <small>{{ selected.rejectedRole || selected.rejectionReason }}</small>
              </article>
            </div>
          </section>

          <section class="approval-workflow-panel" *ngIf="hasApprovalWorkflow(selected)">
            <div class="section-title invoice-activity-title">
              <div>
                <h3>{{ statusLabel(selected.status) }}</h3>
              </div>
              <span class="badge" [ngClass]="statusBadgeClass(selected.status)">{{ statusLabel(selected.status) }}</span>
            </div>

            <app-state [loading]="approvalSaving() === selected.id" [error]="approvalError()"></app-state>

            <div class="approval-timeline">
              <article>
                <span>Requested</span>
                <strong>{{ selected.requestedBy || selected.actionByUser }}</strong>
                <small>{{ formatDateTime(selected.requestedAt || selected.actionTime) }}</small>
              </article>
              <article>
                <span>Reason</span>
                <strong>{{ selected.deleteReason || selected.approvalReason || '-' }}</strong>
                <small>{{ selected.actionType === 'deleted' ? 'Delete approval' : 'Edit approval' }}</small>
              </article>
              <article>
                <span>Approved by</span>
                <strong>{{ selected.approvedBy || '-' }}</strong>
                <small>{{ selected.approvalTime ? formatDateTime(selected.approvalTime) : '-' }}</small>
              </article>
              <article>
                <span>Rejected by</span>
                <strong>{{ selected.rejectedBy || '-' }}</strong>
                <small>{{ selected.rejectionReason || (selected.rejectionTime ? formatDateTime(selected.rejectionTime) : '-') }}</small>
              </article>
            </div>

            <div class="approval-actions" *ngIf="isPendingApproval(selected)">
              <label class="field">
                <span>Owner PIN/password for approval</span>
                <input type="password" [(ngModel)]="approvalOwnerPin" autocomplete="off" placeholder="Required before applying action" />
              </label>
              <label class="field">
                <span>Rejection reason</span>
                <input [(ngModel)]="approvalRejectionReason" placeholder="Required only when rejecting" />
              </label>
              <div class="hero-actions">
                <button class="primary-button" type="button" (click)="approveActivity(selected)" [disabled]="approvalSaving() === selected.id">Approve</button>
                <button class="ghost-button danger-text" type="button" (click)="rejectActivity(selected)" [disabled]="approvalSaving() === selected.id">Reject</button>
              </div>
            </div>
          </section>

          <section class="approval-workflow-panel" *ngIf="canShowRestore(selected)">
            <div class="section-title invoice-activity-title">
              <div>
                <h3>Restore soft-deleted invoice</h3>
              </div>
              <span class="badge warning">Role protected</span>
            </div>

            <app-state [loading]="restoreSaving() === selected.id" [error]="restoreError()"></app-state>

            <div class="approval-actions">
              <label class="field">
                <span>Restore reason</span>
                <input [(ngModel)]="restoreReason" placeholder="Required before restoring invoice" />
              </label>
              <div class="hero-actions">
                <button
                  class="primary-button"
                  type="button"
                  (click)="restoreActivity(selected)"
                  [disabled]="restoreSaving() === selected.id || !canRestoreInvoices()"
                  [title]="canRestoreInvoices() ? 'Restore invoice into saved invoices' : 'Only owner, super admin or manager can restore invoices'"
                >
                  Restore invoice
                </button>
              </div>
            </div>
          </section>

          <div class="change-list" *ngIf="selected.changes.length; else noChangeDetail">
            <article *ngFor="let change of selected.changes">
              <span>{{ change.category }}</span>
              <strong>{{ change.field }}</strong>
              <p><em>{{ change.oldValue }}</em><b>-></b><em>{{ change.newValue }}</em></p>
            </article>
          </div>
          <ng-template #noChangeDetail>
            <div class="empty-state compact">
              <strong>No field-level changes captured</strong>
              <span>This activity was logged before detailed before/after tracking was available.</span>
            </div>
          </ng-template>
        </aside>

        <ng-template #noActivity>
          <div class="empty-state">
            <strong>No invoice activity found</strong>
            <span>Change filters or wait for edited, deleted, restored and payment update records.</span>
          </div>
        </ng-template>
      </div>
    </section>
  `,
  styles: [`
    .invoice-activity-page {
      gap: 14px;
    }

    .invoice-activity-hero {
      padding: 22px 24px;
    }

    .invoice-activity-shell {
      padding: 16px;
    }

    .invoice-activity-tabs {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 8px;
      padding: 8px;
      border: 1px solid var(--line);
      border-radius: var(--radius-md);
      background: #fff;
      box-shadow: var(--shadow-sm);
    }

    .invoice-activity-tabs button {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      min-height: 48px;
      padding: 10px 14px;
      border: 1px solid transparent;
      border-radius: var(--radius-sm);
      background: transparent;
      color: var(--ink);
      font: inherit;
      cursor: pointer;
      text-align: left;
    }

    .invoice-activity-tabs button:hover {
      border-color: var(--line);
      background: #f8fafc;
    }

    .invoice-activity-tabs button.active {
      border-color: #111827;
      background: #111827;
      color: #fff;
      box-shadow: 0 10px 22px rgba(15, 23, 42, 0.16);
    }

    .invoice-activity-tabs span {
      font-size: 0.82rem;
      font-weight: 900;
    }

    .invoice-activity-tabs strong {
      min-width: 34px;
      padding: 5px 8px;
      border-radius: 999px;
      background: rgba(15, 23, 42, 0.08);
      text-align: center;
      font-size: 0.8rem;
    }

    .invoice-activity-tabs button.active strong {
      background: rgba(255, 255, 255, 0.18);
    }

    .invoice-activity-title {
      align-items: end;
      margin-bottom: 16px;
    }

    .invoice-activity-filter-actions {
      display: flex;
      align-items: center;
      justify-content: flex-end;
      gap: 10px;
      color: var(--muted);
      font-size: 0.84rem;
      flex-wrap: wrap;
    }

    .invoice-activity-filter-grid {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 12px;
      margin-bottom: 18px;
    }

    .span-2 {
      grid-column: span 2;
    }

    .report-center {
      display: grid;
      gap: 16px;
      margin: 18px 0 20px;
      padding: 16px;
      border: 1px solid rgba(37, 99, 235, 0.16);
      border-radius: var(--radius-md);
      background: #f8fbff;
    }

    .report-summary-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));
      gap: 12px;
    }

    .report-summary-grid article {
      display: grid;
      gap: 5px;
      padding: 14px;
      border: 1px solid var(--line);
      border-radius: var(--radius-md);
      background: #fff;
    }

    .report-summary-grid span,
    .report-card-title span {
      color: var(--muted);
      font-size: 0.74rem;
      font-weight: 800;
      letter-spacing: 0.05em;
      text-transform: uppercase;
    }

    .report-summary-grid small {
      color: var(--muted);
    }

    .report-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 12px;
    }

    .cancelled-void-panel {
      display: grid;
      gap: 14px;
      padding: 14px;
      border: 1px solid rgba(220, 38, 38, 0.18);
      border-radius: var(--radius-md);
      background: #fff;
    }

    .cancelled-void-summary {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 12px;
    }

    .cancelled-void-summary article {
      display: grid;
      gap: 8px;
      padding: 14px;
      border: 1px solid var(--line);
      border-radius: var(--radius-md);
      background: #fbfdff;
    }

    .cancelled-void-summary span,
    .cancelled-void-toolbar span {
      color: var(--muted);
      font-size: 0.74rem;
      font-weight: 800;
      letter-spacing: 0.05em;
      text-transform: uppercase;
    }

    .cancelled-void-toolbar {
      display: grid;
      grid-template-columns: minmax(220px, 420px) auto;
      gap: 12px;
      align-items: end;
      justify-content: space-between;
    }

    .cancelled-void-search {
      margin: 0;
    }

    .cancelled-void-table table {
      min-width: 1180px;
    }

    .cancelled-void-table th,
    .cancelled-void-table td {
      white-space: normal;
    }

    .cancelled-void-table small {
      display: block;
      color: var(--muted);
      line-height: 1.35;
    }

    .report-card {
      display: grid;
      gap: 12px;
      min-width: 0;
      padding: 14px;
      border: 1px solid var(--line);
      border-radius: var(--radius-md);
      background: #fff;
    }

    .report-card-title {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
    }

    .report-card table {
      width: 100%;
      border-collapse: collapse;
      table-layout: fixed;
      font-size: 0.82rem;
    }

    .report-card th,
    .report-card td {
      padding: 8px 6px;
      border-bottom: 1px solid var(--line);
      text-align: left;
      vertical-align: top;
      overflow-wrap: anywhere;
    }

    .invoice-activity-table table {
      min-width: 1040px;
      width: 100%;
      border-collapse: collapse;
      table-layout: fixed;
      font-size: 0.86rem;
    }

    .invoice-activity-table {
      max-height: min(680px, calc(100vh - 230px));
      border: 1px solid var(--line);
      border-radius: var(--radius-md);
      background: #fff;
      box-shadow: var(--shadow-sm);
      overflow: auto;
    }

    .invoice-activity-table th {
      position: sticky;
      top: 0;
      z-index: 1;
      padding: 11px 12px;
      border-bottom: 1px solid var(--line);
      background: #f8fafc;
      color: var(--muted);
      font-size: 0.72rem;
      font-weight: 900;
      letter-spacing: 0.05em;
      text-align: left;
      text-transform: uppercase;
    }

    .invoice-activity-table td {
      padding: 12px;
      border-bottom: 1px solid var(--line);
      vertical-align: top;
      overflow-wrap: anywhere;
    }

    .invoice-activity-table tr:hover {
      background: #f8fbff;
    }

    .invoice-activity-table td:nth-child(1) {
      width: 118px;
    }

    .invoice-activity-table td:nth-child(2) {
      width: 210px;
    }

    .invoice-activity-table td:nth-child(3),
    .invoice-activity-table td:nth-child(4) {
      width: 145px;
    }

    .invoice-activity-table td:nth-child(5),
    .invoice-activity-table td:nth-child(6) {
      width: 165px;
    }

    .invoice-activity-table td:nth-child(8) {
      width: 170px;
    }

    .invoice-activity-table small {
      display: block;
      color: var(--muted);
      line-height: 1.35;
    }

    .invoice-activity-table .badge {
      margin-top: 6px;
    }

    .invoice-activity-table .risk-copy {
      display: -webkit-box;
      max-height: 42px;
      overflow: hidden;
      -webkit-box-orient: vertical;
      -webkit-line-clamp: 2;
    }

    .invoice-activity-table .review-actions {
      justify-content: flex-start;
    }

    .invoice-activity-table tr.selected-row {
      background: var(--color-primary-soft);
      box-shadow: inset 4px 0 0 var(--teal);
    }

    .amount-down {
      color: #b91c1c;
    }

    .amount-up {
      color: #7A4A28;
    }

    .review-actions {
      display: flex;
      flex-wrap: wrap;
      justify-content: flex-end;
      gap: 8px;
    }

    .edit-action {
      border-color: rgba(75, 18, 56, 0.35);
      background: #F5EEF2;
      color: #4B1238;
      font-weight: 800;
    }

    .activity-detail-drawer {
      display: grid;
      gap: 16px;
      margin-top: 18px;
      padding: 18px;
      border: 1px solid rgba(75, 18, 56, 0.28);
      border-radius: var(--radius-lg);
      background: linear-gradient(135deg, rgba(75, 18, 56, 0.06), transparent 55%), #fff;
      box-shadow: var(--shadow-md);
    }

    .drawer-header {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 16px;
      border-bottom: 1px solid var(--line);
      padding-bottom: 14px;
    }

    .drawer-header h3 {
      margin: 0;
      font-size: 1.25rem;
    }

    .drawer-header p {
      margin: 6px 0 0;
      color: var(--muted);
    }

    .invoice-summary-grid {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 12px;
    }

    .invoice-summary-grid article,
    .change-list article {
      border: 1px solid var(--line);
      border-radius: var(--radius-md);
      background: #fff;
    }

    .invoice-summary-grid article {
      display: grid;
      gap: 5px;
      padding: 14px;
    }

    .invoice-summary-grid span,
    .change-list span {
      color: var(--muted);
      font-size: 0.75rem;
      font-weight: 800;
      letter-spacing: 0.05em;
      text-transform: uppercase;
    }

    .invoice-summary-grid small {
      color: var(--muted);
    }

    .change-list {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 12px;
    }

    .approval-workflow-panel {
      display: grid;
      gap: 14px;
      padding: 16px;
      border: 1px solid rgba(245, 158, 11, 0.34);
      border-radius: var(--radius-md);
      background: #fffaf0;
    }

    .finance-impact-panel,
    .audit-trail-panel {
      display: grid;
      gap: 14px;
      padding: 16px;
      border: 1px solid rgba(75, 18, 56, 0.22);
      border-radius: var(--radius-md);
      background: #f7fffd;
    }

    .audit-trail-panel {
      border-color: rgba(37, 99, 235, 0.2);
      background: #f8fbff;
    }

    .finance-impact-grid,
    .audit-trail-grid {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 12px;
    }

    .finance-impact-grid article,
    .audit-trail-grid article {
      display: grid;
      gap: 6px;
      min-width: 0;
      padding: 12px;
      border: 1px solid var(--line);
      border-radius: var(--radius-md);
      background: #fff;
    }

    .finance-impact-grid span,
    .audit-trail-grid span {
      color: var(--muted);
      font-size: 0.72rem;
      font-weight: 800;
      letter-spacing: 0.05em;
      text-transform: uppercase;
    }

    .finance-impact-grid strong,
    .audit-trail-grid strong,
    .finance-impact-grid small,
    .audit-trail-grid small {
      overflow-wrap: anywhere;
    }

    .risk-review-panel {
      display: grid;
      gap: 14px;
      padding: 16px;
      border: 1px solid rgba(37, 99, 235, 0.18);
      border-radius: var(--radius-md);
      background: #f8fbff;
    }

    .risk-review-panel.warning {
      border-color: rgba(245, 158, 11, 0.38);
      background: #fffaf0;
    }

    .risk-review-panel.danger {
      border-color: rgba(220, 38, 38, 0.32);
      background: #fff5f5;
    }

    .risk-review-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 12px;
    }

    .risk-review-grid article {
      display: grid;
      gap: 6px;
      padding: 12px;
      border: 1px solid var(--line);
      border-radius: var(--radius-md);
      background: #fff;
    }

    .risk-review-grid span {
      color: var(--muted);
      font-size: 0.72rem;
      font-weight: 800;
      letter-spacing: 0.05em;
      text-transform: uppercase;
    }

    .risk-review-grid strong,
    .invoice-activity-table td small {
      overflow-wrap: anywhere;
    }

    .approval-timeline {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 12px;
    }

    .approval-timeline article {
      display: grid;
      gap: 5px;
      padding: 12px;
      border: 1px solid var(--line);
      border-radius: var(--radius-md);
      background: #fff;
    }

    .approval-timeline span {
      color: var(--muted);
      font-size: 0.72rem;
      font-weight: 800;
      letter-spacing: 0.05em;
      text-transform: uppercase;
    }

    .approval-timeline small {
      color: var(--muted);
      word-break: break-word;
    }

    .approval-actions {
      display: grid;
      grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) auto;
      gap: 12px;
      align-items: end;
    }

    .change-list article {
      display: grid;
      gap: 8px;
      padding: 14px;
    }

    .change-list p {
      display: flex;
      align-items: center;
      gap: 9px;
      margin: 0;
      line-height: 1.45;
      flex-wrap: wrap;
    }

    .change-list em {
      min-width: 0;
      padding: 6px 9px;
      border-radius: var(--radius-xs);
      background: var(--color-surface-sunken);
      color: var(--ink);
      font-style: normal;
      word-break: break-word;
    }

    .change-list b {
      color: var(--teal-2);
      font-weight: 900;
    }

    .empty-state.compact {
      min-height: 110px;
    }

    @media (max-width: 1260px) {
      .invoice-activity-filter-grid {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }

      .invoice-summary-grid,
      .report-summary-grid,
      .cancelled-void-summary,
      .approval-timeline,
      .finance-impact-grid,
      .audit-trail-grid,
      .risk-review-grid,
      .change-list {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }

      .report-grid {
        grid-template-columns: 1fr;
      }

      .approval-actions {
        grid-template-columns: 1fr;
      }
    }

    @media (max-width: 760px) {
      .invoice-activity-tabs {
        grid-template-columns: 1fr;
      }

      .invoice-activity-title {
        align-items: stretch;
      }

      .invoice-activity-filter-actions {
        justify-content: stretch;
      }

      .invoice-activity-filter-grid {
        grid-template-columns: 1fr;
      }

      .cancelled-void-toolbar {
        grid-template-columns: 1fr;
      }

      .span-2 {
        grid-column: span 1;
      }

      .drawer-header {
        display: grid;
      }

      .invoice-summary-grid,
      .report-summary-grid,
      .cancelled-void-summary,
      .approval-timeline,
      .finance-impact-grid,
      .audit-trail-grid,
      .risk-review-grid,
      .change-list {
        grid-template-columns: 1fr;
      }
    }
  `]
})
export class PosInvoiceActivityComponent implements OnInit {
  loading = signal(false);
  error = signal('');
  rows = signal<InvoiceActivityRow[]>([]);
  todayInvoices = signal<TodayInvoiceSummary>({ count: 0, billed: 0 });
  selectedRow = signal<InvoiceActivityRow | null>(null);
  approvalSaving = signal<string | null>(null);
  approvalError = signal('');
  restoreSaving = signal<string | null>(null);
  restoreError = signal('');
  reportLoading = signal(false);
  reportError = signal('');
  reports = signal<InvoiceActivityReportResponse | null>(null);
  activityView: InvoiceActivityView = 'activity';
  filteredRowsCache: InvoiceActivityRow[] = [];
  staffOptionsCache: string[] = [];
  branchOptionsCache: Array<{ id: string; name: string }> = [];
  dailyReportRowsCache: DailyEditDeleteReportRow[] = [];
  dailyReportRowsPreview: DailyEditDeleteReportRow[] = [];
  staffSuspiciousRowsCache: StaffSuspiciousReportRow[] = [];
  staffSuspiciousRowsPreview: StaffSuspiciousReportRow[] = [];
  paymentAdjustmentRowsCache: PaymentAdjustmentReportRow[] = [];
  paymentAdjustmentRowsPreview: PaymentAdjustmentReportRow[] = [];
  deletedReportRowsCache: InvoiceActivityActionReportRow[] = [];
  deletedReportRowsPreview: InvoiceActivityActionReportRow[] = [];
  cancelledVoidRowsCache: CancelledVoidBillReportRow[] = [];
  cancelledVoidRowsPreview: CancelledVoidBillReportRow[] = [];
  cancelledVoidSummaryCache: CancelledVoidBillSummary = {
    totalBill: 0,
    totalSale: 0,
    receivedAmount: 0,
    pendingAmount: 0
  };
  restoredReportRowsCache: InvoiceActivityActionReportRow[] = [];
  restoredReportRowsPreview: InvoiceActivityActionReportRow[] = [];
  paymentUpdateReportRowsCache: InvoiceActivityActionReportRow[] = [];
  paymentUpdateReportRowsPreview: InvoiceActivityActionReportRow[] = [];
  reportExportRowsCache: InvoiceActivityExportRow[] = [];
  search = '';
  cancelledVoidSearch = '';
  clientSearch = '';
  staffFilter = 'all';
  branchFilter = 'all';
  actionFilter: 'all' | InvoiceActivityKind = 'all';
  paymentModeFilter = 'all';
  statusFilter: InvoicePaymentStatus = 'all';
  readonly datePresets = DATE_RANGE_PRESETS;
  datePreset: DateRangePreset = 'today';
  fromDate = todayKey();
  toDate = todayKey();
  minAmount: number | null = null;
  maxAmount: number | null = null;
  approvalOwnerPin = '';
  approvalRejectionReason = '';
  restoreReason = '';

  constructor(
    private api: ApiService,
    private appState: AppStateService
  ) {}

  ngOnInit(): void {
    this.refreshAll();
  }

  refreshAll(): void {
    this.load();
    this.loadReports();
    this.loadTodayInvoices();
  }

  setActivityView(view: InvoiceActivityView): void {
    this.activityView = view;
    if (view !== 'activity') {
      this.selectedRow.set(null);
    }
  }

  loadTodayInvoices(): void {
    this.api.list<ApiRecord[]>('invoices', dateRangeParams({ preset: this.datePreset, from: this.fromDate, to: this.toDate }, 100, 1000)).subscribe({
      next: (rows) => this.todayInvoices.set(this.buildTodayInvoiceSummary(rows || [])),
      error: () => this.todayInvoices.set({ count: 0, billed: 0 })
    });
  }

  load(): void {
    this.loading.set(true);
    this.error.set('');
    this.api.list<InvoiceActivityResponse>('invoice-activity', this.queryParams()).subscribe({
      next: (response) => {
        const rows = Array.isArray(response?.rows) ? response.rows : [];
        const normalizedRows = rows.map((row, index) => this.normalizeRow(row, index));
        this.rows.set(normalizedRows);
        this.rebuildRowViewModel();
        const selectedId = this.selectedRow()?.id;
        if (selectedId) {
          this.selectedRow.set(normalizedRows.find((row) => row.id === selectedId) || null);
        }
        this.loading.set(false);
      },
      error: (error: { error?: { error?: string }; message?: string }) => {
        this.error.set(error?.error?.error || error?.message || 'Unable to load invoice activity');
        this.loading.set(false);
      }
    });
  }

  loadReports(): void {
    this.reportLoading.set(true);
    this.reportError.set('');
    this.api.list<InvoiceActivityReportResponse>('pos/invoice-activity/reports', this.queryParams()).subscribe({
      next: (response) => {
        const report = response || {};
        this.reports.set(report);
        this.rebuildReportViewModel(report);
        this.reportLoading.set(false);
      },
      error: (error: { error?: { error?: string }; message?: string }) => {
        this.reportError.set(error?.error?.error || error?.message || 'Unable to load invoice activity reports');
        this.reportLoading.set(false);
      }
    });
  }

  applyLocalFilters(): void {
    this.filteredRowsCache = this.computeFilteredRows();
    this.rebuildExportRows();
  }

  filteredRows(): InvoiceActivityRow[] {
    return this.filteredRowsCache;
  }

  staffOptions(): string[] {
    return this.staffOptionsCache;
  }

  branchOptions(): Array<{ id: string; name: string }> {
    return this.branchOptionsCache;
  }

  private computeFilteredRows(): InvoiceActivityRow[] {
    const query = this.search.trim().toLowerCase();
    const clientQuery = this.clientSearch.trim().toLowerCase();
    const minAmount = this.numberOrNull(this.minAmount);
    const maxAmount = this.numberOrNull(this.maxAmount);
    const from = this.dateBoundary(this.fromDate, 'start');
    const to = this.dateBoundary(this.toDate, 'end');

    return this.rows().filter((row) => {
      const rowTime = new Date(row.actionTime).getTime();
      const haystack = [
        row.invoiceNumber,
        row.invoiceId,
        row.clientName,
        row.clientPhone,
        row.staffName,
        row.actionByUser,
        row.status,
        row.branchName,
        row.paymentModes.join(' '),
        row.riskLevel,
        row.riskReason,
        row.suggestedAction
      ].join(' ').toLowerCase();

      return (!query || haystack.includes(query))
        && this.matchesClientSearch(row, clientQuery)
        && (this.staffFilter === 'all' || row.staffName === this.staffFilter)
        && (this.branchFilter === 'all' || row.branchId === this.branchFilter)
        && (this.actionFilter === 'all' || row.actionType === this.actionFilter)
        && (this.paymentModeFilter === 'all' || row.paymentModes.some((mode) => mode.includes(this.paymentModeFilter)))
        && (this.statusFilter === 'all' || row.status.toLowerCase() === this.statusFilter)
        && (!from || rowTime >= from)
        && (!to || rowTime <= to)
        && (minAmount === null || row.total >= minAmount)
        && (maxAmount === null || row.total <= maxAmount);
    });
  }

  dailyReportRows(report: InvoiceActivityReportResponse | null): DailyEditDeleteReportRow[] {
    return Array.isArray(report?.dailyEditDeleteReport) ? report.dailyEditDeleteReport : [];
  }

  staffSuspiciousRows(report: InvoiceActivityReportResponse | null): StaffSuspiciousReportRow[] {
    return Array.isArray(report?.staffWiseSuspiciousChanges) ? report.staffWiseSuspiciousChanges : [];
  }

  paymentAdjustmentRows(report: InvoiceActivityReportResponse | null): PaymentAdjustmentReportRow[] {
    return Array.isArray(report?.paymentAdjustmentReport) ? report.paymentAdjustmentReport : [];
  }

  deletedReportRows(report: InvoiceActivityReportResponse | null): InvoiceActivityActionReportRow[] {
    return Array.isArray(report?.deletedInvoiceReport) ? report.deletedInvoiceReport : [];
  }

  restoredReportRows(report: InvoiceActivityReportResponse | null): InvoiceActivityActionReportRow[] {
    return Array.isArray(report?.restoredInvoiceReport) ? report.restoredInvoiceReport : [];
  }

  paymentUpdateReportRows(report: InvoiceActivityReportResponse | null): InvoiceActivityActionReportRow[] {
    return Array.isArray(report?.paymentUpdateReport) ? report.paymentUpdateReport : [];
  }

  rebuildCancelledVoidViewModel(): void {
    const query = this.cancelledVoidSearch.trim().toLowerCase();
    const rows = this.buildCancelledVoidRows()
      .filter((row) => {
        if (!query) {
          return true;
        }
        return [
          row.clientName,
          row.clientPhone,
          row.invoiceNumber,
          row.staffName,
          row.reason,
          row.actionByUser,
          row.status
        ].join(' ').toLowerCase().includes(query);
      })
      .sort((a, b) => new Date(b.actionTime).getTime() - new Date(a.actionTime).getTime());

    this.cancelledVoidRowsCache = rows;
    this.cancelledVoidRowsPreview = rows.slice(0, 25);
    this.cancelledVoidSummaryCache = {
      totalBill: rows.length,
      totalSale: rows.reduce((sum, row) => sum + row.amount, 0),
      receivedAmount: rows.reduce((sum, row) => sum + row.paid, 0),
      pendingAmount: rows.reduce((sum, row) => sum + row.due, 0)
    };
  }

  exportRowCount(): number {
    return this.reportExportRowsCache.length;
  }

  resetFilters(): void {
    this.search = '';
    this.cancelledVoidSearch = '';
    this.clientSearch = '';
    this.staffFilter = 'all';
    this.branchFilter = 'all';
    this.actionFilter = 'all';
    this.paymentModeFilter = 'all';
    this.statusFilter = 'all';
    this.datePreset = 'today';
    const range = rangeForPreset('today');
    this.fromDate = range.from;
    this.toDate = range.to;
    this.minAmount = null;
    this.maxAmount = null;
    this.selectedRow.set(null);
    this.applyLocalFilters();
    this.refreshAll();
  }

  applyDatePreset(preset: DateRangePreset): void {
    this.datePreset = preset;
    const range = rangeForPreset(preset, { from: this.fromDate, to: this.toDate });
    this.fromDate = range.from;
    this.toDate = range.to;
    this.applyLocalFilters();
    this.refreshAll();
  }

  updateCustomDate(side: 'from' | 'to', value: string): void {
    this.datePreset = 'custom';
    if (side === 'from') {
      this.fromDate = value;
      if (!this.toDate) this.toDate = value;
    } else {
      this.toDate = value;
    }
    this.applyLocalFilters();
    this.refreshAll();
  }

  selectRow(row: InvoiceActivityRow): void {
    this.selectedRow.set(row);
  }

  closeDetail(): void {
    this.selectedRow.set(null);
    this.approvalOwnerPin = '';
    this.approvalRejectionReason = '';
    this.approvalError.set('');
    this.restoreReason = '';
    this.restoreError.set('');
  }

  count(actionType: InvoiceActivityKind): number {
    return this.rows().filter((row) => row.actionType === actionType).length;
  }

  pendingApprovalCount(): number {
    return this.rows().filter((row) => this.isPendingApproval(row)).length;
  }

  highRiskCount(): number {
    return this.rows().filter((row) => row.riskLevel === 'high' || row.riskLevel === 'critical').length;
  }

  reviewNow(row: InvoiceActivityRow): void {
    this.selectRow(row);
    window.setTimeout(() => {
      document.querySelector('.activity-detail-drawer')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }

  reviewCancelledVoidBill(row: CancelledVoidBillReportRow): void {
    const activity = this.findActivityForCancelledVoidRow(row);
    if (activity) {
      this.reviewNow(activity);
      return;
    }
    this.search = row.invoiceNumber;
    this.applyLocalFilters();
    window.setTimeout(() => {
      document.querySelector('.invoice-activity-table')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }

  exportCsv(): void {
    const rows = this.reportExportRows();
    if (!rows.length) {
      return;
    }
    const headers = [
      'date',
      'time',
      'invoiceNumber',
      'clientName',
      'clientPhone',
      'staffName',
      'branchName',
      'actionType',
      'status',
      'paymentModes',
      'amount',
      'amountDifference',
      'paid',
      'due',
      'advanceAdjusted',
      'counterPaid',
      'paymentDifference',
      'actionByUser',
      'approvalStatus',
      'approvedBy',
      'rejectedBy',
      'riskLevel',
      'riskScore',
      'riskReason',
      'suggestedAction',
      'reason'
    ];
    const csv = [
      headers.join(','),
      ...rows.map((row) => headers.map((header) => this.csvCell(row[header])).join(','))
    ].join('\n');
    this.downloadFile(`invoice-activity-report-${this.todayKey()}.csv`, csv, 'text/csv;charset=utf-8');
  }

  exportPdf(): void {
    const report = this.reports();
    if (!report) {
      return;
    }
    const lines = [
      'Aura Salon OS - Invoice Activity Report',
      `Generated: ${this.formatDateTime(report.generatedAt || new Date().toISOString())}`,
      `Activities: ${report.summary?.totalActivities || 0}`,
      `Edits: ${report.summary?.edits || 0} | Deletions: ${report.summary?.deletions || 0} | Restored: ${report.summary?.restorations || 0} | Payment updates: ${report.summary?.paymentUpdates || 0}`,
      '',
      'Daily invoice edit/delete report',
      ...this.dailyReportRows(report).slice(0, 12).map((row) => `${row.date} - edits ${row.edits}, deletes ${row.deletions}, amount ${this.currency(row.totalAmount)}`),
      '',
      'Risk detection',
      `High risk activities: ${report.summary?.highRiskActivities || 0} | Critical: ${report.summary?.criticalRiskActivities || 0}`,
      ...this.reportExportRows().filter((row) => ['high', 'critical'].includes(String(row['riskLevel'] || ''))).slice(0, 12).map((row) => `${row['riskLevel']} - ${row['invoiceNumber']} - ${row['riskReason']} - ${row['suggestedAction']}`),
      '',
      'Staff-wise suspicious changes',
      ...this.staffSuspiciousRows(report).slice(0, 12).map((row) => `${row.staffName} - score ${row.suspiciousScore}, reason ${row.riskReason}`),
      '',
      'Cash/Card/UPI adjustment report',
      ...this.paymentAdjustmentRows(report).slice(0, 12).map((row) => `${this.paymentModeLabel(row.paymentMode)} - count ${row.count}, amount ${this.currency(row.totalAmount)}, diff ${this.currency(row.paymentDifference)}`)
    ];
    this.downloadFile(`invoice-activity-report-${this.todayKey()}.pdf`, this.simplePdf(lines), 'application/pdf');
  }

  exportCancelledVoidCsv(): void {
    const rows = this.cancelledVoidRowsCache;
    if (!rows.length) {
      return;
    }
    const headers: Array<keyof CancelledVoidBillReportRow> = [
      'date',
      'time',
      'clientName',
      'clientPhone',
      'invoiceNumber',
      'staffName',
      'amount',
      'paid',
      'due',
      'status',
      'reason',
      'actionByUser'
    ];
    const csv = [
      headers.join(','),
      ...rows.map((row) => headers.map((header) => this.csvCell(row[header])).join(','))
    ].join('\n');
    this.downloadFile(`cancelled-voided-bill-report-${this.todayKey()}.csv`, csv, 'text/csv;charset=utf-8');
  }

  exportCancelledVoidPdf(): void {
    const rows = this.cancelledVoidRowsCache;
    if (!rows.length) {
      return;
    }
    const lines = [
      'Aura Salon OS - Cancelled / Void-ed Bill Report',
      `Generated: ${this.formatDateTime(new Date().toISOString())}`,
      `Total Bill: ${this.cancelledVoidSummaryCache.totalBill}`,
      `Total Sale: ${this.currency(this.cancelledVoidSummaryCache.totalSale)}`,
      `Received Amount: ${this.currency(this.cancelledVoidSummaryCache.receivedAmount)}`,
      `Pending Amount: ${this.currency(this.cancelledVoidSummaryCache.pendingAmount)}`,
      '',
      'Name | Contact | Invoice | Price | Paid | Balance | Date | Reason',
      ...rows.slice(0, 40).map((row) => `${row.clientName} | ${row.clientPhone} | ${row.invoiceNumber} | ${this.currency(row.amount)} | ${this.currency(row.paid)} | ${this.currency(row.due)} | ${row.date} ${row.time} | ${row.reason}`)
    ];
    this.downloadFile(`cancelled-voided-bill-report-${this.todayKey()}.pdf`, this.simplePdf(lines), 'application/pdf');
  }

  hasApprovalWorkflow(row: InvoiceActivityRow): boolean {
    return row.approvalRequired || !!row.approvalStatus || row.status === 'pending_approval' || row.status === 'approved' || row.status === 'rejected';
  }

  isPendingApproval(row: InvoiceActivityRow): boolean {
    return row.approvalStatus === 'pending' || row.status === 'pending_approval';
  }

  canShowRestore(row: InvoiceActivityRow): boolean {
    return row.actionType === 'deleted' && !this.isPendingApproval(row) && row.status !== 'rejected';
  }

  canRestoreInvoices(): boolean {
    return ['superAdmin', 'owner', 'admin', 'manager'].includes(this.appState.userRole());
  }

  restoreActivity(row: InvoiceActivityRow): void {
    const reason = this.restoreReason.trim();
    if (!reason) {
      this.restoreError.set('Restore reason is required');
      return;
    }
    if (!this.canRestoreInvoices()) {
      this.restoreError.set('Only owner, super admin or manager can restore invoices');
      return;
    }
    this.restoreError.set('');
    this.restoreSaving.set(row.id);
    this.api.post(`pos/invoices/${row.invoiceId}/restore`, {
      reason,
      invoice: {
        id: row.invoiceId,
        invoiceId: row.invoiceId,
        invoiceNumber: row.invoiceNumber,
        clientName: row.clientName,
        clientPhone: row.clientPhone,
        staffName: row.staffName,
        branchId: row.branchId,
        branchName: row.branchName,
        status: row.status,
        total: row.total,
        paid: row.paid,
        balance: row.balance
      }
    }).subscribe({
      next: () => {
        this.restoreSaving.set(null);
        this.restoreReason = '';
        this.refreshAll();
      },
      error: (error: { error?: { error?: string }; message?: string }) => {
        this.restoreError.set(error?.error?.error || error?.message || 'Unable to restore invoice');
        this.restoreSaving.set(null);
      }
    });
  }

  approveActivity(row: InvoiceActivityRow): void {
    const ownerPin = this.approvalOwnerPin.trim();
    if (!ownerPin) {
      this.approvalError.set('Owner PIN/password is required before approval');
      return;
    }
    this.approvalError.set('');
    this.approvalSaving.set(row.id);
    this.api.post(`pos/invoices/${row.invoiceId}/approve`, {
      activityId: row.id,
      ownerPin,
      reason: row.approvalReason || row.deleteReason || 'Approved from Invoice Audit Center'
    }).subscribe({
      next: () => this.afterApprovalDecision(),
      error: (error: { error?: { error?: string }; message?: string }) => {
        this.approvalError.set(error?.error?.error || error?.message || 'Unable to approve invoice action');
        this.approvalSaving.set(null);
      }
    });
  }

  rejectActivity(row: InvoiceActivityRow): void {
    const reason = this.approvalRejectionReason.trim();
    if (!reason) {
      this.approvalError.set('Rejection reason is required');
      return;
    }
    this.approvalError.set('');
    this.approvalSaving.set(row.id);
    this.api.post(`pos/invoices/${row.invoiceId}/reject`, {
      activityId: row.id,
      rejectionReason: reason
    }).subscribe({
      next: () => this.afterApprovalDecision(),
      error: (error: { error?: { error?: string }; message?: string }) => {
        this.approvalError.set(error?.error?.error || error?.message || 'Unable to reject invoice action');
        this.approvalSaving.set(null);
      }
    });
  }

  actionLabel(actionType: InvoiceActivityKind): string {
    const labels: Record<InvoiceActivityKind, string> = {
      edited: 'Edited',
      deleted: 'Deleted',
      restored: 'Restored',
      payment_updated: 'Payment updated'
    };
    return labels[actionType];
  }

  actionBadgeClass(actionType: InvoiceActivityKind): string {
    const classes: Record<InvoiceActivityKind, string> = {
      edited: 'info',
      deleted: 'danger',
      restored: 'success',
      payment_updated: 'warning'
    };
    return classes[actionType];
  }

  statusLabel(status: string): string {
    return status
      .split(/[_\s-]+/)
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' ') || 'Recorded';
  }

  statusBadgeClass(status: string): string {
    const normalized = status.toLowerCase();
    if (normalized.includes('reject') || normalized.includes('delete') || normalized.includes('due') || normalized.includes('unpaid')) {
      return 'danger';
    }
    if (normalized.includes('approve') || normalized.includes('restore') || normalized.includes('posted') || normalized.includes('paid')) {
      return 'success';
    }
    if (normalized.includes('pending') || normalized.includes('partial')) {
      return 'warning';
    }
    return 'info';
  }

  riskLabel(level: InvoiceRiskLevel): string {
    const labels: Record<InvoiceRiskLevel, string> = {
      low: 'Low',
      medium: 'Medium',
      high: 'High',
      critical: 'Critical'
    };
    return labels[level] || 'Low';
  }

  riskBadgeClass(level: InvoiceRiskLevel): string {
    if (level === 'critical' || level === 'high') {
      return 'danger';
    }
    if (level === 'medium') {
      return 'warning';
    }
    return 'info';
  }

  formatDate(value: string): string {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return '-';
    }
    return new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
      .format(date);
  }

  formatTime(value: string): string {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return '-';
    }
    return new Intl.DateTimeFormat('en-IN', { hour: '2-digit', minute: '2-digit' })
      .format(date);
  }

  currency(value: number): string {
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 })
      .format(value || 0);
  }

  signedCurrency(value: number): string {
    const amount = this.numberValue(value);
    const prefix = amount > 0 ? '+' : '';
    return `${prefix}${this.currency(amount)}`;
  }

  signedNumber(value: number): string {
    const amount = this.numberValue(value);
    return `${amount > 0 ? '+' : ''}${amount}`;
  }

  trackByRow(_index: number, row: InvoiceActivityRow): string {
    return row.id;
  }

  paymentModesLabel(row: InvoiceActivityRow): string {
    return row.paymentModes.length ? row.paymentModes.map((mode) => this.paymentModeLabel(mode)).join(' / ') : '-';
  }

  paymentModeLabel(mode: string): string {
    const normalized = String(mode || '').trim().toLowerCase();
    const labels: Record<string, string> = {
      cash: 'Cash',
      card: 'Card',
      upi: 'UPI',
      wallet: 'Wallet',
      booking_advance: 'Booking advance',
      bank: 'Bank',
      untracked: 'Untracked'
    };
    return labels[normalized] || (normalized ? normalized.charAt(0).toUpperCase() + normalized.slice(1) : '-');
  }

  formatDateTime(value: string): string {
    return `${this.formatDate(value)} ${this.formatTime(value)}`;
  }

  private queryParams(): Record<string, string | number> {
    return {
      limit: 1000,
      q: this.search.trim(),
      client: this.clientSearch.trim(),
      staff: this.staffFilter === 'all' ? '' : this.staffFilter,
      action: this.actionFilter === 'all' ? '' : this.actionFilter,
      paymentMode: this.paymentModeFilter === 'all' ? '' : this.paymentModeFilter,
      status: this.statusFilter === 'all' ? '' : this.statusFilter,
      branchId: this.branchFilter === 'all' ? '' : this.branchFilter,
      from: this.fromDate,
      to: this.toDate,
      minAmount: this.minAmount ?? '',
      maxAmount: this.maxAmount ?? ''
    };
  }

  private matchesClientSearch(row: InvoiceActivityRow, clientQuery: string): boolean {
    if (!clientQuery) {
      return true;
    }
    return `${row.clientName} ${row.clientPhone}`.toLowerCase().includes(clientQuery);
  }

  private rebuildRowViewModel(): void {
    this.staffOptionsCache = Array.from(new Set(this.rows().map((row) => row.staffName).filter((staff) => staff && staff !== 'Unassigned')))
      .sort((a, b) => a.localeCompare(b));

    const branches = new Map<string, string>();
    this.rows().forEach((row) => {
      if (row.branchId && row.branchId !== '-') {
        branches.set(row.branchId, row.branchName || row.branchId);
      }
    });
    this.branchOptionsCache = Array.from(branches, ([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
    this.applyLocalFilters();
    this.rebuildCancelledVoidViewModel();
  }

  private rebuildReportViewModel(report: InvoiceActivityReportResponse | null): void {
    this.dailyReportRowsCache = this.dailyReportRows(report);
    this.dailyReportRowsPreview = this.dailyReportRowsCache.slice(0, 6);
    this.staffSuspiciousRowsCache = this.staffSuspiciousRows(report);
    this.staffSuspiciousRowsPreview = this.staffSuspiciousRowsCache.slice(0, 6);
    this.paymentAdjustmentRowsCache = this.paymentAdjustmentRows(report);
    this.paymentAdjustmentRowsPreview = this.paymentAdjustmentRowsCache.slice(0, 6);
    this.deletedReportRowsCache = this.deletedReportRows(report);
    this.deletedReportRowsPreview = this.deletedReportRowsCache.slice(0, 6);
    this.rebuildCancelledVoidViewModel();
    this.restoredReportRowsCache = this.restoredReportRows(report);
    this.restoredReportRowsPreview = this.restoredReportRowsCache.slice(0, 6);
    this.paymentUpdateReportRowsCache = this.paymentUpdateReportRows(report);
    this.paymentUpdateReportRowsPreview = this.paymentUpdateReportRowsCache.slice(0, 6);
    this.rebuildExportRows();
  }

  private rebuildExportRows(): void {
    this.reportExportRowsCache = this.buildReportExportRows();
  }

  private reportExportRows(): InvoiceActivityExportRow[] {
    return this.reportExportRowsCache;
  }

  private buildReportExportRows(): InvoiceActivityExportRow[] {
    const reportRows = this.reports()?.exportRows;
    if (Array.isArray(reportRows) && reportRows.length) {
      return reportRows;
    }
    return this.filteredRowsCache.map((row) => ({
      date: row.actionTime.slice(0, 10),
      time: row.actionTime,
      invoiceNumber: row.invoiceNumber,
      clientName: row.clientName,
      clientPhone: row.clientPhone,
      staffName: row.staffName,
      branchName: row.branchName,
      actionType: row.actionType,
      status: row.status,
      paymentModes: row.paymentModes.join(' | '),
      amount: row.total,
      amountDifference: row.financeImpact.amountDifference,
      paid: row.paid,
      due: row.balance,
      advanceAdjusted: row.advanceAdjusted,
      counterPaid: row.counterPaid,
      paymentDifference: 0,
      actionByUser: row.actionByUser,
      approvalStatus: row.approvalStatus,
      approvedBy: row.approvedBy,
      rejectedBy: row.rejectedBy,
      riskLevel: row.riskLevel,
      riskScore: row.riskScore,
      riskReason: row.riskReason,
      suggestedAction: row.suggestedAction,
      reason: row.deleteReason || row.approvalReason || row.rejectionReason
    }));
  }

  private buildCancelledVoidRows(): CancelledVoidBillReportRow[] {
    const byKey = new Map<string, CancelledVoidBillReportRow>();

    this.deletedReportRowsCache.forEach((row) => {
      const cancelledRow = this.cancelledVoidRowFromReport(row);
      byKey.set(this.cancelledVoidRowKey(cancelledRow), cancelledRow);
    });

    this.rows()
      .filter((row) => this.isCancelledVoidActivity(row))
      .forEach((row) => {
        const cancelledRow = this.cancelledVoidRowFromActivity(row);
        byKey.set(this.cancelledVoidRowKey(cancelledRow), cancelledRow);
      });

    return Array.from(byKey.values());
  }

  private cancelledVoidRowFromReport(row: InvoiceActivityActionReportRow): CancelledVoidBillReportRow {
    const activity = this.findActivityForActionReportRow(row);
    const sourceDate = activity?.invoiceCreatedAt || activity?.actionTime || row.date;
    return {
      date: this.formatDate(sourceDate),
      time: activity ? this.formatTime(activity.invoiceCreatedAt || activity.actionTime) : '-',
      invoiceNumber: row.invoiceNumber || activity?.invoiceNumber || 'Unknown invoice',
      invoiceId: activity?.invoiceId || row.invoiceNumber || '',
      clientName: row.clientName || activity?.clientName || 'Unknown client',
      clientPhone: row.clientPhone || activity?.clientPhone || '-',
      staffName: row.staffName || activity?.staffName || 'Unassigned',
      amount: this.numberValue(row.amount || activity?.total),
      paid: this.numberValue(row.paid || activity?.paid),
      due: this.numberValue(row.due || activity?.balance),
      status: row.status || activity?.status || 'deleted',
      reason: this.cancelledVoidReason(row, activity),
      actionByUser: row.actionByUser || activity?.actionByUser || 'System',
      actionTime: activity?.actionTime || this.dateValue(row.date)
    };
  }

  private cancelledVoidRowFromActivity(row: InvoiceActivityRow): CancelledVoidBillReportRow {
    const sourceDate = row.invoiceCreatedAt || row.actionTime;
    return {
      date: this.formatDate(sourceDate),
      time: this.formatTime(sourceDate),
      invoiceNumber: row.invoiceNumber,
      invoiceId: row.invoiceId,
      clientName: row.clientName,
      clientPhone: row.clientPhone,
      staffName: row.staffName,
      amount: row.total,
      paid: row.paid,
      due: row.balance,
      status: row.status || row.actionType,
      reason: row.deleteReason || row.approvalReason || row.rejectionReason || row.riskReason || 'Cancelled / voided invoice activity',
      actionByUser: row.actionByUser,
      actionTime: row.actionTime
    };
  }

  private cancelledVoidReason(row: InvoiceActivityActionReportRow, activity: InvoiceActivityRow | null): string {
    return activity?.deleteReason
      || activity?.approvalReason
      || activity?.rejectionReason
      || row.riskReason
      || 'Soft-deleted / cancelled invoice';
  }

  private cancelledVoidRowKey(row: CancelledVoidBillReportRow): string {
    return `${row.invoiceId || row.invoiceNumber}_${row.actionTime}`;
  }

  private isCancelledVoidActivity(row: InvoiceActivityRow): boolean {
    const status = `${row.actionType} ${row.status} ${row.deleteReason} ${row.approvalReason}`.toLowerCase();
    return row.actionType === 'deleted'
      || status.includes('delete')
      || status.includes('void')
      || status.includes('cancel');
  }

  private findActivityForCancelledVoidRow(row: CancelledVoidBillReportRow): InvoiceActivityRow | null {
    return this.rows().find((activity) => {
      if (row.invoiceId && activity.invoiceId === row.invoiceId) {
        return true;
      }
      return activity.invoiceNumber === row.invoiceNumber && this.isCancelledVoidActivity(activity);
    }) || null;
  }

  private findActivityForActionReportRow(row: InvoiceActivityActionReportRow): InvoiceActivityRow | null {
    return this.rows().find((activity) => (
      activity.invoiceNumber === row.invoiceNumber
      || (activity.invoiceId && activity.invoiceId === row.invoiceNumber)
    ) && this.isCancelledVoidActivity(activity)) || null;
  }

  private csvCell(value: unknown): string {
    return `"${String(value ?? '').replace(/"/g, '""')}"`;
  }

  private downloadFile(filename: string, content: BlobPart, type: string): void {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  private todayKey(): string {
    return this.localDateKey(new Date());
  }

  private buildTodayInvoiceSummary(rows: ApiRecord[]): TodayInvoiceSummary {
    const today = this.todayKey();
    const todayRows = rows.filter((row) => {
      const status = String(row['status'] || row['documentStatus'] || row['document_status'] || '').toLowerCase();
      if (['deleted', 'voided', 'cancelled'].includes(status)) return false;
      const date = this.invoiceCreatedDate(row);
      return date ? this.localDateKey(date) === today : false;
    });
    return {
      count: todayRows.length,
      billed: this.numberValue(todayRows.reduce((sum, row) => sum + this.numberValue(row['total'] ?? row['grandTotal'] ?? row['grand_total']), 0))
    };
  }

  private invoiceCreatedDate(row: ApiRecord): Date | null {
    const value = row['invoiceDate'] || row['invoice_date'] || row['createdAt'] || row['created_at'] || row['date'];
    const date = new Date(String(value || ''));
    return Number.isNaN(date.getTime()) ? null : date;
  }

  private localDateKey(value: Date): string {
    const year = value.getFullYear();
    const month = String(value.getMonth() + 1).padStart(2, '0');
    const day = String(value.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  private simplePdf(lines: string[]): string {
    const stream = [
      'BT',
      '/F1 10 Tf',
      '50 780 Td',
      '14 TL',
      ...lines.slice(0, 75).flatMap((line) => [`(${this.pdfText(line).slice(0, 110)}) Tj`, 'T*']),
      'ET'
    ].join('\n');
    const objects = [
      '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
      '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
      '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>\nendobj\n',
      '4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n',
      `5 0 obj\n<< /Length ${stream.length} >>\nstream\n${stream}\nendstream\nendobj\n`
    ];
    let pdf = '%PDF-1.4\n';
    const offsets: number[] = [];
    objects.forEach((object) => {
      offsets.push(pdf.length);
      pdf += object;
    });
    const xrefOffset = pdf.length;
    pdf += `xref\n0 ${objects.length + 1}\n`;
    pdf += '0000000000 65535 f \n';
    pdf += offsets.map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
    pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
    return pdf;
  }

  private pdfText(value: unknown): string {
    return String(value ?? '')
      .replace(/[^\x09\x0A\x0D\x20-\x7E]/g, ' ')
      .replace(/[\\()]/g, '\\$&')
      .replace(/[\r\n]+/g, ' ');
  }

  private afterApprovalDecision(): void {
    this.approvalSaving.set(null);
    this.approvalOwnerPin = '';
    this.approvalRejectionReason = '';
    this.refreshAll();
  }

  private normalizeRow(row: InvoiceActivityApiRow, index: number): InvoiceActivityRow {
    const actionTime = this.dateValue(row.actionTime);
    const actionType = this.coerceAction(row.actionType);
    const invoiceId = this.text(row.invoiceId);
    return {
      id: this.text(row.id) || `${actionType}_${invoiceId || index}_${actionTime}`,
      actionType,
      invoiceId,
      invoiceNumber: this.text(row.invoiceNumber) || invoiceId || 'Unknown invoice',
      clientName: this.text(row.clientName) || 'Unknown client',
      clientPhone: this.text(row.clientPhone) || '-',
      staffName: this.text(row.staffName) || 'Unassigned',
      branchId: this.text(row.branchId) || '-',
      branchName: this.text(row.branchName) || this.text(row.branchId) || '-',
      actionByUser: this.text(row.actionByUser) || 'System',
      invoiceCreatedAt: this.dateValue(row.invoiceCreatedAt || row.actionTime),
      actionTime,
      status: this.text(row.status) || actionType,
      total: this.numberValue(row.total),
      paid: this.numberValue(row.paid),
      balance: this.numberValue(row.balance),
      advanceAdjusted: this.numberValue(row.advanceAdjusted),
      counterPaid: this.numberValue(row.counterPaid),
      paymentModes: this.normalizePaymentModes(row.paymentModes),
      changes: this.normalizeChanges(row.changes),
      financeImpact: this.normalizeFinanceImpact(row.financeImpact),
      approvalRequired: this.boolValue(row.approvalRequired),
      approvalStatus: this.text(row.approvalStatus).toLowerCase(),
      requestedBy: this.text(row.requestedBy),
      requestedRole: this.text(row.requestedRole),
      requestedAt: this.dateValue(row.requestedAt || row.actionTime),
      approvedBy: this.text(row.approvedBy),
      approvedRole: this.text(row.approvedRole),
      approvalTime: this.text(row.approvalTime),
      rejectedBy: this.text(row.rejectedBy),
      rejectedRole: this.text(row.rejectedRole),
      rejectionTime: this.text(row.rejectionTime),
      rejectionReason: this.text(row.rejectionReason),
      approvalReason: this.text(row.approvalReason),
      deleteReason: this.text(row.deleteReason),
      auditRole: this.text(row.auditRole),
      auditBranchId: this.text(row.auditBranchId),
      auditTimestamp: this.text(row.auditTimestamp),
      riskLevel: this.coerceRiskLevel(row.riskLevel),
      riskScore: this.numberValue(row.riskScore),
      riskReasons: this.normalizeRiskReasons(row.riskReasons, row.riskReason),
      riskReason: this.text(row.riskReason) || 'No unusual activity detected',
      suggestedAction: this.text(row.suggestedAction) || 'Monitor during the routine audit cycle.'
    };
  }

  private normalizePaymentModes(value: InvoiceActivityApiRow['paymentModes']): string[] {
    const rawModes = Array.isArray(value)
      ? value
      : String(value || '')
        .split(/[|,+/]/)
        .map((mode) => mode.trim());
    return Array.from(new Set(rawModes
      .map((mode) => this.paymentModeBucket(mode))
      .filter(Boolean)));
  }

  private paymentModeBucket(mode: unknown): string {
    const normalized = String(mode || '').trim().toLowerCase();
    if (!normalized) return '';
    if (normalized.includes('cash')) return 'cash';
    if (normalized.includes('upi') || normalized.includes('gpay') || normalized.includes('phonepe') || normalized.includes('paytm')) return 'upi';
    if (normalized.includes('card') || normalized.includes('credit') || normalized.includes('debit')) return 'card';
    if (normalized.includes('wallet')) return 'wallet';
    if (normalized.includes('bank') || normalized.includes('neft') || normalized.includes('rtgs') || normalized.includes('imps')) return 'bank';
    return normalized;
  }

  private normalizeChanges(value: InvoiceActivityApiRow['changes']): InvoiceActivityChange[] {
    const raw = typeof value === 'string' ? this.safeParseArray(value) : value;
    if (!Array.isArray(raw)) {
      return [];
    }
    return raw
      .map((change) => ({
        category: this.text((change as InvoiceActivityChange)?.category) || 'Invoice',
        field: this.text((change as InvoiceActivityChange)?.field) || 'Field',
        oldValue: this.text((change as InvoiceActivityChange)?.oldValue) || '-',
        newValue: this.text((change as InvoiceActivityChange)?.newValue) || '-'
      }))
      .filter((change) => change.oldValue !== change.newValue);
  }

  private normalizeFinanceImpact(value: InvoiceActivityApiRow['financeImpact']): InvoiceFinanceImpact {
    const raw = typeof value === 'string' ? this.safeParseObject(value) : (value || {});
    const impact = raw as Partial<InvoiceFinanceImpact>;
    return {
      originalTotal: this.numberValue(impact.originalTotal),
      updatedTotal: this.numberValue(impact.updatedTotal),
      amountDifference: this.numberValue(impact.amountDifference ?? (this.numberValue(impact.updatedTotal) - this.numberValue(impact.originalTotal))),
      paymentDifference: this.numberValue(impact.paymentDifference),
      gstDifference: this.numberValue(impact.gstDifference),
      dueDifference: this.numberValue(impact.dueDifference),
      walletImpact: this.numberValue(impact.walletImpact),
      loyaltyImpact: this.numberValue(impact.loyaltyImpact),
      stockImpact: this.text(impact.stockImpact) || 'No product stock impact',
      statusBefore: this.text(impact.statusBefore) || 'recorded',
      statusAfter: this.text(impact.statusAfter) || 'recorded'
    };
  }

  private normalizeRiskReasons(value: InvoiceActivityApiRow['riskReasons'], fallback: unknown): string[] {
    const raw = Array.isArray(value)
      ? value
      : typeof value === 'string' && value.trim().startsWith('[')
        ? this.safeParseArray(value)
        : String(value || fallback || '')
          .split(';')
          .map((reason) => reason.trim());
    const reasons = raw.map((reason) => this.text(reason)).filter(Boolean);
    return reasons.length ? Array.from(new Set(reasons)) : ['No unusual activity detected'];
  }

  private safeParseArray(value: string): unknown[] {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  private safeParseObject(value: string): Record<string, unknown> {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
    } catch {
      return {};
    }
  }

  private coerceAction(value: unknown): InvoiceActivityKind {
    const normalized = String(value || '').toLowerCase();
    if (normalized === 'deleted' || normalized.includes('delete')) {
      return 'deleted';
    }
    if (normalized === 'restored' || normalized.includes('restore')) {
      return 'restored';
    }
    if (normalized === 'payment_updated' || normalized.includes('payment')) {
      return 'payment_updated';
    }
    return 'edited';
  }

  private coerceRiskLevel(value: unknown): InvoiceRiskLevel {
    const normalized = String(value || '').toLowerCase();
    if (normalized === 'critical') return 'critical';
    if (normalized === 'high') return 'high';
    if (normalized === 'medium') return 'medium';
    return 'low';
  }

  private text(value: unknown): string {
    return String(value ?? '').trim();
  }

  private numberValue(value: unknown): number {
    const num = Number(value || 0);
    return Number.isFinite(num) ? num : 0;
  }

  private boolValue(value: unknown): boolean {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') return value === 1;
    return ['1', 'true', 'yes', 'on'].includes(String(value || '').trim().toLowerCase());
  }

  private numberOrNull(value: number | string | null): number | null {
    if (value === null || value === undefined || value === '') {
      return null;
    }
    const num = Number(value);
    return Number.isFinite(num) ? num : null;
  }

  private dateBoundary(value: string, edge: 'start' | 'end'): number | null {
    if (!value) {
      return null;
    }
    const date = new Date(`${value}T${edge === 'start' ? '00:00:00.000' : '23:59:59.999'}`);
    return Number.isNaN(date.getTime()) ? null : date.getTime();
  }

  private dateValue(value: unknown): string {
    const date = value ? new Date(String(value)) : new Date();
    return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
  }
}
