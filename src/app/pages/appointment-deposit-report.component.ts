import { CommonModule } from '@angular/common';
import { Component, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { ApiRecord, ApiService } from '../core/api.service';
import { StateComponent } from '../shared/ui/state/state.component';
import { AuraMoneyPipe } from '../shared/pipes/aura-money.pipe';
import { AuraDatePipe } from '../shared/pipes/aura-date.pipe';

type SettlementFilter = 'all' | 'advance_adjusted' | 'counter_due' | 'adjusted_due';

@Component({
  selector: 'app-appointment-deposit-report',
  standalone: true,
  imports: [AuraDatePipe, AuraMoneyPipe, CommonModule, FormsModule, StateComponent],
  styles: [`
    .settlement-notice { margin: 0 0 12px; padding: 10px 14px; border: 1px solid #E7DDD6; border-radius: 12px; background: #FAF8F6; color: #4B1238; }
    .follow-up-cell { display: grid; gap: 4px; min-width: 150px; }
    .follow-up-cell strong { text-transform: capitalize; }
    .table-actions { display: flex; gap: 8px; flex-wrap: wrap; min-width: 280px; }
  `],
  template: `
    <section class="page-stack inner-page-shell">
      <div class="module-hero inner-page-header">
        <div>
          <h2>Advance Payment Report</h2>
        </div>
        <div class="action-row inner-action-bar">
          <button class="ghost-button mini" type="button" *ngIf="adjustedDuePendingCount() > 0" (click)="focusAdjustedDueFollowUp()">
            Follow-up pending {{ adjustedDuePendingCount() }}
          </button>
          <button class="ghost-button mini" type="button" (click)="exportCsv()" [disabled]="!filteredRows().length">Export CSV</button>
          <button class="ghost-button mini" type="button" (click)="exportPdf()" [disabled]="!filteredRows().length">Export PDF</button>
          <button class="primary-button" type="button" (click)="load()">Refresh</button>
        </div>
      </div>

      <section class="panel">
        <div class="toolbar compact">
          <label><span>From</span><input type="date" [(ngModel)]="from" /></label>
          <label><span>To</span><input type="date" [(ngModel)]="to" /></label>
          <label>
            <span>Settlement</span>
            <select [(ngModel)]="settlementFilter">
              <option value="all">All</option>
              <option value="advance_adjusted">Advance adjusted</option>
              <option value="counter_due">Counter due</option>
              <option value="adjusted_due">Adjusted + due</option>
            </select>
          </label>
          <button class="ghost-button" type="button" (click)="load()">Apply</button>
        </div>
      </section>

      <app-state [loading]="loading()" [error]="error()"></app-state>
      <p class="settlement-notice" *ngIf="notice()">{{ notice() }}</p>

      <section class="metrics-grid inner-stats-grid">
        <article class="metric-card"><span>Links</span><strong>{{ filteredRows().length }}</strong><small>{{ settlementFilterLabel() }}</small></article>
        <article class="metric-card"><span>Total advance</span><strong>{{ (stats().totalAmount || 0) | auraMoney:'1.0-0' }}</strong></article>
        <article class="metric-card"><span>Advance adjusted</span><strong>{{ filteredAdvanceAdjustedTotal() | auraMoney:'1.0-0' }}</strong></article>
        <article class="metric-card"><span>Counter paid</span><strong>{{ filteredCounterPaidTotal() | auraMoney:'1.0-0' }}</strong></article>
        <article class="metric-card"><span>Counter due</span><strong>{{ filteredCounterDueTotal() | auraMoney:'1.0-0' }}</strong></article>
      </section>

      <section class="panel">
        <div class="section-title inner-action-bar">
          <div>
            <h2>Deposit links</h2>
            <small>{{ settlementFilterLabel() }} view for staff follow-up and billing handoff.</small>
          </div>
        </div>
        <div class="table-wrap inner-table-wrap">
          <table>
            <thead>
              <tr>
                <th>Client</th>
                <th>Service</th>
                <th>Appointment</th>
                <th>Amount</th>
                <th>Advance adjusted</th>
                <th>Counter paid</th>
                <th>Counter due</th>
                <th>Follow-up</th>
                <th>Status</th>
                <th>Payment link</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              <tr *ngFor="let row of filteredRows()">
                <td><strong>{{ row.clientName || row.clientId }}</strong><small>{{ row.clientPhone }}</small></td>
                <td>{{ row.serviceNames || row.serviceIds?.join(', ') || '-' }}</td>
                <td><span>{{ row.appointmentStartAt | auraDate:'date' }}</span><small>{{ row.appointmentStatus }}</small></td>
                <td>{{ row.amount | auraMoney:'1.0-0' }}</td>
                <td>{{ (row.advanceAdjusted || 0) | auraMoney:'1.0-0' }}</td>
                <td>{{ (row.counterPaid || 0) | auraMoney:'1.0-0' }}</td>
                <td>
                  <strong>{{ rowCounterDue(row) | auraMoney:'1.0-0' }}</strong>
                  <small *ngIf="rowCounterDue(row) > 0">counter due</small>
                </td>
                <td>
                  <div class="follow-up-cell">
                    <strong>{{ rowFollowUpStatus(row) }}</strong>
                    <small>{{ rowFollowUpMeta(row) }}</small>
                  </div>
                </td>
                <td><span class="badge">{{ row.depositStatus }}</span></td>
                <td><a *ngIf="row.paymentLink" [href]="row.paymentLink" target="_blank" rel="noreferrer">Open</a><span *ngIf="!row.paymentLink">-</span></td>
                <td>
                  <div class="table-actions">
                    <button class="ghost-button mini" type="button" *ngIf="row.invoiceId" (click)="openInvoice(row)">Open invoice</button>
                    <button class="ghost-button mini" type="button" *ngIf="row.appointmentId" (click)="openAppointment(row)">Open appointment</button>
                    <button class="ghost-button mini" type="button" *ngIf="row.invoiceId && rowCounterDue(row) > 0" [disabled]="actionLoading() === rowActionKey(row, 'reminder')" (click)="sendReminder(row)">
                      {{ actionLoading() === rowActionKey(row, 'reminder') ? 'Sending...' : 'Send reminder' }}
                    </button>
                    <button class="primary-button mini" type="button" *ngIf="rowCounterDue(row) > 0 && rowFollowUpStatus(row) !== 'done'" [disabled]="actionLoading() === rowActionKey(row, 'done')" (click)="markFollowUpDone(row)">
                      {{ actionLoading() === rowActionKey(row, 'done') ? 'Saving...' : 'Mark done' }}
                    </button>
                  </div>
                </td>
              </tr>
              <tr *ngIf="!filteredRows().length"><td colspan="11">No advance payment records found for this settlement filter.</td></tr>
            </tbody>
          </table>
        </div>
      </section>
    </section>
  `
})
export class AppointmentDepositReportComponent implements OnInit {
  readonly rows = signal<ApiRecord[]>([]);
  readonly stats = signal<ApiRecord>({});
  readonly loading = signal(false);
  readonly error = signal('');
  readonly notice = signal('');
  readonly actionLoading = signal('');
  settlementFilter: SettlementFilter = 'all';
  from = '';
  to = '';

  constructor(
    private readonly api: ApiService,
    private readonly route: ActivatedRoute,
    private readonly router: Router
  ) {}

  ngOnInit(): void {
    const today = new Date();
    const first = new Date(today.getFullYear(), today.getMonth(), 1);
    this.from = first.toISOString().slice(0, 10);
    this.to = today.toISOString().slice(0, 10);
    this.settlementFilter = this.settlementFilterFromQuery(this.route.snapshot.queryParamMap.get('settlement'));
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.error.set('');
    this.api.list<{ stats: ApiRecord; rows: ApiRecord[] }>('appointment-deposits/report', { from: this.from, to: this.to }).subscribe({
      next: (result) => {
        this.stats.set(result.stats || {});
        this.rows.set(result.rows || []);
        this.loading.set(false);
      },
      error: (error) => {
        this.error.set(this.api.errorText(error, 'Unable to load appointment deposit report'));
        this.loading.set(false);
      }
    });
  }

  filteredRows(): ApiRecord[] {
    const filter = this.settlementFilter;
    return this.rows().filter((row) => {
      const advanceAdjusted = Number(row.advanceAdjusted || 0);
      const counterDue = this.rowCounterDue(row);
      if (filter === 'advance_adjusted') return advanceAdjusted > 0;
      if (filter === 'counter_due') return counterDue > 0;
      if (filter === 'adjusted_due') return advanceAdjusted > 0 && counterDue > 0;
      return true;
    });
  }

  filteredAdvanceAdjustedTotal(): number {
    return this.filteredRows().reduce((sum, row) => sum + Number(row.advanceAdjusted || 0), 0);
  }

  filteredCounterPaidTotal(): number {
    return this.filteredRows().reduce((sum, row) => sum + Number(row.counterPaid || 0), 0);
  }

  filteredCounterDueTotal(): number {
    return this.filteredRows().reduce((sum, row) => sum + this.rowCounterDue(row), 0);
  }

  adjustedDuePendingCount(): number {
    return this.rows().filter((row) => Number(row.advanceAdjusted || 0) > 0 && this.rowCounterDue(row) > 0).length;
  }

  settlementFilterLabel(): string {
    const labels: Record<SettlementFilter, string> = {
      all: 'all deposit links',
      advance_adjusted: 'advance adjusted only',
      counter_due: 'counter due only',
      adjusted_due: 'advance adjusted with counter due'
    };
    return labels[this.settlementFilter];
  }

  rowCounterDue(row: ApiRecord): number {
    return Math.max(0, Number(row.counterDue || 0));
  }

  rowFollowUpStatus(row: ApiRecord): string {
    const status = String(row.followUpStatus || '').trim().toLowerCase();
    if (status === 'done') return 'done';
    if (status === 'reminder_sent') return 'reminder sent';
    if (Number(row.advanceAdjusted || 0) > 0 && this.rowCounterDue(row) > 0) return 'pending';
    if (this.rowCounterDue(row) === 0 && Number(row.advanceAdjusted || 0) > 0) return 'settled';
    return 'watch';
  }

  rowFollowUpMeta(row: ApiRecord): string {
    if (row.followUpDoneAt) return `closed ${this.formatDateTime(String(row.followUpDoneAt))}`;
    if (row.followUpReminderSentAt) return `reminder ${this.formatDateTime(String(row.followUpReminderSentAt))}`;
    if (row.followUpUpdatedAt) return `updated ${this.formatDateTime(String(row.followUpUpdatedAt))}`;
    if (this.rowCounterDue(row) > 0) return 'needs front desk recovery';
    return 'no action due';
  }

  focusAdjustedDueFollowUp(): void {
    this.settlementFilter = 'adjusted_due';
  }

  private settlementFilterFromQuery(value: string | null): SettlementFilter {
    if (value === 'advance_adjusted' || value === 'counter_due' || value === 'adjusted_due') {
      return value;
    }
    return 'all';
  }

  rowActionKey(row: ApiRecord, action: string): string {
    return `${row.paymentLinkId || row.appointmentId || 'row'}:${action}`;
  }

  openInvoice(row: ApiRecord): void {
    const invoiceId = String(row.invoiceId || '');
    if (!invoiceId) return;
    this.router.navigate(['/pos/invoices'], { queryParams: { invoice: invoiceId } });
  }

  openAppointment(row: ApiRecord): void {
    const appointmentId = String(row.appointmentId || '');
    if (!appointmentId) return;
    this.router.navigate(['/appointments'], {
      queryParams: {
        appointmentId,
        date: String(row.appointmentStartAt || '').slice(0, 10)
      }
    });
  }

  sendReminder(row: ApiRecord): void {
    const invoiceId = String(row.invoiceId || '');
    if (!invoiceId) return;
    this.notice.set('');
    this.error.set('');
    this.actionLoading.set(this.rowActionKey(row, 'reminder'));
    this.api.post(`payments/invoices/${invoiceId}/reminder`, {
      channel: 'whatsapp',
      provider: 'razorpay'
    }).subscribe({
      next: () => this.saveFollowUp(row, {
        invoiceId,
        status: 'reminder_sent',
        reminderChannel: 'whatsapp',
        note: 'WhatsApp payment reminder queued.'
      }, 'WhatsApp payment reminder queued.'),
      error: (error) => {
        this.error.set(this.api.errorText(error, 'Unable to send payment reminder'));
        this.actionLoading.set('');
      }
    });
  }

  markFollowUpDone(row: ApiRecord): void {
    this.notice.set('');
    this.error.set('');
    this.actionLoading.set(this.rowActionKey(row, 'done'));
    this.saveFollowUp(row, {
      invoiceId: String(row.invoiceId || ''),
      status: 'done',
      note: 'Front desk follow-up completed.'
    }, 'Follow-up marked done.');
  }

  private saveFollowUp(row: ApiRecord, payload: ApiRecord, notice: string): void {
    this.api.patch<ApiRecord>(`appointment-deposits/followups/${row.paymentLinkId}`, payload).subscribe({
      next: (followUp) => {
        this.rows.update((rows) => rows.map((entry) => entry.paymentLinkId === row.paymentLinkId ? ({
          ...entry,
          followUpStatus: followUp.status || payload.status || '',
          followUpReminderChannel: followUp.reminderChannel || payload.reminderChannel || '',
          followUpReminderSentAt: followUp.reminderSentAt || '',
          followUpDoneAt: followUp.doneAt || '',
          followUpNote: followUp.note || payload.note || '',
          followUpUpdatedAt: followUp.updatedAt || new Date().toISOString()
        }) : entry));
        this.notice.set(notice);
        this.actionLoading.set('');
      },
      error: (error) => {
        this.error.set(this.api.errorText(error, 'Unable to update follow-up'));
        this.actionLoading.set('');
      }
    });
  }

  exportCsv(): void {
    const rows = this.filteredRows();
    if (!rows.length) return;
    const headers = ['clientName', 'clientPhone', 'serviceNames', 'appointmentStartAt', 'amount', 'advanceAdjusted', 'counterPaid', 'counterDue', 'depositStatus', 'paymentLink'];
    const csv = [
      headers.join(','),
      ...rows.map((row) => headers.map((header) => this.csvCell(row[header])).join(','))
    ].join('\n');
    this.downloadFile(`appointment-deposit-report-${this.todayKey()}.csv`, csv, 'text/csv;charset=utf-8');
  }

  exportPdf(): void {
    const rows = this.filteredRows();
    if (!rows.length) return;
    const lines = [
      'Aura Salon OS - Appointment Deposit Report',
      `Generated: ${this.formatDateTime(new Date().toISOString())}`,
      `Settlement filter: ${this.settlementFilterLabel()}`,
      `Rows: ${rows.length}`,
      `Advance adjusted: INR ${this.filteredAdvanceAdjustedTotal().toFixed(2)}`,
      `Counter paid: INR ${this.filteredCounterPaidTotal().toFixed(2)}`,
      `Counter due: INR ${this.filteredCounterDueTotal().toFixed(2)}`,
      '',
      ...rows.slice(0, 40).map((row) => `${row.clientName || row.clientId} | ${row.serviceNames || '-'} | Adv ${Number(row.advanceAdjusted || 0).toFixed(2)} | Counter ${Number(row.counterPaid || 0).toFixed(2)} | Due ${this.rowCounterDue(row).toFixed(2)}`)
    ];
    this.downloadFile(`appointment-deposit-report-${this.todayKey()}.pdf`, this.simplePdf(lines), 'application/pdf');
  }

  private csvCell(value: unknown): string {
    return `"${String(value ?? '').replace(/"/g, '""')}"`;
  }

  private downloadFile(filename: string, content: BlobPart, type: string): void {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  private todayKey(): string {
    return new Date().toISOString().slice(0, 10);
  }

  private formatDateTime(value: string): string {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '-';
    return new Intl.DateTimeFormat('en-IN', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    }).format(date);
  }

  private simplePdf(lines: string[]): string {
    const stream = [
      'BT',
      '/F1 10 Tf',
      '50 780 Td',
      '14 TL',
      ...lines.slice(0, 75).flatMap((line) => [`(${this.pdfText(line).slice(0, 110)}) Tj`, 'T*']),
      'ET'
    ].join('\n');
    const objects = [
      '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
      '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
      '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>\nendobj\n',
      '4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n',
      `5 0 obj\n<< /Length ${stream.length} >>\nstream\n${stream}\nendstream\nendobj\n`
    ];
    let pdf = '%PDF-1.4\n';
    const offsets: number[] = [];
    objects.forEach((object) => {
      offsets.push(pdf.length);
      pdf += object;
    });
    const xrefOffset = pdf.length;
    pdf += `xref\n0 ${objects.length + 1}\n`;
    pdf += '0000000000 65535 f \n';
    pdf += offsets.map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
    pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
    return pdf;
  }

  private pdfText(value: unknown): string {
    return String(value ?? '')
      .replace(/[^\x09\x0A\x0D\x20-\x7E]/g, ' ')
      .replace(/[\\()]/g, '\\$&')
      .replace(/[\r\n]+/g, ' ');
  }
}
