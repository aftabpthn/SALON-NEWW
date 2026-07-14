import { CommonModule } from '@angular/common';
import { Component, OnInit, computed, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { ApiRecord, ApiService } from '../core/api.service';
import { InventoryZenotiChromeComponent } from '../shared/ui/inventory-zenoti-chrome/inventory-zenoti-chrome.component';
import { StateComponent } from '../shared/ui/state/state.component';
import { AuraMoneyPipe } from '../shared/pipes/aura-money.pipe';
import { AuraDatePipe } from '../shared/pipes/aura-date.pipe';

@Component({
  selector: 'app-purchase-order-detail',
  standalone: true,
  imports: [AuraDatePipe, AuraMoneyPipe, CommonModule, RouterLink, InventoryZenotiChromeComponent, StateComponent],
  template: `
    <section class="page-stack po-detail-page inner-page-shell">
      <app-inventory-zenoti-chrome
        class="no-print"
        [title]="po()?.poNumber || 'Purchase order'"
        breadcrumb="Inventory > Purchase orders > Detail"
        (refresh)="load()"
      >
        <div zenoti-actions>
          <button class="ghost-button" type="button" (click)="printPo()" [disabled]="!po()">Print / PDF</button>
          <button class="primary-button" type="button" (click)="queueWhatsApp()" [disabled]="!canSend() || saving()">WhatsApp PO</button>
        </div>
      </app-inventory-zenoti-chrome>

      <app-state [loading]="loading()" [error]="error()"></app-state>
      <div class="state success no-print" *ngIf="success()">{{ success() }}</div>

      <section class="panel printable-po inner-page-card" *ngIf="po() as row" id="po-print-area">
        <div class="print-header">
          <div>
            <h1>{{ row.poNumber || row.id }}</h1>
            <p>{{ branchName(row.branchId) }} · {{ row.createdAt | auraDate:'date' }}</p>
          </div>
          <div class="status-block">
            <strong>{{ row.status || 'draft' }}</strong>
            <span>{{ (row.grandTotal || row.totalEstimatedCost) | auraMoney:'1.0-0' }}</span>
          </div>
        </div>

        <div class="quick-actions no-print inner-action-bar">
          <button class="primary-button mini" type="button" (click)="approve()" [disabled]="row.status !== 'draft' || saving()">Approve</button>
          <button class="ghost-button mini" type="button" (click)="transition('close')" [disabled]="!canClose() || saving()">Close</button>
          <button class="ghost-button mini danger" type="button" (click)="transition('reject')" [disabled]="!canReject() || saving()">Reject</button>
          <button class="ghost-button mini danger" type="button" (click)="transition('cancel')" [disabled]="!canCancel() || saving()">Cancel</button>
          <button class="ghost-button mini" type="button" (click)="transition('reopen')" [disabled]="!canReopen() || saving()">Reopen</button>
        </div>

        <div class="detail-grid">
          <article>
            <span>Supplier</span>
            <strong>{{ supplierName(row) }}</strong>
            <small>{{ row.supplier?.contactName || 'Contact pending' }}</small>
          </article>
          <article>
            <span>GSTIN / contact</span>
            <strong>{{ row.supplier?.gstin || 'GSTIN missing' }}</strong>
            <small>{{ row.supplier?.phone || 'Phone missing' }} · {{ row.supplier?.email || 'Email missing' }}</small>
          </article>
          <article>
            <span>Address</span>
            <strong>{{ row.supplier?.address || 'Address missing' }}</strong>
            <small>Lead time {{ row.supplier?.leadTimeDays || 0 }} days</small>
          </article>
          <article>
            <span>Expected delivery</span>
            <strong>{{ row.expectedDeliveryDate || 'Not set' }}</strong>
            <small [class.alert-text]="isLate(row)">{{ isLate(row) ? 'Late delivery alert' : (row.deliveryTerms || 'Delivery terms pending') }}</small>
          </article>
          <article>
            <span>Approval</span>
            <strong>{{ row.approval?.status || row.approvalStatus || 'not_requested' }}</strong>
            <small>{{ row.approval?.approvedBy || row.approvedBy || 'Approver pending' }} · {{ (row.approval?.approvedAt || row.approvedAt) | auraDate:'date' }}</small>
          </article>
          <article>
            <span>GRN / invoice</span>
            <strong>{{ row.grnNumber || 'GRN pending' }}</strong>
            <small>{{ row.supplierInvoiceNo || 'Supplier invoice pending' }} · {{ row.challanNo || 'No challan' }}</small>
          </article>
        </div>

        <div class="warning-box" *ngIf="warningList().length">
          <strong>Warnings and variance control</strong>
          <span *ngFor="let warning of warningList()">{{ warning.message || warning.type || warning }}</span>
        </div>

        <div class="totals-grid">
          <span><strong>Subtotal</strong>{{ row.subtotalAmount | auraMoney:'1.0-0' }}</span>
          <span><strong>Discount</strong>{{ row.discountAmount | auraMoney:'1.0-0' }}</span>
          <span><strong>Taxable</strong>{{ row.taxableAmount | auraMoney:'1.0-0' }}</span>
          <span><strong>GST</strong>{{ row.gstAmount | auraMoney:'1.0-0' }}</span>
          <span><strong>Grand total</strong>{{ (row.grandTotal || row.totalEstimatedCost) | auraMoney:'1.0-0' }}</span>
          <span><strong>Received value</strong>{{ row.totalReceivedCost | auraMoney:'1.0-0' }}</span>
        </div>

        <section class="sub-panel inner-page-card">
          <div class="section-title"><div><h2>Ordered vs received</h2></div></div>
          <div class="table-wrap inner-table-wrap">
            <table>
              <thead><tr><th>Product / HSN</th><th>Ordered</th><th>Received</th><th>MRP</th><th>Rate</th><th>Last rate</th><th>Discount</th><th>GST</th><th>Total</th><th>Batch</th></tr></thead>
              <tbody>
                <tr *ngFor="let item of row.items || []">
                  <td><strong>{{ item.productName || item.productId }}</strong><small>{{ item.hsnSac || 'HSN pending' }}</small></td>
                  <td>{{ item.requestedQty || 0 }} {{ item.unit || 'pcs' }}</td>
                  <td>{{ item.receivedQty || 0 }} {{ item.unit || 'pcs' }}</td>
                  <td>{{ item.mrp | auraMoney:'1.0-0' }}</td>
                  <td>{{ item.unitCost | auraMoney:'1.0-0' }}</td>
                  <td>{{ item.lastPurchase?.rate ? (item.lastPurchase.rate | auraMoney:'1.0-0') : 'No history' }}<small>{{ item.lastPurchase?.purchasedAt | auraDate:'date' }}</small></td>
                  <td>{{ item.discountPercent || 0 }}% / {{ item.discountAmount | auraMoney:'1.0-0' }}</td>
                  <td>{{ item.gstPercent || 0 }}% / {{ item.gstAmount | auraMoney:'1.0-0' }}</td>
                  <td>{{ (item.lineTotal || item.estimatedTotal) | auraMoney:'1.0-0' }}</td>
                  <td>{{ item.batchNumber || '-' }}<small>{{ item.expiryDate || 'No expiry' }}</small></td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        <div class="two-column">
          <section class="sub-panel">
            <div class="section-title"><div><h2>Stock preview after receiving</h2></div></div>
            <div class="impact-summary">
              <span><strong>{{ row.inventoryImpact?.totalReceiveQty || 0 }}</strong>stock units pending</span>
              <span><strong>{{ row.inventoryImpact?.lowStockClearedCount || 0 }}</strong>low-stock alerts cleared</span>
              <span><strong>{{ row.inventoryImpact?.expiryRiskCount || 0 }}</strong>expiry risks</span>
            </div>
            <div class="mini-list">
              <div *ngFor="let item of row.inventoryImpact?.lines || []">
                <strong>{{ item.productName }}</strong>
                <span>{{ item.currentStock }} → {{ item.afterReceiveStock }} stock</span>
                <small>{{ item.lowStockCleared ? 'Low stock will clear' : 'Low stock unchanged' }} · {{ item.expiryRisk ? 'Expiry risk' : 'No expiry risk' }}</small>
              </div>
            </div>
          </section>

          <section class="sub-panel">
            <div class="section-title"><div><h2>AI Purchase Bill Draft links</h2></div></div>
            <div class="mini-list">
              <div *ngFor="let match of billMatches()">
                <strong>{{ match.billNo || match.draftId }}</strong>
                <span>{{ match.supplierName || 'Supplier pending' }} · score {{ match.score }}</span>
                <small>{{ match.linked ? 'Linked to this PO' : 'Suggested match' }} · {{ match.warnings?.length || 0 }} variance(s)</small>
                <a [routerLink]="['/inventory/purchase-bill-drafts']">Open bill drafts</a>
              </div>
              <div *ngIf="!billMatches().length">
                <strong>No bill match yet</strong>
                <span>Upload or match a supplier bill draft to compare ordered, billed and received quantity.</span>
              </div>
            </div>
          </section>
        </div>

        <div class="two-column">
          <section class="sub-panel">
            <div class="section-title"><div><h2>Approval and lifecycle audit</h2></div></div>
            <div class="timeline">
              <div *ngFor="let event of row.statusHistory || []">
                <strong>{{ event.status }}</strong>
                <span>{{ event.at | auraDate:'date' }}</span>
                <small>{{ event.by || 'system' }} · {{ event.note || 'No note' }}</small>
              </div>
            </div>
          </section>

          <section class="sub-panel">
            <div class="section-title"><div><h2>GRN trail</h2></div></div>
            <div class="timeline">
              <div *ngFor="let event of row.receiveHistory || []">
                <strong>{{ event.grnNumber || event.status }}</strong>
                <span>{{ (event.grnDate || event.at) | auraDate:'date' }}</span>
                <small>{{ event.supplierInvoiceNo || 'No invoice' }} · {{ event.receivedBy || 'Receiver pending' }}</small>
              </div>
              <div *ngIf="!(row.receiveHistory || []).length">
                <strong>No GRN yet</strong>
                <span>Stock has not been received against this PO.</span>
              </div>
            </div>
          </section>
        </div>

        <section class="sub-panel no-print">
          <div class="section-title"><div><h2>Supplier message audit</h2></div></div>
          <div class="whatsapp-list">
            <article *ngFor="let message of row.whatsappHistory || []">
              <strong>{{ message.status }}</strong>
              <span>{{ message.phone || 'No phone' }} · {{ message.createdAt | auraDate:'date' }}</span>
              <pre>{{ message.message }}</pre>
            </article>
            <article *ngIf="!(row.whatsappHistory || []).length">
              <strong>No WhatsApp draft queued</strong>
              <span>Use WhatsApp PO after approval to create supplier-ready item table.</span>
            </article>
          </div>
        </section>
      </section>
    </section>
  `,
  styles: [`
    .compact-hero,
    .hero-actions,
    .section-title,
    .print-header,
    .quick-actions {
      align-items: center;
    }

    .hero-actions,
    .quick-actions {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      justify-content: flex-end;
    }

    .print-header {
      display: flex;
      justify-content: space-between;
      gap: 16px;
      border-bottom: 2px solid rgba(75, 18, 56, 0.28);
      padding-bottom: 14px;
      margin-bottom: 14px;
    }

    .print-header h1 {
      margin: 4px 0;
      font-size: 34px;
    }

    .status-block {
      text-align: right;
    }

    .status-block strong,
    .status-block span {
      display: block;
      font-size: 20px;
    }

    .detail-grid,
    .totals-grid,
    .two-column {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 12px;
      margin: 12px 0;
    }

    .two-column {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }

    .detail-grid article,
    .totals-grid span,
    .impact-summary span,
    .mini-list div,
    .timeline div,
    .whatsapp-list article {
      border: 1px solid rgba(15, 23, 42, 0.08);
      border-radius: 8px;
      padding: 12px;
      background: #fff;
      min-width: 0;
    }

    .detail-grid span,
    .totals-grid strong,
    .impact-summary span,
    .timeline span,
    .mini-list span,
    .whatsapp-list span {
      display: block;
      color: var(--muted);
      font-size: 12px;
      margin-bottom: 4px;
    }

    .detail-grid strong,
    .totals-grid span,
    .impact-summary strong,
    .mini-list strong,
    .timeline strong,
    .whatsapp-list strong {
      display: block;
      color: var(--text);
      font-size: 16px;
    }

    .alert-text {
      color: #b42318;
      font-weight: 800;
    }

    .warning-box {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      padding: 12px;
      border: 1px solid rgba(180, 35, 24, 0.22);
      border-radius: 8px;
      background: #fff7ed;
      margin: 12px 0;
    }

    .warning-box strong {
      width: 100%;
    }

    .warning-box span {
      border-radius: 999px;
      background: #fff;
      padding: 6px 10px;
      border: 1px solid rgba(180, 35, 24, 0.16);
    }

    .sub-panel {
      margin-top: 14px;
    }

    .table-wrap {
      overflow: auto;
    }

    table {
      min-width: 1180px;
    }

    td strong,
    td small {
      display: block;
    }

    td small,
    .mini-list small,
    .timeline small {
      color: var(--muted);
      margin-top: 4px;
    }

    .impact-summary {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 8px;
      margin-bottom: 10px;
    }

    .mini-list,
    .timeline,
    .whatsapp-list {
      display: grid;
      gap: 8px;
    }

    .whatsapp-list pre {
      white-space: pre-wrap;
      margin: 8px 0 0;
      color: var(--muted);
      font-family: inherit;
    }

    .danger {
      color: #b42318;
      border-color: rgba(180, 35, 24, 0.32);
    }

    @media print {
      body * {
        visibility: hidden;
      }

      #po-print-area,
      #po-print-area * {
        visibility: visible;
      }

      #po-print-area {
        position: absolute;
        inset: 0;
        width: 100%;
        box-shadow: none;
        border: 0;
      }

      .no-print,
      .no-print * {
        display: none !important;
      }
    }

    @media (max-width: 980px) {
      .detail-grid,
      .totals-grid,
      .two-column,
      .impact-summary {
        grid-template-columns: 1fr;
      }

      .print-header {
        display: block;
      }

      .status-block {
        text-align: left;
      }
    }
  `]
})
export class PurchaseOrderDetailComponent implements OnInit {
  readonly po = signal<ApiRecord | null>(null);
  readonly matches = signal<ApiRecord[]>([]);
  readonly loading = signal(true);
  readonly saving = signal(false);
  readonly error = signal('');
  readonly success = signal('');

  readonly billMatches = computed(() => this.matches().length ? this.matches() : ((this.po()?.['billMatches'] || []) as ApiRecord[]));

  constructor(private readonly route: ActivatedRoute, private readonly api: ApiService) {}

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    const id = this.route.snapshot.paramMap.get('id') || '';
    if (!id) {
      this.error.set('Purchase order ID is missing.');
      this.loading.set(false);
      return;
    }
    this.loading.set(true);
    this.error.set('');
    Promise.all([
      firstValueFrom(this.api.get<ApiRecord>('inventory-intelligence/purchase-orders', id)),
      firstValueFrom(this.api.list<ApiRecord[]>(`inventory-intelligence/purchase-orders/${id}/bill-matches`, { limit: 10 }))
    ]).then(([po, matches]) => {
      this.po.set(po);
      this.matches.set(matches || []);
      this.loading.set(false);
    }).catch((error) => {
      this.error.set(this.api.errorText(error, 'Unable to load purchase order detail'));
      this.loading.set(false);
    });
  }

  approve(): void {
    const row = this.po();
    if (!row?.id) return;
    this.mutate('approve', { approvalNote: 'Owner approved from PO detail page' }, 'PO approved.');
  }

  queueWhatsApp(): void {
    this.mutate('send', {}, 'Supplier WhatsApp draft queued.');
  }

  transition(action: 'close' | 'cancel' | 'reject' | 'reopen'): void {
    this.mutate(action, { note: `${action} from PO detail page`, reason: `${action} from PO detail page` }, `PO ${action} completed.`);
  }

  printPo(): void {
    setTimeout(() => window.print());
  }

  canSend(): boolean {
    const status = this.po()?.status || '';
    return ['approved', 'sent', 'partial_receive', 'closed'].includes(status);
  }

  canClose(): boolean {
    return ['approved', 'sent', 'partial_receive'].includes(this.po()?.status || '');
  }

  canReject(): boolean {
    return ['draft', 'approved'].includes(this.po()?.status || 'draft');
  }

  canCancel(): boolean {
    return ['draft', 'approved', 'sent'].includes(this.po()?.status || 'draft');
  }

  canReopen(): boolean {
    return ['cancelled', 'rejected'].includes(this.po()?.status || '');
  }

  warningList(): ApiRecord[] {
    const warnings = this.po()?.['warnings'];
    return Array.isArray(warnings) ? warnings : [];
  }

  supplierName(row: ApiRecord): string {
    return row.supplier?.name || row.supplierName || row.supplierId || 'Preferred supplier';
  }

  branchName(id: string): string {
    return id || 'Selected branch';
  }

  isLate(row: ApiRecord): boolean {
    const expected = row.expectedDeliveryDate || '';
    return Boolean(expected && expected < new Date().toISOString().slice(0, 10) && !['closed', 'cancelled', 'rejected'].includes(row.status || ''));
  }

  private mutate(action: string, payload: ApiRecord, message: string): void {
    const row = this.po();
    if (!row?.id) return;
    this.saving.set(true);
    this.api.post<ApiRecord>(`inventory-intelligence/purchase-orders/${row.id}/${action}`, payload).subscribe({
      next: (response) => {
        this.saving.set(false);
        this.success.set(message);
        this.po.set(response.purchaseOrder || response);
        this.load();
      },
      error: (error) => {
        this.error.set(this.api.errorText(error, `Unable to ${action} PO`));
        this.saving.set(false);
      }
    });
  }
}
