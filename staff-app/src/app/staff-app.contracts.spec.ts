import "@angular/compiler";
import { describe, expect, it, vi } from "vitest";
vi.mock("./features/staff/staff-page-state.component", () => ({ StaffPageStateComponent: class {} }));
import { environment as productionEnvironment } from "../environments/environment.prod";
import { environment as developmentEnvironment } from "../environments/environment";
import { routes } from "./app.routes";
import { addBusinessDays, businessDate } from "./core/business-date";
import { formatPaiseInr, PaiseInrPipe } from "./core/paise-inr.pipe";
import { scheduledShiftMinutes } from "./core/staff-app.service";
import { StaffLayoutPage } from "./features/staff/staff-layout.page";
import { StaffAppointmentsPage } from "./features/staff/staff-appointments.page";
import { StaffBusinessPage } from "./features/staff/staff-business.page";
import { StaffTasksPage } from "./features/staff/staff-tasks.page";
import { StaffAttendancePage } from "./features/staff/staff-attendance.page";
import { StaffRosterPage } from "./features/staff/staff-roster.page";
import { StaffCalendarPage } from "./features/staff/staff-calendar.page";
import { StaffLeaderboardPage } from "./features/staff/staff-leaderboard.page";
import { StaffReportsPage } from "./features/staff/staff-reports.page";
import { StaffLeavesPage } from "./features/staff/staff-leaves.page";
import { StaffProfilePage } from "./features/staff/staff-profile.page";
import { StaffSettingsPage } from "./features/staff/staff-settings.page";

describe("staff presentation contracts", () => {
  it("keeps dashboard appointments when the optional enterprise timeline fails", async () => {
    const dashboard = { appointments: [] };
    const page = new StaffAppointmentsPage({
      dashboard: vi.fn().mockResolvedValue(dashboard),
      enterpriseOs: vi.fn().mockRejectedValue(new Error("optional API unavailable")),
      error: () => "",
      user: () => ({ staffId: "staff-1", branchId: "branch-1" })
    } as never);

    await page.load();

    expect(page.dashboard()).toBe(dashboard);
    expect(page.loadError()).toBe("");
  });

  it("classifies completed appointments by status instead of age", () => {
    const page = new StaffAppointmentsPage({ hasPermission: vi.fn().mockReturnValue(false) } as never);
    const booked = { id: "booked", status: "booked", startAt: "2020-01-01T10:00:00Z" };
    const paid = { id: "paid", status: "paid", startAt: "2020-01-01T11:00:00Z" };
    page.dashboard.set({ appointments: [booked, paid] } as never);

    expect(page.kpiCounts().completed).toBe(1);
    page.activeView.set("completed");
    expect(page.visibleAppointments().map((item) => item.id)).toEqual(["paid"]);
    page.setView("all");
    expect(page.activeView()).toBe("completed");
  });

  it("shows product-usage mutation controls only with the backend write permission", () => {
    const hasAnyPermission = vi.fn().mockReturnValue(false);
    const page = new StaffBusinessPage({ hasAnyPermission } as never);

    expect(page.canRecordProductUsage()).toBe(false);
    expect(hasAnyPermission).toHaveBeenCalledWith(["staff.self_manage", "staff_self.write"]);
  });

  it("keeps self-scoped tasks available when optional service targets fail", async () => {
    const tasks = [{ id: "task-1", title: "Review SOP", description: "", taskType: "training", status: "blocked", priority: "high", dueAt: "", version: 2 }];
    const page = new StaffTasksPage({
      tasks: vi.fn().mockResolvedValue(tasks),
      serviceTargets: vi.fn().mockRejectedValue(new Error("optional API unavailable")),
      error: () => ""
    } as never);

    await page.load();

    expect(page.tasks()).toEqual(tasks);
    expect(page.tasksByStatus("blocked")).toEqual(tasks);
    expect(page.loadError()).toBe("");
    expect(page.targetLoadError()).toBe("Unable to load service targets.");
  });

  it("renders today's attendance when optional history fails", async () => {
    const today = { date: "2026-07-31", schedules: [], attendance: [], activeBreak: null };
    const page = new StaffAttendancePage({
      attendanceToday: vi.fn().mockResolvedValue(today),
      attendanceHistory: vi.fn().mockRejectedValue(new Error("history unavailable")),
      earlyDepartureRequests: vi.fn().mockResolvedValue([]),
      error: () => ""
    } as never);

    await page.load();
    await page.loadHistory();

    expect(page.today()).toEqual(today);
    expect(page.loadError()).toBe("");
    expect(page.historyLoadError()).toBe("Unable to load attendance history.");
  });

  it("loads roster through its self-scoped contract", async () => {
    const service = { roster: vi.fn(), error: () => "" };
    const page = new StaffRosterPage(service as never);
    const roster = [{ id: "schedule-1", date: page.windowStart(), startTime: "11:00", endTime: "21:00", type: "shift", status: "working", version: 1 }];
    service.roster.mockResolvedValue(roster);

    await page.load();

    expect(page.roster()).toEqual(roster);
    expect(service.roster).toHaveBeenCalledWith(page.windowStart(), page.windowEnd());
    expect(page.selectedSchedules()).toEqual(roster);
  });

  it("keeps self-scoped calendar available when optional appointments fail", async () => {
    const service = {
      calendar: vi.fn(),
      enterpriseOs: vi.fn().mockRejectedValue(new Error("appointments unavailable")),
      hasPermission: vi.fn().mockReturnValue(true),
      error: () => ""
    };
    const page = new StaffCalendarPage(service as never);
    const calendar = [{ id: "schedule-1", date: page.selectedDate(), startTime: "11:00", endTime: "21:00", type: "shift", status: "working", version: 1 }];
    service.calendar.mockResolvedValue(calendar);

    await page.load();
    await page.loadTimeline();

    expect(page.calendar()).toEqual(calendar);
    expect(page.daySchedules()).toEqual(calendar);
    expect(page.loadError()).toBe("");
    expect(page.timelineError()).toBe("Unable to load appointment timeline.");
  });

  it("reports only the missing CRM sources for leaderboard readiness", () => {
    const page = new StaffLeaderboardPage({ hasPermission: vi.fn(), hasAnyPermission: vi.fn() } as never);
    const data = { gamification: { badges: [], sourceStatus: { appointments: true, attendance: true, schedule: true, clients: false, revenueTarget: false, sharedReview: true } } } as never;

    expect(page.sourceGaps(data)).toEqual([
      "Client service history — Clients / Appointments",
      "Revenue target — Staff profile"
    ]);
  });

  it("reports missing CRM report sources without requiring financial visibility", () => {
    const page = new StaffReportsPage({ hasPermission: vi.fn() } as never);
    const data = { services: [], summary: { appointments: 0 }, performance: { dutyMinutes: 0, invoiceCount: 0 }, permissions: { serviceAmount: false } } as never;

    expect(page.sourceGaps(data)).toEqual([
      "Active service catalogue — CRM Services",
      "Assigned appointments — CRM Appointments",
      "Published schedule or attendance — CRM Availability / Attendance"
    ]);
  });

  it("keeps leave balances visible when leave requests fail", async () => {
    const balances = [{ id: "staff-1:annual:2026", leaveType: "annual", balance: 8 }];
    const page = new StaffLeavesPage({
      hasPermission: vi.fn().mockReturnValue(true),
      leaves: vi.fn().mockRejectedValue(new Error("requests unavailable")),
      leaveBalances: vi.fn().mockResolvedValue(balances),
      error: () => ""
    } as never);

    await page.load();

    expect(page.balances()).toEqual(balances);
    expect(page.requestsUnavailable()).toBe(true);
    expect(page.balancesUnavailable()).toBe(false);
  });

  it("reports only missing Staff CRM profile fields", () => {
    const page = new StaffProfilePage({
      hasPermission: vi.fn().mockReturnValue(true),
      user: () => ({ loginId: "staff-login" })
    } as never);
    const data = { staff: { designation: "Stylist", department: "", mobile: "", email: "staff@example.com" } } as never;

    expect(page.sourceGaps(data)).toEqual(["Designation or department", "Mobile or email"]);
  });

  it("keeps Staff App settings read-only without manage permission", () => {
    const page = new StaffSettingsPage({
      hasPermission: vi.fn((permission: string) => permission === "staff.app.settings.read")
    } as never, {} as never);

    expect(page.canReadSettings()).toBe(true);
    expect(page.canManageSettings()).toBe(false);
    expect(page.canSavePreferences()).toBe(false);
  });

  it("calculates captured split-shift minutes without inventing legacy schedules", () => {
    expect(scheduledShiftMinutes("09:00:00", "13:00:00", "14:00", "18:30")).toBe(510);
    expect(scheduledShiftMinutes("", "")).toBeNull();
    expect(scheduledShiftMinutes("09:99", "18:00")).toBeNull();
  });

  it.each([
    [null, "-"],
    [undefined, "-"],
    ["invalid", "-"],
    [0, "\u20b90"],
    [1, "\u20b90.01"],
    [123456789, "\u20b912,34,567.89"],
    [-5050, "-\u20b950.5"]
  ])("formats %s paise without losing paise precision", (paise, expected) => {
    const formatted = formatPaiseInr(paise).replace(/\s/g, "");
    expect(formatted).toBe(expected);
  });

  it("exposes the same behavior through the standalone pipe", () => {
    expect(new PaiseInrPipe().transform("101").replace(/\s/g, "")).toBe("\u20b91.01");
  });

  it("uses the IST date at UTC day boundaries and rejects invalid dates", () => {
    expect(businessDate(new Date("2026-07-14T18:29:59.999Z"))).toBe("2026-07-14");
    expect(businessDate(new Date("2026-07-14T18:30:00.000Z"))).toBe("2026-07-15");
    expect(businessDate(new Date("invalid"))).toBe("");
  });

  it("handles business-date month, year, and negative offsets", () => {
    expect(addBusinessDays("2024-02-28", 1)).toBe("2024-02-29");
    expect(addBusinessDays("2026-01-01", -1)).toBe("2025-12-31");
    expect(addBusinessDays("not-a-date", 1)).toBe("not-a-date");
  });
});

describe("staff routing and production configuration", () => {
  it("bypasses the Vite WebSocket proxy only in local development", () => {
    expect(developmentEnvironment.realtimeWsBaseUrl).toBe("ws://127.0.0.1:8082/api/v1");
    expect(productionEnvironment.realtimeWsBaseUrl).toBe("");
  });
  it.each([
    ["/staff/dashboard", false],
    ["/staff/appointments?date=today", false],
    ["/staff/payroll", true]
  ])("marks More active for secondary route %s", (url, expected) => {
    const layout = new StaffLayoutPage({} as never, {} as never, { url } as never);
    expect(layout.isMoreActive()).toBe(expected);
  });

  it("configures the guarded standalone queue page", () => {
    const staffRoute = routes.find((route) => route.path === "staff");
    const queueRoute = staffRoute?.children?.find((route) => route.path === "queue");

    expect(queueRoute).toMatchObject({ data: { permissions: "staff.app.queue.read" } });
    expect(queueRoute?.canActivate).toHaveLength(1);
    expect(queueRoute?.loadComponent).toEqual(expect.any(Function));
    expect(queueRoute?.redirectTo).toBeUndefined();
  });

  it("exposes staff offers and feedback inside the guarded staff app", () => {
    const staffRoute = routes.find((route) => route.path === "staff");
    const offersRoute = staffRoute?.children?.find((route) => route.path === "offers");
    const feedbackRoute = staffRoute?.children?.find((route) => route.path === "feedback");

    expect(offersRoute).toMatchObject({ data: { permissions: "staff.app.offers.read" } });
    expect(feedbackRoute).toMatchObject({ data: { permissions: "staff.app.feedback.read" } });
    expect(offersRoute?.canActivate).toHaveLength(1);
    expect(feedbackRoute?.canActivate).toHaveLength(1);
  });

  it("does not ship an insecure absolute production API URL", () => {
    const apiUrl = productionEnvironment.apiBaseUrl;
    const isRelative = apiUrl.startsWith("/");
    const isSecureAbsolute = /^https:\/\//i.test(apiUrl);

    expect(productionEnvironment.production).toBe(true);
    expect(isRelative || isSecureAbsolute, `${apiUrl} must be relative or use HTTPS`).toBe(true);
  });
});
