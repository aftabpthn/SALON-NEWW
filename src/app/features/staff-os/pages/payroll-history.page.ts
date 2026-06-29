import { CommonModule, CurrencyPipe, DatePipe } from '@angular/common';
import { Component, OnInit, effect, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ApiRecord, ApiService } from '../../../core/api.service';
import { StateComponent } from '../../../shared/ui/state/state.component';

@Component({
  standalone: true,
  imports: [CommonModule, CurrencyPipe, DatePipe, FormsModule, RouterLink, StateComponent],
  template: `
    <section class="page-stack">
      <div class="module-hero">
        <div>
          <span class="eyebrow">Staff OS / Payroll</span>
          <h2>Payroll History</h2>
          <p>Generated salary runs, staff-wise net payout, statutory deductions, approval and paid status in one report.</p>
        </div>
        <div class="hero-actions">
          <a class="ghost-button" routerLink="/staff-os/payroll-dashboard">Payroll Dashboard</a>
          <a class="ghost-button" routerLink="/staff-os/salary-generate">Salary Generate</a>
          <button class="ghost-button" type="button" (click)="exportCsv()">CSV</button>
          <button class="ghost-button" type="button" (click)="exportOwnerPdf()">Owner PDF</button>
          <button class="ghost-button" type="button" (click)="load()">Refresh</button>
        </div>
      </div>

      <section class="panel filter-panel">
        <label class="field">
          <span>From</span>
          <input type="date" [(ngModel)]="from" />
        </label>
        <label class="field">
          <span>To</span>
          <input type="date" [(ngModel)]="to" />
        </label>
        <label class="field">
          <span>Status</span>
          <select [(ngModel)]="status">
            <option value="">All status</option>
            <option value="draft">Draft</option>
            <option value="approved">Approved</option>
            <option value="paid">Paid</option>
          </select>
        </label>
        <label class="field">
          <span>Search</span>
          <input [(ngModel)]="query" placeholder="Staff, mobile, code, payroll run" />
        </label>
        <div class="branch-context-card">
          <span>Header branch</span>
          <strong>{{ branchLabel() }}</strong>
          <small>Change branch only from top header.</small>
        </div>
        <button class="primary-button" type="button" (click)="load()">Apply filters</button>
      </section>

      <app-state [loading]="loading()" [error]="error()"></app-state>

      <ng-container *ngIf="report() as data">
        <div class="metrics-grid">
          <article class="metric-card">
            <span>Payroll runs</span>
            <strong>{{ data.summary?.payrollRuns || 0 }}</strong>
            <small>{{ data.summary?.payrollRows || 0 }} staff salary rows</small>
          </article>
          <article class="metric-card">
            <span>Gross payroll</span>
            <strong>{{ data.summary?.grossAmount || 0 | currency:'INR':'symbol':'1.0-0' }}</strong>
            <small>Before deductions</small>
          </article>
          <article class="metric-card">
            <span>Deductions</span>
            <strong>{{ data.summary?.deductionAmount || 0 | currency:'INR':'symbol':'1.0-0' }}</strong>
            <small>PF, ESIC, TDS, PT and adjustments</small>
          </article>
          <article class="metric-card">
            <span>Net salary</span>
            <strong>{{ data.summary?.netAmount || 0 | currency:'INR':'symbol':'1.0-0' }}</strong>
            <small>{{ data.summary?.staffPaid || 0 }} staff covered</small>
          </article>
          <article class="metric-card">
            <span>Paid amount</span>
            <strong>{{ data.summary?.paidAmount || 0 | currency:'INR':'symbol':'1.0-0' }}</strong>
            <small>{{ data.summary?.paidRows || 0 }} paid rows</small>
          </article>
          <article class="metric-card warn">
            <span>Pending payout</span>
            <strong>{{ data.summary?.pendingAmount || 0 | currency:'INR':'symbol':'1.0-0' }}</strong>
            <small>{{ data.summary?.draftRows || 0 }} draft · {{ data.summary?.approvedRows || 0 }} approved</small>
          </article>
        </div>

        <section class="panel">
          <div class="section-title">
            <div>
              <span class="eyebrow">Payroll ledger</span>
              <h2>Run and staff-wise salary history</h2>
            </div>
            <span class="badge">{{ data.rows?.length || 0 }} rows</span>
          </div>
          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Payroll run</th>
                  <th>Period</th>
                  <th>Generated</th>
                  <th>Staff</th>
                  <th>Contact</th>
                  <th>Branch</th>
                  <th>Gross</th>
                  <th>Deductions</th>
                  <th>Net salary</th>
                  <th>PF</th>
                  <th>ESIC</th>
                  <th>TDS</th>
                  <th>PT</th>
                  <th>OT / Bonus</th>
                  <th>Payment</th>
                  <th>Status</th>
                  <th>Approved</th>
                  <th>Paid</th>
                  <th>Pending days</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                <tr *ngFor="let row of data.rows || []">
                  <td><strong>{{ row.payrollRunId }}</strong><small>{{ row.payrollItemId }}</small></td>
                  <td>{{ row.periodStart | date:'dd MMM yyyy' }} - {{ row.periodEnd | date:'dd MMM yyyy' }}</td>
                  <td>{{ row.generatedDate | date:'dd MMM yyyy' }} <small>{{ row.generatedTime }}</small></td>
                  <td><strong>{{ row.staffName }}</strong><small>{{ row.staffCode || row.staffId }}</small></td>
                  <td>{{ row.staffContact || '-' }}</td>
                  <td>{{ row.branchName || row.branchId || '-' }}</td>
                  <td>{{ row.grossAmount | currency:'INR':'symbol':'1.0-0' }}</td>
                  <td>{{ row.deductionAmount | currency:'INR':'symbol':'1.0-0' }}</td>
                  <td><strong>{{ row.netAmount | currency:'INR':'symbol':'1.0-0' }}</strong></td>
                  <td>{{ row.pf | currency:'INR':'symbol':'1.0-0' }}</td>
                  <td>{{ row.esic | currency:'INR':'symbol':'1.0-0' }}</td>
                  <td>{{ row.tds | currency:'INR':'symbol':'1.0-0' }}</td>
                  <td>{{ row.professionalTax | currency:'INR':'symbol':'1.0-0' }}</td>
                  <td>{{ row.overtimeAmount | currency:'INR':'symbol':'1.0-0' }} / {{ row.bonusAmount | currency:'INR':'symbol':'1.0-0' }}</td>
                  <td>{{ row.paymentMode || '-' }}<small>{{ row.bankName || '' }}</small></td>
                  <td><span class="badge" [class.warn]="row.status !== 'paid'">{{ row.status }}</span></td>
                  <td>{{ row.approvedAt ? (row.approvedAt | date:'dd MMM yyyy, h:mm a') : '-' }}</td>
                  <td>{{ row.paidAt ? (row.paidAt | date:'dd MMM yyyy, h:mm a') : '-' }}</td>
                  <td>{{ row.pendingDays || 0 }}</td>
                  <td class="row-actions">
                    <a class="ghost-button mini" routerLink="/staff-os/staff-profile" [queryParams]="{ staffId: row.staffId }">Staff</a>
                    <a class="ghost-button mini" routerLink="/staff-os/salary-generate" [queryParams]="{ payrollRunId: row.payrollRunId }">Run</a>
                  </td>
                </tr>
                <tr *ngIf="!(data.rows || []).length">
                  <td colspan="20">No payroll history found for selected filters.</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
      </ng-container>
    </section>
  `,
  styles: [`
    .filter-panel {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr)) 1.2fr auto;
      gap: 12px;
      align-items: end;
    }
    .metric-card {
      background: #fff;
      border: 1px solid var(--border);
      border-radius: 8px;
      border-top: 4px solid var(--primary);
      box-shadow: var(--shadow-sm);
      padding: 18px;
    }
    .metric-card.warn {
      border-top-color: #c77700;
    }
    .metric-card span,
    .metric-card small {
      color: var(--muted);
      display: block;
    }
    .metric-card strong {
      display: block;
      font-size: 28px;
      margin: 8px 0 4px;
    }
    .table-wrap {
      overflow: auto;
    }
    table {
      min-width: 1900px;
      width: 100%;
      border-collapse: collapse;
    }
    th,
    td {
      border-bottom: 1px solid var(--border);
      padding: 12px;
      text-align: left;
      vertical-align: top;
      white-space: nowrap;
    }
    th {
      color: var(--muted);
      font-size: 12px;
      text-transform: uppercase;
    }
    td small {
      color: var(--muted);
      display: block;
      margin-top: 4px;
    }
    .badge {
      background: #eef7f4;
      border-radius: 999px;
      color: #0f766e;
      display: inline-flex;
      font-size: 12px;
      font-weight: 800;
      padding: 4px 10px;
      text-transform: capitalize;
    }
    .badge.warn {
      background: #fff7ed;
      color: #9a3412;
    }
    .row-actions {
      display: flex;
      gap: 8px;
    }
    @media (max-width: 900px) {
      .filter-panel {
        grid-template-columns: 1fr;
      }
    }
  `]
})
export class PayrollHistoryPage implements OnInit {
  readonly report = signal<ApiRecord | null>(null);
  readonly loading = signal(false);
  readonly error = signal('');

  from = '';
  to = '';
  status = '';
  query = '';
  private initialized = false;

  constructor(private readonly api: ApiService) {
    effect(() => {
      this.api.selectedBranchId();
      if (this.initialized) this.load();
    });
  }

  ngOnInit(): void {
    this.initialized = true;
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.error.set('');
    this.api.list<ApiRecord>('staff-os/payroll/history-report', {
      branchId: this.api.selectedBranchId(),
      from: this.from,
      to: this.to,
      status: this.status,
      q: this.query
    }).subscribe({
      next: (report) => {
        this.report.set(report);
        this.loading.set(false);
      },
      error: (error) => {
        this.error.set(error?.error?.error || 'Unable to load payroll history');
        this.loading.set(false);
      }
    });
  }

  branchLabel(): string {
    return this.api.selectedBranchId() || 'All accessible branches';
  }

  exportCsv(): void {
    const rows = (this.report()?.rows || []) as ApiRecord[];
    const headers = ['Payroll run', 'Payroll item', 'Period start', 'Period end', 'Generated date', 'Generated time', 'Staff', 'Staff code', 'Contact', 'Branch', 'Gross', 'Deductions', 'Net', 'PF', 'ESIC', 'TDS', 'PT', 'OT', 'Bonus', 'Payment mode', 'Bank', 'Status', 'Approved at', 'Paid at', 'Pending days'];
    const csvRows = rows.map((row) => [
      row['payrollRunId'],
      row['payrollItemId'],
      row['periodStart'],
      row['periodEnd'],
      row['generatedDate'],
      row['generatedTime'],
      row['staffName'],
      row['staffCode'],
      row['staffContact'],
      row['branchName'] || row['branchId'],
      row['grossAmount'],
      row['deductionAmount'],
      row['netAmount'],
      row['pf'],
      row['esic'],
      row['tds'],
      row['professionalTax'],
      row['overtimeAmount'],
      row['bonusAmount'],
      row['paymentMode'],
      row['bankName'],
      row['status'],
      row['approvedAt'],
      row['paidAt'],
      row['pendingDays']
    ].map((value) => this.csvCell(value)).join(','));
    this.downloadFile(`payroll-history-${Date.now()}.csv`, [headers.map((value) => this.csvCell(value)).join(','), ...csvRows].join('\n'), 'text/csv;charset=utf-8');
  }

  exportOwnerPdf(): void {
    const data = this.report();
    const summary = data?.summary || {};
    this.downloadFile(`payroll-history-owner-${Date.now()}.pdf`, this.simplePdf([
      'Payroll History Owner Summary',
      `Generated: ${new Date().toLocaleString('en-IN')}`,
      `Payroll runs: ${summary['payrollRuns'] || 0}`,
      `Staff salary rows: ${summary['payrollRows'] || 0}`,
      `Gross payroll: ${this.money(summary['grossAmount'])}`,
      `Deductions: ${this.money(summary['deductionAmount'])}`,
      `Net salary: ${this.money(summary['netAmount'])}`,
      `Paid amount: ${this.money(summary['paidAmount'])}`,
      `Pending payout: ${this.money(summary['pendingAmount'])}`
    ]), 'application/pdf');
  }

  private money(value: unknown): string {
    return `INR ${Number(value || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
  }

  private csvCell(value: unknown): string {
    return `"${String(value ?? '').replace(/"/g, '""')}"`;
  }

  private downloadFile(filename: string, content: string, type: string): void {
    const blob = new Blob([content], { type });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    link.click();
    URL.revokeObjectURL(link.href);
  }

  private simplePdf(lines: string[]): string {
    return `%PDF-1.4
1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj
2 0 obj<</Type/Pages/Count 1/Kids[3 0 R]>>endobj
3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj
4 0 obj<</Length ${lines.join('\\n').length + 80}>>stream
BT /F1 12 Tf 40 750 Td ${lines.map((line, index) => `${index ? '0 -18 Td ' : ''}(${line.replace(/[()]/g, '')}) Tj`).join(' ')} ET
endstream endobj
5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj
trailer<</Root 1 0 R>>
%%EOF`;
  }
}
