import { HttpClient, HttpErrorResponse, HttpHeaders } from "@angular/common/http";
import { Injectable, signal } from "@angular/core";
import { firstValueFrom, Observable } from "rxjs";
import { environment } from "../../environments/environment";
import { resetCsrfState } from "./csrf.interceptor";
import { CapacitorHttp } from "@capacitor/core";

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
    targetProgress: { label: string; targetValue: number; achievedValue: number; percentage: number; remaining: number };
  };
  timeline: Array<{ id: string; serviceNames: string[]; startAt: string; endAt: string; status: string; state: string; minutesToStart: number; durationMinutes: number }>;
  serviceTimers: Array<{ appointmentId: string; status: string; elapsedMinutes: number; totalMinutes: number; remainingMinutes: number; progress: number }>;
  performance: { revenue: number; completedServices: number; avgUtilization: number; avgRating: number; productivityScore: number; strengths: string[]; opportunities: string[] };
  leaderboard: Array<{ rank: number; staffId: string; staffName: string; revenue: number; score: number; rating: number; days: number; isMe: boolean }>;
  gamification: { points: number; level: number; stars: number; dailyStreak: number; monthlyStreak: number; badges: Array<{ label: string; description: string; earned: boolean }> };
  notifications: Array<{ id: string; title: string; body: string; status: string; createdAt: string }>;
  tasks: Array<{ id: string; title: string; priority: string; status: string; dueAt: string; assignedBy: string; checklist: unknown[] }>;
  calendar: Array<{ id: string; date: string; startTime: string; endTime: string; type: string; status: string; version?: number }>;
  reports: Record<string, { days: number; revenue: number; services: number; productivityScore: number; rating: number }>;
};

export type StaffBusinessBilling = {
  saleId: string;
  invoiceId: string;
  invoiceNumber: string;
  invoiceStatus: string;
  subtotalPaise: number;
  discountPaise: number;
  couponDiscountPaise: number;
  afterDiscountPaise: number;
  gstPaise: number;
  totalPaise: number;
  paidPaise: number;
  duePaise: number;
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
};

export type StaffBusinessSummary = {
  appointments: number;
  completedServices: number;
  scheduledMinutes: number;
  completedMinutes: number;
  workedMinutes: number;
  bills: number;
  subtotalPaise: number;
  discountPaise: number;
  couponDiscountPaise: number;
  afterDiscountPaise: number;
  gstPaise: number;
  totalPaise: number;
  paidPaise: number;
  duePaise: number;
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
  services: Array<{ id: string; name: string }>;
  dailyBreakdown: Array<{ date: string; performance: StaffBusinessPerformance } & StaffBusinessSummary>;
  pagination: { page: number; pageSize: number; totalItems: number; totalPages: number; hasMore: boolean };
  appointments: StaffBusinessAppointment[];
};

export type StaffBusinessInvoiceDetail = {
  id: string;
  invoiceNumber: string;
  clientName?: string;
  status: string;
  appointmentId: string;
  createdAt: string;
  totals: StaffBusinessBilling;
  items: Array<{ id: string; name: string; type: string; quantity: number; amountPaise: number }>;
  payments: Array<{ id: string; mode: string; amount: number; amountPaise: number; createdAt: string }>;
};

export type StaffChatThread = { id: string; tenantId: string; branchId: string; title: string; channel: string; messageCount?: number; lastMessageAt?: string };
export type StaffChatMessage = { id: string; threadId: string; senderStaffId: string; senderName: string; body: string; createdAt: string; readByJson?: string };
export type StaffWorkspacePreferences = {
  workspace: { workspaceName: string };
  localization: { timezone: string; locale: string };
  dateTime: { dateFormat: string; timeFormat: string; businessDayStartHour: number; weekStartsOn: string };
  interface: { compactMode: boolean };
  defaults: { staffHints: boolean };
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
  tasks: Array<{ id: string; title: string; description: string; status: string; priority: string; dueAt: string; version: number }>;
};

export type StaffPayrollItem = {
  id: string;
  periodStart: string;
  periodEnd: string;
  grossPay: number;
  netPay: number;
  status: string;
  createdAt: string;
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
  accessToken: string;
  refreshToken?: string;
  user: StaffUser;
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
  receipt: { deliveredCount: number; readCount: number };
};

export type StaffMessageReceiptUpdate = { messageId: string; deliveredCount: number; readCount: number };

export type StaffPushDevice = { id: string };
export type StaffPushConfig = { configured: boolean; publicKey: string };

type StaffRefreshResponse = {
  accessToken: string;
  user?: StaffUser;
};

type WebAuthnBegin = { challengeToken: string; publicKey: PublicKeyCredentialRequestOptions | PublicKeyCredentialCreationOptions };
type WebAuthnLoginResponse = StaffLoginResponse;

type ApiEnvelope<T> = { success?: boolean; data?: T; error?: { message?: string } | string; message?: string };

@Injectable({ providedIn: "root" })
export class StaffAppService {
  private readonly baseUrl = environment.apiBaseUrl.replace(/\/$/, "");
  private accessTokenValue = "";
  private tenantIdValue = "";
  private sessionIdValue = "";
  private refreshPromise: Promise<void> | null = null;
  private flushPromise: Promise<number> | null = null;
  private readonly tabId = crypto.randomUUID();
  readonly loading = signal(false);
  readonly error = signal("");

  readonly user = signal<StaffUser | null>(null);
  readonly profile = signal<StaffDashboard["staff"] | null>(null);
  readonly biometricEnabled = signal(!!this.readBiometricHint());
  readonly biometricLocked = signal(false);

  constructor(private readonly http: HttpClient) {
    this.purgeLegacyAuthStorage();
  }

  isAuthenticated(): boolean {
    return !!this.accessTokenValue && !!this.user()?.staffId;
  }

  hasSavedSession(): boolean {
    return this.isAuthenticated();
  }

  async ensureDemoSession(): Promise<boolean> {
    if (this.isAuthenticated()) return true;
    try {
      const response = await firstValueFrom(this.http.get<StaffLoginResponse | ApiEnvelope<StaffLoginResponse>>(`${this.baseUrl}/auth/demo-staff-session`, { withCredentials: false }));
      const session = this.unwrap(response);
      if (!session.user?.staffId) return false;
      this.saveSession(session, "tenant_aura");
      return true;
    } catch {
      return false;
    }
  }

  hasPermission(permission: string): boolean {
    const grants = this.user()?.permissions || [];
    if (!permission) return true;
    if (grants.includes("*")) return true;
    if (grants.includes(permission)) return true;
    const [action, resource] = permission.split(":");
    const writeAliases = new Set(["create", "update", "delete", "back", "print", "export"]);
    return grants.includes(`${action}:*`) ||
      grants.includes("admin:*") ||
      (resource ? grants.includes(`admin:${resource}`) : false) ||
      (resource && writeAliases.has(action) ? grants.includes(`write:${resource}`) || grants.includes("write:*") : false);
  }

  hasAnyPermission(permissions: string[]): boolean {
    return permissions.some((permission) => this.hasPermission(permission));
  }

  hasEveryPermission(permissions: string[]): boolean {
    return permissions.every((permission) => this.hasPermission(permission));
  }

  async login(payload: { tenantId: string; loginId: string; password: string; branchId?: string }): Promise<StaffUser> {
    this.loading.set(true);
    this.error.set("");
    try {
      const tenantId = payload.tenantId.trim() || "tenant_aura";
      const loginId = payload.loginId.trim();
      const csrfResp = await CapacitorHttp.get({ url: `${this.baseUrl}/auth/csrf` });
      const csrfToken = csrfResp.data?.token || csrfResp.headers?.["x-csrf-token"] || "";
      const loginResp = await CapacitorHttp.post({
        url: `${this.baseUrl}/auth/login`,
        headers: {
          "Content-Type": "application/json",
          ...(csrfToken ? { "x-csrf-token": csrfToken } : {})
        },
        data: {
          tenantId,
          loginId,
          email: loginId.includes("@") ? loginId : undefined,
          password: payload.password,
          branchId: payload.branchId?.trim() || undefined,
          device: { type: "staff-app", name: "Aura Staff App", platform: "web" }
        }
      });
      const session = this.unwrap(loginResp.data);
      if (String(session.user?.role || "").trim().toLowerCase() === "owner") { return session.user; }
      if (!session.user?.staffId) throw new Error("This login is not linked with a staff profile.");
      if (!this.isStaffRole(session.user.role)) throw new Error("Use a staff login, not an owner/admin login.");
      this.saveSession(session, tenantId);
      return session.user;
    } catch (error: any) {
      const message = this.errorMessage(error, "Unable to login staff.");
      this.error.set(message);
      throw error;
    } finally {
      this.loading.set(false);
    }
  }

  async dashboard(params: Record<string, string> = {}): Promise<StaffDashboard> {
    this.loading.set(true);
    this.error.set("");
    try {
      return await this.withRefreshRetry(async () => {
        const response = await firstValueFrom(this.http.get<StaffDashboard | ApiEnvelope<StaffDashboard>>(`${this.baseUrl}/staff-self/dashboard`, {
          headers: this.authHeaders(),
          params
        }));
        const dashboard = this.unwrap(response);
        this.profile.set(dashboard.staff);
        return dashboard;
      });
    } catch (error) {
      const message = this.errorMessage(error, "Unable to load staff dashboard.");
      this.error.set(message);
      throw error;
    } finally {
      this.loading.set(false);
    }
  }

  async enterpriseOs(query: Record<string, string> = {}): Promise<StaffEnterpriseOs> {
    return this.get<StaffEnterpriseOs>("/staff-self/enterprise-os", query);
  }

  async workspacePreferences(): Promise<StaffWorkspacePreferences> {
    return this.get<StaffWorkspacePreferences>("/staff-self/workspace-preferences");
  }

  async business(input: string | StaffBusinessQuery): Promise<StaffBusiness> {
    const query = typeof input === "string" ? { date: input } : input;
    return this.get<StaffBusiness>("/staff-self/business", this.stringQuery(query));
  }

  async businessInvoice(invoiceId: string): Promise<StaffBusinessInvoiceDetail> {
    return this.get<StaffBusinessInvoiceDetail>(`/staff-self/business/invoices/${encodeURIComponent(invoiceId)}`);
  }

  async updateNotification(id: string, status: "read" | "unread" | "archived" = "read"): Promise<unknown> {
    return this.queueableMutation("PATCH", `/staff-self/notifications/${encodeURIComponent(id)}`, { status });
  }

  async mobilePushConfig(): Promise<StaffPushConfig> {
    return this.get<StaffPushConfig>("/mobile/push-config");
  }

  async registerPushDevice(id: string, options: { platform?: string; pushProvider?: string; deviceToken?: string } = {}): Promise<StaffPushDevice> {
    return this.post<StaffPushDevice>("/mobile/devices", {
      id,
      platform: options.platform || "web",
      pushProvider: options.pushProvider || "web-push",
      deviceToken: options.deviceToken || "",
      appVersion: "0.1.0",
      capabilities: { pwa: options.platform !== "android", native: options.platform === "android", pushNotifications: true }
    });
  }

  async registerPushSubscription(payload: Record<string, unknown>): Promise<unknown> {
    return this.post("/mobile/push-subscriptions", payload);
  }

  async updateSchedule(scheduleId: string, payload: { version: number; scheduleDate?: string; startTime?: string; endTime?: string; status?: string; notes?: string }): Promise<unknown> {
    return this.patch(`/staff-self/calendar/${encodeURIComponent(scheduleId)}`, payload);
  }

  async chatThreads(): Promise<StaffChatThread[]> {
    return this.get<StaffChatThread[]>("/staff-self/chat/threads");
  }

  async chatMessages(threadId: string): Promise<StaffChatMessage[]> {
    return this.get<StaffChatMessage[]>(`/staff-self/chat/threads/${encodeURIComponent(threadId)}/messages`);
  }

  async sendChatMessage(threadId: string, body: string): Promise<StaffChatMessage> {
    return this.post<StaffChatMessage>("/staff-self/chat/messages", { threadId, body });
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

  async markStaffMessageReceipts(conversationId: string, messageIds: string[], status: "delivered" | "read"): Promise<{ conversationId: string; receipts: StaffMessageReceiptUpdate[] }> {
    return this.post(`/team-chat/conversations/${encodeURIComponent(conversationId)}/receipts`, { messageIds, status });
  }

  async today(date = staffBusinessDate()): Promise<StaffToday> {
    return this.get<StaffToday>("/staff-os/mobile/today", { date });
  }

  async attendanceHistory(days = 30): Promise<StaffAttendance[]> {
    const to = staffBusinessDate();
    const start = new Date(`${to}T00:00:00.000Z`);
    start.setUTCDate(start.getUTCDate() - Math.max(0, days - 1));
    return this.get<StaffAttendance[]>("/staff-os/attendance", {
      from: start.toISOString().slice(0, 10),
      to,
      limit: "500"
    });
  }

  async overtimeSummary(): Promise<StaffOvertimeSummary> {
    return this.get<StaffOvertimeSummary>("/staff-os/attendance/overtime-summary", { asOf: staffBusinessDate() });
  }

  async payroll(): Promise<StaffPayrollItem[]> {
    return this.get<StaffPayrollItem[]>("/staff-os/mobile/payroll");
  }

  async targets(): Promise<StaffTarget[]> {
    return this.get<StaffTarget[]>("/staff-os/mobile/targets");
  }

  async leaves(): Promise<StaffLeave[]> {
    return this.get<StaffLeave[]>("/staff-os/leaves", { limit: "6" });
  }

  async leaveBalances(): Promise<StaffLeaveBalance[]> {
    return this.get<StaffLeaveBalance[]>("/staff-os/leave-balances");
  }

  async clockIn(): Promise<MutationResult<StaffAttendance>> {
    return this.queueableMutation<StaffAttendance>("POST", "/staff-os/attendance/clock-in", { source: "staff-app" });
  }

  async clockOut(attendanceId?: string): Promise<MutationResult<StaffAttendance>> {
    return this.queueableMutation<StaffAttendance>("POST", "/staff-os/attendance/clock-out", { attendanceId });
  }

  async startBreak(): Promise<MutationResult<unknown>> {
    return this.queueableMutation("POST", "/staff-os/attendance/break-start", { breakType: "regular" });
  }

  async endBreak(): Promise<MutationResult<unknown>> {
    return this.queueableMutation("POST", "/staff-os/attendance/break-end", {});
  }

  async requestLeave(payload: { leaveType: string; startDate: string; endDate: string; reason: string }): Promise<unknown> {
    return this.post("/staff-os/mobile/request-leave", payload);
  }

  async completeTask(taskId: string, version: number): Promise<MutationResult<unknown>> {
    return this.queueableMutation("PATCH", `/staff-os/tasks/${encodeURIComponent(taskId)}`, { status: "completed", version });
  }

  async moveTask(taskId: string, version: number, status: string): Promise<MutationResult<unknown>> {
    return this.queueableMutation("PATCH", `/staff-os/tasks/${encodeURIComponent(taskId)}`, { status, version });
  }

  async logout(): Promise<void> {
    try {
      if (!this.accessTokenValue) await this.refreshSession();
      await firstValueFrom(this.http.post(`${this.baseUrl}/auth/logout`, {}, { headers: this.authHeaders(), withCredentials: false }));
    } catch {
      // Local state must still be destroyed when the server session is already invalid.
    } finally {
      if (typeof sessionStorage !== "undefined") sessionStorage.removeItem("auraStaffHintSeen");
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
    const credential = await navigator.credentials.create({ publicKey: this.decodeCreationOptions(begin.publicKey as PublicKeyCredentialCreationOptions) });
    if (!(credential instanceof PublicKeyCredential)) throw new Error("Passkey setup was cancelled.");
    await this.authPost("/auth/webauthn/register/finish", {
      challengeToken: begin.challengeToken,
      id: credential.id,
      rawId: this.arrayBufferToBase64Url(credential.rawId),
      response: this.registrationResponse(credential.response)
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
    const begin = await this.publicPost<WebAuthnBegin>("/auth/webauthn/login/begin", hint);
    const credential = await navigator.credentials.get({ publicKey: this.decodeRequestOptions(begin.publicKey as PublicKeyCredentialRequestOptions) });
    if (!(credential instanceof PublicKeyCredential)) throw new Error("Passkey login was cancelled.");
    const response = await this.publicPost<WebAuthnLoginResponse>("/auth/webauthn/login/finish", {
      challengeToken: begin.challengeToken,
      id: credential.id,
      rawId: this.arrayBufferToBase64Url(credential.rawId),
      response: this.authenticationResponse(credential.response)
    });
    if (!response.user?.staffId || !this.isStaffRole(response.user.role)) throw new Error("Passkey is not linked to a staff profile.");
    this.saveSession(response, hint.tenantId);
  }

  openSession(session: { accessToken: string; user: StaffUser }) {
    this.saveSession({ accessToken: session.accessToken, user: session.user }, "tenant_aura");
  }

  realtimeSocketUrl(): string {
    if (!this.isAuthenticated()) return "";
    return this.buildRealtimeSocketUrl();
  }

  async realtimeSocketTicketUrl(): Promise<string> {
    if (!this.isAuthenticated()) return "";
    const branchId = this.user()?.branchId || this.user()?.branchIds?.[0] || "";
    const response = await this.authPost<{ ticket: string; expiresIn: number }>("/realtime/ticket", { branchId }, true);
    if (!response.ticket) throw new Error("Realtime ticket was not issued.");
    return this.buildRealtimeSocketUrl(response.ticket);
  }

  private buildRealtimeSocketUrl(ticket = ""): string {
    const branchId = this.user()?.branchId || this.user()?.branchIds?.[0] || "";
    const base = this.baseUrl.startsWith("http")
      ? new URL(this.baseUrl)
      : new URL(this.baseUrl, window.location.origin);
    base.protocol = base.protocol === "https:" ? "wss:" : "ws:";
    base.pathname = `${base.pathname.replace(/\/$/, "")}/realtime`;
    if (ticket) base.searchParams.set("ticket", ticket);
    if (branchId) base.searchParams.set("branchId", branchId);
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

  private authHeaders(): HttpHeaders {
    const token = this.accessTokenValue;
    if (!token) throw new Error("Staff login required.");
    return new HttpHeaders({ Authorization: `Bearer ${token}` });
  }

  private stringQuery(query: StaffBusinessQuery): Record<string, string> {
    return Object.fromEntries(
      Object.entries(query)
        .filter(([, value]) => value !== undefined && value !== null && value !== "")
        .map(([key, value]) => [key, String(value)])
    );
  }

  private async get<T>(path: string, params: Record<string, string> = {}): Promise<T> {
    this.loading.set(true);
    this.error.set("");
    try {
      return await this.withRefreshRetry(async () => {
        const response = await firstValueFrom(this.http.get<T | ApiEnvelope<T>>(`${this.baseUrl}${path}`, { headers: this.authHeaders(), params }));
        return this.unwrap(response);
      });
    } catch (error) {
      const message = this.errorMessage(error, "Unable to load staff data.");
      this.error.set(message);
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
      return await this.withRefreshRetry(async () => {
        const response = await firstValueFrom(this.http.post<T | ApiEnvelope<T>>(`${this.baseUrl}${path}`, body, { headers: this.authHeaders() }));
        return this.unwrap(response);
      });
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
      return await this.withRefreshRetry(async () => {
        const response = await firstValueFrom(this.http.patch<T | ApiEnvelope<T>>(`${this.baseUrl}${path}`, body, { headers: this.authHeaders() }));
        return this.unwrap(response);
      });
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
    this.accessTokenValue = session.accessToken;
    this.tenantIdValue = tenantId;
    this.sessionIdValue = crypto.randomUUID();
    this.profile.set(null);
    this.user.set(session.user);
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
          { device: { type: "staff-app", name: "Aura Staff App", platform: "web" } },
          { withCredentials: false }
        ));
        const session = this.unwrap(response);
        if (!session.accessToken) throw new Error("Staff session refresh failed.");
        this.accessTokenValue = session.accessToken;
        if (session.user?.staffId) {
          if (this.user()?.id && this.user()?.id !== session.user.id) this.clearOfflineState();
          this.profile.set(null);
          this.user.set(session.user);
          this.tenantIdValue ||= this.readBiometricHint()?.tenantId || "";
          this.sessionIdValue ||= crypto.randomUUID();
        }
      } catch (error) {
        this.clearLocalAuthState(false);
        throw error;
      }
    })().finally(() => { this.refreshPromise = null; });
    return this.refreshPromise;
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

  private isStaffRole(role: string): boolean {
    return !["owner", "admin", "superAdmin"].includes(String(role || ""));
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
      return await this.withRefreshRetry(async () => {
        const headers = this.authHeaders().set("Idempotency-Key", idempotencyKey);
        const response = await firstValueFrom(this.http.post<T | ApiEnvelope<T>>(`${this.baseUrl}${path}`, body, { headers }));
        return this.unwrap(response);
      });
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
    if (method === "PATCH" && /^\/staff-os\/tasks\/[^/]+$/.test(path)) return Object.keys(body).every((key) => ["status", "version"].includes(key)) && typeof body["version"] === "number";
    if (method === "POST" && ["/staff-os/attendance/clock-in", "/staff-os/attendance/clock-out", "/staff-os/attendance/break-start", "/staff-os/attendance/break-end"].includes(path)) {
      return Object.keys(body).every((key) => ["staffId", "source", "attendanceId", "breakType"].includes(key));
    }
    return false;
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
    return this.withRefreshRetry(async () => {
      const request = method === "POST" ? this.http.post<unknown>(`${this.baseUrl}${path}`, body, { headers }) : this.http.patch<unknown>(`${this.baseUrl}${path}`, body, { headers });
      return firstValueFrom(request);
    });
  }

  private clearLocalAuthState(clearBiometric: boolean): void {
    resetCsrfState();
    this.accessTokenValue = "";
    this.tenantIdValue = "";
    this.sessionIdValue = "";
    this.profile.set(null);
    this.user.set(null);
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

  private async publicPost<T>(path: string, body: Record<string, unknown>): Promise<T> {
    const response = await firstValueFrom(this.http.post<T | ApiEnvelope<T>>(`${this.baseUrl}${path}`, body, { withCredentials: false }));
    return this.unwrap(response);
  }

  private async authPost<T = unknown>(path: string, body: Record<string, unknown>, authenticated = false): Promise<T> {
    if (!authenticated) return this.publicPost<T>(path, body);
    return this.withRefreshRetry(async () => {
      const response = await firstValueFrom(this.http.post<T | ApiEnvelope<T>>(`${this.baseUrl}${path}`, body, { headers: this.authHeaders(), withCredentials: false }));
      return this.unwrap(response);
    });
  }

  private decodeCreationOptions(options: PublicKeyCredentialCreationOptions): PublicKeyCredentialCreationOptions {
    return { ...options, challenge: this.base64UrlToArrayBuffer(String(options.challenge)), user: { ...options.user, id: this.base64UrlToArrayBuffer(String(options.user.id)) } };
  }

  private decodeRequestOptions(options: PublicKeyCredentialRequestOptions): PublicKeyCredentialRequestOptions {
    return { ...options, challenge: this.base64UrlToArrayBuffer(String(options.challenge)), allowCredentials: options.allowCredentials?.map((item) => ({ ...item, id: this.base64UrlToArrayBuffer(String(item.id)) })) };
  }

  private registrationResponse(response: AuthenticatorResponse): Record<string, unknown> {
    if (!(response instanceof AuthenticatorAttestationResponse)) throw new Error("Invalid passkey registration response.");
    return { clientDataJSON: this.arrayBufferToBase64Url(response.clientDataJSON), attestationObject: this.arrayBufferToBase64Url(response.attestationObject) };
  }

  private authenticationResponse(response: AuthenticatorResponse): Record<string, unknown> {
    if (!(response instanceof AuthenticatorAssertionResponse)) throw new Error("Invalid passkey authentication response.");
    return { clientDataJSON: this.arrayBufferToBase64Url(response.clientDataJSON), authenticatorData: this.arrayBufferToBase64Url(response.authenticatorData), signature: this.arrayBufferToBase64Url(response.signature), userHandle: response.userHandle ? this.arrayBufferToBase64Url(response.userHandle) : null };
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
