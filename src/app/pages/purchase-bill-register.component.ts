import { CommonModule } from '@angular/common';
import { Component, OnInit, computed, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { ApiRecord, ApiService } from '../core/api.service';
import { InventoryZenotiChromeComponent } from '../shared/ui/inventory-zenoti-chrome/inventory-zenoti-chrome.component';
import { StateComponent } from '../shared/ui/state/state.component';
import { AuraMoneyPipe } from '../shared/pipes/aura-money.pipe';
import { AuraDatePipe } from '../shared/pipes/aura-date.pipe';

@Component({
  selector: 'app-purchase-bill-register',
  standalone: true,
  imports: [AuraDatePipe, AuraMoneyPipe, CommonModule, FormsModule, RouterLink, InventoryZenotiChromeComponent, StateComponent],
  template: `
    <section class="purchase-register-page inner-page-shell">
      <app-inventory-zenoti-chrome
        title="Purchase Bill Register"
        breadcrumb="Inventory > Purchases > Saved Purchase Bills"
        (refresh)="load()"
      >
        <div zenoti-actions class="register-actions">
          <a routerLink="/inventory/purchase-bill-entry">New Bill</a>
          <button type="button" (click)="load()">Refresh</button>
        </div>
      </app-inventory-zenoti-chrome>

      <app-state [loading]="loading()" [error]="error()"></app-state>

      <section class="filters inner-form-grid">
        <label>
          <span>Branch</span>
          <select [ngModel]="branchId()" (ngModelChange)="branchId.set($event); load()">
            <option value="">All branches</option>
            <option *ngFor="let branch of branches()" [value]="branch.id">{{ branch.name }}</option>
          </select>
        </label>
        <label>
          <span>Find</span>
          <input [ngModel]="query()" (ngModelChange)="query.set($event)" placeholder="Bill no, vendor, amount" />
        </label>
      </section>

      <section class="summary-grid inner-stats-grid">
        <article><span>Bills</span><strong>{{ filteredBills().length }}</strong></article>
        <article><span>Purchase</span><strong>{{ totalAmount() | auraMoney:'1.0-0' }}</strong></article>
        <article><span>Input GST</span><strong>{{ totalGst() | auraMoney:'1.0-0' }}</strong></article>
        <article><span>Pending payable</span><strong>{{ pendingPayableTotal() | auraMoney:'1.0-0' }}</strong></article>
      </section>

      <section class="table-panel report-panel inner-page-card">
        <h3>GST Register</h3>
        <table>
          <thead>
            <tr>
              <th>GST %</th>
              <th>Taxable</th>
              <th>Tax</th>
              <th>Amount</th>
            </tr>
          </thead>
          <tbody>
            <tr *ngFor="let row of gstRegister()">
              <td>{{ row.gstPercent }}%</td>
              <td>{{ row.taxable | auraMoney:'1.0-0' }}</td>
              <td>{{ row.tax | auraMoney:'1.0-0' }}</td>
              <td>{{ row.amount | auraMoney:'1.0-0' }}</td>
            </tr>
            <tr *ngIf="!gstRegister().length">
              <td colspan="4" class="empty">No GST purchase rows found.</td>
            </tr>
          </tbody>
        </table>
      </section>

      <section class="table-panel report-panel inner-page-card">
        <h3>Vendor Purchases</h3>
        <table>
          <thead>
            <tr>
              <th>Vendor</th>
              <th>Bills</th>
              <th>Purchase</th>
              <th>Payable</th>
            </tr>
          </thead>
          <tbody>
            <tr *ngFor="let row of vendorPurchases()">
              <td>{{ row.vendor || 'Vendor not set' }}</td>
              <td>{{ row.bills }}</td>
              <td>{{ row.purchase | auraMoney:'1.0-0' }}</td>
              <td>{{ row.payable | auraMoney:'1.0-0' }}</td>
            </tr>
            <tr *ngIf="!vendorPurchases().length">
              <td colspan="4" class="empty">No vendor purchase rows found.</td>
            </tr>
          </tbody>
        </table>
      </section>

      <section class="table-panel report-panel inner-page-card">
        <h3>Pending Payables</h3>
        <table>
          <thead>
            <tr>
              <th>Bill</th>
              <th>Vendor</th>
              <th>Date</th>
              <th>Balance</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            <tr *ngFor="let bill of pendingPayables()">
              <td>{{ bill.billNo || '-' }}</td>
              <td>{{ bill.supplierName || 'Vendor not set' }}</td>
              <td>{{ (bill.billDate || bill.createdAt) | auraDate:'date' }}</td>
              <td>{{ billBalance(bill) | auraMoney:'1.0-0' }}</td>
              <td class="actions"><a routerLink="/transactions/outgoing-funds" [queryParams]="paymentQuery(bill)">Outgoing Entry</a></td>
            </tr>
            <tr *ngIf="!pendingPayables().length">
              <td colspan="5" class="empty">No pending payable purchase bill found.</td>
            </tr>
          </tbody>
        </table>
      </section>

      <section class="table-panel saved-panel">
        <small>FIND/EDIT</small>
        <h3>Saved purchase bills</h3>
        <table>
          <thead>
            <tr>
              <th>Bill</th>
              <th>Date</th>
              <th>Vendor</th>
              <th>Status</th>
              <th>Payment</th>
              <th>Total</th>
              <th>Balance</th>
              <th>Extra fee</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            <tr *ngFor="let bill of filteredBills()">
              <td><strong>{{ bill.billNo || '-' }}</strong></td>
              <td>{{ (bill.billDate || bill.createdAt) | auraDate:'date' }}</td>
              <td>{{ bill.supplierName || 'Vendor pending' }}</td>
              <td>{{ billStatusLabel(bill) }}</td>
              <td>{{ paymentStatusLabel(bill) }}</td>
              <td>{{ numberValue(bill.totalAmount) | auraMoney:'1.0-0' }}</td>
              <td>{{ billBalanceLabel(bill) }}</td>
              <td>{{ billExtraPaid(bill) > 0 ? (billExtraPaid(bill) | auraMoney:'1.0-0') : '-' }}</td>
              <td class="actions">
                <a routerLink="/inventory/purchase-bill-drafts">Edit</a>
                <a *ngIf="billBalance(bill) > 0" routerLink="/transactions/outgoing-funds" [queryParams]="paymentQuery(bill)">Outgoing Entry</a>
              </td>
            </tr>
            <tr *ngIf="!filteredBills().length">
              <td colspan="9" class="empty">No saved purchase bills found.</td>
            </tr>
          </tbody>
        </table>
      </section>
    </section>
  `,
  styles: [`
    .purchase-register-page {
      background: #f6f8fb;
      color: #1d2733;
      display: grid;
      gap: 14px;
      padding: 14px;
    }

    .register-actions,
    .filters,
    .summary-grid,
    .actions {
      align-items: center;
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }

    .register-actions a,
    .register-actions button,
    .actions a {
      background: #fff;
      border: 1px solid #b9d0e7;
      border-radius: 3px;
      color: #075f9e;
      cursor: pointer;
      font: inherit;
      font-weight: 900;
      padding: 8px 12px;
      text-decoration: none;
    }

    .filters {
      background: #fff;
      border: 1px solid #d4dee8;
      padding: 12px;
    }

    .filters label {
      display: grid;
      gap: 5px;
      min-width: 220px;
    }

    .filters label:nth-child(2) {
      flex: 1;
    }

    .filters span {
      color: #63748a;
      font-size: 12px;
      font-weight: 900;
    }

    input,
    select {
      border: 1px solid #c6d3df;
      border-radius: 3px;
      font: inherit;
      min-height: 38px;
      padding: 8px 10px;
    }

    .summary-grid {
      display: grid;
      grid-template-columns: repeat(4, minmax(150px, 1fr));
    }

    .summary-grid article {
      background: #fff;
      border: 1px solid #d4dee8;
      border-top: 4px solid #5b1744;
      padding: 12px;
    }

    .summary-grid span {
      color: #63748a;
      display: block;
      font-size: 12px;
      font-weight: 900;
    }

    .summary-grid strong {
      display: block;
      font-size: 22px;
      margin-top: 6px;
    }

    .table-panel {
      background: #fff;
      border: 1px solid #d4dee8;
      overflow: auto;
    }

    .report-panel,
    .saved-panel {
      background: #fff;
      border: 1px solid #bfd4d1;
    }

    .report-panel h3,
    .saved-panel h3 {
      margin: 0;
      padding: 12px;
    }

    .saved-panel small {
      display: block;
      font-size: 12px;
      font-weight: 900;
      padding: 12px 12px 0;
    }

    table {
      border-collapse: collapse;
      min-width: 960px;
      width: 100%;
    }

    th,
    td {
      border-bottom: 1px solid #e1e7ee;
      padding: 12px;
      text-align: left;
      vertical-align: top;
    }

    th {
      background: #f1f5f9;
      color: #526176;
      font-size: 12px;
      font-weight: 900;
      text-transform: uppercase;
    }

    .status-pill {
      background: #fff7ed;
      border: 1px solid #fed7aa;
      border-radius: 999px;
      color: #9a3412;
      display: inline-block;
      font-size: 12px;
      font-weight: 900;
      padding: 4px 10px;
    }

    .status-pill.confirmed {
      background: #ecfdf3;
      border-color: #bbf7d0;
      color: #166534;
    }

    .empty {
      color: #63748a;
      font-weight: 800;
      text-align: center;
    }

    @media (max-width: 900px) {
      .summary-grid {
        grid-template-columns: 1fr;
      }
    }
  `]
})
export class PurchaseBillRegisterComponent implements OnInit {
  readonly bills = signal<ApiRecord[]>([]);
  readonly branches = signal<ApiRecord[]>([]);
  readonly outgoingPayments = signal<ApiRecord[]>([]);
  readonly loading = signal(true);
  readonly error = signal('');
  readonly query = signal('');
  readonly branchId = signal('');

  readonly filteredBills = computed(() => {
    const term = this.query().trim().toLowerCase();
    return this.bills().filter((bill) => {
      if (!term) return true;
      return [
        bill.billNo,
        bill.supplierName,
        bill.status,
        bill.totalAmount,
        bill.gstAmount
      ].some((value) => String(value ?? '').toLowerCase().includes(term));
    });
  });
  readonly totalAmount = computed(() => this.filteredBills().reduce((sum, bill) => sum + this.numberValue(bill.totalAmount), 0));
  readonly totalGst = computed(() => this.filteredBills().reduce((sum, bill) => sum + this.numberValue(bill.gstAmount), 0));
  readonly pendingPayables = computed(() => this.filteredBills().filter((bill) => this.billBalance(bill) > 0));
  readonly pendingPayableTotal = computed(() => this.pendingPayables().reduce((sum, bill) => sum + this.billBalance(bill), 0));
  readonly gstRegister = computed(() => {
    const rows = new Map<number, { gstPercent: number; taxable: number; tax: number; amount: number }>();
    this.filteredBills().forEach((bill) => {
      const items = Array.isArray(bill.items) ? bill.items : [];
      if (!items.length) {
        const tax = this.numberValue(bill.gstAmount);
        const amount = this.numberValue(bill.totalAmount);
        const taxable = Math.max(0, amount - tax);
        const percent = taxable > 0 && tax > 0 ? Math.round((tax / taxable) * 100) : 0;
        const row = rows.get(percent) || { gstPercent: percent, taxable: 0, tax: 0, amount: 0 };
        row.taxable += taxable;
        row.tax += tax;
        row.amount += amount;
        rows.set(percent, row);
        return;
      }
      items.forEach((item) => {
        const percent = this.numberValue(item['gstPercent'] ?? item['gstRate']);
        const tax = this.numberValue(item['gstAmount']);
        const amount = this.numberValue(item['lineTotal']);
        const taxable = this.numberValue(item['taxableAmount']) || Math.max(0, amount - tax);
        const row = rows.get(percent) || { gstPercent: percent, taxable: 0, tax: 0, amount: 0 };
        row.taxable += taxable;
        row.tax += tax;
        row.amount += amount;
        rows.set(percent, row);
      });
    });
    return Array.from(rows.values()).filter((row) => row.amount > 0).sort((a, b) => a.gstPercent - b.gstPercent);
  });
  readonly vendorPurchases = computed(() => {
    const rows = new Map<string, { vendor: string; bills: number; purchase: number; payable: number }>();
    this.filteredBills().forEach((bill) => {
      const vendor = String(bill.supplierName || 'Vendor not set').trim();
      const row = rows.get(vendor) || { vendor, bills: 0, purchase: 0, payable: 0 };
      row.bills += 1;
      row.purchase += this.numberValue(bill.totalAmount);
      row.payable += this.billBalance(bill);
      rows.set(vendor, row);
    });
    return Array.from(rows.values());
  });

  constructor(private readonly api: ApiService) {}

  ngOnInit(): void {
    this.branchId.set(this.api.selectedBranchId());
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.error.set('');
    Promise.all([
      firstValueFrom(this.api.list<ApiRecord[]>('inventory-intelligence/purchase-bill-drafts', {
        branchId: this.branchId(),
        limit: 500
      })),
      firstValueFrom(this.api.list<ApiRecord[]>('transactions/outgoing-funds', {
        branchId: this.branchId(),
        limit: 1000
      })).catch(() => []),
      firstValueFrom(this.api.list<ApiRecord[]>('branches')).catch(() => [])
    ]).then(([bills, outgoingPayments, branches]) => {
      this.bills.set(bills || []);
      this.outgoingPayments.set((outgoingPayments || []).filter((entry) => entry['status'] !== 'deleted'));
      this.branches.set(branches || []);
      this.loading.set(false);
    }).catch((error) => {
      this.error.set(this.api.errorText(error, 'Unable to load saved purchase bills'));
      this.loading.set(false);
    });
  }

  paymentQuery(bill: ApiRecord): ApiRecord {
    const pendingAmount = this.billBalance(bill);
    return {
      source: 'purchaseBill',
      draftId: bill.id || '',
      supplierId: bill.supplierId || '',
      supplierName: bill.supplierName || '',
      billNo: bill.billNo || '',
      amount: pendingAmount > 0 ? pendingAmount : this.numberValue(bill.totalAmount),
      gstAmount: this.numberValue(bill.gstAmount),
      billUrl: bill.billNo || '',
      paymentDate: new Date().toISOString().slice(0, 10)
    };
  }

  billStatusLabel(bill: ApiRecord): string {
    const base = bill.status === 'confirmed' ? 'Posted' : 'Posted editable';
    return `${base} - ${this.paymentStatusLabel(bill)}`;
  }

  billBalance(bill: ApiRecord): number {
    const paid = this.billPaidAmount(bill);
    const total = this.numberValue(bill.totalAmount);
    if (paid > 0) return Math.max(0, total - paid);
    const explicit = bill['balanceAmount'];
    if (explicit !== undefined && explicit !== null && explicit !== '') return Math.max(0, this.numberValue(explicit));
    const paymentStatus = String(bill['paymentStatus'] || bill['payableStatus'] || '').toLowerCase();
    if (paymentStatus.includes('paid') || bill['paid'] === true) return 0;
    return total;
  }

  billBalanceLabel(bill: ApiRecord): string {
    const total = this.numberValue(bill.totalAmount);
    const paid = this.billPaidAmount(bill);
    if (paid <= 0) return this.currencyText(this.billBalance(bill));
    if (paid < total) return this.currencyText(total - paid);
    return 'Paid';
  }

  paymentStatusLabel(bill: ApiRecord): string {
    const total = this.numberValue(bill.totalAmount);
    const paid = this.billPaidAmount(bill);
    if (paid <= 0) return 'Pending';
    if (paid < total) return 'Part payment';
    if (paid > total) return 'Extra paid';
    return 'Paid';
  }

  billExtraPaid(bill: ApiRecord): number {
    return Math.max(0, this.billPaidAmount(bill) - this.numberValue(bill.totalAmount));
  }

  billPaidAmount(bill: ApiRecord): number {
    const linkedPaid = this.linkedOutgoingPayments(bill).reduce((sum, entry) => sum + this.numberValue(entry['amount']), 0);
    if (linkedPaid > 0) return linkedPaid;
    return this.numberValue(bill['paidAmount'] ?? bill['paymentAmount']);
  }

  private linkedOutgoingPayments(bill: ApiRecord): ApiRecord[] {
    const billNo = normalizeMatchValue(bill.billNo);
    const supplierId = normalizeMatchValue(bill.supplierId);
    const supplierName = normalizeMatchValue(bill.supplierName);
    const total = this.numberValue(bill.totalAmount);
    if (!billNo && !supplierId && !supplierName) return [];
    return this.outgoingPayments().filter((entry) => {
      const approvalStatus = stringValue(entry['approvalStatus'] || entry['approval_status'] || 'not_required').toLowerCase();
      if (approvalStatus === 'rejected' || approvalStatus === 'pending') return false;
      const paymentBillNo = normalizeMatchValue(this.outgoingPurchaseBillNo(entry));
      const paymentText = normalizeMatchValue(this.outgoingPaymentText(entry));
      const linkedId = normalizeMatchValue(entry['linkedPartyId'] || entry['linked_party_id']);
      const linkedName = normalizeMatchValue(entry['linkedPartyName'] || entry['linked_party_name']);
      const sameBill = Boolean(billNo && (paymentBillNo === billNo || paymentText.includes(billNo)));
      if (sameBill) return true;

      const sameSupplier = Boolean((supplierId && linkedId && linkedId === supplierId) || (supplierName && linkedName && linkedName === supplierName));
      const sameAmount = total > 0 && Math.abs(this.numberValue(entry['amount']) - total) <= 1;
      return sameSupplier && sameAmount;
    });
  }

  private outgoingPurchaseBillNo(entry: ApiRecord): string {
    const text = this.outgoingPaymentText(entry);
    const match = /purchase bill\s+(.+?)(?:\s+against\s+purchase bill|\s{2 }|$)/i.exec(text);
    const extracted = stringValue(match?.[1]);
    if (extracted) return extracted;
    return stringValue(entry['billUrl']).split(/against\s+purchase bill/i)[0].trim();
  }

  private outgoingPaymentText(entry: ApiRecord): string {
    return [
      entry['billUrl'],
      entry['remarks'],
      ...((Array.isArray(entry['lineItems']) ? entry['lineItems'] : []) as ApiRecord[]).map((line) => line['remarks'])
    ].map((value) => stringValue(value)).filter(Boolean).join(' ');
  }

  private currencyText(value: number): string {
    return `₹${this.numberValue(value).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
  }

  numberValue(value: unknown): number {
    const parsed = Number(value ?? 0);
    return Number.isFinite(parsed) ? Math.round(parsed * 100) / 100 : 0;
  }
}

function stringValue(value: unknown): string {
  return String(value ?? '').trim();
}

function normalizeMatchValue(value: unknown): string {
  return stringValue(value).toLowerCase().replace(/[^a-z0-9]/g, '');
}
