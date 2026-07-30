import { HttpClient, HttpErrorResponse, HttpHeaders } from "@angular/common/http";
import { Injectable, signal } from "@angular/core";
import { firstValueFrom, Observable } from "rxjs";
import { environment } from "../../environments/environment";
import { resetCsrfState } from "./csrf.interceptor";

const STAFF_OFFLINE_QUEUE_KEY = "auraStaffOfflineQueue";
const STAFF_OFFLINE_LEASE_KEY = "auraStaffOfflineQueueLease";
const STAFF_BIOMETRIC_HINT_KEY = "auraStaffBiometricLoginHint";
const LEGACY_STAFF_AUTH_KEYS = ["auraStaffAccessToken", "auraStaffRefreshToken", "auraStaffSession", "auraStaffBiometricEnabled", "auraStaffBiometricCredentialId"];

export type MutationResult<T> =
  | { state: "completed"; data: T }
  | { state: "queued"; queueId: string; idempotencyKey: string };

export function isQueuedMutation<T>(result: MutationResult<T>): result is Extract<MutationResult<T>, { state: "queued" }> {
  return result.state === "queued";
}

type OfflineQueueState = "pending" | "syncing" | "permanent-failure" | "conflict";
type ReadCacheEntry<T> = {
  expiresAt: number;
  value?: T;
  promise?: Promise<T>;
};
type OfflineQueueEntry = {
  queueId: string;
  idempotencyKey: string;
  userId: string;
  tenantId: string;
  sessionId: string;
  method: "POST" | "PATCH";
  path: string;
  body: Record<string, unknown>;
  state: OfflineQueueState;
  queuedAt: string;
  lastError?: string;
};
type BiometricLoginHint = { tenantId: string; loginId: string };

function staffBusinessDate(value = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(value).reduce<Record<string, string>>((result, part) => ({ ...result, [part.type]: part.value }), {});
  return `${parts["year"]}-${parts["month"]}-${parts["day"]}`;
}

function stableQueryKey(params: Record<string, string> = {}): string {
  return JSON.stringify(
    Object.entries(params)
      .filter(([, value]) => value !== undefined && value !== null && value !== "")
      .sort(([left], [right]) => left.localeCompare(right))
  );
}

const STAFF_APP_PERMISSION_FALLBACKS: Record<string, string[]> = {
  "staff.app.dashboard.read": ["staff.self_manage", "staff_self.write", "read:appointments"],
  "staff.app.appointments.read": ["appointments.read", "read:appointments"],
  "staff.app.appointments.manage": ["appointments.manage", "write:appointments"],
  "staff.app.business.read": ["appointments.read", "read:appointments"],
  "staff.app.offers.read": ["marketing.read", "appointments.read", "read:appointments"],
  "staff.app.queue.read": ["appointments.read", "read:appointments"],
  "staff.app.tasks.read": ["staff.self_manage", "staff_self.write", "read:staff"],
  "staff.app.tasks.manage": ["staff.self_manage", "staff_self.write", "write:staff", "update:staff"],
  "staff.app.attendance.read": ["staff.app.attendance.manage", "staff.attendance.read", "staff.self_manage", "allow:staff-checkin-checkout", "read:staff"],
  "staff.app.attendance.manage": ["staff.self_manage", "staff_self.write", "allow:staff-checkin-checkout", "write:staff"],
  "staff.app.roster.read": ["staff.schedule.read", "staff.self_manage", "read:staff"],
  "staff.app.roster.manage": ["staff.self_manage", "staff_self.write", "write:staff", "update:staff"],
  "staff.app.calendar.read": ["staff.schedule.read", "staff.self_manage", "read:staff"],
  "staff.app.calendar.manage": ["staff.self_manage", "staff_self.write", "write:staff", "update:staff"],
  "staff.app.performance.read": ["staff.analytics.read", "staff.self_manage", "read:staff"],
  "staff.app.leaderboard.read": ["staff.analytics.read", "staff.self_manage", "read:staff"],
  "staff.app.notifications.read": ["notifications.read", "staff.self_manage", "read:staff"],
  "staff.app.notifications.manage": ["staff.self_manage", "staff_self.write", "write:staff", "update:staff"],
  "staff.app.reports.read": ["reports.read", "staff.self_manage", "read:staff"],
  "staff.app.chat.read": ["staff.self_manage", "staff_self.write", "read:staff"],
  "staff.app.chat.manage": ["staff.self_manage", "staff_self.write", "write:staff"],
  "staff.app.payroll.read": ["staff.payroll.read", "finance.read", "read:payroll", "read:finance"],
  "staff.app.leaves.read": ["staff.leave.read", "staff.self_manage", "read:staff"],
  "staff.app.leaves.manage": ["staff.leave.manage", "staff.self_manage", "staff_self.write", "write:staff", "update:staff"],
  "staff.app.feedback.read": ["staff.self_manage", "staff_self.write", "read:staff"],
  "staff.app.feedback.manage": ["staff.self_manage", "staff_self.write", "write:staff"],
  "staff.app.profile.read": ["staff.self_manage", "staff_self.write", "read:staff"],
  "staff.app.settings.read": ["staff.self_manage", "staff_self.write", "read:staff"]
};

export type StaffUser = {
  id: string;
  name: string;
  loginId: string;
  email: string;
  role: string;
  roleDisplayName?: string;
  customRoleName?: string;
  staffId: string;
  branchId: string;
  branchName?: string;
  branchIds: string[];
  permissions?: string[];
  deniedPermissions?: string[];
};

export type StaffAppointment = {
  id: string;
  staffId: string;
  branchId: string;
  serviceIds: string[];
  serviceNames: string[];
  durationMinutes: number;
  value: number;
  startAt: string;
  endAt: string;
  status: string;
  chair: string;
  source: string;
  clientName: string;
  preferredClient: boolean;
  rescheduleCount: number;
  rescheduleTimeline: Array<{ action: string; changedAt: string; reason: string; changedBy: string; fromStartAt: string; toStartAt: string }>;
  serviceDepartments: string[];
  lastServiceAt: string;
  lastServiceNames: string[];
  lastServiceDepartments: string[];
};

export type StaffDashboard = {
  staff: {
    id: string;
    fullName: string;
    firstName: string;
    lastName: string;
    mobile: string;
    email: string;
    roleId: string;
    department: string;
    designation: string;
    status: string;
  };
  summary: {
    appointments: number;
    todayAppointments: number;
    liveAppointments: number;
    completedAppointments: number;
    cancelledAppointments: number;
    salesCount: number;
    revenue: number;
    appointmentValue: number;
  };
  todayAppointments: StaffAppointment[];
  liveAppointments: StaffAppointment[];
  workReport: StaffAppointment[];
  appointments: StaffAppointment[];
  sales: Array<{ id: string; total: number; commissionTotal: number; status: string; createdAt: string }>;
};

export type StaffEnterpriseOs = {
  staff: StaffDashboard["staff"];
  home: {
    greeting: string;
    todayAppointments: number;
    expectedRevenue: number;
    tasks: number;
    pendingPayments: number;
    recentNotifications: number;
    targetProgress: { label: string; targetValue: number; achievedValue: number; percentage: number; remaining: number } | null;
  };
  timeline: Array<{ id: string; serviceNames: string[]; startAt: string; endAt: string; status: string; state: string; minutesToStart: number; durationMinutes: number; chair: string; clientName: string; preferredClient: boolean; rescheduleCount: number; rescheduleTimeline: StaffAppointment["rescheduleTimeline"]; serviceDepartments: string[]; lastServiceAt: string; lastServiceNames: string[]; lastServiceDepartments: string[] }>;
  serviceTimers: Array<{ appointmentId: string; status: string; elapsedMinutes: number; totalMinutes: number; remainingMinutes: number; progress: number }>;
  performance: { revenue: number | null; completedServices: number; avgUtilization: number | null; avgRating: number | null; productivityScore: number | null; strengths: string[]; opportunities: string[] };
  leaderboard: Array<{ rank: number; staffId: string; staffName: string; revenue: number | null; score: number; rating: number | null; points: number; days: number; isMe: boolean }>;
  gamification: { points: number; level: number; stars: number; activeDays?: number; dailyStreak: number; monthlyStreak: number; badges: Array<{ label: string; description: string; earned: boolean }> };
  notifications: Array<{ id: string; title: string; body: string; status: string; createdAt: string }>;
  tasks: Array<{ id: string; title: string; priority: string; status: string; dueAt: string; assignedBy: string; checklist: unknown[] }>;
  calendar: Array<{ id: string; date: string; startTime: string; endTime: string; type: string; status: string; version?: number }>;
  reports: Record<string, { days: number; revenue: number | null; services: number; productivityScore: number | null; rating: number | null }>;
};

export type StaffBusinessBilling = {
  saleId: string;
  invoiceId: string;
  invoiceNumber: string | null;
  invoiceStatus: string;
  subtotalPaise: number | null;
  discountPaise: number | null;
  couponDiscountPaise: number | null;
  afterDiscountPaise: number | null;
  gstPaise: number | null;
  totalPaise: number | null;
  paidPaise: number | null;
  duePaise: number | null;
};

export type StaffBusinessAttribution = {
  saleId: string;
  invoiceId: string;
  grossPaise: number;
  discountPaise: number;
  couponDiscountPaise: number;
  afterDiscountPaise: number;
  gstPaise: number;
  totalPaise: number;
  paidPaise: number;
  duePaise: number;
  serviceRevenuePaise: number;
  productRevenuePaise: number;
  membershipRevenuePaise: number;
  packageRevenuePaise: number;
  giftCardRevenuePaise: number;
};

export type StaffBusinessPermissions = {
  billing: boolean;
  earnings: boolean;
  targets: boolean;
  invoiceDetail: boolean;
  clientName: boolean;
  invoiceNumber: boolean;
  discount: boolean;
  tax: boolean;
  serviceAmount: boolean;
  commission: boolean;
};

export type StaffBusinessPerformance = {
  statusCounts: { booked: number; confirmed: number; arrived: number; inService: number; completed: number; cancelled: number; noShow: number; other: number };
  invoiceCount: number;
  actualWorkedMinutes: number;
  estimatedWorkedMinutes: number;
  attendanceMinutes: number;
  breakMinutes: number;
  dutyMinutes: number;
  utilizationPercent: number | null;
  attributedGrossPaise: number | null;
  attributedDiscountPaise: number | null;
  attributedCouponDiscountPaise: number | null;
  attributedAfterDiscountPaise: number | null;
  attributedGstPaise: number | null;
  attributedPaidPaise: number | null;
  attributedDuePaise: number | null;
  averageBillPaise: number | null;
  revenuePerWorkedHourPaise: number | null;
  serviceRevenuePaise: number | null;
  productRevenuePaise: number | null;
  membershipRevenuePaise: number | null;
  packageRevenuePaise: number | null;
  giftCardRevenuePaise: number | null;
};

export type StaffBusinessEarnings = {
  calculatedCommissionPaise: number;
  approvedCommissionPaise: number;
  tipsCollectedPaise: number;
  tipsPaidPaise: number;
  tipsPendingPaise: number;
  payrollGrossPaise: number;
  payrollNetPaise: number;
  payrollPaidPaise: number;
  payrollPendingPaise: number;
  periods: Array<{ payrollRunId: string; periodStart: string; periodEnd: string; status: string; grossPaise: number; netPaise: number }>;
};

export type StaffBusinessTarget = {
  id: string;
  type: string;
  unit: "paise" | "count" | "percent";
  periodStart: string;
  periodEnd: string;
  targetValue: number;
  achievedValue: number;
  progressPercent: number;
};

export type StaffBusinessQuery = {
  date?: string;
  from?: string;
  to?: string;
  page?: number;
  pageSize?: number;
  q?: string;
  status?: string;
  sort?: "asc" | "desc";
  allHistory?: boolean;
  serviceId?: string;
  service?: string;
  department?: string;
};

export type StaffRecommendation = {
  staffId: string;
  staffName: string;
  workloadCount: number;
  workloadMinutes: number;
  department: string;
  departmentMatch: boolean;
  preferredClient: boolean;
  utilizationPercent: number | null;
  rating: number | null;
  completionPercent: number | null;
  repeatClientPercent: number | null;
  confidence: string;
  recommendationReason: string;
};

export type StaffBusinessSummary = {
  appointments: number;
  completedServices: number;
  appointmentValuePaise?: number;
  scheduledMinutes: number;
  completedMinutes: number;
  workedMinutes: number;
  bills: number;
  subtotalPaise: number | null;
  discountPaise: number | null;
  couponDiscountPaise: number | null;
  afterDiscountPaise: number | null;
  gstPaise: number | null;
  totalPaise: number | null;
  paidPaise: number | null;
  duePaise: number | null;
};

export type StaffBusinessServiceInvoice = {
  id: string;
  saleId: string;
  invoiceId: string;
  invoiceNumber: string | null;
  appointmentId: string | null;
  businessDate: string;
  createdAt: string;
  status: string;
  refundStatus: string;
  clientName: string | null;
  serviceName: string;
  quantity: number;
  splitPercent: number;
  grossPaise: number | null;
  discountPaise: number | null;
  taxablePaise: number | null;
  gstPercent: number | null;
  gstPaise: number | null;
  cgstPaise: number | null;
  sgstPaise: number | null;
  igstPaise: number | null;
  totalPaise: number | null;
  refundedPaise: number | null;
  netTotalPaise: number | null;
  taxInclusive: boolean | null;
  taxMode: "inclusive" | "exclusive" | null;
  commissionPaise: number | null;
};

export type StaffBusinessAppointment = StaffAppointment & {
  businessDate: string;
  state: string;
  workedMinutes: number;
  timer: {
    appointmentId: string;
    status: string;
    live: boolean;
    startedAt: string | null;
    completedAt: string | null;
    timeSource: "actual" | "estimated";
    elapsedMinutes: number;
    totalMinutes: number;
    remainingMinutes: number;
    overrunMinutes: number;
    progress: number;
  };
  billing: StaffBusinessBilling | null;
  attribution: StaffBusinessAttribution | null;
};

export type StaffBusiness = {
  date: string;
  range: { from: string; to: string; timeZone: "Asia/Kolkata" };
  staff: StaffDashboard["staff"];
  billingVisible: boolean;
  permissions: StaffBusinessPermissions;
  summary: StaffBusinessSummary;
  performance: StaffBusinessPerformance;
  earnings: StaffBusinessEarnings | null;
  targets: StaffBusinessTarget[];
  services: Array<{ id: string; name: string; category: string }>;
  dailyBreakdown: Array<{ date: string; performance: StaffBusinessPerformance } & StaffBusinessSummary>;
  pagination: { page: number; pageSize: number; totalItems: number; totalPages: number; hasMore: boolean; appointmentTotal: number; appointmentPages: number; appointmentHasMore: boolean; serviceTotal: number };
  appointments: StaffBusinessAppointment[];
  serviceInvoices: StaffBusinessServiceInvoice[];
};

export type StaffBusinessInvoiceDetail = {
  id: string;
  invoiceNumber: string | null;
  clientName?: string;
  status: string;
  appointmentId: string;
  createdAt: string;
  totals: StaffBusinessBilling;
  items: StaffBusinessServiceInvoice[];
  payments: Array<{ id: string; mode: string; amount: number; amountPaise: number; createdAt: string }>;
};

export type StaffWorkspacePreferences = {
  workspace: { workspaceName: string };
  localization: { timezone: string; locale: string };
  dateTime: { dateFormat: string; timeFormat: string; businessDayStartHour: number; weekStartsOn: string };
  interface: { compactMode: boolean };
  defaults: { staffHints: boolean };
};

export type StaffWorkspacePreferenceUpdate = {
  workspaceName?: string;
  timezone?: string;
  locale?: string;
  dateFormat?: string;
  timeFormat?: string;
  compactMode?: boolean;
  staffHints?: boolean;
};

export type StaffAttendance = {
  id: string;
  businessDate: string;
  clockInAt: string;
  clockOutAt: string;
  status: string;
  source: string;
  overtimeMinutes: number;
  grossMinutes: number;
  totalBreakMinutes: number;
  totalWorkedMinutes: number;
  scheduledShiftMinutes: number | null;
  overtimeCalculationStatus: string;
  overtimeReviewReason: string;
  overtimePolicyVersion: string;
};

export type StaffOvertimeSummary = {
  asOf: string;
  weekStart: string;
  weekEnd: string;
  last30DaysStart: string;
  todayMinutes: number;
  weekMinutes: number;
  last30DaysMinutes: number;
  lifetimeMinutes: number;
};

export type StaffToday = {
  date: string;
  schedules: Array<{ id: string; scheduleDate: string; startTime: string; endTime: string; shiftType: string; status: string }>;
  attendance: StaffAttendance[];
  activeBreak: { id: string; status: string; startedAt?: string } | null;
  tasks: Array<{ id: string; title: string; description: string; taskType: string; status: string; priority: string; dueAt: string; version: number }>;
};

export type StaffPayrollItem = {
  id: string;
  periodStart: string;
  periodEnd: string;
  grossPay: number;
  deductionsPay: number;
  netPay: number;
  salaryPay: number;
  overtimePay: number;
  commissionPay: number;
  adjustmentPay: number;
  presentDaysX2: number;
  absentDaysX2: number;
  halfDayCount: number;
  paidLeaveDaysX2: number;
  workedMinutes: number;
  scheduledMinutes: number;
  lateMinutes: number;
  earlyLeaveMinutes: number;
  approvedOvertimeMinutes: number;
  overtimeRatePayPerHour: number;
  serviceCommissionPay: number;
  productCommissionPay: number;
  membershipCommissionPay: number;
  packageCommissionPay: number;
  serviceSalesPay: number;
  productSalesPay: number;
  membershipSalesPay: number;
  packageSalesPay: number;
  attendancePenaltyPay: number;
  ruleFinePay: number;
  ruleDeductionPay: number;
  statutoryDeductionPay: number;
  advanceRecoveryPay: number;
  lateDeductionPay: number;
  absenceDeductionPay: number;
  fineDeductionPay: number;
  status: string;
  createdAt: string;
  paidAt: string;
  paymentMethod: string;
  reference: string;
  payslipPath: string;
};

export type StaffEarlyDepartureRequest = {
  id: string;
  status: string;
  version: number;
  createdAt: string;
  payloadJson: {
    businessDate?: string;
    scheduledStartTime?: string;
    scheduledEndTime?: string;
    requestedDepartureTime?: string;
    earlyMinutes?: number;
    reason?: string;
    staffName?: string;
  };
};

export type StaffPayrollProfile = {
  rateType: string;
  amountPaise: number;
  effectiveFrom: string;
};

export type StaffPayrollOverview = {
  profile: StaffPayrollProfile | null;
  items: StaffPayrollItem[];
};

export type StaffPayrollRule = {
  id: string;
  name: string;
  kind: string;
  amountPaise: number;
  triggerType: string;
  triggerCount: number;
  applicationMode: string;
  autoApply: boolean;
  notes: string;
};

export type StaffOffer = {
  id: string;
  code: string;
  title: string;
  customerDescription: string;
  staffInstructions: string;
  benefitType: string;
  benefitValue: number;
  targetServiceIds: string[];
  targetPackageIds: string[];
  applicableServices: { id: string; name: string }[];
  applicablePackages: { id: string; name: string }[];
  startsAt: string;
  endsAt: string;
  minimumBillPaise: number;
  usageLimit: number | null;
  usedCount: number;
  perClientLimit: number;
  active: boolean;
  approvalStatus: string;
  personalOffer: boolean;
  hasCreative: boolean;
};

export type StaffFeedback = {
  id: string;
  category: string;
  title: string;
  body: string;
  status: string;
  managerNote: string;
  createdAt: string;
  updatedAt: string;
};

export type StaffTarget = {
  id: string;
  targetName?: string;
  type?: string;
  targetType?: string;
  targetValue?: number;
  achievedValue?: number;
  status?: string;
  createdAt?: string;
};

export type StaffLeave = {
  id: string;
  leaveType: string;
  startDate: string;
  endDate: string;
  reason: string;
  status: string;
  days: number;
  version: number;
  createdAt: string;
};

export type StaffLeaveBalance = {
  id: string;
  leaveType: string;
  openingBalance: number;
  accrued: number;
  used: number;
  balance: number;
  updatedAt: string;
};

type StaffLoginResponse = {
  accessToken?: string;
  access_token?: string;
  refreshToken?: string;
  refresh_token?: string;
  mustChangePassword?: boolean;
  must_change_password?: boolean;
  mfaEnrollmentRequired?: boolean;
  mfa_enrollment_required?: boolean;
  user?: StaffUser;
  requiresBranchSelection?: boolean;
  selectionToken?: string;
  branches?: Array<{ branchId: string; branchName?: string }>;
};

type RustAuthMe = {
  userId: string;
  tenantId: string;
  branchId?: string;
  role?: string;
  permissions?: string[];
  deniedPermissions?: string[];
  branches?: Array<{ branchId: string; branchName?: string; roleName?: string; permissions?: string[]; deniedPermissions?: string[] }>;
};

export type StaffChatConversation = {
  id: string;
  type: "team" | "private-owner";
  title: string;
  branchId: string;
  participantUserIds: string[] | null;
  messageCount: number;
  lastMessageAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type StaffConversationMessage = {
  id: string;
  conversationId: string;
  type: "team" | "private-owner";
  senderUserId: string;
  senderName: string;
  body: string;
  createdAt: string;
};

export type StaffServiceTarget = {
  id: string;
  serviceName: string;
  targetCount: number;
  achievedCount: number;
  progressPercent: number;
  startsOn: string;
  endsOn: string;
  rewardType: "none" | "bonus" | "gift" | "other";
  rewardAmountPaise: number;
  rewardDescription: string;
  progressStatus: "active" | "completed" | "expired" | "cancelled";
};

export type StaffPushDevice = { id: string };
export type StaffPushConfig = { configured: boolean; publicKey: string };
export type StaffMfaSetup = { secret: string; otpAuthUri: string; algorithm: string; digits: number; period: number };
type StaffMfaEnableResult = { enabled: boolean; recoveryCodes: string[] };

type StaffRefreshResponse = {
  accessToken?: string;
  access_token?: string;
  user?: StaffUser;
};

type WebAuthnBegin = { challengeId: string; options: PublicKeyCredentialRequestOptions | PublicKeyCredentialCreationOptions };
type WebAuthnLoginResponse = StaffLoginResponse;

type ApiEnvelope<T> = { success?: boolean; data?: T; error?: { message?: string } | string; message?: string };
type RustStaffSelfDashboard = {
  staff?: Record<string, unknown>;
  schedule?: Record<string, unknown> | null;
  attendance?: Record<string, unknown> | null;
  tasks?: unknown[];
  appointments?: unknown[];
  sales?: unknown[];
  leaveRequests?: unknown[];
  payrollProfile?: Record<string, unknown>;
  payroll?: unknown[];
  payrollRules?: unknown[];
};
type RustAttendanceDetail = Record<string, unknown> & { breaks?: unknown[] };

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function stringValue(row: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const value = row[key];
    if (value !== undefined && value !== null) return String(value);
  }
  return "";
}

function numberValue(row: Record<string, unknown>, ...keys: string[]): number {
  const value = Number(stringValue(row, ...keys));
  return Number.isFinite(value) ? value : 0;
}

@Injectable({ providedIn: "root" })
export class StaffAppService {
  private readonly baseUrl = environment.apiBaseUrl.replace(/\/$/, "");
  private accessTokenValue = "";
  private tenantIdValue = "";
  private sessionIdValue = "";
  private refreshPromise: Promise<void> | null = null;
  private flushPromise: Promise<number> | null = null;
  private readonly getCache = new Map<string, ReadCacheEntry<unknown>>();
  private readonly tabId = crypto.randomUUID();
  private readonly faceDeviceStorageKey = "auraStaffFaceDeviceId";
  readonly loading = signal(false);
  readonly error = signal("");
  readonly user = signal<StaffUser | null>(null);
  readonly profile = signal<StaffDashboard["staff"] | null>(null);
  readonly biometricEnabled = signal(!!this.readBiometricHint());
  readonly biometricLocked = signal(false);
  readonly passwordChangeRequired = signal(false);
  readonly mfaEnrollmentRequired = signal(false);
  readonly mfaSetup = signal<StaffMfaSetup | null>(null);

  constructor(private readonly http: HttpClient) {
    this.purgeLegacyAuthStorage();
  }

  isAuthenticated(): boolean {
    return !!this.accessTokenValue && !!this.user()?.staffId;
  }

  hasSavedSession(): boolean {
    return this.isAuthenticated();
  }

  async restoreSession(): Promise<boolean> {
    if (this.isAuthenticated()) return true;
    try {
      await this.refreshSession();
      return this.isAuthenticated();
    } catch {
      return false;
    }
  }

  hasPermission(permission: string): boolean {
    const currentUser = this.user();
    const denied = currentUser?.deniedPermissions || [];
    if (denied.includes(permission)) return false;
    const grants = (this.user()?.permissions || []).flatMap((grant) => {
      if (!grant.includes(".")) return [grant];
      const parts = grant.split(".").filter(Boolean);
      const action = parts.at(-1) || "";
      const resource = parts[0] || "";
      const aliases = ["read", "write", "create", "update", "delete"].includes(action) ? [`${action}:${resource}`] : [];
      if (resource === "staff" && parts.includes("attendance")) aliases.push("read:staff", "allow:staff-checkin-checkout");
      return [grant, ...aliases];
    });
    const matches = (required: string) => {
      if (denied.includes(required)) return false;
      if (grants.includes("*") || grants.includes(required)) return true;
      const [action, resource] = required.split(":");
      const writeAliases = new Set(["create", "update", "delete", "back", "print", "export"]);
      return grants.includes(`${action}:*`) || grants.includes("admin:*") ||
        (resource ? grants.includes(`admin:${resource}`) : false) ||
        (resource && writeAliases.has(action) ? grants.includes(`write:${resource}`) || grants.includes("write:*") : false);
    };
    if (!permission) return true;
    if (permission.startsWith("staff.app.")) {
      return matches(permission) || (STAFF_APP_PERMISSION_FALLBACKS[permission] || []).some(matches);
    }
    return matches(permission);
  }

  hasAnyPermission(permissions: string[]): boolean {
    return permissions.some((permission) => this.hasPermission(permission));
  }

  hasEveryPermission(permissions: string[]): boolean {
    return permissions.every((permission) => this.hasPermission(permission));
  }

  async login(payload: { tenantId: string; loginId: string; password: string; branchId?: string; mfaCode?: string }): Promise<StaffUser> {
    this.loading.set(true);
    this.error.set("");
    try {
      const tenantId = payload.tenantId.trim();
      if (!tenantId) throw new Error("Salon code is required.");
      const response = await firstValueFrom(this.http.post<StaffLoginResponse | ApiEnvelope<StaffLoginResponse>>(`${this.baseUrl}/auth/login`, {
        tenantId,
        loginId: payload.loginId.trim(),
        password: payload.password,
        branchId: payload.branchId?.trim() || undefined,
        mfaCode: payload.mfaCode?.trim() || undefined,
        deviceId: this.tabId,
        device: { type: "staff-app", name: "Aura Staff App", platform: "web" }
      }, { headers: new HttpHeaders({ "X-Tenant-Id": tenantId }), withCredentials: true }));
      const raw = this.unwrap(response);
      if (raw.requiresBranchSelection) {
        const branches = (raw.branches || []).map((branch) => branch.branchId).filter(Boolean).join(", ");
        throw new Error(`Choose a branch and sign in again${branches ? ` (${branches})` : ""}.`);
      }
      const session = this.normalizeSession(raw);
      if (!session.accessToken) throw new Error("Staff session token was not returned.");
      this.accessTokenValue = session.accessToken;
      const sessionTenantId = this.tenantIdFromAccessToken(session.accessToken) || tenantId;
      this.tenantIdValue = sessionTenantId;
      if (raw.mustChangePassword || raw.must_change_password) {
        this.passwordChangeRequired.set(true);
        throw new Error("Create a new password before opening the Staff App.");
      }
      if (raw.mfaEnrollmentRequired || raw.mfa_enrollment_required) {
        this.mfaEnrollmentRequired.set(true);
        this.mfaSetup.set(await this.startRequiredMfaSetup());
        throw new Error("Set up an authenticator before opening the Staff App.");
      }
      const user = session.user?.staffId ? session.user : await this.loadUserContext(payload.loginId.trim());
      this.assertEmployeeRole(user.role);
      if (!user.staffId) throw new Error("This login is not linked with a staff profile.");
      this.saveSession({ ...session, user }, sessionTenantId);
      return user;
    } catch (error) {
      const message = this.errorMessage(error, "Unable to login staff.");
      this.error.set(message);
      throw error;
    } finally {
      this.loading.set(false);
    }
  }

  async dashboard(params: Record<string, string> = {}): Promise<StaffDashboard> {
    return this.cachedRead(
      `dashboard:${stableQueryKey(params)}`,
      10_000,
      async () => {
        this.loading.set(true);
        this.error.set("");
        try {
          return await this.withRefreshRetry(async () => {
            const response = await firstValueFrom(this.http.get<RustStaffSelfDashboard | ApiEnvelope<RustStaffSelfDashboard>>(`${this.baseUrl}/staff/self/dashboard`, {
              headers: this.authHeaders(),
              params
            }));
            return this.normalizeDashboard(this.unwrap(response));
          });
        } catch (error) {
          const message = this.errorMessage(error, "Unable to load staff dashboard.");
          this.error.set(message);
          throw error;
        } finally {
          this.loading.set(false);
        }
      },
      (dashboard) => this.profile.set(dashboard.staff)
    );
  }

  async enterpriseOs(query: Record<string, string> = {}, reportError = true): Promise<StaffEnterpriseOs> {
    return this.cachedRead(`enterprise-os:${stableQueryKey(query)}`, 10_000, () => this.get<StaffEnterpriseOs>("/staff-self/enterprise-os", query, reportError));
  }

  async workspacePreferences(): Promise<StaffWorkspacePreferences> {
    return this.cachedRead("workspace-preferences", 60_000, () => this.get<StaffWorkspacePreferences>("/staff-self/workspace-preferences"));
  }

  async saveWorkspacePreferences(input: StaffWorkspacePreferenceUpdate): Promise<StaffWorkspacePreferences> {
    const saved = await this.put<StaffWorkspacePreferences>("/staff-self/workspace-preferences", { ...input });
    this.clearGetCache("workspace-preferences");
    if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("aura:preferences-updated", { detail: saved }));
    return saved;
  }

  async business(input: string | StaffBusinessQuery): Promise<StaffBusiness> {
    const query = typeof input === "string" ? { date: input } : input;
    return this.get<StaffBusiness>("/staff-self/business", this.stringQuery(query));
  }

  async businessInvoice(invoiceId: string): Promise<StaffBusinessInvoiceDetail> {
    return this.get<StaffBusinessInvoiceDetail>(`/staff-self/business/invoices/${encodeURIComponent(invoiceId)}`);
  }

  async updateNotification(id: string, status: "read" | "unread" | "archived" = "read"): Promise<unknown> {
    const result = await this.queueableMutation("PATCH", `/staff-self/notifications/${encodeURIComponent(id)}`, { status });
    if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("aura:notifications-updated"));
    return result;
  }

  async mobilePushConfig(): Promise<StaffPushConfig> {
    return this.get<StaffPushConfig>("/staff/self/mobile/push-config");
  }

  async registerPushDevice(id: string): Promise<StaffPushDevice> {
    return this.post<StaffPushDevice>("/staff/self/mobile/devices", {
      id,
      platform: "web",
      pushProvider: "web-push",
      appVersion: "0.1.0",
      capabilities: { pwa: true, pushNotifications: true }
    });
  }

  async registerPushSubscription(payload: Record<string, unknown>): Promise<unknown> {
    return this.post("/staff/self/mobile/push-subscriptions", payload);
  }

  async updateSchedule(scheduleId: string, payload: { version: number; scheduleDate?: string; startTime?: string; endTime?: string; status?: string; notes?: string }): Promise<unknown> {
    return this.patch(`/staff-self/calendar/${encodeURIComponent(scheduleId)}`, payload);
  }

  async staffChatConversations(): Promise<StaffChatConversation[]> {
    return this.get<StaffChatConversation[]>("/team-chat/conversations");
  }

  async startPrivateOwnerChat(idempotencyKey: string): Promise<StaffChatConversation> {
    return this.postIdempotent<StaffChatConversation>("/team-chat/private-owner", {}, idempotencyKey);
  }

  async staffConversationMessages(conversationId: string): Promise<StaffConversationMessage[]> {
    return this.get<StaffConversationMessage[]>(`/team-chat/conversations/${encodeURIComponent(conversationId)}/messages`);
  }

  async sendStaffConversationMessage(conversationId: string, body: string, idempotencyKey: string): Promise<StaffConversationMessage> {
    return this.postIdempotent<StaffConversationMessage>(`/team-chat/conversations/${encodeURIComponent(conversationId)}/messages`, { body }, idempotencyKey);
  }

  async today(date = staffBusinessDate()): Promise<StaffToday> {
    const [dashboard, attendance] = await Promise.all([
      this.get<RustStaffSelfDashboard>("/staff/self/dashboard", { date }),
      this.attendanceForMonth(date)
    ]);
    const schedule = objectValue(dashboard.schedule);
    const matchingAttendance = attendance.find((row) => stringValue(row, "businessDate", "business_date") === date);
    const breaks = arrayValue(matchingAttendance?.["breaks"]).map(objectValue);
    const activeBreak = breaks.find((row) => !stringValue(row, "endedAt", "ended_at"));
    return {
      date,
      schedules: Object.keys(schedule).length ? [{
        id: stringValue(schedule, "id"),
        scheduleDate: stringValue(schedule, "scheduleDate", "schedule_date") || date,
        startTime: stringValue(schedule, "shift1Start", "shift1_start"),
        endTime: stringValue(schedule, "shift2End", "shift2_end", "shift1End", "shift1_end"),
        shiftType: stringValue(schedule, "shiftType", "shift_type"),
        status: stringValue(schedule, "status")
      }] : [],
      attendance: matchingAttendance ? [this.normalizeAttendance(matchingAttendance)] : [],
      activeBreak: activeBreak ? {
        id: stringValue(activeBreak, "id"),
        status: "active",
        startedAt: stringValue(activeBreak, "startedAt", "started_at")
      } : null,
      tasks: arrayValue(dashboard.tasks).map((value) => {
        const row = objectValue(value);
        return {
          id: stringValue(row, "id"), title: stringValue(row, "title"), description: stringValue(row, "description"),
          taskType: stringValue(row, "taskType", "task_type"), status: stringValue(row, "status"), priority: stringValue(row, "priority"),
          dueAt: stringValue(row, "dueAt", "due_at"), version: numberValue(row, "version")
        };
      })
    };
  }

  async changeRequiredPassword(newPassword: string): Promise<void> {
    if (!this.accessTokenValue || !this.passwordChangeRequired()) throw new Error("Sign in with the temporary password first.");
    await firstValueFrom(this.http.post<ApiEnvelope<unknown>>(`${this.baseUrl}/auth/change-password`, { newPassword }, {
      headers: this.tokenHeaders(),
      withCredentials: true
    }));
    this.clearLocalAuthState(false);
    this.passwordChangeRequired.set(false);
    this.error.set("");
  }

  async enableRequiredMfa(code: string): Promise<string[]> {
    if (!this.accessTokenValue || !this.mfaEnrollmentRequired()) throw new Error("Sign in before setting up MFA.");
    const response = await firstValueFrom(this.http.post<ApiEnvelope<StaffMfaEnableResult>>(`${this.baseUrl}/auth/mfa/enable`, { code }, {
      headers: this.tokenHeaders(),
      withCredentials: true
    }));
    const result = this.unwrap(response);
    this.clearLocalAuthState(false);
    this.mfaEnrollmentRequired.set(false);
    this.mfaSetup.set(null);
    this.error.set("");
    return result.recoveryCodes;
  }

  private async startRequiredMfaSetup(): Promise<StaffMfaSetup> {
    const response = await firstValueFrom(this.http.post<ApiEnvelope<StaffMfaSetup>>(`${this.baseUrl}/auth/mfa/setup`, {}, {
      headers: this.tokenHeaders(),
      withCredentials: true
    }));
    return this.unwrap(response);
  }

  async serviceTargets(): Promise<StaffServiceTarget[]> {
    return this.get<StaffServiceTarget[]>("/staff/self/service-targets");
  }

  async attendanceHistory(days = 30): Promise<StaffAttendance[]> {
    const to = staffBusinessDate();
    const start = new Date(`${to}T00:00:00.000Z`);
    start.setUTCDate(start.getUTCDate() - Math.max(0, days - 1));
    const months = new Set([to.slice(0, 7), start.toISOString().slice(0, 7)]);
    const rows = (await Promise.all([...months].map((month) => this.attendanceForMonth(`${month}-01`)))).flat();
    const from = start.toISOString().slice(0, 10);
    return rows
      .filter((row) => {
        const date = stringValue(row, "businessDate", "business_date");
        return date >= from && date <= to && !!stringValue(row, "id");
      })
      .map((row) => this.normalizeAttendance(row))
      .sort((left, right) => right.businessDate.localeCompare(left.businessDate));
  }

  async overtimeSummary(): Promise<StaffOvertimeSummary> {
    const asOf = staffBusinessDate();
    const end = new Date(`${asOf}T00:00:00.000Z`);
    const weekStart = new Date(end);
    weekStart.setUTCDate(end.getUTCDate() - ((end.getUTCDay() + 6) % 7));
    const rows = await this.attendanceHistory(30);
    const weekStartText = weekStart.toISOString().slice(0, 10);
    const last30DaysStart = new Date(end);
    last30DaysStart.setUTCDate(end.getUTCDate() - 29);
    const sum = (items: StaffAttendance[]) => items.reduce((total, row) => total + Number(row.overtimeMinutes || 0), 0);
    return {
      asOf, weekStart: weekStartText, weekEnd: asOf, last30DaysStart: last30DaysStart.toISOString().slice(0, 10),
      todayMinutes: sum(rows.filter((row) => row.businessDate === asOf)),
      weekMinutes: sum(rows.filter((row) => row.businessDate >= weekStartText)),
      last30DaysMinutes: sum(rows), lifetimeMinutes: 0
    };
  }

  async payroll(): Promise<StaffPayrollItem[]> {
    return (await this.payrollOverview()).items;
  }

  async earlyDepartureRequests(): Promise<StaffEarlyDepartureRequest[]> {
    return this.get<StaffEarlyDepartureRequest[]>("/staff-attendance/early-departure-requests");
  }

  async requestEarlyDeparture(payload: { businessDate: string; requestedDepartureTime: string; reason: string }): Promise<StaffEarlyDepartureRequest> {
    return this.post<StaffEarlyDepartureRequest>("/staff-attendance/early-departure-requests", payload);
  }

  async payrollOverview(): Promise<StaffPayrollOverview> {
    const dashboard = await this.get<RustStaffSelfDashboard>("/staff/self/dashboard", { date: staffBusinessDate() });
    const profile = objectValue(dashboard.payrollProfile);
    return {
      profile: Object.keys(profile).length ? {
        rateType: stringValue(profile, "rateType", "rate_type"),
        amountPaise: numberValue(profile, "amountPaise", "amount_paise"),
        effectiveFrom: stringValue(profile, "effectiveFrom", "effective_from")
      } : null,
      items: arrayValue(dashboard.payroll).map((value) => {
      const row = objectValue(value);
      return {
        id: stringValue(row, "id", "runId", "run_id"), periodStart: stringValue(row, "periodStart", "period_start"),
        periodEnd: stringValue(row, "periodEnd", "period_end"), grossPay: numberValue(row, "grossPaise", "gross_paise"),
        deductionsPay: numberValue(row, "deductionsPaise", "deductions_paise"),
        netPay: numberValue(row, "netPaise", "net_paise"), salaryPay: numberValue(row, "earnedSalaryPaise", "earned_salary_paise"),
        overtimePay: numberValue(row, "overtimePaise", "overtime_paise"), commissionPay: numberValue(row, "commissionPaise", "commission_paise"),
        adjustmentPay: numberValue(row, "adjustmentPaise", "adjustment_paise"),
        presentDaysX2: numberValue(row, "presentDaysX2"), absentDaysX2: numberValue(row, "absentDaysX2"), halfDayCount: numberValue(row, "halfDayCount"), paidLeaveDaysX2: numberValue(row, "paidLeaveDaysX2"),
        workedMinutes: numberValue(row, "workedMinutes"), scheduledMinutes: numberValue(row, "scheduledMinutes"), lateMinutes: numberValue(row, "lateMinutes"), earlyLeaveMinutes: numberValue(row, "earlyLeaveMinutes"),
        approvedOvertimeMinutes: numberValue(row, "approvedOvertimeMinutes"), overtimeRatePayPerHour: numberValue(row, "overtimeRatePaisePerHour"),
        serviceCommissionPay: numberValue(row, "serviceCommissionPaise"), productCommissionPay: numberValue(row, "productCommissionPaise"),
        membershipCommissionPay: numberValue(row, "membershipCommissionPaise"), packageCommissionPay: numberValue(row, "packageCommissionPaise"),
        serviceSalesPay: numberValue(row, "serviceSalesPaise"), productSalesPay: numberValue(row, "productSalesPaise"),
        membershipSalesPay: numberValue(row, "membershipSalesPaise"), packageSalesPay: numberValue(row, "packageSalesPaise"),
        attendancePenaltyPay: numberValue(row, "attendancePenaltyPaise"), ruleFinePay: numberValue(row, "ruleFinePaise"),
        ruleDeductionPay: numberValue(row, "ruleDeductionPaise"), statutoryDeductionPay: numberValue(row, "statutoryEmployeePaise"),
        advanceRecoveryPay: numberValue(row, "advanceRecoveryPaise"), lateDeductionPay: numberValue(row, "lateDeductionPaise"),
        absenceDeductionPay: numberValue(row, "absenceDeductionPaise"), fineDeductionPay: numberValue(row, "fineDeductionPaise"), status: stringValue(row, "status"),
        createdAt: stringValue(row, "finalizedAt", "finalized_at"), paidAt: stringValue(row, "paidAt", "paid_at"),
        paymentMethod: stringValue(row, "paymentMethod", "payment_method"), reference: stringValue(row, "reference"),
        payslipPath: stringValue(row, "payslipPath", "payslip_path")
      };
      })
    };
  }

  async downloadPayslip(path: string): Promise<void> {
    const blob = await this.withRefreshRetry(async () => firstValueFrom(this.http.get(`${this.baseUrl}${path}`, {
      headers: this.authHeaders(),
      responseType: "blob"
    })));
    const url = URL.createObjectURL(blob);
    window.open(url, "_blank", "noopener");
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }

  async offers(): Promise<StaffOffer[]> {
    return this.get<StaffOffer[]>("/staff-self/offers");
  }

  async offerCreative(id: string): Promise<Blob> {
    return this.withRefreshRetry(() => firstValueFrom(this.http.get(
      `${this.baseUrl}/staff-self/offers/${encodeURIComponent(id)}/creative`,
      { headers: this.authHeaders(), responseType: "blob" }
    )));
  }

  async feedback(): Promise<StaffFeedback[]> {
    return this.get<StaffFeedback[]>("/staff-self/feedback");
  }

  async submitFeedback(payload: { category: string; title: string; body: string }): Promise<StaffFeedback> {
    const result = await this.post<StaffFeedback>("/staff-self/feedback", payload);
    this.notifyFeedbackUpdated();
    return result;
  }

  async cancelAppointment(id: string, reason: string): Promise<unknown> {
    const result = await this.post(`/staff-self/appointments/${encodeURIComponent(id)}/cancel`, { reason });
    this.notifyAppointmentsUpdated();
    return result;
  }

  async appointmentRecommendations(id: string): Promise<StaffRecommendation[]> {
    return this.get<StaffRecommendation[]>(`/staff-self/appointments/${encodeURIComponent(id)}/recommendations`);
  }

  async rescheduleAppointment(id: string, payload: { startAt: string; reason: string }): Promise<unknown> {
    const result = await this.post(`/staff-self/appointments/${encodeURIComponent(id)}/reschedule`, {
      start_at: payload.startAt,
      reason: payload.reason
    });
    this.notifyAppointmentsUpdated();
    return result;
  }

  private notifyAppointmentsUpdated(): void {
    if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("aura:appointments-updated"));
  }

  private notifyFeedbackUpdated(): void {
    if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("aura:feedback-updated"));
  }

  async payrollRules(): Promise<StaffPayrollRule[]> {
    const dashboard = await this.get<RustStaffSelfDashboard>("/staff/self/dashboard", { date: staffBusinessDate() });
    return arrayValue(dashboard.payrollRules).map((value) => {
      const row = objectValue(value);
      return {
        id: stringValue(row, "id"), name: stringValue(row, "name"), kind: stringValue(row, "kind"),
        amountPaise: numberValue(row, "amountPaise", "amount_paise"), triggerType: stringValue(row, "triggerType", "trigger_type"),
        triggerCount: numberValue(row, "triggerCount", "trigger_count"), applicationMode: stringValue(row, "applicationMode", "application_mode"),
        autoApply: Boolean(row["autoApply"] ?? row["auto_apply"]), notes: stringValue(row, "notes")
      };
    });
  }

  async targets(): Promise<StaffTarget[]> {
    return this.get<StaffTarget[]>("/staff/self/targets");
  }

  async leaves(): Promise<StaffLeave[]> {
    const now = new Date();
    return this.get<StaffLeave[]>("/staff-leave/requests", {
      year: String(now.getFullYear()), month: String(now.getMonth() + 1), staffId: this.staffId()
    });
  }

  async leaveBalances(): Promise<StaffLeaveBalance[]> {
    const year = new Date().getFullYear();
    const rows = await this.get<Array<Record<string, unknown>>>("/staff-leave/balances", { year: String(year), staffId: this.staffId() });
    return rows.map((row) => ({
      id: `${stringValue(row, "staffId", "staff_id")}:${stringValue(row, "leaveType", "leave_type")}:${year}`,
      leaveType: stringValue(row, "leaveType", "leave_type"), openingBalance: numberValue(row, "annualDays", "annual_days"),
      accrued: 0, used: numberValue(row, "usedDays", "used_days"), balance: numberValue(row, "remainingDays", "remaining_days"), updatedAt: ""
    }));
  }

  async clockIn(source = "staff-app"): Promise<MutationResult<StaffAttendance>> {
    return this.queueableMutation<StaffAttendance>("POST", "/staff-attendance/clock-in", {
      staffId: this.staffId(), businessDate: staffBusinessDate(), source
    });
  }

  async faceClockIn(livenessResponse: string): Promise<MutationResult<StaffAttendance>> {
    const position = await this.currentPosition();
    return this.onlineMutation(() => this.post<StaffAttendance>("/staff-attendance/clock-in", {
      staffId: this.staffId(), businessDate: staffBusinessDate(), source: "staff-app-face",
      faceScan: {
        deviceUid: this.faceDeviceId(), latitude: position.coords.latitude, longitude: position.coords.longitude,
        accuracyMeters: position.coords.accuracy, livenessPrompt: "camera-opened", livenessResponse
      }
    }));
  }

  async clockOut(attendanceId?: string): Promise<MutationResult<StaffAttendance>> {
    return this.queueableMutation<StaffAttendance>("POST", "/staff-attendance/clock-out", {
      staffId: this.staffId(), businessDate: staffBusinessDate(), attendanceId
    });
  }

  async startBreak(): Promise<MutationResult<unknown>> {
    return this.queueableMutation("POST", "/staff-attendance/break-start", {
      staffId: this.staffId(), businessDate: staffBusinessDate(), breakType: "regular"
    });
  }

  async endBreak(): Promise<MutationResult<unknown>> {
    return this.queueableMutation("POST", "/staff-attendance/break-end", {
      staffId: this.staffId(), businessDate: staffBusinessDate()
    });
  }

  async requestLeave(payload: { leaveType: string; startDate: string; endDate: string; reason: string }): Promise<unknown> {
    return this.post("/staff-leave/requests", { ...payload, staffId: this.staffId() });
  }

  async withdrawLeave(requestId: string, version: number): Promise<StaffLeave> {
    return this.post<StaffLeave>(`/staff-leave/requests/${encodeURIComponent(requestId)}/withdraw`, { version });
  }

  async completeTask(taskId: string, version: number): Promise<MutationResult<unknown>> {
    return this.queueableMutation("PATCH", `/staff/self/tasks/${encodeURIComponent(taskId)}/status`, { status: "completed", version });
  }

  async moveTask(taskId: string, version: number, status: string): Promise<MutationResult<unknown>> {
    return this.queueableMutation("PATCH", `/staff/self/tasks/${encodeURIComponent(taskId)}/status`, { status, version });
  }

  async logout(): Promise<void> {
    try {
      if (!this.accessTokenValue) await this.refreshSession();
      await firstValueFrom(this.http.post(`${this.baseUrl}/auth/logout`, {}, { headers: this.authHeaders(), withCredentials: true }));
    } catch {
      // Local state must still be destroyed when the server session is already invalid.
    } finally {
      this.clearLocalAuthState(true);
    }
  }

  biometricSupported(): boolean {
    return typeof window !== "undefined" && typeof PublicKeyCredential !== "undefined" && !!navigator.credentials;
  }

  async setBiometricEnabled(enabled: boolean): Promise<void> {
    this.error.set("");
    if (!enabled) {
      localStorage.removeItem(STAFF_BIOMETRIC_HINT_KEY);
      this.biometricEnabled.set(false);
      this.biometricLocked.set(false);
      return;
    }
    if (!this.hasSavedSession()) throw new Error("Login once before enabling biometric unlock.");
    if (!this.biometricSupported()) throw new Error("Biometric unlock is not supported on this device.");
    const begin = await this.authPost<WebAuthnBegin>("/auth/webauthn/register/begin", { label: "Aura Staff App" }, true);
    const credential = await navigator.credentials.create({ publicKey: this.decodeCreationOptions(begin.options as PublicKeyCredentialCreationOptions) });
    if (!(credential instanceof PublicKeyCredential)) throw new Error("Passkey setup was cancelled.");
    await this.authPost("/auth/webauthn/register/finish", {
      challengeId: begin.challengeId,
      credential: this.registrationResponse(credential)
    }, true);
    const hint = { tenantId: this.tenantIdValue, loginId: this.user()?.loginId || this.user()?.email || "" };
    if (!hint.tenantId || !hint.loginId) throw new Error("Passkey login hint is unavailable.");
    localStorage.setItem(STAFF_BIOMETRIC_HINT_KEY, JSON.stringify(hint));
    this.biometricEnabled.set(true);
    this.biometricLocked.set(false);
  }

  async unlockWithBiometric(): Promise<void> {
    this.error.set("");
    if (!this.biometricEnabled()) throw new Error("Biometric unlock is not enabled.");
    if (!this.biometricSupported()) throw new Error("Biometric unlock is not supported on this device.");
    const hint = this.readBiometricHint();
    if (!hint) throw new Error("Passkey login is not configured on this device.");
    const begin = await this.publicPost<WebAuthnBegin>("/auth/webauthn/login/begin", { loginId: hint.loginId }, hint.tenantId);
    const credential = await navigator.credentials.get({ publicKey: this.decodeRequestOptions(begin.options as PublicKeyCredentialRequestOptions) });
    if (!(credential instanceof PublicKeyCredential)) throw new Error("Passkey login was cancelled.");
    const response = this.normalizeSession(await this.publicPost<WebAuthnLoginResponse>("/auth/webauthn/login/finish", {
      challengeId: begin.challengeId,
      credential: this.authenticationResponse(credential),
      deviceId: this.tabId
    }, hint.tenantId));
    if (!response.accessToken) throw new Error("Passkey session token was not returned.");
    this.accessTokenValue = response.accessToken;
    const sessionTenantId = this.tenantIdFromAccessToken(response.accessToken) || hint.tenantId;
    this.tenantIdValue = sessionTenantId;
    const user = response.user?.staffId ? response.user : await this.loadUserContext(hint.loginId);
    this.assertEmployeeRole(user.role);
    if (!user.staffId) throw new Error("Passkey is not linked to a staff profile.");
    this.saveSession({ ...response, user }, sessionTenantId);
  }

  realtimeSocketUrl(): string {
    if (!this.isAuthenticated()) return "";
    return this.buildRealtimeSocketUrl();
  }

  async realtimeSocketTicketUrl(): Promise<string> {
    if (!this.isAuthenticated()) return "";
    return this.buildRealtimeSocketUrl();
  }

  appointmentRealtimeSocketUrl(): string {
    return this.isAuthenticated() ? this.buildRealtimeSocketUrl("appointments") : "";
  }

  posRealtimeSocketUrl(): string {
    return this.isAuthenticated() ? this.buildRealtimeSocketUrl("pos") : "";
  }

  invalidateCachedReads(): void { this.clearGetCache(); }

  realtimeSocketProtocols(): string[] {
    return this.accessTokenValue ? ["aurashine-v1", this.accessTokenValue] : ["aurashine-v1"];
  }

  private buildRealtimeSocketUrl(channel = "team-chat"): string {
    const configuredBase = environment.realtimeWsBaseUrl.trim() || this.baseUrl;
    const base = configuredBase.startsWith("http") || configuredBase.startsWith("ws")
      ? new URL(configuredBase)
      : new URL(configuredBase, window.location.origin);
    base.protocol = base.protocol === "https:" ? "wss:" : "ws:";
    base.pathname = `${base.pathname.replace(/\/$/, "")}/realtime/${channel}`;
    return base.toString();
  }

  async flushOfflineActions(): Promise<number> {
    if (this.flushPromise) return this.flushPromise;
    this.flushPromise = this.flushOfflineActionsInternal().finally(() => { this.flushPromise = null; });
    return this.flushPromise;
  }

  private async flushOfflineActionsInternal(): Promise<number> {
    if (!this.isOnline() || !this.isAuthenticated() || !this.acquireQueueLease()) return 0;
    const queue = this.readOfflineQueue();
    if (!queue.length) { this.releaseQueueLease(); return 0; }
    let flushed = 0;
    for (const item of queue.filter((entry) => entry.state === "pending" || entry.state === "syncing")) {
      if (!this.isQueueOwner(item)) {
        item.state = "permanent-failure";
        item.lastError = "Queued action belongs to a different authenticated session.";
        continue;
      }
      try {
        item.state = "syncing";
        this.writeOfflineQueue(queue);
        const headers = this.authHeaders().set("Idempotency-Key", item.idempotencyKey);
        await this.requestMutation(item.method, item.path, item.body, headers);
        const index = queue.indexOf(item);
        if (index >= 0) queue.splice(index, 1);
        flushed += 1;
      } catch (error) {
        item.lastError = this.errorMessage(error, "Offline sync failed.");
        item.state = error instanceof HttpErrorResponse && error.status === 409
          ? "conflict"
          : error instanceof HttpErrorResponse && error.status >= 400 && error.status < 500
            ? "permanent-failure"
            : "pending";
      }
    }
    this.writeOfflineQueue(queue);
    this.releaseQueueLease();
    return flushed;
  }

  offlineQueueSize(): number {
    return this.readOfflineQueue().length;
  }

  private staffId(): string {
    const staffId = this.user()?.staffId?.trim();
    if (!staffId) throw new Error("This login is not linked with a staff profile.");
    return staffId;
  }

  private async attendanceForMonth(date: string): Promise<RustAttendanceDetail[]> {
    const parsed = new Date(`${date}T00:00:00.000Z`);
    if (Number.isNaN(parsed.getTime())) throw new Error("Invalid attendance date.");
    return this.get<RustAttendanceDetail[]>(`/staff-attendance/${encodeURIComponent(this.staffId())}/details`, {
      year: String(parsed.getUTCFullYear()), month: String(parsed.getUTCMonth() + 1), cycle: "monthly"
    });
  }

  private normalizeAttendance(row: Record<string, unknown>): StaffAttendance {
    const clockInAt = stringValue(row, "clockInAt", "clock_in_at");
    const clockOutAt = stringValue(row, "clockOutAt", "clock_out_at");
    const worked = numberValue(row, "workedMinutes", "worked_minutes");
    const breaks = numberValue(row, "breakMinutes", "break_minutes");
    const elapsed = clockInAt && clockOutAt ? Math.max(0, Math.floor((new Date(clockOutAt).getTime() - new Date(clockInAt).getTime()) / 60000)) : worked + breaks;
    return {
      id: stringValue(row, "id") || stringValue(row, "businessDate", "business_date"),
      businessDate: stringValue(row, "businessDate", "business_date"), clockInAt, clockOutAt,
      status: stringValue(row, "attendanceStatus", "attendance_status", "manualStatus", "manual_status", "scheduledStatus", "scheduled_status"),
      source: stringValue(row, "source"), overtimeMinutes: numberValue(row, "overtimeMinutes", "overtime_minutes"),
      grossMinutes: elapsed, totalBreakMinutes: breaks, totalWorkedMinutes: worked, scheduledShiftMinutes: null,
      overtimeCalculationStatus: "calculated", overtimeReviewReason: "", overtimePolicyVersion: ""
    };
  }

  private normalizeAppointment(value: unknown): StaffAppointment {
    const row = objectValue(value);
    const startAt = stringValue(row, "startAt", "start_at");
    const endAt = stringValue(row, "endAt", "end_at");
    const duration = startAt && endAt ? Math.max(0, Math.floor((new Date(endAt).getTime() - new Date(startAt).getTime()) / 60000)) : numberValue(row, "durationMinutes", "duration_minutes");
    const serviceNames = arrayValue(row["serviceNames"] ?? row["service_names"]).map(String);
    const serviceName = stringValue(row, "serviceName", "service_name");
    if (!serviceNames.length && serviceName) serviceNames.push(serviceName);
    return {
      id: stringValue(row, "id"), staffId: stringValue(row, "staffId", "staff_id") || this.staffId(),
      branchId: stringValue(row, "branchId", "branch_id") || this.user()?.branchId || "",
      serviceIds: arrayValue(row["serviceIds"] ?? row["service_ids"]).map(String), serviceNames,
      durationMinutes: duration, value: numberValue(row, "value", "amountPaise", "amount_paise", "totalPaise", "total_paise"),
      startAt, endAt, status: stringValue(row, "status"), chair: stringValue(row, "chair"), source: stringValue(row, "source"),
      clientName: stringValue(row, "clientName", "client_name"), preferredClient: Boolean(row["preferredClient"] ?? row["preferred_client"]),
      rescheduleCount: numberValue(row, "rescheduleCount", "reschedule_count"),
      rescheduleTimeline: arrayValue(row["rescheduleTimeline"] ?? row["reschedule_timeline"]).map((entry) => {
        const event = objectValue(entry);
        return { action: stringValue(event, "action"), changedAt: stringValue(event, "changedAt", "changed_at"), reason: stringValue(event, "reason"), changedBy: stringValue(event, "changedBy", "changed_by"), fromStartAt: stringValue(event, "fromStartAt", "from_start_at"), toStartAt: stringValue(event, "toStartAt", "to_start_at") };
      }),
      serviceDepartments: arrayValue(row["serviceDepartments"] ?? row["service_departments"]).map(String), lastServiceAt: stringValue(row, "lastServiceAt", "last_service_at"),
      lastServiceNames: arrayValue(row["lastServiceNames"] ?? row["last_service_names"]).map(String),
      lastServiceDepartments: arrayValue(row["lastServiceDepartments"] ?? row["last_service_departments"]).map(String)
    };
  }

  private normalizeDashboard(source: RustStaffSelfDashboard): StaffDashboard {
    const staff = objectValue(source.staff);
    const appointments = arrayValue(source.appointments).map((row) => this.normalizeAppointment(row));
    const completed = appointments.filter((row) => /completed|done/i.test(row.status));
    const cancelled = appointments.filter((row) => /cancel/i.test(row.status));
    const live = appointments.filter((row) => /in.?service|in.?progress|running|started|active/i.test(row.status));
    const sales = arrayValue(source.sales).map((value) => {
      const row = objectValue(value);
      return {
        id: stringValue(row, "id"),
        total: numberValue(row, "totalPaise", "total_paise", "total"),
        commissionTotal: numberValue(row, "commissionPaise", "commission_paise", "commissionTotal"),
        status: stringValue(row, "status"),
        createdAt: stringValue(row, "createdAt", "created_at")
      };
    });
    const name = stringValue(staff, "fullName", "displayName", "display_name") || this.user()?.name || "";
    const names = name.trim().split(/\s+/).filter(Boolean);
    return {
      staff: {
        id: stringValue(staff, "id") || this.staffId(), fullName: name, firstName: names[0] || "", lastName: names.slice(1).join(" "),
        mobile: stringValue(staff, "mobile"), email: stringValue(staff, "email") || this.user()?.email || "",
        roleId: this.user()?.role || "", department: stringValue(staff, "department"),
        designation: stringValue(staff, "designation", "jobTitle", "job_title"), status: stringValue(staff, "status") || "active"
      },
      summary: {
        appointments: appointments.length, todayAppointments: appointments.length, liveAppointments: live.length,
        completedAppointments: completed.length, cancelledAppointments: cancelled.length, salesCount: sales.length,
        revenue: sales.reduce((total, row) => total + Number(row.total || 0), 0), appointmentValue: appointments.reduce((total, row) => total + Number(row.value || 0), 0)
      },
      todayAppointments: appointments, liveAppointments: live, workReport: completed, appointments, sales
    };
  }

  private authHeaders(): HttpHeaders {
    const headers = this.tokenHeaders();
    const branchId = this.user()?.branchId || this.user()?.branchIds?.[0] || "";
    return branchId ? headers.set("X-Branch-Id", branchId) : headers;
  }

  private tokenHeaders(): HttpHeaders {
    if (!this.accessTokenValue) throw new Error("Staff login required.");
    return new HttpHeaders({ Authorization: `Bearer ${this.accessTokenValue}`, "X-Tenant-Id": this.tenantIdValue });
  }

  private stringQuery(query: StaffBusinessQuery): Record<string, string> {
    return Object.fromEntries(
      Object.entries(query)
        .filter(([, value]) => value !== undefined && value !== null && value !== "")
        .map(([key, value]) => [key, String(value)])
    );
  }

  private cachedRead<T>(key: string, ttlMs: number, load: () => Promise<T>, apply: (value: T) => void = () => undefined): Promise<T> {
    const entry = this.getCache.get(key) as ReadCacheEntry<T> | undefined;
    const now = Date.now();
    if (entry?.value !== undefined && entry.expiresAt > now) {
      apply(entry.value);
      return Promise.resolve(entry.value);
    }
    if (entry?.promise) {
      return entry.promise.then((value) => {
        apply(value);
        return value;
      });
    }
    const promise = load()
      .then((value) => {
        this.getCache.set(key, { value, expiresAt: Date.now() + ttlMs });
        apply(value);
        return value;
      })
      .catch((error) => {
        if ((this.getCache.get(key) as ReadCacheEntry<T> | undefined)?.promise === promise) this.getCache.delete(key);
        throw error;
      });
    this.getCache.set(key, { promise, expiresAt: now + ttlMs });
    return promise;
  }

  private clearGetCache(prefix?: string): void {
    if (!prefix) {
      this.getCache.clear();
      return;
    }
    Array.from(this.getCache.keys())
      .filter((key) => key.startsWith(prefix))
      .forEach((key) => this.getCache.delete(key));
  }

  private async get<T>(path: string, params: Record<string, string> = {}, reportError = true): Promise<T> {
    this.loading.set(true);
    if (reportError) this.error.set("");
    try {
      return await this.withRefreshRetry(async () => {
        const response = await firstValueFrom(this.http.get<T | ApiEnvelope<T>>(`${this.baseUrl}${path}`, { headers: this.authHeaders(), params }));
        return this.unwrap(response);
      });
    } catch (error) {
      const message = this.errorMessage(error, "Unable to load staff data.");
      if (reportError) this.error.set(message);
      throw error;
    } finally {
      this.loading.set(false);
    }
  }

  private async post<T = unknown>(path: string, body: Record<string, unknown>): Promise<T> {
    this.loading.set(true);
    this.error.set("");
    if (!this.isOnline()) { this.loading.set(false); throw new Error("This action requires an internet connection."); }
    try {
      const result = await this.withRefreshRetry(async () => {
        const response = await firstValueFrom(this.http.post<T | ApiEnvelope<T>>(`${this.baseUrl}${path}`, body, { headers: this.authHeaders() }));
        return this.unwrap(response);
      });
      this.clearGetCache();
      return result;
    } catch (error) {
      const message = this.errorMessage(error, "Unable to update staff data.");
      this.error.set(message);
      throw error;
    } finally {
      this.loading.set(false);
    }
  }

  private async patch<T = unknown>(path: string, body: Record<string, unknown>): Promise<T> {
    this.loading.set(true);
    this.error.set("");
    if (!this.isOnline()) { this.loading.set(false); throw new Error("This action requires an internet connection."); }
    try {
      const result = await this.withRefreshRetry(async () => {
        const response = await firstValueFrom(this.http.patch<T | ApiEnvelope<T>>(`${this.baseUrl}${path}`, body, { headers: this.authHeaders() }));
        return this.unwrap(response);
      });
      this.clearGetCache();
      return result;
    } catch (error) {
      const message = this.errorMessage(error, "Unable to update staff data.");
      this.error.set(message);
      throw error;
    } finally {
      this.loading.set(false);
    }
  }

  private async put<T = unknown>(path: string, body: Record<string, unknown>): Promise<T> {
    this.loading.set(true);
    this.error.set("");
    if (!this.isOnline()) { this.loading.set(false); throw new Error("This action requires an internet connection."); }
    try {
      const result = await this.withRefreshRetry(async () => {
        const response = await firstValueFrom(this.http.put<T | ApiEnvelope<T>>(`${this.baseUrl}${path}`, body, { headers: this.authHeaders() }));
        return this.unwrap(response);
      });
      this.clearGetCache();
      return result;
    } catch (error) {
      const message = this.errorMessage(error, "Unable to update staff data.");
      this.error.set(message);
      throw error;
    } finally {
      this.loading.set(false);
    }
  }

  private saveSession(session: StaffLoginResponse, tenantId: string) {
    resetCsrfState();
    this.clearOfflineState();
    this.clearGetCache();
    this.accessTokenValue = session.accessToken || session.access_token || "";
    this.tenantIdValue = tenantId;
    this.sessionIdValue = crypto.randomUUID();
    this.profile.set(null);
    this.user.set(session.user || null);
  }

  private normalizeSession(session: StaffLoginResponse): StaffLoginResponse {
    return { ...session, accessToken: session.accessToken || session.access_token, refreshToken: session.refreshToken || session.refresh_token };
  }

  private async loadUserContext(loginId: string): Promise<StaffUser> {
    const meResponse = await firstValueFrom(this.http.get<RustAuthMe | ApiEnvelope<RustAuthMe>>(`${this.baseUrl}/auth/me`, { headers: this.tokenHeaders() }));
    const me = this.unwrap(meResponse);
    const branch = me.branchId || me.branches?.[0]?.branchId || "";
    if (!branch) throw new Error("This login has no active branch access.");
    const branchAccess = me.branches?.find((item) => item.branchId === branch);
    const role = me.role || branchAccess?.roleName || "staff";
    this.assertEmployeeRole(role);
    const permissions = me.permissions || branchAccess?.permissions || [];
    const deniedPermissions = me.deniedPermissions || branchAccess?.deniedPermissions || [];
    this.user.set({ id: me.userId, name: loginId, loginId, email: loginId.includes("@") ? loginId : "", role, staffId: "", branchId: branch, branchName: branchAccess?.branchName, branchIds: (me.branches || []).map((item) => item.branchId), permissions, deniedPermissions });
    const dashboardResponse = await firstValueFrom(this.http.get<RustStaffSelfDashboard | ApiEnvelope<RustStaffSelfDashboard>>(`${this.baseUrl}/staff/self/dashboard`, { headers: this.authHeaders() }));
    const staff = objectValue(this.unwrap(dashboardResponse).staff);
    const staffId = stringValue(staff, "id");
    if (!staffId) throw new Error("This login is not linked with a staff profile.");
    const user: StaffUser = { id: me.userId, name: stringValue(staff, "displayName", "fullName") || loginId, loginId, email: stringValue(staff, "email") || (loginId.includes("@") ? loginId : ""), role, staffId, branchId: branch, branchName: branchAccess?.branchName, branchIds: (me.branches || []).map((item) => item.branchId), permissions, deniedPermissions };
    this.user.set(user);
    return user;
  }

  private async withRefreshRetry<T>(request: () => Promise<T>): Promise<T> {
    try {
      if (!this.accessTokenValue) await this.refreshSession();
      return await request();
    } catch (error) {
      if (!this.isUnauthorized(error)) throw error;
      await this.refreshSession();
      return request();
    }
  }

  private async refreshSession(): Promise<void> {
    if (this.refreshPromise) return this.refreshPromise;
    this.refreshPromise = (async () => {
      try {
        const response = await firstValueFrom(this.http.post<StaffRefreshResponse | ApiEnvelope<StaffRefreshResponse>>(
          `${this.baseUrl}/auth/refresh`,
          { deviceId: this.tabId, device: { type: "staff-app", name: "Aura Staff App", platform: "web" } },
          { withCredentials: true }
        ));
        const session = this.normalizeSession(this.unwrap(response));
        if (!session.accessToken) throw new Error("Staff session refresh failed.");
        this.accessTokenValue = session.accessToken;
        this.tenantIdValue = this.tenantIdFromAccessToken(session.accessToken) || this.tenantIdValue || this.readBiometricHint()?.tenantId || "";
        if (session.user?.staffId) {
          this.assertEmployeeRole(session.user.role);
          if (this.user()?.id && this.user()?.id !== session.user.id) this.clearOfflineState();
          this.profile.set(null);
          this.user.set(session.user);
          this.sessionIdValue ||= crypto.randomUUID();
        } else {
          const hint = this.readBiometricHint();
          await this.loadUserContext(this.user()?.loginId || this.user()?.email || hint?.loginId || "staff");
        }
      } catch (error) {
        this.clearLocalAuthState(false);
        throw error;
      }
    })().finally(() => { this.refreshPromise = null; });
    return this.refreshPromise;
  }

  private assertEmployeeRole(role: string): void {
    const normalized = String(role || "").trim().toLowerCase().replace(/[-_\s]/g, "");
    if (!["owner", "admin", "superadmin"].includes(normalized)) return;
    this.clearLocalAuthState(false);
    throw new Error("Owner and administrator accounts cannot use Staff App.");
  }

  private isUnauthorized(error: unknown): boolean {
    return error instanceof HttpErrorResponse && error.status === 401;
  }

  private base64UrlToArrayBuffer(value: string): ArrayBuffer {
    const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(normalized.length + ((4 - normalized.length % 4) % 4), "=");
    const raw = atob(padded);
    const bytes = new Uint8Array(raw.length);
    for (let index = 0; index < raw.length; index += 1) bytes[index] = raw.charCodeAt(index);
    return bytes.buffer;
  }

  private tenantIdFromAccessToken(token: string): string {
    try {
      const payload = token.split(".")[1];
      if (!payload) return "";
      const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
      const decoded = objectValue(JSON.parse(atob(normalized.padEnd(normalized.length + ((4 - normalized.length % 4) % 4), "="))));
      return stringValue(decoded, "tenant_id", "tenantId");
    } catch { return ""; }
  }

  private isOnline(): boolean {
    return typeof navigator === "undefined" ? true : navigator.onLine;
  }

  private readOfflineQueue(): OfflineQueueEntry[] {
    try {
      const parsed: unknown = JSON.parse(localStorage.getItem(STAFF_OFFLINE_QUEUE_KEY) || "[]");
      if (!Array.isArray(parsed)) return [];
      return parsed.filter((item): item is OfflineQueueEntry => this.isOfflineQueueEntry(item));
    } catch {
      return [];
    }
  }

  private async postIdempotent<T>(path: string, body: Record<string, unknown>, idempotencyKey: string): Promise<T> {
    this.loading.set(true);
    this.error.set("");
    if (!this.isOnline()) { this.loading.set(false); throw new Error("This action requires an internet connection."); }
    try {
      const result = await this.withRefreshRetry(async () => {
        const headers = this.authHeaders().set("Idempotency-Key", idempotencyKey);
        const response = await firstValueFrom(this.http.post<T | ApiEnvelope<T>>(`${this.baseUrl}${path}`, body, { headers }));
        return this.unwrap(response);
      });
      this.clearGetCache();
      return result;
    } catch (error) {
      this.error.set(this.errorMessage(error, "Unable to update chat."));
      throw error;
    } finally {
      this.loading.set(false);
    }
  }

  private authenticatedObservable<T>(request: () => Observable<T>): Observable<T> {
    return new Observable((subscriber) => {
      let requestSubscription: { unsubscribe(): void } | undefined;
      let cancelled = false;
      const run = async (retried: boolean) => {
        try {
          if (!this.accessTokenValue) await this.refreshSession();
          if (cancelled) return;
          requestSubscription = request().subscribe({
            next: (value) => subscriber.next(value),
            complete: () => subscriber.complete(),
            error: (error) => {
              if (!retried && this.isUnauthorized(error)) {
                void this.refreshSession().then(() => run(true)).catch((refreshError) => subscriber.error(refreshError));
                return;
              }
              subscriber.error(error);
            }
          });
        } catch (error) {
          if (!cancelled) subscriber.error(error);
        }
      };
      void run(false);
      return () => {
        cancelled = true;
        requestSubscription?.unsubscribe();
      };
    });
  }

  private async queueableMutation<T = unknown>(method: "POST" | "PATCH", path: string, body: Record<string, unknown>): Promise<MutationResult<T>> {
    if (this.isOnline()) return { state: "completed", data: method === "POST" ? await this.post<T>(path, body) : await this.patch<T>(path, body) };
    if (!this.isAllowedOfflineMutation(method, path, body)) throw new Error("This action cannot be stored offline.");
    const queueId = crypto.randomUUID();
    const idempotencyKey = crypto.randomUUID();
    const entry: OfflineQueueEntry = {
      queueId, idempotencyKey, userId: this.user()?.id || "", tenantId: this.tenantIdValue,
      sessionId: this.sessionIdValue, method, path, body, state: "pending", queuedAt: new Date().toISOString()
    };
    if (!this.isQueueOwner(entry)) throw new Error("An authenticated session is required to queue this action.");
    this.writeOfflineQueue([...this.readOfflineQueue(), entry].slice(-30));
    return { state: "queued", queueId, idempotencyKey };
  }

  private isAllowedOfflineMutation(method: "POST" | "PATCH", path: string, body: Record<string, unknown>): boolean {
    if (method === "PATCH" && /^\/staff-self\/notifications\/[^/]+$/.test(path)) return Object.keys(body).length === 1 && ["read", "unread", "archived"].includes(String(body["status"]));
    if (method === "PATCH" && /^\/staff\/self\/tasks\/[^/]+\/status$/.test(path)) return Object.keys(body).every((key) => ["status", "version"].includes(key)) && typeof body["version"] === "number";
    if (method === "POST" && ["/staff-attendance/clock-in", "/staff-attendance/clock-out", "/staff-attendance/break-start", "/staff-attendance/break-end"].includes(path)) {
      return Object.keys(body).every((key) => ["staffId", "businessDate", "source", "attendanceId", "breakType"].includes(key));
    }
    return false;
  }

  private faceDeviceId(): string {
    if (typeof localStorage === "undefined") return this.tabId;
    const existing = localStorage.getItem(this.faceDeviceStorageKey);
    if (existing) return existing;
    const created = `staff_face_${crypto.randomUUID()}`;
    localStorage.setItem(this.faceDeviceStorageKey, created);
    return created;
  }

  private currentPosition(): Promise<GeolocationPosition> {
    if (typeof navigator === "undefined" || !navigator.geolocation) return Promise.reject(new Error("GPS location is required for face attendance."));
    return new Promise((resolve, reject) => navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }));
  }
  private async onlineMutation<T>(mutation: () => Promise<T>): Promise<MutationResult<T>> {
    if (!this.isOnline()) throw new Error("This action requires an internet connection and cannot be stored offline.");
    return { state: "completed", data: await mutation() };
  }

  private isOfflineQueueEntry(value: unknown): value is OfflineQueueEntry {
    if (!value || typeof value !== "object") return false;
    const item = value as Record<string, unknown>;
    return typeof item["queueId"] === "string" && typeof item["idempotencyKey"] === "string" &&
      typeof item["userId"] === "string" && typeof item["tenantId"] === "string" && typeof item["sessionId"] === "string" &&
      (item["method"] === "POST" || item["method"] === "PATCH") && typeof item["path"] === "string" &&
      !!item["body"] && typeof item["body"] === "object" && ["pending", "syncing", "permanent-failure", "conflict"].includes(String(item["state"]));
  }

  private writeOfflineQueue(queue: OfflineQueueEntry[]): void { localStorage.setItem(STAFF_OFFLINE_QUEUE_KEY, JSON.stringify(queue)); }
  private clearOfflineState(): void { localStorage.removeItem(STAFF_OFFLINE_QUEUE_KEY); localStorage.removeItem(STAFF_OFFLINE_LEASE_KEY); }
  private isQueueOwner(item: OfflineQueueEntry): boolean {
    return !!this.user()?.id && item.userId === this.user()?.id && item.tenantId === this.tenantIdValue && item.sessionId === this.sessionIdValue;
  }

  private acquireQueueLease(): boolean {
    const now = Date.now();
    try {
      const parsed: unknown = JSON.parse(localStorage.getItem(STAFF_OFFLINE_LEASE_KEY) || "null");
      if (parsed && typeof parsed === "object") {
        const lease = parsed as Record<string, unknown>;
        if (lease["owner"] !== this.tabId && typeof lease["expiresAt"] === "number" && lease["expiresAt"] > now) return false;
      }
      localStorage.setItem(STAFF_OFFLINE_LEASE_KEY, JSON.stringify({ owner: this.tabId, expiresAt: now + 30_000 }));
      const confirmed: unknown = JSON.parse(localStorage.getItem(STAFF_OFFLINE_LEASE_KEY) || "null");
      return !!confirmed && typeof confirmed === "object" && (confirmed as Record<string, unknown>)["owner"] === this.tabId;
    } catch { return false; }
  }

  private releaseQueueLease(): void {
    try {
      const lease: unknown = JSON.parse(localStorage.getItem(STAFF_OFFLINE_LEASE_KEY) || "null");
      if (lease && typeof lease === "object" && (lease as Record<string, unknown>)["owner"] === this.tabId) localStorage.removeItem(STAFF_OFFLINE_LEASE_KEY);
    } catch { localStorage.removeItem(STAFF_OFFLINE_LEASE_KEY); }
  }

  private async requestMutation(method: "POST" | "PATCH", path: string, body: Record<string, unknown>, headers: HttpHeaders): Promise<unknown> {
    const result = await this.withRefreshRetry(async () => {
      const request = method === "POST" ? this.http.post<unknown>(`${this.baseUrl}${path}`, body, { headers }) : this.http.patch<unknown>(`${this.baseUrl}${path}`, body, { headers });
      return firstValueFrom(request);
    });
    this.clearGetCache();
    return result;
  }

  private clearLocalAuthState(clearBiometric: boolean): void {
    resetCsrfState();
    this.accessTokenValue = "";
    this.tenantIdValue = "";
    this.sessionIdValue = "";
    this.profile.set(null);
    this.user.set(null);
    this.clearGetCache();
    this.biometricLocked.set(false);
    this.clearOfflineState();
    this.purgeLegacyAuthStorage();
    localStorage.removeItem("auraStaffRecent");
    if (clearBiometric) localStorage.removeItem(STAFF_BIOMETRIC_HINT_KEY);
    this.biometricEnabled.set(!clearBiometric && !!this.readBiometricHint());
  }

  private purgeLegacyAuthStorage(): void {
    for (const key of LEGACY_STAFF_AUTH_KEYS) localStorage.removeItem(key);
  }

  private readBiometricHint(): BiometricLoginHint | null {
    try {
      const value: unknown = JSON.parse(localStorage.getItem(STAFF_BIOMETRIC_HINT_KEY) || "null");
      if (!value || typeof value !== "object") return null;
      const hint = value as Record<string, unknown>;
      return typeof hint["tenantId"] === "string" && typeof hint["loginId"] === "string" ? { tenantId: hint["tenantId"], loginId: hint["loginId"] } : null;
    } catch { return null; }
  }

  private async publicPost<T>(path: string, body: Record<string, unknown>, tenantId = ""): Promise<T> {
    const headers = tenantId ? new HttpHeaders({ "X-Tenant-Id": tenantId }) : undefined;
    const response = await firstValueFrom(this.http.post<T | ApiEnvelope<T>>(`${this.baseUrl}${path}`, body, { headers, withCredentials: true }));
    return this.unwrap(response);
  }

  private async authPost<T = unknown>(path: string, body: Record<string, unknown>, authenticated = false): Promise<T> {
    if (!authenticated) return this.publicPost<T>(path, body);
    return this.withRefreshRetry(async () => {
      const response = await firstValueFrom(this.http.post<T | ApiEnvelope<T>>(`${this.baseUrl}${path}`, body, { headers: this.authHeaders(), withCredentials: true }));
      return this.unwrap(response);
    });
  }

  private decodeCreationOptions(options: PublicKeyCredentialCreationOptions): PublicKeyCredentialCreationOptions {
    return { ...options, challenge: this.base64UrlToArrayBuffer(String(options.challenge)), user: { ...options.user, id: this.base64UrlToArrayBuffer(String(options.user.id)) } };
  }

  private decodeRequestOptions(options: PublicKeyCredentialRequestOptions): PublicKeyCredentialRequestOptions {
    return { ...options, challenge: this.base64UrlToArrayBuffer(String(options.challenge)), allowCredentials: options.allowCredentials?.map((item) => ({ ...item, id: this.base64UrlToArrayBuffer(String(item.id)) })) };
  }

  private registrationResponse(credential: PublicKeyCredential): Record<string, unknown> {
    if (!(credential.response instanceof AuthenticatorAttestationResponse)) throw new Error("Invalid passkey registration response.");
    return { id: credential.id, rawId: this.arrayBufferToBase64Url(credential.rawId), type: credential.type, response: { clientDataJSON: this.arrayBufferToBase64Url(credential.response.clientDataJSON), attestationObject: this.arrayBufferToBase64Url(credential.response.attestationObject) } };
  }

  private authenticationResponse(credential: PublicKeyCredential): Record<string, unknown> {
    if (!(credential.response instanceof AuthenticatorAssertionResponse)) throw new Error("Invalid passkey authentication response.");
    return { id: credential.id, rawId: this.arrayBufferToBase64Url(credential.rawId), type: credential.type, response: { clientDataJSON: this.arrayBufferToBase64Url(credential.response.clientDataJSON), authenticatorData: this.arrayBufferToBase64Url(credential.response.authenticatorData), signature: this.arrayBufferToBase64Url(credential.response.signature), userHandle: credential.response.userHandle ? this.arrayBufferToBase64Url(credential.response.userHandle) : null } };
  }

  private arrayBufferToBase64Url(value: ArrayBuffer): string {
    const bytes = new Uint8Array(value);
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }

  private unwrap<T>(response: T | ApiEnvelope<T>): T {
    if (response && typeof response === "object" && "data" in response) {
      const envelope = response as ApiEnvelope<T>;
      if (envelope.data !== undefined) return envelope.data;
      const error = envelope.error;
      const message = typeof error === "string" ? error : error?.message || envelope.message;
      throw new Error(message || "Unexpected staff API response.");
    }
    return response as T;
  }

  private errorMessage(error: unknown, fallback: string): string {
    if (error && typeof error === "object" && "error" in error) {
      const httpError = error as { error?: ApiEnvelope<unknown> | { message?: string } | string; message?: string };
      const body = httpError.error;
      if (typeof body === "string" && body.trim()) return body;
      if (body && typeof body === "object") {
        const nested = "error" in body ? body.error : undefined;
        const message = typeof nested === "string" ? nested : nested?.message || body.message;
        if (message) return message;
      }
      if (httpError.message) return httpError.message;
    }
    return error instanceof Error ? error.message : fallback;
  }
}
