import { CommonModule } from '@angular/common';
import { Component, OnInit, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { ApiService } from '../../../shared/services/api.service';

type ActivityEvent = {
  id: string;
  action: string;
  old_status?: string;
  new_status?: string;
  oldStatus?: string;
  newStatus?: string;
  reason?: string;
  created_at?: string;
  createdAt?: string;
};

type AppointmentActivityRow = {
  appointmentId: string;
  clientId?: string;
  clientName?: string;
  clientPhone?: string;
  staffId?: string;
  staffName?: string;
  serviceNames?: string;
  appointmentStartAt?: string;
  status?: string;
  paymentStatus?: string;
  invoiceNumber?: string;
  timeline?: ActivityEvent[];
  timelineCount?: number;
  lastUpdatedAt?: string;
  lastUpdatedBy?: string;
};

@Component({
  selector: 'page-appointment-activities',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './appointment-activities-page.component.html',
  styleUrls: ['./appointment-activities-page.component.css'],
})
export class AppointmentActivitiesPageComponent implements OnInit {
  private readonly api = inject(ApiService);

  rows: AppointmentActivityRow[] = [];
  selected: AppointmentActivityRow | null = null;
  search = '';
  status = '';
  loading = false;
  error = '';
  private clientsById: Record<string, string> = {};
  private staffById: Record<string, string> = {};
  private servicesById: Record<string, string> = {};

  ngOnInit(): void {
    void this.reload();
  }

  get filteredRows(): AppointmentActivityRow[] {
    const query = this.search.trim().toLowerCase();
    return this.rows.filter((row) => {
      const matchesStatus = !this.status || String(row.status || '').toLowerCase() === this.status;
      const haystack = [row.appointmentId, row.clientName, row.clientPhone, row.staffName, row.serviceNames, row.status, row.invoiceNumber].join(' ').toLowerCase();
      return matchesStatus && (!query || haystack.includes(query));
    });
  }

  async reload(): Promise<void> {
    this.loading = true;
    this.error = '';
    try {
      const results = await Promise.allSettled([
        firstValueFrom(this.api.get<any>('/api/v1/appointment-activity/register?limit=500')),
        firstValueFrom(this.api.get<any>('/api/v1/clients?limit=500')),
        firstValueFrom(this.api.get<any>('/api/v1/staff?limit=500')),
        firstValueFrom(this.api.get<any>('/api/v1/services?limit=500')),
      ]);
      const response = results[0].status === 'fulfilled' ? results[0].value : null;
      const body = response?.data ?? response;
      this.rows = Array.isArray(body?.rows) ? body.rows : [];
      this.clientsById = this.nameLookup(results[1]);
      this.staffById = this.nameLookup(results[2]);
      this.servicesById = this.nameLookup(results[3]);
      if (this.selected) this.selected = this.rows.find((row) => row.appointmentId === this.selected?.appointmentId) ?? null;
    } catch (error: any) {
      this.rows = [];
      this.error = error?.error?.message || 'Unable to load appointment activities';
    } finally {
      this.loading = false;
    }
  }

  open(row: AppointmentActivityRow): void {
    this.selected = row;
  }

  close(): void {
    this.selected = null;
  }

  bookingId(id: string): string {
    return id ? `#${id.slice(-8).toUpperCase()}` : '-';
  }

  clientLabel(row: AppointmentActivityRow): string {
    return this.clientsById[row.clientId || ''] || (row.clientName !== row.clientId ? row.clientName || '' : '') || '-';
  }

  staffLabel(row: AppointmentActivityRow): string {
    return this.staffById[row.staffId || ''] || (row.staffName !== row.staffId ? row.staffName || '' : '') || '-';
  }

  serviceLabel(row: AppointmentActivityRow): string {
    return String(row.serviceNames || '').split(',').map((id) => {
      const value = id.trim();
      return this.servicesById[value] || value;
    }).filter(Boolean).join(', ') || '-';
  }

  statusText(value?: string): string {
    return String(value || 'Booked').replace(/[-_]/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
  }

  eventTime(event: ActivityEvent): string {
    return this.formatDateTime(event.createdAt || event.created_at || '');
  }

  formatDateTime(value?: string): string {
    if (!value) return '-';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
  }

  private nameLookup(result: PromiseSettledResult<any>): Record<string, string> {
    if (result.status !== 'fulfilled') return {};
    const body = result.value?.data ?? result.value;
    const rows = Array.isArray(body) ? body : Array.isArray(body?.rows) ? body.rows : Array.isArray(body?.clients) ? body.clients : Array.isArray(body?.staff) ? body.staff : Array.isArray(body?.services) ? body.services : [];
    return rows.reduce((lookup: Record<string, string>, row: any) => {
      const id = String(row?.id || '');
      const name = String(row?.name || row?.fullName || row?.full_name || row?.clientName || [row?.firstName || row?.first_name, row?.lastName || row?.last_name].filter(Boolean).join(' ') || '');
      if (id && name) lookup[id] = name;
      return lookup;
    }, {});
  }
}
