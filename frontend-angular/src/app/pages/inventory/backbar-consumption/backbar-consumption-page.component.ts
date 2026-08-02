import { LanguageService } from '../../../core/i18n/language.service';
import { CommonModule } from '@angular/common';
import { Component, inject, OnDestroy, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { DatePickerComponent } from '../../../shared/date-picker/date-picker.component';
import { AuthService } from '../../../core/services/auth.service';
import { TranslatePipe } from '../../../shared/pipes/translate.pipe';
import {
  BackbarControlService,
  BackbarAppointment as Appointment,
  BackbarClient as Client,
  BackbarBatch as Batch,
  BackbarContainer as Container,
  BackbarItem as Item,
  BackbarService as Service,
  BackbarStaff as Staff,
  BackbarUsage as Usage,
  ColorBowl,
  ColorDailyVariance,
  ColorServiceMargin,
  ColorStaffShiftRow,
  FormulaRecommendation,
  InventoryAnomalySuggestion,
  ReorderForecast,
} from '../../../features/inventory/backbar-control.service';
import { DigitalScaleService } from '../../../features/inventory/digital-scale.service';

type BackbarTab = 'usage' | 'daily' | 'staff' | 'automation' | 'variance' | 'approvals' | 'audit';

@Component({
  selector: 'page-backbar-consumption',
  standalone: true,
  imports: [CommonModule, FormsModule, DatePickerComponent, TranslatePipe],
  templateUrl: './backbar-consumption-page.component.html',
  styleUrls: ['./backbar-consumption-page.component.css'],
})
export class BackbarConsumptionPageComponent implements OnInit, OnDestroy {
  private readonly language = inject(LanguageService);
  private readonly auth = inject(AuthService);
  private readonly backbar = inject(BackbarControlService);
  private readonly scale = inject(DigitalScaleService);
  private readonly router = inject(Router);
  items: Item[] = [];
  services: Service[] = [];
  staff: Staff[] = [];
  clients: Client[] = [];
  appointments: Appointment[] = [];
  containers: Container[] = [];
  batches: Batch[] = [];
  usage: Usage[] = [];
  bowls: ColorBowl[] = [];
  dailyVariance: ColorDailyVariance[] = [];
  staffShiftRows: ColorStaffShiftRow[] = [];
  serviceMargins: ColorServiceMargin[] = [];
  reorderForecast: ReorderForecast | null = null;
  anomalySuggestions: InventoryAnomalySuggestion[] = [];
  formulaRecommendation: FormulaRecommendation | null = null;
  activeTab: BackbarTab = 'usage';
  filterDate = '';
  filterStaff = '';
  filterClient = '';
  filterAppointment = '';
  workflow = '';
  loading = true;
  saving = false;
  drawerOpen = false;
  error = '';
  formError = '';
  automationError = '';
  notice = '';
  scaleStatus = '';
  scaleReading: number | null = null;
  scaleCalibration = 1;
  scaleLineIndex = 0;
  recommendationLoading = false;
  automationLoading = false;
  draft = this.emptyDraft();

  ngOnInit() { void this.load(); }
  ngOnDestroy() { this.scale.disconnect(); }

  get tabRows() {
    if (this.activeTab === 'variance') return this.usage.filter((row) => row.varianceQuantity !== 0);
    if (this.activeTab === 'approvals') return this.usage.filter((row) => row.status === 'pending_approval');
    return this.usage;
  }
  get visibleUsage() { return this.tabRows.filter((row) => !this.workflow || row.status === this.workflow); }
  get visibleBowls() { return this.bowls.filter((row) => !this.workflow || row.status === this.workflow); }
  get visibleStaffShiftRows() { return this.staffShiftRows.filter((row) => !this.filterStaff || row.staffId === this.filterStaff); }
  get scaleSupported() { return this.scale.supported; }
  get scaleConnected() { return this.scale.connected; }
  get colourProductIds() {
    return new Set(this.services.flatMap((service) => service.productConsumption.map((line) => String(line.productId ?? line.itemId ?? line.inventoryItemId ?? ''))).filter(Boolean));
  }
  get lowStockForecastRows() { const ids = this.colourProductIds; return ids.size ? (this.reorderForecast?.recommendations ?? []).filter((row) => ids.has(row.inventoryItemId)) : []; }
  get expectedTotal() { return this.visibleUsage.reduce((sum, row) => sum + row.expectedQuantity, 0); }
  get actualTotal() { return this.visibleUsage.reduce((sum, row) => sum + row.actualQuantity, 0); }
  get varianceTotal() { return this.actualTotal - this.expectedTotal; }
  get pendingApprovals() { return this.usage.filter((row) => row.status === 'pending_approval').length; }
  get canReview() { return this.auth.hasRole('owner') || this.auth.hasPermission('inventory.approve'); }
  get canExportReports() { return this.auth.hasAccess(['owner', 'admin'], ['reports.export']); }
  get filterAppointments() { return this.appointments.filter((row) => !this.filterClient || row.clientId === this.filterClient); }
  get draftAppointments() { return this.appointments.filter((row) => (!this.draft.clientId || row.clientId === this.draft.clientId) && !['cancelled', 'canceled', 'no-show', 'no_show'].includes(row.status.toLowerCase())); }
  get availableServices() {
    const appointment = this.appointments.find((row) => row.id === this.draft.appointmentId);
    if (!appointment) return this.services;
    const ids = new Set(appointment.serviceIds);
    return this.services.filter((row) => ids.has(row.id));
  }
  get tableTitle() {
    if (this.activeTab === 'daily') return 'Daily product control';
    if (this.activeTab === 'variance') return 'Consumption variance';
    if (this.activeTab === 'approvals') return 'Pending usage approvals';
    if (this.activeTab === 'audit') return 'Consumption audit trail';
    return 'Product consumption accountability';
  }
  availableItemsFor(inventoryItemId = '') {
    const recipe = this.selectedRecipe();
    if (!recipe) return this.items;
    const ids = new Set(recipe.map((line) => String(line.productId ?? line.itemId ?? line.inventoryItemId ?? '')));
    const rows = this.items.filter((item) => ids.has(item.id));
    return inventoryItemId && !rows.some((item) => item.id === inventoryItemId)
      ? [...rows, ...this.items.filter((item) => item.id === inventoryItemId)] : rows;
  }
  expectedQuantity(inventoryItemId: string) {
    const line = this.selectedRecipe()?.find((entry) => String(entry.productId ?? entry.itemId ?? entry.inventoryItemId ?? '') === inventoryItemId);
    return Number(line?.standardQty ?? line?.quantity ?? line?.qty ?? 0);
  }
  usageRange(inventoryItemId: string) {
    const line = this.selectedRecipe()?.find((entry) => String(entry.productId ?? entry.itemId ?? entry.inventoryItemId ?? '') === inventoryItemId);
    if (!line) return '—';
    const target = Number(line.standardQty ?? line.quantity ?? line.qty ?? 0);
    return `${Number(line.minQty ?? 0)} / ${target} / ${Number(line.maxQty ?? 0) || target}`;
  }

  private selectedRecipe() {
    const appointment=this.appointments.find((row)=>row.id===this.draft.appointmentId);
    return appointment?.recipeSnapshots.find((row)=>row.serviceId===this.draft.serviceId)?.recipe
      ?? this.services.find((row)=>row.id===this.draft.serviceId)?.productConsumption;
  }

  async load() {
    this.loading = true; this.error = '';
    try {
      const [staff, usage, bowls, dailyVariance, staffShiftRows] = await Promise.all([
        this.backbar.staff(), this.backbar.usage(this.filterDate, this.filterStaff, this.filterClient, this.filterAppointment),
        this.backbar.bowls(this.filterDate, this.filterClient, this.filterAppointment),
        this.backbar.dailyColorVariance(this.filterDate),
        this.backbar.colorStaffShiftDashboard(this.filterDate),
      ]);
      this.staff = staff; this.usage = usage; this.bowls = bowls; this.dailyVariance = dailyVariance; this.staffShiftRows = staffShiftRows;
      void this.loadFormOptions(); void this.loadAutomation();
    } catch (error) { this.error = this.message(error, this.language.text('inventory.message.130bf2c64b')); }
    finally { this.loading = false; }
  }

  private async loadFormOptions() {
    this.formError = '';
    try {
      [this.items, this.services, this.clients, this.appointments, this.containers, this.batches] = await Promise.all([
        this.backbar.items(), this.backbar.services(), this.backbar.clients(), this.backbar.appointments(), this.backbar.containers(), this.backbar.batches(),
      ]);
    } catch (error) { this.formError = this.message(error, 'Form options could not be loaded'); }
  }

  private async loadAutomation() {
    this.automationLoading = true; this.automationError = '';
    try {
      [this.serviceMargins, this.reorderForecast, this.anomalySuggestions] = await Promise.all([
        this.backbar.colorServiceMargins(this.filterDate), this.backbar.reorderForecast(), this.backbar.colorAnomalySuggestions(),
      ]);
    } catch (error) { this.automationError = this.message(error, 'Colour automation could not be loaded'); }
    finally { this.automationLoading = false; }
  }

  openRecord() {
    this.draft = { ...this.emptyDraft(), clientId: this.filterClient, appointmentId: this.filterAppointment };
    this.formulaRecommendation = null; this.scaleReading = null; this.scaleLineIndex = 0;
    if (this.draft.appointmentId) this.appointmentChanged();
    this.drawerOpen = true; this.clearFeedback(); if (this.formError) void this.loadFormOptions();
  }
  openScanner() { void this.router.navigate(['/inventory/scanner']); }
  openContainers() { void this.router.navigate(['/inventory/backbar/containers']); }
  closeRecord() { if (!this.saving) this.drawerOpen = false; }
  serviceChanged() {
    const allowed = new Set(this.availableItemsFor().map((item) => item.id));
    this.draft.lines.forEach((line) => { if (!allowed.has(line.inventoryItemId)) line.inventoryItemId = ''; });
    void this.loadFormulaRecommendation();
  }
  filterClientChanged() { if (!this.filterAppointments.some((row) => row.id === this.filterAppointment)) this.filterAppointment = ''; }
  draftClientChanged() { if (!this.draftAppointments.some((row) => row.id === this.draft.appointmentId)) this.draft.appointmentId = ''; void this.loadFormulaRecommendation(); }
  appointmentChanged() {
    const appointment = this.appointments.find((row) => row.id === this.draft.appointmentId);
    if (!appointment) return;
    this.draft.clientId = appointment.clientId;
    this.draft.staffId = appointment.staffId;
    if (!appointment.serviceIds.includes(this.draft.serviceId)) this.draft.serviceId = appointment.serviceIds.length === 1 ? appointment.serviceIds[0] : '';
    this.serviceChanged();
  }
  addLine() { if (this.draft.lines.length < 12) this.draft.lines.push(this.emptyLine(this.draft.lines.length ? 'fashion' : 'base')); }
  removeLine(index: number) { if (this.draft.lines.length > 1) this.draft.lines.splice(index, 1); }
  async loadFormulaRecommendation() {
    if (!this.draft.clientId || !this.draft.serviceId) { this.formulaRecommendation = null; return; }
    this.recommendationLoading = true;
    try { this.formulaRecommendation = await this.backbar.formulaRecommendation(this.draft.clientId, this.draft.serviceId); }
    catch { this.formulaRecommendation = null; }
    finally { this.recommendationLoading = false; }
  }
  applyFormulaRecommendation() {
    if (!this.formulaRecommendation?.lines.length) return;
    const allowed = new Set(this.availableItemsFor().map((item) => item.id));
    const lines = this.formulaRecommendation.lines.filter((line) => allowed.has(line.inventoryItemId));
    if (!lines.length) { this.error = 'Recommended formula products are no longer available for this service'; return; }
    this.draft.lines = lines.map((line) => ({ componentType: line.componentType, inventoryItemId: line.inventoryItemId, actualQuantity: line.suggestedQuantity, wasteReason: '', notes: '' }));
    this.scaleLineIndex = 0;
  }
  async connectScale() {
    try {
      this.scale.setCalibration(Number(this.scaleCalibration));
      const name = await this.scale.connect((grams) => {
        this.scaleReading = grams;
        const line = this.draft.lines[this.scaleLineIndex];
        if (line) line.actualQuantity = Math.round(grams);
      });
      this.scaleStatus = `${name} connected`;
    } catch (error) { this.scaleStatus = this.message(error, 'Scale connection failed'); }
  }
  updateScaleCalibration() {
    try { this.scale.setCalibration(Number(this.scaleCalibration)); this.scaleStatus = 'Calibration updated'; }
    catch (error) { this.scaleStatus = this.message(error, 'Invalid calibration'); }
  }
  tareScale() { this.scale.tare(); this.scaleReading = 0; this.scaleStatus = 'Scale tared'; }
  disconnectScale() { this.scale.disconnect(); this.scaleStatus = 'Scale disconnected'; this.scaleReading = null; }
  async generateLowStockForecast() {
    this.saving = true; this.automationError = '';
    try { await this.backbar.runReorderForecast(); await this.loadAutomation(); this.notice = 'Low-stock forecast refreshed'; }
    catch (error) { this.automationError = this.message(error, 'Low-stock forecast could not be generated'); }
    finally { this.saving = false; }
  }
  itemBalance(inventoryItemId: string) {
    const rows = this.containers.filter((row) => row.inventoryItemId === inventoryItemId);
    const open = rows.find((row) => row.status === 'open');
    const sealed = rows.filter((row) => row.status === 'sealed');
    if (open) {
      const batch=this.batches.find((row)=>row.id===open.batchId);
      return `Open ${open.remainingQuantity} ${open.unit} · Sealed ${sealed.length}${batch ? ` · Batch ${batch.batchNumber}${batch.expiryDate ? ` expires ${this.date(batch.expiryDate)}` : ''}` : ''}`;
    }
    if (sealed.length) return `${sealed.length} sealed · open a tube first`;
    const item = this.items.find((row) => row.id === inventoryItemId);
    const nextBatch = this.batches.filter((row) => row.inventoryItemId === inventoryItemId && row.quantity > 0)
      .sort((left, right) => String(left.expiryDate || '9999').localeCompare(String(right.expiryDate || '9999')))[0];
    const guidance = nextBatch ? ` · FEFO ${nextBatch.batchNumber}${nextBatch.expiryDate ? ` expires ${this.date(nextBatch.expiryDate)}` : ''}` : '';
    return item ? `Unified stock ${item.stockQuantity} ${item.unit}${guidance}` : '';
  }
  staffName(row: Staff) { return row.appointmentDisplayName || `${row.firstName} ${row.lastName}`.trim(); }
  clientName(row: Client) { return `${row.firstName} ${row.lastName}`.trim() || row.phone || row.id; }
  appointmentLabel(row: Appointment) { return `${new Intl.DateTimeFormat('en-GB', { dateStyle:'short', timeStyle:'short' }).format(new Date(row.startAt))} · ${row.serviceIds.map((id) => this.services.find((service) => service.id === id)?.name).filter(Boolean).join(', ') || 'Service'}`; }
  appointmentReference(id?: string) { const row = this.appointments.find((appointment) => appointment.id === id); return row ? this.appointmentLabel(row) : (id || '—'); }
  date(value: string) { return new Intl.DateTimeFormat('en-GB').format(new Date(value)); }
  quantity(value: number, unit = '') { return `${Number(value || 0).toLocaleString('en-IN')} ${unit}`.trim(); }
  money(paise: number) { return this.language.formatCurrency(Number(paise || 0) / 100); }
  percent(bps?: number) { return bps == null ? '—' : `${(bps / 100).toLocaleString('en-IN', { maximumFractionDigits: 1 })}%`; }
  statusLabel(status: string) {
    if (status === 'auto_consumed') return 'Automatic';
    if (status === 'pending_approval') return 'Pending approval';
    if (status === 'rejected') return 'Rejected';
    if (status === 'recorded') return 'Recorded';
    return status.replaceAll('_', ' ').replace(/\b\w/g, (char) => char.toUpperCase());
  }
  usageProfileLabel(value: string) { return value === 'root_touch_up' ? 'Root touch-up' : value === 'full_colour' ? 'Full colour' : 'Custom'; }
  wasteReasonLabel(value: string) { return value ? value.replaceAll('_', ' ').replace(/\b\w/g, (char) => char.toUpperCase()) : '—'; }
  shiftLabel(row: ColorStaffShiftRow) {
    const shifts = [[row.shift1Start, row.shift1End], [row.shift2Start, row.shift2End]].filter(([start, end]) => start && end).map(([start, end]) => `${start}–${end}`);
    return shifts.join(' / ') || row.shiftStatus.replaceAll('_', ' ');
  }

  async save() {
    const lines = this.draft.lines.map((line) => ({ ...line, actualQuantity: Number(line.actualQuantity), wasteReason: line.wasteReason, notes: line.notes.trim() }));
    const ids = new Set(lines.map((line) => line.inventoryItemId));
    if (!this.draft.appointmentId || !this.draft.clientId || !this.draft.serviceId || !this.draft.staffId) { this.error = 'Appointment, client, service and stylist are required'; return; }
    if (lines.some((line) => !this.items.some((item) => item.id === line.inventoryItemId) || !Number.isInteger(line.actualQuantity) || line.actualQuantity <= 0) || ids.size !== lines.length) {
      this.error = 'Every bowl line requires a unique product and positive whole-gram scale reading'; return;
    }
    this.saving = true; this.clearFeedback();
    try {
      const response: any = await this.backbar.recordBowl({
        appointmentId: this.draft.appointmentId, clientId: this.draft.clientId,
        serviceId: this.draft.serviceId, staffId: this.draft.staffId,
        notes: this.draft.notes.trim(), lines, idempotencyKey: crypto.randomUUID(),
      });
      this.drawerOpen = false; await this.load();
      this.notice = response?.data?.status === 'pending_approval' ? 'Bowl slip sent for owner approval' : 'Colour bowl recorded';
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

  async reverse(row: Usage) {
    const reason = window.prompt('Reversal reason')?.trim();
    if (!reason) return;
    this.saving = true; this.clearFeedback();
    try { await this.backbar.reverseUsage(row.id, reason); await this.load(); this.notice = 'Usage reversed'; }
    catch (error) { this.error = this.message(error, 'Usage could not be reversed'); }
    finally { this.saving = false; }
  }

  exportCsv() {
    if (!this.canExportReports) { this.error = 'Report export permission is required'; return; }
    const rows = this.visibleUsage.map((row) => [this.date(row.createdAt), this.appointmentReference(row.appointmentId), row.itemName, row.itemBrand, row.source, row.serviceName, row.staffName, row.clientName, row.expectedQuantity, row.actualQuantity, row.varianceQuantity, row.unit, row.status]);
    const csv = [['Date', 'Appointment', 'Product', 'Brand', 'Invoice / Source', 'Service', 'Staff', 'Client', 'Expected', 'Actual', 'Variance', 'Unit', 'Status'].map((value) => this.language.textValue(value)), ...rows]
      .map((row) => row.map((value) => `"${String(value).replaceAll('"', '""')}"`).join(',')).join('\r\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a'); link.href = url; link.download = `backbar-usage-${this.filterDate || 'all'}.csv`; link.click(); URL.revokeObjectURL(url);
  }

  private emptyLine(componentType: 'base' | 'fashion' | 'developer' | 'other' = 'base') { return { componentType, inventoryItemId: '', actualQuantity: null as number | null, wasteReason: '', notes: '' }; }
  private emptyDraft() { return { serviceId: '', staffId: '', clientId: '', appointmentId: '', notes: '', lines: [this.emptyLine()] }; }
  private message(error: any, fallback: string) { return error?.error?.error?.message ?? error?.error?.message ?? error?.message ?? fallback; }
  private clearFeedback() { this.error = ''; this.notice = ''; }
}
