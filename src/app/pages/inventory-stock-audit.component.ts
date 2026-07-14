import { CommonModule } from '@angular/common';
import { Component, OnInit, signal } from '@angular/core';
import { FormsModule, ReactiveFormsModule, UntypedFormBuilder, Validators } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { ApiRecord, ApiService } from '../core/api.service';
import { InventoryZenotiChromeComponent } from '../shared/ui/inventory-zenoti-chrome/inventory-zenoti-chrome.component';
import { StateComponent } from '../shared/ui/state/state.component';
import { AuraMoneyPipe } from '../shared/pipes/aura-money.pipe';

@Component({
  selector: 'app-inventory-stock-audit',
  standalone: true,
  imports: [AuraMoneyPipe, CommonModule, FormsModule, ReactiveFormsModule, InventoryZenotiChromeComponent, StateComponent],
  template: `
    <section class="page-stack inventory-enterprise-page inner-page-shell">
      <app-inventory-zenoti-chrome
        title="Stock audit and leakage detection"
        breadcrumb="Inventory > Audit"
        (refresh)="load()"
      >
        <div zenoti-actions>
          <button class="primary-button" type="button" (click)="runLeakageScan()" [disabled]="saving()">Run leakage scan</button>
        </div>
      </app-inventory-zenoti-chrome>

      <app-state [loading]="loading()" [error]="error()"></app-state>
      <div class="state success" *ngIf="success()">{{ success() }}</div>

      <section class="zenoti-audit-workspace">
        <div class="zenoti-result-bar inner-stats-grid">
          <div>
            <strong>{{ activeAuditCount() }}</strong><span>Results</span>
            <small class="status-chip">Status: audit active in this center</small>
          </div>
          <div class="zenoti-totals">
            <span>Counts <strong>{{ counts().length }}</strong></span>
            <span>Leakage <strong>{{ leakage().length }}</strong></span>
            <span>Transfers <strong>{{ recommendations().length }}</strong></span>
            <span>Open variance <strong>{{ openVarianceValue() | auraMoney:'1.0-0' }}</strong></span>
          </div>
        </div>

        <div class="zenoti-filter-row inner-action-bar">
          <div class="tab-strip">
            <button type="button" [class.active]="activeView() === 'counts'" (click)="activeView.set('counts')">Counts</button>
            <button type="button" [class.active]="activeView() === 'leakage'" (click)="activeView.set('leakage')">Leakage</button>
            <button type="button" [class.active]="activeView() === 'transfers'" (click)="activeView.set('transfers')">Transfers</button>
          </div>
          <button class="primary-button" type="button" (click)="runLeakageScan()" [disabled]="saving()">Run leakage scan</button>
        </div>

        <div class="zenoti-table-wrap inner-table-wrap" *ngIf="activeView() === 'counts'">
          <table>
            <thead><tr><th>Count no</th><th>Status</th><th>Branch</th><th>Variance value</th><th>Lines</th><th>Action</th></tr></thead>
            <tbody>
              <tr *ngFor="let count of counts()">
                <td><strong>{{ count.countNumber || count.id }}</strong><small>{{ count.createdAt || count.created_at || 'Stock count' }}</small></td>
                <td><span class="audit-chip" [class.warn]="count.status !== 'submitted'">{{ count.status || 'draft' }}</span></td>
                <td>{{ branchName(count.branchId) }}</td>
                <td>{{ count.totalVarianceValue | auraMoney:'1.0-0' }}</td>
                <td>{{ lineCount(count) }}</td>
                <td><button class="zenoti-mini-button" type="button" (click)="submitCount(count)" [disabled]="count.status === 'submitted' || saving()">Submit</button></td>
              </tr>
              <tr *ngIf="!counts().length"><td colspan="6" class="empty-cell">No stock counts yet.</td></tr>
            </tbody>
          </table>
        </div>

        <div class="zenoti-table-wrap inner-table-wrap" *ngIf="activeView() === 'leakage'">
          <table>
            <thead><tr><th>Finding</th><th>Product</th><th>Severity</th><th>Estimated loss</th><th>Status</th><th>Reference</th></tr></thead>
            <tbody>
              <tr *ngFor="let finding of leakage()">
                <td><strong>{{ finding.findingType || 'Leakage' }}</strong><small>{{ finding.createdAt || finding.created_at || 'Finding' }}</small></td>
                <td>{{ productName(finding.productId) }}</td>
                <td><span class="audit-chip danger">{{ finding.severity || 'risk' }}</span></td>
                <td>{{ finding.estimatedLoss | auraMoney:'1.0-0' }}</td>
                <td>{{ finding.status || 'open' }}</td>
                <td>{{ finding.referenceType || '-' }} {{ finding.referenceId || '' }}</td>
              </tr>
              <tr *ngIf="!leakage().length"><td colspan="6" class="empty-cell">No leakage findings right now.</td></tr>
            </tbody>
          </table>
        </div>

        <div class="zenoti-table-wrap inner-table-wrap" *ngIf="activeView() === 'transfers'">
          <table>
            <thead><tr><th>Product</th><th>Source</th><th>Target</th><th>Quantity</th><th>Reason</th><th>Action</th></tr></thead>
            <tbody>
              <tr *ngFor="let item of recommendations()">
                <td><strong>{{ item.productName || productName(item.productId) }}</strong><small>{{ item.productId || item.sourceProductId || 'Transfer' }}</small></td>
                <td>{{ branchName(item.sourceBranchId) }}</td>
                <td>{{ branchName(item.targetBranchId) }}</td>
                <td>{{ item.quantity || 0 }} units</td>
                <td>{{ item.reason || 'Move stock before buying' }}</td>
                <td><button class="zenoti-mini-button" type="button" (click)="useTransfer(item)">Use</button></td>
              </tr>
              <tr *ngIf="!recommendations().length"><td colspan="6" class="empty-cell">No branch transfer recommendation.</td></tr>
            </tbody>
          </table>
        </div>

        <div class="zenoti-footer">
          <span>1 to {{ activeAuditCount() }} of {{ activeAuditCount() }}</span>
          <span>{{ countForm.value.branchId ? 'Branch scope active' : 'All branches' }}</span>
        </div>
      </section>

      <div class="enterprise-grid two audit-workdesk">
        <section class="panel inner-page-card">
          <div class="section-title"><div><h2>Actual quantity entry</h2></div></div>
          <form [formGroup]="countForm" (ngSubmit)="createCount()" class="audit-form">
            <label class="field"><span>Branch</span><select formControlName="branchId"><option value="">Select branch</option><option *ngFor="let branch of branches()" [value]="branch.id">{{ branch.name }}</option></select></label>
            <label class="field"><span>Product</span><select formControlName="productId"><option value="">All branch products</option><option *ngFor="let product of products()" [value]="product.id">{{ product.name }} · system {{ product.stock || 0 }}</option></select></label>
            <label class="field"><span>Counted qty</span><input type="number" formControlName="countedQty" /></label>
            <label class="field full"><span>Reason / note</span><input formControlName="reason" placeholder="Monthly count, shelf count, opening variance" /></label>
            <div class="form-actions full"><button class="primary-button" type="submit" [disabled]="countForm.invalid || saving()">Create stock count</button></div>
          </form>
        </section>

        <section class="panel">
          <div class="section-title"><div><h2>Move stock before buying</h2></div></div>
          <form [formGroup]="transferForm" (ngSubmit)="createTransfer()" class="audit-form transfer">
            <label class="field"><span>Source branch</span><select formControlName="sourceBranchId"><option value="">Source</option><option *ngFor="let branch of branches()" [value]="branch.id">{{ branch.name }}</option></select></label>
            <label class="field"><span>Target branch</span><select formControlName="targetBranchId"><option value="">Target</option><option *ngFor="let branch of branches()" [value]="branch.id">{{ branch.name }}</option></select></label>
            <label class="field"><span>Product</span><select formControlName="sourceProductId"><option value="">Product</option><option *ngFor="let product of products()" [value]="product.id">{{ product.name }}</option></select></label>
            <label class="field"><span>Quantity</span><input type="number" formControlName="quantity" /></label>
            <label class="field full"><span>Reason</span><input formControlName="reason" /></label>
            <div class="form-actions full"><button class="primary-button" type="submit" [disabled]="transferForm.invalid || saving()">Request transfer approval</button></div>
          </form>
        </section>
      </div>
    </section>
  `,
  styles: [`
    .inventory-enterprise-page { gap: 0; }
    .section-title { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
    .zenoti-audit-workspace {
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
    .zenoti-result-bar > div,
    .zenoti-totals {
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
    .status-chip,
    .audit-chip {
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
    .audit-chip.warn { background: #fff3d8; border-color: #f7d48a; color: #7c4d00; }
    .audit-chip.danger { background: #fff1f0; border-color: #ffc8c2; color: #a51d16; }
    .tab-strip { display: flex; flex-wrap: wrap; gap: 8px; }
    .tab-strip button {
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
      min-width: 1120px;
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
    .zenoti-mini-button {
      background: #fff;
      border: 1px solid #b9d0e7;
      border-radius: 3px;
      color: #075f9e;
      cursor: pointer;
      display: inline-flex;
      font: inherit;
      font-size: 12px;
      font-weight: 900;
      padding: 7px 10px;
      text-decoration: none;
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
    .enterprise-grid { display: grid; gap: 14px; }
    .enterprise-grid.two { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .audit-workdesk {
      background: #fff;
      border: 1px solid #d8e1ea;
      border-top: 0;
      padding: 14px 16px;
    }
    .audit-workdesk .panel {
      border: 1px solid #d8e1ea;
      border-radius: 3px;
      box-shadow: none;
    }
    .audit-form { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; }
    .audit-form.transfer { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .audit-form .full { grid-column: 1 / -1; }
    @media (max-width: 1100px) {
      .enterprise-grid.two,
      .audit-form,
      .audit-form.transfer { grid-template-columns: 1fr; }
      .zenoti-result-bar,
      .zenoti-filter-row,
      .zenoti-footer { align-items: flex-start; display: grid; }
    }
  `]
})
export class InventoryStockAuditComponent implements OnInit {
  readonly branches = signal<ApiRecord[]>([]);
  readonly products = signal<ApiRecord[]>([]);
  readonly counts = signal<ApiRecord[]>([]);
  readonly leakage = signal<ApiRecord[]>([]);
  readonly recommendations = signal<ApiRecord[]>([]);
  readonly loading = signal(true);
  readonly saving = signal(false);
  readonly error = signal('');
  readonly success = signal('');
  readonly activeView = signal<'counts' | 'leakage' | 'transfers'>('counts');

  readonly countForm = this.fb.group({
    branchId: ['', Validators.required],
    productId: [''],
    countedQty: [0],
    reason: ['']
  });

  readonly transferForm = this.fb.group({
    sourceBranchId: ['', Validators.required],
    targetBranchId: ['', Validators.required],
    sourceProductId: ['', Validators.required],
    quantity: [1, Validators.required],
    reason: ['Transfer recommended before purchase']
  });

  constructor(private readonly api: ApiService, private readonly fb: UntypedFormBuilder) {}

  ngOnInit(): void { this.load(); }

  load(): void {
    this.loading.set(true);
    Promise.all([
      firstValueFrom(this.api.list<ApiRecord[]>('branches', { limit: 1000 })),
      firstValueFrom(this.api.list<ApiRecord[]>('products', { limit: 10000 })),
      firstValueFrom(this.api.list<ApiRecord[]>('inventory-intelligence/stock-counts', { limit: 100 })),
      firstValueFrom(this.api.list<ApiRecord[]>('inventory-intelligence/leakage-findings', { limit: 100 })),
      firstValueFrom(this.api.list<ApiRecord[]>('inventory-intelligence/transfer-recommendations', { limit: 50 }))
    ]).then(([branches, products, counts, leakage, recommendations]) => {
      this.branches.set(branches || []);
      this.products.set(products || []);
      this.counts.set(counts || []);
      this.leakage.set(leakage || []);
      this.recommendations.set(recommendations || []);
      const branchId = this.api.selectedBranchId() || branches?.[0]?.id || '';
      this.countForm.patchValue({ branchId });
      this.loading.set(false);
    }).catch((error) => {
      this.error.set(error?.error?.error || error?.message || 'Unable to load stock audit');
      this.loading.set(false);
    });
  }

  createCount(): void {
    if (this.countForm.invalid) return;
    const raw = this.countForm.getRawValue();
    const items = raw.productId ? [{ productId: raw.productId, countedQty: Number(raw.countedQty || 0), reason: raw.reason }] : [];
    this.saving.set(true);
    this.api.post<ApiRecord>('inventory-intelligence/stock-counts', { branchId: raw.branchId, items, notes: raw.reason }).subscribe({
      next: () => { this.success.set('Stock count created with variance lines.'); this.saving.set(false); this.load(); },
      error: (error) => { this.error.set(error?.error?.error || error?.message || 'Unable to create stock count'); this.saving.set(false); }
    });
  }

  submitCount(count: ApiRecord): void {
    this.saving.set(true);
    this.api.post<ApiRecord>(`inventory-intelligence/stock-counts/${count.id}/submit`, {}).subscribe({
      next: () => { this.success.set('Stock count submitted and variance findings created.'); this.saving.set(false); this.load(); },
      error: (error) => { this.error.set(error?.error?.error || error?.message || 'Unable to submit stock count'); this.saving.set(false); }
    });
  }

  runLeakageScan(): void {
    const branchId = this.countForm.value.branchId || this.api.selectedBranchId();
    this.saving.set(true);
    this.api.post<ApiRecord>('inventory-intelligence/leakage-scan', { branchId }).subscribe({
      next: () => { this.success.set('Leakage scan completed.'); this.saving.set(false); this.load(); },
      error: (error) => { this.error.set(error?.error?.error || error?.message || 'Unable to run leakage scan'); this.saving.set(false); }
    });
  }

  useTransfer(item: ApiRecord): void {
    this.transferForm.patchValue(item);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  createTransfer(): void {
    if (this.transferForm.invalid) return;
    this.saving.set(true);
    this.api.post<ApiRecord>('inventory-intelligence/transfer-requests', this.transferForm.getRawValue()).subscribe({
      next: () => { this.success.set('Branch transfer request created for approval.'); this.saving.set(false); this.load(); },
      error: (error) => { this.error.set(error?.error?.error || error?.message || 'Unable to create transfer request'); this.saving.set(false); }
    });
  }

  activeAuditCount(): number {
    if (this.activeView() === 'leakage') return this.leakage().length;
    if (this.activeView() === 'transfers') return this.recommendations().length;
    return this.counts().length;
  }

  openVarianceValue(): number {
    return this.counts().reduce((total, count) => total + Number(count.totalVarianceValue || 0), 0);
  }

  lineCount(count: ApiRecord): number {
    const raw = count.lines || count.items || count.varianceLines || count.variance_lines;
    if (Array.isArray(raw)) return raw.length;
    if (typeof raw === 'string' && raw.trim()) {
      try {
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed.length : 0;
      } catch {
        return 0;
      }
    }
    return Number(count.lineCount || count.line_count || 0);
  }

  productName(id: string): string { return this.products().find((item) => item.id === id)?.name || id || 'Product'; }
  branchName(id: string): string { return this.branches().find((item) => item.id === id)?.name || id || 'Branch'; }
}
