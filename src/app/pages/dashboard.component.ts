import { CommonModule } from '@angular/common';
import { Component, OnInit, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ApiRecord, ApiService } from '../core/api.service';
import { grantsCanAccessPath } from '../core/access-rules';
import { AuthSessionService } from '../core/auth-session.service';
import { staticGrantsForRole } from '../core/permission.guard';
import { AppStateService } from '../core/state/app-state.service';
import { StateComponent } from '../shared/ui/state/state.component';
import { AuraMoneyPipe } from '../shared/pipes/aura-money.pipe';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [AuraMoneyPipe, CommonModule, RouterLink, StateComponent],
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
          <a class="btn-ghost" routerLink="/reports" *ngIf="canAccessPath('/reports')">Export</a>
          <a class="btn-primary" routerLink="/appointments" *ngIf="canAccessPath('/appointments')">New Booking</a>
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
            <strong class="kpi-v">{{ data.revenueToday | auraMoney:'1.0-0' }}</strong>
          </a>
          <a class="kpi" routerLink="/kpi-details/dashboard/revenue-this-month">
            <span class="kpi-l">Revenue this month</span>
            <strong class="kpi-v">{{ data.revenueMonth | auraMoney:'1.0-0' }}</strong>
          </a>
          <a class="kpi" routerLink="/kpi-details/dashboard/total-bookings">
            <span class="kpi-l">Total bookings</span>
            <strong class="kpi-v">{{ data.totalBookings }}</strong>
          </a>
          <a class="kpi" routerLink="/pos/invoices" [queryParams]="{ filter: 'received-due' }" *ngIf="canAccessPath('/pos/invoices')">
            <span class="kpi-l">Received due</span>
            <strong class="kpi-v" style="color:#C87D4B">{{ data.receivedDue | auraMoney:'1.0-0' }}</strong>
          </a>
          <a class="kpi" routerLink="/kpi-details/dashboard/pending-payments">
            <span class="kpi-l">Pending payments</span>
            <strong class="kpi-v" style="color:#dc2626">{{ data.pendingPayments | auraMoney:'1.0-0' }}</strong>
          </a>
          <a class="kpi" routerLink="/clients" *ngIf="canAccessPath('/clients')">
            <span class="kpi-l">New clients</span>
            <strong class="kpi-v" style="color:#d97706">{{ data.newClients }}</strong>
          </a>
          <a class="kpi" routerLink="/customer-360" *ngIf="canAccessPath('/customer-360')">
            <span class="kpi-l">Client retention</span>
            <strong class="kpi-v" style="color:#C87D4B">{{ data.clientRetention }}%</strong>
          </a>
        </div>
      </section>

      <section class="card" *ngIf="report() as data">
        <div class="card-h">
          <h2>Quick access</h2>
          <div class="card-h-actions">
            <a class="btn-ghost" routerLink="/dashboard/executive" *ngIf="canAccessPath('/dashboard/executive')">Executive dashboard</a>
            <a class="btn-ghost" routerLink="/reports" *ngIf="canAccessPath('/reports')">All reports</a>
          </div>
        </div>
        <div class="hub-grid">
          <a class="hub-tile" routerLink="/appointments" *ngIf="canAccessPath('/appointments')">
            <span class="hub-badge">BK</span>
            <strong>{{ data.totalBookings }} bookings</strong>
            <span class="hub-cta">Open calendar</span>
          </a>
          <a class="hub-tile" routerLink="/pos" *ngIf="canAccessPath('/pos')">
            <span class="hub-badge">POS</span>
            <strong>{{ data.receivedDue | auraMoney:'1.0-0' }} received due</strong>
            <span class="hub-sub">{{ data.pendingPayments | auraMoney:'1.0-0' }} still pending</span>
            <span class="hub-cta">Open POS</span>
          </a>
          <a class="hub-tile" routerLink="/inventory" *ngIf="canAccessPath('/inventory')">
            <span class="hub-badge">ST</span>
            <strong>{{ data.lowStockAlerts.length || 0 }} alerts</strong>
            <span class="hub-sub">{{ data.lowStockAlerts[0]?.name || 'Stock is healthy' }}</span>
            <span class="hub-cta">Open stock</span>
          </a>
          <a class="hub-tile" routerLink="/staff-os/employee-masters" *ngIf="canAccessPath('/staff-os/employee-masters')">
            <span class="hub-badge">TM</span>
            <strong>{{ data.staffPerformance[0]?.name || 'No ranking yet' }}</strong>
            <span class="hub-sub">{{ (data.staffPerformance[0]?.revenue || 0) | auraMoney:'1.0-0' }} top revenue</span>
            <span class="hub-cta">Open Staff OS</span>
          </a>
          <a class="hub-tile" routerLink="/customer-360" *ngIf="canAccessPath('/customer-360')">
            <span class="hub-badge">CL</span>
            <strong>{{ data.repeatCustomerRate }}% repeat</strong>
            <span class="hub-sub">{{ data.newClients }} new clients this month</span>
            <span class="hub-cta">Open customer intelligence</span>
          </a>
          <a class="hub-tile" routerLink="/smart-booking" *ngIf="canAccessPath('/smart-booking')">
            <span class="hub-badge">WF</span>
            <strong>Workflow</strong>
            <span class="hub-cta">Open workflow</span>
          </a>
          <a class="hub-tile" routerLink="/memberships" *ngIf="canAccessPath('/memberships')">
            <span class="hub-badge">MB</span>
            <strong>{{ data.membershipRevenue | auraMoney:'1.0-0' }}</strong>
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
            <a class="shortcut" routerLink="/appointments" *ngIf="canAccessPath('/appointments')">
              <span class="shortcut-i">BK</span>
              <strong>Walk-in booking</strong>
            </a>
            <a class="shortcut" routerLink="/pos" *ngIf="canAccessPath('/pos')">
              <span class="shortcut-i">PS</span>
              <strong>Fast POS checkout</strong>
            </a>
            <a class="shortcut" routerLink="/inventory" *ngIf="canAccessPath('/inventory')">
              <span class="shortcut-i">IV</span>
              <strong>Purchase entry</strong>
            </a>
            <a class="shortcut" routerLink="/marketing" *ngIf="canAccessPath('/marketing')">
              <span class="shortcut-i">MK</span>
              <strong>Client win-back</strong>
            </a>
          </div>
        </section>

        <section class="card">
          <div class="card-h">
            <h2>{{ data.staffPerformance.length }} ranked staff</h2>
            <a class="btn-ghost" routerLink="/staff-os/staff-list" *ngIf="canAccessPath('/staff-os/staff-list')">Open staff</a>
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
            <a class="btn-ghost" routerLink="/inventory" *ngIf="canAccessPath('/inventory')">Open stock</a>
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
            <a class="btn-ghost" routerLink="/smart-booking" *ngIf="canAccessPath('/smart-booking')">Open workflow</a>
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
      padding: 20px 24px;
      display: flex;
      flex-direction: column;
      gap: 16px;
      background:
        radial-gradient(ellipse 80% 60% at 20% 8%, rgba(232, 167, 184, 0.18) 0%, transparent 70%),
        radial-gradient(ellipse 60% 50% at 90% 92%, rgba(75, 18, 56, 0.06) 0%, transparent 70%),
        radial-gradient(ellipse 50% 60% at 50% 50%, rgba(200, 170, 160, 0.06) 0%, transparent 70%),
        var(--bg);
    }

    .greeting {
      position: relative;
      display: flex;
      justify-content: space-between;
      align-items: flex-end;
      gap: 16px;
      flex-wrap: wrap;
      padding: 18px 20px 18px 32px;
      overflow: hidden;
      border: 1px solid rgba(255, 255, 255, 0.78);
      border-radius: 22px;
      background: linear-gradient(135deg, rgba(255,255,255,.94), rgba(255,247,251,.78) 52%, rgba(255,255,255,.9));
      box-shadow: 0 24px 44px rgba(75, 18, 56, 0.13), inset 0 1px 0 rgba(255,255,255,.95);
      transform: perspective(900px) rotateX(1.2deg) rotateY(-.8deg) translateZ(0);
    }
    .greeting::after {
      content: '';
      position: absolute;
      left: 18px;
      top: 16px;
      bottom: 16px;
      width: 5px;
      border-radius: 999px;
      background: linear-gradient(180deg, #6f1d51, #d08aac 48%, #fff2f7);
    }
    .greeting-copy {
      position: relative;
      padding-left: 14px;
      transform: translateZ(26px);
    }
    .greeting-copy h1 {
      font-size: 24px; font-weight: 800;
      margin: 0; color: #21151c;
      letter-spacing: -0.02em;
    }
    .greeting-eyebrow {
      font-size: 11px; letter-spacing: .08em;
      text-transform: uppercase; color: #8f5c54; font-weight: 750;
    }
    .greeting-copy p {
      font-size: 13px; line-height: 1.45; color: #667085; margin: 4px 0 0;
    }
    .greeting-actions { display: flex; gap: 8px; transform: translateZ(22px); }

    .card {
      background: rgba(255, 255, 255, 0.52);
      backdrop-filter: blur(14px);
      -webkit-backdrop-filter: blur(14px);
      border: 1px solid rgba(255, 255, 255, 0.72);
      border-radius: 14px;
      padding: 20px 24px;
      box-shadow:
        0 8px 32px rgba(75, 18, 56, 0.04),
        0 2px 8px rgba(0, 0, 0, 0.02),
        inset 0 1px 0 rgba(255, 255, 255, 0.6);
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

    .btn-ghost {
      display: inline-flex; align-items: center;
      height: 30px; padding: 0 12px; border-radius: 8px;
      font-size: 12px; font-weight: 500; color: #6F778A;
      background: rgba(255, 255, 255, 0.5);
      border: 1px solid rgba(255, 255, 255, 0.6);
      text-decoration: none; cursor: pointer;
      transition: background .2s, border-color .2s, box-shadow .2s, transform .2s;
      backdrop-filter: blur(8px);
      -webkit-backdrop-filter: blur(8px);
    }
    .btn-ghost:hover {
      background: rgba(255, 255, 255, 0.72);
      border-color: rgba(200, 190, 185, 0.5);
      color: #2b2220;
      box-shadow: 0 4px 12px rgba(75, 18, 56, 0.05);
      transform: translateY(-1px);
    }
    .btn-primary {
      display: inline-flex; align-items: center;
      height: 32px; padding: 0 16px; border-radius: 8px;
      font-size: 12px; font-weight: 500; color: #fff;
      background: #4B1238; border: 0;
      text-decoration: none; cursor: pointer;
      transition: background .2s, box-shadow .2s, transform .2s;
      box-shadow: 0 2px 8px rgba(75, 18, 56, 0.15);
    }
    .btn-primary:hover {
      background: #3d0e2e;
      transform: translateY(-1px);
      box-shadow: 0 4px 16px rgba(75, 18, 56, 0.2);
    }

    .metrics-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(155px, 1fr));
      gap: 10px;
    }
    .kpi {
      display: flex; flex-direction: column; gap: 4px;
      padding: 16px 16px 14px; border-radius: 12px;
      background: rgba(255, 255, 255, 0.48);
      backdrop-filter: blur(12px);
      -webkit-backdrop-filter: blur(12px);
      border: 1px solid rgba(255, 255, 255, 0.65);
      text-decoration: none;
      transition: box-shadow .25s, border-color .25s, transform .25s, background .25s;
      border-left: 3px solid #4B1238;
      box-shadow:
        0 4px 16px rgba(75, 18, 56, 0.03),
        0 1px 4px rgba(0, 0, 0, 0.02),
        inset 0 1px 0 rgba(255, 255, 255, 0.5);
    }
    .kpi:hover {
      box-shadow:
        0 12px 36px rgba(75, 18, 56, 0.08),
        0 4px 12px rgba(0, 0, 0, 0.03),
        inset 0 1px 0 rgba(255, 255, 255, 0.6);
      border-color: rgba(200, 190, 185, 0.6);
      background: rgba(255, 255, 255, 0.6);
      transform: translateY(-2px);
    }
    .kpi-l {
      font-size: 11px; color: #8b7a74; font-weight: 500;
      text-transform: uppercase; letter-spacing: .04em;
    }
    .kpi-v { font-size: 20px; font-weight: 550; line-height: 1.2; color: #2b2220; }

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
      border-radius: 12px;
      background: rgba(255, 255, 255, 0.48);
      backdrop-filter: blur(12px);
      -webkit-backdrop-filter: blur(12px);
      border: 1px solid rgba(255, 255, 255, 0.65);
      border-left: 3px solid rgba(200, 190, 185, 0.5);
      text-decoration: none;
      transition: box-shadow .25s, border-color .25s, transform .25s, background .25s;
      box-shadow:
        0 4px 16px rgba(75, 18, 56, 0.03),
        0 1px 4px rgba(0, 0, 0, 0.02),
        inset 0 1px 0 rgba(255, 255, 255, 0.5);
    }
    .hub-tile:hover {
      box-shadow:
        0 12px 36px rgba(75, 18, 56, 0.08),
        0 4px 12px rgba(0, 0, 0, 0.03),
        inset 0 1px 0 rgba(255, 255, 255, 0.6);
      border-color: rgba(200, 190, 185, 0.6);
      border-left-color: #8f5c54;
      background: rgba(255, 255, 255, 0.58);
      transform: translateY(-2px);
    }
    .hub-tile strong {
      font-size: 14px; font-weight: 600; color: #2b2220; line-height: 1.3;
    }
    .hub-tile .hub-sub {
      font-size: 12px; color: #6F778A; line-height: 1.35;
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
      width: 28px; height: 26px; border-radius: 6px;
      background: rgba(75, 18, 56, 0.08); color: #4B1238;
      font-size: 10px; font-weight: 700; letter-spacing: .03em;
      backdrop-filter: blur(4px);
      -webkit-backdrop-filter: blur(4px);
      border: 1px solid rgba(255, 255, 255, 0.3);
    }

    .bottom-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 16px;
    }

    .shortcut-grid {
      display: grid; grid-template-columns: 1fr 1fr; gap: 10px;
    }
    .shortcut {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 16px 14px;
      border-radius: 12px;
      background: rgba(255, 255, 255, 0.48);
      backdrop-filter: blur(12px);
      -webkit-backdrop-filter: blur(12px);
      border: 1px solid rgba(255, 255, 255, 0.65);
      border-left: 3px solid rgba(200, 190, 185, 0.5);
      text-decoration: none;
      transition: box-shadow .25s, border-color .25s, transform .25s, background .25s;
      box-shadow:
        0 4px 16px rgba(75, 18, 56, 0.03),
        0 1px 4px rgba(0, 0, 0, 0.02),
        inset 0 1px 0 rgba(255, 255, 255, 0.5);
    }
    .shortcut:hover {
      box-shadow:
        0 12px 36px rgba(75, 18, 56, 0.08),
        0 4px 12px rgba(0, 0, 0, 0.03),
        inset 0 1px 0 rgba(255, 255, 255, 0.6);
      border-color: rgba(200, 190, 185, 0.6);
      border-left-color: #8f5c54;
      background: rgba(255, 255, 255, 0.58);
      transform: translateY(-2px);
    }
    .shortcut strong {
      font-size: 13px; font-weight: 500; color: #2b2220;
    }
    .shortcut-i {
      display: inline-flex; align-items: center; justify-content: center;
      width: 28px; height: 26px; border-radius: 6px;
      background: rgba(75, 18, 56, 0.08); color: #4B1238;
      font-size: 9px; font-weight: 700; letter-spacing: .03em;
      flex-shrink: 0;
      backdrop-filter: blur(4px);
      -webkit-backdrop-filter: blur(4px);
      border: 1px solid rgba(255, 255, 255, 0.3);
    }

    .staff-card { padding: 0; margin-top: -4px; }
    .staff-row {
      display: flex; align-items: center; gap: 12px;
      padding: 14px 16px; border-radius: 12px;
      background: rgba(255, 255, 255, 0.48);
      backdrop-filter: blur(12px);
      -webkit-backdrop-filter: blur(12px);
      border: 1px solid rgba(255, 255, 255, 0.65);
      border-left: 3px solid #4B1238;
      box-shadow:
        0 4px 16px rgba(75, 18, 56, 0.03),
        0 1px 4px rgba(0, 0, 0, 0.02),
        inset 0 1px 0 rgba(255, 255, 255, 0.5);
    }
    .staff-rank {
      display: inline-flex; align-items: center; justify-content: center;
      width: 26px; height: 26px; border-radius: 50%;
      background: #4B1238; color: #fff;
      font-size: 11px; font-weight: 600; flex-shrink: 0;
      box-shadow: 0 2px 6px rgba(75, 18, 56, 0.15);
    }
    .staff-row div { display: flex; flex-direction: column; gap: 2px; }
    .staff-row strong { font-size: 13px; font-weight: 600; color: #2b2220; }
    .staff-row span { font-size: 12px; color: #6F778A; }

    .alert-card { padding: 0; margin-top: -4px; }
    .alert-row {
      padding: 14px 16px; border-radius: 12px;
      background: rgba(255, 255, 255, 0.48);
      backdrop-filter: blur(12px);
      -webkit-backdrop-filter: blur(12px);
      border: 1px solid rgba(255, 255, 255, 0.65);
      border-left: 3px solid #d97706;
      box-shadow:
        0 4px 16px rgba(75, 18, 56, 0.03),
        0 1px 4px rgba(0, 0, 0, 0.02),
        inset 0 1px 0 rgba(255, 255, 255, 0.5);
    }
    .alert-row div { display: flex; flex-direction: column; gap: 2px; }
    .alert-row strong { font-size: 13px; font-weight: 600; color: #2b2220; }
    .alert-row span { font-size: 12px; color: #6F778A; }
    .alert-empty {
      padding: 20px 16px; text-align: center;
      border-radius: 12px;
      background: rgba(255, 255, 255, 0.3);
      backdrop-filter: blur(8px);
      -webkit-backdrop-filter: blur(8px);
      border: 1px dashed rgba(255, 255, 255, 0.5);
      font-size: 12px; color: #b0a49c;
    }

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
      background: rgba(200, 190, 185, 0.5);
      margin: 0 4px;
      border-radius: 1px;
    }
    .step-dot {
      display: inline-block;
      width: 8px; height: 8px;
      border-radius: 50%;
      background: rgba(200, 190, 185, 0.6);
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
      .greeting { flex-direction: column; align-items: stretch; padding: 16px 16px 16px 28px; transform: none; }
      .greeting::after { left: 14px; top: 14px; bottom: 14px; }
      .greeting-copy { padding-left: 10px; transform: none; }
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

  constructor(private readonly api: ApiService, private readonly state: AppStateService, private readonly session: AuthSessionService) {}

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

  canAccessPath(path: string): boolean {
    const grants = Array.from(new Set([...staticGrantsForRole(this.state.userRole()), ...(this.session.currentUser()?.permissions || [])]));
    return grantsCanAccessPath(grants, path);
  }
}
