import { CommonModule } from '@angular/common';
import { Component, OnInit, computed, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { forkJoin } from 'rxjs';
import { ApiRecord, ApiService } from '../core/api.service';
import { StateComponent } from '../shared/ui/state/state.component';

type LaundryLine = {
  productId: string;
  productName: string;
  regularOpening: number;
  regularInQty: number;
  regularOutQty: number;
  rate: number;
  amount: number;
  rewashOpening: number;
  rewashInQty: number;
  rewashOutQty: number;
};

@Component({
  selector: 'app-laundry-entry',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, StateComponent],
  template: `
    <section class="laundry-page inner-page-shell">
      <header class="titlebar inner-page-header">
        <div>
          <span class="eyebrow">Inventory</span>
          <h2>Laundry (Inward / Outward)</h2>
        </div>
        <div class="title-actions inner-action-bar">
          <button class="ghost-button" type="button" routerLink="/inventory/laundry-report">Report</button>
          <button class="ghost-button" type="button" routerLink="/inventory">Exit</button>
        </div>
      </header>

      <app-state [loading]="loading()" [error]="error()"></app-state>
      <p class="state success" *ngIf="success()">{{ success() }}</p>

      <section class="entry-panel inner-page-card" *ngIf="!loading()">
        <div class="top-form inner-form-grid">
          <label><span>Doc. No.</span><input [ngModel]="docNo()" readonly /></label>
          <label><span>Doc. Date</span><input type="date" [ngModel]="docDate()" (ngModelChange)="docDate.set($event)" /></label>
          <label class="wide"><span>Laundry A/c</span>
            <select [ngModel]="laundryAccountId()" (ngModelChange)="laundryAccountId.set($event)">
              <option value="">Select laundry account</option>
              <option *ngFor="let account of laundryAccounts()" [value]="account.id">{{ account.accountName }}</option>
            </select>
          </label>
          <label class="wide"><span>Product</span>
            <select [ngModel]="selectedProductId()" (ngModelChange)="selectedProductId.set($event)">
              <option value="">Select product</option>
              <option *ngFor="let product of productOptions()" [value]="product.id">{{ product.name }}</option>
            </select>
          </label>
          <button class="ghost-button add-line" type="button" (click)="addSelectedProduct()">Add product</button>
        </div>

        <div class="table-shell inner-table-wrap">
          <table>
            <thead>
              <tr>
                <th rowspan="2">Sr.No.</th>
                <th rowspan="2">Product</th>
                <th colspan="5">Regular</th>
                <th colspan="3">Rewash</th>
              </tr>
              <tr>
                <th>Op.</th>
                <th>IN</th>
                <th>OUT</th>
                <th>Rate</th>
                <th>Amount</th>
                <th>Op.</th>
                <th>IN</th>
                <th>OUT</th>
              </tr>
            </thead>
            <tbody>
              <tr *ngFor="let line of lines(); let index = index; trackBy: trackLine">
                <td>{{ index + 1 | number: '3.0-0' }}</td>
                <td class="product-cell">
                  <strong>{{ line.productName }}</strong>
                  <button type="button" (click)="removeLine(index)" aria-label="Remove product">x</button>
                </td>
                <td><input type="number" [ngModel]="line.regularOpening" (ngModelChange)="updateLine(index, 'regularOpening', $event)" /></td>
                <td><input type="number" [ngModel]="line.regularInQty" (ngModelChange)="updateLine(index, 'regularInQty', $event)" /></td>
                <td><input type="number" [ngModel]="line.regularOutQty" (ngModelChange)="updateLine(index, 'regularOutQty', $event)" /></td>
                <td><input type="number" [ngModel]="line.rate" (ngModelChange)="updateLine(index, 'rate', $event)" /></td>
                <td><input type="number" [ngModel]="line.amount" (ngModelChange)="updateLine(index, 'amount', $event)" /></td>
                <td><input type="number" [ngModel]="line.rewashOpening" (ngModelChange)="updateLine(index, 'rewashOpening', $event)" /></td>
                <td><input type="number" [ngModel]="line.rewashInQty" (ngModelChange)="updateLine(index, 'rewashInQty', $event)" /></td>
                <td><input type="number" [ngModel]="line.rewashOutQty" (ngModelChange)="updateLine(index, 'rewashOutQty', $event)" /></td>
              </tr>
              <tr *ngIf="!lines().length">
                <td colspan="10" class="empty">Inventory products nahi mile.</td>
              </tr>
            </tbody>
          </table>
        </div>

        <footer class="entry-footer">
          <label class="remarks"><span>Remarks</span><textarea [ngModel]="remarks()" (ngModelChange)="remarks.set($event)"></textarea></label>
          <div class="totals">
            <strong></strong>
            <strong>Regular</strong>
            <strong>Rewash</strong>
            <span>Total In :</span>
            <input [ngModel]="regularTotalIn()" readonly />
            <input [ngModel]="rewashTotalIn()" readonly />
            <span>Total Out :</span>
            <input [ngModel]="regularTotalOut()" readonly />
            <input [ngModel]="rewashTotalOut()" readonly />
            <span>Total Amt. :</span>
            <input [ngModel]="totalAmount()" readonly />
          </div>
        </footer>

        <div class="bottom-toolbar">
          <button class="tool-button" type="button" (click)="save(true)" [disabled]="saving()">Save Print</button>
          <button class="tool-button primary" type="button" (click)="save(false)" [disabled]="saving()">Save</button>
          <button class="tool-button" type="button" routerLink="/inventory/laundry-report">Find</button>
          <button class="tool-button" type="button" (click)="resetForm()">Cancel</button>
        </div>
      </section>
    </section>
  `,
  styles: [`
    :host { display: block; }
    .laundry-page { display: grid; gap: 14px; padding: 18px; background: #eef8f5; color: #0f172a; }
    .titlebar, .entry-panel, .recent-panel { border: 1px solid #9eb2b7; background: #d8ebe7; box-shadow: inset 0 0 0 1px rgba(255,255,255,.6); }
    .titlebar { display: flex; justify-content: space-between; align-items: center; padding: 10px 12px; background: #5b9998; color: #fff; }
    .title-actions { display: flex; gap: 8px; }
    .titlebar h2 { margin: 0; letter-spacing: 0; }
    .eyebrow { display: block; color: inherit; opacity: .78; font-size: 11px; font-weight: 900; text-transform: uppercase; }
    .ghost-button, .tool-button { border: 1px solid #8da1a7; background: #fff; color: #0f172a; border-radius: 2px; padding: 8px 13px; font-weight: 900; cursor: pointer; }
    .entry-panel { display: grid; gap: 10px; padding: 10px; }
    .top-form { display: grid; grid-template-columns: 250px 250px minmax(280px, 1fr); gap: 10px; align-items: end; }
    label { display: grid; grid-template-columns: 88px minmax(0, 1fr); align-items: center; gap: 8px; font-weight: 900; }
    label span { text-align: right; }
    input, select, textarea { min-height: 30px; border: 1px solid #8da1a7; background: #fff; padding: 5px 7px; font: inherit; }
    textarea { min-height: 64px; resize: vertical; }
    .wide { grid-column: span 2; }
    .add-line { align-self: center; min-height: 32px; }
    .table-shell { min-height: 330px; overflow: auto; background: #fff; border: 1px solid #9eb2b7; }
    table { width: 100%; min-width: 980px; border-collapse: collapse; font-size: 13px; }
    th, td { border: 1px solid #c7d6d8; padding: 5px; text-align: center; }
    th { background: #edf3f2; font-weight: 950; }
    .product-cell { min-width: 260px; text-align: left; font-weight: 800; display: flex; align-items: center; justify-content: space-between; gap: 8px; }
    .product-cell button { border: 1px solid #fecaca; background: #fff; color: #dc2626; border-radius: 4px; font-weight: 900; cursor: pointer; }
    td input { width: 78px; min-height: 26px; text-align: right; border: 0; background: transparent; }
    .empty { padding: 24px; color: #64748b; }
    .entry-footer { display: grid; grid-template-columns: minmax(320px, 1fr) 420px; gap: 18px; align-items: end; }
    .remarks { align-items: start; }
    .totals { display: grid; grid-template-columns: 100px 1fr 1fr; gap: 5px 10px; align-items: center; }
    .totals span { text-align: right; font-weight: 900; }
    .totals input { text-align: right; }
    .bottom-toolbar { display: flex; justify-content: flex-end; gap: 8px; padding-top: 8px; border-top: 1px solid #9eb2b7; }
    .tool-button.primary { background: #0f8f79; color: #fff; border-color: #0f8f79; }
    .recent-panel { display: grid; gap: 8px; padding: 12px; }
    .recent-panel h3 { margin: 0; }
    .recent-row { display: grid; grid-template-columns: 100px 140px minmax(0, 1fr) 120px; gap: 10px; border: 1px solid #c7d6d8; background: #fff; padding: 9px 12px; text-align: left; }
    .state.success { border: 1px solid #86efac; background: #f0fdf4; color: #166534; padding: 10px 12px; font-weight: 900; }
    @media (max-width: 900px) {
      .top-form, .entry-footer { grid-template-columns: 1fr; }
      .wide { grid-column: auto; }
      label { grid-template-columns: 1fr; }
      label span { text-align: left; }
      .bottom-toolbar { justify-content: stretch; flex-wrap: wrap; }
      .tool-button { flex: 1 1 120px; }
    }
    @media print {
      .titlebar button, .bottom-toolbar, .recent-panel, .add-line, .product-cell button { display: none !important; }
      .laundry-page { padding: 0; background: #fff; }
      .entry-panel { border: 0; }
    }
  `]
})
export class LaundryEntryComponent implements OnInit {
  readonly loading = signal(false);
  readonly saving = signal(false);
  readonly error = signal('');
  readonly success = signal('');
  readonly docNo = signal('');
  readonly docDate = signal(new Date().toISOString().slice(0, 10));
  readonly laundryAccountId = signal('');
  readonly laundryAccounts = signal<ApiRecord[]>([]);
  readonly productOptions = signal<ApiRecord[]>([]);
  readonly selectedProductId = signal('');
  readonly editingEntryId = signal('');
  readonly recentEntries = signal<ApiRecord[]>([]);
  readonly lines = signal<LaundryLine[]>([]);
  readonly remarks = signal('');

  readonly regularTotalIn = computed(() => this.sum('regularInQty'));
  readonly regularTotalOut = computed(() => this.sum('regularOutQty'));
  readonly rewashTotalIn = computed(() => this.sum('rewashInQty'));
  readonly rewashTotalOut = computed(() => this.sum('rewashOutQty'));
  readonly totalAmount = computed(() => this.sum('amount'));

  constructor(private readonly api: ApiService) {}

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.error.set('');
    forkJoin({
      accounts: this.api.list<ApiRecord[]>('account-master/accounts', { branchId: this.api.selectedBranchId(), includeHidden: true, limit: 1000 }),
      products: this.api.list<ApiRecord[]>('products', { branchId: this.api.selectedBranchId(), limit: 1000 })
    }).subscribe({
      next: ({ accounts, products }) => {
        const laundryAccounts = this.laundryAccountOptions(accounts || []);
        const productRows = this.productRows(products || []);
        this.docNo.set(this.nextLocalDocNo());
        this.laundryAccounts.set(laundryAccounts);
        this.productOptions.set(productRows);
        this.recentEntries.set(this.localEntries());
        this.lines.set(productRows.map((product: ApiRecord) => this.lineFromProduct(product)));
        if (!this.laundryAccountId() && laundryAccounts[0]?.id) this.laundryAccountId.set(laundryAccounts[0].id);
        if (!laundryAccounts.length) this.error.set('Account Master me Laundry checkbox ON karo ya account name me Laundry rakho.');
        this.openQueuedEdit();
        this.loading.set(false);
      },
      error: (error) => {
        this.error.set(this.api.errorText(error, 'Unable to load laundry entry'));
        this.loading.set(false);
      }
    });
  }

  loadRecent(): void {
    this.recentEntries.set(this.localEntries());
    this.docNo.set(this.nextLocalDocNo());
  }

  openEntry(entryId: unknown): void {
    const id = String(entryId || '');
    if (!id) return;
    const result = this.localEntries().find((entry) => String(entry.id || '') === id);
    if (!result) return;
    this.docNo.set(String(result.docNo || this.docNo()));
    this.docDate.set(String(result.docDate || this.docDate()));
    this.laundryAccountId.set(String(result.laundryAccountId || ''));
    this.remarks.set(String(result.remarks || ''));
    this.editingEntryId.set(id);
    this.lines.set((result.lines || []).map((line: ApiRecord) => ({
      productId: String(line.productId || ''),
      productName: String(line.productName || 'Laundry item'),
      regularOpening: this.numberValue(line.regularOpening),
      regularInQty: this.numberValue(line.regularInQty),
      regularOutQty: this.numberValue(line.regularOutQty),
      rate: this.numberValue(line.rate),
      amount: this.numberValue(line.amount),
      rewashOpening: this.numberValue(line.rewashOpening),
      rewashInQty: this.numberValue(line.rewashInQty),
      rewashOutQty: this.numberValue(line.rewashOutQty)
    })));
    this.success.set('Laundry entry opened.');
  }

  save(printAfterSave: boolean): void {
    if (!this.laundryAccountId()) {
      this.error.set('Laundry account select karo. Account Master me Laundry checkbox ON hona chahiye.');
      return;
    }
    this.saving.set(true);
    this.error.set('');
    this.success.set('');
    const account = this.laundryAccounts().find((item) => String(item.id || '') === this.laundryAccountId()) || {};
    const entry = {
      id: this.editingEntryId() || `${Date.now()}`,
      branchId: this.api.selectedBranchId(),
      docNo: this.docNo(),
      docDate: this.docDate(),
      laundryAccountId: this.laundryAccountId(),
      laundryAccountName: account.accountName || account.name || 'Laundry',
      remarks: this.remarks(),
      regularTotalIn: this.regularTotalIn(),
      regularTotalOut: this.regularTotalOut(),
      rewashTotalIn: this.rewashTotalIn(),
      rewashTotalOut: this.rewashTotalOut(),
      totalAmount: this.totalAmount(),
      lines: this.lines()
    };
    this.saveLocalEntry(entry);
    this.saving.set(false);
    this.success.set(printAfterSave ? 'Laundry entry saved locally. Print browser se kar sakte hain.' : 'Laundry entry saved locally.');
    this.editingEntryId.set('');
    this.docNo.set(this.nextLocalDocNo());
    if (printAfterSave) this.printPage();
    this.resetLines();
    this.loadRecent();
  }

  resetForm(): void {
    this.remarks.set('');
    this.editingEntryId.set('');
    this.resetLines();
    this.success.set('');
    this.error.set('');
  }

  resetLines(): void {
    this.lines.update((lines) => lines.map((line) => ({
      ...line,
      regularOpening: 0,
      regularInQty: 0,
      regularOutQty: 0,
      amount: 0,
      rewashOpening: 0,
      rewashInQty: 0,
      rewashOutQty: 0
    })));
  }

  updateLine(index: number, key: keyof LaundryLine, value: unknown): void {
    this.lines.update((lines) => lines.map((line, lineIndex) => {
      if (lineIndex !== index) return line;
      const next = { ...line, [key]: this.numberValue(value) };
      if (key === 'regularInQty' || key === 'rate') next.amount = this.lineAmount(next);
      return next;
    }));
  }

  addSelectedProduct(): void {
    const product = this.productOptions().find((item) => String(item.id || '') === this.selectedProductId());
    if (!product) return;
    const exists = this.lines().some((line) => line.productId === product.id);
    if (!exists) this.lines.update((lines) => [...lines, this.lineFromProduct(product)]);
    this.selectedProductId.set('');
  }

  removeLine(index: number): void {
    this.lines.update((lines) => lines.filter((_, lineIndex) => lineIndex !== index));
  }

  printPage(): void {
    setTimeout(() => window.print(), 0);
  }

  trackLine(index: number, line: LaundryLine): string {
    return line.productId || `${index}-${line.productName}`;
  }

  private lineFromProduct(product: ApiRecord): LaundryLine {
    return {
      productId: String(product.id || ''),
      productName: String(product.name || product.productName || 'Laundry item'),
      regularOpening: 0,
      regularInQty: 0,
      regularOutQty: 0,
      rate: this.numberValue(product.rate),
      amount: 0,
      rewashOpening: 0,
      rewashInQty: 0,
      rewashOutQty: 0
    };
  }

  private sum(key: keyof LaundryLine): number {
    return Math.round(this.lines().reduce((total, line) => total + this.numberValue(line[key]), 0) * 100) / 100;
  }

  private numberValue(value: unknown): number {
    const parsed = Number(value || 0);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  private lineAmount(line: LaundryLine): number {
    return Math.round(this.numberValue(line.regularInQty) * this.numberValue(line.rate) * 100) / 100;
  }

  private laundryAccountOptions(accounts: ApiRecord[]): ApiRecord[] {
    return accounts
      .filter((account) => {
        const text = `${account.accountName || account.name || ''} ${account.groupName || ''}`.toLowerCase();
        return account.isLaundry === true || text.includes('laundry');
      })
      .map((account) => ({
        id: account.id,
        accountName: account.accountName || account.name || 'Laundry',
        groupName: account.groupName || ''
      }));
  }

  private productRows(products: ApiRecord[]): ApiRecord[] {
    const source = products.filter((product) => this.isLaundryProduct(product));
    const rows = source.map((product) => {
      const local = this.localLaundryProduct(product.id);
      const merged = { ...product, ...local };
      return {
      id: product.id,
      name: product.name || product.productName || product.sku || 'Laundry item',
      rate: this.numberValue(merged.laundryRate ?? merged.unitCost ?? merged.costPrice ?? merged.price ?? merged.sellingPrice)
      };
    });
    return rows.length ? rows : [
      { id: 'laundry_hair_wash_towel_white', name: 'HAIR WASH TOWEL (WHITE)', rate: 9 },
      { id: 'laundry_towel', name: 'TOWEL', rate: 9 },
      { id: 'laundry_towel_small', name: 'TOWEL SMALL', rate: 0 }
    ];
  }

  private isLaundryProduct(product: ApiRecord): boolean {
    const local = this.localLaundryProduct(product.id);
    const merged = { ...product, ...local };
    return merged.isLaundry === true || merged.laundry === true || merged.laundryProduct === true;
  }

  private localLaundryProduct(productId: unknown): ApiRecord {
    try {
      return JSON.parse(localStorage.getItem(`aura_laundry_product_${String(productId || '')}`) || '{}');
    } catch {
      return {};
    }
  }

  private localEntries(): ApiRecord[] {
    try {
      return JSON.parse(localStorage.getItem(this.storageKey()) || '[]');
    } catch {
      return [];
    }
  }

  private saveLocalEntry(entry: ApiRecord): void {
    const entries = this.localEntries().filter((item) => String(item.id || '') !== String(entry.id || ''));
    localStorage.setItem(this.storageKey(), JSON.stringify([entry, ...entries].slice(0, 50)));
  }

  private nextLocalDocNo(): string {
    const last = this.localEntries().reduce((max, entry) => Math.max(max, this.numberValue(entry.docNo)), 0);
    return String(last + 1).padStart(8, '0');
  }

  private storageKey(): string {
    return `aura_laundry_entries_${this.api.selectedBranchId() || 'all'}`;
  }

  private openQueuedEdit(): void {
    const key = this.editKey();
    const entryId = localStorage.getItem(key);
    if (!entryId) return;
    localStorage.removeItem(key);
    this.openEntry(entryId);
  }

  private editKey(): string {
    return `aura_laundry_edit_${this.api.selectedBranchId() || 'all'}`;
  }
}
