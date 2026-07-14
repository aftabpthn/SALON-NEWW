import { describe, expect, it } from "vitest";
import { StaffDashboard, StaffEnterpriseOs, StaffToday, StaffUser } from "../../core/staff-app.service";
import { buildStaffDashboardViewModel, DashboardViewModelInput, shouldShowDashboardRecommendation } from "./staff-dashboard.model";

const user: StaffUser = { id: "user-1", name: "Mira Sen", loginId: "mira", email: "mira@example.com", role: "custom-specialist", staffId: "staff-1", branchId: "branch-1", branchIds: ["branch-1"], permissions: [] };
const appointment = { id: "appt-1", clientId: "client-1", clientName: "Anita", clientPhone: "", staffId: "staff-1", branchId: "branch-1", serviceIds: ["service-1"], serviceNames: ["Hair spa"], durationMinutes: 60, value: 120000, startAt: "2026-07-14T12:00:00.000Z", endAt: "2026-07-14T13:00:00.000Z", status: "confirmed", chair: "", source: "", notes: "" };
const dashboard: StaffDashboard = {
  staff: { id: "staff-1", fullName: "Mira Sen", firstName: "Mira", lastName: "Sen", mobile: "", email: "", roleId: "custom", department: "", designation: "", status: "active" },
  summary: { appointments: 1, todayAppointments: 1, liveAppointments: 0, completedAppointments: 0, cancelledAppointments: 0, salesCount: 0, revenue: 125000, appointmentValue: 120000 },
  todayAppointments: [appointment], liveAppointments: [], workReport: [], appointments: [appointment], sales: []
};
const today: StaffToday = { date: "2026-07-14", schedules: [{ id: "shift-1", scheduleDate: "2026-07-14", startTime: "09:00", endTime: "18:00", shiftType: "regular", status: "scheduled" }], attendance: [], activeBreak: null, tasks: [{ id: "task-1", title: "Confirm consultation", description: "", status: "open", priority: "high", dueAt: "", version: 1 }] };
const enterprise: StaffEnterpriseOs = {
  home: { greeting: "", todayAppointments: 1, expectedRevenue: 125000, tasks: 1, lateClients: 0, vipClients: 0, birthdayClients: 0, pendingPayments: 0, recentNotifications: 0, targetProgress: { label: "", targetValue: 0, achievedValue: 0, percentage: 0, remaining: 0 } },
  aiCoach: [{ priority: "high", title: "Review client notes", body: "Prepare before the service.", action: "Open client profile" }, { priority: "medium", title: "Task focus", body: "Finish the follow-up.", action: "Open tasks" }, { priority: "low", title: "Practice", body: "Review your plan.", action: "Review" }, { priority: "low", title: "Extra", body: "Should not show.", action: "Review" }],
  timeline: [], serviceTimers: [], performance: { revenue: 125000, completedServices: 0, avgUtilization: 55, avgRating: 4.8, productivityScore: 72, strengths: [], opportunities: [] }, leaderboard: [], gamification: { points: 40, level: 2, stars: 1, dailyStreak: 1, monthlyStreak: 1, badges: [] }, notifications: [], tasks: [], calendar: [], reports: {}
};

function input(permissions: string[], overrides: Partial<DashboardViewModelInput> = {}): DashboardViewModelInput {
  const grants = new Set(permissions);
  return {
    user: { ...user, permissions }, dashboard, enterprise, today, overtime: null, leaveBalances: [], now: new Date("2026-07-14T11:30:00.000Z"),
    hasPermission: (permission) => grants.has(permission),
    canStartServiceStatus: (status) => ["booked", "confirmed", "arrived"].includes(status),
    canCompleteServiceStatus: (status) => status === "in-service",
    ...overrides
  };
}

describe("staff dashboard permission-first view model", () => {
  it("keeps attendance in the hero without duplicating first-viewport actions", () => {
    const allowed = buildStaffDashboardViewModel(input(["read:appointments", "read:staff", "read:clients", "allow:staff-checkin-checkout"]));
    const restricted = buildStaffDashboardViewModel(input(["read:appointments"]));
    expect(allowed.hero).toMatchObject({ title: "Ready to start your shift? 👋", detail: "Not clocked in", shiftAssigned: true, shift: "09:00–18:00" });
    expect(allowed.quickActions.some((action) => action.id === "attendance")).toBe(false);
    expect(allowed.quickActions).toHaveLength(4);
    expect(allowed.quickActions.some((action) => allowed.hero.actions.some((hero) => hero.primary && (hero.id === action.id || hero.route === action.route)))).toBe(false);
    expect(restricted.quickActions.some((action) => action.id === "attendance")).toBe(false);
    expect(allowed.hero.actions).toMatchObject([{ id: "attendance", primary: true }, { id: "schedule", label: "Today’s schedule" }]);
  });

  it("exposes a helpful no-shift state without an empty shift label", () => {
    const vm = buildStaffDashboardViewModel(input(["read:appointments", "allow:staff-checkin-checkout"], { today: { ...today, schedules: [] } }));
    expect(vm.hero).toMatchObject({ shiftAssigned: false, shift: "" });
  });

  it("deduplicates the hero recommendation and lets a partial warning take precedence", () => {
    const vm = buildStaffDashboardViewModel(input(["read:appointments", "allow:staff-checkin-checkout"]));
    const primary = vm.hero.actions[0];
    const identity = [primary.id, primary.appointmentId || "", primary.route || "", vm.hero.title].join(":");
    const recommendation = { identity, text: vm.hero.title, hero: vm.hero, hintsEnabled: true, dismissedIdentity: "", hasPartialWarning: false };
    expect(shouldShowDashboardRecommendation(recommendation)).toBe(false);
    expect(shouldShowDashboardRecommendation({ ...recommendation, identity: "distinct", text: "Review preparation", hasPartialWarning: true })).toBe(false);
  });

  it("prioritizes and acts on an active service after attendance", () => {
    const active = { ...appointment, status: "in-service" };
    const activeDashboard = { ...dashboard, liveAppointments: [active], todayAppointments: [active], summary: { ...dashboard.summary, liveAppointments: 1 } };
    const attended = { ...today, attendance: [{ id: "attendance-1", businessDate: today.date, clockInAt: "2026-07-14T03:30:00.000Z", clockOutAt: "", status: "clocked_in", source: "staff-app", overtimeMinutes: 0, grossMinutes: 0, totalBreakMinutes: 0, totalWorkedMinutes: 0, scheduledShiftMinutes: 540, overtimeCalculationStatus: "pending", overtimeReviewReason: "", overtimePolicyVersion: "1" }] };
    const vm = buildStaffDashboardViewModel(input(["read:appointments", "update:appointments", "allow:staff-checkin-checkout"], { dashboard: activeDashboard, today: attended }));
    expect(vm.work.mode).toBe("active");
    expect(vm.hero.title).toContain("Anita");
    expect(vm.work.action?.kind).toBe("complete-service");
  });

  it("puts permitted critical floor alerts ahead of attendance and service work", () => {
    const lateEnterprise = { ...enterprise, home: { ...enterprise.home, lateClients: 1, pendingPayments: 2 } };
    const vm = buildStaffDashboardViewModel(input(["read:appointments", "read:finance", "allow:staff-checkin-checkout"], { enterprise: lateEnterprise }));
    expect(vm.hero.title).toBe("The floor needs attention");
    expect(vm.hero.actions[0]).toMatchObject({ route: "/staff/appointments", primary: true });
    expect(vm.alerts.map((alert) => alert.id)).toEqual(["late", "payments"]);
    expect(vm.hero.actions.filter((action) => action.primary)).toHaveLength(1);
  });

  it("uses real break and completed-attendance state instead of offering another clock-in", () => {
    const openAttendance = { id: "attendance-1", businessDate: today.date, clockInAt: "2026-07-14T03:30:00.000Z", clockOutAt: "", status: "clocked_in", source: "staff-app", overtimeMinutes: 0, grossMinutes: 0, totalBreakMinutes: 0, totalWorkedMinutes: 0, scheduledShiftMinutes: 540, overtimeCalculationStatus: "pending", overtimeReviewReason: "", overtimePolicyVersion: "1" };
    const noAppointments = { ...dashboard, todayAppointments: [], liveAppointments: [], summary: { ...dashboard.summary, todayAppointments: 0 } };
    const onBreak = buildStaffDashboardViewModel(input(["read:appointments", "allow:staff-checkin-checkout"], { dashboard: noAppointments, today: { ...today, attendance: [openAttendance], activeBreak: { id: "break-1", status: "active" }, tasks: [] } }));
    const completed = buildStaffDashboardViewModel(input(["read:appointments", "allow:staff-checkin-checkout"], { dashboard: noAppointments, today: { ...today, schedules: [{ ...today.schedules[0], status: "completed" }], attendance: [{ ...openAttendance, clockOutAt: "2026-07-14T12:30:00.000Z", status: "clocked_out" }], tasks: [] } }));
    expect(onBreak.hero.actions[0]).toMatchObject({ kind: "end-break", label: "End break" });
    expect(completed.hero.title).toBe("Your shift is complete");
    expect(completed.hero.actions.some((action) => action.kind === "clock")).toBe(false);
  });

  it("prioritizes an urgent open task ahead of a distant appointment", () => {
    const distant = { ...appointment, startAt: "2026-07-14T15:00:00.000Z", endAt: "2026-07-14T16:00:00.000Z" };
    const attended = { ...today, attendance: [{ id: "attendance-1", businessDate: today.date, clockInAt: "2026-07-14T03:30:00.000Z", clockOutAt: "", status: "clocked_in", source: "staff-app", overtimeMinutes: 0, grossMinutes: 0, totalBreakMinutes: 0, totalWorkedMinutes: 0, scheduledShiftMinutes: 540, overtimeCalculationStatus: "pending", overtimeReviewReason: "", overtimePolicyVersion: "1" }] };
    const vm = buildStaffDashboardViewModel(input(["read:appointments", "read:staff"], { dashboard: { ...dashboard, todayAppointments: [distant], appointments: [distant] }, today: attended }));
    expect(vm.hero).toMatchObject({ title: "1 task to move forward", detail: "Confirm consultation", actions: [{ id: "tasks", route: "/staff/tasks", primary: true }] });
  });

  it("shows a dedicated next-client state and appointment navigation", () => {
    const vm = buildStaffDashboardViewModel(input(["read:appointments", "read:clients"]));
    expect(vm.work).toMatchObject({ mode: "next", title: "Anita", clientRoute: ["/staff/client-360", "client-1"] });
  });

  it("never grants financial visibility from a role name and caps performance at three", () => {
    const restricted = buildStaffDashboardViewModel(input(["read:appointments", "read:staff"]));
    const financial = buildStaffDashboardViewModel(input(["read:appointments", "read:staff", "read:finance"]));
    expect(restricted.performance.some((metric) => metric.label === "Revenue")).toBe(false);
    expect(restricted.alerts.some((alert) => alert.id === "payments")).toBe(false);
    expect(financial.performance.some((metric) => metric.label === "Revenue")).toBe(true);
    expect(financial.performance).toHaveLength(3);
    expect(financial.performance.find((metric) => metric.label === "Revenue")?.value.replace(/\s/g, "")).toBe("₹1,250");
    expect(financial.availableTools.some((tool) => tool.id === "payroll")).toBe(true);
  });

  it("supports a custom restricted role using permissions rather than role defaults", () => {
    const vm = buildStaffDashboardViewModel(input(["read:clients"]));
    expect(vm.quickActions.map((action) => action.id)).toEqual(["clients"]);
    expect(vm.availableTools.map((tool) => tool.id)).toEqual(["clients", "settings"]);
  });

  it("orders authorized content by role profile without granting missing permissions", () => {
    const receptionist = buildStaffDashboardViewModel(input(["read:appointments", "read:staff", "read:clients", "allow:staff-checkin-checkout"], { user: { ...user, role: "receptionist" } }));
    const inventory = buildStaffDashboardViewModel(input(["read:appointments", "read:staff", "allow:staff-checkin-checkout"], { user: { ...user, role: "inventory-manager" } }));
    expect(receptionist.quickActions.map((action) => action.id)).toEqual(["appointments", "queue", "tasks", "clients"]);
    expect(receptionist.availableTools[0].id).toBe("clients");
    expect(inventory.quickActions.map((action) => action.id)).toEqual(["queue", "appointments", "tasks", "calendar"]);
    expect(inventory.quickActions.some((action) => action.id === "clients")).toBe(false);
    expect(inventory.availableTools.some((tool) => tool.id === "clients")).toBe(false);
  });

  it("adds compact live metadata with meaningful zero language to quick actions", () => {
    const vm = buildStaffDashboardViewModel(input(["read:appointments", "read:staff", "read:clients", "allow:staff-checkin-checkout"]));
    expect(vm.quickActions.find((action) => action.id === "appointments")?.status).toBe("1 today");
    expect(vm.quickActions.find((action) => action.id === "queue")?.status).toBe("No live services");
    expect(vm.quickActions.find((action) => action.id === "tasks")?.status).toBe("1 pending");
    expect(vm.quickActions.find((action) => action.id === "clients")?.status).toBe("Search profiles");
  });

  it("keeps at most three actionable coach cards and filters generic positive statuses", () => {
    const filteredEnterprise = { ...enterprise, aiCoach: [...enterprise.aiCoach, { priority: "low", title: "No risk flags", body: "Everything is all clear.", action: "Keep going" }] };
    const vm = buildStaffDashboardViewModel(input(["read:appointments", "read:staff", "read:clients"], { enterprise: filteredEnterprise }));
    expect(vm.coach).toHaveLength(2);
    expect(vm.coach[0].route).toBe("/staff/clients");
    expect(vm.coach[1].route).toBe("/staff/tasks");
    expect(vm.coach.some((card) => /no risk flags/i.test(card.title))).toBe(false);
  });

  it("builds four backed overview metrics or a complete three-metric fallback", () => {
    const complete = buildStaffDashboardViewModel(input(["read:appointments", "read:staff"]));
    const fallback = buildStaffDashboardViewModel(input(["read:appointments", "read:staff"], { enterprise: null }));
    expect(complete.overview.map((metric) => metric.label)).toEqual(["Appointments", "Completed", "Open tasks", "Alerts"]);
    expect(fallback.overview).toHaveLength(3);
    expect(fallback.overview.every((metric) => metric.hint.length > 0)).toBe(true);
  });

  it("types and bounds performance progress using connected score data", () => {
    const outOfRange = { ...enterprise, performance: { ...enterprise.performance, productivityScore: 120, avgUtilization: -5 } };
    const vm = buildStaffDashboardViewModel(input(["read:appointments", "read:staff"], { enterprise: outOfRange }));
    expect(vm.performance.find((metric) => metric.label === "Productivity")).toMatchObject({ progress: 100, progressLabel: "Productivity 120 out of 100" });
    expect(vm.performance.find((metric) => metric.label === "Utilization")?.progress).toBe(0);
    expect(vm.performance).toHaveLength(3);
  });

  it("honors authorized tool customization after permission filtering", () => {
    const vm = buildStaffDashboardViewModel(input(["read:appointments", "read:staff", "read:clients"], { hiddenToolIds: new Set(["chat", "clients"]), toolOrder: ["learning", "calendar"] }));
    expect(vm.tools.some((tool) => tool.id === "chat" || tool.id === "clients")).toBe(false);
    expect(vm.tools[0].id).toBe("learning");
    expect(vm.tools.length).toBeLessThanOrEqual(6);
  });

  it("uses the next-work empty state without a redundant global empty state", () => {
    const emptyDashboard = { ...dashboard, summary: { ...dashboard.summary, appointments: 0, todayAppointments: 0, revenue: 0, appointmentValue: 0 }, todayAppointments: [], appointments: [] };
    const emptyToday = { ...today, tasks: [] };
    const vm = buildStaffDashboardViewModel(input(["read:appointments"], { dashboard: emptyDashboard, enterprise: null, today: emptyToday }));
    expect(vm).not.toHaveProperty("empty");
    expect(vm.work.mode).toBe("empty");
    expect(vm.overview[0]).toMatchObject({ value: "0", hint: "No bookings assigned" });
  });
});
