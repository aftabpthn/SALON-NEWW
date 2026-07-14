import { CommonModule } from '@angular/common';
import { Component, inject, OnDestroy, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { DatePickerComponent } from '../../shared/date-picker/date-picker.component';
import { AuthService } from '../../core/services/auth.service';
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
type StaffTab = 'General' | 'HR Profile' | 'Documents' | 'History' | 'Employee Roles' | 'Branch Access' | 'Services' | 'Products' | 'Memberships' | 'Packages' | 'Commissions' | 'Payrates' | 'Catalog' | 'Leave Policies';
type MasterTab = 'Categories' | 'Leave Policies' | 'Attendance Rules' | 'Shift Templates';
type CatalogType = 'service' | 'product' | 'membership' | 'package';
type ProfileForm = {
  categoryId: string;
  shiftTemplateId: string;
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
  photoUrl: string;
  dateOfBirth: string;
  joiningDate: string;
  gender: '' | 'female' | 'male' | 'non_binary' | 'prefer_not_to_say';
  employmentType: '' | 'full_time' | 'part_time' | 'contract' | 'intern';
  department: string;
  reportingManagerId: string;
  addressLine1: string;
  addressLine2: string;
  city: string;
  stateName: string;
  postalCode: string;
  country: string;
  emergencyContactName: string;
  emergencyContactRelationship: string;
  emergencyContactPhone: string;
};
type StaffProfileResponse = {
  staff: StaffRecord;
  categoryId: string | null;
  shiftTemplateId: string | null;
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
  photoUrl: string;
  dateOfBirth: string | null;
  joiningDate: string | null;
  gender: ProfileForm['gender'];
  employmentType: ProfileForm['employmentType'];
  department: string;
  reportingManagerId: string | null;
  addressLine1: string;
  addressLine2: string;
  city: string;
  stateName: string;
  postalCode: string;
  country: string;
  emergencyContactName: string;
  emergencyContactRelationship: string;
  emergencyContactPhone: string;
};
type StaffDocument = {
  id: string; staffId: string; documentType: string; documentName: string; documentUrl: string;
  verificationStatus: 'pending' | 'verified' | 'rejected'; expiryDate: string | null; notes: string;
  createdBy: string; createdAt: string; updatedAt: string | null;
};
type StaffDocumentForm = {
  id: string; documentType: string; documentName: string; documentUrl: string;
  verificationStatus: StaffDocument['verificationStatus']; expiryDate: string; notes: string;
};
type StaffHistory = {
  id: string; userId: string | null; eventType: string; outcome: string;
  detailsJson: Record<string, unknown>; createdAt: string;
};
type BulkStaffRow = {
  employeeCode: string; firstName: string; lastName?: string; email?: string; mobilePhone?: string;
  jobTitle?: string; active?: boolean; photoUrl?: string; dateOfBirth?: string; joiningDate?: string;
  gender?: string; employmentType?: string; department?: string; reportingManagerId?: string;
  categoryId?: string; shiftTemplateId?: string;
};
type BulkImportResult = {
  id: string; batchKey: string; totalRows: number; createdRows: number; updatedRows: number;
  status: string; staffIds: string[]; createdAt: string;
};
type StaffFileUpload = { fileId: string; fileUrl: string; fileName: string; contentType: string; byteSize: number };
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
type BranchAccessRole = { id: string; name: string };
type StaffBranchAccessRow = {
  branchId: string; branchName: string; regionName: string; zoneName: string; clusterName: string;
  roleId: string | null; roleName: string; accessType: 'permanent' | 'deputation';
  validFrom: string | null; validUntil: string | null;
  isDefault: boolean; active: boolean; effective: boolean;
};
type StaffBranchAccess = {
  linkedLogin: boolean; loginId: string | null; email: string | null; mustChangePassword: boolean;
  branches: StaffBranchAccessRow[]; roles: BranchAccessRole[];
};
type LoginProvisionForm = { loginId: string; email: string; initialPassword: string; roleId: string };
type StaffCategory = { id: string; code: string; name: string; designation: string; active: boolean };
type ShiftTemplate = {
  id: string; code: string; name: string; shift1Start: string; shift1End: string;
  shift2Start: string | null; shift2End: string | null; breakMinutes: number | null;
  weeklyOffDays: number[]; active: boolean;
};
type AttendanceRule = {
  graceMinutes: number | null; halfDayAfterMinutes: number | null; absentAfterMinutes: number | null;
  overtimeAfterMinutes: number | null; earlyLeaveGraceMinutes: number | null; deductBreaks: boolean;
  minimumOvertimeMinutes: number | null; overtimeRoundingMinutes: number | null;
  maximumOvertimeMinutes: number | null; active: boolean; version?: number;
};
type LeavePolicyOverview = LeavePolicy & { id: string; staffId: string; staffName: string; employeeCode: string | null };
type StaffMasters = {
  categories: StaffCategory[];
  shiftTemplates: ShiftTemplate[];
  attendanceRule: AttendanceRule | null;
  leavePolicies: LeavePolicyOverview[];
};

const emptyStaff = (): StaffForm => ({
  employeeCode: '', firstName: '', middleName: '', lastName: '', appointmentDisplayName: '', email: '',
  mobilePhone: '', homePhone: '', workPhone: '', jobTitle: '', active: true,
});
const emptyProfile = (): ProfileForm => ({
  categoryId: '', shiftTemplateId: '', designation: '', companyName: '', mandatoryBreakMinutes: null, workTasks: '', maxWorkHours: null, targetRevenue: null,
  vacationDays: null, specialLeaveDays: null, tenureStartDate: '', bookingIntervalMinutes: null,
  restrictBookingToReturningGuests: false, linkedLogin: false,
  photoUrl: '', dateOfBirth: '', joiningDate: '', gender: '', employmentType: '', department: '',
  reportingManagerId: '', addressLine1: '', addressLine2: '', city: '', stateName: '', postalCode: '',
  country: '', emergencyContactName: '', emergencyContactRelationship: '', emergencyContactPhone: '',
});
const emptyDocument = (): StaffDocumentForm => ({
  id: '', documentType: '', documentName: '', documentUrl: '', verificationStatus: 'pending',
  expiryDate: '', notes: '',
});
const emptyConfiguration = (): StaffConfiguration => ({ roles: [], catalog: [], commissionRules: [], payRates: [], leavePolicies: [] });
const emptyBranchAccess = (): StaffBranchAccess => ({
  linkedLogin: false, loginId: null, email: null, mustChangePassword: false, branches: [], roles: [],
});
const emptyLoginProvision = (): LoginProvisionForm => ({ loginId: '', email: '', initialPassword: '', roleId: '' });
const emptyAttendanceRule = (): AttendanceRule => ({
  graceMinutes: null, halfDayAfterMinutes: null, absentAfterMinutes: null, overtimeAfterMinutes: null,
  earlyLeaveGraceMinutes: null, deductBreaks: true, minimumOvertimeMinutes: null,
  overtimeRoundingMinutes: null, maximumOvertimeMinutes: null, active: true,
});
const emptyMasters = (): StaffMasters => ({ categories: [], shiftTemplates: [], attendanceRule: null, leavePolicies: [] });

@Component({
  selector: 'page-staff',
  standalone: true,
  imports: [CommonModule, FormsModule, DatePickerComponent],
  templateUrl: './staff-page.component.html',
  styleUrls: ['./staff-page.component.css'],
})
export class StaffPageComponent implements OnInit, OnDestroy {
  private readonly api = inject(ApiService);
  private readonly auth = inject(AuthService);
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
  readonly staffTabs: StaffTab[] = [
    'General', 'HR Profile', 'Documents', 'History', 'Employee Roles',
    ...(this.auth.hasRole('owner', 'admin') ? ['Branch Access' as StaffTab] : []),
    'Services', 'Products', 'Memberships', 'Packages', 'Commissions', 'Payrates', 'Catalog', 'Leave Policies',
  ];
  readonly masterTabs: MasterTab[] = ['Categories', 'Leave Policies', 'Attendance Rules', 'Shift Templates'];
  readonly weekdays = [
    { value: 0, label: 'Sun' }, { value: 1, label: 'Mon' }, { value: 2, label: 'Tue' },
    { value: 3, label: 'Wed' }, { value: 4, label: 'Thu' }, { value: 5, label: 'Fri' },
    { value: 6, label: 'Sat' },
  ];

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
  branchAccess = emptyBranchAccess();
  branchAccessSearch = '';
  branchAccessRegion = '';
  branchAccessZone = '';
  branchAccessCluster = '';
  bulkBranchRoleId = '';
  bulkBranchAccessType: 'permanent' | 'deputation' = 'permanent';
  bulkBranchValidFrom = '';
  bulkBranchValidUntil = '';
  branchAccessLoaded = false;
  branchAccessLoading = false;
  branchAccessSaving = false;
  branchAccessError = '';
  loginProvision = emptyLoginProvision();
  passwordModalOpen = false;
  passwordAction: 'update' | 'reset' = 'update';
  newPassword = '';
  actionSaving = false;
  detailPage = false;
  mastersDrawerOpen = false;
  masterTab: MasterTab = 'Categories';
  masters = emptyMasters();
  mastersLoading = false;
  mastersSaving = false;
  mastersError = '';
  mastersSuccess = '';
  managerOptions: StaffRecord[] = [];
  documents: StaffDocument[] = [];
  documentForm = emptyDocument();
  documentsLoading = false;
  documentSaving = false;
  documentError = '';
  history: StaffHistory[] = [];
  historyLoading = false;
  historyError = '';
  bulkDrawerOpen = false;
  bulkFileName = '';
  bulkRows: BulkStaffRow[] = [];
  bulkBatchId = '';
  bulkSaving = false;
  bulkError = '';
  bulkResult: BulkImportResult | null = null;
  photoPreviewUrl = '';
  fileUploading = false;
  private photoObjectUrl = '';

  get activeCategories() { return this.masters.categories.filter((item) => item.active); }
  get activeShiftTemplates() { return this.masters.shiftTemplates.filter((item) => item.active); }
  get filteredBranchAccess() {
    const search = this.branchAccessSearch.trim().toLowerCase();
    return this.branchAccess.branches.filter((branch) =>
      (!search || `${branch.branchName} ${branch.branchId} ${branch.roleName} ${branch.regionName} ${branch.zoneName} ${branch.clusterName}`.toLowerCase().includes(search))
      && (!this.branchAccessRegion || branch.regionName === this.branchAccessRegion)
      && (!this.branchAccessZone || branch.zoneName === this.branchAccessZone)
      && (!this.branchAccessCluster || branch.clusterName === this.branchAccessCluster));
  }
  get branchAccessRegions() { return this.uniqueBranchValues('regionName'); }
  get branchAccessZones() {
    return this.uniqueBranchValues('zoneName', (branch) => !this.branchAccessRegion || branch.regionName === this.branchAccessRegion);
  }
  get branchAccessClusters() {
    return this.uniqueBranchValues('clusterName', (branch) =>
      (!this.branchAccessRegion || branch.regionName === this.branchAccessRegion)
      && (!this.branchAccessZone || branch.zoneName === this.branchAccessZone));
  }
  get loginDefaultBranch() {
    return this.branchAccess.branches.find((branch) => branch.branchId === this.selectedBranchId);
  }

  ngOnInit() {
    this.route.paramMap.subscribe((params) => {
      const staffId = params.get('id');
      this.detailPage = Boolean(staffId);
      if (staffId) void this.openEditById(staffId);
      else void this.loadEmployees();
    });
  }

  ngOnDestroy() { this.clearPhotoObjectUrl(); }

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
    this.setPhotoPreview('');
    this.configuration = emptyConfiguration();
    this.resetBranchAccess();
    this.activeTab = 'General';
    this.configurationError = '';
    this.documents = [];
    this.history = [];
    this.documentForm = emptyDocument();
    this.saveError = '';
    this.profileError = '';
    this.actionError = '';
    this.drawerOpen = true;
    void this.loadMasters(false);
  }

  openEmployee(employee: StaffRecord) {
    void this.router.navigate(['/staff', employee.id]);
  }

  openPayroll() {
    void this.router.navigate(['/staff/payroll']);
  }

  openControlCenter() {
    void this.router.navigate(['/staff/control-center']);
  }

  openLeaveManagement() {
    void this.router.navigate(['/staff/leave-management']);
  }

  async openMasters() {
    this.masterTab = 'Categories';
    this.mastersDrawerOpen = true;
    this.mastersSuccess = '';
    await this.loadMasters(true);
  }

  closeMasters() {
    if (!this.mastersSaving) this.mastersDrawerOpen = false;
  }

  addCategory() {
    this.masters.categories.push({ id: '', code: '', name: '', designation: '', active: true });
  }

  addShiftTemplate() {
    this.masters.shiftTemplates.push({
      id: '', code: '', name: '', shift1Start: '', shift1End: '', shift2Start: null,
      shift2End: null, breakMinutes: null, weeklyOffDays: [], active: true,
    });
  }

  toggleWeeklyOff(shift: ShiftTemplate, day: number, checked: boolean) {
    const days = new Set(shift.weeklyOffDays);
    checked ? days.add(day) : days.delete(day);
    shift.weeklyOffDays = [...days].sort((left, right) => left - right);
  }

  async saveMasters() {
    const rule = this.masters.attendanceRule || emptyAttendanceRule();
    if (this.masters.categories.some((item) => !item.code.trim() || !item.name.trim())) {
      this.mastersError = 'Complete every staff category';
      return;
    }
    if (this.masters.shiftTemplates.some((item) => !item.code.trim() || !item.name.trim() || !item.shift1Start || !item.shift1End)) {
      this.mastersError = 'Complete every shift template';
      return;
    }
    this.mastersSaving = true;
    this.mastersError = '';
    this.mastersSuccess = '';
    try {
      const result = await firstValueFrom(this.api.put<ApiEnvelope<StaffMasters>>('/staff/masters', {
        categories: this.masters.categories.map((item) => ({ ...item, code: item.code.trim().toLowerCase(), name: item.name.trim(), designation: item.designation.trim() })),
        shiftTemplates: this.masters.shiftTemplates.map((item) => ({
          ...item, code: item.code.trim().toLowerCase(), name: item.name.trim(),
          shift2Start: item.shift2Start || null, shift2End: item.shift2End || null,
          breakMinutes: item.breakMinutes ?? 0,
        })),
        attendanceRule: {
          graceMinutes: rule.graceMinutes ?? 0,
          halfDayAfterMinutes: rule.halfDayAfterMinutes ?? 0,
          absentAfterMinutes: rule.absentAfterMinutes ?? 0,
          overtimeAfterMinutes: rule.overtimeAfterMinutes ?? 0,
          earlyLeaveGraceMinutes: rule.earlyLeaveGraceMinutes ?? 0,
          deductBreaks: rule.deductBreaks,
          minimumOvertimeMinutes: rule.minimumOvertimeMinutes ?? 0,
          overtimeRoundingMinutes: rule.overtimeRoundingMinutes ?? 0,
          maximumOvertimeMinutes: rule.maximumOvertimeMinutes ?? 0,
          active: rule.active,
        },
      }));
      if (!result.success || !result.data) throw new Error(result.error?.message || 'Unable to save staff masters');
      this.applyMasters(result.data);
      this.mastersSuccess = 'Staff masters saved';
    } catch (error) {
      this.mastersError = error instanceof Error ? error.message : 'Unable to save staff masters';
    } finally {
      this.mastersSaving = false;
    }
  }

  editLeavePolicy(staffId: string) {
    this.mastersDrawerOpen = false;
    void this.router.navigate(['/staff', staffId]);
  }

  private async openEditById(staffId: string) {
    this.editingId = staffId;
    this.cloneMode = false;
    this.form = emptyStaff();
    this.profileForm = emptyProfile();
    this.configuration = emptyConfiguration();
    this.resetBranchAccess();
    this.activeTab = 'General';
    this.configurationError = '';
    this.saveError = '';
    this.profileError = '';
    this.actionError = '';
    this.drawerOpen = true;
    void this.loadMasters(false);
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
        categoryId: result.data.categoryId || '', shiftTemplateId: result.data.shiftTemplateId || '',
        designation: result.data.designation || '', companyName: result.data.companyName || '',
        mandatoryBreakMinutes: result.data.mandatoryBreakMinutes, workTasks: result.data.workTasks.join(', '),
        maxWorkHours: result.data.maxWorkHours, targetRevenue: result.data.targetRevenuePaise === null ? null : result.data.targetRevenuePaise / 100,
        vacationDays: result.data.vacationDays, specialLeaveDays: result.data.specialLeaveDays,
        tenureStartDate: result.data.tenureStartDate || '', bookingIntervalMinutes: result.data.bookingIntervalMinutes,
        restrictBookingToReturningGuests: result.data.restrictBookingToReturningGuests, linkedLogin: result.data.linkedLogin,
        photoUrl: result.data.photoUrl || '', dateOfBirth: result.data.dateOfBirth || '',
        joiningDate: result.data.joiningDate || '', gender: result.data.gender || '',
        employmentType: result.data.employmentType || '', department: result.data.department || '',
        reportingManagerId: result.data.reportingManagerId || '', addressLine1: result.data.addressLine1 || '',
        addressLine2: result.data.addressLine2 || '', city: result.data.city || '', stateName: result.data.stateName || '',
        postalCode: result.data.postalCode || '', country: result.data.country || '',
        emergencyContactName: result.data.emergencyContactName || '',
        emergencyContactRelationship: result.data.emergencyContactRelationship || '',
        emergencyContactPhone: result.data.emergencyContactPhone || '',
      };
      this.applyConfiguration(configurationResult.data);
      await Promise.all([
        this.loadManagerOptions(), this.loadDocuments(), this.loadHistory(),
        this.loadPhotoPreview(result.data.photoUrl || ''),
      ]);
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
    this.profileForm = { ...this.profileForm, linkedLogin: false, photoUrl: '' };
    this.setPhotoPreview('');
    this.activeTab = 'General';
    this.saveError = '';
    this.actionError = '';
  }

  closeDrawer() {
    if (this.saving || this.actionSaving) return;
    if (this.detailPage) void this.router.navigate(['/staff']);
    else { this.drawerOpen = false; this.setPhotoPreview(''); }
  }

  async save() {
    const firstName = this.form.firstName.trim();
    const savedTab = this.activeTab;
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
        else {
          await this.openEditById(result.data.id);
          this.activeTab = savedTab;
        }
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
    if (!this.editingId) return;
    this.activeTab = tab;
    if (tab === 'Branch Access' && !this.branchAccessLoaded && !this.branchAccessLoading) {
      void this.loadBranchAccess();
    }
  }

  isProfileTab() { return this.activeTab === 'General' || this.activeTab === 'HR Profile'; }
  isConfigurationTab() { return !['General', 'HR Profile', 'Documents', 'History', 'Branch Access'].includes(this.activeTab); }
  async saveCurrentTab() {
    if (this.isProfileTab()) await this.save();
    else if (this.activeTab === 'Branch Access') {
      if (this.branchAccess.linkedLogin) await this.saveBranchAccess();
      else await this.provisionLogin();
    }
    else if (this.isConfigurationTab()) await this.saveConfiguration();
  }

  toggleBranchAccess(branch: StaffBranchAccessRow) {
    if (!branch.active) branch.isDefault = false;
    else if (branch.accessType === 'permanent' && !this.branchAccess.branches.some((item) => item.active && item.isDefault)) {
      branch.isDefault = true;
    }
  }

  setBranchAccessType(branch: StaffBranchAccessRow) {
    if (branch.accessType === 'permanent') {
      branch.validFrom = null;
      branch.validUntil = null;
    } else {
      branch.isDefault = false;
    }
  }

  setDefaultBranchAccess(branch: StaffBranchAccessRow) {
    branch.active = true;
    branch.accessType = 'permanent';
    branch.validFrom = null;
    branch.validUntil = null;
    this.branchAccess.branches.forEach((item) => { item.isDefault = item === branch; });
  }

  setBranchHierarchyFilter(level: 'region' | 'zone') {
    if (level === 'region') this.branchAccessZone = '';
    this.branchAccessCluster = '';
  }

  applyFilteredBranchAccess() {
    if (!this.bulkBranchRoleId) {
      this.branchAccessError = 'Select a bulk role';
      return;
    }
    if (this.bulkBranchAccessType === 'deputation'
      && !this.validAccessWindow(this.bulkBranchValidFrom, this.bulkBranchValidUntil)) {
      this.branchAccessError = 'Select a valid deputation date range';
      return;
    }
    const branches = this.filteredBranchAccess;
    branches.forEach((branch) => {
      branch.active = true;
      branch.roleId = this.bulkBranchRoleId;
      branch.accessType = this.bulkBranchAccessType;
      branch.validFrom = this.bulkBranchAccessType === 'deputation' ? this.bulkBranchValidFrom : null;
      branch.validUntil = this.bulkBranchAccessType === 'deputation' ? this.bulkBranchValidUntil : null;
      if (branch.accessType === 'deputation') branch.isDefault = false;
    });
    if (!this.branchAccess.branches.some((branch) => branch.active && branch.isDefault)) {
      const permanent = branches.find((branch) => branch.accessType === 'permanent');
      if (permanent) permanent.isDefault = true;
    }
    this.branchAccessError = '';
  }

  clearFilteredBranchAccess() {
    this.filteredBranchAccess.forEach((branch) => {
      branch.active = false;
      branch.roleId = null;
      branch.roleName = '';
      branch.accessType = 'permanent';
      branch.validFrom = null;
      branch.validUntil = null;
      branch.isDefault = false;
    });
  }

  async loadBranchAccess() {
    if (!this.editingId) return;
    this.branchAccessLoading = true;
    this.branchAccessError = '';
    try {
      const result = await firstValueFrom(this.api.get<ApiEnvelope<StaffBranchAccess>>(`/staff/${this.editingId}/branch-access`));
      if (!result.success || !result.data) throw new Error(result.error?.message || 'Unable to load branch access');
      this.branchAccess = result.data;
      if (!result.data.linkedLogin) {
        this.loginProvision.email = this.form.email.trim().toLowerCase();
      }
      this.branchAccessLoaded = true;
    } catch (error) {
      this.branchAccessError = error instanceof Error ? error.message : 'Unable to load branch access';
    } finally {
      this.branchAccessLoading = false;
    }
  }

  async saveBranchAccess() {
    if (!this.editingId || !this.branchAccess.linkedLogin) return;
    const active = this.branchAccess.branches.filter((branch) => branch.active);
    if (active.some((branch) => !branch.roleId)) {
      this.branchAccessError = 'Select a role for every active branch';
      return;
    }
    if (active.some((branch) => branch.accessType === 'deputation'
      && !this.validAccessWindow(branch.validFrom, branch.validUntil))) {
      this.branchAccessError = 'Every deputation requires a valid date range';
      return;
    }
    if (active.some((branch) => branch.isDefault && branch.accessType !== 'permanent')) {
      this.branchAccessError = 'Default branch access must be permanent';
      return;
    }
    if (active.length > 0 && active.filter((branch) => branch.isDefault).length !== 1) {
      this.branchAccessError = 'Select one default branch';
      return;
    }

    this.branchAccessSaving = true;
    this.branchAccessError = '';
    try {
      const result = await firstValueFrom(this.api.put<ApiEnvelope<StaffBranchAccess>>(`/staff/${this.editingId}/branch-access`, {
        assignments: this.branchAccess.branches.map((branch) => ({
          branchId: branch.branchId,
          roleId: branch.roleId,
          accessType: branch.accessType,
          validFrom: branch.validFrom,
          validUntil: branch.validUntil,
          isDefault: branch.isDefault,
          active: branch.active,
        })),
      }));
      if (!result.success || !result.data) throw new Error(result.error?.message || 'Unable to save branch access');
      this.branchAccess = result.data;
      await this.loadHistory();
    } catch (error) {
      this.branchAccessError = error instanceof Error ? error.message : 'Unable to save branch access';
    } finally {
      this.branchAccessSaving = false;
    }
  }

  async provisionLogin() {
    if (!this.editingId || this.branchAccess.linkedLogin) return;
    const loginId = this.loginProvision.loginId.trim().toLowerCase();
    const email = this.loginProvision.email.trim().toLowerCase();
    const initialPassword = this.loginProvision.initialPassword;
    const roleId = this.loginProvision.roleId;
    this.branchAccessError = '';
    if (!/^[a-z0-9._-]{3,80}$/.test(loginId)) {
      this.branchAccessError = 'Enter a valid Login ID';
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      this.branchAccessError = 'Enter a valid real email';
      return;
    }
    if (initialPassword.length < 12 || initialPassword.length > 128) {
      this.branchAccessError = 'Initial password must contain 12 to 128 characters';
      return;
    }
    if (!roleId) {
      this.branchAccessError = 'Select a role';
      return;
    }

    this.branchAccessSaving = true;
    try {
      const result = await firstValueFrom(this.api.post<ApiEnvelope<StaffBranchAccess>>(`/staff/${this.editingId}/login`, {
        loginId, email, initialPassword, roleId,
      }));
      if (!result.success || !result.data) throw new Error(result.error?.message || 'Unable to create login');
      this.branchAccess = result.data;
      this.profileForm.linkedLogin = true;
      this.loginProvision = emptyLoginProvision();
      await this.loadHistory();
    } catch (error) {
      this.branchAccessError = error instanceof Error ? error.message : 'Unable to create login';
    } finally {
      this.branchAccessSaving = false;
    }
  }

  private resetBranchAccess() {
    this.branchAccess = emptyBranchAccess();
    this.branchAccessSearch = '';
    this.branchAccessRegion = '';
    this.branchAccessZone = '';
    this.branchAccessCluster = '';
    this.bulkBranchRoleId = '';
    this.bulkBranchAccessType = 'permanent';
    this.bulkBranchValidFrom = '';
    this.bulkBranchValidUntil = '';
    this.branchAccessLoaded = false;
    this.branchAccessLoading = false;
    this.branchAccessSaving = false;
    this.branchAccessError = '';
    this.loginProvision = emptyLoginProvision();
  }

  private uniqueBranchValues(
    key: 'regionName' | 'zoneName' | 'clusterName',
    include: (branch: StaffBranchAccessRow) => boolean = () => true,
  ) {
    return [...new Set(this.branchAccess.branches.filter(include).map((branch) => branch[key]).filter(Boolean))].sort();
  }

  private validAccessWindow(from: string | null, until: string | null) {
    return Boolean(from && until && until >= from);
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
      categoryId: this.profileForm.categoryId || null, shiftTemplateId: this.profileForm.shiftTemplateId || null,
      designation: this.profileForm.designation.trim(), companyName: this.profileForm.companyName.trim(),
      mandatoryBreakMinutes: this.profileForm.mandatoryBreakMinutes, workTasks, maxWorkHours: this.profileForm.maxWorkHours,
      targetRevenuePaise: this.profileForm.targetRevenue === null ? null : Math.round(this.profileForm.targetRevenue * 100),
      vacationDays: this.profileForm.vacationDays, specialLeaveDays: this.profileForm.specialLeaveDays,
      tenureStartDate: this.profileForm.tenureStartDate || null, bookingIntervalMinutes: this.profileForm.bookingIntervalMinutes,
      restrictBookingToReturningGuests: this.profileForm.restrictBookingToReturningGuests,
      photoUrl: this.profileForm.photoUrl.trim(), dateOfBirth: this.profileForm.dateOfBirth || null,
      joiningDate: this.profileForm.joiningDate || null, gender: this.profileForm.gender,
      employmentType: this.profileForm.employmentType, department: this.profileForm.department.trim(),
      reportingManagerId: this.profileForm.reportingManagerId || null,
      addressLine1: this.profileForm.addressLine1.trim(), addressLine2: this.profileForm.addressLine2.trim(),
      city: this.profileForm.city.trim(), stateName: this.profileForm.stateName.trim(),
      postalCode: this.profileForm.postalCode.trim(), country: this.profileForm.country.trim(),
      emergencyContactName: this.profileForm.emergencyContactName.trim(),
      emergencyContactRelationship: this.profileForm.emergencyContactRelationship.trim(),
      emergencyContactPhone: this.profileForm.emergencyContactPhone.trim(),
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

  editDocument(document: StaffDocument) {
    this.documentForm = {
      id: document.id, documentType: document.documentType, documentName: document.documentName,
      documentUrl: document.documentUrl, verificationStatus: document.verificationStatus,
      expiryDate: document.expiryDate || '', notes: document.notes || '',
    };
    this.documentError = '';
  }

  resetDocument() { this.documentForm = emptyDocument(); this.documentError = ''; }

  async saveDocument() {
    if (!this.editingId) return;
    if (!this.documentForm.documentType.trim() || !this.documentForm.documentName.trim() || !this.documentForm.documentUrl.trim()) {
      this.documentError = 'Document type, name and URL are required';
      return;
    }
    this.documentSaving = true;
    this.documentError = '';
    try {
      const payload = {
        documentType: this.documentForm.documentType.trim(), documentName: this.documentForm.documentName.trim(),
        documentUrl: this.documentForm.documentUrl.trim(), verificationStatus: this.documentForm.verificationStatus,
        expiryDate: this.documentForm.expiryDate || null, notes: this.documentForm.notes.trim(),
      };
      const endpoint = this.documentForm.id
        ? `/staff/${this.editingId}/documents/${this.documentForm.id}`
        : `/staff/${this.editingId}/documents`;
      const result = this.documentForm.id
        ? await firstValueFrom(this.api.patch<ApiEnvelope<StaffDocument>>(endpoint, payload))
        : await firstValueFrom(this.api.post<ApiEnvelope<StaffDocument>>(endpoint, payload));
      if (!result.success) throw new Error(result.error?.message || 'Unable to save staff document');
      this.resetDocument();
      await Promise.all([this.loadDocuments(), this.loadHistory()]);
    } catch (error) {
      this.documentError = error instanceof Error ? error.message : 'Unable to save staff document';
    } finally {
      this.documentSaving = false;
    }
  }

  async uploadPhoto(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file || !this.editingId) return;
    this.fileUploading = true;
    this.profileError = '';
    try {
      const uploaded = await this.uploadStaffFile(file, 'photo');
      this.profileForm.photoUrl = uploaded.fileUrl;
      this.setPhotoPreview(URL.createObjectURL(file), true);
      await this.saveProfile(this.editingId);
      await this.loadHistory();
    } catch (error) {
      this.profileError = error instanceof Error ? error.message : 'Unable to upload employee photo';
    } finally { this.fileUploading = false; }
  }

  async uploadDocumentFile(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file || !this.editingId) return;
    this.fileUploading = true;
    this.documentError = '';
    try {
      const uploaded = await this.uploadStaffFile(file, 'document');
      this.documentForm.documentUrl = uploaded.fileUrl;
      if (!this.documentForm.documentName) this.documentForm.documentName = this.titleCase(file.name.replace(/\.[^.]+$/, '').replaceAll('_', ' '));
      if (!this.documentForm.documentType) this.documentForm.documentType = file.type === 'application/pdf' ? 'PDF' : 'Document';
    } catch (error) {
      this.documentError = error instanceof Error ? error.message : 'Unable to upload staff document';
    } finally { this.fileUploading = false; }
  }

  async downloadStaffFile(url: string, fileName: string) {
    try {
      if (!url.startsWith('/staff/files/')) {
        window.open(url, '_blank', 'noopener,noreferrer');
        return;
      }
      const blob = await firstValueFrom(this.api.getBlob(url));
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = objectUrl;
      link.download = fileName;
      link.click();
      URL.revokeObjectURL(objectUrl);
    } catch (error) {
      this.documentError = error instanceof Error ? error.message : 'Unable to download staff document';
    }
  }

  private async uploadStaffFile(file: File, kind: 'photo' | 'document') {
    if (!file.size || file.size > 5 * 1024 * 1024) throw new Error('File must be 5 MB or smaller');
    const allowed = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'];
    if (!allowed.includes(file.type) || kind === 'photo' && !file.type.startsWith('image/')) throw new Error('Unsupported file type');
    const result = await firstValueFrom(this.api.post<ApiEnvelope<StaffFileUpload>>(
      `/staff/${this.editingId}/files?kind=${kind}&fileName=${encodeURIComponent(file.name)}`,
      file,
    ));
    if (!result.success || !result.data) throw new Error(result.error?.message || 'Unable to upload staff file');
    return result.data;
  }

  private async loadPhotoPreview(url: string) {
    if (!url.startsWith('/staff/files/')) { this.setPhotoPreview(url); return; }
    try {
      const blob = await firstValueFrom(this.api.getBlob(url));
      this.setPhotoPreview(URL.createObjectURL(blob), true);
    } catch { this.setPhotoPreview(''); }
  }

  private setPhotoPreview(url: string, objectUrl = false) {
    this.clearPhotoObjectUrl();
    this.photoPreviewUrl = url;
    if (objectUrl) this.photoObjectUrl = url;
  }

  private clearPhotoObjectUrl() {
    if (this.photoObjectUrl) URL.revokeObjectURL(this.photoObjectUrl);
    this.photoObjectUrl = '';
  }

  async selectBulkFile(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    this.bulkError = '';
    this.bulkResult = null;
    try {
      if (file.size > 2_000_000) throw new Error('CSV file must be 2 MB or smaller');
      const rows = this.parseCsv(await file.text());
      if (rows.length < 2) throw new Error('CSV has no staff rows');
      if (rows.length > 501) throw new Error('CSV supports up to 500 staff rows');
      const headers = rows[0].map((value) => value.trim().toLowerCase().replace(/[^a-z0-9]/g, ''));
      const index = (name: string) => headers.indexOf(name.toLowerCase());
      if (index('employeecode') < 0 || index('firstname') < 0) {
        throw new Error('CSV requires employeeCode and firstName columns');
      }
      const cell = (row: string[], name: string) => {
        const position = index(name);
        return position < 0 ? '' : (row[position] || '').trim();
      };
      this.bulkRows = rows.slice(1).filter((row) => row.some((value) => value.trim())).map((row, rowIndex) => {
        const employeeCode = cell(row, 'employeecode');
        const firstName = cell(row, 'firstname');
        if (!employeeCode || !firstName) throw new Error(`Row ${rowIndex + 2}: employeeCode and firstName are required`);
        const activeText = cell(row, 'active').toLowerCase();
        if (activeText && !['true', 'false', 'yes', 'no', '1', '0'].includes(activeText)) {
          throw new Error(`Row ${rowIndex + 2}: active must be Yes or No`);
        }
        return this.compactBulkRow({
          employeeCode, firstName: this.titleCase(firstName), lastName: this.titleCase(cell(row, 'lastname')),
          email: cell(row, 'email').toLowerCase(), mobilePhone: cell(row, 'mobilephone'),
          jobTitle: this.titleCase(cell(row, 'jobtitle')),
          active: activeText ? ['true', 'yes', '1'].includes(activeText) : undefined,
          photoUrl: cell(row, 'photourl'), dateOfBirth: this.parseCsvDate(cell(row, 'dateofbirth'), rowIndex + 2),
          joiningDate: this.parseCsvDate(cell(row, 'joiningdate'), rowIndex + 2),
          gender: cell(row, 'gender').toLowerCase(), employmentType: cell(row, 'employmenttype').toLowerCase(),
          department: this.titleCase(cell(row, 'department')), reportingManagerId: cell(row, 'reportingmanagerid'),
          categoryId: cell(row, 'categoryid'), shiftTemplateId: cell(row, 'shifttemplateid'),
        });
      });
      if (!this.bulkRows.length) throw new Error('CSV has no staff rows');
      this.bulkFileName = file.name;
      this.bulkBatchId = crypto.randomUUID();
      this.bulkDrawerOpen = true;
    } catch (error) {
      this.bulkRows = [];
      this.bulkError = error instanceof Error ? error.message : 'Unable to read CSV';
      this.bulkDrawerOpen = true;
    }
  }

  closeBulkDrawer() { if (!this.bulkSaving) this.bulkDrawerOpen = false; }

  downloadBulkTemplate() {
    const headers = 'employeeCode,firstName,lastName,email,mobilePhone,jobTitle,active,photoUrl,dateOfBirth,joiningDate,gender,employmentType,department,reportingManagerId,categoryId,shiftTemplateId\r\n';
    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob([headers], { type: 'text/csv;charset=utf-8' }));
    link.download = 'staff-import-template.csv';
    link.click();
    URL.revokeObjectURL(link.href);
  }

  async applyBulkImport() {
    if (!this.bulkRows.length || !this.bulkBatchId) return;
    this.bulkSaving = true;
    this.bulkError = '';
    try {
      const result = await firstValueFrom(this.api.post<ApiEnvelope<BulkImportResult>>('/staff/bulk-imports', {
        batchId: this.bulkBatchId, rows: this.bulkRows,
      }));
      if (!result.success || !result.data) throw new Error(result.error?.message || 'Unable to import staff');
      this.bulkResult = result.data;
      await this.loadEmployees();
    } catch (error) {
      this.bulkError = error instanceof Error ? error.message : 'Unable to import staff';
    } finally {
      this.bulkSaving = false;
    }
  }

  formatDateTime(value: string) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? '—' : new Intl.DateTimeFormat('en-GB', {
      day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
    }).format(date);
  }

  formatDate(value: string | null) {
    if (!value) return 'No expiry';
    const [year, month, day] = value.slice(0, 10).split('-');
    return year && month && day ? `${day}/${month}/${year}` : '—';
  }

  private async loadManagerOptions() {
    try {
      const result = await firstValueFrom(this.api.get<ApiEnvelope<StaffListPage>>('/staff/list?page=1&pageSize=100&active=true&sortBy=firstName&sortDirection=asc'));
      this.managerOptions = result.success && result.data ? result.data.items.filter((item) => item.id !== this.editingId) : [];
    } catch { this.managerOptions = []; }
  }

  private async loadDocuments() {
    if (!this.editingId) return;
    this.documentsLoading = true;
    this.documentError = '';
    try {
      const result = await firstValueFrom(this.api.get<ApiEnvelope<StaffDocument[]>>(`/staff/${this.editingId}/documents`));
      if (!result.success || !result.data) throw new Error(result.error?.message || 'Unable to load staff documents');
      this.documents = result.data;
    } catch (error) {
      this.documents = [];
      this.documentError = error instanceof Error ? error.message : 'Unable to load staff documents';
    } finally { this.documentsLoading = false; }
  }

  private async loadHistory() {
    if (!this.editingId) return;
    this.historyLoading = true;
    this.historyError = '';
    try {
      const result = await firstValueFrom(this.api.get<ApiEnvelope<StaffHistory[]>>(`/staff/${this.editingId}/hr-history`));
      if (!result.success || !result.data) throw new Error(result.error?.message || 'Unable to load staff history');
      this.history = result.data;
    } catch (error) {
      this.history = [];
      this.historyError = error instanceof Error ? error.message : 'Unable to load staff history';
    } finally { this.historyLoading = false; }
  }

  private parseCsv(value: string) {
    const rows: string[][] = [];
    let row: string[] = [], cell = '', quoted = false;
    for (let index = 0; index < value.length; index += 1) {
      const character = value[index];
      if (character === '"' && quoted && value[index + 1] === '"') { cell += '"'; index += 1; }
      else if (character === '"') quoted = !quoted;
      else if (character === ',' && !quoted) { row.push(cell); cell = ''; }
      else if ((character === '\n' || character === '\r') && !quoted) {
        if (character === '\r' && value[index + 1] === '\n') index += 1;
        row.push(cell); rows.push(row); row = []; cell = '';
      } else cell += character;
    }
    if (cell || row.length) { row.push(cell); rows.push(row); }
    return rows;
  }

  private parseCsvDate(value: string, rowNumber: number) {
    if (!value) return undefined;
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
    const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value);
    if (!match) throw new Error(`Row ${rowNumber}: dates must use DD/MM/YYYY`);
    const iso = `${match[3]}-${match[2]}-${match[1]}`;
    const parsed = new Date(`${iso}T00:00:00Z`);
    if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== iso) {
      throw new Error(`Row ${rowNumber}: invalid date`);
    }
    return iso;
  }

  private compactBulkRow(row: BulkStaffRow) {
    return Object.fromEntries(Object.entries(row).filter(([, value]) => value !== '' && value !== undefined)) as BulkStaffRow;
  }

  private async loadMasters(showLoading: boolean) {
    if (showLoading) this.mastersLoading = true;
    this.mastersError = '';
    try {
      const result = await firstValueFrom(this.api.get<ApiEnvelope<StaffMasters>>('/staff/masters'));
      if (!result.success || !result.data) throw new Error(result.error?.message || 'Unable to load staff masters');
      this.applyMasters(result.data);
    } catch (error) {
      this.mastersError = error instanceof Error ? error.message : 'Unable to load staff masters';
    } finally {
      this.mastersLoading = false;
    }
  }

  private applyMasters(data: StaffMasters) {
    this.masters = {
      categories: data.categories || [],
      shiftTemplates: (data.shiftTemplates || []).map((item) => ({
        ...item,
        shift1Start: item.shift1Start?.slice(0, 5) || '',
        shift1End: item.shift1End?.slice(0, 5) || '',
        shift2Start: item.shift2Start?.slice(0, 5) || null,
        shift2End: item.shift2End?.slice(0, 5) || null,
      })),
      attendanceRule: data.attendanceRule ? { ...data.attendanceRule } : emptyAttendanceRule(),
      leavePolicies: data.leavePolicies || [],
    };
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
