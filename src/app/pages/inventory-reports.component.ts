import { CommonModule } from '@angular/common';
import { Component, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { ApiRecord, ApiService } from '../core/api.service';
import { InventoryZenotiChromeComponent } from '../shared/ui/inventory-zenoti-chrome/inventory-zenoti-chrome.component';
import { StateComponent } from '../shared/ui/state/state.component';
import { AuraMoneyPipe } from '../shared/pipes/aura-money.pipe';

@Component({
  selector: 'app-inventory-reports',
  standalone: true,
  imports: [AuraMoneyPipe, CommonModule, FormsModule, RouterLink, InventoryZenotiChromeComponent, StateComponent],
  template: `
    <section class="page-stack inventory-enterprise-page inner-page-shell">
      <app-inventory-zenoti-chrome
        title="COGS, margin, dead stock and supplier spend"
        breadcrumb="Inventory > Reports"
        (refresh)="load()"
      >
        <div zenoti-actions>
          <button class="primary-button" type="button" (click)="snapshot()" [disabled]="saving()">Create snapshot</button>
        </div>
      </app-inventory-zenoti-chrome>

      <app-state [loading]="loading()" [error]="error()"></app-state>
      <div class="state success" *ngIf="success()">{{ success() }}</div>

      <section class="report-tabs inner-action-bar">
        <button type="button" [class.active]="activeTab() === 'summary'" (click)="setTab('summary')">Inventory Summary</button>
        <button type="button" [class.active]="activeTab() === 'product-in-out'" (click)="setTab('product-in-out')">Product IN/OUT Retail</button>
        <button type="button" [class.active]="activeTab() === 'dead-stock'" (click)="setTab('dead-stock')">Dead Stock</button>
        <button type="button" [class.active]="activeTab() === 'expiry-risk'" (click)="setTab('expiry-risk')">Expiry Risk</button>
        <button type="button" [class.active]="activeTab() === 'supplier-spend'" (click)="setTab('supplier-spend')">Supplier Spend</button>
      </section>

      <ng-container *ngIf="activeTab() === 'summary'">
        <section class="report-kpis inner-stats-grid" *ngIf="report()?.metrics as metrics">
          <article class="metric-card teal"><span>Stock value</span><strong>{{ metrics.stockValue | auraMoney:'1.0-0' }}</strong></article>
          <article class="metric-card amber"><span>COGS</span><strong>{{ metrics.cogs | auraMoney:'1.0-0' }}</strong></article>
          <article class="metric-card blue"><span>Purchase spend</span><strong>{{ metrics.purchaseSpend | auraMoney:'1.0-0' }}</strong></article>
          <article class="metric-card red"><span>Dead stock</span><strong>{{ metrics.deadStockValue | auraMoney:'1.0-0' }}</strong></article>
          <article class="metric-card purple"><span>Expiry risk</span><strong>{{ metrics.expiryRiskValue | auraMoney:'1.0-0' }}</strong></article>
        </section>
      </ng-container>

      <section class="panel product-inout-panel inner-page-card" *ngIf="activeTab() === 'product-in-out'">
        <div class="section-title inner-action-bar">
          <div><h2>Product IN/OUT Retail</h2></div>
          <div class="hero-actions">
            <button class="ghost-button" type="button" (click)="exportProductInOutCsv()">Export CSV</button>
            <button class="ghost-button" type="button" (click)="exportProductInOutOwnerPdf()">Owner PDF</button>
          </div>
        </div>
        <div class="product-report-filters inner-form-grid">
          <label class="field"><span>From</span><input type="date" [(ngModel)]="productFrom" /></label>
          <label class="field"><span>To</span><input type="date" [(ngModel)]="productTo" /></label>
          <label class="field"><span>Product / barcode / SKU</span><input [(ngModel)]="productSearch" placeholder="Product, barcode, SKU" /></label>
          <label class="field"><span>Brand</span><input [(ngModel)]="productBrand" placeholder="All brands" /></label>
          <label class="field"><span>Category</span><input [(ngModel)]="productCategory" placeholder="All categories" /></label>
          <label class="field"><span>GST rate</span><input type="number" [(ngModel)]="productGstRate" placeholder="All" /></label>
          <label class="field">
            <span>Stock status</span>
            <select [(ngModel)]="productStockStatus">
              <option value="">All</option>
              <option value="healthy">Healthy</option>
              <option value="low">Low</option>
              <option value="negative">Negative</option>
            </select>
          </label>
          <label class="field">
            <span>Movement type</span>
            <select [(ngModel)]="productMovementType">
              <option value="">All</option>
              <option value="sale">Sale</option>
              <option value="purchase">Purchase</option>
              <option value="adjustment">Adjustment</option>
              <option value="return">Return</option>
              <option value="waste">Waste / expiry</option>
            </select>
          </label>
          <button class="primary-button run-report-button" type="button" (click)="loadProductInOut()" [disabled]="productLoading()">Run Report</button>
        </div>

        <p class="muted product-preview-note" *ngIf="productInOutReport()">
          Showing first {{ productInOutRows().length }} of {{ productInOutTotalRows() }} rows. Use filters or export for focused review.
        </p>

        <section class="report-kpis product-inout-kpis inner-stats-grid" *ngIf="productInOutReport()?.summary as summary">
          <article class="metric-card teal"><span>Total Product</span><strong>{{ summary.totalProduct || 0 }}</strong></article>
          <article class="metric-card blue"><span>Total Sales Count</span><strong>{{ summary.totalSalesCount || 0 }}</strong></article>
          <article class="metric-card amber"><span>Total In Hand</span><strong>{{ summary.totalInHand || 0 }}</strong></article>
          <article class="metric-card teal"><span>Revenue</span><strong>{{ summary.revenue | auraMoney:'1.0-0' }}</strong></article>
          <article class="metric-card amber"><span>COGS</span><strong>{{ summary.cogs | auraMoney:'1.0-0' }}</strong></article>
          <article class="metric-card blue"><span>Gross Margin</span><strong>{{ summary.grossMargin | auraMoney:'1.0-0' }}</strong></article>
          <article class="metric-card red"><span>Negative Stock</span><strong>{{ summary.negativeStockCount || 0 }}</strong></article>
          <article class="metric-card purple"><span>Reorder</span><strong>{{ summary.reorderCount || 0 }}</strong></article>
        </section>

        <div class="movement-strip">
          <article *ngFor="let row of productInOutReport()?.movementBreakdown || []">
            <span>{{ row.type }}</span><strong>{{ row.quantity || 0 }}</strong><small>{{ row.amount | auraMoney:'1.0-0' }}</small>
          </article>
        </div>

        <div class="table-wrap product-inout-table inner-table-wrap">
          <table>
            <thead>
              <tr>
                <th>Product</th><th>Barcode / SKU</th><th>Cost Price</th><th>Sell Price</th><th>Sales Count</th><th>New Stock</th><th>Adjustment</th><th>In Hand</th>
                <th>Opening</th><th>Purchase In</th><th>Retail Sold Out</th><th>Return In</th><th>Waste / Expiry</th><th>Closing</th>
                <th>Revenue</th><th>COGS</th><th>Gross Margin</th><th>Margin %</th><th>Stock</th><th>Reorder Qty</th><th>Batch / FIFO</th><th>Last Movement</th><th>Alerts</th><th>Actions</th>
              </tr>
            </thead>
            <tbody>
              <tr *ngFor="let row of productInOutRows()">
                <td><strong>{{ row.product }}</strong><small>{{ row.category || 'Retail' }} · {{ row.brand || 'No brand' }}</small></td>
                <td>{{ row.barcode || row.sku || '-' }}</td>
                <td>{{ row.costPrice | auraMoney:'1.0-0' }}</td>
                <td>{{ row.sellPrice | auraMoney:'1.0-0' }}</td>
                <td>{{ row.salesCount || 0 }}</td>
                <td>{{ row.newStock || 0 }}</td>
                <td>{{ row.adjustment || 0 }}</td>
                <td><span class="badge" [class.danger]="row.stockStatus === 'negative'" [class.warn]="row.stockStatus === 'low'">{{ row.inHand || 0 }}</span></td>
                <td>{{ row.openingStock || 0 }}</td>
                <td>{{ row.purchaseIn || 0 }}</td>
                <td>{{ row.retailSoldOut || 0 }}</td>
                <td>{{ row.returnIn || 0 }}</td>
                <td>{{ row.wasteExpiryOut || 0 }}</td>
                <td>{{ row.closingStock || 0 }}</td>
                <td>{{ row.revenue | auraMoney:'1.0-0' }}</td>
                <td>{{ row.cogs | auraMoney:'1.0-0' }}</td>
                <td>{{ row.grossMargin | auraMoney:'1.0-0' }}</td>
                <td>{{ row.marginPercent || 0 }}%</td>
                <td>{{ row.stockStatus }}</td>
                <td>{{ row.reorderQty || 0 }}</td>
                <td>{{ row.batchFifoSource || '-' }}</td>
                <td>{{ row.lastMovementDate || '-' }}</td>
                <td>
                  <span>{{ row.negativeStockAlert || row.missingCostAlert || row.lowMarginAlert || row.expiryRisk || row.deadStock || 'OK' }}</span>
                </td>
                <td class="action-cell">
                  <a class="ghost-button mini" [routerLink]="['/inventory/products', row.productId]">Product 360</a>
                  <a class="ghost-button mini" routerLink="/inventory/product-consume">Stock ledger</a>
                  <a class="ghost-button mini" routerLink="/reports/invoices">Sale invoices</a>
                  <a class="primary-button mini" routerLink="/inventory/reorder">Create reorder</a>
                </td>
              </tr>
              <tr *ngIf="!productInOutRows().length"><td colspan="24">No Product IN/OUT retail rows for selected filters.</td></tr>
            </tbody>
          </table>
        </div>

        <div class="alert-grid" *ngIf="(productInOutReport()?.alerts || []).length">
          <article *ngFor="let alert of productInOutReport()?.alerts || []" [class.high]="alert.severity === 'high'">
            <strong>{{ alert.product }}</strong><span>{{ alert.message }}</span><small>{{ alert.type }}</small>
          </article>
        </div>
      </section>

      <div class="enterprise-grid three" *ngIf="activeTab() === 'dead-stock'">
        <section class="panel">
          <div class="section-title inner-action-bar"><div><h2>Cash locked in shelves</h2></div></div>
          <article class="report-row" *ngFor="let row of report()?.deadStock || []">
            <span>{{ row.name }}</span><strong>{{ row.value | auraMoney:'1.0-0' }}</strong>
          </article>
          <p class="muted" *ngIf="!(report()?.deadStock || []).length">No dead stock signal.</p>
        </section>
      </div>

      <div class="enterprise-grid three" *ngIf="activeTab() === 'expiry-risk'">
        <section class="panel">
          <div class="section-title inner-action-bar"><div><h2>Batch risk</h2></div></div>
          <article class="report-row" *ngFor="let row of report()?.expiring || []">
            <span>{{ row.productName }} · {{ row.daysToExpiry }} days</span><strong>{{ row.value | auraMoney:'1.0-0' }}</strong>
          </article>
          <p class="muted" *ngIf="!(report()?.expiring || []).length">No expiry risk in selected scope.</p>
        </section>
      </div>

      <div class="enterprise-grid three" *ngIf="activeTab() === 'supplier-spend'">
        <section class="panel">
          <div class="section-title inner-action-bar"><div><h2>PO value by supplier</h2></div></div>
          <article class="report-row" *ngFor="let row of report()?.supplierSpend || []">
            <span>{{ row.name }} · {{ row.openPoItems }} open</span><strong>{{ row.spend | auraMoney:'1.0-0' }}</strong>
          </article>
          <p class="muted" *ngIf="!(report()?.supplierSpend || []).length">No supplier purchase spend yet.</p>
        </section>
      </div>

      <section class="panel">
        <div class="section-title inner-action-bar"><div><h2>Manual-send queue</h2></div></div>
        <div class="table-wrap inner-table-wrap">
          <table>
            <thead><tr><th>Supplier</th><th>PO</th><th>Phone</th><th>Status</th><th>Message</th><th>Action</th></tr></thead>
            <tbody>
              <tr *ngFor="let row of queue()">
                <td>{{ supplierName(row.supplierId) }}</td>
                <td>{{ row.purchaseOrderId }}</td>
                <td>{{ row.phone || '-' }}</td>
                <td><span class="badge">{{ row.status }}</span></td>
                <td><pre>{{ row.message }}</pre></td>
                <td><button class="ghost-button mini" type="button" (click)="markSent(row)" [disabled]="row.status === 'sent' || saving()">Mark sent</button></td>
              </tr>
              <tr *ngIf="!queue().length"><td colspan="6">No supplier WhatsApp drafts queued.</td></tr>
            </tbody>
          </table>
        </div>
      </section>
    </section>
  `,
  styles: [`
    :host, .inventory-enterprise-page { display: block; max-width: 100%; overflow-x: hidden; }
    .hero-actions, .section-title, .report-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
    .hero-actions, .section-title { flex-wrap: wrap; }
    .section-title p { margin: 4px 0 0; color: var(--muted); }
    .report-tabs { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 10px; }
    .report-tabs button { border: 1px solid var(--border); border-radius: 8px; background: #fff; padding: 12px; font-weight: 900; color: var(--muted); cursor: pointer; }
    .report-tabs button.active { border-color: var(--teal); color: var(--ink); background: color-mix(in srgb, var(--teal) 10%, #fff); box-shadow: 0 12px 28px color-mix(in srgb, var(--teal) 10%, transparent); }
    .report-kpis { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 12px; }
    .product-inout-kpis { grid-template-columns: repeat(4, minmax(0, 1fr)); }
    .product-inout-panel { max-width: 100%; overflow: hidden; }
    .product-report-filters { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; align-items: end; max-width: 100%; }
    .product-report-filters .field { min-width: 0; }
    .product-report-filters input, .product-report-filters select { width: 100%; min-width: 0; }
    .run-report-button { min-height: 50px; }
    .product-preview-note { margin: 6px 0 0; font-size: 12px; font-weight: 800; }
    .movement-strip { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 10px; }
    .movement-strip article, .alert-grid article { border: 1px solid var(--border); border-radius: 8px; background: #fff; padding: 12px; }
    .movement-strip span, .movement-strip small, .alert-grid span, .alert-grid small { display: block; color: var(--muted); font-size: 12px; font-weight: 800; text-transform: capitalize; }
    .movement-strip strong { display: block; margin: 4px 0; font-size: 20px; }
    .enterprise-grid.three { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 14px; }
    .report-row { padding: 10px 0; border-bottom: 1px solid var(--border); }
    .report-row span, .muted { color: var(--muted); }
    .table-wrap { overflow: auto; max-width: 100%; }
    table { min-width: 980px; }
    .product-inout-table table { min-width: 2600px; }
    .product-inout-table { max-height: 64vh; border: 1px solid var(--border); border-radius: 8px; }
    td small { display: block; color: var(--muted); font-size: 11px; font-weight: 800; }
    .badge.warn { background: #fff7ed; color: #9a3412; border-color: #fed7aa; }
    .badge.danger, .alert-grid article.high { background: #fef2f2; color: #991b1b; border-color: #fecaca; }
    .action-cell { min-width: 320px; }
    .action-cell .mini { margin: 2px; }
    .alert-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; }
    pre { white-space: pre-wrap; margin: 0; font-family: inherit; color: var(--muted); }
    @media (max-width: 1400px) { .product-report-filters { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
    @media (max-width: 1100px) { .report-kpis, .product-inout-kpis, .product-report-filters, .movement-strip, .enterprise-grid.three, .report-tabs, .alert-grid { grid-template-columns: 1fr; } }
  `]
})
export class InventoryReportsComponent implements OnInit {
  readonly suppliers = signal<ApiRecord[]>([]);
  readonly report = signal<ApiRecord | null>(null);
  readonly productInOutReport = signal<ApiRecord | null>(null);
  readonly queue = signal<ApiRecord[]>([]);
  readonly activeTab = signal('summary');
  readonly loading = signal(true);
  readonly productLoading = signal(false);
  readonly saving = signal(false);
  readonly error = signal('');
  readonly success = signal('');
  productFrom = this.monthStart();
  productTo = this.today();
  productSearch = '';
  productBrand = '';
  productCategory = '';
  productGstRate = '';
  productStockStatus = '';
  productMovementType = '';

  constructor(private readonly api: ApiService) {}

  ngOnInit(): void { this.load(); }

  setTab(tab: string): void {
    this.activeTab.set(tab);
    if (tab === 'product-in-out' && !this.productInOutReport() && !this.productLoading()) {
      this.loadProductInOut();
    }
  }

  load(): void {
    this.loading.set(true);
    Promise.all([
      firstValueFrom(this.api.list<ApiRecord>('inventory-intelligence/reports', { branchId: this.api.selectedBranchId() })),
      firstValueFrom(this.api.list<ApiRecord[]>('inventory-intelligence/supplier-whatsapp-queue', { limit: 100 })),
      firstValueFrom(this.api.list<ApiRecord[]>('suppliers', { limit: 1000 }))
    ]).then(([report, queue, suppliers]) => {
      this.report.set(report || null);
      this.queue.set(queue || []);
      this.suppliers.set(suppliers || []);
      this.loading.set(false);
    }).catch((error) => {
      this.error.set(error?.error?.error || error?.message || 'Unable to load inventory reports');
      this.loading.set(false);
    });
  }

  snapshot(): void {
    this.saving.set(true);
    this.api.post<ApiRecord>('inventory-intelligence/reports/snapshot', { branchId: this.api.selectedBranchId() }).subscribe({
      next: () => { this.success.set('Inventory report snapshot saved.'); this.saving.set(false); this.load(); },
      error: (error) => { this.error.set(error?.error?.error || error?.message || 'Unable to save snapshot'); this.saving.set(false); }
    });
  }

  markSent(row: ApiRecord): void {
    this.saving.set(true);
    this.api.post<ApiRecord>(`inventory-intelligence/supplier-whatsapp-queue/${row.id}/mark-sent`, {}).subscribe({
      next: () => { this.success.set('Supplier WhatsApp order marked sent.'); this.saving.set(false); this.load(); },
      error: (error) => { this.error.set(error?.error?.error || error?.message || 'Unable to mark sent'); this.saving.set(false); }
    });
  }

  supplierName(id: string): string {
    return this.suppliers().find((item) => item.id === id)?.name || id || 'Supplier';
  }

  loadProductInOut(): void {
    this.productLoading.set(true);
    this.api.list<ApiRecord>('inventory-intelligence/product-in-out-retail-report', this.productInOutParams()).subscribe({
      next: (report) => { this.productInOutReport.set(report || null); this.success.set('Product IN/OUT Retail report refreshed.'); this.productLoading.set(false); },
      error: (error) => { this.error.set(error?.error?.error || error?.message || 'Unable to load Product IN/OUT Retail report'); this.productLoading.set(false); }
    });
  }

  productInOutRows(): ApiRecord[] {
    return (this.productInOutReport()?.['rows'] || []) as ApiRecord[];
  }

  productInOutTotalRows(): number {
    return Number(this.productInOutReport()?.['totalRows'] || this.productInOutRows().length || 0);
  }

  exportProductInOutCsv(): void {
    const columns = [
      'Product', 'Barcode / SKU', 'Cost Price', 'Sell Price', 'Sales Count', 'New Stock', 'Adjustment', 'In Hand',
      'Opening Stock', 'Purchase In', 'Retail Sold Out', 'Return In', 'Waste / Expiry Out', 'Closing Stock',
      'Revenue', 'COGS', 'Gross Margin', 'Margin %', 'Stock Status', 'Reorder Qty', 'Batch / FIFO', 'Last Movement', 'Alerts'
    ];
    const rows = this.productInOutRows().map((row) => [
      row['product'], row['barcode'] || row['sku'], row['costPrice'], row['sellPrice'], row['salesCount'], row['newStock'], row['adjustment'], row['inHand'],
      row['openingStock'], row['purchaseIn'], row['retailSoldOut'], row['returnIn'], row['wasteExpiryOut'], row['closingStock'],
      row['revenue'], row['cogs'], row['grossMargin'], row['marginPercent'], row['stockStatus'], row['reorderQty'], row['batchFifoSource'], row['lastMovementDate'],
      row['negativeStockAlert'] || row['missingCostAlert'] || row['lowMarginAlert'] || row['expiryRisk'] || row['deadStock'] || ''
    ]);
    this.download(`product-in-out-retail-${Date.now()}.csv`, [columns, ...rows].map((row) => row.map((cell) => this.csvCell(cell)).join(',')).join('\n'), 'text/csv;charset=utf-8');
  }

  exportProductInOutOwnerPdf(): void {
    const summary = (this.productInOutReport()?.['summary'] || {}) as ApiRecord;
    const rows = this.productInOutRows();
    const body = [
      'Product IN/OUT Retail Owner Summary',
      `Generated: ${new Date().toLocaleString('en-IN')}`,
      `Date range: ${this.productFrom || 'All'} to ${this.productTo || 'All'}`,
      '',
      `Total products: ${summary['totalProduct'] || 0}`,
      `Total sales count: ${summary['totalSalesCount'] || 0}`,
      `Total in hand: ${summary['totalInHand'] || 0}`,
      `Revenue: INR ${summary['revenue'] || 0}`,
      `COGS: INR ${summary['cogs'] || 0}`,
      `Gross margin: INR ${summary['grossMargin'] || 0}`,
      `Negative stock: ${summary['negativeStockCount'] || 0}`,
      `Low stock: ${summary['lowStockCount'] || 0}`,
      `Reorder: ${summary['reorderCount'] || 0}`,
      '',
      ...rows.slice(0, 40).map((row, index) => `${index + 1}. ${row['product']} | sale ${row['salesCount'] || 0} | hand ${row['inHand'] || 0} | margin INR ${row['grossMargin'] || 0} | ${row['stockStatus'] || 'healthy'}`)
    ];
    this.download(`product-in-out-owner-summary-${Date.now()}.pdf`, this.simplePdf(body), 'application/pdf');
  }

  private productInOutParams(): ApiRecord {
    return {
      branchId: this.api.selectedBranchId(),
      from: this.productFrom,
      to: this.productTo,
      q: this.productSearch,
      brand: this.productBrand,
      category: this.productCategory,
      gstRate: this.productGstRate,
      stockStatus: this.productStockStatus,
      movementType: this.productMovementType,
      limit: 300
    };
  }

  private today(): string {
    return new Date().toISOString().slice(0, 10);
  }

  private monthStart(): string {
    const date = new Date();
    date.setDate(1);
    return date.toISOString().slice(0, 10);
  }

  private csvCell(value: unknown): string {
    return `"${String(value ?? '').replace(/"/g, '""')}"`;
  }

  private download(filename: string, content: BlobPart, type: string): void {
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
