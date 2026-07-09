import { CommonModule } from '@angular/common';
import { Component, OnInit, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { ApiRecord, ApiService } from '../core/api.service';
import { StateComponent } from '../shared/ui/state/state.component';

@Component({
  selector: 'app-petty-cash-entry',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, RouterLink, StateComponent],
  template: `
    <section class="petty-page inner-page-shell">
      <header class="titlebar inner-page-header">
        <div>
          <span class="eyebrow">Finance / Petty Cash</span>
          <h2>Petty Cash Entry</h2>
        </div>
        <div class="title-actions inner-action-bar">
          <a class="ghost-button" routerLink="/transactions/petty-cash-report">Report</a>
          <a class="ghost-button" routerLink="/finance">Exit</a>
        </div>
      </header>

      <app-state [loading]="loading()" [error]="error()"></app-state>
      <p class="state success" *ngIf="success()">{{ success() }}</p>

      <form class="entry-panel inner-page-card" [formGroup]="form" (ngSubmit)="save()" *ngIf="!loading()">
        <section class="form-grid inner-form-grid">
          <label>
            <span>Branch</span>
            <select formControlName="branchId">
              <option value="">Select branch</option>
              <option *ngFor="let branch of branches()" [value]="branch.id">{{ branch.name }}</option>
            </select>
          </label>
          <label>
            <span>Doc Date</span>
            <input type="date" formControlName="docDate" />
          </label>
          <label>
            <span>Type</span>
            <select formControlName="type" (change)="syncTypeDefaults()">
              <option value="OPENING">Opening Balance</option>
              <option value="IN">IN - Cash Received</option>
              <option value="OUT">OUT - Expense</option>
            </select>
          </label>
          <label>
            <span>Category</span>
            <select formControlName="category">
              <option value="opening_balance">Opening Balance</option>
              <option value="bank_withdrawal">Bank Withdrawal</option>
              <option value="owner_cash">Owner Cash</option>
              <option value="repair">Repair</option>
              <option value="tea">Tea / Refreshment</option>
              <option value="cleaning">Cleaning</option>
              <option value="laundry">Laundry</option>
              <option value="transport">Transport</option>
              <option value="other_expense">Other Expense</option>
            </select>
          </label>
          <label>
            <span>Prefix</span>
            <input formControlName="prefix" />
          </label>
          <label>
            <span>Doc No</span>
            <input formControlName="docNo" placeholder="Auto if blank" />
          </label>
          <label class="wide">
            <span>Particular</span>
            <input formControlName="particular" placeholder="Cash from bank / expense head" />
          </label>
          <label>
            <span>Source A/c</span>
            <input formControlName="sourceAccount" placeholder="Bank / Owner / Cash" />
          </label>
          <label>
            <span>Amount</span>
            <input type="number" min="0" step="0.01" formControlName="amount" />
          </label>
          <label>
            <span>Paymode</span>
            <select formControlName="paymode">
              <option value="Cash">Cash</option>
              <option value="UPI">UPI</option>
              <option value="Card">Card</option>
              <option value="Bank">Bank</option>
              <option value="Cheque">Cheque</option>
            </select>
          </label>
          <label>
            <span>Cheque No</span>
            <input formControlName="chequeNo" />
          </label>
          <label>
            <span>Staff Name</span>
            <input formControlName="staffName" placeholder="Cash handover to" />
          </label>
          <label>
            <span>Approval</span>
            <select formControlName="approvalStatus">
              <option value="not_required">Not Required</option>
              <option value="pending">Pending</option>
              <option value="approved">Approved</option>
              <option value="rejected">Rejected</option>
            </select>
          </label>
          <label class="wide remarks">
            <span>Remarks</span>
            <textarea formControlName="remarks"></textarea>
          </label>
        </section>

        <footer class="toolbar">
          <button class="ghost-button" type="button" (click)="startNew()">Cancel</button>
          <button class="ghost-button" type="button" (click)="printVoucher()">Print Voucher</button>
          <button class="primary-button" type="submit" [disabled]="form.invalid || saving()">{{ editingId() ? 'Update' : 'Save' }}</button>
        </footer>
      </form>
    </section>
  `,
  styles: [`
    :host { display: block; }
    .petty-page { display: grid; gap: 14px; padding: 18px; background: #eef8f5; color: #0f172a; }
    .titlebar, .entry-panel { border: 1px solid #9eb2b7; background: #d8ebe7; box-shadow: inset 0 0 0 1px rgba(255,255,255,.6); }
    .titlebar { display: flex; justify-content: space-between; align-items: center; padding: 10px 12px; background: #5b9998; color: #fff; }
    .titlebar h2 { margin: 0; letter-spacing: 0; }
    .title-actions { display: flex; gap: 8px; }
    .eyebrow { display: block; color: inherit; opacity: .78; font-size: 11px; font-weight: 900; text-transform: uppercase; }
    .ghost-button, .primary-button { border: 1px solid #8da1a7; background: #fff; color: #0f172a; border-radius: 2px; padding: 8px 13px; font-weight: 900; cursor: pointer; text-decoration: none; }
    .primary-button { background: #0f8f79; border-color: #0f8f79; color: #fff; }
    .entry-panel { display: grid; gap: 14px; padding: 14px; }
    .form-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; align-items: end; }
    label { display: grid; gap: 5px; font-weight: 900; }
    label span { color: #475569; font-size: 13px; }
    input, select, textarea { min-height: 36px; border: 1px solid #8da1a7; background: #fff; padding: 6px 8px; font: inherit; }
    textarea { min-height: 74px; resize: vertical; }
    .wide { grid-column: span 2; }
    .remarks { grid-column: span 4; }
    .toolbar { display: flex; justify-content: flex-end; gap: 8px; border-top: 1px solid #9eb2b7; padding-top: 12px; }
    .state.success { border: 1px solid #86efac; background: #f0fdf4; color: #166534; padding: 10px 12px; font-weight: 900; }
    @media (max-width: 900px) {
      .titlebar { align-items: stretch; flex-direction: column; }
      .form-grid { grid-template-columns: 1fr; }
      .wide, .remarks { grid-column: auto; }
      .toolbar { justify-content: stretch; flex-wrap: wrap; }
      .toolbar button { flex: 1 1 140px; }
    }
  `]
})
export class PettyCashEntryComponent implements OnInit {
  readonly loading = signal(false);
  readonly saving = signal(false);
  readonly error = signal('');
  readonly success = signal('');
  readonly branches = signal<ApiRecord[]>([]);
  readonly editingId = signal('');

  readonly form = this.fb.group({
    branchId: ['', Validators.required],
    docDate: [new Date().toISOString().slice(0, 10), Validators.required],
    type: ['OUT', Validators.required],
    category: ['other_expense'],
    prefix: ['OG'],
    docNo: [''],
    billNumber: [''],
    billDate: [''],
    particular: ['', Validators.required],
    sourceAccount: [''],
    amount: [0, [Validators.required, Validators.min(0.01)]],
    paymode: ['Cash'],
    chequeNo: [''],
    staffName: [''],
    approvalStatus: ['not_required'],
    remarks: ['']
  });

  constructor(
    private readonly api: ApiService,
    private readonly fb: FormBuilder,
    private readonly route: ActivatedRoute,
    private readonly router: Router
  ) {}

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.error.set('');
    this.api.list<ApiRecord[]>('branches').subscribe({
      next: (branches) => {
        this.branches.set(branches || []);
        if (!this.form.value.branchId) {
          this.form.patchValue({ branchId: this.api.selectedBranchId() || branches?.[0]?.id || '' });
        }
        const editId = this.route.snapshot.queryParamMap.get('edit') || '';
        if (editId) {
          this.loadEntry(editId);
          return;
        }
        this.loading.set(false);
      },
      error: (error) => {
        this.error.set(this.api.errorText(error, 'Unable to load petty cash entry'));
        this.loading.set(false);
      }
    });
  }

  loadEntry(id: string): void {
    this.api.get<ApiRecord>('transactions/petty-cash', id).subscribe({
      next: (entry) => {
        this.editingId.set(String(entry.id || ''));
        this.form.reset({
          branchId: entry.branchId || this.api.selectedBranchId() || '',
          docDate: entry.docDate || new Date().toISOString().slice(0, 10),
          type: entry.type || 'OUT',
          category: entry.category || 'other_expense',
          prefix: entry.prefix || this.prefixFor(entry.type || 'OUT'),
          docNo: entry.docNo || '',
          billNumber: entry.billNumber || '',
          billDate: entry.billDate || '',
          particular: entry.particular || '',
          sourceAccount: entry.sourceAccount || '',
          amount: Number(entry.amount || 0),
          paymode: entry.paymode || 'Cash',
          chequeNo: entry.chequeNo || '',
          staffName: entry.staffName || '',
          approvalStatus: entry.approvalStatus || 'not_required',
          remarks: entry.remarks || ''
        });
        this.loading.set(false);
      },
      error: (error) => {
        this.error.set(this.api.errorText(error, 'Unable to open petty cash entry'));
        this.loading.set(false);
      }
    });
  }

  syncTypeDefaults(): void {
    const type = String(this.form.value.type || 'OUT');
    const current = String(this.form.value.prefix || '').trim().toUpperCase();
    if (!current || current === 'OR' || current === 'OG' || current === 'OP') {
      this.form.patchValue({ prefix: this.prefixFor(type) });
    }
    if (type === 'OPENING') this.form.patchValue({ category: 'opening_balance' });
    if (type === 'IN' && this.form.value.category === 'other_expense') this.form.patchValue({ category: 'bank_withdrawal' });
    if (type === 'OUT' && ['opening_balance', 'bank_withdrawal', 'owner_cash'].includes(String(this.form.value.category || ''))) this.form.patchValue({ category: 'other_expense' });
  }

  save(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const branch = this.branches().find((item) => item.id === this.form.value.branchId) || {};
    const payload = {
      ...this.form.value,
      branchName: branch.name || '',
      amount: Number(this.form.value.amount || 0)
    };
    this.saving.set(true);
    this.error.set('');
    this.success.set('');
    const request = this.editingId()
      ? this.api.update<ApiRecord>('transactions/petty-cash', this.editingId(), payload)
      : this.api.create<ApiRecord>('transactions/petty-cash', payload);
    request.subscribe({
      next: (entry) => {
        this.saving.set(false);
        this.editingId.set(String(entry.id || ''));
        this.success.set(this.editingId() ? 'Petty cash entry saved.' : 'Petty cash entry saved.');
        void this.router.navigate(['/transactions/petty-cash-report']);
      },
      error: (error) => {
        this.error.set(this.api.errorText(error, 'Unable to save petty cash entry'));
        this.saving.set(false);
      }
    });
  }

  startNew(): void {
    this.editingId.set('');
    this.success.set('');
    this.error.set('');
    this.form.reset({
      branchId: this.api.selectedBranchId() || this.branches()[0]?.id || '',
      docDate: new Date().toISOString().slice(0, 10),
      type: 'OUT',
      category: 'other_expense',
      prefix: 'OG',
      docNo: '',
      billNumber: '',
      billDate: '',
      particular: '',
      sourceAccount: '',
      amount: 0,
      paymode: 'Cash',
      chequeNo: '',
      staffName: '',
      approvalStatus: 'not_required',
      remarks: ''
    });
  }

  printVoucher(): void {
    window.print();
  }

  private prefixFor(type: string): string {
    if (type === 'OPENING') return 'OP';
    return type === 'IN' ? 'OR' : 'OG';
  }
}
