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

      <div class="greeting" *ngIf="report()">
        <div class="greeting-copy">
          <span class="greeting-eyebrow">Today's command center</span>
          <h1>{{ greeting() }}</h1>
          <p>Track revenue, bookings, payments, clients, and alerts from one operational view.</p>
        </div>
        <div class="greeting-actions">
          <a class="btn-ghost" routerLink="/reports">Export</a>
          <a class="btn-primary" routerLink="/appointments">New Booking</a>
        </div>
      </div>

      <section class="card metrics-section" *ngIf="report() as data">
        <div class="card-h">
          <h2>Key Metrics</h2>
          <span class="card-date">{{ today() }}</span>
        </div>
        <div class="metrics-grid">
          <a class="kpi" routerLink="/kpi-details/dashboard/revenue-today">
            <span class="kpi-l">Revenue today</span>
            <strong class="kpi-v">{{ data.revenueToday | currency: 'INR':'symbol':'1.0-0' }}</strong>
          </a>
          <a class="kpi" routerLink="/kpi-details/dashboard/revenue-this-month">
            <span class="kpi-l">Revenue this month</span>
            <strong class="kpi-v">{{ data.revenueMonth | currency: 'INR':'symbol':'1.0-0' }}</strong>
          </a>
          <a class="kpi" routerLink="/kpi-details/dashboard/total-bookings">
            <span class="kpi-l">Total bookings</span>
            <strong class="kpi-v">{{ data.totalBookings }}</strong>
          </a>
          <a class="kpi" routerLink="/pos/invoices" [queryParams]="{ filter: 'received-due' }">
            <span class="kpi-l">Received due</span>
            <strong class="kpi-v" style="color:#059669">{{ data.receivedDue | currency: 'INR':'symbol':'1.0-0' }}</strong>
          </a>
          <a class="kpi" routerLink="/kpi-details/dashboard/pending-payments">
            <span class="kpi-l">Pending payments</span>
            <strong class="kpi-v" style="color:#dc2626">{{ data.pendingPayments | currency: 'INR':'symbol':'1.0-0' }}</strong>
          </a>
          <a class="kpi" routerLink="/clients">
            <span class="kpi-l">New clients</span>
            <strong class="kpi-v" style="color:#d97706">{{ data.newClients }}</strong>
          </a>
          <a class="kpi" routerLink="/customer-360">
            <span class="kpi-l">Client retention</span>
            <strong class="kpi-v" style="color:#059669">{{ data.clientRetention }}%</strong>
          </a>
        </div>
      </section>

      <section class="card" *ngIf="report() as data">
        <div class="card-h">
          <h2>Quick access</h2>
          <div class="card-h-actions">
            <a class="btn-ghost" routerLink="/dashboard/executive">Executive dashboard</a>
            <a class="btn-ghost" routerLink="/reports">All reports</a>
          </div>
        </div>
        <div class="hub-grid">
          <a class="hub-tile" routerLink="/appointments">
            <span class="hub-badge">BK</span>
            <strong>{{ data.totalBookings }} bookings</strong>
            <span class="hub-cta">Open calendar</span>
          </a>
          <a class="hub-tile" routerLink="/pos">
            <span class="hub-badge">POS</span>
            <strong>{{ data.receivedDue | currency: 'INR':'symbol':'1.0-0' }} received due</strong>
            <span class="hub-sub">{{ data.pendingPayments | currency: 'INR':'symbol':'1.0-0' }} still pending</span>
            <span class="hub-cta">Open POS</span>
          </a>
          <a class="hub-tile" routerLink="/inventory">
            <span class="hub-badge">ST</span>
            <strong>{{ data.lowStockAlerts.length || 0 }} alerts</strong>
            <span class="hub-sub">{{ data.lowStockAlerts[0]?.name || 'Stock is healthy' }}</span>
            <span class="hub-cta">Open stock</span>
          </a>
          <a class="hub-tile" routerLink="/staff-os/employee-masters">
            <span class="hub-badge">TM</span>
            <strong>{{ data.staffPerformance[0]?.name || 'No ranking yet' }}</strong>
            <span class="hub-sub">{{ (data.staffPerformance[0]?.revenue || 0) | currency: 'INR':'symbol':'1.0-0' }} top revenue</span>
            <span class="hub-cta">Open Staff OS</span>
          </a>
          <a class="hub-tile" routerLink="/customer-360">
            <span class="hub-badge">CL</span>
            <strong>{{ data.repeatCustomerRate }}% repeat</strong>
            <span class="hub-sub">{{ data.newClients }} new clients this month</span>
            <span class="hub-cta">Open customer intelligence</span>
          </a>
          <a class="hub-tile" routerLink="/smart-booking">
            <span class="hub-badge">WF</span>
            <strong>Workflow</strong>
            <span class="hub-cta">Open workflow</span>
          </a>
          <a class="hub-tile" routerLink="/memberships">
            <span class="hub-badge">MB</span>
            <strong>{{ data.membershipRevenue | currency: 'INR':'symbol':'1.0-0' }}</strong>
            <span class="hub-cta">Open memberships</span>
          </a>
        </div>
      </section>

      <div class="bottom-grid" *ngIf="report() as data">
        <section class="card">
          <div class="card-h">
            <h2>Front desk shortcuts</h2>
          </div>
          <div class="shortcut-grid">
            <a class="shortcut" routerLink="/appointments">
              <span class="shortcut-i">BK</span>
              <strong>Walk-in booking</strong>
            </a>
            <a class="shortcut" routerLink="/pos">
              <span class="shortcut-i">PS</span>
              <strong>Fast POS checkout</strong>
            </a>
            <a class="shortcut" routerLink="/inventory">
              <span class="shortcut-i">IV</span>
              <strong>Purchase entry</strong>
            </a>
            <a class="shortcut" routerLink="/marketing">
              <span class="shortcut-i">MK</span>
              <strong>Client win-back</strong>
            </a>
          </div>
        </section>

        <section class="card">
          <div class="card-h">
            <h2>{{ data.staffPerformance.length }} ranked staff</h2>
            <a class="btn-ghost" routerLink="/staff">Open staff</a>
          </div>
          <div class="staff-card">
            <div class="staff-row">
              <span class="staff-rank">1</span>
              <div>
                <strong>{{ data.staffPerformance[0]?.name || 'No staff activity yet' }}</strong>
                <span>{{ data.staffPerformance[0]?.bookings || 0 }} bookings</span>
              </div>
            </div>
          </div>
        </section>

        <section class="card">
          <div class="card-h">
            <h2>{{ data.lowStockAlerts.length || 0 }} low stock alerts</h2>
            <a class="btn-ghost" routerLink="/inventory">Open stock</a>
          </div>
          <div class="alert-card">
            <div class="alert-row" *ngIf="data.lowStockAlerts[0]">
              <div>
                <strong>{{ data.lowStockAlerts[0].name }}</strong>
                <span>{{ data.lowStockAlerts[0].stock ?? 'Check stock' }}</span>
              </div>
            </div>
            <div class="alert-empty" *ngIf="!data.lowStockAlerts[0]">
              <span>All products above threshold</span>
            </div>
          </div>
        </section>

        <section class="card">
          <div class="card-h">
            <h2>Operational workflow</h2>
            <a class="btn-ghost" routerLink="/smart-booking">Open workflow</a>
          </div>
          <div class="stepper">
            <div class="step done"><span class="step-dot"></span>Requested</div>
            <div class="step done"><span class="step-dot"></span>Confirmed</div>
            <div class="step active"><span class="step-dot"></span>Arrived</div>
            <div class="step"><span class="step-dot"></span>Completed</div>
            <div class="step"><span class="step-dot"></span>Billed</div>
          </div>
        </section>
      </div>
    </section>
  `,
  styles: [`
    :host { display: contents; }
    .page-stack {
      padding: 24px 32px;
      display: flex;
      flex-direction: column;
      gap: 20px;
      background: #f8f5f2;
    }

    /* ── Greeting ── */
    .greeting {
      display: flex;
      justify-content: space-between;
      align-items: flex-end;
      gap: 24px;
      flex-wrap: wrap;
    }
    .greeting-copy h1 {
      font-size: 20px; font-weight: 500;
      margin: 0; color: #2b2220;
    }
    .greeting-eyebrow {
      font-size: 11px; letter-spacing: .06em;
      text-transform: uppercase; color: #8f5c54; font-weight: 600;
    }
    .greeting-copy p {
      font-size: 13px; line-height: 1.45; color: #7a6c66; margin: 2px 0 0;
    }
    .greeting-actions { display: flex; gap: 8px; }

    /* ── Shared card ── */
    .card {
      background: #fff;
      border: 1px solid #e8e2dc;
      border-radius: 10px;
      padding: 20px 24px;
      box-shadow: 0 1px 3px rgba(75,18,56,.04), 0 1px 2px rgba(0,0,0,.02);
    }
    .card-h {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 16px;
      gap: 8px;
    }
    .card-h h2 {
      font-size: 14px; font-weight: 600;
      margin: 0; color: #2b2220; letter-spacing: .01em;
    }
    .card-h .card-h-actions { display: flex; gap: 6px; align-items: center; }
    .card-date { font-size: 11px; color: #b0a49c; font-weight: 500; }

    /* ── Buttons ── */
    .btn-ghost {
      display: inline-flex; align-items: center;
      height: 30px; padding: 0 12px; border-radius: 6px;
      font-size: 12px; font-weight: 500; color: #7a6c66;
      background: #fff; border: 1px solid #e8e2dc;
      text-decoration: none; cursor: pointer;
      transition: background .15s, border-color .15s;
    }
    .btn-ghost:hover { background: #f5f2ef; border-color: #d5cec7; color: #2b2220; }
    .btn-primary {
      display: inline-flex; align-items: center;
      height: 32px; padding: 0 16px; border-radius: 6px;
      font-size: 12px; font-weight: 500; color: #fff;
      background: #4B1238; border: 0;
      text-decoration: none; cursor: pointer;
      transition: background .15s;
    }
    .btn-primary:hover { background: #3d0e2e; }

    /* ── Metrics ── */
    .metrics-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(155px, 1fr));
      gap: 10px;
    }
    .kpi {
      display: flex; flex-direction: column; gap: 4px;
      padding: 16px 16px 14px; border-radius: 8px;
      background: #fff; border: 1px solid #ede8e3;
      text-decoration: none; transition: box-shadow .2s, border-color .2s, transform .2s;
      border-left: 3px solid #4B1238;
      box-shadow: 0 1px 2px rgba(0,0,0,.03);
    }
    .kpi:hover {
      box-shadow: 0 4px 12px rgba(75,18,56,.07);
      border-color: #d5cec7;
      transform: translateY(-1px);
    }
    .kpi-l {
      font-size: 11px; color: #8b7a74; font-weight: 500;
      text-transform: uppercase; letter-spacing: .04em;
    }
    .kpi-v { font-size: 20px; font-weight: 550; line-height: 1.2; color: #2b2220; }

    /* ── Hub tiles ── */
    .hub-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(190px, 1fr));
      gap: 10px;
    }
    .hub-tile {
      display: flex;
      flex-direction: column;
      gap: 6px;
      padding: 16px;
      border-radius: 8px;
      background: #fff;
      border: 1px solid #ede8e3;
      border-left: 3px solid #e2dbd4;
      text-decoration: none;
      transition: box-shadow .2s, border-color .2s, transform .2s;
      box-shadow: 0 1px 2px rgba(0,0,0,.02);
    }
    .hub-tile:hover {
      box-shadow: 0 4px 12px rgba(75,18,56,.06);
      border-color: #d5cec7;
      border-left-color: #8f5c54;
      transform: translateY(-1px);
    }
    .hub-tile strong {
      font-size: 14px; font-weight: 600; color: #2b2220; line-height: 1.3;
    }
    .hub-tile .hub-sub {
      font-size: 12px; color: #7a6c66; line-height: 1.35;
    }
    .hub-tile .hub-cta {
      font-size: 12px; font-weight: 600; color: #8f5c54; margin-top: 2px;
      display: flex; align-items: center; gap: 4px;
    }
    .hub-tile:hover .hub-cta::after {
      content: '\\2192';
      font-size: 13px;
    }
    .hub-badge {
      display: inline-flex; align-items: center; justify-content: center;
      width: 28px; height: 26px; border-radius: 5px;
      background: #f5f2ef; color: #4B1238;
      font-size: 10px; font-weight: 700; letter-spacing: .03em;
    }

    /* ── Bottom grid ── */
    .bottom-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 16px;
    }

    /* shortcuts */
    .shortcut-grid {
      display: grid; grid-template-columns: 1fr 1fr; gap: 10px;
    }
    .shortcut {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 16px 14px;
      border-radius: 8px;
      background: #fff;
      border: 1px solid #ede8e3;
      border-left: 3px solid #e2dbd4;
      text-decoration: none;
      transition: box-shadow .2s, border-color .2s, transform .2s;
      box-shadow: 0 1px 2px rgba(0,0,0,.02);
    }
    .shortcut:hover {
      box-shadow: 0 4px 12px rgba(75,18,56,.06);
      border-color: #d5cec7;
      border-left-color: #8f5c54;
      transform: translateY(-1px);
    }
    .shortcut strong {
      font-size: 13px; font-weight: 500; color: #2b2220;
    }
    .shortcut-i {
      display: inline-flex; align-items: center; justify-content: center;
      width: 28px; height: 26px; border-radius: 5px;
      background: #f5f2ef; color: #4B1238;
      font-size: 9px; font-weight: 700; letter-spacing: .03em;
      flex-shrink: 0;
    }

    /* staff */
    .staff-card { padding: 0; margin-top: -4px; }
    .staff-row {
      display: flex; align-items: center; gap: 12px;
      padding: 14px 16px; border-radius: 8px;
      background: #fff; border: 1px solid #ede8e3;
      border-left: 3px solid #4B1238;
      box-shadow: 0 1px 2px rgba(0,0,0,.02);
    }
    .staff-rank {
      display: inline-flex; align-items: center; justify-content: center;
      width: 26px; height: 26px; border-radius: 50%;
      background: #4B1238; color: #fff;
      font-size: 11px; font-weight: 600; flex-shrink: 0;
    }
    .staff-row div { display: flex; flex-direction: column; gap: 2px; }
    .staff-row strong { font-size: 13px; font-weight: 600; color: #2b2220; }
    .staff-row span { font-size: 12px; color: #7a6c66; }

    /* alerts */
    .alert-card { padding: 0; margin-top: -4px; }
    .alert-row {
      padding: 14px 16px; border-radius: 8px;
      background: #fff; border: 1px solid #ede8e3;
      border-left: 3px solid #d97706;
      box-shadow: 0 1px 2px rgba(0,0,0,.02);
    }
    .alert-row div { display: flex; flex-direction: column; gap: 2px; }
    .alert-row strong { font-size: 13px; font-weight: 600; color: #2b2220; }
    .alert-row span { font-size: 12px; color: #7a6c66; }
    .alert-empty {
      padding: 20px 16px; text-align: center;
      border-radius: 8px;
      background: #fff; border: 1px dashed #e8e2dc;
      font-size: 12px; color: #b0a49c;
    }

    /* ── Stepper ── */
    .stepper {
      display: flex;
      align-items: center;
      gap: 0;
      padding: 4px 0;
    }
    .step {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      font-size: 11px; font-weight: 500; color: #b0a49c;
      white-space: nowrap;
    }
    .step:not(:last-child)::after {
      content: '';
      display: inline-block;
      width: 28px; height: 2px;
      background: #e8e2dc;
      margin: 0 4px;
      border-radius: 1px;
    }
    .step-dot {
      display: inline-block;
      width: 8px; height: 8px;
      border-radius: 50%;
      background: #e8e2dc;
      flex-shrink: 0;
    }
    .step.done { color: #4B1238; font-weight: 600; }
    .step.done .step-dot { background: #4B1238; }
    .step.active { color: #8f5c54; font-weight: 600; }
    .step.active .step-dot { background: #8f5c54; }

    @media (max-width: 1024px) {
      .bottom-grid { grid-template-columns: 1fr; }
    }

    @media (max-width: 768px) {
      .greeting { flex-direction: column; align-items: stretch; }
      .greeting-actions { width: 100%; }
      .greeting-actions > * { flex: 1; justify-content: center; }
      .metrics-grid { grid-template-columns: repeat(2, 1fr); }
      .hub-grid { grid-template-columns: repeat(2, 1fr); }
    }

    @media (max-width: 520px) {
      .metrics-grid { grid-template-columns: 1fr; }
      .hub-grid { grid-template-columns: 1fr; }
      .shortcut-grid { grid-template-columns: 1fr; }
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
