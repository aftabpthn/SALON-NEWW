import { Component, inject, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { ApiEnvelope, ApiService } from '../../../shared/services/api.service';

type Supplier = { id: string; code: string; name: string; gstin: string; contactName: string; phone: string; email: string };
type LedgerSummary = { billsPaise: number; paidPaise: number; outstandingPaise: number; advancePaise: number; pendingBillsPaise: number };
type Payable = { purchaseReceiptId: string; sourceType: string; supplierInvoiceNumber: string; receivedDate: string; dueDate?: string; totalPaise: number; returnedPaise: number; paidPaise: number; balancePaise: number };
type PendingBill = { id: string; billNumber: string; billDate?: string; totalPaise: number; status: string };
type LedgerEntry = { id: string; entryType: string; entryDate: string; particulars: string; reference: string; debitPaise: number; creditPaise: number; balancePaise: number };
type SupplierLedger = { supplier: Supplier; summary: LedgerSummary; payables: Payable[]; pendingBills: PendingBill[]; entries: LedgerEntry[] };

@Component({
  selector: 'page-supplier-ledger',
  imports: [FormsModule],
  templateUrl: './supplier-ledger-page.component.html',
  styleUrls: ['./supplier-ledger-page.component.css'],
})
export class SupplierLedgerPageComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  ledger: SupplierLedger | null = null;
  loading = true;
  saving = false;
  error = '';
  notice = '';
  paymentOpen = false;
  paymentDraft = this.emptyPayment();

  ngOnInit() { void this.reload(); }

  get supplierId() { return this.route.snapshot.paramMap.get('supplierId')?.trim() || ''; }
  get openPayables() { return this.ledger?.payables.filter((row) => row.balancePaise > 0) || []; }
  selectedPayable() { return this.openPayables.find((row) => row.purchaseReceiptId === this.paymentDraft.receiptId); }

  async reload() {
    this.loading = true;
    this.error = '';
    try {
      this.ledger = await this.get<SupplierLedger>(`/purchases/suppliers/${encodeURIComponent(this.supplierId)}/ledger`);
    } catch (error) {
      this.ledger = null;
      this.error = this.message(error, 'Unable to load supplier ledger');
    } finally {
      this.loading = false;
    }
  }

  back() { void this.router.navigate(['/suppliers']); }
  reviewBill(id: string) { void this.router.navigate(['/purchase-bill-drafts', id]); }

  openPayment() {
    const payable = this.openPayables[0];
    this.paymentDraft = {
      ...this.emptyPayment(),
      receiptId: payable?.purchaseReceiptId || '',
      amount: payable ? (payable.balancePaise / 100).toFixed(2) : '',
    };
    this.error = '';
    this.notice = '';
    this.paymentOpen = true;
  }

  selectPaymentBill(receiptId: string) {
    const payable = this.openPayables.find((row) => row.purchaseReceiptId === receiptId);
    this.paymentDraft.receiptId = receiptId;
    this.paymentDraft.amount = payable ? (payable.balancePaise / 100).toFixed(2) : '';
  }

  closePayment() {
    if (!this.saving) this.paymentOpen = false;
  }

  async savePayment() {
    const payable = this.selectedPayable();
    const amountPaise = this.toPaise(this.paymentDraft.amount);
    if (!payable) {
      this.error = 'Select an unpaid purchase bill';
      return;
    }
    if (amountPaise <= 0) {
      this.error = 'Enter a valid payment amount';
      return;
    }
    this.saving = true;
    this.error = '';
    this.notice = '';
    try {
      await firstValueFrom(this.api.post('/purchases/payments', {
        purchaseReceiptId: payable.purchaseReceiptId,
        amountPaise,
        paymentMethod: this.paymentDraft.method,
        reference: this.paymentDraft.reference.trim() || null,
        idempotencyKey: crypto.randomUUID(),
      }));
      const excessPaise = Math.max(amountPaise - payable.balancePaise, 0);
      this.notice = excessPaise > 0
        ? `Bill settled; ${this.money(excessPaise)} saved as supplier advance`
        : 'Supplier payment recorded';
      this.paymentDraft = this.emptyPayment();
      await this.reload();
    } catch (error) {
      this.error = this.message(error, 'Unable to record supplier payment');
    } finally {
      this.saving = false;
    }
  }

  exportLedger() {
    if (!this.ledger) return;
    const rows = [
      ['Date', 'Particulars', 'Reference', 'Debit', 'Credit', 'Balance'],
      ...this.ledger.entries.map((row) => [
        this.displayDate(row.entryDate), row.particulars, row.reference,
        (row.debitPaise / 100).toFixed(2), (row.creditPaise / 100).toFixed(2),
        (row.balancePaise / 100).toFixed(2),
      ]),
    ];
    const blob = new Blob([rows.map((row) => row.map(this.csvCell).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${this.ledger.supplier.code || 'supplier'}-ledger.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  money(paise: number) {
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format((paise || 0) / 100);
  }

  balance(paise: number) {
    if (!paise) return this.money(0);
    return `${this.money(Math.abs(paise))} ${paise > 0 ? 'Cr' : 'Dr'}`;
  }

  displayDate(value?: string) {
    const match = value?.slice(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})$/);
    return match ? `${match[3]}/${match[2]}/${match[1]}` : '—';
  }

  status(value: string) { return value.replaceAll('_', ' ').replace(/^\w/, (letter) => letter.toUpperCase()); }

  private toPaise(value: string) {
    const rupees = Number(value);
    return Number.isFinite(rupees) ? Math.round(rupees * 100) : 0;
  }

  private csvCell(value: unknown) { return `"${String(value ?? '').replaceAll('"', '""')}"`; }

  private async get<T>(path: string) {
    const response = await firstValueFrom(this.api.get<ApiEnvelope<T>>(path));
    if (!response.success || response.data === undefined) throw new Error(response.error?.message || 'API response did not contain data');
    return response.data;
  }

  private message(error: any, fallback: string) {
    return error?.error?.error?.message ?? error?.error?.message ?? error?.message ?? fallback;
  }

  private emptyPayment() { return { receiptId: '', amount: '', method: 'bank', reference: '' }; }
}
