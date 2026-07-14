import { CommonModule } from '@angular/common';
import { Component, OnInit, computed, signal } from '@angular/core';
import { FormsModule, ReactiveFormsModule, UntypedFormBuilder, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { AuthSessionService } from '../core/auth-session.service';
import { grantsAllow, staticGrantsForRole } from '../core/permission.guard';
import { routePermissionForPath } from '../core/access-rules';
import { AppStateService } from '../core/state/app-state.service';
import { ApiRecord, ApiService } from '../core/api.service';
import { InventoryZenotiChromeComponent } from '../shared/ui/inventory-zenoti-chrome/inventory-zenoti-chrome.component';
import { StateComponent } from '../shared/ui/state/state.component';
import { AuraMoneyPipe } from '../shared/pipes/aura-money.pipe';

type PurchaseBillLine = {
  sno: number;
  productId: string;
  productName: string;
  rate: number;
  qty: number;
  unit: string;
  discountPercent: number;
  discountAmount: number;
  incTax: boolean;
  gstPercent: number;
  remarks: string;
};

@Component({
  selector: 'app-purchase-bill-entry',
  standalone: true,
  imports: [AuraMoneyPipe, CommonModule, FormsModule, ReactiveFormsModule, RouterLink, InventoryZenotiChromeComponent, StateComponent],
  template: `
    <section class="purchase-entry-page inner-page-shell">
      <div class="top-command inner-page-header">
        <a class="command-button" routerLink="/inventory">Back</a>
        <span>Inventory</span>
        <button class="command-button dark" type="button" routerLink="/pos" *ngIf="canAccessPath('/pos')">Fast POS</button>
      </div>

      <app-inventory-zenoti-chrome
        title="Purchase Bill Entry"
        breadcrumb="Inventory > Purchases > Purchase Bill Entry"
        (refresh)="load()"
      >
        <div zenoti-actions class="entry-actions">
          <button type="button" (click)="printPage()">Print</button>
          <a routerLink="/inventory/purchase-bill-register">Find</a>
          <a routerLink="/inventory/purchase-orders">PO/GRN Match</a>
          <button type="button" (click)="clearForm()">Clear</button>
          <button type="button" class="danger" (click)="clearForm()">Reverse</button>
          <a class="soft" routerLink="/transactions/outgoing-funds" [queryParams]="paymentQuery()">Record Payment</a>
          <button type="button" class="save" (click)="saveBill()" [disabled]="saving() || headerForm.invalid">Save</button>
        </div>
      </app-inventory-zenoti-chrome>

      <app-state [loading]="loading()" [error]="error()"></app-state>
      <div class="state success" *ngIf="success()">{{ success() }}</div>

      <form [formGroup]="headerForm" class="entry-form inner-form-grid">
        <section class="bill-header">
          <label>
            <span>Bill Date</span>
            <input type="date" formControlName="billDate" />
          </label>
          <label>
            <span>Bill No</span>
            <input formControlName="billNo" placeholder="Supplier bill no" />
          </label>
          <label>
            <span>Branch</span>
            <select formControlName="branchId">
              <option value="">Select branch</option>
              <option *ngFor="let branch of branches()" [value]="branch.id">{{ branch.name }}</option>
            </select>
          </label>
          <label>
            <span>Vendor</span>
            <select formControlName="supplierId" (change)="syncSupplierName()">
              <option value="">Select vendor</option>
              <option *ngFor="let supplier of suppliers()" [value]="supplier.id">{{ supplier.name }}</option>
            </select>
          </label>
          <label>
            <span>Purchase A/C</span>
            <input formControlName="purchaseAccount" />
          </label>
          <label>
            <span>PO No</span>
            <input formControlName="poNo" placeholder="Optional" />
          </label>
          <label class="inline-check">
            <span>Paid?</span>
            <input type="checkbox" formControlName="paid" />
          </label>
          <label>
            <span>Paid Date</span>
            <input type="date" formControlName="paidDate" />
          </label>
          <label>
            <span>Payment Mode</span>
            <select formControlName="paymentMode">
              <option>Cash</option>
              <option>Bank Transfer</option>
              <option>UPI</option>
              <option>Card</option>
              <option>Cheque</option>
              <option>Other</option>
            </select>
          </label>
          <label>
            <span>Payment Ref</span>
            <input formControlName="paymentRef" placeholder="Txn / cheque / note" />
          </label>
        </section>

        <section class="bill-lines inner-page-card">
          <div class="line-toolbar">
            <strong>{{ lines().length }} line(s)</strong>
            <button type="button" (click)="addLine()">Add product line</button>
          </div>
          <div class="table-shell inner-table-wrap">
            <table>
              <thead>
                <tr>
                  <th>SNO</th>
                  <th>Product name</th>
                  <th>Rate</th>
                  <th>Qty</th>
                  <th>Unit</th>
                  <th>Disc %</th>
                  <th>Disc Amt</th>
                  <th>Inc Tax</th>
                  <th>Taxable Amt</th>
                  <th>GST</th>
                  <th>Tax Amt</th>
                  <th>Amount</th>
                  <th>Remarks</th>
                </tr>
              </thead>
              <tbody>
                <tr *ngFor="let line of lines(); let index = index; trackBy: trackLine">
                  <td>{{ line.sno | number:'3.0-0' }}</td>
                  <td>
                    <input
                      class="product-search"
                      list="purchase-product-options"
                      [ngModel]="line.productName"
                      (ngModelChange)="updateLine(index, { productName: $event })"
                      (change)="selectProductByName(index, line.productName)"
                      (keydown.enter)="selectProductByName(index, line.productName); $event.preventDefault()"
                      [ngModelOptions]="{ standalone: true }"
                      placeholder="Search product name, category, barcode"
                    />
                    <select [ngModel]="line.productId" (ngModelChange)="setProduct(index, $event)" [ngModelOptions]="{ standalone: true }">
                      <option value="">Click or select product</option>
                      <option *ngFor="let product of filteredProducts(line.productName)" [value]="product.id">{{ productOption(product) }}</option>
                    </select>
                  </td>
                  <td><input type="number" [ngModel]="line.rate" (ngModelChange)="updateLine(index, { rate: numberValue($event) })" [ngModelOptions]="{ standalone: true }" /></td>
                  <td><input type="number" [ngModel]="line.qty" (ngModelChange)="updateLine(index, { qty: numberValue($event) })" [ngModelOptions]="{ standalone: true }" /></td>
                  <td><input [ngModel]="line.unit" (ngModelChange)="updateLine(index, { unit: $event })" [ngModelOptions]="{ standalone: true }" /></td>
                  <td><input type="number" [ngModel]="line.discountPercent" (ngModelChange)="updateLine(index, { discountPercent: numberValue($event) })" [ngModelOptions]="{ standalone: true }" /></td>
                  <td><input type="number" [ngModel]="line.discountAmount" (ngModelChange)="updateLine(index, { discountAmount: numberValue($event) })" [ngModelOptions]="{ standalone: true }" /></td>
                  <td><input type="checkbox" [ngModel]="line.incTax" (ngModelChange)="updateLine(index, { incTax: $event })" [ngModelOptions]="{ standalone: true }" /></td>
                  <td>{{ taxableAmount(line) | auraMoney:'1.2-2' }}</td>
                  <td><input type="number" [ngModel]="line.gstPercent" (ngModelChange)="updateLine(index, { gstPercent: numberValue($event) })" [ngModelOptions]="{ standalone: true }" /></td>
                  <td>{{ taxAmount(line) | auraMoney:'1.2-2' }}</td>
                  <td>{{ lineAmount(line) | auraMoney:'1.2-2' }}</td>
                  <td><input [ngModel]="line.remarks" (ngModelChange)="updateLine(index, { remarks: $event })" [ngModelOptions]="{ standalone: true }" /></td>
                </tr>
              </tbody>
            </table>
            <datalist id="purchase-product-options">
              <option *ngFor="let product of products()" [value]="product.name">{{ productOption(product) }}</option>
            </datalist>
          </div>
        </section>

        <section class="totals-strip inner-stats-grid">
          <article><span>Taxable</span><strong>{{ taxableTotal() | auraMoney:'1.2-2' }}</strong></article>
          <article><span>GST</span><strong>{{ gstTotal() | auraMoney:'1.2-2' }}</strong></article>
          <article><span>Total</span><strong>{{ grandTotal() | auraMoney:'1.2-2' }}</strong></article>
          <article><span>Payment</span><strong>{{ headerForm.value.paid ? 'Paid' : 'Unpaid' }}</strong></article>
        </section>
      </form>
    </section>
  `,
  styles: [`
    .purchase-entry-page {
      background: #f6f8fb;
      color: #1d2733;
      display: grid;
      gap: 14px;
      padding: 14px;
    }

    .top-command,
    .entry-actions,
    .line-toolbar,
    .totals-strip {
      align-items: center;
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
    }

    .top-command {
      justify-content: flex-end;
    }

    .command-button,
    .entry-actions a,
    .entry-actions button,
    .line-toolbar button {
      background: #fff;
      border: 1px solid #c8d6e4;
      border-radius: 3px;
      color: #135f9d;
      cursor: pointer;
      font: inherit;
      font-weight: 900;
      padding: 9px 12px;
      text-decoration: none;
    }

    .command-button.dark {
      background: #0d2438;
      color: #fff;
    }

    .entry-actions .danger {
      color: #bd3d3d;
    }

    .entry-actions .soft {
      background: #eef6ff;
    }

    .entry-actions .save {
      background: #6fa59c;
      border-color: #6fa59c;
      color: #fff;
    }

    .state.success {
      background: #ecfdf3;
      border: 1px solid #badbcc;
      color: #17633b;
      font-weight: 800;
      padding: 12px;
    }

    .entry-form {
      display: grid;
      gap: 12px;
    }

    .bill-header {
      background: #d8f1ed;
      border: 1px solid #89bcb5;
      display: grid;
      gap: 10px;
      grid-template-columns: repeat(4, minmax(150px, 1fr));
      padding: 10px;
    }

    label {
      display: grid;
      gap: 5px;
      font-size: 12px;
      font-weight: 900;
      text-transform: none;
    }

    input,
    select {
      border: 1px solid #a9bacb;
      border-radius: 2px;
      color: #17202d;
      font: inherit;
      min-height: 34px;
      padding: 6px 8px;
      width: 100%;
    }

    .inline-check {
      align-items: end;
      grid-template-columns: 1fr auto;
    }

    .inline-check input {
      width: auto;
    }

    .bill-lines {
      background: #fff;
      border: 1px solid #cbd7e2;
      display: grid;
      gap: 0;
    }

    .line-toolbar {
      justify-content: space-between;
      padding: 10px;
    }

    .table-shell {
      overflow: auto;
    }

    table {
      border-collapse: collapse;
      min-width: 1180px;
      width: 100%;
    }

    th,
    td {
      border: 1px solid #d2d8de;
      font-size: 12px;
      padding: 6px;
      text-align: left;
      vertical-align: top;
    }

    th {
      background: #eef2f5;
      font-weight: 900;
      text-transform: uppercase;
      white-space: nowrap;
    }

    tbody tr:first-child td {
      background: #f4f4f2;
    }

    td:nth-child(2) {
      min-width: 260px;
    }

    td input,
    td select {
      min-height: 30px;
    }

    .product-search {
      margin-bottom: 4px;
    }

    .totals-strip {
      justify-content: flex-end;
    }

    .totals-strip article {
      background: #fff;
      border: 1px solid #d4dee8;
      min-width: 160px;
      padding: 10px 12px;
    }

    .totals-strip span {
      color: #63748a;
      display: block;
      font-size: 12px;
      font-weight: 800;
    }

    .totals-strip strong {
      display: block;
      font-size: 19px;
      margin-top: 4px;
    }

    @media (max-width: 900px) {
      .bill-header {
        grid-template-columns: 1fr;
      }
    }
  `]
})
export class PurchaseBillEntryComponent implements OnInit {
  readonly products = signal<ApiRecord[]>([]);
  readonly suppliers = signal<ApiRecord[]>([]);
  readonly branches = signal<ApiRecord[]>([]);
  readonly loading = signal(true);
  readonly saving = signal(false);
  readonly error = signal('');
  readonly success = signal('');
  readonly lines = signal<PurchaseBillLine[]>([blankLine(1)]);

  readonly taxableTotal = computed(() => this.lines().reduce((sum, line) => sum + this.taxableAmount(line), 0));
  readonly gstTotal = computed(() => this.lines().reduce((sum, line) => sum + this.taxAmount(line), 0));
  readonly grandTotal = computed(() => this.lines().reduce((sum, line) => sum + this.lineAmount(line), 0));

  readonly headerForm = this.fb.group({
    billDate: [new Date().toISOString().slice(0, 10), Validators.required],
    billNo: ['', Validators.required],
    branchId: ['', Validators.required],
    supplierId: [''],
    supplierName: ['', Validators.required],
    purchaseAccount: ['PRODUCT PURCHASE A/C'],
    poNo: [''],
    paid: [false],
    paidDate: [''],
    paymentMode: ['Cash'],
    paymentRef: ['']
  });

  constructor(
    private readonly api: ApiService,
    private readonly fb: UntypedFormBuilder,
    private readonly state: AppStateService,
    private readonly session: AuthSessionService
  ) {}

  canAccessPath(path: string): boolean {
    const permission = routePermissionForPath(path);
    if (!permission || (Array.isArray(permission) && !permission.length)) return true;
    const permissions = Array.isArray(permission) ? permission : [permission];
    const dynamicGrants = this.session.currentUser()?.permissions || [];
    const grants = Array.from(new Set([...staticGrantsForRole(this.state.userRole()), ...dynamicGrants]));
    return permissions.some((item) => grantsAllow(grants, item));
  }

  ngOnInit(): void {
    this.headerForm.patchValue({ branchId: this.api.selectedBranchId() });
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.error.set('');
    Promise.all([
      firstValueFrom(this.api.list<ApiRecord[]>('products', { branchId: this.api.selectedBranchId(), limit: 10000 })),
      firstValueFrom(this.api.list<ApiRecord[]>('suppliers', { limit: 10000 })),
      firstValueFrom(this.api.list<ApiRecord[]>('branches'))
    ]).then(([products, suppliers, branches]) => {
      this.products.set(products || []);
      this.suppliers.set(suppliers || []);
      this.branches.set(branches || []);
      if (!this.headerForm.value.branchId) this.headerForm.patchValue({ branchId: this.api.selectedBranchId() || branches?.[0]?.id || '' });
      this.loading.set(false);
    }).catch((error) => {
      this.error.set(this.api.errorText(error, 'Unable to load purchase bill entry'));
      this.loading.set(false);
    });
  }

  addLine(): void {
    this.lines.set([...this.lines(), blankLine(this.lines().length + 1)]);
  }

  trackLine(_index: number, line: PurchaseBillLine): number {
    return line.sno;
  }

  updateLine(index: number, patch: Partial<PurchaseBillLine>): void {
    const rows = [...this.lines()];
    rows[index] = { ...rows[index], ...patch };
    this.lines.set(rows.map((line, lineIndex) => ({ ...line, sno: lineIndex + 1 })));
  }

  filteredProducts(query: unknown): ApiRecord[] {
    const normalized = normalizeSearch(query);
    const products = this.products();
    if (!normalized) return products.slice(0, 250);
    return products
      .filter((product) => normalizeSearch(this.productOption(product)).includes(normalized))
      .slice(0, 250);
  }

  productOption(product: ApiRecord): string {
    return [
      product.name,
      product.category || product.categoryName,
      product.barcode,
      product.sku || product.code
    ].map((value) => String(value || '').trim()).filter(Boolean).join(' - ');
  }

  setProduct(index: number, productId: string): void {
    const product = this.products().find((row) => row.id === productId);
    this.updateLine(index, {
      productId,
      productName: product?.name || '',
      unit: product?.unit || product?.packUnit || 'pcs',
      rate: numberValue(product?.unitCost || product?.cost || 0),
      gstPercent: numberValue(product?.gstRate || product?.gstPercent || 18)
    });
  }

  selectProductByName(index: number, productName: unknown): void {
    const query = normalizeSearch(productName);
    if (!query) return;
    const product = this.products().find((row) => {
      const exactValues = [row.name, row.barcode, row.sku, row.code, row.id].map(normalizeSearch);
      return exactValues.includes(query);
    }) || this.filteredProducts(productName)[0];
    if (product?.id) this.setProduct(index, String(product.id));
  }

  syncSupplierName(): void {
    const supplier = this.suppliers().find((row) => row.id === this.headerForm.value.supplierId);
    if (supplier?.name) this.headerForm.patchValue({ supplierName: supplier.name });
  }

  taxableAmount(line: PurchaseBillLine): number {
    const gross = money(line.rate * line.qty);
    const discount = money(line.discountAmount || gross * (line.discountPercent / 100));
    const afterDiscount = Math.max(0, money(gross - discount));
    return line.incTax ? money(afterDiscount / (1 + numberValue(line.gstPercent) / 100)) : afterDiscount;
  }

  taxAmount(line: PurchaseBillLine): number {
    return money(this.taxableAmount(line) * (numberValue(line.gstPercent) / 100));
  }

  lineAmount(line: PurchaseBillLine): number {
    const taxable = this.taxableAmount(line);
    return line.incTax ? money(Math.max(0, line.rate * line.qty - line.discountAmount)) : money(taxable + this.taxAmount(line));
  }

  paymentQuery(): ApiRecord {
    return {
      source: 'purchaseBill',
      supplierId: this.headerForm.value.supplierId || '',
      supplierName: this.vendorName(),
      billNo: this.headerForm.value.billNo || '',
      amount: this.grandTotal(),
      gstAmount: this.gstTotal(),
      paymentDate: this.headerForm.value.paidDate || new Date().toISOString().slice(0, 10)
    };
  }

  saveBill(): void {
    if (this.headerForm.invalid) {
      this.headerForm.markAllAsTouched();
      return;
    }
    const itemRows = this.lines()
      .filter((line) => line.productName || line.productId || line.qty || line.rate)
      .map((line) => ({
        productId: line.productId,
        productName: line.productName,
        rawName: line.productName,
        qty: numberValue(line.qty),
        purchaseUnit: line.unit || 'pcs',
        stockUnit: line.unit || 'pcs',
        unitCost: this.taxableAmount(line) / Math.max(1, numberValue(line.qty)),
        gstPercent: numberValue(line.gstPercent),
        taxableAmount: this.taxableAmount(line),
        gstAmount: this.taxAmount(line),
        lineTotal: this.lineAmount(line),
        discountPercent: numberValue(line.discountPercent),
        discountAmount: numberValue(line.discountAmount),
        remarks: line.remarks
      }));
    if (!itemRows.length) {
      this.error.set('At least one product line required.');
      return;
    }
    this.saving.set(true);
    this.error.set('');
    this.success.set('');
    const payload = {
      branchId: this.headerForm.value.branchId,
      supplierId: this.headerForm.value.supplierId,
      supplierName: this.vendorName(),
      billNo: this.headerForm.value.billNo,
      billDate: this.headerForm.value.billDate,
      purchaseOrderId: this.headerForm.value.poNo,
      aiProvider: 'local',
      subtotal: this.taxableTotal(),
      gstAmount: this.gstTotal(),
      totalAmount: this.grandTotal(),
      items: itemRows,
      extractedText: this.manualBillText(itemRows)
    };
    this.api.post<ApiRecord>('inventory-intelligence/purchase-bills/manual', payload).subscribe({
      next: (bill) => {
        this.success.set(`Purchase bill ${bill?.billNo || this.headerForm.value.billNo} saved direct. Stock and vendor payable updated.`);
        this.saving.set(false);
      },
      error: (error) => {
        this.error.set(this.api.errorText(error, 'Unable to save purchase bill'));
        this.saving.set(false);
      }
    });
  }

  clearForm(): void {
    this.success.set('');
    this.error.set('');
    this.headerForm.reset({
      billDate: new Date().toISOString().slice(0, 10),
      billNo: '',
      branchId: this.api.selectedBranchId(),
      supplierId: '',
      supplierName: '',
      purchaseAccount: 'PRODUCT PURCHASE A/C',
      poNo: '',
      paid: false,
      paidDate: '',
      paymentMode: 'Cash',
      paymentRef: ''
    });
    this.lines.set([blankLine(1)]);
  }

  printPage(): void {
    globalThis.print();
  }

  numberValue(value: unknown): number {
    return numberValue(value);
  }

  private vendorName(): string {
    return String(this.headerForm.value.supplierName || this.suppliers().find((row) => row.id === this.headerForm.value.supplierId)?.name || '').trim();
  }

  private manualBillText(items: ApiRecord[]): string {
    const header = [
      `Bill No ${this.headerForm.value.billNo || ''}`,
      `Bill Date ${this.headerForm.value.billDate || ''}`,
      `Supplier ${this.vendorName()}`
    ];
    const rows = items.map((item) => `${item.productName} ${item.qty} ${item.purchaseUnit} ${item.unitCost} ${item.gstPercent}% ${item.lineTotal}`);
    return [...header, ...rows, `Total ${this.grandTotal()}`].join('\n');
  }
}

function blankLine(sno: number): PurchaseBillLine {
  return {
    sno,
    productId: '',
    productName: '',
    rate: 0,
    qty: 1,
    unit: 'pcs',
    discountPercent: 0,
    discountAmount: 0,
    incTax: false,
    gstPercent: 18,
    remarks: ''
  };
}

function numberValue(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeSearch(value: unknown): string {
  return String(value ?? '').trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ');
}

function money(value: unknown): number {
  return Math.round(numberValue(value) * 100) / 100;
}
