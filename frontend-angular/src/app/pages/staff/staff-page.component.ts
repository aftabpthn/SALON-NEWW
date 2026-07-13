import { CommonModule } from '@angular/common';
import { Component, inject, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { DatePickerComponent } from '../../shared/date-picker/date-picker.component';
import { ApiEnvelope, ApiService } from '../../shared/services/api.service';

type StaffRecord = {
  id: string;
  employeeCode: string;
  firstName: string;
  middleName: string;
  lastName: string;
  appointmentDisplayName: string;
  email: string;
  mobilePhone: string;
  homePhone: string;
  workPhone: string;
  jobTitle: string;
  active: boolean;
  branchId: string;
};

type StaffListPage = { items: StaffRecord[]; total: number; page: number; pageSize: number; jobs: string[] };
type StaffForm = Omit<StaffRecord, 'id' | 'branchId'>;
type StaffColumn = 'employeeCode' | 'firstName' | 'lastName' | 'mobilePhone' | 'jobTitle' | 'active' | 'branchId';
type StaffTab = 'General' | 'Employee Roles' | 'Services' | 'Products' | 'Memberships' | 'Packages' | 'Commissions' | 'Payrates' | 'Catalog' | 'Leave Policies';
type CatalogType = 'service' | 'product' | 'membership' | 'package';
type ProfileForm = {
  designation: string;
  companyName: string;
  mandatoryBreakMinutes: number | null;
  workTasks: string;
  maxWorkHours: number | null;
  targetRevenue: number | null;
  vacationDays: number | null;
  specialLeaveDays: number | null;
  tenureStartDate: string;
  bookingIntervalMinutes: number | null;
  restrictBookingToReturningGuests: boolean;
  linkedLogin: boolean;
};
type StaffProfileResponse = {
  staff: StaffRecord;
  designation: string;
  companyName: string;
  mandatoryBreakMinutes: number | null;
  workTasks: string[];
  maxWorkHours: number | null;
  targetRevenuePaise: number | null;
  vacationDays: number | null;
  specialLeaveDays: number | null;
  tenureStartDate: string | null;
  bookingIntervalMinutes: number | null;
  restrictBookingToReturningGuests: boolean;
  linkedLogin: boolean;
};
type RoleOption = { id: string; name: string; assigned: boolean };
type CatalogOption = { itemType: CatalogType; id: string; name: string; category: string; assigned: boolean; commissionPercent: number | null };
type CommissionRule = { id?: string; name: string; appliesTo: 'all' | CatalogType; ratePercent: number | null; effectiveFrom: string; active: boolean };
type PayRate = { id?: string; rateType: 'hourly' | 'daily' | 'monthly'; amount: number | null; effectiveFrom: string; active: boolean };
type LeavePolicy = { id?: string; name: string; leaveType: 'annual' | 'sick' | 'casual' | 'special' | 'unpaid'; annualDays: number | null; active: boolean };
type StaffConfiguration = {
  roles: RoleOption[];
  catalog: CatalogOption[];
  commissionRules: CommissionRule[];
  payRates: PayRate[];
  leavePolicies: LeavePolicy[];
};
type StaffConfigurationResponse = Omit<StaffConfiguration, 'payRates'> & {
  payRates: Array<Omit<PayRate, 'amount' | 'effectiveFrom'> & { amountPaise: number; effectiveFrom: string | null }>;
};

const emptyStaff = (): StaffForm => ({
  employeeCode: '', firstName: '', middleName: '', lastName: '', appointmentDisplayName: '', email: '',
  mobilePhone: '', homePhone: '', workPhone: '', jobTitle: '', active: true,
});
const emptyProfile = (): ProfileForm => ({
  designation: '', companyName: '', mandatoryBreakMinutes: null, workTasks: '', maxWorkHours: null, targetRevenue: null,
  vacationDays: null, specialLeaveDays: null, tenureStartDate: '', bookingIntervalMinutes: null,
  restrictBookingToReturningGuests: false, linkedLogin: false,
});
const emptyConfiguration = (): StaffConfiguration => ({ roles: [], catalog: [], commissionRules: [], payRates: [], leavePolicies: [] });

@Component({
  selector: 'page-staff',
  standalone: true,
  imports: [CommonModule, FormsModule, DatePickerComponent],
  templateUrl: './staff-page.component.html',
  styleUrls: ['./staff-page.component.css'],
})
export class StaffPageComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  readonly columns: Array<{ key: StaffColumn; label: string }> = [
    { key: 'employeeCode', label: 'Code' }, { key: 'firstName', label: 'First name' },
    { key: 'lastName', label: 'Last name' }, { key: 'mobilePhone', label: 'Phone number' },
    { key: 'jobTitle', label: 'Job' }, { key: 'active', label: 'Active' }, { key: 'branchId', label: 'Center' },
  ];
  readonly visibleColumns: Record<StaffColumn, boolean> = {
    employeeCode: true, firstName: true, lastName: true, mobilePhone: true, jobTitle: true, active: true, branchId: true,
  };
  readonly staffTabs: StaffTab[] = ['General', 'Employee Roles', 'Services', 'Products', 'Memberships', 'Packages', 'Commissions', 'Payrates', 'Catalog', 'Leave Policies'];

  employees: StaffRecord[] = [];
  jobTitles: string[] = [];
  search = '';
  jobFilter = '';
  statusFilter = '';
  sortBy: StaffColumn = 'firstName';
  sortDirection: 'asc' | 'desc' = 'asc';
  page = 1;
  pageSize = 25;
  total = 0;
  columnMenuOpen = false;
  drawerOpen = false;
  saving = false;
  profileLoading = false;
  cloneMode = false;
  loadError = '';
  saveError = '';
  profileError = '';
  actionError = '';
  editingId = '';
  selectedBranchId = '';
  form = emptyStaff();
  profileForm = emptyProfile();
  configuration = emptyConfiguration();
  activeTab: StaffTab = 'General';
  configurationLoading = false;
  configurationSaving = false;
  configurationError = '';
  passwordModalOpen = false;
  passwordAction: 'update' | 'reset' = 'update';
  newPassword = '';
  actionSaving = false;
  detailPage = false;

  ngOnInit() {
    this.route.paramMap.subscribe((params) => {
      const staffId = params.get('id');
      this.detailPage = Boolean(staffId);
      if (staffId) void this.openEditById(staffId);
      else void this.loadEmployees();
    });
  }

  get pageStart() { return this.total ? (this.page - 1) * this.pageSize + 1 : 0; }
  get pageEnd() { return Math.min(this.page * this.pageSize, this.total); }

  trackById(_: number, employee: StaffRecord) { return employee.id; }
  isColumnVisible(column: StaffColumn) { return this.visibleColumns[column]; }

  toggleColumn(column: StaffColumn) {
    if (this.visibleColumns[column] || Object.values(this.visibleColumns).filter(Boolean).length > 1) {
      this.visibleColumns[column] = !this.visibleColumns[column];
    }
  }

  async applyFilters() { this.page = 1; await this.loadEmployees(); }

  async clearFilters() {
    this.search = '';
    this.jobFilter = '';
    this.statusFilter = '';
    this.page = 1;
    await this.loadEmployees();
  }

  async toggleSort(column: StaffColumn) {
    if (this.sortBy === column) this.sortDirection = this.sortDirection === 'asc' ? 'desc' : 'asc';
    else { this.sortBy = column; this.sortDirection = 'asc'; }
    await this.loadEmployees();
  }

  sortIndicator(column: StaffColumn) { return this.sortBy === column ? (this.sortDirection === 'asc' ? '↑' : '↓') : ''; }

  async changePage(page: number) {
    if (page < 1 || page > Math.ceil(this.total / this.pageSize) || page === this.page) return;
    this.page = page;
    await this.loadEmployees();
  }

  exportVisible() {
    const csv = [['Code', 'First name', 'Last name', 'Phone number', 'Job', 'Active', 'Center'], ...this.employees.map((employee) => [
      employee.employeeCode, employee.firstName, employee.lastName, employee.mobilePhone, employee.jobTitle,
      employee.active ? 'Yes' : 'No', employee.branchId,
    ])].map((row) => row.map((value) => `"${String(value || '').replace(/"/g, '""')}"`).join(',')).join('\r\n');
    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    link.download = 'staff-export.csv';
    link.click();
    URL.revokeObjectURL(link.href);
  }

  openCreate() {
    this.editingId = '';
    this.selectedBranchId = '';
    this.cloneMode = false;
    this.form = emptyStaff();
    this.profileForm = emptyProfile();
    this.configuration = emptyConfiguration();
    this.activeTab = 'General';
    this.configurationError = '';
    this.saveError = '';
    this.profileError = '';
    this.actionError = '';
    this.drawerOpen = true;
  }

  openEmployee(employee: StaffRecord) {
    void this.router.navigate(['/staff', employee.id]);
  }

  private async openEditById(staffId: string) {
    this.editingId = staffId;
    this.cloneMode = false;
    this.form = emptyStaff();
    this.profileForm = emptyProfile();
    this.configuration = emptyConfiguration();
    this.activeTab = 'General';
    this.configurationError = '';
    this.saveError = '';
    this.profileError = '';
    this.actionError = '';
    this.drawerOpen = true;
    this.profileLoading = true;
    this.configurationLoading = true;
    try {
      const [result, configurationResult] = await Promise.all([
        firstValueFrom(this.api.get<ApiEnvelope<StaffProfileResponse>>(`/staff/${staffId}/profile`)),
        firstValueFrom(this.api.get<ApiEnvelope<StaffConfigurationResponse>>(`/staff/${staffId}/configuration`)),
      ]);
      if (!result.success || !result.data) throw new Error(result.error?.message || 'Unable to load employee profile');
      if (!configurationResult.success || !configurationResult.data) throw new Error(configurationResult.error?.message || 'Unable to load employee configuration');
      this.applyStaff(result.data.staff);
      this.profileForm = {
        designation: result.data.designation || '', companyName: result.data.companyName || '',
        mandatoryBreakMinutes: result.data.mandatoryBreakMinutes, workTasks: result.data.workTasks.join(', '),
        maxWorkHours: result.data.maxWorkHours, targetRevenue: result.data.targetRevenuePaise === null ? null : result.data.targetRevenuePaise / 100,
        vacationDays: result.data.vacationDays, specialLeaveDays: result.data.specialLeaveDays,
        tenureStartDate: result.data.tenureStartDate || '', bookingIntervalMinutes: result.data.bookingIntervalMinutes,
        restrictBookingToReturningGuests: result.data.restrictBookingToReturningGuests, linkedLogin: result.data.linkedLogin,
      };
      this.applyConfiguration(configurationResult.data);
    } catch (error) {
      this.profileError = error instanceof Error ? error.message : 'Unable to load employee profile';
    } finally {
      this.profileLoading = false;
      this.configurationLoading = false;
    }
  }

  cloneEmployee() {
    this.cloneMode = true;
    this.editingId = '';
    this.form = { ...this.form, employeeCode: '', email: '', appointmentDisplayName: '', active: true };
    this.profileForm = { ...this.profileForm, linkedLogin: false };
    this.activeTab = 'General';
    this.saveError = '';
    this.actionError = '';
  }

  closeDrawer() {
    if (this.saving || this.actionSaving) return;
    if (this.detailPage) void this.router.navigate(['/staff']);
    else this.drawerOpen = false;
  }

  async save() {
    const firstName = this.form.firstName.trim();
    this.saveError = '';
    if (!firstName) { this.saveError = 'First name is required'; return; }
    if (this.cloneMode && !this.form.employeeCode.trim()) { this.saveError = 'Employee code is required when cloning'; return; }

    this.saving = true;
    try {
      const payload = this.staffPayload(firstName);
      const result = this.editingId
        ? await firstValueFrom(this.api.patch<ApiEnvelope<StaffRecord>>(`/staff/${this.editingId}`, payload))
        : await firstValueFrom(this.api.post<ApiEnvelope<StaffRecord>>('/staff', payload));
      if (!result.success || !result.data) throw new Error(result.error?.message || 'Unable to save employee');
      await this.saveProfile(result.data.id);
      if (this.cloneMode) await this.saveConfigurationFor(result.data.id);
      if (this.detailPage) {
        if (this.cloneMode) await this.router.navigate(['/staff', result.data.id]);
        else await this.openEditById(result.data.id);
      } else {
        await this.loadEmployees();
        this.drawerOpen = false;
      }
    } catch (error) {
      this.saveError = error instanceof Error ? error.message : 'Unable to save employee';
    } finally {
      this.saving = false;
    }
  }

  openPassword(action: 'update' | 'reset') {
    this.actionError = '';
    this.newPassword = '';
    this.passwordAction = action;
    this.passwordModalOpen = true;
  }

  async savePassword() {
    this.actionError = '';
    if (this.newPassword.length < 12) { this.actionError = 'Password must be at least 12 characters'; return; }
    this.actionSaving = true;
    try {
      const result = await firstValueFrom(this.api.post<ApiEnvelope<unknown>>(`/staff/${this.editingId}/password`, { newPassword: this.newPassword }));
      if (!result.success) throw new Error(result.error?.message || 'Unable to update password');
      this.passwordModalOpen = false;
      this.newPassword = '';
    } catch (error) {
      this.actionError = error instanceof Error ? error.message : 'Unable to update password';
    } finally {
      this.actionSaving = false;
    }
  }

  async terminateEmployee() {
    if (!window.confirm('Terminate this employee? Their staff record and linked login will be deactivated.')) return;
    this.actionError = '';
    this.actionSaving = true;
    try {
      const result = await firstValueFrom(this.api.post<ApiEnvelope<unknown>>(`/staff/${this.editingId}/terminate`, {}));
      if (!result.success) throw new Error(result.error?.message || 'Unable to terminate employee');
      if (this.detailPage) await this.router.navigate(['/staff']);
      else {
        await this.loadEmployees();
        this.drawerOpen = false;
      }
    } catch (error) {
      this.actionError = error instanceof Error ? error.message : 'Unable to terminate employee';
    } finally {
      this.actionSaving = false;
    }
  }

  titleCase(value: string) { return value.replace(/\S+/g, (word) => word[0].toUpperCase() + word.slice(1).toLowerCase()); }

  setTab(tab: StaffTab) {
    if (this.editingId) this.activeTab = tab;
  }

  catalogFor(type: CatalogType) { return this.configuration.catalog.filter((item) => item.itemType === type); }
  get assignedCatalog() { return this.configuration.catalog.filter((item) => item.assigned); }

  addCommissionRule() {
    this.configuration.commissionRules.push({ name: '', appliesTo: 'all', ratePercent: null, effectiveFrom: '', active: true });
  }
  addPayRate() {
    this.configuration.payRates.push({ rateType: 'hourly', amount: null, effectiveFrom: '', active: true });
  }
  addLeavePolicy() {
    this.configuration.leavePolicies.push({ name: '', leaveType: 'annual', annualDays: null, active: true });
  }
  removeCommissionRule(index: number) { this.configuration.commissionRules.splice(index, 1); }
  removePayRate(index: number) { this.configuration.payRates.splice(index, 1); }
  removeLeavePolicy(index: number) { this.configuration.leavePolicies.splice(index, 1); }

  async saveConfiguration() {
    if (!this.editingId) return;
    this.configurationError = '';
    this.configurationSaving = true;
    try {
      await this.saveConfigurationFor(this.editingId);
    } catch (error) {
      this.configurationError = error instanceof Error ? error.message : 'Unable to save employee configuration';
    } finally {
      this.configurationSaving = false;
    }
  }

  private applyStaff(staff: StaffRecord) {
    this.selectedBranchId = staff.branchId;
    this.form = {
      employeeCode: staff.employeeCode || '', firstName: staff.firstName || '', middleName: staff.middleName || '',
      lastName: staff.lastName || '', appointmentDisplayName: staff.appointmentDisplayName || '', email: staff.email || '',
      mobilePhone: staff.mobilePhone || '', homePhone: staff.homePhone || '', workPhone: staff.workPhone || '',
      jobTitle: staff.jobTitle || '', active: staff.active !== false,
    };
  }

  private staffPayload(firstName: string) {
    return {
      ...this.form, employeeCode: this.form.employeeCode.trim() || undefined, firstName,
      middleName: this.form.middleName.trim(), lastName: this.form.lastName.trim(),
      appointmentDisplayName: this.form.appointmentDisplayName.trim() || firstName, email: this.form.email.trim(),
      mobilePhone: this.form.mobilePhone.trim(), homePhone: this.form.homePhone.trim(), workPhone: this.form.workPhone.trim(),
      jobTitle: this.form.jobTitle.trim(),
    };
  }

  private async saveProfile(staffId: string) {
    const workTasks = this.profileForm.workTasks.split(',').map((task) => task.trim()).filter(Boolean);
    const result = await firstValueFrom(this.api.patch<ApiEnvelope<StaffProfileResponse>>(`/staff/${staffId}/profile`, {
      designation: this.profileForm.designation.trim(), companyName: this.profileForm.companyName.trim(),
      mandatoryBreakMinutes: this.profileForm.mandatoryBreakMinutes, workTasks, maxWorkHours: this.profileForm.maxWorkHours,
      targetRevenuePaise: this.profileForm.targetRevenue === null ? null : Math.round(this.profileForm.targetRevenue * 100),
      vacationDays: this.profileForm.vacationDays, specialLeaveDays: this.profileForm.specialLeaveDays,
      tenureStartDate: this.profileForm.tenureStartDate || null, bookingIntervalMinutes: this.profileForm.bookingIntervalMinutes,
      restrictBookingToReturningGuests: this.profileForm.restrictBookingToReturningGuests,
    }));
    if (!result.success) throw new Error(result.error?.message || 'Unable to save employee profile');
  }

  private applyConfiguration(data: StaffConfigurationResponse) {
    this.configuration = {
      roles: data.roles,
      catalog: data.catalog,
      commissionRules: data.commissionRules.map((rule) => ({ ...rule, effectiveFrom: rule.effectiveFrom || '' })),
      payRates: data.payRates.map((rate) => ({
        id: rate.id, rateType: rate.rateType, amount: rate.amountPaise / 100,
        effectiveFrom: rate.effectiveFrom || '', active: rate.active,
      })),
      leavePolicies: data.leavePolicies,
    };
  }

  private async saveConfigurationFor(staffId: string) {
    if (this.configuration.commissionRules.some((rule) => !rule.name.trim() || rule.ratePercent === null)) throw new Error('Complete every commission rule');
    if (this.configuration.payRates.some((rate) => rate.amount === null)) throw new Error('Complete every pay rate');
    if (this.configuration.leavePolicies.some((policy) => !policy.name.trim() || policy.annualDays === null)) throw new Error('Complete every leave policy');
    const result = await firstValueFrom(this.api.put<ApiEnvelope<StaffConfigurationResponse>>(`/staff/${staffId}/configuration`, {
      roleIds: this.configuration.roles.filter((role) => role.assigned).map((role) => role.id),
      catalogAssignments: this.configuration.catalog.filter((item) => item.assigned).map((item) => ({
        itemType: item.itemType, itemId: item.id, commissionPercent: item.commissionPercent,
      })),
      commissionRules: this.configuration.commissionRules.map((rule) => ({
        name: rule.name.trim(), appliesTo: rule.appliesTo, ratePercent: rule.ratePercent,
        effectiveFrom: rule.effectiveFrom || null, active: rule.active,
      })),
      payRates: this.configuration.payRates.map((rate) => ({
        rateType: rate.rateType, amountPaise: Math.round((rate.amount || 0) * 100),
        effectiveFrom: rate.effectiveFrom || null, active: rate.active,
      })),
      leavePolicies: this.configuration.leavePolicies.map((policy) => ({
        name: policy.name.trim(), leaveType: policy.leaveType, annualDays: policy.annualDays, active: policy.active,
      })),
    }));
    if (!result.success || !result.data) throw new Error(result.error?.message || 'Unable to save employee configuration');
    this.applyConfiguration(result.data);
  }

  private async loadEmployees() {
    this.loadError = '';
    const params = new URLSearchParams({ page: String(this.page), pageSize: String(this.pageSize), sortBy: this.sortBy, sortDirection: this.sortDirection });
    if (this.search.trim()) params.set('q', this.search.trim());
    if (this.jobFilter) params.set('job', this.jobFilter);
    if (this.statusFilter) params.set('active', this.statusFilter);
    try {
      const result = await firstValueFrom(this.api.get<ApiEnvelope<StaffListPage>>(`/staff/list?${params.toString()}`));
      if (!result.success || !result.data) throw new Error(result.error?.message || 'Unable to load staff');
      this.employees = result.data.items.map((employee) => ({
        ...employee, employeeCode: employee.employeeCode || '', middleName: employee.middleName || '',
        appointmentDisplayName: employee.appointmentDisplayName || employee.firstName || '', email: employee.email || '',
        mobilePhone: employee.mobilePhone || '', homePhone: employee.homePhone || '', workPhone: employee.workPhone || '',
        jobTitle: employee.jobTitle || '', branchId: employee.branchId || '',
      }));
      this.total = result.data.total;
      this.page = result.data.page;
      this.pageSize = result.data.pageSize;
      this.jobTitles = result.data.jobs;
    } catch (error) {
      this.employees = [];
      this.total = 0;
      this.loadError = error instanceof Error ? error.message : 'Unable to load staff';
    }
  }
}
