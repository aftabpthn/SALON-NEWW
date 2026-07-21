import { LanguageService } from '../../../core/i18n/language.service';
import { CommonModule } from '@angular/common';
import { Component, inject, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { DatePickerComponent } from '../../../shared/date-picker/date-picker.component';
import { AuthService } from '../../../core/services/auth.service';
import { ApiEnvelope, ApiService } from '../../../shared/services/api.service';
import { TranslatePipe } from '../../../shared/pipes/translate.pipe';

type RecipeLine = { productId?: string; itemId?: string; inventoryItemId?: string; standardQty?: number; quantity?: number; qty?: number };
type Service = { id: string; name: string; active: boolean; productConsumption: RecipeLine[] };
type Item = { id: string; name: string; sku: string; unit: string; stockQuantity: number; active: boolean };
type Staff = { id: string; firstName: string; lastName: string; appointmentDisplayName: string; active: boolean };
type Usage = { id: string; inventoryItemId: string; itemName: string; serviceId?: string; serviceName: string; staffId?: string; staffName: string; source: string; expectedQuantity: number; actualQuantity: number; varianceQuantity: number; maxQuantity: number; wastagePercent: number; approvalThresholdPercent: number; unit: string; status: string; notes: string; reviewNote: string; createdAt: string };
type BackbarTab = 'usage' | 'daily' | 'variance' | 'approvals' | 'audit' | 'containers';
type Container = { id: string; inventoryItemId: string; productName: string; barcode: string; capacityQuantity: number; remainingQuantity: number; unit: string; status: string; openedAt?: string; pendingOverrideId?: string; events: Array<{ id: string; eventType: string; quantityDelta: number; remainingAfter: number; actorUserId: string; createdAt: string }> };

@Component({
  selector: 'page-backbar-consumption',
  standalone: true,
  imports: [CommonModule, FormsModule, DatePickerComponent, TranslatePipe],
  templateUrl: './backbar-consumption-page.component.html',
  styleUrls: ['./backbar-consumption-page.component.css'],
})
export class BackbarConsumptionPageComponent implements OnInit {
  private readonly language = inject(LanguageService);
  private readonly api = inject(ApiService);
  private readonly auth = inject(AuthService);
  items: Item[] = [];
  services: Service[] = [];
  staff: Staff[] = [];
  usage: Usage[] = [];
  containers: Container[] = [];
  containerDraft = { inventoryItemId: '', barcode: '', capacityQuantity: null as number | null, unit: 'ml' };
  containerQuantity: Record<string, number | null> = {};
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
      const [items, services, staff, usage, containers] = await Promise.all([
        this.get<Item[]>('/inventory?pageSize=200'), this.get<any[]>('/services?pageSize=100'),
        this.get<Staff[]>('/staff?pageSize=100'), this.get<Usage[]>(`/inventory/backbar-usage?${query}`),
        this.get<Container[]>('/inventory/backbar-containers'),
      ]);
      this.items = items.filter((item) => item.active);
      this.services = services.filter((service) => service.active !== false).map((service) => ({ id: String(service.id), name: String(service.name), active: true, productConsumption: Array.isArray(service.productConsumption) ? service.productConsumption : [] }));
      this.staff = staff.filter((row) => row.active); this.usage = usage; this.containers = containers;
    } catch (error) { this.error = this.message(error, this.language.text('inventory.message.130bf2c64b')); }
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
    if (!item || !Number.isInteger(actual) || actual <= 0) { this.error = this.language.text('inventory.message.99f1439ca5'); return; }
    this.saving = true; this.clearFeedback();
    try {
      const response: any = await firstValueFrom(this.api.post('/inventory/backbar-usage', {
        inventoryItemId: item.id, serviceId: this.draft.serviceId || null, staffId: this.draft.staffId || null,
        actualQuantity: actual, notes: this.draft.notes.trim(), idempotencyKey: crypto.randomUUID(),
      }));
      this.drawerOpen = false; await this.load();
      this.notice = response?.data?.status === 'pending_approval' ? 'Sent for owner approval' : 'Backbar usage recorded';
    } catch (error) { this.error = this.message(error, this.language.text('inventory.message.28b3d8f473')); }
    finally { this.saving = false; }
  }

  async review(row: Usage, decision: 'approve' | 'reject') {
    const reviewNote = decision === 'reject' ? window.prompt('Rejection reason')?.trim() : '';
    if (decision === 'reject' && !reviewNote) return;
    this.saving = true; this.clearFeedback();
    try {
      await firstValueFrom(this.api.patch(`/inventory/backbar-usage/${row.id}/review`, { decision, reviewNote: reviewNote || '' }));
      await this.load(); this.notice = decision === 'approve' ? 'Usage approved and stock updated' : 'Usage rejected';
    } catch (error) { this.error = this.message(error, this.language.text('inventory.message.b646c3516a')); }
    finally { this.saving = false; }
  }

  async createContainer() {
    const quantity = Number(this.containerDraft.capacityQuantity);
    if (!this.containerDraft.inventoryItemId || !this.containerDraft.barcode.trim() || !Number.isInteger(quantity) || quantity <= 0) { this.error = this.language.text('inventory.message.12caca39ed'); return; }
    await this.containerAction(async () => this.api.post('/inventory/backbar-containers', { ...this.containerDraft, capacityQuantity: quantity, idempotencyKey: crypto.randomUUID() }), 'Container created');
    this.containerDraft = { inventoryItemId: '', barcode: '', capacityQuantity: null, unit: 'ml' };
  }
  async openContainer(row: Container) { await this.containerAction(async () => this.api.post(`/inventory/backbar-containers/${row.id}/open`, { idempotencyKey: crypto.randomUUID() }), 'Container opened and package stock posted'); }
  async consumeContainer(row: Container) { const quantity = Number(this.containerQuantity[row.id]); if (!Number.isInteger(quantity) || quantity <= 0) return; await this.containerAction(async () => this.api.post(`/inventory/backbar-containers/${row.id}/consume`, { quantity, idempotencyKey: crypto.randomUUID() }), 'Container usage recorded'); this.containerQuantity[row.id] = null; }
  async requestOverride(row: Container) { const value = window.prompt(`Correct remaining quantity (0-${row.capacityQuantity})`, String(row.remainingQuantity)); if (value === null) return; const reason = window.prompt('Override reason')?.trim(); if (!reason) return; await this.containerAction(async () => this.api.post(`/inventory/backbar-containers/${row.id}/overrides`, { requestedRemaining: Number(value), reason, idempotencyKey: crypto.randomUUID() }), 'Override sent for approval'); }
  async reviewOverride(row: Container, decision: 'approve' | 'reject') { if (!row.pendingOverrideId) return; const note = decision === 'reject' ? window.prompt('Rejection reason')?.trim() : ''; if (decision === 'reject' && !note) return; await this.containerAction(async () => this.api.post(`/inventory/backbar-overrides/${row.pendingOverrideId}/review`, { decision, reviewNote: note || '', idempotencyKey: crypto.randomUUID() }), `Override ${decision}d`); }
  private async containerAction(action: () => any, message: string) { this.saving = true; this.clearFeedback(); try { await firstValueFrom(action()); await this.load(); this.notice = message; } catch (error) { this.error = this.message(error, message); } finally { this.saving = false; } }
  exportCsv() {
    const rows = this.visibleUsage.map((row) => [this.date(row.createdAt), row.itemName, row.source, row.serviceName, row.staffName, row.expectedQuantity, row.actualQuantity, row.varianceQuantity, row.unit, row.status]);
    const csv = [['Date', 'Product', 'Invoice / Source', 'Service', 'Staff', 'Expected', 'Actual', 'Variance', 'Unit', 'Status'].map((value) => this.language.textValue(value)), ...rows]
      .map((row) => row.map((value) => `"${String(value).replaceAll('"', '""')}"`).join(',')).join('\r\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a'); link.href = url; link.download = `backbar-usage-${this.filterDate || 'all'}.csv`; link.click(); URL.revokeObjectURL(url);
  }

  private emptyDraft() { return { inventoryItemId: '', serviceId: '', staffId: '', actualQuantity: null as number | null, notes: '' }; }
  private async get<T>(path: string) { const response = await firstValueFrom(this.api.get<ApiEnvelope<T>>(path)); if (response.data === undefined) throw new Error('API response did not contain data'); return response.data; }
  private message(error: any, fallback: string) { return error?.error?.error?.message ?? error?.error?.message ?? error?.message ?? fallback; }
  private clearFeedback() { this.error = ''; this.notice = ''; }
}
