export type StaffPayrollRules = {
  weekOffDay: number;
  paidWeekOff: boolean;
  weekendPenalty: boolean;
  fridayPenaltyDays: number;
  saturdayPenaltyDays: number;
  sundayPenaltyDays: number;
  sandwichRule: boolean;
  weekOffWorkedMultiplier: number;
  defaultShiftHours: number;
  serviceCommissionPct: number;
  productCommissionPct: number;
  membershipCommissionPct: number;
  advanceSalaryCap: boolean;
};

export const STAFF_PAYROLL_RULES_KEY = 'staffPayrollRules.v1';

export const DEFAULT_STAFF_PAYROLL_RULES: StaffPayrollRules = {
  weekOffDay: 1,
  paidWeekOff: true,
  weekendPenalty: true,
  fridayPenaltyDays: 2,
  saturdayPenaltyDays: 2,
  sundayPenaltyDays: 2,
  sandwichRule: true,
  weekOffWorkedMultiplier: 1,
  defaultShiftHours: 9,
  serviceCommissionPct: 8,
  productCommissionPct: 5,
  membershipCommissionPct: 5,
  advanceSalaryCap: true
};

export function readStaffPayrollRules(): StaffPayrollRules {
  try {
    const parsed = JSON.parse(localStorage.getItem(STAFF_PAYROLL_RULES_KEY) || '{}') as Partial<StaffPayrollRules>;
    return normalizeStaffPayrollRules({ ...DEFAULT_STAFF_PAYROLL_RULES, ...parsed });
  } catch {
    return DEFAULT_STAFF_PAYROLL_RULES;
  }
}

export function normalizeStaffPayrollRules(value: Partial<StaffPayrollRules>): StaffPayrollRules {
  return {
    weekOffDay: clampInt(value.weekOffDay, 0, 6, DEFAULT_STAFF_PAYROLL_RULES.weekOffDay),
    paidWeekOff: Boolean(value.paidWeekOff),
    weekendPenalty: Boolean(value.weekendPenalty),
    fridayPenaltyDays: clampNumber(value.fridayPenaltyDays, 0, 31, DEFAULT_STAFF_PAYROLL_RULES.fridayPenaltyDays),
    saturdayPenaltyDays: clampNumber(value.saturdayPenaltyDays, 0, 31, DEFAULT_STAFF_PAYROLL_RULES.saturdayPenaltyDays),
    sundayPenaltyDays: clampNumber(value.sundayPenaltyDays, 0, 31, DEFAULT_STAFF_PAYROLL_RULES.sundayPenaltyDays),
    sandwichRule: Boolean(value.sandwichRule),
    weekOffWorkedMultiplier: clampNumber(value.weekOffWorkedMultiplier, 0, 4, DEFAULT_STAFF_PAYROLL_RULES.weekOffWorkedMultiplier),
    defaultShiftHours: clampNumber(value.defaultShiftHours, 1, 24, DEFAULT_STAFF_PAYROLL_RULES.defaultShiftHours),
    serviceCommissionPct: clampNumber(value.serviceCommissionPct, 0, 100, DEFAULT_STAFF_PAYROLL_RULES.serviceCommissionPct),
    productCommissionPct: clampNumber(value.productCommissionPct, 0, 100, DEFAULT_STAFF_PAYROLL_RULES.productCommissionPct),
    membershipCommissionPct: clampNumber(value.membershipCommissionPct, 0, 100, DEFAULT_STAFF_PAYROLL_RULES.membershipCommissionPct),
    advanceSalaryCap: Boolean(value.advanceSalaryCap)
  };
}

export function validateStaffPayrollRules(value: StaffPayrollRules): string[] {
  const errors: string[] = [];
  if (value.defaultShiftHours <= 0 || value.defaultShiftHours > 24) errors.push('Default shift hours must be between 1 and 24.');
  if (value.weekOffDay < 0 || value.weekOffDay > 6) errors.push('Select a valid week off day.');
  if (value.fridayPenaltyDays < 0 || value.saturdayPenaltyDays < 0 || value.sundayPenaltyDays < 0) errors.push('Weekend penalty cannot be negative.');
  if (value.weekOffWorkedMultiplier < 0) errors.push('Week off worked payout cannot be negative.');
  if (value.serviceCommissionPct > 100 || value.productCommissionPct > 100 || value.membershipCommissionPct > 100) errors.push('Commission percentage cannot exceed 100.');
  return errors;
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  return Math.round(clampNumber(value, min, max, fallback));
}
