import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output } from '@angular/core';
import { AuraMoneyPipe } from '../../../../shared/pipes/aura-money.pipe';

@Component({
  selector: 'app-payment-modal',
  standalone: true,
  imports: [AuraMoneyPipe, CommonModule],
  styles: [`
    .billing-panel { display: grid; gap: 14px; border: 1px solid var(--aura-border-soft, rgba(75, 18, 56, 0.12)); border-radius: var(--aura-card-radius-premium, 14px); background: var(--aura-surface-raised, #fff); padding: 16px; box-shadow: 0 12px 30px rgba(75, 18, 56, 0.07); }
    .panel-head { display: flex; justify-content: space-between; gap: 12px; align-items: start; }
    h3 { margin: 0; color: var(--aura-text, #1f2933); }
    .total-card { display: grid; gap: 4px; padding: 14px; border: 1px solid var(--aura-border-soft, rgba(75, 18, 56, 0.12)); border-radius: 12px; background: color-mix(in srgb, var(--aura-primary-soft, rgba(75,18,56,.1)) 62%, white 38%); }
    .total-card span { color: var(--aura-muted, #6b7280); font-size: 0.78rem; font-weight: 850; text-transform: uppercase; }
    .total-card strong { color: var(--aura-primary, #4b1238); font-size: 1.55rem; }
    .payment-actions { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
    button { min-height: 42px; border: 1px solid var(--aura-border-soft, rgba(75, 18, 56, 0.12)); border-radius: 11px; font-weight: 850; cursor: pointer; }
    .checkout { color: #fff; background: linear-gradient(135deg, var(--aura-primary-hover, #6d1b4d), var(--aura-primary, #4b1238)); box-shadow: 0 12px 24px rgba(75, 18, 56, 0.18); }
    .split { color: var(--aura-primary, #4b1238); background: rgba(255, 255, 255, 0.88); }
    @media (max-width: 520px) { .payment-actions { grid-template-columns: 1fr; } }
  `],
  template: `
    <section class="billing-panel">
      <div class="panel-head"><h3>Payment summary</h3></div>
      <div class="total-card">
        <span>Total due</span>
        <strong>{{ total | auraMoney }}</strong>
      </div>
      <div class="payment-actions">
        <button class="checkout" type="button" (click)="checkout.emit()">Checkout</button>
        <button class="split" type="button" (click)="split.emit()">Split payment</button>
      </div>
    </section>
  `
})
export class PaymentModalComponent {
  @Input() total = 0;
  @Output() checkout = new EventEmitter<void>();
  @Output() split = new EventEmitter<void>();
}
