import { CommonModule } from '@angular/common';
import { Component, OnInit, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { ApiEnvelope, ApiService } from '../../../shared/services/api.service';
import { DatePickerComponent } from '../../../shared/date-picker/date-picker.component';

type SetupTab =
  | 'structure'
  | 'rules'
  | 'incentives'
  | 'statutory'
  | 'revisions'
  | 'advances'
  | 'notifications';

type StaffOption = { id: string; firstName: string; lastName: string; appointmentDisplayName: string };
type StaffListPage = { items: StaffOption[] };

type PayrollStructureRecord = {
  id: string;
  name: string;
  providentFund: unknown;
  professionalTax: unknown;
  esic: unknown;
  tds: unknown;
  notes: string;
  active: boolean;
  version: number;
};

type PayrollAdjustmentRuleRecord = {
  id: string;
  kind: string;
  name: string;
  amountPaise: number;
  triggerType: string;
  triggerCount: number;
  applicationMode: string;
  autoApply: boolean;
  notes: string;
  active: boolean;
  version: number;
};

type IncentiveSlab = {
  fromPaise: number;
  toPaise: number | null;
  incentiveBasisPoints: number;
  incentivePaise: number;
  employeeBasisPoints: number | null;
  employeePaise: number | null;
};

type IncentiveRuleRecord = {
  id: string;
  targetType: string;
  assigneeType: string;
  assigneeId: string | null;
  assigneeName: string | null;
  roleScope: string;
  slabs: IncentiveSlab[];
  notes: string;
  active: boolean;
  version: number;
};

type StatutoryRuleRecord = {
  id: string;
  ruleType: string;
  stateCode: string;
  ruleJson: {
    employeeBasisPoints?: number;
    employerBasisPoints?: number;
    employeeFixedPaise?: number;
    employerFixedPaise?: number;
    wageCapPaise?: number;
    eligibilityCapPaise?: number;
  };
  effectiveFrom: string;
  effectiveTo: string | null;
  active: boolean;
  version: number;
};

type SalaryRevisionRecord = {
  id: string;
  staffId: string;
  rateType: string;
  oldAmountPaise: number | null;
  newAmountPaise: number;
  effectiveDate: string;
  reason: string;
  status: string;
  version: number;
};

type StaffAdvanceRecord = {
  id: string;
  staffId: string;
  requestedAmountPaise: number;
  approvedAmountPaise: number | null;
  disbursedAmountPaise: number;
  outstandingPaise: number;
  installmentCount: number;
  installmentAmountPaise: number;
  recoveryStartPeriod: string;
  reason: string;
  status: string;
  version: number;
};

type NotificationPreferenceRecord = {
  id: string;
  staffId: string;
  whatsappOptIn: boolean;
  allowPayrollAmounts: boolean;
  languageCode: string;
  quietHoursStart: string | null;
  quietHoursEnd: string | null;
  version: number;
};

@Component({
  selector: 'page-staff-payroll-setup',
  imports: [CommonModule, FormsModule, DatePickerComponent],
  templateUrl: './staff-payroll-setup-page.component.html',
  styleUrls: ['./staff-payroll-setup-page.component.css'],
})
export class StaffPayrollSetupPageComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly router = inject(Router);

  readonly tabs: Array<{ key: SetupTab; label: string; icon: string }> = [
    { key: 'structure', label: 'Payroll Structure', icon: 'bi-diagram-3' },
    { key: 'rules', label: 'Fine / Allowance / Deduction Rules', icon: 'bi-exclamation-triangle' },
    { key: 'incentives', label: 'Incentive Slabs', icon: 'bi-graph-up-arrow' },
    { key: 'statutory', label: 'Statutory Rules', icon: 'bi-bank' },
    { key: 'revisions', label: 'Salary Revisions', icon: 'bi-arrow-up-circle' },
    { key: 'advances', label: 'Salary Advances', icon: 'bi-arrow-repeat' },
    { key: 'notifications', label: 'Notification Preferences', icon: 'bi-bell' },
  ];
  activeTab: SetupTab = 'structure';
  loading = false;
  error = '';
  success = '';

  staff: StaffOption[] = [];

  // Payroll structure
  structure: PayrollStructureRecord | null = null;
  structureForm = { name: '', providentFund: '{}', professionalTax: '{}', esic: '{}', tds: '{}', notes: '', active: true };

  // Adjustment rules
  rules: PayrollAdjustmentRuleRecord[] = [];
  ruleForm = {
    kind: 'fine',
    name: '',
    amount: '',
    triggerType: 'fixed',
    triggerCount: '',
    applicationMode: 'per_occurrence',
    autoApply: true,
  };
  readonly ruleTriggerTypes = [
    'manual',
    'late_count',
    'absent_day',
    'half_day',
    'short_hours',
    'no_clock_out',
    'weekend_penalty',
    'sandwich_penalty',
    'unpaid_week_off',
    'fixed',
    'weekly_off_worked',
  ];

  // Incentive slabs
  incentives: IncentiveRuleRecord[] = [];
  incentiveForm: {
    targetType: string;
    assigneeType: string;
    assigneeId: string;
    roleScope: string;
    notes: string;
    slabs: Array<{
      from: string;
      to: string;
      incentiveBasisPoints: string;
      incentivePaise: string;
      employeeBasisPoints: string;
      employeePaise: string;
    }>;
  } = {
    targetType: 'sales',
    assigneeType: 'staff',
    assigneeId: '',
    roleScope: '',
    notes: '',
    slabs: [{ from: '', to: '', incentiveBasisPoints: '', incentivePaise: '', employeeBasisPoints: '', employeePaise: '' }],
  };

  // Statutory rules
  statutoryRules: StatutoryRuleRecord[] = [];
  statutoryForm = {
    ruleType: 'provident_fund',
    stateCode: '',
    employeeBasisPoints: '',
    employerBasisPoints: '',
    employeeFixedPaise: '',
    employerFixedPaise: '',
    wageCapPaise: '',
    eligibilityCapPaise: '',
    effectiveFrom: '',
    effectiveTo: '',
    roundingMethod: 'floor',
    officialReference: '',
    approvedBy: '',
  };

  // Salary revisions
  revisions: SalaryRevisionRecord[] = [];
  revisionStaffId = '';
  revisionForm = { rateType: 'monthly', newAmount: '', effectiveDate: '', reason: '' };
  revisionDecisionNotes: Record<string, string> = {};

  // Salary advances
  advances: StaffAdvanceRecord[] = [];
  advanceForm = { staffId: '', requestedAmount: '', installmentCount: '1', recoveryStartPeriod: '', reason: '' };
  advanceDecisionNotes: Record<string, string> = {};
  advanceDisbursement: Record<string, { method: string; reference: string }> = {};

  disbursementFor(advanceId: string): { method: string; reference: string } {
    if (!this.advanceDisbursement[advanceId]) {
      this.advanceDisbursement[advanceId] = { method: 'bank', reference: '' };
    }
    return this.advanceDisbursement[advanceId];
  }
  advanceWaiverReason: Record<string, string> = {};

  // Notification preferences
  notificationStaffId = '';
  preference: NotificationPreferenceRecord | null = null;
  preferenceForm = {
    whatsappOptIn: false,
    allowPayrollAmounts: false,
    languageCode: 'en-IN',
    quietHoursStart: '',
    quietHoursEnd: '',
  };

  async ngOnInit() {
    await this.loadStaff();
    await this.loadForTab(this.activeTab);
  }

  backToPayroll() {
    void this.router.navigate(['/staff/payroll']);
  }

  async selectTab(tab: SetupTab) {
    this.activeTab = tab;
    this.error = '';
    this.success = '';
    await this.loadForTab(tab);
  }

  private async loadForTab(tab: SetupTab) {
    switch (tab) {
      case 'structure':
        return this.loadStructure();
      case 'rules':
        return this.loadRules();
      case 'incentives':
        return this.loadIncentives();
      case 'statutory':
        return this.loadStatutoryRules();
      case 'revisions':
        return this.loadRevisions();
      case 'advances':
        return this.loadAdvances();
      case 'notifications':
        return this.loadPreference();
    }
  }

  private unwrap<T>(result: ApiEnvelope<T>, fallback: string): T {
    if (!result.success || result.data === undefined) {
      throw new Error((result.error && (result.error.message || result.error)) || fallback);
    }
    return result.data;
  }

  private toPaise(value: string | undefined | null): number {
    if (!value?.trim()) return 0;
    const amount = Number(value);
    return Number.isFinite(amount) ? Math.round(amount * 100) : 0;
  }

  private toPaiseOrNull(value: string | undefined | null): number | null {
    if (!value?.trim()) return null;
    return this.toPaise(value);
  }

  paiseText(value: number | null | undefined): string {
    const amount = value ?? 0;
    return (amount / 100).toFixed(2);
  }

  staffLabel(staffId: string): string {
    const match = this.staff.find((row) => row.id === staffId);
    return match ? match.appointmentDisplayName || `${match.firstName} ${match.lastName}`.trim() : staffId;
  }

  private async loadStaff() {
    try {
      const result = await firstValueFrom(
        this.api.get<ApiEnvelope<StaffListPage>>('/staff/list?page=1&pageSize=200&active=true&sortBy=firstName&sortDirection=asc'),
      );
      this.staff = this.unwrap(result, 'Unable to load employees').items;
    } catch (error) {
      this.error = (error as Error).message;
    }
  }

  // ---------- Payroll structure ----------

  async loadStructure() {
    this.loading = true;
    this.error = '';
    try {
      const result = await firstValueFrom(this.api.get<ApiEnvelope<PayrollStructureRecord | null>>('/staff/payroll-structure'));
      this.structure = this.unwrap(result, 'Unable to load payroll structure');
      if (this.structure) {
        this.structureForm = {
          name: this.structure.name,
          providentFund: JSON.stringify(this.structure.providentFund ?? {}, null, 2),
          professionalTax: JSON.stringify(this.structure.professionalTax ?? {}, null, 2),
          esic: JSON.stringify(this.structure.esic ?? {}, null, 2),
          tds: JSON.stringify(this.structure.tds ?? {}, null, 2),
          notes: this.structure.notes || '',
          active: this.structure.active,
        };
      }
    } catch (error) {
      this.error = (error as Error).message;
    } finally {
      this.loading = false;
    }
  }

  async saveStructure() {
    this.loading = true;
    this.error = '';
    this.success = '';
    try {
      const parseBlock = (label: string, raw: string) => {
        try {
          return JSON.parse(raw || '{}');
        } catch {
          throw new Error(`${label} must be valid JSON`);
        }
      };
      const body = {
        name: this.structureForm.name.trim(),
        providentFund: parseBlock('Provident fund', this.structureForm.providentFund),
        professionalTax: parseBlock('Professional tax', this.structureForm.professionalTax),
        esic: parseBlock('ESIC', this.structureForm.esic),
        tds: parseBlock('TDS', this.structureForm.tds),
        notes: this.structureForm.notes.trim(),
        active: this.structureForm.active,
        version: this.structure?.version,
      };
      const result = await firstValueFrom(this.api.put<ApiEnvelope<PayrollStructureRecord>>('/staff/payroll-structure', body));
      this.unwrap(result, 'Unable to save payroll structure');
      this.success = 'Payroll structure saved.';
      await this.loadStructure();
    } catch (error) {
      this.error = (error as Error).message;
    } finally {
      this.loading = false;
    }
  }

  // ---------- Fine / allowance / deduction rules ----------

  async loadRules() {
    this.loading = true;
    this.error = '';
    try {
      const result = await firstValueFrom(this.api.get<ApiEnvelope<PayrollAdjustmentRuleRecord[]>>('/staff/payroll-adjustment-rules'));
      this.rules = this.unwrap(result, 'Unable to load adjustment rules');
    } catch (error) {
      this.error = (error as Error).message;
    } finally {
      this.loading = false;
    }
  }

  async createRule() {
    this.error = '';
    this.success = '';
    if (!this.ruleForm.name.trim()) {
      this.error = 'Rule name is required';
      return;
    }
    this.loading = true;
    try {
      const body = {
        kind: this.ruleForm.kind,
        name: this.ruleForm.name.trim(),
        amountPaise: this.toPaiseOrNull(this.ruleForm.amount),
        triggerType: this.ruleForm.triggerType,
        triggerCount: this.ruleForm.triggerCount.trim() ? Number(this.ruleForm.triggerCount) : null,
        applicationMode: this.ruleForm.applicationMode,
        autoApply: this.ruleForm.autoApply,
      };
      const result = await firstValueFrom(this.api.post<ApiEnvelope<PayrollAdjustmentRuleRecord>>('/staff/payroll-adjustment-rules', body));
      this.unwrap(result, 'Unable to create adjustment rule');
      this.success = 'Rule created.';
      this.ruleForm = { kind: 'fine', name: '', amount: '', triggerType: 'fixed', triggerCount: '', applicationMode: 'per_occurrence', autoApply: true };
      await this.loadRules();
    } catch (error) {
      this.error = (error as Error).message;
    } finally {
      this.loading = false;
    }
  }

  async toggleRuleActive(rule: PayrollAdjustmentRuleRecord) {
    this.error = '';
    this.success = '';
    this.loading = true;
    try {
      const result = await firstValueFrom(
        this.api.patch<ApiEnvelope<PayrollAdjustmentRuleRecord>>(`/staff/payroll-adjustment-rules/${rule.id}`, {
          active: !rule.active,
          version: rule.version,
        }),
      );
      this.unwrap(result, 'Unable to update rule');
      this.success = `Rule ${rule.active ? 'disabled' : 'enabled'}.`;
      await this.loadRules();
    } catch (error) {
      this.error = (error as Error).message;
    } finally {
      this.loading = false;
    }
  }

  // ---------- Incentive slabs ----------

  async loadIncentives() {
    this.loading = true;
    this.error = '';
    try {
      const result = await firstValueFrom(this.api.get<ApiEnvelope<IncentiveRuleRecord[]>>('/staff/incentive-rules'));
      this.incentives = this.unwrap(result, 'Unable to load incentive rules');
    } catch (error) {
      this.error = (error as Error).message;
    } finally {
      this.loading = false;
    }
  }

  addIncentiveSlabRow() {
    this.incentiveForm.slabs.push({ from: '', to: '', incentiveBasisPoints: '', incentivePaise: '', employeeBasisPoints: '', employeePaise: '' });
  }

  removeIncentiveSlabRow(index: number) {
    this.incentiveForm.slabs.splice(index, 1);
  }

  async createIncentiveRule() {
    this.error = '';
    this.success = '';
    if (this.incentiveForm.slabs.length === 0) {
      this.error = 'At least one slab is required';
      return;
    }
    this.loading = true;
    try {
      const body = {
        targetType: this.incentiveForm.targetType,
        assigneeType: this.incentiveForm.assigneeType,
        assigneeId: this.incentiveForm.assigneeId || null,
        roleScope: this.incentiveForm.roleScope,
        notes: this.incentiveForm.notes.trim(),
        slabs: this.incentiveForm.slabs.map((slab) => ({
          fromPaise: this.toPaise(slab.from),
          toPaise: this.toPaiseOrNull(slab.to),
          incentiveBasisPoints: slab.incentiveBasisPoints.trim() ? Number(slab.incentiveBasisPoints) : 0,
          incentivePaise: this.toPaise(slab.incentivePaise),
          employeeBasisPoints: slab.employeeBasisPoints.trim() ? Number(slab.employeeBasisPoints) : null,
          employeePaise: this.toPaiseOrNull(slab.employeePaise),
        })),
      };
      const result = await firstValueFrom(this.api.post<ApiEnvelope<IncentiveRuleRecord>>('/staff/incentive-rules', body));
      this.unwrap(result, 'Unable to create incentive rule');
      this.success = 'Incentive rule created.';
      this.incentiveForm = {
        targetType: 'sales',
        assigneeType: 'staff',
        assigneeId: '',
        roleScope: '',
        notes: '',
        slabs: [{ from: '', to: '', incentiveBasisPoints: '', incentivePaise: '', employeeBasisPoints: '', employeePaise: '' }],
      };
      await this.loadIncentives();
    } catch (error) {
      this.error = (error as Error).message;
    } finally {
      this.loading = false;
    }
  }

  async toggleIncentiveActive(rule: IncentiveRuleRecord) {
    this.error = '';
    this.success = '';
    this.loading = true;
    try {
      const result = await firstValueFrom(
        this.api.patch<ApiEnvelope<IncentiveRuleRecord>>(`/staff/incentive-rules/${rule.id}`, {
          active: !rule.active,
          version: rule.version,
        }),
      );
      this.unwrap(result, 'Unable to update incentive rule');
      this.success = `Incentive rule ${rule.active ? 'disabled' : 'enabled'}.`;
      await this.loadIncentives();
    } catch (error) {
      this.error = (error as Error).message;
    } finally {
      this.loading = false;
    }
  }

  // ---------- Statutory rules ----------

  async loadStatutoryRules() {
    this.loading = true;
    this.error = '';
    try {
      const result = await firstValueFrom(this.api.get<ApiEnvelope<StatutoryRuleRecord[]>>('/staff/payroll-compliance/rules'));
      this.statutoryRules = this.unwrap(result, 'Unable to load statutory rules');
    } catch (error) {
      this.error = (error as Error).message;
    } finally {
      this.loading = false;
    }
  }

  async createStatutoryRule() {
    this.error = '';
    this.success = '';
    if (!this.statutoryForm.effectiveFrom) {
      this.error = 'Effective from date is required';
      return;
    }
    if (this.statutoryForm.officialReference.trim().length < 3) {
      this.error = 'Official reference (notification/circular/section) is required';
      return;
    }
    if (this.statutoryForm.approvedBy.trim().length < 3) {
      this.error = 'Approved by (CA/labour professional) is required';
      return;
    }
    this.loading = true;
    try {
      const rule: Record<string, number> = {};
      const put = (key: string, value: string, integer = true) => {
        if (!value.trim()) return;
        rule[key] = integer ? Number(value) : Math.round(Number(value) * 100);
      };
      put('employeeBasisPoints', this.statutoryForm.employeeBasisPoints);
      put('employerBasisPoints', this.statutoryForm.employerBasisPoints);
      rule['employeeFixedPaise'] = this.toPaise(this.statutoryForm.employeeFixedPaise);
      if (!this.statutoryForm.employeeFixedPaise.trim()) delete rule['employeeFixedPaise'];
      rule['employerFixedPaise'] = this.toPaise(this.statutoryForm.employerFixedPaise);
      if (!this.statutoryForm.employerFixedPaise.trim()) delete rule['employerFixedPaise'];
      rule['wageCapPaise'] = this.toPaise(this.statutoryForm.wageCapPaise);
      if (!this.statutoryForm.wageCapPaise.trim()) delete rule['wageCapPaise'];
      rule['eligibilityCapPaise'] = this.toPaise(this.statutoryForm.eligibilityCapPaise);
      if (!this.statutoryForm.eligibilityCapPaise.trim()) delete rule['eligibilityCapPaise'];

      const body = {
        ruleType: this.statutoryForm.ruleType,
        stateCode: this.statutoryForm.stateCode.trim() || null,
        rule,
        effectiveFrom: this.statutoryForm.effectiveFrom,
        effectiveTo: this.statutoryForm.effectiveTo || null,
        roundingMethod: this.statutoryForm.roundingMethod,
        officialReference: this.statutoryForm.officialReference.trim(),
        approvedBy: this.statutoryForm.approvedBy.trim(),
      };
      const result = await firstValueFrom(this.api.post<ApiEnvelope<StatutoryRuleRecord>>('/staff/payroll-compliance/rules', body));
      this.unwrap(result, 'Unable to create statutory rule');
      this.success = 'Statutory rule created.';
      this.statutoryForm = {
        ruleType: 'provident_fund',
        stateCode: '',
        employeeBasisPoints: '',
        employerBasisPoints: '',
        employeeFixedPaise: '',
        employerFixedPaise: '',
        wageCapPaise: '',
        eligibilityCapPaise: '',
        effectiveFrom: '',
        effectiveTo: '',
        roundingMethod: 'floor',
        officialReference: '',
        approvedBy: '',
      };
      await this.loadStatutoryRules();
    } catch (error) {
      this.error = (error as Error).message;
    } finally {
      this.loading = false;
    }
  }

  // ---------- Salary revisions ----------

  async loadRevisions() {
    this.loading = true;
    this.error = '';
    try {
      const path = this.revisionStaffId ? `/staff/${this.revisionStaffId}/salary-revisions` : '/staff/salary-revisions';
      const result = await firstValueFrom(this.api.get<ApiEnvelope<SalaryRevisionRecord[]>>(path));
      this.revisions = this.unwrap(result, 'Unable to load salary revisions');
    } catch (error) {
      this.error = (error as Error).message;
    } finally {
      this.loading = false;
    }
  }

  async createRevision() {
    this.error = '';
    this.success = '';
    if (!this.revisionStaffId) {
      this.error = 'Select a staff member';
      return;
    }
    if (!this.revisionForm.effectiveDate) {
      this.error = 'Effective date is required';
      return;
    }
    this.loading = true;
    try {
      const body = {
        rateType: this.revisionForm.rateType,
        newAmountPaise: this.toPaise(this.revisionForm.newAmount),
        effectiveDate: this.revisionForm.effectiveDate,
        reason: this.revisionForm.reason.trim() || null,
      };
      const result = await firstValueFrom(
        this.api.post<ApiEnvelope<SalaryRevisionRecord>>(`/staff/${this.revisionStaffId}/salary-revisions`, body),
      );
      this.unwrap(result, 'Unable to request salary revision');
      this.success = 'Salary revision requested.';
      this.revisionForm = { rateType: 'monthly', newAmount: '', effectiveDate: '', reason: '' };
      await this.loadRevisions();
    } catch (error) {
      this.error = (error as Error).message;
    } finally {
      this.loading = false;
    }
  }

  async decideRevision(revision: SalaryRevisionRecord, decision: 'approved' | 'rejected') {
    this.error = '';
    this.success = '';
    this.loading = true;
    try {
      const body = { decision, version: revision.version, comments: this.revisionDecisionNotes[revision.id] || '' };
      const result = await firstValueFrom(
        this.api.post<ApiEnvelope<SalaryRevisionRecord>>(`/staff/salary-revisions/${revision.id}/decision`, body),
      );
      this.unwrap(result, 'Unable to decide salary revision');
      this.success = `Salary revision ${decision}.`;
      await this.loadRevisions();
    } catch (error) {
      this.error = (error as Error).message;
    } finally {
      this.loading = false;
    }
  }

  // ---------- Salary advances ----------

  async loadAdvances() {
    this.loading = true;
    this.error = '';
    try {
      const result = await firstValueFrom(this.api.get<ApiEnvelope<StaffAdvanceRecord[]>>('/staff-advances'));
      this.advances = this.unwrap(result, 'Unable to load salary advances');
    } catch (error) {
      this.error = (error as Error).message;
    } finally {
      this.loading = false;
    }
  }

  async createAdvance() {
    this.error = '';
    this.success = '';
    if (!this.advanceForm.staffId) {
      this.error = 'Select a staff member';
      return;
    }
    if (!this.advanceForm.recoveryStartPeriod) {
      this.error = 'Recovery start period is required';
      return;
    }
    this.loading = true;
    try {
      const body = {
        staffId: this.advanceForm.staffId,
        requestedAmountPaise: this.toPaise(this.advanceForm.requestedAmount),
        installmentCount: Number(this.advanceForm.installmentCount || '1'),
        recoveryStartPeriod: this.advanceForm.recoveryStartPeriod,
        reason: this.advanceForm.reason.trim(),
      };
      const result = await firstValueFrom(this.api.post<ApiEnvelope<StaffAdvanceRecord>>('/staff-advances', body));
      this.unwrap(result, 'Unable to request salary advance');
      this.success = 'Salary advance requested.';
      this.advanceForm = { staffId: '', requestedAmount: '', installmentCount: '1', recoveryStartPeriod: '', reason: '' };
      await this.loadAdvances();
    } catch (error) {
      this.error = (error as Error).message;
    } finally {
      this.loading = false;
    }
  }

  async decideAdvance(advance: StaffAdvanceRecord, decision: 'approved' | 'rejected') {
    this.error = '';
    this.success = '';
    this.loading = true;
    try {
      const body = { decision, version: advance.version, note: this.advanceDecisionNotes[advance.id] || '' };
      const result = await firstValueFrom(this.api.post<ApiEnvelope<StaffAdvanceRecord>>(`/staff-advances/${advance.id}/decision`, body));
      this.unwrap(result, 'Unable to decide salary advance');
      this.success = `Salary advance ${decision}.`;
      await this.loadAdvances();
    } catch (error) {
      this.error = (error as Error).message;
    } finally {
      this.loading = false;
    }
  }

  async disburseAdvance(advance: StaffAdvanceRecord) {
    this.error = '';
    this.success = '';
    const input = this.advanceDisbursement[advance.id] || { method: 'bank', reference: '' };
    this.loading = true;
    try {
      const body = {
        version: advance.version,
        paymentMethod: input.method,
        reference: input.reference || null,
        idempotencyKey: `advance-disburse-${advance.id}-${Date.now()}`,
      };
      const result = await firstValueFrom(this.api.post<ApiEnvelope<StaffAdvanceRecord>>(`/staff-advances/${advance.id}/disburse`, body));
      this.unwrap(result, 'Unable to disburse salary advance');
      this.success = 'Salary advance disbursed.';
      await this.loadAdvances();
    } catch (error) {
      this.error = (error as Error).message;
    } finally {
      this.loading = false;
    }
  }

  async waiveAdvance(advance: StaffAdvanceRecord) {
    this.error = '';
    this.success = '';
    const reason = this.advanceWaiverReason[advance.id] || '';
    if (!reason.trim()) {
      this.error = 'A waiver reason is required';
      return;
    }
    this.loading = true;
    try {
      const body = { version: advance.version, reason };
      const result = await firstValueFrom(this.api.post<ApiEnvelope<StaffAdvanceRecord>>(`/staff-advances/${advance.id}/waive`, body));
      this.unwrap(result, 'Unable to waive salary advance');
      this.success = 'Salary advance waived.';
      await this.loadAdvances();
    } catch (error) {
      this.error = (error as Error).message;
    } finally {
      this.loading = false;
    }
  }

  async cancelAdvance(advance: StaffAdvanceRecord) {
    this.error = '';
    this.success = '';
    this.loading = true;
    try {
      const result = await firstValueFrom(
        this.api.post<ApiEnvelope<StaffAdvanceRecord>>(`/staff-advances/${advance.id}/cancel`, { version: advance.version }),
      );
      this.unwrap(result, 'Unable to cancel salary advance');
      this.success = 'Salary advance cancelled.';
      await this.loadAdvances();
    } catch (error) {
      this.error = (error as Error).message;
    } finally {
      this.loading = false;
    }
  }

  // ---------- Notification preferences ----------

  async loadPreference() {
    if (!this.notificationStaffId) {
      this.preference = null;
      return;
    }
    this.loading = true;
    this.error = '';
    try {
      const result = await firstValueFrom(
        this.api.get<ApiEnvelope<NotificationPreferenceRecord | null>>(`/staff/${this.notificationStaffId}/notification-preferences`),
      );
      this.preference = this.unwrap(result, 'Unable to load notification preferences');
      this.preferenceForm = {
        whatsappOptIn: this.preference?.whatsappOptIn ?? false,
        allowPayrollAmounts: this.preference?.allowPayrollAmounts ?? false,
        languageCode: this.preference?.languageCode || 'en-IN',
        quietHoursStart: (this.preference?.quietHoursStart || '').slice(0, 5),
        quietHoursEnd: (this.preference?.quietHoursEnd || '').slice(0, 5),
      };
    } catch (error) {
      this.error = (error as Error).message;
    } finally {
      this.loading = false;
    }
  }

  async onNotificationStaffChange() {
    await this.loadPreference();
  }

  async savePreference() {
    if (!this.notificationStaffId) {
      this.error = 'Select a staff member';
      return;
    }
    this.error = '';
    this.success = '';
    this.loading = true;
    try {
      const body = {
        whatsappOptIn: this.preferenceForm.whatsappOptIn,
        allowPayrollAmounts: this.preferenceForm.allowPayrollAmounts,
        languageCode: this.preferenceForm.languageCode,
        quietHoursStart: this.preferenceForm.quietHoursStart ? `${this.preferenceForm.quietHoursStart}:00` : null,
        quietHoursEnd: this.preferenceForm.quietHoursEnd ? `${this.preferenceForm.quietHoursEnd}:00` : null,
        version: this.preference?.version,
      };
      const result = await firstValueFrom(
        this.api.put<ApiEnvelope<NotificationPreferenceRecord>>(`/staff/${this.notificationStaffId}/notification-preferences`, body),
      );
      this.unwrap(result, 'Unable to save notification preferences');
      this.success = 'Notification preferences saved.';
      await this.loadPreference();
    } catch (error) {
      this.error = (error as Error).message;
    } finally {
      this.loading = false;
    }
  }
}
