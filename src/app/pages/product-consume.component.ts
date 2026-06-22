import { CommonModule } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ApiRecord, ApiService } from '../core/api.service';

interface ConsumeLine {
  productId: string;
  productName: string;
  unit: string;
  expectedQty: number;
  actualQty: number;
  wastagePct: number;
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

@Component({
  selector: 'app-product-consume',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  template: `
    <section class="page-stack">
      <div class="module-hero">
        <div>
          <span class="eyebrow">Inventory - service usage</span>
          <h1>Product Consume</h1>
          <p>Auto drafts come from POS invoices. Check quantity, then confirm to reduce stock.</p>
        </div>
        <div class="hero-actions">
          <a class="ghost" routerLink="/inventory/recipes">Service Recipes</a>
          <button type="button" class="primary" (click)="load()">Refresh</button>
        </div>
      </div>

      <div class="metric-grid">
        <article><span>Draft pending</span><strong>{{ draftCount() }}</strong><small>review before stock minus</small></article>
        <article><span>Confirmed</span><strong>{{ confirmedCount() }}</strong><small>stock ledger posted</small></article>
        <article><span>Expected cost</span><strong>{{ money(totalExpected()) }}</strong><small>recipe based</small></article>
        <article><span>Actual cost</span><strong>{{ money(totalActual()) }}</strong><small>edited consume value</small></article>
      </div>

      <section class="owner-report" *ngIf="backbarReport() as report">
        <div class="ledger-head">
          <div>
            <span class="eyebrow">Owner report</span>
            <h3>Backbar bulk control</h3>
          </div>
          <small>Open containers, adjustments, alerts and usage cost.</small>
        </div>
        <div class="owner-metrics">
          <article><span>Open</span><strong>{{ report['summary']?.openContainers || 0 }}</strong><small>in-use containers</small></article>
          <article><span>Paused</span><strong>{{ report['summary']?.pausedContainers || 0 }}</strong><small>manager override</small></article>
          <article><span>Adjustments</span><strong>{{ report['summary']?.adjustmentEntries || 0 }}</strong><small>waste/spill/expired</small></article>
          <article><span>Alerts</span><strong>{{ report['summary']?.openAlerts || 0 }}</strong><small>needs review</small></article>
          <article><span>Usage cost</span><strong>{{ money(report['summary']?.usageCost || 0) }}</strong><small>client + adjustment</small></article>
        </div>
      </section>

      <section class="owner-dashboard" *ngIf="backbarDashboard() as dashboard">
        <div class="ledger-head">
          <div>
            <span class="eyebrow">Owner dashboard</span>
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
          <article><span>Exceptions</span><strong>{{ money(dashboard['summary']?.exceptionCost || 0) }}</strong><small>waste/spill/adjust</small></article>
          <article><span>Alerts</span><strong>{{ dashboard['summary']?.advancedAlerts || 0 }}</strong><small>risk signals</small></article>
          <article><span>Approvals</span><strong>{{ dashboard['summary']?.pendingApprovals || 0 }}</strong><small>pending queue</small></article>
          <article><span>Actual profit</span><strong>{{ money(dashboard['summary']?.actualProfit || 0) }}</strong><small>after product cost</small></article>
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
            <span class="eyebrow">Control ledger reports</span>
            <h3>Every ml / gram report center</h3>
          </div>
          <small>Product, staff, client, service, waste, alert and approval reports.</small>
        </div>
        <div class="report-filters">
          <label><span>Branch</span><input [(ngModel)]="ledgerFilters.branchId" placeholder="Branch ID"></label>
          <label>
            <span>Product</span>
            <select [(ngModel)]="ledgerFilters.productId">
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
        </div>
        <div class="owner-metrics">
          <article><span>Products</span><strong>{{ report['summary']?.products || 0 }}</strong><small>tracked</small></article>
          <article><span>Staff</span><strong>{{ report['summary']?.staff || 0 }}</strong><small>accountability</small></article>
          <article><span>Clients</span><strong>{{ report['summary']?.clients || 0 }}</strong><small>history linked</small></article>
          <article><span>Usage cost</span><strong>{{ money(report['summary']?.usageCost || 0) }}</strong><small>client + exceptions</small></article>
          <article><span>Waste cost</span><strong>{{ money(report['summary']?.exceptionCost || 0) }}</strong><small>waste/adjustment</small></article>
        </div>
        <div class="owner-metrics">
          <article><span>Variance</span><strong>{{ report['summary']?.varianceRows || 0 }}</strong><small>expected vs actual</small></article>
          <article><span>Open-age risk</span><strong>{{ report['summary']?.containerRisks || 0 }}</strong><small>old/low/expiry</small></article>
          <article><span>Leakage risk</span><strong>{{ report['summary']?.leakageRisks || 0 }}</strong><small>stock mismatch</small></article>
          <article><span>Approvals</span><strong>{{ report['summary']?.pendingApprovals || 0 }}</strong><small>pending</small></article>
          <article><span>Alerts</span><strong>{{ report['summary']?.alerts || 0 }}</strong><small>open</small></article>
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
              <span>{{ row['lastUsedAt'] | date:'short' }}</span>
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
        <div class="report-feed">
          <article *ngFor="let event of ledgerEvents().slice(0, 8)">
            <strong>{{ event['title'] || event['entityType'] }}</strong>
            <span>{{ event['detail'] || event['entityId'] }}</span>
            <small>{{ event['entityType'] }} · {{ event['eventAt'] | date:'short' }}</small>
          </article>
        </div>
      </section>

      <section class="staff-audit" *ngIf="staffUsageAudit() as audit">
        <div class="ledger-head">
          <div>
            <span class="eyebrow">Staff usage audit</span>
            <h3>Product consume accountability</h3>
          </div>
          <small>Confirmed invoice consume lines plus backbar exceptions.</small>
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
          <article><span>Staff</span><strong>{{ audit['summary']?.staffCount || 0 }}</strong><small>with usage</small></article>
          <article><span>Consume lines</span><strong>{{ audit['summary']?.totalProductLines || 0 }}</strong><small>confirmed invoices</small></article>
          <article><span>Usage value</span><strong>{{ money(audit['summary']?.totalUsageCost || 0) }}</strong><small>product cost</small></article>
          <article><span>Adjustments</span><strong>{{ audit['summary']?.adjustmentCount || 0 }}</strong><small>waste/spill/manual</small></article>
          <article><span>Exceptions</span><strong>{{ audit['summary']?.exceptionCount || 0 }}</strong><small>owner review</small></article>
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
              <span>{{ row['lastUsedAt'] | date:'short' }}</span>
            </div>
          </div>
          <ng-template #noStaffAudit>
            <p class="ledger-empty">Confirmed consume ke baad staff-wise product usage yahan dikhega.</p>
          </ng-template>
          <div class="audit-feed">
            <h4>Recent usage</h4>
            <article *ngFor="let entry of auditRecentEntries().slice(0, 6)">
              <strong>{{ entry['staffName'] || 'Unassigned' }} · {{ entry['productName'] || entry['productId'] }}</strong>
              <span>{{ entry['invoiceNumber'] || entry['source'] }} · {{ entry['clientName'] || 'Walk-in client' }} · {{ qty(entry['quantity'], entry['unit']) }} · {{ money(entry['cost'] || 0) }}</span>
              <small>{{ entry['serviceName'] || 'Service' }} · {{ entry['usedAt'] | date:'short' }}</small>
            </article>
            <h4 *ngIf="auditExceptions().length">Exceptions</h4>
            <article class="exception" *ngFor="let entry of auditExceptions().slice(0, 4)">
              <strong>{{ entry['exceptionType'] || entry['source'] }}</strong>
              <span>{{ entry['staffName'] || 'Manager override' }} · {{ entry['productName'] || entry['productId'] }} · {{ entry['reason'] || 'Review required' }}</span>
              <small>{{ entry['usedAt'] | date:'short' }}</small>
            </article>
          </div>
        </div>
      </section>

      <div *ngIf="error()" class="alert">{{ error() }}</div>
      <div *ngIf="message()" class="success">{{ message() }}</div>

      <div class="workspace">
        <aside class="draft-list">
          <div class="list-head">
            <strong>Invoice drafts</strong>
            <select [ngModel]="statusFilter()" (ngModelChange)="setStatus($event)">
              <option value="">All</option>
              <option value="draft">Draft</option>
              <option value="recipe_missing">Recipe missing</option>
              <option value="confirmed">Confirmed</option>
            </select>
          </div>
          <button
            type="button"
            class="draft-card"
            *ngFor="let draft of drafts()"
            [class.active]="draft.id === selectedId()"
            (click)="select(draft)"
          >
            <span class="badge" [class.done]="draft.status === 'confirmed'">{{ draft.status }}</span>
            <strong>{{ draft.invoiceNumber || draft.id }}</strong>
            <small>{{ draft.serviceName }} - {{ draft.clientName || 'Walk-in client' }}</small>
            <em>{{ money(draft.actualCost || draft.expectedCost) }}</em>
          </button>
          <p *ngIf="!loading() && !drafts().length" class="empty">No product consume draft found.</p>
          <p *ngIf="loading()" class="empty">Loading...</p>
        </aside>

        <section class="editor" *ngIf="selected() as draft; else noSelection">
          <div class="editor-head">
            <div>
              <span class="eyebrow">Consume draft</span>
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

          <div class="consume-table">
            <div class="row head">
              <span>Product</span><span>Auto qty / unit</span><span>Waste</span><span>Range</span><span>Reason</span><span>Substitutes</span><span>Cost</span>
            </div>
            <div class="row" *ngFor="let line of draft.lineItems; let i = index">
              <span><strong>{{ line.productName || line.productId }}</strong><small>{{ line.unitCost | number:'1.2-2' }} / {{ line.unit }}<ng-container *ngIf="linePackLabel(line)"> · {{ linePackLabel(line) }}</ng-container></small></span>
              <span class="qty-unit">
                <input type="number" min="0" step="0.01" [ngModel]="line.actualQty" (ngModelChange)="updateQty(i, $event)" [disabled]="draft.status === 'confirmed'">
                <select [ngModel]="line.unit" (ngModelChange)="updateLine(i, { unit: $event })" [disabled]="draft.status === 'confirmed'">
                  <option *ngFor="let unit of units" [value]="unit">{{ unit }}</option>
                </select>
              </span>
              <span><input type="number" min="0" step="0.01" [ngModel]="line.wastagePct || 0" (ngModelChange)="updateLine(i, { wastagePct: $event })" [disabled]="draft.status === 'confirmed'"></span>
              <span class="range-fields">
                <input type="number" min="0" step="0.01" placeholder="Min" [ngModel]="line.minQty || 0" (ngModelChange)="updateLine(i, { minQty: $event })" [disabled]="draft.status === 'confirmed'">
                <input type="number" min="0" step="0.01" placeholder="Max" [ngModel]="line.maxQty || 0" (ngModelChange)="updateLine(i, { maxQty: $event })" [disabled]="draft.status === 'confirmed'">
              </span>
              <span><input [class.reason-needed]="lineNeedsReason(line)" [ngModel]="line.reason || ''" (ngModelChange)="updateLine(i, { reason: $event })" placeholder="Required if overuse" [disabled]="draft.status === 'confirmed'"></span>
              <span><input [ngModel]="line.substitutes || ''" (ngModelChange)="updateLine(i, { substitutes: $event })" placeholder="Alternate product ids/name" [disabled]="draft.status === 'confirmed'"></span>
              <span>{{ money(lineActualCost(line)) }}</span>
            </div>
          </div>

          <section class="backbar-ledger" *ngIf="ledgerProducts().length">
            <div class="ledger-head">
              <div>
                <span class="eyebrow">Backbar control</span>
                <h3>Open container ledger</h3>
              </div>
              <small>Tube, bottle, jar aur can pehle zero honge, phir next container open hoga.</small>
            </div>
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
                <p class="ledger-empty">Confirm consume ke baad client-wise container history yahan dikhegi.</p>
              </ng-template>
            </article>
          </section>

          <div class="manual-product-add" *ngIf="draft.status !== 'confirmed'">
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
              <input type="number" min="0" step="0.01" [(ngModel)]="productForm.wastagePct">
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
          </div>

          <label class="notes">
            <span>Notes</span>
            <textarea rows="3" [ngModel]="draft.notes || ''" (ngModelChange)="updateNotes($event)" [disabled]="draft.status === 'confirmed'"></textarea>
          </label>

          <div class="action-row">
            <button type="button" class="ghost" (click)="saveDraft()" [disabled]="saving() || draft.status === 'confirmed'">Save draft</button>
            <button type="button" class="primary" (click)="confirmDraft()" [disabled]="saving() || draft.status !== 'draft' || !draft.lineItems.length">Confirm consume</button>
          </div>
        </section>
        <ng-template #noSelection>
          <section class="editor empty-editor">Select invoice draft to edit product consumption.</section>
        </ng-template>
      </div>
    </section>
  `,
  styles: [`
    .page-stack { display: grid; gap: 18px; }
    .module-hero, .workspace, .metric-grid article, .editor, .draft-list { background: rgba(255,255,255,.92); border: 1px solid #dcebea; box-shadow: 0 18px 45px rgba(15,23,42,.08); }
    .module-hero { display: flex; justify-content: space-between; gap: 16px; align-items: center; padding: 24px; border-radius: 22px; }
    .module-hero h1, .editor h2 { margin: 4px 0; color: #111827; }
    .module-hero p { margin: 0; color: #64748b; }
    .eyebrow { color: #0f766e; font-size: 12px; font-weight: 900; letter-spacing: .08em; text-transform: uppercase; }
    .hero-actions, .action-row { display: flex; gap: 10px; flex-wrap: wrap; }
    button, a.ghost { border: 1px solid #d7e6e4; border-radius: 14px; padding: 12px 16px; font-weight: 900; text-decoration: none; cursor: pointer; }
    .primary { background: #0f172a; color: white; }
    .ghost { background: white; color: #0f172a; }
    button:disabled { opacity: .55; cursor: not-allowed; }
    .metric-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; }
    .metric-grid article { border-radius: 18px; padding: 16px; display: grid; gap: 5px; }
    .metric-grid span, .info-grid span, .consume-table .head { color: #64748b; font-size: 12px; font-weight: 900; text-transform: uppercase; }
    .metric-grid strong { font-size: 24px; }
    .metric-grid small, .draft-card small, .consume-table small { color: #64748b; }
    .workspace { display: grid; grid-template-columns: 340px 1fr; border-radius: 22px; overflow: hidden; }
    .draft-list { border: 0; border-right: 1px solid #dcebea; box-shadow: none; padding: 14px; display: grid; gap: 10px; align-content: start; max-height: 72vh; overflow: auto; }
    .list-head, .editor-head { display: flex; justify-content: space-between; gap: 12px; align-items: center; }
    select, input, textarea { width: 100%; border: 1px solid #d7e6e4; border-radius: 12px; padding: 10px; font: inherit; }
    .draft-card { text-align: left; background: white; display: grid; gap: 5px; }
    .draft-card.active { background: #e8f4f2; border-color: #14b8a6; }
    .badge { width: max-content; border-radius: 999px; padding: 5px 10px; background: #fff7ed; color: #9a3412; font-size: 12px; font-weight: 900; }
    .badge.done { background: #dcfce7; color: #166534; }
    .editor { border: 0; box-shadow: none; padding: 18px; display: grid; gap: 16px; }
    .info-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; }
    .info-grid label { border: 1px solid #dcebea; border-radius: 14px; padding: 12px; display: grid; gap: 6px; }
    .consume-table { border: 1px solid #dcebea; border-radius: 16px; overflow: auto; }
    .row { display: grid; grid-template-columns: 1.6fr 1.1fr .7fr 1.1fr 1.3fr 1.4fr .75fr; gap: 12px; align-items: center; padding: 12px; border-bottom: 1px solid #edf4f3; min-width: 1120px; }
    .row:last-child { border-bottom: 0; }
    .qty-unit, .range-fields { display: grid; grid-template-columns: 1fr 86px; gap: 8px; }
    .range-fields { grid-template-columns: 1fr 1fr; }
    .backbar-ledger { border: 1px solid #dcebea; border-radius: 16px; padding: 14px; display: grid; gap: 12px; background: #f8fbfa; }
    .owner-report { border: 1px solid #dcebea; border-radius: 18px; padding: 16px; display: grid; gap: 12px; background: #fff; box-shadow: 0 18px 45px rgba(15,23,42,.08); }
    .owner-dashboard { border: 1px solid #dcebea; border-radius: 18px; padding: 16px; display: grid; gap: 12px; background: #fff; box-shadow: 0 18px 45px rgba(15,23,42,.08); }
    .control-report { border: 1px solid #dcebea; border-radius: 18px; padding: 16px; display: grid; gap: 12px; background: #fff; box-shadow: 0 18px 45px rgba(15,23,42,.08); }
    .staff-audit { border: 1px solid #dcebea; border-radius: 18px; padding: 16px; display: grid; gap: 12px; background: #fff; box-shadow: 0 18px 45px rgba(15,23,42,.08); }
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
    .report-filters { display: grid; grid-template-columns: .9fr 1.4fr .9fr .9fr .7fr .7fr auto; gap: 10px; align-items: end; }
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
    .risk-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; }
    .risk-grid > article { border: 1px solid #dcebea; border-radius: 12px; padding: 12px; display: grid; gap: 8px; background: #fff; }
    .risk-grid h4 { margin: 0; }
    .risk-row { border: 1px solid #edf4f3; border-radius: 10px; padding: 9px; display: grid; gap: 3px; background: #f8fbfa; }
    .risk-row.high { background: #fff1f2; border-color: #fecdd3; }
    .risk-row span, .risk-row small, .risk-grid > article > small { color: #64748b; }
    .ledger-head, .ledger-summary, .active-container { display: flex; justify-content: space-between; gap: 12px; align-items: center; }
    .ledger-head h3 { margin: 2px 0 0; }
    .ledger-head small, .ledger-product small, .ledger-summary span, .history-row span { color: #64748b; }
    .ledger-product { background: white; border: 1px solid #dcebea; border-radius: 14px; padding: 12px; display: grid; gap: 10px; }
    .ledger-summary { display: grid; grid-template-columns: 1.6fr repeat(3, minmax(90px, .5fr)); }
    .ledger-summary div { display: grid; gap: 4px; }
    .active-container { align-items: start; border: 1px dashed #9bd8cf; border-radius: 12px; padding: 10px; background: #ecfdf5; }
    .progress { height: 9px; min-width: 160px; border-radius: 999px; overflow: hidden; background: #d7e6e4; }
    .progress i { display: block; height: 100%; border-radius: inherit; background: #0f766e; }
    .ledger-alerts { display: flex; flex-wrap: wrap; gap: 8px; }
    .ledger-actions { display: grid; grid-template-columns: .8fr .7fr 1fr auto; gap: 8px; align-items: center; }
    .ledger-actions.override { grid-template-columns: 1fr auto; }
    .mini-alert { border-radius: 999px; background: #e0f2fe; color: #075985; padding: 6px 10px; font-size: 12px; font-weight: 900; }
    .mini-alert.high { background: #fee2e2; color: #991b1b; }
    .ledger-history { display: grid; gap: 6px; }
    .history-row { display: grid; grid-template-columns: 1.2fr 1.4fr .8fr .8fr; gap: 10px; padding: 8px 0; border-top: 1px solid #edf4f3; }
    .ledger-empty { margin: 0; color: #64748b; }
    .notes { display: grid; gap: 8px; }
    .manual-product-add { display: grid; grid-template-columns: minmax(260px, 2fr) .7fr .7fr .7fr .7fr .7fr 1.2fr auto; gap: 10px; align-items: end; }
    .manual-product-add label { display: grid; gap: 6px; }
    .manual-product-add span { color: #64748b; font-size: 12px; font-weight: 900; text-transform: uppercase; }
    .product-picker { position: relative; }
    .product-results { position: absolute; left: 0; right: 0; top: 72px; z-index: 5; max-height: 260px; overflow: auto; background: white; border: 1px solid #cfe1df; border-radius: 14px; box-shadow: 0 18px 45px rgba(15,23,42,.18); padding: 6px; }
    .product-results button { width: 100%; display: grid; grid-template-columns: 1fr auto; gap: 10px; align-items: center; text-align: left; padding: 10px 12px; border: 0; border-radius: 10px; background: white; }
    .product-results button:hover { background: #e8f4f2; }
    .product-results small, .selected-stock { color: #0f766e; font-weight: 900; }
    .reason-needed { border-color: #f97316; background: #fff7ed; }
    .alert, .success { border-radius: 14px; padding: 12px 16px; font-weight: 800; }
    .alert { background: #fee2e2; color: #991b1b; }
    .success { background: #dcfce7; color: #166534; }
    .empty, .empty-editor { color: #64748b; padding: 18px; }
    @media (max-width: 900px) {
      .module-hero, .workspace { display: grid; }
      .metric-grid, .info-grid, .owner-metrics { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .audit-filters, .audit-layout, .dashboard-layout, .report-filters, .report-grid, .report-feed, .risk-grid { grid-template-columns: 1fr; }
      .ledger-summary, .history-row, .ledger-actions, .ledger-actions.override { grid-template-columns: 1fr 1fr; }
      .active-container { display: grid; }
      .manual-product-add { grid-template-columns: 1fr; }
      .draft-list { border-right: 0; border-bottom: 1px solid #dcebea; max-height: 360px; }
    }
    @media (max-width: 560px) {
      .metric-grid, .info-grid { grid-template-columns: 1fr; }
      .module-hero { padding: 18px; }
    }
  `]
})
export class ProductConsumeComponent {
  private readonly api = inject(ApiService);

  readonly drafts = signal<ConsumeDraft[]>([]);
  readonly selectedId = signal('');
  readonly loading = signal(false);
  readonly saving = signal(false);
  readonly error = signal('');
  readonly message = signal('');
  readonly statusFilter = signal('');
  readonly products = signal<ProductRow[]>([]);
  readonly backbarLedger = signal<ApiRecord | null>(null);
  readonly backbarReport = signal<ApiRecord | null>(null);
  readonly backbarDashboard = signal<ApiRecord | null>(null);
  readonly controlLedgerReport = signal<ApiRecord | null>(null);
  readonly staffUsageAudit = signal<ApiRecord | null>(null);
  readonly units = RECIPE_UNITS;
  productForm = { productId: '', qty: 1, unit: 'pcs', wastagePct: 0, minQty: 0, maxQty: 0, substitutes: '' };
  adjustForm = { quantity: 0, usageType: 'spillage', reason: '' };
  auditFilters = { branchId: '', staffId: '', startDate: '', endDate: '' };
  ledgerFilters = { branchId: '', productId: '', staffId: '', usageType: '', startDate: '', endDate: '' };
  overrideReason = '';
  dashboardPeriod = 'daily';
  productQuery = '';
  productPickerOpen = false;
  readonly selected = computed(() => this.drafts().find((draft) => draft.id === this.selectedId()) || null);
  readonly draftCount = computed(() => this.drafts().filter((draft) => draft.status !== 'confirmed').length);
  readonly confirmedCount = computed(() => this.drafts().filter((draft) => draft.status === 'confirmed').length);
  readonly totalExpected = computed(() => this.drafts().reduce((sum, draft) => sum + Number(draft.expectedCost || 0), 0));
  readonly totalActual = computed(() => this.drafts().reduce((sum, draft) => sum + Number(draft.actualCost || draft.expectedCost || 0), 0));

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
    this.loadBackbarLedger(draft.id);
  }

  updateQty(index: number, value: string | number): void {
    this.patchSelected((draft) => {
      const lineItems = [...draft.lineItems];
      const line = { ...lineItems[index], actualQty: Number(value || 0) };
      line.actualCost = this.lineActualCost(line);
      lineItems[index] = line;
      return { ...draft, lineItems, actualCost: lineItems.reduce((sum, item) => sum + this.lineActualCost(item), 0) };
    });
  }

  updateNotes(notes: string): void {
    this.patchSelected((draft) => ({ ...draft, notes }));
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
      line.wastagePct = Number(line.wastagePct || 0);
      line.minQty = Number(line.minQty || 0);
      line.maxQty = Number(line.maxQty || 0);
      line.actualCost = this.lineActualCost(line);
      lineItems[index] = line;
      return { ...draft, lineItems, actualCost: lineItems.reduce((sum, item) => sum + this.lineActualCost(item), 0) };
    });
  }

  addProductLine(): void {
    const product = this.products().find((row) => row.id === this.productForm.productId);
    const qty = Number(this.productForm.qty || 0);
    if (!product || qty <= 0) {
      this.error.set('Select a product and keep quantity above 0.');
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
      wastagePct: Number(this.productForm.wastagePct || 0),
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
    this.productForm = { productId: '', qty: 1, unit: 'pcs', wastagePct: 0, minQty: 0, maxQty: 0, substitutes: '' };
    this.message.set('Product line added. Save draft or confirm consume.');
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
    this.persist('Product consume confirmed. Backbar ledger updated.', this.api.post<{ draft: ConsumeDraft; backbarLedger?: ApiRecord }>(`inventory-intelligence/product-consume-drafts/${draft.id}/confirm`, {
      lineItems: draft.lineItems,
      notes: draft.notes || ''
    }), true);
  }

  loadBackbarLedger(draftId: string): void {
    this.api.list<ApiRecord>(`inventory-intelligence/product-consume-drafts/${draftId}/backbar-ledger`).subscribe({
      next: (ledger) => this.backbarLedger.set(ledger || null),
      error: () => this.backbarLedger.set(null)
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

  ledgerProducts(): ApiRecord[] {
    return (this.backbarLedger()?.['products'] || []) as ApiRecord[];
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

  ledgerServiceRows(): ApiRecord[] {
    return (this.controlLedgerReport()?.['serviceRows'] || []) as ApiRecord[];
  }

  ledgerStaffRows(): ApiRecord[] {
    return (this.controlLedgerReport()?.['staffRows'] || []) as ApiRecord[];
  }

  ledgerWasteRows(): ApiRecord[] {
    return (this.controlLedgerReport()?.['wasteRows'] || []) as ApiRecord[];
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
