import { CommonModule } from '@angular/common';
import { Component, OnInit, computed, signal } from '@angular/core';
import { FormsModule, ReactiveFormsModule, UntypedFormBuilder, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { ApiRecord, ApiService } from '../core/api.service';
import { InventoryZenotiChromeComponent } from '../shared/ui/inventory-zenoti-chrome/inventory-zenoti-chrome.component';
import { StateComponent } from '../shared/ui/state/state.component';
import { AuraMoneyPipe } from '../shared/pipes/aura-money.pipe';
import { AuraDatePipe } from '../shared/pipes/aura-date.pipe';

type DraftItem = {
  productId: string;
  hsnSac: string;
  unit: string;
  quantity: number;
  mrp: number;
  discountPercent: number;
  discountAmount: number;
  unitCost: number;
  gstPercent: number;
  batchNumber: string;
  expiryDate: string;
};

type PurchaseOrderViewKey = 'overview' | 'entry' | 'receive' | 'suggestions' | 'workflow' | 'detail' | 'message';

type ReceiveItem = {
  itemId: string;
  productId: string;
  productName: string;
  orderedQty: number;
  alreadyReceivedQty: number;
  quantity: number;
  damagedQty: number;
  shortQty: number;
  excessQty: number;
  unit: string;
  unitCost: number;
  gstPercent: number;
  batchNumber: string;
  expiryDate: string;
};

@Component({
  selector: 'app-purchase-orders',
  standalone: true,
  imports: [AuraDatePipe, AuraMoneyPipe, CommonModule, FormsModule, ReactiveFormsModule, RouterLink, InventoryZenotiChromeComponent, StateComponent],
  template: `
    <section class="page-stack purchase-orders-page inner-page-shell">
      <app-inventory-zenoti-chrome
        title="Purchase Command Center"
        breadcrumb="Inventory > Purchase orders"
        (refresh)="load()"
      >
        <div zenoti-actions>
          <button class="ghost-button" type="button" (click)="printSelectedPo()" [disabled]="!selectedPo()">Print PO</button>
          <button class="primary-button" type="button" (click)="runReorder()" [disabled]="saving()">Refresh AI reorder</button>
        </div>
      </app-inventory-zenoti-chrome>

      <app-state [loading]="loading()" [error]="error()"></app-state>
      <div class="state success" *ngIf="success()">{{ success() }}</div>

      <div class="po-workspace">
        <aside class="po-side-nav" aria-label="Purchase order pages">
          <button
            *ngFor="let view of purchaseOrderViews"
            class="po-nav-card"
            type="button"
            [class.active]="activePurchaseOrderView() === view.key"
            (click)="setPurchaseOrderView(view.key)"
          >
            <span class="po-nav-icon">{{ view.icon }}</span>
            <span>
              <strong>{{ view.label }}</strong>
              <small>{{ view.description }}</small>
            </span>
            <i>{{ view.badge }}</i>
          </button>
        </aside>

        <main class="po-detail-pane">

      <section class="po-kpis inner-stats-grid" *ngIf="visiblePurchaseOrderView('overview')">
        <article class="metric-card teal"><span>AI suggestions</span><strong>{{ suggestions().length }}</strong></article>
        <article class="metric-card amber"><span>Draft PO</span><strong>{{ draftRows().length }}</strong></article>
        <article class="metric-card blue"><span>Approved / sent</span><strong>{{ approvedRows().length }}</strong></article>
        <article class="metric-card red"><span>Projected spend</span><strong>{{ projectedSpend() | auraMoney:'1.0-0' }}</strong></article>
      </section>

      <div class="po-layout" *ngIf="visiblePurchaseOrderView('entry') || visiblePurchaseOrderView('receive')">
        <section class="panel inner-page-card" *ngIf="visiblePurchaseOrderView('entry')">
          <div class="section-title">
            <div><h2>Product purchase entry</h2></div>
            <button class="ghost-button mini" type="button" (click)="addDraftLine()">Add item</button>
          </div>
          <form [formGroup]="draftForm" (ngSubmit)="createDraft()" class="po-form inner-form-grid">
            <label class="field">
              <span>Branch</span>
              <select formControlName="branchId">
                <option value="">Select branch</option>
                <option *ngFor="let branch of branches()" [value]="branch.id">{{ branch.name }}</option>
              </select>
            </label>
            <label class="field">
              <span>Supplier</span>
              <select formControlName="supplierId">
                <option value="">Preferred supplier not set</option>
                <option *ngFor="let supplier of suppliers()" [value]="supplier.id">{{ supplier.name }}</option>
              </select>
            </label>
            <label class="field"><span>Expected delivery</span><input type="date" formControlName="expectedDeliveryDate" /></label>
            <label class="field"><span>Payment terms</span><input formControlName="paymentTerms" placeholder="Cash / 7 days / credit" /></label>
            <label class="field"><span>Delivery terms</span><input formControlName="deliveryTerms" placeholder="Branch delivery, GST invoice" /></label>
            <label class="field"><span>Approval note</span><input formControlName="approvalNote" placeholder="Owner approval note" /></label>
            <label class="field full"><span>Remarks</span><textarea formControlName="notes"></textarea></label>

            <div class="supplier-strip full" *ngIf="draftSupplier() as supplier">
              <span><strong>GSTIN</strong>{{ supplier.gstin || 'Missing' }}</span>
              <span><strong>Phone</strong>{{ supplier.phone || 'Missing' }}</span>
              <span><strong>Email</strong>{{ supplier.email || 'Missing' }}</span>
              <span><strong>Lead time</strong>{{ supplier.leadTimeDays || 0 }} days</span>
            </div>

            <div class="line-table full">
              <table>
                <thead>
                  <tr>
                    <th>Product / HSN</th>
                    <th>Qty / unit</th>
                    <th>MRP / discount</th>
                    <th>Rate / GST</th>
                    <th>Taxable</th>
                    <th>GST / total</th>
                    <th>Batch / expiry</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  <tr *ngFor="let item of draftItems(); let index = index">
                    <td>
                      <select [ngModel]="item.productId" (ngModelChange)="selectDraftProduct(index, $event)" [ngModelOptions]="{standalone: true}">
                        <option value="">Select product</option>
                        <option *ngFor="let product of products()" [value]="product.id">{{ product.name }}</option>
                      </select>
                      <input [ngModel]="item.hsnSac" (ngModelChange)="updateDraftItem(index, { hsnSac: $event })" [ngModelOptions]="{standalone: true}" placeholder="HSN / SAC" />
                    </td>
                    <td>
                      <input type="number" [ngModel]="item.quantity" (ngModelChange)="updateDraftItem(index, { quantity: toNumber($event) })" [ngModelOptions]="{standalone: true}" />
                      <div class="inline-inputs">
                        <input [ngModel]="item.unit" (ngModelChange)="updateDraftItem(index, { unit: $event })" [ngModelOptions]="{standalone: true}" />
                      </div>
                      <small>{{ item.quantity || 0 }} {{ item.unit || 'pcs' }} ordered</small>
                    </td>
                    <td>
                      <input type="number" [ngModel]="item.mrp" (ngModelChange)="updateDraftItem(index, { mrp: toNumber($event) })" [ngModelOptions]="{standalone: true}" placeholder="MRP" />
                      <div class="inline-inputs">
                        <input type="number" [ngModel]="item.discountPercent" (ngModelChange)="updateDraftItem(index, { discountPercent: toNumber($event) })" [ngModelOptions]="{standalone: true}" placeholder="Disc %" />
                        <input type="number" [ngModel]="item.discountAmount" (ngModelChange)="updateDraftItem(index, { discountAmount: toNumber($event) })" [ngModelOptions]="{standalone: true}" placeholder="Disc amt" />
                      </div>
                    </td>
                    <td>
                      <input type="number" [ngModel]="item.unitCost" (ngModelChange)="updateDraftItem(index, { unitCost: toNumber($event) })" [ngModelOptions]="{standalone: true}" placeholder="Rate" />
                      <input type="number" [ngModel]="item.gstPercent" (ngModelChange)="updateDraftItem(index, { gstPercent: toNumber($event) })" [ngModelOptions]="{standalone: true}" placeholder="GST %" />
                    </td>
                    <td><strong>{{ linePreview(item).taxableAmount | auraMoney:'1.0-0' }}</strong></td>
                    <td><strong>{{ linePreview(item).lineTotal | auraMoney:'1.0-0' }}</strong><small>GST {{ linePreview(item).gstAmount | auraMoney:'1.0-0' }}</small></td>
                    <td>
                      <input [ngModel]="item.batchNumber" (ngModelChange)="updateDraftItem(index, { batchNumber: $event })" [ngModelOptions]="{standalone: true}" placeholder="Batch" />
                      <input type="date" [ngModel]="item.expiryDate" (ngModelChange)="updateDraftItem(index, { expiryDate: $event })" [ngModelOptions]="{standalone: true}" />
                    </td>
                    <td><button class="ghost-button mini danger" type="button" (click)="removeDraftLine(index)" [disabled]="draftItems().length === 1">Remove</button></td>
                  </tr>
                </tbody>
              </table>
            </div>

            <div class="totals-grid full">
              <span><strong>Subtotal</strong>{{ draftTotals().subtotalAmount | auraMoney:'1.0-0' }}</span>
              <span><strong>Discount</strong>{{ draftTotals().discountAmount | auraMoney:'1.0-0' }}</span>
              <span><strong>Taxable</strong>{{ draftTotals().taxableAmount | auraMoney:'1.0-0' }}</span>
              <span><strong>GST</strong>{{ draftTotals().gstAmount | auraMoney:'1.0-0' }}</span>
              <span><strong>Total</strong>{{ draftTotals().grandTotal | auraMoney:'1.0-0' }}</span>
            </div>

            <div class="form-actions full">
              <button class="primary-button" type="submit" [disabled]="draftForm.invalid || !validDraftItems().length || saving()">Create PO draft</button>
            </div>
          </form>
        </section>

        <section class="panel" *ngIf="visiblePurchaseOrderView('receive')">
          <div class="section-title">
            <div><h2>Receive approved PO into FIFO stock</h2></div>
          </div>
          <form [formGroup]="receiveForm" (ngSubmit)="receiveBatch()" class="po-form receive">
            <input type="hidden" formControlName="purchaseOrderId" />
            <label class="field"><span>Supplier invoice no</span><input formControlName="supplierInvoiceNo" /></label>
            <label class="field"><span>Invoice date</span><input type="date" formControlName="supplierInvoiceDate" /></label>
            <label class="field"><span>Challan no</span><input formControlName="challanNo" /></label>
            <label class="field"><span>GRN no</span><input formControlName="grnNumber" /></label>
            <label class="field"><span>GRN date</span><input type="date" formControlName="grnDate" /></label>
            <label class="field"><span>Received by</span><input formControlName="receivedBy" /></label>
            <label class="field full"><span>Receive note</span><textarea formControlName="note"></textarea></label>

            <div class="line-table full">
              <table>
                <thead><tr><th>Product</th><th>Ordered</th><th>Receive</th><th>Damage / short / excess</th><th>Batch / expiry</th><th>Rate / GST</th></tr></thead>
                <tbody>
                  <tr *ngFor="let item of receiveItems(); let index = index">
                    <td><strong>{{ item.productName }}</strong><small>{{ item.productId }}</small></td>
                    <td>{{ item.orderedQty }} {{ item.unit }}<small>Received {{ item.alreadyReceivedQty }}</small></td>
                    <td><input type="number" [ngModel]="item.quantity" (ngModelChange)="updateReceiveItem(index, { quantity: toNumber($event) })" [ngModelOptions]="{standalone: true}" /></td>
                    <td>
                      <div class="inline-inputs">
                        <input type="number" [ngModel]="item.damagedQty" (ngModelChange)="updateReceiveItem(index, { damagedQty: toNumber($event) })" [ngModelOptions]="{standalone: true}" placeholder="Damage" />
                        <input type="number" [ngModel]="item.shortQty" (ngModelChange)="updateReceiveItem(index, { shortQty: toNumber($event) })" [ngModelOptions]="{standalone: true}" placeholder="Short" />
                        <input type="number" [ngModel]="item.excessQty" (ngModelChange)="updateReceiveItem(index, { excessQty: toNumber($event) })" [ngModelOptions]="{standalone: true}" placeholder="Excess" />
                      </div>
                    </td>
                    <td>
                      <input [ngModel]="item.batchNumber" (ngModelChange)="updateReceiveItem(index, { batchNumber: $event })" [ngModelOptions]="{standalone: true}" placeholder="Batch" />
                      <input type="date" [ngModel]="item.expiryDate" (ngModelChange)="updateReceiveItem(index, { expiryDate: $event })" [ngModelOptions]="{standalone: true}" />
                    </td>
                    <td>
                      <input type="number" [ngModel]="item.unitCost" (ngModelChange)="updateReceiveItem(index, { unitCost: toNumber($event) })" [ngModelOptions]="{standalone: true}" />
                      <input type="number" [ngModel]="item.gstPercent" (ngModelChange)="updateReceiveItem(index, { gstPercent: toNumber($event) })" [ngModelOptions]="{standalone: true}" />
                    </td>
                  </tr>
                  <tr *ngIf="!receiveItems().length"><td colspan="6">Open an approved PO, then click Receive.</td></tr>
                </tbody>
              </table>
            </div>

            <div class="impact-strip full">
              <span><strong>Stock impact</strong>{{ stockImpactQty() }} units will be received</span>
              <span><strong>GRN safety</strong>Damage, short, excess and rate/GST changes become PO variance warnings.</span>
            </div>
            <div class="form-actions full">
              <button class="primary-button" type="submit" [disabled]="!receiveForm.value.purchaseOrderId || !receiveItems().length || saving()">Receive GRN</button>
            </div>
          </form>
        </section>
      </div>

      <section class="panel" *ngIf="visiblePurchaseOrderView('suggestions')">
        <div class="section-title"><div><h2>Suggested purchase orders</h2></div></div>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Product</th><th>Branch</th><th>Stockout</th><th>Suggested qty</th><th>Cost</th><th>Reason</th><th>Action</th></tr></thead>
            <tbody>
              <tr *ngFor="let row of suggestions().slice(0, 30)">
                <td><a [routerLink]="['/inventory/products', row.productId]">{{ row.name }}</a></td>
                <td>{{ branchName(row.branchId) }}</td>
                <td>{{ row.predictedStockoutDate || 'watch' }}</td>
                <td>{{ row.recommendedQty || 0 }}</td>
                <td>{{ row.estimatedCost | auraMoney:'1.0-0' }}</td>
                <td>{{ row.reason || 'Low stock threshold reached' }}</td>
                <td><button class="ghost-button mini" type="button" (click)="createDraftFromSuggestion(row)" [disabled]="saving()">Create draft</button></td>
              </tr>
              <tr *ngIf="!suggestions().length"><td colspan="7">No AI reorder suggestions right now.</td></tr>
            </tbody>
          </table>
        </div>
      </section>

      <section class="panel" *ngIf="visiblePurchaseOrderView('workflow')">
        <div class="section-title"><div><h2>Draft, approve, order, receive</h2></div></div>
        <div class="table-wrap">
          <table>
            <thead><tr><th>PO</th><th>Supplier</th><th>Branch</th><th>Items</th><th>Expected</th><th>Total</th><th>Status</th><th>Warnings</th><th>Actions</th></tr></thead>
            <tbody>
              <tr *ngFor="let row of recommendations()">
                <td><strong>{{ row.poNumber || row.id }}</strong><small>{{ row.createdAt | auraDate:'date' }}</small></td>
                <td>{{ supplierName(row.supplierId) }}<small>{{ row.supplier?.gstin || 'GSTIN pending' }}</small></td>
                <td>{{ branchName(row.branchId) }}</td>
                <td>{{ itemCount(row) }} item(s)<small>{{ receivedSummary(row) }}</small></td>
                <td>{{ row.expectedDeliveryDate || 'Not set' }}</td>
                <td>{{ (row.grandTotal || row.totalEstimatedCost) | auraMoney:'1.0-0' }}</td>
                <td><span class="badge" [class.warn]="row.status === 'draft'">{{ row.status || 'draft' }}</span></td>
                <td><span class="pill" *ngIf="warningCount(row)">{{ warningCount(row) }} alert(s)</span><span *ngIf="!warningCount(row)">clear</span></td>
                <td class="action-cell">
                  <a class="ghost-button mini" [routerLink]="['/inventory/purchase-orders', row.id]">Open</a>
                  <button class="ghost-button mini" type="button" (click)="sendWhatsApp(row)" [disabled]="saving() || row.status === 'draft'">WhatsApp</button>
                  <button class="ghost-button mini" type="button" (click)="prepareReceive(row)" [disabled]="!canReceive(row)">Receive</button>
                  <button class="primary-button mini" type="button" (click)="approve(row)" [disabled]="row.status !== 'draft' || saving()">Approve</button>
                  <button class="ghost-button mini danger" type="button" (click)="transition(row, 'reject')" [disabled]="!canReject(row) || saving()">Reject</button>
                  <button class="ghost-button mini danger" type="button" (click)="transition(row, 'cancel')" [disabled]="!canCancel(row) || saving()">Cancel</button>
                  <button class="ghost-button mini" type="button" (click)="transition(row, 'close')" [disabled]="!canClose(row) || saving()">Close</button>
                  <button class="ghost-button mini" type="button" (click)="transition(row, 'reopen')" [disabled]="!canReopen(row) || saving()">Reopen</button>
                </td>
              </tr>
              <tr *ngIf="!recommendations().length"><td colspan="9">No PO draft created yet.</td></tr>
            </tbody>
          </table>
        </div>
      </section>

      <section class="panel po-detail" *ngIf="visiblePurchaseOrderView('detail') && selectedPo() as po" id="po-print-area">
        <div class="section-title">
          <div><h2>{{ po.poNumber || po.id }}</h2></div>
          <div class="hero-actions">
            <button class="ghost-button mini" type="button" (click)="prepareReceive(po)" [disabled]="!canReceive(po)">Receive</button>
            <button class="ghost-button mini" type="button" (click)="printSelectedPo()">Print</button>
          </div>
        </div>
        <div class="detail-grid">
          <div><span>Supplier</span><strong>{{ supplierName(po.supplierId) }}</strong><small>{{ po.supplier?.phone || 'Phone missing' }} · {{ po.supplier?.email || 'Email missing' }}</small></div>
          <div><span>GSTIN</span><strong>{{ po.supplier?.gstin || 'Missing' }}</strong><small>{{ po.supplier?.address || 'Address missing' }}</small></div>
          <div><span>Expected delivery</span><strong>{{ po.expectedDeliveryDate || 'Not set' }}</strong><small>{{ po.deliveryTerms || 'Delivery terms pending' }}</small></div>
          <div><span>Payment terms</span><strong>{{ po.paymentTerms || 'Not set' }}</strong><small>{{ po.approvalNote || 'Approval note pending' }}</small></div>
          <div><span>GRN</span><strong>{{ po.grnNumber || 'Not received' }}</strong><small>{{ po.supplierInvoiceNo || 'Invoice pending' }}</small></div>
          <div><span>Totals</span><strong>{{ (po.grandTotal || po.totalEstimatedCost) | auraMoney:'1.0-0' }}</strong><small>GST {{ po.gstAmount | auraMoney:'1.0-0' }}</small></div>
        </div>
        <div class="warning-box" *ngIf="warningList(po).length">
          <strong>Variance and safety warnings</strong>
          <span *ngFor="let warning of warningList(po)">{{ warning.message || warning.type }}</span>
        </div>
        <div class="line-table">
          <table>
            <thead><tr><th>Product / HSN</th><th>Ordered</th><th>Received</th><th>MRP</th><th>Rate</th><th>Discount</th><th>GST</th><th>Total</th><th>Batch</th></tr></thead>
            <tbody>
              <tr *ngFor="let item of po.items || []">
                <td><strong>{{ item.productName || item.productId }}</strong><small>{{ item.hsnSac || 'HSN pending' }}</small></td>
                <td>{{ item.requestedQty || 0 }} {{ item.unit || 'pcs' }}</td>
                <td>{{ item.receivedQty || 0 }} {{ item.unit || 'pcs' }}</td>
                <td>{{ item.mrp | auraMoney:'1.0-0' }}</td>
                <td>{{ item.unitCost | auraMoney:'1.0-0' }}</td>
                <td>{{ item.discountPercent || 0 }}% / {{ item.discountAmount | auraMoney:'1.0-0' }}</td>
                <td>{{ item.gstPercent || 0 }}% / {{ item.gstAmount | auraMoney:'1.0-0' }}</td>
                <td>{{ (item.lineTotal || item.estimatedTotal) | auraMoney:'1.0-0' }}</td>
                <td>{{ item.batchNumber || '-' }}<small>{{ item.expiryDate || 'No expiry' }}</small></td>
              </tr>
            </tbody>
          </table>
        </div>
        <div class="history-strip">
          <span *ngFor="let event of po.statusHistory || []"><strong>{{ event.status }}</strong>{{ event.at | auraDate:'date' }} {{ event.note }}</span>
        </div>
      </section>

      <section class="panel" *ngIf="whatsappDraft() && visiblePurchaseOrderView('message')">
        <div class="section-title"><div><h2>Approval-safe draft message</h2></div></div>
        <div class="draft-box">{{ whatsappDraft() }}</div>
      </section>
        </main>
      </div>
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

    .po-workspace {
      display: grid;
      grid-template-columns: 315px minmax(0, 1fr);
      gap: 12px;
      align-items: start;
    }

    .po-side-nav,
    .po-detail-pane {
      display: grid;
      gap: 12px;
    }

    .po-side-nav {
      position: sticky;
      top: 82px;
      align-self: start;
    }

    .po-nav-card {
      display: grid;
      grid-template-columns: 48px minmax(0, 1fr) auto;
      align-items: center;
      gap: 10px;
      width: 100%;
      min-height: 88px;
      padding: 14px;
      border: 1px solid var(--line);
      border-left: 3px solid var(--color-primary);
      border-radius: 8px;
      color: var(--text);
      background: var(--surface);
      box-shadow: 0 4px 12px rgba(12, 26, 43, 0.06);
      cursor: pointer;
      text-align: left;
      transition: transform 160ms ease, box-shadow 160ms ease, border-color 160ms ease, background 160ms ease;
    }

    .po-nav-card:hover {
      transform: translateY(-2px);
      border-color: var(--color-primary);
      box-shadow: 0 8px 22px rgba(12, 26, 43, 0.1);
    }

    .po-nav-card.active {
      border-color: var(--color-primary);
      background: linear-gradient(90deg, rgba(0, 0, 0, 0.04), rgba(0, 0, 0, 0.03), rgba(0, 0, 0, 0.03));
      box-shadow: 0 8px 22px rgba(12, 26, 43, 0.12);
    }

    .po-nav-card strong,
    .po-nav-card small,
    .po-nav-card i {
      display: block;
    }

    .po-nav-card strong {
      font-size: 0.96rem;
      line-height: 1.2;
    }

    .po-nav-card small {
      margin-top: 4px;
      color: var(--muted);
      font-size: 0.72rem;
      font-weight: 800;
      line-height: 1.25;
    }

    .po-nav-card i {
      padding: 3px 8px;
      border-radius: 999px;
      color: var(--color-primary-strong);
      background: rgba(75, 18, 56, 0.08);
      font-size: 0.68rem;
      font-style: normal;
      font-weight: 900;
      text-transform: uppercase;
    }

    .po-nav-icon {
      display: inline-grid;
      place-items: center;
      width: 48px;
      height: 48px;
      border-radius: 8px;
      color: var(--color-primary-strong);
      background: rgba(75, 18, 56, 0.12);
      font-weight: 900;
    }

    .po-kpis,
    .po-layout,
    .detail-grid,
    .totals-grid {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 12px;
    }

    .po-layout {
      grid-template-columns: minmax(0, 1.4fr) minmax(420px, 0.8fr);
      align-items: stretch;
    }

    .po-form {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 10px;
    }

    .po-form .full {
      grid-column: 1 / -1;
    }

    .po-form textarea {
      min-height: 76px;
      resize: vertical;
    }

    .supplier-strip,
    .impact-strip,
    .history-strip,
    .warning-box {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      padding: 10px;
      border: 1px solid rgba(0, 0, 0, 0.03);
      border-radius: 18px;
      background: rgba(255, 255, 255, 0.92);
    }

    .supplier-strip span,
    .impact-strip span,
    .history-strip span,
    .totals-grid span,
    .detail-grid div {
      border: 1px solid rgba(75, 18, 56, 0.08);
      border-radius: 14px;
      padding: 10px;
      background: rgba(255, 255, 255, 0.96);
      min-width: 0;
    }

    .supplier-strip strong,
    .impact-strip strong,
    .history-strip strong,
    .totals-grid strong,
    .detail-grid span,
    .detail-grid small {
      display: block;
      color: var(--muted);
      font-size: 12px;
      margin-bottom: 4px;
    }

    .detail-grid strong {
      display: block;
      font-size: 16px;
      color: var(--text);
    }

    .table-wrap,
    .line-table {
      overflow: auto;
    }

    table {
      min-width: 1180px;
    }

    .line-table table {
      min-width: 1320px;
    }

    td strong,
    td small {
      display: block;
    }

    td small {
      color: var(--muted);
      margin-top: 3px;
    }

    td input,
    td select {
      min-width: 120px;
      margin-bottom: 6px;
    }

    .inline-inputs {
      display: flex;
      gap: 6px;
    }

    .inline-inputs input {
      min-width: 72px;
    }

    .action-cell {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      min-width: 320px;
    }

    .badge.warn {
      background: #fff3d8;
      color: #7c4d00;
    }

    .pill {
      display: inline-flex;
      align-items: center;
      border-radius: 999px;
      padding: 5px 9px;
      color: #7c2d12;
      background: #ffedd5;
      font-weight: 800;
      font-size: 12px;
    }

    .danger {
      color: var(--red);
      border-color: rgba(180, 35, 24, 0.32);
    }

    .warning-box {
      margin: 12px 0;
      border-color: rgba(180, 35, 24, 0.2);
      background: #fff7ed;
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

    .draft-box {
      border: 1px solid rgba(75, 18, 56, 0.14);
      border-radius: 18px;
      padding: 14px;
      background: rgba(255, 255, 255, 0.92);
      white-space: pre-wrap;
      line-height: 1.5;
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
        box-shadow: none;
      }
    }

    @media (max-width: 1180px) {
      .po-workspace {
        grid-template-columns: 1fr;
      }

      .po-side-nav {
        position: static;
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }

      .po-kpis,
      .po-layout,
      .detail-grid,
      .totals-grid {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }
    }

    @media (max-width: 760px) {
      .po-kpis,
      .po-layout,
      .po-form,
      .detail-grid,
      .totals-grid,
      .po-side-nav {
        grid-template-columns: 1fr;
      }
    }
  `]
})
export class PurchaseOrdersComponent implements OnInit {
  readonly products = signal<ApiRecord[]>([]);
  readonly branches = signal<ApiRecord[]>([]);
  readonly suppliers = signal<ApiRecord[]>([]);
  readonly recommendations = signal<ApiRecord[]>([]);
  readonly intelligence = signal<ApiRecord | null>(null);
  readonly draftItems = signal<DraftItem[]>([this.emptyDraftItem()]);
  readonly receiveItems = signal<ReceiveItem[]>([]);
  readonly selectedPo = signal<ApiRecord | null>(null);
  readonly loading = signal(true);
  readonly saving = signal(false);
  readonly error = signal('');
  readonly success = signal('');
  readonly whatsappDraft = signal('');
  readonly activePurchaseOrderView = signal<PurchaseOrderViewKey>('overview');

  readonly purchaseOrderViews: Array<{ key: PurchaseOrderViewKey; label: string; description: string; icon: string; badge: string }> = [
    { key: 'overview', label: 'Overview', description: 'AI suggestions, drafts and spend KPIs', icon: 'OV', badge: 'Open' },
    { key: 'entry', label: 'Product entry', description: 'Create supplier purchase order drafts', icon: 'PE', badge: 'Draft' },
    { key: 'receive', label: 'Receive GRN', description: 'Receive approved PO into FIFO stock', icon: 'GR', badge: 'Stock' },
    { key: 'suggestions', label: 'AI suggestions', description: 'Low-stock reorder recommendations', icon: 'AI', badge: 'Smart' },
    { key: 'workflow', label: 'PO workflow', description: 'Approve, send, receive and close POs', icon: 'WF', badge: 'Ops' },
    { key: 'detail', label: 'PO detail', description: 'Selected PO totals, lines and warnings', icon: 'DT', badge: 'Audit' },
    { key: 'message', label: 'Supplier message', description: 'Approval-safe WhatsApp draft', icon: 'WA', badge: 'Send' }
  ];

  readonly suggestions = computed(() => ((this.intelligence()?.['suggestions'] || []) as ApiRecord[]));
  readonly draftRows = computed(() => this.recommendations().filter((row) => (row.status || 'draft') === 'draft'));
  readonly approvedRows = computed(() => this.recommendations().filter((row) => ['approved', 'sent', 'partial_receive'].includes(row.status)));
  readonly validDraftItems = computed(() => this.draftItems().filter((item) => item.productId && Number(item.quantity || 0) > 0));
  readonly draftTotals = computed(() => this.calculateTotals(this.validDraftItems()));
  readonly projectedSpend = computed(() =>
    this.suggestions().reduce((total, row) => total + Number(row.estimatedCost || 0), 0)
    + this.recommendations().reduce((total, row) => total + Number(row.grandTotal || row.totalEstimatedCost || 0), 0)
  );
  readonly stockImpactQty = computed(() => this.receiveItems().reduce((total, item) => total + Math.max(0, Number(item.quantity || 0) - Number(item.damagedQty || 0)), 0));

  readonly draftForm = this.fb.group({
    branchId: ['', Validators.required],
    supplierId: [''],
    expectedDeliveryDate: [''],
    paymentTerms: [''],
    deliveryTerms: [''],
    approvalNote: [''],
    sourceType: ['manual'],
    notes: ['Purchase order draft. Verify supplier rate, GST, discount and delivery before approval.']
  });

  readonly receiveForm = this.fb.group({
    purchaseOrderId: [''],
    supplierInvoiceNo: [''],
    supplierInvoiceDate: [''],
    challanNo: [''],
    grnNumber: [`GRN-${new Date().toISOString().slice(0, 10)}`],
    grnDate: [new Date().toISOString().slice(0, 10)],
    receivedBy: ['Owner'],
    note: ['Goods received after supplier invoice check.']
  });

  constructor(private readonly api: ApiService, private readonly fb: UntypedFormBuilder) {}

  setPurchaseOrderView(view: PurchaseOrderViewKey): void {
    this.activePurchaseOrderView.set(view);
  }

  visiblePurchaseOrderView(view: PurchaseOrderViewKey): boolean {
    const active = this.activePurchaseOrderView();
    return active === 'overview' || active === view;
  }

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.error.set('');
    Promise.all([
      firstValueFrom(this.api.list<ApiRecord[]>('products', { limit: 10000 })),
      firstValueFrom(this.api.list<ApiRecord[]>('branches', { limit: 1000 })),
      firstValueFrom(this.api.list<ApiRecord[]>('suppliers', { limit: 1000 })),
      firstValueFrom(this.api.list<ApiRecord[]>('inventory-intelligence/purchase-orders', { limit: 1000 })),
      firstValueFrom(this.api.list<ApiRecord>('inventory-intelligence/summary', { branchId: this.api.selectedBranchId() }))
    ]).then(([products, branches, suppliers, recommendations, intelligence]) => {
      this.products.set(products || []);
      this.branches.set(branches || []);
      this.suppliers.set(suppliers || []);
      this.recommendations.set(recommendations || []);
      this.intelligence.set(intelligence || null);
      const branchId = this.api.selectedBranchId() || branches?.[0]?.id || '';
      this.draftForm.patchValue({ branchId });
      this.loading.set(false);
      const selected = this.selectedPo();
      if (selected?.id) {
        this.selectedPo.set((recommendations || []).find((row) => row.id === selected.id) || null);
      }
    }).catch((error) => {
      this.error.set(this.api.errorText(error, 'Unable to load purchase orders'));
      this.loading.set(false);
    });
  }

  runReorder(): void {
    this.saving.set(true);
    this.api.post<ApiRecord>('inventory-intelligence/reorder-suggestions/run', { branchId: this.api.selectedBranchId() }).subscribe({
      next: () => {
        this.saving.set(false);
        this.success.set('AI reorder suggestions refreshed.');
        this.load();
      },
      error: (error) => {
        this.error.set(this.api.errorText(error, 'Unable to refresh reorder suggestions'));
        this.saving.set(false);
      }
    });
  }

  createDraft(): void {
    if (this.draftForm.invalid) {
      this.draftForm.markAllAsTouched();
      return;
    }
    const items = this.validDraftItems();
    if (!items.length) {
      this.error.set('At least one PO product line is required.');
      return;
    }
    this.saving.set(true);
    this.error.set('');
    const raw = this.draftForm.getRawValue();
    this.api.post<ApiRecord>('inventory-intelligence/purchase-orders', {
      ...raw,
      items: items.map((item) => ({
        productId: item.productId,
        quantity: Number(item.quantity || 0),
        unit: item.unit || 'pcs',
        hsnSac: item.hsnSac || '',
        mrp: Number(item.mrp || 0),
        discountPercent: Number(item.discountPercent || 0),
        discountAmount: Number(item.discountAmount || 0),
        unitCost: Number(item.unitCost || 0),
        gstPercent: Number(item.gstPercent || 0),
        batchNumber: item.batchNumber || '',
        expiryDate: item.expiryDate || ''
      }))
    }).subscribe({
      next: (po) => {
        this.saving.set(false);
        this.success.set('PO draft created with supplier terms, GST and item totals. Stock is not touched until GRN receiving.');
        this.selectedPo.set(po);
        this.draftItems.set([this.emptyDraftItem()]);
        this.load();
      },
      error: (error) => {
        this.error.set(this.api.errorText(error, 'Unable to create PO draft'));
        this.saving.set(false);
      }
    });
  }

  createDraftFromSuggestion(row: ApiRecord): void {
    const product = this.products().find((item) => item.id === row.productId);
    this.draftForm.patchValue({
      branchId: row.branchId || product?.branchId || this.api.selectedBranchId(),
      supplierId: this.supplierIdForProduct(product),
      sourceType: 'stockout_risk',
      notes: `${row.name || product?.name || 'Product'}: ${row.reason || 'AI reorder suggestion'}`
    });
    this.draftItems.set([{
      ...this.emptyDraftItem(),
      productId: row.productId || '',
      quantity: Number(row.recommendedQty || 1),
      unitCost: Number(row.recommendedQty || 1) ? Number(row.estimatedCost || 0) / Number(row.recommendedQty || 1) : Number(product?.unitCost || 0),
      gstPercent: Number(product?.gstRate || 18),
      mrp: Number(product?.price || 0)
    }]);
    this.createDraft();
  }

  approve(row: ApiRecord): void {
    this.saving.set(true);
    this.api.post<ApiRecord>(`inventory-intelligence/purchase-orders/${row.id}/approve`, { approvalNote: this.draftForm.value.approvalNote || 'Owner approved PO' }).subscribe({
      next: (po) => {
        this.saving.set(false);
        this.success.set('PO approved. Supplier ordering can now be sent manually.');
        this.selectedPo.set(po);
        this.load();
      },
      error: (error) => {
        this.error.set(this.api.errorText(error, 'Unable to approve PO'));
        this.saving.set(false);
      }
    });
  }

  transition(row: ApiRecord, action: 'close' | 'cancel' | 'reject' | 'reopen'): void {
    this.saving.set(true);
    const note = action === 'close' ? 'PO manually closed' : `${action} from purchase command center`;
    this.api.post<ApiRecord>(`inventory-intelligence/purchase-orders/${row.id}/${action}`, { note, reason: note }).subscribe({
      next: (po) => {
        this.saving.set(false);
        this.success.set(`PO ${action} completed.`);
        this.selectedPo.set(po);
        this.load();
      },
      error: (error) => {
        this.error.set(this.api.errorText(error, `Unable to ${action} PO`));
        this.saving.set(false);
      }
    });
  }

  openDetail(row: ApiRecord): void {
    this.selectedPo.set(row);
  }

  prepareReceive(row: ApiRecord): void {
    this.selectedPo.set(row);
    this.receiveForm.patchValue({
      purchaseOrderId: row.id || '',
      supplierInvoiceNo: row.supplierInvoiceNo || '',
      supplierInvoiceDate: row.supplierInvoiceDate || '',
      challanNo: row.challanNo || '',
      grnNumber: row.grnNumber || `GRN-${String(row.poNumber || row.id || Date.now()).replace(/[^A-Za-z0-9]/g, '').slice(-10)}`,
      grnDate: row.grnDate || new Date().toISOString().slice(0, 10),
      receivedBy: row.receivedBy || 'Owner'
    });
    this.receiveItems.set((row.items || []).map((item: ApiRecord) => {
      const orderedQty = Number(item.requestedQty || 0);
      const alreadyReceivedQty = Number(item.receivedQty || 0);
      const remaining = Math.max(0, orderedQty - alreadyReceivedQty);
      return {
        itemId: item.id || '',
        productId: item.productId || '',
        productName: item.productName || this.productName(item.productId),
        orderedQty,
        alreadyReceivedQty,
        quantity: remaining,
        damagedQty: 0,
        shortQty: 0,
        excessQty: 0,
        unit: item.unit || 'pcs',
        unitCost: Number(item.unitCost || 0),
        gstPercent: Number(item.gstPercent || 18),
        batchNumber: item.batchNumber || `PO-${String(row.poNumber || row.id || Date.now()).slice(-8)}`,
        expiryDate: item.expiryDate || ''
      };
    }).filter((item: ReceiveItem) => item.quantity > 0 || row.status === 'partial_receive'));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  receiveBatch(): void {
    const purchaseOrderId = this.receiveForm.value.purchaseOrderId || '';
    if (!purchaseOrderId) {
      this.error.set('Open an approved PO before receiving stock.');
      return;
    }
    const items = this.receiveItems().filter((item) => Number(item.quantity || 0) > 0 || Number(item.damagedQty || 0) > 0 || Number(item.shortQty || 0) > 0 || Number(item.excessQty || 0) > 0);
    if (!items.length) {
      this.error.set('At least one GRN receive line is required.');
      return;
    }
    this.saving.set(true);
    const raw = this.receiveForm.getRawValue();
    this.api.post<ApiRecord>(`inventory-intelligence/purchase-orders/${purchaseOrderId}/receive`, {
      ...raw,
      items: items.map((item) => ({
        itemId: item.itemId,
        productId: item.productId,
        quantity: Number(item.quantity || 0),
        damagedQty: Number(item.damagedQty || 0),
        shortQty: Number(item.shortQty || 0),
        excessQty: Number(item.excessQty || 0),
        unitCost: Number(item.unitCost || 0),
        gstPercent: Number(item.gstPercent || 0),
        batchNumber: item.batchNumber,
        expiryDate: item.expiryDate
      }))
    }).subscribe({
      next: (response) => {
        this.saving.set(false);
        this.success.set('GRN received. Stock batch and inventory transactions were created only after confirmation.');
        this.selectedPo.set(response.purchaseOrder || null);
        this.receiveItems.set([]);
        this.load();
      },
      error: (error) => {
        this.error.set(this.api.errorText(error, 'Unable to receive PO batch'));
        this.saving.set(false);
      }
    });
  }

  sendWhatsApp(row: ApiRecord): void {
    this.saving.set(true);
    this.api.post<ApiRecord>(`inventory-intelligence/purchase-orders/${row.id}/send`, {}).subscribe({
      next: (response) => {
        this.saving.set(false);
        this.success.set('Supplier WhatsApp draft queued. Manual send stays approval-safe.');
        this.whatsappDraft.set(response?.queue?.message || 'Supplier WhatsApp draft queued.');
        this.selectedPo.set(response?.purchaseOrder || row);
        this.load();
      },
      error: (error) => {
        this.error.set(this.api.errorText(error, 'Unable to queue supplier WhatsApp draft'));
        this.saving.set(false);
      }
    });
  }

  selectDraftProduct(index: number, productId: string): void {
    const product = this.products().find((item) => item.id === productId);
    this.updateDraftItem(index, {
      productId,
      unitCost: Number(product?.unitCost || 0),
      mrp: Number(product?.price || 0),
      gstPercent: Number(product?.gstRate || 18)
    });
    if (!this.draftForm.value.supplierId && product) {
      this.draftForm.patchValue({ supplierId: this.supplierIdForProduct(product) });
    }
  }

  addDraftLine(): void {
    this.draftItems.set([...this.draftItems(), this.emptyDraftItem()]);
  }

  removeDraftLine(index: number): void {
    const items = this.draftItems().filter((_, itemIndex) => itemIndex !== index);
    this.draftItems.set(items.length ? items : [this.emptyDraftItem()]);
  }

  updateDraftItem(index: number, patch: Partial<DraftItem>): void {
    this.draftItems.set(this.draftItems().map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item));
  }

  updateReceiveItem(index: number, patch: Partial<ReceiveItem>): void {
    this.receiveItems.set(this.receiveItems().map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item));
  }

  draftSupplier(): ApiRecord | undefined {
    return this.suppliers().find((supplier) => supplier.id === this.draftForm.value.supplierId);
  }

  itemCount(row: ApiRecord): number {
    return Array.isArray(row.items) ? row.items.length : 0;
  }

  receivedSummary(row: ApiRecord): string {
    const items = Array.isArray(row.items) ? row.items : [];
    const ordered = items.reduce((total, item) => total + Number(item.requestedQty || 0), 0);
    const received = items.reduce((total, item) => total + Number(item.receivedQty || 0), 0);
    return `${received}/${ordered} received`;
  }

  warningList(row: ApiRecord): ApiRecord[] {
    return Array.isArray(row.warnings) ? row.warnings : (Array.isArray(row.variances) ? row.variances : []);
  }

  warningCount(row: ApiRecord): number {
    return this.warningList(row).length;
  }

  canReceive(row: ApiRecord): boolean {
    return ['approved', 'sent', 'partial_receive'].includes(row.status || '');
  }

  canReject(row: ApiRecord): boolean {
    return ['draft', 'approved'].includes(row.status || 'draft');
  }

  canCancel(row: ApiRecord): boolean {
    return ['draft', 'approved', 'sent'].includes(row.status || 'draft');
  }

  canClose(row: ApiRecord): boolean {
    return ['approved', 'sent', 'partial_receive'].includes(row.status || '');
  }

  canReopen(row: ApiRecord): boolean {
    return ['cancelled', 'rejected'].includes(row.status || '');
  }

  printSelectedPo(): void {
    if (!this.selectedPo()) return;
    setTimeout(() => window.print());
  }

  linePreview(item: DraftItem): ApiRecord {
    const grossAmount = this.round(Number(item.quantity || 0) * Number(item.unitCost || 0));
    const percentageDiscount = this.round(grossAmount * Number(item.discountPercent || 0) / 100);
    const discountAmount = this.round(Number(item.discountAmount || 0) || percentageDiscount);
    const taxableAmount = this.round(Math.max(0, grossAmount - discountAmount));
    const gstAmount = this.round(taxableAmount * Number(item.gstPercent || 0) / 100);
    return { grossAmount, discountAmount, taxableAmount, gstAmount, lineTotal: this.round(taxableAmount + gstAmount) };
  }

  productName(id: string): string {
    return this.products().find((product) => product.id === id)?.name || id || 'Product';
  }

  supplierName(id: string): string {
    return this.suppliers().find((supplier) => supplier.id === id)?.name || 'Preferred supplier';
  }

  branchName(id: string): string {
    return this.branches().find((branch) => branch.id === id)?.name || id || 'All branches';
  }

  toNumber(value: unknown): number {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  private calculateTotals(items: DraftItem[]): ApiRecord {
    return items.reduce((totals, item) => {
      const preview = this.linePreview(item);
      return {
        subtotalAmount: this.round(totals.subtotalAmount + preview.grossAmount),
        discountAmount: this.round(totals.discountAmount + preview.discountAmount),
        taxableAmount: this.round(totals.taxableAmount + preview.taxableAmount),
        gstAmount: this.round(totals.gstAmount + preview.gstAmount),
        grandTotal: this.round(totals.grandTotal + preview.lineTotal)
      };
    }, { subtotalAmount: 0, discountAmount: 0, taxableAmount: 0, gstAmount: 0, grandTotal: 0 });
  }

  private emptyDraftItem(): DraftItem {
    return {
      productId: '',
      hsnSac: '',
      unit: 'pcs',
      quantity: 1,
      mrp: 0,
      discountPercent: 0,
      discountAmount: 0,
      unitCost: 0,
      gstPercent: 18,
      batchNumber: '',
      expiryDate: ''
    };
  }

  private supplierIdForProduct(product?: ApiRecord): string {
    if (!product?.supplier) return '';
    const match = this.suppliers().find((supplier) => String(supplier.name || '').toLowerCase() === String(product.supplier || '').toLowerCase());
    return match?.id || '';
  }

  private round(value: number): number {
    return Math.round((Number(value) || 0) * 100) / 100;
  }
}
