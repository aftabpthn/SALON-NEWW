export interface OwnerAvailability { available: boolean; reason: string | null; }
export interface OwnerCapabilities { actions: string[]; unavailable?: Record<string, string>; }
export interface OwnerPageInfo { total: number; limit: number; offset: number; hasMore: boolean; }
export interface OwnerStaff {
  id: string; branchId: string; branchName?: string; employeeCode: string; firstName: string; lastName: string; fullName: string;
  mobile: string; email: string; profilePhoto: string; employmentType: string; status: string; roleId: string; designation: string;
  department: string; loginStatus: string; loginId: string; attendanceStatus: string; businessPaise?: number; version: number;
}
export interface OwnerAttendance { id: string; branchId: string; branchName?: string; staffId: string; staffName: string; businessDate: string; clockInAt: string; clockOutAt: string; status: string; attendanceStatus: string; overtimeMinutes: number; workedMinutes?: number; lateMinutes?: number; missingClockOut: boolean; source: string; version: number; }
export interface OwnerLeave { id: string; branchId: string; staffId: string; staffName: string; leaveType: string; startDate: string; endDate: string; days: number; reason: string; status: string; rejectionReason?: string; approvedAt?: string; documentAvailable: boolean; version: number; }
export interface OwnerPayroll { id: string; branchId: string; periodStart: string; periodEnd: string; status: string; grossAmountPaise: number; deductionsAmountPaise: number; netAmountPaise: number; version: number; }
export interface OwnerPayrollItem { id: string; branchId: string; staffId: string; salaryType: string; status: string; version: number; grossAmountPaise: number; overtimeAmountPaise: number; overtimeMinutes: number; bonusAmountPaise: number; deductionsAmountPaise: number; netAmountPaise: number; pfAmountPaise: number; esicAmountPaise: number; tdsAmountPaise: number; ptAmountPaise: number; salarySource: string; hasStatutoryData: boolean; }
export interface OwnerListResponse<T> { items: T[]; page?: OwnerPageInfo; summary?: Record<string, number>; availability: Record<string, OwnerAvailability>; capabilities: OwnerCapabilities; views?: string[]; filters?: { roles?: string[]; employments?: string[] }; }
export interface OwnerStaffRevenueDay { date: string; revenuePaise: number; services: number; tipsPaise: number; }
export interface OwnerStaffRevenue { totalPaise: number; totalServices: number; totalTipsPaise: number; daily: OwnerStaffRevenueDay[]; }
export interface OwnerStaffDetail { staff: OwnerStaff & { employeeDetails?: { attendanceSalary?: Record<string, unknown> } | null }; sections: { schedules: Record<string, unknown>[]; attendance: OwnerAttendance[]; appointments: Record<string, unknown>[]; performance: OwnerAvailability; salary: Record<string, unknown> | null; commissions: Record<string, unknown>[]; payroll: OwnerPayrollItem[]; leaves: OwnerLeave[]; access: Record<string, unknown>; activity: Record<string, unknown>[]; revenue: OwnerStaffRevenue }; availability: Record<string, OwnerAvailability>; capabilities: OwnerCapabilities; }
export interface OwnerLeaveDetail { leave: OwnerLeave; balances: Record<string, unknown>[]; conflicts: OwnerLeave[]; history: Record<string, unknown>[]; availability: Record<string, OwnerAvailability>; capabilities: OwnerCapabilities; }
export interface OwnerPayrollDetail { run: OwnerPayroll; items: OwnerPayrollItem[]; availability: Record<string, OwnerAvailability>; capabilities: OwnerCapabilities; }
export type OwnerStaffWrite = Partial<Pick<OwnerStaff, "branchId" | "firstName" | "lastName" | "fullName" | "mobile" | "email" | "employmentType" | "status" | "roleId" | "department" | "designation" | "version">>;
