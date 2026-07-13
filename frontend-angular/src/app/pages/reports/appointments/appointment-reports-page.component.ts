import { CommonModule } from '@angular/common';
import { Component, OnInit, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { DatePickerComponent } from '../../../shared/date-picker/date-picker.component';
import { ApiService } from '../../../shared/services/api.service';

type TimelineEvent = { id: string; action: string; reason?: string; createdAt?: string; created_at?: string; };
type ReportRow = {
  appointmentId: string; bookingGroupId?: string; clientId?: string; clientName?: string; clientPhone?: string;
  branchId?: string; staffId?: string; staffName?: string; serviceNames?: string; appointmentStartAt?: string;
  appointmentEndAt?: string; status?: string; invoiceNumber?: string; invoiceId?: string; total?: number;
  bookingMode?: string;
  paid?: number; balance?: number; paymentStatus?: string; messageStatus?: { status?: string; count?: number };
  cancelReason?: string; notes?: string; problemFlags?: string[]; timeline?: TimelineEvent[];
};
type Option = { id: string; name: string };

@Component({
  selector: 'app-appointment-reports-page',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, DatePickerComponent],
  templateUrl: './appointment-reports-page.component.html',
  styleUrls: ['./appointment-reports-page.component.css'],
})
export class AppointmentReportsPageComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly http = inject(HttpClient);

  rows: ReportRow[] = [];
  staff: Option[] = [];
  branches: Option[] = [];
  selected: ReportRow | null = null;
  loading = false;
  error = '';
  search = '';
  branchId = '';
  staffId = '';
  status = '';
  fromDate = '';
  toDate = '';
  reportGeneratedAt = '';

  ngOnInit(): void { void this.reload(); }

  get filteredRows(): ReportRow[] {
    const query = this.search.trim().toLowerCase();
    const from = this.fromDate ? new Date(`${this.fromDate}T00:00:00`).getTime() : 0;
    const to = this.toDate ? new Date(`${this.toDate}T23:59:59`).getTime() : 0;
    return this.rows.filter((row) => {
      const time = new Date(row.appointmentStartAt || '').getTime();
      const haystack = [row.appointmentId, row.bookingGroupId, row.clientName, row.clientPhone, row.staffName, row.serviceNames, row.invoiceNumber].join(' ').toLowerCase();
      return (!query || haystack.includes(query))
        && (!this.branchId || row.branchId === this.branchId)
        && (!this.staffId || row.staffId === this.staffId)
        && (!this.status || this.normalizedStatus(row.status) === this.status)
        && (!from || time >= from)
        && (!to || time <= to);
    });
  }

  get completedRows(): ReportRow[] { return this.filteredRows.filter((row) => this.normalizedStatus(row.status) === 'completed'); }
  get confirmedRows(): ReportRow[] { return this.filteredRows.filter((row) => this.normalizedStatus(row.status) === 'confirmed'); }
  get arrivedRows(): ReportRow[] { return this.filteredRows.filter((row) => this.normalizedStatus(row.status) === 'arrived'); }
  get inServiceRows(): ReportRow[] { return this.filteredRows.filter((row) => this.normalizedStatus(row.status) === 'in-service'); }
  get noShowRows(): ReportRow[] { return this.filteredRows.filter((row) => this.normalizedStatus(row.status) === 'no-show'); }
  get cancelledRows(): ReportRow[] { return this.filteredRows.filter((row) => ['cancelled', 'no-show'].includes(this.normalizedStatus(row.status))); }
  get scheduledRows(): ReportRow[] { return this.filteredRows.filter((row) => !this.completedRows.includes(row) && !this.cancelledRows.includes(row)); }
  get totalBilledPaise(): number { return this.filteredRows.reduce((sum, row) => sum + Number(row.total || 0), 0); }
  get totalMessageCount(): number { return this.filteredRows.reduce((sum, row) => sum + Number(row.messageStatus?.count || 0), 0); }

  get statusGroups(): Array<{ label: string; tone: string; rows: ReportRow[] }> {
    return [
      { label: `Completed (${this.completedRows.length})`, tone: 'completed', rows: this.completedRows },
      { label: `Scheduled (${this.scheduledRows.length})`, tone: 'scheduled', rows: this.scheduledRows },
      { label: `Cancelled (${this.cancelledRows.length})`, tone: 'cancelled', rows: this.cancelledRows },
    ].filter((group) => group.rows.length);
  }

  get trendPoints(): Array<{ label: string; count: number; height: number }> {
    const counts = new Map<string, number>();
    for (const row of this.filteredRows) {
      const date = new Date(row.appointmentStartAt || '');
      if (!Number.isNaN(date.getTime())) {
        const label = new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short' }).format(date);
        counts.set(label, (counts.get(label) || 0) + 1);
      }
    }
    const values = [...counts.entries()].slice(-7);
    const max = Math.max(1, ...values.map(([, count]) => count));
    return values.map(([label, count]) => ({ label, count, height: Math.max(10, Math.round((count / max) * 100)) }));
  }

  get cancellationReasons(): Array<{ reason: string; count: number; percent: number }> {
    const counts = new Map<string, number>();
    for (const row of this.cancelledRows) {
      const reason = row.cancelReason?.trim() || 'No reason captured';
      counts.set(reason, (counts.get(reason) || 0) + 1);
    }
    const total = Math.max(1, this.cancelledRows.length);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5)
      .map(([reason, count]) => ({ reason, count, percent: Math.round((count / total) * 100) }));
  }

  async reload(): Promise<void> {
    this.loading = true;
    this.error = '';
    try {
      const [register, staff, branches, report] = await Promise.all([
        firstValueFrom(this.api.get<any>('/api/v1/appointment-activity/register?limit=1000')),
        firstValueFrom(this.api.get<any>('/api/v1/staff?limit=500')).catch(() => []),
        firstValueFrom(this.api.get<any>('/api/v1/branches?limit=500')).catch(() => []),
        firstValueFrom(this.api.get<any>('/api/v1/appointment-activity/reports?limit=1000')).catch(() => null),
      ]);
      const body = register?.data ?? register;
      this.rows = Array.isArray(body?.rows) ? body.rows : [];
      this.staff = this.options(staff);
      this.branches = this.options(branches);
      const reportBody = report?.data ?? report;
      this.reportGeneratedAt = String(reportBody?.generatedAt || body?.generatedAt || '');
      if (this.selected) this.selected = this.rows.find((row) => row.appointmentId === this.selected?.appointmentId) ?? null;
    } catch (error: any) {
      this.rows = [];
      this.error = error?.error?.message || error?.message || 'Unable to load appointment reports';
    } finally {
      this.loading = false;
    }
  }

  openTimeline(row: ReportRow): void { this.selected = row; }
  closeTimeline(): void { this.selected = null; }
  bookingId(row: ReportRow): string { return row.bookingGroupId || row.appointmentId || '-'; }
  bookingMode(row: ReportRow): string { return row.bookingMode ? this.statusText(row.bookingMode) : 'Manual'; }
  statusText(status?: string): string { return String(status || 'booked').replace(/[-_]/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase()); }
  formatDateTime(value?: string): string {
    const date = new Date(value || '');
    return Number.isNaN(date.getTime()) ? '-' : new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
  }
  money(paise?: number): string { return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(Number(paise || 0) / 100); }
  download(format: 'csv' | 'pdf'): void {
    this.http.get(`/api/v1/appointment-activity/register?format=${format}&limit=1000`, { responseType: 'blob' }).subscribe({
      next: (file) => {
        const link = document.createElement('a');
        link.href = URL.createObjectURL(file);
        link.download = `appointment-report.${format}`;
        link.click();
        URL.revokeObjectURL(link.href);
      },
      error: () => this.error = `Unable to export ${format.toUpperCase()} report`,
    });
  }

  normalizedStatus(status?: string): string {
    const value = String(status || 'booked').toLowerCase();
    return ['billed', 'paid'].includes(value) ? 'completed' : value;
  }

  private options(response: any): Option[] {
    const body = response?.data ?? response;
    const rows = Array.isArray(body) ? body : Array.isArray(body?.rows) ? body.rows : [];
    return rows.map((row: any) => ({ id: String(row.id || ''), name: String(row.name || row.displayName || row.branchName || row.id || '') })).filter((row: Option) => row.id && row.name);
  }
}
