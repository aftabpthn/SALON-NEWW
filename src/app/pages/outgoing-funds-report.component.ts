import { CommonModule } from '@angular/common';
import { Component, OnInit, computed, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { ApiRecord, ApiService } from '../core/api.service';
import { StateComponent } from '../shared/ui/state/state.component';

type OutgoingLineItem = {
  sno: number;
  type: string;
  accountName: string;
  amount: number;
  salaryMonthYear?: string;
  remarks?: string;
  categoryLabel?: string;
  categoryBucket?: string;
  balanceSheetImpact?: string;
  operating?: boolean;
};

type OutgoingFundEntry = ApiRecord & {
  id: string;
  entryNo: string;
  entryDate: string;
  createdAt?: string;
  updatedAt?: string;
  paidFromAccountName?: string;
  amount: number;
  gstAmount?: number;
  billUrl?: string;
  linkedPartyId?: string;
  linkedPartyType?: string;
  linkedPartyName?: string;
  approvalStatus?: string;
  transactionType?: string;
  lineItems?: OutgoingLineItem[];
  remarks?: string;
  status: string;
};

type ReportRow = {
  id: string;
  entryNo: string;
  entryDate: string;
  savedTime: string;
  type: string;
  accountName: string;
  category: string;
  impact: string;
  link: string;
  approval: string;
  bill: string;
  gstAmount: number;
  amount: number;
  salaryMonthYear: string;
  remarks: string;
};

@Component({
  selector: 'app-outgoing-funds-report',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, StateComponent],
  template: `
    <section class="report-page inner-page-shell">
      <header class="report-hero inner-page-header">
        <div>
          <h2>Outgoing Funds Saved Entries</h2>
        </div>
        <div class="actions inner-action-bar">
          <a class="button primary" routerLink="/transactions/outgoing-funds">New Entry</a>
          <button class="button" type="button" (click)="load()">Refresh</button>
        </div>
      </header>

      <div class="filters">
        <label><span>From</span><input type="date" [ngModel]="fromDate()" (ngModelChange)="fromDate.set($event)" /></label>
        <label><span>To</span><input type="date" [ngModel]="toDate()" (ngModelChange)="toDate.set($event)" /></label>
        <label><span>Search</span><input [ngModel]="query()" (ngModelChange)="query.set($event)" placeholder="OG no, name, type, remarks" /></label>
      </div>

      <app-state [loading]="loading()" [error]="error()"></app-state>

      <section class="summary inner-stats-grid" *ngIf="!loading() && !error()">
        <article><span>Saved rows</span><strong>{{ rows().length }}</strong></article>
        <article><span>Total amount</span><strong>{{ money(total()) }}</strong></article>
        <article><span>Vouchers</span><strong>{{ entries().length }}</strong></article>
        <article><span>Categories</span><strong>{{ categoryCount() }}</strong></article>
        <article><span>Input GST</span><strong>{{ money(gstTotal()) }}</strong></article>
        <article><span>Approval pending</span><strong>{{ pendingApprovalCount() }}</strong></article>
      </section>

      <section class="panel inner-page-card" *ngIf="!loading() && !error()">
        <div class="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Saved Time</th>
                <th>OG No</th>
                <th>Type</th>
                <th>Name</th>
                <th>Salon Category</th>
                <th>BS Impact</th>
                <th>Linked party</th>
                <th>Approval</th>
                <th>Bill</th>
                <th class="r">GST</th>
                <th class="r">Amount</th>
                <th>Salary Month</th>
                <th>Remarks</th>
              </tr>
            </thead>
            <tbody>
              <tr *ngFor="let row of filteredRows()">
                <td>{{ row.entryDate }}</td>
                <td>{{ row.savedTime || '-' }}</td>
                <td>{{ row.entryNo || '-' }}</td>
                <td>{{ row.type }}</td>
                <td>{{ row.accountName }}</td>
                <td>{{ row.category }}</td>
                <td>{{ row.impact }}</td>
                <td>{{ row.link || '-' }}</td>
                <td>{{ row.approval || '-' }}</td>
                <td>{{ row.bill }}</td>
                <td class="r">{{ money(row.gstAmount) }}</td>
                <td class="r">{{ money(row.amount) }}</td>
                <td>{{ row.salaryMonthYear || '-' }}</td>
                <td>{{ row.remarks || '-' }}</td>
              </tr>
              <tr *ngIf="!filteredRows().length">
                <td colspan="14" class="empty">No saved outgoing entry found.</td>
              </tr>
            </tbody>
            <tfoot *ngIf="filteredRows().length">
              <tr>
                <td colspan="11">Grand Total</td>
                <td class="r">{{ money(filteredTotal()) }}</td>
                <td colspan="2"></td>
              </tr>
            </tfoot>
          </table>
        </div>
      </section>
    </section>
  `,
  styles: [`
    .report-page { display: grid; gap: 16px; color: var(--ink); }
    .report-hero, .filters, .panel, .summary article { background: var(--surface); border: 1px solid var(--line); border-radius: 10px; }
    .report-hero { display: flex; justify-content: space-between; gap: 16px; align-items: center; padding: 22px 24px; }
    .report-hero h2 { margin: 4px 0 8px; font-size: 30px; letter-spacing: -.02em; }
    .report-hero p { margin: 0; color: var(--muted); }
    .eyebrow { text-transform: uppercase; font-size: 12px; font-weight: 900; color: var(--muted); letter-spacing: .06em; }
    .actions { display: flex; gap: 10px; flex-wrap: wrap; }
    .button { min-height: 38px; display: inline-flex; align-items: center; border: 1px solid var(--line); border-radius: 8px; padding: 0 14px; background: var(--surface); color: var(--ink); font-weight: 700; text-decoration: none; cursor: pointer; transition: all .15s; }
    .button:hover { border-color: var(--color-primary); color: var(--color-primary); }
    .button.primary { background: var(--color-primary); border-color: var(--color-primary); color: var(--surface); }
    .button.primary:hover { background: var(--color-primary-strong); border-color: var(--color-primary-strong); color: var(--surface); }
    .filters { display: grid; grid-template-columns: 180px 180px minmax(220px, 1fr); gap: 12px; padding: 14px; }
    label { display: grid; gap: 5px; color: var(--ink); font-weight: 700; }
    label span { font-size: 13px; color: var(--muted); }
    input { min-height: 38px; border: 1px solid var(--line); border-radius: 6px; padding: 0 10px; font: inherit; color: var(--ink); background: var(--surface); transition: border-color .15s; }
    input:focus { outline: none; border-color: var(--color-primary); box-shadow: var(--ring-brand); }
    .summary { display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)); gap: 12px; }
    .summary article { padding: 16px; border-top: 4px solid var(--color-primary); transition: border-color .15s; }
    .summary article:hover { border-color: var(--color-primary-strong); }
    .summary span { display: block; color: var(--muted); font-weight: 700; }
    .summary strong { display: block; margin-top: 8px; font-size: 26px; color: var(--color-primary); }
    .panel { overflow: hidden; }
    .table-scroll { overflow: auto; }
    table { width: 100%; border-collapse: collapse; min-width: 1520px; }
    th, td { padding: 10px 12px; border-bottom: 1px solid var(--line); text-align: left; }
    th { background: var(--surface-2); color: var(--ink); font-size: 12px; font-weight: 800; text-transform: uppercase; letter-spacing: .04em; }
    td { color: var(--ink); }
    .r { text-align: right; font-variant-numeric: tabular-nums; }
    tfoot td { font-weight: 900; color: var(--color-primary); border-bottom: 0; }
    .empty { text-align: center; color: var(--muted); padding: 24px; }
    @media (max-width: 820px) { .report-hero { flex-direction: column; align-items: stretch; } .filters, .summary { grid-template-columns: 1fr; } }
  `]
})
export class OutgoingFundsReportComponent implements OnInit {
  readonly entries = signal<OutgoingFundEntry[]>([]);
  readonly purchaseBills = signal<ApiRecord[]>([]);
  readonly loading = signal(true);
  readonly error = signal('');
  readonly query = signal('');
  readonly fromDate = signal('');
  readonly toDate = signal('');

  readonly rows = computed<ReportRow[]>(() => this.entries().flatMap((entry) => {
    const lines = Array.isArray(entry.lineItems) && entry.lineItems.length ? entry.lineItems : [{
      sno: 1,
      type: entry.transactionType || 'Outgoing',
      accountName: String(entry['paidToAccountName'] || entry['payeeName'] || ''),
      amount: moneyValue(entry.amount),
      salaryMonthYear: String(entry['salaryMonthYear'] || ''),
      remarks: entry.remarks || ''
    }];
    return lines.map((line, index) => ({
      id: `${entry.id}:${index}`,
      entryNo: entry.entryNo,
      entryDate: entry.entryDate,
      savedTime: this.savedTime(entry),
      type: line.type || entry.transactionType || 'Outgoing',
      accountName: line.accountName || String(entry['paidToAccountName'] || entry['payeeName'] || ''),
      category: line.categoryLabel || lineCategory(line).label,
      impact: line.balanceSheetImpact || lineCategory(line).impact,
      link: entry.linkedPartyName || entry.linkedPartyType || '',
      approval: entry.approvalStatus || 'pending',
      bill: this.billLabel(entry, line),
      gstAmount: this.rowGstAmount(entry, line, index),
      amount: moneyValue(line.amount),
      salaryMonthYear: line.salaryMonthYear || '',
      remarks: line.remarks || entry.remarks || ''
    }));
  }));

  readonly filteredRows = computed(() => {
    const term = this.query().trim().toLowerCase();
    const from = this.fromDate();
    const to = this.toDate();
    return this.rows().filter((row) => {
      const inRange = (!from || row.entryDate >= from) && (!to || row.entryDate <= to);
      if (!inRange) return false;
      if (!term) return true;
      return [row.entryNo, row.entryDate, row.savedTime, row.type, row.accountName, row.category, row.impact, row.link, row.approval, row.bill, row.salaryMonthYear, row.remarks]
        .some((value) => String(value || '').toLowerCase().includes(term));
    });
  });

  readonly total = computed(() => this.rows().reduce((sum, row) => sum + moneyValue(row.amount), 0));
  readonly filteredTotal = computed(() => this.filteredRows().reduce((sum, row) => sum + moneyValue(row.amount), 0));
  readonly categoryCount = computed(() => new Set(this.filteredRows().map((row) => row.category)).size);
  readonly gstTotal = computed(() => this.rows().reduce((sum, row) => sum + moneyValue(row.gstAmount), 0));
  readonly pendingApprovalCount = computed(() => this.entries().filter((entry) => (entry.approvalStatus || 'pending') === 'pending').length);

  constructor(private readonly api: ApiService) {}

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.error.set('');
    const branchId = this.api.selectedBranchId();
    Promise.all([
      firstValueFrom(this.api.list<OutgoingFundEntry[]>('transactions/outgoing-funds', { branchId, limit: 500 })),
      firstValueFrom(this.api.list<ApiRecord[]>('inventory-intelligence/purchase-bill-drafts', { branchId, limit: 500 })).catch(() => [])
    ]).then(([entries, purchaseBills]) => {
        this.entries.set((entries || []).filter((entry) => entry.status !== 'deleted'));
        this.purchaseBills.set(purchaseBills || []);
        this.loading.set(false);
      })
      .catch((error) => {
        this.error.set(error?.error?.error || error?.message || 'Unable to load saved outgoing entries');
        this.loading.set(false);
      });
  }

  money(value: unknown): string {
    return moneyValue(value).toLocaleString('en-IN', { maximumFractionDigits: 2, minimumFractionDigits: 2 });
  }

  private savedTime(entry: OutgoingFundEntry): string {
    const raw = entry.createdAt || entry.updatedAt || '';
    if (!raw) return '';
    const date = new Date(raw);
    if (Number.isNaN(date.getTime())) return raw;
    return date.toLocaleString('en-IN', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true
    });
  }

  private billLabel(entry: OutgoingFundEntry, line: Partial<OutgoingLineItem>): string {
    return this.purchaseBillNo(entry, line) || stringValue(this.matchingPurchaseBill(entry, line)?.['billNo']) || 'missing';
  }

  private rowGstAmount(entry: OutgoingFundEntry, line: Partial<OutgoingLineItem>, index: number): number {
    if (index > 0) return 0;
    const direct = moneyValue(entry.gstAmount);
    if (direct > 0) return direct;
    return moneyValue(this.matchingPurchaseBill(entry, line)?.['gstAmount']);
  }

  private purchaseBillNo(entry: OutgoingFundEntry, line: Partial<OutgoingLineItem>): string {
    const explicit = stringValue(entry.billUrl);
    if (explicit) return explicit;
    const text = `${entry.remarks || ''} ${line.remarks || ''}`;
    const match = /purchase bill\s+(.+?)(?:\s{2 }|$)/i.exec(text);
    return stringValue(match?.[1]);
  }

  private matchingPurchaseBill(entry: OutgoingFundEntry, line: Partial<OutgoingLineItem>): ApiRecord | undefined {
    const billNo = this.purchaseBillNo(entry, line).toLowerCase();
    const linkedId = stringValue(entry.linkedPartyId).toLowerCase();
    const linkedName = stringValue(entry.linkedPartyName).toLowerCase();
    const amount = moneyValue(entry.amount);
    return this.purchaseBills().find((bill) => {
      const draftBillNo = stringValue(bill['billNo']).toLowerCase();
      const supplierId = stringValue(bill['supplierId']).toLowerCase();
      const draftId = stringValue(bill['id']).toLowerCase();
      const supplierName = stringValue(bill['supplierName']).toLowerCase();
      const sameBill = Boolean(billNo && draftBillNo && draftBillNo === billNo);
      const sameLinkedId = Boolean(linkedId && (supplierId === linkedId || draftId === linkedId));
      const sameLinkedName = Boolean(linkedName && supplierName && supplierName === linkedName);
      const sameAmount = amount > 0 && Math.abs(moneyValue(bill['totalAmount']) - amount) <= 1;
      return sameBill || (sameAmount && (sameLinkedId || sameLinkedName));
    });
  }
}

function moneyValue(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? Math.round(parsed * 100) / 100 : 0;
}

function stringValue(value: unknown): string {
  return String(value ?? '').trim();
}

function lineCategory(line: Partial<OutgoingLineItem>): { key: string; label: string; impact: string } {
  const text = `${line.type || ''} ${line.accountName || ''} ${line.remarks || ''}`.toLowerCase();
  return SALON_CATEGORY_RULES.find((rule) => rule.patterns.some((pattern) => text.includes(pattern))) || SALON_CATEGORY_RULES[SALON_CATEGORY_RULES.length - 1];
}

const SALON_CATEGORY_RULES = [
  { key: 'salary', label: 'Staff Salary', impact: 'Expense reduces profit/equity', patterns: ['staff salary', 'salary', 'payroll', 'wage', 'overtime'] },
  { key: 'staff_commission', label: 'Staff Commission / Incentive', impact: 'Expense reduces profit/equity', patterns: ['staff commission', 'commission', 'incentive'] },
  { key: 'advance', label: 'Staff / Client Advance', impact: 'Advance asset increases', patterns: ['staff advance', 'client advance', 'advance'] },
  { key: 'rent', label: 'Rent / Lease', impact: 'Expense reduces profit/equity', patterns: ['rent', 'lease', 'kiraya'] },
  { key: 'utilities', label: 'Electricity / Water / Internet', impact: 'Expense reduces profit/equity', patterns: ['utility', 'electricity', 'water', 'internet', 'wifi', 'phone'] },
  { key: 'inventory_purchase', label: 'Product Purchase / Inventory', impact: 'Inventory asset or vendor payable', patterns: ['product purchase', 'inventory purchase', 'stock purchase', 'purch. pymt', 'vendor payment'] },
  { key: 'product_consumable', label: 'Product Consumable / COGS', impact: 'COGS/product expense', patterns: ['product consumable', 'consume', 'consumable', 'cogs'] },
  { key: 'wastage_damage', label: 'Wastage / Expiry / Damage', impact: 'Inventory loss impact', patterns: ['wastage', 'waste', 'expiry', 'damage', 'shortage'] },
  { key: 'fixed_asset_purchase', label: 'Fixed Asset Purchase', impact: 'Fixed asset increases', patterns: ['fixed asset', 'chair', 'mirror', 'machine', 'dryer', 'steamer', 'printer', 'computer', 'cctv', 'interior', 'furniture', 'equipment'] },
  { key: 'repair_maintenance', label: 'Repair / Maintenance', impact: 'Expense reduces profit/equity', patterns: ['repair', 'maintenance', 'ac service', 'plumbing', 'amc'] },
  { key: 'cleaning_housekeeping', label: 'Cleaning / Laundry / Housekeeping', impact: 'Expense reduces profit/equity', patterns: ['cleaning', 'laundry', 'towel', 'housekeeping', 'sanitize', 'pest'] },
  { key: 'client_refreshment', label: 'Client Refreshment', impact: 'Expense reduces profit/equity', patterns: ['tea', 'coffee', 'refreshment', 'snack', 'water bottle'] },
  { key: 'uniform', label: 'Uniform / Grooming', impact: 'Expense reduces profit/equity', patterns: ['uniform', 'apron', 'staff dress', 'grooming'] },
  { key: 'stationery', label: 'Stationery / Printing', impact: 'Expense reduces profit/equity', patterns: ['stationery', 'printing', 'paper', 'bill book'] },
  { key: 'marketing', label: 'Marketing / Ads / Referral', impact: 'Expense reduces profit/equity', patterns: ['marketing', 'ads', 'instagram', 'facebook', 'google', 'campaign', 'lead', 'influencer', 'referral', 'banner', 'brochure', 'signage'] },
  { key: 'software_subscription', label: 'Software / SMS / WhatsApp', impact: 'Expense reduces profit/equity', patterns: ['software', 'subscription', 'sms', 'whatsapp', 'crm', 'pos', 'saas', 'domain', 'hosting'] },
  { key: 'bank_charges', label: 'Bank / Payment Gateway Charges', impact: 'Expense reduces profit/equity', patterns: ['bank charges', 'payment charge', 'gateway', 'mdr', 'card charge', 'upi charge', 'fee'] },
  { key: 'professional_legal', label: 'CA / Legal / License', impact: 'Expense reduces profit/equity', patterns: ['legal', 'license', 'licence', 'professional', 'ca', 'audit', 'gst filing', 'compliance'] },
  { key: 'gst_payment', label: 'GST / Tax Payment', impact: 'Tax payable/credit adjusts', patterns: ['gst payment', 'gst paid', 'tax payment', 'gst challan', 'tax challan'] },
  { key: 'statutory_payment', label: 'PF / ESI / PT / TDS Payment', impact: 'Statutory liability reduces', patterns: ['pf', 'esi', 'tds', 'professional tax', 'statutory'] },
  { key: 'security_deposit', label: 'Security Deposit', impact: 'Deposit asset increases', patterns: ['security deposit', 'deposit', 'rent deposit'] },
  { key: 'prepaid_expense', label: 'Prepaid Expense', impact: 'Prepaid asset increases', patterns: ['prepaid', 'advance rent', 'annual subscription', 'yearly subscription'] },
  { key: 'loan', label: 'Loan / EMI Principal', impact: 'Loan liability reduces', patterns: ['loan', 'emi', 'principal'] },
  { key: 'interest', label: 'Interest / Finance Cost', impact: 'Expense reduces profit/equity', patterns: ['interest', 'finance cost'] },
  { key: 'owner_drawing', label: 'Owner Drawing', impact: 'Owner equity/drawing adjusts', patterns: ['owner drawing', 'drawing', 'withdrawal', 'personal'] },
  { key: 'bank_deposit', label: 'Bank Deposit / Cash Transfer', impact: 'Cash/bank movement only', patterns: ['bank depo', 'bank deposit', 'cash deposit', 'cash transfer', 'petty cash transfer'] },
  { key: 'travel', label: 'Travel / Conveyance', impact: 'Expense reduces profit/equity', patterns: ['travel', 'travelling', 'conveyance', 'cab', 'auto', 'fuel'] },
  { key: 'training', label: 'Training / Education', impact: 'Expense reduces profit/equity', patterns: ['training', 'course', 'education', 'academy'] },
  { key: 'other', label: 'Other Salon Outgoing', impact: 'Review required', patterns: ['other out', 'misc', 'daily exp', 'expense'] }
];
