import { Component, EventEmitter, Output } from '@angular/core';
import { FormsModule } from '@angular/forms';

@Component({
  selector: 'app-customer-panel',
  standalone: true,
  imports: [FormsModule],
  template: `
    <section class="billing-panel">
      <h3>Customer</h3>
      <input [(ngModel)]="customerId" placeholder="Customer ID / phone" (ngModelChange)="customerChange.emit(customerId)" />
    </section>
  `
})
export class CustomerPanelComponent {
  @Output() customerChange = new EventEmitter<string>();
  customerId = '';
}
