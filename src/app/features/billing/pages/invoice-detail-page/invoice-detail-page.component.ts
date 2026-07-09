import { CommonModule } from '@angular/common';
import { Component, OnInit, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { BillingApi } from '../../data/billing.api';
import { Invoice } from '../../domain/invoice.model';
import { InvoicePreviewComponent } from '../../ui/invoice-preview/invoice-preview.component';
import { RefundModalComponent } from '../../ui/refund-modal/refund-modal.component';
import { VoidInvoiceModalComponent } from '../../ui/void-invoice-modal/void-invoice-modal.component';

@Component({
  selector: 'app-invoice-detail-page',
  standalone: true,
  imports: [CommonModule, InvoicePreviewComponent, RefundModalComponent, VoidInvoiceModalComponent],
  styles: [`
    .invoice-detail-page { display: grid; gap: 16px; }
    .billing-hero, .invoice-workspace, .message-card { border: 1px solid var(--aura-border-soft, rgba(75, 18, 56, 0.12)); border-radius: var(--aura-card-radius-premium, 14px); background: var(--aura-surface-raised, #fff); box-shadow: 0 12px 30px rgba(75, 18, 56, 0.07); }
    .billing-hero { display: flex; align-items: flex-end; justify-content: space-between; gap: 14px; padding: 18px 20px; background: linear-gradient(135deg, var(--aura-primary-hover, #6d1b4d), var(--aura-primary, #4b1238)); color: #fff; }
    .billing-hero h1 { margin: 0; color: #fff; font-size: 1.45rem; letter-spacing: 0; }
    .billing-hero p { margin: 6px 0 0; color: rgba(255, 255, 255, 0.74); }
    .status-card { display: grid; gap: 2px; min-width: 132px; padding: 10px 12px; border: 1px solid rgba(255, 255, 255, 0.28); border-radius: 12px; background: rgba(255, 255, 255, 0.12); text-align: right; }
    .status-card span { color: rgba(255, 255, 255, 0.72); font-size: 0.75rem; font-weight: 800; text-transform: uppercase; }
    .status-card strong { color: #fff; text-transform: capitalize; }
    .invoice-workspace { display: grid; gap: 16px; padding: 16px; }
    .invoice-actions { display: grid; grid-template-columns: minmax(0, 1fr) minmax(260px, 0.48fr); gap: 16px; align-items: start; }
    .message-card { padding: 12px 14px; color: var(--aura-success, #C87D4B); background: var(--aura-success-bg, rgba(200, 125, 75, 0.12)); }

    .billing-hero {
      border-color: rgba(118, 85, 76, 0.13) !important;
      background: #fff !important;
      color: #2f2522 !important;
      box-shadow: 0 1px 2px rgba(41, 31, 28, 0.03), 0 10px 26px rgba(73, 51, 43, 0.045) !important;
    }

    .billing-hero h1 { color: #302522 !important; font-weight: 650; }
    .billing-hero p { color: #766763 !important; }

    .hero-stat,
    .status-card {
      border-color: rgba(154, 106, 96, 0.16) !important;
      background: #fff7f3 !important;
      color: #75524b !important;
    }

    .hero-stat span,
    .status-card span { color: #80645e !important; font-weight: 600; }
    .hero-stat strong,
    .status-card strong { color: #302522 !important; font-weight: 650; }

    .invoice-list-card,
    .invoice-empty-state,
    .state-message,
    .invoice-workspace,
    .message-card {
      border-color: rgba(118, 85, 76, 0.13) !important;
      background: #fff !important;
      box-shadow: 0 1px 2px rgba(41, 31, 28, 0.03), 0 10px 26px rgba(73, 51, 43, 0.045) !important;
    }

    .invoice-row {
      border-bottom-color: rgba(118, 85, 76, 0.09) !important;
    }

    .invoice-row:hover,
    .invoice-row:focus-visible {
      background: #fffaf7 !important;
      transform: translateY(-1px);
    }

    .invoice-main strong,
    .amount { color: #302522 !important; font-weight: 630; }
    .invoice-meta span,
    .invoice-main span { color: #766763 !important; font-weight: 520; }

    .status-chip {
      border-color: rgba(154, 106, 96, 0.16) !important;
      background: #fff7f3 !important;
      color: #75524b !important;
      font-weight: 620 !important;
    }
    @media (max-width: 860px) { .billing-hero, .invoice-actions { grid-template-columns: 1fr; display: grid; } .status-card { text-align: left; } }
  `],
  template: `
    <section class="invoice-detail-page inner-page-shell">
      <header class="billing-hero inner-page-header">
        <div>
          <h1>Invoice details</h1>
          <p>{{ invoice()?.invoice_no || 'Loading invoice record' }}</p>
        </div>
        <div class="status-card">
          <span>Status</span>
          <strong>{{ invoice()?.payment_status || 'Loading' }}</strong>
        </div>
      </header>

      <section class="invoice-workspace inner-page-card">
        <app-invoice-preview [invoice]="invoice()" />
        <div class="invoice-actions">
          <app-refund-modal (refund)="refund($event)" />
          <app-void-invoice-modal (voidInvoice)="voidReason.set($event)" />
        </div>
      </section>

      <p class="message-card" *ngIf="message()">{{ message() }}</p>
    </section>
  `
})
export class InvoiceDetailPageComponent implements OnInit {
  readonly invoice = signal<Invoice | null>(null);
  readonly message = signal('');
  readonly voidReason = signal('');
  private id = '';

  constructor(private readonly route: ActivatedRoute, private readonly api: BillingApi) {}

  ngOnInit(): void {
    this.id = this.route.snapshot.paramMap.get('id') || '';
    this.api.invoice(this.id).subscribe((invoice) => this.invoice.set(invoice));
  }

  refund(payload: { amount: number; reason: string }): void {
    this.api.refund(this.id, payload).subscribe(() => this.message.set('Refund workflow started'));
  }
}
