import { CommonModule, CurrencyPipe } from '@angular/common';
import { Component, OnInit, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ApiRecord, ApiService } from '../core/api.service';
import { StateComponent } from '../shared/ui/state/state.component';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule, CurrencyPipe, RouterLink, StateComponent],
  template: `
    <section class="page-stack">
      <app-state [loading]="loading()" [error]="error()"></app-state>

      <div class="topbar dashboard-greeting" *ngIf="report()">
        <div class="dashboard-greeting-copy">
          <span class="dashboard-eyebrow">Today's command center</span>
          <h1>{{ greeting() }}</h1>
          <p>Track revenue, bookings, payments, clients, and alerts from one operational view.</p>
        </div>
        <div class="topbar-actions">
          <a class="ghost-button" routerLink="/reports">Export</a>
          <a class="primary-button" routerLink="/appointments">New Booking</a>
        </div>
      </div>

      <section class="panel dashboard-panel" *ngIf="report() as data">
        <div class="section-title compact-title">
          <div>
            <h2>Key Metrics</h2>
          </div>
          <span class="muted-text">{{ today() }}</span>
        </div>
        <div class="metrics-grid">
          <a class="metric-card teal" routerLink="/kpi-details/dashboard/revenue-today">
            <span class="metric-label">Revenue today</span>
            <strong class="metric-value">{{ data.revenueToday | currency: 'INR':'symbol':'1.0-0' }}</strong>
          </a>
          <a class="metric-card teal" routerLink="/kpi-details/dashboard/revenue-this-month">
            <span class="metric-label">Revenue this month</span>
            <strong class="metric-value">{{ data.revenueMonth | currency: 'INR':'symbol':'1.0-0' }}</strong>
          </a>
          <a class="metric-card teal" routerLink="/kpi-details/dashboard/total-bookings">
            <span class="metric-label">Total bookings</span>
            <strong class="metric-value">{{ data.totalBookings }}</strong>
          </a>
          <a class="metric-card teal" routerLink="/pos/invoices" [queryParams]="{ filter: 'received-due' }">
            <span class="metric-label">Received due</span>
            <strong class="metric-value" style="color:#059669">{{ data.receivedDue | currency: 'INR':'symbol':'1.0-0' }}</strong>
          </a>
          <a class="metric-card" style="border-top:3px solid #dc2626" routerLink="/kpi-details/dashboard/pending-payments">
            <span class="metric-label">Pending payments</span>
            <strong class="metric-value" style="color:#dc2626">{{ data.pendingPayments | currency: 'INR':'symbol':'1.0-0' }}</strong>
          </a>
          <a class="metric-card" style="border-top:3px solid #d97706" routerLink="/clients">
            <span class="metric-label">New clients</span>
            <strong class="metric-value" style="color:#d97706">{{ data.newClients }}</strong>
          </a>
          <a class="metric-card" style="border-top:3px solid #059669" routerLink="/customer-360">
            <span class="metric-label">Client retention</span>
            <strong class="metric-value" style="color:#059669">{{ data.clientRetention }}%</strong>
          </a>
        </div>
      </section>

      <section class="panel dashboard-command-panel" *ngIf="report() as data">
        <div class="section-title compact-title">
          <div>
            <h2>Open detailed pages from here</h2>
          </div>
          <div class="header-link-row">
            <a class="ghost-button" routerLink="/dashboard/executive">Executive dashboard</a>
            <a class="ghost-button" routerLink="/reports">All reports</a>
          </div>
        </div>
        <div class="dashboard-hub-grid">
          <a class="dashboard-hub-card" routerLink="/appointments">
            <span class="hub-icon">BK</span>
            <strong>{{ data.totalBookings }} bookings</strong>
            <b>Open calendar</b>
          </a>
          <a class="dashboard-hub-card" routerLink="/pos">
            <span class="hub-icon">POS</span>
            <strong>{{ data.receivedDue | currency: 'INR':'symbol':'1.0-0' }} received due</strong>
            <small>{{ data.pendingPayments | currency: 'INR':'symbol':'1.0-0' }} still pending</small>
            <b>Open POS</b>
          </a>
          <a class="dashboard-hub-card" routerLink="/inventory">
            <span class="hub-icon">ST</span>
            <strong>{{ data.lowStockAlerts.length || 0 }} alerts</strong>
            <small>{{ data.lowStockAlerts[0]?.name || 'Stock is healthy' }}</small>
            <b>Open stock</b>
          </a>
          <a class="dashboard-hub-card" routerLink="/staff-os/employee-masters">
            <span class="hub-icon">TM</span>
            <strong>{{ data.staffPerformance[0]?.name || 'No ranking yet' }}</strong>
            <small>{{ (data.staffPerformance[0]?.revenue || 0) | currency: 'INR':'symbol':'1.0-0' }} top revenue</small>
            <b>Open Staff OS</b>
          </a>
          <a class="dashboard-hub-card" routerLink="/customer-360">
            <span class="hub-icon">CL</span>
            <strong>{{ data.repeatCustomerRate }}% repeat</strong>
            <small>{{ data.newClients }} new clients this month</small>
            <b>Open customer intelligence</b>
          </a>
          <a class="dashboard-hub-card" routerLink="/smart-booking">
            <span class="hub-icon">WF</span>
            <strong>Workflow</strong>
            <b>Open workflow</b>
          </a>
          <a class="dashboard-hub-card" routerLink="/memberships">
            <span class="hub-icon">MB</span>
            <strong>{{ data.membershipRevenue | currency: 'INR':'symbol':'1.0-0' }}</strong>
            <b>Open memberships</b>
          </a>
        </div>
      </section>

      <div class="dashboard-grid dashboard-summary-grid" *ngIf="report() as data">
        <section class="panel">
          <div class="section-title">
            <div>
              <h2>Front desk shortcuts</h2>
            </div>
          </div>
          <div class="quick-grid">
            <a class="action-card" routerLink="/appointments">
              <strong>Walk-in booking</strong>
            </a>
            <a class="action-card" routerLink="/pos">
              <strong>Fast POS checkout</strong>
            </a>
            <a class="action-card" routerLink="/inventory">
              <strong>Purchase entry</strong>
            </a>
            <a class="action-card" routerLink="/marketing">
              <strong>Client win-back</strong>
            </a>
          </div>
        </section>

        <section class="panel">
          <div class="section-title">
            <div>
              <h2>{{ data.staffPerformance.length }} ranked staff</h2>
            </div>
            <a class="ghost-button" routerLink="/staff">Open staff</a>
          </div>
          <div class="summary-tile">
            <strong>{{ data.staffPerformance[0]?.name || 'No staff activity yet' }}</strong>
            <span>Top staff · {{ data.staffPerformance[0]?.bookings || 0 }} bookings</span>
          </div>
        </section>

        <section class="panel">
          <div class="section-title">
            <div>
              <h2>{{ data.lowStockAlerts.length || 0 }} low stock alerts</h2>
            </div>
            <a class="ghost-button" routerLink="/inventory">Open stock</a>
          </div>
          <div class="summary-tile">
            <strong>{{ data.lowStockAlerts[0]?.name || 'Inventory healthy' }}</strong>
            <span>{{ data.lowStockAlerts[0]?.stock ?? 'All products above threshold' }}</span>
          </div>
        </section>

        <section class="panel">
          <div class="section-title">
            <div>
              <h2>Operational workflow</h2>
            </div>
            <a class="ghost-button" routerLink="/smart-booking">Open workflow</a>
          </div>
          <div class="timeline">
            <span>Requested</span>
            <span>Confirmed</span>
            <span>Arrived</span>
            <span>Completed</span>
            <span>Billed</span>
          </div>
        </section>
      </div>
    </section>
  `,
  styles: [`
    .page-stack { display: flex; flex-direction: column; gap: 20px; padding: 6px 2px 24px; background: var(--color-surface-muted); min-height: 100vh; }

    .metrics-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
      gap: 12px;
    }

    .dashboard-greeting { margin-bottom: 0; }
    .dashboard-greeting h1 { display: flex; align-items: center; gap: 8px; }
    .muted-text { color: var(--muted); font-size: 0.82rem; font-weight: 600; }

    .dashboard-panel {
      padding: 0 20px 20px;
      background: var(--surface);
      border: 1px solid var(--line);
      border-radius: 14px;
      box-shadow: 0 1px 3px rgba(15,23,42,0.04);
    }

    .metric-label { font-size: 0.72rem; font-weight: 800; text-transform: uppercase; letter-spacing: 0.05em; color: var(--muted); }
    .metric-value { font-size: 1.35rem; font-weight: 800; line-height: 1.2; margin-top: 2px; }
    .metric-change { font-size: 0.72rem; font-weight: 700; color: var(--muted); margin-top: auto; }
    .metric-change.up { color: #16a34a; }
    .metric-change.down { color: #dc2626; }

    .hub-icon { font-size: 1.3rem; line-height: 1; margin-bottom: 2px; }
    .action-icon { font-size: 1.1rem; line-height: 1; margin-bottom: 2px; }

    .dashboard-command-panel {
      padding: 8px 20px 16px;
      background: var(--surface);
      border: 1px solid var(--line);
      border-radius: 16px;
      box-shadow: 0 1px 3px rgba(15,23,42,0.03);
    }

    .section-title {
      padding: 12px 0 10px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      flex-wrap: wrap;
    }
    .section-title h2 { font-size: 1.1rem; font-weight: 750; margin: 0; letter-spacing: -0.02em; }
    .section-title .eyebrow { font-size: 0.72rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; color: var(--muted); display: block; margin-bottom: 2px; }

    .compact-title { margin-bottom: 4px; padding-bottom: 10px; border-bottom: 1px solid var(--line); }

    .header-link-row { display: inline-flex; gap: 8px; flex-wrap: wrap; }

    .dashboard-hub-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(162px, 1fr));
      gap: 12px;
    }

    .dashboard-hub-card {
      min-height: 118px;
      height: 100%;
      display: grid;
      align-content: start;
      gap: 6px;
      padding: 14px;
      border: 1px solid var(--line);
      border-radius: 12px;
      background: var(--surface);
      box-shadow: 0 1px 2px rgba(15,23,42,0.03), 0 1px 4px rgba(15,23,42,0.02);
      overflow: hidden;
      transition: all 180ms cubic-bezier(0.16,1,0.3,1);
    }

    .dashboard-hub-card:hover,
    .dashboard-hub-card:focus-visible {
      border-color: rgba(79,70,229,0.15);
      box-shadow: 0 8px 24px rgba(15,23,42,0.06);
      transform: translateY(-3px);
      background: var(--surface);
      outline: 0;
    }

    .dashboard-hub-card .eyebrow { font-size: 0.68rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; color: var(--muted); }
    .dashboard-hub-card strong { font-size: 0.92rem; font-weight: 650; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .dashboard-hub-card small { font-size: 0.74rem; color: var(--muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; line-height: 1.35; }
    .dashboard-hub-card b {
      align-self: end;
      color: var(--color-primary);
      font-size: 0.78rem;
      font-weight: 600;
    }

    .dashboard-summary-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      grid-auto-rows: 1fr;
      gap: 12px;
      align-items: stretch;
    }

    .dashboard-summary-grid > .panel {
      display: flex;
      flex-direction: column;
      gap: 10px;
      padding: 0 16px 16px;
      background: var(--surface);
      border: 1px solid var(--line);
      border-radius: 16px;
      box-shadow: 0 1px 3px rgba(15,23,42,0.03);
    }

    .dashboard-summary-grid > .panel > .section-title { padding-left: 0; padding-right: 0; }

    .dashboard-summary-grid .quick-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 8px;
      flex: 1;
    }

    .dashboard-summary-grid .summary-tile,
    .dashboard-summary-grid .timeline {
      flex: 1;
    }

    .quick-grid .action-card {
      min-height: 82px;
      display: grid;
      align-content: center;
      gap: 4px;
      padding: 12px 14px;
      border: 1px solid var(--line);
      border-radius: 10px;
      background: var(--surface);
      transition: all 160ms cubic-bezier(0.16,1,0.3,1);
    }
    .quick-grid .action-card:hover { border-color: rgba(79,70,229,0.12); box-shadow: 0 4px 12px rgba(15,23,42,0.04); transform: translateY(-1px); }
    .quick-grid .action-card strong { font-size: 0.85rem; font-weight: 650; }
    .quick-grid .action-card span { font-size: 0.74rem; color: var(--muted); }

    .summary-tile {
      min-height: 88px;
      display: grid;
      align-content: center;
      gap: 4px;
      padding: 14px 16px;
      border: 1px solid var(--line);
      border-radius: 10px;
      background: var(--surface);
      transition: all 160ms cubic-bezier(0.16,1,0.3,1);
    }
    .summary-tile:hover { border-color: rgba(79,70,229,0.08); box-shadow: 0 4px 12px rgba(15,23,42,0.03); }
    .summary-tile strong { font-size: 0.95rem; font-weight: 650; }
    .summary-tile span { font-size: 0.76rem; color: var(--muted); }
    .summary-tile small { font-size: 0.72rem; color: var(--muted); display: block; margin-top: 2px; }

    .timeline {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 6px;
      padding: 14px 16px;
      border: 1px solid var(--line);
      border-radius: 10px;
      background: var(--surface);
    }
    .timeline span {
      flex: 1;
      text-align: center;
      font-size: 0.74rem;
      font-weight: 600;
      color: var(--muted);
      padding: 6px 4px;
      border-radius: 6px;
      background: var(--color-surface-muted);
      transition: all 120ms ease;
    }
    .timeline span:hover { background: var(--color-primary-soft); color: var(--color-primary); }

    .ghost-button {
      display: inline-flex; align-items: center; padding: 6px 14px; border-radius: 8px;
      border: 1px solid var(--line); font-size: 0.78rem; font-weight: 600; color: var(--color-primary);
      transition: all 120ms ease;
    }
    .ghost-button:hover { background: var(--color-primary-soft); border-color: var(--color-primary); }


    .dashboard-greeting.topbar {
      padding: 20px 22px;
      border: 1px solid rgba(117, 79, 71, 0.12);
      border-radius: 14px;
      background: linear-gradient(180deg, #fff, #fffcfa);
      box-shadow: 0 10px 28px rgba(89, 64, 54, 0.06);
    }

    .dashboard-greeting h1 {
      font-size: clamp(1.35rem, 1.8vw, 1.9rem);
      font-weight: 680;
      letter-spacing: -0.025em;
    }

    .dashboard-panel,
    .dashboard-command-panel,
    .dashboard-summary-grid > .panel {
      border-color: rgba(117, 79, 71, 0.12);
      border-radius: 14px;
      background: #fff;
      box-shadow: 0 8px 24px rgba(89, 64, 54, 0.045);
    }

    .dashboard-panel { padding-top: 2px; }
    .dashboard-command-panel { padding-top: 6px; }

    .section-title h2 {
      font-weight: 680;
      letter-spacing: -0.015em;
    }

    .metric-card {
      min-height: 112px;
      padding: 16px 16px 14px;
      border: 1px solid rgba(117, 79, 71, 0.12) !important;
      border-top-width: 1px !important;
      border-left: 3px solid #8f5c54 !important;
      border-radius: 13px;
      background: linear-gradient(180deg, #fff, #fffdfb);
      box-shadow: 0 6px 18px rgba(89, 64, 54, 0.04);
      transition: border-color 140ms ease, box-shadow 140ms ease, transform 140ms ease;
    }

    .metric-card:hover,
    .metric-card:focus-visible {
      transform: translateY(-1px);
      border-color: rgba(143, 92, 84, 0.24) !important;
      box-shadow: 0 10px 24px rgba(89, 64, 54, 0.065);
    }

    .metric-label {
      font-weight: 650;
      letter-spacing: 0.055em;
    }

    .metric-value {
      color: #5f3f3a !important;
      font-size: 1.28rem;
      font-weight: 720;
      line-height: 1.18;
    }

    .hub-icon {
      display: inline-grid;
      place-items: center;
      width: 34px;
      height: 34px;
      border-radius: 10px;
      margin-bottom: 4px;
      color: #7a4d47;
      background: #fbf1ec;
      font-size: 0.72rem;
      font-weight: 760;
      letter-spacing: 0.04em;
      line-height: 1;
    }

    .dashboard-hub-card,
    .quick-grid .action-card,
    .summary-tile {
      border-color: rgba(117, 79, 71, 0.12);
      background: #fff;
      box-shadow: 0 6px 18px rgba(89, 64, 54, 0.035);
    }

    .dashboard-hub-card:hover,
    .dashboard-hub-card:focus-visible,
    .quick-grid .action-card:hover,
    .summary-tile:hover {
      border-color: rgba(143, 92, 84, 0.22);
      box-shadow: 0 10px 24px rgba(89, 64, 54, 0.06);
    }

    .dashboard-hub-card strong,
    .quick-grid .action-card strong,
    .summary-tile strong {
      font-weight: 620;
    }

    .dashboard-hub-card b {
      color: #7a4d47;
      font-weight: 650;
    }

    :host .page-stack {
      gap: 16px;
      padding: 10px 8px 30px;
      background: #f8f5f2;
    }

    :host .dashboard-greeting.topbar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 20px;
      padding: 22px 24px;
      border: 1px solid rgba(126, 92, 82, 0.14);
      border-radius: 16px;
      background: linear-gradient(135deg, #ffffff 0%, #fffaf7 100%);
      box-shadow: 0 16px 40px rgba(75, 53, 45, 0.08);
    }

    :host .dashboard-greeting-copy {
      display: grid;
      gap: 5px;
      min-width: 0;
    }

    :host .dashboard-eyebrow {
      color: #8a6259;
      font-size: 0.7rem;
      font-weight: 650;
      letter-spacing: 0.08em;
      text-transform: uppercase;
    }

    :host .dashboard-greeting h1 {
      margin: 0;
      color: #241c19;
      font-size: clamp(1.45rem, 2vw, 2rem);
      font-weight: 660;
      letter-spacing: -0.026em;
      line-height: 1.1;
    }

    :host .dashboard-greeting p {
      max-width: 680px;
      margin: 0;
      color: #746763;
      font-size: 0.88rem;
      font-weight: 430;
      line-height: 1.45;
    }

    :host .dashboard-greeting .topbar-actions {
      display: flex;
      align-items: center;
      gap: 9px;
      flex-wrap: wrap;
    }

    :host .dashboard-greeting .ghost-button,
    :host .dashboard-greeting .primary-button,
    :host .dashboard-command-panel .ghost-button,
    :host .dashboard-summary-grid .ghost-button {
      min-height: 36px;
      border-radius: 10px;
      font-weight: 580;
      box-shadow: none;
    }

    :host .dashboard-greeting .primary-button {
      border: 1px solid #7a4d47;
      background: #7a4d47;
      color: #fff;
    }

    :host .dashboard-greeting .ghost-button,
    :host .dashboard-command-panel .ghost-button,
    :host .dashboard-summary-grid .ghost-button {
      border-color: rgba(126, 92, 82, 0.18);
      background: #fff;
      color: #6a4a45;
    }

    :host .dashboard-panel,
    :host .dashboard-command-panel,
    :host .dashboard-summary-grid > .panel {
      border: 1px solid rgba(126, 92, 82, 0.13);
      border-radius: 16px;
      background: #fff;
      box-shadow: 0 14px 34px rgba(75, 53, 45, 0.055);
    }

    :host .dashboard-panel {
      padding: 4px 20px 20px;
    }

    :host .dashboard-command-panel {
      padding: 4px 20px 18px;
    }

    :host .compact-title {
      margin-bottom: 12px;
      border-bottom-color: rgba(126, 92, 82, 0.1);
    }

    :host .section-title h2 {
      color: #2b2220;
      font-size: 1.02rem;
      font-weight: 640;
      letter-spacing: -0.012em;
    }

    :host .muted-text {
      color: #8a7a74;
      font-weight: 500;
    }

    :host .metrics-grid {
      grid-template-columns: repeat(auto-fit, minmax(178px, 1fr));
      gap: 14px;
    }

    :host .dashboard-panel .metrics-grid > a.metric-card,
    :host a.metric-card {
      position: relative;
      display: grid;
      align-content: center;
      gap: 8px;
      min-height: 112px;
      padding: 17px 18px 16px;
      border: 1px solid rgba(126, 92, 82, 0.13) !important;
      border-top: 1px solid rgba(126, 92, 82, 0.13) !important;
      border-left: 4px solid #8f5c54 !important;
      border-radius: 14px;
      background: #fff !important;
      background-image: linear-gradient(180deg, #fff 0%, #fffdfb 100%) !important;
      box-shadow: 0 8px 22px rgba(75, 53, 45, 0.045);
      color: #2b2220;
      overflow: hidden;
      text-decoration: none;
      transition: border-color 140ms ease, box-shadow 140ms ease, transform 140ms ease;
    }

    :host .dashboard-panel .metrics-grid > a.metric-card::before {
      content: '';
      position: absolute;
      inset: 0 auto 0 0;
      width: 4px;
      background: linear-gradient(180deg, #9b6a60, #d3a36e);
    }

    :host .dashboard-panel .metrics-grid > a.metric-card::after {
      content: 'Live';
      position: absolute;
      top: 12px;
      right: 12px;
      padding: 3px 8px;
      border: 1px solid rgba(143, 92, 84, 0.14);
      border-radius: 999px;
      background: #fff8f4;
      color: #8a6259;
      font-size: 0.62rem;
      font-weight: 620;
      letter-spacing: 0.04em;
      text-transform: uppercase;
    }

    :host .dashboard-panel .metrics-grid > a.metric-card:hover,
    :host .dashboard-panel .metrics-grid > a.metric-card:focus-visible {
      transform: translateY(-1px);
      border-color: rgba(143, 92, 84, 0.24) !important;
      box-shadow: 0 14px 30px rgba(75, 53, 45, 0.075);
      outline: 0;
    }

    :host .metric-label {
      color: #82746f;
      font-size: 0.69rem;
      font-weight: 590;
      letter-spacing: 0.055em;
    }

    :host .metric-value,
    :host .dashboard-panel .metric-card .metric-value {
      color: #503a35 !important;
      font-size: 1.32rem;
      font-weight: 660;
      line-height: 1.15;
      letter-spacing: -0.012em;
    }

    :host .dashboard-hub-grid {
      grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
      gap: 14px;
    }

    :host .dashboard-command-panel .dashboard-hub-card {
      position: relative;
      min-height: 128px;
      padding: 16px 16px 15px;
      border: 1px solid rgba(126, 92, 82, 0.13) !important;
      border-left: 4px solid rgba(143, 92, 84, 0.72) !important;
      border-radius: 14px;
      background: #fff !important;
      background-image: linear-gradient(180deg, #fff 0%, #fffdfb 100%) !important;
      box-shadow: 0 8px 22px rgba(75, 53, 45, 0.04);
      color: #2b2220;
      text-decoration: none;
      transition: border-color 140ms ease, box-shadow 140ms ease, transform 140ms ease;
    }

    :host .dashboard-command-panel .dashboard-hub-card:hover,
    :host .dashboard-command-panel .dashboard-hub-card:focus-visible {
      transform: translateY(-1px);
      border-color: rgba(143, 92, 84, 0.24) !important;
      box-shadow: 0 14px 30px rgba(75, 53, 45, 0.07);
      outline: 0;
    }

    :host .dashboard-command-panel .hub-icon {
      width: fit-content;
      min-width: 34px;
      height: 28px;
      padding: 0 9px;
      border: 1px solid rgba(143, 92, 84, 0.16);
      border-radius: 999px;
      color: #7a4d47;
      background: #fff8f4;
      font-size: 0.68rem;
      font-weight: 650;
      letter-spacing: 0.04em;
    }

    :host .dashboard-command-panel .dashboard-hub-card strong {
      color: #342723;
      font-size: 0.92rem;
      font-weight: 590;
      line-height: 1.3;
    }

    :host .dashboard-command-panel .dashboard-hub-card small {
      color: #7e716c;
      font-weight: 430;
    }

    :host .dashboard-command-panel .dashboard-hub-card b {
      color: #7a4d47;
      font-size: 0.75rem;
      font-weight: 600;
    }

    :host .dashboard-summary-grid > .panel,
    :host .quick-grid .action-card,
    :host .summary-tile,
    :host .timeline {
      border-color: rgba(126, 92, 82, 0.12);
      background: #fff;
      box-shadow: 0 8px 22px rgba(75, 53, 45, 0.035);
    }

    :host .quick-grid .action-card strong,
    :host .summary-tile strong,
    :host .timeline span {
      font-weight: 560;
    }

    :host .timeline span {
      background: #fff8f4;
      color: #766763;
    }

    @media (max-width: 720px) {
      :host .dashboard-greeting.topbar {
        align-items: stretch;
        flex-direction: column;
      }

      :host .dashboard-greeting .topbar-actions,
      :host .dashboard-greeting .topbar-actions > * {
        width: 100%;
        justify-content: center;
      }

      :host .metrics-grid,
      :host .dashboard-hub-grid {
        grid-template-columns: 1fr;
      }
    }

    :host .dashboard-panel .metrics-grid > a.metric-card::after {
      content: none;
    }

    :host .dashboard-panel .metrics-grid > a.metric-card,
    :host .dashboard-command-panel .dashboard-hub-card,
    :host .dashboard-summary-grid > .panel,
    :host .quick-grid .action-card,
    :host .summary-tile,
    :host .timeline {
      background: #fff !important;
      background-image: none !important;
      border-color: rgba(118, 85, 76, 0.14) !important;
      box-shadow: 0 1px 2px rgba(41, 31, 28, 0.03), 0 10px 26px rgba(73, 51, 43, 0.045);
    }

    :host .dashboard-panel .metrics-grid > a.metric-card,
    :host .dashboard-command-panel .dashboard-hub-card {
      border-left-color: #9a6a60 !important;
    }

    :host .dashboard-panel .metrics-grid > a.metric-card::before {
      background: #9a6a60;
    }

    :host .metric-value,
    :host .dashboard-panel .metric-card .metric-value {
      color: #3e2f2b !important;
      font-weight: 620;
    }

    :host .metric-label,
    :host .dashboard-command-panel .dashboard-hub-card strong,
    :host .quick-grid .action-card strong,
    :host .summary-tile strong {
      font-weight: 540;
    }

    :host .dashboard-command-panel .hub-icon {
      height: 24px;
      min-width: 0;
      padding: 0 8px;
      border-color: rgba(154, 106, 96, 0.16);
      background: #fff7f3;
      font-size: 0.64rem;
      font-weight: 620;
    }

    :host .dashboard-summary-grid {
      gap: 14px;
    }

    :host .dashboard-summary-grid > .panel {
      padding: 2px 16px 16px;
      border-radius: 14px;
    }

    :host .timeline span {
      background: #faf7f4;
      border: 1px solid rgba(118, 85, 76, 0.08);
      font-weight: 520;
    }
    @media (max-width: 1280px) {
      .metrics-grid { grid-template-columns: repeat(4, minmax(0, 1fr)); }
      .dashboard-hub-grid { grid-template-columns: repeat(4, minmax(138px, 1fr)); }
      .dashboard-summary-grid { grid-template-columns: 1fr; }
    }

    @media (max-width: 768px) {
      .metrics-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .dashboard-hub-grid { grid-template-columns: repeat(2, minmax(138px, 1fr)); }
      .quick-grid { grid-template-columns: 1fr; }
    }

    @media (max-width: 480px) {
      .metrics-grid { grid-template-columns: 1fr; }
      .dashboard-hub-grid { grid-template-columns: 1fr; }
    }
  `]
})
export class DashboardComponent implements OnInit {
  readonly report = signal<ApiRecord | null>(null);
  readonly loading = signal(true);
  readonly error = signal('');

  constructor(private readonly api: ApiService) {}

  ngOnInit(): void {
    this.load();
  }

  greeting(): string {
    const hour = new Date().getHours();
    if (hour < 12) return 'Good morning';
    if (hour < 17) return 'Good afternoon';
    return 'Good evening';
  }

  today(): string {
    return new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });
  }

  load(): void {
    this.loading.set(true);
    this.error.set('');
    this.api.report<ApiRecord>('dashboard', { branchId: this.api.selectedBranchId() }).subscribe({
      next: (report) => {
        this.report.set(this.normalizeReport(report));
        this.loading.set(false);
      },
      error: (error) => {
        this.error.set(this.readError(error, 'Unable to load dashboard'));
        this.loading.set(false);
      }
    });
  }

  private normalizeReport(report: ApiRecord = {}): ApiRecord {
    return {
      revenueToday: Number(report['revenueToday'] || 0),
      revenueMonth: Number(report['revenueMonth'] || 0),
      totalBookings: Number(report['totalBookings'] || 0),
      newClients: Number(report['newClients'] || 0),
      pendingPayments: Number(report['pendingPayments'] || 0),
      receivedDue: Number(report['receivedDue'] || 0),
      lowStockAlerts: this.safeRows(report['lowStockAlerts']),
      staffPerformance: this.safeRows(report['staffPerformance']),
      membershipRevenue: Number(report['membershipRevenue'] || 0),
      repeatCustomerRate: Number(report['repeatCustomerRate'] || 0),
      clientRetention: Number(report['clientRetention'] || 0),
      quickActions: this.safeRows(report['quickActions'])
    };
  }

  private safeRows(value: unknown): ApiRecord[] {
    return Array.isArray(value) ? value.filter((row): row is ApiRecord => Boolean(row && typeof row === 'object')) : [];
  }

  private readError(error: any, fallback: string): string {
    const raw =
      error?.error?.error?.message ||
      error?.error?.message ||
      error?.error?.error ||
      error?.message ||
      fallback;
    if (typeof raw === 'string') return raw;
    return raw?.message || raw?.code || fallback;
  }
}
