import { CommonModule } from '@angular/common';
import { Component, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { catchError, finalize, forkJoin, of } from 'rxjs';
import { AuthSessionService } from '../core/auth-session.service';
import { grantsAllow, staticGrantsForRole } from '../core/permission.guard';
import { routePermissionForPath } from '../core/access-rules';
import { ApiRecord, ApiService } from '../core/api.service';
import { PosHeldInvoiceDraft, PosPaymentMode, PosSettingsService } from '../core/pos-settings.service';
import { AppStateService } from '../core/state/app-state.service';
import { DATE_RANGE_PRESETS, DateRangePreset, dateRangeParams, rangeForPreset, todayKey } from '../shared/date-range-presets';
import { StateComponent } from '../shared/ui/state/state.component';
import { AuraMoneyPipe } from '../shared/pipes/aura-money.pipe';

type InvoiceRegisterRow = {
  id: string;
  invoiceNumber: string;
  clientId: string;
  clientName: string;
  clientPhone: string;
  branchId: string;
  branchName: string;
  staffId: string;
  staffName: string;
  appointmentId: string;
  status: string;
  createdAt: string;
  dueDate: string;
  subtotal: number;
  discount: number;
  gst: number;
  tipTotal: number;
  total: number;
  paid: number;
  balance: number;
  paymentStatus: string;
  documentStatus: string;
  onlinePaidAmount: number;
  paymentLinkId: string;
  items: ApiRecord[];
  payments: ApiRecord[];
  tips: ApiRecord[];
  membershipRedeem?: ApiRecord;
};

type WalletClientRow = {
  id: string;
  name: string;
  phone: string;
  branchId: string;
  branchName: string;
  walletBalance: number;
  unpaidBalance: number;
  lastWalletActivity: string;
  source: string;
};

type InvoiceApprovalAction = 'delete' | 'edit';
type ProductConsumeDraftRow = {
  id: string;
  invoiceId: string;
  status: string;
};

@Component({
  selector: 'app-pos-invoices',
  standalone: true,
  imports: [AuraMoneyPipe, CommonModule, FormsModule, RouterLink, StateComponent],
  template: `
    <section class="page-stack inner-page-shell">
      <div class="module-hero inner-page-header">
        <div>
          <h2>{{ pageTitle() }}</h2>
          <p>{{ pageDescription() }}</p>
        </div>
        <div class="hero-actions">
          <a class="ghost-button" routerLink="/pos">Back to POS</a>
          <a class="ghost-button" routerLink="/reports/invoices">Invoice reports</a>
          <a class="ghost-button" routerLink="/pos/invoice-activity">Invoice activity</a>
          <a class="ghost-button" routerLink="/pos/tips">Tip register</a>
          <button class="primary-button" type="button" (click)="load()">Refresh</button>
        </div>
      </div>

      <app-state [loading]="loading()" [error]="error()"></app-state>
      <div class="state loading" *ngIf="notice()">{{ notice() }}</div>

      <ng-container *ngIf="!loading()">
        <div class="metrics-grid inner-stats-grid">
          <a class="metric-card" routerLink="/pos/invoices" [class.active-filter-card]="isAllView()"><span>Invoices</span><strong>{{ rows().length }}</strong></a>
          <article class="metric-card"><span>Total billed</span><strong>{{ billedTotal() | auraMoney:'1.0-0' }}</strong></article>
          <article class="metric-card"><span>Collected</span><strong>{{ paidTotal() | auraMoney:'1.0-0' }}</strong></article>
          <a class="metric-card" routerLink="/pos/invoices" [queryParams]="{ filter: 'received-due' }" [class.active-filter-card]="isReceivedDueView()"><span>Received due</span><strong>{{ receivedDueTotal() | auraMoney:'1.0-0' }}</strong></a>
          <a class="metric-card" routerLink="/pos/invoices" [queryParams]="{ filter: 'due' }" [class.active-filter-card]="isDueView()"><span>Due</span><strong>{{ dueTotal() | auraMoney:'1.0-0' }}</strong></a>
          <a class="metric-card" routerLink="/pos/invoices" [queryParams]="{ filter: 'wallet' }" [class.active-filter-card]="isWalletView()"><span>Wallet</span><strong>{{ walletTotal() | auraMoney:'1.0-0' }}</strong><small>{{ walletClientCount() }} clients with balance</small></a>
        </div>

        <section class="billing-control-strip">
          <div class="section-title">
            <div>
              <h2>Payment truth, GST, margin and fraud checks</h2>
            </div>
            <a class="ghost-button mini" routerLink="/pos/invoice-activity">Audit trail</a>
          </div>
          <div class="billing-control-grid">
            <a class="billing-control-card" routerLink="/pos/invoice-activity">
              <span>Payment truth</span>
              <strong>{{ paymentTruthScore() }}%</strong>
              <small>{{ paymentTruthLabel() }}</small>
            </a>
            <a class="billing-control-card" routerLink="/pos/invoices" [queryParams]="{ filter: 'due' }" [class.warn]="dueTotal() > 0">
              <span>Settlement</span>
              <strong>{{ settlementCollectedTotal() | auraMoney:'1.0-0' }}</strong>
              <small>Advance {{ bookingAdvanceAdjustedTotal() | auraMoney:'1.0-0' }} · Due {{ dueTotal() | auraMoney:'1.0-0' }}</small>
            </a>
            <a class="billing-control-card" routerLink="/reports/invoices">
              <span>GST reports</span>
              <strong>{{ gstCollectedTotal() | auraMoney:'1.0-0' }}</strong>
            </a>
            <a class="billing-control-card" routerLink="/inventory/financial">
              <span>Margin view</span>
              <strong>{{ marginGrossTotal() | auraMoney:'1.0-0' }}</strong>
              <small>{{ marginPercentLabel() }} gross margin from billing analytics</small>
            </a>
            <a class="billing-control-card" routerLink="/command-center/payment-intelligence" [class.warn]="fraudFlagCount() > 0">
              <span>Fraud flags</span>
              <strong>{{ fraudFlagCount() }}</strong>
              <small>{{ amountAtRisk() | auraMoney:'1.0-0' }} amount at risk</small>
            </a>
            <a class="billing-control-card" routerLink="/inventory/product-consume" [class.warn]="consumePendingCount() > 0">
              <span>Inventory/profit</span>
              <strong>{{ consumePendingCount() }}</strong>
            </a>
          </div>
        </section>

        <div class="split-layout invoice-register-layout">
          <section class="panel inner-page-card">
            <div class="table-toolbar inner-action-bar">
              <label class="search-field">
                <span>Search invoice or client</span>
                <input [(ngModel)]="query" placeholder="AURA-2026, client name, phone, staff" />
              </label>
              <label class="field fit-field date-filter-field" *ngIf="datePreset !== 'all'">
                <span>From</span>
                <input type="date" [ngModel]="dateRange.from" (ngModelChange)="updateCustomDate('from', $event)" />
              </label>
              <label class="field fit-field date-filter-field" *ngIf="datePreset !== 'today' && datePreset !== 'all'">
                <span>To</span>
                <input type="date" [ngModel]="dateRange.to" (ngModelChange)="updateCustomDate('to', $event)" />
              </label>
              <div class="date-filter-actions">
                <button
                  class="ghost-button mini"
                  type="button"
                  *ngFor="let preset of datePresets"
                  [class.active-filter-card]="datePreset === preset.value"
                  (click)="applyDatePreset(preset.value)"
                >
                  {{ preset.label }}
                </button>
              </div>
              <label class="field fit-field">
                <span>Status</span>
                <select [(ngModel)]="statusFilter">
                  <option value="">All</option>
                  <option value="paid">Paid</option>
                  <option value="partial">Partial</option>
                  <option value="unpaid">Unpaid</option>
                </select>
              </label>
            </div>

            <div class="active-filter-strip" *ngIf="isFilteredView()">
              <strong>{{ activeFilterTitle() }}</strong>
              <span>{{ activeFilterDescription() }}</span>
              <a class="ghost-button mini" routerLink="/pos/invoices">All invoices</a>
            </div>

            <div class="date-register-summary">
              <div>
                <span class="eyebrow">{{ summaryEyebrow() }}</span>
                <strong>{{ selectedDateLabel() }}</strong>
              </div>
              <div><span>{{ isWalletView() ? 'Clients' : 'Invoices' }}</span><strong>{{ isWalletView() ? filteredWalletClients().length : filteredRows().length }}</strong></div>
              <div><span>Billed</span><strong>{{ billedTotal() | auraMoney:'1.0-0' }}</strong></div>
              <div><span>Collected</span><strong>{{ paidTotal() | auraMoney:'1.0-0' }}</strong></div>
              <div><span>Received due</span><strong>{{ receivedDueTotal() | auraMoney:'1.0-0' }}</strong></div>
              <div><span>Due</span><strong>{{ dueTotal() | auraMoney:'1.0-0' }}</strong></div>
              <div><span>Wallet</span><strong>{{ walletTotal() | auraMoney:'1.0-0' }}</strong></div>
            </div>

            <div class="table-wrap" *ngIf="isWalletView(); else invoiceRegisterTable">
              <table>
                <thead>
                  <tr>
                    <th>Client</th>
                    <th>Phone</th>
                    <th>Branch</th>
                    <th class="right">Wallet balance</th>
                    <th class="right">Due</th>
                    <th>Last wallet activity</th>
                    <th>Source</th>
                    <th class="right">Action</th>
                  </tr>
                </thead>
                <tbody>
                  <tr *ngFor="let client of filteredWalletClients()">
                    <td><strong>{{ client.name }}</strong></td>
                    <td>{{ client.phone || '-' }}</td>
                    <td>{{ client.branchName }}</td>
                    <td class="right invoice-paid-amount">{{ client.walletBalance | auraMoney:'1.0-0' }}</td>
                    <td class="right invoice-due-amount">{{ client.unpaidBalance | auraMoney:'1.0-0' }}</td>
                    <td>{{ dateTimeLabel(client.lastWalletActivity) }}</td>
                    <td><span class="badge">{{ client.source }}</span></td>
                    <td class="right">
                      <button class="ghost-button mini" type="button" (click)="openWalletClient(client)">Open client</button>
                      <button class="ghost-button mini" type="button" (click)="openWalletRedemption(client)" *ngIf="canAccessPath('/pos')">Open POS</button>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p class="inline-hint" *ngIf="isWalletView() && !filteredWalletClients().length">
              No client wallet balance found for this branch/search.
            </p>

            <ng-template #invoiceRegisterTable>
            <div class="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Invoice</th>
                    <th>Date</th>
                    <th>Client</th>
                    <th>Staff</th>
                    <th>Payment mode</th>
                    <th class="right">Total</th>
                    <th class="right">Paid</th>
                    <th class="right">Due</th>
                    <th>Status</th>
                    <th class="right">Action</th>
                  </tr>
                </thead>
                <tbody>
                  <tr *ngFor="let row of filteredRows()" class="click-row" [class.selected-row]="selected()?.id === row.id">
                    <td>
                      <button class="table-link" type="button" (click)="openDetail(row)">
                        <strong>{{ row.invoiceNumber }}</strong>
                      </button>
                      <small class="row-subcopy">{{ settlementSnippet(row) }}</small>
                      <small class="received-due-row" *ngIf="receivedDueSummary(row) as dueSummary">{{ dueSummary }}</small>
                      <small class="queue-preview-chip" *ngIf="whatsappQueuePreview(row) as preview">WA queued: {{ preview }}</small>
                    </td>
                    <td>{{ dateTimeLabel(row.createdAt) }}</td>
                    <td>
                      <button class="table-link invoice-client-button" type="button" (click)="openClientCrm(row, $event)">
                        {{ row.clientName }}
                        <small *ngIf="row.clientPhone">{{ row.clientPhone }}</small>
                      </button>
                    </td>
                    <td>{{ row.staffName }}</td>
                    <td>
                      <div class="payment-mode-chips" *ngIf="paymentModeSummary(row).length; else noPaymentModes">
                        <span
                          class="payment-mode-chip"
                          [ngClass]="paymentModeClass(paymentMode.mode)"
                          *ngFor="let paymentMode of paymentModeSummary(row)"
                        >
                          {{ paymentMode.label }}
                          <small>{{ paymentMode.amount | auraMoney:'1.0-0' }}</small>
                        </span>
                      </div>
                      <ng-template #noPaymentModes>
                        <span class="muted">No payment</span>
                      </ng-template>
                    </td>
                    <td class="right invoice-total-amount">{{ row.total | auraMoney:'1.0-0' }}</td>
                    <td class="right invoice-paid-amount">{{ row.paid | auraMoney:'1.0-0' }}</td>
                    <td class="right invoice-due-amount">{{ row.balance | auraMoney:'1.0-0' }}</td>
                    <td><span class="badge">{{ row.status }}</span></td>
              <td class="right invoice-action-cell">
                <div class="invoice-actions invoice-actions--saved">
                  <button
                    class="ghost-button mini invoice-edit-button"
                    type="button"
                    [disabled]="approvalRequesting() === row.id"
                    (click)="editInvoice(row, $event)"
                  >
                    {{ editActionLabel(row) }}
                  </button>
                  <button
                    class="ghost-button mini"
                    type="button"
                    *ngIf="requiresAdjustmentNote(row)"
                    [disabled]="adjustmentSaving() === row.id"
                    (click)="openAdjustmentNote(row, $event)"
                  >
                    Adjustment note
                  </button>
                  <a
                    class="ghost-button mini"
                    *ngIf="productConsumeStatus(row)"
                    routerLink="/inventory/product-consume"
                    [title]="'Product consume: ' + productConsumeStatus(row)"
                    (click)="$event.stopPropagation()"
                  >
                    {{ productConsumeStatus(row) }}
                  </a>
                  <button
                    class="ghost-button mini"
                    type="button"
                    *ngIf="!productConsumeStatus(row) && serviceItems(row).length"
                    (click)="createProductConsumeDraft(row, $event)"
                  >
                    Create consume
                  </button>
                  <button
                    class="ghost-button mini danger invoice-delete-button"
                    style="min-width: 72px; color: var(--red); border-color: rgba(180, 35, 24, 0.34); background: #fff;"
                    type="button"
                    [disabled]="approvalRequesting() === row.id || !canRequestDelete()"
                    [title]="canRequestDelete() ? 'Manager approval required before soft delete' : 'Your role cannot request invoice deletion'"
                    (click)="deleteInvoice(row, $event)"
                  >
                    {{ approvalRequesting() === row.id ? 'Requesting' : 'Request delete' }}
                  </button>
                  <button
                    class="ghost-button mini whatsapp-pdf-button"
                    type="button"
                    [disabled]="whatsappActionLoading() === row.id"
                    [title]="whatsappSummaryTooltip(row)"
                    (click)="sendInvoicePdfWhatsapp(row, $event)"
                  >
                    {{ whatsappActionLoading() === row.id ? 'Sending' : 'WhatsApp PDF' }}
                  </button>
                  <button class="ghost-button mini" type="button" *ngIf="row.balance > 0" (click)="receiveDue(row, $event)">Receive due</button>
                </div>
              </td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p class="inline-hint" *ngIf="!filteredRows().length">
              No saved invoice found. Use All dates or search by client phone to find older invoices.
            </p>
            </ng-template>
          </section>
        </div>

        <div class="floating-detail-backdrop" *ngIf="selected() as invoice" (click)="closeDetail()">
          <section class="panel floating-detail-card invoice-detail-panel" (click)="$event.stopPropagation()">
            <div class="section-title">
              <div>
                <h2>{{ invoice.invoiceNumber }}</h2>
                <a
                  class="consume-status-link"
                  *ngIf="productConsumeStatus(invoice)"
                  routerLink="/inventory/product-consume"
                >
                  Product consume {{ productConsumeStatus(invoice) }}
                </a>
              </div>
              <div class="hero-actions">
              <button
                class="ghost-button danger invoice-delete-button"
                type="button"
                [disabled]="approvalRequesting() === invoice.id || !canRequestDelete()"
                [title]="canRequestDelete() ? 'Manager approval required before soft delete' : 'Your role cannot request invoice deletion'"
                (click)="deleteInvoice(invoice)"
              >
                {{ approvalRequesting() === invoice.id ? 'Requesting approval' : 'Request delete' }}
              </button>
              <button
                class="primary-button"
                type="button"
                [disabled]="approvalRequesting() === invoice.id"
                (click)="editInvoice(invoice)"
              >
                {{ editActionLabel(invoice) }}
              </button>
              <button
                class="ghost-button mini"
                type="button"
                *ngIf="requiresAdjustmentNote(invoice)"
                [disabled]="adjustmentSaving() === invoice.id"
                (click)="openAdjustmentNote(invoice)"
              >
                Adjustment note
              </button>
                <button
                  class="ghost-button mini whatsapp-pdf-button"
                  type="button"
                  [disabled]="whatsappActionLoading() === invoice.id"
                  [title]="whatsappSummaryTooltip(invoice)"
                  (click)="sendInvoicePdfWhatsapp(invoice)"
                >
                  {{ whatsappActionLoading() === invoice.id ? 'Sending PDF' : 'WhatsApp PDF' }}
                </button>
                <button class="ghost-button mini" type="button" (click)="downloadInvoice(invoice)">A4 PDF</button>
                <button class="ghost-button mini" type="button" *ngIf="!productConsumeStatus(invoice) && serviceItems(invoice).length" (click)="createProductConsumeDraft(invoice)">
                  Create consume
                </button>
                <button class="ghost-button mini" type="button" (click)="closeDetail()">Close</button>
              </div>
            </div>

            <div class="info-grid compact-info">
              <div><span>Client</span><strong>{{ invoice.clientName }}</strong></div>
              <div><span>Branch</span><strong>{{ invoice.branchName }}</strong></div>
              <div><span>Staff</span><strong>{{ invoice.staffName }}</strong></div>
              <div><span>Date</span><strong>{{ dateTimeLabel(invoice.createdAt) }}</strong></div>
            </div>

            <h3>Services</h3>
            <div class="invoice-line-table-wrap" *ngIf="serviceItems(invoice).length; else noServiceLines">
              <table class="invoice-line-table">
                <thead>
                  <tr>
                    <th>Service</th>
                    <th>Staff</th>
                    <th class="right">Qty</th>
                    <th class="right">Rate</th>
                    <th class="right">Discount</th>
                    <th class="right">Taxable</th>
                    <th class="right">GST</th>
                    <th class="right">GST Amt</th>
                    <th class="right">Final</th>
                  </tr>
                </thead>
                <tbody>
                  <tr *ngFor="let row of serviceItemRows(invoice)">
                    <td>
                      <strong>{{ itemName(row.item) }}</strong>
                      <small>{{ itemTypeLabel(row.item) }}</small>
                      <small *ngIf="serviceLineBenefitSummary(invoice, row.item, row.lineIndex) as benefitLine">{{ benefitLine }}</small>
                    </td>
                    <td>{{ itemStaffName(row.item, invoice) }}</td>
                    <td class="right">{{ itemQuantity(row.item) }}</td>
                    <td class="right">{{ lineRate(row.item) | auraMoney:'1.0-0' }}</td>
                    <td class="right">{{ lineDiscount(invoice, row.item) | auraMoney:'1.0-0' }}</td>
                    <td class="right">{{ lineTaxable(invoice, row.item) | auraMoney:'1.0-0' }}</td>
                    <td class="right">{{ lineGstRate(row.item) }}%</td>
                    <td class="right">{{ lineGstAmount(invoice, row.item) | auraMoney:'1.0-0' }}</td>
                    <td class="right line-final">{{ lineFinal(invoice, row.item) | auraMoney:'1.0-0' }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <ng-template #noServiceLines>
              <p class="inline-hint" *ngIf="!serviceItems(invoice).length">No services on this invoice.</p>
            </ng-template>
            <div class="detail-list" *ngIf="invoiceBenefitSummaryLines(invoice).length">
              <article *ngFor="let line of invoiceBenefitSummaryLines(invoice)">
                <div>
                  <strong>{{ line.serviceName }}</strong>
                  <span>{{ line.benefitName }}</span>
                </div>
                <strong>{{ line.credits }} credits</strong>
              </article>
            </div>

            <h3>Products</h3>
            <div class="invoice-line-table-wrap" *ngIf="productItems(invoice).length; else noProductLines">
              <table class="invoice-line-table">
                <thead>
                  <tr>
                    <th>Product</th>
                    <th>Staff</th>
                    <th class="right">Qty</th>
                    <th class="right">Rate</th>
                    <th class="right">Discount</th>
                    <th class="right">Taxable</th>
                    <th class="right">GST</th>
                    <th class="right">GST Amt</th>
                    <th class="right">Final</th>
                  </tr>
                </thead>
                <tbody>
                  <tr *ngFor="let item of productItems(invoice)">
                    <td>
                      <strong>{{ itemName(item) }}</strong>
                      <small>{{ itemTypeLabel(item) }}</small>
                    </td>
                    <td>{{ itemStaffName(item, invoice) }}</td>
                    <td class="right">{{ itemQuantity(item) }}</td>
                    <td class="right">{{ lineRate(item) | auraMoney:'1.0-0' }}</td>
                    <td class="right">{{ lineDiscount(invoice, item) | auraMoney:'1.0-0' }}</td>
                    <td class="right">{{ lineTaxable(invoice, item) | auraMoney:'1.0-0' }}</td>
                    <td class="right">{{ lineGstRate(item) }}%</td>
                    <td class="right">{{ lineGstAmount(invoice, item) | auraMoney:'1.0-0' }}</td>
                    <td class="right line-final">{{ lineFinal(invoice, item) | auraMoney:'1.0-0' }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <ng-template #noProductLines>
              <p class="inline-hint" *ngIf="!productItems(invoice).length">No products on this invoice.</p>
            </ng-template>

            <ng-container *ngIf="otherItems(invoice).length">
              <h3>Other items</h3>
              <div class="invoice-line-table-wrap">
                <table class="invoice-line-table">
                  <thead>
                    <tr>
                      <th>Item</th>
                      <th>Staff</th>
                      <th class="right">Qty</th>
                      <th class="right">Rate</th>
                      <th class="right">Discount</th>
                      <th class="right">Taxable</th>
                      <th class="right">GST</th>
                      <th class="right">GST Amt</th>
                      <th class="right">Final</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr *ngFor="let item of otherItems(invoice)">
                      <td>
                        <strong>{{ itemName(item) }}</strong>
                        <small>{{ itemTypeLabel(item) }}</small>
                      </td>
                      <td>{{ itemStaffName(item, invoice) }}</td>
                      <td class="right">{{ itemQuantity(item) }}</td>
                      <td class="right">{{ lineRate(item) | auraMoney:'1.0-0' }}</td>
                      <td class="right">{{ lineDiscount(invoice, item) | auraMoney:'1.0-0' }}</td>
                      <td class="right">{{ lineTaxable(invoice, item) | auraMoney:'1.0-0' }}</td>
                      <td class="right">{{ lineGstRate(item) }}%</td>
                      <td class="right">{{ lineGstAmount(invoice, item) | auraMoney:'1.0-0' }}</td>
                      <td class="right line-final">{{ lineFinal(invoice, item) | auraMoney:'1.0-0' }}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </ng-container>

            <h3>Tips</h3>
            <div class="detail-list">
              <article *ngFor="let tip of invoice.tips">
                <div>
                  <strong>{{ tip.staffName || tip.staffId }}</strong>
                  <span>{{ modeLabel(tip.paymentMode || 'cash') }}</span>
                </div>
                <strong>{{ tip.amount | auraMoney:'1.0-0' }}</strong>
              </article>
              <p class="inline-hint" *ngIf="!invoice.tips.length">No tips on this invoice.</p>
            </div>

            <h3>Payment split</h3>
            <div class="detail-list">
              <article *ngFor="let payment of invoice.payments">
                <div>
                  <strong>{{ modeLabel(payment.mode) }}</strong>
                  <span>{{ payment.reference || 'Counter collection' }}</span>
                  <span class="muted">{{ dateTimeLabel(payment.createdAt || payment.created_at) }}</span>
                </div>
                <strong>{{ payment.amount | auraMoney:'1.0-0' }}</strong>
              </article>
              <p class="inline-hint" *ngIf="!invoice.payments.length">No payment collected yet.</p>
            </div>

            <ng-container *ngIf="receivedDueLines(invoice).length">
              <h3>Received due history</h3>
              <div class="invoice-line-table-wrap">
                <table class="invoice-line-table">
                  <thead>
                    <tr>
                      <th>Invoice</th>
                      <th>Due date</th>
                      <th>Received date</th>
                      <th>Mode</th>
                      <th>Received by</th>
                      <th>Payment ID</th>
                      <th>Reference</th>
                      <th class="right">Days</th>
                      <th class="right">Due received</th>
                      <th class="right">Pending after</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr *ngFor="let line of receivedDueLines(invoice)">
                      <td>
                        <strong>{{ line.invoiceNumber }}</strong>
                        <small>{{ line.reference }}</small>
                      </td>
                      <td>{{ dateTimeLabel(line.dueDate) }}</td>
                      <td>{{ dateTimeLabel(line.receivedDate) }}</td>
                      <td>{{ modeLabel(line.mode) }}</td>
                      <td>{{ line.receivedBy }}</td>
                      <td>{{ line.settlementPaymentId || '-' }}</td>
                      <td>{{ line.paymentReference || '-' }}</td>
                      <td class="right">{{ line.daysToRecovery }}</td>
                      <td class="right invoice-paid-amount">{{ line.amount | auraMoney:'1.0-0' }}</td>
                      <td class="right invoice-due-amount">{{ line.pendingAfter | auraMoney:'1.0-0' }}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </ng-container>

            <h3>Online payment collection</h3>
            <app-state [loading]="paymentActionLoading().startsWith(invoice.id)" [error]="paymentError()"></app-state>
            <div class="info-grid compact-info">
              <div><span>Payment status</span><strong>{{ invoice.status || invoice.paymentStatus }}</strong></div>
              <div><span>Invoice state</span><strong>{{ invoice.documentStatus || '-' }}</strong></div>
              <div><span>Online paid</span><strong>{{ invoice.onlinePaidAmount | auraMoney:'1.0-0' }}</strong></div>
              <div><span>Payment link</span><strong>{{ invoice.paymentLinkId || latestPaymentLinkId() || 'Not created' }}</strong></div>
              <div><span>Due before send</span><strong>{{ invoice.balance | auraMoney:'1.0-0' }}</strong></div>
            </div>
            <div class="hero-actions">
              <button class="primary-button" type="button" *ngIf="invoice.balance > 0" [disabled]="paymentActionLoading().startsWith(invoice.id)" (click)="createPaymentLink(invoice)">
                Create payment link
              </button>
              <button class="ghost-button" type="button" *ngIf="invoice.balance > 0" [disabled]="paymentActionLoading().startsWith(invoice.id)" (click)="sendPaymentReminder(invoice)">
                Send WhatsApp reminder
              </button>
              <button class="ghost-button" type="button" [disabled]="paymentActionLoading().startsWith(invoice.id)" (click)="reconcilePayment(invoice)">
                Reconcile
              </button>
            </div>
            <div class="detail-list" *ngIf="paymentTimeline() as collection">
              <article *ngIf="advanceAmount(collection.invoice || {}) > 0 || advancePendingAmount(collection.invoice || {}) > 0">
                <div>
                  <strong>Booking advance · {{ collection.invoice?.bookingAdvanceStatus || 'not_required' }}</strong>
                  <span>Advance is tracked separately from invoice settlement.</span>
                </div>
                <strong>{{ advanceAmount(collection.invoice || {}) | auraMoney:'1.0-0' }}</strong>
              </article>
              <article *ngFor="let link of collection.links || []">
                <div>
                  <strong>{{ link.provider || 'razorpay' }} · {{ link.status }}</strong>
                  <span>{{ link.providerLinkId }} · expires {{ dateTimeLabel(link.expiresAt) }}</span>
                  <span class="muted">{{ link.paymentLink }}</span>
                </div>
                <strong>{{ link.amount | auraMoney:'1.0-0' }}</strong>
              </article>
              <article *ngFor="let event of collection.events || []">
                <div>
                  <strong>{{ event.event_type || event.eventType }}</strong>
                  <span>{{ event.message || event.status }} · {{ dateTimeLabel(event.created_at || event.createdAt) }}</span>
                </div>
                <strong>{{ event.amount | auraMoney:'1.0-0' }}</strong>
              </article>
              <p class="inline-hint" *ngIf="!(collection.links || []).length && !(collection.events || []).length">No online payment timeline yet.</p>
            </div>

            <div class="settlement-breakdown">
              <article class="settlement-card">
                <span>Booking advance adjusted</span>
                <strong>{{ bookingAdvanceAdjustedAmount(invoice) | auraMoney:'1.0-0' }}</strong>
              </article>
              <article class="settlement-card">
                <span>Counter payment collected</span>
                <strong>{{ counterPaymentCollectedAmount(invoice) | auraMoney:'1.0-0' }}</strong>
              </article>
              <article class="settlement-card" [class.is-due]="remainingCounterPaymentAmount(invoice) > 0">
                <span>Remaining counter payment</span>
                <strong>{{ remainingCounterPaymentAmount(invoice) | auraMoney:'1.0-0' }}</strong>
                <small *ngIf="remainingCounterPaymentAmount(invoice) > 0">Abhi itna aur collect karna baaki hai.</small>
                <small *ngIf="remainingCounterPaymentAmount(invoice) <= 0">Invoice settlement complete hai.</small>
              </article>
            </div>

            <div class="summary-lines">
              <div><span>Booking advance paid</span><strong>{{ advanceAmount(paymentTimeline()?.invoice || {}) | auraMoney:'1.0-0' }}</strong></div>
              <div><span>Booking advance pending</span><strong>{{ advancePendingAmount(paymentTimeline()?.invoice || {}) | auraMoney:'1.0-0' }}</strong></div>
              <div><span>Booking advance adjusted</span><strong>{{ bookingAdvanceAdjustedAmount(invoice) | auraMoney:'1.0-0' }}</strong></div>
              <div><span>Counter payment collected</span><strong>{{ counterPaymentCollectedAmount(invoice) | auraMoney:'1.0-0' }}</strong></div>
              <div><span>Remaining counter payment</span><strong>{{ remainingCounterPaymentAmount(invoice) | auraMoney:'1.0-0' }}</strong></div>
              <div *ngIf="invoiceBenefitCreditsUsedCount(invoice) > 0"><span>Package/member credits used</span><strong>{{ invoiceBenefitCreditsUsed(invoice) }}</strong></div>
              <div *ngIf="invoiceBenefitCreditsUsedCount(invoice) > 0"><span>Benefit balance left</span><strong>{{ invoiceBenefitRemaining(invoice) }}</strong></div>
              <div><span>Subtotal</span><strong>{{ invoice.subtotal | auraMoney:'1.0-0' }}</strong></div>
              <div><span>Discount</span><strong>{{ invoice.discount | auraMoney:'1.0-0' }}</strong></div>
              <div><span>Discount rate</span><strong>{{ invoiceDiscountRate(invoice) }}%</strong></div>
              <div><span>Taxable value</span><strong>{{ invoiceTaxableTotal(invoice) | auraMoney:'1.0-0' }}</strong></div>
              <div><span>GST</span><strong>{{ invoice.gst | auraMoney:'1.0-0' }}</strong></div>
              <div><span>Tips</span><strong>{{ invoice.tipTotal | auraMoney:'1.0-0' }}</strong></div>
              <div class="total"><span>Total</span><strong>{{ invoice.total | auraMoney:'1.0-0' }}</strong></div>
              <div><span>Paid</span><strong>{{ invoice.paid | auraMoney:'1.0-0' }}</strong></div>
              <div [class.total]="invoice.balance > 0"><span>Due</span><strong>{{ invoice.balance | auraMoney:'1.0-0' }}</strong></div>
            </div>
          </section>
        </div>
      </ng-container>

      <div class="floating-detail-backdrop" *ngIf="approvalDialog() as request" (click)="closeApprovalDialog()">
        <section class="panel floating-detail-card invoice-detail-panel" (click)="$event.stopPropagation()">
          <div class="section-title">
            <div>
              <h2>{{ approvalActionTitle(request.action) }}</h2>
              <p>{{ request.invoice.invoiceNumber }} · {{ request.invoice.clientName }} · {{ request.invoice.total | auraMoney:'1.0-0' }}</p>
            </div>
            <button class="ghost-button mini" type="button" (click)="closeApprovalDialog()">Close</button>
          </div>

          <app-state [loading]="approvalRequesting() === request.invoice.id" [error]="approvalError()"></app-state>

          <div class="info-grid compact-info">
            <div><span>Policy</span><strong>{{ approvalPolicyLabel(request.action, request.invoice) }}</strong></div>
            <div><span>Status</span><strong>Pending request</strong></div>
            <div><span>Branch</span><strong>{{ request.invoice.branchName }}</strong></div>
            <div><span>Due</span><strong>{{ request.invoice.balance | auraMoney:'1.0-0' }}</strong></div>
          </div>

          <label class="field">
            <span>{{ request.action === 'delete' ? 'Delete reason' : 'Edit approval reason' }}</span>
            <textarea rows="3" [(ngModel)]="approvalReason" placeholder="Enter manager-visible reason"></textarea>
          </label>
          <label class="field">
            <span>Owner PIN/password</span>
            <input type="password" [(ngModel)]="ownerPin" autocomplete="off" placeholder="Required for sensitive invoice action" />
          </label>

          <div class="hero-actions">
            <button class="ghost-button" type="button" (click)="closeApprovalDialog()">Cancel</button>
            <button class="primary-button" type="button" (click)="submitApprovalRequest()" [disabled]="approvalRequesting() === request.invoice.id">
              {{ approvalRequesting() === request.invoice.id ? 'Sending request' : approvalSubmitLabel(request.action) }}
            </button>
          </div>
        </section>
      </div>

      <div class="floating-detail-backdrop" *ngIf="adjustmentDialog() as request" (click)="closeAdjustmentDialog()">
        <section class="panel floating-detail-card invoice-detail-panel" (click)="$event.stopPropagation()">
          <div class="section-title">
            <div>
              <h2>Adjustment note</h2>
              <p>{{ request.invoice.invoiceNumber }} · direct edit locked for closed invoices</p>
            </div>
            <button class="ghost-button mini" type="button" (click)="closeAdjustmentDialog()">Close</button>
          </div>

          <app-state [loading]="adjustmentSaving() === request.invoice.id" [error]="adjustmentError()"></app-state>

          <div class="info-grid compact-info">
            <div><span>Invoice status</span><strong>{{ request.invoice.status }}</strong></div>
            <div><span>Branch</span><strong>{{ request.invoice.branchName }}</strong></div>
            <div><span>Invoice date</span><strong>{{ dateLabel(request.invoice.createdAt) }}</strong></div>
            <div><span>Original total</span><strong>{{ request.invoice.total | auraMoney:'1.0-0' }}</strong></div>
          </div>

          <label class="field">
            <span>Adjustment type</span>
            <select [(ngModel)]="adjustmentType">
              <option value="adjustment_note">Adjustment note</option>
              <option value="credit_note">Credit note required</option>
              <option value="payment_correction">Payment correction note</option>
            </select>
          </label>
          <label class="field">
            <span>Adjustment amount</span>
            <input type="number" min="0" [(ngModel)]="adjustmentAmount" placeholder="0" />
          </label>
          <label class="field">
            <span>Reason</span>
            <textarea rows="3" [(ngModel)]="adjustmentReason" placeholder="Reason is mandatory for closed invoice adjustment"></textarea>
          </label>

          <div class="hero-actions">
            <button class="ghost-button" type="button" (click)="closeAdjustmentDialog()">Cancel</button>
            <button class="primary-button" type="button" (click)="submitAdjustmentNote()" [disabled]="adjustmentSaving() === request.invoice.id">
              {{ adjustmentSaving() === request.invoice.id ? 'Recording note' : 'Record adjustment note' }}
            </button>
          </div>
        </section>
      </div>
    </section>
  `,
  styles: [`
    .invoice-line-table-wrap {
      border: 1px solid rgba(75, 18, 56, 0.16);
      border-radius: 10px;
      overflow-x: auto;
      background: #fff;
      margin-bottom: 18px;
    }

    .invoice-line-table {
      width: 100%;
      min-width: 860px;
      border-collapse: collapse;
      font-size: 13px;
    }

    .invoice-line-table th,
    .invoice-line-table td {
      padding: 12px 10px;
      border-bottom: 1px solid rgba(15, 23, 42, 0.08);
      vertical-align: top;
      white-space: nowrap;
    }

    .invoice-line-table th {
      color: #64748b;
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0;
      background: #f8fafc;
    }

    .invoice-line-table td:first-child,
    .invoice-line-table th:first-child {
      min-width: 190px;
      white-space: normal;
    }

    .invoice-line-table strong {
      display: block;
      color: #0f172a;
      font-size: 14px;
    }

    .invoice-line-table small {
      display: block;
      color: #64748b;
      margin-top: 4px;
    }

    .invoice-line-table tr:last-child td {
      border-bottom: 0;
    }

    .invoice-line-table .right {
      text-align: right;
    }

    .invoice-line-table .line-final {
      color: #4B1238;
      font-weight: 800;
    }

    .settlement-breakdown {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 12px;
      margin: 18px 0;
    }

    .settlement-card {
      border: 1px solid rgba(75, 18, 56, 0.18);
      border-radius: 10px;
      padding: 14px;
      background: linear-gradient(180deg, rgba(248, 238, 244, 0.96), rgba(255, 255, 255, 0.98));
      display: grid;
      gap: 6px;
    }

    .settlement-card span {
      color: #4B1238;
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
    }

    .settlement-card strong {
      color: #0f172a;
      font-size: 22px;
      line-height: 1.1;
    }

    .settlement-card small {
      color: #475569;
      line-height: 1.4;
    }

    .settlement-card.is-due {
      border-color: rgba(220, 38, 38, 0.24);
      background: linear-gradient(180deg, rgba(248, 238, 244, 0.98), rgba(255, 255, 255, 0.98));
    }

    .settlement-card.is-due span {
      color: #b91c1c;
    }

    .row-subcopy,
    .queue-preview-chip {
      display: block;
      margin-top: 4px;
      line-height: 1.4;
    }

    .row-subcopy {
      color: #475569;
      white-space: normal;
    }

    .received-due-row {
      display: block;
      width: fit-content;
      max-width: 100%;
      margin-top: 6px;
      padding: 5px 8px;
      border: 1px solid rgba(14, 116, 144, 0.24);
      border-radius: 999px;
      background: #ecfeff;
      color: #0e7490;
      font-weight: 800;
      line-height: 1.35;
      white-space: normal;
    }

    .queue-preview-chip {
      color: #4B1238;
      font-weight: 700;
      white-space: normal;
    }

    .invoice-action-cell {
      min-width: 300px;
      white-space: normal;
    }

    .invoice-actions {
      display: flex;
      flex-wrap: wrap;
      justify-content: flex-end;
      align-items: center;
      gap: 8px;
      min-width: 280px;
    }

    .invoice-edit-button {
      border-color: rgba(75, 18, 56, 0.35);
      background: #F5EEF2;
      color: #4B1238;
      font-weight: 800;
    }

    .billing-control-strip {
      border: 1px solid rgba(75, 18, 56, 0.18);
      border-radius: 10px;
      padding: 14px;
      background: #fff;
      display: grid;
      gap: 12px;
      box-shadow: 0 12px 30px rgba(15, 23, 42, 0.05);
    }

    .billing-control-strip p {
      margin: 4px 0 0;
      color: #475569;
      line-height: 1.45;
    }

    .billing-control-grid {
      display: grid;
      grid-template-columns: repeat(6, minmax(0, 1fr));
      gap: 10px;
    }

    .billing-control-card {
      border: 1px solid rgba(75, 18, 56, 0.16);
      border-radius: 8px;
      padding: 12px;
      background: #f8fffd;
      display: grid;
      gap: 6px;
      color: #0f172a;
      text-decoration: none;
      min-width: 0;
    }

    .billing-control-card.warn {
      border-color: rgba(220, 104, 3, 0.28);
      background: #fffaf0;
    }

    .billing-control-card span {
      color: #4B1238;
      font-size: 11px;
      font-weight: 800;
      text-transform: uppercase;
    }

    .billing-control-card strong {
      font-size: 22px;
      line-height: 1.1;
      overflow-wrap: anywhere;
    }

    .billing-control-card small {
      color: #475569;
      line-height: 1.35;
    }


    :host .module-hero,
    :host .metrics-grid .metric-card,
    :host .billing-control-strip,
    :host .billing-control-card,
    :host .invoice-register-layout > .panel,
    :host .date-register-summary,
    :host .active-filter-strip,
    :host .table-wrap,
    :host .invoice-detail-panel {
      border-color: rgba(118, 85, 76, 0.13) !important;
      border-radius: 14px !important;
      background: #fff !important;
      background-image: none !important;
      box-shadow: 0 1px 2px rgba(41, 31, 28, 0.03), 0 10px 26px rgba(73, 51, 43, 0.045) !important;
    }

    :host .module-hero {
      align-items: center;
      padding: 18px 20px;
    }

    :host .module-hero h2,
    :host .section-title h2,
    :host .metric-card strong,
    :host .billing-control-card strong,
    :host .date-register-summary strong,
    :host .table-link strong {
      color: #302522 !important;
      font-weight: 630 !important;
    }

    :host .module-hero p,
    :host .metric-card span,
    :host .billing-control-card span,
    :host .billing-control-card small,
    :host .date-register-summary span,
    :host .row-subcopy,
    :host .muted {
      color: #766763 !important;
      font-weight: 520 !important;
    }

    :host .metrics-grid .metric-card,
    :host .billing-control-card,
    :host .date-register-summary > div {
      border-left: 3px solid rgba(154, 106, 96, 0.68) !important;
    }

    :host .metric-card.active-filter-card,
    :host .billing-control-card.warn,
    :host .active-filter-strip {
      background: #fff7f3 !important;
      border-color: rgba(154, 106, 96, 0.22) !important;
    }

    :host .table-toolbar {
      gap: 12px;
      padding: 14px;
      border: 1px solid rgba(118, 85, 76, 0.11);
      border-radius: 14px;
      background: #fffdfb;
    }

    :host .search-field input,
    :host .field input,
    :host .field select {
      border-color: rgba(118, 85, 76, 0.14) !important;
      border-radius: 10px !important;
      background: #fff !important;
    }

    :host table th {
      position: sticky;
      top: 0;
      z-index: 1;
      background: #faf7f4 !important;
      color: #766763 !important;
      font-weight: 600 !important;
    }

    :host table td {
      border-bottom-color: rgba(118, 85, 76, 0.08) !important;
      vertical-align: middle;
    }

    :host tbody tr:hover td,
    :host .click-row:hover td,
    :host .selected-row td {
      background: #fffaf7 !important;
    }

    :host .badge,
    :host .payment-mode-chip,
    :host .queue-preview-chip,
    :host .received-due-row {
      border-color: rgba(154, 106, 96, 0.16) !important;
      border-radius: 999px !important;
      background: #fff7f3 !important;
      color: #75524b !important;
      font-weight: 620 !important;
    }

    :host .ghost-button,
    :host .primary-button {
      border-radius: 10px !important;
      font-weight: 580 !important;
    }

    :host .primary-button {
      border-color: #744a44 !important;
      background: #744a44 !important;
      color: #fff !important;
    }
    @media (max-width: 960px) {
      .settlement-breakdown,
      .billing-control-grid {
        grid-template-columns: 1fr;
      }
    }
  `]
})
export class PosInvoicesComponent implements OnInit {
  readonly rows = signal<InvoiceRegisterRow[]>([]);
  readonly walletClients = signal<WalletClientRow[]>([]);
  readonly selected = signal<InvoiceRegisterRow | null>(null);
  readonly paymentModes = signal<PosPaymentMode[]>([]);
  readonly loading = signal(true);
  readonly error = signal('');
  readonly notice = signal('');
  readonly approvalRequesting = signal<string | null>(null);
  readonly approvalDialog = signal<{ action: InvoiceApprovalAction; invoice: InvoiceRegisterRow } | null>(null);
  readonly approvalError = signal('');
  readonly adjustmentDialog = signal<{ invoice: InvoiceRegisterRow } | null>(null);
  readonly adjustmentSaving = signal<string | null>(null);
  readonly adjustmentError = signal('');
  readonly paymentTimeline = signal<ApiRecord | null>(null);
  readonly paymentActionLoading = signal('');
  readonly paymentError = signal('');
  readonly whatsappActionLoading = signal('');
  readonly invoiceNotificationQueue = signal<ApiRecord[]>([]);
  readonly productConsumeDrafts = signal<ProductConsumeDraftRow[]>([]);
  readonly billingSummary = signal<ApiRecord | null>(null);
  readonly billingMargin = signal<ApiRecord | null>(null);
  readonly billingFraudAlerts = signal<ApiRecord[]>([]);
  readonly paymentRiskSummary = signal<ApiRecord | null>(null);
  readonly highValueApprovalLimit = 5000;
  readonly datePresets = DATE_RANGE_PRESETS;
  query = '';
  statusFilter = '';
  datePreset: DateRangePreset = 'today';
  selectedDate = todayKey();
  dateRange = rangeForPreset('today');
  viewFilter: 'all' | 'received-due' | 'due' | 'wallet' = 'all';
  approvalReason = '';
  ownerPin = '';
  adjustmentType = 'adjustment_note';
  adjustmentAmount: number | null = null;
  adjustmentReason = '';

  constructor(
    private readonly api: ApiService,
    private readonly settings: PosSettingsService,
    private readonly route: ActivatedRoute,
    private readonly router: Router,
    private readonly appState: AppStateService,
    private readonly session: AuthSessionService
  ) {}

  canAccessPath(path: string): boolean {
    const permission = routePermissionForPath(path);
    if (!permission || (Array.isArray(permission) && !permission.length)) return true;
    const permissions = Array.isArray(permission) ? permission : [permission];
    const dynamicGrants = this.session.currentUser()?.permissions || [];
    const grants = Array.from(new Set([...staticGrantsForRole(this.appState.userRole()), ...dynamicGrants]));
    return permissions.some((item) => grantsAllow(grants, item));
  }

  ngOnInit(): void {
    this.paymentModes.set(this.settings.loadPaymentModes());
    this.settings.loadPaymentModesRemote().subscribe((modes) => this.paymentModes.set(modes));
    this.route.queryParamMap.subscribe((params) => {
      const filter = params.get('filter');
      this.viewFilter = filter === 'received-due' || filter === 'due' || filter === 'wallet' ? filter : 'all';
      if (this.viewFilter === 'due' || this.viewFilter === 'received-due') {
        this.datePreset = 'all';
        this.dateRange = rangeForPreset('all', this.dateRange);
        this.selectedDate = '';
      }
    });
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.error.set('');
    const scopedParams = this.invoiceListParams();
    const lookupParams = this.dateRange.preset === 'all' ? { limit: 1000 } : { limit: 100 };
    const walletParams = this.dateRange.preset === 'all' ? { limit: 5000 } : dateRangeParams(this.dateRange, 100, 5000);
    const analyticsParams = this.analyticsParams();
    forkJoin({
      invoices: this.api.list<ApiRecord[]>('invoices', scopedParams),
      sales: this.api.list<ApiRecord[]>('sales', scopedParams),
      payments: this.api.list<ApiRecord[]>('payments', scopedParams),
      clients: this.api.list<ApiRecord[]>('clients', lookupParams),
      staff: this.api.list<ApiRecord[]>('staff', lookupParams),
      branches: this.api.list<ApiRecord[]>('branches', { limit: 1000 }),
      walletTransactions: this.api.list<ApiRecord[]>('walletTransactions', walletParams),
      productConsumeDrafts: this.api.list<ProductConsumeDraftRow[]>('inventory-intelligence/product-consume-drafts', { limit: 1000 }),
      invoiceNotificationQueue: this.api.list<ApiRecord[]>('invoice-notifications/queue', { limit: 1000 }).pipe(catchError(() => of([]))),
      billingSummary: this.api.list<ApiRecord>('billing-analytics/summary', analyticsParams).pipe(catchError(() => of(null))),
      billingMargin: this.api.list<ApiRecord>('billing-analytics/margin', analyticsParams).pipe(catchError(() => of(null))),
      billingFraudAlerts: this.api.list<ApiRecord[]>('billing-analytics/fraud-alerts', analyticsParams).pipe(catchError(() => of([]))),
      paymentRiskSummary: this.api.list<ApiRecord>('payment-intelligence/summary').pipe(catchError(() => of(null)))
    }).subscribe({
      next: ({ invoices, sales, payments, clients, staff, branches, walletTransactions, productConsumeDrafts, invoiceNotificationQueue, billingSummary, billingMargin, billingFraudAlerts, paymentRiskSummary }) => {
        this.productConsumeDrafts.set(productConsumeDrafts || []);
        this.invoiceNotificationQueue.set(invoiceNotificationQueue || []);
        this.billingSummary.set(billingSummary || null);
        this.billingMargin.set(billingMargin || null);
        this.billingFraudAlerts.set(billingFraudAlerts || []);
        this.paymentRiskSummary.set(paymentRiskSummary || null);
        const clientsWithWallet = this.withWalletBalances(clients || [], walletTransactions || []);
        this.walletClients.set(this.buildWalletClients(clientsWithWallet, invoices || [], branches || [], walletTransactions || []));
        this.rows.set(this.buildRows(invoices || [], sales || [], payments || [], clientsWithWallet, staff || [], branches || []));
        const targetInvoice = this.route.snapshot.queryParamMap.get('invoice');
        this.selected.set(targetInvoice ? this.rows().find((row) => row.id === targetInvoice) || null : null);
        this.loading.set(false);
      },
      error: (error) => {
        this.error.set(error?.error?.error || error?.message || 'Unable to load invoices');
        this.loading.set(false);
      }
    });
  }

  filteredRows(): InvoiceRegisterRow[] {
    const query = this.query.trim().toLowerCase();
    const queryDigits = this.onlyDigits(query);
    return this.rows().filter((row) => {
      const status = row.balance <= 0 ? 'paid' : row.paid > 0 ? 'partial' : 'unpaid';
      const statusMatch = !this.statusFilter || status === this.statusFilter;
      const searchableText = `${row.invoiceNumber} ${row.clientName} ${row.clientPhone} ${row.staffName} ${row.branchName} ${this.paymentModeSearchText(row)}`;
      const queryMatch =
        !query ||
        searchableText.toLowerCase().includes(query) ||
        (!!queryDigits && this.onlyDigits(searchableText).includes(queryDigits));
      const dateMatch = this.rowInSelectedRange(row.createdAt);
      const receivedDueMatch = !this.isReceivedDueView() || this.rowReceivedDueTotal(row) > 0;
      const dueMatch = !this.isDueView() || row.balance > 0;
      return !this.isWalletView() && statusMatch && queryMatch && dateMatch && receivedDueMatch && dueMatch;
    });
  }

  filteredWalletClients(): WalletClientRow[] {
    const query = this.query.trim().toLowerCase();
    const queryDigits = this.onlyDigits(query);
    return this.walletClients().filter((client) => {
      const searchableText = `${client.name} ${client.phone} ${client.branchName} ${client.walletBalance} ${client.unpaidBalance}`;
      return !query ||
        searchableText.toLowerCase().includes(query) ||
        (!!queryDigits && this.onlyDigits(searchableText).includes(queryDigits));
    });
  }

  productConsumeStatus(row: InvoiceRegisterRow): string {
    const drafts = this.productConsumeDrafts().filter((draft) => draft.invoiceId === row.id);
    if (!drafts.length) return '';
    return drafts.every((draft) => draft.status === 'confirmed') ? 'consumed' : 'consume pending';
  }

  createProductConsumeDraft(row: InvoiceRegisterRow, event?: Event): void {
    event?.stopPropagation();
    this.notice.set('');
    this.api.post<{ drafts?: ProductConsumeDraftRow[] }>(`inventory-intelligence/product-consume-drafts/from-invoice/${row.id}`, {}).subscribe({
      next: (response) => {
        const nextDrafts = [...this.productConsumeDrafts()];
        for (const draft of response.drafts || []) {
          const index = nextDrafts.findIndex((item) => item.id === draft.id);
          if (index >= 0) nextDrafts[index] = draft;
          else nextDrafts.unshift(draft);
        }
        this.productConsumeDrafts.set(nextDrafts);
        this.notice.set(`Product consume draft ready for ${row.invoiceNumber}.`);
      },
      error: (error) => this.paymentError.set(this.api.errorText(error, 'Unable to create product consume draft'))
    });
  }

  isAllView(): boolean {
    return this.viewFilter === 'all';
  }

  isReceivedDueView(): boolean {
    return this.viewFilter === 'received-due';
  }

  isDueView(): boolean {
    return this.viewFilter === 'due';
  }

  isWalletView(): boolean {
    return this.viewFilter === 'wallet';
  }

  isFilteredView(): boolean {
    return this.viewFilter !== 'all';
  }

  pageTitle(): string {
    if (this.isReceivedDueView()) return 'Received due invoices';
    if (this.isDueView()) return 'Due invoices';
    if (this.isWalletView()) return 'Client wallet balances';
    return 'Saved invoices';
  }

  pageDescription(): string {
    if (this.isReceivedDueView()) return 'Only invoices where old pending dues were received from POS.';
    if (this.isDueView()) return 'Only invoices with unpaid or pending balance.';
    if (this.isWalletView()) return 'All clients with wallet money, balance source, due amount and quick action in one page.';
    return 'All POS invoices saved from checkout with items, payment split, tips, GST, paid and due amount.';
  }

  activeFilterTitle(): string {
    if (this.isReceivedDueView()) return 'Received due invoices';
    if (this.isDueView()) return 'Due invoices';
    if (this.isWalletView()) return 'Wallet clients';
    return 'All invoices';
  }

  activeFilterDescription(): string {
    if (this.isReceivedDueView()) return 'Showing only invoices with old balance collections.';
    if (this.isDueView()) return 'Showing only invoices where client still has pending balance.';
    if (this.isWalletView()) return 'Showing clients who have wallet credit available for redemption.';
    return 'Showing all saved invoices.';
  }

  summaryEyebrow(): string {
    if (this.isReceivedDueView()) return 'Received due filter';
    if (this.isDueView()) return 'Due invoice filter';
    if (this.isWalletView()) return 'Wallet balance filter';
    return this.selectedDate ? 'Selected date' : 'All invoice dates';
  }

  setToday(): void {
    this.applyDatePreset('today');
  }

  showAllDates(): void {
    this.applyDatePreset('all');
  }

  applyDatePreset(preset: DateRangePreset): void {
    this.datePreset = preset;
    this.dateRange = rangeForPreset(preset, this.dateRange);
    this.selectedDate = this.dateRange.preset === 'all' ? '' : this.dateRange.from;
    this.load();
  }

  updateCustomDate(side: 'from' | 'to', value: string): void {
    this.datePreset = 'custom';
    this.dateRange = {
      preset: 'custom',
      from: side === 'from' ? value : this.dateRange.from,
      to: side === 'to' ? value : this.dateRange.to
    };
    if (!this.dateRange.to) this.dateRange.to = this.dateRange.from;
    this.selectedDate = this.dateRange.from;
    this.load();
  }

  selectedDateLabel(): string {
    if (this.dateRange.preset === 'all') return 'All dates';
    const from = this.formatDateKey(this.dateRange.from);
    const to = this.formatDateKey(this.dateRange.to || this.dateRange.from);
    return from === to ? from : `${from} - ${to}`;
  }

  openDetail(row: InvoiceRegisterRow): void {
    this.selected.set(row);
    this.loadPaymentTimeline(row);
  }

  openClientCrm(row: InvoiceRegisterRow, event?: Event): void {
    event?.stopPropagation();
    this.router.navigate(['/clients'], {
      queryParams: {
        q: row.clientPhone || row.clientName || undefined,
        clientId: row.clientId || undefined
      }
    });
  }

  receiveDue(row: InvoiceRegisterRow, event?: Event): void {
    event?.stopPropagation();
    this.router.navigate(['/pos'], {
      queryParams: {
        clientId: row.clientId || undefined,
        q: row.clientPhone || row.clientName || undefined,
        receiveDue: Math.max(0, row.balance || 0)
      }
    });
  }

  openWalletClient(client: WalletClientRow): void {
    this.router.navigate(['/clients'], {
      queryParams: {
        q: client.phone || client.name || undefined,
        clientId: client.id || undefined
      }
    });
  }

  openWalletRedemption(client: WalletClientRow): void {
    this.router.navigate(['/pos'], {
      queryParams: {
        clientId: client.id || undefined,
        q: client.phone || client.name || undefined,
        wallet: client.walletBalance || undefined
      }
    });
  }

  requiresEditApproval(row: InvoiceRegisterRow): boolean {
    const state = this.invoiceStateText(row);
    return row.total >= this.highValueApprovalLimit || ['deleted', 'voided', 'cancelled'].some((item) => state.includes(item));
  }

  requiresAdjustmentNote(row: InvoiceRegisterRow): boolean {
    const status = this.invoiceStateText(row);
    return row.balance <= 0
      || ['paid', 'closed', 'finalized', 'settled', 'posted', 'voided', 'cancelled'].some((item) => status.includes(item));
  }

  editActionLabel(row: InvoiceRegisterRow): string {
    return this.requiresEditApproval(row) ? 'Request edit' : 'Edit invoice';
  }

  canRequestDelete(): boolean {
    return ['superAdmin', 'owner', 'admin', 'manager', 'cashier', 'frontDesk'].includes(this.appState.userRole());
  }

  editInvoice(row: InvoiceRegisterRow, event?: Event): void {
    event?.stopPropagation();
    if (this.requiresEditApproval(row)) {
      this.openApprovalDialog('edit', row);
      return;
    }

    this.openCorrectionDraft(row);
  }

  openAdjustmentNote(row: InvoiceRegisterRow, event?: Event): void {
    event?.stopPropagation();
    this.openAdjustmentDialog(row);
  }

  deleteInvoice(row: InvoiceRegisterRow, event?: Event): void {
    event?.stopPropagation();
    if (!this.canRequestDelete()) {
      this.notice.set('Your role cannot request invoice deletion.');
      return;
    }
    this.openApprovalDialog('delete', row);
  }

  closeApprovalDialog(): void {
    this.approvalDialog.set(null);
    this.approvalReason = '';
    this.ownerPin = '';
    this.approvalError.set('');
  }

  closeAdjustmentDialog(): void {
    this.adjustmentDialog.set(null);
    this.adjustmentType = 'adjustment_note';
    this.adjustmentAmount = null;
    this.adjustmentReason = '';
    this.adjustmentError.set('');
  }

  submitAdjustmentNote(): void {
    const request = this.adjustmentDialog();
    if (!request) return;
    const reason = this.adjustmentReason.trim();
    if (!reason) {
      this.adjustmentError.set('Adjustment reason is required');
      return;
    }
    this.adjustmentError.set('');
    this.adjustmentSaving.set(request.invoice.id);
    this.api.post<ApiRecord>(`pos/invoices/${request.invoice.id}/adjustment-note`, {
      type: this.adjustmentType,
      amount: this.adjustmentAmount || 0,
      reason,
      invoice: this.approvalSnapshot(request.invoice)
    }).pipe(
      finalize(() => this.adjustmentSaving.set(null))
    ).subscribe({
      next: () => {
        this.notice.set(`Adjustment note recorded for ${request.invoice.invoiceNumber}.`);
        this.closeAdjustmentDialog();
        this.load();
      },
      error: (error) => this.adjustmentError.set(error?.error?.error || error?.message || 'Unable to record adjustment note')
    });
  }

  submitApprovalRequest(): void {
    const request = this.approvalDialog();
    if (!request) return;
    const reason = this.approvalReason.trim();
    const ownerPin = this.ownerPin.trim();
    if (!reason) {
      this.approvalError.set(request.action === 'delete' ? 'Delete reason is required' : 'Edit approval reason is required');
      return;
    }
    if (!ownerPin) {
      this.approvalError.set('Owner PIN/password is required');
      return;
    }

    this.approvalError.set('');
    this.approvalRequesting.set(request.invoice.id);
    this.api.post<ApiRecord>(`pos/invoices/${request.invoice.id}/approval-request`, {
      actionType: request.action,
      reason,
      deleteReason: request.action === 'delete' ? reason : '',
      ownerPin,
      invoice: this.approvalSnapshot(request.invoice)
    }).pipe(
      finalize(() => this.approvalRequesting.set(null))
    ).subscribe({
      next: (response) => {
        const duplicate = response?.duplicate ? ' Existing pending request was reused.' : '';
        this.notice.set(`${this.approvalActionTitle(request.action)} submitted for manager approval.${duplicate}`);
        this.closeApprovalDialog();
        this.load();
      },
      error: (error) => this.approvalError.set(error?.error?.error || error?.message || 'Unable to request invoice approval')
    });
  }

  approvalActionTitle(action: InvoiceApprovalAction): string {
    return action === 'delete' ? 'Delete invoice approval' : 'High-value edit approval';
  }

  approvalSubmitLabel(action: InvoiceApprovalAction): string {
    return action === 'delete' ? 'Request delete approval' : 'Request edit approval';
  }

  approvalPolicyLabel(action: InvoiceApprovalAction, invoice: InvoiceRegisterRow): string {
    if (action === 'delete') return 'Manager approval required before soft delete';
    return invoice.total >= this.highValueApprovalLimit ? 'High-value invoice edit approval' : 'Closed or paid invoice edit approval';
  }

  private openApprovalDialog(action: InvoiceApprovalAction, invoice: InvoiceRegisterRow): void {
    this.approvalDialog.set({ action, invoice });
    this.approvalReason = action === 'delete'
      ? `Delete request for ${invoice.invoiceNumber}`
      : `Correction request for ${invoice.invoiceNumber}`;
    this.ownerPin = '';
    this.approvalError.set('');
  }

  private openAdjustmentDialog(invoice: InvoiceRegisterRow): void {
    this.adjustmentDialog.set({ invoice });
    this.adjustmentType = invoice.balance <= 0 ? 'credit_note' : 'adjustment_note';
    this.adjustmentAmount = Math.max(0, invoice.balance || 0);
    this.adjustmentReason = `Adjustment required for closed invoice ${invoice.invoiceNumber}`;
    this.adjustmentError.set('');
  }

  private openCorrectionDraft(row: InvoiceRegisterRow): void {
    const now = new Date().toISOString();
    const draft: PosHeldInvoiceDraft = {
      id: `invoice_edit_${row.id}`,
      title: `${row.invoiceNumber} correction - ₹${row.total}`,
      clientId: row.clientId,
      clientName: row.clientName,
      branchId: row.branchId,
      branchName: row.branchName,
      staffId: row.staffId,
      staffName: row.staffName,
      appointmentId: row.appointmentId,
      items: row.items,
      tips: row.tips,
      payments: this.paymentDraft(row),
      discount: row.discount,
      discountMode: 'amount',
      couponCode: '',
      creditsUsed: 0,
      membershipId: '',
      subtotal: row.subtotal,
      total: row.total,
      balanceDue: row.balance,
      note: `Correction draft created from saved invoice ${row.invoiceNumber}.`,
      createdAt: now,
      updatedAt: now
    };

    this.settings.upsertHeldInvoice(draft);
    const openCorrectionDraft = () => this.router.navigate(['/pos'], { queryParams: { holdId: draft.id } });
    this.createInvoiceAudit('invoice.edited', row, 'info', {
      editMode: 'correction_draft',
      holdId: draft.id,
      statusAfter: 'correction_draft_opened'
    }).subscribe({
      next: openCorrectionDraft,
      error: openCorrectionDraft
    });
  }

  closeDetail(): void {
    this.selected.set(null);
    this.paymentTimeline.set(null);
    this.paymentError.set('');
  }

  billedTotal(): number {
    return this.money(this.filteredRows().reduce((sum, row) => sum + row.total, 0));
  }

  paidTotal(): number {
    return this.money(this.filteredRows().reduce((sum, row) => sum + row.paid, 0));
  }

  dueTotal(): number {
    return this.money(this.filteredRows().reduce((sum, row) => sum + row.balance, 0));
  }

  receivedDueTotal(): number {
    return this.money(this.filteredRows().reduce((sum, row) => sum + this.rowReceivedDueTotal(row), 0));
  }

  walletTotal(): number {
    return this.money(this.filteredWalletClients().reduce((sum, client) => sum + client.walletBalance, 0));
  }

  walletClientCount(): number {
    return this.filteredWalletClients().length;
  }

  paymentTruthScore(): number {
    const rows = this.filteredRows();
    if (!rows.length) return 100;
    const validRows = rows.filter((row) => Math.abs(this.money(row.total - row.paid - row.balance)) <= 1);
    return Math.round((validRows.length / rows.length) * 100);
  }

  paymentTruthLabel(): string {
    const failed = this.filteredRows().length - Math.round((this.paymentTruthScore() / 100) * this.filteredRows().length);
    return failed > 0 ? `${failed} invoice needs payment/due reconciliation` : 'Paid, due and settlement totals reconcile';
  }

  bookingAdvanceAdjustedTotal(): number {
    return this.money(this.filteredRows().reduce((sum, row) => sum + this.bookingAdvanceAdjustedAmount(row), 0));
  }

  settlementCollectedTotal(): number {
    return this.money(this.filteredRows().reduce((sum, row) => sum + this.counterPaymentCollectedAmount(row) + this.bookingAdvanceAdjustedAmount(row), 0));
  }

  gstCollectedTotal(): number {
    const apiValue = this.billingSummary()?.['taxCollected'];
    if (apiValue !== undefined && apiValue !== null && apiValue !== '') return this.money(apiValue as string | number);
    return this.money(this.filteredRows().reduce((sum, row) => sum + row.gst, 0));
  }

  marginGrossTotal(): number {
    const margin = this.billingMargin() || {};
    return this.money((margin['grossMargin'] ?? margin['gross_margin'] ?? 0) as string | number);
  }

  marginPercentLabel(): string {
    const margin = this.billingMargin() || {};
    const revenue = this.money((margin['revenue'] ?? 0) as string | number);
    if (revenue <= 0) return '0%';
    return `${this.money((this.marginGrossTotal() / revenue) * 100)}%`;
  }

  fraudFlagCount(): number {
    return this.billingFraudAlerts().length + Number(this.paymentRiskSummary()?.['openRisks'] || 0);
  }

  amountAtRisk(): number {
    const alertAmount = this.billingFraudAlerts().reduce((sum, row) => sum + Number(row['amount'] || row['difference'] || 0), 0);
    return this.money(alertAmount + Number(this.paymentRiskSummary()?.['amountAtRisk'] || 0));
  }

  consumePendingCount(): number {
    return this.productConsumeDrafts().filter((draft) => draft.status !== 'confirmed').length;
  }

  lineTotal(item: ApiRecord): number {
    return this.lineGross(item);
  }

  itemName(item: ApiRecord): string {
    return String(item.name || item.serviceName || item.productName || item.itemName || item.title || 'Invoice item');
  }

  itemQuantity(item: ApiRecord): number {
    return this.money(Number(this.firstValue(item, ['quantity', 'qty', 'units']) || 1));
  }

  lineRate(item: ApiRecord): number {
    const explicit = this.firstValue(item, ['rate', 'price', 'unitPrice', 'unit_price', 'sellingPrice', 'selling_price', 'mrp']);
    if (explicit !== undefined && explicit !== null && explicit !== '') return this.money(Number(explicit));
    const gross = this.firstValue(item, ['gross', 'grossAmount', 'gross_amount', 'subtotal', 'lineSubtotal', 'line_subtotal']);
    const qty = this.itemQuantity(item) || 1;
    return this.money(Number(gross || 0) / qty);
  }

  lineGross(item: ApiRecord): number {
    const explicit = this.firstValue(item, ['gross', 'grossAmount', 'gross_amount', 'subtotal', 'lineSubtotal', 'line_subtotal']);
    if (explicit !== undefined && explicit !== null && explicit !== '') return this.money(Number(explicit));
    return this.money(this.lineRate(item) * this.itemQuantity(item));
  }

  lineDiscount(invoice: InvoiceRegisterRow, item: ApiRecord): number {
    const explicit = this.firstValue(item, ['discount', 'discountAmount', 'discount_amount', 'manualDiscount', 'manual_discount', 'lineDiscount', 'line_discount']);
    if (explicit !== undefined && explicit !== null && explicit !== '') return this.money(Number(explicit));
    const grossTotal = this.invoiceGrossTotal(invoice);
    if (grossTotal <= 0 || invoice.discount <= 0) return 0;
    return this.money((this.lineGross(item) / grossTotal) * invoice.discount);
  }

  lineTaxable(invoice: InvoiceRegisterRow, item: ApiRecord): number {
    const explicit = this.firstValue(item, ['taxable', 'taxableAmount', 'taxable_amount', 'netAmount', 'net_amount']);
    if (explicit !== undefined && explicit !== null && explicit !== '') return this.money(Number(explicit));
    return this.money(Math.max(0, this.lineGross(item) - this.lineDiscount(invoice, item)));
  }

  lineGstRate(item: ApiRecord): number {
    return this.money(Number(this.firstValue(item, ['gstRate', 'gst_rate', 'taxRate', 'tax_rate', 'gst']) || 0));
  }

  lineGstAmount(invoice: InvoiceRegisterRow, item: ApiRecord): number {
    const explicit = this.firstValue(item, ['gstAmount', 'gst_amount', 'taxAmount', 'tax_amount', 'lineTax', 'line_tax']);
    if (explicit !== undefined && explicit !== null && explicit !== '') return this.money(Number(explicit));
    const rate = this.lineGstRate(item);
    return this.money((this.lineTaxable(invoice, item) * rate) / 100);
  }

  lineFinal(invoice: InvoiceRegisterRow, item: ApiRecord): number {
    const explicit = this.firstValue(item, ['total', 'lineTotal', 'line_total', 'finalAmount', 'final_amount']);
    if (explicit !== undefined && explicit !== null && explicit !== '') return this.money(Number(explicit));
    return this.money(this.lineTaxable(invoice, item) + this.lineGstAmount(invoice, item));
  }

  invoiceTaxableTotal(invoice: InvoiceRegisterRow): number {
    const itemTaxable = this.money((invoice.items || []).reduce((sum, item) => sum + this.lineTaxable(invoice, item), 0));
    if (itemTaxable > 0) return itemTaxable;
    return this.money(Math.max(0, invoice.subtotal - invoice.discount));
  }

  invoiceDiscountRate(invoice: InvoiceRegisterRow): number {
    const base = invoice.subtotal || this.invoiceGrossTotal(invoice);
    if (!base) return 0;
    return this.money((invoice.discount / base) * 100);
  }

  itemStaffName(item: ApiRecord, invoice: InvoiceRegisterRow): string {
    return String(
      this.firstValue(item, ['staffName', 'staff_name', 'assignedStaffName', 'assigned_staff_name', 'stylistName', 'stylist_name']) ||
      invoice.staffName ||
      'Unassigned'
    );
  }

  serviceItems(invoice: InvoiceRegisterRow): ApiRecord[] {
    return this.invoiceItemsByType(invoice, 'service');
  }

  serviceItemRows(invoice: InvoiceRegisterRow): Array<{ item: ApiRecord; lineIndex: number }> {
    return (invoice.items || [])
      .map((item, lineIndex) => ({ item, lineIndex }))
      .filter(({ item }) => this.normalizedItemType(item) === 'service');
  }

  productItems(invoice: InvoiceRegisterRow): ApiRecord[] {
    return this.invoiceItemsByType(invoice, 'product');
  }

  otherItems(invoice: InvoiceRegisterRow): ApiRecord[] {
    return (invoice.items || []).filter((item) => {
      const type = this.normalizedItemType(item);
      return type !== 'service' && type !== 'product';
    });
  }

  invoiceBenefitCreditsUsed(invoice: InvoiceRegisterRow): string {
    const credits = this.invoiceBenefitCreditsUsedCount(invoice);
    return credits > 0 ? `${credits} credits` : '';
  }

  invoiceBenefitCreditsUsedCount(invoice: InvoiceRegisterRow): number {
    return Number(invoice.membershipRedeem?.creditsUsed || 0);
  }

  invoiceBenefitRemaining(invoice: InvoiceRegisterRow): string {
    return `${Number(invoice.membershipRedeem?.remainingAfterRedeem || 0)} credits`;
  }

  invoiceBenefitSummaryLines(invoice: InvoiceRegisterRow): Array<{ serviceName: string; credits: number; benefitName: string }> {
    const mappings = Array.isArray(invoice.membershipRedeem?.serviceLineMappings) ? invoice.membershipRedeem?.serviceLineMappings as ApiRecord[] : [];
    const benefitName = String(invoice.membershipRedeem?.benefitName || invoice.membershipRedeem?.membershipId || 'Benefit');
    return mappings
      .filter((mapping) => Number(mapping.credits || 0) > 0)
      .map((mapping) => ({
        serviceName: String(mapping.serviceName || mapping.serviceId || 'Service'),
        credits: Number(mapping.credits || 0),
        benefitName
      }));
  }

  serviceLineBenefitSummary(invoice: InvoiceRegisterRow, item: ApiRecord, index: number): string {
    const mappings = Array.isArray(invoice.membershipRedeem?.serviceLineMappings) ? invoice.membershipRedeem?.serviceLineMappings as ApiRecord[] : [];
    const match = mappings.find((mapping) => Number(mapping.lineIndex ?? -1) === index || String(mapping.serviceId || '') === String(item.id || ''));
    if (!match) return '';
    const benefitName = String(invoice.membershipRedeem?.benefitName || invoice.membershipRedeem?.membershipId || 'Benefit');
    return `${benefitName} · ${Number(match.credits || 0)} credits redeemed`;
  }

  itemLineMeta(item: ApiRecord): string {
    return `${this.itemTypeLabel(item)} · Qty ${this.itemQuantity(item)} · GST ${this.lineGstRate(item)}%`;
  }

  paymentModeSummary(row: InvoiceRegisterRow): Array<{ mode: string; label: string; amount: number }> {
    const totals = new Map<string, number>();

    for (const payment of row.payments || []) {
      const mode = String(payment.mode || 'unknown');
      const amount = this.money(Number(payment.amount || 0));
      if (amount <= 0) continue;
      totals.set(mode, this.money((totals.get(mode) || 0) + amount));
    }

    return Array.from(totals.entries()).map(([mode, amount]) => ({
      mode,
      label: this.modeLabel(mode),
      amount
    }));
  }

  paymentDraft(row: InvoiceRegisterRow): Record<string, number> {
    const payments: Record<string, number> = {};
    for (const mode of this.paymentModes()) {
      payments[mode.id] = 0;
    }

    for (const payment of row.payments || []) {
      const mode = String(payment.mode || 'cash');
      payments[mode] = this.money((payments[mode] || 0) + Number(payment.amount || 0));
    }

    return payments;
  }

  paymentModeSearchText(row: InvoiceRegisterRow): string {
    return [
      this.paymentModeSummary(row)
        .map((paymentMode) => `${paymentMode.mode} ${paymentMode.label} ${paymentMode.amount}`)
        .join(' '),
      this.receivedDueSummary(row)
    ].filter(Boolean).join(' ');
  }

  paymentModeClass(modeId: string): string {
    const mode = String(modeId || '').toLowerCase();
    if (mode.includes('cash')) return 'payment-mode-chip--cash';
    if (mode.includes('upi') || mode.includes('online') || mode.includes('paytm') || mode.includes('phonepe') || mode.includes('gpay')) {
      return 'payment-mode-chip--upi';
    }
    if (mode.includes('card') || mode.includes('credit') || mode.includes('debit')) return 'payment-mode-chip--card';
    if (mode.includes('wallet')) return 'payment-mode-chip--wallet';
    if (mode.includes('bank') || mode.includes('neft') || mode.includes('rtgs') || mode.includes('imps')) return 'payment-mode-chip--bank';
    return 'payment-mode-chip--other';
  }

  receivedDueLines(row: InvoiceRegisterRow): Array<{
    invoiceNumber: string;
    dueDate: string;
    receivedDate: string;
    mode: string;
    amount: number;
    reference: string;
    paymentReference: string;
    receivedBy: string;
    receiverId: string;
    settlementPaymentId: string;
    daysToRecovery: number;
    pendingAfter: number;
  }> {
    const receivedPayments = (row.payments || [])
      .filter((payment) => this.isReceivedDuePayment(payment))
      .sort((a, b) => this.dateMs(a.createdAt || a.created_at) - this.dateMs(b.createdAt || b.created_at));
    let pending = this.money(row.balance + receivedPayments.reduce((sum, payment) => sum + Number(payment.amount || 0), 0));
    return receivedPayments.map((payment) => {
      const amount = this.money(Number(payment.amount || 0));
      pending = this.money(Math.max(0, pending - amount));
      return {
        invoiceNumber: row.invoiceNumber,
        dueDate: row.createdAt || row.dueDate,
        receivedDate: String(payment.createdAt || payment.created_at || ''),
        mode: String(payment.mode || 'cash'),
        amount,
        reference: String(payment.reference || payment.remarks || 'Old due received'),
        paymentReference: String(payment.referenceNo || payment.reference_no || payment.reference || payment.paymentReference || payment.payment_reference || ''),
        receivedBy: this.paymentReceiverLabel(payment),
        receiverId: String(payment.createdBy || payment.created_by || payment.receivedBy || payment.received_by || payment.cashierId || payment.cashier_id || ''),
        settlementPaymentId: String(payment.id || payment.paymentId || payment.payment_id || payment.providerPaymentId || payment.provider_payment_id || ''),
        daysToRecovery: this.recoveryDays(row.createdAt || row.dueDate, payment),
        pendingAfter: pending
      };
    });
  }

  receivedDueSummary(row: InvoiceRegisterRow): string {
    const lines = this.receivedDueLines(row);
    if (!lines.length) return '';
    const byMode = new Map<string, number>();
    for (const line of lines) {
      byMode.set(line.mode, this.money((byMode.get(line.mode) || 0) + line.amount));
    }
    const total = lines.reduce((sum, line) => sum + line.amount, 0);
    const modes = Array.from(byMode.entries())
      .map(([mode, amount]) => `${this.modeLabel(mode)} ${this.money(amount).toLocaleString('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 })}`)
      .join(', ');
    return `Unpaid received: ${this.money(total).toLocaleString('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 })}${modes ? ` via ${modes}` : ''}`;
  }

  paymentReceiverLabel(payment: ApiRecord): string {
    const receiverId = String(payment.createdBy || payment.created_by || payment.receivedBy || payment.received_by || payment.cashierId || payment.cashier_id || payment.staffId || payment.staff_id || '').trim();
    return String(payment.receivedByName || payment.received_by_name || payment.cashierName || payment.cashier_name || receiverId || 'Counter');
  }

  recoveryDays(invoiceDate: string, payment: ApiRecord): number {
    const start = this.dateMs(invoiceDate);
    const end = this.dateMs(payment.paidAt || payment.paid_at || payment.createdAt || payment.created_at || payment.date);
    if (!start || !end) return 0;
    return Math.max(0, Math.floor((end - start) / (24 * 60 * 60 * 1000)));
  }

  modeLabel(modeId: string): string {
    if (modeId === 'booking_advance') return 'Booking advance';
    return this.paymentModes().find((mode) => mode.id === modeId)?.label || modeId;
  }

  walletPaidAmount(row: InvoiceRegisterRow): number {
    return this.money((row.payments || [])
      .filter((payment) => String(payment.mode || '').toLowerCase().includes('wallet'))
      .reduce((sum, payment) => sum + Number(payment.amount || 0), 0));
  }

  bookingAdvanceAdjustedAmount(row: InvoiceRegisterRow): number {
    return this.money((row.payments || [])
      .filter((payment) => String(payment.mode || '').toLowerCase() === 'booking_advance')
      .reduce((sum, payment) => sum + Number(payment.amount || 0), 0));
  }

  counterPaymentCollectedAmount(row: InvoiceRegisterRow): number {
    return this.money(Math.max(0, Number(row.paid || 0) - this.bookingAdvanceAdjustedAmount(row)));
  }

  remainingCounterPaymentAmount(row: InvoiceRegisterRow): number {
    return this.money(Math.max(0, Number(row.balance || 0)));
  }

  settlementSnippet(row: InvoiceRegisterRow): string {
    const advance = this.bookingAdvanceAdjustedAmount(row).toLocaleString('en-IN');
    const counter = this.counterPaymentCollectedAmount(row).toLocaleString('en-IN');
    const due = this.remainingCounterPaymentAmount(row).toLocaleString('en-IN');
    return `Adv ₹${advance} · Counter ₹${counter} · Due ₹${due}`;
  }

  whatsappSummaryTooltip(row: InvoiceRegisterRow): string {
    const paymentState = row.balance > 0 ? 'Send unpaid invoice PDF on WhatsApp.' : 'Send paid invoice PDF on WhatsApp.';
    return `${paymentState} Client ko settlement summary line bhi saath jayegi: ${this.settlementSnippet(row)}`;
  }

  whatsappQueuePreview(row: InvoiceRegisterRow): string {
    const queueRow = this.invoiceNotificationQueue()
      .filter((item) => String(item.invoiceId || item.invoice_id || '') === row.id && String(item.channel || '').toLowerCase() === 'whatsapp')
      .sort((a, b) => this.dateMs(b.updatedAt || b.updated_at || b.createdAt || b.created_at) - this.dateMs(a.updatedAt || a.updated_at || a.createdAt || a.created_at))[0];
    if (!queueRow) return '';
    const messageBody = String(queueRow.messageBody || queueRow.message_body || '');
    return messageBody.split('\n').find((line) => line.startsWith('Advance adjusted:')) || this.settlementSnippet(row);
  }

  advanceAmount(record: ApiRecord): number {
    return this.money(Number(record?.bookingAdvancePaid || 0));
  }

  advancePendingAmount(record: ApiRecord): number {
    return this.money(Number(record?.bookingAdvancePending || 0));
  }

  invoiceKindLabel(row: InvoiceRegisterRow): string {
    const hasService = this.serviceItems(row).length > 0;
    const hasProduct = this.productItems(row).length > 0;
    if (hasService && hasProduct) return 'service_product';
    if (hasProduct) return 'product';
    if (this.walletPaidAmount(row) > 0) return 'wallet';
    return 'service';
  }

  sendInvoicePdfWhatsapp(invoice: InvoiceRegisterRow, event?: Event): void {
    event?.stopPropagation();
    if (!invoice.id) return;
    if (!invoice.clientPhone) {
      this.notice.set(`Client WhatsApp number missing for ${invoice.invoiceNumber}. Add client phone first.`);
      return;
    }
    this.paymentError.set('');
    this.whatsappActionLoading.set(invoice.id);
    this.api.post<ApiRecord>(`billing/invoices/${invoice.id}/send-whatsapp`, {
      phone: invoice.clientPhone,
      source: 'pos-invoices',
      invoiceKind: this.invoiceKindLabel(invoice),
      paymentStatus: invoice.balance > 0 ? 'unpaid' : 'paid',
      walletPaid: this.walletPaidAmount(invoice)
    }).pipe(
      finalize(() => this.whatsappActionLoading.set(''))
    ).subscribe({
      next: (response) => {
        const due = Number(response.due || invoice.balance || 0);
        const dueText = due > 0 ? ` Due ₹${due.toLocaleString('en-IN')}.` : '';
        if (response?.row) {
          const queueRow = response.row as ApiRecord;
          this.invoiceNotificationQueue.update((rows) => {
            const nextRows = rows.filter((item) => item.id !== queueRow.id);
            nextRows.unshift(queueRow);
            return nextRows;
          });
        }
        this.notice.set(`WhatsApp PDF queued for ${invoice.invoiceNumber}.${dueText} ${this.settlementSnippet(invoice)}`);
        this.loadPaymentTimeline(invoice);
      },
      error: (error) => this.paymentError.set(this.api.errorText(error, 'Unable to queue WhatsApp PDF'))
    });
  }

  downloadInvoice(invoice: InvoiceRegisterRow): void {
    if (!invoice.id) return;
    this.api.post<ApiRecord>(`invoices/${invoice.id}/document`, {}).subscribe({
      next: (documentRecord) => {
        const win = window.open('', '_blank', 'noopener,noreferrer,width=900,height=1100');
        if (!win) {
          this.error.set('Popup blocked. Allow popups in the browser and open the A4 PDF again.');
          return;
        }
        win.document.open();
        win.document.write(String(documentRecord.content || ''));
        win.document.close();
        win.focus();
      },
      error: (error) => this.error.set(error?.error?.error || 'Unable to download invoice')
    });
  }

  createPaymentLink(invoice: InvoiceRegisterRow): void {
    this.paymentError.set('');
    this.paymentActionLoading.set(`${invoice.id}:link`);
    this.api.post<ApiRecord>(`payments/invoices/${invoice.id}/link`, {
      amount: invoice.balance,
      provider: 'razorpay'
    }).pipe(
      finalize(() => this.paymentActionLoading.set(''))
    ).subscribe({
      next: (response) => {
        this.paymentTimeline.set(response.timeline || response);
        this.notice.set(`Payment link ready for ${invoice.invoiceNumber}.`);
      },
      error: (error) => this.paymentError.set(this.api.errorText(error, 'Unable to create payment link'))
    });
  }

  sendPaymentReminder(invoice: InvoiceRegisterRow): void {
    this.paymentError.set('');
    this.paymentActionLoading.set(`${invoice.id}:reminder`);
    this.api.post<ApiRecord>(`payments/invoices/${invoice.id}/reminder`, {
      channel: 'whatsapp',
      provider: 'razorpay'
    }).pipe(
      finalize(() => this.paymentActionLoading.set(''))
    ).subscribe({
      next: (response) => {
        this.notice.set(`WhatsApp payment reminder queued for ${invoice.invoiceNumber}.`);
        this.loadPaymentTimeline(invoice);
      },
      error: (error) => this.paymentError.set(this.api.errorText(error, 'Unable to send payment reminder'))
    });
  }

  reconcilePayment(invoice: InvoiceRegisterRow): void {
    this.paymentError.set('');
    this.paymentActionLoading.set(`${invoice.id}:reconcile`);
    this.api.post<ApiRecord>(`payments/invoices/${invoice.id}/reconcile`, {
      provider: 'razorpay',
      runType: 'manual'
    }).pipe(
      finalize(() => this.paymentActionLoading.set(''))
    ).subscribe({
      next: (response) => {
        this.paymentTimeline.set(response.timeline || this.paymentTimeline());
        this.notice.set(`Payment reconciliation checked ${response.checked || 0} link(s).`);
      },
      error: (error) => this.paymentError.set(this.api.errorText(error, 'Unable to reconcile payment'))
    });
  }

  latestPaymentLinkId(): string {
    const links = (this.paymentTimeline()?.links || []) as ApiRecord[];
    return String(links[0]?.linkId || links[0]?.providerLinkId || '');
  }

  private loadPaymentTimeline(invoice: InvoiceRegisterRow): void {
    if (!invoice.id) return;
    this.paymentError.set('');
    this.paymentActionLoading.set(`${invoice.id}:timeline`);
    this.api.list<ApiRecord>(`payments/invoices/${invoice.id}/timeline`).pipe(
      finalize(() => {
        if (this.paymentActionLoading() === `${invoice.id}:timeline`) this.paymentActionLoading.set('');
      })
    ).subscribe({
      next: (timeline) => this.paymentTimeline.set(timeline),
      error: () => this.paymentTimeline.set({ invoice: { id: invoice.id }, links: [], events: [], webhooks: [] })
    });
  }

  private buildWalletClients(clients: ApiRecord[], invoices: ApiRecord[], branches: ApiRecord[], walletTransactions: ApiRecord[]): WalletClientRow[] {
    const branchMap = new Map(branches.map((branch) => [String(branch.id || ''), branch]));
    const dueByClient = new Map<string, number>();
    for (const invoice of invoices || []) {
      const clientId = String(invoice.clientId || invoice.client_id || invoice.customerId || invoice.customer_id || '');
      if (!clientId) continue;
      const total = Number(invoice.total ?? invoice.grand_total ?? invoice.grandTotal ?? 0);
      const paid = Number(invoice.paid ?? invoice.paid_amount ?? invoice.paidAmount ?? 0);
      const balance = Math.max(0, Number(invoice.balance ?? invoice.due_amount ?? invoice.dueAmount ?? total - paid) || 0);
      if (balance <= 0) continue;
      dueByClient.set(clientId, this.money((dueByClient.get(clientId) || 0) + balance));
    }

    const latestTxByClient = new Map<string, ApiRecord>();
    for (const transaction of walletTransactions || []) {
      const clientId = String(transaction.clientId || transaction.client_id || transaction.customerId || transaction.customer_id || '');
      if (!clientId) continue;
      const current = latestTxByClient.get(clientId);
      const currentTime = this.walletTime(current);
      const transactionTime = this.walletTime(transaction);
      if (!current || transactionTime >= currentTime) latestTxByClient.set(clientId, transaction);
    }

    return clients
      .map((client) => {
        const id = String(client.id || '');
        const branchId = String(client.branchId || client.branch_id || '');
        const branch = branchMap.get(branchId) || {};
        const latest = latestTxByClient.get(id);
        const walletBalance = this.clientWalletBalance(client, latest);
        return {
          id,
          name: String(client.name || client.fullName || client.full_name || client.clientName || id || 'Client'),
          phone: String(client.phone || client.mobile || client.whatsapp || client.contact || ''),
          branchId,
          branchName: String(branch.name || client.branchName || client.branch_name || branchId || 'Branch'),
          walletBalance,
          unpaidBalance: dueByClient.get(id) || this.money(Number(client.unpaidBalance || client.dueAmount || 0)),
          lastWalletActivity: String(latest?.createdAt || latest?.created_at || latest?.date || latest?.updatedAt || ''),
          source: latest ? 'wallet ledger' : 'client balance'
        };
      })
      .filter((client) => client.id && client.walletBalance > 0)
      .sort((a, b) => b.walletBalance - a.walletBalance || a.name.localeCompare(b.name));
  }

  private withWalletBalances(clients: ApiRecord[], transactions: ApiRecord[]): ApiRecord[] {
    const latestByClient = new Map<string, ApiRecord>();
    for (const transaction of transactions || []) {
      const clientId = String(transaction.clientId || transaction.client_id || transaction.customerId || transaction.customer_id || '');
      if (!clientId) continue;
      const current = latestByClient.get(clientId);
      if (!current || this.walletTime(transaction) >= this.walletTime(current)) {
        latestByClient.set(clientId, transaction);
      }
    }
    return clients.map((client) => {
      const latest = latestByClient.get(String(client.id || ''));
      return {
        ...client,
        walletBalance: this.clientWalletBalance(client, latest)
      };
    });
  }

  private clientWalletBalance(client: ApiRecord, latest?: ApiRecord): number {
    const linkedBalance = latest?.balanceAfter ?? latest?.balance_after ?? latest?.walletBalance ?? latest?.wallet_balance ?? latest?.balance;
    if (linkedBalance !== undefined && linkedBalance !== null && linkedBalance !== '') return this.money(Number(linkedBalance));
    return this.money(Number(client.walletBalance ?? client.wallet_balance ?? client.wallet ?? 0));
  }

  private walletTime(value?: ApiRecord): number {
    if (!value) return 0;
    const date = this.parseDate(String(value.createdAt || value.created_at || value.date || value.updatedAt || value.updated_at || ''));
    return Number.isNaN(date.getTime()) ? 0 : date.getTime();
  }

  private buildRows(invoices: ApiRecord[], sales: ApiRecord[], payments: ApiRecord[], clients: ApiRecord[], staff: ApiRecord[], branches: ApiRecord[]): InvoiceRegisterRow[] {
    const saleMap = new Map(sales.map((sale) => [sale.id, sale]));
    const clientMap = new Map(clients.map((client) => [client.id, client]));
    const staffMap = new Map(staff.map((person) => [person.id, person]));
    const branchMap = new Map(branches.map((branch) => [branch.id, branch]));
    const activeInvoices = invoices.filter((invoice) => {
      const status = String(invoice.status || invoice.payment_status || '').toLowerCase();
      return status !== 'deleted';
    });

    return activeInvoices.map((invoice) => {
      const sale = saleMap.get(invoice.saleId) || {};
      const client = clientMap.get(invoice.clientId || sale.clientId) || {};
      const clientId = String(invoice.clientId || sale.clientId || client.id || '');
      const branchId = String(sale.branchId || invoice.branchId || '');
      const staffId = String(sale.staffId || invoice.staffId || '');
      const appointmentId = String(sale.appointmentId || invoice.appointmentId || '');
      const person = staffMap.get(staffId) || {};
      const branch = branchMap.get(branchId) || {};
      const clientPhone = String(
        client.phone ||
          client.mobile ||
          client.whatsapp ||
          client.contact ||
          invoice.clientPhone ||
          invoice.customerPhone ||
          invoice.phone ||
          sale.clientPhone ||
          ''
      );
      const invoiceId = String(invoice.id || invoice.invoiceId || invoice.invoice_id || '');
      const invoicePayments = payments.filter((payment) => this.recordId(payment.invoiceId || payment.invoice_id) === invoiceId);
      const items = this.readArray(invoice.lineItems?.length ? invoice.lineItems : sale.items)
        .map((item) => {
          const itemStaffId = String(item.staffId || item.staff_id || item.assignedStaffId || item.assigned_staff_id || staffId || '');
          const itemStaff = staffMap.get(itemStaffId) || {};
          return {
            ...item,
            staffId: itemStaffId,
            staffName: item.staffName || item.staff_name || item.assignedStaffName || item.assigned_staff_name || itemStaff.name || person.name || 'Unassigned',
            type: this.normalizedItemType(item)
          };
        });
      const tips = this.tipLines(sale);
      const membershipRedeem = this.readJson(sale.membershipRedeem, {});
      const paid = this.money(invoice.paid ?? invoice.paid_amount ?? invoicePayments.reduce((sum, payment) => sum + Number(payment.amount || 0), 0));
      const total = this.money(invoice.total ?? invoice.grand_total ?? sale.total ?? 0);
      const balance = this.money(invoice.balance ?? invoice.due_amount ?? Math.max(0, total - paid));
      const paymentStatus = this.paymentStatusForInvoice(invoice, total, paid, balance);
      const documentStatus = String(invoice.status || '').trim().toLowerCase() || 'saved';
      return {
      id: invoiceId,
      invoiceNumber: invoice.invoiceNumber || invoice.invoice_no || invoice.id,
      clientId,
      clientName: client.name || invoice.clientName || sale.clientName || 'Walk-in client',
      clientPhone,
      branchId,
        branchName: branch.name || branchId || 'Branch',
        staffId,
        staffName: person.name || 'Unassigned',
        appointmentId,
        status: paymentStatus,
        createdAt: invoice.createdAt || invoice.created_at || sale.createdAt || '',
        dueDate: invoice.dueDate || invoice.due_date || invoice.createdAt || invoice.created_at || sale.createdAt || '',
        subtotal: this.money(invoice.subtotal ?? sale.subtotal ?? 0),
        discount: this.money(invoice.discount ?? sale.discount ?? 0),
        gst: this.money(invoice.gstAmount ?? invoice.tax_total ?? sale.gstAmount ?? 0),
        tipTotal: this.money(tips.reduce((sum, tip) => sum + Number(tip.amount || 0), 0)),
        total,
        paid,
        balance,
        paymentStatus,
        documentStatus,
        onlinePaidAmount: this.money(invoice.online_paid_amount ?? 0),
        paymentLinkId: String(invoice.payment_link_id || ''),
        items,
        payments: invoicePayments,
        tips,
        membershipRedeem
      };
    }).sort((a, b) => this.compareInvoiceRows(a, b));
  }

  private compareInvoiceRows(a: InvoiceRegisterRow, b: InvoiceRegisterRow): number {
    const sequenceDelta = this.invoiceSequence(b.invoiceNumber) - this.invoiceSequence(a.invoiceNumber);
    if (sequenceDelta) return sequenceDelta;
    return this.dateMs(b.createdAt) - this.dateMs(a.createdAt) || b.invoiceNumber.localeCompare(a.invoiceNumber);
  }

  private invoiceSequence(invoiceNumber: string): number {
    const match = String(invoiceNumber || '').match(/(\d+)(?!.*\d)/);
    const sequence = match ? Number(match[1]) : 0;
    return Number.isFinite(sequence) ? sequence : 0;
  }

  private isReceivedDuePayment(payment: ApiRecord): boolean {
    const referenceText = [
      payment.reference,
      payment.referenceNo,
      payment.reference_no,
      payment.paymentReference,
      payment.payment_reference,
      payment.remarks,
      payment.note,
      payment.description
    ].join(' ').toLowerCase();
    return referenceText.includes('pos unpaid receive')
      || referenceText.includes('old unpaid')
      || referenceText.includes('receive due')
      || referenceText.includes('received due');
  }

  private recordId(value: unknown): string {
    return String(value || '').trim();
  }

  private rowReceivedDueTotal(row: InvoiceRegisterRow): number {
    return this.money(
      (row.payments || [])
        .filter((payment) => this.isReceivedDuePayment(payment))
        .reduce((sum, payment) => sum + Number(payment.amount || 0), 0)
    );
  }

  private invoiceItemsByType(invoice: InvoiceRegisterRow, type: 'service' | 'product'): ApiRecord[] {
    return (invoice.items || []).filter((item) => this.normalizedItemType(item) === type);
  }

  itemTypeLabel(item: ApiRecord): string {
    const type = this.normalizedItemType(item);
    if (type === 'service') return 'Service';
    if (type === 'product') return 'Product';
    return 'Custom';
  }

  private normalizedItemType(item: ApiRecord): string {
    const rawType = String(item.type || item.itemType || item.kind || '').toLowerCase();
    if (rawType.includes('service')) return 'service';
    if (rawType.includes('product') || rawType.includes('retail')) return 'product';
    return 'custom';
  }

  private paymentStatusForInvoice(invoice: ApiRecord, total: number, paid: number, balance: number): string {
    const explicit = String(invoice.payment_status || '').trim().toLowerCase();
    if (explicit === 'paid' && balance <= 0.01) return 'paid';
    if (['partial', 'partially_paid'].includes(explicit)) return balance <= 0.01 ? 'paid' : paid > 0 ? 'partial' : 'unpaid';
    if (explicit === 'unpaid') return paid > 0 ? 'partial' : 'unpaid';
    return balance <= 0.01 ? 'paid' : paid > 0 && paid < total ? 'partial' : paid > 0 ? 'paid' : 'unpaid';
  }

  private invoiceStateText(row: InvoiceRegisterRow): string {
    return `${row.status} ${row.paymentStatus} ${row.documentStatus}`.toLowerCase();
  }

  private invoiceGrossTotal(invoice: InvoiceRegisterRow): number {
    return this.money((invoice.items || []).reduce((sum, item) => sum + this.lineGross(item), 0));
  }

  private firstValue(record: ApiRecord, keys: string[]): unknown {
    for (const key of keys) {
      const value = record[key];
      if (value !== undefined && value !== null && value !== '') return value;
    }
    return undefined;
  }

  private createInvoiceAudit(
    action: string,
    row: InvoiceRegisterRow,
    severity: 'info' | 'warning',
    extra: ApiRecord = {}
  ) {
    return this.api.create<ApiRecord>('auditLogs', {
      action,
      severity,
      entityType: 'invoice',
      entityId: row.id,
      branchId: row.branchId,
      details: {
        invoiceId: row.id,
        invoiceNumber: row.invoiceNumber,
        clientId: row.clientId,
        clientName: row.clientName,
        clientPhone: row.clientPhone,
        staffId: row.staffId,
        staffName: row.staffName,
        branchId: row.branchId,
        branchName: row.branchName,
        statusBefore: row.status,
        total: row.total,
        paid: row.paid,
        balance: row.balance,
        discount: row.discount,
        items: row.items,
        payments: row.payments,
        source: 'pos-invoices',
        ...extra
      }
    });
  }

  private approvalSnapshot(row: InvoiceRegisterRow): ApiRecord {
    return {
      id: row.id,
      invoiceId: row.id,
      invoiceNumber: row.invoiceNumber,
      clientId: row.clientId,
      clientName: row.clientName,
      clientPhone: row.clientPhone,
      staffId: row.staffId,
      staffName: row.staffName,
      branchId: row.branchId,
      branchName: row.branchName,
      appointmentId: row.appointmentId,
      status: row.status,
      subtotal: row.subtotal,
      discount: row.discount,
      gst: row.gst,
      tipTotal: row.tipTotal,
      total: row.total,
      paid: row.paid,
      balance: row.balance,
      items: row.items,
      payments: row.payments,
      tips: row.tips,
      requestedFrom: 'pos-invoices'
    };
  }

  private tipLines(sale: ApiRecord): ApiRecord[] {
    const membershipRedeem = this.readJson(sale.membershipRedeem, {});
    return Array.isArray(membershipRedeem.tips) ? membershipRedeem.tips : [];
  }

  private readArray(value: unknown): ApiRecord[] {
    if (Array.isArray(value)) return value;
    if (!value) return [];
    try {
      const parsed = JSON.parse(String(value));
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  private readJson(value: unknown, fallback: ApiRecord): ApiRecord {
    if (!value) return fallback;
    if (typeof value === 'object') return value as ApiRecord;
    try {
      return JSON.parse(String(value));
    } catch {
      return fallback;
    }
  }

  private money(value: number | string): number {
    return Math.round((Number(value) || 0) * 100) / 100;
  }

  private onlyDigits(value: unknown): string {
    return String(value || '').replace(/\D/g, '');
  }

  dateTimeLabel(value: unknown): string {
    const raw = String(value || '').trim();
    if (!raw) return '-';
    const date = this.parseDateTime(raw);
    if (Number.isNaN(date.getTime())) return raw;
    return date.toLocaleString('en-IN', {
      day: 'numeric',
      month: 'numeric',
      year: '2-digit',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    });
  }

  dateLabel(value: unknown): string {
    const raw = String(value || '').trim();
    if (!raw) return '-';
    const date = this.parseDateTime(raw);
    if (Number.isNaN(date.getTime())) return raw;
    return date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  }

  private invoiceListParams(): Record<string, string | number> {
    return this.dateRange.preset === 'all' ? { limit: 1000 } : dateRangeParams(this.dateRange, 100, 1000);
  }

  private analyticsParams(): Record<string, string | number> {
    return this.dateRange.preset === 'all' ? {} : { from: this.dateRange.from, to: this.dateRange.to || this.dateRange.from };
  }

  private todayKey(): string {
    return this.dateKey(new Date());
  }

  private rowDateKey(value: string): string {
    return this.dateKey(value);
  }

  private rowInSelectedRange(value: string): boolean {
    if (this.dateRange.preset === 'all') return true;
    const key = this.rowDateKey(value);
    if (!key) return false;
    const from = this.dateRange.from || key;
    const to = this.dateRange.to || from;
    return key >= from && key <= to;
  }

  private formatDateKey(value: string): string {
    if (!value) return '-';
    const [year, month, day] = value.split('-').map(Number);
    const date = new Date(year, Number(month || 1) - 1, day || 1);
    return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  }

  private dateKey(value: string | Date): string {
    const date = value instanceof Date ? value : this.parseDate(value);
    if (Number.isNaN(date.getTime())) return '';
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  private parseDate(value: string): Date {
    const raw = String(value || '').trim();
    const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (match) return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    return new Date(raw);
  }

  private parseDateTime(value: string): Date {
    const raw = String(value || '').trim();
    if (!raw) return new Date('');
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
      const [year, month, day] = raw.split('-').map(Number);
      return new Date(year, Number(month || 1) - 1, day || 1);
    }
    return new Date(raw);
  }

  private dateMs(value: unknown): number {
    const date = this.parseDate(String(value || ''));
    const time = date.getTime();
    return Number.isNaN(time) ? 0 : time;
  }
}
