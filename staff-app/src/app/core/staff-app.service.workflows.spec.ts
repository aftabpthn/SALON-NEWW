import "@angular/compiler";
import { HttpClient, HttpHeaders } from "@angular/common/http";
import { Observable, of, throwError } from "rxjs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { StaffAppService, StaffUser } from "./staff-app.service";

type Method = "GET" | "POST" | "PATCH" | "PUT";
type RequestOptions = { headers?: HttpHeaders; params?: Record<string, string> };
type Call = { method: Method; url: string; body: unknown; options: RequestOptions };
type Responder = (call: Call) => Observable<unknown>;

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();
  get length(): number { return this.values.size; }
  clear(): void { this.values.clear(); }
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  key(index: number): string | null { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string): void { this.values.delete(key); }
  setItem(key: string, value: string): void { this.values.set(key, String(value)); }
}

class MockHttpClient {
  readonly calls: Call[] = [];
  constructor(private readonly responder: Responder) {}
  get = vi.fn((url: string, options: RequestOptions = {}) => this.respond("GET", url, undefined, options));
  post = vi.fn((url: string, body: unknown, options: RequestOptions = {}) => this.respond("POST", url, body, options));
  patch = vi.fn((url: string, body: unknown, options: RequestOptions = {}) => this.respond("PATCH", url, body, options));
  put = vi.fn((url: string, body: unknown, options: RequestOptions = {}) => this.respond("PUT", url, body, options));
  private respond(method: Method, url: string, body: unknown, options: RequestOptions): Observable<unknown> {
    const call = { method, url, body, options };
    this.calls.push(call);
    return this.responder(call);
  }
}

const staffUser: StaffUser = {
  id: "user-1",
  loginId: "staff-one",
  name: "Staff One",
  email: "staff@example.test",
  role: "staff",
  staffId: "staff-1",
  branchId: "branch-1",
  branchIds: ["branch-1"],
  permissions: ["read:staff", "read:payroll", "allow:staff-checkin-checkout"]
};

function createService(responder: Responder): { service: StaffAppService; http: MockHttpClient } {
  const http = new MockHttpClient((call) => {
    if (call.method === "POST" && call.url.endsWith("/auth/login")) {
      return of({ accessToken: "access-1", refreshToken: "refresh-1", user: staffUser });
    }
    return responder(call);
  });
  return { service: new StaffAppService(http as unknown as HttpClient), http };
}

async function login(service: StaffAppService): Promise<void> {
  await service.login({ tenantId: "tenant-1", loginId: "staff-one", password: "password" });
}

describe("StaffAppService staff workflows", () => {
  beforeEach(() => {
    Object.defineProperty(globalThis, "localStorage", { configurable: true, value: new MemoryStorage() });
    Object.defineProperty(globalThis, "navigator", { configurable: true, value: { onLine: true, credentials: undefined } });
  });

  it("scopes leave reads and requests to the authenticated staff member", async () => {
    const { service, http } = createService(({ method, url }) => {
      if (method === "GET" && url.endsWith("/staff-leave/requests")) return of([]);
      if (method === "POST" && url.endsWith("/staff-leave/requests")) return of({ id: "leave-1" });
      return throwError(() => new Error(`Unexpected request: ${method} ${url}`));
    });
    await login(service);

    await service.leaves();
    await service.requestLeave({ leaveType: "annual", startDate: "2026-08-01", endDate: "2026-08-02", reason: "Family" });

    const read = http.calls.find((call) => call.method === "GET" && call.url.endsWith("/staff-leave/requests"));
    const write = http.calls.find((call) => call.method === "POST" && call.url.endsWith("/staff-leave/requests"));
    expect(read?.options.params).toMatchObject({ staffId: "staff-1" });
    expect(write?.body).toEqual({ leaveType: "annual", startDate: "2026-08-01", endDate: "2026-08-02", reason: "Family", staffId: "staff-1" });
  });

  it("queues leave requests offline and flushes them after reconnecting", async () => {
    const { service, http } = createService(({ method, url }) => {
      if (method === "POST" && url.endsWith("/staff-leave/requests")) return of({ id: "leave-1" });
      return throwError(() => new Error(`Unexpected request: ${method} ${url}`));
    });
    await login(service);
    Object.defineProperty(globalThis, "navigator", { configurable: true, value: { onLine: false, credentials: undefined } });

    await expect(service.requestLeave({ leaveType: "annual", startDate: "2026-08-01", endDate: "2026-08-02", reason: "Family" }))
      .resolves.toMatchObject({ state: "queued" });
    expect(http.calls.some((call) => call.url.endsWith("/staff-leave/requests"))).toBe(false);

    Object.defineProperty(globalThis, "navigator", { configurable: true, value: { onLine: true, credentials: undefined } });
    await expect(service.flushOfflineActions()).resolves.toBe(1);
    expect(http.calls.find((call) => call.url.endsWith("/staff-leave/requests"))?.body).toMatchObject({ staffId: "staff-1" });
  });

  it("maps payroll paise and payslip data from the self dashboard", async () => {
    const { service } = createService(({ method, url }) => {
      if (method === "GET" && url.endsWith("/staff/self/dashboard")) {
        return of({ payrollProfile: { rate_type: "monthly", amount_paise: 4000000, effective_from: "2026-07-01" }, payroll: [{ run_id: "run-1", period_start: "2026-07-01", period_end: "2026-07-31", earned_salary_paise: 90000, overtime_paise: 5000, commission_paise: 25000, adjustment_paise: 0, gross_paise: 120000, deductions_paise: 15000, net_paise: 105000, status: "finalized", payment_method: "bank", reference: "pay-ref-1", paid_at: "2026-08-01T10:00:00Z", payslip_path: "/staff/self/payslips/run-1" }] });
      }
      return throwError(() => new Error(`Unexpected request: ${method} ${url}`));
    });
    await login(service);

    await expect(service.payroll()).resolves.toEqual([expect.objectContaining({
      id: "run-1",
      grossPay: 120000,
      salaryPay: 90000,
      commissionPay: 25000,
      deductionsPay: 15000,
      netPay: 105000,
      paymentMethod: "bank",
      payslipPath: "/staff/self/payslips/run-1"
    })]);
    await expect(service.payrollOverview()).resolves.toEqual(expect.objectContaining({
      profile: { rateType: "monthly", amountPaise: 4000000, effectiveFrom: "2026-07-01" }
    }));
  });

  it("uses only the routed team-chat contract and preserves idempotency", async () => {
    const { service, http } = createService(({ method, url }) => {
      if (method === "GET" && url.endsWith("/team-chat/conversations")) return of([]);
      if (method === "GET" && url.endsWith("/team-chat/conversations/conversation%20%2F1/messages")) return of([]);
      if (method === "POST" && url.endsWith("/team-chat/conversations/conversation%20%2F1/messages")) return of({ id: "message-1" });
      return throwError(() => new Error(`Unexpected request: ${method} ${url}`));
    });
    await login(service);

    await service.staffChatConversations();
    await service.staffConversationMessages("conversation /1");
    await service.sendStaffConversationMessage("conversation /1", "Hello", "idempotency-1");

    const send = http.calls.find((call) => call.method === "POST" && call.url.includes("/team-chat/conversations/"));
    expect(send?.body).toEqual({ body: "Hello" });
    expect(send?.options.headers?.get("Idempotency-Key")).toBe("idempotency-1");
    expect(http.calls.some((call) => call.url.includes("/staff-self/chat/"))).toBe(false);
  });

  it("persists workspace preferences through the self preference endpoint", async () => {
    let compactMode = false;
    const preferences = () => ({
      workspace: { workspaceName: "Front desk" },
      localization: { timezone: "Asia/Kolkata", locale: "en-IN" },
      dateTime: { dateFormat: "DD/MM/YYYY", timeFormat: "HH:mm", businessDayStartHour: 0, weekStartsOn: "monday" },
      interface: { compactMode },
      defaults: { staffHints: false }
    });
    const { service, http } = createService(({ method, url, body }) => {
      if (method === "GET" && url.endsWith("/staff-self/workspace-preferences")) return of(preferences());
      if (method === "PUT" && url.endsWith("/staff-self/workspace-preferences")) {
        compactMode = Boolean((body as Record<string, unknown>)["compactMode"]);
        return of(preferences());
      }
      return throwError(() => new Error(`Unexpected request: ${method} ${url}`));
    });
    await login(service);

    await expect(service.workspacePreferences()).resolves.toMatchObject({ interface: { compactMode: false } });
    await service.saveWorkspacePreferences({ compactMode: true, timezone: "Asia/Kolkata", dateFormat: "DD/MM/YYYY", timeFormat: "HH:mm" });
    await expect(service.workspacePreferences()).resolves.toMatchObject({ interface: { compactMode: true } });

    const save = http.calls.find((call) => call.method === "PUT" && call.url.endsWith("/staff-self/workspace-preferences"));
    expect(save?.body).toMatchObject({ compactMode: true });
  });

  it("sends all attendance actions through the scoped real endpoints", async () => {
    const { service, http } = createService(({ method, url }) => {
      if (method === "POST" && url.includes("/staff-attendance/")) return of({ id: "attendance-1" });
      return throwError(() => new Error(`Unexpected request: ${method} ${url}`));
    });
    await login(service);

    await service.clockIn();
    await service.startBreak();
    await service.endBreak();
    await service.clockOut("attendance-1");

    const actions = http.calls.filter((call) => call.method === "POST" && call.url.includes("/staff-attendance/"));
    expect(actions.map((call) => call.url.split("/staff-attendance/")[1])).toEqual(["clock-in", "break-start", "break-end", "clock-out"]);
    expect(actions.every((call) => (call.body as Record<string, unknown>)["staffId"] === "staff-1")).toBe(true);
    expect(actions[3]?.body).toMatchObject({ attendanceId: "attendance-1" });
  });

  it("uses a server challenge and browser biometric credential for biometric clock-in", async () => {
    class MockAssertionResponse {
      readonly clientDataJSON = new Uint8Array([1]).buffer;
      readonly authenticatorData = new Uint8Array([2]).buffer;
      readonly signature = new Uint8Array([3]).buffer;
      readonly userHandle = null;
    }
    class MockCredential {
      readonly id = "credential-1";
      readonly rawId = new Uint8Array([4]).buffer;
      readonly type = "public-key";
      readonly response = new MockAssertionResponse();
    }
    const credential = new MockCredential();
    Object.defineProperty(globalThis, "window", { configurable: true, value: { dispatchEvent: vi.fn() } });
    Object.defineProperty(globalThis, "AuthenticatorAssertionResponse", { configurable: true, value: MockAssertionResponse });
    Object.defineProperty(globalThis, "PublicKeyCredential", { configurable: true, value: MockCredential });
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: {
        onLine: true,
        credentials: { get: vi.fn().mockResolvedValue(credential) },
        geolocation: {
          getCurrentPosition: (resolve: PositionCallback) => resolve({ coords: { latitude: 28.61, longitude: 77.21, accuracy: 12 } } as GeolocationPosition)
        }
      }
    });
    const { service, http } = createService(({ method, url }) => {
      if (method === "POST" && url.endsWith("/staff-attendance/biometric/begin")) {
        return of({ challengeId: "challenge-1", options: { challenge: "AQ", userVerification: "required" } });
      }
      if (method === "POST" && url.endsWith("/staff-attendance/clock-in")) return of({ id: "attendance-1" });
      return throwError(() => new Error(`Unexpected request: ${method} ${url}`));
    });
    await login(service);

    await service.biometricClockIn();

    const calls = http.calls.filter((call) => call.url.includes("/staff-attendance/"));
    expect(calls.map((call) => call.url.split("/staff-attendance/")[1])).toEqual(["biometric/begin", "clock-in"]);
    expect(calls[1]?.body).toMatchObject({
      staffId: "staff-1",
      source: "staff-app-biometric",
      faceScan: {
        challengeId: "challenge-1",
        deviceUid: expect.stringMatching(/^staff_face_/),
        credential: { id: "BA", clientDataJSON: "AQ", authenticatorData: "Ag", signature: "Aw" }
      }
    });
    expect(calls[1]?.body).not.toHaveProperty("faceScan.livenessResponse");
    expect(calls[1]?.body).not.toHaveProperty("faceScan.providerEventId");
  });

  it("uses self-scoped real appointment mutation endpoints", async () => {
    const { service, http } = createService(({ method, url }) => {
      if (method === "POST" && url.includes("/staff-self/appointments/")) return of({ id: "appointment-1" });
      return throwError(() => new Error(`Unexpected request: ${method} ${url}`));
    });
    await login(service);

    await service.rescheduleAppointment("appointment /1", { startAt: "2026-08-01T04:30:00.000Z", reason: "Client requested" });
    await service.cancelAppointment("appointment /1", "Client unavailable");

    const actions = http.calls.filter((call) => call.method === "POST" && call.url.includes("/staff-self/appointments/"));
    expect(actions.map((call) => call.url.split("/staff-self/appointments/")[1])).toEqual(["appointment%20%2F1/reschedule", "appointment%20%2F1/cancel"]);
    expect(actions[0]?.body).toEqual({ start_at: "2026-08-01T04:30:00.000Z", reason: "Client requested" });
    expect(actions[1]?.body).toEqual({ reason: "Client unavailable" });
  });
});
