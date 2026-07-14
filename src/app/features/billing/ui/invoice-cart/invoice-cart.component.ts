import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { InvoiceItem } from '../../domain/invoice.model';
import { AuraMoneyPipe } from '../../../../shared/pipes/aura-money.pipe';

@Component({
  selector: 'app-invoice-cart',
  standalone: true,
  imports: [AuraMoneyPipe, CommonModule, FormsModule],
  styles: [`
    .billing-panel { display: grid; gap: 14px; border: 1px solid var(--aura-border-soft, rgba(75, 18, 56, 0.12)); border-radius: var(--aura-card-radius-premium, 14px); background: var(--aura-surface-raised, #fff); padding: 16px; box-shadow: 0 12px 30px rgba(75, 18, 56, 0.07); }
    .cart-head, .hh-controls, .cart-row, .discount-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
    .cart-head h3 { margin: 0; color: var(--aura-text, #1f2933); }
    .item-count { border: 1px solid color-mix(in srgb, var(--aura-primary, #4b1238) 16%, var(--aura-border-soft, rgba(75,18,56,.12))); border-radius: 999px; padding: 5px 10px; color: var(--aura-primary, #4b1238); background: color-mix(in srgb, var(--aura-primary-soft, rgba(75,18,56,.1)) 78%, white 22%); font-size: .75rem; font-weight: 900; }
    .hh-controls { align-items: stretch; flex-wrap: wrap; }
    .bypass-toggle, .group-control { display: inline-flex; gap: 8px; align-items: center; min-height: 40px; border: 1px solid var(--aura-border-soft, rgba(75, 18, 56, 0.12)); border-radius: 11px; background: color-mix(in srgb, var(--aura-bg, #faf7f2) 76%, white 24%); padding: 0 11px; color: var(--aura-muted, #6b7280); font-size: 13px; font-weight: 800; }
    .group-control input { width: 72px; min-height: 30px; border: 1px solid var(--aura-border-soft, rgba(75,18,56,.12)); border-radius: 9px; padding: 0 8px; }
    .empty-cart { display: grid; gap: 5px; min-height: 92px; place-items: center; border: 1px dashed var(--aura-border-soft, rgba(75,18,56,.12)); border-radius: 12px; color: var(--aura-muted, #6b7280); text-align: center; }
    .cart-list { display: grid; gap: 8px; }
    .cart-row { display: grid; grid-template-columns: minmax(0, 1fr) auto auto; padding: 12px; border: 1px solid var(--aura-border-soft, rgba(75, 18, 56, 0.12)); border-radius: 12px; background: rgba(255,255,255,.9); }
    .item-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--aura-text, #1f2933); font-weight: 850; }
    .line-price { display: inline-flex; align-items: center; justify-content: flex-end; gap: 6px; color: var(--aura-text, #1f2933); }
    .happy-hour-line { display: inline-flex; align-items: center; gap: 6px; flex-wrap: wrap; }
    .happy-hour-line s { color: var(--aura-muted, #6b7280); }
    .hh-badge { display: inline-flex; align-items: center; border: 1px solid rgba(200, 125, 75, 0.24); border-radius: 999px; background: var(--aura-success-bg, rgba(200,125,75,.12)); color: var(--aura-success, #C87D4B); font-size: 11px; font-weight: 900; padding: 3px 8px; }
    .remove-button { min-height: 36px; border: 1px solid rgba(225, 29, 72, .22); border-radius: 10px; background: var(--aura-danger-bg, rgba(225,29,72,.12)); color: var(--aura-danger, #e11d48); font-weight: 850; cursor: pointer; }
    .discounts { display: grid; gap: 8px; }
    .discount-row { border: 1px solid rgba(200, 125, 75, 0.22); border-radius: 12px; background: var(--aura-success-bg, rgba(200,125,75,.12)); color: var(--aura-success, #C87D4B); font-weight: 850; padding: 10px 12px; }
    .discount-amount { font-weight: 950; }
    @media (max-width: 620px) { .cart-head, .hh-controls, .discount-row { align-items: stretch; flex-direction: column; } .cart-row { grid-template-columns: 1fr; } .line-price { justify-content: flex-start; } }
  `],
  template: `
    <section class="billing-panel">
      <div class="cart-head">
        <h3>Invoice cart</h3>
        <span class="item-count">{{ items.length }} item(s)</span>
      </div>

      <div class="hh-controls">
        <label class="bypass-toggle">
          <input type="checkbox" [ngModel]="bypassHappyHours" (ngModelChange)="bypassHappyHoursChange.emit($event)" />
          Bypass Happy Hours
        </label>
        <label class="group-control">
          Group
          <input type="number" min="1" max="20" [ngModel]="groupSize" (ngModelChange)="groupSizeChange.emit($event)" />
        </label>
      </div>

      <div class="empty-cart" *ngIf="!items.length">
        <strong>No items added yet.</strong>
        <span>Add services or products to prepare checkout.</span>
      </div>

      <div class="cart-list" *ngIf="items.length">
        <div class="cart-row" *ngFor="let item of items; let i = index">
          <span class="item-name">{{ item.item_name }}</span>
          <strong class="line-price">
            <span *ngIf="item.happyHourDiscountPaise; else regularPrice" class="happy-hour-line">
              <s>₹{{ (item.originalPricePaise || 0) / 100 | number:'1.2-2' }}</s>
              ₹{{ (item.finalPricePaise || 0) / 100 | number:'1.2-2' }}
              <span class="hh-badge">Happy Hours</span>
            </span>
            <ng-template #regularPrice>{{ item.quantity * item.unit_price | auraMoney }}</ng-template>
          </strong>
          <button class="remove-button" type="button" (click)="remove.emit(i)">Remove</button>
        </div>
      </div>

      <div class="discounts" *ngIf="happyHourTotalDiscount > 0 || groupDiscountPaise > 0 || bundleSavingsPaise > 0">
        <div *ngIf="happyHourTotalDiscount > 0" class="discount-row">
          <span>Happy Hours Discount</span>
          <span class="discount-amount">- ₹{{ happyHourTotalDiscount / 100 | number:'1.2-2' }}</span>
        </div>
        <div *ngIf="groupDiscountPaise > 0" class="discount-row">
          <span>{{ groupDiscountLabel || 'Group booking discount' }}</span>
          <span class="discount-amount">- ₹{{ groupDiscountPaise / 100 | number:'1.2-2' }}</span>
        </div>
        <div *ngIf="bundleSavingsPaise > 0" class="discount-row">
          <span>{{ bundleName || 'Combo bundle savings' }}</span>
          <span class="discount-amount">- ₹{{ bundleSavingsPaise / 100 | number:'1.2-2' }}</span>
        </div>
      </div>
    </section>
  `
})
export class InvoiceCartComponent {
  @Input() items: InvoiceItem[] = [];
  @Input() happyHourTotalDiscount = 0;
  @Input() groupDiscountPaise = 0;
  @Input() groupDiscountLabel = '';
  @Input() bundleSavingsPaise = 0;
  @Input() bundleName = '';
  @Input() groupSize = 1;
  @Input() bypassHappyHours = false;
  @Output() remove = new EventEmitter<number>();
  @Output() groupSizeChange = new EventEmitter<number>();
  @Output() bypassHappyHoursChange = new EventEmitter<boolean>();
}
