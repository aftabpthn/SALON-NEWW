import { CommonModule, CurrencyPipe } from '@angular/common';
import { Component, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { ApiRecord, ApiService } from '../core/api.service';
import { InventoryZenotiChromeComponent } from '../shared/ui/inventory-zenoti-chrome/inventory-zenoti-chrome.component';
import { StateComponent } from '../shared/ui/state/state.component';

@Component({
  selector: 'app-inventory-reports',
  standalone: true,
  imports: [CommonModule, CurrencyPipe, FormsModule, InventoryZenotiChromeComponent, StateComponent],
  template: `
    <section class="page-stack inventory-enterprise-page">
      <app-inventory-zenoti-chrome
        title="COGS, margin, dead stock and supplier spend"
        breadcrumb="Inventory > Reports"
        (refresh)="load()"
      >
        <div zenoti-actions>
          <button class="primary-button" type="button" (click)="snapshot()" [disabled]="saving()">Create snapshot</button>
        </div>
      </app-inventory-zenoti-chrome>

      <app-state [loading]="loading()" [error]="error()"></app-state>
      <div class="state success" *ngIf="success()">{{ success() }}</div>

      <section class="report-kpis" *ngIf="report()?.metrics as metrics">
        <article class="metric-card teal"><span>Stock value</span><strong>{{ metrics.stockValue | currency:'INR':'symbol':'1.0-0' }}</strong></article>
        <article class="metric-card amber"><span>COGS</span><strong>{{ metrics.cogs | currency:'INR':'symbol':'1.0-0' }}</strong></article>
        <article class="metric-card blue"><span>Purchase spend</span><strong>{{ metrics.purchaseSpend | currency:'INR':'symbol':'1.0-0' }}</strong></article>
        <article class="metric-card red"><span>Dead stock</span><strong>{{ metrics.deadStockValue | currency:'INR':'symbol':'1.0-0' }}</strong></article>
        <article class="metric-card purple"><span>Expiry risk</span><strong>{{ metrics.expiryRiskValue | currency:'INR':'symbol':'1.0-0' }}</strong></article>
      </section>

      <div class="enterprise-grid three">
        <section class="panel">
          <div class="section-title"><div><span class="eyebrow">Dead stock</span><h2>Cash locked in shelves</h2></div></div>
          <article class="report-row" *ngFor="let row of report()?.deadStock || []">
            <span>{{ row.name }}</span><strong>{{ row.value | currency:'INR':'symbol':'1.0-0' }}</strong>
          </article>
          <p class="muted" *ngIf="!(report()?.deadStock || []).length">No dead stock signal.</p>
        </section>

        <section class="panel">
          <div class="section-title"><div><span class="eyebrow">Expiry</span><h2>Batch risk</h2></div></div>
          <article class="report-row" *ngFor="let row of report()?.expiring || []">
            <span>{{ row.productName }} · {{ row.daysToExpiry }} days</span><strong>{{ row.value | currency:'INR':'symbol':'1.0-0' }}</strong>
          </article>
          <p class="muted" *ngIf="!(report()?.expiring || []).length">No expiry risk in selected scope.</p>
        </section>

        <section class="panel">
          <div class="section-title"><div><span class="eyebrow">Supplier spend</span><h2>PO value by supplier</h2></div></div>
          <article class="report-row" *ngFor="let row of report()?.supplierSpend || []">
            <span>{{ row.name }} · {{ row.openPoItems }} open</span><strong>{{ row.spend | currency:'INR':'symbol':'1.0-0' }}</strong>
          </article>
          <p class="muted" *ngIf="!(report()?.supplierSpend || []).length">No supplier purchase spend yet.</p>
        </section>
      </div>

      <section class="panel">
        <div class="section-title"><div><span class="eyebrow">WhatsApp supplier orders</span><h2>Manual-send queue</h2></div></div>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Supplier</th><th>PO</th><th>Phone</th><th>Status</th><th>Message</th><th>Action</th></tr></thead>
            <tbody>
              <tr *ngFor="let row of queue()">
                <td>{{ supplierName(row.supplierId) }}</td>
                <td>{{ row.purchaseOrderId }}</td>
                <td>{{ row.phone || '-' }}</td>
                <td><span class="badge">{{ row.status }}</span></td>
                <td><pre>{{ row.message }}</pre></td>
                <td><button class="ghost-button mini" type="button" (click)="markSent(row)" [disabled]="row.status === 'sent' || saving()">Mark sent</button></td>
              </tr>
              <tr *ngIf="!queue().length"><td colspan="6">No supplier WhatsApp drafts queued.</td></tr>
            </tbody>
          </table>
        </div>
      </section>
    </section>
  `,
  styles: [`
    .hero-actions, .section-title, .report-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
    .report-kpis { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 12px; }
    .enterprise-grid.three { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 14px; }
    .report-row { padding: 10px 0; border-bottom: 1px solid var(--border); }
    .report-row span, .muted { color: var(--muted); }
    .table-wrap { overflow: auto; }
    table { min-width: 980px; }
    pre { white-space: pre-wrap; margin: 0; font-family: inherit; color: var(--muted); }
    @media (max-width: 1100px) { .report-kpis, .enterprise-grid.three { grid-template-columns: 1fr; } }
  `]
})
export class InventoryReportsComponent implements OnInit {
  readonly suppliers = signal<ApiRecord[]>([]);
  readonly report = signal<ApiRecord | null>(null);
  readonly queue = signal<ApiRecord[]>([]);
  readonly loading = signal(true);
  readonly saving = signal(false);
  readonly error = signal('');
  readonly success = signal('');

  constructor(private readonly api: ApiService) {}

  ngOnInit(): void { this.load(); }

  load(): void {
    this.loading.set(true);
    Promise.all([
      firstValueFrom(this.api.list<ApiRecord>('inventory-intelligence/reports', { branchId: this.api.selectedBranchId() })),
      firstValueFrom(this.api.list<ApiRecord[]>('inventory-intelligence/supplier-whatsapp-queue', { limit: 100 })),
      firstValueFrom(this.api.list<ApiRecord[]>('suppliers', { limit: 1000 }))
    ]).then(([report, queue, suppliers]) => {
      this.report.set(report || null);
      this.queue.set(queue || []);
      this.suppliers.set(suppliers || []);
      this.loading.set(false);
    }).catch((error) => {
      this.error.set(error?.error?.error || error?.message || 'Unable to load inventory reports');
      this.loading.set(false);
    });
  }

  snapshot(): void {
    this.saving.set(true);
    this.api.post<ApiRecord>('inventory-intelligence/reports/snapshot', { branchId: this.api.selectedBranchId() }).subscribe({
      next: () => { this.success.set('Inventory report snapshot saved.'); this.saving.set(false); this.load(); },
      error: (error) => { this.error.set(error?.error?.error || error?.message || 'Unable to save snapshot'); this.saving.set(false); }
    });
  }

  markSent(row: ApiRecord): void {
    this.saving.set(true);
    this.api.post<ApiRecord>(`inventory-intelligence/supplier-whatsapp-queue/${row.id}/mark-sent`, {}).subscribe({
      next: () => { this.success.set('Supplier WhatsApp order marked sent.'); this.saving.set(false); this.load(); },
      error: (error) => { this.error.set(error?.error?.error || error?.message || 'Unable to mark sent'); this.saving.set(false); }
    });
  }

  supplierName(id: string): string {
    return this.suppliers().find((item) => item.id === id)?.name || id || 'Supplier';
  }
}
