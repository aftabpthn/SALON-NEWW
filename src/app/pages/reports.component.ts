import { CommonModule } from '@angular/common';
import { Component, OnInit, computed, effect, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ApiRecord, ApiService } from '../core/api.service';
import { StateComponent } from '../shared/ui/state/state.component';
import { AuraMoneyPipe } from '../shared/pipes/aura-money.pipe';
import { AuraDatePipe } from '../shared/pipes/aura-date.pipe';

type ReportViewKey = 'overview' | 'revenue' | 'bookings' | 'staff' | 'inventory' | 'reports' | 'insights' | 'drilldowns';
@Component({
  selector: 'app-reports',
  standalone: true,
  imports: [AuraDatePipe, AuraMoneyPipe, CommonModule, FormsModule, RouterLink, StateComponent],
  template: `
    <div class="page inner-page-shell">
      <!-- ═══════ STICKY HEADER ═══════ -->
      <header class="page-head inner-page-header">
        <div class="page-head-l">
          <span class="eye">Reports & analytics</span>
          <h1>Enterprise report command center</h1>
        </div>
        <div class="page-head-r">
          <div class="ph-branch">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
            <span>{{ branchLabel() }}</span>
          </div>
          <div class="ph-date">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
            <span>{{ from }} – {{ to }}</span>
          </div>
          <div class="ph-actions inner-action-bar">
            <button class="ac-btn" title="Export" (click)="load()">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
            </button>
            <button class="ac-btn" title="Schedule report" (click)="createDefaultSchedule()">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><polyline points="9 17 12 20 16 16"/></svg>
            </button>
            <button class="ac-btn" title="Refresh" (click)="load()">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
            </button>
            <button class="ac-btn ac-btn-primary" (click)="runAnomalyDetection()">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
              Scan
            </button>
          </div>
        </div>
      </header>

      <!-- ═══════ FILTER BAR ═══════ -->
      <div class="page-filters">
        <div class="pf-group">
          <label>From</label>
          <input type="date" [(ngModel)]="from" />
        </div>
        <div class="pf-group">
          <label>To</label>
          <input type="date" [(ngModel)]="to" />
        </div>
        <div class="pf-group pf-branch">
          <label>Branch</label>
          <div class="pf-badge">{{ branchLabel() }}</div>
        </div>
        <button class="pf-apply" (click)="load()">Apply</button>
        <div class="pf-chips">
          <a class="pf-chip" routerLink="/analytics">Analytics</a>
          <a class="pf-chip" routerLink="/reports/invoices">Invoices</a>
          <a class="pf-chip" routerLink="/reports/inward-revenue">Revenue</a>
          <a class="pf-chip" routerLink="/appointment-activity">Activity</a>
          <a class="pf-chip" routerLink="/inventory/reports">Inventory</a>
          <button class="pf-chip" (click)="createDefaultSchedule()">Schedule</button>
        </div>
      </div>

      <app-state [loading]="loading()" [error]="error()"></app-state>

      <div class="report-workspace">
        <aside class="report-side-nav" aria-label="Report pages">
          <button
            *ngFor="let view of reportViews"
            class="report-nav-card"
            type="button"
            [class.active]="activeReportView() === view.key"
            (click)="setReportView(view.key)"
          >
            <span class="report-nav-icon">{{ view.icon }}</span>
            <span>
              <strong>{{ view.label }}</strong>
              <small>{{ view.description }}</small>
            </span>
            <i>{{ view.badge }}</i>
          </button>
        </aside>

        <main class="report-detail">

      <!-- ═══════════════════════════════════════════════════════ -->
      <!--  SECTION: EXECUTIVE KPI DASHBOARD                      -->
      <!-- ═══════════════════════════════════════════════════════ -->
      <section id="overview" class="sec" *ngIf="visibleReportView('overview')">
        <!-- Analytics KPIs -->
        <ng-container *ngIf="analyticsCommand() as a">
          <div class="kpi-grid inner-stats-grid">
            <div class="kpi-card" (click)="navigate('/kpi-details/analytics/14-day-forecast')">
              <span class="kpi-top"><span class="kpi-icon" style="background:#ede8e3"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg></span><span class="kpi-trend up">+{{ a.summary.trendPercent || 0 }}%</span></span>
              <strong class="kpi-val">{{ a.summary.projectedRevenue | auraMoney:'1.0-0' }}</strong>
              <span class="kpi-label">AI Forecast</span>
            </div>
            <div class="kpi-card" (click)="navigate('/kpi-details/analytics/high-churn-risk')">
              <span class="kpi-top"><span class="kpi-icon" style="background:#ede8e3"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg></span><span class="kpi-trend down">{{ a.summary.highChurnRisk }} at risk</span></span>
              <strong class="kpi-val">{{ a.summary.repeatRate }}%</strong>
              <span class="kpi-label">Repeat Rate</span>
            </div>
            <div class="kpi-card" (click)="navigate('/kpi-details/analytics/anomalies')">
              <span class="kpi-top"><span class="kpi-icon" style="background:#ede8e3"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg></span><span class="kpi-trend down">{{ a.anomalyDetection.critical }} critical</span></span>
              <strong class="kpi-val">{{ a.anomalyDetection.open }}</strong>
              <span class="kpi-label">Open Anomalies</span>
            </div>
            <div class="kpi-card" (click)="navigate('/analytics')">
              <span class="kpi-top"><span class="kpi-icon" style="background:#ede8e3"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><polyline points="9 17 12 20 16 16"/></svg></span><span class="kpi-trend" style="color:var(--muted)">{{ a.exportControls.allowed ? 'Active' : 'Blocked' }}</span></span>
              <strong class="kpi-val">{{ a.scheduledReports.length }}</strong>
              <span class="kpi-label">Scheduled Reports</span>
            </div>
          </div>
        </ng-container>

        <!-- Report KPIs -->
        <ng-container *ngIf="report() as r">
          <div class="kpi-grid inner-stats-grid">
            <div class="kpi-card" (click)="navigate('/kpi-details/reports/sales-revenue')">
              <span class="kpi-top"><span class="kpi-icon" style="background:#ede8e3"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg></span><span class="kpi-trend up">{{ r.sales.count }} sales</span></span>
              <strong class="kpi-val">{{ r.sales.revenue | auraMoney:'1.0-0' }}</strong>
              <span class="kpi-label">Total Revenue</span>
            </div>
            <div class="kpi-card" (click)="navigate('/kpi-details/reports/gst-collected')">
              <span class="kpi-top"><span class="kpi-icon" style="background:#ede8e3"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="M8 6v12M16 6v12M6 10h4M6 14h4M14 10h4M14 14h4"/></svg></span><span class="kpi-trend up">{{ r.gst.invoices }} invoices</span></span>
              <strong class="kpi-val">{{ r.gst.collected | auraMoney:'1.0-0' }}</strong>
              <span class="kpi-label">GST Collected</span>
            </div>
            <div class="kpi-card" (click)="navigate('/kpi-details/reports/bookings')">
              <span class="kpi-top"><span class="kpi-icon" style="background:#ede8e3"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg></span><span class="kpi-trend up">{{ r.bookings.completed }} completed</span></span>
              <strong class="kpi-val">{{ r.bookings.total }}</strong>
              <span class="kpi-label">Total Bookings</span>
            </div>
            <div class="kpi-card" (click)="navigate('/kpi-details/reports/low-stock-count')">
              <span class="kpi-top"><span class="kpi-icon" style="background:#ede8e3"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/></svg></span><span class="kpi-trend down">{{ r.inventory.lowStock }} low</span></span>
              <strong class="kpi-val">{{ r.inventory.stockValue | auraMoney:'1.0-0' }}</strong>
              <span class="kpi-label">Stock Value</span>
            </div>
          </div>
        </ng-container>
      </section>

      <!-- ═══════════════════════════════════════════════════════ -->
      <!--  SECTION: EXECUTIVE ANALYTICS (2-col)                  -->
      <!-- ═══════════════════════════════════════════════════════ -->
      <ng-container *ngIf="visibleReportView('revenue')">
      @defer (on viewport) {
      <section id="revenue" class="sec">
        <div class="sec-h inner-action-bar">
          <h2>Executive analytics</h2>
          <span class="sec-badge">Revenue overview</span>
        </div>
        <ng-container *ngIf="report() as r">
          <div class="ea-grid">
            <div class="ea-main">
              <div class="ea-chart-card">
                <div class="ea-chart-h">
                  <span>Revenue trend</span>
                  <span class="ea-chart-val">₹{{ (r.sales.revenue + r.gst.collected) | number:'1.0-0' }}</span>
                </div>
                <div class="ea-sparkline">
                  <div class="ea-bar" style="height:20%"></div>
                  <div class="ea-bar" style="height:35%"></div>
                  <div class="ea-bar" style="height:28%"></div>
                  <div class="ea-bar" style="height:45%"></div>
                  <div class="ea-bar" style="height:40%"></div>
                  <div class="ea-bar" style="height:60%"></div>
                  <div class="ea-bar" style="height:55%"></div>
                  <div class="ea-bar" style="height:75%"></div>
                  <div class="ea-bar" style="height:70%"></div>
                  <div class="ea-bar" style="height:90%"></div>
                  <div class="ea-bar" style="height:85%"></div>
                  <div class="ea-bar is-peak" style="height:100%"></div>
                </div>
                <div class="ea-chart-footer">
                  <span>Last 12 periods</span>
                  <span class="ea-chart-up">+{{ r.sales.count }} transactions</span>
                </div>
              </div>
            </div>
            <div class="ea-side">
              <div class="ea-side-card">
                <span class="ea-side-label">Sales revenue</span>
                <strong>{{ r.sales.revenue | auraMoney:'1.0-0' }}</strong>
              </div>
              <div class="ea-side-card">
                <span class="ea-side-label">GST collected</span>
                <strong>{{ r.gst.collected | auraMoney:'1.0-0' }}</strong>
              </div>
              <div class="ea-side-card">
                <span class="ea-side-label">Inventory value</span>
                <strong>{{ r.inventory.stockValue | auraMoney:'1.0-0' }}</strong>
              </div>
              <div class="ea-side-card ea-side-card-accent">
                <span class="ea-side-label">Gross profit</span>
                <strong>{{ r.profitLoss.grossProfit | auraMoney:'1.0-0' }}</strong>
              </div>
            </div>
          </div>
        </ng-container>
      </section>
      } @placeholder {
        <section id="revenue" class="sec defer-shell" aria-label="Revenue overview loading">
          <div class="defer-skeleton defer-skeleton-head"></div>
          <div class="defer-skeleton defer-skeleton-chart"></div>
        </section>
      }
      </ng-container>

      <!-- ═══════════════════════════════════════════════════════ -->
      <!--  SECTION: FINANCIAL + BOOKING + CLIENT DASHBOARD        -->
      <!-- ═══════════════════════════════════════════════════════ -->
      <ng-container *ngIf="visibleReportView('bookings')">
      @defer (on viewport) {
      <section id="bookings" class="sec">
        <div class="sec-h inner-action-bar">
          <h2>Business snapshots</h2>
          <span class="sec-badge">Daily closing · P&L · Bookings · Clients</span>
        </div>
        <ng-container *ngIf="report() as r">
          <div class="snap-grid">
            <!-- Daily Closing -->
            <div class="snap-card">
              <div class="snap-h">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>
                <span>Daily closing</span>
              </div>
              <div class="snap-body">
                <div class="snap-row"><span>Cash</span><strong>₹{{ r.dailyClosing.cash | number:'1.0-0' }}</strong><span class="stg stg-green">On hand</span></div>
                <div class="snap-row"><span>UPI</span><strong>₹{{ r.dailyClosing.upi | number:'1.0-0' }}</strong><span class="stg stg-blue">Digital</span></div>
                <div class="snap-row"><span>Card</span><strong>₹{{ r.dailyClosing.card | number:'1.0-0' }}</strong><span class="stg stg-purple">Swipe</span></div>
                <div class="snap-row"><span>Other</span><strong>₹{{ (r.dailyClosing.other || 0) | number:'1.0-0' }}</strong><span class="stg stg-amber">Misc</span></div>
              </div>
            </div>
            <!-- P&L -->
            <div class="snap-card">
              <div class="snap-h">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="M8 6v12M16 6v12M6 10h4M6 14h4M14 10h4M14 14h4"/></svg>
                <span>Profit & loss</span>
              </div>
              <div class="snap-body">
                <div class="snap-row"><span>Revenue</span><strong>₹{{ r.profitLoss.revenue | number:'1.0-0' }}</strong><span class="stg stg-green">Top line</span></div>
                <div class="snap-row"><span>Inventory cost</span><strong>₹{{ r.profitLoss.estimatedInventoryCost | number:'1.0-0' }}</strong><span class="stg stg-amber">COGS</span></div>
                <div class="snap-row snap-total"><span>Gross profit</span><strong>₹{{ r.profitLoss.grossProfit | number:'1.0-0' }}</strong><span class="stg stg-green">{{ r.profitLoss.revenue > 0 ? ((r.profitLoss.grossProfit / r.profitLoss.revenue * 100) | number:'1.0-0') + '%' : '-' }}</span></div>
              </div>
            </div>
            <!-- Booking status -->
            <div class="snap-card">
              <div class="snap-h">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
                <span>Booking status</span>
              </div>
              <div class="snap-body snap-stats">
                <div class="snap-stat"><span class="dot" style="background:#4B1238"></span><strong>{{ r.bookings.booked || 0 }}</strong></div>
                <div class="snap-stat"><span class="dot" style="background:#C87D4B"></span><strong>{{ r.bookings.completed || 0 }}</strong></div>
                <div class="snap-stat"><span class="dot" style="background:#d97706"></span><strong>{{ r.bookings.noShow || 0 }}</strong></div>
                <div class="snap-stat"><span class="dot" style="background:#ef4444"></span><strong>{{ r.bookings.cancelled || 0 }}</strong></div>
              </div>
            </div>
            <!-- Client pulse -->
            <div class="snap-card">
              <div class="snap-h">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
                <span>Client & membership</span>
              </div>
              <div class="snap-body">
                <div class="snap-row"><span>Total clients</span><strong>{{ r.clients?.total || 0 }}</strong><span class="stg stg-blue">All time</span></div>
                <div class="snap-row"><span>New in range</span><strong>{{ r.clients?.newInPeriod || 0 }}</strong><span class="stg stg-green">Acquired</span></div>
                <div class="snap-row"><span>Repeat rate</span><strong>{{ r.retention.repeatCustomerRate }}%</strong><span class="stg stg-purple">Loyalty</span></div>
                <div class="snap-row"><span>Active memberships</span><strong>{{ r.memberships.active }}</strong><span class="stg stg-amber">Subscribed</span></div>
              </div>
            </div>
          </div>
        </ng-container>
      </section>
      } @placeholder {
        <section id="bookings" class="sec defer-shell" aria-label="Business snapshots loading">
          <div class="defer-skeleton defer-skeleton-head"></div>
          <div class="defer-skeleton defer-skeleton-grid"></div>
        </section>
      }
      </ng-container>

      <!-- ═══════════════════════════════════════════════════════ -->
      <!--  SECTION: STAFF DASHBOARD                              -->
      <!-- ═══════════════════════════════════════════════════════ -->
      <ng-container *ngIf="visibleReportView('staff')">
      @defer (on viewport) {
      <section id="staff" class="sec">
        <ng-container *ngIf="report() as r">
          <div class="sec-h inner-action-bar">
            <h2>Staff performance</h2>
            <a class="sec-link" routerLink="/reports/staff-sales">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
              Full staff sales
            </a>
          </div>
          <div class="tbl-wrap">
            <table class="tbl">
              <thead><tr><th>Staff</th><th>Role</th><th>Revenue</th><th>Bookings</th><th>Completion</th><th>Commission</th></tr></thead>
              <tbody>
                <tr *ngFor="let p of topStaff(); let i = index; trackBy: trackStaffPerformance">
                  <td><div class="staff-cell"><span class="staff-rank">{{ i + 1 }}</span><strong>{{ p.name }}</strong></div></td>
                  <td><span class="role-badge">{{ p.role }}</span></td>
                  <td><strong>₹{{ p.revenue | number:'1.0-0' }}</strong></td>
                  <td>{{ p.bookings }}</td>
                  <td><span class="compl-badge" [class.high]="p.rating >= 80" [class.mid]="p.rating >= 60 && p.rating < 80" [class.low]="p.rating < 60">{{ p.rating }}%</span></td>
                  <td>₹{{ (p.commission || 0) | number:'1.0-0' }}</td>
                </tr>
                <tr *ngIf="!topStaff().length">
                  <td colspan="6" class="empty-row">No staff performance data found for selected filters.</td>
                </tr>
              </tbody>
            </table>
          </div>
        </ng-container>
      </section>
      } @placeholder {
        <section id="staff" class="sec defer-shell" aria-label="Staff performance loading">
          <div class="defer-skeleton defer-skeleton-head"></div>
          <div class="defer-skeleton defer-skeleton-table"></div>
        </section>
      }
      </ng-container>

      <!-- ═══════════════════════════════════════════════════════ -->
      <!--  SECTION: INVENTORY + AI INSIGHTS                       -->
      <!-- ═══════════════════════════════════════════════════════ -->
      <ng-container *ngIf="visibleReportView('inventory')">
      @defer (on viewport) {
      <section id="inventory" class="sec">
        <ng-container *ngIf="report() as r">
          <div class="sec-h inner-action-bar">
            <h2>Inventory overview</h2>
            <a class="sec-link" routerLink="/inventory/reports">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/></svg>
              Inventory reports
            </a>
          </div>
          <div class="inv-grid">
              <div class="inv-card">
                <span class="inv-label">Stock value</span>
                <strong>{{ r.inventory.stockValue | auraMoney:'1.0-0' }}</strong>
              </div>
              <div class="inv-card inv-card-warn">
                <span class="inv-label">Low stock alerts</span>
                <strong>{{ r.inventory.lowStock }}</strong>
              </div>
          </div>
        </ng-container>
      </section>
      } @placeholder {
        <section id="inventory" class="sec defer-shell" aria-label="Inventory overview loading">
          <div class="defer-skeleton defer-skeleton-head"></div>
          <div class="defer-skeleton defer-skeleton-grid"></div>
        </section>
      }
      </ng-container>

      <!-- ═══════════════════════════════════════════════════════ -->
      <!--  SECTION: REPORT LIBRARY (tiles) + CONNECTED REPORTS    -->
      <!-- ═══════════════════════════════════════════════════════ -->
      <ng-container *ngIf="visibleReportView('reports')">
      @defer (on viewport) {
      <section id="reports" class="sec">
        <div class="sec-h inner-action-bar">
          <h2>Report library</h2>
          <span class="sec-badge">{{ quickLinks().length }} reports</span>
        </div>
        <ng-container *ngIf="report() as r">
          <div class="lib-grid">
            <div class="lib-card" *ngFor="let link of quickLinks(); trackBy: trackQuickLink" (click)="navigate(link.path)">
              <span class="lib-card-icon" [style.background]="libColor(link.module)">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round"><rect x="2" y="3" width="20" height="18" rx="2"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="9" y1="12" x2="15" y2="12"/><line x1="9" y1="16" x2="13" y2="16"/></svg>
              </span>
              <span class="lib-card-body">
                <span class="lib-module">{{ link.module }}</span>
                <strong>{{ link.label }}</strong>
              </span>
              <span class="lib-arrow">→</span>
            </div>
          </div>
        </ng-container>

        <!-- Connected reports -->
        <ng-container *ngIf="analyticsCommand() as a">
          <div class="sec-h inner-action-bar" style="margin-top:24px">
            <h3>KPI detail mapping</h3>
            <span class="sec-badge">{{ a.kpiDetailMap?.length || 0 }} drill-downs</span>
          </div>
          <div class="lib-grid">
            <div class="lib-card" *ngFor="let item of a.kpiDetailMap; trackBy: trackKpiMap" (click)="navigate(item.route)">
              <span class="lib-card-icon" style="background:#ede8e3">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>
              </span>
              <span class="lib-card-body">
                <span class="lib-module">{{ item.module }} · {{ item.source }}</span>
                <strong>{{ item.title }}</strong>
              </span>
              <span class="lib-arrow">→</span>
            </div>
          </div>
        </ng-container>
      </section>
      } @placeholder {
        <section id="reports" class="sec defer-shell" aria-label="Report library loading">
          <div class="defer-skeleton defer-skeleton-head"></div>
          <div class="defer-skeleton defer-skeleton-grid"></div>
        </section>
      }
      </ng-container>

      <!-- ═══════════════════════════════════════════════════════ -->
      <!--  SECTION: AI INSIGHTS + SCHEDULED REPORTS (2-col)       -->
      <!-- ═══════════════════════════════════════════════════════ -->
      <ng-container *ngIf="visibleReportView('insights')">
      @defer (on viewport) {
      <section id="insights" class="sec">
        <ng-container *ngIf="analyticsCommand() as a">
          <div class="sec-h inner-action-bar"><h2>AI Insights & schedules</h2></div>
          <div class="is-grid">
            <!-- Insights -->
            <div class="is-card">
              <div class="is-card-h">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg>
                <span>AI recommendations</span>
              </div>
              <div class="is-ins" *ngIf="a.aiInsights?.length">
                <div class="is-ins-item" *ngFor="let ins of a.aiInsights; trackBy: trackInsight">
                  <span class="is-dot" [class]="sevClass(ins.severity)"></span>
                  <div>
                    <strong>{{ ins.title }}</strong>
                    <span>{{ ins.recommendation }}</span>
                  </div>
                </div>
              </div>
              <div class="is-empty" *ngIf="!a.aiInsights?.length">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg>
                <span>No AI insights available</span>
              </div>
            </div>

            <!-- Scheduled reports -->
            <div class="is-card">
              <div class="is-card-h">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><polyline points="9 17 12 20 16 16"/></svg>
                <span>Scheduled reports</span>
                <button class="is-add" (click)="createDefaultSchedule()">+ New</button>
              </div>
              <div class="tbl-wrap" *ngIf="a.scheduledReports?.length">
                <table class="tbl tbl-compact">
                  <thead><tr><th>Name</th><th>Frequency</th><th>Next run</th><th>Status</th><th></th></tr></thead>
                  <tbody>
                    <ng-container *ngFor="let s of a.scheduledReports; trackBy: trackSchedule">
                      <tr class="sch-row" [class.sch-row-open]="expandedSchedule() === s.id" (click)="toggleSchedule(s.id)">
                        <td><strong>{{ s.name }}</strong></td>
                        <td>{{ s.cadence }}</td>
                        <td>{{ s.nextRunAt | auraDate:'date' }}</td>
                        <td><span class="sch-badge" [class]="s.status?.toLowerCase()">{{ s.status }}</span></td>
                        <td class="sch-toggle">{{ expandedSchedule() === s.id ? '−' : '+' }}</td>
                      </tr>
                      <tr *ngIf="expandedSchedule() === s.id" class="sch-detail">
                        <td colspan="5">
                          <div class="sch-detail-body">
                            <div class="sch-detail-item">
                              <span>Reports</span>
                              <span>{{ (s.reportKeys || []).join(', ') || '—' }}</span>
                            </div>
                            <div class="sch-detail-item">
                              <span>Recipients</span>
                              <span>{{ (s.recipients || []).join(', ') || '—' }}</span>
                            </div>
                            <div class="sch-detail-item">
                              <span>Last run</span>
                              <span>{{ (s.lastRunAt | auraDate:'date') || '—' }}</span>
                            </div>
                            <div class="sch-detail-item">
                              <span>Created</span>
                              <span>{{ (s.createdAt | auraDate:'date') || '—' }}</span>
                            </div>
                          </div>
                        </td>
                      </tr>
                    </ng-container>
                  </tbody>
                </table>
              </div>
              <div class="is-empty" *ngIf="!a.scheduledReports?.length">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><polyline points="9 17 12 20 16 16"/></svg>
                <span>No schedules — create a weekly digest</span>
              </div>
            </div>
          </div>
        </ng-container>
      </section>
      } @placeholder {
        <section id="insights" class="sec defer-shell" aria-label="AI insights loading">
          <div class="defer-skeleton defer-skeleton-head"></div>
          <div class="defer-skeleton defer-skeleton-table"></div>
        </section>
      }
      </ng-container>

      <!-- ═══════════════════════════════════════════════════════ -->
      <!--  SECTION: DRILLDOWNS TABLE                            -->
      <!-- ═══════════════════════════════════════════════════════ -->
      <ng-container *ngIf="visibleReportView('drilldowns')">
      @defer (on viewport) {
      <section id="drilldowns" class="sec">
        <ng-container *ngIf="analyticsCommand() as a">
          <div class="sec-h inner-action-bar"><h2>Report drilldowns</h2><span class="sec-badge">{{ a.drilldowns?.length || 0 }} reports</span></div>
          <div class="tbl-wrap">
            <table class="tbl">
              <thead><tr><th>Report</th><th>Rows</th><th>Source</th><th></th></tr></thead>
              <tbody>
                <tr *ngFor="let d of a.drilldowns; trackBy: trackDrilldown">
                  <td><strong>{{ d.title }}</strong></td>
                  <td><span class="count-badge">{{ d.rows }}</span></td>
                  <td><span class="src-label">{{ d.source }}</span></td>
                  <td class="td-r"><a class="ac-link" [routerLink]="d.route">Open →</a></td>
                </tr>
              </tbody>
            </table>
          </div>
        </ng-container>
      </section>
      } @placeholder {
        <section id="drilldowns" class="sec defer-shell" aria-label="Report drilldowns loading">
          <div class="defer-skeleton defer-skeleton-head"></div>
          <div class="defer-skeleton defer-skeleton-table"></div>
        </section>
      }
      </ng-container>
        </main>
      </div>

      <!-- ═══════ FOOTER ACTIONS ═══════ -->
      <div class="page-footer">
        <div class="pf-left">
          <span>Reports command center · {{ branchLabel() }}</span>
        </div>
        <div class="pf-right">
          <button class="ac-btn" (click)="load()">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
            Export
          </button>
          <button class="ac-btn" (click)="createDefaultSchedule()">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><polyline points="9 17 12 20 16 16"/></svg>
            Schedule
          </button>
          <button class="ac-btn" (click)="runAnomalyDetection()">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
            Scan
          </button>
          <a class="ac-link" href="#overview">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/></svg>
            Back to top
          </a>
        </div>
      </div>
    </div>
  `,
  styles: [`
    .page { display: flex; flex-direction: column; gap: 16px; padding: 6px 2px 24px; background: var(--color-surface-muted); min-height: 100vh; }
    a { text-decoration: none; color: inherit; }
    button { font-family: inherit; cursor: pointer; }

    /* ─── HEADER (glass) ─── */
    .page-head {
      display: flex; align-items: flex-start; justify-content: space-between; gap: 16px;
      padding: 22px 26px; border-radius: 16px; border: 1px solid rgba(79,70,229,0.08);
      background: rgba(255,255,255,0.85); backdrop-filter: blur(14px) saturate(1.08);
      box-shadow: 0 1px 4px rgba(15,23,42,0.04), 0 8px 24px rgba(15,23,42,0.04);
      position: sticky; top: 0; z-index: 20;
    }
    .eye { font-size: 0.72rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; color: var(--muted); }
    .page-head h1 { font-size: 1.45rem; font-weight: 800; margin: 4px 0 8px; letter-spacing: -0.03em; }
    .page-head p { margin: 0; color: var(--muted); font-size: 0.84rem; max-width: 540px; line-height: 1.45; }
    .page-head-l { position: relative; }
    .page-head-l::before {
      content: ''; position: absolute; top: -2px; left: 0; width: 42px; height: 4px;
      border-radius: 4px; background: linear-gradient(90deg, var(--color-primary), #818cf8, rgba(75,18,56,0.15));
    }
    .page-head-r { display: flex; align-items: center; gap: 10px; flex-shrink: 0; flex-wrap: wrap; }
    .ph-branch, .ph-date {
      display: flex; align-items: center; gap: 5px; padding: 6px 12px; border-radius: 8px;
      border: 1px solid var(--line); font-size: 0.79rem; font-weight: 600; white-space: nowrap;
      background: var(--surface); box-shadow: 0 1px 2px rgba(0,0,0,0.02);
      transition: border-color 140ms ease, box-shadow 140ms ease;
    }
    .ph-branch:hover, .ph-date:hover { border-color: var(--color-primary); box-shadow: 0 0 0 3px rgba(75,18,56,0.08); }
    .ph-branch svg, .ph-date svg { color: var(--color-primary); flex-shrink: 0; }
    .ph-actions { display: flex; gap: 5px; }

    .ac-btn {
      display: inline-flex; align-items: center; gap: 5px; padding: 7px 12px; border-radius: 9px;
      border: 1px solid var(--line); background: var(--surface); color: var(--ink);
      font-size: 0.79rem; font-weight: 600; white-space: nowrap;
      transition: all 140ms cubic-bezier(0.16,1,0.3,1);
    }
    .ac-btn:hover { border-color: var(--color-primary); color: var(--color-primary); background: var(--color-primary-soft); transform: translateY(-1px); }
    .ac-btn:active { transform: translateY(0); }
    .ac-btn-primary {
      border-color: transparent; background: linear-gradient(135deg, var(--color-primary), var(--color-primary-strong));
      color: #fff; box-shadow: 0 2px 8px rgba(79,70,229,0.2);
    }
    .ac-btn-primary:hover { box-shadow: 0 4px 16px rgba(79,70,229,0.35); transform: translateY(-1px); border-color: transparent; color: #fff; }
    .ac-link { color: var(--color-primary); font-weight: 600; font-size: 0.82rem; transition: opacity 130ms ease; }
    .ac-link:hover { opacity: 0.75; }

    /* ─── FILTERS (glass) ─── */
    .page-filters {
      display: flex; align-items: flex-end; gap: 10px; flex-wrap: wrap;
      padding: 13px 20px; border-radius: 14px; border: 1px solid rgba(79,70,229,0.06);
      background: rgba(255,255,255,0.92); backdrop-filter: blur(10px);
      box-shadow: 0 1px 3px rgba(15,23,42,0.04);
      position: sticky; top: 82px; z-index: 19;
    }
    .pf-group { display: flex; flex-direction: column; gap: 4px; }
    .pf-group label { font-size: 0.68rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: var(--muted); }
    .pf-group input {
      padding: 7px 11px; border: 1px solid var(--line); border-radius: 8px; font-size: 0.84rem;
      font-family: inherit; background: var(--surface); outline: none; min-width: 130px;
      transition: border-color 140ms ease, box-shadow 140ms ease;
    }
    .pf-group input:focus { border-color: var(--color-primary); box-shadow: 0 0 0 3px rgba(75,18,56,0.12); }
    .pf-badge {
      padding: 7px 13px; border-radius: 8px; border: 1px solid var(--line);
      background: var(--color-surface-muted); font-size: 0.82rem; font-weight: 600; white-space: nowrap;
    }
    .pf-apply {
      padding: 7px 18px; border-radius: 9px; border: none;
      background: linear-gradient(135deg, var(--color-primary), var(--color-primary-strong));
      color: #fff; font-size: 0.82rem; font-weight: 600; box-shadow: 0 2px 8px rgba(79,70,229,0.2);
      transition: all 140ms cubic-bezier(0.16,1,0.3,1);
    }
    .pf-apply:hover { box-shadow: 0 4px 16px rgba(79,70,229,0.35); transform: translateY(-1px); }
    .pf-apply:active { transform: translateY(0); }
    .pf-chips { display: flex; gap: 4px; margin-left: auto; flex-wrap: wrap; align-items: center; }
    .pf-chip {
      padding: 5px 11px; border-radius: 7px; font-size: 0.73rem; font-weight: 500;
      background: transparent; border: none; color: var(--muted); white-space: nowrap;
      transition: all 120ms ease;
    }
    .pf-chip:hover { background: var(--color-surface-muted); color: var(--ink); }

    /* ─── REPORT WORKSPACE ─── */
    .report-workspace { display: grid; grid-template-columns: 315px minmax(0, 1fr); gap: 12px; align-items: start; }
    .report-side-nav { position: sticky; top: 148px; display: grid; gap: 10px; align-self: start; }
    .report-detail { display: grid; gap: 12px; min-width: 0; }
    .report-nav-card {
      display: grid; grid-template-columns: 48px minmax(0, 1fr) auto; align-items: center; gap: 10px;
      width: 100%; min-height: 88px; padding: 14px; border: 1px solid var(--line); border-left: 3px solid var(--color-primary);
      border-radius: 12px; color: var(--ink); background: var(--surface); box-shadow: 0 4px 12px rgba(12,26,43,0.06);
      text-align: left; transition: transform 160ms ease, box-shadow 160ms ease, border-color 160ms ease, background 160ms ease;
    }
    .report-nav-card:hover { transform: translateY(-2px); border-color: rgba(79,70,229,0.28); box-shadow: 0 8px 22px rgba(12,26,43,0.1); }
    .report-nav-card.active { border-color: var(--color-primary); background: linear-gradient(90deg, rgba(75,18,56,0.16), rgba(75,18,56,0.12), rgba(236,72,153,0.12)); box-shadow: 0 8px 22px rgba(12,26,43,0.12); }
    .report-nav-card strong, .report-nav-card small, .report-nav-card i { display: block; }
    .report-nav-card strong { font-size: 0.95rem; line-height: 1.2; }
    .report-nav-card small { margin-top: 4px; color: var(--muted); font-size: 0.72rem; font-weight: 700; line-height: 1.25; }
    .report-nav-card i { padding: 3px 8px; border-radius: 999px; color: var(--color-primary-strong); background: var(--color-surface-muted); font-size: 0.68rem; font-style: normal; font-weight: 900; text-transform: uppercase; }
    .report-nav-icon { display: inline-grid; place-items: center; width: 48px; height: 48px; border-radius: 9px; color: var(--color-primary-strong); background: rgba(75,18,56,0.12); font-weight: 900; }

    /* ─── SECTION ─── */
    .sec { display: flex; flex-direction: column; gap: 16px; scroll-margin-top: 170px; padding: 24px 20px; border-radius: 16px; background: var(--surface); box-shadow: 0 1px 3px rgba(15,23,42,0.03); }
    .sec + .sec { margin-top: 18px; }
    .defer-shell { min-height: 178px; justify-content: center; }
    .defer-skeleton {
      border-radius: 12px;
      background: linear-gradient(90deg, rgba(148,163,184,0.14), rgba(148,163,184,0.08), rgba(148,163,184,0.14));
      background-size: 220% 100%;
      animation: reportSkeleton 1.25s ease-in-out infinite;
    }
    .defer-skeleton-head { width: min(320px, 60%); height: 24px; }
    .defer-skeleton-chart { min-height: 132px; }
    .defer-skeleton-grid { min-height: 132px; }
    .defer-skeleton-table { min-height: 156px; }
    @keyframes reportSkeleton {
      0% { background-position: 100% 0; }
      100% { background-position: -100% 0; }
    }
    .sec-h {
      display: flex; align-items: center; gap: 12px; flex-wrap: wrap; padding: 0 4px;
    }
    .sec-h { position: relative; }
    .sec-h h2, .sec-h h3 { font-size: 1.1rem; font-weight: 750; margin: 0; letter-spacing: -0.02em; }
    .sec-h h2::before, .sec-h h3::before {
      content: ''; display: inline-block; width: 3px; height: 14px; border-radius: 3px;
      background: var(--color-primary); margin-right: 10px; vertical-align: middle;
    }
    .sec-badge {
      padding: 4px 11px; border-radius: 7px; font-size: 0.7rem; font-weight: 600;
      background: var(--color-surface-muted); color: var(--muted);
    }
    .sec-link {
      display: inline-flex; align-items: center; gap: 5px; padding: 5px 13px; border-radius: 8px;
      font-size: 0.78rem; font-weight: 600; color: var(--color-primary); margin-left: auto;
      transition: background 120ms ease, transform 120ms ease;
    }
    .sec-link:hover { background: var(--color-primary-soft); transform: translateY(-1px); }

    /* ─── KPI GRID ─── */
    .kpi-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; }
    .kpi-card {
      display: flex; flex-direction: column; padding: 22px 24px 20px; border-radius: 16px; border: 1px solid var(--line);
      background: var(--surface); color: inherit; cursor: pointer;
      box-shadow: 0 1px 2px rgba(15,23,42,0.03), 0 1px 4px rgba(15,23,42,0.02);
      transition: all 200ms cubic-bezier(0.16,1,0.3,1);
    }
    .kpi-card:hover { transform: translateY(-3px); box-shadow: 0 8px 24px rgba(15,23,42,0.06); border-color: rgba(0,0,0,0.06); }
    .kpi-card:active { transform: translateY(-1px); }
    .kpi-top { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 14px; }
    .kpi-icon { width: 38px; height: 38px; border-radius: 11px; display: grid; place-items: center; flex-shrink: 0; box-shadow: 0 2px 8px rgba(0,0,0,0.06); }
    .kpi-trend { font-size: 0.7rem; font-weight: 700; padding: 3px 9px; border-radius: 6px; }
    .kpi-trend.up { background: rgba(5,150,105,0.1); color: #C87D4B; }
    .kpi-trend.down { background: rgba(220,38,38,0.08); color: #dc2626; }
    .kpi-val { display: block; font-size: 1.55rem; font-weight: 750; line-height: 1.15; letter-spacing: -0.03em; margin-bottom: 6px; }
    .kpi-label { display: block; font-size: 0.78rem; color: var(--muted); font-weight: 500; margin-top: auto; }
    /* ─── EXECUTIVE ANALYTICS (2-col) ─── */
    .ea-grid { display: grid; grid-template-columns: 1.6fr 1fr; gap: 16px; align-items: start; }
    .ea-chart-card {
      padding: 22px 24px; border-radius: 16px; border: 1px solid var(--line);
      background: linear-gradient(135deg, var(--surface), var(--color-surface-muted));
      box-shadow: 0 1px 2px rgba(15,23,42,0.03), 0 1px 4px rgba(15,23,42,0.02);
    }
    .ea-chart-h { display: flex; justify-content: space-between; align-items: center; margin-bottom: 18px; padding-bottom: 14px; border-bottom: 2px solid var(--color-surface-muted); }
    .ea-chart-h span { font-size: 0.8rem; font-weight: 600; color: var(--muted); text-transform: uppercase; letter-spacing: 0.04em; }
    .ea-chart-val { font-size: 1.35rem !important; font-weight: 750 !important; color: var(--ink) !important; letter-spacing: -0.02em; }
    .ea-sparkline { display: flex; align-items: flex-end; gap: 4px; height: 110px; margin-bottom: 14px; padding: 0 2px; }
    .ea-bar {
      flex: 1; border-radius: 4px 4px 0 0;
      background: linear-gradient(180deg, rgba(75,18,56,0.5), rgba(75,18,56,0.08));
      transition: all 300ms cubic-bezier(0.16,1,0.3,1); min-height: 4px;
      cursor: pointer;
    }
    .ea-bar:hover { background: linear-gradient(180deg, rgba(75,18,56,0.7), rgba(75,18,56,0.15)); transform: scaleY(1.02); transform-origin: bottom; }
    .ea-bar.is-peak { background: linear-gradient(180deg, rgba(79,70,229,0.7), rgba(79,70,229,0.15)); }
    .ea-chart-footer { display: flex; justify-content: space-between; font-size: 0.74rem; color: var(--muted); }
    .ea-chart-up { color: #C87D4B; font-weight: 600; }

    .ea-side { display: flex; flex-direction: column; gap: 12px; }
    .ea-side-card {
      position: relative; padding: 16px 18px 16px 20px; border-radius: 12px; border: 1px solid var(--line);
      background: var(--surface); box-shadow: 0 1px 3px rgba(15,23,42,0.03);
      transition: transform 160ms ease, box-shadow 160ms ease;
    }
    .ea-side-card::before {
      content: ''; position: absolute; left: 0; top: 8px; bottom: 8px; width: 3px;
      border-radius: 3px; background: var(--color-primary);
    }
    .ea-side-card:hover { transform: translateY(-2px); box-shadow: 0 6px 16px rgba(15,23,42,0.06); border-color: rgba(79,70,229,0.12); }
    .ea-side-card-accent {
      border-color: rgba(5,150,105,0.18);
    }
    .ea-side-card-accent::before { background: #C87D4B; }
    .ea-side-label { font-size: 0.75rem; color: var(--muted); font-weight: 600; display: block; text-transform: uppercase; letter-spacing: 0.04em; }
    .ea-side-card strong { font-size: 1.15rem; font-weight: 700; display: block; margin: 5px 0 4px; letter-spacing: -0.02em; }
    .ea-side-card-accent strong { color: #C87D4B; }

    /* ─── SNAPSHOT GRID (4-col) ─── */
    .snap-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; }
    .snap-card {
      padding: 18px 20px; border-radius: 14px; border: 1px solid var(--line);
      background: var(--surface);
      box-shadow: 0 1px 2px rgba(15,23,42,0.03), 0 1px 4px rgba(15,23,42,0.02);
      transition: all 180ms cubic-bezier(0.16,1,0.3,1);
    }
    .snap-card:hover { transform: translateY(-2px); box-shadow: 0 6px 20px rgba(15,23,42,0.06); border-color: rgba(0,0,0,0.05); }
    .snap-h { display: flex; align-items: center; gap: 8px; margin-bottom: 14px; padding-bottom: 12px; border-bottom: 2px solid var(--color-surface-muted); }
    .snap-h svg { color: var(--color-primary); width: 16px; }
    .snap-h span { font-size: 0.82rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.03em; color: var(--muted); }
    .snap-body { display: flex; flex-direction: column; gap: 2px; }
    .snap-row {
      display: flex; align-items: center; gap: 8px; padding: 7px 0;
      border-bottom: 1px solid var(--line); font-size: 0.82rem;
    }
    .snap-row:last-child { border-bottom: 0; }
    .snap-row span:first-child { width: 80px; color: var(--muted); flex-shrink: 0; font-weight: 500; }
    .snap-row strong { flex: 1; text-align: right; font-weight: 650; font-size: 0.88rem; }
    .snap-total { border-top: 2px solid var(--line); margin-top: 6px; padding-top: 10px; }
    .snap-total strong { color: #C87D4B; }
    .snap-stats { display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; margin-top: 2px; }
    .snap-stat { text-align: center; padding: 10px 4px; border-radius: 8px; background: var(--color-surface-muted); transition: transform 140ms ease; }
    .snap-stat:hover { transform: scale(1.03); }
    .snap-stat strong { display: block; font-size: 1.15rem; font-weight: 700; }
    .snap-stat small { font-size: 0.68rem; color: var(--muted); display: block; margin-top: 3px; font-weight: 600; }
    .dot { display: inline-block; width: 7px; height: 7px; border-radius: 50%; margin-bottom: 5px; }

    .stg { padding: 2px 8px; border-radius: 5px; font-size: 0.62rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; white-space: nowrap; border: 1px solid transparent; }
    .stg-green { background: rgba(5,150,105,0.06); color: #C87D4B; border-color: rgba(5,150,105,0.15); }
    .stg-blue { background: rgba(75,18,56,0.06); color: #4B1238; border-color: rgba(75,18,56,0.15); }
    .stg-purple { background: rgba(124,58,237,0.06); color: #7c3aed; border-color: rgba(124,58,237,0.15); }
    .stg-amber { background: rgba(217,119,6,0.06); color: #d97706; border-color: rgba(217,119,6,0.15); }

    /* ─── TABLE ─── */
    .tbl-wrap { overflow-x: auto; border-radius: 12px; border: 1px solid var(--line); background: var(--surface); box-shadow: 0 1px 2px rgba(15,23,42,0.03), 0 1px 4px rgba(15,23,42,0.02); }
    .tbl { width: 100%; border-collapse: separate; border-spacing: 0; min-width: 550px; }
    .tbl th {
      padding: 11px 15px; background: var(--color-surface-muted); font-size: 0.7rem;
      font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: var(--muted);
      text-align: left; border-bottom: 1px solid var(--line); white-space: nowrap;
    }
    .tbl th:first-child { border-radius: 12px 0 0 0; }
    .tbl th:last-child { border-radius: 0 12px 0 0; }
    .tbl td { padding: 12px 15px; border-bottom: 1px solid var(--line); font-size: 0.85rem; transition: background 120ms ease; }
    .tbl tbody tr:last-child td { border-bottom: 0; }
    .tbl tbody tr:nth-child(even) td { background: rgba(75,18,56,0.015); }
    .tbl tbody tr:hover td { background: rgba(75,18,56,0.04); }
    .tbl tbody tr:active td { background: rgba(75,18,56,0.08); }
    .tbl-compact td { padding: 9px 12px; font-size: 0.82rem; }
    .td-r { text-align: right; }
    .empty-row { text-align: center; color: var(--muted); padding: 28px !important; font-size: 0.85rem; }
    .count-badge { font-weight: 700; padding: 2px 9px; border-radius: 6px; background: var(--color-surface-muted); font-size: 0.82rem; }
    .src-label { font-size: 0.8rem; color: var(--muted); }

    /* ─── STAFF TABLE ─── */
    .staff-cell { display: flex; align-items: center; gap: 10px; }
    .staff-rank {
      width: 26px; height: 26px; border-radius: 7px; display: grid; place-items: center;
      font-size: 0.7rem; font-weight: 800; background: var(--color-surface-muted); color: var(--muted);
    }
    tbody tr:nth-child(1) .staff-rank { background: linear-gradient(135deg, rgba(245,158,11,0.2), rgba(245,158,11,0.08)); color: #d97706; }
    tbody tr:nth-child(2) .staff-rank { background: linear-gradient(135deg, rgba(148,163,184,0.25), rgba(148,163,184,0.08)); color: #64748b; }
    tbody tr:nth-child(3) .staff-rank { background: linear-gradient(135deg, rgba(180,83,9,0.15), rgba(180,83,9,0.05)); color: #92400e; }
    .role-badge { padding: 3px 9px; border-radius: 6px; font-size: 0.73rem; font-weight: 600; background: var(--color-surface-muted); color: var(--muted); white-space: nowrap; }
    .compl-badge { font-weight: 700; padding: 3px 9px; border-radius: 6px; }
    .compl-badge.high { color: #C87D4B; background: rgba(5,150,105,0.1); }
    .compl-badge.mid { color: #d97706; background: rgba(217,119,6,0.1); }
    .compl-badge.low { color: #dc2626; background: rgba(220,38,38,0.08); }

    .sch-badge { padding: 3px 9px; border-radius: 6px; font-size: 0.64rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; }
    .sch-badge.active { background: rgba(5,150,105,0.1); color: #C87D4B; }
    .sch-badge.paused { background: rgba(217,119,6,0.1); color: #d97706; }
    .sch-badge.error { background: rgba(220,38,38,0.08); color: #dc2626; }
    .sch-row { cursor: pointer; transition: background 120ms ease; }
    .sch-row:hover { background: var(--color-surface-muted); }
    .sch-row.sch-row-open { background: rgba(79,70,229,0.04); }
    .sch-toggle { text-align: center; font-size: 1.1rem; font-weight: 700; color: var(--muted); width: 32px; user-select: none; }
    .sch-detail td { padding: 0 12px 12px !important; background: rgba(79,70,229,0.03); border-bottom: 2px solid var(--color-primary); }
    .sch-detail-body { display: grid; grid-template-columns: 1fr 1fr; gap: 8px 16px; padding: 8px 0; }
    .sch-detail-item { display: flex; flex-direction: column; gap: 2px; }
    .sch-detail-item span:first-child { font-size: 0.7rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: var(--muted); }
    .sch-detail-item span:last-child { font-size: 0.84rem; color: var(--ink); word-break: break-all; }

    /* ─── INVENTORY ─── */
    .inv-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 14px; }
    .inv-card {
      padding: 18px 20px; border-radius: 14px; border: 1px solid var(--line);
      background: var(--surface); box-shadow: 0 1px 3px rgba(15,23,42,0.03);
      transition: transform 160ms ease, box-shadow 160ms ease;
    }
    .inv-card:hover { transform: translateY(-2px); box-shadow: 0 6px 16px rgba(15,23,42,0.06); }
    .inv-card-warn { border-color: rgba(217,119,6,0.18); }
    .inv-label { font-size: 0.74rem; color: var(--muted); font-weight: 600; display: block; text-transform: uppercase; letter-spacing: 0.04em; }
    .inv-card strong { font-size: 1.25rem; font-weight: 700; display: block; margin: 5px 0 4px; letter-spacing: -0.02em; }

    /* ─── REPORT LIBRARY ─── */
    .lib-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; }
    .lib-card {
      display: flex; align-items: center; gap: 12px; padding: 15px; border-radius: 12px;
      border: 1px solid var(--line); background: var(--surface); cursor: pointer;
      box-shadow: 0 1px 2px rgba(15,23,42,0.03), 0 1px 4px rgba(15,23,42,0.02);
      transition: all 180ms cubic-bezier(0.16,1,0.3,1);
    }
    .lib-card:hover { transform: translateY(-3px); border-color: rgba(79,70,229,0.15); box-shadow: 0 6px 20px rgba(15,23,42,0.06); }
    .lib-card:active { transform: translateY(-1px); }
    .lib-card-icon { width: 38px; height: 38px; border-radius: 11px; display: grid; place-items: center; flex-shrink: 0; box-shadow: 0 2px 8px rgba(0,0,0,0.06); }
    .lib-card-body { flex: 1; min-width: 0; }
    .lib-module { font-size: 0.64rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: var(--muted); display: block; }
    .lib-card-body strong { font-size: 0.86rem; font-weight: 650; display: block; margin-top: 2px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .lib-arrow { color: var(--muted); font-size: 1.1rem; opacity: 0; transition: opacity 160ms ease, transform 160ms ease; }
    .lib-card:hover .lib-arrow { opacity: 1; color: var(--color-primary); transform: translateX(3px); }

    /* ─── AI INSIGHTS + SCHEDULES ─── */
    .is-grid { display: grid; grid-template-columns: 1fr; gap: 16px; }
    .is-card {
      padding: 20px 22px; border-radius: 14px; border: 1px solid var(--line);
      background: var(--surface);
      box-shadow: 0 1px 2px rgba(15,23,42,0.03), 0 1px 4px rgba(15,23,42,0.02);
    }
    .is-card-h { display: flex; align-items: center; gap: 9px; margin-bottom: 16px; padding-bottom: 14px; border-bottom: 2px solid var(--color-surface-muted); }
    .is-card-h svg { color: var(--color-primary); width: 18px; }
    .is-card-h span { font-size: 0.92rem; font-weight: 650; flex: 1; }
    .is-card .tbl-wrap { max-height: 340px; overflow-y: auto; }
    .is-add {
      padding: 4px 12px; border-radius: 7px; border: 1px solid var(--line);
      background: transparent; font-size: 0.76rem; font-weight: 600; color: var(--color-primary);
      transition: all 120ms ease;
    }
    .is-add:hover { border-color: var(--color-primary); background: var(--color-primary-soft); }
    .is-ins { display: flex; flex-direction: column; gap: 8px; }
    .is-ins-item {
      display: flex; align-items: flex-start; gap: 11px; padding: 12px 14px 12px 16px;
      border-radius: 9px; border: 1px solid var(--line);
      border-left: 3px solid var(--line);
      transition: background 140ms ease, border-color 140ms ease;
    }
    .is-ins-item:hover { background: var(--color-surface-muted); border-color: rgba(79,70,229,0.1); border-left-color: var(--color-primary); }
    .is-ins-item:has(.is-dot.high) { border-left-color: #dc2626; }
    .is-ins-item:has(.is-dot.medium) { border-left-color: #d97706; }
    .is-ins-item:has(.is-dot.low) { border-left-color: #C87D4B; }
    .is-ins-item:has(.is-dot.info) { border-left-color: var(--color-primary); }
    .is-dot { width: 8px; height: 8px; border-radius: 50%; margin-top: 6px; flex-shrink: 0; box-shadow: 0 0 0 3px rgba(75,18,56,0.04); }
    .is-dot.high { background: #dc2626; }
    .is-dot.medium { background: #d97706; }
    .is-dot.low { background: #C87D4B; }
    .is-dot.info { background: var(--color-primary); }
    .is-ins-item strong { font-size: 0.84rem; font-weight: 600; display: block; }
    .is-ins-item span { font-size: 0.76rem; color: var(--muted); display: block; margin-top: 2px; line-height: 1.35; }
    .is-empty { display: flex; align-items: center; gap: 9px; padding: 20px 0; color: var(--muted); font-size: 0.82rem; }
    .is-empty svg { opacity: 0.25; flex-shrink: 0; }

    /* ─── FOOTER ─── */
    .page-footer {
      display: flex; align-items: center; justify-content: space-between; gap: 12px;
      padding: 16px 22px; border-radius: 14px; border: 1px solid var(--line);
      background: var(--surface); margin-top: 4px; flex-wrap: wrap;
      box-shadow: 0 1px 2px rgba(15,23,42,0.03), 0 1px 4px rgba(15,23,42,0.02);
    }
    .pf-left { font-size: 0.78rem; color: var(--muted); font-weight: 500; }
    .pf-right { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; }


    .page {
      gap: 16px;
      padding: 8px 4px 24px;
    }

    .page-head {
      padding: 18px 22px;
      border-color: rgba(117, 79, 71, 0.12);
      border-radius: 14px;
      background: linear-gradient(180deg, rgba(255, 255, 255, 0.96), rgba(255, 252, 250, 0.96));
      box-shadow: 0 10px 28px rgba(89, 64, 54, 0.06);
      backdrop-filter: blur(10px) saturate(1.02);
    }

    .page-head-l::before {
      width: 34px;
      height: 3px;
      background: #9a6a60;
    }

    .page-head h1 {
      font-size: clamp(1.24rem, 1.6vw, 1.72rem);
      font-weight: 690;
      letter-spacing: -0.025em;
    }

    .eye,
    .pf-group label,
    .sec-badge,
    .kpi-label,
    .snap-h span,
    .inv-label {
      font-weight: 620;
    }

    .page-head-r,
    .ph-actions {
      gap: 8px;
    }

    .ph-branch,
    .ph-date,
    .ac-btn,
    .pf-badge,
    .pf-chip,
    .pf-apply {
      border-radius: 8px;
      box-shadow: none;
    }

    .ac-btn,
    .pf-chip,
    .sec-link,
    .is-add {
      font-weight: 580;
    }

    .ac-btn:hover,
    .ph-branch:hover,
    .ph-date:hover,
    .pf-group input:focus,
    .is-add:hover {
      border-color: rgba(143, 92, 84, 0.26);
      box-shadow: 0 0 0 3px rgba(143, 92, 84, 0.08);
      transform: none;
    }

    .ac-btn-primary,
    .pf-apply {
      background: #7a4d47;
      box-shadow: 0 8px 18px rgba(122, 77, 71, 0.16);
    }

    .ac-btn-primary:hover,
    .pf-apply:hover {
      background: #6b443f;
      box-shadow: 0 10px 22px rgba(122, 77, 71, 0.2);
      transform: none;
    }

    .page-filters {
      top: 76px;
      padding: 12px 16px;
      border-color: rgba(117, 79, 71, 0.1);
      border-radius: 13px;
      background: rgba(255, 255, 255, 0.96);
      box-shadow: 0 8px 20px rgba(89, 64, 54, 0.045);
      backdrop-filter: blur(8px);
    }

    .pf-group input,
    .pf-badge {
      min-height: 36px;
      border-color: rgba(117, 79, 71, 0.13);
      background: #fff;
    }

    .pf-chip:hover {
      background: #fbf1ec;
      color: #6f4741;
    }

    .report-workspace {
      grid-template-columns: minmax(236px, 280px) minmax(0, 1fr);
      gap: 16px;
    }

    .report-side-nav {
      top: 142px;
      gap: 8px;
    }

    .report-nav-card {
      min-height: 76px;
      padding: 12px;
      border-color: rgba(117, 79, 71, 0.12);
      border-left-color: rgba(143, 92, 84, 0.56);
      border-radius: 12px;
      background: #fff;
      box-shadow: 0 6px 18px rgba(89, 64, 54, 0.035);
      transition: border-color 140ms ease, box-shadow 140ms ease, background 140ms ease;
    }

    .report-nav-card:hover {
      transform: none;
      border-color: rgba(143, 92, 84, 0.22);
      border-left-color: #8f5c54;
      box-shadow: 0 8px 22px rgba(89, 64, 54, 0.055);
    }

    .report-nav-card.active {
      border-color: rgba(143, 92, 84, 0.28);
      border-left-color: #7a4d47;
      background: linear-gradient(90deg, #faf8f6, #fff);
      box-shadow: 0 8px 22px rgba(89, 64, 54, 0.065);
    }

    .report-nav-card strong {
      font-size: 0.9rem;
      font-weight: 650;
    }

    .report-nav-card small {
      font-weight: 560;
    }

    .report-nav-card i {
      color: #7a4d47;
      background: #fbf1ec;
      font-weight: 680;
    }

    .report-nav-icon {
      width: 40px;
      height: 40px;
      border-radius: 10px;
      color: #7a4d47;
      background: #fbf1ec;
    }

    .sec {
      gap: 14px;
      padding: 20px;
      border: 1px solid rgba(117, 79, 71, 0.1);
      border-radius: 14px;
      background: #fff;
      box-shadow: 0 8px 24px rgba(89, 64, 54, 0.04);
    }

    .sec + .sec {
      margin-top: 14px;
    }

    .sec-h h2,
    .sec-h h3 {
      font-size: 1.02rem;
      font-weight: 680;
    }

    .sec-h h2::before,
    .sec-h h3::before {
      background: #8f5c54;
    }

    .kpi-grid,
    .snap-grid,
    .lib-grid {
      gap: 14px;
    }

    .kpi-card,
    .snap-card,
    .ea-chart-card,
    .ea-side-card,
    .inv-card,
    .lib-card,
    .is-card,
    .tbl-wrap,
    .page-footer {
      border-color: rgba(117, 79, 71, 0.12);
      border-radius: 13px;
      background: #fff;
      box-shadow: 0 6px 18px rgba(89, 64, 54, 0.035);
    }

    .kpi-card {
      padding: 18px 18px 16px;
      border-left: 3px solid rgba(143, 92, 84, 0.72);
    }

    .kpi-card:hover,
    .snap-card:hover,
    .ea-side-card:hover,
    .inv-card:hover,
    .lib-card:hover {
      transform: translateY(-1px);
      border-color: rgba(143, 92, 84, 0.22);
      box-shadow: 0 10px 24px rgba(89, 64, 54, 0.055);
    }

    .kpi-icon,
    .lib-card-icon {
      background: #fbf1ec !important;
      color: #7a4d47 !important;
      box-shadow: none;
    }

    .kpi-icon svg,
    .lib-card-icon svg {
      stroke: #7a4d47 !important;
    }

    .kpi-trend,
    .stg,
    .role-badge,
    .compl-badge,
    .sch-badge,
    .count-badge,
    .sec-badge {
      border-radius: 999px;
      font-weight: 620;
    }

    .kpi-val {
      color: #4c3935;
      font-size: 1.38rem;
      font-weight: 700;
    }

    .ea-chart-card {
      background: linear-gradient(180deg, #fff, #fffdfb);
    }

    .ea-chart-h,
    .snap-h,
    .is-card-h {
      border-bottom: 1px solid rgba(117, 79, 71, 0.1);
    }

    .ea-bar,
    .ea-bar.is-peak,
    .ea-bar:hover {
      background: linear-gradient(180deg, rgba(143, 92, 84, 0.56), rgba(143, 92, 84, 0.12));
      transform: none;
    }

    .ea-side-card::before {
      background: #8f5c54;
    }

    .snap-stat,
    .pf-badge,
    .count-badge,
    .role-badge,
    .staff-rank {
      background: #fff8f5;
    }

    .tbl-wrap {
      overflow: auto;
    }

    .tbl th {
      position: sticky;
      top: 0;
      z-index: 1;
      padding: 12px 15px;
      background: #fff8f5;
      color: #6b5a55;
      font-weight: 650;
    }

    .tbl td {
      padding: 13px 15px;
      border-bottom-color: rgba(117, 79, 71, 0.09);
      color: #332927;
      vertical-align: middle;
    }

    .tbl tbody tr:nth-child(even) td {
      background: transparent;
    }

    .tbl tbody tr:hover td,
    .tbl tbody tr:active td {
      background: #fffaf7;
    }

    .is-ins-item {
      border-color: rgba(117, 79, 71, 0.1);
      border-left-color: rgba(143, 92, 84, 0.42);
      border-radius: 10px;
      background: #fff;
    }

    .is-ins-item:hover {
      background: #fffaf7;
      border-color: rgba(143, 92, 84, 0.18);
      border-left-color: #8f5c54;
    }

    .page-head,
    .page-filters,
    .sec,
    .kpi-card,
    .snap-card,
    .ea-chart-card,
    .ea-side-card,
    .inv-card,
    .lib-card,
    .is-card,
    .tbl-wrap,
    .page-footer,
    .report-nav-card {
      background: #fff !important;
      background-image: none !important;
      border-color: rgba(118, 85, 76, 0.13) !important;
      box-shadow: 0 1px 2px rgba(41, 31, 28, 0.03), 0 10px 26px rgba(73, 51, 43, 0.045);
    }

    .page-head {
      position: sticky;
      top: 0;
      z-index: 24;
    }

    .page-filters {
      top: 78px;
      z-index: 23;
    }

    .report-nav-card.active {
      background: #fffaf7 !important;
      border-left-color: #9a6a60 !important;
    }

    .report-nav-card,
    .kpi-card,
    .snap-card,
    .lib-card,
    .is-ins-item {
      transition: border-color 140ms ease, box-shadow 140ms ease, transform 140ms ease;
    }

    .report-nav-card:hover,
    .kpi-card:hover,
    .snap-card:hover,
    .ea-side-card:hover,
    .inv-card:hover,
    .lib-card:hover {
      transform: translateY(-1px);
      box-shadow: 0 14px 30px rgba(73, 51, 43, 0.065);
    }

    .kpi-card,
    .snap-card,
    .ea-side-card,
    .inv-card {
      border-left: 3px solid rgba(154, 106, 96, 0.72) !important;
    }

    .kpi-icon,
    .lib-card-icon,
    .report-nav-icon,
    .snap-stat,
    .staff-rank,
    .role-badge,
    .count-badge,
    .sec-badge,
    .pf-badge {
      background: #faf8f6 !important;
      color: #75524b !important;
      box-shadow: none !important;
    }

    .kpi-icon svg,
    .lib-card-icon svg,
    .snap-h svg,
    .is-card-h svg,
    .ph-branch svg,
    .ph-date svg {
      color: #8a6259 !important;
      stroke: #8a6259 !important;
    }

    .page-head h1,
    .sec-h h2,
    .sec-h h3,
    .kpi-val,
    .ea-side-card strong,
    .inv-card strong,
    .snap-stat strong,
    .lib-card-body strong,
    .is-ins-item strong {
      color: #302522;
      font-weight: 630;
    }

    .eye,
    .pf-group label,
    .report-nav-card small,
    .kpi-label,
    .snap-h span,
    .ea-chart-h span,
    .inv-label,
    .tbl th {
      color: #766763;
      font-weight: 560;
    }

    .tbl th {
      background: #faf7f4 !important;
      border-bottom-color: rgba(118, 85, 76, 0.12);
    }

    .tbl td {
      border-bottom-color: rgba(118, 85, 76, 0.08);
      line-height: 1.45;
    }

    .tbl tbody tr:hover td,
    .tbl tbody tr:active td {
      background: #fffaf7;
    }

    .stg,
    .compl-badge,
    .sch-badge {
      background: #faf8f6 !important;
      border-color: rgba(154, 106, 96, 0.15) !important;
      color: #75524b !important;
    }

    .ea-chart-card {
      min-height: 230px;
    }

    .ea-bar,
    .ea-bar.is-peak,
    .ea-bar:hover {
      background: linear-gradient(180deg, rgba(154, 106, 96, 0.58), rgba(154, 106, 96, 0.12)) !important;
    }

    @media (max-width: 760px) {
      .page-head,
      .page-filters {
        position: static;
      }

      .page-head-r,
      .ph-actions,
      .pf-chips {
        width: 100%;
      }

      .ph-actions > *,
      .pf-chips > * {
        flex: 1 1 auto;
        justify-content: center;
      }
    }
    /* ─── RESPONSIVE ─── */
    @media (max-width: 1200px) {
      .kpi-grid { grid-template-columns: repeat(2, 1fr); }
      .snap-grid { grid-template-columns: repeat(2, 1fr); }
      .lib-grid { grid-template-columns: repeat(2, 1fr); }
      .report-workspace { grid-template-columns: 1fr; }
      .report-side-nav { position: static; grid-template-columns: repeat(2, minmax(0, 1fr)); }
    }
    @media (max-width: 900px) {
      .ea-grid { grid-template-columns: 1fr; }

      .inv-grid { grid-template-columns: 1fr; }
      .page-head { flex-direction: column; }
      .page-head-r { width: 100%; }
      .pf-chips { margin-left: 0; }
    }
    @media (max-width: 640px) {
      .kpi-grid { grid-template-columns: 1fr; }
      .snap-grid { grid-template-columns: 1fr; }
      .lib-grid { grid-template-columns: 1fr; }
      .page-tabs { overflow-x: auto; gap: 2px; }
      .tab { padding: 7px 14px; font-size: 0.78rem; }
      .page-filters { flex-direction: column; align-items: stretch; }
      .pf-group input { min-width: auto; width: 100%; }
      .report-side-nav { grid-template-columns: 1fr; }
      .report-nav-card { grid-template-columns: 44px minmax(0, 1fr) auto; min-height: 78px; }
      .report-nav-icon { width: 44px; height: 44px; }
    }
  `]
})
export class ReportsComponent implements OnInit {
  readonly report = signal<ApiRecord | null>(null);
  readonly analyticsCommand = signal<ApiRecord | null>(null);
  readonly branches = signal<ApiRecord[]>([]);
  readonly loading = signal(true);
  readonly error = signal('');
  readonly activeReportView = signal<ReportViewKey>('overview');

  readonly reportViews: Array<{ key: ReportViewKey; label: string; description: string; icon: string; badge: string }> = [
    { key: 'overview', label: 'Overview', description: 'Executive KPIs and summary', icon: 'OV', badge: 'Open' },
    { key: 'revenue', label: 'Revenue', description: 'Revenue trend and financial pulse', icon: 'RV', badge: 'Finance' },
    { key: 'bookings', label: 'Bookings & clients', description: 'Daily closing, bookings and CRM pulse', icon: 'BC', badge: 'Ops' },
    { key: 'staff', label: 'Staff performance', description: 'Top staff revenue and commissions', icon: 'ST', badge: 'Team' },
    { key: 'inventory', label: 'Inventory', description: 'Stock value and low-stock alerts', icon: 'IN', badge: 'Stock' },
    { key: 'reports', label: 'Report library', description: 'Connected report shortcuts', icon: 'RL', badge: 'Links' },
    { key: 'insights', label: 'AI & schedules', description: 'Recommendations and report digests', icon: 'AI', badge: 'Smart' },
    { key: 'drilldowns', label: 'Drilldowns', description: 'KPI detail report mapping', icon: 'DD', badge: 'Audit' }
  ];

  readonly topStaff = computed(() => ((this.report()?.['staff'] as ApiRecord[] | undefined) || []).slice(0, 8));
  readonly quickLinks = computed(() => {
    const links = (this.report()?.['quickLinks'] as ApiRecord[] | undefined) || [];
    return links.length ? links : this.defaultQuickLinks;
  });

  from = this.monthStart();
  to = this.today();
  branchId = '';
  private initialized = false;

  private readonly defaultQuickLinks: ApiRecord[] = [
    { label: 'Inward Revenue', path: '/reports/inward-revenue', module: 'FlexiSalon import' },
    { label: 'Invoice Reports', path: '/reports/invoices', module: 'Invoice intelligence' },
    { label: 'Staff Sales', path: '/reports/staff-sales', module: 'POS attribution' },
    { label: 'Commission Preview', path: '/reports/commission-preview', module: 'Payroll' },
    { label: 'Account Ledger', path: '/reports/account-ledger', module: 'Finance' },
    { label: 'Inventory Reports', path: '/inventory/reports', module: 'Inventory' },
    { label: 'Appointment Activity', path: '/appointment-activity', module: 'Bookings' },
    { label: 'Client CRM', path: '/clients', module: 'Clients' }
  ];

  readonly expandedSchedule = signal<string | null>(null);

  trackStaffPerformance(index: number, person: ApiRecord): string {
    return String(person?.['id'] || person?.['staffId'] || person?.['name'] || index);
  }

  trackQuickLink(index: number, link: ApiRecord): string {
    return String(link?.['path'] || link?.['label'] || index);
  }

  trackKpiMap(index: number, item: ApiRecord): string {
    return String(item?.['route'] || item?.['title'] || index);
  }

  trackInsight(index: number, insight: ApiRecord): string {
    return String(insight?.['id'] || insight?.['title'] || insight?.['recommendation'] || index);
  }

  trackSchedule(index: number, schedule: ApiRecord): string {
    return String(schedule?.['id'] || schedule?.['name'] || index);
  }

  trackDrilldown(index: number, drilldown: ApiRecord): string {
    return String(drilldown?.['route'] || drilldown?.['title'] || index);
  }
  toggleSchedule(id: string): void {
    this.expandedSchedule.set(this.expandedSchedule() === id ? null : id);
  }

  setReportView(view: ReportViewKey): void {
    this.activeReportView.set(view);
  }

  visibleReportView(view: ReportViewKey): boolean {
    const active = this.activeReportView();
    return active === 'overview' || active === view;
  }

  constructor(private readonly api: ApiService) {
    effect(() => {
      this.api.selectedBranchId();
      if (this.initialized) this.load();
    });
  }

  ngOnInit(): void {
    this.initialized = true;
    this.loadBranches();
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.error.set('');
    this.branchId = this.api.selectedBranchId();
    this.api.report<ApiRecord>('advanced', {
      branchId: this.branchId,
      from: this.from,
      to: this.to
    }).subscribe({
      next: (report) => {
        this.report.set(report);
        this.loading.set(false);
      },
      error: (error) => {
        this.error.set(error?.error?.error || 'Unable to load reports');
        this.loading.set(false);
      }
    });
    this.loadAnalyticsCommandCenter();
  }

  loadAnalyticsCommandCenter(): void {
    this.api.list<ApiRecord>('analytics/report-command-center', {
      branchId: this.branchId || this.api.selectedBranchId(),
      from: this.from,
      to: this.to
    }).subscribe({
      next: (result) => this.analyticsCommand.set(result),
      error: () => this.analyticsCommand.set(null)
    });
  }

  createDefaultSchedule(): void {
    this.api.post<ApiRecord>('analytics/report-schedules', {
      branchId: this.api.selectedBranchId(),
      name: 'Weekly owner report digest',
      cadence: 'weekly',
      reportKeys: ['reports:sales-revenue', 'analytics:14-day-forecast', 'analytics:high-churn-risk'],
      recipients: []
    }).subscribe({
      next: () => this.loadAnalyticsCommandCenter(),
      error: (error) => this.error.set(this.api.errorText(error))
    });
  }

  runAnomalyDetection(): void {
    this.api.post<ApiRecord>('analytics/anomalies/run', { branchId: this.api.selectedBranchId() }).subscribe({
      next: () => this.loadAnalyticsCommandCenter(),
      error: (error) => this.error.set(this.api.errorText(error))
    });
  }

  navigate(path: string): void {
    if (path?.startsWith('/')) {
      const el = document.createElement('a');
      el.href = path;
      el.click();
    }
  }

  sevClass(severity: string): string {
    const s = (severity || '').toLowerCase();
    if (s.includes('high') || s === 'critical') return 'high';
    if (s.includes('medium') || s === 'warn') return 'medium';
    if (s.includes('low') || s === 'info') return 'low';
    return 'info';
  }

  branchLabel(): string {
    const branchId = this.api.selectedBranchId();
    if (!branchId) return 'Header branch not selected';
    return this.branches().find((branch) => branch.id === branchId)?.name || branchId;
  }

  libColor(module: string): string {
    const colors: Record<string, string> = {
      'FlexiSalon import': 'linear-gradient(135deg,#4B1238,#6B1E4B)',
      'Invoice intelligence': 'linear-gradient(135deg,#4B1238,#6B1E4B)',
      'POS attribution': 'linear-gradient(135deg,#8b5cf6,#7c3aed)',
      'Payroll': 'linear-gradient(135deg,#f59e0b,#d97706)',
      'Finance': 'linear-gradient(135deg,#64748b,#475569)',
      'Inventory': 'linear-gradient(135deg,#ef4444,#dc2626)',
      'Bookings': 'linear-gradient(135deg,#06b6d4,#0891b2)',
      'Clients': 'linear-gradient(135deg,#ec4899,#db2777)'
    };
    return colors[module] || 'linear-gradient(135deg,#4B1238,#6B1E4B)';
  }

  private loadBranches(): void {
    this.api.list<ApiRecord[]>('branches', { limit: 1000 }).subscribe({
      next: (branches) => this.branches.set(branches || []),
      error: () => this.branches.set([])
    });
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
