import { CommonModule, CurrencyPipe } from '@angular/common';
import { Component, OnInit, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { ApiRecord, ApiService } from '../core/api.service';
import { StateComponent } from '../shared/ui/state/state.component';

@Component({
  selector: 'app-inventory-fifo',
  standalone: true,
  imports: [CommonModule, CurrencyPipe, RouterLink, StateComponent],
  template: `
    <section class="page-stack fifo-page">
      <div class="module-hero compact-hero">
        <div>
          <span class="eyebrow">Inventory / Batch + Expiry + FIFO</span>
          <h2>Next stock to consume</h2>
          <p>Expiry-first batch control, supplier trail and cash at risk are separated from the main inventory dashboard.</p>
        </div>
        <div class="hero-actions">
          <a class="ghost-button" routerLink="/inventory">Inventory home</a>
          <a class="ghost-button" routerLink="/inventory/purchase-orders">Receive stock</a>
          <a class="primary-button" routerLink="/inventory/stock-audit">Audit stock</a>
        </div>
      </div>

      <app-state [loading]="loading()" [error]="error()"></app-state>

      <section class="fifo-kpis">
        <article class="metric-card teal"><span>Active batches</span><strong>{{ activeBatches().length }}</strong><small>FIFO available</small></article>
        <article class="metric-card amber"><span>Expiring soon</span><strong>{{ expiringSoon().length }}</strong><small>within 60 days</small></article>
        <article class="metric-card blue"><span>Batch value</span><strong>{{ batchValue() | currency:'INR':'symbol':'1.0-0' }}</strong><small>quantity available x unit cost</small></article>
        <article class="metric-card red"><span>No expiry</span><strong>{{ noExpiry().length }}</strong><small>cleanup required</small></article>
      </section>

      <div class="fifo-grid">
        <section class="panel">
          <div class="section-title"><div><span class="eyebrow">FIFO queue</span><h2>Consume these batches first</h2></div></div>
          <div class="fifo-list">
            <article *ngFor="let batch of activeBatches()">
              <div>
                <strong>{{ productName(batch.productId) }}</strong>
                <span>{{ batch.batchNumber || batch.id }} · {{ batch.quantityAvailable || 0 }} left of {{ batch.quantityReceived || 0 }}</span>
                <small>Supplier {{ supplierName(batch.supplierId) }} · branch {{ branchName(batch.branchId) }}</small>
              </div>
              <div class="right">
                <strong>{{ batch.expiryDate || 'No expiry' }}</strong>
                <span>{{ batch.unitCost | currency:'INR':'symbol':'1.0-0' }} unit</span>
                <a class="ghost-button mini" [routerLink]="['/inventory/products', batch.productId]">Product 360</a>
              </div>
            </article>
            <article *ngIf="!activeBatches().length">
              <div><strong>No active FIFO batches</strong><span>Receive stock with batch and expiry details.</span></div>
            </article>
          </div>
        </section>

        <section class="panel">
          <div class="section-title"><div><span class="eyebrow">Expiry watch</span><h2>Waste prevention queue</h2></div></div>
          <div class="expiry-list">
            <article *ngFor="let batch of expiringSoon()">
              <strong>{{ productName(batch.productId) }}</strong>
              <span>{{ daysUntil(batch.expiryDate) }} day(s) left · {{ batch.quantityAvailable || 0 }} unit(s)</span>
              <small>{{ batch.batchNumber || batch.id }} · {{ supplierName(batch.supplierId) }}</small>
            </article>
            <article *ngIf="!expiringSoon().length"><strong>No near expiry batch</strong><span>Nothing is inside the 60-day risk window.</span></article>
          </div>
        </section>
      </div>
    </section>
  `,
  styles: [`
    .compact-hero, .hero-actions, .section-title {
      align-items: center;
    }

    .hero-actions {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      justify-content: flex-end;
    }

    .fifo-kpis,
    .fifo-grid {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 12px;
    }

    .fifo-grid {
      grid-template-columns: minmax(0, 1.35fr) minmax(360px, .65fr);
    }

    .fifo-list,
    .expiry-list {
      display: grid;
      gap: 10px;
    }

    .fifo-list article,
    .expiry-list article {
      display: grid;
      grid-template-columns: minmax(0, 1fr) 180px;
      gap: 14px;
      padding: 14px;
      border: 1px solid rgba(79, 70, 229, 0.1);
      border-radius: 18px;
      background: rgba(255, 255, 255, 0.92);
    }

    .expiry-list article {
      grid-template-columns: 1fr;
    }

    .fifo-list strong,
    .fifo-list span,
    .fifo-list small,
    .expiry-list strong,
    .expiry-list span,
    .expiry-list small {
      display: block;
    }

    .fifo-list span,
    .fifo-list small,
    .expiry-list span,
    .expiry-list small {
      color: var(--muted);
      font-weight: 800;
    }

    .right {
      text-align: right;
      display: grid;
      justify-items: end;
      gap: 4px;
    }

    @media (max-width: 1020px) {
      .fifo-kpis,
      .fifo-grid,
      .fifo-list article {
        grid-template-columns: 1fr;
      }

      .right {
        justify-items: start;
        text-align: left;
      }
    }
  `]
})
export class InventoryFifoComponent implements OnInit {
  readonly products = signal<ApiRecord[]>([]);
  readonly suppliers = signal<ApiRecord[]>([]);
  readonly branches = signal<ApiRecord[]>([]);
  readonly batches = signal<ApiRecord[]>([]);
  readonly loading = signal(true);
  readonly error = signal('');

  constructor(private readonly api: ApiService) {}

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.loading.set(true);
    Promise.all([
      firstValueFrom(this.api.list<ApiRecord[]>('products', { limit: 10000 })),
      firstValueFrom(this.api.list<ApiRecord[]>('suppliers', { limit: 1000 })),
      firstValueFrom(this.api.list<ApiRecord[]>('branches', { limit: 1000 })),
      firstValueFrom(this.api.list<ApiRecord[]>('inventoryBatches', { branchId: this.api.selectedBranchId(), limit: 10000 }))
    ]).then(([products, suppliers, branches, batches]) => {
      this.products.set(products || []);
      this.suppliers.set(suppliers || []);
      this.branches.set(branches || []);
      this.batches.set(batches || []);
      this.loading.set(false);
    }).catch((error) => {
      this.error.set(this.api.errorText(error, 'Unable to load FIFO batches'));
      this.loading.set(false);
    });
  }

  activeBatches(): ApiRecord[] {
    return this.batches()
      .filter((batch) => Number(batch.quantityAvailable || 0) > 0)
      .slice()
      .sort((a, b) => String(a.expiryDate || '9999-12-31').localeCompare(String(b.expiryDate || '9999-12-31')));
  }

  expiringSoon(): ApiRecord[] {
    return this.activeBatches().filter((batch) => batch.expiryDate && this.daysUntil(batch.expiryDate) <= 60);
  }

  noExpiry(): ApiRecord[] {
    return this.activeBatches().filter((batch) => !batch.expiryDate);
  }

  batchValue(): number {
    return this.activeBatches().reduce((total, batch) => total + Number(batch.quantityAvailable || 0) * Number(batch.unitCost || 0), 0);
  }

  productName(id: string): string {
    return this.products().find((product) => product.id === id)?.name || id || 'Product';
  }

  supplierName(id: string): string {
    if (!id) return 'not linked';
    return this.suppliers().find((supplier) => supplier.id === id)?.name || id;
  }

  branchName(id: string): string {
    return this.branches().find((branch) => branch.id === id)?.name || id || 'All branches';
  }

  daysUntil(value: string): number {
    const time = new Date(value).getTime();
    if (!value || Number.isNaN(time)) return 9999;
    return Math.round((time - Date.now()) / 86400000);
  }
}
