import { CommonModule } from '@angular/common';
import { Component, Input, OnChanges, OnInit, SimpleChanges, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { DatePickerComponent } from '../../../shared/date-picker/date-picker.component';
import { ApiEnvelope, ApiService } from '../../../shared/services/api.service';

type SetupSection = 'structure' | 'adjustments' | 'incentives' | 'statutory' | 'revisions' | 'advances' | 'overtime' | 'period' | 'notifications';
type DrawerMode = SetupSection | 'revisionDecision' | 'advanceAction' | 'recoveries' | null;
type StaffOption = { id: string; firstName: string; lastName: string; appointmentDisplayName: string };
type JsonMap = Record<string, unknown>;

type PayrollStructure = {
  id: string; name: string; providentFund: JsonMap; professionalTax: JsonMap; esic: JsonMap; tds: JsonMap;
  notes?: string | null; active: boolean; version: number;
};
type AdjustmentRule = {
  id: string; kind: string; name: string; amountPaise: number; triggerType: string; triggerCount: number;
  applicationMode: string; autoApply: boolean; notes?: string | null; active: boolean; version: number;
};
type IncentiveSlab = {
  fromPaise: number; toPaise?: number | null; incentiveBasisPoints: number; incentivePaise: number;
  employeeBasisPoints?: number | null; employeePaise?: number | null;
};
type IncentiveRule = {
  id: string; targetType: string; assigneeType: string; assigneeId?: string | null; assigneeName?: string | null;
  roleScope: string; slabs: IncentiveSlab[]; notes?: string | null; active: boolean; version: number;
};
type StatutoryRule = {
  id: string; ruleType: string; stateCode?: string | null; ruleJson: JsonMap; effectiveFrom: string;
  effectiveTo?: string | null; jurisdictionCode: string; roundingMethod: string; officialReference: string;
  active: boolean; approvalStatus: string; createdBy: string; approvedBy?: string | null; reviewNote: string; version: number;
};
type SalaryRevision = {
  id: string; staffId: string; rateType: string; oldAmountPaise?: number | null; newAmountPaise: number;
  effectiveDate: string; reason?: string | null; status: string; reviewNote?: string | null; version: number;
};
type SalaryAdvance = {
  id: string; staffId: string; requestedAmountPaise: number; approvedAmountPaise?: number | null;
  disbursedAmountPaise?: number | null; outstandingPaise: number; installmentCount: number;
  recoveryStartPeriod: string; reason: string; status: string; version: number;
};
type AdvanceRecovery = {
  id: string; periodStart: string; periodEnd: string; scheduledPaise: number; recoveredPaise: number;
  carriedForwardPaise: number; outstandingAfterPaise: number; applied: boolean;
};
type NotificationPreference = {
  whatsappOptIn: boolean; allowPayrollAmounts: boolean; languageCode: string; quietHoursStart?: string | null;
  quietHoursEnd?: string | null; version?: number | null;
};
type OvertimeApproval = {
  id: string; staffId: string; businessDate: string; overtimeMinutes: number; otApprovalStatus: string;
  approvedOvertimeMinutes: number; otApprovedBy?: string | null; otApprovedAt?: string | null;
};
type PayrollPeriod = {
  id: string; periodMonth: string; cutoffDate?: string | null; correctionDeadline?: string | null; status: string;
  lockReason: string; lockedBy?: string | null; lockedAt?: string | null; reopenReason: string;
  reopenedBy?: string | null; reopenedAt?: string | null;
};
type SlabForm = { from: string; to: string; percent: string; fixed: string; employeePercent: string; employeeFixed: string };

@Component({
  selector: 'staff-payroll-setup',
  imports: [CommonModule, FormsModule, DatePickerComponent],
  templateUrl: './staff-payroll-setup.component.html',
  styleUrls: ['./staff-payroll-setup.component.css'],
})
export class StaffPayrollSetupComponent implements OnInit, OnChanges {
  private readonly api = inject(ApiService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  @Input() staff: StaffOption[] = [];
  @Input() year = new Date().getFullYear();
  @Input() month = new Date().getMonth() + 1;
  @Input() initialSection: SetupSection = 'structure';
  @Input() createAdjustment = false;
  @Input() initialAdjustmentKind: 'fine' | 'allowance' | 'deduction' = 'deduction';

  readonly sections: Array<{ key: SetupSection; label: string }> = [
    { key: 'structure', label: 'Payroll Structure' },
    { key: 'adjustments', label: 'Fine / Allowance / Deduction' },
    { key: 'incentives', label: 'Incentive Slabs' },
    { key: 'statutory', label: 'Statutory Rules' },
    { key: 'revisions', label: 'Salary Revisions' },
    { key: 'advances', label: 'Salary Advances' },
    { key: 'overtime', label: 'Overtime Approvals' },
    { key: 'period', label: 'Period Controls' },
    { key: 'notifications', label: 'Notification Preferences' },
  ];
  readonly months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  readonly years = Array.from({ length: 7 }, (_, index) => new Date().getFullYear() - 3 + index);
  readonly triggerTypes = [
    'manual', 'late_count', 'absent_day', 'half_day', 'short_hours', 'no_clock_out',
    'weekend_penalty', 'sandwich_penalty', 'unpaid_week_off', 'fixed', 'weekly_off_worked',
  ];
  readonly statutoryTypes = ['provident_fund', 'esic', 'professional_tax', 'tds', 'gratuity', 'bonus'];

  activeSection: SetupSection = 'structure';
  drawer: DrawerMode = null;
  loading = false;
  saving = false;
  error = '';
  success = '';

  structure: PayrollStructure | null = null;
  adjustments: AdjustmentRule[] = [];
  incentives: IncentiveRule[] = [];
  statutoryRules: StatutoryRule[] = [];
  revisions: SalaryRevision[] = [];
  advances: SalaryAdvance[] = [];
  overtimeApprovals: OvertimeApproval[] = [];
  payrollPeriods: PayrollPeriod[] = [];
  recoveries: AdvanceRecovery[] = [];
  notificationStaffId = '';
  notificationPreference: NotificationPreference | null = null;

  selectedAdjustment: AdjustmentRule | null = null;
  selectedIncentive: IncentiveRule | null = null;
  selectedRevision: SalaryRevision | null = null;
  selectedAdvance: SalaryAdvance | null = null;
  selectedOvertime: OvertimeApproval | null = null;

  selectedYear = this.year;
  selectedMonth = this.month;
  overtimeStatus = 'pending';
  overtimeStaffId = '';

  structureForm = { name: '', notes: '', active: true };
  adjustmentForm = { kind: 'deduction', name: '', amount: '', triggerType: 'manual', triggerCount: '', applicationMode: 'fixed', autoApply: false, notes: '', active: true };
  incentiveForm: { targetType: string; assigneeType: string; assigneeId: string; roleScope: string; notes: string; active: boolean; slabs: SlabForm[] } = {
    targetType: 'service', assigneeType: 'standard', assigneeId: '', roleScope: 'all', notes: '', active: true, slabs: [],
  };
  statutoryForm = { ruleType: 'provident_fund', stateCode: '', jurisdictionCode: '', roundingMethod: '', officialReference: '', effectiveFrom: '', effectiveTo: '', employeePercent: '', employerPercent: '', accrualPercent: '', employeeFixed: '', employerFixed: '', accrualFixed: '', wageCap: '', eligibilityCap: '' };
  revisionForm = { staffId: '', rateType: 'monthly', amount: '', effectiveDate: '', reason: '' };
  revisionDecisionForm = { decision: 'approved', comments: '' };
  advanceForm = { staffId: '', amount: '', installmentCount: '', recoveryStartPeriod: '', reason: '' };
  advanceActionForm = { action: 'decision', decision: 'approved', approvedAmount: '', note: '', paymentMethod: 'bank_transfer', reference: '', mfaCode: '', reason: '' };
  notificationForm = { whatsappOptIn: false, allowPayrollAmounts: false, languageCode: 'en-IN', quietHoursStart: '', quietHoursEnd: '' };
  overtimeForm = { decision: 'approved', approvedMinutes: '' };
  periodForm = { action: 'schedule', cutoffDate: '', correctionDeadline: '', reason: '' };

  ngOnInit() {
    this.selectedYear = this.year;
    this.selectedMonth = this.month;
    this.activeSection = this.initialSection;
    void this.initialize();
  }

  ngOnChanges(changes: SimpleChanges) {
    if (changes['staff'] && this.activeSection === 'notifications' && !this.notificationStaffId && this.staff.length) {
      void this.loadSection('notifications');
    }
  }

  private async initialize() {
    await this.loadSection(this.activeSection);
    if (this.createAdjustment && this.activeSection === 'adjustments') {
      this.openAdjustment();
      this.adjustmentForm.kind = this.initialAdjustmentKind;
    }
  }

  async selectSection(section: SetupSection) {
    this.activeSection = section;
    this.clearMessages();
    await this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { tab: 'setup', section },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
    await this.loadSection(section);
  }

  async refresh() { await this.loadSection(this.activeSection); }

  async loadSection(section: SetupSection) {
    this.loading = true;
    this.error = '';
    try {
      if (section === 'structure') this.structure = await this.get<PayrollStructure | null>('/staff/payroll-structure');
      if (section === 'adjustments') this.adjustments = await this.get<AdjustmentRule[]>('/staff/payroll-adjustment-rules');
      if (section === 'incentives') this.incentives = await this.get<IncentiveRule[]>('/staff/incentive-rules');
      if (section === 'statutory') this.statutoryRules = await this.get<StatutoryRule[]>('/staff/payroll-compliance/rules');
      if (section === 'revisions') this.revisions = await this.get<SalaryRevision[]>('/staff/salary-revisions');
      if (section === 'advances') this.advances = await this.get<SalaryAdvance[]>('/staff-advances');
      if (section === 'overtime') {
        const [, periods] = await Promise.all([this.loadOvertime(), this.get<PayrollPeriod[]>('/staff-payroll/periods')]);
        this.payrollPeriods = periods;
      }
      if (section === 'period') this.payrollPeriods = await this.get<PayrollPeriod[]>('/staff-payroll/periods');
      if (section === 'notifications') {
        this.ensureNotificationStaff();
        if (this.notificationStaffId) await this.loadNotificationPreference();
      }
    } catch (error) {
      this.error = this.errorMessage(error, 'Unable to load payroll setup');
    } finally {
      this.loading = false;
    }
  }

  private ensureNotificationStaff() {
    if (!this.notificationStaffId && this.staff.length) this.notificationStaffId = this.staff[0].id;
  }

  openStructure() {
    this.structureForm = { name: this.structure?.name ?? '', notes: this.structure?.notes ?? '', active: this.structure?.active ?? true };
    this.drawer = 'structure';
  }

  async saveStructure() {
    if (!this.structureForm.name.trim()) return this.formError('Structure name is required');
    await this.mutate('Payroll structure saved', () => firstValueFrom(this.api.put('/staff/payroll-structure', {
      name: this.titleCase(this.structureForm.name).trim(),
      providentFund: this.structure?.providentFund ?? {}, professionalTax: this.structure?.professionalTax ?? {},
      esic: this.structure?.esic ?? {}, tds: this.structure?.tds ?? {}, notes: this.optional(this.structureForm.notes),
      active: this.structureForm.active, version: this.structure?.version,
    })), 'structure');
  }

  openAdjustment(rule: AdjustmentRule | null = null) {
    this.selectedAdjustment = rule;
    this.adjustmentForm = {
      kind: rule?.kind ?? 'deduction', name: rule?.name ?? '', amount: this.rupees(rule?.amountPaise),
      triggerType: rule?.triggerType ?? 'manual', triggerCount: rule?.triggerCount ? String(rule.triggerCount) : '',
      applicationMode: rule?.applicationMode ?? 'fixed', autoApply: rule?.autoApply ?? false,
      notes: rule?.notes ?? '', active: rule?.active ?? true,
    };
    this.drawer = 'adjustments';
  }

  async saveAdjustment() {
    if (!this.adjustmentForm.name.trim()) return this.formError('Rule name is required');
    if (this.paise(this.adjustmentForm.amount) <= 0) return this.formError('Rule amount must be greater than zero');
    if (this.integer(this.adjustmentForm.triggerCount) < 1) return this.formError('Trigger count must be at least one');
    if (this.adjustmentForm.triggerType === 'weekly_off_worked' && this.adjustmentForm.kind !== 'allowance') {
      return this.formError('Weekly-off-worked rules must be allowances');
    }
    const body = {
      kind: this.adjustmentForm.kind, name: this.titleCase(this.adjustmentForm.name).trim(), amountPaise: this.paise(this.adjustmentForm.amount),
      triggerType: this.adjustmentForm.triggerType, triggerCount: this.integer(this.adjustmentForm.triggerCount),
      applicationMode: this.adjustmentForm.applicationMode, autoApply: this.adjustmentForm.autoApply,
      notes: this.optional(this.adjustmentForm.notes), active: this.adjustmentForm.active,
      version: this.selectedAdjustment?.version,
    };
    const request = this.selectedAdjustment
      ? () => firstValueFrom(this.api.patch(`/staff/payroll-adjustment-rules/${this.selectedAdjustment!.id}`, body))
      : () => firstValueFrom(this.api.post('/staff/payroll-adjustment-rules', body));
    await this.mutate('Adjustment rule saved', request, 'adjustments');
  }

  adjustmentTriggerChanged(triggerType: string) {
    this.adjustmentForm.triggerType = triggerType;
    if (triggerType === 'weekly_off_worked') this.adjustmentForm.kind = 'allowance';
    if (['weekend_penalty', 'sandwich_penalty', 'unpaid_week_off'].includes(triggerType) && this.adjustmentForm.kind === 'allowance') {
      this.adjustmentForm.kind = 'deduction';
    }
  }

  openIncentive(rule: IncentiveRule | null = null) {
    this.selectedIncentive = rule;
    this.incentiveForm = {
      targetType: rule?.targetType ?? 'service', assigneeType: rule?.assigneeType ?? 'standard', assigneeId: rule?.assigneeId ?? '',
      roleScope: rule?.roleScope ?? 'all', notes: rule?.notes ?? '', active: rule?.active ?? true,
      slabs: rule?.slabs?.map((slab) => ({
        from: this.rupees(slab.fromPaise), to: this.rupees(slab.toPaise), percent: this.percent(slab.incentiveBasisPoints),
        fixed: this.rupees(slab.incentivePaise), employeePercent: this.percent(slab.employeeBasisPoints), employeeFixed: this.rupees(slab.employeePaise),
      })) ?? [this.emptySlab()],
    };
    this.drawer = 'incentives';
  }

  addSlab() { this.incentiveForm.slabs.push(this.emptySlab()); }
  removeSlab(index: number) { if (this.incentiveForm.slabs.length > 1) this.incentiveForm.slabs.splice(index, 1); }

  async saveIncentive() {
    if (!this.incentiveForm.slabs.length) return this.formError('At least one incentive slab is required');
    if (this.incentiveForm.assigneeType === 'staff' && !this.incentiveForm.assigneeId) return this.formError('Staff is required');
    const assignee = this.staff.find((row) => row.id === this.incentiveForm.assigneeId);
    const body = {
      targetType: this.incentiveForm.targetType, assigneeType: this.incentiveForm.assigneeType,
      assigneeId: this.incentiveForm.assigneeType === 'staff' ? this.incentiveForm.assigneeId : null,
      assigneeName: assignee ? this.staffName(assignee) : null, roleScope: this.incentiveForm.roleScope,
      slabs: this.incentiveForm.slabs.map((slab) => ({
        fromPaise: this.paise(slab.from), toPaise: this.optionalPaise(slab.to), incentiveBasisPoints: this.basisPoints(slab.percent),
        incentivePaise: this.paise(slab.fixed), employeeBasisPoints: this.optionalBasisPoints(slab.employeePercent), employeePaise: this.optionalPaise(slab.employeeFixed),
      })),
      notes: this.optional(this.incentiveForm.notes), active: this.incentiveForm.active, version: this.selectedIncentive?.version,
    };
    const request = this.selectedIncentive
      ? () => firstValueFrom(this.api.patch(`/staff/incentive-rules/${this.selectedIncentive!.id}`, body))
      : () => firstValueFrom(this.api.post('/staff/incentive-rules', body));
    await this.mutate('Incentive rule saved', request, 'incentives');
  }

  openStatutory() {
    this.statutoryForm = { ruleType: 'provident_fund', stateCode: '', jurisdictionCode: '', roundingMethod: '', officialReference: '', effectiveFrom: '', effectiveTo: '', employeePercent: '', employerPercent: '', accrualPercent: '', employeeFixed: '', employerFixed: '', accrualFixed: '', wageCap: '', eligibilityCap: '' };
    this.drawer = 'statutory';
  }

  async saveStatutory() {
    if (!this.statutoryForm.effectiveFrom || !this.statutoryForm.jurisdictionCode.trim() || !this.statutoryForm.roundingMethod || !this.statutoryForm.officialReference.trim()) return this.formError('Jurisdiction, rounding, official reference and effective date are required');
    const rule: JsonMap = {};
    this.addOptional(rule, 'employeeBasisPoints', this.optionalBasisPoints(this.statutoryForm.employeePercent));
    this.addOptional(rule, 'employerBasisPoints', this.optionalBasisPoints(this.statutoryForm.employerPercent));
    this.addOptional(rule, 'accrualBasisPoints', this.optionalBasisPoints(this.statutoryForm.accrualPercent));
    this.addOptional(rule, 'employeeFixedPaise', this.optionalPaise(this.statutoryForm.employeeFixed));
    this.addOptional(rule, 'employerFixedPaise', this.optionalPaise(this.statutoryForm.employerFixed));
    this.addOptional(rule, 'accrualFixedPaise', this.optionalPaise(this.statutoryForm.accrualFixed));
    this.addOptional(rule, 'wageCapPaise', this.optionalPaise(this.statutoryForm.wageCap));
    this.addOptional(rule, 'eligibilityCapPaise', this.optionalPaise(this.statutoryForm.eligibilityCap));
    if (!Object.keys(rule).length) return this.formError('Enter at least one rate or fixed amount');
    await this.mutate('Statutory rule submitted for approval', () => firstValueFrom(this.api.post('/staff/payroll-compliance/rules', {
      ruleType: this.statutoryForm.ruleType, stateCode: this.optional(this.statutoryForm.stateCode), jurisdictionCode: this.statutoryForm.jurisdictionCode.trim().toUpperCase(), roundingMethod: this.statutoryForm.roundingMethod, officialReference: this.statutoryForm.officialReference.trim(), rule,
      effectiveFrom: this.statutoryForm.effectiveFrom, effectiveTo: this.optional(this.statutoryForm.effectiveTo),
    })), 'statutory');
  }

  async decideStatutory(rule: StatutoryRule, decision: 'approved' | 'rejected') {
    const comments = decision === 'rejected' ? window.prompt('Rejection reason') : '';
    if (comments === null || (decision === 'rejected' && !comments.trim())) return;
    await this.mutate(`Statutory rule ${decision}`, () => firstValueFrom(this.api.post(`/staff/payroll-compliance/rules/${rule.id}/decision`, { decision, version: rule.version, comments })), 'statutory', false);
  }

  openRevision() {
    this.revisionForm = { staffId: '', rateType: 'monthly', amount: '', effectiveDate: '', reason: '' };
    this.drawer = 'revisions';
  }

  async saveRevision() {
    if (!this.revisionForm.staffId || !this.revisionForm.effectiveDate || this.paise(this.revisionForm.amount) <= 0) {
      return this.formError('Staff, positive amount and effective date are required');
    }
    await this.mutate('Salary revision requested', () => firstValueFrom(this.api.post(`/staff/${this.revisionForm.staffId}/salary-revisions`, {
      rateType: this.revisionForm.rateType, newAmountPaise: this.paise(this.revisionForm.amount),
      effectiveDate: this.revisionForm.effectiveDate, reason: this.optional(this.revisionForm.reason),
    })), 'revisions');
  }

  openRevisionDecision(revision: SalaryRevision) {
    this.selectedRevision = revision;
    this.revisionDecisionForm = { decision: 'approved', comments: '' };
    this.drawer = 'revisionDecision';
  }

  async saveRevisionDecision() {
    if (!this.selectedRevision) return;
    await this.mutate('Salary revision updated', () => firstValueFrom(this.api.post(`/staff/salary-revisions/${this.selectedRevision!.id}/decision`, {
      decision: this.revisionDecisionForm.decision, version: this.selectedRevision!.version,
      comments: this.optional(this.revisionDecisionForm.comments),
    })), 'revisions');
  }

  openAdvance() {
    this.advanceForm = { staffId: '', amount: '', installmentCount: '', recoveryStartPeriod: '', reason: '' };
    this.drawer = 'advances';
  }

  async saveAdvance() {
    if (!this.advanceForm.staffId || !this.advanceForm.recoveryStartPeriod || !this.advanceForm.reason.trim() || this.paise(this.advanceForm.amount) <= 0 || this.integer(this.advanceForm.installmentCount) <= 0) {
      return this.formError('Staff, amount, installments, recovery period and reason are required');
    }
    await this.mutate('Salary advance requested', () => firstValueFrom(this.api.post('/staff-advances', {
      staffId: this.advanceForm.staffId, requestedAmountPaise: this.paise(this.advanceForm.amount),
      installmentCount: this.integer(this.advanceForm.installmentCount), recoveryStartPeriod: this.advanceForm.recoveryStartPeriod,
      reason: this.advanceForm.reason.trim(),
    })), 'advances');
  }

  openAdvanceAction(advance: SalaryAdvance, action: string) {
    this.selectedAdvance = advance;
    this.advanceActionForm = { action, decision: 'approved', approvedAmount: this.rupees(advance.approvedAmountPaise ?? advance.requestedAmountPaise), note: '', paymentMethod: 'bank_transfer', reference: '', mfaCode: '', reason: '' };
    this.drawer = 'advanceAction';
  }

  async saveAdvanceAction() {
    const advance = this.selectedAdvance;
    if (!advance) return;
    const form = this.advanceActionForm;
    if (form.action === 'decision' && form.decision === 'approved' && this.paise(form.approvedAmount) <= 0) return this.formError('Approved amount must be positive');
    let path = `/staff-advances/${advance.id}/decision`;
    let body: JsonMap = { decision: form.decision, approvedAmountPaise: form.decision === 'approved' ? this.paise(form.approvedAmount) : null, note: this.optional(form.note), version: advance.version };
    if (form.action === 'cancel') {
      path = `/staff-advances/${advance.id}/cancel`;
      body = { version: advance.version, reason: this.optional(form.reason) };
    }
    if (form.action === 'disburse') {
      path = `/staff-advances/${advance.id}/disburse`;
      body = { version: advance.version, paymentMethod: form.paymentMethod, reference: this.optional(form.reference), idempotencyKey: crypto.randomUUID(), mfaCode: this.optional(form.mfaCode) };
    }
    if (form.action === 'waive') {
      if (!form.reason.trim()) return this.formError('Waiver reason is required');
      path = `/staff-advances/${advance.id}/waive`;
      body = { version: advance.version, reason: form.reason.trim(), mfaCode: this.optional(form.mfaCode) };
    }
    await this.mutate('Salary advance updated', () => firstValueFrom(this.api.post(path, body)), 'advances');
  }

  async openRecoveries(advance: SalaryAdvance) {
    this.selectedAdvance = advance;
    this.drawer = 'recoveries';
    this.recoveries = [];
    try {
      this.recoveries = await this.get<AdvanceRecovery[]>(`/staff-advances/${advance.id}/recoveries`);
    } catch (error) {
      this.error = this.errorMessage(error, 'Unable to load advance recoveries');
    }
  }

  async loadNotificationPreference() {
    if (!this.notificationStaffId) {
      this.notificationPreference = null;
      return;
    }
    try {
      this.notificationPreference = await this.get<NotificationPreference | null>(`/staff/${this.notificationStaffId}/notification-preferences`);
      const preference = this.notificationPreference;
      this.notificationForm = {
        whatsappOptIn: preference?.whatsappOptIn ?? false, allowPayrollAmounts: preference?.allowPayrollAmounts ?? false,
        languageCode: preference?.languageCode ?? 'en-IN', quietHoursStart: preference?.quietHoursStart?.slice(0, 5) ?? '',
        quietHoursEnd: preference?.quietHoursEnd?.slice(0, 5) ?? '',
      };
    } catch (error) {
      this.notificationPreference = null;
      this.error = this.errorMessage(error, 'Unable to load notification preferences');
    }
  }

  async saveNotificationPreference() {
    if (!this.notificationStaffId) return this.formError('Staff is required');
    if (Boolean(this.notificationForm.quietHoursStart) !== Boolean(this.notificationForm.quietHoursEnd)) return this.formError('Both quiet hours are required');
    await this.mutate('Notification preferences saved', () => firstValueFrom(this.api.put(`/staff/${this.notificationStaffId}/notification-preferences`, {
      whatsappOptIn: this.notificationForm.whatsappOptIn, allowPayrollAmounts: this.notificationForm.allowPayrollAmounts,
      languageCode: this.notificationForm.languageCode, quietHoursStart: this.optional(this.notificationForm.quietHoursStart),
      quietHoursEnd: this.optional(this.notificationForm.quietHoursEnd), version: this.notificationPreference?.version,
    })), 'notifications', false);
  }

  get currentPeriod() {
    return this.payrollPeriods.find((row) => row.periodMonth === this.periodMonth) ?? null;
  }

  async changeSetupPeriod() {
    if (this.activeSection === 'overtime' || this.activeSection === 'period') await this.loadSection(this.activeSection);
  }

  async loadOvertime() {
    const query = new URLSearchParams({ from: this.periodMonth, to: this.periodEnd });
    if (this.overtimeStatus) query.set('status', this.overtimeStatus);
    if (this.overtimeStaffId) query.set('staffId', this.overtimeStaffId);
    this.overtimeApprovals = await this.get<OvertimeApproval[]>(`/staff-attendance/overtime?${query}`);
  }

  openOvertime(row: OvertimeApproval) {
    this.selectedOvertime = row;
    this.overtimeForm = { decision: 'approved', approvedMinutes: String(row.overtimeMinutes) };
    this.drawer = 'overtime';
  }

  async saveOvertime() {
    const row = this.selectedOvertime;
    if (!row) return;
    const approvedMinutes = this.integer(this.overtimeForm.approvedMinutes);
    if (this.overtimeForm.decision === 'approved' && (approvedMinutes <= 0 || approvedMinutes > row.overtimeMinutes)) {
      return this.formError('Approved minutes must be between 1 and worked overtime minutes');
    }
    await this.mutate('Overtime decision saved', () => firstValueFrom(this.api.post(`/staff-attendance/overtime/${row.id}/decision`, {
      decision: this.overtimeForm.decision,
      approvedOvertimeMinutes: this.overtimeForm.decision === 'approved' ? approvedMinutes : null,
    })), 'overtime');
  }

  openPeriod(action: 'schedule' | 'lock' | 'reopen') {
    const period = this.currentPeriod;
    this.periodForm = {
      action, cutoffDate: period?.cutoffDate ?? '', correctionDeadline: period?.correctionDeadline ?? '', reason: '',
    };
    this.drawer = 'period';
  }

  async savePeriod() {
    const form = this.periodForm;
    if ((form.action === 'lock' || form.action === 'reopen') && !form.reason.trim()) return this.formError('Reason is required');
    let request: () => Promise<unknown>;
    if (form.action === 'schedule') {
      request = () => firstValueFrom(this.api.put('/staff-payroll/periods', {
        periodMonth: this.periodMonth, cutoffDate: this.optional(form.cutoffDate),
        correctionDeadline: this.optional(form.correctionDeadline),
      }));
    } else if (form.action === 'lock') {
      request = () => firstValueFrom(this.api.post('/staff-payroll/periods/lock', {
        periodMonth: this.periodMonth, reason: form.reason.trim(),
      }));
    } else {
      request = () => firstValueFrom(this.api.post(`/staff-payroll/periods/${this.periodMonth}/reopen`, { reason: form.reason.trim() }));
    }
    await this.mutate(`Payroll period ${form.action === 'schedule' ? 'schedule saved' : form.action === 'lock' ? 'locked' : 'reopened'}`, request, 'period');
  }

  closeDrawer() { if (!this.saving) this.drawer = null; }
  staffName(row: StaffOption) { return `${row.firstName || row.appointmentDisplayName || ''} ${row.lastName || ''}`.trim(); }
  nameForStaff(id: string) { const row = this.staff.find((item) => item.id === id); return row ? this.staffName(row) : id; }
  formatMoney(paise?: number | null) { return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format((paise ?? 0) / 100); }
  formatDate(value?: string | null) { const match = String(value ?? '').match(/^(\d{4})-(\d{2})-(\d{2})/); return match ? `${match[3]}/${match[2]}/${match[1]}` : '-'; }
  formatDateTime(value?: string | null) { return value ? new Date(value).toLocaleString('en-IN') : '-'; }
  label(value?: string | null) { return String(value ?? '').replaceAll('_', ' ').replace(/\b\w/g, (char) => char.toUpperCase()); }
  ruleSummary(rule: StatutoryRule) {
    return Object.entries(rule.ruleJson ?? {}).map(([key, value]) => `${this.label(key)}: ${value}`).join(' | ') || '-';
  }

  private get periodMonth() { return `${this.selectedYear}-${String(this.selectedMonth).padStart(2, '0')}-01`; }
  private get periodEnd() {
    const day = new Date(this.selectedYear, this.selectedMonth, 0).getDate();
    return `${this.selectedYear}-${String(this.selectedMonth).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }

  private async get<T>(path: string): Promise<T> {
    const response = await firstValueFrom(this.api.get<ApiEnvelope<T> | T>(path));
    return ((response as ApiEnvelope<T>)?.data ?? response) as T;
  }

  private async mutate(message: string, request: () => Promise<unknown>, section: SetupSection, close = true) {
    this.saving = true;
    this.clearMessages();
    try {
      await request();
      if (close) this.drawer = null;
      this.success = message;
      await this.loadSection(section);
    } catch (error) {
      this.error = this.errorMessage(error, 'Unable to save payroll setup');
    } finally {
      this.saving = false;
    }
  }

  private emptySlab(): SlabForm { return { from: '', to: '', percent: '', fixed: '', employeePercent: '', employeeFixed: '' }; }
  private rupees(paise?: number | null) { return paise == null ? '' : String(paise / 100); }
  private percent(basisPoints?: number | null) { return basisPoints == null ? '' : String(basisPoints / 100); }
  private paise(value: string) { const amount = Number(value); return Number.isFinite(amount) ? Math.round(amount * 100) : 0; }
  private optionalPaise(value: string) { return value.trim() ? this.paise(value) : null; }
  private basisPoints(value: string) { const amount = Number(value); return Number.isFinite(amount) ? Math.round(amount * 100) : 0; }
  private optionalBasisPoints(value: string) { return value.trim() ? this.basisPoints(value) : null; }
  private integer(value: string) { const amount = Number(value); return Number.isFinite(amount) ? Math.trunc(amount) : 0; }
  private optional(value: string) { return value.trim() || null; }
  private addOptional(target: JsonMap, key: string, value: number | null) { if (value != null) target[key] = value; }
  titleCase(value: string) { return value.toLowerCase().replace(/(^|\s)\S/g, (letter) => letter.toUpperCase()); }
  private clearMessages() { this.error = ''; this.success = ''; }
  private formError(message: string) { this.error = message; }
  private errorMessage(error: unknown, fallback: string) {
    const candidate = error as { error?: { error?: { message?: string }; message?: string }; message?: string };
    return candidate?.error?.error?.message ?? candidate?.error?.message ?? candidate?.message ?? fallback;
  }
}
