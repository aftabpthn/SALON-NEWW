import { CommonModule } from '@angular/common';
import { Component, Input } from '@angular/core';
import { Invoice } from '../../domain/invoice.model';
import { AuraMoneyPipe } from '../../../../shared/pipes/aura-money.pipe';

@Component({
  selector: 'app-invoice-preview',
  standalone: true,
  imports: [AuraMoneyPipe, CommonModule],
  template: `
    <section class="billing-panel" *ngIf="invoice">
      <h3>{{ invoice.invoice_no }}</h3>
      <p>Status: {{ invoice.status }} / {{ invoice.payment_status }}</p>
      <strong>{{ invoice.grand_total | auraMoney }}</strong>
    </section>
  `
})
export class InvoicePreviewComponent {
  @Input() invoice: Invoice | null = null;
}
