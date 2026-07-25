import { LanguageService } from '../../../core/i18n/language.service';
import { CommonModule } from '@angular/common';
import { Component, inject, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { DatePickerComponent } from '../../../shared/date-picker/date-picker.component';
import { AuthService } from '../../../core/services/auth.service';
import { TranslatePipe } from '../../../shared/pipes/translate.pipe';
import {
  BackbarControlService,
  BackbarClient as Client,
  BackbarItem as Item,
  BackbarService as Service,
  BackbarStaff as Staff,
  BackbarUsage as Usage,
} from '../../../features/inventory/backbar-control.service';

type BackbarTab = 'usage' | 'daily' | 'variance' | 'approvals' | 'audit';

@Component({
  selector: 'page-backbar-consumption',
  standalone: true,
  imports: [CommonModule, FormsModule, DatePickerComponent, TranslatePipe],
  templateUrl: './backbar-consumption-page.component.html',
  styleUrls: ['./backbar-consumption-page.component.css'],
})
export class BackbarConsumptionPageComponent implements OnInit {
  private readonly language = inject(LanguageService);
  private readonly auth = inject(AuthService);
  private readonly backbar = inject(BackbarControlService);
  private readonly router = inject(Router);
  items: Item[] = [];
  services: Service[] = [];
  staff: Staff[] = [];
  clients: Client[] = [];
  usage: Usage[] = [];
  activeTab: BackbarTab = 'usage';
  filterDate = '';
  filterStaff = '';
  workflow = '';
  loading = true;
  saving = false;
  drawerOpen = false;
  error = '';
  formError = '';
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
      const [staff, usage] = await Promise.all([
        this.backbar.staff(), this.backbar.usage(this.filterDate, this.filterStaff),
      ]);
      this.staff = staff; this.usage = usage;
      void this.loadFormOptions();
    } catch (error) { this.error = this.message(error, this.language.text('inventory.message.130bf2c64b')); }
    finally { this.loading = false; }
  }

  private async loadFormOptions() {
    this.formError = '';
    try {
      [this.items, this.services, this.clients] = await Promise.all([
        this.backbar.items(), this.backbar.services(), this.backbar.clients(),
      ]);
    } catch (error) { this.formError = this.message(error, 'Form options could not be loaded'); }
  }

  openRecord() { this.draft = this.emptyDraft(); this.drawerOpen = true; this.clearFeedback(); if (this.formError) void this.loadFormOptions(); }
  openScanner() { void this.router.navigate(['/inventory/scanner']); }
  openContainers() { void this.router.navigate(['/inventory/backbar/containers']); }
  closeRecord() { if (!this.saving) this.drawerOpen = false; }
  serviceChanged() { if (!this.availableItems.some((item) => item.id === this.draft.inventoryItemId)) this.draft.inventoryItemId = ''; }
  staffName(row: Staff) { return row.appointmentDisplayName || `${row.firstName} ${row.lastName}`.trim(); }
  clientName(row: Client) { return `${row.firstName} ${row.lastName}`.trim() || row.phone || row.id; }
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
      const response: any = await this.backbar.recordUsage({
        inventoryItemId: item.id, serviceId: this.draft.serviceId || null, staffId: this.draft.staffId || null,
        clientId: this.draft.clientId || null,
        actualQuantity: actual, notes: this.draft.notes.trim(), idempotencyKey: crypto.randomUUID(),
      });
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
      await this.backbar.reviewUsage(row.id, { decision, reviewNote: reviewNote || '' });
      await this.load(); this.notice = decision === 'approve' ? 'Usage approved and stock updated' : 'Usage rejected';
    } catch (error) { this.error = this.message(error, this.language.text('inventory.message.b646c3516a')); }
    finally { this.saving = false; }
  }

  exportCsv() {
    const rows = this.visibleUsage.map((row) => [this.date(row.createdAt), row.itemName, row.source, row.serviceName, row.staffName, row.clientName, row.expectedQuantity, row.actualQuantity, row.varianceQuantity, row.unit, row.status]);
    const csv = [['Date', 'Product', 'Invoice / Source', 'Service', 'Staff', 'Client', 'Expected', 'Actual', 'Variance', 'Unit', 'Status'].map((value) => this.language.textValue(value)), ...rows]
      .map((row) => row.map((value) => `"${String(value).replaceAll('"', '""')}"`).join(',')).join('\r\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a'); link.href = url; link.download = `backbar-usage-${this.filterDate || 'all'}.csv`; link.click(); URL.revokeObjectURL(url);
  }

  private emptyDraft() { return { inventoryItemId: '', serviceId: '', staffId: '', clientId: '', actualQuantity: null as number | null, notes: '' }; }
  private message(error: any, fallback: string) { return error?.error?.error?.message ?? error?.error?.message ?? error?.message ?? fallback; }
  private clearFeedback() { this.error = ''; this.notice = ''; }
}
