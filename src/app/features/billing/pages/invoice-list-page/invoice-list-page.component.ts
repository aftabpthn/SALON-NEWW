import { CommonModule } from '@angular/common';
import { Component, OnInit } from '@angular/core';
import { RouterLink } from '@angular/router';
import { BillingRepository } from '../../data/billing.repository';
import { AuraMoneyPipe } from '../../../../shared/pipes/aura-money.pipe';

@Component({
  selector: 'app-invoice-list-page',
  standalone: true,
  imports: [AuraMoneyPipe, CommonModule, RouterLink],
  styles: [`
    .invoice-list-page { display: grid; gap: 16px; }
    .billing-hero, .invoice-list-card, .invoice-empty-state, .state-message { border: 1px solid var(--aura-border-soft, rgba(75, 18, 56, 0.12)); border-radius: var(--aura-card-radius-premium, 14px); background: var(--aura-surface-raised, #fff); box-shadow: 0 12px 30px rgba(75, 18, 56, 0.07); }
    .billing-hero { display: flex; align-items: flex-end; justify-content: space-between; gap: 14px; padding: 18px 20px; background: linear-gradient(135deg, var(--aura-primary-hover, #6d1b4d), var(--aura-primary, #4b1238)); color: #fff; }
    .billing-hero h1 { margin: 0; color: #fff; font-size: 1.45rem; letter-spacing: 0; }
    .billing-hero p { margin: 6px 0 0; color: rgba(255, 255, 255, 0.74); }
    .hero-stat { display: grid; gap: 2px; min-width: 116px; padding: 10px 12px; border: 1px solid rgba(255, 255, 255, 0.28); border-radius: 12px; background: rgba(255, 255, 255, 0.12); text-align: right; }
    .hero-stat span { color: rgba(255, 255, 255, 0.72); font-size: 0.75rem; font-weight: 800; text-transform: uppercase; }
    .hero-stat strong { color: #fff; font-size: 1.35rem; }
    .invoice-list-card { overflow: hidden; }
    .invoice-row { display: grid; grid-template-columns: minmax(160px, 1fr) minmax(130px, auto) minmax(120px, auto) auto; gap: 14px; align-items: center; padding: 14px 16px; color: var(--aura-text, #1f2933); text-decoration: none; border-bottom: 1px solid var(--aura-border-soft, rgba(75, 18, 56, 0.12)); transition: background 160ms ease, transform 160ms ease; }
    .invoice-row:hover, .invoice-row:focus-visible { background: color-mix(in srgb, var(--aura-primary-soft, rgba(75, 18, 56, 0.1)) 64%, white 36%); outline: none; transform: translateY(-1px); }
    .invoice-row:last-child { border-bottom: 0; }
    .invoice-main, .invoice-meta { display: grid; gap: 3px; min-width: 0; }
    .invoice-main strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .invoice-meta span, .invoice-main span { color: var(--aura-muted, #6b7280); font-size: 0.78rem; font-weight: 750; }
    .amount { font-weight: 900; color: var(--aura-text, #1f2933); text-align: right; }
    .status-chip { justify-self: end; border: 1px solid color-mix(in srgb, var(--aura-primary, #4b1238) 16%, var(--aura-border-soft, rgba(75,18,56,.12))); border-radius: 999px; padding: 5px 10px; color: var(--aura-primary, #4b1238); background: color-mix(in srgb, var(--aura-primary-soft, rgba(75,18,56,.1)) 78%, white 22%); font-size: 0.75rem; font-weight: 900; text-transform: capitalize; }
    .status-chip.paid { color: var(--aura-success, #C87D4B); background: var(--aura-success-bg, rgba(200,125,75,.12)); border-color: rgba(200, 125, 75, 0.24); }
    .status-chip.due { color: var(--aura-danger, #e11d48); background: var(--aura-danger-bg, rgba(225,29,72,.12)); border-color: rgba(225, 29, 72, 0.24); }
    .invoice-empty-state, .state-message { display: grid; gap: 5px; padding: 22px; text-align: center; color: var(--aura-muted, #6b7280); }
    .state-message.error { color: var(--aura-danger, #e11d48); background: var(--aura-danger-bg, rgba(225,29,72,.12)); }

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
    @media (max-width: 720px) { .billing-hero, .invoice-row { grid-template-columns: 1fr; align-items: stretch; } .billing-hero { display: grid; } .hero-stat, .amount, .status-chip { justify-self: stretch; text-align: left; } }
  `],
  template: `
    <section class="invoice-list-page inner-page-shell">
      <header class="billing-hero inner-page-header">
        <div>
          <h1>Invoices</h1>
          <p>Review bills, payment status, and customer checkout records.</p>
        </div>
        <div class="hero-stat">
          <span>Total</span>
          <strong>{{ repo.invoices().length }}</strong>
        </div>
      </header>

      <p class="state-message" *ngIf="repo.loading()">Loading invoices...</p>
      <p class="state-message error" *ngIf="repo.error()">{{ repo.error() }}</p>

      <section class="invoice-list-card inner-page-card" *ngIf="!repo.loading() && repo.invoices().length">
        <a class="invoice-row" *ngFor="let invoice of repo.invoices()" [routerLink]="['/billing/invoices', invoice.id]">
          <span class="invoice-main">
            <strong>{{ invoice.invoice_no }}</strong>
            <span>Open invoice details</span>
          </span>
          <span class="amount">{{ invoice.grand_total | auraMoney }}</span>
          <span class="status-chip" [class.paid]="invoice.payment_status === 'paid'" [class.due]="invoice.payment_status !== 'paid'">{{ invoice.payment_status }}</span>
          <span class="invoice-meta"><span>View</span><strong>Details</strong></span>
        </a>
      </section>

      <div class="invoice-empty-state" *ngIf="!repo.loading() && !repo.invoices().length">
        <strong>No invoices found.</strong>
        <span>Completed POS checkouts and billing records will appear here.</span>
      </div>
    </section>
  `
})
export class InvoiceListPageComponent implements OnInit {
  constructor(readonly repo: BillingRepository) {}
  ngOnInit(): void {
    this.repo.loadInvoices();
  }
}
