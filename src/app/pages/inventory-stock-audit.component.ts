import { CommonModule, CurrencyPipe } from '@angular/common';
import { Component, OnInit, signal } from '@angular/core';
import { FormsModule, ReactiveFormsModule, UntypedFormBuilder, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { ApiRecord, ApiService } from '../core/api.service';
import { StateComponent } from '../shared/ui/state/state.component';

@Component({
  selector: 'app-inventory-stock-audit',
  standalone: true,
  imports: [CommonModule, CurrencyPipe, FormsModule, ReactiveFormsModule, RouterLink, StateComponent],
  template: `
    <section class="page-stack inventory-enterprise-page">
      <div class="module-hero">
        <div>
          <span class="eyebrow">Inventory / Audit</span>
          <h2>Stock audit, leakage detection and branch transfer approval</h2>
          <p>Expected stock vs actual stock variance, theft/leakage signals, and transfer recommendations before new purchase.</p>
        </div>
        <div class="hero-actions">
          <a class="ghost-button" routerLink="/inventory">Inventory</a>
          <button class="primary-button" type="button" (click)="runLeakageScan()" [disabled]="saving()">Run leakage scan</button>
        </div>
      </div>

      <app-state [loading]="loading()" [error]="error()"></app-state>
      <div class="state success" *ngIf="success()">{{ success() }}</div>

      <div class="audit-panels two">
        <section class="panel">
          <div class="section-title"><div><span class="eyebrow">Stock count</span><h2>Actual quantity entry</h2></div></div>
          <form [formGroup]="countForm" (ngSubmit)="createCount()" class="audit-form">
            <label class="field"><span>Branch</span><select formControlName="branchId"><option value="">Select branch</option><option *ngFor="let branch of branches()" [value]="branch.id">{{ branch.name }}</option></select></label>
            <label class="field"><span>Product</span><select formControlName="productId"><option value="">All branch products</option><option *ngFor="let product of products()" [value]="product.id">{{ product.name }} · system {{ product.stock || 0 }}</option></select></label>
            <label class="field"><span>Counted qty</span><input type="number" formControlName="countedQty" /></label>
            <label class="field full"><span>Reason / note</span><input formControlName="reason" placeholder="Monthly count, shelf count, opening variance" /></label>
            <div class="form-actions full"><button class="primary-button" type="submit" [disabled]="countForm.invalid || saving()">Create stock count</button></div>
          </form>
        </section>

        <section class="panel">
          <div class="section-title"><div><span class="eyebrow">Branch transfer</span><h2>Move stock before buying</h2></div></div>
          <form [formGroup]="transferForm" (ngSubmit)="createTransfer()" class="audit-form transfer">
            <label class="field"><span>Source branch</span><select formControlName="sourceBranchId"><option value="">Source</option><option *ngFor="let branch of branches()" [value]="branch.id">{{ branch.name }}</option></select></label>
            <label class="field"><span>Target branch</span><select formControlName="targetBranchId"><option value="">Target</option><option *ngFor="let branch of branches()" [value]="branch.id">{{ branch.name }}</option></select></label>
            <label class="field"><span>Product</span><select formControlName="sourceProductId"><option value="">Product</option><option *ngFor="let product of products()" [value]="product.id">{{ product.name }}</option></select></label>
            <label class="field"><span>Quantity</span><input type="number" formControlName="quantity" /></label>
            <label class="field full"><span>Reason</span><input formControlName="reason" placeholder="Transfer recommended before purchase" /></label>
            <div class="form-actions full"><button class="primary-button" type="submit" [disabled]="transferForm.invalid || saving()">Request transfer approval</button></div>
          </form>
        </section>
      </div>

      <div class="audit-panels three">
        <section class="panel">
          <div class="section-title"><div><span class="eyebrow">Counts</span><h2>Variance register</h2></div></div>
          <div class="audit-list">
            <article class="audit-row" *ngFor="let count of counts()">
              <div class="audit-row-info">
                <strong class="audit-row-title">{{ count.countNumber }}</strong>
                <span class="audit-row-meta">{{ count.status }} · variance {{ count.totalVarianceValue | currency:'INR':'symbol':'1.0-0' }}</span>
              </div>
              <button class="ghost-button mini" type="button" (click)="submitCount(count)" [disabled]="count.status === 'submitted' || saving()">Submit</button>
            </article>
          </div>
          <p class="muted" *ngIf="!counts().length">No stock counts yet.</p>
        </section>

        <section class="panel">
          <div class="section-title"><div><span class="eyebrow">Leakage</span><h2>Theft / waste findings</h2></div></div>
          <div class="audit-list">
            <article class="audit-row danger" *ngFor="let finding of leakage()">
              <div class="audit-row-info">
                <strong class="audit-row-title">{{ finding.findingType }}</strong>
                <span class="audit-row-meta">{{ productName(finding.productId) }} · loss {{ finding.estimatedLoss | currency:'INR':'symbol':'1.0-0' }}</span>
              </div>
              <span class="badge severity-{{ finding.severity }}">{{ finding.severity }}</span>
            </article>
          </div>
          <p class="muted" *ngIf="!leakage().length">No leakage findings right now.</p>
        </section>

        <section class="panel">
          <div class="section-title"><div><span class="eyebrow">Optimizer</span><h2>Transfer recommendations</h2></div></div>
          <div class="audit-list">
            <article class="audit-row" *ngFor="let item of recommendations()">
              <div class="audit-row-info">
                <strong class="audit-row-title">{{ item.productName }}</strong>
                <span class="audit-row-meta">{{ branchName(item.sourceBranchId) }} → {{ branchName(item.targetBranchId) }} · {{ item.quantity }} units</span>
              </div>
              <button class="ghost-button mini" type="button" (click)="useTransfer(item)">Use</button>
            </article>
          </div>
          <p class="muted" *ngIf="!recommendations().length">No branch transfer recommendation.</p>
        </section>
      </div>
    </section>
  `,
  styles: [`
    .audit-panels { display: grid; gap: 14px; }
    .audit-panels.two { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .audit-panels.three { grid-template-columns: repeat(3, minmax(0, 1fr)); }
    .audit-form { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; }
    .audit-form.transfer { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .audit-form .field.full { grid-column: 1 / -1; }
    .audit-list { display: grid; gap: 6px; }
    .audit-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 12px 14px; border: 1px solid rgba(79, 70, 229, 0.1); border-radius: 18px; background: rgba(255, 255, 255, 0.92); }
    .audit-row.danger { border-color: rgba(185, 28, 28, 0.2); background: #fff8f8; }
    .audit-row-info { display: grid; gap: 2px; }
    .audit-row-title { font-size: 0.92rem; font-weight: 650; color: var(--ink); }
    .audit-row-meta { font-size: 0.78rem; color: var(--muted); }
    .badge.severity-high { background: rgba(185, 28, 28, 0.1); color: var(--red); }
    .badge.severity-medium { background: rgba(217, 119, 6, 0.1); color: var(--amber); }
    .badge.severity-low { background: rgba(5, 150, 105, 0.1); color: var(--green); }
    @media (max-width: 1100px) { .audit-panels.two, .audit-panels.three { grid-template-columns: 1fr; } .audit-form { grid-template-columns: 1fr; } }
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

  productName(id: string): string { return this.products().find((item) => item.id === id)?.name || id || 'Product'; }
  branchName(id: string): string { return this.branches().find((item) => item.id === id)?.name || id || 'Branch'; }
}
