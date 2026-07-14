import { CommonModule } from '@angular/common';
import { Component, OnInit, computed, signal } from '@angular/core';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { FormsModule, ReactiveFormsModule, UntypedFormBuilder, Validators } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { ApiRecord, ApiService } from '../core/api.service';
import { InventoryZenotiChromeComponent } from '../shared/ui/inventory-zenoti-chrome/inventory-zenoti-chrome.component';
import { StateComponent } from '../shared/ui/state/state.component';
import { AuraMoneyPipe } from '../shared/pipes/aura-money.pipe';
import { AuraDatePipe } from '../shared/pipes/aura-date.pipe';

type UploadFile = {
  name: string;
  mimeType: string;
  dataUrl: string;
};

@Component({
  selector: 'app-purchase-bill-drafts',
  standalone: true,
  imports: [AuraDatePipe, AuraMoneyPipe, CommonModule, FormsModule, ReactiveFormsModule, InventoryZenotiChromeComponent, StateComponent],
  template: `
    <section class="page-stack bill-drafts-page inner-page-shell">
      <app-inventory-zenoti-chrome
        title="AI receiving command center"
        breadcrumb="Inventory > AI Purchase Bill Drafts"
        (refresh)="load()"
      >
        <div zenoti-actions class="hero-insights">
          <span>Confirm-gated stock</span>
          <span>Supplier + GST check</span>
          <span>Product match review</span>
          <span>Duplicate-safe receiving</span>
        </div>
      </app-inventory-zenoti-chrome>

      <app-state [loading]="loading()" [error]="error()"></app-state>
      <div class="state success" *ngIf="success()">{{ success() }}</div>

      <section class="draft-kpis inner-stats-grid">
        <article class="metric-card teal"><span>Drafts</span><strong>{{ draftCounts().draft }}</strong></article>
        <article class="metric-card amber"><span>Open lines</span><strong>{{ draftCounts().openLines }}</strong></article>
        <article class="metric-card blue"><span>Confirm-ready</span><strong>{{ draftCounts().confirmReady }}</strong></article>
        <article class="metric-card red"><span>Review value</span><strong>{{ draftCounts().draftValue | auraMoney:'1.0-0' }}</strong></article>
        <article class="metric-card violet"><span>New products</span><strong>{{ draftCounts().newProducts }}</strong></article>
        <article class="metric-card dark"><span>Confirmed</span><strong>{{ draftCounts().confirmed }}</strong></article>
      </section>

      <div class="draft-workbench">
        <section class="panel upload-panel inner-page-card">
          <div class="section-title">
            <div>
              <h2>New draft</h2>
            </div>
          </div>
          <form [formGroup]="uploadForm" (ngSubmit)="createDraft()" class="upload-form inner-form-grid">
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
                <option value="">AI / manual supplier</option>
                <option *ngFor="let supplier of suppliers()" [value]="supplier.id">{{ supplier.name }}</option>
              </select>
            </label>
            <label class="field"><span>Supplier name</span><input formControlName="supplierName" /></label>
            <label class="field"><span>GSTIN</span><input formControlName="supplierGstin" /></label>
            <label class="field"><span>Bill no</span><input formControlName="billNo" /></label>
            <label class="field"><span>Bill date</span><input type="date" formControlName="billDate" /></label>
            <label class="field">
              <span>AI provider</span>
              <select formControlName="aiProvider">
                <option value="local">Local review parser</option>
                <option value="claude">Claude Vision</option>
              </select>
            </label>
            <label class="field file-field">
              <span>Bill photo / PDF</span>
              <input type="file" accept="image/*,.pdf" (change)="onFileSelected($event)" />
            </label>
            <label class="field full">
              <span>OCR / invoice text</span>
              <textarea formControlName="extractedText" placeholder="Paste text if available"></textarea>
            </label>
            <div class="file-preview full" *ngIf="selectedFile()">
              <strong>{{ selectedFile()?.name }}</strong>
              <span>{{ selectedFile()?.mimeType || 'file' }}</span>
            </div>
            <div class="form-actions full">
              <button class="primary-button" type="submit" [disabled]="uploadForm.invalid || saving()">Create draft</button>
            </div>
          </form>
        </section>

        <section class="panel draft-list-panel inner-page-card">
          <div class="section-title">
            <div>
              <h2>Review before stock</h2>
            </div>
            <select class="inline-select" [ngModel]="statusFilter()" (ngModelChange)="statusFilter.set($event); load()" [ngModelOptions]="{ standalone: true }">
              <option value="">All</option>
              <option value="draft">Draft</option>
              <option value="confirmed">Confirmed</option>
              <option value="historical_imported">Historical import</option>
              <option value="cancelled">Cancelled</option>
            </select>
          </div>
          <div class="draft-list">
            <button type="button" *ngFor="let draft of drafts()" (click)="openDraft(draft.id)" [class.active]="activeDraft()?.id === draft.id">
              <span>
                <strong>{{ draft.billNo || 'No bill no' }}</strong>
                <small>{{ draft.supplierName || 'Supplier pending' }} · {{ draft.createdAt | auraDate:'date' }}</small>
              </span>
              <span class="right">
                <strong>{{ draft.totalAmount | auraMoney:'1.0-0' }}</strong>
                <small>{{ draft.status }} · {{ draft.itemCount || 0 }} lines</small>
              </span>
            </button>
            <div class="empty-state" *ngIf="!drafts().length">No purchase bill drafts found.</div>
          </div>
        </section>
      </div>

      <section class="review-layout" *ngIf="activeDraft() as draft">
        <div class="review-command-strip">
          <article class="command-card primary">
            <span>Selected draft</span>
            <strong>{{ draft.billNo || 'No bill no' }}</strong>
            <small>{{ draft.supplierName || 'Supplier pending' }} · {{ draft.totalAmount | auraMoney:'1.0-0' }}</small>
          </article>
          <article class="command-card">
            <span>Review gates</span>
            <strong>{{ activeSummary().readyChecks }}/4</strong>
          </article>
          <article class="command-card">
            <span>Match coverage</span>
            <strong>{{ activeSummary().linkedProducts }}/{{ activeSummary().lineCount }}</strong>
            <small>{{ activeSummary().avgConfidence | number:'1.0-0' }}% average confidence</small>
          </article>
          <article class="command-card">
            <span>Exceptions</span>
            <strong>{{ activeSummary().exceptionCount }}</strong>
            <small>{{ activeSummary().newProducts }} new product(s), {{ activeSummary().warningCount }} warning(s)</small>
          </article>
        </div>

        <aside class="panel bill-preview">
          <div class="section-title">
            <div>
              <h2>{{ draft.originalFileName || 'Attachment' }}</h2>
            </div>
          </div>
          <ng-container *ngIf="draft.attachmentPreview || selectedFile()?.dataUrl; else noPreview">
            <iframe *ngIf="isPdfPreview(draft.attachmentPreview || selectedFile()?.dataUrl || '')" [src]="previewUrl(draft.attachmentPreview || selectedFile()?.dataUrl || '')"></iframe>
            <img *ngIf="!isPdfPreview(draft.attachmentPreview || selectedFile()?.dataUrl || '')" [src]="draft.attachmentPreview || selectedFile()?.dataUrl" alt="Purchase bill preview" />
          </ng-container>
          <ng-template #noPreview>
            <div class="empty-state preview-empty">
              <strong>No bill preview saved</strong>
              <span>Use the extracted header and line fields as the review source for this draft.</span>
            </div>
          </ng-template>
          <div class="warning-list" *ngIf="draft.warnings?.length">
            <strong>Review warnings</strong>
            <span *ngFor="let warning of draft.warnings">{{ warning }}</span>
          </div>
        </aside>

        <section class="panel draft-editor">
          <div class="section-title">
            <div>
              <h2>{{ draft.supplierName || 'Supplier pending' }}</h2>
              <div class="supplier-status">
                <span class="badge success" *ngIf="draft.supplierId">Supplier linked</span>
                <span class="badge warn" *ngIf="!draft.supplierId && (draft.supplierName || draft.supplierGstin)">New supplier</span>
                <small *ngIf="draft.supplierGstin">GSTIN {{ draft.supplierGstin }}</small>
              </div>
            </div>
            <div class="section-actions">
              <button class="ghost-button" type="button" *ngIf="!draft.supplierId && (draft.supplierName || draft.supplierGstin)" (click)="saveSupplier()" [disabled]="draft.status !== 'draft' || saving()">Save supplier</button>
              <button class="ghost-button" type="button" (click)="saveHeader()" [disabled]="draft.status !== 'draft' || saving()">Save header</button>
              <button class="ghost-button" type="button" (click)="cancelDraft()" [disabled]="draft.status !== 'draft' || saving()">Cancel</button>
              <button class="primary-button" type="button" (click)="confirmDraft()" [disabled]="draft.status !== 'draft' || saving()">Confirm purchase</button>
            </div>
          </div>

          <div class="header-grid">
            <label class="field"><span>Supplier</span><input [ngModel]="draft.supplierName" (ngModelChange)="patchDraft('supplierName', $event)" [disabled]="draft.status !== 'draft'" /></label>
            <label class="field"><span>Supplier GSTIN</span><input [ngModel]="draft.supplierGstin" (ngModelChange)="patchDraft('supplierGstin', $event)" [disabled]="draft.status !== 'draft'" /></label>
            <label class="field"><span>Bill no</span><input [ngModel]="draft.billNo" (ngModelChange)="patchDraft('billNo', $event)" [disabled]="draft.status !== 'draft'" /></label>
            <label class="field"><span>Supplier phone</span><input [ngModel]="draft.supplierPhone" (ngModelChange)="patchDraft('supplierPhone', $event)" [disabled]="draft.status !== 'draft'" /></label>
            <label class="field"><span>Supplier email</span><input [ngModel]="draft.supplierEmail" (ngModelChange)="patchDraft('supplierEmail', $event)" [disabled]="draft.status !== 'draft'" /></label>
            <label class="field"><span>Supplier address</span><input [ngModel]="draft.supplierAddress" (ngModelChange)="patchDraft('supplierAddress', $event)" [disabled]="draft.status !== 'draft'" /></label>
            <label class="field"><span>Bill date</span><input type="date" [ngModel]="draft.billDate" (ngModelChange)="patchDraft('billDate', $event)" [disabled]="draft.status !== 'draft'" /></label>
            <label class="field"><span>Subtotal</span><input type="number" [ngModel]="draft.subtotal" (ngModelChange)="patchDraft('subtotal', $event)" [disabled]="draft.status !== 'draft'" /></label>
            <label class="field"><span>GST total</span><input type="number" [ngModel]="draft.gstAmount" (ngModelChange)="patchDraft('gstAmount', $event)" [disabled]="draft.status !== 'draft'" /></label>
            <label class="field"><span>CGST</span><input type="number" [ngModel]="draft.cgstAmount" (ngModelChange)="patchDraft('cgstAmount', $event)" [disabled]="draft.status !== 'draft'" /></label>
            <label class="field"><span>SGST</span><input type="number" [ngModel]="draft.sgstAmount" (ngModelChange)="patchDraft('sgstAmount', $event)" [disabled]="draft.status !== 'draft'" /></label>
            <label class="field"><span>IGST</span><input type="number" [ngModel]="draft.igstAmount" (ngModelChange)="patchDraft('igstAmount', $event)" [disabled]="draft.status !== 'draft'" /></label>
            <label class="field"><span>Total</span><input type="number" [ngModel]="draft.totalAmount" (ngModelChange)="patchDraft('totalAmount', $event)" [disabled]="draft.status !== 'draft'" /></label>
            <label class="field"><span>Status</span><input [ngModel]="draft.validationStatus || draft.status" disabled /></label>
          </div>

          <div class="section-title item-title">
            <div>
              <h2>Product matching and receiving lines</h2>
            </div>
            <button class="ghost-button" type="button" (click)="addItem()" [disabled]="draft.status !== 'draft' || saving()">Add line</button>
          </div>

          <div class="line-readiness">
            <article>
              <span>Lines</span>
              <strong>{{ activeSummary().lineCount }}</strong>
              <small>{{ activeSummary().qtyReady }}/{{ activeSummary().lineCount }} qty checked</small>
            </article>
            <article>
              <span>Products</span>
              <strong>{{ activeSummary().linkedProducts }}</strong>
              <small>{{ activeSummary().newProducts }} need create/link</small>
            </article>
            <article>
              <span>Categories</span>
              <strong>{{ activeSummary().categoryReady }}</strong>
              <small>Required before clean receiving</small>
            </article>
            <article>
              <span>Pricing</span>
              <strong>{{ activeSummary().pricedLines }}</strong>
            </article>
          </div>

          <div class="table-guidance">
            <strong>Line review cockpit</strong>
            <span>Action column stays available on the right. If your screen is smaller, scroll inside this table instead of the full page.</span>
          </div>

          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Product / HSN</th>
                  <th>Category / type</th>
                  <th>Qty</th>
                  <th>MRP / discount</th>
                  <th>Rate / tax</th>
                  <th>GST / total</th>
                  <th>Batch</th>
                  <th>Match</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                <tr *ngFor="let item of draft.items">
                  <td>
                    <input class="cell-input" [ngModel]="item.productName || item.rawName" (ngModelChange)="item.productName = $event" [disabled]="draft.status !== 'draft'" />
                    <input class="cell-input" placeholder="HSN / SAC" [ngModel]="item.hsnSac" (ngModelChange)="item.hsnSac = $event" [disabled]="draft.status !== 'draft'" />
                    <select class="cell-input" [ngModel]="item.productId" (ngModelChange)="setItemProduct(item, $event)" [disabled]="draft.status !== 'draft'">
                      <option value="">Create/link new product</option>
                      <option *ngFor="let product of products()" [value]="product.id">{{ product.name }}</option>
                    </select>
                  </td>
                  <td>
                    <select class="cell-input" [ngModel]="item.categoryId" (ngModelChange)="setItemCategory(item, $event)" [disabled]="draft.status !== 'draft'">
                      <option value="">Select category</option>
                      <option *ngFor="let category of categories()" [value]="category.id">{{ category.name }}</option>
                    </select>
                    <select class="cell-input" [ngModel]="item.usageType" (ngModelChange)="item.usageType = $event" [disabled]="draft.status !== 'draft'">
                      <option value="retail">Retail</option>
                      <option value="consumable">Salon use</option>
                      <option value="both">Both</option>
                      <option value="asset">Asset / tool</option>
                    </select>
                  </td>
                  <td>
                    <input class="cell-input" type="number" [ngModel]="item.qty" (ngModelChange)="item.qty = numberValue($event); recalcItem(item)" [disabled]="draft.status !== 'draft'" />
                    <div class="unit-row">
                      <input [ngModel]="item.purchaseUnit" (ngModelChange)="item.purchaseUnit = $event" [disabled]="draft.status !== 'draft'" />
                      <input type="number" [ngModel]="item.conversionFactor || 1" (ngModelChange)="item.conversionFactor = numberValue($event); recalcItem(item)" [disabled]="draft.status !== 'draft'" />
                      <input [ngModel]="item.stockUnit" (ngModelChange)="item.stockUnit = $event" [disabled]="draft.status !== 'draft'" />
                    </div>
                    <small>{{ item.stockQty || 0 }} stock units</small>
                  </td>
                  <td>
                    <input class="cell-input" type="number" [ngModel]="item.mrp" (ngModelChange)="item.mrp = numberValue($event); recalcItem(item, 'discount')" [disabled]="draft.status !== 'draft'" />
                    <div class="unit-row discount-row">
                      <input type="number" title="Discount percent" [ngModel]="item.discountPercent" (ngModelChange)="item.discountPercent = numberValue($event); recalcItem(item, 'discount')" [disabled]="draft.status !== 'draft'" />
                      <input type="number" title="Discount amount" [ngModel]="item.discountAmount" (ngModelChange)="item.discountAmount = numberValue($event)" [disabled]="draft.status !== 'draft'" />
                      <span>Disc</span>
                    </div>
                  </td>
                  <td>
                    <input class="cell-input" type="number" [ngModel]="item.unitCost" (ngModelChange)="item.unitCost = numberValue($event); recalcItem(item)" [disabled]="draft.status !== 'draft'" />
                    <strong>{{ item.taxableAmount | auraMoney:'1.0-0' }}</strong>
                  </td>
                  <td>
                    <input class="cell-input" type="number" [ngModel]="item.gstPercent" (ngModelChange)="item.gstPercent = numberValue($event); recalcItem(item)" [disabled]="draft.status !== 'draft'" />
                    <div class="tax-row">
                      <input type="number" title="CGST" [ngModel]="item.cgstAmount" (ngModelChange)="item.cgstAmount = numberValue($event)" [disabled]="draft.status !== 'draft'" />
                      <input type="number" title="SGST" [ngModel]="item.sgstAmount" (ngModelChange)="item.sgstAmount = numberValue($event)" [disabled]="draft.status !== 'draft'" />
                    </div>
                    <strong>{{ item.lineTotal | auraMoney:'1.0-0' }}</strong>
                  </td>
                  <td>
                    <input class="cell-input" [ngModel]="item.batchNumber" (ngModelChange)="item.batchNumber = $event" [disabled]="draft.status !== 'draft'" />
                    <input class="cell-input" type="date" [ngModel]="item.expiryDate" (ngModelChange)="item.expiryDate = $event" [disabled]="draft.status !== 'draft'" />
                  </td>
                  <td>
                    <span class="badge" [class.warn]="item.isNewProduct">{{ matchLabel(item) }}</span>
                    <small>{{ (item.matchConfidence || 0) * 100 | number:'1.0-0' }}%</small>
                    <div class="suggestion-list" *ngIf="draft.status === 'draft' && shouldShowSuggestions(item)">
                      <button class="suggestion-chip" type="button" *ngFor="let suggestion of item.matchSuggestions.slice(0, 3)" (click)="applySuggestion(item, suggestion)">
                        {{ suggestion.name }} · {{ suggestion.confidence * 100 | number:'1.0-0' }}%
                      </button>
                    </div>
                  </td>
                  <td>
                    <button class="ghost-button mini" type="button" (click)="saveItem(item)" [disabled]="draft.status !== 'draft' || saving()">Save</button>
                    <button class="ghost-button mini" type="button" *ngIf="draft.status === 'draft' && (item.isNewProduct || !item.productId)" (click)="createProductFromItem(item)" [disabled]="saving()">Add product</button>
                  </td>
                </tr>
                <tr *ngIf="!draft.items?.length"><td colspan="9">No line items in this draft.</td></tr>
              </tbody>
            </table>
          </div>
        </section>
      </section>
    </section>
  `,
  styles: [`
    .compact-hero,
    .section-title {
      align-items: center;
    }

    .compact-hero {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: 14px;
      overflow: hidden;
    }

    .hero-actions,
    .section-actions {
      display: flex;
      flex-wrap: wrap;
      justify-content: flex-end;
      gap: 8px;
    }

    .hero-insights {
      grid-column: 1 / -1;
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }

    .hero-insights span {
      padding: 7px 10px;
      border: 1px solid rgba(75, 18, 56, 0.16);
      border-radius: 999px;
      background: rgba(248, 238, 244, 0.82);
      color: #4B1238;
      font-size: 0.78rem;
      font-weight: 900;
    }

    .supplier-status {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 6px;
      margin-top: 6px;
    }

    .draft-kpis,
    .draft-workbench {
      display: grid;
      grid-template-columns: repeat(6, minmax(0, 1fr));
      gap: 12px;
    }

    .draft-workbench {
      grid-template-columns: minmax(0, 1.2fr) minmax(320px, 0.8fr);
      align-items: stretch;
    }

    .metric-card.violet {
      border-top-color: #6d28d9;
    }

    .metric-card.dark {
      border-top-color: #111827;
    }

    .upload-form,
    .header-grid {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 10px;
    }

    .upload-form .full {
      grid-column: 1 / -1;
    }

    .upload-form textarea {
      min-height: 110px;
      resize: vertical;
    }

    .file-preview {
      display: flex;
      justify-content: space-between;
      gap: 10px;
      padding: 10px;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: var(--surface);
      color: var(--muted);
    }

    .draft-list {
      display: grid;
      gap: 8px;
      max-height: 430px;
      overflow: auto;
    }

    .draft-list button {
      display: flex;
      justify-content: space-between;
      gap: 12px;
      width: 100%;
      padding: 10px;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: #fff;
      text-align: left;
      cursor: pointer;
    }

    .draft-list button.active {
      border-color: var(--teal);
      box-shadow: 0 0 0 2px rgba(75, 18, 56, 0.1);
    }

    .draft-list strong,
    .draft-list small {
      display: block;
    }

    .draft-list small,
    .warning-list span,
    td small {
      color: var(--muted);
      font-size: 0.78rem;
      line-height: 1.35;
    }

    .draft-list .right {
      text-align: right;
      min-width: 110px;
    }

    .review-layout {
      display: grid;
      grid-template-columns: minmax(250px, 0.45fr) minmax(0, 2.55fr);
      gap: 12px;
      align-items: stretch;
    }

    .review-command-strip {
      grid-column: 1 / -1;
      display: grid;
      grid-template-columns: minmax(260px, 1.45fr) repeat(3, minmax(180px, 1fr));
      gap: 10px;
    }

    .command-card {
      position: relative;
      overflow: hidden;
      min-height: 104px;
      padding: 16px;
      border: 1px solid rgba(75, 18, 56, 0.12);
      border-radius: 18px;
      background:
        radial-gradient(circle at 100% 0%, rgba(75, 18, 56, 0.12), transparent 32%),
        linear-gradient(135deg, #ffffff, #F8EEF4);
      box-shadow: 0 18px 42px rgba(15, 23, 42, 0.07);
    }

    .command-card.primary {
      background:
        radial-gradient(circle at 100% 0%, rgba(75, 18, 56, 0.3), transparent 34%),
        linear-gradient(135deg, #2d0a1f, #4B1238);
      color: #fff;
    }

    .command-card span,
    .line-readiness span,
    .table-guidance span {
      display: block;
      color: var(--muted);
      font-size: 0.76rem;
      font-weight: 900;
      letter-spacing: 0.04em;
      text-transform: uppercase;
    }

    .command-card.primary span,
    .command-card.primary small {
      color: rgba(255, 255, 255, 0.72);
    }

    .command-card strong {
      display: block;
      margin-top: 8px;
      color: inherit;
      font-size: clamp(1.35rem, 2vw, 2rem);
      line-height: 1.05;
    }

    .command-card small {
      display: block;
      margin-top: 8px;
      color: var(--muted);
      font-weight: 800;
    }

    .bill-preview,
    .draft-editor {
      min-width: 0;
    }

    .bill-preview {
      position: sticky;
      top: 172px;
    }

    .bill-preview img,
    .bill-preview iframe {
      width: 100%;
      min-height: 520px;
      max-height: 680px;
      object-fit: contain;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: #fff;
    }

    .preview-empty {
      min-height: 420px;
      display: grid;
      place-content: center;
      gap: 8px;
      text-align: center;
    }

    .preview-empty strong {
      color: var(--ink);
    }

    .warning-list {
      display: grid;
      gap: 6px;
      margin-top: 10px;
      padding: 10px;
      border: 1px solid rgba(180, 35, 24, 0.24);
      border-radius: 8px;
      background: #fff7f5;
    }

    .item-title {
      margin-top: 14px;
      padding-top: 12px;
      border-top: 1px solid var(--line);
    }

    .line-readiness {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 8px;
      margin: 12px 0;
    }

    .line-readiness article {
      min-height: 88px;
      padding: 12px;
      border: 1px solid rgba(75, 18, 56, 0.1);
      border-radius: 18px;
      background: rgba(255, 255, 255, 0.92);
    }

    .line-readiness strong {
      display: block;
      margin-top: 6px;
      color: var(--ink);
      font-size: 1.35rem;
      line-height: 1;
    }

    .line-readiness small {
      display: block;
      margin-top: 6px;
      color: var(--muted);
      font-weight: 800;
    }

    .table-guidance {
      display: flex;
      flex-wrap: wrap;
      justify-content: space-between;
      gap: 8px 16px;
      margin-bottom: 8px;
      padding: 10px 12px;
      border: 1px solid rgba(75, 18, 56, 0.12);
      border-radius: 18px;
      background: rgba(248, 238, 244, 0.74);
    }

    .table-guidance strong {
      color: #4B1238;
    }

    .table-guidance span {
      max-width: 760px;
      text-transform: none;
      letter-spacing: 0;
      font-size: 0.78rem;
    }

    .table-wrap {
      max-width: 100%;
      overflow: auto;
      border: 1px solid var(--line);
      border-radius: 18px;
      background: #fff;
      box-shadow: inset 0 -18px 28px rgba(15, 23, 42, 0.03);
    }

    table {
      width: 100%;
      min-width: 1320px;
      table-layout: fixed;
      border-collapse: separate;
      border-spacing: 0;
    }

    th,
    td {
      vertical-align: top;
    }

    th:nth-child(1),
    td:nth-child(1) {
      width: 20%;
    }

    th:nth-child(2),
    td:nth-child(2) {
      width: 11%;
    }

    th:nth-child(3),
    td:nth-child(3) {
      width: 10%;
    }

    th:nth-child(4),
    td:nth-child(4) {
      width: 11%;
    }

    th:nth-child(5),
    td:nth-child(5) {
      width: 9%;
    }

    th:nth-child(6),
    td:nth-child(6) {
      width: 10%;
    }

    th:nth-child(7),
    td:nth-child(7) {
      width: 10%;
    }

    th:nth-child(8),
    td:nth-child(8) {
      width: 9%;
    }

    th:nth-child(9),
    td:nth-child(9) {
      position: sticky;
      right: 0;
      z-index: 2;
      width: 10%;
      min-width: 118px;
      background: linear-gradient(90deg, rgba(255, 255, 255, 0.9), #fff 18%);
      box-shadow: -12px 0 20px rgba(15, 23, 42, 0.08);
    }

    thead th:nth-child(9) {
      z-index: 4;
    }

    .cell-input,
    .unit-row input {
      width: 100%;
      min-height: 34px;
      margin-bottom: 6px;
      padding: 7px 8px;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: #fff;
    }

    .unit-row {
      display: grid;
      grid-template-columns: 0.9fr 0.7fr 0.9fr;
      gap: 6px;
    }

    .discount-row,
    .tax-row {
      grid-template-columns: 0.9fr 0.9fr auto;
      align-items: center;
    }

    .tax-row {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 6px;
      margin-bottom: 6px;
    }

    .tax-row input {
      width: 100%;
      min-height: 34px;
      padding: 7px 8px;
      border: 1px solid var(--line);
      border-radius: 8px;
    }

    .discount-row span {
      color: var(--muted);
      font-size: 0.72rem;
      font-weight: 800;
    }

    .badge.success {
      background: #F8EEF4;
      color: #4B1238;
    }

    .badge.warn {
      background: #fef3c7;
      color: #92400e;
    }

    .suggestion-list {
      display: grid;
      gap: 4px;
      margin-top: 6px;
    }

    .suggestion-chip {
      min-height: 28px;
      padding: 4px 7px;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: #fff;
      color: var(--ink);
      font-size: 0.72rem;
      font-weight: 800;
      text-align: left;
      cursor: pointer;
    }

    .empty-state {
      padding: 14px;
      border: 1px dashed var(--line);
      border-radius: 8px;
      color: var(--muted);
      background: var(--surface);
    }

    @media (max-width: 1180px) {
      .draft-kpis {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }

      .draft-workbench,
      .review-layout {
        grid-template-columns: 1fr;
      }

      .review-command-strip {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }

      .bill-preview {
        position: static;
      }
    }

    @media (max-width: 760px) {
      .draft-kpis,
      .upload-form,
      .header-grid,
      .line-readiness,
      .review-command-strip {
        grid-template-columns: 1fr;
      }

      .compact-hero {
        grid-template-columns: 1fr;
      }

      .hero-actions,
      .section-actions {
        justify-content: flex-start;
      }
    }
  `]
})
export class PurchaseBillDraftsComponent implements OnInit {
  readonly drafts = signal<ApiRecord[]>([]);
  readonly activeDraft = signal<ApiRecord | null>(null);
  readonly branches = signal<ApiRecord[]>([]);
  readonly suppliers = signal<ApiRecord[]>([]);
  readonly products = signal<ApiRecord[]>([]);
  readonly categories = signal<ApiRecord[]>([]);
  readonly selectedFile = signal<UploadFile | null>(null);
  readonly loading = signal(true);
  readonly saving = signal(false);
  readonly error = signal('');
  readonly success = signal('');
  readonly statusFilter = signal('draft');

  readonly uploadForm = this.fb.group({
    branchId: ['', Validators.required],
    supplierId: [''],
    supplierName: [''],
    supplierGstin: [''],
    billNo: [''],
    billDate: [''],
    aiProvider: ['local'],
    extractedText: ['']
  });

  readonly draftCounts = computed(() => {
    const rows = this.drafts();
    const draftRows = rows.filter((row) => row.status === 'draft');
    return {
      draft: draftRows.length,
      confirmed: rows.filter((row) => row.status === 'confirmed').length,
      newProducts: rows.reduce((sum, row) => sum + Number(row.newProductCount || 0), 0),
      openLines: draftRows.reduce((sum, row) => sum + Number(row.itemCount || row.items?.length || 0), 0),
      confirmReady: draftRows.filter((row) => String(row.validationStatus || '').toLowerCase() === 'ready').length,
      draftValue: draftRows.reduce((sum, row) => sum + Number(row.totalAmount || 0), 0)
    };
  });

  readonly activeSummary = computed(() => {
    const draft = this.activeDraft();
    const items = Array.isArray(draft?.items) ? draft.items : [];
    const lineCount = items.length;
    const linkedProducts = items.filter((item) => !!item.productId).length;
    const newProducts = items.filter((item) => item.isNewProduct || !item.productId).length;
    const categoryReady = items.filter((item) => !!item.categoryId).length;
    const qtyReady = items.filter((item) => Number(item.qty || 0) > 0).length;
    const pricedLines = items.filter((item) => Number(item.unitCost || item.lineTotal || 0) > 0).length;
    const warningCount = Array.isArray(draft?.warnings) ? draft.warnings.length : 0;
    const confidenceValues = items
      .map((item) => Number(item.matchConfidence || 0))
      .filter((confidence) => confidence > 0);
    const avgConfidence = confidenceValues.length
      ? confidenceValues.reduce((sum, confidence) => sum + confidence, 0) / confidenceValues.length * 100
      : 0;
    const supplierReady = !!(draft?.supplierId || draft?.supplierName || draft?.supplierGstin);
    const headerReady = !!(draft?.billNo && Number(draft?.totalAmount || 0) > 0);
    const lineReady = lineCount > 0 && qtyReady === lineCount && pricedLines === lineCount;
    const productReady = lineCount > 0 && categoryReady === lineCount && (linkedProducts + newProducts) === lineCount;
    const exceptionCount = newProducts + warningCount + Math.max(lineCount - categoryReady, 0);

    return {
      lineCount,
      linkedProducts,
      newProducts,
      categoryReady,
      qtyReady,
      pricedLines,
      warningCount,
      avgConfidence,
      exceptionCount,
      readyChecks: [supplierReady, headerReady, lineReady, productReady].filter(Boolean).length
    };
  });

  constructor(
    private readonly api: ApiService,
    private readonly fb: UntypedFormBuilder,
    private readonly sanitizer: DomSanitizer
  ) {}

  ngOnInit(): void {
    const branchId = this.api.selectedBranchId();
    this.uploadForm.patchValue({ branchId });
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.error.set('');
    Promise.all([
      firstValueFrom(this.api.list<ApiRecord[]>('inventory-intelligence/purchase-bill-drafts', { branchId: this.api.selectedBranchId(), status: this.statusFilter(), limit: 100 })),
      firstValueFrom(this.api.list<ApiRecord[]>('inventory-intelligence/product-categories', { branchId: this.api.selectedBranchId() })),
      firstValueFrom(this.api.list<ApiRecord[]>('products', { branchId: this.api.selectedBranchId(), limit: 10000 })),
      firstValueFrom(this.api.list<ApiRecord[]>('suppliers', { limit: 10000 })),
      firstValueFrom(this.api.list<ApiRecord[]>('branches'))
    ]).then(([drafts, categories, products, suppliers, branches]) => {
      this.drafts.set(drafts || []);
      this.categories.set(categories || []);
      this.products.set(products || []);
      this.suppliers.set(suppliers || []);
      this.branches.set(branches || []);
      this.loading.set(false);
      const activeId = this.activeDraft()?.id;
      if (activeId) {
        this.openDraft(activeId);
      } else if (drafts?.[0]?.id) {
        this.openDraft(drafts[0].id);
      }
    }).catch((error) => {
      this.error.set(this.api.errorText(error, 'Unable to load purchase bill drafts'));
      this.loading.set(false);
    });
  }

  async onFileSelected(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    if (file.size > 7 * 1024 * 1024) {
      this.error.set('Bill file must be below 7 MB.');
      input.value = '';
      return;
    }
    try {
      this.selectedFile.set(await this.prepareUploadFile(file));
    } catch (error: any) {
      this.error.set(this.api.errorText(error, 'Unable to read bill file'));
      input.value = '';
    }
  }

  createDraft(): void {
    if (this.uploadForm.invalid) {
      this.uploadForm.markAllAsTouched();
      return;
    }
    this.saving.set(true);
    this.error.set('');
    const file = this.selectedFile();
    const payload = {
      ...this.uploadForm.value,
      fileName: file?.name || '',
      fileMimeType: file?.mimeType || '',
      fileDataUrl: file?.dataUrl || ''
    };
    this.api.post<ApiRecord>('inventory-intelligence/purchase-bill-drafts/upload', payload).subscribe({
      next: (draft) => {
        this.success.set('Purchase bill draft created. Review items before confirmation.');
        this.saving.set(false);
        this.activeDraft.set(draft);
        this.selectedFile.set(null);
        this.load();
      },
      error: (error) => {
        this.error.set(this.api.errorText(error, 'Unable to create purchase bill draft'));
        this.saving.set(false);
      }
    });
  }

  openDraft(id: string): void {
    if (!id) return;
    this.api.get<ApiRecord>('inventory-intelligence/purchase-bill-drafts', id).subscribe({
      next: (draft) => this.activeDraft.set(draft),
      error: (error) => this.error.set(this.api.errorText(error, 'Unable to open draft'))
    });
  }

  patchDraft(key: string, value: unknown): void {
    const draft = this.activeDraft();
    if (!draft) return;
    this.activeDraft.set({ ...draft, [key]: value });
  }

  saveHeader(): void {
    const draft = this.activeDraft();
    if (!draft) return;
    this.saving.set(true);
    this.api.patch<ApiRecord>(`inventory-intelligence/purchase-bill-drafts/${draft.id}`, {
      supplierId: draft.supplierId || '',
      supplierName: draft.supplierName || '',
      supplierGstin: draft.supplierGstin || '',
      supplierPhone: draft.supplierPhone || '',
      supplierEmail: draft.supplierEmail || '',
      supplierAddress: draft.supplierAddress || '',
      billNo: draft.billNo || '',
      billDate: draft.billDate || '',
      subtotal: Number(draft.subtotal || 0),
      gstAmount: Number(draft.gstAmount || 0),
      cgstAmount: Number(draft.cgstAmount || 0),
      sgstAmount: Number(draft.sgstAmount || 0),
      igstAmount: Number(draft.igstAmount || 0),
      totalAmount: Number(draft.totalAmount || 0)
    }).subscribe({
      next: (updated) => {
        this.activeDraft.set(updated);
        this.success.set('Draft header saved.');
        this.saving.set(false);
        this.load();
      },
      error: (error) => {
        this.error.set(this.api.errorText(error, 'Unable to save draft header'));
        this.saving.set(false);
      }
    });
  }

  saveSupplier(): void {
    const draft = this.activeDraft();
    if (!draft) return;
    this.saving.set(true);
    this.error.set('');
    this.api.post<ApiRecord>(`inventory-intelligence/purchase-bill-drafts/${draft.id}/save-supplier`, {
      supplierName: draft.supplierName || '',
      supplierGstin: draft.supplierGstin || '',
      supplierPhone: draft.supplierPhone || '',
      supplierEmail: draft.supplierEmail || '',
      supplierAddress: draft.supplierAddress || ''
    }).subscribe({
      next: (updated) => {
        this.activeDraft.set(updated);
        this.success.set('Supplier saved and linked with this draft.');
        this.saving.set(false);
        this.load();
      },
      error: (error) => {
        this.error.set(this.api.errorText(error, 'Unable to save supplier'));
        this.saving.set(false);
      }
    });
  }

  addItem(): void {
    const draft = this.activeDraft();
    if (!draft) return;
    this.saving.set(true);
    this.api.post<ApiRecord>(`inventory-intelligence/purchase-bill-drafts/${draft.id}/items`, {
      productName: '',
      qty: 1,
      unitCost: 0,
      gstPercent: 18
    }).subscribe({
      next: (updated) => {
        this.activeDraft.set(updated);
        this.saving.set(false);
      },
      error: (error) => {
        this.error.set(this.api.errorText(error, 'Unable to add bill line'));
        this.saving.set(false);
      }
    });
  }

  saveItem(item: ApiRecord): void {
    const draft = this.activeDraft();
    if (!draft) return;
    this.saving.set(true);
    this.api.patch<ApiRecord>(`inventory-intelligence/purchase-bill-drafts/${draft.id}/items/${item.id}`, this.itemPayload(item)).subscribe({
      next: (updated) => {
        this.activeDraft.set(updated);
        this.success.set('Bill line saved.');
        this.saving.set(false);
        this.load();
      },
      error: (error) => {
        this.error.set(this.api.errorText(error, 'Unable to save bill line'));
        this.saving.set(false);
      }
    });
  }

  createProductFromItem(item: ApiRecord): void {
    const draft = this.activeDraft();
    if (!draft) return;
    this.saving.set(true);
    this.error.set('');
    this.api.post<ApiRecord>(`inventory-intelligence/purchase-bill-drafts/${draft.id}/items/${item.id}/create-product`, this.itemPayload(item)).subscribe({
      next: (updated) => {
        this.activeDraft.set(updated);
        this.success.set('Product saved in product master and linked with this bill row. Stock is still unchanged until confirm.');
        this.saving.set(false);
        this.load();
      },
      error: (error) => {
        this.error.set(this.api.errorText(error, 'Unable to add product from bill line'));
        this.saving.set(false);
      }
    });
  }

  confirmDraft(): void {
    const draft = this.activeDraft();
    if (!draft) return;
    this.saving.set(true);
    this.api.post<ApiRecord>(`inventory-intelligence/purchase-bill-drafts/${draft.id}/confirm`, {}).subscribe({
      next: (updated) => {
        this.activeDraft.set(updated);
        this.success.set('Purchase confirmed and stock received.');
        this.saving.set(false);
        this.statusFilter.set('');
        this.load();
      },
      error: (error) => {
        this.error.set(this.api.errorText(error, 'Unable to confirm purchase'));
        this.saving.set(false);
      }
    });
  }

  cancelDraft(): void {
    const draft = this.activeDraft();
    if (!draft) return;
    this.saving.set(true);
    this.api.post<ApiRecord>(`inventory-intelligence/purchase-bill-drafts/${draft.id}/cancel`, { reason: 'Cancelled from draft review' }).subscribe({
      next: (updated) => {
        this.activeDraft.set(updated);
        this.success.set('Draft cancelled. No stock was updated.');
        this.saving.set(false);
        this.load();
      },
      error: (error) => {
        this.error.set(this.api.errorText(error, 'Unable to cancel draft'));
        this.saving.set(false);
      }
    });
  }

  setItemProduct(item: ApiRecord, productId: string): void {
    item.productId = productId;
    const product = this.products().find((row) => row.id === productId);
    if (product) {
      item.productName = product.name;
      item.categoryName = product.category || item.categoryName;
      item.usageType = product.usageType || item.usageType || 'retail';
      item.mrp = Number(product.price || item.mrp || 0);
      item.unitCost = Number(product.unitCost || item.unitCost || 0);
      item.isNewProduct = false;
      item.matchStatus = 'manual_match';
      item.matchConfidence = 1;
      item.matchSuggestions = [];
    } else {
      item.isNewProduct = true;
    }
    this.recalcItem(item);
  }

  applySuggestion(item: ApiRecord, suggestion: ApiRecord): void {
    item.productId = suggestion.productId;
    item.productName = suggestion.name || item.productName;
    item.categoryName = suggestion.category || item.categoryName;
    item.usageType = suggestion.usageType || item.usageType || 'retail';
    item.isNewProduct = false;
    item.matchStatus = suggestion.status || 'manual_match';
    item.matchConfidence = Number(suggestion.confidence || item.matchConfidence || 1);
    item.matchSuggestions = [];
    const product = this.products().find((row) => row.id === suggestion.productId);
    if (product) {
      item.mrp = Number(product.price || item.mrp || 0);
      item.unitCost = Number(product.unitCost || item.unitCost || 0);
    }
    this.recalcItem(item);
  }

  setItemCategory(item: ApiRecord, categoryId: string): void {
    item.categoryId = categoryId;
    item.categoryName = this.categories().find((category) => category.id === categoryId)?.name || '';
  }

  shouldShowSuggestions(item: ApiRecord): boolean {
    const suggestions = item.matchSuggestions || [];
    if (!suggestions.length) return false;
    const status = String(item.matchStatus || '');
    if (['created_product', 'manual_match', 'exact_match', 'confirmed', 'confirmed_po_match'].includes(status)) return false;
    if (item.productId && Number(item.matchConfidence || 0) >= 0.88) return false;
    return true;
  }

  matchLabel(item: ApiRecord): string {
    if (item.isNewProduct) return 'New product';
    const status = String(item.matchStatus || 'matched').replace(/_/g, ' ').trim();
    return status ? status.charAt(0).toUpperCase() + status.slice(1) : 'Matched';
  }

  recalcItem(item: ApiRecord, mode: 'cost' | 'discount' = 'cost'): void {
    const qty = Number(item.qty || 0);
    const conversion = Number(item.conversionFactor || 1) || 1;
    const gstRate = Number(item.gstPercent || 0);
    if (mode === 'discount' && Number(item.mrp || 0) > 0 && Number(item.discountPercent || 0) > 0) {
      const inclusiveAfterDiscount = Number(item.mrp || 0) * (1 - Number(item.discountPercent || 0) / 100);
      item.unitCost = Math.round((inclusiveAfterDiscount / (1 + gstRate / 100)) * 100) / 100;
    }
    const taxable = qty * Number(item.unitCost || 0);
    const gst = taxable * (gstRate / 100);
    item.stockQty = Math.round(qty * conversion * 100) / 100;
    item.taxableAmount = Math.round(taxable * 100) / 100;
    item.gstAmount = Math.round(gst * 100) / 100;
    item.lineTotal = Math.round((taxable + gst) * 100) / 100;
    if (!Number(item.igstAmount || 0)) {
      item.cgstAmount = Math.round((Number(item.gstAmount || 0) / 2) * 100) / 100;
      item.sgstAmount = Math.round((Number(item.gstAmount || 0) / 2) * 100) / 100;
    }
    const grossMrp = qty * Number(item.mrp || 0);
    item.discountAmount = Math.max(0, Math.round((grossMrp - Number(item.lineTotal || 0)) * 100) / 100);
  }

  numberValue(value: unknown): number {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  isPdfPreview(dataUrl: string): boolean {
    return dataUrl.startsWith('data:application/pdf');
  }

  previewUrl(dataUrl: string): SafeResourceUrl {
    return this.sanitizer.bypassSecurityTrustResourceUrl(dataUrl);
  }

  private async prepareUploadFile(file: File): Promise<UploadFile> {
    if (!file.type.startsWith('image/') || file.size < 1.2 * 1024 * 1024) {
      return { name: file.name, mimeType: file.type || 'application/octet-stream', dataUrl: await this.readFileDataUrl(file) };
    }
    const image = await this.loadImage(file);
    const maxEdge = 1800;
    const scale = Math.min(1, maxEdge / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext('2d');
    if (!context) {
      return { name: file.name, mimeType: file.type || 'image/jpeg', dataUrl: await this.readFileDataUrl(file) };
    }
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const compressed = canvas.toDataURL('image/jpeg', 0.82);
    const original = await this.readFileDataUrl(file);
    return compressed.length < original.length
      ? { name: file.name.replace(/\.[^.]+$/, '.jpg'), mimeType: 'image/jpeg', dataUrl: compressed }
      : { name: file.name, mimeType: file.type || 'image/jpeg', dataUrl: original };
  }

  private readFileDataUrl(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(reader.error || new Error('Unable to read file'));
      reader.readAsDataURL(file);
    });
  }

  private loadImage(file: File): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const image = new Image();
      image.onload = () => {
        URL.revokeObjectURL(url);
        resolve(image);
      };
      image.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error('Unable to load image for compression'));
      };
      image.src = url;
    });
  }

  private itemPayload(item: ApiRecord): ApiRecord {
    return {
      productId: item.productId || '',
      rawName: item.rawName || item.productName || '',
      productName: item.productName || item.rawName || '',
      hsnSac: item.hsnSac || '',
      categoryId: item.categoryId || '',
      categoryName: item.categoryName || '',
      usageType: item.usageType || 'retail',
      stockUnit: item.stockUnit || 'pcs',
      purchaseUnit: item.purchaseUnit || 'pcs',
      packSize: Number(item.packSize || item.conversionFactor || 1),
      conversionFactor: Number(item.conversionFactor || 1),
      qty: Number(item.qty || 0),
      stockQty: Number(item.stockQty || 0),
      unitCost: Number(item.unitCost || 0),
      mrp: Number(item.mrp || 0),
      discountPercent: Number(item.discountPercent || 0),
      discountAmount: Number(item.discountAmount || 0),
      gstPercent: Number(item.gstPercent || 0),
      taxableAmount: Number(item.taxableAmount || 0),
      gstAmount: Number(item.gstAmount || 0),
      cgstAmount: Number(item.cgstAmount || 0),
      sgstAmount: Number(item.sgstAmount || 0),
      igstAmount: Number(item.igstAmount || 0),
      lineTotal: Number(item.lineTotal || 0),
      batchNumber: item.batchNumber || '',
      expiryDate: item.expiryDate || '',
      supplierSku: item.supplierSku || ''
    };
  }
}
