export interface StaffOsStaff {
  id: string;
  branchId: string;
  employeeCode?: string;
  firstName: string;
  lastName?: string;
  fullName: string;
  mobile?: string;
  email?: string;
  employmentType?: string;
  status: string;
  roleId?: string;
  loginUserId?: string;
  loginId?: string;
  loginEmail?: string;
  loginStatus?: string;
  loginPasswordSet?: boolean;
  staffCategoryId?: string;
  staffCategoryName?: string;
  staffCategoryScope?: string;
  department?: string;
  designation?: string;
  profilePhoto?: string;
  employeeDetails?: StaffOsEmployeeDetails | null;
  version: number;
  createdAt?: string;
  updatedAt?: string;
}

export interface StaffOsEmployeeDetails {
  id: string;
  branchId: string;
  staffId: string;
  shortName?: string;
  lastWorkingDate?: string;
  anniversaryDate?: string;
  hideFromRoster?: boolean;
  allowSkipOtp?: boolean;
  entryPinSet?: boolean;
  multiBranchAccess?: string[];
  contact?: Record<string, unknown>;
  emergencyContact?: Record<string, unknown>;
  nativeContact?: Record<string, unknown>;
  incentive?: Record<string, unknown>;
  attendanceSalary?: Record<string, unknown>;
  remarks?: string;
  imeiNo?: string;
  version?: number;
  createdAt?: string;
  updatedAt?: string;
}

export interface StaffOsBranch {
  id: string;
  name?: string;
  status?: string;
}

export type StaffOsCategoryScope = 'operator' | 'helper' | 'admin' | 'staff' | 'contract_operator';

export interface StaffOsStaffCategory {
  id: string;
  branchId?: string;
  name: string;
  scope: StaffOsCategoryScope;
  department?: string;
  defaultDesignation?: string;
  defaultEmploymentType?: string;
  fixedIncentiveAmount?: number;
  fixedIncentivePercent?: number;
  serviceEligibility?: string[];
  skillLicenses?: string[];
  notes?: string;
  status: string;
  version: number;
  createdAt?: string;
  updatedAt?: string;
}

export interface StaffOsSchedule {
  id: string;
  branchId: string;
  staffId: string;
  scheduleDate: string;
  startTime: string;
  endTime: string;
  status: string;
  version: number;
}

export interface StaffOsMetric {
  label: string;
  value: string;
  tone: 'neutral' | 'good' | 'warning' | 'critical';
}

export interface StaffOsPerformanceRow {
  staffId: string;
  businessDate: string;
  revenueGenerated: number;
  utilizationPct: number;
  avgRating: number;
  productivityScore: number;
}

export interface StaffOsPerformanceSummary {
  days: number;
  revenue: number;
  avgUtilization: number;
  avgScore: number;
}

export interface StaffOsPerformanceResponse {
  rows: StaffOsPerformanceRow[];
  summary: StaffOsPerformanceSummary;
}

export interface StaffOsTask {
  id: string;
  branchId?: string;
  staffId?: string;
  title: string;
  description?: string;
  priority: string;
  dueAt?: string;
  status: string;
  version: number;
}

export interface StaffOsAttendanceMaster {
  id: string;
  branchId?: string;
  code: string;
  name: string;
  dayCount: number;
  paid: boolean;
  availableForAppointment: boolean;
  hide: boolean;
  color?: string;
  sortOrder?: number;
  notes?: string;
  status: string;
  version: number;
}

export interface StaffOsLeaveMaster {
  id: string;
  branchId?: string;
  code: string;
  name: string;
  dayCount: number;
  paid: boolean;
  availableForAppointment: boolean;
  leaveQuota: number;
  quotaPeriod: 'monthly' | 'yearly';
  shiftTemplateId?: string;
  shiftName?: string;
  carryForwardAllowed: boolean;
  approvalRequired: boolean;
  hide: boolean;
  notes?: string;
  status: string;
  version: number;
}

export interface StaffOsShiftMaster {
  id: string;
  branchId?: string;
  name: string;
  shortCode: string;
  description?: string;
  startTime: string;
  endTime: string;
  breakMinutes?: number;
  color?: string;
  shiftType: 'regular' | 'weekly_off' | 'holiday' | 'leave';
  hide: boolean;
  status: string;
  version: number;
}

export interface StaffOsAttendanceSlab {
  sNo: number;
  fromMinutes: number;
  toMinutes: number;
  statusId?: string;
  statusName?: string;
}

export interface StaffOsAttendanceCategory {
  id: string;
  branchId?: string;
  name: string;
  workingDurationMinutes: number;
  inTime?: string;
  outTime?: string;
  overtimeApplicable: boolean;
  minimumOtDurationMinutes: number;
  allowableLateMinutes: number;
  lateMarkStatusId?: string;
  lateMarkAfterCount: number;
  lateMarkMode: 'every_x_late' | 'all_after_x_late';
  severeLateStatusId?: string;
  severeLateAfterMinutes: number;
  attendanceSlabs: StaffOsAttendanceSlab[];
  allowableShiftIds: string[];
  hide: boolean;
  notes?: string;
  status: string;
  version: number;
}

export type StaffOsTargetIncentiveType = 'service' | 'product' | 'membership' | 'branch_admin' | 'admin' | 'all_transaction';
export type StaffOsTargetAssigneeType = 'staff' | 'branch' | 'standard';
export type StaffOsTargetRoleScope = 'operator' | 'admin' | 'all';

export interface StaffOsTargetIncentiveSlab {
  sNo: number;
  fromAmount: number;
  toAmount: number;
  incentivePercent: number;
  incentiveAmount: number;
  employeeAmountPercent?: number;
  employeeAmount?: number;
}

export interface StaffOsTargetIncentive {
  id: string;
  branchId?: string;
  targetType: StaffOsTargetIncentiveType;
  assigneeType: StaffOsTargetAssigneeType;
  assigneeId: string;
  assigneeName: string;
  roleScope: StaffOsTargetRoleScope;
  slabs: StaffOsTargetIncentiveSlab[];
  notes?: string;
  hide: boolean;
  status: string;
  version: number;
}

export interface StaffOsServiceOption {
  id: string;
  name: string;
  category?: string;
  price?: number;
  durationMinutes?: number;
  status?: string;
}

export interface StaffOsServiceAssignment {
  id: string;
  branchId?: string;
  staffId: string;
  staffName: string;
  roleScope: StaffOsTargetRoleScope;
  serviceIds: string[];
  services: StaffOsServiceOption[];
  categoryFilters: string[];
  hide: boolean;
  notes?: string;
  status: string;
  version: number;
}

export interface StaffOsFinePenalty {
  id: string;
  branchId?: string;
  name: string;
  amount: number;
  amountPaise?: number;
  ruleType?: 'manual' | 'late_count' | 'absent_day' | 'half_day' | 'short_hours' | 'no_clock_out' | 'weekend_penalty' | 'sandwich_penalty' | 'unpaid_week_off';
  ruleLabel?: string;
  triggerCount?: number;
  applyMode?: 'per_occurrence' | 'fixed';
  autoDeduct?: boolean;
  hide: boolean;
  notes?: string;
  status: string;
  version: number;
}

export type StaffOsAllowanceDeductionType = 'allowance' | 'deduction';

export interface StaffOsAllowanceDeduction {
  id: string;
  branchId?: string;
  description: string;
  entryType: StaffOsAllowanceDeductionType;
  hide: boolean;
  notes?: string;
  status: string;
  version: number;
}

export interface StaffOsPayrollToggleBlock {
  applicable?: boolean;
  includeBasicSalary?: boolean;
  includeIncentives?: boolean;
  includeAbsentDays?: boolean;
  [key: string]: unknown;
}

export interface StaffOsPayrollSalaryStructure {
  id: string;
  branchId?: string;
  name: string;
  providentFund: StaffOsPayrollToggleBlock;
  professionalTax: StaffOsPayrollToggleBlock;
  esic: StaffOsPayrollToggleBlock;
  tds: StaffOsPayrollToggleBlock;
  hide: boolean;
  notes?: string;
  status: string;
  version: number;
}

export interface StaffOsBulkEmployeeRow {
  staffId: string;
  version: number;
  employeeName: string;
  shortName?: string;
  branchId?: string;
  type?: string;
  categoryId?: string;
  categoryName?: string;
  designation?: string;
  joiningDate?: string;
  leftDate?: string;
  hide?: boolean;
  dateOfBirth?: string;
  anniversaryDate?: string;
  gender?: string;
  panNo?: string;
  aadharNo?: string;
}

export interface StaffOsBulkEmployeeUpdateJob {
  id: string;
  branchId?: string;
  totalRows: number;
  updatedRows: number;
  failedRows: number;
  results: Array<{ staffId: string; status: string; error?: string; version?: number }>;
  status: string;
  createdAt?: string;
}

export interface StaffOsRiskScore {
  staffId: string;
  score: number;
  level: string;
  reasons: string[];
  recommendedActions: string[];
}
