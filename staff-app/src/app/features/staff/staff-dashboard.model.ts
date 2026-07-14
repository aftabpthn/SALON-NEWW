import { StaffAppointment, StaffDashboard, StaffEnterpriseOs, StaffLeaveBalance, StaffOvertimeSummary, StaffToday, StaffUser } from "../../core/staff-app.service";
import { formatPaiseInr } from "../../core/paise-inr.pipe";

export type DashboardActionKind = "clock" | "start-service" | "complete-service";
export type DashboardAction = {
  id: string;
  label: string;
  route?: string | readonly string[];
  kind?: DashboardActionKind;
  appointmentId?: string;
  primary?: boolean;
};
export type DashboardMetric = { label: string; value: string; hint: string; route?: string };
export type DashboardAlert = { id: string; title: string; detail: string; route: string; tone: "critical" | "attention" };
export type DashboardCoachCard = { title: string; body: string; action: string; route: string };
export type DashboardTool = { id: string; label: string; hint: string; route: string };
export type DashboardWork = {
  mode: "active" | "next" | "empty";
  eyebrow: string;
  title: string;
  detail: string;
  meta: string;
  progress?: number;
  clientRoute?: readonly string[];
  queueRoute?: string;
  scheduleRoute?: string;
  action?: DashboardAction;
};

export type StaffDashboardViewModel = {
  hero: { eyebrow: string; title: string; detail: string; shift: string; actions: DashboardAction[] };
  quickActions: DashboardAction[];
  overview: DashboardMetric[];
  work: DashboardWork;
  alerts: DashboardAlert[];
  coach: DashboardCoachCard[];
  performance: DashboardMetric[];
  tools: DashboardTool[];
  availableTools: DashboardTool[];
};

export type DashboardRecommendationState = {
  identity: string;
  text: string;
  hero: StaffDashboardViewModel["hero"];
  hintsEnabled: boolean;
  dismissedIdentity: string;
  hasPartialWarning: boolean;
};

export type DashboardViewModelInput = {
  user: StaffUser | null;
  dashboard: StaffDashboard;
  enterprise: StaffEnterpriseOs | null;
  today: StaffToday | null;
  overtime: StaffOvertimeSummary | null;
  leaveBalances: StaffLeaveBalance[];
  hiddenToolIds?: ReadonlySet<string>;
  toolOrder?: readonly string[];
  now?: Date;
  hasPermission: (permission: string) => boolean;
  canStartServiceStatus: (status: string) => boolean;
  canCompleteServiceStatus: (status: string) => boolean;
};

type ActionContext = DashboardViewModelInput & {
  activeAppointment: StaffAppointment | null;
  nextAppointment: StaffAppointment | null;
  openTaskCount: number;
  openAttendance: StaffToday["attendance"][number] | null;
};

type RegistryItem<T> = {
  item: T;
  permissions?: readonly string[];
  anyPermission?: readonly string[];
  when?: (context: ActionContext) => boolean;
};

const FINANCIAL_PERMISSIONS = ["read:finance", "read:sales", "read:payments", "read:invoices"] as const;
const ATTENDANCE_PERMISSIONS = ["allow:staff-checkin-checkout", "write:staff"] as const;

const QUICK_ACTIONS: readonly RegistryItem<DashboardAction>[] = [
  { item: { id: "attendance", label: "Attendance", kind: "clock" }, anyPermission: ATTENDANCE_PERMISSIONS },
  { item: { id: "appointments", label: "Appointments", route: "/staff/appointments" }, permissions: ["read:appointments"] },
  { item: { id: "queue", label: "Queue", route: "/staff/queue" }, permissions: ["read:appointments"] },
  { item: { id: "tasks", label: "Tasks", route: "/staff/tasks" }, permissions: ["read:staff"] },
  { item: { id: "clients", label: "Clients", route: "/staff/clients" }, permissions: ["read:clients"] },
  { item: { id: "calendar", label: "Calendar", route: "/staff/calendar" }, permissions: ["read:staff"] }
];

const TOOLS: readonly RegistryItem<DashboardTool>[] = [
  { item: { id: "calendar", label: "Shift calendar", hint: "Roster and schedule", route: "/staff/calendar" }, permissions: ["read:staff"] },
  { item: { id: "clients", label: "Clients", hint: "Profiles, notes and history", route: "/staff/clients" }, permissions: ["read:clients"] },
  { item: { id: "leave", label: "Leave", hint: "Requests and balances", route: "/staff/leaves" }, permissions: ["read:staff"] },
  { item: { id: "learning", label: "Learning", hint: "Modules and progress", route: "/staff/learning" }, permissions: ["read:staff"] },
  { item: { id: "chat", label: "Team chat", hint: "Staff conversations", route: "/staff/chat" }, permissions: ["read:staff"] },
  { item: { id: "reports", label: "Reports", hint: "Work summaries", route: "/staff/reports" }, permissions: ["read:staff"] },
  { item: { id: "payroll", label: "Payroll", hint: "Pay statements", route: "/staff/payroll" }, anyPermission: ["read:payroll", "read:finance"] },
  { item: { id: "settings", label: "Settings", hint: "Workspace preferences", route: "/staff/settings" } }
];

const ROLE_TOOL_ORDER: Record<string, readonly string[]> = {
  frontdesk: ["clients", "calendar", "chat", "leave", "learning", "reports"],
  receptionist: ["clients", "calendar", "chat", "leave", "learning", "reports"],
  manager: ["reports", "calendar", "clients", "chat", "payroll", "leave"],
  staff: ["calendar", "clients", "leave", "learning", "chat", "reports"]
};

function allowed<T>(entry: RegistryItem<T>, input: DashboardViewModelInput | ActionContext): boolean {
  if (entry.permissions?.some((permission) => !input.hasPermission(permission))) return false;
  if (entry.anyPermission?.length && !entry.anyPermission.some(input.hasPermission)) return false;
  return !entry.when || entry.when(input as ActionContext);
}

function isActiveStatus(status: string): boolean {
  return ["in-service", "in service", "inprogress", "in progress", "running", "active", "started"].includes(String(status || "").trim().toLowerCase());
}

function isOpenAttendance(item: StaffToday["attendance"][number]): boolean {
  return !item.clockOutAt && !/out|closed|complete/i.test(String(item.status || ""));
}

function timeLabel(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value || "Time unavailable" : date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function durationLabel(minutes: number): string {
  const safe = Math.max(0, Number(minutes || 0));
  return `${Math.floor(safe / 60)}h ${safe % 60}m`;
}

function openTasks(input: DashboardViewModelInput): StaffToday["tasks"] {
  return (input.today?.tasks || []).filter((task) => String(task.status || "open").toLowerCase() !== "completed");
}

function nextAppointment(input: DashboardViewModelInput): StaffAppointment | null {
  const now = (input.now || new Date()).getTime();
  return [...input.dashboard.todayAppointments]
    .filter((item) => !isActiveStatus(item.status) && new Date(item.endAt || item.startAt).getTime() >= now)
    .sort((left, right) => new Date(left.startAt).getTime() - new Date(right.startAt).getTime())[0] || null;
}

function context(input: DashboardViewModelInput): ActionContext {
  const activeAppointment = input.dashboard.liveAppointments.find((item) => isActiveStatus(item.status))
    || input.dashboard.todayAppointments.find((item) => isActiveStatus(item.status)) || null;
  return {
    ...input,
    activeAppointment,
    nextAppointment: nextAppointment(input),
    openTaskCount: openTasks(input).length,
    openAttendance: input.today?.attendance.find(isOpenAttendance) || null
  };
}

function serviceAction(input: ActionContext, appointment: StaffAppointment): DashboardAction | undefined {
  if (!input.hasPermission("update:appointments") && !input.hasPermission("write:appointments")) return undefined;
  if (input.canCompleteServiceStatus(appointment.status)) return { id: "complete-service", label: "Complete service", kind: "complete-service", appointmentId: appointment.id, primary: true };
  if (input.canStartServiceStatus(appointment.status)) {
    return { id: "start-service", label: "Start service", kind: "start-service", appointmentId: appointment.id, primary: true };
  }
  return undefined;
}

function alerts(input: ActionContext): DashboardAlert[] {
  const home = input.enterprise?.home;
  if (!home) return [];
  const result: DashboardAlert[] = [];
  if (home.lateClients > 0 && input.hasPermission("read:appointments")) result.push({ id: "late", title: `${home.lateClients} late client${home.lateClients === 1 ? "" : "s"}`, detail: "Review arrivals and follow up now.", route: "/staff/appointments", tone: "critical" });
  if (home.pendingPayments > 0 && FINANCIAL_PERMISSIONS.some(input.hasPermission)) result.push({ id: "payments", title: `${home.pendingPayments} pending payment${home.pendingPayments === 1 ? "" : "s"}`, detail: "Checkout needs attention.", route: "/staff/business", tone: "critical" });
  if (home.birthdayClients > 0 && input.hasPermission("read:clients")) result.push({ id: "birthdays", title: `${home.birthdayClients} client birthday${home.birthdayClients === 1 ? "" : "s"}`, detail: "Open the client list before their visit.", route: "/staff/clients", tone: "attention" });
  const unread = (input.enterprise?.notifications || []).filter((note) => String(note.status || "unread") !== "read").length;
  if (unread > 0 && input.hasPermission("read:staff")) result.push({ id: "unread", title: `${unread} unread notification${unread === 1 ? "" : "s"}`, detail: "Review the latest operational updates.", route: "/staff/notifications", tone: "attention" });
  return result.slice(0, 4);
}

function work(input: ActionContext): DashboardWork {
  const active = input.activeAppointment;
  if (active) {
    const timer = input.enterprise?.serviceTimers.find((item) => item.appointmentId === active.id);
    return {
      mode: "active", eyebrow: "Current service", title: active.clientName || "Walk-in client",
      detail: active.serviceNames.join(", ") || "Service", meta: timer ? `${durationLabel(timer.remainingMinutes)} remaining` : `Started ${timeLabel(active.startAt)}`,
      progress: timer?.progress, clientRoute: active.clientId && input.hasPermission("read:clients") ? ["/staff/client-360", active.clientId] : undefined,
      queueRoute: input.hasPermission("read:appointments") ? "/staff/queue" : undefined,
      action: serviceAction(input, active)
    };
  }
  const next = input.nextAppointment;
  if (next) return {
    mode: "next", eyebrow: "Next client", title: next.clientName || "Walk-in client",
    detail: next.serviceNames.join(", ") || "Service", meta: `${timeLabel(next.startAt)} · ${next.durationMinutes || 0} min`,
    clientRoute: next.clientId && input.hasPermission("read:clients") ? ["/staff/client-360", next.clientId] : undefined,
    queueRoute: input.hasPermission("read:appointments") ? "/staff/queue" : undefined,
    action: serviceAction(input, next)
  };
  return {
    mode: "empty", eyebrow: "Next client", title: "No client waiting", detail: "Your assigned appointments will appear here.", meta: "Schedule clear",
    queueRoute: input.hasPermission("read:appointments") ? "/staff/queue" : undefined,
    scheduleRoute: input.hasPermission("read:appointments") ? "/staff/appointments" : undefined
  };
}

function hero(input: ActionContext, activeAlerts: DashboardAlert[]): StaffDashboardViewModel["hero"] {
  const shift = input.today?.schedules[0];
  const shiftText = shift ? `${shift.startTime || "--"}–${shift.endTime || "--"} · ${shift.status || "scheduled"}` : "No shift assigned";
  let title = "Your day is ready";
  let detail = `${input.dashboard.summary.todayAppointments} appointment${input.dashboard.summary.todayAppointments === 1 ? "" : "s"} assigned today.`;
  const actions: DashboardAction[] = [];
  if (activeAlerts.some((item) => item.tone === "critical")) {
    title = "The floor needs attention"; detail = activeAlerts[0].detail; actions.push({ id: "urgent", label: "Review urgent items", route: activeAlerts[0].route, primary: true });
  } else if (!input.openAttendance && ATTENDANCE_PERMISSIONS.some(input.hasPermission)) {
    title = "Clock in to start your shift"; detail = ""; actions.push({ id: "attendance", label: "Clock in", kind: "clock", primary: true });
  } else if (input.activeAppointment) {
    title = `Continue with ${input.activeAppointment.clientName || "your client"}`; detail = input.activeAppointment.serviceNames.join(", ") || "Service in progress";
    const action = serviceAction(input, input.activeAppointment); if (action) actions.push(action);
  } else if (input.nextAppointment) {
    const minutes = Math.round((new Date(input.nextAppointment.startAt).getTime() - (input.now || new Date()).getTime()) / 60000);
    title = minutes >= 0 && minutes <= 60 ? `${input.nextAppointment.clientName || "Your next client"} is coming up` : "Prepare for your next client";
    detail = `${timeLabel(input.nextAppointment.startAt)} · ${input.nextAppointment.serviceNames.join(", ") || "Service"}`;
    actions.push({ id: "next", label: "View appointment", route: "/staff/appointments", primary: true });
  } else if (input.openTaskCount > 0 && input.hasPermission("read:staff")) {
    title = `${input.openTaskCount} task${input.openTaskCount === 1 ? "" : "s"} to move forward`; detail = openTasks(input)[0]?.title || "Review assigned tasks.";
    actions.push({ id: "tasks", label: "Open tasks", route: "/staff/tasks", primary: true });
  }
  if (input.hasPermission("read:appointments") && !actions.some((item) => item.route === "/staff/appointments")) actions.push({ id: "appointments", label: "View schedule", route: "/staff/appointments" });
  return { eyebrow: input.openAttendance ? "Clocked in" : "Today", title, detail, shift: shiftText, actions: actions.slice(0, 2) };
}

function roleOrder(input: DashboardViewModelInput): readonly string[] {
  const role = String(input.user?.role || "").replace(/[\s_-]/g, "").toLowerCase();
  return ROLE_TOOL_ORDER[role] || [];
}

function orderedTools(input: DashboardViewModelInput): DashboardTool[] {
  const permitted = TOOLS.filter((entry) => allowed(entry, input)).map((entry) => entry.item);
  const preferred = [...(input.toolOrder || []), ...roleOrder(input)];
  return [...permitted].sort((left, right) => {
    const leftIndex = preferred.indexOf(left.id); const rightIndex = preferred.indexOf(right.id);
    return (leftIndex < 0 ? 999 : leftIndex) - (rightIndex < 0 ? 999 : rightIndex);
  });
}

function sameAction(left: DashboardAction, right: DashboardAction): boolean {
  if (left.id === right.id) return true;
  if (!left.route || !right.route) return false;
  const routeKey = (route: string | readonly string[]) => Array.isArray(route) ? route.join("/") : route;
  return routeKey(left.route) === routeKey(right.route);
}

function normalizedRecommendationValue(value: string): string {
  return String(value || "").trim().replace(/\s+/g, " ").toLowerCase();
}

export function shouldShowDashboardRecommendation(state: DashboardRecommendationState): boolean {
  if (!state.identity || !state.hintsEnabled || state.dismissedIdentity === state.identity || state.hasPartialWarning) return false;
  const primary = state.hero.actions.find((action) => action.primary) || state.hero.actions[0];
  if (!primary) return true;
  const actionIdentity = [primary.id, primary.appointmentId || "", primary.route || "", state.hero.title || ""].join(":");
  const recommendationText = normalizedRecommendationValue(state.text);
  return state.identity !== actionIdentity
    && recommendationText !== normalizedRecommendationValue(state.hero.title)
    && recommendationText !== normalizedRecommendationValue(primary.label);
}

function actionableCoachCard(card: StaffEnterpriseOs["aiCoach"][number]): boolean {
  const text = `${card.title} ${card.body} ${card.action}`.trim();
  if (!text || /no risk flags?|no risks?|all (?:clear|good)|keep it up|great job|stay motivated|you(?:'|’)re doing (?:great|well)/i.test(text)) return false;
  return !!String(card.action || "").trim() && !/^(review|view|learn more|keep going)$/i.test(String(card.action).trim());
}

export function buildStaffDashboardViewModel(input: DashboardViewModelInput): StaffDashboardViewModel {
  const ctx = context(input);
  const activeAlerts = alerts(ctx);
  const availableTools = orderedTools(input);
  const visibleTools = availableTools.filter((item) => !input.hiddenToolIds?.has(item.id)).slice(0, 6).map((item) => {
    if (item.id === "leave") return { ...item, hint: `${input.leaveBalances.reduce((sum, balance) => sum + Number(balance.balance || 0), 0)} days available` };
    if (item.id === "learning" && input.enterprise) return { ...item, hint: `Level ${input.enterprise.gamification.level || 0} · ${input.enterprise.gamification.points || 0} points` };
    if (item.id === "reports") return { ...item, hint: `${input.dashboard.summary.completedAppointments} completed today` };
    if (item.id === "calendar" && input.overtime) return { ...item, hint: `${durationLabel(input.overtime.weekMinutes)} overtime this week` };
    return item;
  });
  const heroModel = hero(ctx, activeAlerts);
  const quick = QUICK_ACTIONS
    .filter((entry) => allowed(entry, ctx))
    .map((entry) => ({ ...entry.item, label: entry.item.id === "attendance" ? (ctx.openAttendance ? "Clock out" : "Clock in") : entry.item.label }))
    .filter((action) => !heroModel.actions.some((heroAction) => sameAction(action, heroAction)));
  const overview: DashboardMetric[] = [
    { label: "Appointments", value: String(input.dashboard.summary.todayAppointments), hint: input.dashboard.summary.todayAppointments ? "Assigned today" : "No bookings assigned", route: "/staff/appointments" }
  ];
  if (input.hasPermission("read:staff")) overview.push(
    { label: "Completed", value: String(input.dashboard.summary.completedAppointments), hint: input.dashboard.summary.completedAppointments ? "Services finished" : "Nothing completed yet", route: "/staff/reports" },
    { label: "Open tasks", value: String(ctx.openTaskCount), hint: ctx.openTaskCount ? "Needs follow-up" : "All clear", route: "/staff/tasks" }
  );
  if (input.enterprise && input.hasPermission("read:staff")) {
    const unread = input.enterprise.notifications.filter((note) => String(note.status || "unread") !== "read").length;
    overview.push({ label: "Alerts", value: String(activeAlerts.length), hint: activeAlerts.length ? `${unread || activeAlerts.length} to review` : "No new alerts", route: "/staff/notifications" });
  } else if (input.overtime) overview.push({ label: "Overtime", value: durationLabel(input.overtime.todayMinutes), hint: input.overtime.todayMinutes ? "Recorded today" : "None recorded", route: "/staff/attendance" });
  const performance: DashboardMetric[] = [];
  if (input.hasPermission("read:staff") && input.enterprise) {
    performance.push(
      { label: "Productivity", value: `${input.enterprise.performance.productivityScore}/100`, hint: "Current score" },
      { label: "Services", value: String(input.enterprise.performance.completedServices || input.dashboard.summary.completedAppointments), hint: "Completed" },
      { label: "Utilization", value: `${input.enterprise.performance.avgUtilization || 0}%`, hint: "Average utilization" }
    );
  }
  if (FINANCIAL_PERMISSIONS.some(input.hasPermission)) {
    const value = [input.enterprise?.home.expectedRevenue, input.dashboard.summary.revenue]
      .find((candidate): candidate is number => typeof candidate === "number" && Number.isSafeInteger(candidate) && candidate > 0);
    if (value !== undefined) {
      const revenue = { label: "Revenue", value: formatPaiseInr(value), hint: "Connected sales and bookings", route: "/staff/business" };
      if (performance.length >= 3) performance.splice(2, 1, revenue); else performance.push(revenue);
    }
  }
  const coach = input.hasPermission("read:staff") ? (input.enterprise?.aiCoach || []).filter(actionableCoachCard).slice(0, 3).map((card) => ({
    title: card.title, body: card.body, action: card.action, route: /client/i.test(`${card.title} ${card.action}`) && input.hasPermission("read:clients") ? "/staff/clients" : /task/i.test(`${card.title} ${card.action}`) ? "/staff/tasks" : "/staff/ai-coach"
  })) : [];
  return { hero: heroModel, quickActions: quick.slice(0, 4), overview: overview.slice(0, 4), work: work(ctx), alerts: activeAlerts, coach, performance: performance.slice(0, 3), tools: visibleTools, availableTools };
}
