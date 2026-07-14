import { CommonModule, DecimalPipe } from '@angular/common';
import { Component, OnInit, computed, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { ApiRecord, ApiService } from '../core/api.service';
import { StateComponent } from '../shared/ui/state/state.component';
import { AuraMoneyPipe } from '../shared/pipes/aura-money.pipe';
import { AuraDatePipe } from '../shared/pipes/aura-date.pipe';

@Component({
  selector: 'app-supplier-360',
  standalone: true,
  imports: [AuraDatePipe, AuraMoneyPipe, CommonModule, DecimalPipe, RouterLink, StateComponent],
  template: `
    <section class="page-stack supplier-360-page inner-page-shell">
      <div class="module-hero compact-hero inner-page-header">
        <div>
          <h2>{{ supplier()?.name || 'Supplier details' }}</h2>
        </div>
        <div class="hero-actions inner-action-bar">
          <a class="ghost-button" routerLink="/suppliers">Back to suppliers</a>
          <a class="primary-button" routerLink="/inventory/purchase-orders">Open purchase orders</a>
        </div>
      </div>

      <app-state [loading]="loading()" [error]="error()"></app-state>

      <ng-container *ngIf="supplier() as vendor">
        <section class="supplier-kpis inner-stats-grid">
          <article class="metric-card teal"><span>Supplier score</span><strong>{{ supplierScore() | number: '1.0-0' }}</strong></article>
          <article class="metric-card blue"><span>Total purchase</span><strong>{{ purchaseValue() | auraMoney:'1.0-0' }}</strong><small>{{ purchaseTransactions().length }} purchase entries</small></article>
          <article class="metric-card amber"><span>Open PO</span><strong>{{ openPurchaseOrders().length }}</strong><small>{{ pendingRecommendations().length }} reorder signals</small></article>
          <article class="metric-card red"><span>Quality issues</span><strong>{{ qualityIssues().length }}</strong></article>
          <article class="metric-card green"><span>GRN reliability</span><strong>{{ grnReliabilityScore() | number: '1.0-0' }}</strong><small>{{ receivedPurchaseOrders().length }} received PO</small></article>
          <article class="metric-card violet"><span>PO variance</span><strong>{{ poVarianceRows().length }}</strong></article>
          <article class="metric-card amber"><span>Payable watch</span><strong>{{ outstandingValue() | auraMoney:'1.0-0' }}</strong><small>{{ creditDaysOverdue() }} credit day(s) overdue</small></article>
          <article class="metric-card blue"><span>WhatsApp log</span><strong>{{ supplierWhatsappLogs().length }}</strong></article>
        </section>

        <div class="supplier-layout">
          <section class="panel supplier-card inner-page-card">
            <div class="supplier-avatar">{{ initials(supplierDisplayName(vendor)) }}</div>
            <h2>{{ supplierDisplayName(vendor) }}</h2>
            <p>{{ vendor.status || 'active' }} vendor · GST-ready master</p>
            <div class="detail-list">
              <div><span>Contact</span><strong>{{ vendor.contactName || 'Not set' }}</strong></div>
              <div><span>Phone</span><strong>{{ vendor.phone || 'No phone' }}</strong></div>
              <div><span>Email</span><strong>{{ vendor.email || 'No email' }}</strong></div>
              <div><span>GSTIN</span><strong>{{ vendor.gstin || 'Not captured' }}</strong></div>
              <div><span>Payment terms</span><strong>{{ paymentTerms() }}</strong></div>
              <div><span>Last purchase</span><strong>{{ lastPurchaseDate() }}</strong></div>
              <div><span>Outstanding</span><strong>{{ outstandingValue() | auraMoney:'1.0-0' }}</strong></div>
              <div><span>Replacement supplier</span><strong>{{ replacementSupplier() }}</strong></div>
              <div><span>Address</span><strong>{{ vendor.address || 'Not captured' }}</strong></div>
            </div>
          </section>

          <section class="panel inner-page-card">
            <div class="section-title">
              <div><h2>Approval-safe draft</h2></div>
              <button class="ghost-button" type="button" (click)="buildWhatsAppDraft(vendor)">Build draft</button>
            </div>
            <div class="mini-metrics tight">
              <div><span>Draft products</span><strong>{{ poDraftItems().length }}</strong></div>
              <div><span>Draft value</span><strong>{{ poDraftTotal() | auraMoney:'1.0-0' }}</strong></div>
              <div><span>Expected delivery</span><strong>{{ expectedDeliveryLabel() }}</strong></div>
              <div><span>GST note</span><strong>Invoice required</strong></div>
            </div>
            <div class="draft-box" *ngIf="whatsappDraft(); else noDraft">{{ whatsappDraft() }}</div>
            <ng-template #noDraft>
              <div class="empty-state"><strong>No draft generated</strong><span>Build a draft after PO approval. Message is not sent automatically.</span></div>
            </ng-template>
          </section>
        </div>

        <section class="panel inner-page-card">
          <div class="section-title"><div><h2>GSTIN, contact, invoice, status and mapping quality</h2></div></div>
          <div class="status-matrix">
            <span class="mini-status" [class.ok]="!complianceIssues().length" [class.warn]="complianceIssues().length">{{ complianceIssues().length ? complianceIssues().join(', ') : 'Compliance ready' }}</span>
            <span class="mini-status" [class.ok]="!mappingWarnings().length" [class.warn]="mappingWarnings().length">{{ mappingWarnings().length ? mappingWarnings().join(', ') : 'Product mapping ready' }}</span>
            <span class="mini-status" [class.ok]="paymentTerms() !== 'Payment terms missing'" [class.warn]="paymentTerms() === 'Payment terms missing'">{{ paymentTerms() }}</span>
            <span class="mini-status" [class.ok]="!creditDaysOverdue()" [class.warn]="creditDaysOverdue()">{{ creditDaysOverdue() ? creditDaysOverdue() + ' credit day(s) overdue' : 'Credit clear' }}</span>
          </div>
        </section>

        <section class="panel inner-page-card">
          <div class="section-title"><div><h2>Low-stock products to order from this supplier</h2></div></div>
          <div class="table-wrap inner-table-wrap">
            <table>
              <thead><tr><th>Product</th><th>Qty</th><th>Unit cost</th><th>Total</th><th>Reason</th></tr></thead>
              <tbody>
                <tr *ngFor="let item of poDraftItems()">
                  <td>{{ item.productName }}</td>
                  <td>{{ item.quantity }}</td>
                  <td>{{ item.unitCost | auraMoney:'1.0-0' }}</td>
                  <td>{{ item.totalCost | auraMoney:'1.0-0' }}</td>
                  <td>{{ item.reason }}</td>
                </tr>
                <tr *ngIf="!poDraftItems().length"><td colspan="5">No low-stock recommendation for this supplier right now.</td></tr>
              </tbody>
            </table>
          </div>
        </section>

        <div class="supplier-grid">
          <section class="panel inner-page-card">
            <div class="section-title"><div><h2>Purchase recommendations for this supplier</h2></div></div>
            <div class="timeline">
              <article *ngFor="let row of pendingRecommendations()">
                <strong>{{ productName(row.productId || row['product_id']) }}</strong>
                <span>{{ row.quantity || row.recommendedQty || row.recommended_qty || 0 }} units · {{ (row.estimatedCost || row.estimated_cost || 0) | auraMoney:'1.0-0' }} · {{ row.status || 'pending approval' }}</span>
                <small>{{ row.recommendationText || row.reason || 'Reorder recommendation' }}</small>
              </article>
              <article *ngIf="!pendingRecommendations().length"><strong>No pending PO</strong><span>Reorder drafts linked to this supplier will appear here.</span></article>
            </div>
          </section>

          <section class="panel inner-page-card">
            <div class="section-title"><div><h2>Same product, supplier-wise rate</h2></div></div>
            <div class="table-wrap inner-table-wrap">
              <table>
                <thead><tr><th>Product</th><th>This supplier</th><th>Best supplier</th><th>Saving</th><th>Signal</th></tr></thead>
                <tbody>
                  <tr *ngFor="let row of priceComparisonRows()">
                    <td>{{ row.productName }}</td>
                    <td>{{ row.currentCost | auraMoney:'1.2-2' }}</td>
                    <td>{{ row.bestSupplierName }} · {{ row.bestCost | auraMoney:'1.2-2' }}</td>
                    <td>{{ row.savingPct | number: '1.0-1' }}%</td>
                    <td><span class="badge" [class.warn]="row.savingPct > 0">{{ row.savingPct > 0 ? 'cheaper available' : 'best / stable' }}</span></td>
                  </tr>
                  <tr *ngIf="!priceComparisonRows().length"><td colspan="5">No comparable supplier purchase rates yet.</td></tr>
                </tbody>
              </table>
            </div>
            <div class="timeline mini price-change-list">
              <article *ngFor="let row of priceChangeRows()">
                <strong>{{ productName(row.productId) }}</strong>
                <span>{{ row.previousCost | auraMoney:'1.0-0' }} to {{ row.latestCost | auraMoney:'1.0-0' }} · {{ row.changePct | number: '1.0-1' }}%</span>
                <small>{{ row.status }}</small>
              </article>
              <article *ngIf="!priceChangeRows().length"><strong>No price change history</strong><span>At least two purchase entries are needed for movement.</span></article>
            </div>
          </section>
        </div>

        <section class="panel">
          <div class="section-title"><div><h2>Receive performance and variance trail</h2></div></div>
          <div class="mini-metrics">
            <div><span>Received PO</span><strong>{{ receivedPurchaseOrders().length }}</strong></div>
            <div><span>Open PO</span><strong>{{ openPurchaseOrders().length }}</strong></div>
            <div><span>GRN with variance</span><strong>{{ poVarianceRows().length }}</strong></div>
            <div><span>Reliability score</span><strong>{{ grnReliabilityScore() | number: '1.0-0' }}</strong></div>
            <div><span>On-time</span><strong>{{ reliabilityBreakdown().onTimePct | number: '1.0-0' }}%</strong></div>
            <div><span>Damage</span><strong>{{ reliabilityBreakdown().damagePct | number: '1.0-0' }}%</strong></div>
            <div><span>Return</span><strong>{{ reliabilityBreakdown().returnPct | number: '1.0-0' }}%</strong></div>
            <div><span>Invoice mismatch</span><strong>{{ reliabilityBreakdown().invoiceMismatchPct | number: '1.0-0' }}%</strong></div>
          </div>
          <div class="table-wrap">
            <table>
              <thead><tr><th>PO</th><th>Status</th><th>Order value</th><th>GRN</th><th>Received</th><th>Variance</th></tr></thead>
              <tbody>
                <tr *ngFor="let po of supplierPurchaseOrders().slice(0, 8)">
                  <td>{{ po.poNumber || po.po_number || po.id }}</td>
                  <td><span class="badge" [class.warn]="poVarianceCount(po) > 0">{{ po.status || 'draft' }}</span></td>
                  <td>{{ poValue(po) | auraMoney:'1.0-0' }}</td>
                  <td>{{ po.grnNumber || po.grn_number || 'Not received' }}</td>
                  <td>{{ poReceivedDate(po) | auraDate:'date' }}</td>
                  <td>{{ poVarianceCount(po) }} signal(s)</td>
                </tr>
                <tr *ngIf="!supplierPurchaseOrders().length"><td colspan="6">No purchase orders linked to this supplier yet.</td></tr>
              </tbody>
            </table>
          </div>
        </section>

        <section class="panel">
          <div class="section-title"><div><h2>Payable, credit days and last payment</h2></div></div>
          <div class="mini-metrics">
            <div><span>Estimated payable</span><strong>{{ outstandingValue() | auraMoney:'1.0-0' }}</strong></div>
            <div><span>Payment terms</span><strong>{{ paymentTerms() }}</strong></div>
            <div><span>Credit overdue</span><strong>{{ creditDaysOverdue() }}</strong></div>
            <div><span>Last payment</span><strong>{{ lastPaymentDate() }}</strong></div>
          </div>
        </section>

        <section class="panel">
          <div class="section-title"><div><h2>Supplier ordering message history</h2></div></div>
          <div class="timeline mini">
            <article *ngFor="let row of supplierWhatsappLogs().slice(0, 8)">
              <strong>{{ row.status || 'draft' }}</strong>
              <span>{{ row.message || row.body || row.notes || 'Supplier order draft' }}</span>
              <small>{{ row.createdAt || row.created_at || row.updatedAt || row.updated_at || 'live queue' }}</small>
            </article>
            <article *ngIf="!supplierWhatsappLogs().length"><strong>No WhatsApp log</strong><span>Supplier PO drafts from this page will appear in queue history when available.</span></article>
          </div>
        </section>

        <div class="supplier-grid">
          <section class="panel">
            <div class="section-title"><div><h2>Branch stock and batch quality</h2></div></div>
            <div class="table-wrap">
              <table>
                <thead><tr><th>Product</th><th>Stock</th><th>Branch</th><th>Expiry</th><th>Mapping</th><th>Risk</th></tr></thead>
                <tbody>
                  <tr *ngFor="let product of suppliedProducts()">
                    <td><a [routerLink]="['/inventory/products', product.id]">{{ product.name }}</a></td>
                    <td>{{ product.stock || 0 }}</td>
                    <td>{{ branchName(product.branchId || product.branch_id) }}</td>
                    <td>{{ nearestExpiry(product.id) }}</td>
                    <td>{{ productMappingLabel(product) }}</td>
                    <td><span class="badge" [class.warn]="isLowStock(product)">{{ isLowStock(product) ? 'low stock' : 'ok' }}</span></td>
                  </tr>
                  <tr *ngIf="!suppliedProducts().length"><td colspan="6">No products linked to this supplier yet.</td></tr>
                </tbody>
              </table>
            </div>
          </section>

          <section class="panel">
            <div class="section-title"><div><h2>Expiry, waste and replacement risk</h2></div></div>
            <div class="timeline mini">
              <article *ngFor="let row of qualityIssues()">
                <strong>{{ productName(row.productId || row.product_id) }}</strong>
                <span>{{ row.reason || 'Supplier quality watch' }}</span>
                <small>{{ row.expiryDate || row.expiry_date || row.createdAt || row.created_at || 'live signal' }}</small>
              </article>
              <article *ngIf="!qualityIssues().length"><strong>No quality issues</strong><span>Expiry, waste and purchase anomalies will appear here.</span></article>
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
      flex-wrap: wrap;
      gap: 8px;
      justify-content: flex-end;
    }

    .supplier-kpis,
    .supplier-grid {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 12px;
    }

    .supplier-grid {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }

    .supplier-layout {
      display: grid;
      grid-template-columns: 360px minmax(0, 1fr);
      gap: 12px;
    }

    .supplier-card {
      display: grid;
      gap: 10px;
    }

    .supplier-avatar {
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

    .detail-list {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 10px;
    }

    .mini-metrics {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 10px;
      margin-bottom: 12px;
    }

    .mini-metrics.tight {
      margin-bottom: 10px;
    }

    .status-matrix {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }

    .detail-list div,
    .mini-metrics div,
    .draft-box {
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 12px;
      background: #fff;
    }

    .detail-list span,
    .mini-metrics span {
      display: block;
      color: var(--muted);
      margin-bottom: 3px;
    }

    .draft-box {
      white-space: pre-wrap;
      background: #FBF0E8;
      border-color: rgba(75, 18, 56, 0.28);
      line-height: 1.5;
    }

    .timeline {
      display: grid;
      gap: 8px;
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

    .price-change-list {
      margin-top: 12px;
    }

    .mini-status {
      min-height: 30px;
      display: inline-flex;
      align-items: center;
      padding: 0 10px;
      border-radius: 999px;
      background: #eef2f7;
      color: #475569;
      font-weight: 800;
      font-size: 0.78rem;
    }

    .mini-status.ok {
      background: #daf5ef;
      color: #075e53;
    }

    .mini-status.warn {
      background: #fff3d8;
      color: #7c4d00;
    }

    .table-wrap {
      overflow: auto;
    }

    table {
      min-width: 760px;
    }

    .badge.warn {
      background: #fff3d8;
      color: #7c4d00;
    }

    .empty-state {
      color: var(--muted);
    }

    .empty-state strong {
      display: block;
      color: var(--ink);
    }

    @media (max-width: 1180px) {
      .supplier-kpis,
      .supplier-layout,
      .supplier-grid {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }
    }

    @media (max-width: 760px) {
      .supplier-kpis,
      .supplier-layout,
      .supplier-grid,
      .detail-list,
      .mini-metrics {
        grid-template-columns: 1fr;
      }
    }
  `]
})
export class Supplier360Component implements OnInit {
  readonly supplier = signal<ApiRecord | null>(null);
  readonly suppliers = signal<ApiRecord[]>([]);
  readonly products = signal<ApiRecord[]>([]);
  readonly branches = signal<ApiRecord[]>([]);
  readonly batches = signal<ApiRecord[]>([]);
  readonly transactions = signal<ApiRecord[]>([]);
  readonly recommendations = signal<ApiRecord[]>([]);
  readonly purchaseOrders = signal<ApiRecord[]>([]);
  readonly whatsappQueue = signal<ApiRecord[]>([]);
  readonly intelligence = signal<ApiRecord | null>(null);
  readonly loading = signal(true);
  readonly error = signal('');
  readonly whatsappDraft = signal('');

  readonly supplierBatches = computed(() => {
    const vendor = this.supplier();
    return vendor ? this.batches().filter((batch) => this.recordSupplierId(batch) === String(vendor.id || '')) : [];
  });

  readonly purchaseTransactions = computed(() => {
    const vendor = this.supplier();
    return vendor
      ? this.transactions().filter((row) => this.recordSupplierId(row) === String(vendor.id || '') && String(row.type || '').includes('purchase')).slice().sort((a, b) => String(b.createdAt || b.created_at || '').localeCompare(String(a.createdAt || a.created_at || '')))
      : [];
  });

  readonly purchaseValue = computed(() => this.purchaseTransactions().reduce((total, row) => total + Math.abs(Number(row.totalCost || row.total_cost || 0)), 0));

  readonly supplierPurchaseOrders = computed(() => {
    const vendor = this.supplier();
    return vendor
      ? this.purchaseOrders().filter((row) => this.recordSupplierId(row) === String(vendor.id || '')).slice().sort((a, b) => String(b.createdAt || b.created_at || '').localeCompare(String(a.createdAt || a.created_at || '')))
      : [];
  });

  readonly openPurchaseOrders = computed(() =>
    this.supplierPurchaseOrders().filter((row) => !['received', 'closed', 'cancelled', 'rejected'].includes(String(row.status || 'draft').toLowerCase()))
  );

  readonly receivedPurchaseOrders = computed(() =>
    this.supplierPurchaseOrders().filter((row) => ['received', 'closed', 'partial_receive'].includes(String(row.status || '').toLowerCase()) || Boolean(row.grnNumber || row.grn_number))
  );

  readonly poVarianceRows = computed(() =>
    this.supplierPurchaseOrders().filter((row) => this.poVarianceCount(row) > 0)
  );

  readonly grnReliabilityScore = computed(() => {
    const orders = this.supplierPurchaseOrders();
    if (!orders.length) return Math.max(55, this.supplierScore());
    const variancePenalty = this.poVarianceRows().reduce((total, row) => total + this.poVarianceCount(row), 0) * 8;
    const openOldPenalty = this.openPurchaseOrders().filter((row) => this.daysSince(row.expectedDeliveryDate || row.expected_delivery_date || row.createdAt || row.created_at) > 14).length * 6;
    const receivedBonus = Math.min(12, this.receivedPurchaseOrders().length * 2);
    return Math.max(40, Math.min(100, Math.round(88 + receivedBonus - variancePenalty - openOldPenalty)));
  });

  readonly priceComparisonRows = computed(() => {
    const vendor = this.supplier();
    if (!vendor) return [];
    return this.suppliedProducts().map((product) => this.priceComparisonForProduct(product, String(vendor.id || ''))).filter(Boolean) as ApiRecord[];
  });

  readonly priceChangeRows = computed(() => {
    const byProduct = new Map<string, ApiRecord[]>();
    for (const row of this.purchaseTransactions()) {
      const productId = String(row.productId || row.product_id || '');
      if (!productId || Number(row.unitCost || row.unit_cost || 0) <= 0) continue;
      const rows = byProduct.get(productId) || [];
      rows.push(row);
      byProduct.set(productId, rows);
    }
    return Array.from(byProduct.entries()).map(([productId, rows]) => {
      const sorted = rows.slice().sort((a, b) => String(a.createdAt || a.created_at || '').localeCompare(String(b.createdAt || b.created_at || '')));
      const first = Number(sorted[0]?.['unitCost'] || sorted[0]?.['unit_cost'] || 0);
      const last = Number(sorted[sorted.length - 1]?.['unitCost'] || sorted[sorted.length - 1]?.['unit_cost'] || 0);
      const changePct = first > 0 ? ((last - first) / first) * 100 : 0;
      return {
        productId,
        previousCost: first,
        latestCost: last,
        changePct: Math.round(changePct * 100) / 100,
        status: changePct > 0 ? 'Price rising' : changePct < 0 ? 'Price improved' : 'Stable'
      };
    }).filter((row) => row.previousCost > 0 && row.latestCost > 0).slice(0, 8);
  });

  readonly supplierWhatsappLogs = computed(() => {
    const vendor = this.supplier();
    const supplierId = String(vendor?.id || '');
    return this.whatsappQueue().filter((row) => this.recordSupplierId(row) === supplierId || String(row.supplierId || row.supplier_id || '') === supplierId);
  });

  readonly poDraftItems = computed(() => this.buildPoDraftItems());
  readonly poDraftTotal = computed(() => this.poDraftItems().reduce((total, item) => total + Number(item.totalCost || 0), 0));
  readonly outstandingValue = computed(() => this.supplierPurchaseOrders().filter((row) => !['received', 'closed', 'cancelled', 'rejected'].includes(String(row.status || 'draft').toLowerCase())).reduce((total, row) => total + this.poValue(row), 0));
  readonly paymentTerms = computed(() => String(this.supplier()?.['preferredPaymentTerms'] || this.supplier()?.['paymentTerms'] || this.supplier()?.['payment_terms'] || 'Payment terms missing'));
  readonly creditDaysOverdue = computed(() => {
    const creditDays = this.creditDaysFor(this.paymentTerms());
    const lastPurchase = this.purchaseTransactions()[0]?.['createdAt'] || this.purchaseTransactions()[0]?.['created_at'];
    return this.outstandingValue() > 0 && creditDays > 0 && lastPurchase ? Math.max(0, this.daysSince(lastPurchase) - creditDays) : 0;
  });
  readonly reliabilityBreakdown = computed(() => this.buildReliabilityBreakdown());
  readonly complianceIssues = computed(() => this.buildComplianceIssues());
  readonly mappingWarnings = computed(() => this.buildMappingWarnings());

  readonly pendingRecommendations = computed(() => {
    const vendor = this.supplier();
    if (!vendor) return [];
    const suppliedIds = new Set(this.supplierBatches().map((batch) => String(batch.productId || batch.product_id || '')));
    const vendorName = this.supplierDisplayName(vendor).toLowerCase();
    return [
      ...this.recommendations(),
      ...((this.intelligence()?.['suggestions'] || []) as ApiRecord[])
    ].filter((row) =>
      suppliedIds.has(String(row.productId || row.product_id || ''))
      || this.recordSupplierId(row) === String(vendor.id || '')
      || String(row.supplier || '').toLowerCase() === vendorName
    );
  });

  readonly suppliedProducts = computed(() => {
    const ids = new Set(this.supplierBatches().map((batch) => String(batch.productId || batch.product_id || '')));
    const name = this.supplierDisplayName(this.supplier()).toLowerCase();
    return this.products().filter((product) => ids.has(String(product.id || '')) || String(product.supplier || '').toLowerCase() === name);
  });

  readonly qualityIssues = computed<ApiRecord[]>(() => {
    const ids = new Set(this.suppliedProducts().map((product) => String(product.id || '')));
    const expiry = this.supplierBatches()
      .filter((batch) => (batch.expiryDate || batch.expiry_date) && this.daysUntil(String(batch.expiryDate || batch.expiry_date)) <= 60)
      .map((batch) => ({ ...batch, reason: 'Expiry risk within 60 days' }));
    const lowStock = this.products()
      .filter((product) => ids.has(String(product.id || '')) && this.isLowStock(product))
      .map((product) => ({ ...product, productId: product.id, reason: 'Low stock on supplier-linked product' }));
    const waste = this.transactions()
      .filter((row) => ids.has(String(row.productId || row.product_id || '')) && `${row.type || ''} ${row.reason || ''}`.toLowerCase().match(/waste|expiry|damage/))
      .map((row) => ({ ...row, reason: row.reason || 'Waste, expiry or damage signal' }));
    return [...expiry, ...lowStock, ...waste];
  });

  readonly supplierScore = computed(() => {
    const vendor = this.supplier();
    const scorecard = ((this.intelligence()?.['supplierScorecards'] || []) as ApiRecord[]).find((row) => row.id === vendor?.id);
    if (scorecard) return Number(scorecard.reliabilityScore || 0);
    return Math.max(55, 96 - this.qualityIssues().length * 7);
  });

  constructor(
    private readonly api: ApiService,
    private readonly route: ActivatedRoute
  ) {}

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    const supplierId = this.route.snapshot.paramMap.get('id') || '';
    this.loading.set(true);
    this.error.set('');
    Promise.all([
      firstValueFrom(this.api.get<ApiRecord>('suppliers', supplierId)),
      firstValueFrom(this.api.list<ApiRecord[]>('suppliers', { limit: 1000 })),
      firstValueFrom(this.api.list<ApiRecord[]>('products', { limit: 10000 })),
      firstValueFrom(this.api.list<ApiRecord[]>('branches', { limit: 1000 })),
      firstValueFrom(this.api.list<ApiRecord[]>('inventoryBatches', { limit: 1000 })),
      firstValueFrom(this.api.list<ApiRecord[]>('inventory', { limit: 1000 })),
      firstValueFrom(this.api.list<ApiRecord[]>('inventory-autopilot/purchase-recommendations', { limit: 1000 })),
      firstValueFrom(this.api.list<ApiRecord[]>('inventory-intelligence/purchase-orders', { limit: 1000 })),
      firstValueFrom(this.api.list<ApiRecord[]>('inventory-intelligence/supplier-whatsapp-queue', { limit: 1000 })),
      firstValueFrom(this.api.list<ApiRecord>('inventory-intelligence/summary', { branchId: this.api.selectedBranchId() }))
    ]).then(([supplier, suppliers, products, branches, batches, transactions, recommendations, purchaseOrders, whatsappQueue, intelligence]) => {
      this.supplier.set(this.normalizedSupplier(supplier));
      this.suppliers.set(this.normalizedSuppliers(suppliers));
      this.products.set(products || []);
      this.branches.set(branches || []);
      this.batches.set(batches || []);
      this.transactions.set(transactions || []);
      this.recommendations.set(recommendations || []);
      this.purchaseOrders.set(purchaseOrders || []);
      this.whatsappQueue.set(whatsappQueue || []);
      this.intelligence.set(intelligence || null);
      this.loading.set(false);
    }).catch((error) => {
      this.error.set(error?.error?.error || error?.message || 'Unable to load Supplier 360');
      this.loading.set(false);
    });
  }

  buildWhatsAppDraft(vendor: ApiRecord): void {
    const draftRows = this.poDraftItems();
    const items = draftRows.length
      ? draftRows.map((row, index) => `${index + 1}. ${row.productName} - Qty ${row.quantity} - ${this.currencyText(Number(row.totalCost || 0))}`).join('\n')
      : 'Please share latest price list and next delivery availability.';
    this.whatsappDraft.set(`Draft to ${this.supplierDisplayName(vendor)}\nPO items:\n${items}\nExpected delivery: ${this.expectedDeliveryLabel()}\nTotal draft value: ${this.currencyText(this.poDraftTotal())}\nGST invoice: required with batch/expiry if applicable\nPayment terms: ${this.paymentTerms()}\nOpen PO: ${this.openPurchaseOrders().length}\nGRN reliability: ${this.grnReliabilityScore()}/100\nNote: Send only after owner approval.`);
  }

  lastPurchaseDate(): string {
    const row = this.purchaseTransactions()[0];
    const value = row?.['createdAt'] || row?.['created_at'];
    return value ? new Date(String(value)).toLocaleDateString('en-IN') : 'No purchase yet';
  }

  lastPaymentDate(): string {
    const supplier = this.supplier();
    const row = this.purchaseTransactions().find((item) => item.paymentDate || item.payment_date || item.paidAt || item.paid_at);
    const value = supplier?.['lastPaymentAt'] || supplier?.['last_payment_at'] || row?.['paymentDate'] || row?.['payment_date'] || row?.['paidAt'] || row?.['paid_at'];
    return value ? new Date(String(value)).toLocaleDateString('en-IN') : 'No payment logged';
  }

  expectedDeliveryLabel(): string {
    const leadDays = Number(this.supplier()?.['leadTimeDays'] || this.supplier()?.['lead_time_days'] || 0);
    if (!leadDays) return 'Delivery date not set';
    const date = new Date(Date.now() + leadDays * 86400000);
    return `${leadDays} day(s) · ${date.toLocaleDateString('en-IN')}`;
  }

  replacementSupplier(): string {
    const current = this.supplier();
    const replacement = this.suppliers().filter((item) => item.id !== current?.id && (item.status || 'active') === 'active')[0];
    return replacement ? this.supplierDisplayName(replacement) : 'No alternate supplier';
  }

  productName(id: unknown): string {
    const productId = String(id || '');
    return this.products().find((product) => String(product.id || '') === productId)?.name || productId || 'Product';
  }

  poVarianceCount(row: ApiRecord): number {
    const variances = this.asArray(row.variances);
    return variances.length + this.asArray(row.warnings).length;
  }

  poValue(row: ApiRecord): number {
    if (row.totalEstimatedCost || row.total_estimated_cost || row.grandTotal || row.grand_total) {
      return Number(row.grandTotal || row.grand_total || row.totalEstimatedCost || row.total_estimated_cost || 0);
    }
    return this.asArray(row.items).reduce((total, item) => total + Number(item.estimatedTotal || item.estimated_total || item.lineTotal || item.line_total || 0), 0);
  }

  poReceivedDate(row: ApiRecord): string {
    return String(row.grnDate || row.grn_date || row.closedAt || row.closed_at || row.updatedAt || row.updated_at || row.createdAt || row.created_at || '');
  }

  branchName(id: unknown): string {
    const branchId = String(id || '');
    return this.branches().find((branch) => String(branch.id || '') === branchId)?.name || branchId || 'All branches';
  }

  nearestExpiry(productId: unknown): string {
    const id = String(productId || '');
    const expiry = this.batches()
      .filter((batch) => String(batch.productId || batch.product_id || '') === id && (batch.expiryDate || batch.expiry_date))
      .map((batch) => String(batch.expiryDate || batch.expiry_date))
      .sort()[0];
    return expiry || 'No expiry';
  }

  isLowStock(product: ApiRecord): boolean {
    return Number(product.stock || 0) <= Number(product.lowStockThreshold || product.low_stock_threshold || 0);
  }

  productMappingLabel(product: ApiRecord): string {
    const sku = product.sku || product.code || product.productCode || product.product_code;
    const alias = product.supplierSku || product.supplier_sku || product.vendorSku || product.vendor_sku || product.supplierAlias;
    if (sku && alias) return 'SKU + alias ready';
    if (sku) return 'Alias missing';
    if (alias) return 'SKU missing';
    return 'SKU/alias missing';
  }

  initials(value = ''): string {
    return String(value).split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase() || 'S';
  }

  supplierDisplayName(supplier: ApiRecord | null | undefined): string {
    return String(supplier?.['name'] || supplier?.['supplierName'] || supplier?.['vendorName'] || supplier?.['id'] || 'Unnamed supplier').trim();
  }

  private buildPoDraftItems(): ApiRecord[] {
    const byProduct = new Map<string, ApiRecord>();
    for (const row of this.pendingRecommendations()) {
      const productId = String(row.productId || row.product_id || '');
      if (!productId || byProduct.has(productId)) continue;
      const product = this.products().find((item) => String(item.id || '') === productId);
      const quantity = Number(row.recommendedQty || row.recommended_qty || row.quantity || 1);
      const unitCost = Number(product?.['unitCost'] || product?.['unit_cost'] || row['unitCost'] || row['unit_cost'] || 0);
      byProduct.set(productId, {
        productId,
        productName: product?.['name'] || row['name'] || this.productName(productId),
        branchId: row.branchId || row.branch_id || product?.['branchId'] || product?.['branch_id'] || this.api.selectedBranchId(),
        quantity,
        unitCost,
        totalCost: Math.round(quantity * unitCost * 100) / 100,
        reason: row.reason || row.recommendationText || 'Reorder recommendation'
      });
    }
    for (const product of this.suppliedProducts()) {
      const productId = String(product.id || '');
      if (!productId || byProduct.has(productId)) continue;
      const threshold = Number(product.lowStockThreshold || product.low_stock_threshold || 0);
      const stock = Number(product.stock || 0);
      if (threshold > 0 && stock > threshold) continue;
      const quantity = Math.max(1, threshold > 0 ? threshold * 2 - stock : 1);
      const unitCost = Number(product.unitCost || product.unit_cost || product.cost || 0);
      byProduct.set(productId, {
        productId,
        productName: product.name || productId,
        branchId: product.branchId || product.branch_id || this.api.selectedBranchId(),
        quantity,
        unitCost,
        totalCost: Math.round(quantity * unitCost * 100) / 100,
        reason: stock <= threshold ? 'Low stock supplier-linked product' : 'Manual supplier replenishment'
      });
      if (byProduct.size >= 12) break;
    }
    return Array.from(byProduct.values()).slice(0, 12);
  }

  private buildReliabilityBreakdown(): ApiRecord {
    const poRows = this.supplierPurchaseOrders();
    const expectedRows = poRows.filter((row) => this.poExpectedDate(row));
    const lateRows = expectedRows.filter((row) => this.isPoLate(row));
    const onTimePct = expectedRows.length ? this.percent(expectedRows.length - lateRows.length, expectedRows.length) : Math.max(60, 100 - this.openPurchaseOrders().filter((row) => this.daysSince(row.createdAt || row.created_at) > 14).length * 12);
    const damageRows = this.purchaseTransactions().filter((row) => /damage|damaged|short|waste|expiry|leak/i.test(`${row.type || ''} ${row.reason || ''} ${row.status || ''}`));
    const returnRows = this.purchaseTransactions().filter((row) => /return|replacement|refund/i.test(`${row.type || ''} ${row.reason || ''} ${row.status || ''}`));
    const invoiceMismatchRows = poRows.filter((row) => this.poVarianceCount(row) > 0 || /invoice|gst|rate|mismatch|short|damage/i.test(`${row.status || ''} ${row.notes || ''} ${row.receiveNote || row.receive_note || ''}`));
    const denominator = Math.max(1, poRows.length || this.purchaseTransactions().length);
    return {
      onTimePct,
      damagePct: this.percent(damageRows.length, denominator),
      returnPct: this.percent(returnRows.length, denominator),
      invoiceMismatchPct: this.percent(invoiceMismatchRows.length, denominator)
    };
  }

  private buildComplianceIssues(): string[] {
    const supplier = this.supplier();
    if (!supplier) return [];
    const issues: string[] = [];
    const gstin = String(supplier.gstin || '').trim();
    if (!gstin) issues.push('GSTIN missing');
    if (!String(supplier.phone || '').trim() && !String(supplier.email || '').trim()) issues.push('Contact missing');
    if (!String(supplier.invoiceFormat || supplier.preferredInvoiceFormat || supplier.invoice_format || '').trim()) issues.push('Invoice format missing');
    if (this.paymentTerms() === 'Payment terms missing') issues.push('Payment terms missing');
    if (!String(supplier.address || '').trim()) issues.push('Billing address missing');
    if (String(supplier.status || 'active').toLowerCase() !== 'active') issues.push(`${supplier.status} status`);
    return issues;
  }

  private buildMappingWarnings(): string[] {
    const products = this.suppliedProducts();
    if (!products.length) return ['No product linked'];
    const missingSku = products.filter((product) => !String(product.sku || product.code || product.productCode || product.product_code || '').trim()).length;
    const missingAlias = products.filter((product) => !String(product.supplierSku || product.supplier_sku || product.vendorSku || product.vendor_sku || product.supplierAlias || '').trim()).length;
    const warnings: string[] = [];
    if (missingSku) warnings.push(`${missingSku} SKU missing`);
    if (missingAlias) warnings.push(`${missingAlias} supplier alias missing`);
    return warnings;
  }

  private priceComparisonForProduct(product: ApiRecord, supplierId: string): ApiRecord | null {
    const productId = String(product.id || '');
    const rows = this.transactions()
      .filter((row) => String(row.productId || row.product_id || '') === productId && Number(row.unitCost || row.unit_cost || 0) > 0)
      .slice()
      .sort((a, b) => String(b.createdAt || b.created_at || '').localeCompare(String(a.createdAt || a.created_at || '')));
    const latestBySupplier = new Map<string, ApiRecord>();
    for (const row of rows) {
      const id = this.recordSupplierId(row);
      if (id && !latestBySupplier.has(id)) latestBySupplier.set(id, row);
    }
    const current = latestBySupplier.get(supplierId);
    const currentCost = Number(current?.['unitCost'] || current?.['unit_cost'] || product.unitCost || product.unit_cost || 0);
    if (currentCost <= 0) return null;
    let bestSupplierId = supplierId;
    let bestCost = currentCost;
    for (const [id, row] of latestBySupplier.entries()) {
      const cost = Number(row.unitCost || row.unit_cost || 0);
      if (cost > 0 && cost < bestCost) {
        bestSupplierId = id;
        bestCost = cost;
      }
    }
    const savingPct = bestCost < currentCost ? ((currentCost - bestCost) / currentCost) * 100 : 0;
    return {
      productId,
      productName: product.name || productId,
      currentCost,
      bestSupplierName: bestSupplierId === supplierId ? this.supplierDisplayName(this.supplier()) : this.supplierDisplayName(this.suppliers().find((supplier) => String(supplier.id || '') === bestSupplierId) || {}),
      bestCost,
      savingPct: Math.round(savingPct * 100) / 100
    };
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

  private recordSupplierId(row: ApiRecord): string {
    return String(row.supplierId || row.supplier_id || '');
  }

  private normalizedSupplier(row: ApiRecord | null | undefined): ApiRecord {
    return {
      ...(row || {}),
      name: this.supplierDisplayName(row)
    };
  }

  private normalizedSuppliers(rows: ApiRecord[] | null | undefined): ApiRecord[] {
    return (rows || [])
      .filter((row): row is ApiRecord => Boolean(row && typeof row === 'object'))
      .map((row) => this.normalizedSupplier(row));
  }

  private daysSince(value: unknown): number {
    const time = new Date(String(value || '')).getTime();
    if (!value || Number.isNaN(time)) return 0;
    return Math.max(0, Math.round((Date.now() - time) / 86400000));
  }

  private poExpectedDate(row: ApiRecord): string {
    return String(row.expectedDeliveryDate || row.expected_delivery_date || row.deliveryDate || row.delivery_date || '');
  }

  private isPoLate(row: ApiRecord): boolean {
    const expected = this.poExpectedDate(row);
    if (!expected) return false;
    const expectedTime = new Date(expected).getTime();
    if (Number.isNaN(expectedTime)) return false;
    const received = this.poReceivedDate(row);
    const actualTime = received ? new Date(received).getTime() : Date.now();
    return !Number.isNaN(actualTime) && actualTime > expectedTime;
  }

  private percent(part: number, total: number): number {
    return total > 0 ? Math.round((part / total) * 10000) / 100 : 0;
  }

  private creditDaysFor(terms: string): number {
    const normalized = String(terms || '').toLowerCase();
    if (!normalized || /cash|cod|advance/.test(normalized)) return 0;
    const match = normalized.match(/net\s*(\d+)|(\d+)\s*days?|credit\s*(\d+)/);
    return match ? Number(match[1] || match[2] || match[3] || 0) : 0;
  }

  private currencyText(value: number): string {
    return `₹${Math.round(Number(value) || 0).toLocaleString('en-IN')}`;
  }

  private daysUntil(value: string): number {
    const time = new Date(value).getTime();
    if (!value || Number.isNaN(time)) return 9999;
    return Math.round((time - Date.now()) / 86400000);
  }
}
