import { CommonModule } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiRecord, ApiService } from '../core/api.service';
import { AppStateService } from '../core/state/app-state.service';
import { InventoryZenotiChromeComponent } from '../shared/ui/inventory-zenoti-chrome/inventory-zenoti-chrome.component';
import { AuraDatePipe } from '../shared/pipes/aura-date.pipe';

interface ConsumeLine {
  productId: string;
  productName: string;
  unit: string;
  expectedQty: number;
  actualQty: number;
  wastagePct: number;
  wastageApprovalPct?: number;
  wastageHitLimit?: number;
  minQty?: number;
  maxQty?: number;
  substitutes?: string;
  reason?: string;
  stockUnit?: string;
  packSize?: number;
  packUnit?: string;
  stockUnitCost?: number;
  unitCost: number;
  expectedCost: number;
  actualCost: number;
  backbarPosted?: boolean;
  backbarAllocations?: ApiRecord[];
  backbarStockDeductions?: ApiRecord[];
}

interface ConsumeDraft extends ApiRecord {
  id: string;
  invoiceNumber: string;
  serviceName: string;
  clientName: string;
  staffName: string;
  status: string;
  expectedCost: number;
  actualCost: number;
  lineItems: ConsumeLine[];
  notes?: string;
}

interface ProductRow extends ApiRecord {
  id: string;
  name: string;
  unit?: string;
  unitCost?: number;
  packSize?: number;
  packUnit?: string;
  stock?: number;
}

const RECIPE_UNITS = ['ml', 'gm', 'g', 'kg', 'l', 'ltr', 'pcs', 'tube', 'bottle', 'jar', 'can', 'tin', 'pack', 'box', 'nos'];
const PRODUCT_CONSUME_WASTAGE_WARN_PCT = 10;
const PRODUCT_CONSUME_WASTAGE_OWNER_APPROVAL_PCT = 25;

@Component({
  selector: 'app-product-consume',
  standalone: true,
  imports: [AuraDatePipe, CommonModule, FormsModule, InventoryZenotiChromeComponent],
  template: `
    <section class="page-stack inner-page-shell">
      <app-inventory-zenoti-chrome
        title="Product Consume"
        breadcrumb="Inventory > Service Usage"
        (refresh)="load()"
      ></app-inventory-zenoti-chrome>

      <section class="zenoti-consume-register">
        <div class="zenoti-toolbar inner-page-header">
          <div>
            <h2>Invoice service usage</h2>
          </div>
          <div class="toolbar-actions">
            <label>
              <span>Status</span>
              <select [ngModel]="statusFilter()" (ngModelChange)="setStatus($event)">
                <option value="">All</option>
                <option value="draft">Draft</option>
                <option value="recipe_missing">Recipe missing</option>
                <option value="confirmed">Confirmed</option>
              </select>
            </label>
            <button type="button" class="ghost" (click)="load()">Refresh</button>
            <button type="button" class="primary" (click)="loadControlLedgerReport()">Run report</button>
          </div>
        </div>

        <div class="consume-kpi-strip inner-stats-grid">
          <article><span>Draft pending</span><strong>{{ draftCount() }}</strong></article>
          <article><span>Confirmed</span><strong>{{ confirmedCount() }}</strong></article>
          <article><span>Expected cost</span><strong>{{ money(totalExpected()) }}</strong></article>
          <article><span>Actual cost</span><strong>{{ money(totalActual()) }}</strong></article>
        </div>

        <div class="zenoti-table-scroll inner-table-wrap">
          <table class="zenoti-register-table">
            <thead>
              <tr>
                <th>Invoice</th>
                <th>Service / client</th>
                <th>Staff</th>
                <th>Status</th>
                <th>Lines</th>
                <th>Expected</th>
                <th>Actual</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              <tr
                *ngFor="let draft of drafts()"
                [class.selected]="draft.id === selectedId()"
                (click)="select(draft)"
              >
                <td>
                  <strong>{{ draft.invoiceNumber || draft.id }}</strong>
                  <small>{{ draft.id }}</small>
                </td>
                <td>
                  <strong>{{ draft.serviceName }}</strong>
                  <small>{{ draft.clientName || 'Walk-in client' }}</small>
                </td>
                <td>{{ draft.staffName || 'Unassigned' }}</td>
                <td><span class="badge" [class.done]="draft.status === 'confirmed'">{{ draft.status }}</span></td>
                <td>{{ draft.lineItems.length }}</td>
                <td>{{ money(draft.expectedCost || 0) }}</td>
                <td>{{ money(draft.actualCost || draft.expectedCost || 0) }}</td>
                <td><button type="button" class="mini-action" (click)="select(draft)">Open</button></td>
              </tr>
              <tr *ngIf="!loading() && !drafts().length">
                <td colspan="8" class="table-empty">No product consume draft found.</td>
              </tr>
              <tr *ngIf="loading()">
                <td colspan="8" class="table-empty">Loading...</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div class="zenoti-footer">
          <span>{{ drafts().length }} result(s)</span>
          <span>Click any invoice to edit consume lines, container usage and notes below.</span>
        </div>
      </section>

      <section class="owner-report" *ngIf="backbarReport() as report">
        <div class="ledger-head">
          <div>
            <h3>Backbar bulk control</h3>
          </div>
        </div>
        <div class="owner-metrics">
          <article><span>Open</span><strong>{{ report['summary']?.openContainers || 0 }}</strong></article>
          <article><span>Paused</span><strong>{{ report['summary']?.pausedContainers || 0 }}</strong></article>
          <article><span>Adjustments</span><strong>{{ report['summary']?.adjustmentEntries || 0 }}</strong></article>
          <article><span>Alerts</span><strong>{{ report['summary']?.openAlerts || 0 }}</strong></article>
          <article><span>Usage cost</span><strong>{{ money(report['summary']?.usageCost || 0) }}</strong></article>
        </div>
      </section>

      <section class="owner-dashboard" *ngIf="backbarDashboard() as dashboard">
        <div class="ledger-head">
          <div>
            <h3>Daily / weekly product control</h3>
          </div>
          <div class="dashboard-actions">
            <select [ngModel]="dashboardPeriod" (ngModelChange)="setDashboardPeriod($event)">
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
            </select>
            <button type="button" class="ghost" (click)="loadBackbarDashboard()">Refresh</button>
          </div>
        </div>
        <div class="owner-metrics">
          <article><span>Usage cost</span><strong>{{ money(dashboard['summary']?.usageCost || 0) }}</strong><small>{{ dashboard['period'] || 'daily' }}</small></article>
          <article><span>Exceptions</span><strong>{{ money(dashboard['summary']?.exceptionCost || 0) }}</strong></article>
          <article><span>Alerts</span><strong>{{ dashboard['summary']?.advancedAlerts || 0 }}</strong></article>
          <article><span>Approvals</span><strong>{{ dashboard['summary']?.pendingApprovals || 0 }}</strong></article>
          <article><span>Actual profit</span><strong>{{ money(dashboard['summary']?.actualProfit || 0) }}</strong></article>
        </div>
        <div class="dashboard-layout">
          <div class="dashboard-feed">
            <h4>Advanced alerts</h4>
            <article *ngFor="let alert of dashboardAlerts().slice(0, 8)" [class.high]="alert['severity'] === 'high'">
              <strong>{{ alert['title'] || alert['alertType'] }}</strong>
              <span>{{ alert['message'] || 'Review required' }}</span>
            </article>
            <p class="ledger-empty" *ngIf="!dashboardAlerts().length">No advanced product alert right now.</p>
          </div>
          <div class="approval-queue">
            <h4>Manager approval queue</h4>
            <article *ngFor="let request of approvalRequests().slice(0, 6)">
              <strong>{{ request['productName'] }}</strong>
              <span>{{ request['activeBalanceQty'] }} {{ request['measureUnit'] }} left in #{{ request['activeContainerNo'] }} · {{ request['reason'] }}</span>
              <div>
                <button type="button" class="ghost" (click)="decideOverrideRequest(request, 'reject')">Reject</button>
                <button type="button" class="primary" (click)="decideOverrideRequest(request, 'approve')">Approve</button>
              </div>
            </article>
            <p class="ledger-empty" *ngIf="!approvalRequests().length">No pending override approval.</p>
          </div>
        </div>
        <div class="profit-table" *ngIf="dashboardServiceProfit().length">
          <div class="profit-row head"><span>Service</span><span>Invoices</span><span>Revenue</span><span>Product cost</span><span>Actual profit</span><span>Margin</span></div>
          <div class="profit-row" *ngFor="let row of dashboardServiceProfit().slice(0, 8)">
            <strong>{{ row['serviceName'] }}</strong>
            <span>{{ row['invoiceCount'] || 0 }}</span>
            <span>{{ money(row['serviceRevenue'] || 0) }}</span>
            <span>{{ money(row['productCost'] || 0) }}</span>
            <span>{{ money(row['actualProfit'] || 0) }}</span>
            <span>{{ row['profitMarginPct'] || 0 }}%</span>
          </div>
        </div>
      </section>

      <section class="control-report" *ngIf="controlLedgerReport() as report">
        <div class="ledger-head">
          <div>
            <h3>Every ml / gram report center</h3>
          </div>
        </div>
        <div class="report-filters">
          <label><span>Branch</span><input [(ngModel)]="ledgerFilters.branchId" placeholder="Branch ID"></label>
          <label>
            <span>Product</span>
            <select [(ngModel)]="ledgerFilters.productId" (ngModelChange)="product360Id = $event">
              <option value="">All products</option>
              <option *ngFor="let product of productOptions()" [value]="product.id">{{ product.name }}</option>
            </select>
          </label>
          <label><span>Staff</span><input [(ngModel)]="ledgerFilters.staffId" placeholder="Staff ID"></label>
          <label>
            <span>Type</span>
            <select [(ngModel)]="ledgerFilters.usageType">
              <option value="">All usage</option>
              <option value="client">Client use</option>
              <option value="spillage">Spillage</option>
              <option value="expired">Expired</option>
              <option value="damaged">Damaged</option>
              <option value="manual_adjustment">Manual adjustment</option>
            </select>
          </label>
          <label><span>Start</span><input type="date" [(ngModel)]="ledgerFilters.startDate"></label>
          <label><span>End</span><input type="date" [(ngModel)]="ledgerFilters.endDate"></label>
          <button type="button" class="ghost" (click)="loadControlLedgerReport()">Run report</button>
          <button type="button" class="ghost" (click)="loadProduct360()">Product 360</button>
        </div>
        <div class="product-360" *ngIf="product360() as view">
          <div class="ledger-head">
            <div>
              <h3>{{ view['productName'] || view['product']?.name }}</h3>
            </div>
          </div>
          <div class="owner-metrics">
            <article><span>Sealed</span><strong>{{ view['summary']?.sealedStock || 0 }}</strong><small>{{ view['stockUnit'] || 'pcs' }}</small></article>
            <article><span>Open</span><strong>{{ view['summary']?.openContainers || 0 }}</strong></article>
            <article><span>Finished</span><strong>{{ view['summary']?.finishedContainers || 0 }}</strong></article>
            <article><span>Usage cost</span><strong>{{ money(view['summary']?.usageCost || 0) }}</strong><small>{{ view['summary']?.totalUsedText || '0' }}</small></article>
            <article><span>Profit</span><strong>{{ money(view['profitSummary']?.actualProfit || 0) }}</strong><small>{{ view['profitSummary']?.profitMarginPct || 0 }}%</small></article>
          </div>
          <div class="product-360-grid">
            <article>
              <h4>Containers</h4>
              <div class="risk-row" *ngFor="let row of product360Containers().slice(0, 5)" [class.high]="row['status'] === 'paused_override'">
                <strong>{{ row['containerCode'] }} · {{ row['status'] }}</strong>
                <span>{{ row['usedQty'] || 0 }} / {{ row['capacityQty'] || 0 }} {{ row['measureUnit'] }}</span>
                <small>QR {{ row['qrCode'] || row['barcode'] }} · balance {{ row['balanceQty'] || 0 }}</small>
              </div>
              <small *ngIf="!product360Containers().length">No container rows.</small>
            </article>
            <article>
              <h4>Clients</h4>
              <div class="risk-row" *ngFor="let row of product360Clients().slice(0, 5)">
                <strong>{{ row['clientName'] || 'Walk-in client' }}</strong>
                <span>{{ row['serviceName'] || 'Service' }} · {{ row['totalUsedText'] || '0' }}</span>
                <small>{{ money(row['cost'] || 0) }} · {{ row['entries'] || 0 }} entries</small>
              </div>
              <small *ngIf="!product360Clients().length">No client usage.</small>
            </article>
            <article>
              <h4>Staff</h4>
              <div class="risk-row" *ngFor="let row of product360Staff().slice(0, 5)">
                <strong>{{ row['staffName'] || 'Unassigned' }}</strong>
                <span>{{ row['totalUsedText'] || '0' }}</span>
                <small>{{ money(row['cost'] || 0) }} · exceptions {{ row['exceptionCount'] || 0 }}</small>
              </div>
              <small *ngIf="!product360Staff().length">No staff usage.</small>
            </article>
            <article>
              <h4>Waste</h4>
              <div class="risk-row" *ngFor="let row of product360Waste().slice(0, 5)" [class.high]="(row['cost'] || 0) > 0">
                <strong>{{ row['usageType'] || 'adjustment' }}</strong>
                <span>{{ row['totalUsedText'] || '0' }}</span>
                <small>{{ money(row['cost'] || 0) }} · {{ row['reason'] || 'No reason' }}</small>
              </div>
              <small *ngIf="!product360Waste().length">No waste rows.</small>
            </article>
            <article>
              <h4>Action queue</h4>
              <div class="risk-row" *ngFor="let row of product360Actions().slice(0, 5)" [class.high]="row['riskLevel'] === 'high'">
                <strong>{{ row['title'] || row['actionType'] }}</strong>
                <span>{{ row['riskLevel'] || 'watch' }}</span>
                <small>{{ row['detail'] || 'Review required' }}</small>
              </div>
              <small *ngIf="!product360Actions().length">No product action pending.</small>
            </article>
            <article>
              <h4>Full ledger</h4>
              <div class="risk-row" *ngFor="let row of product360Ledger().slice(0, 5)">
                <strong>{{ row['title'] || row['entityType'] }}</strong>
                <span>{{ row['detail'] || row['entityId'] }}</span>
                <small>{{ row['eventAt'] | auraDate:'date' }}</small>
              </div>
              <small *ngIf="!product360Ledger().length">No ledger events.</small>
            </article>
          </div>
        </div>
        <div class="owner-metrics">
          <article><span>Products</span><strong>{{ report['summary']?.products || 0 }}</strong></article>
          <article><span>Staff</span><strong>{{ report['summary']?.staff || 0 }}</strong></article>
          <article><span>Clients</span><strong>{{ report['summary']?.clients || 0 }}</strong></article>
          <article><span>Usage cost</span><strong>{{ money(report['summary']?.usageCost || 0) }}</strong></article>
          <article><span>Waste cost</span><strong>{{ money(report['summary']?.exceptionCost || 0) }}</strong></article>
        </div>
        <div class="owner-metrics">
          <article><span>Variance</span><strong>{{ report['summary']?.varianceRows || 0 }}</strong></article>
          <article><span>Open-age risk</span><strong>{{ report['summary']?.containerRisks || 0 }}</strong></article>
          <article><span>Leakage risk</span><strong>{{ report['summary']?.leakageRisks || 0 }}</strong></article>
          <article><span>Approvals</span><strong>{{ report['summary']?.pendingApprovals || 0 }}</strong></article>
          <article><span>Alerts</span><strong>{{ report['summary']?.alerts || 0 }}</strong></article>
        </div>
        <div class="owner-metrics">
          <article><span>Pending consume</span><strong>{{ report['summary']?.pendingConsumes || 0 }}</strong></article>
          <article><span>Reason gaps</span><strong>{{ report['summary']?.reasonComplianceIssues || 0 }}</strong></article>
          <article><span>Categories</span><strong>{{ report['summary']?.usageCategories || 0 }}</strong></article>
          <article><span>Efficiency rows</span><strong>{{ report['summary']?.containerEfficiencyRows || 0 }}</strong></article>
          <article><span>Control score</span><strong>{{ report['summary']?.productControlScores || 0 }}</strong></article>
        </div>
        <div class="owner-metrics">
          <article><span>Daily trend</span><strong>{{ report['summary']?.dailyTrendRows || 0 }}</strong></article>
          <article><span>Weekly trend</span><strong>{{ report['summary']?.weeklyTrendRows || 0 }}</strong></article>
          <article><span>SLA breach</span><strong>{{ report['summary']?.approvalSlaBreaches || 0 }}</strong></article>
          <article><span>Stock recon</span><strong>{{ report['summary']?.stockReconciliationRows || 0 }}</strong></article>
          <article><span>Recipe compliance</span><strong>{{ report['summary']?.serviceRecipeComplianceRows || 0 }}</strong></article>
        </div>
        <div class="owner-metrics">
          <article><span>Forecast burn</span><strong>{{ report['summary']?.forecastBurnRows || 0 }}</strong></article>
          <article><span>Anomalies</span><strong>{{ report['summary']?.usageAnomalies || 0 }}</strong></article>
          <article><span>Expiry priority</span><strong>{{ report['summary']?.expiryPriorityRows || 0 }}</strong></article>
          <article><span>Cost drift</span><strong>{{ report['summary']?.costDriftRows || 0 }}</strong></article>
          <article><span>Staff waste hits</span><strong>{{ report['summary']?.staffWastageRepeats || 0 }}</strong></article>
          <article><span>Manager actions</span><strong>{{ report['summary']?.managerActions || 0 }}</strong></article>
        </div>
        <div class="report-grid">
          <div class="report-table">
            <h4>Product-wise usage</h4>
            <div class="report-row head"><span>Product</span><span>Used</span><span>Cost</span><span>Exceptions</span><span>Last</span></div>
            <div class="report-row" *ngFor="let row of ledgerProductRows().slice(0, 8)">
              <strong>{{ row['productName'] || row['productId'] }}</strong>
              <span>{{ row['totalUsedText'] || '0' }}</span>
              <span>{{ money(row['cost'] || 0) }}</span>
              <span>{{ row['exceptionCount'] || 0 }}</span>
              <span>{{ row['lastUsedAt'] | auraDate:'date' }}</span>
            </div>
          </div>
          <div class="report-side">
            <article>
              <strong>Service report</strong>
              <span *ngFor="let row of ledgerServiceRows().slice(0, 4)">{{ row['serviceName'] || 'Service' }} · {{ row['totalUsedText'] || '0' }} · {{ money(row['cost'] || 0) }}</span>
              <small *ngIf="!ledgerServiceRows().length">No service rows</small>
            </article>
            <article>
              <strong>Staff report</strong>
              <span *ngFor="let row of ledgerStaffRows().slice(0, 4)">{{ row['staffName'] || 'Unassigned' }} · {{ row['totalUsedText'] || '0' }} · {{ money(row['cost'] || 0) }}</span>
              <small *ngIf="!ledgerStaffRows().length">No staff rows</small>
            </article>
            <article>
              <strong>Wastage report</strong>
              <span *ngFor="let row of ledgerWasteRows().slice(0, 4)">{{ row['usageType'] || 'adjustment' }} · {{ row['totalUsedText'] || '0' }} · {{ money(row['cost'] || 0) }}</span>
              <small *ngIf="!ledgerWasteRows().length">No waste rows</small>
            </article>
          </div>
        </div>
        <div class="risk-grid">
          <article>
            <h4>Recipe variance</h4>
            <div class="risk-row" *ngFor="let row of ledgerVarianceRows().slice(0, 5)">
              <strong>{{ row['productName'] }}</strong>
              <span>{{ row['staffName'] || 'Unassigned' }} · {{ row['serviceName'] || 'Service' }}</span>
              <small>Expected {{ row['expectedQty'] || 0 }}, actual {{ row['actualQty'] || 0 }}, variance {{ row['varianceQty'] || 0 }}</small>
            </div>
            <small *ngIf="!ledgerVarianceRows().length">No recipe variance risk.</small>
          </article>
          <article>
            <h4>Container aging / expiry</h4>
            <div class="risk-row" *ngFor="let row of ledgerContainerRisks().slice(0, 5)" [class.high]="row['riskLevel'] === 'high'">
              <strong>{{ row['productName'] }} #{{ row['containerNo'] }}</strong>
              <span>{{ row['openDays'] || 0 }} days open · {{ row['balanceQty'] || 0 }} {{ row['measureUnit'] }} left</span>
              <small>{{ row['riskLevel'] }} risk · expiry {{ row['expiry'] || 'not set' }}</small>
            </div>
            <small *ngIf="!ledgerContainerRisks().length">No container aging risk.</small>
          </article>
          <article>
            <h4>Stock mismatch / leakage</h4>
            <div class="risk-row" *ngFor="let row of ledgerLeakageRows().slice(0, 5)" [class.high]="row['riskLevel'] === 'high'">
              <strong>{{ row['productName'] }}</strong>
              <span>{{ row['totalUsedText'] || '0' }} · exception {{ row['exceptionRatio'] || 0 }}%</span>
              <small>{{ row['riskLevel'] }} risk · score {{ row['riskScore'] || 0 }}</small>
            </div>
            <small *ngIf="!ledgerLeakageRows().length">No leakage signal.</small>
          </article>
        </div>
        <div class="next-control-grid">
          <article>
            <h4>Client-wise report</h4>
            <div class="risk-row" *ngFor="let row of ledgerClientRows().slice(0, 5)">
              <strong>{{ row['clientName'] || 'Walk-in client' }}</strong>
              <span>{{ row['invoiceNumber'] || 'invoice' }} · {{ row['totalUsedText'] || '0' }}</span>
              <small>{{ money(row['cost'] || 0) }} · last {{ row['lastUsedAt'] | auraDate:'date' }}</small>
            </div>
            <small *ngIf="!ledgerClientRows().length">No client rows.</small>
          </article>
          <article>
            <h4>Approval workflow</h4>
            <div class="risk-row" *ngFor="let row of ledgerApprovalRows().slice(0, 5)" [class.high]="row['status'] === 'pending' && (row['ageHours'] || 0) > 24">
              <strong>{{ row['productName'] }}</strong>
              <span>{{ row['status'] }} · {{ row['activeBalanceText'] || 'balance pending' }}</span>
              <small>{{ row['reason'] || 'No reason' }} · {{ row['ageHours'] || 0 }}h</small>
            </div>
            <small *ngIf="!ledgerApprovalRows().length">No approval rows.</small>
          </article>
          <article>
            <h4>Branch comparison</h4>
            <div class="risk-row" *ngFor="let row of ledgerBranchRows().slice(0, 5)">
              <strong>{{ row['branchName'] || row['branchId'] || 'All branches' }}</strong>
              <span>{{ row['totalUsedText'] || '0' }} · {{ money(row['cost'] || 0) }}</span>
              <small>{{ row['exceptionEntries'] || 0 }} exceptions · {{ row['exceptionRatio'] || 0 }}%</small>
            </div>
            <small *ngIf="!ledgerBranchRows().length">No branch rows.</small>
          </article>
          <article>
            <h4>Supplier quality</h4>
            <div class="risk-row" *ngFor="let row of ledgerSupplierRows().slice(0, 5)" [class.high]="(row['qualityScore'] || 100) < 70">
              <strong>{{ row['supplierName'] || 'Unlinked supplier' }}</strong>
              <span>{{ row['productCount'] || 0 }} products · waste {{ money(row['exceptionCost'] || 0) }}</span>
              <small>Quality score {{ row['qualityScore'] || 0 }} · exception {{ row['exceptionRatio'] || 0 }}%</small>
            </div>
            <small *ngIf="!ledgerSupplierRows().length">No supplier rows.</small>
          </article>
        </div>
        <div class="deep-control-grid">
          <article>
            <h4>Batch / expiry exposure</h4>
            <div class="risk-row" *ngFor="let row of ledgerBatchExpiryRows().slice(0, 5)" [class.high]="row['riskLevel'] === 'high'">
              <strong>{{ row['productName'] }}</strong>
              <span>{{ row['batchNumber'] }} · {{ row['quantityAvailable'] || 0 }} left</span>
              <small>Expiry {{ row['expiryDate'] || 'not set' }} · {{ row['daysToExpiry'] || 0 }} days</small>
            </div>
            <small *ngIf="!ledgerBatchExpiryRows().length">No batch expiry exposure.</small>
          </article>
          <article>
            <h4>Staff overuse leaderboard</h4>
            <div class="risk-row" *ngFor="let row of ledgerStaffOveruseRows().slice(0, 5)" [class.high]="(row['overuseCount'] || 0) >= 3">
              <strong>{{ row['staffName'] || 'Unassigned' }}</strong>
              <span>{{ row['overuseCount'] || 0 }} overuse lines · variance {{ row['varianceQty'] || 0 }}</span>
              <small>{{ row['reasonCount'] || 0 }} with reason · {{ money(row['cost'] || 0) }}</small>
            </div>
            <small *ngIf="!ledgerStaffOveruseRows().length">No staff overuse rows.</small>
          </article>
          <article>
            <h4>Service margin after product</h4>
            <div class="risk-row" *ngFor="let row of ledgerServiceMarginRows().slice(0, 5)" [class.high]="(row['marginPct'] || 0) < 35">
              <strong>{{ row['serviceName'] || 'Service' }}</strong>
              <span>Revenue {{ money(row['revenue'] || 0) }} · product {{ money(row['productCost'] || 0) }}</span>
              <small>Profit {{ money(row['grossAfterProduct'] || 0) }} · {{ row['marginPct'] || 0 }}%</small>
            </div>
            <small *ngIf="!ledgerServiceMarginRows().length">No service margin rows.</small>
          </article>
          <article>
            <h4>Slow / dead open container</h4>
            <div class="risk-row" *ngFor="let row of ledgerSlowMovingRows().slice(0, 5)" [class.high]="(row['idleDays'] || 0) >= 21">
              <strong>{{ row['productName'] }} #{{ row['containerNo'] }}</strong>
              <span>{{ row['idleDays'] || 0 }} idle days · {{ row['balancePct'] || 0 }}% balance</span>
              <small>{{ row['balanceQty'] || 0 }} {{ row['measureUnit'] }} left</small>
            </div>
            <small *ngIf="!ledgerSlowMovingRows().length">No slow container rows.</small>
          </article>
          <article>
            <h4>Reorder from consume velocity</h4>
            <div class="risk-row" *ngFor="let row of ledgerReorderRows().slice(0, 5)" [class.high]="row['riskLevel'] === 'high'">
              <strong>{{ row['productName'] }}</strong>
              <span>{{ row['dailyUsage'] || 0 }}/day · stock {{ row['stock'] || 0 }}</span>
              <small>{{ row['daysToStockout'] || 'NA' }} days left · reorder {{ row['reorderQty'] || 0 }}</small>
            </div>
            <small *ngIf="!ledgerReorderRows().length">No reorder signal.</small>
          </article>
        </div>
        <div class="owner-control-grid">
          <article>
            <h4>Pending consume drafts</h4>
            <div class="risk-row" *ngFor="let row of ledgerPendingConsumeRows().slice(0, 5)" [class.high]="(row['ageHours'] || 0) >= 24">
              <strong>{{ row['invoiceNumber'] || row['draftId'] }}</strong>
              <span>{{ row['clientName'] || 'Walk-in client' }} · {{ row['serviceName'] || 'Service' }}</span>
              <small>{{ row['lineCount'] || 0 }} lines · {{ row['ageHours'] || 0 }}h pending · {{ money(row['actualCost'] || 0) }}</small>
            </div>
            <small *ngIf="!ledgerPendingConsumeRows().length">No pending consume drafts.</small>
          </article>
          <article>
            <h4>Reason compliance</h4>
            <div class="risk-row" *ngFor="let row of ledgerReasonComplianceRows().slice(0, 5)" [class.high]="row['severity'] === 'high'">
              <strong>{{ row['productName'] || 'Product' }}</strong>
              <span>{{ row['staffName'] || 'Unassigned' }} · {{ row['entityType'] || 'usage' }}</span>
              <small>{{ row['missingReasons'] || 0 }}/{{ row['totalLines'] || 0 }} missing · {{ money(row['cost'] || 0) }}</small>
            </div>
            <small *ngIf="!ledgerReasonComplianceRows().length">No missing reason issue.</small>
          </article>
          <article>
            <h4>Usage category cost</h4>
            <div class="risk-row" *ngFor="let row of ledgerUsageCategoryRows().slice(0, 5)" [class.high]="row['riskLevel'] === 'high'">
              <strong>{{ row['categoryName'] || row['usageType'] || 'Usage' }}</strong>
              <span>{{ row['totalUsedText'] || '0' }} · {{ row['count'] || 0 }} entries</span>
              <small>{{ money(row['cost'] || 0) }} · exceptions {{ row['exceptionCount'] || 0 }}</small>
            </div>
            <small *ngIf="!ledgerUsageCategoryRows().length">No usage category rows.</small>
          </article>
          <article>
            <h4>Container efficiency</h4>
            <div class="risk-row" *ngFor="let row of ledgerContainerEfficiencyRows().slice(0, 5)" [class.high]="row['riskLevel'] === 'high'">
              <strong>{{ row['productName'] }} #{{ row['containerNo'] }}</strong>
              <span>{{ row['efficiencyPct'] || 0 }}% client use · {{ row['balanceQty'] || 0 }} {{ row['measureUnit'] }} left</span>
              <small>Client {{ money(row['clientCost'] || 0) }} · exception {{ money(row['exceptionCost'] || 0) }}</small>
            </div>
            <small *ngIf="!ledgerContainerEfficiencyRows().length">No container efficiency rows.</small>
          </article>
          <article>
            <h4>Client product profit</h4>
            <div class="risk-row" *ngFor="let row of ledgerClientProfitRows().slice(0, 5)" [class.high]="(row['marginPct'] || 0) < 35">
              <strong>{{ row['clientName'] || 'Walk-in client' }}</strong>
              <span>Revenue {{ money(row['revenue'] || 0) }} · product {{ money(row['productCost'] || 0) }}</span>
              <small>Profit {{ money(row['grossAfterProduct'] || 0) }} · {{ row['marginPct'] || 0 }}% · {{ row['invoices'] || 0 }} invoices</small>
            </div>
            <small *ngIf="!ledgerClientProfitRows().length">No client profit rows.</small>
          </article>
          <article>
            <h4>Product control score</h4>
            <div class="risk-row" *ngFor="let row of ledgerProductControlScoreRows().slice(0, 5)" [class.high]="row['riskLevel'] === 'high'">
              <strong>{{ row['productName'] || 'Product' }}</strong>
              <span>Score {{ row['score'] || 0 }} · {{ row['riskLevel'] || 'watch' }}</span>
              <small>{{ row['reasonText'] || 'clean' }}</small>
            </div>
            <small *ngIf="!ledgerProductControlScoreRows().length">No product control score rows.</small>
          </article>
        </div>
        <div class="owner-control-grid">
          <article>
            <h4>Daily usage trend</h4>
            <div class="risk-row" *ngFor="let row of ledgerDailyTrendRows().slice(0, 5)" [class.high]="(row['exceptionCost'] || 0) > 0">
              <strong>{{ row['period'] }}</strong>
              <span>{{ row['entries'] || 0 }} entries · {{ row['usedQty'] || 0 }} {{ row['unit'] || '' }}</span>
              <small>{{ money(row['usageCost'] || 0) }} · waste {{ money(row['exceptionCost'] || 0) }}</small>
            </div>
            <small *ngIf="!ledgerDailyTrendRows().length">No daily trend rows.</small>
          </article>
          <article>
            <h4>Weekly usage trend</h4>
            <div class="risk-row" *ngFor="let row of ledgerWeeklyTrendRows().slice(0, 5)" [class.high]="(row['exceptionEntries'] || 0) >= 3">
              <strong>Week {{ row['period'] }}</strong>
              <span>{{ row['clientEntries'] || 0 }} client · {{ row['exceptionEntries'] || 0 }} exception</span>
              <small>{{ money(row['usageCost'] || 0) }} · qty {{ row['usedQty'] || 0 }} {{ row['unit'] || '' }}</small>
            </div>
            <small *ngIf="!ledgerWeeklyTrendRows().length">No weekly trend rows.</small>
          </article>
          <article>
            <h4>Approval SLA aging</h4>
            <div class="risk-row" *ngFor="let row of ledgerApprovalSlaRows().slice(0, 5)" [class.high]="row['slaStatus'] === 'breached'">
              <strong>{{ row['productName'] || 'Product' }}</strong>
              <span>{{ row['status'] || 'pending' }} · {{ row['ageHours'] || 0 }}h · {{ row['staffName'] || 'Unassigned' }}</span>
              <small>{{ row['slaStatus'] || 'ok' }} · {{ row['reason'] || 'No reason' }}</small>
            </div>
            <small *ngIf="!ledgerApprovalSlaRows().length">No approval SLA rows.</small>
          </article>
          <article>
            <h4>Staff product risk</h4>
            <div class="risk-row" *ngFor="let row of ledgerStaffProductRiskRows().slice(0, 5)" [class.high]="row['riskLevel'] === 'high'">
              <strong>{{ row['staffName'] || 'Unassigned' }}</strong>
              <span>{{ row['productName'] || 'Product' }} · score {{ row['riskScore'] || 0 }}</span>
              <small>{{ row['overuseCount'] || 0 }} overuse · exception {{ row['exceptionRatio'] || 0 }}%</small>
            </div>
            <small *ngIf="!ledgerStaffProductRiskRows().length">No staff product risk rows.</small>
          </article>
          <article>
            <h4>Stock reconciliation</h4>
            <div class="risk-row" *ngFor="let row of ledgerStockReconciliationRows().slice(0, 5)" [class.high]="row['riskLevel'] === 'high'">
              <strong>{{ row['productName'] || 'Product' }}</strong>
              <span>Sealed {{ row['sealedStock'] || 0 }} · open {{ row['openBalanceQty'] || 0 }} {{ row['measureUnit'] || '' }}</span>
              <small>{{ row['issue'] || 'ok' }} · consumed {{ row['consumedText'] || '0' }}</small>
            </div>
            <small *ngIf="!ledgerStockReconciliationRows().length">No stock reconciliation rows.</small>
          </article>
          <article>
            <h4>Container lifecycle</h4>
            <div class="risk-row" *ngFor="let row of ledgerContainerLifecycleRows().slice(0, 5)" [class.high]="row['riskLevel'] === 'high'">
              <strong>{{ row['productName'] }} #{{ row['containerNo'] }}</strong>
              <span>{{ row['status'] || 'open' }} · {{ row['openDays'] || 0 }} days · {{ row['usedPct'] || 0 }}% used</span>
              <small>{{ row['clientEntryCount'] || 0 }} client · {{ row['exceptionEntryCount'] || 0 }} exception</small>
            </div>
            <small *ngIf="!ledgerContainerLifecycleRows().length">No container lifecycle rows.</small>
          </article>
          <article>
            <h4>Service recipe compliance</h4>
            <div class="risk-row" *ngFor="let row of ledgerServiceRecipeComplianceRows().slice(0, 5)" [class.high]="row['riskLevel'] === 'high'">
              <strong>{{ row['serviceName'] || 'Service' }}</strong>
              <span>{{ row['compliancePct'] || 0 }}% compliant · {{ row['recipeLines'] || 0 }} lines</span>
              <small>{{ row['overuseLines'] || 0 }} overuse · {{ row['missingRecipeLines'] || 0 }} missing recipe</small>
            </div>
            <small *ngIf="!ledgerServiceRecipeComplianceRows().length">No recipe compliance rows.</small>
          </article>
        </div>
        <div class="owner-control-grid">
          <article>
            <h4>Forecast burn</h4>
            <div class="risk-row" *ngFor="let row of ledgerForecastBurnRows().slice(0, 5)" [class.high]="row['riskLevel'] === 'high'">
              <strong>{{ row['productName'] || 'Product' }}</strong>
              <span>{{ row['dailyQty'] || 0 }} {{ row['unit'] || '' }}/day · {{ money(row['forecast30Cost'] || 0) }} / 30d</span>
              <small>{{ row['daysOpenBalance'] || 'NA' }} days open balance · sealed {{ row['sealedStock'] || 0 }}</small>
            </div>
            <small *ngIf="!ledgerForecastBurnRows().length">No forecast burn rows.</small>
          </article>
          <article>
            <h4>Usage anomaly</h4>
            <div class="risk-row" *ngFor="let row of ledgerUsageAnomalyRows().slice(0, 5)" [class.high]="row['riskLevel'] === 'high'">
              <strong>{{ row['period'] }}</strong>
              <span>{{ row['spikePct'] || 0 }}% spike · waste {{ row['exceptionRatio'] || 0 }}%</span>
              <small>{{ row['entries'] || 0 }} entries · {{ money(row['usageCost'] || 0) }}</small>
            </div>
            <small *ngIf="!ledgerUsageAnomalyRows().length">No usage anomaly rows.</small>
          </article>
          <article>
            <h4>Expiry priority</h4>
            <div class="risk-row" *ngFor="let row of ledgerExpiryPriorityRows().slice(0, 5)" [class.high]="row['riskLevel'] === 'high'">
              <strong>{{ row['productName'] || 'Product' }}</strong>
              <span>{{ row['batchNumber'] || 'batch' }} · expiry {{ row['daysToExpiry'] || 0 }} days</span>
              <small>Use in {{ row['daysToUseAtVelocity'] || 'NA' }} days · gap {{ row['expiryGapDays'] || 'NA' }}</small>
            </div>
            <small *ngIf="!ledgerExpiryPriorityRows().length">No expiry priority rows.</small>
          </article>
          <article>
            <h4>Cost drift</h4>
            <div class="risk-row" *ngFor="let row of ledgerCostDriftRows().slice(0, 5)" [class.high]="row['riskLevel'] === 'high'">
              <strong>{{ row['productName'] || 'Product' }}</strong>
              <span>{{ row['driftPct'] || 0 }}% drift · {{ row['samples'] || 0 }} samples</span>
              <small>Min {{ money(row['minUnitCost'] || 0) }} · max {{ money(row['maxUnitCost'] || 0) }}</small>
            </div>
            <small *ngIf="!ledgerCostDriftRows().length">No cost drift rows.</small>
          </article>
          <article>
            <h4>Client repeat usage</h4>
            <div class="risk-row" *ngFor="let row of ledgerClientRepeatUsageRows().slice(0, 5)" [class.high]="row['riskLevel'] === 'high'">
              <strong>{{ row['clientName'] || 'Walk-in client' }}</strong>
              <span>{{ row['serviceName'] || 'Service' }} · {{ row['productName'] || 'Product' }}</span>
              <small>{{ row['count'] || 0 }} visits · avg {{ money(row['avgCost'] || 0) }}</small>
            </div>
            <small *ngIf="!ledgerClientRepeatUsageRows().length">No repeat usage rows.</small>
          </article>
          <article>
            <h4>Adjustment heatmap</h4>
            <div class="risk-row" *ngFor="let row of ledgerAdjustmentReasonHeatRows().slice(0, 5)" [class.high]="row['riskLevel'] === 'high'">
              <strong>{{ row['usageType'] || 'adjustment' }}</strong>
              <span>{{ row['reason'] || 'No reason' }} · {{ row['count'] || 0 }} entries</span>
              <small>{{ row['totalUsedText'] || '0' }} · {{ money(row['cost'] || 0) }}</small>
            </div>
            <small *ngIf="!ledgerAdjustmentReasonHeatRows().length">No adjustment heat rows.</small>
          </article>
          <article>
            <h4>Manager action queue</h4>
            <div class="risk-row" *ngFor="let row of ledgerManagerActionRows().slice(0, 5)" [class.high]="row['riskLevel'] === 'high'">
              <strong>{{ row['title'] || row['actionType'] }}</strong>
              <span>{{ row['actionType'] || 'action' }} · {{ row['riskLevel'] || 'watch' }}</span>
              <small>{{ row['detail'] || 'Review required' }}</small>
            </div>
            <small *ngIf="!ledgerManagerActionRows().length">No manager actions.</small>
          </article>
        </div>
        <div class="report-feed">
          <article *ngFor="let event of ledgerEvents().slice(0, 8)">
            <strong>{{ event['title'] || event['entityType'] }}</strong>
            <span>{{ event['detail'] || event['entityId'] }}</span>
            <small>{{ event['entityType'] }} · {{ event['eventAt'] | auraDate:'date' }}</small>
          </article>
        </div>
      </section>

      <section class="staff-audit" *ngIf="staffUsageAudit() as audit">
        <div class="ledger-head">
          <div>
            <h3>Product consume accountability</h3>
          </div>
        </div>
        <div class="audit-filters">
          <label><span>Branch</span><input [(ngModel)]="auditFilters.branchId" placeholder="Branch ID"></label>
          <label>
            <span>Staff</span>
            <select [(ngModel)]="auditFilters.staffId">
              <option value="">All staff</option>
              <option *ngFor="let row of staffAuditRows()" [value]="row['staffId']">{{ row['staffName'] || 'Unassigned' }}</option>
            </select>
          </label>
          <label><span>Start</span><input type="date" [(ngModel)]="auditFilters.startDate"></label>
          <label><span>End</span><input type="date" [(ngModel)]="auditFilters.endDate"></label>
          <button type="button" class="ghost" (click)="loadStaffUsageAudit()">Refresh audit</button>
        </div>
        <div class="owner-metrics">
          <article><span>Staff</span><strong>{{ audit['summary']?.staffCount || 0 }}</strong></article>
          <article><span>Consume lines</span><strong>{{ audit['summary']?.totalProductLines || 0 }}</strong></article>
          <article><span>Usage value</span><strong>{{ money(audit['summary']?.totalUsageCost || 0) }}</strong></article>
          <article><span>Adjustments</span><strong>{{ audit['summary']?.adjustmentCount || 0 }}</strong></article>
          <article><span>Exceptions</span><strong>{{ audit['summary']?.exceptionCount || 0 }}</strong></article>
        </div>
        <div class="audit-layout">
          <div class="audit-table" *ngIf="staffAuditRows().length; else noStaffAudit">
            <div class="audit-row head"><span>Staff</span><span>Services</span><span>Products</span><span>Total used</span><span>Cost</span><span>Exceptions</span><span>Last used</span></div>
            <div class="audit-row" *ngFor="let row of staffAuditRows()">
              <strong>{{ row['staffName'] || 'Unassigned' }}</strong>
              <span>{{ row['serviceCount'] || 0 }}</span>
              <span>{{ row['productCount'] || 0 }}</span>
              <span>{{ row['totalUsedText'] || '0' }}</span>
              <span>{{ money(row['cost'] || 0) }}</span>
              <span>{{ row['exceptionCount'] || 0 }}</span>
              <span>{{ row['lastUsedAt'] | auraDate:'date' }}</span>
            </div>
          </div>
          <ng-template #noStaffAudit>
          </ng-template>
          <div class="audit-feed">
            <h4>Recent usage</h4>
            <article *ngFor="let entry of auditRecentEntries().slice(0, 6)">
              <strong>{{ entry['staffName'] || 'Unassigned' }} · {{ entry['productName'] || entry['productId'] }}</strong>
              <span>{{ entry['invoiceNumber'] || entry['source'] }} · {{ entry['clientName'] || 'Walk-in client' }} · {{ qty(entry['quantity'], entry['unit']) }} · {{ money(entry['cost'] || 0) }}</span>
              <small>{{ entry['serviceName'] || 'Service' }} · {{ entry['usedAt'] | auraDate:'date' }}</small>
            </article>
            <h4 *ngIf="auditExceptions().length">Exceptions</h4>
            <article class="exception" *ngFor="let entry of auditExceptions().slice(0, 4)">
              <strong>{{ entry['exceptionType'] || entry['source'] }}</strong>
              <span>{{ entry['staffName'] || 'Manager override' }} · {{ entry['productName'] || entry['productId'] }} · {{ entry['reason'] || 'Review required' }}</span>
              <small>{{ entry['usedAt'] | auraDate:'date' }}</small>
            </article>
          </div>
        </div>
      </section>

      <div *ngIf="error()" class="alert">{{ error() }}</div>
      <div *ngIf="message()" class="success">{{ message() }}</div>

      <div class="workspace zenoti-editor-shell">
        <section class="editor" *ngIf="selected() as draft; else noSelection">
          <div class="editor-head">
            <div>
              <h2>{{ draft.invoiceNumber }}</h2>
            </div>
            <span class="badge" [class.done]="draft.status === 'confirmed'">{{ draft.status }}</span>
          </div>

          <div class="info-grid">
            <label><span>Service</span><strong>{{ draft.serviceName }}</strong></label>
            <label><span>Client</span><strong>{{ draft.clientName || 'Walk-in client' }}</strong></label>
            <label><span>Staff</span><strong>{{ draft.staffName || 'Unassigned' }}</strong></label>
            <label><span>Cost</span><strong>{{ money(draft.actualCost || draft.expectedCost) }}</strong></label>
          </div>

          <section class="wastage-guard" *ngIf="draftWastageGuard(draft) as guard" [class.warn]="guard.warn" [class.blocked]="guard.approvalRequired">
            <div>
              <strong>{{ guard.status }}</strong>
              <small>{{ guard.detail }}</small>
            </div>
            <div class="guard-metrics">
              <span>Normal {{ wasteWarnLimit }}%</span>
              <span>Owner approval {{ wasteApprovalLimit }}%</span>
              <span>Current {{ guard.maxWastagePct }}%</span>
            </div>
          </section>

          <div class="consume-table">
            <div class="row head">
              <span>Product</span><span>Auto qty / unit</span><span>Waste</span><span>Range</span><span>Reason</span><span>Substitutes</span><span>Cost</span><span>Action</span>
            </div>
            <div class="row" *ngFor="let line of draft.lineItems; let i = index">
              <span>
                <strong>{{ line.productName || line.productId }}</strong>
                <small>{{ line.unitCost | number:'1.2-2' }} / {{ line.unit }}<ng-container *ngIf="linePackLabel(line)"> · {{ linePackLabel(line) }}</ng-container></small>
                <div class="line-ledger" *ngIf="line.backbarAllocations?.length">
                  <small *ngFor="let allocation of line.backbarAllocations">
                    {{ allocation['containerCode'] || ('Container #' + allocation['containerNo']) }} · {{ allocation['usedQty'] || 0 }} {{ allocation['unit'] || line.unit }} used · {{ allocation['balanceAfter'] || 0 }} left
                    <ng-container *ngIf="allocation['stockDeducted']"> · stock -1 {{ allocation['stockUnit'] || line.stockUnit || 'pcs' }}</ng-container>
                  </small>
                </div>
              </span>
              <span class="qty-unit" *ngIf="lineEditing(i, draft); else qtyRead">
                <input type="number" min="0" step="0.01" [ngModel]="line.actualQty" (ngModelChange)="updateQty(i, $event)">
                <select [ngModel]="line.unit" (ngModelChange)="updateLine(i, { unit: $event })">
                  <option *ngFor="let unit of units" [value]="unit">{{ unit }}</option>
                </select>
              </span>
              <ng-template #qtyRead><span class="line-read">{{ line.actualQty || 0 }} {{ line.unit || 'pcs' }}</span></ng-template>
              <span *ngIf="lineEditing(i, draft); else wasteRead"><input type="number" min="0" step="0.01" [class.waste-warn]="lineWasteWarn(line)" [class.waste-block]="lineWasteApprovalRequired(line)" [ngModel]="line.wastagePct || 0" (ngModelChange)="updateLine(i, { wastagePct: $event })"></span>
              <ng-template #wasteRead><span class="line-read" [class.waste-warn]="lineWasteWarn(line)" [class.waste-block]="lineWasteApprovalRequired(line)">{{ line.wastagePct || 0 }}%</span></ng-template>
              <span class="range-fields" *ngIf="lineEditing(i, draft); else rangeRead">
                <input type="number" min="0" step="0.01" placeholder="Min" [ngModel]="line.minQty || 0" (ngModelChange)="updateLine(i, { minQty: $event })">
                <input type="number" min="0" step="0.01" placeholder="Max" [ngModel]="line.maxQty || 0" (ngModelChange)="updateLine(i, { maxQty: $event })">
                <small *ngIf="autoWastePct(line) > 0">Auto waste {{ autoWastePct(line) }}%</small>
              </span>
              <ng-template #rangeRead>
                <span class="line-read">
                  {{ line.minQty || 0 }} - {{ line.maxQty || 0 }}
                  <small *ngIf="autoWastePct(line) > 0">Auto waste {{ autoWastePct(line) }}%</small>
                </span>
              </ng-template>
              <span *ngIf="lineEditing(i, draft); else reasonRead"><input [class.reason-needed]="lineNeedsReason(line)" [ngModel]="line.reason || ''" (ngModelChange)="updateLine(i, { reason: $event })" placeholder="Required if overuse"></span>
              <ng-template #reasonRead><span class="line-read" [class.reason-needed]="lineNeedsReason(line)">{{ line.reason || '-' }}</span></ng-template>
              <span *ngIf="lineEditing(i, draft); else substituteRead"><input [ngModel]="line.substitutes || ''" (ngModelChange)="updateLine(i, { substitutes: $event })" placeholder="Alternate product ids/name"></span>
              <ng-template #substituteRead><span class="line-read">{{ line.substitutes || '-' }}</span></ng-template>
              <span>{{ money(lineActualCost(line)) }}</span>
              <span class="line-actions">
                <button type="button" class="ghost mini" *ngIf="draft.status !== 'confirmed' && !lineEditing(i, draft)" (click)="editLine(i)">Edit</button>
                <button type="button" class="ghost mini" *ngIf="lineEditing(i, draft)" (click)="doneLineEdit()">Done</button>
              </span>
            </div>
          </div>

          <section class="backbar-ledger" *ngIf="ledgerProducts().length">
            <div class="ledger-head">
              <div>
                <h3>Open container ledger</h3>
              </div>
            </div>
            <div class="container-scan">
              <div>
                <strong>Container instant history</strong>
              </div>
              <input [(ngModel)]="containerScanCode" placeholder="Scan or paste container QR / barcode">
              <button type="button" class="ghost" (click)="scanContainer()">Scan</button>
            </div>
            <article class="scan-result" *ngIf="scannedContainer() as scan">
              <div>
                <strong>{{ scan['product']?.name || scan['container']?.productName }}</strong>
                <span>{{ scan['container']?.containerCode }} · {{ scan['container']?.qrCode }}</span>
              </div>
              <div>
                <span>Status</span>
                <strong>{{ scan['summary']?.status || scan['container']?.status }}</strong>
              </div>
              <div>
                <span>Balance</span>
                <strong>{{ scan['summary']?.balanceText }}</strong>
              </div>
              <div>
                <span>Used</span>
                <strong>{{ scan['summary']?.usedText }}</strong>
              </div>
              <div class="scan-history">
                <small *ngFor="let entry of scanEntries().slice(0, 4)">
                  {{ entry['clientName'] || entry['usageType'] || 'Usage' }} · {{ entry['usedQty'] || 0 }} {{ entry['unit'] }} · {{ entry['balanceAfter'] || 0 }} left
                </small>
                <small *ngIf="!scanEntries().length">No usage entry yet.</small>
              </div>
            </article>
            <article class="ledger-product" *ngFor="let product of ledgerProducts()">
              <div class="ledger-summary">
                <div>
                  <strong>{{ product['productName'] }}</strong>
                  <small>{{ qty(product['capacityQty'], product['measureUnit']) }} per {{ product['stockUnit'] }}</small>
                </div>
                <div><span>Sealed</span><strong>{{ product['sealedStock'] || 0 }} {{ product['stockUnit'] }}</strong></div>
                <div><span>Open</span><strong>{{ product['openCount'] || 0 }}</strong></div>
                <div><span>Finished</span><strong>{{ product['finishedCount'] || 0 }}</strong></div>
              </div>
              <div class="active-container" *ngIf="product['activeContainer'] as container">
                <div>
                  <span>{{ product['stockUnit'] }} #{{ container['containerNo'] }}</span>
                  <strong>{{ qty(container['balanceQty'], product['measureUnit']) }} left</strong>
                  <small>QR {{ container['qrCode'] || container['barcode'] }}</small>
                </div>
                <div class="progress"><i [style.width.%]="containerProgress(container)"></i></div>
                <small>{{ qty(container['usedQty'], product['measureUnit']) }} used from {{ qty(container['capacityQty'], product['measureUnit']) }}</small>
              </div>
              <div class="ledger-actions" *ngIf="product['activeContainer'] as container">
                <select [(ngModel)]="adjustForm.usageType">
                  <option value="spillage">Spillage</option>
                  <option value="expired">Expired</option>
                  <option value="damaged">Damaged</option>
                  <option value="manual_adjustment">Manual adjustment</option>
                </select>
                <input type="number" min="0" step="0.01" [(ngModel)]="adjustForm.quantity" [placeholder]="'Qty in ' + product['measureUnit']">
                <input [(ngModel)]="adjustForm.reason" placeholder="Reason">
                <button type="button" class="ghost" (click)="recordAdjustment(container)">Record adjustment</button>
              </div>
              <div class="ledger-actions override">
                <input [(ngModel)]="overrideReason" placeholder="Manager override reason">
                <button type="button" class="ghost" (click)="overrideOpen(product)">Request next container</button>
              </div>
              <div class="ledger-alerts" *ngIf="ledgerAlerts(product).length">
                <span class="mini-alert" *ngFor="let alert of ledgerAlerts(product).slice(0, 3)" [class.high]="alert['severity'] === 'high'">
                  {{ alert['title'] || alert['message'] }}
                </span>
              </div>
              <div class="ledger-history" *ngIf="ledgerEntries(product).length; else noLedgerHistory">
                <div class="history-row" *ngFor="let entry of ledgerEntries(product).slice(0, 6)">
                  <strong>{{ entry['clientName'] || 'Walk-in client' }}</strong>
                  <span>{{ entry['serviceName'] || draft.serviceName }}</span>
                  <span>{{ qty(entry['usedQty'], entry['unit']) }}</span>
                  <span>{{ qty(entry['balanceAfter'], entry['unit']) }} left</span>
                </div>
              </div>
              <ng-template #noLedgerHistory>
              </ng-template>
            </article>
          </section>

          <div class="manual-product-toggle" *ngIf="draft.status !== 'confirmed' && !extraProductOpen">
            <button type="button" class="ghost" (click)="openExtraProduct()">Add extra product</button>
          </div>

          <div class="manual-product-add" *ngIf="draft.status !== 'confirmed' && extraProductOpen">
            <label class="product-picker">
              <span>Product</span>
              <input [(ngModel)]="productQuery" (ngModelChange)="productForm.productId = ''; productPickerOpen = true" placeholder="Search product by name / SKU">
              <div class="product-results" *ngIf="productPickerOpen && filteredProducts().length">
                <button type="button" *ngFor="let product of filteredProducts()" (click)="selectProduct(product)">
                  <strong>{{ product.name }}</strong>
                  <small>Qty {{ product.stock || 0 }} {{ productStockUnit(product) }}<ng-container *ngIf="productPackLabel(product)"> · {{ productPackLabel(product) }}</ng-container></small>
                </button>
              </div>
              <small class="selected-stock" *ngIf="selectedProduct() as product">
                Available qty: {{ product.stock || 0 }} {{ productStockUnit(product) }}<ng-container *ngIf="productPackLabel(product)"> · {{ productPackLabel(product) }}</ng-container>
              </small>
            </label>
            <label>
              <span>Auto qty</span>
              <input type="number" min="0" step="0.01" [(ngModel)]="productForm.qty">
            </label>
            <label>
              <span>Unit</span>
              <select [(ngModel)]="productForm.unit">
                <option *ngFor="let unit of units" [value]="unit">{{ unit }}</option>
              </select>
            </label>
            <label>
              <span>Waste</span>
              <input type="number" min="0" step="0.01" [class.waste-warn]="productForm.wastagePct >= wasteWarnLimit" [class.waste-block]="productForm.wastagePct > wasteApprovalLimit" [(ngModel)]="productForm.wastagePct">
            </label>
            <label>
              <span>Min</span>
              <input type="number" min="0" step="0.01" [(ngModel)]="productForm.minQty">
            </label>
            <label>
              <span>Max</span>
              <input type="number" min="0" step="0.01" [(ngModel)]="productForm.maxQty">
            </label>
            <label>
              <span>Substitutes</span>
              <input [(ngModel)]="productForm.substitutes" placeholder="Alternate product ids/name">
            </label>
            <button type="button" class="ghost" (click)="addProductLine()">Add product</button>
            <button type="button" class="ghost" (click)="cancelExtraProduct()">Cancel</button>
          </div>

          <label class="notes">
            <span>Notes</span>
            <textarea rows="3" [ngModel]="draft.notes || ''" (ngModelChange)="updateNotes($event)" [disabled]="draft.status === 'confirmed'"></textarea>
          </label>

          <div class="action-row">
            <button type="button" class="ghost" (click)="saveDraft()" [disabled]="saving() || draft.status === 'confirmed'">Save draft</button>
            <button type="button" class="primary" (click)="confirmDraft()" [disabled]="saving() || draft.status !== 'draft' || !draft.lineItems.length || draftConfirmBlocked(draft)">
              {{ confirmButtonLabel(draft) }}
            </button>
          </div>
          <small class="confirm-lock" *ngIf="draftConfirmBlocked(draft)">{{ draftWastageGuard(draft).detail }}</small>
        </section>
        <ng-template #noSelection>
          <section class="editor empty-editor">Select invoice draft to edit product consumption.</section>
        </ng-template>
      </div>
    </section>
  `,
  styles: [`
    .page-stack { display: grid; gap: 8px; padding: 8px; background: #f0f2f5; }
    .zenoti-consume-register, .workspace, .editor, .owner-report, .owner-dashboard, .control-report, .staff-audit { background: #fff; border: 1px solid #d8e1ea; box-shadow: none; }
    .module-hero { display: flex; justify-content: space-between; gap: 16px; align-items: center; padding: 24px; border-radius: 22px; }
    .module-hero h1, .editor h2, .zenoti-toolbar h2 { margin: 4px 0; color: #111827; }
    .module-hero p { margin: 0; color: #64748b; }
    .eyebrow { color: #5b6b81; font-size: 12px; font-weight: 900; text-transform: uppercase; }
    .hero-actions, .action-row { display: flex; gap: 10px; flex-wrap: wrap; }
    button, a.ghost { border: 1px solid #c7d6e5; border-radius: 3px; padding: 9px 14px; font-weight: 900; text-decoration: none; cursor: pointer; }
    .primary { background: #0b72b5; border-color: #0b72b5; color: white; }
    .ghost { background: white; color: #0f172a; }
    button:disabled { opacity: .55; cursor: not-allowed; }
    .zenoti-consume-register { display: grid; overflow: hidden; border-radius: 0; }
    .zenoti-toolbar { display: flex; justify-content: space-between; gap: 14px; align-items: end; padding: 14px 16px; border: 1px solid #d8e1ea; }
    .toolbar-actions { display: flex; gap: 8px; align-items: end; flex-wrap: wrap; }
    .toolbar-actions label { display: grid; gap: 4px; min-width: 210px; }
    .toolbar-actions span { color: #5b6b81; font-size: 12px; font-weight: 900; }
    .consume-kpi-strip { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); border-left: 1px solid #d8e1ea; border-right: 1px solid #d8e1ea; border-bottom: 1px solid #d8e1ea; }
    .consume-kpi-strip article { padding: 10px 16px; display: grid; gap: 3px; border-right: 1px solid #e5edf4; }
    .consume-kpi-strip article:last-child { border-right: 0; }
    .consume-kpi-strip span, .info-grid span, .consume-table .head { color: #64748b; font-size: 12px; font-weight: 900; text-transform: uppercase; }
    .consume-kpi-strip strong { font-size: 22px; }
    .consume-kpi-strip small, .zenoti-register-table small, .consume-table small { color: #64748b; }
    .zenoti-table-scroll { overflow: auto; }
    .zenoti-register-table { width: 100%; min-width: 1180px; border-collapse: collapse; }
    .zenoti-register-table th, .zenoti-register-table td { padding: 10px 12px; border-bottom: 1px solid #dfe7ef; text-align: left; vertical-align: middle; }
    .zenoti-register-table th { background: #f4f7fa; color: #5b6b81; font-size: 12px; text-transform: uppercase; }
    .zenoti-register-table tbody tr { cursor: pointer; }
    .zenoti-register-table tbody tr:hover, .zenoti-register-table tbody tr.selected { background: #F5EEF2; }
    .zenoti-register-table td small { display: block; margin-top: 3px; }
    .mini-action { padding: 6px 10px; background: #fff; color: #0b72b5; }
    .table-empty { text-align: center; color: #64748b; padding: 18px; }
    .zenoti-footer { display: flex; justify-content: space-between; gap: 12px; padding: 9px 16px; color: #64748b; border-top: 1px solid #d8e1ea; font-size: 12px; }
    .workspace { display: block; border-radius: 0; overflow: hidden; }
    .list-head, .editor-head { display: flex; justify-content: space-between; gap: 12px; align-items: center; }
    select, input, textarea { width: 100%; border: 1px solid #cbd8e4; border-radius: 3px; padding: 9px 10px; font: inherit; }
    .draft-card { text-align: left; background: white; display: grid; gap: 5px; }
    .draft-card.active { background: #e8f4f2; border-color: #6D1B4D; }
    .badge { width: max-content; border-radius: 999px; padding: 5px 10px; background: #fff7ed; color: #9a3412; font-size: 12px; font-weight: 900; }
    .badge.done { background: #FBF0E8; color: #7A4A28; }
    .editor { border: 0; box-shadow: none; padding: 16px; display: grid; gap: 14px; }
    .info-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; }
    .info-grid label { border: 1px solid #d8e1ea; border-radius: 3px; padding: 10px; display: grid; gap: 6px; }
    .consume-table { border: 1px solid #d8e1ea; border-radius: 0; overflow: auto; }
    .row { display: grid; grid-template-columns: 1.6fr 1.1fr .7fr 1.1fr 1.3fr 1.4fr .75fr .65fr; gap: 12px; align-items: center; padding: 12px; border-bottom: 1px solid #edf4f3; min-width: 1240px; }
    .row:last-child { border-bottom: 0; }
    .line-ledger { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 6px; }
    .line-ledger small { border: 1px solid #cfe1df; border-radius: 999px; padding: 4px 8px; background: #F3EAF0; color: #4B1238; font-weight: 800; text-transform: none; }
    .qty-unit, .range-fields { display: grid; grid-template-columns: 1fr 86px; gap: 8px; }
    .range-fields { grid-template-columns: 1fr 1fr; }
    .range-fields small { grid-column: 1 / -1; color: #b45309; font-size: 11px; font-weight: 900; }
    .line-read { display: grid; min-height: 39px; align-content: center; border: 1px solid #e2ecea; border-radius: 0; background: #f8fbfa; padding: 9px 11px; color: #0f172a; font-weight: 800; }
    .line-read small { display: block; margin-top: 2px; color: #b45309; font-size: 11px; }
    .line-actions { display: flex; gap: 8px; justify-content: flex-end; }
    .backbar-ledger { border: 1px solid #dcebea; border-radius: 16px; padding: 14px; display: grid; gap: 12px; background: #f8fbfa; }
    .owner-report, .owner-dashboard, .control-report, .staff-audit { border-radius: 0; padding: 14px 16px; display: grid; gap: 12px; }
    .owner-metrics { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 10px; }
    .owner-metrics article { border: 1px solid #dcebea; border-radius: 12px; padding: 12px; display: grid; gap: 4px; background: #f8fbfa; }
    .owner-metrics span, .owner-metrics small { color: #64748b; font-size: 12px; font-weight: 900; text-transform: uppercase; }
    .audit-filters { display: grid; grid-template-columns: 1fr 1fr .75fr .75fr auto; gap: 10px; align-items: end; }
    .audit-filters label { display: grid; gap: 6px; }
    .audit-filters span { color: #64748b; font-size: 12px; font-weight: 900; text-transform: uppercase; }
    .audit-layout { display: grid; grid-template-columns: minmax(0, 1.4fr) minmax(300px, .8fr); gap: 12px; align-items: start; }
    .audit-table { border: 1px solid #dcebea; border-radius: 14px; overflow: auto; }
    .audit-row { min-width: 860px; display: grid; grid-template-columns: 1.4fr .65fr .65fr 1.1fr .8fr .75fr 1fr; gap: 10px; align-items: center; padding: 10px 12px; border-bottom: 1px solid #edf4f3; }
    .audit-row:last-child { border-bottom: 0; }
    .audit-row.head { color: #64748b; font-size: 12px; font-weight: 900; text-transform: uppercase; background: #f8fbfa; }
    .audit-feed { display: grid; gap: 8px; }
    .audit-feed h4 { margin: 6px 0 0; }
    .audit-feed article { border: 1px solid #dcebea; border-radius: 12px; padding: 10px; display: grid; gap: 3px; background: #f8fbfa; }
    .audit-feed article.exception { background: #fff7ed; border-color: #fed7aa; }
    .audit-feed span, .audit-feed small { color: #64748b; }
    .dashboard-actions { display: flex; gap: 8px; align-items: center; }
    .dashboard-layout { display: grid; grid-template-columns: minmax(0, 1fr) minmax(300px, .8fr); gap: 12px; align-items: start; }
    .dashboard-feed, .approval-queue { display: grid; gap: 8px; }
    .dashboard-feed h4, .approval-queue h4 { margin: 4px 0; }
    .dashboard-feed article, .approval-queue article { border: 1px solid #dcebea; border-radius: 12px; padding: 10px; display: grid; gap: 5px; background: #f8fbfa; }
    .dashboard-feed article.high { background: #fff1f2; border-color: #fecdd3; }
    .dashboard-feed span, .approval-queue span { color: #64748b; }
    .approval-queue article div { display: flex; gap: 8px; flex-wrap: wrap; }
    .profit-table { border: 1px solid #dcebea; border-radius: 14px; overflow: auto; }
    .profit-row { min-width: 760px; display: grid; grid-template-columns: 1.5fr .7fr .9fr .9fr .9fr .7fr; gap: 10px; align-items: center; padding: 10px 12px; border-bottom: 1px solid #edf4f3; }
    .profit-row:last-child { border-bottom: 0; }
    .profit-row.head { color: #64748b; font-size: 12px; font-weight: 900; text-transform: uppercase; background: #f8fbfa; }
    .report-filters { display: grid; grid-template-columns: .9fr 1.4fr .9fr .9fr .7fr .7fr auto auto; gap: 10px; align-items: end; }
    .report-filters label { display: grid; gap: 6px; }
    .report-filters span { color: #64748b; font-size: 12px; font-weight: 900; text-transform: uppercase; }
    .report-grid { display: grid; grid-template-columns: minmax(0, 1.3fr) minmax(300px, .8fr); gap: 12px; align-items: start; }
    .report-table { border: 1px solid #dcebea; border-radius: 14px; overflow: auto; }
    .report-table h4 { margin: 0; padding: 10px 12px; border-bottom: 1px solid #edf4f3; }
    .report-row { min-width: 820px; display: grid; grid-template-columns: 1.5fr 1fr .8fr .7fr 1fr; gap: 10px; align-items: center; padding: 10px 12px; border-bottom: 1px solid #edf4f3; }
    .report-row:last-child { border-bottom: 0; }
    .report-row.head { color: #64748b; font-size: 12px; font-weight: 900; text-transform: uppercase; background: #f8fbfa; }
    .report-side, .report-feed { display: grid; gap: 8px; }
    .report-side article, .report-feed article { border: 1px solid #dcebea; border-radius: 12px; padding: 10px; display: grid; gap: 4px; background: #f8fbfa; }
    .report-side span, .report-side small, .report-feed span, .report-feed small { color: #64748b; }
    .report-feed { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .product-360 { border: 1px solid #dcebea; border-radius: 16px; padding: 14px; display: grid; gap: 12px; background: #f8fbfa; }
    .product-360-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; }
    .product-360-grid > article { border: 1px solid #dcebea; border-radius: 12px; padding: 12px; display: grid; gap: 8px; background: white; }
    .product-360-grid h4 { margin: 0; }
    .risk-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; }
    .next-control-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; }
    .deep-control-grid { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 12px; }
    .owner-control-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; }
    .risk-grid > article { border: 1px solid #dcebea; border-radius: 12px; padding: 12px; display: grid; gap: 8px; background: #fff; }
    .next-control-grid > article { border: 1px solid #dcebea; border-radius: 12px; padding: 12px; display: grid; gap: 8px; background: #fff; }
    .deep-control-grid > article { border: 1px solid #dcebea; border-radius: 12px; padding: 12px; display: grid; gap: 8px; background: #fff; }
    .owner-control-grid > article { border: 1px solid #dcebea; border-radius: 12px; padding: 12px; display: grid; gap: 8px; background: #fff; }
    .risk-grid h4 { margin: 0; }
    .next-control-grid h4 { margin: 0; }
    .deep-control-grid h4 { margin: 0; }
    .owner-control-grid h4 { margin: 0; }
    .risk-row { border: 1px solid #edf4f3; border-radius: 10px; padding: 9px; display: grid; gap: 3px; background: #f8fbfa; }
    .risk-row.high { background: #fff1f2; border-color: #fecdd3; }
    .risk-row span, .risk-row small, .risk-grid > article > small, .next-control-grid > article > small, .deep-control-grid > article > small, .owner-control-grid > article > small { color: #64748b; }
    .ledger-head, .ledger-summary, .active-container { display: flex; justify-content: space-between; gap: 12px; align-items: center; }
    .ledger-head h3 { margin: 2px 0 0; }
    .ledger-head small, .ledger-product small, .ledger-summary span, .history-row span { color: #64748b; }
    .container-scan { display: grid; grid-template-columns: 1.1fr 1.4fr auto; gap: 10px; align-items: end; border: 1px solid #dcebea; border-radius: 14px; padding: 12px; background: white; }
    .container-scan div { display: grid; gap: 3px; }
    .scan-result { border: 1px solid #9bd8cf; border-radius: 14px; padding: 12px; background: #F3EAF0; display: grid; grid-template-columns: 1.4fr repeat(3, .7fr); gap: 10px; align-items: start; }
    .scan-result div { display: grid; gap: 4px; }
    .scan-result span, .scan-result small { color: #4B1238; }
    .scan-history { grid-column: 1 / -1; display: flex; flex-wrap: wrap; gap: 6px; }
    .scan-history small { border: 1px solid #9bd8cf; border-radius: 999px; padding: 5px 8px; background: white; }
    .ledger-product { background: white; border: 1px solid #dcebea; border-radius: 14px; padding: 12px; display: grid; gap: 10px; }
    .ledger-summary { display: grid; grid-template-columns: 1.6fr repeat(3, minmax(90px, .5fr)); }
    .ledger-summary div { display: grid; gap: 4px; }
    .active-container { align-items: start; border: 1px dashed #9bd8cf; border-radius: 12px; padding: 10px; background: #F3EAF0; }
    .progress { height: 9px; min-width: 160px; border-radius: 999px; overflow: hidden; background: #d7e6e4; }
    .progress i { display: block; height: 100%; border-radius: inherit; background: #4B1238; }
    .ledger-alerts { display: flex; flex-wrap: wrap; gap: 8px; }
    .ledger-actions { display: grid; grid-template-columns: .8fr .7fr 1fr auto; gap: 8px; align-items: center; }
    .ledger-actions.override { grid-template-columns: 1fr auto; }
    .mini-alert { border-radius: 999px; background: #F5EEF2; color: #8B5E7C; padding: 6px 10px; font-size: 12px; font-weight: 900; }
    .mini-alert.high { background: #fee2e2; color: #991b1b; }
    .ledger-history { display: grid; gap: 6px; }
    .history-row { display: grid; grid-template-columns: 1.2fr 1.4fr .8fr .8fr; gap: 10px; padding: 8px 0; border-top: 1px solid #edf4f3; }
    .ledger-empty { margin: 0; color: #64748b; }
    .notes { display: grid; gap: 8px; }
    .manual-product-toggle { display: flex; justify-content: flex-start; }
    .manual-product-add { display: grid; grid-template-columns: minmax(260px, 2fr) .7fr .7fr .7fr .7fr .7fr 1.2fr auto auto; gap: 10px; align-items: end; }
    .manual-product-add label { display: grid; gap: 6px; }
    .manual-product-add span { color: #64748b; font-size: 12px; font-weight: 900; text-transform: uppercase; }
    .product-picker { position: relative; }
    .product-results { position: absolute; left: 0; right: 0; top: 72px; z-index: 5; max-height: 260px; overflow: auto; background: white; border: 1px solid #cfe1df; border-radius: 14px; box-shadow: 0 18px 45px rgba(15,23,42,.18); padding: 6px; }
    .product-results button { width: 100%; display: grid; grid-template-columns: 1fr auto; gap: 10px; align-items: center; text-align: left; padding: 10px 12px; border: 0; border-radius: 10px; background: white; }
    .product-results button:hover { background: #e8f4f2; }
    .product-results small, .selected-stock { color: #4B1238; font-weight: 900; }
    .reason-needed { border-color: #f97316; background: #fff7ed; }
    .waste-warn { border-color: #f59e0b; background: #fffbeb; }
    .waste-block { border-color: #dc2626; background: #fef2f2; }
    .wastage-guard { border: 1px solid #cfe1df; border-radius: 12px; padding: 12px; background: #f8fbfa; display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 12px; align-items: center; }
    .wastage-guard.warn { border-color: #facc15; background: #fffbeb; }
    .wastage-guard.blocked { border-color: #fecaca; background: #fff1f2; }
    .wastage-guard strong { display: block; font-size: 15px; }
    .wastage-guard small { color: #64748b; }
    .guard-metrics { display: flex; flex-wrap: wrap; gap: 8px; justify-content: flex-end; }
    .guard-metrics span { border: 1px solid #dcebea; border-radius: 999px; padding: 6px 9px; background: white; color: #0f172a; font-size: 12px; font-weight: 900; }
    .confirm-lock { color: #991b1b; font-weight: 900; }
    .alert, .success { border-radius: 14px; padding: 12px 16px; font-weight: 800; }
    .alert { background: #fee2e2; color: #991b1b; }
    .success { background: #FBF0E8; color: #7A4A28; }
    .empty, .empty-editor { color: #64748b; padding: 18px; }
    @media (max-width: 900px) {
      .module-hero, .workspace { display: grid; }
      .consume-kpi-strip, .info-grid, .owner-metrics { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .zenoti-toolbar, .zenoti-footer { display: grid; }
      .audit-filters, .audit-layout, .dashboard-layout, .report-filters, .report-grid, .report-feed, .product-360-grid, .risk-grid, .next-control-grid, .deep-control-grid, .owner-control-grid { grid-template-columns: 1fr; }
      .ledger-summary, .history-row, .ledger-actions, .ledger-actions.override, .container-scan, .scan-result, .wastage-guard { grid-template-columns: 1fr 1fr; }
      .active-container { display: grid; }
      .manual-product-add { grid-template-columns: 1fr; }
    }
    @media (max-width: 560px) {
      .consume-kpi-strip, .info-grid { grid-template-columns: 1fr; }
      .wastage-guard { grid-template-columns: 1fr; }
      .guard-metrics { justify-content: flex-start; }
      .module-hero { padding: 18px; }
    }
  `]
})
export class ProductConsumeComponent {
  private readonly api = inject(ApiService);
  private readonly appState = inject(AppStateService);

  readonly drafts = signal<ConsumeDraft[]>([]);
  readonly selectedId = signal('');
  readonly loading = signal(false);
  readonly saving = signal(false);
  readonly error = signal('');
  readonly message = signal('');
  readonly statusFilter = signal('');
  readonly products = signal<ProductRow[]>([]);
  readonly backbarLedger = signal<ApiRecord | null>(null);
  readonly scannedContainer = signal<ApiRecord | null>(null);
  readonly backbarReport = signal<ApiRecord | null>(null);
  readonly backbarDashboard = signal<ApiRecord | null>(null);
  readonly controlLedgerReport = signal<ApiRecord | null>(null);
  readonly product360 = signal<ApiRecord | null>(null);
  readonly staffUsageAudit = signal<ApiRecord | null>(null);
  readonly units = RECIPE_UNITS;
  readonly wasteWarnLimit = PRODUCT_CONSUME_WASTAGE_WARN_PCT;
  readonly wasteApprovalLimit = PRODUCT_CONSUME_WASTAGE_OWNER_APPROVAL_PCT;
  productForm = { productId: '', qty: 1, unit: 'pcs', wastagePct: 0, minQty: 0, maxQty: 0, substitutes: '' };
  adjustForm = { quantity: 0, usageType: 'spillage', reason: '' };
  auditFilters = { branchId: '', staffId: '', startDate: '', endDate: '' };
  ledgerFilters = { branchId: '', productId: '', staffId: '', usageType: '', startDate: '', endDate: '' };
  product360Id = '';
  overrideReason = '';
  containerScanCode = '';
  dashboardPeriod = 'daily';
  productQuery = '';
  productPickerOpen = false;
  extraProductOpen = false;
  editingLineIndex: number | null = null;
  readonly selected = computed(() => this.drafts().find((draft) => draft.id === this.selectedId()) || null);
  readonly draftCount = computed(() => this.drafts().filter((draft) => draft.status !== 'confirmed').length);
  readonly confirmedCount = computed(() => this.drafts().filter((draft) => draft.status === 'confirmed').length);
  readonly totalExpected = computed(() => this.drafts().reduce((sum, draft) => sum + Number(draft.expectedCost || 0), 0));
  readonly totalActual = computed(() => this.drafts().reduce((sum, draft) => sum + Number(draft.actualCost || draft.expectedCost || 0), 0));
  readonly isOwnerApprover = computed(() => ['owner', 'admin', 'superAdmin'].includes(this.appState.userRole()));

  constructor() {
    this.auditFilters.branchId = this.api.selectedBranchId();
    this.ledgerFilters.branchId = this.api.selectedBranchId();
    this.loadProducts();
    this.loadBackbarReport();
    this.loadBackbarDashboard();
    this.loadControlLedgerReport();
    this.loadStaffUsageAudit();
    this.load();
  }

  loadProducts(): void {
    this.api.list<ProductRow[]>('products', { branchId: this.api.selectedBranchId(), limit: 10000 }).subscribe({
      next: (rows) => this.products.set(rows || []),
      error: () => this.products.set([])
    });
  }

  load(): void {
    this.loading.set(true);
    this.error.set('');
    const params: ApiRecord = { branchId: this.api.selectedBranchId(), limit: 250 };
    if (this.statusFilter()) params['status'] = this.statusFilter();
    this.api.list<ConsumeDraft[]>('inventory-intelligence/product-consume-drafts', params).subscribe({
      next: (rows) => {
        const normalized = (rows || []).map((row) => ({ ...row, lineItems: row.lineItems || [] }));
        this.drafts.set(normalized);
        if (!normalized.some((row) => row.id === this.selectedId())) this.selectedId.set(normalized[0]?.id || '');
        if (this.selectedId()) this.loadBackbarLedger(this.selectedId());
        this.loadBackbarReport();
        this.loadBackbarDashboard();
        this.loadControlLedgerReport();
        this.loadStaffUsageAudit();
        this.loading.set(false);
      },
      error: (err) => {
        this.error.set(err?.error?.error || err?.message || 'Unable to load product consume drafts.');
        this.loading.set(false);
      }
    });
  }

  setStatus(status: string): void {
    this.statusFilter.set(status);
    this.load();
  }

  select(draft: ConsumeDraft): void {
    this.selectedId.set(draft.id);
    this.doneLineEdit();
    this.cancelExtraProduct();
    this.loadBackbarLedger(draft.id);
  }

  updateQty(index: number, value: string | number): void {
    this.patchSelected((draft) => {
      const lineItems = [...draft.lineItems];
      const line = { ...lineItems[index], actualQty: Number(value || 0) };
      line.wastagePct = this.effectiveWastePct(line);
      line.actualCost = this.lineActualCost(line);
      lineItems[index] = line;
      return { ...draft, lineItems, actualCost: lineItems.reduce((sum, item) => sum + this.lineActualCost(item), 0) };
    });
  }

  updateNotes(notes: string): void {
    this.patchSelected((draft) => ({ ...draft, notes }));
  }

  lineEditing(index: number, draft: ConsumeDraft): boolean {
    return draft.status !== 'confirmed' && this.editingLineIndex === index;
  }

  editLine(index: number): void {
    this.editingLineIndex = index;
  }

  doneLineEdit(): void {
    this.editingLineIndex = null;
  }

  openExtraProduct(): void {
    this.extraProductOpen = true;
    this.error.set('');
  }

  cancelExtraProduct(): void {
    this.extraProductOpen = false;
    this.productPickerOpen = false;
    this.resetProductForm();
  }

  fillProductDefaults(): void {
    const product = this.products().find((row) => row.id === this.productForm.productId);
    this.productForm.unit = product ? this.defaultConsumeUnit(product) : String(this.productForm.unit || 'pcs');
    if (!this.productForm.qty) this.productForm.qty = 1;
  }

  selectedProduct(): ProductRow | null {
    return this.products().find((row) => row.id === this.productForm.productId) || null;
  }

  filteredProducts(): ProductRow[] {
    const query = this.productQuery.trim().toLowerCase();
    const rows = this.products().filter((product) => {
      const text = `${product.name || ''} ${product['sku'] || ''} ${product['category'] || ''}`.toLowerCase();
      return !query || text.includes(query);
    });
    return rows.slice(0, 12);
  }

  selectProduct(product: ProductRow): void {
    this.productForm.productId = product.id;
    this.productQuery = product.name;
    this.productPickerOpen = false;
    this.fillProductDefaults();
  }

  updateLine(index: number, patch: Partial<ConsumeLine>): void {
    this.patchSelected((draft) => {
      const lineItems = [...draft.lineItems];
      const line = { ...lineItems[index], ...patch };
      if (patch.unit !== undefined) line.unitCost = this.consumeUnitCostForLine(line, String(line.unit || 'pcs'));
      line.actualQty = Number(line.actualQty || 0);
      line.minQty = Number(line.minQty || 0);
      line.maxQty = Number(line.maxQty || 0);
      line.wastagePct = this.effectiveWastePct(line);
      line.actualCost = this.lineActualCost(line);
      lineItems[index] = line;
      return { ...draft, lineItems, actualCost: lineItems.reduce((sum, item) => sum + this.lineActualCost(item), 0) };
    });
  }

  addProductLine(): void {
    if (!this.extraProductOpen) {
      this.openExtraProduct();
      return;
    }
    const product = this.products().find((row) => row.id === this.productForm.productId);
    const qty = Number(this.productForm.qty || 0);
    if (!product || qty <= 0) {
      this.error.set('Select a product and keep quantity above 0.');
      return;
    }
    const wastagePct = Math.max(0, Number(this.productForm.wastagePct || 0));
    if (wastagePct > this.wasteApprovalLimit && !this.isOwnerApprover()) {
      this.error.set(`Waste ${wastagePct}% owner approval limit se above hai. Save/approval owner se karwana hoga.`);
      return;
    }
    const unit = String(this.productForm.unit || this.defaultConsumeUnit(product));
    const stockUnitCost = Number(product.unitCost || product['costPrice'] || product['purchasePrice'] || 0);
    const unitCost = this.consumeUnitCost(product, unit);
    const line: ConsumeLine = {
      productId: product.id,
      productName: product.name,
      unit,
      expectedQty: qty,
      actualQty: qty,
      wastagePct,
      minQty: Number(this.productForm.minQty || 0),
      maxQty: Number(this.productForm.maxQty || 0),
      substitutes: this.productForm.substitutes || '',
      stockUnit: this.productStockUnit(product),
      packSize: this.productPackSize(product),
      packUnit: this.productPackUnit(product),
      stockUnitCost,
      unitCost,
      expectedCost: Math.round(qty * unitCost * 100) / 100,
      actualCost: Math.round(qty * unitCost * 100) / 100
    };
    this.patchSelected((draft) => {
      const lineItems = [...draft.lineItems, line];
      return {
        ...draft,
        status: draft.status === 'recipe_missing' ? 'draft' : draft.status,
        lineItems,
        expectedCost: lineItems.reduce((sum, item) => sum + Number(item.expectedCost || 0), 0),
        actualCost: lineItems.reduce((sum, item) => sum + this.lineActualCost(item), 0),
        notes: draft.notes || 'Manual product consume added from invoice draft.'
      };
    });
    this.cancelExtraProduct();
    this.message.set('Product line added. Save draft or confirm consume.');
  }

  private resetProductForm(): void {
    this.productForm = { productId: '', qty: 1, unit: 'pcs', wastagePct: 0, minQty: 0, maxQty: 0, substitutes: '' };
    this.productQuery = '';
  }

  saveDraft(): void {
    const draft = this.selected();
    if (!draft) return;
    this.persist('Draft saved.', this.api.update<ConsumeDraft>('inventory-intelligence/product-consume-drafts', draft.id, {
      lineItems: draft.lineItems,
      notes: draft.notes || ''
    }));
  }

  confirmDraft(): void {
    const draft = this.selected();
    if (!draft) return;
    const guard = this.draftWastageGuard(draft);
    if (this.draftConfirmBlocked(draft)) {
      this.error.set(guard.detail);
      return;
    }
    this.persist('Product consume confirmed. Backbar ledger updated.', this.api.post<{ draft: ConsumeDraft; backbarLedger?: ApiRecord }>(`inventory-intelligence/product-consume-drafts/${draft.id}/confirm`, {
      lineItems: draft.lineItems,
      notes: draft.notes || '',
      ownerApproval: guard.approvalRequired && this.isOwnerApprover()
    }), true);
  }

  loadBackbarLedger(draftId: string): void {
    this.api.list<ApiRecord>(`inventory-intelligence/product-consume-drafts/${draftId}/backbar-ledger`).subscribe({
      next: (ledger) => this.backbarLedger.set(ledger || null),
      error: () => this.backbarLedger.set(null)
    });
  }

  scanContainer(): void {
    const code = this.containerScanCode.trim();
    if (!code) {
      this.error.set('Container QR/barcode scan karo.');
      return;
    }
    this.api.list<ApiRecord>('inventory-intelligence/backbar-container-scan', {
      code,
      branchId: this.api.selectedBranchId()
    }).subscribe({
      next: (scan) => {
        this.scannedContainer.set(scan || null);
        this.message.set('Container history loaded.');
      },
      error: (err) => this.error.set(err?.error?.error || err?.message || 'Container QR/barcode not found.')
    });
  }

  loadBackbarReport(): void {
    this.api.list<ApiRecord>('inventory-intelligence/backbar-owner-report', { branchId: this.api.selectedBranchId(), limit: 100 }).subscribe({
      next: (report) => this.backbarReport.set(report || null),
      error: () => this.backbarReport.set(null)
    });
  }

  loadBackbarDashboard(): void {
    this.api.list<ApiRecord>('inventory-intelligence/backbar-owner-dashboard', {
      branchId: this.api.selectedBranchId(),
      period: this.dashboardPeriod,
      limit: 100
    }).subscribe({
      next: (dashboard) => this.backbarDashboard.set(dashboard || null),
      error: () => this.backbarDashboard.set(null)
    });
  }

  loadControlLedgerReport(): void {
    const branchId = this.ledgerFilters.branchId || this.api.selectedBranchId();
    this.ledgerFilters.branchId = branchId;
    const params: ApiRecord = { branchId, limit: 300 };
    if (this.ledgerFilters.productId) params['productId'] = this.ledgerFilters.productId;
    if (this.ledgerFilters.staffId) params['staffId'] = this.ledgerFilters.staffId;
    if (this.ledgerFilters.usageType) params['usageType'] = this.ledgerFilters.usageType;
    if (this.ledgerFilters.startDate) params['startDate'] = this.ledgerFilters.startDate;
    if (this.ledgerFilters.endDate) params['endDate'] = this.ledgerFilters.endDate;
    this.api.list<ApiRecord>('inventory-intelligence/product-consumption-control-ledger', params).subscribe({
      next: (report) => this.controlLedgerReport.set(report || null),
      error: () => this.controlLedgerReport.set(null)
    });
  }

  loadProduct360(): void {
    const productId = this.product360Id || this.ledgerFilters.productId;
    if (!productId) {
      this.error.set('Product 360 ke liye product select karo.');
      return;
    }
    this.product360Id = productId;
    this.api.list<ApiRecord>(`inventory-intelligence/backbar-products/${productId}/report`, {
      branchId: this.ledgerFilters.branchId || this.api.selectedBranchId(),
      limit: 300
    }).subscribe({
      next: (report) => {
        this.product360.set(report || null);
        this.message.set('Product 360 loaded.');
      },
      error: (err) => this.error.set(err?.error?.error || err?.message || 'Product 360 report load nahi hua.')
    });
  }

  setDashboardPeriod(period: string): void {
    this.dashboardPeriod = period || 'daily';
    this.loadBackbarDashboard();
  }

  loadStaffUsageAudit(): void {
    const branchId = this.auditFilters.branchId || this.api.selectedBranchId();
    this.auditFilters.branchId = branchId;
    const params: ApiRecord = { branchId, limit: 100 };
    if (this.auditFilters.staffId) params['staffId'] = this.auditFilters.staffId;
    if (this.auditFilters.startDate) params['startDate'] = this.auditFilters.startDate;
    if (this.auditFilters.endDate) params['endDate'] = this.auditFilters.endDate;
    this.api.list<ApiRecord>('inventory-intelligence/staff-product-usage-audit', params).subscribe({
      next: (audit) => this.staffUsageAudit.set(audit || null),
      error: () => this.staffUsageAudit.set(null)
    });
  }

  recordAdjustment(container: ApiRecord): void {
    const quantity = Number(this.adjustForm.quantity || 0);
    if (!container?.['id'] || quantity <= 0) {
      this.error.set('Adjustment quantity 0 se zyada rakho.');
      return;
    }
    this.saving.set(true);
    this.api.post(`inventory-intelligence/backbar-containers/${container['id']}/adjust`, {
      quantity,
      usageType: this.adjustForm.usageType,
      reason: this.adjustForm.reason || this.adjustForm.usageType,
      unit: container['measureUnit']
    }).subscribe({
      next: () => {
        this.saving.set(false);
        this.adjustForm = { quantity: 0, usageType: 'spillage', reason: '' };
        if (this.selectedId()) this.loadBackbarLedger(this.selectedId());
        this.loadBackbarReport();
        this.loadBackbarDashboard();
        this.loadControlLedgerReport();
        this.loadStaffUsageAudit();
        this.message.set('Backbar adjustment recorded.');
      },
      error: (err) => {
        this.error.set(err?.error?.error || err?.message || 'Adjustment was not saved.');
        this.saving.set(false);
      }
    });
  }

  overrideOpen(product: ApiRecord): void {
    const reason = this.overrideReason.trim();
    if (!product?.['productId'] || !reason) {
      this.error.set('Override reason required hai.');
      return;
    }
    this.saving.set(true);
    this.api.post(`inventory-intelligence/backbar-products/${product['productId']}/override-requests`, {
      branchId: product['branchId'] || this.api.selectedBranchId(),
      reason,
      stockUnit: product['stockUnit'],
      packUnit: product['measureUnit'],
      packSize: product['capacityQty']
    }).subscribe({
      next: () => {
        this.saving.set(false);
        this.overrideReason = '';
        if (this.selectedId()) this.loadBackbarLedger(this.selectedId());
        this.loadBackbarReport();
        this.loadBackbarDashboard();
        this.loadControlLedgerReport();
        this.loadStaffUsageAudit();
        this.message.set('Manager approval request added.');
      },
      error: (err) => {
        this.error.set(err?.error?.error || err?.message || 'Override was not saved.');
        this.saving.set(false);
      }
    });
  }

  decideOverrideRequest(request: ApiRecord, decision: 'approve' | 'reject'): void {
    if (!request?.['id']) return;
    this.saving.set(true);
    this.api.post(`inventory-intelligence/backbar-override-requests/${request['id']}/decision`, {
      decision,
      decisionNote: decision === 'approve' ? 'Approved from Product Consume owner dashboard.' : 'Rejected from Product Consume owner dashboard.'
    }).subscribe({
      next: () => {
        this.saving.set(false);
        if (this.selectedId()) this.loadBackbarLedger(this.selectedId());
        this.loadBackbarReport();
        this.loadBackbarDashboard();
        this.loadControlLedgerReport();
        this.loadStaffUsageAudit();
        this.message.set(decision === 'approve' ? 'Override approved and next container opened.' : 'Override request rejected.');
      },
      error: (err) => {
        this.error.set(err?.error?.error || err?.message || 'Approval decision was not saved.');
        this.saving.set(false);
      }
    });
  }

  lineActualCost(line: ConsumeLine): number {
    return Math.round(Number(line.actualQty || 0) * Number(line.unitCost || 0) * 100) / 100;
  }

  lineWastePct(line: ConsumeLine): number {
    return this.effectiveWastePct(line);
  }

  autoWastePct(line: ConsumeLine): number {
    const actualQty = Number(line.actualQty || 0);
    const maxQty = Number(line.maxQty || 0);
    if (!maxQty || actualQty <= maxQty) return 0;
    return Math.round(((actualQty - maxQty) / maxQty) * 10000) / 100;
  }

  effectiveWastePct(line: ConsumeLine): number {
    return Math.max(0, Math.round(Math.max(Number(line.wastagePct || 0), this.autoWastePct(line)) * 100) / 100);
  }

  lineWasteWarn(line: ConsumeLine): boolean {
    return this.lineWastePct(line) >= this.wasteWarnLimit;
  }

  lineWasteApprovalRequired(line: ConsumeLine): boolean {
    return this.lineWastePct(line) > Number(line.wastageApprovalPct || this.wasteApprovalLimit);
  }

  draftWastageGuard(draft: ConsumeDraft): { warn: boolean; approvalRequired: boolean; maxWastagePct: number; status: string; detail: string } {
    const maxWastagePct = Math.max(0, ...draft.lineItems.map((line) => this.lineWastePct(line)));
    const approvalLimits = draft.lineItems.map((line) => Number(line.wastageApprovalPct || this.wasteApprovalLimit)).filter((value) => Number.isFinite(value) && value > 0);
    const approvalLimit = approvalLimits.length ? Math.min(...approvalLimits) : this.wasteApprovalLimit;
    const approvalRequired = draft.lineItems.some((line) => this.lineWasteApprovalRequired(line));
    const warn = maxWastagePct >= this.wasteWarnLimit;
    if (approvalRequired) {
      return {
        warn,
        approvalRequired,
        maxWastagePct,
        status: this.isOwnerApprover() ? 'Owner approval required' : 'Confirm locked',
        detail: this.isOwnerApprover()
          ? `Waste ${maxWastagePct}% hai. Owner approve & confirm se audit ke saath confirm hoga.`
          : `Waste ${maxWastagePct}% owner approval limit ${approvalLimit}% se above hai.`
      };
    }
    if (warn) {
      return {
        warn,
        approvalRequired,
        maxWastagePct,
        status: 'High waste warning',
        detail: `Waste ${maxWastagePct}% hai. Reason/range verify karke confirm karein.`
      };
    }
    return {
      warn,
      approvalRequired,
      maxWastagePct,
      status: 'Within limit',
      detail: `Waste ${maxWastagePct}% hai. Normal limit ${this.wasteWarnLimit}% tak clean rahega.`
    };
  }

  draftConfirmBlocked(draft: ConsumeDraft): boolean {
    const guard = this.draftWastageGuard(draft);
    return guard.approvalRequired && !this.isOwnerApprover();
  }

  confirmButtonLabel(draft: ConsumeDraft): string {
    const guard = this.draftWastageGuard(draft);
    return guard.approvalRequired && this.isOwnerApprover() ? 'Owner approve & confirm' : 'Confirm consume';
  }

  ledgerProducts(): ApiRecord[] {
    return (this.backbarLedger()?.['products'] || []) as ApiRecord[];
  }

  scanEntries(): ApiRecord[] {
    return (this.scannedContainer()?.['entries'] || []) as ApiRecord[];
  }

  ledgerAlerts(product: ApiRecord): ApiRecord[] {
    return (product?.['alerts'] || []) as ApiRecord[];
  }

  ledgerEntries(product: ApiRecord): ApiRecord[] {
    return (product?.['entries'] || []) as ApiRecord[];
  }

  staffAuditRows(): ApiRecord[] {
    return (this.staffUsageAudit()?.['staff'] || []) as ApiRecord[];
  }

  auditRecentEntries(): ApiRecord[] {
    return (this.staffUsageAudit()?.['recentEntries'] || []) as ApiRecord[];
  }

  auditExceptions(): ApiRecord[] {
    return (this.staffUsageAudit()?.['exceptions'] || []) as ApiRecord[];
  }

  dashboardAlerts(): ApiRecord[] {
    return (this.backbarDashboard()?.['advancedAlerts'] || []) as ApiRecord[];
  }

  approvalRequests(): ApiRecord[] {
    return (this.backbarDashboard()?.['approvalRequests'] || []) as ApiRecord[];
  }

  dashboardServiceProfit(): ApiRecord[] {
    return (this.backbarDashboard()?.['serviceProfit'] || []) as ApiRecord[];
  }

  productOptions(): ProductRow[] {
    return this.products().slice().sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
  }

  ledgerProductRows(): ApiRecord[] {
    return (this.controlLedgerReport()?.['productRows'] || []) as ApiRecord[];
  }

  product360Containers(): ApiRecord[] {
    return (this.product360()?.['containers'] || []) as ApiRecord[];
  }

  product360Clients(): ApiRecord[] {
    return (this.product360()?.['clientUsage'] || []) as ApiRecord[];
  }

  product360Staff(): ApiRecord[] {
    return (this.product360()?.['staffUsage'] || []) as ApiRecord[];
  }

  product360Waste(): ApiRecord[] {
    return (this.product360()?.['wastageByType'] || []) as ApiRecord[];
  }

  product360Actions(): ApiRecord[] {
    return (this.product360()?.['actionQueue'] || []) as ApiRecord[];
  }

  product360Ledger(): ApiRecord[] {
    return (this.product360()?.['entityLedger'] || []) as ApiRecord[];
  }

  ledgerServiceRows(): ApiRecord[] {
    return (this.controlLedgerReport()?.['serviceRows'] || []) as ApiRecord[];
  }

  ledgerStaffRows(): ApiRecord[] {
    return (this.controlLedgerReport()?.['staffRows'] || []) as ApiRecord[];
  }

  ledgerWasteRows(): ApiRecord[] {
    return (this.controlLedgerReport()?.['wasteRows'] || []) as ApiRecord[];
  }

  ledgerClientRows(): ApiRecord[] {
    return (this.controlLedgerReport()?.['clientRows'] || []) as ApiRecord[];
  }

  ledgerApprovalRows(): ApiRecord[] {
    return (this.controlLedgerReport()?.['approvalRows'] || []) as ApiRecord[];
  }

  ledgerBranchRows(): ApiRecord[] {
    return (this.controlLedgerReport()?.['branchRows'] || []) as ApiRecord[];
  }

  ledgerSupplierRows(): ApiRecord[] {
    return (this.controlLedgerReport()?.['supplierRows'] || []) as ApiRecord[];
  }

  ledgerBatchExpiryRows(): ApiRecord[] {
    return (this.controlLedgerReport()?.['batchExpiryRows'] || []) as ApiRecord[];
  }

  ledgerStaffOveruseRows(): ApiRecord[] {
    return (this.controlLedgerReport()?.['staffOveruseRows'] || []) as ApiRecord[];
  }

  ledgerServiceMarginRows(): ApiRecord[] {
    return (this.controlLedgerReport()?.['serviceMarginRows'] || []) as ApiRecord[];
  }

  ledgerSlowMovingRows(): ApiRecord[] {
    return (this.controlLedgerReport()?.['slowMovingRows'] || []) as ApiRecord[];
  }

  ledgerReorderRows(): ApiRecord[] {
    return (this.controlLedgerReport()?.['reorderRows'] || []) as ApiRecord[];
  }

  ledgerPendingConsumeRows(): ApiRecord[] {
    return (this.controlLedgerReport()?.['pendingConsumeRows'] || []) as ApiRecord[];
  }

  ledgerReasonComplianceRows(): ApiRecord[] {
    return (this.controlLedgerReport()?.['reasonComplianceRows'] || []) as ApiRecord[];
  }

  ledgerUsageCategoryRows(): ApiRecord[] {
    return (this.controlLedgerReport()?.['usageCategoryRows'] || []) as ApiRecord[];
  }

  ledgerContainerEfficiencyRows(): ApiRecord[] {
    return (this.controlLedgerReport()?.['containerEfficiencyRows'] || []) as ApiRecord[];
  }

  ledgerClientProfitRows(): ApiRecord[] {
    return (this.controlLedgerReport()?.['clientProfitRows'] || []) as ApiRecord[];
  }

  ledgerProductControlScoreRows(): ApiRecord[] {
    return (this.controlLedgerReport()?.['productControlScoreRows'] || []) as ApiRecord[];
  }

  ledgerDailyTrendRows(): ApiRecord[] {
    return (this.controlLedgerReport()?.['dailyTrendRows'] || []) as ApiRecord[];
  }

  ledgerWeeklyTrendRows(): ApiRecord[] {
    return (this.controlLedgerReport()?.['weeklyTrendRows'] || []) as ApiRecord[];
  }

  ledgerApprovalSlaRows(): ApiRecord[] {
    return (this.controlLedgerReport()?.['approvalSlaRows'] || []) as ApiRecord[];
  }

  ledgerStaffProductRiskRows(): ApiRecord[] {
    return (this.controlLedgerReport()?.['staffProductRiskRows'] || []) as ApiRecord[];
  }

  ledgerStockReconciliationRows(): ApiRecord[] {
    return (this.controlLedgerReport()?.['stockReconciliationRows'] || []) as ApiRecord[];
  }

  ledgerContainerLifecycleRows(): ApiRecord[] {
    return (this.controlLedgerReport()?.['containerLifecycleRows'] || []) as ApiRecord[];
  }

  ledgerServiceRecipeComplianceRows(): ApiRecord[] {
    return (this.controlLedgerReport()?.['serviceRecipeComplianceRows'] || []) as ApiRecord[];
  }

  ledgerForecastBurnRows(): ApiRecord[] {
    return (this.controlLedgerReport()?.['forecastBurnRows'] || []) as ApiRecord[];
  }

  ledgerUsageAnomalyRows(): ApiRecord[] {
    return (this.controlLedgerReport()?.['usageAnomalyRows'] || []) as ApiRecord[];
  }

  ledgerExpiryPriorityRows(): ApiRecord[] {
    return (this.controlLedgerReport()?.['expiryPriorityRows'] || []) as ApiRecord[];
  }

  ledgerCostDriftRows(): ApiRecord[] {
    return (this.controlLedgerReport()?.['costDriftRows'] || []) as ApiRecord[];
  }

  ledgerClientRepeatUsageRows(): ApiRecord[] {
    return (this.controlLedgerReport()?.['clientRepeatUsageRows'] || []) as ApiRecord[];
  }

  ledgerAdjustmentReasonHeatRows(): ApiRecord[] {
    return (this.controlLedgerReport()?.['adjustmentReasonHeatRows'] || []) as ApiRecord[];
  }

  ledgerManagerActionRows(): ApiRecord[] {
    return (this.controlLedgerReport()?.['managerActionRows'] || []) as ApiRecord[];
  }

  ledgerVarianceRows(): ApiRecord[] {
    return (this.controlLedgerReport()?.['varianceRows'] || []) as ApiRecord[];
  }

  ledgerContainerRisks(): ApiRecord[] {
    return (this.controlLedgerReport()?.['containerRiskRows'] || []) as ApiRecord[];
  }

  ledgerLeakageRows(): ApiRecord[] {
    return (this.controlLedgerReport()?.['leakageRows'] || []) as ApiRecord[];
  }

  ledgerEvents(): ApiRecord[] {
    return (this.controlLedgerReport()?.['entityLedger'] || []) as ApiRecord[];
  }

  lineNeedsReason(line: ConsumeLine): boolean {
    const actualQty = Number(line.actualQty || 0);
    const expectedQty = Number(line.expectedQty || 0);
    const maxQty = Number(line.maxQty || 0);
    const overMax = maxQty > 0 && actualQty > maxQty;
    const overExpected = expectedQty > 0 && actualQty > expectedQty * 1.15;
    return (overMax || overExpected) && !String(line.reason || '').trim();
  }

  containerProgress(container: ApiRecord): number {
    const capacity = Number(container?.['capacityQty'] || 0);
    if (!capacity) return 0;
    return Math.max(0, Math.min(100, (Number(container?.['usedQty'] || 0) / capacity) * 100));
  }

  qty(value: number | string | undefined, unit: string | undefined): string {
    return `${Math.round(Number(value || 0) * 100) / 100} ${unit || ''}`.trim();
  }

  productStockUnit(product: ProductRow | ApiRecord): string {
    return String(product?.unit || product?.['stockUnit'] || product?.['stock_unit'] || 'pcs').toLowerCase();
  }

  productPackSize(product: ProductRow | ApiRecord): number {
    const configured = Number(product?.packSize || product?.['pack_size'] || 0);
    if (configured > 0) return configured;
    return this.productMeasureFromText(product).size;
  }

  productPackUnit(product: ProductRow | ApiRecord): string {
    const configured = String(product?.packUnit || product?.['pack_unit'] || '').toLowerCase();
    const normalized = this.comparableUnit(configured);
    const inferred = this.productMeasureFromText(product).unit;
    if (normalized && !this.sameUnit(normalized, this.productStockUnit(product))) return normalized;
    return inferred || normalized || this.productStockUnit(product);
  }

  productMeasureUnit(product: ProductRow | ApiRecord): string {
    const explicit = String(product?.packUnit || product?.['pack_unit'] || product?.['measureUnit'] || product?.['measure_unit'] || '').toLowerCase();
    if (explicit && !this.sameUnit(explicit, this.productStockUnit(product))) return this.comparableUnit(explicit);
    const inferred = this.productMeasureFromText(product).unit;
    if (inferred) return inferred;
    return this.productStockUnit(product);
  }

  productPackLabel(product: ProductRow | ApiRecord): string {
    const packSize = this.productPackSize(product);
    if (packSize <= 0 || this.sameUnit(this.productPackUnit(product), this.productStockUnit(product))) return '';
    return `1 ${this.productStockUnit(product)} = ${packSize} ${this.productPackUnit(product)}`;
  }

  linePackLabel(line: ConsumeLine): string {
    const packSize = Number(line.packSize || 0);
    if (packSize <= 0 || !line.stockUnit || !line.packUnit || this.sameUnit(line.stockUnit, line.packUnit)) return '';
    return `1 ${line.stockUnit} = ${packSize} ${line.packUnit}`;
  }

  defaultConsumeUnit(product: ProductRow | ApiRecord): string {
    const packSize = this.productPackSize(product);
    const measureUnit = this.productMeasureUnit(product);
    return packSize > 0 && !this.sameUnit(this.productPackUnit(product), this.productStockUnit(product)) ? this.productPackUnit(product) : measureUnit;
  }

  consumeUnitCost(product: ProductRow | ApiRecord, unit: string): number {
    const stockUnitCost = Number(product?.unitCost || product?.['costPrice'] || product?.['purchasePrice'] || 0);
    const packSize = this.productPackSize(product);
    if (packSize > 0 && this.sameUnit(unit, this.productPackUnit(product)) && !this.sameUnit(unit, this.productStockUnit(product))) {
      return Math.round((stockUnitCost / packSize) * 100) / 100;
    }
    return stockUnitCost;
  }

  consumeUnitCostForLine(line: ConsumeLine, unit: string): number {
    const stockUnitCost = Number(line.stockUnitCost || line.unitCost || 0);
    const packSize = Number(line.packSize || 0);
    if (packSize > 0 && this.sameUnit(unit, line.packUnit || '') && !this.sameUnit(unit, line.stockUnit || '')) {
      return Math.round((stockUnitCost / packSize) * 100) / 100;
    }
    return stockUnitCost;
  }

  private sameUnit(left: string, right: string): boolean {
    return this.comparableUnit(left) === this.comparableUnit(right);
  }

  private comparableUnit(unit: string): string {
    const normalized = String(unit || '').toLowerCase();
    if (['gm', 'gram', 'grams'].includes(normalized)) return 'g';
    if (['ltr', 'liter', 'litre', 'liters', 'litres'].includes(normalized)) return 'l';
    return normalized;
  }

  private productMeasureFromText(product: ProductRow | ApiRecord): { size: number; unit: string } {
    const text = `${product?.name || ''} ${product?.['sku'] || ''} ${product?.['category'] || ''}`.toLowerCase();
    const match = text.match(/(\d+(?:\.\d+)?)\s*(ml|gm|gram|grams|g|kg|ltr|liter|litre|liters|litres|l)\b/);
    if (!match) return { size: 0, unit: '' };
    return { size: Number(match[1] || 0), unit: this.comparableUnit(match[2] || '') };
  }

  money(value: number | string | undefined): string {
    return `₹${Math.round(Number(value || 0)).toLocaleString('en-IN')}`;
  }

  private persist(successMessage: string, request: any, unwrap = false): void {
    this.saving.set(true);
    this.error.set('');
    this.message.set('');
    request.subscribe({
      next: (response: ConsumeDraft | { draft: ConsumeDraft; backbarLedger?: ApiRecord }) => {
        const updated = unwrap ? (response as { draft: ConsumeDraft }).draft : response as ConsumeDraft;
        this.replaceDraft({ ...updated, lineItems: updated.lineItems || [] });
        if (unwrap && (response as { backbarLedger?: ApiRecord }).backbarLedger) {
          this.backbarLedger.set((response as { backbarLedger?: ApiRecord }).backbarLedger || null);
        } else {
          this.loadBackbarLedger(updated.id);
        }
        this.loadBackbarReport();
        this.loadBackbarDashboard();
        this.loadControlLedgerReport();
        this.loadStaffUsageAudit();
        this.message.set(successMessage);
        this.saving.set(false);
      },
      error: (err: any) => {
        this.error.set(err?.error?.error || err?.message || 'Product consume was not saved.');
        this.saving.set(false);
      }
    });
  }

  private patchSelected(mutator: (draft: ConsumeDraft) => ConsumeDraft): void {
    const id = this.selectedId();
    this.drafts.update((rows) => rows.map((row) => row.id === id ? mutator(row) : row));
  }

  private replaceDraft(updated: ConsumeDraft): void {
    this.drafts.update((rows) => rows.map((row) => row.id === updated.id ? updated : row));
  }
}
