
import { Component, inject, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink, RouterLinkActive } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { ApiEnvelope, ApiService } from '../../shared/services/api.service';

type Desk = 'catalog' | 'active' | 'pending' | 'expired' | 'completed' | 'alerts' | 'settings';
type ReportStatus = 'pending' | 'expired' | 'completed';
type ValidityUnit = 'days' | 'months' | 'years';
type ServiceRow = { serviceId: string; serviceName: string; quantity: number | string; unitPrice: number | string; addonPrice: number | string };
type Package = {
  id: string; name: string; description: string; pricePaise: number; discountPercent: number;
  validityDays: number; serviceIds: string[]; serviceRows: Array<{ serviceId: string; serviceName?: string; quantity: number; unitPricePaise: number; addonPricePaise?: number }>;
  paidSessions: number; freeSessions: number; costPricePaise: number; showMobileApp: boolean; showOnlineBooking: boolean; active: boolean;
  rules?: { packageType?: string; groupName?: string };
};
type Service = { id: string; name: string; active: boolean };
type ReportRow = {
  id: string; clientName: string; contact: string; packageName: string; serviceName: string; invoiceNumber: string;
  totalQty: number; redeemedQty: number; pendingQty: number; issuedValuePaise: number; redeemedValuePaise: number;
  pendingValuePaise: number; soldAt: string; expiresAt?: string; status: string;
};
type ReportSummary = { totalRows: number; totalQty: number; redeemedQty: number; pendingQty: number; issuedValuePaise: number; redeemedValuePaise: number; pendingValuePaise: number };
type PackageReport = { status: ReportStatus; summary: ReportSummary; rows: ReportRow[]; total: number };
type PackageAlert = { alertType: string; severity: string; clientName: string; contact: string; packageName: string; serviceName: string; pendingQty: number; pendingValuePaise: number; expiresAt?: string };
type PackageSettings = {
  packageCatalog: { salesEnabled: boolean; visibleInPos: boolean; packageGroupsEnabled: boolean; paidPackageAddonEnabled: boolean };
  creditsRedemption: { allowPartial: boolean; blockWhenExpired: boolean; allowCrossService: boolean; requireStaffConfirmation: boolean };
  expiryRenewal: { defaultExpiryDays: number | string; expiredPendingAction: string; renewalReminderDays: number | string };
  pricingPayment: { allowDiscount: boolean; taxApplicable: boolean; taxInclusive: boolean; allowDue: boolean };
  onlineBooking: { showPackages: boolean; allowClientPurchase: boolean; allowPackageServiceBooking: boolean };
  remindersRisk: { pendingCreditReminder: boolean; ownerHighPendingAlert: boolean; expiryReminder: boolean; highPendingThresholdPaise: number | string };
  defaults: { defaultStatus: string; defaultPackageType: string };
};

@Component({
    selector: 'page-packages',
    imports: [FormsModule, RouterLink, RouterLinkActive],
    templateUrl: './packages-page.component.html',
    styleUrls: ['./packages-page.component.css']
})
export class PackagesPageComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly route = inject(ActivatedRoute);
  readonly deskTabs: Array<{ key: Desk; label: string }> = [
    { key: 'catalog', label: 'Catalog' }, { key: 'active', label: 'Active Credits' },
    { key: 'pending', label: 'Pending' }, { key: 'expired', label: 'Expired' },
    { key: 'completed', label: 'Completed' }, { key: 'alerts', label: 'Alerts' }, { key: 'settings', label: 'Settings' },
  ];
  activeDesk: Desk = 'catalog';
  packages: Package[] = [];
  services: Service[] = [];
  report = this.blankReport('pending');
  settings = this.blankSettings();
  alerts: PackageAlert[] = [];
  search = '';
  drawerOpen = false;
  loading = true;
  reportLoading = false;
  saving = false;
  error = '';
  message = '';
  editingId = '';
  selectedServiceId = '';
  autoPriceFromPreset = false;
  form = this.blankForm();

  ngOnInit() {
    const tab = this.route.snapshot.queryParamMap.get('tab');
    if (this.deskTabs.some((item) => item.key === tab)) this.activeDesk = tab as Desk;
    void this.loadWorkspace();
  }
  get filteredPackages() { const query = this.search.trim().toLowerCase(); return !query ? this.packages : this.packages.filter((item) => item.name.toLowerCase().includes(query)); }
  get reportTitle() { return this.activeDesk === 'active' ? 'Active Package Credits' : `${this.capitalize(this.activeDesk)} Packages`; }
  get derivedCostPaise() { return this.form.serviceRows.reduce((sum, row) => sum + Math.round(this.number(row.quantity) * this.number(row.unitPrice) * 100), 0); }
  get availableServices() { return this.services.filter((service) => !this.form.serviceRows.some((row) => row.serviceId === service.id)); }

  async loadWorkspace() {
    this.loading = true; this.error = '';
    await Promise.all([this.loadPackages(), this.loadServices(), this.loadSettings()]);
    if (this.activeDesk === 'alerts') await this.loadAlerts();
    else if (this.activeDesk !== 'catalog' && this.activeDesk !== 'settings') await this.loadReport();
    this.loading = false;
  }
  async setDesk(desk: Desk) {
    this.activeDesk = desk; this.search = ''; this.error = ''; this.message = '';
    if (desk === 'alerts') await this.loadAlerts();
    else if (desk !== 'catalog' && desk !== 'settings') await this.loadReport();
  }
  openCreate() { this.editingId = ''; this.form = this.blankForm(); this.form.packageType = this.settings.defaults.defaultPackageType || 'paid'; this.form.active = this.settings.defaults.defaultStatus !== 'inactive'; this.form.validityValue = this.settings.expiryRenewal.defaultExpiryDays || ''; this.selectedServiceId = ''; this.autoPriceFromPreset = false; this.error = ''; this.drawerOpen = true; }
  openEdit(item: Package) {
    this.editingId = item.id;
    this.form = {
      name: item.name, description: item.description, price: item.pricePaise ? item.pricePaise / 100 : '',
      discountPercent: item.discountPercent || '', ...this.validityParts(item.validityDays), paidSessions: item.paidSessions || '',
      freeSessions: item.freeSessions || '', serviceRows: item.serviceRows.map((row) => ({ serviceId: row.serviceId, serviceName: row.serviceName || this.serviceName(row.serviceId), quantity: row.quantity, unitPrice: row.unitPricePaise ? row.unitPricePaise / 100 : '', addonPrice: row.addonPricePaise ? row.addonPricePaise / 100 : '' })),
      packageType: item.rules?.packageType || this.settings.defaults.defaultPackageType || 'paid', groupName: item.rules?.groupName || '',
      showMobileApp: item.showMobileApp, showOnlineBooking: item.showOnlineBooking, active: item.active,
    };
    this.autoPriceFromPreset = false; this.error = ''; this.drawerOpen = true;
  }
  closeDrawer() { this.drawerOpen = false; }
  addServiceRow() {
    const service = this.services.find((item) => item.id === this.selectedServiceId);
    if (!service || this.form.serviceRows.some((row) => row.serviceId === service.id)) return;
    const sessionQuantity = this.autoPriceFromPreset ? this.number(this.form.paidSessions) + this.number(this.form.freeSessions) : 0;
    this.form.serviceRows = [...this.form.serviceRows, { serviceId: service.id, serviceName: service.name, quantity: sessionQuantity || '', unitPrice: '', addonPrice: '' }];
    this.selectedServiceId = '';
    this.recalculatePresetPrice();
  }
  removeServiceRow(id: string) { this.form.serviceRows = this.form.serviceRows.filter((row) => row.serviceId !== id); this.recalculatePresetPrice(); }
  applySessionPreset(paid: number, free: number) {
    this.form.paidSessions = paid;
    this.form.freeSessions = free;
    this.autoPriceFromPreset = true;
    this.applySessionQuantity();
    this.recalculatePresetPrice();
  }
  onSessionCountChange(field: 'paidSessions' | 'freeSessions', value: string | number) {
    this.form[field] = value;
    this.autoPriceFromPreset = true;
    this.applySessionQuantity();
    this.recalculatePresetPrice();
  }
  onServiceQuantityChange(row: ServiceRow, value: string | number) { row.quantity = value; this.recalculatePresetPrice(); }
  onServiceUnitPriceChange(row: ServiceRow, value: string | number) { row.unitPrice = value; this.recalculatePresetPrice(); }
  onSellingPriceChange(value: string | number) { this.form.price = value; this.autoPriceFromPreset = false; }
  applyValidityPreset(value: number, unit: ValidityUnit) { this.form.validityValue = value; this.form.validityUnit = unit; }
  titleCase(value: string) { return value.split(' ').map((word) => word ? word[0].toUpperCase() + word.slice(1).toLowerCase() : word).join(' '); }
  rupees(value: number) { return `₹${(value / 100).toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`; }
  formatDate(value?: string) { if (!value) return '—'; const date = new Date(value); return Number.isNaN(date.getTime()) ? '—' : new Intl.DateTimeFormat('en-GB').format(date); }

  async save() {
    if (!this.form.name.trim()) { this.error = 'Package name required'; return; }
    if (!this.form.serviceRows.length) { this.error = 'Add at least one service'; return; }
    if (this.form.serviceRows.some((row) => this.number(row.quantity) <= 0)) { this.error = 'Service quantity must be greater than zero'; return; }
    this.saving = true; this.error = '';
    const serviceRows = this.form.serviceRows.map((row) => ({ serviceId: row.serviceId, serviceName: row.serviceName, quantity: this.number(row.quantity), unitPricePaise: Math.round(this.number(row.unitPrice) * 100), addonPricePaise: Math.round(this.number(row.addonPrice) * 100) }));
    const payload = {
      name: this.form.name.trim(), description: this.form.description.trim(), pricePaise: Math.round(this.number(this.form.price) * 100),
      discountPercent: this.number(this.form.discountPercent), validityDays: this.validityDays(),
      paidSessions: Math.max(1, this.number(this.form.paidSessions)), freeSessions: this.number(this.form.freeSessions),
      costPricePaise: this.derivedCostPaise, serviceIds: serviceRows.map((row) => row.serviceId), serviceRows,
      rules: { type: 'pay_x_get_y', packageType: this.form.packageType, groupName: this.settings.packageCatalog.packageGroupsEnabled ? this.form.groupName.trim() : '' },
      showMobileApp: this.form.showMobileApp, showOnlineBooking: this.form.showOnlineBooking, active: this.form.active,
    };
    try {
      const result = this.editingId
        ? await firstValueFrom(this.api.patch<ApiEnvelope<Package>>(`/packages/${this.editingId}`, payload))
        : await firstValueFrom(this.api.post<ApiEnvelope<Package>>('/packages', payload));
      if (!result.success) throw new Error(result.error?.message || result.error || 'Package save failed');
      await this.loadPackages(); this.closeDrawer(); this.message = this.editingId ? 'Package updated' : 'Package created';
    } catch (error) { this.error = error instanceof Error ? error.message : 'Package save failed'; }
    finally { this.saving = false; }
  }
  async remove(item: Package) {
    if (!confirm(`Delete ${item.name}?`)) return;
    try { await firstValueFrom(this.api.delete<ApiEnvelope<unknown>>(`/packages/${item.id}`)); await this.loadPackages(); this.message = 'Package deleted'; }
    catch { this.error = 'Package delete failed'; }
  }
  async saveSettings() {
    this.saving = true; this.error = '';
    const payload = { ...this.settings, expiryRenewal: { ...this.settings.expiryRenewal, defaultExpiryDays: this.number(this.settings.expiryRenewal.defaultExpiryDays), renewalReminderDays: this.number(this.settings.expiryRenewal.renewalReminderDays) }, remindersRisk: { ...this.settings.remindersRisk, highPendingThresholdPaise: this.number(this.settings.remindersRisk.highPendingThresholdPaise) } };
    try {
      const result = await firstValueFrom(this.api.patch<ApiEnvelope<PackageSettings>>('/package-enterprise/settings', payload));
      if (!result.success || !result.data) throw new Error(result.error?.message || result.error || 'Settings save failed');
      this.settings = this.mergeSettings(result.data); this.message = 'Package settings saved'; await this.loadSettings();
    } catch (error) { this.error = error instanceof Error ? error.message : 'Settings save failed'; }
    finally { this.saving = false; }
  }
  async searchReport() { await this.loadReport(); }
  async exportReport(format: 'csv' | 'pdf') {
    const status = this.reportStatus();
    try {
      const query = new URLSearchParams({ status, format });
      if (this.search.trim()) query.set('q', this.search.trim());
      const blob = await firstValueFrom(this.api.getBlob(`/package-enterprise/reports/export?${query}`));
      const url = URL.createObjectURL(blob); const link = document.createElement('a');
      link.href = url; link.download = `packages-${status}.${format}`; link.click(); URL.revokeObjectURL(url);
    } catch { this.error = `Package ${format.toUpperCase()} export failed`; }
  }

  async loadPackages() {
    try {
      const result = await firstValueFrom(this.api.get<ApiEnvelope<Package[]>>('/packages'));
      this.packages = result.success && Array.isArray(result.data) ? result.data.map((item) => ({ ...item, serviceIds: Array.isArray(item.serviceIds) ? item.serviceIds : [], serviceRows: Array.isArray(item.serviceRows) ? item.serviceRows : [], paidSessions: item.paidSessions || 1, freeSessions: item.freeSessions || 0 })) : [];
    } catch { this.packages = []; this.error = 'Packages could not be loaded'; }
  }
  private async loadServices() {
    try { const result = await firstValueFrom(this.api.get<ApiEnvelope<Service[]>>('/services')); this.services = result.success && Array.isArray(result.data) ? result.data.filter((item) => item.active !== false) : []; }
    catch { this.services = []; }
  }
  private async loadSettings() {
    try { const result = await firstValueFrom(this.api.get<ApiEnvelope<PackageSettings>>('/package-enterprise/settings')); this.settings = result.success && result.data ? this.mergeSettings(result.data) : this.blankSettings(); }
    catch { this.settings = this.blankSettings(); }
  }
  private async loadReport() {
    this.reportLoading = true; this.error = '';
    const status = this.reportStatus(); const query = new URLSearchParams({ status, limit: '500' });
    if (this.search.trim()) query.set('q', this.search.trim());
    try { const result = await firstValueFrom(this.api.get<ApiEnvelope<PackageReport>>(`/package-enterprise/reports?${query}`)); this.report = result.success && result.data ? result.data : this.blankReport(status); }
    catch { this.report = this.blankReport(status); this.error = 'Package credits could not be loaded'; }
    finally { this.reportLoading = false; }
  }
  private async loadAlerts() {
    this.reportLoading = true; this.error = '';
    try { const result = await firstValueFrom(this.api.get<ApiEnvelope<PackageAlert[]>>('/package-enterprise/alerts')); this.alerts = result.success && Array.isArray(result.data) ? result.data : []; }
    catch { this.alerts = []; this.error = 'Package alerts could not be loaded'; }
    finally { this.reportLoading = false; }
  }
  private reportStatus(): ReportStatus { return this.activeDesk === 'expired' ? 'expired' : this.activeDesk === 'completed' ? 'completed' : 'pending'; }
  private serviceName(id: string) { return this.services.find((item) => item.id === id)?.name || 'Service'; }
  private capitalize(value: string) { return value ? value[0].toUpperCase() + value.slice(1) : value; }
  private blankReport(status: ReportStatus): PackageReport { return { status, total: 0, rows: [], summary: { totalRows: 0, totalQty: 0, redeemedQty: 0, pendingQty: 0, issuedValuePaise: 0, redeemedValuePaise: 0, pendingValuePaise: 0 } }; }
  private blankSettings(): PackageSettings { return { packageCatalog: { salesEnabled: true, visibleInPos: true, packageGroupsEnabled: true, paidPackageAddonEnabled: true }, creditsRedemption: { allowPartial: true, blockWhenExpired: true, allowCrossService: false, requireStaffConfirmation: true }, expiryRenewal: { defaultExpiryDays: '', expiredPendingAction: 'block', renewalReminderDays: 15 }, pricingPayment: { allowDiscount: true, taxApplicable: true, taxInclusive: false, allowDue: true }, onlineBooking: { showPackages: false, allowClientPurchase: false, allowPackageServiceBooking: true }, remindersRisk: { pendingCreditReminder: true, ownerHighPendingAlert: true, expiryReminder: true, highPendingThresholdPaise: '' }, defaults: { defaultStatus: 'active', defaultPackageType: 'paid' } }; }
  private mergeSettings(value: Partial<PackageSettings>): PackageSettings { const base = this.blankSettings(); return { packageCatalog: { ...base.packageCatalog, ...value.packageCatalog }, creditsRedemption: { ...base.creditsRedemption, ...value.creditsRedemption }, expiryRenewal: { ...base.expiryRenewal, ...value.expiryRenewal }, pricingPayment: { ...base.pricingPayment, ...value.pricingPayment }, onlineBooking: { ...base.onlineBooking, ...value.onlineBooking }, remindersRisk: { ...base.remindersRisk, ...value.remindersRisk }, defaults: { ...base.defaults, ...value.defaults } }; }
  private blankForm() { return { name: '', description: '', price: '' as string | number, discountPercent: '' as string | number, validityValue: '' as string | number, validityUnit: 'days' as ValidityUnit, paidSessions: '' as string | number, freeSessions: '' as string | number, packageType: 'paid', groupName: '', serviceRows: [] as ServiceRow[], showMobileApp: false, showOnlineBooking: true, active: true }; }
  private validityDays() { const value = this.number(this.form.validityValue); return this.form.validityUnit === 'years' ? value * 365 : this.form.validityUnit === 'months' ? value * 30 : value; }
  private validityParts(days: number) { return days > 0 && days % 365 === 0 ? { validityValue: days / 365, validityUnit: 'years' as ValidityUnit } : days > 0 && days % 30 === 0 ? { validityValue: days / 30, validityUnit: 'months' as ValidityUnit } : { validityValue: days || '', validityUnit: 'days' as ValidityUnit }; }
  private applySessionQuantity() {
    const quantity = this.number(this.form.paidSessions) + this.number(this.form.freeSessions);
    if (quantity > 0) this.form.serviceRows.forEach((row) => row.quantity = quantity);
  }
  private recalculatePresetPrice() {
    if (!this.autoPriceFromPreset) return;
    const paid = this.number(this.form.paidSessions);
    const total = paid + this.number(this.form.freeSessions);
    this.form.price = total > 0 && this.derivedCostPaise > 0 ? Math.round(this.derivedCostPaise * paid / total) / 100 : '';
  }
  private number(value: string | number) { return Math.max(0, Number(value) || 0); }
}
