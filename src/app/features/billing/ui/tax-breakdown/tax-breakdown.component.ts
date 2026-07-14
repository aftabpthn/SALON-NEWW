import { CommonModule } from '@angular/common';
import { Component, Input } from '@angular/core';
import { AuraMoneyPipe } from '../../../../shared/pipes/aura-money.pipe';

@Component({
  selector: 'app-tax-breakdown',
  standalone: true,
  imports: [AuraMoneyPipe, CommonModule],
  template: `
    <section class="billing-panel">
      <h3>Tax breakdown</h3>
      <p>Total tax: {{ taxTotal | auraMoney }}</p>
    </section>
  `
})
export class TaxBreakdownComponent {
  @Input() taxTotal = 0;
}
