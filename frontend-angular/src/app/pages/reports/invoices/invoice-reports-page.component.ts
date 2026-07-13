import { CommonModule } from '@angular/common';
import { Component, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ApiService } from '../../../shared/services/api.service';

interface FilterOption { id: string; name: string; }
interface PaymentMode { code: string; name: string; }
interface InvoiceReportRow { id: string; invoiceNumber: string; branchId: string; clientName: string; staffName: string; businessDate: string; status: string; totalPaise: number; paidPaise: number; balancePaise: number; ageingDays: number; followUpRequired: boolean; }

@Component({ selector: 'app-invoice-reports-page', standalone: true, imports: [CommonModule, FormsModule, RouterLink], templateUrl: './invoice-reports-page.component.html', styleUrls: ['./invoice-reports-page.component.css'] })
export class InvoiceReportsPageComponent implements OnInit {
  rows: InvoiceReportRow[] = [];
  clients: FilterOption[] = [];
  staff: FilterOption[] = [];
  modes: PaymentMode[] = [];
  filters = { clientId: '', staffId: '', paymentMethod: '', status: '', recovery: '', ageingDays: null as number | null, followUp: false, dateFrom: '', dateTo: '' };
  branchName = localStorage.getItem('aurashine_branch_name') ?? localStorage.getItem('selectedBranchName') ?? 'Current branch';
  error = '';
  constructor(private readonly api: ApiService) {}
  ngOnInit(): void { this.loadOptions(); this.load(); }
  load(): void { this.api.get<any>(`/api/reports/invoices?${this.query()}`).subscribe({ next: (res) => this.rows = this.list(res).map((row) => this.normalize(row)), error: (err: any) => this.error = err?.error?.message ?? err?.message ?? 'Unable to load invoice report' }); }
  clear(): void { this.filters = { clientId: '', staffId: '', paymentMethod: '', status: '', recovery: '', ageingDays: null, followUp: false, dateFrom: '', dateTo: '' }; this.load(); }
  formatDate(value: string): string { const date = value.slice(0, 10).split('-'); return date.length === 3 ? `${date[2]}/${date[1]}/${date[0]}` : '-'; }
  private loadOptions(): void { this.api.get<any>('/api/clients').subscribe({ next: (res) => this.clients = this.list(res).map((item) => ({ id: String(item.id), name: this.name(item) })) }); this.api.get<any>('/api/staff').subscribe({ next: (res) => this.staff = this.list(res).map((item) => ({ id: String(item.id), name: this.name(item) })) }); this.api.get<any>('/api/pos/payment-methods').subscribe({ next: (res) => this.modes = this.list(res).map((item) => ({ code: String(item.code ?? item.id), name: String(item.name ?? item.label) })) }); }
  private query(): string { const p = new URLSearchParams(); for (const [key, value] of Object.entries(this.filters)) if (value !== '' && value !== null && value !== false) p.set(key, String(value)); return p.toString(); }
  private list(res: any): any[] { return Array.isArray(res) ? res : Array.isArray(res?.data) ? res.data : Array.isArray(res?.rows) ? res.rows : []; }
  private normalize(row: any): InvoiceReportRow { return { id: String(row.id), invoiceNumber: String(row.invoiceNumber ?? row.invoice_number), branchId: String(row.branchId ?? row.branch_id), clientName: String(row.clientName ?? row.client_name ?? 'Walk-in client'), staffName: String(row.staffName ?? row.staff_name ?? '-'), businessDate: String(row.businessDate ?? row.business_date ?? ''), status: String(row.status), totalPaise: Number(row.totalPaise ?? row.total_paise ?? 0), paidPaise: Number(row.paidPaise ?? row.paid_paise ?? 0), balancePaise: Number(row.balancePaise ?? row.balance_paise ?? 0), ageingDays: Number(row.ageingDays ?? row.ageing_days ?? 0), followUpRequired: Boolean(row.followUpRequired ?? row.follow_up_required) }; }
  private name(item: any): string { return String(item.name ?? item.fullName ?? [item.firstName ?? item.first_name, item.lastName ?? item.last_name].filter(Boolean).join(' ') ?? item.id); }
}
