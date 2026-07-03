import { CommonModule } from '@angular/common';
import { Component, Input } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { SplitPaymentLine } from '../../domain/payment.model';

@Component({
  selector: 'app-split-payment',
  standalone: true,
  imports: [CommonModule, FormsModule],
  styles: [`
    .billing-panel { display: grid; gap: 14px; border: 1px solid var(--aura-border-soft, rgba(75, 18, 56, 0.12)); border-radius: var(--aura-card-radius-premium, 14px); background: var(--aura-surface-raised, #fff); padding: 16px; box-shadow: 0 12px 30px rgba(75, 18, 56, 0.07); }
    h3 { margin: 0; color: var(--aura-text, #1f2933); }
    .split-row { display: grid; grid-template-columns: minmax(0, 1fr) minmax(120px, .5fr); gap: 10px; align-items: end; }
    label { display: grid; gap: 5px; color: var(--aura-muted, #6b7280); font-size: .78rem; font-weight: 850; text-transform: uppercase; }
    select, input { min-height: 42px; border: 1px solid var(--aura-border-soft, rgba(75, 18, 56, 0.12)); border-radius: 11px; background: rgba(255,255,255,.96); color: var(--aura-text, #1f2933); padding: 0 11px; font: inherit; }
    select:focus, input:focus { border-color: color-mix(in srgb, var(--aura-primary, #4b1238) 44%, var(--aura-border-soft, rgba(75,18,56,.12))); box-shadow: 0 0 0 3px rgba(75,18,56,.1); outline: none; }
    @media (max-width: 520px) { .split-row { grid-template-columns: 1fr; } }
  `],
  template: `
    <section class="billing-panel">
      <h3>Split payment</h3>
      <div class="split-row" *ngFor="let payment of payments">
        <label>
          <span>Mode</span>
          <select [(ngModel)]="payment.mode"><option>cash</option><option>upi</option><option>card</option><option>wallet</option></select>
        </label>
        <label>
          <span>Amount</span>
          <input type="number" [(ngModel)]="payment.amount" />
        </label>
      </div>
    </section>
  `
})
export class SplitPaymentComponent {
  @Input() payments: SplitPaymentLine[] = [];
}
