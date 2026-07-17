import { CommonModule } from '@angular/common';
import { Component, OnInit, computed, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { catchError, finalize, forkJoin, of } from 'rxjs';
import { AuthSessionService } from '../core/auth-session.service';
import { grantsAllow, staticGrantsForRole } from '../core/permission.guard';
import { routePermissionForPath } from '../core/access-rules';
import { AppStateService } from '../core/state/app-state.service';
import { ApiRecord, ApiService } from '../core/api.service';
import { StateComponent } from '../shared/ui/state/state.component';
import { AuraMoneyPipe } from '../shared/pipes/aura-money.pipe';

type ReportColumn = { key: string; label: string; type?: 'currency' | 'number' | 'percent' | 'date' | 'badge' };
type ReportDefinition = { id: string; title: string; description: string; badge: string };
type DueRecoveryReport = { summary: ApiRecord; rows: ApiRecord[] };
type ServiceTrendsReport = { summary: ApiRecord; rows: ApiRecord[] };
type ServiceClientsReport = { summary: ApiRecord; rows: ApiRecord[] };
type InvoiceActivityReport = { summary?: ApiRecord; exportRows?: ApiRecord[]; deletedInvoiceReport?: ApiRecord[]; generatedAt?: string };
type SaleSummary = {
  totalBill: number;
  billAverage: number;
  totalSale: number;
  receivedAmount: number;
  pendingAmount: number;
  prepaidPayment: number;
  returnSales: number;
  totalTipAmount: number;
  totalTax: number;
};

type ProductSalesSummary = {
  totalProduct: number;
  productsSale: number;
  taxOnProducts: number;
  taxableAmount: number;
  discount: number;
  productsSaleAfterDiscount: number;
  cogs: number;
  grossMargin: number;
  averageMarginPercent: number;
  lowStockItems: number;
  lowMarginItems: number;
  repeatBuyerRows: number;
  reorderSuggestions: number;
};

type SalesDiscountSummary = {
  totalInvoices: number;
  grossSale: number;
  totalDiscount: number;
  discountRate: number;
  netSale: number;
  manualDiscount: number;
  couponDiscount: number;
  membershipLoyaltyDiscount: number;
  highRiskInvoices: number;
  marginLossAlerts: number;
};

type InvoiceLine = {
  invoiceId: string;
  invoiceNumber: string;
  date: string;
  branchId: string;
  branchName: string;
  clientId: string;
  clientName: string;
  clientPhone: string;
  staffId: string;
  staffName: string;
  productId: string;
  productSku: string;
  productBarcode: string;
  productCategory: string;
  productBrand: string;
  productStock: number;
  productLowStockThreshold: number;
  productUnitCost: number;
  productBatchNumber: string;
  productExpiryDate: string;
  itemName: string;
  itemType: string;
  quantity: number;
  rate: number;
  gross: number;
  discount: number;
  taxable: number;
  gstRate: number;
  gst: number;
  final: number;
  paid: number;
  due: number;
  status: string;
  paymentModes: string;
  addedBy: string;
  couponCode: string;
  couponDiscount: number;
  loyaltyDiscount: number;
  membershipDiscount: number;
  prepaidAmount: number;
  tipAmount: number;
};

@Component({
  selector: 'app-invoice-reports',
  standalone: true,
  imports: [AuraMoneyPipe, CommonModule, FormsModule, RouterLink, StateComponent],
  template: `
    <section class="page-stack inner-page-shell">
      <div class="module-hero invoice-report-hero inner-page-header">
        <div>
          <h2>10x Enterprise Invoice Reports</h2>
        </div>
        <div class="hero-actions inner-action-bar">
          <a class="ghost-button" routerLink="/pos/invoices" *ngIf="canAccessPath('/pos/invoices')">POS invoices</a>
          <a class="ghost-button" routerLink="/pos/invoice-activity">Invoice activity</a>
          <a class="ghost-button" routerLink="/reports">Reports</a>
          <button class="primary-button" type="button" (click)="load()">Refresh</button>
        </div>
      </div>

      <section class="panel report-filter-panel inner-page-card">
        <label class="field">
          <span>From</span>
          <input type="date" [(ngModel)]="from" />
        </label>
        <label class="field">
          <span>To</span>
          <input type="date" [(ngModel)]="to" />
        </label>
        <label class="field">
          <span>Status</span>
          <select [(ngModel)]="status">
            <option value="">All</option>
            <option value="paid">Paid</option>
            <option value="partial">Partial</option>
            <option value="unpaid">Unpaid / due</option>
          </select>
        </label>
        <label class="field">
          <span>Client</span>
          <select [(ngModel)]="clientFilter">
            <option value="">All clients</option>
            <option *ngFor="let client of clientFilterOptions()" [value]="client.id">{{ client.label }}</option>
          </select>
        </label>
        <label class="field">
          <span>Branch</span>
          <select [(ngModel)]="branchFilter">
            <option value="">Header branch / all</option>
            <option *ngFor="let branch of branchFilterOptions()" [value]="branch.id">{{ branch.label }}</option>
          </select>
        </label>
        <label class="field">
          <span>Staff</span>
          <select [(ngModel)]="staffFilter">
            <option value="">All staff</option>
            <option *ngFor="let staff of staffFilterOptions()" [value]="staff.id">{{ staff.label }}</option>
          </select>
        </label>
        <label class="field">
          <span>Recovery status</span>
          <select [(ngModel)]="recoveryStatus">
            <option value="all">All due/recovered</option>
            <option value="pending">Pending due</option>
            <option value="partial">Partial recovered</option>
            <option value="recovered">Recovered</option>
          </select>
        </label>
        <label class="field">
          <span>Aging bucket</span>
          <select [(ngModel)]="agingBucket">
            <option value="">All buckets</option>
            <option value="0-10">0-10 days</option>
            <option value="11-20">11-20 days</option>
            <option value="21+">21+ days</option>
            <option value="0-7 days">0-7 days</option>
            <option value="8-15 days">8-15 days</option>
            <option value="16-30 days">16-30 days</option>
            <option value="30+ days">30+ days</option>
          </select>
        </label>
        <label class="field">
          <span>Payment mode</span>
          <select [(ngModel)]="paymentModeFilter">
            <option value="">All modes</option>
            <option *ngFor="let mode of paymentModeOptions()" [value]="mode.id">{{ mode.label }}</option>
          </select>
        </label>
        <label class="field">
          <span>Received by</span>
          <select [(ngModel)]="receivedByFilter">
            <option value="">All receivers</option>
            <option *ngFor="let receiver of receivedByOptions()" [value]="receiver.id">{{ receiver.label }}</option>
          </select>
        </label>
        <label class="field">
          <span>Recovery owner</span>
          <select [(ngModel)]="recoveryOwnerFilter">
            <option value="">All owners</option>
            <option *ngFor="let owner of recoveryOwnerOptions()" [value]="owner.id">{{ owner.label }}</option>
          </select>
        </label>
        <label class="field">
          <span>Follow-up status</span>
          <select [(ngModel)]="followUpStatusFilter">
            <option value="">All follow-ups</option>
            <option value="reminder_stage">Reminder stage</option>
            <option value="call_pending">Call pending</option>
            <option value="call_done">Call done</option>
            <option value="daily_due">Daily due</option>
            <option value="daily_done">Daily done</option>
            <option value="follow_up_note">Note added</option>
            <option value="recovered">Recovered</option>
          </select>
        </label>
        <label class="field span-2">
          <span>Search</span>
          <input [(ngModel)]="query" [placeholder]="searchPlaceholder()" />
        </label>
        <div class="branch-context-card">
          <span>Header branch</span>
          <strong>{{ branchLabel() }}</strong>
        </div>
        <button class="primary-button" type="button" (click)="load()">Apply</button>
      </section>

      <section class="panel product-advanced-filter-panel" *ngIf="activeReport() === 'products'">
        <label class="field">
          <span>Product</span>
          <select [(ngModel)]="productFilter">
            <option value="">All products</option>
            <option *ngFor="let product of productFilterOptions()" [value]="product.id">{{ product.label }}</option>
          </select>
        </label>
        <label class="field">
          <span>Brand</span>
          <select [(ngModel)]="productBrandFilter">
            <option value="">All brands</option>
            <option *ngFor="let brand of productBrandOptions()" [value]="brand.id">{{ brand.label }}</option>
          </select>
        </label>
        <label class="field">
          <span>Category</span>
          <select [(ngModel)]="productCategoryFilter">
            <option value="">All categories</option>
            <option *ngFor="let category of productCategoryOptions()" [value]="category.id">{{ category.label }}</option>
          </select>
        </label>
        <label class="field">
          <span>GST rate</span>
          <select [(ngModel)]="gstRateFilter">
            <option value="">All GST rates</option>
            <option *ngFor="let gst of gstRateOptions()" [value]="gst.id">{{ gst.label }}</option>
          </select>
        </label>
        <label class="field">
          <span>Margin health</span>
          <select [(ngModel)]="marginHealthFilter">
            <option value="">All margins</option>
            <option value="low">Low / negative margin</option>
            <option value="healthy">Healthy margin</option>
            <option value="unknown">Cost missing</option>
          </select>
        </label>
        <label class="field">
          <span>Inventory signal</span>
          <select [(ngModel)]="inventorySignalFilter">
            <option value="">All stock signals</option>
            <option value="Stockout risk">Stockout risk</option>
            <option value="Low stock">Low stock</option>
            <option value="Healthy">Healthy</option>
            <option value="Unmapped">Unmapped</option>
          </select>
        </label>
      </section>

      <section class="panel product-advanced-filter-panel service-trends-filter-panel" *ngIf="isServiceReport()">
        <label class="field">
          <span>Service group</span>
          <select [(ngModel)]="serviceGroupFilter">
            <option value="">All groups</option>
            <option *ngFor="let group of serviceGroupOptions()" [value]="group.id">{{ group.label }}</option>
          </select>
        </label>
        <label class="field">
          <span>Service</span>
          <select [(ngModel)]="serviceTrendFilter">
            <option value="">All services</option>
            <option *ngFor="let service of serviceTrendOptions()" [value]="service.id">{{ service.label }}</option>
          </select>
        </label>
        <label class="field">
          <span>GST rate</span>
          <select [(ngModel)]="serviceGstRateFilter">
            <option value="">All GST rates</option>
            <option *ngFor="let gst of serviceGstRateOptions()" [value]="gst.id">{{ gst.label }}</option>
          </select>
        </label>
        <label class="field">
          <span>Revenue bucket</span>
          <select [(ngModel)]="serviceRevenueBucketFilter">
            <option value="">All revenue</option>
            <option value="10000+">₹10,000+</option>
            <option value="5000-9999">₹5,000 - ₹9,999</option>
            <option value="1000-4999">₹1,000 - ₹4,999</option>
            <option value="0-999">Below ₹1,000</option>
          </select>
        </label>
        <label class="field">
          <span>Margin bucket</span>
          <select [(ngModel)]="serviceMarginBucketFilter">
            <option value="">All margins</option>
            <option value="healthy">Healthy</option>
            <option value="low">Low margin</option>
            <option value="negative">Negative margin</option>
            <option value="missing">Cost missing</option>
          </select>
        </label>
        <label class="field">
          <span>Quantity bucket</span>
          <select [(ngModel)]="serviceQuantityBucketFilter">
            <option value="">All quantities</option>
            <option value="50+">50+</option>
            <option value="20-49">20 - 49</option>
            <option value="5-19">5 - 19</option>
            <option value="1-4">1 - 4</option>
          </select>
        </label>
        <label class="field">
          <span>Time bucket</span>
          <select [(ngModel)]="serviceTimeBucketFilter">
            <option value="">All time</option>
            <option value="morning">Morning</option>
            <option value="afternoon">Afternoon</option>
            <option value="evening">Evening</option>
          </select>
        </label>
        <label class="field" *ngIf="activeReport() === 'service-clients'">
          <span>Sale type</span>
          <select [(ngModel)]="serviceSaleTypeFilter">
            <option value="">All sale types</option>
            <option value="Appointment">Appointment</option>
            <option value="Quick Sale">Quick Sale</option>
          </select>
        </label>
        <label class="field">
          <span>Sort</span>
          <select [(ngModel)]="serviceSort">
            <option value="revenue_desc">Revenue high-low</option>
            <option value="quantity_desc">Quantity high-low</option>
            <option value="margin_desc">Margin high-low</option>
            <option value="latest_sold">Latest sold</option>
          </select>
        </label>
      </section>

      <section class="panel product-advanced-filter-panel discount-advanced-filter-panel" *ngIf="activeReport() === 'sales-discount-intelligence'">
        <label class="field">
          <span>Discount type</span>
          <select [(ngModel)]="discountTypeFilter">
            <option value="">All discount sources</option>
            <option value="manual">Manual discount</option>
            <option value="coupon">Coupon discount</option>
            <option value="membership">Membership / loyalty</option>
            <option value="package">Package benefit</option>
            <option value="owner">Owner approved</option>
          </select>
        </label>
        <label class="field">
          <span>Coupon code</span>
          <select [(ngModel)]="couponCodeFilter">
            <option value="">All coupons</option>
            <option *ngFor="let coupon of couponCodeOptions()" [value]="coupon.id">{{ coupon.label }}</option>
          </select>
        </label>
        <label class="field">
          <span>Service / product</span>
          <select [(ngModel)]="serviceProductFilter">
            <option value="">All services/products</option>
            <option *ngFor="let item of serviceProductOptions()" [value]="item.id">{{ item.label }}</option>
          </select>
        </label>
        <label class="field">
          <span>Discount % bucket</span>
          <select [(ngModel)]="discountBucketFilter">
            <option value="">All buckets</option>
            <option value="0-5">0-5%</option>
            <option value="5-10">5-10%</option>
            <option value="10-20">10-20%</option>
            <option value="20+">20%+</option>
          </select>
        </label>
        <label class="field">
          <span>Risk</span>
          <select [(ngModel)]="discountRiskFilter">
            <option value="">All risk</option>
            <option value="normal">Normal</option>
            <option value="review">Review</option>
            <option value="high">High</option>
            <option value="critical">Critical</option>
          </select>
        </label>
      </section>

      <app-state [loading]="loading()" [error]="error()"></app-state>
      <div class="state success" *ngIf="notice()">{{ notice() }}</div>

      <ng-container *ngIf="!loading() && !error()">
        <div class="metrics-grid invoice-report-kpis" *ngIf="activeReport() === 'sale-summary'; else defaultInvoiceKpis">
          <article class="metric-card"><span>Total Bill</span><strong>{{ saleSummary().totalBill }}</strong></article>
          <article class="metric-card"><span>Bill Average</span><strong>{{ saleSummary().billAverage | auraMoney:'1.0-0' }}</strong></article>
          <article class="metric-card"><span>Total Sale</span><strong>{{ saleSummary().totalSale | auraMoney:'1.0-0' }}</strong></article>
          <article class="metric-card"><span>Received Amount</span><strong>{{ saleSummary().receivedAmount | auraMoney:'1.0-0' }}</strong></article>
          <article class="metric-card"><span>Pending Amount</span><strong>{{ saleSummary().pendingAmount | auraMoney:'1.0-0' }}</strong></article>
          <article class="metric-card"><span>Prepaid Payment</span><strong>{{ saleSummary().prepaidPayment | auraMoney:'1.0-0' }}</strong></article>
          <article class="metric-card"><span>Return Sales</span><strong>{{ saleSummary().returnSales | auraMoney:'1.0-0' }}</strong></article>
          <article class="metric-card"><span>Total Tip Amount</span><strong>{{ saleSummary().totalTipAmount | auraMoney:'1.0-0' }}</strong></article>
          <article class="metric-card"><span>Total Tax</span><strong>{{ saleSummary().totalTax | auraMoney:'1.0-0' }}</strong></article>
        </div>
        <ng-template #defaultInvoiceKpis>
          <div class="metrics-grid invoice-report-kpis service-clients-kpis" *ngIf="activeReport() === 'service-clients'; else serviceTrendsKpis">
            <article class="metric-card"><span>Total clients</span><strong>{{ serviceClientsSummary()['totalClients'] || 0 }}</strong></article>
            <article class="metric-card"><span>Total service revenue</span><strong>{{ (serviceClientsSummary()['totalServiceRevenue'] || 0) | auraMoney:'1.0-0' }}</strong></article>
            <article class="metric-card"><span>Total service rows</span><strong>{{ serviceClientsSummary()['totalServiceRows'] || 0 }}</strong></article>
            <article class="metric-card"><span>Appointment rows</span><strong>{{ serviceClientsSummary()['appointmentRows'] || 0 }}</strong></article>
            <article class="metric-card"><span>Quick sale rows</span><strong>{{ serviceClientsSummary()['quickSaleRows'] || 0 }}</strong></article>
          </div>
          <ng-template #serviceTrendsKpis>
          <div class="metrics-grid invoice-report-kpis service-trends-kpis" *ngIf="activeReport() === 'service-trends'; else productInvoiceKpis">
            <article class="metric-card"><span>Total services sold</span><strong>{{ serviceTrendsSummary()['totalServicesSold'] || 0 }}</strong></article>
            <article class="metric-card"><span>Total service revenue</span><strong>{{ (serviceTrendsSummary()['totalServiceRevenue'] || 0) | auraMoney:'1.0-0' }}</strong></article>
            <article class="metric-card"><span>Total quantity sold</span><strong>{{ serviceTrendsSummary()['totalQuantitySold'] || 0 }}</strong></article>
            <article class="metric-card"><span>Average service price</span><strong>{{ (serviceTrendsSummary()['averageServicePrice'] || 0) | auraMoney:'1.0-0' }}</strong></article>
            <article class="metric-card"><span>Top service</span><strong>{{ serviceTrendsSummary()['topService'] || '-' }}</strong></article>
            <article class="metric-card"><span>Top service group</span><strong>{{ serviceTrendsSummary()['topServiceGroup'] || '-' }}</strong></article>
            <article class="metric-card"><span>Lowest selling service</span><strong>{{ serviceTrendsSummary()['lowestSellingService'] || '-' }}</strong></article>
            <article class="metric-card"><span>Highest margin service</span><strong>{{ serviceTrendsSummary()['highestMarginService'] || '-' }}</strong></article>
            <article class="metric-card"><span>Lowest margin service</span><strong>{{ serviceTrendsSummary()['lowestMarginService'] || '-' }}</strong></article>
            <article class="metric-card"><span>Peak selling hour</span><strong>{{ serviceTrendsSummary()['peakSellingHour'] || '-' }}</strong></article>
            <article class="metric-card"><span>Discount leakage</span><strong>{{ (serviceTrendsSummary()['discountLeakage'] || 0) | auraMoney:'1.0-0' }}</strong></article>
            <article class="metric-card"><span>Service GST collected</span><strong>{{ (serviceTrendsSummary()['serviceGstCollected'] || 0) | auraMoney:'1.0-0' }}</strong></article>
          </div>
          </ng-template>
        </ng-template>
        <ng-template #productInvoiceKpis>
          <div class="metrics-grid invoice-report-kpis product-sales-kpis" *ngIf="activeReport() === 'products'; else deletedInvoiceKpis">
            <article class="metric-card"><span>Total Product</span><strong>{{ productSalesSummary().totalProduct }}</strong></article>
            <article class="metric-card"><span>Products Sale</span><strong>{{ productSalesSummary().productsSale | auraMoney:'1.0-0' }}</strong></article>
            <article class="metric-card"><span>Tax On Products</span><strong>{{ productSalesSummary().taxOnProducts | auraMoney:'1.0-0' }}</strong></article>
            <article class="metric-card"><span>Taxable Amount</span><strong>{{ productSalesSummary().taxableAmount | auraMoney:'1.0-0' }}</strong></article>
            <article class="metric-card"><span>Discount</span><strong>{{ productSalesSummary().discount | auraMoney:'1.0-0' }}</strong></article>
            <article class="metric-card"><span>Products Sale After Discount</span><strong>{{ productSalesSummary().productsSaleAfterDiscount | auraMoney:'1.0-0' }}</strong></article>
            <article class="metric-card"><span>COGS</span><strong>{{ productSalesSummary().cogs | auraMoney:'1.0-0' }}</strong></article>
            <article class="metric-card"><span>Gross Margin</span><strong>{{ productSalesSummary().grossMargin | auraMoney:'1.0-0' }}</strong></article>
            <article class="metric-card"><span>Avg Margin %</span><strong>{{ productSalesSummary().averageMarginPercent }}%</strong></article>
            <article class="metric-card"><span>Low Stock Items</span><strong>{{ productSalesSummary().lowStockItems }}</strong></article>
            <article class="metric-card"><span>Low Margin Alerts</span><strong>{{ productSalesSummary().lowMarginItems }}</strong></article>
            <article class="metric-card"><span>Repeat Buyers</span><strong>{{ productSalesSummary().repeatBuyerRows }}</strong></article>
            <article class="metric-card"><span>Reorder Suggestions</span><strong>{{ productSalesSummary().reorderSuggestions }}</strong></article>
          </div>
        </ng-template>
        <ng-template #deletedInvoiceKpis>
          <div class="metrics-grid invoice-report-kpis deleted-invoice-kpis" *ngIf="activeReport() === 'deleted-invoice-approvals'; else regularInvoiceKpis">
            <article class="metric-card"><span>Total deleted bills</span><strong>{{ deletedInvoiceApprovalSummary()['totalBill'] || 0 }}</strong></article>
            <article class="metric-card"><span>Total sale</span><strong>{{ (deletedInvoiceApprovalSummary()['totalSale'] || 0) | auraMoney:'1.0-0' }}</strong></article>
            <article class="metric-card"><span>Received amount</span><strong>{{ (deletedInvoiceApprovalSummary()['receivedAmount'] || 0) | auraMoney:'1.0-0' }}</strong></article>
            <article class="metric-card"><span>Pending amount</span><strong>{{ (deletedInvoiceApprovalSummary()['pendingAmount'] || 0) | auraMoney:'1.0-0' }}</strong></article>
            <article class="metric-card"><span>Approved deletes</span><strong>{{ deletedInvoiceApprovalSummary()['approvedDeletes'] || 0 }}</strong></article>
            <article class="metric-card"><span>Approval gaps</span><strong>{{ deletedInvoiceApprovalSummary()['approvalGaps'] || 0 }}</strong></article>
          </div>
        </ng-template>
        <ng-template #regularInvoiceKpis>
          <div class="metrics-grid invoice-report-kpis">
            <article class="metric-card"><span>Gross billed</span><strong>{{ summary().gross | auraMoney:'1.0-0' }}</strong></article>
            <article class="metric-card"><span>Discount</span><strong>{{ summary().discount | auraMoney:'1.0-0' }}</strong><small>{{ summary().discountRate }}% leakage watch</small></article>
            <article class="metric-card"><span>Net taxable</span><strong>{{ summary().taxable | auraMoney:'1.0-0' }}</strong></article>
            <article class="metric-card"><span>GST</span><strong>{{ summary().gst | auraMoney:'1.0-0' }}</strong></article>
            <article class="metric-card"><span>Final sale</span><strong>{{ summary().final | auraMoney:'1.0-0' }}</strong></article>
            <article class="metric-card"><span>Due</span><strong>{{ summary().due | auraMoney:'1.0-0' }}</strong></article>
            <article class="metric-card"><span>Product sales</span><strong>{{ summary().products | auraMoney:'1.0-0' }}</strong></article>
            <article class="metric-card"><span>Membership sales</span><strong>{{ summary().memberships | auraMoney:'1.0-0' }}</strong></article>
          </div>
        </ng-template>

        <section class="panel report-command-panel">
          <div class="section-title inner-action-bar">
            <div>
              <h2>{{ activeDefinition().title }}</h2>
              <p>{{ activeDefinition().description }}</p>
            </div>
            <div class="hero-actions inner-action-bar">
              <span class="badge">{{ activeRows().length }} line(s)</span>
              <button class="ghost-button" type="button" (click)="exportCsv()">Export CSV</button>
              <button class="ghost-button" type="button" (click)="exportPdf()">Export PDF</button>
              <button class="ghost-button" type="button" *ngIf="activeReport() === 'products'" (click)="exportProductOwnerPdf()">Owner summary PDF</button>
              <button class="ghost-button" type="button" *ngIf="activeReport() === 'products'" (click)="exportProductAccountingCsv()">Accounting export</button>
              <button class="ghost-button" type="button" *ngIf="activeReport() === 'sales-discount-intelligence'" (click)="exportSalesDiscountOwnerPdf()">Owner discount PDF</button>
            </div>
          </div>

          <div class="report-tab-grid">
            <button
              type="button"
              *ngFor="let report of reportDefinitions"
              [class.active]="activeReport() === report.id"
              (click)="activeReport.set(report.id)"
            >
              <span>{{ report.badge }}</span>
              <strong>{{ report.title }}</strong>
              <small>{{ report.description }}</small>
            </button>
          </div>

          <div class="insight-strip">
            <article *ngFor="let insight of executiveInsights()">
              <span>{{ insight.label }}</span>
              <strong>{{ insight.value }}</strong>
              <small>{{ insight.detail }}</small>
            </article>
          </div>

          <div class="product-sales-control-grid" *ngIf="activeReport() === 'products'">
            <article *ngFor="let card of productSalesControlCards()">
              <span>{{ card.label }}</span>
              <strong>{{ card.value }}</strong>
              <small>{{ card.detail }}</small>
            </article>
          </div>

          <div class="discount-intelligence-stack" *ngIf="activeReport() === 'sales-discount-intelligence'">
            <div class="metrics-grid invoice-report-kpis discount-intelligence-kpis">
              <article class="metric-card"><span>Total invoices</span><strong>{{ salesDiscountSummary().totalInvoices }}</strong></article>
              <article class="metric-card"><span>Gross sale</span><strong>{{ salesDiscountSummary().grossSale | auraMoney:'1.0-0' }}</strong></article>
              <article class="metric-card"><span>Total discount</span><strong>{{ salesDiscountSummary().totalDiscount | auraMoney:'1.0-0' }}</strong><small>{{ salesDiscountSummary().discountRate }}% leakage</small></article>
              <article class="metric-card"><span>Net sale</span><strong>{{ salesDiscountSummary().netSale | auraMoney:'1.0-0' }}</strong></article>
              <article class="metric-card"><span>Manual discount</span><strong>{{ salesDiscountSummary().manualDiscount | auraMoney:'1.0-0' }}</strong></article>
              <article class="metric-card"><span>Coupon discount</span><strong>{{ salesDiscountSummary().couponDiscount | auraMoney:'1.0-0' }}</strong></article>
              <article class="metric-card"><span>Membership / loyalty</span><strong>{{ salesDiscountSummary().membershipLoyaltyDiscount | auraMoney:'1.0-0' }}</strong></article>
              <article class="metric-card"><span>Risk alerts</span><strong>{{ salesDiscountSummary().highRiskInvoices }}</strong><small>{{ salesDiscountSummary().marginLossAlerts }} margin loss</small></article>
            </div>

            <div class="product-sales-control-grid">
              <article *ngFor="let card of salesDiscountSourceCards()">
                <span>{{ card.label }}</span>
                <strong>{{ card.value }}</strong>
                <small>{{ card.detail }}</small>
              </article>
            </div>

            <div class="discount-drilldown-grid">
              <section>
                <div class="mini-section-title"><span>Staff-wise discount</span><strong>Top leakage</strong></div>
                <table>
                  <thead><tr><th>Staff</th><th>Bills</th><th>Discount</th><th>Risk</th></tr></thead>
                  <tbody>
                    <tr *ngFor="let row of salesDiscountStaffRows().slice(0, 6)">
                      <td>{{ row['staffName'] }}</td><td>{{ row['totalBills'] }}</td><td>{{ row['discountGiven'] | auraMoney:'1.0-0' }}</td><td><span class="badge">{{ row['risk'] }}</span></td>
                    </tr>
                  </tbody>
                </table>
              </section>
              <section>
                <div class="mini-section-title"><span>Client leakage</span><strong>Discount dependency</strong></div>
                <table>
                  <thead><tr><th>Client</th><th>Visits</th><th>Discount</th><th>Risk</th></tr></thead>
                  <tbody>
                    <tr *ngFor="let row of salesDiscountClientRows().slice(0, 6)">
                      <td>{{ row['clientName'] }}</td><td>{{ row['totalVisits'] }}</td><td>{{ row['totalDiscountReceived'] | auraMoney:'1.0-0' }}</td><td><span class="badge">{{ row['repeatDiscountRisk'] }}</span></td>
                    </tr>
                  </tbody>
                </table>
              </section>
              <section>
                <div class="mini-section-title"><span>Profit + audit</span><strong>Action queue</strong></div>
                <table>
                  <thead><tr><th>Invoice</th><th>Margin</th><th>Approval</th><th>Alert</th></tr></thead>
                  <tbody>
                    <tr *ngFor="let row of salesDiscountRiskRows().slice(0, 6)">
                      <td>{{ row['invoiceNumber'] }}</td><td>{{ row['grossMargin'] | auraMoney:'1.0-0' }}</td><td><span class="badge">{{ row['approvalStatus'] }}</span></td><td>{{ row['suspiciousDiscountAlert'] }}</td>
                    </tr>
                  </tbody>
                </table>
              </section>
            </div>
          </div>

          <div class="metrics-grid due-recovery-kpis" *ngIf="activeReport() === 'due-recovery'">
            <article class="metric-card"><span>Total pending due</span><strong>{{ (dueRecoverySummary()['totalPendingDue'] || 0) | auraMoney:'1.0-0' }}</strong></article>
            <article class="metric-card"><span>Pending invoices</span><strong>{{ dueRecoverySummary()['pendingInvoiceCount'] || 0 }}</strong></article>
            <article class="metric-card"><span>0-10 days</span><strong>{{ (dueRecoverySummary()['bucket0To10'] || 0) | auraMoney:'1.0-0' }}</strong></article>
            <article class="metric-card"><span>11-20 days</span><strong>{{ (dueRecoverySummary()['bucket11To20'] || 0) | auraMoney:'1.0-0' }}</strong></article>
            <article class="metric-card"><span>21+ days</span><strong>{{ (dueRecoverySummary()['bucket21Plus'] || 0) | auraMoney:'1.0-0' }}</strong></article>
            <article class="metric-card"><span>Recovered this month</span><strong>{{ (dueRecoverySummary()['recoveredThisMonth'] || 0) | auraMoney:'1.0-0' }}</strong></article>
            <article class="metric-card"><span>Call follow-up pending</span><strong>{{ dueRecoverySummary()['callFollowUpPending'] || 0 }}</strong></article>
            <article class="metric-card"><span>Daily follow-up due today</span><strong>{{ dueRecoverySummary()['dailyFollowUpDueToday'] || 0 }}</strong></article>
          </div>

          <div class="table-wrap enterprise-report-table">
            <table>
              <thead>
                <tr>
                  <th *ngFor="let column of activeColumns()" [class.right]="isRight(column)">{{ column.label }}</th>
                </tr>
              </thead>
              <tbody>
                <tr *ngFor="let row of activeRows()">
                  <td *ngFor="let column of activeColumns()" [class.right]="isRight(column)">
                    <ng-container *ngIf="activeReport() === 'service-trends' && column.key === 'actions'; else serviceClientsActionCell">
                      <div class="due-recovery-actions">
                        <a class="ghost-button mini" [routerLink]="['/reports/invoices']" [queryParams]="{ report: 'line-audit', q: row['serviceName'] }">View invoices</a>
                        <a class="ghost-button mini" [routerLink]="['/services']" [queryParams]="{ q: row['serviceName'] }">Service master</a>
                      </div>
                    </ng-container>
                    <ng-template #serviceClientsActionCell>
                    <ng-container *ngIf="activeReport() === 'service-clients' && column.key === 'actions'; else dueRecoveryActionCell">
                      <div class="due-recovery-actions">
                        <a class="ghost-button mini" *ngIf="row['clientId']" [routerLink]="['/clients', row['clientId']]">Open Client 360</a>
                        <ng-container *ngIf="canAccessPath('/pos/invoices')">
                          <a class="ghost-button mini" *ngIf="row['invoiceId']" [routerLink]="['/pos/invoices']" [queryParams]="{ invoice: row['invoiceId'] }">Open Invoice</a>
                        </ng-container>
                      </div>
                    </ng-container>
                    </ng-template>
                    <ng-template #dueRecoveryActionCell>
                    <ng-container *ngIf="activeReport() === 'due-recovery' && column.key === 'actions'; else normalReportCell">
                      <div class="due-recovery-actions">
                        <a class="ghost-button mini" [routerLink]="['/pos/invoices']" [queryParams]="{ invoice: row['invoiceId'] }" *ngIf="canAccessPath('/pos/invoices')">Open invoice</a>
                        <a class="ghost-button mini" [routerLink]="['/pos/invoices']" [queryParams]="{ invoice: row['invoiceId'], due: 1 }" *ngIf="canAccessPath('/pos/invoices')">Receive due</a>
                        <button
                          class="primary-button mini"
                          type="button"
                          [disabled]="!canSendDueReminder(row) || actionLoading() === row['invoiceId']"
                          [title]="dueReminderDisabledReason(row)"
                          (click)="sendDueReminder(row)"
                        >
                          {{ actionLoading() === row['invoiceId'] ? 'Sending...' : 'Send payment reminder' }}
                        </button>
                        <select class="mini-select" [(ngModel)]="recoveryOwnerDrafts[row['invoiceId']]">
                          <option value="">Manager</option>
                          <option *ngFor="let owner of recoveryOwnerOptions()" [value]="owner.id">{{ owner.label }}</option>
                        </select>
                        <button class="ghost-button mini" type="button" [disabled]="actionLoading() === dueRecoveryActionKey(row, 'assign')" (click)="assignDueRecoveryManager(row)">
                          {{ actionLoading() === dueRecoveryActionKey(row, 'assign') ? 'Assigning...' : 'Assign manager' }}
                        </button>
                        <button class="ghost-button mini" type="button" [disabled]="actionLoading() === dueRecoveryActionKey(row, 'call')" (click)="markDueRecoveryCallDone(row)">
                          {{ actionLoading() === dueRecoveryActionKey(row, 'call') ? 'Saving...' : 'Mark call done' }}
                        </button>
                        <button class="ghost-button mini" type="button" [disabled]="actionLoading() === dueRecoveryActionKey(row, 'note')" (click)="addDueRecoveryFollowUpNote(row)">
                          {{ actionLoading() === dueRecoveryActionKey(row, 'note') ? 'Saving...' : 'Add note' }}
                        </button>
                        <small *ngIf="dueReminderDisabledReason(row)">{{ dueReminderDisabledReason(row) }}</small>
                      </div>
                    </ng-container>
                    </ng-template>
                    <ng-template #normalReportCell>
                      <span [class.badge]="column.type === 'badge'">{{ formatCell(row, column) }}</span>
                    </ng-template>
                  </td>
                </tr>
                <tr *ngIf="!activeRows().length">
                  <td [attr.colspan]="activeColumns().length">No data found for selected filters.</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
      </ng-container>
    </section>
  `,
  styles: [`
    .invoice-report-hero {
      align-items: center;
    }

    .hero-actions {
      display: flex;
      flex-wrap: wrap;
      justify-content: flex-end;
      gap: 10px;
    }

    .report-filter-panel {
      display: grid;
      grid-template-columns: repeat(4, minmax(140px, 1fr));
      gap: 12px;
      align-items: end;
    }

    .product-advanced-filter-panel {
      display: grid;
      grid-template-columns: repeat(6, minmax(120px, 1fr));
      gap: 12px;
      align-items: end;
    }

    .report-filter-panel .span-2 {
      min-width: 0;
    }

    .invoice-report-kpis {
      grid-template-columns: repeat(4, minmax(0, 1fr));
    }

    .metric-card {
      min-height: 116px;
      border-top: 4px solid var(--primary);
    }

    .product-sales-kpis {
      grid-template-columns: repeat(4, minmax(0, 1fr));
    }

    .report-command-panel {
      display: grid;
      gap: 16px;
      min-width: 0;
    }

    .report-tab-grid {
      display: grid;
      grid-template-columns: repeat(6, minmax(0, 1fr));
      gap: 10px;
    }

    .report-tab-grid button {
      min-height: 108px;
      display: grid;
      gap: 6px;
      align-content: start;
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 12px;
      background: #fff;
      color: var(--ink);
      cursor: pointer;
      text-align: left;
    }

    .report-tab-grid button.active,
    .report-tab-grid button:hover {
      border-color: color-mix(in srgb, var(--teal) 72%, var(--line));
      background: color-mix(in srgb, var(--teal) 10%, #fff);
      box-shadow: 0 12px 28px color-mix(in srgb, var(--teal) 12%, transparent);
    }

    .report-tab-grid span,
    .report-tab-grid small {
      color: var(--muted);
      font-size: 11px;
      font-weight: 800;
      text-transform: uppercase;
    }

    .report-tab-grid strong {
      line-height: 1.2;
    }

    .insight-strip {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 10px;
    }

    .insight-strip article {
      min-width: 0;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: #fbfdfc;
      padding: 12px;
    }

    .insight-strip span,
    .insight-strip small {
      display: block;
      color: var(--muted);
      font-size: 12px;
      font-weight: 800;
    }

    .insight-strip strong {
      display: block;
      margin: 4px 0;
      font-size: 20px;
    }

    .product-sales-control-grid {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 10px;
    }

    .product-sales-control-grid article {
      min-width: 0;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: linear-gradient(180deg, #fff, #faf8f6);
      padding: 12px;
    }

    .product-sales-control-grid span,
    .product-sales-control-grid small {
      display: block;
      color: var(--muted);
      font-size: 12px;
      font-weight: 800;
    }

    .product-sales-control-grid strong {
      display: block;
      margin: 4px 0;
      font-size: 18px;
    }

    .discount-intelligence-stack {
      display: grid;
      gap: 14px;
    }

    .discount-intelligence-kpis {
      grid-template-columns: repeat(4, minmax(0, 1fr));
    }

    .discount-drilldown-grid {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 12px;
    }

    .discount-drilldown-grid section {
      min-width: 0;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: linear-gradient(180deg, #fff, #faf8f6);
      padding: 12px;
      overflow: auto;
    }

    .discount-drilldown-grid table {
      width: 100%;
      min-width: 520px;
    }

    .mini-section-title {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      margin-bottom: 8px;
    }

    .mini-section-title span {
      color: var(--muted);
      font-size: 11px;
      font-weight: 900;
      letter-spacing: .04em;
      text-transform: uppercase;
    }

    .mini-section-title strong {
      color: var(--ink);
      font-size: 13px;
    }

    .enterprise-report-table {
      max-height: 660px;
      overflow: auto;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: #fff;
    }

    .enterprise-report-table table {
      min-width: 2200px;
    }

    .enterprise-report-table th {
      position: sticky;
      top: 0;
      z-index: 1;
      background: #f8fafc;
    }

    .due-recovery-kpis {
      margin-bottom: 14px;
    }

    .due-recovery-actions {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 8px;
      min-width: 360px;
    }

    .due-recovery-actions small {
      color: var(--muted);
      font-size: 11px;
      font-weight: 800;
    }

    .mini-select {
      min-width: 128px;
      height: 34px;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: #fff;
      padding: 0 10px;
      font-weight: 800;
    }

    .right {
      text-align: right;
      white-space: nowrap;
    }

    @media (max-width: 1280px) {
      .report-filter-panel,
      .product-advanced-filter-panel,
      .invoice-report-kpis,
      .report-tab-grid,
      .insight-strip,
      .product-sales-control-grid,
      .discount-drilldown-grid {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }
    }

    @media (max-width: 760px) {
      .report-filter-panel,
      .product-advanced-filter-panel,
      .invoice-report-kpis,
      .report-tab-grid,
      .insight-strip,
      .product-sales-control-grid,
      .discount-drilldown-grid {
        grid-template-columns: 1fr;
      }
    }
  `]
})
export class InvoiceReportsComponent implements OnInit {
  readonly loading = signal(true);
  readonly error = signal('');
  readonly lines = signal<InvoiceLine[]>([]);
  readonly invoices = signal<ApiRecord[]>([]);
  readonly payments = signal<ApiRecord[]>([]);
  readonly clients = signal<ApiRecord[]>([]);
  readonly products = signal<ApiRecord[]>([]);
  readonly branches = signal<ApiRecord[]>([]);
  readonly walletTransactions = signal<ApiRecord[]>([]);
  readonly auditLogs = signal<ApiRecord[]>([]);
  readonly invoiceActivityReport = signal<InvoiceActivityReport>({});
  readonly dueRecoverySummary = signal<ApiRecord>({});
  readonly dueRecoveryReportRows = signal<ApiRecord[]>([]);
  readonly serviceTrendsSummary = signal<ApiRecord>({});
  readonly serviceTrendsReportRows = signal<ApiRecord[]>([]);
  readonly serviceClientsSummary = signal<ApiRecord>({});
  readonly serviceClientsReportRows = signal<ApiRecord[]>([]);
  readonly actionLoading = signal('');
  readonly notice = signal('');
  readonly activeReport = signal('sale-summary');
  readonly clientFilterOptions = computed(() => {
    const map = new Map<string, string>();
    for (const line of this.lines()) {
      if (line.clientId) map.set(line.clientId, `${line.clientName}${line.clientPhone ? ` · ${line.clientPhone}` : ''}`);
    }
    return [...map.entries()].map(([id, label]) => ({ id, label })).sort((a, b) => a.label.localeCompare(b.label));
  });
  readonly staffFilterOptions = computed(() => {
    const map = new Map<string, string>();
    for (const line of this.lines()) {
      const id = line.staffId || line.staffName;
      if (id) map.set(id, line.staffName || id);
    }
    return [...map.entries()].map(([id, label]) => ({ id, label })).sort((a, b) => a.label.localeCompare(b.label));
  });
  readonly branchFilterOptions = computed(() => {
    const map = new Map<string, string>();
    for (const line of this.lines()) {
      if (line.branchId) map.set(line.branchId, line.branchName || line.branchId);
    }
    for (const branch of this.branches()) {
      const id = String(branch.id || '');
      if (id) map.set(id, String(branch.name || id));
    }
    return [...map.entries()].map(([id, label]) => ({ id, label })).sort((a, b) => a.label.localeCompare(b.label));
  });
  readonly productFilterOptions = computed(() => {
    const map = new Map<string, string>();
    for (const line of this.lines().filter((item) => item.itemType === 'product')) {
      const id = line.productId || line.productSku || line.productBarcode || line.itemName;
      if (id) map.set(id, `${line.itemName}${line.productSku ? ` · ${line.productSku}` : ''}`);
    }
    return [...map.entries()].map(([id, label]) => ({ id, label })).sort((a, b) => a.label.localeCompare(b.label));
  });
  readonly productBrandOptions = computed(() => this.uniqueLineOption('productBrand'));
  readonly productCategoryOptions = computed(() => this.uniqueLineOption('productCategory'));
  readonly gstRateOptions = computed(() => this.uniqueLineOption('gstRate', (value) => `${this.money(Number(value || 0))}%`));
  readonly couponCodeOptions = computed(() => this.uniqueAnyLineOption('couponCode'));
  readonly serviceProductOptions = computed(() => this.uniqueAnyLineOption('itemName'));
  readonly paymentModeOptions = computed(() => {
    const modes = new Set(this.payments().map((payment) => this.paymentMode(payment)).filter(Boolean));
    return [...modes].map((id) => ({ id, label: this.modeLabel(id) })).sort((a, b) => a.label.localeCompare(b.label));
  });
  readonly receivedByOptions = computed(() => {
    const map = new Map<string, string>();
    for (const payment of this.payments().filter((item) => this.isReceivedDuePayment(item))) {
      const id = this.paymentReceiverId(payment);
      if (id) map.set(id, this.paymentReceiver(payment));
    }
    return [...map.entries()].map(([id, label]) => ({ id, label })).sort((a, b) => a.label.localeCompare(b.label));
  });
  readonly recoveryOwnerOptions = computed(() => {
    const map = new Map<string, string>();
    for (const staff of this.staffFilterOptions()) map.set(staff.id, staff.label);
    for (const row of this.dueRecoveryReportRows()) {
      const id = String(row['recoveryOwnerId'] || '').trim();
      if (id) map.set(id, String(row['recoveryOwnerName'] || id));
      const staffId = String(row['staffId'] || '').trim();
      if (staffId) map.set(staffId, String(row['staffName'] || staffId));
    }
    return [...map.entries()].map(([id, label]) => ({ id, label })).sort((a, b) => a.label.localeCompare(b.label));
  });
  readonly serviceGroupOptions = computed(() => this.uniqueServiceTrendOption('serviceGroup'));
  readonly serviceTrendOptions = computed(() => this.uniqueServiceTrendOption('serviceName'));
  readonly serviceGstRateOptions = computed(() => this.uniqueServiceTrendOption('gstRate', (value) => `${this.money(Number(value || 0))}%`));

  from = '';
  to = '';
  status = '';
  query = '';
  clientFilter = '';
  branchFilter = '';
  staffFilter = '';
  recoveryStatus = 'all';
  agingBucket = '';
  paymentModeFilter = '';
  receivedByFilter = '';
  recoveryOwnerFilter = '';
  followUpStatusFilter = '';
  recoveryOwnerDrafts: Record<string, string> = {};
  productFilter = '';
  productBrandFilter = '';
  productCategoryFilter = '';
  gstRateFilter = '';
  marginHealthFilter = '';
  inventorySignalFilter = '';
  discountTypeFilter = '';
  couponCodeFilter = '';
  serviceProductFilter = '';
  discountBucketFilter = '';
  discountRiskFilter = '';
  serviceGroupFilter = '';
  serviceTrendFilter = '';
  serviceGstRateFilter = '';
  serviceRevenueBucketFilter = '';
  serviceMarginBucketFilter = '';
  serviceQuantityBucketFilter = '';
  serviceTimeBucketFilter = '';
  serviceSaleTypeFilter = '';
  serviceSort = 'revenue_desc';

  readonly reportDefinitions: ReportDefinition[] = [
    { id: 'sale-summary', title: 'Sale Summary', badge: '00', description: 'Sale list with bill, client, payment, prepaid, coupon, loyalty and GST details.' },
    { id: 'service-trends', title: 'Service Trends', badge: '00B', description: 'Service performance, quantity, GST, discount, COGS, margin, staff and repeat client intelligence.' },
    { id: 'service-clients', title: 'Service Clients', badge: '00C', description: 'Row-level service sales with client, contact, staff, sale type, invoice and branch.' },
    { id: 'sales-discount-intelligence', title: 'Sales Discount Intelligence', badge: '00A', description: 'Sales discount register, source breakdown, profit impact, approval risk and leakage intelligence.' },
    { id: 'overview', title: 'Invoice Summary', badge: '01', description: 'Gross, discount, GST, paid, due and invoice count.' },
    { id: 'staff-services', title: 'Staff Service Sales', badge: '02', description: 'Staff ne kaunsi service ki aur kitna revenue banaya.' },
    { id: 'staff-discounts', title: 'Staff Discount Performance', badge: '03', description: 'Without discount vs with discount staff revenue.' },
    { id: 'products', title: 'Product Sales', badge: '04', description: 'Retail product quantity, discount, GST and net sale.' },
    { id: 'memberships', title: 'Membership / Package Sales', badge: '05', description: 'Membership, package and prepaid credit selling.' },
    { id: 'gst', title: 'GST + HSN/SAC', badge: '06', description: 'GST rate wise taxable and tax breakup.' },
    { id: 'payments', title: 'Payment Collection', badge: '07', description: 'Cash, UPI, card, wallet, online and split payment.' },
    { id: 'due-aging', title: 'Due / Unpaid Aging', badge: '08', description: 'Original unpaid invoice, recovery payment, receiver and aging audit.' },
    { id: 'due-recovery', title: 'Due Recovery', badge: '8B', description: 'Unpaid queue, payment link reminder status and receive-due actions.' },
    { id: 'staff-unpaid', title: 'Staff Unpaid Services', badge: '8A', description: 'Staff/service wise unpaid, recovered and pending due accountability.' },
    { id: 'wallet', title: 'Wallet Ledger', badge: '09', description: 'Wallet used, wallet balance and liability.' },
    { id: 'audit', title: 'Refund / Void / Adjustment', badge: '10', description: 'Delete, edit, restore, refund and approval trail.' },
    { id: 'deleted-invoice-approvals', title: 'Deleted Invoice Approvals', badge: '10A', description: 'Deleted bill register with approval, deleted date, deleted by, amount and reason audit.' },
    { id: 'branch-closing', title: 'Branch Day Closing', badge: '11', description: 'Date and branch wise closing with GST and due.' },
    { id: 'commission', title: 'Commission Preview', badge: '12', description: 'Estimated service and retail commission base.' },
    { id: 'discount-approval', title: 'Discount Audit', badge: '13', description: 'Discount rate, reason readiness and approval risk.' },
    { id: 'client-profit', title: 'Client Profitability', badge: '14', description: 'Client LTV, discount leakage, due and wallet context.' },
    { id: 'package-liability', title: 'Credit Liability', badge: '15', description: 'Membership/package/wallet future service liability.' },
    { id: 'delivery', title: 'WhatsApp PDF Delivery', badge: '16', description: 'Invoice PDF send readiness and client phone coverage.' },
    { id: 'leakage-ai', title: 'AI Leakage Radar', badge: '17', description: 'Discount, GST, due, staff attribution and payment anomalies.' },
    { id: 'line-audit', title: 'Full Line Audit', badge: '18', description: 'Every invoice line with staff, discount, GST and payment mode.' }
  ];

  private readonly columns: Record<string, ReportColumn[]> = {
    'sale-summary': [
      { key: 'invoiceNumber', label: 'Invoice No' }, { key: 'clientName', label: 'Name' }, { key: 'clientPhone', label: 'Contact' }, { key: 'itemDescription', label: 'Item Description' }, { key: 'itemTypes', label: 'Item Types' }, { key: 'actualPrice', label: 'Actual Price', type: 'currency' }, { key: 'price', label: 'Price', type: 'currency' }, { key: 'paid', label: 'Paid', type: 'currency' }, { key: 'prepaid', label: 'Prepaid', type: 'currency' }, { key: 'balance', label: 'Balance', type: 'currency' }, { key: 'modes', label: 'Modes' }, { key: 'status', label: 'Status', type: 'badge' }, { key: 'date', label: 'Date' }, { key: 'addedBy', label: 'Added By' }, { key: 'invoiceDate', label: 'Invoice Date' }, { key: 'couponCode', label: 'Coupon Code' }, { key: 'couponDiscount', label: 'Coupon Discount', type: 'currency' }, { key: 'loyaltyDiscount', label: 'Loyalty Discount', type: 'currency' }, { key: 'gst', label: 'GST', type: 'currency' }
    ],
    'sales-discount-intelligence': [
      { key: 'invoiceNumber', label: 'Invoice no' }, { key: 'invoiceDate', label: 'Invoice date' }, { key: 'invoiceTime', label: 'Invoice time' }, { key: 'clientName', label: 'Client' }, { key: 'clientPhone', label: 'Phone' }, { key: 'staffName', label: 'Staff' }, { key: 'serviceProductNames', label: 'Service/product names' }, { key: 'actualPrice', label: 'Actual price', type: 'currency' }, { key: 'manualDiscount', label: 'Manual discount', type: 'currency' }, { key: 'couponDiscount', label: 'Coupon discount', type: 'currency' }, { key: 'membershipLoyaltyDiscount', label: 'Membership/loyalty', type: 'currency' }, { key: 'finalPrice', label: 'Final price', type: 'currency' }, { key: 'paymentMode', label: 'Payment mode' }, { key: 'status', label: 'Status', type: 'badge' }, { key: 'discountRate', label: 'Discount %', type: 'percent' }, { key: 'discountGivenBy', label: 'Discount given by' }, { key: 'userRole', label: 'Role' }, { key: 'discountReason', label: 'Reason' }, { key: 'approvalStatus', label: 'Approval', type: 'badge' }, { key: 'invoiceEditedAfterDiscount', label: 'Edited after discount', type: 'badge' }, { key: 'suspiciousDiscountAlert', label: 'Suspicious alert', type: 'badge' }, { key: 'cogs', label: 'COGS', type: 'currency' }, { key: 'staffCommissionImpact', label: 'Staff commission impact', type: 'currency' }, { key: 'grossMargin', label: 'Gross margin', type: 'currency' }, { key: 'marginPercent', label: 'Margin %', type: 'percent' }, { key: 'lowMarginAlert', label: 'Low margin alert', type: 'badge' }, { key: 'lossMakingInvoiceAlert', label: 'Loss-making alert', type: 'badge' }
    ],
    'service-trends': [
      { key: 'serviceGroup', label: 'Service group/category' }, { key: 'serviceName', label: 'Service name' }, { key: 'quantitySold', label: 'Quantity sold', type: 'number' }, { key: 'grossSale', label: 'Gross sale', type: 'currency' }, { key: 'discount', label: 'Discount', type: 'currency' }, { key: 'netSale', label: 'Net sale', type: 'currency' }, { key: 'gst', label: 'GST', type: 'currency' }, { key: 'productCost', label: 'Product cost / COGS', type: 'currency' }, { key: 'grossMargin', label: 'Gross margin', type: 'currency' }, { key: 'marginPercent', label: 'Margin %', type: 'percent' }, { key: 'costStatus', label: 'Cost status', type: 'badge' }, { key: 'staffName', label: 'Staff name' }, { key: 'clientCount', label: 'Client count', type: 'number' }, { key: 'repeatClientCount', label: 'Repeat client count', type: 'number' }, { key: 'invoiceCount', label: 'Invoice count', type: 'number' }, { key: 'lastSoldDate', label: 'Last sold date' }, { key: 'lastSoldTime', label: 'Last sold time' }, { key: 'peakSellingHour', label: 'Peak hour', type: 'badge' }, { key: 'actions', label: 'Action' }
    ],
    'service-clients': [
      { key: 'date', label: 'Date' }, { key: 'time', label: 'Time' }, { key: 'serviceGroup', label: 'Groups' }, { key: 'serviceName', label: 'Service Name' }, { key: 'clientName', label: 'Name' }, { key: 'clientPhone', label: 'Contact' }, { key: 'servicePrice', label: 'Service Price', type: 'currency' }, { key: 'saleType', label: 'Sale Type', type: 'badge' }, { key: 'staffName', label: 'Staff' }, { key: 'invoiceNumber', label: 'Invoice No' }, { key: 'branchId', label: 'Branch' }, { key: 'actions', label: 'Action' }
    ],
    overview: [
      { key: 'metric', label: 'Metric' }, { key: 'value', label: 'Value', type: 'currency' }, { key: 'count', label: 'Count', type: 'number' }, { key: 'note', label: 'Note' }
    ],
    'staff-services': [
      { key: 'staffName', label: 'Staff' }, { key: 'serviceName', label: 'Service' }, { key: 'qty', label: 'Qty', type: 'number' }, { key: 'withoutDiscount', label: 'Without discount', type: 'currency' }, { key: 'discount', label: 'Discount', type: 'currency' }, { key: 'withDiscount', label: 'With discount', type: 'currency' }, { key: 'gst', label: 'GST', type: 'currency' }, { key: 'final', label: 'Final', type: 'currency' }, { key: 'invoices', label: 'Invoices', type: 'number' }
    ],
    'staff-discounts': [
      { key: 'staffName', label: 'Staff' }, { key: 'withoutDiscount', label: 'Without discount', type: 'currency' }, { key: 'withDiscount', label: 'With discount', type: 'currency' }, { key: 'discount', label: 'Discount', type: 'currency' }, { key: 'discountRate', label: 'Discount %', type: 'percent' }, { key: 'serviceRevenue', label: 'Services', type: 'currency' }, { key: 'productRevenue', label: 'Products', type: 'currency' }, { key: 'membershipRevenue', label: 'Memberships', type: 'currency' }, { key: 'risk', label: 'Risk', type: 'badge' }
    ],
    products: [
      { key: 'product', label: 'Product' }, { key: 'brand', label: 'Brand' }, { key: 'category', label: 'Category' }, { key: 'name', label: 'Name' }, { key: 'contact', label: 'Contact' }, { key: 'invoiceNo', label: 'Invoice No' }, { key: 'qty', label: 'Qty', type: 'number' }, { key: 'price', label: 'Sale Price', type: 'currency' }, { key: 'costPrice', label: 'Cost Price', type: 'currency' }, { key: 'cogs', label: 'COGS', type: 'currency' }, { key: 'totalPrice', label: 'Total Price', type: 'currency' }, { key: 'taxPercent', label: 'Tax in %', type: 'percent' }, { key: 'taxOnProducts', label: 'Tax On Products', type: 'currency' }, { key: 'taxableAmount', label: 'Taxable Amount', type: 'currency' }, { key: 'discount', label: 'Discount', type: 'currency' }, { key: 'totalPriceAfterDiscount', label: 'Total Price After Discount', type: 'currency' }, { key: 'staff', label: 'Staff' }, { key: 'date', label: 'Date' }, { key: 'paymentModes', label: 'Payment Mode' }, { key: 'skuBarcode', label: 'SKU / Barcode' }, { key: 'soldVsStock', label: 'Sold vs Stock' }, { key: 'stockSignal', label: 'Stock Signal', type: 'badge' }, { key: 'stockDeductionTrail', label: 'Stock Deduction Trail' }, { key: 'fifoSource', label: 'Batch / FIFO Source' }, { key: 'expiryDate', label: 'Expiry' }, { key: 'reorderSuggestion', label: 'Reorder Suggestion' }, { key: 'grossMargin', label: 'Gross Margin', type: 'currency' }, { key: 'marginPercent', label: 'Margin %', type: 'percent' }, { key: 'lowMarginAlert', label: 'Low Margin Alert', type: 'badge' }, { key: 'commissionBase', label: 'Commission Base', type: 'currency' }, { key: 'retailTargetAchievement', label: 'Retail Target' }, { key: 'repeatBuyer', label: 'Repeat Buyer', type: 'badge' }, { key: 'aftercareOpportunity', label: 'Recommendation / Aftercare' }
    ],
    memberships: [
      { key: 'itemName', label: 'Membership / package' }, { key: 'staffName', label: 'Sold by' }, { key: 'qty', label: 'Qty', type: 'number' }, { key: 'gross', label: 'Gross', type: 'currency' }, { key: 'discount', label: 'Discount', type: 'currency' }, { key: 'final', label: 'Final', type: 'currency' }, { key: 'liability', label: 'Future liability', type: 'currency' }, { key: 'invoices', label: 'Invoices', type: 'number' }
    ],
    gst: [
      { key: 'gstRate', label: 'GST rate', type: 'percent' }, { key: 'itemType', label: 'Type' }, { key: 'taxable', label: 'Taxable', type: 'currency' }, { key: 'gst', label: 'GST', type: 'currency' }, { key: 'cgst', label: 'CGST', type: 'currency' }, { key: 'sgst', label: 'SGST', type: 'currency' }, { key: 'final', label: 'Final', type: 'currency' }, { key: 'lines', label: 'Lines', type: 'number' }
    ],
    payments: [
      { key: 'mode', label: 'Mode' }, { key: 'amount', label: 'Collected', type: 'currency' }, { key: 'invoices', label: 'Invoices', type: 'number' }, { key: 'splitCount', label: 'Split usage', type: 'number' }, { key: 'risk', label: 'Reconcile risk', type: 'badge' }
    ],
    'due-aging': [
      { key: 'invoiceNumber', label: 'Invoice' }, { key: 'originalInvoiceDate', label: 'Invoice date' }, { key: 'originalInvoiceTime', label: 'Invoice time' }, { key: 'clientName', label: 'Client' }, { key: 'clientPhone', label: 'Phone' }, { key: 'staffName', label: 'Staff' }, { key: 'serviceNames', label: 'Services' }, { key: 'totalAmount', label: 'Total', type: 'currency' }, { key: 'paid', label: 'Paid', type: 'currency' }, { key: 'due', label: 'Due', type: 'currency' }, { key: 'paymentStatus', label: 'Status', type: 'badge' }, { key: 'bucket', label: 'Aging bucket', type: 'badge' }, { key: 'duePaidDate', label: 'Due paid date' }, { key: 'duePaidTime', label: 'Due paid time' }, { key: 'receivedAmount', label: 'Received due', type: 'currency' }, { key: 'paymentMode', label: 'Mode' }, { key: 'receivedBy', label: 'Received by' }, { key: 'receiverId', label: 'Receiver ID' }, { key: 'settlementPaymentId', label: 'Settlement/payment ID' }, { key: 'paymentReference', label: 'Reference no.' }, { key: 'daysToRecovery', label: 'Days to recovery', type: 'number' }, { key: 'partialPaymentHistory', label: 'Partial payment history' }
    ],
    'due-recovery': [
      { key: 'invoiceNumber', label: 'Invoice no' }, { key: 'invoiceDate', label: 'Original date' }, { key: 'invoiceTime', label: 'Original time' }, { key: 'clientName', label: 'Client' }, { key: 'clientPhone', label: 'Phone' }, { key: 'staffName', label: 'Staff' }, { key: 'serviceNames', label: 'Services' }, { key: 'totalAmount', label: 'Total', type: 'currency' }, { key: 'paidAmount', label: 'Paid', type: 'currency' }, { key: 'dueAmount', label: 'Due', type: 'currency' }, { key: 'agingBucket', label: 'Aging', type: 'badge' }, { key: 'recoveryStatus', label: 'Recovery', type: 'badge' }, { key: 'lastPaymentAt', label: 'Last payment', type: 'date' }, { key: 'receivedBy', label: 'Received by' }, { key: 'paymentMode', label: 'Payment mode', type: 'badge' }, { key: 'settlementPaymentId', label: 'Settlement/payment ID' }, { key: 'paymentReference', label: 'Reference' }, { key: 'partialPaymentHistory', label: 'Partial payment history' }, { key: 'paymentLinkStatus', label: 'Reminder status', type: 'badge' }, { key: 'reminderChannel', label: 'Channel', type: 'badge' }, { key: 'lastReminderSentAt', label: 'Last reminder', type: 'date' }, { key: 'callFollowUpStatus', label: 'Call follow-up', type: 'badge' }, { key: 'recoveryOwnerName', label: 'Recovery owner' }, { key: 'lastFollowUpAt', label: 'Last follow-up', type: 'date' }, { key: 'lastFollowUpNote', label: 'Follow-up note' }, { key: 'actions', label: 'Action' }
    ],
    'staff-unpaid': [
      { key: 'staffName', label: 'Staff' }, { key: 'serviceName', label: 'Service' }, { key: 'invoiceCount', label: 'Invoices', type: 'number' }, { key: 'totalBilled', label: 'Total billed', type: 'currency' }, { key: 'totalUnpaid', label: 'Total unpaid', type: 'currency' }, { key: 'totalRecovered', label: 'Recovered', type: 'currency' }, { key: 'pendingDue', label: 'Pending due', type: 'currency' }, { key: 'recoveryRate', label: 'Recovery rate', type: 'percent' }
    ],
    wallet: [
      { key: 'clientName', label: 'Client' }, { key: 'clientPhone', label: 'Phone' }, { key: 'walletUsed', label: 'Wallet used', type: 'currency' }, { key: 'walletBalance', label: 'Wallet balance', type: 'currency' }, { key: 'due', label: 'Due', type: 'currency' }, { key: 'lastActivity', label: 'Last activity', type: 'date' }, { key: 'source', label: 'Source', type: 'badge' }
    ],
    audit: [
      { key: 'date', label: 'Date', type: 'date' }, { key: 'action', label: 'Action', type: 'badge' }, { key: 'invoiceNumber', label: 'Invoice' }, { key: 'clientName', label: 'Client' }, { key: 'staffName', label: 'Staff' }, { key: 'amount', label: 'Amount', type: 'currency' }, { key: 'risk', label: 'Risk', type: 'badge' }, { key: 'note', label: 'Note' }
    ],
    'deleted-invoice-approvals': [
      { key: 'clientName', label: 'Name' }, { key: 'clientPhone', label: 'Contact' }, { key: 'invoiceNumber', label: 'Invoice No' }, { key: 'price', label: 'Price', type: 'currency' }, { key: 'paid', label: 'Paid', type: 'currency' }, { key: 'balance', label: 'Balance', type: 'currency' }, { key: 'invoiceDate', label: 'Date' }, { key: 'feedbackRating', label: 'Feedback & Rating' }, { key: 'deletedDate', label: 'Deleted Date' }, { key: 'deletedTime', label: 'Deleted Time' }, { key: 'deletedBy', label: 'Deleted By' }, { key: 'approvedBy', label: 'Approved By' }, { key: 'approvalStatus', label: 'Approval Status', type: 'badge' }, { key: 'deleteReason', label: 'Reason' }, { key: 'action', label: 'Action' }
    ],
    'branch-closing': [
      { key: 'date', label: 'Date' }, { key: 'branchName', label: 'Branch' }, { key: 'gross', label: 'Gross', type: 'currency' }, { key: 'discount', label: 'Discount', type: 'currency' }, { key: 'gst', label: 'GST', type: 'currency' }, { key: 'collected', label: 'Collected', type: 'currency' }, { key: 'due', label: 'Due', type: 'currency' }, { key: 'invoices', label: 'Invoices', type: 'number' }
    ],
    commission: [
      { key: 'staffName', label: 'Staff' }, { key: 'serviceBase', label: 'Service base', type: 'currency' }, { key: 'retailBase', label: 'Retail base', type: 'currency' }, { key: 'membershipBase', label: 'Membership base', type: 'currency' }, { key: 'discount', label: 'Discount impact', type: 'currency' }, { key: 'estimatedCommission', label: 'Estimated commission', type: 'currency' }, { key: 'policy', label: 'Policy' }
    ],
    'discount-approval': [
      { key: 'invoiceNumber', label: 'Invoice' }, { key: 'clientName', label: 'Client' }, { key: 'staffName', label: 'Staff' }, { key: 'gross', label: 'Gross', type: 'currency' }, { key: 'discount', label: 'Discount', type: 'currency' }, { key: 'discountRate', label: 'Discount %', type: 'percent' }, { key: 'approval', label: 'Approval', type: 'badge' }, { key: 'reason', label: 'Reason' }
    ],
    'client-profit': [
      { key: 'clientName', label: 'Client' }, { key: 'phone', label: 'Phone' }, { key: 'gross', label: 'Gross', type: 'currency' }, { key: 'discount', label: 'Discount', type: 'currency' }, { key: 'net', label: 'Net', type: 'currency' }, { key: 'due', label: 'Due', type: 'currency' }, { key: 'wallet', label: 'Wallet', type: 'currency' }, { key: 'visits', label: 'Invoices', type: 'number' }, { key: 'risk', label: 'Risk', type: 'badge' }
    ],
    'package-liability': [
      { key: 'clientName', label: 'Client' }, { key: 'itemName', label: 'Plan / package' }, { key: 'soldValue', label: 'Sold value', type: 'currency' }, { key: 'walletBalance', label: 'Wallet balance', type: 'currency' }, { key: 'futureLiability', label: 'Future liability', type: 'currency' }, { key: 'risk', label: 'Risk', type: 'badge' }
    ],
    delivery: [
      { key: 'invoiceNumber', label: 'Invoice' }, { key: 'clientName', label: 'Client' }, { key: 'clientPhone', label: 'Phone' }, { key: 'total', label: 'Total', type: 'currency' }, { key: 'due', label: 'Due', type: 'currency' }, { key: 'readiness', label: 'PDF readiness', type: 'badge' }, { key: 'action', label: 'Action' }
    ],
    'leakage-ai': [
      { key: 'risk', label: 'Risk', type: 'badge' }, { key: 'invoiceNumber', label: 'Invoice' }, { key: 'clientName', label: 'Client' }, { key: 'staffName', label: 'Staff' }, { key: 'amount', label: 'Amount', type: 'currency' }, { key: 'reason', label: 'Reason' }, { key: 'suggestedAction', label: 'Suggested action' }
    ],
    'line-audit': [
      { key: 'date', label: 'Date', type: 'date' }, { key: 'invoiceNumber', label: 'Invoice' }, { key: 'clientName', label: 'Client' }, { key: 'staffName', label: 'Staff' }, { key: 'itemType', label: 'Type', type: 'badge' }, { key: 'itemName', label: 'Item' }, { key: 'quantity', label: 'Qty', type: 'number' }, { key: 'gross', label: 'Gross', type: 'currency' }, { key: 'discount', label: 'Discount', type: 'currency' }, { key: 'gst', label: 'GST', type: 'currency' }, { key: 'final', label: 'Final', type: 'currency' }, { key: 'paymentModes', label: 'Payment' }
    ]
  };

  constructor(
    private readonly api: ApiService,
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
    const requestedReport = String(this.route.snapshot.queryParamMap.get('report') || '');
    if (requestedReport && this.reportDefinitions.some((report) => report.id === requestedReport)) {
      this.activeReport.set(requestedReport);
    }
    const requestedQuery = String(this.route.snapshot.queryParamMap.get('q') || '');
    if (requestedQuery) this.query = requestedQuery;
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.error.set('');
    this.notice.set('');
    forkJoin({
      invoices: this.safeList('invoices', { limit: 10000 }),
      sales: this.safeList('sales', { limit: 10000 }),
      payments: this.safeList('payments', { limit: 10000 }),
      clients: this.safeList('clients', { limit: 5000 }),
      products: this.safeList('products', { limit: 10000 }),
      staff: this.safeList('staff', { limit: 5000 }),
      branches: this.safeList('branches', { limit: 1000 }),
      walletTransactions: this.safeList('walletTransactions', { limit: 5000 }),
      auditLogs: this.safeList('auditLogs', { limit: 5000 }),
      invoiceActivityReport: this.loadInvoiceActivityReport(),
      dueRecovery: this.loadDueRecoveryReport(),
      serviceTrends: this.loadServiceTrendsReport(),
      serviceClients: this.loadServiceClientsReport()
    }).subscribe({
      next: (data) => {
        this.invoices.set(data.invoices || []);
        this.payments.set(data.payments || []);
        this.clients.set(data.clients || []);
        this.products.set(data.products || []);
        this.branches.set(data.branches || []);
        this.walletTransactions.set(data.walletTransactions || []);
        this.auditLogs.set(data.auditLogs || []);
        this.invoiceActivityReport.set(data.invoiceActivityReport || {});
        this.dueRecoverySummary.set(data.dueRecovery?.summary || {});
        this.dueRecoveryReportRows.set(data.dueRecovery?.rows || []);
        this.serviceTrendsSummary.set(data.serviceTrends?.summary || {});
        this.serviceTrendsReportRows.set(data.serviceTrends?.rows || []);
        this.serviceClientsSummary.set(data.serviceClients?.summary || {});
        this.serviceClientsReportRows.set(data.serviceClients?.rows || []);
        this.lines.set(this.buildLines(data.invoices || [], data.sales || [], data.payments || [], data.clients || [], data.staff || [], data.branches || [], data.products || []));
        this.loading.set(false);
      },
      error: (error) => {
        this.error.set(this.api.errorText(error, 'Unable to load invoice reports'));
        this.loading.set(false);
      }
    });
  }

  filteredLines(): InvoiceLine[] {
    const query = this.query.trim().toLowerCase();
    const applyProductFilters = this.activeReport() === 'products';
    const lines = this.lines().filter((line) => {
      const statusMatch = !this.status || (this.status === 'unpaid' ? line.due > 0 : String(line.status).toLowerCase().includes(this.status));
      const dateMatch = this.inDateRange(line.date);
      const clientMatch = !this.clientFilter || String(line.clientId || '') === String(this.clientFilter);
      const branchMatch = !this.branchFilter || String(line.branchId || '') === String(this.branchFilter);
      const staffMatch = !this.staffFilter || String(line.staffId || line.staffName || '') === String(this.staffFilter) || String(line.staffName || '') === String(this.staffFilter);
      const modeMatch = !this.paymentModeFilter || this.modeMatches(line.paymentModes, this.paymentModeFilter);
      const productMatch = !applyProductFilters || !this.productFilter || [line.productId, line.productSku, line.productBarcode, line.itemName].some((value) => String(value || '') === String(this.productFilter));
      const brandMatch = !applyProductFilters || !this.productBrandFilter || String(line.productBrand || '') === String(this.productBrandFilter);
      const categoryMatch = !applyProductFilters || !this.productCategoryFilter || String(line.productCategory || '') === String(this.productCategoryFilter);
      const gstMatch = !applyProductFilters || !this.gstRateFilter || String(line.gstRate) === String(this.gstRateFilter);
      const marginMatch = !applyProductFilters || this.matchesMarginFilter(line);
      const stockMatch = !applyProductFilters || !this.inventorySignalFilter || this.productStockSignal(line) === this.inventorySignalFilter;
      const text = `${line.invoiceNumber} ${line.clientName} ${line.clientPhone} ${line.staffName} ${line.itemName} ${line.itemType} ${line.productSku} ${line.productBarcode} ${line.productBrand} ${line.productCategory} ${line.branchName} ${line.paymentModes} ${line.couponCode} ${line.addedBy}`.toLowerCase();
      return statusMatch && dateMatch && clientMatch && branchMatch && staffMatch && modeMatch && productMatch && brandMatch && categoryMatch && gstMatch && marginMatch && stockMatch && (!query || text.includes(query));
    });
    return lines;
  }

  summary(): ApiRecord {
    const lines = this.filteredLines();
    const invoiceIds = new Set(lines.map((line) => line.invoiceId));
    const gross = this.sum(lines, 'gross');
    const discount = this.sum(lines, 'discount');
    const taxable = this.sum(lines, 'taxable');
    const gst = this.sum(lines, 'gst');
    const final = this.sum(lines, 'final');
    const due = this.uniqueInvoiceSum(lines, 'due');
    const products = this.sum(lines.filter((line) => line.itemType === 'product'), 'final');
    const memberships = this.sum(lines.filter((line) => ['membership', 'package'].includes(line.itemType)), 'final');
    return {
      invoices: invoiceIds.size,
      gross,
      discount,
      discountRate: gross ? this.money((discount / gross) * 100) : 0,
      taxable,
      gst,
      final,
      due,
      products,
      memberships
    };
  }

  saleSummary(): SaleSummary {
    const rows = this.saleSummaryRows();
    const totalSale = this.sum(rows, 'price');
    const returnSales = this.sum(rows.filter((row) => Number(row['price'] || 0) < 0 || String(row['status'] || '').toLowerCase().includes('return')), 'price');
    return {
      totalBill: rows.length,
      billAverage: rows.length ? this.money(totalSale / rows.length) : 0,
      totalSale,
      receivedAmount: this.sum(rows, 'paid'),
      pendingAmount: this.sum(rows, 'balance'),
      prepaidPayment: this.sum(rows, 'prepaid'),
      returnSales: Math.abs(returnSales),
      totalTipAmount: this.sum(rows, 'tipAmount'),
      totalTax: this.sum(rows, 'gst')
    };
  }

  productSalesSummary(): ProductSalesSummary {
    const rows = this.productSalesRows();
    return {
      totalProduct: rows.length,
      productsSale: this.sum(rows, 'totalPrice'),
      taxOnProducts: this.sum(rows, 'taxOnProducts'),
      taxableAmount: this.sum(rows, 'taxableAmount'),
      discount: this.sum(rows, 'discount'),
      productsSaleAfterDiscount: this.sum(rows, 'totalPriceAfterDiscount'),
      cogs: this.sum(rows, 'cogs'),
      grossMargin: this.sum(rows, 'grossMargin'),
      averageMarginPercent: this.weightedMarginPercent(rows),
      lowStockItems: rows.filter((row) => String(row['stockSignal'] || '').toLowerCase().includes('low') || String(row['stockSignal'] || '').toLowerCase().includes('stockout')).length,
      lowMarginItems: rows.filter((row) => String(row['lowMarginAlert'] || '').toLowerCase() !== 'healthy').length,
      repeatBuyerRows: rows.filter((row) => String(row['repeatBuyer'] || '').toLowerCase().includes('repeat')).length,
      reorderSuggestions: rows.filter((row) => String(row['reorderSuggestion'] || '').toLowerCase().includes('reorder')).length
    };
  }

  productSalesControlCards(): ApiRecord[] {
    const rows = this.productSalesRows();
    const topProduct = this.topBy(rows, 'product', 'totalPriceAfterDiscount');
    const topStaff = this.topBy(rows, 'staff', 'totalPriceAfterDiscount');
    const topCategory = this.topBy(rows, 'category', 'totalPriceAfterDiscount');
    const topClient = this.topBy(rows, 'name', 'totalPriceAfterDiscount');
    const marginSummary = this.productSalesSummary();
    return [
      { label: 'Top product', value: topProduct.label || '-', detail: topProduct.value ? this.formatMoney(topProduct.value) : 'No retail sale' },
      { label: 'Top staff', value: topStaff.label || '-', detail: topStaff.value ? this.formatMoney(topStaff.value) : 'No staff attribution' },
      { label: 'Top category', value: topCategory.label || '-', detail: topCategory.value ? this.formatMoney(topCategory.value) : 'Category from product master' },
      { label: 'Top retail client', value: topClient.label || '-', detail: topClient.value ? this.formatMoney(topClient.value) : 'No client retail history' },
      { label: 'Margin health', value: marginSummary.grossMargin > 0 ? 'Positive' : marginSummary.grossMargin < 0 ? 'Negative' : 'Unknown', detail: `${this.formatMoney(marginSummary.grossMargin)} / ${marginSummary.averageMarginPercent}%` },
      { label: 'Reorder queue', value: marginSummary.reorderSuggestions, detail: 'Sold products below threshold' },
      { label: 'Aftercare opportunity', value: rows.filter((row) => String(row['aftercareOpportunity'] || '').includes('Recommend')).length, detail: 'Client/product follow-up prompts' },
      { label: 'Accounting readiness', value: rows.filter((row) => Number(row['cogs'] || 0) > 0).length, detail: 'Rows with COGS available' }
    ];
  }

  salesDiscountSummary(): SalesDiscountSummary {
    const rows = this.salesDiscountRows();
    const grossSale = this.sum(rows, 'actualPrice');
    const totalDiscount = this.sum(rows, 'totalDiscount');
    const netSale = this.sum(rows, 'finalPrice');
    return {
      totalInvoices: rows.length,
      grossSale,
      totalDiscount,
      discountRate: grossSale ? this.money((totalDiscount / grossSale) * 100) : 0,
      netSale,
      manualDiscount: this.sum(rows, 'manualDiscount'),
      couponDiscount: this.sum(rows, 'couponDiscount'),
      membershipLoyaltyDiscount: this.sum(rows, 'membershipLoyaltyDiscount'),
      highRiskInvoices: rows.filter((row) => ['High risk', 'Critical risk', 'Owner approval'].some((token) => String(row['risk'] || row['approvalStatus'] || '').includes(token))).length,
      marginLossAlerts: rows.filter((row) => String(row['lossMakingInvoiceAlert'] || row['lowMarginAlert'] || '').toLowerCase().includes('loss') || String(row['lowMarginAlert'] || '').toLowerCase().includes('negative')).length
    };
  }

  salesDiscountSourceCards(): ApiRecord[] {
    const rows = this.salesDiscountRows();
    const ownerApproved = rows.filter((row) => String(row['approvalStatus'] || '').toLowerCase().includes('owner'));
    const staffApplied = rows.filter((row) => Number(row['manualDiscount'] || 0) > 0);
    return [
      { label: 'Manual discount', value: this.formatMoney(this.sum(rows, 'manualDiscount')), detail: `${staffApplied.length} invoice(s)` },
      { label: 'Coupon discount', value: this.formatMoney(this.sum(rows, 'couponDiscount')), detail: `${rows.filter((row) => row['couponCode']).length} coupon invoice(s)` },
      { label: 'Membership discount', value: this.formatMoney(this.sum(rows, 'membershipDiscount')), detail: 'Membership benefit source' },
      { label: 'Package benefit', value: this.formatMoney(this.sum(rows, 'packageBenefitDiscount')), detail: 'Package/service credit impact' },
      { label: 'Loyalty discount', value: this.formatMoney(this.sum(rows, 'loyaltyDiscount')), detail: 'Loyalty / points impact' },
      { label: 'Staff-applied', value: this.formatMoney(this.sum(staffApplied, 'manualDiscount')), detail: 'Counter/manual discount' },
      { label: 'Owner-approved', value: this.formatMoney(this.sum(ownerApproved, 'totalDiscount')), detail: `${ownerApproved.length} high approval invoice(s)` },
      { label: 'Missing reason', value: rows.filter((row) => row['discountReason'] === 'Reason missing').length, detail: 'Audit gap' }
    ];
  }

  salesDiscountStaffRows(): ApiRecord[] {
    return this.group(this.salesDiscountRows(), (row) => String(row['staffName'] || 'Unassigned'))
      .map((items) => {
        const gross = this.sum(items, 'actualPrice');
        const discount = this.sum(items, 'totalDiscount');
        const rate = gross ? this.money((discount / gross) * 100) : 0;
        return {
          staffName: items[0]['staffName'] || 'Unassigned',
          totalBills: items.length,
          grossSale: gross,
          discountGiven: discount,
          discountPercent: rate,
          netSale: this.sum(items, 'finalPrice'),
          highDiscountInvoiceCount: items.filter((row) => Number(row['discountRate'] || 0) >= 20).length,
          risk: this.discountRiskLabel(rate, discount, false, false)
        };
      })
      .sort((a, b) => Number(b['discountGiven']) - Number(a['discountGiven']));
  }

  salesDiscountClientRows(): ApiRecord[] {
    return this.group(this.salesDiscountRows(), (row) => String(row['clientId'] || row['clientName'] || 'Walk-in'))
      .map((items) => {
        const spent = this.sum(items, 'finalPrice');
        const discount = this.sum(items, 'totalDiscount');
        const gross = this.sum(items, 'actualPrice');
        const dependency = gross ? this.money((discount / gross) * 100) : 0;
        const isWalkIn = String(items[0]['clientName'] || '').toLowerCase().includes('walk');
        return {
          clientName: items[0]['clientName'],
          phone: items[0]['clientPhone'],
          totalVisits: items.length,
          totalSpent: spent,
          totalDiscountReceived: discount,
          discountDependencyPercent: dependency,
          repeatDiscountRisk: dependency >= 20 || items.length >= 3 ? 'Repeat discount risk' : 'Normal',
          walkInDiscountRisk: isWalkIn && discount > 0 ? 'Walk-in discount risk' : 'No walk-in risk'
        };
      })
      .sort((a, b) => Number(b['totalDiscountReceived']) - Number(a['totalDiscountReceived']));
  }

  salesDiscountRiskRows(): ApiRecord[] {
    return this.salesDiscountRows().filter((row) => this.isSalesDiscountRiskRow(row));
  }

  isSalesDiscountRiskRow = (row: ApiRecord): boolean => {
    return ['high', 'critical', 'owner', 'missing', 'negative', 'loss', 'suspicious'].some((token) =>
      `${row['risk']} ${row['approvalStatus']} ${row['discountReason']} ${row['lowMarginAlert']} ${row['lossMakingInvoiceAlert']} ${row['suspiciousDiscountAlert']}`.toLowerCase().includes(token)
    );
  };

  activeDefinition(): ReportDefinition {
    return this.reportDefinitions.find((report) => report.id === this.activeReport()) || this.reportDefinitions[0];
  }

  activeColumns(): ReportColumn[] {
    return this.columns[this.activeReport()] || this.columns['line-audit'];
  }

  activeRows(): ApiRecord[] {
    const report = this.activeReport();
    if (report === 'sale-summary') return this.saleSummaryRows();
    if (report === 'service-trends') return this.serviceTrendsRows();
    if (report === 'service-clients') return this.serviceClientsRows();
    if (report === 'sales-discount-intelligence') return this.salesDiscountRows();
    if (report === 'overview') return this.overviewRows();
    if (report === 'staff-services') return this.staffServiceRows();
    if (report === 'staff-discounts') return this.staffDiscountRows();
    if (report === 'products') return this.productSalesRows();
    if (report === 'memberships') return this.membershipRows();
    if (report === 'gst') return this.gstRows();
    if (report === 'payments') return this.paymentRows();
    if (report === 'due-aging') return this.dueRows();
    if (report === 'due-recovery') return this.dueRecoveryRows();
    if (report === 'staff-unpaid') return this.staffUnpaidRows();
    if (report === 'wallet') return this.walletRows();
    if (report === 'audit') return this.auditRows();
    if (report === 'deleted-invoice-approvals') return this.deletedInvoiceApprovalRows();
    if (report === 'branch-closing') return this.branchClosingRows();
    if (report === 'commission') return this.commissionRows();
    if (report === 'discount-approval') return this.discountApprovalRows();
    if (report === 'client-profit') return this.clientProfitRows();
    if (report === 'package-liability') return this.packageLiabilityRows();
    if (report === 'delivery') return this.deliveryRows();
    if (report === 'leakage-ai') return this.leakageRows();
    return this.filteredLines();
  }

  executiveInsights(): ApiRecord[] {
    const summary = this.summary();
    const highDiscount = this.discountApprovalRows().filter((row) => Number(row['discountRate'] || 0) >= 20).length;
    const noStaff = this.filteredLines().filter((line) => !line.staffName || line.staffName === 'Unassigned').length;
    const dueInvoices = this.dueRows().length;
    const missingPhone = this.deliveryRows().filter((row) => row['readiness'] === 'Missing phone').length;
    return [
      { label: 'Discount leakage radar', value: `${highDiscount} invoice(s)`, detail: `${summary.discountRate}% average discount` },
      { label: 'Unassigned staff lines', value: noStaff, detail: 'Commission and accountability risk' },
      { label: 'Due recovery queue', value: dueInvoices, detail: 'Invoices still pending' },
      { label: 'WhatsApp PDF blockers', value: missingPhone, detail: 'Client phone missing' }
    ];
  }

  formatCell(row: ApiRecord, column: ReportColumn): string {
    const value = row[column.key];
    if (column.type === 'currency') return `₹${this.money(Number(value || 0)).toLocaleString('en-IN')}`;
    if (column.type === 'percent') return `${this.money(Number(value || 0))}%`;
    if (column.type === 'number') return `${this.money(Number(value || 0)).toLocaleString('en-IN')}`;
    if (column.type === 'date') return value ? new Date(String(value)).toLocaleDateString('en-IN') : '-';
    return value === undefined || value === null || value === '' ? '-' : String(value);
  }

  isRight(column: ReportColumn): boolean {
    return ['currency', 'number', 'percent'].includes(column.type || '');
  }

  searchPlaceholder(): string {
    if (this.activeReport() === 'sale-summary') return 'Invoice, name or phone';
    if (this.activeReport() === 'service-trends') return 'Service, group, staff, client or invoice';
    if (this.activeReport() === 'service-clients') return 'Client, phone, service, staff or invoice';
    if (this.activeReport() === 'sales-discount-intelligence') return 'Invoice, client, staff, service, coupon or reason';
    if (this.activeReport() === 'deleted-invoice-approvals') return 'Name, phone, invoice, deleted by or approval reason';
    if (this.activeReport() === 'products') return 'Product, brand, category, SKU, barcode, customer or invoice';
    return 'Invoice, client, staff, service, product, payment mode';
  }

  isServiceReport(): boolean {
    return ['service-trends', 'service-clients'].includes(this.activeReport());
  }

  branchLabel(): string {
    const branchId = this.api.selectedBranchId();
    if (!branchId) return 'All branches';
    return this.branches().find((branch) => String(branch.id) === String(branchId))?.name || branchId;
  }

  exportCsv(): void {
    const columns = this.activeColumns();
    const rows = this.activeRows();
    const csv = [
      columns.map((column) => this.csvCell(column.label)).join(','),
      ...rows.map((row) => columns.map((column) => this.csvCell(this.formatCell(row, column))).join(','))
    ].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `invoice-report-${this.activeReport()}-${Date.now()}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  exportPdf(): void {
    const report = this.activeDefinition();
    const rows = this.activeRows();
    const summaryLines = this.activeReport() === 'sales-discount-intelligence'
      ? this.salesDiscountExportSummaryLines()
      : this.activeReport() === 'deleted-invoice-approvals'
        ? this.deletedInvoiceExportSummaryLines()
        : this.activeReport() === 'due-recovery'
          ? this.dueRecoveryExportSummaryLines()
          : this.unpaidExportSummaryLines();
    const body = [
      `${report.title}`,
      `Generated: ${new Date().toLocaleString('en-IN')}`,
      `Date range: ${this.from || 'All'} to ${this.to || 'All'}`,
      ...summaryLines,
      '',
      ...rows.slice(0, 80).map((row, index) => {
        const cells = this.activeColumns().map((column) => `${column.label}: ${this.formatCell(row, column)}`).join(' | ');
        return `${index + 1}. ${cells}`;
      })
    ];
    this.downloadFile(`invoice-report-${this.activeReport()}-${Date.now()}.pdf`, this.simplePdf(body), 'application/pdf');
  }

  exportProductOwnerPdf(): void {
    const summary = this.productSalesSummary();
    const cards = this.productSalesControlCards();
    const rows = this.productSalesRows();
    const body = [
      'Product Sales Owner Summary',
      `Generated: ${new Date().toLocaleString('en-IN')}`,
      `Date range: ${this.from || 'All'} to ${this.to || 'All'}`,
      `Branch: ${this.branchFilter ? this.branchFilterOptions().find((branch) => branch.id === this.branchFilter)?.label || this.branchFilter : this.branchLabel()}`,
      '',
      `Products sold: ${summary.totalProduct}`,
      `Net retail sale: ${this.formatMoney(summary.productsSaleAfterDiscount)}`,
      `COGS: ${this.formatMoney(summary.cogs)}`,
      `Gross margin: ${this.formatMoney(summary.grossMargin)} (${summary.averageMarginPercent}%)`,
      `Low margin alerts: ${summary.lowMarginItems}`,
      `Low stock / stockout: ${summary.lowStockItems}`,
      `Reorder suggestions: ${summary.reorderSuggestions}`,
      `Repeat buyer rows: ${summary.repeatBuyerRows}`,
      '',
      ...cards.map((card) => `${card['label']}: ${card['value']} - ${card['detail']}`),
      '',
      'Top product rows',
      ...rows.slice(0, 30).map((row, index) => `${index + 1}. ${row['product']} | ${row['name']} | ${this.formatMoney(Number(row['totalPriceAfterDiscount'] || 0))} | ${row['stockSignal']} | ${row['lowMarginAlert']}`)
    ];
    this.downloadFile(`product-sales-owner-summary-${Date.now()}.pdf`, this.simplePdf(body), 'application/pdf');
  }

  exportSalesDiscountOwnerPdf(): void {
    const summary = this.salesDiscountSummary();
    const staffRows = this.salesDiscountStaffRows();
    const clientRows = this.salesDiscountClientRows();
    const riskRows = this.salesDiscountRiskRows();
    const body = [
      'Sales Discount Intelligence Owner Summary',
      `Generated: ${new Date().toLocaleString('en-IN')}`,
      `Date range: ${this.from || 'All'} to ${this.to || 'All'}`,
      `Branch: ${this.branchFilter ? this.branchFilterOptions().find((branch) => branch.id === this.branchFilter)?.label || this.branchFilter : this.branchLabel()}`,
      '',
      `Total discount: ${this.formatMoney(summary.totalDiscount)} (${summary.discountRate}%)`,
      `Gross sale: ${this.formatMoney(summary.grossSale)}`,
      `Net sale: ${this.formatMoney(summary.netSale)}`,
      `Manual discount: ${this.formatMoney(summary.manualDiscount)}`,
      `Coupon discount: ${this.formatMoney(summary.couponDiscount)}`,
      `Membership / loyalty discount: ${this.formatMoney(summary.membershipLoyaltyDiscount)}`,
      `High-risk invoices: ${summary.highRiskInvoices}`,
      `Margin loss alerts: ${summary.marginLossAlerts}`,
      '',
      'Top staff by discount',
      ...staffRows.slice(0, 8).map((row, index) => `${index + 1}. ${row['staffName']} | ${this.formatMoney(Number(row['discountGiven'] || 0))} | ${row['discountPercent']}% | ${row['risk']}`),
      '',
      'Top clients by discount',
      ...clientRows.slice(0, 8).map((row, index) => `${index + 1}. ${row['clientName']} | ${this.formatMoney(Number(row['totalDiscountReceived'] || 0))} | ${row['discountDependencyPercent']}% | ${row['repeatDiscountRisk']}`),
      '',
      'High-risk invoices',
      ...riskRows.slice(0, 12).map((row, index) => `${index + 1}. ${row['invoiceNumber']} | ${row['clientName']} | ${this.formatMoney(Number(row['totalDiscount'] || 0))} | ${row['approvalStatus']} | ${row['suspiciousDiscountAlert']}`)
    ];
    this.downloadFile(`sales-discount-intelligence-owner-${Date.now()}.pdf`, this.simplePdf(body), 'application/pdf');
  }

  exportProductAccountingCsv(): void {
    const columns = [
      'Invoice Date', 'Invoice No', 'Client', 'Product', 'SKU / Barcode', 'GST %', 'Taxable', 'GST',
      'Gross Sale', 'Discount', 'Net Sale', 'COGS', 'Gross Margin', 'Payment Mode', 'Accounting Code'
    ];
    const rows = this.productSalesRows().map((row) => [
      row['date'], row['invoiceNo'], row['name'], row['product'], row['skuBarcode'], row['taxPercent'], row['taxableAmount'], row['taxOnProducts'],
      row['totalPrice'], row['discount'], row['totalPriceAfterDiscount'], row['cogs'], row['grossMargin'], row['paymentModes'], row['accountingCode']
    ]);
    const csv = [columns, ...rows].map((row) => row.map((cell) => this.csvCell(cell)).join(',')).join('\n');
    this.downloadFile(`product-sales-accounting-${Date.now()}.csv`, csv, 'text/csv;charset=utf-8');
  }

  private overviewRows(): ApiRecord[] {
    const summary = this.summary();
    return [
      { metric: 'Gross billed', value: summary.gross, count: summary.invoices, note: 'Before discount' },
      { metric: 'Discount', value: summary.discount, count: this.discountApprovalRows().length, note: `${summary.discountRate}% average` },
      { metric: 'Taxable value', value: summary.taxable, count: this.filteredLines().length, note: 'GST base' },
      { metric: 'GST collected', value: summary.gst, count: this.gstRows().length, note: 'Rate-wise breakup available' },
      { metric: 'Final sale', value: summary.final, count: summary.invoices, note: 'After discount and GST' },
      { metric: 'Due', value: summary.due, count: this.dueRows().length, note: 'Open recovery queue' },
      { metric: 'Wallet liability', value: this.sum(this.walletRows(), 'walletBalance'), count: this.walletRows().length, note: 'Client wallet balance' }
    ];
  }

  private saleSummaryRows(): ApiRecord[] {
    return this.uniqueInvoiceRows().map((line) => {
      const invoiceLines = this.filteredLines().filter((item) => item.invoiceId === line.invoiceId);
      const itemDescription = [...new Set(invoiceLines.map((item) => item.itemName).filter(Boolean))].join(', ');
      const itemTypes = [...new Set(invoiceLines.map((item) => item.itemType).filter(Boolean))].join(', ');
      return {
        invoiceSortAt: line.date,
        invoiceNumber: line.invoiceNumber,
        clientName: line.clientName,
        clientPhone: line.clientPhone,
        itemDescription,
        itemTypes,
        actualPrice: this.sum(invoiceLines, 'gross'),
        price: this.sum(invoiceLines, 'final'),
        paid: line.paid,
        prepaid: this.uniqueInvoiceSum(invoiceLines, 'prepaidAmount'),
        balance: line.due,
        modes: line.paymentModes,
        status: line.status,
        date: this.dateKey(line.date),
        addedBy: line.addedBy,
        invoiceDate: `${this.dateKey(line.date)} ${this.timeLabel(line.date)}`.trim(),
        couponCode: line.couponCode,
        couponDiscount: this.uniqueInvoiceSum(invoiceLines, 'couponDiscount'),
        loyaltyDiscount: this.uniqueInvoiceSum(invoiceLines, 'loyaltyDiscount'),
        gst: this.sum(invoiceLines, 'gst'),
        tipAmount: this.uniqueInvoiceSum(invoiceLines, 'tipAmount')
      };
    }).sort((a, b) => this.dateMs(b['invoiceSortAt']) - this.dateMs(a['invoiceSortAt']) || String(b['invoiceNumber']).localeCompare(String(a['invoiceNumber'])));
  }

  private salesDiscountRows(): ApiRecord[] {
    return this.uniqueInvoiceRows().map((line) => {
      const invoiceLines = this.filteredLines().filter((item) => item.invoiceId === line.invoiceId);
      const actualPrice = this.sum(invoiceLines, 'gross');
      const lineDiscount = this.sum(invoiceLines, 'discount');
      const couponDiscount = this.uniqueInvoiceSum(invoiceLines, 'couponDiscount');
      const loyaltyDiscount = this.uniqueInvoiceSum(invoiceLines, 'loyaltyDiscount');
      const membershipDiscount = this.uniqueInvoiceSum(invoiceLines, 'membershipDiscount');
      const packageBenefitDiscount = this.sum(invoiceLines.filter((item) => item.itemType === 'package'), 'discount');
      const membershipLoyaltyDiscount = this.money(loyaltyDiscount + membershipDiscount + packageBenefitDiscount);
      const manualDiscount = this.money(Math.max(0, lineDiscount - packageBenefitDiscount));
      const totalDiscount = this.money(lineDiscount + couponDiscount + loyaltyDiscount + membershipDiscount);
      const taxable = this.sum(invoiceLines, 'taxable');
      const cogs = this.money(invoiceLines.filter((item) => item.itemType === 'product').reduce((sum, item) => sum + item.productUnitCost * item.quantity, 0));
      const staffCommissionImpact = this.money(
        this.sum(invoiceLines.filter((item) => item.itemType === 'service'), 'taxable') * 0.1
        + this.sum(invoiceLines.filter((item) => item.itemType === 'product'), 'taxable') * 0.05
        + this.sum(invoiceLines.filter((item) => ['membership', 'package'].includes(item.itemType)), 'taxable') * 0.03
      );
      const grossMargin = this.money(taxable - cogs - staffCommissionImpact);
      const marginPercent = taxable > 0 ? this.money((grossMargin / taxable) * 100) : 0;
      const discountRate = actualPrice ? this.money((totalDiscount / actualPrice) * 100) : 0;
      const discountReason = this.discountReasonForInvoice(line.invoiceId, totalDiscount, discountRate);
      const approvalStatus = this.discountApprovalStatus(discountRate, discountReason, grossMargin);
      const risk = this.discountRiskLabel(discountRate, totalDiscount, discountReason === 'Reason missing', grossMargin < 0);
      const invoiceEditedAfterDiscount = this.invoiceEditedAfterDiscount(line.invoiceId, line.invoiceNumber) ? 'Edited after discount' : 'No edit linked';
      const suspiciousDiscountAlert = this.suspiciousDiscountAlert(discountRate, discountReason, grossMargin, invoiceEditedAfterDiscount);
      return {
        invoiceId: line.invoiceId,
        invoiceNumber: line.invoiceNumber,
        invoiceDate: this.dateKey(line.date),
        invoiceTime: this.timeLabel(line.date),
        clientId: line.clientId,
        clientName: line.clientName,
        clientPhone: line.clientPhone,
        staffId: line.staffId,
        staffName: line.staffName,
        serviceProductNames: [...new Set(invoiceLines.map((item) => item.itemName).filter(Boolean))].join(', '),
        itemTypes: [...new Set(invoiceLines.map((item) => item.itemType).filter(Boolean))].join(', '),
        actualPrice,
        totalDiscount,
        manualDiscount,
        couponCode: line.couponCode,
        couponDiscount,
        loyaltyDiscount,
        membershipDiscount,
        packageBenefitDiscount,
        membershipLoyaltyDiscount,
        finalPrice: this.sum(invoiceLines, 'final'),
        paymentMode: line.paymentModes,
        status: line.status,
        discountRate,
        discountGivenBy: line.addedBy,
        userRole: this.discountUserRole(line.addedBy),
        discountReason,
        approvalStatus,
        invoiceEditedAfterDiscount,
        suspiciousDiscountAlert,
        cogs,
        staffCommissionImpact,
        grossMargin,
        marginPercent,
        lowMarginAlert: this.invoiceMarginAlert(marginPercent, cogs, taxable),
        lossMakingInvoiceAlert: grossMargin < 0 ? 'Loss-making invoice' : 'No loss',
        risk
      };
    }).filter((row) => Number(row['totalDiscount'] || 0) > 0)
      .filter((row) => this.matchesSalesDiscountFilters(row))
      .sort((a, b) => Number(b['totalDiscount']) - Number(a['totalDiscount']) || this.dateMs(String(b['invoiceDate'])) - this.dateMs(String(a['invoiceDate'])));
  }

  private matchesSalesDiscountFilters(row: ApiRecord): boolean {
    const sourceMatch = !this.discountTypeFilter || this.discountSourceMatches(row, this.discountTypeFilter);
    const couponMatch = !this.couponCodeFilter || String(row['couponCode'] || '') === String(this.couponCodeFilter);
    const itemMatch = !this.serviceProductFilter || String(row['serviceProductNames'] || '').split(',').map((item) => item.trim()).includes(this.serviceProductFilter);
    const bucketMatch = !this.discountBucketFilter || this.discountBucket(Number(row['discountRate'] || 0)) === this.discountBucketFilter;
    const riskMatch = !this.discountRiskFilter || String(row['risk'] || '').toLowerCase().includes(this.discountRiskFilter);
    return sourceMatch && couponMatch && itemMatch && bucketMatch && riskMatch;
  }

  private discountSourceMatches(row: ApiRecord, source: string): boolean {
    if (source === 'manual') return Number(row['manualDiscount'] || 0) > 0;
    if (source === 'coupon') return Number(row['couponDiscount'] || 0) > 0;
    if (source === 'membership') return Number(row['membershipDiscount'] || 0) > 0 || Number(row['loyaltyDiscount'] || 0) > 0;
    if (source === 'package') return Number(row['packageBenefitDiscount'] || 0) > 0;
    if (source === 'owner') return String(row['approvalStatus'] || '').toLowerCase().includes('owner');
    return true;
  }

  private discountBucket(rate: number): string {
    if (rate >= 20) return '20+';
    if (rate >= 10) return '10-20';
    if (rate >= 5) return '5-10';
    return '0-5';
  }

  private discountRiskLabel(rate: number, discount: number, missingReason: boolean, negativeMargin: boolean): string {
    if (negativeMargin) return 'Critical risk';
    if (missingReason && rate >= 10) return 'High risk';
    if (rate >= 20 || discount >= 5000) return 'High risk';
    if (rate >= 10) return 'Review';
    return 'Normal';
  }

  private discountApprovalStatus(rate: number, reason: string, grossMargin: number): string {
    if (grossMargin < 0) return 'Owner approval missing';
    if (rate >= 20) return 'Owner approval';
    if (rate >= 10) return reason === 'Reason missing' ? 'Manager review missing' : 'Manager review';
    if (rate >= 5) return 'Watch';
    return 'Normal';
  }

  private discountReasonForInvoice(invoiceId: string, discount: number, rate: number): string {
    if (discount <= 0) return 'No discount';
    const audit = this.auditLogs().find((log) => {
      const text = `${log.action || ''} ${log.entityType || log.entity_type || ''} ${log.entityId || log.entity_id || ''} ${log.invoiceId || log.invoice_id || ''} ${log.reason || ''} ${log.note || ''} ${JSON.stringify(log.details || {})}`.toLowerCase();
      return text.includes(String(invoiceId).toLowerCase()) && text.includes('discount');
    });
    const reason = audit?.['reason'] || audit?.['note'] || (audit?.['details'] as ApiRecord | undefined)?.['reason'];
    if (reason) return String(reason);
    return rate >= 5 ? 'Reason missing' : 'Routine discount';
  }

  private invoiceEditedAfterDiscount(invoiceId: string, invoiceNumber: string): boolean {
    return this.auditLogs().some((log) => {
      const action = String(log.action || log.event || log.type || '').toLowerCase();
      const text = `${log.entityType || log.entity_type || ''} ${log.entityId || log.entity_id || ''} ${log.invoiceId || log.invoice_id || ''} ${log.message || ''} ${JSON.stringify(log.details || {})}`.toLowerCase();
      return (text.includes(String(invoiceId).toLowerCase()) || text.includes(String(invoiceNumber).toLowerCase()))
        && ['edit', 'update', 'changed', 'discount'].some((token) => action.includes(token) || text.includes(token));
    });
  }

  private suspiciousDiscountAlert(rate: number, reason: string, margin: number, edited: string): string {
    if (margin < 0) return 'Negative margin after discount';
    if (rate >= 20 && reason === 'Reason missing') return 'High discount without reason';
    if (edited.includes('Edited')) return 'Discount edited after invoice';
    if (rate >= 10 && reason === 'Reason missing') return 'Reason missing';
    return 'No suspicious alert';
  }

  private invoiceMarginAlert(marginPercent: number, cogs: number, taxable: number): string {
    if (taxable > 0 && cogs <= 0) return 'Cost missing';
    if (marginPercent < 0) return 'Negative margin';
    if (marginPercent < 20) return 'Low margin';
    return 'Healthy';
  }

  private discountUserRole(addedBy: string): string {
    const value = String(addedBy || '').toLowerCase();
    if (value.includes('owner') || value.includes('admin')) return 'Owner/Admin';
    if (value.includes('manager')) return 'Manager';
    if (value.includes('counter') || value.includes('cashier')) return 'Cashier';
    return addedBy ? 'Staff/User' : 'Audit not linked';
  }

  private staffServiceRows(): ApiRecord[] {
    return this.group(this.filteredLines().filter((line) => line.itemType === 'service'), (line) => `${line.staffName}|${line.itemName}`)
      .map((items) => ({
        staffName: items[0].staffName,
        serviceName: items[0].itemName,
        qty: this.sum(items, 'quantity'),
        withoutDiscount: this.sum(items, 'gross'),
        discount: this.sum(items, 'discount'),
        withDiscount: this.sum(items, 'taxable'),
        gst: this.sum(items, 'gst'),
        final: this.sum(items, 'final'),
        invoices: new Set(items.map((item) => item.invoiceId)).size
      }))
      .sort((a, b) => Number(b['final']) - Number(a['final']));
  }

  private staffDiscountRows(): ApiRecord[] {
    return this.group(this.filteredLines(), (line) => line.staffName || 'Unassigned')
      .map((items) => {
        const gross = this.sum(items, 'gross');
        const discount = this.sum(items, 'discount');
        const serviceRevenue = this.sum(items.filter((line) => line.itemType === 'service'), 'final');
        const productRevenue = this.sum(items.filter((line) => line.itemType === 'product'), 'final');
        const membershipRevenue = this.sum(items.filter((line) => ['membership', 'package'].includes(line.itemType)), 'final');
        const rate = gross ? this.money((discount / gross) * 100) : 0;
        return {
          staffName: items[0].staffName,
          withoutDiscount: gross,
          withDiscount: this.sum(items, 'taxable'),
          discount,
          discountRate: rate,
          serviceRevenue,
          productRevenue,
          membershipRevenue,
          risk: rate >= 25 ? 'High' : rate >= 12 ? 'Watch' : 'Normal'
        };
      })
      .sort((a, b) => Number(b['discount']) - Number(a['discount']));
  }

  private itemRows(type: string): ApiRecord[] {
    return this.group(this.filteredLines().filter((line) => line.itemType === type), (line) => `${line.itemName}|${line.staffName}`)
      .map((items) => ({
        itemName: items[0].itemName,
        staffName: items[0].staffName,
        qty: this.sum(items, 'quantity'),
        gross: this.sum(items, 'gross'),
        discount: this.sum(items, 'discount'),
        taxable: this.sum(items, 'taxable'),
        gst: this.sum(items, 'gst'),
        final: this.sum(items, 'final'),
        invoices: new Set(items.map((item) => item.invoiceId)).size
      }))
      .sort((a, b) => Number(b['final']) - Number(a['final']));
  }

  private productSalesRows(): ApiRecord[] {
    return this.filteredLines()
      .filter((line) => line.itemType === 'product')
      .map((line) => {
        const cost = this.money(line.productUnitCost * line.quantity);
        const margin = this.money(line.taxable - cost);
        const marginPercent = line.taxable > 0 && cost > 0 ? this.money((margin / line.taxable) * 100) : 0;
        const stockAfterSale = this.money(line.productStock);
        const stockBeforeSale = this.money(stockAfterSale + line.quantity);
        const reorderLevel = Math.max(line.productLowStockThreshold || 0, line.quantity * 2, 2);
        const repeatCount = this.clientProductPurchaseCount(line.clientId, line.itemName);
        return {
          product: line.itemName,
          brand: line.productBrand || '-',
          category: line.productCategory || 'Retail',
          name: line.clientName,
          contact: line.clientPhone,
          invoiceNo: line.invoiceNumber,
          qty: line.quantity,
          price: line.rate,
          costPrice: line.productUnitCost,
          cogs: cost,
          totalPrice: line.gross,
          taxPercent: line.gstRate,
          taxOnProducts: line.gst,
          taxableAmount: line.taxable,
          discount: line.discount,
          totalPriceAfterDiscount: line.final,
          staff: line.staffName,
          date: this.dateKey(line.date),
          paymentModes: line.paymentModes,
          skuBarcode: [line.productSku, line.productBarcode].filter(Boolean).join(' / ') || '-',
          soldVsStock: `${line.quantity} sold / ${stockAfterSale} in stock`,
          stockSignal: this.productStockSignal(line),
          stockDeductionTrail: line.productId ? `Invoice ${line.invoiceNumber} -> stock ${stockBeforeSale} to ${stockAfterSale}` : 'Product not mapped',
          fifoSource: this.productFifoSource(line),
          expiryDate: line.productExpiryDate || '-',
          reorderSuggestion: this.productReorderSuggestion(line, reorderLevel),
          grossMargin: margin,
          marginPercent,
          lowMarginAlert: this.marginAlert(line, marginPercent),
          commissionBase: Math.max(0, line.taxable),
          retailTargetAchievement: this.staffRetailTargetAchievement(line.staffName),
          repeatBuyer: repeatCount > 1 ? `Repeat buyer x${repeatCount}` : 'First retail buy',
          aftercareOpportunity: this.aftercareOpportunity(line, repeatCount),
          accountingCode: this.productAccountingCode(line),
          branch: line.branchName
        };
      })
      .sort((a, b) => this.dateMs(String(b['date'])) - this.dateMs(String(a['date'])) || Number(b['totalPriceAfterDiscount']) - Number(a['totalPriceAfterDiscount']));
  }

  private membershipRows(): ApiRecord[] {
    return this.group(this.filteredLines().filter((line) => ['membership', 'package'].includes(line.itemType)), (line) => `${line.itemName}|${line.staffName}`)
      .map((items) => ({
        itemName: items[0].itemName,
        staffName: items[0].staffName,
        qty: this.sum(items, 'quantity'),
        gross: this.sum(items, 'gross'),
        discount: this.sum(items, 'discount'),
        final: this.sum(items, 'final'),
        liability: this.money(this.sum(items, 'final') * 0.35),
        invoices: new Set(items.map((item) => item.invoiceId)).size
      }))
      .sort((a, b) => Number(b['final']) - Number(a['final']));
  }

  private gstRows(): ApiRecord[] {
    return this.group(this.filteredLines(), (line) => `${line.gstRate}|${line.itemType}`)
      .map((items) => ({
        gstRate: items[0].gstRate,
        itemType: items[0].itemType,
        taxable: this.sum(items, 'taxable'),
        gst: this.sum(items, 'gst'),
        cgst: this.money(this.sum(items, 'gst') / 2),
        sgst: this.money(this.sum(items, 'gst') / 2),
        final: this.sum(items, 'final'),
        lines: items.length
      }))
      .sort((a, b) => Number(b['gst']) - Number(a['gst']));
  }

  private paymentRows(): ApiRecord[] {
    const rows = this.paymentsForFilteredInvoices();
    return this.group(rows, (payment) => String(payment.mode || 'unknown'))
      .map((items) => ({
        mode: this.modeLabel(String(items[0].mode || 'unknown')),
        amount: this.sum(items, 'amount'),
        invoices: new Set(items.map((item) => String(item.invoiceId || ''))).size,
        splitCount: items.length,
        risk: items.some((item) => !item.reference) ? 'Needs reference' : 'Matched'
      }))
      .sort((a, b) => Number(b['amount']) - Number(a['amount']));
  }

  private dueRows(): ApiRecord[] {
    const invoiceRows = this.uniqueInvoiceRows().filter((line) => line.due > 0 || this.dueRecoveryPayments(line.invoiceId).length > 0);
    return invoiceRows.map((line) => {
      const invoiceLines = this.filteredLines().filter((item) => item.invoiceId === line.invoiceId);
      const recoveryPayments = this.dueRecoveryPayments(line.invoiceId);
      const latestRecovery = recoveryPayments[recoveryPayments.length - 1] || null;
      const receivedAmount = this.money(recoveryPayments.reduce((sum, payment) => sum + this.paymentAmount(payment), 0));
      const lastPaymentDate = this.lastPaymentDate(line.invoiceId);
      const unpaidSinceDate = lastPaymentDate || line.date;
      const unpaidSinceDays = this.ageDays(unpaidSinceDate);
      const invoiceAgeDays = this.ageDays(line.date);
      const lastRecoveryTouchDate = this.lastRecoveryTouchDate(line.invoiceId, line.invoiceNumber, line.clientId);
      const bucket = this.unpaidBucket(line.due > 0 ? invoiceAgeDays : this.recoveryDays(line.date, latestRecovery));
      const paymentStatus = this.unpaidRecoveryStatus(line.due, receivedAmount);
      const paymentMode = latestRecovery ? this.paymentMode(latestRecovery) : '';
      const receiverId = latestRecovery ? this.paymentReceiverId(latestRecovery) : '';
      return {
        invoiceId: line.invoiceId,
        invoiceNumber: line.invoiceNumber,
        originalInvoiceDate: this.dateKey(line.date),
        originalInvoiceTime: this.timeLabel(line.date),
        clientName: line.clientName,
        clientPhone: line.clientPhone,
        staffName: line.staffName,
        staffId: line.staffId,
        serviceNames: this.serviceNamesForInvoice(invoiceLines),
        totalAmount: this.invoiceTotal(line.invoiceId),
        date: line.date,
        due: line.due,
        paid: line.paid,
        paymentStatus,
        lastPaymentDate,
        unpaidSinceDays,
        invoiceAgeDays,
        lastRecoveryTouchDate,
        lastRecoveryTouchDays: lastRecoveryTouchDate ? this.ageDays(lastRecoveryTouchDate) : '',
        ageDays: unpaidSinceDays,
        bucket,
        recoveryAction: this.recoveryAction(invoiceAgeDays),
        duePaidDate: latestRecovery ? this.dateKey(this.paymentDate(latestRecovery)) : '',
        duePaidTime: latestRecovery ? this.timeLabel(this.paymentDate(latestRecovery)) : '',
        receivedAmount,
        paymentMode: paymentMode ? this.modeLabel(paymentMode) : '',
        receivedBy: latestRecovery ? this.paymentReceiver(latestRecovery) : '',
        receiverId,
        settlementPaymentId: latestRecovery ? this.paymentSettlementId(latestRecovery) : '',
        paymentReference: latestRecovery ? this.paymentReference(latestRecovery) : '',
        daysToRecovery: latestRecovery ? this.recoveryDays(line.date, latestRecovery) : '',
        partialPaymentHistory: this.partialPaymentHistory(recoveryPayments)
      };
    }).filter((row) => this.matchesRecoveryFilters(row))
      .sort((a, b) => Number(b['due']) - Number(a['due']) || Number(b['receivedAmount']) - Number(a['receivedAmount']));
  }

  private staffUnpaidRows(): ApiRecord[] {
    const serviceLines = this.filteredLines().filter((line) => line.itemType === 'service');
    return this.group(serviceLines, (line) => `${line.staffName || 'Unassigned'}|${line.itemName || 'Service'}`)
      .map((items) => {
        const invoiceIds = new Set(items.map((item) => item.invoiceId));
        const pendingDue = this.money(items.reduce((sum, line) => sum + this.lineDueShare(line), 0));
        const totalRecovered = this.money(items.reduce((sum, line) => sum + this.lineRecoveredShare(line), 0));
        const totalUnpaid = this.money(pendingDue + totalRecovered);
        const recoveryRate = totalUnpaid > 0 ? this.money((totalRecovered / totalUnpaid) * 100) : 0;
        return {
          staffName: items[0].staffName,
          serviceName: items[0].itemName,
          invoiceCount: invoiceIds.size,
          totalBilled: this.sum(items, 'final'),
          totalUnpaid,
          totalRecovered,
          pendingDue,
          recoveryRate
        };
      })
      .filter((row) => Number(row['totalUnpaid']) > 0 || Number(row['pendingDue']) > 0)
      .sort((a, b) => Number(b['pendingDue']) - Number(a['pendingDue']) || Number(b['totalUnpaid']) - Number(a['totalUnpaid']));
  }

  private matchesRecoveryFilters(row: ApiRecord): boolean {
    const statusMatch = this.recoveryStatus === 'all' || row['paymentStatus'] === this.recoveryStatus;
    const bucketMatch = !this.agingBucket || row['bucket'] === this.agingBucket;
    const modeMatch = !this.paymentModeFilter || String(row['paymentMode'] || '').toLowerCase() === this.modeLabel(this.paymentModeFilter).toLowerCase();
    const receiverMatch = !this.receivedByFilter || String(row['receiverId'] || '') === String(this.receivedByFilter);
    return statusMatch && bucketMatch && modeMatch && receiverMatch;
  }

  private dueRecoveryPayments(invoiceId: string): ApiRecord[] {
    return this.payments()
      .filter((payment) => String(payment.invoiceId || payment.invoice_id || '') === String(invoiceId))
      .filter((payment) => this.isReceivedDuePayment(payment))
      .sort((a, b) => this.dateMs(this.paymentDate(a)) - this.dateMs(this.paymentDate(b)));
  }

  private isReceivedDuePayment(payment: ApiRecord): boolean {
    const referenceText = [
      payment['reference'],
      payment['referenceNo'],
      payment['reference_no'],
      payment['paymentReference'],
      payment['payment_reference'],
      payment['remarks'],
      payment['note'],
      payment['notes'],
      payment['description']
    ].join(' ').toLowerCase();
    return referenceText.includes('pos unpaid receive')
      || referenceText.includes('old unpaid')
      || referenceText.includes('receive due')
      || referenceText.includes('received due');
  }

  private paymentAmount(payment: ApiRecord): number {
    return this.money(Number(payment['amount'] || payment['paidAmount'] || payment['paid_amount'] || 0));
  }

  private paymentMode(payment: ApiRecord): string {
    return String(payment['mode'] || payment['paymentMode'] || payment['payment_mode'] || 'cash');
  }

  private paymentDate(payment: ApiRecord): string {
    return String(payment['paidAt'] || payment['paid_at'] || payment['paymentDate'] || payment['payment_date'] || payment['createdAt'] || payment['created_at'] || payment['date'] || '');
  }

  private paymentReference(payment: ApiRecord): string {
    return String(payment['referenceNo'] || payment['reference_no'] || payment['reference'] || payment['paymentReference'] || payment['payment_reference'] || payment['providerPaymentId'] || payment['provider_payment_id'] || '');
  }

  private paymentSettlementId(payment: ApiRecord): string {
    return String(payment['id'] || payment['paymentId'] || payment['payment_id'] || payment['providerPaymentId'] || payment['provider_payment_id'] || payment['providerOrderId'] || payment['provider_order_id'] || '');
  }

  private paymentReceiverId(payment: ApiRecord): string {
    return String(payment['createdBy'] || payment['created_by'] || payment['receivedBy'] || payment['received_by'] || payment['cashierId'] || payment['cashier_id'] || payment['staffId'] || payment['staff_id'] || payment['userId'] || payment['user_id'] || '').trim();
  }

  private paymentReceiver(payment: ApiRecord): string {
    const receiverId = this.paymentReceiverId(payment);
    const staff = this.staffById(receiverId);
    return String(payment['receivedByName'] || payment['received_by_name'] || payment['cashierName'] || payment['cashier_name'] || staff?.name || receiverId || 'Counter');
  }

  private staffById(staffId: string): ApiRecord | undefined {
    return this.lines().find((line) => line.staffId === staffId)?.staffName
      ? { name: this.lines().find((line) => line.staffId === staffId)?.staffName }
      : undefined;
  }

  private serviceNamesForInvoice(lines: InvoiceLine[]): string {
    const names = [...new Set(lines.filter((line) => line.itemType === 'service').map((line) => line.itemName).filter(Boolean))];
    return names.join(', ') || '-';
  }

  private invoiceTotal(invoiceId: string): number {
    const lines = this.filteredLines().filter((line) => line.invoiceId === invoiceId);
    return this.money(lines.reduce((sum, line) => sum + Number(line.final || 0), 0));
  }

  private lineDueShare(line: InvoiceLine): number {
    const total = this.invoiceTotal(line.invoiceId);
    if (total <= 0 || line.due <= 0) return 0;
    return this.money((Number(line.final || 0) / total) * line.due);
  }

  private lineRecoveredShare(line: InvoiceLine): number {
    const total = this.invoiceTotal(line.invoiceId);
    if (total <= 0) return 0;
    const recovered = this.dueRecoveryPayments(line.invoiceId).reduce((sum, payment) => sum + this.paymentAmount(payment), 0);
    return this.money((Number(line.final || 0) / total) * recovered);
  }

  private unpaidRecoveryStatus(due: number, receivedAmount: number): string {
    if (due > 0 && receivedAmount > 0) return 'partial';
    if (due > 0) return 'pending';
    if (receivedAmount > 0) return 'recovered';
    return 'paid';
  }

  private recoveryDays(invoiceDate: string, payment: ApiRecord | null): number {
    if (!payment) return this.ageDays(invoiceDate);
    const start = this.dateMs(invoiceDate);
    const end = this.dateMs(this.paymentDate(payment));
    if (!start || !end) return 0;
    return Math.max(0, Math.floor((end - start) / (24 * 60 * 60 * 1000)));
  }

  private partialPaymentHistory(payments: ApiRecord[]): string {
    if (!payments.length) return '';
    return payments.map((payment) => {
      const amount = this.paymentAmount(payment).toLocaleString('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });
      const date = this.dateKey(this.paymentDate(payment));
      const mode = this.modeLabel(this.paymentMode(payment));
      const receiver = this.paymentReceiver(payment);
      const settlement = this.paymentSettlementId(payment);
      return `${date} ${this.timeLabel(this.paymentDate(payment))} · ${amount} · ${mode} · ${receiver}${settlement ? ` · ${settlement}` : ''}`;
    }).join(' ; ');
  }

  private unpaidExportSummaryLines(): string[] {
    const rows = this.dueRows();
    const totalRecovered = this.sum(rows, 'receivedAmount');
    const pendingDue = this.sum(rows, 'due');
    const totalUnpaid = this.money(totalRecovered + pendingDue);
    const agingSummary = this.group(rows, (row) => String(row['bucket'] || 'No bucket'))
      .map((items) => `${items[0]['bucket']}: ${items.length} invoice(s), INR ${this.sum(items, 'due').toLocaleString('en-IN')} pending`)
      .join(' | ');
    const topClients = this.group(rows, (row) => String(row['clientName'] || 'Client'))
      .map((items) => ({ name: String(items[0]['clientName']), due: this.sum(items, 'due') }))
      .sort((a, b) => b.due - a.due)
      .slice(0, 5)
      .map((item) => `${item.name} INR ${item.due.toLocaleString('en-IN')}`)
      .join(', ');
    const topStaff = this.staffUnpaidRows().slice(0, 5).map((row) => `${row['staffName']} INR ${Number(row['pendingDue'] || 0).toLocaleString('en-IN')}`).join(', ');
    return [
      `Total unpaid exposure: INR ${totalUnpaid.toLocaleString('en-IN')}`,
      `Recovered due: INR ${totalRecovered.toLocaleString('en-IN')}`,
      `Pending due: INR ${pendingDue.toLocaleString('en-IN')}`,
      `Aging summary: ${agingSummary || 'No due rows'}`,
      `Top clients: ${topClients || 'No client due'}`,
      `Top staff: ${topStaff || 'No staff due'}`
    ];
  }

  private dueRecoveryExportSummaryLines(): string[] {
    const rows = this.dueRecoveryRows();
    const summary = this.dueRecoverySummary();
    const pendingRows = rows.filter((row) => Number(row['dueAmount'] || 0) > 0);
    const agingSummary = this.group(pendingRows, (row) => String(row['agingBucket'] || 'No bucket'))
      .map((items) => `${items[0]['agingBucket']}: ${items.length} invoice(s), ${this.formatMoney(this.sum(items, 'dueAmount'))}`)
      .join(' | ');
    const topClients = this.group(pendingRows, (row) => String(row['clientName'] || 'Client'))
      .map((items) => ({ name: String(items[0]['clientName'] || 'Client'), due: this.sum(items, 'dueAmount') }))
      .sort((a, b) => b.due - a.due)
      .slice(0, 5)
      .map((item) => `${item.name} ${this.formatMoney(item.due)}`)
      .join(', ');
    const staffWise = this.group(pendingRows, (row) => String(row['staffName'] || 'Unassigned'))
      .map((items) => ({ name: String(items[0]['staffName'] || 'Unassigned'), due: this.sum(items, 'dueAmount') }))
      .sort((a, b) => b.due - a.due)
      .slice(0, 5)
      .map((item) => `${item.name} ${this.formatMoney(item.due)}`)
      .join(', ');
    const managerPending = pendingRows
      .filter((row) => ['call_pending', 'daily_due'].includes(String(row['callFollowUpStatus'] || '')))
      .slice(0, 8)
      .map((row) => `${row['invoiceNumber']} · ${row['clientName']} · ${row['recoveryOwnerName'] || 'Unassigned'} · ${row['callFollowUpStatus']}`)
      .join(' | ');
    return [
      `Total pending due: ${this.formatMoney(Number(summary['totalPendingDue'] || this.sum(pendingRows, 'dueAmount')))}`,
      `Pending invoice count: ${summary['pendingInvoiceCount'] || pendingRows.length}`,
      `Recovered this month: ${this.formatMoney(Number(summary['recoveredThisMonth'] || 0))}`,
      `Call follow-up pending: ${summary['callFollowUpPending'] || 0}`,
      `Daily follow-up due today: ${summary['dailyFollowUpDueToday'] || 0}`,
      `Aging bucket totals: ${agingSummary || 'No pending due'}`,
      `Top pending clients: ${topClients || 'No client due'}`,
      `Staff-wise unpaid: ${staffWise || 'No staff due'}`,
      `Manager follow-up pending: ${managerPending || 'No manager queue'}`
    ];
  }

  private salesDiscountExportSummaryLines(): string[] {
    const summary = this.salesDiscountSummary();
    const topStaff = this.salesDiscountStaffRows().slice(0, 5).map((row) => `${row['staffName']} ${this.formatMoney(Number(row['discountGiven'] || 0))}`).join(', ');
    const topClients = this.salesDiscountClientRows().slice(0, 5).map((row) => `${row['clientName']} ${this.formatMoney(Number(row['totalDiscountReceived'] || 0))}`).join(', ');
    const riskRows = this.salesDiscountRiskRows();
    return [
      `Total discount: ${this.formatMoney(summary.totalDiscount)} (${summary.discountRate}%)`,
      `Gross sale: ${this.formatMoney(summary.grossSale)}`,
      `Net sale: ${this.formatMoney(summary.netSale)}`,
      `Manual discount: ${this.formatMoney(summary.manualDiscount)}`,
      `Coupon discount: ${this.formatMoney(summary.couponDiscount)}`,
      `Membership / loyalty discount: ${this.formatMoney(summary.membershipLoyaltyDiscount)}`,
      `Top staff by discount: ${topStaff || 'No staff discount'}`,
      `Top clients by discount: ${topClients || 'No client discount'}`,
      `High-risk invoices: ${riskRows.length}`,
      `Margin loss alerts: ${summary.marginLossAlerts}`
    ];
  }

  deletedInvoiceApprovalSummary(): ApiRecord {
    const rows = this.deletedInvoiceApprovalRows();
    const approved = rows.filter((row) => String(row['approvalStatus'] || '').toLowerCase().includes('approved')).length;
    return {
      totalBill: rows.length,
      totalSale: this.sum(rows, 'price'),
      receivedAmount: this.sum(rows, 'paid'),
      pendingAmount: this.sum(rows, 'balance'),
      approvedDeletes: approved,
      approvalGaps: rows.length - approved
    };
  }

  private deletedInvoiceApprovalRows(): ApiRecord[] {
    const rows = [
      ...this.deletedRowsFromInvoiceActivityReport(),
      ...this.deletedRowsFromAuditLogs(),
      ...this.deletedRowsFromInvoices()
    ];
    const deduped = new Map<string, ApiRecord>();
    for (const row of rows) {
      const key = `${String(row['invoiceNumber'] || row['invoiceId'] || '').toLowerCase()}|${String(row['deletedDate'] || '').toLowerCase()}|${String(row['approvalStatus'] || '').toLowerCase()}`;
      const current = deduped.get(key);
      if (!current || this.deletedRowCompleteness(row) > this.deletedRowCompleteness(current)) deduped.set(key, row);
    }
    return [...deduped.values()]
      .filter((row) => this.matchesDeletedInvoiceFilters(row))
      .sort((a, b) => this.dateMs(b['deletedAt'] || b['deletedDate']) - this.dateMs(a['deletedAt'] || a['deletedDate']) || String(b['invoiceNumber']).localeCompare(String(a['invoiceNumber'])));
  }

  private deletedRowsFromInvoiceActivityReport(): ApiRecord[] {
    const exportRows = this.invoiceActivityReport().exportRows || [];
    const compactRows = this.invoiceActivityReport().deletedInvoiceReport || [];
    const mappedExportRows = exportRows
      .filter((row) => String(row['actionType'] || '').toLowerCase() === 'deleted')
      .map((row) => this.deletedReportRow(row, 'invoice-activity-report'));
    const mappedCompactRows = compactRows.map((row) => this.deletedReportRow(row, 'invoice-activity-deleted-report'));
    return [...mappedExportRows, ...mappedCompactRows];
  }

  private deletedRowsFromAuditLogs(): ApiRecord[] {
    return this.auditLogs()
      .map((log) => ({ log, details: this.auditDetails(log) }))
      .filter(({ log, details }) => this.isDeletedInvoiceAudit(log, details))
      .map(({ log, details }) => this.deletedReportRow({
        id: log['id'],
        invoiceId: details['invoiceId'] || details['id'] || log['entityId'] || log['entity_id'],
        invoiceNumber: details['invoiceNumber'] || details['invoice_no'] || log['entityId'] || log['entity_id'],
        clientName: details['clientName'] || details['customerName'],
        clientPhone: details['clientPhone'] || details['phone'] || details['mobile'],
        staffName: details['staffName'],
        branchId: details['branchId'] || log['branchId'] || log['branch_id'],
        branchName: details['branchName'],
        date: details['invoiceCreatedAt'] || details['createdAt'] || details['created_at'],
        deletedAt: details['approvalTime'] || details['approvedAt'] || details['deletedAt'] || log['createdAt'] || log['created_at'],
        amount: details['total'] || details['amount'],
        paid: details['paid'],
        due: details['balance'] || details['due'],
        balance: details['balance'] || details['due'],
        paymentModes: this.deletedPaymentModes(details),
        actionByUser: details['deletedBy'] || details['actionByUser'] || details['requestedBy'] || log['actorUserId'] || log['actor_user_id'],
        approvalStatus: details['approvalStatus'],
        approvedBy: details['approvedBy'],
        reason: details['deleteReason'] || details['approvalReason'] || details['reason'] || log['note'],
        feedbackRating: details['feedbackRating'] || details['rating']
      }, 'audit-log'));
  }

  private deletedRowsFromInvoices(): ApiRecord[] {
    return this.uniqueInvoiceRows()
      .filter((line) => ['deleted', 'soft_deleted'].some((status) => String(line.status || '').toLowerCase().includes(status)))
      .map((line) => this.deletedReportRow({
        invoiceId: line.invoiceId,
        invoiceNumber: line.invoiceNumber,
        clientName: line.clientName,
        clientPhone: line.clientPhone,
        staffName: line.staffName,
        branchId: line.branchId,
        branchName: line.branchName,
        date: line.date,
        deletedAt: line.date,
        amount: line.final,
        paid: line.paid,
        due: line.due,
        balance: line.due,
        paymentModes: line.paymentModes,
        actionByUser: line.addedBy,
        approvalStatus: 'Approval not linked',
        reason: 'Deleted invoice status'
      }, 'invoice-status'));
  }

  private deletedReportRow(source: ApiRecord, sourceName: string): ApiRecord {
    const invoiceNumber = String(source['invoiceNumber'] || source['invoiceNo'] || source['invoice_id'] || source['invoiceId'] || '-');
    const invoiceId = String(source['invoiceId'] || source['id'] || source['entityId'] || '');
    const invoiceMatch = this.findInvoiceLine(invoiceId, invoiceNumber);
    const deletedAt = String(source['deletedAt'] || source['actionTime'] || source['time'] || source['createdAt'] || source['created_at'] || source['date'] || '');
    const invoiceDateValue = String(source['invoiceCreatedAt'] || source['invoiceDate'] || source['date'] || invoiceMatch?.date || deletedAt || '');
    const price = this.money(Number(source['price'] || source['amount'] || source['total'] || invoiceMatch?.final || 0));
    const paid = this.money(Number(source['paid'] || source['receivedAmount'] || invoiceMatch?.paid || 0));
    const balance = this.money(Number(source['balance'] ?? source['due'] ?? invoiceMatch?.due ?? Math.max(0, price - paid)));
    const approvalStatus = this.deletedApprovalStatus(source);
    return {
      source: sourceName,
      invoiceId,
      invoiceNumber,
      clientName: String(source['clientName'] || source['name'] || invoiceMatch?.clientName || 'Walk-in client'),
      clientPhone: String(source['clientPhone'] || source['contact'] || invoiceMatch?.clientPhone || ''),
      staffName: String(source['staffName'] || invoiceMatch?.staffName || 'Unassigned'),
      branchId: String(source['branchId'] || invoiceMatch?.branchId || ''),
      branchName: String(source['branchName'] || invoiceMatch?.branchName || ''),
      price,
      paid,
      balance,
      invoiceDate: this.dateKey(invoiceDateValue),
      invoiceDateTime: invoiceDateValue,
      feedbackRating: String(source['feedbackRating'] || source['feedback'] || source['rating'] || '-'),
      deletedAt,
      deletedDate: this.dateKey(deletedAt),
      deletedTime: this.timeLabel(deletedAt),
      deletedBy: String(source['deletedBy'] || source['actionByUser'] || source['requestedBy'] || 'Audit not linked'),
      approvedBy: String(source['approvedBy'] || (approvalStatus.includes('Approved') ? source['actionByUser'] || '' : '') || 'Approval not linked'),
      approvalStatus,
      deleteReason: String(source['deleteReason'] || source['reason'] || source['approvalReason'] || source['riskReason'] || 'Reason missing'),
      paymentModes: String(source['paymentModes'] || invoiceMatch?.paymentModes || ''),
      status: String(source['status'] || 'deleted'),
      action: sourceName === 'invoice-status' ? 'Open invoice from POS register' : 'Review in invoice activity'
    };
  }

  private deletedApprovalStatus(source: ApiRecord): string {
    const status = String(source['approvalStatus'] || source['status'] || '').toLowerCase();
    const approvedBy = String(source['approvedBy'] || '').trim();
    if (status.includes('approved') || approvedBy) return 'Approved';
    if (status.includes('pending')) return 'Pending approval';
    if (status.includes('reject')) return 'Rejected';
    if (String(source['actionType'] || '').toLowerCase() === 'deleted') return 'Deleted / approval not linked';
    return 'Approval not linked';
  }

  private deletedInvoiceExportSummaryLines(): string[] {
    const summary = this.deletedInvoiceApprovalSummary();
    const topDeletedBy = this.topBy(this.deletedInvoiceApprovalRows(), 'deletedBy', 'price');
    const topStaff = this.topBy(this.deletedInvoiceApprovalRows(), 'staffName', 'price');
    return [
      `Deleted bills: ${summary['totalBill'] || 0}`,
      `Deleted sale value: ${this.formatMoney(Number(summary['totalSale'] || 0))}`,
      `Received before delete: ${this.formatMoney(Number(summary['receivedAmount'] || 0))}`,
      `Pending at delete: ${this.formatMoney(Number(summary['pendingAmount'] || 0))}`,
      `Approved deletes: ${summary['approvedDeletes'] || 0}`,
      `Approval gaps: ${summary['approvalGaps'] || 0}`,
      `Top deleted by: ${topDeletedBy.label || 'No user'} ${topDeletedBy.value ? this.formatMoney(topDeletedBy.value) : ''}`,
      `Top staff impact: ${topStaff.label || 'No staff'} ${topStaff.value ? this.formatMoney(topStaff.value) : ''}`
    ];
  }

  private matchesDeletedInvoiceFilters(row: ApiRecord): boolean {
    const query = this.query.trim().toLowerCase();
    const deletedDate = String(row['deletedAt'] || row['deletedDate'] || row['invoiceDateTime'] || '');
    const dateMatch = this.inDateRange(deletedDate);
    const clientMatch = !this.clientFilter || String(row['clientId'] || '') === String(this.clientFilter) || String(row['clientName'] || '') === String(this.clientFilter);
    const staffMatch = !this.staffFilter || String(row['staffId'] || '') === String(this.staffFilter) || String(row['staffName'] || '') === String(this.staffFilter);
    const branchMatch = !this.branchFilter || String(row['branchId'] || '') === String(this.branchFilter);
    const modeMatch = !this.paymentModeFilter || this.modeMatches(String(row['paymentModes'] || ''), this.paymentModeFilter);
    const statusMatch = !this.status
      || (this.status === 'unpaid' ? Number(row['balance'] || 0) > 0 : String(row['status'] || '').toLowerCase().includes(this.status));
    const haystack = `${row['invoiceNumber']} ${row['clientName']} ${row['clientPhone']} ${row['staffName']} ${row['deletedBy']} ${row['approvedBy']} ${row['approvalStatus']} ${row['deleteReason']}`.toLowerCase();
    return dateMatch && clientMatch && staffMatch && branchMatch && modeMatch && statusMatch && (!query || haystack.includes(query));
  }

  private isDeletedInvoiceAudit(log: ApiRecord, details: ApiRecord): boolean {
    const text = `${log['action'] || ''} ${log['entityType'] || log['entity_type'] || ''} ${details['actionType'] || ''} ${details['approvalStatus'] || ''} ${details['status'] || ''} ${details['deleteReason'] || ''}`.toLowerCase();
    const invoiceText = `${log['entityType'] || log['entity_type'] || ''} ${details['invoiceNumber'] || ''} ${details['invoiceId'] || ''}`.toLowerCase();
    return invoiceText.includes('invoice') || Boolean(details['invoiceNumber'] || details['invoiceId'])
      ? text.includes('delete') || text.includes('deleted') || text.includes('soft_deleted')
      : false;
  }

  private deletedPaymentModes(details: ApiRecord): string {
    const payments = this.readArray(details['payments']);
    if (payments.length) return payments.map((payment) => this.modeLabel(String(payment['mode'] || payment['paymentMode'] || ''))).filter(Boolean).join(', ');
    return String(details['paymentModes'] || details['paymentMode'] || '');
  }

  private deletedRowCompleteness(row: ApiRecord): number {
    return ['clientName', 'clientPhone', 'staffName', 'price', 'paid', 'deletedBy', 'approvedBy', 'deleteReason'].reduce((score, key) => score + (row[key] ? 1 : 0), 0);
  }

  private findInvoiceLine(invoiceId: string, invoiceNumber: string): InvoiceLine | undefined {
    return this.lines().find((line) => String(line.invoiceId || '') === String(invoiceId || '') || String(line.invoiceNumber || '') === String(invoiceNumber || ''));
  }

  private walletRows(): ApiRecord[] {
    const linesByClient = this.group(this.filteredLines(), (line) => line.clientId || line.clientName);
    return linesByClient.map((lines) => {
      const clientId = lines[0].clientId;
      const latest = this.latestWallet(clientId);
      const walletBalance = Number(latest?.balanceAfter ?? latest?.balance_after ?? latest?.balance ?? this.clientById(clientId)?.walletBalance ?? 0);
      const walletUsed = this.sum(this.paymentsForFilteredInvoices().filter((payment) => String(payment.mode || '').toLowerCase().includes('wallet') && this.invoiceClientId(String(payment.invoiceId || '')) === clientId), 'amount');
      return {
        clientName: lines[0].clientName,
        clientPhone: lines[0].clientPhone,
        walletUsed,
        walletBalance: this.money(walletBalance),
        due: this.uniqueInvoiceSum(lines, 'due'),
        lastActivity: latest?.createdAt || latest?.created_at || latest?.date || '',
        source: latest ? 'wallet ledger' : 'client balance'
      };
    }).filter((row) => Number(row['walletUsed']) > 0 || Number(row['walletBalance']) > 0)
      .sort((a, b) => Number(b['walletBalance']) - Number(a['walletBalance']));
  }

  private auditRows(): ApiRecord[] {
    const auditRows = this.auditLogs().filter((log) => {
      const text = `${log.action || ''} ${log.entityType || ''} ${log.details?.invoiceNumber || ''}`.toLowerCase();
      return text.includes('invoice') || text.includes('pos');
    });
    if (auditRows.length) {
      return auditRows.slice(0, 500).map((log) => ({
        date: log.createdAt || log.created_at,
        action: log.action || 'audit',
        invoiceNumber: log.details?.invoiceNumber || log.entityId || '-',
        clientName: log.details?.clientName || '-',
        staffName: log.details?.staffName || log.actorUserId || '-',
        amount: log.details?.total || log.details?.amount || 0,
        risk: log.severity || 'info',
        note: log.details?.reason || log.details?.source || log.entityType || '-'
      }));
    }
    return this.discountApprovalRows().filter((row) => row['approval'] !== 'Normal discount').map((row) => ({
      date: '',
      action: 'discount_watch',
      invoiceNumber: row['invoiceNumber'],
      clientName: row['clientName'],
      staffName: row['staffName'],
      amount: row['discount'],
      risk: row['approval'],
      note: row['reason']
    }));
  }

  private branchClosingRows(): ApiRecord[] {
    return this.group(this.filteredLines(), (line) => `${this.dateKey(line.date)}|${line.branchName}`)
      .map((items) => ({
        date: this.dateKey(items[0].date),
        branchName: items[0].branchName,
        gross: this.sum(items, 'gross'),
        discount: this.sum(items, 'discount'),
        gst: this.sum(items, 'gst'),
        collected: this.uniqueInvoiceSum(items, 'paid'),
        due: this.uniqueInvoiceSum(items, 'due'),
        invoices: new Set(items.map((item) => item.invoiceId)).size
      }))
      .sort((a, b) => String(b['date']).localeCompare(String(a['date'])));
  }

  private commissionRows(): ApiRecord[] {
    return this.group(this.filteredLines(), (line) => line.staffName || 'Unassigned')
      .map((items) => {
        const serviceBase = this.sum(items.filter((line) => line.itemType === 'service'), 'taxable');
        const retailBase = this.sum(items.filter((line) => line.itemType === 'product'), 'taxable');
        const membershipBase = this.sum(items.filter((line) => ['membership', 'package'].includes(line.itemType)), 'taxable');
        return {
          staffName: items[0].staffName,
          serviceBase,
          retailBase,
          membershipBase,
          discount: this.sum(items, 'discount'),
          estimatedCommission: this.money(serviceBase * 0.1 + retailBase * 0.05 + membershipBase * 0.03),
          policy: '10% service / 5% retail / 3% membership estimate'
        };
      })
      .sort((a, b) => Number(b['estimatedCommission']) - Number(a['estimatedCommission']));
  }

  private discountApprovalRows(): ApiRecord[] {
    return this.uniqueInvoiceRows().map((line) => {
      const invoiceLines = this.filteredLines().filter((item) => item.invoiceId === line.invoiceId);
      const gross = this.sum(invoiceLines, 'gross');
      const discount = this.sum(invoiceLines, 'discount');
      const rate = gross ? this.money((discount / gross) * 100) : 0;
      return {
        invoiceNumber: line.invoiceNumber,
        clientName: line.clientName,
        staffName: line.staffName,
        gross,
        discount,
        discountRate: rate,
        approval: rate >= 25 ? 'Owner approval' : rate >= 12 ? 'Manager review' : 'Normal discount',
        reason: rate >= 12 ? 'Reason and approval should be captured' : 'Within routine range'
      };
    }).filter((row) => Number(row['discount']) > 0)
      .sort((a, b) => Number(b['discountRate']) - Number(a['discountRate']));
  }

  private clientProfitRows(): ApiRecord[] {
    return this.group(this.filteredLines(), (line) => line.clientId || line.clientName)
      .map((items) => {
        const clientId = items[0].clientId;
        const gross = this.sum(items, 'gross');
        const discount = this.sum(items, 'discount');
        const net = this.sum(items, 'final');
        const due = this.uniqueInvoiceSum(items, 'due');
        const wallet = Number(this.latestWallet(clientId)?.balanceAfter ?? this.clientById(clientId)?.walletBalance ?? 0);
        const rate = gross ? discount / gross : 0;
        return {
          clientName: items[0].clientName,
          phone: items[0].clientPhone,
          gross,
          discount,
          net,
          due,
          wallet: this.money(wallet),
          visits: new Set(items.map((item) => item.invoiceId)).size,
          risk: due > 0 ? 'Due' : rate > 0.2 ? 'Discount heavy' : 'Healthy'
        };
      }).sort((a, b) => Number(b['net']) - Number(a['net']));
  }

  private packageLiabilityRows(): ApiRecord[] {
    const membershipRows = this.membershipRows();
    const walletRows = this.walletRows();
    return [
      ...membershipRows.map((row) => ({
        clientName: 'Multiple clients',
        itemName: row['itemName'],
        soldValue: row['final'],
        walletBalance: 0,
        futureLiability: row['liability'],
        risk: Number(row['liability']) > 10000 ? 'High liability' : 'Normal'
      })),
      ...walletRows.map((row) => ({
        clientName: row['clientName'],
        itemName: 'Wallet balance',
        soldValue: 0,
        walletBalance: row['walletBalance'],
        futureLiability: row['walletBalance'],
        risk: Number(row['walletBalance']) > 3000 ? 'Unused credit' : 'Normal'
      }))
    ].sort((a, b) => Number(b['futureLiability']) - Number(a['futureLiability']));
  }

  private deliveryRows(): ApiRecord[] {
    return this.uniqueInvoiceRows().map((line) => ({
      invoiceNumber: line.invoiceNumber,
      clientName: line.clientName,
      clientPhone: line.clientPhone,
      total: line.final,
      due: line.due,
      readiness: line.clientPhone ? 'Ready' : 'Missing phone',
      action: line.due > 0 ? 'Send unpaid PDF + payment link' : 'Send paid receipt PDF'
    })).sort((a, b) => String(a['readiness']).localeCompare(String(b['readiness'])));
  }

  private leakageRows(): ApiRecord[] {
    const rows: ApiRecord[] = [];
    for (const row of this.discountApprovalRows().filter((item) => Number(item['discountRate']) >= 12)) {
      rows.push({ risk: row['approval'], invoiceNumber: row['invoiceNumber'], clientName: row['clientName'], staffName: row['staffName'], amount: row['discount'], reason: `${row['discountRate']}% discount`, suggestedAction: 'Check approval, coupon and staff explanation.' });
    }
    for (const row of this.dueRows().filter((item) => Number(item['due']) > 0)) {
      rows.push({ risk: Number(row['ageDays']) > 30 ? 'Critical due' : 'Due', invoiceNumber: row['invoiceNumber'], clientName: row['clientName'], staffName: row['staffName'], amount: row['due'], reason: row['bucket'], suggestedAction: 'Send payment reminder and assign recovery owner.' });
    }
    for (const line of this.filteredLines().filter((item) => !item.staffName || item.staffName === 'Unassigned')) {
      rows.push({ risk: 'Attribution gap', invoiceNumber: line.invoiceNumber, clientName: line.clientName, staffName: 'Unassigned', amount: line.final, reason: 'No staff mapped to line', suggestedAction: 'Assign staff before commission payout.' });
    }
    for (const line of this.filteredLines().filter((item) => item.gstRate <= 0 && item.final > 0)) {
      rows.push({ risk: 'GST missing', invoiceNumber: line.invoiceNumber, clientName: line.clientName, staffName: line.staffName, amount: line.final, reason: `${line.itemName} has 0% GST`, suggestedAction: 'Review HSN/SAC and tax policy.' });
    }
    return rows.slice(0, 500);
  }

  private buildLines(invoices: ApiRecord[], sales: ApiRecord[], payments: ApiRecord[], clients: ApiRecord[], staff: ApiRecord[], branches: ApiRecord[], products: ApiRecord[]): InvoiceLine[] {
    const saleMap = new Map(sales.map((sale) => [String(sale.id), sale]));
    const clientMap = new Map(clients.map((client) => [String(client.id), client]));
    const staffMap = new Map(staff.map((person) => [String(person.id), person]));
    const branchMap = new Map(branches.map((branch) => [String(branch.id), branch]));
    const productById = new Map<string, ApiRecord>();
    const productByKey = new Map<string, ApiRecord>();
    for (const product of products) {
      for (const id of [product['id'], product['productId'], product['product_id'], product['sku'], product['barcode'], product['code'], product['productCode']]) {
        if (id !== undefined && id !== null && id !== '') productById.set(String(id), product);
      }
      const key = this.productLookupKey(String(product['name'] || product['productName'] || ''));
      if (key) productByKey.set(key, product);
    }
    return invoices.flatMap((invoice) => {
      const sale = saleMap.get(String(invoice.saleId || invoice.sale_id || '')) || {};
      const clientId = String(invoice.clientId || invoice.client_id || sale.clientId || sale.client_id || '');
      const client = clientMap.get(clientId) || {};
      const branchId = String(invoice.branchId || invoice.branch_id || sale.branchId || sale.branch_id || '');
      const branch = branchMap.get(branchId) || {};
      const staffId = String(invoice.staffId || invoice.staff_id || sale.staffId || sale.staff_id || '');
      const staffPerson = staffMap.get(staffId) || {};
      const invoicePayments = payments.filter((payment) => String(payment.invoiceId || payment.invoice_id || '') === String(invoice.id));
      const paymentModes = invoicePayments.map((payment) => this.modeLabel(String(payment.mode || 'unknown'))).filter(Boolean).join(', ') || 'No payment';
      const rawItems = this.readArray(invoice.lineItems?.length ? invoice.lineItems : sale.items);
      const items = rawItems.length ? rawItems : [{ name: invoice.invoiceNumber || invoice.id, type: 'custom', price: invoice.total || invoice.grand_total || 0, quantity: 1 }];
      const grossTotal = this.money(items.reduce((sum, item) => sum + this.lineGross(item), 0));
      const invoiceDiscount = this.money(Number(invoice.discount ?? invoice.discount_total ?? sale.discount ?? 0));
      const total = this.money(Number(invoice.total ?? invoice.grand_total ?? sale.total ?? 0));
      const paid = this.money(Number(invoice.paid ?? invoice.paid_amount ?? invoicePayments.reduce((sum, payment) => sum + Number(payment.amount || 0), 0)));
      const due = this.money(Number(invoice.balance ?? invoice.due_amount ?? Math.max(0, total - paid)));
      const prepaidAmount = this.prepaidAmount(invoice, sale, invoicePayments);
      const couponCode = String(invoice.couponCode || invoice.coupon_code || sale.couponCode || sale.coupon_code || '');
      const couponDiscount = this.money(Number(invoice.couponDiscount || invoice.coupon_discount || sale.couponDiscount || sale.coupon_discount || 0));
      const loyaltyDiscount = this.money(Number(invoice.loyaltyDiscount || invoice.loyalty_discount || sale.loyaltyDiscount || sale.loyalty_discount || invoice.loyaltyPointsDiscount || invoice.loyalty_points_discount || 0));
      const membershipDiscount = this.money(Number(
        invoice.membershipDiscount
        || invoice.membership_discount
        || sale.membershipDiscount
        || sale.membership_discount
        || invoice.membershipRedeem?.autoDiscountAmount
        || sale.membershipRedeem?.autoDiscountAmount
        || 0
      ));
      const tipAmount = this.money(Number(invoice.tipAmount || invoice.tip_amount || sale.tipAmount || sale.tip_amount || 0));
      const addedBy = String(invoice.addedBy || invoice.added_by || invoice.createdByName || invoice.created_by_name || invoice.createdBy || invoice.created_by || sale.addedBy || sale.createdBy || staffPerson.name || 'Counter');
      return items.map((item) => {
        const itemStaffId = String(item.staffId || item.staff_id || item.assignedStaffId || item.assigned_staff_id || staffId || '');
        const itemStaff = staffMap.get(itemStaffId) || staffPerson;
        const itemName = String(item.name || item.serviceName || item.productName || item.itemName || item.title || 'Invoice item');
        const itemProductId = String(item.productId || item.product_id || item.productCode || item.product_code || item.sku || item.barcode || '');
        const product = productById.get(itemProductId) || productByKey.get(this.productLookupKey(itemName)) || {};
        const gross = this.lineGross(item);
        const discount = this.lineDiscount(item, gross, grossTotal, invoiceDiscount);
        const taxable = this.money(Math.max(0, gross - discount));
        const gstRate = this.money(Number(item.gstRate ?? item.gst_rate ?? item.taxRate ?? item.tax_rate ?? item.gst ?? 0));
        const gst = this.lineGst(item, taxable, gstRate);
        const final = this.lineFinal(item, taxable, gst);
        return {
          invoiceId: String(invoice.id),
          invoiceNumber: String(invoice.invoiceNumber || invoice.invoice_no || invoice.id),
          date: String(invoice.createdAt || invoice.created_at || sale.createdAt || sale.created_at || ''),
          branchId,
          branchName: String(branch.name || invoice.branchName || sale.branchName || branchId || 'Branch'),
          clientId,
          clientName: String(client.name || invoice.clientName || sale.clientName || 'Walk-in client'),
          clientPhone: String(client.phone || client.mobile || client.whatsapp || invoice.clientPhone || sale.clientPhone || ''),
          staffId: itemStaffId,
          staffName: String(item.staffName || item.staff_name || item.assignedStaffName || item.assigned_staff_name || itemStaff.name || staffPerson.name || 'Unassigned'),
          productId: String(product['id'] || itemProductId || ''),
          productSku: String(item.sku || item.SKU || product['sku'] || product['code'] || product['productCode'] || ''),
          productBarcode: String(item.barcode || item.barCode || product['barcode'] || product['barCode'] || ''),
          productCategory: String(item.category || product['category'] || product['brand'] || ''),
          productBrand: String(item.brand || item.productBrand || product['brand'] || product['manufacturer'] || product['supplierName'] || ''),
          productStock: Number(product['stock'] || product['currentStock'] || product['availableStock'] || 0),
          productLowStockThreshold: Number(product['lowStockThreshold'] || product['reorderLevel'] || product['minStock'] || product['minimumStock'] || 0),
          productUnitCost: this.money(Number(item.unitCost || item.costPrice || item.purchasePrice || product['unitCost'] || product['costPrice'] || product['purchasePrice'] || 0)),
          productBatchNumber: String(item.batchNumber || item.batch_number || product['batchNumber'] || product['batch_number'] || ''),
          productExpiryDate: String(item.expiryDate || item.expiry_date || product['expiryDate'] || product['expiry_date'] || ''),
          itemName,
          itemType: this.normalizedItemType(item),
          quantity: this.money(Number(item.quantity || item.qty || 1)),
          rate: this.lineRate(item),
          gross,
          discount,
          taxable,
          gstRate,
          gst,
          final,
          paid,
          due,
          status: String(invoice.status || invoice.payment_status || (due > 0 ? 'unpaid' : 'paid')),
          paymentModes,
          addedBy,
          couponCode,
          couponDiscount,
          loyaltyDiscount,
          membershipDiscount,
          prepaidAmount,
          tipAmount
        };
      });
    });
  }

  private loadInvoiceActivityReport() {
    return this.api.list<InvoiceActivityReport>('pos/invoice-activity/reports', {
      from: this.from,
      to: this.to,
      limit: 5000
    }).pipe(catchError(() => of({} as InvoiceActivityReport)));
  }

  private loadDueRecoveryReport() {
    return this.api.list<DueRecoveryReport>('reports/invoices/due-recovery', {
      from: this.from,
      to: this.to,
      status: this.recoveryStatus === 'all' ? '' : this.recoveryStatus,
      agingBucket: ['0-10', '11-20', '21+'].includes(this.agingBucket) ? this.agingBucket : '',
      clientId: this.clientFilter,
      branchId: this.branchFilter,
      staffId: this.staffFilter,
      paymentMode: this.paymentModeFilter,
      receivedBy: this.receivedByFilter,
      recoveryOwner: this.recoveryOwnerFilter,
      followUpStatus: this.followUpStatusFilter,
      q: this.query,
      limit: 10000
    }).pipe(catchError(() => of({ summary: {}, rows: [] } as DueRecoveryReport)));
  }

  private loadServiceTrendsReport() {
    return this.api.list<ServiceTrendsReport>('reports/invoices/service-trends', {
      from: this.from,
      to: this.to,
      branchId: this.branchFilter,
      clientId: this.clientFilter,
      staffId: this.staffFilter,
      serviceGroup: this.serviceGroupFilter,
      serviceId: this.serviceTrendFilter,
      gstRate: this.serviceGstRateFilter,
      revenueBucket: this.serviceRevenueBucketFilter,
      marginBucket: this.serviceMarginBucketFilter,
      quantityBucket: this.serviceQuantityBucketFilter,
      timeBucket: this.serviceTimeBucketFilter,
      sort: this.serviceSort,
      q: this.query,
      limit: 10000
    }).pipe(catchError(() => of({ summary: {}, rows: [] } as ServiceTrendsReport)));
  }

  private loadServiceClientsReport() {
    return this.api.list<ServiceClientsReport>('reports/invoices/service-clients', {
      from: this.from,
      to: this.to,
      branchId: this.branchFilter,
      clientId: this.clientFilter,
      staffId: this.staffFilter,
      serviceGroup: this.serviceGroupFilter,
      serviceId: this.serviceTrendFilter,
      saleType: this.serviceSaleTypeFilter,
      q: this.query,
      limit: 10000
    }).pipe(catchError(() => of({ summary: {}, rows: [] } as ServiceClientsReport)));
  }

  private refreshDueRecoveryReport(): void {
    this.loadDueRecoveryReport().subscribe((report) => {
      this.dueRecoverySummary.set(report.summary || {});
      this.dueRecoveryReportRows.set(report.rows || []);
    });
  }

  private dueRecoveryRows(): ApiRecord[] {
    return this.dueRecoveryReportRows().filter((row) => {
      const statusMatch = this.recoveryStatus === 'all' || !this.recoveryStatus || row['recoveryStatus'] === this.recoveryStatus;
      const bucketMatch = !this.agingBucket || row['agingBucket'] === this.agingBucket || !['0-10', '11-20', '21+'].includes(this.agingBucket);
      const clientMatch = !this.clientFilter || String(row['clientId'] || '') === String(this.clientFilter);
      const branchMatch = !this.branchFilter || String(row['branchId'] || '') === String(this.branchFilter);
      const staffMatch = !this.staffFilter || [row['staffId'], row['staffName']].map(String).includes(String(this.staffFilter));
      const modeMatch = !this.paymentModeFilter || String(row['paymentMode'] || '').toLowerCase() === String(this.paymentModeFilter).toLowerCase();
      const receiverMatch = !this.receivedByFilter || String(row['receiverId'] || '') === String(this.receivedByFilter);
      const ownerMatch = !this.recoveryOwnerFilter || String(row['recoveryOwnerId'] || '') === String(this.recoveryOwnerFilter);
      const followUpMatch = !this.followUpStatusFilter || String(row['callFollowUpStatus'] || '') === String(this.followUpStatusFilter);
      const query = this.query.trim().toLowerCase();
      const haystack = `${row['invoiceNumber']} ${row['clientName']} ${row['clientPhone']} ${row['staffName']} ${row['serviceNames']} ${row['paymentMode']} ${row['receivedBy']} ${row['recoveryOwnerName']} ${row['callFollowUpStatus']}`.toLowerCase();
      return statusMatch && bucketMatch && clientMatch && branchMatch && staffMatch && modeMatch && receiverMatch && ownerMatch && followUpMatch && (!query || haystack.includes(query));
    });
  }

  private serviceTrendsRows(): ApiRecord[] {
    const query = this.query.trim().toLowerCase();
    return this.serviceTrendsReportRows().filter((row) => {
      const groupMatch = !this.serviceGroupFilter || String(row['serviceGroup'] || '') === String(this.serviceGroupFilter);
      const serviceMatch = !this.serviceTrendFilter || [row['serviceId'], row['serviceName']].map(String).includes(String(this.serviceTrendFilter));
      const staffMatch = !this.staffFilter || String(row['staffId'] || row['staffName'] || '') === String(this.staffFilter);
      const gstMatch = !this.serviceGstRateFilter || String(row['gstRate']) === String(this.serviceGstRateFilter);
      const revenueMatch = !this.serviceRevenueBucketFilter || this.serviceRevenueBucket(Number(row['netSale'] || 0)) === this.serviceRevenueBucketFilter;
      const marginMatch = !this.serviceMarginBucketFilter || String(row['marginBucket'] || '') === this.serviceMarginBucketFilter;
      const quantityMatch = !this.serviceQuantityBucketFilter || this.serviceQuantityBucket(Number(row['quantitySold'] || 0)) === this.serviceQuantityBucketFilter;
      const timeMatch = !this.serviceTimeBucketFilter || String(row['timeBucket'] || '') === this.serviceTimeBucketFilter;
      const text = `${row['serviceGroup']} ${row['serviceName']} ${row['staffName']} ${row['clientNames']} ${row['invoiceIds']}`.toLowerCase();
      return groupMatch && serviceMatch && staffMatch && gstMatch && revenueMatch && marginMatch && quantityMatch && timeMatch && (!query || text.includes(query));
    });
  }

  private serviceClientsRows(): ApiRecord[] {
    const query = this.query.trim().toLowerCase();
    return this.serviceClientsReportRows().filter((row) => {
      const groupMatch = !this.serviceGroupFilter || String(row['serviceGroup'] || '') === String(this.serviceGroupFilter);
      const serviceMatch = !this.serviceTrendFilter || [row['serviceId'], row['serviceName']].map(String).includes(String(this.serviceTrendFilter));
      const staffMatch = !this.staffFilter || [row['staffId'], row['staffName']].map(String).includes(String(this.staffFilter));
      const clientMatch = !this.clientFilter || [row['clientId'], row['clientName']].map(String).includes(String(this.clientFilter));
      const branchMatch = !this.branchFilter || String(row['branchId'] || '') === String(this.branchFilter);
      const saleTypeMatch = !this.serviceSaleTypeFilter || String(row['saleType'] || '') === this.serviceSaleTypeFilter;
      const text = `${row['date']} ${row['time']} ${row['serviceGroup']} ${row['serviceName']} ${row['clientName']} ${row['clientPhone']} ${row['staffName']} ${row['invoiceNumber']} ${row['branchId']} ${row['saleType']}`.toLowerCase();
      return groupMatch && serviceMatch && staffMatch && clientMatch && branchMatch && saleTypeMatch && (!query || text.includes(query));
    });
  }

  canSendDueReminder(row: ApiRecord): boolean {
    return Number(row['dueAmount'] || 0) > 0
      && !!String(row['clientPhone'] || '').trim()
      && !row['closed']
      && !['closed', 'waived', 'written_off', 'voided', 'cancelled', 'deleted'].includes(String(row['invoiceStatus'] || '').toLowerCase());
  }

  dueReminderDisabledReason(row: ApiRecord): string {
    if (Number(row['dueAmount'] || 0) <= 0) return 'Invoice already paid';
    if (!String(row['clientPhone'] || '').trim()) return 'Client phone missing';
    if (row['closed']) return 'Invoice closed';
    const status = String(row['invoiceStatus'] || '').toLowerCase();
    if (['closed', 'waived', 'written_off', 'voided', 'cancelled', 'deleted'].includes(status)) return 'Invoice closed';
    return '';
  }

  sendDueReminder(row: ApiRecord): void {
    const invoiceId = String(row['invoiceId'] || '');
    if (!invoiceId || !this.canSendDueReminder(row)) return;
    this.error.set('');
    this.notice.set('');
    this.actionLoading.set(invoiceId);
    this.api.post<ApiRecord>(`reports/invoices/due-recovery/${invoiceId}/send-reminder`, {
      channel: 'whatsapp',
      messageType: 'payment_link_due_reminder',
      provider: 'razorpay'
    }).pipe(
      finalize(() => this.actionLoading.set(''))
    ).subscribe({
      next: (result) => {
        this.notice.set(`Payment reminder queued for ${row['invoiceNumber'] || invoiceId}.`);
        this.dueRecoveryReportRows.update((rows) => rows.map((entry) => String(entry['invoiceId']) === invoiceId ? ({
          ...entry,
          lastReminderSentAt: result['sentAt'] || result['queuedAt'] || new Date().toISOString(),
          reminderChannel: result['channel'] || 'whatsapp',
          paymentLinkStatus: result['status'] || 'queued',
          paymentLinkUrl: result['paymentLinkUrl'] || entry['paymentLinkUrl'] || '',
          paymentLinkId: result['paymentLinkId'] || entry['paymentLinkId'] || ''
        }) : entry));
        this.refreshDueRecoveryReport();
      },
      error: (error) => this.error.set(this.api.errorText(error, 'Unable to send payment reminder'))
    });
  }

  dueRecoveryActionKey(row: ApiRecord, action: string): string {
    return `${row['invoiceId'] || ''}:${action}`;
  }

  assignDueRecoveryManager(row: ApiRecord): void {
    const invoiceId = String(row['invoiceId'] || '');
    const managerId = String(this.recoveryOwnerDrafts[invoiceId] || row['recoveryOwnerId'] || '').trim();
    if (!invoiceId) return;
    if (!managerId) {
      this.error.set('Select recovery owner first.');
      return;
    }
    const key = this.dueRecoveryActionKey(row, 'assign');
    this.error.set('');
    this.notice.set('');
    this.actionLoading.set(key);
    this.api.post<ApiRecord>(`reports/invoices/due-recovery/${invoiceId}/assign-manager`, { managerId }).pipe(
      finalize(() => this.actionLoading.set(''))
    ).subscribe({
      next: (result) => this.applyDueRecoveryFollowUpResult(invoiceId, result, 'Manager assigned.'),
      error: (error) => this.error.set(this.api.errorText(error, 'Unable to assign manager'))
    });
  }

  markDueRecoveryCallDone(row: ApiRecord): void {
    const invoiceId = String(row['invoiceId'] || '');
    if (!invoiceId) return;
    const key = this.dueRecoveryActionKey(row, 'call');
    this.error.set('');
    this.notice.set('');
    this.actionLoading.set(key);
    this.api.post<ApiRecord>(`reports/invoices/due-recovery/${invoiceId}/mark-call-done`, {
      managerId: row['recoveryOwnerId'] || this.recoveryOwnerDrafts[invoiceId] || '',
      note: 'Call completed from Due Recovery'
    }).pipe(
      finalize(() => this.actionLoading.set(''))
    ).subscribe({
      next: (result) => this.applyDueRecoveryFollowUpResult(invoiceId, result, 'Call follow-up marked done.'),
      error: (error) => this.error.set(this.api.errorText(error, 'Unable to mark call done'))
    });
  }

  addDueRecoveryFollowUpNote(row: ApiRecord): void {
    const invoiceId = String(row['invoiceId'] || '');
    if (!invoiceId) return;
    const note = String(window.prompt('Follow-up note') || '').trim();
    if (!note) return;
    const key = this.dueRecoveryActionKey(row, 'note');
    this.error.set('');
    this.notice.set('');
    this.actionLoading.set(key);
    this.api.post<ApiRecord>(`reports/invoices/due-recovery/${invoiceId}/follow-up-note`, {
      managerId: row['recoveryOwnerId'] || this.recoveryOwnerDrafts[invoiceId] || '',
      note
    }).pipe(
      finalize(() => this.actionLoading.set(''))
    ).subscribe({
      next: (result) => this.applyDueRecoveryFollowUpResult(invoiceId, result, 'Follow-up note saved.'),
      error: (error) => this.error.set(this.api.errorText(error, 'Unable to save follow-up note'))
    });
  }

  private applyDueRecoveryFollowUpResult(invoiceId: string, result: ApiRecord, message: string): void {
    const refreshed = (result['row'] || {}) as ApiRecord;
    if (Object.keys(refreshed).length) {
      this.dueRecoveryReportRows.update((rows) => rows.map((entry) => String(entry['invoiceId']) === invoiceId ? { ...entry, ...refreshed } : entry));
    }
    this.notice.set(message);
    this.refreshDueRecoveryReport();
  }

  private safeList(resource: string, params: ApiRecord = {}) {
    return this.api.list<ApiRecord[]>(resource, params).pipe(catchError(() => of([] as ApiRecord[])));
  }

  private paymentsForFilteredInvoices(): ApiRecord[] {
    const ids = new Set(this.filteredLines().map((line) => line.invoiceId));
    return this.payments().filter((payment) => ids.has(String(payment.invoiceId || payment.invoice_id || '')));
  }

  private lastPaymentDate(invoiceId: string): string {
    return this.payments()
      .filter((payment) => String(payment.invoiceId || payment.invoice_id || '') === String(invoiceId))
      .filter((payment) => Number(payment.amount || payment.paidAmount || payment.paid_amount || 0) > 0)
      .map((payment) => String(payment.paidAt || payment.paid_at || payment.paymentDate || payment.payment_date || payment.createdAt || payment.created_at || payment.date || ''))
      .filter((value) => this.dateMs(value) > 0)
      .sort((a, b) => this.dateMs(b) - this.dateMs(a))[0] || '';
  }

  private lastRecoveryTouchDate(invoiceId: string, invoiceNumber: string, clientId: string): string {
    return this.auditLogs()
      .filter((log) => {
        const action = String(log.action || log.event || log.type || log.activity || '').toLowerCase();
        const text = `${log.entityType || log.entity_type || ''} ${log.entityId || log.entity_id || ''} ${log.invoiceId || log.invoice_id || ''} ${log.clientId || log.client_id || ''} ${log.reference || ''} ${log.message || ''} ${log.details || ''}`.toLowerCase();
        const isRecoveryTouch = ['recovery', 'reminder', 'whatsapp', 'payment_link', 'call', 'follow'].some((token) => action.includes(token) || text.includes(token));
        const matchesInvoice = text.includes(String(invoiceId).toLowerCase()) || text.includes(String(invoiceNumber).toLowerCase()) || text.includes(String(clientId).toLowerCase());
        return isRecoveryTouch && matchesInvoice;
      })
      .map((log) => String(log.createdAt || log.created_at || log.updatedAt || log.updated_at || log.date || log.timestamp || ''))
      .filter((value) => this.dateMs(value) > 0)
      .sort((a, b) => this.dateMs(b) - this.dateMs(a))[0] || '';
  }

  private unpaidBucket(days: number): string {
    if (days > 30) return '30+ days';
    if (days >= 16) return '16-30 days';
    if (days >= 8) return '8-15 days';
    return '0-7 days';
  }

  private recoveryAction(days: number): string {
    if (days > 30) return 'High risk / credit block';
    if (days >= 16) return 'Owner recovery queue';
    if (days >= 8) return 'Manager follow-up';
    if (days >= 4) return 'WhatsApp payment link';
    return 'Soft reminder';
  }

  private uniqueInvoiceRows(): InvoiceLine[] {
    const map = new Map<string, InvoiceLine>();
    for (const line of this.filteredLines()) {
      if (!map.has(line.invoiceId)) map.set(line.invoiceId, line);
    }
    return [...map.values()];
  }

  private uniqueInvoiceSum(lines: InvoiceLine[], key: keyof InvoiceLine): number {
    const map = new Map<string, number>();
    for (const line of lines) {
      map.set(line.invoiceId, Number(line[key] || 0));
    }
    return this.money([...map.values()].reduce((sum, value) => sum + value, 0));
  }

  private group<T>(items: T[], keyFn: (item: T) => string): T[][] {
    const map = new Map<string, T[]>();
    for (const item of items) {
      const key = keyFn(item);
      map.set(key, [...(map.get(key) || []), item]);
    }
    return [...map.values()];
  }

  private sum<T extends ApiRecord | InvoiceLine>(items: T[], key: string): number {
    return this.money(items.reduce((sum, item) => sum + Number((item as ApiRecord)[key] || 0), 0));
  }

  private topBy(rows: ApiRecord[], labelKey: string, valueKey: string): { label: string; value: number } {
    const map = new Map<string, number>();
    for (const row of rows) {
      const label = String(row[labelKey] || '').trim();
      if (!label) continue;
      map.set(label, (map.get(label) || 0) + Number(row[valueKey] || 0));
    }
    return [...map.entries()]
      .map(([label, value]) => ({ label, value: this.money(value) }))
      .sort((a, b) => b.value - a.value)[0] || { label: '', value: 0 };
  }

  private formatMoney(value: number): string {
    return `₹${this.money(value).toLocaleString('en-IN')}`;
  }

  private productLookupKey(value: string): string {
    return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  }

  private productStockSignal(line: InvoiceLine): string {
    if (!line.productId && !line.productSku && !line.productBarcode) return 'Unmapped';
    if (line.productStock <= 0) return 'Stockout risk';
    if (line.productStock <= Math.max(2, line.quantity, line.productLowStockThreshold)) return 'Low stock';
    return 'Healthy';
  }

  private uniqueLineOption(key: keyof InvoiceLine, labelFn?: (value: unknown) => string): { id: string; label: string }[] {
    const map = new Map<string, string>();
    for (const line of this.lines().filter((item) => item.itemType === 'product')) {
      const value = line[key];
      const id = String(value ?? '').trim();
      if (id) map.set(id, labelFn ? labelFn(value) : id);
    }
    return [...map.entries()].map(([id, label]) => ({ id, label })).sort((a, b) => a.label.localeCompare(b.label));
  }

  private uniqueServiceTrendOption(key: string, labelFn?: (value: unknown) => string): { id: string; label: string }[] {
    const map = new Map<string, string>();
    for (const row of [...this.serviceTrendsReportRows(), ...this.serviceClientsReportRows()]) {
      const value = row[key];
      const id = String(value ?? '').trim();
      if (id) map.set(id, labelFn ? labelFn(value) : id);
    }
    return [...map.entries()].map(([id, label]) => ({ id, label })).sort((a, b) => a.label.localeCompare(b.label));
  }

  private uniqueAnyLineOption(key: keyof InvoiceLine, labelFn?: (value: unknown) => string): { id: string; label: string }[] {
    const map = new Map<string, string>();
    for (const line of this.lines()) {
      const value = line[key];
      const id = String(value ?? '').trim();
      if (id) map.set(id, labelFn ? labelFn(value) : id);
    }
    return [...map.entries()].map(([id, label]) => ({ id, label })).sort((a, b) => a.label.localeCompare(b.label));
  }

  private modeMatches(paymentModes: string, mode: string): boolean {
    const expected = this.modeLabel(mode).toLowerCase();
    const text = String(paymentModes || '').toLowerCase();
    return text.includes(String(mode || '').toLowerCase()) || text.includes(expected);
  }

  private serviceRevenueBucket(value: number): string {
    if (value >= 10000) return '10000+';
    if (value >= 5000) return '5000-9999';
    if (value >= 1000) return '1000-4999';
    return '0-999';
  }

  private serviceQuantityBucket(value: number): string {
    if (value >= 50) return '50+';
    if (value >= 20) return '20-49';
    if (value >= 5) return '5-19';
    return '1-4';
  }

  private matchesMarginFilter(line: InvoiceLine): boolean {
    if (!this.marginHealthFilter) return true;
    const cost = this.money(line.productUnitCost * line.quantity);
    const margin = this.money(line.taxable - cost);
    const marginPercent = line.taxable > 0 && cost > 0 ? this.money((margin / line.taxable) * 100) : 0;
    const alert = this.marginAlert(line, marginPercent).toLowerCase();
    if (this.marginHealthFilter === 'unknown') return alert.includes('cost missing');
    if (this.marginHealthFilter === 'low') return alert !== 'healthy';
    if (this.marginHealthFilter === 'healthy') return alert === 'healthy';
    return true;
  }

  private weightedMarginPercent(rows: ApiRecord[]): number {
    const taxable = this.sum(rows, 'taxableAmount');
    const margin = this.sum(rows, 'grossMargin');
    return taxable > 0 ? this.money((margin / taxable) * 100) : 0;
  }

  private marginAlert(line: InvoiceLine, marginPercent: number): string {
    if (line.productUnitCost <= 0) return 'Cost missing';
    if (marginPercent < 0) return 'Negative margin';
    if (marginPercent < 20) return 'Low margin';
    return 'Healthy';
  }

  private productFifoSource(line: InvoiceLine): string {
    if (line.productBatchNumber && line.productExpiryDate) return `${line.productBatchNumber} / ${line.productExpiryDate}`;
    if (line.productBatchNumber) return line.productBatchNumber;
    if (line.productExpiryDate) return `Expiry ${line.productExpiryDate}`;
    return line.productId ? 'FIFO/batch not linked in invoice row' : 'Product not mapped';
  }

  private productReorderSuggestion(line: InvoiceLine, reorderLevel: number): string {
    if (!line.productId && !line.productSku && !line.productBarcode) return 'Map product first';
    if (line.productStock <= 0) return `Reorder now (${Math.max(reorderLevel * 2, line.quantity)} units)`;
    if (line.productStock <= reorderLevel) return `Reorder soon (${Math.max(reorderLevel, line.quantity)} units)`;
    return 'No reorder needed';
  }

  private clientProductPurchaseCount(clientId: string, productName: string): number {
    const key = this.productLookupKey(productName);
    return this.lines()
      .filter((line) => line.itemType === 'product')
      .filter((line) => String(line.clientId || '') === String(clientId || ''))
      .filter((line) => this.productLookupKey(line.itemName) === key)
      .length;
  }

  private aftercareOpportunity(line: InvoiceLine, repeatCount: number): string {
    const name = line.itemName || 'product';
    if (repeatCount > 1) return `Recommend refill / bundle for ${name}`;
    if (line.productCategory) return `Aftercare message for ${line.productCategory}`;
    return `Ask feedback and usage tips for ${name}`;
  }

  private staffRetailTargetAchievement(staffName: string): string {
    const staffRows = this.filteredLines().filter((line) => line.itemType === 'product' && line.staffName === staffName);
    const retailSale = this.sum(staffRows, 'final');
    const target = Math.max(10000, staffRows.length * 1000);
    return `${Math.min(100, this.money((retailSale / target) * 100))}% of ${this.formatMoney(target)}`;
  }

  private productAccountingCode(line: InvoiceLine): string {
    const gst = `${this.money(line.gstRate)}GST`;
    const category = this.productLookupKey(line.productCategory || 'retail').replace(/\s+/g, '_') || 'retail';
    return `RETAIL_${category.toUpperCase()}_${gst}`;
  }

  private lineRate(item: ApiRecord): number {
    const explicit = item.rate ?? item.price ?? item.unitPrice ?? item.unit_price ?? item.sellingPrice ?? item.selling_price ?? item.mrp;
    if (explicit !== undefined && explicit !== null && explicit !== '') return this.money(Number(explicit));
    const qty = Number(item.quantity || item.qty || 1) || 1;
    return this.money(Number(item.total || item.lineTotal || 0) / qty);
  }

  private lineGross(item: ApiRecord): number {
    const explicit = item.gross ?? item.grossAmount ?? item.gross_amount ?? item.subtotal ?? item.lineSubtotal ?? item.line_subtotal;
    if (explicit !== undefined && explicit !== null && explicit !== '') return this.money(Number(explicit));
    return this.money(this.lineRate(item) * Number(item.quantity || item.qty || 1));
  }

  private lineDiscount(item: ApiRecord, gross: number, grossTotal: number, invoiceDiscount: number): number {
    const explicit = item.discount ?? item.discountAmount ?? item.discount_amount ?? item.manualDiscount ?? item.manual_discount ?? item.lineDiscount ?? item.line_discount;
    if (explicit !== undefined && explicit !== null && explicit !== '') return this.money(Number(explicit));
    if (invoiceDiscount <= 0 || grossTotal <= 0) return 0;
    return this.money((gross / grossTotal) * invoiceDiscount);
  }

  private lineGst(item: ApiRecord, taxable: number, rate: number): number {
    const explicit = item.gstAmount ?? item.gst_amount ?? item.taxAmount ?? item.tax_amount ?? item.lineTax ?? item.line_tax;
    if (explicit !== undefined && explicit !== null && explicit !== '') return this.money(Number(explicit));
    return this.money((taxable * rate) / 100);
  }

  private lineFinal(item: ApiRecord, taxable: number, gst: number): number {
    const explicit = item.total ?? item.lineTotal ?? item.line_total ?? item.finalAmount ?? item.final_amount;
    if (explicit !== undefined && explicit !== null && explicit !== '') return this.money(Number(explicit));
    return this.money(taxable + gst);
  }

  private prepaidAmount(invoice: ApiRecord, sale: ApiRecord, payments: ApiRecord[]): number {
    const explicit = invoice.prepaidAmount
      ?? invoice.prepaid_amount
      ?? invoice.advanceAdjusted
      ?? invoice.advance_adjusted
      ?? invoice.walletUsed
      ?? invoice.wallet_used
      ?? sale.prepaidAmount
      ?? sale.prepaid_amount
      ?? sale.advanceAdjusted
      ?? sale.advance_adjusted
      ?? sale.walletUsed
      ?? sale.wallet_used;
    if (explicit !== undefined && explicit !== null && explicit !== '') {
      return this.money(Number(explicit));
    }
    return this.money(payments
      .filter((payment) => {
        const mode = String(payment.mode || payment.paymentMode || payment.payment_mode || '').toLowerCase();
        const reference = String(payment.reference || payment.referenceNo || payment.note || payment.notes || '').toLowerCase();
        return mode.includes('wallet')
          || mode.includes('advance')
          || mode.includes('prepaid')
          || reference.includes('advance')
          || reference.includes('prepaid');
      })
      .reduce((sum, payment) => sum + Number(payment.amount || payment.paidAmount || payment.paid_amount || 0), 0));
  }

  private normalizedItemType(item: ApiRecord): string {
    const raw = `${item.type || item.itemType || item.kind || item.category || item.name || ''}`.toLowerCase();
    if (raw.includes('membership')) return 'membership';
    if (raw.includes('package')) return 'package';
    if (raw.includes('gift')) return 'gift_card';
    if (raw.includes('product') || raw.includes('retail')) return 'product';
    if (raw.includes('service')) return 'service';
    return 'service';
  }

  private latestWallet(clientId: string): ApiRecord | undefined {
    return this.walletTransactions()
      .filter((item) => String(item.clientId || item.client_id || item.customerId || item.customer_id || '') === String(clientId))
      .sort((a, b) => this.dateMs(b.createdAt || b.created_at || b.date || b.updatedAt) - this.dateMs(a.createdAt || a.created_at || a.date || a.updatedAt))[0];
  }

  private clientById(clientId: string): ApiRecord | undefined {
    return this.clients().find((client) => String(client.id) === String(clientId));
  }

  private invoiceClientId(invoiceId: string): string {
    return this.uniqueInvoiceRows().find((line) => line.invoiceId === invoiceId)?.clientId || '';
  }

  private modeLabel(mode: string): string {
    const clean = String(mode || 'unknown').replace(/[_-]+/g, ' ').trim();
    return clean ? clean[0].toUpperCase() + clean.slice(1) : 'Unknown';
  }

  private inDateRange(value: string): boolean {
    const time = this.dateMs(value);
    if (!time) return true;
    const from = this.from ? this.dateMs(this.from) : 0;
    const to = this.to ? this.dateMs(this.to) + 24 * 60 * 60 * 1000 - 1 : 0;
    return (!from || time >= from) && (!to || time <= to);
  }

  private ageDays(value: string): number {
    const time = this.dateMs(value);
    if (!time) return 0;
    return Math.max(0, Math.floor((Date.now() - time) / (24 * 60 * 60 * 1000)));
  }

  private dateKey(value: string): string {
    if (!value) return 'No date';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? String(value).slice(0, 10) : date.toISOString().slice(0, 10);
  }

  private timeLabel(value: string): string {
    if (!value) return '';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? '' : date.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
  }

  private dateMs(value: unknown): number {
    if (!value) return 0;
    const date = new Date(String(value));
    return Number.isNaN(date.getTime()) ? 0 : date.getTime();
  }

  private readArray(value: unknown): ApiRecord[] {
    if (Array.isArray(value)) return value as ApiRecord[];
    if (!value) return [];
    try {
      const parsed = JSON.parse(String(value));
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  private readObject(value: unknown): ApiRecord {
    if (value && typeof value === 'object' && !Array.isArray(value)) return value as ApiRecord;
    if (!value) return {};
    try {
      const parsed = JSON.parse(String(value));
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as ApiRecord : {};
    } catch {
      return {};
    }
  }

  private auditDetails(log: ApiRecord): ApiRecord {
    return {
      ...this.readObject(log['oldValue'] || log['old_value']),
      ...this.readObject(log['details']),
      ...this.readObject(log['newValue'] || log['new_value']),
      ...this.readObject(log['metadata'] || log['metadataJson'] || log['metadata_json'])
    };
  }

  private csvCell(value: unknown): string {
    return `"${String(value ?? '').replace(/"/g, '""')}"`;
  }

  private downloadFile(filename: string, content: BlobPart, type: string): void {
    const blob = content instanceof Blob ? content : new Blob([content], { type });
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
      const chunks = text.match(/.{1,96}/g) || [''];
      return chunks;
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

  private money(value: number): number {
    return Math.round((Number(value) || 0) * 100) / 100;
  }

  private today(): string {
    return new Date().toISOString().slice(0, 10);
  }

  private monthStart(): string {
    const date = new Date();
    date.setDate(1);
    return date.toISOString().slice(0, 10);
  }
}
