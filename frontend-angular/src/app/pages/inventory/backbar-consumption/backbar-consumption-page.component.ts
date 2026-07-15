import { CommonModule } from '@angular/common';
import { Component, inject, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { DatePickerComponent } from '../../../shared/date-picker/date-picker.component';
import { AuthService } from '../../../core/services/auth.service';
import { ApiEnvelope, ApiService } from '../../../shared/services/api.service';

type RecipeLine = { productId?: string; itemId?: string; inventoryItemId?: string; standardQty?: number; quantity?: number; qty?: number };
type Service = { id: string; name: string; active: boolean; productConsumption: RecipeLine[] };
type Item = { id: string; name: string; sku: string; unit: string; stockQuantity: number; active: boolean };
type Staff = { id: string; firstName: string; lastName: string; appointmentDisplayName: string; active: boolean };
type Usage = { id: string; inventoryItemId: string; itemName: string; serviceId?: string; serviceName: string; staffId?: string; staffName: string; source: string; expectedQuantity: number; actualQuantity: number; varianceQuantity: number; maxQuantity: number; wastagePercent: number; approvalThresholdPercent: number; unit: string; status: string; notes: string; reviewNote: string; createdAt: string };
type BackbarTab = 'usage' | 'daily' | 'variance' | 'approvals' | 'audit';

@Component({
  selector: 'page-backbar-consumption',
  standalone: true,
  imports: [CommonModule, FormsModule, DatePickerComponent],
  templateUrl: './backbar-consumption-page.component.html',
  styleUrls: ['./backbar-consumption-page.component.css'],
})
export class BackbarConsumptionPageComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly auth = inject(AuthService);
  items: Item[] = [];
  services: Service[] = [];
  staff: Staff[] = [];
  usage: Usage[] = [];
  activeTab: BackbarTab = 'usage';
  filterDate = '';
  filterStaff = '';
  workflow = '';
  loading = true;
  saving = false;
  drawerOpen = false;
  error = '';
  notice = '';
  draft = this.emptyDraft();

  ngOnInit() { void this.load(); }

  get tabRows() {
    if (this.activeTab === 'variance') return this.usage.filter((row) => row.varianceQuantity !== 0);
    if (this.activeTab === 'approvals') return this.usage.filter((row) => row.status === 'pending_approval');
    return this.usage;
  }
  get visibleUsage() { return this.tabRows.filter((row) => !this.workflow || row.status === this.workflow); }
  get expectedTotal() { return this.visibleUsage.reduce((sum, row) => sum + row.expectedQuantity, 0); }
  get actualTotal() { return this.visibleUsage.reduce((sum, row) => sum + row.actualQuantity, 0); }
  get varianceTotal() { return this.actualTotal - this.expectedTotal; }
  get pendingApprovals() { return this.usage.filter((row) => row.status === 'pending_approval').length; }
  get canReview() { return this.auth.hasRole('owner') || this.auth.hasPermission('inventory.approve'); }
  get tableTitle() {
    if (this.activeTab === 'daily') return 'Daily product control';
    if (this.activeTab === 'variance') return 'Consumption variance';
    if (this.activeTab === 'approvals') return 'Pending usage approvals';
    if (this.activeTab === 'audit') return 'Consumption audit trail';
    return 'Product consumption accountability';
  }
  get availableItems() {
    const service = this.services.find((row) => row.id === this.draft.serviceId);
    if (!service) return this.items;
    const ids = new Set(service.productConsumption.map((line) => String(line.productId ?? line.itemId ?? line.inventoryItemId ?? '')));
    return this.items.filter((item) => ids.has(item.id));
  }
  get expectedQuantity() {
    const service = this.services.find((row) => row.id === this.draft.serviceId);
    const line = service?.productConsumption.find((entry) => String(entry.productId ?? entry.itemId ?? entry.inventoryItemId ?? '') === this.draft.inventoryItemId);
    return Number(line?.standardQty ?? line?.quantity ?? line?.qty ?? 0);
  }

  async load() {
    this.loading = true; this.error = '';
    try {
      const query = new URLSearchParams(); if (this.filterDate) query.set('date', this.filterDate); if (this.filterStaff) query.set('staffId', this.filterStaff);
      const [items, services, staff, usage] = await Promise.all([
        this.get<Item[]>('/inventory?pageSize=200'), this.get<any[]>('/services?pageSize=100'),
        this.get<Staff[]>('/staff?pageSize=100'), this.get<Usage[]>(`/inventory/backbar-usage?${query}`),
      ]);
      this.items = items.filter((item) => item.active);
      this.services = services.filter((service) => service.active !== false).map((service) => ({ id: String(service.id), name: String(service.name), active: true, productConsumption: Array.isArray(service.productConsumption) ? service.productConsumption : [] }));
      this.staff = staff.filter((row) => row.active); this.usage = usage;
    } catch (error) { this.error = this.message(error, 'Backbar usage could not be loaded'); }
    finally { this.loading = false; }
  }

  openRecord() { this.draft = this.emptyDraft(); this.drawerOpen = true; this.clearFeedback(); }
  closeRecord() { if (!this.saving) this.drawerOpen = false; }
  serviceChanged() { if (!this.availableItems.some((item) => item.id === this.draft.inventoryItemId)) this.draft.inventoryItemId = ''; }
  staffName(row: Staff) { return row.appointmentDisplayName || `${row.firstName} ${row.lastName}`.trim(); }
  date(value: string) { return new Intl.DateTimeFormat('en-GB').format(new Date(value)); }
  quantity(value: number, unit = '') { return `${Number(value || 0).toLocaleString('en-IN')} ${unit}`.trim(); }
  statusLabel(status: string) {
    if (status === 'auto_consumed') return 'Automatic';
    if (status === 'pending_approval') return 'Pending approval';
    if (status === 'rejected') return 'Rejected';
    return 'Recorded';
  }

  async save() {
    const item = this.items.find((row) => row.id === this.draft.inventoryItemId);
    const actual = Number(this.draft.actualQuantity);
    if (!item || !Number.isInteger(actual) || actual <= 0) { this.error = 'Product and positive whole actual quantity are required'; return; }
    this.saving = true; this.clearFeedback();
    try {
      const response: any = await firstValueFrom(this.api.post('/inventory/backbar-usage', {
        inventoryItemId: item.id, serviceId: this.draft.serviceId || null, staffId: this.draft.staffId || null,
        actualQuantity: actual, notes: this.draft.notes.trim(), idempotencyKey: crypto.randomUUID(),
      }));
      this.drawerOpen = false; await this.load();
      this.notice = response?.data?.status === 'pending_approval' ? 'Sent for owner approval' : 'Backbar usage recorded';
    } catch (error) { this.error = this.message(error, 'Backbar usage could not be recorded'); }
    finally { this.saving = false; }
  }

  async review(row: Usage, decision: 'approve' | 'reject') {
    const reviewNote = decision === 'reject' ? window.prompt('Rejection reason')?.trim() : '';
    if (decision === 'reject' && !reviewNote) return;
    this.saving = true; this.clearFeedback();
    try {
      await firstValueFrom(this.api.patch(`/inventory/backbar-usage/${row.id}/review`, { decision, reviewNote: reviewNote || '' }));
      await this.load(); this.notice = decision === 'approve' ? 'Usage approved and stock updated' : 'Usage rejected';
    } catch (error) { this.error = this.message(error, 'Backbar review could not be saved'); }
    finally { this.saving = false; }
  }

  exportCsv() {
    const rows = this.visibleUsage.map((row) => [this.date(row.createdAt), row.itemName, row.source, row.serviceName, row.staffName, row.expectedQuantity, row.actualQuantity, row.varianceQuantity, row.unit, row.status]);
    const csv = [['Date', 'Product', 'Invoice / Source', 'Service', 'Staff', 'Expected', 'Actual', 'Variance', 'Unit', 'Status'], ...rows]
      .map((row) => row.map((value) => `"${String(value).replaceAll('"', '""')}"`).join(',')).join('\r\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a'); link.href = url; link.download = `backbar-usage-${this.filterDate || 'all'}.csv`; link.click(); URL.revokeObjectURL(url);
  }

  private emptyDraft() { return { inventoryItemId: '', serviceId: '', staffId: '', actualQuantity: null as number | null, notes: '' }; }
  private async get<T>(path: string) { const response = await firstValueFrom(this.api.get<ApiEnvelope<T>>(path)); if (response.data === undefined) throw new Error('API response did not contain data'); return response.data; }
  private message(error: any, fallback: string) { return error?.error?.error?.message ?? error?.error?.message ?? error?.message ?? fallback; }
  private clearFeedback() { this.error = ''; this.notice = ''; }
}
