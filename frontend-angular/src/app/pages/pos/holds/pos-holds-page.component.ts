
import { Component, OnDestroy, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { ApiService } from '../../../shared/services/api.service';
import { PosRealtimeService } from '../../../core/services/pos-realtime.service';
import { Subscription } from 'rxjs';

interface HeldInvoice {
  id: string;
  holdId: string;
  clientName: string;
  clientPhone: string;
  staffName: string;
  itemCount: number;
  itemNames: string;
  totalPaise: number;
  heldAt: string;
}

@Component({
    selector: 'app-pos-holds-page',
    imports: [FormsModule, RouterLink],
    templateUrl: './pos-holds-page.component.html',
    styleUrls: ['./pos-holds-page.component.css']
})
export class PosHoldsPageComponent implements OnInit, OnDestroy {
  holds: HeldInvoice[] = [];
  search = '';
  error = '';
  cancellingId = '';
  private liveUpdates?: Subscription;

  constructor(private readonly api: ApiService, private readonly router: Router, private readonly realtime: PosRealtimeService) {}
  ngOnInit(): void {
    this.load();
    this.liveUpdates = this.realtime.events().subscribe((event) => {
      if (event.entityType === 'invoice') this.load();
    });
  }
  ngOnDestroy(): void { this.liveUpdates?.unsubscribe(); }

  get filtered(): HeldInvoice[] {
    const term = this.search.trim().toLowerCase();
    return !term ? this.holds : this.holds.filter((hold) => `${hold.holdId} ${hold.clientName} ${hold.clientPhone} ${hold.staffName} ${hold.itemNames}`.toLowerCase().includes(term));
  }

  get heldValuePaise(): number { return this.holds.reduce((sum, hold) => sum + hold.totalPaise, 0); }
  get oldestHold(): HeldInvoice | null { return [...this.holds].sort((a, b) => Date.parse(a.heldAt) - Date.parse(b.heldAt))[0] ?? null; }

  load(): void {
    this.error = '';
    this.api.get<any>('/api/v1/pos/sales-register?page=1&pageSize=100&status=draft').subscribe({
      next: (response) => {
        this.holds = this.rows(response).filter((row) => String(row.status ?? '').toLowerCase() === 'draft').map((row) => this.mapHold(row));
      },
      error: (error: any) => this.error = error?.error?.message ?? 'Unable to load held invoices',
    });
  }

  resume(hold: HeldInvoice, event?: Event): void {
    event?.stopPropagation();
    this.error = '';
    this.api.post(`/api/v1/pos/invoices/${hold.id}/resume`, {}).subscribe({
      next: () => this.router.navigate(['/pos'], { queryParams: { draft: hold.id } }),
      error: (error: any) => this.error = error?.error?.message ?? 'Unable to resume held invoice',
    });
  }

  cancel(hold: HeldInvoice, event?: Event): void {
    event?.stopPropagation();
    if (this.cancellingId || !window.confirm(`Cancel held invoice ${hold.holdId}?`)) return;
    this.error = '';
    this.cancellingId = hold.id;
    this.api.post(`/api/v1/pos/invoices/${hold.id}/void`, {
      reason: 'Held invoice discarded',
      notes: `Cancelled from held invoice register (${hold.holdId})`,
      idempotencyKey: `held-invoice-discard:${hold.id}`,
    }).subscribe({
      next: () => {
        this.cancellingId = '';
        this.load();
      },
      error: (error: any) => {
        this.cancellingId = '';
        this.error = error?.error?.message ?? 'Unable to cancel held invoice';
      },
    });
  }

  money(value: number): string { return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(value / 100); }
  dateTime(value: string): string { const date = new Date(value); return Number.isNaN(date.getTime()) ? '-' : new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(date); }
  age(value: string): string { const hours = Math.max(0, Math.floor((Date.now() - Date.parse(value)) / 3_600_000)); return Number.isFinite(hours) ? `${Math.floor(hours / 24)}d ${hours % 24}h` : '-'; }
  trackById(_: number, hold: HeldInvoice): string { return hold.id; }

  private rows(response: any): any[] { return Array.isArray(response) ? response : response?.rows ?? response?.data?.rows ?? response?.data ?? []; }
  private mapHold(row: any): HeldInvoice {
    return {
      id: String(row.id ?? row.saleId ?? row.sale_id ?? ''),
      holdId: String(row.invoiceNumber ?? row.invoice_number ?? row.id ?? ''),
      clientName: String(row.clientName ?? row.client_name ?? 'Walk-in client'),
      clientPhone: String(row.clientPhone ?? row.client_phone ?? row.phone ?? ''),
      staffName: String(row.staffName ?? row.staff_name ?? row.staff ?? ''),
      itemCount: Number(row.itemCount ?? row.item_count ?? row.lineCount ?? row.line_count ?? 0),
      itemNames: String(row.itemNames ?? row.item_names ?? ''),
      totalPaise: Number(row.totalPaise ?? row.total_paise ?? row.total ?? 0),
      heldAt: String(row.updatedAt ?? row.updated_at ?? row.createdAt ?? row.created_at ?? ''),
    };
  }
}
