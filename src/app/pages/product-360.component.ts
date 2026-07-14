import { CommonModule, DecimalPipe } from '@angular/common';
import { Component, OnInit, computed, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { ApiRecord, ApiService } from '../core/api.service';
import { StateComponent } from '../shared/ui/state/state.component';
import { AuraMoneyPipe } from '../shared/pipes/aura-money.pipe';
import { AuraDatePipe } from '../shared/pipes/aura-date.pipe';

@Component({
  selector: 'app-product-360',
  standalone: true,
  imports: [AuraDatePipe, AuraMoneyPipe, CommonModule, DecimalPipe, RouterLink, StateComponent],
  template: `
    <section class="page-stack product-360-page inner-page-shell">
      <div class="module-hero compact-hero inner-page-header">
        <div>
          <h2>{{ product()?.name || 'Product intelligence' }}</h2>
        </div>
        <div class="hero-actions inner-action-bar">
          <a class="ghost-button" routerLink="/inventory">Back to inventory</a>
          <a class="primary-button" routerLink="/inventory/purchase-orders">Create PO draft</a>
        </div>
      </div>

      <app-state [loading]="loading()" [error]="error()"></app-state>

      <ng-container *ngIf="product() as item">
        <section class="product-kpis inner-stats-grid">
          <article class="metric-card teal"><span>Current stock</span><strong>{{ item.stock || 0 }}</strong><small>Reorder at {{ item.lowStockThreshold || 0 }}</small></article>
          <article class="metric-card amber"><span>Stock value</span><strong>{{ stockValue(item) | auraMoney:'1.0-0' }}</strong></article>
          <article class="metric-card blue"><span>Gross margin</span><strong>{{ margin(item) | auraMoney:'1.0-0' }}</strong><small>{{ marginPercent(item) | number: '1.0-0' }}% on sale price</small></article>
          <article class="metric-card red"><span>Expiry risk</span><strong>{{ expiringBatches().length }}</strong><small>{{ nearestExpiry(item.id) }}</small></article>
        </section>

        <div class="product-layout">
          <section class="panel product-card aura-card inner-page-card">
            <div class="product-avatar">{{ initials(item.name) }}</div>
            <h2>{{ item.name }}</h2>
            <p>{{ item.category || 'Uncategorised' }} · {{ item.usageType || 'retail' }}</p>
            <div class="detail-list">
              <div><span>SKU / barcode</span><strong>{{ item.sku || 'Not set' }}</strong></div>
              <div><span>GST</span><strong>{{ item.gstRate || 0 }}%</strong></div>
              <div><span>Supplier</span><strong>{{ supplierName(item) }}</strong></div>
              <div><span>Branch</span><strong>{{ branchName(item.branchId) }}</strong></div>
              <div><span>Unit cost</span><strong>{{ (item.unitCost || 0) | auraMoney:'1.0-0' }}</strong></div>
              <div><span>Selling price</span><strong>{{ (item.price || 0) | auraMoney:'1.0-0' }}</strong></div>
            </div>
          </section>

          <section class="panel">
            <div class="section-title">
              <div><h2>Stockout and purchase recommendation</h2></div>
            </div>
            <div class="recommendation-card" *ngIf="recommendation() as rec; else noRecommendation">
              <strong>{{ rec.recommendedQty || 0 }} units suggested</strong>
              <span>{{ rec.reason || 'Demand or low-stock rule' }} · stockout {{ rec.predictedStockoutDate || 'not projected' }}</span>
              <small>{{ rec.estimatedCost | auraMoney:'1.0-0' }} estimated cost · approval required before supplier order</small>
              <a class="primary-button" routerLink="/inventory/purchase-orders">Open purchase order</a>
            </div>
            <ng-template #noRecommendation>
              <div class="empty-state"><strong>No active reorder risk</strong><span>Low stock, expiry or demand-based signals will appear here.</span></div>
            </ng-template>
          </section>
        </div>

        <section class="panel inner-page-card">
          <div class="section-title"><div><h2>Same product across branches</h2></div></div>
          <div class="table-wrap inner-table-wrap">
            <table>
              <thead><tr><th>Branch</th><th>Stock</th><th>Reorder level</th><th>Value</th><th>Risk</th></tr></thead>
              <tbody>
                <tr *ngFor="let row of branchStock()">
                  <td>{{ branchName(row.branchId) }}</td>
                  <td>{{ row.stock || 0 }}</td>
                  <td>{{ row.lowStockThreshold || 0 }}</td>
                  <td>{{ stockValue(row) | auraMoney:'1.0-0' }}</td>
                  <td><span class="badge" [class.warn]="isLowStock(row)">{{ isLowStock(row) ? 'low stock' : 'healthy' }}</span></td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        <div class="product-grid">
          <section class="panel">
            <div class="section-title"><div><h2>Batch, expiry and supplier trail</h2></div></div>
            <div class="timeline">
              <article *ngFor="let batch of productBatches()">
                <strong>{{ batch.batchNumber || batch.id }}</strong>
                <span>{{ batch.quantityAvailable || 0 }} left of {{ batch.quantityReceived || 0 }} · expires {{ batch.expiryDate || 'not set' }}</span>
                <small>{{ supplierNameFromId(batch.supplierId) }} · {{ batch.unitCost | auraMoney:'1.0-0' }} unit cost</small>
              </article>
              <article *ngIf="!productBatches().length"><strong>No batch received yet</strong><span>Purchase receiving will create FIFO batch entries here.</span></article>
            </div>
          </section>

          <section class="panel inner-page-card">
            <div class="section-title"><div><h2>POS sales and service consumption</h2></div></div>
            <div class="mini-metrics">
              <div><span>POS sold</span><strong>{{ productSaleUsage(item.id) }}</strong></div>
              <div><span>Service used</span><strong>{{ productServiceUsage(item.id) }}</strong></div>
              <div><span>Waste/write-off</span><strong>{{ wasteUsage(item.id) }}</strong></div>
              <div><span>Movement rows</span><strong>{{ productMovements().length }}</strong></div>
            </div>
            <div class="timeline mini">
              <article *ngFor="let row of productMovements().slice(0, 8)">
                <strong>{{ row.type }}</strong>
                <span>{{ row.quantity }} units · {{ row.reason || row.referenceType || 'movement' }}</span>
                <small>{{ row.createdAt | auraDate:'date' }}</small>
              </article>
            </div>
          </section>
        </div>

        <section class="panel inner-page-card">
          <div class="section-title"><div><h2>Service-wise usage and cost</h2></div></div>
          <div class="mini-metrics">
            <div><span>Purchase rate</span><strong>{{ (item.unitCost || 0) | auraMoney:'1.2-2' }}</strong></div>
            <div><span>Used in services</span><strong>{{ consumeReportTotals().serviceCount || 0 }}</strong></div>
            <div><span>Total used</span><strong>{{ consumeReportTotals().totalQuantityText || '0' }}</strong></div>
            <div><span>Consume value</span><strong>{{ (consumeReportTotals().totalCost || 0) | auraMoney:'1.2-2' }}</strong></div>
          </div>
          <div class="table-wrap" *ngIf="serviceConsumeRows().length; else noConsumeReport">
            <table>
              <thead><tr><th>Service</th><th>Times</th><th>Qty used</th><th>Value</th><th>Last used</th></tr></thead>
              <tbody>
                <tr *ngFor="let row of serviceConsumeRows()">
                  <td>{{ row.serviceName || 'Service' }}</td>
                  <td>{{ row.times || 0 }}</td>
                  <td>{{ row.quantityText || '0' }}</td>
                  <td>{{ (row.cost || 0) | auraMoney:'1.2-2' }}</td>
                  <td>{{ row.lastUsedAt | auraDate:'date' }}</td>
                </tr>
              </tbody>
            </table>
            <div class="timeline mini consume-entry-list">
              <article *ngFor="let entry of consumeEntries().slice(0, 6)">
                <strong>{{ entry.serviceName || 'Service' }} · {{ entry.quantity || 0 }} {{ entry.unit || item.unit || 'pcs' }}</strong>
                <span>{{ entry.invoiceNumber || entry.draftId }} · {{ entry.clientName || 'Walk-in client' }} · {{ (entry.cost || 0) | auraMoney:'1.2-2' }}</span>
                <small>{{ entry.staffName || 'Unassigned' }} · {{ entry.usedAt | auraDate:'date' }}</small>
              </article>
            </div>
          </div>
          <ng-template #noConsumeReport>
            <div class="empty-state"><strong>No confirmed consume found</strong><span>Confirmed Product Consume drafts for this product will appear here.</span></div>
          </ng-template>
        </section>

        <section class="panel control-ledger-panel">
          <div class="section-title">
            <div><h2>Every ml, gram, container, client and staff in one report</h2></div>
          </div>
          <div class="control-card-grid">
            <article *ngFor="let card of controlCards()" [class.attention]="card['status'] === 'attention'" [class.clean]="card['status'] === 'clean'">
              <span>{{ card['label'] }}</span>
              <strong>{{ card['metric'] }}</strong>
              <small>{{ card['status'] }}</small>
            </article>
          </div>
          <div class="mini-metrics">
            <div><span>Client use</span><strong>{{ backbarSummary()['clientUsedText'] || '0' }}</strong></div>
            <div><span>Waste / adjust</span><strong>{{ backbarSummary()['wastageText'] || '0' }}</strong></div>
            <div><span>Pending approvals</span><strong>{{ backbarSummary()['pendingApprovals'] || 0 }}</strong></div>
            <div><span>Profit impact</span><strong>{{ (backbarSummary()['actualProfit'] || 0) | auraMoney:'1.2-2' }}</strong></div>
          </div>
          <div class="control-ledger-grid">
            <div class="table-wrap inner-table-wrap">
              <table>
                <thead><tr><th>Service</th><th>Used</th><th>Product cost</th><th>Revenue</th><th>Profit</th></tr></thead>
                <tbody>
                  <tr *ngFor="let row of ledgerServiceUsage().slice(0, 8)">
                    <td>{{ row['serviceName'] || 'Service' }}</td>
                    <td>{{ row['totalUsedText'] || '0' }}</td>
                    <td>{{ (row['productCost'] || row['cost'] || 0) | auraMoney:'1.2-2' }}</td>
                    <td>{{ (row['serviceRevenue'] || 0) | auraMoney:'1.2-2' }}</td>
                    <td>{{ (row['actualProfit'] || 0) | auraMoney:'1.2-2' }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <div class="ledger-side">
              <article>
                <strong>Staff accountability</strong>
                <span *ngFor="let row of ledgerStaffUsage().slice(0, 4)">{{ row['staffName'] || 'Unassigned' }} · {{ row['totalUsedText'] || '0' }} · {{ (row['cost'] || 0) | auraMoney:'1.0-0' }}</span>
                <small *ngIf="!ledgerStaffUsage().length">No staff usage yet</small>
              </article>
              <article>
                <strong>Client history</strong>
                <span *ngFor="let row of ledgerClientUsage().slice(0, 4)">{{ row['clientName'] || 'Walk-in client' }} · {{ row['invoiceNumber'] || 'invoice' }} · {{ row['totalUsedText'] || '0' }}</span>
                <small *ngIf="!ledgerClientUsage().length">No client usage yet</small>
              </article>
              <article>
                <strong>Waste / exception split</strong>
                <span *ngFor="let row of ledgerWastageRows().slice(0, 4)">{{ row['usageType'] || 'adjustment' }} · {{ row['totalUsedText'] || '0' }} · {{ (row['cost'] || 0) | auraMoney:'1.0-0' }}</span>
                <small *ngIf="!ledgerWastageRows().length">No waste entries</small>
              </article>
              <article>
                <strong>Approval queue</strong>
                <span *ngFor="let row of ledgerApprovals().slice(0, 4)">{{ row['status'] }} · #{{ row['activeContainerNo'] }} · {{ row['activeBalanceQty'] }} {{ row['measureUnit'] }}</span>
                <small *ngIf="!ledgerApprovals().length">No override approval history</small>
              </article>
            </div>
          </div>
          <div class="timeline mini entity-ledger">
            <article *ngFor="let event of entityLedger().slice(0, 10)">
              <strong>{{ event['title'] || event['entityType'] }}</strong>
              <span>{{ event['detail'] || event['entityId'] }}</span>
              <small>{{ event['entityType'] }} · {{ event['eventAt'] | auraDate:'date' }}</small>
            </article>
          </div>
        </section>

        <section class="panel">
          <div class="section-title"><div><h2>Backbar container trail</h2></div></div>
          <div class="mini-metrics">
            <div><span>Sealed stock</span><strong>{{ backbarSummary()['sealedStock'] || 0 }}</strong></div>
            <div><span>Open containers</span><strong>{{ backbarSummary()['openContainers'] || 0 }}</strong></div>
            <div><span>Total used</span><strong>{{ backbarSummary()['totalUsedText'] || '0' }}</strong></div>
            <div><span>Usage value</span><strong>{{ (backbarSummary()['usageCost'] || 0) | auraMoney:'1.2-2' }}</strong></div>
          </div>
          <div class="backbar-container-list" *ngIf="backbarContainers().length; else noBackbarHistory">
            <article *ngFor="let container of backbarContainers()">
              <div class="container-head">
                <div>
                  <strong>{{ container['containerCode'] || container['id'] }}</strong>
                  <span>{{ container['status'] || 'open' }} · {{ container['usedQuantity'] || 0 }} {{ container['measureUnit'] }} used · {{ container['balanceQuantity'] || 0 }} {{ container['measureUnit'] }} left</span>
                </div>
                <small>{{ container['openedAt'] | auraDate:'date' }}</small>
              </div>
              <div class="timeline mini" *ngIf="backbarEntries(container).length">
                <article *ngFor="let entry of backbarEntries(container).slice(0, 8)">
                  <strong>{{ entry['clientName'] || entry['usageType'] || 'Usage' }} · {{ entry['usedQuantity'] || 0 }} {{ entry['unit'] || container['measureUnit'] }}</strong>
                  <span>{{ entry['serviceName'] || entry['reason'] || entry['draftId'] || 'Backbar use' }} · balance {{ entry['balanceAfter'] || 0 }} {{ entry['unit'] || container['measureUnit'] }}</span>
                  <small>{{ entry['staffName'] || 'Unassigned' }} · {{ entry['usedAt'] | auraDate:'date' }}</small>
                </article>
              </div>
            </article>
          </div>
          <ng-template #noBackbarHistory>
            <div class="empty-state"><strong>No backbar container history</strong><span>Tube, bottle, jar and bulk-product consumption will appear here after Product Consume entries.</span></div>
          </ng-template>
        </section>

        <div class="product-grid">
          <section class="panel">
            <div class="section-title"><div><h2>Services using this product</h2></div></div>
            <div class="timeline mini">
              <article *ngFor="let service of servicesUsingProduct()">
                <strong>{{ service.name }}</strong>
                <span>{{ service.category || 'Service' }} · auto-deduct ready when service completes</span>
              </article>
              <article *ngIf="!servicesUsingProduct().length"><strong>No recipe linked</strong><span>Add this product to service requiredProducts JSON to enable exact professional stock deduction.</span></article>
            </div>
          </section>

          <section class="panel">
            <div class="section-title"><div><h2>Invoices that used this product</h2></div></div>
            <div class="timeline mini">
              <article *ngFor="let sale of productSales().slice(0, 8)">
                <strong>{{ sale.invoiceNumber || sale.id }}</strong>
                <span>{{ sale.clientName || 'Walk-in client' }} · {{ (sale.total || sale.grandTotal || 0) | auraMoney:'1.0-0' }}</span>
                <small>{{ sale.createdAt | auraDate:'date' }}</small>
              </article>
              <article *ngIf="!productSales().length"><strong>No POS sale found</strong><span>Retail product invoices will appear here.</span></article>
            </div>
          </section>
        </div>
      </ng-container>
    </section>
  `,
  styles: [`
    .compact-hero,
    .hero-actions,
    .section-title {
      align-items: center;
    }

    .hero-actions {
      display: flex;
      gap: 8px;
      justify-content: flex-end;
    }

    .product-kpis,
    .product-grid {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 12px;
    }

    .product-grid {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }

    .product-layout {
      display: grid;
      grid-template-columns: 360px minmax(0, 1fr);
      gap: 12px;
    }

    .product-card {
      display: grid;
      gap: 10px;
    }

    .product-avatar {
      width: 96px;
      height: 96px;
      border-radius: 24px;
      display: grid;
      place-items: center;
      background: #d8f3ee;
      color: #064e45;
      font-size: 1.8rem;
      font-weight: 800;
    }

    .detail-list,
    .mini-metrics {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 10px;
    }

    .detail-list div,
    .mini-metrics div,
    .recommendation-card {
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 12px;
      background: #fff;
    }

    .detail-list span,
    .mini-metrics span,
    .recommendation-card span,
    .recommendation-card small {
      display: block;
      color: var(--muted);
      margin-top: 3px;
    }

    .control-ledger-panel {
      display: grid;
      gap: 14px;
    }

    .control-card-grid {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 10px;
    }

    .control-card-grid article {
      border: 1px solid var(--border);
      border-radius: 10px;
      padding: 12px;
      background: #fff;
      display: grid;
      gap: 4px;
    }

    .control-card-grid article.attention {
      border-color: #fecdd3;
      background: #fff1f2;
    }

    .control-card-grid article.clean {
      border-color: #FBF0E8;
      background: #FBF0E8;
    }

    .control-card-grid span,
    .control-card-grid small {
      color: var(--muted);
      font-size: .82rem;
      font-weight: 700;
      text-transform: uppercase;
    }

    .control-ledger-grid {
      display: grid;
      grid-template-columns: minmax(0, 1.4fr) minmax(300px, .8fr);
      gap: 12px;
      align-items: stretch;
    }

    .ledger-side {
      display: grid;
      gap: 8px;
    }

    .ledger-side article {
      border: 1px solid var(--border);
      border-radius: 10px;
      padding: 11px;
      background: #fff;
      display: grid;
      gap: 4px;
    }

    .ledger-side span,
    .ledger-side small {
      color: var(--muted);
    }

    .entity-ledger {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }

    .recommendation-card {
      display: grid;
      gap: 8px;
      border-color: rgba(75, 18, 56, 0.28);
      background: #FBF0E8;
    }

    .table-wrap {
      overflow: auto;
    }

    table {
      min-width: 780px;
    }

    .timeline {
      display: grid;
      gap: 8px;
    }

    .backbar-container-list {
      display: grid;
      gap: 10px;
      margin-top: 12px;
    }

    .backbar-container-list > article {
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 12px;
      background: #fff;
    }

    .container-head {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 12px;
      margin-bottom: 10px;
    }

    .container-head span,
    .container-head small {
      display: block;
      color: var(--muted);
      margin-top: 3px;
    }

    .consume-entry-list {
      margin-top: 12px;
    }

    .timeline article {
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 11px 12px;
      background: #fff;
    }

    .timeline span,
    .timeline small {
      display: block;
      color: var(--muted);
      margin-top: 3px;
    }

    .badge.warn {
      background: #fff3d8;
      color: #7c4d00;
    }

    .empty-state {
      display: grid;
      gap: 4px;
      color: var(--muted);
    }

    .empty-state strong {
      color: var(--ink);
    }

    @media (max-width: 1180px) {
      .product-kpis,
      .product-layout,
      .product-grid,
      .control-card-grid,
      .control-ledger-grid,
      .entity-ledger {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }
    }

    @media (max-width: 760px) {
      .product-kpis,
      .product-layout,
      .product-grid,
      .control-card-grid,
      .control-ledger-grid,
      .entity-ledger,
      .detail-list,
      .mini-metrics {
        grid-template-columns: 1fr;
      }
    }
  `]
})
export class Product360Component implements OnInit {
  readonly product = signal<ApiRecord | null>(null);
  readonly products = signal<ApiRecord[]>([]);
  readonly branches = signal<ApiRecord[]>([]);
  readonly suppliers = signal<ApiRecord[]>([]);
  readonly batches = signal<ApiRecord[]>([]);
  readonly transactions = signal<ApiRecord[]>([]);
  readonly sales = signal<ApiRecord[]>([]);
  readonly services = signal<ApiRecord[]>([]);
  readonly intelligence = signal<ApiRecord | null>(null);
  readonly productConsumeReport = signal<ApiRecord | null>(null);
  readonly backbarProductReport = signal<ApiRecord | null>(null);
  readonly loading = signal(true);
  readonly error = signal('');

  readonly productBatches = computed(() => {
    const product = this.product();
    return product ? this.batches().filter((batch) => batch.productId === product.id).sort((a, b) => String(a.expiryDate || '9999-12-31').localeCompare(String(b.expiryDate || '9999-12-31'))) : [];
  });

  readonly productMovements = computed(() => {
    const product = this.product();
    return product
      ? this.transactions().filter((row) => row.productId === product.id).slice().sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))
      : [];
  });

  readonly branchStock = computed(() => {
    const product = this.product();
    if (!product) return [];
    const key = this.productKey(product);
    return this.products().filter((item) => this.productKey(item) === key);
  });

  readonly recommendation = computed(() => {
    const product = this.product();
    const suggestions = (this.intelligence()?.['suggestions'] || []) as ApiRecord[];
    return product ? suggestions.find((item) => item.productId === product.id) || null : null;
  });

  readonly expiringBatches = computed(() => this.productBatches().filter((batch) => batch.expiryDate && this.daysUntil(batch.expiryDate) <= 60));

  constructor(
    private readonly api: ApiService,
    private readonly route: ActivatedRoute
  ) {}

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    const productId = this.route.snapshot.paramMap.get('id') || '';
    this.loading.set(true);
    this.error.set('');
    Promise.all([
      firstValueFrom(this.api.get<ApiRecord>('products', productId)),
      firstValueFrom(this.api.list<ApiRecord[]>('products', { limit: 10000 })),
      firstValueFrom(this.api.list<ApiRecord[]>('branches', { limit: 1000 })),
      firstValueFrom(this.api.list<ApiRecord[]>('suppliers', { limit: 1000 })),
      firstValueFrom(this.api.list<ApiRecord[]>('inventoryBatches', { limit: 1000 })),
      firstValueFrom(this.api.list<ApiRecord[]>('inventory', { limit: 1000 })),
      firstValueFrom(this.api.list<ApiRecord[]>('sales', { limit: 1000 })),
      firstValueFrom(this.api.list<ApiRecord[]>('services', { limit: 1000 })),
      firstValueFrom(this.api.list<ApiRecord>('inventory-intelligence/summary', { branchId: this.api.selectedBranchId() })),
      firstValueFrom(this.api.list<ApiRecord>(`inventory-intelligence/product-consume-report/${productId}`, { limit: 1000 })),
      firstValueFrom(this.api.list<ApiRecord>(`inventory-intelligence/backbar-products/${productId}/report`, { branchId: this.api.selectedBranchId(), limit: 200 }))
    ]).then(([product, products, branches, suppliers, batches, transactions, sales, services, intelligence, consumeReport, backbarReport]) => {
      this.product.set(product);
      this.products.set(products || []);
      this.branches.set(branches || []);
      this.suppliers.set(suppliers || []);
      this.batches.set(batches || []);
      this.transactions.set(transactions || []);
      this.sales.set(sales || []);
      this.services.set(services || []);
      this.intelligence.set(intelligence || null);
      this.productConsumeReport.set(consumeReport || null);
      this.backbarProductReport.set(backbarReport || null);
      this.loading.set(false);
    }).catch((error) => {
      this.error.set(error?.error?.error || error?.message || 'Unable to load Product 360');
      this.loading.set(false);
    });
  }

  stockValue(product: ApiRecord): number {
    return Number(product.stock || 0) * Number(product.unitCost || product.price || 0);
  }

  margin(product: ApiRecord): number {
    return Number(product.price || 0) - Number(product.unitCost || 0);
  }

  marginPercent(product: ApiRecord): number {
    const price = Number(product.price || 0);
    return price ? (this.margin(product) / price) * 100 : 0;
  }

  isLowStock(product: ApiRecord): boolean {
    return Number(product.stock || 0) <= Number(product.lowStockThreshold || 0);
  }

  supplierName(product: ApiRecord): string {
    if (product.supplier) return product.supplier;
    const batch = this.batches().find((row) => row.productId === product.id && row.supplierId);
    return this.supplierNameFromId(batch?.supplierId || '');
  }

  supplierNameFromId(id: string): string {
    if (!id) return 'Not linked';
    return this.suppliers().find((supplier) => supplier.id === id)?.name || id;
  }

  branchName(id: string): string {
    return this.branches().find((branch) => branch.id === id)?.name || id || 'All branches';
  }

  nearestExpiry(productId: string): string {
    const expiry = this.batches()
      .filter((batch) => batch.productId === productId && Number(batch.quantityAvailable || 0) > 0 && batch.expiryDate)
      .map((batch) => String(batch.expiryDate))
      .sort()[0];
    return expiry || this.product()?.expiryDate || 'No expiry set';
  }

  productSaleUsage(productId: string): number {
    return Math.abs(this.transactions().filter((row) => row.productId === productId && String(row.type || '').includes('sale')).reduce((total, row) => total + Number(row.quantity || 0), 0));
  }

  productServiceUsage(productId: string): number {
    return Math.abs(this.transactions().filter((row) => row.productId === productId && String(row.type || '').includes('service')).reduce((total, row) => total + Number(row.quantity || 0), 0));
  }

  wasteUsage(productId: string): number {
    return Math.abs(this.transactions().filter((row) => {
      const text = `${row.type || ''} ${row.reason || ''}`.toLowerCase();
      return row.productId === productId && (text.includes('waste') || text.includes('expiry') || text.includes('damage'));
    }).reduce((total, row) => total + Number(row.quantity || 0), 0));
  }

  servicesUsingProduct(): ApiRecord[] {
    const product = this.product();
    if (!product) return [];
    return this.services().filter((service) => {
      const required = this.asArray(service.requiredProducts);
      return required.some((item) => item.productId === product.id || item.id === product.id);
    });
  }

  productSales(): ApiRecord[] {
    const product = this.product();
    if (!product) return [];
    return this.sales().filter((sale) => this.asArray(sale.items).some((item) => item.productId === product.id || item.id === product.id || item.name === product.name));
  }

  consumeReportTotals(): ApiRecord {
    return (this.productConsumeReport()?.['totals'] || {}) as ApiRecord;
  }

  serviceConsumeRows(): ApiRecord[] {
    return (this.productConsumeReport()?.['serviceSummary'] || []) as ApiRecord[];
  }

  consumeEntries(): ApiRecord[] {
    return (this.productConsumeReport()?.['entries'] || []) as ApiRecord[];
  }

  backbarSummary(): ApiRecord {
    return (this.backbarProductReport()?.['summary'] || {}) as ApiRecord;
  }

  backbarContainers(): ApiRecord[] {
    return (this.backbarProductReport()?.['containers'] || []) as ApiRecord[];
  }

  backbarEntries(container: ApiRecord): ApiRecord[] {
    return (container?.['entries'] || []) as ApiRecord[];
  }

  controlCards(): ApiRecord[] {
    return (this.backbarProductReport()?.['reportCards'] || []) as ApiRecord[];
  }

  ledgerServiceUsage(): ApiRecord[] {
    return (this.backbarProductReport()?.['serviceUsage'] || []) as ApiRecord[];
  }

  ledgerStaffUsage(): ApiRecord[] {
    return (this.backbarProductReport()?.['staffUsage'] || []) as ApiRecord[];
  }

  ledgerClientUsage(): ApiRecord[] {
    return (this.backbarProductReport()?.['clientUsage'] || []) as ApiRecord[];
  }

  ledgerWastageRows(): ApiRecord[] {
    return (this.backbarProductReport()?.['wastageByType'] || []) as ApiRecord[];
  }

  ledgerApprovals(): ApiRecord[] {
    return (this.backbarProductReport()?.['approvals'] || []) as ApiRecord[];
  }

  entityLedger(): ApiRecord[] {
    return (this.backbarProductReport()?.['entityLedger'] || []) as ApiRecord[];
  }

  initials(value = ''): string {
    return String(value).split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase() || 'P';
  }

  private asArray(value: unknown): ApiRecord[] {
    if (Array.isArray(value)) return value as ApiRecord[];
    if (typeof value !== 'string' || !value.trim()) return [];
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  private productKey(product: ApiRecord): string {
    return String(product.sku || product.name || '').toLowerCase().trim();
  }

  private daysUntil(value: string): number {
    const time = new Date(value).getTime();
    if (!value || Number.isNaN(time)) return 9999;
    return Math.round((time - Date.now()) / 86400000);
  }
}
