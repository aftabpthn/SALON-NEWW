import { CommonModule, CurrencyPipe } from '@angular/common';
import { Component, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { catchError, forkJoin, of } from 'rxjs';
import { ApiRecord, ApiService } from '../core/api.service';
import { StateComponent } from '../shared/ui/state/state.component';

type ReportColumn = { key: string; label: string; type?: 'currency' | 'number' | 'percent' | 'date' | 'badge' };
type ReportDefinition = { id: string; title: string; description: string; badge: string };

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
};

@Component({
  selector: 'app-invoice-reports',
  standalone: true,
  imports: [CommonModule, CurrencyPipe, FormsModule, RouterLink, StateComponent],
  template: `
    <section class="page-stack">
      <div class="module-hero invoice-report-hero">
        <div>
          <span class="eyebrow">Reports / Invoice command center</span>
          <h2>10x Enterprise Invoice Reports</h2>
          <p>Service, product, membership, GST, payment, wallet, due, discount, staff and audit intelligence from real POS invoices.</p>
        </div>
        <div class="hero-actions">
          <a class="ghost-button" routerLink="/pos/invoices">POS invoices</a>
          <a class="ghost-button" routerLink="/pos/invoice-activity">Invoice activity</a>
          <a class="ghost-button" routerLink="/reports">Reports</a>
          <button class="primary-button" type="button" (click)="load()">Refresh</button>
        </div>
      </div>

      <section class="panel report-filter-panel">
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
        <label class="field span-2">
          <span>Search</span>
          <input [(ngModel)]="query" placeholder="Invoice, client, staff, service, product, payment mode" />
        </label>
        <div class="branch-context-card">
          <span>Header branch</span>
          <strong>{{ branchLabel() }}</strong>
          <small>Change branch from top header.</small>
        </div>
        <button class="primary-button" type="button" (click)="load()">Apply</button>
      </section>

      <app-state [loading]="loading()" [error]="error()"></app-state>

      <ng-container *ngIf="!loading() && !error()">
        <div class="metrics-grid invoice-report-kpis">
          <article class="metric-card"><span>Gross billed</span><strong>{{ summary().gross | currency: 'INR':'symbol':'1.0-0' }}</strong><small>Before discount</small></article>
          <article class="metric-card"><span>Discount</span><strong>{{ summary().discount | currency: 'INR':'symbol':'1.0-0' }}</strong><small>{{ summary().discountRate }}% leakage watch</small></article>
          <article class="metric-card"><span>Net taxable</span><strong>{{ summary().taxable | currency: 'INR':'symbol':'1.0-0' }}</strong><small>GST base</small></article>
          <article class="metric-card"><span>GST</span><strong>{{ summary().gst | currency: 'INR':'symbol':'1.0-0' }}</strong><small>Tax collected</small></article>
          <article class="metric-card"><span>Final sale</span><strong>{{ summary().final | currency: 'INR':'symbol':'1.0-0' }}</strong><small>After tax</small></article>
          <article class="metric-card"><span>Due</span><strong>{{ summary().due | currency: 'INR':'symbol':'1.0-0' }}</strong><small>Open recovery</small></article>
          <article class="metric-card"><span>Product sales</span><strong>{{ summary().products | currency: 'INR':'symbol':'1.0-0' }}</strong><small>Retail revenue</small></article>
          <article class="metric-card"><span>Membership sales</span><strong>{{ summary().memberships | currency: 'INR':'symbol':'1.0-0' }}</strong><small>Plans + packages</small></article>
        </div>

        <section class="panel report-command-panel">
          <div class="section-title">
            <div>
              <span class="eyebrow">18 connected reports</span>
              <h2>{{ activeDefinition().title }}</h2>
              <p>{{ activeDefinition().description }}</p>
            </div>
            <div class="hero-actions">
              <span class="badge">{{ filteredLines().length }} line(s)</span>
              <button class="ghost-button" type="button" (click)="exportCsv()">Export CSV</button>
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
                    <span [class.badge]="column.type === 'badge'">{{ formatCell(row, column) }}</span>
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
      grid-template-columns: repeat(3, minmax(140px, 1fr)) minmax(260px, 1.6fr) minmax(180px, 0.8fr) auto;
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

    .enterprise-report-table {
      max-height: 660px;
      overflow: auto;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: #fff;
    }

    .enterprise-report-table table {
      min-width: 1320px;
    }

    .enterprise-report-table th {
      position: sticky;
      top: 0;
      z-index: 1;
      background: #f8fafc;
    }

    .right {
      text-align: right;
      white-space: nowrap;
    }

    @media (max-width: 1280px) {
      .report-filter-panel,
      .invoice-report-kpis,
      .report-tab-grid,
      .insight-strip {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }
    }

    @media (max-width: 760px) {
      .report-filter-panel,
      .invoice-report-kpis,
      .report-tab-grid,
      .insight-strip {
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
  readonly branches = signal<ApiRecord[]>([]);
  readonly walletTransactions = signal<ApiRecord[]>([]);
  readonly auditLogs = signal<ApiRecord[]>([]);
  readonly activeReport = signal('staff-services');

  from = this.monthStart();
  to = this.today();
  status = '';
  query = '';

  readonly reportDefinitions: ReportDefinition[] = [
    { id: 'overview', title: 'Invoice Summary', badge: '01', description: 'Gross, discount, GST, paid, due and invoice count.' },
    { id: 'staff-services', title: 'Staff Service Sales', badge: '02', description: 'Staff ne kaunsi service ki aur kitna revenue banaya.' },
    { id: 'staff-discounts', title: 'Staff Discount Performance', badge: '03', description: 'Without discount vs with discount staff revenue.' },
    { id: 'products', title: 'Product Sales', badge: '04', description: 'Retail product quantity, discount, GST and net sale.' },
    { id: 'memberships', title: 'Membership / Package Sales', badge: '05', description: 'Membership, package and prepaid credit selling.' },
    { id: 'gst', title: 'GST + HSN/SAC', badge: '06', description: 'GST rate wise taxable and tax breakup.' },
    { id: 'payments', title: 'Payment Collection', badge: '07', description: 'Cash, UPI, card, wallet, online and split payment.' },
    { id: 'due-aging', title: 'Due / Unpaid Aging', badge: '08', description: 'Client-wise and invoice-wise pending recovery.' },
    { id: 'wallet', title: 'Wallet Ledger', badge: '09', description: 'Wallet used, wallet balance and liability.' },
    { id: 'audit', title: 'Refund / Void / Adjustment', badge: '10', description: 'Delete, edit, restore, refund and approval trail.' },
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
      { key: 'itemName', label: 'Product' }, { key: 'staffName', label: 'Staff' }, { key: 'qty', label: 'Qty', type: 'number' }, { key: 'gross', label: 'Gross', type: 'currency' }, { key: 'discount', label: 'Discount', type: 'currency' }, { key: 'taxable', label: 'Taxable', type: 'currency' }, { key: 'gst', label: 'GST', type: 'currency' }, { key: 'final', label: 'Final', type: 'currency' }, { key: 'invoices', label: 'Invoices', type: 'number' }
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
      { key: 'invoiceNumber', label: 'Invoice' }, { key: 'clientName', label: 'Client' }, { key: 'clientPhone', label: 'Phone' }, { key: 'staffName', label: 'Staff' }, { key: 'date', label: 'Date', type: 'date' }, { key: 'due', label: 'Due', type: 'currency' }, { key: 'paid', label: 'Paid', type: 'currency' }, { key: 'lastPaymentDate', label: 'Last payment', type: 'date' }, { key: 'unpaidSinceDays', label: 'Unpaid since', type: 'number' }, { key: 'invoiceAgeDays', label: 'Invoice age', type: 'number' }, { key: 'lastRecoveryTouchDate', label: 'Last touch', type: 'date' }, { key: 'lastRecoveryTouchDays', label: 'Touch age' }, { key: 'bucket', label: 'Bucket', type: 'badge' }, { key: 'recoveryAction', label: 'Recovery action', type: 'badge' }
    ],
    wallet: [
      { key: 'clientName', label: 'Client' }, { key: 'clientPhone', label: 'Phone' }, { key: 'walletUsed', label: 'Wallet used', type: 'currency' }, { key: 'walletBalance', label: 'Wallet balance', type: 'currency' }, { key: 'due', label: 'Due', type: 'currency' }, { key: 'lastActivity', label: 'Last activity', type: 'date' }, { key: 'source', label: 'Source', type: 'badge' }
    ],
    audit: [
      { key: 'date', label: 'Date', type: 'date' }, { key: 'action', label: 'Action', type: 'badge' }, { key: 'invoiceNumber', label: 'Invoice' }, { key: 'clientName', label: 'Client' }, { key: 'staffName', label: 'Staff' }, { key: 'amount', label: 'Amount', type: 'currency' }, { key: 'risk', label: 'Risk', type: 'badge' }, { key: 'note', label: 'Note' }
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

  constructor(private readonly api: ApiService) {}

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.error.set('');
    forkJoin({
      invoices: this.safeList('invoices', { limit: 5000 }),
      sales: this.safeList('sales', { limit: 5000 }),
      payments: this.safeList('payments', { limit: 5000 }),
      clients: this.safeList('clients', { limit: 5000 }),
      staff: this.safeList('staff', { limit: 5000 }),
      branches: this.safeList('branches', { limit: 1000 }),
      walletTransactions: this.safeList('walletTransactions', { limit: 5000 }),
      auditLogs: this.safeList('auditLogs', { limit: 5000 })
    }).subscribe({
      next: (data) => {
        this.invoices.set(data.invoices || []);
        this.payments.set(data.payments || []);
        this.clients.set(data.clients || []);
        this.branches.set(data.branches || []);
        this.walletTransactions.set(data.walletTransactions || []);
        this.auditLogs.set(data.auditLogs || []);
        this.lines.set(this.buildLines(data.invoices || [], data.sales || [], data.payments || [], data.clients || [], data.staff || [], data.branches || []));
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
    const lines = this.lines().filter((line) => {
      const statusMatch = !this.status || (this.status === 'unpaid' ? line.due > 0 : String(line.status).toLowerCase().includes(this.status));
      const dateMatch = this.inDateRange(line.date);
      const text = `${line.invoiceNumber} ${line.clientName} ${line.clientPhone} ${line.staffName} ${line.itemName} ${line.itemType} ${line.paymentModes}`.toLowerCase();
      return statusMatch && dateMatch && (!query || text.includes(query));
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

  activeDefinition(): ReportDefinition {
    return this.reportDefinitions.find((report) => report.id === this.activeReport()) || this.reportDefinitions[0];
  }

  activeColumns(): ReportColumn[] {
    return this.columns[this.activeReport()] || this.columns['line-audit'];
  }

  activeRows(): ApiRecord[] {
    const report = this.activeReport();
    if (report === 'overview') return this.overviewRows();
    if (report === 'staff-services') return this.staffServiceRows();
    if (report === 'staff-discounts') return this.staffDiscountRows();
    if (report === 'products') return this.itemRows('product');
    if (report === 'memberships') return this.membershipRows();
    if (report === 'gst') return this.gstRows();
    if (report === 'payments') return this.paymentRows();
    if (report === 'due-aging') return this.dueRows();
    if (report === 'wallet') return this.walletRows();
    if (report === 'audit') return this.auditRows();
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
    const invoiceRows = this.uniqueInvoiceRows().filter((line) => line.due > 0);
    return invoiceRows.map((line) => {
      const lastPaymentDate = this.lastPaymentDate(line.invoiceId);
      const unpaidSinceDate = lastPaymentDate || line.date;
      const unpaidSinceDays = this.ageDays(unpaidSinceDate);
      const invoiceAgeDays = this.ageDays(line.date);
      const lastRecoveryTouchDate = this.lastRecoveryTouchDate(line.invoiceId, line.invoiceNumber, line.clientId);
      return {
        invoiceNumber: line.invoiceNumber,
        clientName: line.clientName,
        clientPhone: line.clientPhone,
        staffName: line.staffName,
        date: line.date,
        due: line.due,
        paid: line.paid,
        lastPaymentDate,
        unpaidSinceDays,
        invoiceAgeDays,
        lastRecoveryTouchDate,
        lastRecoveryTouchDays: lastRecoveryTouchDate ? this.ageDays(lastRecoveryTouchDate) : '',
        ageDays: unpaidSinceDays,
        bucket: this.unpaidBucket(unpaidSinceDays),
        recoveryAction: this.recoveryAction(unpaidSinceDays)
      };
    }).sort((a, b) => Number(b['due']) - Number(a['due']));
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

  private buildLines(invoices: ApiRecord[], sales: ApiRecord[], payments: ApiRecord[], clients: ApiRecord[], staff: ApiRecord[], branches: ApiRecord[]): InvoiceLine[] {
    const saleMap = new Map(sales.map((sale) => [String(sale.id), sale]));
    const clientMap = new Map(clients.map((client) => [String(client.id), client]));
    const staffMap = new Map(staff.map((person) => [String(person.id), person]));
    const branchMap = new Map(branches.map((branch) => [String(branch.id), branch]));
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
      return items.map((item) => {
        const itemStaffId = String(item.staffId || item.staff_id || item.assignedStaffId || item.assigned_staff_id || staffId || '');
        const itemStaff = staffMap.get(itemStaffId) || staffPerson;
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
          itemName: String(item.name || item.serviceName || item.productName || item.itemName || item.title || 'Invoice item'),
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
          paymentModes
        };
      });
    });
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
    if (days >= 4) return '4-7 days';
    return '0-3 days';
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

  private csvCell(value: unknown): string {
    return `"${String(value ?? '').replace(/"/g, '""')}"`;
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
