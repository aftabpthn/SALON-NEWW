import { CommonModule, CurrencyPipe } from '@angular/common';
import { TranslatePipe } from '../../../shared/pipes/translate.pipe';
import { Component, OnInit, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { DatePickerComponent } from '../../../shared/date-picker/date-picker.component';
import { ApiService } from '../../../shared/services/api.service';
import { LanguageService } from '../../../core/i18n/language.service';
type Row = { staffId: string; staffName: string; staffType: string; appointmentCount: number; appointmentValuePaise: number; };
@Component({ selector: 'app-staff-bookings-report-page', standalone: true, imports: [CommonModule, FormsModule, RouterLink, DatePickerComponent, CurrencyPipe, TranslatePipe], templateUrl: './staff-bookings-report-page.component.html', styleUrls: ['./staff-bookings-report-page.component.css'] })
export class StaffBookingsReportPageComponent implements OnInit {
  private readonly api = inject(ApiService); private readonly language = inject(LanguageService); rows: Row[] = []; fromDate = ''; toDate = ''; search = ''; loading = false; error = '';
  ngOnInit(): void { this.load(); }
  get filtered(): Row[] { const q = this.search.trim().toLowerCase(); return this.rows.filter((row) => !q || `${row.staffName} ${row.staffType}`.toLowerCase().includes(q)); }
  load(): void { this.loading = true; this.error = ''; const q = new URLSearchParams(); if (this.fromDate) q.set('startDate', this.fromDate); if (this.toDate) q.set('endDate', this.toDate); this.api.get<{data?: Row[]} | Row[]>(`/api/v1/reports/staff-bookings?${q}`).subscribe({ next: (r) => { this.rows = Array.isArray(r) ? r : r.data ?? []; this.loading = false; }, error: (e) => { this.error = e?.error?.message ?? this.language.text('staff.message.bookingReportLoad'); this.loading = false; } }); }
}
