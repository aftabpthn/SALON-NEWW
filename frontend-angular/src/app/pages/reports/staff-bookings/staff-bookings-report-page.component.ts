import { CommonModule, CurrencyPipe } from '@angular/common';
import { TranslatePipe } from '../../../shared/pipes/translate.pipe';
import { Component, OnInit, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { DatePickerComponent } from '../../../shared/date-picker/date-picker.component';
import { ApiService } from '../../../shared/services/api.service';
import { LanguageService } from '../../../core/i18n/language.service';
type Row = { staffId: string; staffName: string; staffType: string; appointmentCount: number; appointmentValuePaise: number; };
type HistoryRow = { id: string; staffId: string; staffName: string; clientName: string; preferredClient: boolean; serviceNames: string[]; serviceDepartments: string[]; startAt: string; endAt: string; status: string; rescheduleCount: number; rescheduleTimeline: Array<{ action: string; changedAt: string; reason: string; fromStartAt: string; toStartAt: string }>; lastServiceAt: string; lastServiceNames: string[]; lastServiceDepartments: string[]; };
type HistoryData = { rows: HistoryRow[]; page: number; pageSize: number; totalItems: number; totalPages: number; hasMore: boolean; };
@Component({
    selector: 'app-staff-bookings-report-page', imports: [CommonModule, FormsModule, RouterLink, DatePickerComponent, CurrencyPipe, TranslatePipe], templateUrl: './staff-bookings-report-page.component.html', styleUrls: ['./staff-bookings-report-page.component.css']
})
export class StaffBookingsReportPageComponent implements OnInit {
  private readonly api = inject(ApiService); private readonly language = inject(LanguageService); rows: Row[] = []; history: HistoryData = { rows: [], page: 1, pageSize: 50, totalItems: 0, totalPages: 0, hasMore: false }; fromDate = ''; toDate = ''; search = ''; staffId = ''; status = 'all'; service = ''; department = ''; loading = false; historyLoading = false; error = '';
  ngOnInit(): void { this.load(); }
  get filtered(): Row[] { const q = this.search.trim().toLowerCase(); return this.rows.filter((row) => !q || `${row.staffName} ${row.staffType}`.toLowerCase().includes(q)); }
  load(): void { this.loading = true; this.error = ''; const q = new URLSearchParams(); if (this.fromDate) q.set('startDate', this.fromDate); if (this.toDate) q.set('endDate', this.toDate); this.api.get<{data?: Row[]} | Row[]>(`/api/v1/reports/staff-bookings?${q}`).subscribe({ next: (r) => { this.rows = Array.isArray(r) ? r : r.data ?? []; this.loading = false; }, error: (e) => { this.error = e?.error?.message ?? this.language.text('staff.message.bookingReportLoad'); this.loading = false; } }); this.loadHistory(true); }
  loadHistory(reset: boolean): void { const page = reset ? 1 : this.history.page + 1; const q = new URLSearchParams({ page: String(page), pageSize: '50', status: this.status, sort: 'desc' }); if (this.fromDate) q.set('startDate', this.fromDate); if (this.toDate) q.set('endDate', this.toDate); if (this.staffId) q.set('staffId', this.staffId); if (this.search.trim()) q.set('q', this.search.trim()); if (this.service.trim()) q.set('service', this.service.trim()); if (this.department.trim()) q.set('department', this.department.trim()); this.historyLoading = true; this.api.get<{data?: HistoryData} | HistoryData>(`/api/v1/reports/staff-service-history?${q}`).subscribe({ next: (response) => { const data = (response as {data?: HistoryData}).data ?? response as HistoryData; this.history = reset ? data : { ...data, rows: [...this.history.rows, ...data.rows] }; this.historyLoading = false; }, error: (e) => { this.error = e?.error?.message ?? 'Unable to load staff service history'; this.historyLoading = false; } }); }
  clearHistoryFilters(): void { this.fromDate = ''; this.toDate = ''; this.search = ''; this.staffId = ''; this.status = 'all'; this.service = ''; this.department = ''; this.load(); }
}
