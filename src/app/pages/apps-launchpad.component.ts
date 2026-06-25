import { CommonModule, CurrencyPipe, DecimalPipe } from '@angular/common';
import { Component, OnInit, computed, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ApiRecord, ApiService } from '../core/api.service';
import { StateComponent } from '../shared/ui/state/state.component';

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
  subtitle: string;
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
    subtitle: 'Owner, executive, KPI and multi-branch control rooms.',
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
    subtitle: 'Appointments, guests, queue, booking site and client records.',
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
    subtitle: 'Checkout, invoices, payments, memberships, packages and daily cash control.',
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
    subtitle: 'Products, suppliers, purchase orders, stock audit and recipes.',
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
    subtitle: 'Employee master, attendance, roster, payroll, commission and performance.',
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
    subtitle: 'Ledgers, outgoing funds, GST, statutory compliance and controls.',
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
    subtitle: 'Marketing, reputation, recommendations, WhatsApp and salon automation.',
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
    subtitle: 'Tenant, branch, RBAC, security, offline, developer API and marketplace.',
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
  imports: [CommonModule, CurrencyPipe, DecimalPipe, FormsModule, RouterLink, StateComponent],
  template: `
    <section class="apps-shell">
      <header class="apps-header">
        <div>
          <span class="eyebrow">AuraShine full suite</span>
          <h2>All Apps</h2>
          <p>One place for salon CRM, booking, POS, inventory, staff, finance, WhatsApp and admin tools.</p>
        </div>
        <div class="header-actions">
          <a class="ghost-button" routerLink="/dashboard/executive">Executive</a>
          <a class="primary-button" routerLink="/appointments">New booking</a>
          <a class="dark-button" routerLink="/pos">Fast POS</a>
        </div>
      </header>

      <app-state [loading]="loading()" loadingText="Loading suite signal" [error]="error()"></app-state>

      <section class="suite-signal-grid" *ngIf="report() as data" aria-label="Live suite signals">
        <article class="signal-tile">
          <span>Today</span>
          <strong>{{ data.revenueToday | currency: 'INR':'symbol':'1.0-0' }}</strong>
          <small>{{ data.totalBookings | number }} bookings tracked</small>
        </article>
        <article class="signal-tile">
          <span>Month</span>
          <strong>{{ data.revenueMonth | currency: 'INR':'symbol':'1.0-0' }}</strong>
          <small>{{ data.repeatCustomerRate | number: '1.0-0' }}% repeat rate</small>
        </article>
        <article class="signal-tile">
          <span>Cash control</span>
          <strong>{{ data.pendingPayments | currency: 'INR':'symbol':'1.0-0' }}</strong>
          <small>{{ data.receivedDue | currency: 'INR':'symbol':'1.0-0' }} received due</small>
        </article>
        <article class="signal-tile">
          <span>Suite coverage</span>
          <strong>{{ totalApps }}</strong>
          <small>{{ aiApps }} AI apps · {{ adminApps }} admin controls</small>
        </article>
      </section>

      <section class="suite-toolbar" aria-label="App filters">
        <label class="suite-search">
          <span>Search</span>
          <input type="search" [ngModel]="query()" (ngModelChange)="query.set($event)" placeholder="Find POS, staff, WhatsApp, reports" />
        </label>
        <div class="suite-tabs">
          <button type="button" [class.active]="selectedGroup() === 'all'" (click)="selectedGroup.set('all')">All</button>
          <button type="button" *ngFor="let group of suiteGroups" [class.active]="selectedGroup() === group.id" (click)="selectedGroup.set(group.id)">
            {{ group.label }}
          </button>
        </div>
      </section>

      <section class="apps-empty" *ngIf="!filteredGroups().length">
        <strong>No apps found</strong>
        <button class="ghost-button mini" type="button" (click)="resetFilters()">Reset</button>
      </section>

      <section class="suite-group" *ngFor="let group of filteredGroups(); trackBy: trackGroup">
        <div class="suite-group-title">
          <div>
            <span class="eyebrow">{{ group.apps.length }} apps</span>
            <h3>{{ group.label }}</h3>
            <p>{{ group.subtitle }}</p>
          </div>
        </div>

        <div class="apps-grid">
          <a
            class="app-card"
            *ngFor="let app of group.apps; trackBy: trackApp"
            [class]="'app-card tone-' + app.tone"
            [routerLink]="app.path"
          >
            <span class="app-icon">{{ app.icon }}</span>
            <span class="status-pill">{{ app.status }}</span>
            <strong>{{ app.label }}</strong>
            <small>{{ app.description }}</small>
            <span class="app-tags">{{ app.tags.join(' · ') }}</span>
          </a>
        </div>
      </section>
    </section>
  `,
  styles: [`
    .apps-shell {
      display: grid;
      gap: 16px;
      padding-bottom: 24px;
    }

    .apps-header,
    .suite-toolbar,
    .suite-group {
      border: 1px solid var(--line);
      border-radius: 8px;
      background: var(--surface);
    }

    .apps-header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 18px;
      padding: 18px;
    }

    .apps-header h2,
    .suite-group-title h3 {
      margin: 0;
      color: var(--ink);
      letter-spacing: 0;
    }

    .apps-header h2 {
      font-size: var(--font-page-title);
    }

    .apps-header p,
    .suite-group-title p {
      max-width: 760px;
      margin: 6px 0 0;
      color: var(--muted);
      line-height: 1.55;
    }

    .header-actions {
      display: inline-flex;
      flex-wrap: wrap;
      justify-content: flex-end;
      gap: 8px;
    }

    .suite-signal-grid {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 12px;
    }

    .signal-tile {
      min-height: 104px;
      display: grid;
      gap: 5px;
      align-content: center;
      padding: 14px;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: var(--surface);
    }

    .signal-tile span,
    .signal-tile small {
      color: var(--muted);
    }

    .signal-tile strong {
      color: var(--ink);
      font-size: 1.38rem;
      letter-spacing: 0;
    }

    .suite-toolbar {
      display: grid;
      grid-template-columns: minmax(220px, 360px) minmax(0, 1fr);
      gap: 12px;
      align-items: center;
      padding: 12px;
    }

    .suite-search {
      display: grid;
      gap: 5px;
    }

    .suite-search span {
      color: var(--muted);
      font-size: var(--font-label);
      font-weight: 800;
    }

    .suite-tabs {
      display: flex;
      flex-wrap: wrap;
      justify-content: flex-end;
      gap: 7px;
    }

    .suite-tabs button {
      min-height: 34px;
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 0 10px;
      color: var(--muted);
      background: var(--surface);
      font-weight: 800;
    }

    .suite-tabs button.active {
      color: #fff;
      border-color: var(--teal);
      background: var(--teal);
    }

    .apps-empty {
      min-height: 96px;
      display: grid;
      place-items: center;
      gap: 8px;
      border: 1px dashed var(--line);
      border-radius: 8px;
      color: var(--muted);
      background: var(--surface);
    }

    .suite-group {
      display: grid;
      gap: 12px;
      padding: 14px;
    }

    .suite-group-title {
      display: flex;
      justify-content: space-between;
      gap: 12px;
    }

    .suite-group-title h3 {
      font-size: 1.08rem;
    }

    .apps-grid {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 10px;
    }

    .app-card {
      min-height: 178px;
      display: grid;
      grid-template-rows: auto auto auto 1fr auto;
      gap: 8px;
      padding: 13px;
      border: 1px solid var(--line);
      border-top: 4px solid var(--teal);
      border-radius: 8px;
      background: #fff;
      color: var(--ink);
      text-decoration: none;
      transition: transform 160ms ease, border-color 160ms ease, box-shadow 160ms ease;
      overflow: hidden;
    }

    .app-card:hover,
    .app-card:focus-visible {
      transform: translateY(-2px);
      outline: 0;
      box-shadow: 0 12px 28px rgba(23, 32, 45, 0.1);
    }

    .app-card strong {
      font-size: 1rem;
      letter-spacing: 0;
    }

    .app-card small {
      color: var(--muted);
      line-height: 1.45;
    }

    .app-icon {
      width: 38px;
      height: 32px;
      display: inline-grid;
      place-items: center;
      border-radius: 8px;
      color: #fff;
      background: var(--teal);
      font-size: 0.76rem;
      font-weight: 900;
    }

    .status-pill {
      width: max-content;
      min-height: 24px;
      display: inline-flex;
      align-items: center;
      padding: 0 8px;
      border-radius: 999px;
      color: var(--muted);
      background: var(--surface-2);
      font-size: 0.72rem;
      font-weight: 900;
    }

    .app-tags {
      color: var(--muted);
      font-size: 0.74rem;
      font-weight: 800;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .tone-blue {
      border-top-color: var(--blue);
    }

    .tone-blue .app-icon {
      background: var(--blue);
    }

    .tone-amber {
      border-top-color: var(--amber);
    }

    .tone-amber .app-icon {
      background: var(--amber);
    }

    .tone-green {
      border-top-color: var(--green);
    }

    .tone-green .app-icon {
      background: var(--green);
    }

    .tone-red {
      border-top-color: var(--red);
    }

    .tone-red .app-icon {
      background: var(--red);
    }

    .tone-violet {
      border-top-color: var(--violet);
    }

    .tone-violet .app-icon {
      background: var(--violet);
    }

    .tone-neutral {
      border-top-color: var(--muted);
    }

    .tone-neutral .app-icon {
      background: var(--muted);
    }

    @media (max-width: 1280px) {
      .apps-grid,
      .suite-signal-grid {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }
    }

    @media (max-width: 880px) {
      .apps-header,
      .suite-toolbar {
        grid-template-columns: 1fr;
        display: grid;
      }

      .header-actions,
      .suite-tabs {
        justify-content: flex-start;
      }
    }

    @media (max-width: 680px) {
      .apps-grid,
      .suite-signal-grid {
        grid-template-columns: 1fr;
      }

      .apps-header,
      .suite-group {
        padding: 12px;
      }
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

  readonly filteredGroups = computed(() => {
    const selected = this.selectedGroup();
    const term = this.query().trim().toLowerCase();
    return this.suiteGroups
      .filter((group) => selected === 'all' || group.id === selected)
      .map((group) => ({
        ...group,
        apps: term ? group.apps.filter((app) => this.appText(app, group).includes(term)) : group.apps
      }))
      .filter((group) => group.apps.length);
  });

  readonly totalApps = this.suiteGroups.reduce((count, group) => count + group.apps.length, 0);
  readonly aiApps = this.suiteGroups.flatMap((group) => group.apps).filter((app) => app.status === 'AI').length;
  readonly adminApps = this.suiteGroups.flatMap((group) => group.apps).filter((app) => app.status === 'Admin').length;

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
}
