import { LanguageService } from '../../../core/i18n/language.service';

import { Component, OnInit, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { DatePickerComponent } from '../../../shared/date-picker/date-picker.component';
import { ApiEnvelope, ApiService } from '../../../shared/services/api.service';
import { TranslatePipe } from '../../../shared/pipes/translate.pipe';

type Summary = { activeOrders: number; dueToday: number; overdue: number; ready: number; openIssues: number };
type Order = { id: string; orderNumber: string; ownerType: string; clientId?: string; clientName: string; supplierId?: string; supplierName: string; status: string; priority: string; intakeAt: string; dueAt?: string; totalItems: number; totalWeightGrams?: number; estimatedCostPaise: number; actualCostPaise: number; notes: string; openIssues: number };
type Item = { id: string; itemCode: string; itemName: string; category: string; quantity: number; barcode: string; color: string; material: string; conditionIn: string; conditionOut: string; status: string };
type Issue = { id: string; itemId?: string; issueType: string; severity: string; status: string; description: string; chargePaise: number; resolution: string; createdAt: string };
type Event = { id: string; eventType: string; fromStatus: string; toStatus: string; actorId: string; note: string; createdAt: string };
type Detail = { order: Order; items: Item[]; issues: Issue[]; events: Event[] };
type ScanResult = { itemId: string; itemName: string; barcode: string; orderId: string; orderNumber: string; orderStatus: string };
type Client = { id: string; firstName: string; lastName?: string; phone?: string };
type Supplier = { id: string; name: string; active: boolean };
type DraftItem = { itemName: string; category: string; quantity: string; barcode: string; color: string; material: string; conditionIn: string };

@Component({
    selector: 'page-laundry-tracker', imports: [FormsModule, DatePickerComponent, TranslatePipe],
    templateUrl: './laundry-tracker-page.component.html', styleUrls: ['./laundry-tracker-page.component.css']
})
export class LaundryTrackerPageComponent implements OnInit {
  private readonly language = inject(LanguageService);
  private readonly api = inject(ApiService);
  readonly statuses = ['', 'received', 'sorting', 'washing', 'drying', 'finishing', 'outsourced', 'received_from_vendor', 'quality_check', 'rework', 'ready', 'returned', 'cancelled'];
  readonly categories = ['towel', 'cape', 'sheet', 'uniform', 'garment', 'other'];
  summary: Summary = { activeOrders: 0, dueToday: 0, overdue: 0, ready: 0, openIssues: 0 };
  orders: Order[] = []; clients: Client[] = []; suppliers: Supplier[] = []; detail?: Detail;
  status = ''; query = ''; loading = true; busy = false; error = ''; drawer: 'create' | 'detail' | '' = '';
  scanValue = ''; clientSearch = '';
  draft = this.emptyDraft();
  transitionNote = ''; actualCostRupees = '';
  issueDraft = { itemId: '', issueType: 'damage', severity: 'medium', description: '', chargeRupees: '' };
  issueResolutions: Record<string, string> = {};

  async ngOnInit() { await this.reload(); }
  async reload() {
    this.loading = true; this.error = '';
    try {
      const params = new URLSearchParams(); if (this.status) params.set('status', this.status); if (this.query.trim()) params.set('q', this.query.trim());
      const [summary, orders] = await Promise.all([
        firstValueFrom(this.api.get<ApiEnvelope<Summary>>('/inventory/laundry/summary')),
        firstValueFrom(this.api.get<ApiEnvelope<Order[]>>(`/inventory/laundry/orders?${params}`)),
      ]);
      this.summary = summary.data || this.summary; this.orders = orders.data || [];
      void this.loadReferences();
    } catch (error) { this.error = this.message(error, this.language.text('inventory.message.ffe4abe68e')); }
    finally { this.loading = false; }
  }
  private async loadReferences() {
    try {
      const [clients, suppliers] = await Promise.all([firstValueFrom(this.api.get<ApiEnvelope<Client[]>>('/clients?pageSize=500')), firstValueFrom(this.api.get<ApiEnvelope<Supplier[]>>('/purchases/suppliers'))]);
      this.clients = clients.data || []; this.suppliers = (suppliers.data || []).filter((row) => row.active);
    } catch (error) { this.error ||= this.message(error, 'Laundry form options could not be loaded'); }
  }
  openCreate() { this.draft = this.emptyDraft(); this.clientSearch = ''; this.drawer = 'create'; }
  async openDetail(order: Order) { await this.action(async () => { await this.loadDetail(order.id); this.drawer = 'detail'; }, 'Laundry order could not be loaded'); }
  closeDrawer() { if (!this.busy) { this.drawer = ''; this.detail = undefined; } }
  addItem() { if (this.draft.items.length < 100) this.draft.items.push(this.emptyItem()); }
  removeItem(index: number) { if (this.draft.items.length > 1) this.draft.items.splice(index, 1); }
  async createOrder() {
    const dueAt = this.draft.dueDate ? new Date(`${this.draft.dueDate}T${this.draft.dueTime || '18:00'}:00`).toISOString() : undefined;
    const payload = { ownerType: this.draft.ownerType, clientId: this.draft.ownerType === 'client' ? this.draft.clientId || undefined : undefined, supplierId: this.draft.supplierId || undefined, priority: this.draft.priority, dueAt, totalWeightGrams: this.draft.totalWeightKg ? Math.round(Number(this.draft.totalWeightKg) * 1000) : undefined, estimatedCostPaise: this.toPaise(this.draft.estimatedCostRupees), notes: this.draft.notes, items: this.draft.items.map((item) => ({ ...item, quantity: Number(item.quantity) })) };
    await this.action(async () => { await firstValueFrom(this.api.post('/inventory/laundry/orders', payload)); this.drawer = ''; await this.reload(); }, 'Laundry order could not be created');
  }
  nextStatuses(status: string): string[] { return ({ received: ['sorting', 'cancelled'], sorting: ['washing', 'outsourced'], washing: ['drying'], drying: ['finishing'], finishing: ['quality_check'], outsourced: ['received_from_vendor'], received_from_vendor: ['quality_check'], quality_check: ['ready', 'rework'], rework: ['washing', 'outsourced'], ready: ['returned'] } as Record<string, string[]>)[status] || []; }
  async moveTo(status: string) { if (!this.detail) return; await this.action(async () => { const result = await firstValueFrom(this.api.post<ApiEnvelope<Detail>>(`/inventory/laundry/orders/${this.detail!.order.id}/transition`, { status, note: this.transitionNote, actualCostPaise: this.actualCostRupees ? this.toPaise(this.actualCostRupees) : undefined })); this.detail = result.data; this.transitionNote = ''; this.actualCostRupees = ''; await this.reload(); }, 'Laundry status could not be updated'); }
  async reportIssue() { if (!this.detail || !this.issueDraft.description.trim()) return; await this.action(async () => { const result = await firstValueFrom(this.api.post<ApiEnvelope<Detail>>(`/inventory/laundry/orders/${this.detail!.order.id}/issues`, { itemId: this.issueDraft.itemId || undefined, issueType: this.issueDraft.issueType, severity: this.issueDraft.severity, description: this.issueDraft.description, chargePaise: this.toPaise(this.issueDraft.chargeRupees) })); this.detail = result.data; this.issueDraft = { itemId: '', issueType: 'damage', severity: 'medium', description: '', chargeRupees: '' }; await this.reload(); }, 'Laundry issue could not be reported'); }
  async resolveIssue(issue: Issue, status: 'resolved' | 'waived') { const resolution = this.issueResolutions[issue.id]?.trim(); if (!resolution || !this.detail) return; await this.action(async () => { const orderId = this.detail!.order.id; await firstValueFrom(this.api.post(`/inventory/laundry/issues/${issue.id}/resolve`, { status, resolution })); await this.loadDetail(orderId); await this.reload(); }, 'Laundry issue could not be resolved'); }
  async scanBarcode() { const barcode = this.scanValue.trim(); if (!barcode) return; await this.action(async () => { const result = await firstValueFrom(this.api.get<ApiEnvelope<ScanResult>>(`/inventory/laundry/items/scan/${encodeURIComponent(barcode)}`)); if (!result.data) throw new Error('Laundry barcode was not found'); await this.loadDetail(result.data.orderId); this.drawer = 'detail'; this.scanValue = ''; }, 'Laundry barcode was not found'); }
  async searchClients() { const query = this.clientSearch.trim(); await this.action(async () => { const result = await firstValueFrom(this.api.get<ApiEnvelope<Client[]>>(`/clients?pageSize=100${query ? `&q=${encodeURIComponent(query)}` : ''}`)); this.clients = result.data || []; }, 'Clients could not be loaded'); }
  exportCsv() {
    const rows: Array<Array<string | number>> = [['Order','Owner','Status','Items','Intake','Due','Vendor','Open issues','Estimated cost','Actual cost'].map((value) => this.language.textValue(value)), ...this.orders.map((row) => [row.orderNumber, row.ownerType === 'client' ? row.clientName : 'Salon', row.status, row.totalItems, this.formatDate(row.intakeAt), this.formatDate(row.dueAt), row.supplierName || '', row.openIssues, row.estimatedCostPaise / 100, row.actualCostPaise / 100])];
    const csv = rows.map((row) => row.map((value) => `"${String(value).replaceAll('"','""')}"`).join(',')).join('\r\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' })); const link = document.createElement('a'); link.href = url; link.download = `laundry-register-${new Date().toISOString().slice(0,10)}.csv`; link.click(); URL.revokeObjectURL(url);
  }
  printRegister() { window.print(); }
  formatDate(value?: string) { return value ? new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(value)) : '—'; }
  money(paise = 0) { return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(paise / 100); }
  clientName(client: Client) { return `${client.firstName} ${client.lastName || ''}`.trim(); }
  label(value: string) { return value ? value.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase()) : 'All statuses'; }
  isOverdue(order: Order) { return Boolean(order.dueAt && !['returned', 'cancelled'].includes(order.status) && new Date(order.dueAt).getTime() < Date.now()); }
  titleCase(value: string) { return value.replace(/\b\S+/g, (word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()); }
  private emptyDraft() { return { ownerType: 'salon', clientId: '', supplierId: '', priority: 'normal', dueDate: '', dueTime: '18:00', totalWeightKg: '', estimatedCostRupees: '', notes: '', items: [this.emptyItem()] }; }
  private emptyItem(): DraftItem { return { itemName: '', category: 'towel', quantity: '1', barcode: '', color: '', material: '', conditionIn: '' }; }
  private toPaise(value: string) { const amount = Number(value || 0); return Number.isFinite(amount) ? Math.round(amount * 100) : 0; }
  private async loadDetail(orderId: string) { const result = await firstValueFrom(this.api.get<ApiEnvelope<Detail>>(`/inventory/laundry/orders/${orderId}`)); if (!result.data) throw new Error('Laundry order was not found'); this.detail = result.data; this.transitionNote = ''; this.actualCostRupees = ''; this.issueDraft = { itemId: '', issueType: 'damage', severity: 'medium', description: '', chargeRupees: '' }; this.issueResolutions = {}; }
  private async action(action: () => Promise<void>, fallback: string) { this.busy = true; this.error = ''; try { await action(); } catch (error) { this.error = this.message(error, fallback); } finally { this.busy = false; } }
  private message(error: any, fallback: string) { return error?.error?.error?.message || error?.error?.message || fallback; }
}
