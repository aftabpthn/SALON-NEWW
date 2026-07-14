import { CommonModule } from '@angular/common';
import { Component, OnInit, computed, signal } from '@angular/core';
import { FormsModule, ReactiveFormsModule, UntypedFormBuilder, Validators } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { ApiRecord, ApiService } from '../core/api.service';
import { InventoryZenotiChromeComponent } from '../shared/ui/inventory-zenoti-chrome/inventory-zenoti-chrome.component';
import { StateComponent } from '../shared/ui/state/state.component';
import { AuraMoneyPipe } from '../shared/pipes/aura-money.pipe';
import { AuraDatePipe } from '../shared/pipes/aura-date.pipe';

type ScannerAction = 'lookup' | 'receive' | 'count' | 'waste' | 'transfer';

@Component({
  selector: 'app-inventory-scanner',
  standalone: true,
  imports: [AuraDatePipe, AuraMoneyPipe, CommonModule, FormsModule, ReactiveFormsModule, InventoryZenotiChromeComponent, StateComponent],
  template: `
    <section class="page-stack inventory-enterprise-page scanner-page inner-page-shell">
      <app-inventory-zenoti-chrome
        title="Barcode and QR stock workflow"
        breadcrumb="Inventory > Scanner"
        (refresh)="load()"
      ></app-inventory-zenoti-chrome>

      <app-state [loading]="loading()" [error]="error()"></app-state>
      <div class="state success" *ngIf="success()">{{ success() }}</div>

      <section class="zenoti-scanner-workspace">
        <div class="zenoti-result-bar inner-stats-grid">
          <div>
            <strong>{{ activeScannerCount() }}</strong><span>Results</span>
            <small class="status-chip">Status: scanner active in this center</small>
          </div>
          <div class="zenoti-totals">
            <span>Products <strong>{{ products().length }}</strong></span>
            <span>Session scans <strong>{{ scans().length }}</strong></span>
            <span>Matched stock <strong>{{ matchedProduct()?.stock || 0 }}</strong></span>
            <span>Workflow <strong>{{ currentWorkflowLabel() }}</strong></span>
          </div>
        </div>

        <form [formGroup]="scannerForm" (ngSubmit)="scan()" class="zenoti-scan-form inner-form-grid">
            <label class="field">
              <span>Branch</span>
              <select formControlName="branchId">
                <option value="">Select branch</option>
                <option *ngFor="let branch of branches()" [value]="branch.id">{{ branch.name }}</option>
              </select>
            </label>
            <label class="field code-field">
              <span>Barcode / QR / SKU</span>
              <input formControlName="code" autofocus placeholder="Scan barcode or type SKU" />
            </label>
            <label class="field">
              <span>Workflow</span>
              <select formControlName="scanType">
                <option value="lookup">Lookup only</option>
                <option value="receive">Receive stock</option>
                <option value="count">Stock count</option>
                <option value="waste">Waste / expiry</option>
                <option value="transfer">Branch transfer</option>
              </select>
            </label>
            <label class="field">
              <span>Quantity</span>
              <input type="number" formControlName="quantity" />
            </label>
            <label class="field" *ngIf="scannerForm.value.scanType === 'transfer'">
              <span>Target branch</span>
              <select formControlName="targetBranchId">
                <option value="">Select target branch</option>
                <option *ngFor="let branch of branches()" [value]="branch.id">{{ branch.name }}</option>
              </select>
            </label>
            <label class="field full">
              <span>Note</span>
              <input formControlName="notes" placeholder="Shelf count, barcode receive, transfer reason" />
            </label>
            <div class="form-actions">
              <button class="primary-button" type="submit" [disabled]="scannerForm.invalid || saving()">Scan and match</button>
              <button class="ghost-button" type="button" (click)="applyWorkflow()" [disabled]="!matchedProduct() || saving()">Apply workflow</button>
            </div>
        </form>

        <div class="zenoti-filter-row inner-action-bar">
          <div class="tab-strip">
            <button type="button" [class.active]="activeView() === 'matched'" (click)="activeView.set('matched')">Matched product</button>
            <button type="button" [class.active]="activeView() === 'history'" (click)="activeView.set('history')">Scan history</button>
          </div>
          <div class="workflow-strip">
            <button type="button" (click)="setWorkflow('lookup')">Lookup</button>
            <button type="button" (click)="setWorkflow('receive')">Receive</button>
            <button type="button" (click)="setWorkflow('count')">Count</button>
            <button type="button" (click)="setWorkflow('waste')">Waste</button>
            <button type="button" (click)="setWorkflow('transfer')">Transfer</button>
          </div>
        </div>

        <div class="zenoti-table-wrap inner-table-wrap" *ngIf="activeView() === 'matched'">
          <table>
            <thead><tr><th>Product</th><th>SKU</th><th>Category</th><th>Branch</th><th>Stock</th><th>Reorder</th><th>Price</th><th>Unit cost</th><th>Workflow</th></tr></thead>
            <tbody>
              <tr *ngIf="matchedProduct() as product">
                <td><strong>{{ product.name }}</strong><small>{{ product.id }}</small></td>
                <td>{{ product.sku || 'No SKU' }}</td>
                <td>{{ product.category || 'Uncategorized' }}</td>
                <td>{{ branchName(product.branchId) }}</td>
                <td>{{ product.stock || 0 }}</td>
                <td>{{ product.lowStockThreshold || 0 }}</td>
                <td>{{ (product.price || 0) | auraMoney:'1.0-0' }}</td>
                <td>{{ (product.unitCost || 0) | auraMoney:'1.0-0' }}</td>
                <td><span class="scanner-chip">{{ currentWorkflowLabel() }}</span></td>
              </tr>
              <tr *ngIf="!matchedProduct()"><td colspan="9" class="empty-cell">Scan a product to start. Matched stock, price, cost, reorder level and branch will appear here.</td></tr>
            </tbody>
          </table>
        </div>

        <div class="zenoti-table-wrap inner-table-wrap" *ngIf="activeView() === 'history'">
          <table>
            <thead><tr><th>Time</th><th>Code</th><th>Workflow</th><th>Product</th><th>Status</th><th>Result</th></tr></thead>
            <tbody>
              <tr *ngFor="let row of scans()">
                <td>{{ row.createdAt | auraDate:'time' }}</td>
                <td><strong>{{ row.code }}</strong></td>
                <td>{{ row.scanType }}</td>
                <td>{{ row.productName || row.matchedProductId || '-' }}</td>
                <td><span class="badge" [class.warn]="row.status === 'unmatched'">{{ row.status }}</span></td>
                <td>{{ row.message || row.workflowStatus || '-' }}</td>
              </tr>
              <tr *ngIf="!scans().length"><td colspan="6" class="empty-cell">No scans in this session.</td></tr>
            </tbody>
          </table>
        </div>

        <div class="zenoti-footer">
          <span>1 to {{ activeScannerCount() }} of {{ activeScannerCount() }}</span>
        </div>
      </section>
    </section>
  `,
  styles: [`
    .scanner-page { gap: 0; }
    .zenoti-scanner-workspace {
      background: #f0f2f5;
      border: 1px solid #d8e1ea;
      display: grid;
      gap: 8px;
      overflow: hidden;
      padding: 8px;
    }
    .zenoti-result-bar,
    .zenoti-filter-row,
    .zenoti-footer {
      align-items: center;
      display: flex;
      gap: 12px;
      justify-content: space-between;
      padding: 10px 16px;
    }
    .zenoti-result-bar { border: 1px solid #d8e1ea; }
    .zenoti-filter-row { border: 1px solid #d8e1ea; }
    .zenoti-scan-form { border: 1px solid #d8e1ea; }
    .zenoti-result-bar > div,
    .zenoti-totals,
    .tab-strip,
    .workflow-strip {
      align-items: center;
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }
    .zenoti-result-bar strong {
      color: #152033;
      font-size: 14px;
      font-weight: 900;
    }
    .zenoti-result-bar span,
    .zenoti-footer {
      color: #50637d;
      font-size: 12px;
      font-weight: 800;
    }
    .zenoti-scan-form {
      display: grid;
      grid-template-columns: 180px minmax(280px, 1.4fr) 170px 120px 180px minmax(220px, 1fr) auto;
      gap: 10px;
      align-items: end;
      padding: 12px 16px;
    }
    .zenoti-scan-form .field {
      min-width: 0;
    }
    .zenoti-scan-form input,
    .zenoti-scan-form select {
      min-height: 34px;
    }
    .zenoti-scan-form .code-field input {
      font-size: 16px;
      font-weight: 900;
      letter-spacing: .02em;
    }
    .status-chip,
    .scanner-chip {
      background: #eaf6ff;
      border: 1px solid #b9d0e7;
      border-radius: 999px;
      color: #173f62;
      display: inline-flex;
      font-size: 12px;
      font-weight: 900;
      line-height: 1;
      padding: 6px 10px;
      white-space: nowrap;
    }
    .tab-strip button,
    .workflow-strip button {
      background: #fff;
      border: 1px solid #b9d0e7;
      border-radius: 3px;
      color: #075f9e;
      cursor: pointer;
      font: inherit;
      font-size: 12px;
      font-weight: 900;
      padding: 8px 12px;
    }
    .tab-strip button.active { box-shadow: inset 0 -3px 0 #f25a1d; }
    .zenoti-table-wrap { overflow: auto; }
    table {
      border-collapse: collapse;
      min-width: 1040px;
      width: 100%;
    }
    th,
    td {
      border-bottom: 1px solid #dfe6ee;
      color: #243142;
      font-size: 13px;
      padding: 11px 14px;
      text-align: left;
      vertical-align: middle;
      white-space: nowrap;
    }
    th {
      background: #f5f8fb;
      color: #5d6e84;
      font-size: 12px;
      font-weight: 900;
    }
    td strong {
      color: #075f9e;
      display: block;
      font-size: 14px;
      font-weight: 900;
    }
    td small {
      color: #61738d;
      display: block;
      font-size: 11px;
      font-weight: 800;
      margin-top: 3px;
    }
    .empty-cell {
      color: #61738d;
      font-weight: 800;
      padding: 28px 14px;
      text-align: center;
    }
    .zenoti-footer {
      border-top: 1px solid #d8e1ea;
      justify-content: flex-end;
    }
    @media (max-width: 980px) {
      .zenoti-result-bar,
      .zenoti-filter-row,
      .zenoti-footer,
      .zenoti-scan-form {
        align-items: flex-start;
        display: grid;
        grid-template-columns: 1fr;
      }
    }
  `]
})
export class InventoryScannerComponent implements OnInit {
  readonly branches = signal<ApiRecord[]>([]);
  readonly products = signal<ApiRecord[]>([]);
  readonly scans = signal<ApiRecord[]>([]);
  readonly matchedProduct = signal<ApiRecord | null>(null);
  readonly loading = signal(true);
  readonly saving = signal(false);
  readonly error = signal('');
  readonly success = signal('');
  readonly activeView = signal<'matched' | 'history'>('matched');
  readonly selectedBranchProducts = computed(() => this.products().filter((item) => item.branchId === this.scannerForm.value.branchId));

  readonly scannerForm = this.fb.group({
    branchId: ['', Validators.required],
    code: ['', Validators.required],
    scanType: ['lookup' as ScannerAction, Validators.required],
    quantity: [1, Validators.required],
    targetBranchId: [''],
    notes: ['']
  });

  constructor(private readonly api: ApiService, private readonly fb: UntypedFormBuilder) {}

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.loading.set(true);
    Promise.all([
      firstValueFrom(this.api.list<ApiRecord[]>('branches', { limit: 1000 })),
      firstValueFrom(this.api.list<ApiRecord[]>('products', { limit: 10000 }))
    ]).then(([branches, products]) => {
      this.branches.set(branches || []);
      this.products.set(products || []);
      this.scannerForm.patchValue({ branchId: this.api.selectedBranchId() || branches?.[0]?.id || '' });
      this.loading.set(false);
    }).catch((error) => {
      this.error.set(error?.error?.error || error?.message || 'Unable to load scanner context');
      this.loading.set(false);
    });
  }

  scan(): void {
    if (this.scannerForm.invalid) {
      this.scannerForm.markAllAsTouched();
      return;
    }
    const raw = this.scannerForm.getRawValue();
    this.saving.set(true);
    this.api.post<ApiRecord>('inventory-intelligence/barcode-scan', {
      branchId: raw.branchId,
      code: raw.code,
      scanType: raw.scanType
    }).subscribe({
      next: (result) => {
        const product = result['product'] || null;
        const event = result['event'] || {};
        this.matchedProduct.set(product);
        this.scans.update((rows) => [{
          ...event,
          productName: product?.name || '',
          message: product ? `${product.name} matched` : 'No product matched'
        }, ...rows].slice(0, 20));
        this.success.set(product ? `Matched ${product.name}. Choose workflow and apply.` : 'Scan saved as unmatched. Add product or rescan.');
        this.saving.set(false);
      },
      error: (error) => {
        this.error.set(error?.error?.error || error?.message || 'Unable to scan barcode');
        this.saving.set(false);
      }
    });
  }

  setWorkflow(action: ScannerAction): void {
    this.scannerForm.patchValue({ scanType: action });
  }

  activeScannerCount(): number {
    return this.activeView() === 'history' ? this.scans().length : (this.matchedProduct() ? 1 : 0);
  }

  currentWorkflowLabel(): string {
    return String(this.scannerForm.value.scanType || 'lookup');
  }

  selectedBranchName(): string {
    return this.branchName(String(this.scannerForm.value.branchId || ''));
  }

  applyWorkflow(): void {
    const product = this.matchedProduct();
    const raw = this.scannerForm.getRawValue();
    if (!product) return;
    const quantity = Number(raw.quantity || 1);
    const branchId = raw.branchId || product.branchId;
    this.saving.set(true);
    const action = raw.scanType as ScannerAction;
    const note = raw.notes || `Scanner ${action}`;
    let request;
    if (action === 'receive') {
      request = this.api.post<ApiRecord>('inventory/adjust', { productId: product.id, branchId, type: 'purchase-entry', quantity, reason: note });
    } else if (action === 'count') {
      request = this.api.post<ApiRecord>('inventory-intelligence/stock-counts', { branchId, notes: note, items: [{ productId: product.id, countedQty: quantity, reason: note }] });
    } else if (action === 'waste') {
      request = this.api.post<ApiRecord>('inventory-intelligence/waste', { productId: product.id, branchId, quantity, reason: note });
    } else if (action === 'transfer') {
      if (!raw.targetBranchId) {
        this.error.set('Target branch is required for transfer.');
        this.saving.set(false);
        return;
      }
      request = this.api.post<ApiRecord>('inventory-intelligence/transfer-requests', {
        sourceBranchId: branchId,
        targetBranchId: raw.targetBranchId,
        sourceProductId: product.id,
        quantity,
        reason: note
      });
    } else {
      this.success.set('Lookup complete. No stock mutation applied.');
      this.saving.set(false);
      return;
    }
    request.subscribe({
      next: () => {
        this.success.set(`Scanner ${action} workflow saved for ${product.name}.`);
        this.scans.update((rows) => rows.map((row, index) => index === 0 ? { ...row, workflowStatus: `${action} saved` } : row));
        this.saving.set(false);
        this.load();
      },
      error: (error) => {
        this.error.set(error?.error?.error || error?.message || `Unable to apply ${action}`);
        this.saving.set(false);
      }
    });
  }

  branchName(id: string): string {
    return this.branches().find((branch) => branch.id === id)?.name || id || 'Branch';
  }
}
