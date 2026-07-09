import { CommonModule } from '@angular/common';
import { Component, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ServiceProductPickerComponent } from '../../ui/service-product-picker/service-product-picker.component';
import { InvoiceCartComponent } from '../../ui/invoice-cart/invoice-cart.component';
import { CustomerPanelComponent } from '../../ui/customer-panel/customer-panel.component';
import { PaymentModalComponent } from '../../ui/payment-modal/payment-modal.component';
import { SplitPaymentComponent } from '../../ui/split-payment/split-payment.component';
import { TaxBreakdownComponent } from '../../ui/tax-breakdown/tax-breakdown.component';
import { InvoicePreviewComponent } from '../../ui/invoice-preview/invoice-preview.component';
import { PrintSettingsComponent } from '../../ui/print-settings/print-settings.component';
import { BarcodeInputComponent } from '../../ui/barcode-input/barcode-input.component';
import { PosCartStore } from '../../application/pos-cart.store';
import { PaymentStore } from '../../application/payment.store';
import { BillingStore } from '../../application/billing.store';
import { OfflineSyncStore } from '../../application/offline-sync.store';
import { PrintStore } from '../../application/print.store';
import { BillingRepository } from '../../data/billing.repository';

@Component({
  selector: 'app-enterprise-pos-page',
  standalone: true,
  providers: [PosCartStore, PaymentStore, BillingStore, OfflineSyncStore, PrintStore],
  imports: [CommonModule, FormsModule, ServiceProductPickerComponent, InvoiceCartComponent, CustomerPanelComponent, PaymentModalComponent, SplitPaymentComponent, TaxBreakdownComponent, InvoicePreviewComponent, PrintSettingsComponent, BarcodeInputComponent],
  styles: [`
    .billing-shell { display: grid; grid-template-columns: 280px minmax(0, 1fr) 320px; gap: 16px; padding: 16px; }
    .billing-panel { border: 1px solid #dbe3e8; border-radius: 8px; padding: 14px; background: #fff; }
    .stack { display: grid; gap: 12px; }
    .status-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
    .badge { border-radius: 999px; background: #e7f5f2; color: #087568; padding: 6px 10px; font-weight: 700; }
    .badge.offline { background: #fff1f0; color: #b42318; }
    @media (max-width: 900px) { .billing-shell { grid-template-columns: 1fr; } }
  `],
  template: `
    <section class="stack inner-page-shell">
      <header class="billing-panel status-row inner-page-header">
        <div>
          <h1>Enterprise POS Billing</h1>
        </div>
        <span class="badge" [class.offline]="!offline.online()">{{ offline.badge() }}</span>
      </header>
      <div class="billing-shell inner-page-card">
        <section class="stack">
          <app-barcode-input (scanned)="print.resolveBarcode($event, '', billing.selectedBranchId())" />
          <app-service-product-picker (itemPicked)="cart.add($event)" />
        </section>
        <main class="stack">
          <app-invoice-cart
            [items]="cart.items()"
            [happyHourTotalDiscount]="happyHourTotalDiscount()"
            [groupDiscountPaise]="groupDiscountPaise()"
            [groupDiscountLabel]="groupDiscountLabel()"
            [bundleSavingsPaise]="bundleSavingsPaise()"
            [bundleName]="bundleName()"
            [groupSize]="groupSize()"
            [bypassHappyHours]="bypassHappyHours()"
            (groupSizeChange)="setGroupSize($event)"
            (bypassHappyHoursChange)="setBypassHappyHours($event)"
            (remove)="cart.remove($event)"
          />
          <app-tax-breakdown [taxTotal]="cart.tax()" />
          <app-split-payment [payments]="payments.splitPayments()" />
        </main>
        <aside class="stack">
          <app-customer-panel (customerChange)="billing.selectedCustomerId.set($event)" />
          <app-payment-modal [total]="cart.total()" (checkout)="createDraft()" />
          <app-invoice-preview [invoice]="repo.selectedInvoice()" />
          <app-print-settings
            [devices]="print.devices()"
            [selectedDeviceId]="print.selectedDeviceId()"
            (selectedDeviceIdChange)="print.selectedDeviceId.set($event)"
            (refresh)="print.loadDevices()"
          />
          <button type="button">Thermal print</button>
          <button type="button">WhatsApp invoice</button>
        </aside>
      </div>
    </section>
  `
})
export class PosPageComponent {
  readonly cart = inject(PosCartStore);
  readonly payments = inject(PaymentStore);
  readonly billing = inject(BillingStore);
  readonly offline = inject(OfflineSyncStore);
  readonly print = inject(PrintStore);
  readonly repo = inject(BillingRepository);
  readonly bypassHappyHours = signal(false);
  readonly happyHourTotalDiscount = signal(0);
  readonly groupDiscountPaise = signal(0);
  readonly groupDiscountLabel = signal('');
  readonly bundleSavingsPaise = signal(0);
  readonly bundleName = signal('');
  readonly groupSize = signal(1);
  private lastHappyHoursPreviewKey = "";

  constructor() {
    this.print.loadDevices();
    effect(() => {
      if (this.cart.items().length) this.billing.draftAutosaveState.set('saved');
    });
    effect(() => {
      this.refreshCart();
    });
  }

  refreshCart(): void {
    const items = this.cart.items();
    if (!items.length) {
      this.happyHourTotalDiscount.set(0);
      this.groupDiscountPaise.set(0);
      this.groupDiscountLabel.set('');
      this.bundleSavingsPaise.set(0);
      this.bundleName.set('');
      this.lastHappyHoursPreviewKey = "";
      return;
    }

    const branchId = this.billing.selectedBranchId() || 'branch_hyd';
    const previewKey = JSON.stringify({
      bypass: this.bypassHappyHours(),
      groupSize: this.groupSize(),
      branchId,
      items: items.map((item) => ({
        item_type: item.item_type,
        item_id: item.item_id,
        quantity: item.quantity,
        unit_price: item.unit_price,
        discount_amount: item.discount_amount
      }))
    });
    if (previewKey === this.lastHappyHoursPreviewKey) return;
    this.lastHappyHoursPreviewKey = previewKey;

    this.repo.previewCartWithHappyHours(items, this.bypassHappyHours(), branchId, this.groupSize()).subscribe({
      next: (result) => {
        this.happyHourTotalDiscount.set(Number(result?.happyHourDiscountPaise ?? result?.totalDiscountPaise ?? 0));
        this.groupDiscountPaise.set(Number(result?.groupDiscountPaise || 0));
        this.groupDiscountLabel.set(String(result?.groupDiscountLabel || ''));
        this.bundleSavingsPaise.set(Number(result?.bundleSavingsPaise || 0));
        this.bundleName.set(String(result?.bundleName || ''));
        if (Array.isArray(result?.items)) this.cart.items.set(result.items);
      },
      error: () => {
        this.happyHourTotalDiscount.set(0);
        this.groupDiscountPaise.set(0);
        this.groupDiscountLabel.set('');
        this.bundleSavingsPaise.set(0);
        this.bundleName.set('');
      }
    });
  }

  setBypassHappyHours(value: boolean): void {
    this.bypassHappyHours.set(value);
    this.lastHappyHoursPreviewKey = "";
    this.refreshCart();
  }

  setGroupSize(value: number): void {
    this.groupSize.set(Math.max(1, Number(value) || 1));
    this.lastHappyHoursPreviewKey = "";
    this.refreshCart();
  }

  createDraft(): void {
    this.repo.createDraft({
      branch_id: this.billing.selectedBranchId() || 'branch_hyd',
      customer_id: this.billing.selectedCustomerId(),
      invoice_type: this.cart.items().some((item) => item.item_type === 'product') ? 'mixed' : 'service',
      source: 'enterprise_pos',
      items: this.cart.items(),
      bypassHappyHours: this.bypassHappyHours(),
      groupSize: this.groupSize()
    });
  }
}
