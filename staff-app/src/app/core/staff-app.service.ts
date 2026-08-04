import { HttpClient, HttpErrorResponse, HttpHeaders } from "@angular/common/http";
import { Injectable, signal } from "@angular/core";
import { firstValueFrom, Observable } from "rxjs";
import { environment } from "../../environments/environment";
import { resetCsrfState } from "./csrf.interceptor";
import { StaffOfflineStore } from "./staff-offline-store";
import { openProtectedBlob } from "./staff-protected-file";

const STAFF_OFFLINE_QUEUE_KEY = "auraStaffOfflineQueue";
const STAFF_OFFLINE_LEASE_KEY = "auraStaffOfflineQueueLease";
const STAFF_OFFLINE_QUEUE_RECORD = "mutation-queue";
const STAFF_BIOMETRIC_HINT_KEY = "auraStaffBiometricLoginHint";
const LEGACY_STAFF_AUTH_KEYS = ["auraStaffAccessToken", "auraStaffRefreshToken", "auraStaffSession", "auraStaffBiometricEnabled", "auraStaffBiometricCredentialId"];
export const STAFF_APP_VERSION = "0.1.0";
export type StaffAppReleasePolicy = { currentVersion: string; minimumVersion: string; latestVersion: string; updateUrl: string; blocked: boolean };
export type StaffCopilotTool = { name: string; domain: string; title: string; description: string; requiredPermission: string };
export type StaffCopilotAnswer = {
  conclusion: string; toolName: string; domain: string; crmLink: string; updatedAt: string;
  scope: { level: string; label: string; branchCount: number; branchesIncluded: string[]; narrowed: boolean };
  period: { startDate: string; endDate: string; label: string; comparisonLabel: string; days: number };
  metrics: Array<{ key: string; label: string; value: number; displayValue: string; unit: string }>;
  comparison: Array<{ key: string; label: string; displayCurrent: string; displayPrevious: string; changePercent: number | null; direction: string }>;
  reasons: string[]; notices: string[];
  confidence: { score: number; level: string; dataSufficient: boolean; notes: string[] };
  recommendedActions: Array<{ actionType: string; label: string; description: string; requiresApproval: boolean; crmLink: string }>;
};

export type MutationResult<T> =
  | { state: "completed"; data: T }
  | { state: "queued"; queueId: string; idempotencyKey: string };

export function isQueuedMutation<T>(result: MutationResult<T>): result is Extract<MutationResult<T>, { state: "queued" }> {
  return result.state === "queued";
}

export type OfflineQueueState = "pending" | "syncing" | "permanent-failure" | "conflict";
export type StaffOfflineCapability = { feature: string; classification: "Offline readable" | "Offline queueable" | "Online-only" | "Forbidden offline"; reason: string };
export type StaffOfflineAction = { queueId: string; path: string; state: OfflineQueueState; queuedAt: string; lastError?: string };
export const STAFF_OFFLINE_CAPABILITIES: readonly StaffOfflineCapability[] = [
  { feature: "App shell and static assets", classification: "Offline readable", reason: "Versioned service-worker shell only." },
  { feature: "Own daily schedule, tasks and attendance state", classification: "Offline readable", reason: "Encrypted user, tenant and branch-bound snapshot." },
  { feature: "Task status, leave request, break and notification status", classification: "Offline queueable", reason: "Allowlisted payload with device idempotency and server reconciliation." },
  { feature: "Appointment and queue viewing", classification: "Online-only", reason: "Availability and status must remain server-current." },
  { feature: "Appointment create, edit, cancel and execution", classification: "Forbidden offline", reason: "Conflict, resource and price validation require the server." },
  { feature: "Clock-in, clock-out and location attendance", classification: "Forbidden offline", reason: "Business time, GPS and device integrity require server validation." },
  { feature: "Guest profiles, forms, photos and files", classification: "Forbidden offline", reason: "Sensitive guest content is never placed in the device cache." },
  { feature: "POS, payment, payroll and earnings", classification: "Forbidden offline", reason: "Financial truth and payment authorization remain online-only." },
  { feature: "Chat send and attachments", classification: "Online-only", reason: "Permission and attachment access are checked when opened." },
  { feature: "Settings, branch switch and session management", classification: "Online-only", reason: "Backend-authoritative security state." }
];
type ReadCacheEntry<T> = {
  expiresAt: number;
  value?: T;
  promise?: Promise<T>;
};
type OfflineSnapshot<T> = { cachedAt: string; value: T };
type OfflineQueueEntry = {
  queueId: string;
  idempotencyKey: string;
  userId: string;
  tenantId: string;
  branchId: string;
  method: "POST" | "PATCH";
  path: string;
  body: Record<string, unknown>;
  state: OfflineQueueState;
  queuedAt: string;
  deviceTimeMs: number;
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

export function scheduledShiftMinutes(start1: string, end1: string, start2 = "", end2 = ""): number | null {
  let total = 0;
  let captured = false;
  for (const [start, end] of [[start1, end1], [start2, end2]]) {
    const from = /^(\d{1,2}):(\d{2})/.exec(start);
    const to = /^(\d{1,2}):(\d{2})/.exec(end);
    if (!from || !to) continue;
    const [fromHour, fromMinute, toHour, toMinute] = [Number(from[1]), Number(from[2]), Number(to[1]), Number(to[2])];
    if (fromHour > 23 || toHour > 23 || fromMinute > 59 || toMinute > 59) continue;
    const fromMinutes = fromHour * 60 + fromMinute;
    const toMinutes = toHour * 60 + toMinute;
    if (toMinutes <= fromMinutes) continue;
    total += toMinutes - fromMinutes;
    captured = true;
  }
  return captured ? total : null;
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
  "staff.app.rules.read": ["staff.self_manage", "staff_self.write", "read:staff"],
  "staff.app.attendance.read": ["staff.app.attendance.manage", "staff.attendance.read", "staff.self_manage", "allow:staff-checkin-checkout", "read:staff"],
  "staff.app.attendance.manage": ["staff.self_manage", "staff_self.write", "allow:staff-checkin-checkout", "write:staff"],
  "staff.app.roster.read": ["staff.schedule.read", "staff.self_manage", "read:staff"],
  "staff.app.roster.manage": ["staff.self_manage", "staff_self.write", "write:staff", "update:staff"],
  "staff.app.calendar.read": ["staff.schedule.read", "staff.self_manage", "read:staff"],
  "staff.app.calendar.manage": ["staff.self_manage", "staff_self.write", "write:staff", "update:staff"],
  "staff.app.performance.read": ["staff.analytics.read", "staff.self_manage", "read:staff"],
  "staff.app.leaderboard.read": ["staff.analytics.read", "staff.self_manage", "read:staff"],
  "staff.app.notifications.read": ["notifications.read", "staff.self_manage", "read:staff"],
  "staff.app.notifications.manage": ["notifications.manage", "staff.self_manage", "staff_self.write", "write:staff", "update:staff"],
  "staff.app.reports.read": ["reports.read", "staff.self_manage", "read:staff"],
  "staff.app.chat.read": ["staff.self_manage", "staff_self.write", "read:staff"],
  "staff.app.chat.manage": ["staff.self_manage", "staff_self.write", "write:staff"],
  "staff.app.payroll.read": ["staff.payroll.read", "finance.read", "read:payroll", "read:finance"],
  "staff.app.payroll.costs.read": ["staff.payroll.costs.read"],
  "staff.app.payroll.deductions.read": ["staff.payroll.deductions.read", "staff.payroll.read", "read:payroll"],
  "staff.app.payroll.documents.read": ["staff.payroll.documents.read", "staff.payroll.read", "read:payroll"],
  "staff.app.tips.dispute.manage": ["staff.tips.dispute.manage", "staff.payroll.read", "read:payroll"],
  "staff.app.leaves.read": ["staff.leave.read", "staff.self_manage", "read:staff"],
  "staff.app.leaves.manage": ["staff.leave.manage", "staff.self_manage", "staff_self.write", "write:staff", "update:staff"],
  "staff.app.feedback.read": ["staff.self_manage", "staff_self.write", "read:staff"],
  "staff.app.feedback.manage": ["staff.self_manage", "staff_self.write", "write:staff"],
  "staff.app.surveys.read": ["staff.self_manage", "staff_self.write", "read:staff"],
  "staff.app.surveys.manage": ["staff.self_manage", "staff_self.write", "write:staff"],
  "staff.app.profile.read": ["staff.self_manage", "staff_self.write", "read:staff"],
  "staff.app.profile.manage": ["staff.self_manage", "staff_self.write", "write:staff", "update:staff"],
  "staff.app.settings.read": ["staff.self_manage", "staff_self.write", "read:staff"],
  "staff.app.settings.manage": ["staff.self_manage", "staff_self.write", "write:staff", "update:staff"],
  "staff.app.pos.read": ["pos.read", "read:pos"],
  "staff.app.pos.manage": ["pos.manage", "write:pos"],
  "staff.app.pos.lifecycle.manage": ["pos.refund", "pos.void", "write:pos"],
  "staff.app.register.read": ["cash-drawer.read", "read:pos"],
  "staff.app.register.manage": ["cash-drawer.manage", "write:pos"],
  "staff.app.register.approve": ["cash-drawer.approve", "admin:pos"]
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
  branches?: StaffBranchAccess[];
  permissions?: string[];
  deniedPermissions?: string[];
};

export type StaffAppointment = {
  id: string;
  staffId: string;
  branchId: string;
  clientId?: string;
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
  requestedStaffId?: string;
  staffPreference?: string;
  serviceSelections?: Record<string, { variantId?: string; addonIds?: string[] }>;
  chairRoomId?: string;
  notes?: string;
  bookingGroupId?: string;
  version?: number;
  bookingType?: string;
  dayPackageId?: string;
  hostClientId?: string;
  groupName?: string;
  groupNotes?: string;
  surprise?: boolean;
  virtualMeetingUrl?: string;
  serviceMode?: string;
  segmentLabel?: string;
  sequenceNo?: number;
  executionStatus?: string;
  serviceStartedAt?: string;
  servicePausedAt?: string;
  pausedSeconds?: number;
  serviceCompletedAt?: string;
};

export type StaffAppointmentBook = {
  selfStaffId: string;
  from: string;
  to: string;
  appointments: StaffAppointment[];
  appointmentTotal: number;
  staff: Array<{ id: string; name: string; jobTitle: string }>;
  services: Array<{
    id: string; name: string; category: string; durationMinutes: number; pricePaise: number;
    staffIds: string[]; variants: Array<Record<string, unknown>>; addons: Array<Record<string, unknown>>;
    staffPrices: Array<Record<string, unknown>>;
  }>;
  packages: Array<{ id: string; name: string; serviceIds: string[]; serviceRows: Array<Record<string, unknown>>; pricePaise: number }>;
  resources: Array<{ id: string; name: string; kind: string; department: string; active: boolean }>;
  clients: Array<{ id: string; code: string; name: string; phone: string; email: string; preferredStaffId: string }>;
  schedules: Array<Record<string, unknown>>;
  blockouts: Array<Record<string, unknown>>;
  waitlist: Array<Record<string, unknown>>;
  onlineRequests: Array<Record<string, unknown>>;
  permissions: { manage: boolean; teamRead: boolean; teamManage: boolean; priceManage: boolean; clientCreate: boolean };
};

export type StaffAppointmentOperations = {
  appointment: StaffAppointment;
  activity: Array<Record<string, unknown>>;
  adjacentVisits: Array<Record<string, unknown>>;
  forms: { required: boolean; complete: boolean; requiredCount: number; completedCount: number };
  consumables: { required: boolean; pendingApproval: boolean; recorded: boolean };
  checkout: null | { saleId: string; status: string; totalPaise: number; paidPaise?: number };
  permissions: { teamManage: boolean };
};

export type StaffPosSale = {
  id: string; invoiceNumber: string; subtotalPaise: number; billDiscountPaise: number; couponCode: string;
  couponDiscountPaise: number; discountPaise: number; taxPaise: number; tipPaise: number; roundOffPaise: number;
  totalPaise: number; paidPaise: number; balanceDuePaise: number; status: string; finalizedAt?: string | null;
};

export type StaffPosCheckout = {
  checkout: {
    sale: StaffPosSale;
    invoice: StaffPosSale;
    lines: Array<{ id: string; lineType: string; itemId: string; itemName: string; quantity: number; unitPricePaise: number; discountPaise: number; taxPercent: number; lineTotalPaise: number }>;
    payments: Array<{ id: string; method: string; amountPaise: number; methodReference: string; label: string; paidAt: string }>;
    paymentSplit: { cashPaise: number; upiPaise: number; cardPaise: number; bankTransferPaise: number; walletPaise: number; giftCardPaise: number; storeCreditPaise: number; otherPaise: number; totalPaidPaise: number; balanceDuePaise: number };
  };
  packageCredits: Array<{ id: string; packageName: string; serviceName: string; remainingQuantity: number; expiresAt?: string | null }>;
  membershipCredits: Array<{ id: string; membershipName: string; serviceName: string; remainingQuantity: number; expiresAt?: string | null }>;
  paymentMethods: Array<{ id: string; code: string; name: string; referenceRequired: boolean }>;
  providers: string[];
  paymentInstruments: Array<{ id: string; provider: string; methodType: string; brand: string; last4: string; expiryMonth?: number | null; expiryYear?: number | null; recurringEnabled: boolean; status: string }>;
  tipSplits: Array<{ staffId: string; amountPaise: number }>;
  groupInvoice: boolean;
  offlinePaymentsAllowed: boolean;
  permissions: { manage: boolean; lifecycle: boolean };
};

export type StaffCashDrawer = {
  id: string; businessDate: string; openingCashPaise: number; expectedCashPaise?: number | null;
  countedCashPaise?: number | null; variancePaise?: number | null; status: string; blind: boolean;
};

export type StaffScribeSuggestion = { fieldKey: string; label: string; value: string; evidence: string; confidence: string };
export type StaffScribeSession = {
  id: string; appointmentId: string; clientId: string; staffId: string; serviceId: string;
  formDefinitionId: string; formSubmissionId: string | null; guestParticipant: boolean;
  consentVersion: string; consentStatus: "granted" | "refused" | "revoked"; consentName: string;
  status: "consent_granted" | "refused" | "recording" | "processing" | "draft_ready" | "approved" | "revoked" | "discarded" | "failed";
  durationSeconds: number; provider: string; model: string; languageCode: string;
  providerErrorCode: string; transcript: string;
  structuredSummary: Record<string, unknown>; formSuggestions: StaffScribeSuggestion[];
  version: number;
};
export type StaffScribeEvent = { id: string; eventType: string; actorUserId: string; details: Record<string, unknown>; createdAt: string };

export type StaffGuestFormField = {
  key: string;
  label: string;
  type: "text" | "textarea" | "boolean" | "date" | "number" | "select" | "signature" | "table" | "clinical" | "section";
  required?: boolean;
  options?: string[];
  min?: number;
  max?: number;
  columns?: Array<{ key: string; label: string; type?: "text" | "number" | "date" | "boolean" }>;
  sectionKey?: string;
  visibleWhen?: { fieldKey: string; equals: string | boolean | number };
};

export type StaffGuestFormDefinition = {
  id: string; formKey: string; name: string; formType: string; version: number; body: string;
  fieldsJson: StaffGuestFormField[]; requiresSignature: boolean; scopeType: string; scopeIdsJson: string[];
  required: boolean; validForDays?: number | null; reviewRequired: boolean; staffModeAllowed: boolean; guestModeAllowed: boolean;
};

export type StaffGuestFormSubmission = {
  id: string; definitionId: string; formKey: string; formName: string; formType: string; formVersion: number;
  responsesJson: Record<string, unknown>; appointmentId?: string | null; serviceId: string; membershipId: string; packageId: string;
  mode: "staff" | "guest"; status: "draft" | "submitted"; expiresAt?: string | null; finalizedAt?: string | null;
  correctsSubmissionId?: string | null; correctionReason: string; version: number; reviewStatus: string; reviewNote: string;
  signatureName: string; signedAt?: string | null; submittedAt: string;
};

export type StaffGuest360 = {
  appointmentId: string;
  guest: Record<string, unknown> & {
    id: string; firstName: string; lastName: string; phone: string; email: string; birthday?: string; anniversary?: string;
    summary: Record<string, unknown>; appointments: Array<Record<string, unknown>>; serviceHistory: Array<Record<string, unknown>>;
    clientNotes: Array<Record<string, unknown>>; clinicalProfile?: null | { allergies: string; preferences: string; version: number };
    formDefinitions: StaffGuestFormDefinition[]; formSubmissions: StaffGuestFormSubmission[]; treatmentPhotos: Array<Record<string, unknown>>;
    consentHistory: Array<Record<string, unknown>>;
  };
  relationships: Record<string, unknown>;
  timeline: Array<Record<string, unknown>>;
  formStatuses: Array<{ definitionId: string; formKey: string; name: string; required: boolean; status: string; latestSubmissionId: string; latestVersion: number }>;
  photoConsent?: null | { optedIn: boolean; reason: string; recordedAt: string };
  profilePhotoId: string;
  permissions: { contactRead: boolean; notesManage: boolean; clinicalRead: boolean; clinicalManage: boolean; formsRead: boolean; formsManage: boolean; formsReview: boolean; photosRead: boolean; photosManage: boolean; consentManage: boolean };
};

export type StaffAppointmentQuote = {
  lines: Array<{ appointmentId: string; serviceId: string; pricePaise: number; calculatedPricePaise: number }>;
  totalPaise: number;
  eligibility: null | {
    clientId: string; clientName: string; walletPaise: number; unpaidPaise: number;
    membershipName: string; hasActiveMembership: boolean; membershipCredits: unknown; packageCredits: unknown;
  };
  deposit: { required: boolean; depositPaise: number; depositType: string; depositValue: number };
};

export type StaffDashboard = {
  lifecycle: Record<string, unknown>;
  staff: {
    id: string;
    fullName: string;
    firstName: string;
    lastName: string;
    mobile: string;
    email: string;
    photoUrl: string;
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
  performance: { revenue: number | null; completedServices: number; avgUtilization: number | null; avgRating: number | null; productivityScore: number | null; strengths: string[]; opportunities: string[]; appointmentsCount?: number; completionPercent?: number | null; targetRevenuePaise?: number | null; revenueTargetPercent?: number | null; uniqueClients?: number; repeatClients?: number; repeatClientPercent?: number | null; presentDays?: number; absentDays?: number; workedMinutes?: number; overtimeMinutes?: number; lateMinutes?: number; earlyLeaveMinutes?: number; operationTaskCompleted?: number; operationTaskMissed?: number; revenueOpportunities?: Array<{ key: string; title: string; reason: string; suggestedAction: string; ownerStaffId: string; ownerStaffName: string; metricUnit: string; currentValue: number; targetValue: number; projectedImpactPaise: number | null; deadline: string; priority: string; status: string; goalId?: string | null; actionId?: string | null; actionStatus?: string | null; baselineValue?: number | null; actualValue: number; actualImpactPaise?: number | null }>; equipmentIntelligence?: { summary: { activeResources: number; unassignedAppointments: number; shortageDepartments: number; equipmentLostBookings: number; estimatedAdditionalAppointments: number; estimatedRevenuePaise: number | null }; departments: Array<{ department: string; appointments: number; unassignedAppointments: number; bookedMinutes: number; peakHourlyDemand: number; activeResources: number; inactiveResources: number; capacityShortage: number; equipmentLostBookings: number; estimatedAdditionalAppointments: number; estimatedRevenuePaise: number | null }>; resources: Array<{ id: string; name: string; kind: string; department: string; active: boolean; appointments: number; bookedMinutes: number; demandWindowUtilizationPercent: number | null }>; recommendations: Array<{ key: string; title: string; reason: string; actionType: string; estimatedAdditionalAppointments: number; estimatedRevenuePaise: number | null }> } };
  leaderboard: Array<{ rank: number; staffId: string; staffName: string; revenue: number | null; score: number; rating: number | null; points: number; days: number; isMe: boolean; scoreComponents: Array<{ key: string; weightPercent: number; value: number | null; source: string }>; scoreExplanation: string }>;
  gamification: { points: number; level: number; stars: number; activeDays?: number; dailyStreak: number; monthlyStreak: number; badges: Array<{ label: string; description: string; earned: boolean }>; sourceStatus?: { appointments: boolean; attendance: boolean; schedule: boolean; clients: boolean; revenueTarget: boolean; sharedReview: boolean } };
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
  productInvoiceCount: number | null;
  retailConversionPercent: number | null;
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

export type StaffNotificationPreferences = {
  staffId: string;
  workingDayOnly: boolean;
  inAppEnabled: boolean;
  webPushEnabled: boolean;
  fcmEnabled: boolean;
  apnsEnabled: boolean;
  mutedCategories: string[];
  quietHoursStart: string | null;
  quietHoursEnd: string | null;
  dailyStartEnabled: boolean;
  dailyEndEnabled: boolean;
  dailyStartTime: string;
  dailyEndTime: string;
  version: number;
};

export type StaffNotificationCenter = {
  preferences: StaffNotificationPreferences;
  channels: Record<"inApp" | "webPush" | "fcm" | "apns", { enabled: boolean; configured: boolean; devices: number }>;
  notifications: Array<{ id: string; title: string; body: string; status: "read" | "unread"; type: string; category: string; resourceType: string; resourceId: string; metadata: Record<string, unknown>; createdAt: string }>;
  deliveryLogs: Array<{ id: string; channel: string; provider: string; status: string; attempt: number; providerMessageId: string; error: string; createdAt: string }>;
  dailyWorkflow: {
    businessDate: string;
    start: { todayGuests: number; specificRequests: number; newGuests: number; scheduledMinutes: number; gapMinutes: number; requiredForms: number; stockAlerts: number; serviceAlerts: number; pendingTasks: number };
    end: { completedServices: number; salesPaise: number; commissionPaise: number; tipsPaise: number; missingCheckout: number; missingForms: number; missingConsumables: number };
  };
  generatedAt: string;
};

export type StaffPerformanceMetric = {
  key: string;
  label: string;
  value: number | null;
  unit: "count" | "percent" | "rating" | "paise";
  numerator: number;
  denominator: number | null;
  explanation: string;
  source: string;
  custom?: boolean;
};

export type StaffPerformanceDashboard = {
  range: { from: string; to: string; basis: "sale_date" | "close_date"; timeZone: "Asia/Kolkata" };
  generatedAt: string;
  dataFreshnessAt: string | null;
  settings: { visibleMetricKeys: string[]; customMetrics: Array<{ key: string; label: string; sourceMetricKey: string }>; version: number };
  metrics: StaffPerformanceMetric[];
  trends: Array<{ date: string; completedServices: number; utilizationPercent: number | null; serviceRevenuePaise: number | null; productRevenuePaise: number | null }>;
  score: { value: number | null; grade: string; explanation: string; components: Array<{ key: string; weightPercent: number; value: number | null; source: string }> };
  goals: Array<{ id: string; goalType: string; metricUnit: string; targetValue: number; currentValue: number | null; dueDate: string; status: string; actions: Array<{ id: string; title: string; status: string }> }>;
  coaching: Array<{ title: string; reason: string; evidenceSource: string; punitive: boolean }>;
  skills: { staffId: string; staffName: string; jobTitle: string; roles: Array<Record<string, unknown>>; services: Array<Record<string, unknown>> } | null;
  training: { courses: Array<Record<string, unknown>>; enrolments: Array<Record<string, unknown>>; requirements: Array<Record<string, unknown>>; skillMatrix: Array<Record<string, unknown>>; recommendations: Array<Record<string, unknown>> };
  payPeriods: Array<{ id: string; label: string; from: string; to: string; status: string }>;
  safeguards: { excludedFromScore: true; burnout: { score: number; level: string; evidence: string[] } | null; retention: { score: number; level: string; evidence: string[] } | null; explanation: string };
};

export type StaffBranchAccess = {
  branchId: string;
  branchName?: string;
  roleName?: string;
  permissions?: string[];
  deniedPermissions?: string[];
  isDefault?: boolean;
};

export type StaffAppraisal = {
  id: string;
  cycleId: string;
  cycleName: string;
  periodStart: string;
  periodEnd: string;
  templateName: string;
  keyResults: Array<{ id: string; title: string; metricUnit: string; targetValue: number; weightBasisPoints: number; currentValue: number | null; evidence: string }>;
  selfScore: number | null;
  selfComments: string;
  managerScore: number | null;
  managerComments: string;
  finalScore: number | null;
  finalRating: string;
  status: string;
  version: number;
  approvedAt: string | null;
  acknowledgedAt: string | null;
};

export type StaffRosterItem = StaffEnterpriseOs["calendar"][number];

export type StaffBusinessRecipeLine = {
  productId?: string;
  itemId?: string;
  inventoryItemId?: string;
  standardQty?: number;
  quantity?: number;
  qty?: number;
  maxQty?: number;
};

export type StaffBusinessProduct = {
  id: string;
  name: string;
  brand: string;
  unit: string;
  stockQuantity: number;
  reorderPoint: number;
  dualUseStock: boolean;
};

export type StaffProductUsage = {
  id: string;
  inventoryItemId: string;
  itemName: string;
  itemBrand: string;
  appointmentId?: string;
  serviceId?: string;
  serviceName: string;
  expectedQuantity: number;
  actualQuantity: number;
  wastedQuantity: number;
  selectedBatchId?: string;
  varianceQuantity: number;
  unit: string;
  status: string;
  notes: string;
  createdAt: string;
};

export type StaffServiceRecipeLine = {
  serviceId: string; serviceName: string; inventoryItemId: string; itemName: string; unit: string;
  expectedQuantity: number; minQuantity: number; maxQuantity: number; wastePercent: number;
  trackAutomatically: boolean; allowManualOverride: boolean; stockQuantity: number; reorderPoint: number;
  lowStock: boolean; batchTracked: boolean;
  batches: Array<{ id: string; batchNumber: string; barcode: string; expiryDate?: string | null; quantity: number }>;
};

export type StaffRetailRecommendation = {
  id: string; name: string; brand: string; sku: string; barcode: string; barcodes: string[]; unit: string;
  availableStock: number; reorderPoint: number; retailPricePaise: number; gstPercent: number; hsnCode: string;
  previouslyPurchased: boolean;
};

export type StaffServiceWorkspace = {
  appointmentId: string;
  visit: {
    providerInstructions: string; serviceSelections: Record<string, unknown>;
    resource: Record<string, unknown>;
    services: Array<{ id: string; name: string; category: string; durationMinutes: number; bookedPricePaise: number; variant: Record<string, unknown>; addons: Array<Record<string, unknown>> }>;
  };
  recipes: StaffServiceRecipeLine[];
  usage: StaffProductUsage[];
  products: StaffRetailRecommendation[];
  offers: {
    memberships: Array<{ id: string; name: string; pricePaise: number; alreadyOwned: boolean }>;
    packages: Array<{ id: string; name: string; pricePaise: number; availableCredits: number }>;
  };
  invoice: null | { saleId: string; status: string; totalPaise: number; lines: Array<{ id: string; lineType: string; itemId: string; itemName: string; staffId: string; quantity: number; unitPricePaise: number; lineTotalPaise: number }> };
  permissions: { consumablesManage: boolean; consumablesReview: boolean; upsellManage: boolean; priceManage: boolean };
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
  services: Array<{ id: string; name: string; category: string; productConsumption: StaffBusinessRecipeLine[] }>;
  products: StaffBusinessProduct[];
  productUsageHistory: StaffProductUsage[];
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
  defaults: { staffHints: boolean; calendarSyncEnabled: boolean };
};

export type StaffWorkspacePreferenceUpdate = {
  workspaceName?: string;
  timezone?: string;
  locale?: string;
  dateFormat?: string;
  timeFormat?: string;
  compactMode?: boolean;
  staffHints?: boolean;
  calendarSyncEnabled?: boolean;
};

export type StaffSelfProfile = {
  staffId: string;
  email: string;
  mobile: string;
  photoUrl: string;
  emailVerified: boolean;
  phoneVerified: boolean;
};

export type StaffSecuritySession = {
  sessionId: string;
  userId: string;
  branchId?: string;
  roleName?: string;
  deviceId?: string;
  ipAddress?: string;
  userAgent?: string;
  createdAt: string;
  lastUsedAt?: string;
  expiresAt: string;
};

export type StaffSecurityDevice = {
  userId: string;
  deviceId: string;
  status: string;
  activeSessions: number;
  ipCount: number;
  userAgentCount: number;
  firstSeenAt?: string;
  lastSeenAt?: string;
  trustedAt?: string;
  revokedAt?: string;
};

export type StaffSecurityContext = {
  staffId: string;
  staffName: string;
  currentSessionId: string;
  currentDeviceId: string;
  pinConfigured: boolean;
  inactivityMinutes: number;
  contactVerificationRequired: boolean;
  geofence: { mode: "full_access" | "read_only" | "blocked"; radiusMeters: number; locationConfigured: boolean; roleExempt: boolean };
  sessions: StaffSecuritySession[];
  devices: StaffSecurityDevice[];
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
  cashTipPaise?: number;
  sessionCount?: number;
  sessions?: Array<{ id: string; clockInAt: string; clockOutAt: string; workTaskName: string; payRatePaise: number; source: string }>;
};

export type StaffAttendanceClockOptions = {
  workTasks: Array<{ id: string; taskName: string; payRatePaise: number; version: number }>;
  policy: { hasSchedule: boolean; scheduleStart?: string; scheduledClockInMode: string; unscheduledClockInMode: string; earlyClockInMinutes: number; mandatoryBreakAfterMinutes: number; mandatoryBreakMinutes: number; automaticBreakEnabled: boolean; forgotClockOutMinutes: number };
  warnings: string[];
};

export type StaffAttendanceCorrection = {
  id: string; staffId: string; staffName: string; businessDate: string; requestedClockInAt: string; requestedClockOutAt: string;
  requestedWorkTaskRateId?: string; workTaskName: string; reason: string; status: string; reviewNote: string; version: number; createdAt: string;
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

export type StaffTask = {
  id: string;
  title: string;
  description: string;
  taskType: string;
  status: string;
  priority: string;
  dueAt: string;
  version: number;
  clientId?: string;
  appointmentId?: string;
};

export type StaffFieldJob = {
  id: string;
  address: string;
  status: string;
  scheduledStartAt?: string;
  travelMinutes: number;
  routeDistanceMeters?: number;
  remainingEtaSeconds?: number;
  priority: number;
  slaDueAt?: string;
  proofSubmittedAt?: string;
  clientName: string;
  serviceNames: string;
};

export type StaffToday = {
  date: string;
  schedules: Array<{ id: string; scheduleDate: string; startTime: string; endTime: string; shiftType: string; status: string }>;
  attendance: StaffAttendance[];
  activeBreak: { id: string; status: string; startedAt?: string } | null;
  tasks: StaffTask[];
};

export type StaffAttendanceToday = Omit<StaffToday, "tasks">;

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
  statutoryEmployerPay: number;
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

export type StaffEarningsDetail = {
  periodStart: string;
  periodEnd: string;
  basis: "sale_date" | "close_date";
  calculatedUpTo?: string;
  visibility: { costs: boolean; deductions: boolean };
  indiaPayout: { currency: "INR"; supportedMethods: string[]; zenotiWallet: "not_applicable" };
  commissions: Array<{ id: string; saleId: string; saleLineId: string; invoiceNumber: string; itemType: string; itemName: string; basePaise: number; commissionPaise: number; ratePercent: number; splitBps: number; ruleName: string; saleDate: string; closeDate: string; status: string; freeService: boolean; noShowOrCancellation: boolean }>;
  tips: Array<{ saleId: string; invoiceNumber: string; businessDate: string; source: string; amountPaise: number; payoutId?: string; payoutStatus: string; payoutMethod: string; payoutReference: string; reconciledAt?: string }>;
  declaredTips: Array<{ sessionId: string; businessDate: string; amountPaise: number; declaredAt: string }>;
  tipPayouts: Array<{ id: string; periodStart: string; periodEnd: string; amountPaise: number; payoutReference: string; payoutMethod: string; status: string; providerReference: string; recordedAt: string; reconciledAt?: string }>;
  tipDisputes: Array<{ id: string; saleId?: string; payoutId?: string; reason: string; status: string; resolutionNote: string; createdAt: string; resolvedAt?: string }>;
  advances: Array<{ id: string; requestedAmountPaise: number; approvedAmountPaise: number; disbursedAmountPaise: number; outstandingPaise: number; installmentAmountPaise: number; status: string; recoveryStartPeriod?: string; reason: string; disbursementMethod: string; disbursementReference: string; createdAt: string; disbursedAt?: string; recoveries: Array<{ id: string; payrollRunId: string; periodStart: string; periodEnd: string; scheduledPaise: number; recoveredPaise: number; carriedForwardPaise: number; outstandingAfterPaise: number; applied: boolean; recordedAt: string }> }>;
  reimbursements: Array<{ id: string; voucherId: string; voucherNumber: string; businessDate: string; amountPaise: number; status: string; paymentMode: string; reference: string; remarks: string }>;
};

export type StaffPayrollDocument = { id: string; documentType: string; documentName: string; expiryDate?: string; createdAt: string; downloadPath: string };

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

export type StaffRuleDocument = {
  id: string;
  documentKey: string;
  documentType: "rule" | "sop";
  category: "service" | "hygiene" | "attendance" | "behavior" | "safety";
  title: string;
  content: string;
  documentVersion: number;
  effectiveDate: string;
  expiresOn: string | null;
  mandatoryAcknowledgement: boolean;
  trainingAttachmentUrl: string;
  quiz: Array<{ id: string; question: string; options: string[] }>;
  quizPassScore: number;
  readAt: string | null;
  acknowledgedAt: string | null;
  quizScore: number | null;
  quizPassed: boolean | null;
  isCourse: boolean;
  skillName: string;
  skillLevel: number;
  expectedMinutes: number;
  certificationValidDays: number;
  enrolmentStatus: string | null;
  enrolmentDueAt: string | null;
  trainingCompletedAt: string | null;
};

export type StaffRuleStatus = {
  id: string;
  documentId: string;
  staffId: string;
  firstReadAt: string | null;
  lastReadAt: string | null;
  acknowledgedAt: string | null;
  quizScore: number | null;
  quizPassed: boolean | null;
  version: number;
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
  requestedDays?: number;
  dayParts?: Array<{ date: string; startTime?: string; endTime?: string }>;
  version: number;
  createdAt: string;
};

export type StaffSurveyQuestion = { id: string; prompt: string; type: "text" | "rating" | "single_choice"; options?: string[] };
export type StaffSurvey = {
  id: string;
  title: string;
  description: string;
  questions: StaffSurveyQuestion[];
  startsAt: string | null;
  endsAt: string | null;
  answered: boolean;
  answers: Record<string, string | number>;
  submittedAt: string | null;
};

export type StaffLeaveAccrual = { id: string; leaveType: string; effectiveDate: string; days: number; eventType: string; notes: string; createdAt: string };

export type StaffScheduleBlockout = { id: string; staffId: string; startsAt: string; endsAt: string; reason: string; version: number };

export type StaffShiftSwap = {
  id: string; scheduleId: string; scheduleDate: string; shift1Start: string; shift1End: string;
  fromStaffId: string; fromStaffName: string; toStaffId: string; toStaffName: string; reason: string;
  status: string; targetDecision: string; targetDecisionNote: string; decisionNote: string; version: number; createdAt: string;
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
  branches?: StaffBranchAccess[];
};

export type StaffChatConversation = {
  id: string;
  type: "team" | "private-owner" | "direct" | "group" | "broadcast";
  title: string;
  branchId: string;
  participantUserIds: string[] | null;
  messageCount: number;
  unreadCount: number;
  canSend: boolean;
  lastMessageAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type StaffConversationMessage = {
  id: string;
  conversationId: string;
  type: "team" | "private-owner" | "direct" | "group" | "broadcast";
  senderUserId: string;
  senderName: string;
  body: string;
  shareType: "appointment" | "invoice" | "guest" | null;
  shareId: string | null;
  attachmentId: string | null;
  attachmentFileName: string | null;
  attachmentContentType: string | null;
  attachmentExpiresAt: string | null;
  readByCount: number;
  createdAt: string;
};

export type StaffChatParticipant = { userId: string; name: string; jobTitle: string };
export type StaffChatAttachment = { id: string; fileName: string; contentType: string; byteSize: number; expiresAt: string };

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
  lifecycle?: Record<string, unknown>;
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
  private readonly offlineStore = new StaffOfflineStore();
  private accessTokenValue = "";
  private tenantIdValue = "";
  private refreshPromise: Promise<void> | null = null;
  private flushPromise: Promise<number> | null = null;
  private readonly getCache = new Map<string, ReadCacheEntry<unknown>>();
  private readonly tabId = crypto.randomUUID();
  private readonly faceDeviceStorageKey = "auraStaffFaceDeviceId";
  private staffLocation: { latitude: number; longitude: number; accuracy: number } | null = null;
  readonly loading = signal(false);
  readonly error = signal("");
  readonly user = signal<StaffUser | null>(null);
  readonly profile = signal<StaffDashboard["staff"] | null>(null);
  readonly biometricEnabled = signal(!!this.readBiometricHint());
  readonly biometricLocked = signal(false);
  readonly passwordChangeRequired = signal(false);
  readonly mfaEnrollmentRequired = signal(false);
  readonly mfaSetup = signal<StaffMfaSetup | null>(null);
  readonly securityContext = signal<StaffSecurityContext | null>(null);
  readonly offlineQueueCount = signal(0);
  readonly offlineSnapshotAt = signal("");

  constructor(private readonly http: HttpClient) {
    this.purgeLegacyAuthStorage();
    void this.refreshOfflineQueueCount();
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
        deviceId: this.deviceId(),
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
      await this.refreshSecurityContext().catch(() => undefined);
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
    if (!this.isOnline()) return this.cachedOfflineSnapshot<StaffDashboard>(this.offlineDashboardCacheKey(params), "No encrypted offline dashboard is available.");
    return this.cachedRead(
      `dashboard:${stableQueryKey(params)}`,
      10_000,
      async () => {
        this.loading.set(true);
        this.error.set("");
        try {
          const value = await this.withRefreshRetry(async () => {
            const response = await firstValueFrom(this.http.get<RustStaffSelfDashboard | ApiEnvelope<RustStaffSelfDashboard>>(`${this.baseUrl}/staff/self/dashboard`, {
              headers: this.authHeaders(),
              params
            }));
            return this.normalizeDashboard(this.unwrap(response));
          });
          const offlineKey = this.scopedOfflineDashboardCacheKey(params);
          if (offlineKey) await this.writeOfflineSnapshot(offlineKey, value);
          return value;
        } catch (error) {
          if (error instanceof HttpErrorResponse && error.status === 0) return this.cachedOfflineSnapshot<StaffDashboard>(this.offlineDashboardCacheKey(params), "No encrypted offline dashboard is available.");
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

  async performance(query: { from: string; to: string; basis: "sale_date" | "close_date" }): Promise<StaffPerformanceDashboard> {
    return this.cachedRead(`performance:${stableQueryKey(query)}`, 10_000, () => this.get<StaffPerformanceDashboard>("/staff-self/performance", query));
  }

  async appraisals(): Promise<StaffAppraisal[]> {
    return this.get<StaffAppraisal[]>("/staff-self/appraisals");
  }

  async submitSelfReview(id: string, keyResults: Array<{ id: string; currentValue: number; evidence?: string }>, comments: string, version: number): Promise<StaffAppraisal> {
    const saved = await this.patch<StaffAppraisal>(`/staff-self/appraisals/${encodeURIComponent(id)}/self-review`, { keyResults, comments, version });
    this.clearGetCache();
    return saved;
  }

  async acknowledgeAppraisal(id: string, version: number): Promise<StaffAppraisal> {
    const saved = await this.patch<StaffAppraisal>(`/staff-self/appraisals/${encodeURIComponent(id)}/acknowledge`, { version });
    this.clearGetCache();
    return saved;
  }

  async roster(from: string, to: string): Promise<StaffRosterItem[]> {
    return this.get<StaffRosterItem[]>("/staff/self/roster", { from, to });
  }

  async calendar(from: string, to: string): Promise<StaffRosterItem[]> {
    return this.get<StaffRosterItem[]>("/staff/self/calendar", { from, to });
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

  async selfProfile(): Promise<StaffSelfProfile> {
    return this.get<StaffSelfProfile>("/staff/self/profile");
  }

  async updateSelfProfile(input: { email?: string; mobile?: string; mfaCode?: string; currentPassword?: string }): Promise<StaffSelfProfile> {
    const saved = await this.patch<StaffSelfProfile>("/staff/self/profile", input);
    this.profile.update((profile) => profile ? { ...profile, email: saved.email, mobile: saved.mobile, photoUrl: saved.photoUrl } : profile);
    this.user.update((user) => user ? { ...user, email: saved.email } : user);
    return saved;
  }

  async requestContactVerification(contactType: "email" | "phone"): Promise<{ sent: boolean; target: string; expiresIn: number }> {
    return this.post("/staff/self/profile/contact-verification/request", { contactType });
  }

  async verifyContactVerification(contactType: "email" | "phone", code: string): Promise<void> {
    await this.post("/staff/self/profile/contact-verification/verify", { contactType, code });
    this.clearGetCache();
  }

  async uploadSelfProfilePhoto(file: File): Promise<{ fileId: string; fileUrl: string }> {
    if (!file.size || file.size > 5 * 1024 * 1024) throw new Error("Photo must be 5 MB or smaller.");
    if (!["image/jpeg", "image/png"].includes(file.type)) throw new Error("Photo must be JPG or PNG.");
    const result = await this.withRefreshRetry(async () => {
      const response = await firstValueFrom(this.http.post<{ fileId: string; fileUrl: string } | ApiEnvelope<{ fileId: string; fileUrl: string }>>(
        `${this.baseUrl}/staff/self/profile/photo?kind=photo&fileName=${encodeURIComponent(file.name)}`,
        file,
        { headers: this.authHeaders().set("Content-Type", file.type) }
      ));
      return this.unwrap(response);
    });
    this.clearGetCache();
    return result;
  }

  // --- AI Scribe ---
  // Consent is captured before anything records, and the recording itself is
  // posted as raw bytes: the browser never keeps a copy and neither does the
  // backend, which forwards it to the provider and stores only the transcript.

  async startScribeSession(input: {
    appointmentId: string;
    clientId: string;
    staffId: string;
    serviceId?: string;
    formDefinitionId: string;
    guestParticipant: boolean;
    consentStatus: "granted" | "refused";
    consentName?: string;
    languageCode?: string;
  }): Promise<StaffScribeSession> {
    return this.post<StaffScribeSession>("/staff-scribe/sessions", { ...input });
  }

  async scribeSession(id: string): Promise<StaffScribeSession> {
    return this.get<StaffScribeSession>(`/staff-scribe/sessions/${encodeURIComponent(id)}`);
  }

  async scribeSessionsForAppointment(appointmentId: string): Promise<StaffScribeSession[]> {
    return this.get<StaffScribeSession[]>(`/staff-scribe/appointments/${encodeURIComponent(appointmentId)}/sessions`);
  }

  async scribeEvents(id: string): Promise<StaffScribeEvent[]> {
    return this.get<StaffScribeEvent[]>(`/staff-scribe/sessions/${encodeURIComponent(id)}/events`);
  }

  async uploadScribeRecording(id: string, recording: Blob, durationSeconds: number): Promise<StaffScribeSession> {
    if (!recording.size) throw new Error("The recording is empty.");
    if (recording.size > 25 * 1024 * 1024) throw new Error("Recording must be 25 MB or smaller.");
    if (durationSeconds > 5700) throw new Error("Recording must be 95 minutes or shorter.");
    const result = await this.withRefreshRetry(async () => {
      const response = await firstValueFrom(this.http.post<StaffScribeSession | ApiEnvelope<StaffScribeSession>>(
        `${this.baseUrl}/staff-scribe/sessions/${encodeURIComponent(id)}/transcribe?durationSeconds=${Math.max(0, Math.round(durationSeconds))}`,
        recording,
        { headers: this.authHeaders().set("Content-Type", recording.type || "application/octet-stream") }
      ));
      return this.unwrap(response);
    });
    this.clearGetCache();
    return result;
  }

  /// `responses` are the values the staff member reviewed, not the raw
  /// suggestions; the backend writes exactly what is sent here.
  async approveScribeDraft(id: string, responses: Record<string, unknown>, version: number, signatureName = ""): Promise<StaffScribeSession> {
    return this.post<StaffScribeSession>(`/staff-scribe/sessions/${encodeURIComponent(id)}/approve`, { responses, version, signatureName });
  }

  async revokeScribeConsent(id: string, reason = ""): Promise<{ id: string; status: string; transcriptCleared: boolean }> {
    return this.post(`/staff-scribe/sessions/${encodeURIComponent(id)}/revoke`, { reason });
  }

  async selfProfilePhoto(fileId: string): Promise<Blob> {
    return this.withRefreshRetry(() => firstValueFrom(this.http.get(
      `${this.baseUrl}/staff/self/profile/photo/${encodeURIComponent(fileId)}`,
      { headers: this.authHeaders(), responseType: "blob" }
    )));
  }

  async refreshSecurityContext(): Promise<StaffSecurityContext> {
    const context = await this.loadSecurityContext();
    this.securityContext.set(context);
    if (context.geofence.mode !== "full_access" && !context.geofence.roleExempt && context.geofence.locationConfigured) {
      try {
        const position = await this.currentPosition();
        this.staffLocation = { latitude: position.coords.latitude, longitude: position.coords.longitude, accuracy: position.coords.accuracy };
      } catch {
        this.staffLocation = null;
      }
    } else {
      this.staffLocation = null;
    }
    return context;
  }

  async switchBranch(branchId: string, remember = false): Promise<StaffUser> {
    const loginId = this.user()?.loginId || this.user()?.email || "staff";
    const response = await firstValueFrom(this.http.post<StaffLoginResponse | ApiEnvelope<StaffLoginResponse>>(
      `${this.baseUrl}/auth/switch-branch`,
      { branchId, deviceId: this.deviceId() },
      { headers: this.authHeaders(), withCredentials: true }
    ));
    const session = this.normalizeSession(this.unwrap(response));
    if (!session.accessToken) throw new Error("Branch session token was not returned.");
    this.accessTokenValue = session.accessToken;
    this.tenantIdValue = this.tenantIdFromAccessToken(session.accessToken) || this.tenantIdValue;
    const user = await this.loadUserContext(loginId);
    this.saveSession({ ...session, user }, this.tenantIdValue);
    if (remember) await this.post("/staff/self/preferred-branch", { branchId });
    await this.refreshSecurityContext();
    return user;
  }

  async setDevicePin(pin: string): Promise<void> {
    await this.post("/staff/self/security/pin", { deviceId: this.deviceId(), pin });
    await this.refreshSecurityContext();
  }

  async verifyDevicePin(pin: string): Promise<void> {
    await this.post("/staff/self/security/pin/verify", { deviceId: this.deviceId(), pin });
  }

  async revokeSession(sessionId: string): Promise<{ revoked: boolean; current: boolean }> {
    const result = await this.post<{ revoked: boolean; current: boolean }>(`/staff/self/security/sessions/${encodeURIComponent(sessionId)}/revoke`, {});
    if (result.current) this.clearLocalAuthState(false);
    else await this.refreshSecurityContext();
    return result;
  }

  async revokeDevice(deviceId: string): Promise<void> {
    await this.post(`/staff/self/security/devices/${encodeURIComponent(deviceId)}/revoke`, {});
    if (deviceId === this.deviceId()) this.clearLocalAuthState(true);
    else await this.refreshSecurityContext();
  }

  async business(input: string | StaffBusinessQuery): Promise<StaffBusiness> {
    const query = typeof input === "string" ? { date: input } : input;
    return this.get<StaffBusiness>("/staff-self/business", this.stringQuery(query));
  }

  async businessInvoice(invoiceId: string): Promise<StaffBusinessInvoiceDetail> {
    return this.get<StaffBusinessInvoiceDetail>(`/staff-self/business/invoices/${encodeURIComponent(invoiceId)}`);
  }

  async recordProductUsage(payload: {
    inventoryItemId: string;
    serviceId: string;
    clientId: string;
    appointmentId: string;
    actualQuantity: number;
    wastedQuantity?: number;
    selectedBatchId?: string;
    wasteReason?: string;
    notes: string;
    idempotencyKey: string;
  }): Promise<StaffProductUsage> {
    return this.post<StaffProductUsage>("/staff-self/business/product-usage", payload);
  }

  async serviceWorkspace(id: string, query: { q?: string; barcode?: string } = {}): Promise<StaffServiceWorkspace> {
    return this.get<StaffServiceWorkspace>(`/staff-self/appointments/${encodeURIComponent(id)}/service-workspace`, this.stringQuery(query));
  }

  async reviewProductUsage(id: string, decision: "approve" | "reject", reviewNote: string): Promise<StaffProductUsage> {
    return this.patch<StaffProductUsage>(`/inventory/backbar-usage/${encodeURIComponent(id)}/review`, { decision, reviewNote });
  }

  async addAppointmentInvoiceLine(id: string, payload: { itemType: "product" | "service" | "membership" | "package" | "gift_card"; itemId: string; quantity: number; unitPricePaise?: number; priceReason?: string }): Promise<{ saleId: string; status: string; totalPaise: number }> {
    return this.post(`/staff-self/appointments/${encodeURIComponent(id)}/invoice-lines`, payload);
  }

  async appointmentCheckout(id: string): Promise<StaffPosCheckout> {
    return this.get(`/staff-self/appointments/${encodeURIComponent(id)}/checkout`);
  }

  async updateAppointmentCheckout(id: string, payload: Record<string, unknown>): Promise<StaffPosCheckout["checkout"]> {
    return this.put(`/staff-self/appointments/${encodeURIComponent(id)}/checkout`, payload);
  }

  async addAppointmentPayment(id: string, payload: Record<string, unknown>): Promise<unknown> {
    return this.post(`/staff-self/appointments/${encodeURIComponent(id)}/checkout/payments`, payload);
  }

  async startAppointmentProviderPayment(id: string, payload: Record<string, unknown>): Promise<Record<string, unknown>> {
    return this.post(`/staff-self/appointments/${encodeURIComponent(id)}/checkout/provider-payment`, payload);
  }

  async createAppointmentUpiLink(id: string, payload: Record<string, unknown>): Promise<{ url: string; provider: string; amountPaise: number }> {
    return this.post(`/staff-self/appointments/${encodeURIComponent(id)}/checkout/upi-link`, payload);
  }

  async finalizeAppointmentCheckout(id: string, cashDrawerTillId = ""): Promise<StaffPosCheckout["checkout"]> {
    return this.post(`/staff-self/appointments/${encodeURIComponent(id)}/checkout/finalize`, { cashDrawerTillId });
  }

  async appointmentReceipt(id: string): Promise<{ printHtml: string; pdfFileName: string }> {
    return this.get(`/staff-self/appointments/${encodeURIComponent(id)}/checkout/receipt`);
  }

  async recordAppointmentReceipt(id: string, action: "print" | "email" | "sms" | "whatsapp", recipient = ""): Promise<unknown> {
    return this.post(`/staff-self/appointments/${encodeURIComponent(id)}/checkout/receipt`, { action, recipient });
  }

  async appointmentCheckoutLifecycle(id: string, action: "void" | "refund", request: Record<string, unknown>): Promise<unknown> {
    return this.post(`/staff-self/appointments/${encodeURIComponent(id)}/checkout/lifecycle`, { action, ...request });
  }

  async chargeAppointmentNoShow(id: string, amountPaise: number, provider: string, idempotencyKey: string, reason: string): Promise<unknown> {
    return this.post(`/staff-self/appointments/${encodeURIComponent(id)}/no-show-charge`, { amountPaise, provider, idempotencyKey, reason });
  }

  async cashDrawerCurrent(businessDate = ""): Promise<StaffCashDrawer | null> {
    return this.get("/staff-self/register/current", businessDate ? { businessDate } : {});
  }

  async cashDrawerMovements(businessDate = ""): Promise<Array<Record<string, unknown>>> {
    return this.get("/staff-self/register/movements", businessDate ? { businessDate } : {});
  }

  async openCashDrawer(openingCashPaise: number, businessDate: string, notes: string): Promise<StaffCashDrawer> {
    return this.post("/staff-self/register/open", { openingCashPaise, businessDate, notes });
  }

  async recordCashMovement(payload: Record<string, unknown>): Promise<StaffCashDrawer> {
    return this.post("/staff-self/register/movements", payload);
  }

  async closeCashDrawer(countedCashPaise: number, businessDate: string, notes: string): Promise<StaffCashDrawer> {
    return this.post("/staff-self/register/close", { countedCashPaise, businessDate, notes });
  }

  async approveCashDrawer(id: string, approvalNote: string, mfaCode: string): Promise<StaffCashDrawer> {
    return this.post(`/staff-self/register/${encodeURIComponent(id)}/approve`, { approvalNote, mfaCode });
  }

  async providerReconciliations(businessDate: string): Promise<Array<Record<string, unknown>>> {
    return this.get("/staff-self/register/provider-reconciliations", { businessDate });
  }

  async createProviderReconciliation(payload: Record<string, unknown>): Promise<Record<string, unknown>> {
    return this.post("/staff-self/register/provider-reconciliations", payload);
  }

  async reviewProviderReconciliation(id: string, reviewNote: string, mfaCode: string): Promise<Record<string, unknown>> {
    return this.post(`/staff-self/register/provider-reconciliations/${encodeURIComponent(id)}/review`, { reviewNote, mfaCode });
  }

  async updateNotification(id: string, status: "read" | "unread" | "archived" = "read"): Promise<unknown> {
    const result = await this.queueableMutation("PATCH", `/staff-self/notifications/${encodeURIComponent(id)}`, { status });
    if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("aura:notifications-updated"));
    return result;
  }

  async mobilePushConfig(): Promise<StaffPushConfig> {
    return this.get<StaffPushConfig>("/staff/self/mobile/push-config");
  }

  async registerPushDevice(id: string, platform: "web" | "android" | "ios" = "web", pushProvider = "web-push"): Promise<StaffPushDevice> {
    return this.post<StaffPushDevice>("/staff/self/mobile/devices", {
      id,
      platform,
      pushProvider,
      appVersion: STAFF_APP_VERSION,
      capabilities: { pwa: platform === "web", native: platform !== "web", pushNotifications: true }
    });
  }

  async registerPushSubscription(payload: Record<string, unknown>): Promise<unknown> {
    return this.post("/staff/self/mobile/push-subscriptions", payload);
  }

  async reportMobileCrash(payload: Record<string, unknown>): Promise<void> {
    await this.post("/staff/self/mobile/crash-reports", payload, false);
  }

  async reportMobileTelemetry(payload: Record<string, unknown>): Promise<void> {
    await this.post("/staff/self/mobile/telemetry", payload, false);
  }

  async updateSchedule(scheduleId: string, payload: { version: number; scheduleDate?: string; startTime?: string; endTime?: string; status?: string; notes?: string }): Promise<unknown> {
    return this.patch(`/staff-self/calendar/${encodeURIComponent(scheduleId)}`, payload);
  }

  async shiftSwaps(status = ""): Promise<StaffShiftSwap[]> {
    return this.get<StaffShiftSwap[]>("/staff/shift-swaps", status ? { status } : {});
  }

  async releasePolicy(): Promise<StaffAppReleasePolicy> {
    return this.get<StaffAppReleasePolicy>("/staff/self/mobile/release-policy", { version: STAFF_APP_VERSION }, false);
  }

  async copilotTools(): Promise<StaffCopilotTool[]> { return (await this.get<{ tools: StaffCopilotTool[] }>("/ai/copilot/tools")).tools; }

  async askCopilot(payload: { tool: string; startDate: string; endDate: string; question: string; language?: string }): Promise<StaffCopilotAnswer> {
    return this.post<StaffCopilotAnswer>("/ai/copilot/ask", { ...payload, scope: { level: "branch" } });
  }

  async decideShiftSwap(id: string, version: number, decision: "accepted" | "rejected", note = ""): Promise<StaffShiftSwap> {
    const saved = await this.post<StaffShiftSwap>(`/staff/shift-swaps/${encodeURIComponent(id)}/employee-decision`, { version, decision, note });
    this.clearGetCache();
    return saved;
  }

  async notificationCenter(): Promise<StaffNotificationCenter> {
    return this.get<StaffNotificationCenter>("/staff-self/notification-center");
  }

  async saveNotificationPreferences(payload: Omit<StaffNotificationPreferences, "staffId">): Promise<StaffNotificationPreferences> {
    return this.put<StaffNotificationPreferences>("/staff-self/notification-preferences", payload);
  }

  async createSchedule(payload: { scheduleDate: string; startTime: string; endTime: string; notes?: string; roomId?: string; roleId?: string; jobTitle?: string }): Promise<unknown> {
    return this.post("/staff-self/calendar", payload);
  }

  async scheduleBlockouts(from: string, to: string): Promise<StaffScheduleBlockout[]> {
    return this.get("/staff-schedule/blockouts", { from, to });
  }

  async createScheduleBlockout(payload: { startsAt: string; endsAt: string; reason: string }): Promise<StaffScheduleBlockout> {
    return this.post("/staff-schedule/blockouts", payload);
  }

  async deleteScheduleBlockout(id: string, version: number): Promise<void> {
    await this.delete(`/staff-schedule/blockouts/${encodeURIComponent(id)}`, { version: String(version) });
  }

  async createCalendarFeed(): Promise<{ path: string; providers: string[] }> {
    return this.post("/staff-schedule/calendar-feed", {});
  }

  async revokeCalendarFeed(): Promise<void> {
    await this.delete("/staff-schedule/calendar-feed");
  }

  async staffChatConversations(): Promise<StaffChatConversation[]> {
    return this.get<StaffChatConversation[]>("/team-chat/conversations");
  }

  async startPrivateOwnerChat(idempotencyKey: string): Promise<StaffChatConversation> {
    return this.postIdempotent<StaffChatConversation>("/team-chat/private-owner", {}, idempotencyKey);
  }

  async staffChatParticipants(): Promise<StaffChatParticipant[]> {
    return this.get<StaffChatParticipant[]>("/team-chat/participants");
  }

  async createStaffChatConversation(payload: { type: "direct" | "group" | "broadcast"; title?: string; participantUserIds: string[] }, idempotencyKey: string): Promise<StaffChatConversation> {
    return this.postIdempotent<StaffChatConversation>("/team-chat/conversations", payload, idempotencyKey);
  }

  async staffConversationMessages(conversationId: string): Promise<StaffConversationMessage[]> {
    return this.get<StaffConversationMessage[]>(`/team-chat/conversations/${encodeURIComponent(conversationId)}/messages`);
  }

  async sendStaffConversationMessage(conversationId: string, body: string, idempotencyKey: string, extras: { shareType?: string; shareId?: string; attachmentId?: string } = {}): Promise<StaffConversationMessage> {
    return this.postIdempotent<StaffConversationMessage>(`/team-chat/conversations/${encodeURIComponent(conversationId)}/messages`, { body, ...extras }, idempotencyKey);
  }

  async markStaffConversationRead(conversationId: string): Promise<void> {
    await this.post(`/team-chat/conversations/${encodeURIComponent(conversationId)}/read`, {});
  }

  async uploadStaffChatAttachment(file: File): Promise<StaffChatAttachment> {
    const response = await this.withRefreshRetry(() => firstValueFrom(this.http.post<ApiEnvelope<StaffChatAttachment>>(
      `${this.baseUrl}/team-chat/attachments?fileName=${encodeURIComponent(file.name)}`, file,
      { headers: this.authHeaders().set("Content-Type", file.type || "application/octet-stream") }
    )));
    return this.unwrap(response);
  }

  async downloadStaffChatAttachment(id: string): Promise<Blob> {
    return this.withRefreshRetry(() => firstValueFrom(this.http.get(
      `${this.baseUrl}/team-chat/attachments/${encodeURIComponent(id)}/content`,
      { headers: this.authHeaders(), responseType: "blob" }
    )));
  }

  async resolveStaffChatShare(type: string, id: string): Promise<{ type: string; id: string; access: string }> {
    return this.get(`/team-chat/share/${encodeURIComponent(type)}/${encodeURIComponent(id)}`);
  }

  async today(date = staffBusinessDate()): Promise<StaffToday> {
    const cacheKey = this.offlineTodayCacheKey(date);
    if (!this.isOnline()) return this.cachedToday(cacheKey);
    try {
      const value = await this.loadToday(date);
      await this.writeOfflineSnapshot(cacheKey, value);
      return value;
    } catch (error) {
      if (!(error instanceof HttpErrorResponse) || error.status !== 0) throw error;
      return this.cachedToday(cacheKey);
    }
  }

  private async loadToday(date: string): Promise<StaffToday> {
    const [dashboard, attendance] = await Promise.all([
      this.get<RustStaffSelfDashboard>("/staff/self/dashboard", { date }),
      this.attendanceForMonth(date)
    ]);
    const schedule = objectValue(dashboard.schedule);
    const matchingAttendance = attendance.find((row) =>
      Boolean(stringValue(row, "id")) && stringValue(row, "businessDate", "business_date") === date
    );
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
          dueAt: stringValue(row, "dueAt", "due_at"), version: numberValue(row, "version"),
          clientId: stringValue(row, "clientId", "client_id") || undefined,
          appointmentId: stringValue(row, "appointmentId", "appointment_id") || undefined
        };
      })
    };
  }

  private async cachedToday(cacheKey: string): Promise<StaffToday> {
    return this.cachedOfflineSnapshot(cacheKey, "No encrypted offline schedule is available for this day.");
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

  async tasks(): Promise<StaffTask[]> {
    return this.get<StaffTask[]>("/staff/self/tasks");
  }

  async fieldJobs(): Promise<StaffFieldJob[]> {
    return (await this.get<{ jobs: StaffFieldJob[] }>("/staff/self/field-jobs")).jobs ?? [];
  }

  async updateFieldJobStatus(id: string, status: string): Promise<MutationResult<unknown>> {
    return this.onlineMutation(() => this.patch(`/staff/self/field-jobs/${encodeURIComponent(id)}/status`, { status }));
  }

  async updateFieldJobLocation(id: string, latitude: number, longitude: number, accuracyMeters?: number): Promise<MutationResult<unknown>> {
    return this.onlineMutation(() => this.post(`/staff/self/field-jobs/${encodeURIComponent(id)}/location`, { latitude, longitude, accuracyMeters }));
  }

  async submitFieldJobProof(id: string, customerName: string, completionNote: string): Promise<MutationResult<unknown>> {
    return this.onlineMutation(() => this.post(`/staff/self/field-jobs/${encodeURIComponent(id)}/proof`, { customerName, customerConfirmed: true, completionNote }));
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
        statutoryEmployerPay: numberValue(row, "statutoryEmployerPaise"),
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
    const fileName = decodeURIComponent(path.split("/").pop() || "staff-document.pdf");
    await openProtectedBlob(blob, fileName);
  }

  async offers(): Promise<StaffOffer[]> {
    return this.get<StaffOffer[]>("/staff-self/offers");
  }

  async earningsDetails(periodStart: string, periodEnd: string, basis: "sale_date" | "close_date"): Promise<StaffEarningsDetail> {
    return this.get<StaffEarningsDetail>("/staff-self/earnings", { periodStart, periodEnd, basis });
  }

  async createTipDispute(payload: { saleId?: string; payoutId?: string; reason: string }): Promise<StaffEarningsDetail["tipDisputes"][number]> {
    return this.post<StaffEarningsDetail["tipDisputes"][number]>("/staff-self/tip-disputes", payload);
  }

  async payrollDocuments(): Promise<StaffPayrollDocument[]> {
    return this.get<StaffPayrollDocument[]>("/staff-self/payroll-documents");
  }

  async attendanceToday(date = staffBusinessDate()): Promise<StaffAttendanceToday> {
    const rows = await this.attendanceForMonth(date);
    const row = rows.find((item) => stringValue(item, "businessDate", "business_date") === date);
    const detail = row || {};
    const startTime = stringValue(detail, "scheduledShift1Start", "scheduled_shift1_start");
    const endTime = stringValue(detail, "scheduledShift2End", "scheduled_shift2_end", "scheduledShift1End", "scheduled_shift1_end");
    const scheduleStatus = stringValue(detail, "scheduledStatus", "scheduled_status");
    const breaks = arrayValue(detail["breaks"]).map(objectValue);
    const activeBreak = breaks.find((item) => !stringValue(item, "endedAt", "ended_at"));
    return {
      date,
      schedules: scheduleStatus || startTime || endTime ? [{ id: date, scheduleDate: date, startTime, endTime, shiftType: "shift", status: scheduleStatus }] : [],
      attendance: row && stringValue(row, "id") ? [this.normalizeAttendance(row)] : [],
      activeBreak: activeBreak ? { id: stringValue(activeBreak, "id"), status: "active", startedAt: stringValue(activeBreak, "startedAt", "started_at") } : null
    };
  }

  async rules(): Promise<StaffRuleDocument[]> {
    return this.get<StaffRuleDocument[]>("/staff-self/rules");
  }

  async markRuleRead(id: string): Promise<StaffRuleStatus> {
    return this.post<StaffRuleStatus>(`/staff-self/rules/${encodeURIComponent(id)}/read`, {});
  }

  async acknowledgeRule(id: string, answers: number[]): Promise<StaffRuleStatus> {
    return this.post<StaffRuleStatus>(`/staff-self/rules/${encodeURIComponent(id)}/acknowledge`, { answers });
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

  async attendanceClockOptions(date = staffBusinessDate()): Promise<StaffAttendanceClockOptions> {
    return this.get("/staff-attendance/clock-options", { staffId: this.staffId(), businessDate: date });
  }

  async surveys(): Promise<StaffSurvey[]> {
    return this.get<StaffSurvey[]>("/staff-self/surveys");
  }

  async submitSurveyResponse(id: string, answers: Record<string, string | number>, idempotencyKey: string): Promise<unknown> {
    return this.postIdempotent(`/staff-self/surveys/${encodeURIComponent(id)}/responses`, { answers }, idempotencyKey);
  }

  async appointmentBook(params: Record<string, string>): Promise<StaffAppointmentBook> {
    const book = await this.get<StaffAppointmentBook>("/staff-self/appointment-book", params);
    return { ...book, appointments: arrayValue(book.appointments).map((row) => this.normalizeAppointment(row)) };
  }

  async quoteAppointment(payload: Record<string, unknown>): Promise<StaffAppointmentQuote> {
    return this.post<StaffAppointmentQuote>("/staff-self/appointment-book/quote", payload);
  }

  async saveAppointmentBooking(payload: Record<string, unknown>): Promise<unknown> {
    const result = await this.post("/staff-self/appointments/batch", payload);
    this.notifyAppointmentsUpdated();
    return result;
  }

  async setAppointmentStatus(id: string, status: "confirmed" | "arrived" | "no-show", reason = ""): Promise<unknown> {
    const result = await this.post(`/staff-self/appointments/${encodeURIComponent(id)}/status`, { status, reason });
    this.notifyAppointmentsUpdated();
    return result;
  }

  async appointmentOperations(id: string): Promise<StaffAppointmentOperations> {
    const value = await this.get<StaffAppointmentOperations>(`/staff-self/appointments/${encodeURIComponent(id)}/operations`);
    return { ...value, appointment: this.normalizeAppointment(value.appointment) };
  }

  async appointmentGuest360(id: string): Promise<StaffGuest360> {
    return this.get(`/staff-self/appointments/${encodeURIComponent(id)}/guest-360`);
  }

  async saveAppointmentGuestNote(id: string, input: { noteType: string; note: string; visibility: string }): Promise<unknown> {
    return this.post(`/staff-self/appointments/${encodeURIComponent(id)}/guest-360/notes`, input);
  }

  async saveAppointmentGuestClinical(id: string, input: { allergies: string; preferences: string; expectedVersion: number }): Promise<unknown> {
    return this.put(`/staff-self/appointments/${encodeURIComponent(id)}/guest-360/clinical-profile`, input);
  }

  async saveAppointmentGuestForm(id: string, input: Record<string, unknown>): Promise<StaffGuestFormSubmission> {
    return this.post(`/staff-self/appointments/${encodeURIComponent(id)}/guest-360/forms`, input);
  }

  async reviewAppointmentGuestForm(id: string, submissionId: string, decision: "approved" | "correction_required", note: string): Promise<unknown> {
    return this.post(`/staff-self/appointments/${encodeURIComponent(id)}/guest-360/forms/${encodeURIComponent(submissionId)}/reviews`, { decision, note });
  }

  async uploadAppointmentGuestPhoto(id: string, file: File, input: { caption: string; serviceId: string; photoType: string; consentConfirmed: boolean; consentReason: string }): Promise<unknown> {
    if (!file.size || file.size > 5 * 1024 * 1024) throw new Error("Photo must be 5 MB or smaller.");
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) throw new Error("Photo must be JPG, PNG, or WebP.");
    const query = new URLSearchParams({ fileName: file.name, caption: input.caption, serviceId: input.serviceId, photoType: input.photoType, consentConfirmed: String(input.consentConfirmed), consentReason: input.consentReason });
    return this.withRefreshRetry(async () => this.unwrap(await firstValueFrom(this.http.post<unknown>(
      `${this.baseUrl}/staff-self/appointments/${encodeURIComponent(id)}/guest-360/photos?${query}`,
      file,
      { headers: this.authHeaders().set("Content-Type", file.type) }
    ))));
  }

  async appointmentGuestPhoto(id: string, photoId: string): Promise<Blob> {
    return this.withRefreshRetry(() => firstValueFrom(this.http.get(
      `${this.baseUrl}/staff-self/appointments/${encodeURIComponent(id)}/guest-360/photos/${encodeURIComponent(photoId)}/content`,
      { headers: this.authHeaders(), responseType: "blob" }
    )));
  }

  async deleteAppointmentGuestPhoto(id: string, photoId: string): Promise<void> {
    await this.delete(`/staff-self/appointments/${encodeURIComponent(id)}/guest-360/photos/${encodeURIComponent(photoId)}`);
  }

  async saveAppointmentGuestPreferences(id: string, input: Record<string, unknown>): Promise<unknown> {
    return this.patch(`/staff-self/appointments/${encodeURIComponent(id)}/guest-360/contact-preferences`, input);
  }

  async runAppointmentOperation(id: string, action: string, payload: Record<string, unknown> = {}): Promise<unknown> {
    const result = await this.post(`/staff-self/appointments/${encodeURIComponent(id)}/operations`, { action, ...payload });
    this.notifyAppointmentsUpdated();
    return result;
  }

  async decideOnlineBookingRequest(id: string, decision: "approved" | "rejected", reason: string): Promise<unknown> {
    const result = await this.post(`/staff-self/online-booking-requests/${encodeURIComponent(id)}/decision`, { decision, reason });
    this.notifyAppointmentsUpdated();
    return result;
  }

  async convertWaitlist(id: string, payload: Record<string, unknown>): Promise<unknown> {
    const result = await this.post(`/staff-self/waitlist/${encodeURIComponent(id)}/convert`, payload);
    this.notifyAppointmentsUpdated();
    return result;
  }

  async createAppointmentClient(payload: { firstName: string; lastName: string; phone: string; email: string }): Promise<{ id: string; code: string; name: string; phone: string; email: string; preferredStaffId: string }> {
    const value = objectValue(await this.post<unknown>("/clients", payload));
    return {
      id: stringValue(value, "id"), code: stringValue(value, "code"),
      name: `${stringValue(value, "firstName", "first_name")} ${stringValue(value, "lastName", "last_name")}`.trim(),
      phone: stringValue(value, "phone"), email: stringValue(value, "email"),
      preferredStaffId: stringValue(value, "preferredStaffId", "preferred_staff_id")
    };
  }

  async attendanceCorrectionRequests(status = ""): Promise<StaffAttendanceCorrection[]> {
    return this.get("/staff-attendance/correction-requests", { status });
  }

  async requestAttendanceCorrection(payload: { businessDate: string; clockInAt?: string; clockOutAt?: string; workTaskRateId?: string; reason: string }): Promise<StaffAttendanceCorrection> {
    return this.post("/staff-attendance/correction-requests", payload);
  }

  async decideAttendanceCorrection(id: string, version: number, decision: "approved" | "rejected", reviewNote = ""): Promise<StaffAttendanceCorrection> {
    return this.post(`/staff-attendance/correction-requests/${encodeURIComponent(id)}/decision`, { version, decision, reviewNote });
  }

  async clockIn(source = "staff-app", workTaskRateId?: string): Promise<MutationResult<StaffAttendance>> {
    return this.onlineMutation(async () => {
      const position = await this.currentPosition();
      return this.post<StaffAttendance>("/staff-attendance/clock-in", {
        staffId: this.staffId(), businessDate: staffBusinessDate(), source, workTaskRateId, presence: this.attendancePresence(position)
      });
    });
  }

  async passkeyClockIn(workTaskRateId?: string): Promise<MutationResult<StaffAttendance>> {
    return this.onlineMutation(async () => {
      if (!this.biometricSupported()) throw new Error("Passkey verification is not supported on this device.");
      const position = await this.currentPosition();
      const begin = await this.authPost<WebAuthnBegin>("/staff-attendance/passkey/begin", {}, true);
      const credential = await navigator.credentials.get({ publicKey: this.decodeRequestOptions(begin.options as PublicKeyCredentialRequestOptions) });
      if (!(credential instanceof PublicKeyCredential)) throw new Error("Passkey verification was cancelled.");
      return this.post<StaffAttendance>("/staff-attendance/clock-in", {
        staffId: this.staffId(), businessDate: staffBusinessDate(), source: "staff-app-passkey", workTaskRateId,
        presence: this.attendancePresence(position),
        faceScan: { deviceUid: this.faceDeviceId(), latitude: position.coords.latitude, longitude: position.coords.longitude, accuracyMeters: position.coords.accuracy, challengeId: begin.challengeId, credential: this.authenticationResponse(credential) }
      });
    });
  }

  async biometricClockIn(): Promise<MutationResult<StaffAttendance>> {
    return this.onlineMutation(async () => {
      if (!this.biometricSupported()) throw new Error("Biometric verification is not supported on this device.");
      const position = await this.currentPosition();
      const begin = await this.authPost<WebAuthnBegin>("/staff-attendance/biometric/begin", {}, true);
      const credential = await navigator.credentials.get({ publicKey: this.decodeRequestOptions(begin.options as PublicKeyCredentialRequestOptions) });
      if (!(credential instanceof PublicKeyCredential)) throw new Error("Biometric verification was cancelled.");
      return this.post<StaffAttendance>("/staff-attendance/clock-in", {
        staffId: this.staffId(), businessDate: staffBusinessDate(), source: "staff-app-biometric",
        presence: this.attendancePresence(position),
        faceScan: {
          deviceUid: this.faceDeviceId(), latitude: position.coords.latitude, longitude: position.coords.longitude,
          accuracyMeters: position.coords.accuracy, challengeId: begin.challengeId,
          credential: this.authenticationResponse(credential)
        }
      });
    });
  }

  async clockOut(attendanceId?: string, cashTipPaise = 0): Promise<MutationResult<StaffAttendance>> {
    return this.onlineMutation(async () => {
      const position = await this.currentPosition();
      return this.post<StaffAttendance>("/staff-attendance/clock-out", {
        staffId: this.staffId(), businessDate: staffBusinessDate(), attendanceId, cashTipPaise, source: "staff-app", presence: this.attendancePresence(position)
      });
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

  async requestLeave(payload: { leaveType: string; startDate: string; endDate: string; reason: string; dayParts?: Array<{ date: string; startTime?: string; endTime?: string }> }): Promise<MutationResult<unknown>> {
    return this.queueableMutation("POST", "/staff-leave/requests", { ...payload, staffId: this.staffId() });
  }

  async withdrawLeave(requestId: string, version: number): Promise<StaffLeave> {
    return this.post<StaffLeave>(`/staff-leave/requests/${encodeURIComponent(requestId)}/withdraw`, { version });
  }

  async cancelLeave(requestId: string, version: number, reason: string): Promise<StaffLeave> {
    return this.post<StaffLeave>(`/staff-leave/requests/${encodeURIComponent(requestId)}/cancel`, { version, reason });
  }

  async leaveAccrualHistory(): Promise<StaffLeaveAccrual[]> {
    return this.get("/staff-leave/accrual-history", { staffId: this.staffId() });
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
      deviceId: this.deviceId()
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
    try {
      const queue = await this.readOfflineQueue();
      if (!queue.length) return 0;
      let flushed = 0;
      for (const item of queue.filter((entry) => entry.state === "pending" || entry.state === "syncing")) {
      if (!this.isQueueOwner(item)) {
        item.state = "permanent-failure";
        item.lastError = "Queued action belongs to a different authenticated user or tenant.";
        continue;
      }
      if (!Number.isFinite(item.deviceTimeMs) || Date.now() + 300_000 < item.deviceTimeMs) {
        item.state = "conflict";
        item.lastError = "Device clock changed after this action was queued. Review it before retrying.";
        continue;
      }
      try {
        item.state = "syncing";
        await this.writeOfflineQueue(queue);
        const headers = this.authHeaders()
          .set("Idempotency-Key", item.idempotencyKey)
          .set("X-Device-Time", new Date(item.deviceTimeMs).toISOString());
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
      await this.writeOfflineQueue(queue);
      return flushed;
    } finally {
      this.releaseQueueLease();
    }
  }

  offlineQueueSize(): number {
    return this.offlineQueueCount();
  }

  async offlineActions(): Promise<StaffOfflineAction[]> {
    return (await this.readOfflineQueue()).map(({ queueId, path, state, queuedAt, lastError }) => ({ queueId, path, state, queuedAt, lastError }));
  }

  async retryOfflineAction(queueId: string): Promise<void> {
    const queue = await this.readOfflineQueue();
    const action = queue.find((item) => item.queueId === queueId);
    if (!action || !this.isQueueOwner(action)) throw new Error("Queued action is unavailable for this session.");
    action.state = "pending";
    action.lastError = undefined;
    action.deviceTimeMs = Date.now();
    await this.writeOfflineQueue(queue);
  }

  async discardOfflineAction(queueId: string): Promise<void> {
    const queue = await this.readOfflineQueue();
    const action = queue.find((item) => item.queueId === queueId);
    if (action && !this.isQueueOwner(action)) throw new Error("Queued action is unavailable for this session.");
    await this.writeOfflineQueue(queue.filter((item) => item.queueId !== queueId));
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
    const scheduled = scheduledShiftMinutes(
      stringValue(row, "scheduledShift1Start", "scheduled_shift1_start"),
      stringValue(row, "scheduledShift1End", "scheduled_shift1_end"),
      stringValue(row, "scheduledShift2Start", "scheduled_shift2_start"),
      stringValue(row, "scheduledShift2End", "scheduled_shift2_end")
    );
    return {
      id: stringValue(row, "id") || stringValue(row, "businessDate", "business_date"),
      businessDate: stringValue(row, "businessDate", "business_date"), clockInAt, clockOutAt,
      status: stringValue(row, "attendanceStatus", "attendance_status", "manualStatus", "manual_status", "scheduledStatus", "scheduled_status"),
      source: stringValue(row, "source"), overtimeMinutes: numberValue(row, "overtimeMinutes", "overtime_minutes"),
      grossMinutes: elapsed, totalBreakMinutes: breaks, totalWorkedMinutes: worked, scheduledShiftMinutes: scheduled,
      overtimeCalculationStatus: "calculated", overtimeReviewReason: "", overtimePolicyVersion: ""
      , cashTipPaise: numberValue(row, "cashTipPaise", "cash_tip_paise"), sessionCount: numberValue(row, "sessionCount", "session_count"),
      sessions: arrayValue(row["sessions"]).map((value) => { const session = objectValue(value); return { id: stringValue(session, "id"), clockInAt: stringValue(session, "clockInAt", "clock_in_at"), clockOutAt: stringValue(session, "clockOutAt", "clock_out_at"), workTaskName: stringValue(session, "workTaskName", "work_task_name"), payRatePaise: numberValue(session, "payRatePaise", "pay_rate_paise"), source: stringValue(session, "source") }; })
    };
  }

  private normalizeAppointment(value: unknown): StaffAppointment {
    const row = objectValue(value);
    const startAt = stringValue(row, "startAt", "start_at");
    const endAt = stringValue(row, "endAt", "end_at");
    const duration = startAt && endAt ? Math.max(0, Math.floor((new Date(endAt).getTime() - new Date(startAt).getTime()) / 60000)) : numberValue(row, "durationMinutes", "duration_minutes");
    const serviceNames = arrayValue(row["serviceNames"] ?? row["service_names"]).map(String);
    const serviceName = stringValue(row, "serviceName", "service_name");
    const serviceSelections = Object.fromEntries(Object.entries(objectValue(row["serviceSelections"] ?? row["service_selections"])).map(([serviceId, value]) => {
      const selection = objectValue(value);
      return [serviceId, { variantId: stringValue(selection, "variantId", "variant_id"), addonIds: arrayValue(selection["addonIds"] ?? selection["addon_ids"]).map(String) }];
    }));
    if (!serviceNames.length && serviceName) serviceNames.push(serviceName);
    return {
      id: stringValue(row, "id"), staffId: stringValue(row, "staffId", "staff_id") || this.staffId(),
      branchId: stringValue(row, "branchId", "branch_id") || this.user()?.branchId || "",
      serviceIds: arrayValue(row["serviceIds"] ?? row["service_ids"]).map(String), serviceNames,
      durationMinutes: duration, value: numberValue(row, "value", "amountPaise", "amount_paise", "totalPaise", "total_paise"),
      startAt, endAt, status: stringValue(row, "status"), chair: stringValue(row, "chair"), source: stringValue(row, "source"),
      clientId: stringValue(row, "clientId", "client_id"), clientName: stringValue(row, "clientName", "client_name"), preferredClient: Boolean(row["preferredClient"] ?? row["preferred_client"]),
      rescheduleCount: numberValue(row, "rescheduleCount", "reschedule_count"),
      rescheduleTimeline: arrayValue(row["rescheduleTimeline"] ?? row["reschedule_timeline"]).map((entry) => {
        const event = objectValue(entry);
        return { action: stringValue(event, "action"), changedAt: stringValue(event, "changedAt", "changed_at"), reason: stringValue(event, "reason"), changedBy: stringValue(event, "changedBy", "changed_by"), fromStartAt: stringValue(event, "fromStartAt", "from_start_at"), toStartAt: stringValue(event, "toStartAt", "to_start_at") };
      }),
      serviceDepartments: arrayValue(row["serviceDepartments"] ?? row["service_departments"]).map(String), lastServiceAt: stringValue(row, "lastServiceAt", "last_service_at"),
      lastServiceNames: arrayValue(row["lastServiceNames"] ?? row["last_service_names"]).map(String),
      lastServiceDepartments: arrayValue(row["lastServiceDepartments"] ?? row["last_service_departments"]).map(String),
      requestedStaffId: stringValue(row, "requestedStaffId", "requested_staff_id"),
      staffPreference: stringValue(row, "staffPreference", "staff_preference"),
      serviceSelections,
      chairRoomId: stringValue(row, "chairRoomId", "chair_room_id"), notes: stringValue(row, "notes"),
      bookingGroupId: stringValue(row, "bookingGroupId", "booking_group_id"), version: numberValue(row, "version"),
      bookingType: stringValue(row, "bookingType", "booking_type"), dayPackageId: stringValue(row, "dayPackageId", "day_package_id"), hostClientId: stringValue(row, "hostClientId", "host_client_id"),
      groupName: stringValue(row, "groupName", "group_name"), groupNotes: stringValue(row, "groupNotes", "group_notes"),
      surprise: Boolean(row["surprise"] ?? row["isSurprise"] ?? row["is_surprise"]), virtualMeetingUrl: stringValue(row, "virtualMeetingUrl", "virtual_meeting_url"),
      serviceMode: stringValue(row, "serviceMode", "service_mode"), segmentLabel: stringValue(row, "segmentLabel", "segment_label"),
      sequenceNo: numberValue(row, "sequenceNo", "sequence_no"), executionStatus: stringValue(row, "executionStatus", "execution_status"),
      serviceStartedAt: stringValue(row, "serviceStartedAt", "service_started_at"), servicePausedAt: stringValue(row, "servicePausedAt", "service_paused_at"),
      pausedSeconds: numberValue(row, "pausedSeconds", "paused_seconds"), serviceCompletedAt: stringValue(row, "serviceCompletedAt", "service_completed_at")
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
      lifecycle: objectValue(source.lifecycle),
      staff: {
        id: stringValue(staff, "id") || this.staffId(), fullName: name, firstName: names[0] || "", lastName: names.slice(1).join(" "),
        mobile: stringValue(staff, "mobile"), email: stringValue(staff, "email") || this.user()?.email || "", photoUrl: stringValue(staff, "photoUrl", "photo_url"),
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
    let headers = this.tokenHeaders().set("X-Staff-App", "1").set("X-Staff-App-Version", STAFF_APP_VERSION).set("X-Device-Id", this.deviceId());
    if (this.staffLocation) {
      headers = headers
        .set("X-Staff-Latitude", String(this.staffLocation.latitude))
        .set("X-Staff-Longitude", String(this.staffLocation.longitude))
        .set("X-Staff-Accuracy", String(this.staffLocation.accuracy));
    }
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

  private async post<T = unknown>(path: string, body: Record<string, unknown>, reportError = true): Promise<T> {
    this.loading.set(true);
    if (reportError) this.error.set("");
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
      if (reportError) this.error.set(message);
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
    void this.clearOfflineState();
    this.clearGetCache();
    this.accessTokenValue = session.accessToken || session.access_token || "";
    this.tenantIdValue = tenantId;
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
    this.user.set({ id: me.userId, name: loginId, loginId, email: loginId.includes("@") ? loginId : "", role, staffId: "", branchId: branch, branchName: branchAccess?.branchName, branchIds: (me.branches || []).map((item) => item.branchId), branches: me.branches || [], permissions, deniedPermissions });
    const context = await this.refreshSecurityContext().catch(() => null);
    let staffId = context?.staffId || "";
    let staffName = context?.staffName || "";
    let staffEmail = loginId.includes("@") ? loginId : "";
    if (!staffId) {
      const dashboardResponse = await firstValueFrom(this.http.get<RustStaffSelfDashboard | ApiEnvelope<RustStaffSelfDashboard>>(
        `${this.baseUrl}/staff/self/dashboard`, { headers: this.authHeaders() }
      ));
      const staff = objectValue(this.unwrap(dashboardResponse).staff);
      staffId = stringValue(staff, "id");
      staffName = stringValue(staff, "displayName", "fullName");
      staffEmail = stringValue(staff, "email") || staffEmail;
    }
    if (!staffId) throw new Error("This login is not linked with a staff profile.");
    const user: StaffUser = { id: me.userId, name: staffName || loginId, loginId, email: staffEmail, role, staffId, branchId: branch, branchName: branchAccess?.branchName, branchIds: (me.branches || []).map((item) => item.branchId), branches: me.branches || [], permissions, deniedPermissions };
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
          { deviceId: this.deviceId(), device: { type: "staff-app", name: "Aura Staff App", platform: "web" } },
          { withCredentials: true }
        ));
        const session = this.normalizeSession(this.unwrap(response));
        if (!session.accessToken) throw new Error("Staff session refresh failed.");
        this.accessTokenValue = session.accessToken;
        this.tenantIdValue = this.tenantIdFromAccessToken(session.accessToken) || this.tenantIdValue || this.readBiometricHint()?.tenantId || "";
        if (session.user?.staffId) {
          this.assertEmployeeRole(session.user.role);
          if (this.user()?.id && this.user()?.id !== session.user.id) void this.clearOfflineState();
          this.profile.set(null);
          this.user.set(session.user);
          await this.refreshSecurityContext().catch(() => undefined);
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

  isOnline(): boolean {
    return typeof navigator === "undefined" ? true : navigator.onLine;
  }

  private async readOfflineQueue(): Promise<OfflineQueueEntry[]> {
    try {
      const encrypted = await this.offlineStore.read<unknown>(STAFF_OFFLINE_QUEUE_RECORD);
      if (Array.isArray(encrypted)) return encrypted.filter((item): item is OfflineQueueEntry => this.isOfflineQueueEntry(item));
      const legacy: unknown = JSON.parse(localStorage.getItem(STAFF_OFFLINE_QUEUE_KEY) || "[]");
      if (!Array.isArray(legacy)) return [];
      if (!this.user()?.id || !this.user()?.branchId || !this.tenantIdValue) return [];
      const migrated = legacy.filter((item): item is OfflineQueueEntry => this.isLegacyOfflineQueueEntry(item)).map((item) => ({
        ...item,
        branchId: item.branchId || this.user()?.branchId || "",
        deviceTimeMs: item.deviceTimeMs || Date.parse(item.queuedAt) || Date.now()
      }));
      await this.writeOfflineQueue(migrated);
      localStorage.removeItem(STAFF_OFFLINE_QUEUE_KEY);
      return migrated;
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
    if (this.isOnline()) {
      try {
        return { state: "completed", data: method === "POST" ? await this.post<T>(path, body) : await this.patch<T>(path, body) };
      } catch (error) {
        if (!(error instanceof HttpErrorResponse) || error.status !== 0) throw error;
        this.error.set("");
      }
    }
    if (!this.isAllowedOfflineMutation(method, path, body)) throw new Error("This action cannot be stored offline.");
    const queueId = crypto.randomUUID();
    const idempotencyKey = crypto.randomUUID();
    const entry: OfflineQueueEntry = {
      queueId, idempotencyKey, userId: this.user()?.id || "", tenantId: this.tenantIdValue,
      branchId: this.user()?.branchId || "", method, path, body, state: "pending",
      queuedAt: new Date().toISOString(), deviceTimeMs: Date.now()
    };
    if (!this.isQueueOwner(entry)) throw new Error("An authenticated session is required to queue this action.");
    await this.writeOfflineQueue([...(await this.readOfflineQueue()), entry].slice(-30));
    return { state: "queued", queueId, idempotencyKey };
  }

  private isAllowedOfflineMutation(method: "POST" | "PATCH", path: string, body: Record<string, unknown>): boolean {
    if (method === "PATCH" && /^\/staff-self\/notifications\/[^/]+$/.test(path)) return Object.keys(body).length === 1 && ["read", "unread", "archived"].includes(String(body["status"]));
    if (method === "PATCH" && /^\/staff\/self\/tasks\/[^/]+\/status$/.test(path)) return Object.keys(body).every((key) => ["status", "version"].includes(key)) && typeof body["version"] === "number";
    if (method === "POST" && path === "/staff-leave/requests") return Object.keys(body).every((key) => ["staffId", "leaveType", "startDate", "endDate", "reason", "dayParts"].includes(key));
    if (method === "POST" && ["/staff-attendance/break-start", "/staff-attendance/break-end"].includes(path)) {
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

  private async delete<T = unknown>(path: string, params: Record<string, string> = {}): Promise<T> {
    this.loading.set(true);
    this.error.set("");
    if (!this.isOnline()) { this.loading.set(false); throw new Error("This action requires an internet connection."); }
    try {
      const result = await this.withRefreshRetry(async () => {
        const response = await firstValueFrom(this.http.delete<T | ApiEnvelope<T>>(`${this.baseUrl}${path}`, { headers: this.authHeaders(), params }));
        return this.unwrap(response);
      });
      this.clearGetCache();
      return result;
    } catch (error) {
      this.error.set(this.errorMessage(error, "Unable to update staff data."));
      throw error;
    } finally { this.loading.set(false); }
  }

  deviceId(): string { return this.faceDeviceId(); }

  private currentPosition(): Promise<GeolocationPosition> {
    if (typeof navigator === "undefined" || !navigator.geolocation) return Promise.reject(new Error("GPS location is required for Staff App access."));
    return new Promise((resolve, reject) => navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }));
  }

  private async loadSecurityContext(): Promise<StaffSecurityContext> {
    const response = await firstValueFrom(this.http.get<StaffSecurityContext | ApiEnvelope<StaffSecurityContext>>(
      `${this.baseUrl}/staff/self/security-context`,
      { headers: this.authHeaders(), params: { deviceId: this.deviceId() } }
    ));
    const context = this.unwrap(response) as Partial<StaffSecurityContext>;
    const geofence = context.geofence;
    return {
      staffId: context.staffId || this.user()?.staffId || "",
      staffName: context.staffName || this.user()?.name || "",
      currentSessionId: context.currentSessionId || "",
      currentDeviceId: context.currentDeviceId || this.deviceId(),
      pinConfigured: context.pinConfigured === true,
      inactivityMinutes: context.inactivityMinutes || 15,
      contactVerificationRequired: context.contactVerificationRequired === true,
      geofence: {
        mode: geofence?.mode || "full_access",
        radiusMeters: geofence?.radiusMeters || 200,
        locationConfigured: geofence?.locationConfigured === true,
        roleExempt: geofence?.roleExempt === true
      },
      sessions: Array.isArray(context.sessions) ? context.sessions : [],
      devices: Array.isArray(context.devices) ? context.devices : []
    };
  }
  private attendancePresence(position: GeolocationPosition) {
    return { latitude: position.coords.latitude, longitude: position.coords.longitude, accuracyMeters: position.coords.accuracy };
  }
  private async onlineMutation<T>(mutation: () => Promise<T>): Promise<MutationResult<T>> {
    if (!this.isOnline()) throw new Error("This action requires an internet connection and cannot be stored offline.");
    return { state: "completed", data: await mutation() };
  }

  private isOfflineQueueEntry(value: unknown): value is OfflineQueueEntry {
    if (!value || typeof value !== "object") return false;
    const item = value as Record<string, unknown>;
    return typeof item["queueId"] === "string" && typeof item["idempotencyKey"] === "string" &&
      typeof item["userId"] === "string" && typeof item["tenantId"] === "string" &&
      typeof item["branchId"] === "string" && typeof item["deviceTimeMs"] === "number" &&
      (item["method"] === "POST" || item["method"] === "PATCH") && typeof item["path"] === "string" &&
      !!item["body"] && typeof item["body"] === "object" && ["pending", "syncing", "permanent-failure", "conflict"].includes(String(item["state"]));
  }

  private isLegacyOfflineQueueEntry(value: unknown): value is OfflineQueueEntry {
    if (!value || typeof value !== "object") return false;
    const item = value as Record<string, unknown>;
    return typeof item["queueId"] === "string" && typeof item["idempotencyKey"] === "string" &&
      typeof item["userId"] === "string" && typeof item["tenantId"] === "string" &&
      (item["method"] === "POST" || item["method"] === "PATCH") && typeof item["path"] === "string" &&
      !!item["body"] && typeof item["body"] === "object" && typeof item["queuedAt"] === "string";
  }

  private async writeOfflineQueue(queue: OfflineQueueEntry[]): Promise<void> {
    await this.offlineStore.write(STAFF_OFFLINE_QUEUE_RECORD, queue);
    this.offlineQueueCount.set(queue.length);
  }

  private async refreshOfflineQueueCount(): Promise<void> {
    this.offlineQueueCount.set((await this.readOfflineQueue()).length);
  }

  private offlineTodayCacheKey(date: string): string {
    const user = this.user();
    if (!user?.id || !user.branchId || !this.tenantIdValue) throw new Error("An authenticated staff session is required for offline access.");
    return `today:${this.tenantIdValue}:${user.branchId}:${user.id}:${date}`;
  }

  private offlineDashboardCacheKey(params: Record<string, string>): string {
    const key = this.scopedOfflineDashboardCacheKey(params);
    if (!key) throw new Error("An authenticated staff session is required for offline access.");
    return key;
  }

  private scopedOfflineDashboardCacheKey(params: Record<string, string>): string | null {
    const user = this.user();
    if (!user?.id || !user.branchId || !this.tenantIdValue) return null;
    return `dashboard:${this.tenantIdValue}:${user.branchId}:${user.id}:${stableQueryKey(params)}`;
  }

  private async writeOfflineSnapshot<T>(key: string, value: T): Promise<void> {
    const cachedAt = new Date().toISOString();
    await this.offlineStore.write(key, { cachedAt, value } satisfies OfflineSnapshot<T>);
    this.offlineSnapshotAt.set(cachedAt);
  }

  private async cachedOfflineSnapshot<T>(key: string, message: string): Promise<T> {
    const cached = await this.offlineStore.read<T | OfflineSnapshot<T>>(key);
    if (cached && typeof cached === "object" && "cachedAt" in cached && "value" in cached) {
      const snapshot = cached as OfflineSnapshot<T>;
      this.offlineSnapshotAt.set(snapshot.cachedAt);
      return snapshot.value;
    }
    if (cached) { this.offlineSnapshotAt.set(""); return cached; }
    throw new Error(message);
  }

  private async clearOfflineState(): Promise<void> {
    localStorage.removeItem(STAFF_OFFLINE_QUEUE_KEY);
    localStorage.removeItem(STAFF_OFFLINE_LEASE_KEY);
    this.offlineQueueCount.set(0);
    await this.offlineStore.clear().catch(() => undefined);
  }

  private isQueueOwner(item: OfflineQueueEntry): boolean {
    return !!this.user()?.id && item.userId === this.user()?.id && item.tenantId === this.tenantIdValue && item.branchId === this.user()?.branchId;
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
    this.profile.set(null);
    this.securityContext.set(null);
    this.staffLocation = null;
    this.user.set(null);
    this.clearGetCache();
    this.biometricLocked.set(false);
    void this.clearOfflineState();
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
    const response = credential.response as AuthenticatorAttestationResponse & { getTransports?: () => string[] };
    return { id: this.arrayBufferToBase64Url(credential.rawId), transports: response.getTransports?.() ?? [], clientDataJSON: this.arrayBufferToBase64Url(response.clientDataJSON), attestationObject: this.arrayBufferToBase64Url(response.attestationObject) };
  }

  private authenticationResponse(credential: PublicKeyCredential): Record<string, unknown> {
    if (!(credential.response instanceof AuthenticatorAssertionResponse)) throw new Error("Invalid passkey authentication response.");
    return { id: this.arrayBufferToBase64Url(credential.rawId), clientDataJSON: this.arrayBufferToBase64Url(credential.response.clientDataJSON), authenticatorData: this.arrayBufferToBase64Url(credential.response.authenticatorData), signature: this.arrayBufferToBase64Url(credential.response.signature), userHandle: credential.response.userHandle ? this.arrayBufferToBase64Url(credential.response.userHandle) : null };
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
