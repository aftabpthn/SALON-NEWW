import { CommonModule } from '@angular/common';
import { Component, inject, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { AuthService } from '../../core/services/auth.service';
import { ApiService } from '../../shared/services/api.service';

type SettingsPanel = 'appointments' | 'branches' | 'franchise' | 'roles' | 'services' | 'ai' | 'clientForms';

type SettingsSection = {
  code: string;
  title: string;
  route?: string;
  panel?: SettingsPanel;
};

type AppointmentColorSetting = {
  status: string;
  enabled: boolean;
  color: string;
  label: string;
};

type AppointmentSettings = {
  startTime: string;
  endTime: string;
  overlapTimeSlot: boolean;
  previousTimeSlot: boolean;
  weekStartFrom: string;
  slotMinutes: number;
  timeFormat: string;
  roomNumberOption: boolean;
  staffCalendar: boolean;
  defaultStatus: string;
  colors: AppointmentColorSetting[];
};

type ChairRoomOption = { id: string; name: string; kind: string };
type AuthPermissionOption = { code: string; label: string; group: string };
type AuthPermissionGroup = { name: string; permissions: AuthPermissionOption[] };
type AuthMaskOption = { code: string; label: string };
type ManagedAuthRole = {
  id: string;
  name: string;
  permissions: string[];
  deniedPermissions: string[];
  maskedFields: string[];
  maxDiscountPaise: number | null;
  maxRefundPaise: number | null;
  maxCashMovementPaise: number | null;
  isSystem: boolean;
};
type AuthRoleManagementData = {
  roles: ManagedAuthRole[];
  permissionOptions: AuthPermissionOption[];
  maskOptions: AuthMaskOption[];
};
type ManagedBranch = {
  id: string;
  name: string;
  code: string;
  regionName: string;
  zoneName: string;
  clusterName: string;
  address: string;
  latitude: number | null;
  longitude: number | null;
  bookingDepositPercent: number;
  royaltyBps: number;
  royaltyMinimumPaise: number;
  active: boolean;
  createdAt: string;
  updatedAt: string | null;
};

type CentralServiceMaster = {
  id: string;
  name: string;
  category: string;
  durationMinutes: number;
  pricePaise: number;
  active: boolean;
  linkedBranchCount: number;
};

type CentralProductMaster = {
  id: string;
  sku: string;
  name: string;
  category: string;
  active: boolean;
  linkedBranchCount: number;
};

type RoyaltyStatement = {
  id: string;
  branchId: string;
  branchName: string;
  periodStart: string;
  grossSalesPaise: number;
  royaltyBps: number;
  minimumPaise: number;
  royaltyPaise: number;
  status: 'draft' | 'posted' | 'paid';
  paidAt?: string;
};

type FranchiseControls = {
  centralBranchId: string;
  allowedOverrideFields: string[];
  overrideOptions: string[];
  branches: ManagedBranch[];
  centralMasters: CentralServiceMaster[];
  centralProductMasters: CentralProductMaster[];
  royaltyStatements: RoyaltyStatement[];
};

type CrossLocationSettings = {
  enabled: boolean;
  acceptInbound: boolean;
  scope: 'tenant' | 'region' | 'zone' | 'cluster';
  allowDiscounts: boolean;
  allowServiceCredits: boolean;
};

type MembershipSettingsPayload = Record<string, unknown> & {
  crossLocation?: CrossLocationSettings;
};

type ServiceSettings = {
  serviceCatalog: { serviceAddonsEnabled: boolean };
  pricingDuration: { defaultDurationMinutes: number };
  staffAssignment: { staffAssignmentRequired: boolean; allowMultiStaff: boolean };
  recipeInventory: { requireRecipeForService: boolean };
  defaults: { defaultStatus: 'active' | 'inactive'; defaultGstRate: number };
  serviceMasterRules: {
    categoryRequired: boolean;
    durationRequired: boolean;
    duplicateServiceNameBlock: boolean;
  };
  pricingRules: { minimumPriceRule: boolean };
};

type AiGovernanceSettings = {
  enabled: boolean;
  allowedChannels: string[];
  requireBookingConfirmation: boolean;
  redactSensitiveData: boolean;
  transcriptRetentionDays: number;
  promptVersion: string;
  bookingUrl: string;
};

type ClientFormFieldSetting = {
  key: string;
  label: string;
  default: boolean;
  mandatory: boolean;
  displayOnBookNow: boolean;
  lockedDefault?: boolean;
  lockedMandatory?: boolean;
};

type ClientFormSettings = {
  branchId: string;
  fields: ClientFormFieldSetting[];
  settings: Record<string, Record<string, boolean>>;
};

@Component({
  selector: 'page-settings',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './settings-page.component.html',
  styleUrls: ['./settings-page.component.css'],
})
export class SettingsPageComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly auth = inject(AuthService);
  private readonly appointmentSettingsKey = 'aurashine.appointment.settings';
  search = '';
  activePanel: SettingsPanel | '' = '';
  saveStatus = '';
  saveError = '';
  saving = false;
  chairRooms: ChairRoomOption[] = [];
  chairRoomName = '';
  chairRoomKind: 'chair' | 'room' = 'chair';
  chairRoomError = '';
  chairRoomSaving = false;
  roles: ManagedAuthRole[] = [];
  permissionOptions: AuthPermissionOption[] = [];
  maskOptions: AuthMaskOption[] = [];
  selectedRoleId = '';
  roleName = '';
  rolePermissions: string[] = [];
  roleDeniedPermissions: string[] = [];
  roleMaskedFields: string[] = [];
  roleMaxDiscount = '';
  roleMaxRefund = '';
  roleMaxCashMovement = '';
  permissionSearch = '';
  rolesLoading = false;
  rolesSaving = false;
  roleError = '';
  roleStatus = '';
  branches: ManagedBranch[] = [];
  branchSearch = '';
  selectedBranchId = '';
  branchName = '';
  branchCode = '';
  branchRegion = '';
  branchZone = '';
  branchCluster = '';
  branchAddress = '';
  branchLatitude = '';
  branchLongitude = '';
  branchDepositPercent = '';
  branchesLoading = false;
  branchSaving = false;
  branchError = '';
  branchStatus = '';
  franchiseCentralBranchId = '';
  franchisePersistedCentralBranchId = '';
  franchiseAllowedOverrides: string[] = [];
  franchiseOverrideOptions: string[] = [];
  franchiseMasters: CentralServiceMaster[] = [];
  franchiseProductMasters: CentralProductMaster[] = [];
  royaltyStatements: RoyaltyStatement[] = [];
  royaltyDrafts: Record<string, { percent: string; minimumRupees: string }> = {};
  royaltyPeriod = this.previousMonth();
  franchiseLoading = false;
  franchiseSaving = false;
  franchiseError = '';
  franchiseStatus = '';
  membershipSettings: MembershipSettingsPayload = {};
  sharingPolicy: CrossLocationSettings = { enabled: false, acceptInbound: false, scope: 'tenant', allowDiscounts: false, allowServiceCredits: false };
  sharingLoading = false;
  sharingSaving = false;
  sharingLoaded = false;
  sharingError = '';
  sharingStatus = '';
  appointmentSettings = this.loadAppointmentSettings();
  serviceSettings = this.defaultServiceSettings();
  serviceSettingsLoading = false;
  serviceSettingsSaving = false;
  serviceSettingsError = '';
  serviceSettingsStatus = '';
  aiGovernance: AiGovernanceSettings = { enabled: false, allowedChannels: [], requireBookingConfirmation: true, redactSensitiveData: true, transcriptRetentionDays: 90, promptVersion: 'receptionist-v1', bookingUrl: '' };
  aiGovernanceLoading = false;
  aiGovernanceSaving = false;
  aiGovernanceError = '';
  aiGovernanceStatus = '';
  clientFormSettings: ClientFormSettings = this.defaultClientFormSettings();
  clientFormSettingsLoading = false;
  clientFormSettingsSaving = false;
  clientFormSettingsError = '';
  clientFormSettingsStatus = '';

  readonly weekStartOptions = ['Sunday', 'Monday'];
  readonly slotOptions = [10, 15, 30, 60];
  readonly timeFormatOptions = ['12 Hours', '24 Hours'];
  readonly clientFormSettingGroups = [
    { key: 'clientFormMasterRules', label: 'Client master rules' },
    { key: 'personalDetailRules', label: 'Personal details' },
    { key: 'contactValidationRules', label: 'Contact validation' },
    { key: 'preferenceTagsRules', label: 'Preferences and tags' },
    { key: 'privacyConsentRules', label: 'Privacy and consent' },
    { key: 'reportingLifecycleRules', label: 'Reporting lifecycle' },
  ];

  readonly sections: SettingsSection[] = [
    { code: 'BR', title: 'Branches', panel: 'branches' },
    { code: 'FR', title: 'Franchise controls', panel: 'franchise' },
    { code: 'ST', title: 'Staff', route: '/staff' },
    { code: 'SV', title: 'Services', panel: 'services' },
    { code: 'CL', title: 'Clients', route: '/clients' },
    { code: 'CF', title: 'Client form settings', panel: 'clientForms' },
    { code: 'AP', title: 'Appointments', panel: 'appointments' },
    { code: 'POS', title: 'POS', route: '/pos' },
    { code: 'INV', title: 'Invoice settings', route: '/settings/invoice' },
    { code: 'IN', title: 'Inventory', route: '/inventory' },
    { code: 'MB', title: 'Memberships', route: '/memberships' },
    { code: 'PK', title: 'Packages', route: '/packages' },
    { code: 'RP', title: 'Reports', route: '/reports' },
    { code: 'NT', title: 'Notifications', route: '/notifications' },
    { code: 'SEC', title: 'Roles & permissions', panel: 'roles' },
    { code: 'AI', title: 'AI governance', panel: 'ai' },
    { code: 'TAX', title: 'Taxes' },
    { code: 'PAY', title: 'Payments', route: '/pos/payment-modes' },
    { code: 'INT', title: 'Integrations', route: '/settings/integrations-data' },
    { code: 'DATA', title: 'Data', route: '/settings/integrations-data' },
  ];

  async ngOnInit() {
    try {
      const result = await firstValueFrom(this.api.get<any>('/api/v1/appointment-settings'));
      const body = result?.data ?? result;
      this.appointmentSettings = this.mergeAppointmentSettings({
        ...(body?.settings && typeof body.settings === 'object' ? body.settings : {}),
        overlapTimeSlot: Boolean(body?.allowOverlap ?? body?.allow_overlap),
      });
    } catch {
      // Keep the saved local calendar preference while the backend is unavailable.
    }
    await this.loadChairRooms();
  }

  get filteredSections() {
    const query = this.search.trim().toLowerCase();
    return this.sections.filter((item) => {
      if (item.panel === 'branches' && !this.auth.hasRole('owner')) return false;
      if (item.panel === 'franchise' && !this.auth.hasRole('owner', 'admin')) return false;
      if (item.panel === 'roles' && !this.auth.hasRole('owner', 'admin')) return false;
      if (item.panel === 'ai' && !this.auth.hasRole('owner', 'admin', 'manager')) return false;
      if (item.panel === 'clientForms' && !this.auth.hasRole('owner', 'admin', 'manager')) return false;
      if (item.panel === 'services'
        && !this.auth.hasRole('owner', 'admin', 'manager')
        && !this.auth.hasPermission('services.manage', 'management.write')) return false;
      return !query || `${item.code} ${item.title}`.toLowerCase().includes(query);
    });
  }

  get filteredBranches() {
    const query = this.branchSearch.trim().toLowerCase();
    return this.branches.filter((branch) =>
      !query || `${branch.name} ${branch.code} ${branch.regionName} ${branch.zoneName} ${branch.clusterName}`.toLowerCase().includes(query),
    );
  }

  get selectedBranch() {
    return this.branches.find((branch) => branch.id === this.selectedBranchId);
  }

  get appointmentStatusOptions() {
    const seen = new Set<string>();
    return this.appointmentSettings.colors
      .map((item) => item.label.trim())
      .filter((value) => {
        if (!value || seen.has(value.toLowerCase())) return false;
        seen.add(value.toLowerCase());
        return true;
      });
  }

  trackByCode(_: number, item: SettingsSection) {
    return item.code;
  }

  trackByChairRoom(_: number, item: ChairRoomOption) {
    return item.id;
  }

  trackByStatus(_: number, item: AppointmentColorSetting) {
    return item.status;
  }

  trackByRoleId(_: number, item: ManagedAuthRole) { return item.id; }
  trackByPermissionCode(_: number, item: AuthPermissionOption) { return item.code; }
  trackByPermissionGroup(_: number, item: AuthPermissionGroup) { return item.name; }
  trackByBranchId(_: number, item: ManagedBranch) { return item.id; }

  toggleAppointmentButton(item: AppointmentColorSetting) {
    item.enabled = !item.enabled;
  }

  isOpenPanel(panel: SettingsPanel) {
    return this.activePanel === panel;
  }

  async openPanel(panel: SettingsPanel) {
    this.activePanel = panel;
    this.saveStatus = '';
    this.saveError = '';
    if (panel === 'branches') await this.loadBranches();
    if (panel === 'franchise') await Promise.all([this.loadFranchiseControls(), this.loadSharingPolicy()]);
    if (panel === 'roles') await this.loadRoles();
    if (panel === 'services') await this.loadServiceSettings();
    if (panel === 'ai') await this.loadAiGovernance();
    if (panel === 'clientForms') await this.loadClientFormSettings();
  }

  closePanel() {
    this.activePanel = '';
    this.saveStatus = '';
    this.saveError = '';
  }

  hasAiChannel(channel: string) { return this.aiGovernance.allowedChannels.includes(channel); }

  toggleAiChannel(channel: string) {
    this.aiGovernance.allowedChannels = this.hasAiChannel(channel)
      ? this.aiGovernance.allowedChannels.filter((value) => value !== channel)
      : [...this.aiGovernance.allowedChannels, channel];
  }

  async loadAiGovernance() {
    this.aiGovernanceLoading = true;
    this.aiGovernanceError = '';
    try {
      const response = await firstValueFrom(this.api.get<any>('/api/v1/ai/governance'));
      const data = response?.data ?? response;
      this.aiGovernance = {
        enabled: Boolean(data.enabled), allowedChannels: Array.isArray(data.allowedChannels) ? data.allowedChannels : [],
        requireBookingConfirmation: data.requireBookingConfirmation !== false, redactSensitiveData: data.redactSensitiveData !== false,
        transcriptRetentionDays: Number(data.transcriptRetentionDays || 90), promptVersion: String(data.promptVersion || 'receptionist-v1'), bookingUrl: String(data.bookingUrl || ''),
      };
    } catch (error) { this.aiGovernanceError = this.apiError(error, 'Unable to load AI governance'); }
    finally { this.aiGovernanceLoading = false; }
  }

  async saveAiGovernance() {
    if (this.aiGovernanceSaving || !this.aiGovernance.allowedChannels.length) return;
    this.aiGovernanceSaving = true;
    this.aiGovernanceError = '';
    this.aiGovernanceStatus = '';
    try {
      await firstValueFrom(this.api.put('/api/v1/ai/governance', this.aiGovernance));
      this.aiGovernanceStatus = 'Saved';
      await this.loadAiGovernance();
    } catch (error) { this.aiGovernanceError = this.apiError(error, 'Unable to save AI governance'); }
    finally { this.aiGovernanceSaving = false; }
  }

  trackByClientFormField(_: number, item: ClientFormFieldSetting) { return item.key; }
  trackByClientFormGroup(_: number, item: { key: string }) { return item.key; }

  clientFormRules(groupKey: string) {
    return Object.keys(this.clientFormSettings.settings[groupKey] || {});
  }

  clientFormRuleLabel(key: string) {
    return key.replace(/([A-Z])/g, ' $1').replace(/^./, (value) => value.toUpperCase());
  }

  async loadClientFormSettings() {
    this.clientFormSettingsLoading = true;
    this.clientFormSettingsError = '';
    try {
      const response = await firstValueFrom(this.api.get<any>('/settings/clients/custom-form'));
      this.clientFormSettings = this.normalizeClientFormSettings(response?.data ?? response);
    } catch (error) { this.clientFormSettingsError = this.apiError(error, 'Unable to load client form settings'); }
    finally { this.clientFormSettingsLoading = false; }
  }

  async saveClientFormSettings() {
    if (this.clientFormSettingsSaving) return;
    this.clientFormSettingsSaving = true;
    this.clientFormSettingsError = '';
    this.clientFormSettingsStatus = '';
    try {
      const response = await firstValueFrom(this.api.put<any>('/settings/clients/custom-form', {
        fields: this.clientFormSettings.fields,
        settings: this.clientFormSettings.settings,
      }));
      this.clientFormSettings = this.normalizeClientFormSettings(response?.data ?? response);
      this.clientFormSettingsStatus = 'Saved';
    } catch (error) { this.clientFormSettingsError = this.apiError(error, 'Unable to save client form settings'); }
    finally { this.clientFormSettingsSaving = false; }
  }

  newBranch() {
    this.selectedBranchId = '';
    this.branchName = '';
    this.branchCode = '';
    this.branchRegion = '';
    this.branchZone = '';
    this.branchCluster = '';
    this.branchAddress = '';
    this.branchLatitude = '';
    this.branchLongitude = '';
    this.branchDepositPercent = '';
    this.branchError = '';
    this.branchStatus = '';
  }

  selectBranch(branch: ManagedBranch) {
    this.selectedBranchId = branch.id;
    this.branchName = branch.name;
    this.branchCode = branch.code;
    this.branchRegion = branch.regionName;
    this.branchZone = branch.zoneName;
    this.branchCluster = branch.clusterName;
    this.branchAddress = branch.address || '';
    this.branchLatitude = branch.latitude == null ? '' : String(branch.latitude);
    this.branchLongitude = branch.longitude == null ? '' : String(branch.longitude);
    this.branchDepositPercent = String(branch.bookingDepositPercent ?? 0);
    this.branchError = '';
    this.branchStatus = '';
  }

  async saveBranch() {
    if (this.branchSaving) return;
    const name = this.branchName.trim();
    const code = this.branchCode.trim().toUpperCase();
    const regionName = this.branchRegion.trim();
    const zoneName = this.branchZone.trim();
    const clusterName = this.branchCluster.trim();
    const address = this.branchAddress.trim();
    const latitude = String(this.branchLatitude).trim() ? Number(this.branchLatitude) : null;
    const longitude = String(this.branchLongitude).trim() ? Number(this.branchLongitude) : null;
    const bookingDepositPercent = String(this.branchDepositPercent).trim()
      ? Number(this.branchDepositPercent)
      : 0;
    this.branchError = '';
    this.branchStatus = '';
    if (name.length < 2 || name.length > 100 || !/^[A-Z0-9_-]{2,24}$/.test(code)) {
      this.branchError = 'Valid branch name and code are required';
      return;
    }
    if ((!regionName && zoneName) || (!zoneName && clusterName)) {
      this.branchError = 'Zone requires a region and cluster requires a zone';
      return;
    }
    if ((latitude == null) !== (longitude == null)
      || (latitude != null && (!Number.isFinite(latitude) || latitude < -90 || latitude > 90))
      || (longitude != null && (!Number.isFinite(longitude) || longitude < -180 || longitude > 180))
      || !Number.isInteger(bookingDepositPercent)
      || bookingDepositPercent < 0
      || bookingDepositPercent > 100) {
      this.branchError = 'Valid coordinates and deposit percent are required';
      return;
    }
    this.branchSaving = true;
    try {
      const path = this.selectedBranchId
        ? `/api/v1/settings/branches/${encodeURIComponent(this.selectedBranchId)}`
        : '/api/v1/settings/branches';
      const request = this.selectedBranchId
        ? this.api.patch<any>(path, { name, code, regionName, zoneName, clusterName, address, latitude, longitude, bookingDepositPercent })
        : this.api.post<any>(path, { name, code, regionName, zoneName, clusterName, address, latitude, longitude, bookingDepositPercent });
      const result = await firstValueFrom(request);
      const saved = result?.data ?? result;
      await this.loadBranches();
      const branch = this.branches.find((item) => item.id === saved?.id);
      if (branch) this.selectBranch(branch);
      this.branchStatus = 'Saved';
    } catch (error: any) {
      this.branchError = error?.error?.error?.message || error?.error?.message || error?.message || 'Unable to save branch';
    } finally {
      this.branchSaving = false;
    }
  }

  async toggleBranchStatus() {
    const branch = this.selectedBranch;
    if (!branch || this.branchSaving) return;
    if (branch.active && !window.confirm(`Deactivate ${branch.name}?`)) return;
    this.branchSaving = true;
    this.branchError = '';
    this.branchStatus = '';
    try {
      await firstValueFrom(this.api.patch(
        `/api/v1/settings/branches/${encodeURIComponent(branch.id)}`,
        { active: !branch.active },
      ));
      await this.loadBranches();
      const updated = this.branches.find((item) => item.id === branch.id);
      if (updated) this.selectBranch(updated);
      this.branchStatus = updated?.active ? 'Activated' : 'Deactivated';
    } catch (error: any) {
      this.branchError = error?.error?.error?.message || error?.error?.message || error?.message || 'Unable to update branch';
    } finally {
      this.branchSaving = false;
    }
  }

  hasFranchiseOverride(field: string) {
    return this.franchiseAllowedOverrides.includes(field);
  }

  toggleFranchiseOverride(field: string) {
    this.franchiseAllowedOverrides = this.hasFranchiseOverride(field)
      ? this.franchiseAllowedOverrides.filter((item) => item !== field)
      : [...this.franchiseAllowedOverrides, field];
  }

  async saveFranchiseControls() {
    if (this.franchiseSaving || !this.franchiseCentralBranchId) return;
    this.franchiseError = '';
    this.franchiseStatus = '';
    const royaltyRules = this.branches.map((branch) => {
      const draft = this.royaltyDrafts[branch.id] ?? { percent: '0', minimumRupees: '0' };
      return {
        branchId: branch.id,
        royaltyBps: Math.round(Number(draft.percent) * 100),
        minimumPaise: Math.round(Number(draft.minimumRupees) * 100),
      };
    });
    if (royaltyRules.some((rule) => !Number.isInteger(rule.royaltyBps)
      || rule.royaltyBps < 0 || rule.royaltyBps > 10_000
      || !Number.isInteger(rule.minimumPaise) || rule.minimumPaise < 0)) {
      this.franchiseError = 'Royalty percent must be 0–100 and minimum must be positive';
      return;
    }
    this.franchiseSaving = true;
    try {
      await firstValueFrom(this.api.put('/api/v1/settings/franchise-controls', {
        centralBranchId: this.franchiseCentralBranchId,
        allowedOverrideFields: this.franchiseAllowedOverrides,
        royaltyRules,
      }));
      await this.loadFranchiseControls();
      this.franchiseStatus = 'Saved';
    } catch (error: any) {
      this.franchiseError = this.apiError(error, 'Unable to save franchise controls');
    } finally {
      this.franchiseSaving = false;
    }
  }

  async saveSharingPolicy() {
    if (this.sharingSaving || !this.sharingLoaded) return;
    this.sharingSaving = true;
    this.sharingError = '';
    this.sharingStatus = '';
    try {
      await firstValueFrom(this.api.patch('/api/v1/membership-enterprise/settings', {
        ...this.membershipSettings,
        crossLocation: this.sharingPolicy,
      }));
      await this.loadSharingPolicy();
      this.sharingStatus = 'Saved';
    } catch (error: any) {
      this.sharingError = this.apiError(error, 'Unable to save membership sharing');
    } finally {
      this.sharingSaving = false;
    }
  }

  async publishCentralMasters() {
    if (this.franchiseSaving || !this.franchiseCentralBranchId || !window.confirm('Publish central service masters to active branches?')) return;
    this.franchiseSaving = true;
    this.franchiseError = '';
    this.franchiseStatus = '';
    try {
      const result = await firstValueFrom(this.api.post<any>('/api/v1/settings/franchise-controls/publish', {}));
      const published = Number((result?.data ?? result)?.published ?? 0);
      await this.loadFranchiseControls();
      this.franchiseStatus = `${published} branch service records synchronized`;
    } catch (error: any) {
      this.franchiseError = this.apiError(error, 'Unable to publish central masters');
    } finally {
      this.franchiseSaving = false;
    }
  }

  async generateRoyalties() {
    if (this.franchiseSaving || !/^\d{4}-\d{2}$/.test(this.royaltyPeriod)) return;
    this.franchiseSaving = true;
    this.franchiseError = '';
    this.franchiseStatus = '';
    try {
      const result = await firstValueFrom(this.api.post<any>('/api/v1/settings/franchise-controls/royalties', {
        periodStart: `${this.royaltyPeriod}-01`,
      }));
      const generated = Number((result?.data ?? result)?.generated ?? 0);
      await this.loadFranchiseControls();
      this.franchiseStatus = generated ? `${generated} royalty statements posted` : 'No new royalty statements';
    } catch (error: any) {
      this.franchiseError = this.apiError(error, 'Unable to generate royalties');
    } finally {
      this.franchiseSaving = false;
    }
  }

  async payRoyalty(statement: RoyaltyStatement) {
    if (this.franchiseSaving || statement.status !== 'posted' || !window.confirm(`Mark ${statement.branchName} royalty as paid?`)) return;
    this.franchiseSaving = true;
    this.franchiseError = '';
    this.franchiseStatus = '';
    try {
      await firstValueFrom(this.api.post(
        `/api/v1/settings/franchise-controls/royalties/${encodeURIComponent(statement.id)}/pay`,
        { paymentMethod: 'bank_transfer' },
      ));
      await this.loadFranchiseControls();
      this.franchiseStatus = 'Royalty paid';
    } catch (error: any) {
      this.franchiseError = this.apiError(error, 'Unable to pay royalty');
    } finally {
      this.franchiseSaving = false;
    }
  }

  franchiseLabel(value: string) {
    return this.titleCase(value.replace(/([a-z])([A-Z])/g, '$1 $2'));
  }

  formatPaise(value: number) {
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format((Number(value) || 0) / 100);
  }

  newRole() {
    this.selectedRoleId = '';
    this.roleName = '';
    this.rolePermissions = [];
    this.roleDeniedPermissions = [];
    this.roleMaskedFields = [];
    this.roleMaxDiscount = '';
    this.roleMaxRefund = '';
    this.roleMaxCashMovement = '';
    this.roleError = '';
    this.roleStatus = '';
  }

  selectRole(role: ManagedAuthRole) {
    this.selectedRoleId = role.id;
    this.roleName = role.name;
    this.rolePermissions = [...role.permissions];
    this.roleDeniedPermissions = [...(role.deniedPermissions ?? [])];
    this.roleMaskedFields = [...(role.maskedFields ?? [])];
    this.roleMaxDiscount = this.rupeeLimit(role.maxDiscountPaise);
    this.roleMaxRefund = this.rupeeLimit(role.maxRefundPaise);
    this.roleMaxCashMovement = this.rupeeLimit(role.maxCashMovementPaise);
    this.roleError = '';
    this.roleStatus = '';
  }

  get selectedRole() {
    return this.roles.find((role) => role.id === this.selectedRoleId);
  }

  get permissionGroups(): AuthPermissionGroup[] {
    const query = this.permissionSearch.trim().toLowerCase();
    const groups = new Map<string, AuthPermissionOption[]>();
    for (const permission of this.permissionOptions) {
      if (query && !`${permission.group} ${permission.label} ${permission.code}`.toLowerCase().includes(query)) continue;
      const group = permission.group || 'Other';
      groups.set(group, [...(groups.get(group) ?? []), permission]);
    }
    return [...groups].map(([name, permissions]) => ({ name, permissions }));
  }

  hasRolePermission(code: string) {
    return this.rolePermissions.includes(code);
  }

  toggleRolePermission(code: string) {
    if (this.selectedRole?.isSystem) return;
    if (this.hasRolePermission(code)) {
      this.rolePermissions = this.rolePermissions.filter((permission) => permission !== code);
      return;
    }
    this.rolePermissions = [...this.rolePermissions, code];
    this.roleDeniedPermissions = this.roleDeniedPermissions.filter((permission) => permission !== code);
  }

  hasDeniedPermission(code: string) {
    return this.roleDeniedPermissions.includes(code);
  }

  toggleDeniedPermission(code: string) {
    if (this.selectedRole?.isSystem) return;
    if (this.hasDeniedPermission(code)) {
      this.roleDeniedPermissions = this.roleDeniedPermissions.filter((permission) => permission !== code);
      return;
    }
    this.roleDeniedPermissions = [...this.roleDeniedPermissions, code];
    this.rolePermissions = this.rolePermissions.filter((permission) => permission !== code);
  }

  hasRoleMask(code: string) {
    return this.roleMaskedFields.includes(code);
  }

  toggleRoleMask(code: string) {
    if (this.selectedRole?.isSystem) return;
    this.roleMaskedFields = this.hasRoleMask(code)
      ? this.roleMaskedFields.filter((mask) => mask !== code)
      : [...this.roleMaskedFields, code];
  }

  async saveRole() {
    if (this.rolesSaving || this.selectedRole?.isSystem) return;
    const name = this.roleName.trim();
    this.roleError = '';
    this.roleStatus = '';
    if (name.length < 2 || !this.rolePermissions.length) {
      this.roleError = 'Role name and permission are required';
      return;
    }
    this.rolesSaving = true;
    try {
      const path = this.selectedRoleId
        ? `/api/v1/staff/auth-roles/${this.selectedRoleId}`
        : '/api/v1/staff/auth-roles';
      const payload = {
        name,
        permissions: this.rolePermissions,
        deniedPermissions: this.roleDeniedPermissions,
        maskedFields: this.roleMaskedFields,
        maxDiscountPaise: this.limitPaise(this.roleMaxDiscount),
        maxRefundPaise: this.limitPaise(this.roleMaxRefund),
        maxCashMovementPaise: this.limitPaise(this.roleMaxCashMovement),
      };
      const request = this.selectedRoleId
        ? this.api.put<any>(path, payload)
        : this.api.post<any>(path, payload);
      const result = await firstValueFrom(request);
      this.applyRoleData(result?.data ?? result);
      const saved = this.roles.find((role) => role.id === this.selectedRoleId)
        ?? this.roles.find((role) => role.name.toLowerCase() === name.toLowerCase());
      if (saved) this.selectRole(saved);
      this.roleStatus = 'Saved';
    } catch (error: any) {
      this.roleError = error?.error?.error?.message || error?.error?.message || error?.message || 'Unable to save role';
    } finally {
      this.rolesSaving = false;
    }
  }

  titleCase(value: string) {
    return value.replace(/\S+/g, (word) => word[0].toUpperCase() + word.slice(1).toLowerCase());
  }

  private async loadRoles() {
    this.rolesLoading = true;
    this.roleError = '';
    try {
      const result = await firstValueFrom(this.api.get<any>('/api/v1/staff/auth-roles'));
      this.applyRoleData(result?.data ?? result);
      if (this.selectedRoleId) {
        const selected = this.roles.find((role) => role.id === this.selectedRoleId);
        if (selected) this.selectRole(selected);
        else this.newRole();
      }
    } catch (error: any) {
      this.roles = [];
      this.permissionOptions = [];
      this.roleError = error?.error?.error?.message || error?.error?.message || error?.message || 'Unable to load roles';
    } finally {
      this.rolesLoading = false;
    }
  }

  private async loadBranches() {
    this.branchesLoading = true;
    this.branchError = '';
    try {
      const result = await firstValueFrom(this.api.get<any>('/api/v1/settings/branches'));
      const body = result?.data ?? result;
      this.branches = Array.isArray(body) ? body : [];
      if (this.selectedBranchId) {
        const selected = this.branches.find((branch) => branch.id === this.selectedBranchId);
        if (selected) this.selectBranch(selected);
        else this.newBranch();
      }
    } catch (error: any) {
      this.branches = [];
      this.branchError = error?.error?.error?.message || error?.error?.message || error?.message || 'Unable to load branches';
    } finally {
      this.branchesLoading = false;
    }
  }

  private async loadFranchiseControls() {
    this.franchiseLoading = true;
    this.franchiseError = '';
    try {
      const result = await firstValueFrom(this.api.get<any>('/api/v1/settings/franchise-controls'));
      const body = (result?.data ?? result) as FranchiseControls;
      this.franchiseCentralBranchId = String(body?.centralBranchId || '');
      this.franchisePersistedCentralBranchId = this.franchiseCentralBranchId;
      this.franchiseAllowedOverrides = Array.isArray(body?.allowedOverrideFields) ? body.allowedOverrideFields : [];
      this.franchiseOverrideOptions = Array.isArray(body?.overrideOptions) ? body.overrideOptions : [];
      this.branches = Array.isArray(body?.branches) ? body.branches : [];
      this.franchiseMasters = Array.isArray(body?.centralMasters) ? body.centralMasters : [];
      this.franchiseProductMasters = Array.isArray(body?.centralProductMasters) ? body.centralProductMasters : [];
      this.royaltyStatements = Array.isArray(body?.royaltyStatements) ? body.royaltyStatements : [];
      this.royaltyDrafts = Object.fromEntries(this.branches.map((branch) => [branch.id, {
        percent: String((Number(branch.royaltyBps) || 0) / 100),
        minimumRupees: String((Number(branch.royaltyMinimumPaise) || 0) / 100),
      }]));
    } catch (error: any) {
      this.branches = [];
      this.franchiseMasters = [];
      this.franchiseProductMasters = [];
      this.royaltyStatements = [];
      this.franchiseError = this.apiError(error, 'Unable to load franchise controls');
    } finally {
      this.franchiseLoading = false;
    }
  }

  private async loadSharingPolicy() {
    this.sharingLoading = true;
    this.sharingLoaded = false;
    this.sharingError = '';
    try {
      const result = await firstValueFrom(this.api.get<any>('/api/v1/membership-enterprise/settings'));
      const body = (result?.data ?? result) as MembershipSettingsPayload;
      if (!body || typeof body !== 'object' || !body.crossLocation) throw new Error('Membership sharing settings are unavailable');
      this.membershipSettings = body;
      this.sharingPolicy = { ...body.crossLocation };
      this.sharingLoaded = true;
    } catch (error: any) {
      this.membershipSettings = {};
      this.sharingError = this.apiError(error, 'Unable to load membership sharing');
    } finally {
      this.sharingLoading = false;
    }
  }

  private async loadServiceSettings() {
    this.serviceSettingsLoading = true;
    this.serviceSettingsError = '';
    try {
      const result = await firstValueFrom(this.api.get<any>('/api/v1/services/settings'));
      this.serviceSettings = this.mergeServiceSettings(result?.data ?? result);
    } catch (error: any) {
      this.serviceSettingsError = error?.error?.error?.message || error?.error?.message || error?.message || 'Unable to load service settings';
    } finally {
      this.serviceSettingsLoading = false;
    }
  }

  async saveServiceSettings() {
    if (this.serviceSettingsSaving) return;
    const duration = Number(this.serviceSettings.pricingDuration.defaultDurationMinutes);
    const gst = Number(this.serviceSettings.defaults.defaultGstRate);
    this.serviceSettingsError = '';
    this.serviceSettingsStatus = '';
    if (!Number.isInteger(duration) || duration < 5 || duration > 480 || !Number.isInteger(gst) || gst < 0 || gst > 100) {
      this.serviceSettingsError = 'Duration must be 5–480 and GST must be 0–100';
      return;
    }
    this.serviceSettingsSaving = true;
    try {
      await firstValueFrom(this.api.put('/api/v1/services/settings', this.serviceSettings));
      await this.loadServiceSettings();
      this.serviceSettingsStatus = 'Saved';
    } catch (error: any) {
      this.serviceSettingsError = error?.error?.error?.message || error?.error?.message || error?.message || 'Unable to save service settings';
    } finally {
      this.serviceSettingsSaving = false;
    }
  }

  private mergeServiceSettings(source: Partial<ServiceSettings> | null | undefined): ServiceSettings {
    const defaults = this.defaultServiceSettings();
    return {
      serviceCatalog: { ...defaults.serviceCatalog, ...source?.serviceCatalog },
      pricingDuration: { ...defaults.pricingDuration, ...source?.pricingDuration },
      staffAssignment: { ...defaults.staffAssignment, ...source?.staffAssignment },
      recipeInventory: { ...defaults.recipeInventory, ...source?.recipeInventory },
      defaults: { ...defaults.defaults, ...source?.defaults },
      serviceMasterRules: { ...defaults.serviceMasterRules, ...source?.serviceMasterRules },
      pricingRules: { ...defaults.pricingRules, ...source?.pricingRules },
    };
  }

  private applyRoleData(data: AuthRoleManagementData) {
    this.roles = Array.isArray(data?.roles) ? data.roles : [];
    this.permissionOptions = Array.isArray(data?.permissionOptions)
      ? data.permissionOptions.map((permission) => ({ ...permission, group: permission.group || 'Other' }))
      : [];
    this.maskOptions = Array.isArray(data?.maskOptions) ? data.maskOptions : [];
  }

  private rupeeLimit(value: number | null | undefined) {
    return value === null || value === undefined ? '' : String(value / 100);
  }

  private limitPaise(value: string) {
    const normalized = value.trim();
    if (!normalized) return null;
    const amount = Number(normalized);
    if (!Number.isFinite(amount) || amount < 0) throw new Error('Financial limits must be valid positive amounts');
    return Math.round(amount * 100);
  }

  private previousMonth() {
    const date = new Date();
    date.setMonth(date.getMonth() - 1, 1);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
  }

  private apiError(error: any, fallback: string) {
    return error?.error?.error?.message || error?.error?.message || error?.message || fallback;
  }

  resetAppointmentSettings() {
    this.appointmentSettings = this.defaultAppointmentSettings();
    this.saveStatus = '';
    this.saveError = '';
  }

  async saveAppointmentSettings() {
    if (this.saving) return;
    this.saveError = '';

    if (!this.validateAppointmentSettings()) {
      return;
    }

    this.saving = true;
    const cleaned = this.cleanAppointmentSettings(this.appointmentSettings);
    this.appointmentSettings = cleaned;
    try {
      await firstValueFrom(this.api.patch('/api/v1/appointment-settings', {
        allow_overlap: cleaned.overlapTimeSlot,
        settings: cleaned,
      }));
      localStorage.setItem(this.appointmentSettingsKey, JSON.stringify(cleaned));
      window.dispatchEvent(new Event('aurashine:appointment-settings-updated'));
      this.saveStatus = 'Saved';
    } catch (error: any) {
      this.saveError = error?.error?.error || error?.error?.message || error?.message || 'Unable to save appointment settings';
    } finally {
      this.saving = false;
    }
  }

  async addChairRoom() {
    const name = this.chairRoomName.trim();
    if (!name || this.chairRoomSaving) return;

    this.chairRoomError = '';
    this.chairRoomSaving = true;
    try {
      await firstValueFrom(this.api.post('/api/v1/appointment-resources', {
        name,
        kind: this.chairRoomKind,
      }));
      this.chairRoomName = '';
      await this.loadChairRooms();
    } catch {
      this.chairRoomError = 'Unable to add chair or room';
    } finally {
      this.chairRoomSaving = false;
    }
  }

  private async loadChairRooms() {
    try {
      const result = await firstValueFrom(this.api.get<any>('/api/v1/appointment-resources'));
      const body = result?.data ?? result;
      this.chairRooms = (Array.isArray(body) ? body : [])
        .map((item) => ({
          id: String(item?.id || ''),
          name: String(item?.name || ''),
          kind: String(item?.kind || 'chair'),
        }))
        .filter((item) => item.id && item.name);
    } catch {
      this.chairRooms = [];
    }
  }

  private loadAppointmentSettings(): AppointmentSettings {
    try {
      const saved = JSON.parse(localStorage.getItem(this.appointmentSettingsKey) || '{}');
      return this.mergeAppointmentSettings(saved);
    } catch {
      return this.defaultAppointmentSettings();
    }
  }

  private mergeAppointmentSettings(source: Partial<AppointmentSettings>): AppointmentSettings {
    const defaults = this.defaultAppointmentSettings();
    const merged: AppointmentSettings = { ...defaults, ...source };
    merged.startTime = String(source?.startTime || defaults.startTime);
    merged.endTime = String(source?.endTime || defaults.endTime);
    merged.overlapTimeSlot = Boolean(source?.overlapTimeSlot ?? defaults.overlapTimeSlot);
    merged.previousTimeSlot = Boolean(source?.previousTimeSlot ?? defaults.previousTimeSlot);
    merged.weekStartFrom = this.weekStartOptions.includes(source?.weekStartFrom || '')
      ? String(source?.weekStartFrom || defaults.weekStartFrom)
      : defaults.weekStartFrom;
    merged.slotMinutes = this.slotOptions.includes(Number(source?.slotMinutes) || 0)
      ? Number(source?.slotMinutes || defaults.slotMinutes)
      : defaults.slotMinutes;
    merged.timeFormat = this.timeFormatOptions.includes(source?.timeFormat || '')
      ? String(source?.timeFormat || defaults.timeFormat)
      : defaults.timeFormat;
    merged.roomNumberOption = Boolean(source?.roomNumberOption ?? defaults.roomNumberOption);
    merged.staffCalendar = Boolean(source?.staffCalendar ?? defaults.staffCalendar);
    merged.defaultStatus = String(source?.defaultStatus || defaults.defaultStatus);
    merged.colors = defaults.colors.map((item) => {
      const found = source?.colors?.find((entry) => entry?.status === item.status);
      return found
        ? {
            ...item,
            ...found,
            status: String(found.status || item.status),
            color: String(found.color || item.color || '').trim() || item.color,
            label: String(found.label || item.label || '').trim() || item.label,
            enabled: typeof found.enabled === 'boolean' ? found.enabled : item.enabled,
          }
        : item;
    });

    const normalized = this.cleanAppointmentSettings(merged);
    if (!normalized.colors.some((entry) => entry.enabled)) {
      normalized.colors[0].enabled = true;
    }

    return normalized;
  }

  private defaultServiceSettings(): ServiceSettings {
    return {
      serviceCatalog: { serviceAddonsEnabled: true },
      pricingDuration: { defaultDurationMinutes: 30 },
      staffAssignment: { staffAssignmentRequired: false, allowMultiStaff: true },
      recipeInventory: { requireRecipeForService: false },
      defaults: { defaultStatus: 'active', defaultGstRate: 18 },
      serviceMasterRules: {
        categoryRequired: false,
        durationRequired: false,
        duplicateServiceNameBlock: false,
      },
      pricingRules: { minimumPriceRule: false },
    };
  }

  private normalizeClientFormSettings(source: any): ClientFormSettings {
    const defaults = this.defaultClientFormSettings();
    const savedFields = Array.isArray(source?.fields) ? source.fields : [];
    return {
      branchId: String(source?.branchId || ''),
      fields: defaults.fields.map((field) => {
        const saved = savedFields.find((item: any) => item?.key === field.key) || {};
        return {
          ...field,
          default: field.lockedDefault ? true : typeof saved.default === 'boolean' ? saved.default : field.default,
          mandatory: field.lockedMandatory ? true : typeof saved.mandatory === 'boolean' ? saved.mandatory : field.mandatory,
          displayOnBookNow: typeof saved.displayOnBookNow === 'boolean' ? saved.displayOnBookNow : field.displayOnBookNow,
        };
      }),
      settings: Object.fromEntries(this.clientFormSettingGroups.map((group) => {
        const defaultsGroup = defaults.settings[group.key] || {};
        const savedGroup = source?.settings?.[group.key] || {};
        return [group.key, Object.fromEntries(Object.keys(defaultsGroup).map((key) => [
          key,
          typeof savedGroup[key] === 'boolean' ? savedGroup[key] : defaultsGroup[key],
        ]))];
      })),
    };
  }

  private defaultClientFormSettings(): ClientFormSettings {
    return {
      branchId: '',
      fields: [
        { key: 'name', label: 'Name', default: true, mandatory: true, displayOnBookNow: true, lockedDefault: true, lockedMandatory: true },
        { key: 'contact', label: 'Contact', default: true, mandatory: true, displayOnBookNow: true, lockedDefault: true, lockedMandatory: true },
        { key: 'email', label: 'Email', default: false, mandatory: false, displayOnBookNow: false },
        { key: 'dateOfBirth', label: 'Date Of Birth', default: true, mandatory: false, displayOnBookNow: false },
        { key: 'dateOfAnniversary', label: 'Date Of Anniversary', default: true, mandatory: false, displayOnBookNow: false },
        { key: 'gender', label: 'Gender', default: true, mandatory: false, displayOnBookNow: false },
        { key: 'address', label: 'Address', default: false, mandatory: false, displayOnBookNow: false },
        { key: 'gstNumber', label: 'GST Number', default: false, mandatory: false, displayOnBookNow: false },
        { key: 'parentName', label: 'Parent Name', default: false, mandatory: false, displayOnBookNow: false },
        { key: 'parentContact', label: 'Parent Contact', default: false, mandatory: false, displayOnBookNow: false },
        { key: 'childAge', label: 'Child Age', default: false, mandatory: false, displayOnBookNow: false },
        { key: 'cardNumber', label: 'Card Number', default: false, mandatory: false, displayOnBookNow: false },
        { key: 'clientDiscountPercentage', label: 'Client Discount Percentage', default: false, mandatory: false, displayOnBookNow: false },
        { key: 'clientPicture', label: 'Client Picture', default: false, mandatory: false, displayOnBookNow: false },
      ],
      settings: {
        clientFormMasterRules: { mobileNumberRequired: true, clientNameRequired: true, duplicateMobileBlock: true, clientSourceRequired: true },
        personalDetailRules: { birthdayFieldEnabled: true, anniversaryFieldEnabled: true, genderFieldEnabled: true, addressFieldEnabled: true },
        contactValidationRules: { mobileFormatValidation: true, emailFormatValidation: true, alternateMobileAllowed: true, whatsappOptInRequired: false },
        preferenceTagsRules: { clientTagsEnabled: true, servicePreferenceEnabled: true, staffPreferenceEnabled: true, allergyMedicalNoteRequired: true },
        privacyConsentRules: { marketingConsentRequired: true, dataPrivacyConsentRequired: true, maskPhoneForStaff: true, ownerOnlySensitiveFields: true },
        reportingLifecycleRules: { newClientSourceKpi: true, birthdayAnniversaryCampaignEnabled: true, inactiveClientAlert: true, vipClientSegmentFlag: true },
      },
    };
  }

  private defaultAppointmentSettings(): AppointmentSettings {
    return {
      startTime: '08:00',
      endTime: '20:00',
      overlapTimeSlot: false,
      previousTimeSlot: true,
      weekStartFrom: 'Sunday',
      slotMinutes: 15,
      timeFormat: '12 Hours',
      roomNumberOption: false,
      staffCalendar: true,
      defaultStatus: 'Confirmed',
      colors: this.defaultColorSettings(),
    };
  }

  private defaultColorSettings(): AppointmentColorSetting[] {
    return [
      { status: 'booked', enabled: true, color: '#84cfb1', label: 'Confirmed' },
      { status: 'arrived', enabled: true, color: '#9fd6fd', label: 'Arrived' },
      { status: 'in-service', enabled: true, color: '#ffa500', label: 'Start' },
      { status: 'completed', enabled: true, color: '#323ec7', label: 'Completed' },
      { status: 'cancelled', enabled: true, color: '#fc8e8f', label: 'Cancel' },
      { status: 'no-show', enabled: true, color: '#23e830', label: 'Not Came' },
      { status: 'not-confirmed', enabled: true, color: '#8893d3', label: 'Not Confirmed' },
      { status: 'rescheduled', enabled: true, color: '#2a2c32', label: 'Reschedule Booking' },
      { status: 'payment', enabled: true, color: '#bd60e8', label: 'Add Payment' },
      { status: 'deleted', enabled: true, color: '#ff0000', label: 'Delete' },
    ];
  }

  private cleanAppointmentSettings(value: AppointmentSettings) {
    const result: AppointmentSettings = {
      ...value,
      startTime: this.clampTime(value.startTime || '08:00'),
      endTime: this.clampTime(value.endTime || '20:00'),
      slotMinutes: this.slotOptions.includes(value.slotMinutes) ? value.slotMinutes : 15,
      timeFormat: this.timeFormatOptions.includes(value.timeFormat) ? value.timeFormat : '12 Hours',
      weekStartFrom: this.weekStartOptions.includes(value.weekStartFrom) ? value.weekStartFrom : 'Sunday',
      colors: value.colors.map((entry) => ({
        ...entry,
        status: String(entry.status || ''),
        label: String(entry.label || '').trim() || 'Status',
        color: String(entry.color || '').trim() || '#999',
        enabled: !!entry.enabled,
      })),
    };

    if (!result.colors.some((entry) => entry.enabled)) {
      if (result.colors[0]) {
        result.colors[0].enabled = true;
      }
    }

    const validStatusOptions = Array.from(new Set(result.colors.map((item) => item.label.trim()).filter(Boolean)));
    if (!validStatusOptions.length) {
      result.defaultStatus = 'Confirmed';
    } else if (!validStatusOptions.includes(result.defaultStatus)) {
      result.defaultStatus = validStatusOptions[0];
    }

    return result;
  }

  private clampTime(value: string) {
    const [hours = 0, minutes = 0] = String(value).split(':').map((part) => Number(part) || 0);
    return `${String(Math.max(0, Math.min(23, hours)).toString()).padStart(2, '0')}:${String(Math.max(0, Math.min(59, minutes))).padStart(2, '0')}`;
  }

  private validateAppointmentSettings() {
    const startParts = String(this.appointmentSettings.startTime).split(':').map((value) => Number(value) || 0);
    const endParts = String(this.appointmentSettings.endTime).split(':').map((value) => Number(value) || 0);
    const start = (startParts[0] || 0) * 60 + (startParts[1] || 0);
    const end = (endParts[0] || 0) * 60 + (endParts[1] || 0);

    if (start >= end) {
      this.saveError = 'Start time must be earlier than end time.';
      return false;
    }

    if (!this.slotOptions.includes(this.appointmentSettings.slotMinutes)) {
      this.saveError = 'Invalid slot duration selected.';
      return false;
    }

    if (!this.weekStartOptions.includes(this.appointmentSettings.weekStartFrom)) {
      this.saveError = 'Invalid week start selected.';
      return false;
    }

    if (!this.timeFormatOptions.includes(this.appointmentSettings.timeFormat)) {
      this.saveError = 'Invalid time format selected.';
      return false;
    }

    return true;
  }
}
