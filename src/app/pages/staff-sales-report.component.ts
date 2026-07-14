import { CommonModule } from '@angular/common';
import { Component, OnInit, computed, effect, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { AuthSessionService } from '../core/auth-session.service';
import { grantsAllow, staticGrantsForRole } from '../core/permission.guard';
import { routePermissionForPath } from '../core/access-rules';
import { AppStateService } from '../core/state/app-state.service';
import { ApiRecord, ApiService } from '../core/api.service';
import { StateComponent } from '../shared/ui/state/state.component';
import { AuraMoneyPipe } from '../shared/pipes/aura-money.pipe';
import { AuraDatePipe } from '../shared/pipes/aura-date.pipe';

@Component({
  selector: 'app-staff-sales-report',
  standalone: true,
  imports: [AuraDatePipe, AuraMoneyPipe, CommonModule, FormsModule, RouterLink, StateComponent],
  template: `
    <section class="page-stack inner-page-shell">
      <div class="module-hero inner-page-header">
        <div>
          <h2>Staff Sales Report</h2>
        </div>
        <div class="hero-actions inner-action-bar">
          <a class="ghost-button" routerLink="/reports">Reports</a>
          <a class="ghost-button" routerLink="/reports/commission-preview">Commission preview</a>
          <a class="ghost-button" routerLink="/pos/tips">Tip Register</a>
          <button class="ghost-button" type="button" (click)="exportCsv()">Export CSV</button>
          <button class="ghost-button" type="button" (click)="exportOwnerPdf()">Owner PDF</button>
          <button class="ghost-button" type="button" (click)="exportPayoutPdf()">Payout PDF</button>
          <button class="ghost-button" type="button" (click)="load()">Refresh</button>
        </div>
      </div>

      <section class="panel filter-panel">
        <label class="field">
          <span>From</span>
          <input type="date" [(ngModel)]="from" />
        </label>
        <label class="field">
          <span>To</span>
          <input type="date" [(ngModel)]="to" />
        </label>
        <label class="field">
          <span>Staff</span>
          <select [(ngModel)]="staffId">
            <option value="">All staff</option>
            <option *ngFor="let staff of staffOptions()" [value]="staff.id">{{ staff.label }}</option>
          </select>
        </label>
        <label class="field">
          <span>Item type</span>
          <select [(ngModel)]="saleType">
            <option value="">All sales</option>
            <option value="service">Services</option>
            <option value="product">Products</option>
            <option value="membership">Memberships</option>
            <option value="package">Packages</option>
            <option value="gift_card">Gift cards</option>
          </select>
        </label>
        <label class="field">
          <span>Service sale type</span>
          <select [(ngModel)]="serviceSaleType">
            <option value="">All service sales</option>
            <option value="quick_sale">Quick Sale</option>
            <option value="appointment">Appointment</option>
          </select>
        </label>
        <label class="field">
          <span>Discount mode</span>
          <select [(ngModel)]="discountMode">
            <option value="with_discount">With Discount</option>
            <option value="without_discount">Without Discount</option>
            <option value="compare">Compare Both</option>
          </select>
        </label>
        <label class="field">
          <span>Due status</span>
          <select [(ngModel)]="dueStatus">
            <option value="">All due status</option>
            <option value="pending">Pending due</option>
            <option value="clear">Clear</option>
          </select>
        </label>
        <label class="field">
          <span>Service</span>
          <input [(ngModel)]="service" placeholder="Service name or ID" />
        </label>
        <label class="field">
          <span>Product</span>
          <input [(ngModel)]="product" placeholder="Product name or ID" />
        </label>
        <label class="field">
          <span>Category</span>
          <input [(ngModel)]="category" placeholder="Category / group" />
        </label>
        <label class="field">
          <span>Commission</span>
          <select [(ngModel)]="commissionStatus">
            <option value="">All</option>
            <option value="commission_due">Commission due</option>
            <option value="no_commission">No commission</option>
          </select>
        </label>
        <label class="field">
          <span>Performance</span>
          <select [(ngModel)]="performanceBucket">
            <option value="">All scores</option>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </select>
        </label>
        <label class="field">
          <span>Search</span>
          <input [(ngModel)]="query" placeholder="Invoice, client, phone, service" />
        </label>
        <div class="branch-context-card">
          <span>Header branch</span>
          <strong>{{ branchLabel() }}</strong>
        </div>
        <button class="primary-button" type="button" (click)="load()">Apply filters</button>
      </section>

      <app-state [loading]="loading()" [error]="error()"></app-state>

      <ng-container *ngIf="report() as data">
        <div class="metrics-grid inner-stats-grid">
          <article class="metric-card">
            <span>Total attributed sales</span>
            <strong>{{ data.totals?.totalRevenue || 0 | auraMoney:'1.0-0' }}</strong>
            <small>{{ data.totals?.itemCount || 0 }} line items</small>
          </article>
          <article class="metric-card">
            <span>Service sales</span>
            <strong>{{ data.totals?.serviceRevenue || 0 | auraMoney:'1.0-0' }}</strong>
          </article>
          <article class="metric-card">
            <span>Product sales</span>
            <strong>{{ data.totals?.productRevenue || 0 | auraMoney:'1.0-0' }}</strong>
          </article>
          <article class="metric-card">
            <span>Membership + package</span>
            <strong>{{ membershipPackageRevenue(data) | auraMoney:'1.0-0' }}</strong>
          </article>
          <article class="metric-card">
            <span>Gift card sales</span>
            <strong>{{ data.totals?.giftCardRevenue || 0 | auraMoney:'1.0-0' }}</strong>
          </article>
          <article class="metric-card">
            <span>Total clients</span>
            <strong>{{ data.totals?.clientsCount || 0 }}</strong>
          </article>
          <article class="metric-card">
            <span>Total invoices</span>
            <strong>{{ data.totals?.invoiceCount || 0 }}</strong>
          </article>
          <article class="metric-card">
            <span>Average bill</span>
            <strong>{{ data.totals?.averageBill || 0 | auraMoney:'1.0-0' }}</strong>
          </article>
          <article class="metric-card">
            <span>Pending due</span>
            <strong>{{ data.totals?.pendingDue || 0 | auraMoney:'1.0-0' }}</strong>
          </article>
          <article class="metric-card">
            <span>Discount given</span>
            <strong>{{ data.totals?.discountGiven || 0 | auraMoney:'1.0-0' }}</strong>
          </article>
          <article class="metric-card">
            <span>Staff tips</span>
            <strong>{{ data.totals?.tips || 0 | auraMoney:'1.0-0' }}</strong>
            <small><a routerLink="/pos/tips">Open payout register</a></small>
          </article>
          <article class="metric-card">
            <span>Estimated commission</span>
            <strong>{{ data.totals?.estimatedCommission || 0 | auraMoney:'1.0-0' }}</strong>
          </article>
        </div>

        <nav class="report-tabs" aria-label="Staff sales report sections">
          <button type="button" [class.active]="activeTab() === 'leaderboard'" (click)="setActiveTab('leaderboard')">Staff Leaderboard</button>
          <button type="button" [class.active]="activeTab() === 'services'" (click)="setActiveTab('services')">Services By Staff</button>
          <button type="button" [class.active]="activeTab() === 'products'" (click)="setActiveTab('products')">Products By Staff</button>
          <button type="button" [class.active]="activeTab() === 'commission'" (click)="setActiveTab('commission')">Commission / Payout</button>
        </nav>

        <section class="panel" *ngIf="activeTab() === 'leaderboard' && leaderboardView() === 'summary'">
          <div class="section-title inner-action-bar">
            <div>
              <h2>Staff summary</h2>
            </div>
            <div class="section-actions">
              <button class="ghost-button mini" type="button" (click)="setLeaderboardView('items')">Staff by item</button>
            </div>
          </div>
          <div class="table-wrap fit-wrap inner-table-wrap">
            <table class="leaderboard-table">
              <thead>
                <tr>
                  <th>Action</th>
                  <th>Staff</th>
                  <th>Staff ID</th>
                  <th>Contact</th>
                  <th>Services</th>
                  <th>Products</th>
                  <th>Membership/package</th>
                  <th>Gift cards</th>
                  <th>Total sales</th>
                  <th>Clients</th>
                  <th>Invoices</th>
                  <th>Average bill</th>
                  <th>Pending due</th>
                  <th>Discount</th>
                  <th>Tips</th>
                  <th>Commission</th>
                  <th>Score</th>
                  <th>Staff 360</th>
                </tr>
              </thead>
              <tbody>
                <ng-container *ngFor="let row of data.staff || []">
                  <tr>
                    <td><button class="ghost-button mini" type="button" (click)="toggleStaff(row)">{{ isExpanded(row) ? 'Hide' : 'Expand' }}</button></td>
                    <td><strong>{{ row.staffName }}</strong><small>{{ row.itemCount }} items</small></td>
                    <td>{{ row.staffCode || row.staffId }}</td>
                    <td>{{ row.contact || '-' }}</td>
                    <td>{{ row.serviceRevenue | auraMoney:'1.0-0' }}</td>
                    <td>{{ row.productRevenue | auraMoney:'1.0-0' }}</td>
                    <td>{{ membershipPackageRevenue({ totals: row }) | auraMoney:'1.0-0' }}</td>
                    <td>{{ row.giftCardRevenue | auraMoney:'1.0-0' }}</td>
                    <td>{{ row.totalRevenue | auraMoney:'1.0-0' }}</td>
                    <td>{{ row.clientsCount || 0 }}</td>
                    <td>{{ row.invoiceCount || 0 }}</td>
                    <td>{{ row.averageBill | auraMoney:'1.0-0' }}</td>
                    <td>{{ row.pendingDue | auraMoney:'1.0-0' }}</td>
                    <td>{{ row.discountGiven | auraMoney:'1.0-0' }}</td>
                    <td>{{ row.tips | auraMoney:'1.0-0' }}</td>
                    <td>{{ row.estimatedCommission | auraMoney:'1.0-0' }}</td>
                    <td><span class="score-pill" [class.good]="row.performanceScore >= 75" [class.warn]="row.performanceScore < 45">{{ row.performanceScore || 0 }}</span></td>
                    <td><a class="ghost-button mini" routerLink="/staff-os/staff-profile" [queryParams]="staffProfileParams(row)">Open</a></td>
                  </tr>
                  <tr class="expanded-row" *ngIf="isExpanded(row)">
                    <td colspan="18">
                      <div class="detail-grid">
                        <section>
                          <div class="mini-title"><span>Service detail</span><strong>{{ row.serviceBreakdown?.length || 0 }} services</strong></div>
                          <table>
                            <thead><tr><th>Service</th><th>Qty</th><th>Gross</th><th>Discount</th><th>Net</th><th>GST</th><th>COGS</th><th>Margin</th><th>Margin %</th><th>Clients</th><th>Repeat</th><th>Last sold</th></tr></thead>
                            <tbody>
                              <tr *ngFor="let service of row.serviceBreakdown || []">
                                <td>{{ service.serviceName }}</td>
                                <td>{{ service.quantity }}</td>
                                <td>{{ service.grossSale | auraMoney:'1.0-0' }}</td>
                                <td>{{ service.discount | auraMoney:'1.0-0' }}</td>
                                <td>{{ service.netSale | auraMoney:'1.0-0' }}</td>
                                <td>{{ service.gst | auraMoney:'1.0-0' }}</td>
                                <td>{{ service.cogs | auraMoney:'1.0-0' }} <span class="badge warning" *ngIf="service.costSignal === 'missing_cost'">missing cost</span></td>
                                <td>{{ service.grossMargin | auraMoney:'1.0-0' }}</td>
                                <td>{{ service.marginPercent }}%</td>
                                <td>{{ service.clientCount }}</td>
                                <td>{{ service.repeatClientCount }}</td>
                                <td>{{ service.lastSoldAt || '-' }}</td>
                              </tr>
                              <tr *ngIf="!(row.serviceBreakdown || []).length"><td colspan="12">No services for this staff/filter.</td></tr>
                            </tbody>
                          </table>
                        </section>
                        <section>
                          <div class="mini-title"><span>Product detail</span><strong>{{ row.productBreakdown?.length || 0 }} products</strong></div>
                          <table>
                            <thead><tr><th>Product</th><th>Qty</th><th>Net</th><th>COGS</th><th>Margin</th><th>Clients</th><th>Last sold</th></tr></thead>
                            <tbody>
                              <tr *ngFor="let product of row.productBreakdown || []">
                                <td>{{ product.productName }}</td>
                                <td>{{ product.quantity }}</td>
                                <td>{{ product.netSale | auraMoney:'1.0-0' }}</td>
                                <td>{{ product.cogs | auraMoney:'1.0-0' }}</td>
                                <td>{{ product.grossMargin | auraMoney:'1.0-0' }}</td>
                                <td>{{ product.clientCount }}</td>
                                <td>{{ product.lastSoldAt || '-' }}</td>
                              </tr>
                              <tr *ngIf="!(row.productBreakdown || []).length"><td colspan="7">No products for this staff/filter.</td></tr>
                            </tbody>
                          </table>
                        </section>
                      </div>
                    </td>
                  </tr>
                </ng-container>
                <tr *ngIf="!(data.staff || []).length">
                  <td colspan="18">No staff-attributed sales found.</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        <section class="panel" *ngIf="activeTab() === 'services'">
          <div class="section-title inner-action-bar">
            <div>
              <h2>Services By Staff</h2>
            </div>
            <button class="ghost-button mini" type="button" (click)="exportCsv()">Services CSV</button>
          </div>
          <div class="metrics-grid compact">
            <article class="metric-card">
              <span>Gross service sale</span>
              <strong>{{ data.totals?.grossServiceSale || 0 | auraMoney:'1.0-0' }}</strong>
            </article>
            <article class="metric-card">
              <span>Final service sale</span>
              <strong>{{ data.totals?.finalServiceSale || 0 | auraMoney:'1.0-0' }}</strong>
            </article>
            <article class="metric-card">
              <span>Discount amount</span>
              <strong>{{ data.totals?.serviceDiscountAmount || 0 | auraMoney:'1.0-0' }}</strong>
              <small>{{ data.totals?.serviceDiscountPercent || 0 }}% leakage</small>
            </article>
            <article class="metric-card">
              <span>Share before discount</span>
              <strong>{{ data.totals?.staffServiceShareBeforeDiscount || 0 | auraMoney:'1.0-0' }}</strong>
            </article>
            <article class="metric-card">
              <span>Share after discount</span>
              <strong>{{ data.totals?.staffServiceShareAfterDiscount || 0 | auraMoney:'1.0-0' }}</strong>
              <small>{{ discountModeLabel() }}</small>
            </article>
          </div>
          <div class="table-wrap scroll-wrap">
            <table class="services-table">
              <thead>
                <tr>
                  <th>Action</th>
                  <th>Staff name</th>
                  <th>Staff ID</th>
                  <th>Contact</th>
                  <th>Total service qty</th>
                  <th>Total service amount</th>
                  <th>Gross</th>
                  <th>Final</th>
                  <th>Discount %</th>
                  <th>Clients</th>
                  <th>Invoices</th>
                  <th>Pending due</th>
                  <th>Discount</th>
                  <th>Estimated commission</th>
                  <th>Staff 360</th>
                </tr>
              </thead>
              <tbody>
                <ng-container *ngFor="let row of data.staff || []">
                  <tr>
                    <td><button class="ghost-button mini" type="button" (click)="toggleStaff(row)">{{ isExpanded(row) ? 'Hide' : 'Expand' }}</button></td>
                    <td><strong>{{ row.staffName }}</strong><small>{{ row.serviceSaleRows?.length || 0 }} service rows</small></td>
                    <td>{{ row.staffCode || row.staffId }}</td>
                    <td>{{ row.contact || '-' }}</td>
                    <td>{{ row.serviceQty || 0 }}</td>
                    <td>{{ serviceAmountFor(row) | auraMoney:'1.0-0' }}</td>
                    <td>{{ row.grossServiceSale | auraMoney:'1.0-0' }}</td>
                    <td>{{ row.finalServiceSale | auraMoney:'1.0-0' }}</td>
                    <td>{{ row.serviceDiscountPercent || 0 }}%</td>
                    <td>{{ row.serviceClientsCount || 0 }}</td>
                    <td>{{ row.serviceInvoiceCount || 0 }}</td>
                    <td>{{ row.pendingDue | auraMoney:'1.0-0' }}</td>
                    <td>{{ row.discountGiven | auraMoney:'1.0-0' }}</td>
                    <td>{{ row.estimatedCommission | auraMoney:'1.0-0' }}</td>
                    <td><a class="ghost-button mini" routerLink="/staff-os/staff-profile" [queryParams]="staffProfileParams(row)">Open</a></td>
                  </tr>
                  <tr class="expanded-row" *ngIf="isExpanded(row)">
                    <td colspan="15">
                      <div class="service-drilldown">
                        <table>
                          <thead>
                            <tr>
                              <th>Service name</th>
                              <th>Qty</th>
                              <th *ngIf="discountMode !== 'with_discount'">Gross price</th>
                              <th>Discount</th>
                              <th *ngIf="discountMode === 'compare'">Discount %</th>
                              <th *ngIf="discountMode !== 'without_discount'">Final price</th>
                              <th *ngIf="discountMode !== 'with_discount'">Share before discount</th>
                              <th *ngIf="discountMode !== 'without_discount'">Share after discount</th>
                              <th>Invoice number</th>
                              <th>Invoice date</th>
                              <th>Appointment date</th>
                              <th>Created date</th>
                              <th>Customer name</th>
                              <th>Customer contact</th>
                              <th>Branch</th>
                              <th>Sale type</th>
                              <th>Staff share %</th>
                              <th>Payment mode</th>
                              <th>Transaction ID</th>
                              <th>GST</th>
                              <th>Due amount</th>
                              <th>Action</th>
                            </tr>
                          </thead>
                          <tbody>
                            <tr *ngFor="let serviceRow of row.serviceSaleRows || []">
                              <td><strong>{{ serviceRow.serviceName }}</strong><small>{{ serviceRow.serviceGroup }}</small></td>
                              <td>{{ serviceRow.qty }}</td>
                              <td *ngIf="discountMode !== 'with_discount'">{{ serviceRow.grossPrice | auraMoney:'1.0-0' }}</td>
                              <td>{{ serviceRow.discountAmount | auraMoney:'1.0-0' }}</td>
                              <td *ngIf="discountMode === 'compare'">{{ serviceRow.discountPercent || 0 }}%</td>
                              <td *ngIf="discountMode !== 'without_discount'">{{ serviceRow.finalPrice | auraMoney:'1.0-0' }}</td>
                              <td *ngIf="discountMode !== 'with_discount'">{{ serviceRow.serviceShareBeforeDiscount | auraMoney:'1.0-0' }}</td>
                              <td *ngIf="discountMode !== 'without_discount'">{{ serviceRow.serviceShareAfterDiscount | auraMoney:'1.0-0' }}</td>
                              <td>{{ serviceRow.invoiceNumber || '-' }}</td>
                              <td>{{ serviceRow.invoiceDate || '-' }} <small>{{ serviceRow.invoiceTime || '' }}</small></td>
                              <td>{{ serviceRow.appointmentDate || '-' }}</td>
                              <td>{{ serviceRow.createdDate || '-' }} <small>{{ serviceRow.createdTime || '' }}</small></td>
                              <td>{{ serviceRow.customerName || 'Walk-in' }}</td>
                              <td>{{ serviceRow.customerContact || '-' }}</td>
                              <td>{{ serviceRow.branchName || serviceRow.branchId || '-' }}</td>
                              <td><span class="badge">{{ serviceRow.saleType }}</span></td>
                              <td>{{ serviceRow.staffSharePercent || 100 }}%</td>
                              <td>{{ serviceRow.paymentMode || '-' }}</td>
                              <td>{{ serviceRow.transactionId || '-' }}</td>
                              <td>{{ serviceRow.gst | auraMoney:'1.0-0' }}</td>
                              <td>{{ serviceRow.dueAmount | auraMoney:'1.0-0' }}</td>
                              <td class="row-actions">
                                <a class="ghost-button mini" routerLink="/pos/invoices" [queryParams]="{ q: serviceRow.invoiceNumber }" *ngIf="canAccessPath('/pos/invoices')">Invoice</a>
                                <a class="ghost-button mini" routerLink="/clients" [queryParams]="{ q: serviceRow.customerContact || serviceRow.customerName }">Client</a>
                              </td>
                            </tr>
                            <tr *ngIf="!(row.serviceSaleRows || []).length">
                              <td colspan="22">No service invoice rows for this staff/filter.</td>
                            </tr>
                          </tbody>
                        </table>
                      </div>
                    </td>
                  </tr>
                </ng-container>
                <tr *ngIf="!(data.staff || []).length">
                  <td colspan="15">No service sales found for selected filters.</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        <section class="panel" *ngIf="activeTab() === 'products'">
          <div class="section-title inner-action-bar">
            <div>
              <h2>Products By Staff</h2>
            </div>
            <button class="ghost-button mini" type="button" (click)="exportProductRowsCsv()">Products CSV</button>
          </div>
          <div class="metrics-grid compact">
            <article class="metric-card">
              <span>Product sales</span>
              <strong>{{ productStats().productRevenue | auraMoney:'1.0-0' }}</strong>
            </article>
            <article class="metric-card">
              <span>Product units</span>
              <strong>{{ productStats().productCount }}</strong>
            </article>
            <article class="metric-card">
              <span>Staff selling products</span>
              <strong>{{ productStats().staffCount }}</strong>
            </article>
            <article class="metric-card">
              <span>Product SKUs</span>
              <strong>{{ productStats().skuCount }}</strong>
            </article>
            <article class="metric-card">
              <span>Missing cost</span>
              <strong>{{ productStats().missingCostCount }}</strong>
            </article>
            <article class="metric-card">
              <span>Product commission</span>
              <strong>{{ productStats().estimatedCommission | auraMoney:'1.0-0' }}</strong>
            </article>
          </div>
          <div class="report-info-strip">
            <strong>Product staff view</strong>
            <span>Staff-wise retail sale with product detail, COGS signal, margin and client accountability.</span>
          </div>
          <div class="table-wrap scroll-wrap">
            <table class="products-table">
              <thead><tr><th>Action</th><th>Staff</th><th>Contact</th><th>Product sales</th><th>Product count</th><th>Products</th><th>COGS signal</th><th>Est. commission</th><th>Staff 360</th></tr></thead>
              <tbody>
                <ng-container *ngFor="let row of productStaffRows()">
                <tr>
                  <td><button class="ghost-button mini" type="button" (click)="toggleStaff(row)">{{ isExpanded(row) ? 'Hide' : 'Expand' }}</button></td>
                  <td><strong>{{ row.staffName }}</strong><small>{{ row.staffCode || row.staffId }}</small></td>
                  <td>{{ row.contact || '-' }}</td>
                  <td>{{ row.productRevenue | auraMoney:'1.0-0' }}</td>
                  <td>{{ row.productCount || 0 }}</td>
                  <td>{{ (row.productBreakdown || []).length }}</td>
                  <td><span class="badge warning" *ngIf="hasMissingCost(row.productBreakdown)">Missing cost</span><span class="badge" *ngIf="!hasMissingCost(row.productBreakdown)">OK</span></td>
                  <td>{{ productCommission(row) | auraMoney:'1.0-0' }}</td>
                  <td><a class="ghost-button mini" routerLink="/staff-os/staff-profile" [queryParams]="staffProfileParams(row)">Open</a></td>
                </tr>
                <tr class="expanded-row" *ngIf="isExpanded(row)">
                  <td colspan="9">
                    <div class="product-drilldown">
                      <div class="mini-title"><span>Product detail</span><strong>{{ row.productBreakdown?.length || 0 }} products</strong></div>
                      <table>
                        <thead><tr><th>Product</th><th>Qty</th><th>Net sale</th><th>COGS</th><th>Gross margin</th><th>Margin %</th><th>Clients</th><th>Repeat clients</th><th>Last sold</th><th>Cost signal</th></tr></thead>
                        <tbody>
                          <tr *ngFor="let product of row.productBreakdown || []">
                            <td>{{ product.productName }}</td>
                            <td>{{ product.quantity }}</td>
                            <td>{{ product.netSale | auraMoney:'1.0-0' }}</td>
                            <td>{{ product.cogs | auraMoney:'1.0-0' }}</td>
                            <td>{{ product.grossMargin | auraMoney:'1.0-0' }}</td>
                            <td>{{ product.marginPercent }}%</td>
                            <td>{{ product.clientCount }}</td>
                            <td>{{ product.repeatClientCount }}</td>
                            <td>{{ product.lastSoldAt || '-' }}</td>
                            <td><span class="badge warning" *ngIf="product.costSignal === 'missing_cost'">Missing cost</span><span class="badge" *ngIf="product.costSignal !== 'missing_cost'">OK</span></td>
                          </tr>
                          <tr *ngIf="!(row.productBreakdown || []).length"><td colspan="10">No product detail found for this staff/filter.</td></tr>
                        </tbody>
                      </table>
                    </div>
                  </td>
                </tr>
                </ng-container>
                <tr *ngIf="!productStaffRows().length"><td colspan="9">No product sales found for selected filters.</td></tr>
              </tbody>
            </table>
          </div>
        </section>

        <section class="panel" *ngIf="activeTab() === 'commission'">
          <div class="section-title inner-action-bar">
            <div>
              <h2>Staff payout preview</h2>
            </div>
            <button class="ghost-button mini" type="button" (click)="exportPayoutPdf()">Payout PDF</button>
          </div>
          <div class="table-wrap scroll-wrap">
            <table>
              <thead><tr><th>Staff</th><th>Service sales</th><th>Product sales</th><th>Membership/package</th><th>Tips</th><th>Estimated commission</th><th>Pending due</th><th>Score</th></tr></thead>
              <tbody>
                <tr *ngFor="let row of data.staff || []">
                  <td><strong>{{ row.staffName }}</strong><small>{{ row.staffCode || row.staffId }}</small></td>
                  <td>{{ row.serviceRevenue | auraMoney:'1.0-0' }}</td>
                  <td>{{ row.productRevenue | auraMoney:'1.0-0' }}</td>
                  <td>{{ membershipPackageRevenue({ totals: row }) | auraMoney:'1.0-0' }}</td>
                  <td>{{ row.tips | auraMoney:'1.0-0' }}</td>
                  <td>{{ row.estimatedCommission | auraMoney:'1.0-0' }}</td>
                  <td>{{ row.pendingDue | auraMoney:'1.0-0' }}</td>
                  <td><span class="score-pill" [class.good]="row.performanceScore >= 75" [class.warn]="row.performanceScore < 45">{{ row.performanceScore || 0 }}</span></td>
                </tr>
                <tr *ngIf="!(data.staff || []).length"><td colspan="8">No commission rows found.</td></tr>
              </tbody>
            </table>
          </div>
        </section>

        <section class="panel" *ngIf="activeTab() === 'leaderboard' && leaderboardView() === 'items'">
          <div class="section-title inner-action-bar">
            <div>
              <h2>Staff by item</h2>
            </div>
            <div class="section-actions">
              <button class="ghost-button mini" type="button" (click)="setLeaderboardView('summary')">Back to summary</button>
            </div>
          </div>
          <div class="report-info-strip">
            <strong>Staff by item view</strong>
            <span>Zenoti-style line audit: staff, client-facing item, quantity, share, amount and source in one focused table.</span>
          </div>
          <div class="table-wrap scroll-wrap">
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Staff</th>
                  <th>Category</th>
                  <th>Item</th>
                  <th>Qty</th>
                  <th>Share</th>
                  <th>Amount</th>
                  <th>Source</th>
                </tr>
              </thead>
              <tbody>
                <tr *ngFor="let item of data.items || []">
                  <td>{{ item.date | auraDate:'date' }}</td>
                  <td>{{ item.staffName }}</td>
                  <td>{{ item.itemTypeLabel }}</td>
                  <td>{{ item.itemName }}</td>
                  <td>{{ item.quantity }}</td>
                  <td>{{ item.sharePercent || 100 }}%</td>
                  <td>{{ item.amount | auraMoney:'1.0-0' }}</td>
                  <td>
                    <span class="badge" [class.warning]="item.sourceStaffId !== 'line_item'">
                      {{ sourceLabel(item.sourceStaffId) }}
                    </span>
                  </td>
                </tr>
                <tr *ngIf="!(data.items || []).length">
                  <td colspan="8">No line items found for selected filters.</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
      </ng-container>
    </section>
  `,
  styles: [`
    :host {
      display: block;
      max-width: 100%;
      min-width: 0;
      overflow-x: hidden;
    }
    .page-stack,
    .panel,
    .filter-panel,
    .metrics-grid,
    .report-tabs {
      max-width: 100%;
      min-width: 0;
    }
    .hero-actions {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
      justify-content: flex-end;
    }
    .section-title {
      align-items: center;
      display: flex;
      gap: 12px;
      justify-content: space-between;
    }
    .section-actions {
      align-items: center;
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      justify-content: flex-end;
    }
    .view-hint {
      color: var(--muted);
      font-size: 12px;
      font-weight: 800;
    }
    .report-info-strip {
      align-items: center;
      background: #f8fafc;
      border: 1px solid var(--border);
      border-radius: 8px;
      display: flex;
      gap: 12px;
      justify-content: space-between;
      margin: 0 0 12px;
      padding: 10px 12px;
    }
    .report-info-strip strong {
      color: var(--ink);
      white-space: nowrap;
    }
    .report-info-strip span {
      color: var(--muted);
      font-size: 13px;
      text-align: right;
    }
    .filter-panel {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 12px;
      align-items: end;
    }
    .filter-panel .primary-button {
      min-height: 50px;
    }
    .table-wrap {
      max-width: 100%;
      min-width: 0;
      width: 100%;
      overscroll-behavior-x: contain;
    }
    .scroll-wrap {
      overflow-x: auto;
    }
    .fit-wrap {
      overflow-x: hidden;
    }
    .table-wrap table {
      width: 100%;
    }
    .table-wrap th,
    .table-wrap td {
      font-size: 13px;
      line-height: 1.25;
      padding: 8px 10px;
      vertical-align: middle;
    }
    .leaderboard-table {
      table-layout: fixed;
    }
    .leaderboard-table th,
    .leaderboard-table td {
      overflow-wrap: anywhere;
      word-break: normal;
    }
    .leaderboard-table th:nth-child(1),
    .leaderboard-table td:nth-child(1),
    .leaderboard-table th:nth-child(10),
    .leaderboard-table td:nth-child(10),
    .leaderboard-table th:nth-child(11),
    .leaderboard-table td:nth-child(11),
    .leaderboard-table th:nth-child(15),
    .leaderboard-table td:nth-child(15),
    .leaderboard-table th:nth-child(17),
    .leaderboard-table td:nth-child(17),
    .leaderboard-table th:nth-child(18),
    .leaderboard-table td:nth-child(18) {
      width: 5.2%;
    }
    .leaderboard-table th:nth-child(2),
    .leaderboard-table td:nth-child(2) {
      width: 9%;
    }
    .leaderboard-table th:nth-child(3),
    .leaderboard-table td:nth-child(3),
    .leaderboard-table th:nth-child(4),
    .leaderboard-table td:nth-child(4),
    .leaderboard-table th:nth-child(7),
    .leaderboard-table td:nth-child(7) {
      width: 7.4%;
    }
    .leaderboard-table th:nth-child(5),
    .leaderboard-table td:nth-child(5),
    .leaderboard-table th:nth-child(6),
    .leaderboard-table td:nth-child(6),
    .leaderboard-table th:nth-child(8),
    .leaderboard-table td:nth-child(8),
    .leaderboard-table th:nth-child(9),
    .leaderboard-table td:nth-child(9),
    .leaderboard-table th:nth-child(12),
    .leaderboard-table td:nth-child(12),
    .leaderboard-table th:nth-child(13),
    .leaderboard-table td:nth-child(13),
    .leaderboard-table th:nth-child(14),
    .leaderboard-table td:nth-child(14),
    .leaderboard-table th:nth-child(16),
    .leaderboard-table td:nth-child(16) {
      width: 5.9%;
    }
    .scroll-wrap table {
      min-width: 1180px;
      width: max-content;
    }
    .scroll-wrap .services-table {
      min-width: 1320px;
    }
    .report-tabs {
      background: #fff;
      border: 1px solid var(--border);
      border-radius: 8px;
      display: grid;
      gap: 8px;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      padding: 8px;
    }
    .report-tabs button {
      background: #f8fafc;
      border: 1px solid transparent;
      border-radius: 6px;
      color: var(--muted);
      cursor: pointer;
      font-weight: 800;
      min-height: 38px;
      padding: 8px 10px;
    }
    .report-tabs button.active {
      background: #F3EAF0;
      border-color: rgba(200, 125, 75, .35);
      color: #7A4A28;
      box-shadow: inset 0 -3px 0 #4B1238;
    }
    td strong,
    td small {
      display: block;
    }
    td small {
      color: var(--muted);
      font-size: 12px;
      margin-top: 3px;
    }
    .mini {
      min-height: 34px;
      padding: 7px 10px;
      white-space: nowrap;
    }
    .expanded-row > td {
      background: #f8fafc;
      padding: 12px;
    }
    .detail-grid {
      display: grid;
      gap: 14px;
      grid-template-columns: minmax(0, 1.4fr) minmax(360px, .8fr);
    }
    .detail-grid section {
      background: #fff;
      border: 1px solid var(--border);
      border-radius: 8px;
      overflow: auto;
      padding: 10px;
    }
    .detail-grid table {
      min-width: 780px;
    }
    .service-drilldown {
      background: #fff;
      border: 1px solid var(--border);
      border-radius: 8px;
      overflow: auto;
      padding: 10px;
    }
    .service-drilldown table {
      min-width: 1480px;
    }
    .products-table {
      min-width: 1120px;
    }
    .product-drilldown {
      background: #fff;
      border: 1px solid var(--border);
      border-radius: 8px;
      overflow: auto;
      padding: 10px;
    }
    .product-drilldown table {
      min-width: 1060px;
    }
    .row-actions {
      display: flex;
      gap: 8px;
      min-width: 132px;
    }
    .mini-title {
      align-items: center;
      display: flex;
      justify-content: space-between;
      margin-bottom: 10px;
    }
    .mini-title span {
      color: var(--muted);
      font-size: 12px;
      font-weight: 800;
      letter-spacing: .02em;
      text-transform: uppercase;
    }
    .score-pill {
      background: #fff7ed;
      border-radius: 999px;
      color: #9a3412;
      display: inline-flex;
      font-weight: 800;
      justify-content: center;
      min-width: 42px;
      padding: 6px 10px;
    }
    .score-pill.good {
      background: #FBF0E8;
      color: #7A4A28;
    }
    .score-pill.warn {
      background: #fee2e2;
      color: #991b1b;
    }
    .metric-card {
      background: #fff;
      border: 1px solid var(--border);
      border-radius: 8px;
      border-top: 4px solid var(--primary);
      box-shadow: var(--shadow-sm);
      padding: 12px 14px;
    }
    .metric-card span,
    .metric-card small {
      color: var(--muted);
      display: block;
    }
    .metric-card strong {
      display: block;
      font-size: 24px;
      margin: 6px 0 3px;
    }
    .badge.warning {
      background: #fff7ed;
      color: #9a3412;
    }
    @media (max-width: 900px) {
      .filter-panel {
        grid-template-columns: 1fr;
      }
      .hero-actions {
        justify-content: flex-start;
      }
      .detail-grid {
        grid-template-columns: 1fr;
      }
      .report-tabs {
        grid-template-columns: 1fr;
      }
    }
  `]
})
export class StaffSalesReportComponent implements OnInit {
  readonly report = signal<ApiRecord | null>(null);
  readonly branches = signal<ApiRecord[]>([]);
  readonly loading = signal(false);
  readonly error = signal('');
  readonly expandedStaff = signal('');
  readonly activeTab = signal<'leaderboard' | 'services' | 'products' | 'commission'>('leaderboard');
  readonly leaderboardView = signal<'summary' | 'items'>('summary');
  readonly staffOptions = computed(() => {
    const map = new Map<string, string>();
    for (const row of (this.report()?.staff || []) as ApiRecord[]) {
      const id = String(row['staffId'] || row['staffName'] || '');
      if (id) map.set(id, String(row['staffName'] || id));
    }
    for (const item of (this.report()?.items || []) as ApiRecord[]) {
      const id = String(item['staffId'] || item['staffName'] || '');
      if (id) map.set(id, String(item['staffName'] || id));
    }
    return [...map.entries()].map(([id, label]) => ({ id, label })).sort((a, b) => a.label.localeCompare(b.label));
  });
  readonly branchLabel = computed(() => {
    const branchId = this.api.selectedBranchId();
    if (!branchId) return 'Header branch not selected';
    return this.branches().find((branch) => branch.id === branchId)?.name || branchId;
  });
  readonly productStaffRows = computed(() => ((this.report()?.staff || []) as ApiRecord[]).filter((row) => {
    const productBreakdown = Array.isArray(row['productBreakdown']) ? row['productBreakdown'] as ApiRecord[] : [];
    return Number(row['productRevenue'] || 0) > 0 || Number(row['productCount'] || 0) > 0 || productBreakdown.length > 0;
  }));
  readonly productStats = computed(() => {
    const rows = this.productStaffRows();
    return rows.reduce((acc, row) => {
      const productBreakdown = Array.isArray(row['productBreakdown']) ? row['productBreakdown'] as ApiRecord[] : [];
      acc.productRevenue += Number(row['productRevenue'] || 0);
      acc.productCount += Number(row['productCount'] || 0);
      acc.skuCount += productBreakdown.length;
      acc.missingCostCount += this.hasMissingCost(productBreakdown) ? 1 : 0;
      acc.estimatedCommission += this.productCommission(row);
      return acc;
    }, {
      productRevenue: 0,
      productCount: 0,
      staffCount: rows.length,
      skuCount: 0,
      missingCostCount: 0,
      estimatedCommission: 0
    });
  });

  from = '';
  to = '';
  staffId = '';
  saleType = '';
  serviceSaleType = '';
  discountMode: 'with_discount' | 'without_discount' | 'compare' = 'with_discount';
  dueStatus = '';
  service = '';
  product = '';
  category = '';
  commissionStatus = '';
  performanceBucket = '';
  query = '';
  private initialized = false;

  constructor(
    private readonly api: ApiService,
    private readonly route: ActivatedRoute,
    private readonly router: Router,
    private readonly state: AppStateService,
    private readonly session: AuthSessionService
  ) {
    effect(() => {
      this.api.selectedBranchId();
      if (this.initialized) this.load();
    });
  }

  canAccessPath(path: string): boolean {
    const permission = routePermissionForPath(path);
    if (!permission || (Array.isArray(permission) && !permission.length)) return true;
    const permissions = Array.isArray(permission) ? permission : [permission];
    const dynamicGrants = this.session.currentUser()?.permissions || [];
    const grants = Array.from(new Set([...staticGrantsForRole(this.state.userRole()), ...dynamicGrants]));
    return permissions.some((item) => grantsAllow(grants, item));
  }

  ngOnInit(): void {
    this.initialized = true;
    this.applyReportTabFromQuery();
    this.loadBranches();
    this.load();
  }

  setActiveTab(tab: 'leaderboard' | 'services' | 'products' | 'commission'): void {
    this.activeTab.set(tab);
    if (tab === 'leaderboard') this.leaderboardView.set('summary');
    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { report: this.reportParamForTab(tab) },
      queryParamsHandling: 'merge',
      replaceUrl: true
    });
  }

  setLeaderboardView(view: 'summary' | 'items'): void {
    this.activeTab.set('leaderboard');
    this.leaderboardView.set(view);
    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { report: view === 'items' ? 'staff-by-item' : 'staff-leaderboard' },
      queryParamsHandling: 'merge',
      replaceUrl: true
    });
  }

  load(): void {
    this.loading.set(true);
    this.error.set('');
    const branchId = this.api.selectedBranchId();
    this.api.report<ApiRecord>('staff-sales', {
      branchId,
      from: this.from,
      to: this.to,
      staffId: this.staffId,
      saleType: this.saleType,
      serviceSaleType: this.serviceSaleType,
      discountMode: this.discountMode,
      dueStatus: this.dueStatus,
      service: this.service,
      product: this.product,
      category: this.category,
      commissionStatus: this.commissionStatus,
      performanceBucket: this.performanceBucket,
      q: this.query
    }).subscribe({
      next: (report) => {
        this.report.set(report);
        this.loading.set(false);
      },
      error: (error) => {
        this.error.set(error?.error?.error || 'Unable to load staff sales report');
        this.loading.set(false);
      }
    });
  }

  membershipPackageRevenue(report: ApiRecord): number {
    const totals = report.totals || {};
    return Number(totals.membershipRevenue || 0) + Number(totals.packageRevenue || 0);
  }

  toggleStaff(row: ApiRecord): void {
    const id = String(row['staffId'] || row['staffName'] || '');
    this.expandedStaff.set(this.expandedStaff() === id ? '' : id);
  }

  isExpanded(row: ApiRecord): boolean {
    return this.expandedStaff() === String(row['staffId'] || row['staffName'] || '');
  }

  staffProfileParams(row: ApiRecord): ApiRecord {
    const staffId = String(row['staffId'] || '');
    if (staffId && !staffId.startsWith('name:')) return { staffId, q: row['staffName'] || '' };
    return { q: row['staffName'] || '' };
  }

  discountModeLabel(): string {
    if (this.discountMode === 'without_discount') return 'Without Discount';
    if (this.discountMode === 'compare') return 'Compare Both';
    return 'With Discount';
  }

  serviceAmountFor(row: ApiRecord): number {
    if (this.discountMode === 'without_discount') return Number(row['staffServiceShareBeforeDiscount'] || row['grossServiceSale'] || row['serviceRevenue'] || 0);
    return Number(row['staffServiceShareAfterDiscount'] || row['finalServiceSale'] || row['serviceRevenue'] || 0);
  }

  exportCsv(): void {
    if (this.activeTab() === 'services') {
      this.exportServiceRowsCsv();
      return;
    }
    const rows = (this.report()?.staff || []) as ApiRecord[];
    const headers = ['Staff', 'Staff ID', 'Contact', 'Service sales', 'Product sales', 'Membership/package', 'Gift cards', 'Total sales', 'Clients', 'Invoices', 'Average bill', 'Pending due', 'Discount', 'Tips', 'Estimated commission', 'Performance score'];
    const csvRows = rows.map((row) => [
      row['staffName'],
      row['staffCode'] || row['staffId'],
      row['contact'],
      row['serviceRevenue'],
      row['productRevenue'],
      Number(row['membershipRevenue'] || 0) + Number(row['packageRevenue'] || 0),
      row['giftCardRevenue'],
      row['totalRevenue'],
      row['clientsCount'],
      row['invoiceCount'],
      row['averageBill'],
      row['pendingDue'],
      row['discountGiven'],
      row['tips'],
      row['estimatedCommission'],
      row['performanceScore']
    ].map((value) => this.csvCell(value)).join(','));
    this.downloadFile(`staff-sales-${Date.now()}.csv`, [headers.map((value) => this.csvCell(value)).join(','), ...csvRows].join('\n'), 'text/csv;charset=utf-8');
  }

  exportServiceRowsCsv(): void {
    const rows = (this.report()?.serviceSaleRows || []) as ApiRecord[];
    const headers = ['Discount mode', 'Staff', 'Staff ID', 'Service group', 'Service name', 'Qty', 'Gross price', 'Discount', 'Discount %', 'Final price', 'Share before discount', 'Share after discount', 'Invoice number', 'Invoice date', 'Appointment date', 'Created date', 'Customer name', 'Customer contact', 'Branch', 'Sale type', 'Staff share %', 'Payment mode', 'Transaction ID', 'GST', 'Due amount'];
    const csvRows = rows.map((row) => [
      this.discountModeLabel(),
      row['staffName'],
      row['staffId'],
      row['serviceGroup'],
      row['serviceName'],
      row['qty'],
      row['grossPrice'],
      row['discountAmount'],
      row['discountPercent'],
      row['finalPrice'],
      row['serviceShareBeforeDiscount'],
      row['serviceShareAfterDiscount'],
      row['invoiceNumber'],
      row['invoiceDate'],
      row['appointmentDate'],
      row['createdDate'],
      row['customerName'],
      row['customerContact'],
      row['branchName'] || row['branchId'],
      row['saleType'],
      row['staffSharePercent'],
      row['paymentMode'],
      row['transactionId'],
      row['gst'],
      row['dueAmount']
    ].map((value) => this.csvCell(value)).join(','));
    this.downloadFile(`services-by-staff-${Date.now()}.csv`, [headers.map((value) => this.csvCell(value)).join(','), ...csvRows].join('\n'), 'text/csv;charset=utf-8');
  }

  exportProductRowsCsv(): void {
    const headers = ['Staff', 'Staff ID', 'Contact', 'Product', 'Qty', 'Net sale', 'COGS', 'Gross margin', 'Margin %', 'Clients', 'Repeat clients', 'Last sold', 'Cost signal', 'Estimated commission'];
    const csvRows = this.productStaffRows().flatMap((row) => {
      const productBreakdown = Array.isArray(row['productBreakdown']) ? row['productBreakdown'] as ApiRecord[] : [];
      if (!productBreakdown.length) {
        return [[
          row['staffName'],
          row['staffCode'] || row['staffId'],
          row['contact'],
          '-',
          row['productCount'],
          row['productRevenue'],
          0,
          0,
          0,
          0,
          0,
          '-',
          'missing_detail',
          this.productCommission(row)
        ].map((value) => this.csvCell(value)).join(',')];
      }
      return productBreakdown.map((product) => [
        row['staffName'],
        row['staffCode'] || row['staffId'],
        row['contact'],
        product['productName'],
        product['quantity'],
        product['netSale'],
        product['cogs'],
        product['grossMargin'],
        product['marginPercent'],
        product['clientCount'],
        product['repeatClientCount'],
        product['lastSoldAt'],
        product['costSignal'],
        this.productCommission(row)
      ].map((value) => this.csvCell(value)).join(','));
    });
    this.downloadFile(`products-by-staff-${Date.now()}.csv`, [headers.map((value) => this.csvCell(value)).join(','), ...csvRows].join('\n'), 'text/csv;charset=utf-8');
  }

  exportOwnerPdf(): void {
    const report = this.report();
    const totals = report?.totals || {};
    const topStaff = ((report?.staff || []) as ApiRecord[]).slice(0, 8).map((row, index) => `${index + 1}. ${row['staffName']} | Sales ${this.money(row['totalRevenue'])} | Due ${this.money(row['pendingDue'])} | Score ${row['performanceScore']}`).join('\n');
    this.downloadFile(`staff-sales-owner-${Date.now()}.pdf`, this.simplePdf([
      'Staff Sales Owner Summary',
      `Generated: ${new Date().toLocaleString('en-IN')}`,
      `Total sales: ${this.money(totals['totalRevenue'])}`,
      `Service sales: ${this.money(totals['serviceRevenue'])}`,
      `Product sales: ${this.money(totals['productRevenue'])}`,
      `Pending due: ${this.money(totals['pendingDue'])}`,
      `Discount given: ${this.money(totals['discountGiven'])}`,
      `Estimated commission: ${this.money(totals['estimatedCommission'])}`,
      '',
      topStaff || 'No staff rows'
    ]), 'application/pdf');
  }

  exportPayoutPdf(): void {
    const rows = ((this.report()?.staff || []) as ApiRecord[]).map((row) => `${row['staffName']} | Commission ${this.money(row['estimatedCommission'])} | Tips ${this.money(row['tips'])} | Service ${this.money(row['serviceRevenue'])} | Product ${this.money(row['productRevenue'])}`);
    this.downloadFile(`staff-payout-${Date.now()}.pdf`, this.simplePdf([
      'Staff Payout / Commission Summary',
      `Generated: ${new Date().toLocaleString('en-IN')}`,
      '',
      ...rows
    ]), 'application/pdf');
  }

  sourceLabel(source: unknown): string {
    if (source === 'split_attribution') return 'Split staff';
    if (source === 'line_item') return 'Item staff';
    return 'Invoice fallback';
  }

  hasMissingCost(rows: unknown): boolean {
    return Array.isArray(rows) && rows.some((row) => (row as ApiRecord)['costSignal'] === 'missing_cost');
  }

  productCommission(row: ApiRecord): number {
    return Number(row['productRevenue'] || 0) * 0.05;
  }

  private loadBranches(): void {
    this.api.list<ApiRecord[]>('branches', { limit: 1000 }).subscribe({
      next: (branches) => this.branches.set(branches || []),
      error: () => this.branches.set([])
    });
  }

  private applyReportTabFromQuery(): void {
    const report = String(this.route.snapshot.queryParamMap.get('report') || '').toLowerCase();
    this.leaderboardView.set('summary');
    if (report === 'staff-by-item' || report === 'staff-items') {
      this.activeTab.set('leaderboard');
      this.leaderboardView.set('items');
    } else if (report === 'services' || report === 'services-by-staff') this.activeTab.set('services');
    else if (report === 'products' || report === 'products-by-staff') this.activeTab.set('products');
    else if (report === 'commission' || report === 'commission-payout') this.activeTab.set('commission');
    else this.activeTab.set('leaderboard');
  }

  private reportParamForTab(tab: 'leaderboard' | 'services' | 'products' | 'commission'): string {
    if (tab === 'services') return 'services-by-staff';
    if (tab === 'products') return 'products-by-staff';
    if (tab === 'commission') return 'commission-payout';
    return 'staff-leaderboard';
  }

  private money(value: unknown): string {
    return Number(value || 0).toLocaleString('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });
  }

  private csvCell(value: unknown): string {
    const text = String(value ?? '').replace(/"/g, '""');
    return `"${text}"`;
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
    for (const offset of offsets.slice(1)) pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
    pdf += `trailer << /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
    return new Blob([pdf], { type: 'application/pdf' });
  }
}
