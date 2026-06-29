import { CommonModule, CurrencyPipe, DatePipe } from '@angular/common';
import { Component, OnInit, effect, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ApiRecord, ApiService } from '../core/api.service';
import { StateComponent } from '../shared/ui/state/state.component';

@Component({
  selector: 'app-staff-sales-report',
  standalone: true,
  imports: [CommonModule, CurrencyPipe, DatePipe, FormsModule, RouterLink, StateComponent],
  template: `
    <section class="page-stack">
      <div class="module-hero">
        <div>
          <span class="eyebrow">Reports / Staff sales</span>
          <h2>Staff Sales Report</h2>
          <p>POS line-item attribution for services, products, memberships, packages and gift cards.</p>
        </div>
        <div class="hero-actions">
          <a class="ghost-button" routerLink="/reports">Reports</a>
          <a class="ghost-button" routerLink="/reports/commission-preview">Commission preview</a>
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
          <span>Sale type</span>
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
          <input [(ngModel)]="query" placeholder="Staff, item, invoice" />
        </label>
        <div class="branch-context-card">
          <span>Header branch</span>
          <strong>{{ branchLabel() }}</strong>
          <small>Change branch only from top header.</small>
        </div>
        <button class="primary-button" type="button" (click)="load()">Apply filters</button>
      </section>

      <app-state [loading]="loading()" [error]="error()"></app-state>

      <ng-container *ngIf="report() as data">
        <div class="metrics-grid">
          <article class="metric-card">
            <span>Total attributed sales</span>
            <strong>{{ data.totals?.totalRevenue || 0 | currency: 'INR':'symbol':'1.0-0' }}</strong>
            <small>{{ data.totals?.itemCount || 0 }} line items</small>
          </article>
          <article class="metric-card">
            <span>Service sales</span>
            <strong>{{ data.totals?.serviceRevenue || 0 | currency: 'INR':'symbol':'1.0-0' }}</strong>
            <small>Performed revenue</small>
          </article>
          <article class="metric-card">
            <span>Product sales</span>
            <strong>{{ data.totals?.productRevenue || 0 | currency: 'INR':'symbol':'1.0-0' }}</strong>
            <small>Retail seller revenue</small>
          </article>
          <article class="metric-card">
            <span>Membership + package</span>
            <strong>{{ membershipPackageRevenue(data) | currency: 'INR':'symbol':'1.0-0' }}</strong>
            <small>Plan and package selling</small>
          </article>
          <article class="metric-card">
            <span>Gift card sales</span>
            <strong>{{ data.totals?.giftCardRevenue || 0 | currency: 'INR':'symbol':'1.0-0' }}</strong>
            <small>Gift card attribution</small>
          </article>
          <article class="metric-card">
            <span>Total clients</span>
            <strong>{{ data.totals?.clientsCount || 0 }}</strong>
            <small>Staff-linked clients</small>
          </article>
          <article class="metric-card">
            <span>Total invoices</span>
            <strong>{{ data.totals?.invoiceCount || 0 }}</strong>
            <small>Attributed bills</small>
          </article>
          <article class="metric-card">
            <span>Average bill</span>
            <strong>{{ data.totals?.averageBill || 0 | currency: 'INR':'symbol':'1.0-0' }}</strong>
            <small>Revenue / invoices</small>
          </article>
          <article class="metric-card">
            <span>Pending due</span>
            <strong>{{ data.totals?.pendingDue || 0 | currency: 'INR':'symbol':'1.0-0' }}</strong>
            <small>Collection accountability</small>
          </article>
          <article class="metric-card">
            <span>Discount given</span>
            <strong>{{ data.totals?.discountGiven || 0 | currency: 'INR':'symbol':'1.0-0' }}</strong>
            <small>Leakage watch</small>
          </article>
          <article class="metric-card">
            <span>Staff tips</span>
            <strong>{{ data.totals?.tips || 0 | currency: 'INR':'symbol':'1.0-0' }}</strong>
            <small>Tip attribution</small>
          </article>
          <article class="metric-card">
            <span>Estimated commission</span>
            <strong>{{ data.totals?.estimatedCommission || 0 | currency: 'INR':'symbol':'1.0-0' }}</strong>
            <small>Preview basis</small>
          </article>
        </div>

        <section class="panel">
          <div class="section-title">
            <div>
              <span class="eyebrow">Leaderboard</span>
              <h2>Staff summary</h2>
            </div>
          </div>
          <div class="table-wrap">
            <table>
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
                    <td>{{ row.serviceRevenue | currency: 'INR':'symbol':'1.0-0' }}</td>
                    <td>{{ row.productRevenue | currency: 'INR':'symbol':'1.0-0' }}</td>
                    <td>{{ membershipPackageRevenue({ totals: row }) | currency: 'INR':'symbol':'1.0-0' }}</td>
                    <td>{{ row.giftCardRevenue | currency: 'INR':'symbol':'1.0-0' }}</td>
                    <td>{{ row.totalRevenue | currency: 'INR':'symbol':'1.0-0' }}</td>
                    <td>{{ row.clientsCount || 0 }}</td>
                    <td>{{ row.invoiceCount || 0 }}</td>
                    <td>{{ row.averageBill | currency: 'INR':'symbol':'1.0-0' }}</td>
                    <td>{{ row.pendingDue | currency: 'INR':'symbol':'1.0-0' }}</td>
                    <td>{{ row.discountGiven | currency: 'INR':'symbol':'1.0-0' }}</td>
                    <td>{{ row.tips | currency: 'INR':'symbol':'1.0-0' }}</td>
                    <td>{{ row.estimatedCommission | currency: 'INR':'symbol':'1.0-0' }}</td>
                    <td><span class="score-pill" [class.good]="row.performanceScore >= 75" [class.warn]="row.performanceScore < 45">{{ row.performanceScore || 0 }}</span></td>
                    <td><a class="ghost-button mini" routerLink="/staff-os/employee-masters" [queryParams]="{ q: row.staffName }">Open</a></td>
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
                                <td>{{ service.grossSale | currency: 'INR':'symbol':'1.0-0' }}</td>
                                <td>{{ service.discount | currency: 'INR':'symbol':'1.0-0' }}</td>
                                <td>{{ service.netSale | currency: 'INR':'symbol':'1.0-0' }}</td>
                                <td>{{ service.gst | currency: 'INR':'symbol':'1.0-0' }}</td>
                                <td>{{ service.cogs | currency: 'INR':'symbol':'1.0-0' }} <span class="badge warning" *ngIf="service.costSignal === 'missing_cost'">missing cost</span></td>
                                <td>{{ service.grossMargin | currency: 'INR':'symbol':'1.0-0' }}</td>
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
                                <td>{{ product.netSale | currency: 'INR':'symbol':'1.0-0' }}</td>
                                <td>{{ product.cogs | currency: 'INR':'symbol':'1.0-0' }}</td>
                                <td>{{ product.grossMargin | currency: 'INR':'symbol':'1.0-0' }}</td>
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

        <section class="panel">
          <div class="section-title">
            <div>
              <span class="eyebrow">Line item audit</span>
              <h2>Staff by item</h2>
            </div>
          </div>
          <div class="table-wrap">
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
                  <td>{{ item.date | date: 'dd MMM yyyy' }}</td>
                  <td>{{ item.staffName }}</td>
                  <td>{{ item.itemTypeLabel }}</td>
                  <td>{{ item.itemName }}</td>
                  <td>{{ item.quantity }}</td>
                  <td>{{ item.sharePercent || 100 }}%</td>
                  <td>{{ item.amount | currency: 'INR':'symbol':'1.0-0' }}</td>
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
    .hero-actions {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
      justify-content: flex-end;
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
    .table-wrap table {
      min-width: 1460px;
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
      padding: 14px;
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
      padding: 12px;
    }
    .detail-grid table {
      min-width: 860px;
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
      background: #dcfce7;
      color: #166534;
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
      padding: 18px;
    }
    .metric-card span,
    .metric-card small {
      color: var(--muted);
      display: block;
    }
    .metric-card strong {
      display: block;
      font-size: 30px;
      margin: 8px 0 4px;
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
    }
  `]
})
export class StaffSalesReportComponent implements OnInit {
  readonly report = signal<ApiRecord | null>(null);
  readonly branches = signal<ApiRecord[]>([]);
  readonly loading = signal(false);
  readonly error = signal('');
  readonly expandedStaff = signal('');

  from = '';
  to = '';
  staffId = '';
  saleType = '';
  service = '';
  product = '';
  category = '';
  commissionStatus = '';
  performanceBucket = '';
  query = '';
  private initialized = false;

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
    const branchId = this.api.selectedBranchId();
    this.api.report<ApiRecord>('staff-sales', {
      branchId,
      from: this.from,
      to: this.to,
      staffId: this.staffId,
      saleType: this.saleType,
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

  staffOptions(): Array<{ id: string; label: string }> {
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
  }

  toggleStaff(row: ApiRecord): void {
    const id = String(row['staffId'] || row['staffName'] || '');
    this.expandedStaff.set(this.expandedStaff() === id ? '' : id);
  }

  isExpanded(row: ApiRecord): boolean {
    return this.expandedStaff() === String(row['staffId'] || row['staffName'] || '');
  }

  exportCsv(): void {
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

  branchLabel(): string {
    const branchId = this.api.selectedBranchId();
    if (!branchId) return 'Header branch not selected';
    return this.branches().find((branch) => branch.id === branchId)?.name || branchId;
  }

  private loadBranches(): void {
    this.api.list<ApiRecord[]>('branches', { limit: 1000 }).subscribe({
      next: (branches) => this.branches.set(branches || []),
      error: () => this.branches.set([])
    });
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
