import { CommonModule, CurrencyPipe } from '@angular/common';
import { Component, Input } from '@angular/core';

@Component({
  selector: 'app-tax-breakdown',
  standalone: true,
  imports: [CommonModule, CurrencyPipe],
  template: `
    <section class="billing-panel">
      <h3>Tax breakdown</h3>
      <p>Total tax: {{ taxTotal | currency:'INR' }}</p>
    </section>
  `
})
export class TaxBreakdownComponent {
  @Input() taxTotal = 0;
}
