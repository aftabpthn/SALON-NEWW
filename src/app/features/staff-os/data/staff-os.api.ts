import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiRecord, ApiService } from '../../../core/api.service';
import {
  StaffOsAttendanceCategory,
  StaffOsAttendanceMaster,
  StaffOsAllowanceDeduction,
  StaffOsBranch,
  StaffOsBulkEmployeeRow,
  StaffOsBulkEmployeeUpdateJob,
  StaffOsFinePenalty,
  StaffOsLeaveMaster,
  StaffOsPayrollSalaryStructure,
  StaffOsPerformanceResponse,
  StaffOsRiskScore,
  StaffOsSchedule,
  StaffOsServiceAssignment,
  StaffOsServiceOption,
  StaffOsShiftMaster,
  StaffOsStaff,
  StaffOsStaffCategory,
  StaffOsTargetIncentive,
  StaffOsTask
} from '../domain/staff-os.models';

@Injectable({ providedIn: 'root' })
export class StaffOsApi {
  constructor(private readonly api: ApiService) {}

  branches(params: ApiRecord = {}): Observable<StaffOsBranch[]> {
    return this.api.list<StaffOsBranch[]>('branches', params);
  }

  services(params: ApiRecord = {}): Observable<StaffOsServiceOption[]> {
    return this.api.list<StaffOsServiceOption[]>('services', params);
  }

  products(params: ApiRecord = {}): Observable<ApiRecord[]> {
    return this.api.list<ApiRecord[]>('products', params);
  }

  memberships(params: ApiRecord = {}): Observable<ApiRecord[]> {
    return this.api.list<ApiRecord[]>('memberships', params);
  }

  packages(params: ApiRecord = {}): Observable<ApiRecord[]> {
    return this.api.list<ApiRecord[]>('packages', params);
  }

  staff(params: ApiRecord = {}): Observable<StaffOsStaff[]> {
    return this.api.list<StaffOsStaff[]>('staff-os/staff', params);
  }

  createStaff(payload: ApiRecord): Observable<StaffOsStaff> {
    return this.api.post<StaffOsStaff>('staff-os/staff', payload);
  }

  updateStaff(id: string, payload: ApiRecord): Observable<StaffOsStaff> {
    return this.api.patch<StaffOsStaff>(`staff-os/staff/${id}`, payload);
  }

  updateStaffStatus(id: string, payload: ApiRecord): Observable<StaffOsStaff> {
    return this.api.patch<StaffOsStaff>(`staff-os/staff/${id}/status`, payload);
  }

  uploadStaffPhoto(payload: ApiRecord): Observable<ApiRecord> {
    return this.api.post<ApiRecord>('staff-os/staff/media', payload);
  }

  staffCategories(params: ApiRecord = {}): Observable<StaffOsStaffCategory[]> {
    return this.api.list<StaffOsStaffCategory[]>('staff-os/staff-categories', params);
  }

  createStaffCategory(payload: ApiRecord): Observable<StaffOsStaffCategory> {
    return this.api.post<StaffOsStaffCategory>('staff-os/staff-categories', payload);
  }

  updateStaffCategory(id: string, payload: ApiRecord): Observable<StaffOsStaffCategory> {
    return this.api.patch<StaffOsStaffCategory>(`staff-os/staff-categories/${id}`, payload);
  }

  updateStaffCategoryStatus(id: string, payload: ApiRecord): Observable<StaffOsStaffCategory> {
    return this.api.patch<StaffOsStaffCategory>(`staff-os/staff-categories/${id}/status`, payload);
  }

  attendanceMasters(params: ApiRecord = {}): Observable<StaffOsAttendanceMaster[]> {
    return this.api.list<StaffOsAttendanceMaster[]>('staff-os/attendance-masters', params);
  }

  createAttendanceMaster(payload: ApiRecord): Observable<StaffOsAttendanceMaster> {
    return this.api.post<StaffOsAttendanceMaster>('staff-os/attendance-masters', payload);
  }

  updateAttendanceMaster(id: string, payload: ApiRecord): Observable<StaffOsAttendanceMaster> {
    return this.api.patch<StaffOsAttendanceMaster>(`staff-os/attendance-masters/${id}`, payload);
  }

  updateAttendanceMasterStatus(id: string, payload: ApiRecord): Observable<StaffOsAttendanceMaster> {
    return this.api.patch<StaffOsAttendanceMaster>(`staff-os/attendance-masters/${id}/status`, payload);
  }

  leaveMasters(params: ApiRecord = {}): Observable<StaffOsLeaveMaster[]> {
    return this.api.list<StaffOsLeaveMaster[]>('staff-os/leave-masters', params);
  }

  createLeaveMaster(payload: ApiRecord): Observable<StaffOsLeaveMaster> {
    return this.api.post<StaffOsLeaveMaster>('staff-os/leave-masters', payload);
  }

  updateLeaveMaster(id: string, payload: ApiRecord): Observable<StaffOsLeaveMaster> {
    return this.api.patch<StaffOsLeaveMaster>(`staff-os/leave-masters/${id}`, payload);
  }

  updateLeaveMasterStatus(id: string, payload: ApiRecord): Observable<StaffOsLeaveMaster> {
    return this.api.patch<StaffOsLeaveMaster>(`staff-os/leave-masters/${id}/status`, payload);
  }

  shiftMasters(params: ApiRecord = {}): Observable<StaffOsShiftMaster[]> {
    return this.api.list<StaffOsShiftMaster[]>('staff-os/shift-masters', params);
  }

  createShiftMaster(payload: ApiRecord): Observable<StaffOsShiftMaster> {
    return this.api.post<StaffOsShiftMaster>('staff-os/shift-masters', payload);
  }

  updateShiftMaster(id: string, payload: ApiRecord): Observable<StaffOsShiftMaster> {
    return this.api.patch<StaffOsShiftMaster>(`staff-os/shift-masters/${id}`, payload);
  }

  updateShiftMasterStatus(id: string, payload: ApiRecord): Observable<StaffOsShiftMaster> {
    return this.api.patch<StaffOsShiftMaster>(`staff-os/shift-masters/${id}/status`, payload);
  }

  attendanceCategories(params: ApiRecord = {}): Observable<StaffOsAttendanceCategory[]> {
    return this.api.list<StaffOsAttendanceCategory[]>('staff-os/attendance-categories', params);
  }

  createAttendanceCategory(payload: ApiRecord): Observable<StaffOsAttendanceCategory> {
    return this.api.post<StaffOsAttendanceCategory>('staff-os/attendance-categories', payload);
  }

  updateAttendanceCategory(id: string, payload: ApiRecord): Observable<StaffOsAttendanceCategory> {
    return this.api.patch<StaffOsAttendanceCategory>(`staff-os/attendance-categories/${id}`, payload);
  }

  updateAttendanceCategoryStatus(id: string, payload: ApiRecord): Observable<StaffOsAttendanceCategory> {
    return this.api.patch<StaffOsAttendanceCategory>(`staff-os/attendance-categories/${id}/status`, payload);
  }

  targetIncentives(params: ApiRecord = {}): Observable<StaffOsTargetIncentive[]> {
    return this.api.list<StaffOsTargetIncentive[]>('staff-os/target-incentives', params);
  }

  createTargetIncentive(payload: ApiRecord): Observable<StaffOsTargetIncentive> {
    return this.api.post<StaffOsTargetIncentive>('staff-os/target-incentives', payload);
  }

  updateTargetIncentive(id: string, payload: ApiRecord): Observable<StaffOsTargetIncentive> {
    return this.api.patch<StaffOsTargetIncentive>(`staff-os/target-incentives/${id}`, payload);
  }

  updateTargetIncentiveStatus(id: string, payload: ApiRecord): Observable<StaffOsTargetIncentive> {
    return this.api.patch<StaffOsTargetIncentive>(`staff-os/target-incentives/${id}/status`, payload);
  }

  copyTargetIncentive(id: string, payload: ApiRecord): Observable<StaffOsTargetIncentive[]> {
    return this.api.post<StaffOsTargetIncentive[]>(`staff-os/target-incentives/${id}/copy`, payload);
  }

  serviceAssignments(params: ApiRecord = {}): Observable<StaffOsServiceAssignment[]> {
    return this.api.list<StaffOsServiceAssignment[]>('staff-os/service-assignments', params);
  }

  createServiceAssignment(payload: ApiRecord): Observable<StaffOsServiceAssignment> {
    return this.api.post<StaffOsServiceAssignment>('staff-os/service-assignments', payload);
  }

  updateServiceAssignment(id: string, payload: ApiRecord): Observable<StaffOsServiceAssignment> {
    return this.api.patch<StaffOsServiceAssignment>(`staff-os/service-assignments/${id}`, payload);
  }

  updateServiceAssignmentStatus(id: string, payload: ApiRecord): Observable<StaffOsServiceAssignment> {
    return this.api.patch<StaffOsServiceAssignment>(`staff-os/service-assignments/${id}/status`, payload);
  }

  copyServiceAssignment(id: string, payload: ApiRecord): Observable<StaffOsServiceAssignment[]> {
    return this.api.post<StaffOsServiceAssignment[]>(`staff-os/service-assignments/${id}/copy`, payload);
  }

  finePenalties(params: ApiRecord = {}): Observable<StaffOsFinePenalty[]> {
    return this.api.list<StaffOsFinePenalty[]>('staff-os/fine-penalties', params);
  }

  createFinePenalty(payload: ApiRecord): Observable<StaffOsFinePenalty> {
    return this.api.post<StaffOsFinePenalty>('staff-os/fine-penalties', payload);
  }

  updateFinePenalty(id: string, payload: ApiRecord): Observable<StaffOsFinePenalty> {
    return this.api.patch<StaffOsFinePenalty>(`staff-os/fine-penalties/${id}`, payload);
  }

  updateFinePenaltyStatus(id: string, payload: ApiRecord): Observable<StaffOsFinePenalty> {
    return this.api.patch<StaffOsFinePenalty>(`staff-os/fine-penalties/${id}/status`, payload);
  }

  allowanceDeductions(params: ApiRecord = {}): Observable<StaffOsAllowanceDeduction[]> {
    return this.api.list<StaffOsAllowanceDeduction[]>('staff-os/allowance-deductions', params);
  }

  createAllowanceDeduction(payload: ApiRecord): Observable<StaffOsAllowanceDeduction> {
    return this.api.post<StaffOsAllowanceDeduction>('staff-os/allowance-deductions', payload);
  }

  updateAllowanceDeduction(id: string, payload: ApiRecord): Observable<StaffOsAllowanceDeduction> {
    return this.api.patch<StaffOsAllowanceDeduction>(`staff-os/allowance-deductions/${id}`, payload);
  }

  updateAllowanceDeductionStatus(id: string, payload: ApiRecord): Observable<StaffOsAllowanceDeduction> {
    return this.api.patch<StaffOsAllowanceDeduction>(`staff-os/allowance-deductions/${id}/status`, payload);
  }

  payrollStructures(params: ApiRecord = {}): Observable<StaffOsPayrollSalaryStructure[]> {
    return this.api.list<StaffOsPayrollSalaryStructure[]>('staff-os/payroll-structures', params);
  }

  savePayrollStructure(payload: ApiRecord): Observable<StaffOsPayrollSalaryStructure> {
    return this.api.post<StaffOsPayrollSalaryStructure>('staff-os/payroll-structures', payload);
  }

  updatePayrollStructure(id: string, payload: ApiRecord): Observable<StaffOsPayrollSalaryStructure> {
    return this.api.patch<StaffOsPayrollSalaryStructure>(`staff-os/payroll-structures/${id}`, payload);
  }

  updatePayrollStructureStatus(id: string, payload: ApiRecord): Observable<StaffOsPayrollSalaryStructure> {
    return this.api.patch<StaffOsPayrollSalaryStructure>(`staff-os/payroll-structures/${id}/status`, payload);
  }

  bulkEmployeeRows(params: ApiRecord = {}): Observable<StaffOsBulkEmployeeRow[]> {
    return this.api.list<StaffOsBulkEmployeeRow[]>('staff-os/bulk-employee-update', params);
  }

  applyBulkEmployeeUpdate(payload: ApiRecord): Observable<StaffOsBulkEmployeeUpdateJob> {
    return this.api.post<StaffOsBulkEmployeeUpdateJob>('staff-os/bulk-employee-update', payload);
  }

  schedules(params: ApiRecord = {}): Observable<StaffOsSchedule[]> {
    return this.api.list<StaffOsSchedule[]>('staff-os/schedules', params);
  }

  createSchedule(payload: ApiRecord): Observable<StaffOsSchedule> {
    return this.api.post<StaffOsSchedule>('staff-os/schedules', payload);
  }

  attendance(params: ApiRecord = {}): Observable<ApiRecord[]> {
    return this.api.list<ApiRecord[]>('staff-os/attendance', params);
  }

  clockIn(payload: ApiRecord): Observable<ApiRecord> {
    return this.api.post<ApiRecord>('staff-os/attendance/clock-in', payload);
  }

  clockOut(payload: ApiRecord): Observable<ApiRecord> {
    return this.api.post<ApiRecord>('staff-os/attendance/clock-out', payload);
  }

  leaves(params: ApiRecord = {}): Observable<ApiRecord[]> {
    return this.api.list<ApiRecord[]>('staff-os/leaves', params);
  }

  requestLeave(payload: ApiRecord): Observable<ApiRecord> {
    return this.api.post<ApiRecord>('staff-os/leaves', payload);
  }

  approveLeave(id: string, payload: ApiRecord): Observable<ApiRecord> {
    return this.api.patch<ApiRecord>(`staff-os/leaves/${id}/approve`, payload);
  }

  rejectLeave(id: string, payload: ApiRecord): Observable<ApiRecord> {
    return this.api.patch<ApiRecord>(`staff-os/leaves/${id}/reject`, payload);
  }

  leaveBalances(params: ApiRecord = {}): Observable<ApiRecord[]> {
    return this.api.list<ApiRecord[]>('staff-os/leave-balances', params);
  }

  biometricDevices(params: ApiRecord = {}): Observable<ApiRecord[]> {
    return this.api.list<ApiRecord[]>('staff-os/biometric/devices', params);
  }

  registerBiometricDevice(payload: ApiRecord): Observable<ApiRecord> {
    return this.api.post<ApiRecord>('staff-os/biometric/devices', payload);
  }

  biometricMappings(params: ApiRecord = {}): Observable<ApiRecord[]> {
    return this.api.list<ApiRecord[]>('staff-os/biometric/mappings', params);
  }

  createBiometricMapping(payload: ApiRecord): Observable<ApiRecord> {
    return this.api.post<ApiRecord>('staff-os/biometric/mappings', payload);
  }

  approveBiometricMapping(id: string, payload: ApiRecord): Observable<ApiRecord> {
    return this.api.patch<ApiRecord>(`staff-os/biometric/mappings/${id}/approve`, payload);
  }

  processBiometricQueue(payload: ApiRecord): Observable<ApiRecord> {
    return this.api.post<ApiRecord>('staff-os/biometric/process-queue', payload);
  }

  biometricConsents(params: ApiRecord = {}): Observable<ApiRecord[]> {
    return this.api.list<ApiRecord[]>('staff-os/biometric/consents', params);
  }

  upsertBiometricConsent(payload: ApiRecord): Observable<ApiRecord> {
    return this.api.post<ApiRecord>('staff-os/biometric/consents', payload);
  }

  requestBiometricConsentDeletion(id: string, payload: ApiRecord): Observable<ApiRecord> {
    return this.api.patch<ApiRecord>(`staff-os/biometric/consents/${id}/delete-request`, payload);
  }

  gatewayManifest(params: ApiRecord = {}): Observable<ApiRecord> {
    return this.api.list<ApiRecord>('staff-os/biometric/gateway/manifest', params);
  }

  registerGateway(payload: ApiRecord): Observable<ApiRecord> {
    return this.api.post<ApiRecord>('staff-os/biometric/gateway/register', payload);
  }

  gatewayHeartbeat(id: string, payload: ApiRecord): Observable<ApiRecord> {
    return this.api.post<ApiRecord>(`staff-os/biometric/gateway/${id}/heartbeat`, payload);
  }

  biometricCenter(params: ApiRecord = {}): Observable<ApiRecord> {
    return this.api.list<ApiRecord>('staff-os/attendance/biometric-center', params);
  }

  cameraPunch(payload: ApiRecord): Observable<ApiRecord> {
    return this.api.post<ApiRecord>('staff-os/attendance/camera-punch', payload);
  }

  attendanceRisks(params: ApiRecord = {}): Observable<ApiRecord[]> {
    return this.api.list<ApiRecord[]>('staff-os/attendance/risks', params);
  }

  runAttendanceFraudScan(payload: ApiRecord): Observable<ApiRecord> {
    return this.api.post<ApiRecord>('staff-os/attendance/fraud-scan', payload);
  }

  attendancePayrollPreview(params: ApiRecord = {}): Observable<ApiRecord[]> {
    return this.api.list<ApiRecord[]>('staff-os/attendance/payroll-preview', params);
  }

  generateAttendancePayrollPreview(payload: ApiRecord): Observable<ApiRecord> {
    return this.api.post<ApiRecord>('staff-os/attendance/payroll-preview', payload);
  }

  ownerAlerts(params: ApiRecord = {}): Observable<ApiRecord[]> {
    return this.api.list<ApiRecord[]>('staff-os/owner-alerts', params);
  }

  performance(params: ApiRecord = {}): Observable<StaffOsPerformanceResponse> {
    return this.api.list<StaffOsPerformanceResponse>('staff-os/performance', params);
  }

  burnoutRisk(params: ApiRecord = {}): Observable<StaffOsRiskScore[]> {
    return this.api.list<StaffOsRiskScore[]>('staff-os/intelligence/burnout-risk', params);
  }

  tasks(params: ApiRecord = {}): Observable<StaffOsTask[]> {
    return this.api.list<StaffOsTask[]>('staff-os/tasks', params);
  }

  createTask(payload: ApiRecord): Observable<StaffOsTask> {
    return this.api.post<StaffOsTask>('staff-os/tasks', payload);
  }

  updateTask(id: string, payload: ApiRecord): Observable<StaffOsTask> {
    return this.api.patch<StaffOsTask>(`staff-os/tasks/${id}`, payload);
  }

  payrollRuns(params: ApiRecord = {}): Observable<ApiRecord[]> {
    return this.api.list<ApiRecord[]>('staff-os/payroll', params);
  }

  generatePayroll(payload: ApiRecord): Observable<ApiRecord> {
    return this.api.post<ApiRecord>('staff-os/payroll/generate', payload);
  }

  staffSalesReport(params: ApiRecord = {}): Observable<ApiRecord> {
    return this.api.report<ApiRecord>('staff-sales', params);
  }

  payrollComplianceSummary(params: ApiRecord = {}): Observable<ApiRecord> {
    return this.api.list<ApiRecord>('staff-os/payroll-compliance/summary', params);
  }

  mobileConflicts(params: ApiRecord = {}): Observable<ApiRecord[]> {
    return this.api.list<ApiRecord[]>('staff-os/mobile/conflicts', params);
  }
}
