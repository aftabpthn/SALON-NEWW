import { StaffAppointment, StaffDashboard, StaffEnterpriseOs, StaffLeaveBalance, StaffOvertimeSummary, StaffToday, StaffUser } from "../../core/staff-app.service";
import { formatPaiseInr } from "../../core/paise-inr.pipe";

export type DashboardActionKind = "clock" | "end-break" | "start-service" | "complete-service";
export type DashboardAction = {
  id: string;
  label: string;
  route?: string | readonly string[];
  kind?: DashboardActionKind;
  appointmentId?: string;
  primary?: boolean;
  status?: string;
};
export type DashboardMetric = { label: string; value: string; hint: string; route?: string; progress?: number; progressLabel?: string };
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
  hero: { eyebrow: string; title: string; detail: string; shift: string; shiftAssigned: boolean; actions: DashboardAction[] };
  quickActions: DashboardAction[];
  overview: DashboardMetric[];
  work: DashboardWork;
  alerts: DashboardAlert[];
  coachIntro: string;
  coach: DashboardCoachCard[];
  performanceIntro: string;
  performanceRoute?: string;
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
  priorityTask: StaffToday["tasks"][number] | null;
  openAttendance: StaffToday["attendance"][number] | null;
  shiftCompleted: boolean;
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
  { item: { id: "queue", label: "Today’s queue", route: "/staff/queue" }, permissions: ["read:appointments"] },
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

type DashboardRoleProfile = {
  aliases: readonly string[];
  quick: readonly string[];
  overview: readonly string[];
  performance: readonly string[];
  tools: readonly string[];
};

const ROLE_PROFILES: readonly DashboardRoleProfile[] = [
  { aliases: ["frontdesk", "receptionist"], quick: ["appointments", "queue", "tasks", "clients", "attendance"], overview: ["Alerts", "Appointments", "Open tasks", "Completed"], performance: ["Services", "Utilization", "Productivity", "Revenue"], tools: ["clients", "calendar", "chat", "reports", "leave", "learning", "payroll"] },
  { aliases: ["stylist", "seniorstylist", "therapist", "staff", "staffappuser"], quick: ["attendance", "appointments", "queue", "tasks", "clients"], overview: ["Appointments", "Completed", "Open tasks", "Alerts"], performance: ["Productivity", "Services", "Utilization", "Rating", "Revenue"], tools: ["calendar", "clients", "leave", "learning", "chat", "reports", "payroll"] },
  { aliases: ["manager", "salonmanager", "staffappmanager"], quick: ["tasks", "appointments", "queue", "clients", "attendance"], overview: ["Alerts", "Open tasks", "Appointments", "Completed"], performance: ["Productivity", "Utilization", "Services", "Revenue", "Rating"], tools: ["reports", "calendar", "clients", "chat", "payroll", "leave", "learning"] },
  { aliases: ["owner", "admin", "staffappadmin"], quick: ["appointments", "tasks", "queue", "clients", "attendance"], overview: ["Alerts", "Appointments", "Completed", "Open tasks"], performance: ["Revenue", "Productivity", "Utilization", "Services", "Rating"], tools: ["reports", "payroll", "calendar", "clients", "chat", "leave", "learning"] },
  { aliases: ["cashier", "inventory", "inventorymanager", "cashierinventory"], quick: ["queue", "appointments", "tasks", "clients", "attendance"], overview: ["Alerts", "Appointments", "Completed", "Open tasks"], performance: ["Revenue", "Services", "Utilization", "Productivity", "Rating"], tools: ["reports", "payroll", "clients", "calendar", "chat", "leave", "learning"] }
];

const DEFAULT_ROLE_PROFILE: DashboardRoleProfile = {
  aliases: [], quick: [], overview: [], performance: [], tools: []
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

function taskPriority(task: StaffToday["tasks"][number], now: Date): number {
  const priority = String(task.priority || "").toLowerCase();
  const dueAt = new Date(task.dueAt || "").getTime();
  if (["urgent", "critical"].includes(priority) || (Number.isFinite(dueAt) && dueAt < now.getTime())) return 0;
  if (priority === "high") return 1;
  return 2;
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
  const tasks = openTasks(input);
  const attendance = input.today?.attendance || [];
  return {
    ...input,
    activeAppointment,
    nextAppointment: nextAppointment(input),
    openTaskCount: tasks.length,
    priorityTask: [...tasks].sort((left, right) => taskPriority(left, input.now || new Date()) - taskPriority(right, input.now || new Date()))[0] || null,
    openAttendance: attendance.find(isOpenAttendance) || null,
    shiftCompleted: (input.today?.schedules || []).some((schedule) => /completed|closed|finished|ended/i.test(String(schedule.status || "")))
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
      detail: `${active.serviceNames.join(", ") || "Service"} · ${statusLabel(active.status)}`, meta: timer ? `${durationLabel(timer.remainingMinutes)} remaining` : `Started ${timeLabel(active.startAt)}`,
      progress: timer?.progress, clientRoute: active.clientId && input.hasPermission("read:clients") ? ["/staff/client-360", active.clientId] : undefined,
      queueRoute: input.hasPermission("read:appointments") ? "/staff/queue" : undefined,
      action: serviceAction(input, active)
    };
  }
  const next = input.nextAppointment;
  if (next) return {
    mode: "next", eyebrow: "Next client", title: next.clientName || "Walk-in client",
    detail: `${next.serviceNames.join(", ") || "Service"} · ${next.durationMinutes || 0} min`, meta: `${timeLabel(next.startAt)} · ${statusLabel(next.status)}`,
    clientRoute: next.clientId && input.hasPermission("read:clients") ? ["/staff/client-360", next.clientId] : undefined,
    queueRoute: input.hasPermission("read:appointments") ? "/staff/queue" : undefined,
    action: serviceAction(input, next)
  };
  return {
    mode: "empty", eyebrow: "Next client", title: "No client waiting", detail: "Assigned bookings—including walk-ins—will appear here.", meta: "Schedule clear",
    queueRoute: input.hasPermission("read:appointments") ? "/staff/queue" : undefined,
    scheduleRoute: input.hasPermission("read:appointments") ? "/staff/appointments" : undefined
  };
}

function statusLabel(value: string): string {
  const text = String(value || "scheduled").trim().replace(/[_-]+/g, " ");
  return text.replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function hero(input: ActionContext, activeAlerts: DashboardAlert[]): StaffDashboardViewModel["hero"] {
  const shift = input.today?.schedules[0];
  const shiftText = shift ? `${shift.startTime || "--"}–${shift.endTime || "--"}` : "";
  let title = "Your day is ready";
  let detail = `${input.dashboard.summary.todayAppointments} appointment${input.dashboard.summary.todayAppointments === 1 ? "" : "s"} assigned today.`;
  const actions: DashboardAction[] = [];
  if (activeAlerts.some((item) => item.tone === "critical")) {
    title = "The floor needs attention"; detail = activeAlerts[0].detail; actions.push({ id: "urgent", label: "Review urgent items", route: activeAlerts[0].route, primary: true });
  } else if (!input.openAttendance && !input.shiftCompleted && ATTENDANCE_PERMISSIONS.some(input.hasPermission)) {
    title = "Ready to start your shift? 👋"; detail = "Not clocked in"; actions.push({ id: "attendance", label: "Clock in", kind: "clock", primary: true });
  } else if (input.activeAppointment) {
    title = `Continue with ${input.activeAppointment.clientName || "your client"}`; detail = input.activeAppointment.serviceNames.join(", ") || "Service in progress";
    const action = serviceAction(input, input.activeAppointment); if (action) actions.push(action);
  } else if (input.today?.activeBreak && ATTENDANCE_PERMISSIONS.some(input.hasPermission)) {
    title = "Take the time you need"; detail = "You are currently on break."; actions.push({ id: "end-break", label: "End break", kind: "end-break", primary: true });
  } else if (input.nextAppointment && minutesUntil(input.nextAppointment, input.now || new Date()) <= 60) {
    const minutes = Math.round((new Date(input.nextAppointment.startAt).getTime() - (input.now || new Date()).getTime()) / 60000);
    title = minutes >= 0 ? `${input.nextAppointment.clientName || "Your next client"} is coming up` : `${input.nextAppointment.clientName || "Your next client"} is waiting`;
    detail = `${timeLabel(input.nextAppointment.startAt)} · ${input.nextAppointment.serviceNames.join(", ") || "Service"}`;
    actions.push({ id: "next", label: "View appointment", route: "/staff/appointments", primary: true });
  } else if (input.openTaskCount > 0 && input.hasPermission("read:staff")) {
    title = `${input.openTaskCount} task${input.openTaskCount === 1 ? "" : "s"} to move forward`; detail = input.priorityTask?.title || "Review assigned tasks.";
    actions.push({ id: "tasks", label: "Open tasks", route: "/staff/tasks", primary: true });
  } else if (input.nextAppointment) {
    title = "Prepare for your next client"; detail = `${timeLabel(input.nextAppointment.startAt)} · ${input.nextAppointment.serviceNames.join(", ") || "Service"}`;
    actions.push({ id: "next", label: "View appointment", route: "/staff/appointments", primary: true });
  } else if (input.shiftCompleted) {
    title = "Your shift is complete"; detail = "Today’s attendance has been recorded.";
  }
  if (!actions.length && input.hasPermission("read:appointments")) actions.push({ id: "appointments", label: "View schedule", route: "/staff/appointments", primary: true });
  else if (actions[0]?.id === "attendance" && input.hasPermission("read:appointments")) actions.push({ id: "schedule", label: "Today’s schedule", route: "/staff/appointments" });
  return { eyebrow: input.openAttendance ? "Clocked in" : "Today", title, detail, shift: shiftText, shiftAssigned: !!shift, actions: actions.slice(0, 2) };
}

function minutesUntil(appointment: StaffAppointment, now: Date): number {
  return Math.round((new Date(appointment.startAt).getTime() - now.getTime()) / 60000);
}

function roleProfile(input: DashboardViewModelInput): DashboardRoleProfile {
  const role = String(input.user?.role || "").replace(/[\s_-]/g, "").toLowerCase();
  return ROLE_PROFILES.find((profile) => profile.aliases.includes(role)) || DEFAULT_ROLE_PROFILE;
}

function orderByIds<T>(items: readonly T[], preferred: readonly string[], id: (item: T) => string): T[] {
  return items.map((item, index) => ({ item, index, preferredIndex: preferred.indexOf(id(item)) }))
    .sort((left, right) => (left.preferredIndex < 0 ? 999 : left.preferredIndex) - (right.preferredIndex < 0 ? 999 : right.preferredIndex) || left.index - right.index)
    .map(({ item }) => item);
}

function orderedTools(input: DashboardViewModelInput): DashboardTool[] {
  const permitted = TOOLS.filter((entry) => allowed(entry, input)).map((entry) => entry.item);
  const preferred = [...(input.toolOrder || []), ...roleProfile(input).tools];
  return orderByIds(permitted, preferred, (item) => item.id);
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

function coachRoute(card: StaffEnterpriseOs["aiCoach"][number], input: DashboardViewModelInput): string {
  const text = `${card.title} ${card.body} ${card.action}`;
  if (/payment|invoice|checkout/i.test(text) && FINANCIAL_PERMISSIONS.some(input.hasPermission)) return "/staff/business";
  if (/client|preference|vip/i.test(text) && input.hasPermission("read:clients")) return "/staff/clients";
  if (/task/i.test(text) && input.hasPermission("read:staff")) return "/staff/tasks";
  if (/queue|timer|in progress/i.test(text) && input.hasPermission("read:appointments")) return "/staff/queue";
  if (/appointment|booking|service note/i.test(text) && input.hasPermission("read:appointments")) return "/staff/appointments";
  return "/staff/ai-coach";
}

function quickActionStatus(id: string, input: ActionContext): string | undefined {
  if (id === "appointments") return input.dashboard.summary.todayAppointments ? `${input.dashboard.summary.todayAppointments} today` : "No bookings";
  if (id === "queue") return input.dashboard.summary.liveAppointments ? `${input.dashboard.summary.liveAppointments} live` : "No live services";
  if (id === "tasks") return input.openTaskCount ? `${input.openTaskCount} pending` : "All clear";
  if (id === "attendance") return input.today?.activeBreak ? "On break" : input.openAttendance ? "Clocked in" : input.shiftCompleted ? "Shift complete" : "Not clocked in";
  if (id === "clients") return "Search profiles";
  if (id === "calendar") return "View shifts";
  return undefined;
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
    .map((entry) => {
      if (entry.item.id === "attendance" && (ctx.shiftCompleted || !!ctx.today?.activeBreak)) {
        return { ...entry.item, label: "Attendance", kind: undefined, route: "/staff/attendance", status: quickActionStatus(entry.item.id, ctx) };
      }
      return { ...entry.item, label: entry.item.id === "attendance" ? (ctx.openAttendance ? "Clock out" : "Clock in") : entry.item.label, status: quickActionStatus(entry.item.id, ctx) };
    })
    .filter((action) => !heroModel.actions.some((heroAction) => heroAction.primary && sameAction(action, heroAction)));
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
  const orderedOverview = orderByIds(overview, roleProfile(input).overview, (metric) => metric.label);
  const performance: DashboardMetric[] = [];
  if (input.hasPermission("read:staff") && input.enterprise) {
    performance.push(
      { label: "Productivity", value: `${input.enterprise.performance.productivityScore}/100`, hint: "Current score", progress: input.enterprise.performance.productivityScore, progressLabel: `Productivity ${input.enterprise.performance.productivityScore} out of 100` },
      { label: "Services", value: String(input.enterprise.performance.completedServices || input.dashboard.summary.completedAppointments), hint: "Completed" },
      { label: "Utilization", value: `${input.enterprise.performance.avgUtilization || 0}%`, hint: "Average utilization", progress: input.enterprise.performance.avgUtilization || 0, progressLabel: `Utilization ${input.enterprise.performance.avgUtilization || 0} percent` }
    );
  }
  if (FINANCIAL_PERMISSIONS.some(input.hasPermission)) {
    const value = input.dashboard.summary.revenue;
    if (Number.isSafeInteger(value) && value >= 0) performance.push({ label: "Revenue", value: formatPaiseInr(value), hint: value ? "Recorded sales" : "No recorded sales", route: "/staff/business" });
  }
  const performanceOrder = FINANCIAL_PERMISSIONS.some(input.hasPermission) ? ["Revenue", ...roleProfile(input).performance] : roleProfile(input).performance;
  const orderedPerformance = orderByIds(performance, performanceOrder, (metric) => metric.label).slice(0, 3).map((metric) => ({
    ...metric,
    progress: metric.progress === undefined ? undefined : Math.min(100, Math.max(0, Number(metric.progress) || 0))
  }));
  const coach = input.hasPermission("read:staff") ? (input.enterprise?.aiCoach || []).filter(actionableCoachCard).filter((card) => {
    const text = `${card.title} ${card.body} ${card.action}`;
    if (activeAlerts.some((alert) => alert.id === "payments") && /payment|invoice|checkout/i.test(text)) return false;
    return !heroModel.actions.some((action) => action.id === "tasks" && /task/i.test(text));
  }).slice(0, 3).map((card) => ({
    title: card.title, body: card.body, action: card.action, route: coachRoute(card, input)
  })) : [];
  const quickActions = orderByIds(quick, roleProfile(input).quick, (action) => action.id).slice(0, 4);
  return {
    hero: heroModel, quickActions, overview: orderedOverview.slice(0, 4), work: work(ctx), alerts: activeAlerts,
    coachIntro: coach.length ? `${coach.length} focused suggestion${coach.length === 1 ? "" : "s"} from today’s connected records.` : "",
    coach, performanceIntro: orderedPerformance.length ? "Based on connected service and staff performance records." : "",
    performanceRoute: input.hasPermission("read:staff") ? "/staff/performance" : undefined,
    performance: orderedPerformance, tools: visibleTools, availableTools
  };
}
