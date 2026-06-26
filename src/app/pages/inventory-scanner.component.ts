import { CommonModule, CurrencyPipe, DatePipe } from '@angular/common';
import { Component, OnInit, computed, signal } from '@angular/core';
import { FormsModule, ReactiveFormsModule, UntypedFormBuilder, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { ApiRecord, ApiService } from '../core/api.service';
import { StateComponent } from '../shared/ui/state/state.component';

type ScannerAction = 'lookup' | 'receive' | 'count' | 'waste' | 'transfer';

@Component({
  selector: 'app-inventory-scanner',
  standalone: true,
  imports: [CommonModule, CurrencyPipe, DatePipe, FormsModule, ReactiveFormsModule, RouterLink, StateComponent],
  template: `
    <section class="page-stack inventory-enterprise-page scanner-page">
      <div class="module-hero">
        <div>
          <span class="eyebrow">Inventory / Scanner</span>
          <h2>Barcode and QR stock workflow</h2>
          <p>Scan product once, then lookup, receive, count, waste, or raise transfer request without leaving inventory.</p>
        </div>
        <div class="hero-actions">
          <a class="ghost-button" routerLink="/inventory">Inventory</a>
          <a class="ghost-button" routerLink="/inventory/stock-audit">Stock audit</a>
        </div>
      </div>

      <app-state [loading]="loading()" [error]="error()"></app-state>
      <div class="state success" *ngIf="success()">{{ success() }}</div>

      <div class="scanner-layout">
        <section class="panel scanner-card">
          <div class="section-title">
            <div>
              <span class="eyebrow">Scan desk</span>
              <h2>Fast scan entry</h2>
            </div>
            <span class="scan-status" [class.matched]="matchedProduct()">ready</span>
          </div>

          <form [formGroup]="scannerForm" (ngSubmit)="scan()" class="scanner-form">
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
            <div class="form-actions full">
              <button class="primary-button" type="submit" [disabled]="scannerForm.invalid || saving()">Scan and match</button>
              <button class="ghost-button" type="button" (click)="applyWorkflow()" [disabled]="!matchedProduct() || saving()">Apply workflow</button>
            </div>
          </form>
        </section>

        <section class="panel product-card" *ngIf="matchedProduct(); else noMatch">
          <div class="product-head">
            <div>
              <span class="eyebrow">Matched product</span>
              <h2>{{ matchedProduct()?.name }}</h2>
              <p>{{ matchedProduct()?.sku || 'No SKU' }} · {{ matchedProduct()?.category || 'uncategorized' }}</p>
            </div>
            <strong>{{ matchedProduct()?.stock || 0 }} left</strong>
          </div>
          <div class="product-metrics">
            <article><span>Price</span><strong>{{ (matchedProduct()?.price || 0) | currency:'INR':'symbol':'1.0-0' }}</strong></article>
            <article><span>Unit cost</span><strong>{{ (matchedProduct()?.unitCost || 0) | currency:'INR':'symbol':'1.0-0' }}</strong></article>
            <article><span>Reorder</span><strong>{{ matchedProduct()?.lowStockThreshold || 0 }}</strong></article>
            <article><span>Branch</span><strong>{{ branchName(matchedProduct()?.branchId) }}</strong></article>
          </div>
          <div class="workflow-grid">
            <button type="button" (click)="setWorkflow('lookup')">Lookup</button>
            <button type="button" (click)="setWorkflow('receive')">Receive</button>
            <button type="button" (click)="setWorkflow('count')">Count</button>
            <button type="button" (click)="setWorkflow('waste')">Waste</button>
            <button type="button" (click)="setWorkflow('transfer')">Transfer</button>
          </div>
        </section>
        <ng-template #noMatch>
          <section class="panel product-card empty-match">
            <span class="eyebrow">No product selected</span>
            <h2>Scan a product to start</h2>
            <p>Matched stock, price, cost, reorder level and branch will appear here from live inventory data.</p>
          </section>
        </ng-template>
      </div>

      <section class="panel">
        <div class="section-title">
          <div>
            <span class="eyebrow">Recent scans</span>
            <h2>Session scan history</h2>
          </div>
          <small>{{ scans().length }} scans</small>
        </div>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Time</th><th>Code</th><th>Workflow</th><th>Product</th><th>Status</th><th>Result</th></tr></thead>
            <tbody>
              <tr *ngFor="let row of scans()">
                <td>{{ row.createdAt | date:'shortTime' }}</td>
                <td><strong>{{ row.code }}</strong></td>
                <td>{{ row.scanType }}</td>
                <td>{{ row.productName || row.matchedProductId || '-' }}</td>
                <td><span class="badge" [class.warn]="row.status === 'unmatched'">{{ row.status }}</span></td>
                <td>{{ row.message || row.workflowStatus || '-' }}</td>
              </tr>
              <tr *ngIf="!scans().length"><td colspan="6">No scans in this session.</td></tr>
            </tbody>
          </table>
        </div>
      </section>
    </section>
  `,
  styles: [`
    .hero-actions,
    .section-title,
    .product-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
    .scanner-layout { display: grid; grid-template-columns: minmax(0, 1.1fr) minmax(340px, .9fr); gap: 14px; }
    .scanner-form { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
    .scanner-form .full, .scanner-form .code-field { grid-column: 1 / -1; }
    .scanner-form .code-field input { min-height: 54px; font-size: 22px; font-weight: 800; letter-spacing: .02em; }
    .scan-status { padding: 5px 10px; border-radius: 999px; background: #f1f5f9; color: #475569; font-weight: 800; font-size: 12px; text-transform: uppercase; }
    .scan-status.matched { background: #dcfce7; color: #166534; }
    .product-head h2 { margin-bottom: 2px; }
    .product-head p { margin: 0; color: var(--muted); }
    .product-head > strong { font-size: 32px; color: #0f766e; }
    .product-metrics { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; margin: 16px 0; }
    .product-metrics article { border: 1px solid rgba(79, 70, 229, 0.1); border-radius: 18px; padding: 12px; background: rgba(255, 255, 255, 0.92); }
    .product-metrics span { color: var(--muted); display: block; font-size: 12px; font-weight: 800; text-transform: uppercase; }
    .product-metrics strong { display: block; margin-top: 4px; font-size: 18px; }
    .workflow-grid { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 8px; }
    .workflow-grid button { border: 1px solid rgba(79, 70, 229, 0.12); background: rgba(255, 255, 255, 0.92); border-radius: 14px; padding: 12px 8px; font-weight: 800; cursor: pointer; }
    .workflow-grid button:hover { border-color: rgba(79, 70, 229, 0.32); color: #4f46e5; }
    .empty-match { display: grid; align-content: center; justify-items: center; text-align: center; min-height: 300px; border: 2px dashed rgba(79, 70, 229, 0.18); border-radius: 24px; padding: 32px 24px; background: rgba(255, 255, 255, 0.92); gap: 8px; }
    .empty-match::before { content: '📷'; font-size: 32px; opacity: 0.35; }
    .empty-match h2 { margin: 0; font-size: 20px; font-weight: 700; color: #4f46e5; }
    .empty-match p { color: var(--muted); max-width: 420px; margin: 0; line-height: 1.6; font-size: 14px; }
    @media (max-width: 980px) {
      .scanner-layout, .scanner-form, .product-metrics { grid-template-columns: 1fr; }
      .workflow-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
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
