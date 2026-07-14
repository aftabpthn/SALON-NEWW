import { CommonModule, DecimalPipe } from '@angular/common';
import { Component, OnInit, computed, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ApiRecord, ApiService } from '../core/api.service';
import { grantsCanAccessPath } from '../core/access-rules';
import { AuthSessionService } from '../core/auth-session.service';
import { staticGrantsForRole } from '../core/permission.guard';
import { AppStateService } from '../core/state/app-state.service';
import { StateComponent } from '../shared/ui/state/state.component';
import { AuraMoneyPipe } from '../shared/pipes/aura-money.pipe';

type AppTone = 'teal' | 'blue' | 'amber' | 'green' | 'red' | 'violet' | 'neutral';

type SuiteApp = {
  path: string;
  label: string;
  description: string;
  icon: string;
  tone: AppTone;
  status: 'Live' | 'Ready' | 'AI' | 'Admin';
  tags: string[];
};

type SuiteGroup = {
  id: string;
  label: string;
  subtitle?: string;
  apps: SuiteApp[];
};

type DashboardReport = {
  revenueToday: number;
  revenueMonth: number;
  totalBookings: number;
  newClients: number;
  pendingPayments: number;
  receivedDue: number;
  repeatCustomerRate: number;
  lowStockAlerts: ApiRecord[];
  staffPerformance: ApiRecord[];
};

const SUITE_GROUPS: SuiteGroup[] = [
  {
    id: 'command',
    label: 'Command OS',
    apps: [
      { path: '/dashboard', label: 'Live Dashboard', description: 'Revenue, bookings, dues, stock alerts and staff performance in one branch-aware view.', icon: 'DB', tone: 'teal', status: 'Live', tags: ['dashboard', 'kpi', 'owner'] },
      { path: '/dashboard/executive', label: 'Executive Dashboard', description: 'Board-level metrics for revenue, performance, branches and operating health.', icon: 'EX', tone: 'blue', status: 'Ready', tags: ['executive', 'analytics'] },
      { path: '/command-center', label: 'Command Center', description: 'Owner controls, daily actions and approval queues.', icon: 'AI', tone: 'violet', status: 'AI', tags: ['ai', 'command', 'automation'] },
      { path: '/command-center/engagement', label: 'Engagement', description: 'Client conversations, follow-ups and engagement activity.', icon: 'EC', tone: 'green', status: 'Ready', tags: ['engagement', 'whatsapp'] },
      { path: '/analytics', label: 'Advanced Analytics', description: 'Deep revenue, retention, staff productivity and branch comparison analytics.', icon: 'AN', tone: 'blue', status: 'Ready', tags: ['analytics', 'reports'] },
      { path: '/reports', label: 'Reports Center', description: 'Operational reports for sales, staff, inventory, commission and account ledgers.', icon: 'RP', tone: 'neutral', status: 'Ready', tags: ['reports', 'export'] },
      { path: '/reports/invoices', label: 'Invoice Reports', description: 'Invoice, GST, discount, product, membership, wallet and due audit reporting.', icon: 'IR', tone: 'neutral', status: 'Ready', tags: ['invoice', 'audit'] },
      { path: '/kpi-monitoring', label: 'KPI Monitoring', description: 'Target tracking for utilization, repeat rate, conversion and revenue alerts.', icon: 'KM', tone: 'amber', status: 'Ready', tags: ['kpi', 'alerts'] },
      { path: '/data-warehouse', label: 'Warehouse', description: 'Historical snapshots, facts and dimensions for reporting-ready business data.', icon: 'DW', tone: 'blue', status: 'Ready', tags: ['data', 'warehouse'] },
      { path: '/predictive-forecasting', label: 'Forecasting', description: 'Revenue, inventory and demand forecasts by branch.', icon: 'PF', tone: 'violet', status: 'AI', tags: ['forecast', 'ai'] }
    ]
  },
  {
    id: 'frontdesk',
    label: 'Front Desk OS',
    apps: [
      { path: '/appointments', label: 'Appointment Calendar', description: 'Create, move, complete and monitor front-desk appointments.', icon: 'CA', tone: 'teal', status: 'Live', tags: ['appointments', 'calendar'] },
      { path: '/appointments-enterprise', label: 'Enterprise Scheduler', description: 'Multi-staff and multi-service scheduling with resource-aware operations.', icon: 'ES', tone: 'blue', status: 'Ready', tags: ['scheduler', 'resources'] },
      { path: '/appointment-activity', label: 'Activity Center', description: 'Appointment lifecycle, cancellations, no-shows, reschedules and reliability audit.', icon: 'AC', tone: 'amber', status: 'Ready', tags: ['audit', 'appointments'] },
      { path: '/smart-booking', label: 'Smart Booking', description: 'Booking workflow, slot logic and conversion tracking.', icon: 'SB', tone: 'violet', status: 'AI', tags: ['booking', 'ai'] },
      { path: '/book', label: 'Online Booking Site', description: 'Public guest booking experience for service discovery and appointment requests.', icon: 'OB', tone: 'green', status: 'Live', tags: ['online', 'guest'] },
      { path: '/clients', label: 'Client CRM', description: 'Guest records, visit history, preferences, notes and salon relationship data.', icon: 'CL', tone: 'teal', status: 'Live', tags: ['crm', 'guest'] },
      { path: '/customer-360', label: 'Customer Profile', description: 'Lifetime value, visit history, retention and next actions.', icon: 'CI', tone: 'violet', status: 'AI', tags: ['customer', 'ai'] },
      { path: '/queue-system', label: 'Smart Queue', description: 'Walk-in queue displays, live tokens and branch floor flow.', icon: 'QU', tone: 'amber', status: 'Ready', tags: ['queue', 'walkin'] }
    ]
  },
  {
    id: 'pos',
    label: 'POS & Billing',
    apps: [
      { path: '/pos', label: 'Fast POS', description: 'Service and product checkout with payments, discounts and invoice flow.', icon: 'POS', tone: 'green', status: 'Live', tags: ['pos', 'billing'] },
      { path: '/billing', label: 'Billing Center', description: 'Invoice list, reconciliation, refunds and closing workflows.', icon: 'BI', tone: 'blue', status: 'Ready', tags: ['billing', 'refunds'] },
      { path: '/pos/invoices', label: 'POS Invoices', description: 'Search invoices, due balances, collections, receipt status and bill activity.', icon: 'IN', tone: 'neutral', status: 'Live', tags: ['invoice', 'payment'] },
      { path: '/pos/holds', label: 'Held Invoices', description: 'Parked bills and interrupted checkout recovery for busy counters.', icon: 'HI', tone: 'amber', status: 'Ready', tags: ['holds', 'checkout'] },
      { path: '/pos/payment-modes', label: 'Payment Modes', description: 'Cash, card, UPI, gateway and branch payment configuration.', icon: 'PM', tone: 'teal', status: 'Admin', tags: ['payment', 'settings'] },
      { path: '/memberships', label: 'Memberships', description: 'Membership selling, renewal, redemption, wallet and loyalty programs.', icon: 'MB', tone: 'violet', status: 'Live', tags: ['membership', 'loyalty'] },
      { path: '/packages', label: 'Service Packages', description: 'Prepaid bundles, service credits, validity and package rules.', icon: 'PK', tone: 'blue', status: 'Ready', tags: ['packages', 'credits'] },
      { path: '/pos/tips', label: 'Tip Register', description: 'Staff tips, payout visibility and POS-linked tip tracking.', icon: 'TP', tone: 'green', status: 'Ready', tags: ['tips', 'staff'] }
    ]
  },
  {
    id: 'inventory',
    label: 'Inventory & Suppliers',
    apps: [
      { path: '/inventory', label: 'Products & Inventory', description: 'Product master, stock, low-stock alerts, valuation and movement visibility.', icon: 'IV', tone: 'teal', status: 'Live', tags: ['inventory', 'products'] },
      { path: '/inventory/purchase-bill-drafts', label: 'Bill Drafts', description: 'Review purchase bill drafts before stock confirmation.', icon: 'AI', tone: 'violet', status: 'AI', tags: ['purchase', 'ocr', 'draft'] },
      { path: '/inventory/purchase-orders', label: 'Purchase Orders', description: 'Supplier purchase orders, receiving and procurement tracking.', icon: 'PO', tone: 'blue', status: 'Ready', tags: ['purchase', 'supplier'] },
      { path: '/suppliers', label: 'Suppliers', description: 'Vendor profiles, GST details, purchasing contact and supplier health.', icon: 'SP', tone: 'neutral', status: 'Ready', tags: ['vendor', 'supplier'] },
      { path: '/inventory/recipes', label: 'Service Recipes', description: 'Service consumption recipes for internal product deduction and costing.', icon: 'RC', tone: 'green', status: 'Ready', tags: ['bom', 'services'] },
      { path: '/inventory/stock-audit', label: 'Stock Audit', description: 'Branch stock counts, variance review and inventory controls.', icon: 'SA', tone: 'amber', status: 'Ready', tags: ['audit', 'stock'] },
      { path: '/inventory/scanner', label: 'Scanner', description: 'Barcode-ready inventory intake and product lookup workflow.', icon: 'QR', tone: 'blue', status: 'Ready', tags: ['barcode', 'scanner'] },
      { path: '/services', label: 'Services Catalog', description: 'Service menu, pricing, duration, GST, staff assignment and product usage.', icon: 'SV', tone: 'teal', status: 'Admin', tags: ['services', 'catalog'] }
    ]
  },
  {
    id: 'staff',
    label: 'Staff & Payroll',
    apps: [
      { path: '/staff-os/employee-masters', label: 'Staff OS', description: 'Employee master, attendance, payroll and lifecycle actions.', icon: 'SO', tone: 'blue', status: 'Ready', tags: ['staff', 'payroll'] },
      { path: '/staff-os/staff-list', label: 'Staff Directory', description: 'Active team, staff categories, documents and operational staff controls.', icon: 'ST', tone: 'teal', status: 'Live', tags: ['staff', 'employee'] },
      { path: '/staff-os/employee-masters', label: 'Salary Setup', description: 'Salary setup is now merged into Employee Masters payroll flow.', icon: 'SW', tone: 'violet', status: 'Ready', tags: ['hr', 'enterprise'] },
      { path: '/staff/my-work', label: 'My Work', description: 'Staff self-service view for appointments, work summary and own performance.', icon: 'MW', tone: 'green', status: 'Live', tags: ['staff', 'self'] },
      { path: '/staff-os/attendance-dashboard', label: 'Attendance Dashboard', description: 'Present, absent, late, shift and biometric attendance visibility.', icon: 'AD', tone: 'amber', status: 'Ready', tags: ['attendance'] },
      { path: '/staff-os/payroll-dashboard', label: 'Payroll Dashboard', description: 'Salary, deductions, statutory values and payroll export controls.', icon: 'PD', tone: 'blue', status: 'Ready', tags: ['payroll'] },
      { path: '/commissions', label: 'Commission Rules', description: 'Persisted commission policies used by payroll and staff incentives.', icon: 'CM', tone: 'green', status: 'Admin', tags: ['commission'] },
      { path: '/reports/staff-sales', label: 'Staff Sales', description: 'Staff-wise sales, service revenue, tips and performance report.', icon: 'SR', tone: 'neutral', status: 'Ready', tags: ['report', 'sales'] }
    ]
  },
  {
    id: 'finance',
    label: 'Finance & Compliance',
    apps: [
      { path: '/finance', label: 'Finance', description: 'Cash flow, expenses, margin and finance workflows.', icon: 'FN', tone: 'blue', status: 'Ready', tags: ['finance'] },
      { path: '/account-master', label: 'Account Master', description: 'Chart of accounts and ledger-ready financial master records.', icon: 'AM', tone: 'neutral', status: 'Admin', tags: ['accounts'] },
      { path: '/reports/account-ledger', label: 'Account Ledger', description: 'Ledger report for account movement and reconciled finance visibility.', icon: 'AL', tone: 'teal', status: 'Ready', tags: ['ledger', 'report'] },
      { path: '/transactions/outgoing-funds', label: 'Outgoing Funds', description: 'Vendor, expense, payout and cash-out transaction entry.', icon: 'OF', tone: 'amber', status: 'Ready', tags: ['expense', 'transactions'] },
      { path: '/compliance', label: 'Statutory Compliance', description: 'PF, ESI, PT, TDS, bonus, gratuity, LWF and FY compliance cockpit.', icon: 'SC', tone: 'red', status: 'Ready', tags: ['compliance', 'india'] },
      { path: '/audit-compliance', label: 'Audit Compliance', description: 'Audit readiness and compliance controls for enterprise operations.', icon: 'AU', tone: 'red', status: 'Ready', tags: ['audit'] }
    ]
  },
  {
    id: 'growth',
    label: 'Growth, WhatsApp & AI',
    apps: [
      { path: '/marketing', label: 'Marketing', description: 'Campaigns, win-back, upsell, retention and client segments.', icon: 'MK', tone: 'violet', status: 'AI', tags: ['marketing', 'ai'] },
      { path: '/growth-rank-bot', label: 'AI Rank Bot', description: 'Instagram, Facebook and Google rank-readiness audits with ethical local SEO, content and review workflows.', icon: 'RB', tone: 'violet', status: 'AI', tags: ['rank', 'google', 'instagram'] },
      { path: '/whatsapp', label: 'WhatsApp Automation', description: 'Reminders, renewals, templates, payment links and provider-ready messaging.', icon: 'WA', tone: 'green', status: 'Ready', tags: ['whatsapp'] },
      { path: '/engagement', label: 'Engagement Center', description: 'Client messages, actions and journeys.', icon: 'EC', tone: 'blue', status: 'Ready', tags: ['engagement'] },
      { path: '/message-logs', label: 'Message Logs', description: 'SMS, email and WhatsApp delivery tracking with provider payloads.', icon: 'ML', tone: 'neutral', status: 'Ready', tags: ['messages'] },
      { path: '/reputation', label: 'Reputation', description: 'Review inbox, response drafting, alerts and reputation operations.', icon: 'RV', tone: 'amber', status: 'AI', tags: ['reviews'] },
      { path: '/growth-advisor', label: 'Growth Advisor', description: 'Revenue growth tasks, missed opportunities and action plans.', icon: 'GA', tone: 'violet', status: 'AI', tags: ['growth'] },
      { path: '/recommendation-engine', label: 'Recommendations', description: 'Next service, product and booking suggestions.', icon: 'RE', tone: 'violet', status: 'AI', tags: ['recommendation'] },
      { path: '/voice-receptionist', label: 'Voice Receptionist', description: 'Call transcript, multilingual intent, callback and booking action records.', icon: 'VR', tone: 'blue', status: 'AI', tags: ['voice'] }
    ]
  },
  {
    id: 'platform',
    label: 'SaaS Platform',
    apps: [
      { path: '/super-admin', label: 'Super Admin', description: 'Tenant-level SaaS administration, platform controls and global visibility.', icon: 'SA', tone: 'red', status: 'Admin', tags: ['saas', 'admin'] },
      { path: '/saas', label: 'SaaS Onboarding', description: 'Tenant onboarding, branch readiness and subscription operating controls.', icon: 'SX', tone: 'blue', status: 'Admin', tags: ['tenant'] },
      { path: '/branches', label: 'Multi-Branch', description: 'Branch profiles, GSTIN, address, status and branch-level operations.', icon: 'BR', tone: 'teal', status: 'Admin', tags: ['branch'] },
      { path: '/permissions', label: 'Permissions', description: 'Role and permission matrix for access control.', icon: 'PM', tone: 'red', status: 'Admin', tags: ['rbac'] },
      { path: '/security', label: 'Security Layer', description: 'Security controls, audit posture, sessions and hardening readiness.', icon: 'SL', tone: 'red', status: 'Admin', tags: ['security'] },
      { path: '/offline', label: 'Offline Support', description: 'Offline POS and booking sync readiness with conflict-aware workflows.', icon: 'OF', tone: 'amber', status: 'Ready', tags: ['offline'] },
      { path: '/developer-api', label: 'Developer API', description: 'API key records, scopes, rate limits and partner access readiness.', icon: 'API', tone: 'blue', status: 'Admin', tags: ['api'] },
      { path: '/app-marketplace', label: 'App Marketplace', description: 'Installable apps, connector listings, providers and marketplace readiness.', icon: 'MP', tone: 'violet', status: 'Ready', tags: ['marketplace'] }
    ]
  }
];

@Component({
  selector: 'app-apps-launchpad',
  standalone: true,
  imports: [AuraMoneyPipe, CommonModule, DecimalPipe, FormsModule, RouterLink, StateComponent],
  template: `
    <section class="apps-shell">
      <header class="lp-header">
        <div>
          <h2>All Apps</h2>
        </div>
        <div class="header-actions">
          <a class="btn-ghost" routerLink="/dashboard/executive" *ngIf="canAccessPath('/dashboard/executive')">Executive</a>
          <a class="btn-primary" routerLink="/appointments" *ngIf="canAccessPath('/appointments')">New booking</a>
          <a class="btn-primary" routerLink="/pos" *ngIf="canAccessPath('/pos')">Fast POS</a>
        </div>
      </header>

      <app-state [loading]="loading()" loadingText="Loading suite signal" [error]="error()"></app-state>

      <div class="lp-signals" *ngIf="report() as data" aria-label="Live suite signals">
        <article class="lp-signal">
          <span class="ls-l">Today</span>
          <strong class="ls-v">{{ data.revenueToday | auraMoney:'1.0-0' }}</strong>
          <small>{{ data.totalBookings | number }} bookings tracked</small>
        </article>
        <article class="lp-signal">
          <span class="ls-l">Month</span>
          <strong class="ls-v">{{ data.revenueMonth | auraMoney:'1.0-0' }}</strong>
          <small>{{ data.repeatCustomerRate | number: '1.0-0' }}% repeat rate</small>
        </article>
        <article class="lp-signal">
          <span class="ls-l">Cash control</span>
          <strong class="ls-v">{{ data.pendingPayments | auraMoney:'1.0-0' }}</strong>
          <small>{{ data.receivedDue | auraMoney:'1.0-0' }} received due</small>
        </article>
        <article class="lp-signal">
          <span class="ls-l">Suite coverage</span>
          <strong class="ls-v">{{ totalApps() }}</strong>
          <small>{{ aiApps() }} AI apps · {{ adminApps() }} admin controls</small>
        </article>
      </div>

      <div class="lp-toolbar" aria-label="App filters">
        <label class="lp-search">
          <span>Search</span>
          <input type="search" [ngModel]="query()" (ngModelChange)="query.set($event)" placeholder="Find POS, staff, WhatsApp, reports" />
        </label>
        <div class="lp-tabs">
          <button type="button" [class.active]="selectedGroup() === 'all'" (click)="selectedGroup.set('all')">All</button>
          <button type="button" *ngFor="let group of visibleSuiteGroups()" [class.active]="selectedGroup() === group.id" (click)="selectedGroup.set(group.id)">
            {{ group.label }}
          </button>
        </div>
      </div>

      <div class="lp-empty" *ngIf="!filteredGroups().length">
        <strong>No apps found</strong>
        <button class="btn-ghost" type="button" (click)="resetFilters()">Reset</button>
      </div>

      <section class="lp-section" *ngFor="let group of filteredGroups(); trackBy: trackGroup">
        <div class="lp-group-h">
          <span class="lp-count">{{ group.apps.length }} apps</span>
          <h3>{{ group.label }}</h3>
        </div>

        <div class="lp-grid">
          <a
            *ngFor="let app of group.apps; trackBy: trackApp"
            [class]="'lp-app tone-' + app.tone"
            [routerLink]="app.path"
          >
            <span class="lp-icon">{{ app.icon }}</span>
            <strong>{{ app.label }}</strong>
            <small>{{ app.description }}</small>
            <span class="lp-tags">{{ app.tags.join(' · ') }}</span>
            <span class="lp-badge">{{ app.status }}</span>
          </a>
        </div>
      </section>
    </section>
  `,
  styles: [`
    :host { display: contents; }

    :host .apps-shell {
      display: flex;
      flex-direction: column;
      gap: 18px;
      padding: 24px 32px 40px;
      background: #f8f5f2;
      min-height: 100vh;
      perspective: 1200px;
    }

    :host .btn-ghost {
      display: inline-flex; align-items: center;
      height: 30px; padding: 0 12px; border-radius: 6px;
      font-size: 12px; font-weight: 500; color: #6b7280;
      background: rgba(255,255,255,.78); border: 1px solid #e5e0db;
      text-decoration: none; cursor: pointer;
      transition: background .15s, color .15s, transform .2s ease, box-shadow .2s ease, border-color .2s ease;
      backdrop-filter: blur(10px);
      -webkit-backdrop-filter: blur(10px);
    }
    :host .btn-ghost:hover,
    :host .btn-ghost:focus-visible {
      background: #f5f2ef; color: #1a1a1a;
      box-shadow: 0 8px 18px rgba(75,18,56,.08), inset 0 1px 0 rgba(255,255,255,.6);
      transform: translateY(-1px);
    }
    :host .btn-primary {
      display: inline-flex; align-items: center;
      height: 30px; padding: 0 14px; border-radius: 6px;
      font-size: 12px; font-weight: 500; color: #fff;
      background: #4B1238; border: 0;
      text-decoration: none; cursor: pointer;
      transition: background .15s, transform .2s ease, box-shadow .2s ease;
    }
    :host .btn-primary:hover,
    :host .btn-primary:focus-visible {
      background: #3d0e2e;
      box-shadow: 0 10px 22px rgba(75,18,56,.18), inset 0 1px 0 rgba(255,255,255,.22);
      transform: translateY(-1px);
    }

    :host .lp-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 18px;
      padding: 16px 24px;
      background: rgba(255,255,255,.74);
      border: 1px solid #ede8e3;
      border-radius: 10px;
      box-shadow: 0 16px 34px rgba(75,18,56,.08), 0 4px 12px rgba(0,0,0,.035), inset 0 1px 0 rgba(255,255,255,.6);
      transform: translateZ(0);
      transition: transform .2s ease, box-shadow .2s ease, border-color .2s ease;
      backdrop-filter: blur(12px);
      -webkit-backdrop-filter: blur(12px);
    }
    :host .lp-header h2 {
      margin: 0;
      font-size: 18px; font-weight: 600; color: #2b2220;
    }
    :host .header-actions { display: flex; gap: 8px; flex-wrap: wrap; }

    :host .lp-signals {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 12px;
    }
    :host .lp-signal {
      display: flex; flex-direction: column; gap: 5px;
      padding: 18px 18px 16px; border-radius: 8px;
      background: rgba(255,255,255,.72); border: 1px solid #ede8e3;
      border-left: 3px solid #4B1238;
      box-shadow: 0 14px 30px rgba(75,18,56,.075), 0 3px 10px rgba(0,0,0,.03), inset 0 1px 0 rgba(255,255,255,.6);
      transform: translateZ(0);
      transition: transform .2s ease, box-shadow .2s ease, border-color .2s ease;
      will-change: transform;
      backdrop-filter: blur(12px);
      -webkit-backdrop-filter: blur(12px);
    }
    :host .lp-signal:hover {
      box-shadow: 0 20px 42px rgba(75,18,56,.11), 0 6px 16px rgba(0,0,0,.04), inset 0 1px 0 rgba(255,255,255,.66);
      transform: translateY(-2px) rotateX(.6deg);
    }
    :host .ls-l {
      font-size: 11px; font-weight: 500; color: #8b7a74;
      text-transform: uppercase; letter-spacing: .05em;
    }
    :host .ls-v {
      font-size: 20px; font-weight: 550; color: #2b2220; line-height: 1.2;
    }
    :host .lp-signal small { font-size: 12px; color: #b0a49c; margin-top: 1px; }

    :host .lp-toolbar {
      display: flex;
      align-items: center;
      gap: 20px;
      padding: 14px 20px;
      background: rgba(255,255,255,.74);
      border: 1px solid #ede8e3;
      border-radius: 10px;
      box-shadow: 0 16px 34px rgba(75,18,56,.075), 0 4px 12px rgba(0,0,0,.03), inset 0 1px 0 rgba(255,255,255,.6);
      transform: translateZ(0);
      transition: transform .2s ease, box-shadow .2s ease, border-color .2s ease;
      backdrop-filter: blur(12px);
      -webkit-backdrop-filter: blur(12px);
    }
    :host .lp-search {
      display: flex;
      align-items: center;
      gap: 10px;
      min-width: 0;
      flex-shrink: 0;
    }
    :host .lp-search span {
      font-size: 12px; font-weight: 500; color: #8b7a74;
      white-space: nowrap;
    }
    :host .lp-search input {
      height: 36px; padding: 0 14px; border-radius: 6px;
      border: 1px solid #e5e0db; background: rgba(250,249,247,.82);
      font-size: 13px; color: #1a1a1a; width: 220px;
      outline: none; transition: border-color .15s, background .15s, box-shadow .2s ease, transform .2s ease;
      backdrop-filter: blur(8px);
      -webkit-backdrop-filter: blur(8px);
    }
    :host .lp-search input:focus {
      border-color: #8f5c54; background: #fff;
      box-shadow: 0 8px 18px rgba(75,18,56,.08), inset 0 1px 0 rgba(255,255,255,.6);
      transform: translateY(-1px);
    }

    :host .lp-tabs {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      margin-left: auto;
    }
    :host .lp-tabs button {
      height: 32px; padding: 0 14px; border-radius: 6px;
      border: 1px solid #ede8e3; background: rgba(255,255,255,.78);
      font-size: 12px; font-weight: 500; color: #6F778A;
      cursor: pointer; transition: background .15s, color .15s, border-color .15s, transform .2s ease, box-shadow .2s ease;
      font-family: inherit;
      backdrop-filter: blur(8px);
      -webkit-backdrop-filter: blur(8px);
    }
    :host .lp-tabs button:hover,
    :host .lp-tabs button:focus-visible {
      background: #f5f2ef; border-color: #d5cec7; color: #2b2220;
      box-shadow: 0 8px 18px rgba(75,18,56,.07), inset 0 1px 0 rgba(255,255,255,.6);
      transform: translateY(-1px);
    }
    :host .lp-tabs button.active {
      background: #4B1238; border-color: #4B1238; color: #fff;
    }

    :host .lp-empty {
      min-height: 80px;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 12px;
      border: 1px dashed #e5e0db;
      border-radius: 8px;
      background: #fff;
    }
    :host .lp-empty strong { font-size: 13px; font-weight: 500; color: #8b7a74; }

    :host .lp-section {
      display: flex;
      flex-direction: column;
      gap: 14px;
      padding: 18px 20px 20px;
      background: rgba(255,255,255,.74);
      border: 1px solid #ede8e3;
      border-radius: 10px;
      box-shadow: 0 18px 38px rgba(75,18,56,.075), 0 4px 12px rgba(0,0,0,.03), inset 0 1px 0 rgba(255,255,255,.6);
      transform: translateZ(0);
      transition: transform .2s ease, box-shadow .2s ease, border-color .2s ease;
      backdrop-filter: blur(12px);
      -webkit-backdrop-filter: blur(12px);
    }
    :host .lp-group-h {
      display: flex; align-items: center; gap: 10px;
      padding-bottom: 12px;
      border-bottom: 1px solid #f0ece8;
    }
    :host .lp-count {
      font-size: 11px; font-weight: 500; color: #c0b4ac;
      text-transform: uppercase; letter-spacing: .05em;
      font-feature-settings: "tnum";
    }
    :host .lp-group-h h3 {
      margin: 0;
      font-size: 15px; font-weight: 600; color: #2b2220;
    }

    :host .lp-grid {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 10px;
    }
    :host .lp-app {
      display: flex;
      flex-direction: column;
      gap: 5px;
      padding: 16px;
      border: 1px solid #ede8e3;
      border-left: 3px solid #4B1238;
      border-radius: 8px;
      background: rgba(255,255,255,.70);
      text-decoration: none;
      transition: box-shadow .2s ease, border-color .2s ease, transform .2s ease;
      box-shadow: 0 12px 26px rgba(75,18,56,.065), 0 3px 10px rgba(0,0,0,.025), inset 0 1px 0 rgba(255,255,255,.6);
      transform: translateZ(0);
      will-change: transform;
      backdrop-filter: blur(12px);
      -webkit-backdrop-filter: blur(12px);
    }
    :host .lp-app:hover {
      box-shadow: 0 22px 46px rgba(75,18,56,.12), 0 8px 18px rgba(0,0,0,.04), inset 0 1px 0 rgba(255,255,255,.68);
      border-color: #d5cec7;
      transform: translateY(-2px) rotateX(.7deg) rotateY(-.45deg);
      background: rgba(255,255,255,.82);
    }
    :host .lp-app strong {
      font-size: 13px; font-weight: 600; color: #2b2220;
      line-height: 1.3; margin-top: 1px;
    }
    :host .lp-app small {
      font-size: 12px; color: #6F778A; line-height: 1.4;
    }
    :host .lp-icon {
      display: inline-flex; align-items: center; justify-content: center;
      width: 28px; height: 26px; border-radius: 5px;
      background: #4B1238; color: #fff;
      font-size: 10px; font-weight: 700;
      margin-bottom: 2px;
    }
    :host .lp-tags {
      font-size: 10px; color: #b0a49c; font-weight: 500;
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
      margin-top: auto;
    }
    :host .lp-badge {
      align-self: flex-start;
      height: 20px; padding: 0 8px; border-radius: 999px;
      display: inline-flex; align-items: center;
      font-size: 10px; font-weight: 500; color: #6b5e58;
      background: #f2edeb;
      margin-top: 6px;
    }

    :host .tone-blue .lp-icon { background: #4B1238; }
    :host .tone-amber .lp-icon { background: #d97706; }
    :host .tone-green .lp-icon { background: #C87D4B; }
    :host .tone-red .lp-icon { background: #dc2626; }
    :host .tone-violet .lp-icon { background: #7c3aed; }
    :host .tone-neutral .lp-icon { background: #9ca3af; }

    @media (max-width: 1280px) {
      :host .lp-grid { grid-template-columns: repeat(3, 1fr); }
      :host .lp-signals { grid-template-columns: repeat(2, 1fr); }
    }

    @media (max-width: 880px) {
      :host .lp-header,
      :host .lp-toolbar { flex-direction: column; align-items: stretch; }
      :host .lp-toolbar { gap: 12px; }
      :host .lp-tabs { margin-left: 0; }
      :host .header-actions { justify-content: flex-start; }
    }

    @media (max-width: 680px) {
      :host .lp-grid { grid-template-columns: 1fr; }
      :host .lp-signals { grid-template-columns: 1fr; }
    }
  `]
})
export class AppsLaunchpadComponent implements OnInit {
  readonly suiteGroups = SUITE_GROUPS;
  readonly query = signal('');
  readonly selectedGroup = signal('all');
  readonly report = signal<DashboardReport | null>(null);
  readonly loading = signal(true);
  readonly error = signal('');

  readonly visibleSuiteGroups = computed(() => this.suiteGroups
    .map((group) => ({ ...group, apps: group.apps.filter((app) => this.canAccessPath(app.path)) }))
    .filter((group) => group.apps.length));

  readonly filteredGroups = computed(() => {
    const selected = this.selectedGroup();
    const term = this.query().trim().toLowerCase();
    return this.visibleSuiteGroups()
      .filter((group) => selected === 'all' || group.id === selected)
      .map((group) => ({
        ...group,
        apps: term ? group.apps.filter((app) => this.appText(app, group).includes(term)) : group.apps
      }))
      .filter((group) => group.apps.length);
  });

  readonly totalApps = computed(() => this.visibleSuiteGroups().reduce((count, group) => count + group.apps.length, 0));
  readonly aiApps = computed(() => this.visibleSuiteGroups().flatMap((group) => group.apps).filter((app) => app.status === 'AI').length);
  readonly adminApps = computed(() => this.visibleSuiteGroups().flatMap((group) => group.apps).filter((app) => app.status === 'Admin').length);

  constructor(private readonly api: ApiService, private readonly state: AppStateService, private readonly session: AuthSessionService) {}

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
        this.error.set(this.api.errorText(error, 'Unable to load suite signals'));
        this.loading.set(false);
      }
    });
  }

  resetFilters(): void {
    this.query.set('');
    this.selectedGroup.set('all');
  }

  trackGroup(_index: number, group: SuiteGroup): string {
    return group.id;
  }

  trackApp(_index: number, app: SuiteApp): string {
    return app.path;
  }

  private normalizeReport(report: ApiRecord = {}): DashboardReport {
    return {
      revenueToday: Number(report['revenueToday'] || 0),
      revenueMonth: Number(report['revenueMonth'] || 0),
      totalBookings: Number(report['totalBookings'] || 0),
      newClients: Number(report['newClients'] || 0),
      pendingPayments: Number(report['pendingPayments'] || 0),
      receivedDue: Number(report['receivedDue'] || 0),
      repeatCustomerRate: Number(report['repeatCustomerRate'] || 0),
      lowStockAlerts: Array.isArray(report['lowStockAlerts']) ? report['lowStockAlerts'] : [],
      staffPerformance: Array.isArray(report['staffPerformance']) ? report['staffPerformance'] : []
    };
  }

  private appText(app: SuiteApp, group: SuiteGroup): string {
    return `${group.label} ${group.subtitle} ${app.label} ${app.description} ${app.path} ${app.tags.join(' ')}`.toLowerCase();
  }

  canAccessPath(path: string): boolean {
    const grants = Array.from(new Set([...staticGrantsForRole(this.state.userRole()), ...(this.session.currentUser()?.permissions || [])]));
    return grantsCanAccessPath(grants, path);
  }
}
