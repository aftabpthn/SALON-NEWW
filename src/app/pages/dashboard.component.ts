import { CommonModule, CurrencyPipe } from '@angular/common';
import { Component, OnInit, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ApiRecord, ApiService } from '../core/api.service';
import { StateComponent } from '../shared/ui/state/state.component';
import { AuraKpiCardComponent } from '../shared/ui/aura-kpi-card/aura-kpi-card.component';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule, CurrencyPipe, RouterLink, StateComponent, AuraKpiCardComponent],
  template: `
    <section class="page-stack">
      <app-state [loading]="loading()" [error]="error()"></app-state>

      <div class="metrics-grid" *ngIf="report() as data">
        <aura-kpi-card tone="teal" target="/kpi-details/dashboard/revenue-today">
          <span>Revenue today</span>
          <strong>{{ data.revenueToday | currency: 'INR':'symbol':'1.0-0' }}</strong>
          <small>From saved sales</small>
        </aura-kpi-card>
        <aura-kpi-card tone="blue" target="/kpi-details/dashboard/revenue-this-month">
          <span>Revenue this month</span>
          <strong>{{ data.revenueMonth | currency: 'INR':'symbol':'1.0-0' }}</strong>
          <small>Branch aware</small>
        </aura-kpi-card>
        <aura-kpi-card tone="amber" target="/kpi-details/dashboard/total-bookings">
          <span>Total bookings</span>
          <strong>{{ data.totalBookings }}</strong>
          <small>Online, walk-in, front desk</small>
        </aura-kpi-card>
        <aura-kpi-card tone="green" target="/pos/invoices" [queryParams]="{ filter: 'received-due' }">
          <span>Received due</span>
          <strong>{{ data.receivedDue | currency: 'INR':'symbol':'1.0-0' }}</strong>
          <small>Old balance collections</small>
        </aura-kpi-card>
        <aura-kpi-card tone="red" target="/kpi-details/dashboard/pending-payments">
          <span>Pending payments</span>
          <strong>{{ data.pendingPayments | currency: 'INR':'symbol':'1.0-0' }}</strong>
          <small>Open invoice balance</small>
        </aura-kpi-card>
        <aura-kpi-card tone="violet" target="/clients">
          <span>New clients</span>
          <strong>{{ data.newClients }}</strong>
          <small>Acquired this month</small>
        </aura-kpi-card>
        <aura-kpi-card tone="rose" target="/customer-360">
          <span>Client retention</span>
          <strong>{{ data.clientRetention }}%</strong>
          <small>Repeat vs new mix</small>
        </aura-kpi-card>
      </div>

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
            <span class="eyebrow">Calendar</span>
            <strong>{{ data.totalBookings }} bookings</strong>
            <small>Quick booking, status board and appointment actions</small>
            <b>Open calendar</b>
          </a>
          <a class="dashboard-hub-card" routerLink="/pos">
            <span class="eyebrow">POS</span>
            <strong>{{ data.receivedDue | currency: 'INR':'symbol':'1.0-0' }} received due</strong>
            <small>{{ data.pendingPayments | currency: 'INR':'symbol':'1.0-0' }} still pending</small>
            <b>Open POS</b>
          </a>
          <a class="dashboard-hub-card" routerLink="/inventory">
            <span class="eyebrow">Inventory</span>
            <strong>{{ data.lowStockAlerts.length || 0 }} alerts</strong>
            <small>{{ data.lowStockAlerts[0]?.name || 'Stock is healthy' }}</small>
            <b>Open stock</b>
          </a>
          <a class="dashboard-hub-card" routerLink="/staff-os/employee-masters">
            <span class="eyebrow">Staff</span>
            <strong>{{ data.staffPerformance[0]?.name || 'No ranking yet' }}</strong>
            <small>{{ (data.staffPerformance[0]?.revenue || 0) | currency: 'INR':'symbol':'1.0-0' }} top revenue</small>
            <b>Open Staff OS</b>
          </a>
          <a class="dashboard-hub-card" routerLink="/customer-360">
            <span class="eyebrow">Customers</span>
            <strong>{{ data.repeatCustomerRate }}% repeat</strong>
            <small>{{ data.newClients }} new clients this month</small>
            <b>Open customer intelligence</b>
          </a>
          <a class="dashboard-hub-card" routerLink="/smart-booking">
            <span class="eyebrow">Online booking</span>
            <strong>Workflow</strong>
            <small>Requested → confirmed → arrived → completed → billed</small>
            <b>Open workflow</b>
          </a>
          <a class="dashboard-hub-card" routerLink="/memberships">
            <span class="eyebrow">Memberships</span>
            <strong>{{ data.membershipRevenue | currency: 'INR':'symbol':'1.0-0' }}</strong>
            <small>Plans, renewals and prepaid balance</small>
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
              <span>Create arrival and assign staff.</span>
            </a>
            <a class="action-card" routerLink="/pos">
              <strong>Fast POS checkout</strong>
              <span>Bill service or product quickly.</span>
            </a>
            <a class="action-card" routerLink="/inventory">
              <strong>Purchase entry</strong>
              <span>Add stock or review alerts.</span>
            </a>
            <a class="action-card" routerLink="/marketing">
              <strong>Client win-back</strong>
              <span>Open campaign tools.</span>
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
            <small>Full ranking and incentive details are inside Staff.</small>
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
            <small>Open Inventory for product-wise stock and reorder actions.</small>
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
    .metrics-grid {
      grid-template-columns: repeat(7, minmax(0, 1fr));
    }

    .dashboard-command-panel {
      padding: 8px 14px 12px;
    }

    .header-link-row {
      display: inline-flex;
      gap: 8px;
      flex-wrap: wrap;
    }

    .compact-title {
      margin-bottom: 8px;
      padding-bottom: 8px;
      border-bottom: 1px solid var(--line);
    }

    .dashboard-hub-grid {
      display: grid;
      grid-template-columns: repeat(7, minmax(138px, 1fr));
      gap: 10px;
    }

    .dashboard-hub-card {
      min-height: 118px;
      display: grid;
      align-content: start;
      gap: 6px;
      padding: 12px;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: #fff;
      overflow: hidden;
      transition: border-color 140ms ease, box-shadow 140ms ease, transform 140ms ease;
    }

    .dashboard-hub-card:hover,
    .dashboard-hub-card:focus-visible {
      border-color: var(--brand-600, #4f46e5);
      box-shadow: 0 0 0 2px rgba(99, 102, 241, 0.4), 0 10px 24px rgba(79, 70, 229, 0.16);
      transform: translateY(-2px);
      background: #fff;
      outline: 0;
    }

    .dashboard-hub-card strong,
    .dashboard-hub-card small {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .dashboard-hub-card b {
      align-self: end;
      color: var(--teal-2);
      font-size: 0.78rem;
    }

    .dashboard-summary-grid {
      grid-template-columns: repeat(2, minmax(0, 1fr));
      grid-auto-rows: 1fr;
      gap: 10px;
      align-items: stretch;
    }

    .dashboard-summary-grid > .panel {
      display: flex;
      flex-direction: column;
      gap: 10px;
    }

    .dashboard-summary-grid > .panel > .section-title {
      flex: 0 0 auto;
    }

    .dashboard-summary-grid .quick-grid,
    .dashboard-summary-grid .summary-tile,
    .dashboard-summary-grid .timeline {
      flex: 1 1 auto;
    }

    .dashboard-summary-grid .summary-tile {
      align-content: center;
    }

    .summary-tile {
      min-height: 88px;
      display: grid;
      gap: 6px;
      align-content: center;
      padding: 12px;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: #fff;
    }

    .summary-tile span,
    .summary-tile small {
      color: var(--muted);
    }

    .action-card {
      min-height: 82px;
    }

    @media (max-width: 1280px) {
      .metrics-grid,
      .dashboard-hub-grid {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }

      .dashboard-summary-grid {
        grid-template-columns: 1fr;
      }
    }

    @media (max-width: 768px) {
      .metrics-grid,
      .dashboard-hub-grid {
        grid-template-columns: 1fr;
      }
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
