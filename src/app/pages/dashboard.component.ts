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
        <div>
          <span class="eyebrow">Owner Command</span>
          <h1>{{ greeting() }} 👋</h1>
        </div>
        <div class="topbar-actions">
          <a class="ghost-button" routerLink="/reports">📥 Export</a>
          <a class="primary-button" routerLink="/appointments">+ New Booking</a>
        </div>
      </div>

      <section class="panel dashboard-panel" *ngIf="report() as data">
        <div class="section-title compact-title">
          <div>
            <span class="eyebrow">Today's Pulse</span>
            <h2>Key Metrics</h2>
          </div>
          <span class="muted-text">{{ today() }}</span>
        </div>
        <div class="metrics-grid">
          <a class="metric-card" style="border-top:3px solid #0f766e" routerLink="/kpi-details/dashboard/revenue-today">
            <span class="metric-label">Revenue today</span>
            <strong class="metric-value" style="color:#0f766e">{{ data.revenueToday | currency: 'INR':'symbol':'1.0-0' }}</strong>
          </a>
          <a class="metric-card" style="border-top:3px solid #7c3aed" routerLink="/kpi-details/dashboard/revenue-this-month">
            <span class="metric-label">Revenue this month</span>
            <strong class="metric-value" style="color:#7c3aed">{{ data.revenueMonth | currency: 'INR':'symbol':'1.0-0' }}</strong>
          </a>
          <a class="metric-card" style="border-top:3px solid #2563eb" routerLink="/kpi-details/dashboard/total-bookings">
            <span class="metric-label">Total bookings</span>
            <strong class="metric-value" style="color:#2563eb">{{ data.totalBookings }}</strong>
          </a>
          <a class="metric-card" style="border-top:3px solid #059669" routerLink="/pos/invoices" [queryParams]="{ filter: 'received-due' }">
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
            <span class="hub-icon">📅</span>
            <span class="eyebrow">Calendar</span>
            <strong>{{ data.totalBookings }} bookings</strong>
            <b>Open calendar</b>
          </a>
          <a class="dashboard-hub-card" routerLink="/pos">
            <span class="hub-icon">🧾</span>
            <span class="eyebrow">POS</span>
            <strong>{{ data.receivedDue | currency: 'INR':'symbol':'1.0-0' }} received due</strong>
            <small>{{ data.pendingPayments | currency: 'INR':'symbol':'1.0-0' }} still pending</small>
            <b>Open POS</b>
          </a>
          <a class="dashboard-hub-card" routerLink="/inventory">
            <span class="hub-icon">📦</span>
            <span class="eyebrow">Inventory</span>
            <strong>{{ data.lowStockAlerts.length || 0 }} alerts</strong>
            <small>{{ data.lowStockAlerts[0]?.name || 'Stock is healthy' }}</small>
            <b>Open stock</b>
          </a>
          <a class="dashboard-hub-card" routerLink="/staff-os/employee-masters">
            <span class="hub-icon">🧑‍💼</span>
            <span class="eyebrow">Staff</span>
            <strong>{{ data.staffPerformance[0]?.name || 'No ranking yet' }}</strong>
            <small>{{ (data.staffPerformance[0]?.revenue || 0) | currency: 'INR':'symbol':'1.0-0' }} top revenue</small>
            <b>Open Staff OS</b>
          </a>
          <a class="dashboard-hub-card" routerLink="/customer-360">
            <span class="hub-icon">👤</span>
            <span class="eyebrow">Customers</span>
            <strong>{{ data.repeatCustomerRate }}% repeat</strong>
            <small>{{ data.newClients }} new clients this month</small>
            <b>Open customer intelligence</b>
          </a>
          <a class="dashboard-hub-card" routerLink="/smart-booking">
            <span class="hub-icon">🌐</span>
            <span class="eyebrow">Online booking</span>
            <strong>Workflow</strong>
            <b>Open workflow</b>
          </a>
          <a class="dashboard-hub-card" routerLink="/memberships">
            <span class="hub-icon">💎</span>
            <span class="eyebrow">Memberships</span>
            <strong>{{ data.membershipRevenue | currency: 'INR':'symbol':'1.0-0' }}</strong>
            <b>Open memberships</b>
          </a>
        </div>
      </section>

      <div class="dashboard-grid dashboard-summary-grid" *ngIf="report() as data">
        <section class="panel">
          <div class="section-title">
            <div>
              <span class="eyebrow">Quick actions</span>
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
              <span class="eyebrow">Staff performance</span>
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
              <span class="eyebrow">Inventory alerts</span>
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
              <span class="eyebrow">Online booking</span>
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
