import { CommonModule } from '@angular/common';
import { Component, inject, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink, RouterLinkActive } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { ApiEnvelope, ApiService } from '../../shared/services/api.service';

type Desk = 'catalog' | 'active' | 'pending' | 'expired' | 'completed' | 'settings';
type ReportStatus = 'pending' | 'expired' | 'completed';
type ServiceRow = { serviceId: string; serviceName: string; quantity: number | string; unitPrice: number | string };
type Package = {
  id: string; name: string; description: string; pricePaise: number; discountPercent: number;
  validityDays: number; serviceIds: string[]; serviceRows: Array<{ serviceId: string; serviceName?: string; quantity: number; unitPricePaise: number }>;
  paidSessions: number; freeSessions: number; costPricePaise: number; showMobileApp: boolean; showOnlineBooking: boolean; active: boolean;
};
type Service = { id: string; name: string; active: boolean };
type ReportRow = {
  id: string; clientName: string; contact: string; packageName: string; serviceName: string; invoiceNumber: string;
  totalQty: number; redeemedQty: number; pendingQty: number; issuedValuePaise: number; redeemedValuePaise: number;
  pendingValuePaise: number; soldAt: string; expiresAt?: string; status: string;
};
type ReportSummary = { totalRows: number; totalQty: number; redeemedQty: number; pendingQty: number; issuedValuePaise: number; redeemedValuePaise: number; pendingValuePaise: number };
type PackageReport = { status: ReportStatus; summary: ReportSummary; rows: ReportRow[]; total: number };
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
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, RouterLinkActive],
  templateUrl: './packages-page.component.html',
  styleUrls: ['./packages-page.component.css'],
})
export class PackagesPageComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly route = inject(ActivatedRoute);
  readonly deskTabs: Array<{ key: Desk; label: string }> = [
    { key: 'catalog', label: 'Catalog' }, { key: 'active', label: 'Active Credits' },
    { key: 'pending', label: 'Pending' }, { key: 'expired', label: 'Expired' },
    { key: 'completed', label: 'Completed' }, { key: 'settings', label: 'Settings' },
  ];
  activeDesk: Desk = 'catalog';
  packages: Package[] = [];
  services: Service[] = [];
  report = this.blankReport('pending');
  settings = this.blankSettings();
  search = '';
  drawerOpen = false;
  loading = true;
  reportLoading = false;
  saving = false;
  error = '';
  message = '';
  editingId = '';
  selectedServiceId = '';
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
    if (this.activeDesk !== 'catalog' && this.activeDesk !== 'settings') await this.loadReport();
    this.loading = false;
  }
  async setDesk(desk: Desk) {
    this.activeDesk = desk; this.search = ''; this.error = ''; this.message = '';
    if (desk !== 'catalog' && desk !== 'settings') await this.loadReport();
  }
  openCreate() { this.editingId = ''; this.form = this.blankForm(); this.selectedServiceId = ''; this.error = ''; this.drawerOpen = true; }
  openEdit(item: Package) {
    this.editingId = item.id;
    this.form = {
      name: item.name, description: item.description, price: item.pricePaise ? item.pricePaise / 100 : '',
      discountPercent: item.discountPercent || '', validityDays: item.validityDays || '', paidSessions: item.paidSessions || '',
      freeSessions: item.freeSessions || '', serviceRows: item.serviceRows.map((row) => ({ serviceId: row.serviceId, serviceName: row.serviceName || this.serviceName(row.serviceId), quantity: row.quantity, unitPrice: row.unitPricePaise ? row.unitPricePaise / 100 : '' })),
      showMobileApp: item.showMobileApp, showOnlineBooking: item.showOnlineBooking, active: item.active,
    };
    this.error = ''; this.drawerOpen = true;
  }
  closeDrawer() { this.drawerOpen = false; }
  addServiceRow() {
    const service = this.services.find((item) => item.id === this.selectedServiceId);
    if (!service || this.form.serviceRows.some((row) => row.serviceId === service.id)) return;
    this.form.serviceRows = [...this.form.serviceRows, { serviceId: service.id, serviceName: service.name, quantity: '', unitPrice: '' }];
    this.selectedServiceId = '';
  }
  removeServiceRow(id: string) { this.form.serviceRows = this.form.serviceRows.filter((row) => row.serviceId !== id); }
  applySessionPreset(paid: number, free: number) { this.form.paidSessions = paid; this.form.freeSessions = free; }
  applyValidityPreset(days: number) { this.form.validityDays = days; }
  titleCase(value: string) { return value.split(' ').map((word) => word ? word[0].toUpperCase() + word.slice(1).toLowerCase() : word).join(' '); }
  rupees(value: number) { return `₹${(value / 100).toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`; }
  formatDate(value?: string) { if (!value) return '—'; const date = new Date(value); return Number.isNaN(date.getTime()) ? '—' : new Intl.DateTimeFormat('en-GB').format(date); }

  async save() {
    if (!this.form.name.trim()) { this.error = 'Package name required'; return; }
    if (!this.form.serviceRows.length) { this.error = 'Add at least one service'; return; }
    if (this.form.serviceRows.some((row) => this.number(row.quantity) <= 0)) { this.error = 'Service quantity must be greater than zero'; return; }
    this.saving = true; this.error = '';
    const serviceRows = this.form.serviceRows.map((row) => ({ serviceId: row.serviceId, serviceName: row.serviceName, quantity: this.number(row.quantity), unitPricePaise: Math.round(this.number(row.unitPrice) * 100) }));
    const payload = {
      name: this.form.name.trim(), description: this.form.description.trim(), pricePaise: Math.round(this.number(this.form.price) * 100),
      discountPercent: this.number(this.form.discountPercent), validityDays: this.number(this.form.validityDays),
      paidSessions: Math.max(1, this.number(this.form.paidSessions)), freeSessions: this.number(this.form.freeSessions),
      costPricePaise: this.derivedCostPaise, serviceIds: serviceRows.map((row) => row.serviceId), serviceRows,
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
  private reportStatus(): ReportStatus { return this.activeDesk === 'expired' ? 'expired' : this.activeDesk === 'completed' ? 'completed' : 'pending'; }
  private serviceName(id: string) { return this.services.find((item) => item.id === id)?.name || 'Service'; }
  private capitalize(value: string) { return value ? value[0].toUpperCase() + value.slice(1) : value; }
  private blankReport(status: ReportStatus): PackageReport { return { status, total: 0, rows: [], summary: { totalRows: 0, totalQty: 0, redeemedQty: 0, pendingQty: 0, issuedValuePaise: 0, redeemedValuePaise: 0, pendingValuePaise: 0 } }; }
  private blankSettings(): PackageSettings { return { packageCatalog: { salesEnabled: true, visibleInPos: true, packageGroupsEnabled: true, paidPackageAddonEnabled: true }, creditsRedemption: { allowPartial: true, blockWhenExpired: true, allowCrossService: false, requireStaffConfirmation: true }, expiryRenewal: { defaultExpiryDays: '', expiredPendingAction: 'block', renewalReminderDays: 15 }, pricingPayment: { allowDiscount: true, taxApplicable: true, taxInclusive: false, allowDue: true }, onlineBooking: { showPackages: false, allowClientPurchase: false, allowPackageServiceBooking: true }, remindersRisk: { pendingCreditReminder: true, ownerHighPendingAlert: true, expiryReminder: true, highPendingThresholdPaise: '' }, defaults: { defaultStatus: 'active', defaultPackageType: 'paid' } }; }
  private mergeSettings(value: Partial<PackageSettings>): PackageSettings { const base = this.blankSettings(); return { packageCatalog: { ...base.packageCatalog, ...value.packageCatalog }, creditsRedemption: { ...base.creditsRedemption, ...value.creditsRedemption }, expiryRenewal: { ...base.expiryRenewal, ...value.expiryRenewal }, pricingPayment: { ...base.pricingPayment, ...value.pricingPayment }, onlineBooking: { ...base.onlineBooking, ...value.onlineBooking }, remindersRisk: { ...base.remindersRisk, ...value.remindersRisk }, defaults: { ...base.defaults, ...value.defaults } }; }
  private blankForm() { return { name: '', description: '', price: '' as string | number, discountPercent: '' as string | number, validityDays: '' as string | number, paidSessions: '' as string | number, freeSessions: '' as string | number, serviceRows: [] as ServiceRow[], showMobileApp: false, showOnlineBooking: true, active: true }; }
  private number(value: string | number) { return Math.max(0, Number(value) || 0); }
}
